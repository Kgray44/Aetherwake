const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { app, safeStorage } = require('electron');
const { createProtectedStorageBroker } = require('./protected-storage.cjs');

// Run seed and restore in separate Electron processes under the same OS account.
const scratch = realpathSync(process.argv[2]);
const mode = process.argv[3];
assert(mode === 'seed' || mode === 'restore');
const profile = join(scratch, 'electron-profile');
if (mode === 'seed') {
  assert.equal(readdirSync(scratch).length, 0, 'Expected a fresh scratch directory');
  mkdirSync(profile);
}
app.setPath('userData', profile);
app.setPath('sessionData', profile);
const digest = value => createHash('sha256').update(value).digest('hex');

async function verify() {
  const { WorkspaceKernel } = await import('../../../workspace-kernel/kernel.mts');
  const { createNativeHostClient } = await import('../../../integrated-backend/src/native-host.mts');
  const { VelaApiConnection } = await import('../../../integrated-backend/src/vela-api-connection.mts');
  const sourcePath = join(scratch, 'source.sqlite');
  const copyPath = join(scratch, 'restored.sqlite');
  const proofPath = join(scratch, 'synthetic-proof.json');
  let stage = 'initialization';
  let store;
  function open(path, nativeStorage, existing = false) {
    const kernel = existing ? WorkspaceKernel.openExisting(path) : WorkspaceKernel.open(path);
    const client = createNativeHostClient(message => broker.handle(message));
    const broker = createProtectedStorageBroker({
      safeStorage: nativeStorage, isReady: () => app.isReady(), send: message => client.handle(message),
    });
    const connection = kernel.withTransaction(db => {
      VelaApiConnection.migrate(db);
      return new VelaApiConnection({
        db, nativeHost: client.services, transaction: work => kernel.withTransaction(work),
      });
    });
    return { kernel, connection, close() { connection.close(); client.close(); broker.close(); kernel.close(); } };
  }
  try {
    if (mode === 'seed') {
      stage = 'seal and back up';
      const syntheticKey = 'synthetic-backup-' + randomUUID();
      store = open(sourcePath, safeStorage);
      const configured = await store.connection.configureNative({ configurationId: 'vela-primary', apiKey: syntheticKey }, null);
      assert.equal(configured.state, 'configured');
      assert.equal(configured.version, 1);
      assert(!JSON.stringify(configured).includes(syntheticKey));
      await store.kernel.backupTo(copyPath);
      assert(!readFileSync(copyPath).includes(Buffer.from(syntheticKey)));
      const receipt = await store.connection.resolveNativeCredential(1);
      assert.equal((await store.connection.disconnect(1)).state, 'disconnected');
      writeFileSync(proofPath, JSON.stringify({
        syntheticDigest: digest(syntheticKey), boundaryDigest: receipt.boundaryDigest, seedProcess: process.pid,
      }), { flag: 'wx' });
      console.log(JSON.stringify({ result: 'pass', mode, sqliteBackupBytes: statSync(copyPath).size }));
      return;
    }

    stage = 'restore and resolve';
    const expected = JSON.parse(readFileSync(proofPath, 'utf8'));
    assert.notEqual(process.pid, expected.seedProcess);
    store = open(copyPath, safeStorage, true);
    const recovered = await store.connection.resolveNativeCredential(1);
    assert(digest(recovered.bearer) === expected.syntheticDigest);
    assert.equal(recovered.boundaryDigest, expected.boundaryDigest);
    assert.equal((await store.connection.status()).state, 'configured');
    store.close();
    store = undefined;

    stage = 'deny without native custody';
    store = open(copyPath, undefined, true);
    const denied = await store.connection.status();
    assert.equal(denied.state, 'unavailable');
    assert.equal(denied.version, 1);
    await assert.rejects(store.connection.resolveNativeCredential(1), /api_secret_unavailable/);
    console.log(JSON.stringify({
      result: 'pass', mode, platform: process.platform, electron: process.versions.electron,
      sqliteBackupBytes: statSync(copyPath).size, restoredVersion: 1, unavailableCustodyDenied: true,
    }));
  } catch (error) {
    // Assertion errors can carry actual values. Report only a stage and error class.
    console.error(JSON.stringify({ result: 'fail', stage, error: error.name }));
    throw Error('protected backup verification failed');
  } finally {
    store?.close();
  }
}

app.whenReady().then(verify).then(() => app.exit(0), () => app.exit(1));
