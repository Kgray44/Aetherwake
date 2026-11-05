import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Backend } from "../src/service.mts";
import type { DesktopCommand } from "../../application-contract/contracts.ts";
test("task groups persist canonical memberships, share existing tasks, fence edits and report actual local statuses without executions", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aerynth-task-groups-")),
    options = {
      path: join(dir, "state.sqlite"),
      provider: "fixture" as const,
      contentPolicy: "synthetic-only" as const,
    };
  let backend = new Backend(options);
  const call = (a: DesktopCommand) => backend.call("desktop", a);
  try {
    let s = await call({
      type: "createWorkspace",
      title: "Synthetic task groups",
      projectId: null,
    });
    const workspaceId = s.activeWorkspaceId!;
    for (const kind of ["task", "task", "task_group", "note"] as const)
      s = await call({
        type: "createResource",
        kind,
        title: "Synthetic " + kind + " " + s.resources.length,
        workspaceId,
      });
    let group = s.resources.find((r) => r.kind === "task_group")!;
    const tasks = s.resources.filter((r) => r.kind === "task"),
      note = s.resources.find((r) => r.kind === "note")!;
    s = await call({
      type: "setTaskGroupMembers",
      groupId: group.id,
      expectedVersion: group.version,
      taskIds: tasks.map((t) => t.id),
    });
    group = s.resources.find((r) => r.id === group.id)!;
    assert.equal(s.resources.length, 4);
    assert.equal(group.taskMembers!.length, 2);
    assert(
      s.relationships.every(
        (e) => e.kind === "contains_task" && e.provenance === "user",
      ),
    );
    await assert.rejects(
      call({
        type: "setTaskGroupMembers",
        groupId: group.id,
        expectedVersion: group.version - 1,
        taskIds: [],
      }),
      /stale_resource_version/,
    );
    await assert.rejects(
      call({
        type: "setTaskGroupMembers",
        groupId: group.id,
        expectedVersion: group.version,
        taskIds: [note.id],
      }),
      /invalid_task_membership/,
    );
    s = await call({
      type: "taskStatus",
      resourceId: tasks[0].id,
      expectedVersion: tasks[0].version,
      status: "done",
    });
    assert.equal(
      s.resources
        .find((r) => r.id === group.id)!
        .taskMembers!.find((t) => t.id === tasks[0].id)!.status,
      "done",
    );
    const b = await call({
      type: "createWorkspace",
      title: "Synthetic shared view",
      projectId: null,
    });
    s = await call({
      type: "attach",
      workspaceId: b.activeWorkspaceId!,
      resourceId: group.id,
    });
    assert.equal(s.resources.length, 4);
    assert.equal(s.blocks[0].resource_id, group.id);
    await backend.close();
    backend = new Backend(options);
    s = await call({ type: "snapshot" });
    assert.equal(
      s.resources.find((r) => r.id === group.id)!.taskMembers!.length,
      2,
    );
    assert.equal(
      Object.keys((await backend.call("snapshot", {})).executions).length,
      0,
    );
    group = s.resources.find((r) => r.id === group.id)!;
    s = await call({
      type: "setTaskGroupMembers",
      groupId: group.id,
      expectedVersion: group.version,
      taskIds: [tasks[1].id],
    });
    assert.equal(s.relationships.length, 1);
    assert(
      s.resources.some((r) => r.id === tasks[0].id && r.taskStatus === "done"),
    );
  } finally {
    await backend.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
