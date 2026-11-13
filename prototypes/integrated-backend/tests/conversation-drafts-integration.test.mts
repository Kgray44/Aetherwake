import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { Backend } from '../src/service.mts';
import { BackendCore } from '../src/core.mts';
import { ConversationDraftSession, type ConversationDraftPort } from '../../conversation-product/src/draft-session.ts';
import type { Detail, Page, SearchHit } from '../../conversation-product/src/contracts.ts';
const { conversationCommand } = createRequire(import.meta.url)('../../visual-experience/cinematic-v3/native/conversation-broker.cjs');

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

test('an accepted local send and later draft survive worker restart after a lost draft-clear receipt', async () => {
  const temp = temporary(), options = { path: temp.path, provider: 'fixture' as const, contentPolicy: 'synthetic-only' as const };
  let backend = new Backend(options), loseClearReceipt = false;
  try {
    const chat = await backend.call('createConversation', { title: 'Synthetic accepted local send', providerId: 'local', commandId: randomUUID() });
    const writes: number[] = [];
    const port: ConversationDraftPort = { async command(name, input) {
      const record = await conversationCommand({ call: backend.call.bind(backend), input: { name, input } });
      if ('expectedVersion' in input) {
        writes.push(input.expectedVersion);
        if (loseClearReceipt) {
          loseClearReceipt = false;
          assert.equal(record.content, '');
          assert.equal(record.version, input.expectedVersion + 1);
          throw new Error('backend_disconnected');
        }
      }
      return record;
    } };
    const session = new ConversationDraftSession({ resourceId: chat.resourceId, port });
    await session.ready;
    session.update('Synthetic message already accepted');
    const checkpoint = await session.checkpoint();
    const accepted = await conversationCommand({ call: backend.call.bind(backend), input: { name: 'send', input: {
      resourceId: chat.resourceId, expectedRevision: 1, commandId: randomUUID(),
      content: checkpoint.record.content, draftVersion: checkpoint.record.version,
    } } });
    assert.equal(accepted.content, checkpoint.record.content);
    loseClearReceipt = true;
    await assert.rejects(session.acknowledgeSent(checkpoint), /backend_disconnected/);
    session.update('Synthetic next question stays unsent');
    await backend.close();
    backend = new Backend(options);
    await session.reload();
    await session.dispose();
    const restored = await port.command('readDraft', { resourceId: chat.resourceId });
    assert.equal(restored.content, 'Synthetic next question stays unsent');
    assert.equal(restored.version, checkpoint.record.version + 2);
    assert.deepEqual(writes, [0, 1, 2]);
    const snapshot = await backend.call('snapshot', {});
    assert.deepEqual(snapshot.graph.messages.map(message => message.content), [checkpoint.record.content]);
    assert.equal(Object.keys(snapshot.executions).length, 0);
  } finally { await backend.close().catch(() => {}); temp.cleanup(); }
});

