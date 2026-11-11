import { ensure } from './contracts.mts';
import type { MissionScope } from './mission-contracts.mts';

export const AEP_EXPERIMENT_CONTRACT = 'aerynth.experience.experiment@1' as const;
export const AEP_FINDING_CONTRACT = 'aerynth.experience.finding@1' as const;

const owners = ['air', 'arie', 'mission', 'cie'] as const;
const methods = ['paired', 'randomized', 'shadow', 'canary', 'holdout'] as const;
const states = ['planned', 'running', 'evaluated', 'invalid'] as const;
const conclusions = ['pending', 'benefit', 'neutral', 'harm', 'inconclusive'] as const;
const qualityGates = ['pass', 'fail', 'unknown'] as const;
const dispositions = ['recommend-candidate', 'retain-baseline', 'insufficient-evidence'] as const;

export interface AepExperimentRecord {
  contract: typeof AEP_EXPERIMENT_CONTRACT;
  id: string;
  revision: number;
  scope: MissionScope;
  owner: typeof owners[number];
  hypothesisRef: string;
  baselinePolicyRef: string;
  candidatePolicyRef: string;
  cohortRef: string;
  holdoutRef: string;
  methodology: typeof methods[number];
  metricRefs: string[];
  guardrailRefs: string[];
  state: typeof states[number];
  conclusion: typeof conclusions[number];
  qualityGate: typeof qualityGates[number];
  baselineTraceRefs: string[];
  candidateTraceRefs: string[];
  evaluationRefs: string[];
}

export interface AepFindingRecord {
  contract: typeof AEP_FINDING_CONTRACT;
  id: string;
  revision: number;
  scope: MissionScope;
  experimentId: string;
  experimentRevision: number;
  disposition: typeof dispositions[number];
}

function exact(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key));
}

const ref = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:@-]{0,127}$/u.test(value);
const revision = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const refs = (value: unknown, limit: number): value is string[] =>
  Array.isArray(value) && value.length <= limit && [...value].every(ref) && new Set(value).size === value.length;
const member = (choices: readonly string[], value: unknown) => typeof value === 'string' && choices.includes(value);
const scope = (value: unknown): value is MissionScope => exact(value, ['workspaceId', 'projectId']) &&
  ref(value.workspaceId) && (value.projectId === null || ref(value.projectId));

/** Decode a reference-only record. Canonical owners must resolve and authorize its sources before use. */
export function readAepExperiment(value: unknown): AepExperimentRecord {
  ensure(exact(value, ['contract', 'id', 'revision', 'scope', 'owner', 'hypothesisRef', 'baselinePolicyRef',
    'candidatePolicyRef', 'cohortRef', 'holdoutRef', 'methodology', 'metricRefs', 'guardrailRefs', 'state',
    'conclusion', 'qualityGate', 'baselineTraceRefs', 'candidateTraceRefs', 'evaluationRefs']), 'aep_experiment_shape');
  ensure(value.contract === AEP_EXPERIMENT_CONTRACT && ref(value.id) && revision(value.revision) && scope(value.scope) &&
    member(owners, value.owner) && member(methods, value.methodology) && member(states, value.state) &&
    member(conclusions, value.conclusion) && member(qualityGates, value.qualityGate) &&
    [value.hypothesisRef, value.baselinePolicyRef, value.candidatePolicyRef, value.cohortRef, value.holdoutRef].every(ref) &&
    value.baselinePolicyRef !== value.candidatePolicyRef, 'aep_experiment_identity');
  ensure(refs(value.metricRefs, 32) && value.metricRefs.length > 0 &&
    refs(value.guardrailRefs, 32) && value.guardrailRefs.length > 0 &&
    refs(value.baselineTraceRefs, 256) && refs(value.candidateTraceRefs, 256) && refs(value.evaluationRefs, 64),
    'aep_experiment_evidence');
  const candidateTraces = new Set(value.candidateTraceRefs);
  ensure(value.baselineTraceRefs.every(trace => !candidateTraces.has(trace)), 'aep_experiment_arm_overlap');
  if (value.state === 'evaluated') {
    ensure(value.conclusion !== 'pending' && value.baselineTraceRefs.length > 0 && value.candidateTraceRefs.length > 0 &&
      value.evaluationRefs.length > 0, 'aep_experiment_missing_evaluation');
  } else if (value.state === 'planned' || value.state === 'running') {
    ensure(value.conclusion === 'pending' && value.qualityGate === 'unknown', 'aep_experiment_premature_conclusion');
    if (value.state === 'planned') {
      ensure(value.baselineTraceRefs.length + value.candidateTraceRefs.length + value.evaluationRefs.length === 0,
        'aep_experiment_premature_evidence');
    }
  }
  return structuredClone(value) as unknown as AepExperimentRecord;
}

/** Bind an advisory finding to an exact, current AEP experiment supplied by the caller. */
export function readAepFinding(value: unknown, experiment: AepExperimentRecord): AepFindingRecord {
  ensure(exact(value, ['contract', 'id', 'revision', 'scope', 'experimentId', 'experimentRevision', 'disposition']),
    'aep_finding_shape');
  ensure(value.contract === AEP_FINDING_CONTRACT && ref(value.id) && revision(value.revision) && scope(value.scope) &&
    ref(value.experimentId) && revision(value.experimentRevision) && member(dispositions, value.disposition), 'aep_finding_identity');
  const source = readAepExperiment(experiment);
  ensure(source.state === 'evaluated' && value.experimentId === source.id && value.experimentRevision === source.revision &&
    value.scope.workspaceId === source.scope.workspaceId && value.scope.projectId === source.scope.projectId &&
    (value.disposition !== 'recommend-candidate' || source.conclusion === 'benefit' && source.qualityGate === 'pass'),
    'aep_finding_binding');
  return structuredClone(value) as unknown as AepFindingRecord;
}
