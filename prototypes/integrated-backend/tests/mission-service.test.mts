import { strict as assert } from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { setImmediate as flush } from 'node:timers/promises';
import { MissionService, validateMissionPlan } from '../src/mission-service.mts';
import { nativeMissionPlan } from '../src/mission-native.mts';
import type { MissionExecutionContext, MissionExecutor, MissionPlan, MissionTaskPlan } from '../src/mission-contracts.mts';

const scope = { workspaceId: 'workspace-1', projectId: 'project-1' };
const task = (id: string, dependencies: string[] = [], resource?: string): MissionTaskPlan => ({
  id, dependencies, criterion: id, claims: resource ? [{ resource, mode: 'exclusive' }] : [], objective: 'Synthetic ' + id,
  executor: 'fixture', timeoutMs: 2000, maxAttempts: 2,
});
const plan = (...tasks: MissionTaskPlan[]): MissionPlan => ({ scope, objective: 'Synthetic objective', tasks, criteria: tasks.map(t => t.criterion) });

function fixture(replaySafe = true) {
  const db = new DatabaseSync(':memory:');
  let access = true;
  let pressure = false;
  const active = new Map<string, { context: MissionExecutionContext; release: (value?: boolean) => void }>();
  const executor: MissionExecutor = {
    lane: 'fixture', replaySafe, available: () => true,
    async run(context) {
      const value = await new Promise<boolean>(resolve => {
        active.set(context.task.id, { context, release: (pass = true) => resolve(pass) });
        context.signal.addEventListener('abort', () => resolve(false), { once: true });
      });
      active.delete(context.task.id);
      return { source: 'synthetic-fixture', value };
    },
    verify: evidence => ({ passed: evidence.value === true, detail: 'Independent synthetic evidence check' }),
  };
  const host = { db, atomic<T>(f: () => T): T { db.exec('BEGIN'); try { const r = f(); db.exec('COMMIT'); return r; }
    catch (e) { db.exec('ROLLBACK'); throw e; } }, authorized: (candidate: typeof scope) =>
    access && candidate.workspaceId === scope.workspaceId && candidate.projectId === scope.projectId,
  executors: { fixture: executor }, laneLimit: () => 3, underPressure: () => pressure };
  return { db, active, host, create: () => new MissionService(host),
    revoke: () => { access = false; }, pressure: (value: boolean) => { pressure = value; } };
}

test('validates dependencies and holds simple AIR routes outside mission planning', () => {
  const f = fixture();
  try {
    assert.throws(() => validateMissionPlan(plan(task('x', ['y'])), f.host.executors), /missing_mission_dependency/);
    assert.throws(() => validateMissionPlan(plan(task('x', ['y']), task('y', ['x'])), f.host.executors), /mission_dependency_cycle/);
    assert.equal(nativeMissionPlan('What is CPU usage?', scope), null);
    assert.equal(nativeMissionPlan('Measure CPU and RAM and send the results', scope), null);
    const native = nativeMissionPlan('Vela, run a mission to measure CPU, RAM, and GPU utilization in parallel.', scope)!;
    assert.deepEqual(native.tasks.find(t => t.id === 'report')?.dependencies, ['cpu', 'ram', 'gpu']);
  } finally { f.db.close(); }
});

test('overlaps independent branches and missions, serializes exclusive claims, and joins verified evidence', async () => {
  const f = fixture(), service = f.create();
  try {
    const firstPlan = plan(task('analysis', [], 'repo'), task('profile'), task('join', ['analysis', 'profile']));
    const a = service.create('a', firstPlan);
    assert.equal(service.create('a', firstPlan).id, a.id);
    assert.throws(() => service.create('a', { ...firstPlan, objective: 'Changed' }), /mission_request_conflict/);
    const b = service.create('b', plan(task('conflict', [], 'repo'), task('independent')));
    await flush();
    assert.deepEqual([...f.active.keys()].sort(), ['analysis', 'independent', 'profile']);
    assert.equal(service.read(b.id, scope).waits.conflict, 'resource-conflict');
    assert.equal(service.read(a.id, scope).waits.join, 'dependencies');
    f.active.get('analysis')!.release();
    await flush();
    assert.ok(f.active.has('conflict'));
    assert.equal(f.active.has('join'), false);
    f.active.get('profile')!.release();
    await flush();
    const join = f.active.get('join')!;
    assert.equal(join.context.dependencies.length, 2);
    assert.equal(new Set(join.context.dependencies.map(e => e.id)).size, 2);
    const read = service.read(a.id, scope);
    const earliestEnd = Math.min(...read.tasks.slice(0, 2).map(t => Date.parse(t.attempts[0].finishedAt!)));
    const latestStart = Math.max(...read.tasks.slice(0, 2).map(t => Date.parse(t.attempts[0].admittedAt)));
    assert.ok(latestStart <= earliestEnd);
    join.release();
    f.active.get('independent')!.release();
    f.active.get('conflict')!.release();
    await flush();
    assert.equal(service.read(a.id, scope).outcome, 'verified');
    assert.equal(service.read(b.id, scope).outcome, 'verified');
    assert.throws(() => service.read(a.id, { ...scope, projectId: 'other' }), /mission_not_found/);
  } finally { await service.close(); f.db.close(); }
});

