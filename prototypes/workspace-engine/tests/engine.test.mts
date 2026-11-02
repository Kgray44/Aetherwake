import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { WorkspaceKernel } from '../../workspace-kernel/kernel.mts';
import { WorkspaceEngine } from '../engine.mts';
import type { Command, WorkspaceProjection } from '../contracts.mts';
import { defaults, hitTest, presentation, reachable, resizeFromHandle } from '../geometry.mts';
import { LayoutGesture, BlockMotionBridge, bindBlock } from '../interaction.mts';
import { MotionCoordinator } from '../../visual-experience/cinematic-v3/src/motion.ts';

const code = (wanted: string) => (e: any) => e.code === wanted;
let serial = 0;
function fixture(t: any, disk = false) {
  const dir = disk ? mkdtempSync(join(tmpdir(), 'aetherwake-engine-')) : null;
  const path = dir ? join(dir, 'synthetic.sqlite') : ':memory:';
  const kernel = WorkspaceKernel.open(path), engine = new WorkspaceEngine(kernel);
  t.after(() => { kernel.close(); if (dir) rmSync(dir, { recursive: true, force: true }); });
  return { kernel, engine, path, dir, state: engine.createWorkspace('Synthetic workspace') };
}
function run(e: WorkspaceEngine, s: WorkspaceProjection, action: object) {
  return e.execute({ commandId: `synthetic-${++serial}`, workspaceId: s.workspaceId, expectedRevision: s.revision, ...action } as Command);
}
function add(e: WorkspaceEngine, s: WorkspaceProjection, presentation?: object) {
  return run(e, s, { type: 'createBlock', resource: { kind: 'note', title: 'Synthetic note', content: 'Synthetic fixture text' }, presentation });
}
for (const count of [0, 1, 3, 10, 25, 50]) test(`${count} real persisted placements, no fixed block count`, t => {
  const { engine: e, kernel: k, state: initial, path } = fixture(t, true);
  let s = initial;
  for (let i = 0; i < count; i++) s = add(e, s, { x: i * 24, y: i * 32 });
  assert.equal(s.blocks.length, count);
  assert.equal(new Set(s.blocks.map(b => b.blockId)).size, count);
  assert.equal(k.searchResources().length, count);
  const reopened = WorkspaceKernel.open(path);
  try { assert.deepEqual(new WorkspaceEngine(reopened).project(s.workspaceId), s); } finally { reopened.close(); }
});

test('workspace selection/rename, shared resources and independent presentation survive reopening', t => {
  const { engine: e, kernel: k, state, path } = fixture(t, true);
  let a = add(e, state); const id = a.blocks[0].resourceId;
  let b = e.createWorkspace('Second');
  b = run(e, b, { type: 'attachResource', resourceId: id, templateId: 'research' });
  a = run(e, a, { type: 'duplicateBlock', blockId: a.blocks[0].blockId });
  const first = a.blocks[0].blockId;
  a = run(e, a, { type: 'saveLayout', placements: [{ blockId: first, expectedVersion: a.blocks[0].version, presentation: { width: 480, height: 320, shape: 'folio', rotation: 12 } }] });
  assert.equal(e.project(b.workspaceId).blocks[0].width, 320);
  assert.equal(a.blocks.find(x => x.blockId !== first)!.width, 320);
  assert.equal(k.searchResources().length, 1);
  k.updateNote(id, 'Synthetic draft survives', 1);
  e.renameWorkspace(b.workspaceId, 'Renamed', b.workspaceVersion); e.switchWorkspace(a.workspaceId);
  const reopened = WorkspaceKernel.open(path);
  try {
    const e2 = new WorkspaceEngine(reopened);
    assert.equal(e2.activeWorkspaceId(), a.workspaceId);
    assert.equal(e2.project(b.workspaceId).title, 'Renamed');
    assert.equal(reopened.getResource(id).note.content, 'Synthetic draft survives');
    assert.equal(e2.project(a.workspaceId).blocks.find(b => b.blockId === first)!.shape, 'folio');
  } finally { reopened.close(); }
});

