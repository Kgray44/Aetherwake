import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveReplyNoteSource } from '../src/reply-note-source.ts';

test('reply capture reads only the exact authorized own assistant message', () => {
  const message = { id: 'msg-2', conversationId: 'graph-1', role: 'assistant' as const, sequence: 2, content: 'Exact reply', sensitivity: 'internal' as const };
  let permitted = false, reads = 0;
  const owner = {
    readScope: (resourceId: string, messageId: string) => permitted && resourceId === 'chat-1' && messageId === 'msg-2'
      ? { graphId: 'graph-1', projectId: 'project-1' } : null,
    readOwnMessage(graphId: string, messageId: string) {
      reads++;
      assert.deepEqual([graphId, messageId], ['graph-1', 'msg-2']);
      return message;
    },
  };
  assert.equal(resolveReplyNoteSource(owner, 'chat-1', 'msg-2'), null);
  assert.equal(reads, 0);
  permitted = true;
  assert.deepEqual(resolveReplyNoteSource(owner, 'chat-1', 'msg-2'), { resourceId: 'chat-1', messageId: 'msg-2', sequence: 2, content: 'Exact reply', projectId: 'project-1' });
  for (const invalid of [{ conversationId: 'foreign' }, { id: 'different' }, { role: 'user' as const }, { sensitivity: 'restricted' as const }])
    assert.equal(resolveReplyNoteSource({ ...owner, readOwnMessage: () => ({ ...message, ...invalid }) }, 'chat-1', 'msg-2'), null);
  assert.equal(resolveReplyNoteSource({ ...owner, readOwnMessage: () => null }, 'chat-1', 'msg-2'), null);
});
