import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Backend } from "../src/service.mts";
import { WorkspaceKernel } from "../../workspace-kernel/kernel.mts";
import type { DesktopCommand } from "../../application-contract/contracts.ts";

test("desktop journey persists real resources, two workspaces, shapes, geometry, detach, reattach and history", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aerynth-desktop-test-")),
    path = join(dir, "state.sqlite");
  let b = new Backend({
    path,
    provider: "fixture",
    contentPolicy: "synthetic-only",
  });
  let call = (a: DesktopCommand) => b.call("desktop", a);
  try {
    assert.equal((await call({ type: "snapshot" })).blocks.length, 0);
    let s = await call({ type: "createProject", title: "A World for Two" });
    s = await call({
      type: "createWorkspace",
      title: "Development",
      projectId: s.projects[0].id,
    });
    const w1 = s.activeWorkspaceId!;
    for (const kind of ["conversation", "note", "task"] as const)
      s = await call({
        type: "createResource",
        kind,
        title: "Synthetic " + kind,
        workspaceId: w1,
      });
    const note = s.resources.find((r) => r.kind === "note")!;
    s = await call({
      type: "content",
      resourceId: note.id,
      expectedVersion: note.version,
      content: "Synthetic durable note",
    });
    const n = s.blocks.find((b) => b.resource_id === note.id)!;
    s = await call({
      type: "geometry",
      blockId: n.id,
      expectedVersion: n.version,
      placement: { x: 315, y: 270, width: 360, height: 360, z: 8 },
      shape: "circle",
    });
    await assert.rejects(
      call({ type: "detach", blockId: n.id, expectedVersion: n.version }),
      /stale_block_version/,
    );
    s = await call({
      type: "detach",
      blockId: n.id,
      expectedVersion: s.blocks.find((b) => b.id === n.id)!.version,
    });
    assert(
      s.resources.some(
        (r) => r.id === note.id && r.content === "Synthetic durable note",
      ),
    );
    s = await call({ type: "attach", resourceId: note.id, workspaceId: w1 });
    const stableBlocks = s.blocks;
    s = await call({
      type: "createWorkspace",
      title: "Research",
      projectId: s.projects[0].id,
    });
    const w2 = s.activeWorkspaceId!;
    assert.equal(s.blocks.length, 0);
    s = await call({ type: "attach", resourceId: note.id, workspaceId: w2 });
    assert.equal(s.resources.filter((r) => r.id === note.id).length, 1);
    await call({
      type: "navigate",
      target: { kind: "constellation", projectId: s.projects[0].id },
    });
    await call({
      type: "navigate",
      target: { kind: "workspace", workspaceId: w1 },
    });
    await call({ type: "back" });
    s = await call({ type: "snapshot" });
    assert.equal(s.navigation.kind, "constellation");
    s = await call({
      type: "navigate",
      target: { kind: "workspace", workspaceId: w1 },
    });
    assert.deepEqual(s.blocks, stableBlocks);
    await b.close();
    b = new Backend({
      path,
      provider: "fixture",
      contentPolicy: "synthetic-only",
    });
    call = (a) => b.call("desktop", a);
    s = await call({ type: "snapshot" });
    assert.equal(s.activeWorkspaceId, w1);
    assert.deepEqual(s.blocks, stableBlocks);
    assert.equal(
      s.resources.find((r) => r.id === note.id)!.content,
      "Synthetic durable note",
    );
  } finally {
    await b.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("desktop checkpoints, undo, invalid geometry and failed commands preserve resource data", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aerynth-layout-test-"));
  const b = new Backend({
    path: join(dir, "db"),
    provider: "fixture",
    contentPolicy: "synthetic-only",
  });
  const call = (a: DesktopCommand) => b.call("desktop", a);
  try {
    let s = await call({
      type: "createWorkspace",
      title: "Empty is valid",
      projectId: null,
    });
    s = await call({
      type: "createResource",
      kind: "note",
      title: "Synthetic",
      workspaceId: s.activeWorkspaceId,
    });
    const first = s.blocks[0];
    await call({ type: "checkpoint" });
    for (const p of [
      { ...first, width: -10 },
      { ...first, x: Infinity },
      { ...first, width: 100000 },
    ])
      await assert.rejects(
        call({
          type: "geometry",
          blockId: first.id,
          expectedVersion: first.version,
          placement: p,
          shape: "rectangle",
        }),
      );
    s = await call({ type: "snapshot" });
    assert.equal(s.blocks[0].width, first.width);
    await call({
      type: "detach",
      blockId: first.id,
      expectedVersion: first.version,
    });
    s = await call({ type: "undo" });
    assert.equal(s.blocks[0].id, first.id);
    assert.equal(s.blocks[0].resource_id, first.resource_id);
    await call({
      type: "content",
      resourceId: first.resource_id,
      expectedVersion: 1,
      content: "Content survives layout restore",
    });
    s = await call({ type: "restore" });
    assert.equal(s.resources[0].content, "Content survives layout restore");
    await assert.rejects(
      call({
        type: "createWorkspace",
        title: "Invalid project",
        projectId: "missing",
      }),
    );
    assert.equal((await call({ type: "snapshot" })).workspaces.length, 1);
  } finally {
    await b.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("local private mode requires a host-owned external root, preserves ordinary messages without simulated output", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aerynth-private-test-"));
  mkdirSync(join(dir, "private"));
  const b = new Backend({
    path: join(dir, "private", "db"),
    privateRoot: join(dir, "private"),
    provider: "fixture",
    contentPolicy: "local-private",
  });
  try {
    let s = await b.call("desktop", {
      type: "createResource",
      kind: "conversation",
      title: "Standalone",
      provider: "local",
      workspaceId: null,
    });
    assert.equal(s.workspaces.length, 0);
    const c = s.resources[0];
    await b.call("addMessage", {
      resourceId: c.id,
      role: "user",
      content: "Synthetic local message",
      expectedRevision: c.version,
    });
    s = await b.call("desktop", { type: "snapshot" });
    assert.equal(s.resources[0].messages.length, 1);
    assert.equal(s.resources[0].messages[0].role, "user");
  } finally {
    await b.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("interim desktop v1 upgrades to engine recovery without resetting data or identities", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aerynth-migrate-test-")),
    path = join(dir, "db");
  const kernel = WorkspaceKernel.open(path),
    workspace = kernel.createWorkspace("Legacy synthetic workspace"),
    note = kernel.createNote("Legacy synthetic note", "Preserved content");
  const block = kernel.attachBlock(workspace.id, note.id, {
    x: 80,
    y: 260,
    width: 300,
    height: 300,
    z: 0,
  });
  kernel.withTransaction((db) => {
    db.exec(
      "CREATE TABLE desktop_schema(version INTEGER NOT NULL); INSERT INTO desktop_schema VALUES(1); CREATE TABLE desktop_resources(resource_id TEXT PRIMARY KEY REFERENCES resources(id),kind TEXT NOT NULL); CREATE TABLE desktop_blocks(block_id TEXT PRIMARY KEY REFERENCES blocks(id) ON DELETE CASCADE,shape TEXT NOT NULL); CREATE TABLE desktop_session(id INTEGER PRIMARY KEY,json TEXT NOT NULL); CREATE TABLE desktop_undo(id INTEGER PRIMARY KEY AUTOINCREMENT,workspace_id TEXT NOT NULL,json TEXT NOT NULL); CREATE TABLE desktop_checkpoints(workspace_id TEXT PRIMARY KEY,json TEXT NOT NULL);",
    );
    db.prepare("INSERT INTO desktop_resources VALUES(?,?)").run(
      note.id,
      "note",
    );
    db.prepare("INSERT INTO desktop_blocks VALUES(?,?)").run(
      block.id,
      "circle",
    );
    db.prepare("INSERT INTO desktop_session VALUES(1,?)").run(
      JSON.stringify({
        activeWorkspaceId: workspace.id,
        navigation: { kind: "workspace", workspaceId: workspace.id },
        history: [],
        revision: 1,
      }),
    );
    const before = JSON.stringify({
      blocks: [{ ...block, x: 32, shape: "rectangle" }],
    });
    db.prepare("INSERT INTO desktop_undo(workspace_id,json) VALUES(?,?)").run(
      workspace.id,
      before,
    );
    db.prepare("INSERT INTO desktop_checkpoints VALUES(?,?)").run(
      workspace.id,
      before,
    );
  });
  kernel.close();
  const b = new Backend({
    path,
    provider: "fixture",
    contentPolicy: "synthetic-only",
  });
  try {
    let s = await b.call("desktop", { type: "snapshot" });
    assert.equal(s.blocks[0].id, block.id);
    assert.equal(s.blocks[0].shape, "circle");
    assert.equal(s.resources[0].content, "Preserved content");
    assert(s.canUndo && s.hasCheckpoint);
    s = await b.call("desktop", { type: "undo" });
    assert.equal(s.blocks[0].x, 32);
    assert.equal(s.blocks[0].resource_id, note.id);
    await b.call("desktop", { type: "restore" });
    assert.equal(
      (await b.call("desktop", { type: "snapshot" })).resources[0].content,
      "Preserved content",
    );
  } finally {
    await b.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("private navigation state is bounded and local task completion survives reopening", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aerynth-task-test-")),
    path = join(dir, "db");
  let b = new Backend({
    path,
    provider: "fixture",
    contentPolicy: "synthetic-only",
  });
  try {
    let s = await b.call("desktop", {
      type: "createResource",
      kind: "task",
      title: "Synthetic task",
      workspaceId: null,
    });
    const id = s.resources[0].id;
    await b.call("desktop", {
      type: "taskStatus",
      resourceId: id,
      expectedVersion: 1,
      status: "done",
    });
    await assert.rejects(b.call("viewState", { state: { schema: "wrong" } }));
    const view = {
      schema: "aerynth.constellation@1",
      anchors: {},
      bookmarks: {},
      history: [],
      location: { kind: "universe" },
    };
    await b.call("viewState", { state: view });
    assert.deepEqual(await b.call("viewState", {}), view);
    await b.close();
    b = new Backend({
      path,
      provider: "fixture",
      contentPolicy: "synthetic-only",
    });
    s = await b.call("desktop", { type: "snapshot" });
    assert.equal(s.resources[0].taskStatus, "done");
    assert.equal(s.resources[0].id, id);
  } finally {
    await b.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