test('detach/undo never deletes content; archive hides active discovery, restore recovers', t => {
  const { engine: e, kernel: k, state } = fixture(t);
  let s = add(e, state); const b = s.blocks[0];
  s = run(e, s, { type: 'detachBlock', blockId: b.blockId });
  assert.equal(s.blocks.length, 0); assert.ok(k.getResource(b.resourceId).note);
  s = run(e, s, { type: 'undoLayout' }); assert.equal(s.blocks[0].blockId, b.blockId);
  e.setResourceArchived(b.resourceId, true, 1);
  assert.equal(k.searchResources().length, 0);
  assert.equal(e.project(s.workspaceId).blocks[0].resourceState, 'archived');
  assert.throws(() => run(e, s, { type: 'attachResource', resourceId: b.resourceId }), code('RESOURCE_ARCHIVED'));
  assert.throws(() => e.deleteResource(b.resourceId, 2, 'approval'), code('DELETE_POLICY_REQUIRED'));
  const allowed = new WorkspaceEngine(k, { allowResourceDeletion: () => true });
  assert.throws(() => allowed.deleteResource(b.resourceId, 2, 'approval'), code('RECOVERY_REFERENCE'));
  const free = k.createNote('Synthetic unreferenced', 'Delete fixture'); k.setResourceArchived(free.id, true, 1);
  allowed.deleteResource(free.id, 2, 'explicit-synthetic-approval');
  assert.throws(() => k.getResource(free.id), code('NOT_FOUND'));
  e.setResourceArchived(b.resourceId, false, 2); assert.equal(k.searchResources().length, 1);
});

test('atomic geometry + shape, circular constraint, minimized and lock semantics', t => {
  const { engine: e, state } = fixture(t);
  let s = add(e, state), b = s.blocks[0];
  s = run(e, s, { type: 'setBlockShape', blockId: b.blockId, shape: 'circle' });
  assert.equal(s.blocks[0].height, s.blocks[0].width); assert.equal(s.blocks[0].contentMode, 'summary');
  s = run(e, s, { type: 'resizeBlock', blockId: b.blockId, width: 640, height: 200 });
  assert.equal(s.blocks[0].height, 640);
  s = run(e, s, { type: 'setBlockPresentation', blockId: b.blockId, patch: { shape: 'folio', width: 480, height: 360, minimized: true } });
  assert.equal(s.blocks[0].height, 360);
  s = run(e, s, { type: 'setBlockLock', blockId: b.blockId, locked: true });
  for (const action of [{ type: 'moveBlock', x: 800, y: 800 }, { type: 'resizeBlock', width: 800, height: 800 }, { type: 'detachBlock' }, { type: 'setBlockShape', shape: 'lens' }])
    assert.throws(() => run(e, s, { ...action, blockId: b.blockId }), code('LOCKED'));
  s = run(e, s, { type: 'setBlockLock', blockId: b.blockId, locked: false });
  s = run(e, s, { type: 'setBlockLayer', blockId: b.blockId, zIndex: 20 }); assert.equal(s.blocks[0].zIndex, 20);
});

test('undo/redo history persists; new action clears redo; checkpoints restore references', t => {
  const { engine: e, kernel: k, state, path } = fixture(t, true);
  let s = add(e, state), b = s.blocks[0];
  const cp = run(e, s, { type: 'checkpoint', name: 'Synthetic baseline' }); s = cp;
  s = run(e, s, { type: 'moveBlock', blockId: b.blockId, x: 777, y: 888 });
  const reopened = WorkspaceKernel.open(path);
  try {
    const e2 = new WorkspaceEngine(reopened);
    s = run(e2, s, { type: 'undoLayout' }); assert.equal(s.blocks[0].x, b.x);
    s = run(e2, s, { type: 'redoLayout' }); assert.equal(s.blocks[0].x, 777);
    s = run(e2, s, { type: 'restoreCheckpoint', checkpointId: cp.checkpointId }); assert.equal(s.blocks[0].x, b.x);
    s = run(e2, s, { type: 'undoLayout' }); assert.equal(s.blocks[0].x, 777);
    s = run(e2, s, { type: 'moveBlock', blockId: b.blockId, x: 90, y: 90 }); assert.equal(s.canRedo, false);
    assert.equal(k.getResource(b.resourceId).note.content, 'Synthetic fixture text');
  } finally { reopened.close(); }
});

