import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { BackendCore } from "../src/core.mts";
import type {
  ConversationProductRequest,
  ProviderPort,
  VelaBackendState,
  VelaOperation,
} from "../src/contracts.mts";
import type {
  VelaNativeAction,
  VelaPlan,
} from "../../vela-core/src/contracts.ts";
import type { ProductCommandMap } from "../../conversation-product/src/contracts.ts";
import { validateAction } from "../../vela-core/src/capabilities.ts";
// Native transport/persistence is JSON; omitted optional undefined properties
// are compared in that exact public representation on both sides of restart.
const wire = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

function fixture(provider: "codex" | "fixture" = "codex") {
  const dir = mkdtempSync(join(tmpdir(), "aerynth-vela-conversation-actions-")),
    path = join(dir, "canonical.sqlite");
  let connections = 0;
  const open = () => {
    const value = new BackendCore({
      path,
      privateRoot: dir,
      cwd: dir,
      provider,
      contentPolicy: provider === "codex" ? "local-private" : "synthetic-only",
    });
    (value as unknown as { port: ProviderPort }).port.connect = async () => {
      connections++;
      throw new Error("Conversation organization must remain offline");
    };
    return value;
  };
  let core = open();
  const vela = (name: VelaOperation["name"], input: unknown = {}) =>
    core.command("vela", { name, input } as VelaOperation);
  const product = (name: keyof ProductCommandMap, input: unknown = {}) =>
    core.command("conversation", { name, input } as ConversationProductRequest);
  const prepare = (action: VelaNativeAction) =>
    vela("native", {
      intent: "Synthetic explicit native " + action.type,
      action,
    }) as Promise<VelaPlan>;
  const apply = async (action: VelaNativeAction) => {
    const plan = await prepare(action),
      applied = (await vela("apply", plan.id)) as VelaPlan;
    const receipt = ((await vela("state")) as VelaBackendState).receipts.find(
      (item) => item.planId === plan.id,
    )!;
    assert.equal(
      applied.state,
      "applied",
      action.type + ": " + receipt?.errorCode,
    );
    assert.equal(receipt.taskVerified, false);
    return { plan: applied, receipt };
  };
  return {
    get core() {
      return core;
    },
    vela,
    product,
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
        part.startsWith("aerynth-vela-conversation-actions-") &&
          !part.startsWith("..") &&
          !isAbsolute(part),
      );
      rmSync(target, { recursive: true, force: true });
    },
  };
}

