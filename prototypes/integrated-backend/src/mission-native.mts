import { platform } from 'node:os';
import { inspectBackendSource } from './mission-cpu-worker.mts';
import type { createMissionCpuPool } from './mission-cpu-pool.mts';
import { setTimeout as delay } from 'node:timers/promises';
import { readCpuUtilization, readGpuUtilization } from '../../vela-core/src/system-utilization.mts';
import { readSystemMemory } from '../../vela-core/src/system-memory.mts';
import { validateSystemMemoryMeasurement } from '../../vela-core/src/system-information.ts';
import { verifiedGpuReadback } from './windows-gpu-readback.mts';
import { EXPLICIT_MISSION_PREFIX } from './mission-contracts.mts';
import type { Mission, MissionExecutor, MissionPlan, MissionProjection, MissionScope, MissionTask, MissionTaskPlan } from './mission-contracts.mts';

const numberIn = (n: unknown, min: number, max: number) =>
  typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
const object = (value: unknown) => value && typeof value === 'object' ? value as Record<string, unknown> : {};

/** Format only verified, current native evidence. Provider text cannot supply these facts. */
export function missionMeasurementAnswer(tasks: readonly MissionTask[]): string[] {
  const answer: string[] = [];
  for (const task of tasks) {
    const attempt = task.attempts.at(-1), evidence = attempt?.evidence;
    if (task.state !== 'verified' || !attempt?.verification?.passed || !evidence ||
      evidence.attemptId !== attempt.id || !attempt.verification.evidenceIds.includes(evidence.id)) continue;
    const value = object(evidence.value);
    if (task.executor === 'sample.cpu' && evidence.source === 'node:os.cpus' && value.metric === 'cpu' &&
      numberIn(value.percent, 0, 100) && numberIn(value.sampleMs, 200, 5000)) {
      answer.push(`CPU ${value.percent}% (${value.sampleMs} ms sample).`);
    } else if (task.executor === 'sample.ram' && evidence.source === 'node:os.totalmem+freemem') {
      try {
        validateSystemMemoryMeasurement(evidence.value);
        const { usedBytes, totalBytes, availableBytes, utilizationPercent, source } = evidence.value;
        const gib = (bytes: number) => (bytes / 2 ** 30).toFixed(2);
        answer.push(`RAM ${utilizationPercent}% (${gib(usedBytes)}/${gib(totalBytes)} GiB used, ${gib(availableBytes)} GiB ${source.platform === 'win32' ? 'available' : 'free'}).`);
      } catch { /* Ignore evidence that no longer meets the native contract. */ }
    } else if (task.executor === 'sample.gpu' && evidence.source === 'windows:gpu-engine' && value.metric === 'gpu' &&
      numberIn(value.percent, 0, 100)) {
      answer.push(`GPU ${value.percent}% (busiest observed engine).`);
    }
  }
  return answer;
}

const completedMissionWork = (mission: Mission) => mission.tasks.filter(task =>
  task.state === 'verified' && task.executor !== 'join.samples' && task.executor !== 'join.team');
/** A partial evidence report is publishable while the original objective remains blocked. */
export const missionResultAvailable=(mission:MissionProjection)=>mission.outcome==='verified'||mission.outcome==='blocked'&&mission.coverage?.status==='partial'&&
  mission.tasks.length>0&&mission.tasks.every(task=>task.state==='verified'&&task.attempts.at(-1)?.verification?.passed===true);

export function missionJobsDone(mission: Mission) {
  return new Set(completedMissionWork(mission).map(task => task.criterion)).size;
}

