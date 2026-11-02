import type { DatabaseSync } from "node:sqlite";
import type { WorkspaceKernel } from "../../workspace-kernel/kernel.mts";
import {
  TaskObjectiveService,
  TaskObjectiveError,
  type TaskObjectiveHost,
  type TaskObjectiveEvent,
} from "../../task-product/service.mts";
import type {
  TaskActor,
  TaskObjectiveResource,
  TaskExecutionMetadata,
} from "../../task-product/contracts.ts";
export type { TaskObjectiveEvent } from "../../task-product/service.mts";

type Command<I, O> = { input: I; output: O };
export interface TaskObjectiveCommandMap {
  create: Command<
    Parameters<TaskObjectiveService["create"]>[0],
    ReturnType<TaskObjectiveService["create"]>
  >;
  read: Command<
    { resourceId: string },
    ReturnType<TaskObjectiveService["read"]>
  >;
  mutate: Command<
    Parameters<TaskObjectiveService["mutate"]>[0],
    ReturnType<TaskObjectiveService["mutate"]>
  >;
  history: Command<
    Parameters<TaskObjectiveService["history"]>[0],
    ReturnType<TaskObjectiveService["history"]>
  >;
  list: Command<
    NonNullable<Parameters<TaskObjectiveService["list"]>[0]>,
    ReturnType<TaskObjectiveService["list"]>
  >;
}
export type TaskObjectiveRequest = {
  [K in keyof TaskObjectiveCommandMap]: {
    name: K;
    input: TaskObjectiveCommandMap[K]["input"];
  };
}[keyof TaskObjectiveCommandMap];
export type TaskObjectiveResponse =
  TaskObjectiveCommandMap[keyof TaskObjectiveCommandMap]["output"];
export interface TaskObjectiveCommandsOptions {
  kernel: WorkspaceKernel;
  db: DatabaseSync;
  /** Trusted current manual actor, never a renderer command field. */
  identity(): TaskActor;
  now(): string;
  authorize: TaskObjectiveHost["authorize"];
  projectAccess(id: string): boolean;
  /** Must check actual visible/readable message IDs when provided. */
  resourceAccess(id: string, messageId?: string): boolean;
  /** Current canonical content/message revision; metadata only, no bodies/probes. */
  sourceRevision(resourceId: string, messageId?: string): string | null;
  /** Existing AgentService authority, after canonical access gates. No catalog or provider discovery. */
  agentProfile(
    resourceId: string,
  ): { resourceVersion: number; profileVersion: number } | null;
  /** Read existing canonical execution metadata only. No new execution or provider call. */
  execution(id: string): TaskExecutionMetadata | null;
  /** Inside SAME transaction. Root owns post-commit publication. */
  recordEvent(event: TaskObjectiveEvent): void;
}
export interface TaskObjectiveCommands {
  dispatch<K extends keyof TaskObjectiveCommandMap>(request: {
    name: K;
    input: TaskObjectiveCommandMap[K]["input"];
  }): TaskObjectiveCommandMap[K]["output"];
}
const check: (value: unknown, code: string) => asserts value = (
  value,
  code,
) => {
  if (!value) throw new TaskObjectiveError(code);
};
const fields = (value: unknown, keys: string[]): value is Record<string, any> =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Reflect.ownKeys(value).every(
    (key) => typeof key === "string" && keys.includes(key),
  ) &&
  keys.every((key) => Object.hasOwn(value, key));
const id = (value: unknown): value is string =>
  typeof value === "string" &&
  !!value &&
  value.length <= 512 &&
  value.trim() === value &&
  !/[\x00-\x1f]/.test(value);
const version = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) > 0;
const permit = (work: () => boolean) => {
  try {
    return work() === true;
  } catch {
    return false;
  }
};
const envelope = (value: unknown): value is { name: string; input: unknown } =>
  fields(value, ["name", "input"]) && typeof value.name === "string";
export function isTaskObjectiveRead(value: unknown): boolean {
  return envelope(value) && ["read", "history", "list"].includes(value.name);
}

/** Host-only composition of the released service on Root's live connection.
 * Fixed commands, fresh service per call, no alternate resource/profile/event/
 * execution store. Root wraps mutations in Core.atomic and buffers delivery. */
