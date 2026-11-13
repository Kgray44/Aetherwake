import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { BackendCore } from "../src/core.mts";
import type { ProviderPort, StreamEvent } from "../src/contracts.mts";
import type { EventEnvelope } from "../../codex-bridge/src/adapter.ts";

const wire = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
function cleanup(root: string) {
  const target = resolve(root),
    part = relative(resolve(tmpdir()), target);
  assert.ok(
    part.startsWith("aerynth-activity-") &&
      !part.startsWith("..") &&
      !isAbsolute(part),
  );
  rmSync(target, { recursive: true, force: true });
}

test("scoped actual private conversation activity is read-only, bounded and access checked without connecting a provider", async () => {
  const root = mkdtempSync(join(tmpdir(), "aerynth-activity-"));
  const core = new BackendCore({
    path: join(root, "canonical.sqlite"),
    privateRoot: root,
    cwd: root,
    provider: "codex",
    contentPolicy: "local-private",
  });
  let connections = 0;
  (core as unknown as { port: ProviderPort }).port.connect = async () => {
    connections++;
    throw Error("Activity reads must not connect");
  };
  try {
    const project = (
      await core.command("desktop", {
        type: "createProject",
        title: "Synthetic private activity scope",
      })
    ).projects[0];
    const conversation = await core.command("createConversation", {
      title: "Synthetic private activity",
      providerId: "codex-app-server",
      commandId: randomUUID(),
    });
    await core.command("conversation", {
      name: "organize",
      input: {
        type: "associateProject",
        resourceId: conversation.resourceId,
        projectId: project.id,
        expectedVersion: 1,
      },
    });
    assert.equal(
      (await core.command("desktop", { type: "snapshot" })).resources.find(
        (item) => item.id === conversation.resourceId,
      )!.project_id,
      project.id,
    );
    const before = wire(await core.command("snapshot", {}));
    const activity = await core.command("conversationActivity", {
      resourceIds: [conversation.resourceId, "synthetic-unknown-id"],
    });
    assert.deepEqual(activity.resources, [
      { resourceId: conversation.resourceId, available: true },
      { resourceId: "synthetic-unknown-id", available: false },
    ]);
    assert.equal(activity.contract, "aerynth.conversation-activity@1");
    assert.deepEqual(activity.executions, []);
    assert.equal(activity.preview, null);
    for (const resourceIds of [
      [conversation.resourceId, conversation.resourceId],
      Array.from({ length: 65 }, (_, index) => "synthetic-" + index),
      [""],
      ["x".repeat(257)],
    ])
      await assert.rejects(
        core.command("conversationActivity", { resourceIds }),
        /invalid_conversation_activity/,
      );
    assert.deepEqual(wire(await core.command("snapshot", {})), before);
    assert.equal(connections, 0);
    await core.command("desktop", {
      type: "archiveSubject",
      kind: "project",
      id: project.id,
      archived: true,
      expectedVersion: project.version,
    });
    const denied = await core.command("conversationActivity", {
      resourceIds: [conversation.resourceId],
    });
    assert.deepEqual(denied.resources, [
      { resourceId: conversation.resourceId, available: false },
    ]);
    assert.deepEqual(denied.executions, []);
    assert.equal(denied.preview, null);
    assert.equal(connections, 0);
  } finally {
    await core.command("close", {});
    cleanup(root);
  }
});

