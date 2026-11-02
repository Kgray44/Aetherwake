import test from 'node:test';
import assert from 'node:assert/strict';
import { ConversationGraph, type ConversationClock } from '../src/graph.ts';
import { mockAdapters } from '../src/adapters.ts';

const fixtureClock: ConversationClock = { now: sequence => new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)).toISOString() };
const current = (timestamp: string, before: number, after: number) => {
  assert.match(timestamp, /Z$/); assert.ok(Date.parse(timestamp) >= before && Date.parse(timestamp) <= after, 'Timestamp is an observed current UTC instant: ' + timestamp);
};

test('default graph timestamps use the wall clock for chats, messages, artifacts, handoffs and branch lineage', () => {
  const before = Date.now(), graph = new ConversationGraph(mockAdapters());
  const chat = graph.createChat('ordinary', 'mock-ordinary', 'Synthetic current-time conversation');
  const message = graph.addMessage(chat.id, 'user', 'Synthetic source');
  const artifact = graph.addArtifact(chat.id, message.id, 'Synthetic artifact', 'mock://synthetic-clock');
  const branch = graph.branch({ sourceConversationId: chat.id, sourceMessageId: message.id, targetKind: 'ordinary', targetProviderId: 'mock-ordinary', title: 'Synthetic branch' });
  const after = Date.now();
  for (const timestamp of [chat.createdAt, message.createdAt, artifact.createdAt, branch.handoff.createdAt, branch.handoff.suppliedAt!, branch.conversation.createdAt, branch.edge.createdAt]) current(timestamp, before, after);
  assert.equal(branch.handoff.items[0].sourceTime, message.createdAt); assert.equal(graph.snapshot().tick, 7);
});

test('an explicitly injected deterministic fixture clock resumes from the existing persisted observation counter', () => {
  const graph = new ConversationGraph(mockAdapters(), undefined, { clock: fixtureClock });
  const chat = graph.createChat('ordinary', 'mock-ordinary', 'Explicit deterministic fixture'), message = graph.addMessage(chat.id, 'user', 'Fixture source');
  assert.equal(chat.createdAt, '2026-01-01T00:00:00.000Z'); assert.equal(message.createdAt, '2026-01-01T00:00:01.000Z');
  const serialized = graph.exportJson(), imported = ConversationGraph.importJson(serialized, mockAdapters(), { clock: fixtureClock }); assert.equal(imported.exportJson(), serialized);
  const next = imported.addMessage(chat.id, 'user', 'Fixture continuation'); assert.equal(next.createdAt, '2026-01-01T00:00:02.000Z'); assert.equal(next.id, 'msg-00004');
});

test('importing historical data preserves every original field and timestamp while new records default to actual time', () => {
  const historical = new ConversationGraph(mockAdapters(), undefined, { clock: fixtureClock });
  const chat = historical.createChat('ordinary', 'mock-ordinary', 'Synthetic historical source'), message = historical.addMessage(chat.id, 'user', 'Historical message');
  const serialized = historical.exportJson(), beforeImport = JSON.parse(serialized), imported = ConversationGraph.importJson(serialized, mockAdapters());
  assert.deepEqual(imported.snapshot(), beforeImport); assert.equal(imported.exportJson(), serialized);
  const before = Date.now(), next = imported.addMessage(chat.id, 'user', 'Current continuation'), after = Date.now(); current(next.createdAt, before, after);
  assert.deepEqual(imported.snapshot().conversations, beforeImport.conversations.map((c: typeof chat) => ({ ...c, ownMessageIds: [...c.ownMessageIds, next.id] })));
  assert.deepEqual(imported.visibleMessages(chat.id)[0], JSON.parse(JSON.stringify(message))); assert.equal(imported.snapshot().tick, beforeImport.tick + 1);
});

test('injected clocks normalize valid offsets to UTC and reject invalid observations instead of inventing a timestamp', () => {
  const graph = new ConversationGraph(mockAdapters(), undefined, { clock: { now: () => '2026-11-02T00:15:00-05:00' } });
  assert.equal(graph.createChat('ordinary', 'mock-ordinary', 'Synthetic offset clock').createdAt, '2026-11-02T05:15:00.000Z');
  const invalid = new ConversationGraph(mockAdapters(), undefined, { clock: { now: () => 'invalid-clock-observation' } });
  assert.throws(() => invalid.createChat('ordinary', 'mock-ordinary', 'Invalid clock fixture'), /invalid conversation clock time/); assert.equal(invalid.snapshot().conversations.length, 0); assert.equal(invalid.snapshot().tick, 0);
});
