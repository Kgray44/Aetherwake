import { DatabaseSync } from 'node:sqlite';
import { setImmediate as yieldToScheduler } from 'node:timers/promises';
import { MissionService, type MissionServiceHost } from './mission-service.mts';
import { projectMissionExecution } from './execution-profiler.mts';
import type { MissionPlan, MissionTaskPlan } from './mission-contracts.mts';

const modes = ['off', 'minimal', 'full'] as const;
const scope = { projectId: null, workspaceId: 'profiler-benchmark' };
const task = (id: string, dependencies: string[] = []): MissionTaskPlan => ({
  id, dependencies, objective: id, criterion: id, claims: [], executor: 'fixture', maxAttempts: 1, timeoutMs: 2000,
});
const plan: MissionPlan = {
  scope, objective: 'Synthetic execution profiler load',
  tasks: [task('left'), task('right'), task('join', ['left', 'right'])], criteria: ['left', 'right', 'join'],
};
const missionsPerBatch = 24;

async function sample(mode: typeof modes[number]) {
  const db = new DatabaseSync(':memory:');
  const host: MissionServiceHost = {
    db, profilerMode: mode, authorized: () => true, laneLimit: () => 2,
    atomic(work) {
      db.exec('BEGIN');
      try {
        const result = work();
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    executors: {
      fixture: {
        lane: 'native', replaySafe: true, available: () => true,
        async run() { return { source: 'synthetic-benchmark', value: true }; },
        verify(evidence) { return { passed: evidence.value === true, detail: 'Fixture effect observed' }; },
      },
    },
  };
  const service = new MissionService(host);
  try {
    const ids: string[] = [];
    const cpuStart = process.cpuUsage(), start = performance.now();
    for (let i = 0; i < missionsPerBatch; i++) {
      const { id } = service.create('bench-' + i, plan);
      ids.push(id);
      await yieldToScheduler();
      if (service.read(id, scope).outcome !== 'verified') throw new Error('fixture mission did not verify');
    }
    const executionMs = performance.now() - start;
    const cpu = process.cpuUsage(cpuStart);
    const projectingAt = performance.now();
    const profiles = ids.map(id => projectMissionExecution(service.read(id, scope)));
    const projectionMs = performance.now() - projectingAt;
    const { bytes } = db.prepare('SELECT sum(length(CAST(json AS BLOB))) AS bytes FROM vela_missions').get()!;
    return { mode, executionMs, cpuMs: (cpu.user + cpu.system) / 1000, projectionMs, journalJsonBytes: bytes,
      measuredAttempts: profiles.reduce((count, profile) => count + profile.attempts.filter(attempt => attempt.interval).length, 0),
      phasedAttempts: profiles.reduce((count, profile) => count + profile.attempts.filter(attempt => attempt.phases?.verification).length, 0) };
  } finally {
    await service.close();
    db.close();
  }
}

for (const mode of modes) await sample(mode);
const samples: Awaited<ReturnType<typeof sample>>[] = [];
for (let batch = 0; batch < 9; batch++) {
  for (let i = 0; i < modes.length; i++) samples.push(await sample(modes[(i + batch) % modes.length]));
}
const medians = modes.map(mode => {
  const group = samples.filter(row => row.mode === mode);
  const median = (key: 'executionMs' | 'cpuMs' | 'projectionMs') =>
    group.map(row => row[key]).sort((a, b) => a - b)[Math.floor(group.length / 2)];
  return { mode, batches: group.length, executionMs: median('executionMs'), cpuMs: median('cpuMs'),
    projectionMs: median('projectionMs'), measuredAttemptsPerBatch: group[0].measuredAttempts,
    phasedAttemptsPerBatch: group[0].phasedAttempts };
});
console.log(JSON.stringify({ node: process.version, platform: process.platform, missionsPerBatch, samples, medians,
  boundary: 'Synthetic verified three-task DAG on the real scheduler and in-memory SQLite. Off disables added lifecycle clock samples; existing receipts remain enabled. Projection time includes scoped readback.' }));
