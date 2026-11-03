import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path, { posix, resolve, win32 } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { WorkspaceKernel } from "../../workspace-kernel/kernel.mts";
import { DesktopState } from "../src/desktop.mts";
import {
  compositeProductDomains,
  isAgentRead,
  isChecklistRead,
  type AgentRequest,
  type ChecklistRequest,
  type DomainEvent,
  type ProductDomainsOptions,
} from "../src/product-domains.mts";
import { agentTemplates } from "../../agent-product/service.mts";

test("starter initialization upgrades existing libraries once and preserves archived identities across restart", (t) => {
  const directory = resolve(".runtime/agent-starters-tests", randomUUID());
  mkdirSync(directory, { recursive: true });
  const file = resolve(directory, "canonical.sqlite");
  const f = fixture(t, file);
  const custom = f.makeAgent();
  const initialize = () =>
    f.domains.agent({ name: "ensureStarters", input: {} });
  const list = () =>
    f.domains.agent({ name: "list", input: { includeArchived: true } }).items;
  assert.equal(isAgentRead({ name: "ensureStarters", input: {} }), false);
  assert.deepEqual(initialize(), { created: 8 });
  const seeded = list().filter(
    (item) => item.resource.id !== custom.agent.resourceId,
  );
  assert.equal(new Set(seeded.map((item) => item.resource.id)).size, 8);
  for (const template of agentTemplates()) {
    const item = seeded.find(
      (candidate) => candidate.resource.title === template.title,
    )!;
    assert.deepEqual(
      f.domains.agent({
        name: "inspect",
        input: { resourceId: item.resource.id },
      }).profile,
      template.profile,
    );
  }
  const archived = seeded[0]!;
  f.domains.agent({
    name: "archive",
    input: { commandId: randomUUID(), agent: archived.ref, archived: true },
  });
  const before = list();
  const eventCount = f.events().length;
  assert.deepEqual(initialize(), { created: 0 });
  assert.deepEqual(list(), before);
  assert.equal(f.events().length, eventCount);
  assert.equal(
    f
      .events()
      .filter((row) => JSON.parse(String(row.detail_json)).starterTemplateId)
      .length,
    8,
  );
  assert.equal(f.catalogReads(), 0);
  assert.equal(f.count("notes"), 0);
  assert.equal(f.count("blocks"), 0);
  assert.throws(
    () => f.makeAgent(null, f.profile(), "aerynth:starter-agent:v1:researcher"),
    /agent_reserved_command_id/,
  );
  f.close();
  const restored = fixture(t, file);
  assert.deepEqual(
    restored.domains.agent({ name: "ensureStarters", input: {} }),
    { created: 0 },
  );
  assert.deepEqual(
    restored.domains.agent({ name: "list", input: { includeArchived: true } })
      .items,
    before,
  );
  assert.equal(
    restored.domains
      .agent({ name: "list", input: {} })
      .items.some((item) => item.resource.id === archived.resource.id),
    false,
  );
});

test("failed starter batch rolls back all earlier creations and can retry", (t) => {
  const f = fixture(t);
  const before = f.tables();
  const record = f.options.recordEvent;
  let writes = 0;
  f.options.recordEvent = (event) => {
    record(event);
    if (++writes === 3) throw Error("starter_batch_failure");
  };
  const initialize = () =>
    f.domains.agent({ name: "ensureStarters", input: {} });
  assert.throws(initialize, /starter_batch_failure/);
  assert.deepEqual(f.tables(), before);
  assert.equal(f.count("resources"), 0);
  assert.equal(f.events().length, 0);
  f.options.recordEvent = record;
  assert.deepEqual(initialize(), { created: 8 });
});

function isFixtureSubdirectory(root: string, directory: string, paths = path) {
  const child = paths.relative(root, directory);
  return child !== "" && child !== ".." &&
    !child.startsWith(".." + paths.sep) && !paths.isAbsolute(child);
}

