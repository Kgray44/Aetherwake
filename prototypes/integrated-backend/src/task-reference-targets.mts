import type { DatabaseSync } from "node:sqlite";
import type { WorkspaceKernel } from "../../workspace-kernel/kernel.mts";
import type {
  TaskActor,
  TaskExecutionMetadata,
} from "../../task-product/contracts.ts";
import {
  TASK_TARGET_CONTRACT,
  TASK_TARGET_LIMITS as L,
  type TaskTargetQuery,
  type TaskTargetPage,
  type TaskReferenceTarget,
} from "../../application-contract/task-targets.ts";

export interface TaskTargetMetadataPage<T> {
  items: readonly T[];
  hasMore: boolean;
}
export interface TaskTargetResourceHeader {
  id: string;
  title: string;
  kind: string;
  projectId: string | null;
  version: number;
  state: "active" | "archived";
}
export interface TaskTargetMessageHeader {
  messageId: string;
  conversationResourceId: string;
  role: "user" | "assistant" | "system";
  createdAt: string;
  revision: string;
}
export interface TaskTargetExecutionHeader {
  id: string;
  resourceId: string;
  revision: string;
  startedAt: string | null;
}
export interface TaskReferenceTargetsOptions {
  kernel: WorkspaceKernel;
  db: DatabaseSync;
  identity(): TaskActor;
  projectAccess(id: string): boolean;
  resourceAccess(id: string, messageId?: string): boolean;
  /** Canonical metadata only. Honor limit/query; hasMore must report omitted candidates. */
  resourcePage(input: {
    kind: "source" | "assignee" | "dependency";
    query: string;
    limit: number;
  }): TaskTargetMetadataPage<TaskTargetResourceHeader>;
  sourceRevision(resourceId: string, messageId?: string): string | null;
  agentProfile(
    resourceId: string,
  ): { resourceVersion: number; profileVersion: number } | null;
  /** Metadata projection of an actual current Task read, not an inferred semantic kind. */
  task(
    resourceId: string,
  ): { resourceId: string; version: number; eligible: boolean } | null;
  /** Existing records only; never probe/start a provider or copy a private execution object. */
  executionPage(input: {
    query: string;
    limit: number;
  }): TaskTargetMetadataPage<TaskTargetExecutionHeader>;
  execution(id: string): TaskExecutionMetadata | null;
  /** Already authorized visible headers only; no text, excerpt, draft or whole-graph clone. */
  messagePage(input: {
    conversationResourceId: string;
    query: string;
    limit: number;
  }): TaskTargetMetadataPage<TaskTargetMessageHeader>;
}
export class TaskReferenceTargetError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "TaskReferenceTargetError";
  }
}
const check: (value: unknown, code: string) => asserts value = (
  value,
  code,
) => {
  if (!value) throw new TaskReferenceTargetError(code);
};
const fields = (
  value: unknown,
  allowed: string[],
  required = allowed,
): value is Record<string, any> =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Reflect.ownKeys(value).every(
    (key) => typeof key === "string" && allowed.includes(key),
  ) &&
  required.every((key) => Object.hasOwn(value, key));
const id = (value: unknown, max = 512): value is string =>
  typeof value === "string" &&
  !!value &&
  value.length <= max &&
  value.trim() === value &&
  !/[\x00-\x1f]/.test(value);
const version = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) > 0;
const iso = (value: unknown): value is string => {
  try {
    return typeof value === "string" && new Date(value).toISOString() === value;
  } catch {
    return false;
  }
};
const permit = (work: () => boolean) => {
  try {
    return work() === true;
  } catch {
    return false;
  }
};
const attempt = <T,>(work: () => T): T | null => {
  try {
    return work();
  } catch {
    return null;
  }
};
const actor = (value: unknown): value is TaskActor =>
  fields(value, ["principalId", "actorKind", "authority", "policyVersion"]) &&
  id(value.principalId, 200) &&
  value.actorKind === "user" &&
  value.authority === "manual" &&
  id(value.policyVersion, 200);
const resourceHeader = (value: unknown): value is TaskTargetResourceHeader =>
  fields(value, ["id", "title", "kind", "projectId", "version", "state"]) &&
  id(value.id) &&
  typeof value.title === "string" &&
  !!value.title.trim() &&
  value.title.length <= 200 &&
  !/[\x00-\x1f]/.test(value.title) &&
  id(value.kind, 100) &&
  (value.projectId === null || id(value.projectId)) &&
  version(value.version) &&
  ["active", "archived"].includes(value.state);
