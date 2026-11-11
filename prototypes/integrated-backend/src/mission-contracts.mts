import type { MissionContextPackage } from '../../vela-core/src/mission-context.mts';
import type { ReasoningEffort } from '../../openai-provider/model-controls.ts';
import type { ReportedUsage } from '../../openai-provider/contracts.mts';
import type { ProviderStreamTiming, StreamEvent } from './contracts.mts';
import type { MissionTeam, MissionTeamSave } from './mission-teams.mts';

export const MISSION_CONTRACT = 'aerynth.vela-mission@1' as const;
export const MISSION_LIMITS = { missions: 128, active: 8, tasks: 16, attempts: 3, workers: 3, revisions: 4, events: 256 } as const;

export interface MissionScope {
  projectId: string | null;
  workspaceId: string;
}
export interface MissionClaim {
  resource: string;
  mode: 'read' | 'exclusive';
}
export interface MissionTaskPlan {
  id: string;
  objective: string;
  executor: string;
  dependencies: string[];
  claims: MissionClaim[];
  criterion: string;
  timeoutMs: number;
  maxAttempts: number;
  projectCheck?: { paths: string[]; digest: string };
  teamMember?: { profileId: string; title: string; responsibility: string };
  specialist?: {
    role: string;
    instructions: string;
    provider: 'chatgpt-plan-responses' | 'openai-api-vela';
    model: string;
    effort?: ReasoningEffort;
    connectionVersion: number;
    settingsStamp: string;
    webSearch?: true;
    profile?: { id: string; profileVersion: number; resourceVersion: number; title: string; instructions: string };
  };
}
export interface MissionPlan {
  objective: string;
  scope: MissionScope;
  criteria: string[];
  tasks: MissionTaskPlan[];
  planning?: MissionPlanningReceipt;
  team?: MissionTeamBinding;
  originConversationId?: string;
  coverage?: MissionCoverage;
}
export interface MissionCoverage { status: 'partial'; limitations: string[] }
export type MissionTeamBinding = Pick<MissionTeam, 'id' | 'title' | 'version'>;
export interface MissionTeamLibrary {
  kind: 'team-library';
  teams: MissionTeam[];
  profiles: { id: string; title: string }[];
}
export interface MissionPlanningReceipt {
  provider: 'chatgpt-plan-responses' | 'openai-api-vela';
  model: string;
  effort?: ReasoningEffort;
  responseId: string;
  executionId?: string;
  startedAt: string;
  durationMs: number;
  /** Stream and result offsets use the planning start. Validation is an elapsed duration. */
  timing?: ProviderStreamTiming & { providerResultMs: number; validationMs: number };
  providerEvidence?: 'reported' | 'simulated';
  usage?: ReportedUsage;
}
export interface MissionEvidence {
  id: string;
  attemptId: string;
  source: string;
  observedAt: string;
  value: unknown;
}
export interface MissionVerification {
  criterion: string;
  passed: boolean;
  detail: string;
  evidenceIds: string[];
}
export type MissionAdmissionReason = 'physical-memory' | 'storage-reserve' | 'cpu-load' | 'gpu-load' | 'disk-io' | 'active-input' |
  'renderer-latency' | 'battery-power' | 'suspended' | 'cpu-speed-limit';
