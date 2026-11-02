import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { BackendCore } from "../src/core.mts";
import type {
  ProviderPort,
  VelaBackendState,
  VelaOperation,
} from "../src/contracts.mts";
import type {
  VelaNativeAction,
  VelaPlan,
} from "../../vela-core/src/contracts.ts";
import type { WorkspacePresentationContext } from "../../application-contract/contracts.ts";
import {
  CAPABILITIES,
  validateAction,
} from "../../vela-core/src/capabilities.ts";

const additions = [
  "createProject",
  "createWorkspace",
  "renameWorkspace",
  "taskPriority",
  "bringAllIntoView",
  "resolveLayout",
  "setOrganization",
] as const;
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "aerynth-vela-native-capabilities-")),
    path = join(dir, "canonical.sqlite");
  let connections = 0;
  const open = () => {
    const value = new BackendCore({
      path,
      privateRoot: dir,
      cwd: dir,
      provider: "codex",
      contentPolicy: "local-private",
    });
    (value as unknown as { port: ProviderPort }).port.connect = async () => {
      connections++;
      throw new Error("Native app actions must remain offline");
    };
    return value;
  };
  let core = open();
  const vela = (
    name: VelaOperation["name"],
    input: unknown = {},
    presentation?: WorkspacePresentationContext,
  ) =>
    core.command("vela", {
      name,
      input,
      ...(presentation ? { presentation } : {}),
    } as VelaOperation);
  const prepare = (action: VelaNativeAction) =>
    vela("native", {
      intent: "Synthetic explicit native " + action.type,
      action,
    }) as Promise<VelaPlan>;
  const apply = async (action: VelaNativeAction) => {
    const prepared = await prepare(action),
      presentation =
        action.type === "bringAllIntoView"
          ? {
              workspaceId: action.workspaceId,
              bounds: { x: 0, y: 0, width: 1200, height: 720 },
            }
          : undefined;
    const plan = (await vela("apply", prepared.id, presentation)) as VelaPlan;
    const receipt = ((await vela("state")) as VelaBackendState).receipts.find(
      (item) => item.planId === plan.id,
    )!;
    assert.equal(plan.state, "applied", action.type + ": " + receipt.errorCode);
    assert.equal(receipt.state, "applied");
    assert.equal(receipt.taskVerified, false);
    return { plan, receipt };
  };
  return {
    get core() {
      return core;
    },
    vela,
    prepare,
    apply,
    connections: () => connections,
    async reopen() {
      await core.command("close", {});
      core = open();
    },
    async close() {
      await core.command("close", {});
      const target = resolve(dir),
        part = relative(resolve(tmpdir()), target);
      assert(
        part.startsWith("aerynth-vela-native-capabilities-") &&
          !part.startsWith("..") &&
          !isAbsolute(part),
      );
      rmSync(target, { recursive: true, force: true });
    },
  };
}