const messageHeader = (value: unknown): value is TaskTargetMessageHeader =>
  fields(value, [
    "messageId",
    "conversationResourceId",
    "role",
    "createdAt",
    "revision",
  ]) &&
  id(value.messageId) &&
  id(value.conversationResourceId) &&
  ["user", "assistant", "system"].includes(value.role) &&
  iso(value.createdAt) &&
  id(value.revision);
const executionHeader = (value: unknown): value is TaskTargetExecutionHeader =>
  fields(value, ["id", "resourceId", "revision", "startedAt"]) &&
  id(value.id) &&
  id(value.resourceId) &&
  id(value.revision) &&
  (value.startedAt === null || iso(value.startedAt));
const executionMetadata = (value: unknown): value is TaskExecutionMetadata =>
  fields(value, [
    "id",
    "revision",
    "resourceId",
    "providerId",
    "commandId",
    "state",
    "nativeThreadId",
    "nativeTurnId",
    "nativeResponseId",
  ]) &&
  ["id", "revision", "resourceId", "providerId", "commandId"].every((key) =>
    id(value[key]),
  ) &&
  [
    "dispatching",
    "running",
    "provider_completed",
    "failed",
    "interrupted",
    "unknown",
  ].includes(value.state) &&
  ["nativeThreadId", "nativeTurnId", "nativeResponseId"].every(
    (key) => value[key] === null || id(value[key]),
  );
function page<T>(
  value: unknown,
  shape: (value: unknown) => value is T,
): TaskTargetMetadataPage<T> {
  check(
    fields(value, ["items", "hasMore"]) &&
      Array.isArray(value.items) &&
      value.items.length <= L.scan &&
      typeof value.hasMore === "boolean" &&
      value.items.every(shape),
    "task_targets_invalid_host_page",
  );
  return value as unknown as TaskTargetMetadataPage<T>;
}

/** Current-policy metadata projection only. No schema, index, cached grant,
 * source body, provider connection, new reference identity or write transaction. */
