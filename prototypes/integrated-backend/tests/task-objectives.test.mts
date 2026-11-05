import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { WorkspaceKernel } from "../../workspace-kernel/kernel.mts";
import { DesktopState } from "../src/desktop.mts";
import { compositeProductDomains } from "../src/product-domains.mts";
import { agentTemplates } from "../../agent-product/service.mts";
import {
  createTaskObjectiveCommands,
  isTaskObjectiveRead,
  type TaskObjectiveCommandsOptions,
  type TaskObjectiveEvent,
} from "../src/task-objectives.mts";
import type {
  TaskDefinition,
  TaskSourceRef,
  TaskExecutionMetadata,
  TaskObjectiveOperation,
  TaskObjectiveReceipt,
} from "../../task-product/contracts.ts";

const definition = (patch: Partial<TaskDefinition> = {}): TaskDefinition => ({
  objective: "Inspect a synthetic artifact",
  requirements: [
    {
      id: "criterion",
      text: "The actual synthetic artifact meets its criterion",
    },
  ],
  assignees: [],
  dependencies: [],
  sources: [],
  ...structuredClone(patch),
});
function fixture(t: any, file = ":memory:") {
  const kernel = WorkspaceKernel.open(file),
    db = kernel.withTransaction((db) => db),
    desktop = new DesktopState(kernel, db);
  const denied = new Set<string>(),
    deniedProjects = new Set<string>(),
    deniedMessages = new Set<string>(),
    deniedOperations = new Set<string>(),
    published: TaskObjectiveEvent[] = [];
  let pending: TaskObjectiveEvent[] | null = null,
    failEvent = false,
    principal = "local-owner",
    clocks = 0,
    sourceReads = 0,
    agentReads = 0,
    executionReads = 0,
    catalogs = 0;
  const metadata = (id: string) =>
    db
      .prepare(
        "SELECT id,kind,project_id,version,state FROM resources WHERE id=?",
      )
      .get(id);
  const resourceAccess = (id: string, messageId?: string) => {
    if (!metadata(id) || denied.has(id)) return false;
    if (messageId === undefined) return true;
    if (deniedMessages.has(messageId)) return false;
    const hasState = db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='integration_state'",
      )
      .get();
    return (
      !!hasState &&
      !!db
        .prepare(
          "SELECT 1 FROM integration_state,json_each(integration_state.json,'$.graph.messages') m WHERE integration_state.id=1 AND json_extract(m.value,'$.id')=? AND json_extract(m.value,'$.resourceId')=?",
        )
        .get(messageId, id)
    );
  };
  const projectAccess = (id: string) =>
    !deniedProjects.has(id) &&
    !!db
      .prepare("SELECT 1 FROM projects WHERE id=? AND state='active'")
      .get(id);
  const products = compositeProductDomains({
    kernel,
    db,
    projectAccess,
    resourceAccess,
    catalog: () => {
      catalogs++;
      throw Error("forbidden_provider_catalog_probe");
    },
    recordEvent: () => {},
  });
  const options: TaskObjectiveCommandsOptions = {
    kernel,
    db,
    identity: () => ({
      principalId: principal,
      actorKind: "user",
      authority: "manual",
      policyVersion: "synthetic-task-policy:1",
    }),
    now: () => {
      clocks++;
      return new Date().toISOString();
    },
    authorize: (input) => ({
      decision: deniedOperations.has(input.operation) ? "deny" : "allow",
      authorizationRef:
        "synthetic-policy:" + input.operation + ":" + input.requestDigest,
      policyVersion: "synthetic-task-policy:1",
    }),
    projectAccess,
    resourceAccess,
    sourceRevision: (resourceId, messageId) => {
      sourceReads++;
      if (!resourceAccess(resourceId, messageId)) return null;
      const r = metadata(resourceId),
        note = db
          .prepare("SELECT revision FROM notes WHERE resource_id=?")
          .get(resourceId);
      if (r?.kind === "conversation") {
        const row = db
          .prepare(
            "SELECT json_extract(json,?) AS revision FROM integration_state WHERE id=1",
          )
          .get("$.revisions." + JSON.stringify(resourceId));
        return typeof row?.revision === "number"
          ? "resource:" + r.version + ":conversation:" + row.revision
          : null;
      }
      return r
        ? "resource:" + r.version + ":content:" + (note?.revision ?? 0)
        : null;
    },
    agentProfile: (resourceId) => {
      agentReads++;
      const profile = products.agent({
        name: "inspect",
        input: { resourceId },
      });
      return {
        resourceVersion: profile.ref.resourceVersion,
        profileVersion: profile.ref.profileVersion,
      };
    },
    execution: (executionId) => {
      executionReads++;
      const hasState = db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='integration_state'",
        )
        .get();
      if (!hasState) return null;
      const row = db
        .prepare(
          "SELECT json_extract(json,?) AS record FROM integration_state WHERE id=1",
        )
        .get("$.executions." + JSON.stringify(executionId));
      return row?.record
        ? ({
            ...JSON.parse(String(row.record)),
            revision: createHash("sha256")
              .update(String(row.record))
              .digest("hex"),
          } as TaskExecutionMetadata)
        : null;
    },
    recordEvent: (event) => {
      assert(
        pending,
        "Root-style outer mutation transaction must own delivery",
      );
      assert.equal(
        db
          .prepare(
            "SELECT version FROM task_objective_documents WHERE resource_id=?",
          )
          .get(event.resourceId)!.version,
        event.resourceVersion,
      );
      db.prepare(
        "INSERT INTO change_events(id,entity_kind,entity_id,resource_id,resource_version,occurred_at,origin,correlation_id,type,detail_json) VALUES(?,?,?,?,?,?,?,?,?,?)",
      ).run(
        randomUUID(),
        "task-objective-adapter",
        event.resourceId,
        event.resourceId,
        event.resourceVersion,
        new Date().toISOString(),
        "user",
        event.commandId,
        event.type,
        JSON.stringify(event.detail),
      );
      pending!.push(structuredClone(event));
      if (failEvent) throw Error("synthetic_event_after_canonical_write");
    },
  };
  const commands = createTaskObjectiveCommands(options);
  // Synthetic Root-style post-commit buffer, backed by the actual Kernel tx.
  // The adapter does NOT implement Root publication or a second event store.
  const outer = <T,>(work: () => T): T => {
    const parent = pending,
      queue: TaskObjectiveEvent[] = [];
    pending = queue;
    let result: T;
    try {
      result = kernel.withTransaction(work);
    } catch (error) {
      pending = parent;
      throw error;
    }
    pending = parent;
    if (parent) parent.push(...queue);
    else published.push(...queue);
    return result;
  };
  const create = (
    value = definition(),
    commandId: string = randomUUID(),
    projectId: string | null = null,
  ) =>
    outer(() =>
      commands.dispatch({
        name: "create",
        input: {
          commandId,
          title: "Synthetic canonical Task Objective",
          projectId,
          definition: value,
        },
      }),
    );
  const mutate = (
    r: Pick<TaskObjectiveReceipt, "resourceId" | "version">,
    operation: TaskObjectiveOperation,
    commandId: string = randomUUID(),
  ) =>
    outer(() =>
      commands.dispatch({
        name: "mutate",
        input: {
          commandId,
          resourceId: r.resourceId,
          expectedVersion: r.version,
          operation,
        },
      }),
    );
  const existing = () => {
    db.exec(
      "CREATE TABLE IF NOT EXISTS integration_state(id INTEGER PRIMARY KEY CHECK(id=1),json TEXT NOT NULL)",
    );
    db.prepare("INSERT OR IGNORE INTO integration_state VALUES(1,?)").run(
      JSON.stringify({
        schemaVersion: 1,
        executions: {},
        graph: { messages: [] },
        revisions: {},
      }),
    );
  };
  const note = (projectId: string | null = null) =>
    kernel.createNote(
      "Synthetic evidence",
      "SYNTHETIC_SOURCE_BODY_NOT_READ",
      projectId,
    );
  const source = (resourceId: string, messageId?: string): TaskSourceRef => ({
    resourceId,
    revision: options.sourceRevision(resourceId, messageId)!,
    ...(messageId ? { messageId } : {}),
  });
  const execution = (
    resourceId: string,
    state: TaskExecutionMetadata["state"] = "provider_completed",
    id: string = randomUUID(),
  ) => {
    existing();
    const e = {
      id,
      resourceId,
      providerId: "synthetic-codex",
      commandId: "synthetic:existing-execution",
      state,
      nativeThreadId: "synthetic-native-thread",
      nativeTurnId: "synthetic-native-turn",
      nativeResponseId: null,
    };
    db.prepare(
      "UPDATE integration_state SET json=json_set(json,?,json(?)) WHERE id=1",
    ).run("$.executions." + JSON.stringify(id), JSON.stringify(e));
    return options.execution(id)!;
  };
  const read = (id: string) =>
    commands.dispatch({ name: "read", input: { resourceId: id } });
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
    desktop,
    options,
    commands,
    products,
    outer,
    create,
    mutate,
    read,
    note,
    source,
    existing,
    execution,
    count,
    tables,
    published,
    denied,
    deniedMessages,
    deniedProjects,
    deniedOperations,
    close,
    failEvent: (v = true) => {
      failEvent = v;
    },
    principal: (v: string) => {
      principal = v;
    },
    counters: () => ({
      clocks,
      sourceReads,
      agentReads,
      executionReads,
      catalogs,
    }),
  };
}

