import { strict as assert } from 'node:assert';
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';
import { test } from 'node:test';
import { setImmediate as flush } from 'node:timers/promises';
import { MissionService, validateMissionPlan, type MissionServiceHost } from '../src/mission-service.mts';
import { nativeMissionPlan, replanNativeMission } from '../src/mission-native.mts';
import { MISSION_LIMITS, type Mission, type MissionAdmission, type MissionExecutionContext, type MissionExecutor, type MissionPlan, type MissionScope,
  type MissionTaskPlan } from '../src/mission-contracts.mts';
import type { MissionContextSource } from '../../vela-core/src/mission-context.mts';

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
    catch (e) { db.exec('ROLLBACK'); throw e; } }, authorized: (candidate: MissionScope) =>
    access && candidate.workspaceId === scope.workspaceId && candidate.projectId === scope.projectId,
  executors: { fixture: executor }, laneLimit: () => 3, underPressure: () => pressure };
  return { db, active, host, create: () => new MissionService(host),
    revoke: () => { access = false; }, pressure: (value: boolean) => { pressure = value; } };
}

function revisionFixture(reassign?: MissionServiceHost['reassign']) {
  const f = fixture();
  const native = { ...f.host.executors.fixture, lane: 'native' };
  const specialist = { ...f.host.executors.fixture, lane: 'chatgpt-plan-responses', replaySafe: false };
  const host = { ...f.host, reassign, executors: { 'sample.cpu': native, 'sample.ram': native,
    'join.samples': native, 'codex.project-check': { ...native, lane: 'codex-local-check' }, 'chatgpt.specialist': specialist } };
  return { ...f, host, create: () => new MissionService(host) };
}

const revisionTask = (id: string, executor: string, dependencies: string[] = []) => ({ ...task(id, dependencies), executor });

test('a source edit fences in-flight results, invalidates downstream proof and permits reviewed native retry', async () => {
  const f = fixture();
  const ref = { kind: 'resource' as const, id: 'synthetic-note' };
  let version = 1;
  const source: MissionContextSource = {
    scopeVersion: () => 'fixture-policy',
    retrieve: () => [ref],
    read: () => ({ ref, version, locator: 'synthetic-note', scope: { kind: 'workspace', id: scope.workspaceId },
      certainty: 'observed', content: 'Synthetic objective sample ' + version }),
  };
  const service = new MissionService({ ...f.host, contextSource: (_mission, task) => task.id === 'inspect' ? source : undefined });
  try {
    const { id } = service.create('source-edits', plan(task('inspect'), task('join', ['inspect'])));
    const read = () => service.read(id, scope);
    await flush();
    assert.equal(f.active.get('inspect')?.context.context.manifest.sources[0]?.version, 1);
    f.active.get('inspect')!.release();
    await flush();
    assert.equal(read().tasks[0].state, 'verified');
    assert(f.active.has('join'));
    version++;
    f.active.get('join')!.release();
    await flush();
    const stale = read();
    assert.equal(stale.outcome, 'blocked');
    assert.equal(stale.tasks[0].detail, 'mission_source_changed_since_verification');
    assert.equal(stale.tasks[1].detail, 'mission_context_changed_during_execution');
    assert(stale.tasks.every(task => !task.attempts[0].evidence && !task.attempts[0].verification && !task.attempts[0].context));
    service.control(id, scope, stale.revision, { type: 'retry', taskId: 'inspect' });
    await flush();
    assert.equal(f.active.get('inspect')?.context.context.manifest.sources[0]?.version, 2);
    f.active.get('inspect')!.release();
    await flush();
    service.control(id, scope, read().revision, { type: 'retry', taskId: 'join' });
    await flush();
    f.active.get('join')!.release();
    await flush();
    assert.equal(read().outcome, 'verified');
    assert(read().tasks.every(task => task.attempts[1].verification?.passed));
  } finally { await service.close(); f.db.close(); }
});

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

