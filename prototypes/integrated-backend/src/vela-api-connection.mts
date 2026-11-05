import type { DatabaseSync } from 'node:sqlite';
import { API_CONNECTION_SCHEMA_SQL, ApiConnectionError, VelaApiConnections } from '../../openai-provider/api-connections.mts';
import type { ApiConnectionsOptions } from '../../openai-provider/api-connections.mts';
import type { ApiModelCatalog, NativeApiCredentialInput, RedactedApiConnectionView } from '../../openai-provider/api-connection-contracts.mts';
import type { NativeHostServices } from './native-host.mts';

export const VELA_API_CONFIGURATION_ID = 'vela-primary' as const;
export type VelaApiConnectionRequest = { type: 'status' } | { type: 'catalog' | 'disconnect'; expectedVersion: number };
export type VelaApiConnectionResult = RedactedApiConnectionView | ApiModelCatalog;
export interface VelaApiConnectionOptions {
  db: DatabaseSync;
  transaction<T>(operation: (sameDb: DatabaseSync) => T): T;
  nativeHost?: NativeHostServices;
  /** Synthetic fixtures only in the Core integration; never a renderer option. */
  fetch?: typeof fetch;
  now?: () => number;
  limits?: ApiConnectionsOptions['limits'];
}
const ensure: (value: unknown, code?: 'api_configuration_invalid' | 'api_secret_unavailable' | 'api_storage_unavailable') => asserts value =
  (value, code = 'api_configuration_invalid') => { if (!value) throw new ApiConnectionError(code); };
/** Data properties only: do not invoke accessors while validating an IPC DTO. */
const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && keys.every(name => Object.hasOwn(Object.getOwnPropertyDescriptor(value, name) ?? {}, 'value'));
};
const version = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 1;

export function parseVelaApiConnectionRequest(input: unknown): VelaApiConnectionRequest {
  if (exact(input, ['type']) && input.type === 'status') return { type: 'status' };
  ensure(exact(input, ['type', 'expectedVersion']) && (input.type === 'catalog' || input.type === 'disconnect') && version(input.expectedVersion));
  return { type: input.type, expectedVersion: input.expectedVersion };
}

/** Canonical migration owner calls this inside its existing SQLite transaction.
 * The service constructor never opens or migrates a database. */
export function migrateVelaApiConnection(db: DatabaseSync): void {
  try {
    ensure(db.isTransaction, 'api_storage_unavailable');
    const expected = ['openai_api_configuration_schema', 'openai_api_configuration'];
    const present = expected.filter(name => db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
    if (!present.length) db.exec(API_CONNECTION_SCHEMA_SQL);
    else ensure(present.length === expected.length, 'api_storage_unavailable');
    const versions = db.prepare('SELECT version FROM openai_api_configuration_schema').all();
    ensure(versions.length === 1 && versions[0].version === 1, 'api_storage_unavailable');
    const columns = db.prepare('PRAGMA table_info(openai_api_configuration)').all().map(row => row.name);
    ensure(columns.length === 6 && ['configuration_id', 'version', 'enabled', 'organization', 'project', 'cipher'].every(name => columns.includes(name)), 'api_storage_unavailable');
    db.prepare('SELECT configuration_id,version,enabled,organization,project,cipher FROM openai_api_configuration LIMIT 0').all();
  } catch (error) { throw error instanceof ApiConnectionError ? error : new ApiConnectionError('api_storage_unavailable'); }
}

/** One fixed, separately billed Vela API connection in the canonical database.
 * Credentials travel solely through the native host's protected-storage port.
 * Public requests can never configure or resolve a credential. */
export class VelaApiConnection {
  static migrate = migrateVelaApiConnection;
  private readonly service: VelaApiConnections;
  private readonly native: boolean;
  constructor(options: VelaApiConnectionOptions) {
    this.native = !!options.nativeHost;
    this.service = new VelaApiConnections({ ...options, secrets: options.nativeHost?.secrets ?? {
      available: async () => false,
      seal: async () => { throw new ApiConnectionError('api_secret_unavailable'); },
      open: async () => { throw new ApiConnectionError('api_secret_unavailable'); },
    } });
  }
  status(): Promise<RedactedApiConnectionView> { return this.service.status(VELA_API_CONFIGURATION_ID); }
  catalog(expectedVersion: number): Promise<ApiModelCatalog> { return this.service.modelCatalog(VELA_API_CONFIGURATION_ID, expectedVersion); }
  disconnect(expectedVersion: number): Promise<RedactedApiConnectionView> { return this.service.disconnect(VELA_API_CONFIGURATION_ID, expectedVersion); }
  request(input: unknown): Promise<VelaApiConnectionResult> {
    const request = parseVelaApiConnectionRequest(input);
    return request.type === 'status' ? this.status() : request.type === 'catalog' ? this.catalog(request.expectedVersion) : this.disconnect(request.expectedVersion);
  }
  /** Trusted native command only. The Core independently enforces private mode. */
  configureNative(input: NativeApiCredentialInput, expectedVersion: number | null): Promise<RedactedApiConnectionView> {
    ensure(this.native, 'api_secret_unavailable');
    const keys = ['configurationId', 'apiKey', ...(Object.hasOwn(input ?? {}, 'organization') ? ['organization'] : []), ...(Object.hasOwn(input ?? {}, 'project') ? ['project'] : [])];
    ensure(exact(input, keys) && input.configurationId === VELA_API_CONFIGURATION_ID && (expectedVersion === null || version(expectedVersion)));
    return this.service.configure(input, expectedVersion);
  }
  /** Native execution authority only. Never return these values through RPCs. */
  resolveNativeCredential(expectedVersion: number) { return this.service.resolveNativeCredential(VELA_API_CONFIGURATION_ID, expectedVersion); }
  revalidate(expectedVersion: number, boundaryDigest: string) { return this.service.revalidate(VELA_API_CONFIGURATION_ID, expectedVersion, boundaryDigest); }
  resolveCatalog(expectedVersion: number) { return this.service.resolveCatalog(VELA_API_CONFIGURATION_ID, expectedVersion); }
  close() { this.service.close(); }
}
