import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BackendCore } from '../src/core.mts';

test('media kinds require an actual import capability and never become empty notes or dummy placements', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'aerynth-media-import-boundary-'));
  const core = new BackendCore({ path: join(directory, 'canonical.sqlite'), provider: 'fixture', contentPolicy: 'synthetic-only' });
  try {
    const capabilities = (await core.command('library', { name: 'capabilities', input: {} })).result as any;
    assert.equal(capabilities.kinds.file.state, 'unsupported');
    assert.equal(capabilities.kinds.link.state, 'unsupported');
    assert.equal(capabilities.kinds.folder.state, 'unsupported');
    assert.equal(capabilities.providers.automatic.state, 'setup_required');
    const before = await core.command('snapshot', {});
    for (const kind of ['file', 'link','folder'] as const) {
      await assert.rejects(core.command('desktop', { type: 'createResource', kind, title: 'Synthetic unimported media', workspaceId: null }), /media_import_required/);
    }
    assert.deepEqual(await core.command('snapshot', {}), before);
    const desktop = await core.command('desktop', { type: 'snapshot' });
    assert.equal(desktop.projects.length, 0); assert.equal(desktop.workspaces.length, 0);
    assert.equal(desktop.resources.length, 0); assert.equal(desktop.blocks.length, 0);
  } finally { await core.command('close', {}); }
});
