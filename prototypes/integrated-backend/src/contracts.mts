import type { EventEnvelope } from '../../codex-bridge/src/adapter.ts';
import type { GraphData, Message, ContextPackage, Sensitivity } from '../../connected-conversations/src/graph.ts';
import type { Resource } from '../../workspace-kernel/kernel.mts';
import type { DesktopCommand, DesktopSnapshot, PublicConversationExecution, ConversationActivitySnapshot, WorkspacePresentationContext, WorkspacePanelRequest } from '../../application-contract/contracts.ts';
import type { ResourceOpeningInput, ResourceOpeningResult } from '../../application-contract/resource-opening.ts';
import type { ProviderConnectionRequest, ProviderConnectionStatus } from '../../application-contract/provider-connections.ts';
import type { NativeAuthorizationStart,NativeCredential,ReportedUsage,TurnInput,TurnResult,TurnOutcome,TurnHttpDiagnostic,TurnTransportTiming } from '../../openai-provider/contracts.mts';
import type { ProductCommandMap } from '../../conversation-product/src/contracts.ts';
import type { AttachedContext } from '../../conversation-product/src/service.mts';
import type { VelaLocalCapabilityId, VelaClient, VelaState, ContextManifest, VelaActiveCard, VelaPlanningPort, VelaNativeAction, HostActionResult, ResourceRef, VelaHostPort } from '../../vela-core/src/contracts.ts';
import type { PlanningObservation } from '../../vela-core/src/codex-planning-adapter.mts';
import type { TemplateService } from '../../block-library/service.mts';
import type { NoteExperienceService } from '../../block-library/note-service.mts';
import type { CapabilityCatalogProjection, CapabilityDiscoveryDeclaration, CapabilityNativeCall, CapabilityToolReply } from '../../vela-core/src/capability-catalog.mts';
import type { ProviderHistory } from '../../vela-core/src/bounded-history.mts';
import type { HistoryOmissionReason } from '../../vela-core/src/bounded-history.mts';
import type { AgentRequest,ChecklistRequest,AgentResponse,ChecklistResponse,DomainEvent } from './product-domains.mts';
import type { TimelineRequest,TimelineResponse,TimelineDomainEvent } from './timeline-domain.mts';
import type { TaskObjectiveRequest,TaskObjectiveResponse,TaskObjectiveEvent } from './task-objectives.mts';
import type { TaskTargetQuery,TaskTargetPage } from '../../application-contract/task-targets.ts';
import type { GitHubTimelineCommand } from '../../application-contract/github-timeline.ts';
import type { MissionEvent, MissionRequest, MissionResponse, MissionScope } from './mission-contracts.mts';
import type { WorkspaceRecoveryRequest, WorkspaceRecoveryResponse } from '../../application-contract/workspace-recovery.ts';
export type NoteMethod = 'readNote'|'saveNoteDraft'|'commitNote'|'discardNoteDraft'|'renameNote';
export type NoteRequest = { [K in NoteMethod]: {name:K;input:Parameters<NoteExperienceService[K]>[0]} }[NoteMethod];
export type LibraryMethod = 'capabilities'|'preferences'|'setFavorite'|'getBlockSettings'|'configureBlock'|'findResources'|'attachBlock'|'createBlock'|'listTemplates'|'getTemplate'|'saveTemplate'|'renameTemplate'|'archiveTemplate'|'previewTemplate'|'applyTemplate'|'previewWorkspaceFromResources'|'workspaceFromResources'|'requestVelaTemplate'|'subjectTargets'|'createSubjectBlock'|'projectOverview'|'browseResources';
export type LibraryRequest = { [K in LibraryMethod]: {name:K;input:Parameters<TemplateService[K]>[0] extends undefined?Record<string,never>:Parameters<TemplateService[K]>[0]} }[LibraryMethod] | {name:'inspectWorkspace';input:{workspaceId:string}};
export type LibraryResponse = {result:unknown;desktop?:DesktopSnapshot};
export type VelaOperationName = keyof VelaClient;
export type VelaRequestInput = Parameters<VelaClient['request']>[0] & { previewId?:string;grantId?:string };
export type VelaOperation = { [K in VelaOperationName]: { name: K; input: K extends 'request' ? VelaRequestInput : Parameters<NonNullable<VelaClient[K]>>[0] extends undefined ? Record<string,never> : Parameters<NonNullable<VelaClient[K]>>[0] } & (K extends 'apply' ? { presentation?:WorkspacePresentationContext } : {}) }[VelaOperationName] | { name: 'local'; input: { capabilityId: VelaLocalCapabilityId; intent: string; commandId: string } };
export interface VelaWorkflowScope {
  selection: 'replace' | 'create' | 'mixed';
  check: Exclude<import('../../vela-core/src/contracts.ts').VelaProjectCheckKind, 'node-build'>;
}
export interface VelaWorkflowReview {
  id: string;
  expiresAt: string;
  analysis: VelaNativeReview;
  codex: { model: string; effort?: string; intent: string };
  files: { path: string; operation: 'create' | 'replace' }[];
  check: { cwd: string; argv: string[] };
}
export interface VelaRequestPreview { semanticContext?:true; workflowScope?: VelaWorkflowScope; id:string; intent:string; resourceIds:string[]; context:ContextManifest; signature:string; scopeStamp:string; providerId:string; expiresAt:string; discovery?:CapabilityDiscoveryDeclaration;history?:{messageCount:number;encodedBytes:number;digest:string};handoff?:import('../../vela-core/src/history-contracts.ts').VelaHandoff;nativeReviewRequired?:boolean; workingDirectory?:string; route?:import('../../vela-core/src/adaptive-routing.ts').VelaRouteDecision; routingSettings?:import('../../vela-core/src/contracts.ts').VelaRequest['routingSettings'];routingAgent?:import('../../vela-core/src/contracts.ts').VelaRoutingAgent;
  /** Core-derived foreground send policy, rechecked against the private frozen preview at grant time. */
  sendDisposition?: 'routine' | 'review-required';
}
/** Trusted host inspection only; never registered in renderer command/subcommand allowlists. */
export interface VelaNativeReview {semanticContext?:true;previewId:string;signature:string;providerId:string;prompt:string;promptDigest:string;reviewDigest:string;context:ContextManifest;history?:ProviderHistory;handoff?:VelaRequestPreview['handoff'];historyOmissions:{reason:HistoryOmissionReason;count?:number}[];route?:VelaRequestPreview['route'];workingDirectory?:string;routingSettings?:VelaRequestPreview['routingSettings'];routingAgent?:VelaRequestPreview['routingAgent'];agentInstructions?:string;editPaths?:string[]}
export interface VelaNativeCapabilities {
  supportedActions: VelaNativeAction['type'][];
  /** Registered released Universal Block/application capability; no fallback implementation is supplied by Vela. */
  dispatch: VelaHostPort['applyNative'];
  workspaceRevision?: (workspaceId:string)=>number;
  applyPreference?: VelaHostPort['applyPreference'];
}
export type VelaBackendState = VelaState & { nativeCapabilities: Record<string,{available:boolean;reason?:string}>; planningReferences:Record<string,Omit<PlanningObservation,'executionState'>> };
export type ConversationProductRequest = { [K in keyof ProductCommandMap]: { name: K; input: ProductCommandMap[K]['input'] } }[keyof ProductCommandMap];
export type ConversationProductOutput = ProductCommandMap[keyof ProductCommandMap]['output'];
export type ConversationSendInput = ProductCommandMap['send']['input'];
export interface ConversationSendPreview {
 id: string; commandId: string; resourceId: string; providerId: string; expectedRevision: number;
 prompt: string; model?: string; context: AttachedContext[];
 handoff?: { id:string; fingerprint:string; sourceResourceId:string; items:ContextPackage['items'];continued?:true };
 executionText: string; fingerprint: string; expiresAt: string;
 /** Exact stateless Responses egress, without credentials or account identifiers. */
 responses?:OrdinaryResponsesPreview;
}
export interface OrdinaryResponsesPreview {
 executionId:string;configurationId:string;connectionVersion:number;model:string;
 purpose?: 'vela-planning' | 'vela-response';
 clock: { utc: string; local: string };
 reasoningEffort?: TurnInput['reasoningEffort'];
 webSearch?: true;
 instructions:string;instructionVersion:string;messages:TurnInput['messages'];
 history:{resourceId:string;messageId:string;digest:string;providerId?:string}[];
 contextDigest:string;bodyDigest:string;bodyBytes:number;requiresSourceReview:boolean;
}
export type ProviderAuthRequest={providerId:'chatgpt-plan-responses'}&(
 |{type:'begin'}|{type:'maintain'}|{type:'finish';attemptId:string}|{type:'cancel';attemptId?:string}
 |{type:'disconnect'|'refresh';expectedVersion:number});