test("seven released Vela actions use the actual private canonical app, remain idempotent and survive restart without a provider connection", async () => {
  const f = fixture();
  try {
    assert.equal(
      ((await f.vela("state")) as VelaBackendState).nativeCapabilities
        .bringAllIntoView.available,
      false,
      "There is no current working presenter yet",
    );
    const project = await f.apply({
      type: "createProject",
      title: "Synthetic native Vela project",
    });
    const projectId = project.receipt.createdProjectId!;
    assert.ok(projectId);
    const created = await f.apply({
      type: "createWorkspace",
      title: "Synthetic native Vela workspace",
      projectId,
    });
    const workspaceId = created.receipt.createdWorkspaceId!;
    assert.ok(workspaceId);
    const available = (await f.vela("state")) as VelaBackendState;
    for (const id of additions)
      assert.equal(available.nativeCapabilities[id].available, true);
    const task = await f.apply({
      type: "createResource",
      kind: "task",
      title: "Synthetic native priority",
      workspaceId,
    });
    const resourceId = task.receipt.createdResourceId!;
    let snapshot = await f.core.command("desktop", { type: "snapshot" });
    const resource = snapshot.resources.find((item) => item.id === resourceId)!;
    assert.equal(resource.project_id, projectId);
    await f.apply({
      type: "taskPriority",
      resourceId,
      expectedVersion: resource.version,
      priority: "urgent",
    });
    await f.apply({
      type: "setOrganization",
      workspaceId,
      organization: {
        mode: "structured",
        gap: 18,
        structured: { columnCount: 2, rowHeight: 112, columnGap: 16 },
      },
    });
    snapshot = await f.core.command("desktop", { type: "snapshot" });
    assert.equal(snapshot.organization?.mode, "structured");
    assert.equal(snapshot.organization?.structured.columnCount, 2);
    assert.equal(snapshot.organization?.structured.rowHeight, 112);
    await f.apply({ type: "resolveLayout", workspaceId });
    await f.apply({ type: "bringAllIntoView", workspaceId });
    const rename = await f.prepare({
      type: "renameWorkspace",
      workspaceId,
      title: "Synthetic renamed by Vela",
    });
    const beforeRename = await f.core.command("desktop", { type: "snapshot" });
    assert.notEqual(
      rename.targets.find((item) => item.kind === "workspace")!.version,
      beforeRename.workspaces.find((item) => item.id === workspaceId)!.version,
      "Workspace composite tokens are not raw entity versions",
    );
    assert.equal(
      ((await f.vela("apply", rename.id)) as VelaPlan).state,
      "applied",
    );
    const expected = await f.core.command("desktop", { type: "snapshot" }),
      state = (await f.vela("state")) as VelaBackendState;
    assert.equal(
      expected.resources.find((item) => item.id === resourceId)!.taskPriority,
      "urgent",
    );
    assert.equal(
      expected.resources.find((item) => item.id === resourceId)!.taskStatus,
      "open",
    );
    assert.equal(
      expected.workspaces.find((item) => item.id === workspaceId)!.title,
      "Synthetic renamed by Vela",
    );
    assert.equal(
      expected.blocks.filter((item) => item.resource_id === resourceId).length,
      1,
    );
    assert.deepEqual(
      expected.resources.map((item) => item.id).sort(),
      beforeRename.resources.map((item) => item.id).sort(),
    );
    for (const id of [project.plan.id, created.plan.id, rename.id])
      assert.equal(((await f.vela("apply", id)) as VelaPlan).state, "applied");
    assert.deepEqual(
      (await f.core.command("desktop", { type: "snapshot" })).projects,
      expected.projects,
      "Reapplying receipts cannot create another project",
    );
    const canonical = (value: typeof expected) => ({
      projects: value.projects,
      workspaces: value.workspaces,
      resources: value.resources,
      blocks: value.blocks,
      presence: value.presence,
      organization: value.organization,
      viewport: value.viewport,
    });
    await f.reopen();
    assert.deepEqual(
      canonical(await f.core.command("desktop", { type: "snapshot" })),
      canonical(expected),
    );
    const restored = (await f.vela("state")) as VelaBackendState;
    assert.equal(
      restored.conversation?.resourceId,
      state.conversation?.resourceId,
    );
    assert.deepEqual(restored.receipts, state.receipts);
    assert.equal(
      restored.receipts.find((item) => item.planId === project.plan.id)!
        .createdProjectId,
      projectId,
    );
    const backend = await f.core.command("snapshot", {});
    assert.deepEqual(backend.executions, {});
    assert.deepEqual(backend.bindings, {});
    assert.equal(f.connections(), 0);
  } finally {
    await f.close();
  }
});

