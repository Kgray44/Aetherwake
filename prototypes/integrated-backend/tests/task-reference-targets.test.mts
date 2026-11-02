import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { WorkspaceKernel } from "../../workspace-kernel/kernel.mts";
import { DesktopState } from "../src/desktop.mts";
import { compositeProductDomains } from "../src/product-domains.mts";
import { createTaskObjectiveCommands } from "../src/task-objectives.mts";
import { agentTemplates } from "../../agent-product/service.mts";
import {
  TASK_TARGET_LIMITS as L,
  type TaskTargetQuery,
} from "../../application-contract/task-targets.ts";
import {
  createTaskReferenceTargets,
  type TaskReferenceTargetsOptions,
  type TaskTargetResourceHeader,
  type TaskTargetMessageHeader,
  type TaskTargetExecutionHeader,
} from "../src/task-reference-targets.mts";

const sha = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function fixture(t: any) {
  const kernel = WorkspaceKernel.open(":memory:"),
    db = kernel.withTransaction((db) => db);
  new DesktopState(kernel, db);
  t.after(() => kernel.close());
  const denied = new Set<string>(),
    deniedProjects = new Set<string>(),
    deniedMessages = new Set<string>();
  let principal = "local-owner",
    policyVersion = "synthetic-target-policy:1",
    sourceCalls = 0,
    agentCalls = 0,
    taskCalls = 0,
    executionCalls = 0,
    pageCalls = 0,
    messageCalls = 0,
    catalogCalls = 0;
  const header = (resourceId: string): TaskTargetResourceHeader | null => {
    const r = db
      .prepare(
        "SELECT r.id,r.title,coalesce(d.kind,r.kind) AS kind,r.project_id AS projectId,r.version,r.state FROM resources r LEFT JOIN desktop_resources d ON d.resource_id=r.id WHERE r.id=?",
      )
      .get(resourceId);
    return r ? (r as unknown as TaskTargetResourceHeader) : null;
  };
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
  const messageRows = (resourceId: string) => {
    const exists = db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='integration_state'",
      )
      .get();
    if (!exists) return [];
    return db
      .prepare(
        "SELECT json_extract(m.value,'$.id') AS messageId,json_extract(m.value,'$.resourceId') AS resourceId,json_extract(m.value,'$.role') AS role,json_extract(m.value,'$.createdAt') AS createdAt,json_extract(m.value,'$.sequence') AS sequence FROM integration_state,json_each(integration_state.json,'$.graph.messages') m WHERE integration_state.id=1 AND json_extract(m.value,'$.resourceId')=? ORDER BY json_extract(m.value,'$.sequence') LIMIT ?",
      )
      .all(resourceId, L.scan + 1);
  };
  const resourceAccess = (id: string, messageId?: string) =>
    !!header(id) &&
    !denied.has(id) &&
    (messageId === undefined ||
      (!deniedMessages.has(messageId) &&
        messageRows(id).some((row) => row.messageId === messageId)));
  const projectAccess = (id: string) =>
    !deniedProjects.has(id) &&
    !!db
      .prepare("SELECT 1 FROM projects WHERE id=? AND state='active'")
      .get(id);
  const revision = (resourceId: string, messageId?: string): string | null => {
    if (!resourceAccess(resourceId, messageId)) return null;
    const r = header(resourceId),
      note = db
        .prepare("SELECT revision FROM notes WHERE resource_id=?")
        .get(resourceId);
    const hasState = db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='integration_state'",
      )
      .get();
    const c = hasState
      ? (db
          .prepare(
            "SELECT json_extract(json,?) AS revision FROM integration_state WHERE id=1",
          )
          .get("$.revisions." + JSON.stringify(resourceId))?.revision ?? 0)
      : 0;
    if (messageId) {
      const m = messageRows(resourceId).find((m) => m.messageId === messageId);
      return m
        ? "opaque-message/" +
            sha({ resource: r?.version, conversation: c, metadata: m })
        : null;
    }
    return r
      ? "opaque-resource/" +
          sha({
            resource: r.version,
            content: note?.revision ?? 0,
            conversation: c,
          })
      : null;
  };
  const products = compositeProductDomains({
    kernel,
    db,
    projectAccess,
    resourceAccess,
    catalog: () => {
      catalogCalls++;
      throw Error("forbidden_provider_probe");
    },
    recordEvent: () => {},
  });
  const execution = (executionId: string) => {
    const exists = db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='integration_state'",
      )
      .get();
    if (!exists) return null;
    const r = db
      .prepare(
        "SELECT json_extract(json,?) AS record FROM integration_state WHERE id=1",
      )
      .get("$.executions." + JSON.stringify(executionId));
    if (!r?.record) return null;
    const e = JSON.parse(String(r.record));
    return {
      id: e.id,
      revision: "opaque-execution/" + sha(e),
      resourceId: e.resourceId,
      providerId: e.providerId,
      commandId: e.commandId,
      state: e.state,
      nativeThreadId: e.nativeThreadId,
      nativeTurnId: e.nativeTurnId,
      nativeResponseId: e.nativeResponseId,
    };
  };
  let taskCommands: ReturnType<typeof createTaskObjectiveCommands>;
  const options: TaskReferenceTargetsOptions = {
    kernel,
    db,
    identity: () => ({
      principalId: principal,
      actorKind: "user",
      authority: "manual",
      policyVersion,
    }),
    projectAccess,
    resourceAccess,
    resourcePage: (input) => {
      pageCalls++;
      assert.equal(input.limit, L.scan);
      const rows = db
        .prepare(
          "SELECT r.id,r.title,coalesce(d.kind,r.kind) AS kind,r.project_id AS projectId,r.version,r.state FROM resources r LEFT JOIN desktop_resources d ON d.resource_id=r.id WHERE (?='source' OR ?='assignee' AND d.kind='agent' OR ?='dependency' AND d.kind='task_objective') ORDER BY r.id LIMIT ?",
        )
        .all(input.kind, input.kind, input.kind, input.limit + 1);
      return {
        items: rows.slice(
          0,
          input.limit,
        ) as unknown as TaskTargetResourceHeader[],
        hasMore: rows.length > input.limit,
      };
    },
    sourceRevision: (id, messageId) => {
      sourceCalls++;
      return revision(id, messageId);
    },
    agentProfile: (id) => {
      agentCalls++;
      const a = products.agent({ name: "inspect", input: { resourceId: id } });
      return {
        resourceVersion: a.ref.resourceVersion,
        profileVersion: a.ref.profileVersion,
      };
    },
    task: (id) => {
      taskCalls++;
      const d = taskCommands.dispatch({
        name: "read",
        input: { resourceId: id },
      });
      return {
        resourceId: d.resource.id,
        version: d.resource.version,
        eligible: d.disposition !== "cancelled",
      };
    },
    executionPage: (input) => {
      pageCalls++;
      assert.equal(input.limit, L.scan);
      const exists = db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='integration_state'",
        )
        .get();
      if (!exists) return { items: [], hasMore: false };
      const rows = db
        .prepare(
          "SELECT json_extract(e.value,'$.id') AS id,json_extract(e.value,'$.resourceId') AS resourceId,json_extract(e.value,'$.startedAt') AS startedAt FROM integration_state,json_each(integration_state.json,'$.executions') e WHERE integration_state.id=1 ORDER BY e.key LIMIT ?",
        )
        .all(input.limit + 1);
      return {
        items: rows.slice(0, input.limit).map((row) => ({
          id: String(row.id),
          resourceId: String(row.resourceId),
          startedAt: row.startedAt as string | null,
          revision: execution(String(row.id))!.revision,
        })),
        hasMore: rows.length > input.limit,
      };
    },
    execution: (id) => {
      executionCalls++;
      return execution(id);
    },
    messagePage: (input) => {
      messageCalls++;
      assert.equal(input.limit, L.scan);
      const rows = messageRows(input.conversationResourceId),
        visible = rows.filter((row) =>
          resourceAccess(input.conversationResourceId, String(row.messageId)),
        );
      return {
        items: visible.slice(0, input.limit).map((row) => ({
          messageId: String(row.messageId),
          conversationResourceId: input.conversationResourceId,
          role: row.role as TaskTargetMessageHeader["role"],
          createdAt: String(row.createdAt),
          revision: revision(
            input.conversationResourceId,
            String(row.messageId),
          )!,
        })),
        hasMore: rows.length > input.limit || visible.length < rows.length,
      };
    },
  };
  taskCommands = createTaskObjectiveCommands({
    kernel,
    db,
    identity: options.identity,
    now: () => new Date().toISOString(),
    authorize: () => ({
      decision: "allow",
      authorizationRef: "synthetic-current-local-policy",
      policyVersion,
    }),
    projectAccess,
    resourceAccess,
    sourceRevision: revision,
    agentProfile: options.agentProfile,
    execution: execution,
    recordEvent: () => {},
  });
  const targets = createTaskReferenceTargets(options);
  const note = (title = "Synthetic Note", projectId: string | null = null) =>
    kernel.createNote(title, "SYNTHETIC_NOTE_BODY_NEVER_LABEL", projectId);
  const agent = () =>
    products.agent({
      name: "create",
      input: {
        commandId: randomUUID(),
        title: "Synthetic Agent",
        projectId: null,
        profile: agentTemplates()[0]!.profile,
      },
    });
  const task = () =>
    taskCommands.dispatch({
      name: "create",
      input: {
        commandId: randomUUID(),
        title: "Synthetic Task Objective",
        projectId: null,
        definition: {
          objective: "SYNTHETIC_TASK_BODY_NEVER_LABEL",
          requirements: [],
          assignees: [],
          dependencies: [],
          sources: [],
        },
      },
    });
  const conversation = (title = "Synthetic Conversation") => {
    existing();
    const r = kernel.createConversationRef(title);
    db.prepare(
      "UPDATE integration_state SET json=json_set(json,?,1) WHERE id=1",
    ).run("$.revisions." + JSON.stringify(r.id));
    return r;
  };
  const message = (
    resourceId: string,
    role: TaskTargetMessageHeader["role"] = "assistant",
  ) => {
    existing();
    const id = randomUUID(),
      createdAt = "2026-11-02T23:00:00.000Z",
      sequence = messageRows(resourceId).length + 1;
    db.prepare(
      "UPDATE integration_state SET json=json_insert(json,'$.graph.messages[#]',json(?)) WHERE id=1",
    ).run(
      JSON.stringify({
        id,
        resourceId,
        role,
        createdAt,
        sequence,
        content: "SYNTHETIC_MESSAGE_BODY_NEVER_READ",
      }),
    );
    return {
      messageId: id,
      conversationResourceId: resourceId,
      role,
      createdAt,
      revision: revision(resourceId, id)!,
    };
  };
  const run = (resourceId: string) => {
    existing();
    const id = randomUUID(),
      startedAt = "2026-11-02T23:00:00.000Z";
    db.prepare(
      "UPDATE integration_state SET json=json_set(json,?,json(?)) WHERE id=1",
    ).run(
      "$.executions." + JSON.stringify(id),
      JSON.stringify({
        id,
        resourceId,
        providerId: "synthetic-codex",
        commandId: "synthetic-existing-command",
        state: "unknown",
        nativeThreadId: "synthetic-native-thread",
        nativeTurnId: "synthetic-native-turn",
        nativeResponseId: null,
        startedAt,
      }),
    );
    return { id, resourceId, revision: execution(id)!.revision, startedAt };
  };
  const tables = () =>
    db
      .prepare(
        "SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all();
  const counters = () => ({
    sourceCalls,
    agentCalls,
    taskCalls,
    executionCalls,
    pageCalls,
    messageCalls,
    catalogCalls,
  });
  return {
    kernel,
    db,
    options,
    targets,
    taskCommands,
    products,
    note,
    agent,
    task,
    conversation,
    message,
    run,
    header,
    revision,
    tables,
    counters,
    denied,
    deniedProjects,
    deniedMessages,
    principal: (id: string) => {
      principal = id;
    },
    policy: (v: string) => {
      policyVersion = v;
    },
  };
}

