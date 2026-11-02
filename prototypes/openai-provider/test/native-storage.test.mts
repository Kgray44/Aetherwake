import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { WorkspaceKernel } from '../../workspace-kernel/kernel.mts';
import { createElectronSecretProtector, NATIVE_AUTH_SCHEMA_SQL, SqliteNativeVault, type NativeVaultOptions } from '../native-storage.mts';
import { syntheticProtector, transaction, registration, fixtureHost, openVault } from './native-fixture.mts';
// Test runner cwd is module, so resolve its actual owned runtime directly.
import { mkdirSync } from 'node:fs';
const ownedRuntime = fileURLToPath(new URL('../.runtime/', import.meta.url));
mkdirSync(ownedRuntime, { recursive: true });
function fixture() { const dir = mkdtempSync(join(ownedRuntime, 'native-storage-')), path = join(dir, 'canonical.sqlite'), kernel = WorkspaceKernel.open(path); let db!: DatabaseSync; kernel.withTransaction(same => { db = same; db.exec(NATIVE_AUTH_SCHEMA_SQL); db.exec('CREATE TABLE synthetic_probe(value TEXT)'); }); const vault = new SqliteNativeVault({ db, transaction: work => kernel.withTransaction(work), protector: syntheticProtector() }); return { dir, path, db, kernel, vault, close: () => { kernel.close(); assert.ok(statSync(path).size < 8 * 1024 * 1024); const target = resolve(dir), base = resolve(ownedRuntime); assert.ok(target.startsWith(base + sep)); rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 10 }); } }; }
async function seed(f: ReturnType<typeof fixture>) { await f.vault.getOrCreate(() => fixtureHost); await f.vault.withLock('profile', () => f.vault.compareAndSwap('profile', null, registration())); }
function child(path: string, mode: string) { const process = fork(fileURLToPath(new URL('./native-fixture.mts', import.meta.url)), ['--child', path, mode], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], execArgv: [] }); let output = ''; process.stderr?.on('data', chunk => { output += String(chunk); if (output.length > 8192)
    process.kill(); }); const result = new Promise<{
    ok: boolean;
    code?: string;
}>(resolve => { process.on('message', message => { if ((message as {
    event?: string;
}).event === 'result')
    resolve(message as {
        ok: boolean;
        code?: string;
    }); }); process.once('exit', code => { if (code !== 0)
    resolve({ ok: false, code: 'child_exit_' + code }); }); }); const held = new Promise<void>(resolve => { process.on('message', message => { if ((message as {
    event?: string;
}).event === 'held')
    resolve(); }); }); const exited = new Promise<void>(resolve => process.once('exit', () => resolve())); const deadline = setTimeout(() => process.kill(), 5000); void exited.then(() => clearTimeout(deadline)); return { process, result, held, exited }; }
