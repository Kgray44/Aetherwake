import { DatabaseSync } from 'node:sqlite';
import { availableParallelism, freemem, totalmem } from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { createMissionAdmission } from './mission-admission.mts';
import { MISSION_LIMITS } from './mission-contracts.mts';
import { nativeMissionExecutors, nativeMissionPlan } from './mission-native.mts';
import { MissionService } from './mission-service.mts';

const scope = { workspaceId: 'benchmark-workspace', projectId: null };
const template = nativeMissionPlan('Measure CPU and RAM', scope)!;
const [cpu, ram, report] = template.tasks;
const flags = new Set(process.argv.slice(2));
const supportedFlags = ['--quick', '--cold-only', '--without-supplemental-windows'];
if ([...flags].some(flag => !supportedFlags.includes(flag))) throw Error('unsupported_mission_admission_benchmark_option');
const quick = flags.has('--quick');
const samples = Array.from({ length: quick ? 3 : 8 }, (_, index) => {
  const id = `cpu-${index + 1}`;
  return { ...cpu, id, criterion: id };
});
const inputs = [...samples, ram];
const tasks = [...inputs, { ...report, dependencies: inputs.map(task => task.id) }];
const plan = { ...template, tasks, criteria: tasks.map(task => task.criterion) };
const batchSize = quick ? 1 : 4;
const laneWorkers = 2;
type Arm = 'memory-only' | 'measured-admission' | 'arie-leases';
type Hook = 'memoryGuard' | 'sampleAdmission' | 'canLease' | 'acquireLease';
const withoutSupplemental = flags.has('--without-supplemental-windows');
const coldOnly = flags.has('--cold-only');
const round = (value: number) => Math.round(value * 100) / 100;
const p95 = (values: number[]) => values.length ? round(values.sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]) : null;

