import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { WorkspaceKernel } from "../../workspace-kernel/kernel.mts";
import { WorkspaceEngine } from "../../workspace-engine/engine.mts";
import { DesktopState } from "../../integrated-backend/src/desktop.mts";
import { TemplateService } from "../service.mts";
import { captureWorkspaceTemplate, validateBody } from "../model.ts";
import { BUILTIN_BLOCKS, searchBlocks } from "../registry.ts";
import type {
  CanonicalTemplateHost,
  LibraryCapabilities,
  TemplateApplyInput,
  TemplateBody,
  BlockKind,
} from "../contracts.ts";
import { predefinedTemplates } from "../model.ts";
import { presentation } from "../../workspace-engine/geometry.mts";

class KernelHost implements CanonicalTemplateHost<DatabaseSync> {
  readonly initialPlacement = 'nearest-free' as const;
  readonly kernel: WorkspaceKernel;
  readonly db: DatabaseSync;
  readonly engine: WorkspaceEngine;
  readonly desktop: DesktopState;
  revoked = new Set<string>();
  failAfterPlacement = 0;
  placed = 0;
  caps: LibraryCapabilities = {
    revision: 1,
    kinds: Object.fromEntries(
      BUILTIN_BLOCKS.map((b) => [b.kind, { state: "available" }]),
    ),
    providers: {
      local: { state: "available" },
      codex: { state: "setup_required", reason: "Not connected" },
    },
    velaPlanning: { state: "unsupported", reason: "No Vela planner connected" },
  };
  constructor(path = ":memory:") {
    this.kernel = WorkspaceKernel.open(path);
    this.db = this.kernel.withTransaction((db) => db);
    this.desktop = new DesktopState(this.kernel, this.db);
    this.engine = new WorkspaceEngine(this.kernel);
  }
  close() {
    this.kernel.close();
  }
  atomic<T>(fn: () => T): T {
    return this.kernel.withTransaction(fn);
  }
  capabilities() {
    return structuredClone(this.caps);
  }
  readProject(id: string) {
    const p = this.db.prepare("SELECT * FROM projects WHERE id=?").get(id);
    return p
      ? {
          id: String(p.id),
          version: Number(p.version),
          state: String(p.state),
          authorized: !this.revoked.has(id),
        }
      : null;
  }
  readResource(id: string) {
    const r = this.db
      .prepare(
        "SELECT r.*,d.kind AS desktop_kind FROM resources r LEFT JOIN desktop_resources d ON d.resource_id=r.id WHERE r.id=?",
      )
      .get(id);
    return r
      ? {
          id: String(r.id),
          kind: (r.desktop_kind ?? r.kind) as BlockKind,
          projectId: r.project_id as string | null,
          version: Number(r.version),
          state: String(r.state),
          authorized: !this.revoked.has(id),
        }
      : null;
  }
  readWorkspace(id: string) {
    const w = this.db.prepare("SELECT * FROM workspaces WHERE id=?").get(id);
    return w
      ? {
          id: String(w.id),
          projectId: w.project_id as string | null,
          layoutVersion: this.engine.project(id).revision,
          state: String(w.state),
          authorized: !this.revoked.has(id),
        }
      : null;
  }
  readPlacement(id: string) {
    const b = this.db.prepare("SELECT * FROM blocks WHERE id=?").get(id);
    return b
      ? {
          id: String(b.id),
          resourceId: String(b.resource_id),
          workspaceId: String(b.workspace_id),
          authorized:
            !this.revoked.has(String(b.resource_id)) &&
            !this.revoked.has(String(b.workspace_id)),
        }
      : null;
  }
  createWorkspace(
    input: Parameters<CanonicalTemplateHost["createWorkspace"]>[0],
  ) {
    const workspace = this.engine.createWorkspace(
      input.title,
      input.projectId,
      { mode: "freeform" },
    );
    return { id: workspace.workspaceId };
  }
  createResource(
    input: Parameters<CanonicalTemplateHost["createResource"]>[0],
  ) {
    const r =
      input.kind === "conversation"
        ? this.kernel.createConversationRef(input.title, input.projectId)
        : this.kernel.createNote(input.title, "", input.projectId);
    this.db
      .prepare("INSERT INTO desktop_resources(resource_id,kind) VALUES(?,?)")
      .run(r.id, input.kind);
    return { id: r.id };
  }
  placeResource(input: Parameters<CanonicalTemplateHost["placeResource"]>[0]) {
    const current = this.engine.project(input.workspaceId),
      before = new Set(current.blocks.map((b) => b.blockId));
    const result = this.engine.execute({
      type: "attachResource",
      commandId: randomUUID(),
      workspaceId: input.workspaceId,
      expectedRevision: current.revision,
      resourceId: input.resourceId,
      presentation: input.presentation,
      ...(input.placement ? { placement: input.placement } : {}),
      ...(input.bounds ? { bounds: input.bounds } : {}),
    });
    this.placed++;
    if (this.failAfterPlacement && this.placed >= this.failAfterPlacement)
      throw new Error("synthetic_transaction_failure");
    return { id: result.blocks.find((b) => !before.has(b.blockId))!.blockId };
  }
  setOrganization(
    input: Parameters<CanonicalTemplateHost["setOrganization"]>[0],
  ) {
    let state = this.engine.project(input.workspaceId);
    state = this.engine.execute({
      type: "setOrganization",
      commandId: randomUUID(),
      workspaceId: input.workspaceId,
      expectedRevision: state.revision,
      organization: input.organization,
      expectedOrganizationRevision: state.organization.revision,
    });
    this.engine.execute({
      type: "saveLayout",
      commandId: randomUUID(),
      workspaceId: input.workspaceId,
      expectedRevision: state.revision,
      placements: [],
      viewport: input.viewport,
    });
  }
  setTaskGroupMembers(
    input: Parameters<CanonicalTemplateHost["setTaskGroupMembers"]>[0],
  ) {
    for (const id of input.taskIds)
      this.kernel.relate(input.groupId, id, "contains_task", "user");
  }
  count(table: string) {
    assert.ok(
      [
        "workspaces",
        "resources",
        "blocks",
        "relationships",
        "workspace_templates",
        "block_library_receipts",
      ].includes(table),
    );
    return Number(
      this.db.prepare("SELECT count(*) AS n FROM " + table).get()!.n,
    );
  }
}
function fixture(t: any, path?: string) {
  const host = new KernelHost(path),
    service = new TemplateService(host.db, host);
  t.after(() => host.close());
  return { host, service };
}
const apply = (
  templateId = "builtin:development",
  extra: Partial<TemplateApplyInput> = {},
): TemplateApplyInput => ({
  commandId: randomUUID(),
  templateId,
  expectedVersion: 1,
  title: "Synthetic test workspace",
  projectId: null,
  ...extra,
});
const draft = (body: TemplateBody) => ({
  name: "Synthetic reusable template",
  description: "Synthetic test metadata",
  tags: ["test"],
  body,
});
const counts = (h: KernelHost) =>
  [
    "workspaces",
    "resources",
    "blocks",
    "relationships",
    "block_library_receipts",
  ].map((name) => h.count(name));

