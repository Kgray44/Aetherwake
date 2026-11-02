import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { WorkspaceKernel } from "../../workspace-kernel/kernel.mts";
import { WorkspaceEngine } from "../../workspace-engine/engine.mts";
import { DesktopState } from "../../integrated-backend/src/desktop.mts";
import { ConversationGraph } from "../../connected-conversations/src/graph.ts";
import { mockOrdinaryAdapter } from "../../connected-conversations/src/adapters.ts";
import {
  createCanonicalTemplateHost,
  type CanonicalTemplateHostOptions,
  type TaskGroupMembershipCommand,
} from "../canonical-host.mts";
import { TemplateService } from "../service.mts";
import { predefinedTemplates } from "../model.ts";
import { BUILTIN_BLOCKS } from "../registry.ts";
import {
  blockCapabilities,
  resolveBlockType,
  validateConfiguration,
} from "../registry.ts";
import type {
  BlockKind,
  LibraryCapabilities,
  TemplateApplyInput,
} from "../contracts.ts";

function fixture(t: any) {
  const kernel = WorkspaceKernel.open(":memory:"),
    db = kernel.withTransaction((db) => db),
    desktop = new DesktopState(kernel, db),
    engine = new WorkspaceEngine(kernel);
  t.after(() => kernel.close());
  const revoked = new Set<string>(),
    groupCommands: TaskGroupMembershipCommand[] = [],
    factoryCalls: { kind: BlockKind; projectId: string | null }[] = [];
  // The graph and mapping here are the parent's test-owned canonical state, never adapter state. No provider turn is invoked.
  let graph = new ConversationGraph([mockOrdinaryAdapter()]),
    mappings: Record<string, string> = {},
    failMembership = false;
  const capabilities: LibraryCapabilities = {
    revision: 1,
    kinds: Object.fromEntries(
      BUILTIN_BLOCKS.map((b) => [b.kind, { state: "available" }]),
    ),
    providers: {
      local: { state: "available" },
      codex: { state: "setup_required" },
    },
    velaPlanning: { state: "unsupported" },
  };
  const options: CanonicalTemplateHostOptions = {
    db,
    kernel,
    engine,
    capabilities: () => capabilities,
    atomic<T>(operation: () => T): T {
      const before = graph.snapshot(),
        previous = { ...mappings };
      try {
        return kernel.withTransaction(operation);
      } catch (error) {
        graph = new ConversationGraph([mockOrdinaryAdapter()], before);
        mappings = previous;
        throw error;
      }
    },
    createResource(kind, title, _provider, projectId) {
      factoryCalls.push({ kind, projectId });
      const resource =
        kind === "conversation"
          ? kernel.createConversationRef(title, projectId)
          : kernel.createNote(title, "", projectId);
      db.prepare(
        "INSERT INTO desktop_resources(resource_id,kind) VALUES(?,?)",
      ).run(resource.id, kind);
      if (kind === "conversation")
        mappings[resource.id] = graph.createChat(
          "ordinary",
          "mock-ordinary",
          title,
        ).id;
      return resource.id;
    },
    resourceKind(id) {
      const row = db
        .prepare("SELECT kind FROM desktop_resources WHERE resource_id=?")
        .get(id);
      return (row?.kind ?? kernel.getResource(id).resource.kind) as BlockKind;
    },
    navigateWorkspace(workspaceId) {
      desktop.apply(
        { type: "navigate", target: { kind: "workspace", workspaceId } },
        () => {
          throw new Error("unexpected_conversation_creation");
        },
      );
    },
    setTaskGroupMembers(command) {
      groupCommands.push(structuredClone(command));
      desktop.apply(command, () => {
        throw new Error("unexpected_conversation_creation");
      });
      if (failMembership)
        throw new Error("synthetic_parent_membership_failure");
    },
    isAuthorized({ id }) {
      return !revoked.has(id);
    },
  };
  const host = createCanonicalTemplateHost(options),
    service = new TemplateService(db, host);
  return {
    kernel,
    db,
    desktop,
    engine,
    host,
    service,
    options,
    revoked,
    groupCommands,
    factoryCalls,
    get graph() {
      return graph;
    },
    get mappings() {
      return mappings;
    },
    failMembership() {
      failMembership = true;
    },
    allowMembership() {
      failMembership = false;
    },
  };
}
const request = (
  extra: Partial<TemplateApplyInput> = {},
): TemplateApplyInput => ({
  commandId: randomUUID(),
  templateId: "builtin:development",
  expectedVersion: 1,
  title: "Synthetic adapter workspace",
  projectId: null,
  ...extra,
});
const count = (db: CanonicalTemplateHostOptions["db"], table: string) => {
  assert.ok(
    [
      "workspaces",
      "resources",
      "blocks",
      "relationships",
      "block_library_receipts",
    ].includes(table),
  );
  return Number(db.prepare("SELECT count(*) AS n FROM " + table).get()!.n);
};

