import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { NativeCredential } from './contracts.mts';
import { abortable, boundedJSON, exact, record } from './common.mts';
import { API_CONNECTION_CONTRACT, VELA_API_PROVIDER, type ApiConnectionCode, type ApiModelCatalog, type ApiSecretStorage, type NativeApiCredentialInput, type RedactedApiConnectionView } from './api-connection-contracts.mts';

/** Apply through the existing canonical migration owner. Constructors never migrate. */
export const API_CONNECTION_SCHEMA_SQL = `
CREATE TABLE openai_api_configuration_schema(version INTEGER NOT NULL CHECK(version=1));
INSERT INTO openai_api_configuration_schema VALUES(1);
CREATE TABLE openai_api_configuration(
 configuration_id TEXT PRIMARY KEY,version INTEGER NOT NULL CHECK(version BETWEEN 1 AND 9007199254740991),
 enabled INTEGER NOT NULL CHECK(enabled IN(0,1)),organization TEXT,project TEXT,cipher BLOB,
 CHECK((enabled=1 AND cipher IS NOT NULL) OR (enabled=0 AND cipher IS NULL)));
`;

export interface ApiConnectionsOptions {
  db: DatabaseSync;
  transaction<T>(operation: (sameDb: DatabaseSync) => T): T;
  secrets: ApiSecretStorage;
  fetch?: typeof fetch;
  now?: () => number;
  limits?: { configurations?: number; catalogModels?: number; catalogBytes?: number; catalogTtlMs?: number; timeoutMs?: number; catalogFlights?: number };
}
export class ApiConnectionError extends Error {
  readonly code: ApiConnectionCode;
  constructor(code: ApiConnectionCode) { super(code); this.name = 'ApiConnectionError'; this.code = code; }
}
const defaults = { configurations: 8, catalogModels: 2048, catalogBytes: 262144, catalogTtlMs: 60000, timeoutMs: 15000, catalogFlights: 2 };
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(value);
const key = (value: unknown): value is string => typeof value === 'string' && value.length >= 16 && value.length <= 4096 && !/[\s\x00-\x1f\x7f]/u.test(value);
const ensure: (value: unknown, code: ApiConnectionCode) => asserts value = (value, code) => { if (!value) throw new ApiConnectionError(code); };
type Row = { configurationId: string; version: number; enabled: boolean; organization?: string; project?: string; cipher: Uint8Array | null };
type Cached = { catalog: ApiModelCatalog; boundaryDigest: string };

/** No database opening, OAuth registration, transcript storage, inference, retries,
 * credential discovery or billing fallback. Mutations use exact-version CAS. */
