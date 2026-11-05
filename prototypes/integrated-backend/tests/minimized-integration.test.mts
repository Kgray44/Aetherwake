import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { Backend } from '../src/service.mts';
import { DesktopState } from '../src/desktop.mts';
import { WorkspaceKernel } from '../../workspace-kernel/kernel.mts';
import type { DesktopCommand, DesktopSnapshot } from '../../application-contract/contracts.ts';

const retained = (s: DesktopSnapshot) => ({
  resources: s.resources, relationships: s.relationships, viewport: s.viewport,
  organization: s.organization, presence: s.presence, navigation: s.navigation,
  activeWorkspaceId: s.activeWorkspaceId,
  blocks: s.blocks.map(({ minimized, version, contentMode, ...block }) => block),
});
const noConversation = () => { throw Error('No conversation creation expected'); };

test('trusted desktop minimize delegates one canonical flag, preserves independent placements and camera, and restores after SQLite reopen', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aerynth-minimized-adapter-'));
  const options = { path: join(dir, 'fixture.sqlite'), provider: 'fixture' as const, contentPolicy: 'synthetic-only' as const };
  let backend = new Backend(options), opened = true;
  const call = (command: DesktopCommand) => backend.call('desktop', command);
  try {
    let s = await call({ type: 'createWorkspace', title: 'Synthetic minimized adapter', projectId: null });
    const workspaceId = s.activeWorkspaceId!;
    s = await call({ type: 'createResource', kind: 'note', title: 'Synthetic retained Note', workspaceId });
    const resourceId = s.blocks[0].resource_id!;
    s = await call({ type: 'content', resourceId, expectedVersion: s.resources[0].version, content: 'Exact authored text retained' });
    s = await call({ type: 'attach', resourceId, workspaceId });
    s = await call({ type: 'setViewport', workspaceId, viewport: { x: -123.75, y: 81.25, zoom: .6 } });
    const original = s, first = s.blocks[0];
    s = await call({ type: 'setBlockMinimized', workspaceId, blockId: first.id, expectedVersion: first.version, expectedLayoutVersion: s.layoutVersion, minimized: true });
    assert.equal(s.blocks.find(b => b.id === first.id)!.minimized, true);
    assert.equal(s.blocks.find(b => b.id !== first.id)!.minimized, false);
    assert.equal(s.blocks.find(b => b.id === first.id)!.version, first.version + 1);
    assert.deepEqual(retained(s), retained(original));
    const minimized = s;
    s = await call({ type: 'setBlockMinimized', workspaceId, blockId: first.id, expectedVersion: s.blocks.find(b => b.id === first.id)!.version, expectedLayoutVersion: s.layoutVersion, minimized: true });
    assert.deepEqual(s, minimized, 'Unchanged flag is also a desktop/session/event no-op');
    s = await call({ type: 'undo' }); assert.equal(s.blocks.find(b => b.id === first.id)!.minimized, false);
    s = await call({ type: 'redo' }); assert.equal(s.blocks.find(b => b.id === first.id)!.minimized, true);
    await backend.close(); opened = false;
    backend = new Backend(options); opened = true;
    assert.deepEqual(await call({ type: 'snapshot' }), s, 'A separate worker and SQLite connection restore the same canonical projection');
    const beforeRestore = s, current = s.blocks.find(b => b.id === first.id)!;
    s = await call({ type: 'setBlockMinimized', workspaceId, blockId: current.id, expectedVersion: current.version, expectedLayoutVersion: s.layoutVersion, minimized: false });
    assert.equal(s.blocks.find(b => b.id === first.id)!.minimized, false);
    assert.deepEqual(retained(s), retained(beforeRestore));
    assert.deepEqual(retained(s).blocks, retained(original).blocks);
  } finally {
    if (opened) await backend.close();
    const part = relative(resolve(tmpdir()), resolve(dir)); assert(part.startsWith('aerynth-minimized-adapter-') && !part.startsWith('..') && !isAbsolute(part));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('desktop minimize fails closed on malformed/stale versions, inactive workspace context, foreign binding, locked and archived resources', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aerynth-minimized-fences-'));
  const backend = new Backend({ path: join(dir, 'fixture.sqlite'), provider: 'fixture', contentPolicy: 'synthetic-only' });
  const call = (command: DesktopCommand) => backend.call('desktop', command);
  try {
    let s = await call({ type: 'createWorkspace', title: 'Synthetic first', projectId: null }); const firstWorkspace = s.activeWorkspaceId!;
    s = await call({ type: 'createResource', kind: 'task', title: 'Synthetic Task', workspaceId: firstWorkspace }); const first = s.blocks[0];
    s = await call({ type: 'createWorkspace', title: 'Synthetic current', projectId: null }); const workspaceId = s.activeWorkspaceId!;
    s = await call({ type: 'createResource', kind: 'note', title: 'Synthetic Note', workspaceId });
    const block = s.blocks[0], base: DesktopCommand = { type: 'setBlockMinimized', workspaceId, blockId: block.id, expectedVersion: block.version, expectedLayoutVersion: s.layoutVersion, minimized: true };
    for (const command of [
      { ...base, minimized: 'true' }, { ...base, expectedVersion: 0 }, { ...base, expectedVersion: block.version + 1 },
      { ...base, expectedLayoutVersion: s.layoutVersion + 1 }, { ...base, blockId: 'system:vela' },
      { ...base, blockId: first.id, expectedVersion: first.version }, { ...base, workspaceId: firstWorkspace, blockId: first.id, expectedVersion: first.version },
    ]) {
      await assert.rejects(call(command as DesktopCommand)); assert.deepEqual(await call({ type: 'snapshot' }), s);
    }
    s = await call({ type: 'navigate', target: { kind: 'constellation', projectId: null } });
    await assert.rejects(call(base), /stale_workspace_context/); assert.deepEqual(await call({ type: 'snapshot' }), s);
    s = await call({ type: 'navigate', target: { kind: 'workspace', workspaceId } });
    s = await call({ type: 'lockBlock', blockId: block.id, expectedVersion: block.version, locked: true });
    await assert.rejects(call({ ...base, expectedLayoutVersion: s.layoutVersion, expectedVersion: s.blocks[0].version }), /LOCKED/); assert.deepEqual(await call({ type: 'snapshot' }), s);
    s = await call({ type: 'lockBlock', blockId: block.id, expectedVersion: s.blocks[0].version, locked: false });
    s = await call({ type: 'archiveSubject', kind: 'resource', id: block.resource_id!, expectedVersion: s.resources.find(r => r.id === block.resource_id)!.version, archived: true });
    await assert.rejects(call({ ...base, expectedLayoutVersion: s.layoutVersion, expectedVersion: s.blocks[0].version }), /SUBJECT_UNAVAILABLE/); assert.deepEqual(await call({ type: 'snapshot' }), s);
  } finally {
    await backend.close();
    const part = relative(resolve(tmpdir()), resolve(dir)); assert(part.startsWith('aerynth-minimized-fences-') && !part.startsWith('..') && !isAbsolute(part));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('same desktop action supports typed project subjects and preserves their unavailable recovery state without fake resource IDs', () => {
  const kernel = WorkspaceKernel.open(':memory:');
  try {
    const desktop = new DesktopState(kernel, kernel.withTransaction(db => db), { allowSubjectAttachment: () => true });
    const bridge = desktop.nativeBlockServices(), project = kernel.createProject('Synthetic subject');
    let projection = bridge.engine.createWorkspace('Synthetic subject workspace'); bridge.navigateWorkspace(projection.workspaceId);
    projection = bridge.engine.execute({ type: 'attachSubject', subject: { kind: 'project', projectId: project.id }, commandId: 'synthetic-minimized-subject', workspaceId: projection.workspaceId, expectedRevision: projection.revision });
    const snapshot = () => desktop.snapshot(() => ({ provider: 'local', messages: [] }));
    let s = snapshot(); const block = s.blocks[0];
    desktop.apply({ type: 'setBlockMinimized', workspaceId: projection.workspaceId, blockId: block.id, expectedVersion: block.version, expectedLayoutVersion: s.layoutVersion, minimized: true }, noConversation);
    s = snapshot(); assert.equal(s.blocks[0].minimized, true); assert.equal(s.blocks[0].resource_id, undefined); assert.deepEqual(s.blocks[0].subject, block.subject);
    kernel.setProjectArchived(project.id, true, 1); s = snapshot();
    assert.throws(() => desktop.apply({ type: 'setBlockMinimized', workspaceId: projection.workspaceId, blockId: block.id, expectedVersion: s.blocks[0].version, expectedLayoutVersion: s.layoutVersion, minimized: false }, noConversation), /SUBJECT_UNAVAILABLE/);
    assert.deepEqual(snapshot(), s); kernel.assertIntegrity();
  } finally { kernel.close(); }
});