test("Vela creates real empty local/Codex chats and organizes an existing branch without changing IDs, lineage, messages, drafts or provider state", async () => {
  const f = fixture();
  try {
    const a = await f.apply({
        type: "createProject",
        title: "Synthetic conversation project A",
      }),
      projectA = a.receipt.createdProjectId!;
    await f.apply({
      type: "createWorkspace",
      title: "Synthetic conversation workspace",
      projectId: projectA,
    });
    const local = await f.apply({
      type: "createConversation",
      title: "Synthetic independent local source",
      providerId: "local",
    });
    const codex = await f.apply({
      type: "createConversation",
      title: "Synthetic Codex identity without execution",
      providerId: "codex-app-server",
    });
    const sourceId = local.receipt.createdResourceId!,
      codexId = codex.receipt.createdResourceId!;
    let backend = await f.core.command("snapshot", {});
    assert.equal(
      backend.conversations.find((c) => c.resourceId === sourceId)!.projectId,
      projectA,
    );
    assert.equal(
      backend.conversations.find((c) => c.resourceId === codexId)!.providerId,
      "codex-app-server",
    );
    for (const id of [sourceId, codexId])
      assert.equal(
        (
          (await f.product("detail", {
            resourceId: id,
          })) as ProductCommandMap["detail"]["output"]
        ).messages.total,
        0,
      );
    assert.deepEqual(backend.bindings, {});
    assert.deepEqual(backend.executions, {});
    assert.equal(f.connections(), 0);
    const message = await f.core.command("addMessage", {
      resourceId: sourceId,
      role: "user",
      content: "Synthetic preserved branch origin",
      expectedRevision: 1,
    });
    const branch = await f.core.command("branch", {
      resourceId: sourceId,
      messageId: message.id,
      includeMessageIds: [message.id],
      providerId: "local",
      title: "Synthetic child branch",
      commandId: randomUUID(),
      tokenBudget: 32768,
    });
    const childId = branch.conversation.resourceId;
    await f.core.command("addMessage", {
      resourceId: childId,
      role: "user",
      content: "Synthetic preserved child finding",
      expectedRevision: 1,
    });
    const draft = (await f.product("saveDraft", {
      resourceId: childId,
      expectedVersion: 0,
      content: "Synthetic unsent child recovery",
    })) as ProductCommandMap["saveDraft"]["output"];
    backend = await f.core.command("snapshot", {});
    const ids = [sourceId, codexId, childId],
      graphIds = new Set(ids.map((id) => backend.resourceMap[id]));
    const original = wire({
      map: Object.fromEntries(ids.map((id) => [id, backend.resourceMap[id]])),
      messages: backend.graph.messages.filter((m) =>
        graphIds.has(m.conversationId),
      ),
      edges: backend.graph.edges,
      handoffs: backend.handoffs,
    });
    const favorite = await f.apply({
      type: "conversationFavorite",
      resourceId: childId,
      favorite: true,
    });
    const rename = await f.prepare({
      type: "renameConversation",
      resourceId: childId,
      title: "Synthetic renamed branch",
    });
    const raw = (
      await f.core.command("desktop", { type: "snapshot" })
    ).resources.find((r) => r.id === childId)!;
    assert.notEqual(
      rename.targets.find((ref) => ref.id === childId)!.version,
      raw.version,
      "Composite message/entity tokens never become raw mutation versions",
    );
    assert.equal(
      ((await f.vela("apply", rename.id)) as VelaPlan).state,
      "applied",
    );
    const b = await f.apply({
        type: "createProject",
        title: "Synthetic conversation project B",
      }),
      projectB = b.receipt.createdProjectId!;
    await f.apply({
      type: "navigate",
      target: { kind: "constellation", projectId: null },
    });
    const association = await f.apply({
      type: "associateConversationProject",
      resourceId: childId,
      projectId: projectB,
    });
    assert(
      association.plan.targets.some(
        (ref) => ref.kind === "project" && ref.id === projectB,
      ),
    );
    let detail = (await f.product("detail", {
      resourceId: childId,
    })) as ProductCommandMap["detail"]["output"];
    assert.equal(detail.conversation.title, "Synthetic renamed branch");
    assert.equal(detail.conversation.favorite, true);
    assert.equal(detail.conversation.projectId, projectB);
    assert.equal(detail.conversation.providerId, "local");
    assert.deepEqual(
      await f.product("readDraft", { resourceId: childId }),
      draft,
    );
    const expected = await f.core.command("snapshot", {});
    assert.deepEqual(
      Object.fromEntries(ids.map((id) => [id, expected.resourceMap[id]])),
      original.map,
    );
    assert.deepEqual(
      wire(
        expected.graph.messages.filter((m) => graphIds.has(m.conversationId)),
      ),
      original.messages,
    );
    assert.deepEqual(wire(expected.graph.edges), original.edges);
    assert.deepEqual(wire(expected.handoffs), original.handoffs);
    const count = expected.conversations.length;
    for (const planId of [
      local.plan.id,
      codex.plan.id,
      favorite.plan.id,
      rename.id,
      association.plan.id,
    ])
      assert.equal(
        ((await f.vela("apply", planId)) as VelaPlan).state,
        "applied",
      );
    assert.equal(
      (await f.core.command("snapshot", {})).conversations.length,
      count,
    );
    const receipts = ((await f.vela("state")) as VelaBackendState).receipts;
    await f.reopen();
    detail = (await f.product("detail", {
      resourceId: childId,
    })) as ProductCommandMap["detail"]["output"];
    assert.equal(detail.conversation.resourceId, childId);
    assert.equal(detail.conversation.title, "Synthetic renamed branch");
    assert.equal(detail.conversation.favorite, true);
    assert.equal(detail.conversation.projectId, projectB);
    assert.equal(detail.conversation.providerId, "local");
    assert.deepEqual(
      await f.product("readDraft", { resourceId: childId }),
      draft,
    );
    const restored = await f.core.command("snapshot", {});
    assert.deepEqual(
      Object.fromEntries(ids.map((id) => [id, restored.resourceMap[id]])),
      original.map,
    );
    assert.deepEqual(
      wire(
        restored.graph.messages.filter((m) => graphIds.has(m.conversationId)),
      ),
      original.messages,
    );
    assert.deepEqual(wire(restored.graph.edges), original.edges);
    assert.deepEqual(wire(restored.handoffs), original.handoffs);
    assert.deepEqual(
      ((await f.vela("state")) as VelaBackendState).receipts,
      receipts,
    );
    assert.deepEqual(restored.bindings, {});
    assert.deepEqual(restored.executions, {});
    assert.equal(f.connections(), 0);
  } finally {
    await f.close();
  }
});