test('offline same-canonical SQLite: encrypted at rest, metadata-only ownership, CAS and durable restart', async () => { const f = fixture(); try {
    await seed(f);
    const current = (await f.vault.read('profile'))!, secret = { ...current, version: 2, identity: { issuer: 'https://auth.openai.com' as const, subject: 'synthetic-subject', clientId: current.clientId }, enabled: true, accessToken: 'SYNTHETIC_ACCESS_MARKER', refreshToken: 'SYNTHETIC_REFRESH_MARKER', idToken: 'SYNTHETIC_ID_MARKER', scopes: ['chatgpt.tokens.use.direct'], expiresAt: Date.now() + 60000 };
    await f.vault.withLock('profile', () => f.vault.compareAndSwap('profile', 1, secret));
    assert.deepEqual(await f.vault.read('profile'), secret);
    assert.equal(f.db.prepare('SELECT version FROM openai_native_auth_registration').get()!.version, 2);
    assert.ok(!readFileSync(f.path).includes(Buffer.from('SYNTHETIC_ACCESS_MARKER')));
    const reopened = openVault(f.path);
    try {
        assert.deepEqual(await reopened.vault.read('profile'), secret);
    }
    finally {
        reopened.db.close();
    }
    assert.equal(f.kernel.schemaVersion(), 3);
}
finally {
    f.close();
} });
test('offline: no autonomous migration, wrong same-db callback and encryption unavailable fail closed', async () => { const blank = new DatabaseSync(':memory:'); assert.throws(() => new SqliteNativeVault({ db: blank, transaction: transaction(blank), protector: syntheticProtector() }), /auth_storage_unavailable/); blank.close(); const f = fixture(), other = new DatabaseSync(':memory:'); try {
    assert.throws(() => new SqliteNativeVault({ db: f.db, transaction: work => work(other), protector: syntheticProtector() }), /native_auth_connection_mismatch/);
    await f.vault.getOrCreate(() => fixtureHost);
    const denied = new SqliteNativeVault({ db: f.db, transaction: transaction(f.db), protector: { ...syntheticProtector(), available: async () => false } });
    await assert.rejects(denied.withLock('profile', () => denied.compareAndSwap('profile', null, registration())), /os_encryption_unavailable/);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM openai_native_auth_registration').get()!.n, 0);
}
finally {
    other.close();
    f.close();
} });
test('offline: owner uniqueness includes identity-null; metadata or cipher substitution fails', async () => { const f = fixture(); try {
    await seed(f);
    await assert.rejects(f.vault.withLock('second', () => f.vault.compareAndSwap('second', null, registration('second'))), /credential_registration_conflict/);
    assert.equal(await f.vault.read('second'), null);
    f.db.prepare('UPDATE openai_native_auth_registration SET client_id=? WHERE registration_id=?').run('foreign-client', 'profile');
    await assert.rejects(f.vault.read('profile'), /protected_record_binding_mismatch/);
}
finally {
    f.close();
} });
test('offline: missing lock/stale revision/host swap denied; transaction throw rolls back cipher and metadata', async () => { const f = fixture(); try {
    await seed(f);
    await assert.rejects(f.vault.compareAndSwap('profile', 1, registration('profile', 2)), /auth_lock_required/);
    await assert.rejects(f.vault.withLock('profile', () => f.vault.compareAndSwap('profile', null, registration())), /registration_changed/);
    const before = await f.vault.read('profile');
    const bad = new SqliteNativeVault({ db: f.db, protector: syntheticProtector(), transaction: work => transaction(f.db)(db => { const result = work(db); if (db.prepare('SELECT version FROM openai_native_auth_registration').get()?.version === 2)
            throw Error('synthetic write failure'); return result; }) });
    await assert.rejects(bad.withLock('profile', () => bad.compareAndSwap('profile', 1, registration('profile', 2))), /auth_storage_unavailable/);
    assert.deepEqual(await f.vault.read('profile'), before);
    await f.vault.withLock('profile', () => f.vault.compareAndSwap('profile', 1, registration('profile', 2)));
    assert.equal((await f.vault.read('profile'))?.version, 2);
}
finally {
    f.close();
} });
test('offline real process: holder renews without holding canonical write transaction, contender bounded, subsequent writer succeeds', async () => { const f = fixture(); let a: ReturnType<typeof child> | undefined, b: ReturnType<typeof child> | undefined; try {
    await seed(f);
    a = child(f.path, 'hold');
    await a.held;
    const start = performance.now();
    f.db.prepare('INSERT INTO synthetic_probe VALUES(?)').run('unrelated-canonical-write');
    assert.equal(a.process.exitCode, null);
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM synthetic_probe WHERE value='holder'").get()!.n, 0);
    b = child(f.path, 'write');
    const denied = await b.result;
    assert.equal(denied.ok, false);
    assert.match(denied.code ?? '', /auth_(?:lock|storage)_busy/);
    await b.exited;
    assert.equal((await a.result).ok, true);
    await a.exited;
    const after = child(f.path, 'write');
    assert.equal((await after.result).ok, true);
    await after.exited;
    assert.equal((await f.vault.read('profile'))?.version, 2);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM synthetic_probe').get()!.n, 2);
}
finally {
    if (a) {
        a.process.kill();
        await a.exited;
    }
    if (b) {
        b.process.kill();
        await b.exited;
    }
    f.close();
} });
test('offline real process: crashed lease requires native-authorized recovery, clears authority and fences old owner', async () => { const f = fixture(); try {
    await seed(f);
    const original = registration();
    await f.vault.withLock('profile', () => f.vault.compareAndSwap('profile', 1, { ...original, version: 2, identity: { issuer: 'https://auth.openai.com', subject: 'synthetic-subject', clientId: original.clientId }, enabled: true, accessToken: 'synthetic-live-access', refreshToken: 'synthetic-renewable', idToken: 'synthetic-id', scopes: ['chatgpt.tokens.use.direct'], expiresAt: Date.now() + 60000 }));
    const dead = child(f.path, 'crash');
    await dead.held;
    await dead.exited;
    await new Promise(resolve => setTimeout(resolve, 350));
    const row = f.db.prepare('SELECT fence FROM openai_native_auth_lease WHERE registration_id=?').get('profile')!;
    await assert.rejects(f.vault.withLock('profile', async () => { }), /auth_lock_recovery_required/);
    await assert.rejects(f.vault.read('profile'), /auth_lock_recovery_required/);
    assert.equal(f.vault.lockStatus('profile').state, 'recovery-required');
    await assert.rejects(f.vault.recoverAbandoned('profile', Number(row.fence), 2), /auth_recovery_unavailable/);
    const denied = new SqliteNativeVault({ db: f.db, transaction: transaction(f.db), protector: syntheticProtector(), authorizeRecovery: async () => { throw Error('private denied diagnostic'); } });
    const retainedCipher = f.db.prepare('SELECT cipher FROM openai_native_auth_registration').get()!.cipher;
    await assert.rejects(denied.recoverAbandoned('profile', Number(row.fence), 2), /auth_recovery_denied/);
    assert.deepEqual(f.db.prepare('SELECT cipher FROM openai_native_auth_registration').get()!.cipher, retainedCipher);
    let reviews = 0;
    const recovery = new SqliteNativeVault({ db: f.db, transaction: transaction(f.db), protector: syntheticProtector(), authorizeRecovery: async (review) => { reviews++; assert.deepEqual(review, { registrationId: 'profile', expectedFence: row.fence, expectedVersion: 2 }); } });
    await recovery.recoverAbandoned('profile', Number(row.fence), 2);
    assert.equal(reviews, 1);
    const restored = (await f.vault.read('profile'))!;
    assert.equal(restored.version, 3);
    assert.equal(restored.enabled, false);
    assert.equal(restored.refreshToken, null);
    assert.equal(restored.clientId, 'oaiapp_native_fixture');
    await f.vault.withLock('profile', () => f.vault.compareAndSwap('profile', 3, registration('profile', 4)));
}
finally {
    f.close();
} });
test('offline: expired operation cannot commit late; authorized recovery/version/fence are exact', async () => { const f = fixture(); try {
    await seed(f);
    let release!: () => void, late!: Promise<unknown>;
    const vault = new SqliteNativeVault({ db: f.db, transaction: transaction(f.db), protector: syntheticProtector(), limits: { leaseMs: 20, operationMs: 35, waitMs: 20 }, authorizeRecovery: async () => { } });
    const work = vault.withLock('profile', async () => { await new Promise<void>(resolve => { release = resolve; }); late = vault.compareAndSwap('profile', 1, registration('profile', 2)); await late; });
    await assert.rejects(work, /auth_lock_lost/);
    await new Promise(resolve => setTimeout(resolve, 25));
    const fence = Number(f.db.prepare('SELECT fence FROM openai_native_auth_lease WHERE registration_id=?').get('profile')!.fence);
    await assert.rejects(vault.recoverAbandoned('profile', fence, 9), /registration_changed/);
    await vault.recoverAbandoned('profile', fence, 1);
    release();
    await new Promise(resolve => setTimeout(resolve, 10));
    await assert.rejects(late, /auth_lock_required/);
    assert.equal((await f.vault.read('profile'))?.version, 2);
}
finally {
    f.close();
} });
test('offline Electron port double: protected backend required, async API and rotation remain truthful', async () => { for (const [platform, backend, available] of [['linux', 'basic_text', false], ['linux', 'unknown', false], ['linux', 'gnome_libsecret', true], ['win32', '', true]] as const) {
    const protector = createElectronSecretProtector({ isAsyncEncryptionAvailable: async () => true, encryptStringAsync: async (value) => Buffer.from('encrypted:' + value), decryptStringAsync: async () => ({ result: 'plain', shouldReEncrypt: false }), getSelectedStorageBackend: () => backend }, platform);
    assert.equal(await protector.available(), available);
    if (!available)
        await assert.rejects(protector.seal('synthetic'), /os_encryption_unavailable/);
    else
        assert.equal(await protector.open(Uint8Array.of(1)), 'plain');
} const rotated = createElectronSecretProtector({ isAsyncEncryptionAvailable: async () => true, encryptStringAsync: async () => Buffer.of(1), decryptStringAsync: async () => ({ result: 'secret', shouldReEncrypt: true }) }, 'win32'); await assert.rejects(rotated.open(Buffer.of(1)), /secret_reencryption_required/); });
test('offline real process: simultaneous same-version CAS permits exactly one durable winner', async () => { const f = fixture(); let a: ReturnType<typeof child> | undefined, b: ReturnType<typeof child> | undefined; try {
    await seed(f);
    a = child(f.path, 'fixed');
    b = child(f.path, 'fixed');
    const results = await Promise.all([a.result, b.result]);
    await Promise.all([a.exited, b.exited]);
    assert.equal(results.filter(result => result.ok).length, 1);
    assert.ok(results.some(result => ['registration_changed', 'auth_lock_busy', 'auth_storage_busy'].includes(result.code ?? '')));
    assert.equal((await f.vault.read('profile'))?.version, 2);
}
finally {
    if (a) {
        a.process.kill();
        await a.exited;
    }
    if (b) {
        b.process.kill();
        await b.exited;
    }
    f.close();
} });
test('offline: guarded native fetch allows only public discovery outside lease and denies late grants', async () => { const f = fixture(); try {
    await seed(f);
    let calls = 0;
    const guarded = f.vault.guardedFetch(async () => { calls++; return Response.json({ fixture: true }); });
    await assert.rejects(guarded('https://auth.openai.com/api/accounts/oauth/token', { method: 'POST' }), /auth_lock_required/);
    assert.equal(calls, 0);
    await guarded('https://auth.openai.com/.well-known/openid-configuration');
    assert.equal(calls, 1);
    await f.vault.withLock('profile', async () => { assert.equal((await guarded('https://auth.openai.com/api/accounts/oauth/token', { method: 'POST' })).ok, true); });
    assert.equal(calls, 2);
}
finally {
    f.close();
} });
test('offline: quota and private records fail closed without expanding or losing existing state', async () => { const f = fixture(); try {
    await seed(f);
    const limited = new SqliteNativeVault({ db: f.db, transaction: transaction(f.db), protector: syntheticProtector(), limits: { maxRegistrations: 1 } });
    await assert.rejects(limited.withLock('second', () => limited.compareAndSwap('second', null, registration('second', 1, 'other-client'))), /registration_capacity_exceeded/);
    assert.equal((await f.vault.read('profile'))?.version, 1);
    assert.equal(await f.vault.read('second'), null);
    f.db.prepare('UPDATE openai_native_auth_registration SET cipher=?').run(Buffer.of(1, 2, 3));
    await assert.rejects(f.vault.read('profile'), /protected_secret_unavailable/);
}
finally {
    f.close();
} });