export function createTaskReferenceTargets(
  options: TaskReferenceTargetsOptions,
): { query(input: TaskTargetQuery): TaskTargetPage } {
  const { kernel, db } = options;
  for (const key of [
    "identity",
    "projectAccess",
    "resourceAccess",
    "resourcePage",
    "sourceRevision",
    "agentProfile",
    "task",
    "executionPage",
    "execution",
    "messagePage",
  ] as const)
    check(typeof options[key] === "function", "task_targets_host_required");
  const tx = <T,>(work: () => T) =>
    kernel.withTransaction((actual) => {
      check(actual === db, "task_targets_canonical_connection_required");
      return work();
    });
  tx(() => {
    const columns = db.prepare("PRAGMA table_info(desktop_resources)").all(),
      refs = db.prepare("PRAGMA foreign_key_list(desktop_resources)").all();
    check(
      columns.some(
        (column) => column.name === "resource_id" && column.pk === 1,
      ) &&
        columns.some(
          (column) => column.name === "kind" && column.notnull === 1,
        ) &&
        refs.some(
          (ref) =>
            ref.from === "resource_id" &&
            ref.table === "resources" &&
            ref.to === "id",
        ),
      "task_targets_canonical_projection_required",
    );
  });
  const project = (projectId: string) =>
    permit(() => options.projectAccess(projectId)) &&
    !!db
      .prepare("SELECT 1 FROM projects WHERE id=? AND state='active'")
      .get(projectId);
  const resource = (resourceId: string, messageId?: string) => {
    if (!id(resourceId) || (messageId !== undefined && !id(messageId)))
      return null;
    const row = db
      .prepare(
        "SELECT r.id,r.title,r.kind AS canonicalKind,r.project_id AS projectId,r.version,r.state,d.kind AS semanticKind FROM resources r LEFT JOIN desktop_resources d ON d.resource_id=r.id WHERE r.id=?",
      )
      .get(resourceId);
    if (
      !row ||
      !version(row.version) ||
      !["active", "archived"].includes(String(row.state)) ||
      (row.projectId !== null && !project(String(row.projectId))) ||
      (messageId !== undefined && row.canonicalKind !== "conversation") ||
      !permit(() => options.resourceAccess(resourceId, messageId))
    )
      return null;
    return {
      id: String(row.id),
      title: String(row.title),
      kind: String(row.semanticKind ?? row.canonicalKind),
      projectId: row.projectId as string | null,
      version: Number(row.version),
      state: row.state as "active" | "archived",
      canonicalKind: String(row.canonicalKind),
    };
  };
  const same = (
    a: NonNullable<ReturnType<typeof resource>>,
    b: NonNullable<ReturnType<typeof resource>>,
  ) =>
    a.id === b.id &&
    a.title === b.title &&
    a.kind === b.kind &&
    a.projectId === b.projectId &&
    a.version === b.version &&
    a.state === b.state &&
    a.canonicalKind === b.canonicalKind;
  function query(input: TaskTargetQuery): TaskTargetPage {
    check(
      fields(
        input,
        ["kind", "query", "conversationResourceId", "limit"],
        ["kind"],
      ) &&
        ["source", "assignee", "dependency", "execution"].includes(
          input.kind,
        ) &&
        (input.query === undefined ||
          (typeof input.query === "string" &&
            input.query.length <= L.queryUnits &&
            !/[\x00-\x1f]/.test(input.query))) &&
        (input.limit === undefined ||
          (version(input.limit) && input.limit <= L.limit)) &&
        (input.conversationResourceId === undefined ||
          (input.kind === "source" && id(input.conversationResourceId))),
      "task_targets_invalid_query",
    );
    const kind = input.kind,
      search = input.query?.trim() ?? "",
      needle = search.toLowerCase(),
      limit = input.limit ?? L.defaultLimit,
      conversationId = input.conversationResourceId;
    return tx(() => {
      const currentActor = attempt(() => options.identity());
      check(actor(currentActor), "task_targets_denied");
      const authority: TaskActor = {
        principalId: currentActor.principalId,
        actorKind: currentActor.actorKind,
        authority: currentActor.authority,
        policyVersion: currentActor.policyVersion,
      };
      const items: TaskReferenceTarget[] = [],
        keys = new Set<string>();
      let incomplete = false,
        examined = 0,
        bytes = 0;
      const matches = (value: string) =>
        !needle || value.toLowerCase().includes(needle);
      const add = (value: TaskReferenceTarget) => {
        if (keys.has(value.key)) return true;
        const size = Buffer.byteLength(JSON.stringify(value));
        if (items.length === limit || bytes + size > L.responseBytes - 4096) {
          incomplete = true;
          return false;
        }
        keys.add(value.key);
        bytes += size;
        items.push(value);
        return true;
      };
      if (
        kind === "assignee" &&
        authority.principalId === "local-owner" &&
        matches("You")
      )
        add({
          key: "principal:local-owner",
          kind,
          label: "You",
          reference: { kind: "principal", principalId: authority.principalId },
        });
      if (conversationId !== undefined) {
        const conversation = resource(conversationId);
        check(
          conversation?.canonicalKind === "conversation" &&
            conversation.state === "active",
          "task_targets_conversation_unavailable",
        );
        const headers = page(
          attempt(() =>
            options.messagePage({
              conversationResourceId: conversationId,
              query: search,
              limit: L.scan,
            }),
          ),
          messageHeader,
        );
        incomplete ||= headers.hasMore;
        const seen = new Set<string>();
        for (const header of headers.items) {
          if (items.length === limit) {
            incomplete = true;
            break;
          }
          if (seen.has(header.messageId)) {
            incomplete = true;
            continue;
          }
          seen.add(header.messageId);
          if (header.conversationResourceId !== conversationId) {
            incomplete = true;
            continue;
          }
          const before = resource(conversationId, header.messageId);
          if (!before || !same(before, conversation)) {
            incomplete = true;
            continue;
          }
          const revision = attempt(() =>
              options.sourceRevision(conversationId, header.messageId),
            ),
            after = resource(conversationId, header.messageId);
          if (!after || !same(before, after)) {
            incomplete = true;
            continue;
          }
          examined++;
          if (!id(revision) || revision !== header.revision) {
            incomplete = true;
            continue;
          }
          const label =
            before.title + " · " + header.role + " · " + header.createdAt;
          if (
            matches(label) &&
            !add({
              key: "source:" + conversationId + ":message:" + header.messageId,
              kind: "source",
              label,
              resourceKind: before.kind,
              reference: {
                resourceId: conversationId,
                messageId: header.messageId,
                revision,
              },
              message: { role: header.role, createdAt: header.createdAt },
            })
          )
            break;
        }
      } else if (kind === "execution") {
        const headers = page(
          attempt(() =>
            options.executionPage({ query: search, limit: L.scan }),
          ),
          executionHeader,
        );
        incomplete ||= headers.hasMore;
        const seen = new Set<string>();
        for (const header of headers.items) {
          if (items.length === limit) {
            incomplete = true;
            break;
          }
          if (seen.has(header.id)) {
            incomplete = true;
            continue;
          }
          seen.add(header.id);
          const before = resource(header.resourceId);
          if (!before) {
            incomplete = true;
            continue;
          }
          const current = attempt(() => options.execution(header.id)),
            after = resource(header.resourceId);
          if (!after || !same(before, after)) {
            incomplete = true;
            continue;
          }
          examined++;
          if (
            !executionMetadata(current) ||
            current.id !== header.id ||
            current.resourceId !== before.id ||
            current.revision !== header.revision
          ) {
            incomplete = true;
            continue;
          }
          const label =
            before.title +
            " · " +
            current.providerId +
            (header.startedAt ? " · " + header.startedAt : "");
          if (
            matches(label) &&
            !add({
              key: "execution:" + current.id,
              kind,
              label,
              reference: { id: current.id, revision: current.revision },
              providerId: current.providerId,
              startedAt: header.startedAt,
            })
          )
            break;
        }
      } else {
        const headers = page(
          attempt(() =>
            options.resourcePage({ kind, query: search, limit: L.scan }),
          ),
          resourceHeader,
        );
        incomplete ||= headers.hasMore;
        const seen = new Set<string>();
        for (const header of headers.items) {
          if (items.length === limit) {
            incomplete = true;
            break;
          }
          if (seen.has(header.id)) {
            incomplete = true;
            continue;
          }
          seen.add(header.id);
          const before = resource(header.id);
          if (!before) {
            incomplete = true;
            continue;
          }
          if (
            before.title !== header.title ||
            before.kind !== header.kind ||
            before.projectId !== header.projectId ||
            before.version !== header.version ||
            before.state !== header.state
          ) {
            incomplete = true;
            continue;
          }
          let target: TaskReferenceTarget | null = null,
            unavailable = false;
          if (kind === "source") {
            const revision = attempt(() => options.sourceRevision(before.id));
            if (!id(revision)) unavailable = true;
            else
              target = {
                key: "source:" + before.id,
                kind,
                label: before.title,
                resourceKind: before.kind,
                reference: { resourceId: before.id, revision },
              };
          } else if (
            kind === "assignee" &&
            before.canonicalKind === "generic" &&
            before.kind === "agent" &&
            before.state === "active"
          ) {
            const profile = attempt(() => options.agentProfile(before.id));
            if (
              !fields(profile, ["resourceVersion", "profileVersion"]) ||
              !version(profile.profileVersion) ||
              profile.resourceVersion !== before.version
            )
              unavailable = true;
            else
              target = {
                key: "agent:" + before.id,
                kind,
                label: before.title,
                reference: {
                  kind: "agent",
                  resourceId: before.id,
                  resourceVersion: before.version,
                  profileVersion: profile.profileVersion,
                },
              };
          } else if (
            kind === "dependency" &&
            before.canonicalKind === "generic" &&
            before.kind === "task_objective" &&
            before.state === "active"
          ) {
            const task = attempt(() => options.task(before.id));
            if (
              !fields(task, ["resourceId", "version", "eligible"]) ||
              task.resourceId !== before.id ||
              task.version !== before.version ||
              typeof task.eligible !== "boolean"
            )
              unavailable = true;
            else if (task.eligible)
              target = {
                key: "task:" + before.id,
                kind,
                label: before.title,
                reference: { resourceId: before.id, version: before.version },
              };
          }
          const after = resource(header.id);
          if (!after || !same(before, after)) {
            incomplete = true;
            continue;
          }
          examined++;
          if (unavailable) incomplete = true;
          if (target && matches(target.label) && !add(target)) break;
        }
      }
      const latest = attempt(() => options.identity());
      check(
        actor(latest) &&
          latest.principalId === authority.principalId &&
          latest.actorKind === authority.actorKind &&
          latest.authority === authority.authority &&
          latest.policyVersion === authority.policyVersion,
        "task_targets_authority_changed",
      );
      const result: TaskTargetPage = {
        contract: TASK_TARGET_CONTRACT,
        kind,
        items,
        referenceOnly: true,
        coverage: incomplete ? "bounded" : "complete",
        scan: { examined, limit: L.scan, hasMore: incomplete },
      };
      check(
        Buffer.byteLength(JSON.stringify(result)) <= L.responseBytes,
        "task_targets_response_capacity",
      );
      return result;
    });
  }
  return { query };
}
