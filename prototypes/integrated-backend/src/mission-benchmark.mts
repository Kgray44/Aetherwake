import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { MissionService } from './mission-service.mts';
import { nativeMissionExecutors, nativeMissionPlan } from './mission-native.mts';
import type { MissionProjection } from './mission-contracts.mts';

const db = new DatabaseSync(':memory:');
const scope = { workspaceId: 'benchmark-workspace', projectId: null };
const plan = nativeMissionPlan('Investigate Aerynth backend performance', scope)!;
const service = new MissionService({
  db, atomic<T>(work: () => T) {
    db.exec('BEGIN');
    try { const result = work(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  },
  authorized: () => true, executors: nativeMissionExecutors, laneLimit: () => 2, underPressure: () => false,
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
try {
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
} finally { await service.close(); db.close(); }
