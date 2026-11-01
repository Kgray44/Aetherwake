import test from 'node:test';
import assert from 'node:assert/strict';
import { ConversationGraph } from '../src/graph.ts';
import { mockAdapters, mockCodexAdapter, mockOrdinaryAdapter } from '../src/adapters.ts';

const fresh = () => new ConversationGraph(mockAdapters());
function seed() {
  const graph = fresh();
  const root = graph.createChat('ordinary', 'mock-ordinary', 'Idea');
  const a = graph.addMessage(root.id, 'user', 'A garden app');
  const b = graph.addMessage(root.id, 'user', 'Private plots', { constraint: true });
  const later = graph.addMessage(root.id, 'assistant', 'Later detail', { provenance: 'mock_adapter' });
  return { graph, root, a, b, later };
}
test('ordinary chat requires no task and ordinary-to-ordinary branch uses application continuation', () => {
  const { graph, root, a, b, later } = seed();
  const child = graph.branch({
    sourceConversationId: root.id, sourceMessageId: b.id, targetKind: 'ordinary',
    targetProviderId: 'mock-ordinary', title: 'Another angle'
  });
  assert.equal(child.edge.mode, 'application_continuation');
  assert.deepEqual(child.handoff.items.map(i => i.sourceMessageId), [b.id]);
  assert.deepEqual(child.handoff.excludedMessageIds, [a.id]);
  assert.deepEqual(graph.visibleMessages(child.conversation.id).map(m => m.id), [a.id, b.id]);
  assert.equal(graph.visibleMessages(root.id).at(-1)?.id, later.id);
});
test('ordinary-to-Codex and Codex-to-ordinary preserve selected context and lineage', () => {
  const { graph, root, a, b, later } = seed();
  const build = graph.branch({
    sourceConversationId: root.id, sourceMessageId: b.id, targetKind: 'codex',
    targetProviderId: 'mock-codex', title: 'Build', includeMessageIds: [a.id, b.id]
  });
  assert.equal(build.edge.mode, 'application_continuation');
  assert.deepEqual(build.handoff.items.map(i => i.sourceMessageId), [a.id, b.id]);
  const output = graph.runMock(build.conversation.id, 'Build it');
  assert.match(output.content, /^\[MOCK Codex artifact\]/);
  const artifact = graph.addArtifact(build.conversation.id, output.id, 'Plan', 'mock://plan');
  const discuss = graph.branch({
    sourceConversationId: build.conversation.id, sourceMessageId: output.id,
    targetKind: 'ordinary', targetProviderId: 'mock-ordinary', title: 'Discuss',
    includeMessageIds: [b.id, output.id], artifactIds: [artifact.id]
  });
  assert.equal(discuss.edge.parentId, build.conversation.id);
  assert.equal(discuss.handoff.items[0].constraint, true);
  assert.deepEqual(discuss.handoff.artifactIds, [artifact.id]);
  assert.equal(graph.visibleMessages(root.id).at(-1)?.id, later.id);
  assert.equal(graph.snapshot().conversations.find(c => c.id === root.id)?.ownMessageIds.length, 3);
});
test('Codex-to-Codex uses labeled native fork only when supported and authorized', () => {
  const graph = fresh();
  const root = graph.createChat('codex', 'mock-codex', 'Code');
  const source = graph.runMock(root.id, 'Build');
  const child = graph.branch({
    sourceConversationId: root.id, sourceMessageId: source.id, targetKind: 'codex',
    targetProviderId: 'mock-codex', title: 'Alternative',
    includeMessageIds: graph.visibleMessages(root.id).map(m => m.id)
  });
  assert.equal(child.edge.mode, 'native_fork');
  assert.match(child.conversation.providerSessionId!, /^codex-native-fork:/);
  const restricted = mockCodexAdapter();
  restricted.snapshot.nativeFork.authorized = false;
  restricted.snapshot.nativeFork.availability = 'disabled';
  const other = new ConversationGraph([restricted]);
  const origin = other.createChat('codex', 'mock-codex', 'Code');
  const msg = other.addMessage(origin.id, 'user', 'Build');
  assert.equal(other.branch({
    sourceConversationId: origin.id, sourceMessageId: msg.id, targetKind: 'codex',
    targetProviderId: 'mock-codex', title: 'Alternative'
  }).edge.mode, 'application_continuation');
});
test('nested and multiple branches retain ordering, provenance, and independent futures', () => {
  const { graph, root, a, b } = seed();
  const one = graph.branch({ sourceConversationId: root.id, sourceMessageId: a.id,
    targetKind: 'ordinary', targetProviderId: 'mock-ordinary', title: 'One' });
  const two = graph.branch({ sourceConversationId: root.id, sourceMessageId: a.id,
    targetKind: 'codex', targetProviderId: 'mock-codex', title: 'Two' });
  const oneFuture = graph.addMessage(one.conversation.id, 'user', 'Only one');
  graph.addMessage(two.conversation.id, 'user', 'Only two');
  const nested = graph.branch({ sourceConversationId: one.conversation.id, sourceMessageId: oneFuture.id,
    targetKind: 'codex', targetProviderId: 'mock-codex', title: 'Nested' });
  assert.deepEqual(graph.visibleMessages(nested.conversation.id).map(m => m.id), [a.id, oneFuture.id]);
  assert.deepEqual(graph.visibleMessages(two.conversation.id).map(m => m.id).includes(b.id), false);
  assert.equal(graph.visibleMessages(root.id).length, 3);
  assert.equal(one.handoff.items[0].provenance, 'user');
});
test('unavailable source blocks new inclusion and marks old handoffs stale', () => {
  const { graph, root, a, b } = seed();
  const child = graph.branch({ sourceConversationId: root.id, sourceMessageId: b.id,
    targetKind: 'codex', targetProviderId: 'mock-codex', title: 'Build',
    includeMessageIds: [a.id, b.id] });
  graph.markUnavailable(a.id);
  assert.deepEqual(graph.inspectHandoff(child.handoff.id).staleMessageIds, [a.id]);
  assert.throws(() => graph.branch({ sourceConversationId: root.id, sourceMessageId: b.id,
    targetKind: 'codex', targetProviderId: 'mock-codex', title: 'Again',
    includeMessageIds: [a.id] }), /unavailable/);
});
test('idempotent branch and mock run retries create no duplicate events', () => {
  const { graph, root, b } = seed();
  const request = { sourceConversationId: root.id, sourceMessageId: b.id,
    targetKind: 'codex' as const, targetProviderId: 'mock-codex', title: 'Build', key: 'branch-1' };
  const first = graph.branch(request);
  const retry = graph.branch(request);
  assert.equal(first.conversation.id, retry.conversation.id);
  const message = graph.runMock(first.conversation.id, 'Build', 'turn-1');
  assert.equal(graph.runMock(first.conversation.id, 'Build', 'turn-1').id, message.id);
  assert.equal(graph.snapshot().conversations.length, 2);
  assert.equal(graph.snapshot().messages.filter(m => m.conversationId === first.conversation.id).length, 2);
});
test('missing provider, failed and interrupted handoffs remain explicit', () => {
  const { graph, root, b } = seed();
  assert.throws(() => graph.branch({ sourceConversationId: root.id, sourceMessageId: b.id,
    targetKind: 'codex', targetProviderId: 'missing', title: 'No' }), /unavailable/);
  const failing = mockCodexAdapter();
  failing.open = () => { throw new Error('simulated disconnect'); };
  const g = new ConversationGraph([mockOrdinaryAdapter(), failing]);
  const start = g.createChat('ordinary', 'mock-ordinary', 'Start');
  const m = g.addMessage(start.id, 'user', 'Idea');
  const attempt = g.branch({ sourceConversationId: start.id, sourceMessageId: m.id,
    targetKind: 'codex', targetProviderId: 'mock-codex', title: 'Attempt' });
  assert.equal(attempt.handoff.state, 'failed');
  assert.match(attempt.handoff.error!, /simulated disconnect/);
  g.interruptHandoff(attempt.handoff.id);
  assert.equal(g.inspectHandoff(attempt.handoff.id).state, 'interrupted');
});
test('validated export/import preserves identities and rejects corrupted contracts', () => {
  const { graph, root, b } = seed();
  const child = graph.branch({ sourceConversationId: root.id, sourceMessageId: b.id,
    targetKind: 'codex', targetProviderId: 'mock-codex', title: 'Build' });
  const exported = graph.exportJson();
  const restored = ConversationGraph.importJson(exported, mockAdapters());
  assert.equal(restored.exportJson(), exported);
  assert.equal(restored.visibleMessages(child.conversation.id).at(-1)?.id, b.id);
  const bad = JSON.parse(exported);
  bad.schemaVersion = 99;
  assert.throws(() => ConversationGraph.importJson(JSON.stringify(bad), mockAdapters()), /schema version/);
  const badDigest = JSON.parse(exported);
  badDigest.handoffs[0].items[0].digest = 'corrupt';
  assert.throws(() => ConversationGraph.importJson(JSON.stringify(badDigest), mockAdapters()), /context item/);
});
test('inclusion cannot reach future messages, branch history, or duplicate sources', () => {
  const { graph, root, a, b, later } = seed();
  const common = { sourceConversationId: root.id, sourceMessageId: b.id,
    targetKind: 'codex' as const, targetProviderId: 'mock-codex', title: 'Build' };
  assert.throws(() => graph.branch({ ...common, includeMessageIds: [later.id] }), /outside fork boundary/);
  assert.throws(() => graph.branch({ ...common, includeMessageIds: [a.id, a.id] }), /invalid inclusion/);
});


