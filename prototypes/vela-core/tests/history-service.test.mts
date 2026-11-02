import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { WorkspaceKernel } from '../../workspace-kernel/kernel.mts';
import { createCanonicalVelaHost } from '../src/canonical-host.mts';
import type { CanonicalVelaContext, CanonicalVelaMetadata } from '../src/canonical-host.mts';
import { VelaService, VELA_PLANNING_INSTRUCTION } from '../src/service.mts';
import { buildCodexPlanningPrompt } from '../src/codex-planning-adapter.mts';
import { createCapabilityCatalog } from '../src/capability-catalog.mts';
import { CAPABILITIES } from '../src/capabilities.ts';
import { HISTORY_LIMITS, historyDigest } from '../src/bounded-history.mts';
import type { AcceptedHistoryAppend, HistoryMessageMetadata, HistorySnapshot, PrivateFrozenProviderContext } from '../src/bounded-history.mts';
import type { ProviderContribution, ProviderReplyKind, VelaMessage, VelaPlanningPort } from '../src/contracts.ts';

/** Real canonical SQLite resource schema and production permission adapter. Graph/evidence callbacks and provider are explicitly synthetic test ports, not native/model acceptance. */
function fixture() {
  const kernel = WorkspaceKernel.open(':memory:'); let db!: DatabaseSync; kernel.withTransaction(value => { db = value; });
  const project = kernel.createProject('History service fixture'), other = kernel.createProject('Excluded fixture project'), workspace = kernel.createWorkspace('History fixture workspace', project.id), note = kernel.createNote('History fixture note', 'Canonical source before review.', project.id);
  db.exec(`CREATE TABLE fixture_conversations(id TEXT PRIMARY KEY,revision INTEGER); CREATE TABLE fixture_messages(id TEXT PRIMARY KEY,conversation_id TEXT,ordinal INTEGER,bytes INTEGER,json TEXT); CREATE TABLE fixture_evidence(id TEXT PRIMARY KEY,json TEXT);`);
  let context: CanonicalVelaContext = { principalId: 'synthetic:owner', policyVersion: 'policy:1', currentProjectId: project.id, currentWorkspaceId: workspace.id, selectedResourceIds: [] };
  let systemId: string | null = null, service!: VelaService, calls = 0, sourceReads = 0, messageReads = 0, snapshots = 0, nativeCalls = 0, bodyReadForbidden = false;
  const deniedContent = new Set<string>(), deniedMetadata = new Set<string>(), deniedMessages = new Set<string>(), submitted: Parameters<VelaPlanningPort['propose']>[0][] = [];
  const revision = (id: string) => { const row = db.prepare('SELECT revision FROM fixture_conversations WHERE id=?').get(id); return row ? Number(row.revision) : null; };
  const metadata = (): CanonicalVelaMetadata => ({ contract: 'aerynth.desktop@1', projects: db.prepare("SELECT id,title,version FROM projects WHERE state='active'").all() as any[], workspaces: db.prepare("SELECT * FROM workspaces WHERE state='active'").all() as any[], blocks: [], navigationBlocks: [], activeWorkspaceId: context.currentWorkspaceId,
    resources: db.prepare('SELECT * FROM resources').all().map(r => ({ ...r, visible: r.state === 'active', available: true, conversationRevision: r.kind === 'conversation' ? revision(String(r.id)) ?? undefined : undefined })) as any[] });
  const host = createCanonicalVelaHost({ db, transaction: work => kernel.withTransaction(work), metadata, currentContext: () => context,
    revisions: { conversation: id => revision(id), workspace: () => 1 }, permissions: {
      scope: (c, m) => ({ principalId: c.principalId, policyVersion: c.policyVersion, projectIds: m.projects.filter(p => p.id === c.currentProjectId).map(p => p.id), workspaceIds: m.workspaces.filter(w => w.project_id === c.currentProjectId).map(w => w.id), resourceIds: m.resources.filter(r => r.id === systemId || r.project_id === c.currentProjectId).map(r => r.id) }),
      metadata: r => !deniedMetadata.has(r.id), content: r => !deniedContent.has(r.id),
      authorize: r => ({ decision: 'allow', authorizationRef: 'synthetic:grant:' + randomUUID(), policyVersion: r.scope.policyVersion }),
    }, conversations: {
      ensure: () => { if (!systemId) { systemId = kernel.createConversationRef('Vela').id; db.prepare('INSERT INTO fixture_conversations VALUES(?,1)').run(systemId); } return systemId; },
      read: id => ({ resourceId: id, revision: revision(id)!, messages: db.prepare('SELECT json FROM fixture_messages WHERE conversation_id=? ORDER BY ordinal').all(id).map(r => JSON.parse(String(r.json))) }),
      append: (id, input) => { const message = { ...input, id: randomUUID() }, ordinal = Number(db.prepare('SELECT coalesce(max(ordinal),0)+1 AS n FROM fixture_messages WHERE conversation_id=?').get(id)!.n);
        db.prepare('INSERT INTO fixture_messages VALUES(?,?,?,?,?)').run(message.id, id, ordinal, Buffer.byteLength(message.content), JSON.stringify(message)); db.prepare('UPDATE fixture_conversations SET revision=revision+1 WHERE id=?').run(id); return message; },
    }, dispatch: { native: () => { nativeCalls++; throw new Error('History must not execute actions'); } } });
  const messageMetadata = (id: string, messageId: string): HistoryMessageMetadata | null => {
    if (deniedMessages.has(messageId)) return null;
    const row = db.prepare("SELECT ordinal,json_extract(json,'$.id') AS id,json_extract(json,'$.requestId') AS requestId,json_extract(json,'$.role') AS role,json_extract(json,'$.source') AS source,json_extract(json,'$.classification') AS classification,json_extract(json,'$.providerId') AS providerId,json_extract(json,'$.responseKind') AS responseKind,json_extract(json,'$.providerContribution') AS providerContribution FROM fixture_messages WHERE conversation_id=? AND id=?").get(id, messageId);
    return row ? { id: String(row.id), conversationId: id, ordinal: Number(row.ordinal), requestId: String(row.requestId), role: row.role as VelaMessage['role'], source: row.source as VelaMessage['source'], classification: row.classification as VelaMessage['classification'], ...(row.providerId ? { providerId: String(row.providerId) } : {}), ...(row.responseKind ? { responseKind: row.responseKind as ProviderReplyKind } : {}), ...(row.providerContribution ? { providerContribution: JSON.parse(String(row.providerContribution)) } : {}) } : null;
  };
  const history: NonNullable<ConstructorParameters<typeof VelaService>[0]['history']> = {
    snapshot: (id, limit): HistorySnapshot => { snapshots++; assert(limit <= HISTORY_LIMITS.lookbackMessages); const rows = db.prepare("SELECT id,ordinal,bytes,json_extract(json,'$.requestId') AS requestId,json_extract(json,'$.role') AS role,json_extract(json,'$.source') AS source FROM fixture_messages WHERE conversation_id=? ORDER BY ordinal DESC LIMIT ?").all(id, limit);
      return { conversationId: id, revision: revision(id)!, hasEarlier: Number(db.prepare('SELECT count(*) AS n FROM fixture_messages WHERE conversation_id=?').get(id)!.n) > rows.length, headers: rows.reverse().map(r => ({ id: String(r.id), requestId: String(r.requestId), role: r.role as VelaMessage['role'], source: r.source as VelaMessage['source'], ordinal: Number(r.ordinal), contentBytes: Number(r.bytes) })) }; },
    message: (id, messageId, maxBytes) => { if (bodyReadForbidden) throw new Error('Body reader forbidden in metadata gate'); messageReads++; if (deniedMessages.has(messageId)) return null; const head = db.prepare('SELECT ordinal,bytes FROM fixture_messages WHERE conversation_id=? AND id=?').get(id, messageId); if (!head) return null; if (Number(head.bytes) > maxBytes) return { overBudget: true }; return { conversationId: id, ordinal: Number(head.ordinal), message: JSON.parse(String(db.prepare('SELECT json FROM fixture_messages WHERE id=?').get(messageId)!.json)) }; },
    content: (ref, maxBytes) => { if (bodyReadForbidden) throw new Error('Body reader forbidden in metadata gate'); sourceReads++; const size = db.prepare('SELECT length(CAST(content AS BLOB)) AS n FROM notes WHERE resource_id=?').get(ref.id); if (!size) return null; if (Number(size.n) > maxBytes) return { overBudget: true }; return host.readContent(ref.id, host.scope()); },
    messageMetadata,
    verifyProviderContribution: c => { const row = c.sourceMessageId && db.prepare('SELECT json FROM fixture_evidence WHERE id=?').get(c.sourceMessageId); return !!row && historyDigest(JSON.parse(String(row.json))) === historyDigest(c); },
  };
  const reply = (content = 'Exact first reported answer.', kind: ProviderReplyKind = 'answer') => { const contribution: ProviderContribution = { providerId: 'synthetic:history-service', classification: 'reported', executionId: randomUUID(), planningConversationId: randomUUID(), sourceMessageId: randomUUID(), nativeThreadId: randomUUID(), nativeTurnId: randomUUID() }; db.prepare('INSERT INTO fixture_evidence VALUES(?,?)').run(contribution.sourceMessageId!, JSON.stringify(contribution)); return { schemaVersion: 2, kind, content, contribution }; };
  let responder = async () => reply();
  const planner: VelaPlanningPort = { providerId: 'synthetic:history-service', availability: () => ({ available: true, busy: false }), propose: async input => { calls++; submitted.push(structuredClone(input)); return responder(); } };
  const makeService = () => new VelaService({ db, transaction: work => kernel.withTransaction(work), host, history, planner }); service = makeService();
  const preview = (includeHistory = true, fits = () => true) => service.previewProviderContext([], { includeHistory, fits });
  const bind = (value: ReturnType<typeof preview>) => {
    const reviewed = structuredClone(value), phases: string[] = []; let acceptedAppend: AcceptedHistoryAppend | undefined;
    const frozen: PrivateFrozenProviderContext = { context: reviewed.context, ...(reviewed.historyFence ? { historyFence: reviewed.historyFence } : {}),
      validate: (phase, append) => { phases.push(phase); assert.deepEqual(append, acceptedAppend); },
      onAcceptedAppend: append => { assert.equal(acceptedAppend, undefined); assert.equal(append.revision, revision(systemId!)); const r = service.historyRequestMetadata(append.requestId)!; assert.equal(r.inputMessageId, append.messageId); assert.equal(r.inputContentDigest, append.contentDigest); acceptedAppend = append; },
    };
    return { frozen, phases, accepted: () => acceptedAppend, metadataGate: () => service.validateProviderHistory(reviewed, { metadataOnly: true, ...(acceptedAppend ? { acceptedAppend } : {}) }) };
  };
  const send = (intent = 'Explain the canonical source.', resourceIds = [note.id], frozen?: PrivateFrozenProviderContext) => service.request({ intent, resourceIds, authorizeProvider: true }, frozen);
  return { kernel, db, host, note, project, other, workspace, history, reply, planner, preview, bind, send, submitted, deniedContent, deniedMetadata, deniedMessages,
    service: () => service, reopen: () => { service = makeService(); return service; }, counts: () => ({ calls, snapshots, messageReads, sourceReads, nativeCalls }),
    respond: (value: () => Promise<ReturnType<typeof reply>>) => { responder = value; }, forbidBodyReads: (v: boolean) => { bodyReadForbidden = v; },
    changeContext: (value: Partial<CanonicalVelaContext>) => { context = { ...context, ...value }; }, close: () => kernel.close() };
}

