import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { API_CONNECTION_SCHEMA_SQL, ApiConnectionError, VelaApiConnections, type ApiConnectionsOptions } from '../api-connections.mts';
import type { ApiSecretStorage } from '../api-connection-contracts.mts';

const marker = 'sk-SYNTHETIC_API_SECRET_MARKER_123456789';
const replacement = 'sk-SYNTHETIC_API_REPLACEMENT_987654321';
const configurationId = 'aerynth.vela-api.primary';
function transaction(db: DatabaseSync): ApiConnectionsOptions['transaction'] {
  let sequence = 0;
  return operation => {
    const name = 'api_test_' + ++sequence;
    db.exec('SAVEPOINT ' + name);
    try { const result = operation(db); db.exec('RELEASE ' + name); return result; }
    catch (error) { db.exec('ROLLBACK TO ' + name); db.exec('RELEASE ' + name); throw error; }
  };
}
/** Synthetic encryption verifies adapter boundaries; it is not native DPAPI qualification. */
function protector(): ApiSecretStorage {
  const encryptionKey = randomBytes(32);
  return {
    available: async () => true,
    seal: async plaintext => { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey, iv); return Buffer.concat([iv, cipher.update(plaintext, 'utf8'), cipher.final(), cipher.getAuthTag()]); },
    open: async bytes => { const source = Buffer.from(bytes), cipher = createDecipheriv('aes-256-gcm', encryptionKey, source.subarray(0, 12)); cipher.setAuthTag(source.subarray(-16)); return Buffer.concat([cipher.update(source.subarray(12, -16)), cipher.final()]).toString('utf8'); },
  };
}
function fixture(overrides: Partial<ApiConnectionsOptions> = {}) {
  const db = new DatabaseSync(':memory:'); db.exec(API_CONNECTION_SCHEMA_SQL);
  const options: ApiConnectionsOptions = { db, transaction: transaction(db), secrets: protector(), fetch: async () => Response.json({ data: [{ id: 'gpt-fixture' }] }), now: () => 1000, ...overrides };
  const connections = new VelaApiConnections(options);
  return { db, options, connections, close: () => { connections.close(); db.close(); } };
}
const configure = (connections: VelaApiConnections) => connections.configure({ configurationId, apiKey: marker, project: 'proj-synthetic', organization: 'org-synthetic' });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

test('offline API configuration: canonical SQLite reopen, encrypted bytes, redacted status, no competing transcript', async () => {
  const base = resolve(tmpdir()), dir = mkdtempSync(join(base, 'aerynth-api-connections-')), path = join(dir, 'canonical.sqlite');
  const secrets = protector(); let db: DatabaseSync | undefined, connections: VelaApiConnections | undefined;
  try {
    db = new DatabaseSync(path); db.exec(API_CONNECTION_SCHEMA_SQL);
    db.exec('CREATE TABLE canonical_probe(value TEXT)'); db.prepare('INSERT INTO canonical_probe VALUES(?)').run('preserved');
    connections = new VelaApiConnections({ db, transaction: transaction(db), secrets });
    const view = await configure(connections);
    assert.equal(view.state, 'configured'); assert.equal(view.version, 1);
    assert.equal(view.billingRoute, 'openai-api'); assert.equal(view.inferenceVerified, false); assert.equal(view.entitlement, 'unverified');
    assert.equal(view.project, 'proj-synthetic'); assert.ok(!JSON.stringify(view).includes(marker));
    assert.equal('boundaryDigest' in view, false); assert.equal('billingBalance' in view, false);
    assert.ok(!readFileSync(path).includes(Buffer.from(marker)));
    assert.ok(db.prepare('SELECT cipher FROM openai_api_configuration').get()!.cipher instanceof Uint8Array);
    connections.close(); db.close(); db = new DatabaseSync(path);
    connections = new VelaApiConnections({ db, transaction: transaction(db), secrets });
    assert.equal((await connections.status(configurationId)).version, 1);
    const credential = await connections.resolveNativeCredential(configurationId, 1);
    assert.equal(credential.providerId, 'openai-api-vela'); assert.equal(credential.kind, 'openai-api-key'); assert.equal(credential.bearer, marker);
    assert.equal(credential.project, 'proj-synthetic'); assert.equal(credential.organization, 'org-synthetic');
    assert.equal(db.prepare('SELECT value FROM canonical_probe').get()!.value, 'preserved');
    assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => row.name), ['canonical_probe', 'openai_api_configuration', 'openai_api_configuration_schema']);
    assert.equal((await connections.status(configurationId)).catalog.state, 'not-checked');
  } finally {
    connections?.close(); db?.close();
    const target = resolve(dir); assert.ok(target.startsWith(base + sep) && target.split(sep).at(-1)!.startsWith('aerynth-api-connections-'));
    const allocated = readdirSync(target).reduce((sum, file) => sum + statSync(join(target, file)).size, 0); assert.ok(allocated < 1024 * 1024);
    rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 10 });
  }
});

