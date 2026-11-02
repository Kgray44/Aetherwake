import type { OrganizationUpdate, TaskPriority } from '../../application-contract/contracts.ts';
import type { HistoryOrigin, HistoryProvenance, HistoryMessageDependency, ProviderHistory } from './history-contracts.ts';
/** Browser-safe Vela contracts. Canonical data and provider execution remain host-owned. */
export const VELA_CONTRACT = 'aerynth.vela@1' as const;
export type EvidenceClass = 'observed' | 'reported' | 'inferred' | 'unknown';
export type AttentionMode = 'normal' | 'quiet' | 'focused' | 'collaborative' | 'proactive';
export type SubjectKind = 'resource' | 'workspace' | 'project' | 'collection';
export interface ResourceRef { id: string; kind: SubjectKind; version: number; title: string; resourceKind?: string; projectId?: string | null; state?: 'active' | 'archived' }
export interface VelaScope {
  principalId: string; policyVersion: string;
  resourceIds: string[]; workspaceIds: string[]; projectIds: string[];
  /** Absent in legacy scopes; absence never grants collection access. */
  collectionIds?: string[];
}
/** Internal purpose derived only from validated explicit restoration steps. */
export interface VelaScopePurpose { restoreCollectionIds?: readonly string[] }
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
  /** Exact reviewed egress only. Persisted request context never copies these canonical message bodies. */
  history?: ProviderHistory;
}
export type VelaNativeAction =
  | { type: 'navigate'; target: { kind: 'workspace'; workspaceId: string } | { kind: 'constellation'; projectId: string | null } }
  | { type: 'createProject'; title: string }
  | { type: 'renameProject'; projectId: string; title: string }
  | { type: 'renameResource'; resourceId: string; title: string }
  | { type: 'associateResourceProject'; resourceId: string; projectId: string | null }
  | { type: 'createWorkspace'; title: string; projectId: string | null }
  | { type: 'renameWorkspace'; workspaceId: string; title: string }
  | { type: 'bringAllIntoView'; workspaceId: string }
  | { type: 'resolveLayout'; workspaceId: string }
  | { type: 'setOrganization'; workspaceId: string; organization: OrganizationUpdate }
  | { type: 'createConversation'; title: string; providerId: 'local' | 'codex-app-server' }
  | { type: 'conversationFavorite'; resourceId: string; favorite: boolean }
  | { type: 'renameConversation'; resourceId: string; title: string }
  | { type: 'associateConversationProject'; resourceId: string; projectId: string | null }
  | { type: 'createCollection'; title: string; projectId: string | null }
  | { type: 'renameCollection'; collectionId: string; title: string }
  | { type: 'archiveCollection'; collectionId: string; archived: boolean }
  | { type: 'collectionMembership'; collectionId: string; resourceId: string; member: boolean }
  | { type: 'workspaceFromResources'; title: string; projectId: string | null; resourceIds: string[] }
  | { type: 'createResource'; kind: 'note' | 'task' | 'task_group'; title: string; workspaceId: string | null }
  | { type: 'attach'; workspaceId: string; resourceId: string }
  | { type: 'content'; resourceId: string; expectedVersion: number; content: string }
  | { type: 'taskStatus'; resourceId: string; expectedVersion: number; status: 'open' | 'done' }
  | { type: 'taskPriority'; resourceId: string; expectedVersion: number; priority: TaskPriority }
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
  /** Parsed conversational content remains attributed to the actual observed provider output. */
  responseKind?: ProviderReplyKind; providerContribution?: ProviderContribution;
}
export interface CanonicalConversation { resourceId: string; revision: number; messages: VelaMessage[] }
export interface ProviderContribution {
  providerId: string; model?: string; nativeThreadId?: string; nativeTurnId?: string;
  executionId?: string; planningConversationId?: string; sourceMessageId?: string;
  classification: 'reported';
}
export interface DelegateTaskAction {
  type: 'delegateTask'; title: string; objective: string; providerId: string;
  resourceIds: string[]; constraints: string[];
}
export interface PlanStep { id: string; explanation: string; action: VelaNativeAction | DelegateTaskAction }
/** Legacy wire-v1 action plan; accepted on read and normalized to ProviderResult. */
export interface ProviderProposal {
  schemaVersion: 1; summary: string; steps: PlanStep[];
  contribution: ProviderContribution;
}
export type ProviderReplyKind = 'answer' | 'clarification' | 'inability';
export type ProviderResult =
  | { schemaVersion: 2; kind: 'plan'; summary: string; steps: PlanStep[]; contribution: ProviderContribution }
  | { schemaVersion: 2; kind: ProviderReplyKind; content: string; contribution: ProviderContribution };