test('read-only history preview never opens Vela or reads implicit messages when disabled', async () => {
  const f = fixture(); try {
    const changes = f.db.prepare('SELECT total_changes() AS n').get()!.n;
    assert.equal(f.preview().historyOmissions[0].reason, 'no-conversation'); assert.equal(f.db.prepare('SELECT total_changes() AS n').get()!.n, changes); assert.equal(f.service().state().conversation, null);
    await f.send(); const before = f.counts(), off = f.preview(false); assert.equal(off.context.history, undefined); assert.equal(off.historyOmissions[0].reason, 'disabled'); assert.deepEqual(f.counts(), before);
    assert.equal(f.submitted[0].context.history, undefined); assert.equal(f.counts().nativeCalls, 0);
  } finally { f.close(); }
});

test('unavailable bounded metadata scan preserves the existing conversation and reports unavailable history', async () => {
  const f = fixture(); try {
    assert.equal(f.preview().historyOmissions[0].reason, 'no-conversation');
    await f.send(); const before = f.service().state(), counts = f.counts(), changes = f.db.prepare('SELECT total_changes() AS n').get()!.n;
    f.history.snapshot = () => null;
    const preview = f.preview(); assert.equal(preview.context.history, undefined); assert.equal(preview.historyFence, undefined); assert.deepEqual(preview.historyOmissions, [{ reason: 'message-unavailable' }]);
    assert.equal(preview.origin.navigation.kind, 'known'); assert.deepEqual(f.service().state(), before); assert.deepEqual(f.counts(), counts); assert.equal(f.db.prepare('SELECT total_changes() AS n').get()!.n, changes);
  } finally { f.close(); }
});

