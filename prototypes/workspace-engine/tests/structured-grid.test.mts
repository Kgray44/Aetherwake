import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceKernel } from '../../workspace-kernel/kernel.mts';
import { WorkspaceEngine } from '../engine.mts';
import { previewLayout } from '../organization.mts';
import { footprint, intersects } from '../collisions.mts';
import { STRUCTURED_GRID_SIZE } from '../structured-grid.mts';
import { DesktopState } from '../../integrated-backend/src/desktop.mts';
import type { DesktopCommand } from '../../application-contract/contracts.ts';
import type { Command, WorkspaceProjection } from '../contracts.mts';
const bounds = { x: 20, y: 170, width: 1240, height: 650 };
let serial = 0;
const run = (engine: WorkspaceEngine, state: WorkspaceProjection, action: object) => engine.execute({ commandId: 'grid-' + ++serial, workspaceId: state.workspaceId, expectedRevision: state.revision, bounds, ...action } as Command);
function fixture(t: any, disk = false) {
  const path = disk ? join(mkdtempSync(join(tmpdir(), 'aetherwake-structured-grid-')), 'synthetic.sqlite') : ':memory:';
  const kernel = WorkspaceKernel.open(path), engine = new WorkspaceEngine(kernel);
  const f = { path, kernel, engine, state: engine.createWorkspace('Synthetic manual grid') };
  t.after(() => f.kernel.close());
  f.state = run(engine, f.state, { type: 'setOrganization', organization: { mode: 'freeform' } });
  return f;
}
const add = (f: ReturnType<typeof fixture>, state: WorkspaceProjection, presentation: object) => run(f.engine, state, { type: 'createBlock', resource: { kind: 'note', title: 'Synthetic preserved content', content: 'Exact original note' }, presentation });
const geometry = (state: WorkspaceProjection) => ({ blocks: state.blocks.map(({ version, ...block }) => block), presence: (({ version, ...presence }) => presence)(state.presence), viewport: state.viewport });

test('Structured mode and settings only enable the grid: exact overlapping/locked positions, sizes, shapes, order, camera and Vela survive restart and undo', t => {
  const f = fixture(t, true); let s = f.state;
  s = add(f, s, { x: 77, y: 303, width: 367, height: 291, rotation: 17, shape: 'folio', zIndex: 4 });
  s = add(f, s, { x: 85, y: 311, width: 251, height: 251, shape: 'circle', zIndex: -3, locked: true });
  // Emulate a saved pre-guard layout with a locked Vela covering a locked card.
  f.kernel.withTransaction(db => db.prepare('UPDATE workspace_engine_layouts SET presence_json=? WHERE workspace_id=?')
    .run(JSON.stringify({ ...s.presence, x: 85, y: 311, locked: true }), s.workspaceId));
  s = f.engine.project(s.workspaceId);
  s = run(f.engine, s, { type: 'saveLayout', placements: [], viewport: { x: -123.25, y: 55.75, zoom: 0.65, displayId: 'synthetic-display' } });
  const order = [...s.blocks.map(block => block.blockId).toReversed(), 'system:vela'];
  s = run(f.engine, s, { type: 'setOrganization', organization: { structured: { order, spans: { [s.blocks[0].blockId]: { columns: 2, rows: 4 } } } } });
  const before = structuredClone(s), preview = previewLayout(s, { organization: { mode: 'structured' }, bounds });
  assert.deepEqual(preview.blocks, before.blocks); assert.deepEqual(preview.presence, before.presence); assert.deepEqual(preview.viewport, before.viewport); assert.deepEqual(preview.affectedPlacementIds, []); assert.ok(preview.guides.length);
  s = run(f.engine, s, { type: 'setOrganization', expectedOrganizationRevision: s.organization.revision, organization: { mode: 'structured' } });
  assert.deepEqual(s.blocks, before.blocks); assert.deepEqual(s.presence, before.presence); assert.deepEqual(s.viewport, before.viewport); assert.deepEqual(s.organization.structured, before.organization.structured);
  assert.deepEqual(run(f.engine, s, { type: 'setOrganization', organization: { mode: 'structured' } }), s, 'Selecting the active mode is a true no-op');
  f.kernel.close(); f.kernel = WorkspaceKernel.open(f.path); f.engine = new WorkspaceEngine(f.kernel);
  assert.deepEqual(f.engine.project(s.workspaceId), s);
  s = run(f.engine, s, { type: 'undoLayout' }); assert.equal(s.organization.mode, 'freeform'); assert.deepEqual(geometry(s), geometry(before));
  s = run(f.engine, s, { type: 'redoLayout' }); assert.equal(s.organization.mode, 'structured'); assert.deepEqual(geometry(s), geometry(before));
  const settings = previewLayout(s, { organization: { structured: { columnCount: 3, rowHeight: 120 } }, bounds });
  s = run(f.engine, s, { type: 'setOrganization', organization: { structured: { columnCount: 3, rowHeight: 120 } } });
  assert.deepEqual(geometry(s), geometry(before)); assert.deepEqual(s.blocks, settings.blocks); assert.deepEqual(s.organization.structured.order, order);
  for (const block of s.blocks) assert.equal(f.kernel.getResource(block.resourceId!).note.content, 'Exact original note');
});

