import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { WorkspaceKernel } from '../../workspace-kernel/kernel.mts';
import { WorkspaceEngine } from '../engine.mts';
import { previewLayout, defaultOrganization } from '../organization.mts';
import { footprint, intersects } from '../collisions.mts';
import type { Command, WorkspaceProjection, Geometry, OrganizationMode, LayoutPreview } from '../contracts.mts';
const bounds = { x: 20, y: 170, width: 1240, height: 650 };
let serial = 0;
const code = (value: string) => (error: any) => error.code === value;
function fixture(t: any, disk = false) {
  const dir = disk ? mkdtempSync(join(tmpdir(), 'aetherwake-modes-')) : null, path = dir ? join(dir, 'synthetic.sqlite') : ':memory:';
  const kernel = WorkspaceKernel.open(path), engine = new WorkspaceEngine(kernel);
  t.after(() => { kernel.close(); if (dir) rmSync(dir, { recursive: true, force: true }); });
  return { kernel, engine, path, state: engine.createWorkspace('Synthetic modes') };
}
function run(e: WorkspaceEngine, s: WorkspaceProjection, action: object) {
  return e.execute({ commandId: `mode-${++serial}`, workspaceId: s.workspaceId, expectedRevision: s.revision, bounds, ...action } as Command);
}
const geometry = (b: Geometry) => ({ x: b.x, y: b.y, width: b.width, height: b.height });
function layouts(s: Pick<WorkspaceProjection, 'blocks' | 'presence'> | LayoutPreview) {
  return { blocks: s.blocks.map(b => ({ id: b.blockId, ...geometry(b), shape: b.shape, rotation: b.rotation, z: b.zIndex })), presence: geometry(s.presence) };
}
const add = (e: WorkspaceEngine, s: WorkspaceProjection, p: object = {}) => run(e, s, { type: 'createBlock', resource: { kind: 'note', title: 'Synthetic mode resource', content: 'Canonical synthetic draft' }, presentation: p });
function disjoint(s: Pick<WorkspaceProjection, 'blocks' | 'presence' | 'organization'>) {
  const items = [...s.blocks.map(b => ({ ...b, id: b.blockId })), s.presence];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++)
    assert.equal(intersects(footprint(items[i]), footprint(items[j]), Math.min(s.organization.gap, s.organization.structured.rowGap, s.organization.structured.columnGap)), false);
}

test('Fluid is default, inherited preference is explicit and each workspace persists its own mode', t => {
  const { engine: e, kernel: k, path, state } = fixture(t, true);
  assert.equal(state.organization.mode, 'fluid');
  const inherited = new WorkspaceEngine(k, { defaultOrganization: { mode: 'freeform' } });
  const b = inherited.createWorkspace('Inherited manual'); assert.equal(b.organization.mode, 'freeform');
  const c = inherited.createWorkspace('Explicit structured', null, { mode: 'structured', structured: { columnCount: 4 } });
  assert.equal(c.organization.mode, 'structured');
  const other = WorkspaceKernel.open(path);
  try {
    const e2 = new WorkspaceEngine(other);
    assert.equal(e2.switchWorkspace(state.workspaceId).organization.mode, 'fluid');
    assert.equal(e2.switchWorkspace(b.workspaceId).organization.mode, 'freeform');
    assert.equal(e2.switchWorkspace(c.workspaceId).organization.structured.columnCount, 4);
  } finally { other.close(); }
});