test("templates capture and reuse 0, 1, 3, 10, 25 and 50 distinct canonical resources", (t) => {
  const { host, service } = fixture(t);
  for (const count of [0, 1, 3, 10, 25, 50]) {
    const body = structuredClone(predefinedTemplates()[0].body);
    body.organization.mode = "freeform";
    body.resources = Array.from({ length: count }, (_, i) => ({
      key: "resource" + i,
      label: "Synthetic note " + i,
      source: { mode: "new", kind: "note", title: "Synthetic note " + i },
    }));
    body.placements = body.resources.map((r, i) => ({
      key: "placement" + i,
      resourceKey: r.key,
      presentation: presentation({
        x: (i % 5) * 430,
        y: Math.floor(i / 5) * 300,
        width: 400,
        height: 280,
        shape: "rounded",
        zIndex: i,
      }),
    }));
    const template = service.saveTemplate(draft(body));
    const created = service.applyTemplate(apply(template.id));
    host.desktop.apply(
      {
        type: "navigate",
        target: { kind: "workspace", workspaceId: created.workspaceId },
      },
      () => {
        throw new Error("unexpected_provider_execution");
      },
    );
    const snapshot = host.desktop.snapshot(() => ({
      provider: "local",
      messages: [],
    }));
    const captured = captureWorkspaceTemplate(
      snapshot,
      Object.fromEntries(
        snapshot.resources.map((r) => [r.id, "reference" as const]),
      ),
    );
    assert.equal(captured.resources.length, count);
    assert.equal(captured.placements.length, count);
    const saved = service.saveTemplate(draft(captured));
    const before = host.count("resources");
    const preview = service.previewTemplate(apply(saved.id));
    assert.equal(host.count("resources"), before);
    assert.equal(preview.referenceCount, count);
    assert.equal(preview.placementCount, count);
    const reused = service.applyTemplate(apply(saved.id));
    assert.equal(host.count("resources"), before);
    const first = host.engine.project(created.workspaceId),
      second = host.engine.project(reused.workspaceId);
    assert.deepEqual(
      second.blocks.map((b) => b.resourceId).sort(),
      first.blocks.map((b) => b.resourceId).sort(),
    );
    assert.deepEqual(
      second.blocks.map((b) => [b.x, b.y, b.width, b.height, b.shape]),
      first.blocks.map((b) => [b.x, b.y, b.width, b.height, b.shape]),
    );
    assert.equal(second.organization.mode, "freeform");
  }
  host.kernel.assertIntegrity();
});

