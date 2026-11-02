import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { WorkspaceKernel } from '../../workspace-kernel/kernel.mts';
import { WorkspaceEngine, defaultPresence } from '../engine.mts';
import { footprint, intersects, resolveCollisions, collisionGap } from '../collisions.mts';
import { PresenceGesture } from '../interaction.mts';
import { defaults } from '../geometry.mts';
import type { Command, WorkspaceProjection, Geometry } from '../contracts.mts';

let serial = 0;
const code = (value: string) => (e: any) => e.code === value;
const bounds: Geometry = { x: 20, y: 170, width: 1240, height: 600 };
function fixture(t: any, disk = false) {
  const dir = disk ? mkdtempSync(join(tmpdir(), 'aetherwake-presence-')) : null;
  const path = dir ? join(dir, 'synthetic.sqlite') : ':memory:';
  const kernel = WorkspaceKernel.open(path), engine = new WorkspaceEngine(kernel);
  t.after(() => { kernel.close(); if (dir) rmSync(dir, { recursive: true, force: true }); });
  return { kernel, engine, path, state: engine.createWorkspace('Synthetic presence workspace') };
}
function run(e: WorkspaceEngine, s: WorkspaceProjection, action: object, area?: Geometry) {
  return e.execute({ commandId: `presence-fixture-${++serial}`, workspaceId: s.workspaceId, expectedRevision: s.revision, ...action, ...(area ? { bounds: area } : {}) } as Command);
}
function disjoint(s: WorkspaceProjection) {
  const items = [...s.blocks.map(b => ({ ...b, id: b.blockId })), s.presence];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++)
    assert.equal(intersects(footprint(items[i]), footprint(items[j])), false, `${items[i].id} overlaps ${items[j].id}`);
}
const geometry = (p: Geometry) => ({ x: p.x, y: p.y, width: p.width, height: p.height });

for (const count of [0, 1, 10, 25, 50]) test(`presence + ${count} blocks: collisions resolve, identity and restart survive`, t => {
  const { engine: e, kernel: k, path, state } = fixture(t, true); let s = state;
  for (let i = 0; i < count; i++) s = run(e, s, { type: 'createBlock', resource: { kind: 'note', title: `Synthetic ${i}`, content: 'Fixture content' }, presentation: { x: 480, y: 170, width: 240, height: 180 } }, bounds);
  s = run(e, s, { type: 'resolveLayout' }, bounds); disjoint(s);
  assert.equal(s.blocks.length, count); assert.equal(k.searchResources().length, count);
  assert.equal(s.presence.id, 'system:vela'); assert.equal(s.presence.kind, 'vela'); assert.equal(s.presence.scale, .65);
  assert.equal(s.presence.width, 208); assert.equal(s.presence.height, 260);
  assert.ok(s.presence.x >= bounds.x && s.presence.y >= bounds.y);
  assert.ok(s.presence.x + s.presence.width <= bounds.x + bounds.width);
  assert.ok(s.presence.y + s.presence.height <= bounds.y + bounds.height);
  if (count === 50) assert.ok(s.blocks.some(b => b.x < bounds.x || b.y < bounds.y || b.x + b.width > bounds.x + bounds.width || b.y + b.height > bounds.y + bounds.height));
  const other = WorkspaceKernel.open(path);
  try { assert.deepEqual(new WorkspaceEngine(other).project(s.workspaceId), s); } finally { other.close(); }
});

test('dragging Vela rearranges cards in one undo/redo transaction without changing canonical content', t => {
  const { engine: e, kernel: k, state } = fixture(t); let s = state;
  for (let i = 0; i < 3; i++) s = run(e, s, { type: 'createBlock', resource: { kind: 'note', title: `Synthetic ${i}`, content: 'Synthetic draft remains' }, presentation: { x: 32 + i * 360, y: 400, width: 320, height: 240 } });
  const before = s, target = s.blocks[0];
  const resourceIds = s.blocks.map(b => b.resourceId).sort(), presence = s.presence;
  s = run(e, s, { type: 'setPresence', expectedVersion: presence.version, presentation: { x: target.x, y: target.y } });
  disjoint(s); assert.equal(s.revision, before.revision + 1);
  assert.ok(s.blocks.some(b => geometry(b).x !== geometry(before.blocks.find(old => old.blockId === b.blockId)!).x || geometry(b).y !== geometry(before.blocks.find(old => old.blockId === b.blockId)!).y));
  assert.deepEqual(s.blocks.map(b => b.resourceId).sort(), resourceIds);
  for (const id of resourceIds) {
    assert.ok(typeof id === 'string', 'This fixture creates canonical Note resources');
    assert.equal(k.getResource(id).note.content, 'Synthetic draft remains');
  }
  s = run(e, s, { type: 'undoLayout' });
  assert.deepEqual(s.blocks.map(geometry), before.blocks.map(geometry)); assert.deepEqual(geometry(s.presence), geometry(before.presence));
  s = run(e, s, { type: 'redoLayout' }); disjoint(s);
  assert.deepEqual(geometry(s.presence), { ...geometry(presence), x: target.x, y: target.y });
});

