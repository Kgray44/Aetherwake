import { createHash } from 'node:crypto';
import { ensure } from './contracts.mts';
import type { MissionScope } from './mission-contracts.mts';
import type { MissionService } from './mission-service.mts';

export const AEP_EVALUATION_REFERENCE_CONTRACT = 'aerynth.experience.evaluation-reference@1' as const;
export const AEP_EVALUATION_CONTRACT = 'aerynth.experience.evaluation@1' as const;
export interface AepEvaluationReference {
  contract: typeof AEP_EVALUATION_REFERENCE_CONTRACT;
  namespace: 'mission-verification';
  missionId: string;
  missionRevision: number;
  planRevision: number;
  taskId: string;
  attemptId: string;
  evidenceId: string;
}
const fields = ['contract', 'namespace', 'missionId', 'missionRevision', 'planRevision', 'taskId', 'attemptId', 'evidenceId'];
const identifier = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:@-]{0,127}$/u.test(value);
const revision = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** A closed locator, never a grant or an evaluator's assertion of success. */
export function readAepEvaluationReference(value: unknown): AepEvaluationReference {
  ensure(value !== null && typeof value === 'object' && !Array.isArray(value), 'aep_evaluation_reference_shape');
  const row = value as Record<string, unknown>;
  ensure(Object.keys(row).length === fields.length && fields.every(key => Object.hasOwn(row, key)), 'aep_evaluation_reference_shape');
  ensure(row.contract === AEP_EVALUATION_REFERENCE_CONTRACT && row.namespace === 'mission-verification' &&
    [row.missionId, row.taskId, row.attemptId, row.evidenceId].every(identifier) &&
    revision(row.missionRevision) && revision(row.planRevision), 'aep_evaluation_reference_identity');
  // Canonical key order makes the reference ID independent of JSON property order.
  return Object.fromEntries(fields.map(key => [key, row[key]])) as unknown as AepEvaluationReference;
}
export function aepEvaluationReferenceId(value: unknown): string {
  return 'mission-verification:' + digest(readAepEvaluationReference(value));
}

/** Resolve through the canonical owner on every read, including source revocation checks.
 * This proves a recorded native task evidence check, not experiment-wide independent quality.
 * No experiment table, provider disclosure, policy mutation or imported evaluator authority.
 */
export function resolveAepEvaluationReference(value: unknown, missions: MissionService, scope: MissionScope) {
  const reference = readAepEvaluationReference(value);
  const mission = missions.read(reference.missionId, scope);
  ensure(mission.revision === reference.missionRevision && mission.planRevision === reference.planRevision,
    'aep_evaluation_reference_stale');
  const task = mission.tasks.find(task => task.id === reference.taskId);
  const attempt = task?.attempts.at(-1);
  const evidence = attempt?.evidence, verification = attempt?.verification;
  const source = task?.executor === 'sample.cpu' ? 'node:os.cpus' :
    task?.executor === 'sample.ram' ? 'node:os.totalmem+freemem' : null;
  ensure(source && !task?.specialist && !task?.teamMember && !task?.projectCheck && !task?.artifactImage,
    'aep_evaluation_authority_unsupported');
  ensure(task?.state === 'verified' && attempt?.outcome === 'verified' && attempt.id === reference.attemptId &&
    evidence?.id === reference.evidenceId && evidence.attemptId === attempt.id && evidence.source === source &&
    verification?.passed === true && verification.criterion === task.criterion &&
    verification.evidenceIds.length === 1 && verification.evidenceIds[0] === evidence.id,
    'aep_evaluation_evidence_unavailable');
  return {
    contract: AEP_EVALUATION_CONTRACT, kind: 'evaluation-reference' as const,
    id: aepEvaluationReferenceId(reference), reference,
    scope: { ...mission.scope },
    authority: { kind: 'canonical-task-verifier' as const, owner: 'MissionService' as const, executor: task.executor },
    assessed: { evidenceId: evidence.id, evidenceDigest: digest(evidence), criterion: verification.criterion },
    result: 'passed' as const,
    coverage: 'native-task-evidence-only' as const,
    independentExperimentQuality: 'not-evaluated' as const,
    policyPromotion: 'not-authorized' as const,
  };
}
