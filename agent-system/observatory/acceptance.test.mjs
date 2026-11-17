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

import { traceTimeline } from './src/trace-timeline.mjs';

test('trace coverage counts overlapping spans once and retains partial spans and monotonic durations', () => {
  const time = n => new Date(n).toISOString();
  const event = (span_id, kind, n, measurements = []) => ({
    task_id: 'task_real', attempt_id: 'attempt_real', trace_id: 'trace_real', span_id,
    revision: '7'.repeat(40), phase: 'verification', kind, occurred_at: time(n), measurements
  });
  const timeline = traceTimeline([
    event('late', 'span_end', 40),
    event('root', 'span_start', 0),
    event('root', 'span_end', 100, [{ name: 'elapsed_wall_ms', availability: 'observed', value: 112, unit: 'ms' }]),
    event('overlap', 'span_start', 50),
    event('overlap', 'span_end', 135),
    event('pending', 'span_start', 150)
  ]);
  assert.equal(timeline.coveredMs, 135);
  assert.equal(timeline.phases[0].coveredMs, 135);
  assert.equal(timeline.incomplete, 2);
  assert.equal(timeline.spans.find(span => span.id === 'root').monotonicMs, 112);
  assert.equal(timeline.spans.find(span => span.id === 'overlap').monotonicMs, null);
  assert.equal(timeline.spans.find(span => span.id === 'late').complete, false);
  assert.equal(timeline.spans.find(span => span.id === 'pending').complete, false);
});

test('a reused span ID cannot pair boundaries across attempts or revisions', () => {
  const base = { task_id: 'task_real', trace_id: 'trace_real', span_id: 'overlap', revision: '7'.repeat(40), phase: 'context', occurred_at: '2026-11-16T00:00:00Z' };
  const timeline = traceTimeline([
    { ...base, attempt_id: 'attempt_one', kind: 'span_start' },
    { ...base, attempt_id: 'attempt_two', kind: 'span_end' },
    { ...base, attempt_id: 'attempt_one', revision: '8'.repeat(40), kind: 'span_end' }
  ]);
  assert.equal(timeline.spans.length, 3);
  assert.equal(timeline.incomplete, 3);
  assert.equal(timeline.coveredMs, null);
});
