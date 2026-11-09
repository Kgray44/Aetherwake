import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { WorkspaceKernel } from "../../workspace-kernel/kernel.mts";
import { WorkspaceEngine } from "../engine.mts";
import type { Command, WorkspaceProjection } from "../contracts.mts";

function disk(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "aerynth-subject-test-")),
    path = join(dir, "synthetic.sqlite");
  t.after(() => {
    const target = resolve(dir);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.ok(basename(target).startsWith("aerynth-subject-test-"));
    rmSync(target, { recursive: true, force: true });
  });
  return path;
}
function run(
  engine: WorkspaceEngine,
  state: WorkspaceProjection,
  action: Record<string, unknown>,
) {
  return engine.execute({
    ...action,
    workspaceId: state.workspaceId,
    expectedRevision: state.revision,
    commandId: randomUUID(),
  } as Command);
}
const oldBlocks = `CREATE TABLE blocks_old_shape(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE RESTRICT,x REAL NOT NULL DEFAULT 0,y REAL NOT NULL DEFAULT 0,width REAL NOT NULL DEFAULT 320 CHECK(width>0),height REAL NOT NULL DEFAULT 240 CHECK(height>0),z INTEGER NOT NULL DEFAULT 0,version INTEGER NOT NULL DEFAULT 1);
INSERT INTO blocks_old_shape SELECT id,workspace_id,resource_id,x,y,width,height,z,version FROM blocks;DROP TABLE blocks;ALTER TABLE blocks_old_shape RENAME TO blocks;CREATE INDEX blocks_by_resource ON blocks(resource_id);DROP TABLE block_subject_refs;UPDATE app_schema_version SET version=2;`;
function legacy(t: any) {
  const path = disk(t),
    kernel = WorkspaceKernel.open(path),
    engine = new WorkspaceEngine(kernel),
    note = kernel.createNote("Synthetic legacy note", "Synthetic legacy text");
  let state = engine.createWorkspace("Synthetic legacy workspace", null, {
    mode: "freeform",
  });
  state = run(engine, state, {
    type: "attachResource",
    resourceId: note.id,
    presentation: { shape: "folio", x: 43, y: 71, width: 390, height: 270 },
  });
  const blockId = state.blocks[0].blockId;
  const checkpoint = run(engine, state, {
    type: "checkpoint",
    name: "Synthetic retained checkpoint",
  }).checkpointId!;
  const db = kernel.withTransaction((db) => db);
  db.exec(
    "CREATE TABLE synthetic_extension(block_id TEXT PRIMARY KEY REFERENCES blocks(id) ON DELETE CASCADE,payload TEXT NOT NULL);",
  );
  db.prepare("INSERT INTO synthetic_extension VALUES(?,?)").run(
    blockId,
    "Synthetic extension evidence",
  );
  const preserved = {
    presentation: db.prepare("SELECT * FROM block_presentations").all(),
    layouts: db.prepare("SELECT * FROM workspace_engine_layouts").all(),
    checkpoints: db.prepare("SELECT * FROM workspace_engine_checkpoints").all(),
    receipts: db.prepare("SELECT * FROM workspace_engine_receipts").all(),
  };
  kernel.close();
  const raw = new DatabaseSync(path);
  raw.exec("PRAGMA foreign_keys=OFF;BEGIN IMMEDIATE;" + oldBlocks + "COMMIT;");
  raw.close();
  return {
    path,
    noteId: note.id,
    workspaceId: state.workspaceId,
    blockId,
    checkpoint,
    preserved,
  };
}

