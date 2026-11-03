import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { WorkspaceKernel } from '../../workspace-kernel/kernel.mts';
import { VelaService } from '../src/service.mts';
import { createSystemMemoryReader } from '../src/system-memory.mts';
import { validateSystemMemoryMeasurement } from '../src/system-information.ts';
import { evaluateLocalCapability, validateLocalRecord } from '../src/local-capabilities.mts';
import type { VelaHostPort, VelaLocalHost, VelaMessage } from '../src/contracts.ts';
const GiB = 1073741824, timestamp = '2026-11-02T12:34:56.789Z';
const syntheticMemory = () => createSystemMemoryReader({ totalmem: () => 32 * GiB, freemem: () => 14 * GiB, platform: () => 'win32' }, () => Date.parse(timestamp))();

/** Actual canonical SQLite/kernel identities through a synthetic host message
 * port. No live telemetry/provider/native account or duplicate production store. */
function fixture(path = ':memory:') {
  const kernel = WorkspaceKernel.open(path); let db!: DatabaseSync; kernel.withTransaction(value => { db = value; });
  db.exec('CREATE TABLE IF NOT EXISTS memory_test_messages(id TEXT PRIMARY KEY,conversation_id TEXT,json TEXT)');
  let reads = 0, forbidden = 0, denied = false, failAssistant = false;
  const no = (): never => { forbidden++; throw Error('No provider/context/clock/action is permitted for system.memory'); };
  const host: VelaHostPort = { scope: no, context: no, contextReferences: no, search: no, resolve: no, readContent: no, authorize: no, applyNative: no, readConversation: no, ensureConversation: no, appendMessage: no };
  const local: VelaLocalHost = {
    identity: () => { assert(!denied); return { principalId: 'synthetic:memory-owner', policyVersion: 'synthetic:memory-read-policy' }; }, clock: no,
    system: { memory: () => { reads++; return syntheticMemory(); } },
    ensureConversation: () => { assert(!denied); const existing = db.prepare("SELECT id FROM resources WHERE title='Synthetic canonical memory Vela' AND kind='conversation'").get(); return existing ? String(existing.id) : kernel.createConversationRef('Synthetic canonical memory Vela').id; },
    appendMessage: (conversationId, value) => { assert(!denied); if (failAssistant && value.role === 'assistant') throw Error('Synthetic canonical append failure'); const message = { ...value, id: randomUUID() }; db.prepare('INSERT INTO memory_test_messages VALUES(?,?,?)').run(message.id, conversationId, JSON.stringify(message)); return message; },
    readMessage: (conversationId, id) => { if (denied) return null; const row = db.prepare('SELECT json FROM memory_test_messages WHERE conversation_id=? AND id=?').get(conversationId, id); return row ? JSON.parse(String(row.json)) : null; },
  };
  const options = { db, host, local, transaction: <T,>(work: () => T): T => kernel.withTransaction(work), planner: { providerId: 'synthetic-provider-forbidden', availability: no, propose: async (): Promise<never> => no() } };
  let service = new VelaService(options);
  return { db, local, get service() { return service; }, get reads() { return reads; }, get forbidden() { return forbidden; }, deny() { denied = true; }, fail() { failAssistant = true; }, reopen() { service = new VelaService(options); }, messages: () => db.prepare('SELECT json FROM memory_test_messages ORDER BY rowid').all().map(row => JSON.parse(String(row.json)) as VelaMessage), stored: () => String(db.prepare('SELECT json FROM vela_state').get()!.json), changes: () => Number(db.prepare('SELECT total_changes() AS n').get()!.n), close() { kernel.close(); } };
}

test('trusted memory reader samples only explicit adjacent OS calls and derives physical quantities with a real source timestamp', () => {
  const calls: string[] = [], read = createSystemMemoryReader({ totalmem: () => { calls.push('total'); return 32 * GiB; }, freemem: () => { calls.push('available'); return 14 * GiB; }, platform: () => { calls.push('platform'); return 'win32'; } }, () => { calls.push('timestamp'); return Date.parse(timestamp); });
  assert.deepEqual(calls, []); const result = read(); assert.deepEqual(calls, ['total', 'available', 'platform', 'timestamp']); assert.equal(result.totalBytes, 32 * GiB); assert.equal(result.availableBytes, 14 * GiB); assert.equal(result.usedBytes, 18 * GiB); assert.equal(result.utilizationPercent, 56.25); assert.equal(result.measuredAt, timestamp); assert.equal(result.source.scope, 'host-physical-memory'); assert.equal(result.interpretation.available, 'windows-available-physical'); assert.equal(result.interpretation.excludes, 'process-and-committed-memory'); validateSystemMemoryMeasurement(result);
});

