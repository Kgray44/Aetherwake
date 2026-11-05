import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceKernel } from '../../workspace-kernel/kernel.mts';
import { WorkspaceEngine } from '../engine.mts';

function fixture(t: any, disk = false) {
  const profile = disk ? mkdtempSync(join(tmpdir(), 'aerynth-workspace-inspection-')) : undefined;
  if (profile) t.diagnostic('Retained synthetic inspection receipt: ' + profile);
  const path = profile ? join(profile, 'inspection.sqlite') : ':memory:', kernel = WorkspaceKernel.open(path), engine = new WorkspaceEngine(kernel);
  const db = kernel.withTransaction(db => db), project = kernel.createProject('Synthetic authorized host scope');
  let state = engine.createWorkspace('Synthetic inactive workspace', project.id, { mode: 'freeform' });
  state = engine.execute({ type: 'createBlock', commandId: randomUUID(), workspaceId: state.workspaceId, expectedRevision: state.revision,
    resource: { kind: 'note', title: 'Synthetic actual canonical note', content: 'Exact retained text' }, presentation: { x: 173, y: 241, width: 431, height: 329, shape: 'rounded', rotation: 8 } });
  const other = engine.createWorkspace('Synthetic active workspace');
  t.after(() => { db.exec('PRAGMA query_only=OFF'); kernel.close(); });
  const dump = () => db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({ name }) =>
    [name, db.prepare('SELECT * FROM "' + name + '"').all().map(row => JSON.stringify(row)).sort()]);
  return { kernel, engine, db, state, other, project, path, dump };
}
const code = (wanted: string) => (error: any) => error.code === wanted;
test('inspection returns exact inactive geometry/viewport/organization/presence/revision using query-only SQLite, with no lazy API, session/history/memo/file changes', t => {
  const f = fixture(t, true), before = f.dump(), changes = f.db.prepare('SELECT total_changes() AS n').get()!.n;
  const hash = () => createHash('sha256').update(readFileSync(f.path)).digest('hex'), beforeHash = hash();
  const memo = (f.engine as any).historyMemo;
  for (const method of ['project', 'layout', 'normalizedHistory', 'normalizeSnapshot', 'readPresence', 'readOrganization', 'snapshot'])
    (f.engine as any)[method] = () => { throw new Error('Forbidden lazy/projection API: ' + method); };
  (f.kernel as any).openWorkspace = () => { throw new Error('Inspection must use existing rows'); };
  f.db.exec('PRAGMA query_only=ON');
  const inspected = f.engine.inspectWorkspace(f.state.workspaceId);
  assert.deepEqual(inspected, f.state); assert.equal(f.engine.activeWorkspaceId(), f.other.workspaceId);
  inspected.blocks[0].x = -999; inspected.presence.x = -999; inspected.organization.structured.order.push('not-canonical');
  assert.deepEqual(f.engine.inspectWorkspace(f.state.workspaceId), f.state);
  assert.deepEqual(f.dump(), before); assert.equal(f.db.prepare('SELECT total_changes() AS n').get()!.n, changes);
  assert.equal(hash(), beforeHash); assert.equal((f.engine as any).historyMemo, memo); assert.equal(f.db.prepare('PRAGMA query_only').get()!.query_only, 1);
});
test('missing/uninitialized/incomplete/archived workspace or owner is unavailable without repairing any row', t => {
  const f = fixture(t), fresh = f.kernel.createWorkspace('Synthetic not initialized after engine construction');
  const check = (id: string) => {
    const before = f.dump(), changes = f.db.prepare('SELECT total_changes() AS n').get()!.n;
    f.db.exec('PRAGMA query_only=ON'); assert.throws(() => f.engine.inspectWorkspace(id), code('UNAVAILABLE'));
    assert.deepEqual(f.dump(), before); assert.equal(f.db.prepare('SELECT total_changes() AS n').get()!.n, changes); f.db.exec('PRAGMA query_only=OFF');
  };
  check('missing:workspace'); check(fresh.id);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM workspace_engine_layouts WHERE workspace_id=?').get(fresh.id)!.n, 0);
  f.db.prepare('UPDATE workspace_engine_layouts SET presence_json=NULL WHERE workspace_id=?').run(f.state.workspaceId); check(f.state.workspaceId);
  f.db.prepare('UPDATE workspaces SET state=? WHERE id=?').run('archived', f.other.workspaceId); check(f.other.workspaceId);
  f.db.prepare('UPDATE projects SET state=? WHERE id=?').run('archived', f.project.id); check(f.state.workspaceId);
});
test('inspection preserves legacy dimensions and archived subject identity, reads undo flags without normalizing history, and refuses a missing presentation', t => {
  const f = fixture(t), block = f.state.blocks[0], history = JSON.stringify({ undo: [{ before: {}, after: {} }], redo: [] });
  f.db.prepare('UPDATE blocks SET width=40,height=32 WHERE id=?').run(block.blockId);
  f.db.prepare('UPDATE resources SET state=? WHERE id=?').run('archived', block.resourceId!);
  f.db.prepare('UPDATE workspace_engine_layouts SET history_json=? WHERE workspace_id=?').run(history, f.state.workspaceId);
  const before = f.dump(); f.db.exec('PRAGMA query_only=ON');
  const result = f.engine.inspectWorkspace(f.state.workspaceId);
  assert.equal(result.blocks[0].width, 40); assert.equal(result.blocks[0].height, 32); assert.equal(result.blocks[0].resourceId, block.resourceId);
  assert.equal(result.blocks[0].subjectState, 'archived'); assert.equal(result.canUndo, true); assert.equal(result.canRedo, false); assert.deepEqual(f.dump(), before);
  f.db.exec('PRAGMA query_only=OFF'); f.db.prepare('DELETE FROM block_presentations WHERE block_id=?').run(block.blockId);
  const missing = f.dump(); f.db.exec('PRAGMA query_only=ON');
  assert.throws(() => f.engine.inspectWorkspace(f.state.workspaceId), code('UNAVAILABLE')); assert.deepEqual(f.dump(), missing);
});
