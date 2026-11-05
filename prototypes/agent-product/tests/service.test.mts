import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { WorkspaceKernel } from "../../workspace-kernel/kernel.mts";
import { DesktopState } from "../../integrated-backend/src/desktop.mts";
import { AgentLibraryService, agentTemplates } from "../service.mts";
import type {
  AgentHostPort,
  AgentProfileData,
  AgentSettings,
  CanonicalAgentResource,
  AgentRef,
} from "../contracts.ts";

const dirs: string[] = [];
const kernels = new Set<WorkspaceKernel>();
test.after(() => {
  for (const kernel of kernels) {
    try {
      kernel.close();
    } catch {}
  }
  kernels.clear();
  for (const directory of dirs) {
    const target = resolve(directory);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert(basename(target).startsWith("aerynth-agent-library-synthetic-"));
    rmSync(target, { recursive: true, force: true });
  }
});
const newFile = () => {
  const dir = mkdtempSync(join(tmpdir(), "aerynth-agent-library-synthetic-"));
  dirs.push(dir);
  return join(dir, "canonical.sqlite");
};
const profile = (): AgentProfileData =>
  structuredClone(agentTemplates()[0]!.profile);
function fixture(file = newFile()) {
  const kernel = WorkspaceKernel.open(file);
  kernels.add(kernel);
  let db!: DatabaseSync;
  kernel.withTransaction((value) => {
    db = value;
  });
  const desktop = new DesktopState(kernel, db);
  const state = {
    principal: "synthetic-owner",
    policy: "policy-1",
    allow: true,
    deniedProjects: new Set<string>(),
    deniedResources: new Set<string>(),
    failCreate: false,
    failRename: false,
    failArchive: false,
    catalogRevision: "synthetic-catalog-1",
    snapshots: 0,
    onCatalog: null as null | (() => void),
  };
  const defaults: AgentSettings = {
    providerId: "codex-app-server",
    modelId: "synthetic-model",
    reasoningEffort: "medium",
    additionalInstructions:
      "Synthetic additional user instructions. Native provider identity is external.",
    requiredCapabilities: ["synthetic-read-capability"],
  };
  const resource = (id: string): CanonicalAgentResource | null => {
    const row = db
      .prepare(
        "SELECT r.* FROM resources r JOIN desktop_resources d ON d.resource_id=r.id WHERE r.id=? AND d.kind='agent'",
      )
      .get(id);
    if (!row || state.deniedResources.has(id)) return null;
    return {
      id,
      kind: "agent",
      title: String(row.title),
      projectId: row.project_id as string | null,
      version: Number(row.version),
      state: row.state as "active" | "archived",
    };
  };
  const host: AgentHostPort = {
    identity: () => ({
      principalId: state.principal,
      policyVersion: state.policy,
    }),
    authorize: (input) => ({
      decision:
        state.allow &&
        (!input.project || !state.deniedProjects.has(input.project.id)) &&
        (!input.agent || !state.deniedResources.has(input.agent.id))
          ? "allow"
          : "deny",
      policyVersion: state.policy,
      authorizationRef: "synthetic-policy-proof-" + state.policy,
    }),
    resource: (id) => resource(id),
    project: (id) => {
      const p = db
        .prepare("SELECT id,version,state FROM projects WHERE id=?")
        .get(id);
      return p
        ? {
            id,
            version: Number(p.version),
            state: p.state as "active" | "archived",
          }
        : null;
    },
    createResource: (input) => {
      const r = kernel.createGenericResource(input.title, input.projectId, {
        correlationId: input.commandId,
      });
      db.prepare(
        "INSERT INTO desktop_resources(resource_id,kind) VALUES(?,'agent')",
      ).run(r.id);
      if (state.failCreate)
        throw Error("synthetic post-canonical-create failure");
      return resource(r.id)!;
    },
    renameResource: (input) => {
      kernel.renameResource(input.id, input.title, input.expectedVersion, {
        correlationId: input.commandId,
      });
      if (state.failRename)
        throw Error("synthetic post-canonical-rename failure");
      return resource(input.id)!;
    },
    touchResource: (input) => {
      kernel.touchGenericResource(input.id, input.expectedVersion, {
        correlationId: input.commandId,
      });
      return resource(input.id)!;
    },
    archiveResource: (input) => {
      kernel.setResourceArchived(
        input.id,
        input.archived,
        input.expectedVersion,
        { correlationId: input.commandId },
      );
      if (state.failArchive)
        throw Error("synthetic post-canonical-archive failure");
      return resource(input.id)!;
    },
    configurationLayers: (projectId) => ({
      policyVersion: state.policy,
      layers: [
        {
          scope: "global",
          id: null,
          version: "synthetic-global-1",
          settings: structuredClone(defaults),
        },
        ...(projectId
          ? [
              {
                scope: "project" as const,
                id: projectId,
                version: "synthetic-project-config-1",
                settings: { reasoningEffort: "high" },
              },
            ]
          : []),
      ],
    }),
    providerCatalog: () => {
      state.snapshots++;
      state.onCatalog?.();
      return {
        revision: state.catalogRevision,
        providers: [
          {
            id: "codex-app-server",
            state: "available",
            models: [
              { id: "synthetic-model", reasoningEfforts: ["medium", "high"] },
            ],
            capabilities: ["synthetic-read-capability"],
          },
        ],
      };
    },
    task: (id) => {
      const r = db
        .prepare(
          "SELECT r.* FROM resources r JOIN desktop_resources d ON d.resource_id=r.id WHERE r.id=? AND d.kind='task'",
        )
        .get(id);
      return r
        ? {
            id,
            kind: "task",
            supportedTaskOrigin: "manual-compatibility",
            version: Number(r.version),
            projectId: r.project_id as string | null,
            state: r.state as "active" | "archived",
          }
        : null;
    },
    // No released canonical execution reader in this fixture. Never invent one.
    execution: () => null,
  };
  const options = {
    db,
    transaction: <T,>(work: (db: DatabaseSync) => T) =>
      kernel.withTransaction(work),
    readTransaction: <T,>(work: (db: DatabaseSync) => T) =>
      kernel.withTransaction(work),
    host,
  };
  const service = new AgentLibraryService(options);
  const create = (
    commandId = "synthetic-create",
    projectId: string | null = null,
    p = profile(),
  ) =>
    service.create({
      commandId,
      title: "Synthetic Researcher",
      projectId,
      profile: p,
    });
  const task = (projectId: string | null = null) => {
    kernel.withTransaction(() =>
      desktop.apply(
        {
          type: "createResource",
          kind: "task",
          title: "Synthetic existing canonical task",
          workspaceId: null,
        },
        () => {
          throw Error("No conversation/provider creation authorized");
        },
      ),
    );
    const row = db
      .prepare(
        "SELECT r.* FROM resources r JOIN desktop_resources d ON d.resource_id=r.id WHERE d.kind='task' ORDER BY r.rowid DESC LIMIT 1",
      )
      .get()!;
    if (projectId)
      kernel.assignResourceProject(
        String(row.id),
        projectId,
        Number(row.version),
      );
    const actual = kernel.getResource(String(row.id)).resource;
    return { id: actual.id, version: actual.version };
  };
  const assignmentInput = (
    commandId: string,
    agent: AgentRef,
    task: { id: string; version: number },
  ) => ({
    commandId,
    agent,
    task,
    expectedCatalogRevision: state.catalogRevision,
    expectedConfigurationDigest: service.effective(
      agent,
      host.task(task.id)!.projectId,
    ).digest,
  });
  return {
    file,
    kernel,
    db,
    desktop,
    state,
    defaults,
    host,
    options,
    service,
    create,
    task,
    assignmentInput,
    close: () => {
      if (kernels.delete(kernel)) kernel.close();
    },
  };
}