test("factory requires the identical kernel, engine and SQLite connection and delegates parent atomic", (t) => {
  const fixtureA = fixture(t),
    fixtureB = fixture(t);
  assert.throws(
    () => createCanonicalTemplateHost({ ...fixtureA.options, db: fixtureB.db }),
    /canonical_connection_required/,
  );
  assert.throws(
    () =>
      createCanonicalTemplateHost({
        ...fixtureA.options,
        engine: fixtureB.engine,
      }),
    /canonical_engine_required/,
  );
  assert.equal(fixtureA.host.db, fixtureA.db);
  let atomicCalls = 0;
  const host = createCanonicalTemplateHost({
    ...fixtureA.options,
    atomic<T>(operation: () => T): T {
      atomicCalls++;
      return fixtureA.options.atomic(operation);
    },
  });
  assert.equal(
    host.atomic(() => 42),
    42,
  );
  assert.equal(atomicCalls, 1);
});

test("adapter applies actual engine commands, canonical parent conversation mapping and actual DesktopState membership", (t) => {
  const f = fixture(t),
    project = f.kernel.createProject("Synthetic adapter project"),
    applied = f.service.applyTemplate(
      request({ projectId: project.id, expectedProjectVersion: 1 }),
    );
  const template = f.service.getTemplate("builtin:development"),
    state = f.engine.project(applied.workspaceId);
  assert.equal(state.organization.mode, "structured");
  assert.equal(state.presence.width, 208);
  assert.equal(state.presence.height, 260);
  assert.equal(state.presence.scale, 0.65);
  assert.equal(f.factoryCalls.length, 4);
  assert.equal(
    f.factoryCalls.every((call) => call.projectId === project.id),
    true,
  );
  const conversationRole = template.body.resources.find(
    (role) => role.source.kind === "conversation",
  )!;
  assert.equal(f.graph.snapshot().conversations.length, 1);
  assert.ok(f.mappings[applied.resourceIds[conversationRole.key]]);
  assert.equal(f.graph.snapshot().messages.length, 0);
  assert.equal(f.groupCommands.length, 1);
  assert.equal(f.groupCommands[0].type, "setTaskGroupMembers");
  assert.equal(f.groupCommands[0].expectedVersion, 1);
  const groupId = applied.resourceIds[template.body.groups[0].groupKey];
  assert.equal(f.kernel.getResource(groupId).resource.version, 2);
  const snapshot = f.desktop.snapshot(() => ({
    provider: "local",
    messages: [],
  }));
  assert.equal(snapshot.activeWorkspaceId, applied.workspaceId);
  assert.equal(snapshot.navigation.kind, "workspace");
  assert.equal(
    snapshot.resources.find((resource) => resource.id === groupId)?.taskMembers
      ?.length,
    1,
  );
  assert.deepEqual(
    new Set(
      state.organization.structured.order.filter((id) => id !== "system:vela"),
    ),
    new Set(Object.values(applied.placementIds)),
  );
  f.kernel.assertIntegrity();
});

