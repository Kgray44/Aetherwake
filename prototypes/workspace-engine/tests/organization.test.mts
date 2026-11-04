import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { WorkspaceKernel } from '../../workspace-kernel/kernel.mts';
import { WorkspaceEngine } from '../engine.mts';
import { previewLayout, defaultOrganization } from '../organization.mts';
import { fitsBounds, footprint, intersects } from '../collisions.mts';
import type { Command, WorkspaceProjection, Geometry, OrganizationMode, LayoutPreview, Viewport } from '../contracts.mts';
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
  assert.deepEqual(geometry(s.blocks.find(x => x.blockId === b.blockId)!), unchanged);
  assert.ok(s.blocks.every(block => !intersects(footprint({ ...block, id: block.blockId }), s.presence, s.organization.gap)));
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

const safeWorld = (safe: Geometry, camera: Viewport) => ({
  x: camera.x + safe.x / camera.zoom, y: camera.y + safe.y / camera.zoom,
  width: safe.width / camera.zoom, height: safe.height / camera.zoom,
});
const near = (actual: number, expected: number, message: string) => assert.ok(Math.abs(actual - expected) < 1e-7, `${message}: ${actual} vs ${expected}`);
function assertCenteredFit(view: LayoutPreview, safe: Geometry) {
  const { x, y, zoom } = view.viewport;
  const boxes = [...view.blocks.map(b => footprint({ ...b, id: b.blockId })), footprint(view.presence)];
  const left = Math.min(...boxes.map(b => b.x)), right = Math.max(...boxes.map(b => b.x + b.width));
  const top = Math.min(...boxes.map(b => b.y)), bottom = Math.max(...boxes.map(b => b.y + b.height));
  near(((left + right) / 2 - x) * zoom, safe.x + safe.width / 2, 'Horizontal center');
  near(((top + bottom) / 2 - y) * zoom, safe.y + safe.height / 2, 'Vertical center');
  near(zoom, Math.min(1, safe.width / (right - left + 32), safe.height / (bottom - top + 32)), 'Fit zoom with original padding and cap');
  assert.ok((left - 16 - x) * zoom >= safe.x - 1e-7 && (right + 16 - x) * zoom <= safe.x + safe.width + 1e-7);
  assert.ok((top - 16 - y) * zoom >= safe.y - 1e-7 && (bottom + 16 - y) * zoom <= safe.y + safe.height + 1e-7);
}

test('camera-only save and centered recovery preserve raw overlap, resources and one undo step', t => {
  const { engine: e, kernel: k, state } = fixture(t); const resource = k.createNote('Legacy synthetic', 'kept');
  for (let i = 0; i < 2; i++) k.attachBlock(state.workspaceId, resource.id, { x: 6000, y: 5000, width: 320, height: 240, z: 0 });
  let s = e.project(state.workspaceId); const before = layouts(s), canonical = k.getResource(resource.id);
  const viewport = { x: -99.25, y: 120.125, zoom: .8, displayId: 'synthetic:display' };
  const predicted = previewLayout(s, { viewport, bounds });
  s = run(e, s, { type: 'saveLayout', placements: [], viewport }); assert.deepEqual(layouts(s), before); assert.deepEqual(layouts(predicted), before);
  const original = s, safe = { x: 23.75, y: 181.125, width: 1175.4, height: 541.7 }, world = safeWorld(safe, viewport);
  const fit = previewLayout(s, { intent: 'recover', bounds: world });
  assertCenteredFit(fit, safe); assert.deepEqual(fit.affectedPlacementIds, []);
  assert.deepEqual(e.project(s.workspaceId), original, 'Preview leaves canonical state alone');
  s = run(e, s, { type: 'bringAllIntoView', bounds: world });
  assert.equal(s.revision, original.revision + 1); assert.deepEqual(s.viewport, fit.viewport);
  assert.equal(s.viewport.displayId, viewport.displayId);
  assert.deepEqual(s.blocks, original.blocks); assert.deepEqual(s.presence, original.presence);
  assert.deepEqual(s.organization, original.organization); assert.deepEqual(k.getResource(resource.id), canonical);
  assert.deepEqual(run(e, s, { type: 'bringAllIntoView', bounds: safeWorld(safe, s.viewport) }), s, 'Repeated fit leaves no extra history entry');
  const undone = run(e, s, { type: 'undoLayout' });
  assert.deepEqual(undone.viewport, viewport); assert.deepEqual(layouts(undone), before);
  const redone = run(e, undone, { type: 'redoLayout' });
  assert.deepEqual(redone.viewport, s.viewport); assert.deepEqual(layouts(redone), before);
});

