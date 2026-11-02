import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { WorkspaceKernel } from '../../workspace-kernel/kernel.mts';
import { createCanonicalVelaHost } from '../src/canonical-host.mts';
import type { CanonicalVelaContext, CanonicalVelaMetadata } from '../src/canonical-host.mts';
import type { ContextManifest, ProviderContribution, VelaMessage } from '../src/contracts.ts';
import { buildCodexPlanningPrompt } from '../src/codex-planning-adapter.mts';
import { CAPABILITIES } from '../src/capabilities.ts';
import { HISTORY_LIMITS, createHistoryProvenance, historyDependenciesFromContext, historyDigest, selectBoundedHistory, unionHistoryDependencies, validateFrozenHistory } from '../src/bounded-history.mts';
import type { AcceptedHistoryAppend, HistoryDependency, HistoryOrigin, HistoryProofReader, HistoryRequestRecord, HistorySelection, HistorySnapshot, ProviderHistory } from '../src/bounded-history.mts';

/** Actual kernel schema + canonical policy host on ONE SQLite connection. Canonical graph/request/evidence callback projections below are explicit test fixtures, not model/native qualification or a production history store. */
function fixture() {
  const kernel = WorkspaceKernel.open(':memory:'); let db!: DatabaseSync; kernel.withTransaction(value => { db = value; });
  const project = kernel.createProject('Synthetic history project'), other = kernel.createProject('Other synthetic project'), workspace = kernel.createWorkspace('Synthetic history workspace', project.id);
  const note = kernel.createNote('Authorized history source', 'Exact original canonical source.', project.id), privateNote = kernel.createNote('Foreign source', 'Excluded source text.', other.id), vela = kernel.createConversationRef('Vela canonical fixture');
  db.exec(`CREATE TABLE test_history_conversations(id TEXT PRIMARY KEY,revision INTEGER);CREATE TABLE test_history_messages(id TEXT PRIMARY KEY,conversation_id TEXT,ordinal INTEGER,request_id TEXT,role TEXT,source TEXT,content_bytes INTEGER,json TEXT);
    CREATE TABLE test_history_requests(id TEXT PRIMARY KEY,json TEXT);CREATE TABLE test_history_evidence(id TEXT PRIMARY KEY,json TEXT);`);
  db.prepare('INSERT INTO test_history_conversations VALUES(?,1)').run(vela.id);
  let context: CanonicalVelaContext = { principalId: 'synthetic:owner', policyVersion: 'policy:1', currentProjectId: project.id, currentWorkspaceId: workspace.id, selectedResourceIds: [] };
  const deniedMetadata = new Set<string>(), deniedContent = new Set<string>(), deniedMessages = new Set<string>(); let messageReads = 0, sourceReads = 0, evidenceChecks = 0;
  const revision = () => Number(db.prepare('SELECT revision FROM test_history_conversations WHERE id=?').get(vela.id)!.revision);
  const metadata = (): CanonicalVelaMetadata => ({ contract: 'aerynth.desktop@1', projects: db.prepare("SELECT id,title,version FROM projects WHERE state='active'").all() as any[], workspaces: db.prepare("SELECT * FROM workspaces WHERE state='active'").all() as any[], blocks: [], navigationBlocks: [], activeWorkspaceId: context.currentWorkspaceId,
    resources: db.prepare('SELECT * FROM resources').all().map(r => ({ ...r, visible: r.state === 'active', available: r.state === 'active', ...(r.id === vela.id ? { conversationRevision: revision() } : {}) })) as any[] });
  const host = createCanonicalVelaHost({ db, transaction: work => kernel.withTransaction(work), metadata, currentContext: () => context,
    permissions: { scope: (c, m) => ({ principalId: c.principalId, policyVersion: c.policyVersion, projectIds: m.projects.filter(p => c.currentProjectId === null || p.id === c.currentProjectId).map(p => p.id), workspaceIds: m.workspaces.filter(w => c.currentProjectId === null || w.project_id === c.currentProjectId).map(w => w.id), resourceIds: m.resources.filter(r => r.id === vela.id || c.currentProjectId === null || r.project_id === c.currentProjectId).map(r => r.id) }), metadata: r => !deniedMetadata.has(r.id), content: r => !deniedContent.has(r.id), authorize: r => ({ decision: 'deny', reason: 'History tests never authorize application effects', policyVersion: r.scope.policyVersion }) },
    revisions: { conversation: id => id === vela.id ? revision() : null, workspace: () => 1 }, maxContentBytes: 32768,
    conversations: { ensure: () => vela.id, read: id => ({ resourceId: id, revision: revision(), messages: db.prepare('SELECT json FROM test_history_messages WHERE conversation_id=? ORDER BY ordinal').all(id).map(r => JSON.parse(String(r.json))) }), append: () => { throw new Error('History selection cannot append'); } }, dispatch: { native: () => { throw new Error('History selection cannot execute'); } } });
  const origin = (): HistoryOrigin => { const c = host.context(); return { principalId: c.principalId, policyVersion: c.policyVersion, navigation: { kind: 'known', projectId: c.currentProjectId, workspaceId: c.currentWorkspaceId } }; };
  const request = (id: string): HistoryRequestRecord | null => { const row = db.prepare('SELECT json FROM test_history_requests WHERE id=?').get(id); return row ? JSON.parse(String(row.json)) : null; };
  const saveRequest = (r: HistoryRequestRecord) => db.prepare('INSERT INTO test_history_requests VALUES(?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').run(r.id, JSON.stringify(r));
  const reader: HistoryProofReader = {
    request,
    message: (conversationId, messageId, maxBytes) => { messageReads++; const ref = host.resolve({ id: conversationId, kind: 'resource' }, host.scope()); if (!ref || deniedContent.has(conversationId) || deniedMessages.has(messageId)) return null;
      const head = db.prepare('SELECT ordinal,content_bytes FROM test_history_messages WHERE conversation_id=? AND id=?').get(conversationId, messageId); if (!head) return null; if (Number(head.content_bytes) > maxBytes) return { overBudget: true };
      return { conversationId, ordinal: Number(head.ordinal), message: JSON.parse(String(db.prepare('SELECT json FROM test_history_messages WHERE id=?').get(messageId)!.json)) }; },
    resolve: ref => host.resolve(ref, host.scope()),
    content: (ref, maxBytes) => { sourceReads++; const allowed = host.resolve(ref, host.scope()); if (!allowed || deniedContent.has(ref.id)) return null; const size = db.prepare('SELECT length(CAST(content AS BLOB)) AS bytes FROM notes WHERE resource_id=?').get(ref.id); if (size && Number(size.bytes) > maxBytes) return { overBudget: true }; return host.readContent(ref.id, host.scope()); },
    verifyProviderContribution: c => { evidenceChecks++; const row = c.sourceMessageId && db.prepare('SELECT json FROM test_history_evidence WHERE id=?').get(c.sourceMessageId); return !!row && historyDigest(JSON.parse(String(row.json))) === historyDigest(c); },
  };
  const snapshot = (): HistorySnapshot => { const rows = db.prepare('SELECT id,ordinal,request_id,role,source,content_bytes FROM test_history_messages WHERE conversation_id=? ORDER BY ordinal DESC LIMIT ?').all(vela.id, HISTORY_LIMITS.lookbackMessages); return { conversationId: vela.id, revision: revision(), headers: rows.reverse().map(r => ({ id: String(r.id), ordinal: Number(r.ordinal), requestId: String(r.request_id), role: r.role as VelaMessage['role'], source: r.source as VelaMessage['source'], contentBytes: Number(r.content_bytes) })), hasEarlier: Number(db.prepare('SELECT count(*) AS n FROM test_history_messages').get()!.n) > rows.length }; };
  const append = (message: VelaMessage) => { const ordinal = Number(db.prepare('SELECT coalesce(max(ordinal),0)+1 AS n FROM test_history_messages').get()!.n); db.prepare('INSERT INTO test_history_messages VALUES(?,?,?,?,?,?,?,?)').run(message.id, vela.id, ordinal, message.requestId!, message.role, message.source, Buffer.byteLength(message.content), JSON.stringify(message)); db.prepare('UPDATE test_history_conversations SET revision=revision+1 WHERE id=?').run(vela.id); return ordinal; };
  const sourceManifest = (ids: string[]): ContextManifest => { const scope = host.scope(), included = ids.map(id => { const value = host.readContent(id, scope)!; return { ...value.ref, content: value.content, source: value.source, contentDigest: historyDigest(value.content), reason: 'explicit' as const, trust: 'untrusted-source-data' as const }; }); const discovered = included.map(({ id, kind, title, version, resourceKind, projectId, state }) => ({ id, kind, title, version, ...(resourceKind ? { resourceKind } : {}), ...(projectId !== undefined ? { projectId } : {}), ...(state ? { state } : {}) }));
    for (const [id, kind] of [[context.currentProjectId, 'project'], [context.currentWorkspaceId, 'workspace']] as const) if (id) discovered.push(host.resolve({ id, kind }, scope)!);
    return { id: randomUUID(), createdAt: '2026-11-02T08:40:00Z', policyVersion: scope.policyVersion, discovered, included, omitted: [], contentBytes: included.reduce((n, entry) => n + Buffer.byteLength(entry.content), 0), coverage: 'explicit-resources-only' }; };
  function turn(options: { question?: string; answer?: string; sourceIds?: string[]; dependencies?: readonly HistoryDependency[]; legacy?: boolean } = {}) {
    return kernel.withTransaction(() => { const id = randomUUID(), inputId = randomUUID(), outputId = randomUUID(), intent = options.question ?? 'Explain the selected canonical source.', answer = options.answer ?? 'Exact synthetic reported response, without any application effect.';
      const contribution: ProviderContribution = { providerId: 'synthetic:history-provider', classification: 'reported', executionId: randomUUID(), planningConversationId: randomUUID(), sourceMessageId: randomUUID(), nativeThreadId: randomUUID(), nativeTurnId: randomUUID() };
      db.prepare('INSERT INTO test_history_evidence VALUES(?,?)').run(contribution.sourceMessageId!, JSON.stringify(contribution));
      const sources = historyDependenciesFromContext(sourceManifest(options.sourceIds ?? [note.id]), vela.id), r: HistoryRequestRecord = { id, conversationId: vela.id, intent, state: 'responded', providerId: contribution.providerId, origin: origin(), inputMessageId: inputId, response: { kind: 'answer', messageId: outputId, contentDigest: historyDigest(answer) }, sourcePolicyVersion: context.policyVersion, sourceDependencies: sources };
      r.provenance = createHistoryProvenance({ requestId: id, conversationId: vela.id, origin: r.origin!, inputMessageId: inputId, intent, dependencies: unionHistoryDependencies(sources, options.dependencies ?? []) }); if (options.legacy) { delete r.origin; delete r.provenance; delete r.inputMessageId; delete r.response!.contentDigest; } saveRequest(r);
      const input: VelaMessage = { id: inputId, role: 'user', content: intent, source: 'user', classification: 'observed', requestId: id }, output: VelaMessage = { id: outputId, role: 'assistant', content: answer, source: 'provider', classification: 'reported', requestId: id, providerId: contribution.providerId, responseKind: 'answer', providerContribution: contribution }; append(input); append(output); return { request: r, input, output }; });
  }
  const select = (patch: Partial<Parameters<typeof selectBoundedHistory>[0]> = {}) => kernel.withTransaction(() => selectBoundedHistory({ enabled: true, origin: origin(), snapshot: snapshot(), reader, fits: () => true, ...patch }));
  const frozen = (selection: HistorySelection, acceptedAppend?: AcceptedHistoryAppend) => kernel.withTransaction(() => validateFrozenHistory({ fence: selection.fence!, history: selection.history!, origin: origin(), reader, current: { conversationId: vela.id, revision: revision() }, ...(acceptedAppend ? { acceptedAppend } : {}) }));
  const pending = (selection: HistorySelection, intent = 'The exact new initiating request'): AcceptedHistoryAppend => kernel.withTransaction(() => { const id = randomUUID(), inputId = randomUUID(), r: HistoryRequestRecord = { id, conversationId: vela.id, intent, state: 'planning', providerId: 'synthetic:history-provider', origin: origin(), inputMessageId: inputId, sourcePolicyVersion: context.policyVersion, sourceDependencies: [] }; r.provenance = createHistoryProvenance({ requestId: id, conversationId: vela.id, origin: r.origin!, inputMessageId: inputId, intent, dependencies: selection.fence!.dependencies }); saveRequest(r); append({ id: inputId, role: 'user', source: 'user', classification: 'observed', requestId: id, content: intent }); return { requestId: id, messageId: inputId, contentDigest: historyDigest(intent), revision: revision() }; });
  const editMessage = (id: string, patch: Partial<VelaMessage>, bump = true) => { const value: VelaMessage = JSON.parse(String(db.prepare('SELECT json FROM test_history_messages WHERE id=?').get(id)!.json)); Object.assign(value, patch); db.prepare('UPDATE test_history_messages SET json=?,content_bytes=? WHERE id=?').run(JSON.stringify(value), Buffer.byteLength(value.content), id); if (bump) db.prepare('UPDATE test_history_conversations SET revision=revision+1 WHERE id=?').run(vela.id); };
  return { kernel, db, host, project, other, workspace, note, privateNote, vela, origin, reader, snapshot, revision, turn, select, frozen, pending, editMessage, request, saveRequest, deniedMetadata, deniedContent, deniedMessages,
    changeContext: (patch: Partial<CanonicalVelaContext>) => { context = { ...context, ...patch }; }, counts: () => ({ messageReads, sourceReads, evidenceChecks }), close: () => kernel.close() };
}

