import test from 'node:test';
import assert from 'node:assert/strict';
import { blockDocument } from '../../../block-library/tests/component-dom.mts';
import { mountExperienceEvidence } from '../src/experience-evidence-view.ts';

const scope = { workspaceId: 'workspace', projectId: null };
const summary = { id: 'experiment', revision: 5, candidate: 'parallel', state: 'rolled-back', cohort: 'probe' };
const result = { decision: 'accepted', baselinePassed: true, candidatePassed: true, controlled: true,
  minimumEffectMs: 40, endpoint: 'admission-to-last-settlement-ms', limits: ['same-host trials'],
  development: { median: 81, measured: 6, enrolled: 6, interval: { lower: 55, upper: 104, coverage: .96875 } },
  holdout: { median: 69, measured: 6, enrolled: 6, interval: null } };
const evidence = { kind: 'aep-experiment-evidence', record: { contract: 'aerynth.aep.native-experiment@1',
  experiment: { id: summary.id, revision: summary.revision, scope, cohortRef: summary.cohort },
  result, hypothesis: 'Overlap probes', state: summary.state, trials: [],
  history: [{ state: 'rolled-back', revision: 5, at: '2026-11-12T00:00:00Z' }],
  policyReceipts: [{ state: 'rolled-back', policy: { version: 3 } }] }, trials: [] };
const settle = () => new Promise(resolve => setImmediate(resolve));

test('experiment evidence keeps historical acceptance separate from current policy', async () => {
  const { doc } = blockDocument();
  const view = mountExperienceEvidence(doc, scope, async name =>
    name === 'experience-list' ? { kind: 'aep-experiment-list', experiments: [summary] } :
      name === 'experience-evidence' ? evidence : null);
  view.show('learning');
  await settle();
  assert.match(view.element.textContent, /No applicable finding/);
  view.show('experiment');
  await settle();
  assert.match(view.element.textContent, /accepted/);
  assert.match(view.element.textContent, /55.*104/);
  view.show('timeline');
  await settle();
  assert.match(view.element.textContent, /rolled back.*2026-11-12/s);
  assert.match(view.element.textContent, /Policy version 3/);
  view.clear();
  assert.doesNotMatch(view.element.textContent, /2026-11-12/);
});

test('mismatched scope and late evidence cannot render', async () => {
  const { doc } = blockDocument();
  let release;
  const view = mountExperienceEvidence(doc, scope, async name => name === 'experience-list' ?
    { kind: 'aep-experiment-list', experiments: [summary] } : new Promise(resolve => { release = resolve; }));
  view.show('experiment');
  await settle();
  release({ ...evidence, record: { ...evidence.record, experiment: { ...evidence.record.experiment, scope: { ...scope, workspaceId: 'foreign' } } } });
  await settle();
  assert.match(view.element.textContent, /Evidence unavailable/);
  assert.doesNotMatch(view.element.textContent, /Overlap probes/);
  view.refresh();
  await settle();
  view.clear();
  release(evidence);
  await settle();
  assert.doesNotMatch(view.element.textContent, /Overlap probes/);
});

test('only a scope-matched owner finding can show an effective policy', async () => {
  const { doc } = blockDocument();
  const finding = { contract: 'aerynth.experience.finding@1', id: 'finding:experiment', scope,
    experimentId: summary.id, experimentRevision: summary.revision, cohort: summary.cohort,
    result, lifecycle: 'monitored', disposition: 'recommend-candidate', applicability: 'matched',
    policy: { scope, experimentId: summary.id, version: 8, expiresAtMs: Date.parse('2026-11-13T12:00:00Z') } };
  let response = finding;
  const view = mountExperienceEvidence(doc, scope, async name => name === 'experience-list' ?
    { kind: 'aep-experiment-list', experiments: [summary] } : response);
  view.show('learning');
  await settle();
  assert.match(view.element.textContent, /Effective policyVersion 8/);
  response = { ...finding, policy: { ...finding.policy, scope: { ...scope, projectId: 'foreign' } } };
  await view.refresh();
  assert.match(view.element.textContent, /Evidence unavailable/);
  assert.doesNotMatch(view.element.textContent, /Version 8/);
});