export interface VelaPlanningPort {
  readonly providerId: string;
  /** Availability is observed by the adapter, never inferred from a model catalog. */
  availability(): { available: boolean; busy: boolean; reason?: string };
  /** Returns untrusted wire-v2 result or a legacy v1 plan; both are validated by the service. */
  propose(input: {
    requestId: string; conversationId: string; intent: string;
    context: ContextManifest; capabilities: CapabilityDescriptor[];
    instruction: string;
  }, signal: AbortSignal): Promise<unknown>;
}
export type RequestState = 'planning' | 'awaiting-review' | 'native-ready' | 'provider-unavailable' | 'invalid-plan' | 'failed' | 'cancelled' | 'unknown' | 'completed' | 'responded';
export interface VelaRequest {
  id: string; conversationId: string; intent: string; state: RequestState;
  createdAt: string; updatedAt: string; providerId: string | null;
  context: ContextManifest; planId?: string; errorCode?: string;
  /** Reference only: content lives in the SAME canonical conversation, never a second transcript. */
  response?: { kind: ProviderReplyKind; messageId: string; contentDigest?: string };
  /** Schema-3 provenance is absent on legacy requests; unavailable origin is never inferred as known-null. */
  origin?: HistoryOrigin; inputMessageId?: string; inputContentDigest?: string; provenance?: HistoryProvenance;
  /** References/proofs only; actual history text remains in the canonical conversation. */
  history?: { schemaVersion: 1; fenceDigest: string; historyDigest: string; messages: readonly HistoryMessageDependency[] };
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
  createdResourceId?: string; createdWorkspaceId?: string; createdProjectId?: string; createdCollectionId?: string;
  /** A delegated provider completing a turn is not verified task completion. */
  taskVerified: false;
}
export interface AuthorizationRequest {
  phase: 'prepare' | 'provider-context' | 'review' | 'apply' | 'delegate' | 'adaptation';
  requestId: string; planId?: string; fingerprint?: string;
  intent: string; scope: VelaScope; targets: ResourceRef[];
  actions: (VelaNativeAction | DelegateTaskAction | VelaPreferenceAction)[]; providerId?: string;
  /** Full prospective egress manifest: metadata discovery and read content remain distinct. */
  contextManifest?: ContextManifest;
  /** Only populated from already-recorded host-issued review authorization. */
  priorAuthorizationRef?: string;
}
export type AuthorizationDecision =
  | { decision: 'allow'; authorizationRef: string; policyVersion: string }
  | { decision: 'deny'; reason: string; policyVersion: string };