test('committed card drop and enlargement cannot cover Vela; fixed anchors stay fixed', t => {
  const { engine: e, state } = fixture(t);
  let s = run(e, state, { type: 'createBlock', resource: { kind: 'note', title: 'Synthetic', content: 'Fixture' } }, bounds);
  const id = s.blocks[0].blockId;
  s = run(e, s, { type: 'setPresence', expectedVersion: s.presence.version, presentation: { locked: true } }, bounds);
  const fixed = geometry(s.presence);
  s = run(e, s, { type: 'moveBlock', blockId: id, x: fixed.x, y: fixed.y }, bounds);
  disjoint(s); assert.deepEqual(geometry(s.presence), fixed);
  s = run(e, s, { type: 'resizeBlock', blockId: id, width: 1200, height: 700 }, bounds);
  disjoint(s); assert.deepEqual(geometry(s.presence), fixed); assert.equal(s.blocks[0].width, 1200);
});

test('ordinary noncolliding manual positions and independent workspace presence remain stable', t => {
  const { engine: e, state } = fixture(t); let a = state;
  a = run(e, a, { type: 'createBlock', resource: { kind: 'note', title: 'Offscreen synthetic', content: 'kept' }, presentation: { x: 6000, y: 5000 } });
  let b = e.createWorkspace('Other');
  a = run(e, a, { type: 'setPresence', expectedVersion: a.presence.version, presentation: { x: 40, y: 200 } }, bounds);
  assert.deepEqual(e.project(b.workspaceId).presence, b.presence);
  assert.equal(a.blocks[0].x, 6000); assert.equal(a.blocks[0].y, 5000);
  assert.deepEqual(e.switchWorkspace(a.workspaceId), a);
  b = run(e, b, { type: 'setPresence', expectedVersion: b.presence.version, presentation: { x: 800, y: 250 } });
  assert.equal(e.project(a.workspaceId).presence.x, 40);
});

test('repeated resolveLayout is a no-op: revision, versions, history, redo and action events do not grow', t => {
  const { engine: e, state, kernel: k } = fixture(t);
  let s = run(e, state, { type: 'resolveLayout' }, bounds);
  const events = k.listEvents('workspace', s.workspaceId).length;
  for (let i = 0; i < 5; i++) assert.deepEqual(run(e, s, { type: 'resolveLayout' }, bounds), s);
  assert.equal(k.listEvents('workspace', s.workspaceId).length, events);
  s = run(e, s, { type: 'undoLayout' });
  const redone = run(e, s, { type: 'redoLayout' }); assert.ok(redone.presence.version > s.presence.version);
  s = run(e, redone, { type: 'setPresence', expectedVersion: redone.presence.version, presentation: { x: redone.presence.x + 16 } }, bounds);
  s = run(e, s, { type: 'undoLayout' }); assert.equal(s.canRedo, true);
  assert.deepEqual(run(e, s, { type: 'resolveLayout' }, bounds), s);
});

test('presence gesture previews use viewport zoom and commit one versioned native command', t => {
  const { engine: e, state } = fixture(t);
  let s = run(e, state, { type: 'saveLayout', placements: [], viewport: { x: 10, y: 20, zoom: 2 } });
  const before = s, gesture = new PresenceGesture(s, 'move');
  gesture.update(120, 80, 8); assert.deepEqual(e.project(s.workspaceId), before);
  s = e.execute(gesture.command('synthetic-presence-gesture'));
  assert.equal(s.presence.x, before.presence.x + 64); assert.equal(s.presence.y, before.presence.y + 40);
  assert.equal(s.revision, before.revision + 1);
});

test('invalid presence/bounds and stale presence versions cannot partially rearrange', t => {
  const { engine: e, state } = fixture(t);
  for (const patch of [{ x: NaN }, { width: 0 }, { height: 5000 }, { scale: 1 }, { id: 'fake' }])
    assert.throws(() => run(e, state, { type: 'setPresence', expectedVersion: 1, presentation: patch }), code('INVALID'));
  assert.throws(() => run(e, state, { type: 'resolveLayout' }, { x: 0, y: 0, width: -1, height: 100 }), code('INVALID'));
  assert.throws(() => run(e, state, { type: 'setPresence', expectedVersion: 999, presentation: { x: 1 } }), code('CONFLICT'));
  assert.deepEqual(e.project(state.workspaceId), state);
});