test('Freeform preserves intentional overlaps, neighbors, Vela and all four layer operations after restart', t => {
  const { engine: e, path, state } = fixture(t, true); let s = run(e, state, { type: 'setOrganization', organization: { mode: 'freeform' } });
  s = add(e, s, { x: 480, y: 200 }); s = add(e, s, { x: 480, y: 200 });
  const [a, b] = s.blocks, unchanged = geometry(b), presence = geometry(s.presence);
  s = run(e, s, { type: 'moveBlock', blockId: a.blockId, x: b.x + 10, y: b.y + 10 });
  s = run(e, s, { type: 'resizeBlock', blockId: a.blockId, width: 700, height: 500 });
  assert.deepEqual(geometry(s.blocks.find(x => x.blockId === b.blockId)!), unchanged); assert.deepEqual(geometry(s.presence), presence);
  assert.equal(intersects(footprint({ ...s.blocks[0], id: a.blockId }), footprint({ ...s.blocks[1], id: b.blockId }), 0), true);
  for (const direction of ['front', 'back', 'raise', 'lower']) {
    const old = s.blocks.find(x => x.blockId === a.blockId)!.zIndex;
    s = run(e, s, { type: 'layerBlock', blockId: a.blockId, direction });
    const z = s.blocks.find(x => x.blockId === a.blockId)!.zIndex;
    if (direction === 'raise') assert.equal(z, old + 1);
    if (direction === 'lower') assert.equal(z, old - 1);
    assert.deepEqual(geometry(s.blocks.find(x => x.blockId === b.blockId)!), unchanged);
  }
  s = run(e, s, { type: 'setPresence', expectedVersion: s.presence.version, presentation: { x: b.x, y: b.y } });
  const reopened = WorkspaceKernel.open(path);
  try { assert.deepEqual(new WorkspaceEngine(reopened).project(s.workspaceId), s); } finally { reopened.close(); }
});

test('Fluid preview is noncanonical, predicts exact commit, preserves neighbor dimensions and cancels by discard', t => {
  const { engine: e, kernel: k, state } = fixture(t); let s = state;
  s = add(e, s, { x: 30, y: 400 }); s = add(e, s, { x: 500, y: 400 });
  const before = structuredClone(s), [a, b] = s.blocks;
  const request = { expectedRevision: s.revision, bounds, placements: [{ blockId: a.blockId, expectedVersion: a.version, presentation: { x: b.x, y: b.y } }] };
  let count = 0; k.withTransaction(db => { count = Number(db.prepare('SELECT total_changes() AS n').get()!.n); });
  const preview = previewLayout(s, request); assert.equal(preview.canonical, false); assert.equal(preview.baseRevision, s.revision);
  assert.deepEqual(s, before); assert.deepEqual(e.project(s.workspaceId), before);
  k.withTransaction(db => { assert.equal(Number(db.prepare('SELECT total_changes() AS n').get()!.n), count); });
  assert.ok(preview.affectedPlacementIds.includes(a.blockId)); assert.ok(preview.placementAreas.length);
  for (const old of s.blocks) { const p = preview.blocks.find(b => b.blockId === old.blockId)!; assert.equal(p.width, old.width); assert.equal(p.height, old.height); }
  s = run(e, s, { type: 'saveLayout', placements: request.placements }); assert.deepEqual(layouts(s), layouts(preview)); disjoint(s);
  s = run(e, s, { type: 'undoLayout' }); assert.deepEqual(layouts(s), layouts(before));
});

test('Fluid local yielding avoids propagating a move into an unrelated neighbor', t => {
  const { engine: e, state } = fixture(t); let s = run(e, state, { type: 'setOrganization', organization: { mode: 'freeform' } });
  s = add(e, s, { x: 20, y: 400, width: 128, height: 96 });
  s = add(e, s, { x: 300, y: 400, width: 128, height: 96 });
  s = add(e, s, { x: 440, y: 400, width: 128, height: 96 });
  s = run(e, s, { type: 'setOrganization', organization: { mode: 'fluid' } });
  const positions = s.blocks.toSorted((a, b) => a.x - b.x), [a, b, c] = positions;
  const result = previewLayout(s, { bounds, placements: [{ blockId: a.blockId, expectedVersion: a.version, presentation: { x: b.x, y: b.y } }] });
  assert.deepEqual(geometry(result.blocks.find(b => b.blockId === c.blockId)!), geometry(c));
  assert.ok(result.affectedPlacementIds.includes(b.blockId));
});

