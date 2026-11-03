import type { EventEnvelope } from '../../codex-bridge/src/adapter.ts';
import type { GraphData, Message, ContextPackage, Sensitivity } from '../../connected-conversations/src/graph.ts';
import type { Resource } from '../../workspace-kernel/kernel.mts';
import type { DesktopCommand, DesktopSnapshot, PublicConversationExecution, ConversationActivitySnapshot, WorkspacePresentationContext } from '../../application-contract/contracts.ts';
import type { ResourceOpeningInput, ResourceOpeningResult } from '../../application-contract/resource-opening.ts';
import type { ProviderConnectionRequest, ProviderConnectionStatus } from '../../application-contract/provider-connections.ts';
import type { NativeAuthorizationStart,NativeCredential,ReportedUsage,TurnInput,TurnResult,TurnOutcome,TurnHttpDiagnostic } from '../../openai-provider/contracts.mts';
import type { ProductCommandMap } from '../../conversation-product/src/contracts.ts';
import type { AttachedContext } from '../../conversation-product/src/service.mts';
import type { VelaClient, VelaState, ContextManifest, VelaPlanningPort, VelaNativeAction, HostActionResult, ResourceRef, VelaHostPort } from '../../vela-core/src/contracts.ts';
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
export type NoteMethod = 'readNote'|'saveNoteDraft'|'commitNote'|'discardNoteDraft'|'renameNote';
export type NoteRequest = { [K in NoteMethod]: {name:K;input:Parameters<NoteExperienceService[K]>[0]} }[NoteMethod];
export type LibraryMethod = 'capabilities'|'preferences'|'setFavorite'|'getBlockSettings'|'configureBlock'|'findResources'|'attachBlock'|'createBlock'|'listTemplates'|'getTemplate'|'saveTemplate'|'renameTemplate'|'archiveTemplate'|'previewTemplate'|'applyTemplate'|'previewWorkspaceFromResources'|'workspaceFromResources'|'requestVelaTemplate'|'subjectTargets'|'createSubjectBlock'|'projectOverview'|'browseResources';
export type LibraryRequest = { [K in LibraryMethod]: {name:K;input:Parameters<TemplateService[K]>[0] extends undefined?Record<string,never>:Parameters<TemplateService[K]>[0]} }[LibraryMethod] | {name:'inspectWorkspace';input:{workspaceId:string}};
export type LibraryResponse = {result:unknown;desktop?:DesktopSnapshot};
export type VelaOperationName = keyof VelaClient;
export type VelaRequestInput = Parameters<VelaClient['request']>[0] & { previewId?:string;grantId?:string };
export type VelaOperation = { [K in VelaOperationName]: { name: K; input: K extends 'request' ? VelaRequestInput : Parameters<NonNullable<VelaClient[K]>>[0] extends undefined ? Record<string,never> : Parameters<NonNullable<VelaClient[K]>>[0] } & (K extends 'apply' ? { presentation?:WorkspacePresentationContext } : {}) }[VelaOperationName];
export interface VelaRequestPreview { id:string; intent:string; resourceIds:string[]; context:ContextManifest; signature:string; scopeStamp:string; providerId:string; expiresAt:string; discovery?:CapabilityDiscoveryDeclaration;history?:{messageCount:number;encodedBytes:number;digest:string};nativeReviewRequired?:boolean }
/** Trusted host inspection only; never registered in renderer command/subcommand allowlists. */
export interface VelaNativeReview {previewId:string;signature:string;providerId:string;prompt:string;promptDigest:string;reviewDigest:string;context:ContextManifest;history?:ProviderHistory;historyOmissions:{reason:HistoryOmissionReason;count?:number}[]}
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
 clock: { utc: string; local: string };
 webSearch?: true;
 instructions:string;instructionVersion:string;messages:TurnInput['messages'];
 history:{resourceId:string;messageId:string;digest:string;providerId?:string}[];
 contextDigest:string;bodyDigest:string;bodyBytes:number;requiresSourceReview:boolean;
}
export type ProviderAuthRequest={providerId:'chatgpt-plan-responses'}&(
 |{type:'begin'}|{type:'finish';attemptId:string}|{type:'cancel';attemptId?:string}
 |{type:'disconnect'|'refresh';expectedVersion:number});
/** Native-process connection port. Never a renderer payload or workerData. */
export interface OrdinaryConnectionPort {
 status():Promise<ProviderConnectionStatus>;
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
  connectionVersion?:number;inputMessageId?:string;outputMessageId?:string;
  requestedModel?:string;requestBodyDigest?:string;contextDigest?:string;instructionVersion?:string;
  cancellation?:{requested:boolean;serverConfirmed:false};
  /** Fixed bodyless transport facts, separate from provider completion. */
  httpDiagnostic?:Readonly<TurnHttpDiagnostic>;
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
  /** Trusted optional read-only planning transport; never exposed as an RPC or ordinary chat tool. */
  catalogDiscovery?: {readonly available?:boolean;open(projection:CapabilityCatalogProjection,onCall:(call:CapabilityNativeCall)=>Promise<CapabilityToolReply>):Promise<string>;release(threadId:string):void};
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
  status: string | null; payload: { redacted: true; textBytes?: number; itemType?: string; delta?: string; responseId?:string;usage?:ReportedUsage;connection?:ProviderConnectionStatus;application?:Pick<DomainEvent|TimelineDomainEvent|TaskObjectiveEvent,'resourceVersion'|'commandId'|'detail'> };
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
  /** Trusted host opt-in only. Experimental wire fields remain disabled by default. */
  velaCatalogDiscovery?:boolean;
  /** Trusted native-reviewed bounded context; disabled until native consent integration is qualified. */
  velaHistoryContext?:boolean;
  instanceId?: string; accountScope?: string;
  retention?: { maxEvents: number };
  contentPolicy: 'synthetic-only' | 'local-private';
  /** Host-owned directory outside the source checkout; never accepted from the renderer. */
  privateRoot?: string;
  /** Explicit synthetic test seam; rejected for local-private production data. Never accepted through renderer RPC. */
  velaPlanningPort?: VelaPlanningPort;
}
export interface CommandMap {
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
  notes: {input:NoteRequest;output:LibraryResponse};
  library: {input:LibraryRequest;output:LibraryResponse};
  agents: {input:AgentRequest;output:{result:AgentResponse;desktop?:DesktopSnapshot}};
  checklists: {input:ChecklistRequest;output:{result:ChecklistResponse;desktop?:DesktopSnapshot}};
  timelines: {input:TimelineRequest;output:{result:TimelineResponse;desktop?:DesktopSnapshot}};
  githubTimeline: {input:GitHubTimelineCommand;output:{url:string}|{repositories:string[]}};
  taskObjectives: {input:TaskObjectiveRequest|{name:'targets';input:TaskTargetQuery};output:{result:TaskObjectiveResponse|TaskTargetPage;desktop?:DesktopSnapshot}};
  vela: { input: VelaOperation; output: unknown };
  velaRequestPreview: { input: {intent:string;resourceIds:string[]}; output: VelaRequestPreview };
  velaNativeReview: {input:{previewId:string;signature:string};output:VelaNativeReview};
  /** TRUSTED NATIVE HOST ONLY. Renderer/tool allow-lists MUST exclude this authorization command. */
  authorizeVelaRequest: { input: {previewId:string;signature:string;reviewDigest?:string}; output: {grantId:string;expiresAt:string} };
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
  viewState: { input: { state?: unknown }; output: unknown };
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
