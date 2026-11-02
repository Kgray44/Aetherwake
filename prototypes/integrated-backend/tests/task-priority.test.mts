import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Backend } from "../src/service.mts";
import type { DesktopCommand } from "../../application-contract/contracts.ts";

test("canonical task priority, local status and description retain each other across edits, shared placements and restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "aerynth-task-priority-")),
    options = {
      path: join(directory, "synthetic.sqlite"),
      provider: "fixture" as const,
      contentPolicy: "synthetic-only" as const,
    };
  let backend = new Backend(options);
  const call = (command: DesktopCommand) => backend.call("desktop", command);
  try {
    let state = await call({
      type: "createWorkspace",
      title: "Synthetic priority workspace",
      projectId: null,
    });
    state = await call({
      type: "createResource",
      kind: "task",
      title: "Synthetic priority task",
      workspaceId: state.activeWorkspaceId,
    });
    let task = state.resources.find((r) => r.kind === "task")!,
      id = task.id;
    assert.equal(task.taskPriority, "normal");
    state = await call({
      type: "taskPriority",
      resourceId: id,
      expectedVersion: task.version,
      priority: "urgent",
    });
    task = state.resources.find((r) => r.id === id)!;
    assert.equal(task.taskPriority, "urgent");
    assert.equal(task.taskStatus, "open");
    state = await call({
      type: "content",
      resourceId: id,
      expectedVersion: task.version,
      content: "Synthetic task description",
    });
    task = state.resources.find((r) => r.id === id)!;
    state = await call({
      type: "taskStatus",
      resourceId: id,
      expectedVersion: task.version,
      status: "done",
    });
    task = state.resources.find((r) => r.id === id)!;
    assert.equal(task.taskPriority, "urgent");
    assert.equal(task.content, "Synthetic task description");
    assert.equal(task.taskStatus, "done");
    assert.equal(task.execution, undefined);
    await assert.rejects(
      call({
        type: "taskPriority",
        resourceId: id,
        expectedVersion: 1,
        priority: "low",
      }),
      /CONFLICT/,
    );
    state = await call({
      type: "attach",
      workspaceId: state.activeWorkspaceId!,
      resourceId: id,
    });
    assert.equal(state.blocks.filter((b) => b.resource_id === id).length, 2);
    await backend.close();
    backend = new Backend(options);
    state = await call({ type: "snapshot" });
    task = state.resources.find((r) => r.id === id)!;
    assert.equal(task.taskPriority, "urgent");
    assert.equal(task.taskStatus, "done");
    assert.equal(task.content, "Synthetic task description");
    state = await call({
      type: "taskPriority",
      resourceId: id,
      expectedVersion: task.version,
      priority: "low",
    });
    assert.equal(state.resources.find((r) => r.id === id)?.taskStatus, "done");
  } finally {
    await backend.close();
    const target = resolve(directory);
    assert.ok(target.startsWith(resolve(tmpdir()) + "\\"));
    rmSync(target, { recursive: true, force: true });
  }
});