test('all measured values/source/interpretation are bounded and validated, including zero/free extremes and non-Windows definitions', () => {
  const baseline = syntheticMemory();
  for (const patch of [{ totalBytes: 0 }, { totalBytes: NaN }, { totalBytes: Infinity }, { totalBytes: Number.MAX_SAFE_INTEGER + 1 }, { availableBytes: -1 }, { availableBytes: baseline.totalBytes + 1 }, { usedBytes: -1 }, { usedBytes: baseline.usedBytes + 1 }, { utilizationPercent: NaN }, { utilizationPercent: Infinity }, { utilizationPercent: 56.26 }, { utilizationPercent: -1 }, { measuredAt: 'invalid' }, { measuredAt: '2026-11-02' }, { source: { ...baseline.source, api: 'process.memoryUsage' } }, { source: { ...baseline.source, scope: 'process' } }, { interpretation: { ...baseline.interpretation, used: 'rss' } }, { unexpectedPrivateValue: 'SYNTHETIC_MUST_NOT_PERSIST' }]) assert.throws(() => validateSystemMemoryMeasurement({ ...baseline, ...patch }), /invalid_system_memory/);
  for (const free of [0, 32 * GiB]) { const value = createSystemMemoryReader({ totalmem: () => 32 * GiB, freemem: () => free, platform: () => 'win32' }, () => Date.parse(timestamp))(); assert.equal(value.utilizationPercent, free === 0 ? 100 : 0); }
  const other = createSystemMemoryReader({ totalmem: () => 32 * GiB, freemem: () => GiB, platform: () => 'linux' }, () => Date.parse(timestamp))(); assert.equal(other.interpretation.available, 'os-reported-free-physical');
});


test('exact user RAM question is a persistent canonical observed Vela answer without context, model, approval or execution', async () => {
  const f = fixture(); try {
    const value = f.service.local({ capabilityId: 'system.memory', intent: 'What is my current RAM usage?', commandId: 'memory:exact' }); assert(value.matched); const request = value.request;
    assert.equal(request.state, 'responded'); assert.equal(request.providerId, null); assert.equal(request.local!.capabilityId, 'system.memory'); assert.equal(request.local!.observedAt, timestamp); assert.equal(request.planId, undefined); assert.deepEqual(request.context.included, []);
    const messages = f.messages(); assert.equal(messages.length, 2); assert.equal(messages[0].id, request.inputMessageId); assert.equal(messages[1].id, request.response!.messageId); assert.equal(messages[1].source, 'vela-native'); assert.equal(messages[1].classification, 'observed'); assert.equal(messages[1].providerContribution, undefined); assert.match(messages[1].content, /18\.00 GiB of 32\.00 GiB RAM \(56\.25%\)/); assert.match(messages[1].content, /14\.00 GiB is available/); assert(messages[1].content.includes(timestamp)); assert.match(messages[1].content, /not Aerynth process memory or committed memory/); assert.equal(f.reads, 1); assert.equal(f.forbidden, 0);
    const saved = JSON.parse(f.stored()); assert.equal(saved.plans.length, 0); assert.equal(saved.receipts.length, 0); assert.equal(saved.requests[0].local.content, undefined); assert.equal(saved.requests[0].local.facts.measurement.usedBytes, 18 * GiB);
  } finally { f.close(); }
});

