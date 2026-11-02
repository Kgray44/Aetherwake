import type { DatabaseSync } from "node:sqlite";
import type { WorkspaceKernel } from "../../workspace-kernel/kernel.mts";
import {
  TimelineService,
  TimelineError,
  type TimelineHostPort,
} from "../../timeline-product/service.mts";
import type {
  CreateTimeline,
  SaveTimeline,
  QueryTimeline,
  TimelineResource,
  TimelineDocument,
  TimelineMutationResult,
  TimelineWindow,
} from "../../timeline-product/contracts.ts";

type Command<I, O> = { input: I; output: O };
export interface TimelineCommandMap {
  create: Command<CreateTimeline, TimelineMutationResult>;
  read: Command<{ resourceId: string }, TimelineDocument>;
  save: Command<SaveTimeline, TimelineMutationResult>;
  query: Command<QueryTimeline, TimelineWindow>;
}
export type TimelineRequest = {
  [K in keyof TimelineCommandMap]: {
    name: K;
    input: TimelineCommandMap[K]["input"];
  };
}[keyof TimelineCommandMap];
export type TimelineResponse =
  TimelineCommandMap[keyof TimelineCommandMap]["output"];
export type TimelineDomainEvent = Parameters<
  TimelineHostPort["recordEvent"]
>[0];
export interface TimelineDomainOptions {
  kernel: WorkspaceKernel;
  db: DatabaseSync;
  projectAccess(id: string): boolean;
  /** Current canonical source access. Archived sources require an explicit true. */
  resourceAccess(id: string): boolean;
  /** Mandatory, including source headers without an associated resource. */
  eventAccess: TimelineHostPort["eventAccess"];
  /** Inside canonical transaction; host buffers delivery until outer commit. */
  recordEvent(event: TimelineDomainEvent): void;
}
export interface TimelineDomain {
  dispatch<K extends keyof TimelineCommandMap>(request: {
    name: K;
    input: TimelineCommandMap[K]["input"];
  }): TimelineCommandMap[K]["output"];
}
const check: (value: unknown, code: string) => asserts value = (
  value,
  code,
) => {
  if (!value) throw new TimelineError(code);
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
const envelope = (value: unknown): value is { name: string; input: unknown } =>
  fields(value, ["name", "input"]) && typeof value.name === "string";
const permit = (work: () => boolean) => {
  try {
    return work() === true;
  } catch {
    return false;
  }
};

/** Exact-case public storage/admission classification. Unknown commands fail closed. */
export function isTimelineRead(value: unknown): boolean {
  return envelope(value) && (value.name === "read" || value.name === "query");
}

/** Local-owner adapter only. SAME canonical SQLite/resource/event identities;
 * no execution, provider, event mirror, Note, placement or UI authority. Root
 * owns outer Core.atomic and publication after commit. Each dispatch constructs
 * a fresh service so an outer rollback cannot leave an initialized cache behind. */
export function compositeTimelineDomain(
  options: TimelineDomainOptions,
): TimelineDomain {
  const { kernel, db } = options;
  for (const callback of [
    "projectAccess",
    "resourceAccess",
    "eventAccess",
    "recordEvent",
  ] as const)
    check(
      typeof options[callback] === "function",
      "timeline_domain_host_required",
    );
  const tx = <T,>(work: () => T): T =>
    kernel.withTransaction((actual) => {
      check(actual === db, "timeline_canonical_connection_required");
      return work();
    });
  tx(() => {
    const columns = db.prepare("PRAGMA table_info(desktop_resources)").all(),
      refs = db.prepare("PRAGMA foreign_key_list(desktop_resources)").all();
    check(
      ["resource_id", "kind"].every((name) =>
        columns.some((column) => column.name === name),
      ) &&
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
      "timeline_canonical_projection_required",
    );
  });
  const project = (projectId: string) => {
    if (!id(projectId) || !permit(() => options.projectAccess(projectId)))
      return false;
    const row = db
      .prepare("SELECT state,version FROM projects WHERE id=?")
      .get(projectId);
    return (
      row?.state === "active" &&
      Number.isSafeInteger(row.version) &&
      Number(row.version) > 0
    );
  };
  const rawResource = (resourceId: string) => {
    if (!id(resourceId)) return null;
    const row = db
      .prepare(
        "SELECT r.id,r.kind AS canonical_kind,r.title,r.project_id,r.state,r.version,d.kind AS semantic_kind FROM resources r LEFT JOIN desktop_resources d ON d.resource_id=r.id WHERE r.id=?",
      )
      .get(resourceId);
    if (
      !row ||
      !["active", "archived"].includes(String(row.state)) ||
      !Number.isSafeInteger(row.version) ||
      Number(row.version) < 1 ||
      (row.project_id !== null && !project(String(row.project_id))) ||
      !permit(() => options.resourceAccess(resourceId))
    )
      return null;
    return row;
  };
  const timeline = (resourceId: string): TimelineResource | null => {
    const row = rawResource(resourceId);
    return row?.canonical_kind === "generic" &&
      row.semantic_kind === "timeline" &&
      row.state === "active"
      ? {
          id: String(row.id),
          kind: "timeline",
          title: String(row.title),
          projectId: row.project_id as string | null,
          version: Number(row.version),
          state: "active",
        }
      : null;
  };
  const host: TimelineHostPort = {
    db,
    // Current supported profile; no renderer identity/authority fields.
    identity: () => ({
      principalId: "local-owner",
      policyVersion: "aerynth.local-owner@1",
    }),
    projectAccess: project,
    resourceAccess: (resourceId) => rawResource(resourceId) !== null,
    eventAccess: (header) => permit(() => options.eventAccess(header)),
    readResource: (resourceId) => {
      const resource = timeline(resourceId);
      return resource ? { resource, authorized: true, writable: true } : null;
    },
    createResource: (input) => {
      check(
        input.kind === "timeline" &&
          (input.projectId === null || project(input.projectId)),
        "timeline_scope_unavailable",
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
        "timeline_canonical_factory_required",
      );
      db.prepare(
        "INSERT INTO desktop_resources(resource_id,kind) VALUES(?,?)",
      ).run(created.id, "timeline");
      const resource = timeline(created.id);
      check(resource, "timeline_unavailable");
      return resource;
    },
    touchResource: (input) => {
      const resource = timeline(input.resourceId);
      check(resource, "timeline_unavailable");
      kernel.touchGenericResource(resource.id, input.expectedVersion, {
        origin: "user",
        correlationId: input.commandId,
      });
      const updated = timeline(resource.id);
      check(updated, "timeline_unavailable");
      return updated;
    },
    recordEvent: (event) => options.recordEvent(event),
  };
  function dispatch(request: TimelineRequest): TimelineResponse {
    check(
      envelope(request) &&
        ["create", "read", "save", "query"].includes(request.name),
      "invalid_timeline_request",
    );
    if (request.name === "read")
      check(
        fields(request.input, ["resourceId"]) && id(request.input.resourceId),
        "invalid_timeline_input",
      );
    return tx(() => {
      const service = new TimelineService(kernel, host);
      switch (request.name) {
        case "create":
          return service.create(request.input);
        case "read":
          return service.read(request.input.resourceId);
        case "save":
          return service.save(request.input);
        case "query":
          return service.query(request.input);
      }
    });
  }
  return { dispatch: dispatch as TimelineDomain["dispatch"] };
}