test("eight configurable templates are nonexecuting profiles with explicit inheritance and isolated copies", () => {
  const items = agentTemplates();
  assert.deepEqual(
    items.map((x) => x.title),
    [
      "Researcher",
      "Engineer",
      "Debugger",
      "Verifier",
      "Designer",
      "Analyst",
      "Archivist",
      "Planner",
    ],
  );
  assert(items.every((x) => !x.startsExecution));
  items[0]!.profile.settings.providerId = {
    source: "override",
    value: "synthetic-other",
  };
  assert.equal(
    agentTemplates()[0]!.profile.settings.providerId.source,
    "inherit",
  );
});
test("real canonical generic resource/profile CRUD persists without notes, conversations, workspaces or placements; retries keep identity", () => {
  const f = fixture();
  const receipt = f.create();
  assert.deepEqual(f.create(), receipt);
  const first = f.service.inspect(receipt.agent.resourceId);
  assert.equal(
    f.kernel.getResource(receipt.agent.resourceId).resource.kind,
    "generic",
  );
  for (const table of ["notes", "conversation_refs", "workspaces", "blocks"])
    assert.equal(f.db.prepare(`SELECT count(*) n FROM ${table}`).get()!.n, 0);
  assert.equal(f.state.snapshots, 0, "CRUD never probes even catalog metadata");
  const changed = profile();
  changed.purpose = "Synthetic independent verification";
  const updated = f.service.update({
    commandId: "rename",
    agent: first.ref,
    title: "Synthetic Verifier",
    profile: changed,
  });
  assert.equal(updated.agent.resourceVersion, 2);
  assert.equal(updated.agent.profileVersion, 2);
  const archived = f.service.archive({
    commandId: "archive",
    agent: updated.agent,
    archived: true,
  });
  assert.throws(() => f.service.inspect(first.resource.id), /archived/);
  assert.equal(f.service.list().items.length, 0);
  assert.equal(
    f.service.list({ includeArchived: true }).items[0]!.resource.state,
    "archived",
  );
  assert(!("profile" in f.service.list({ includeArchived: true }).items[0]!));
  const restored = f.service.archive({
    commandId: "restore",
    agent: archived.agent,
    archived: false,
  });
  assert.equal(restored.agent.resourceId, first.resource.id);
  assert.equal(restored.agent.profileVersion, 4);
  assert.equal(restored.agent.resourceVersion, 4);
  const expected = f.service.inspect(first.resource.id);
  f.close();
  const restart = fixture(f.file);
  assert.deepEqual(restart.service.inspect(first.resource.id), expected);
  assert.deepEqual(
    restart.service.archive({
      commandId: "restore",
      agent: archived.agent,
      archived: false,
    }),
    restored,
  );
  restart.kernel.assertIntegrity();
  restart.close();
});
test("profile and canonical resource CAS are independent, duplicate command mismatch fails, returned data is not state", () => {
  const f = fixture();
  const a = f.create();
  const p = f.service.inspect(a.agent.resourceId);
  p.profile.purpose = "mutated returned copy";
  assert.notEqual(
    f.service.inspect(a.agent.resourceId).profile.purpose,
    p.profile.purpose,
  );
  assert.throws(
    () =>
      f.service.create({
        commandId: "synthetic-create",
        title: "different",
        projectId: null,
        profile: profile(),
      }),
    /command_conflict/,
  );
  const u = f.service.update({
    commandId: "config-only",
    agent: a.agent,
    title: "Synthetic Researcher",
    profile: profile(),
  });
  assert.equal(u.agent.resourceVersion, 2);
  assert.equal(u.agent.profileVersion, 2);
  assert.deepEqual(
    f.service.update({
      commandId: "config-only",
      agent: a.agent,
      title: "Synthetic Researcher",
      profile: profile(),
    }),
    u,
  );
  assert.equal(
    f.kernel.getResource(a.agent.resourceId).resource.version,
    2,
    "retry never touches twice",
  );
  assert.equal(
    f.db
      .prepare(
        "SELECT count(*) n FROM change_events WHERE entity_id=? AND type='resource.metadata_updated'",
      )
      .get(a.agent.resourceId)!.n,
    1,
  );
  assert.throws(
    () =>
      f.service.update({
        commandId: "stale-profile",
        agent: a.agent,
        title: "stale",
        profile: profile(),
      }),
    /version_conflict/,
  );
  f.kernel.renameResource(
    a.agent.resourceId,
    "Externally renamed canonical resource",
    2,
  );
  assert.throws(
    () =>
      f.service.archive({
        commandId: "stale-resource",
        agent: u.agent,
        archived: true,
      }),
    /version_conflict/,
  );
  f.close();
});
test("post-canonical create/rename/archive throw rolls back profile, resource, journal and receipts; exact retry works", () => {
  const f = fixture();
  const counts = () =>
    [
      "resources",
      "change_events",
      "agent_product_profiles",
      "agent_product_versions",
      "agent_product_operations",
    ].map((t) => Number(f.db.prepare(`SELECT count(*) n FROM ${t}`).get()!.n));
  const initial = counts();
  f.state.failCreate = true;
  assert.throws(() => f.create(), /post-canonical/);
  assert.deepEqual(counts(), initial);
  f.state.failCreate = false;
  const a = f.create();
  const before = f.service.inspect(a.agent.resourceId),
    count = counts();
  f.state.failRename = true;
  assert.throws(
    () =>
      f.service.update({
        commandId: "rollback-rename",
        agent: a.agent,
        title: "new title",
        profile: profile(),
      }),
    /post-canonical/,
  );
  assert.deepEqual(counts(), count);
  assert.deepEqual(f.service.inspect(a.agent.resourceId), before);
  f.state.failRename = false;
  const u = f.service.update({
    commandId: "rollback-rename",
    agent: a.agent,
    title: "new title",
    profile: profile(),
  });
  f.state.failArchive = true;
  const original = f.service.inspect(a.agent.resourceId);
  assert.throws(
    () =>
      f.service.archive({
        commandId: "rollback-archive",
        agent: u.agent,
        archived: true,
      }),
    /post-canonical/,
  );
  assert.deepEqual(f.service.inspect(a.agent.resourceId), original);
  f.state.failArchive = false;
  f.service.archive({
    commandId: "rollback-archive",
    agent: u.agent,
    archived: true,
  });
  f.close();
});
test("failure writing the final receipt rolls back already-written canonical resource, profile version, assignment and journal", () => {
  const f = fixture(),
    before = f.db.prepare("SELECT count(*) n FROM resources").get()!.n,
    events = f.db.prepare("SELECT count(*) n FROM change_events").get()!.n;
  f.db.exec(
    "CREATE TEMP TRIGGER agent_final_receipt_failure BEFORE INSERT ON agent_product_operations WHEN NEW.command_id='final-failure' BEGIN SELECT RAISE(ABORT,'synthetic final receipt failure'); END;",
  );
  assert.throws(() => f.create("final-failure"), /final receipt failure/);
  assert.equal(
    f.db.prepare("SELECT count(*) n FROM resources").get()!.n,
    before,
  );
  assert.equal(
    f.db.prepare("SELECT count(*) n FROM change_events").get()!.n,
    events,
  );
  assert.equal(
    f.db.prepare("SELECT count(*) n FROM agent_product_versions").get()!.n,
    0,
  );
  f.db.exec("DROP TRIGGER agent_final_receipt_failure");
  const a = f.create("final-failure"),
    task = f.task();
  f.db.exec(
    "CREATE TEMP TRIGGER agent_final_assignment_failure BEFORE INSERT ON agent_product_operations WHEN NEW.command_id='assignment-final-failure' BEGIN SELECT RAISE(ABORT,'synthetic final assignment failure'); END;",
  );
  const input = f.assignmentInput("assignment-final-failure", a.agent, task);
  assert.throws(
    () => f.service.recordAssignment(input),
    /final assignment failure/,
  );
  assert.equal(
    f.db.prepare("SELECT count(*) n FROM agent_product_assignments").get()!.n,
    0,
  );
  f.db.exec("DROP TRIGGER agent_final_assignment_failure");
  assert.equal(f.service.recordAssignment(input).startsExecution, false);
  f.close();
});
test("revoked owner/project permission hides metadata, rejects mutations, and cannot be supplied through profile fields", () => {
  const f = fixture(),
    project = f.kernel.createProject("Synthetic scoped project"),
    a = f.create("project-agent", project.id);
  f.state.deniedProjects.add(project.id);
  assert.deepEqual(f.service.list().items, []);
  assert.throws(() => f.service.inspect(a.agent.resourceId), /not_authorized/);
  assert.throws(
    () =>
      f.service.create({
        commandId: "denied-project",
        title: "Denied",
        projectId: project.id,
        profile: profile(),
      }),
    /not_authorized/,
  );
  f.state.deniedProjects.clear();
  f.state.principal = "synthetic-other-owner";
  assert.deepEqual(f.service.list().items, []);
  assert.throws(
    () => f.service.inspect(a.agent.resourceId),
    /profile_unavailable/,
  );
  f.state.principal = "synthetic-owner";
  const bad = { ...profile(), authorized: true };
  assert.throws(
    () =>
      f.service.create({
        commandId: "forged",
        title: "Forged",
        projectId: null,
        profile: bad,
      }),
    /invalid_profile/,
  );
  f.close();
});
test("effective settings show exact inherited/override origins, catalog compatibility only, never native instruction replacement", () => {
  const f = fixture(),
    project = f.kernel.createProject("Synthetic configuration project"),
    custom = profile();
  custom.settings.additionalInstructions = {
    source: "override",
    value: "Synthetic user adjunct only.",
  };
  const a = f.create("configured", project.id, custom);
  const config = f.service.effective(a.agent);
  assert.equal(config.settings.reasoningEffort, "high");
  assert.equal(config.origins.reasoningEffort.scope, "project");
  assert.equal(
    config.settings.additionalInstructions,
    "Synthetic user adjunct only.",
  );
  assert.equal(config.origins.additionalInstructions.scope, "profile");
  assert.equal(config.verification, "catalog-only");
  assert.equal(config.configurationState, "supported");
  f.state.deniedProjects.add(project.id);
  const global = f.create("global");
  assert.throws(
    () => f.service.effective(global.agent, project.id),
    /not_authorized/,
  );
  f.close();
});
test("actual manual-compatibility Task reference freezes config and survives restart without agentic execution; unsupported execution reader fails closed", () => {
  const f = fixture(),
    a = f.create(),
    task = f.task();
  const input = f.assignmentInput("assignment", a.agent, task);
  const assignment = f.service.recordAssignment(input);
  assert.equal(assignment.referenceOnly, true);
  assert.equal(assignment.task.supportedTaskOrigin, "manual-compatibility");
  assert.equal(assignment.startsExecution, false);
  assert.equal(assignment.taskVerified, false);
  assert.equal(assignment.execution, null);
  assert.deepEqual(f.service.recordAssignment(input), assignment);
  const changed = profile();
  changed.settings.additionalInstructions = {
    source: "override",
    value: "Future profile only",
  };
  f.service.update({
    commandId: "future-settings",
    agent: a.agent,
    title: "Synthetic Researcher",
    profile: changed,
  });
  assert.deepEqual(f.service.assignment(assignment.id), assignment);
  assert.throws(
    () =>
      f.service.recordAssignment({
        ...input,
        commandId: "execution-ref",
        agent: f.service.inspect(a.agent.resourceId).ref,
        execution: { id: "unavailable-canonical-execution", revision: "1" },
      }),
    /execution_unavailable/,
  );
  assert.equal(
    f.db.prepare("SELECT count(*) n FROM agent_product_assignments").get()!.n,
    1,
  );
  f.close();
  const restarted = fixture(f.file);
  assert.deepEqual(restarted.service.assignment(assignment.id), assignment);
  restarted.close();
});
test("assignment rejects stale catalog/task versions, cross-project scope, unsupported config and permission revocation at final metadata gate", () => {
  const f = fixture(),
    p = f.kernel.createProject("Synthetic P"),
    q = f.kernel.createProject("Synthetic Q"),
    a = f.create("agent-P", p.id),
    taskQ = f.task(q.id);
  assert.throws(
    () =>
      f.service.recordAssignment({
        commandId: "foreign",
        agent: a.agent,
        task: taskQ,
        expectedCatalogRevision: f.state.catalogRevision,
        expectedConfigurationDigest: "0".repeat(64),
      }),
    /cross_project/,
  );
  const global = f.create("global-agent"),
    task = f.task(),
    oldCatalog = f.assignmentInput("stale-catalog", global.agent, task);
  f.state.catalogRevision = "synthetic-catalog-2";
  assert.throws(
    () => f.service.recordAssignment(oldCatalog),
    /catalog_conflict/,
  );
  const staleTask = f.assignmentInput("stale-task", global.agent, task);
  f.kernel.renameResource(task.id, "Task version changed", task.version);
  assert.throws(
    () => f.service.recordAssignment(staleTask),
    /task_unavailable/,
  );
  const actualTask = {
      id: task.id,
      version: f.kernel.getResource(task.id).resource.version,
    },
    revoked = f.assignmentInput("revoked", global.agent, actualTask);
  f.state.onCatalog = () => {
    f.state.allow = false;
  };
  assert.throws(() => f.service.recordAssignment(revoked), /not_authorized/);
  f.state.onCatalog = null;
  f.state.allow = true;
  const unsupported = profile();
  unsupported.settings.providerId = {
    source: "override",
    value: "unsupported-provider",
  };
  const u = f.create("unsupported", null, unsupported);
  assert.equal(f.service.effective(u.agent).configurationState, "unsupported");
  assert.throws(
    () =>
      f.service.recordAssignment(
        f.assignmentInput("unsupported-assignment", u.agent, actualTask),
      ),
    /configuration_not_supported/,
  );
  assert.equal(
    f.db.prepare("SELECT count(*) n FROM agent_product_assignments").get()!.n,
    0,
  );
  f.close();
});
test("reviewed effective digest rejects changed inherited settings and policy without replacing the immutable approved configuration", () => {
  const f = fixture(),
    a = f.create(),
    task = f.task(),
    input = f.assignmentInput("configuration-fence", a.agent, task),
    original = f.defaults.additionalInstructions;
  f.defaults.additionalInstructions =
    "Changed inherited instruction after review";
  assert.throws(
    () => f.service.recordAssignment(input),
    /configuration_conflict/,
  );
  assert.equal(
    f.db.prepare("SELECT count(*) n FROM agent_product_assignments").get()!.n,
    0,
  );
  f.defaults.additionalInstructions = original;
  f.state.policy = "policy-2";
  assert.throws(
    () => f.service.recordAssignment(input),
    /configuration_conflict/,
  );
  f.state.policy = "policy-1";
  const value = f.service.recordAssignment(input);
  assert.equal(value.configuration.digest, input.expectedConfigurationDigest);
  assert.equal(value.configuration.settings.additionalInstructions, original);
  f.state.deniedResources.add(a.agent.resourceId);
  assert.throws(
    () => f.service.recordAssignment(input),
    /resource_unavailable/,
  );
  assert.throws(() => f.service.assignment(value.id), /resource_unavailable/);
  f.close();
});
test("future/partial module schemas and wrong transaction connection fail closed without reset or canonical side effects", () => {
  const f = fixture();
  f.create();
  f.db.prepare("UPDATE agent_product_schema SET version=2").run();
  const before = f.db.prepare("SELECT total_changes() n").get()!.n;
  assert.throws(() => new AgentLibraryService(f.options), /unsupported_schema/);
  assert.equal(f.db.prepare("SELECT total_changes() n").get()!.n, before);
  f.db.prepare("UPDATE agent_product_schema SET version=1").run();
  f.db.exec("DROP TABLE agent_product_operations");
  assert.throws(() => new AgentLibraryService(f.options), /partial_schema/);
  f.close();
  const other = fixture(),
    foreign = new DatabaseSync(":memory:");
  assert.throws(
    () =>
      new AgentLibraryService({
        ...other.options,
        transaction: (work) => work(foreign),
      }),
    /database_mismatch/,
  );
  foreign.close();
  other.close();
});
test("FK and digests protect canonical identities and immutable config receipts from dangling/tampered rows", () => {
  const f = fixture(),
    a = f.create(),
    task = f.task(),
    assignment = f.service.recordAssignment(
      f.assignmentInput("digest-assignment", a.agent, task),
    );
  assert.throws(
    () =>
      f.db.prepare("DELETE FROM resources WHERE id=?").run(a.agent.resourceId),
    /FOREIGN KEY/,
  );
  const tampered = structuredClone(assignment);
  tampered.configuration.settings.additionalInstructions = "tampered";
  f.db
    .prepare("UPDATE agent_product_assignments SET receipt_json=? WHERE id=?")
    .run(JSON.stringify(tampered), assignment.id);
  assert.throws(
    () => f.service.assignment(assignment.id),
    /assignment_corrupt/,
  );
  f.db
    .prepare(
      "UPDATE agent_product_versions SET data_json=? WHERE resource_id=?",
    )
    .run(
      JSON.stringify({ ...profile(), purpose: "tampered" }),
      a.agent.resourceId,
    );
  assert.throws(() => f.service.inspect(a.agent.resourceId), /profile_corrupt/);
  f.close();
});