test('invalid inputs, duplicate IDs, cross-workspace updates and stale writes roll back entirely', t => {
  const { engine: e, state, kernel: k } = fixture(t);
  let s = add(e, state); s = add(e, s); const [a, b] = s.blocks;
  for (const x of [NaN, Infinity, -Infinity, 1e12]) assert.throws(() => run(e, s, { type: 'moveBlock', blockId: a.blockId, x, y: 0 }), code('INVALID'));
  for (const width of [-1, 0, NaN]) assert.throws(() => run(e, s, { type: 'resizeBlock', blockId: a.blockId, width, height: 300 }), code('INVALID'));
  assert.throws(() => run(e, s, { type: 'setBlockShape', blockId: a.blockId, shape: 'unknown' }), code('INVALID'));
  const placement = { blockId: a.blockId, expectedVersion: a.version, presentation: { x: 909 } };
  assert.throws(() => run(e, s, { type: 'saveLayout', placements: [placement, placement] }), code('DUPLICATE_ID'));
  assert.throws(() => run(e, s, { type: 'saveLayout', placements: [placement, { blockId: b.blockId, expectedVersion: 999, presentation: { x: 1 } }] }), code('CONFLICT'));
  const other = add(e, e.createWorkspace('Other')).blocks[0];
  assert.throws(() => run(e, s, { type: 'saveLayout', placements: [{ blockId: other.blockId, expectedVersion: other.version, presentation: { x: 1 } }] }), code('NOT_FOUND'));
  assert.deepEqual(e.project(s.workspaceId), s);
  assert.throws(() => add(e, s, { shape: 'invalid' }), code('INVALID')); assert.equal(k.searchResources().length, 3);
  const changed = run(e, s, { type: 'moveBlock', blockId: a.blockId, x: 700, y: 700 });
  assert.throws(() => run(e, s, { type: 'moveBlock', blockId: a.blockId, x: 800, y: 800 }), code('CONFLICT'));
  assert.deepEqual(e.project(s.workspaceId), changed);
});

test('two SQLite connections reject concurrent revisions and idempotent replay cannot duplicate', t => {
  const { engine: e, state, path } = fixture(t, true);
  const other = WorkspaceKernel.open(path);
  try {
    const e2 = new WorkspaceEngine(other); const stale = e2.project(state.workspaceId);
    const command: Command = { type: 'createBlock', commandId: 'one-command', workspaceId: state.workspaceId, expectedRevision: state.revision, resource: { kind: 'conversation', title: 'Synthetic chat' } };
    const result = e.execute(command);
    assert.deepEqual(e2.execute(command), result);
    assert.throws(() => e2.execute({ ...command, resource: { kind: 'conversation', title: 'Changed' } }), code('COMMAND_ID_REUSED'));
    assert.throws(() => add(e2, stale), code('CONFLICT'));
    assert.equal(e2.project(state.workspaceId).blocks.length, 1);
  } finally { other.close(); }
});

test('undo rejects intervening legacy kernel writes and never overwrites them', t => {
  const { engine: e, kernel: k, state } = fixture(t); let s = add(e, state);
  const n = k.createNote('External synthetic', 'preserved'); k.attachBlock(s.workspaceId, n.id, { x: 0, y: 0, width: 200, height: 200, z: 0 });
  assert.throws(() => run(e, s, { type: 'undoLayout' }), code('HISTORY_DIVERGED'));
  assert.equal(e.project(s.workspaceId).blocks.length, 2);
});

test('migrate existing kernel and extension schema 1 without changing content or geometry', t => {
  const { engine: e, state, kernel: k, path } = fixture(t, true);
  let s = add(e, state); const b = s.blocks[0];
  // Separate fixture starts at the real published v1 extension schema.
  const oldPath = join(String(path).replace(/[^\\/]+$/, ''), 'v1.sqlite');
  const old = WorkspaceKernel.open(oldPath); const w = old.createWorkspace('Legacy'), n = old.createNote('Legacy synthetic', 'kept');
  const placed = old.attachBlock(w.id, n.id, { x: -20, y: 7, width: 80, height: 80, z: 9 });
  old.withTransaction(db => {
    db.exec(readFileSync(new URL('../migrations/001-presentation.sql', import.meta.url), 'utf8'));
    db.prepare('INSERT INTO block_presentations VALUES(?,?)').run(placed.id, JSON.stringify({ shape: 'folio' }));
    db.prepare('INSERT INTO workspace_engine_layouts VALUES(?,?)').run('legacy-layout', w.id);
  }); old.close();
  const reopened = WorkspaceKernel.open(oldPath);
  try {
    const migrated = new WorkspaceEngine(reopened), projected = migrated.project(w.id);
    assert.equal(projected.layoutId, 'legacy-layout'); assert.equal(projected.blocks[0].width, 80);
    assert.equal(projected.blocks[0].shape, 'folio'); assert.equal(reopened.getResource(n.id).note.content, 'kept');
    assert.equal(projected.canUndo, false);
  } finally { reopened.close(); }
  k.withTransaction(db => db.exec('UPDATE workspace_engine_schema SET version=999'));
  assert.throws(() => new WorkspaceEngine(k), code('UNSUPPORTED_SCHEMA'));
});