test('later Structured drags snap only the active card and avoid collisions without packing neighbors, changing order, Vela or the camera', t => {
  const f = fixture(t); let s = add(f, f.state, { x: 77, y: 303, width: 200, height: 160 });
  s = add(f, s, { x: 700, y: 303, width: 200, height: 160, locked: true });
  s = run(f.engine, s, { type: 'setOrganization', organization: { mode: 'structured' } });
  const a = s.blocks.find(block => !block.locked)!, b = s.blocks.find(block => block.locked)!, before = s, update = { blockId: a.blockId, expectedVersion: a.version, presentation: { x: 315, y: 339 } };
  const predicted = previewLayout(s, { placements: [update], bounds });
  s = run(f.engine, s, { type: 'saveLayout', placements: [update] });
  assert.equal(s.blocks.find(block => block.blockId === a.blockId)!.x, 320); assert.equal(s.blocks.find(block => block.blockId === a.blockId)!.y, 336);
  assert.deepEqual(geometry(s), geometry({ ...s, blocks: predicted.blocks, presence: predicted.presence, viewport: predicted.viewport }));
  assert.deepEqual(s.blocks.find(block => block.blockId === b.blockId), b); assert.deepEqual(s.presence, before.presence); assert.deepEqual(s.viewport, before.viewport); assert.deepEqual(s.organization.structured.order, before.organization.structured.order);
  const target = s.blocks.find(block => block.blockId === a.blockId)!;
  const collision = previewLayout(s, { placements: [{ blockId: a.blockId, expectedVersion: target.version, presentation: { x: b.x + 5, y: b.y + 5 } }], bounds });
  s = run(f.engine, s, { type: 'moveBlock', blockId: a.blockId, x: b.x + 5, y: b.y + 5 });
  const moved = s.blocks.find(block => block.blockId === a.blockId)!;
  assert.deepEqual(geometry(s), geometry({ ...s, blocks: collision.blocks, presence: collision.presence, viewport: collision.viewport }));
  assert.equal(moved.x % STRUCTURED_GRID_SIZE, 0); assert.equal(moved.y % STRUCTURED_GRID_SIZE, 0); assert.equal(moved.width, a.width); assert.equal(moved.height, a.height);
  assert.deepEqual(s.blocks.find(block => block.blockId === b.blockId), b); assert.deepEqual(s.presence, before.presence);
  assert.equal(intersects(footprint({ ...moved, id: moved.blockId }), footprint({ ...b, id: b.blockId }), s.organization.gap), false);
});