/** Native-process connection port. Never a renderer payload or workerData. */
export interface OrdinaryConnectionPort {
 status():Promise<ProviderConnectionStatus>;
 renewIfDue?():Promise<ProviderConnectionStatus>;
 begin():Promise<NativeAuthorizationStart>;finish(attemptId:string):Promise<unknown>;cancel(attemptId?:string):Promise<unknown>;
 disconnect(expectedVersion:number):Promise<unknown>;refresh(expectedVersion:number):Promise<unknown>;close():Promise<void>|void;
 resolveCredential(expectedVersion:number):Promise<NativeCredential>;
 revalidateCredential(expectedVersion:number,boundaryDigest:string):Promise<void>;
 modelCatalog(expectedVersion:number):Promise<{providerId:'chatgpt-plan-responses';boundaryDigest:string;observedAt:number;catalogOnly:true;models:{id:string;label:string}[]}>;
}
/** Explicit synthetic-only override; the real Core constructs its native coordinator. */
export interface OrdinaryResponsesTestServices {
 connection:OrdinaryConnectionPort;fetch:typeof fetch;
 instructions?:(resourceId:string)=>Promise<{text:string;version:string}>;
}
export const CONTRACT = 'aerynth.integration@0.1' as const;
export type Classification = 'observed' | 'reported' | 'inferred' | 'simulated';
export type ExecutionState = PublicConversationExecution['state'];
export interface Binding {
  providerId: string; instanceId: string; accountScope: string;
  nativeThreadId: string; nativeSessionId: string | null;
}
export interface Execution extends PublicConversationExecution {
  binding: Binding | null; turnId: string | null;
  /** Actual Responses facts, never a fabricated Codex thread/turn binding. */
  responseId?:string;responseOutcome?:TurnOutcome;usage?:ReportedUsage;reportedModel?:string;
  velaFirstOutputMs?: number;
  outputStagingClock?: { domain: string; monotonicMs: number };
  incompleteReason?: import('../../openai-provider/contracts.mts').TurnResult['incompleteReason'];
  /** Canonical admission counted once per AIR provider stage, including unknown outcomes. */
  velaAdmission?: { projectId: string | null; utcDay: string };
  connectionVersion?:number;inputMessageId?:string;outputMessageId?:string;
  requestedModel?:string;requestBodyDigest?:string;contextDigest?:string;instructionVersion?:string;
  requestedReasoningEffort?:TurnInput['reasoningEffort'];
  cancellation?:{requested:boolean;serverConfirmed:false};
  /** Fixed bodyless transport facts, separate from provider completion. */
  httpDiagnostic?:Readonly<TurnHttpDiagnostic>;
}
export interface Capability {
  providerId: string; mock: boolean; authentication: string;
  models: string[]; catalogOnly: true; nativeFork: false; chatgptHistory: false;
  modelEfforts?: Record<string, string[]>;
  selectableModels?: string[];
  defaultModel?: string;
  defaultModelEfforts?: Record<string, string>;
}
export interface ProviderPort {
  readonly id: string; readonly mock: boolean;
  readonly instanceId: string; readonly accountScope: string;
  connect(): Promise<void>; capabilities(): Promise<Capability>;
  open(options?: { cwd?: string; model?: string }): Promise<string>; resume(threadId: string): Promise<string>;
  read(threadId: string): Promise<Record<string, unknown>>;
  items(threadId: string, turnId: string): Promise<Record<string, unknown>>;
  recentTurns?(threadId: string): Promise<readonly Record<string, unknown>[]>;
  turn(threadId: string, text: string, model?: string, inspection?: { effort?: string }): Promise<string>;
  terminal(threadId: string, turnId: string): Promise<EventEnvelope>;
  interrupt(threadId: string, turnId: string): Promise<void>;
  /** Standalone local App Server command transport. No inference or provider quota. */
  projectChecks?: {
    ready(): Promise<boolean>;
    execute(command: string[], cwd: string): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  };
  onEvent(listener: (event: EventEnvelope) => void): () => void;
  close(): void;
  /** Trusted optional read-only planning transport; never exposed as an RPC or ordinary chat tool. */
  catalogDiscovery?: {readonly available?:boolean;open(projection:CapabilityCatalogProjection,onCall:(call:CapabilityNativeCall)=>Promise<CapabilityToolReply>):Promise<string>;release(threadId:string):void};
}
export interface VelaRouteTiming {
  routingMs: number;
  capabilityMs: number;
  contextMs: number;
  previewMs: number;
  previewClock?: { domain: string; startedMs: number; readyMs: number };
}
export interface VelaRequestAdmissionTiming {
  source: 'canonical-user-message-staged';
  requestToInputStagingMs: number;
  requestToProviderContextCheckMs: number;
  previewToInputStagingMs: number | null;
}
export interface ProviderStreamTiming {
  responseCreatedMs: number | null;
  firstTextDeltaMs: number | null;
  transport?: TurnTransportTiming;
}
/** Local monotonic offsets within one provider execution. */
export interface ConversationProviderTiming extends ProviderStreamTiming {
  source: 'observed' | 'simulated';
  origin: 'ordinary-adapter-entry' | 'reviewed-api-dispatch-staging';
  parentRequestId: string | null;
  /** Backend receipt of nonblank provider output. Historical observations may omit this field. */
  firstNonblankOutput?: { kind: 'text' | 'refusal'; elapsedMs: number } | null;
  /** Elapsed time from the original backend preview, including any intervening review or wait. */
  fromPreview?: { id: string; toAdapterMs: number; toFirstNonblankOutputMs: number | null };
  resultObservedMs: number | null;
  outputStagedMs: number | null;
  settlementStagedMs: number;
}
export interface MissionReportTiming {
  clock: string;
  compositionStartedMs: number;
  composedMs: number;
  /** The conversation append and report link were staged inside the publication transaction. */
  stagedMs: number;
}
/** Scoped lifecycle metadata only. Mission objectives, prompts and evidence stay with their owning resources. */
export interface MissionStreamEvent {
  id: string;
  scope: MissionScope;
  kind: MissionEvent['kind'] | 'report-posted' | 'conversation-receipt';
  seq?: number;
  /** Canonical journal time, independent of delivery to the retained stream. */
  occurredAt?: string;
  taskId?: string;
  attemptId?: string;
  executor?: string;
  reportTiming?: MissionReportTiming;
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
  status: string | null; payload: { redacted: true; taskId?: string; previewId?: string; timing?: VelaRouteTiming; requestAdmission?: VelaRequestAdmissionTiming; providerTiming?: ConversationProviderTiming; textBytes?: number; itemType?: string; delta?: string; responseId?:string;usage?:ReportedUsage;connection?:ProviderConnectionStatus;application?:Pick<DomainEvent|TimelineDomainEvent|TaskObjectiveEvent,'resourceVersion'|'commandId'|'detail'>;
    workspaceRecovery?: {workspaceId:string;action:'undo-creation'|'restore';creationEventId:string;workspaceVersion:number};
    clockTimer?: Pick<TimerDomainEvent, 'resourceVersion' | 'commandId' | 'timerIds' | 'expiryIds' | 'operations'>;
    api?: { maxOutputTokens?: number; callId?: string; elapsedMs?: number; enabled?: boolean; executionId?: string; bodyDigest?: string; contextDigest?: string };
    voice?: {sessionId?:string;attemptId?:string;state?:string;usageSeconds?:number;messageId?:string;delegationId?:string;catalogCount?:number;errorCode?:string};
    tools?:{workflowId:string;receiptId?:string};
    wake?: {phase:string;enabled:boolean;microphone:string;voice:string;detector:string;owner:string|null;sessionId:string|null;settingsVersion:number;errorCode:string|null};files?:{count:number;state:string} };
  mission?: MissionStreamEvent;
}
export interface HandoffReview {
  id: string; resourceId: string; sourceResourceId: string; targetProviderId: string;
  sourceRevision: number; fingerprint: string; estimatedTokens: number;
  estimator: 'utf8-bytes-upper-bound'; tokenBudget: number;
  state: 'prepared' | 'approved' | 'rejected' | 'dispatching' | 'applied' | 'failed' | 'interrupted' | 'unknown';
  expiresAt: string; approvedAt?: string;
}
import type { MediaCapabilities, MediaImportRequest, MediaMetadata, MediaReadRequest } from '../../application-contract/media.ts';
import type { MediaSelection } from './media-sources.mts';
import type { ClockTimerRequest, ClockTimerResponse } from './timer-domain.mts';
import type { TimerClockReading, TimerDomainEvent } from '../../timer-product/contracts.ts';
import type { VelaApiConnectionRequest, VelaApiConnectionResult } from './vela-api-connection.mts';
import type { VelaApiUsageStatus } from './vela-api-runtime.mts';
import type { VelaVoiceControlRequest,VelaVoiceNativeRequest,VelaVoiceState,VoiceAuthorization } from './vela-voice-runtime.mts';
import type { VelaWakeRequest,VelaWakeNativeRequest,VelaWakeState } from './vela-wake-runtime.mts';
import type { NativeWakePcmFrame } from './wake-capture-host.mts';
import type {WakeCaptureState} from './wake-capture-host.mts';
import type { GptLiveAudioDevice } from './live-media-host.mts';
import type { PromptVoiceResult } from '../../openai-provider/live-contracts.mts';
import type { NativeApiCredentialInput, RedactedApiConnectionView } from '../../openai-provider/api-connection-contracts.mts';

