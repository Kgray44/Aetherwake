import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { WorkspaceKernel } from '../../workspace-kernel/kernel.mts';
import { WorkspaceEngine } from '../engine.mts';
import type { Command, WorkspaceProjection } from '../contracts.mts';
const run = (engine: WorkspaceEngine, state: WorkspaceProjection, action: object) => engine.execute({ commandId: randomUUID(), workspaceId: state.workspaceId, expectedRevision: state.revision, ...action } as Command);
const independent = (state: WorkspaceProjection) => ({ viewport: state.viewport, organization: state.organization, presence: state.presence, blocks: state.blocks.map(({ minimized, contentMode, version, ...block }) => block) });

for (const mode of ['fluid', 'freeform', 'structured'] as const) test(mode + ' minimize/restore is one reversible canonical flag change, never collision resolution or camera/presence movement', t => {
  const kernel = WorkspaceKernel.open(':memory:'); t.after(() => kernel.close()); const engine = new WorkspaceEngine(kernel);
  let state = engine.createWorkspace('Synthetic minimized ' + mode);
  state = run(engine, state, { type: 'setOrganization', organization: { mode } });
  const note = kernel.createNote('Synthetic shared Note', 'Exact retained canonical content');
  // Explicitly retained old overlap, including Vela. Minimize must not repair it.
  const first = kernel.attachBlock(state.workspaceId, note.id, { x: 120, y: 200, width: 430, height: 300, z: 7 });
  kernel.attachBlock(state.workspaceId, note.id, { x: 130, y: 220, width: 300, height: 400, z: 8 });
  state = engine.project(state.workspaceId); const before = structuredClone(state), old = state.blocks.find(b => b.blockId === first.id)!;
  const command: Command = { commandId: randomUUID(), type: 'setBlockMinimized', workspaceId: state.workspaceId, expectedRevision: state.revision, blockId: old.blockId, expectedVersion: old.version, minimized: true };
  state = engine.execute(command); const minimized = state.blocks.find(b => b.blockId === old.blockId)!;
  assert.equal(minimized.minimized, true); assert.equal(minimized.contentMode, 'summary'); assert.equal(minimized.version, old.version + 1);
  assert.deepEqual(independent(state), independent(before)); assert.equal(state.blocks.find(b => b.blockId !== old.blockId)!.minimized, false);
  assert.deepEqual(engine.execute(command), state, 'An exact retry returns its persistent result');
  assert.throws(() => engine.execute({ ...command, minimized: false }), (e: any) => e.code === 'COMMAND_ID_REUSED');
  const stable = state; state = run(engine, state, { type: 'setBlockMinimized', blockId: minimized.blockId, expectedVersion: minimized.version, minimized: true });
  assert.deepEqual(state, stable, 'An unchanged flag must not bump versions/history or emit a layout change');
  state = run(engine, state, { type: 'undoLayout' }); assert.equal(state.blocks.find(b => b.blockId === old.blockId)!.minimized, false);
  state = run(engine, state, { type: 'redoLayout' }); assert.equal(state.blocks.find(b => b.blockId === old.blockId)!.minimized, true);
  const current = state.blocks.find(b => b.blockId === old.blockId)!;
  state = run(engine, state, { type: 'setBlockMinimized', blockId: current.blockId, expectedVersion: current.version, minimized: false });
  assert.equal(state.blocks.find(b => b.blockId === old.blockId)!.minimized, false);
  assert.deepEqual(state.blocks.map(b => [b.blockId,b.resourceId,b.x,b.y,b.width,b.height,b.zIndex,b.shape,b.rotation,b.locked]), before.blocks.map(b => [b.blockId,b.resourceId,b.x,b.y,b.width,b.height,b.zIndex,b.shape,b.rotation,b.locked]));
  assert.deepEqual(kernel.getResource(note.id).note.content, 'Exact retained canonical content');
});

