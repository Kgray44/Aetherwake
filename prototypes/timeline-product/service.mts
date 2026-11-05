import { randomUUID, createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { WorkspaceKernel } from "../workspace-kernel/kernel.mts";
import {
  TIMELINE_CONTRACT,
  TIMELINE_LIMITS,
  timelineCapabilities,
  type TimelinePlanningRequest,
  type TimelinePlanningResponse,
  type TimelinePlanningMutationResult,
  type TimelinePlanningItem,
  type CreateTimeline,
  type SaveTimeline,
  type QueryTimeline,
  type TimelineResource,
  type TimelineView,
  type TimelineDocument,
  type TimelineMutationResult,
  type TimelineEventHeader,
  type TimelineWindow,
  type TimelineGapReason,
  type TimelinePage,
  type RecordedTimelineItem,
  type GitHubCommitEvidence,
  type TimelineSourceCoverage,
} from "./contracts.ts";

export interface TimelineHostPort {
  readonly db: DatabaseSync;
  identity(): { principalId: string; policyVersion: string };
  projectAccess(id: string): boolean;
  resourceAccess(id: string): boolean;
  /** Required even for unscoped application/provider headers. Missing/throw denies. */
  eventAccess(header: Readonly<TimelineEventHeader>): boolean;
  readResource(resourceId: string): {
    resource: TimelineResource;
    authorized: boolean;
    writable: boolean;
  } | null;
  createResource(input: {
    kind: "timeline";
    title: string;
    projectId: string | null;
    commandId: string;
  }): TimelineResource;
  touchResource(input: {
    resourceId: string;
    expectedVersion: number;
    commandId: string;
  }): TimelineResource;
  /** Same-transaction metadata only; Root owns post-commit stream delivery. */
  recordEvent(event: {
    type: "timeline.created" | "timeline.view-saved" | "timeline.planning-created" | "timeline.planning-updated" | "timeline.planning-deleted" | "timeline.planning-undone";
    resourceId: string;
    resourceVersion: number;
    commandId: string;
    detail: {
      actorKind: "user";
      authority: "manual";
      principalId: string;
      policyVersion: string;
      mode: TimelineView["mode"];
      scopeKind: "application" | "project" | "resources";
      resourceCount: number;
    };
  }): void;
}
export class TimelineError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "TimelineError";
  }
}
const check: (value: unknown, code: string) => asserts value = (
  value,
  code,
) => {
  if (!value) throw new TimelineError(code);
};
const record = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const fields = (
  v: unknown,
  keys: string[],
  required = keys,
): v is Record<string, any> =>
  record(v) &&
  Reflect.ownKeys(v).every(
    (key) => typeof key === "string" && keys.includes(key),
  ) &&
  required.every((key) => Object.hasOwn(v, key));
const id = (v: unknown, max = 512): v is string =>
  typeof v === "string" &&
  !!v &&
  v.trim() === v &&
  v.length <= max &&
  !/[\x00-\x1f]/.test(v);
const version = (v: unknown): v is number =>
  Number.isSafeInteger(v) && Number(v) > 0;
const cursor = (v: unknown): v is number =>
  Number.isSafeInteger(v) && Number(v) >= 0;
const iso = (v: unknown): v is string => {
  try {
    return typeof v === "string" && new Date(v).toISOString() === v;
  } catch {
    return false;
  }
};
const classes = ["observed", "reported", "inferred", "simulated"];
const stable = (v: unknown): string =>
  JSON.stringify(v, (_key, value) =>
    record(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, value[key]]),
        )
      : value,
  );
const digest = (v: unknown) =>
  createHash("sha256").update(stable(v)).digest("hex");
const tableNames = ["timeline_schema", "timeline_views", "timeline_receipts"];
const headerFields = [
  "schemaVersion",
  "eventId",
  "cursor",
  "resourceId",
  "executionId",
  "providerId",
  "providerInstanceId",
  "connectionId",
  "nativeEventId",
  "nativeSequence",
  "threadId",
  "turnId",
  "correlationId",
  "causationId",
  "receivedAt",
  "providerTime",
  "providerTimeSource",
  "type",
  "classification",
  "status",
] as const;
// SQLite projects only bounded, correctly typed header primitives. Payloads
// remain inside the existing store, including on malformed/oversized rows.
const optionalFields = [
  "resourceId",
  "executionId",
  "nativeEventId",
  "nativeSequence",
  "threadId",
  "turnId",
  "correlationId",
  "causationId",
  "providerTime",
  "providerTimeSource",
  "status",
];
const fieldShape = (key: string) => {
  const path = `'$.${key}'`,
    type = `json_type(json,${path})`;
  const textLimit =
    key === "receivedAt"
      ? 24
      : key === "type"
        ? 200
        : ["providerTimeSource", "status"].includes(key)
          ? 128
          : 512;
  const shape = ["schemaVersion", "cursor", "nativeSequence"].includes(key)
    ? `${type}='integer'`
    : key === "providerTime"
      ? `${type} IN ('integer','real')`
      : `${type}='text' AND length(json_extract(json,${path}))<=${textLimit}`;
  return optionalFields.includes(key)
    ? `(${type}='null' OR (${shape}))`
    : `(${shape})`;
};
const projection =
  "cursor AS storeCursor,CASE WHEN json_valid(json) THEN CASE WHEN " +
  headerFields.map(fieldShape).join(" AND ") +
  " THEN 1 ELSE 0 END ELSE 0 END AS valid," +
  headerFields
    .map(
      (key) =>
        `CASE WHEN json_valid(json) THEN CASE WHEN ${fieldShape(key)} THEN json_extract(json,'$.${key}') END END AS ${key}`,
    )
    .join(",") +
  ",CASE WHEN json_valid(json) THEN CASE WHEN " +
  "json_extract(json,'$.providerId')='github' AND " +
  "json_type(json,'$.externalEvidence')='object' AND " +
  "length(CAST(json_extract(json,'$.externalEvidence') AS BLOB))<=1536 " +
  "THEN json_extract(json,'$.externalEvidence') END END AS externalEvidence";