test('full-layout payloads reserve unchanged targets before resolving a moved card', t => {
  const f = fixture(t); let s = add(f, f.state, { x: 77, y: 303, width: 200, height: 160 });
  s = add(f, s, { x: 700, y: 303, width: 200, height: 160 });
  s = run(f.engine, s, { type: 'setOrganization', organization: { mode: 'structured' } });
  const a = s.blocks.find(block => block.x === 77)!, b = s.blocks.find(block => block.x === 700)!;
  const placements = [
    { blockId: a.blockId, expectedVersion: a.version, presentation: { x: b.x + 5, y: b.y + 5, width: a.width, height: a.height } },
    { blockId: b.blockId, expectedVersion: b.version, presentation: { x: b.x, y: b.y, width: b.width, height: b.height } },
  ];
  const preview = previewLayout(s, { placements, bounds });
  s = run(f.engine, s, { type: 'saveLayout', placements });
  const moved = s.blocks.find(block => block.blockId === a.blockId)!, stationary = s.blocks.find(block => block.blockId === b.blockId)!;
  // The explicit payload retains the kernel's existing per-placement version
  // increment; organization policy must preserve all stationary presentation.
  assert.deepEqual(stationary, { ...b, version: stationary.version });
  assert.equal(intersects(footprint({ ...moved, id: a.blockId }), footprint({ ...stationary, id: b.blockId }), s.organization.gap), false);
  assert.deepEqual(geometry(s), geometry({ ...s, blocks: preview.blocks, presence: preview.presence, viewport: preview.viewport }));
});

test('Structured edge resizing preserves fixed off-grid edges, circle/aspect constraints and appearance-only geometry', t => {
  const f = fixture(t); let s = add(f, f.state, { x: 77, y: 403, width: 367, height: 291, shape: 'folio' });
  s = run(f.engine, s, { type: 'setOrganization', organization: { mode: 'structured' } });
  const block = s.blocks[0], update = { blockId: block.blockId, expectedVersion: block.version, presentation: { x: 51, width: 393 } };
  const predicted = previewLayout(s, { placements: [update], bounds }); s = run(f.engine, s, { type: 'saveLayout', placements: [update] });
  const resized = s.blocks[0]; assert.equal(resized.x, 48); assert.equal(resized.x + resized.width, block.x + block.width); assert.equal(resized.y, block.y); assert.equal(resized.height, block.height); assert.equal(resized.shape, 'folio'); assert.deepEqual(resized, { ...predicted.blocks[0], version: resized.version });
  const shape = geometry(s); s = run(f.engine, s, { type: 'setBlockPresentation', blockId: resized.blockId, patch: { materialVariant: 'soft' } });
  assert.deepEqual({ ...geometry(s), blocks: geometry(s).blocks.map(block => ({ ...block, materialVariant: 'default' })) }, shape);
  s = add(f, s, { x: 800, y: 403, width: 251, height: 251, shape: 'circle' });
  const circle = s.blocks.find(block => block.shape === 'circle')!, right = circle.x + circle.width, bottom = circle.y + circle.height;
  const request = { blockId: circle.blockId, expectedVersion: circle.version, presentation: { x: circle.x - 23, y: circle.y - 23, width: 274, height: 274 } };
  const preview = previewLayout(s, { placements: [request], bounds }); s = run(f.engine, s, { type: 'saveLayout', placements: [request] });
  const result = s.blocks.find(block => block.blockId === circle.blockId)!; assert.equal(result.width, result.height); assert.equal(result.x + result.width, right); assert.equal(result.y + result.height, bottom); assert.deepEqual(result, { ...preview.blocks.find(block => block.blockId === result.blockId)!, version: result.version });
});

