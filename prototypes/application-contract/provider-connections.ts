/** Safe connection controls. OAuth URLs, callback codes and credentials never
 * belong to a renderer request, event, persisted view state or this DTO. */
import type { ModelCatalogDiagnostic } from "../openai-provider/contracts.mts";
export const CHATGPT_PLAN_PROVIDER = "chatgpt-plan-responses" as const;
export const PROVIDER_CONNECTION_CONTRACT =
  "aerynth.provider-connection@1" as const;
export interface ProviderConnectionStatus {
  contract: typeof PROVIDER_CONNECTION_CONTRACT;
  providerId: typeof CHATGPT_PLAN_PROVIDER;
  billingRoute: "chatgpt-plan";
  state:
    | "unavailable"
    | "disconnected"
    | "identity-only"
    | "ready"
    | "expired"
    | "recovery-required";
  storageAvailable: boolean;
  pending: boolean;
  registrationVersion: number | null;
  planUsageEnabled: boolean;
  inferenceVerified: false;
  nativeAccountHistory: false;
  nativeAccountMemory: false;
  nativeAccountSync: false;
  errorCode?: string;
  /** A separate, version-bound discovery observation; never inference proof. */
  modelCatalog?: {
    state: "ready" | "unavailable";
    diagnostic: ModelCatalogDiagnostic;
  };
}
export type ProviderConnectionRequest = {
  providerId: typeof CHATGPT_PLAN_PROVIDER;
} & (
  | { type: "status" | "connect" | "cancel" | "refreshModels" }
  | { type: "disconnect" | "refreshSession"; expectedVersion: number }
);
