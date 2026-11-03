import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { WorkspaceKernel } from '../../workspace-kernel/kernel.mts';
import { VelaService } from '../src/service.mts';
import { evaluateLocalCapability, readSystemClock } from '../src/local-capabilities.mts';
import type { VelaHostPort, VelaLocalHost, VelaMessage } from '../src/contracts.ts';

/** Real canonical kernel and message callbacks on ONE SQLite connection; model and unrelated context access throw. */
function fixture(file = ':memory:') {
  const kernel = WorkspaceKernel.open(file); let db!: DatabaseSync; kernel.withTransaction(value => { db = value; });
  db.exec('CREATE TABLE IF NOT EXISTS local_test_conversations(id TEXT PRIMARY KEY,revision INTEGER); CREATE TABLE IF NOT EXISTS local_test_messages(id TEXT PRIMARY KEY,conversation_id TEXT,json TEXT)');
  const calls = { clocks: 0, messages: 0, workspace: 0, projects: 0, executions: 0, forbidden: 0 };
  let deny = false, failAssistant = false, policyVersion = 'test-policy:1', epochMs = Date.parse('2026-11-02T02:15:00.000Z');
  const forbidden = (): never => { calls.forbidden++; throw Error('Unrelated context/provider/action access is forbidden for the local lane'); };
  const canonical = {
    ensureConversation: () => { assert(!deny); const row = db.prepare("SELECT id FROM resources WHERE kind='conversation' AND title='Synthetic canonical local Vela'").get(); if (row) return String(row.id); const id = kernel.createConversationRef('Synthetic canonical local Vela').id; db.prepare('INSERT INTO local_test_conversations VALUES(?,1)').run(id); return id; },
    appendMessage: (id: string, value: Omit<VelaMessage, 'id'>) => { assert(!deny); if (failAssistant && value.role === 'assistant') throw Error('Synthetic canonical assistant append failure'); const message = { ...value, id: randomUUID() }; db.prepare('INSERT INTO local_test_messages VALUES(?,?,?)').run(message.id, id, JSON.stringify(message)); db.prepare('UPDATE local_test_conversations SET revision=revision+1 WHERE id=?').run(id); return message; },
  };
  const host: VelaHostPort = {
    scope: forbidden, context: forbidden, contextReferences: forbidden, search: forbidden, resolve: forbidden, readContent: forbidden, authorize: forbidden, applyNative: forbidden, readConversation: forbidden, ensureConversation: forbidden, appendMessage: forbidden,
  };
  const local: VelaLocalHost = {
    ...canonical,
    identity: () => { assert(!deny); return { principalId: 'test-owner', policyVersion }; },
    clock: () => { calls.clocks++; return { epochMs, timeZone: 'America/New_York', locale: 'en-US' }; },
    readMessage: (conversationId, id) => { calls.messages++; if (deny) return null; const row = db.prepare('SELECT json FROM local_test_messages WHERE conversation_id=? AND id=?').get(conversationId, id); return row ? JSON.parse(String(row.json)) : null; },
    workspaceStatus: () => { calls.workspace++; return { workspace: { id: 'test-workspace', kind: 'workspace', title: 'Synthetic workspace', version: 7 }, persistence: 'persisted' }; },
    projectCount: () => { calls.projects++; return { count: 3, coverage: 'authorized-active-projects' }; },
    executionStatus: () => { calls.executions++; return { running: 0, unknown: 1, coverage: 'aerynth-owned-executions' }; },
  };
  const options = { db, host, local, transaction: <T,>(work: () => T): T => kernel.withTransaction(work), readTransaction: <T,>(work: (connection: DatabaseSync) => T): T => kernel.withTransaction(work), planner: { providerId: 'test-provider-never-used', availability: forbidden, propose: async (): Promise<never> => forbidden() } };
  let service = new VelaService(options);
  return { db, kernel, local, calls, get service() { return service; }, options, changes: () => Number(db.prepare('SELECT total_changes() AS n').get()!.n),
    messages: () => db.prepare('SELECT json FROM local_test_messages ORDER BY rowid').all().map(row => JSON.parse(String(row.json)) as VelaMessage),
    stored: () => JSON.parse(String(db.prepare('SELECT json FROM vela_state').get()!.json)),
    reopen: () => { service = new VelaService(options); }, deny: () => { deny = true; }, fail: () => { failAssistant = true; }, setPolicy: () => { policyVersion = 'test-policy:2'; }, setEpoch: (value: number) => { epochMs = value; }, close: () => kernel.close() };
}
test('unknown local intent has zero host/clock/context/provider reads and zero writes or conversation creation', () => {
  const f = fixture(); try { const before = f.changes(); assert.throws(() => f.service.local({ capabilityId: 'unknown' as never, intent: 'Explain electric motors', commandId: 'unknown:1' }), /unsupported_local_capability/); assert.equal(f.changes(), before); assert.equal(f.db.prepare('SELECT count(*) AS n FROM resources').get()!.n, 0); assert(Object.values(f.calls).every(n => n === 0)); } finally { f.close(); }
});
test('unknown structured local capability fails closed without reading any trusted host fact', () => {
  const f = fixture(); try { assert.throws(() => evaluateLocalCapability('not-a-capability' as never, f.local), /unsupported_local_capability/); assert(Object.values(f.calls).every(n => n === 0)); } finally { f.close(); }
});
test('explicit clock observation uses no source context, authorization, or model and has atomic canonical identities', async () => {
  const f = fixture(); try {
    const value = f.service.local({ capabilityId: 'local.time', intent: 'What time is it?', commandId: 'clock:normal' }); assert(value.matched); const request = value.request;
    assert.equal(request.state, 'responded'); assert.equal(request.providerId, null); assert.equal(request.response!.kind, 'answer'); assert.equal(request.local!.facts.kind, 'time');
    assert.deepEqual(request.context.included, []); assert.deepEqual(request.context.discovered, []); assert.equal(request.context.contentBytes, 0);
    const messages = f.messages(); assert.equal(messages.length, 2); assert.equal(messages[0].id, request.inputMessageId); assert.equal(messages[1].id, request.response!.messageId); assert.equal(messages[1].source, 'vela-native'); assert.equal(messages[1].classification, 'observed'); assert.equal(messages[1].providerId, undefined); assert.match(messages[1].content, /9:15:00\s+PM/u);
    assert.deepEqual(f.calls, { clocks: 1, messages: 0, workspace: 0, projects: 0, executions: 0, forbidden: 0 }); const stored = f.stored(); assert.equal(stored.plans.length, 0); assert.equal(stored.receipts.length, 0); assert.equal(stored.requests[0].local.content, undefined); assert.equal(stored.requests[0].local.timing, undefined); assert.throws(() => f.service.cancel(request.id), /completed_request_not_cancellable/);
  } finally { f.close(); }
});
test('local output is immediately canonical and idempotent by exact intent/commandId, including read-only replay timings', () => {
  const f = fixture(); try {
    const result = f.service.local({ capabilityId: 'local.time', intent: 'What time is it?', commandId: 'clock:retry' }); assert(result.matched); assert.equal(result.result.content, f.messages()[1].content); assert.equal(result.result.observedAt, '2026-11-02T02:15:00.000Z');
    for (const value of Object.values(result.result.timing)) assert(Number.isFinite(value) && value >= 0); const before = f.changes(); f.setEpoch(Date.now());
    const replay = f.service.local({ capabilityId: 'local.time', intent: 'What time is it?', commandId: 'clock:retry' }); assert(replay.matched); assert.deepEqual(replay.request, result.request); assert.equal(replay.result.content, result.result.content); assert.equal(replay.result.messageId, result.result.messageId); assert.equal(replay.result.replayed, true); assert.equal(replay.result.timing.persistenceMs, 0); assert.equal(f.changes(), before); assert.equal(f.calls.clocks, 1); assert.equal(f.calls.messages, 1);
    for (const intent of ["What's today's date?", 'Explain electric motors']) assert.throws(() => f.service.local({ capabilityId: 'local.time', intent, commandId: 'clock:retry' }), /local_command_id_conflict/);
    const originalRead = f.local.readMessage; f.local.readMessage = () => null; assert.throws(() => f.service.local({ capabilityId: 'local.time', intent: 'What time is it?', commandId: 'clock:retry' }), /local_response_unavailable/); f.local.readMessage = originalRead;
    f.setPolicy(); assert.throws(() => f.service.local({ capabilityId: 'local.time', intent: 'What time is it?', commandId: 'clock:retry' }), /local_response_unavailable/);
  } finally { f.close(); }
});
test('time-zone date boundaries, fractional offsets and DST use real Intl rules from trusted epoch/zone facts', () => {
  const f = fixture(); try {
    const first = evaluateLocalCapability('local.date', f.local); assert.equal(first.facts.kind, 'date'); if (first.facts.kind === 'date') { assert.equal(first.facts.calendarDate, '2026-11-01'); assert.equal(first.facts.utcOffsetMinutes, -300); }
    f.setEpoch(Date.parse('2026-03-08T06:59:59Z')); const before = evaluateLocalCapability('local.time', f.local); f.setEpoch(Date.parse('2026-03-08T07:00:00Z')); const after = evaluateLocalCapability('local.time', f.local);
    assert.equal(before.facts.kind, 'time'); assert.equal(after.facts.kind, 'time'); if (before.facts.kind === 'time' && after.facts.kind === 'time') { assert.equal(before.facts.utcOffsetMinutes, -300); assert.equal(after.facts.utcOffsetMinutes, -240); assert.match(before.content, /1:59:59/); assert.match(after.content, /3:00:00/); }
    const kathmandu = evaluateLocalCapability('local.time', { ...f.local, clock: () => ({ epochMs: Date.parse('2026-11-02T00:00Z'), timeZone: 'Asia/Kathmandu', locale: 'en-US' }) }); assert.equal(kathmandu.facts.kind, 'time'); if (kathmandu.facts.kind === 'time') assert.equal(kathmandu.facts.utcOffsetMinutes, 345);
    const liveBefore = Date.now(), live = readSystemClock(), liveAfter = Date.now(); assert(live.epochMs >= liveBefore && live.epochMs <= liveAfter && live.timeZone && live.locale);
  } finally { f.close(); }
});
test('status ports are targeted and honest about layout coverage/unknown execution outcomes; unsupported facts never infer or fall back', () => {
  const f = fixture(); try {
    for (const [intent, expected] of [['Is this workspace saved?', 'workspace-status'], ['How many projects do I have?', 'project-count'], ['Are any agents running?', 'execution-status']] as const) { const result = f.service.local({ capabilityId: `local.${expected}`, intent, commandId: randomUUID() }); assert(result.matched); assert.equal(result.result.facts.kind, expected); assert.equal(result.request.providerId, null); }
    assert.deepEqual(f.calls, { clocks: 0, messages: 0, workspace: 1, projects: 1, executions: 1, forbidden: 0 }); assert.match(f.messages().at(-1)!.content, /unknown outcome/);
    f.local.clock = () => ({ epochMs: NaN, timeZone: 'invalid', locale: 'en-US' }); const unavailable = f.service.local({ capabilityId: 'local.time', intent: 'What time is it?', commandId: 'bad:clock' }); assert(unavailable.matched); assert.equal(unavailable.request.response!.kind, 'inability'); assert.equal(unavailable.result.facts.kind, 'unavailable'); assert.match(unavailable.result.content, /unavailable/); assert.equal(f.calls.forbidden, 0);
  } finally { f.close(); }
});
test('status facts project only typed authorized metadata, preserve unknown saved state and never acquire source content', () => {
  const f = fixture(); try {
    const workspace = { id: 'synthetic:workspace', kind: 'workspace' as const, title: 'Synthetic private-layout title', version: 5, content: 'Unexpected resource body must never be copied' };
    f.local.workspaceStatus = () => ({ workspace, persistence: 'unknown' });
    const result = f.service.local({ capabilityId: 'local.workspace-status', intent: 'Is this workspace saved?', commandId: 'status:unknown' }); assert(result.matched); assert.equal(result.request.response!.kind, 'inability'); assert.equal(result.result.facts.kind, 'workspace-status'); assert(!JSON.stringify(result.result.facts).includes(workspace.content));
    f.local.projectCount = undefined; const unavailable = f.service.local({ capabilityId: 'local.project-count', intent: 'How many projects do I have?', commandId: 'count:missing' }); assert(unavailable.matched); assert.equal(unavailable.result.facts.kind, 'unavailable'); assert.equal(unavailable.request.response!.kind, 'inability'); assert.equal(f.calls.clocks, 0); assert.equal(f.calls.forbidden, 0);
  } finally { f.close(); }
});
test('canonical append failure and cancellation roll back both messages, Vela request and newly created resource on the SAME SQLite connection', () => {
  const f = fixture(); try {
    f.fail(); assert.throws(() => f.service.local({ capabilityId: 'local.time', intent: 'What time is it?', commandId: 'rollback:1' }), /assistant append failure/); assert.equal(f.messages().length, 0); assert.equal(f.stored().requests.length, 0); assert.equal(f.db.prepare('SELECT count(*) AS n FROM resources').get()!.n, 0);
  } finally { f.close(); }
  const cancelled = fixture(); try { const signal = new AbortController(); signal.abort(); assert.throws(() => cancelled.service.local({ capabilityId: 'local.time', intent: 'What time is it?', commandId: 'cancel:1' }, signal.signal), /local_request_cancelled/); assert.equal(cancelled.calls.clocks, 0); assert.equal(cancelled.messages().length, 0); } finally { cancelled.close(); }
  const during = fixture(); try { const signal = new AbortController(), append = during.local.appendMessage; during.local.appendMessage = (id, message) => { const saved = append(id, message); if (message.role === 'assistant') signal.abort(); return saved; }; assert.throws(() => during.service.local({ capabilityId: 'local.time', intent: 'What time is it?', commandId: 'cancel:during' }, signal.signal), /local_request_cancelled/); assert.equal(during.messages().length, 0); assert.equal(during.stored().requests.length, 0); assert.equal(during.db.prepare('SELECT count(*) AS n FROM resources').get()!.n, 0); } finally { during.close(); }
});
test('real file restart preserves exact canonical message IDs/facts and retries without new clock; legacy1/2/3 and unknown local/state versions fail safely', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aerynth-local-capability-')), file = join(dir, 'canonical.sqlite'); let f = fixture(file);
  try {
    const result = f.service.local({ capabilityId: 'local.date', intent: "What's today's date?", commandId: 'restart:1' }); assert(result.matched); const original = f.messages(); f.close(); f = fixture(file);
    const replay = f.service.local({ capabilityId: 'local.date', intent: "What's today's date?", commandId: 'restart:1' }); assert(replay.matched); assert.deepEqual(f.messages(), original); assert.deepEqual(replay.request, result.request); assert.equal(f.calls.clocks, 0);
    const corrupted = f.stored(); corrupted.requests[0].local.schemaVersion = 99; f.db.prepare('UPDATE vela_state SET json=?').run(JSON.stringify(corrupted)); assert.throws(() => f.reopen(), /unsupported_vela_local_schema/);
  } finally { f.close(); assert.equal(dirname(resolve(dir)), resolve(tmpdir())); assert(basename(dir).startsWith('aerynth-local-capability-')); rmSync(dir, { recursive: true, force: true }); }
  for (const version of [1, 2, 3, 99]) { const legacy = fixture(); try {
    const result = legacy.service.local({ capabilityId: 'local.time', intent: 'What time is it?', commandId: 'legacy:fixture' }); assert(result.matched); const data = legacy.stored(); data.schemaVersion = version; delete data.requests[0].local; const beforeMessages = legacy.messages(), beforeRequest = structuredClone(data.requests[0]); legacy.db.prepare('UPDATE vela_state SET schema_version=?,json=?').run(version, JSON.stringify(data));
    if (version === 99) assert.throws(() => legacy.reopen(), /unsupported_vela_schema/); else { legacy.reopen(); assert.equal(legacy.stored().schemaVersion, 3); assert.deepEqual(legacy.messages(), beforeMessages); assert.deepEqual(legacy.stored().requests[0], beforeRequest); }
  } finally { legacy.close(); } }
});
test('renderer extra source/provider/permission fields are rejected and missing trusted host fails closed before model/context', () => {
  const f = fixture(); try {
    for (const extra of [{ resourceIds: ['private'] }, { authorizeProvider: true }, { authorized: true }, { timeZone: 'UTC' }]) assert.throws(() => f.service.local({ capabilityId: 'local.time', intent: 'What time is it?', commandId: 'spoof:1', ...extra }), /invalid_local_request/);
    const noHost = new VelaService({ ...f.options, local: undefined }); assert.throws(() => noHost.local({ capabilityId: 'local.time', intent: 'What time is it?', commandId: 'missing:1' }), /local_capability_host_unavailable/); assert.equal(f.messages().length, 0); assert.equal(f.calls.forbidden, 0);
  } finally { f.close(); }
});