test('Structured checkpoint/empty saves preserve manual geometry; Arrange/Resolve is explicit', t => {
  const f = fixture(t, true); let s = add(f, f.state, { x: 77, y: 403, width: 367, height: 291 });
  s = add(f, s, { x: 85, y: 411, width: 200, height: 160 }); s = run(f.engine, s, { type: 'setOrganization', organization: { mode: 'structured' } });
  const before = geometry(s), saved = run(f.engine, s, { type: 'checkpoint', name: 'Manual structured grid' });
  const empty = previewLayout(saved, { placements: [], bounds }); assert.deepEqual(empty.blocks, saved.blocks);
  s = run(f.engine, saved, { type: 'saveLayout', placements: [] }); assert.deepEqual(geometry(s), before);
  s = run(f.engine, s, { type: 'applyStructuredPreset', preset: 'development' }); assert.notDeepEqual(geometry(s), before);
  s = run(f.engine, s, { type: 'restoreCheckpoint', checkpointId: saved.checkpointId }); assert.deepEqual(geometry(s), before); assert.equal(s.organization.mode, 'structured');
  const arranged = run(f.engine, s, { type: 'resolveLayout' }); assert.notDeepEqual(geometry(arranged), before); assert.equal(arranged.blocks.length, s.blocks.length);
});

test('the existing Desktop adapter preserves the workspace on Structured selection and applies later grid geometry without resource edits', t => {
  const kernel = WorkspaceKernel.open(':memory:'); t.after(() => kernel.close());
  const desktop = new DesktopState(kernel, kernel.withTransaction(db => db));
  const apply = (command: DesktopCommand) => { desktop.apply(command, () => { throw Error('No provider creation'); }); return desktop.snapshot(() => ({ provider: 'local' as const, messages: [] })); };
  let s = apply({ type: 'createWorkspace', title: 'Synthetic adapter grid', projectId: null }); const workspaceId = s.activeWorkspaceId!;
  s = apply({ type: 'setOrganization', workspaceId, expectedOrganizationRevision: s.organization!.revision, organization: { mode: 'freeform' } });
  s = apply({ type: 'createResource', kind: 'note', title: 'Synthetic real Note', workspaceId });
  const block = s.blocks[0]; s = apply({ type: 'geometry', blockId: block.id, expectedVersion: block.version, placement: { x: 77, y: 403, width: 367, height: 291, z: block.z }, shape: 'folio' });
  const before = structuredClone(s);
  s = apply({ type: 'setOrganization', workspaceId, expectedOrganizationRevision: s.organization!.revision, organization: { mode: 'structured' } });
  assert.deepEqual(s.blocks, before.blocks); assert.deepEqual(s.viewport, before.viewport); assert.deepEqual(s.presence, before.presence); assert.deepEqual(s.resources, before.resources); assert.deepEqual(s.relationships, before.relationships);
  const card = s.blocks[0]; s = apply({ type: 'geometry', blockId: card.id, expectedVersion: card.version, placement: { x: 185, y: 451, width: card.width, height: card.height, z: card.z }, shape: card.shape });
  assert.equal(s.blocks[0].x, 192); assert.equal(s.blocks[0].y, 448); assert.deepEqual(s.resources, before.resources); assert.deepEqual(s.viewport, before.viewport); assert.deepEqual(s.presence, before.presence);
  const review = { type: 'optimizeLayout' as const, workspaceId, movableBlockIds: [card.id],
    expectedLayoutVersion: s.layoutVersion, bounds: { x: 700, y: 350, width: 600, height: 500 } };
  assert.throws(() => apply({ ...review, bounds: undefined }), /optimization_review_required/);
  assert.throws(() => apply({ ...review, expectedLayoutVersion: undefined }), /optimization_review_required/);
  const optimized = apply(review);
  assert.ok(optimized.blocks[0].x >= review.bounds.x);
  assert.deepEqual(optimized.resources, s.resources);
  assert.deepEqual(optimized.viewport, s.viewport);
  assert.deepEqual(optimized.presence, s.presence);
  assert.throws(() => apply(review), /CONFLICT/);
  assert.equal(apply({ type: 'undo' }).blocks[0].x, s.blocks[0].x);
});