async function run(arm: Arm, phase: 'cold' | 'warm') {
  const setupStarted = performance.now();
  const db = new DatabaseSync(':memory:');
  const running = new Set<string>();
  const hooks: Record<Hook, number[]> = { memoryGuard: [], sampleAdmission: [], canLease: [], acquireLease: [] };
  function measure<T>(hook: Hook, callback: () => T): T {
    const start = performance.now();
    try { return callback(); }
    finally { hooks[hook].push(performance.now() - start); }
  }
  let service: MissionService | undefined;
  const admission = arm === 'memory-only' ? undefined : createMissionAdmission({ maxWorkers: MISSION_LIMITS.workers,
    ...(withoutSupplemental ? { readWindowsPressure: null } : {}), onChange: () => service?.capacityChanged() });
  let peakWorkers = 0;
  const scheduler = new MissionService({
    db, atomic<T>(work: () => T) {
      db.exec('BEGIN');
      try { const result = work(); db.exec('COMMIT'); return result; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    authorized: () => true, executors: nativeMissionExecutors, laneLimit: () => laneWorkers,
    ...(!admission ? { underPressure: () => measure('memoryGuard', () => freemem() < 512 * 1024 * 1024) } : {
      admission: (demand: boolean) => measure('sampleAdmission', () => {
        if (!demand) admission.stopDemand();
        return admission.read(demand);
      }),
    }),
    ...(arm === 'arie-leases' && admission ? { resources: {
      canAcquire: () => measure('canLease', () => admission.canLease('host_io')),
      acquire: (_lane, identity) => measure('acquireLease', () => admission.tryLease({ ...identity, kind: 'host_io' })),
    } } : {}),
    observe(_mission, event) {
      if (!event.attemptId) return;
      if (event.kind === 'started') {
        running.add(event.attemptId);
        peakWorkers = Math.max(peakWorkers, running.size);
      } else if (event.kind === 'settled') running.delete(event.attemptId);
    },
  });
  service = scheduler;
  const setupMs = round(performance.now() - setupStarted);
  const loop = monitorEventLoopDelay({ resolution: 10 });
  const start = performance.now(), cpuStart = process.cpuUsage();
  let sampledPeakRss = process.memoryUsage.rss();
  loop.enable();
  try {
    const ids = Array.from({ length: batchSize }, (_, index) => scheduler.create(`bench-${index}`, plan).id);
    const submitMs = round(performance.now() - start);
    const read = () => ids.map(id => scheduler.read(id, scope));
    let reports = read();
    while (reports.some(result => ['queued', 'running'].includes(result.outcome)) && performance.now() - start < 20_000) {
      await delay(50);
      reports = read();
      sampledPeakRss = Math.max(sampledPeakRss, process.memoryUsage.rss());
    }
    if (peakWorkers > laneWorkers || running.size || !reports.every(result => result.outcome === 'verified' && result.profile.providerCalls === 0))
      throw Error(`mission_admission_benchmark_incomplete: ${arm}: ${reports.map(report => report.outcome).join(', ')}`);
    const elapsedMs = round(performance.now() - start);
    const cpuUse = process.cpuUsage(cpuStart);
    const receipts = reports.flatMap(result => result.tasks.flatMap(task => task.attempts));
    const readings = (metric: keyof ReturnType<ReturnType<typeof createMissionAdmission>['read']>['readings']) =>
      receipts.filter(attempt => attempt.admission?.readings[metric] !== undefined).length;
    const timings = (field: 'queueMs' | 'contextPreparationMs' | 'executionMs' | 'verificationMs') =>
      receipts.flatMap(({ timing }) => timing?.[field] === undefined ? [] : [timing[field]]);
    const dependencyReadyQueue = reports.flatMap(mission => mission.tasks.flatMap(task => {
      const parents = mission.tasks.filter(parent => task.dependencies.includes(parent.id));
      const readyAt = Math.max(Date.parse(task.queuedAt), ...parents.map(parent => Date.parse(parent.attempts.at(-1)!.finishedAt!)));
      return task.attempts.map(attempt => Math.max(0, Date.parse(attempt.admittedAt) - readyAt));
    }));
    const attemptPhases = reports.flatMap((mission, index) => mission.tasks.flatMap(task => task.attempts.map(attempt => ({
      mission: index + 1, taskId: task.id, admittedMs: Date.parse(attempt.admittedAt) - Date.parse(mission.createdAt),
      settledMs: Date.parse(attempt.finishedAt!) - Date.parse(mission.createdAt), ...attempt.timing,
    }))));
    const hookCosts = Object.fromEntries(Object.entries(hooks).map(([hook, values]) => [hook,
      { calls: values.length, totalMs: round(values.reduce((sum, value) => sum + value, 0)), p95Ms: p95(values) }]));
    return { arm, phase, setupMs, submitMs, elapsedMs, verified: reports.length, attempts: receipts.length, peakWorkers,
      attemptsPerSecond: round(receipts.length / (elapsedMs / 1000)),
      queueP95Ms: p95(timings('queueMs')), readyQueueP95Ms: p95(dependencyReadyQueue),
      contextP95Ms: p95(timings('contextPreparationMs')), executionP95Ms: p95(timings('executionMs')),
      verificationP95Ms: p95(timings('verificationMs')), hookCosts, attemptPhases,
      processCpuMs: round((cpuUse.user + cpuUse.system) / 1000),
      sampledPeakRssBytes: sampledPeakRss,
      eventLoopP95Ms: loop.count ? round(loop.percentile(95) / 1e6) : null,
      admittedWith: { cpu: readings('cpuPercent'), memory: readings('availableMemoryBytes'),
        windowsLowMemory: readings('windowsLowMemory'), windowsCommit: readings('windowsCommitHeadroomBytes'),
        gpu: readings('gpuEnginePercent'), disk: readings('diskQueueLength') },
      constrainedAttempts: receipts.filter(attempt => attempt.admission?.reasons.length).length,
      leaseCount: receipts.filter(attempt => attempt.resourceLease).length };
  } finally {
    loop.disable();
    await scheduler.close();
    service = undefined;
    admission?.dispose();
    db.close();
  }
}

const arms: readonly Arm[] = ['memory-only', 'measured-admission', 'arie-leases'];
const cold: Awaited<ReturnType<typeof run>>[] = [];
for (const arm of arms) cold.push(await run(arm, 'cold'));
const rows: Awaited<ReturnType<typeof run>>[] = [];
if (!coldOnly) {
  for (let index = 0; index < arms.length; index++) {
    for (const arm of [...arms.slice(index), ...arms.slice(0, index)]) rows.push(await run(arm, 'warm'));
  }
}
const medians = Object.fromEntries(arms.map(arm => [arm,
  rows.filter(row => row.arm === arm).map(row => row.elapsedMs).sort((a, b) => a - b)[1] ?? null]));
console.log(JSON.stringify({ contract: 'aerynth.mission-admission-benchmark@2', node: process.version, platform: process.platform,
  logicalParallelism: availableParallelism(), ramBytes: totalmem(), batchSize, laneWorkers, windowsSupplemental: !withoutSupplemental,
  cpuSamplesPerMission: samples.length, medians, cold, rows, providerCalls: 0,
  boundary: 'Real native samples with independent governors per trial, in-memory journals and ambient host pressure. Cold is the first run of each arm in this process. Ready-queue time includes scheduler and lane waits. No induced host saturation, renderer measurement, or provider activity.' }));
