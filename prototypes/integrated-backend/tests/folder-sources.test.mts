import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rename, rm, symlink, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { FolderSources, inspectFolderSelection, readFolderSource, storeFolderSource, findFolderResource,
  revokeFolderSource, assertCurrentFolderSourceSync, folderDiscoveryRoot, FOLDER_LIMITS } from '../src/folder-sources.mts';

const code = (expected: string) => (e: unknown) => !!e && typeof e === 'object' && 'code' in e && e.code === expected;
async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), 'aerynth-folder-test-'));
  const selected = path.join(root, 'Optics'); await mkdir(selected);
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON; CREATE TABLE resources(id TEXT PRIMARY KEY); BEGIN'); FolderSources.migrate(db); db.exec('COMMIT');
  const service = new FolderSources(db);
  t.after(async () => { service.dispose(); db.close();
    const relative = path.relative(tmpdir(), root);
    assert.ok(relative.startsWith('aerynth-folder-test-') && !relative.includes(path.sep));
    await rm(root, { recursive: true, force: true });
  });
  const bind = async (id = 'folder-1', project: string | null = 'project-1', sourcePath = selected, privateRoot?: string) => {
    const source = await inspectFolderSelection(sourcePath, privateRoot);
    db.exec('BEGIN');
    try { db.prepare('INSERT INTO resources(id) VALUES(?)').run(id); storeFolderSource(db, { resourceId: id, projectId: project, source }); db.exec('COMMIT'); }
    catch (e) { db.exec('ROLLBACK'); throw e; }
    return source;
  };
  return { root, selected, db, service, bind };
}

test('selection stores one private locator in the caller transaction and exposes metadata only', async t => {
  const f = await fixture(t); await mkdir(path.join(f.selected, 'Calibration')); await writeFile(path.join(f.selected, 'notes.txt'), 'owned fixture');
  const source = await inspectFolderSelection(f.selected);
  assert.deepEqual(Object.keys(source.metadata).sort(), ['name', 'source', 'sourceRevision']);
  assert.equal(source.metadata.name, 'Optics'); assert.match(source.sourceGrantId, /^[a-f0-9-]{36}$/);
  assert.throws(() => storeFolderSource(f.db, { resourceId: 'folder-1', projectId: 'project-1', source }), code('folder_source_storage_unavailable'));
  await f.bind();
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM resources').get()!.n, 1);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM folder_sources').get()!.n, 1);
  assert.equal(readFolderSource(f.db, 'folder-1')!.path, source.path);
  const dto = await f.service.describe('folder-1', 'project-1');
  assert.equal(dto.accessState, 'available'); assert.deepEqual(dto.metadata, source.metadata);
  const json = JSON.stringify(dto); assert.ok(!json.includes(source.path)); assert.ok(!json.includes('sourceGrantId'));
  const page = await f.service.list({ resourceId: 'folder-1' }, 'project-1');
  assert.equal(page.scope, 'metadata-only'); assert.deepEqual(page.entries.map(e => e.name), ['Calibration', 'notes.txt']);
  assert.ok(page.entries.every(e => e.id.startsWith('fentry-') && !('path' in e) && !('content' in e)));
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM resources').get()!.n, 1);
});

test('deduplication binds current identity within a project; child changes preserve the permission target', async t => {
  const f = await fixture(t); const source = await f.bind();
  assert.equal(findFolderResource(f.db, 'project-1', source), 'folder-1');
  assert.equal(findFolderResource(f.db, 'project-2', source), null);
  const before = (await f.service.list({ resourceId: 'folder-1' }, 'project-1')).observedRevision;
  await writeFile(path.join(f.selected, 'new.txt'), 'fixture');
  const future = new Date(Date.now() + 10000); await utimes(f.selected, future, future);
  assert.doesNotThrow(() => assertCurrentFolderSourceSync(source));
  assert.throws(() => assertCurrentFolderSourceSync(source, true), code('folder_source_changed'));
  const after = await f.service.list({ resourceId: 'folder-1' }, 'project-1'); assert.notEqual(before, after.observedRevision);
  assert.equal(await folderDiscoveryRoot(f.db, 'folder-1', 'project-1'), source.path);
  await assert.rejects(folderDiscoveryRoot(f.db, 'folder-1', 'project-2'), code('folder_scope_mismatch'));
  await rename(f.selected, f.selected + '-old'); await mkdir(f.selected);
  assert.equal((await f.service.describe('folder-1', 'project-1')).accessState, 'changed');
  await assert.rejects(f.service.list({ resourceId: 'folder-1' }, 'project-1'), code('folder_source_changed'));
});