export interface Options {
  path: string; provider?: 'fixture' | 'codex' | 'bridge-fixture'; fixtureMode?: string;
  codexExecutable?: string; codexArgs?: string[]; cwd?: string;
  /** Trusted host opt-in only. Experimental wire fields remain disabled by default. */
  velaCatalogDiscovery?:boolean;
  nativeMedia?: boolean;
  /** Trusted desktop transport applies current visibility before forwarding journal events. */
  rendererEventTransport?: boolean;
  /** Trusted native-reviewed bounded context; disabled until native consent integration is qualified. */
  velaHistoryContext?:boolean;
  instanceId?: string; accountScope?: string;
  retention?: { maxEvents: number };
  contentPolicy: 'synthetic-only' | 'local-private';
  /** Host-owned directory outside the source checkout; never accepted from the renderer. */
  privateRoot?: string;
  /** Explicit synthetic test seam; rejected for local-private production data. Never accepted through renderer RPC. */
  velaPlanningPort?: VelaPlanningPort;
  /** Serializable synthetic-only clock fixture. Rejected for local-private data; never a renderer RPC field. */
  syntheticTimerClock?: TimerClockReading;
}
export interface CommandMap {
  hostOperationReviewNative:{input:{operationId:string;selection?:{kind:'codex-directory';directory:string}};output:import('../../application-contract/vela-host-operations.ts').VelaHostReviewBinding};
  hostOperationDispatchNative:{input:{binding:import('../../application-contract/vela-host-operations.ts').VelaHostReviewBinding;identityDigest:string;approvalDigest:string};output:import('../../application-contract/windows-maintenance.ts').WindowsMaintenanceDispatchClaim};
  hostOperationResultNative:{input:import('../../application-contract/vela-host-operations.ts').VelaHostOperationNativeResult;output:import('../../application-contract/vela-tools.ts').VelaHostOperationView};
  /** Native-owned purpose permission; never a renderer/model command. */
  velaWeatherPermissionNative:{input:{type:'status'}|{type:'set';expectedVersion:number;decision:'allow'|'deny'};output:import('./weather-permission.mts').WeatherPermission};
  velaVoice: {input:VelaVoiceControlRequest;output:VelaVoiceState|GptLiveAudioDevice[]};
  velaWake: {input:VelaWakeRequest;output:VelaWakeState};
  /** Private native gesture / readiness boundary, excluded from renderer and model capabilities. */
  velaWakeNative: {input:VelaWakeNativeRequest;output:VelaWakeState};
  /** Private acknowledged PCM ingress; never an activity or conversation event. */
  velaWakeFrame: {input:NativeWakePcmFrame;output:{accepted:true}};
  velaWakeCaptureState:{input:WakeCaptureState;output:VelaWakeState};
  velaVoiceNative: {input:VelaVoiceNativeRequest;output:VelaVoiceState|VoiceAuthorization|PromptVoiceResult};
  velaApiConnection: { input: VelaApiConnectionRequest; output: VelaApiConnectionResult };
  velaApiUsageStatus: { input: Record<string,never>; output: VelaApiUsageStatus };
  /** Native explicit usage consent, separate from saving credentials. */
  velaApiUsageAuthorize: { input: { expectedVersion: number; enabled: boolean }; output: VelaApiUsageStatus };
  /** Private owned native-process command. Never registered as renderer or model capability. */
  velaApiConfigure: { input: { credential: NativeApiCredentialInput; expectedVersion: number | null }; output: RedactedApiConnectionView };
  clockTimers: { input: ClockTimerRequest; output: { result: ClockTimerResponse; desktop?: DesktopSnapshot } };
  /** Private native-host power event; excluded from renderer/tool command allowlists. */
  timerHostResume: { input: Record<string, never>; output: null };
  missions: { input: MissionRequest; output: MissionResponse };
  workspaceRecovery: { input: WorkspaceRecoveryRequest; output: WorkspaceRecoveryResponse };
  missionStartReviewed: { input: Extract<MissionRequest, { name: 'start' }>['input'] & {
    approvedProjectCheck?: { paths: string[]; digest: string } }; output: MissionResponse };
  missionCheckReview: { input: { paths: string[] }; output: { cwd: string; argv: string[]; head: string; digest: string } };
  missionPlanReviewed: { input: Extract<MissionRequest, { name: 'plan' }>['input']; output: MissionResponse };
  missionRevisionReviewed: { input: Extract<MissionRequest, { name: 'revision-apply' }>['input']; output: MissionResponse };
  missionHostSignal: { input: { storageAdmitted: boolean } | { foregroundInput: true } |
    import('./resource-signals.mts').ResourceSignal; output: null };
  /** Owned desktop command, excluded from renderer and model routes. */
  resourcePolicyNative: { input: import('./resource-policy.mts').ResourcePolicyNativeRequest;
    output: import('./resource-policy.mts').ResourcePolicyNativeView };
  /** Fixed GPU diagnostic, accessible only through the native desktop review. */
  gpuReadbackNative: { input: import('./mission-gpu-readback.mts').GpuReadbackNativeRequest;
    output: import('./mission-gpu-readback.mts').GpuReadbackNativeResponse };
  /** Private desktop-host command. Local paths never cross renderer IPC. */
  mediaImportTrusted: {
    input: Omit<MediaImportRequest, 'url'> & { commandId: string; selection: MediaSelection };
    output: { resource: import('../../application-contract/contracts.ts').Resource; placementId?: string; desktop: DesktopSnapshot };
  };
  mediaDescribe: { input: { resourceId: string }; output: { metadata: MediaMetadata; capabilities: MediaCapabilities } };
  mediaReadChunk: { input: MediaReadRequest & { offset: number; length: number; playback?: true }; output: { base64: string } };
  /** Private desktop-host command. The native shell consumes the target. */
  mediaExternalTarget: { input: { resourceId: string; expectedVersion: number }; output: MediaSelection };
  providerConnection:{input:ProviderConnectionRequest;output:ProviderConnectionStatus};
  /** Explicit catalog read. Also available as providerConnection.refreshModels. */
  ordinaryProviderCheck:{input:Record<string,never>;output:ProviderConnectionStatus};
  ordinaryProviderStatus:{input:Record<string,never>;output:ProviderConnectionStatus};
  /** TRUSTED Main/native only; MUST NOT be exposed in renderer/tool allowlists. */
  providerAuth:{input:ProviderAuthRequest;output:NativeAuthorizationStart|ProviderConnectionStatus};
  /** Trusted host diagnostics only: volatile registered provider-port attempts, no user content. */
  providerActivity:{input:Record<string,never>;output:{codexConnections:number;providerRequests:number;systemMemoryReads:number;scope:'process-session-native-attempts'}};
  /** Read-only canonical resource resolution; no workspace placement required. */
  openResource: {input:ResourceOpeningInput;output:ResourceOpeningResult};
  conversationActivity: { input: { resourceIds: string[] }; output: ConversationActivitySnapshot };
  reconcileConversationTurn: { input: { resourceId: string; executionId: string }; output: { state: 'unchanged' | 'provider_completed' | 'failed' | 'interrupted' } };
  notes: {input:NoteRequest;output:LibraryResponse};
  library: {input:LibraryRequest;output:LibraryResponse};
  agents: {input:AgentRequest;output:{result:AgentResponse;desktop?:DesktopSnapshot}};
  checklists: {input:ChecklistRequest;output:{result:ChecklistResponse;desktop?:DesktopSnapshot}};
  timelines: {input:TimelineRequest;output:{result:TimelineResponse;desktop?:DesktopSnapshot}};
  githubTimeline: {input:GitHubTimelineCommand;output:{url:string}|{repositories:string[]}};
  taskObjectives: {input:TaskObjectiveRequest|{name:'targets';input:TaskTargetQuery};output:{result:TaskObjectiveResponse|TaskTargetPage;desktop?:DesktopSnapshot}};
  vela: { input: VelaOperation; output: unknown };
  velaRequestPreview: { input: {intent:string;resourceIds:string[];activeCard?:VelaActiveCard;adaptive?:true;editTargetPaths?:string[];editCreatePaths?:string[];requireInspectionDirectory?:true;inspectionDirectory?:string} & import('../../vela-core/src/adaptive-routing.ts').VelaTurnRouting; output: VelaRequestPreview };
  velaWorkflowReview: { input: { previewId: string; signature: string; editTargetPaths?: string[]; editCreatePaths?: string[]; checkPaths: string[] }; output: VelaWorkflowReview };
  velaWorkflowRun: { input: { id: string }; output: import('../../vela-core/src/contracts.ts').VelaRequest };
  velaNextWorkflowStage: { input: { requestId: string }; output: { intent: string } | null };
  velaFileEditReview: { input: {requestId:string}; output: import('./vela-file-edit.mts').VelaFileEditReview };
  missionFileEditPrepareNative:{input:{intent:string;resourceIds:string[];resourceRefs?:import('../../vela-core/src/contracts.ts').ResourceRef[];settings?:import('../../vela-core/src/adaptive-routing.ts').VelaTurnRouting};output:{requestId:string;reviewId:string;expiresAt:string;preview:{id:string;signature:string;providerId:string};review:VelaNativeReview}};
  missionFileEditRunNative:{input:{requestId:string;reviewId:string;reviewDigest:string};output:import('../../vela-core/src/contracts.ts').VelaRequest};
  missionFileEditReviewNative:{input:{operationId:string};output:import('./mission-file-edits.mts').NativeMissionPatchReview};
  missionFileEditChoiceNative:{input:{operationId:string;reviewId:string;reviewDigest:string;purpose:'patch'|'check';decision:'yes'|'no';nativeChoiceId:string};output:import('./mission-file-edits.mts').PrivateMissionEditAuthority|null};
  missionFileEditApplyNative:{input:{operationId:string;authority:string};output:import('../../application-contract/mission-file-edits.ts').MissionFileEditView};
  missionFileEditCheckReviewNative:{input:{operationId:string;selectedTestPath:string};output:ReturnType<import('./mission-file-edits.mts').MissionFileEdits['reviewRequiredCheck']>};
  missionFileEditCheckRunNative:{input:{operationId:string;authority:string};output:import('../../application-contract/mission-file-edits.ts').MissionFileEditView};
  missionFileEditRead:{input:{operationId:string};output:import('../../application-contract/mission-file-edits.ts').MissionFileEditView};
  velaFileEditApply: { input: {requestId:string;reviewId:string}; output: import('./vela-file-edit.mts').VelaFileEditView };
  velaProjectCheckReview: { input: {requestId:string;kind:import('../../vela-core/src/contracts.ts').VelaProjectCheckKind;paths:string[]}; output: import('./vela-project-check.mts').VelaProjectCheckReview };
  velaProjectCheckRun: { input: {requestId:string;reviewId:string}; output: import('./vela-file-edit.mts').VelaFileEditView };
  velaStandaloneCheckReview: { input: {intent:string;settings?:import('../../vela-core/src/adaptive-routing.ts').VelaTurnRouting;paths:string[];artifactPath?:string}; output: import('./vela-project-check.mts').VelaProjectCheckReview<null> };
  velaStandaloneCheckRun: { input: {reviewId:string}; output: import('../../vela-core/src/contracts.ts').VelaRequest };
  velaRouteNative: { input: { intent: string; resourceIds?:string[];resourceRefs?:import('../../vela-core/src/contracts.ts').ResourceRef[];activeCard?:VelaActiveCard; settings?: import('../../vela-core/src/adaptive-routing.ts').VelaTurnRouting }; output: { matched: false; apiFileEdit?:true;selectedEditSource?:import('../../vela-core/src/contracts.ts').ResourceRef;projectCheck?: import('../../vela-core/src/contracts.ts').VelaProjectCheckKind;fileDiscovery?:{projectName?:string} } | { matched: true; request: import('../../vela-core/src/contracts.ts').VelaRequest } };
  /** Native selected directory only. Provider/renderer fields never grant filesystem discovery authority. */
  velaFileProposalPrepareNative:{input:{intent:string;selectedDirectory?:string;folderResourceId?:string};output:import('../../vela-core/src/contracts.ts').VelaRequest};
  /** Native picker selections only; never accept a renderer path, root grant or recursive file list. */
  velaSourcesPickNative:{input:{commandId:string;selection:{kind:'files';paths:string[]}|{kind:'folder';path:string};destination:'context'|'workspace';workspaceId?:string;expectedLayoutVersion?:number};output:import('../../vela-core/src/contracts.ts').VelaPickedSources};
  folders:{input:import('../../application-contract/folder.ts').FolderRequest;output:import('../../application-contract/folder.ts').FolderResponse};
  /** Native gesture only. Never forward the private directory target to a renderer or a model. */
  folderOpenNative:{input:{resourceId:string;entryId?:string};output:{path:string}};
  velaNativeReview: {input:{previewId:string;signature:string};output:VelaNativeReview};
  /** TRUSTED NATIVE HOST ONLY. Renderer/tool allow-lists MUST exclude this authorization command. */
  authorizeVelaRequest: { input: {previewId:string;signature:string;reviewDigest?:string;directSend?:true}; output: {grantId:string;expiresAt:string} };
  /** TRUSTED NATIVE HOST ONLY. Separate approval of the exact delegated provider step. */
  authorizeVelaDelegation: { input: {planId:string;stepId:string;fingerprint:string}; output: {grantId:string;expiresAt:string} };
  conversation: { input: ConversationProductRequest; output: ConversationProductOutput };
  conversationCitation: { input: ProductCommandMap['openCitation']['input']; output: { url: string } };
  conversationClock: { input: ConversationSendInput; output: { id: string; resourceId: string; role: 'user'; content: string; revision: number; deviceClockMessageId: string } | null };
  conversationSendPreview: { input: ConversationSendInput; output: ConversationSendPreview };
  /** Trusted native host only; MUST NOT be exposed to a renderer or tool caller. */
  authorizeConversationSend: { input: { previewId:string; fingerprint:string; commandId:string }; output: { grantId:string; expiresAt:string } };
  conversationSend: { input: { previewId:string; grantId:string; fingerprint:string; commandId:string }; output: Execution };
  desktop: { input: DesktopCommand; output: DesktopSnapshot };
  viewState: { input: { state?: unknown; panels?: WorkspacePanelRequest }; output: unknown };
  openWorkspace: { input: { workspaceId: string }; output: { workspace: Record<string, unknown>; layout: Record<string, unknown>; blocks: Array<Record<string, unknown>> } };
  selectProvider: { input: { resourceId: string; providerId: string; expectedRevision: number }; output: ConversationView };
  applyOrdinary: { input: { handoffId: string; prompt: string; commandId: string }; output: Message & { resourceId: string; classification: 'simulated' } };
  createConversation: { input: { title?: string; providerId?: string; commandId: string }; output: ConversationView };
  addMessage: { input: { resourceId: string; role: 'user' | 'assistant'; content: string; sensitivity?: Sensitivity; expectedRevision: number; commandId?: string }; output: Message & { resourceId: string; revision: number } };
  workspace: { input: { title: string; projectTitle?: string }; output: WorkspaceView };
  place: { input: { workspaceId: string; resourceId: string }; output: BlockView };
  move: { input: { blockId: string; workspaceId: string; expectedVersion: number }; output: BlockView };
  branch: { input: { resourceId: string; messageId: string; includeMessageIds: string[]; providerId: string; title: string; commandId: string; tokenBudget: number; expectedRevision?: number; workspaceId?: string; bounds?: {x:number;y:number;width:number;height:number} }; output: { conversation: ConversationView; handoff: HandoffReview; context: ContextPackage; mode: 'application_continuation' } };
  review: { input: { handoffId: string; fingerprint: string; approve: boolean }; output: HandoffReview };
  execute: { input: { resourceId: string; handoffId?: string; prompt: string; commandId: string; model?: string; authorized: boolean; expectedRevision?: number }; output: Execution };
  reconcile: { input: { resourceId: string }; output: { resourceId: string; providerThreadAvailable: boolean; executionOutcome: 'unchanged'; nativeStatus?: string; syntheticTurnReceipt?: { completePage: boolean; exactMarker: boolean; itemTypes: string[] } } };
  interrupt: { input: { executionId: string }; output: { requested: true; confirmed: false } };
  capabilities: { input: Record<string, never>; output: Capability };
  snapshot: { input: Record<string, never>; output: Snapshot };
  rendererEventPage: {
    input: { after?: number; limit?: number; recent?: boolean };
    output: { events: StreamEvent[]; earliest: number | null; latest: number; scannedThrough: number; truncated: boolean; scope: string };
  };
  rendererVelaOutput: {
    input: import('../../application-contract/contracts.ts').VelaOutputObservation;
    output: { accepted: boolean };
  };
  replay: { input: { after?: number; limit?: number }; output: { events: StreamEvent[]; earliest: number | null; latest: number; truncated: boolean } };
  close: { input: Record<string, never>; output: null };
}
export interface ConversationView { resourceId: string; revision: number; title: string; providerId: string; kind: 'ordinary' | 'codex'; taskId: null; projectId: string | null }
export interface WorkspaceView { id: string; project_id: string | null; title: string; version: number; state: string; created_at: string; updated_at: string }
export interface BlockView { id: string; resource_id: string; workspace_id: string; version: number; x: number; y: number; z: number; width: number; height: number }
export interface Snapshot {
  contract: typeof CONTRACT; schemaVersion: 1; conversations: ConversationView[];
  graph: GraphData; resourceMap: Record<string, string>; bindings: Record<string, Binding[]>;
  handoffs: Record<string, HandoffReview>; executions: Record<string, Execution>;
  messageEvidence: Record<string, { classification: 'reported' | 'simulated'; executionId: string; providerId: string; nativeTurnId?: string; nativeThreadId?: string;responseId?:string;outputState?:'complete'|'partial'; webSearch?: TurnResult['webSearch'] }>;
  resources: Array<{ resource: Resource; conversation?: unknown; externalRefs: unknown[] }>;
  relationships: Array<{ id: string; source_id: string; target_id: string; kind: string; provenance: string }>;
}
export class ServiceError extends Error {
  code: string;
  constructor(code: string) { super(code); this.code = code; }
}
export const ensure: (condition: unknown, code: string) => asserts condition = (condition, code) => { if (!condition) throw new ServiceError(code); };
