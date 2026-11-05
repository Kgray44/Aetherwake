import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, relative, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { BackendCore } from "../src/core.mts";
import { validateAction } from "../../vela-core/src/capabilities.ts";
import type {
  VelaNativeAction,
  VelaPlan,
} from "../../vela-core/src/contracts.ts";
import type {
  ProviderPort,
  VelaOperation,
  VelaBackendState,
  NoteRequest,
} from "../src/contracts.mts";

/** Actual private canonical SQLite. Provider connection is forbidden, not simulated intelligence. */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "aerynth-vela-resource-org-")),
    path = join(dir, "canonical.sqlite");
  let connections = 0;
  const open = () => {
    const c = new BackendCore({
      path,
      privateRoot: dir,
      cwd: dir,
      provider: "codex",
      contentPolicy: "local-private",
    });
    (c as unknown as { port: ProviderPort }).port.connect = async () => {
      connections++;
      throw new Error("Organization must not connect a provider");
    };
    return c;
  };
  let core = open();
  const vela = (name: VelaOperation["name"], input: unknown = {}) =>
    core.command("vela", { name, input } as VelaOperation);
  const prepare = (action: VelaNativeAction) =>
    vela("native", {
      intent: "Synthetic explicit " + action.type,
      action,
    }) as Promise<VelaPlan>;
  const apply = async (action: VelaNativeAction) => {
    const prepared = await prepare(action),
      result = (await vela("apply", prepared.id)) as VelaPlan;
    assert.equal(result.state, "applied");
    return result;
  };
  return {
    get core() {
      return core;
    },
    vela,
    prepare,
    apply,
    connections: () => connections,
    db: () => (core as unknown as { db: DatabaseSync }).db,
    async reopen() {
      await core.command("close", {});
      core = open();
    },
    async close() {
      await core.command("close", {});
      const part = relative(resolve(tmpdir()), resolve(dir));
      assert(
        part.startsWith("aerynth-vela-resource-org-") &&
          !part.startsWith("..") &&
          !isAbsolute(part),
      );
      rmSync(resolve(dir), { recursive: true, force: true });
    },
  };
}
async function project(f: ReturnType<typeof fixture>, title: string) {
  await f.core.command("desktop", { type: "createProject", title });
  return f.db().prepare("SELECT id FROM projects WHERE title=?").get(title)!
    .id as string;
}
async function workspace(
  f: ReturnType<typeof fixture>,
  projectId: string,
  title: string,
) {
  return (
    await f.core.command("desktop", {
      type: "createWorkspace",
      projectId,
      title,
    })
  ).activeWorkspaceId!;
}
async function resource(
  f: ReturnType<typeof fixture>,
  kind: "note" | "task" | "task_group" | "reference",
  title: string,
  workspaceId: string | null = null,
) {
  const state = await f.core.command("desktop", {
    type: "createResource",
    kind,
    title,
    workspaceId,
  });
  return state.resources.find((item) => item.title === title)!;
}
const universe = (f: ReturnType<typeof fixture>) =>
  f.core.command("desktop", {
    type: "navigate",
    target: { kind: "constellation", projectId: null },
  });
const note = (
  f: ReturnType<typeof fixture>,
  name: NoteRequest["name"],
  input: unknown,
) => f.core.command("notes", { name, input } as NoteRequest) as Promise<any>;

