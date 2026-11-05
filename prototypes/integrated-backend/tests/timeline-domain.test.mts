import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { WorkspaceKernel } from "../../workspace-kernel/kernel.mts";
import { DesktopState } from "../src/desktop.mts";
import {
  compositeTimelineDomain,
  isTimelineRead,
  type TimelineDomainOptions,
} from "../src/timeline-domain.mts";
import type {
  TimelineView,
  TimelineEventHeader,
} from "../../timeline-product/contracts.ts";

const view = (patch: Partial<TimelineView> = {}): TimelineView => ({
  schemaVersion: 1,
  mode: "activity",
  scope: { projectId: null, resourceIds: [] },
  sources: {
    providerIds: [],
    eventTypes: ["synthetic.source-event"],
    classifications: ["observed", "reported", "inferred", "simulated"],
  },
  viewport: {
    from: "2026-11-02T00:00:00.000Z",
    to: "2026-11-03T00:00:00.000Z",
    displayTimeZone: "UTC",
  },
  selection: null,
  ...structuredClone(patch),
});
function fixture(t: any, path = ":memory:") {
  const kernel = WorkspaceKernel.open(path),
    db = kernel.withTransaction((db) => db);
  new DesktopState(kernel, db);
  const deniedResources = new Set<string>(),
    allowedArchived = new Set<string>(),
    deniedProjects = new Set<string>(),
    deniedEvents = new Set<string>();
  let failEvent = false,
    allowGlobal = true;
  const source = () =>
    db.exec(
      "CREATE TABLE IF NOT EXISTS intelligence_events(cursor INTEGER PRIMARY KEY AUTOINCREMENT,dedupe TEXT NOT NULL UNIQUE,json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS integration_meta(id INTEGER PRIMARY KEY CHECK(id=1),latest INTEGER NOT NULL); INSERT OR IGNORE INTO integration_meta VALUES(1,0);",
    );
  const insert = (
    patch: Partial<TimelineEventHeader>,
    payload: unknown = { redacted: true, delta: "SYNTHETIC_SOURCE_BODY" },
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
      type: "synthetic.source-event",
      classification: "observed",
      status: null,
      ...patch,
    };
    header.cursor = Number(
      db
        .prepare("INSERT INTO intelligence_events(dedupe,json) VALUES(?,?)")
        .run(header.eventId, "{}").lastInsertRowid,
    );
    db.prepare("UPDATE intelligence_events SET json=? WHERE cursor=?").run(
      JSON.stringify({ ...header, payload }),
      header.cursor,
    );
    db.prepare("UPDATE integration_meta SET latest=? WHERE id=1").run(
      header.cursor,
    );
    return header;
  };
  const options: TimelineDomainOptions = {
    kernel,
    db,
    projectAccess: (id) =>
      !deniedProjects.has(id) &&
      !!db
        .prepare("SELECT 1 FROM projects WHERE id=? AND state='active'")
        .get(id),
    resourceAccess: (id) => {
      const r = db.prepare("SELECT state FROM resources WHERE id=?").get(id);
      return (
        !!r &&
        !deniedResources.has(id) &&
        (r.state === "active" || allowedArchived.has(id))
      );
    },
    eventAccess: (header) =>
      !deniedEvents.has(header.eventId) &&
      (header.resourceId !== null || allowGlobal),
    recordEvent(event) {
      // Synthetic Core-adjacent adapter fixture: detached metadata goes directly
      // into the SAME existing stream schema inside the caller's transaction.
      insert(
        {
          resourceId: event.resourceId,
          providerId: "aerynth-native",
          providerInstanceId: "aerynth-native",
          connectionId: "aerynth-native",
          type: event.type,
          correlationId: event.commandId,
          receivedAt: new Date().toISOString(),
        },
        {
          redacted: true,
          application: {
            resourceVersion: event.resourceVersion,
            commandId: event.commandId,
            detail: event.detail,
          },
        },
      );
      if (failEvent)
        throw Error("synthetic_timeline_event_failure_after_sql_write");
    },
  };
  const domain = compositeTimelineDomain(options);
  const create = (
    value = view(),
    commandId: string = randomUUID(),
    projectId: string | null = null,
  ) =>
    domain.dispatch({
      name: "create",
      input: {
        commandId,
        title: "Synthetic canonical Timeline",
        projectId,
        view: value,
      },
    });
  const query = (r: { resourceId: string; version: number }) =>
    domain.dispatch({
      name: "query",
      input: { resourceId: r.resourceId, expectedVersion: r.version },
    });
  const count = (table: string) =>
    Number(db.prepare("SELECT count(*) AS n FROM " + table).get()!.n);
  const tables = () =>
    db
      .prepare(
        "SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all();
  let closed = false;
  const close = () => {
    if (!closed) {
      kernel.close();
      closed = true;
    }
  };
  t.after(close);
  return {
    kernel,
    db,
    options,
    domain,
    create,
    query,
    count,
    tables,
    close,
    source,
    insert,
    deniedResources,
    deniedProjects,
    deniedEvents,
    allowedArchived,
    failEvent: (v = true) => {
      failEvent = v;
    },
    allowGlobal: (v: boolean) => {
      allowGlobal = v;
    },
  };
}

