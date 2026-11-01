import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { WorkspaceKernel, KernelError } from '../kernel.mts';

const base = dirname(fileURLToPath(import.meta.url));
const placement = { x: 1, y: 2, width: 300, height: 200, z: 0 };
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'aetherwake-kernel-'));
  const path = join(dir, 'test.sqlite');
  return { dir, path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
const errorCode = (code: string) => (error: unknown) => error instanceof KernelError && error.code === code;

test('canonical resource survives multiple blocks, moves, layout save and restart', () => {
  const f = fixture();
  try {
    let k = WorkspaceKernel.open(f.path);
    const project = k.createProject('Synthetic project');
    const renamed = k.renameProject(project.id, 'Renamed project', 1);
    assert.equal(renamed.version, 2);
    const left = k.createWorkspace('Left', project.id);
    const right = k.createWorkspace('Right', project.id);
    const note = k.createNote('Synthetic note', 'Fixture content', project.id);
    const conversation = k.createConversationRef('Synthetic chat');
    const first = k.attachBlock(left.id, note.id, placement);
    const second = k.attachBlock(right.id, note.id, { ...placement, x: 50 });
    k.attachBlock(left.id, conversation.id, placement);
    const edge = k.relate(note.id, conversation.id, 'context-for');
    k.moveBlock(first.id, right.id, 1);
    const saved = k.saveLayout(right.id, 'freeform', { zoom: 1.25 }, [
      { blockId: first.id, expectedVersion: 2, placement: { ...placement, x: 100 } },
      { blockId: second.id, expectedVersion: 1, placement: { ...placement, x: 500 } }
    ], 1);
    assert.equal(saved.blocks.length, 2);
    assert.equal(saved.layout.viewport.zoom, 1.25);
    assert.deepEqual(new Set(saved.blocks.map(b => b.resource_id)), new Set([note.id]));
    const collection = k.createCollection('Important', project.id);
    k.addToCollection(collection.id, note.id);
    k.close();
    k = WorkspaceKernel.open(f.path);
    assert.equal(k.schemaVersion(), 2);
    assert.equal(k.getResource(note.id).note.content, 'Fixture content');
    assert.equal(k.openWorkspace(right.id).blocks[0].resource_id, note.id);
    assert.equal(k.openWorkspace(right.id).layout.viewport.zoom, 1.25);
    assert.equal(k.listRelationships(note.id)[0].id, edge.id);
    assert.equal(k.listCollection(collection.id)[0].id, note.id);
    assert.equal(k.searchResources('Synthetic').length, 2);
    assert.equal(k.getResource(conversation.id).conversation.backend_state, 'unavailable');
    k.close();
  } finally { f.cleanup(); }
});

test('failed layout mutation rolls back all placements and version', () => {
  const f = fixture();
  try {
    const k = WorkspaceKernel.open(f.path);
    const w = k.createWorkspace('Workspace'); const n = k.createNote('Note', 'text');
    const a = k.attachBlock(w.id, n.id, placement);
    const b = k.attachBlock(w.id, n.id, placement);
    assert.throws(() => k.saveLayout(w.id, 'freeform', {}, [
      { blockId: a.id, expectedVersion: 1, placement: { ...placement, x: 900 } },
      { blockId: b.id, expectedVersion: 9, placement }
    ], 1), errorCode('CONFLICT'));
    const reopened = k.openWorkspace(w.id);
    assert.equal(reopened.blocks.find(x => x.id === a.id).x, 1);
    assert.equal(reopened.layout.version, 1);
    k.close();
  } finally { f.cleanup(); }
});

test('unique identity, referential integrity, validation and optimistic concurrency', () => {
  const f = fixture();
  try {
    const k = WorkspaceKernel.open(f.path);
    const p = k.createProject('Project'); const n = k.createNote('Note', 'first', p.id);
    const c = k.createConversationRef('Conversation');
    assert.throws(() => k.renameProject(p.id, 'Stale', 0), errorCode('CONFLICT'));
    assert.throws(() => k.createWorkspace('Bad', 'missing'), errorCode('NOT_FOUND'));
    assert.throws(() => k.relate(n.id, 'missing', 'link'), errorCode('NOT_FOUND'));
    assert.throws(() => k.relate(n.id, n.id, 'link'), errorCode('INVALID'));
    k.relate(n.id, c.id, 'link');
    assert.throws(() => k.relate(n.id, c.id, 'link'), errorCode('INTEGRITY'));
    const revised = k.updateNote(n.id, 'second', 1);
    assert.equal(revised.version, 2);
    assert.throws(() => k.updateNote(n.id, 'lost', 1), errorCode('CONFLICT'));
    assert.equal(k.getResource(n.id).note.content, 'second');
    assert.throws(() => k.attachBlock('missing', n.id, placement), errorCode('NOT_FOUND'));
    assert.throws(() => k.createNote('', 'x'), errorCode('INVALID'));
    k.assertIntegrity(); k.close();
  } finally { f.cleanup(); }
});

test('external references prevent duplicate provider identity and never own canonical resource', () => {
  const f = fixture();
  try {
    const k = WorkspaceKernel.open(f.path);
    const a = k.createConversationRef('A'); const b = k.createConversationRef('B');
    const ref = k.addExternalRef(a.id, 'synthetic-provider', 'account', 'thread-1');
    assert.throws(() => k.addExternalRef(b.id, 'synthetic-provider', 'account', 'thread-1'), errorCode('INTEGRITY'));
    assert.equal(k.getResource(a.id).externalRefs[0].id, ref.id);
    assert.equal(k.getResource(b.id).externalRefs.length, 0);
    k.close();
  } finally { f.cleanup(); }
});

test('archive, restore and protected deletion preserve linked objects', () => {
  const f = fixture();
  try {
    const k = WorkspaceKernel.open(f.path);
    const w = k.createWorkspace('Workspace'); const n = k.createNote('Note', 'content');
    const block = k.attachBlock(w.id, n.id, placement);
    const archived = k.setResourceArchived(n.id, true, 1);
    assert.equal(k.searchResources('Note').length, 0);
    assert.equal(k.searchResources('Note', true).length, 1);
    assert.throws(() => k.deleteResource(n.id, 2), errorCode('INTEGRITY'));
    assert.equal(k.getResource(n.id).note.content, 'content');
    k.detachBlock(block.id);
    k.deleteResource(n.id, 2);
    assert.throws(() => k.getResource(n.id), errorCode('NOT_FOUND'));
    assert.equal(k.listEvents('resource', n.id).at(-1).type, 'resource.deleted');
    const m = k.createNote('Restore', 'x');
    k.setResourceArchived(m.id, true, 1);
    assert.equal(k.setResourceArchived(m.id, false, 2).state, 'active');
    assert.equal(archived.state, 'archived');
    k.assertIntegrity(); k.close();
  } finally { f.cleanup(); }
});

test('project, workspace and collection lifecycle rejects orphaning deletes', () => {
  const f = fixture();
  try {
    const k = WorkspaceKernel.open(f.path);
    const p = k.createProject('Project');
    const w = k.createWorkspace('Workspace', p.id);
    const n = k.createNote('Note', 'content', p.id);
    const b = k.attachBlock(w.id, n.id, placement);
    const c = k.createCollection('Collection', p.id);
    k.addToCollection(c.id, n.id);
    assert.equal(k.renameWorkspace(w.id, 'Renamed workspace', 1).version, 2);
    assert.equal(k.renameCollection(c.id, 'Renamed collection', 1).version, 2);
    k.setWorkspaceArchived(w.id, true, 2);
    k.setCollectionArchived(c.id, true, 2);
    k.setProjectArchived(p.id, true, 1);
    assert.throws(() => k.deleteWorkspace(w.id, 3), errorCode('INTEGRITY'));
    assert.throws(() => k.deleteCollection(c.id, 3), errorCode('INTEGRITY'));
    assert.throws(() => k.deleteProject(p.id, 2), errorCode('INTEGRITY'));
    k.detachBlock(b.id);
    k.removeFromCollection(c.id, n.id);
    k.deleteWorkspace(w.id, 3);
    k.deleteCollection(c.id, 3);
    assert.throws(() => k.deleteProject(p.id, 2), errorCode('INTEGRITY'));
    k.setResourceArchived(n.id, true, 1);
    k.deleteResource(n.id, 2);
    k.deleteProject(p.id, 2);
    assert.equal(k.listEvents('project', p.id).at(-1).type, 'project.deleted');
    k.assertIntegrity(); k.close();
  } finally { f.cleanup(); }
});

test('migrates v1 schema and refuses unknown future schema', () => {
  const f = fixture();
  try {
    const raw = new DatabaseSync(f.path);
    raw.exec(readFileSync(join(base, '../migrations/001-initial.sql'), 'utf8'));
    raw.close();
    const k = WorkspaceKernel.open(f.path);
    assert.equal(k.schemaVersion(), 2);
    const n = k.createNote('Migrated note', 'content');
    k.addExternalRef(n.id, 'synthetic', '', 'id');
    k.close();
    const future = new DatabaseSync(f.path);
    future.exec('UPDATE app_schema_version SET version=99'); future.close();
    assert.throws(() => WorkspaceKernel.open(f.path), errorCode('INTEGRITY'));
  } finally { f.cleanup(); }
});

test('failed migration rolls back without advancing version', () => {
  const f = fixture();
  try {
    const raw = new DatabaseSync(f.path);
    raw.exec(readFileSync(join(base, '../migrations/001-initial.sql'), 'utf8'));
    raw.exec('CREATE TABLE external_provider_refs(conflict TEXT)');
    raw.close();
    assert.throws(() => WorkspaceKernel.open(f.path), errorCode('STORAGE'));
    const inspect = new DatabaseSync(f.path);
    assert.equal(inspect.prepare('SELECT version FROM app_schema_version').get().version, 1);
    assert.equal(inspect.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='index' AND name='external_refs_by_resource'").get().n, 0);
    inspect.close();
  } finally { f.cleanup(); }
});

test('corrupt and unrecognized databases fail explicitly', () => {
  const f = fixture();
  try {
    writeFileSync(f.path, 'not a sqlite database');
    assert.throws(() => WorkspaceKernel.open(f.path), errorCode('INTEGRITY'));
    rmSync(f.path);
    const raw = new DatabaseSync(f.path); raw.exec('CREATE TABLE unrelated(x)'); raw.close();
    assert.throws(() => WorkspaceKernel.open(f.path), errorCode('INTEGRITY'));
  } finally { f.cleanup(); }
});

test('missing expected file and missing required subtype fail explicitly', () => {
  const f = fixture();
  try {
    assert.throws(() => WorkspaceKernel.openExisting(f.path), errorCode('NOT_FOUND'));
    const k = WorkspaceKernel.open(f.path);
    const n = k.createNote('Note', 'content');
    k.close();
    const raw = new DatabaseSync(f.path);
    raw.exec(`DELETE FROM notes WHERE resource_id='${n.id}'`);
    raw.close();
    assert.throws(() => WorkspaceKernel.openExisting(f.path), errorCode('INTEGRITY'));
  } finally { f.cleanup(); }
});

test('interrupted uncommitted write rolls back after process exit', () => {
  const f = fixture();
  try {
    const k = WorkspaceKernel.open(f.path); k.createProject('Committed'); k.close();
    const child = spawnSync(process.execPath, ['-e', `const {DatabaseSync}=require('node:sqlite'); const d=new DatabaseSync(${JSON.stringify(f.path)}); d.exec("BEGIN IMMEDIATE; INSERT INTO projects VALUES('interrupted','Lost','active',1,'t','t')"); process.exit(17);`]);
    assert.equal(child.status, 17);
    const reopened = WorkspaceKernel.open(f.path);
    assert.equal(reopened.searchResources().length, 0);
    const raw = new DatabaseSync(f.path);
    assert.deepEqual(raw.prepare('SELECT title FROM projects ORDER BY title').all().map(x => x.title), ['Committed']);
    raw.close(); reopened.assertIntegrity(); reopened.close();
  } finally { f.cleanup(); }
});

test('backup can reopen with stable identities and content', async () => {
  const f = fixture();
  try {
    const k = WorkspaceKernel.open(f.path);
    const n = k.createNote('Backup fixture', 'content');
    const copyPath = join(f.dir, 'backup.sqlite');
    await k.backupTo(copyPath);
    k.close();
    const copy = WorkspaceKernel.open(copyPath);
    assert.equal(copy.getResource(n.id).note.content, 'content');
    copy.assertIntegrity(); copy.close();
  } finally { f.cleanup(); }
});