test("canonical project and non-chat organization retain shared placements, content, recovery drafts and receipts through retry/restart without a provider", async () => {
  const f = fixture();
  try {
    const a = await project(f, "Synthetic organization A"),
      wa = await workspace(f, a, "Synthetic A workspace"),
      n = await resource(f, "note", "Synthetic shared note", wa);
    await f.core.command("desktop", {
      type: "content",
      resourceId: n.id,
      expectedVersion: n.version,
      content: "Synthetic preserved canonical content",
    });
    await note(f, "saveNoteDraft", {
      resourceId: n.id,
      expectedDraftVersion: 0,
      baseResourceVersion: n.version + 1,
      content: "Synthetic preserved unsent recovery draft",
    });
    const b = await project(f, "Synthetic organization B"),
      wb = await workspace(f, b, "Synthetic B workspace");
    await f.core.command("desktop", {
      type: "attach",
      workspaceId: wb,
      resourceId: n.id,
    });
    const secret = await resource(
      f,
      "note",
      "Synthetic unrelated private B source",
      wb,
    );
    await f.core.command("desktop", {
      type: "content",
      resourceId: secret.id,
      expectedVersion: secret.version,
      content: "Synthetic unrelated B content",
    });
    await universe(f);
    const placements = f
        .db()
        .prepare("SELECT * FROM blocks WHERE resource_id=? ORDER BY id")
        .all(n.id),
      draft = (await note(f, "readNote", n.id)).result.draft,
      beforeVersion = Number(
        f.db().prepare("SELECT version FROM projects WHERE id=?").get(a)!
          .version,
      ),
      renamed = await f.apply({
        type: "renameProject",
        projectId: a,
        title: "Synthetic renamed project",
      });
    assert(
      renamed.targets.some(
        (item) =>
          item.kind === "project" &&
          item.id === a &&
          item.version === beforeVersion,
      ),
    );
    const first = await f.apply({
      type: "renameResource",
      resourceId: n.id,
      title: "Synthetic renamed note",
    });
    const version = Number(
      f.db().prepare("SELECT version FROM resources WHERE id=?").get(n.id)!
        .version,
    );
    assert.deepEqual(await f.vela("apply", first.id), first);
    assert.equal(
      f.db().prepare("SELECT version FROM resources WHERE id=?").get(n.id)!
        .version,
      version,
    );
    await f.apply({
      type: "associateResourceProject",
      resourceId: n.id,
      projectId: b,
    });
    assert.deepEqual(
      f
        .db()
        .prepare("SELECT * FROM blocks WHERE resource_id=? ORDER BY id")
        .all(n.id),
      placements,
    );
    const preserved = (await note(f, "readNote", n.id)).result;
    assert.equal(
      preserved.resource.content,
      "Synthetic preserved canonical content",
    );
    assert.equal(preserved.resource.project_id, b);
    assert.deepEqual(preserved.draft, draft);
    assert.equal(
      preserved.conflict,
      true,
      "Changed canonical versions must not silently rebase a recovery draft",
    );
    const localKinds = ["task", "task_group", "reference"] as const;
    for (const kind of localKinds) {
      const r = await resource(f, kind, "Synthetic " + kind);
      await f.apply({
        type: "renameResource",
        resourceId: r.id,
        title: "Synthetic renamed " + kind,
      });
      await f.apply({
        type: "associateResourceProject",
        resourceId: r.id,
        projectId: a,
      });
    }
    await f.core.command("desktop", {
      type: "navigate",
      target: { kind: "workspace", workspaceId: wa },
    });
    const state = (await f.vela("state")) as VelaBackendState;
    const scope = (f.core as any).velaHost.scope();
    assert(
      scope.resourceIds.includes(n.id),
      "The pre-existing A placement remains a reference to the same shared resource",
    );
    assert(!scope.resourceIds.includes(secret.id));
    assert(!scope.projectIds.includes(b));
    assert.deepEqual(
      await f.vela("search", "Synthetic unrelated private B"),
      [],
      "Reassignment does not grant discovery of the destination project resources",
    );
    assert.equal(
      (f.core as any).velaHost.readContent(
        secret.id,
        (f.core as any).velaHost.scope(),
      ),
      null,
    );
    const receipts = state.receipts.filter((item) => item.planId === first.id);
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].taskVerified, false);
    await f.reopen();
    assert.deepEqual(
      f
        .db()
        .prepare("SELECT * FROM blocks WHERE resource_id=? ORDER BY id")
        .all(n.id),
      placements,
    );
    assert.deepEqual((await note(f, "readNote", n.id)).result.draft, draft);
    const restored = (await f.vela("state")) as VelaBackendState;
    assert.equal(
      restored.receipts.filter((item) => item.planId === first.id).length,
      1,
    );
    const versionAfterRestart = f
      .db()
      .prepare("SELECT version FROM resources WHERE id=?")
      .get(n.id)!.version;
    assert.equal(((await f.vela("apply", first.id)) as VelaPlan).id, first.id);
    assert.equal(
      f.db().prepare("SELECT version FROM resources WHERE id=?").get(n.id)!
        .version,
      versionAfterRestart,
    );
    await f.apply({
      type: "associateResourceProject",
      resourceId: n.id,
      projectId: null,
    });
    assert.equal(
      f.db().prepare("SELECT project_id FROM resources WHERE id=?").get(n.id)!
        .project_id,
      null,
    );
    assert.deepEqual(
      f
        .db()
        .prepare("SELECT * FROM blocks WHERE resource_id=? ORDER BY id")
        .all(n.id),
      placements,
    );
    assert.equal(f.connections(), 0);
    assert.deepEqual((await f.core.command("snapshot", {})).executions, {});
  } finally {
    await f.close();
  }
});