test('offline actual GET /models request contract, cache isolation, returned model limits remain unknown', async () => {
  let calls = 0, time = 1000;
  const f = fixture({ now: () => time, fetch: async (url, init) => {
    calls++; assert.equal(url, 'https://api.openai.com/v1/models'); assert.equal(init?.method, 'GET');
    assert.equal(init?.redirect, 'error'); assert.equal(init?.credentials, 'omit'); assert.equal(init?.cache, 'no-store'); assert.equal(init?.body, undefined);
    const headers = new Headers(init?.headers); assert.equal(headers.get('authorization'), 'Bearer ' + marker); assert.equal(headers.get('OpenAI-Project'), 'proj-synthetic'); assert.equal(headers.get('OpenAI-Organization'), 'org-synthetic');
    return Response.json({ data: [{ id: 'gpt-fixture', context_window: 999999, reasoning_efforts: ['imaginary'] }] });
  } });
  try {
    await configure(f.connections); await assert.rejects(f.connections.resolveCatalog(configurationId, 1), /api_catalog_stale/);
    const catalog = await f.connections.modelCatalog(configurationId, 1);
    assert.equal(catalog.catalogOnly, true); assert.equal(catalog.capabilities, 'unverified'); assert.equal(catalog.inferenceVerified, false);
    assert.deepEqual(catalog.models, [{ id: 'gpt-fixture', label: 'gpt-fixture' }]); catalog.models[0].id = 'tampered';
    assert.deepEqual((await f.connections.resolveCatalog(configurationId, 1)).models, ['gpt-fixture']); assert.equal(calls, 1);
    assert.equal((await f.connections.status(configurationId)).catalog.state, 'ready');
    time = 61000; assert.equal((await f.connections.status(configurationId)).catalog.state, 'stale');
    await assert.rejects(f.connections.resolveCatalog(configurationId, 1), /api_catalog_stale/);
  } finally { f.close(); }
});

test('offline exact-version rotation and disconnect revoke cached and previously resolved credential authority', async () => {
  const f = fixture();
  try {
    await configure(f.connections); const first = await f.connections.resolveNativeCredential(configurationId, 1); await f.connections.modelCatalog(configurationId, 1);
    await assert.rejects(f.connections.rotate({ configurationId, apiKey: replacement }, 2), /api_configuration_changed/);
    const rotated = await f.connections.rotate({ configurationId, apiKey: replacement, project: 'proj-next' }, 1); assert.equal(rotated.version, 2);
    assert.equal((await f.connections.resolveNativeCredential(configurationId, 2)).bearer, replacement);
    await assert.rejects(f.connections.revalidate(configurationId, 1, first.boundaryDigest), /api_configuration_changed/);
    await assert.rejects(f.connections.resolveCatalog(configurationId, 2), /api_catalog_stale/);
    const second = await f.connections.resolveNativeCredential(configurationId, 2), disconnected = await f.connections.disconnect(configurationId, 2);
    assert.equal(disconnected.version, 3); assert.equal(disconnected.configured, false); assert.equal(disconnected.state, 'disconnected');
    assert.equal(f.db.prepare('SELECT cipher FROM openai_api_configuration').get()!.cipher, null);
    await assert.rejects(f.connections.revalidate(configurationId, 2, second.boundaryDigest), /api_configuration_changed/);
    await assert.rejects(f.connections.resolveNativeCredential(configurationId, 3), /api_configuration_disconnected/);
    await assert.rejects(f.connections.disconnect(configurationId, 2), /api_configuration_changed/);
    assert.equal((await f.connections.configure({ configurationId, apiKey: marker }, 3)).version, 4);
  } finally { f.close(); }
});