test('whole canonical pairs retain exact content/citations and source identity with read-only SQLite authorization', () => {
  const f = fixture(); try { const one = f.turn(), first = f.select(), two = f.turn({ question: 'What about the first option?', answer: 'Exact second reported answer: “✓”\nNo change was applied.', dependencies: first.fence!.dependencies });
    const changes = f.db.prepare('SELECT total_changes() AS n').get()!.n, selected = f.select(); assert.equal(f.db.prepare('SELECT total_changes() AS n').get()!.n, changes);
    assert.deepEqual(selected.history!.messages.map(m => m.id), [one.input.id, one.output.id, two.input.id, two.output.id]); assert.equal(selected.history!.messages.at(-1)!.content, two.output.content); assert.equal(selected.history!.messages.at(-1)!.providerId, 'synthetic:history-provider'); assert.equal(selected.history!.messages.at(-1)!.classification, 'reported'); assert.equal(selected.fence!.baseRevision, f.revision()); assert.equal(f.frozen(selected).valid, true);
    assert(!JSON.stringify(selected.history).includes(f.note.id), 'Host-only proof references are not accidentally exported as history'); assert(!JSON.stringify(selected.history).includes('dependencies')); assert(selected.validationBytes > 0);
  } finally { f.close(); }
});

test('legacy/unknown origins never become known-null; cross-project history is omitted before reading bodies', () => {
  const legacy = fixture(); try { legacy.turn({ legacy: true }); const before = legacy.counts(), selected = legacy.select(); assert.equal(selected.history, undefined); assert.equal(selected.omissions[0].reason, 'unknown-origin'); assert.deepEqual(legacy.counts(), before); } finally { legacy.close(); }
  const f = fixture(); try { const turn = f.turn(), before = f.counts(); f.changeContext({ currentProjectId: f.other.id, currentWorkspaceId: null }); const selected = f.select(); assert.equal(selected.history, undefined); assert.equal(selected.omissions[0].reason, 'scope-mismatch'); assert.deepEqual(f.counts(), before); assert(selected.omissions[0].messageIds!.includes(turn.output.id));
    f.changeContext({ currentProjectId: null, currentWorkspaceId: null }); const unknown: HistoryOrigin = { principalId: 'synthetic:owner', policyVersion: 'policy:1', navigation: { kind: 'unknown' } }; assert.equal(f.select({ origin: unknown }).omissions[0].reason, 'unknown-origin'); assert.equal(f.select().omissions[0].reason, 'scope-mismatch');
  } finally { f.close(); }
  const knownNull = fixture(); try { knownNull.changeContext({ currentProjectId: null, currentWorkspaceId: null }); knownNull.turn(); assert.equal(knownNull.select().history!.messages.length, 2, 'Explicit known-null origin remains usable within the same actual scope'); } finally { knownNull.close(); }
});