test("Freeform overlap, presentation, viewport and same-ID shared placements survive adapter application", (t) => {
  const f = fixture(t),
    resource = f.kernel.createNote(
      "Synthetic reusable source",
      "Synthetic retained content",
    );
  f.db
    .prepare("INSERT INTO desktop_resources(resource_id,kind) VALUES(?,?)")
    .run(resource.id, "note");
  const body = predefinedTemplates()[1].body;
  body.organization.mode = "freeform";
  body.viewport = { x: 25, y: 45, zoom: 0.75 };
  body.resources = [
    {
      key: "shared",
      label: "Synthetic reused note",
      source: {
        mode: "reference",
        kind: "note",
        resourceId: resource.id,
        expectedVersion: 1,
      },
    },
  ];
  body.groups = [];
  body.placements = body.placements
    .slice(0, 2)
    .map((p, i) => ({
      ...p,
      key: "placement" + i,
      resourceKey: "shared",
      presentation: {
        ...p.presentation,
        x: 120,
        y: 140,
        shape: i ? "lens" : "folio",
        rotation: i ? 15 : 0,
        minimized: i === 1,
        materialVariant: "default",
      },
      span: { columns: 2, rows: 3 },
    }));
  const template = f.service.saveTemplate({
    name: "Synthetic intentional overlap",
    description: "Synthetic adapter test",
    tags: [],
    body,
  });
  const applied = f.service.applyTemplate(request({ templateId: template.id })),
    state = f.engine.project(applied.workspaceId);
  assert.equal(state.organization.mode, "freeform");
  assert.deepEqual(state.viewport, body.viewport);
  assert.equal(state.blocks.length, 2);
  assert.equal(new Set(state.blocks.map((b) => b.blockId)).size, 2);
  assert.equal(
    state.blocks.every(
      (b) => b.resourceId === resource.id && b.x === 120 && b.y === 140,
    ),
    true,
  );
  assert.deepEqual(
    new Set(state.blocks.map((b) => b.shape)),
    new Set(["folio", "lens"]),
  );
  assert.equal(state.blocks.find((b) => b.shape === "lens")?.rotation, 15);
  assert.equal(state.blocks.find((b) => b.shape === "lens")?.minimized, true);
  assert.equal(
    f.kernel.getResource(resource.id).note.content,
    "Synthetic retained content",
  );
  assert.equal(f.kernel.getResource(resource.id).resource.project_id, null);
  assert.equal(f.factoryCalls.length, 0);
});

test("archived owner projects and effective revoked grants hide active resources/workspaces and refuse creation", (t) => {
  const f = fixture(t),
    project = f.kernel.createProject("Synthetic visibility project"),
    workspace = f.engine.createWorkspace(
      "Synthetic active workspace",
      project.id,
    ),
    resource = f.kernel.createNote("Synthetic active source", "", project.id);
  f.db
    .prepare("INSERT INTO desktop_resources(resource_id,kind) VALUES(?,?)")
    .run(resource.id, "note");
  assert.equal(f.host.readProject(project.id)?.authorized, true);
  assert.equal(f.host.readResource(resource.id)?.authorized, true);
  assert.equal(f.host.readWorkspace(workspace.workspaceId)?.authorized, true);
  f.kernel.setProjectArchived(project.id, true, 1);
  assert.equal(f.host.readProject(project.id)?.authorized, false);
  assert.equal(f.host.readResource(resource.id)?.authorized, false);
  assert.equal(f.host.readWorkspace(workspace.workspaceId)?.authorized, false);
  assert.throws(
    () =>
      f.host.atomic(() =>
        f.host.createResource({
          kind: "note",
          title: "Synthetic denied",
          projectId: project.id,
        }),
      ),
    /project_unavailable/,
  );
  f.kernel.setProjectArchived(project.id, false, 2);
  f.revoked.add(resource.id);
  f.revoked.add(workspace.workspaceId);
  assert.equal(f.host.readResource(resource.id)?.authorized, false);
  assert.equal(f.host.readWorkspace(workspace.workspaceId)?.authorized, false);
  assert.throws(
    () =>
      f.service.createBlock({
        commandId: "denied-workspace",
        kind: "note",
        title: "Synthetic denied",
        workspaceId: workspace.workspaceId,
        expectedLayoutVersion: workspace.revision,
      }),
    /workspace_unavailable/,
  );
  f.revoked.clear();
  f.revoked.add(project.id);
  assert.equal(f.host.readResource(resource.id)?.authorized, false);
  assert.equal(f.host.readWorkspace(workspace.workspaceId)?.authorized, false);
});