test('offline disconnect during secret open and catalog fetch rejects late credential/catalog results', async () => {
  const f = fixture();
  try {
    await configure(f.connections); const openGate = deferred<void>(), opened = deferred<void>(), realOpen = f.options.secrets.open;
    f.options.secrets.open = async bytes => { opened.resolve(); await openGate.promise; return realOpen(bytes); };
    const resolving = f.connections.resolveNativeCredential(configurationId, 1); await opened.promise; await f.connections.disconnect(configurationId, 1); openGate.resolve();
    await assert.rejects(resolving, /api_configuration_changed/); f.options.secrets.open = realOpen;
    await f.connections.configure({ configurationId, apiKey: marker }, 2);
    const fetchGate = deferred<Response>(), fetching = deferred<void>(); f.options.fetch = async () => { fetching.resolve(); return fetchGate.promise; };
    const catalog = f.connections.modelCatalog(configurationId, 3); await fetching.promise; await f.connections.disconnect(configurationId, 3); fetchGate.resolve(Response.json({ data: [{ id: 'late-model' }] }));
    await assert.rejects(catalog, /api_configuration_changed/); await assert.rejects(f.connections.resolveCatalog(configurationId, 4), /api_catalog_stale/);
  } finally { f.close(); }
});

test('offline concurrent rotation CAS and injected transaction rollback preserve the original ciphertext/version', async () => {
  const f = fixture();
  try {
    await configure(f.connections); const original = Buffer.from(f.db.prepare('SELECT cipher FROM openai_api_configuration').get()!.cipher as Uint8Array);
    const rollback = new VelaApiConnections({ ...f.options, transaction: operation => f.options.transaction(db => { const result = operation(db); if (db.prepare('SELECT version FROM openai_api_configuration').get()?.version === 2) throw Error(marker); return result; }) });
    await assert.rejects(rollback.rotate({ configurationId, apiKey: replacement }, 1), error => error instanceof ApiConnectionError && error.code === 'api_storage_unavailable' && !String(error).includes(marker));
    assert.equal(f.db.prepare('SELECT version FROM openai_api_configuration').get()!.version, 1); assert.deepEqual(Buffer.from(f.db.prepare('SELECT cipher FROM openai_api_configuration').get()!.cipher as Uint8Array), original); rollback.close();
    const results = await Promise.allSettled([f.connections.rotate({ configurationId, apiKey: replacement }, 1), f.connections.rotate({ configurationId, apiKey: marker }, 1)]);
    assert.equal(results.filter(value => value.status === 'fulfilled').length, 1); assert.equal(f.db.prepare('SELECT version FROM openai_api_configuration').get()!.version, 2);
  } finally { f.close(); }
});

test('offline revocation while rotation is sealing cannot reinstall credentials; disconnect works without decryption', async () => {
  const f = fixture();
  try {
    await configure(f.connections);
    const gate = deferred<void>(), sealing = deferred<void>(), seal = f.options.secrets.seal;
    f.options.secrets.seal = async plaintext => { sealing.resolve(); await gate.promise; return seal(plaintext); };
    const rotating = f.connections.rotate({ configurationId, apiKey: replacement }, 1);
    await sealing.promise;
    f.options.secrets.available = async () => false;
    const view = await f.connections.disconnect(configurationId, 1);
    assert.equal(view.configured, false); assert.equal(view.storageAvailable, false); assert.equal(view.state, 'unavailable');
    gate.resolve(); await assert.rejects(rotating, /api_configuration_changed/);
    assert.equal(f.db.prepare('SELECT cipher FROM openai_api_configuration').get()!.cipher, null);
    assert.equal(f.db.prepare('SELECT version FROM openai_api_configuration').get()!.version, 2);
  } finally { f.close(); }
});

test('offline unavailable storage, failed encryption/decryption, envelope substitution and raw secret errors fail closed', async () => {
  const f = fixture();
  try {
    f.options.secrets.available = async () => false;
    await assert.rejects(configure(f.connections), /api_secret_unavailable/); assert.equal(f.db.prepare('SELECT count(*) AS n FROM openai_api_configuration').get()!.n, 0);
    assert.equal((await f.connections.status(configurationId)).state, 'unavailable'); f.options.secrets.available = async () => true;
    const seal = f.options.secrets.seal; f.options.secrets.seal = async () => { throw Error(marker); };
    await assert.rejects(configure(f.connections), error => String(error) === 'ApiConnectionError: api_secret_unavailable');
    f.options.secrets.seal = seal; await configure(f.connections);
    const open = f.options.secrets.open; f.options.secrets.open = async () => { throw Error(marker); };
    const status = await f.connections.status(configurationId); assert.equal(status.state, 'unavailable'); assert.ok(!JSON.stringify(status).includes(marker));
    await assert.rejects(f.connections.resolveNativeCredential(configurationId, 1), error => !String(error).includes(marker));
    f.options.secrets.open = open;
    f.db.prepare('UPDATE openai_api_configuration SET project=?').run('proj-tampered');
    await assert.rejects(f.connections.resolveNativeCredential(configurationId, 1), /api_secret_invalid/);
  } finally { f.close(); }
});

