import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Guard the actual UI: evidence presence may never select the acceptance badge.
test('criterion evidence cannot select an accepted badge', () => {
  const source = readFileSync(new URL('./src/main.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /pass\s*\?\s*['"]accepted['"]/);
});

import { criterionEvidenceStatus, evidenceClaimStatus } from './src/evidence-status.mjs';
const revision = 'a'.repeat(40);
const passed = {result:'passed', synthetic:false, revision,task_id:'task',attempt_id:'attempt'};
const attempts=[{id:'attempt',task_id:'task',revision}];
test('matching imported pass is reported but unverified, regardless of owner claims', () => {
  assert.equal(criterionEvidenceStatus([passed], revision, attempts), 'reported_pass_unverified');
  assert.equal(criterionEvidenceStatus([{...passed,owner_acceptance:'accepted',authenticated:true}],revision,attempts), 'reported_pass_unverified');
  assert.equal(evidenceClaimStatus(passed,attempts), 'reported_pass_unverified');
});
test('missing, synthetic, stale and nonpassing evidence cannot establish acceptance', () => {
  for(const evidence of [[],[{...passed,synthetic:true}],[{...passed,synthetic:undefined}],[{...passed,revision:'b'.repeat(40)}],[{...passed,result:'failed'}]]) {
    assert.equal(criterionEvidenceStatus(evidence,revision),'unverified');
  }
});
test('display classification does not mutate canonical task or evidence records', () => {
  const task={state:'accepted',owner_acceptance:'accepted',revision};
  const original=JSON.stringify({task,passed});
  criterionEvidenceStatus([passed],task.revision);
  assert.equal(JSON.stringify({task,passed}),original);
});

test('absent or mismatched attempt linkage is explicit and never accepted', () => {
 for(const links of [[],[{id:'wrong',task_id:'task',revision}],[{id:'attempt',task_id:'other',revision}],[{id:'attempt',task_id:'task',revision:'b'.repeat(40)}]]) {
  assert.equal(criterionEvidenceStatus([passed],revision,links),'unverified_missing_attempt');
  assert.equal(evidenceClaimStatus(passed,links),'unverified_missing_attempt');
 }
});
