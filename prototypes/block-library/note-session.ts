import type { NoteDocument, NoteExperiencePort } from "./note-contracts.ts";

export type NoteSessionState = {
  content: string;
  dirty: boolean;
  phase:
    | "loading"
    | "ready"
    | "recovered"
    | "saving"
    | "saved"
    | "conflict"
    | "error";
  document: NoteDocument | null;
  error: string | null;
};

/** One shared editor session per canonical resource. The native service owns all persistence. */
export class NoteSession {
  readonly resourceId: string;
  private port: NoteExperiencePort;
  private value: NoteSessionState;
  private listeners = new Set<(state: NoteSessionState) => void>();
  private sequence = 0;
  private persistedSequence = -1;
  private baseVersion: number;
  private draftRevision = 0;
  private fenced = false;
  private tail: Promise<unknown> = Promise.resolve();
  private ready: Promise<void>;
  constructor(
    resourceId: string,
    port: NoteExperiencePort,
    initial: { version: number; content: string },
  ) {
    this.resourceId = resourceId;
    this.port = port;
    this.baseVersion = initial.version;
    this.value = {
      content: initial.content,
      dirty: false,
      phase: "loading",
      document: null,
      error: null,
    };
    this.ready = this.load().catch((error) => {
      this.fail(error);
    });
  }
  snapshot(): NoteSessionState {
    return structuredClone(this.value);
  }
  get hasObservers(): boolean {
    return this.listeners.size > 0;
  }
  subscribe(listener: (state: NoteSessionState) => void) {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }
  private publish() {
    for (const listener of this.listeners) listener(this.snapshot());
  }
  private fail(error: unknown) {
    this.value.error =
      error instanceof Error ? error.message : "note_save_failed";
    this.value.phase = /conflict|version/.test(this.value.error)
      ? "conflict"
      : "error";
    this.publish();
  }
  private async load() {
    const doc = await this.port.readNote(this.resourceId);
    this.value.document = doc;
    this.draftRevision = doc.draftRevision;
    if (!this.sequence) {
      this.value.content = doc.draft?.content ?? doc.resource.content;
      this.baseVersion = doc.draft?.baseResourceVersion ?? doc.resource.version;
      this.value.dirty = !!doc.draft;
      this.persistedSequence = 0;
    }
    this.value.phase =
      doc.conflict || this.baseVersion !== doc.resource.version
        ? "conflict"
        : doc.draft
          ? "recovered"
          : "ready";
    this.fenced = this.value.phase === "conflict";
    this.value.error = null;
    this.publish();
  }
  private queue<T>(work: () => Promise<T>): Promise<T> {
    const operation = this.tail.catch(() => {}).then(work);
    this.tail = operation;
    return operation;
  }
  edit(content: string): Promise<void> {
    this.sequence++;
    this.value.content = content;
    this.value.dirty = true;
    if (!["conflict", "loading"].includes(this.value.phase))
      this.value.phase = "saving";
    this.publish();
    return this.persist();
  }
  private async persistNow() {
    await this.ready;
    if (!this.value.document) {
      await this.load();
    }
    if (this.fenced) throw new Error("note_revision_conflict");
    while (this.value.dirty && this.persistedSequence !== this.sequence) {
      const sequence = this.sequence,
        content = this.value.content;
      const draft = await this.port.saveNoteDraft({
        resourceId: this.resourceId,
        expectedDraftVersion: this.draftRevision,
        baseResourceVersion: this.baseVersion,
        content,
      });
      this.draftRevision = draft.version;
      this.value.document!.draft = draft;
      this.value.document!.draftRevision = draft.version;
      this.persistedSequence = sequence;
    }
  }
  persist(): Promise<void> {
    return this.queue(async () => {
      try {
        await this.persistNow();
      } catch (error) {
        await this.recoverFailure(error);
        throw error;
      }
    });
  }
  private async recoverFailure(error: unknown) {
    // Refresh fences for an explicit recovery decision. Never replace the user's text.
    try {
      const doc = await this.port.readNote(this.resourceId);
      this.value.document = doc;
      this.draftRevision = doc.draftRevision;
    } catch {
      /* The local text still remains available to the editor. */
    }
    this.fail(error);
    if (this.value.phase === "conflict") this.fenced = true;
  }
  flush(): Promise<void> {
    return this.queue(async () => {
      try {
        await this.persistNow();
        if (this.value.phase === "conflict")
          throw new Error("note_revision_conflict");
        while (this.value.dirty) {
          const sequence = this.sequence,
            content = this.value.content;
          const doc = await this.port.commitNote({
            resourceId: this.resourceId,
            expectedResourceVersion: this.baseVersion,
            expectedDraftVersion: this.draftRevision,
            content,
          });
          this.value.document = doc;
          this.baseVersion = doc.resource.version;
          this.draftRevision = doc.draftRevision;
          // Edits typed during our own commit descend from that commit. Keep and persist them.
          this.value.dirty = sequence !== this.sequence;
          this.persistedSequence = sequence;
          if (this.value.dirty) await this.persistNow();
        }
        this.value.phase = "saved";
        this.value.error = null;
        this.publish();
      } catch (error) {
        await this.recoverFailure(error);
        throw error;
      }
    });
  }
  /** Explicit user decision to replace the current canonical revision with retained local text. */
  keepLocal(): Promise<void> {
    return this.queue(async () => {
      try {
        const doc = await this.port.readNote(this.resourceId);
        this.value.document = doc;
        this.baseVersion = doc.resource.version;
        this.draftRevision = doc.draftRevision;
        this.value.dirty = true;
        this.persistedSequence = -1;
        this.value.phase = "saving";
        this.fenced = false;
        await this.persistNow();
        this.value.error = null;
        this.publish();
      } catch (error) {
        await this.recoverFailure(error);
        throw error;
      }
    }).then(() => this.flush());
  }
  /** Explicit discard. If the user types during the request, those newer edits are retained. */
  useSaved(): Promise<void> {
    return this.queue(async () => {
      try {
        await this.ready;
        const sequence = this.sequence,
          current = await this.port.readNote(this.resourceId);
        const doc = await this.port.discardNoteDraft({
          resourceId: this.resourceId,
          expectedDraftVersion: current.draftRevision,
        });
        this.value.document = doc;
        this.baseVersion = doc.resource.version;
        this.draftRevision = doc.draftRevision;
        this.value.dirty = sequence !== this.sequence;
        this.persistedSequence = this.value.dirty ? -1 : this.sequence;
        if (!this.value.dirty) this.value.content = doc.resource.content;
        this.value.phase = this.value.dirty ? "saving" : "saved";
        this.fenced = false;
        this.value.error = null;
        this.publish();
        if (this.value.dirty) await this.persistNow();
      } catch (error) {
        await this.recoverFailure(error);
        throw error;
      }
    });
  }
  /** Refresh clean editors after canonical changes. Dirty editors retain their original revision fence. */
  refresh(): Promise<void> {
    return this.queue(async () => {
      await this.ready;
      if (this.value.dirty) return;
      this.sequence = 0;
      try {
        await this.load();
      } catch (error) {
        this.fail(error);
        throw error;
      }
    });
  }
}