test('offline rejects unbounded config, unknown input, credential reflection, wrong migration/connection and capacity', async () => {
  const blank = new DatabaseSync(':memory:'); try { assert.throws(() => new VelaApiConnections({ db: blank, transaction: transaction(blank), secrets: protector() }), /api_storage_unavailable/); } finally { blank.close(); }
  const f = fixture({ limits: { configurations: 1 } });
  try {
    assert.throws(() => new VelaApiConnections({ ...f.options, limits: { timeoutMs: 16000 } }), /api_configuration_invalid/);
    assert.throws(() => new VelaApiConnections({ ...f.options, transaction: operation => { const other = new DatabaseSync(':memory:'); try { return operation(other); } finally { other.close(); } } }), /api_storage_connection_mismatch/);
    await assert.rejects(f.connections.configure({ configurationId, apiKey: marker, surprise: marker } as any), /api_configuration_invalid/);
    await assert.rejects(f.connections.configure({ configurationId, apiKey: marker, project: marker }), /api_configuration_invalid/);
    await assert.rejects(f.connections.configure({ configurationId, apiKey: marker + '\n' }), /api_configuration_invalid/);
    await configure(f.connections); await assert.rejects(f.connections.configure({ configurationId: 'second', apiKey: marker }), /api_configuration_limit/);
    await assert.rejects(f.connections.configure({ configurationId, apiKey: marker }), /api_configuration_changed/);
  } finally { f.close(); }
});

test('offline bounded catalog rejects duplicates, malformed/secret data, rows/bytes overflow and HTTP errors without retaining bodies', async () => {
  const f = fixture({ limits: { catalogModels: 1, catalogBytes: 200 } });
  try {
    await configure(f.connections);
    for (const body of [{ data: [{ id: 'a' }, { id: 'a' }] }, { data: [{ id: 'x\n' }] }, { data: [{ id: marker }] }, { data: [{ id: 'a', extra: 'x'.repeat(300) }] }, { error: { message: marker } }]) {
      f.options.fetch = async () => Response.json(body);
      await assert.rejects(f.connections.modelCatalog(configurationId, 1), error => error instanceof ApiConnectionError && ['api_catalog_invalid', 'api_catalog_capacity'].includes(error.code) && !String(error).includes(marker));
      assert.equal((await f.connections.status(configurationId)).catalog.state, 'unavailable');
    }
    f.options.fetch = async () => Response.json({ error: marker }, { status: 401 });
    await assert.rejects(f.connections.modelCatalog(configurationId, 1), /api_catalog_unavailable/);
    f.options.fetch = async () => { throw Error(marker); };
    await assert.rejects(f.connections.modelCatalog(configurationId, 1), error => String(error) === 'ApiConnectionError: api_catalog_unavailable');
  } finally { f.close(); }
});

test('offline timeout, concurrent catalog backpressure and close never publish late results', async () => {
  const gate = deferred<Response>(), entered = deferred<void>();
  const f = fixture({ limits: { timeoutMs: 10 }, fetch: async () => { entered.resolve(); return gate.promise; } });
  const keepAlive = setTimeout(() => gate.resolve(Response.json({ data: [] })), 50);
  try {
    await configure(f.connections); const pending = f.connections.modelCatalog(configurationId, 1); await entered.promise;
    await assert.rejects(f.connections.modelCatalog(configurationId, 1), /api_catalog_busy/);
    await assert.rejects(pending, /api_operation_timeout/);
    const closeEntered = deferred<void>(), closeGate = deferred<Response>(); f.options.fetch = async () => { closeEntered.resolve(); return closeGate.promise; };
    const closing = f.connections.modelCatalog(configurationId, 1); await closeEntered.promise; f.connections.close(); closeGate.resolve(Response.json({ data: [{ id: 'late' }] }));
    await assert.rejects(closing, /api_connections_closed/); await assert.rejects(f.connections.disconnect(configurationId, 1), /api_connections_closed/);
  } finally { clearTimeout(keepAlive); gate.resolve(Response.json({ data: [] })); f.close(); }
});
