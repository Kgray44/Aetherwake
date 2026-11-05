import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { BackendCore } from '../src/core.mts';
import { WorkspaceKernel } from '../../workspace-kernel/kernel.mts';
import { VELA_API_CONFIGURATION_ID, VelaApiConnection, parseVelaApiConnectionRequest } from '../src/vela-api-connection.mts';
import type { NativeHostServices } from '../src/native-host.mts';

const marker = 'SYNTHETIC_ONLY_API_CREDENTIAL_FIXTURE_2026';
function fixture() {
  const kernel = WorkspaceKernel.open(':memory:');
  let db!: DatabaseSync, network = 0, secretReads = 0;
  const encryptionKey = randomBytes(32);
  const nativeHost: NativeHostServices = { secrets: {
    available: async () => true,
    seal: async plaintext => { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey, iv); return Buffer.concat([iv, cipher.update(plaintext, 'utf8'), cipher.final(), cipher.getAuthTag()]); },
    open: async bytes => { secretReads++; const source = Buffer.from(bytes), cipher = createDecipheriv('aes-256-gcm', encryptionKey, source.subarray(0, 12)); cipher.setAuthTag(source.subarray(-16)); return Buffer.concat([cipher.update(source.subarray(12, -16)), cipher.final()]).toString('utf8'); },
  } };
  const transaction = <T,>(operation: (sameDb: DatabaseSync) => T) => kernel.withTransaction(operation);
  kernel.withTransaction(sameDb => { db = sameDb; VelaApiConnection.migrate(db); });
  const options = { db, transaction, nativeHost, fetch: (async () => { network++; return Response.json({ data: [{ id: 'synthetic-model' }] }); }) as typeof fetch };
  const connection = new VelaApiConnection(options);
  return { kernel, db, connection, options, counts: () => ({ network, secretReads }), close: () => { connection.close(); kernel.close(); } };
}
const configure = (connection: VelaApiConnection, expectedVersion: number | null = null) =>
  connection.configureNative({ configurationId: VELA_API_CONFIGURATION_ID, apiKey: marker, organization: 'org-fixture', project: 'proj-fixture' }, expectedVersion);

test('canonical API migration belongs to the existing transaction and preserves kernel state', () => {
  const db = new DatabaseSync(':memory:');
  try {
    assert.throws(() => VelaApiConnection.migrate(db), /api_storage_unavailable/);
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name LIKE 'openai_api_%'").get()!.n, 0);
    db.exec('SAVEPOINT owner'); VelaApiConnection.migrate(db); db.exec('ROLLBACK TO owner; RELEASE owner');
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name LIKE 'openai_api_%'").get()!.n, 0);
    assert.throws(() => new VelaApiConnection({ db, transaction: work => work(db) }), /api_storage_unavailable/);
    db.exec('SAVEPOINT owner; CREATE TABLE openai_api_configuration_schema(version INTEGER); INSERT INTO openai_api_configuration_schema VALUES(2)');
    assert.throws(() => VelaApiConnection.migrate(db), /api_storage_unavailable/);
    db.exec('ROLLBACK TO owner; RELEASE owner');
  } finally { db.close(); }
  const f = fixture();
  try {
    const before = f.kernel.schemaVersion();
    f.db.exec('CREATE TABLE preserved_source(value TEXT); INSERT INTO preserved_source VALUES(\'retained\')');
    f.kernel.withTransaction(db => VelaApiConnection.migrate(db));
    assert.equal(f.kernel.schemaVersion(), before);
    assert.equal(f.db.prepare('SELECT value FROM preserved_source').get()!.value, 'retained');
  } finally { f.close(); }
});

test('fixed native-only configuration encrypts through nativeHost; public status stays redacted without network', async () => {
  const f = fixture();
  try {
    const view = await configure(f.connection);
    assert.equal(view.configurationId, 'vela-primary'); assert.equal(view.providerId, 'openai-api-vela');
    assert.equal(view.state, 'configured'); assert.equal(view.version, 1); assert.equal(view.inferenceVerified, false);
    assert.equal(view.entitlement, 'unverified'); assert.equal(view.billingRoute, 'openai-api');
    const status = await f.connection.request({ type: 'status' });
    assert.ok(!JSON.stringify(status).includes(marker)); assert.equal('boundaryDigest' in status, false);
    assert.equal(f.counts().network, 0); assert.equal(f.counts().secretReads, 1);
    const cipher = f.db.prepare('SELECT cipher FROM openai_api_configuration WHERE configuration_id=?').get('vela-primary')!.cipher as Uint8Array;
    assert.ok(cipher instanceof Uint8Array && !Buffer.from(cipher).includes(Buffer.from(marker)));
    assert.throws(() => f.connection.configureNative({ configurationId: 'other', apiKey: marker }, null), /api_configuration_invalid/);
    const disconnectedHost = new VelaApiConnection({ ...f.options, nativeHost: undefined });
    try {
      assert.throws(() => disconnectedHost.configureNative({ configurationId: VELA_API_CONFIGURATION_ID, apiKey: marker }, 1), /api_secret_unavailable/);
      assert.equal((await disconnectedHost.status()).state, 'unavailable');
    } finally { disconnectedHost.close(); }
  } finally { f.close(); }
});