for (const count of [0, 3, 10, 25, 50]) test(`Explicit Structured resolve at ${count} blocks retains variable spans/alignment and restarts identically`, t => {
  const { engine: e, path, state } = fixture(t, true); let s = state;
  for (let i = 0; i < count; i++) s = add(e, s, { width: i % 3 === 0 ? 650 : 260, height: i % 2 === 0 ? 300 : 180 });
  const ids = s.blocks.map(b => b.blockId).sort(), presenceSize = geometry(s.presence);
  s = run(e, s, { type: 'setOrganization', organization: { mode: 'structured', structured: { columnCount: 4, rowHeight: 96, margin: 16 } } });
  s = run(e, s, { type: 'resolveLayout' });
  assert.equal(s.organization.mode, 'structured'); disjoint(s);
  assert.deepEqual(s.blocks.map(b => b.blockId).sort(), ids);
  assert.equal(s.presence.width, presenceSize.width); assert.equal(s.presence.height, presenceSize.height);
  const step = (bounds.width - 32 - 36) / 4 + 12;
  for (const b of s.blocks) { assert.ok(Math.abs((b.x - bounds.x - 16) / step - Math.round((b.x - bounds.x - 16) / step)) < 1e-8); assert.ok(s.organization.structured.spans[b.blockId]); }
  if (count >= 3) assert.ok(new Set(s.blocks.map(b => b.width)).size > 1);
  const identical = run(e, s, { type: 'resolveLayout' }); assert.deepEqual(identical, s);
  const reopened = WorkspaceKernel.open(path);
  try { assert.deepEqual(new WorkspaceEngine(reopened).project(s.workspaceId), s); } finally { reopened.close(); }
});

test('Structured resize and reorder previews equal commits; all presets retain identities', t => {
  const { engine: e, state } = fixture(t); let s = state; for (let i = 0; i < 5; i++) s = add(e, s, { width: 260, height: 180 });
  s = run(e, s, { type: 'setOrganization', organization: { mode: 'structured', structured: { columnCount: 4 } } });
  s = run(e, s, { type: 'resolveLayout' });
  const b = s.blocks[0], updates = [{ blockId: b.blockId, expectedVersion: b.version, presentation: { width: 800, height: 450 } }];
  const preview = previewLayout(s, { placements: updates, bounds });
  s = run(e, s, { type: 'saveLayout', placements: updates }); assert.deepEqual(layouts(s), layouts(preview));
  assert.ok(s.organization.structured.spans[b.blockId].columns >= 3); disjoint(s);
  const order = s.organization.structured.order.toReversed(), predicted = previewLayout(s, { order, intent: 'reorder', bounds });
  s = run(e, s, { type: 'reorderPlacements', order }); assert.deepEqual(layouts(s), layouts(predicted)); assert.deepEqual(s.organization.structured.order, order);
  const ids = s.blocks.map(b => b.resourceId).sort();
  for (const preset of ['balanced', 'focus', 'development', 'research']) {
    const predicted = previewLayout(s, { structuredPreset: preset as any, bounds });
    s = run(e, s, { type: 'applyStructuredPreset', preset }); assert.deepEqual(layouts(s), layouts(predicted));
    assert.deepEqual(s.blocks.map(b => b.resourceId).sort(), ids); disjoint(s);
  }
});

test('explicit Structured spans survive setOrganization, resolve and restart', t => {
  const { engine: e, path, state } = fixture(t, true); let s = add(e, state, { width: 260, height: 180 }); const id = s.blocks[0].blockId;
  const organization = { mode: 'structured' as const, structured: { columnCount: 4, spans: { [id]: { columns: 2, rows: 4 } } } };
  const preview = previewLayout(s, { organization, bounds });
  s = run(e, s, { type: 'setOrganization', organization }); assert.deepEqual(layouts(s), layouts(preview));
  assert.deepEqual(s.organization.structured.spans[id], { columns: 2, rows: 4 });
  s = run(e, s, { type: 'resolveLayout' }); assert.deepEqual(s.organization.structured.spans[id], { columns: 2, rows: 4 });
  const reopened = WorkspaceKernel.open(path);
  try { assert.deepEqual(new WorkspaceEngine(reopened).project(s.workspaceId), s); } finally { reopened.close(); }
});

