import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { NativeCredentialVault, NativeHostIdentityStore, PrivateRegistration } from './contracts.mts';
import { abortable, ProviderError, record, requireValue, text } from './common.mts';
export interface SecretProtector {
    available(): Promise<boolean>;
    seal(value: string): Promise<Uint8Array>;
    open(value: Uint8Array): Promise<string>;
}
export interface ElectronSafeStoragePort {
    isAsyncEncryptionAvailable(): Promise<boolean>;
    encryptStringAsync(value: string): Promise<Buffer>;
    decryptStringAsync(value: Buffer): Promise<{
        result: string;
        shouldReEncrypt: boolean;
    }>;
    getSelectedStorageBackend?(): string;
}
/** Native injection only. No fallback password, plaintext mode or renderer IPC. */
export function createElectronSecretProtector(port: ElectronSafeStoragePort, platform: NodeJS.Platform = process.platform): SecretProtector {
    const available = async () => { try {
        return ['win32', 'darwin', 'linux'].includes(platform) && await port.isAsyncEncryptionAvailable() && (platform !== 'linux' || ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(port.getSelectedStorageBackend?.() ?? ''));
    }
    catch {
        return false;
    } };
    return { available, seal: async (value) => { requireValue(await available(), 'os_encryption_unavailable'); try {
            return await port.encryptStringAsync(value);
        }
        catch {
            throw new ProviderError('os_encryption_unavailable');
        } }, open: async (value) => { requireValue(await available(), 'os_encryption_unavailable'); try {
            const result = await port.decryptStringAsync(Buffer.from(value));
            requireValue(!result.shouldReEncrypt, 'secret_reencryption_required');
            requireValue(typeof result.result === 'string', 'invalid_protected_secret');
            return result.result;
        }
        catch (error) {
            throw error instanceof ProviderError ? error : new ProviderError('protected_secret_unavailable');
        } } };
}
/** Root applies this through its canonical migration owner, never by the constructor. */
export const NATIVE_AUTH_SCHEMA_SQL = `
CREATE TABLE openai_native_auth_schema(version INTEGER NOT NULL CHECK(version=1));
INSERT INTO openai_native_auth_schema VALUES(1);
CREATE TABLE openai_native_auth_host(singleton INTEGER PRIMARY KEY CHECK(singleton=1),host_id TEXT NOT NULL UNIQUE);
CREATE TABLE openai_native_auth_registration(
 registration_id TEXT PRIMARY KEY,version INTEGER NOT NULL CHECK(version BETWEEN 1 AND 9007199254740991),
 host_id TEXT NOT NULL,client_id TEXT NOT NULL,cipher BLOB NOT NULL,
 UNIQUE(host_id,client_id));
CREATE TABLE openai_native_auth_lease(
 registration_id TEXT PRIMARY KEY,fence INTEGER NOT NULL CHECK(fence BETWEEN 0 AND 9007199254740991),
 owner TEXT,expires_at INTEGER NOT NULL);
`;
export interface NativeVaultOptions {
    db: DatabaseSync;
    transaction<T>(work: (sameDb: DatabaseSync) => T): T;
    protector: SecretProtector;
    now?: () => number;
    limits?: {
        leaseMs?: number;
        waitMs?: number;
        operationMs?: number;
        maxRegistrations?: number;
    };
    /** Native consequential authorization, never a renderer boolean or registration field. */
    authorizeRecovery?: (review: {
        registrationId: string;
        expectedFence: number;
        expectedVersion: number | null;
    }) => Promise<void>;
}
export interface NativeLockStatus {
    state: 'unlocked' | 'busy' | 'recovery-required';
    fence: number;
    registrationVersion: number | null;
}
interface Lease {
    registrationId: string;
    owner: string;
    fence: number;
    deadline: number;
    lost: boolean;
    active: boolean;
    controller: AbortController;
}
const host = (value: unknown): value is string => typeof value === 'string' && /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
function validateRegistration(value: unknown, id: string): asserts value is PrivateRegistration {
    requireValue(record(value) && value.registrationId === id && text(id) && Number.isSafeInteger(value.version) && Number(value.version) >= 1 && host(value.hostId) && text(value.clientId) && value.clientId !== 'dynamic_agent_client', 'invalid_protected_registration');
    requireValue(value.identity === null || record(value.identity) && value.identity.issuer === 'https://auth.openai.com' && text(value.identity.subject, 512) && value.identity.clientId === value.clientId, 'invalid_protected_registration');
    requireValue(typeof value.enabled === 'boolean' && Number.isFinite(value.expiresAt) && typeof value.nonce === 'string' && value.nonce.length <= 200 && Array.isArray(value.scopes) && value.scopes.length <= 64 && value.scopes.every(scope => text(scope)), 'invalid_protected_registration');
    for (const key of ['accessToken', 'refreshToken', 'idToken'])
        requireValue(value[key] === null || text(value[key], 65536), 'invalid_protected_registration');
    requireValue(!value.enabled || !!value.identity && !!value.accessToken, 'invalid_protected_registration');
}
/** Uses ONLY the supplied canonical connection. Leases are committed rows, not held write transactions. */
export class SqliteNativeVault implements NativeCredentialVault, NativeHostIdentityStore {
    private readonly options: NativeVaultOptions;
    private readonly context = new AsyncLocalStorage<Lease>();
    private readonly limits: {
        leaseMs: number;
        waitMs: number;
        operationMs: number;
        maxRegistrations: number;
    };
    constructor(options: NativeVaultOptions) {
        this.options = options;
        this.limits = { leaseMs: 30000, waitMs: 5000, operationMs: 90000, maxRegistrations: 32, ...options.limits };
        for (const [key, max] of Object.entries({ leaseMs: 30000, waitMs: 5000, operationMs: 90000, maxRegistrations: 32 }))
            requireValue(Number.isSafeInteger(this.limits[key as keyof typeof this.limits]) && this.limits[key as keyof typeof this.limits] > 0 && this.limits[key as keyof typeof this.limits] <= max, 'invalid_vault_limit');
        this.tx(db => { const rows = db.prepare('SELECT version FROM openai_native_auth_schema').all(); requireValue(rows.length === 1 && rows[0].version === 1, 'unsupported_native_auth_schema'); });
    }
    private now() { const value = this.options.now?.() ?? Date.now(); requireValue(Number.isSafeInteger(value) && value >= 0, 'invalid_native_clock'); return value; }
    private tx<T>(work: (db: DatabaseSync) => T): T { try {
        return this.options.transaction(db => { requireValue(db === this.options.db, 'native_auth_connection_mismatch'); return work(db); });
    }
    catch (error) {
        if (error instanceof ProviderError)
            throw error;
        if (error instanceof Error && /locked|busy/i.test(error.message))
            throw new ProviderError('auth_storage_busy');
        if (error instanceof Error && /UNIQUE constraint/i.test(error.message))
            throw new ProviderError('credential_registration_conflict');
        throw new ProviderError('auth_storage_unavailable');
    } }
    private current(id: string): Lease { const value = this.context.getStore(); requireValue(value && value.registrationId === id && value.active && !value.lost && value.deadline > this.now(), 'auth_lock_required'); return value; }
    private fence(db: DatabaseSync, lease: Lease) { requireValue(lease.active && !lease.lost && lease.deadline > this.now(), 'auth_lock_lost'); const result = db.prepare('UPDATE openai_native_auth_lease SET expires_at=expires_at WHERE registration_id=? AND owner=? AND fence=? AND expires_at>?').run(lease.registrationId, lease.owner, lease.fence, this.now()); requireValue(result.changes === 1, 'auth_lock_lost'); }
    private async encode(value: PrivateRegistration): Promise<Uint8Array> { requireValue(await this.options.protector.available(), 'os_encryption_unavailable'); const plain = JSON.stringify({ format: 1, providerId: 'chatgpt-plan-responses', registration: value }); requireValue(Buffer.byteLength(plain) <= 262144, 'protected_record_capacity_exceeded'); let cipher: Uint8Array; try {
        cipher = await this.options.protector.seal(plain);
    }
    catch (error) {
        throw error instanceof ProviderError ? error : new ProviderError('os_encryption_unavailable');
    } requireValue(cipher instanceof Uint8Array && cipher.length > 0 && cipher.length <= 524288 && !Buffer.from(cipher).equals(Buffer.from(plain)), 'invalid_protected_secret'); return Uint8Array.from(cipher); }
    private async decode(row: Record<string, unknown>): Promise<PrivateRegistration> {
        requireValue(row.cipher instanceof Uint8Array && row.cipher.length > 0 && row.cipher.length <= 524288 && await this.options.protector.available(), 'protected_secret_unavailable');
        let value: unknown;
        try {
            const plain = await this.options.protector.open(row.cipher);
            requireValue(Buffer.byteLength(plain) <= 262144, 'protected_record_capacity_exceeded');
            value = JSON.parse(plain);
        }
        catch (error) {
            throw error instanceof ProviderError ? error : new ProviderError('protected_secret_unavailable');
        }
        requireValue(record(value) && value.format === 1 && value.providerId === 'chatgpt-plan-responses', 'invalid_protected_secret');
        validateRegistration(value.registration, String(row.registration_id));
        const result = value.registration;
        requireValue(result.version === row.version && result.hostId === row.host_id && result.clientId === row.client_id, 'protected_record_binding_mismatch');
        return structuredClone(result);
    }
    private async readRecord(id: string): Promise<PrivateRegistration | null> { requireValue(text(id), 'invalid_registration_id'); const gate = (db: DatabaseSync) => { const lease = db.prepare('SELECT owner,expires_at FROM openai_native_auth_lease WHERE registration_id=?').get(id); requireValue(!lease || lease.owner === null || Number(lease.expires_at) > this.now(), 'auth_lock_recovery_required'); }; const row = this.tx(db => { gate(db); return db.prepare('SELECT * FROM openai_native_auth_registration WHERE registration_id=?').get(id); }); if (!row)
        return null; const value = await this.decode(row); this.tx(db => { gate(db); const current = db.prepare('SELECT version,host_id,client_id FROM openai_native_auth_registration WHERE registration_id=?').get(id); requireValue(current && current.version === row.version && current.host_id === row.host_id && current.client_id === row.client_id, 'registration_changed'); }); return value; }
    async read(id: string): Promise<PrivateRegistration | null> { return this.readRecord(id); }
    lockStatus(id: string): NativeLockStatus { requireValue(text(id), 'invalid_registration_id'); return this.tx(db => { const lease = db.prepare('SELECT owner,fence,expires_at FROM openai_native_auth_lease WHERE registration_id=?').get(id), registration = db.prepare('SELECT version FROM openai_native_auth_registration WHERE registration_id=?').get(id); return { state: !lease || lease.owner === null ? 'unlocked' : Number(lease.expires_at) <= this.now() ? 'recovery-required' : 'busy', fence: Number(lease?.fence ?? 0), registrationVersion: registration ? Number(registration.version) : null }; }); }
    async compareAndSwap(id: string, expectedVersion: number | null, next: PrivateRegistration): Promise<void> {
        validateRegistration(next, id);
        requireValue(expectedVersion === null || Number.isSafeInteger(expectedVersion) && expectedVersion >= 1, 'invalid_registration_version');
        requireValue(next.version === (expectedVersion ?? 0) + 1 && Number.isSafeInteger(next.version), 'registration_changed');
        const lease = this.current(id), copy = structuredClone(next), cipher = await this.encode(copy);
        this.tx(db => {
            this.fence(db, lease);
            const current = db.prepare('SELECT version,host_id,client_id FROM openai_native_auth_registration WHERE registration_id=?').get(id);
            requireValue((current?.version ?? null) === expectedVersion, 'registration_changed');
            requireValue(!current || current.host_id === copy.hostId && current.client_id === copy.clientId, 'registration_owner_changed');
            const actualHost = db.prepare('SELECT host_id FROM openai_native_auth_host WHERE singleton=1').get();
            requireValue(actualHost?.host_id === copy.hostId, 'host_identity_mismatch');
            if (!current) {
                const count = db.prepare('SELECT count(*) AS n FROM openai_native_auth_registration').get()!;
                requireValue(Number(count.n) < this.limits.maxRegistrations, 'registration_capacity_exceeded');
                db.prepare('INSERT INTO openai_native_auth_registration VALUES(?,?,?,?,?)').run(id, copy.version, copy.hostId, copy.clientId, cipher);
            }
            else
                db.prepare('UPDATE openai_native_auth_registration SET version=?,cipher=? WHERE registration_id=? AND version=?').run(copy.version, cipher, id, expectedVersion);
        });
    }
    async getOrCreate(make: () => string): Promise<string> { const candidate = make(); requireValue(host(candidate), 'invalid_host_identity'); return this.tx(db => { db.prepare('INSERT INTO openai_native_auth_host VALUES(1,?) ON CONFLICT(singleton) DO NOTHING').run(candidate); const result = db.prepare('SELECT host_id FROM openai_native_auth_host WHERE singleton=1').get()!; requireValue(host(result.host_id), 'invalid_host_identity'); return result.host_id; }); }
    private acquire(id: string): Lease {
        return this.tx(db => {
            db.prepare('INSERT INTO openai_native_auth_lease VALUES(?,0,NULL,0) ON CONFLICT(registration_id) DO NOTHING').run(id);
            requireValue(Number(db.prepare('SELECT count(*) AS n FROM openai_native_auth_lease').get()!.n) <= 64, 'lease_capacity_exceeded');
            const row = db.prepare('SELECT * FROM openai_native_auth_lease WHERE registration_id=?').get(id)!;
            if (row.owner !== null)
                throw new ProviderError(Number(row.expires_at) <= this.now() ? 'auth_lock_recovery_required' : 'auth_lock_busy');
            const fence = Number(row.fence) + 1;
            requireValue(Number.isSafeInteger(fence), 'auth_fence_exhausted');
            const deadline = this.now() + this.limits.operationMs, lease: Lease = { registrationId: id, owner: randomUUID(), fence, deadline, lost: false, active: true, controller: new AbortController() };
            db.prepare('UPDATE openai_native_auth_lease SET fence=?,owner=?,expires_at=? WHERE registration_id=?').run(fence, lease.owner, Math.min(deadline, this.now() + this.limits.leaseMs), id);
            return lease;
        });
    }
    async withLock<T>(id: string, operation: () => Promise<T>): Promise<T> {
        requireValue(text(id) && !this.context.getStore(), 'nested_or_invalid_auth_lock');
        const waitingUntil = performance.now() + this.limits.waitMs;
        let lease: Lease;
        while (true) {
            try {
                lease = this.acquire(id);
                break;
            }
            catch (error) {
                if (!(error instanceof ProviderError) || !['auth_lock_busy', 'auth_storage_busy'].includes(error.code) || performance.now() >= waitingUntil)
                    throw error;
                await new Promise(resolve => setTimeout(resolve, Math.min(25, this.limits.waitMs)));
            }
        }
        const lose = () => { lease.lost = true; lease.controller.abort(); try {
            this.tx(db => { db.prepare('UPDATE openai_native_auth_lease SET expires_at=0 WHERE registration_id=? AND owner=? AND fence=?').run(id, lease.owner, lease.fence); });
        } catch { /* No late authority: current context is fenced even if storage is unavailable. */ } }, deadline = setTimeout(lose, this.limits.operationMs);
        const renew = setInterval(() => { try {
            this.tx(db => { this.fence(db, lease); db.prepare('UPDATE openai_native_auth_lease SET expires_at=? WHERE registration_id=? AND owner=? AND fence=?').run(Math.min(lease.deadline, this.now() + this.limits.leaseMs), id, lease.owner, lease.fence); });
        }
        catch {
            lose();
        } }, Math.max(1, Math.floor(this.limits.leaseMs / 3)));
        try {
            return await this.context.run(lease, async () => { const result = await abortable(operation(), lease.controller.signal); this.tx(db => this.fence(db, lease)); return result; });
        }
        catch (error) {
            throw lease.lost ? new ProviderError('auth_lock_lost') : error;
        }
        finally {
            clearTimeout(deadline);
            clearInterval(renew);
            lease.active = false;
            if (!lease.lost)
                this.tx(db => { db.prepare('UPDATE openai_native_auth_lease SET owner=NULL,expires_at=0 WHERE registration_id=? AND owner=? AND fence=? AND expires_at>?').run(id, lease.owner, lease.fence, this.now()); });
        }
    }
    /** Optional native fetch wrapper: abort on a lost lease and never begin a late grant. */
    guardedFetch(base: typeof fetch): typeof fetch { return async (input, init) => { const lease = this.context.getStore(); if (!lease) {
        requireValue((init?.method ?? 'GET') === 'GET' && ['https://auth.openai.com/.well-known/openid-configuration', 'https://auth.openai.com/.well-known/jwks.json'].includes(String(input)), 'auth_lock_required');
        return base(input, init);
    } this.tx(db => this.fence(db, lease)); return abortable(base(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, lease.controller.signal]) : lease.controller.signal }), lease.controller.signal); }; }
    async recoverAbandoned(id: string, expectedFence: number, expectedVersion: number | null): Promise<void> {
        requireValue(text(id) && Number.isSafeInteger(expectedFence) && expectedFence >= 1 && (expectedVersion === null || Number.isSafeInteger(expectedVersion) && expectedVersion >= 1) && this.options.authorizeRecovery, 'auth_recovery_unavailable');
        try {
            await this.options.authorizeRecovery({ registrationId: id, expectedFence, expectedVersion });
        }
        catch {
            throw new ProviderError('auth_recovery_denied');
        }
        const row = this.tx(db => { const lease = db.prepare('SELECT owner,fence,expires_at FROM openai_native_auth_lease WHERE registration_id=?').get(id); requireValue(lease && lease.fence === expectedFence && lease.owner !== null && Number(lease.expires_at) <= this.now(), 'auth_recovery_changed'); const result = db.prepare('SELECT * FROM openai_native_auth_registration WHERE registration_id=?').get(id); requireValue((result?.version ?? null) === expectedVersion, 'registration_changed'); return result; });
        const prior = row ? await this.decode(row) : null;
        let next: PrivateRegistration | null = null, cipher: Uint8Array | null = null;
        if (prior) {
            requireValue(Number.isSafeInteger(prior.version + 1), 'registration_version_exhausted');
            next = { ...prior, version: prior.version + 1, accessToken: null, refreshToken: null, idToken: null, scopes: [], expiresAt: 0, nonce: '', enabled: false };
            cipher = await this.encode(next);
        }
        this.tx(db => { db.prepare('UPDATE openai_native_auth_lease SET expires_at=expires_at WHERE registration_id=?').run(id); const lease = db.prepare('SELECT * FROM openai_native_auth_lease WHERE registration_id=?').get(id); requireValue(lease && lease.fence === expectedFence && lease.owner !== null && Number(lease.expires_at) <= this.now(), 'auth_recovery_changed'); requireValue(Number.isSafeInteger(expectedFence + 1), 'auth_fence_exhausted'); const current = db.prepare('SELECT version FROM openai_native_auth_registration WHERE registration_id=?').get(id); requireValue((current?.version ?? null) === expectedVersion, 'registration_changed'); if (next)
            db.prepare('UPDATE openai_native_auth_registration SET version=?,cipher=? WHERE registration_id=? AND version=?').run(next.version, cipher, id, expectedVersion); db.prepare('UPDATE openai_native_auth_lease SET fence=?,owner=NULL,expires_at=0 WHERE registration_id=? AND fence=?').run(expectedFence + 1, id, expectedFence); });
    }
}