test('frozen service context keeps exact reviewed messages through its sole canonical append and persists only reference proofs', async () => {
  const f = fixture(); try {
    const first = await f.send(), preview = f.preview(), binding = f.bind(preview); assert.equal(preview.context.history!.messages.length, 2);
    const reviewed = structuredClone(preview.context.history), request = await f.send('Clarify that answer.', [], binding.frozen);
    assert.equal(request.state, 'responded'); assert.deepEqual(f.submitted[1].context.history, reviewed); assert.equal(f.submitted[1].instruction, VELA_PLANNING_INSTRUCTION); assert.deepEqual(binding.phases, ['before-append', 'before-provider', 'before-response']);
    assert.equal(request.context.history, undefined); assert.equal(request.history!.messages.length, 2); assert.equal(request.history!.historyDigest, historyDigest(reviewed)); assert.equal(request.response!.contentDigest, historyDigest('Exact first reported answer.'));
    assert(request.provenance!.dependencies.some(d => d.kind === 'message' && d.requestId === first.id));
    const metadata = f.service().historyRequestMetadata(request.id)!; assert(!('intent' in metadata)); assert(!JSON.stringify(metadata).includes('Canonical source before review.')); assert(!JSON.stringify(metadata).includes('Exact first reported answer.'));
    const stored = JSON.parse(String(f.db.prepare('SELECT json FROM vela_state').get()!.json)); assert.equal(stored.schemaVersion, 3); assert.equal(stored.requests[1].context.history, undefined); assert(!JSON.stringify(stored).includes('Exact first reported answer.'));
    const before = f.service().state(); assert.deepEqual(f.reopen().state(), before); assert.equal(f.counts().calls, 2); assert.equal(f.counts().nativeCalls, 0);
    assert.equal(f.preview().context.history!.messages.length, 4);
  } finally { f.close(); }
});