test('opaque child and continuation leases cannot cross folders, projects or directory boundaries', async t => {
  const f = await fixture(t); await mkdir(path.join(f.selected, 'A')); await mkdir(path.join(f.selected, 'B'));
  await writeFile(path.join(f.selected, 'C.txt'), 'fixture'); await writeFile(path.join(f.selected, 'A', 'child.txt'), 'fixture');
  await f.bind(); await f.bind('folder-2');
  const service = new FolderSources(f.db, { pageSize: 2 }); t.after(() => service.dispose());
  const first = await service.list({ resourceId: 'folder-1' }, 'project-1'); assert.equal(first.entries.length, 2); assert.ok(first.cursor);
  const a = first.entries.find(e => e.name === 'A')!;
  const child = await service.list({ resourceId: 'folder-1', entryId: a.id }, 'project-1'); assert.equal(child.entries[0].name, 'child.txt');
  assert.equal(await service.externalTarget('folder-1', 'project-1', a.id), path.join(f.selected, 'A'));
  await assert.rejects(service.list({ resourceId: 'folder-2', entryId: a.id }, 'project-1'), code('folder_scope_mismatch'));
  await assert.rejects(service.list({ resourceId: 'folder-1', cursor: first.cursor! }, 'project-2'), code('folder_scope_mismatch'));
  await assert.rejects(service.list({ resourceId: 'folder-2', cursor: first.cursor! }, 'project-1'), code('folder_scope_mismatch'));
  await assert.rejects(service.list({ resourceId: 'folder-1', entryId: a.id, cursor: first.cursor! }, 'project-1'), code('folder_scope_mismatch'));
  const second = await service.list({ resourceId: 'folder-1', cursor: first.cursor! }, 'project-1'); assert.equal(second.entries[0].name, 'C.txt'); assert.equal(second.cursor, null);
  await assert.rejects(service.externalTarget('folder-1', 'project-1', second.entries[0].id), code('folder_entry_not_directory'));
  await assert.rejects(service.list({ resourceId: 'folder-1', entryId: '../A' }, 'project-1'), code('invalid_folder_request'));
});

test('bounded snapshots disclose truncation and reject changed or expired continuations', async t => {
  const f = await fixture(t); for (let i = 0; i < 6; i++) await mkdir(path.join(f.selected, `D${i}`)); await f.bind();
  let now = 1000; const service = new FolderSources(f.db, { now: () => now, pageSize: 1, maxEntries: 3, leaseMs: 10 }); t.after(() => service.dispose());
  const first = await service.list({ resourceId: 'folder-1' }, 'project-1'); assert.equal(first.truncated, true); assert.ok(first.cursor);
  const second = await service.list({ resourceId: 'folder-1', cursor: first.cursor! }, 'project-1'); assert.equal(second.entries.length, 1);
  now = 1011;
  await assert.rejects(service.list({ resourceId: 'folder-1', cursor: second.cursor! }, 'project-1'), code('folder_listing_expired'));
  await assert.rejects(service.externalTarget('folder-1', 'project-1', first.entries[0].id), code('folder_listing_expired'));
  const fresh = await service.list({ resourceId: 'folder-1' }, 'project-1');
  await mkdir(path.join(f.selected, 'Later')); const future = new Date(Date.now() + 20000); await utimes(f.selected, future, future);
  await assert.rejects(service.list({ resourceId: 'folder-1', cursor: fresh.cursor! }, 'project-1'), code('folder_listing_changed'));
  assert.throws(() => new FolderSources(f.db, { maxEntries: FOLDER_LIMITS.entries + 1 }), code('invalid_folder_request'));
});