/** Concise results for the scoped chat receipt. The plan retains the full evidence. */
export function missionCompletion(mission: Mission) {
  const jobs = completedMissionWork(mission);
  const lines = missionMeasurementAnswer(jobs);
  const specialistResults = new Set<string>();
  for (const task of jobs) {
    const evidence = task.attempts.at(-1)?.evidence;
    const value = object(evidence?.value);
    if (evidence?.source === 'aerynth.backend.node' && typeof value.rssBytes === 'number' &&
      typeof value.heapUsedBytes === 'number' && typeof value.timerOvershootMs === 'number') {
      const mib = (bytes: number) => (bytes / 2 ** 20).toFixed(1);
      lines.push(`Backend ${mib(value.rssBytes)} MiB RSS, ${mib(value.heapUsedBytes)} MiB heap, ${value.timerOvershootMs.toFixed(1)} ms timer delay.`);
    } else if (evidence?.source === 'aerynth.shipped-backend-source') {
      lines.push(`Found ${value.sqlitePrepareSites} SQLite prepare sites and ${value.transactionSites} transaction sites in the shipped source.`);
    } else if (evidence?.source === 'windows:d3d11-verified-readback' && verifiedGpuReadback(value)) {
      lines.push(`Verified all ${value.verifiedBuffers} GPU buffer digests across ${value.allocatedBytes / 2 ** 20} MiB of test data.`);
    } else if (evidence?.source === 'aerynth.authorized-workspace-notes' && Array.isArray(value.references)) {
      lines.push(`Found ${value.references.length} relevant ${value.references.length === 1 ? 'note' : 'notes'}.`);
    } else if (evidence?.source === 'codex-app-server:read-only-command') {
      lines.push(`${value.testCount} ${value.testCount === 1 ? 'test passed' : 'tests passed'}.`);
    } else if ((evidence?.source === 'chatgpt-plan-responses:reported' || evidence?.source === 'openai-api-vela:reported') && Array.isArray(value.observations) &&
      typeof value.observations[0] === 'string' && !specialistResults.has(value.observations[0])) {
      specialistResults.add(value.observations[0]);
      lines.push(`${task.specialist?.role ?? 'Specialist'} reported: ${value.observations[0].trim()}`);
    }
  }
  if(mission.coverage){lines.unshift('I collected the available evidence. The investigation remains incomplete.');lines.push(...mission.coverage.limitations.map(reason=>'Still needed: '+reason));}
  return { content: lines.join('\n') || 'Completed the requested work.', jobsDone: missionJobsDone(mission) };
}

const utilization = (metric: 'cpu' | 'gpu', read: typeof readCpuUtilization): MissionExecutor => ({
  lane: 'native', replaySafe: true, available: () => metric === 'cpu' || platform() === 'win32',
  async run({ signal }) {
    signal.throwIfAborted();
    const value = await read();
    return { source: value.source, value };
  },
  verify(evidence) {
    const v = object(evidence.value);
    const passed = v.metric === metric && v.source === evidence.source &&
      numberIn(v.percent, 0, 100) && typeof v.measuredAt === 'string' && Number.isFinite(Date.parse(v.measuredAt)) &&
      (metric === 'cpu' ? numberIn(v.sampleMs, 200, 5000) && numberIn(v.logicalCpus, 1, 65536) :
        numberIn(v.observedAdapters, 1, 8192) && numberIn(v.observedEngines, 1, 8192));
    return { passed, detail: passed ? 'Observed native counter sample' : 'Native counter evidence failed validation' };
  },
});

