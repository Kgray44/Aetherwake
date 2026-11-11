import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as wait } from 'node:timers/promises';
import { createMissionAdmission } from './mission-admission.mts';
import { MISSION_LIMITS, type MissionTaskPlan } from './mission-contracts.mts';
import { createMissionCpuPool } from './mission-cpu-pool.mts';
import { createPooledBackendSourceExecutor } from './mission-native.mts';
import { MissionService } from './mission-service.mts';
import type { GpuProcessBudget, ResourceLease } from './resource-policy.mts';
import { gpuReadbackRamReservationBytes, gpuReadbackReservationBytes, openWindowsGpuReadback, verifiedGpuReadback } from './windows-gpu-readback.mts';

// Opt-in Windows hardware verification. The queue and receipts use the real MissionService.
const scope = { workspaceId: 'gpu-verification', projectId: null };
const source = 'windows:d3d11-verified-readback';
const serialMixed = process.argv.includes('--serial-mixed');
const mixed = serialMixed || process.argv.includes('--mixed');
const cancelAfterDispatch = process.argv.includes('--cancel-after-dispatch');
const cpuPool = createMissionCpuPool(1);
const cpuExecutor = createPooledBackendSourceExecutor(cpuPool);
const apiSource = 'fixture:local-http-resource-response';
const loopback = createServer((_request, response) => {
  setTimeout(() => response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"fixture":"resource-api"}'), 750);
});
let apiUrl: string | undefined;
const database = new DatabaseSync(':memory:');
const maxWorkers = MISSION_LIMITS.workers;
const governor = createMissionAdmission({ maxWorkers, readWindowsPressure: null, resourcePolicy: {
  mode: 'balanced', limits: { cpu: maxWorkers, build: 1, gpu: 1, host_io: maxWorkers, remote: maxWorkers },
} });
let worker: ReturnType<typeof openWindowsGpuReadback> | undefined;
let budget: GpuProcessBudget | undefined, lease: ResourceLease | undefined;
let dispatched = false;
let dispatchReady = false;
const scheduler = new MissionService({
  db: database,
  atomic<T>(work: () => T) {
    database.exec('BEGIN');
    try { const result = work(); database.exec('COMMIT'); return result; }
    catch (error) { database.exec('ROLLBACK'); throw error; }
  },
  authorized: value => value.workspaceId === scope.workspaceId && value.projectId === null,
  executors: {
    'gpu.readback-verification': {
      lane: 'native', replaySafe: true, available: () => process.platform === 'win32',
      async run({ signal }) {
        assert.ok(worker && lease);
        dispatched = true;
        return { source, value: await worker.run(lease, signal) };
      },
      verify(evidence) {
        return { passed: evidence.source === source && verifiedGpuReadback(evidence.value),
          detail: 'Verified every staged Direct3D buffer digest' };
      },
    },
    'inspect.backend-source': cpuExecutor,
    'fixture.resource-api': {
      lane: 'fixture-api', replaySafe: true, available: () => !!apiUrl,
      async run({ signal }) {
        assert.ok(apiUrl);
        const start = performance.now();
        const response = await fetch(apiUrl, { signal });
        assert.equal(response.status, 200);
        const value: unknown = await response.json();
        return { source: apiSource, value, telemetry: { providerCalls: 1, durationMs: performance.now() - start } };
      },
      verify(evidence) {
        return { passed: evidence.source === apiSource && (evidence.value as { fixture?: string }).fixture === 'resource-api',
          detail: 'Verified the isolated loopback HTTP response' };
      },
    },
  },
  laneLimit: lane => mixed && lane === 'native' ? 2 : 1,
  admission: governor.read,
  resources: {
    canAcquire: (_lane, executor) => dispatchReady && (executor === 'gpu.readback-verification' ?
      !!budget && governor.canLease('gpu') : governor.canLease(executor === 'inspect.backend-source' ? 'cpu' : 'remote')),
    acquire(_lane, attempt, executor) {
      if (!dispatchReady) return;
      if (executor !== 'gpu.readback-verification')
        return governor.tryLease({ ...attempt, kind: executor === 'inspect.backend-source' ? 'cpu' : 'remote' });
      if (!budget) return;
      const reserved = governor.tryLease({ ...attempt, kind: 'gpu', gpuContextId: budget.contextId,
        estimatedVramBytes: gpuReadbackReservationBytes, estimatedRamBytes: gpuReadbackRamReservationBytes });
      if (!reserved) return;
      lease = reserved;
      return {
        get active() { return reserved.active; },
        receipt: reserved.receipt, checkpointRequested: reserved.checkpointRequested,
        release() {
          reserved.release();
          governor.noteGpuBudget(null);
          budget = undefined;
          void worker?.close();
        },
      };
    },
  },
});

