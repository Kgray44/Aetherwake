import type {
  TaskSourceRef,
  TaskAssigneeRef,
  TaskDependencyRef,
  TaskExecutionRef,
} from "../task-product/contracts.ts";

export const TASK_TARGET_CONTRACT = "aerynth.task-targets@1" as const;
export type TaskTargetKind = "source" | "assignee" | "dependency" | "execution";
export type TaskTargetQuery = {
  [K in TaskTargetKind]: {
    kind: K;
    query?: string;
    limit?: number;
  } & (K extends "source"
    ? { conversationResourceId?: string }
    : { conversationResourceId?: never });
}[TaskTargetKind];
type Labelled = { key: string; label: string };
export type TaskReferenceTarget =
  | (Labelled & {
      kind: "source";
      reference: TaskSourceRef;
      resourceKind: string;
      message?: { role: "user" | "assistant" | "system"; createdAt: string };
    })
  | (Labelled & { kind: "assignee"; reference: TaskAssigneeRef })
  | (Labelled & { kind: "dependency"; reference: TaskDependencyRef })
  | (Labelled & {
      kind: "execution";
      reference: TaskExecutionRef;
      providerId: string;
      startedAt: string | null;
    });
export interface TaskTargetPage {
  contract: typeof TASK_TARGET_CONTRACT;
  kind: TaskTargetKind;
  items: TaskReferenceTarget[];
  /** A selection is neither a permission grant nor an execution command. */
  referenceOnly: true;
  coverage: "complete" | "bounded";
  /** No global totals, hidden IDs, denied counts or provider liveness claims. */
  scan: { examined: number; limit: number; hasMore: boolean };
}
export interface TaskReferenceTargetsPort {
  targets(input: TaskTargetQuery): Promise<TaskTargetPage>;
}
export const TASK_TARGET_LIMITS = Object.freeze({
  scan: 128,
  defaultLimit: 24,
  limit: 50,
  queryUnits: 100,
  responseBytes: 262144,
});