test("adapter uses current real engine revision fences and refuses role order/spans targeting system presence", (t) => {
  const f = fixture(t),
    workspace = f.engine.createWorkspace("Synthetic fence workspace"),
    before = workspace.revision;
  const created = f.service.createBlock({
    commandId: "adapter-create-one",
    kind: "note",
    title: "Synthetic versioned note",
    workspaceId: workspace.workspaceId,
    expectedLayoutVersion: before,
  });
  assert.ok(
    f.host.readWorkspace(workspace.workspaceId)!.layoutVersion > before,
  );
  assert.throws(
    () =>
      f.service.createBlock({
        commandId: "adapter-stale",
        kind: "note",
        title: "Synthetic stale note",
        workspaceId: workspace.workspaceId,
        expectedLayoutVersion: before,
      }),
    /layout_version_conflict/,
  );
  const state = f.engine.project(workspace.workspaceId);
  assert.throws(
    () =>
      f.host.atomic(() =>
        f.host.setOrganization({
          workspaceId: workspace.workspaceId,
          organization: {
            mode: "structured",
            structured: { order: ["system:vela"] },
          },
          viewport: state.viewport,
        }),
      ),
    /invalid_template_placement_order/,
  );
  assert.throws(
    () =>
      f.host.atomic(() =>
        f.host.setOrganization({
          workspaceId: workspace.workspaceId,
          organization: {
            mode: "structured",
            structured: {
              order: [created.placementId],
              spans: { "system:vela": { columns: 2, rows: 2 } },
            },
          },
          viewport: state.viewport,
        }),
      ),
    /invalid_template_span_target/,
  );
  assert.deepEqual(f.engine.project(workspace.workspaceId), state);
  f.host.atomic(() =>
    f.host.setOrganization({
      workspaceId: workspace.workspaceId,
      organization: {
        mode: "structured",
        structured: {
          order: [created.placementId],
          spans: { [created.placementId]: { columns: 2, rows: 3 } },
        },
      },
      viewport: { x: 20, y: 30, zoom: 0.8 },
    }),
  );
  assert.equal(
    f.engine.project(workspace.workspaceId).organization.mode,
    "structured",
  );
  assert.deepEqual(f.engine.project(workspace.workspaceId).viewport, {
    x: 20,
    y: 30,
    zoom: 0.8,
  });
});

test("actual parent membership failure rolls back canonical graph, session, workspace, subjects and placements", (t) => {
  const f = fixture(t),
    prior = f.engine.createWorkspace("Synthetic retained workspace");
  f.desktop.apply(
    {
      type: "navigate",
      target: { kind: "workspace", workspaceId: prior.workspaceId },
    },
    () => {
      throw new Error("unexpected");
    },
  );
  const before = [
      "workspaces",
      "resources",
      "blocks",
      "relationships",
      "block_library_receipts",
    ].map((table) => count(f.db, table)),
    graphBefore = f.graph.snapshot(),
    sessionBefore = f.desktop.snapshot(() => ({
      provider: "local",
      messages: [],
    }));
  f.failMembership();
  const input = request();
  assert.throws(
    () => f.service.applyTemplate(input),
    /synthetic_parent_membership_failure/,
  );
  assert.deepEqual(
    [
      "workspaces",
      "resources",
      "blocks",
      "relationships",
      "block_library_receipts",
    ].map((table) => count(f.db, table)),
    before,
  );
  assert.deepEqual(f.graph.snapshot(), graphBefore);
  assert.deepEqual(f.mappings, {});
  assert.equal(
    f.desktop.snapshot(() => ({ provider: "local", messages: [] }))
      .activeWorkspaceId,
    sessionBefore.activeWorkspaceId,
  );
  assert.equal(f.engine.activeWorkspaceId(), prior.workspaceId);
  f.allowMembership();
  assert.ok(f.service.applyTemplate(input).workspaceId);
  assert.equal(f.graph.snapshot().conversations.length, 1);
  f.kernel.assertIntegrity();
});