test("registry includes eight canonical kinds; absent and unavailable capabilities never claim support", (t) => {
  const { host, service } = fixture(t);
  assert.equal(BUILTIN_BLOCKS.length, 8);
  assert.equal(searchBlocks("canonical task", host.caps).length, 2);
  assert.equal(
    searchBlocks("Intelligence Stream", host.caps)[0].kind,
    "stream",
  );
  delete host.caps.kinds.stream;
  assert.equal(
    searchBlocks("Intelligence Stream", host.caps)[0].availability.state,
    "unknown",
  );
  assert.equal(
    searchBlocks("Intelligence Stream", host.caps, undefined, false).length,
    0,
  );
  const workspace = host.engine.createWorkspace("Synthetic library workspace");
  const result = service.createBlock({
    commandId: "create-note",
    workspaceId: workspace.workspaceId,
    expectedLayoutVersion: workspace.revision,
    kind: "note",
    title: "Synthetic canonical note",
  });
  assert.equal(host.kernel.getResource(result.resourceId).note.content, "");
  assert.equal(
    host.engine.project(result.workspaceId).blocks[0].resourceId,
    result.resourceId,
  );
  assert.deepEqual(
    service.createBlock({
      commandId: "create-note",
      workspaceId: workspace.workspaceId,
      expectedLayoutVersion: workspace.revision,
      kind: "note",
      title: "Synthetic canonical note",
    }),
    result,
  );
  assert.throws(
    () =>
      service.createBlock({
        commandId: "create-note",
        workspaceId: workspace.workspaceId,
        expectedLayoutVersion: workspace.revision,
        kind: "note",
        title: "Other",
      }),
    /idempotency_conflict/,
  );
  assert.throws(
    () =>
      service.createBlock({
        commandId: "stale-note",
        workspaceId: workspace.workspaceId,
        expectedLayoutVersion: workspace.revision,
        kind: "note",
        title: "Stale",
      }),
    /layout_version_conflict/,
  );
  assert.throws(
    () =>
      service.createBlock({
        commandId: "codex-chat",
        workspaceId: workspace.workspaceId,
        expectedLayoutVersion: host.engine.project(workspace.workspaceId)
          .revision,
        kind: "conversation",
        title: "Synthetic unavailable provider",
        provider: "codex",
      }),
    /provider_unavailable/,
  );
});