export function createTaskObjectiveCommands(
  options: TaskObjectiveCommandsOptions,
): TaskObjectiveCommands {
  const { kernel, db } = options;
  for (const callback of [
    "identity",
    "now",
    "authorize",
    "projectAccess",
    "resourceAccess",
    "sourceRevision",
    "agentProfile",
    "execution",
    "recordEvent",
  ] as const)
    check(
      typeof options[callback] === "function",
      "task_adapter_host_required",
    );
  const tx = <T,>(work: () => T): T =>
    kernel.withTransaction((actual) => {
      check(actual === db, "task_canonical_connection_required");
      return work();
    });
  tx(() => {
    const columns = db.prepare("PRAGMA table_info(desktop_resources)").all(),
      refs = db.prepare("PRAGMA foreign_key_list(desktop_resources)").all();
    check(
      columns.filter((column) => Number(column.pk) > 0).length === 1 &&
        columns.some(
          (column) =>
            column.name === "resource_id" &&
            column.pk === 1 &&
            column.type === "TEXT",
        ) &&
        columns.some(
          (column) =>
            column.name === "kind" &&
            column.notnull === 1 &&
            column.type === "TEXT",
        ) &&
        refs.some(
          (ref) =>
            ref.from === "resource_id" &&
            ref.table === "resources" &&
            ref.to === "id",
        ),
      "task_canonical_projection_required",
    );
  });
  const project = (projectId: string) => {
    if (!id(projectId) || !permit(() => options.projectAccess(projectId)))
      return false;
    const row = db
      .prepare("SELECT state,version FROM projects WHERE id=?")
      .get(projectId);
    return row?.state === "active" && version(row.version);
  };
  const rawResource = (resourceId: string, messageId?: string) => {
    if (!id(resourceId) || (messageId !== undefined && !id(messageId)))
      return null;
    const row = db
      .prepare(
        "SELECT r.id,r.kind AS canonical_kind,r.title,r.project_id,r.state,r.version,d.kind AS semantic_kind FROM resources r LEFT JOIN desktop_resources d ON d.resource_id=r.id WHERE r.id=?",
      )
      .get(resourceId);
    if (
      !row ||
      !["active", "archived"].includes(String(row.state)) ||
      !version(row.version) ||
      (messageId !== undefined && row.canonical_kind !== "conversation") ||
      (row.project_id !== null && !project(String(row.project_id))) ||
      !permit(() => options.resourceAccess(resourceId, messageId))
    )
      return null;
    return row;
  };
  const objective = (resourceId: string): TaskObjectiveResource | null => {
    const row = rawResource(resourceId);
    return row?.canonical_kind === "generic" &&
      row.semantic_kind === "task_objective" &&
      row.state === "active"
      ? {
          id: String(row.id),
          kind: "task_objective",
          title: String(row.title),
          projectId: row.project_id as string | null,
          version: Number(row.version),
          state: "active",
        }
      : null;
  };
  const host: TaskObjectiveHost = {
    db,
    identity: () => options.identity(),
    now: () => options.now(),
    authorize: (input) => options.authorize(input),
    projectAccess: project,
    resourceAccess: (resourceId, messageId) =>
      rawResource(resourceId, messageId) !== null,
    readResource: (resourceId) => {
      const resource = objective(resourceId);
      return resource ? { resource, authorized: true, writable: true } : null;
    },
    createResource: (input) => {
      check(
        input.kind === "task_objective" &&
          (input.projectId === null || project(input.projectId)),
        "task_project_unavailable",
      );
      const created = kernel.createGenericResource(
        input.title,
        input.projectId,
        { origin: "user", correlationId: input.commandId },
      );
      check(
        created.kind === "generic" &&
          created.state === "active" &&
          created.project_id === input.projectId,
        "task_canonical_factory_required",
      );
      db.prepare(
        "INSERT INTO desktop_resources(resource_id,kind) VALUES(?,?)",
      ).run(created.id, "task_objective");
      const resource = objective(created.id);
      check(resource, "task_unavailable");
      return resource;
    },
    touchResource: (input) => {
      const before = objective(input.resourceId);
      check(before, "task_unavailable");
      kernel.touchGenericResource(before.id, input.expectedVersion, {
        origin: "user",
        correlationId: input.commandId,
      });
      const resource = objective(before.id);
      check(resource, "task_unavailable");
      return resource;
    },
    resolveReference: (reference) => {
      const row = rawResource(reference.resourceId, reference.messageId);
      if (!row) return null;
      const revision = options.sourceRevision(
        reference.resourceId,
        reference.messageId,
      );
      if (!id(revision)) return null;
      return {
        reference: {
          resourceId: reference.resourceId,
          revision,
          ...(reference.messageId !== undefined
            ? { messageId: reference.messageId }
            : {}),
        },
        projectId: row.project_id as string | null,
        state: row.state as "active" | "archived",
      };
    },
    resolveAssignee: (reference) => {
      if (reference.kind === "principal")
        return reference.principalId === options.identity().principalId
          ? { reference: structuredClone(reference), projectId: null }
          : null;
      const row = rawResource(reference.resourceId);
      if (
        row?.canonical_kind !== "generic" ||
        row.semantic_kind !== "agent" ||
        row.state !== "active"
      )
        return null;
      const profile = options.agentProfile(reference.resourceId);
      if (
        !profile ||
        !version(profile.resourceVersion) ||
        !version(profile.profileVersion) ||
        profile.resourceVersion !== row.version
      )
        return null;
      return {
        reference: {
          kind: "agent",
          resourceId: reference.resourceId,
          resourceVersion: profile.resourceVersion,
          profileVersion: profile.profileVersion,
        },
        projectId: row.project_id as string | null,
      };
    },
    execution: (executionId) => {
      const execution = options.execution(executionId);
      return execution &&
        execution.id === executionId &&
        rawResource(execution.resourceId)
        ? structuredClone(execution)
        : null;
    },
    recordEvent: (event) => options.recordEvent(event),
  };
  function dispatch(request: TaskObjectiveRequest): TaskObjectiveResponse {
    check(
      envelope(request) &&
        ["create", "read", "mutate", "history", "list"].includes(request.name),
      "invalid_task_objective_request",
    );
    if (request.name === "read")
      check(
        fields(request.input, ["resourceId"]) && id(request.input.resourceId),
        "invalid_task_objective_input",
      );
    return tx(() => {
      const service = new TaskObjectiveService(kernel, host);
      switch (request.name) {
        case "create":
          return service.create(request.input);
        case "read":
          return service.read(request.input.resourceId);
        case "mutate":
          return service.mutate(request.input);
        case "history":
          return service.history(request.input);
        case "list":
          return service.list(request.input);
      }
    });
  }
  return { dispatch: dispatch as TaskObjectiveCommands["dispatch"] };
}
