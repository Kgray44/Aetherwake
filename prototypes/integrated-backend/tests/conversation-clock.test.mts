import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BackendCore } from '../src/core.mts';
import { ConversationGraph } from '../../connected-conversations/src/graph.ts';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'aerynth-clock-')), path = join(dir, 'canonical.sqlite');
  let core = new BackendCore({ path, contentPolicy: 'synthetic-only', provider: 'fixture' });
  return { get core() { return core; }, async reopen() { await core.command('close', {}); core = new BackendCore({ path, contentPolicy: 'synthetic-only', provider: 'fixture' }); }, async close() {
    await core.command('close', {}); const target = resolve(dir), part = relative(resolve(tmpdir()), target); assert(part.startsWith('aerynth-clock-') && !part.startsWith('..') && !isAbsolute(part)); rmSync(target, { recursive: true, force: true });
  } };
}
const current = (timestamp: string, before: number, after: number) => assert.ok(Date.parse(timestamp) >= before && Date.parse(timestamp) <= after, 'Canonical graph timestamp is current UTC: ' + timestamp);
const persisted = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

test('canonical fresh creation, branch, provider reconstruction, rollback and same-file restart keep wall-clock timestamps and original identities', async () => {
  const f = fixture(); try {
    const before = Date.now(), chat = await f.core.command('createConversation', { title: 'Synthetic canonical clock', providerId: 'local', commandId: randomUUID() });
    const source = await f.core.command('addMessage', { resourceId: chat.resourceId, role: 'user', content: 'Synthetic canonical source', expectedRevision: 1 });
    const branch = await f.core.command('branch', { resourceId: chat.resourceId, messageId: source.id, includeMessageIds: [source.id], providerId: 'local', title: 'Synthetic canonical branch', tokenBudget: 32768, commandId: randomUUID() });
    let snapshot = await f.core.command('snapshot', {}), after = Date.now();
    for (const item of [...snapshot.graph.conversations, ...snapshot.graph.messages, ...snapshot.graph.handoffs, ...snapshot.graph.edges]) current(item.createdAt, before, after);
    const originalGraph = persisted(snapshot.graph), originalMap = snapshot.resourceMap;
    await f.reopen(); snapshot = await f.core.command('snapshot', {}); assert.deepEqual(snapshot.graph, originalGraph); assert.deepEqual(snapshot.resourceMap, originalMap);
    await assert.rejects(f.core.command('selectProvider', { resourceId: chat.resourceId, providerId: 'mock-ordinary', expectedRevision: source.revision }), /provider_change_requires_branch/);
    const empty = await f.core.command('createConversation', { title: 'Synthetic empty provider choice', providerId: 'local', commandId: randomUUID() });
    await f.core.command('selectProvider', { resourceId: empty.resourceId, providerId: 'mock-ordinary', expectedRevision: empty.revision });
    const beforeRollback = (await f.core.command('snapshot', {})).graph;
    await assert.rejects(f.core.command('branch', { resourceId: chat.resourceId, messageId: source.id, includeMessageIds: [source.id], providerId: 'local', title: 'Synthetic rolled-back branch', tokenBudget: 1, commandId: randomUUID() }), /context_budget_exceeded/);
    assert.deepEqual((await f.core.command('snapshot', {})).graph, beforeRollback);
    const nextBefore = Date.now(), next = await f.core.command('addMessage', { resourceId: chat.resourceId, role: 'user', content: 'After provider reconstruction and rollback', expectedRevision: source.revision }); current(next.createdAt, nextBefore, Date.now());
    snapshot = await f.core.command('snapshot', {}); assert.deepEqual(snapshot.graph.messages.find(m => m.id === source.id), sourceWithoutReceipt(source)); assert.equal(snapshot.resourceMap[branch.conversation.resourceId], originalMap[branch.conversation.resourceId]); assert.equal(Object.keys(snapshot.executions).length, 0);
  } finally { await f.close(); }
});
function sourceWithoutReceipt<T extends {resourceId:string;revision:number}>(source: T) { const { resourceId: _resource, revision: _revision, ...message } = source; return persisted(message); }

test('legacy provider-list reconstruction preserves historical records and resumes production time without rewriting the same canonical store', async () => {
  const f = fixture(); try {
    const chat = await f.core.command('createConversation', { title: 'Synthetic legacy history', providerId: 'mock-ordinary', commandId: randomUUID() }), source = await f.core.command('addMessage', { resourceId: chat.resourceId, role: 'user', content: 'Synthetic historical source', expectedRevision: 1 });
    const owner = f.core as any, historical = owner.graph.snapshot(); historical.providers = historical.providers.filter((p: { id: string }) => p.id !== 'local');
    historical.conversations[0].createdAt = '2004-06-01T12:00:00.000Z'; historical.messages[0].createdAt = '2004-06-01T12:00:01.000Z';
    // Explicit synthetic historical fixture, written atomically through the SAME owner connection.
    owner.atomic(() => { owner.graph = new ConversationGraph(owner.localAdapters(), historical, { clock: { now: () => '2004-06-01T12:00:02.000Z' } }); });
    await f.reopen(); const restored = await f.core.command('snapshot', {}); assert(restored.graph.providers.some(p => p.id === 'local')); assert.deepEqual(restored.graph.conversations, historical.conversations); assert.deepEqual(restored.graph.messages, persisted(historical.messages)); assert.equal(restored.graph.tick, historical.tick);
    const before = Date.now(), next = await f.core.command('addMessage', { resourceId: chat.resourceId, role: 'user', content: 'Synthetic current continuation', expectedRevision: source.revision }); current(next.createdAt, before, Date.now());
    assert.equal((await f.core.command('snapshot', {})).graph.messages[0].createdAt, '2004-06-01T12:00:01.000Z');
  } finally { await f.close(); }
});
