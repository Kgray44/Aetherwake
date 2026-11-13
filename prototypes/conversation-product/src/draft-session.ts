/** Browser-only recovery coordinator. The injected canonical API owns all persistence and access policy. */
import type { DraftDocument } from './contracts.ts';
export interface ConversationDraftRecord { resourceId: string; version: number; content: string; updatedAt: string | null; documents?: DraftDocument[] }
export interface ConversationDraftPort {
  command(name: 'readDraft', input: { resourceId: string }): Promise<ConversationDraftRecord>;
  command(name: 'saveDraft', input: { resourceId: string; expectedVersion: number; content: string; documents?: DraftDocument[] }): Promise<ConversationDraftRecord>;
}
export type DraftPhase = 'loading' | 'clean' | 'dirty' | 'saving' | 'conflict' | 'error';
export interface DraftSessionSnapshot {
  resourceId: string; content: string; version: number | null; editRevision: number;
  documents: readonly DraftDocument[];
  phase: DraftPhase; remote: ConversationDraftRecord | null; error: string | null;
}
export interface DraftCheckpoint { record: ConversationDraftRecord; editRevision: number }
type Task =
  | { kind: 'checkpoint'; content: string; documents: DraftDocument[]; editRevision: number; resolve: (value: DraftCheckpoint) => void; reject: (error: Error) => void }
  | { kind: 'acknowledge'; checkpoint: DraftCheckpoint; resolve: (cleared: boolean) => void; reject: (error: Error) => void };
const failure = (error: unknown) => error instanceof Error ? error.message : String(error);
const validContent = (content: string) => content.length <= 16384 && new TextEncoder().encode(content).byteLength <= 65536;
const sameDocuments = (left: readonly DraftDocument[] = [], right: readonly DraftDocument[] = []) =>
  left.length === right.length && left.every((ref, index) => ref.id === right[index].id && ref.version === right[index].version);

/**
 * Use with the canonical ConversationProduct command port for any physical composer:
 * await ready, subscribe to snapshots, update on input, and await flush before navigation/shutdown.
 * checkpoint() captures the clicked submission; send its record.content through the existing native
 * consent path. Only after exact canonical submission acceptance call acknowledgeSent(checkpoint).
 * Later edit generations are retained even if their final text equals the earlier submission.
 * resolve() is an explicit user decision against the displayed remote version, never automatic retry.
 */
export class ConversationDraftSession {
  readonly resourceId: string;
  readonly ready: Promise<void>;
  private readonly port: ConversationDraftPort;
  private readonly onChange?: (state: DraftSessionSnapshot) => void;
  private readonly listeners = new Set<(state: DraftSessionSnapshot) => void>();
  private readonly delay: number;
  private readonly initialLocal: boolean;
  private content: string;
  private documents: DraftDocument[] = [];
  private editRevision = 0;
  private known: ConversationDraftRecord | null = null;
  private unconfirmedSave: (Pick<ConversationDraftRecord,'version'|'content'|'documents'> & { editRevision: number; acceptedClear: boolean }) | null = null;
  private remote: ConversationDraftRecord | null = null;
  private error: string | null = null;
  private loading = true;
  private saving = false;
  private stopped = false;
  private resolving = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private worker: Promise<void> | null = null;
  private tasks: Task[] = [];