test('the desktop broker and backend worker restore an offline document draft without sending', async () => {
  const temp = temporary();
  const options = { path: temp.path, provider: 'fixture' as const, contentPolicy: 'synthetic-only' as const, nativeMedia: true };
  let backend = new Backend(options);
  try {
    const chat = await backend.call('createConversation', { title: 'Synthetic offline document chat', providerId: 'local', commandId: randomUUID() });
    const path = join(dirname(temp.path), 'Synthetic field note.txt');
    const body = 'Synthetic field note body kept in the selected file.';
    writeFileSync(path, body);
    const { resource } = await backend.call('mediaImportTrusted', {
      kind: 'file', variant: 'document', commandId: randomUUID(), selection: { kind: 'file', path },
    });
    const resourceId = chat.resourceId, documents = [{ id: resource.id, version: resource.version }];
    const draft = (name: 'saveDraft' | 'readDraft', input: Record<string, unknown>) =>
      conversationCommand({ call: backend.call.bind(backend), input: { name, input } });
    const saved = await draft('saveDraft', { resourceId, expectedVersion: 0, content: 'Synthetic unsent question', documents });
    await backend.close();
    backend = new Backend(options);
    const restored = await draft('readDraft', { resourceId });
    assert.deepEqual(restored, saved);
    assert.deepEqual(restored.documents, [{ ...documents[0], title: resource.title }]);
    assert.ok(!JSON.stringify(restored).includes(path) && !JSON.stringify(restored).includes(body));
    const opened = await backend.call('openResource', { resourceId: resource.id, expectedVersion: resource.version });
    assert.equal(opened.status, 'ready');
    const description = await backend.call('mediaDescribe', { resourceId: resource.id });
    assert.equal(description.metadata.format, 'text');
    const readback = await backend.call('mediaReadChunk', {
      resourceId: resource.id, expectedVersion: resource.version, sourceRevision: description.metadata.sourceRevision,
      offset: 0, length: Buffer.byteLength(body),
    });
    assert.equal(Buffer.from(readback.base64, 'base64').toString('utf8'), body);
    const revisedBody = 'A deliberately different synthetic document revision.';
    writeFileSync(path, revisedBody);
    await assert.rejects(backend.call('mediaReadChunk', {
      resourceId: resource.id, expectedVersion: resource.version, sourceRevision: description.metadata.sourceRevision,
      offset: 0, length: Buffer.byteLength(body),
    }), /source_changed/);
    assert.deepEqual(await draft('readDraft', { resourceId }), saved);

    const replacement = (await backend.call('mediaImportTrusted', {
      kind: 'file', variant: 'document', commandId: randomUUID(), selection: { kind: 'file', path },
    })).resource;
    assert.notEqual(replacement.id, resource.id);
    const replaced = await draft('saveDraft', {
      resourceId, expectedVersion: saved.version, content: saved.content,
      documents: [{ id: replacement.id, version: replacement.version }],
    });
    await backend.close();
    backend = new Backend(options);
    assert.deepEqual(await draft('readDraft', { resourceId }), replaced);
    assert.equal(replaced.content, saved.content);
    assert.deepEqual(replaced.documents, [{ id: replacement.id, version: replacement.version, title: replacement.title }]);
    const revised = await backend.call('mediaDescribe', { resourceId: replacement.id });
    const replacementBytes = await backend.call('mediaReadChunk', {
      resourceId: replacement.id, expectedVersion: replacement.version, sourceRevision: revised.metadata.sourceRevision,
      offset: 0, length: Buffer.byteLength(revisedBody),
    });
    assert.equal(Buffer.from(replacementBytes.base64, 'base64').toString('utf8'), revisedBody);
    const snapshot = await backend.call('snapshot', {});
    assert.equal(snapshot.graph.messages.length, 0);
    assert.equal(Object.keys(snapshot.executions).length, 0);
  } finally { await backend.close().catch(() => {}); temp.cleanup(); }
});

test('an inherited search hit reopens at the exact message after worker restart with its unsent draft', async () => {
  const temp = temporary();
  const options = { path: temp.path, provider: 'fixture' as const, contentPolicy: 'synthetic-only' as const };
  let backend = new Backend(options);
  try {
    const parent = await backend.call('createConversation', { title: 'Synthetic parent chat', providerId: 'local', commandId: randomUUID() });
    const content = 'Synthetic inherited landmark café';
    const anchor = await backend.call('addMessage', { resourceId: parent.resourceId, role: 'user', content, expectedRevision: 1 });
    const { conversation: child } = await backend.call('branch', {
      resourceId: parent.resourceId, messageId: anchor.id, includeMessageIds: [anchor.id],
      providerId: 'local', title: 'Synthetic child chat', commandId: randomUUID(), tokenBudget: 32768,
    });
    const afterFork = await backend.call('addMessage', { resourceId: parent.resourceId, role: 'user', content, expectedRevision: 2 });
    await backend.call('addMessage', { resourceId: child.resourceId, role: 'user', content: 'Synthetic follow-up', expectedRevision: 1 });
    const draft = await backend.call('conversation', { name: 'saveDraft', input: {
      resourceId: child.resourceId, expectedVersion: 0, content: 'Unsent synthetic follow-up',
    } });

    const search = async () => await backend.call('conversation', { name: 'search', input: {
      text: 'LANDMARK CAFÉ', searchMode: 'chat-history', sort: 'title', limit: 5,
    } }) as Page<SearchHit>;
    const expectedHits = [[child.resourceId, anchor.id], [parent.resourceId, anchor.id], [parent.resourceId, afterFork.id]];
    const before = await search();
    assert.equal(before.total, expectedHits.length);
    assert.deepEqual(before.items.map(hit => [hit.resourceId, hit.messageId]), expectedHits);

    await backend.close();
    backend = new Backend(options);
    const reopened = await search();
    assert.deepEqual(reopened, before);
    const hit = reopened.items[0];
    assert.equal(hit.kind, 'message');
    assert.ok(hit.messageId);
    const detail = await backend.call('conversation', { name: 'detail', input: {
      resourceId: hit.resourceId, aroundMessageId: hit.messageId, limit: 1,
    } }) as Detail;
    assert.equal(detail.conversation.resourceId, child.resourceId);
    assert.deepEqual(detail.messages.items.map(({ id, inherited, content }) => ({ id, inherited, content })), [
      { id: anchor.id, inherited: true, content },
    ]);
    assert.deepEqual(await backend.call('conversation', { name: 'readDraft', input: { resourceId: hit.resourceId } }), draft);
    assert.equal(Object.keys((await backend.call('snapshot', {})).executions).length, 0);
  } finally {
    await backend.close().catch(() => {});
    temp.cleanup();
  }
});
