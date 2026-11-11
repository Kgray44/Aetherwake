import { planningDigest } from '../../vela-core/src/codex-planning-adapter.mts';
import type { Mission, MissionObjectiveReview, MissionObjectiveReviewPreview, MissionPlan } from './mission-contracts.mts';

export const provisionalObjectiveCoverage =
  'Whole-objective completion requires independent evidence beyond the listed task checks. Local observations alone cannot establish an external diagnosis or completion.';

const evidenceByExecutor: Readonly<Record<string, { source: string; description: string }>> = Object.freeze({
  'sample.cpu': { source: 'node:os.cpus', description: 'Operating system CPU counters showing utilization and the sample duration.' },
  'sample.ram': { source: 'node:os.totalmem+freemem', description: 'Operating system memory counters showing total and available physical memory and the utilization percentage.' },
  'sample.gpu': { source: 'windows:gpu-engine', description: 'Windows GPU engine counters showing peak utilization across the observed engines.' },
  'sample.backend': { source: 'aerynth.backend.node', description: 'Aerynth backend readings for process memory and timer delay.' },
  'codex.project-check': { source: 'codex-app-server:read-only-command', description: 'Codex App Server recording a successful exit and at least one passing test for the reviewed files and Git revision.' },
});

export function reviewableMissionObjective(plan: MissionPlan, planFingerprint: string): MissionObjectiveReview | undefined {
  if (plan.planning?.provider !== 'openai-api-vela' || !plan.planning.context ||
    plan.coverage?.limitations.length !== 1 || plan.coverage.limitations[0] !== provisionalObjectiveCoverage) return;
  const tasks = plan.tasks.filter(task => task.executor !== 'join.samples');
  if (!tasks.length || tasks.some(task => task.specialist || !Object.hasOwn(evidenceByExecutor, task.executor))) return;
  const obligations = tasks.map(({ id: taskId, objective, executor, criterion }) =>
    ({ taskId, objective, executor, criterion, evidenceSource: evidenceByExecutor[executor].source }));
  const binding = { planFingerprint, planRevision: 1 as const, obligations };
  return { digest: planningDigest({ ...binding, objective: plan.objective, scope: plan.scope, sources: plan.planning.context }), ...binding };
}

export function describeMissionObjectiveReview(review: MissionObjectiveReview): MissionObjectiveReviewPreview {
  return { ...review, obligations: review.obligations.map(obligation => ({
    ...obligation, proofDescription: evidenceByExecutor[obligation.executor].description,
  })) };
}

export function reviewedMissionObjectiveVerified(mission: Mission): boolean {
  const review = mission.objectiveReview;
  if (!review || mission.planRevision !== review.planRevision) return false;
  const current = reviewableMissionObjective(mission, review.planFingerprint);
  if (!current || current.digest !== review.digest) return false;
  return current.obligations.every(obligation => {
    const task = mission.tasks.find(item => item.id === obligation.taskId);
    const attempt = task?.attempts.at(-1);
    const evidence = attempt?.evidence;
    const verification = attempt?.verification;
    return task?.state === 'verified' && attempt?.outcome === 'verified' &&
      attempt.executor === obligation.executor && evidence && evidence.attemptId === attempt.id &&
      evidence.source === obligation.evidenceSource && verification?.passed === true &&
      verification.criterion === obligation.criterion && verification.evidenceIds.includes(evidence.id);
  });
}
