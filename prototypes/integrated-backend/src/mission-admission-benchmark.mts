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
const samples = Array.from({ length: 8 }, (_, index) => {
  const id = `cpu-${index + 1}`;
  return { ...cpu, id, criterion: id };
});
const inputs = [...samples, ram];
const tasks = [...inputs, { ...report, dependencies: inputs.map(task => task.id) }];
const plan = { ...template, tasks, criteria: tasks.map(task => task.criterion) };
const batchSize = 4;
const laneWorkers = 2;
type Arm = 'memory-only' | 'measured-admission';
let current: MissionService | undefined;
const admission = createMissionAdmission({ maxWorkers: MISSION_LIMITS.workers, onChange: () => current?.capacityChanged() });
const round = (value: number) => Math.round(value * 100) / 100;

async function run(arm: Arm) {
  const db = new DatabaseSync(':memory:');
  const running = new Set<string>();
  let peakWorkers = 0;
  const service = new MissionService({
    db, atomic<T>(work: () => T) {
      db.exec('BEGIN');
      try { const result = work(); db.exec('COMMIT'); return result; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    authorized: () => true, executors: nativeMissionExecutors, laneLimit: () => laneWorkers,
    ...(arm === 'memory-only' ? { underPressure: () => freemem() < 512 * 1024 * 1024 } : {
      admission(demand: boolean) {
        if (!demand) admission.stopDemand();
        return admission.read(demand);
      },
    }),
    observe(_mission, event) {
      if (!event.attemptId) return;
      if (event.kind === 'started') {
        running.add(event.attemptId);
        peakWorkers = Math.max(peakWorkers, running.size);
      } else if (event.kind === 'settled') running.delete(event.attemptId);
    },
  });
  if (arm === 'measured-admission') current = service;
  const loop = monitorEventLoopDelay({ resolution: 10 });
  const start = performance.now(), cpuStart = process.cpuUsage();
  let sampledPeakRss = process.memoryUsage.rss();
  loop.enable();
  try {
    const ids = Array.from({ length: batchSize }, (_, index) => service.create(`bench-${index}`, plan).id);
    const read = () => ids.map(id => service.read(id, scope));
    let reports = read();
    while (reports.some(result => ['queued', 'running'].includes(result.outcome)) && performance.now() - start < 20_000) {
      await delay(50);
      reports = read();
      sampledPeakRss = Math.max(sampledPeakRss, process.memoryUsage.rss());
    }
    if (peakWorkers > laneWorkers || running.size || !reports.every(result => result.outcome === 'verified' && result.profile.providerCalls === 0))
      throw Error('mission_admission_benchmark_incomplete');
    const elapsedMs = round(performance.now() - start);
    const cpuUse = process.cpuUsage(cpuStart);
    const receipts = reports.flatMap(result => result.tasks.flatMap(task => task.attempts));
    const readings = (metric: keyof ReturnType<typeof admission.read>['readings']) =>
      receipts.filter(attempt => attempt.admission?.readings[metric] !== undefined).length;
    return { arm, elapsedMs, verified: reports.length, attempts: receipts.length, peakWorkers,
      processCpuMs: round((cpuUse.user + cpuUse.system) / 1000),
      sampledPeakRssBytes: sampledPeakRss,
      eventLoopP95Ms: loop.count ? round(loop.percentile(95) / 1e6) : null,
      admittedWith: { cpu: readings('cpuPercent'), memory: readings('availableMemoryBytes'), gpu: readings('gpuEnginePercent'), disk: readings('diskQueueLength') },
      constrainedAttempts: receipts.filter(attempt => attempt.admission?.reasons.length).length };
  } finally {
    loop.disable();
    await service.close();
    current = undefined;
    db.close();
  }
}

try {
  await run('memory-only');
  await run('measured-admission');
  const rows: Awaited<ReturnType<typeof run>>[] = [];
  for (const arm of ['memory-only', 'measured-admission', 'measured-admission', 'memory-only', 'memory-only', 'measured-admission'] as const)
    rows.push(await run(arm));
  const medians = Object.fromEntries((['memory-only', 'measured-admission'] as const).map(arm => [arm,
    rows.filter(row => row.arm === arm).map(row => row.elapsedMs).sort((a, b) => a - b)[1]]));
  console.log(JSON.stringify({ contract: 'aerynth.mission-admission-benchmark@1', node: process.version, platform: process.platform,
    logicalParallelism: availableParallelism(), ramBytes: totalmem(), batchSize, laneWorkers, warmupsPerArm: 1,
    medians, rows, providerCalls: 0,
    boundary: 'Real native samples with in-memory journals and ambient host pressure. Process CPU and RSS cover Node only. No induced host saturation, renderer measurement, or provider activity.' }));
} finally { admission.dispose(); }
