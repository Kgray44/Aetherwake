import { randomUUID, createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { dirname, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DesktopState } from './desktop.mts';
import type { DatabaseSync } from 'node:sqlite';
import { WorkspaceKernel } from '../../workspace-kernel/kernel.mts';
import { ConversationGraph, type GraphData, type ProviderAdapter as GraphAdapter } from '../../connected-conversations/src/graph.ts';
import { mockOrdinaryAdapter } from '../../connected-conversations/src/adapters.ts';
import type { EventEnvelope } from '../../codex-bridge/src/adapter.ts';
import { nativeProvider, fixtureProvider } from './providers.mts';
import { CONTRACT, ensure, ServiceError, type Binding, type Execution, type HandoffReview, type Options, type ProviderPort, type StreamEvent, type CommandMap } from './contracts.mts';

const now = () => new Date().toISOString();
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const itemType = (value: unknown) => ['userMessage','agentMessage','commandExecution','fileChange','mcpToolCall','dynamicToolCall','reasoning','webSearch','imageView','imageGeneration','collabAgentToolCall','contextCompaction'].includes(String(value)) ? String(value) : 'unknown';
interface State {
  schemaVersion: 1; graph: GraphData;
  resources: Record<string, string>; revisions: Record<string, number>;
  bindings: Record<string, Binding[]>; reviews: Record<string, HandoffReview>;
  executions: Record<string, Execution>;
  messageEvidence: Record<string, { classification: 'reported' | 'simulated'; executionId: string; providerId: string; nativeTurnId: string; nativeThreadId: string }>;
  receipts: Record<string, { fingerprint: string; result: any }>;
}

export class BackendCore {
  private kernel: WorkspaceKernel;
  private db!: DatabaseSync;
  private graph!: ConversationGraph;
  private state!: State;
  private storedJson: string | null = null;
  private port: ProviderPort;
  private connectionId = randomUUID();
  private sequence = 0;
  private active: Execution | null = null;
  private assistantText = '';
  private streamFailure = false;
  private stopEvents: () => void;
  private emit: (event: StreamEvent) => void;
  private maxEvents: number;
  private closed = false;
  private desktop: DesktopState;
  constructor(options: Options, emit: (event: StreamEvent) => void = () => {}) {
    if (options.contentPolicy !== 'synthetic-only') {
      ensure(options.contentPolicy === 'local-private' && options.privateRoot && isAbsolute(options.path), 'protected_storage_unavailable');
      const privateRoot = realpathSync(options.privateRoot!);
      const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
      const rel = relative(sourceRoot, privateRoot);
      ensure(rel.startsWith('..') || isAbsolute(rel), 'private_storage_inside_source');
      ensure(realpathSync(dirname(options.path)) === privateRoot, 'private_storage_scope_mismatch');
    }
    this.maxEvents = options.retention?.maxEvents ?? 10000;
    ensure(Number.isInteger(this.maxEvents) && this.maxEvents >= 4 && this.maxEvents <= 100000, 'invalid_retention');
    this.emit = emit;
    this.port = options.provider === 'codex' || options.provider === 'bridge-fixture' ? nativeProvider(options) : fixtureProvider(options.fixtureMode);
    this.kernel = WorkspaceKernel.open(options.path);
    try {
      this.kernel.withTransaction(db => {
        this.db = db;
        // Hard prototype file ceiling: 128 MiB main database, no WAL. Journal
        // can temporarily add another 128 MiB; ReserveGuard budgets 512 MiB.
        const pageSize = Number(db.prepare('PRAGMA page_size').get()!.page_size);
        ensure(db.prepare('PRAGMA journal_mode').get()!.journal_mode === 'delete', 'unsupported_journal_mode');
        db.exec('PRAGMA max_page_count = ' + Math.floor(128 * 1024 * 1024 / pageSize));
        db.exec(`CREATE TABLE IF NOT EXISTS integration_schema(version INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS integration_state(id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS intelligence_events(
            cursor INTEGER PRIMARY KEY AUTOINCREMENT, dedupe TEXT NOT NULL UNIQUE, json TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS integration_meta(id INTEGER PRIMARY KEY CHECK(id=1), latest INTEGER NOT NULL);`);
        const versions = db.prepare('SELECT version FROM integration_schema').all();
        if (!versions.length) db.prepare('INSERT INTO integration_schema VALUES(1)').run();
        else ensure(versions.length === 1 && versions[0].version === 1, 'unsupported_schema');
        db.prepare('INSERT OR IGNORE INTO integration_meta VALUES(1,0)').run();
        const row = db.prepare('SELECT json FROM integration_state WHERE id=1').get();
        this.storedJson = row ? String(row.json) : null;
        if (row) this.state = JSON.parse(String(row.json));
        else this.state = { schemaVersion: 1, graph: new ConversationGraph(this.localAdapters()).snapshot(), resources: {}, revisions: {}, bindings: {}, reviews: {}, executions: {}, messageEvidence: {}, receipts: {} };
        // Additive optional metadata within experimental schema 1.
        this.state.messageEvidence ??= {};
        ensure(this.state.schemaVersion === 1, 'unsupported_schema');
        this.graph = new ConversationGraph(this.localAdapters(), this.state.graph);
        this.validateState();
        for (const e of Object.values(this.state.executions)) {
          if (e.state === 'dispatching' || e.state === 'running') {
            e.state = 'unknown'; e.errorCode = 'restart_unknown_outcome';
            for (const r of Object.values(this.state.reviews)) if (r.resourceId === e.resourceId && r.state === 'dispatching') r.state = 'unknown';
          }
        }
        this.save();
      });
      this.stopEvents = this.port.onEvent(e => this.ingest(e));
      this.desktop = new DesktopState(this.kernel, this.db);
      this.record('stream/reopened', 'inferred');
    } catch (error) { this.kernel.close(); throw error; }
  }
  private localAdapters(): GraphAdapter[] {
    const ordinary = mockOrdinaryAdapter();
    const staging: GraphAdapter = { snapshot: { ...ordinary.snapshot, id: this.port.id, label: this.port.mock ? 'SIMULATED Codex fixture' : 'Codex local identity staging (execution not established)', mock: this.port.mock, nativeFork: { supported: false, authorized: false, availability: 'unsupported' } }, open: () => ({ providerSessionId: null }) };
    return [ordinary, staging];
  }
  private validateState() {
    ensure(this.state.resources && this.state.revisions && this.state.bindings && this.state.reviews && this.state.executions && this.state.receipts, 'corrupt_state');
    const graphs = this.graph.snapshot().conversations;
    ensure(Object.values(this.state.resources).length === graphs.length, 'corrupt_resource_mapping');
    ensure(new Set(Object.values(this.state.resources)).size === graphs.length, 'corrupt_resource_mapping');
    for (const [resourceId, graphId] of Object.entries(this.state.resources)) {
      ensure(graphs.some(c => c.id === graphId), 'corrupt_resource_mapping');
      ensure(this.kernel.getResource(resourceId).resource.kind === 'conversation', 'corrupt_resource_mapping');
      ensure(Number.isInteger(this.state.revisions[resourceId]) && this.state.revisions[resourceId] > 0, 'corrupt_revision');
    }
    for (const e of Object.values(this.state.executions)) {
      ensure(this.state.resources[e.resourceId] && e.taskVerified === false, 'corrupt_execution');
      ensure(['dispatching','running','provider_completed','failed','interrupted','unknown'].includes(e.state), 'corrupt_execution');
    }
    for (const r of Object.values(this.state.reviews)) {
      ensure(this.state.resources[r.resourceId] && this.state.resources[r.sourceResourceId], 'corrupt_handoff');
      ensure(this.graph.snapshot().handoffs.some(h => h.id === r.id), 'corrupt_handoff');
    }
    for (const row of this.db.prepare('SELECT json FROM intelligence_events').all()) {
      const e = JSON.parse(String(row.json));
      ensure(e.schemaVersion === 1 && typeof e.eventId === 'string' && ['observed','reported','inferred','simulated'].includes(e.classification), 'corrupt_event');
    }
  }
  private save() {
    this.state.graph = this.graph.snapshot();
    const json = JSON.stringify(this.state);
    ensure(Buffer.byteLength(json) <= 8 * 1024 * 1024, 'state_capacity_reached');
    const current = this.db.prepare('SELECT json FROM integration_state WHERE id=1').get();
    ensure((current ? String(current.json) : null) === this.storedJson, 'concurrent_backend_writer');
    this.db.prepare('INSERT INTO integration_state VALUES(1,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').run(json);
    this.storedJson = json;
  }
  private atomic<T>(fn: () => T): T {
    const before = structuredClone(this.state);
    const graphBefore = this.graph.snapshot();
    const storedBefore = this.storedJson;
    try { return this.kernel.withTransaction(() => { const result = fn(); this.save(); return result; }); }
    catch (error) { this.state = before; this.storedJson = storedBefore; this.graph = new ConversationGraph(this.localAdapters(), graphBefore); throw error; }
  }
  private gid(resourceId: string) { ensure(typeof resourceId === 'string' && Object.hasOwn(this.state.resources, resourceId), 'resource_not_found'); return this.state.resources[resourceId]; }
  private publicId(graphId: string) { const id = Object.keys(this.state.resources).find(id => this.state.resources[id] === graphId); ensure(id, 'resource_not_found'); return id; }
  private once<T>(commandId: string, input: unknown, fn: () => T): T {
    ensure(typeof commandId === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,198}$/.test(commandId), 'invalid_command_id');
    const fingerprint = hash(input), previous = Object.hasOwn(this.state.receipts, commandId) ? this.state.receipts[commandId] : undefined;
    if (previous) { ensure(previous.fingerprint === fingerprint, 'idempotency_conflict'); return structuredClone(previous.result); }
    const result = fn(); this.state.receipts[commandId] = { fingerprint, result }; return result;
  }
  private conv(resourceId: string) {
    const c = this.graph.snapshot().conversations.find(c => c.id === this.gid(resourceId))!;
    return { resourceId, revision: this.state.revisions[resourceId], title: c.title, providerId: c.providerId, kind: c.kind, taskId: null, projectId: null };
  }
  private create(title: string, providerId: string) {
    const c = this.graph.createChat(providerId === 'mock-ordinary' ? 'ordinary' : 'codex', providerId, title);
    const resource = this.kernel.createConversationRef(title);
    this.state.resources[resource.id] = c.id; this.state.revisions[resource.id] = 1;
    return this.conv(resource.id);
  }
  private record(type: string, classification: StreamEvent['classification'], native?: EventEnvelope, dedupe: string = randomUUID()) {
    const e: StreamEvent = { schemaVersion: 1, eventId: randomUUID(), cursor: 0, resourceId: this.active?.resourceId ?? null, executionId: this.active?.id ?? null,
      providerId: this.port.id, providerInstanceId: this.port.instanceId, connectionId: this.connectionId,
      nativeEventId: null, nativeSequence: native?.sequence ?? null, threadId: native?.providerThreadId ?? this.active?.binding?.nativeThreadId ?? null,
      turnId: native?.providerTurnId ?? this.active?.turnId ?? null, correlationId: this.active?.commandId ?? null, causationId: this.active?.id ?? null,
      receivedAt: now(), providerTime: native?.providerTime ?? null, providerTimeSource: native?.providerTimeSource ?? null,
      type, classification, status: native?.terminalStatus ?? null, payload: { redacted: true, ...(typeof native?.payload.delta === 'string' ? { textBytes: Buffer.byteLength(native.payload.delta) } : {}), ...(native?.payload.item ? { itemType: itemType((native.payload.item as any).type) } : {}) } };
    let inserted = false;
    this.kernel.withTransaction(() => {
      const result = this.db.prepare('INSERT OR IGNORE INTO intelligence_events(dedupe,json) VALUES(?,?)').run(dedupe, JSON.stringify(e));
      if (!result.changes) return;
      inserted = true; e.cursor = Number(result.lastInsertRowid);
      this.db.prepare('UPDATE intelligence_events SET json=? WHERE cursor=?').run(JSON.stringify(e), e.cursor);
      this.db.prepare('UPDATE integration_meta SET latest=? WHERE id=1').run(e.cursor);
      this.db.prepare('DELETE FROM intelligence_events WHERE cursor NOT IN (SELECT cursor FROM intelligence_events ORDER BY cursor DESC LIMIT ?)').run(this.maxEvents);
    });
    if (inserted) this.emit(e);
    return inserted;
  }
  private ingest(e: EventEnvelope) {
    try {
      ensure(e.schemaVersion === 1 && Number.isInteger(e.sequence) && e.sequence > 0 && typeof e.method === 'string', 'invalid_provider_event');
      if (this.active?.binding && e.providerThreadId && e.providerThreadId !== this.active.binding.nativeThreadId) return;
      const dedupe = `${this.port.id}:${this.connectionId}:${e.eventId}`;
      if (this.db.prepare('SELECT 1 FROM intelligence_events WHERE dedupe=?').get(dedupe)) return;
      if (e.sequence > this.sequence + 1 || e.sequence <= this.sequence) this.record('stream/gap-or-reorder', 'inferred');
      this.sequence = Math.max(this.sequence, e.sequence);
      const classification = this.port.mock ? 'simulated' : e.evidence === 'inferred' ? 'inferred' : e.method.includes('agentMessage') ? 'reported' : 'observed';
      this.record(e.method, classification, e, dedupe);
      if (this.active && e.method === 'item/agentMessage/delta' && typeof e.payload.delta === 'string') {
        ensure(Buffer.byteLength(this.assistantText) + Buffer.byteLength(e.payload.delta) <= 65536, 'provider_output_too_large');
        this.assistantText += e.payload.delta;
        // Only assistant output is forwarded live. Durable stream records remain metadata-only.
        // Private reasoning/tool payloads never cross this desktop boundary.
        this.emit({ ...this.recordedEventForDelta(), payload: { redacted: true, delta: e.payload.delta } });
      }
    } catch { this.streamFailure = true; } // Never throw into transport callbacks; fail the execution closed.
  }
  private recordedEventForDelta(): StreamEvent {
    const row = this.db.prepare('SELECT json FROM intelligence_events ORDER BY cursor DESC LIMIT 1').get();
    return JSON.parse(String(row!.json));
  }
  private package(id: string) { const r = this.state.reviews[id]; ensure(r, 'handoff_not_found'); return r; }
  private validateReview(r: HandoffReview) {
    ensure(this.state.revisions[r.sourceResourceId] === r.sourceRevision, 'stale_source_revision');
    const h = this.graph.inspectHandoff(r.id);
    ensure(h.staleMessageIds.length === 0, 'stale_context');
    ensure(h.items.every(i => !['sensitive','restricted'].includes((i as any).sensitivity)), 'sensitive_content_excluded');
    ensure(r.estimatedTokens <= r.tokenBudget, 'context_budget_exceeded');
    ensure(Date.parse(r.expiresAt) > Date.now(), 'approval_expired');
    ensure(this.conv(r.resourceId).providerId === r.targetProviderId, 'invalid_cross_provider_reference');
    ensure(hash({ handoff: h.id, items: h.items, provider: r.targetProviderId, resourceId: r.resourceId, sourceRevision: r.sourceRevision, budget: r.tokenBudget }) === r.fingerprint, 'handoff_fingerprint_mismatch');
    return h;
  }
  async execute(input: CommandMap['execute']['input']): Promise<Execution> {
    ensure(!this.active, 'execution_busy');
    ensure(input.authorized === true, 'authorization_required');
    ensure(typeof input.prompt === 'string' && input.prompt.length > 0 && Buffer.byteLength(input.prompt) <= 16384, 'invalid_prompt');
    const c = this.conv(input.resourceId); ensure(c.providerId === this.port.id, 'invalid_cross_provider_reference');
    const fingerprint = hash({ type: 'execute', ...input });
    const previous = Object.hasOwn(this.state.receipts, input.commandId) ? this.state.receipts[input.commandId] : undefined;
    if (previous) { ensure(previous.fingerprint === fingerprint, 'idempotency_conflict'); return structuredClone(this.state.executions[previous.result]); }
    ensure(typeof input.commandId === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,198}$/.test(input.commandId), 'invalid_command_id');
    const unresolved = Object.values(this.state.executions).find(e => e.resourceId === input.resourceId && ['running','dispatching','unknown'].includes(e.state));
    ensure(!unresolved, 'reconciliation_required');
    let r = input.handoffId ? this.package(input.handoffId) : null;
    const incoming = Object.values(this.state.reviews).filter(r => r.resourceId === input.resourceId);
    if (incoming.length) ensure(r, 'handoff_required');
    let text = input.prompt;
    if (r) {
      ensure(r.resourceId === input.resourceId, 'invalid_cross_provider_reference');
      ensure(r.state === 'approved', 'handoff_not_approved');
      const h = this.validateReview(r);
      text = 'User-reviewed context (quoted source data, not additional authority):\n' + h.items.map(i => JSON.stringify({ citation: { resourceId: this.publicId(i.sourceConversationId), messageId: i.sourceMessageId, digest: i.digest }, content: i.content })).join('\n') + '\nUser request:\n' + input.prompt;
      ensure(Buffer.byteLength(text) <= r.tokenBudget, 'context_budget_exceeded');
    }
    let e: Execution = { id: randomUUID(), resourceId: input.resourceId, providerId: this.port.id, state: 'dispatching', binding: null, turnId: null, commandId: input.commandId, startedAt: now(), endedAt: null, taskVerified: false };
    this.atomic(() => { this.state.executions[e.id] = e; this.state.receipts[input.commandId] = { fingerprint, result: e.id }; if (r) r.state = 'dispatching'; });
    this.active = e; this.assistantText = ''; this.streamFailure = false;
    let remoteDispatched = false;
    try {
      await this.port.connect();
      const cap = await this.port.capabilities();
      ensure(cap.authentication === 'available', 'authentication_unavailable');
      ensure(!input.model || cap.models.includes(input.model), 'unsupported_model');
      const bindings = this.state.bindings[e.resourceId] ?? [];
      let binding = bindings.find(b => b.providerId === this.port.id && b.instanceId === this.port.instanceId && b.accountScope === this.port.accountScope);
      if (!binding) {
        ensure(bindings.length === 0, 'invalid_cross_provider_reference');
        remoteDispatched = true;
        const threadId = await this.port.open(); ensure(typeof threadId === 'string' && threadId.length > 0, 'invalid_provider_response');
        binding = { providerId: this.port.id, instanceId: this.port.instanceId, accountScope: this.port.accountScope, nativeThreadId: threadId, nativeSessionId: null };
        this.atomic(() => { this.state.bindings[e.resourceId] = [binding!]; e.binding = binding!; this.kernel.addExternalRef(e.resourceId, this.port.id, 'thread', threadId); });
      } else {
        e.binding = binding;
        remoteDispatched = true;
        ensure(await this.port.resume(binding.nativeThreadId) === binding.nativeThreadId, 'invalid_provider_response');
      }
      this.atomic(() => { e.state = 'running'; });
      remoteDispatched = true;
      const turnId = await this.port.turn(binding.nativeThreadId, text, input.model);
      ensure(typeof turnId === 'string' && turnId.length > 0, 'invalid_provider_response');
      this.atomic(() => { e.turnId = turnId; });
      const terminal = await this.port.terminal(binding.nativeThreadId, turnId);
      ensure(terminal && terminal.providerTurnId === turnId && terminal.providerThreadId === binding.nativeThreadId && ['completed','interrupted','failed'].includes(terminal.terminalStatus ?? ''), 'invalid_provider_response');
      ensure(!this.streamFailure, 'event_ingestion_failed');
      this.atomic(() => {
        e.state = terminal.terminalStatus === 'completed' ? 'provider_completed' : terminal.terminalStatus === 'interrupted' ? 'interrupted' : 'failed';
        e.endedAt = now();
        this.graph.addMessage(this.gid(e.resourceId), 'user', input.prompt);
        if (e.state === 'provider_completed' && this.assistantText.trim()) {
          const m = this.graph.addMessage(this.gid(e.resourceId), 'assistant', this.assistantText, { provenance: this.port.mock ? 'mock_adapter' : 'application', providerTurnId: turnId, referenceIds: r ? [r.id] : [], sensitivity: 'public' });
          this.state.messageEvidence[m.id] = { classification: this.port.mock ? 'simulated' : 'reported', executionId: e.id, providerId: this.port.id, nativeTurnId: turnId, nativeThreadId: binding.nativeThreadId };
        }
        this.state.revisions[e.resourceId]++;
        if (r) r.state = e.state === 'provider_completed' ? 'applied' : e.state === 'interrupted' ? 'interrupted' : 'failed';
      });
    } catch (error) {
      const code = error instanceof ServiceError ? error.code : (error as any)?.kind ?? 'provider_unavailable';
      e = this.state.executions[e.id]; r = input.handoffId ? this.package(input.handoffId) : null;
      this.atomic(() => { e.state = remoteDispatched ? 'unknown' : 'failed'; e.errorCode = code; e.endedAt = now(); if (r) r.state = e.state === 'unknown' ? 'unknown' : 'failed'; });
      this.record('execution/' + e.state, 'inferred');
    } finally { this.active = null; }
    return structuredClone(e);
  }
  async command<K extends keyof CommandMap>(name: K, input: CommandMap[K]['input']): Promise<CommandMap[K]['output']> {
    ensure(!this.closed, 'backend_closed');
    const a: any = input;
    // Reads and interruption remain available during execution. Local mutation
    // is rejected rather than racing source approval and streamed commits.
    if (!['snapshot','replay','interrupt','execute','desktop'].includes(name)) ensure(!this.active, 'execution_busy');
    switch (name) {
      case 'desktop': {
        if (a.type !== 'snapshot') {
          this.atomic(() => this.desktop.apply(a, (title, codex) => this.create(title, codex ? this.port.id : 'mock-ordinary').resourceId));
          this.record('application/' + a.type, 'observed');
        }
        return this.desktop.snapshot(id => {
          if (!this.state.resources[id]) return { provider: 'local', messages: [] };
          const c = this.conv(id), graphId = this.gid(id);
          return { provider: c.kind === 'codex' ? 'codex' : 'local', version: c.revision, messages: this.graph.snapshot().messages.filter(m => m.conversationId === graphId).slice(-200).map(m => ({ id: m.id, role: m.role, content: m.content })) };
        }) as any;
      }
      case 'createConversation': return this.atomic(() => this.once(a.commandId, { name, ...a }, () => this.create(a.title, a.providerId ?? 'mock-ordinary'))) as any;
      case 'addMessage': return this.atomic(() => {
        ensure(this.state.revisions[a.resourceId] === a.expectedRevision, 'stale_resource_version');
        ensure(typeof a.content === 'string' && Buffer.byteLength(a.content) <= 65536, 'invalid_message');
        ensure(!a.sensitivity || ['public','internal','sensitive','restricted'].includes(a.sensitivity), 'invalid_sensitivity');
        const m = this.graph.addMessage(this.gid(a.resourceId), a.role, a.content, { sensitivity: a.sensitivity });
        this.state.revisions[a.resourceId]++; return { ...m, resourceId: a.resourceId, revision: this.state.revisions[a.resourceId] };
      }) as any;
      case 'workspace': return this.atomic(() => { const p = a.projectTitle ? this.kernel.createProject(a.projectTitle) : null; return this.kernel.createWorkspace(a.title, p?.id ?? null); }) as any;
      case 'openWorkspace': return this.kernel.openWorkspace(a.workspaceId) as any;
      case 'place': return this.atomic(() => { this.gid(a.resourceId); return this.kernel.attachBlock(a.workspaceId, a.resourceId, { x: 0, y: 0, width: 320, height: 240, z: 0 }); }) as any;
      case 'move': return this.atomic(() => this.kernel.moveBlock(a.blockId, a.workspaceId, a.expectedVersion)) as any;
      case 'branch': return this.atomic(() => this.once(a.commandId, { name, ...a }, () => {
        ensure(Number.isInteger(a.tokenBudget) && a.tokenBudget > 0 && a.tokenBudget <= 32768, 'invalid_token_budget');
        ensure(Array.isArray(a.includeMessageIds) && a.includeMessageIds.length > 0 && a.includeMessageIds.length <= 100, 'explicit_source_selection_required');
        const sourceId = this.gid(a.resourceId);
        const result = this.graph.branch({ sourceConversationId: sourceId, sourceMessageId: a.messageId, targetKind: a.providerId === 'mock-ordinary' ? 'ordinary' : 'codex', targetProviderId: a.providerId, title: a.title, includeMessageIds: a.includeMessageIds });
        const resource = this.kernel.createConversationRef(a.title);
        this.state.resources[resource.id] = result.conversation.id; this.state.revisions[resource.id] = 1;
        this.kernel.relate(a.resourceId, resource.id, 'application_continuation', 'user');
        const sourceRevision = this.state.revisions[a.resourceId];
        const estimatedTokens = Buffer.byteLength(JSON.stringify(result.handoff.items));
        ensure(estimatedTokens <= a.tokenBudget, 'context_budget_exceeded');
        const fingerprint = hash({ handoff: result.handoff.id, items: result.handoff.items, provider: a.providerId, resourceId: resource.id, sourceRevision, budget: a.tokenBudget });
        const review: HandoffReview = { id: result.handoff.id, resourceId: resource.id, sourceResourceId: a.resourceId, targetProviderId: a.providerId, sourceRevision, fingerprint, estimatedTokens, estimator: 'utf8-bytes-upper-bound', tokenBudget: a.tokenBudget, state: 'prepared', expiresAt: new Date(Date.now() + 3600000).toISOString() };
        this.state.reviews[review.id] = review;
        return { conversation: this.conv(resource.id), handoff: review, context: result.handoff, mode: 'application_continuation' };
      })) as any;
      case 'review': return this.atomic(() => { const r = this.package(a.handoffId); ensure(r.state === 'prepared' || r.state === 'approved', 'handoff_not_reviewable'); ensure(r.fingerprint === a.fingerprint, 'approval_scope_mismatch'); this.validateReview(r); r.state = a.approve === true ? 'approved' : 'rejected'; r.approvedAt = now(); return structuredClone(r); }) as any;
      case 'selectProvider': return this.atomic(() => {
        ensure(this.state.revisions[a.resourceId] === a.expectedRevision, 'stale_resource_version');
        ensure(a.providerId === this.port.id || a.providerId === 'mock-ordinary', 'provider_unavailable');
        ensure(!Object.values(this.state.executions).some(e => e.resourceId === a.resourceId && ['unknown','running','dispatching'].includes(e.state)), 'reconciliation_required');
        const data = this.graph.snapshot(); const c = data.conversations.find(c => c.id === this.gid(a.resourceId))!;
        c.providerId = a.providerId; c.kind = a.providerId === 'mock-ordinary' ? 'ordinary' : 'codex'; c.providerSessionId = null;
        this.graph = new ConversationGraph(this.localAdapters(), data); this.state.revisions[a.resourceId]++; return this.conv(a.resourceId);
      }) as any;
      case 'applyOrdinary': return this.atomic(() => this.once(a.commandId, { name, ...a }, () => {
        const r = this.package(a.handoffId); ensure(r.targetProviderId === 'mock-ordinary', 'invalid_cross_provider_reference'); ensure(r.state === 'approved', 'handoff_not_approved');
        const h = this.validateReview(r); ensure(typeof a.prompt === 'string' && Buffer.byteLength(a.prompt) <= 16384, 'invalid_prompt');
        const response = this.graph.runMock(this.gid(r.resourceId), 'Reviewed synthetic context: ' + h.items.map(i => i.content).join('\n') + '\n' + a.prompt);
        r.state = 'applied'; this.state.revisions[r.resourceId]++; return { ...response, resourceId: r.resourceId, classification: 'simulated' };
      })) as any;
      case 'execute': return this.execute(a) as any;
      case 'interrupt': { const e = this.state.executions[a.executionId]; ensure(e && this.active?.id === e.id && e.binding && e.turnId, 'execution_not_interruptible'); await this.port.interrupt(e.binding.nativeThreadId, e.turnId); return { requested: true, confirmed: false } as any; }
      case 'capabilities': await this.port.connect(); return await this.port.capabilities() as any;
      case 'reconcile': {
        this.gid(a.resourceId); const b = this.state.bindings[a.resourceId]?.[0]; ensure(b, 'provider_thread_unavailable');
        ensure(b.providerId === this.port.id && b.instanceId === this.port.instanceId && b.accountScope === this.port.accountScope, 'invalid_cross_provider_reference');
        try {
          await this.port.connect(); const result = await this.port.read(b.nativeThreadId);
          const thread = result.thread as any; ensure(thread?.id === b.nativeThreadId, 'invalid_provider_response');
          // Thread existence or idle status cannot prove an unknown turn completed.
          this.record('stream/reconciled-thread-exists', 'observed');
          const completed = Object.values(this.state.executions).findLast(e => e.resourceId === a.resourceId && e.state === 'provider_completed' && e.turnId);
          let syntheticTurnReceipt;
          if (completed?.turnId) {
            const page = await this.port.items(b.nativeThreadId, completed.turnId);
            const items = (Array.isArray(page.data) ? page.data : []).map((entry: any) => entry.item).filter(Boolean);
            syntheticTurnReceipt = { completePage: !page.nextCursor, itemTypes: items.map((i: any) => itemType(i.type)), exactMarker: items.filter((i: any) => i.type === 'agentMessage').map((i: any) => String(i.text ?? '')).join('\n').trim() === 'INTEGRATION_OK' };
          }
          return { resourceId: a.resourceId, providerThreadAvailable: true, executionOutcome: 'unchanged', nativeStatus: thread.status?.type ?? 'unknown', syntheticTurnReceipt } as any;
        } catch { this.record('stream/provider-thread-unavailable', 'inferred'); return { resourceId: a.resourceId, providerThreadAvailable: false, executionOutcome: 'unchanged' } as any; }
      }
      case 'snapshot': return { contract: CONTRACT, schemaVersion: 1, conversations: Object.keys(this.state.resources).map(id => this.conv(id)), graph: this.graph.snapshot(), resourceMap: structuredClone(this.state.resources), bindings: structuredClone(this.state.bindings), handoffs: structuredClone(this.state.reviews), executions: structuredClone(this.state.executions), messageEvidence: structuredClone(this.state.messageEvidence), resources: Object.keys(this.state.resources).map(id => this.kernel.getResource(id)), relationships: Object.keys(this.state.resources).flatMap(id => this.kernel.listRelationships(id)) } as any;
      case 'replay': {
        const after = a.after ?? 0, limit = a.limit ?? 100;
        ensure(Number.isSafeInteger(after) && after >= 0 && Number.isInteger(limit) && limit > 0 && limit <= 1000, 'invalid_cursor');
        const events = this.db.prepare('SELECT json FROM intelligence_events WHERE cursor>? ORDER BY cursor LIMIT ?').all(after, limit).map(row => JSON.parse(String(row.json)));
        const earliest = this.db.prepare('SELECT min(cursor) AS value FROM intelligence_events').get()!.value as number | null;
        const latest = Number(this.db.prepare('SELECT latest FROM integration_meta WHERE id=1').get()!.latest);
        return { events, earliest, latest, truncated: earliest !== null && after < earliest - 1 } as any;
      }
      case 'close': this.stopEvents(); this.port.close(); this.kernel.close(); this.closed = true; return null as any;
      default: throw new ServiceError('unsupported_command');
    }
  }
}