test("fixture containment rejects siblings and traversal on Windows and POSIX", () => {
  for (const [paths, root] of [[posix, "/tmp/fixtures"], [win32, "C:\\tmp\\fixtures"]] as const) {
    assert.equal(isFixtureSubdirectory(root, paths.join(root, "case"), paths), true);
    assert.equal(isFixtureSubdirectory(root, paths.join(root, "..allowed"), paths), true);
    assert.equal(isFixtureSubdirectory(root, root, paths), false);
    assert.equal(isFixtureSubdirectory(root, paths.dirname(root), paths), false);
    assert.equal(isFixtureSubdirectory(root, root + "-sibling", paths), false);
    assert.equal(isFixtureSubdirectory(root, paths.resolve(root, "case", "..", "..", "outside"), paths), false);
  }
  assert.equal(isFixtureSubdirectory("C:\\tmp\\fixtures", "D:\\tmp\\fixtures\\case", win32), false);
});

function fixture(t: any, file = ":memory:") {
  const kernel = WorkspaceKernel.open(file),
    db = kernel.withTransaction((db) => db),
    desktop = new DesktopState(kernel, db);
  const deniedProjects = new Set<string>(),
    deniedResources = new Set<string>(),
    messages = new Set<string>(),
    resourceReads: [string, string | undefined][] = [];
  let failEvent = false,
    catalogReads = 0,
    cachedCatalog: ProductDomainsOptions["catalog"] extends () => infer R
      ? R
      : never = {
      revision: "synthetic-catalog:1",
      providers: [
        {
          id: "synthetic-provider",
          state: "available",
          models: [{ id: "synthetic-model", reasoningEfforts: ["medium"] }],
          capabilities: ["synthetic-read"],
        },
      ],
    };
  const options: ProductDomainsOptions = {
    kernel,
    db,
    projectAccess: (id) =>
      !deniedProjects.has(id) &&
      !!db
        .prepare("SELECT 1 FROM projects WHERE id=? AND state='active'")
        .get(id),
    resourceAccess: (id, messageId) => {
      resourceReads.push([id, messageId]);
      return (
        !deniedResources.has(id) &&
        !!db.prepare("SELECT 1 FROM resources WHERE id=?").get(id) &&
        (messageId === undefined || messages.has(id + ":" + messageId))
      );
    },
    catalog: () => {
      catalogReads++;
      return cachedCatalog;
    },
    recordEvent(event) {
      // Root's real stream owns publication. This fixture writes its supplied
      // metadata callback into the SAME existing canonical event table.
      db.prepare(
        "INSERT INTO change_events(id,entity_kind,entity_id,resource_id,resource_version,occurred_at,origin,correlation_id,type,detail_json) VALUES(?,?,?,?,?,?,?,?,?,?)",
      ).run(
        randomUUID(),
        "product-domain",
        event.resourceId,
        event.resourceId,
        event.resourceVersion,
        new Date().toISOString(),
        "user",
        event.commandId,
        event.type,
        JSON.stringify(event.detail),
      );
      if (failEvent) throw Error("synthetic_event_failure_after_sql_write");
    },
  };
  const domains = compositeProductDomains(options),
    profile = () => structuredClone(agentTemplates()[0]!.profile);
  let closed = false;
  const close = () => {
    if (!closed) {
      kernel.close();
      closed = true;
    }
  };
  t.after(close);
  const count = (table: string) =>
    Number(db.prepare("SELECT count(*) AS n FROM " + table).get()!.n);
  const tables = () =>
    db
      .prepare(
        "SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all();
  const events = () =>
    db
      .prepare(
        "SELECT resource_id,resource_version,correlation_id,type,detail_json FROM change_events WHERE entity_kind='product-domain' ORDER BY rowid",
      )
      .all();
  const makeAgent = (
    projectId: string | null = null,
    value = profile(),
    commandId: string = randomUUID(),
  ) =>
    domains.agent({
      name: "create",
      input: { commandId, title: "Synthetic agent", projectId, profile: value },
    });
  const makeChecklist = (commandId: string = randomUUID()) =>
    domains.checklist({
      name: "create",
      input: { commandId, title: "Synthetic checklist" },
    });
  return {
    kernel,
    db,
    desktop,
    domains,
    options,
    profile,
    count,
    tables,
    events,
    makeAgent,
    makeChecklist,
    deniedProjects,
    deniedResources,
    messages,
    resourceReads,
    close,
    failEvent: (value = true) => {
      failEvent = value;
    },
    catalogReads: () => catalogReads,
    catalog: (value: typeof cachedCatalog) => {
      cachedCatalog = value;
    },
  };
}

test("read-only empty domains do not initialize schemas or phantom resources; DTO names and fields fail closed", (t) => {
  const f = fixture(t),
    before = f.tables(),
    changes = f.db.prepare("SELECT total_changes() AS n").get()!.n;
  assert.deepEqual(f.domains.agent({ name: "list", input: {} }), {
    contract: "aerynth.agent-library@1",
    items: [],
    coverage: "complete",
  });
  assert.equal(f.domains.agent({ name: "templates", input: {} }).length, 8);
  assert.deepEqual(f.domains.agent({ name: "projects", input: {} }), {
    items: [],
    coverage: "complete",
  });
  assert.equal(
    f.catalogReads(),
    0,
    "templates/list/project metadata never probes even cached catalog",
  );
  assert(
    f.domains.agent({ name: "catalog", input: {} })?.providers[0]?.id ===
      "synthetic-provider",
  );
  assert.equal(f.catalogReads(), 1);
  assert.throws(
    () =>
      f.domains.agent({ name: "inspect", input: { resourceId: "missing" } }),
    /unavailable/,
  );
  assert.throws(
    () =>
      f.domains.checklist({ name: "read", input: { resourceId: "missing" } }),
    /unavailable/,
  );
  for (const name of ["constructor", "toString", "List", "initialize"]) {
    assert.throws(
      () => f.domains.agent({ name, input: {} } as unknown as AgentRequest),
      /unsupported_agent_request/,
    );
    assert.equal(isAgentRead({ name, input: {} }), false);
  }
  assert.throws(
    () =>
      f.domains.agent({
        name: "inspect",
        input: { resourceId: "missing", authorized: true },
      } as any),
    /invalid_id/,
  );
  assert.throws(
    () =>
      f.domains.checklist({
        name: "read",
        input: { resourceId: "missing", actor: "assistant" },
      } as any),
    /invalid_checklist/,
  );
  assert.throws(
    () =>
      f.domains.agent({
        name: "list",
        input: { includeArchived: "yes" },
      } as any),
    /invalid_list/,
  );
  assert.equal(isAgentRead({ name: "list", input: {} }), true);
  assert.equal(isAgentRead({ name: "create", input: {} }), false);
  assert.equal(isChecklistRead({ name: "read", input: {} }), true);
  assert.equal(isChecklistRead({ name: "Read", input: {} }), false);
  assert.equal(
    isChecklistRead({ name: "read", input: {}, authorized: true }),
    false,
  );
  assert.equal(f.db.prepare("SELECT total_changes() AS n").get()!.n, changes);
  assert.deepEqual(f.tables(), before);
  assert.equal(f.count("resources"), 0);
});

test("independent Agent and Checklist identities use canonical generic resources with zero Notes/chats/workspaces/placements and survive SQLite restart", (t) => {
  const root = resolve(".runtime/product-domains-tests");
  const directory = resolve(root, randomUUID());
  assert(isFixtureSubdirectory(root, directory));
  mkdirSync(directory, { recursive: true });
  t.diagnostic("Retained synthetic-only canonical SQLite: " + directory);
  const file = resolve(directory, "canonical.sqlite"),
    f = fixture(t, file),
    agent = f.makeAgent(),
    checklist = f.makeChecklist();
  const changed = f.domains.checklist({
    name: "mutate",
    input: {
      commandId: randomUUID(),
      resourceId: checklist.resourceId,
      expectedVersion: 1,
      operations: [
        {
          type: "addEntry",
          key: "entry",
          entry: { text: "Synthetic manual item", priority: "high" },
        },
      ],
    },
  });
  const a = f.domains.agent({
      name: "inspect",
      input: { resourceId: agent.agent.resourceId },
    }),
    c = f.domains.checklist({
      name: "read",
      input: { resourceId: checklist.resourceId },
    });
  assert.equal(f.kernel.getResource(a.resource.id).resource.kind, "generic");
  assert.equal(f.kernel.getResource(c.resource.id).resource.kind, "generic");
  for (const table of ["notes", "conversation_refs", "blocks", "workspaces"])
    assert.equal(f.count(table), 0);
  assert.equal(f.count("resources"), 2);
  const desktop = f.desktop.snapshot(() => {
    throw Error("No conversation exists");
  });
  assert.deepEqual(
    new Set(desktop.resources.map((r) => r.kind)),
    new Set(["agent", "checklist"]),
  );
  assert.equal(c.syncPolicy, "manual");
  assert.equal(c.entries[0]!.created.actor.kind, "user");
  assert.equal(c.entries[0]!.created.actor.id, "local-owner");
  assert.equal(c.entries[0]!.created.authority, "manual");
  assert(!Number.isNaN(Date.parse(c.created.at)));
  assert.equal(changed.version, 2);
  f.close();
  const reopened = fixture(t, file);
  assert.deepEqual(
    reopened.domains.agent({
      name: "inspect",
      input: { resourceId: a.resource.id },
    }),
    a,
  );
  assert.deepEqual(
    reopened.domains.checklist({
      name: "read",
      input: { resourceId: c.resource.id },
    }),
    c,
  );
  assert.equal(reopened.count("resources"), 2);
  assert.equal(reopened.count("notes"), 0);
  assert.equal(reopened.count("workspaces"), 0);
});

test("Agent profile CAS, immutable receipts, explicit unconfigured inheritance and event metadata stay truthful", (t) => {
  const f = fixture(t),
    created = f.makeAgent(null, f.profile(), "synthetic:agent-create"),
    first = f.domains.agent({
      name: "inspect",
      input: { resourceId: created.agent.resourceId },
    });
  const config = f.domains.agent({
    name: "effective",
    input: { agent: first.ref },
  });
  assert.equal(config.configurationState, "needs-setup");
  assert.deepEqual(config.settings, {
    providerId: null,
    modelId: null,
    reasoningEffort: null,
    additionalInstructions: "",
    requiredCapabilities: [],
  });
  assert(
    Object.values(config.origins).every(
      (origin) => origin.scope === "global" && origin.version === "1",
    ),
  );
  const profile = f.profile();
  profile.settings.additionalInstructions = {
    source: "override",
    value: "SYNTHETIC_PRIVATE_INSTRUCTIONS_NOT_EVENTS",
  };
  const input = {
    commandId: "synthetic:agent-update",
    agent: first.ref,
    title: "Changed synthetic agent",
    profile,
  };
  const result = f.domains.agent({ name: "update", input });
  assert.equal(result.agent.resourceVersion, 2);
  assert.equal(result.agent.profileVersion, 2);
  assert.deepEqual(f.domains.agent({ name: "update", input }), result);
  assert.equal(f.events().length, 2);
  assert.throws(
    () =>
      f.domains.agent({
        name: "update",
        input: { ...input, commandId: "synthetic:stale" },
      }),
    /version_conflict/,
  );
  assert.throws(
    () =>
      f.domains.agent({
        name: "update",
        input: { ...input, title: "Command substitution" },
      }),
    /command_conflict/,
  );
  assert(!JSON.stringify(f.events()).includes("PRIVATE_INSTRUCTIONS"));
  assert(
    f
      .events()
      .every(
        (event) => JSON.parse(String(event.detail_json)).authority === "manual",
      ),
  );
  const changes = f.db.prepare("SELECT total_changes() AS n").get()!.n;
  f.domains.agent({
    name: "inspect",
    input: { resourceId: first.resource.id },
  });
  f.domains.agent({ name: "list", input: {} });
  assert.equal(f.db.prepare("SELECT total_changes() AS n").get()!.n, changes);
});

test("archive/includeArchived/restore revalidate current resource owner and active authorized project", (t) => {
  const f = fixture(t),
    project = f.kernel.createProject("Synthetic scoped project"),
    created = f.makeAgent(project.id),
    archived = f.domains.agent({
      name: "archive",
      input: {
        commandId: "synthetic:archive",
        agent: created.agent,
        archived: true,
      },
    });
  assert.throws(
    () =>
      f.domains.agent({
        name: "inspect",
        input: { resourceId: created.agent.resourceId },
      }),
    /archived/,
  );
  const list = f.domains.agent({
    name: "list",
    input: { includeArchived: true },
  });
  assert.equal(list.items.length, 1);
  assert(!("profile" in list.items[0]!));
  f.deniedResources.add(created.agent.resourceId);
  assert.equal(
    f.domains.agent({ name: "list", input: { includeArchived: true } }).items
      .length,
    0,
  );
  assert.throws(
    () =>
      f.domains.agent({
        name: "archive",
        input: {
          commandId: "synthetic:restore-denied",
          agent: archived.agent,
          archived: false,
        },
      }),
    /unavailable/,
  );
  f.deniedResources.clear();
  f.deniedProjects.add(project.id);
  assert.equal(
    f.domains.agent({ name: "list", input: { includeArchived: true } }).items
      .length,
    0,
  );
  assert.throws(
    () =>
      f.domains.agent({
        name: "archive",
        input: {
          commandId: "synthetic:restore-project-denied",
          agent: archived.agent,
          archived: false,
        },
      }),
    /unavailable/,
  );
  f.deniedProjects.clear();
  const restored = f.domains.agent({
    name: "archive",
    input: {
      commandId: "synthetic:restore",
      agent: archived.agent,
      archived: false,
    },
  });
  assert.equal(restored.agent.resourceVersion, 3);
  f.db
    .prepare("UPDATE agent_product_profiles SET owner_id=? WHERE resource_id=?")
    .run("different-owner", created.agent.resourceId);
  assert.throws(
    () =>
      f.domains.agent({
        name: "inspect",
        input: { resourceId: created.agent.resourceId },
      }),
    /profile_unavailable/,
  );
});

test("actual manual Task references remain reference-only; catalog/execution/permission fences never start work", (t) => {
  const f = fixture(t),
    rawTask = f.kernel.createNote(
      "Synthetic legacy manual Task",
      "Original task content",
    );
  f.db
    .prepare("INSERT INTO desktop_resources(resource_id,kind) VALUES(?,?)")
    .run(rawTask.id, "task");
  const profile = f.profile();
  profile.settings.providerId = {
    source: "override",
    value: "synthetic-provider",
  };
  profile.settings.modelId = { source: "override", value: "synthetic-model" };
  const created = f.makeAgent(null, profile),
    effective = f.domains.agent({
      name: "effective",
      input: { agent: created.agent },
    });
  assert.equal(effective.configurationState, "supported");
  const input = {
    commandId: "synthetic:associate",
    agent: created.agent,
    task: { id: rawTask.id, version: 1 },
    expectedCatalogRevision: effective.catalogRevision,
    expectedConfigurationDigest: effective.digest,
  };
  const assigned = f.domains.agent({ name: "recordAssignment", input });
  assert.equal(assigned.referenceOnly, true);
  assert.equal(assigned.startsExecution, false);
  assert.equal(assigned.taskVerified, false);
  assert.equal(assigned.execution, null);
  assert.equal(assigned.task.supportedTaskOrigin, "manual-compatibility");
  assert.equal(f.kernel.getResource(rawTask.id).resource.version, 1);
  assert.equal(
    f.kernel.getResource(rawTask.id).note!.content,
    "Original task content",
  );
  assert.deepEqual(
    f.domains.agent({ name: "recordAssignment", input }),
    assigned,
  );
  assert.equal(
    f.events().filter((event) => event.type === "agent.assignment-recorded")
      .length,
    1,
  );
  assert.throws(
    () =>
      f.domains.agent({
        name: "recordAssignment",
        input: {
          ...input,
          commandId: "synthetic:execution",
          execution: { id: "invented-execution", revision: "1" },
        },
      }),
    /execution_unavailable/,
  );
  const futureTask = f.kernel.createGenericResource(
    "Synthetic future task identity",
  );
  f.db
    .prepare("INSERT INTO desktop_resources(resource_id,kind) VALUES(?,?)")
    .run(futureTask.id, "task");
  assert.throws(
    () =>
      f.domains.agent({
        name: "recordAssignment",
        input: {
          ...input,
          commandId: "synthetic:future-task",
          task: { id: futureTask.id, version: 1 },
        },
      }),
    /task_unavailable/,
    "an unknown future task implementation is never invented as legacy or agentic execution",
  );
  f.deniedResources.add(rawTask.id);
  assert.throws(
    () => f.domains.agent({ name: "assignment", input: { id: assigned.id } }),
    /task_unavailable/,
  );
  assert.equal(f.count("workspaces"), 0);
  assert.equal(f.count("blocks"), 0);
  assert.equal(f.count("conversation_refs"), 0);
});

test("Checklist current permissions redact canonical source references and refuse unresolved future domain kinds", (t) => {
  const f = fixture(t),
    source = f.kernel.createNote(
      "Synthetic referenced source",
      "SYNTHETIC_BODY_NOT_EVENTS",
    ),
    conversation = f.kernel.createConversationRef(
      "Synthetic canonical conversation",
    ),
    project = f.kernel.createProject("Synthetic linked project");
  f.messages.add(conversation.id + ":synthetic:message");
  const created = f.domains.checklist({
    name: "create",
    input: {
      commandId: randomUUID(),
      title: "Synthetic linked checklist",
      conversationId: conversation.id,
    },
  });
  f.domains.checklist({
    name: "mutate",
    input: {
      commandId: randomUUID(),
      resourceId: created.resourceId,
      expectedVersion: 1,
      operations: [
        {
          type: "addReference",
          reference: { kind: "resource", resourceId: source.id },
        },
        {
          type: "addReference",
          reference: {
            kind: "conversation",
            resourceId: conversation.id,
            messageId: "synthetic:message",
          },
        },
        {
          type: "addReference",
          reference: { kind: "project", projectId: project.id },
        },
      ],
    },
  });
  assert(
    f.resourceReads.some(
      ([id, messageId]) =>
        id === conversation.id && messageId === "synthetic:message",
    ),
  );
  f.deniedResources.add(source.id);
  f.messages.clear();
  f.deniedProjects.add(project.id);
  const read = f.domains.checklist({
    name: "read",
    input: { resourceId: created.resourceId },
  });
  assert.equal(read.references.filter((ref) => !ref.available).length, 3);
  for (const ref of read.references.filter((ref) => !ref.available))
    assert.equal(ref.target, undefined);
  const before = f.count("checklist_receipts");
  assert.throws(
    () =>
      f.domains.checklist({
        name: "mutate",
        input: {
          commandId: randomUUID(),
          resourceId: created.resourceId,
          expectedVersion: read.resource.version,
          operations: [
            {
              type: "addReference",
              reference: { kind: "agent", agentId: "future:agent" },
            },
          ],
        },
      }),
    /reference_unavailable/,
  );
  assert.equal(f.count("checklist_receipts"), before);
  assert(!JSON.stringify(f.events()).includes("BODY_NOT_EVENTS"));
  f.deniedResources.add(created.resourceId);
  assert.throws(
    () =>
      f.domains.checklist({
        name: "read",
        input: { resourceId: created.resourceId },
      }),
    /unavailable/,
  );
});

test("Checklist CAS, idempotent mutation and manual completion are composed on the canonical resource version", (t) => {
  const f = fixture(t),
    created = f.makeChecklist("synthetic:checklist-create");
  assert.deepEqual(f.makeChecklist("synthetic:checklist-create"), created);
  const input = {
      commandId: "synthetic:add",
      resourceId: created.resourceId,
      expectedVersion: 1,
      operations: [
        {
          type: "addEntry" as const,
          key: "entry",
          entry: { text: "SYNTHETIC_ENTRY_NOT_EVENTS" },
        },
      ],
    },
    added = f.domains.checklist({ name: "mutate", input });
  assert.deepEqual(f.domains.checklist({ name: "mutate", input }), added);
  assert.equal(f.events().length, 2);
  assert.throws(
    () =>
      f.domains.checklist({
        name: "mutate",
        input: { ...input, commandId: "synthetic:stale-add" },
      }),
    /version_conflict/,
  );
  f.domains.checklist({
    name: "mutate",
    input: {
      commandId: "synthetic:checked",
      resourceId: created.resourceId,
      expectedVersion: 2,
      operations: [
        { type: "setChecked", entryId: added.createdIds.entry!, checked: true },
      ],
    },
  });
  const doc = f.domains.checklist({
    name: "read",
    input: { resourceId: created.resourceId },
  });
  assert.equal(doc.entries[0]!.completion!.basis, "manual");
  assert.equal(doc.resource.version, 3);
  assert(!JSON.stringify(f.events()).includes("ENTRY_NOT_EVENTS"));
  assert.equal(f.count("notes"), 0);
  assert.equal(f.count("conversation_refs"), 0);
  f.db
    .prepare("UPDATE resources SET kind='note' WHERE id=?")
    .run(created.resourceId);
  assert.throws(
    () =>
      f.domains.checklist({
        name: "read",
        input: { resourceId: created.resourceId },
      }),
    /unavailable/,
    "a non-generic impostor cannot become a canonical Checklist on read",
  );
});

test("event failure rolls canonical/domain/schema/receipt writes back atomically, and the same command can retry after rollback", (t) => {
  for (const family of ["agent", "checklist"] as const) {
    const f = fixture(t),
      before = f.tables();
    f.failEvent();
    assert.throws(
      () =>
        family === "agent"
          ? f.makeAgent(null, f.profile(), "synthetic:retry")
          : f.makeChecklist("synthetic:retry"),
      /synthetic_event_failure/,
    );
    assert.equal(f.count("resources"), 0);
    assert.deepEqual(f.tables(), before);
    assert.equal(f.events().length, 0);
    f.failEvent(false);
    if (family === "agent") f.makeAgent(null, f.profile(), "synthetic:retry");
    else f.makeChecklist("synthetic:retry");
    assert.equal(f.count("resources"), 1);
  }
  const f = fixture(t),
    agent = f.makeAgent(),
    checklist = f.makeChecklist(),
    beforeAgent = f.domains.agent({
      name: "inspect",
      input: { resourceId: agent.agent.resourceId },
    }),
    beforeChecklist = f.domains.checklist({
      name: "read",
      input: { resourceId: checklist.resourceId },
    }),
    events = f.events();
  f.failEvent();
  assert.throws(
    () =>
      f.domains.agent({
        name: "update",
        input: {
          commandId: "synthetic:rollback-agent",
          agent: agent.agent,
          title: "Never committed",
          profile: f.profile(),
        },
      }),
    /synthetic_event_failure/,
  );
  assert.throws(
    () =>
      f.domains.checklist({
        name: "mutate",
        input: {
          commandId: "synthetic:rollback-checklist",
          resourceId: checklist.resourceId,
          expectedVersion: 1,
          operations: [
            {
              type: "addEntry",
              key: "failed",
              entry: { text: "Never committed" },
            },
          ],
        },
      }),
    /synthetic_event_failure/,
  );
  assert.deepEqual(
    f.domains.agent({
      name: "inspect",
      input: { resourceId: agent.agent.resourceId },
    }),
    beforeAgent,
  );
  assert.deepEqual(
    f.domains.checklist({
      name: "read",
      input: { resourceId: checklist.resourceId },
    }),
    beforeChecklist,
  );
  assert.deepEqual(f.events(), events);
});

test("partial/future domains and connection mismatch fail closed without creating phantom tables/resources", (t) => {
  for (const domain of ["agent", "checklist"] as const) {
    const f = fixture(t);
    f.db.exec(
      domain === "agent"
        ? "CREATE TABLE agent_product_schema(id INTEGER,version INTEGER);INSERT INTO agent_product_schema VALUES(1,99)"
        : "CREATE TABLE checklist_schema(version INTEGER);INSERT INTO checklist_schema VALUES(99)",
    );
    const before = f.tables();
    assert.throws(
      () =>
        domain === "agent"
          ? f.domains.agent({ name: "list", input: {} })
          : f.domains.checklist({
              name: "read",
              input: { resourceId: "missing" },
            }),
      /partial_schema/,
    );
    assert.deepEqual(f.tables(), before);
    assert.equal(f.count("resources"), 0);
    const complete = fixture(t);
    if (domain === "agent") complete.makeAgent();
    else complete.makeChecklist();
    complete.db.exec(
      "UPDATE " +
        (domain === "agent" ? "agent_product_schema" : "checklist_schema") +
        " SET version=99",
    );
    const tables = complete.tables();
    assert.throws(
      () =>
        domain === "agent"
          ? complete.domains.agent({ name: "list", input: {} })
          : complete.domains.checklist({
              name: "read",
              input: { resourceId: "missing" },
            }),
      /unsupported_schema/,
    );
    assert.deepEqual(complete.tables(), tables);
    assert.equal(complete.count("resources"), 1);
  }
  const f = fixture(t),
    other = new DatabaseSync(":memory:");
  try {
    assert.throws(
      () => compositeProductDomains({ ...f.options, db: other }),
      /canonical_connection_required/,
    );
  } finally {
    other.close();
  }
});