test('revoked metadata/content, changed source versions and unsafe same-version content writes omit the whole pair', () => {
  for (const mutate of [(f: ReturnType<typeof fixture>) => f.deniedMetadata.add(f.note.id), (f: ReturnType<typeof fixture>) => f.deniedContent.add(f.note.id), (f: ReturnType<typeof fixture>) => f.kernel.updateNote(f.note.id, 'Changed canonical note', 1), (f: ReturnType<typeof fixture>) => f.db.prepare("UPDATE notes SET content='Changed without a revision' WHERE resource_id=?").run(f.note.id)]) {
    const f = fixture(); try { const turn = f.turn(); mutate(f); const result = f.select(); assert.equal(result.history, undefined); assert(result.omissions.some(o => o.messageIds?.includes(turn.output.id))); assert.equal(f.counts().messageReads, 0, 'Upstream resource checks precede conversation body materialization'); } finally { f.close(); }
  }
});

test('transitive source and canonical-message proofs prevent answer-to-answer laundering after revocation, edit or redaction', () => {
  for (const mutation of ['source', 'upstream-message', 'redaction'] as const) {
    const f = fixture(); try { const one = f.turn(), earlier = f.select(), two = f.turn({ sourceIds: [], dependencies: earlier.fence!.dependencies }); assert.equal(f.select().history!.messages.length, 4);
      if (mutation === 'source') f.deniedContent.add(f.note.id); else if (mutation === 'redaction') f.deniedMessages.add(one.output.id); else f.editMessage(one.output.id, { content: 'Revised upstream answer' }, false);
      const before = f.counts().messageReads, selected = f.select(); assert.equal(selected.history, undefined); assert(selected.omissions.some(o => o.messageIds?.includes(two.output.id))); if (mutation === 'source') assert.equal(f.counts().messageReads, before, 'Flattened resource gates run before materializing derived history');
    } finally { f.close(); }
  }
});