test("strict typed commands/read admission and unknown reads do no DDL or policy/content/provider work", (t) => {
  const f = fixture(t),
    before = f.tables(),
    counters = f.counters(),
    changes = f.db.prepare("SELECT total_changes() AS n").get()!.n;
  assert.deepEqual(f.commands.dispatch({ name: "list", input: {} }), {
    items: [],
    coverage: "complete",
  });
  assert.throws(() => f.read("missing"), /task_unavailable/);
  assert.throws(
    () =>
      f.commands.dispatch({
        name: "history",
        input: { resourceId: "missing" },
      }),
    /task_unavailable/,
  );
  for (const value of [
    null,
    {},
    { name: "constructor", input: {} },
    { name: "Read", input: {} },
    { name: "read", input: { resourceId: "x", authorized: true } },
    { name: "list", input: {}, actor: "user" },
  ])
    assert.throws(
      () => f.commands.dispatch(value as any),
      /invalid_task_objective/,
    );
  for (const name of ["read", "history", "list"])
    assert.equal(isTaskObjectiveRead({ name, input: {} }), true);
  for (const value of [
    null,
    { name: "create", input: {} },
    { name: "mutate", input: {} },
    { name: "List", input: {} },
    { name: "constructor", input: {} },
    { name: "list", input: {}, grant: true },
  ])
    assert.equal(isTaskObjectiveRead(value), false);
  assert.deepEqual(f.tables(), before);
  assert.deepEqual(f.counters(), counters);
  assert.equal(f.db.prepare("SELECT total_changes() AS n").get()!.n, changes);
});

