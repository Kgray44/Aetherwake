/** Dedicated Vela API configuration. Secret-bearing inputs are native-only,
 * never renderer RPCs, view state, logs, or canonical conversation content. */
export const VELA_API_PROVIDER = 'openai-api-vela' as const;
export const API_CONNECTION_CONTRACT = 'aerynth.vela-api-connection@1' as const;

export interface NativeApiCredentialInput {
  configurationId: string;
  apiKey: string;
  organization?: string;
  project?: string;
}

export type ApiConnectionCode =
  | 'api_configuration_invalid' | 'api_configuration_changed' | 'api_configuration_disconnected'
  | 'api_configuration_limit' | 'api_storage_unavailable' | 'api_storage_connection_mismatch'
  | 'api_secret_unavailable' | 'api_secret_invalid' | 'api_operation_timeout'
  | 'api_connections_closed' | 'api_catalog_unavailable' | 'api_catalog_invalid'
  | 'api_catalog_stale' | 'api_catalog_busy' | 'api_catalog_capacity';

export interface RedactedApiConnectionView {
  contract: typeof API_CONNECTION_CONTRACT;
  providerId: typeof VELA_API_PROVIDER;
  billingRoute: 'openai-api';
  configurationId: string;
  version: number | null;
  configured: boolean;
  state: 'disconnected' | 'configured' | 'unavailable';
  storageAvailable: boolean;
  /** Configuration values only; no credential, suffix, fingerprint or boundary digest. */
  organization?: string;
  project?: string;
  catalog: { state: 'not-checked' | 'ready' | 'stale' | 'unavailable'; observedAt?: number; expiresAt?: number; modelCount?: number };
  inferenceVerified: false;
  entitlement: 'unverified';
  errorCode?: ApiConnectionCode;
}

export interface ApiModelCatalog {
  providerId: typeof VELA_API_PROVIDER;
  configurationId: string;
  version: number;
  observedAt: number;
  expiresAt: number;
  catalogOnly: true;
  inferenceVerified: false;
  /** GET /models does not establish reasoning controls, token limits or entitlement. */
  capabilities: 'unverified';
  models: { id: string; label: string }[];
}

/** Same shape as NativeHostServices.secrets; injected exclusively by the host. */
export interface ApiSecretStorage {
  available(): Promise<boolean>;
  seal(plaintext: string): Promise<Uint8Array>;
  open(cipher: Uint8Array): Promise<string>;
}