export class VelaApiConnections {
  private readonly options: ApiConnectionsOptions;
  private readonly limits: typeof defaults;
  private readonly catalogCache = new Map<string, Cached>();
  private readonly catalogFailures = new Set<string>();
  private readonly flights = new Set<string>();
  private readonly lifetime = new AbortController();
  constructor(options: ApiConnectionsOptions) {
    this.options = options;
    this.limits = { ...defaults, ...options.limits };
    for (const [name, max] of Object.entries(defaults)) ensure(Number.isSafeInteger(this.limits[name as keyof typeof defaults]) && this.limits[name as keyof typeof defaults] > 0 && this.limits[name as keyof typeof defaults] <= max, 'api_configuration_invalid');
    this.tx(db => {
      const versions = db.prepare('SELECT version FROM openai_api_configuration_schema').all();
      ensure(versions.length === 1 && versions[0].version === 1, 'api_storage_unavailable');
      db.prepare('SELECT configuration_id,version,enabled,organization,project,cipher FROM openai_api_configuration LIMIT 0').all();
    });
  }
  private assertOpen() { ensure(!this.lifetime.signal.aborted, 'api_connections_closed'); }
  private clock() { const now = this.options.now?.() ?? Date.now(); ensure(Number.isSafeInteger(now) && now >= 0 && now <= 8640000000000000 - this.limits.catalogTtlMs, 'api_configuration_invalid'); return now; }
  private tx<T>(operation: (db: DatabaseSync) => T): T {
    this.assertOpen();
    try {
      let calls = 0;
      const result = this.options.transaction(db => { ensure(db === this.options.db && ++calls === 1, 'api_storage_connection_mismatch'); return operation(db); });
      ensure(calls === 1, 'api_storage_connection_mismatch');
      return result;
    } catch (error) { throw error instanceof ApiConnectionError ? error : new ApiConnectionError('api_storage_unavailable'); }
  }
  private read(configurationId: string): Row | null {
    ensure(id(configurationId), 'api_configuration_invalid');
    return this.tx(db => this.readRow(db, configurationId));
  }
  private readRow(db: DatabaseSync, configurationId: string): Row | null {
      const value = db.prepare('SELECT * FROM openai_api_configuration WHERE configuration_id=?').get(configurationId);
      if (!value) return null;
      ensure(Number.isSafeInteger(value.version) && Number(value.version) >= 1 && (value.enabled === 0 || value.enabled === 1) && (value.organization === null || id(value.organization)) && (value.project === null || id(value.project)), 'api_storage_unavailable');
      const cipher = value.cipher;
      ensure(value.enabled === 0 ? cipher === null : cipher instanceof Uint8Array && cipher.length > 0 && cipher.length <= 65536, 'api_storage_unavailable');
      return { configurationId, version: Number(value.version), enabled: value.enabled === 1, ...(value.organization === null ? {} : { organization: String(value.organization) }), ...(value.project === null ? {} : { project: String(value.project) }), cipher: cipher === null ? null : Uint8Array.from(cipher as Uint8Array) };
  }
  private selected(configurationId: string, expectedVersion: number): Row {
    ensure(Number.isSafeInteger(expectedVersion) && expectedVersion >= 1, 'api_configuration_invalid');
    const row = this.read(configurationId);
    ensure(row?.version === expectedVersion, 'api_configuration_changed');
    ensure(row.enabled && row.cipher, 'api_configuration_disconnected');
    return row;
  }
  private boundary(row: Row) { return hash(JSON.stringify({ providerId: VELA_API_PROVIDER, configurationId: row.configurationId, version: row.version, organization: row.organization ?? null, project: row.project ?? null, cipher: row.cipher ? hash(row.cipher) : null })); }
  private invalidate(configurationId: string) { this.catalogCache.delete(configurationId); this.catalogFailures.delete(configurationId); }
  private async bounded<T>(operation: () => Promise<T>, timeoutCode: ApiConnectionCode = 'api_operation_timeout'): Promise<T> {
    this.assertOpen();
    const signal = AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(this.limits.timeoutMs)]);
    try { const value = await abortable(Promise.resolve().then(operation), signal); this.assertOpen(); return value; }
    catch (error) { if (this.lifetime.signal.aborted) throw new ApiConnectionError('api_connections_closed'); if (signal.aborted) throw new ApiConnectionError(timeoutCode); throw error instanceof ApiConnectionError ? error : new ApiConnectionError('api_secret_unavailable'); }
  }
  private async storage() { ensure(await this.bounded(() => this.options.secrets.available()) === true, 'api_secret_unavailable'); }
  private view(configurationId: string, row: Row | null, storageAvailable: boolean, errorCode?: ApiConnectionCode): RedactedApiConnectionView {
    const cached = this.catalogCache.get(configurationId);
    const catalog = cached && row && cached.catalog.version === row.version ? {
      state: cached.catalog.expiresAt > this.clock() ? 'ready' as const : 'stale' as const,
      observedAt: cached.catalog.observedAt, expiresAt: cached.catalog.expiresAt, modelCount: cached.catalog.models.length,
    } : { state: this.catalogFailures.has(configurationId) ? 'unavailable' as const : 'not-checked' as const };
    return { contract: API_CONNECTION_CONTRACT, providerId: VELA_API_PROVIDER, billingRoute: 'openai-api', configurationId, version: row?.version ?? null, configured: row?.enabled === true,
      state: errorCode || !storageAvailable ? 'unavailable' : row?.enabled ? 'configured' : 'disconnected', storageAvailable,
      ...(row?.organization ? { organization: row.organization } : {}), ...(row?.project ? { project: row.project } : {}), catalog,
      inferenceVerified: false, entitlement: 'unverified', ...(errorCode ? { errorCode } : {}) };
  }
  async status(configurationId: string): Promise<RedactedApiConnectionView> {
    let row = this.read(configurationId);
    try { await this.storage(); if (row?.enabled) await this.resolveNativeCredential(configurationId, row.version); row = this.read(configurationId); return this.view(configurationId, row, true); }
    catch (error) { row = this.read(configurationId); return this.view(configurationId, row, false, error instanceof ApiConnectionError ? error.code : 'api_secret_unavailable'); }
  }
  async configure(input: NativeApiCredentialInput, expectedVersion: number | null = null): Promise<RedactedApiConnectionView> {
    ensure(record(input) && exact(input, ['configurationId', 'apiKey', ...(Object.hasOwn(input, 'organization') ? ['organization'] : []), ...(Object.hasOwn(input, 'project') ? ['project'] : [])]) && id(input.configurationId) && key(input.apiKey) && (input.organization === undefined || id(input.organization)) && (input.project === undefined || id(input.project)) && ![input.configurationId, input.organization, input.project].some(value => value?.includes(input.apiKey)), 'api_configuration_invalid');
    ensure(expectedVersion === null || Number.isSafeInteger(expectedVersion) && expectedVersion >= 1, 'api_configuration_invalid');
    const frozen = { ...input }, before = this.read(frozen.configurationId);
    ensure((before?.version ?? null) === expectedVersion, 'api_configuration_changed');
    const version = (expectedVersion ?? 0) + 1;
    ensure(Number.isSafeInteger(version), 'api_configuration_invalid');
    await this.storage();
    const plaintext = JSON.stringify({ contract: API_CONNECTION_CONTRACT, ...frozen, version });
    const protectedBytes = await this.bounded(() => this.options.secrets.seal(plaintext));
    ensure(protectedBytes instanceof Uint8Array && protectedBytes.length > 0 && protectedBytes.length <= 65536, 'api_secret_invalid');
    const cipher = Uint8Array.from(protectedBytes);
    this.tx(db => {
      const current = this.readRow(db, frozen.configurationId);
      ensure((current?.version ?? null) === expectedVersion, 'api_configuration_changed');
      if (!current) ensure(Number(db.prepare('SELECT count(*) AS n FROM openai_api_configuration').get()!.n) < this.limits.configurations, 'api_configuration_limit');
      if (current) {
        const updated = db.prepare('UPDATE openai_api_configuration SET version=?,enabled=1,organization=?,project=?,cipher=? WHERE configuration_id=? AND version=?').run(version, frozen.organization ?? null, frozen.project ?? null, cipher, frozen.configurationId, expectedVersion!);
        ensure(updated.changes === 1, 'api_configuration_changed');
      } else db.prepare('INSERT INTO openai_api_configuration(configuration_id,version,enabled,organization,project,cipher) VALUES(?,?,1,?,?,?)').run(frozen.configurationId, version, frozen.organization ?? null, frozen.project ?? null, cipher);
    });
    this.invalidate(frozen.configurationId);
    return this.view(frozen.configurationId, this.read(frozen.configurationId), true);
  }
  async rotate(input: NativeApiCredentialInput, expectedVersion: number): Promise<RedactedApiConnectionView> {
    ensure(record(input), 'api_configuration_invalid');
    this.selected(input.configurationId, expectedVersion);
    return this.configure(input, expectedVersion);
  }
  async disconnect(configurationId: string, expectedVersion: number): Promise<RedactedApiConnectionView> {
    ensure(Number.isSafeInteger(expectedVersion) && expectedVersion >= 1 && expectedVersion < Number.MAX_SAFE_INTEGER, 'api_configuration_invalid');
    this.tx(db => {
      ensure(id(configurationId), 'api_configuration_invalid');
      const row = this.readRow(db, configurationId);
      ensure(row?.version === expectedVersion, 'api_configuration_changed');
      const result = db.prepare('UPDATE openai_api_configuration SET version=version+1,enabled=0,organization=NULL,project=NULL,cipher=NULL WHERE configuration_id=? AND version=?').run(configurationId, expectedVersion);
      ensure(result.changes === 1, 'api_configuration_changed');
    });
    this.invalidate(configurationId);
    return this.status(configurationId);
  }
  async resolveNativeCredential(configurationId: string, expectedVersion: number): Promise<NativeCredential> {
    const row = this.selected(configurationId, expectedVersion), boundaryDigest = this.boundary(row);
    await this.storage();
    const plaintext = await this.bounded(() => this.options.secrets.open(row.cipher!));
    ensure(typeof plaintext === 'string' && Buffer.byteLength(plaintext) <= 16384, 'api_secret_invalid');
    let envelope: unknown;
    try { envelope = JSON.parse(plaintext); } catch { throw new ApiConnectionError('api_secret_invalid'); }
    ensure(record(envelope) && exact(envelope, ['contract', 'configurationId', 'apiKey', 'version', ...(row.organization === undefined ? [] : ['organization']), ...(row.project === undefined ? [] : ['project'])]) && envelope.contract === API_CONNECTION_CONTRACT && envelope.configurationId === configurationId && envelope.version === row.version && envelope.organization === row.organization && envelope.project === row.project && key(envelope.apiKey), 'api_secret_invalid');
    ensure(this.boundary(this.selected(configurationId, expectedVersion)) === boundaryDigest, 'api_configuration_changed');
    return { providerId: VELA_API_PROVIDER, kind: 'openai-api-key', boundaryDigest, bearer: envelope.apiKey, ...(row.organization ? { organization: row.organization } : {}), ...(row.project ? { project: row.project } : {}) };
  }
  async revalidate(configurationId: string, expectedVersion: number, boundaryDigest: string): Promise<void> {
    ensure(typeof boundaryDigest === 'string' && /^[a-f0-9]{64}$/.test(boundaryDigest), 'api_configuration_invalid');
    await this.storage();
    ensure(this.boundary(this.selected(configurationId, expectedVersion)) === boundaryDigest, 'api_configuration_changed');
  }
  async modelCatalog(configurationId: string, expectedVersion: number): Promise<ApiModelCatalog> {
    this.selected(configurationId, expectedVersion);
    ensure(!this.flights.has(configurationId) && this.flights.size < this.limits.catalogFlights, 'api_catalog_busy');
    this.flights.add(configurationId);
    try {
      const credential = await this.resolveNativeCredential(configurationId, expectedVersion);
      await this.revalidate(configurationId, expectedVersion, credential.boundaryDigest);
      const signal = AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(this.limits.timeoutMs)]);
      const headers: Record<string, string> = { Authorization: 'Bearer ' + credential.bearer, Accept: 'application/json' };
      if (credential.organization) headers['OpenAI-Organization'] = credential.organization;
      if (credential.project) headers['OpenAI-Project'] = credential.project;
      let response: Response;
      try { response = await abortable((this.options.fetch ?? fetch)('https://api.openai.com/v1/models', { method: 'GET', headers, signal, redirect: 'error', credentials: 'omit', cache: 'no-store' }), signal); }
      catch { throw new ApiConnectionError(this.lifetime.signal.aborted ? 'api_connections_closed' : signal.aborted ? 'api_operation_timeout' : 'api_catalog_unavailable'); }
      if (!response.ok) { void response.body?.cancel().catch(() => {}); throw new ApiConnectionError('api_catalog_unavailable'); }
      let data: unknown;
      try { data = await boundedJSON(response, this.limits.catalogBytes, signal); }
      catch (error) { throw new ApiConnectionError(this.lifetime.signal.aborted ? 'api_connections_closed' : signal.aborted ? 'api_operation_timeout' : record(error) && error.code === 'response_capacity_exceeded' ? 'api_catalog_capacity' : 'api_catalog_invalid'); }
      ensure(record(data) && Array.isArray(data.data) && data.data.length <= this.limits.catalogModels, 'api_catalog_invalid');
      const models = data.data.map(value => { ensure(record(value) && id(value.id) && !value.id.includes(credential.bearer), 'api_catalog_invalid'); return { id: value.id, label: value.id }; });
      ensure(new Set(models.map(model => model.id)).size === models.length, 'api_catalog_invalid');
      await this.revalidate(configurationId, expectedVersion, credential.boundaryDigest);
      const observedAt = this.clock(), catalog: ApiModelCatalog = { providerId: VELA_API_PROVIDER, configurationId, version: expectedVersion, observedAt, expiresAt: observedAt + this.limits.catalogTtlMs, catalogOnly: true, inferenceVerified: false, capabilities: 'unverified', models };
      this.catalogCache.set(configurationId, { catalog, boundaryDigest: credential.boundaryDigest });
      this.catalogFailures.delete(configurationId);
      return structuredClone(catalog);
    } catch (error) {
      this.catalogCache.delete(configurationId);
      if (this.read(configurationId)?.version === expectedVersion) this.catalogFailures.add(configurationId);
      throw error instanceof ApiConnectionError ? error : new ApiConnectionError('api_catalog_unavailable');
    } finally { this.flights.delete(configurationId); }
  }
  async resolveCatalog(configurationId: string, expectedVersion: number): Promise<{ boundaryDigest: string; expiresAt: number; models: readonly string[] }> {
    const cached = this.catalogCache.get(configurationId);
    ensure(cached && cached.catalog.version === expectedVersion && cached.catalog.expiresAt > this.clock(), 'api_catalog_stale');
    await this.revalidate(configurationId, expectedVersion, cached.boundaryDigest);
    ensure(this.catalogCache.get(configurationId) === cached && cached.catalog.expiresAt > this.clock(), 'api_catalog_stale');
    return { boundaryDigest: cached.boundaryDigest, expiresAt: cached.catalog.expiresAt, models: cached.catalog.models.map(model => model.id) };
  }
  close() { this.lifetime.abort(); this.catalogCache.clear(); this.catalogFailures.clear(); }
}