test('an observed backend outlier amends the graph before its report and retains the triggering attempt', async () => {
  const f = fixture(), order: string[] = [];
  let committedAtSettlement: Record<string, SQLOutputValue> | undefined;
  const probe: MissionExecutor = { lane: 'native', replaySafe: true, available: () => true,
    async run(context) {
      order.push(context.task.id);
      if (context.task.id === 'report') assert.deepEqual(context.task.dependencies, ['backend', 'backend-repeat']);
      return { source: 'synthetic-timer-sample', value: { timerOvershootMs: context.task.id === 'backend' ? 28 : 0 } };
    },
    verify: () => ({ passed: true, detail: 'Synthetic measurement passed' }),
  };
  const service = new MissionService({ ...f.host, replan: replanNativeMission, observe: (mission, event) => {
    if (event.kind === 'settled' && event.taskId === 'backend')
      committedAtSettlement = f.db.prepare('SELECT * FROM vela_missions WHERE id=?').get(mission.id);
  },
    executors: { 'sample.backend': probe, 'join.samples': probe } });
  try {
    const original = plan({ ...task('backend'), executor: 'sample.backend' },
      { ...task('report', ['backend']), executor: 'join.samples' });
    const { id } = service.create('timer-outlier', original);
    await flush();
    const observed = service.read(id, scope);
    assert.equal(observed.outcome, 'verified');
    assert.equal(observed.planRevision, 2);
    assert.equal(observed.objective, original.objective);
    assert.deepEqual(observed.criteria, original.criteria);
    assert.deepEqual(order, ['backend', 'backend-repeat', 'report']);
    const revision = observed.events.find(event => event.kind === 'revised')!;
    assert.equal(revision.taskId, 'backend');
    assert.equal(revision.attemptId, observed.tasks[0].attempts[0].id);
    assert.ok(revision.seq < observed.events.find(event => event.taskId === 'backend-repeat' && event.kind === 'started')!.seq);

    const checkpoint = committedAtSettlement;
    assert.ok(checkpoint, 'The observer must see a committed settlement checkpoint');
    const committed = JSON.parse(String(checkpoint.json)) as Mission;
    assert.equal(committed.tasks.find(node => node.id === 'backend')?.state, 'verified');
    assert.deepEqual(committed.tasks.find(node => node.id === 'report')?.dependencies, ['backend', 'backend-repeat']);
    assert.deepEqual(committed.events.slice(-2).map(event => event.kind), ['settled', 'revised']);
    const second = fixture();
    const reopenedHost = { ...second.host, replan: replanNativeMission, executors: { 'sample.backend': probe, 'join.samples': probe } };
    let recovered: MissionService | undefined;
    try {
      await new MissionService(reopenedHost).close();
      second.db.prepare('INSERT INTO vela_missions VALUES(?,?,?,?,?,?,?)').run(checkpoint.id, checkpoint.request_id,
        checkpoint.request_digest, checkpoint.scope_key, checkpoint.pending, checkpoint.active, checkpoint.json);
      recovered = new MissionService(reopenedHost);
      const durable = recovered.read(id, scope);
      assert.equal(durable.disposition, 'paused');
      assert.equal(durable.tasks.find(node => node.id === 'backend-repeat')?.state, 'queued');
      assert.equal(durable.waits.report, 'dependencies');
      assert.equal(durable.tasks.find(node => node.id === 'report')?.attempts.length, 0);

      await recovered.close();
      const legacy = { ...committed, revision: committed.revision - 1, planRevision: committed.planRevision - 1,
        events: committed.events.slice(0, -1), tasks: committed.tasks.filter(node => node.id !== 'backend-repeat') };
      legacy.tasks.find(node => node.id === 'report')!.dependencies = ['backend'];
      second.db.prepare('UPDATE vela_missions SET pending=?,active=?,json=? WHERE id=?')
        .run(checkpoint.pending, checkpoint.active, JSON.stringify(legacy), checkpoint.id);
      recovered = new MissionService(reopenedHost);
      const beforeResume = recovered.read(id, scope);
      assert.equal(beforeResume.disposition, 'paused');
      assert.ok(!beforeResume.tasks.some(node => node.id === 'backend-repeat'));
      const resumed = recovered.control(id, scope, beforeResume.revision, { type: 'resume' });
      assert.deepEqual(resumed.tasks.find(node => node.id === 'report')?.dependencies, ['backend', 'backend-repeat']);
      await flush();
      assert.deepEqual(order.slice(-2), ['backend-repeat', 'report']);
      assert.equal(recovered.read(id, scope).outcome, 'verified');
    } finally { await recovered?.close(); second.db.close(); }
  } finally { await service.close(); f.db.close(); }
});

