import type { EventEnvelope } from '../../codex-bridge/src/adapter.ts';
import type { GraphData, Message, ContextPackage, Sensitivity } from '../../connected-conversations/src/graph.ts';
import type { Resource } from '../../workspace-kernel/kernel.mts';
import type { DesktopCommand, DesktopSnapshot } from '../../application-contract/contracts.ts';
export const CONTRACT = 'aerynth.integration@0.1' as const;
export type Classification = 'observed' | 'reported' | 'inferred' | 'simulated';
export type ExecutionState = 'dispatching' | 'running' | 'provider_completed' | 'failed' | 'interrupted' | 'unknown';
export interface Binding {
  providerId: string; instanceId: string; accountScope: string;
  nativeThreadId: string; nativeSessionId: string | null;
}
export interface Execution {
  id: string; resourceId: string; providerId: string; state: ExecutionState;
  binding: Binding | null; turnId: string | null; commandId: string;
  startedAt: string; endedAt: string | null; taskVerified: false;
  errorCode?: string;
}
export interface Capability {
  providerId: string; mock: boolean; authentication: string;
  models: string[]; catalogOnly: true; nativeFork: false; chatgptHistory: false;
}
export interface ProviderPort {
  readonly id: string; readonly mock: boolean;
  readonly instanceId: string; readonly accountScope: string;
  connect(): Promise<void>; capabilities(): Promise<Capability>;
  open(): Promise<string>; resume(threadId: string): Promise<string>;
  read(threadId: string): Promise<Record<string, unknown>>;
  items(threadId: string, turnId: string): Promise<Record<string, unknown>>;
  turn(threadId: string, text: string, model?: string): Promise<string>;
  terminal(threadId: string, turnId: string): Promise<EventEnvelope>;
  interrupt(threadId: string, turnId: string): Promise<void>;
  onEvent(listener: (event: EventEnvelope) => void): () => void;
  close(): void;
}
export interface StreamEvent {
  schemaVersion: 1; eventId: string; cursor: number;
  resourceId: string | null; executionId: string | null;
  providerId: string; providerInstanceId: string; connectionId: string;
  nativeEventId: string | null; nativeSequence: number | null;
  threadId: string | null; turnId: string | null;
  correlationId: string | null; causationId: string | null;
  receivedAt: string; providerTime: number | null; providerTimeSource: string | null;
  type: string; classification: Classification;
  status: string | null; payload: { redacted: true; textBytes?: number; itemType?: string; delta?: string };
}
export interface HandoffReview {
  id: string; resourceId: string; sourceResourceId: string; targetProviderId: string;
  sourceRevision: number; fingerprint: string; estimatedTokens: number;
  estimator: 'utf8-bytes-upper-bound'; tokenBudget: number;
  state: 'prepared' | 'approved' | 'rejected' | 'dispatching' | 'applied' | 'failed' | 'interrupted' | 'unknown';
  expiresAt: string; approvedAt?: string;
}
export interface Options {
  path: string; provider?: 'fixture' | 'codex' | 'bridge-fixture'; fixtureMode?: string;
  codexExecutable?: string; codexArgs?: string[]; cwd?: string;
  instanceId?: string; accountScope?: string;
  retention?: { maxEvents: number };
  contentPolicy: 'synthetic-only' | 'local-private';
  /** Host-owned directory outside the source checkout; never accepted from the renderer. */
  privateRoot?: string;
}
export interface CommandMap {
  desktop: { input: DesktopCommand; output: DesktopSnapshot };
  openWorkspace: { input: { workspaceId: string }; output: { workspace: Record<string, unknown>; layout: Record<string, unknown>; blocks: Array<Record<string, unknown>> } };
  selectProvider: { input: { resourceId: string; providerId: string; expectedRevision: number }; output: ConversationView };
  applyOrdinary: { input: { handoffId: string; prompt: string; commandId: string }; output: Message & { resourceId: string; classification: 'simulated' } };
  createConversation: { input: { title: string; providerId?: string; commandId: string }; output: ConversationView };
  addMessage: { input: { resourceId: string; role: 'user' | 'assistant'; content: string; sensitivity?: Sensitivity; expectedRevision: number }; output: Message & { resourceId: string; revision: number } };
  workspace: { input: { title: string; projectTitle?: string }; output: WorkspaceView };
  place: { input: { workspaceId: string; resourceId: string }; output: BlockView };
  move: { input: { blockId: string; workspaceId: string; expectedVersion: number }; output: BlockView };
  branch: { input: { resourceId: string; messageId: string; includeMessageIds: string[]; providerId: string; title: string; commandId: string; tokenBudget: number }; output: { conversation: ConversationView; handoff: HandoffReview; context: ContextPackage; mode: 'application_continuation' } };
  review: { input: { handoffId: string; fingerprint: string; approve: boolean }; output: HandoffReview };
  execute: { input: { resourceId: string; handoffId?: string; prompt: string; commandId: string; model?: string; authorized: boolean }; output: Execution };
  reconcile: { input: { resourceId: string }; output: { resourceId: string; providerThreadAvailable: boolean; executionOutcome: 'unchanged'; nativeStatus?: string; syntheticTurnReceipt?: { completePage: boolean; exactMarker: boolean; itemTypes: string[] } } };
  interrupt: { input: { executionId: string }; output: { requested: true; confirmed: false } };
  capabilities: { input: Record<string, never>; output: Capability };
  snapshot: { input: Record<string, never>; output: Snapshot };
  replay: { input: { after?: number; limit?: number }; output: { events: StreamEvent[]; earliest: number | null; latest: number; truncated: boolean } };
  close: { input: Record<string, never>; output: null };
}
export interface ConversationView { resourceId: string; revision: number; title: string; providerId: string; kind: 'ordinary' | 'codex'; taskId: null; projectId: null }
export interface WorkspaceView { id: string; project_id: string | null; title: string; version: number; state: string; created_at: string; updated_at: string }
export interface BlockView { id: string; resource_id: string; workspace_id: string; version: number; x: number; y: number; z: number; width: number; height: number }
export interface Snapshot {
  contract: typeof CONTRACT; schemaVersion: 1; conversations: ConversationView[];
  graph: GraphData; resourceMap: Record<string, string>; bindings: Record<string, Binding[]>;
  handoffs: Record<string, HandoffReview>; executions: Record<string, Execution>;
  messageEvidence: Record<string, { classification: 'reported' | 'simulated'; executionId: string; providerId: string; nativeTurnId: string; nativeThreadId: string }>;
  resources: Array<{ resource: Resource; conversation?: unknown; externalRefs: unknown[] }>;
  relationships: Array<{ id: string; source_id: string; target_id: string; kind: string; provenance: string }>;
}
export class ServiceError extends Error {
  code: string;
  constructor(code: string) { super(code); this.code = code; }
}
export const ensure: (condition: unknown, code: string) => asserts condition = (condition, code) => { if (!condition) throw new ServiceError(code); };
