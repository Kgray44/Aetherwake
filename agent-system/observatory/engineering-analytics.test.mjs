import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEngineeringAnalytics } from './src/engineering-analytics.mjs';

const now = '2026-11-17T12:00:00.000Z';
const at = (seconds = 0) => new Date(Date.parse('2026-11-17T10:00:00.000Z') + seconds * 1000).toISOString();
const rev = 'a'.repeat(40);
const obs = (name, unit, value) => ({name,unit,value,availability:'observed',source:'fixture',method:'direct'});
const task = {record_type:'task',id:'task',revision:rev,state:'verifying',created_at:at(),classification:{primary:'backend'}};
const attempt = {record_type:'attempt',id:'attempt',task_id:'task',revision:rev,state:'failed',failure_category:'test',created_at:at(),started_at:at(),finished_at:at(15)};
const event = (id, span, kind, phase, seconds, measurements = []) =>
  ({event_id:id,task_id:'task',attempt_id:'attempt',revision:rev,trace_id:'trace',span_id:span,kind,phase,occurred_at:at(seconds),measurements});

test('empty inputs retain unknown coverage and no fabricated timings', () => {
  const result = buildEngineeringAnalytics({now});
  assert.equal(result.sources.records, 'unavailable');
  assert.equal(result.sources.trace, 'unavailable');
  assert.equal(result.days.length, 14);
  assert.equal(result.days[0].date, '2026-11-04');
  assert.equal(result.days.at(-1).date, '2026-11-17');
  assert.equal(result.days.at(-1).tasks, null);
  assert.equal(result.days.at(-1).ciRuns, null);
  assert.equal(result.attempts.successRate, null);
  assert.equal(result.attempts.medianMs, null);
  assert.equal(result.pulls.medianMergeMs, null);
  assert.equal(result.trace.coveredMs, null);
  assert.deepEqual(result.usage.tokens, []);
  assert.deepEqual(result.usage.resources, []);
  assert.equal(result.usage.costUsd, null);
});

test('counts authentic observations, keeps failures and evidence separate from Task acceptance', () => {
  const queued = {...attempt,id:'queued',state:'queued',finished_at:undefined};
  const evidence = {record_type:'evidence',id:'pass',task_id:'task',attempt_id:'attempt',revision:rev,result:'passed',synthetic:false,observed_at:at(12)};
  const result = buildEngineeringAnalytics({records:[
    task, task, attempt, attempt, queued, evidence, {...evidence,id:'synthetic',synthetic:true},
    {...evidence,id:'unlinked',attempt_id:'missing'},
  ], now});
  assert.equal(result.tasks.total, 1);
  assert.deepEqual(result.tasks.byState, {verifying:1});
  assert.equal(result.attempts.total, 2);
  assert.equal(result.attempts.terminal, 1);
  assert.equal(result.attempts.successRate, 0);
  assert.equal(result.attempts.timed, 1);
  assert.equal(result.attempts.medianMs, 15000);
  assert.deepEqual(result.attempts.byFailure, {test:1});
  assert.deepEqual(result.evidence.byStatus, {reported_pass_unverified:1,unverified:1,unverified_missing_attempt:1});
  assert.equal(result.evidence.synthetic, 1);
  assert.equal(result.days.at(-1).evidence, 3);
  assert.equal(result.days.at(-1).attempts, 2);
});

test('reports bounded stale PR and CI outcomes using actual timestamps', () => {
  const firstPr = {number:11,merged:true,created_at:at(),merged_at:at(1800)};
  const result = buildEngineeringAnalytics({now,github:{
    pulls:{status:'stale',observed_at:at(40),items:[
      firstPr,firstPr,{number:12,merged:true,created_at:at(100),merged_at:at(3700)},
      {number:13,merged:true,created_at:at(200)},{number:14,merged:false,created_at:at(220)},
      {number:15,created_at:at(280)},
    ]},
    ci:{status:'available',items:[
      {id:21,status:'completed',conclusion:'success',created_at:at(0)},
      {id:22,status:'completed',conclusion:'failure',created_at:at(9)},
      {id:23,status:'completed',conclusion:'cancelled',created_at:at(10)},
      {id:24,status:'in_progress',created_at:at(11)},
    ]},
  }});
  assert.equal(result.pulls.status, 'stale');
  assert.equal(result.pulls.total, 5);
  assert.equal(result.pulls.merged, 3);
  assert.equal(result.pulls.mergedKnown, 4);
  assert.equal(result.pulls.mergeSamples, 2);
  assert.equal(result.pulls.medianMergeMs, 2700000);
  assert.equal(result.ci.total, 4);
  assert.equal(result.ci.concluded, 3);
  assert.equal(result.ci.successRate, 1/3);
  assert.deepEqual(result.ci.byOutcome, {success:1,failure:1,cancelled:1,in_progress:1});
  assert.deepEqual(result.days.at(-1), {date:'2026-11-17',tasks:null,attempts:null,evidence:null,prsCreated:5,prsMerged:2,ciRuns:4,ciSucceeded:1,ciFailed:1});
});

