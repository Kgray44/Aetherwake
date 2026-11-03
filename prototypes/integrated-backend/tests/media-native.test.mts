import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { BackendCore } from '../src/core.mts';

test('selected local media attaches and reopens with safe metadata, range and revision fences', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'aerynth-media-native-'));
  const path = join(directory, 'canonical.sqlite'), selected = join(directory, 'original.txt');
  writeFileSync(selected, 'Canonical media fixture.');
  const reopen = () => new BackendCore({ path, contentPolicy: 'synthetic-only', nativeMedia: true });
  let core = reopen();
  try {
    const d = await core.command('desktop', { type: 'createWorkspace', title: 'Media fixture', projectId: null });
    const workspaceId = d.activeWorkspaceId!;
    const input = { kind: 'file' as const, commandId: 'synthetic-file-import', workspaceId, expectedLayoutVersion: d.layoutVersion,
      selection: { kind: 'file' as const, path: selected } };
    await assert.rejects(core.command('mediaImportTrusted', { ...input, expectedLayoutVersion: d.layoutVersion + 1 }), /layout_version_conflict/);
    assert.equal((await core.command('desktop', { type:'snapshot' })).resources.length, 0);
    const imported = await core.command('mediaImportTrusted', input);
    assert.equal(imported.resource.kind, 'file');
    assert.equal(imported.resource.media?.format, 'text');
    assert(imported.placementId);
    assert.equal(imported.desktop.blocks.find(block => block.id === imported.placementId)?.resource_id, imported.resource.id);
    assert(!JSON.stringify(imported).includes(directory));
    assert.deepEqual(await core.command('mediaImportTrusted', input), imported);

    const link = await core.command('mediaImportTrusted', { kind:'link', commandId:'synthetic-link', selection: { kind:'link', url:'https://youtu.be/dQw4w9WgXcQ' } });
    assert.equal(link.placementId, undefined);
    assert.equal(link.resource.media?.format, 'youtube');
    assert.deepEqual((await core.command('mediaDescribe', { resourceId:link.resource.id })).capabilities, {
      read:false, play:false, embed:false, openExternal:true,
    });
    for (const url of ['file:///C:/Windows', 'https://account:password@example.com/', 'javascript:alert(1)']) {
      await assert.rejects(core.command('mediaImportTrusted', { kind:'link', commandId:'unsafe-link', selection: { kind:'link', url } }), /invalid_media_link/);
    }

    const request = { resourceId: imported.resource.id, expectedVersion: imported.resource.version, sourceRevision: imported.resource.media!.sourceRevision, offset: 10, length: 5 };
    await core.command('close', {});
    core = reopen();
    const opened = await core.command('openResource', { resourceId:request.resourceId, origin:{ source:'library' } });
    assert.equal(opened.status, 'ready');
    if (opened.status === 'ready') assert.deepEqual(opened.resource.media, imported.resource.media);
    const bytes = await core.command('mediaReadChunk', request);
    assert.equal(Buffer.from(bytes.base64, 'base64').toString(), 'media');
    await assert.rejects(core.command('mediaReadChunk', { ...request, expectedVersion:request.expectedVersion + 1 }), /source_changed/);
    await assert.rejects(core.command('mediaReadChunk', { ...request, length:1_048_577 }), /invalid_media_range/);
    await assert.rejects(core.command('mediaReadChunk', { ...request, offset:100 }), /invalid_media_range/);
    assert.deepEqual(await core.command('mediaExternalTarget', { resourceId:link.resource.id, expectedVersion:link.resource.version }), {kind:'link',url:'https://youtu.be/dQw4w9WgXcQ'});
    writeFileSync(selected, 'Altered source revision.');
    await assert.rejects(core.command('mediaReadChunk', request), /source_changed/);
    await assert.rejects(core.command('mediaExternalTarget', {resourceId:request.resourceId, expectedVersion:request.expectedVersion}), /source_changed/);
    assert.equal(Object.keys((await core.command('snapshot', {})).executions).length, 0);
  } finally {
    await core.command('close', {});
    assert(resolve(directory).startsWith(resolve(tmpdir()) + sep) && basename(directory).startsWith('aerynth-media-native-'));
    rmSync(directory, { recursive:true, force:true });
  }
});
