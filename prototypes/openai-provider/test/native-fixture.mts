import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { SqliteNativeVault, type SecretProtector, type NativeVaultOptions } from '../native-storage.mts';
import type { PrivateRegistration } from '../contracts.mts';
/** Synthetic AES stand-in only; never an OS-safeStorage evidence claim. */
export function syntheticProtector(): SecretProtector { const key = createHash('sha256').update('OFFLINE TEST KEY, NOT A USER SECRET').digest(); return { available: async () => true, seal: async (text) => { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); return Buffer.concat([iv, cipher.update(text, 'utf8'), cipher.final(), cipher.getAuthTag()]); }, open: async (bytes) => { const b = Buffer.from(bytes), decipher = createDecipheriv('aes-256-gcm', key, b.subarray(0, 12)); decipher.setAuthTag(b.subarray(-16)); return Buffer.concat([decipher.update(b.subarray(12, -16)), decipher.final()]).toString('utf8'); } }; }
export function transaction(db: DatabaseSync) { return <T,>(work: (same: DatabaseSync) => T): T => { db.exec('SAVEPOINT native_test'); try {
    const result = work(db);
    db.exec('RELEASE native_test');
    return result;
}
catch (error) {
    db.exec('ROLLBACK TO native_test; RELEASE native_test');
    throw error;
} }; }
export const fixtureHost = 'urn:uuid:aa6c2d48-875e-40d6-8f52-a09e461a9787';
export function registration(id = 'profile', version = 1, client = 'oaiapp_native_fixture'): PrivateRegistration { return { registrationId: id, version, hostId: fixtureHost, clientId: client, identity: null, accessToken: null, refreshToken: null, idToken: null, scopes: [], expiresAt: 0, nonce: '', enabled: false }; }
export function openVault(path: string, overrides: Partial<NativeVaultOptions> = {}) { const db = new DatabaseSync(path, { timeout: 50 }); const vault = new SqliteNativeVault({ db, transaction: transaction(db), protector: syntheticProtector(), ...overrides }); return { db, vault }; }
// Owned child-process entry point. Only synthetic fixture paths supplied by the parent test.
if (process.argv[2] === '--child') {
    const path = process.argv[3], mode = process.argv[4], { db, vault } = openVault(path, { limits: { leaseMs: 300, operationMs: 3000, waitMs: 100 } });
    try {
        if (mode === 'hold')
            await vault.withLock('profile', async () => { process.send?.({ event: 'held' }); await new Promise(resolve => setTimeout(resolve, 650)); db.prepare('INSERT INTO synthetic_probe VALUES(?)').run('holder'); });
        else if (mode === 'write')
            await vault.withLock('profile', async () => { const current = await vault.read('profile'); if (!current)
                throw Error('missing_fixture'); await vault.compareAndSwap('profile', current.version, { ...current, version: current.version + 1 }); });
        else if (mode === 'fixed')
            await vault.withLock('profile', () => vault.compareAndSwap('profile', 1, registration('profile', 2)));
        else if (mode === 'crash')
            await vault.withLock('profile', async () => { process.send?.({ event: 'held' }); process.exit(17); });
        process.send?.({ event: 'result', ok: true });
    }
    catch (error) {
        process.send?.({ event: 'result', ok: false, code: error instanceof Error ? error.message : 'fixture_failed' });
    }
    finally {
        db.close();
    }
}