test("conversation actions refuse raw/message staleness, revoked sources, unauthorized projects and changed implicit creation context", async () => {
  const f = fixture();
  try {
    const a = await f.apply({
        type: "createProject",
        title: "Synthetic allowed project",
      }),
      b = await f.apply({
        type: "createProject",
        title: "Synthetic other project",
      }),
      projectA = a.receipt.createdProjectId!,
      projectB = b.receipt.createdProjectId!;
    await f.apply({
      type: "createWorkspace",
      title: "Synthetic current workspace",
      projectId: projectA,
    });
    const chat = await f.apply({
        type: "createConversation",
        title: "Synthetic active conversation",
        providerId: "local",
      }),
      resourceId = chat.receipt.createdResourceId!;
    const rename = await f.prepare({
      type: "renameConversation",
      resourceId,
      title: "Must not overwrite a newer title",
    });
    await f.product("organize", {
      type: "renameConversation",
      resourceId,
      title: "Synthetic user rename",
      expectedVersion: 1,
      expectedRevision: 1,
    });
    await assert.rejects(f.vela("apply", rename.id), /stale_target_version/);
    const favorite = await f.prepare({
      type: "conversationFavorite",
      resourceId,
      favorite: true,
    });
    await f.core.command("addMessage", {
      resourceId,
      role: "user",
      content: "Synthetic newer message",
      expectedRevision: 2,
    });
    await assert.rejects(f.vela("apply", favorite.id), /stale_target_version/);
    await assert.rejects(
      f.prepare({
        type: "associateConversationProject",
        resourceId,
        projectId: projectB,
      }),
      /resource_not_authorized/,
    );
    const revoked = await f.prepare({
      type: "conversationFavorite",
      resourceId,
      favorite: true,
    });
    const current = (
      await f.core.command("desktop", { type: "snapshot" })
    ).resources.find((r) => r.id === resourceId)!;
    await f.core.command("desktop", {
      type: "archiveSubject",
      kind: "resource",
      id: resourceId,
      expectedVersion: current.version,
      archived: true,
    });
    await assert.rejects(
      f.vela("apply", revoked.id),
      /resource_not_authorized/,
    );
    await f.core.command("desktop", {
      type: "archiveSubject",
      kind: "resource",
      id: resourceId,
      expectedVersion: current.version + 1,
      archived: false,
    });
    assert.equal(
      (
        (await f.product("detail", {
          resourceId,
        })) as ProductCommandMap["detail"]["output"]
      ).conversation.favorite,
      false,
    );
    const create = await f.prepare({
        type: "createConversation",
        title: "Must not appear in another project",
        providerId: "local",
      }),
      before = (await f.core.command("snapshot", {})).conversations.length;
    assert(
      create.targets.some(
        (ref) => ref.kind === "project" && ref.id === projectA,
      ),
    );
    await f.core.command("desktop", {
      type: "navigate",
      target: { kind: "constellation", projectId: projectB },
    });
    await assert.rejects(f.vela("apply", create.id), /resource_not_authorized/);
    assert.equal(
      (await f.core.command("snapshot", {})).conversations.length,
      before,
    );
    await f.core.command("desktop", {
      type: "navigate",
      target: { kind: "constellation", projectId: null },
    });
    const independent = await f.prepare({
      type: "createConversation",
      title: "Must not silently acquire project ownership",
      providerId: "local",
    });
    await f.core.command("desktop", {
      type: "navigate",
      target: { kind: "constellation", projectId: projectA },
    });
    const denied = (await f.vela("apply", independent.id)) as VelaPlan;
    assert.equal(denied.state, "failed");
    assert.equal(
      ((await f.vela("state")) as VelaBackendState).receipts.find(
        (r) => r.planId === independent.id,
      )!.errorCode,
      "stale_target_version",
    );
    assert.equal(
      (await f.core.command("snapshot", {})).conversations.length,
      before,
    );
    assert.equal(f.connections(), 0);
  } finally {
    await f.close();
  }
});