test("stale canonical source/project versions, revoked organization authority and foreign destinations fail before mutation", async () => {
  const f = fixture();
  try {
    const a = await project(f, "Synthetic freshness A"),
      wa = await workspace(f, a, "Synthetic freshness workspace"),
      r = await resource(f, "note", "Synthetic freshness note", wa),
      b = await project(f, "Synthetic freshness B");
    await universe(f);
    const projectPlan = await f.prepare({
      type: "renameProject",
      projectId: a,
      title: "Should not replace newer project title",
    });
    (f.core as any).kernel.renameProject(
      a,
      "Synthetic concurrent project title",
      1,
    );
    await assert.rejects(
      f.vela("apply", projectPlan.id),
      /stale_target_version/,
    );
    const sourcePlan = await f.prepare({
      type: "renameResource",
      resourceId: r.id,
      title: "Should not replace newer note",
    });
    await f.core.command("desktop", {
      type: "content",
      resourceId: r.id,
      expectedVersion: r.version,
      content: "Synthetic concurrent note content",
    });
    await assert.rejects(
      f.vela("apply", sourcePlan.id),
      /stale_target_version/,
    );
    const destinationPlan = await f.prepare({
      type: "associateResourceProject",
      resourceId: r.id,
      projectId: b,
    });
    (f.core as any).kernel.renameProject(b, "Synthetic changed destination", 1);
    await assert.rejects(
      f.vela("apply", destinationPlan.id),
      /stale_target_version/,
    );
    const revoked = await f.prepare({
        type: "associateResourceProject",
        resourceId: r.id,
        projectId: b,
      }),
      core = f.core as any,
      allow = core.conversationAccess.project;
    core.conversationAccess.project = (
      id: string | null,
      ...args: unknown[]
    ) => (id === b ? false : allow(id, ...args));
    await assert.rejects(f.vela("apply", revoked.id), /host_policy_denied/);
    core.conversationAccess.project = allow;
    const sourceRevoked = await f.prepare({
        type: "renameResource",
        resourceId: r.id,
        title: "Denied source rename",
      }),
      access = core.conversationAccess.resource;
    core.conversationAccess.resource = (id: string, ...args: unknown[]) =>
      id === r.id ? false : access(id, ...args);
    await assert.rejects(
      f.vela("apply", sourceRevoked.id),
      /host_policy_denied/,
    );
    core.conversationAccess.resource = access;
    await f.core.command("desktop", {
      type: "navigate",
      target: { kind: "workspace", workspaceId: wa },
    });
    await assert.rejects(
      f.prepare({
        type: "associateResourceProject",
        resourceId: r.id,
        projectId: b,
      }),
      /resource_not_authorized/,
    );
    await universe(f);
    await f.core.command("desktop", {
      type: "archiveSubject",
      kind: "project",
      id: b,
      expectedVersion: 2,
      archived: true,
    });
    await assert.rejects(
      f.prepare({
        type: "associateResourceProject",
        resourceId: r.id,
        projectId: b,
      }),
      /resource_not_authorized/,
    );
    assert.equal(
      f.db().prepare("SELECT title FROM resources WHERE id=?").get(r.id)!.title,
      r.title,
    );
    assert.equal(
      f.db().prepare("SELECT project_id FROM resources WHERE id=?").get(r.id)!
        .project_id,
      a,
    );
    assert.equal(f.connections(), 0);
  } finally {
    await f.close();
  }
});

