import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { WorkspaceKernel } from "../../workspace-kernel/kernel.mts";
import { DesktopState } from "../../integrated-backend/src/desktop.mts";
import { compositeProductDomains } from "../../integrated-backend/src/product-domains.mts";
import { agentTemplates } from "../../agent-product/service.mts";
import { TaskObjectiveService, type TaskObjectiveHost } from "../service.mts";
import {
  TASK_OBJECTIVE_LIMITS as L,
  type TaskDefinition,
  type TaskSourceRef,
  type TaskExecutionMetadata,
  type TaskObjectiveOperation,
  type TaskObjectiveReceipt,
} from "../contracts.ts";

const definition = (patch: Partial<TaskDefinition> = {}): TaskDefinition => ({
  objective: "Deliver a synthetic inspected artifact",
  requirements: [
    {
      id: "criterion-one",
      text: "The synthetic artifact meets its recorded criterion",
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
    deniedOperations = new Set<string>();
  let writable: unknown = true,
    failEvent = false,
    principal = "local-owner";
  const count = (table: string) =>
    Number(db.prepare("SELECT count(*) AS n FROM " + table).get()!.n);
  const tables = () =>
    db
      .prepare(
        "SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all();
  const raw = (id: string) =>
    db
      .prepare(
        "SELECT r.*,d.kind AS semantic_kind FROM resources r LEFT JOIN desktop_resources d ON d.resource_id=r.id WHERE r.id=?",
      )
      .get(id);
  const access = (id: string, messageId?: string) =>
    !!raw(id) &&
    !denied.has(id) &&
    !(messageId && deniedMessages.has(messageId));
  const resource = (id: string) => {
    const r = raw(id);
    return r?.kind === "generic" && r.semantic_kind === "task_objective"
      ? {
          id,
          kind: "task_objective" as const,
          title: String(r.title),
          projectId: r.project_id as string | null,
          version: Number(r.version),
          state: r.state as "active" | "archived",
        }
      : null;
  };
  const existing = () => {
    // Fixture seed of the EXISTING Core state table, not a Task execution store.
    db.exec(
      "CREATE TABLE IF NOT EXISTS integration_state(id INTEGER PRIMARY KEY CHECK(id=1),json TEXT NOT NULL)",
    );
    db.prepare("INSERT OR IGNORE INTO integration_state VALUES(1,?)").run(
      JSON.stringify({
        schemaVersion: 1,
        graph: { messages: [] },
        revisions: {},
        executions: {},
      }),
    );
  };
  const ref = (resourceId: string, messageId?: string): TaskSourceRef => {
    const r = raw(resourceId)!;
    const note = db
      .prepare("SELECT revision FROM notes WHERE resource_id=?")
      .get(resourceId);
    const conversation = db
      .prepare(
        "SELECT json_extract(json,?) AS revision FROM integration_state WHERE id=1",
      )
      .get("$.revisions." + JSON.stringify(resourceId));
    return {
      resourceId,
      revision:
        "resource:" +
        r.version +
        ":content:" +
        (note?.revision ?? conversation?.revision ?? 0),
      ...(messageId ? { messageId } : {}),
    };
  };
  const host: TaskObjectiveHost = {
    db,
    identity: () => ({
      principalId: principal,
      actorKind: "user",
      authority: "manual",
      policyVersion: "synthetic-local-owner:1",
    }),
    now: () => new Date().toISOString(),
    authorize: (input) => ({
      decision: deniedOperations.has(input.operation) ? "deny" : "allow",
      authorizationRef:
        "synthetic-authorization:" +
        input.operation +
        ":" +
        input.requestDigest,
      policyVersion: "synthetic-local-owner:1",
    }),
    projectAccess: (id) =>
      !deniedProjects.has(id) &&
      !!db
        .prepare("SELECT 1 FROM projects WHERE id=? AND state='active'")
        .get(id),
    resourceAccess: access,
    readResource: (id) => {
      const r = resource(id);
      return r
        ? {
            resource: r,
            authorized: !denied.has(id),
            writable: writable as boolean,
          }
        : null;
    },
    createResource: (input) => {
      const r = kernel.createGenericResource(input.title, input.projectId, {
        origin: "user",
        correlationId: input.commandId,
      });
      db.prepare(
        "INSERT INTO desktop_resources(resource_id,kind) VALUES(?,?)",
      ).run(r.id, "task_objective");
      return resource(r.id)!;
    },
    touchResource: (input) => {
      kernel.touchGenericResource(input.resourceId, input.expectedVersion, {
        origin: "user",
        correlationId: input.commandId,
      });
      return resource(input.resourceId)!;
    },
    resolveReference: (reference) => {
      const r = raw(reference.resourceId);
      if (!r || !access(reference.resourceId, reference.messageId)) return null;
      if (reference.messageId) {
        const found = db
          .prepare(
            "SELECT 1 FROM integration_state,json_each(integration_state.json,'$.graph.messages') m WHERE integration_state.id=1 AND json_extract(m.value,'$.id')=? AND json_extract(m.value,'$.resourceId')=?",
          )
          .get(reference.messageId, reference.resourceId);
        if (!found) return null;
      }
      return {
        reference: ref(reference.resourceId, reference.messageId),
        projectId: r.project_id as string | null,
        state: r.state as "active" | "archived",
      };
    },
    resolveAssignee: (reference) => {
      if (reference.kind === "principal")
        return reference.principalId === principal
          ? { reference, projectId: null }
          : null;
      const r = raw(reference.resourceId),
        profile = db
          .prepare(
            "SELECT profile_version FROM agent_product_profiles WHERE resource_id=?",
          )
          .get(reference.resourceId);
      return r?.semantic_kind === "agent" &&
        profile &&
        access(reference.resourceId)
        ? {
            reference: {
              ...reference,
              resourceVersion: Number(r.version),
              profileVersion: Number(profile.profile_version),
            },
            projectId: r.project_id as string | null,
          }
        : null;
    },
    execution: (id) => {
      const row = db
        .prepare(
          "SELECT json_extract(json,?) AS record FROM integration_state WHERE id=1",
        )
        .get("$.executions." + JSON.stringify(id));
      if (!row?.record) return null;
      const e = JSON.parse(String(row.record));
      return {
        ...e,
        revision: createHash("sha256").update(String(row.record)).digest("hex"),
      } as TaskExecutionMetadata;
    },
    recordEvent: (event) => {
      db.prepare(
        "INSERT INTO change_events(id,entity_kind,entity_id,resource_id,resource_version,occurred_at,origin,correlation_id,type,detail_json) VALUES(?,?,?,?,?,?,?,?,?,?)",
      ).run(
        randomUUID(),
        "task-objective",
        event.resourceId,
        event.resourceId,
        event.resourceVersion,
        new Date().toISOString(),
        "user",
        event.commandId,
        event.type,
        JSON.stringify(event.detail),
      );
      if (failEvent) throw Error("synthetic_task_event_failure_after_write");
    },
  };
  const service = new TaskObjectiveService(kernel, host);
  const create = (
    value = definition(),
    commandId: string = randomUUID(),
    projectId: string | null = null,
  ) =>
    service.create({
      commandId,
      title: "Synthetic Task Objective",
      projectId,
      definition: value,
    });
  const mutate = (
    r: Pick<TaskObjectiveReceipt, "resourceId" | "version">,
    operation: TaskObjectiveOperation,
    commandId: string = randomUUID(),
  ) =>
    service.mutate({
      commandId,
      resourceId: r.resourceId,
      expectedVersion: r.version,
      operation,
    });
  const note = (
    content = "SYNTHETIC_EVIDENCE_BODY",
    projectId: string | null = null,
  ) => {
    existing();
    return kernel.createNote("Synthetic source/evidence", content, projectId);
  };
  const execution = (
    resourceId: string,
    state: TaskExecutionMetadata["state"] = "provider_completed",
    id: string = randomUUID(),
  ) => {
    existing();
    const record = {
      id,
      resourceId,
      providerId: "synthetic-codex",
      commandId: "synthetic-provider-command",
      state,
      nativeThreadId: "synthetic-native-thread",
      nativeTurnId: "synthetic-native-turn",
      nativeResponseId: null,
    };
    db.prepare(
      "UPDATE integration_state SET json=json_set(json,?,json(?)) WHERE id=1",
    ).run("$.executions." + JSON.stringify(id), JSON.stringify(record));
    return host.execution(id)!;
  };
  const review = (
    r: Pick<TaskObjectiveReceipt, "resourceId" | "version">,
    evidence: TaskSourceRef[],
    ids = ["criterion-one"],
  ) =>
    mutate(r, {
      type: "review",
      attemptId: null,
      decision: "verified",
      requirementIds: ids,
      evidence,
      note: "Explicit synthetic manual inspection, not provider self-assessment",
    });
  const events = () =>
    db
      .prepare(
        "SELECT * FROM change_events WHERE entity_kind='task-objective' ORDER BY rowid",
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
    host,
    service,
    create,
    mutate,
    note,
    ref,
    execution,
    review,
    existing,
    resource,
    raw,
    count,
    tables,
    events,
    denied,
    deniedProjects,
    deniedMessages,
    deniedOperations,
    close,
    writable: (v: unknown) => {
      writable = v;
    },
    failEvent: (v = true) => {
      failEvent = v;
    },
    principal: (v: string) => {
      principal = v;
    },
  };
}

test("empty list and unknown reads do no DDL; same-connection/host/schema checks fail closed", (t) => {
  const f = fixture(t),
    before = f.tables(),
    changes = f.db.prepare("SELECT total_changes() AS n").get()!.n;
  assert.deepEqual(f.service.list(), { items: [], coverage: "complete" });
  assert.throws(() => f.service.read("missing"), /task_unavailable/);
  assert.throws(
    () => f.service.history({ resourceId: "missing" }),
    /task_unavailable/,
  );
  assert.deepEqual(f.tables(), before);
  assert.equal(f.db.prepare("SELECT total_changes() AS n").get()!.n, changes);
  const other = new DatabaseSync(":memory:");
  t.after(() => other.close());
  assert.throws(
    () => new TaskObjectiveService(f.kernel, { ...f.host, db: other }),
    /task_canonical_connection_required/,
  );
  assert.throws(
    () =>
      new TaskObjectiveService(f.kernel, {
        ...f.host,
        authorize: undefined as any,
      }),
    /task_host_required/,
  );
  const made = f.create();
  f.db.prepare("UPDATE task_objective_schema SET version=2").run();
  const tables = f.tables();
  assert.throws(
    () => f.service.read(made.resourceId),
    /task_unsupported_schema/,
  );
  assert.throws(() => f.service.list(), /task_unsupported_schema/);
  assert.deepEqual(f.tables(), tables);
  f.db.prepare("UPDATE task_objective_schema SET version=1").run();
  f.db.exec("DROP TABLE task_objective_receipts");
  assert.throws(
    () => new TaskObjectiveService(f.kernel, f.host),
    /task_partial_schema/,
  );
});

test("canonical Task Objective is generic, independent and preserves actual Note-backed legacy manual Task IDs/content/status/history", (t) => {
  const f = fixture(t);
  f.desktop.apply(
    {
      type: "createResource",
      kind: "task",
      title: "Legacy manual Task",
      workspaceId: null,
    },
    () => {
      throw Error("unexpected_conversation_creation");
    },
  );
  const legacy = f.db
    .prepare(
      "SELECT r.*,n.content,n.revision,d.kind AS semantic_kind,d.metadata_json FROM resources r JOIN notes n ON n.resource_id=r.id JOIN desktop_resources d ON d.resource_id=r.id WHERE d.kind='task'",
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
      throw Error("unexpected_conversation_creation");
    },
  );
  const before = f.db
      .prepare(
        "SELECT r.*,n.content,n.revision,d.kind AS semantic_kind,d.metadata_json FROM resources r JOIN notes n ON n.resource_id=r.id JOIN desktop_resources d ON d.resource_id=r.id WHERE r.id=?",
      )
      .get(legacy.id),
    oldHistory = f.kernel.listEvents("resource", String(legacy.id));
  assert.throws(() => f.service.read(String(legacy.id)), /task_unavailable/);
  const made = f.create(),
    current = f.service.read(made.resourceId);
  assert.equal(current.resource.kind, "task_objective");
  assert.equal(f.raw(made.resourceId)!.kind, "generic");
  assert.equal(current.canEdit, true);
  assert.deepEqual(
    [
      f.count("resources"),
      f.count("notes"),
      f.count("conversation_refs"),
      f.count("workspaces"),
      f.count("blocks"),
    ],
    [2, 1, 0, 0, 0],
  );
  assert.deepEqual(
    f.db
      .prepare(
        "SELECT r.*,n.content,n.revision,d.kind AS semantic_kind,d.metadata_json FROM resources r JOIN notes n ON n.resource_id=r.id JOIN desktop_resources d ON d.resource_id=r.id WHERE r.id=?",
      )
      .get(legacy.id),
    before,
  );
  assert.deepEqual(
    f.kernel.listEvents("resource", String(legacy.id)),
    oldHistory,
  );
  assert.equal(current.verification, "unreviewed");
  assert.equal(current.acceptance.state, "not-accepted");
});

test("CAS, idempotence and attribution use canonical versions; external title-only changes preserve domain history", (t) => {
  const f = fixture(t),
    made = f.create(definition(), "create-once"),
    count = f.events().length;
  assert.deepEqual(f.create(definition(), "create-once"), made);
  assert.equal(f.events().length, count);
  assert.throws(
    () =>
      f.create(definition({ objective: "Different request" }), "create-once"),
    /task_command_conflict/,
  );
  const renamed = f.kernel.renameResource(
    made.resourceId,
    "Renamed canonical objective",
    made.version,
  );
  assert.equal(
    f.service.read(made.resourceId).resource.version,
    renamed.version,
  );
  assert.equal(f.service.read(made.resourceId).lastMutationVersion, 1);
  const op: TaskObjectiveOperation = {
    type: "replaceDefinition",
    definition: definition({ objective: "Explicit changed objective" }),
  };
  assert.throws(() => f.mutate(made, op), /task_version_conflict/);
  const updated = f.mutate(
    { resourceId: made.resourceId, version: renamed.version },
    op,
    "edit-once",
  );
  assert.equal(updated.version, 3);
  assert.equal(updated.definitionVersion, 2);
  assert.deepEqual(
    f.mutate(
      { resourceId: made.resourceId, version: renamed.version },
      op,
      "edit-once",
    ),
    updated,
  );
  assert.deepEqual(
    f.service
      .history({ resourceId: made.resourceId })
      .items.map((v) => v.version),
    [1, 3],
  );
  const event = JSON.parse(String(f.events().at(-1)!.detail_json));
  assert.equal(event.actor.authority, "manual");
  assert.equal(event.actor.actorKind, "user");
  assert.equal(event.actor.principalId, "local-owner");
  assert(!JSON.stringify(f.events()).includes("Explicit changed objective"));
  assert(!JSON.stringify(f.events()).includes("recorded criterion"));
});

test("real existing execution references never store execution state and provider completion cannot verify or accept", (t) => {
  const f = fixture(t),
    chat = f.kernel.createConversationRef("Synthetic existing chat"),
    execution = f.execution(chat.id),
    made = f.create();
  const before = f.db.prepare("SELECT json FROM integration_state").get()!.json;
  const linked = f.mutate(made, {
    type: "linkAttempt",
    execution: { id: execution.id, revision: execution.revision },
  });
  const doc = f.service.read(made.resourceId);
  assert.equal(doc.attempts[0]!.execution.current!.state, "provider_completed");
  assert.equal(
    doc.attempts[0]!.execution.current!.providerId,
    "synthetic-codex",
  );
  assert.equal(
    doc.attempts[0]!.execution.current!.nativeThreadId,
    "synthetic-native-thread",
  );
  assert.equal(doc.attempts[0]!.relation, "user-linked-existing-execution");
  assert.equal(doc.verification, "unreviewed");
  assert.equal(doc.acceptance.state, "not-accepted");
  assert.equal(doc.reviews.length, 0);
  assert.throws(
    () =>
      f.mutate(linked, {
        type: "accept",
        reviewIds: ["fabricated-verification"],
      }),
    /task_invalid_acceptance/,
  );
  assert.throws(
    () =>
      f.mutate(linked, {
        type: "linkAttempt",
        execution: { id: execution.id, revision: execution.revision },
      }),
    /task_invalid_attempt/,
  );
  assert.throws(
    () =>
      f.mutate(linked, {
        type: "linkAttempt",
        execution: { id: "missing-execution", revision: "invented" },
      }),
    /task_execution_unavailable_or_stale/,
  );
  const stored = JSON.stringify(
    f.db.prepare("SELECT data_json FROM task_objective_documents").all(),
  );
  assert(!stored.includes("provider_completed"));
  assert(!stored.includes("synthetic-native-thread"));
  assert(!stored.includes("synthetic-codex"));
  assert.equal(
    f.db.prepare("SELECT json FROM integration_state").get()!.json,
    before,
  );
});

test("manual verification and acceptance remain separate; later contradictory reviews and definition revisions cannot be bypassed", (t) => {
  const f = fixture(t),
    evidence = f.note(),
    made = f.create(),
    verified = f.review(made, [f.ref(evidence.id)]);
  assert.equal(f.service.read(made.resourceId).verification, "verified");
  assert.equal(
    f.service.read(made.resourceId).acceptance.state,
    "not-accepted",
  );
  const failed = f.mutate(verified, {
    type: "review",
    attemptId: null,
    decision: "needs-work",
    requirementIds: [],
    evidence: [f.ref(evidence.id)],
    note: "Later synthetic whole-objective check failed",
  });
  assert.equal(f.service.read(made.resourceId).verification, "needs-work");
  assert.throws(
    () =>
      f.mutate(failed, { type: "accept", reviewIds: [verified.createdId!] }),
    /task_verification_required/,
  );
  const reverified = f.review(failed, [f.ref(evidence.id)]),
    accepted = f.mutate(reverified, {
      type: "accept",
      reviewIds: [reverified.createdId!],
    });
  assert.equal(f.service.read(made.resourceId).disposition, "accepted");
  assert.equal(f.service.read(made.resourceId).acceptance.state, "valid");
  assert.throws(
    () =>
      f.mutate(accepted, {
        type: "replaceDefinition",
        definition: definition(),
      }),
    /task_invalid_transition/,
  );
  const reopened = f.mutate(accepted, { type: "reopen" }),
    changed = f.mutate(reopened, {
      type: "replaceDefinition",
      definition: definition(),
    });
  assert.equal(f.service.read(made.resourceId).verification, "unreviewed");
  assert.equal(f.service.read(made.resourceId).acceptance.state, "historical");
  assert.throws(
    () =>
      f.mutate(changed, { type: "accept", reviewIds: [reverified.createdId!] }),
    /task_invalid_acceptance/,
  );
});

test("source/evidence changes and revocation invalidate current acceptance without rewriting recorded decisions or exposing denied IDs", (t) => {
  const f = fixture(t),
    source = f.note("SYNTHETIC_SOURCE"),
    evidence = f.note("SYNTHETIC_PROOF"),
    made = f.create(definition({ sources: [f.ref(source.id)] })),
    reviewed = f.review(made, [f.ref(evidence.id)]),
    accepted = f.mutate(reviewed, {
      type: "accept",
      reviewIds: [reviewed.createdId!],
    });
  const stored = f.db
    .prepare("SELECT data_json FROM task_objective_documents")
    .get()!.data_json;
  f.kernel.updateNote(source.id, "Changed actual source", 1);
  let doc = f.service.read(made.resourceId);
  assert.equal(doc.sources[0]!.freshness, "changed");
  assert.equal(doc.verification, "stale");
  assert.equal(doc.acceptance.state, "stale");
  assert.equal(doc.disposition, "accepted");
  f.denied.add(evidence.id);
  doc = f.service.read(made.resourceId);
  assert.equal(doc.acceptance.state, "unavailable");
  assert.equal(doc.reviews[0]!.evidence[0]!.reference, null);
  assert(!JSON.stringify(doc).includes(evidence.id));
  assert.equal(
    f.db.prepare("SELECT data_json FROM task_objective_documents").get()!
      .data_json,
    stored,
  );
  const historical = f.service.history({ resourceId: accepted.resourceId });
  assert(!JSON.stringify(historical).includes(evidence.id));
  f.denied.add(made.resourceId);
  assert.throws(() => f.service.read(made.resourceId), /task_unavailable/);
  assert.deepEqual(f.service.list().items, []);
});

test("current execution revisions preserve interrupted/unknown outcomes; administrative cancellation has zero execution effects", (t) => {
  const f = fixture(t),
    chat = f.kernel.createConversationRef("Synthetic existing chat"),
    e = f.execution(chat.id, "running"),
    made = f.create(),
    linked = f.mutate(made, {
      type: "linkAttempt",
      execution: { id: e.id, revision: e.revision },
    });
  const unknown = f.execution(chat.id, "unknown", e.id),
    doc = f.service.read(made.resourceId);
  assert.equal(doc.attempts[0]!.execution.freshness, "changed");
  assert.equal(doc.attempts[0]!.execution.current!.state, "unknown");
  assert.equal(doc.verification, "unreviewed");
  const evidence = f.note();
  assert.throws(
    () =>
      f.mutate(linked, {
        type: "review",
        attemptId: linked.createdId!,
        executionRevision: e.revision,
        decision: "verified",
        requirementIds: ["criterion-one"],
        evidence: [f.ref(evidence.id)],
        note: "Stale revision is not a proof",
      }),
    /task_execution_unavailable_or_stale/,
  );
  const before = f.db.prepare("SELECT json FROM integration_state").get()!.json,
    cancelled = f.mutate(linked, { type: "administrativeCancel" });
  assert.equal(cancelled.executionEffects, "none");
  assert.equal(f.service.read(made.resourceId).disposition, "cancelled");
  assert.equal(
    f.service.read(made.resourceId).attempts[0]!.execution.current!.state,
    unknown.state,
  );
  assert.equal(
    f.db.prepare("SELECT json FROM integration_state").get()!.json,
    before,
  );
  f.execution(chat.id, "interrupted", e.id);
  assert.equal(
    f.service.read(made.resourceId).attempts[0]!.execution.current!.state,
    "interrupted",
  );
});

test("dependency references gate acceptance, detect cycles and propagate stale upstream evidence transitively", (t) => {
  const f = fixture(t),
    evidence = f.note(),
    upstream = f.create(),
    downstream = f.create(
      definition({
        dependencies: [{ resourceId: upstream.resourceId, version: 1 }],
      }),
    );
  assert.throws(
    () =>
      f.mutate(upstream, {
        type: "replaceDefinition",
        definition: definition({
          dependencies: [{ resourceId: downstream.resourceId, version: 1 }],
        }),
      }),
    /task_dependency_cycle_or_bound/,
  );
  const downstreamReview = f.review(downstream, [f.ref(evidence.id)]);
  assert.throws(
    () =>
      f.mutate(downstreamReview, {
        type: "accept",
        reviewIds: [downstreamReview.createdId!],
      }),
    /task_dependency_not_accepted_or_stale/,
  );
  const upstreamReview = f.review(upstream, [f.ref(evidence.id)]),
    upstreamAccepted = f.mutate(upstreamReview, {
      type: "accept",
      reviewIds: [upstreamReview.createdId!],
    });
  assert.equal(
    f.service.read(downstream.resourceId).dependencies[0]!.freshness,
    "changed",
  );
  const rebased = f.mutate(downstreamReview, {
      type: "replaceDefinition",
      definition: definition({
        dependencies: [
          {
            resourceId: upstream.resourceId,
            version: upstreamAccepted.version,
          },
        ],
      }),
    }),
    reviewed = f.review(rebased, [f.ref(evidence.id)]),
    accepted = f.mutate(reviewed, {
      type: "accept",
      reviewIds: [reviewed.createdId!],
    });
  assert.equal(f.service.read(accepted.resourceId).acceptance.state, "valid");
  f.kernel.updateNote(evidence.id, "Actual changed proof", 1);
  assert.equal(f.service.read(upstream.resourceId).acceptance.state, "stale");
  assert.equal(f.service.read(downstream.resourceId).acceptance.state, "stale");
});

test("real Agent profile/principal and actual existing message metadata are required; denied references redact", (t) => {
  const f = fixture(t),
    products = compositeProductDomains({
      kernel: f.kernel,
      db: f.db,
      projectAccess: f.host.projectAccess,
      resourceAccess: f.host.resourceAccess,
      catalog: () => null,
      recordEvent: () => {},
    });
  const agent = products.agent({
    name: "create",
    input: {
      commandId: "synthetic:agent",
      title: "Synthetic actual profile",
      projectId: null,
      profile: agentTemplates()[0]!.profile,
    },
  });
  f.existing();
  const chat = f.kernel.createConversationRef("Synthetic message source");
  f.db
    .prepare(
      "UPDATE integration_state SET json=json_set(json,?,1,'$.graph.messages',json(?)) WHERE id=1",
    )
    .run(
      "$.revisions." + JSON.stringify(chat.id),
      JSON.stringify([
        {
          id: "synthetic:real-message",
          resourceId: chat.id,
          content: "SYNTHETIC_MESSAGE_BODY",
        },
      ]),
    );
  const good = definition({
      assignees: [
        {
          kind: "agent",
          resourceId: agent.agent.resourceId,
          resourceVersion: agent.agent.resourceVersion,
          profileVersion: agent.agent.profileVersion,
        },
        { kind: "principal", principalId: "local-owner" },
      ],
      sources: [f.ref(chat.id, "synthetic:real-message")],
    }),
    made = f.create(good);
  assert.equal(
    f.service.read(made.resourceId).assignees[0]!.freshness,
    "current",
  );
  assert.throws(
    () =>
      f.create(definition({ sources: [f.ref(chat.id, "invented-message")] })),
    /task_reference_unavailable_or_stale/,
  );
  assert.throws(
    () =>
      f.create(
        definition({
          assignees: [{ kind: "principal", principalId: "made-up-owner" }],
        }),
      ),
    /task_reference_unavailable_or_stale/,
  );
  f.deniedMessages.add("synthetic:real-message");
  f.denied.add(agent.agent.resourceId);
  const doc = f.service.read(made.resourceId);
  assert.equal(doc.sources[0]!.freshness, "unavailable");
  assert.equal(doc.assignees[0]!.freshness, "unavailable");
  assert(!JSON.stringify(doc).includes("synthetic:real-message"));
  assert(!JSON.stringify(doc).includes(agent.agent.resourceId));
  assert(!JSON.stringify(doc).includes("SYNTHETIC_MESSAGE_BODY"));
});

test("same-file restart preserves exact objective versions, decisions, real refs and unknown execution metadata", (t) => {
  const directory = resolve(".runtime/task-product-tests", randomUUID());
  mkdirSync(directory, { recursive: true });
  const file = resolve(directory, "canonical.sqlite"),
    f = fixture(t, file),
    evidence = f.note(),
    chat = f.kernel.createConversationRef("Synthetic execution source"),
    e = f.execution(chat.id, "unknown"),
    made = f.create(definition({ sources: [f.ref(evidence.id)] })),
    linked = f.mutate(made, {
      type: "linkAttempt",
      execution: { id: e.id, revision: e.revision },
    }),
    reviewed = f.review(linked, [f.ref(evidence.id)]),
    accepted = f.mutate(reviewed, {
      type: "accept",
      reviewIds: [reviewed.createdId!],
    });
  const before = f.service.read(made.resourceId),
    history = f.service.history({ resourceId: made.resourceId }),
    existing = f.db.prepare("SELECT json FROM integration_state").get()!.json;
  f.close();
  const reopened = fixture(t, file);
  assert.deepEqual(reopened.service.read(made.resourceId), before);
  assert.deepEqual(
    reopened.service.history({ resourceId: made.resourceId }),
    history,
  );
  assert.equal(
    reopened.service.read(made.resourceId).attempts[0]!.execution.current!
      .state,
    "unknown",
  );
  assert.equal(
    reopened.service.read(made.resourceId).acceptance.state,
    "valid",
    "explicit independent manual evidence may accept an objective without rewriting unknown execution truth",
  );
  assert.equal(
    reopened.db.prepare("SELECT json FROM integration_state").get()!.json,
    existing,
  );
  assert.equal(accepted.executionEffects, "none");
});

test("event failure and outer rollback restore canonical resource/domain/history/receipts with no cached schema assumptions", (t) => {
  const f = fixture(t),
    tables = f.tables();
  f.failEvent();
  assert.throws(
    () => f.create(definition(), "retry"),
    /synthetic_task_event_failure/,
  );
  assert.deepEqual(f.tables(), tables);
  assert.equal(f.count("resources"), 0);
  assert.equal(f.count("change_events"), 0);
  f.failEvent(false);
  assert.throws(
    () =>
      f.kernel.withTransaction(() => {
        f.create(definition(), "retry");
        throw Error("synthetic_outer_rollback");
      }),
    /synthetic_outer_rollback/,
  );
  assert.deepEqual(f.tables(), tables);
  assert.equal(f.count("resources"), 0);
  const made = f.create(definition(), "retry"),
    before = f.service.read(made.resourceId),
    history = f.service.history({ resourceId: made.resourceId }),
    events = f.events();
  f.failEvent();
  assert.throws(
    () =>
      f.mutate(made, {
        type: "replaceDefinition",
        definition: definition({ objective: "Never committed" }),
      }),
    /synthetic_task_event_failure/,
  );
  assert.deepEqual(f.service.read(made.resourceId), before);
  assert.deepEqual(f.service.history({ resourceId: made.resourceId }), history);
  assert.deepEqual(f.events(), events);
  assert.equal(f.count("task_objective_receipts"), 1);
});

test("current owner/project/write/operation gates and strict bounded DTOs never accept renderer authority or task success flags", (t) => {
  const f = fixture(t),
    project = f.kernel.createProject("Synthetic project"),
    made = f.create(definition(), randomUUID(), project.id);
  f.deniedOperations.add("replaceDefinition");
  assert.throws(
    () =>
      f.mutate(made, { type: "replaceDefinition", definition: definition() }),
    /task_denied/,
  );
  f.deniedOperations.clear();
  f.writable(false);
  assert.equal(f.service.read(made.resourceId).canEdit, false);
  assert.throws(
    () => f.mutate(made, { type: "administrativeCancel" }),
    /task_read_only/,
  );
  f.writable(true);
  f.deniedProjects.add(project.id);
  assert.throws(() => f.service.read(made.resourceId), /task_unavailable/);
  f.deniedProjects.clear();
  f.principal("another-owner");
  assert.throws(() => f.service.read(made.resourceId), /task_unavailable/);
  f.principal("local-owner");
  for (const op of [
    { type: "start" },
    { type: "accept", reviewIds: [], authorized: true },
    { type: "administrativeCancel", providerStopped: true },
    {
      type: "replaceDefinition",
      definition: definition({ objective: "x".repeat(L.objectiveUnits + 1) }),
    },
  ])
    assert.throws(() => f.mutate(made, op as any), /task_invalid/);
  assert.throws(
    () =>
      f.service.create({
        commandId: "spoof",
        title: "Spoof",
        projectId: null,
        definition: definition(),
        actor: "user",
      } as any),
    /task_invalid_create/,
  );
  assert.throws(
    () =>
      f.mutate(made, {
        type: "review",
        attemptId: null,
        decision: "verified",
        requirementIds: ["criterion-one"],
        evidence: [],
        note: "No evidence",
      }),
    /task_invalid_review/,
  );
  assert.equal(f.count("task_objective_documents"), 1);
  assert.equal(f.service.read(made.resourceId).verification, "unreviewed");
});

test("every current criterion requires its latest explicit verified review and selected proof", (t) => {
  const f = fixture(t),
    proof = f.note(),
    made = f.create(
      definition({
        requirements: [
          { id: "one", text: "First actual criterion" },
          { id: "two", text: "Second actual criterion" },
        ],
      }),
    );
  const first = f.review(made, [f.ref(proof.id)], ["one"]);
  assert.equal(f.service.read(made.resourceId).verification, "partial");
  assert.throws(
    () => f.mutate(first, { type: "accept", reviewIds: [first.createdId!] }),
    /task_verification_required/,
  );
  const second = f.review(first, [f.ref(proof.id)], ["two"]);
  assert.equal(f.service.read(made.resourceId).verification, "verified");
  assert.throws(
    () => f.mutate(second, { type: "accept", reviewIds: [second.createdId!] }),
    /task_verification_required/,
  );
  const accepted = f.mutate(second, {
    type: "accept",
    reviewIds: [first.createdId!, second.createdId!],
  });
  assert.equal(f.service.read(accepted.resourceId).acceptance.state, "valid");
});

test("authorization sees new source/evidence scope, while actual reads use metadata only and perform no writes", (t) => {
  const f = fixture(t),
    source = f.note("SOURCE_BODY_NOT_READ"),
    evidence = f.note("EVIDENCE_BODY_NOT_READ"),
    made = f.create();
  const calls: Parameters<TaskObjectiveHost["authorize"]>[0][] = [];
  const service = new TaskObjectiveService(f.kernel, {
    ...f.host,
    authorize(input) {
      calls.push(structuredClone(input));
      return f.host.authorize(input);
    },
  });
  const changed = service.mutate({
    commandId: "new-source-scope",
    resourceId: made.resourceId,
    expectedVersion: 1,
    operation: {
      type: "replaceDefinition",
      definition: definition({ sources: [f.ref(source.id)] }),
    },
  });
  assert(
    calls
      .findLast((call) => call.operation === "replaceDefinition")!
      .resourceIds.includes(source.id),
  );
  const reviewed = service.mutate({
    commandId: "new-evidence-scope",
    resourceId: made.resourceId,
    expectedVersion: changed.version,
    operation: {
      type: "review",
      attemptId: null,
      decision: "verified",
      requirementIds: ["criterion-one"],
      evidence: [f.ref(evidence.id)],
      note: "Synthetic manual review",
    },
  });
  assert.deepEqual(
    new Set(calls.findLast((call) => call.operation === "review")!.resourceIds),
    new Set([source.id, evidence.id]),
  );
  const prepare = f.db.prepare.bind(f.db),
    changes = f.db.prepare("SELECT total_changes() AS n").get()!.n;
  f.db.prepare = ((sql: string) => {
    assert(
      !/SELECT\s+content\s+FROM\s+notes|SELECT\s+json\s+FROM\s+integration_state/i.test(
        sql,
      ),
      "no source-body/Core whole-state materialization",
    );
    return prepare(sql);
  }) as typeof f.db.prepare;
  try {
    const doc = service.read(reviewed.resourceId);
    assert.equal(doc.verification, "verified");
    assert(!JSON.stringify(doc).includes("SOURCE_BODY_NOT_READ"));
    assert(!JSON.stringify(doc).includes("EVIDENCE_BODY_NOT_READ"));
    assert.equal(
      service.history({ resourceId: made.resourceId }).items.length,
      3,
    );
  } finally {
    f.db.prepare = prepare;
  }
  assert.equal(f.db.prepare("SELECT total_changes() AS n").get()!.n, changes);
});

test("attempt quota and whole-version history byte pages preserve references without eviction or truncation", (t) => {
  const f = fixture(t),
    chat = f.kernel.createConversationRef(
      "Synthetic existing execution collection",
    );
  let current = f.create();
  for (let i = 0; i < L.attempts; i++) {
    const e = f.execution(chat.id, "unknown");
    current = f.mutate(current, {
      type: "linkAttempt",
      execution: { id: e.id, revision: e.revision },
    });
  }
  assert.equal(f.service.read(current.resourceId).attempts.length, L.attempts);
  const extra = f.execution(chat.id, "unknown"),
    original = f.db
      .prepare("SELECT data_json FROM task_objective_documents")
      .get()!.data_json,
    existing = f.db.prepare("SELECT json FROM integration_state").get()!.json;
  assert.throws(
    () =>
      f.mutate(current, {
        type: "linkAttempt",
        execution: { id: extra.id, revision: extra.revision },
      }),
    /task_invalid_attempt/,
  );
  assert.equal(
    f.db.prepare("SELECT data_json FROM task_objective_documents").get()!
      .data_json,
    original,
  );
  assert.equal(
    f.db.prepare("SELECT json FROM integration_state").get()!.json,
    existing,
  );
  const versions: number[] = [];
  let afterVersion = 0;
  do {
    const page = f.service.history({
      resourceId: current.resourceId,
      afterVersion,
      limit: L.history,
    });
    assert(Buffer.byteLength(JSON.stringify(page)) <= L.responseBytes);
    for (const item of page.items) {
      versions.push(item.version);
      assert.equal(
        item.snapshot.attempts.length,
        item.version - 1,
        "a history item is the complete domain version",
      );
    }
    if (page.nextAfterVersion === null) break;
    assert(page.nextAfterVersion > afterVersion);
    assert.equal(page.coverage, "bounded");
    afterVersion = page.nextAfterVersion;
  } while (true);
  assert.deepEqual(
    versions,
    Array.from({ length: L.attempts + 1 }, (_, i) => i + 1),
  );
  assert.equal(f.count("task_objective_versions"), L.attempts + 1);
});

test("a changed trusted policy makes earlier manual verification/acceptance stale without rewriting either", (t) => {
  const f = fixture(t),
    evidence = f.note(),
    made = f.create(),
    reviewed = f.review(made, [f.ref(evidence.id)]),
    accepted = f.mutate(reviewed, {
      type: "accept",
      reviewIds: [reviewed.createdId!],
    });
  const before = f.db
    .prepare("SELECT data_json FROM task_objective_documents")
    .get()!.data_json;
  const policy = new TaskObjectiveService(f.kernel, {
    ...f.host,
    identity: () => ({
      ...f.host.identity(),
      policyVersion: "synthetic-policy:2",
    }),
    authorize: (input) => ({
      ...f.host.authorize(input),
      policyVersion: "synthetic-policy:2",
    }),
  });
  const doc = policy.read(accepted.resourceId);
  assert.equal(doc.disposition, "accepted");
  assert.equal(doc.verification, "stale");
  assert.equal(doc.acceptance.state, "stale");
  assert.equal(
    f.db.prepare("SELECT data_json FROM task_objective_documents").get()!
      .data_json,
    before,
  );
  f.denied.add(evidence.id);
  assert.equal(policy.read(accepted.resourceId).verification, "unavailable");
});