test("same connection, canonical semantic projection and every trusted callback are mandatory", (t) => {
  const f = fixture(t),
    other = new DatabaseSync(":memory:");
  t.after(() => other.close());
  assert.throws(
    () => createTaskObjectiveCommands({ ...f.options, db: other }),
    /task_canonical_connection_required/,
  );
  for (const key of [
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
    assert.throws(
      () => createTaskObjectiveCommands({ ...f.options, [key]: undefined }),
      /task_adapter_host_required/,
    );
  const kernel = WorkspaceKernel.open(":memory:");
  t.after(() => kernel.close());
  const db = kernel.withTransaction((db) => db);
  assert.throws(
    () => createTaskObjectiveCommands({ ...f.options, kernel, db }),
    /task_canonical_projection_required/,
  );
  db.exec(
    "CREATE TABLE desktop_resources(resource_id TEXT REFERENCES resources(id),kind TEXT NOT NULL)",
  );
  assert.throws(
    () => createTaskObjectiveCommands({ ...f.options, kernel, db }),
    /task_canonical_projection_required/,
  );
});

test("zero-workspace create/idempotence is canonical generic only; inside-transaction events publish only after outer commit", (t) => {
  const f = fixture(t);
  let created: TaskObjectiveReceipt;
  f.outer(() => {
    created = f.commands.dispatch({
      name: "create",
      input: {
        commandId: "create-once",
        title: "Synthetic task",
        projectId: null,
        definition: definition(),
      },
    });
    assert.equal(f.published.length, 0);
    assert.equal(f.count("task_objective_documents"), 1);
  });
  assert.equal(f.published.length, 1);
  assert.equal(f.published[0]!.resourceId, created!.resourceId);
  assert.deepEqual(
    ["resources", "notes", "workspaces", "blocks", "conversation_refs"].map(
      f.count,
    ),
    [1, 0, 0, 0, 0],
  );
  assert.equal(
    f.db
      .prepare("SELECT kind FROM resources WHERE id=?")
      .get(created!.resourceId)!.kind,
    "generic",
  );
  assert.equal(
    f.db
      .prepare("SELECT kind FROM desktop_resources WHERE resource_id=?")
      .get(created!.resourceId)!.kind,
    "task_objective",
  );
  assert.equal(f.read(created!.resourceId).verification, "unreviewed");
  assert.equal(f.read(created!.resourceId).canEdit, true);
  assert.deepEqual(
    f.outer(() =>
      f.commands.dispatch({
        name: "create",
        input: {
          commandId: "create-once",
          title: "Synthetic task",
          projectId: null,
          definition: definition(),
        },
      }),
    ),
    created!,
  );
  assert.equal(f.published.length, 1);
  assert.equal(f.counters().clocks, 1);
  assert.equal(f.counters().catalogs, 0);
  assert.equal(f.counters().executionReads, 0);
  assert(!JSON.stringify(f.published).includes("Inspect a synthetic artifact"));
  assert(!JSON.stringify(f.published).includes("actual synthetic artifact"));
});

test("existing Note-backed manual Tasks retain canonical IDs/status/content/history and never become objectives", (t) => {
  const f = fixture(t);
  f.desktop.apply(
    {
      type: "createResource",
      kind: "task",
      title: "Synthetic legacy manual Task",
      workspaceId: null,
    },
    () => {
      throw Error("unexpected_chat");
    },
  );
  const legacy = f.db
    .prepare(
      "SELECT r.id,r.version FROM resources r JOIN desktop_resources d ON r.id=d.resource_id WHERE d.kind='task'",
    )
    .get()!;
  f.desktop.apply(
    {
      type: "taskStatus",
      resourceId: String(legacy.id),
      expectedVersion: Number(legacy.version),
      status: "done",
    },
    () => {
      throw Error("unexpected_chat");
    },
  );
  const row = f.db
      .prepare(
        "SELECT r.*,n.content,n.revision,d.kind,d.metadata_json FROM resources r JOIN notes n ON n.resource_id=r.id JOIN desktop_resources d ON d.resource_id=r.id WHERE r.id=?",
      )
      .get(legacy.id),
    history = f.kernel.listEvents("resource", String(legacy.id));
  const created = f.create();
  assert.throws(() => f.read(String(legacy.id)), /task_unavailable/);
  assert.deepEqual(
    f.db
      .prepare(
        "SELECT r.*,n.content,n.revision,d.kind,d.metadata_json FROM resources r JOIN notes n ON n.resource_id=r.id JOIN desktop_resources d ON d.resource_id=r.id WHERE r.id=?",
      )
      .get(legacy.id),
    row,
  );
  assert.deepEqual(f.kernel.listEvents("resource", String(legacy.id)), history);
  assert.notEqual(created.resourceId, legacy.id);
  assert.equal(f.count("notes"), 1);
  assert.equal(f.count("workspaces"), 0);
  assert.equal(f.count("blocks"), 0);
});

test("actual AgentService profile refs and known principals resolve without catalog probes; denied profiles stop before callback", (t) => {
  const f = fixture(t),
    template = agentTemplates()[0]!.profile,
    agent = f.products.agent({
      name: "create",
      input: {
        commandId: "synthetic:agent",
        title: "Synthetic actual Agent",
        projectId: null,
        profile: template,
      },
    });
  const created = f.create(
    definition({
      assignees: [
        {
          kind: "agent",
          resourceId: agent.agent.resourceId,
          resourceVersion: agent.agent.resourceVersion,
          profileVersion: agent.agent.profileVersion,
        },
        { kind: "principal", principalId: "local-owner" },
      ],
    }),
  );
  assert.equal(f.read(created.resourceId).assignees[0]!.freshness, "current");
  assert.equal(f.counters().catalogs, 0);
  const changed = f.products.agent({
    name: "update",
    input: {
      commandId: "synthetic:agent-edit",
      agent: agent.agent,
      title: "Edited actual Agent",
      profile: { ...template, purpose: "Explicit new profile revision" },
    },
  });
  const projected = f.read(created.resourceId).assignees[0]!;
  assert.equal(projected.freshness, "changed");
  assert.equal(
    projected.current!.kind === "agent" && projected.current!.profileVersion,
    changed.agent.profileVersion,
  );
  f.denied.add(agent.agent.resourceId);
  const calls = f.counters().agentReads;
  assert.equal(f.read(created.resourceId).assignees[0]!.reference, null);
  assert.equal(f.counters().agentReads, calls);
  assert.throws(
    () =>
      f.create(
        definition({
          assignees: [
            { kind: "principal", principalId: "unregistered-person" },
          ],
        }),
      ),
    /task_reference_unavailable_or_stale/,
  );
  assert.equal(f.counters().catalogs, 0);
});

test("real resource/message freshness and canonical project permissions gate before metadata callbacks; no source-body reads", (t) => {
  const f = fixture(t),
    project = f.kernel.createProject("Synthetic project"),
    note = f.note(project.id);
  f.existing();
  const chat = f.kernel.createConversationRef(
    "Synthetic canonical message source",
    project.id,
  );
  f.db
    .prepare(
      "UPDATE integration_state SET json=json_set(json,?,1,'$.graph.messages',json(?)) WHERE id=1",
    )
    .run(
      "$.revisions." + JSON.stringify(chat.id),
      JSON.stringify([
        {
          id: "synthetic:visible-message",
          resourceId: chat.id,
          content: "PRIVATE_SYNTHETIC_CHAT_BODY",
        },
      ]),
    );
  const created = f.create(
    definition({
      sources: [
        f.source(note.id),
        f.source(chat.id, "synthetic:visible-message"),
      ],
    }),
    randomUUID(),
    project.id,
  );
  const prepare = f.db.prepare.bind(f.db),
    changes = f.db.prepare("SELECT total_changes() AS n").get()!.n;
  f.db.prepare = ((sql: string) => {
    assert(
      !/SELECT\s+content\s+FROM\s+notes|SELECT\s+json\s+FROM\s+integration_state/i.test(
        sql,
      ),
    );
    return prepare(sql);
  }) as typeof f.db.prepare;
  try {
    const doc = f.read(created.resourceId);
    assert.equal(doc.sources.length, 2);
    assert(!JSON.stringify(doc).includes("PRIVATE_SYNTHETIC_CHAT_BODY"));
    assert(!JSON.stringify(doc).includes("SYNTHETIC_SOURCE_BODY_NOT_READ"));
  } finally {
    f.db.prepare = prepare;
  }
  assert.equal(f.db.prepare("SELECT total_changes() AS n").get()!.n, changes);
  f.kernel.updateNote(note.id, "Explicit actual source revision", 1);
  assert.equal(f.read(created.resourceId).sources[0]!.freshness, "changed");
  f.deniedMessages.add("synthetic:visible-message");
  const sourceCalls = f.counters().sourceReads;
  const hidden = f.read(created.resourceId);
  assert.equal(hidden.sources[1]!.reference, null);
  assert.equal(
    f.counters().sourceReads,
    sourceCalls + 1,
    "only still-readable Note metadata resolved",
  );
  assert(!JSON.stringify(hidden).includes("synthetic:visible-message"));
  f.deniedProjects.add(project.id);
  assert.throws(() => f.read(created.resourceId), /task_unavailable/);
});

test("existing execution metadata preserves provider/native/unknown truth and never starts work or auto-verifies", (t) => {
  const f = fixture(t),
    chat = f.kernel.createConversationRef("Synthetic execution source"),
    e = f.execution(chat.id),
    created = f.create(),
    linked = f.mutate(created, {
      type: "linkAttempt",
      execution: { id: e.id, revision: e.revision },
    });
  const doc = f.read(created.resourceId);
  assert.equal(
    doc.attempts[0]!.execution.current!.providerId,
    "synthetic-codex",
  );
  assert.equal(
    doc.attempts[0]!.execution.current!.nativeTurnId,
    "synthetic-native-turn",
  );
  assert.equal(doc.attempts[0]!.execution.current!.state, "provider_completed");
  assert.equal(doc.verification, "unreviewed");
  assert.equal(doc.reviews.length, 0);
  assert.equal(doc.acceptance.state, "not-accepted");
  const unknown = f.execution(chat.id, "unknown", e.id),
    original = f.db.prepare("SELECT json FROM integration_state").get()!.json;
  assert.equal(
    f.read(created.resourceId).attempts[0]!.execution.current!.state,
    unknown.state,
  );
  const cancelled = f.mutate(linked, { type: "administrativeCancel" });
  assert.equal(cancelled.executionEffects, "none");
  assert.equal(
    f.db.prepare("SELECT json FROM integration_state").get()!.json,
    original,
  );
  const stored = JSON.stringify(
    f.db.prepare("SELECT data_json FROM task_objective_documents").all(),
  );
  assert(!stored.includes("provider_completed"));
  assert(!stored.includes("synthetic-native-turn"));
  f.denied.add(chat.id);
  assert.equal(
    f.read(created.resourceId).attempts[0]!.execution.reference,
    null,
  );
  assert.equal(f.counters().catalogs, 0);
});

test("CAS/idempotent manual review and owner acceptance survive same-file restart with exact existing execution state", (t) => {
  const dir = resolve(".runtime/task-objectives-tests", randomUUID());
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, "canonical.sqlite"),
    f = fixture(t, path),
    proof = f.note(),
    chat = f.kernel.createConversationRef("Synthetic execution source"),
    e = f.execution(chat.id, "unknown"),
    created = f.create(),
    linked = f.mutate(created, {
      type: "linkAttempt",
      execution: { id: e.id, revision: e.revision },
    });
  const operation: TaskObjectiveOperation = {
    type: "review",
    attemptId: null,
    decision: "verified",
    requirementIds: ["criterion"],
    evidence: [f.source(proof.id)],
    note: "Explicit independent manual inspection",
  };
  const reviewed = f.mutate(linked, operation, "manual-review-once");
  assert.deepEqual(f.mutate(linked, operation, "manual-review-once"), reviewed);
  assert.equal(f.read(created.resourceId).verification, "verified");
  assert.equal(f.read(created.resourceId).acceptance.state, "not-accepted");
  assert.throws(
    () => f.mutate(linked, { type: "administrativeCancel" }),
    /task_version_conflict/,
  );
  const accepted = f.mutate(reviewed, {
      type: "accept",
      reviewIds: [reviewed.createdId!],
    }),
    before = f.read(created.resourceId),
    history = f.commands.dispatch({
      name: "history",
      input: { resourceId: created.resourceId },
    }),
    existing = f.db.prepare("SELECT json FROM integration_state").get()!.json;
  f.close();
  const reopened = fixture(t, path);
  assert.deepEqual(reopened.read(created.resourceId), before);
  assert.deepEqual(
    reopened.commands.dispatch({
      name: "history",
      input: { resourceId: created.resourceId },
    }),
    history,
  );
  assert.equal(reopened.read(created.resourceId).acceptance.state, "valid");
  assert.equal(
    reopened.read(created.resourceId).attempts[0]!.execution.current!.state,
    "unknown",
  );
  assert.equal(
    reopened.db.prepare("SELECT json FROM integration_state").get()!.json,
    existing,
  );
  assert.equal(accepted.executionEffects, "none");
  assert.equal(reopened.published.length, 0);
});

test("event write and outer rollback discard canonical/event/history/receipt changes; fresh per-dispatch services retry safely", (t) => {
  const f = fixture(t),
    before = f.tables();
  f.failEvent();
  assert.throws(
    () => f.create(definition(), "retry-once"),
    /synthetic_event_after_canonical_write/,
  );
  assert.deepEqual(f.tables(), before);
  assert.equal(f.published.length, 0);
  assert.equal(f.count("resources"), 0);
  f.failEvent(false);
  assert.throws(
    () =>
      f.outer(() => {
        f.commands.dispatch({
          name: "create",
          input: {
            commandId: "retry-once",
            title: "Synthetic canonical Task Objective",
            projectId: null,
            definition: definition(),
          },
        });
        throw Error("synthetic_Root_save_failure");
      }),
    /synthetic_Root_save_failure/,
  );
  assert.deepEqual(f.tables(), before);
  assert.equal(f.count("resources"), 0);
  assert.equal(f.published.length, 0);
  const created = f.create(definition(), "retry-once"),
    document = f.read(created.resourceId),
    publications = structuredClone(f.published),
    events = f.db.prepare("SELECT * FROM change_events").all();
  f.failEvent();
  assert.throws(
    () =>
      f.mutate(created, {
        type: "replaceDefinition",
        definition: definition({ objective: "Never committed" }),
      }),
    /synthetic_event_after_canonical_write/,
  );
  assert.deepEqual(f.read(created.resourceId), document);
  assert.deepEqual(f.published, publications);
  assert.deepEqual(f.db.prepare("SELECT * FROM change_events").all(), events);
  assert.equal(f.count("task_objective_receipts"), 1);
});

test("current actor/operation/schema boundaries fail closed without renderer flags or phantom resets", (t) => {
  const f = fixture(t),
    created = f.create();
  f.deniedOperations.add("administrativeCancel");
  assert.throws(
    () => f.mutate(created, { type: "administrativeCancel" }),
    /task_denied/,
  );
  f.deniedOperations.clear();
  f.principal("different-principal");
  assert.throws(() => f.read(created.resourceId), /task_unavailable/);
  assert.equal(
    f.commands.dispatch({ name: "list", input: {} }).items.length,
    0,
  );
  f.principal("local-owner");
  for (const operation of [
    { type: "start" },
    {
      type: "linkAttempt",
      execution: { id: "fake", revision: "fake" },
      authorized: true,
    },
    { type: "administrativeCancel", actor: "user" },
  ])
    assert.throws(() => f.mutate(created, operation as any), /task_invalid/);
  f.db.prepare("UPDATE task_objective_schema SET version=99").run();
  const tables = f.tables();
  assert.throws(() => f.read(created.resourceId), /task_unsupported_schema/);
  assert.throws(() => f.create(), /task_unsupported_schema/);
  assert.deepEqual(f.tables(), tables);
  f.db.prepare("UPDATE task_objective_schema SET version=1").run();
  f.db.exec("DROP TABLE task_objective_receipts");
  assert.throws(
    () => f.commands.dispatch({ name: "list", input: {} }),
    /task_partial_schema/,
  );
  assert.equal(
    f.db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE name='task_objective_receipts'",
      )
      .get(),
    undefined,
  );
});