test('Explicit Structured order does not backfill Vela; later Vela drag preserves that preference and matches commit', t => {
  const { engine: e, path, state } = fixture(t, true);
  let s = run(e, state, { type: 'setOrganization', organization: { mode: 'freeform' } });
  for (let i = 0; i < 3; i++) s = add(e, s, { width: 650, height: 300 });
  const ids = s.blocks.map(b => b.blockId), order = [...ids, 'system:vela'];
  const spans = Object.fromEntries(ids.map(id => [id, { columns: 2, rows: 4 }]));
  s = run(e, s, { type: 'setOrganization', organization: { mode: 'structured', structured: { columnCount: 3, order, spans } } });
  s = run(e, s, { type: 'resolveLayout' });
  const items = [...s.blocks.map(b => ({ ...b, id: b.blockId })), s.presence];
  const visualOrder = items.toSorted((a, b) => a.y - b.y || a.x - b.x).map(b => b.id);
  assert.deepEqual(visualOrder, order); disjoint(s);
  assert.ok(s.presence.y >= s.blocks.find(b => b.blockId === ids.at(-1))!.y);
  const first = s.blocks.find(b => b.blockId === ids[0])!, before = s;
  const presence = { expectedVersion: s.presence.version, presentation: { x: first.x, y: first.y - s.presence.height } };
  const predicted = previewLayout(s, { presence, bounds });
  assert.deepEqual(predicted.organization.structured.order, order, 'Dragging is not an implicit reorder/pack command');
  assert.notDeepEqual(geometry(predicted.presence), geometry(s.presence));
  s = run(e, s, { type: 'setPresence', ...presence });
  assert.deepEqual(layouts(s), layouts(predicted)); disjoint(s);
  const reopened = WorkspaceKernel.open(path);
  try {
    const e2 = new WorkspaceEngine(reopened);
    assert.deepEqual(e2.project(s.workspaceId), s);
    const restored = run(e2, s, { type: 'undoLayout' });
    assert.deepEqual(layouts(restored), layouts(before));
    assert.deepEqual(restored.organization.structured.order, before.organization.structured.order);
  } finally { reopened.close(); }
});

test('explicit column preference can be reset to automatic without replacing the workspace', t => {
  const { engine: e, state } = fixture(t); let s = add(e, state);
  s = run(e, s, { type: 'setOrganization', organization: { mode: 'structured', structured: { columnCount: 4 } } });
  const id = s.blocks[0].blockId;
  s = run(e, s, { type: 'setOrganization', organization: { structured: { columnCount: null } } });
  assert.equal(s.organization.structured.columnCount, undefined); assert.equal(s.blocks[0].blockId, id);
  s = run(e, s, { type: 'undoLayout' }); assert.equal(s.organization.structured.columnCount, 4);
});

test('mode changes undo mode/config/geometry durably and keep canonical drafts intact', t => {
  const { engine: e, kernel: k, path, state } = fixture(t, true); let s = run(e, state, { type: 'setOrganization', organization: { mode: 'freeform' } });
  s = add(e, s, { x: 77, y: 303, width: 367, height: 291 }); s = add(e, s, { x: 85, y: 311, width: 501, height: 307 });
  const before = s, predicted = previewLayout(s, { organization: { mode: 'structured' }, bounds });
  s = run(e, s, { type: 'setOrganization', organization: { mode: 'structured' } }); assert.deepEqual(layouts(s), layouts(predicted));
  const reopened = WorkspaceKernel.open(path);
  try {
    const e2 = new WorkspaceEngine(reopened); s = run(e2, e2.project(s.workspaceId), { type: 'undoLayout' });
    assert.equal(s.organization.mode, 'freeform'); assert.deepEqual(layouts(s), layouts(before));
    s = run(e2, s, { type: 'redoLayout' }); assert.equal(s.organization.mode, 'structured');
  } finally { reopened.close(); }
  for (const b of before.blocks) {
    const resourceId = b.resourceId; assert.ok(typeof resourceId === 'string', 'This fixture creates canonical Note resources');
    assert.equal(k.getResource(resourceId).note.content, 'Canonical synthetic draft');
  }
});

