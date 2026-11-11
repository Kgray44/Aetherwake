import assert from 'node:assert/strict';
import test from 'node:test';
import { AEP_EXPERIMENT_CONTRACT, AEP_FINDING_CONTRACT, readAepExperiment, readAepFinding,
  type AepExperimentRecord } from '../src/aep-experience-contract.mts';

const scope = { workspaceId: 'workspace-a', projectId: 'project-a' };
const experiment = {
  contract: AEP_EXPERIMENT_CONTRACT, id: 'experiment-a', revision: 2, scope, owner: 'air', hypothesisRef: 'hypothesis-a',
  baselinePolicyRef: 'strategy@1', candidatePolicyRef: 'strategy@2', cohortRef: 'cohort-a', holdoutRef: 'holdout-a',
  methodology: 'paired', metricRefs: ['latency'], guardrailRefs: ['quality', 'privacy'],
  state: 'evaluated', conclusion: 'benefit', qualityGate: 'pass', baselineTraceRefs: ['trace-baseline'],
  candidateTraceRefs: ['trace-candidate'], evaluationRefs: ['independent-review-a'],
} satisfies AepExperimentRecord;
const finding = {
  contract: AEP_FINDING_CONTRACT, id: 'finding-a', revision: 1, scope, experimentId: experiment.id,
  experimentRevision: experiment.revision, disposition: 'recommend-candidate',
};

test('round-trips bounded source references with exact scope and experiment revision', () => {
  const restored = readAepExperiment(JSON.parse(JSON.stringify(experiment)));
  assert.deepEqual(restored, experiment);
  assert.deepEqual(readAepFinding(JSON.parse(JSON.stringify(finding)), restored), finding);
  assert.notStrictEqual(restored.baselineTraceRefs, experiment.baselineTraceRefs);
  assert.throws(() => readAepFinding({ ...finding, scope: { ...scope, projectId: null } }, restored), /aep_finding_binding/);
  assert.throws(() => readAepFinding({ ...finding, experimentRevision: 1 }, restored), /aep_finding_binding/);
});

test('rejects ambiguous, unreviewed and unrecognized experiment records', () => {
  for (const invalid of [
    { contract: 'aerynth.experience.experiment@2' },
    { baselinePolicyRef: experiment.candidatePolicyRef },
    { candidateTraceRefs: experiment.baselineTraceRefs },
    { evaluationRefs: [] },
    { candidateTraceRefs: Array.from({ length: 257 }, (_, i) => 'trace-' + i) },
    { guardrailRefs: ['quality', 'quality'] },
    { providerPrompt: 'Private source text' },
    { state: 'running' },
  ]) assert.throws(() => readAepExperiment({ ...experiment, ...invalid }), /aep_experiment/);
});

test('allows pending or negative evidence without treating it as a policy change', () => {
  const planned = readAepExperiment({ ...experiment, state: 'planned', conclusion: 'pending', qualityGate: 'unknown',
    baselineTraceRefs: [], candidateTraceRefs: [], evaluationRefs: [] });
  assert.throws(() => readAepFinding(finding, planned), /aep_finding_binding/);
  const negative = readAepExperiment({ ...experiment, conclusion: 'harm' });
  assert.throws(() => readAepFinding(finding, negative), /aep_finding_binding/);
  const fasterWithRegression = readAepExperiment({ ...experiment, qualityGate: 'fail' });
  assert.throws(() => readAepFinding(finding, fasterWithRegression), /aep_finding_binding/);
  const missingQuality = readAepExperiment({ ...experiment, qualityGate: 'unknown' });
  assert.throws(() => readAepFinding(finding, missingQuality), /aep_finding_binding/);
  assert.equal(readAepFinding({ ...finding, disposition: 'retain-baseline' }, negative).disposition, 'retain-baseline');
  assert.throws(() => readAepFinding({ ...finding, activePolicy: 'strategy@2' }, experiment), /aep_finding/);
});
