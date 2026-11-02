import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { BackendCore } from "../src/core.mts";
import type { CommandMap, ProviderPort } from "../src/contracts.mts";
const { graphAction } = createRequire(import.meta.url)(
  "../../visual-experience/cinematic-v3/native/graph-actions.cjs",
);
const wire = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

test("real private spatial continuation keeps the local provider, reviewed lineage and source content after restart without connecting Codex", async () => {
  const root = mkdtempSync(join(tmpdir(), "aerynth-real-local-branch-")),
    path = join(root, "aerynth.sqlite");
  const options = {
    path,
    provider: "codex" as const,
    contentPolicy: "local-private" as const,
    privateRoot: root,
    cwd: root,
  };
  let core = new BackendCore(options),
    connections = 0;
  const forbidConnect = () => {
    const port = (core as unknown as { port: ProviderPort }).port;
    port.connect = async () => {
      connections++;
      throw new Error("branch_must_not_connect");
    };
  };
  forbidConnect();
  try {
    const workspace = await core.command("desktop", {
      type: "createWorkspace",
      title: "Synthetic branch workspace",
      projectId: null,
    });
    const parent = await core.command("createConversation", {
      title: "Synthetic local source",
      providerId: "local",
      commandId: randomUUID(),
    });
    await core.command("desktop", {
      type: "attach",
      workspaceId: workspace.activeWorkspaceId!,
      resourceId: parent.resourceId,
    });
    const selected = await core.command("addMessage", {
      resourceId: parent.resourceId,
      role: "user",
      content: "Synthetic selected source.",
      sensitivity: "internal",
      expectedRevision: 1,
    });
    await core.command("addMessage", {
      resourceId: parent.resourceId,
      role: "user",
      content: "Synthetic omitted source.",
      sensitivity: "internal",
      expectedRevision: 2,
    });
    const before = await core.command("snapshot", {}),
      request = {
        type: "branch",
        resourceId: parent.resourceId,
        messageId: selected.id,
        includeMessageIds: [selected.id],
        title: "Synthetic local continuation",
        providerId: "local",
        tokenBudget: 4096,
        workspaceId: workspace.activeWorkspaceId!,
      };
    const call = (name: keyof CommandMap, input: any) =>
      core.command(name, input);
    const desktop = await graphAction(request, call),
      edge = desktop.conversationBranches[0],
      child = desktop.resources.find(
        (resource: any) => resource.id === edge.childResourceId,
      );
    assert.equal(child.providerId, "local");
    assert.equal(child.provider, "local");
    assert.equal(edge.parentResourceId, parent.resourceId);
    assert.equal(edge.sourceMessageId, selected.id);
    assert.equal(edge.mode, "application_continuation");
    const state = await core.command("snapshot", {}),
      review = Object.values(state.handoffs).find(
        (item) => item.resourceId === child.id,
      )!;
    assert.equal(review.targetProviderId, "local");
    assert.equal(review.state, "prepared");
    const context = state.graph.handoffs.find((item) => item.id === review.id)!;
    assert.deepEqual(
      context.items.map((item) => item.sourceMessageId),
      [selected.id],
    );
    assert.deepEqual(
      state.graph.messages,
      before.graph.messages,
      "No provider response or duplicate source messages are invented",
    );
    assert.deepEqual(state.executions, {});
    assert.deepEqual(state.bindings, {});
    assert.equal(connections, 0);
    await core.command("review", {
      handoffId: review.id,
      fingerprint: review.fingerprint,
      approve: true,
    });
    const approved = wire(await core.command("snapshot", {}));
    await assert.rejects(
      graphAction({ ...request, providerId: "mock-ordinary" }, call),
      /provider_branch_handoff_unavailable/,
    );
    await assert.rejects(
      graphAction({ ...request, providerId: "codex-app-server" }, call),
      /provider_branch_handoff_unavailable/,
    );
    await assert.rejects(
      core.command("branch", {
        ...request,
        providerId: "mock-ordinary",
        commandId: randomUUID(),
      }),
      /synthetic_provider_forbidden/,
    );
    assert.deepEqual(
      wire(await core.command("snapshot", {})),
      approved,
      "Rejected synthetic target leaves canonical state untouched",
    );
    await core.command("close", {});
    core = new BackendCore(options);
    forbidConnect();
    const restored = wire(await core.command("snapshot", {}));
    assert.deepEqual(restored.graph, approved.graph);
    assert.deepEqual(restored.resourceMap, approved.resourceMap);
    assert.equal(restored.handoffs[review.id].state, "approved");
    assert.equal(
      restored.conversations.find((item) => item.resourceId === child.id)!
        .providerId,
      "local",
    );
    const detail = await core.command("conversation", {
      name: "detail",
      input: { resourceId: child.id },
    });
    assert.equal((detail as any).conversation.providerId, "local");
    assert.equal(connections, 0);
  } finally {
    await core.command("close", {});
  }
});