test("new Vela actions refuse stale layout/task targets and cross-project or revoked workspace scope", async () => {
  const f = fixture();
  try {
    const pa = await f.apply({
        type: "createProject",
        title: "Synthetic allowed project",
      }),
      pb = await f.apply({
        type: "createProject",
        title: "Synthetic other project",
      });
    const a = pa.receipt.createdProjectId!,
      b = pb.receipt.createdProjectId!;
    const wa = await f.apply({
        type: "createWorkspace",
        title: "Synthetic allowed workspace",
        projectId: a,
      }),
      workspaceId = wa.receipt.createdWorkspaceId!;
    await assert.rejects(
      f.prepare({
        type: "createWorkspace",
        title: "Must not create elsewhere",
        projectId: b,
      }),
      /resource_not_authorized/,
    );
    const rename = await f.prepare({
      type: "renameWorkspace",
      workspaceId,
      title: "Stale rename must not apply",
    });
    await f.core.command("desktop", {
      type: "setOrganization",
      workspaceId,
      organization: { mode: "freeform" },
      expectedOrganizationRevision: 1,
    });
    await assert.rejects(f.vela("apply", rename.id), /stale_target_version/);
    const task = await f.apply({
        type: "createResource",
        kind: "task",
        title: "Synthetic stale priority",
        workspaceId,
      }),
      resourceId = task.receipt.createdResourceId!;
    const resource = (
      await f.core.command("desktop", { type: "snapshot" })
    ).resources.find((item) => item.id === resourceId)!;
    const priority = await f.prepare({
      type: "taskPriority",
      resourceId,
      expectedVersion: resource.version,
      priority: "urgent",
    });
    await f.core.command("desktop", {
      type: "taskPriority",
      resourceId,
      expectedVersion: resource.version,
      priority: "low",
    });
    await assert.rejects(f.vela("apply", priority.id), /stale_target_version/);
    const revoked = await f.prepare({ type: "resolveLayout", workspaceId });
    const before = await f.core.command("desktop", { type: "snapshot" }),
      owner = before.projects.find((item) => item.id === a)!;
    await f.core.command("desktop", {
      type: "archiveSubject",
      kind: "project",
      id: a,
      expectedVersion: owner.version,
      archived: true,
    });
    await assert.rejects(
      f.vela("apply", revoked.id),
      /resource_not_authorized/,
    );
    await f.core.command("desktop", {
      type: "archiveSubject",
      kind: "project",
      id: a,
      expectedVersion: owner.version + 1,
      archived: false,
    });
    const after = await f.core.command("desktop", { type: "snapshot" });
    assert.equal(
      after.workspaces.find((item) => item.id === workspaceId)!.title,
      "Synthetic allowed workspace",
    );
    assert.equal(
      after.resources.find((item) => item.id === resourceId)!.taskPriority,
      "low",
    );
    assert.equal(
      after.workspaces.filter((item) => item.project_id === b).length,
      0,
    );
    assert.equal(f.connections(), 0);
  } finally {
    await f.close();
  }
});

test("new actions reject extra authority fields and malformed canonical layout updates; disabled releases remain unavailable", async () => {
  for (const invalid of [
    { type: "createProject", title: "Synthetic", authorizationRef: "forged" },
    {
      type: "createWorkspace",
      title: "Synthetic",
      projectId: "p",
      grantId: "forged",
    },
    {
      type: "renameWorkspace",
      workspaceId: "w",
      title: "Synthetic",
      expectedVersion: 1,
    },
    {
      type: "bringAllIntoView",
      workspaceId: "w",
      bounds: { x: 0, y: 0, width: 1200, height: 720 },
    },
    {
      type: "taskPriority",
      resourceId: "r",
      expectedVersion: 1,
      priority: "maximum",
    },
    {
      type: "setOrganization",
      workspaceId: "w",
      organization: { mode: "structured", structured: { columnCount: 99 } },
    },
    {
      type: "setOrganization",
      workspaceId: "w",
      organization: {
        mode: "structured",
        structured: { spans: { r: { columns: 1, rows: 1, injected: true } } },
      },
    },
    {
      type: "setOrganization",
      workspaceId: "w",
      organization: { mode: "freeform", authorizationRef: "forged" },
    },
  ])
    assert.throws(
      () => validateAction(invalid),
      /unsupported_or_invalid_action/,
    );
  assert.deepEqual(
    validateAction({
      type: "setOrganization",
      workspaceId: "w",
      organization: { mode: "structured", structured: { columnCount: null } },
    }),
    {
      type: "setOrganization",
      workspaceId: "w",
      organization: { mode: "structured", structured: { columnCount: null } },
    },
  );
  for (const id of additions)
    assert.equal(CAPABILITIES.filter((item) => item.id === id).length, 1);
  const f = fixture();
  try {
    f.core.registerVelaNativeCapabilities({
      supportedActions: [],
      dispatch: () => {
        throw new Error("Disabled release must never dispatch");
      },
    });
    const state = (await f.vela("state")) as VelaBackendState;
    for (const id of additions) {
      assert.equal(state.nativeCapabilities[id].available, false);
      assert.equal(
        state.capabilities.some((item) => item.id === id),
        false,
      );
    }
    await assert.rejects(
      f.prepare({
        type: "createProject",
        title: "Must not create a disabled project",
      }),
      /host_policy_denied/,
    );
    assert.equal(
      (await f.core.command("desktop", { type: "snapshot" })).projects.length,
      0,
    );
    assert.equal(f.connections(), 0);
  } finally {
    await f.close();
  }
});