test("empty metadata reads initialize nothing, validate strict bounds and require same-connection/current-policy hosts", (t) => {
  const f = fixture(t),
    tables = f.tables(),
    changes = f.db.prepare("SELECT total_changes() AS n").get()!.n;
  for (const kind of ["source", "dependency", "execution"] as const) {
    const page = f.targets.query({ kind });
    assert.deepEqual(page.items, []);
    assert.equal(page.coverage, "complete");
    assert.equal(page.scan.examined, 0);
  }
  const people = f.targets.query({ kind: "assignee" });
  assert.equal(people.items[0]!.kind, "assignee");
  assert.deepEqual(people.items[0]!.reference, {
    kind: "principal",
    principalId: "local-owner",
  });
  assert.deepEqual(f.tables(), tables);
  assert.equal(f.db.prepare("SELECT total_changes() AS n").get()!.n, changes);
  for (const value of [
    null,
    {},
    { kind: "constructor" },
    { kind: "source", query: "x".repeat(101) },
    { kind: "source", limit: 51 },
    { kind: "source", limit: 0 },
    { kind: "dependency", conversationResourceId: "raw" },
    { kind: "source", authorized: true },
  ])
    assert.throws(
      () => f.targets.query(value as any),
      /task_targets_invalid_query/,
    );
  const other = new DatabaseSync(":memory:");
  t.after(() => other.close());
  assert.throws(
    () => createTaskReferenceTargets({ ...f.options, db: other }),
    /canonical_connection_required/,
  );
  for (const name of [
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
    assert.throws(
      () => createTaskReferenceTargets({ ...f.options, [name]: undefined }),
      /host_required/,
    );
});

test("exact Source refs come from host opaque revisions and labels never include content", (t) => {
  const f = fixture(t),
    n = f.note("Evidence Alpha");
  const page = f.targets.query({ kind: "source", query: "alpha" });
  assert.equal(page.items.length, 1);
  const item = page.items[0]!;
  assert.equal(item.kind, "source");
  assert.deepEqual(item.reference, {
    resourceId: n.id,
    revision: f.revision(n.id),
  });
  assert.equal(item.label, "Evidence Alpha");
  assert.equal(page.referenceOnly, true);
  assert.equal(page.scan.examined, 1);
  assert(!JSON.stringify(page).includes("NEVER_LABEL"));
  const before = item.reference;
  f.kernel.updateNote(n.id, "Changed actual canonical Note", 1);
  const changed = f.targets.query({ kind: "source" });
  assert.notDeepEqual(changed.items[0]!.reference, before);
  assert.deepEqual(changed.items[0]!.reference, {
    resourceId: n.id,
    revision: f.revision(n.id),
  });
  assert.equal(
    f.targets.query({ kind: "source", query: "NEVER_LABEL" }).items.length,
    0,
    "search is metadata only",
  );
});

test("real Agent and Task domain reads produce current typed refs without catalog/provider probes", (t) => {
  const f = fixture(t),
    agent = f.agent(),
    task = f.task();
  const assignees = f.targets.query({
    kind: "assignee",
    query: "Synthetic Agent",
  });
  assert.equal(assignees.items.length, 1);
  assert.deepEqual(assignees.items[0]!.reference, {
    kind: "agent",
    resourceId: agent.agent.resourceId,
    resourceVersion: agent.agent.resourceVersion,
    profileVersion: agent.agent.profileVersion,
  });
  const dependencies = f.targets.query({ kind: "dependency" });
  assert.deepEqual(dependencies.items[0]!.reference, {
    resourceId: task.resourceId,
    version: task.version,
  });
  assert.equal(dependencies.items[0]!.label, "Synthetic Task Objective");
  assert(!JSON.stringify(dependencies).includes("TASK_BODY"));
  f.taskCommands.dispatch({
    name: "mutate",
    input: {
      commandId: randomUUID(),
      resourceId: task.resourceId,
      expectedVersion: task.version,
      operation: { type: "administrativeCancel" },
    },
  });
  assert.deepEqual(f.targets.query({ kind: "dependency" }).items, []);
  assert.equal(f.counters().catalogCalls, 0);
});

test("exact authorized message headers produce only role/time/title and reject stale or foreign headers", (t) => {
  const f = fixture(t),
    c = f.conversation(),
    m = f.message(c.id, "user");
  const page = f.targets.query({
    kind: "source",
    conversationResourceId: c.id,
  });
  assert.equal(page.items.length, 1);
  const item = page.items[0]!;
  assert.deepEqual(item.reference, {
    resourceId: c.id,
    messageId: m.messageId,
    revision: m.revision,
  });
  assert(item.label.includes("user"));
  assert(item.label.includes(m.createdAt));
  assert(!JSON.stringify(page).includes("MESSAGE_BODY"));
  f.db
    .prepare("UPDATE integration_state SET json=json_set(json,?,2) WHERE id=1")
    .run("$.revisions." + JSON.stringify(c.id));
  const stale = createTaskReferenceTargets({
    ...f.options,
    messagePage: () => ({ items: [m], hasMore: false }),
  }).query({ kind: "source", conversationResourceId: c.id });
  assert.deepEqual(stale.items, []);
  assert.equal(stale.coverage, "bounded");
  const other = f.conversation("Foreign Conversation"),
    header = { ...m, conversationResourceId: other.id },
    calls = f.counters().sourceCalls;
  const foreign = createTaskReferenceTargets({
    ...f.options,
    messagePage: () => ({ items: [header], hasMore: false }),
  }).query({ kind: "source", conversationResourceId: c.id });
  assert.equal(f.counters().sourceCalls, calls);
  assert.equal(foreign.scan.examined, 0);
  assert(!JSON.stringify(foreign).includes(other.id));
});

test("existing execution target identity is exact and unknown completion never becomes a task action", (t) => {
  const f = fixture(t),
    chat = f.conversation(),
    e = f.run(chat.id);
  const page = f.targets.query({ kind: "execution" });
  assert.equal(page.items.length, 1);
  const item = page.items[0]!;
  assert.equal(item.kind, "execution");
  assert.deepEqual(item.reference, { id: e.id, revision: e.revision });
  assert(item.label.includes("synthetic-codex"));
  assert(!JSON.stringify(page).includes("native-thread"));
  assert(!JSON.stringify(page).includes("state"));
  assert.equal(page.referenceOnly, true);
  const stale = createTaskReferenceTargets({
    ...f.options,
    executionPage: () => ({
      items: [{ ...e, revision: "stale-but-well-formed" }],
      hasMore: false,
    }),
  }).query({ kind: "execution" });
  assert.deepEqual(stale.items, []);
  assert.equal(stale.coverage, "bounded");
  const foreign = createTaskReferenceTargets({
    ...f.options,
    execution: () => ({ ...f.options.execution(e.id)!, id: randomUUID() }),
  }).query({ kind: "execution" });
  assert.deepEqual(foreign.items, []);
  assert.equal(foreign.coverage, "bounded");
  assert.equal(f.counters().catalogCalls, 0);
});

test("denied/foreign candidates are gated before metadata callbacks and reveal no hidden counts or IDs", (t) => {
  const f = fixture(t),
    project = f.kernel.createProject("Synthetic denied project"),
    hidden = f.note("Private metadata title", project.id),
    allowed = f.note("Allowed metadata");
  const hiddenHeader = f.header(hidden.id)!,
    missing: TaskTargetResourceHeader = {
      ...f.header(allowed.id)!,
      id: "foreign-noncanonical-id",
      title: "Hidden foreign title",
    };
  f.deniedProjects.add(project.id);
  const calls = f.counters().sourceCalls;
  const page = createTaskReferenceTargets({
    ...f.options,
    resourcePage: () => ({ items: [hiddenHeader, missing], hasMore: false }),
  }).query({ kind: "source" });
  assert.deepEqual(page.items, []);
  assert.equal(page.scan.examined, 0);
  assert.equal(page.scan.hasMore, true);
  assert.equal(page.coverage, "bounded");
  assert.equal(f.counters().sourceCalls, calls);
  assert(!JSON.stringify(page).includes(hidden.id));
  assert(!JSON.stringify(page).includes(missing.id));
  assert(!JSON.stringify(page).includes("Private metadata title"));
  const a = f.agent();
  f.denied.add(a.agent.resourceId);
  const agentCalls = f.counters().agentCalls;
  assert.deepEqual(
    f.targets.query({ kind: "assignee", query: "Synthetic Agent" }).items,
    [],
  );
  assert.equal(f.counters().agentCalls, agentCalls);
  const chat = f.conversation(),
    e = f.run(chat.id);
  f.denied.add(chat.id);
  const execCalls = f.counters().executionCalls;
  const executions = createTaskReferenceTargets({
    ...f.options,
    executionPage: () => ({ items: [e], hasMore: false }),
  }).query({ kind: "execution" });
  assert.equal(executions.scan.examined, 0);
  assert.equal(f.counters().executionCalls, execCalls);
  const messageCalls = f.counters().messageCalls;
  assert.throws(
    () => f.targets.query({ kind: "source", conversationResourceId: chat.id }),
    /conversation_unavailable/,
  );
  assert.equal(f.counters().messageCalls, messageCalls);
});

test("stale canonical resource headers never invoke reference resolution and unprovable revisions are not inferred", (t) => {
  const f = fixture(t),
    n = f.note(),
    h = f.header(n.id)!;
  f.kernel.renameResource(n.id, "New current title", 1);
  const calls = f.counters().sourceCalls;
  const stale = createTaskReferenceTargets({
    ...f.options,
    resourcePage: () => ({ items: [h], hasMore: false }),
  }).query({ kind: "source" });
  assert.deepEqual(stale.items, []);
  assert.equal(stale.scan.examined, 0);
  assert.equal(f.counters().sourceCalls, calls);
  assert.equal(stale.coverage, "bounded");
  const unavailable = createTaskReferenceTargets({
    ...f.options,
    sourceRevision: () => null,
  }).query({ kind: "source" });
  assert.deepEqual(unavailable.items, []);
  assert.equal(unavailable.coverage, "bounded");
  assert(!JSON.stringify(unavailable).includes(n.id));
});

test("access loss during lookup and current authority changes fail closed with no cached target authority", (t) => {
  const f = fixture(t),
    n = f.note();
  const target = createTaskReferenceTargets({
    ...f.options,
    sourceRevision: (id) => {
      const value = f.revision(id);
      f.denied.add(id);
      return value;
    },
  });
  const page = target.query({ kind: "source" });
  assert.deepEqual(page.items, []);
  assert.equal(page.scan.examined, 0);
  assert.equal(page.coverage, "bounded");
  f.denied.clear();
  assert.equal(f.targets.query({ kind: "source" }).items.length, 1);
  f.denied.add(n.id);
  assert.deepEqual(f.targets.query({ kind: "source" }).items, []);
  f.denied.clear();
  const changed = createTaskReferenceTargets({
    ...f.options,
    resourcePage: (input) => {
      const result = f.options.resourcePage(input);
      f.policy("changed-during-query");
      return result;
    },
  });
  assert.throws(() => changed.query({ kind: "source" }), /authority_changed/);
});

test("bounded pages return default24/max50 whole targets; invalid/unbounded/body-bearing pages fail closed", (t) => {
  const f = fixture(t);
  f.kernel.withTransaction(() => {
    for (let i = 0; i < L.scan + 3; i++) f.note("Synthetic candidate " + i);
  });
  const first = f.targets.query({ kind: "source" });
  assert.equal(first.items.length, L.defaultLimit);
  assert.equal(first.scan.limit, L.scan);
  assert.equal(first.coverage, "bounded");
  const max = f.targets.query({ kind: "source", limit: L.limit });
  assert.equal(max.items.length, L.limit);
  assert(Buffer.byteLength(JSON.stringify(max)) <= L.responseBytes);
  assert(
    max.items.every(
      (item) =>
        item.kind === "source" &&
        item.reference.revision.startsWith("opaque-resource/"),
    ),
  );
  const one = f.header(
    (max.items[0]!.reference as { resourceId: string }).resourceId,
  )!;
  assert.throws(
    () =>
      createTaskReferenceTargets({
        ...f.options,
        resourcePage: () => ({
          items: Array.from({ length: L.scan + 1 }, () => one),
          hasMore: true,
        }),
      }).query({ kind: "source" }),
    /invalid_host_page/,
  );
  let bodyReads = 0;
  const body = Object.defineProperty({ ...one }, "content", {
    enumerable: true,
    get() {
      bodyReads++;
      throw Error("source body read");
    },
  });
  assert.throws(
    () =>
      createTaskReferenceTargets({
        ...f.options,
        resourcePage: () => ({ items: [body], hasMore: false }),
      }).query({ kind: "source" }),
    /invalid_host_page/,
  );
  assert.equal(bodyReads, 0);
  const privateActor = Object.defineProperty(
    { ...f.options.identity() },
    "content",
    {
      enumerable: true,
      get() {
        bodyReads++;
        throw Error("actor body clone");
      },
    },
  );
  assert.throws(
    () =>
      createTaskReferenceTargets({
        ...f.options,
        identity: () => privateActor,
      }).query({ kind: "source" }),
    /task_targets_denied/,
  );
  assert.equal(
    bodyReads,
    0,
    "invalid wider identity objects are rejected before cloning",
  );
});

test("all picker modes are actual read-only SQLite metadata projections with no DDL/provider/source-body materialization", (t) => {
  const f = fixture(t),
    n = f.note(),
    chat = f.conversation();
  f.agent();
  f.task();
  f.message(chat.id);
  f.run(chat.id);
  const tables = f.tables(),
    sourceState = f.db.prepare("SELECT json FROM integration_state").get()!
      .json,
    changes = f.db.prepare("SELECT total_changes() AS n").get()!.n,
    prepare = f.db.prepare.bind(f.db);
  f.db.prepare = ((sql: string) => {
    assert(
      !/SELECT\s+content\s+FROM\s+notes|SELECT\s+json\s+FROM\s+integration_state/i.test(
        sql,
      ),
      "callbacks must read bounded metadata, never whole source bodies/Core state",
    );
    return prepare(sql);
  }) as typeof f.db.prepare;
  try {
    for (const query of [
      { kind: "source" },
      { kind: "source", conversationResourceId: chat.id },
      { kind: "assignee" },
      { kind: "dependency" },
      { kind: "execution" },
    ] satisfies TaskTargetQuery[]) {
      const page = f.targets.query(query);
      assert(page.items.length > 0);
      assert(!JSON.stringify(page).includes("BODY_NEVER"));
      assert.equal(page.referenceOnly, true);
    }
  } finally {
    f.db.prepare = prepare;
  }
  assert.equal(f.db.prepare("SELECT total_changes() AS n").get()!.n, changes);
  assert.deepEqual(f.tables(), tables);
  assert.equal(
    f.db.prepare("SELECT json FROM integration_state").get()!.json,
    sourceState,
  );
  assert.equal(f.counters().catalogCalls, 0);
  assert.equal(
    f.db.prepare("SELECT content FROM notes WHERE resource_id=?").get(n.id)!
      .content,
    "SYNTHETIC_NOTE_BODY_NEVER_LABEL",
  );
});
