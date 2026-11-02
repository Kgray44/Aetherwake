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
import { predefinedTemplates, captureWorkspaceTemplate } from "../model.ts";
import { BUILTIN_BLOCKS } from "../registry.ts";
import {
  blockCapabilities,
  resolveBlockType,
  validateConfiguration,
  REGISTERED_BLOCKS,
  BLOCK_DEFAULT_SIZES,
} from "../registry.ts";
import { limits } from "../../workspace-engine/geometry.mts";
import type {
  BlockKind,
  LibraryCapabilities,
  TemplateApplyInput,
} from "../contracts.ts";

function fixture(t: any) {
  const kernel = WorkspaceKernel.open(":memory:"),
    db = kernel.withTransaction((db) => db),
    desktop = new DesktopState(kernel, db, {
      allowSubjectAttachment: () => true,
    }),
    engine = desktop.nativeBlockServices().engine;
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
    authorizeSubject(subject) {
      return subject.kind === "project"
        ? !revoked.has(subject.projectId)
        : subject.kind === "collection"
          ? !revoked.has(subject.collectionId)
          : (!subject.projectId || !revoked.has(subject.projectId)) &&
            (!subject.collectionId || !revoked.has(subject.collectionId));
    },
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

test("every new block kind uses its distinct preferred geometry without rewriting resized placements or explicit templates", (t) => {
  const f = fixture(t),
    project = f.kernel.createProject("Synthetic size project"),
    collection = f.kernel.createCollection(
      "Synthetic size collection",
      project.id,
    ),
    workspace = f.engine.createWorkspace(
      "Synthetic preferred sizes",
      project.id,
      { mode: "freeform" },
    );
  f.options.capabilities().subjects = {
    project_overview: { state: "available" },
    resource_browser: { state: "available" },
    collection_browser: { state: "available" },
  };
  const sizes = new Set<string>();
  for (const manifest of REGISTERED_BLOCKS) {
    const base = {
      commandId: "default-size:" + manifest.kind,
      workspaceId: workspace.workspaceId,
      expectedLayoutVersion: f.engine.project(workspace.workspaceId).revision,
    };
    const created =
      manifest.kind === "project_overview"
        ? f.service.createSubjectBlock({
            ...base,
            kind: manifest.kind,
            subject: { kind: "project", projectId: project.id },
          })
        : manifest.kind === "resource_browser"
          ? f.service.createSubjectBlock({
              ...base,
              kind: manifest.kind,
              subject: {
                kind: "resource-query",
                projectId: project.id,
                query: "",
              },
            })
          : manifest.kind === "collection_browser"
            ? f.service.createSubjectBlock({
                ...base,
                kind: manifest.kind,
                subject: { kind: "collection", collectionId: collection.id },
              })
            : f.service.createBlock({
                ...base,
                kind: manifest.kind,
                title: "Synthetic " + manifest.kind,
              });
    const placed = f.engine
      .project(workspace.workspaceId)
      .blocks.find((b) => b.blockId === created.placementId)!;
    const preferred = BLOCK_DEFAULT_SIZES[manifest.kind];
    assert.deepEqual({ width: placed.width, height: placed.height }, preferred);
    assert.ok(
      placed.width >= limits.minWidth && placed.height >= limits.minHeight,
    );
    assert.ok(
      placed.width <= limits.maxSize && placed.height <= limits.maxSize,
    );
    sizes.add(placed.width + "x" + placed.height);
  }
  assert.equal(sizes.size, REGISTERED_BLOCKS.length);
  assert.ok(
    BLOCK_DEFAULT_SIZES.conversation.height >
      BLOCK_DEFAULT_SIZES.conversation.width * 1.5,
  );
  const before = f.engine.project(workspace.workspaceId),
    first = before.blocks[0];
  f.engine.execute({
    type: "resizeBlock",
    commandId: randomUUID(),
    workspaceId: workspace.workspaceId,
    expectedRevision: before.revision,
    blockId: first.blockId,
    width: 635,
    height: 415,
  });
  const resized = f.engine.project(workspace.workspaceId);
  const explicit = f.service.createBlock({
    commandId: "explicit-size",
    workspaceId: workspace.workspaceId,
    expectedLayoutVersion: resized.revision,
    kind: "note",
    title: "Synthetic explicit geometry",
    presentation: { width: 708, height: 352 },
  });
  // A fresh service/catalog read and template preview must not migrate stored geometry.
  const reopened = new TemplateService(f.db, f.host);
  reopened.discoverBlocks();
  reopened.previewTemplate(request());
  const after = f.engine.project(workspace.workspaceId);
  assert.deepEqual(
    after.blocks.find((b) => b.blockId === first.blockId),
    resized.blocks[0],
  );
  const custom = after.blocks.find((b) => b.blockId === explicit.placementId)!;
  assert.deepEqual(
    { width: custom.width, height: custom.height },
    { width: 708, height: 352 },
  );
});

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
  body.placements = body.placements.slice(0, 2).map((p, i) => ({
    ...p,
    key: "placement" + i,
    resourceKey: "shared",
    subjectBinding: undefined,
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

test("attachment filters narrow the current workspace fence by project and authorized collection without writes", (t) => {
  const f = fixture(t),
    project = f.kernel.createProject("Synthetic filter target"),
    other = f.kernel.createProject("Synthetic other scope"),
    workspace = f.engine.createWorkspace(
      "Synthetic filtered workspace",
      project.id,
    ),
    standalone = f.engine.createWorkspace("Synthetic independent workspace"),
    note = f.options.createResource(
      "note",
      "Synthetic target note",
      undefined,
      project.id,
    ),
    global = f.options.createResource(
      "note",
      "Synthetic unassigned note",
      undefined,
      null,
    ),
    foreign = f.options.createResource(
      "note",
      "Synthetic foreign note",
      undefined,
      other.id,
    ),
    collection = f.kernel.createCollection(
      "Synthetic authorized collection",
      other.id,
    );
  f.kernel.addToCollection(collection.id, note);
  f.kernel.addToCollection(collection.id, global);
  f.kernel.addToCollection(collection.id, foreign);
  const before = ["resources", "blocks", "relationships", "workspaces"].map(
    (table) => count(f.db, table),
  );
  const query = { workspaceId: workspace.workspaceId, kind: "note" as const };
  assert.deepEqual(
    new Set(
      f.service.findResources(query).resources.map((resource) => resource.id),
    ),
    new Set([note, global]),
  );
  assert.deepEqual(
    f.service
      .findResources({ ...query, projectScope: "workspace-project" })
      .resources.map((resource) => resource.id),
    [note],
  );
  assert.deepEqual(
    f.service
      .findResources({ ...query, projectScope: "unassigned" })
      .resources.map((resource) => resource.id),
    [global],
  );
  assert.deepEqual(
    new Set(
      f.service
        .findResources({ ...query, collectionId: collection.id })
        .resources.map((resource) => resource.id),
    ),
    new Set([note, global]),
    "An accessible foreign collection does not grant attachment of its foreign-owned member",
  );
  assert.deepEqual(
    f.service
      .findResources({
        ...query,
        projectScope: "unassigned",
        collectionId: collection.id,
      })
      .resources.map((resource) => resource.id),
    [global],
  );
  assert.deepEqual(
    f.service.findResources({
      ...query,
      workspaceId: standalone.workspaceId,
      projectScope: "workspace-project",
    }).resources,
    [],
  );
  assert.throws(
    () =>
      f.service.findResources({
        ...query,
        projectScope: "all-projects" as never,
      }),
    /invalid_resource_query/,
  );
  f.options.capabilities().discoveryFilters = {
    project: { state: "disabled" },
    collection: { state: "unsupported" },
  };
  assert.throws(
    () => f.service.findResources({ ...query, projectScope: "unassigned" }),
    /project_filter_unavailable/,
  );
  assert.throws(
    () => f.host.findResources!({ ...query, projectScope: "unassigned" }),
    /project_filter_unavailable/,
  );
  assert.throws(
    () => f.service.findResources({ ...query, collectionId: collection.id }),
    /collection_filter_unavailable/,
  );
  assert.equal(
    f.service.findResources(query).resources.length,
    2,
    "Ordinary compatible search still works when filters are disabled",
  );
  assert.deepEqual(
    ["resources", "blocks", "relationships", "workspaces"].map((table) =>
      count(f.db, table),
    ),
    before,
  );
});

test("collection discovery rechecks actual grants and archive state on every page without exposing retained members", (t) => {
  const f = fixture(t),
    project = f.kernel.createProject("Synthetic restricted collection project"),
    workspace = f.engine.createWorkspace("Synthetic restricted picker"),
    collection = f.kernel.createCollection(
      "Synthetic private collection",
      project.id,
    ),
    note = f.options.createResource(
      "note",
      "Synthetic retained member",
      undefined,
      null,
    );
  f.kernel.addToCollection(collection.id, note);
  const query = {
    workspaceId: workspace.workspaceId,
    kind: "note" as const,
    collectionId: collection.id,
  };
  assert.equal(f.service.findResources(query).resources[0].id, note);
  f.revoked.add(collection.id);
  assert.throws(() => f.service.findResources(query), /subject_unavailable/);
  assert.throws(
    () => f.host.findResources!(query),
    /subject_unavailable/,
    "Direct adapter calls also retain the subject grant boundary",
  );
  f.revoked.delete(collection.id);
  f.revoked.add(project.id);
  assert.throws(() => f.service.findResources(query), /subject_unavailable/);
  f.revoked.delete(project.id);
  f.kernel.setCollectionArchived(collection.id, true, 1);
  assert.throws(() => f.service.findResources(query), /subject_unavailable/);
  assert.throws(
    () =>
      f.service.findResources({ ...query, collectionId: "missing:collection" }),
    /subject_unavailable/,
  );
  assert.equal(f.kernel.getResource(note).note.content, "");
  assert.equal(f.kernel.listCollection(collection.id)[0].id, note);
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

test("Vela workspaceFromResources uses the template pipeline, returns same canonical IDs and a durable retry receipt", (t) => {
  const f = fixture(t),
    project = f.kernel.createProject("Synthetic construction project"),
    note = f.options.createResource(
      "note",
      "Synthetic construction note",
      undefined,
      project.id,
    ),
    task = f.options.createResource(
      "task",
      "Synthetic construction task",
      undefined,
      project.id,
    );
  const input = {
    commandId: "native-composition",
    title: "Synthetic native workspace",
    projectId: project.id,
    expectedProjectVersion: 1,
    resources: [
      { resourceId: note, expectedVersion: 1 },
      { resourceId: task, expectedVersion: 1 },
    ],
    organization: { mode: "structured" as const },
  };
  const before = [
    "workspaces",
    "resources",
    "blocks",
    "block_library_receipts",
  ].map((table) => count(f.db, table));
  const preview = f.service.previewWorkspaceFromResources(input);
  assert.deepEqual(preview.resourceIds, [note, task]);
  assert.deepEqual(
    ["workspaces", "resources", "blocks", "block_library_receipts"].map(
      (table) => count(f.db, table),
    ),
    before,
  );
  const result = f.service.workspaceFromResources(input);
  assert.deepEqual(result.resourceIds, [note, task]);
  assert.equal(result.receipt.workspaceId, result.createdWorkspaceId);
  assert.equal(result.receipt.operation, "workspaceFromResources");
  assert.equal(
    f.engine.project(result.createdWorkspaceId).organization.mode,
    "structured",
  );
  assert.deepEqual(
    new Set(
      f.engine
        .project(result.createdWorkspaceId)
        .blocks.map((b) => b.resourceId),
    ),
    new Set([note, task]),
  );
  assert.equal(f.factoryCalls.length, 2);
  assert.deepEqual(f.service.workspaceFromResources(input), result);
  assert.equal(count(f.db, "resources"), before[1]);
  assert.equal(count(f.db, "workspaces"), before[0] + 1);
  assert.throws(
    () =>
      f.service.workspaceFromResources({ ...input, title: "Changed scope" }),
    /idempotency_conflict/,
  );
  f.kernel.assertIntegrity();
});

test("construction revalidates grants/versions and rolls back canonical workspace/session/placements on mid-operation failure", (t) => {
  const f = fixture(t),
    note = f.options.createResource(
      "note",
      "Synthetic construct source",
      undefined,
      null,
    ),
    task = f.options.createResource(
      "task",
      "Synthetic construct task",
      undefined,
      null,
    ),
    existing = f.engine.createWorkspace("Synthetic retained context"),
    input = {
      commandId: "construction-failure",
      title: "Synthetic construction",
      projectId: null,
      resources: [
        { resourceId: note, expectedVersion: 1 },
        { resourceId: task, expectedVersion: 1 },
      ],
    };
  f.options.navigateWorkspace(existing.workspaceId);
  const before = [
    "workspaces",
    "resources",
    "blocks",
    "block_library_receipts",
  ].map((table) => count(f.db, table));
  f.service.previewWorkspaceFromResources(input);
  f.revoked.add(note);
  assert.throws(
    () => f.service.workspaceFromResources(input),
    /reference_unavailable/,
  );
  f.revoked.clear();
  assert.throws(
    () =>
      f.service.workspaceFromResources({
        ...input,
        resources: [{ resourceId: note, expectedVersion: 2 }],
      }),
    /reference_version_conflict/,
  );
  const original = f.host.placeResource;
  let calls = 0;
  f.host.placeResource = (command) => {
    const result = original(command);
    if (++calls === 2) throw new Error("synthetic_construction_failure");
    return result;
  };
  assert.throws(
    () => f.service.workspaceFromResources(input),
    /synthetic_construction_failure/,
  );
  assert.deepEqual(
    ["workspaces", "resources", "blocks", "block_library_receipts"].map(
      (table) => count(f.db, table),
    ),
    before,
  );
  assert.equal(f.engine.activeWorkspaceId(), existing.workspaceId);
  assert.equal(
    f.desktop.snapshot(() => ({ provider: "local", messages: [] }))
      .activeWorkspaceId,
    existing.workspaceId,
  );
  f.host.placeResource = original;
  assert.ok(f.service.workspaceFromResources(input).createdWorkspaceId);
  f.kernel.assertIntegrity();
});

test("schema2 templates bind project context explicitly and preserve subject settings without cloning a canonical resource", (t) => {
  const f = fixture(t),
    projectA = f.kernel.createProject("Synthetic template project A"),
    projectB = f.kernel.createProject("Synthetic template project B"),
    body = predefinedTemplates()[0].body;
  body.schemaVersion = 2;
  body.placements = [
    {
      key: "overview",
      subjectBinding: { mode: "project-context", view: "project" },
      presentation: BUILTIN_BLOCKS[1].defaultPresentation,
      configuration: {
        schemaVersion: 1,
        textScale: 1.5,
        contentMode: "reading",
      },
    },
  ];
  const template = f.service.saveTemplate({
    name: "Synthetic project template",
    description: "Synthetic explicit context binding",
    tags: [],
    body,
  });
  const before = count(f.db, "resources");
  const a = f.service.applyTemplate(
      request({
        templateId: template.id,
        projectId: projectA.id,
        expectedProjectVersion: 1,
      }),
    ),
    b = f.service.applyTemplate(
      request({
        templateId: template.id,
        projectId: projectB.id,
        expectedProjectVersion: 1,
      }),
    );
  assert.deepEqual(f.engine.project(a.workspaceId).blocks[0].subject, {
    kind: "project",
    projectId: projectA.id,
  });
  assert.deepEqual(f.engine.project(b.workspaceId).blocks[0].subject, {
    kind: "project",
    projectId: projectB.id,
  });
  assert.equal(count(f.db, "resources"), before);
  assert.equal(
    f.service.getBlockSettings(b.placementIds.overview).configuration.textScale,
    1.5,
  );
  assert.deepEqual(f.service.getTemplate(template.id).body, body);
  assert.throws(
    () => f.service.applyTemplate(request({ templateId: template.id })),
    /project_context_required/,
  );
  f.revoked.add(projectB.id);
  assert.throws(
    () =>
      f.service.applyTemplate(
        request({
          templateId: template.id,
          projectId: projectB.id,
          expectedProjectVersion: 1,
        }),
      ),
    /project_unavailable/,
  );
  f.kernel.assertIntegrity();
});

test("registered project/browser views have live capability states and create only canonical subject placements", (t) => {
  const f = fixture(t),
    project = f.kernel.createProject("Synthetic subject library"),
    workspace = f.engine.createWorkspace(
      "Synthetic view workspace",
      project.id,
    );
  assert.equal(REGISTERED_BLOCKS.length, 10);
  assert.equal(
    f.service
      .discoverBlocks()
      .find((entry) => entry.manifest.kind === "project_overview")?.availability
      .state,
    "unknown",
  );
  const input = {
    commandId: "library-project-view",
    workspaceId: workspace.workspaceId,
    expectedLayoutVersion: workspace.revision,
    kind: "project_overview" as const,
    subject: { kind: "project" as const, projectId: project.id },
    configuration: {
      schemaVersion: 1 as const,
      textScale: 1.25,
      contentMode: "reading" as const,
    },
  };
  assert.throws(() => f.service.createSubjectBlock(input), /block_unavailable/);
  f.options.capabilities().subjects = {
    project_overview: { state: "available" },
    resource_browser: { state: "available" },
    collection_browser: { state: "available" },
  };
  const before = count(f.db, "resources"),
    result = f.service.createSubjectBlock(input);
  assert.equal(count(f.db, "resources"), before);
  assert.deepEqual(result.subject, { kind: "project", projectId: project.id });
  assert.equal(
    f.engine.project(workspace.workspaceId).blocks[0].resourceId,
    undefined,
  );
  assert.deepEqual(f.service.createSubjectBlock(input), result);
  assert.equal(
    f.service.getBlockSettings(result.placementId).configuration.textScale,
    1.25,
  );
  const preferences = f.service.preferences();
  assert.deepEqual(preferences.recent, ["project_overview"]);
  assert.ok(
    f.service
      .setFavorite({
        kind: "project_overview",
        favorite: true,
        expectedVersion: preferences.version,
      })
      .favorites.includes("project_overview"),
  );
  f.revoked.add(project.id);
  assert.throws(
    () => f.service.subjectTargets(workspace.workspaceId),
    /workspace_unavailable/,
  );
  const standalone = f.engine.createWorkspace("Synthetic unassigned view");
  assert.equal(
    f.service
      .subjectTargets(standalone.workspaceId)
      .projects.some((item) => item.id === project.id),
    false,
  );
  assert.throws(
    () => f.service.projectOverview(project.id),
    /subject_unavailable/,
  );
  f.kernel.assertIntegrity();
});

test("project overview and collection/resource browsing read actual authorized canonical state without copying contents", (t) => {
  const f = fixture(t),
    project = f.kernel.createProject("Synthetic overview project"),
    other = f.kernel.createProject("Synthetic unrelated project"),
    workspace = f.engine.createWorkspace(
      "Synthetic project workspace",
      project.id,
    ),
    note = f.options.createResource(
      "note",
      "Synthetic research note",
      undefined,
      project.id,
    ),
    task = f.options.createResource(
      "task",
      "Synthetic review task",
      undefined,
      project.id,
    ),
    global = f.options.createResource(
      "note",
      "Synthetic unassigned note",
      undefined,
      null,
    ),
    foreign = f.options.createResource(
      "note",
      "Synthetic other project note",
      undefined,
      other.id,
    ),
    hidden = f.options.createResource(
      "note",
      "Synthetic revoked note",
      undefined,
      project.id,
    ),
    collection = f.kernel.createCollection(
      "Synthetic canonical reading list",
      project.id,
    );
  f.kernel.addToCollection(collection.id, note);
  f.kernel.addToCollection(collection.id, global);
  f.revoked.add(hidden);
  f.desktop.apply(
    {
      type: "taskStatus",
      resourceId: task,
      expectedVersion: 1,
      status: "done",
    },
    () => {
      throw new Error("unexpected");
    },
  );
  const before = ["workspaces", "resources", "blocks", "relationships"].map(
      (table) => count(f.db, table),
    ),
    overview = f.service.projectOverview(project.id);
  assert.equal(overview.project.id, project.id);
  assert.deepEqual(
    overview.workspaces.map((item) => item.id),
    [workspace.workspaceId],
  );
  assert.equal(overview.resourcesByKind.note, 1);
  assert.deepEqual(overview.tasks, { open: 0, done: 1 });
  assert.ok(overview.recentEvents.length > 0);
  for (const event of overview.recentEvents)
    assert.ok(
      f.db.prepare("SELECT 1 FROM change_events WHERE id=?").get(event.id),
    );
  const scoped = f.service.browseResources({
    subject: { kind: "resource-query", projectId: project.id, query: "" },
  });
  assert.equal(scoped.scopeTitle, project.title);
  assert.equal(
    f.service.browseResources({
      subject: { kind: "collection", collectionId: collection.id },
    }).scopeTitle,
    collection.title,
  );
  assert.deepEqual(
    new Set(scoped.resources.map((item) => item.id)),
    new Set([note, task]),
  );
  assert.equal(
    scoped.resources.some(
      (item) => item.id === hidden || item.id === foreign || item.id === global,
    ),
    false,
  );
  assert.deepEqual(
    new Set(
      f.service
        .browseResources({
          subject: { kind: "collection", collectionId: collection.id },
        })
        .resources.map((item) => item.id),
    ),
    new Set([note, global]),
  );
  assert.deepEqual(
    f.service
      .browseResources({
        subject: { kind: "resource-query", projectId: null, query: "review" },
        kind: "task",
      })
      .resources.map((item) => item.id),
    [task],
  );
  assert.deepEqual(
    ["workspaces", "resources", "blocks", "relationships"].map((table) =>
      count(f.db, table),
    ),
    before,
  );
  const attached = f.service.attachBlock({
    commandId: "browser-attach-note",
    workspaceId: workspace.workspaceId,
    expectedLayoutVersion: f.engine.project(workspace.workspaceId).revision,
    kind: "note",
    resourceId: note,
    expectedResourceVersion: 1,
  });
  assert.equal(
    f.service
      .browseResources({
        subject: { kind: "project", projectId: project.id },
        unplacedOnly: true,
      })
      .resources.some((item) => item.id === note),
    false,
  );
  const current = f.engine.project(workspace.workspaceId);
  f.engine.execute({
    type: "detachBlock",
    commandId: "browser-detach-note",
    workspaceId: workspace.workspaceId,
    expectedRevision: current.revision,
    blockId: attached.placementId,
  });
  assert.equal(
    f.service
      .browseResources({
        subject: { kind: "project", projectId: project.id },
        unplacedOnly: true,
      })
      .resources.some((item) => item.id === note),
    true,
  );
  f.kernel.setCollectionArchived(collection.id, true, 1);
  assert.throws(
    () =>
      f.service.browseResources({
        subject: { kind: "collection", collectionId: collection.id },
      }),
    /subject_unavailable/,
  );
  assert.equal(f.kernel.getResource(note).resource.id, note);
  f.kernel.assertIntegrity();
});

test("browser keyset pages are bounded, distinct and do not infer permissions from project context", (t) => {
  const f = fixture(t),
    project = f.kernel.createProject("Synthetic page project"),
    workspace = f.engine.createWorkspace(
      "Synthetic paging workspace",
      project.id,
    );
  const ids = Array.from({ length: 3 }, (_, index) =>
    f.options.createResource(
      "note",
      "Synthetic page " + index,
      undefined,
      project.id,
    ),
  );
  const subject = {
    kind: "resource-query" as const,
    projectId: project.id,
    query: "",
  };
  const first = f.service.browseResources({ subject, limit: 1 }),
    second = f.service.browseResources({
      subject,
      limit: 1,
      afterId: first.nextCursor!,
    });
  assert.equal(first.resources.length, 1);
  assert.equal(second.resources.length, 1);
  assert.notEqual(first.resources[0].id, second.resources[0].id);
  assert.ok(ids.includes(first.resources[0].id));
  f.revoked.add(first.resources[0].id);
  assert.equal(
    f.service
      .browseResources({ subject })
      .resources.some((item) => item.id === first.resources[0].id),
    false,
  );
  assert.throws(
    () => f.service.browseResources({ subject, limit: 101 }),
    /invalid_resource_query/,
  );
  assert.throws(
    () =>
      f.service.browseResources({
        subject: { ...subject, kinds: ["future-unavailable"] },
      }),
    /unsupported_resource_filter/,
  );
  assert.equal(
    f.service.subjectTargets(workspace.workspaceId).projectId,
    project.id,
  );
});
