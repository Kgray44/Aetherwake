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

test('attributes durable Codex turns to their attempt, keeps failed usage and reports partial coverage', () => {
  const codex = (name, unit, value, source = 'codex_exec_json_turn_completed') => ({
    ...obs(name, unit, value), source, method: source === 'codex_exec_jsonl' ? 'observed_stdout_frames' : 'explicit_event_allowlist'
  });
  const turn = (id, span, attemptId, input, output, cache, seconds = 2) => ({
    ...event(id,span,'measurement','implementation',seconds,[
      codex('provider_input_tokens','tokens',input),
      codex('provider_output_tokens','tokens',output),
      codex('provider_cached_input_tokens','tokens',cache),
    ]), attempt_id:attemptId,
  });
  const summary = (id, span, attemptId, core, count) => ({
    ...event(id,span,'span_end','implementation',5,[
      codex('provider_core_usage_complete','boolean',core,'codex_exec_jsonl'),
      codex('provider_usage_recorded_turn_count','count',count,'codex_exec_jsonl')
    ]),attempt_id:attemptId,
  });
  const start = (id, span, attemptId) => ({...event(id,span,'span_start','implementation',0),attempt_id:attemptId});
  const retry = {...attempt, id:'retry', attempt_number:2, state:'succeeded', failure_category:'none'};
  const first = turn('turn-1','s1','attempt',20,4,6);
  const result = buildEngineeringAnalytics({now, records:[task,{...attempt,attempt_number:1},retry], events:[
    start('start-1','s1','attempt'),first,first,summary('end-1','s1','attempt',1,1),
    start('start-2','s2','retry'),turn('turn-2','s2','retry',10,1,0),
    turn('orphan','s3','unlinked',90,10,15),
    turn('future','s1','attempt',80,10,15,10000),
  ]});
  const accounting = result.tokenAccounting;
  assert.equal(accounting.schemaVersion, 1);
  assert.equal(accounting.unattributedTurns, 1);
  assert.equal(accounting.observed.totalTokens, 35);
  assert.equal(accounting.observed.cachedInputTokens, 6);
  assert.equal(accounting.observed.uncachedInputTokens, 24);
  assert.equal(accounting.byAttempt.find(row => row.attemptId === 'attempt').coverage, 'complete');
  assert.equal(accounting.byAttempt.find(row => row.attemptId === 'retry').coverage, 'partial');
  assert.equal(accounting.byTask[0].observed.totalTokens, 35);
  assert.equal(accounting.byTask[0].attempts, 2);
  assert.equal(accounting.byTask[0].verified, false);
  assert.equal(accounting.daily.at(-1).observed.totalTokens, 35);
});

test('class throughput includes failed attempts and withholds ratios for incomplete or disputed cohorts', () => {
  const accepted = {...task,state:'accepted',owner_acceptance:'not_required'};
  const owner = {repository:'example/repo'};
  const failedAttempt = {...attempt,...owner,attempt_number:1};
  const successfulAttempt = {...failedAttempt,id:'success',attempt_number:2,state:'succeeded'};
  const token = (name, value) => ({...obs(name,'tokens',value),source:'codex_exec_json_turn_completed'});
  const receipt = (name, unit, value) => ({...obs(name,unit,value),source:'codex_exec_jsonl'});
  const span = (id, input, output) => [
    event(id+'-start',id,'span_start','implementation',1),
    // The wrapper may log a terminal provider receipt after the process has exited.
    event(id+'-turn',id,'measurement','implementation',4,[
      token('provider_input_tokens',input),token('provider_output_tokens',output)
    ]),
    event(id+'-end',id,'span_end','implementation',3,[
      receipt('provider_core_usage_complete','boolean',1),
      receipt('provider_usage_recorded_turn_count','count',1)
    ]),
  ].map(row => ({ ...row, ...owner, attempt_id:id }));
  const records = [{...accepted,...owner},failedAttempt,successfulAttempt];
  const events = [...span('attempt',10,2),...span('success',16,2)];
  const query = (suppliedRecords, suppliedEvents) => buildEngineeringAnalytics({
    now,records:suppliedRecords,events:suppliedEvents
  }).tokenAccounting.byClass[0];
  assert.equal(query(records, events).tokensPerVerifiedTask, 30);
  assert.equal(query(records, events).verifiedTasksPerMillionTokens, 1e6 / 30);
  assert.equal(query(records, events.slice(0,-1)).tokensPerVerifiedTask, null);
  const conflict = {...successfulAttempt,state:'failed'};
  assert.equal(query([...records,conflict], events).tokensPerVerifiedTask, null);
  const interrupted = {
    ...event('interrupted','another-span','span_start','implementation',5,[
      receipt('provider_stream_requested','boolean',1)
    ]), ...owner
  };
  assert.equal(query(records, [...events,interrupted]).tokensPerVerifiedTask, null);
});

