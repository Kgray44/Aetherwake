import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Backend } from '../src/service.mts';
import { BackendCore } from '../src/core.mts';

const temporary = () => {
  const dir = mkdtempSync(join(tmpdir(), 'aerynth-draft-integration-'));
  return { path: join(dir, 'canonical.sqlite'), cleanup() {
    const target = resolve(dir), part = relative(resolve(tmpdir()), target);
    assert(part.startsWith('aerynth-draft-integration-') && !part.startsWith('..') && !isAbsolute(part));
    rmSync(target, { recursive: true, force: true });
  } };
};

test('worker transport restores schema2 conversation drafts with exact canonical IDs and no transcript insertion', async () => {
  const temp = temporary(), options = { path: temp.path, provider: 'fixture' as const, contentPolicy: 'synthetic-only' as const };
  let backend = new Backend(options);
  try {
    const chat = await backend.call('createConversation', { title: 'Synthetic durable draft', providerId: 'local', commandId: randomUUID() });
    const first: any = await backend.call('conversation', { name: 'readDraft', input: { resourceId: chat.resourceId } });
    assert.equal(first.version, 0);
    const text = 'Unsent synthetic text · exact recovery\n';
    const saved: any = await backend.call('conversation', { name: 'saveDraft', input: { resourceId: chat.resourceId, expectedVersion: 0, content: text } });
    await backend.close();
    backend = new Backend(options);
    assert.deepEqual(await backend.call('conversation', { name: 'readDraft', input: { resourceId: chat.resourceId } }), saved);
    const snapshot = await backend.call('snapshot', {});
    assert.equal(snapshot.graph.messages.filter(message => message.conversationId === snapshot.resourceMap[chat.resourceId]).length, 0);
    assert.equal(Object.keys((await backend.call('snapshot', {})).executions).length, 0);
    await assert.rejects(backend.call('conversation', { name: 'saveDraft', input: { resourceId: chat.resourceId, expectedVersion: 0, content: 'Stale replacement' } }), /stale_draft_version/);
    assert.equal((await backend.call('conversation', { name: 'readDraft', input: { resourceId: chat.resourceId } }) as any).content, text);
  } finally { await backend.close().catch(() => {}); temp.cleanup(); }
});

test('canonical draft recovery remains available under the explicit synthetic busy fence while graph mutations stay fenced', async () => {
  const temp = temporary(), core = new BackendCore({ path: temp.path, provider: 'fixture', contentPolicy: 'synthetic-only' });
  try {
    const chat = await core.command('createConversation', { title: 'Synthetic busy draft', providerId: 'local', commandId: randomUUID() });
    (core as any).active = 'synthetic-pending-execution-fence';
    const saved: any = await core.command('conversation', { name: 'saveDraft', input: { resourceId: chat.resourceId, expectedVersion: 0, content: 'Recovery does not wait for a provider' } });
    assert.deepEqual(await core.command('conversation', { name: 'readDraft', input: { resourceId: chat.resourceId } }), saved);
    await assert.rejects(core.command('conversation', { name: 'create', input: { title: 'Not a recovery write', providerId: 'local', commandId: randomUUID() } }), /execution_busy/);
    const snapshot = await core.command('snapshot', {});
    assert.equal(snapshot.graph.messages.filter(message => message.conversationId === snapshot.resourceMap[chat.resourceId]).length, 0);
  } finally { (core as any).active = undefined; await core.command('close', {}); temp.cleanup(); }
});
