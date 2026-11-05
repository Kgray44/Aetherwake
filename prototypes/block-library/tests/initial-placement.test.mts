import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { BackendCore } from '../../integrated-backend/src/core.mts';
import { footprint, intersects } from '../../workspace-engine/collisions.mts';

function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), 'aerynth-initial-placement-')),
    path = join(dir, 'canonical.sqlite');
  let core = new BackendCore({ path, provider: 'fixture', contentPolicy: 'synthetic-only' });
  t.after(async () => {
    await core.command('close', {});
    const part = relative(resolve(tmpdir()), resolve(dir));
    assert.ok(part.startsWith('aerynth-initial-placement-') && !part.startsWith('..') && !isAbsolute(part));
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    get core() { return core; },
    async reopen() {
      await core.command('close', {});
      core = new BackendCore({ path, provider: 'fixture', contentPolicy: 'synthetic-only' });
    },
  };
}
const library = async (core: BackendCore, name: any, input: any): Promise<any> => (await core.command('library', { name, input })).result;
const box = (value: any) => footprint({ ...value, id: value.id ?? 'fixture', locked: value.locked ?? false });

test('actual Core attaches a Chat clear of Collection Browser, overlapping fixed cards and Vela; retry, undo/redo and restart retain one exact placement', async t => {
  const f = fixture(t);
  let state = await f.core.command('desktop', { type: 'createWorkspace', title: 'Synthetic initial placement', projectId: null });
  const workspaceId = state.activeWorkspaceId!;
  state = await f.core.command('desktop', { type: 'setOrganization', workspaceId, expectedOrganizationRevision: state.organization!.revision, organization: { mode: 'freeform' } });
  state = await f.core.command('desktop', { type: 'setPresence', workspaceId, expectedVersion: state.presence!.version, placement: { x: 650, y: 180 } });
  await f.core.command('conversation', { name: 'organize', input: { type: 'createCollection', title: 'Synthetic collection', projectId: null } });
  const collections: any = await f.core.command('conversation', { name: 'collections', input: {} });
  await library(f.core, 'createSubjectBlock', { commandId: randomUUID(), workspaceId, expectedLayoutVersion: state.layoutVersion, kind: 'collection_browser', subject: { kind: 'collection', collectionId: collections[0].id }, presentation: { x: 90, y: 160, locked: true } });
  state = await f.core.command('desktop', { type: 'snapshot' });
  await library(f.core, 'createBlock', { commandId: randomUUID(), workspaceId, expectedLayoutVersion: state.layoutVersion, kind: 'note', title: 'Synthetic intentionally overlapping note', presentation: { x: 90, y: 160, width: 160, height: 150, rotation: 27, locked: true } });
  const local = await f.core.command('createConversation', { title: 'Synthetic attached chat', providerId: 'local', commandId: randomUUID() });
  const before = await f.core.command('desktop', { type: 'snapshot' }),
    bounds = { x: 20, y: 170, width: 1240, height: 750 },
    input = { commandId: randomUUID(), workspaceId, expectedLayoutVersion: before.layoutVersion, kind: 'conversation', resourceId: local.resourceId, expectedResourceVersion: before.resources.find(r => r.id === local.resourceId)!.version, bounds };
  assert.equal(intersects(box(before.blocks[0]), box(before.blocks[1])), true, 'Freeform intentional overlap is part of the fixture');
  const created = await library(f.core, 'attachBlock', input),
    attached = await f.core.command('desktop', { type: 'snapshot' }),
    placement = attached.blocks.find(b => b.id === created.placementId)!;
  assert.ok(placement);
  assert.ok(placement.x >= bounds.x && placement.y >= bounds.y && placement.x + placement.width <= bounds.x + bounds.width && placement.y + placement.height <= bounds.y + bounds.height);
  assert.deepEqual(attached.blocks.filter(b => b.id !== placement.id), before.blocks);
  assert.deepEqual(attached.presence, before.presence);
  for (const occupied of [...before.blocks, before.presence!]) assert.equal(intersects(box(placement), box(occupied)), false);
  assert.deepEqual([placement.width, placement.height], [380, 600]);
  assert.equal(placement.resource_id, local.resourceId);
  assert.equal(attached.resources.length, before.resources.length);
  assert.deepEqual(await library(f.core, 'attachBlock', input), created);
  await assert.rejects(library(f.core, 'attachBlock', { ...input, bounds: { ...bounds, width: bounds.width - 1 } }), /idempotency_conflict/);
  await assert.rejects(library(f.core, 'attachBlock', { ...input, commandId: randomUUID() }), /layout_version_conflict/);
  assert.deepEqual((await f.core.command('desktop', { type: 'snapshot' })).blocks, attached.blocks);
  await f.reopen();
  assert.deepEqual((await f.core.command('desktop', { type: 'snapshot' })).blocks, attached.blocks);
  assert.deepEqual(await library(f.core, 'attachBlock', input), created);
  const undo = await f.core.command('desktop', { type: 'undo' });
  assert.deepEqual(undo.blocks.map(b => b.id).sort(), before.blocks.map(b => b.id).sort());
  assert.equal(undo.resources.length, attached.resources.length);
  const redo = await f.core.command('desktop', { type: 'redo' });
  assert.deepEqual(redo.blocks.map(b => ({ id: b.id, x: b.x, y: b.y, width: b.width, height: b.height })), attached.blocks.map(b => ({ id: b.id, x: b.x, y: b.y, width: b.width, height: b.height })));
});

test('actual Core applies live bounds to new resources/subjects and refuses malformed placement context without writes', async t => {
  const f = fixture(t);
  let state = await f.core.command('desktop', { type: 'createWorkspace', title: 'Synthetic bounded creation', projectId: null });
  const workspaceId = state.activeWorkspaceId!, bounds = { x: 700, y: 400, width: 1400, height: 1000 };
  state = await f.core.command('desktop', { type: 'setOrganization', workspaceId, expectedOrganizationRevision: state.organization!.revision, organization: { mode: 'freeform' } });
  for (const name of ['createBlock', 'createSubjectBlock'] as const) {
    const base = { commandId: randomUUID(), workspaceId, expectedLayoutVersion: state.layoutVersion, bounds },
      input = name === 'createBlock' ? { ...base, kind: 'task', title: 'Synthetic bounded task' } : { ...base, kind: 'resource_browser', subject: { kind: 'resource-query', projectId: null, query: '' } };
    for (const invalid of [null, [], { ...bounds, width: 0 }, { ...bounds, z: 1 }, { ...bounds, x: Infinity }]) {
      await assert.rejects(library(f.core, name, { ...input, bounds: invalid }), /invalid_placement_bounds|INVALID/);
      assert.deepEqual(await f.core.command('desktop', { type: 'snapshot' }), state);
    }
    const created = await library(f.core, name, input);
    state = await f.core.command('desktop', { type: 'snapshot' });
    const placed = state.blocks.find(b => b.id === created.placementId)!;
    assert.ok(placed.x >= bounds.x && placed.y >= bounds.y && placed.x + placed.width <= bounds.x + bounds.width && placed.y + placed.height <= bounds.y + bounds.height);
  }
});