test('metadata catalog validation during a pending turn performs no source/message reads and forbids extra canonical appends', async () => {
  const f = fixture(); let resolve!: (v: ReturnType<typeof f.reply>) => void;
  try {
    await f.send(); const selected = f.preview(), binding = f.bind(selected); f.respond(() => new Promise(done => { resolve = done; }));
    const pending = f.send('Continue exactly once.', [], binding.frozen), before = f.counts(); f.forbidBodyReads(true); binding.metadataGate(); assert.deepEqual(f.counts(), before); f.forbidBodyReads(false);
    f.host.appendMessage(f.service().state().conversation!.resourceId, { role: 'user', source: 'user', content: 'Another real append', classification: 'observed' });
    assert.throws(() => binding.metadataGate(), /stale-history-revision/); resolve(f.reply('Must not be appended.')); const request = await pending; assert.equal(request.state, 'invalid-plan'); assert.equal(request.response, undefined); assert(!f.service().state().conversation!.messages.some(m => m.content === 'Must not be appended.'));
  } finally { f.close(); }
});

test('revoked or changed upstream context and scope reject the frozen request before append or after provider return', async () => {
  for (const phase of ['before', 'after'] as const) for (const change of ['permission', 'source', 'scope', 'policy'] as const) {
    const f = fixture(); let resolve!: (v: ReturnType<typeof f.reply>) => void;
    try {
      await f.send(); const preview = f.preview(), binding = f.bind(preview), count = f.counts().calls, messages = f.service().state().conversation!.messages.length;
      const mutate = () => { if (change === 'permission') f.deniedContent.add(f.note.id); else if (change === 'source') f.kernel.updateNote(f.note.id, 'Changed source', 1); else if (change === 'scope') f.changeContext({ currentProjectId: f.other.id, currentWorkspaceId: null }); else f.changeContext({ policyVersion: 'policy:2' }); };
      if (phase === 'before') { mutate(); await assert.rejects(f.send('A new request.', [], binding.frozen)); assert.equal(f.counts().calls, count); assert.equal(f.service().state().conversation!.messages.length, messages); }
      else { f.respond(() => new Promise(done => { resolve = done; })); const pending = f.send('A new request.', [], binding.frozen); mutate(); resolve(f.reply('Unsafe derived response')); const r = await pending; assert.equal(r.state, 'invalid-plan'); assert.equal(r.response, undefined); assert(!f.service().state().conversation!.messages.some(m => m.content === 'Unsafe derived response')); }
    } finally { f.close(); }
  }
});