test('loaded attempt totals select each receipt once while daily trends retain CLI scope', () => {
  const repo='Kgray44/Aetherwake';
  const rows=[{...task,repository:repo},{...attempt,repository:repo},
    {...task,id:'second',repository:repo},{...attempt,id:'second-attempt',task_id:'second',repository:repo},
    {...attempt,id:'uncovered',task_id:'second',repository:repo}];
  const source=(name,unit,value,producer)=>({...obs(name,unit,value),source:producer});
  const cli=[
    event('start','cli','span_start','implementation',0),
    event('turn','cli','measurement','implementation',1,[
      source('provider_input_tokens','tokens',30,'codex_exec_json_turn_completed'),
      source('provider_output_tokens','tokens',10,'codex_exec_json_turn_completed'),
    ]),
    event('end','cli','span_end','implementation',2,[
      source('provider_core_usage_complete','boolean',1,'codex_exec_jsonl'),
      source('provider_usage_recorded_turn_count','count',1,'codex_exec_jsonl'),
    ]),
  ].map(item=>({...item,repository:repo}));
  const receipt=(id,task_id,attempt_id)=>({
    ...event(id,'app','measurement','implementation',3,[['total',90],['input',80],['cached_input',60],['output',10]]
      .map(([field,value])=>({...source('provider_'+field+'_tokens','tokens',value,'codex_app_server_token_usage_updated'),
        method:'fresh_thread_total'}))),task_id,attempt_id,repository:repo,
  });
  const app=receipt('app-second','second','second-attempt');
  const wrongRevision={...receipt('wrong','second','uncovered'),revision:'b'.repeat(40)};
  const progress={...app,event_id:'progress',measurements:app.measurements.map(metric=>({...metric,method:'fresh_thread_progress'}))};
  const {tokenAccounting,attemptReceiptAccounting:usage,usage:generic}=buildEngineeringAnalytics({
    records:rows,events:[...cli,receipt('overlap','task','attempt'),app,{...app},wrongRevision,progress],now,
  });
  assert.equal(usage.totals.tokens.totalTokens,130);
  assert.equal(usage.totals.appServerReceipts,1);
  assert.equal(usage.totals.attemptsWithTotals,2);
  assert.equal(usage.totals.attempts,3);
  assert.equal(usage.observed.tokens.totalTokens,130);
  assert.equal(usage.byTask.find(row=>row.taskId==='second').totals.tokens.uncachedInputTokens,20);
  assert.equal(usage.billing,'Unknown');
  assert.equal(tokenAccounting.daily.at(-1).observed.totalTokens,40);
  assert.equal(generic.tokens.find(row=>row.name==='provider_input_tokens').total,30);
});

test('Analytics binds App Server profiles and failed lower bounds to the exact canonical attempt', () => {
  const repo='Kgray44/Aetherwake', session='11111111-1111-4111-8111-111111111111';
  const usage=(eventId,total)=>({...event(eventId,'app','measurement','implementation',3,[
    {...obs('provider_total_tokens','tokens',total),source:'codex_app_server_token_usage_updated',method:'fresh_thread_progress'},
  ]),repository:repo,session_id:session});
  const profile={...event('profile','app','measurement','implementation',4,[
    {...obs('app_server_latest_response_input_tokens','tokens',60),
      source:'codex_app_server_turn_profile',method:'observed_turn_notifications'}
  ]),repository:repo,session_id:session};
  const followup={...profile,event_id:'followup-profile',measurements:[...profile.measurements,{
    ...obs('app_server_workspace_turn_ordinal','count',2),
    source:'codex_app_server_turn_profile',method:'observed_turn_notifications',
  }]};
  const data=buildEngineeringAnalytics({
    records:[{...task,repository:repo},{...attempt,repository:repo,attempt_number:1}],
    sessionBindings:[{task_id:task.id,attempt_bindings:[{id:attempt.id,revision:rev,session_id:session}]}],
    events:[{...usage('first',40),occurred_at:at(2)},usage('latest',100),profile,followup,
      {...profile,event_id:'wrong-session',session_id:'other'}],now,
  });
  assert.deepEqual(data.appServerProfiles.map(row=>row.ordinal),[1,2]);
  assert.equal(data.appServerProfiles[0].latest.tokens,60);
  assert.equal(data.attemptReceiptAccounting.totals.tokens.totalTokens,null);
  assert.equal(data.attemptReceiptAccounting.observed.tokens.totalTokens,100);
  assert.equal(data.attemptReceiptAccounting.byTask[0].observed.tokens.totalTokens,100);
  assert.deepEqual(data.usage.tokens,[]);
});