test('a required amendment beyond the graph limit retains sample evidence and blocks report dispatch', async () => {
  const f = fixture(), dispatched: string[] = [];
  const probe: MissionExecutor = { lane: 'native', replaySafe: true, available: () => true,
    async run({ task }) {
      dispatched.push(task.id);
      return { source: 'synthetic-timer-sample', value: { timerOvershootMs: task.id === 'backend' ? 28 : 0 } };
    },
    verify: () => ({ passed: true, detail: 'Synthetic timer sample verified' }),
  };
  const service = new MissionService({ ...f.host, replan: replanNativeMission,
    executors: { 'sample.backend': probe, 'join.samples': probe } });
  try {
    const original = plan(revisionTask('backend', 'sample.backend'), revisionTask('report', 'join.samples', ['backend']),
      ...Array.from({ length: MISSION_LIMITS.tasks - 2 }, (_, index) => revisionTask('followup-' + index, 'join.samples', ['report'])));
    const { id } = service.create('replan-capacity-denial', original);
    await flush();
    const blocked = service.read(id, scope);
    const sample = blocked.tasks.find(node => node.id === 'backend')!;
    assert.equal(blocked.outcome, 'blocked');
    assert.equal(sample.state, 'blocked');
    assert.equal(sample.detail, 'mission_required_replan_blocked');
    assert.equal(sample.attempts[0].outcome, 'blocked');
    assert.equal(sample.attempts[0].verification?.passed, true);
    assert.deepEqual(sample.attempts[0].evidence?.value, { timerOvershootMs: 28 });
    assert.deepEqual(blocked.tasks.find(node => node.id === 'report')?.dependencies, ['backend']);
    assert.equal(blocked.planRevision, 1);
    assert.equal(blocked.events.at(-1)?.detail, 'blocked');
    assert.deepEqual(dispatched, ['backend']);

    const other = service.create('replan-independent-mission', plan(revisionTask('independent', 'sample.backend')));
    await flush();
    assert.equal(service.read(other.id, scope).outcome, 'verified');
    assert.deepEqual(dispatched, ['backend', 'independent']);
  } finally { await service.close(); f.db.close(); }
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

test('host admission holds queued work, preserves running workers and records only dispatched attempts', async () => {
  const f = fixture(), demand: boolean[] = [];
  const observedAt = new Date().toISOString();
  const memory: MissionAdmission = { workerLimit: 0, reasons: ['physical-memory'],
    readings: { availableMemoryBytes: { value: 256 * 1024 * 1024, observedAt } } };
  const cpu: MissionAdmission = { workerLimit: 1, reasons: ['cpu-load'], readings: { cpuPercent: { value: 95, observedAt } } };
  const normal: MissionAdmission = { workerLimit: 3, reasons: [], readings: { cpuPercent: { value: 40, observedAt } } };
  let policy = memory;
  const service = new MissionService({ ...f.host, admission: needed => { demand.push(needed); return policy; } });
  try {
    const { id } = service.create('sampled-admission', plan(task('first'), task('second'), task('third')));
    const read = () => service.read(id, scope);
    await flush();
    const samples = demand.length;
    const held = read();
    assert.equal(held.waits.first, 'resource-pressure');
    assert.deepEqual(held.admission, memory);
    assert.ok(held.tasks.every(task => !task.attempts.length));
    assert.equal(demand.length, samples, 'projection must not trigger admission sampling');

    policy = normal;
    service.capacityChanged();
    await flush();
    assert.deepEqual([...f.active.keys()], ['first', 'second']);
    assert.deepEqual(read().tasks[0].attempts[0].admission, normal);
    policy = cpu;
    service.capacityChanged();
    await flush();
    assert.deepEqual([...f.active.keys()], ['first', 'second']);
    assert.ok([...f.active.values()].every(worker => !worker.context.signal.aborted));
    f.active.get('first')!.release();
    await flush();
    assert.equal(read().waits.third, 'resource-pressure');
    assert.deepEqual(read().admission, cpu);
    assert.deepEqual([...f.active.keys()], ['second']);
    f.active.get('second')!.release();
    await flush();
    assert.deepEqual([...f.active.keys()], ['third']);
    const started = read().tasks[2].attempts[0];
    assert.deepEqual(started.admission, cpu);
    assert.equal(demand.at(-1), false);
    f.active.get('third')!.release();
    await flush();
    assert.equal(read().outcome, 'verified');
    assert.equal(read().admission, undefined);
    assert.deepEqual(read().tasks[2].attempts[0].admission, cpu);
  } finally { await service.close(); f.db.close(); }
});

test('queued admission resamples and recovers without an external wake signal', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  let workerLimit = 0;
  const service = new MissionService({ ...f.host, admission: () => ({ workerLimit, reasons: [], readings: {} }) });
  try {
    const { id } = service.create('admission-recheck', plan(task('waiting')));
    await flush();
    assert.equal(service.read(id, scope).waits.waiting, 'resource-pressure');
    workerLimit = 1;
    t.mock.timers.tick(1500);
    await flush();
    assert.deepEqual([...f.active.keys()], ['waiting']);
    f.active.get('waiting')!.release();
    await flush();
    assert.equal(service.read(id, scope).outcome, 'verified');
  } finally { await service.close(); f.db.close(); }
});

test('ready tasks honor aging, explicit priority and the longest feasible dependency path', async () => {
  const f = fixture();
  let limit = 0;
  const service = new MissionService({ ...f.host, admission: () => ({ workerLimit: limit, reasons: [], readings: {} }) });
  try {
    const { id } = service.create('admission-order', plan(task('ordinary'), task('urgent'), task('critical'),
      task('tail', ['critical']), task('aged')));
    const read = () => service.read(id, scope);
    const priority = service.control(id, scope, read().revision, { type: 'priority', taskId: 'urgent', priority: 2 });
    service.control(id, scope, priority.revision, { type: 'priority', taskId: 'aged', priority: -2 });
    const row = f.db.prepare('SELECT json FROM vela_missions WHERE id=?').get(id)!;
    const stored = JSON.parse(String(row.json)) as Mission;
    stored.tasks.find(task => task.id === 'aged')!.queuedAt = new Date(Date.now() - 31_000).toISOString();
    f.db.prepare('UPDATE vela_missions SET json=? WHERE id=?').run(JSON.stringify(stored), id);
    limit = 1;
    service.capacityChanged();
    await flush();
    for (const id of ['aged', 'urgent', 'critical']) {
      assert.deepEqual([...f.active.keys()], [id]);
      f.active.get(id)!.release();
      await flush();
    }
    assert.deepEqual([...f.active.keys()], ['ordinary']);
    f.active.get('ordinary')!.release();
    await flush();
    assert.deepEqual([...f.active.keys()], ['tail']);
    f.active.get('tail')!.release();
    await flush();
    assert.equal(read().outcome, 'verified');
  } finally { await service.close(); f.db.close(); }
});

test('reviewed replacement preserves failed evidence and rewires dispatch after reopening', async () => {
  const f = revisionFixture();
  let service = f.create();
  const original = plan(revisionTask('prerequisite', 'sample.cpu'),
    { ...revisionTask('probe', 'sample.ram', ['prerequisite']), claims: [{ resource: 'memory', mode: 'exclusive' }] },
    revisionTask('report', 'join.samples', ['probe']));
  const change = { type: 'replace', taskId: 'probe' } as const;
  try {
    const { id } = service.create('reviewed-replacement', original);
    const read = () => service.read(id, scope);
    await flush();
    f.active.get('prerequisite')!.release();
    await flush();
    const paused = service.control(id, scope, read().revision, { type: 'pause' });
    assert.throws(() => service.previewRevision(id, scope, paused.revision, change), /mission_revision_denied/);
    f.active.get('probe')!.release(false);
    await flush();
    const failed = read();
    const originalProbe = failed.tasks.find(node => node.id === 'probe')!;
    assert.equal(originalProbe.state, 'failed');
    const review = service.previewRevision(id, scope, failed.revision, change);
    assert.deepEqual(read(), failed, 'Preview does not change the journal');
    assert.throws(() => service.applyRevision(id, scope, failed.revision, change, '0'.repeat(64)), /mission_revision_preview_changed/);
    const revised = service.applyRevision(id, scope, failed.revision, change, review.fingerprint);
    const replacement = revised.tasks.find(node => node.criterion === originalProbe.criterion)!;
    assert.ok(replacement && replacement.id !== originalProbe.id);
    assert.deepEqual(replacement.dependencies, ['prerequisite']);
    assert.deepEqual(replacement.claims, originalProbe.claims);
    assert.equal(replacement.objective, originalProbe.objective);
    assert.equal(replacement.executor, originalProbe.executor);
    assert.equal(replacement.maxAttempts, originalProbe.maxAttempts - originalProbe.attempts.length);
    assert.deepEqual(revised.tasks.find(node => node.id === 'report')?.dependencies, [replacement.id]);
    assert.deepEqual(revised.retiredTasks?.find(node => node.id === 'probe')?.attempts, originalProbe.attempts);
    assert.deepEqual(revised.criteria, original.criteria);
    assert.equal(revised.objective, original.objective);
    assert.equal(revised.planRevision, failed.planRevision + 1);
    assert.deepEqual(revised.events.find(event => event.kind === 'revised')?.change, change);
    assert.throws(() => service.applyRevision(id, scope, failed.revision, change, review.fingerprint), /mission_revision_changed/);

    await service.close();
    service = f.create();
    assert.deepEqual(read().retiredTasks, revised.retiredTasks);
    assert.equal(read().disposition, 'paused');
    await flush();
    assert.equal(f.active.size, 0);
    service.control(id, scope, read().revision, { type: 'resume' });
    await flush();
    assert.deepEqual([...f.active.keys()], [replacement.id]);
    assert.equal(f.active.get(replacement.id)?.context.dependencies[0]?.attemptId, failed.tasks[0].attempts[0].id);
    f.active.get(replacement.id)!.release();
    await flush();
    assert.deepEqual([...f.active.keys()], ['report']);
    assert.equal(f.active.get('report')?.context.dependencies[0]?.attemptId,
      read().tasks.find(node => node.id === replacement.id)?.attempts[0].id);
    f.active.get('report')!.release();
    await flush();
    assert.equal(read().outcome, 'verified');
  } finally { await service.close(); f.db.close(); }
});

test('reviewed edges enforce origin, revision, graph validity and dependency order', async () => {
  const f = revisionFixture();
  const workroomScope = { ...scope, workspaceId: 'workroom' };
  const service = new MissionService({ ...f.host, authorized: candidate => f.host.authorized(candidate) ||
    candidate.projectId === workroomScope.projectId && candidate.workspaceId === workroomScope.workspaceId });
  const change = { type: 'dependencies' as const, taskId: 'ram', dependencies: ['cpu'] };
  try {
    const { id, revision } = service.create('reviewed-edges', plan(revisionTask('cpu', 'sample.cpu'),
      revisionTask('ram', 'sample.ram'), revisionTask('report', 'join.samples', ['ram']),
      revisionTask('project-tests', 'codex.project-check')));
    const read = () => service.read(id, scope);
    assert.throws(() => service.previewRevision(id, scope, revision, change), /mission_revision_denied/);
    const paused = service.control(id, scope, revision, { type: 'pause' });
    const attached = service.attachWorkroom(id, scope, { kind: 'workroom', workspaceId: workroomScope.workspaceId,
      title: 'Synthetic workroom', templateId: 'fixture' });
    assert.equal(service.read(id, workroomScope).id, id);
    assert.throws(() => service.previewRevision(id, workroomScope, attached.revision, change), /mission_revision_denied/);
    assert.throws(() => service.previewRevision(id, { ...scope, projectId: 'other' }, attached.revision, change), /mission_not_found|mission_revision_denied/);
    assert.throws(() => service.previewRevision(id, scope, paused.revision, change), /mission_revision_changed/);
    assert.throws(() => service.previewRevision(id, scope, attached.revision, { ...change, dependencies: ['report'] }), /mission_dependency_cycle/);
    assert.throws(() => service.previewRevision(id, scope, attached.revision, { ...change, dependencies: ['missing'] }), /missing_mission_dependency/);
    assert.throws(() => service.previewRevision(id, scope, attached.revision, { ...change, dependencies: ['cpu', 'cpu'] }), /invalid_mission_revision/);
    assert.throws(() => service.previewRevision(id, scope, attached.revision, { ...change, taskId: 'report', dependencies: [] }), /mission_revision_dependency_denied/);
    assert.throws(() => service.previewRevision(id, scope, attached.revision, { type: 'replace', taskId: 'project-tests' }), /mission_revision_task_denied/);
    const review = service.previewRevision(id, scope, attached.revision, change);
    assert.throws(() => service.applyRevision(id, scope, attached.revision, { ...change, taskId: 'cpu', dependencies: ['ram'] },
      review.fingerprint), /mission_revision_preview_changed/);
    const revised = service.applyRevision(id, scope, attached.revision, change, review.fingerprint);
    await flush();
    assert.equal(f.active.size, 0);
    service.control(id, scope, revised.revision, { type: 'resume' });
    await flush();
    assert.deepEqual([...f.active.keys()].sort(), ['cpu', 'project-tests']);
    f.active.get('cpu')!.release();
    await flush();
    assert.equal(f.active.get('ram')?.context.dependencies[0]?.attemptId, read().tasks[0].attempts[0].id);
    assert.ok(!f.active.has('report'));
    f.active.get('ram')!.release();
    f.active.get('project-tests')!.release();
    await flush();
    f.active.get('report')!.release();
    await flush();
    assert.equal(read().outcome, 'verified');
  } finally { await service.close(); f.db.close(); }
});

test('reviewed changes consume the existing mission revision budget', async () => {
  const f = revisionFixture(), service = f.create();
  try {
    const { id, revision } = service.create('reviewed-revision-budget', plan(revisionTask('cpu', 'sample.cpu'), revisionTask('ram', 'sample.ram')));
    let current = service.control(id, scope, revision, { type: 'pause' });
    const change = { type: 'dependencies' as const, taskId: 'ram' };
    for (let index = 0; index < MISSION_LIMITS.revisions; index++) {
      const next = { ...change, dependencies: index % 2 === 0 ? ['cpu'] : [] };
      const preview = service.previewRevision(id, scope, current.revision, next);
      current = service.applyRevision(id, scope, current.revision, next, preview.fingerprint);
    }
    assert.equal(current.events.filter(event => event.kind === 'revised').length, MISSION_LIMITS.revisions);
    assert.throws(() => service.previewRevision(id, scope, current.revision, { ...change, dependencies: ['cpu'] }), /mission_revision_denied/);
    await flush();
    assert.equal(f.active.size, 0);
  } finally { await service.close(); f.db.close(); }
});

test('retiring an equivalent task preserves acceptance and the successor prerequisites', async () => {
  const f = revisionFixture(), service = f.create();
  const obsolete = revisionTask('obsolete', 'sample.ram', ['required']);
  const original = plan(revisionTask('required', 'sample.cpu'), revisionTask('extra', 'sample.cpu'), obsolete,
    { ...obsolete, id: 'weaker', dependencies: [] }, { ...obsolete, id: 'successor', dependencies: ['required', 'extra'] },
    revisionTask('report', 'join.samples', ['obsolete']));
  original.criteria = [...new Set(original.criteria)];
  try {
    const { id, revision } = service.create('reviewed-retirement', original);
    const paused = service.control(id, scope, revision, { type: 'pause' });
    const change = { type: 'retire', taskId: 'obsolete', successorId: 'successor' } as const;
    assert.throws(() => service.previewRevision(id, scope, paused.revision, { ...change, successorId: 'weaker' }),
      /mission_revision_task_denied|mission_revision_dependency_denied/);
    const preview = service.previewRevision(id, scope, paused.revision, change);
    const revised = service.applyRevision(id, scope, paused.revision, change, preview.fingerprint);
    assert.ok(!revised.tasks.some(node => node.id === 'obsolete'));
    assert.equal(revised.retiredTasks?.at(-1)?.id, 'obsolete');
    assert.deepEqual(revised.criteria, original.criteria);
    assert.deepEqual(revised.tasks.find(node => node.id === 'report')?.dependencies, ['successor']);
    service.control(id, scope, revised.revision, { type: 'resume' });
    await flush();
    f.active.get('required')!.release();
    await flush();
    assert.ok(!f.active.has('successor'));
    assert.ok(!f.active.has('report'));
    f.active.get('extra')!.release();
    f.active.get('weaker')!.release();
    await flush();
    assert.ok(!f.active.has('obsolete'));
    assert.equal(f.active.get('successor')?.context.dependencies.length, 2);
    f.active.get('successor')!.release();
    await flush();
    assert.deepEqual([...f.active.keys()], ['report']);
    f.active.get('report')!.release();
    await flush();
    assert.equal(service.read(id, scope).outcome, 'verified');
  } finally { await service.close(); f.db.close(); }
});

test('reviewed specialist reassignment binds the current trusted profile and refuses attempted work', async () => {
  const specialist = (id: string, version: number): NonNullable<MissionTaskPlan['specialist']> => ({
    role: id, instructions: `Synthetic instructions for ${id}`, provider: 'chatgpt-plan-responses', model: 'fixture-model',
    connectionVersion: 1, settingsStamp: 'synthetic-settings', profile: { id, title: id,
      profileVersion: version, resourceVersion: version, instructions: `Synthetic profile ${version}` },
  });
  let version = 1;
  const f = revisionFixture((_mission, _task, id) => id === 'approved' ? specialist(id, version) : undefined);
  const service = f.create();
  try {
    const original = plan({ ...revisionTask('analysis', 'chatgpt.specialist'), specialist: specialist('original', 1) },
      revisionTask('report', 'join.samples', ['analysis']));
    const { id, revision } = service.create('reviewed-reassignment', original);
    const paused = service.control(id, scope, revision, { type: 'pause' });
    const change = { type: 'reassign', taskId: 'analysis', agentProfileId: 'approved' } as const;
    assert.throws(() => service.previewRevision(id, scope, paused.revision, { ...change, agentProfileId: 'unavailable' }),
      /mission_revision_reassignment_unavailable/);
    const review = service.previewRevision(id, scope, paused.revision, change);
    version++;
    assert.throws(() => service.applyRevision(id, scope, paused.revision, change, review.fingerprint), /mission_revision_preview_changed/);
    const fresh = service.previewRevision(id, scope, paused.revision, change);
    const revised = service.applyRevision(id, scope, paused.revision, change, fresh.fingerprint);
    assert.deepEqual(revised.tasks[0].specialist, specialist('approved', 2));
    assert.deepEqual(revised.criteria, original.criteria);
    assert.equal(revised.tasks[0].objective, original.tasks[0].objective);
    service.control(id, scope, revised.revision, { type: 'resume' });
    await flush();
    assert.deepEqual(f.active.get('analysis')?.context.task.specialist, specialist('approved', 2));
    service.control(id, scope, service.read(id, scope).revision, { type: 'pause' });
    f.active.get('analysis')!.release();
    await flush();
    const verified = service.read(id, scope);
    assert.equal(verified.tasks[0].state, 'verified');
    assert.throws(() => service.previewRevision(id, scope, verified.revision, change), /mission_revision_task_denied/);
  } finally { await service.close(); f.db.close(); }
});