test("exact typed public names and unknown reads reject without DDL, reflection or phantom resources", (t) => {
  const f = fixture(t),
    before = f.tables(),
    changes = f.db.prepare("SELECT total_changes() AS n").get()!.n;
  for (const value of [
    null,
    {},
    { name: "constructor", input: {} },
    { name: "Read", input: {} },
    { name: "read", input: { resourceId: "missing", authorized: true } },
    { name: "read", input: { resourceId: "missing" }, handler: "save" },
  ])
    assert.throws(() => f.domain.dispatch(value as any), /invalid_timeline/);
  assert.throws(
    () => f.domain.dispatch({ name: "read", input: { resourceId: "missing" } }),
    /timeline_unavailable/,
  );
  assert.throws(
    () =>
      f.domain.dispatch({
        name: "query",
        input: { resourceId: "missing", expectedVersion: 1 },
      }),
    /timeline_unavailable/,
  );
  assert.deepEqual(f.tables(), before);
  assert.equal(f.db.prepare("SELECT total_changes() AS n").get()!.n, changes);
  assert.equal(f.count("resources"), 0);
  assert.equal(
    isTimelineRead({ name: "read", input: { resourceId: "missing" } }),
    true,
  );
  assert.equal(isTimelineRead({ name: "query", input: {} }), true);
  for (const value of [
    null,
    { name: "Read", input: {} },
    { name: "save", input: {} },
    { name: "create", input: {} },
    { name: "constructor", input: {} },
    { name: "read", input: {}, authority: true },
  ])
    assert.equal(isTimelineRead(value), false);
});

test("same canonical connection, desktop FK projection and all current-policy callbacks are mandatory", (t) => {
  const f = fixture(t),
    other = new DatabaseSync(":memory:");
  t.after(() => other.close());
  assert.throws(
    () => compositeTimelineDomain({ ...f.options, db: other }),
    /timeline_canonical_connection_required/,
  );
  for (const key of [
    "projectAccess",
    "resourceAccess",
    "eventAccess",
    "recordEvent",
  ] as const)
    assert.throws(
      () => compositeTimelineDomain({ ...f.options, [key]: undefined }),
      /timeline_domain_host_required/,
    );
  const kernel = WorkspaceKernel.open(":memory:");
  t.after(() => kernel.close());
  const db = kernel.withTransaction((db) => db);
  assert.throws(
    () => compositeTimelineDomain({ ...f.options, kernel, db }),
    /timeline_canonical_projection_required/,
  );
  db.exec(
    "CREATE TABLE desktop_resources(resource_id TEXT PRIMARY KEY,kind TEXT)",
  );
  assert.throws(
    () => compositeTimelineDomain({ ...f.options, kernel, db }),
    /timeline_canonical_projection_required/,
  );
  db.exec(
    "DROP TABLE desktop_resources; CREATE TABLE desktop_resources(resource_id TEXT REFERENCES resources(id),kind TEXT NOT NULL)",
  );
  assert.throws(
    () => compositeTimelineDomain({ ...f.options, kernel, db }),
    /timeline_canonical_projection_required/,
    "a nonunique semantic mapping is not the canonical projection",
  );
  assert.equal(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE name='timeline_schema'")
      .get(),
    undefined,
  );
});