test("subject migration preserves every legacy placement, extension FK row, history, checkpoint and receipt", (t) => {
  const f = legacy(t),
    kernel = WorkspaceKernel.open(f.path);
  try {
    assert.equal(kernel.schemaVersion(), 3);
    const db = kernel.withTransaction((db) => db);
    assert.equal(
      db
        .prepare("SELECT payload FROM synthetic_extension WHERE block_id=?")
        .get(f.blockId)?.payload,
      "Synthetic extension evidence",
    );
    assert.deepEqual(
      db.prepare("SELECT * FROM block_presentations").all(),
      f.preserved.presentation,
    );
    assert.deepEqual(
      db.prepare("SELECT * FROM workspace_engine_layouts").all(),
      f.preserved.layouts,
    );
    assert.deepEqual(
      db.prepare("SELECT * FROM workspace_engine_checkpoints").all(),
      f.preserved.checkpoints,
    );
    assert.deepEqual(
      db.prepare("SELECT * FROM workspace_engine_receipts").all(),
      f.preserved.receipts,
    );
    assert.equal(
      db.prepare("PRAGMA foreign_key_list(block_presentations)").all()[0].table,
      "blocks",
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    const engine = new WorkspaceEngine(kernel);
    let state = engine.project(f.workspaceId);
    assert.equal(state.blocks[0].resourceId, f.noteId);
    assert.deepEqual(state.blocks[0].subject, {
      kind: "resource",
      resourceId: f.noteId,
    });
    state = run(engine, state, { type: "detachBlock", blockId: f.blockId });
    state = run(engine, state, { type: "undoLayout" });
    assert.equal(state.blocks[0].resourceId, f.noteId);
    assert.equal(
      kernel.getResource(f.noteId).note.content,
      "Synthetic legacy text",
    );
    state = run(engine, state, {
      type: "restoreCheckpoint",
      checkpointId: f.checkpoint,
    });
    assert.equal(state.blocks[0].blockId, f.blockId);
    assert.equal(state.blocks[0].x, 43);
    kernel.assertIntegrity();
  } finally {
    kernel.close();
  }
});

test("failed block rebuild rolls back schema and preserves metadata instead of cascading extension deletion", (t) => {
  const f = legacy(t),
    raw = new DatabaseSync(f.path);
  raw.exec("PRAGMA foreign_keys=OFF");
  raw
    .prepare("INSERT INTO synthetic_extension VALUES(?,?)")
    .run("synthetic-orphan", "Synthetic preexisting invalid extension");
  raw.close();
  assert.throws(
    () => WorkspaceKernel.open(f.path),
    /foreign-key validation failed/,
  );
  const inspect = new DatabaseSync(f.path);
  try {
    assert.equal(
      inspect.prepare("SELECT version FROM app_schema_version").get()?.version,
      2,
    );
    assert.equal(
      inspect
        .prepare(
          "SELECT count(*) AS n FROM sqlite_master WHERE name='block_subject_refs'",
        )
        .get()?.n,
      0,
    );
    assert.equal(
      inspect
        .prepare("SELECT payload FROM synthetic_extension WHERE block_id=?")
        .get(f.blockId)?.payload,
      "Synthetic extension evidence",
    );
    assert.equal(
      inspect
        .prepare("SELECT resource_id FROM blocks WHERE id=?")
        .get(f.blockId)?.resource_id,
      f.noteId,
    );
    assert.deepEqual(
      inspect.prepare("SELECT * FROM block_presentations").all(),
      f.preserved.presentation,
    );
  } finally {
    inspect.close();
  }
});

test("interrupted destructive migration recovers its hot journal before reopening and completes without lost extension rows", (t) => {
  const f = legacy(t),
    script = readFileSync(
      new URL(
        "../../workspace-kernel/migrations/003-block-subjects.sql",
        import.meta.url,
      ),
      "utf8",
    ).split("ALTER TABLE blocks_subject_upgrade")[0];
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(${JSON.stringify(f.path)});db.exec('PRAGMA foreign_keys=OFF;PRAGMA journal_mode=DELETE;PRAGMA synchronous=FULL;BEGIN IMMEDIATE;');db.exec(${JSON.stringify(script)});process.exit(73);`,
    ],
    { encoding: "utf8", windowsHide: true },
  );
  assert.equal(child.status, 73, child.stderr);
  assert.equal(existsSync(f.path + "-journal"), true);
  const kernel = WorkspaceKernel.open(f.path);
  try {
    const db = kernel.withTransaction((db) => db);
    assert.equal(kernel.schemaVersion(), 3);
    assert.equal(
      db
        .prepare("SELECT payload FROM synthetic_extension WHERE block_id=?")
        .get(f.blockId)?.payload,
      "Synthetic extension evidence",
    );
    assert.deepEqual(
      db.prepare("SELECT * FROM block_presentations").all(),
      f.preserved.presentation,
    );
    assert.equal(
      kernel.getResource(f.noteId).note.content,
      "Synthetic legacy text",
    );
    assert.equal(
      new WorkspaceEngine(kernel).project(f.workspaceId).blocks[0].blockId,
      f.blockId,
    );
    kernel.assertIntegrity();
  } finally {
    kernel.close();
  }
});

test("project, collection and resource-query placements retain distinct identities through duplicate, detach, undo, checkpoint and restart", (t) => {
  const path = disk(t);
  let kernel = WorkspaceKernel.open(path),
    engine = new WorkspaceEngine(kernel, {
      allowSubjectAttachment: () => true,
    });
  const project = kernel.createProject("Synthetic subject project"),
    collection = kernel.createCollection(
      "Synthetic canonical collection",
      project.id,
    );
  let state = engine.createWorkspace(
    "Synthetic subject workspace",
    project.id,
    { mode: "freeform" },
  );
  const workspaceId = state.workspaceId;
  try {
    for (const subject of [
      { kind: "project", projectId: project.id },
      { kind: "collection", collectionId: collection.id },
      {
        kind: "resource-query",
        projectId: project.id,
        query: "review",
        kinds: ["note"],
        collectionId: collection.id,
      },
    ] as const)
      state = run(engine, state, { type: "attachSubject", subject });
    assert.equal(kernel.searchResources().length, 0);
    assert.equal(
      state.blocks.every((b) => b.resourceId === undefined),
      true,
    );
    assert.deepEqual(
      new Set(state.blocks.map((b) => b.subject?.kind)),
      new Set(["project", "collection", "resource-query"]),
    );
    const original = state.blocks.find((b) => b.subject?.kind === "project")!;
    const checkpointResult = run(engine, state, {
        type: "checkpoint",
        name: "Synthetic subject checkpoint",
      }),
      checkpoint = checkpointResult.checkpointId!;
    state = checkpointResult;
    state = run(engine, state, {
      type: "duplicateBlock",
      blockId: original.blockId,
    });
    assert.equal(
      state.blocks.filter((b) => b.subject?.kind === "project").length,
      2,
    );
    assert.equal(kernel.searchResources().length, 0);
    state = run(engine, state, {
      type: "detachBlock",
      blockId: original.blockId,
    });
    state = run(engine, state, { type: "undoLayout" });
    assert.deepEqual(
      state.blocks.find((b) => b.blockId === original.blockId)?.subject,
      { kind: "project", projectId: project.id },
    );
    state = run(engine, state, {
      type: "restoreCheckpoint",
      checkpointId: checkpoint,
    });
    assert.equal(state.blocks.length, 3);
    const before = state.blocks.map((b) => ({
      id: b.blockId,
      subject: b.subject,
      x: b.x,
      y: b.y,
      shape: b.shape,
    }));
    kernel.close();
    kernel = WorkspaceKernel.open(path);
    engine = new WorkspaceEngine(kernel, {
      allowSubjectAttachment: () => true,
    });
    state = engine.project(workspaceId);
    assert.deepEqual(
      state.blocks.map((b) => ({
        id: b.blockId,
        subject: b.subject,
        x: b.x,
        y: b.y,
        shape: b.shape,
      })),
      before,
    );
    assert.equal(state.presence.id, "system:vela");
    assert.equal(kernel.searchResources().length, 0);
    kernel.assertIntegrity();
  } finally {
    kernel.close();
  }
});

test("new subject attachment fails closed, malformed IDs do not mutate and archived subjects remain recoverable", (t) => {
  const kernel = WorkspaceKernel.open(":memory:");
  try {
    const project = kernel.createProject("Synthetic permission project"),
      blocked = new WorkspaceEngine(kernel),
      workspace = blocked.createWorkspace("Synthetic subject policy"),
      engine = new WorkspaceEngine(kernel, {
        allowSubjectAttachment: () => true,
      });
    assert.throws(
      () =>
        run(blocked, workspace, {
          type: "attachSubject",
          subject: { kind: "project", projectId: project.id },
        }),
      /SUBJECT_POLICY_REQUIRED/,
    );
    assert.equal(engine.project(workspace.workspaceId).blocks.length, 0);
    assert.throws(
      () =>
        run(engine, workspace, {
          type: "attachSubject",
          subject: {
            kind: "project",
            projectId: project.id,
            resourceId: "synthetic-impersonation",
          },
        }),
      /invalid_block_subject/,
    );
    let state = run(engine, workspace, {
      type: "attachSubject",
      subject: { kind: "project", projectId: project.id },
    });
    kernel.setProjectArchived(project.id, true, 1);
    assert.equal(
      engine.project(workspace.workspaceId).blocks[0].subjectState,
      "archived",
    );
    assert.throws(
      () =>
        run(engine, state, {
          type: "attachSubject",
          subject: { kind: "project", projectId: project.id },
        }),
      /Subject is unavailable/,
    );
    state = run(engine, state, {
      type: "detachBlock",
      blockId: state.blocks[0].blockId,
    });
    state = run(engine, state, { type: "undoLayout" });
    assert.equal(state.blocks[0].subjectState, "archived");
    assert.equal(kernel.searchResources().length, 0);
    kernel.assertIntegrity();
  } finally {
    kernel.close();
  }
});