function githubEvidence(value: unknown, event: TimelineEventHeader): GitHubCommitEvidence | undefined {
  if (typeof value !== "string" || event.providerId !== "github" ||
      event.type !== "github.commit" || event.classification !== "reported" ||
      !event.resourceId || !event.nativeEventId || !/^[a-f0-9]{40}$/.test(event.nativeEventId))
    return;
  const evidence: unknown = JSON.parse(value);
  if (!fields(evidence, ["kind", "title", "source", "reportedAt", "timeSource"]) ||
      evidence.kind !== "github-commit" || !id(evidence.title, 200) ||
      !fields(evidence.source, ["ref", "label", "permalink"]) ||
      evidence.source.ref !== event.resourceId || !id(evidence.source.label, 140) ||
      !/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/.test(evidence.source.label) ||
      (evidence.source.permalink !== null &&
        evidence.source.permalink !== `https://github.com/${evidence.source.label}/commit/${event.nativeEventId}`))
    return;
  if (evidence.reportedAt === null
    ? evidence.timeSource !== null || event.providerTime !== null || event.providerTimeSource !== null
    : !iso(evidence.reportedAt) ||
      !["github-committer", "github-author"].includes(evidence.timeSource) ||
      event.providerTime !== Date.parse(evidence.reportedAt) || event.providerTimeSource !== evidence.timeSource)
    return;
  return evidence as unknown as GitHubCommitEvidence;
}

function sourceCoverage(value: unknown): TimelineSourceCoverage | undefined {
  if (typeof value !== "string") return;
  const data: unknown = JSON.parse(value);
  const keys = ["kind", "sourceLabel", "requestedFrom", "requestedTo", "fetchedAt", "status"];
  if (!fields(data, [...keys, "omissionReason"], keys) || data.kind !== "github-commits" ||
      !id(data.sourceLabel, 140) || !iso(data.requestedFrom) || !iso(data.requestedTo) ||
      data.requestedFrom >= data.requestedTo || !iso(data.fetchedAt) ||
      !["bounded", "partial"].includes(data.status) ||
      (Object.hasOwn(data, "omissionReason") && !id(data.omissionReason, 200))) return;
  return data as unknown as TimelineSourceCoverage;
}

/** Durable view configuration, never a mirror of source events. Unknown reads
 * do no DDL. Only explicit create initializes this versioned additive schema. */