test("zero-workspace create is generic plus semantic Timeline with one detached metadata event and idempotent receipt", (t) => {
  const f = fixture(t),
    before = Date.now(),
    created = f.create(view(), "synthetic:create-once"),
    after = Date.now();
  assert.deepEqual(
    ["resources", "notes", "conversation_refs", "workspaces", "blocks"].map(
      f.count,
    ),
    [1, 0, 0, 0, 0],
  );
  assert.equal(
    f.db
      .prepare("SELECT kind FROM resources WHERE id=?")
      .get(created.resourceId)!.kind,
    "generic",
  );
  assert.equal(
    f.db
      .prepare("SELECT kind FROM desktop_resources WHERE resource_id=?")
      .get(created.resourceId)!.kind,
    "timeline",
  );
  const rows = f.db.prepare("SELECT json FROM intelligence_events").all();
  assert.equal(rows.length, 1);
  const event = JSON.parse(String(rows[0]!.json));
  assert.equal(event.type, "timeline.created");
  assert.equal(event.resourceId, created.resourceId);
  assert.equal(event.classification, "observed");
  assert.equal(event.providerId, "aerynth-native");
  for (const key of [
    "executionId",
    "threadId",
    "turnId",
    "nativeEventId",
    "nativeSequence",
    "providerTime",
  ])
    assert.equal(event[key], null);
  assert(
    Date.parse(event.receivedAt) >= before &&
      Date.parse(event.receivedAt) <= after,
  );
  assert.deepEqual(event.payload.application, {
    resourceVersion: 1,
    commandId: "synthetic:create-once",
    detail: {
      actorKind: "user",
      authority: "manual",
      principalId: "local-owner",
      policyVersion: "aerynth.local-owner@1",
      mode: "activity",
      scopeKind: "application",
      resourceCount: 0,
    },
  });
  assert(
    !JSON.stringify(event).includes("Synthetic canonical Timeline"),
    "event has no title/body",
  );
  assert.deepEqual(f.create(view(), "synthetic:create-once"), created);
  assert.equal(f.count("resources"), 1);
  assert.equal(f.count("intelligence_events"), 1);
  assert.equal(f.count("timeline_receipts"), 1);
});

test("real SQLite query preserves native/time references, is payload-free and does not mutate source or canonical state", (t) => {
  const f = fixture(t),
    note = f.kernel.createNote("Synthetic source", "SYNTHETIC_NOTE_BODY");
  const event = f.insert({
    resourceId: note.id,
    executionId: "synthetic:execution",
    threadId: "synthetic:native-thread",
    turnId: "synthetic:native-turn",
    nativeEventId: "synthetic:native-event",
    nativeSequence: 7,
    receivedAt: "2026-11-02T12:12:12.345Z",
    providerTime: 1793621532340,
    providerTimeSource: "synthetic-provider-clock",
    classification: "reported",
    status: "provider_completed",
  });
  const created = f.create(
    view({
      mode: "execution",
      scope: { projectId: null, resourceIds: [note.id] },
      selection: { eventId: event.eventId, cursor: event.cursor },
    }),
  );
  const before = f.domain.dispatch({
      name: "read",
      input: { resourceId: created.resourceId },
    }),
    source = f.db.prepare("SELECT * FROM intelligence_events").all(),
    changes = f.db.prepare("SELECT total_changes() AS n").get()!.n;
  const prepare = f.db.prepare.bind(f.db);
  f.db.prepare = ((sql: string) => {
    if (/FROM\s+intelligence_events/i.test(sql))
      assert(!/\$\.payload|SELECT\s+(?:\*|json)(?:\s|,)/i.test(sql));
    return prepare(sql);
  }) as typeof f.db.prepare;
  let result;
  try {
    result = f.query(created);
  } finally {
    f.db.prepare = prepare;
  }
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.items[0]!.event, event);
  assert.equal(result.items[0]!.evidenceClass, "reported");
  assert.equal(
    result.items[0]!.taskVerification,
    "not-established-by-this-projection",
  );
  assert.deepEqual(result.items[0]!.navigation, {
    resourceId: note.id,
    state: "active",
  });
  assert(!JSON.stringify(result).includes("SYNTHETIC_SOURCE_BODY"));
  assert(!JSON.stringify(result).includes("SYNTHETIC_NOTE_BODY"));
  assert.deepEqual(
    f.db.prepare("SELECT * FROM intelligence_events").all(),
    source,
  );
  assert.equal(f.db.prepare("SELECT total_changes() AS n").get()!.n, changes);
  assert.deepEqual(
    f.domain.dispatch({
      name: "read",
      input: { resourceId: created.resourceId },
    }),
    before,
  );
  assert.equal(f.count("workspaces"), 0);
  assert.equal(f.count("blocks"), 0);
});