test('presence retries are idempotent across SQLite connections and stale windows cannot overwrite them', t => {
  const { engine: e, state, path } = fixture(t, true), other = WorkspaceKernel.open(path);
  try {
    const second = new WorkspaceEngine(other), stale = second.project(state.workspaceId);
    const command: Command = { type: 'setPresence', commandId: 'presence-idempotent', workspaceId: state.workspaceId,
      expectedRevision: state.revision, expectedVersion: state.presence.version, presentation: { x: 100, y: 250 } };
    const result = e.execute(command); assert.deepEqual(second.execute(command), result);
    assert.throws(() => run(second, stale, { type: 'setPresence', expectedVersion: stale.presence.version, presentation: { x: 500 } }), code('CONFLICT'));
    assert.deepEqual(second.project(state.workspaceId), result);
  } finally { other.close(); }
});

test('failed schema3 migration rolls back presence columns and archive while retaining prior recovery JSON', t => {
  const { engine: e, kernel: k, state } = fixture(t);
  const s = run(e, state, { type: 'createBlock', resource: { kind: 'note', title: 'Synthetic retained', content: 'kept' } });
  let raw = '';
  k.withTransaction(db => {
    raw = String(db.prepare('SELECT history_json FROM workspace_engine_layouts').get()!.history_json);
    db.exec(`DROP TABLE workspace_engine_v3_recovery_archive;
      ALTER TABLE workspace_engine_layouts DROP COLUMN organization_json;
      ALTER TABLE workspace_engine_layouts DROP COLUMN legacy_organization_json;
      DROP TABLE workspace_engine_v2_recovery_archive;
      ALTER TABLE workspace_engine_layouts DROP COLUMN presence_json;
      ALTER TABLE workspace_engine_layouts DROP COLUMN legacy_presence_json;
      UPDATE workspace_engine_schema SET version=2;
      CREATE TRIGGER fail_presence_migration BEFORE UPDATE ON workspace_engine_schema
      WHEN NEW.version=3 BEGIN SELECT RAISE(ABORT,'Synthetic presence migration failure'); END;`);
  });
  assert.throws(() => new WorkspaceEngine(k), /Synthetic presence migration failure/);
  k.withTransaction(db => {
    assert.equal(db.prepare('SELECT version FROM workspace_engine_schema').get()!.version, 2);
    assert.equal(db.prepare("SELECT count(*) AS n FROM pragma_table_info('workspace_engine_layouts') WHERE name='presence_json'").get()!.n, 0);
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='workspace_engine_v2_recovery_archive'").get()!.n, 0);
    assert.equal(db.prepare('SELECT history_json FROM workspace_engine_layouts').get()!.history_json, raw);
    db.exec('DROP TRIGGER fail_presence_migration');
  });
  const recovered = new WorkspaceEngine(k).project(s.workspaceId); assert.equal(recovered.blocks[0].resourceId, s.blocks[0].resourceId);
  const resourceId = recovered.blocks[0].resourceId; assert.ok(typeof resourceId === 'string', 'Recovered fixture placement retains its Note resource');
  assert.equal(k.getResource(resourceId).note.content, 'kept');
});

test('resolver is deterministic under reversed input, respects rotations and finds a nearest vacant slot', () => {
  const items = [
    { id: 'a', x: 100, y: 100, width: 200, height: 100, rotation: 45, locked: false },
    { id: 'b', x: 100, y: 100, width: 200, height: 100, rotation: -35, locked: false },
    { id: 'c', x: 900, y: 700, width: 100, height: 100, rotation: 0, locked: false },
  ];
  const a = resolveCollisions(items, ['a']), b = resolveCollisions(items.toReversed(), ['a']);
  assert.deepEqual(a.toSorted((a, b) => a.id.localeCompare(b.id)), b.toSorted((a, b) => a.id.localeCompare(b.id)));
  assert.equal(intersects(footprint(a[0]), footprint(a[1])), false);
  assert.deepEqual(a[2], items[2]);
  const adjacent = resolveCollisions([{ ...items[0], rotation: 0 }, { ...items[0], id: 'b', rotation: 0 }], ['a']);
  assert.equal(Math.hypot(adjacent[1].x - items[0].x, adjacent[1].y - items[0].y), items[0].height + collisionGap);
});

test('impossible legacy locked overlaps fail atomically rather than moving locked content', t => {
  const { engine: e, state, kernel: k } = fixture(t); let s = state;
  const n = k.createNote('Synthetic legacy', 'preserved');
  const a = k.attachBlock(s.workspaceId, n.id, { x: 0, y: 0, width: 200, height: 200, z: 0 });
  const b = k.attachBlock(s.workspaceId, n.id, { x: 0, y: 0, width: 200, height: 200, z: 0 });
  k.withTransaction(db => { for (const id of [a.id, b.id]) db.prepare('INSERT INTO block_presentations VALUES(?,?)').run(id, JSON.stringify({ locked: true })); });
  s = e.project(s.workspaceId);
  assert.throws(() => run(e, s, { type: 'setPresence', expectedVersion: s.presence.version, presentation: { x: 150, y: 150 } }), code('LOCKED_COLLISION'));
  assert.deepEqual(e.project(s.workspaceId), s);
});