test('minimize rejects stale layout/block versions, invalid Boolean, missing/foreign/system presence and locked targets without mutation', t => {
  const kernel = WorkspaceKernel.open(':memory:'); t.after(() => kernel.close()); const engine = new WorkspaceEngine(kernel);
  let state = engine.createWorkspace('Synthetic fenced minimize'); state = run(engine, state, { type: 'createBlock', resource: { kind: 'note', title: 'Synthetic', content: 'Retained' } });
  const block = state.blocks[0], original = structuredClone(state);
  const base = { type: 'setBlockMinimized', blockId: block.blockId, expectedVersion: block.version, minimized: true };
  for (const patch of [{ expectedVersion: block.version + 1 }, { expectedVersion: 0 }, { minimized: 'true' }, { blockId: 'system:vela' }, { blockId: 'missing' }]) {
    assert.throws(() => run(engine, state, { ...base, ...patch })); assert.deepEqual(engine.project(state.workspaceId), original);
  }
  assert.throws(() => engine.execute({ commandId: randomUUID(), workspaceId: state.workspaceId, expectedRevision: state.revision + 1, ...base } as Command), (e: any) => e.code === 'CONFLICT');
  const other = engine.createWorkspace('Synthetic other'); assert.throws(() => run(engine, other, base), (e: any) => e.code === 'NOT_FOUND');
  state = run(engine, state, { type: 'setBlockLock', blockId: block.blockId, locked: true }); const locked = structuredClone(state);
  assert.throws(() => run(engine, state, { ...base, expectedVersion: state.blocks[0].version }), (e: any) => e.code === 'LOCKED'); assert.deepEqual(engine.project(state.workspaceId), locked);
  state = run(engine, state, { type: 'setBlockLock', blockId: block.blockId, locked: false });
  kernel.setResourceArchived(block.resourceId!, true, 1); state = engine.project(state.workspaceId); const unavailable = structuredClone(state);
  assert.throws(() => run(engine, state, { ...base, expectedVersion: state.blocks[0].version }), (e: any) => e.code === 'SUBJECT_UNAVAILABLE'); assert.deepEqual(engine.project(state.workspaceId), unavailable);

});

test('same canonical minimized flag and undo/checkpoint state survive actual SQLite close/reopen for a subject placement', t => {
  const dir = mkdtempSync(join(tmpdir(), 'aerynth-minimized-')), path = join(dir, 'fixture.sqlite');
  let kernel = WorkspaceKernel.open(path), engine = new WorkspaceEngine(kernel, { allowSubjectAttachment: () => true });
  let opened = true;
  t.after(() => { if (opened) kernel.close(); const part = relative(resolve(tmpdir()), resolve(dir)); assert(part.startsWith('aerynth-minimized-') && !part.startsWith('..') && !isAbsolute(part)); rmSync(dir, { recursive: true, force: true }); });
  const project = kernel.createProject('Synthetic canonical project'); let state = engine.createWorkspace('Synthetic subject minimize', project.id);
  state = run(engine, state, { type: 'attachSubject', subject: { kind: 'project', projectId: project.id } });
  const before = state.blocks[0]; state = run(engine, state, { type: 'setBlockMinimized', blockId: before.blockId, expectedVersion: before.version, minimized: true });
  const checkpoint = run(engine, state, { type: 'checkpoint', name: 'Synthetic minimized checkpoint' });
  const { checkpointId, ...saved } = structuredClone(checkpoint); kernel.close(); opened = false;
  kernel = WorkspaceKernel.open(path); opened = true; engine = new WorkspaceEngine(kernel, { allowSubjectAttachment: () => true });
  state = engine.project(saved.workspaceId); assert.deepEqual(state, saved);
  state = run(engine, state, { type: 'undoLayout' }); assert.equal(state.blocks[0].minimized, false); assert.equal(state.blocks[0].blockId, before.blockId); assert.deepEqual(state.blocks[0].subject, before.subject);
  state = run(engine, state, { type: 'restoreCheckpoint', checkpointId: checkpoint.checkpointId }); assert.equal(state.blocks[0].minimized, true);
  assert.equal(kernel.subjectState({ kind: 'project', projectId: project.id }), 'active');
});
