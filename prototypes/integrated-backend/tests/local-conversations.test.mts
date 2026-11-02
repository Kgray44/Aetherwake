import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Backend } from '../src/service.mts';
import { ConversationGraph } from '../../connected-conversations/src/graph.ts';
import { localConversationAdapter } from '../../connected-conversations/src/adapters.ts';

test('local recording is an independent provider without generated output or execution', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'aerynth-local-recording-'));
  const options = {path:join(directory,'aerynth.sqlite'), privateRoot:directory, contentPolicy:'local-private' as const, provider:'fixture' as const};
  let backend = new Backend(options);
  try {
    const conversation = await backend.call('createConversation',{title:'Ordinary discussion', commandId:'local-create'});
    assert.equal(conversation.providerId,'local');
    assert.equal(conversation.kind,'ordinary');
    const input = {resourceId:conversation.resourceId, role:'user' as const, content:'A durable thought, without inference.', expectedRevision:conversation.revision, commandId:'local-message'};
    const message = await backend.call('addMessage',input);
    assert.deepEqual(await backend.call('addMessage',input),message);
    const snapshot = await backend.call('snapshot',{});
    assert.equal(snapshot.graph.messages.length,1);
    assert.equal(Object.keys(snapshot.executions).length,0);
    await backend.close(); backend = new Backend(options);
    const restored = await backend.call('snapshot',{});
    assert.equal(restored.conversations[0].resourceId,conversation.resourceId);
    assert.equal(restored.graph.messages[0].content,input.content);
    assert.equal(Object.keys(restored.executions).length,0);
  } finally { await backend.close(); rmSync(directory,{recursive:true,force:true}); }
});

test('local graph title updates retain message and conversation identities and cannot generate mock replies', () => {
  const graph = new ConversationGraph([localConversationAdapter()]);
  const conversation = graph.createChat('ordinary','local','Initial title');
  const message = graph.addMessage(conversation.id,'user','Source text');
  const renamed = graph.renameConversation(conversation.id,'A useful title');
  assert.equal(renamed.id,conversation.id);
  assert.deepEqual(graph.snapshot().messages,[message]);
  assert.throws(() => graph.runMock(conversation.id,'Make up a response'));
  assert.equal(graph.snapshot().messages.length,1);
});