test('private profile roots are neither selectable nor browsable through a selected ancestor', async t => {
  const f = await fixture(t); const privateRoot = path.join(f.selected, 'PrivateProfile'); await mkdir(privateRoot); await mkdir(path.join(privateRoot, 'Nested'));
  await mkdir(path.join(f.selected, 'Visible'));
  await assert.rejects(inspectFolderSelection(privateRoot, privateRoot), code('folder_source_restricted'));
  await assert.rejects(inspectFolderSelection(path.join(privateRoot, 'Nested'), privateRoot), code('folder_source_restricted'));
  await f.bind('folder-1', 'project-1', f.selected, privateRoot);
  const listing = await f.service.list({ resourceId: 'folder-1' }, 'project-1'); assert.deepEqual(listing.entries.map(e => e.name), ['Visible']);
  assert.ok(!JSON.stringify(listing).includes('PrivateProfile'));
});

test('junctions and symbolic links cannot grant or extend directory access', async t => {
  const f = await fixture(t); const outside = path.join(f.root, 'Outside'); await mkdir(outside); await writeFile(path.join(outside, 'hidden.txt'), 'fixture');
  const link = path.join(f.selected, 'Escape'); await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(inspectFolderSelection(link), code('folder_source_restricted')); await f.bind();
  const listing = await f.service.list({ resourceId: 'folder-1' }, 'project-1'); const entry = listing.entries.find(e => e.name === 'Escape')!;
  assert.equal(entry.kind, 'unsupported'); await assert.rejects(f.service.externalTarget('folder-1', 'project-1', entry.id), code('folder_entry_not_directory'));
  await assert.rejects(f.service.list({ resourceId: 'folder-1', entryId: entry.id }, 'project-1'), code('folder_entry_not_directory'));
});

test('revocation and disposal deny existing handles and never recreate canonical children', async t => {
  const f = await fixture(t); await mkdir(path.join(f.selected, 'A')); await f.bind(); const first = await f.service.list({ resourceId: 'folder-1' }, 'project-1');
  f.db.exec('BEGIN'); revokeFolderSource(f.db, 'folder-1'); f.db.exec('COMMIT');
  assert.equal((await f.service.describe('folder-1', 'project-1')).accessState, 'revoked');
  await assert.rejects(f.service.list({ resourceId: 'folder-1' }, 'project-1'), code('folder_permission_revoked'));
  await assert.rejects(f.service.externalTarget('folder-1', 'project-1', first.entries[0].id), code('folder_permission_revoked'));
  await assert.rejects(folderDiscoveryRoot(f.db, 'folder-1', 'project-1'), code('folder_permission_revoked'));
  f.service.dispose(); await assert.rejects(f.service.list({ resourceId: 'folder-1' }, 'project-1'), code('folder_source_unavailable'));
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM resources').get()!.n, 1);
});

test('revocation during native target resolution is rechecked before returning a private path', async t => {
  const f = await fixture(t); await f.bind();
  const pending = folderDiscoveryRoot(f.db, 'folder-1', 'project-1');
  f.db.exec('BEGIN'); revokeFolderSource(f.db, 'folder-1'); f.db.exec('COMMIT');
  await assert.rejects(pending, code('folder_permission_revoked'));
});

test('replacement children and disposal during a pending listing invalidate old access', async t => {
  const f = await fixture(t); const child = path.join(f.selected, 'Child'); await mkdir(child); await f.bind();
  const first = await f.service.list({ resourceId: 'folder-1' }, 'project-1');
  await rename(child, child + '-old'); await mkdir(child);
  await assert.rejects(f.service.externalTarget('folder-1', 'project-1', first.entries[0].id), code('folder_source_changed'));
  const pending = f.service.list({ resourceId: 'folder-1' }, 'project-1'); f.service.dispose();
  await assert.rejects(pending, code('folder_source_unavailable'));
});
