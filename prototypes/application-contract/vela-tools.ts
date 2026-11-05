/** Source-owned tool metadata. Discovery and opaque references confer no authority. */
export type VelaToolFamily = 'application' | 'windows' | 'codex' | 'specialist';
export type VelaToolAvailability = 'available' | 'unavailable' | 'unknown';
export interface VelaToolDescriptor {
  id: string;
  family: VelaToolFamily;
  label: string;
  description: string;
  availability: VelaToolAvailability;
  unavailableReason?: string;
  effect: 'read' | 'mutate' | 'prepare' | 'provider-execution';
  authorization: 'host-policy' | 'native-review' | 'explicit-execution-authorization';
  scope: string;
  schema: Record<string, unknown>;
  schemaDigest: string;
  owner: string;
  /** Native owner declaration only; omission requires serial execution. */
  readConcurrency?: { claims: string[] };
}
export interface VelaToolCatalog {
  contract: 'aerynth.vela.tools@1';
  digest: string;
  scopeDigest: string;
  discovery: 'complete' | 'partial' | 'failed';
  descriptors: VelaToolDescriptor[];
}
export interface VelaToolInvocation {
  catalogDigest: string;
  capabilityId: string;
  schemaDigest: string;
  invocationId: string;
  argumentsJson: string;
}
export type VelaToolResultState = 'observed' | 'no-op' | 'awaiting-review' |
  'running' | 'denied' | 'unavailable' | 'unknown' | 'discovery-failed';
export interface VelaToolReceipt {
  contract: 'aerynth.vela.tool-receipt@1';
  id: string;
  workflowId: string;
  requestId: string;
  invocationId: string;
  capabilityId: string;
  catalogDigest: string;
  scopeDigest: string;
  inputDigest: string;
  outputDigest: string;
  state: VelaToolResultState;
  observedAt: string;
  /** Bounded, permitted projection; full owner results stay with their owner. */
  outputJson: string;
  verification: { kind: 'owner-observed' | 'reported' | 'unverified'; evidenceRefs: string[] };
  pause: 'none' | 'native-review' | 'owner-job';
}
export type VelaWorkflowPhase = 'running' | 'verified' | 'partial' | 'blocked' |
  'clarification' | 'awaiting-review' | 'waiting-job' | 'budget-exhausted' | 'unknown';
export interface VelaWorkflowBudget {
  maxProviderRequests: number;
  maxToolCalls: number;
  providerRequests: number;
  toolCalls: number;
  deadline: string;
}
/** Runtime-local native port, never a renderer RPC or serialized authority. */
export interface VelaToolPort {
  workflowId: string;
  catalog: VelaToolCatalog;
  budget: VelaWorkflowBudget;
  validate(): void;
  discovered(input: { executionId: string; callId: string; catalogDigest: string;
    schemas: { id: string; schemaDigest: string }[] }): void;
  invoke(input: VelaToolInvocation, signal: AbortSignal): Promise<VelaToolReceipt>;
  checkpoint(phase: VelaWorkflowPhase, reason?: string): void;
}
/** Renderer-safe pending operation metadata. Native decisions and identities stay private. */
export interface VelaHostOperationView {
  id: string;
  requestId: string;
  workflowId: string;
  capabilityId: string;
  state: VelaToolResultState;
  title: string;
  summary: string;
  receiptId?: string;
  /** Verified work units for this request; permission/selection steps count zero. */
  jobsDone?: number;
  reviewAvailable: boolean;
}