test('paired experiments retain failed attempts and require complete, verified matched outcomes', () => {
  const repository = 'example/repo';
  const makeTask = (id, state = 'accepted') => ({
    ...task, id, repository, state, owner_acceptance:state === 'accepted' ? 'accepted' : 'not_reviewed',
    acceptance:{profile_id:'backend-v1',criteria:[{id:'test'}]},
  });
  const makeAttempt = (id, taskId, state, number) => ({
    ...attempt,id,repository,task_id:taskId,state,attempt_number:number
  });
  const makeEvents = (attemptRow, input, output) => {
    const receipt = (name,unit,value) => ({...obs(name,unit,value),source:'codex_exec_jsonl'});
    const token = (name,value) => ({...obs(name,'tokens',value),source:'codex_exec_json_turn_completed'});
    const id = attemptRow.id;
    return [
      event(id+'-start',id,'span_start','implementation',1),
      event(id+'-usage',id,'measurement','implementation',2,[token('provider_input_tokens',input),token('provider_output_tokens',output)]),
      event(id+'-end',id,'span_end','implementation',3,[
        receipt('provider_core_usage_complete','boolean',1),receipt('provider_usage_recorded_turn_count','count',1)
      ])
    ].map(row => ({...row,repository,task_id:attemptRow.task_id,attempt_id:id}));
  };
  const b = makeTask('baseline'), c = makeTask('candidate');
  const failed = makeAttempt('baseline-failed',b.id,'failed',1);
  const baseline = makeAttempt('baseline-success',b.id,'succeeded',2);
  const candidate = makeAttempt('candidate-success',c.id,'succeeded',1);
  const attempts = [failed, baseline, candidate];
  const events = [...makeEvents(failed,10,5),...makeEvents(baseline,60,25),...makeEvents(candidate,45,15)];
  const pair = {id:'fix-fixture',baselineTaskId:b.id,candidateTaskId:c.id,workloadDigest:'a'.repeat(64),difficulty:'moderate'};
  const query = (tasks, trace = events, pairs = [pair]) => buildEngineeringAnalytics({
    records:[...tasks,...attempts],events:trace,now,experimentPairs:pairs
  }).experiments;
  const complete = query([b,c]);
  assert.equal(complete.schemaVersion,1);
  assert.equal(complete.pairs[0].status,'measured');
  assert.equal(complete.pairs[0].baseline.failedAttempts,1);
  assert.equal(complete.pairs[0].baseline.totalTokens,100);
  assert.equal(complete.pairs[0].candidate.totalTokens,60);
  assert.equal(complete.pairs[0].tokenReductionPercent,40);
  assert.equal(complete.pairs[0].baseline.costUsd,null);
  assert.equal(complete.pairs[0].attemptWindowDeltaMs,0);
  const failedVerification = query([b,makeTask(c.id,'failed')]).pairs[0];
  assert.equal(failedVerification.status,'quality_regression');
  assert.equal(failedVerification.tokenReductionPercent,null);
  assert.equal(query([b,c],events.slice(0,-1)).pairs[0].status,'incomplete');
  assert.equal(query([b,{...c,revision:'b'.repeat(40)}]).pairs[0].status,'unmatched');
  const changedScope = {...c,acceptance:{...c.acceptance,profile_id:'other'}};
  assert.equal(query([b,changedScope]).pairs[0].status,'unmatched');
  const protocol={provider:'openai',model:'fixture',effort:'high',environmentDigest:'b'.repeat(64),
    requirementsDigest:'c'.repeat(64),verificationDigest:'d'.repeat(64)};
  const declared={...pair,protocol:{baseline:protocol,candidate:{...protocol}}};
  assert.equal(query([b,c],events,[declared]).pairs[0].protocolCoverage,'matched_declaration');
  declared.protocol.candidate.effort='low';
  assert.equal(query([b,c],events,[declared]).pairs[0].status,'unmatched');
  assert.throws(() => query([b,c],events,[pair,{...pair,id:'duplicate'}]), /reused/);
});
