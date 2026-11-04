import type { MissionContextPackage } from '../../vela-core/src/mission-context.mts';
import type { ReasoningEffort } from '../../openai-provider/model-controls.ts';
import type { ReportedUsage } from '../../openai-provider/contracts.mts';

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
  specialist?: {
    role: string;
    instructions: string;
    provider: 'chatgpt-plan-responses';
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
}
export interface MissionPlanningReceipt {
  provider: 'chatgpt-plan-responses';
  model: string;
  effort?: ReasoningEffort;
  responseId: string;
  startedAt: string;
  durationMs: number;
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
export interface MissionAttempt {
  id: string;
  executor: string;
  admittedAt: string;
  finishedAt?: string;
  outcome?: 'verified' | 'failed' | 'blocked' | 'cancelled' | 'uncertain';
  evidence?: MissionEvidence;
  verification?: MissionVerification;
  context?: MissionContextPackage['manifest'];
  telemetry?: { durationMs: number; providerCalls: number; usage?: ReportedUsage; responseId?: string; reportedModel?: string };
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
  kind: 'created' | 'revised' | 'control' | 'started' | 'settled' | 'recovered' | 'workroom';
  taskId?: string;
  attemptId?: string;
  detail?: string;
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
  workroom?: MissionWorkroom;
  tasks: MissionTask[];
  events: MissionEvent[];
}
export interface MissionProjection extends Mission {
  outcome: 'queued' | 'running' | 'paused' | 'cancelling' | 'cancelled' | 'blocked' | 'failed' | 'uncertain' | 'verified';
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
export type MissionRequest =
  | { name: 'preview'; input: { objective: string; agentProfileId?: string; proposalId?: string } }
  | { name: 'plan'; input: { objective: string; fingerprint: string; requestId: string } }
  | { name: 'start'; input: { objective: string; fingerprint: string; requestId: string; agentProfileId?: string; proposalId?: string } }
  | { name: 'list'; input: Record<string, never> }
  | { name: 'read'; input: { id: string } }
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
  planner?: { model: string; effort?: ReasoningEffort; capabilities: string[] };
}
export interface MissionWorkroom {
  kind: 'workroom';
  workspaceId: string;
  title: string;
  templateId: string;
}
export interface MissionWorkroomPreview {
  kind: 'workroom-preview';
  missionId: string;
  reviewId: string;
  title: string;
  expiresAt: string;
  cards: { title: string; kind: string; mode: 'new' | 'reference' }[];
}
export type MissionResponse = MissionPlanningOffer | MissionPreview | MissionSummary[] | MissionProjection | MissionWorkroom | MissionWorkroomPreview | null;

export interface MissionExecutionContext {
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