test('verification failure, paused admission, evidence-bound amendment, and replay-safe retry', async () => {
  const f = fixture(), service = f.create();
  const read = (id: string) => service.read(id, scope);
  try {
    const m = service.create('failure', plan(task('inspect'), task('verify', ['inspect'])));
    await flush();
    const paused = service.control(m.id, scope, read(m.id).revision, { type: 'pause' });
    assert.equal(paused.disposition, 'paused');
    f.active.get('inspect')!.release(false);
    await flush();
    const failed = read(m.id);
    assert.equal(failed.tasks[0].attempts[0].verification?.passed, false);
    assert.equal(failed.tasks[1].attempts.length, 0);
    assert.throws(() => service.revise(m.id, scope, failed.revision, [{ ...task('other'), criterion: 'other' }], 'invalid criteria'),
      /invalid_mission_task/);
    const revised = service.revise(m.id, scope, failed.revision, [{ ...task('second-check', ['verify']), criterion: 'verify' }],
      'Evidence requires an additional check');
    assert.deepEqual(revised.criteria, failed.criteria);
    assert.equal(revised.objective, failed.objective);
    assert.throws(() => service.control(m.id, scope, failed.revision, { type: 'resume' }), /mission_revision_changed/);
    const retried = service.control(m.id, scope, revised.revision, { type: 'retry', taskId: 'inspect' });
    await flush();
    assert.equal(f.active.size, 0);
    service.control(m.id, scope, retried.revision, { type: 'resume' });
    await flush();
    f.active.get('inspect')!.release(true);
    await flush();
    f.active.get('verify')!.release(true);
    await flush();
    f.active.get('second-check')!.release(true);
    await flush();
    assert.equal(read(m.id).outcome, 'verified');
    assert.equal(read(m.id).tasks[0].attempts.length, 2);
  } finally { await service.close(); f.db.close(); }
});

test('restart reconciles a committed in-flight nonreplayable attempt as uncertain and never dispatches twice', async () => {
  const f = fixture(false), service = f.create();
  let recovered: MissionService | undefined;
  try {
    const m = service.create('recovery', plan(task('remote'), task('dependent', ['remote'])));
    await flush();
    assert.ok(f.active.has('remote'));
    // Copy the committed row to a fresh connection exactly as a restarted process sees it.
    const second = fixture(false);
    try {
      await second.create().close();
      const snapshot = f.db.prepare('SELECT * FROM vela_missions WHERE id=?').get(m.id)!;
      second.db.prepare('INSERT INTO vela_missions VALUES(?,?,?,?,?,?,?)').run(snapshot.id, snapshot.request_id,
        snapshot.request_digest, snapshot.scope_key, snapshot.pending, snapshot.active, snapshot.json);
      recovered = second.create();
      const observed = recovered.read(m.id, scope);
      assert.equal(observed.tasks[0].state, 'uncertain');
      assert.equal(observed.outcome, 'uncertain');
      assert.equal(observed.disposition, 'paused');
      assert.ok(observed.events.some(e => e.kind === 'recovered'));
      assert.throws(() => recovered!.control(m.id, scope, observed.revision, { type: 'retry', taskId: 'remote' }), /mission_retry_denied/);
      await flush();
      assert.equal(second.active.size, 0);
    } finally { await recovered?.close(); second.db.close(); }
  } finally { await service.close(); f.db.close(); }
});

test('pressure defers admission and cancelling a branch preserves an independent branch', async () => {
  const f = fixture(), service = f.create();
  try {
    f.pressure(true);
    const m = service.create('pressure', plan(task('branch'), task('dependent', ['branch']), task('independent')));
    await flush();
    const waiting = service.read(m.id, scope);
    assert.equal(waiting.waits.branch, 'resource-pressure');
    assert.equal(waiting.waits.dependent, 'dependencies');
    assert.equal(f.active.size, 0);
    f.pressure(false);
    service.control(m.id, scope, waiting.revision, { type: 'concurrency', concurrency: 2 });
    await flush();
    assert.equal(f.active.size, 2);
    service.control(m.id, scope, service.read(m.id, scope).revision, { type: 'cancel-branch', taskId: 'branch' });
    f.active.get('independent')!.release();
    await flush();
    const outcome = service.read(m.id, scope);
    assert.equal(outcome.tasks.find(t => t.id === 'branch')?.state, 'cancelled');
    assert.equal(outcome.tasks.find(t => t.id === 'dependent')?.state, 'cancelled');
    assert.equal(outcome.tasks.find(t => t.id === 'independent')?.state, 'verified');
    assert.equal(outcome.outcome, 'blocked');
  } finally { await service.close(); f.db.close(); }
});
