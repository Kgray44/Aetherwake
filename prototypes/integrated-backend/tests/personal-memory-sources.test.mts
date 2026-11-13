import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkspaceKernel } from '../../workspace-kernel/kernel.mts';
import { ConversationGraph, type Message } from '../../connected-conversations/src/graph.ts';
import { createPersonalMemorySourceReader } from '../src/personal-memory-sources.mts';

test('memory proof follows canonical project membership and current message access', () => {
  const kernel = WorkspaceKernel.open(':memory:');
  try {
    const project = kernel.createProject('Synthetic project');
    const conversation = kernel.createConversationRef('Synthetic chat', project.id);
    const reference = { kind: 'conversation-message', conversationId: conversation.id, messageId: 'm1' } as const;
    let accessible = true;
    let bodyReads = 0;
    const message: Message = { id: 'm1', conversationId: 'graph-chat', sequence: 1, role: 'user', provenance: 'user',
      sensitivity: 'internal', content: 'Synthetic message', createdAt: '2026-11-12T23:00:00Z', referenceIds: [], constraint: false };
    const reader = createPersonalMemorySourceReader({
      db: kernel.withTransaction(db => db),
      projectAccess: id => id === project.id,
      conversationAccess: (id, messageId) => accessible && id === conversation.id && (messageId === undefined || messageId === 'm1'),
      readOwnMessage: () => { bodyReads++; return message; },
    });
    const proof = reader.resolveConversationSource(reference);
    assert.equal(proof?.projectId, project.id);
    assert.equal(proof?.version, '1');
    assert.equal(proof?.sensitive, false);
    assert.equal(Object.hasOwn(proof!, 'content'), false);
    assert.equal(reader.resolveScope({ kind: 'project', id: project.id })?.version, '1');
    assert.equal(reader.resolveScope({ kind: 'conversation', id: conversation.id })?.version, '1');
    assert.equal(reader.resolveConversationSource({ ...reference, messageId: 'foreign' }), null);
    message.sensitivity = 'restricted';
    assert.equal(reader.resolveConversationSource(reference), null);
    message.sensitivity = 'sensitive';
    assert.equal(reader.resolveConversationSource(reference)?.sensitive, true);
    accessible = false;
    assert.equal(reader.resolveConversationSource(reference), null);
    assert.equal(bodyReads, 3);
    assert.equal(reader.resolveScope({ kind: 'conversation', id: conversation.id }), null);
    accessible = true;
    kernel.setResourceArchived(conversation.id, true, conversation.version);
    assert.equal(reader.resolveConversationSource(reference), null);
    assert.equal(bodyReads, 3);
  } finally { kernel.close(); }
});

test('exact graph lookup refuses foreign and unavailable message bodies', () => {
  const capability = { supported: true, authorized: true, availability: 'available' } as const;
  const graph = new ConversationGraph([{
    snapshot: { id: 'synthetic', label: 'Synthetic', version: '1', mock: true, availability: 'available',
      chat: capability, nativeFork: capability, models: [], usage: 'unknown', observedAt: '2026-11-12T23:00:00Z' },
    open: () => ({ providerSessionId: null }),
  }]);
  const first = graph.createChat('ordinary', 'synthetic', 'First');
  const second = graph.createChat('ordinary', 'synthetic', 'Second');
  const own = graph.addMessage(first.id, 'user', 'Synthetic source');
  assert.equal(graph.readOwnMessage(first.id, own.id)?.content, 'Synthetic source');
  assert.equal(graph.readOwnMessage(second.id, own.id), null);
  graph.markUnavailable(own.id);
  assert.equal(graph.readOwnMessage(first.id, own.id), null);
});