test("Blank is Fluid; all presets create canonical usable blocks and real task membership without provider execution", (t) => {
  const { host, service } = fixture(t);
  assert.equal(service.listTemplates().length, 4);
  const blank = service.applyTemplate(apply("builtin:blank"));
  assert.equal(
    host.engine.project(blank.workspaceId).organization.mode,
    "fluid",
  );
  assert.equal(host.engine.project(blank.workspaceId).blocks.length, 0);
  for (const id of [
    "builtin:development",
    "builtin:research",
    "builtin:planning",
  ]) {
    const result = service.applyTemplate(apply(id)),
      state = host.engine.project(result.workspaceId),
      template = service.getTemplate(id);
    assert.equal(state.blocks.length, template.body.placements.length);
    assert.equal(state.organization.mode, "structured");
    assert.equal(state.presence.width, 208);
    assert.equal(state.presence.height, 260);
    assert.equal(state.presence.scale, 0.65);
    assert.equal(
      template.body.resources.some((r) => r.source.kind === "conversation"),
      true,
    );
    assert.equal(
      template.body.resources.some((r) => r.source.kind === "task"),
      true,
    );
    for (const role of template.body.resources) {
      const resource = host.kernel.getResource(result.resourceIds[role.key]);
      if (resource.note) assert.equal(resource.note.content, "");
      if (role.source.kind === "conversation")
        assert.equal(resource.resource.kind, "conversation");
    }
    const group = template.body.groups[0];
    assert.ok(group);
    const members = host.db
      .prepare(
        "SELECT target_id FROM relationships WHERE source_id=? AND kind='contains_task'",
      )
      .all(result.resourceIds[group.groupKey]);
    assert.deepEqual(
      new Set(members.map((r) => r.target_id)),
      new Set(group.taskKeys.map((k) => result.resourceIds[k])),
    );
    assert.equal(
      state.organization.structured.order.filter((id) => id !== "system:vela")
        .length,
      state.blocks.length,
    );
  }
  assert.throws(
    () =>
      service.renameTemplate({
        id: "builtin:blank",
        expectedVersion: 1,
        name: "Changed",
      }),
    /preset_read_only/,
  );
});

test("same resource keeps canonical ID, ownership and history across distinct placements/workspaces; preview never writes", (t) => {
  const { host, service } = fixture(t),
    project = host.kernel.createProject("Synthetic source project");
  const resource = host.kernel.createNote(
    "Synthetic source note",
    "Synthetic private source text",
    project.id,
  );
  host.db
    .prepare("INSERT INTO desktop_resources(resource_id,kind) VALUES(?,?)")
    .run(resource.id, "note");
  const body = structuredClone(predefinedTemplates()[1].body);
  body.organization.mode = "freeform";
  body.resources = [
    {
      key: "shared",
      label: "Synthetic reference",
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
    key: "place" + i,
    resourceKey: "shared",
    subjectBinding: undefined,
    presentation: { ...p.presentation, x: 100, y: 100 },
  }));
  const template = service.saveTemplate(draft(body));
  const input = apply(template.id, {
    projectId: project.id,
    expectedProjectVersion: project.version,
  });
  const before = counts(host);
  assert.equal(service.previewTemplate(input).referenceCount, 1);
  assert.deepEqual(counts(host), before);
  const a = service.applyTemplate(input),
    b = service.applyTemplate({ ...input, commandId: randomUUID() });
  assert.equal(
    host.kernel.getResource(resource.id).resource.project_id,
    project.id,
  );
  assert.equal(
    host.kernel.getResource(resource.id).note.content,
    "Synthetic private source text",
  );
  for (const result of [a, b]) {
    const state = host.engine.project(result.workspaceId);
    assert.equal(state.blocks.length, 2);
    assert.equal(
      state.blocks.every((block) => block.resourceId === resource.id),
      true,
    );
    assert.equal(new Set(state.blocks.map((block) => block.blockId)).size, 2);
    assert.equal(state.blocks[0].x, 100);
    assert.equal(state.blocks[1].x, 100);
    assert.equal(state.blocks[0].y, 100);
    assert.equal(state.blocks[1].y, 100);
  }
  assert.notEqual(a.placementIds.place0, b.placementIds.place0);
  assert.deepEqual(service.applyTemplate(input), a);
});