export class TimelineService {
  private kernel: WorkspaceKernel;
  private host: TimelineHostPort;
  constructor(kernel: WorkspaceKernel, host: TimelineHostPort) {
    this.kernel = kernel;
    this.host = host;
    for (const key of [
      "identity",
      "projectAccess",
      "resourceAccess",
      "eventAccess",
      "readResource",
      "createResource",
      "touchResource",
      "recordEvent",
    ] as const)
      check(typeof host[key] === "function", "timeline_host_required");
    this.tx(() => {
      check(
        host.db.prepare("PRAGMA foreign_keys").get()!.foreign_keys === 1,
        "timeline_foreign_keys_required",
      );
      this.schema(false);
    });
  }
  private tx<T>(work: () => T): T {
    return this.kernel.withTransaction((db) => {
      check(db === this.host.db, "timeline_canonical_connection_required");
      return work();
    });
  }
  private identity() {
    const value = this.host.identity();
    check(
      value && id(value.principalId, 200) && id(value.policyVersion, 200),
      "timeline_identity_unavailable",
    );
    return value;
  }
  private allow(work: () => boolean) {
    try {
      return work() === true;
    } catch {
      return false;
    }
  }
  private schema(create: boolean) {
    const db = this.host.db,
      names = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name GLOB 'timeline_*'",
        )
        .all()
        .map((r) => String(r.name));
    if (!names.length && !create) return false;
    if (!names.length)
      db.exec(`CREATE TABLE timeline_schema(version INTEGER NOT NULL);INSERT INTO timeline_schema VALUES(1);
      CREATE TABLE timeline_views(resource_id TEXT PRIMARY KEY REFERENCES resources(id) ON DELETE CASCADE,owner_id TEXT NOT NULL,view_json TEXT NOT NULL,view_digest TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE timeline_receipts(owner_id TEXT NOT NULL,command_id TEXT NOT NULL,fingerprint TEXT NOT NULL,resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,result_json TEXT NOT NULL,PRIMARY KEY(owner_id,command_id));`);
    else
      check(
        (names.length === tableNames.length || names.length === tableNames.length + 2) &&
          tableNames.every((name) => names.includes(name)) &&
          names.every(name => [...tableNames, "timeline_planning_items", "timeline_planning_operations"].includes(name)),
        "timeline_partial_schema",
      );
    for (const [table, expected] of [
      ["timeline_schema", ["version"]],
      [
        "timeline_views",
        [
          "resource_id",
          "owner_id",
          "view_json",
          "view_digest",
          "created_at",
          "updated_at",
        ],
      ],
      [
        "timeline_receipts",
        ["owner_id", "command_id", "fingerprint", "resource_id", "result_json"],
      ],
    ] as const)
      check(
        stable(
          db
            .prepare("PRAGMA table_info(" + table + ")")
            .all()
            .map((row) => row.name),
        ) === stable(expected),
        "timeline_invalid_schema",
      );
    const rows = db.prepare("SELECT version FROM timeline_schema").all();
    check(
      rows.length === 1 && [1, 2].includes(Number(rows[0]!.version)),
      "timeline_unsupported_schema",
    );
    const schemaVersion = Number(rows[0]!.version);
    check(schemaVersion === 1 ? names.length === 3 || !names.length : names.length === 5, "timeline_partial_schema");
    if (schemaVersion === 2) {
      for (const [table, columns] of [
        ["timeline_planning_items", ["resource_id", "item_id", "state_json"]],
        ["timeline_planning_operations", ["resource_id", "command_id", "item_id", "before_json", "after_json"]],
      ] as const) check(stable(db.prepare("PRAGMA table_info(" + table + ")").all().map(row => row.name)) === stable(columns), "timeline_invalid_schema");
    }
    for (const table of ["timeline_views", "timeline_receipts", ...(schemaVersion === 2 ? ["timeline_planning_items", "timeline_planning_operations"] : [])]) {
      const refs = db.prepare("PRAGMA foreign_key_list(" + table + ")").all();
      check(
        refs.length === 1 &&
          refs[0]!.table === "resources" &&
          refs[0]!.from === "resource_id" &&
          refs[0]!.to === "id" &&
          refs[0]!.on_delete === "CASCADE",
        "timeline_invalid_schema",
      );
    }
    return true;
  }
  private authorizedResource(resourceId: string, write = false) {
    check(id(resourceId), "timeline_invalid_id");
    const entry = this.host.readResource(resourceId),
      r = entry?.resource;
    check(
      entry?.authorized === true &&
        r?.id === resourceId &&
        r.kind === "timeline" &&
        r.state === "active" &&
        version(r.version) &&
        this.allow(() => this.host.resourceAccess(resourceId)),
      "timeline_unavailable",
    );
    const canEdit = entry.writable === true;
    check(!write || canEdit, "timeline_read_only");
    const raw = this.host.db
      .prepare(
        "SELECT r.*,d.kind AS semantic_kind FROM resources r JOIN desktop_resources d ON d.resource_id=r.id WHERE r.id=?",
      )
      .get(resourceId);
    check(
      raw?.kind === "generic" &&
        raw.semantic_kind === "timeline" &&
        raw.title === r.title &&
        raw.version === r.version &&
        raw.project_id === r.projectId &&
        raw.state === r.state,
      "timeline_canonical_resource_mismatch",
    );
    if (r.projectId !== null)
      check(this.project(r.projectId), "timeline_scope_unavailable");
    return { resource: structuredClone(r), canEdit };
  }
  private resource(resourceId: string, write = false) {
    return this.authorizedResource(resourceId, write).resource;
  }
  private project(projectId: string) {
    return (
      id(projectId) &&
      this.allow(() => this.host.projectAccess(projectId)) &&
      !!this.host.db
        .prepare("SELECT 1 FROM projects WHERE id=? AND state='active'")
        .get(projectId)
    );
  }
  private sourceResource(resourceId: string) {
    const r = this.host.db
      .prepare("SELECT id,project_id,state,version FROM resources WHERE id=?")
      .get(resourceId);
    return r &&
      ["active", "archived"].includes(String(r.state)) &&
      version(r.version) &&
      (!r.project_id || this.project(String(r.project_id))) &&
      this.allow(() => this.host.resourceAccess(resourceId))
      ? {
          id: String(r.id),
          projectId: r.project_id as string | null,
          state: r.state as "active" | "archived",
          version: Number(r.version),
        }
      : null;
  }
  private view(input: unknown): TimelineView {
    const required = ["schemaVersion", "mode", "scope", "sources", "viewport", "selection"];
    check(
      fields(input, [...required, "timeAxis"], required) &&
        input.schemaVersion === 1 &&
        ["activity", "execution"].includes(input.mode) &&
        (!Object.hasOwn(input, "timeAxis") || ["receivedAt", "reportedAt"].includes(input.timeAxis)),
      "timeline_invalid_view",
    );
    check(
      fields(input.scope, ["projectId", "resourceIds"]) &&
        (input.scope.projectId === null || id(input.scope.projectId)) &&
        Array.isArray(input.scope.resourceIds) &&
        input.scope.resourceIds.length <= TIMELINE_LIMITS.resourceIds &&
        input.scope.resourceIds.every((value: unknown) => id(value)) &&
        new Set(input.scope.resourceIds).size ===
          input.scope.resourceIds.length,
      "timeline_invalid_scope",
    );
    check(
      fields(input.sources, ["providerIds", "eventTypes", "classifications"]),
      "timeline_invalid_filters",
    );
    for (const key of ["providerIds", "eventTypes", "classifications"])
      check(
        Array.isArray(input.sources[key]) &&
          input.sources[key].length <= TIMELINE_LIMITS.sourceFilters &&
          new Set(input.sources[key]).size === input.sources[key].length &&
          input.sources[key].every((value: unknown) =>
            key === "classifications"
              ? classes.includes(String(value)) && typeof value === "string"
              : id(value, 200),
          ),
        "timeline_invalid_filters",
      );
    if (input.timeAxis === "reportedAt")
      check(input.mode === "activity" && input.scope.resourceIds.length > 0 &&
        input.sources.providerIds.length === 1 && input.sources.providerIds[0] === "github" &&
        input.sources.classifications.includes("reported"), "timeline_invalid_reported_time_scope");
    check(
      input.sources.classifications.length > 0 &&
        fields(input.viewport, ["from", "to", "displayTimeZone"]) &&
        iso(input.viewport.from) &&
        iso(input.viewport.to) &&
        Date.parse(input.viewport.from) < Date.parse(input.viewport.to) &&
        id(input.viewport.displayTimeZone, 100),
      "timeline_invalid_viewport",
    );
    try {
      new Intl.DateTimeFormat("en", {
        timeZone: input.viewport.displayTimeZone,
      }).format(0);
    } catch {
      throw new TimelineError("timeline_invalid_timezone");
    }
    check(
      input.selection === null ||
        (fields(input.selection, ["eventId", "cursor"]) &&
          id(input.selection.eventId) &&
          version(input.selection.cursor)),
      "timeline_invalid_selection",
    );
    check(
      Buffer.byteLength(stable(input)) <= TIMELINE_LIMITS.viewBytes,
      "timeline_view_capacity",
    );
    return structuredClone(input) as TimelineView;
  }
  private scope(view: TimelineView, resource: TimelineResource) {
    check(
      resource.projectId === null ||
        resource.projectId === view.scope.projectId,
      "timeline_scope_mismatch",
    );
    if (view.scope.projectId !== null)
      check(this.project(view.scope.projectId), "timeline_scope_unavailable");
    for (const resourceId of view.scope.resourceIds) {
      const source = this.sourceResource(resourceId);
      check(
        source &&
          (view.scope.projectId === null ||
            source.projectId === view.scope.projectId),
        "timeline_scope_unavailable",
      );
    }
  }
  private stored(resourceId: string) {
    check(this.schema(false), "timeline_unavailable");
    const { resource, canEdit } = this.authorizedResource(resourceId),
      row = this.host.db
        .prepare(
          "SELECT * FROM timeline_views WHERE resource_id=? AND owner_id=?",
        )
        .get(resourceId, this.identity().principalId);
    check(
      row &&
        typeof row.view_json === "string" &&
        Buffer.byteLength(row.view_json) <= TIMELINE_LIMITS.viewBytes,
      "timeline_unavailable",
    );
    let view;
    try {
      view = this.view(JSON.parse(row.view_json));
    } catch {
      throw new TimelineError("timeline_view_corrupt");
    }
    check(
      digest(view) === row.view_digest &&
        iso(row.created_at) &&
        iso(row.updated_at),
      "timeline_view_corrupt",
    );
    this.scope(view, resource);
    return {
      resource,
      canEdit,
      view,
      viewDigest: String(row.view_digest),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }
  private source() {
    const db = this.host.db;
    if (
      !db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='intelligence_events'",
        )
        .get() ||
      !db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='integration_meta'",
        )
        .get()
    )
      return null;
    if (
      stable(
        db
          .prepare("PRAGMA table_info(intelligence_events)")
          .all()
          .map((row) => row.name),
      ) !== stable(["cursor", "dedupe", "json"])
    )
      return null;
    if (
      stable(
        db
          .prepare("PRAGMA table_info(integration_meta)")
          .all()
          .map((row) => row.name),
      ) !== stable(["id", "latest"])
    )
      return null;
    const range = db
        .prepare(
          "SELECT min(cursor) AS earliest,max(cursor) AS maximum FROM intelligence_events",
        )
        .get()!,
      meta = db.prepare("SELECT latest FROM integration_meta WHERE id=1").get();
    if (
      !meta ||
      !cursor(meta.latest) ||
      (range.maximum !== null &&
        (!version(range.maximum) || Number(range.maximum) > meta.latest))
    )
      return null;
    return {
      earliest: range.earliest === null ? null : Number(range.earliest),
      latest: Number(meta.latest),
    };
  }
  private header(
    row: Record<string, any>,
  ): TimelineEventHeader | "unsupported-event-schema" | "invalid-event" {
    if (row.valid !== 1) return "invalid-event";
    if (row.schemaVersion !== 1) return "unsupported-event-schema";
    if (
      !version(row.storeCursor) ||
      row.cursor !== row.storeCursor ||
      !id(row.eventId) ||
      !id(row.type, 200) ||
      !id(row.providerId) ||
      !id(row.providerInstanceId) ||
      !id(row.connectionId) ||
      !iso(row.receivedAt) ||
      !classes.includes(row.classification)
    )
      return "invalid-event";
    for (const key of [
      "resourceId",
      "executionId",
      "nativeEventId",
      "threadId",
      "turnId",
      "correlationId",
      "causationId",
    ])
      if (row[key] !== null && !id(row[key])) return "invalid-event";
    if (
      (row.nativeSequence !== null && !cursor(row.nativeSequence)) ||
      (row.providerTime !== null && !Number.isFinite(row.providerTime)) ||
      (row.providerTimeSource !== null && !id(row.providerTimeSource, 128)) ||
      (row.status !== null && !id(row.status, 128))
    )
      return "invalid-event";
    const header = Object.fromEntries(
      headerFields.map((key) => [key, row[key]]),
    ) as unknown as TimelineEventHeader;
    return Buffer.byteLength(stable(header)) <= TIMELINE_LIMITS.headerBytes
      ? header
      : "invalid-event";
  }
  private visible(event: TimelineEventHeader, view: TimelineView) {
    const r =
      event.resourceId === null ? null : this.sourceResource(event.resourceId);
    if (event.resourceId !== null && !r)
      return { allowed: false, policy: true, resource: null };
    if (
      event.resourceId === null &&
      (view.scope.projectId !== null || view.scope.resourceIds.length > 0)
    )
      return { allowed: false, policy: false, resource: null };
    if (
      (view.scope.projectId !== null &&
        r?.projectId !== view.scope.projectId) ||
      (view.scope.resourceIds.length &&
        !view.scope.resourceIds.includes(event.resourceId!))
    )
      return { allowed: false, policy: false, resource: null };
    if (
      !this.allow(() =>
        this.host.eventAccess(Object.freeze(structuredClone(event))),
      )
    )
      return { allowed: false, policy: true, resource: null };
    if (
      (view.mode === "execution" && event.executionId === null) ||
      (view.sources.providerIds.length &&
        !view.sources.providerIds.includes(event.providerId)) ||
      (view.sources.eventTypes.length &&
        !view.sources.eventTypes.includes(event.type)) ||
      !view.sources.classifications.includes(event.classification)
    )
      return { allowed: false, policy: false, resource: null };
    return { allowed: true, policy: false, resource: r };
  }
  private selection(view: TimelineView) {
    if (!view.selection) return true;
    if (!this.source()) return false;
    const row = this.host.db
      .prepare(
        "SELECT " + projection + " FROM intelligence_events WHERE cursor=?",
      )
      .get(view.selection.cursor);
    if (!row) return false;
    const header = this.header(row);
    return (
      typeof header !== "string" &&
      header.eventId === view.selection.eventId &&
      this.visible(header, view).allowed &&
      (view.timeAxis !== "reportedAt" || !!githubEvidence(row.externalEvidence, header)?.reportedAt)
    );
  }
  openGitHubCommit(input: { timelineId: string; eventId: string; cursor: number }): string | null {
    return this.tx(() => {
      check(fields(input, ["timelineId", "eventId", "cursor"]) &&
        id(input.timelineId) && id(input.eventId) && version(input.cursor), "invalid_github_commit_open");
      const { view } = this.stored(input.timelineId);
      if (!this.source()) return null;
      const row = this.host.db.prepare("SELECT " + projection + " FROM intelligence_events WHERE cursor=?").get(input.cursor);
      if (!row) return null;
      const event = this.header(row);
      if (typeof event === "string" || event.eventId !== input.eventId || !this.visible(event, view).allowed) return null;
      const evidence = githubEvidence(row.externalEvidence, event);
      const time = view.timeAxis === "reportedAt" ? evidence?.reportedAt : event.receivedAt;
      if (!time || time < view.viewport.from || time >= view.viewport.to) return null;
      return evidence?.source.permalink ?? null;
    });
  }
  private githubCoverage(timelineId: string, view: TimelineView): TimelineSourceCoverage | undefined {
    if (view.timeAxis !== "reportedAt" || view.scope.resourceIds.length !== 1) return;
    const row = this.host.db.prepare(
      "SELECT " + projection +
      ",CASE WHEN length(CAST(json_extract(json,'$.externalCoverage') AS BLOB))<=1536 THEN json_extract(json,'$.externalCoverage') END AS externalCoverage" +
      " FROM intelligence_events WHERE CASE WHEN json_valid(json) THEN json_extract(json,'$.type')='github.import' AND json_extract(json,'$.resourceId')=? AND json_extract(json,'$.correlationId')=? END ORDER BY cursor DESC LIMIT 1",
    ).get(timelineId, view.scope.resourceIds[0]!);
    if (!row) return;
    const event = this.header(row);
    if (typeof event === "string" || event.providerId !== "github" ||
        !this.allow(() => this.host.eventAccess(Object.freeze(structuredClone(event))))) return;
    return sourceCoverage(row.externalCoverage);
  }
  read(resourceId: string): TimelineDocument {
    return this.tx(() => {
      const value = this.stored(resourceId),
        view = structuredClone(value.view),
        selectionUnavailable = !this.selection(view);
      if (selectionUnavailable) view.selection = null;
      return {
        contract: TIMELINE_CONTRACT,
        schemaVersion: 1,
        ...value,
        view,
        selectionUnavailable,
        capabilities: timelineCapabilities,
      };
    });
  }
  private once<T extends TimelineMutationResult = TimelineMutationResult>(
    commandId: string,
    request: unknown,
    work: () => T,
    validate?: (value: unknown) => boolean,
  ) {
    check(id(commandId, 200), "timeline_invalid_command");
    const owner = this.identity().principalId,
      fingerprint = digest(request),
      row = this.host.db
        .prepare(
          "SELECT * FROM timeline_receipts WHERE owner_id=? AND command_id=?",
        )
        .get(owner, commandId);
    if (row) {
      check(row.fingerprint === fingerprint, "timeline_command_conflict");
      this.resource(String(row.resource_id), true);
      check(
        typeof row.result_json === "string" &&
          Buffer.byteLength(row.result_json) <= 2048,
        "timeline_receipt_corrupt",
      );
      let result;
      try {
        result = JSON.parse(row.result_json);
      } catch {
        throw new TimelineError("timeline_receipt_corrupt");
      }
      check(
        (validate ? validate(result) : fields(result, ["resourceId", "version", "viewDigest"])) &&
          result.resourceId === row.resource_id &&
          version(result.version) &&
          typeof result.viewDigest === "string" &&
          /^[a-f0-9]{64}$/.test(result.viewDigest),
        "timeline_receipt_corrupt",
      );
      return result as T;
    }
    check(
      Number(
        this.host.db
          .prepare("SELECT count(*) AS n FROM timeline_receipts")
          .get()!.n,
      ) < TIMELINE_LIMITS.receipts,
      "timeline_receipt_capacity",
    );
    const result = work();
    this.host.db
      .prepare("INSERT INTO timeline_receipts VALUES(?,?,?,?,?)")
      .run(
        owner,
        commandId,
        fingerprint,
        result.resourceId,
        JSON.stringify(result),
      );
    return result;
  }
  private event(
    resource: TimelineResource,
    commandId: string,
    view: TimelineView,
    create: boolean,
  ) {
    const who = this.identity();
    this.host.recordEvent({
      type: create ? "timeline.created" : "timeline.view-saved",
      resourceId: resource.id,
      resourceVersion: resource.version,
      commandId,
      detail: {
        actorKind: "user",
        authority: "manual",
        principalId: who.principalId,
        policyVersion: who.policyVersion,
        mode: view.mode,
        scopeKind: view.scope.resourceIds.length
          ? "resources"
          : view.scope.projectId
            ? "project"
            : "application",
        resourceCount: view.scope.resourceIds.length,
      },
    });
  }
  create(input: CreateTimeline): TimelineMutationResult {
    check(
      fields(input, ["commandId", "title", "projectId", "view"]) &&
        id(input.commandId, 200) &&
        typeof input.title === "string" &&
        input.title.trim() &&
        input.title.length <= 200 &&
        !input.title.includes("\0") &&
        (input.projectId === null || id(input.projectId)),
      "timeline_invalid_create",
    );
    const view = this.view(input.view);
    return this.tx(() => {
      this.schema(true);
      return this.once(input.commandId, { operation: "create", input }, () => {
        check(
          Number(
            this.host.db
              .prepare("SELECT count(*) AS n FROM timeline_views")
              .get()!.n,
          ) < TIMELINE_LIMITS.views,
          "timeline_capacity",
        );
        if (input.projectId !== null)
          check(this.project(input.projectId), "timeline_scope_unavailable");
        const previous = Number(
          this.host.db
            .prepare("SELECT coalesce(max(rowid),0) AS n FROM resources")
            .get()!.n,
        );
        const made = this.host.createResource({
            kind: "timeline",
            title: input.title.trim(),
            projectId: input.projectId,
            commandId: input.commandId,
          }),
          resource = this.resource(made.id, true),
          raw = this.host.db
            .prepare("SELECT rowid FROM resources WHERE id=?")
            .get(resource.id);
        check(
          Number(raw?.rowid) > previous &&
            resource.version === 1 &&
            resource.title === input.title.trim() &&
            resource.projectId === input.projectId &&
            !this.host.db
              .prepare("SELECT 1 FROM notes WHERE resource_id=?")
              .get(resource.id),
          "timeline_canonical_factory_required",
        );
        this.scope(view, resource);
        check(this.selection(view), "timeline_selection_unavailable");
        const at = new Date().toISOString(),
          viewDigest = digest(view);
        this.host.db
          .prepare("INSERT INTO timeline_views VALUES(?,?,?,?,?,?)")
          .run(
            resource.id,
            this.identity().principalId,
            stable(view),
            viewDigest,
            at,
            at,
          );
        this.event(resource, input.commandId, view, true);
        return {
          resourceId: resource.id,
          version: resource.version,
          viewDigest,
        };
      });
    });
  }
  save(input: SaveTimeline): TimelineMutationResult {
    check(
      fields(input, ["commandId", "resourceId", "expectedVersion", "view"]) &&
        id(input.resourceId) &&
        version(input.expectedVersion),
      "timeline_invalid_save",
    );
    const view = this.view(input.view);
    return this.tx(() => {
      check(this.schema(false), "timeline_unavailable");
      return this.once(input.commandId, { operation: "save", input }, () => {
        const resource = this.resource(input.resourceId, true),
          row = this.host.db
            .prepare("SELECT owner_id FROM timeline_views WHERE resource_id=?")
            .get(resource.id);
        check(
          row?.owner_id === this.identity().principalId,
          "timeline_unavailable",
        );
        check(
          resource.version === input.expectedVersion,
          "timeline_version_conflict",
        );
        this.scope(view, resource);
        check(this.selection(view), "timeline_selection_unavailable");
        const touched = this.host.touchResource({
          resourceId: resource.id,
          expectedVersion: resource.version,
          commandId: input.commandId,
        });
        check(
          touched.id === resource.id &&
            touched.version === resource.version + 1 &&
            touched.title === resource.title &&
            touched.projectId === resource.projectId,
          "timeline_canonical_version_required",
        );
        const actual = this.resource(resource.id, true);
        check(
          actual.version === touched.version &&
            actual.title === resource.title &&
            actual.projectId === resource.projectId,
          "timeline_canonical_version_required",
        );
        const viewDigest = digest(view);
        this.host.db
          .prepare(
            "UPDATE timeline_views SET view_json=?,view_digest=?,updated_at=? WHERE resource_id=?",
          )
          .run(stable(view), viewDigest, new Date().toISOString(), resource.id);
        this.event(actual, input.commandId, view, false);
        return { resourceId: resource.id, version: actual.version, viewDigest };
      });
    });
  }
  /** User-authored planning authority. Retained event tables are never written. */
  planning(input: TimelinePlanningRequest): TimelinePlanningResponse {
    const base = ["op", "resourceId", "expectedVersion"];
    const extra: Record<string, string[]> = { list: [], create: ["commandId", "values"], update: ["commandId", "itemId", "values"], delete: ["commandId", "itemId"], undo: ["commandId", "targetCommandId"] };
    check(record(input) && typeof input.op === "string" && Object.hasOwn(extra, input.op) &&
      fields(input, [...base, ...extra[input.op]!]) && id(input.resourceId) && version(input.expectedVersion), "timeline_invalid_planning_request");
    if (input.op !== "list") check(id(input.commandId, 200), "timeline_invalid_command");
    if (input.op === "update" || input.op === "delete") check(id(input.itemId, 200), "timeline_invalid_planning_item");
    if (input.op === "undo") check(id(input.targetCommandId, 200) && input.targetCommandId !== input.commandId, "timeline_invalid_undo");
    const values = input.op === "create" || input.op === "update" ? this.planningValues(input.values) : null;
    return this.tx(() => {
      const current = this.stored(input.resourceId);
      const db = this.host.db;
      if (input.op === "list") {
        check(current.resource.version === input.expectedVersion, "timeline_version_conflict");
        const exists = Number(db.prepare("SELECT version FROM timeline_schema").get()!.version) === 2;
        const items = exists ? db.prepare("SELECT state_json FROM timeline_planning_items WHERE resource_id=? ORDER BY item_id LIMIT ?").all(input.resourceId, TIMELINE_LIMITS.planningItems + 1)
          .map(row => this.planningState(String(row.state_json))).filter(state => !state.deleted).map(state => state.item) : [];
        check(items.length <= TIMELINE_LIMITS.planningItems, "timeline_planning_capacity");
        return { resourceId: input.resourceId, resourceVersion: current.resource.version, canEdit: current.canEdit, items };
      }
      check(current.canEdit, "timeline_read_only");
      return this.once<TimelinePlanningMutationResult>(input.commandId, { operation: "planning", input }, () => {
        check(current.resource.version === input.expectedVersion, "timeline_version_conflict");
        this.planningSchema();
        check(Number(db.prepare("SELECT count(*) AS n FROM timeline_planning_operations").get()!.n) < TIMELINE_LIMITS.planningOperations, "timeline_planning_operation_capacity");
        let itemId: string, before: string | null = null, next: { item: TimelinePlanningItem; deleted: boolean };
        const read = (id: string) => {
          const row = db.prepare("SELECT state_json FROM timeline_planning_items WHERE resource_id=? AND item_id=?").get(input.resourceId, id);
          check(row && typeof row.state_json === "string", "timeline_planning_item_unavailable");
          const state = this.planningState(row.state_json);
          check(state.item.id === id, "timeline_planning_corrupt");
          return { json: String(row.state_json), state };
        };
        const nextVersion = current.resource.version + 1;
        if (input.op === "create") {
          check(Number(db.prepare("SELECT count(*) AS n FROM timeline_planning_items WHERE resource_id=?").get(input.resourceId)!.n) < TIMELINE_LIMITS.planningItems, "timeline_planning_capacity");
          itemId = randomUUID();
          next = { item: { ...values!, id: itemId, temporalClass: "planned", version: nextVersion }, deleted: false };
        } else if (input.op === "undo") {
          const operation = db.prepare("SELECT * FROM timeline_planning_operations WHERE resource_id=? AND command_id=?").get(input.resourceId, input.targetCommandId);
          check(operation, "timeline_undo_unavailable");
          itemId = String(operation.item_id);
          const previous = read(itemId); before = previous.json;
          check(previous.json === operation.after_json, "timeline_undo_conflict");
          const restore = operation.before_json === null ? { ...previous.state, deleted: true } : this.planningState(String(operation.before_json));
          check(restore.item.id === itemId && restore.item.version <= current.resource.version, "timeline_planning_corrupt");
          next = { ...restore, item: { ...restore.item, version: nextVersion } };
        } else {
          itemId = input.itemId;
          const previous = read(itemId); before = previous.json;
          check(!previous.state.deleted, "timeline_planning_item_unavailable");
          next = { item: { ...previous.state.item, ...(values ?? {}), version: nextVersion }, deleted: input.op === "delete" };
        }
        const touched = this.host.touchResource({ resourceId: input.resourceId, expectedVersion: current.resource.version, commandId: input.commandId });
        const actual = this.resource(input.resourceId, true);
        check(touched.id === actual.id && actual.id === current.resource.id && touched.version === nextVersion && actual.version === nextVersion &&
          touched.title === current.resource.title && actual.title === current.resource.title && touched.projectId === current.resource.projectId && actual.projectId === current.resource.projectId,
          "timeline_canonical_version_required");
        const after = stable(next);
        db.prepare("INSERT INTO timeline_planning_items VALUES(?,?,?) ON CONFLICT(resource_id,item_id) DO UPDATE SET state_json=excluded.state_json").run(input.resourceId, itemId, after);
        db.prepare("INSERT INTO timeline_planning_operations VALUES(?,?,?,?,?)").run(input.resourceId, input.commandId, itemId, before, after);
        const who = this.identity();
        this.host.recordEvent({ type: input.op === "create" ? "timeline.planning-created" : input.op === "update" ? "timeline.planning-updated" : input.op === "delete" ? "timeline.planning-deleted" : "timeline.planning-undone", resourceId: input.resourceId, resourceVersion: nextVersion, commandId: input.commandId,
          detail: { actorKind: "user", authority: "manual", principalId: who.principalId, policyVersion: who.policyVersion, mode: current.view.mode,
            scopeKind: current.view.scope.resourceIds.length ? "resources" : current.view.scope.projectId ? "project" : "application", resourceCount: current.view.scope.resourceIds.length } });
        db.prepare("UPDATE timeline_views SET updated_at=? WHERE resource_id=?").run(new Date().toISOString(), input.resourceId);
        return { resourceId: input.resourceId, version: nextVersion, viewDigest: current.viewDigest, operationId: input.commandId, item: next.deleted ? null : next.item };
      }, value => {
        if (!fields(value, ["resourceId", "version", "viewDigest", "operationId", "item"]) || value.operationId !== input.commandId) return false;
        if (value.item !== null) { try { const state = this.planningState(stable({ item: value.item, deleted: false })); if (state.item.version !== value.version) return false; } catch { return false; } }
        return true;
      });
    });
  }
  private planningValues(value: unknown) {
    check(fields(value, ["title", "startAt", "durationMs", "timeZone", "laneId"]) && id(value.title, 200) &&
      typeof value.laneId === "string" && value.laneId.length <= 80 && !/[\x00-\x1f]/.test(value.laneId), "timeline_invalid_planning_values");
    check(iso(value.startAt) && value.startAt.endsWith("Z"), "timeline_planning_utc_instant_required");
    check(Number.isSafeInteger(value.durationMs) && value.durationMs >= 0 && Number.isFinite(new Date(Date.parse(value.startAt) + value.durationMs).getTime()), "timeline_invalid_planning_duration");
    check(id(value.timeZone, 100) && !/^[+-]/.test(value.timeZone), "timeline_invalid_timezone");
    try { new Intl.DateTimeFormat("en", { timeZone: value.timeZone }).format(0); } catch { throw new TimelineError("timeline_invalid_timezone"); }
    return structuredClone(value) as import("./contracts.ts").TimelinePlanningValues;
  }
  private planningState(json: string): { item: TimelinePlanningItem; deleted: boolean } {
    check(Buffer.byteLength(json) <= 2048, "timeline_planning_corrupt");
    let value: any;
    try { value = JSON.parse(json); } catch { throw new TimelineError("timeline_planning_corrupt"); }
    check(fields(value, ["item", "deleted"]) && typeof value.deleted === "boolean" && fields(value.item, ["id", "temporalClass", "version", "title", "startAt", "durationMs", "timeZone", "laneId"]) &&
      id(value.item.id, 200) && value.item.temporalClass === "planned" && version(value.item.version), "timeline_planning_corrupt");
    const { id: ignored, temporalClass, version: itemVersion, ...values } = value.item;
    this.planningValues(values);
    return value as { item: TimelinePlanningItem; deleted: boolean };
  }
  private planningSchema() {
    if (Number(this.host.db.prepare("SELECT version FROM timeline_schema").get()!.version) === 2) return;
    this.host.db.exec(`CREATE TABLE timeline_planning_items(resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,item_id TEXT NOT NULL,state_json TEXT NOT NULL,PRIMARY KEY(resource_id,item_id));
      CREATE TABLE timeline_planning_operations(resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,command_id TEXT NOT NULL,item_id TEXT NOT NULL,before_json TEXT,after_json TEXT NOT NULL,PRIMARY KEY(resource_id,command_id));
      UPDATE timeline_schema SET version=2;`);
  }
  query(input: QueryTimeline): TimelineWindow {
    check(
      fields(
        input,
        ["resourceId", "expectedVersion", "limit", "page"],
        ["resourceId", "expectedVersion"],
      ) &&
        id(input.resourceId) &&
        version(input.expectedVersion) &&
        (input.limit === undefined ||
          (Number.isSafeInteger(input.limit) &&
            input.limit > 0 &&
            input.limit <= TIMELINE_LIMITS.events)),
      "timeline_invalid_query",
    );
    return this.tx(() => {
      const value = this.stored(input.resourceId);
      check(
        value.resource.version === input.expectedVersion,
        "timeline_version_conflict",
      );
      const source = this.source(),
        selectionUnavailable = !this.selection(value.view),
        items: RecordedTimelineItem[] = [],
        gaps: TimelineWindow["gaps"] = [];
      const gap = (reason: TimelineGapReason) => {
        if (!gaps.some((g) => g.reason === reason))
          gaps.push({
            kind: "evidence-gap",
            reason,
            cause:
              reason === "access-filtered"
                ? "policy"
                : reason === "source-unavailable" ||
                    reason === "selection-unavailable"
                  ? "unavailable"
                  : reason === "scan-limit"
                    ? "bounded-query"
                    : "unknown",
          });
      };
      const result: TimelineWindow = {
        contract: "aerynth.timeline-window@1",
        resourceId: value.resource.id,
        resourceVersion: value.resource.version,
        viewDigest: value.viewDigest,
        order: "capture-cursor",
        timeAxis: value.view.timeAxis ?? "receivedAt",
        scopeBasis: "current-authorized-canonical-resources",
        items,
        gaps,
        next: null,
        source: {
          store: "intelligence_events",
          state: source ? "retained-history" : "unavailable",
          earliestRetainedCursor: source?.earliest ?? null,
          throughCursor: source?.latest ?? null,
          observedLatestCursor: source?.latest ?? null,
        },
        coverage: {
          matchingItems: source ? "complete-retained-window" : "unavailable",
          allActivity: false,
          rawPayloads: false,
          unscopedEvents: "authorized-global-only",
          timeComparability: "capture-order-is-not-global-causality",
        },
        hasNewEvents: source ? false : null,
        selectionUnavailable,
        capabilities: timelineCapabilities,
      };
      if (selectionUnavailable) gap("selection-unavailable");
      if (!source) {
        gap("source-unavailable");
        return result;
      }
      const page = input.page;
      if (page)
        check(
          fields(page, [
            "resourceId",
            "resourceVersion",
            "viewDigest",
            "afterCursor",
            "throughCursor",
          ]) &&
            page.resourceId === value.resource.id &&
            page.resourceVersion === value.resource.version &&
            page.viewDigest === value.viewDigest &&
            cursor(page.afterCursor) &&
            cursor(page.throughCursor) &&
            page.afterCursor <= page.throughCursor &&
            page.throughCursor <= source.latest,
          "timeline_page_conflict",
        );
      const through = page?.throughCursor ?? source.latest,
        after = page?.afterCursor ?? 0;
      result.source.throughCursor = through;
      const coverage = this.githubCoverage(value.resource.id, value.view);
      if (coverage) result.sourceCoverage = coverage;
      if (source.earliest !== null && after < source.earliest - 1)
        gap("before-retained-cursor");
      const githubScope = result.timeAxis === "reportedAt" ? value.view.scope.resourceIds : [];
      const githubFilter = githubScope.length ?
        " AND CASE WHEN json_valid(json) THEN json_extract(json,'$.providerId')='github' AND json_extract(json,'$.type')='github.commit' AND json_extract(json,'$.resourceId') IN (" +
        githubScope.map(() => "?").join(",") + ") END" : "";
      const rows = this.host.db
        .prepare(
          "SELECT " +
            projection +
            " FROM intelligence_events WHERE cursor>? AND cursor<=?" + githubFilter + " ORDER BY cursor LIMIT ?",
        )
        .all(after, through, ...githubScope, TIMELINE_LIMITS.scan);
      let scanned = after,
        bytes = 0,
        stopped = false;
      for (const row of rows) {
        const raw = row as Record<string, any>,
          header = this.header(raw);
        if (!githubScope.length && scanned && Number(raw.storeCursor) > scanned + 1)
          gap("cursor-discontinuity");
        if (typeof header === "string") {
          gap(header);
          scanned = Number(raw.storeCursor);
          continue;
        }
        const visible = this.visible(header, value.view);
        if (!visible.allowed) {
          if (visible.policy) gap("access-filtered");
          scanned = header.cursor;
          continue;
        }
        const externalEvidence = githubEvidence(raw.externalEvidence, header);
        const timestamp = result.timeAxis === "reportedAt" ? externalEvidence?.reportedAt : header.receivedAt;
        if (!timestamp) {
          gap("reported-time-unavailable");
          scanned = header.cursor;
          continue;
        }
        const time = Date.parse(timestamp);
        if (time < Date.parse(value.view.viewport.from) || time >= Date.parse(value.view.viewport.to)) {
          scanned = header.cursor;
          continue;
        }
        const item: RecordedTimelineItem = {
          kind: "recorded-event",
          temporalClass: "historical",
          evidenceClass: header.classification,
          event: header,
          source: {
            store: "intelligence_events",
            cursor: header.cursor,
            eventId: header.eventId,
            schemaVersion: 1,
          },
          navigation: visible.resource
            ? { resourceId: visible.resource.id, state: visible.resource.state }
            : null,
          ...(externalEvidence ? { externalEvidence } : {}),
          taskVerification: "not-established-by-this-projection",
        };
        // Reserve bounded envelope/gap/page metadata inside the total response cap.
        const size = Buffer.byteLength(stable(item));
        if (
          items.length === (input.limit ?? 100) ||
          bytes + size > TIMELINE_LIMITS.windowBytes - 8192
        ) {
          stopped = true;
          break;
        }
        items.push(item);
        bytes += size;
        scanned = header.cursor;
      }
      if (
        stopped ||
        (rows.length === TIMELINE_LIMITS.scan && scanned < through)
      ) {
        gap("scan-limit");
        result.coverage.matchingItems = "bounded";
        result.next = {
          resourceId: value.resource.id,
          resourceVersion: value.resource.version,
          viewDigest: value.viewDigest,
          afterCursor: scanned,
          throughCursor: through,
        };
      } else if (!githubScope.length && scanned < through) gap("cursor-discontinuity");
      const latest = this.source();
      result.source.observedLatestCursor = latest?.latest ?? null;
      result.hasNewEvents = latest ? latest.latest > through : null;
      return result;
    });
  }
}