test('a recomputed but incomplete transitive proof cannot drop an upstream source', () => {
  const f = fixture(); try { f.turn(); const earlier = f.select(), two = f.turn({ sourceIds: [], dependencies: earlier.fence!.dependencies }), record = f.request(two.request.id)!;
    const incomplete = unionHistoryDependencies(record.sourceDependencies, earlier.fence!.dependencies.filter(dep => dep.kind === 'message')); record.provenance = createHistoryProvenance({ requestId: record.id, conversationId: record.conversationId, origin: record.origin!, inputMessageId: record.inputMessageId!, intent: record.intent, dependencies: incomplete }); f.saveRequest(record);
    const selected = f.select(); assert.equal(selected.history, undefined); assert.equal(selected.omissions[0].reason, 'incomplete-proof');
  } finally { f.close(); }
});

test('modified accepted bodies or spoofed provider evidence cannot qualify as prior assistant history', () => {
  for (const mutation of ['content', 'provider', 'evidence'] as const) {
    const f = fixture(); try { const turn = f.turn(); if (mutation === 'content') f.editMessage(turn.output.id, { content: 'Changed accepted answer' }); else if (mutation === 'provider') f.editMessage(turn.output.id, { providerId: 'impersonated' }); else f.db.prepare('DELETE FROM test_history_evidence').run(); const selected = f.select(); assert.equal(selected.history, undefined); assert(['message-changed', 'provider-evidence'].includes(selected.omissions[0].reason)); } finally { f.close(); }
  }
});