test("cross-project, archived, revoked and stale references fail at apply time after a successful preview", (t) => {
  const { host, service } = fixture(t),
    p = host.kernel.createProject("Synthetic one"),
    other = host.kernel.createProject("Synthetic two"),
    r = host.kernel.createNote("Synthetic ref", "", p.id);
  host.db
    .prepare("INSERT INTO desktop_resources(resource_id,kind) VALUES(?,?)")
    .run(r.id, "note");
  const body = predefinedTemplates()[1].body;
  body.resources = [
    {
      key: "shared",
      label: "Synthetic ref",
      source: {
        mode: "reference",
        kind: "note",
        resourceId: r.id,
        expectedVersion: 1,
      },
    },
  ];
  body.placements = body.placements
    .slice(0, 1)
    .map((p) => ({ ...p, resourceKey: "shared", subjectBinding: undefined }));
  body.groups = [];
  const template = service.saveTemplate(draft(body)),
    input = apply(template.id, { projectId: p.id, expectedProjectVersion: 1 });
  const before = counts(host);
  service.previewTemplate(input);
  assert.throws(
    () =>
      service.applyTemplate({
        ...input,
        commandId: randomUUID(),
        projectId: other.id,
      }),
    /cross_project_reference/,
  );
  host.revoked.add(r.id);
  assert.throws(() => service.applyTemplate(input), /reference_unavailable/);
  host.revoked.clear();
  host.db.prepare("UPDATE resources SET state='archived' WHERE id=?").run(r.id);
  assert.throws(() => service.applyTemplate(input), /reference_unavailable/);
  host.db
    .prepare("UPDATE resources SET state='active',version=2 WHERE id=?")
    .run(r.id);
  assert.throws(
    () => service.applyTemplate(input),
    /reference_version_conflict/,
  );
  assert.deepEqual(counts(host), before);
});

test("failed apply rolls back workspace, resources, placements, membership, engine session and receipt atomically", (t) => {
  const { host, service } = fixture(t);
  const existing = host.engine.createWorkspace("Synthetic retained workspace");
  const state = host.engine.project(existing.workspaceId),
    before = counts(host),
    active = host.engine.activeWorkspaceId();
  host.failAfterPlacement = 2;
  const input = apply();
  assert.throws(
    () => service.applyTemplate(input),
    /synthetic_transaction_failure/,
  );
  assert.deepEqual(counts(host), before);
  assert.deepEqual(host.engine.project(existing.workspaceId), state);
  assert.equal(host.engine.activeWorkspaceId(), active);
  host.failAfterPlacement = 0;
  assert.ok(service.applyTemplate(input).workspaceId);
  assert.equal(host.count("workspaces"), before[0] + 1);
});

test("save, rename, search, archive, restore and optimistic metadata versions survive a real SQLite restart", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "aerynth-template-test-"));
  const path = join(dir, "synthetic.sqlite");
  let host = new KernelHost(path),
    service = new TemplateService(host.db, host);
  t.after(() => {
    host.close();
    const absolute = resolve(dir),
      allowed = resolve(tmpdir());
    assert.ok(absolute.startsWith(allowed + "\\"));
    rmSync(absolute, { recursive: true, force: true });
  });
  const saved = service.saveTemplate(draft(predefinedTemplates()[1].body));
  const renamed = service.renameTemplate({
    id: saved.id,
    expectedVersion: 1,
    name: "Synthetic renamed library",
  });
  assert.equal(renamed.version, 2);
  assert.equal(service.listTemplates({ query: "renamed library" }).length, 1);
  assert.throws(
    () =>
      service.renameTemplate({
        id: saved.id,
        expectedVersion: 1,
        name: "Stale rename",
      }),
    /template_version_conflict/,
  );
  const archived = service.archiveTemplate({
    id: saved.id,
    expectedVersion: 2,
    archived: true,
  });
  assert.equal(service.listTemplates({ query: "renamed" }).length, 0);
  assert.equal(
    service.listTemplates({ query: "renamed", includeArchived: true }).length,
    1,
  );
  assert.throws(
    () => service.applyTemplate(apply(saved.id, { expectedVersion: 3 })),
    /template_archived/,
  );
  host.close();
  host = new KernelHost(path);
  service = new TemplateService(host.db, host);
  assert.deepEqual(service.getTemplate(saved.id), archived);
  const restored = service.archiveTemplate({
    id: saved.id,
    expectedVersion: 3,
    archived: false,
  });
  assert.equal(restored.version, 4);
  assert.ok(
    service.applyTemplate(apply(saved.id, { expectedVersion: 4 })).workspaceId,
  );
  host.kernel.assertIntegrity();
});

