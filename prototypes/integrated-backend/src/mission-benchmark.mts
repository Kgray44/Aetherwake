import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { availableParallelism, release, totalmem } from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { MissionService } from './mission-service.mts';
import { nativeMissionExecutors, nativeMissionPlan } from './mission-native.mts';
import type { MissionProjection } from './mission-contracts.mts';

const db = new DatabaseSync(':memory:');
const scope = { workspaceId: 'benchmark-workspace', projectId: null };
const plan = nativeMissionPlan('Investigate Aerynth backend performance', scope)!;
const concurrent = process.argv.includes('--concurrent');
const concurrentLaneLimit = 3;
let underPressure = false;
let workload: { running: Map<string, string>; peakWorkers: number; peakMissions: number; firstStartMs?: number } | undefined;
const service = new MissionService({
  db, atomic<T>(work: () => T) {
    db.exec('BEGIN');
    try { const result = work(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  },
  authorized: () => true, executors: nativeMissionExecutors,
  laneLimit: () => concurrent ? concurrentLaneLimit : 2, underPressure: () => underPressure,
  ...(concurrent ? { observe: (mission, event) => {
    if (!workload || !event.attemptId) return;
    if (event.kind === 'started') {
      workload.running.set(event.attemptId, mission.id);
      workload.firstStartMs ??= performance.now();
      workload.peakWorkers = Math.max(workload.peakWorkers, workload.running.size);
      workload.peakMissions = Math.max(workload.peakMissions, new Set(workload.running.values()).size);
    } else if (event.kind === 'settled') workload.running.delete(event.attemptId);
  } } : {}),
});
const rows: { workers: number; elapsedMs: number; peakWorkers: number }[] = [];
async function run(iteration: number, workers: number) {
  const mission = service.create('benchmark-' + iteration, plan);
  if (workers !== mission.concurrency)
    service.control(mission.id, scope, mission.revision, { type: 'concurrency', concurrency: workers });
  const end = performance.now() + 7000;
  let report: MissionProjection;
  do {
    report = service.read(mission.id, scope);
    if (report.outcome === 'verified') return { workers, elapsedMs: report.profile.elapsedMs, peakWorkers: report.profile.peakWorkers };
    if (report.outcome !== 'running' && report.outcome !== 'queued') throw Error('benchmark_mission_not_verified');
    await delay(20);
  } while (performance.now() < end);
  throw Error('benchmark_mission_deadline');
}
async function runBaseline() {
  await run(0, 1);
  await run(1, 2);
  for (let i = 0; i < 12; i++) {
    const workers = [1, 2, 2, 1][i % 4];
    rows.push(await run(i + 2, workers));
  }
  const arms = [1, 2].map(workers => {
    const times = rows.filter(row => row.workers === workers).map(row => row.elapsedMs).sort((a, b) => a - b);
    return { workers, verified: times.length, medianMs: (times[2] + times[3]) / 2, minMs: times[0], maxMs: times.at(-1) };
  });
  console.log(JSON.stringify({ contract: 'aerynth.mission-benchmark@1', node: process.version, platform: process.platform,
    warmups: 2, rows, arms, providerCalls: 0, reportedTokens: null,
    boundary: 'Real native samples in one Node process, in-memory SQLite, small paired workload; no renderer, network, or billing measure.' }));
}

const batchSize = 4;
const round = (n: number) => Math.round(n * 100) / 100;
async function runBatch(holdMs: number) {
  const events = { running: new Map<string, string>(), peakWorkers: 0, peakMissions: 0, firstStartMs: undefined as number | undefined };
  workload = events;
  underPressure = holdMs > 0;
  const loop = monitorEventLoopDelay({ resolution: 10 });
  const rssStart = process.memoryUsage.rss(), cpuStart = process.cpuUsage(), start = performance.now();
  let rssPeak = rssStart, rssSamples = 1;
  const rssTimer = setInterval(() => {
    rssPeak = Math.max(rssPeak, process.memoryUsage.rss());
    rssSamples++;
  }, 20).unref();
  loop.enable();
  try {
    const ids = Array.from({ length: batchSize }, (_, index) => service.create(`batch-${holdMs}-${index}`, plan).id);
    const read = () => ids.map(id => service.read(id, scope));
    let deferredMissions: number | null = null, releasedAt: number | null = null;
    if (holdMs) {
      await delay(holdMs);
      deferredMissions = read().filter(mission => mission.outcome === 'queued' && mission.profile.attempts === 0 &&
        Object.values(mission.waits).includes('resource-pressure')).length;
      if (deferredMissions !== batchSize) throw Error('benchmark_pressure_deferral_failed');
      releasedAt = performance.now();
      underPressure = false;
      service.capacityChanged();
    }
    let reports = read();
    while (reports.some(report => report.outcome === 'queued' || report.outcome === 'running') && performance.now() - start < 7000) {
      await delay(20);
      reports = read();
    }
    const end = performance.now(), rssEnd = process.memoryUsage.rss(), cpu = process.cpuUsage(cpuStart);
    if (!reports.every(report => report.outcome === 'verified' && report.profile.providerCalls === 0 &&
      report.profile.reportedTotalTokens === null)) throw Error('benchmark_mission_not_verified');
    if (events.peakWorkers > concurrentLaneLimit || events.peakMissions < 2 || events.running.size || events.firstStartMs === undefined)
      throw Error('benchmark_concurrency_unverified');
    return { pressureHoldRequestedMs: holdMs, pressureHoldObservedMs: releasedAt === null ? null : round(releasedAt - start),
      deferredMissions, resumeToFirstStartMs: releasedAt === null ? null : round(events.firstStartMs - releasedAt),
      resumeToVerifiedMs: releasedAt === null ? null : round(end - releasedAt), elapsedMs: round(end - start),
      verifiedObjectives: reports.length, missionElapsedMs: reports.map(report => report.profile.elapsedMs),
      peakWorkers: events.peakWorkers, peakMissions: events.peakMissions,
      processCpu: { userMs: round(cpu.user / 1000), systemMs: round(cpu.system / 1000),
        oneCorePercent: round((cpu.user + cpu.system) / 1000 / (end - start) * 100) },
      processRss: { startBytes: rssStart, sampledPeakBytes: Math.max(rssPeak, rssEnd), endBytes: rssEnd, samples: rssSamples + 1 },
      eventLoopDelayMs: { samples: loop.count, p50: loop.count ? round(loop.percentile(50) / 1e6) : null,
        p95: loop.count ? round(loop.percentile(95) / 1e6) : null, max: loop.count ? round(loop.max / 1e6) : null },
    };
  } finally {
    clearInterval(rssTimer);
    loop.disable();
    workload = undefined;
    underPressure = false;
  }
}

async function runConcurrent() {
  await run(0, 2);
  const arms = [await runBatch(0), await runBatch(250)];
  console.log(JSON.stringify({ contract: 'aerynth.mission-concurrent-benchmark@1', node: process.version,
    platform: process.platform, arch: process.arch, osRelease: release(), availableParallelism: availableParallelism(),
    hostRamBytes: totalmem(), warmups: 1, batchSize, repetitionsPerArm: 1, maxLaneWorkers: concurrentLaneLimit,
    eventLoopResolutionMs: 10, rssSampleIntervalMs: 20, providerCalls: 0, reportedTokens: null,
    verifiedObjectivesPerReportedToken: null, arms,
    boundary: 'Real local CPU, RAM, backend, and static source executors with an in-memory SQLite journal. Pressure is an injected scheduler signal. Event-loop delay is from the Node backend. GPU, disk pressure, renderer responsiveness, and provider workloads were unmeasured.' }));
}

try {
  if (concurrent) await runConcurrent();
  else await runBaseline();
} finally { await service.close(); db.close(); }