test('replay and file restart retain exact facts/timestamp/canonical IDs without reading newer memory or adding messages', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aerynth-system-memory-')), path = join(dir, 'canonical.sqlite'); let f = fixture(path);
  try { const original = f.service.local({ capabilityId: 'system.memory', intent: 'What is my current RAM usage?', commandId: 'memory:restart' }); assert(original.matched); const messages = f.messages(); f.close(); f = fixture(path); const before = f.changes(), replay = f.service.local({ capabilityId: 'system.memory', intent: 'What is my current RAM usage?', commandId: 'memory:restart' }); assert(replay.matched); assert.equal(replay.result.replayed, true); assert.deepEqual(replay.request, original.request); assert.deepEqual(f.messages(), messages); assert.equal(f.reads, 0); assert.equal(f.changes(), before);
    const fresh = f.service.local({ capabilityId: 'system.memory', intent: 'What is my current RAM usage?', commandId: 'memory:fresh' }); assert(fresh.matched); assert.equal(f.reads, 1); assert.notEqual(fresh.result.messageId, replay.result.messageId); assert.equal(fresh.request.conversationId, replay.request.conversationId);
  } finally { f.close(); assert.equal(dirname(resolve(dir)), resolve(tmpdir())); assert(basename(dir).startsWith('aerynth-system-memory-')); rmSync(dir, { recursive: true, force: true }); }
});

test('missing, failing and invalid memory callbacks persist an honest inability, never a provider fallback or private error', () => {
  for (const source of [undefined, { memory: () => { throw Error('SYNTHETIC_PRIVATE_HOST_ERROR'); } }, { memory: () => ({ ...syntheticMemory(), availableBytes: Infinity }) }]) {
    const f = fixture(); try { f.local.system = source; const result = f.service.local({ capabilityId: 'system.memory', intent: 'How much RAM am I using?', commandId: 'memory:unavailable' }); assert(result.matched); assert.equal(result.request.response!.kind, 'inability'); assert.deepEqual(result.result.facts, { kind: 'unavailable', code: 'local_system_memory_unavailable' }); assert.match(result.result.content, /unavailable/); assert(!f.stored().includes('SYNTHETIC_PRIVATE_HOST_ERROR')); assert.equal(f.forbidden, 0); assert.equal(f.messages().length, 2); } finally { f.close(); }
  }
});

test('unknown/deeper queries read nothing; renderer facts are denied and revoked canonical recovery cannot remeasure or disclose', () => {
  const f = fixture(); try {
    const before = f.changes(); assert.throws(() => f.service.local({ capabilityId: 'unregistered' as never, intent: 'Start a Codex task to profile Aerynth.', commandId: 'deeper:1' }), /unsupported_local_capability/); assert.equal(f.changes(), before); assert.equal(f.reads, 0); assert.throws(() => f.service.local({ capabilityId: 'system.memory', intent: 'What is my current RAM usage?', commandId: 'spoof:1', measurement: syntheticMemory() } as never), /invalid_local_request/); assert.equal(f.reads, 0);
    f.service.local({ capabilityId: 'system.memory', intent: 'What is my current RAM usage?', commandId: 'memory:denied' }); f.deny(); assert.throws(() => f.service.local({ capabilityId: 'system.memory', intent: 'What is my current RAM usage?', commandId: 'memory:denied' })); assert.equal(f.reads, 1); assert.equal(f.forbidden, 0);
  } finally { f.close(); }
});

test('canonical append failure rolls back the local answer; corrupt stored measurements fail without reset or rewriting messages', () => {
  const f = fixture(); try { f.fail(); assert.throws(() => f.service.local({ capabilityId: 'system.memory', intent: 'What is my current RAM usage?', commandId: 'memory:rollback' }), /append failure/); assert.equal(f.messages().length, 0); assert.equal(JSON.parse(f.stored()).requests.length, 0); assert.equal(f.db.prepare('SELECT count(*) AS n FROM resources').get()!.n, 0); } finally { f.close(); }
  const damaged = fixture(); try { const result = damaged.service.local({ capabilityId: 'system.memory', intent: 'What is my current RAM usage?', commandId: 'memory:corrupt' }); assert(result.matched); const record = structuredClone(result.result); record.facts = { kind: 'system-memory', measurement: { ...syntheticMemory(), usedBytes: 1 } }; assert.throws(() => validateLocalRecord(record), /corrupt_vela_local_facts/); const state = JSON.parse(damaged.stored()); state.requests[0].local.facts.measurement.usedBytes = 1; const corrupt = JSON.stringify(state), messages = damaged.messages(); damaged.db.prepare('UPDATE vela_state SET json=?').run(corrupt); assert.throws(() => damaged.reopen(), /corrupt_vela_local_facts/); assert.equal(damaged.stored(), corrupt); assert.deepEqual(damaged.messages(), messages); } finally { damaged.close(); }
});
