import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { WorkspaceKernel } from "../workspace-kernel/kernel.mts";
import {
  TASK_OBJECTIVE_CONTRACT,
  TASK_OBJECTIVE_LIMITS as L,
  taskObjectiveCapabilities,
  type TaskObjectiveResource,
  type TaskActor,
  type TaskProvenance,
  type TaskSourceRef,
  type TaskAssigneeRef,
  type TaskDependencyRef,
  type TaskExecutionRef,
  type TaskExecutionMetadata,
  type TaskDefinition,
  type TaskReferenceProjection,
  type TaskDependencyProjection,
  type TaskExecutionProjection,
  type TaskReviewProjection,
  type TaskAcceptanceRecord,
  type TaskObjectiveSnapshot,
  type TaskObjectiveDocument,
  type CreateTaskObjective,
  type MutateTaskObjective,
  type TaskObjectiveOperation,
  type TaskObjectiveReceipt,
  type TaskObjectiveHistory,
  type TaskObjectiveList,
  type TaskFreshness,
} from "./contracts.ts";

export interface TaskObjectiveHost {
  readonly db: DatabaseSync;
  identity(): TaskActor;
  now(): string;
  authorize(input: {
    operation: "create" | "read" | TaskObjectiveOperation["type"];
    task: TaskObjectiveResource | null;
    projectId: string | null;
    requestDigest: string;
    resourceIds: string[];
    execution?: TaskExecutionRef;
  }): {
    decision: "allow" | "deny";
    authorizationRef: string;
    policyVersion: string;
  };
  projectAccess(id: string): boolean;
  resourceAccess(id: string, messageId?: string): boolean;
  readResource(id: string): {
    resource: TaskObjectiveResource;
    authorized: boolean;
    writable: boolean;
  } | null;
  createResource(input: {
    kind: "task_objective";
    title: string;
    projectId: string | null;
    commandId: string;
  }): TaskObjectiveResource;
  touchResource(input: {
    resourceId: string;
    expectedVersion: number;
    commandId: string;
  }): TaskObjectiveResource;
  /** Current authorized canonical metadata only; message IDs must actually exist/ be readable. No source bodies. */
  resolveReference(reference: TaskSourceRef): {
    reference: TaskSourceRef;
    projectId: string | null;
    state: "active" | "archived";
  } | null;
  /** Actual agent profile versions or known assignable principal, never a well-formed-ID fallback. */
  resolveAssignee(
    reference: TaskAssigneeRef,
  ): { reference: TaskAssigneeRef; projectId: string | null } | null;
  /** EXISTING record only; no provider probes, new turns or parallel execution storage. */
  execution(id: string): TaskExecutionMetadata | null;
  /** Inside SAME transaction. Host owns stream storage and post-commit delivery. */
  recordEvent(event: TaskObjectiveEvent): void;
}
export interface TaskObjectiveEvent {
  type: "task-objective.created" | "task-objective.changed";
  resourceId: string;
  resourceVersion: number;
  commandId: string;
  detail: {
    operation: TaskObjectiveReceipt["operation"];
    actor: TaskActor;
    authorizationRef: string;
    definitionVersion: number;
    definitionDigest: string;
    disposition: State["disposition"];
    attemptCount: number;
    reviewCount: number;
    createdId?: string;
  };
}
interface Attempt {
  id: string;
  version: 1;
  definitionVersion: number;
  definitionDigest: string;
  provenance: TaskProvenance;
  execution: TaskExecutionRef;
}
interface Review {
  id: string;
  definitionVersion: number;
  definitionDigest: string;
  attemptId: string | null;
  decision: TaskReviewProjection["decision"];
  requirementIds: string[];
  evidence: TaskSourceRef[];
  note: string;
  provenance: TaskProvenance;
  execution: TaskExecutionRef | null;
}
interface State {
  schemaVersion: 1;
  definition: TaskDefinition;
  definitionVersion: number;
  definitionDigest: string;
  disposition: "open" | "accepted" | "cancelled";
  attempts: Attempt[];
  reviews: Review[];
  acceptances: TaskAcceptanceRecord[];
}
type ProofContext = {
  count: number;
  bounded: boolean;
  seen: Set<string>;
  cache: Map<string, any>;
};
const context = (): ProofContext => ({
  count: 0,
  bounded: false,
  seen: new Set(),
  cache: new Map(),
});
export class TaskObjectiveError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "TaskObjectiveError";
  }
}
const check: (value: unknown, code: string) => asserts value = (
  value,
  code,
) => {
  if (!value) throw new TaskObjectiveError(code);
};
const object = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const fields = (
  value: unknown,
  keys: string[],
  required = keys,
): value is Record<string, any> =>
  object(value) &&
  Reflect.ownKeys(value).every(
    (key) => typeof key === "string" && keys.includes(key),
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
const text = (value: unknown, max: number, empty = false): value is string =>
  typeof value === "string" &&
  (empty || !!value.trim()) &&
  value.length <= max &&
  !value.includes("\0") &&
  Buffer.byteLength(value) <= max * 4;
const iso = (value: unknown): value is string => {
  try {
    return typeof value === "string" && new Date(value).toISOString() === value;
  } catch {
    return false;
  }
};
const encode = (value: unknown): string =>
  JSON.stringify(value, (_key, v) =>
    object(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((key) => [key, v[key]]),
        )
      : v,
  );
const digest = (value: unknown) =>
  createHash("sha256").update(encode(value)).digest("hex");
const hash = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const unique = (values: any[], key: (value: any) => string = encode) =>
  new Set(values.map(key)).size === values.length;
const sourceShape = (value: unknown): value is TaskSourceRef =>
  fields(
    value,
    ["resourceId", "revision", "messageId"],
    ["resourceId", "revision"],
  ) &&
  id(value.resourceId) &&
  id(value.revision) &&
  (value.messageId === undefined || id(value.messageId));
const executionShape = (value: unknown): value is TaskExecutionRef =>
  fields(value, ["id", "revision"]) && id(value.id) && id(value.revision);
const assigneeShape = (value: unknown): value is TaskAssigneeRef =>
  (fields(value, ["kind", "principalId"]) &&
    value.kind === "principal" &&
    id(value.principalId, 200)) ||
  (fields(value, ["kind", "resourceId", "resourceVersion", "profileVersion"]) &&
    value.kind === "agent" &&
    id(value.resourceId) &&
    version(value.resourceVersion) &&
    version(value.profileVersion));
const actorShape = (value: unknown): value is TaskActor =>
  fields(value, ["principalId", "actorKind", "authority", "policyVersion"]) &&
  id(value.principalId, 200) &&
  value.actorKind === "user" &&
  value.authority === "manual" &&
  id(value.policyVersion, 200);
const provenanceShape = (value: unknown): value is TaskProvenance =>
  fields(value, ["actor", "authorizationRef", "at"]) &&
  actorShape(value.actor) &&
  id(value.authorizationRef) &&
  iso(value.at);
const unavailable = <T,>(): TaskReferenceProjection<T> => ({
  reference: null,
  current: null,
  freshness: "unavailable",
});
const mergeFreshness = (values: TaskFreshness[]): TaskFreshness =>
  values.includes("unavailable")
    ? "unavailable"
    : values.includes("changed")
      ? "changed"
      : "current";
const tables = [
  "task_objective_schema",
  "task_objective_documents",
  "task_objective_versions",
  "task_objective_receipts",
];

/** Same canonical connection only; snapshots are domain-definition/audit data,
 * never resources, source bodies, provider transcripts or execution state. */
export class TaskObjectiveService {
  private kernel: WorkspaceKernel;
  private host: TaskObjectiveHost;
  constructor(kernel: WorkspaceKernel, host: TaskObjectiveHost) {
    this.kernel = kernel;
    this.host = host;
    for (const key of [
      "identity",
      "now",
      "authorize",
      "projectAccess",
      "resourceAccess",
      "readResource",
      "createResource",
      "touchResource",
      "resolveReference",
      "resolveAssignee",
      "execution",
      "recordEvent",
    ] as const)
      check(typeof host[key] === "function", "task_host_required");
    this.tx(() => {
      check(
        host.db.prepare("PRAGMA foreign_keys").get()!.foreign_keys === 1,
        "task_foreign_keys_required",
      );
      this.schema(false);
    });
  }
  private tx<T>(work: () => T): T {
    return this.kernel.withTransaction((db) => {
      check(db === this.host.db, "task_canonical_connection_required");
      return work();
    });
  }
  private permit(work: () => boolean) {
    try {
      return work() === true;
    } catch {
      return false;
    }
  }
  private identity() {
    const who = this.host.identity();
    check(actorShape(who), "task_identity_unavailable");
    return structuredClone(who);
  }
  private authorize(
    operation: "create" | "read" | TaskObjectiveOperation["type"],
    resource: TaskObjectiveResource | null,
    request: unknown,
    refs: string[] = [],
    execution?: TaskExecutionRef,
  ) {
    const actor = this.identity(),
      answer = this.host.authorize({
        operation,
        task: resource ? structuredClone(resource) : null,
        projectId:
          resource?.projectId ??
          (object(request) ? (request.projectId ?? null) : null),
        requestDigest: digest(request),
        resourceIds: [...new Set(refs)],
        ...(execution ? { execution: structuredClone(execution) } : {}),
      });
    check(
      answer?.decision === "allow" &&
        answer.policyVersion === actor.policyVersion &&
        id(answer.authorizationRef),
      "task_denied",
    );
    return { actor, authorizationRef: answer.authorizationRef };
  }
  private provenance(
    operation: "create" | TaskObjectiveOperation["type"],
    resource: TaskObjectiveResource | null,
    request: unknown,
    refs: string[],
    execution?: TaskExecutionRef,
  ): TaskProvenance {
    const result = this.authorize(
        operation,
        resource,
        request,
        refs,
        execution,
      ),
      at = this.host.now();
    check(iso(at), "task_clock_unavailable");
    return { ...result, at };
  }
  private schema(create: boolean) {
    const db = this.host.db,
      found = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name GLOB 'task_objective_*'",
        )
        .all()
        .map((row) => String(row.name));
    if (!found.length && !create) return false;
    if (!found.length)
      db.exec(`CREATE TABLE task_objective_schema(version INTEGER NOT NULL);INSERT INTO task_objective_schema VALUES(1);
      CREATE TABLE task_objective_documents(resource_id TEXT PRIMARY KEY REFERENCES resources(id) ON DELETE CASCADE,owner_id TEXT NOT NULL,version INTEGER NOT NULL,data_json TEXT NOT NULL,data_digest TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE task_objective_versions(resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,version INTEGER NOT NULL,data_json TEXT NOT NULL,data_digest TEXT NOT NULL,operation TEXT NOT NULL,provenance_json TEXT NOT NULL,PRIMARY KEY(resource_id,version));
      CREATE TABLE task_objective_receipts(owner_id TEXT NOT NULL,command_id TEXT NOT NULL,fingerprint TEXT NOT NULL,resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,result_json TEXT NOT NULL,PRIMARY KEY(owner_id,command_id));`);
    else
      check(
        found.length === tables.length &&
          tables.every((name) => found.includes(name)),
        "task_partial_schema",
      );
    const columns = [
      ["version"],
      [
        "resource_id",
        "owner_id",
        "version",
        "data_json",
        "data_digest",
        "created_at",
        "updated_at",
      ],
      [
        "resource_id",
        "version",
        "data_json",
        "data_digest",
        "operation",
        "provenance_json",
      ],
      ["owner_id", "command_id", "fingerprint", "resource_id", "result_json"],
    ];
    tables.forEach((table, index) =>
      check(
        encode(
          db
            .prepare("PRAGMA table_info(" + table + ")")
            .all()
            .map((row) => row.name),
        ) === encode(columns[index]),
        "task_invalid_schema",
      ),
    );
    const versions = db
      .prepare("SELECT version FROM task_objective_schema")
      .all();
    check(
      versions.length === 1 && versions[0]!.version === 1,
      "task_unsupported_schema",
    );
    for (const table of tables.slice(1)) {
      const refs = db.prepare("PRAGMA foreign_key_list(" + table + ")").all();
      check(
        refs.length === 1 &&
          refs[0]!.table === "resources" &&
          refs[0]!.from === "resource_id" &&
          refs[0]!.to === "id" &&
          refs[0]!.on_delete === "CASCADE",
        "task_invalid_schema",
      );
    }
    return true;
  }
  private project(idValue: string) {
    return (
      id(idValue) &&
      this.permit(() => this.host.projectAccess(idValue)) &&
      !!this.host.db
        .prepare("SELECT 1 FROM projects WHERE id=? AND state='active'")
        .get(idValue)
    );
  }
  private raw(idValue: string, messageId?: string) {
    if (
      !id(idValue) ||
      !this.permit(() => this.host.resourceAccess(idValue, messageId))
    )
      return null;
    const row = this.host.db
      .prepare(
        "SELECT r.id,r.kind,r.title,r.project_id,r.version,r.state,d.kind AS semantic_kind FROM resources r LEFT JOIN desktop_resources d ON d.resource_id=r.id WHERE r.id=?",
      )
      .get(idValue);
    return row &&
      ["active", "archived"].includes(String(row.state)) &&
      version(row.version) &&
      (row.project_id === null || this.project(String(row.project_id)))
      ? row
      : null;
  }
  private resource(resourceId: string, write = false) {
    check(id(resourceId), "task_invalid_id");
    const entry = this.host.readResource(resourceId),
      r = entry?.resource,
      raw = this.raw(resourceId);
    check(
      entry?.authorized === true &&
        r?.id === resourceId &&
        r.kind === "task_objective" &&
        r.state === "active" &&
        version(r.version) &&
        raw?.kind === "generic" &&
        raw.semantic_kind === "task_objective" &&
        raw.title === r.title &&
        raw.version === r.version &&
        raw.project_id === r.projectId &&
        raw.state === r.state,
      "task_unavailable",
    );
    const canEdit = entry.writable === true;
    check(!write || canEdit, "task_read_only");
    this.authorize("read", r, { resourceId });
    return { resource: structuredClone(r), canEdit };
  }
  private definition(value: unknown): TaskDefinition {
    check(
      fields(value, [
        "objective",
        "requirements",
        "assignees",
        "dependencies",
        "sources",
      ]) && text(value.objective, L.objectiveUnits),
      "task_invalid_definition",
    );
    check(
      Array.isArray(value.requirements) &&
        value.requirements.length <= L.requirements &&
        unique(value.requirements, (r) => r?.id) &&
        value.requirements.every(
          (r) =>
            fields(r, ["id", "text"]) && id(r.id, 200) && text(r.text, 2048),
        ),
      "task_invalid_requirements",
    );
    check(
      Array.isArray(value.assignees) &&
        value.assignees.length <= L.assignees &&
        unique(value.assignees, (r) =>
          r?.kind === "principal" ? "p:" + r.principalId : "a:" + r?.resourceId,
        ) &&
        value.assignees.every(assigneeShape),
      "task_invalid_assignees",
    );
    check(
      Array.isArray(value.dependencies) &&
        value.dependencies.length <= L.dependencies &&
        unique(value.dependencies, (r) => r?.resourceId) &&
        value.dependencies.every(
          (r) =>
            fields(r, ["resourceId", "version"]) &&
            id(r.resourceId) &&
            version(r.version),
        ),
      "task_invalid_dependencies",
    );
    check(
      Array.isArray(value.sources) &&
        value.sources.length <= L.sources &&
        unique(value.sources) &&
        value.sources.every(sourceShape),
      "task_invalid_sources",
    );
    return structuredClone(value) as TaskDefinition;
  }
  private state(json: unknown, expectedDigest: unknown): State {
    check(
      typeof json === "string" &&
        Buffer.byteLength(json) <= L.dataBytes &&
        hash(expectedDigest),
      "task_state_corrupt",
    );
    let v: any;
    try {
      v = JSON.parse(json);
    } catch {
      throw new TaskObjectiveError("task_state_corrupt");
    }
    check(
      digest(v) === expectedDigest &&
        fields(v, [
          "schemaVersion",
          "definition",
          "definitionVersion",
          "definitionDigest",
          "disposition",
          "attempts",
          "reviews",
          "acceptances",
        ]) &&
        v.schemaVersion === 1 &&
        version(v.definitionVersion) &&
        hash(v.definitionDigest) &&
        ["open", "accepted", "cancelled"].includes(v.disposition),
      "task_state_corrupt",
    );
    const definition = this.definition(v.definition);
    check(digest(definition) === v.definitionDigest, "task_state_corrupt");
    check(
      Array.isArray(v.attempts) &&
        v.attempts.length <= L.attempts &&
        unique(v.attempts, (a) => a?.id) &&
        unique(v.attempts, (a) => a?.execution?.id) &&
        v.attempts.every(
          (a) =>
            fields(a, [
              "id",
              "version",
              "definitionVersion",
              "definitionDigest",
              "provenance",
              "execution",
            ]) &&
            id(a.id) &&
            a.version === 1 &&
            version(a.definitionVersion) &&
            a.definitionVersion <= v.definitionVersion &&
            hash(a.definitionDigest) &&
            provenanceShape(a.provenance) &&
            executionShape(a.execution),
        ),
      "task_state_corrupt",
    );
    check(
      Array.isArray(v.reviews) &&
        v.reviews.length <= L.reviews &&
        unique(v.reviews, (r) => r?.id) &&
        v.reviews.every(
          (r) =>
            fields(r, [
              "id",
              "definitionVersion",
              "definitionDigest",
              "attemptId",
              "decision",
              "requirementIds",
              "evidence",
              "note",
              "provenance",
              "execution",
            ]) &&
            id(r.id) &&
            version(r.definitionVersion) &&
            r.definitionVersion <= v.definitionVersion &&
            hash(r.definitionDigest) &&
            (r.attemptId === null ||
              (id(r.attemptId) &&
                v.attempts.some(
                  (a: any) =>
                    a.id === r.attemptId && a.execution.id === r.execution?.id,
                ))) &&
            ["verified", "needs-work", "rejected"].includes(r.decision) &&
            Array.isArray(r.requirementIds) &&
            r.requirementIds.length <= L.requirements &&
            unique(r.requirementIds) &&
            r.requirementIds.every((x) => id(x, 200)) &&
            Array.isArray(r.evidence) &&
            r.evidence.length <= L.evidence &&
            unique(r.evidence) &&
            r.evidence.every(sourceShape) &&
            (r.decision !== "verified" || r.evidence.length > 0) &&
            text(r.note, 2000, true) &&
            provenanceShape(r.provenance) &&
            (r.attemptId === null
              ? r.execution === null
              : executionShape(r.execution)),
        ),
      "task_state_corrupt",
    );
    check(
      Array.isArray(v.acceptances) &&
        v.acceptances.length <= L.acceptances &&
        unique(v.acceptances, (a) => a?.id) &&
        v.acceptances.every(
          (a) =>
            fields(a, [
              "id",
              "definitionVersion",
              "definitionDigest",
              "reviewIds",
              "provenance",
            ]) &&
            id(a.id) &&
            version(a.definitionVersion) &&
            a.definitionVersion <= v.definitionVersion &&
            hash(a.definitionDigest) &&
            Array.isArray(a.reviewIds) &&
            a.reviewIds.length > 0 &&
            a.reviewIds.length <= L.reviews &&
            unique(a.reviewIds) &&
            a.reviewIds.every(
              (x) => id(x) && v.reviews.some((r: any) => r.id === x),
            ) &&
            provenanceShape(a.provenance),
        ),
      "task_state_corrupt",
    );
    check(
      v.disposition !== "accepted" ||
        (v.acceptances.at(-1)?.definitionVersion === v.definitionVersion &&
          v.acceptances.at(-1)?.definitionDigest === v.definitionDigest),
      "task_state_corrupt",
    );
    return v as State;
  }
  private stored(resourceId: string, write = false) {
    check(this.schema(false), "task_unavailable");
    const access = this.resource(resourceId, write),
      row = this.host.db
        .prepare(
          "SELECT * FROM task_objective_documents WHERE resource_id=? AND owner_id=?",
        )
        .get(resourceId, this.identity().principalId);
    check(
      row &&
        version(row.version) &&
        row.version <= access.resource.version &&
        iso(row.created_at) &&
        iso(row.updated_at),
      "task_unavailable",
    );
    return {
      ...access,
      row,
      data: this.state(row.data_json, row.data_digest),
      lastMutationVersion: Number(row.version),
    };
  }
  private budget(
    ctx: ProofContext,
    key: string,
    work: () => any,
    fallback: () => any,
  ): any {
    if (ctx.cache.has(key)) return structuredClone(ctx.cache.get(key));
    if (ctx.count++ >= L.proofNodes) {
      ctx.bounded = true;
      return fallback();
    }
    let result;
    try {
      result = work();
    } catch {
      result = fallback();
    }
    ctx.cache.set(key, result);
    return structuredClone(result);
  }
  private source(
    ref: TaskSourceRef,
    ctx: ProofContext,
  ): TaskReferenceProjection<TaskSourceRef> {
    return this.budget(
      ctx,
      "source:" + encode(ref),
      () => {
        const raw = this.raw(ref.resourceId, ref.messageId);
        if (
          !raw ||
          (ref.messageId !== undefined && raw.kind !== "conversation")
        )
          return unavailable();
        const resolved = this.host.resolveReference(structuredClone(ref)),
          current = resolved?.reference;
        if (
          !resolved ||
          !sourceShape(current) ||
          current.resourceId !== ref.resourceId ||
          current.messageId !== ref.messageId ||
          resolved.projectId !== raw.project_id ||
          resolved.state !== raw.state
        )
          return unavailable();
        return {
          reference: structuredClone(ref),
          current: structuredClone(current),
          freshness: encode(current) === encode(ref) ? "current" : "changed",
        };
      },
      unavailable,
    );
  }
  private assignee(
    ref: TaskAssigneeRef,
    ctx: ProofContext,
  ): TaskReferenceProjection<TaskAssigneeRef> {
    return this.budget(
      ctx,
      "assignee:" + encode(ref),
      () => {
        const raw = ref.kind === "agent" ? this.raw(ref.resourceId) : null;
        if (
          ref.kind === "agent" &&
          (raw?.kind !== "generic" ||
            raw.semantic_kind !== "agent" ||
            raw.state !== "active")
        )
          return unavailable();
        const resolved = this.host.resolveAssignee(structuredClone(ref)),
          current = resolved?.reference;
        if (
          !resolved ||
          !assigneeShape(current) ||
          current.kind !== ref.kind ||
          (current.kind === "principal" &&
            (current.principalId !== (ref as any).principalId ||
              resolved.projectId !== null)) ||
          (current.kind === "agent" &&
            (current.resourceId !== (ref as any).resourceId ||
              current.resourceVersion !== raw?.version ||
              resolved.projectId !== raw?.project_id))
        )
          return unavailable();
        return {
          reference: structuredClone(ref),
          current: structuredClone(current),
          freshness: encode(current) === encode(ref) ? "current" : "changed",
        };
      },
      unavailable,
    );
  }
  private execution(
    ref: TaskExecutionRef,
    ctx: ProofContext,
  ): TaskExecutionProjection {
    return this.budget(
      ctx,
      "execution:" + encode(ref),
      () => {
        const current = this.host.execution(ref.id);
        if (
          !fields(current, [
            "id",
            "revision",
            "resourceId",
            "providerId",
            "commandId",
            "state",
            "nativeThreadId",
            "nativeTurnId",
            "nativeResponseId",
          ]) ||
          current.id !== ref.id ||
          !id(current.revision) ||
          !id(current.providerId) ||
          !id(current.commandId) ||
          ![
            "dispatching",
            "running",
            "provider_completed",
            "failed",
            "interrupted",
            "unknown",
          ].includes(current.state) ||
          !(
            ["nativeThreadId", "nativeTurnId", "nativeResponseId"] as const
          ).every((key) => current[key] === null || id(current[key])) ||
          !id(current.resourceId) ||
          !this.raw(current.resourceId)
        )
          return unavailable();
        return {
          reference: structuredClone(ref),
          current: structuredClone(current),
          freshness: current.revision === ref.revision ? "current" : "changed",
        };
      },
      unavailable,
    );
  }
  private dependency(
    ref: TaskDependencyRef,
    ctx: ProofContext,
  ): TaskDependencyProjection {
    const empty = (): TaskDependencyProjection => ({
      ...unavailable<TaskDependencyRef>(),
      acceptance: "unavailable",
    });
    if (ctx.seen.has(ref.resourceId)) return empty();
    return this.budget(
      ctx,
      "dependency:" + encode(ref),
      () => {
        const value = this.stored(ref.resourceId),
          current = {
            resourceId: value.resource.id,
            version: value.resource.version,
          };
        if (current.version !== ref.version)
          return {
            reference: ref,
            current,
            freshness: "changed",
            acceptance: "stale",
          };
        ctx.seen.add(ref.resourceId);
        let status;
        try {
          status = this.acceptance(value.data, ctx);
        } finally {
          ctx.seen.delete(ref.resourceId);
        }
        return {
          reference: ref,
          current,
          freshness: "current",
          acceptance: status,
        };
      },
      empty,
    );
  }
  private reviewFreshness(review: Review, ctx: ProofContext): TaskFreshness {
    return mergeFreshness([
      review.provenance.actor.policyVersion === this.identity().policyVersion
        ? "current"
        : "changed",
      ...review.evidence.map((ref) => this.source(ref, ctx).freshness),
      ...(review.execution
        ? [this.execution(review.execution, ctx).freshness]
        : []),
    ]);
  }
  private verification(
    data: State,
    ctx: ProofContext,
    selected?: string[],
  ): TaskObjectiveSnapshot["verification"] {
    const criteria = data.definition.requirements.length
      ? data.definition.requirements.map((r) => r.id)
      : [""];
    const last = criteria.map((criterion) =>
      data.reviews.findLast(
        (r) =>
          r.definitionVersion === data.definitionVersion &&
          r.definitionDigest === data.definitionDigest &&
          (criterion
            ? r.requirementIds.length === 0 ||
              r.requirementIds.includes(criterion)
            : r.requirementIds.length === 0),
      ),
    );
    if (last.every((r) => !r)) return "unreviewed";
    if (last.some((r) => r && r.decision !== "verified")) return "needs-work";
    const fresh = mergeFreshness([
      ...data.definition.sources.map((ref) => this.source(ref, ctx).freshness),
      ...last
        .filter((r): r is Review => !!r)
        .map((r) => this.reviewFreshness(r, ctx)),
      ...data.reviews
        .filter((r) => selected?.includes(r.id))
        .map((r) => this.reviewFreshness(r, ctx)),
    ]);
    if (fresh !== "current")
      return fresh === "changed" ? "stale" : "unavailable";
    if (last.some((r) => !r || (selected && !selected.includes(r.id))))
      return "partial";
    return "verified";
  }
  private acceptance(
    data: State,
    ctx: ProofContext,
  ): "valid" | "not-accepted" | "stale" | "unavailable" {
    if (data.disposition !== "accepted") return "not-accepted";
    const last = data.acceptances.at(-1);
    if (
      !last ||
      last.definitionVersion !== data.definitionVersion ||
      last.definitionDigest !== data.definitionDigest
    )
      return "stale";
    const verification = this.verification(data, ctx, last.reviewIds);
    if (verification !== "verified")
      return verification === "unavailable" ? "unavailable" : "stale";
    if (last.provenance.actor.policyVersion !== this.identity().policyVersion)
      return "stale";
    const dependencies = data.definition.dependencies.map((ref) =>
      this.dependency(ref, ctx),
    );
    if (
      dependencies.some(
        (d) => d.freshness === "unavailable" || d.acceptance === "unavailable",
      )
    )
      return "unavailable";
    if (
      dependencies.some(
        (d) => d.freshness !== "current" || d.acceptance !== "valid",
      )
    )
      return "stale";
    return "valid";
  }
  private snapshot(data: State, resourceId: string): TaskObjectiveSnapshot {
    const ctx = context();
    ctx.seen.add(resourceId);
    const assignees = data.definition.assignees.map((ref) =>
        this.assignee(ref, ctx),
      ),
      dependencies = data.definition.dependencies.map((ref) =>
        this.dependency(ref, ctx),
      ),
      sources = data.definition.sources.map((ref) => this.source(ref, ctx));
    const attempts = data.attempts.map((a) => ({
      ...a,
      execution: this.execution(a.execution, ctx),
      relation: "user-linked-existing-execution" as const,
    }));
    const reviews = data.reviews.map((r) => ({
      ...r,
      evidence: r.evidence.map((ref) => this.source(ref, ctx)),
      execution: r.execution ? this.execution(r.execution, ctx) : null,
      freshness: this.reviewFreshness(r, ctx),
    }));
    const verification = this.verification(data, ctx),
      latest = data.acceptances.at(-1) ?? null,
      accepted = this.acceptance(data, ctx);
    return {
      proofCoverage: ctx.bounded ? "bounded" : "complete",
      definition: {
        objective: data.definition.objective,
        requirements: structuredClone(data.definition.requirements),
      },
      definitionVersion: data.definitionVersion,
      definitionDigest: data.definitionDigest,
      disposition: data.disposition,
      assignees,
      dependencies,
      sources,
      attempts,
      reviews,
      verification,
      acceptance: {
        state:
          data.disposition !== "accepted" && latest ? "historical" : accepted,
        record: structuredClone(latest),
      },
      capabilities: taskObjectiveCapabilities,
    };
  }
  private references(definition: TaskDefinition) {
    return [
      ...definition.sources.map((r) => r.resourceId),
      ...definition.dependencies.map((r) => r.resourceId),
      ...definition.assignees.flatMap((r) =>
        r.kind === "agent" ? [r.resourceId] : [],
      ),
    ];
  }
  private currentDefinition(definition: TaskDefinition, resourceId: string) {
    const ctx = context();
    check(
      definition.sources.every(
        (r) => this.source(r, ctx).freshness === "current",
      ) &&
        definition.assignees.every(
          (r) => this.assignee(r, ctx).freshness === "current",
        ),
      "task_reference_unavailable_or_stale",
    );
    const visited = new Set<string>(),
      completed = new Set<string>();
    let nodes = 0;
    const walk = (idValue: string) => {
      check(
        idValue !== resourceId && !visited.has(idValue),
        "task_dependency_cycle_or_bound",
      );
      if (completed.has(idValue)) return;
      check(nodes++ < L.proofNodes, "task_dependency_cycle_or_bound");
      visited.add(idValue);
      const value = this.stored(idValue);
      for (const ref of value.data.definition.dependencies)
        walk(ref.resourceId);
      visited.delete(idValue);
      completed.add(idValue);
    };
    for (const ref of definition.dependencies) {
      const dep = this.stored(ref.resourceId);
      check(dep.resource.version === ref.version, "task_dependency_stale");
      walk(ref.resourceId);
    }
  }
  read(resourceId: string): TaskObjectiveDocument {
    return this.tx(() => {
      const value = this.stored(resourceId);
      return this.response({
        contract: TASK_OBJECTIVE_CONTRACT,
        resource: value.resource,
        canEdit: value.canEdit,
        lastMutationVersion: value.lastMutationVersion,
        ...this.snapshot(value.data, resourceId),
      });
    });
  }
  private response<T>(value: T): T {
    check(
      Buffer.byteLength(encode(value)) <= L.responseBytes,
      "task_projection_capacity",
    );
    return value;
  }
  private once(
    commandId: string,
    input: unknown,
    replay: (resourceId: string) => void,
    work: () => TaskObjectiveReceipt,
  ): TaskObjectiveReceipt {
    check(id(commandId, 200), "task_invalid_command");
    const actor = this.identity(),
      fingerprint = digest(input),
      old = this.host.db
        .prepare(
          "SELECT * FROM task_objective_receipts WHERE owner_id=? AND command_id=?",
        )
        .get(actor.principalId, commandId);
    if (old) {
      check(old.fingerprint === fingerprint, "task_command_conflict");
      replay(String(old.resource_id));
      check(
        typeof old.result_json === "string" &&
          Buffer.byteLength(old.result_json) <= 4096,
        "task_receipt_corrupt",
      );
      let result;
      try {
        result = JSON.parse(old.result_json);
      } catch {
        throw new TaskObjectiveError("task_receipt_corrupt");
      }
      check(
        fields(
          result,
          [
            "resourceId",
            "version",
            "definitionVersion",
            "definitionDigest",
            "commandId",
            "operation",
            "createdId",
            "executionEffects",
          ],
          [
            "resourceId",
            "version",
            "definitionVersion",
            "definitionDigest",
            "commandId",
            "operation",
            "executionEffects",
          ],
        ) &&
          result.resourceId === old.resource_id &&
          version(result.version) &&
          version(result.definitionVersion) &&
          hash(result.definitionDigest) &&
          result.commandId === commandId &&
          [
            "create",
            "replaceDefinition",
            "linkAttempt",
            "review",
            "accept",
            "reopen",
            "administrativeCancel",
          ].includes(result.operation) &&
          (result.createdId === undefined || id(result.createdId)) &&
          result.executionEffects === "none",
        "task_receipt_corrupt",
      );
      return result as TaskObjectiveReceipt;
    }
    check(
      Number(
        this.host.db
          .prepare("SELECT count(*) AS n FROM task_objective_receipts")
          .get()!.n,
      ) < L.receipts,
      "task_receipt_capacity",
    );
    const result = work();
    this.host.db
      .prepare("INSERT INTO task_objective_receipts VALUES(?,?,?,?,?)")
      .run(
        actor.principalId,
        commandId,
        fingerprint,
        result.resourceId,
        encode(result),
      );
    this.capacity();
    return result;
  }
  private capacity() {
    const db = this.host.db;
    check(
      Number(
        db.prepare("SELECT count(*) AS n FROM task_objective_versions").get()!
          .n,
      ) <= L.versions,
      "task_history_capacity",
    );
    const bytes = db
      .prepare(
        "SELECT coalesce((SELECT sum(length(CAST(data_json AS BLOB))) FROM task_objective_documents),0)+coalesce((SELECT sum(length(CAST(data_json AS BLOB))+length(CAST(provenance_json AS BLOB))) FROM task_objective_versions),0)+coalesce((SELECT sum(length(CAST(result_json AS BLOB))) FROM task_objective_receipts),0) AS n",
      )
      .get()!.n;
    check(Number(bytes) <= L.totalBytes, "task_storage_capacity");
  }
  private persist(
    resource: TaskObjectiveResource,
    data: State,
    provenance: TaskProvenance,
    receipt: TaskObjectiveReceipt,
    create: boolean,
  ) {
    const json = encode(data),
      dataDigest = digest(data);
    check(Buffer.byteLength(json) <= L.dataBytes, "task_state_capacity");
    this.state(json, dataDigest);
    if (create)
      this.host.db
        .prepare("INSERT INTO task_objective_documents VALUES(?,?,?,?,?,?,?)")
        .run(
          resource.id,
          provenance.actor.principalId,
          resource.version,
          json,
          dataDigest,
          provenance.at,
          provenance.at,
        );
    else
      this.host.db
        .prepare(
          "UPDATE task_objective_documents SET version=?,data_json=?,data_digest=?,updated_at=? WHERE resource_id=?",
        )
        .run(resource.version, json, dataDigest, provenance.at, resource.id);
    this.host.db
      .prepare("INSERT INTO task_objective_versions VALUES(?,?,?,?,?,?)")
      .run(
        resource.id,
        resource.version,
        json,
        dataDigest,
        receipt.operation,
        encode(provenance),
      );
    this.capacity();
    this.host.recordEvent({
      type: create ? "task-objective.created" : "task-objective.changed",
      resourceId: resource.id,
      resourceVersion: resource.version,
      commandId: receipt.commandId,
      detail: {
        operation: receipt.operation,
        actor: provenance.actor,
        authorizationRef: provenance.authorizationRef,
        definitionVersion: data.definitionVersion,
        definitionDigest: data.definitionDigest,
        disposition: data.disposition,
        attemptCount: data.attempts.length,
        reviewCount: data.reviews.length,
        ...(receipt.createdId ? { createdId: receipt.createdId } : {}),
      },
    });
  }
  create(input: CreateTaskObjective): TaskObjectiveReceipt {
    check(
      fields(input, ["commandId", "title", "projectId", "definition"]) &&
        id(input.commandId, 200) &&
        text(input.title, 200) &&
        (input.projectId === null || id(input.projectId)),
      "task_invalid_create",
    );
    const definition = this.definition(input.definition);
    input = {
      commandId: input.commandId,
      title: input.title,
      projectId: input.projectId,
      definition,
    };
    return this.tx(() => {
      this.schema(true);
      return this.once(
        input.commandId,
        { operation: "create", input },
        (resourceId) => {
          const value = this.resource(resourceId, true);
          this.authorize(
            "create",
            value.resource,
            input,
            this.references(definition),
          );
        },
        () => {
          check(
            Number(
              this.host.db
                .prepare("SELECT count(*) AS n FROM task_objective_documents")
                .get()!.n,
            ) < L.documents,
            "task_document_capacity",
          );
          if (input.projectId !== null)
            check(this.project(input.projectId), "task_project_unavailable");
          const provenance = this.provenance(
              "create",
              null,
              input,
              this.references(definition),
            ),
            previous = Number(
              this.host.db
                .prepare("SELECT coalesce(max(rowid),0) AS n FROM resources")
                .get()!.n,
            ),
            made = this.host.createResource({
              kind: "task_objective",
              title: input.title.trim(),
              projectId: input.projectId,
              commandId: input.commandId,
            }),
            { resource } = this.resource(made.id, true),
            raw = this.host.db
              .prepare("SELECT rowid FROM resources WHERE id=?")
              .get(resource.id);
          check(
            Number(raw?.rowid) > previous &&
              resource.version === 1 &&
              resource.title === input.title.trim() &&
              resource.projectId === input.projectId,
            "task_canonical_factory_required",
          );
          this.currentDefinition(definition, resource.id);
          const data: State = {
              schemaVersion: 1,
              definition,
              definitionVersion: 1,
              definitionDigest: digest(definition),
              disposition: "open",
              attempts: [],
              reviews: [],
              acceptances: [],
            },
            receipt: TaskObjectiveReceipt = {
              resourceId: resource.id,
              version: resource.version,
              definitionVersion: 1,
              definitionDigest: data.definitionDigest,
              commandId: input.commandId,
              operation: "create",
              executionEffects: "none",
            };
          this.persist(resource, data, provenance, receipt, true);
          return receipt;
        },
      );
    });
  }
  private operation(value: unknown): TaskObjectiveOperation {
    check(
      object(value) && typeof value.type === "string",
      "task_invalid_mutation",
    );
    switch (value.type) {
      case "replaceDefinition":
        check(fields(value, ["type", "definition"]), "task_invalid_mutation");
        this.definition(value.definition);
        break;
      case "linkAttempt":
        check(
          fields(value, ["type", "execution"]) &&
            executionShape(value.execution),
          "task_invalid_attempt",
        );
        break;
      case "review":
        check(
          fields(
            value,
            [
              "type",
              "attemptId",
              "executionRevision",
              "decision",
              "requirementIds",
              "evidence",
              "note",
            ],
            [
              "type",
              "attemptId",
              "decision",
              "requirementIds",
              "evidence",
              "note",
            ],
          ) &&
            (value.attemptId === null || id(value.attemptId)) &&
            (value.executionRevision === undefined ||
              id(value.executionRevision)) &&
            ["verified", "needs-work", "rejected"].includes(value.decision) &&
            Array.isArray(value.requirementIds) &&
            value.requirementIds.length <= L.requirements &&
            unique(value.requirementIds) &&
            value.requirementIds.every((x) => id(x, 200)) &&
            Array.isArray(value.evidence) &&
            value.evidence.length <= L.evidence &&
            unique(value.evidence) &&
            value.evidence.every(sourceShape) &&
            text(value.note, 2000, true),
          "task_invalid_review",
        );
        break;
      case "accept":
        check(
          fields(value, ["type", "reviewIds"]) &&
            Array.isArray(value.reviewIds) &&
            value.reviewIds.length > 0 &&
            value.reviewIds.length <= L.reviews &&
            unique(value.reviewIds) &&
            value.reviewIds.every((x) => id(x)),
          "task_invalid_acceptance",
        );
        break;
      case "reopen":
      case "administrativeCancel":
        check(fields(value, ["type"]), "task_invalid_mutation");
        break;
      default:
        throw new TaskObjectiveError("task_invalid_mutation");
    }
    return structuredClone(value) as TaskObjectiveOperation;
  }
  mutate(input: MutateTaskObjective): TaskObjectiveReceipt {
    check(
      fields(input, [
        "commandId",
        "resourceId",
        "expectedVersion",
        "operation",
      ]) &&
        id(input.commandId, 200) &&
        id(input.resourceId) &&
        version(input.expectedVersion) &&
        object(input.operation) &&
        typeof input.operation.type === "string" &&
        [
          "replaceDefinition",
          "linkAttempt",
          "review",
          "accept",
          "reopen",
          "administrativeCancel",
        ].includes(input.operation.type),
      "task_invalid_mutation",
    );
    input = {
      commandId: input.commandId,
      resourceId: input.resourceId,
      expectedVersion: input.expectedVersion,
      operation: this.operation(input.operation),
    };
    return this.tx(() => {
      check(this.schema(false), "task_unavailable");
      return this.once(
        input.commandId,
        input,
        (resourceId) => {
          const value = this.resource(resourceId, true);
          this.authorize(input.operation.type, value.resource, input);
        },
        () => {
          const value = this.stored(input.resourceId, true),
            data = structuredClone(value.data),
            op = input.operation;
          check(
            value.resource.version === input.expectedVersion,
            "task_version_conflict",
          );
          const referenceIds = [
              ...this.references(
                op.type === "replaceDefinition"
                  ? op.definition
                  : data.definition,
              ),
              ...(op.type === "review"
                ? op.evidence.map((ref) => ref.resourceId)
                : []),
              ...(op.type === "accept"
                ? data.reviews
                    .filter((review) => op.reviewIds.includes(review.id))
                    .flatMap((review) =>
                      review.evidence.map((ref) => ref.resourceId),
                    )
                : []),
            ],
            execution =
              op.type === "linkAttempt"
                ? op.execution
                : op.type === "review" && op.attemptId
                  ? {
                      id:
                        data.attempts.find((a) => a.id === op.attemptId)
                          ?.execution.id ?? "",
                      revision: op.executionRevision ?? "",
                    }
                  : undefined;
          const provenance = this.provenance(
            op.type,
            value.resource,
            input,
            referenceIds,
            execution,
          );
          let createdId: string | undefined;
          if (op.type === "replaceDefinition") {
            check(
              fields(op, ["type", "definition"]) && data.disposition === "open",
              "task_invalid_transition",
            );
            const definition = this.definition(op.definition);
            this.currentDefinition(definition, value.resource.id);
            data.definition = definition;
            data.definitionVersion++;
            data.definitionDigest = digest(definition);
          } else if (op.type === "linkAttempt") {
            check(
              fields(op, ["type", "execution"]) &&
                executionShape(op.execution) &&
                data.disposition === "open" &&
                data.attempts.length < L.attempts &&
                !data.attempts.some((a) => a.execution.id === op.execution.id),
              "task_invalid_attempt",
            );
            const proof = this.execution(op.execution, context());
            check(
              proof.freshness === "current",
              "task_execution_unavailable_or_stale",
            );
            createdId = randomUUID();
            data.attempts.push({
              id: createdId,
              version: 1,
              definitionVersion: data.definitionVersion,
              definitionDigest: data.definitionDigest,
              provenance,
              execution: structuredClone(op.execution),
            });
          } else if (op.type === "review") {
            check(
              fields(
                op,
                [
                  "type",
                  "attemptId",
                  "executionRevision",
                  "decision",
                  "requirementIds",
                  "evidence",
                  "note",
                ],
                [
                  "type",
                  "attemptId",
                  "decision",
                  "requirementIds",
                  "evidence",
                  "note",
                ],
              ) &&
                data.disposition === "open" &&
                data.reviews.length < L.reviews &&
                ["verified", "needs-work", "rejected"].includes(op.decision) &&
                Array.isArray(op.requirementIds) &&
                op.requirementIds.length <= L.requirements &&
                unique(op.requirementIds) &&
                op.requirementIds.every((x) =>
                  data.definition.requirements.some((r) => r.id === x),
                ) &&
                (data.definition.requirements.length === 0 ||
                  op.decision !== "verified" ||
                  op.requirementIds.length > 0) &&
                Array.isArray(op.evidence) &&
                op.evidence.length <= L.evidence &&
                unique(op.evidence) &&
                op.evidence.every(sourceShape) &&
                (op.decision !== "verified" || op.evidence.length > 0) &&
                text(op.note, 2000, true),
              "task_invalid_review",
            );
            let ref: TaskExecutionRef | null = null;
            if (op.attemptId !== null) {
              const attempt = data.attempts.find((a) => a.id === op.attemptId);
              check(
                attempt && id(op.executionRevision),
                "task_attempt_unavailable",
              );
              ref = {
                id: attempt.execution.id,
                revision: op.executionRevision,
              };
              check(
                this.execution(ref, context()).freshness === "current",
                "task_execution_unavailable_or_stale",
              );
            } else
              check(op.executionRevision === undefined, "task_invalid_review");
            const ctx = context();
            check(
              op.evidence.every(
                (r) => this.source(r, ctx).freshness === "current",
              ),
              "task_evidence_unavailable_or_stale",
            );
            createdId = randomUUID();
            data.reviews.push({
              id: createdId,
              definitionVersion: data.definitionVersion,
              definitionDigest: data.definitionDigest,
              attemptId: op.attemptId,
              decision: op.decision,
              requirementIds: [...op.requirementIds],
              evidence: structuredClone(op.evidence),
              note: op.note,
              provenance,
              execution: ref,
            });
          } else if (op.type === "accept") {
            check(
              fields(op, ["type", "reviewIds"]) &&
                data.disposition === "open" &&
                data.acceptances.length < L.acceptances &&
                Array.isArray(op.reviewIds) &&
                op.reviewIds.length > 0 &&
                op.reviewIds.length <= L.reviews &&
                unique(op.reviewIds) &&
                op.reviewIds.every((idValue) =>
                  data.reviews.some(
                    (r) =>
                      r.id === idValue &&
                      r.decision === "verified" &&
                      r.definitionVersion === data.definitionVersion &&
                      r.definitionDigest === data.definitionDigest,
                  ),
                ),
              "task_invalid_acceptance",
            );
            const ctx = context();
            ctx.seen.add(value.resource.id);
            check(
              this.verification(data, ctx, op.reviewIds) === "verified",
              "task_verification_required",
            );
            const deps = data.definition.dependencies.map((ref) =>
              this.dependency(ref, ctx),
            );
            check(
              deps.every(
                (d) => d.freshness === "current" && d.acceptance === "valid",
              ),
              "task_dependency_not_accepted_or_stale",
            );
            createdId = randomUUID();
            data.acceptances.push({
              id: createdId,
              definitionVersion: data.definitionVersion,
              definitionDigest: data.definitionDigest,
              reviewIds: [...op.reviewIds],
              provenance,
            });
            data.disposition = "accepted";
          } else {
            check(
              fields(op, ["type"]) &&
                (op.type === "reopen"
                  ? data.disposition !== "open"
                  : data.disposition === "open"),
              "task_invalid_transition",
            );
            data.disposition = op.type === "reopen" ? "open" : "cancelled";
          }
          const touched = this.host.touchResource({
              resourceId: value.resource.id,
              expectedVersion: value.resource.version,
              commandId: input.commandId,
            }),
            { resource } = this.resource(value.resource.id, true);
          check(
            touched.id === resource.id &&
              touched.version === value.resource.version + 1 &&
              resource.version === touched.version &&
              resource.projectId === value.resource.projectId &&
              resource.title === value.resource.title,
            "task_canonical_version_required",
          );
          const receipt: TaskObjectiveReceipt = {
            resourceId: resource.id,
            version: resource.version,
            definitionVersion: data.definitionVersion,
            definitionDigest: data.definitionDigest,
            commandId: input.commandId,
            operation: op.type,
            ...(createdId ? { createdId } : {}),
            executionEffects: "none",
          };
          this.persist(resource, data, provenance, receipt, false);
          return receipt;
        },
      );
    });
  }
  history(input: {
    resourceId: string;
    afterVersion?: number;
    limit?: number;
  }): TaskObjectiveHistory {
    check(
      fields(input, ["resourceId", "afterVersion", "limit"], ["resourceId"]) &&
        id(input.resourceId) &&
        (input.afterVersion === undefined ||
          (Number.isSafeInteger(input.afterVersion) &&
            input.afterVersion >= 0)) &&
        (input.limit === undefined ||
          (version(input.limit) && input.limit <= L.history)),
      "task_invalid_history",
    );
    return this.tx(() => {
      const value = this.stored(input.resourceId),
        limit = input.limit ?? 32,
        rows = this.host.db
          .prepare(
            "SELECT * FROM task_objective_versions WHERE resource_id=? AND version>? ORDER BY version LIMIT ?",
          )
          .all(input.resourceId, input.afterVersion ?? 0, limit + 1);
      const items: TaskObjectiveHistory["items"] = [];
      let bytes = 0,
        more = rows.length > limit;
      for (const row of rows.slice(0, limit)) {
        let provenance;
        check(
          typeof row.provenance_json === "string" &&
            Buffer.byteLength(row.provenance_json) <= 4096,
          "task_history_corrupt",
        );
        try {
          provenance = JSON.parse(String(row.provenance_json));
        } catch {
          throw new TaskObjectiveError("task_history_corrupt");
        }
        check(
          provenanceShape(provenance) &&
            version(row.version) &&
            row.version <= value.resource.version &&
            [
              "create",
              "replaceDefinition",
              "linkAttempt",
              "review",
              "accept",
              "reopen",
              "administrativeCancel",
            ].includes(String(row.operation)),
          "task_history_corrupt",
        );
        const item = {
          version: Number(row.version),
          operation: row.operation as TaskObjectiveReceipt["operation"],
          provenance,
          snapshot: this.snapshot(
            this.state(row.data_json, row.data_digest),
            input.resourceId,
          ),
        };
        const size = Buffer.byteLength(encode(item));
        if (bytes + size > L.responseBytes - 4096) {
          check(items.length > 0, "task_projection_capacity");
          more = true;
          break;
        }
        bytes += size;
        items.push(item);
      }
      return this.response({
        resourceId: input.resourceId,
        currentResourceVersion: value.resource.version,
        items,
        nextAfterVersion: more ? items.at(-1)!.version : null,
        coverage: more ? "bounded" : "complete",
      });
    });
  }
  list(
    input: { projectId?: string | null; limit?: number } = {},
  ): TaskObjectiveList {
    check(
      fields(input, ["projectId", "limit"], []) &&
        (input.projectId === undefined ||
          input.projectId === null ||
          id(input.projectId)) &&
        (input.limit === undefined ||
          (version(input.limit) && input.limit <= L.list)),
      "task_invalid_list",
    );
    return this.tx(() => {
      if (input.projectId !== undefined && input.projectId !== null)
        check(this.project(input.projectId), "task_project_unavailable");
      if (!this.schema(false)) return { items: [], coverage: "complete" };
      const rows = this.host.db
          .prepare(
            "SELECT resource_id,version FROM task_objective_documents WHERE owner_id=? ORDER BY resource_id LIMIT ?",
          )
          .all(this.identity().principalId, L.documents + 1),
        limit = input.limit ?? 64,
        items: TaskObjectiveList["items"] = [];
      let more = rows.length > L.documents;
      for (const row of rows.slice(0, L.documents)) {
        let access;
        try {
          access = this.resource(String(row.resource_id));
        } catch {
          continue;
        }
        check(
          version(row.version) && row.version <= access.resource.version,
          "task_state_corrupt",
        );
        if (
          input.projectId !== undefined &&
          access.resource.projectId !== input.projectId
        )
          continue;
        if (items.length === limit) {
          more = true;
          break;
        }
        items.push({ ...access, lastMutationVersion: Number(row.version) });
      }
      return { items, coverage: more ? "bounded" : "complete" };
    });
  }
}
