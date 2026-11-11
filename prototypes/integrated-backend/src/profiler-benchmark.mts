import { DatabaseSync } from 'node:sqlite';
import { setImmediate as yieldToScheduler, setTimeout as delay } from 'node:timers/promises';
import { MissionService, type MissionServiceHost } from './mission-service.mts';
import { projectMissionExecution } from './execution-profiler.mts';
import { nativeMissionExecutors, nativeMissionPlan } from './mission-native.mts';
import type { MissionPlan, MissionTaskPlan } from './mission-contracts.mts';

const modes = ['off', 'minimal', 'full'] as const;
const scope = { projectId: null, workspaceId: 'profiler-benchmark' };
const task = (id: string, dependencies: string[] = []): MissionTaskPlan => ({
  id, dependencies, objective: id, criterion: id, claims: [], executor: 'fixture', maxAttempts: 1, timeoutMs: 2000,
});
const fixturePlan: MissionPlan = {
  scope, objective: 'Synthetic execution profiler load',
  tasks: [task('left'), task('right'), task('join', ['left', 'right'])], criteria: ['left', 'right', 'join'],
};
const native = process.argv.includes('--native');
const live = process.argv.includes('--live');
const plan = native ? nativeMissionPlan('Measure CPU and RAM', scope)! : fixturePlan;
const missionsPerBatch = native || live ? 3 : 24;
const readyTasksPerMission = plan.tasks.filter(task => !task.dependencies.length).length;
const pollIntervalMs = 25;
const heldPolls = 3;

