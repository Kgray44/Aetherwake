const assert = require('node:assert/strict');
const { mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { app, safeStorage } = require('electron');
const { createProtectedStorageBroker } = require('./protected-storage.cjs');

// Run both modes in order under the same Windows account, using synthetic data.
const root = realpathSync(process.argv[2]);
const mode = process.argv[3];
assert(['seed', 'restore'].includes(mode));
const profile = join(root, 'electron-profile');
const live = join(root, 'live');
const before = join(root, 'before-revocation');
const after = join(root, 'after-revocation');
const receipt = join(root, 'synthetic-receipt.json');
const dbPath = directory => join(directory, 'profile.sqlite');
if (mode === 'seed') {
  assert.equal(readdirSync(root).length, 0, 'Use an empty directory for the synthetic profile');
  for (const directory of [profile, live, before, after]) mkdirSync(directory);
}
app.setPath('userData', profile);
app.setPath('sessionData', profile);

async function verify() {
  const { BackendCore } = await import('../../../integrated-backend/src/core.mts');
  const { WorkspaceKernel } = await import('../../../workspace-kernel/kernel.mts');
  const { createNativeHostClient } = await import('../../../integrated-backend/src/native-host.mts');
  const client = createNativeHostClient(wire => broker.handle(wire));
  const broker = createProtectedStorageBroker({
    safeStorage, isReady: () => app.isReady(), send: wire => client.handle(wire),
  });
  const open = (directory, secrets = client.services.secrets) => new BackendCore({
    path: dbPath(directory), privateRoot: directory, provider: 'fixture', contentPolicy: 'local-private',
  }, undefined, { secrets });
  let core;
  try {
    assert.equal(await client.services.secrets.available(), true);
    if (mode === 'seed') {
      core = open(live);
      const chat = await core.command('createConversation', { title: 'Synthetic backup source', commandId: 'chat' });
      const content = 'Use the synthetic quartz relay for the next prototype.';
      const message = await core.command('addMessage', { resourceId: chat.resourceId, role: 'user',
        content, expectedRevision: chat.revision, commandId: 'message' });
      const text = 'The next prototype uses a synthetic quartz relay.';
      const input = { conversationId: chat.resourceId, messageId: message.id, text,
        scope: 'conversation', category: 'decisions', keywords: ['quartz', 'relay'] };
      const preview = await core.command('personalMemoryCapturePreviewNative', input);
      const fact = await core.command('personalMemoryCaptureCommitNative', preview);
      const backup = async directory => {
        // A second connection exercises SQLite's online snapshot while Core remains open.
        const kernel = WorkspaceKernel.openExisting(dbPath(live));
        try { await kernel.backupTo(dbPath(directory)); }
        finally { kernel.close(); }
      };
      await backup(before);
      assert(!readFileSync(dbPath(before)).includes(Buffer.from(text)));
      await core.command('personalMemoryRevokeSourceNative', {
        conversationId: chat.resourceId, messageId: message.id, expectedRevision: message.revision,
      });
      await backup(after);
      writeFileSync(receipt, JSON.stringify({ pid: process.pid, factId: fact.id, input, content }), { flag: 'wx' });
      console.log(JSON.stringify({ result: 'pass', mode, consistentSnapshots: 2 }));
      return;
    }
    const expected = JSON.parse(readFileSync(receipt, 'utf8'));
    assert.notEqual(expected.pid, process.pid);
    const read = { type: 'read', id: expected.factId };
    core = open(before);
    const fact = await core.command('personalMemoryManagementNative', read);
    assert.equal(fact.text, expected.input.text);
    const policy = await core.command('personalMemoryPolicyNative', {});
    assert.equal(policy.velaEnabled, false);
    assert.equal(policy.ordinaryEnabled, false);
    const source = await core.command('personalMemoryCapturePreviewNative', expected.input);
    assert.equal(source.sourceText, expected.content);
    assert.deepEqual(fact.provenance, source.draft.source);
    await core.command('close', {});
    core = open(after);
    await assert.rejects(core.command('personalMemoryManagementNative', read), /personal_record_unavailable/);
    const target = { resourceId: expected.input.conversationId, selection: { messageId: expected.input.messageId } };
    assert.equal((await core.command('openResource', target)).status, 'unavailable');
    await core.command('close', {});
    const locked = { available: async () => false, async seal() { throw Error('unexpected_seal'); },
      async open() { throw Error('unexpected_open'); } };
    core = open(before, locked);
    await assert.rejects(core.command('personalMemoryManagementNative', read), /private_key_unavailable/);
    console.log(JSON.stringify({ result: 'pass', mode, electron: process.versions.electron,
      osCustodyRestored: true, canonicalSourceRestored: true, providerUseOff: true,
      postRevocationSnapshotDenied: true, preRevocationSnapshotRetainsFact: true, lockedCustodyDenied: true }));
  } finally {
    try { await core?.command('close', {}); }
    finally { client.close(); broker.close(); }
  }
}

app.whenReady().then(verify).then(() => app.exit(0), error => {
  console.error(error);
  app.exit(1);
});