test('cancellation retains truthful state and cannot append a late source-derived reply or replay on restart', async () => {
  const f = fixture(); let resolve!: (v: ReturnType<typeof f.reply>) => void;
  try {
    await f.send(); const selected = f.preview(), binding = f.bind(selected); f.respond(() => new Promise(done => { resolve = done; })); const pending = f.send('Cancel this follow-up.', [], binding.frozen);
    const requestId = binding.accepted()!.requestId; f.service().cancel(requestId); resolve(f.reply('Late cancelled answer')); assert.equal((await pending).state, 'cancelled');
    assert(!f.service().state().conversation!.messages.some(m => m.content === 'Late cancelled answer')); assert.equal(f.reopen().state().requests.at(-1)!.state, 'cancelled'); assert.equal(f.counts().calls, 2);
  } finally { f.close(); }
});

test('schema1/2 migrations preserve exact old history and leave legacy origin unproven; unknown versions fail closed', async () => {
  for (const version of [1, 2]) {
    const f = fixture(); try {
      await f.send(); const stored = JSON.parse(String(f.db.prepare('SELECT json FROM vela_state').get()!.json)); stored.schemaVersion = version;
      for (const r of stored.requests) { delete r.origin; delete r.provenance; delete r.inputMessageId; delete r.inputContentDigest; delete r.response.contentDigest; }
      const oldRequests = structuredClone(stored.requests), messages = f.service().state().conversation;
      f.db.prepare('UPDATE vela_state SET schema_version=?,json=?').run(version, JSON.stringify(stored)); const reopened = f.reopen(); assert.deepEqual(reopened.state().requests, oldRequests); assert.deepEqual(reopened.state().conversation, messages); assert.equal(f.preview().historyOmissions[0].reason, 'unknown-origin');
      assert.equal(f.db.prepare('SELECT schema_version FROM vela_state').get()!.schema_version, 3); assert.equal(f.counts().calls, 1);
      stored.schemaVersion = 4; f.db.prepare('UPDATE vela_state SET schema_version=4,json=?').run(JSON.stringify(stored)); assert.throws(() => f.reopen(), /unsupported_vela_schema/);
    } finally { f.close(); }
  }
});

