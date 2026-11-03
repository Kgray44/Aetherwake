import type { OrganizationUpdate, TaskPriority } from '../../application-contract/contracts.ts';
import type { HistoryOrigin, HistoryProvenance, HistoryMessageDependency, ProviderHistory } from './history-contracts.ts';
import type { SystemMemoryMeasurement, VelaReadOnlySystemHost } from './system-information.ts';
/** Browser-safe Vela contracts. Canonical data and provider execution remain host-owned. */
export const VELA_CONTRACT = 'aerynth.vela@1' as const;
export type EvidenceClass = 'observed' | 'reported' | 'inferred' | 'unknown';
export type AttentionMode = 'normal' | 'quiet' | 'focused' | 'collaborative' | 'proactive';
export type SubjectKind = 'resource' | 'workspace' | 'project' | 'collection';
export interface ResourceRef { id: string; kind: SubjectKind; version: number; title: string; resourceKind?: string; projectId?: string | null; state?: 'active' | 'archived' }
export type VelaSubjectRef = Pick<ResourceRef, 'id' | 'kind'>;
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
  /** Reviewed working context. Non-null IDs must refer to authorized entries in discovered. */
  activeSurface?: { projectId: string | null; workspaceId: string | null };
  /** Canonical resource of an explicitly selected card, with metadata in discovered. */
  activeResourceId?: string;
  /** Bounded layout metadata for the authorized active workspace. No card identities or content. */
  activeWorkspaceLayout?: VelaWorkspaceLayoutContext;
  omitted: { id: string; reason: string }[];
  contentBytes: number; coverage: 'explicit-resources-only';
  /** Exact reviewed egress only. Persisted request context never copies these canonical message bodies. */
  history?: ProviderHistory;
}
/** Untrusted presenter hint. The host resolves the resource from its active workspace. */
export interface VelaActiveCard { workspaceId: string; blockId: string }
export interface VelaWorkspaceLayoutContext {
  mode: 'fluid' | 'freeform' | 'structured';
  placementCount: number;
  lockedPlacementCount: number;
  velaLocked: boolean;
  /** Null when the canonical layout solver cannot produce a valid preview. */
  resolveWouldMovePlacements: boolean | null;
}
export type VelaNativeAction =
  | { type: 'search'; query: string }
  | { type: 'openResource'; query: string }
  | { type: 'setAttentionMode'; mode: AttentionMode; expectedVersion: number }
  | { type: 'navigate'; target: { kind: 'workspace'; workspaceId: string } | { kind: 'constellation'; projectId: string | null } }
  | { type: 'createProject'; title: string }
  | { type: 'renameProject'; projectId: string; title: string }
  | { type: 'renameResource'; resourceId: string; title: string }
  | { type: 'associateResourceProject'; resourceId: string; projectId: string | null }
  | { type: 'createWorkspace'; title: string; projectId: string | null }
  | { type: 'readLocalFact'; capabilityId: VelaLocalCapabilityId }
  | { type: 'readWeather'; period: 'now' | 'today' | 'tonight' | 'tomorrow' | 'tomorrow-morning' }
  | { type: 'createTimeline'; title: string; projectId: string | null; workspaceId: string | null;
      source: { kind: 'application-activity' } | { kind: 'github-commits'; repositoryUrl: string } }
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
  id: VelaNativeAction['type'] | 'delegateTask'; label: string;
  effect: 'read' | 'navigate' | 'create' | 'mutate' | 'provider-execution';
  scope: string; authorization: 'host-policy' | 'reviewed-action' | 'explicit-execution-authorization';
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
export type VelaLocalCapabilityId = 'local.time' | 'local.date' | 'local.workspace-status' | 'local.project-count' | 'local.execution-status' | 'system.memory';
export type VelaLocalFacts =
  | { kind: 'time' | 'date'; epochMs: number; utc: string; timeZone: string; locale: string; utcOffsetMinutes: number; calendarDate: string; formatted: string }
  | { kind: 'workspace-status'; workspace: ResourceRef | null; persistence: 'persisted' | 'pending' | 'unknown'; coverage: 'canonical-workspace-layout' }
  | { kind: 'project-count'; count: number; coverage: 'authorized-active-projects' }
  | { kind: 'execution-status'; running: number; unknown: number; coverage: 'aerynth-owned-executions' }
  | { kind: 'system-memory'; measurement: SystemMemoryMeasurement }
  | { kind: 'unavailable'; code: string };