test("template capture requires explicit binding, preserves roles/shapes/mode/spans and excludes all source content", (t) => {
  const { host, service } = fixture(t);
  const result = service.applyTemplate(apply());
  const state = host.engine.project(result.workspaceId);
  host.desktop.apply(
    {
      type: "navigate",
      target: { kind: "workspace", workspaceId: result.workspaceId },
    },
    () => {
      throw new Error("no execution");
    },
  );
  const snapshot = host.desktop.snapshot(() => ({
    provider: "codex",
    messages: [
      {
        id: "synthetic-message",
        role: "user",
        content: "SYNTHETIC_SECRET_HISTORY",
      },
    ],
  }));
  assert.throws(
    () => captureWorkspaceTemplate(snapshot, {}),
    /binding_choice_required/,
  );
  const choices = Object.fromEntries(
      snapshot.resources.map((r) => [r.id, "new"] as const),
    ),
    body = captureWorkspaceTemplate(snapshot, choices);
  assert.equal(body.organization.mode, state.organization.mode);
  assert.equal(body.placements.length, state.blocks.length);
  assert.equal(
    body.placements.every((p) => !!p.span),
    true,
  );
  assert.equal(body.groups[0].taskKeys.length, 1);
  assert.equal(
    JSON.stringify(body).includes("SYNTHETIC_SECRET_HISTORY"),
    false,
  );
  assert.equal(JSON.stringify(body).includes("providerThread"), false);
  const invalid = structuredClone(body) as any;
  invalid.resources[0].source.messages = [];
  assert.throws(() => validateBody(invalid), /invalid_template_fields/);
  const tooMany = structuredClone(body);
  tooMany.resources = Array.from({ length: 65 }, (_, i) => ({
    ...body.resources[0],
    key: "resource" + i,
  }));
  assert.throws(() => validateBody(tooMany), /template_resource_limit/);
});

test("Vela planning is a real injected request only; unavailable/mismatched plans fail without writes or fallback generation", async (t) => {
  const { host, service } = fixture(t),
    before = counts(host);
  await assert.rejects(
    service.requestVelaTemplate({
      requestId: "vela-one",
      prompt: "Synthetic research intent",
      projectId: null,
    }),
    /vela_planning_unavailable/,
  );
  assert.deepEqual(counts(host), before);
  host.caps.velaPlanning = { state: "available" };
  let requests = 0;
  const connected = new TemplateService(host.db, host, {
    async plan(input) {
      requests++;
      assert.ok(input.supportedKinds.includes("note"));
      return {
        ...draft(predefinedTemplates()[2].body),
        provenance: {
          requestId: input.requestId,
          providerId: "synthetic-test-planner",
          model: "synthetic-test-model",
        },
      };
    },
  });
  const plan = await connected.requestVelaTemplate({
    requestId: "vela-real-port",
    prompt: "Synthetic intent",
    projectId: null,
  });
  assert.equal(requests, 1);
  assert.equal(plan.provenance.requestId, "vela-real-port");
  assert.deepEqual(counts(host), before);
  const mismatch = new TemplateService(host.db, host, {
    async plan() {
      return {
        ...plan,
        provenance: { ...plan.provenance, requestId: "wrong" },
      };
    },
  });
  await assert.rejects(
    mismatch.requestVelaTemplate({
      requestId: "vela-wrong",
      prompt: "Synthetic intent",
      projectId: null,
    }),
    /vela_request_mismatch/,
  );
});