test('recovery centers Vela in a workspace with no cards and caps zoom at original size', t => {
  const { engine: e, state } = fixture(t);
  const viewport = { x: 12, y: -319, zoom: 2.75 };
  const s = run(e, state, { type: 'saveLayout', placements: [], viewport });
  const safe = { x: 117.2, y: 83.3, width: 900, height: 700 };
  const fit = previewLayout(s, { intent: 'recover', bounds: safeWorld(safe, viewport) });
  assertCenteredFit(fit, safe);
  assert.equal(fit.viewport.zoom, 1);
  assert.deepEqual(fit.blocks, []); assert.deepEqual(fit.presence, s.presence);
  assert.deepEqual(fit.affectedPlacementIds, []);
  assert.throws(() => previewLayout(s, { intent: 'recover' }), code('BOUNDS_REQUIRED'));
});

test('recovery fits the rotated footprint of an oversized locked card within the supplied safe area', t => {
  const { engine: e, state } = fixture(t);
  let s = run(e, state, { type: 'setOrganization', organization: { mode: 'freeform' } });
  s = add(e, s, { x: -6000, y: -1500, width: 4096, height: 3000, rotation: 35, locked: true });
  assert.equal(s.blocks[0].rotation, 35); assert.equal(s.blocks[0].locked, true);
  const safe = { x: 73, y: 94, width: 202, height: 305 };
  const fit = previewLayout(s, { intent: 'recover', bounds: safeWorld(safe, s.viewport) });
  assertCenteredFit(fit, safe); assert.ok(fit.viewport.zoom < .1);
  assert.deepEqual(fit.blocks, s.blocks); assert.deepEqual(fit.presence, s.presence);
  assert.deepEqual(fit.affectedPlacementIds, []);
});

