/** Browser-safe Vela contracts. Canonical data and provider execution remain host-owned. */
export const VELA_CONTRACT = 'aerynth.vela@1' as const;
export type EvidenceClass = 'observed' | 'reported' | 'inferred' | 'unknown';
export type AttentionMode = 'normal' | 'quiet' | 'focused' | 'collaborative' | 'proactive';
export type SubjectKind = 'resource' | 'workspace' | 'project';
export interface ResourceRef { id: string; kind: SubjectKind; version: number; title: string; resourceKind?: string }
export interface VelaScope {
  principalId: string; policyVersion: string;
  resourceIds: string[]; workspaceIds: string[]; projectIds: string[];
}
export interface ContextEntry extends ResourceRef {
  reason: 'selected' | 'explicit' | 'targeted-search';
  content: string; contentDigest: string; source: string;
  trust: 'untrusted-source-data';
}
export interface ContextManifest {
  id: string; createdAt: string; policyVersion: string;
  /** Metadata discovery does not imply that content was read or sent to a provider. */
  discovered: ResourceRef[]; included: ContextEntry[];
  omitted: { id: string; reason: string }[];
  contentBytes: number; coverage: 'explicit-resources-only';
}
export type VelaNativeAction =
  | { type: 'navigate'; target: { kind: 'workspace'; workspaceId: string } | { kind: 'constellation'; projectId: string | null } }
  | { type: 'workspaceFromResources'; title: string; projectId: string | null; resourceIds: string[] }
  | { type: 'createResource'; kind: 'note' | 'task' | 'task_group'; title: string; workspaceId: string | null }
  | { type: 'attach'; workspaceId: string; resourceId: string }
  | { type: 'content'; resourceId: string; expectedVersion: number; content: string }
  | { type: 'taskStatus'; resourceId: string; expectedVersion: number; status: 'open' | 'done' }
  | { type: 'setTaskGroupMembers'; groupId: string; expectedVersion: number; taskIds: string[] }
  | { type: 'relate'; sourceId: string; targetId: string; kind: string }
  | { type: 'applyStructuredPreset'; workspaceId: string; preset: 'balanced' | 'focus' | 'development' | 'research' };
export interface CapabilityDescriptor {
  id: VelaNativeAction['type'] | 'search' | 'delegateTask'; label: string;
  effect: 'read' | 'navigate' | 'create' | 'mutate' | 'provider-execution';
  scope: string; authorization: 'host-policy' | 'explicit-execution-authorization';
  /** JSON-schema-shaped public contract; runtime validation also rejects unknown fields. */
  schema: Record<string, unknown>; reversible: 'host-dependent' | 'no-state-change';
}
export interface VelaMessage {
  id: string; role: 'user' | 'assistant' | 'system'; content: string;
  source: 'user' | 'vela-native' | 'provider'; providerId?: string;
  requestId?: string; planId?: string; classification: EvidenceClass;
}
export interface CanonicalConversation { resourceId: string; revision: number; messages: VelaMessage[] }
export interface ProviderContribution { providerId: string; model?: string; nativeThreadId?: string; nativeTurnId?: string; classification: 'reported' }
export interface DelegateTaskAction {
  type: 'delegateTask'; title: string; objective: string; providerId: string;
  resourceIds: string[]; constraints: string[];
}
export interface PlanStep { id: string; explanation: string; action: VelaNativeAction | DelegateTaskAction }
export interface ProviderProposal {
  schemaVersion: 1; summary: string; steps: PlanStep[];
  contribution: ProviderContribution;
}
export interface VelaPlanningPort {
  readonly providerId: string;
  /** Availability is observed by the adapter, never inferred from a model catalog. */
  availability(): { available: boolean; busy: boolean; reason?: string };
  propose(input: {
    requestId: string; conversationId: string; intent: string;
    context: ContextManifest; capabilities: CapabilityDescriptor[];
    instruction: string;
  }, signal: AbortSignal): Promise<unknown>;
}
export type RequestState = 'planning' | 'awaiting-review' | 'native-ready' | 'provider-unavailable' | 'invalid-plan' | 'failed' | 'cancelled' | 'unknown' | 'completed';
export interface VelaRequest {
  id: string; conversationId: string; intent: string; state: RequestState;
  createdAt: string; updatedAt: string; providerId: string | null;
  context: ContextManifest; planId?: string; errorCode?: string;
  /** Raw provider plans are preserved locally, including invalid plans; never interpreted as commands. */
  invalidProposal?: unknown;
}
export type PlanState = 'prepared' | 'approved' | 'rejected' | 'applying' | 'applied' | 'failed' | 'cancelled' | 'unknown';
export interface VelaPlan {
  id: string; requestId: string; version: 1; fingerprint: string;
  summary: string; steps: PlanStep[]; targets: ResourceRef[];
  scope: VelaScope; state: PlanState; createdAt: string; expiresAt: string;
  contribution: ProviderContribution | null;
  authorizationRef?: string; reviewedAt?: string;
}
export interface ActionReceipt {
  id: string; planId: string; requestId: string; stepId: string; commandId: string;
  source: 'vela'; providerId: string | null;
  state: 'started' | 'applied' | 'failed' | 'cancelled' | 'unknown';
  startedAt: string; endedAt?: string; hostReceiptId?: string; errorCode?: string;
  createdResourceId?: string; createdWorkspaceId?: string;
  /** A delegated provider completing a turn is not verified task completion. */
  taskVerified: false;
}
export interface AuthorizationRequest {
  phase: 'prepare' | 'provider-context' | 'review' | 'apply' | 'delegate';
  requestId: string; planId?: string; fingerprint?: string;
  intent: string; scope: VelaScope; targets: ResourceRef[];
  actions: (VelaNativeAction | DelegateTaskAction)[]; providerId?: string;
  /** Only populated from already-recorded host-issued review authorization. */
  priorAuthorizationRef?: string;
}
export type AuthorizationDecision =
  | { decision: 'allow'; authorizationRef: string; policyVersion: string }
  | { decision: 'deny'; reason: string; policyVersion: string };