test('all six mode transitions preserve identities and can be undone', t => {
  const { engine: e, state } = fixture(t); let s = add(e, state);
  for (const from of ['fluid', 'freeform', 'structured'] as OrganizationMode[]) for (const to of ['fluid', 'freeform', 'structured'] as OrganizationMode[]) {
    if (from === to) continue;
    s = run(e, s, { type: 'setOrganization', organization: { mode: from } }); const before = s;
    s = run(e, s, { type: 'setOrganization', organization: { mode: to } }); assert.equal(s.organization.mode, to);
    assert.deepEqual(s.blocks.map(b => b.resourceId), before.blocks.map(b => b.resourceId));
    s = run(e, s, { type: 'undoLayout' }); assert.equal(s.organization.mode, from); assert.deepEqual(layouts(s), layouts(before));
  }
});

test('camera-only save and Bring All Into View preserve raw overlap and are reversible', t => {
  const { engine: e, kernel: k, state } = fixture(t); const resource = k.createNote('Legacy synthetic', 'kept');
  for (let i = 0; i < 2; i++) k.attachBlock(state.workspaceId, resource.id, { x: 6000, y: 5000, width: 320, height: 240, z: 0 });
  let s = e.project(state.workspaceId), before = layouts(s);
  const viewport = { x: 100, y: 120, zoom: 1 };
  const predicted = previewLayout(s, { viewport, bounds });
  s = run(e, s, { type: 'saveLayout', placements: [], viewport }); assert.deepEqual(layouts(s), before); assert.deepEqual(layouts(predicted), before);
  const fit = previewLayout(s, { intent: 'recover', bounds });
  s = run(e, s, { type: 'bringAllIntoView' }); assert.deepEqual(layouts(s), before); assert.deepEqual(s.viewport, fit.viewport);
  const safeX = (bounds.x - viewport.x) * viewport.zoom, safeY = (bounds.y - viewport.y) * viewport.zoom;
  for (const b of [...s.blocks, s.presence]) {
    assert.ok((b.x - s.viewport.x) * s.viewport.zoom >= safeX - 1e-7);
    assert.ok((b.y - s.viewport.y) * s.viewport.zoom >= safeY - 1e-7);
    assert.ok((b.x + b.width - s.viewport.x) * s.viewport.zoom <= safeX + bounds.width * viewport.zoom + 1e-7);
    assert.ok((b.y + b.height - s.viewport.y) * s.viewport.zoom <= safeY + bounds.height * viewport.zoom + 1e-7);
  }
  s = run(e, s, { type: 'undoLayout' }); assert.deepEqual(s.viewport, viewport); assert.deepEqual(layouts(s), before);
});

test('locked geometry, invalid policies and stale organization revisions fail without partial changes', t => {
  const { engine: e, state } = fixture(t); let s = add(e, state);
  const id = s.blocks[0].blockId; s = run(e, s, { type: 'setBlockLock', blockId: id, locked: true }); const fixed = geometry(s.blocks[0]);
  s = run(e, s, { type: 'setOrganization', organization: { mode: 'structured' } }); assert.deepEqual(geometry(s.blocks[0]), fixed);
  for (const organization of [{ mode: 'other' }, { gap: NaN }, { structured: { columnCount: 0 } }, { structured: { spans: { [id]: { columns: -1, rows: 2 } } } }])
    assert.throws(() => run(e, s, { type: 'setOrganization', organization }), code('INVALID'));
  assert.throws(() => run(e, s, { type: 'setOrganization', organization: { mode: 'freeform' }, expectedOrganizationRevision: 999 }), code('CONFLICT'));
  assert.throws(() => run(e, s, { type: 'reorderPlacements', order: [id, id] }), code('INVALID_ORDER'));
  assert.deepEqual(e.project(s.workspaceId), s);
});