test("canonical save CAS, pan/timezone/selection and exact stream state survive a fresh same-file restart", (t) => {
  const dir = resolve(".runtime/timeline-domain-tests", randomUUID());
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, "canonical.sqlite"),
    f = fixture(t, path),
    created = f.create();
  const event = f.insert({ executionId: "synthetic:execution" });
  const changed = view({
    mode: "execution",
    viewport: {
      from: "2026-11-02T11:00:00.000Z",
      to: "2026-11-02T13:00:00.000Z",
      displayTimeZone: "America/New_York",
    },
    selection: { eventId: event.eventId, cursor: event.cursor },
  });
  const save = {
      commandId: "synthetic:save-once",
      resourceId: created.resourceId,
      expectedVersion: 1,
      view: changed,
    },
    saved = f.domain.dispatch({ name: "save", input: save });
  assert.equal(saved.version, 2);
  assert.notEqual(saved.viewDigest, created.viewDigest);
  assert.deepEqual(f.domain.dispatch({ name: "save", input: save }), saved);
  const competing = compositeTimelineDomain(f.options);
  assert.throws(
    () =>
      competing.dispatch({
        name: "save",
        input: { ...save, commandId: "synthetic:competing" },
      }),
    /timeline_version_conflict/,
  );
  const before = f.domain.dispatch({
      name: "read",
      input: { resourceId: created.resourceId },
    }),
    window = f.query(saved),
    rows = f.db.prepare("SELECT * FROM intelligence_events").all();
  f.close();
  const reopened = fixture(t, path);
  assert.deepEqual(
    reopened.domain.dispatch({
      name: "read",
      input: { resourceId: created.resourceId },
    }),
    before,
  );
  assert.deepEqual(reopened.query(saved), window);
  assert.deepEqual(
    reopened.db.prepare("SELECT * FROM intelligence_events").all(),
    rows,
  );
  assert.deepEqual(
    reopened.domain.dispatch({ name: "save", input: save }),
    saved,
  );
  assert.equal(reopened.count("resources"), 1);
  assert.equal(reopened.count("workspaces"), 0);
});

