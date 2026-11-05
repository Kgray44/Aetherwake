import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DesktopState } from '../../integrated-backend/src/desktop.mts';
import type { DesktopCommand, DesktopSnapshot } from '../../application-contract/contracts.ts';
import { WorkspaceKernel } from '../../workspace-kernel/kernel.mts';
import { WorkspaceEngine } from '../engine.mts';

const placements = (state: DesktopSnapshot) => state.blocks.map(({ version: _version, ...block }) => block);

test('named Desktop layouts restore the selected durable arrangement, keep current content and undo cleanly', () => {
  const directory = mkdtempSync(join(tmpdir(), 'aerynth-named-layouts-'));
  const path = join(directory, 'canonical.sqlite');
  let kernel = WorkspaceKernel.open(path);
  let desktop = new DesktopState(kernel, kernel.withTransaction(db => db));
  const snapshot = () => desktop.snapshot(() => ({ provider: 'local', messages: [] }));
  const apply = (command: DesktopCommand) => {
    kernel.withTransaction(() => desktop.apply(command, () => { throw Error('Unexpected conversation creation'); }));
    return snapshot();
  };
  try {
    let state = apply({ type: 'createWorkspace', title: 'Layout review fixture', projectId: null });
    const workspaceId = state.activeWorkspaceId!;
    state = apply({ type: 'setOrganization', workspaceId, expectedOrganizationRevision: state.organization!.revision, organization: { mode: 'freeform' } });
    state = apply({ type: 'createResource', workspaceId, kind: 'note', title: 'Persistent source' });
    const sourceId = state.blocks[0].resource_id!;
    state = apply({ type: 'createResource', workspaceId, kind: 'note', title: 'Second source' });
    for (const block of state.blocks) {
      state = apply({ type: 'geometry', blockId: block.id, expectedVersion: block.version, shape: block.shape,
        placement: { x: 150, y: 210, width: 240, height: 160, z: block.z } });
    }
    state = apply({ type: 'setViewport', workspaceId, viewport: { x: 14, y: -23, zoom: .85 } });
    const first = state;
    const save = { type: 'saveNamedLayout' as const, workspaceId, name: '  Review  ', expectedLayoutVersion: state.layoutVersion };
    state = apply(save);
    const review = state.savedLayouts![0];
    assert.equal(review.name, 'Review');
    assert.equal(state.savedLayouts!.length, 1);
    assert.deepEqual(state.blocks, first.blocks);
    assert.throws(() => apply(save), /CONFLICT/);
    assert.throws(() => apply({ ...save, name: 'review', expectedLayoutVersion: state.layoutVersion }), /CHECKPOINT_NAME_CONFLICT/);
    assert.deepEqual(snapshot().savedLayouts, [review]);

    state = apply({ type: 'setOrganization', workspaceId, expectedOrganizationRevision: state.organization!.revision, organization: { mode: 'structured' } });
    const manual = state.blocks.find(block => block.resource_id === sourceId)!;
    state = apply({ type: 'geometry', blockId: manual.id, expectedVersion: manual.version, shape: manual.shape,
      placement: { x: 240, y: 420, width: manual.width, height: manual.height, z: manual.z } });
    state = apply({ type: 'createResource', workspaceId, kind: 'note', title: 'Added after first save' });
    const laterId = state.resources.find(resource => resource.title === 'Added after first save')!.id;
    state = apply({ type: 'setViewport', workspaceId, viewport: { x: -31, y: 40, zoom: .95 } });
    state = apply({ type: 'saveNamedLayout', workspaceId, name: 'Current work', expectedLayoutVersion: state.layoutVersion });
    assert.equal(state.savedLayouts!.length, 2);
    state = apply({ type: 'content', resourceId: sourceId, expectedVersion: state.resources.find(resource => resource.id === sourceId)!.version,
      content: 'Latest canonical content' });
    const second = state;

    kernel.close();
    kernel = WorkspaceKernel.open(path);
    desktop = new DesktopState(kernel, kernel.withTransaction(db => db));
    assert.deepEqual(snapshot().savedLayouts, second.savedLayouts);
    const restore = { type: 'restoreNamedLayout' as const, workspaceId, checkpointId: review.id, expectedLayoutVersion: second.layoutVersion };
    assert.throws(() => apply({ ...restore, expectedLayoutVersion: first.layoutVersion }), /CONFLICT/);
    kernel.withTransaction(db => db.exec(`CREATE TEMP TRIGGER fail_named_layout_restore BEFORE INSERT ON blocks
      BEGIN SELECT RAISE(ABORT, 'synthetic_named_layout_write_failure'); END`));
    try {
      assert.throws(() => apply(restore), /synthetic_named_layout_write_failure/);
      assert.deepEqual(snapshot().blocks, second.blocks);
      assert.equal(snapshot().layoutVersion, second.layoutVersion);
    } finally { kernel.withTransaction(db => db.exec('DROP TRIGGER fail_named_layout_restore')); }
    const restored = apply(restore);
    assert.deepEqual(placements(restored), placements(first));
    assert.deepEqual(restored.viewport, first.viewport);
    assert.equal(restored.organization?.mode, 'freeform');
    assert.ok(restored.resources.some(resource => resource.id === laterId));
    assert.equal(kernel.getResource(sourceId).note.content, 'Latest canonical content');
    const undone = apply({ type: 'undo' });
    assert.deepEqual(placements(undone), placements(second));
    assert.deepEqual(undone.viewport, second.viewport);
    assert.equal(undone.organization?.mode, 'structured');
    assert.equal(kernel.getResource(sourceId).note.content, 'Latest canonical content');

    const other = apply({ type: 'createWorkspace', title: 'Other layout scope', projectId: null });
    assert.deepEqual(other.savedLayouts, []);
    assert.throws(() => apply(restore), /workspace_changed/);
    assert.throws(() => apply({ ...restore, workspaceId: other.activeWorkspaceId!, expectedLayoutVersion: other.layoutVersion }), /NOT_FOUND/);
    assert.deepEqual(snapshot().blocks, []);
  } finally {
    kernel.close();
    for (const suffix of ['', '-journal', '-shm', '-wal']) rmSync(path + suffix, { force: true });
    rmdirSync(directory);
  }
});

test('exact named restore keeps previously saved Fluid geometry even when legacy cards overlap', () => {
  const kernel = WorkspaceKernel.open(':memory:');
  try {
    const engine = new WorkspaceEngine(kernel);
    const { workspaceId } = engine.createWorkspace('Legacy Fluid geometry');
    for (const z of [0, 1]) {
      const source = kernel.createNote('Legacy note ' + z, 'Preserved content', null);
      kernel.attachBlock(workspaceId, source.id, { x: 80, y: 220, width: 200, height: 140, z });
    }
    const before = engine.project(workspaceId);
    const saved = engine.execute({ type: 'checkpoint', name: 'Legacy layout', uniqueName: true,
      workspaceId, expectedRevision: before.revision, commandId: 'save-fluid-layout' });
    const resolved = engine.execute({ type: 'resolveLayout', workspaceId, expectedRevision: saved.revision, commandId: 'resolve-fluid-layout' });
    assert.ok(resolved.blocks.some(block => block.x !== 80 || block.y !== 220));
    const restored = engine.execute({ type: 'restoreCheckpoint', exact: true, checkpointId: saved.checkpointId!,
      workspaceId, expectedRevision: resolved.revision, commandId: 'restore-fluid-layout' });
    assert.ok(restored.blocks.every(block => block.x === 80 && block.y === 220));
    assert.equal(restored.organization.mode, 'fluid');
  } finally { kernel.close(); }
});