test('actual semantic formatter packs whole canonical history under the fixed ceiling with full and discovered catalogs', async t => {
  const f = fixture(); try {
    await f.send('Question first.'); await f.send('Question second.'); const catalog = createCapabilityCatalog(CAPABILITIES);
    const measure = (discovery: boolean) => { let prompt = ''; const selected = f.service().previewProviderContext([f.note.id], { includeHistory: true, fits: context => { try { prompt = buildCodexPlanningPrompt({ intent: 'Continue our earlier discussion.', instruction: VELA_PLANNING_INSTRUCTION, context, capabilities: CAPABILITIES }, discovery ? { projection: catalog.projection, declaration: catalog.declaration } : undefined); return true; } catch (error) { if ((error as { code?: string }).code === 'planning_prompt_capacity_exceeded') return false; throw error; } } });
      const build = (context: typeof selected.context) => buildCodexPlanningPrompt({ intent: 'Continue our earlier discussion.', instruction: VELA_PLANNING_INSTRUCTION, context, capabilities: CAPABILITIES }, discovery ? { projection: catalog.projection, declaration: catalog.declaration } : undefined);
      prompt = build(selected.context); const { history: _history, ...base } = selected.context;
      return { mode: discovery ? 'same-turn-catalog-metadata' : 'full-catalog-fallback', basePromptBytes: Buffer.byteLength(build(base)), sourceContentBytes: base.contentBytes, wholeMessages: selected.context.history?.messages.length ?? 0, promptBytes: Buffer.byteLength(prompt), historyBytes: selected.context.history ? Buffer.byteLength(JSON.stringify(selected.context.history)) : 0, omitted: selected.historyOmissions.map(o => o.reason) }; };
    const fallback = measure(false), discovery = measure(true); assert(fallback.promptBytes <= 16384); assert(discovery.promptBytes <= 16384); assert(discovery.wholeMessages > 0); assert.equal(f.counts().calls, 2);
    t.diagnostic(JSON.stringify({ evidence: 'synthetic-canonical-service-and-actual-semantic-formatter', fallback, discovery, ceiling: 16384, providerCallsDuringPreview: 0 }));
  } finally { f.close(); }
});

test('denied Vela conversation never exposes history headers or materializes bodies during preview', async () => {
  const f = fixture(); try {
    await f.send(); const id = f.service().state().conversation!.resourceId, before = f.counts(); f.deniedContent.add(id);
    const preview = f.preview(); assert.equal(preview.context.history, undefined); assert.equal(preview.historyOmissions[0].reason, 'message-unavailable'); assert.deepEqual(f.counts(), before);
    assert.equal(f.service().historyRequestMetadata(f.submitted[0].requestId), null);
  } finally { f.close(); }
});

test('failed accepted-append binding rolls canonical message, revision and schema3 proof metadata back together', async () => {
  const f = fixture(); try {
    await f.send(); const preview = f.preview(), before = f.service().state(), revision = f.host.conversationRevision!(before.conversation!.resourceId), binding = f.bind(preview);
    binding.frozen.onAcceptedAppend = () => { throw new Error('Synthetic private grant bind failed'); };
    await assert.rejects(f.send('Must roll back.', [], binding.frozen), /grant bind failed/); assert.deepEqual(f.service().state(), before); assert.equal(f.host.conversationRevision!(before.conversation!.resourceId), revision); assert.equal(f.counts().calls, 1);
    assert.deepEqual(f.reopen().state(), before);
  } finally { f.close(); }
});

test('the service clones reviewed history and a pending request restarts as unknown with proofs but no replayed provider call', async () => {
  const f = fixture(); let resolve!: (v: ReturnType<typeof f.reply>) => void;
  try {
    await f.send(); const preview = f.preview(), binding = f.bind(preview), reviewed = structuredClone(binding.frozen.context.history); f.respond(() => new Promise(done => { resolve = done; }));
    const pending = f.send('A pending follow-up.', [], binding.frozen);
    (binding.frozen.context.history!.messages[0] as { content: string }).content = 'Mutable caller replacement'; assert.deepEqual(f.submitted[1].context.history, reviewed);
    const restarted = f.reopen().state().requests.at(-1)!; assert.equal(restarted.state, 'unknown'); assert.equal(restarted.errorCode, 'restart_planning_outcome_unknown'); assert(restarted.provenance); assert(restarted.history); assert.equal(restarted.context.history, undefined); assert.equal(f.counts().calls, 2);
    // The old service is a stale writer and cannot overwrite the restart outcome when the old synthetic port returns.
    resolve(f.reply('Late old-process result')); await assert.rejects(pending, /concurrent_vela_writer/); assert.equal(f.service().state().requests.at(-1)!.state, 'unknown'); assert(!f.service().state().conversation!.messages.some(m => m.content === 'Late old-process result'));
  } finally { f.close(); }
});