test('whole-pair history and full-prompt byte limits omit rather than truncate, and preserve native-catalog fallback ceiling', t => {
  const f = fixture(); try { f.turn(); f.turn(); f.turn(); const four = f.select(); assert.equal(four.history!.messages.length, 4); assert(four.omissions.some(o => o.reason === 'message-limit')); assert.equal(f.select({ maxMessages: 3 }).history!.messages.length, 2); assert.equal(f.select({ maxEncodedBytes: 1 }).history, undefined); assert.equal(f.select({ fits: history => !history || history.messages.length <= 2 }).history!.messages.length, 2); assert.throws(() => f.select({ fits: () => false }), /base-prompt-capacity/); assert.throws(() => f.select({ maxMessages: 5 }), /invalid-history-limits/);
  } finally { f.close(); }
  const budget = fixture(); try { budget.turn({ question: 'q'.repeat(260), answer: 'a'.repeat(260), sourceIds: [] }); budget.turn({ question: 'r'.repeat(260), answer: 'b'.repeat(260), sourceIds: [] });
    const context: ContextManifest = { id: randomUUID(), createdAt: '2026-11-02T08:40:00Z', policyVersion: 'policy:1', discovered: [], included: [], omitted: [], contentBytes: 0, coverage: 'explicit-resources-only' };
    const prompt = (history?: ProviderHistory) => buildCodexPlanningPrompt({ intent: 'Clarify the first option.', context: { ...context, ...(history ? { history } : {}) }, instruction: 'Keep provider identity, source provenance and permission boundaries intact. '.repeat(9), capabilities: CAPABILITIES });
    const selected = budget.select({ fits: history => { try { return Buffer.byteLength(prompt(history)) <= 16384; } catch (error) { if ((error as { code?: string }).code === 'planning_prompt_capacity_exceeded') return false; throw error; } } });
    const promptBytes = Buffer.byteLength(prompt(selected.history)); assert.equal(selected.history!.messages.length, 2); assert(selected.omissions.some(o => o.reason === 'prompt-byte-limit')); assert(promptBytes <= 16384); assert.equal(selected.history!.messages[0].content.length, 260);
    t.diagnostic(JSON.stringify({ evidence: 'synthetic-current-full-catalog-formatter-only', capabilities: CAPABILITIES.length, promptBytes, ceiling: 16384, wholeMessages: selected.history!.messages.length, historyEncodedBytes: Buffer.byteLength(JSON.stringify(selected.history)), providerCalls: 0 }));
  } finally { budget.close(); }
});