  constructor(options: { resourceId: string; port: ConversationDraftPort; initialContent?: string; debounceMs?: number; onChange?: (state: DraftSessionSnapshot) => void }) {
    this.resourceId = options.resourceId; this.port = options.port; this.onChange = options.onChange;
    this.delay = options.debounceMs ?? 180; this.content = options.initialContent ?? ''; this.initialLocal = options.initialContent !== undefined;
    this.ready = this.load(options.initialContent !== undefined);
  }
  snapshot(): DraftSessionSnapshot {
    return { resourceId: this.resourceId, content: this.content, documents: this.documents, version: this.known?.version ?? null, editRevision: this.editRevision,
      phase: this.loading ? 'loading' : this.remote ? 'conflict' : this.error ? 'error' : this.saving ? 'saving' : this.dirty() || this.tasks.length ? 'dirty' : 'clean',
      remote: this.remote ? { ...this.remote } : null, error: this.error };
  }
  /** A view may observe an externally owned session without taking its persistence lifecycle. */
  subscribe(listener: (state: DraftSessionSnapshot) => void): () => void {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  }
  private emit() { this.onChange?.(this.snapshot()); for (const listener of this.listeners) listener(this.snapshot()); }
  private dirty() { return !!this.known && (this.content !== this.known.content || !sameDocuments(this.documents, this.known.documents)); }
  private checkRecord(record: ConversationDraftRecord) {
    if (!record || record.resourceId !== this.resourceId || !Number.isSafeInteger(record.version) || record.version < 0 || typeof record.content !== 'string' || !validContent(record.content) || (record.updatedAt !== null && typeof record.updatedAt !== 'string')) throw new Error('invalid_draft_response');
    if (record.documents !== undefined && (!Array.isArray(record.documents) || record.documents.length > 4 ||
        record.documents.some(ref => !ref || typeof ref.id !== 'string' || typeof ref.title !== 'string' ||
          !Number.isSafeInteger(ref.version) || ref.version < 1))) throw new Error('invalid_draft_response');
    return { ...record };
  }
  private async load(hasLocal: boolean) {
    const revision = this.editRevision;
    try {
      const record = this.checkRecord(await this.port.command('readDraft', { resourceId: this.resourceId })); this.known = record;
      if ((hasLocal || this.editRevision !== revision) && this.content !== record.content) {
        if (record.version > 0) this.remote = record;
      } else this.content = record.content;
      this.documents = record.documents ?? [];
    } catch (error) { this.error = failure(error); }
    this.loading = false; this.emit(); if (this.dirty() && !this.remote && !this.error) this.schedule();
  }
  update(content: string) {
    if (this.stopped) throw new Error('draft_session_closed');
    if (content === this.content) return;
    this.content = content; this.editRevision++;
    if (!validContent(content)) this.error = 'draft_limit_exceeded';
    else if (this.error === 'draft_limit_exceeded') this.error = null;
    this.emit(); if (!this.loading && !this.remote && !this.error) this.schedule();
  }
  private schedule() {
    clearTimeout(this.timer); this.timer = setTimeout(() => { this.timer = undefined; void this.start(); }, this.delay);
  }
  updateDocuments(documents: readonly DraftDocument[]) {
    if (this.stopped || this.loading) throw new Error('draft_session_unavailable');
    if (sameDocuments(this.documents, documents)) return;
    this.documents = documents.map(ref => ({ ...ref }));
    this.editRevision++;
    this.emit();
    if (!this.remote && !this.error) this.schedule();
  }
  private blocked() { return this.remote ? 'stale_draft_version' : this.error ?? (!this.known ? 'draft_not_loaded' : null); }
  private rejectTasks(error: Error) { for (const task of this.tasks.splice(0)) task.reject(error); }
  private async recordError(error: unknown) {
    this.error = failure(error);
    if (this.error.includes('stale_draft_version')) {
      try { this.remote = this.checkRecord(await this.port.command('readDraft', { resourceId: this.resourceId })); }
      catch (readError) { this.error = failure(readError); }
    }
  }
  private start(): Promise<void> {
    if (this.worker) return this.worker;
    this.worker = this.work().finally(() => { this.worker = null; if (this.tasks.length && !this.blocked()) void this.start(); });
    return this.worker;
  }
  private async work() {
    await this.ready;
    const block = this.blocked(); if (block) { this.rejectTasks(new Error(block)); return; }
    while (!this.stopped && (this.tasks.length || this.dirty())) {
      const task = this.tasks.shift();
      if (task?.kind === 'acknowledge' && (this.editRevision !== task.checkpoint.editRevision || this.content !== task.checkpoint.record.content || this.known!.version !== task.checkpoint.record.version)) { task.resolve(false); continue; }
      const content = task?.kind === 'checkpoint' ? task.content : task?.kind === 'acknowledge' ? '' : this.content;
      const documents = task?.kind === 'checkpoint' ? task.documents : task?.kind === 'acknowledge' ? [] : this.documents;
      const editRevision = task?.kind === 'checkpoint' ? task.editRevision : this.editRevision;
      if (!validContent(content)) { this.error = 'draft_limit_exceeded'; task?.reject(new Error(this.error)); this.rejectTasks(new Error(this.error)); this.emit(); return; }
      const expectedVersion = task?.kind === 'acknowledge' ? task.checkpoint.record.version : this.known!.version;
      this.saving = true; this.emit();
      try {
        const record = this.checkRecord(await this.port.command('saveDraft', { resourceId: this.resourceId, expectedVersion, content,
          ...(documents.length || this.known!.documents?.length ? { documents } : {}) }));
        if (record.version !== expectedVersion + 1 || record.content !== content || !sameDocuments(record.documents, documents)) throw new Error('invalid_draft_response');
        this.known = record;
        this.unconfirmedSave = null;
        if (task?.kind !== 'acknowledge' && sameDocuments(this.documents, record.documents))
          this.documents = record.documents ?? this.documents;
        if (task?.kind === 'checkpoint') task.resolve({ record: { ...record }, editRevision: task.editRevision });
        if (task?.kind === 'acknowledge') {
          const unchanged = this.editRevision === task.checkpoint.editRevision && this.content === task.checkpoint.record.content;
          if (unchanged) { this.content = ''; this.documents = []; this.editRevision++; } task.resolve(unchanged);
        }
      } catch (error) {
        // A failed delivery can leave the local CAS write committed. Keep the
        // exact attempted draft only until a canonical read establishes its state.
        if (/(?:^|: )(?:backend_disconnected|backend_timeout)$/.test(failure(error)))
          this.unconfirmedSave = {version:expectedVersion+1,content,documents,editRevision,acceptedClear:task?.kind==='acknowledge'};
        await this.recordError(error); const errorValue = new Error(this.blocked() ?? failure(error)); task?.reject(errorValue); this.rejectTasks(errorValue); return;
      } finally { this.saving = false; this.emit(); }
    }
  }
  async flush(): Promise<void> {
    clearTimeout(this.timer); this.timer = undefined; await this.ready;
    do { const block = this.blocked(); if (block) throw new Error(block); await this.start(); } while (this.tasks.length || this.dirty());
    const block = this.blocked(); if (block) throw new Error(block);
  }
  /** Persist this exact submission even if later typing is coalesced into another recovery write. */
  checkpoint(): Promise<DraftCheckpoint> {
    if (this.stopped) return Promise.reject(new Error('draft_session_closed'));
    clearTimeout(this.timer); this.timer = undefined;
    const result = new Promise<DraftCheckpoint>((resolve, reject) => this.tasks.push({ kind: 'checkpoint', content: this.content, documents: this.documents, editRevision: this.editRevision, resolve, reject })); void this.start(); return result;
  }
  /** Call only after canonical submission acceptance is established. This does not assert provider/task completion. */
  acknowledgeSent(checkpoint: DraftCheckpoint): Promise<boolean> {
    if (checkpoint.record.resourceId !== this.resourceId || this.stopped) return Promise.reject(new Error('invalid_draft_checkpoint'));
    const result = new Promise<boolean>((resolve, reject) => this.tasks.push({ kind: 'acknowledge', checkpoint, resolve, reject })); void this.start(); return result;
  }
  /** An explicit choice binds the displayed remote revision; a newer edit requires another review. */
  async resolve(choice: 'keep-local' | 'use-stored', expectedRemoteVersion: number) {
    if (this.stopped || !['keep-local','use-stored'].includes(choice) || this.resolving) throw new Error('draft_resolution_unavailable');
    const revision = this.editRevision;
    this.resolving = true;
    try {
      await this.worker;
      if (!this.remote || this.remote.version !== expectedRemoteVersion) throw new Error('draft_resolution_stale');
      let record: ConversationDraftRecord;
      try { record = this.checkRecord(await this.port.command('readDraft', { resourceId: this.resourceId })); }
      catch (error) { this.error = failure(error); this.remote = null; this.emit(); throw error; }
      if (record.version !== expectedRemoteVersion || record.content !== this.remote.content || !sameDocuments(record.documents, this.remote.documents) || this.editRevision !== revision) { this.remote = record; this.emit(); throw new Error('draft_resolution_stale'); }
      this.known = record; this.remote = null; this.error = null;
      if (choice === 'use-stored') { this.content = record.content; this.documents = record.documents ?? []; this.editRevision++; }
      this.emit(); await this.flush();
    } finally { this.resolving = false; }
  }
  /** Re-read after access/transient failure or explicit reopening. A competing dirty version becomes reviewable. */
  async reload() {
    if (this.stopped) throw new Error('draft_session_closed');
    await this.ready; await this.worker;
    const readRevision = this.editRevision;
    let record: ConversationDraftRecord;
    try { record = this.checkRecord(await this.port.command('readDraft', { resourceId: this.resourceId })); }
    catch (error) { this.error = failure(error); this.remote = null; this.emit(); throw error; }
    // A read response is a snapshot from before its transport delay. Writes and typing
    // may have completed while awaiting it; never roll back either observed revision.
    while (this.worker) await this.worker;
    if (record.version < Math.max(this.known?.version ?? 0, this.remote?.version ?? 0)) { this.emit(); return; }
    const differs = (other: Pick<ConversationDraftRecord,'content'|'documents'>) =>
      record.content !== other.content || !sameDocuments(record.documents, other.documents);
    if ((record.version === this.known?.version && differs(this.known)) || (record.version === this.remote?.version && differs(this.remote))) { this.error = 'invalid_draft_response'; this.emit(); throw new Error(this.error); }
    const attempted = this.unconfirmedSave;
    const confirmedSave = attempted?.version === record.version && !differs(attempted);
    this.unconfirmedSave = null;
    const clearAcceptedDraft = confirmedSave && attempted.acceptedClear && this.editRevision === attempted.editRevision;
    const localIntent = this.dirty() || this.editRevision !== readRevision ||
      (attempted !== null && this.editRevision !== attempted.editRevision) ||
      (!this.known && (this.initialLocal || this.editRevision > 0));
    const differsLocally = differs({content:this.content,documents:this.documents});
    if (this.remote && differsLocally) { this.remote = record; this.error = null; }
    else if (!confirmedSave && localIntent && differsLocally && record.version > (this.known?.version ?? 0)) this.remote = record;
    else {
      const adoptStoredDraft = clearAcceptedDraft || (!localIntent && !confirmedSave);
      if (adoptStoredDraft) this.content = record.content;
      if (adoptStoredDraft || sameDocuments(this.documents, record.documents)) this.documents = record.documents ?? [];
      if (clearAcceptedDraft) this.editRevision++;
      this.known = record; this.remote = null; this.error = null;
    }
    this.emit(); if (this.dirty() && !this.blocked()) this.schedule();
  }
  /** The owner must await flush before unmount/shutdown; a conflict prevents disposal instead of losing text. */
  async dispose() { if (this.stopped) return; await this.flush(); this.stopped = true; clearTimeout(this.timer); }
}

/** Drain all live composers again if another session or editor changed during an awaited save. */
export async function flushConversationDraftSessions(sessions: () => Iterable<ConversationDraftSession>, capture?: () => void): Promise<void> {
  for (;;) {
    capture?.(); await Promise.all([...sessions()].map(session => session.flush())); capture?.();
    if ([...sessions()].every(session => session.snapshot().phase === 'clean')) return;
  }
}