async function sample(mode: typeof modes[number]) {
  const db = new DatabaseSync(':memory:');
  let pressureHeld = live;
  const host: MissionServiceHost = {
    db, profilerMode: mode, authorized: () => true, laneLimit: () => 2,
    ...(live ? { underPressure: () => pressureHeld } : {}),
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
    executors: native ? nativeMissionExecutors : {
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
    const polls: { phase: 'held' | 'released'; elapsedMs: number; profiles: number; readyTasks: number; liveAttempts: number }[] = [];
    const poll = (phase: 'held' | 'released', pending: string[]) => {
      const started = performance.now();
      const profiles = pending.map(id => {
        const mission = service.read(id, scope, { includeReadyQueue: true });
        const clock = service.fullProfilingClock();
        const observation = clock && (mission.outcome === 'running' || mission.outcome === 'cancelling')
          ? { clock, monotonicMs: performance.now() } : null;
        return projectMissionExecution(mission, null, null, observation);
      });
      const elapsedMs = performance.now() - started;
      const readyTasks = profiles.reduce((count, profile) => count + (profile.work.liveReadyQueue?.tasks.length ?? 0), 0);
      const liveAttempts = profiles.reduce((count, profile) => count + (profile.work.live?.attempts.length ?? 0), 0);
      polls.push({ phase, elapsedMs, profiles: profiles.length, readyTasks, liveAttempts });
      return profiles;
    };
    const cpuStart = process.cpuUsage(), start = performance.now();
    for (let i = 0; i < missionsPerBatch; i++) {
      const { id } = service.create('bench-' + i, plan);
      ids.push(id);
      if (live) continue;
      await yieldToScheduler();
      let report = service.read(id, scope);
      if (native) {
        const deadline = performance.now() + 7000;
        while (['queued', 'running'].includes(report.outcome) && performance.now() < deadline) {
          await delay(10);
          report = service.read(id, scope);
        }
      }
      if (report.outcome !== 'verified' || report.profile.providerCalls !== 0) throw new Error('benchmark mission did not verify');
    }
    if (live) {
      await yieldToScheduler();
      for (let i = 0; i < heldPolls; i++) {
        const held = poll('held', ids);
        if (held.some(profile => profile.outcome !== 'queued' || profile.attempts.length !== 0 ||
          !Object.values(profile.waits).includes('resource-pressure')))
          throw new Error('benchmark pressure did not defer execution');
        const heldQueue = polls.at(-1)!.readyTasks;
        if (heldQueue !== (mode === 'full' ? missionsPerBatch * readyTasksPerMission : 0))
          throw new Error('benchmark ready-queue coverage did not match mode');
        await delay(pollIntervalMs);
      }
      pressureHeld = false;
      service.capacityChanged();
      let pending = ids;
      const deadline = performance.now() + 7000;
      while (pending.length && performance.now() < deadline) {
        await delay(pollIntervalMs);
        pending = poll('released', pending).flatMap(profile => {
          if (profile.outcome === 'queued' || profile.outcome === 'running') return [profile.missionId];
          if (profile.outcome !== 'verified' || profile.economics.providerCalls !== 0)
            throw new Error('benchmark mission did not verify');
          return [];
        });
      }
      if (pending.length) throw new Error('benchmark live polling deadline');
      if (native && mode === 'full' && !polls.some(item => item.liveAttempts > 0))
        throw new Error('benchmark did not observe an active native attempt');
    }
    const executionMs = performance.now() - start;
    const cpu = process.cpuUsage(cpuStart);
    const projectingAt = performance.now();
    const reports = ids.map(id => service.read(id, scope));
    const profiles = reports.map(report => projectMissionExecution(report));
    const projectionMs = performance.now() - projectingAt;
    const { bytes } = db.prepare('SELECT sum(length(CAST(json AS BLOB))) AS bytes FROM vela_missions').get()!;
    if (native) for (const report of reports) {
      const inputs = ['cpu', 'ram'].map(id => report.tasks.find(task => task.id === id)?.attempts.at(-1));
      const join = report.tasks.find(task => task.id === 'report')?.attempts.at(-1);
      if (inputs[0]?.evidence?.source !== 'node:os.cpus' || inputs[1]?.evidence?.source !== 'node:os.totalmem+freemem' ||
        join?.evidence?.source !== 'aerynth.mission.journal' ||
        ![...inputs, join].every(attempt => attempt?.verification?.passed && attempt.evidence && attempt.verification.evidenceIds.includes(attempt.evidence.id)) ||
        JSON.stringify(join.evidence.value) !== JSON.stringify(inputs.map(attempt => ({ id: attempt!.evidence!.id,
          source: attempt!.evidence!.source, attemptId: attempt!.id })))) throw new Error('native benchmark evidence did not verify');
    }
    const measuredAttempts = profiles.reduce((count, profile) => count + profile.attempts.filter(attempt => attempt.interval).length, 0);
    const phasedAttempts = profiles.reduce((count, profile) => count + profile.attempts.filter(attempt => attempt.phases?.verification).length, 0);
    const expectedAttempts = missionsPerBatch * plan.tasks.length;
    if (measuredAttempts !== (mode === 'off' ? 0 : expectedAttempts) || phasedAttempts !== (mode === 'full' ? expectedAttempts : 0))
      throw new Error('benchmark profile coverage did not match mode');
    return { mode, executionMs, cpuMs: (cpu.user + cpu.system) / 1000, projectionMs, journalJsonBytes: Number(bytes),
      verifiedMissions: reports.length, measuredAttempts, phasedAttempts, ...(live ? { polls } : {}) };
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
  const median = (key: 'executionMs' | 'cpuMs' | 'projectionMs' | 'journalJsonBytes') =>
    group.map(row => row[key]).sort((a, b) => a - b)[Math.floor(group.length / 2)];
  return { mode, batches: group.length, executionMs: median('executionMs'), cpuMs: median('cpuMs'),
    projectionMs: median('projectionMs'), journalJsonBytes: median('journalJsonBytes'), measuredAttemptsPerBatch: group[0].measuredAttempts,
    phasedAttemptsPerBatch: group[0].phasedAttempts };
});
console.log(JSON.stringify({ node: process.version, platform: process.platform, workload: native ? 'native-cpu-ram' : 'synthetic',
  missionsPerBatch, samples, medians, providerCalls: 0, ...(live ? { livePolling: { pollIntervalMs, heldPolls } } : {}),
  boundary: (native ? 'Real host CPU and RAM reads with a verified join. ' : 'Synthetic verified three-task DAG. ') +
    'Real scheduler with in-memory SQLite under ambient host load. Off disables added lifecycle clock samples. Projection time includes scoped readback. Renderer and physical disk overhead are unmeasured.' +
    (live ? ' Live polling reads active profiles through the scoped service and AEP projector. Pressure is injected. Batch time includes the pressure hold and polling cadence.' : '') }));
