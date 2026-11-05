import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BackendCore } from '../src/core.mts';
import type { FolderBrowseResponse } from '../../application-contract/folder.ts';
async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), 'aerynth-folder-core-')), selected = path.join(root, 'Neutral Folder'); await mkdir(selected);
  const native = { secrets: { available: async () => false, seal: async () => { throw Error('unused'); }, open: async () => { throw Error('unused'); } } };
  const core = new BackendCore({ path: path.join(root, 'canonical.sqlite'), provider: 'fixture', contentPolicy: 'synthetic-only', nativeMedia: true }, () => {}, native, undefined,
    { fetch: async () => { throw Error('Folder browsing must never dispatch a provider'); } });
  t.after(async () => { await core.command('close', {}).catch(() => {}); const relative = path.relative(tmpdir(), root);
    assert.ok(relative.startsWith('aerynth-folder-core-') && !relative.includes(path.sep)); await rm(root, { recursive: true, force: true }); });
  const pick = async () => { const desktop = await core.command('desktop', { type: 'createWorkspace', title: 'Neutral folder validation', projectId: null });
    const result = await core.command('velaSourcesPickNative', { commandId: randomUUID(), selection: { kind: 'folder', path: selected }, destination: 'workspace',
      workspaceId: desktop.activeWorkspaceId!, expectedLayoutVersion: desktop.layoutVersion }); return result.resources[0]; };
  return { core, selected, pick };
}
test('actual Core caps oversized metadata listings and binds every continuation to its canonical folder', async t => {
  const f = await fixture(t);
  for (let start = 0; start < 2051; start += 32) await Promise.all(Array.from({ length: Math.min(32, 2051 - start) }, (_, i) => mkdir(path.join(f.selected, 'Entry-' + String(start + i).padStart(4, '0')))));
  const folder = await f.pick(), list = (cursor?: string) => f.core.command('folders', { type: 'list', resourceId: folder.id, ...(cursor ? { cursor } : {}) }) as Promise<FolderBrowseResponse>;
  const first = await list(); assert.equal(first.entries.length, 64); assert.equal(first.truncated, true); assert.ok(first.cursor);
  const second = await list(first.cursor!); assert.equal(second.entries.length, 64); assert.equal(second.observedRevision, first.observedRevision);
  assert.equal(new Set([...first.entries, ...second.entries].map(e => e.name)).size, 128);
  const snapshot = await f.core.command('desktop', { type: 'snapshot' }); assert.equal(snapshot.resources.length, 1); assert.equal(snapshot.blocks.length, 1);
  assert.equal(snapshot.resources[0].kind, 'folder'); assert.equal((f.core as any).db.prepare('SELECT count(*) AS n FROM media_sources').get().n, 0);
  assert.ok(!JSON.stringify(first).includes(f.selected)); assert.doesNotMatch(JSON.stringify(first), /sourceGrantId|selected_path|content/);
  for (const forged of [{ type: 'list', resourceId: folder.id, path: f.selected }, { type: 'list', resourceId: folder.id, sourceGrantId: 'forged' },
    { type: 'describe', resourceId: folder.id, cursor: first.cursor }, { type: 'list', resourceId: folder.id, entryId: '..' }])
    await assert.rejects(f.core.command('folders', forged as any), /invalid_folder_request/);
  assert.equal((await f.core.command('providerActivity', {})).providerRequests, 0); assert.equal((await f.core.command('providerActivity', {})).codexConnections, 0);
});
test('archiving during an actual Core listing prevents late metadata and disables native target resolution', async t => {
  const f = await fixture(t); await mkdir(path.join(f.selected, 'Child')); const folder = await f.pick();
  const pending = f.core.command('folders', { type: 'list', resourceId: folder.id }); pending.catch(() => {});
  await f.core.command('desktop', { type: 'archiveSubject', kind: 'resource', id: folder.id, expectedVersion: folder.version, archived: true });
  await assert.rejects(pending, /folder_source_unavailable/);
  await assert.rejects(f.core.command('folderOpenNative', { resourceId: folder.id }), /folder_source_unavailable/);
  await assert.rejects(f.core.command('folders', { type: 'describe', resourceId: folder.id }), /folder_source_unavailable/);
  assert.equal((await f.core.command('providerActivity', {})).providerRequests, 0);
});