test("explicit fixture activity reuses the current Core output buffer, marks simulation and withholds output after canonical access loss", async () => {
  const root = mkdtempSync(join(tmpdir(), "aerynth-activity-")),
    events: StreamEvent[] = [];
  const core = new BackendCore(
    {
      path: join(root, "canonical.sqlite"),
      provider: "fixture",
      fixtureMode: "wait-interrupt",
      contentPolicy: "synthetic-only",
    },
    (event) => events.push(event),
  );
  const native: EventEnvelope[] = [];
  const stop = (core as unknown as { port: ProviderPort }).port.onEvent(
    (event) => native.push(event),
  );
  let running: Promise<unknown> | undefined;
  try {
    const project = (
      await core.command("desktop", {
        type: "createProject",
        title: "Synthetic fixture activity scope",
      })
    ).projects[0];
    const conversation = await core.command("createConversation", {
      title: "EXPLICIT SIMULATED activity",
      providerId: "fixture-codex",
      commandId: randomUUID(),
    });
    await core.command("conversation", {
      name: "organize",
      input: {
        type: "associateProject",
        resourceId: conversation.resourceId,
        projectId: project.id,
        expectedVersion: 1,
      },
    });
    assert.equal(
      (await core.command("desktop", { type: "snapshot" })).resources.find(
        (item) => item.id === conversation.resourceId,
      )!.project_id,
      project.id,
    );
    const idle = await core.command("createConversation", {
      title: "Idle synthetic chat",
      providerId: "fixture-codex",
      commandId: randomUUID(),
    });
    const listRunning = () => core.command("conversation", {
      name: "list",
      input: { runningOnly: true, sort: "active", limit: 1 },
    });
    running = core.command("execute", {
      resourceId: conversation.resourceId,
      prompt: "Explicit synthetic fixture, no actual provider",
      commandId: randomUUID(),
      authorized: true,
    });
    let activity = await core.command("conversationActivity", {
      resourceIds: [conversation.resourceId],
    });
    for (let attempt = 0; !activity.preview && attempt < 50; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      activity = await core.command("conversationActivity", {
        resourceIds: [conversation.resourceId],
      });
    }
    assert.equal(activity.executions.length, 1);
    const execution = activity.executions[0];
    assert.equal(execution.state, "running");
    const runningPage = await listRunning();
    assert.equal(runningPage.total, 1);
    assert.equal(runningPage.hasMore, false);
    assert.deepEqual(runningPage.items.map(item => item.resourceId), [conversation.resourceId]);
    assert.equal(runningPage.items[0].execution?.id, execution.id);
    const history = await core.command("conversation", { name: "list", input: { sort: "active" } });
    assert.ok(history.items.some(item => item.resourceId === idle.resourceId));
    assert.equal(execution.taskVerified, false);
    assert.deepEqual(
      Object.keys(execution).sort(),
      [
        "id",
        "resourceId",
        "providerId",
        "commandId",
        "state",
        "startedAt",
        "endedAt",
        "taskVerified",
      ].sort(),
    );
    assert.equal(activity.preview!.text, "INTEGRATION_OK");
    assert.equal(activity.preview!.classification, "simulated");
    assert.equal(activity.preview!.executionId, execution.id);
    assert.ok(activity.preview!.cursor > 0);
    assert.deepEqual(
      await core.command("conversationActivity", {
        resourceIds: [conversation.resourceId],
      }),
      activity,
      "Reopening reads the same complete ephemeral preview",
    );
    const omitted = await core.command("conversationActivity", {
      resourceIds: ["unrelated-request"],
    });
    assert.deepEqual(omitted.executions, []);
    assert.equal(omitted.preview, null);
    // Model an independent canonical project archive while the fixture is pending.
    const kernel = (core as any).kernel;
    kernel.setProjectArchived(project.id, true, project.version);
    const count = events.filter(
      (event) => typeof event.payload.delta === "string",
    ).length;
    const raw = native.find(
      (event) => event.method === "item/agentMessage/delta",
    )!;
    (core as any).ingest({
      ...raw,
      eventId: randomUUID(),
      sequence: raw.sequence + 1,
      payload: { delta: "Synthetic output after archive" },
    });
    assert.equal(
      events.filter((event) => typeof event.payload.delta === "string").length,
      count,
      "Archived output cannot cross the desktop boundary",
    );
    const denied = await core.command("conversationActivity", {
      resourceIds: [conversation.resourceId],
    });
    assert.deepEqual(denied.resources, [
      { resourceId: conversation.resourceId, available: false },
    ]);
    assert.deepEqual(denied.executions, []);
    assert.equal(denied.preview, null);
    assert.equal((await listRunning()).total, 0);
    await core.command("interrupt", { executionId: execution.id });
    await running;
    running = undefined;
    kernel.setProjectArchived(project.id, false, project.version + 1);
    const terminal = await core.command("conversationActivity", {
      resourceIds: [conversation.resourceId],
    });
    assert.equal(terminal.executions[0].state, "interrupted");
    assert.equal(terminal.preview, null);
    assert.equal((await listRunning()).total, 0);
    running = core.command("execute", {
      resourceId: conversation.resourceId,
      prompt: "Second explicit synthetic fixture",
      commandId: randomUUID(),
      authorized: true,
    });
    let next = await core.command("conversationActivity", {
      resourceIds: [conversation.resourceId],
    });
    for (
      let attempt = 0;
      (!next.preview || next.preview.executionId === execution.id) &&
      attempt < 50;
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      next = await core.command("conversationActivity", {
        resourceIds: [conversation.resourceId],
      });
    }
    assert.equal(
      next.executions.length,
      1,
      "Polling does not copy complete execution history",
    );
    assert.notEqual(next.executions[0].id, execution.id);
    assert.equal(
      next.preview!.text,
      "INTEGRATION_OK",
      "A new turn does not inherit the previous live buffer",
    );
  } finally {
    stop();
    if (running) {
      const state = await core.command("snapshot", {});
      for (const execution of Object.values(state.executions))
        if (["running", "dispatching"].includes(execution.state))
          await core.command("interrupt", { executionId: execution.id });
      await running;
    }
    await core.command("close", {});
    cleanup(root);
  }
});