test("templates and creation enforce native connection and provider capability boundaries", (t) => {
  const { host, service } = fixture(t),
    other = new KernelHost();
  t.after(() => other.close());
  assert.throws(
    () => new TemplateService(other.db, host),
    /canonical_connection_required/,
  );
  const body = predefinedTemplates()[1].body;
  body.resources[0].source = {
    mode: "new",
    kind: "conversation",
    title: "Synthetic provider conversation",
    provider: "codex",
  };
  const template = service.saveTemplate(draft(body));
  const before = counts(host);
  assert.throws(
    () => service.previewTemplate(apply(template.id)),
    /provider_unavailable/,
  );
  assert.throws(
    () => service.applyTemplate(apply(template.id)),
    /provider_unavailable/,
  );
  assert.deepEqual(counts(host), before);
  host.caps.kinds.task = {
    state: "disabled",
    reason: "Synthetic policy disable",
  };
  assert.throws(() => service.applyTemplate(apply()), /block_unavailable/);
  assert.deepEqual(counts(host), before);
});

test("schema upgrade, per-placement preferences, recents and favorites survive SQLite restart without resetting content", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "aerynth-library-restart-")),
    path = join(dir, "synthetic.sqlite");
  let host = new KernelHost(path),
    service = new TemplateService(host.db, host);
  t.after(() => {
    host.close();
    const absolute = resolve(dir),
      allowed = resolve(tmpdir());
    assert.ok(absolute.startsWith(allowed + "\\"));
    rmSync(absolute, { recursive: true, force: true });
  });
  const workspace = host.engine.createWorkspace("Synthetic persisted library"),
    created = service.createBlock({
      commandId: "persisted-note",
      workspaceId: workspace.workspaceId,
      expectedLayoutVersion: workspace.revision,
      kind: "note",
      title: "Synthetic persistent note",
      configuration: {
        schemaVersion: 1,
        textScale: 1.25,
        contentMode: "reading",
      },
    });
  host.desktop.apply(
    {
      type: "content",
      resourceId: created.resourceId,
      expectedVersion: 1,
      content: "Synthetic retained content",
    },
    () => {
      throw new Error("unexpected");
    },
  );
  const preferences = service.preferences();
  service.setFavorite({
    kind: "note",
    favorite: true,
    expectedVersion: preferences.version,
  });
  const settings = service.getBlockSettings(created.placementId),
    savedPreferences = service.preferences();
  host.db.prepare("UPDATE block_library_schema SET version=1").run();
  host.close();
  host = new KernelHost(path);
  service = new TemplateService(host.db, host);
  assert.deepEqual(service.preferences(), savedPreferences);
  assert.deepEqual(service.preferences().recent, ["note"]);
  assert.deepEqual(service.getBlockSettings(created.placementId), settings);
  assert.equal(
    host.kernel.getResource(created.resourceId).note.content,
    "Synthetic retained content",
  );
  assert.equal(
    host.db.prepare("SELECT version FROM block_library_schema").get()?.version,
    3,
  );
  host.kernel.assertIntegrity();
});

test('template capture rejects a canonical domain with no registered resource presentation and preserves its snapshot', t => {
  const { host, service } = fixture(t), workspace = host.engine.createWorkspace('Synthetic domain capture boundary');
  const created = service.createBlock({ commandId: 'capture:registered', workspaceId: workspace.workspaceId, expectedLayoutVersion: workspace.revision, kind: 'note', title: 'Existing supported note' });
  host.desktop.apply({ type: 'navigate', target: { kind: 'workspace', workspaceId: workspace.workspaceId } }, () => { throw new Error('No provider creation'); });
  const snapshot = host.desktop.snapshot(() => ({ provider: 'local', messages: [] }));
  assert.equal(captureWorkspaceTemplate(snapshot, { [created.resourceId]: 'reference' }).resources[0].source.kind, 'note');
  for (const kind of ['agent'] as const) {
    const foreign = structuredClone(snapshot); (foreign.resources.find(resource => resource.id === created.resourceId)! as any).kind = kind;
    const retained = structuredClone(foreign);
    assert.throws(() => captureWorkspaceTemplate(foreign, { [created.resourceId]: 'reference' }), /unsupported_resource_presentation/);
    assert.deepEqual(foreign, retained);
  }
});