export const nativeMissionExecutors: Readonly<Record<string, MissionExecutor>> = Object.freeze({
  'sample.cpu': utilization('cpu', readCpuUtilization),
  'sample.gpu': utilization('gpu', readGpuUtilization),
  'sample.ram': {
    lane: 'native', replaySafe: true, available: () => true,
    async run() { return { source: 'node:os.totalmem+freemem', value: readSystemMemory() }; },
    verify(evidence) {
      try { validateSystemMemoryMeasurement(evidence.value); return { passed: true, detail: 'Validated host physical memory counters' }; }
      catch { return { passed: false, detail: 'Host physical memory evidence failed validation' }; }
    },
  },
  'sample.backend': {
    lane: 'native', replaySafe: true, available: () => true,
    async run({ signal }) {
      const { rss, heapUsed } = process.memoryUsage();
      const start = performance.now();
      await delay(100, undefined, { signal });
      return { source: 'aerynth.backend.node', value: { rssBytes: rss, heapUsedBytes: heapUsed,
        timerOvershootMs: Math.max(0, performance.now() - start - 100), sampleWindowMs: 100 } };
    },
    verify({ value }) {
      const v = object(value);
      const passed = numberIn(v.rssBytes, 1, Number.MAX_SAFE_INTEGER) &&
        numberIn(v.heapUsedBytes, 1, Number.MAX_SAFE_INTEGER) && numberIn(v.timerOvershootMs, 0, 10_000) && v.sampleWindowMs === 100;
      return { passed, detail: passed ? 'Observed backend RSS, heap and one timer sample' : 'Backend sample failed validation' };
    },
  },
  'inspect.backend-source': {
    lane: 'native', replaySafe: true, available: () => true,
    run: ({ signal }) => inspectBackendSource(signal),
    verify({ value, source }) {
      const v = object(value);
      const passed = source === 'aerynth.shipped-backend-source' && v.module === 'core.mts' &&
        typeof v.sha256 === 'string' && /^[a-f0-9]{64}$/u.test(v.sha256) && numberIn(v.bytes, 1, 768 * 1024) &&
        Number.isSafeInteger(v.sqlitePrepareSites) && Number.isSafeInteger(v.transactionSites);
      return { passed, detail: passed ? 'Recorded a digest and static database call sites from the shipped module' : 'Static source evidence unavailable' };
    },
  },
  'inspect.workspace-notes': {
    lane: 'native', replaySafe: true, available: () => true,
    async run({ context }) {
      return { source: 'aerynth.authorized-workspace-notes', value: { coverage: context.manifest.retrieval,
        references: context.manifest.sources.map(({ ref, version, digest }) => ({ id: ref.id, version, digest })) } };
    },
    verify({ value }, { context }) {
      const v = object(value);
      const passed = v.coverage === 'searched' && Array.isArray(v.references) && v.references.length > 0 &&
        JSON.stringify(v.references) === JSON.stringify(context.manifest.sources.map(({ ref, version, digest }) => ({ id: ref.id, version, digest })));
      return { passed, detail: passed ? 'Retrieved relevant authorized notes with version and digest; note claims are unverified' :
        'No relevant authorized notes could be confirmed' };
    },
  },
  'join.samples': {
    lane: 'native', replaySafe: true, available: () => true,
    async run({ dependencies }) {
      return { source: 'aerynth.mission.journal', value: dependencies.map(d => ({ id: d.id, source: d.source, attemptId: d.attemptId })) };
    },
    verify(evidence, { dependencies, task }) {
      const passed = dependencies.length === task.dependencies.length && dependencies.length >= 2 &&
        JSON.stringify(evidence.value) === JSON.stringify(dependencies.map(d => ({ id: d.id, source: d.source, attemptId: d.attemptId })));
      return { passed, detail: passed ? 'Joined independently verified samples with source identifiers' : 'Sample coverage is incomplete' };
    },
  },
});

export function createPooledBackendSourceExecutor(pool: ReturnType<typeof createMissionCpuPool>): MissionExecutor {
  return {
    ...nativeMissionExecutors['inspect.backend-source']!,
    async run({ signal, resourceCheckpoint }) {
      try {
        const stop = resourceCheckpoint ? AbortSignal.any([signal, resourceCheckpoint]) : signal;
        return (await pool.inspect(stop)).evidence;
      } catch (error) {
        if (signal.aborted || !resourceCheckpoint?.aborted) throw error;
        return { source: 'aerynth.shipped-backend-source', outcome: 'blocked', value: { status: 'resource_checkpoint' } };
      }
    },
  };
}

const probes: Record<string, { executor: string; objective: string; resource: string }> = {
  cpu: { executor: 'sample.cpu', objective: 'Sample host CPU utilization', resource: 'host.cpu-counter' },
  ram: { executor: 'sample.ram', objective: 'Read host physical memory utilization', resource: 'host.ram-counter' },
  gpu: { executor: 'sample.gpu', objective: 'Sample the busiest observed GPU engine', resource: 'host.gpu-counter' },
  backend: { executor: 'sample.backend', objective: 'Measure Aerynth backend RSS, heap and timer delay', resource: 'aerynth.backend-counter' },
  code: { executor: 'inspect.backend-source', objective: 'Inspect the shipped backend source for database work sites', resource: 'aerynth.backend-source' },
  notes: { executor: 'inspect.workspace-notes', objective: 'Find relevant notes already placed in this workspace', resource: 'aerynth.notes' },
};