export interface MissionAdmissionReading { value: number; observedAt: string }
export interface MissionAdmission {
  workerLimit: number;
  effectiveLimits?: { cpu: number; build: number; gpu: number; host_io: number; remote: number };
  reasons: MissionAdmissionReason[];
  readings: {
    cpuPercent?: MissionAdmissionReading;
    availableMemoryBytes?: MissionAdmissionReading;
    gpuEnginePercent?: MissionAdmissionReading;
    diskQueueLength?: MissionAdmissionReading;
    rendererFrameP95Ms?: MissionAdmissionReading;
  };
}
type MissionPhaseInterval = [startedMs: number, endedMs: number];
export type MissionReadyBlocker = 'worker-budget' | 'capacity' | 'resource-conflict';
export interface MissionReadyQueueEvidence {
  firstObservedMs: number;
  /** Scheduler observations. The samples do not establish a continuous blocked duration. */
  blockers: Partial<Record<MissionReadyBlocker, { samples: number; lastObservedMs: number }>>;
}
/** Local monotonic intervals in the attempt's capture domain. */
export interface MissionAttemptPhaseTiming {
  clock: string;
  contextAssembly: MissionPhaseInterval;
  readyQueue?: MissionReadyQueueEvidence;
  dispatchValidation?: MissionPhaseInterval;
  execution?: MissionPhaseInterval;
  postExecutionContextValidation?: MissionPhaseInterval;
  verification?: MissionPhaseInterval;
}
export interface MissionAttempt {
  id: string;
  executor: string;
  admittedAt: string;
  finishedAt?: string;
  outcome?: 'verified' | 'failed' | 'blocked' | 'cancelled' | 'uncertain';
  evidence?: MissionEvidence;
  verification?: MissionVerification;
  context?: MissionContextPackage['manifest'];
  admission?: MissionAdmission;
  resourceLease?: import('./resource-policy.mts').ResourceLease['receipt'];
  timing?: { queueMs: number; contextPreparationMs: number; executionMs?: number; verificationMs?: number; phases?: MissionAttemptPhaseTiming };
  telemetry?: { durationMs: number; providerCalls: number; usage?: ReportedUsage; responseId?: string; reportedModel?: string;
    providerEvidence?: MissionPlanningReceipt['providerEvidence'];
    providerExecutionId?: string; providerStream?: ProviderStreamTiming };
}
export type MissionTaskState = 'queued' | 'running' | 'cancelling' | 'verified' | 'failed' | 'blocked' | 'cancelled' | 'uncertain';
export interface MissionTask extends MissionTaskPlan {
  state: MissionTaskState;
  queuedAt: string;
  priority: number;
  detail?: string;
  attempts: MissionAttempt[];
}
export interface MissionEvent {
  seq: number;
  time: string;
  timing?: { domain: string; monotonicMs: number; planRevision: number; intakeMonotonicMs?: number };
  kind: 'created' | 'revised' | 'control' | 'started' | 'settled' | 'recovered' | 'workroom';
  taskId?: string;
  attemptId?: string;
  detail?: string;
  change?: MissionRevisionChange;
  replacementTaskId?: string;
}
export interface Mission {
  contract: typeof MISSION_CONTRACT;
  id: string;
  requestId: string;
  objective: string;
  scope: MissionScope;
  criteria: string[];
  createdAt: string;
  revision: number;
  planRevision: number;
  concurrency: number;
  disposition: 'active' | 'paused' | 'cancelled';
  planning?: MissionPlanningReceipt;
  team?: MissionTeamBinding;
  originConversationId?: string;
  coverage?: MissionCoverage;
  workroom?: MissionWorkroom;
  tasks: MissionTask[];
  retiredTasks?: MissionTask[];
  events: MissionEvent[];
}
export interface MissionProjection extends Mission {
  outcome: 'queued' | 'running' | 'paused' | 'cancelling' | 'cancelled' | 'blocked' | 'failed' | 'uncertain' | 'verified';
  answer?: string[];
  admission?: MissionAdmission;
  streamPending?: true;
  reportPending?: true;
  conversationPending?: true;
  waits: Record<string, 'dependencies' | 'capacity' | 'resource-conflict' | 'resource-pressure'>;
  profile: {
    elapsedMs: number;
    peakWorkers: number;
    attempts: number;
    retries: number;
    providerCalls: number | null;
    reportedTotalTokens: number | null;
    usageReports: number;
    verifiedObjectivesPerReportedToken: number | null;
  };
}
export type MissionControl =
  | { type: 'pause' | 'resume' | 'cancel' }
  | { type: 'retry' | 'cancel-branch'; taskId: string }
  | { type: 'priority'; taskId: string; priority: number }
  | { type: 'concurrency'; concurrency: number };

export type MissionSummary = Pick<MissionProjection, 'id' | 'objective' | 'outcome' | 'createdAt' | 'revision'>;
export type MissionRevisionChange =
  | { type: 'replace'; taskId: string }
  | { type: 'dependencies'; taskId: string; dependencies: string[] }
  | { type: 'retire'; taskId: string; successorId: string }
  | { type: 'reassign'; taskId: string; agentProfileId: string };
export interface MissionRevisionInput {
  id: string;
  revision: number;
  change: MissionRevisionChange;
}
export interface MissionRevisionPreview {
  kind: 'revision-preview';
  missionId: string;
  revision: number;
  fingerprint: string;
  summary: string;
  externalReview?: {
    provider: string;
    model: string;
    effort?: ReasoningEffort;
    objective: string;
    instructions: string;
    webSearch?: true;
  };
}
export type MissionRequest =
  | { name: 'preview'; input: { objective: string; agentProfileId?: string; proposalId?: string; teamId?: string } }
  | { name: 'plan'; input: { objective: string; fingerprint: string; requestId: string } }
  | { name: 'start'; input: { objective: string; fingerprint: string; requestId: string; agentProfileId?: string; proposalId?: string; teamId?: string } }
  | { name: 'team-library'; input: Record<string, never> }
  | { name: 'team-save'; input: MissionTeamSave }
  | { name: 'team-archive'; input: { id: string; expectedVersion: number } }
  | { name: 'post-report'; input: { id: string } }
  | { name: 'workroom-resource'; input: { resourceId: string } }
  | { name: 'list'; input: Record<string, never> }
  | { name: 'read'; input: { id: string } }
  | { name: 'execution-profile'; input: { id: string } }
  | { name: 'revision-preview'; input: MissionRevisionInput }
  | { name: 'revision-apply'; input: MissionRevisionInput & { fingerprint: string } }
  | { name: 'workroom-preview'; input: { id: string } }
  | { name: 'workroom-apply'; input: { id: string; reviewId: string } }
  | { name: 'control'; input: { id: string; revision: number; control: MissionControl } };
