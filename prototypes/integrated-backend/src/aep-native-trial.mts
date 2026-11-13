import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { validateSystemMemoryMeasurement } from '../../vela-core/src/system-information.ts';
import { projectMissionExecution } from './execution-profiler.mts';
import { missionPlanningCatalog } from './mission-native.mts';
import type { MissionPlan, MissionProjection, MissionScope } from './mission-contracts.mts';

export const nativeTrialProtocol = 'aerynth.aep.native-probe-pairs@1' as const;
export type TrialPartition = 'development' | 'holdout';
export const pairsPerPartition = 6;
export const minimumEffectMs = 40;

const objectives = {
  development: 'Compare verified host CPU and backend timer sampling',
  holdout: 'Compare verified host CPU, RAM and backend timer sampling',
};
const sources: Record<string, string> = {
  cpu: 'node:os.cpus', backend: 'aerynth.backend.node', ram: 'node:os.totalmem+freemem', report: 'aerynth.mission.journal',
};

export function nativeTrialPlan(scope: MissionScope, partition: TrialPartition): MissionPlan {
  const catalog = missionPlanningCatalog();
  const ids = partition === 'development' ? ['cpu', 'backend'] : ['backend', 'ram', 'cpu'];
  const tasks = ids.map(id => catalog[id]);
  tasks.push({ id: 'report', objective: 'Join all verified observations', executor: 'join.samples', criterion: 'joined-samples',
    dependencies: ids, claims: [], timeoutMs: 1000, maxAttempts: 2 });
  return { scope, objective: objectives[partition], criteria: tasks.map(task => task.criterion), tasks };
}

const finiteRange = (value: unknown, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

/** Fixed objective oracle. It rechecks the plan, recorded effects and report references without calling the executor verifier. */
export function assessNativeTrial(mission: MissionProjection, partition: TrialPartition) {
  const expected = nativeTrialPlan(mission.scope, partition);
  const profile = projectMissionExecution(mission);
  const capability = !mission.planning && !mission.team && !mission.coverage && mission.planRevision === 1 &&
    mission.objective === expected.objective && isDeepStrictEqual(mission.criteria, expected.criteria) &&
    mission.tasks.length === expected.tasks.length && expected.tasks.every(spec => {
      const actual = mission.tasks.find(task => task.id === spec.id);
      return actual && !actual.specialist && !actual.teamMember && !actual.projectCheck && !actual.artifactImage &&
        Object.entries(spec).every(([key, value]) => isDeepStrictEqual(actual[key as keyof typeof actual], value));
    });
  const permissions = mission.tasks.every(task => Object.hasOwn(sources, task.id) && task.executor !== 'sample.gpu' &&
    task.claims.every(claim => claim.mode === 'read' && expected.tasks.some(spec =>
      spec.id === task.id && spec.claims.some(allowed => isDeepStrictEqual(allowed, claim))))) &&
    profile.economics.providerCalls === 0;
  const proofs = expected.tasks.map(spec => {
    const task = mission.tasks.find(item => item.id === spec.id);
    const attempt = task?.attempts.at(-1), evidence = attempt?.evidence;
    if (task?.state !== 'verified' || attempt?.outcome !== 'verified' || !evidence ||
        evidence.source !== sources[spec.id] || evidence.attemptId !== attempt.id ||
        !attempt.verification?.passed || !isDeepStrictEqual(attempt.verification.evidenceIds, [evidence.id])) return null;
    return evidence;
  });
  const inputs = proofs.slice(0, -1);
  const report = proofs.at(-1);
  const correctness = mission.outcome === 'verified' && inputs.every(evidence => {
    if (!evidence) return false;
    const value = evidence.value as Record<string, unknown> | null;
    if (!value) return false;
    switch (evidence.source) {
      case sources.cpu:
        return value.metric === 'cpu' && value.source === sources.cpu && finiteRange(value.percent, 0, 100) &&
          finiteRange(value.sampleMs, 200, 5000) && finiteRange(value.logicalCpus, 1, 65536) &&
          typeof value.measuredAt === 'string' && Number.isFinite(Date.parse(value.measuredAt));
      case sources.ram:
        try { validateSystemMemoryMeasurement(value); return true; } catch { return false; }
      case sources.backend:
        return value.sampleWindowMs === 100 && finiteRange(value.timerOvershootMs, 0, 10_000) &&
          finiteRange(value.rssBytes, 1, Number.MAX_SAFE_INTEGER) && finiteRange(value.heapUsedBytes, 1, Number.MAX_SAFE_INTEGER);
      default: return false;
    }
  });
  const outputQuality = !!report && inputs.every(Boolean) && isDeepStrictEqual(report.value,
    inputs.map(evidence => evidence && ({ id: evidence.id, source: evidence.source, attemptId: evidence.attemptId })));
  return {
    authority: 'native-probe-objective-oracle@1' as const,
    gates: { capability: !!capability, permissions, correctness, outputQuality },
    proofs: proofs.flatMap(proof => proof ? [{
      evidenceId: proof.id, attemptId: proof.attemptId, source: proof.source,
      digest: createHash('sha256').update(JSON.stringify(proof)).digest('hex'),
    }] : []),
    metrics: {
      elapsedMs: profile.admissionToLastSettlementMs,
      firstVerifiedTaskMs: profile.admissionToFirstVerifiedTaskMs,
      criticalPath: profile.work.criticalPath,
      workerMs: profile.work.workerMs,
      overlapMs: profile.work.overlapMs,
      peakWorkers: profile.work.peakWorkers,
      providerCalls: profile.economics.providerCalls,
      providerAdapterMs: profile.attempts.flatMap(attempt => attempt.providerAdapterMs === null ? [] :
        [{ attemptId: attempt.id, durationMs: attempt.providerAdapterMs }]),
      usage: profile.economics.usageBySource.reported,
      usageCoverage: profile.economics.usageCoverage,
      cost: profile.economics.cost,
      costCoverage: profile.economics.costCoverage,
      resourcePolicy: {
        leaseCoverage: profile.resourcePolicy.leaseCoverage,
        attemptsByReason: profile.resourcePolicy.attemptsByReason,
      },
      admissionEventSeq: profile.admission?.eventSeq ?? null,
      settlementEventSeq: profile.lastSettlement?.eventSeq ?? null,
    },
  };
}