test("current canonical scope/event policies reject revoked sources, archived sources unless explicitly allowed and fabricated semantic mappings", (t) => {
  const f = fixture(t),
    project = f.kernel.createProject("Synthetic project"),
    note = f.kernel.createNote("Synthetic scoped source", "", project.id);
  const event = f.insert({ resourceId: note.id }),
    created = f.create(
      view({ scope: { projectId: project.id, resourceIds: [note.id] } }),
      "synthetic:scoped",
      project.id,
    );
  assert.equal(f.query(created).items.length, 1);
  f.deniedResources.add(note.id);
  assert.throws(() => f.query(created), /timeline_scope_unavailable/);
  f.deniedResources.clear();
  f.kernel.setResourceArchived(note.id, true, 1);
  assert.throws(() => f.query(created), /timeline_scope_unavailable/);
  f.allowedArchived.add(note.id);
  assert.deepEqual(f.query(created).items[0]!.navigation, {
    resourceId: note.id,
    state: "archived",
  });
  f.deniedEvents.add(event.eventId);
  const redacted = f.query(created);
  assert.deepEqual(redacted.items, []);
  assert(redacted.gaps.some((g) => g.reason === "access-filtered"));
  assert(!JSON.stringify(redacted).includes(event.eventId));
  f.deniedProjects.add(project.id);
  assert.throws(() => f.query(created), /timeline_unavailable/);
  f.deniedProjects.clear();
  f.deniedResources.add(created.resourceId);
  assert.throws(
    () =>
      f.domain.dispatch({
        name: "read",
        input: { resourceId: created.resourceId },
      }),
    /timeline_unavailable/,
  );
  f.deniedResources.clear();
  f.kernel.setResourceArchived(note.id, false, 2);
  f.db
    .prepare("INSERT INTO desktop_resources(resource_id,kind) VALUES(?,?)")
    .run(note.id, "timeline");
  assert.throws(
    () => f.domain.dispatch({ name: "read", input: { resourceId: note.id } }),
    /timeline_unavailable/,
    "semantic timeline never promotes a canonical Note",
  );
  assert.throws(
    () => f.create(view(), "synthetic:no-project", "not-a-project"),
    /timeline_scope_unavailable/,
  );
});

test("unscoped event policy is mandatory and frozen query pages recheck it without new-source broadening", (t) => {
  const f = fixture(t),
    first = f.insert({}),
    second = f.insert({}),
    created = f.create();
  const page = f.domain.dispatch({
    name: "query",
    input: { resourceId: created.resourceId, expectedVersion: 1, limit: 1 },
  });
  assert.deepEqual(
    page.items.map((item) => item.event.eventId),
    [first.eventId],
  );
  assert(page.next);
  f.insert({});
  f.deniedEvents.add(second.eventId);
  const next = f.domain.dispatch({
    name: "query",
    input: {
      resourceId: created.resourceId,
      expectedVersion: 1,
      page: page.next,
      limit: 1,
    },
  });
  assert.deepEqual(next.items, []);
  assert.equal(next.hasNewEvents, true);
  assert(next.gaps.some((g) => g.reason === "access-filtered"));
  f.allowGlobal(false);
  const hidden = f.query(created);
  assert.equal(hidden.items.length, 0);
  const denied = compositeTimelineDomain({
    ...f.options,
    eventAccess: () => {
      throw Error("synthetic_policy_failure");
    },
  });
  assert.equal(
    denied.dispatch({
      name: "query",
      input: { resourceId: created.resourceId, expectedVersion: 1 },
    }).items.length,
    0,
  );
});

test("inside-transaction event failure and outer rollback leave no schema/resource/stream/receipt; same adapter can retry", (t) => {
  const f = fixture(t),
    tables = f.tables();
  f.failEvent();
  assert.throws(
    () => f.create(view(), "synthetic:retry"),
    /synthetic_timeline_event_failure/,
  );
  assert.deepEqual(f.tables(), tables);
  assert.equal(f.count("resources"), 0);
  f.failEvent(false);
  assert.throws(
    () =>
      f.kernel.withTransaction(() => {
        f.create(view(), "synthetic:retry");
        throw Error("synthetic_outer_failure");
      }),
    /synthetic_outer_failure/,
  );
  assert.deepEqual(f.tables(), tables);
  assert.equal(f.count("resources"), 0);
  const created = f.create(view(), "synthetic:retry"),
    before = f.domain.dispatch({
      name: "read",
      input: { resourceId: created.resourceId },
    }),
    rows = f.db.prepare("SELECT * FROM intelligence_events").all();
  f.failEvent();
  assert.throws(
    () =>
      f.domain.dispatch({
        name: "save",
        input: {
          commandId: "synthetic:failed-save",
          resourceId: created.resourceId,
          expectedVersion: 1,
          view: view({ mode: "execution" }),
        },
      }),
    /synthetic_timeline_event_failure/,
  );
  assert.deepEqual(
    f.domain.dispatch({
      name: "read",
      input: { resourceId: created.resourceId },
    }),
    before,
  );
  assert.deepEqual(
    f.db.prepare("SELECT * FROM intelligence_events").all(),
    rows,
  );
  assert.equal(f.count("timeline_receipts"), 1);
});