export function missionPlanningCatalog() {
  const tasks: MissionTaskPlan[] = Object.entries(probes).map(([id, probe]) => ({
    id, objective: probe.objective, executor: probe.executor, criterion: id,
    claims: [{ resource: probe.resource, mode: id === 'gpu' ? 'exclusive' : 'read' }],
    dependencies: [], maxAttempts: 2, timeoutMs: 6000,
  }));
  tasks.push({ id: 'project-tests', objective: 'Run the reviewed tracked Node tests in the Codex read-only sandbox',
    executor: 'codex.project-check', criterion: 'project-tests-pass', dependencies: [],
    claims: [{ resource: 'codex.project-check', mode: 'exclusive' }], maxAttempts: 1, timeoutMs: 35_000 });
  return Object.fromEntries(tasks.map(task => [task.id, task]));
}

/** AIR remains the default. Only fully matched, supported read-only objectives enter this planner. */
export function nativeMissionPlan(intent: string, scope: MissionScope): MissionPlan | null {
  if (typeof intent !== 'string' || Buffer.byteLength(intent) > 4096) return null;
  const normalized = intent.normalize('NFKC').toLowerCase().trim().replace(/^vela[,:]?\s+/u, '');
  const explicit = EXPLICIT_MISSION_PREFIX.test(normalized);
  const text = normalized.replace(EXPLICIT_MISSION_PREFIX, '').replace(/[.!?]+$/u, '');
  let ids: string[];
  const check = /^run (?:the )?selected node(?:\.js)? tests and (?:measure|sample|check) cpu and ram(?: in parallel)?$/u.test(text);
  if (/^(?:investigate|profile|measure) (?:the )?aerynth backend(?:'s)? performance(?: using workspace notes)?$/u.test(text))
    ids = ['backend', 'cpu', 'ram', 'code', ...(text.endsWith('using workspace notes') ? ['notes'] : [])];
  else if (check) ids = ['cpu', 'ram'];
  else {
    const match = /^(?:measure|sample|check) (?:the )?(?:host |system )?((?:cpu|gpu|ram|memory)(?:(?:,\s*(?:and\s+)?|\s+and\s+)(?:cpu|gpu|ram|memory)){0,2})(?: (?:utilization|usage))?(?: in parallel)?$/u.exec(text);
    if (!match) return null;
    const requested = match[1].match(/cpu|gpu|ram|memory/gu)!;
    ids = [...new Set(requested.map(id => id === 'memory' ? 'ram' : id))];
    if (ids.length < 2 && (!explicit || requested.length !== 1)) return null;
  }
  const catalog = missionPlanningCatalog();
  const tasks = ids.map(id => catalog[id]);
  if (check) tasks.push(catalog['project-tests']);
  if (tasks.length > 1) tasks.push({ id: 'report', objective: check ? 'Join the reviewed test result and measured samples' : 'Join the measured samples with provenance',
    executor: 'join.samples', criterion: 'joined-samples', claims: [], dependencies: tasks.map(task => task.id), maxAttempts: 2, timeoutMs: 1000 });
  return { objective: intent.trim(), scope, criteria: tasks.map(task => task.criterion), tasks };
}

/** A single timer outlier calls for a repeat sample before the report, not a bottleneck claim. */
export function replanNativeMission(mission: Mission, task: MissionTask) {
  const report = mission.tasks.find(t => t.executor === 'join.samples' && t.dependencies.includes(task.id));
  if (task.criterion !== 'backend' || task.executor !== 'sample.backend' || report?.state !== 'queued' || report.attempts.length ||
    mission.disposition === 'cancelled' || mission.tasks.some(t => t.id === 'backend-repeat')) return;
  const attempt = task.attempts.at(-1);
  const sample = object(attempt?.evidence?.value);
  if (!attempt?.verification?.passed || !numberIn(sample.timerOvershootMs, 20, 10_000)) return;
  return { reason: 'The first backend timer sample exceeded its interval by at least 20 ms; repeat before reporting.',
    additions: [{ id: 'backend-repeat', objective: 'Repeat the backend timer sample after the initial outlier',
      executor: task.executor, criterion: task.criterion, claims: task.claims, dependencies: [task.id],
      timeoutMs: task.timeoutMs, maxAttempts: task.maxAttempts }], dependents: { [report.id]: ['backend-repeat'] } };
}