test("parent resource factory may not return an existing identity or create with a wrong owner", (t) => {
  const f = fixture(t),
    resource = f.kernel.createNote("Synthetic existing identity", "");
  f.db
    .prepare("INSERT INTO desktop_resources(resource_id,kind) VALUES(?,?)")
    .run(resource.id, "note");
  const existing = createCanonicalTemplateHost({
    ...f.options,
    createResource: () => resource.id,
  });
  assert.throws(
    () =>
      existing.atomic(() =>
        existing.createResource({
          kind: "note",
          title: "Synthetic new requested",
          projectId: null,
        }),
      ),
    /resource_factory_must_create_new/,
  );
  const project = f.kernel.createProject("Synthetic target owner"),
    before = count(f.db, "resources");
  const wrong = createCanonicalTemplateHost({
    ...f.options,
    createResource(kind, title) {
      return f.options.createResource(kind, title, undefined, null);
    },
  });
  assert.throws(
    () =>
      wrong.atomic(() =>
        wrong.createResource({
          kind: "note",
          title: "Synthetic wrong owner",
          projectId: project.id,
        }),
      ),
    /created_resource_scope_mismatch/,
  );
  assert.equal(count(f.db, "resources"), before);
});

test("attachment discovers only authorized compatible resources and preserves one edited subject across placements", (t) => {
  const f = fixture(t),
    project = f.kernel.createProject("Synthetic library target"),
    other = f.kernel.createProject("Synthetic other project"),
    workspace = f.engine.createWorkspace(
      "Synthetic attach workspace",
      project.id,
      { mode: "freeform" },
    );
  const note = f.options.createResource(
      "note",
      "Synthetic reusable note",
      undefined,
      project.id,
    ),
    global = f.options.createResource(
      "note",
      "Synthetic global note",
      undefined,
      null,
    ),
    foreign = f.options.createResource(
      "note",
      "Synthetic foreign note",
      undefined,
      other.id,
    ),
    hidden = f.options.createResource(
      "note",
      "Synthetic hidden note",
      undefined,
      project.id,
    );
  f.revoked.add(hidden);
  const page = f.service.findResources({
    workspaceId: workspace.workspaceId,
    kind: "note",
    query: "synthetic",
  });
  assert.deepEqual(
    new Set(page.resources.map((r) => r.id)),
    new Set([note, global]),
  );
  assert.equal(
    page.resources.some((r) => r.id === foreign || r.id === hidden),
    false,
  );
  const input = {
    commandId: "attach-canonical",
    workspaceId: workspace.workspaceId,
    expectedLayoutVersion: workspace.revision,
    kind: "note" as const,
    resourceId: note,
    expectedResourceVersion: 1,
  };
  const a = f.service.attachBlock(input);
  assert.deepEqual(f.service.attachBlock(input), a);
  assert.equal(f.factoryCalls.length, 4);
  f.desktop.apply(
    {
      type: "content",
      resourceId: note,
      expectedVersion: 1,
      content: "Synthetic retained text",
    },
    () => {
      throw new Error("unexpected");
    },
  );
  const before = f.engine.project(workspace.workspaceId),
    b = f.service.attachBlock({
      ...input,
      commandId: "attach-second",
      expectedLayoutVersion: before.revision,
      expectedResourceVersion: 2,
    });
  assert.notEqual(a.placementId, b.placementId);
  assert.equal(a.resourceId, b.resourceId);
  assert.equal(
    f.kernel.getResource(note).note.content,
    "Synthetic retained text",
  );
  assert.throws(
    () =>
      f.service.attachBlock({
        ...input,
        commandId: "attach-stale",
        expectedLayoutVersion: f.engine.project(workspace.workspaceId).revision,
      }),
    /reference_version_conflict/,
  );
  assert.throws(
    () =>
      f.service.attachBlock({
        ...input,
        commandId: "attach-foreign",
        resourceId: foreign,
        expectedLayoutVersion: f.engine.project(workspace.workspaceId).revision,
      }),
    /cross_project_reference/,
  );
  f.revoked.add(note);
  assert.throws(
    () =>
      f.service.attachBlock({
        ...input,
        commandId: "attach-revoked",
        expectedLayoutVersion: f.engine.project(workspace.workspaceId).revision,
        expectedResourceVersion: 2,
      }),
    /reference_unavailable/,
  );
  assert.equal(f.engine.project(workspace.workspaceId).blocks.length, 2);
  f.kernel.assertIntegrity();
});