export interface MissionPreview {
  fingerprint: string;
  plan: MissionPlan;
  executors: { id: string; available: boolean }[];
  externalReview?: { provider: string; model: string; effort?: ReasoningEffort; calls: number };
  localReview?: { kind: 'node-test'; maxFiles: number };
  proposalId?: string;
}
export interface MissionPlanningOffer {
  kind: 'planning-offer';
  scope: MissionScope;
  objective: string;
  fingerprint: string;
  planner?: { provider?: 'chatgpt-plan-responses' | 'openai-api-vela'; model: string; effort?: ReasoningEffort; capabilities: string[] };
}
export interface MissionWorkroom {
  kind: 'workroom';
  workspaceId: string;
  title: string;
  templateId: string;
  missionConversationResourceId?: string;
  missionChecklistResourceId?: string;
  missionTimelineResourceId?: string;
  missionCards?: Partial<Record<MissionWorkroomCard, string>>;
  missionAgentCards?: Record<string, string>;
}
export interface MissionWorkroomPreview {
  kind: 'workroom-preview';
  missionId: string;
  reviewId: string;
  title: string;
  expiresAt: string;
  cards: { title: string; kind: string; mode: 'new' | 'reference' }[];
}
export interface MissionWorkroomStreamEvent {
  eventId: string;
  cursor: number;
  receivedAt: string;
  occurredAt?: string;
  type: string;
  status: string | null;
  taskId?: string;
  executor?: string;
  classification: StreamEvent['classification'];
}
export interface MissionAgentAttempt extends Pick<MissionAttempt,
  'id' | 'admittedAt' | 'finishedAt' | 'outcome' | 'context' | 'timing' | 'telemetry'> {
  detail?: string;
  evidenceId?: string;
  source?: string;
  observedAt?: string;
  verification?: string;
  passed?: boolean;
  findings?: string[];
  citations?: string[];
}
export interface MissionAgentDashboard {
  kind: 'agent';
  taskId: string;
  title: string;
  role: string;
  responsibility: string;
  state: MissionTaskState;
  executor: string;
  provider: string;
  model: string;
  criterion: string;
  dependencies: string[];
  maxAttempts: number;
  timeoutMs: number;
  webSearch: boolean;
  retired?: true;
  wait?: MissionProjection['waits'][string];
  profile?: { id: string; title: string; profileVersion: number; resourceVersion: number };
  attempts: MissionAgentAttempt[];
}
export type MissionWorkroomDashboard =
  | MissionAgentDashboard
  | { kind: 'graph'; objective: string; planRevision: number; tasks: {
      id: string; title: string; state: MissionTaskState; dependencies: string[]; executor: string;
      role?: string; wait?: MissionProjection['waits'][string];
    }[] }
  | { kind: 'team'; title?: string; members: {
      taskId: string; role: string; responsibility: string; state: MissionTaskState;
      provider?: string; model?: string; attempts: number;
    }[] }
  | { kind: 'evidence'; criteria: string[]; rows: {
      taskId: string; title: string; state: MissionTaskState; criterion: string;
      evidenceId?: string; source?: string; observedAt?: string; verification?: string; passed?: boolean;
      findings?: string[]; citations?: string[];
    }[] }
  | { kind: 'performance'; profile: MissionProjection['profile']; admission?: MissionAdmission }
  | { kind: 'stream'; events: MissionWorkroomStreamEvent[]; publicationPending?: true };
export type MissionWorkroomCard = Exclude<MissionWorkroomDashboard['kind'], 'agent'>;
export type MissionWorkroomResource = {
  kind: 'workroom-resource';
  missionId: string;
  outcome: MissionProjection['outcome'];
  revision: number;
} & (
  { checklist: { taskId: string; title: string; state: MissionTaskState }[]; timeline?: never; dashboard?: never } |
  { timeline: MissionEvent[]; checklist?: never; dashboard?: never } |
  { dashboard: MissionWorkroomDashboard; checklist?: never; timeline?: never }
);

export type MissionResponse = MissionPlanningOffer | MissionPreview | MissionSummary[] | MissionProjection | MissionWorkroom | MissionWorkroomResource |
  import('./execution-profiler.mts').MissionExecutionProfile |
  MissionWorkroomPreview | MissionRevisionPreview | MissionTeam | MissionTeamLibrary |
  { kind: 'mission-report'; missionId: string; messageId: string } | null;

export interface MissionExecutionContext {
  /** Cooperative checkpoint request. Task cancellation remains a separate signal. */
  resourceCheckpoint?: AbortSignal;
  missionId: string;
  scope: MissionScope;
  task: MissionTaskPlan;
  attemptId: string;
  dependencies: readonly MissionEvidence[];
  context: MissionContextPackage;
  signal: AbortSignal;
}
export interface MissionExecutor {
  readonly lane: string;
  readonly replaySafe: boolean;
  available(scope: MissionScope, task: MissionTaskPlan): boolean;
  run(context: MissionExecutionContext): Promise<{
    source: string; value: unknown;
    outcome?: 'blocked' | 'failed' | 'uncertain';
    telemetry?: NonNullable<MissionAttempt['telemetry']>;
  }>;
  verify(evidence: MissionEvidence, context: MissionExecutionContext): { passed: boolean; detail: string };
}