test("framing requires an actual matching presenter outside the model action and releases per-plan context after apply", async () => {
  const f = fixture();
  try {
    const workspace = await f.apply({
        type: "createWorkspace",
        title: "Synthetic presenter-bound workspace",
        projectId: null,
      }),
      workspaceId = workspace.receipt.createdWorkspaceId!;
    const plan = await f.prepare({ type: "bringAllIntoView", workspaceId });
    const before = await f.core.command("desktop", { type: "snapshot" });
    await assert.rejects(
      f.vela("apply", plan.id),
      /vela_presentation_unavailable/,
    );
    await assert.rejects(
      f.vela("apply", plan.id, {
        workspaceId: "another-workspace",
        bounds: { x: 0, y: 0, width: 800, height: 600 },
      }),
      /vela_presentation_unavailable/,
    );
    await assert.rejects(
      f.vela("apply", plan.id, {
        workspaceId,
        bounds: { x: 0, y: 0, width: NaN, height: 600 },
      }),
      /invalid_vela_presentation/,
    );
    await assert.rejects(
      f.vela("apply", plan.id, {
        workspaceId,
        bounds: { x: 0, y: 0, width: -1, height: 600 },
      }),
      /invalid_vela_presentation/,
    );
    await assert.rejects(
      f.vela("apply", plan.id, {
        workspaceId,
        bounds: { x: 0, y: 0, width: 800, height: 600, z: 9 },
      } as WorkspacePresentationContext),
      /invalid_vela_presentation/,
    );
    assert.deepEqual(
      await f.core.command("desktop", { type: "snapshot" }),
      before,
      "Invalid presentation cannot mutate a layout",
    );
    const prepared = ((await f.vela("state")) as VelaBackendState).plans.find(
      (item) => item.id === plan.id,
    )!;
    assert.equal(prepared.state, "approved");
    assert.equal(
      ((await f.vela("state")) as VelaBackendState).receipts.some(
        (item) => item.planId === plan.id,
      ),
      false,
    );
    const presentation = {
      workspaceId,
      bounds: { x: 24, y: 32, width: 800, height: 560 },
    };
    const applying = f.vela("apply", plan.id, presentation);
    await assert.rejects(
      f.vela("apply", plan.id, presentation),
      /vela_apply_in_progress/,
    );
    assert.equal(((await applying) as VelaPlan).state, "applied");
    assert.equal(
      (f.core as unknown as { velaPresentations: Map<string, unknown> })
        .velaPresentations.size,
      0,
    );
    assert.equal(
      ((await f.vela("apply", plan.id)) as VelaPlan).state,
      "applied",
      "An existing applied receipt is idempotent without a new presenter",
    );
    assert.equal(
      (f.core as unknown as { velaPresentations: Map<string, unknown> })
        .velaPresentations.size,
      0,
    );
    assert.equal(f.connections(), 0);
  } finally {
    await f.close();
  }
});