test("fresh service on every dispatch rejects future/partial Timeline schema and unsupported modes without resetting storage", (t) => {
  const f = fixture(t),
    created = f.create(),
    tables = f.tables();
  f.db.prepare("UPDATE timeline_schema SET version=99").run();
  assert.throws(
    () =>
      f.domain.dispatch({
        name: "read",
        input: { resourceId: created.resourceId },
      }),
    /timeline_unsupported_schema/,
  );
  assert.throws(() => f.create(), /timeline_unsupported_schema/);
  assert.deepEqual(f.tables(), tables);
  f.db.prepare("UPDATE timeline_schema SET version=1").run();
  f.db.exec("DROP TABLE timeline_receipts");
  assert.throws(() => f.query(created), /timeline_partial_schema/);
  assert.equal(
    f.db
      .prepare("SELECT 1 FROM sqlite_master WHERE name='timeline_receipts'")
      .get(),
    undefined,
  );
  const clean = fixture(t);
  assert.throws(
    () => clean.create(view({ mode: "replay" as any })),
    /timeline_invalid_view/,
  );
  assert.equal(clean.count("resources"), 0);
  assert(
    !clean.tables().some((row) => String(row.name).startsWith("timeline_")),
  );
});

test('planning dispatch shares canonical transaction, exact read classification and authorization', t => {
  const f = fixture(t), made = f.create();
  const values = { title: 'Synthetic plan', startAt: '2026-11-05T12:00:00.000Z', durationMs: 60000, timeZone: 'UTC', laneId: '' };
  const command = { name: 'planning' as const, input: { op: 'create' as const, resourceId: made.resourceId, expectedVersion: 1, commandId: 'boundary-plan', values } };
  assert.equal(isTimelineRead(command), false);
  assert.equal(isTimelineRead({ name: 'planning', input: { op: 'list', resourceId: made.resourceId, expectedVersion: 1 } }), true);
  f.failEvent(); assert.throws(() => f.domain.dispatch(command), /synthetic/);
  assert.equal(f.db.prepare('SELECT version FROM timeline_schema').get()!.version, 1);
  f.failEvent(false);
  const result = f.domain.dispatch(command) as import('../../timeline-product/contracts.ts').TimelinePlanningMutationResult;
  assert.equal(result.version, 2);
  const listed = f.domain.dispatch({ name: 'planning', input: { op: 'list', resourceId: made.resourceId, expectedVersion: 2 } }) as import('../../timeline-product/contracts.ts').TimelinePlanningDocument;
  assert.equal(listed.items[0]!.id, result.item!.id);
  f.deniedResources.add(made.resourceId); assert.throws(() => f.domain.dispatch(command), /timeline_unavailable/);
});

import { createRequire } from 'node:module';
test('native planning list is read-only admission and canonical planning writes use the existing product transport', async () => {
  const { isProductRead, productCommand } = createRequire(import.meta.url)('../../visual-experience/cinematic-v3/native/product-commands.cjs');
  const calls: unknown[] = [];
  const call = async (...args: unknown[]) => { calls.push(args); return 'canonical-ack'; };
  const listing = { name: 'planning', input: { op: 'list', resourceId: 'fixture', expectedVersion: 1 } };
  assert.equal(isProductRead('timelines', listing), true);
  assert.equal(await productCommand({ family: 'timelines', input: listing, call }), 'canonical-ack');
  for (const op of ['create', 'update', 'delete', 'undo']) {
    const input = { name: 'planning', input: { op } };
    assert.equal(isProductRead('timelines', input), false);
    await productCommand({ family: 'timelines', input, call });
  }
  assert.equal(calls.length, 5);
  assert.equal(isProductRead('timelines', { name: 'planning', input: { op: 'List' } }), false);
});
