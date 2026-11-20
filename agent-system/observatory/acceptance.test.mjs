import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Guard the actual UI: evidence presence may never select the acceptance badge.
test('criterion evidence cannot select an accepted badge', () => {
  const source = readFileSync(new URL('./src/main.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /pass\s*\?\s*['"]accepted['"]/);
});

import { criterionEvidenceStatus, evidenceClaimStatus, ownerReviewByCriterion } from './src/evidence-status.mjs';
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
test('only a current canonical owner review tied to the accepted candidate satisfies a criterion',()=>{
  const task={id:'task',owner_acceptance:'accepted',acceptance:{criteria:[{id:'c1'},{id:'c2'}]}};
  const accepted={criterion_id:'c1',revision,uri:'https://example.test/checked-artifact'};
  const canonical={task,lifecycle:{stored_state:'completed',evidence:[accepted,{...accepted,criterion_id:'c2',revision:'b'.repeat(40)}]},
    attempts:[{id:'a',state:'succeeded',candidate_revision:revision}],
    events:[{kind:'accept',attempt_id:'a',revision,at:'2026-11-20T03:00:00Z'}]};
  const shown=ownerReviewByCriterion(task,canonical);
  assert.deepEqual([...shown.keys()],['c1']);
  assert.equal(shown.get('c1').at,canonical.events[0].at);
  assert.equal(ownerReviewByCriterion(task,{...canonical,lifecycle:{...canonical.lifecycle,stored_state:'archived'}}).size,1);
  assert.equal(ownerReviewByCriterion(task,{...canonical,lifecycle:{...canonical.lifecycle,stored_state:'queued'}}).size,0);
  assert.equal(ownerReviewByCriterion(task,{...canonical,task:{...task,id:'other'}}).size,0);
  assert.equal(ownerReviewByCriterion(task,null).size,0);
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

import { observedTaskTraceCoverage, recurringTraceBottlenecks, traceTimeline } from './src/trace-timeline.mjs';

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

test('overview coverage includes linked measured spans and excludes unmatched or open attempts',()=>{
  const alpha={id:'a'};
  const beta={id:'b'};
  const revision='a'.repeat(40);
  const attempt=task_id=>({id:'attempt-'+task_id,task_id,revision});
  const span=(task_id,span_id,start,end,override={})=>[
    {kind:'span_start',occurred_at:new Date(start).toISOString()},
    ...(end===null?[]:[{kind:'span_end',occurred_at:new Date(end).toISOString()}]),
  ].map(event=>({...event,task_id,attempt_id:'attempt-'+task_id,trace_id:'trace-'+task_id,revision,span_id,phase:'verification',...override}));
  const events=[...span('a','root',0,5000),...span('a','nested',1000,3000),...span('b','parallel',2000,8000),
    ...span('b','unfinished',8000,null),...span('b','wrong-revision',10000,40000,{revision:'b'.repeat(40)}),
    ...span('other','unrelated',8000,10000)];
  assert.deepEqual(observedTaskTraceCoverage([alpha,beta],[attempt('a'),attempt('b'),attempt('other')],events),
    {coveredMs:8000,tasks:2,spans:3});
  assert.deepEqual(observedTaskTraceCoverage([alpha],[],events),{coveredMs:null,tasks:0,spans:0});
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

test('recurring timing patterns require matched spans across distinct comparable Tasks', () => {
  const tasks = [1, 2, 3, 4].map(i => ({
    record_type: 'task', id: 'task_' + i, classification: { primary: 'maintenance' }
  }));
  const span = (i, phase, end) => ['span_start', 'span_end'].map((kind, j) => ({
    task_id: 'task_' + i, attempt_id: 'attempt_' + i, trace_id: 'trace_' + i, span_id: phase,
    revision: '7'.repeat(40), phase, kind, occurred_at: new Date(j ? end : 0).toISOString(), measurements: []
  }));
  const events = [100, 80, 120].flatMap((duration, index) => [
    ...span(index + 1, 'verification', duration), ...span(index + 1, 'context', 20)
  ]);
  assert.deepEqual(recurringTraceBottlenecks(tasks, events), [
    { taskClass: 'maintenance', phase: 'verification', comparableTasks: 3, dominantTasks: 3, medianMs: 100 }
  ]);
  const noisyTask = [...events, span(2, 'review', 80)[0]];
  assert.deepEqual(recurringTraceBottlenecks(tasks, noisyTask), []);
  // Repeated attempts from one Task supply one sample to the class comparison.
  const duplicate = [...events.slice(0, 4), ...events.slice(0, 4).map(event => ({ ...event, attempt_id: 'second_attempt' }))];
  assert.deepEqual(recurringTraceBottlenecks(tasks, duplicate), []);
});

import { activityHref, parseActivityHref, searchActivity, newestActivity, pullRepositoryTotals, runRepositoryTotal } from './src/github-activity.mjs';

test('pull and run views use creation time, plus stable descending identity on ties', () => {
  const first = { number: 41, id: 900, title: 'Refine task routing', state: 'open', author: 'k', base_ref: 'main',
    created_at: '2026-11-15T00:00:00Z', updated_at: '2026-11-17T00:00:00Z' };
  const newer = { ...first, number: 42, id: 901, title: 'Qualify workflow timing', merged: true,
    created_at: '2026-11-16T00:00:00Z' };
  assert.deepEqual(newestActivity('pulls', [first, newer]).map(item => item.number), [42, 41]);
  assert.deepEqual(searchActivity('pulls', [first, newer], { query: 'workflow 42', state: 'merged', group: 'main' }), [newer]);
  const runs = [{ id: 200, created_at: newer.created_at }, { id: 201, created_at: newer.created_at }];
  assert.deepEqual(newestActivity('runs', runs).map(item => item.id), [201, 200]);
});

test('GitHub activity detail links use repository PR numbers and safe run IDs', () => {
  assert.deepEqual(parseActivityHref(activityHref('pulls', 298)), { kind: 'pulls', id: 298 });
  assert.deepEqual(parseActivityHref(activityHref('runs', 43993349495)), { kind: 'runs', id: 43993349495 });
  assert.equal(parseActivityHref('#ci-runs/99999999999999999'), null);
  assert.equal(parseActivityHref('#pull-requests/invalid'), null);
});

test('repository headlines never convert a limited list into a total', () => {
  const items = Array.from({ length: 40 }, (_, index) => ({ number:index+1, state:'open' }));
  assert.equal(pullRepositoryTotals({ status:'available', items }), null);
  assert.equal(runRepositoryTotal({ status:'available', items }), null);
  const breakdown = { open:17, merged:29, closed:6 };
  const total = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
  const totals = { status:'available', total, ...breakdown, observed_at:'2026-11-17T02:00:00Z' };
  assert.equal(pullRepositoryTotals({ status:'available', items, totals }).total, total);
  assert.equal(pullRepositoryTotals({ status:'stale', items, totals }).stale, true);
  assert.equal(pullRepositoryTotals({ status:'available', totals:{ ...totals, closed:7 } }), null);
  const repositoryRuns = items.length + 11;
  assert.equal(runRepositoryTotal({ status:'available', items, repository_total:repositoryRuns }), repositoryRuns);
});