test('schema3 migration preserves raw geometry/history, defaults Fluid and honors explicit preferences', t => {
  const { engine: e, kernel: k, path, state } = fixture(t, true); let s = add(e, state);
  s = run(e, s, { type: 'moveBlock', blockId: s.blocks[0].blockId, x: 999, y: 777 });
  let raw = '';
  const manual = k.createWorkspace('Explicit legacy Freeform'), grid = k.createWorkspace('Explicit legacy Structured');
  k.saveLayout(manual.id, 'freeform', { organizationMode: 'freeform' }, [], 1);
  k.saveLayout(grid.id, 'structured', {}, [], 1);
  k.withTransaction(db => {
    const h = JSON.parse(String(db.prepare('SELECT history_json FROM workspace_engine_layouts').get()!.history_json));
    for (const entry of [...h.undo, ...h.redo]) { delete entry.before.organization; delete entry.after.organization; }
    raw = JSON.stringify(h); db.prepare('UPDATE workspace_engine_layouts SET history_json=?').run(raw);
    db.exec(`DROP TABLE workspace_engine_v3_recovery_archive; ALTER TABLE workspace_engine_layouts DROP COLUMN organization_json;
      ALTER TABLE workspace_engine_layouts DROP COLUMN legacy_organization_json; UPDATE workspace_engine_schema SET version=3;`);
  });
  const reopened = WorkspaceKernel.open(path);
  try {
    const e2 = new WorkspaceEngine(reopened); const migrated = e2.project(s.workspaceId);
    assert.equal(migrated.organization.mode, 'fluid'); assert.deepEqual(layouts(migrated), layouts(s));
    assert.equal(e2.project(manual.id).organization.mode, 'freeform'); assert.equal(e2.project(grid.id).organization.mode, 'structured');
    reopened.withTransaction(db => assert.equal(db.prepare("SELECT json FROM workspace_engine_v3_recovery_archive WHERE kind='history'").get()!.json, raw));
    const restored = run(e2, migrated, { type: 'undoLayout' }); assert.notEqual(restored.blocks[0].x, 999);
  } finally { reopened.close(); }
});

test('Vela previews match commits in all modes and Structured circular resize preserves its shape', t => {
  const { engine: e, kernel: k, state } = fixture(t); let s = add(e, state, { x: 50, y: 400 });
  for (const mode of ['fluid', 'freeform', 'structured']) {
    s = run(e, s, { type: 'setOrganization', organization: { mode } }); const b = s.blocks[0];
    const update = { expectedVersion: s.presence.version, presentation: { x: b.x + 20, y: b.y + 20 } };
    const predicted = previewLayout(s, { presence: update, bounds });
    s = run(e, s, { type: 'setPresence', ...update }); assert.deepEqual(layouts(s), layouts(predicted));
    assert.equal(s.presence.id, 'system:vela'); assert.equal(k.searchResources().length, 1);
  }
  const b = s.blocks[0], predicted = previewLayout(s, { bounds, placements: [{ blockId: b.blockId, expectedVersion: b.version, presentation: { shape: 'circle' } }] });
  s = run(e, s, { type: 'setBlockShape', blockId: b.blockId, shape: 'circle' });
  assert.deepEqual(layouts(s), layouts(predicted)); assert.equal(s.blocks[0].height, s.blocks[0].width); assert.equal(s.blocks[0].contentMode, 'summary');
});

test('a named checkpoint restores mode, variable geometry, overlap and identity after restart', t => {
  const { engine: e, path, state } = fixture(t, true); let s = run(e, state, { type: 'setOrganization', organization: { mode: 'freeform' } });
  s = add(e, s, { x: 80, y: 220, width: 333, height: 277 }); s = add(e, s, { x: 95, y: 235, width: 450, height: 300 });
  const before = layouts(s), saved = run(e, s, { type: 'checkpoint', name: 'Custom Freeform' });
  s = run(e, saved, { type: 'applyStructuredPreset', preset: 'development' });
  const other = WorkspaceKernel.open(path);
  try {
    const e2 = new WorkspaceEngine(other);
    const restored = run(e2, e2.project(s.workspaceId), { type: 'restoreCheckpoint', checkpointId: saved.checkpointId });
    assert.equal(restored.organization.mode, 'freeform'); assert.deepEqual(layouts(restored), before);
  } finally { other.close(); }
});