test('frozen preview permits only the recorded initiating append and never reselects around an unrelated latest message', () => {
  const f = fixture(); try { f.turn(); const selected = f.select(); assert.equal(f.frozen(selected).valid, true); const append = f.pending(selected); assert.equal(f.frozen(selected, append).valid, true); assert.equal(f.select().history, undefined, 'Reselection would see a pending turn, so dispatch must use the frozen window');
    assert.throws(() => f.frozen(selected), /stale-history-revision/); assert.throws(() => f.frozen(selected, { ...append, contentDigest: historyDigest('Wrong accepted text') }), /invalid-history-append/);
    const unrelated = f.pending(selected, 'Unrelated appended message'); assert.throws(() => f.frozen(selected, append), /stale-history-revision/); assert.throws(() => f.frozen(selected, unrelated), /invalid-history-append/);
  } finally { f.close(); }
});

test('frozen proof rejects changed payload, permissions, origin and same-revision upstream body edits', () => {
  for (const change of ['payload', 'permission', 'origin', 'message'] as const) {
    const f = fixture(); try { const turn = f.turn(), selected = f.select(); if (change === 'payload') (selected.history!.messages[0] as { content: string }).content = 'Unreviewed replacement'; else if (change === 'permission') f.deniedContent.add(f.note.id); else if (change === 'origin') f.changeContext({ policyVersion: 'policy:2' }); else f.editMessage(turn.output.id, { content: 'Unreviewed canonical replacement' }, false); assert.throws(() => f.frozen(selected)); } finally { f.close(); }
  }
});