export interface HostActionResult {
  status: 'applied' | 'failed' | 'cancelled' | 'unknown'; receiptId: string;
  errorCode?: string; createdResourceId?: string; createdWorkspaceId?: string; createdProjectId?: string; createdCollectionId?: string;
}
export interface VelaHostPort {
  scope(purpose?: VelaScopePurpose): VelaScope;
  /** Existing navigation metadata, when the host has it; not implicit provider content or retrieval authority. */
  context?(): { currentProjectId: string | null; currentWorkspaceId: string | null };
  /** Explicit metadata only, inserted into the actual consent/planner manifest before authorization. */
  contextReferences?(selectedResourceIds: readonly string[]): ResourceRef[];
  /** Both conversation operations use the canonical host resource/graph, on the injected db transaction. */
  ensureConversation(key: 'system:vela'): string;
  readConversation(resourceId: string): CanonicalConversation;
  /** Cheap authoritative graph revision; never implemented by cloning the transcript. */
  conversationRevision?(resourceId: string): number | null;
  appendMessage(resourceId: string, message: Omit<VelaMessage, 'id'>): VelaMessage;
  search(query: string, scope: VelaScope, limit: number): ResourceRef[];
  resolve(ref: Pick<ResourceRef, 'id' | 'kind'>, scope: VelaScope, purpose?: { restoreCollection?: boolean }): ResourceRef | null;
  /** Only for a persisted applied archive action/receipt; does not rediscover archived metadata. */
  canInspectCollectionArchiveReceipt?(ref:ResourceRef,scope:VelaScope):boolean;
  readContent(id: string, scope: VelaScope): { ref: ResourceRef; content: string; source: string } | null;
  /** Current content-policy decision without reading content; absence disables implicit history. */
  canReadContent?(ref: ResourceRef, scope: VelaScope): boolean;
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
  /** Optional canonical low-risk preference command; unsupported adapters must leave suggestions unapplied. */
  applyPreference?(input: {
    action: VelaPreferenceAction; commandId: string; authorizationRef: string;
    expectedVersions: ResourceRef[]; evidenceEventIds: string[];
    origin: 'explicit-user' | 'authorized-adaptation';
  }): HostActionResult;
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
  actor?: 'user' | 'vela' | 'provider';
  preferenceSignal?: { key: PreferenceKey; value: PreferenceValue };
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
  adaptation?: AdaptationState;
  applicationContext?: { currentProjectId:string|null;currentWorkspaceId:string|null;references:ResourceRef[] };
}
export type AdaptationLevel = 'manual' | 'suggestive' | 'assisted' | 'adaptive';
export type PreferenceCategory = 'presentation' | 'organization';
export type PreferenceKey = 'presentation.density' | 'organization.defaultPreset';
export type PreferenceValue = 'comfortable' | 'compact' | 'balanced' | 'focus' | 'development' | 'research';
export interface PreferenceScope { kind: 'global' | 'workspace'; id: string | null }
export interface VelaPreferenceAction { type: 'applyPreference'; key: PreferenceKey; value: PreferenceValue; scope: PreferenceScope }
export interface AdaptationPolicy {
  version: number; enabled: boolean; updatedAt: string;
  categories: Record<PreferenceCategory, { enabled: boolean; level: AdaptationLevel }>;
}
export interface PreferenceEvidence {
  eventId: string; source: string; occurredAt: string; observedValue: PreferenceValue;
  subject: AppAttentionEvent['subject']; classification: 'observed'; actor: 'user';
}
export interface PreferenceHypothesis {
  id: string; key: PreferenceKey; value: PreferenceValue; scope: PreferenceScope;
  source: 'inferred'; state: 'suggested' | 'accepted' | 'rejected' | 'suppressed' | 'superseded' | 'applied' | 'failed' | 'unknown';
  evidence: PreferenceEvidence[]; confidence: 'low' | 'medium' | 'high';
  explanation: string; firstObservedAt: string; lastObservedAt: string;
  reviewedAt?: string; errorCode?: string;
}
export interface ExplicitPreference {
  id: string; key: PreferenceKey; value: PreferenceValue; scope: PreferenceScope;
  version: number; active: boolean; source: 'explicit'; updatedAt: string;
}
export interface AdaptationReceipt {
  id: string; hypothesisId?: string; commandId: string; key: PreferenceKey; value: PreferenceValue;
  scope: PreferenceScope; origin: 'explicit-user' | 'authorized-adaptation';
  state: 'started' | 'applied' | 'failed' | 'cancelled' | 'unknown';
  startedAt: string; endedAt?: string; hostReceiptId?: string; errorCode?: string;
}
export interface AdaptationState {
  policy: AdaptationPolicy; hypotheses: PreferenceHypothesis[]; explicit: ExplicitPreference[];
  suppressions: { key: PreferenceKey; scope: PreferenceScope; value: PreferenceValue; createdAt: string }[];
  receipts: AdaptationReceipt[];
  applicationAvailable: boolean;
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
  adaptationPolicy?(input: { expectedVersion: number; enabled: boolean; categories: AdaptationPolicy['categories'] }): Promise<AdaptationPolicy>;
  explicitPreference?(input: { key: PreferenceKey; value: PreferenceValue; scope: PreferenceScope; expectedVersion: number; apply: boolean }): Promise<ExplicitPreference>;
  reviewPreference?(input: { hypothesisId: string; decision: 'accept' | 'reject' | 'suppress'; apply: boolean }): Promise<PreferenceHypothesis>;
  resetPreferences?(input: { scope: PreferenceScope; clearSuppressions: boolean }): Promise<void>;
}