test('privacy labels prevent restricted transfer and require explicit sensitive consent', () => {
  const graph = fresh();
  const root = graph.createChat('ordinary', 'mock-ordinary', 'Private idea');
  const publicMessage = graph.addMessage(root.id, 'user', 'Garden idea', { sensitivity: 'public' });
  const sensitive = graph.addMessage(root.id, 'user', 'Private address', { sensitivity: 'sensitive' });
  const restricted = graph.addMessage(root.id, 'user', 'Secret token', { sensitivity: 'restricted' });
  const base = { sourceConversationId: root.id, sourceMessageId: restricted.id,
    targetKind: 'codex' as const, targetProviderId: 'mock-codex', title: 'Build' };
  assert.throws(() => graph.branch({ ...base, includeMessageIds: [sensitive.id] }), /explicit inclusion consent/);
  assert.throws(() => graph.branch({ ...base, includeMessageIds: [restricted.id], allowSensitive: true }), /restricted source/);
  const allowed = graph.branch({ ...base, includeMessageIds: [publicMessage.id, sensitive.id], allowSensitive: true });
  assert.deepEqual(allowed.handoff.items.map(i => i.sensitivity), ['public', 'sensitive']);
  assert.deepEqual(allowed.handoff.excludedMessageIds, [restricted.id]);
});
test('native fork is not claimed for a Codex message without a completed provider turn boundary', () => {
  const graph = fresh();
  const root = graph.createChat('codex', 'mock-codex', 'Code');
  const user = graph.addMessage(root.id, 'user', 'Build');
  const branch = graph.branch({ sourceConversationId: root.id, sourceMessageId: user.id,
    targetKind: 'codex', targetProviderId: 'mock-codex', title: 'Before completion' });
  assert.equal(branch.edge.mode, 'application_continuation');
});
test('selective same-provider Codex branch uses continuation when native fork would copy excluded history', () => {
  const graph = fresh();
  const root = graph.createChat('codex', 'mock-codex', 'Code');
  const result = graph.runMock(root.id, 'Build');
  const child = graph.branch({ sourceConversationId: root.id, sourceMessageId: result.id,
    targetKind: 'codex', targetProviderId: 'mock-codex', title: 'Selective',
    includeMessageIds: [result.id] });
  assert.equal(child.edge.mode, 'application_continuation');
  assert.deepEqual(child.handoff.excludedMessageIds, [graph.visibleMessages(root.id)[0].id]);
});
