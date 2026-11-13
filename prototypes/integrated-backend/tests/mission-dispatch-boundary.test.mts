import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { setImmediate as flush } from 'node:timers/promises';
import { MissionService, type MissionServiceHost } from '../src/mission-service.mts';
import type { MissionPlan } from '../src/mission-contracts.mts';

const scope = { workspaceId: 'synthetic-workspace', projectId: null };
const plan = (executor = 'effect'): MissionPlan => ({ scope, objective: 'Synthetic dispatch-boundary proof', criteria: ['done'], tasks: [{
  id: 'task', executor, objective: 'Synthetic local effect', criterion: 'done', claims: [{ resource: 'target', mode: 'exclusive' }],
  dependencies: [], maxAttempts: 1, timeoutMs: 2000,
}] });
function fixture() {
  const db = new DatabaseSync(':memory:');
  let entered = 0, allowed = true, release: (() => void) | undefined;
  const host: MissionServiceHost = { db,
    atomic<T>(work: () => T): T { db.exec('BEGIN'); try { const result = work(); db.exec('COMMIT'); return result; }
      catch (error) { db.exec('ROLLBACK'); throw error; } },
    authorized: () => allowed, laneLimit: () => 2,
    executors: {
      effect: { lane: 'synthetic', replaySafe: false, available: () => true,
        async run() { entered++; await new Promise<void>(resolve => { release = resolve; }); return { source: 'synthetic', value: true }; },
        verify: () => ({ passed: true, detail: 'Synthetic terminal output' }) },
      read: { lane: 'synthetic', replaySafe: true, available: () => true,
        async run() { return { source: 'synthetic', value: true }; },
        verify: () => ({ passed: true, detail: 'Synthetic readback' }) },
    },
  };
  return { db, host, entered: () => entered, release: () => release?.(), revoke: () => { allowed = false; } };
}

test('cancel after journal admission but before run proves no effect and persists cancellation', async () => {
  const f = fixture(); let service = new MissionService(f.host);
  try {
    const created = service.create('pre-entry', plan());
    // Start commits the attempt in the scheduler microtask; cancel before its run continuation.
    await Promise.resolve();
    const admitted = service.read(created.id, scope);
    assert.equal(admitted.tasks[0].state, 'running');
    assert.equal(f.entered(), 0);
    service.control(created.id, scope, admitted.revision, { type: 'cancel' });
    await flush();
    const stopped = service.read(created.id, scope);
    assert.equal(f.entered(), 0);
    assert.equal(stopped.tasks[0].state, 'cancelled');
    const attempt = stopped.tasks[0].attempts[0];
    await service.close(); service = new MissionService(f.host);
    assert.deepEqual(service.read(created.id, scope).tasks[0].attempts[0], attempt);
    const next = service.create('safe-successor', plan('read')); await flush();
    assert.equal(service.read(next.id, scope).tasks[0].state, 'verified');
  } finally { f.release(); await service.close(); f.db.close(); }
});

test('late output after entered nonreplayable cancellation stays uncertain and fenced across restart', async () => {
  const f = fixture(); let service = new MissionService(f.host);
  try {
    const created = service.create('post-entry', plan()); await flush();
    assert.equal(f.entered(), 1);
    const running = service.read(created.id, scope);
    service.control(created.id, scope, running.revision, { type: 'cancel' });
    f.release(); await flush();
    assert.equal(service.read(created.id, scope).tasks[0].state, 'uncertain');
    assert.equal(service.read(created.id, scope).tasks[0].attempts[0].evidence, undefined);
    await service.close(); service = new MissionService(f.host);
    const next = service.create('unsafe-successor', plan('read')); await flush();
    assert.equal(service.read(next.id, scope).waits.task, 'resource-conflict');
    assert.equal(service.read(next.id, scope).tasks[0].attempts.length, 0);
    assert.equal(f.entered(), 1);
  } finally { f.release(); await service.close(); f.db.close(); }
});

test('authority revoked between admission and run prevents executor entry', async () => {
  const f = fixture(), service = new MissionService(f.host);
  try {
    const created = service.create('revoked-pre-entry', plan()); await Promise.resolve();
    f.revoke(); await flush();
    assert.equal(f.entered(), 0);
    // Inspect the private canonical row; unauthorized projection remains inaccessible.
    const row = f.db.prepare('SELECT json FROM vela_missions WHERE id=?').get(created.id)!;
    assert.equal(JSON.parse(String(row.json)).tasks[0].state, 'blocked');
    assert.throws(() => service.read(created.id, scope), /mission_not_found/);
  } finally { f.release(); await service.close(); f.db.close(); }
});