test('schema2 history/checkpoint upgrade preserves exact raw recovery and supports late imported snapshots', t => {
  const dir = mkdtempSync(join(tmpdir(), 'aetherwake-v2-presence-')), path = join(dir, 'synthetic.sqlite');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let k = WorkspaceKernel.open(path); const w = k.createWorkspace('Legacy synthetic'), n = k.createNote('Synthetic note', 'Canonical draft preserved');
  const b = k.attachBlock(w.id, n.id, { x: 32, y: 32, width: 320, height: 240, z: 0 });
  const stored = { ...defaults, blockId: b.id, resourceId: n.id };
  const before = { viewport: { x: 0, y: 0, zoom: 1 }, blocks: [stored] };
  const after = { ...before, blocks: [{ ...stored, x: 100 }] };
  const raw = JSON.stringify({ undo: [{ before, after }], redo: [] });
  k.saveLayout(w.id, 'freeform', after.viewport, [{ blockId: b.id, expectedVersion: 1, placement: { x: 100, y: 32, width: 320, height: 240, z: 0 } }], 1);
  k.withTransaction(db => {
    for (const file of ['001-presentation.sql', '002-history.sql']) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
    db.exec('UPDATE workspace_engine_schema SET version=2');
    db.prepare('INSERT INTO workspace_engine_layouts VALUES(?,?,?)').run('legacy-layout', w.id, raw);
    db.prepare('INSERT INTO workspace_engine_checkpoints VALUES(?,?,?,?,?)').run('legacy-checkpoint', w.id, 'Legacy', JSON.stringify(before), '2026-11-01T00:00:00Z');
  }); k.close();
  k = WorkspaceKernel.open(path);
  try {
    const e = new WorkspaceEngine(k); let s = e.project(w.id);
    assert.equal(s.blocks[0].x, 100); assert.equal(s.layoutId, 'legacy-layout');
    assert.deepEqual(s.presence, defaultPresence(w.id));
    k.withTransaction(db => {
      assert.equal(db.prepare("SELECT json FROM workspace_engine_v2_recovery_archive WHERE kind='history'").get()!.json, raw);
      assert.equal(db.prepare('SELECT version FROM workspace_engine_schema').get()!.version, 4);
    });
    s = run(e, s, { type: 'undoLayout' }); assert.equal(s.blocks[0].x, 32);
    s = run(e, s, { type: 'redoLayout' }); assert.equal(s.blocks[0].x, 100);
    // DesktopState can still import v2 recovery after constructing WorkspaceEngine.
    k.withTransaction(db => db.prepare('UPDATE workspace_engine_layouts SET history_json=? WHERE workspace_id=?').run(raw, w.id));
    s = run(e, s, { type: 'undoLayout' }); assert.equal(s.blocks[0].x, 32);
    s = run(e, s, { type: 'restoreCheckpoint', checkpointId: 'legacy-checkpoint' });
    assert.equal(s.blocks[0].resourceId, n.id); assert.equal(k.getResource(n.id).note.content, 'Canonical draft preserved');
    assert.equal(e.listCheckpoints(w.id).length, 1);
  } finally { k.close(); }
});

test('interrupted presence move and collision cascade recover entirely after process exit', t => {
  const { engine: e, kernel: k, state, path } = fixture(t, true);
  const s = run(e, state, { type: 'createBlock', resource: { kind: 'note', title: 'Synthetic', content: 'kept' }, presentation: { x: 40, y: 400 } });
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { WorkspaceKernel } from ${JSON.stringify(new URL('../../workspace-kernel/kernel.mts', import.meta.url).href)};
    import { WorkspaceEngine } from ${JSON.stringify(new URL('../engine.mts', import.meta.url).href)};
    const k=WorkspaceKernel.open(process.argv[1]); const e=new WorkspaceEngine(k); const s=e.project(process.argv[2]);
    k.withTransaction(()=>{e.execute({type:'setPresence',commandId:'crash-presence',workspaceId:s.workspaceId,expectedRevision:s.revision,expectedVersion:s.presence.version,presentation:{x:s.blocks[0].x,y:s.blocks[0].y}});process.exit(37)});
  `, path, s.workspaceId], { encoding: 'utf8' });
  assert.equal(child.status, 37, child.stderr);
  const other = WorkspaceKernel.open(path);
  try { assert.deepEqual(new WorkspaceEngine(other).project(s.workspaceId), s); other.assertIntegrity(); } finally { other.close(); }
  assert.ok(!k.listEvents('workspace', s.workspaceId).some(e => e.correlation_id === 'crash-presence'));
});