test('unions overlapping spans and counts observed metrics once across trace and records', () => {
  const cpu = obs('observer_cpu_user_ms','ms',6);
  const rss = obs('observer_rss_bytes','bytes',1024);
  const usage = obs('provider_input_tokens','tokens',20);
  const end = event('end-1','s1','span_end','implementation',10,[cpu,rss]);
  const token = event('usage','s1','measurement','implementation',7,[usage]);
  const result = buildEngineeringAnalytics({now,records:[
    {record_type:'telemetry',id:'record',task_id:'task',attempt_id:'attempt',revision:rev,phase:'implementation',measurements:[cpu,rss,usage]},
  ],events:[
    event('start-1','s1','span_start','implementation',0), end, end, token, token,
    event('start-2','s2','span_start','implementation',5), event('end-2','s2','span_end','implementation',15),
    event('start-3','s3','span_start','verification',7), event('end-3','s3','span_end','verification',13),
    event('open','s4','span_start','review',16),
  ]});
  assert.equal(result.trace.events, 8);
  assert.equal(result.trace.complete, 3);
  assert.equal(result.trace.incomplete, 1);
  assert.equal(result.trace.coveredMs, 15000);
  assert.deepEqual(result.trace.byPhase, [{phase:'implementation',spans:2,coveredMs:15000},{phase:'verification',spans:1,coveredMs:6000}]);
  assert.equal(result.usage.tokens[0].total, 20);
  assert.equal(result.usage.tokens[0].samples, 1);
  const byName = Object.fromEntries(result.usage.resources.map(row => [row.name,row]));
  assert.equal(byName.observer_cpu_user_ms.samples, 1);
  assert.equal(byName.observer_cpu_user_ms.median, 6);
  assert.equal(byName.observer_rss_bytes.max, 1024);
});

test('drops conflicting identities and ignores estimated or mismatched metric measurements', () => {
  const measurement = event('conflict','s1','measurement','implementation',1,[obs('provider_input_tokens','tokens',20)]);
  const result = buildEngineeringAnalytics({now, records:[
    task,{...task,state:'ready'},
    {record_type:'telemetry',id:'numeric',measurements:[
      obs('provider_input_tokens','ms',7),
      {...obs('provider_output_tokens','tokens',100),availability:'estimated'},
      obs('observer_rss_bytes','bytes',-1),
    ]},
  ], events:[measurement,{...measurement,measurements:[obs('provider_input_tokens','tokens',99)]}]});
  assert.equal(result.tasks.total, 0);
  assert.equal(result.sources.recordConflicts, 1);
  assert.equal(result.sources.traceConflicts, 1);
  assert.deepEqual(result.usage.tokens, []);
  assert.deepEqual(result.usage.resources, []);
});

test('legacy GitHub rows without lifecycle timestamps preserve rows and mark trends unknown', () => {
  const result = buildEngineeringAnalytics({now,github:{
    pulls:{status:'available',items:[{number:1,merged:true}]},
    ci:{status:'stale',items:[{id:1,state:'success'}]},
  }});
  assert.equal(result.pulls.total, 1);
  assert.equal(result.pulls.createdDated, 0);
  assert.equal(result.pulls.mergedDated, 0);
  assert.equal(result.pulls.mergedInWindow, null);
  assert.equal(result.ci.concluded, 1);
  assert.equal(result.ci.createdDated, 0);
  assert.equal(result.days.at(-1).ciRuns, null);
});