try {
  if (process.platform !== 'win32') throw Error('windows_gpu_worker_unavailable');
  if (mixed && cancelAfterDispatch) throw Error('choose_one_gpu_fixture_mode');
  if (mixed) {
    await new Promise<void>((resolve, reject) => {
      loopback.once('error', reject);
      loopback.listen(0, '127.0.0.1', () => resolve());
    });
    const address = loopback.address();
    assert.ok(address && typeof address !== 'string');
    apiUrl = `http://127.0.0.1:${address.port}/`;
  }
  const started = performance.now();
  const tasks: MissionTaskPlan[] = [{ id: 'gpu-readback', objective: 'Copy fixed buffers and verify every staged digest', criterion: 'gpu-copy-digests',
      executor: 'gpu.readback-verification', dependencies: [], claims: [{ resource: 'host.gpu-readback', mode: 'exclusive' }],
      timeoutMs: 10_000, maxAttempts: 1 }];
  if (mixed) {
    tasks.push({ id: 'cpu-inspection', objective: 'Inspect the shipped backend source', criterion: 'cpu-digest',
      executor: 'inspect.backend-source', dependencies: [], claims: [], timeoutMs: 10_000, maxAttempts: 1 },
    { id: 'remote-response', objective: 'Read the local HTTP fixture', criterion: 'loopback-response',
      executor: 'fixture.resource-api', dependencies: [], claims: [], timeoutMs: 10_000, maxAttempts: 1 });
  }
  const { id, revision } = scheduler.create('gpu-readback-native', {
    objective: 'Verify bounded Windows GPU buffer copies', scope, criteria: tasks.map(task => task.criterion), tasks,
  });
  if (mixed) scheduler.control(id, scope, revision, { type: 'concurrency', concurrency: serialMixed ? 1 : maxWorkers });
  await wait(0);
  const queued = scheduler.read(id, scope);
  assert.equal(queued.outcome, 'queued');
  assert.ok(queued.tasks.every(task => task.attempts.length === 0));
  worker = openWindowsGpuReadback();
  const observedBudget = await worker.budget;
  budget = observedBudget;
  assert.ok(observedBudget.budgetBytes - observedBudget.usedBytes >= gpuReadbackReservationBytes, 'fixture_vram_budget_unavailable');
  const setupMs = Math.round(performance.now() - started);
  assert.ok(governor.noteGpuBudget(observedBudget));
  dispatchReady = true;
  scheduler.capacityChanged();
  if (cancelAfterDispatch) {
    while (!dispatched && performance.now() - started < 35_000) await wait(1);
    assert.ok(dispatched, 'gpu_worker_never_dispatched');
    const active = scheduler.read(id, scope);
    scheduler.control(id, scope, active.revision, { type: 'cancel' });
    assert.equal(governor.inspectPolicy().active.gpu, 1, 'Cancellation cannot release before process exit');
  }
  let mission = scheduler.read(id, scope);
  while (['queued', 'running', 'cancelling'].includes(mission.outcome)) {
    if (performance.now() - started > 35_000) throw Error('gpu_mission_verification_timeout');
    await wait(20);
    mission = scheduler.read(id, scope);
  }
  assert.equal(mission.outcome, cancelAfterDispatch ? 'cancelled' : 'verified');
  const attempt = mission.tasks.find(task => task.id === 'gpu-readback')?.attempts[0];
  assert.equal(attempt?.resourceLease?.kind, 'gpu');
  assert.equal(attempt.resourceLease.reservedVramBytes, gpuReadbackReservationBytes);
  const value = attempt.evidence?.value;
  if (cancelAfterDispatch) assert.equal(attempt.verification?.passed, undefined);
  else assert.ok(verifiedGpuReadback(value));
  assert.equal(governor.inspectPolicy().active.gpu, 0);
  if (mixed) {
    assert.equal(mission.profile.peakWorkers, serialMixed ? 1 : 3);
    assert.deepEqual(mission.tasks.map(task => task.attempts[0]?.resourceLease?.kind).sort(), ['cpu', 'gpu', 'remote']);
  }
  console.log(JSON.stringify({ contract: 'aerynth.gpu-readback-native@1', queuedUntilBudget: true, setupMs,
    queueMs: attempt.timing?.queueMs, executionMs: attempt.timing?.executionMs,
    reservedVramBytes: attempt.resourceLease.reservedVramBytes, reservedRamBytes: attempt.resourceLease.reservedRamBytes,
    admittedBudgetBytes: attempt.resourceLease.gpuBudgetBytes,
    resourceReleased: true, outcome: mission.outcome, ...(value === undefined ? {} : { result: value }),
    ...(mixed ? { arm: serialMixed ? 'serial' : 'concurrent', totalMs: Math.round(performance.now() - started),
      peakWorkers: mission.profile.peakWorkers, verifiedTasks: mission.tasks.length,
      timings: mission.tasks.map(task => ({ taskId: task.id, ...task.attempts[0]?.timing })) } : {}) }));
} finally {
  await scheduler.close();
  await worker?.close();
  await cpuPool.close();
  if (loopback.listening) {
    loopback.closeAllConnections();
    await new Promise<void>(resolve => loopback.close(() => resolve()));
  }
  governor.dispose();
  database.close();
}