test("placement settings have independent revisions and never mutate canonical content or geometry", (t) => {
  const f = fixture(t),
    workspace = f.engine.createWorkspace("Synthetic settings workspace", null, {
      mode: "freeform",
    });
  // A standalone workspace is required; no inferred project or provider permission is involved.
  const first = f.service.createBlock({
    commandId: "settings-note",
    workspaceId: workspace.workspaceId,
    expectedLayoutVersion: workspace.revision,
    kind: "note",
    title: "Synthetic settings note",
  });
  const second = f.service.attachBlock({
    commandId: "settings-second",
    workspaceId: workspace.workspaceId,
    expectedLayoutVersion: f.engine.project(workspace.workspaceId).revision,
    kind: "note",
    resourceId: first.resourceId,
    expectedResourceVersion: 1,
  });
  const before = f.engine.project(workspace.workspaceId),
    settings = f.service.getBlockSettings(first.placementId);
  const changed = f.service.configureBlock({
    placementId: first.placementId,
    expectedVersion: settings.version,
    configuration: { schemaVersion: 1, textScale: 1.5, contentMode: "reading" },
  });
  assert.equal(changed.version, 2);
  assert.equal(
    f.service.getBlockSettings(second.placementId).configuration.textScale,
    1,
  );
  assert.equal(f.kernel.getResource(first.resourceId).resource.version, 1);
  assert.deepEqual(f.engine.project(workspace.workspaceId), before);
  f.engine.execute({
    type: "undoLayout",
    commandId: randomUUID(),
    workspaceId: workspace.workspaceId,
    expectedRevision: before.revision,
  });
  assert.equal(
    f.service.getBlockSettings(first.placementId).configuration.textScale,
    1.5,
  );
  const undone = f.engine.project(workspace.workspaceId);
  f.engine.execute({
    type: "redoLayout",
    commandId: randomUUID(),
    workspaceId: workspace.workspaceId,
    expectedRevision: undone.revision,
  });
  assert.equal(
    f.service.getBlockSettings(second.placementId).configuration.textScale,
    1,
  );
  assert.throws(
    () =>
      f.service.configureBlock({
        placementId: first.placementId,
        expectedVersion: 1,
        configuration: { schemaVersion: 1, textScale: 1, contentMode: "auto" },
      }),
    /block_configuration_conflict/,
  );
  assert.throws(
    () =>
      validateConfiguration({
        schemaVersion: 1,
        textScale: 1,
        contentMode: "auto",
        messages: ["not permitted"],
      }),
    /invalid_block_configuration/,
  );
  f.db
    .prepare(
      "UPDATE block_library_instances SET manifest_version=99 WHERE placement_id=?",
    )
    .run(first.placementId);
  assert.throws(
    () => f.service.getBlockSettings(first.placementId),
    /unsupported_block_manifest_version/,
  );
  assert.equal(
    f.db
      .prepare(
        "SELECT manifest_version FROM block_library_instances WHERE placement_id=?",
      )
      .get(first.placementId)?.manifest_version,
    99,
  );
});

test("manifest and capability discovery distinguish immutable definitions, local use and disconnected execution", (t) => {
  const f = fixture(t);
  assert.equal(Object.isFrozen(BUILTIN_BLOCKS[0].defaultConfiguration), true);
  assert.equal(resolveBlockType("aerynth.note", 1).state, "available");
  assert.equal(resolveBlockType("aerynth.note", 99).state, "unsupported");
  assert.equal(resolveBlockType("missing.plugin", 1).state, "unsupported");
  const states = blockCapabilities(
    "conversation",
    f.service.capabilities(),
    "codex",
  );
  assert.equal(
    states.find((s) => s.id === "read")?.availability.state,
    "available",
  );
  assert.equal(
    states.find((s) => s.id === "provider-execution")?.availability.state,
    "setup_required",
  );
  assert.equal(
    blockCapabilities("conversation", f.service.capabilities(), "local").find(
      (s) => s.id === "provider-execution",
    )?.availability.state,
    "unsupported",
  );
  const preference = f.service.preferences(),
    favorite = f.service.setFavorite({
      kind: "note",
      favorite: true,
      expectedVersion: preference.version,
    });
  assert.deepEqual(favorite.favorites, ["note"]);
  assert.throws(
    () =>
      f.service.setFavorite({
        kind: "task",
        favorite: true,
        expectedVersion: preference.version,
      }),
    /preferences_version_conflict/,
  );
});
