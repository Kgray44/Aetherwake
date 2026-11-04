const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { importVelaApiBootstrap } = require('../native/vela-api-bootstrap.cjs');
const KEY = 'synthetic-bootstrap-key-not-real';
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aerynth-api-bootstrap-'));
  t.after(async () => { const resolved = path.resolve(directory); assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.match(path.basename(resolved), /^aerynth-api-bootstrap-/); await fs.rm(resolved, { recursive: true, force: true }); });
  const store = path.join(directory, 'Aerynth', 'private-vela-credentials'); await fs.mkdir(store, { recursive: true });
  await fs.writeFile(path.join(store, 'vela-primary.bootstrap.dpapi'), 'synthetic-encrypted-blob');
  let status = { configurationId: 'vela-primary', storageAvailable: true, configured: false, version: null, state: 'disconnected' };
  const calls = [], launches = [];
  const call = async (name, input) => {
    calls.push({ name, input: JSON.parse(JSON.stringify(input)) });
    if (name === 'velaApiConnection') return { ...status };
    if (name === 'velaApiConfigure') { assert.equal(input.expectedVersion, status.version); assert.equal(input.credential.apiKey, KEY);
      status = { ...status, version: (status.version ?? 0) + 1, configured: true, state: 'configured' }; return { ...status }; }
    if (name === 'velaApiUsageAuthorize') { assert.equal(input.expectedVersion, status.version); return { enabled: true }; }
    throw Error('unexpected command');
  };
  const run = (exe, args, options, callback) => { launches.push({ exe, args, options }); callback(null, JSON.stringify({ configurationId: 'vela-primary', apiKey: KEY, version: 1 })); };
  return { directory, store, calls, launches, call, run, setVersion(version) { status.version = version; } };
}
test('protected native bootstrap imports via private command, grants explicit usage, and never places a key in process args or receipt', async t => {
  const f = await fixture(t), result = await importVelaApiBootstrap({ call: f.call, run: f.run, localAppData: f.directory, storageAllowed: async () => true });
  assert.deepEqual(result, { imported: true, configured: true, version: 1 });
  assert.deepEqual(f.calls.map(call => call.name), ['velaApiConnection', 'velaApiConfigure', 'velaApiUsageAuthorize']);
  assert.doesNotMatch(JSON.stringify(f.launches), new RegExp(KEY));
  assert.equal(f.launches[0].options.windowsHide, true);
  assert.doesNotMatch(await fs.readFile(path.join(f.store, 'vela-primary.import.json'), 'utf8'), new RegExp(KEY));
  const replay = await importVelaApiBootstrap({ call: f.call, run: f.run, localAppData: f.directory, storageAllowed: async () => true });
  assert.equal(replay.imported, false); assert.equal(f.launches.length, 1);
});
test('a later credential rotation prevents bootstrap replay from overwriting the user choice', async t => {
  const f = await fixture(t), options = { call: f.call, run: f.run, localAppData: f.directory, storageAllowed: async () => true };
  await importVelaApiBootstrap(options); f.setVersion(3);
  await assert.rejects(importVelaApiBootstrap(options), /api_bootstrap_connection_changed/); assert.equal(f.launches.length, 1);
});
test('storage refusal prevents decryption and raw failures remain redacted', async t => {
  const f = await fixture(t);
  await assert.rejects(importVelaApiBootstrap({ call: f.call, run: f.run, localAppData: f.directory, storageAllowed: async () => false }), /storage_reserve_admission_denied/);
  assert.equal(f.launches.length, 0);
  await assert.rejects(importVelaApiBootstrap({ call: f.call, run: (_exe, _args, _opts, callback) => callback(Error(KEY)),
    localAppData: f.directory, storageAllowed: async () => true }), error => error.message === 'api_bootstrap_unavailable' && !String(error).includes(KEY));
});