test("exact typed manifests, canonical non-chat identity and released capability gates cannot be forged", async () => {
  const f = fixture();
  try {
    const a = await project(f, "Synthetic manifest project"),
      r = await resource(f, "note", "Synthetic manifest note"),
      chat = await f.core.command("createConversation", {
        title: "Synthetic protected chat",
        providerId: "local",
        commandId: randomUUID(),
      });
    await universe(f);
    for (const type of ["renameResource", "associateResourceProject"] as const)
      await assert.rejects(
        f.prepare(
          type === "renameResource"
            ? {
                type,
                resourceId: chat.resourceId,
                title: "Forbidden generic rename",
              }
            : { type, resourceId: chat.resourceId, projectId: a },
        ),
        /resource_organization_unsupported/,
      );
    for (const value of [
      {
        type: "renameProject",
        projectId: a,
        title: "x",
        authorizationRef: "forged",
      },
      {
        type: "renameResource",
        resourceId: r.id,
        title: "x",
        expectedVersion: 1,
      },
      {
        type: "associateResourceProject",
        resourceId: r.id,
        projectId: a,
        scope: { projectIds: [a] },
      },
    ])
      assert.throws(
        () => validateAction(value),
        /unsupported_or_invalid_action/,
      );
    const p = await f.prepare({
        type: "associateResourceProject",
        resourceId: r.id,
        projectId: a,
      }),
      host = (f.core as any).velaHost;
    const input = {
      action: p.steps[0].action,
      commandId: "synthetic-omitted-manifest",
      requestId: p.requestId,
      planId: p.id,
      authorizationRef: p.authorizationRef,
      expectedVersions: p.targets.filter((item) => item.kind !== "project"),
    };
    assert.throws(
      () => host.applyNative(input),
      /canonical_action_target_manifest_required/,
    );
    assert.throws(
      () =>
        host.applyNative({
          ...input,
          expectedVersions: p.targets.filter(
            (item) => item.kind !== "resource",
          ),
        }),
      /canonical_action_target_manifest_required/,
    );
    const chatRef = host.resolve(
      { id: chat.resourceId, kind: "resource" },
      host.scope(),
    );
    assert.throws(
      () =>
        host.applyNative({
          ...input,
          action: {
            type: "renameResource",
            resourceId: chat.resourceId,
            title: "Direct generic chat bypass",
          },
          expectedVersions: [chatRef],
        }),
      /canonical_resource_organization_unsupported/,
    );
    const core = f.core as any,
      native = core.velaNative;
    f.core.registerVelaNativeCapabilities({
      ...native,
      supportedActions: native.supportedActions.filter(
        (id: string) =>
          ![
            "renameProject",
            "renameResource",
            "associateResourceProject",
          ].includes(id),
      ),
    });
    const unavailable = (await f.vela("state")) as VelaBackendState;
    for (const id of [
      "renameProject",
      "renameResource",
      "associateResourceProject",
    ])
      assert.equal(unavailable.nativeCapabilities[id].available, false);
    await assert.rejects(
      f.prepare({ type: "renameProject", projectId: a, title: "Unavailable" }),
      /host_policy_denied/,
    );
    assert.equal(f.connections(), 0);
    assert.equal(
      f.db().prepare("SELECT title FROM resources WHERE id=?").get(r.id)!.title,
      r.title,
    );
  } finally {
    await f.close();
  }
});

test("canonical write failure rolls organization back while preserving the draft and truthful uncertain receipt", async () => {
  const f = fixture();
  try {
    const r = await resource(f, "note", "Synthetic rollback note");
    await note(f, "saveNoteDraft", {
      resourceId: r.id,
      expectedDraftVersion: 0,
      baseResourceVersion: 1,
      content: "Synthetic recovery survives failure",
    });
    const plan = await f.prepare({
        type: "renameResource",
        resourceId: r.id,
        title: "Synthetic rolled-back title",
      }),
      kernel = (f.core as any).kernel,
      rename = kernel.renameResource;
    kernel.renameResource = function (...args: unknown[]) {
      rename.apply(this, args);
      throw new Error("Synthetic failure after canonical rename");
    };
    const result = (await f.vela("apply", plan.id)) as VelaPlan;
    kernel.renameResource = rename;
    assert.equal(result.state, "unknown");
    assert.equal(
      f.db().prepare("SELECT title FROM resources WHERE id=?").get(r.id)!.title,
      r.title,
    );
    assert.equal(
      f.db().prepare("SELECT version FROM resources WHERE id=?").get(r.id)!
        .version,
      1,
    );
    assert.equal(
      (await note(f, "readNote", r.id)).result.draft.content,
      "Synthetic recovery survives failure",
    );
    assert.equal(f.connections(), 0);
  } finally {
    await f.close();
  }
});
