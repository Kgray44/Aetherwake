const assert = require('node:assert/strict');
const { mkdirSync, readdirSync, realpathSync } = require('node:fs');
const { join } = require('node:path');
const { app, safeStorage } = require('electron');
const { createProtectedStorageBroker } = require('./protected-storage.cjs');

const root = realpathSync(process.argv[2]);
assert.equal(readdirSync(root).length, 0, 'Use an empty directory for the synthetic profile');
const profile = join(root, 'electron-profile');
mkdirSync(profile);
app.setPath('userData', profile);
app.setPath('sessionData', profile);

async function run() {
  const { createNativeHostClient } = await import('../../../integrated-backend/src/native-host.mts');
  const { verifyPrivateMemoryVelaJourney } = await import('../../../integrated-backend/tests/private-memory-vela-journey.mts');
  const client = createNativeHostClient(wire => broker.handle(wire));
  const broker = createProtectedStorageBroker({
    safeStorage, isReady: () => app.isReady(), send: wire => client.handle(wire),
  });
  try {
    assert.equal(await client.services.secrets.available(), true);
    await verifyPrivateMemoryVelaJourney(root, client.services.secrets);
    console.log(JSON.stringify({
      result: 'pass', electron: process.versions.electron, crossConversation: true, osCustody: true,
      reopenedCore: true, foreignProjectDenied: true, revokedBeforeSendDenied: true, providerDispatch: false,
    }));
  } finally {
    client.close();
    broker.close();
  }
}

app.whenReady().then(run).then(() => app.exit(0), error => {
  console.error(error);
  app.exit(1);
});