test('reviewed optimization matches the active viewport, leaves manual anchors exact and survives undo and reopen', t => {
  const { engine: e, path, state } = fixture(t, true);
  let s = run(e, state, { type: 'setOrganization', organization: { mode: 'freeform' } });
  s = add(e, s, { x: 50, y: 210, width: 240, height: 160, locked: true });
  s = add(e, s, { x: 56, y: 220, width: 180, height: 140 });
  s = add(e, s, { x: 270, y: 410, width: 180, height: 128 });
  s = add(e, s, { x: 920, y: 200, width: 160, height: 128, rotation: 21 });
  s = add(e, s, { x: 1300, y: 230, width: 900, height: 360 });
  s = run(e, s, { type: 'saveLayout', placements: [], viewport: { x: -42, y: 61, zoom: .8, displayId: 'synthetic' } });
  const get = (x: number) => s.blocks.find(block => block.x === x)!;
  const [locked, manual, stable, offscreen, oversized] = [50, 56, 270, 920, 1300].map(get);
  const wide = { x: 20, y: 170, width: 2400, height: 740 };
  const small = { x: 20, y: 170, width: 760, height: 400 };
  const movableBlockIds = [stable.blockId, offscreen.blockId, oversized.blockId];
  const request = { intent: 'optimize' as const, movableBlockIds, expectedRevision: s.revision };
  const full = previewLayout(s, { ...request, bounds: wide });
  assert.deepEqual(full.affectedPlacementIds, []);
  assert.deepEqual(full.unresolvedPlacementIds, []);
  const noop = run(e, s, { type: 'optimizeLayout', movableBlockIds, bounds: wide });
  assert.equal(noop.revision, s.revision);

  const preview = previewLayout(s, { ...request, bounds: small });
  assert.deepEqual(preview.affectedPlacementIds, [offscreen.blockId]);
  assert.deepEqual(preview.unresolvedPlacementIds, [oversized.blockId]);
  assert.deepEqual(e.project(s.workspaceId), s);
  assert.throws(() => previewLayout(s, request), code('BOUNDS_REQUIRED'));
  assert.throws(() => previewLayout(s, { ...request, bounds: small, expectedRevision: undefined }), code('CONFLICT'));
  for (const invalid of [[locked.blockId], [offscreen.blockId, offscreen.blockId], ['missing'], ['system:vela'], []]) {
    assert.throws(() => previewLayout(s, { ...request, bounds: small, movableBlockIds: invalid }), code('INVALID_OPTIMIZATION_SELECTION'));
    assert.throws(() => run(e, s, { type: 'optimizeLayout', bounds: small, movableBlockIds: invalid }), code('INVALID_OPTIMIZATION_SELECTION'));
  }

  const command = { type: 'optimizeLayout', commandId: 'reviewed-optimize', workspaceId: s.workspaceId,
    expectedRevision: s.revision, bounds: small, movableBlockIds } as const;
  const applied = e.execute(command);
  assert.deepEqual(layouts(applied), layouts(preview));
  assert.deepEqual(applied.unresolvedPlacementIds, preview.unresolvedPlacementIds);
  assert.deepEqual(applied.viewport, s.viewport);
  assert.deepEqual(applied.organization, s.organization);
  assert.deepEqual(applied.presence, s.presence);
  assert.deepEqual(applied.blocks.filter(block => block.blockId !== offscreen.blockId), s.blocks.filter(block => block.blockId !== offscreen.blockId));
  const moved = applied.blocks.find(block => block.blockId === offscreen.blockId)!;
  assert.deepEqual([moved.width, moved.height, moved.rotation, moved.resourceId], [offscreen.width, offscreen.height, offscreen.rotation, offscreen.resourceId]);
  assert.ok(fitsBounds(footprint({ ...moved, id: moved.blockId }), small));
  for (const anchor of [locked, manual, stable, oversized, s.presence]) {
    assert.equal(intersects(footprint({ ...moved, id: moved.blockId }), footprint({ ...anchor, id: 'anchor' }), s.organization.gap), false);
  }
  assert.deepEqual(e.execute(command), applied);
  assert.throws(() => e.execute({ ...command, commandId: 'stale-optimize' }), code('CONFLICT'));

  const reopened = WorkspaceKernel.open(path);
  try {
    const engine = new WorkspaceEngine(reopened);
    assert.deepEqual(layouts(engine.project(s.workspaceId)), layouts(applied));
    const undo = run(engine, applied, { type: 'undoLayout' });
    assert.deepEqual(layouts(undo), layouts(s));
    assert.deepEqual(undo.viewport, s.viewport);
    const redo = run(engine, undo, { type: 'redoLayout' });
    assert.deepEqual(layouts(redo), layouts(applied));
    for (const block of redo.blocks) assert.equal(reopened.getResource(block.resourceId!).note.content, 'Canonical synthetic draft');
  } finally { reopened.close(); }
});