export interface HostActionResult {
  status: 'applied' | 'failed' | 'cancelled' | 'unknown'; receiptId: string;
  errorCode?: string; createdResourceId?: string; createdWorkspaceId?: string;
}
export interface VelaHostPort {
  scope(): VelaScope;
  /** Both conversation operations use the canonical host resource/graph, on the injected db transaction. */
  ensureConversation(key: 'system:vela'): string;
  readConversation(resourceId: string): CanonicalConversation;
  appendMessage(resourceId: string, message: Omit<VelaMessage, 'id'>): VelaMessage;
  search(query: string, scope: VelaScope, limit: number): ResourceRef[];
  resolve(ref: Pick<ResourceRef, 'id' | 'kind'>, scope: VelaScope): ResourceRef | null;
  readContent(id: string, scope: VelaScope): { ref: ResourceRef; content: string; source: string } | null;
  /** Must evaluate actual host policy, issue opaque references, and revalidate grants at the action boundary. */
  authorize(request: AuthorizationRequest): AuthorizationDecision;
  /** Must be idempotent by commandId. workspaceFromResources is one atomic canonical create/attach operation. */
  applyNative(input: {
    action: VelaNativeAction; commandId: string; requestId: string; planId: string;
    intent: string; expectedVersions: ResourceRef[]; authorizationRef: string;
  }): HostActionResult;
  /** Execution truth remains in host execution storage; this module retains only a link/receipt. */
  delegateTask?(input: {
    action: DelegateTaskAction; commandId: string; requestId: string; planId: string;
    initiatingIntent: string; sourceConversationId: string;
    context: ContextManifest; authorizationRef: string;
  }): Promise<HostActionResult>;
}
export interface AttentionPreferences {
  version: number; mode: AttentionMode; monitoringEnabled: boolean; delegationEnabled: boolean;
  allowedEventTypes: string[]; minimumSeverity: 'info' | 'warning' | 'critical';
  maxInterruptionsPerHour: number; source: 'explicit' | 'default';
  updatedAt: string; learning: 'disabled';
}
export interface AppAttentionEvent {
  id: string; type: string; source: string; occurredAt: string;
  subject: Pick<ResourceRef, 'id' | 'kind'> | null;
  severity: 'info' | 'warning' | 'critical'; classification: EvidenceClass;
  summary: string; correlationId: string; coverageGap?: string;
}
export interface AttentionItem extends AppAttentionEvent {
  receivedAt: string; disposition: 'silent' | 'digest' | 'interrupt'; reason: string;
  reviewedAt: string | null; dismissedAt: string | null;
}
export interface VelaState {
  contract: typeof VELA_CONTRACT; identity: { id: 'system:vela'; name: 'Vela'; role: 'application-assistant' };
  conversation: CanonicalConversation | null;
  planner: { providerId: string | null; available: boolean; busy: boolean; reason?: string };
  capabilities: CapabilityDescriptor[]; requests: VelaRequest[]; plans: VelaPlan[];
  receipts: ActionReceipt[]; preferences: AttentionPreferences; attention: AttentionItem[];
  lastPresenceAt: string | null; coverage: 'authorized-app-events-only';
}
export interface VelaClient {
  state(): Promise<VelaState>;
  open(): Promise<VelaState>;
  search(query: string): Promise<ResourceRef[]>;
  request(input: { intent: string; resourceIds: string[]; authorizeProvider: boolean }): Promise<VelaRequest>;
  native(input: { intent: string; action: VelaNativeAction }): Promise<VelaPlan>;
  review(input: { planId: string; fingerprint: string; decision: 'approve' | 'reject' }): Promise<VelaPlan>;
  apply(planId: string): Promise<VelaPlan>;
  cancel(requestId: string): Promise<VelaRequest>;
  preferences(input: { expectedVersion: number; patch: Partial<Omit<AttentionPreferences, 'version' | 'source' | 'updatedAt' | 'learning'>> }): Promise<AttentionPreferences>;
  reviewAttention(ids: string[]): Promise<void>;
}