test('interrupted process save rolls back geometry, history and events after SQLite hot-journal recovery', t => {
  const { engine: e, kernel: k, state, path } = fixture(t, true); const s = add(e, state);
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { WorkspaceKernel } from ${JSON.stringify(new URL('../../workspace-kernel/kernel.mts', import.meta.url).href)};
    import { WorkspaceEngine } from ${JSON.stringify(new URL('../engine.mts', import.meta.url).href)};
    const k=WorkspaceKernel.open(process.argv[1]);const e=new WorkspaceEngine(k);
    k.withTransaction(()=>{e.execute({type:'moveBlock',commandId:'interrupted',workspaceId:process.argv[2],expectedRevision:Number(process.argv[3]),blockId:process.argv[4],x:999,y:999});process.exit(37)});
  `, path, s.workspaceId, String(s.revision), s.blocks[0].blockId], { encoding: 'utf8' });
  assert.equal(child.status, 37, child.stderr);
  const recovered = WorkspaceKernel.open(path);
  try {
    assert.deepEqual(new WorkspaceEngine(recovered).project(s.workspaceId), s);
    recovered.assertIntegrity();
    assert.ok(!k.listEvents('workspace', s.workspaceId).some(e => e.correlation_id === 'interrupted'));
  } finally { recovered.close(); }
});

test('viewport resize projection preserves manual canonical coordinates and resource identity', t => {
  const { engine: e, state } = fixture(t); const s = add(e, state, { x: 2500, y: 1800 });
  const b = s.blocks[0], projected = reachable(b, 500, 300);
  assert.ok(projected.x < 500 && projected.y < 300);
  assert.ok(projected.x + projected.width <= 500 && projected.y + projected.height <= 300);
  assert.equal(projected.resourceId, b.resourceId);
  assert.equal(e.project(s.workspaceId).blocks[0].x, 2500);
});

test('pointer gesture coalesces preview into one save, supports zoom, snapping, aspect and bounds', t => {
  const { engine: e, state } = fixture(t); let s = add(e, state);
  s = run(e, s, { type: 'saveLayout', placements: [], viewport: { x: 0, y: 0, zoom: 2 } });
  const b = s.blocks[0], gesture = new LayoutGesture(s, b.blockId, 'se');
  for (let i = 0; i < 50; i++) gesture.update(i * 4, i * 4, 16);
  assert.equal(e.project(s.workspaceId).revision, s.revision);
  const resized = e.execute(gesture.command('synthetic-gesture'));
  assert.equal(resized.revision, s.revision + 1);
  assert.ok(resized.blocks[0].width > b.width);
  const undone = run(e, resized, { type: 'undoLayout' }); assert.equal(undone.blocks[0].width, b.width);
  const constrained = resizeFromHandle(defaults, 'nw', 10000, 10000, 4 / 3);
  assert.ok(constrained.width >= 128 && constrained.height >= 96);
  assert.equal(constrained.x + constrained.width, defaults.x + defaults.width);
  assert.ok(Math.abs(constrained.width / constrained.height - 4 / 3) < 1e-9);
  const circle = presentation({ shape: 'circle' });
  assert.equal(hitTest(circle, circle.x, circle.y), false);
  assert.equal(hitTest(circle, circle.x + circle.width / 2, circle.y + circle.height / 2), true);
});

test('Motion Coordinator keys each placement independently and unfolds compact shapes without mutation', t => {
  const { engine: e, state } = fixture(t); let s = add(e, state, { shape: 'circle' }); s = run(e, s, { type: 'duplicateBlock', blockId: s.blocks[0].blockId });
  const m = new MotionCoordinator(), bridge = new BlockMotionBridge(m); bridge.sync(s.blocks);
  assert.equal(m.bodies.size, 2); m.reduced = true; bridge.unfold(s.blocks[0], 1000, 800);
  assert.equal(m.pose(s.blocks[0].blockId).w, 720); assert.equal(e.project(s.workspaceId).blocks[0].width, 320);
  bridge.sync([s.blocks[1]]); assert.equal(m.bodies.size, 1); bridge.dispose(); assert.equal(m.bodies.size, 0);
});

test('presets act on real blocks, keep locked placements and allow subsequent customization', t => {
  const { engine: e, state } = fixture(t); let s = state; for (let i = 0; i < 10; i++) s = add(e, s);
  const id = s.blocks[0].blockId; s = run(e, s, { type: 'setBlockLock', blockId: id, locked: true });
  const before = s.blocks.find(b => b.blockId === id)!;
  for (const preset of ['freeform', 'columns', 'focus', 'research', 'development']) {
    s = run(e, s, { type: 'applyPreset', preset, width: 1400, height: 900 });
    assert.equal(s.blocks.find(b => b.blockId === id)!.x, before.x);
  }
  const movable = s.blocks.find(b => b.blockId !== id)!;
  s = run(e, s, { type: 'moveBlock', blockId: movable.blockId, x: 117, y: 119, snap: 16 });
  assert.equal(s.blocks.find(b => b.blockId === movable.blockId)!.x, 112);
});

test('failed extension migration is atomic and retains the previous schema for recovery', t => {
  const { kernel: k } = fixture(t);
  k.withTransaction(db => {
    db.exec(`DROP TABLE workspace_engine_v2_recovery_archive;
      ALTER TABLE workspace_engine_layouts DROP COLUMN presence_json;
      ALTER TABLE workspace_engine_layouts DROP COLUMN legacy_presence_json;
      DROP TABLE workspace_engine_receipts; DROP TABLE workspace_engine_checkpoints;
      DROP TABLE workspace_engine_session; ALTER TABLE workspace_engine_layouts DROP COLUMN history_json;
      UPDATE workspace_engine_schema SET version=1;
      CREATE TRIGGER reject_fixture_upgrade BEFORE UPDATE ON workspace_engine_schema
      BEGIN SELECT RAISE(ABORT,'Synthetic migration interruption'); END;`);
  });
  assert.throws(() => new WorkspaceEngine(k), /Synthetic migration interruption/);
  k.withTransaction(db => {
    assert.equal(db.prepare('SELECT version FROM workspace_engine_schema').get()!.version, 1);
    assert.equal(db.prepare("SELECT count(*) AS n FROM pragma_table_info('workspace_engine_layouts') WHERE name='history_json'").get()!.n, 0);
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='workspace_engine_receipts'").get()!.n, 0);
    db.exec('DROP TRIGGER reject_fixture_upgrade');
  });
  assert.ok(new WorkspaceEngine(k).listWorkspaces().length);
});

test('DOM binding cancels safely, suppresses selection only during drag and skips no-op clicks', async t => {
  const { engine: e, state } = fixture(t); let s = add(e, state); const id = s.blocks[0].blockId;
  const doc = Object.assign(new EventTarget(), { documentElement: { style: { userSelect: 'text' } } });
  class Target extends EventTarget {
    style = { touchAction: '' }; ownerDocument = doc; captured = new Set<number>();
    setPointerCapture(id: number) { this.captured.add(id); }
    hasPointerCapture(id: number) { return this.captured.has(id); }
    releasePointerCapture(id: number) { this.captured.delete(id); this.dispatchEvent(new Event('lostpointercapture')); }
  }
  const element = new Target(), grip = new Target(), handle = new Target();
  const m = new MotionCoordinator(), bridge = new BlockMotionBridge(m); bridge.sync(s.blocks);
  let commits = 0;
  const dispose = bindBlock({ element: element as any, grip: grip as any, handles: { se: handle as any }, blockId: id,
    state: () => s, port: { project: async wid => e.project(wid), execute: async c => { commits++; return e.execute(c); } }, motion: bridge,
    changed: next => { s = next; }, failed: error => { throw error; } });
  const fire = (target: Target | typeof doc, type: string, extra: object = {}) => target.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { button: 0, pointerId: 1, clientX: 0, clientY: 0, shiftKey: false, ...extra }));
  fire(grip, 'pointerdown'); assert.equal(doc.documentElement.style.userSelect, 'none');
  fire(grip, 'pointerup'); assert.equal(commits, 0); assert.equal(doc.documentElement.style.userSelect, 'text');
  fire(handle, 'pointerdown'); fire(handle, 'pointermove', { clientX: 100, clientY: 80 });
  fire(doc, 'keydown', { key: 'Escape' }); assert.equal(commits, 0); assert.equal(doc.documentElement.style.userSelect, 'text');
  fire(handle, 'pointerdown'); fire(handle, 'pointermove', { clientX: 100, clientY: 80 }); fire(handle, 'pointercancel'); assert.equal(commits, 0);
  fire(handle, 'pointerdown'); fire(handle, 'pointermove', { clientX: 100, clientY: 80 }); fire(handle, 'pointerup');
  await new Promise(resolve => setImmediate(resolve)); assert.equal(commits, 1); assert.equal(s.blocks[0].width, 420);
  dispose(); assert.equal(grip.style.touchAction, ''); fire(grip, 'pointerdown'); assert.equal(doc.documentElement.style.userSelect, 'text');
});