test('structured optimization snaps moved cards without reflowing existing unselected geometry', t => {
  const { engine: e, state } = fixture(t);
  let s = run(e, state, { type: 'setOrganization', organization: { mode: 'freeform' } });
  s = add(e, s, { x: 137, y: 227, width: 220, height: 160 });
  s = add(e, s, { x: 1001, y: 237, width: 160, height: 128 });
  s = run(e, s, { type: 'setOrganization', organization: { mode: 'structured' } });
  const target = s.blocks.find(block => block.x === 1001)!;
  const movableBlockIds = [target.blockId];
  const visible = { x: 20, y: 170, width: 750, height: 390 };
  const preview = previewLayout(s, { intent: 'optimize', expectedRevision: s.revision, bounds: visible, movableBlockIds });
  const applied = run(e, s, { type: 'optimizeLayout', bounds: visible, movableBlockIds });
  const moved = applied.blocks.find(block => block.blockId === target.blockId)!;
  assert.deepEqual(layouts(applied), layouts(preview));
  assert.deepEqual([moved.x % 16, moved.y % 16, moved.width, moved.height], [0, 0, target.width, target.height]);
  assert.deepEqual(applied.blocks.find(block => block.blockId !== target.blockId), s.blocks.find(block => block.blockId !== target.blockId));
  assert.deepEqual(applied.organization, s.organization);
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

test('Vela and card gestures clear each other with matching previews in all modes and preserve Structured circle shape', t => {
  const { engine: e, kernel: k, state } = fixture(t); let s = add(e, state, { x: 50, y: 400 });
  for (const mode of ['fluid', 'freeform', 'structured']) {
    s = run(e, s, { type: 'setOrganization', organization: { mode } }); const b = s.blocks[0];
    const update = { expectedVersion: s.presence.version, presentation: { x: b.x + 20, y: b.y + 20 } };
    const predicted = previewLayout(s, { presence: update, bounds });
    s = run(e, s, { type: 'setPresence', ...update }); assert.deepEqual(layouts(s), layouts(predicted));
    disjoint(s);
    assert.equal(s.presence.id, 'system:vela'); assert.equal(k.searchResources().length, 1);

    const card = s.blocks[0];
    const placements = [{ blockId: card.blockId, expectedVersion: card.version, presentation: { x: s.presence.x, y: s.presence.y } }];
    const cardPreview = previewLayout(s, { placements, bounds });
    assert.deepEqual(e.project(s.workspaceId), s, 'Preview never persists the candidate');
    s = run(e, s, { type: 'saveLayout', placements });
    assert.deepEqual(layouts(s), layouts(cardPreview)); disjoint(s);

    const moved = s.blocks[0];
    const resize = [{ blockId: moved.blockId, expectedVersion: moved.version, presentation: {
      x: s.presence.x, y: s.presence.y, width: moved.width + 48, height: moved.height + 32,
    } }];
    const resizePreview = previewLayout(s, { placements: resize, bounds });
    s = run(e, s, { type: 'saveLayout', placements: resize });
    assert.deepEqual(layouts(s), layouts(resizePreview)); disjoint(s);
  }
  const b = s.blocks[0], predicted = previewLayout(s, { bounds, placements: [{ blockId: b.blockId, expectedVersion: b.version, presentation: { shape: 'circle' } }] });
  s = run(e, s, { type: 'setBlockShape', blockId: b.blockId, shape: 'circle' });
  assert.deepEqual(layouts(s), layouts(predicted)); assert.equal(s.blocks[0].height, s.blocks[0].width); assert.equal(s.blocks[0].contentMode, 'summary');
});

test('legacy Freeform overlaps survive opening and history, and Make room repairs only the Vela collision', t => {
  const { engine: e, kernel: k, state } = fixture(t);
  let s = run(e, state, { type: 'setOrganization', organization: { mode: 'freeform' } });
  s = add(e, s, { x: 80, y: 400, width: 200, height: 150, locked: true });
  s = add(e, s, { x: 80, y: 400, width: 200, height: 150, locked: true });
  k.withTransaction(db => db.prepare('UPDATE workspace_engine_layouts SET presence_json=? WHERE workspace_id=?')
    .run(JSON.stringify({ ...s.presence, x: 80, y: 400 }), s.workspaceId));
  s = e.project(s.workspaceId);
  assert.ok(intersects(s.blocks[0], s.presence));
  assert.deepEqual(e.switchWorkspace(s.workspaceId), s);
  assert.deepEqual(layouts(previewLayout(s, { bounds })), layouts(s));
  const view = run(e, s, { type: 'saveLayout', placements: [], viewport: { ...s.viewport, x: 3 } });
  assert.deepEqual(layouts(view), layouts(s));

  const preview = previewLayout(view, { intent: 'resolve', bounds });
  const arranged = run(e, view, { type: 'resolveLayout' });
  assert.deepEqual(layouts(arranged), layouts(preview));
  assert.deepEqual(arranged.blocks, s.blocks);
  assert.ok(arranged.blocks.every(block => !intersects(block, arranged.presence, arranged.organization.gap)));
  assert.deepEqual(layouts(run(e, arranged, { type: 'undoLayout' })), layouts(view));
});

test('Structured placement cannot introduce Vela overlap and a conflicting newly locked drop fails atomically', t => {
  const { engine: e, state } = fixture(t);
  let s = run(e, state, { type: 'setOrganization', organization: { mode: 'structured' } });
  s = add(e, s, { x: s.presence.x, y: s.presence.y }); disjoint(s);
  const card = s.blocks[0];
  const placements = [{ blockId: card.blockId, expectedVersion: card.version,
    presentation: { x: s.presence.x, y: s.presence.y, locked: true } }];
  assert.throws(() => previewLayout(s, { placements, bounds }), code('LOCKED_COLLISION'));
  assert.throws(() => run(e, s, { type: 'saveLayout', placements }), code('LOCKED_COLLISION'));
  assert.deepEqual(e.project(s.workspaceId), s);
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