test('a stale mode-change preview cannot overwrite a newer policy in another window', t => {
  const { engine: e, path, state } = fixture(t, true); const other = WorkspaceKernel.open(path);
  try {
    const e2 = new WorkspaceEngine(other), stale = e2.project(state.workspaceId);
    const result = run(e, state, { type: 'setOrganization', organization: { mode: 'freeform' } });
    assert.throws(() => run(e2, stale, { type: 'setOrganization', organization: { mode: 'structured' }, expectedOrganizationRevision: stale.organization.revision }), code('CONFLICT'));
    assert.deepEqual(e2.project(result.workspaceId), result);
  } finally { other.close(); }
});

test('failed schema4 migration rolls back columns/archive and preserves exact prior history', t => {
  const { engine: e, kernel: k, state } = fixture(t); const s = add(e, state); let raw = '';
  k.withTransaction(db => {
    raw = String(db.prepare('SELECT history_json FROM workspace_engine_layouts').get()!.history_json);
    db.exec(`DROP TABLE workspace_engine_v3_recovery_archive; ALTER TABLE workspace_engine_layouts DROP COLUMN organization_json;
      ALTER TABLE workspace_engine_layouts DROP COLUMN legacy_organization_json; UPDATE workspace_engine_schema SET version=3;
      CREATE TRIGGER reject_organization_upgrade BEFORE UPDATE ON workspace_engine_schema WHEN NEW.version=4
      BEGIN SELECT RAISE(ABORT,'Synthetic organization migration interruption'); END;`);
  });
  assert.throws(() => new WorkspaceEngine(k), /Synthetic organization migration interruption/);
  k.withTransaction(db => {
    assert.equal(db.prepare('SELECT version FROM workspace_engine_schema').get()!.version, 3);
    assert.equal(db.prepare("SELECT count(*) AS n FROM pragma_table_info('workspace_engine_layouts') WHERE name='organization_json'").get()!.n, 0);
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='workspace_engine_v3_recovery_archive'").get()!.n, 0);
    assert.equal(db.prepare('SELECT history_json FROM workspace_engine_layouts').get()!.history_json, raw);
    db.exec('DROP TRIGGER reject_organization_upgrade');
  });
  const recovered = new WorkspaceEngine(k).project(s.workspaceId); assert.equal(recovered.blocks[0].resourceId, s.blocks[0].resourceId);
});

test('interrupted mode transformation recovers prior policy, geometry, presence and history', t => {
  const { engine: e, path, state } = fixture(t, true); let s = add(e, state); s = add(e, s);
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { WorkspaceKernel } from ${JSON.stringify(new URL('../../workspace-kernel/kernel.mts', import.meta.url).href)};
    import { WorkspaceEngine } from ${JSON.stringify(new URL('../engine.mts', import.meta.url).href)};
    const k=WorkspaceKernel.open(process.argv[1]),e=new WorkspaceEngine(k),s=e.project(process.argv[2]);
    k.withTransaction(()=>{e.execute({type:'setOrganization',commandId:'interrupted-mode',workspaceId:s.workspaceId,expectedRevision:s.revision,organization:{mode:'structured'},bounds:{x:20,y:170,width:1240,height:650}});process.exit(37)});
  `, path, s.workspaceId], { encoding: 'utf8' });
  assert.equal(child.status, 37, child.stderr);
  const other = WorkspaceKernel.open(path);
  try { assert.deepEqual(new WorkspaceEngine(other).project(s.workspaceId), s); other.assertIntegrity(); } finally { other.close(); }
});