test("provider arguments and released conversation capabilities stay truthful without connecting or exposing native methods as RPC commands", async () => {
  for (const invalid of [
    { type: "createConversation", title: "Synthetic", providerId: "chatgpt" },
    {
      type: "createConversation",
      title: "Synthetic",
      providerId: "local",
      projectId: "forged",
    },
    {
      type: "conversationFavorite",
      resourceId: "r",
      favorite: true,
      authorizationRef: "forged",
    },
    {
      type: "renameConversation",
      resourceId: "r",
      title: "Synthetic",
      expectedRevision: 1,
    },
    {
      type: "associateConversationProject",
      resourceId: "r",
      projectId: "p",
      grantId: "forged",
    },
  ])
    assert.throws(
      () => validateAction(invalid),
      /unsupported_or_invalid_action/,
    );
  const f = fixture("fixture");
  try {
    const state = (await f.vela("state")) as VelaBackendState,
      capability = state.capabilities.find(
        (c) => c.id === "createConversation",
      )!;
    assert.deepEqual(
      (capability.schema.properties as any).providerId.enum,
      ["local"],
      "A fixture cannot advertise real Codex recording",
    );
    await assert.rejects(
      f.prepare({
        type: "createConversation",
        title: "Unavailable real Codex",
        providerId: "codex-app-server",
      }),
      /host_policy_denied/,
    );
    const local = await f.apply({
        type: "createConversation",
        title: "Synthetic permitted local chat",
        providerId: "local",
      }),
      resourceId = local.receipt.createdResourceId!;
    await assert.rejects(
      f.core.command("conversation", {
        name: "nativeFavorite",
        input: { resourceId, favorite: true },
      } as any),
      /unsupported_product_command/,
    );
    await assert.rejects(
      f.core.command("conversation", {
        name: "native",
        input: {
          type: "renameConversation",
          resourceId,
          title: "Forged native RPC",
        },
      } as any),
      /unsupported_product_command/,
    );
    assert.equal(
      (
        (await f.product("detail", {
          resourceId,
        })) as ProductCommandMap["detail"]["output"]
      ).conversation.favorite,
      false,
    );
    f.core.registerVelaNativeCapabilities({
      supportedActions: [],
      dispatch: () => {
        throw new Error("Disabled releases must never dispatch");
      },
    });
    const disabled = (await f.vela("state")) as VelaBackendState;
    for (const id of [
      "createConversation",
      "conversationFavorite",
      "renameConversation",
      "associateConversationProject",
    ]) {
      assert.equal(disabled.nativeCapabilities[id].available, false);
      assert(!disabled.capabilities.some((c) => c.id === id));
    }
    await assert.rejects(
      f.prepare({ type: "conversationFavorite", resourceId, favorite: true }),
      /host_policy_denied/,
    );
    assert.equal(f.connections(), 0);
    assert.deepEqual((await f.core.command("snapshot", {})).executions, {});
  } finally {
    await f.close();
  }
});