test('public API DTOs reject configuration, credential reflection, unknown keys and accessor/symbol payloads', () => {
  assert.deepEqual(parseVelaApiConnectionRequest({ type: 'status' }), { type: 'status' });
  assert.deepEqual(parseVelaApiConnectionRequest({ type: 'catalog', expectedVersion: 1 }), { type: 'catalog', expectedVersion: 1 });
  let reads = 0;
  const accessor = { get type() { reads++; return 'status'; } };
  for (const input of [null, [], accessor, { type: 'configure', apiKey: marker }, { type: 'status', configurationId: 'other' },
    { type: 'status', [Symbol('unexpected')]: marker }, { type: 'catalog', expectedVersion: 0 }, { type: 'disconnect', expectedVersion: 1, apiKey: marker },
    Object.assign(Object.create({ hidden: marker }), { type: 'status' })]) assert.throws(() => parseVelaApiConnectionRequest(input), /api_configuration_invalid/);
  assert.equal(reads, 0);
});

test('explicit catalog discovery remains unverified; disconnect clears ciphertext and revokes resolved authority', async () => {
  const f = fixture();
  try {
    await configure(f.connection);
    const credential = await f.connection.resolveNativeCredential(1);
    const result = await f.connection.request({ type: 'catalog', expectedVersion: 1 });
    assert.ok('catalogOnly' in result); assert.equal(result.catalogOnly, true); assert.equal(result.inferenceVerified, false);
    assert.equal(f.counts().network, 1); assert.deepEqual((await f.connection.resolveCatalog(1)).models, ['synthetic-model']);
    const view = await f.connection.request({ type: 'disconnect', expectedVersion: 1 });
    assert.ok('configured' in view); assert.equal(view.configured, false); assert.equal(view.version, 2);
    assert.equal(f.db.prepare('SELECT cipher FROM openai_api_configuration').get()!.cipher, null);
    await assert.rejects(f.connection.revalidate(1, credential.boundaryDigest), /api_configuration_changed/);
    await assert.rejects(f.connection.resolveCatalog(2), /api_catalog_stale/);
    await assert.rejects(f.connection.disconnect(1), /api_configuration_changed/);
    assert.equal((await configure(f.connection, 2)).version, 3);
  } finally { f.close(); }
});

test('canonical reopen retains configuration and uses the same injected host; unavailable secret errors are bounded', async () => {
  const f = fixture();
  try {
    await configure(f.connection); f.connection.close();
    const reopened = new VelaApiConnection(f.options);
    try {
      assert.equal((await reopened.status()).version, 1);
      f.options.nativeHost.secrets.open = async () => { throw Error(marker); };
      const status = await reopened.status();
      assert.equal(status.state, 'unavailable'); assert.equal(status.errorCode, 'api_secret_unavailable');
      assert.ok(!JSON.stringify(status).includes(marker));
    } finally { reopened.close(); }
  } finally { f.close(); }
});

test('actual Core API configure/status/restart/disconnect preserves canonical conversations and never calls inference', async () => {
  const f = fixture(), base = resolve(tmpdir()), dir = mkdtempSync(join(base, 'aerynth-api-core-')),
    path = join(dir, 'canonical.sqlite'), events: unknown[] = [];
  const fetchBefore = globalThis.fetch; let requests = 0, core: BackendCore | undefined;
  globalThis.fetch = async () => { requests++; throw Error('network_forbidden_offline_fixture'); };
  const create = () => new BackendCore({ path, privateRoot: dir, provider: 'fixture', contentPolicy: 'local-private' }, event => events.push(event), f.options.nativeHost);
  try {
    core = create();
    const before = await core.command('snapshot', {});
    const blank = await core.command('velaApiConnection', { type: 'status' });
    assert.ok('configured' in blank); assert.equal(blank.configured, false); assert.equal(blank.configurationId, 'vela-primary');
    const saved = await core.command('velaApiConfigure', { credential: { configurationId: VELA_API_CONFIGURATION_ID, apiKey: marker }, expectedVersion: null });
    assert.equal(saved.version, 1); assert.equal(saved.configured, true);
    await assert.rejects(core.command('velaApiConnection', { type: 'configure', apiKey: marker } as any), /api_configuration_invalid/);
    const after = await core.command('snapshot', {});
    assert.deepEqual(after.conversations, before.conversations);
    const replay = await core.command('replay', { after: 0, limit: 100 });
    assert.ok(!JSON.stringify({ after, replay, events }).includes(marker));
    assert.ok(!readFileSync(path).includes(Buffer.from(marker)));
    await core.command('close', {}); core = create();
    const reopened = await core.command('velaApiConnection', { type: 'status' });
    assert.ok('configured' in reopened); assert.equal(reopened.configured, true); assert.equal(reopened.version, 1);
    const disconnected = await core.command('velaApiConnection', { type: 'disconnect', expectedVersion: 1 });
    assert.ok('configured' in disconnected); assert.equal(disconnected.configured, false); assert.equal(disconnected.version, 2);
    assert.equal(requests, 0);
    await core.command('close', {}); core = undefined;
    const read = new DatabaseSync(path, { readOnly: true });
    try { assert.equal(read.prepare('SELECT cipher FROM openai_api_configuration WHERE configuration_id=?').get('vela-primary')!.cipher, null); }
    finally { read.close(); }
  } finally {
    if (core) await core.command('close', {}).catch(() => {});
    globalThis.fetch = fetchBefore; f.close();
    const part = relative(base, resolve(dir));
    assert.ok(part.startsWith('aerynth-api-core-') && !part.startsWith('..') && !isAbsolute(part));
    rmSync(dir, { recursive: true, force: true });
  }
});
