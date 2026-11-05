/** Canonical objective metadata, distinct from legacy Note-backed manual Tasks.
 * No DTO here starts/cancels a provider, grants authority or creates a block. */
export const TASK_OBJECTIVE_CONTRACT = "aerynth.task-objective@1" as const;
export interface TaskObjectiveResource {
  id: string;
  kind: "task_objective";
  title: string;
  projectId: string | null;
  version: number;
  state: "active" | "archived";
}
export interface TaskActor {
  principalId: string;
  actorKind: "user";
  authority: "manual";
  policyVersion: string;
}
export interface TaskProvenance {
  actor: TaskActor;
  authorizationRef: string;
  at: string;
}
export interface TaskSourceRef {
  resourceId: string;
  revision: string;
  messageId?: string;
}
export type TaskAssigneeRef =
  | { kind: "principal"; principalId: string }
  | {
      kind: "agent";
      resourceId: string;
      resourceVersion: number;
      profileVersion: number;
    };
export interface TaskDependencyRef {
  resourceId: string;
  version: number;
}
export interface TaskExecutionRef {
  id: string;
  revision: string;
}
/** Current metadata from the host's EXISTING execution record. No copied state
 * is persisted by this service and this read is never a provider/liveness probe. */
export interface TaskExecutionMetadata extends TaskExecutionRef {
  resourceId: string;
  providerId: string;
  commandId: string;
  state:
    | "dispatching"
    | "running"
    | "provider_completed"
    | "failed"
    | "interrupted"
    | "unknown";
  nativeThreadId: string | null;
  nativeTurnId: string | null;
  nativeResponseId: string | null;
}
export interface TaskDefinition {
  objective: string;
  requirements: { id: string; text: string }[];
  assignees: TaskAssigneeRef[];
  dependencies: TaskDependencyRef[];
  sources: TaskSourceRef[];
}
export type TaskFreshness = "current" | "changed" | "unavailable";
export interface TaskReferenceProjection<T> {
  reference: T | null;
  current: T | null;
  freshness: TaskFreshness;
}
export interface TaskDependencyProjection
  extends TaskReferenceProjection<TaskDependencyRef> {
  acceptance: "valid" | "not-accepted" | "stale" | "unavailable";
}
export interface TaskExecutionProjection {
  reference: TaskExecutionRef | null;
  current: TaskExecutionMetadata | null;
  freshness: TaskFreshness;
}
export interface TaskAttemptProjection {
  id: string;
  version: 1;
  definitionVersion: number;
  definitionDigest: string;
  provenance: TaskProvenance;
  relation: "user-linked-existing-execution";
  execution: TaskExecutionProjection;
}
export type TaskReviewDecision = "verified" | "needs-work" | "rejected";
export interface TaskReviewProjection {
  id: string;
  definitionVersion: number;
  definitionDigest: string;
  attemptId: string | null;
  decision: TaskReviewDecision;
  requirementIds: string[];
  note: string;
  provenance: TaskProvenance;
  evidence: TaskReferenceProjection<TaskSourceRef>[];
  execution: TaskExecutionProjection | null;
  freshness: TaskFreshness;
}
export interface TaskAcceptanceRecord {
  id: string;
  definitionVersion: number;
  definitionDigest: string;
  reviewIds: string[];
  provenance: TaskProvenance;
}
export const taskObjectiveCapabilities = Object.freeze({
  execution: "reference-only" as const,
  startsExecution: false,
  interruptsExecution: false,
  automaticVerification: false,
  automaticAcceptance: false,
});
export interface TaskObjectiveSnapshot {
  proofCoverage: "complete" | "bounded";
  definition: Pick<TaskDefinition, "objective" | "requirements">;
  definitionVersion: number;
  definitionDigest: string;
  disposition: "open" | "accepted" | "cancelled";
  assignees: TaskReferenceProjection<TaskAssigneeRef>[];
  dependencies: TaskDependencyProjection[];
  sources: TaskReferenceProjection<TaskSourceRef>[];
  attempts: TaskAttemptProjection[];
  reviews: TaskReviewProjection[];
  verification:
    | "unreviewed"
    | "partial"
    | "needs-work"
    | "verified"
    | "stale"
    | "unavailable";
  acceptance: {
    state: "not-accepted" | "historical" | "valid" | "stale" | "unavailable";
    record: TaskAcceptanceRecord | null;
  };
  capabilities: typeof taskObjectiveCapabilities;
}
export interface TaskObjectiveDocument extends TaskObjectiveSnapshot {
  contract: typeof TASK_OBJECTIVE_CONTRACT;
  resource: TaskObjectiveResource;
  canEdit: boolean;
  lastMutationVersion: number;
}
export interface CreateTaskObjective {
  commandId: string;
  title: string;
  projectId: string | null;
  definition: TaskDefinition;
}
export type TaskObjectiveOperation =
  | { type: "replaceDefinition"; definition: TaskDefinition }
  | { type: "linkAttempt"; execution: TaskExecutionRef }
  | {
      type: "review";
      attemptId: string | null;
      executionRevision?: string;
      decision: TaskReviewDecision;
      requirementIds: string[];
      evidence: TaskSourceRef[];
      note: string;
    }
  | { type: "accept"; reviewIds: string[] }
  | { type: "reopen" }
  | { type: "administrativeCancel" };
export interface MutateTaskObjective {
  commandId: string;
  resourceId: string;
  expectedVersion: number;
  operation: TaskObjectiveOperation;
}
export interface TaskObjectiveReceipt {
  resourceId: string;
  version: number;
  definitionVersion: number;
  definitionDigest: string;
  commandId: string;
  operation: "create" | TaskObjectiveOperation["type"];
  createdId?: string;
  executionEffects: "none";
}
export interface TaskObjectiveHistory {
  resourceId: string;
  currentResourceVersion: number;
  items: {
    version: number;
    operation: TaskObjectiveReceipt["operation"];
    provenance: TaskProvenance;
    snapshot: TaskObjectiveSnapshot;
  }[];
  nextAfterVersion: number | null;
  coverage: "complete" | "bounded";
}
export interface TaskObjectiveList {
  items: {
    resource: TaskObjectiveResource;
    canEdit: boolean;
    lastMutationVersion: number;
  }[];
  coverage: "complete" | "bounded";
}
export interface TaskObjectivePort {
  create(input: CreateTaskObjective): Promise<TaskObjectiveReceipt>;
  read(resourceId: string): Promise<TaskObjectiveDocument>;
  mutate(input: MutateTaskObjective): Promise<TaskObjectiveReceipt>;
  history(input: {
    resourceId: string;
    afterVersion?: number;
    limit?: number;
  }): Promise<TaskObjectiveHistory>;
  list(input?: {
    projectId?: string | null;
    limit?: number;
  }): Promise<TaskObjectiveList>;
}
export const TASK_OBJECTIVE_LIMITS = Object.freeze({
  documents: 256,
  versions: 4096,
  receipts: 8192,
  dataBytes: 131072,
  responseBytes: 524288,
  totalBytes: 33554432,
  objectiveUnits: 8192,
  requirements: 32,
  assignees: 16,
  dependencies: 32,
  sources: 32,
  attempts: 64,
  reviews: 128,
  acceptances: 64,
  evidence: 16,
  history: 64,
  list: 128,
  proofNodes: 256,
});