test('proof sets merge metadata/read authority conservatively, reject conflicts/self-reference and bound all validation work', () => {
  const f = fixture(); try { const turn = f.turn(), dep = turn.request.sourceDependencies.find(d => d.ref.id === f.note.id)!; assert.equal(unionHistoryDependencies([{ kind: 'resource', ref: dep.ref }], [dep]).length, 1); assert.equal(unionHistoryDependencies([{ kind: 'resource', ref: dep.ref }], [dep])[0].kind, 'resource'); assert.throws(() => unionHistoryDependencies([dep], [{ ...dep, ref: { ...dep.ref, version: dep.ref.version + 1 } }]), /dependency-conflict/);
    const many: HistoryDependency[] = Array.from({ length: 65 }, (_, i) => ({ kind: 'resource', ref: { id: 'source:' + i, kind: 'resource', version: 1, title: 'Synthetic bounded source' } })); assert.throws(() => unionHistoryDependencies(many), /proof-limit/);
    const self: HistoryDependency = { kind: 'message', conversationId: f.vela.id, messageId: turn.input.id, requestId: turn.request.id, ordinal: 1, contentDigest: historyDigest(turn.input.content), provenanceDigest: turn.request.provenance!.digest }; assert.throws(() => createHistoryProvenance({ requestId: turn.request.id, conversationId: f.vela.id, origin: turn.request.origin!, inputMessageId: turn.input.id, intent: turn.input.content, dependencies: [self] }), /incomplete-proof/);
    f.reader.content = () => ({ overBudget: true }); assert.equal(f.select().omissions[0].reason, 'validation-limit');
  } finally { f.close(); }
});

test('disabled, empty and incomplete/non-conversational history is explicit and cannot append or start work', () => {
  const f = fixture(); try { const changes = f.db.prepare('SELECT total_changes() AS n').get()!.n; assert.equal(f.select().omissions[0].reason, 'no-history'); assert.equal(f.select({ enabled: false }).omissions[0].reason, 'disabled'); assert.equal(f.select({ snapshot: null }).omissions[0].reason, 'no-conversation'); assert.equal(f.db.prepare('SELECT total_changes() AS n').get()!.n, changes);
    f.turn(); const selected = f.select(); f.pending(selected); assert.equal(f.select().omissions[0].reason, 'non-conversational');
  } finally { f.close(); }
});

test('canonical conversation identity, pair completeness and lookback boundaries are explicit', () => {
  const wrong = fixture(); try { const turn = wrong.turn(), r = wrong.request(turn.request.id)!; r.conversationId = randomUUID(); wrong.saveRequest(r); assert.equal(wrong.select().omissions[0].reason, 'unproven-request'); } finally { wrong.close(); }
  const missing = fixture(); try { const turn = missing.turn(); missing.db.prepare('DELETE FROM test_history_messages WHERE id=?').run(turn.input.id); const selected = missing.select(); assert.equal(selected.history, undefined); assert.equal(selected.omissions[0].reason, 'missing-pair'); } finally { missing.close(); }
  const window = fixture(); try { for (let i = 0; i < 7; i++) window.turn({ sourceIds: [] }); const selected = window.select(); assert.equal(selected.history!.messages.length, 4); assert(selected.omissions.some(o => o.reason === 'lookback-limit')); assert(selected.omissions.some(o => o.reason === 'message-limit')); } finally { window.close(); }
});
