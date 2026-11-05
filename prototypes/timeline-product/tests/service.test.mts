import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { WorkspaceKernel } from "../../workspace-kernel/kernel.mts";
import { DesktopState } from "../../integrated-backend/src/desktop.mts";
import { TimelineService, type TimelineHostPort } from "../service.mts";
import {
  TIMELINE_LIMITS,
  type TimelineEventHeader,
  type TimelineResource,
  type TimelineView,
} from "../contracts.ts";

// Synthetic event records in the SAME SQLite schema used by BackendCore. No
// provider, native application, imported user history or second event store.
const view = (patch: Partial<TimelineView> = {}): TimelineView => ({
  schemaVersion: 1,
  mode: "activity",
  scope: { projectId: null, resourceIds: [] },
  sources: {
    providerIds: [],
    eventTypes: [],
    classifications: ["observed", "reported", "inferred", "simulated"],
  },
  viewport: {
    from: "2026-11-02T00:00:00.000Z",
    to: "2026-11-03T00:00:00.000Z",
    displayTimeZone: "America/New_York",
  },
  selection: null,
  ...structuredClone(patch),
});
function fixture(t: any, path = ":memory:") {
  const kernel = WorkspaceKernel.open(path),
    db = kernel.withTransaction((db) => db);
  new DesktopState(kernel, db);
  const deniedResources = new Set<string>(),
    deniedProjects = new Set<string>(),
    deniedEvents = new Set<string>();
  let failEvent = false,
    owner = "synthetic-local-owner",
    globalAllowed = true;
  const resource = (resourceId: string): TimelineResource | null => {
    const r = db
      .prepare(
        "SELECT r.*,d.kind AS semantic_kind FROM resources r JOIN desktop_resources d ON r.id=d.resource_id WHERE r.id=?",
      )
      .get(resourceId);
    return r?.semantic_kind === "timeline"
      ? {
          id: String(r.id),
          kind: "timeline",
          title: String(r.title),
          projectId: r.project_id as string | null,
          version: Number(r.version),
          state: r.state as "active" | "archived",
        }
      : null;
  };
  const host: TimelineHostPort = {
    db,
    identity: () => ({
      principalId: owner,
      policyVersion: "synthetic-policy:1",
    }),
    projectAccess: (id) =>
      !deniedProjects.has(id) &&
      !!db
        .prepare("SELECT 1 FROM projects WHERE id=? AND state='active'")
        .get(id),
    resourceAccess: (id) =>
      !deniedResources.has(id) &&
      !!db.prepare("SELECT 1 FROM resources WHERE id=?").get(id),
    eventAccess: (header) => {
      assert(!Object.hasOwn(header, "payload"));
      return (
        !deniedEvents.has(header.eventId) &&
        (header.resourceId !== null || globalAllowed)
      );
    },
    readResource: (id) => {
      const r = resource(id);
      return r
        ? { resource: r, authorized: !deniedResources.has(id), writable: true }
        : null;
    },
    createResource: (input) => {
      const r = kernel.createGenericResource(input.title, input.projectId, {
        origin: "user",
        correlationId: input.commandId,
      });
      db.prepare(
        "INSERT INTO desktop_resources(resource_id,kind) VALUES(?,?)",
      ).run(r.id, "timeline");
      return resource(r.id)!;
    },
    touchResource: (input) => {
      kernel.touchGenericResource(input.resourceId, input.expectedVersion, {
        origin: "user",
        correlationId: input.commandId,
      });
      return resource(input.resourceId)!;
    },
    recordEvent: (e) => {
      // Trusted callback composes canonical metadata inside the SAME transaction.
      // Root maps this to its existing stream + post-commit delivery buffer.
      db.prepare(
        "INSERT INTO change_events(id,entity_kind,entity_id,resource_id,resource_version,occurred_at,origin,correlation_id,type,detail_json) VALUES(?,?,?,?,?,?,?,?,?,?)",
      ).run(
        randomUUID(),
        "timeline",
        e.resourceId,
        e.resourceId,
        e.resourceVersion,
        new Date().toISOString(),
        "user",
        e.commandId,
        e.type,
        JSON.stringify(e.detail),
      );
      if (failEvent) throw Error("synthetic_event_failure_after_write");
    },
  };
  const service = new TimelineService(kernel, host);
  let closed = false;
  const close = () => {
    if (!closed) {
      kernel.close();
      closed = true;
    }
  };
  t.after(close);
  const source = () => {
    db.exec(
      "CREATE TABLE IF NOT EXISTS intelligence_events(cursor INTEGER PRIMARY KEY AUTOINCREMENT,dedupe TEXT NOT NULL UNIQUE,json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS integration_meta(id INTEGER PRIMARY KEY CHECK(id=1),latest INTEGER NOT NULL); INSERT OR IGNORE INTO integration_meta VALUES(1,0);",
    );
  };
  const add = (
    patch: Partial<TimelineEventHeader> = {},
    payload: unknown = { redacted: true, delta: "SYNTHETIC_PRIVATE_PAYLOAD" },
    externalEvidence?: unknown,
  ) => {
    source();
    const header: TimelineEventHeader = {
      schemaVersion: 1,
      eventId: randomUUID(),
      cursor: 0,
      resourceId: null,
      executionId: null,
      providerId: "synthetic-provider",
      providerInstanceId: "synthetic-instance",
      connectionId: "synthetic-connection",
      nativeEventId: null,
      nativeSequence: null,
      threadId: null,
      turnId: null,
      correlationId: null,
      causationId: null,
      receivedAt: "2026-11-02T12:00:00.000Z",
      providerTime: null,
      providerTimeSource: null,
      type: "synthetic.observed",
      classification: "observed",
      status: null,
      ...patch,
    };
    const inserted = db
      .prepare("INSERT INTO intelligence_events(dedupe,json) VALUES(?,?)")
      .run(randomUUID(), "{}");
    header.cursor = Number(inserted.lastInsertRowid);
    db.prepare("UPDATE intelligence_events SET json=? WHERE cursor=?").run(
      JSON.stringify({ ...header, payload, externalEvidence }),
      header.cursor,
    );
    db.prepare("UPDATE integration_meta SET latest=? WHERE id=1").run(
      header.cursor,
    );
    return header;
  };
  const create = (
    value = view(),
    commandId: string = randomUUID(),
    projectId: string | null = null,
  ) =>
    service.create({
      commandId,
      title: "Synthetic timeline",
      projectId,
      view: value,
    });
  const count = (table: string) =>
    Number(db.prepare("SELECT count(*) AS n FROM " + table).get()!.n);
  const tables = () =>
    db
      .prepare(
        "SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all();
  return {
    kernel,
    db,
    host,
    service,
    deniedResources,
    deniedProjects,
    deniedEvents,
    resource,
    source,
    add,
    create,
    count,
    tables,
    close,
    failEvent: (value = true) => {
      failEvent = value;
    },
    owner: (value: string) => {
      owner = value;
    },
    globalAllowed: (value: boolean) => {
      globalAllowed = value;
    },
  };
}
const query = (
  f: ReturnType<typeof fixture>,
  r: { resourceId: string; version: number },
  limit?: number,
) =>
  f.service.query({
    resourceId: r.resourceId,
    expectedVersion: r.version,
    ...(limit === undefined ? {} : { limit }),
  });

test("GitHub-reported time uses the saved scope, preserves capture ordering, and never bypasses source policy", (t) => {
  const f = fixture(t);
  const project = f.kernel.createProject("Synthetic repository project");
  const source = f.kernel.createGenericResource("Synthetic repository source", project.id);
  const scope = { projectId: project.id, resourceIds: [source.id] };
  const sources = { providerIds: ["github"], eventTypes: ["github.commit"], classifications: ["reported"] as const };
  const filters = { ...sources, classifications: [...sources.classifications] };
  const base = { resourceId: source.id, providerId: "github", type: "github.commit", classification: "reported" as const };
  const evidence = (sha: string, time: string) => ({
    kind: "github-commit", title: "Synthetic public commit",
    source: { ref: source.id, label: "synthetic/example", permalink: "https://github.com/synthetic/example/commit/" + sha },
    reportedAt: time, timeSource: "github-committer",
  });
  const add = (sha: string, time: string, data = evidence(sha, time)) =>
    f.add({ ...base, nativeEventId: sha, providerTime: Date.parse(time), providerTimeSource: "github-committer" }, undefined, data);
  const later = add("a".repeat(40), "2026-10-30T12:00:00.000Z");
  const earlier = add("b".repeat(40), "2026-10-30T08:00:00.000Z");
  const spoof = evidence("c".repeat(40), "2026-10-30T09:00:00.000Z");
  spoof.source.permalink = "https://github.com.evil.invalid/commit";
  add("c".repeat(40), spoof.reportedAt, spoof);
  const timeline = f.create(view({
    timeAxis: "reportedAt", scope, sources: filters,
    viewport: { from: "2026-10-30T00:00:00.000Z", to: "2026-10-31T00:00:00.000Z", displayTimeZone: "UTC" },
  }), randomUUID(), project.id);
  const window = query(f, timeline);
  assert.equal(window.timeAxis, "reportedAt");
  assert.equal(window.order, "capture-cursor");
  assert.deepEqual(window.items.map((item) => item.event.eventId), [later.eventId, earlier.eventId]);
  assert.equal(window.items[0]!.event.receivedAt, later.receivedAt);
  assert.deepEqual(window.items[0]!.externalEvidence, evidence("a".repeat(40), "2026-10-30T12:00:00.000Z"));
  assert(window.gaps.some((gap) => gap.reason === "reported-time-unavailable"));
  assert.doesNotMatch(JSON.stringify(window), /SYNTHETIC_PRIVATE_PAYLOAD|evil.invalid/);
  const capture = f.create(view({ scope, sources: filters }), randomUUID(), project.id);
  assert.equal(query(f, capture).timeAxis, "receivedAt");
  assert.equal(query(f, capture).items.length, 3);
  f.deniedEvents.add(later.eventId);
  assert.deepEqual(query(f, timeline).items.map((item) => item.event.eventId), [earlier.eventId]);
  f.deniedResources.add(source.id);
  assert.throws(() => query(f, timeline), /timeline_scope_unavailable/);
});

test("unknown reads do no DDL; explicit creation makes one canonical generic Timeline and no note/chat/workspace/placement", (t) => {
  const f = fixture(t),
    before = f.tables(),
    changes = f.db.prepare("SELECT total_changes() AS n").get()!.n;
  assert.throws(() => f.service.read("missing"), /timeline_unavailable/);
  assert.throws(
    () => f.service.query({ resourceId: "missing", expectedVersion: 1 }),
    /timeline_unavailable/,
  );
  assert.deepEqual(f.tables(), before);
  assert.equal(f.db.prepare("SELECT total_changes() AS n").get()!.n, changes);
  const original = [
    "resources",
    "notes",
    "conversation_refs",
    "workspaces",
    "blocks",
  ].map(f.count);
  const made = f.create();
  assert.deepEqual(
    ["resources", "notes", "conversation_refs", "workspaces", "blocks"].map(
      f.count,
    ),
    [original[0]! + 1, ...original.slice(1)],
  );
  assert.equal(
    f.db.prepare("SELECT kind FROM resources WHERE id=?").get(made.resourceId)!
      .kind,
    "generic",
  );
  assert.equal(
    f.db
      .prepare("SELECT kind FROM desktop_resources WHERE resource_id=?")
      .get(made.resourceId)!.kind,
    "timeline",
  );
  assert.equal(f.count("timeline_views"), 1);
  assert.equal(f.count("timeline_receipts"), 1);
  assert.equal(f.service.read(made.resourceId).viewDigest, made.viewDigest);
  assert.equal(query(f, made).source.state, "unavailable");
  assert.equal(
    f.db
      .prepare("SELECT 1 FROM sqlite_master WHERE name='intelligence_events'")
      .get(),
    undefined,
    "query never initializes ingestion",
  );
  assert.equal(query(f, made).gaps[0]!.reason, "source-unavailable");
});

test("same-connection, schema version, partial schema and host authorization checks fail closed without resets", (t) => {
  const f = fixture(t),
    foreign = new DatabaseSync(":memory:");
  t.after(() => foreign.close());
  assert.throws(
    () => new TimelineService(f.kernel, { ...f.host, db: foreign }),
    /timeline_canonical_connection_required/,
  );
  assert.throws(
    () =>
      new TimelineService(f.kernel, {
        ...f.host,
        eventAccess: undefined as any,
      }),
    /timeline_host_required/,
  );
  const made = f.create(),
    tables = f.tables();
  f.db.prepare("UPDATE timeline_schema SET version=99").run();
  assert.throws(
    () => new TimelineService(f.kernel, f.host),
    /timeline_unsupported_schema/,
  );
  assert.throws(
    () => f.service.read(made.resourceId),
    /timeline_unsupported_schema/,
  );
  assert.deepEqual(f.tables(), tables);
  f.db.prepare("UPDATE timeline_schema SET version=1").run();
  f.db.exec("DROP TABLE timeline_receipts");
  assert.throws(
    () => new TimelineService(f.kernel, f.host),
    /timeline_partial_schema/,
  );
  assert.equal(
    f.db
      .prepare("SELECT 1 FROM sqlite_master WHERE name='timeline_receipts'")
      .get(),
    undefined,
  );
});

test("canonical factory cannot adopt an existing resource and mutations roll back resource/schema/receipts/event writes", (t) => {
  const f = fixture(t),
    create = {
      commandId: "create-once",
      title: "Synthetic timeline",
      projectId: null,
      view: view(),
    };
  f.failEvent();
  assert.throws(
    () => f.service.create(create),
    /synthetic_event_failure_after_write/,
  );
  assert.equal(f.count("resources"), 0);
  assert.equal(f.count("change_events"), 0);
  assert(!f.tables().some((r) => String(r.name).startsWith("timeline_")));
  f.failEvent(false);
  const made = f.service.create(create),
    before = f.service.read(made.resourceId),
    events = f.count("change_events");
  f.failEvent();
  assert.throws(
    () =>
      f.service.save({
        commandId: "save-once",
        resourceId: made.resourceId,
        expectedVersion: 1,
        view: view({ mode: "execution" }),
      }),
    /synthetic_event_failure_after_write/,
  );
  assert.deepEqual(f.service.read(made.resourceId), before);
  assert.equal(f.count("change_events"), events);
  assert.equal(f.count("timeline_receipts"), 1);
  f.failEvent(false);
  const adopted = new TimelineService(f.kernel, {
    ...f.host,
    createResource: () => f.resource(made.resourceId)!,
  });
  assert.throws(
    () => adopted.create({ ...create, commandId: "adopt-existing" }),
    /timeline_canonical_factory_required/,
  );
  assert.equal(f.count("resources"), 1);
});

test("create/save are idempotent, CAS fenced and metadata-only; changed command content and stale pages reject", (t) => {
  const f = fixture(t),
    command = "create-idempotent",
    made = f.create(view(), command),
    events = f.count("change_events");
  assert.deepEqual(f.create(view(), command), made);
  assert.equal(f.count("change_events"), events);
  assert.throws(
    () => f.create(view({ mode: "execution" }), command),
    /timeline_command_conflict/,
  );
  const next = view({
    viewport: {
      from: "2026-11-02T11:00:00.000Z",
      to: "2026-11-02T13:00:00.000Z",
      displayTimeZone: "UTC",
    },
  });
  const saved = f.service.save({
    commandId: "pan-once",
    resourceId: made.resourceId,
    expectedVersion: 1,
    view: next,
  });
  assert.equal(saved.version, 2);
  assert.notEqual(saved.viewDigest, made.viewDigest);
  assert.deepEqual(
    f.service.save({
      commandId: "pan-once",
      resourceId: made.resourceId,
      expectedVersion: 1,
      view: next,
    }),
    saved,
  );
  assert.throws(
    () =>
      f.service.save({
        commandId: "old-pan",
        resourceId: made.resourceId,
        expectedVersion: 1,
        view: next,
      }),
    /timeline_version_conflict/,
  );
  assert.throws(() => query(f, made), /timeline_version_conflict/);
  assert.deepEqual(f.service.read(made.resourceId).view, next);
  f.db
    .prepare("UPDATE timeline_receipts SET result_json=? WHERE command_id=?")
    .run('{"resourceId":"other"}', command);
  assert.throws(() => f.create(view(), command), /timeline_receipt_corrupt/);
});

test("same-file restart preserves resource, configuration, event selection and exact timestamps without copying event bodies", (t) => {
  const directory = resolve(".runtime/timeline-product-tests", randomUUID());
  mkdirSync(directory, { recursive: true });
  const file = resolve(directory, "timeline.sqlite"),
    f = fixture(t, file),
    note = f.kernel.createNote("Synthetic source", "not a Timeline copy");
  const event = f.add({
    resourceId: note.id,
    providerTime: 1793620800123,
    providerTimeSource: "synthetic-provider-clock",
    threadId: "native-thread",
    turnId: "native-turn",
    executionId: "native-execution",
  });
  const made = f.create(
    view({
      scope: { projectId: null, resourceIds: [note.id] },
      selection: { eventId: event.eventId, cursor: event.cursor },
    }),
  );
  const before = f.service.read(made.resourceId),
    window = query(f, made),
    sourceRows = f.db
      .prepare("SELECT cursor,dedupe,json FROM intelligence_events")
      .all();
  f.close();
  const reopened = fixture(t, file);
  assert.deepEqual(reopened.service.read(made.resourceId), before);
  assert.deepEqual(query(reopened, made), window);
  assert.deepEqual(
    reopened.db
      .prepare("SELECT cursor,dedupe,json FROM intelligence_events")
      .all(),
    sourceRows,
  );
  assert.equal(window.items[0]!.event.providerTime, event.providerTime);
  assert.equal(window.items[0]!.event.receivedAt, event.receivedAt);
  assert.equal(window.items[0]!.event.threadId, "native-thread");
  assert(
    !JSON.stringify(
      reopened.db.prepare("SELECT * FROM timeline_views").all(),
    ).includes("SYNTHETIC_PRIVATE_PAYLOAD"),
  );
  assert.deepEqual(window.capabilities, {
    planning: false,
    forecasts: false,
    dependencies: false,
    stateReconstruction: false,
    reexecution: false,
    export: false,
  });
});

test("pagination freezes capture high-water; new events appear only on a new window and old config tokens reject", (t) => {
  const f = fixture(t),
    first = f.add(),
    second = f.add(),
    made = f.create();
  const page = query(f, made, 1);
  assert.deepEqual(
    page.items.map((i) => i.event.eventId),
    [first.eventId],
  );
  assert(page.next);
  assert.equal(page.next.throughCursor, second.cursor);
  const added = f.add();
  const continuation = f.service.query({
    resourceId: made.resourceId,
    expectedVersion: 1,
    limit: 1,
    page: page.next,
  });
  assert.deepEqual(
    continuation.items.map((i) => i.event.eventId),
    [second.eventId],
  );
  assert.equal(continuation.source.throughCursor, second.cursor);
  assert.equal(continuation.hasNewEvents, true);
  assert.equal(continuation.next, null);
  f.deniedEvents.add(second.eventId);
  const revokedPage = f.service.query({
    resourceId: made.resourceId,
    expectedVersion: 1,
    limit: 1,
    page: page.next,
  });
  assert.deepEqual(
    revokedPage.items,
    [],
    "frozen evidence is not a permission lease",
  );
  assert(revokedPage.gaps.some((g) => g.reason === "access-filtered"));
  f.deniedEvents.clear();
  assert.deepEqual(
    query(f, made).items.map((i) => i.event.eventId),
    [first.eventId, second.eventId, added.eventId],
  );
  const saved = f.service.save({
    commandId: "new-view",
    resourceId: made.resourceId,
    expectedVersion: 1,
    view: view({ mode: "execution" }),
  });
  assert.throws(
    () =>
      f.service.query({
        resourceId: made.resourceId,
        expectedVersion: saved.version,
        page: page.next!,
      }),
    /timeline_page_conflict/,
  );
});

test("revoked explicit scope never broadens into application scope; project association and null-resource boundaries are canonical", (t) => {
  const f = fixture(t),
    project = f.kernel.createProject("Synthetic project"),
    other = f.kernel.createProject("Other project");
  const note = f.kernel.createNote("Scoped", "", project.id),
    foreign = f.kernel.createNote("Foreign", "", other.id);
  const scopedEvent = f.add({ resourceId: note.id }),
    global = f.add(),
    foreignEvent = f.add({ resourceId: foreign.id });
  const made = f.create(
    view({ scope: { projectId: project.id, resourceIds: [note.id] } }),
    "scoped",
    project.id,
  );
  assert.deepEqual(
    query(f, made).items.map((i) => i.event.eventId),
    [scopedEvent.eventId],
  );
  assert(!JSON.stringify(query(f, made)).includes(global.eventId));
  assert(!JSON.stringify(query(f, made)).includes(foreignEvent.eventId));
  f.deniedResources.add(note.id);
  assert.throws(() => query(f, made), /timeline_scope_unavailable/);
  assert.throws(
    () => f.service.read(made.resourceId),
    /timeline_scope_unavailable/,
  );
  f.deniedResources.clear();
  f.deniedProjects.add(project.id);
  assert.throws(() => query(f, made), /timeline_scope_unavailable/);
  f.deniedProjects.clear();
  assert.throws(
    () =>
      f.service.save({
        commandId: "broaden",
        resourceId: made.resourceId,
        expectedVersion: 1,
        view: view(),
      }),
    /timeline_scope_mismatch/,
  );
  assert.throws(
    () =>
      f.create(
        view({ scope: { projectId: project.id, resourceIds: [foreign.id] } }),
        "foreign-scope",
      ),
    /timeline_scope_unavailable/,
  );
});

test("application windows redact revoked events and selection without mutating config; unscoped headers require explicit eventAccess", (t) => {
  const f = fixture(t),
    note = f.kernel.createNote("Synthetic source", ""),
    secret = f.add({ resourceId: note.id }),
    global = f.add();
  const made = f.create(
    view({ selection: { eventId: secret.eventId, cursor: secret.cursor } }),
  );
  const stored = f.db.prepare("SELECT view_json FROM timeline_views").get()!
    .view_json;
  f.deniedResources.add(note.id);
  f.globalAllowed(false);
  const result = query(f, made),
    serialized = JSON.stringify(result);
  assert.equal(result.items.length, 0);
  assert(
    result.gaps.some(
      (g) => g.reason === "access-filtered" && g.cause === "policy",
    ),
  );
  assert(result.selectionUnavailable);
  assert.equal(f.service.read(made.resourceId).view.selection, null);
  assert.equal(
    f.db.prepare("SELECT view_json FROM timeline_views").get()!.view_json,
    stored,
  );
  assert(!serialized.includes(secret.eventId));
  assert(!serialized.includes(note.id));
  assert(!serialized.includes(global.eventId));
  assert(
    result.gaps.every(
      (g) => Object.keys(g).sort().join() === "cause,kind,reason",
    ),
  );
  f.deniedResources.clear();
  f.globalAllowed(true);
  assert.deepEqual(f.service.read(made.resourceId).view.selection, {
    eventId: secret.eventId,
    cursor: secret.cursor,
  });
  const denied = new TimelineService(f.kernel, {
    ...f.host,
    eventAccess: () => {
      throw Error("synthetic_policy_denial");
    },
  });
  assert.equal(
    denied.query({ resourceId: made.resourceId, expectedVersion: 1 }).items
      .length,
    0,
  );
});

test("metadata-only SQL never returns source json or payload; oversize and nonprimitive headers fail as gaps", (t) => {
  const f = fixture(t),
    good = f.add(
      {},
      { redacted: true, delta: "SYNTHETIC_SECRET_" + "x".repeat(1024 * 1024) },
    );
  const malformed = f.add(),
    oversized = f.add();
  f.db
    .prepare(
      "UPDATE intelligence_events SET json=json_set(json,'$.eventId',json('[1,2]')) WHERE cursor=?",
    )
    .run(malformed.cursor);
  f.db
    .prepare(
      "UPDATE intelligence_events SET json=json_set(json,'$.eventId',?) WHERE cursor=?",
    )
    .run("x".repeat(400000), oversized.cursor);
  const made = f.create(),
    original = f.db.prepare.bind(f.db),
    queries: string[] = [];
  f.db.prepare = ((sql: string) => {
    if (/FROM\s+intelligence_events/i.test(sql)) {
      queries.push(sql);
      assert(
        !/\$\.payload|SELECT\s+(?:\*|json)(?:\s|,)/i.test(sql),
        "source read must be a header-only SQL projection",
      );
    }
    return original(sql);
  }) as typeof f.db.prepare;
  try {
    const changes = f.db.prepare("SELECT total_changes() AS n").get()!.n;
    const result = query(f, made);
    assert.equal(
      f.db.prepare("SELECT total_changes() AS n").get()!.n,
      changes,
      "authorized query performs no writes",
    );
    assert.deepEqual(
      result.items.map((i) => i.event.eventId),
      [good.eventId],
    );
    assert(result.gaps.some((g) => g.reason === "invalid-event"));
    assert(!JSON.stringify(result).includes("SYNTHETIC_SECRET"));
    assert(
      Buffer.byteLength(JSON.stringify(result)) <= TIMELINE_LIMITS.windowBytes,
    );
    assert(queries.some((sql) => sql.includes("json_extract")));
  } finally {
    f.db.prepare = original;
  }
});

test("panning, provider/type/classification filters and execution mode preserve captured distinctions without task-success inference", (t) => {
  const f = fixture(t);
  const observed = f.add({
    type: "execution.completed",
    executionId: "execution-1",
    classification: "observed",
    status: "provider_completed",
    receivedAt: "2026-11-02T12:00:00.000Z",
  });
  f.add({
    type: "execution.completed",
    executionId: "execution-2",
    classification: "reported",
    receivedAt: "2026-11-02T13:00:00.000Z",
  });
  f.add({ classification: "inferred", providerId: "other-provider" });
  f.add({ classification: "simulated" });
  const made = f.create();
  assert.deepEqual(
    query(f, made).items.map((i) => i.evidenceClass),
    ["observed", "reported", "inferred", "simulated"],
  );
  const filtered = view({
    mode: "execution",
    sources: {
      providerIds: ["synthetic-provider"],
      eventTypes: ["execution.completed"],
      classifications: ["observed"],
    },
    viewport: {
      from: "2026-11-02T12:00:00.000Z",
      to: "2026-11-02T13:00:00.000Z",
      displayTimeZone: "UTC",
    },
  });
  const saved = f.service.save({
    commandId: "pan-filter",
    resourceId: made.resourceId,
    expectedVersion: 1,
    view: filtered,
  });
  const result = query(f, saved);
  assert.deepEqual(
    result.items.map((i) => i.event.eventId),
    [observed.eventId],
  );
  assert.equal(
    result.items[0]!.taskVerification,
    "not-established-by-this-projection",
  );
  assert.equal(result.items[0]!.event.status, "provider_completed");
  assert.equal(result.timeAxis, "receivedAt");
  assert.equal(result.coverage.allActivity, false);
});

test("retention, ambiguous cursor holes, malformed/future records and lost selections are explicit evidence gaps", (t) => {
  const f = fixture(t),
    one = f.add(),
    two = f.add(),
    three = f.add(),
    future = f.add();
  const made = f.create(
    view({ selection: { eventId: two.eventId, cursor: two.cursor } }),
  );
  f.db
    .prepare("DELETE FROM intelligence_events WHERE cursor IN (?,?)")
    .run(one.cursor, two.cursor);
  f.db
    .prepare(
      "UPDATE intelligence_events SET json=json_set(json,'$.schemaVersion',2) WHERE cursor=?",
    )
    .run(future.cursor);
  f.add();
  const malformed = f.add();
  f.db
    .prepare("UPDATE intelligence_events SET json=? WHERE cursor=?")
    .run("not json", malformed.cursor);
  f.db
    .prepare("DELETE FROM intelligence_events WHERE cursor=?")
    .run(three.cursor + 2);
  const result = query(f, made);
  assert(result.gaps.some((g) => g.reason === "before-retained-cursor"));
  assert(
    result.gaps.some(
      (g) => g.reason === "cursor-discontinuity" && g.cause === "unknown",
    ),
  );
  assert(result.gaps.some((g) => g.reason === "unsupported-event-schema"));
  assert(result.gaps.some((g) => g.reason === "invalid-event"));
  assert(result.gaps.some((g) => g.reason === "selection-unavailable"));
  assert.equal(result.items[0]!.event.eventId, three.eventId);
  assert(!result.gaps.some((g) => JSON.stringify(g).includes("data-loss")));
  f.db.exec("DELETE FROM intelligence_events");
  const empty = query(f, made);
  assert(empty.gaps.some((g) => g.reason === "cursor-discontinuity"));
  assert.equal(empty.source.state, "retained-history");
});

test("scan cap advances frozen pages through nonmatching events instead of claiming complete coverage", (t) => {
  const f = fixture(t);
  f.source();
  f.kernel.withTransaction(() => {
    for (let i = 0; i < TIMELINE_LIMITS.scan + 1; i++) f.add();
  });
  const made = f.create(
    view({
      sources: {
        providerIds: [],
        eventTypes: ["no-match"],
        classifications: ["observed"],
      },
    }),
  );
  const page = query(f, made);
  assert.equal(page.items.length, 0);
  assert.equal(page.coverage.matchingItems, "bounded");
  assert(page.next);
  assert.equal(page.next.afterCursor, TIMELINE_LIMITS.scan);
  const last = f.service.query({
    resourceId: made.resourceId,
    expectedVersion: 1,
    page: page.next,
  });
  assert.equal(last.next, null);
  assert.equal(last.items.length, 0);
  assert.equal(last.coverage.matchingItems, "complete-retained-window");
});

test("response byte cap returns complete header items with monotonic continuation and no truncation", (t) => {
  const f = fixture(t),
    ids: string[] = [];
  f.kernel.withTransaction(() => {
    for (let i = 0; i < 80; i++)
      ids.push(
        f.add({
          providerInstanceId: "i".repeat(500),
          connectionId: "c".repeat(500),
          nativeEventId: "n".repeat(500),
          threadId: "t".repeat(500),
          turnId: "u".repeat(500),
          correlationId: "r".repeat(500),
          causationId: "a".repeat(500),
          executionId: "e".repeat(500),
        }).eventId,
      );
  });
  const made = f.create(),
    first = query(f, made, 200);
  assert(first.items.length > 0 && first.items.length < ids.length);
  assert(first.next);
  assert.equal(first.coverage.matchingItems, "bounded");
  const last = f.service.query({
    resourceId: made.resourceId,
    expectedVersion: 1,
    page: first.next,
    limit: 200,
  });
  assert.equal(last.next, null);
  for (const result of [first, last]) {
    assert(
      Buffer.byteLength(JSON.stringify(result)) <= TIMELINE_LIMITS.windowBytes,
    );
    assert(
      result.items.every(
        (item) => item.event.nativeEventId === "n".repeat(500),
      ),
    );
  }
  assert.deepEqual(
    [...first.items, ...last.items].map((i) => i.event.eventId),
    ids,
  );
});

test("host touch cannot change canonical ownership/title while returning a fabricated old reference", (t) => {
  const f = fixture(t),
    made = f.create(),
    before = f.service.read(made.resourceId),
    project = f.kernel.createProject("Synthetic foreign project");
  const tampered = new TimelineService(f.kernel, {
    ...f.host,
    touchResource(input) {
      const actual = f.host.touchResource(input);
      f.db
        .prepare("UPDATE resources SET project_id=? WHERE id=?")
        .run(project.id, actual.id);
      return actual;
    },
  });
  assert.throws(
    () =>
      tampered.save({
        commandId: "wrong-host-touch",
        resourceId: made.resourceId,
        expectedVersion: 1,
        view: view(),
      }),
    /timeline_canonical_version_required/,
  );
  assert.deepEqual(f.service.read(made.resourceId), before);
  assert.equal(f.count("timeline_receipts"), 1);
});

test("malformed ingestion schema is unavailable and query never repairs or replaces it", (t) => {
  const f = fixture(t),
    made = f.create();
  f.db.exec(
    "CREATE TABLE intelligence_events(cursor INTEGER PRIMARY KEY,dedupe TEXT,json TEXT); CREATE TABLE integration_meta(id INTEGER PRIMARY KEY,future_field TEXT);",
  );
  const before = f.tables(),
    changes = f.db.prepare("SELECT total_changes() AS n").get()!.n;
  const result = query(f, made);
  assert.equal(result.source.state, "unavailable");
  assert.deepEqual(result.items, []);
  assert(result.gaps.some((g) => g.reason === "source-unavailable"));
  assert.deepEqual(f.tables(), before);
  assert.equal(f.db.prepare("SELECT total_changes() AS n").get()!.n, changes);
});

test("invalid/unsupported DTOs, unowned resources and denied canonical targets cannot acquire authority", (t) => {
  const f = fixture(t);
  for (const invalid of [
    view({ mode: "planning" as any }),
    view({ schemaVersion: 2 as any }),
    view({ viewport: { ...view().viewport, displayTimeZone: "not/a-zone" } }),
    { ...view(), surprise: true },
  ])
    assert.throws(() => f.create(invalid as TimelineView), /timeline_invalid/);
  const made = f.create();
  f.owner("another-principal");
  assert.throws(() => f.service.read(made.resourceId), /timeline_unavailable/);
  f.owner("synthetic-local-owner");
  f.deniedResources.add(made.resourceId);
  assert.throws(() => query(f, made), /timeline_unavailable/);
  f.deniedResources.clear();
  const readOnly = new TimelineService(f.kernel, {
    ...f.host,
    readResource: (id) => {
      const entry = f.host.readResource(id);
      return entry && { ...entry, writable: false };
    },
  });
  assert.equal(readOnly.read(made.resourceId).resource.id, made.resourceId);
  assert.equal(readOnly.read(made.resourceId).canEdit, false);
  assert.throws(
    () =>
      readOnly.save({
        commandId: "denied-edit",
        resourceId: made.resourceId,
        expectedVersion: 1,
        view: view(),
      }),
    /timeline_read_only/,
  );
  assert.throws(
    () =>
      f.service.query({
        resourceId: made.resourceId,
        expectedVersion: 1,
        limit: 201,
      }),
    /timeline_invalid_query/,
  );
});

test("canEdit is a fresh explicit host hint from the same authorized read, never stored or trusted for save", (t) => {
  const f = fixture(t),
    made = f.create(),
    before = f.service.read(made.resourceId);
  assert.equal(before.canEdit, true);
  const durable = f.db.prepare("SELECT * FROM timeline_views").all(),
    receipts = f.db.prepare("SELECT * FROM timeline_receipts").all(),
    changes = f.db.prepare("SELECT total_changes() AS n").get()!.n;
  let hint: unknown = false,
    reads = 0;
  const current = new TimelineService(f.kernel, {
    ...f.host,
    readResource(id) {
      reads++;
      const entry = f.host.readResource(id);
      return entry && { ...entry, writable: hint as boolean };
    },
  });
  for (hint of [false, undefined, "true", 1, true, false]) {
    const previousReads = reads,
      document = current.read(made.resourceId);
    assert.equal(
      reads - previousReads,
      1,
      "no second policy read after canonical validation",
    );
    assert.equal(document.canEdit, hint === true);
    assert.deepEqual({ ...document, canEdit: true }, before);
  }
  assert.throws(
    () =>
      current.save({
        commandId: "read-hint-is-not-a-grant",
        resourceId: made.resourceId,
        expectedVersion: 1,
        view: view(),
      }),
    /timeline_read_only/,
  );
  assert.deepEqual(f.db.prepare("SELECT * FROM timeline_views").all(), durable);
  assert.deepEqual(
    f.db.prepare("SELECT * FROM timeline_receipts").all(),
    receipts,
  );
  assert.equal(f.db.prepare("SELECT total_changes() AS n").get()!.n, changes);
  assert.equal(
    f.db.prepare("SELECT version FROM timeline_schema").get()!.version,
    1,
  );
  assert(!JSON.stringify(durable).includes("canEdit"));
  assert(!JSON.stringify(receipts).includes("canEdit"));
});

const planningValues = () => ({ title: 'Synthetic planned work', startAt: '2026-11-01T05:30:00.000Z', durationMs: 3600000, timeZone: 'America/New_York', laneId: 'work' });
test('planning v1 reads do no DDL; canonical CRUD migrates additively without changing immutable source records', t => {
  const f = fixture(t), made = f.create(); f.add();
  const tables = f.tables(), source = f.db.prepare('SELECT * FROM intelligence_events').all();
  assert.deepEqual(f.service.planning({ op: 'list', resourceId: made.resourceId, expectedVersion: 1 }), { resourceId: made.resourceId, resourceVersion: 1, canEdit: true, items: [] });
  assert.deepEqual(f.tables(), tables);
  const create = { op: 'create' as const, commandId: 'planning-create', resourceId: made.resourceId, expectedVersion: 1, values: planningValues() };
  const created = f.service.planning(create) as import('../contracts.ts').TimelinePlanningMutationResult;
  assert.equal(created.version, 2); assert.equal(created.item?.temporalClass, 'planned');
  assert.match(created.item!.id, /^[a-f0-9-]{36}$/); assert.equal(created.item!.version, 2);
  assert.deepEqual(f.service.planning(create), created);
  assert.equal(f.db.prepare('SELECT version FROM timeline_schema').get()!.version, 2);
  const updated = f.service.planning({ op: 'update', commandId: 'planning-update', resourceId: made.resourceId, expectedVersion: 2, itemId: created.item!.id, values: { ...planningValues(), durationMs: 7200000 } }) as import('../contracts.ts').TimelinePlanningMutationResult;
  assert.equal(updated.item!.id, created.item!.id); assert.equal(updated.item!.durationMs, 7200000);
  assert.throws(() => f.service.planning({ ...create, commandId: 'stale-plan' }), /timeline_version_conflict/);
  const deleted = f.service.planning({ op: 'delete', commandId: 'planning-delete', resourceId: made.resourceId, expectedVersion: 3, itemId: created.item!.id }) as import('../contracts.ts').TimelinePlanningMutationResult;
  assert.equal(deleted.item, null); assert.equal(deleted.version, 4);
  const restored = f.service.planning({ op: 'undo', commandId: 'planning-restore', resourceId: made.resourceId, expectedVersion: 4, targetCommandId: 'planning-delete' }) as import('../contracts.ts').TimelinePlanningMutationResult;
  assert.equal(restored.item!.id, created.item!.id); assert.equal(restored.item!.durationMs, 7200000); assert.equal(restored.version, 5);
  assert.deepEqual(f.db.prepare('SELECT * FROM intelligence_events').all(), source);
  assert.equal(f.service.read(made.resourceId).resource.version, 5);
  assert.deepEqual(f.service.planning(create), created, 'Original acknowledgement survives later edits');
});

test('planning undo has item revision fences and never rewinds unrelated edits', t => {
  const f = fixture(t), made = f.create();
  const run = (input: any) => f.service.planning({ resourceId: made.resourceId, ...input }) as import('../contracts.ts').TimelinePlanningMutationResult;
  const a = run({ op: 'create', commandId: 'a', expectedVersion: 1, values: planningValues() });
  const b = run({ op: 'create', commandId: 'b', expectedVersion: 2, values: { ...planningValues(), title: 'Other item' } });
  const undone = run({ op: 'undo', commandId: 'undo-a', expectedVersion: 3, targetCommandId: 'a' });
  assert.equal(undone.item, null);
  const items = f.service.planning({ op: 'list', resourceId: made.resourceId, expectedVersion: 4 }) as import('../contracts.ts').TimelinePlanningDocument;
  assert.deepEqual(items.items.map(item => item.id), [b.item!.id]);
  run({ op: 'update', commandId: 'update-b', expectedVersion: 4, itemId: b.item!.id, values: { ...planningValues(), title: 'Changed' } });
  assert.throws(() => run({ op: 'undo', commandId: 'unsafe-undo-b', expectedVersion: 5, targetCommandId: 'b' }), /timeline_undo_conflict/);
  assert.equal(f.service.read(made.resourceId).resource.version, 5);
});

test('planning accepts exact UTC instants and elapsed DST durations, rejects inferred local time and invalid zones', t => {
  const f = fixture(t), made = f.create();
  const run = (values: any) => f.service.planning({ op: 'create', commandId: randomUUID(), resourceId: made.resourceId, expectedVersion: 1, values });
  for (const startAt of ['2026-11-01T01:30', '2026-03-08T02:30', '2026-11-01T01:30:00.000-04:00'])
    assert.throws(() => run({ ...planningValues(), startAt }), /timeline_planning_utc_instant_required/);
  for (const timeZone of ['not/a-zone', '+01:00']) assert.throws(() => run({ ...planningValues(), timeZone }), /timeline_invalid_timezone/);
  for (const durationMs of [-1, 1.5, Infinity, Number.MAX_SAFE_INTEGER]) assert.throws(() => run({ ...planningValues(), durationMs }), /timeline_invalid_planning_duration/);
  const result = run(planningValues()) as import('../contracts.ts').TimelinePlanningMutationResult;
  assert.equal(result.item!.startAt, '2026-11-01T05:30:00.000Z');
  assert.equal(new Date(Date.parse(result.item!.startAt) + result.item!.durationMs).toISOString(), '2026-11-01T06:30:00.000Z');
});

test('planning migration and mutations roll back on host failure, preserve v1 receipts, and reauthorize retries', t => {
  const f = fixture(t), made = f.create(view(), 'original-create');
  const before = f.tables(); f.failEvent();
  const command = { op: 'create' as const, commandId: 'plan-retry', resourceId: made.resourceId, expectedVersion: 1, values: planningValues() };
  assert.throws(() => f.service.planning(command), /synthetic_event_failure/);
  assert.deepEqual(f.tables(), before); assert.equal(f.service.read(made.resourceId).resource.version, 1);
  f.failEvent(false); const result = f.service.planning(command);
  assert.deepEqual(f.create(view(), 'original-create'), made);
  assert.throws(() => f.service.planning({ ...command, values: { ...planningValues(), title: 'Changed request' } }), /timeline_command_conflict/);
  f.deniedResources.add(made.resourceId); assert.throws(() => f.service.planning(command), /timeline_unavailable/);
  f.deniedResources.clear(); assert.deepEqual(f.service.planning(command), result);
  f.owner('different-owner'); assert.throws(() => f.service.planning({ op: 'list', resourceId: made.resourceId, expectedVersion: 2 }), /timeline_unavailable/);
});

test('planning persists exact items and undo history across same-file restart with read-only authorization', t => {
  const directory = resolve('.runtime/timeline-planning-tests', randomUUID()); mkdirSync(directory, { recursive: true });
  const file = resolve(directory, 'timeline.sqlite'), f = fixture(t, file), made = f.create();
  const command = { op: 'create' as const, commandId: 'durable-plan', resourceId: made.resourceId, expectedVersion: 1, values: planningValues() };
  const created = f.service.planning(command) as import('../contracts.ts').TimelinePlanningMutationResult;
  f.close(); const restored = fixture(t, file);
  const result = restored.service.planning({ op: 'list', resourceId: made.resourceId, expectedVersion: 2 }) as import('../contracts.ts').TimelinePlanningDocument;
  assert.deepEqual(result.items, [created.item]); assert.deepEqual(restored.service.planning(command), created);
  const readOnly = new TimelineService(restored.kernel, { ...restored.host, readResource(id) { const entry = restored.host.readResource(id); return entry && { ...entry, writable: false }; } });
  assert.equal((readOnly.planning({ op: 'list', resourceId: made.resourceId, expectedVersion: 2 }) as import('../contracts.ts').TimelinePlanningDocument).canEdit, false);
  assert.throws(() => readOnly.planning({ op: 'undo', commandId: 'denied-undo', resourceId: made.resourceId, expectedVersion: 2, targetCommandId: command.commandId }), /timeline_read_only/);
  const undone = restored.service.planning({ op: 'undo', commandId: 'durable-undo', resourceId: made.resourceId, expectedVersion: 2, targetCommandId: command.commandId }) as import('../contracts.ts').TimelinePlanningMutationResult;
  assert.equal(undone.item, null); assert.equal(undone.version, 3);
});

test('planning item capacity is bounded including undo tombstones and rejects corruption without schema repair', t => {
  const f = fixture(t), made = f.create();
  const created = f.service.planning({ op: 'create', commandId: 'capacity-seed', resourceId: made.resourceId, expectedVersion: 1, values: planningValues() }) as import('../contracts.ts').TimelinePlanningMutationResult;
  const seed = f.db.prepare('SELECT state_json FROM timeline_planning_items WHERE resource_id=?').get(made.resourceId)!.state_json;
  const insert = f.db.prepare('INSERT INTO timeline_planning_items VALUES(?,?,?)');
  for (let i = 1; i < TIMELINE_LIMITS.planningItems; i++) {
    const state = JSON.parse(String(seed)); state.item.id = 'synthetic-capacity-' + i; state.deleted = true;
    insert.run(made.resourceId, state.item.id, JSON.stringify(state));
  }
  assert.throws(() => f.service.planning({ op: 'create', commandId: 'over-capacity', resourceId: made.resourceId, expectedVersion: 2, values: planningValues() }), /timeline_planning_capacity/);
  assert.equal(f.service.read(made.resourceId).resource.version, 2);
  f.db.prepare('UPDATE timeline_planning_items SET state_json=? WHERE item_id=?').run('{broken', created.item!.id);
  assert.throws(() => f.service.planning({ op: 'list', resourceId: made.resourceId, expectedVersion: 2 }), /timeline_planning_corrupt/);
});


test('optional presentation roundtrips without migration or normalizing old view digests and receipts', t => {
  const directory = resolve('.runtime/timeline-presentation-tests',randomUUID());mkdirSync(directory,{recursive:true});
  const file=resolve(directory,'timeline.sqlite'),f=fixture(t,file),original=view(),made=f.create(original,'old-presentation-create');
  const oldReceipt=f.db.prepare('SELECT result_json FROM timeline_receipts WHERE command_id=?').get('old-presentation-create')!.result_json;
  const read=f.service.read(made.resourceId);assert.equal(Object.hasOwn(read.view,'presentation'),false);assert.equal(read.viewDigest,made.viewDigest);
  const configured={...original,presentation:{orientation:'vertical' as const,detail:'compact' as const}};
  const saved=f.service.save({commandId:'save-presentation',resourceId:made.resourceId,expectedVersion:1,view:configured});
  assert.equal(f.db.prepare('SELECT version FROM timeline_schema').get()!.version,1);
  assert.deepEqual(f.service.read(made.resourceId).view.presentation,configured.presentation);
  assert.deepEqual(f.create(original,'old-presentation-create'),made);
  assert.equal(f.db.prepare('SELECT result_json FROM timeline_receipts WHERE command_id=?').get('old-presentation-create')!.result_json,oldReceipt);
  f.close();const restored=fixture(t,file);assert.deepEqual(restored.service.read(made.resourceId).view.presentation,configured.presentation);
  assert.equal(restored.service.read(made.resourceId).viewDigest,saved.viewDigest);
});

test('presentation validation rejects incomplete, unknown and authority-bearing preferences', t => {
  const f=fixture(t);
  for(const presentation of [undefined,null,{}, {orientation:'diagonal',detail:'compact'}, {orientation:'horizontal',detail:'dense'}, {orientation:'horizontal',detail:'compact',canEdit:true}])
    assert.throws(()=>f.create({...view(),presentation} as any),/timeline_invalid_presentation/);
  for(const orientation of ['horizontal','vertical','multilane'] as const)
    assert.deepEqual(f.service.read(f.create({...view(),presentation:{orientation,detail:'expanded'}}).resourceId).view.presentation,{orientation,detail:'expanded'});
});
