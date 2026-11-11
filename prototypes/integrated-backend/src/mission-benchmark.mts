import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { availableParallelism, release, totalmem } from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { MissionService } from './mission-service.mts';
import { nativeMissionExecutors, nativeMissionPlan } from './mission-native.mts';
import { projectMissionExecution } from './execution-profiler.mts';
import type { MissionProjection } from './mission-contracts.mts';

const db = new DatabaseSync(':memory:');
const scope = { workspaceId: 'benchmark-workspace', projectId: null };
const plan = nativeMissionPlan('Investigate Aerynth backend performance', scope)!;
const concurrent = process.argv.includes('--concurrent');
const paired = process.argv.includes('--paired');
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
  laneLimit: () => concurrent || paired ? concurrentLaneLimit : 2, underPressure: () => underPressure,
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
async function runMission(iteration: number, workers: number) {
  const mission = service.create('benchmark-' + iteration, plan);
  if (workers !== mission.concurrency)
    service.control(mission.id, scope, mission.revision, { type: 'concurrency', concurrency: workers });
  const end = performance.now() + 7000;
  let report: MissionProjection;
  do {
    report = service.read(mission.id, scope);
    if (report.outcome !== 'running' && report.outcome !== 'queued') return report;
    await delay(20);
  } while (performance.now() < end);
  throw Error('benchmark_mission_deadline');
}
async function run(iteration: number, workers: number) {
  const report = await runMission(iteration, workers);
  if (report.outcome !== 'verified') throw Error('benchmark_mission_not_verified');
  return { workers, elapsedMs: report.profile.elapsedMs, peakWorkers: report.profile.peakWorkers };
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
const sourceByTask = new Map([
  ['backend', 'aerynth.backend.node'], ['cpu', 'node:os.cpus'], ['ram', 'node:os.totalmem+freemem'],
  ['code', 'aerynth.shipped-backend-source'], ['report', 'aerynth.mission.journal'],
]);
const joinInputIds = [...sourceByTask.keys()].filter(id => id !== 'report');
const screening = { protocol: 'native-worker-pair-screen@1', pairs: 6, minimumConcordantPairs: 5,
  minimumMedianRelativeEffect: 0.05 };
async function samplePaired(iteration: number, workers: number) {
  const cpuStart = process.cpuUsage();
  const report = await runMission(iteration, workers);
  const cpu = process.cpuUsage(cpuStart);
  const trace = projectMissionExecution(report);
  const joined = report.tasks.find(task => task.id === 'report');
  const inputs = joinInputIds.map(id => report.tasks.find(task => task.id === id)?.attempts.at(-1)?.evidence);
  const joinedAttempt = joined?.attempts.at(-1);
  const qualityPassed = report.outcome === 'verified' && report.tasks.length === sourceByTask.size &&
    [...sourceByTask].every(([id, source]) => {
      const task = report.tasks.find(item => item.id === id), attempt = task?.attempts.at(-1), evidence = attempt?.evidence;
      return task?.state === 'verified' && evidence?.source === source && attempt?.verification?.passed === true &&
        attempt.verification.evidenceIds.includes(evidence.id);
    }) && joined?.dependencies.length === joinInputIds.length && joinInputIds.every(id => joined.dependencies.includes(id)) &&
    inputs.every(item => item !== undefined) &&
    JSON.stringify(joinedAttempt?.evidence?.value) === JSON.stringify(joined.dependencies.map(id => {
      const item = inputs[joinInputIds.indexOf(id)];
      return { id: item.id, source: item.source, attemptId: item.attemptId };
    })) &&
    report.profile.providerCalls === 0;
  return { workers, missionId: report.id, outcome: report.outcome, qualityPassed, elapsedMs: trace.admissionToLastSettlementMs,
    workerMs: trace.work.workerMs, criticalPathMs: trace.work.criticalPath?.durationMs ?? null,
    overlapMs: trace.work.overlapMs, peakWorkers: trace.work.peakWorkers, processCpuMs: round((cpu.user + cpu.system) / 1000),
    verifiedTasks: trace.attempts.filter(attempt => attempt.verifiedEvidenceIds.length).map(attempt => ({
      taskId: attempt.taskId, attemptId: attempt.id, evidenceIds: attempt.verifiedEvidenceIds, settlementSeq: attempt.end?.eventSeq ?? null,
    })) };
}

async function runPaired() {
  const startedAt = new Date().toISOString();
  let iteration = 0;
  const warmups = [];
  for (const workers of [1, 2, 3]) warmups.push(await samplePaired(iteration++, workers));
  const comparisons = [];
  const hypotheses = [];
  for (const [baselineWorkers, candidateWorkers] of [[1, 2], [2, 3]]) {
    const pairs = [];
    for (let pair = 0; pair < screening.pairs; pair++) {
      const baselineFirst = pair % 2 === 0;
      const first = await samplePaired(iteration++, baselineFirst ? baselineWorkers : candidateWorkers);
      const second = await samplePaired(iteration++, baselineFirst ? candidateWorkers : baselineWorkers);
      const [baseline, candidate] = baselineFirst ? [first, second] : [second, first];
      const deltaMs = baseline.qualityPassed && candidate.qualityPassed && baseline.elapsedMs !== null && candidate.elapsedMs !== null
        ? candidate.elapsedMs - baseline.elapsedMs : null;
      pairs.push({ order: [first.workers, second.workers], baseline, candidate, deltaMs });
    }
    const deltas = pairs.flatMap(pair => pair.deltaMs === null ? [] : [pair.deltaMs]).sort((a, b) => a - b);
    const slowerPairs = deltas.filter(delta => delta > 0).length;
    const fasterPairs = deltas.filter(delta => delta < 0).length;
    const relativeDeltas = pairs.flatMap(({ baseline, deltaMs }) =>
      deltaMs !== null && baseline.elapsedMs !== null && baseline.elapsedMs > 0 ? [deltaMs / baseline.elapsedMs] : [])
      .sort((a, b) => a - b);
    const medianRelativeDelta = relativeDeltas.length === screening.pairs ? (relativeDeltas[2] + relativeDeltas[3]) / 2 : null;
    comparisons.push({ baselineWorkers, candidateWorkers, pairs, validPairs: deltas.length,
      medianDeltaMs: deltas.length === pairs.length ? (deltas[2] + deltas[3]) / 2 : null,
      medianRelativeDelta, slowerPairs, fasterPairs });
    if (warmups.every(row => row.qualityPassed) && medianRelativeDelta !== null &&
      Math.abs(medianRelativeDelta) >= screening.minimumMedianRelativeEffect &&
      Math.max(slowerPairs, fasterPairs) >= screening.minimumConcordantPairs) {
      const lowerWorkerArmWasFaster = medianRelativeDelta > 0;
      const testedBaseline = lowerWorkerArmWasFaster ? candidateWorkers : baselineWorkers;
      const testedTreatment = lowerWorkerArmWasFaster ? baselineWorkers : candidateWorkers;
      hypotheses.push({
        id: pairs[0].baseline.missionId + ':worker-limit', status: 'hypothesis', owner: 'MissionService',
        protocol: screening.protocol, applicability: { workload: 'native CPU, RAM and shipped source observations with a verified join',
          laneLimit: concurrentLaneLimit, providerCalls: 0, storage: 'in-memory SQLite' },
        observedProblem: 'The slower worker limit increased admission-to-final-settlement time for matched verified missions.',
        hypothesis: 'Using the faster worker limit may shorten verified completion on comparable native observation missions.',
        baseline: { workers: testedBaseline }, treatment: { workers: testedTreatment },
        expectedBenefit: 'Lower elapsed time from admission to final settlement with equivalent verified evidence.',
        qualityGuards: ['same required task set', 'canonical evidence source and exact proof ID for each task',
          'verified join over the same prerequisite evidence', 'no provider dispatches'],
        evidence: pairs.map(({ baseline, candidate }) => ({
          baselineMissionId: (lowerWorkerArmWasFaster ? candidate : baseline).missionId,
          treatmentMissionId: (lowerWorkerArmWasFaster ? baseline : candidate).missionId,
        })),
        tradeoff: 'Changing concurrency can alter CPU contention, worker overlap, and foreground responsiveness.',
        confounders: ['ambient host load', 'one host', 'one task graph', 'in-memory journal'],
        evaluation: 'Counterbalance on unseen local read-only missions. Independently compare evidence coverage, verified outputs and foreground responsiveness alongside latency.',
        constraints: 'Preserve resource limits, permissions, task coverage, and verification. Use local read-only workloads.',
        stopCondition: 'Stop if any verification, evidence coverage, permission, or foreground responsiveness guard fails.',
        rollback: { workers: testedBaseline },
      });
    }
  }
  console.log(JSON.stringify({ contract: 'aerynth.mission-worker-comparison@1', startedAt, node: process.version,
    platform: process.platform, arch: process.arch, osRelease: release(), logicalParallelism: availableParallelism(),
    warmups, comparisons, screening, hypotheses, providerCalls: 0,
    boundary: 'Counterbalanced local read-only native workload with in-memory SQLite. Six pairs per comparison; no tail-latency or confidence estimate. Host interference is uncontrolled. The screen emits hypotheses for independent review.' }));
  if (warmups.some(row => !row.qualityPassed) || comparisons.some(item => item.validPairs !== item.pairs.length)) process.exitCode = 1;
}
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
  else if (paired) await runPaired();
  else await runBaseline();
} finally { await service.close(); db.close(); }