/** Facts/provenance only. Answer content lives exclusively in the canonical message. */
export interface VelaLocalRecord {
  schemaVersion: 1; commandId: string; capabilityId: VelaLocalCapabilityId;
  classification: 'observed'; providerId: null; observedAt: string; facts: VelaLocalFacts;
}
/** Ephemeral first-useful-output DTO, including actual post-commit measurements; never a second transcript store. */
export interface VelaLocalResult extends VelaLocalRecord {
  messageId: string; content: string; replayed: boolean;
  timing: { classificationMs: number; capabilityMs: number; persistenceMs: number; totalMs: number };
}
export type VelaLocalDispatch = { matched: false } | { matched: true; request: VelaRequest; result: VelaLocalResult };
/** Trusted native callbacks only; no renderer facts, provider access, selection or arbitrary resource retrieval. */
export interface VelaLocalHost {
  identity(): { principalId: string; policyVersion: string };
  clock(): { epochMs: number; timeZone: string; locale: string };
  /** Native registration is an explicit low-risk memory-only policy decision.
   * No renderer permissions, provider calls, execution or general OS access. */
  system?: VelaReadOnlySystemHost;
  /** SAME canonical graph/DB, with targeted system:vela access checks; must not call the general metadata/context view. */
  ensureConversation(): string;
  appendMessage(conversationId: string, message: Omit<VelaMessage, 'id'>): VelaMessage;
  readMessage(conversationId: string, messageId: string): VelaMessage | null;
  workspaceStatus?(): { workspace: ResourceRef | null; persistence: 'persisted' | 'pending' | 'unknown' } | null;
  projectCount?(): { count: number; coverage: 'authorized-active-projects' } | null;
  executionStatus?(): { running: number; unknown: number; coverage: 'aerynth-owned-executions' } | null;
}
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
  local?: VelaLocalRecord;
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
  /** Present only while the uniquely resolved resource remains in scope. */
  openResourceId?: string;
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
  responseText?: string;
  foundSubjects?: VelaSubjectRef[];
}
export interface VelaHostPort {
  /** Trusted current policy metadata only; absent adapters cannot expose attention-version authority. */
  canReadAttentionPreferences?(scope: VelaScope): boolean;
  scope(purpose?: VelaScopePurpose): VelaScope;
  /** Existing navigation metadata, when the host has it; not implicit provider content or retrieval authority. */
  context?(): { currentProjectId: string | null; currentWorkspaceId: string | null };
  /** Explicit metadata only, inserted into the actual consent/planner manifest before authorization. */
  contextReferences?(selectedResourceIds: readonly string[]): ResourceRef[];
  activeWorkspaceLayout?(workspaceId: string): VelaWorkspaceLayoutContext | undefined;
  /** Both conversation operations use the canonical host resource/graph, on the injected db transaction. */
  ensureConversation(key: 'system:vela'): string;
  readConversation(resourceId: string): CanonicalConversation;
  /** Cheap authoritative graph revision; never implemented by cloning the transcript. */
  conversationRevision?(resourceId: string): number | null;
  appendMessage(resourceId: string, message: Omit<VelaMessage, 'id'>): VelaMessage;
  search(query: string, scope: VelaScope, limit: number, match?: 'exact-resource'): ResourceRef[];
  resolve(ref: VelaSubjectRef, scope: VelaScope, purpose?: { restoreCollection?: boolean }): ResourceRef | null;
  resolveMany?(refs: readonly VelaSubjectRef[], scope: VelaScope): ResourceRef[];
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
  /** Optional read-only preparation outside a SQLite transaction. The returned
   * commit runs synchronously after the service and host revalidate authority. */
  prepareNative?(input: Parameters<VelaHostPort['applyNative']>[0], signal: AbortSignal): Promise<() => HostActionResult> | undefined;
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
  planningProviders?: { providerId: string; available: boolean }[];
  capabilities: CapabilityDescriptor[]; requests: VelaRequest[]; plans: VelaPlan[];
  receipts: ActionReceipt[]; preferences: AttentionPreferences; attention: AttentionItem[];
  lastPresenceAt: string | null; coverage: 'authorized-app-events-only';
  adaptation?: AdaptationState;
  presentation?: VelaPresentationState;
  /** Current authorized metadata, keyed by lookup receipt ID. Saved receipts hold only references. */
  searchResults?: Record<string, ResourceRef[]>;
  applicationContext?: { currentProjectId:string|null;currentWorkspaceId:string|null;references:ResourceRef[] };
}
/** Durable view references only; dismissing a manifestation never changes canonical history or action state. */
export interface VelaPresentationState {
  schemaVersion: 1; version: number; view: 'current' | 'history'; selectedRequestId: string | null;
  dismissedRequestIds: string[]; pinnedRequestIds: string[];
}
export type VelaPresentationPatch = Partial<Pick<VelaPresentationState, 'view' | 'selectedRequestId' | 'dismissedRequestIds' | 'pinnedRequestIds'>>;
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
  request(input: { intent: string; resourceIds: string[]; authorizeProvider: boolean; providerId?: string }): Promise<VelaRequest>;
  presentation?(input: { expectedVersion: number; patch: VelaPresentationPatch }): Promise<VelaPresentationState>;
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
