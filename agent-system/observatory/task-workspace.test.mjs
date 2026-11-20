import test from 'node:test';
import assert from 'node:assert/strict';
import { taskEngineeringActivity } from './src/task-activity.mjs';
import { buildTaskTimeline, executorHeartbeat } from './src/task-timeline.mjs';
import { taskReportDefinition } from './src/task-report.mjs';

test('linked work before and after execution is shared by the chronology and report', () => {
  const task={id:'task_activity',created_at:'2026-01-02T00:00:00Z',title:'Review changes',objective:'Review linked activity'};
  const session='10000000-0000-4000-8000-000000000001';
  const revision='a'.repeat(40);
  const attempt={id:'a1',task_id:task.id,attempt_number:1,executor:'codex',session_id:session,
    revision,started_at:'2026-01-03T00:00:00Z',finished_at:'2026-01-04T00:00:00Z',state:'failed'};
  const uri='https://github.com/Kgray44/Aetherwake/pull/42';
  const run='https://github.com/Kgray44/Aetherwake/actions/runs/23';
  const canonical={task,lifecycle:{state:'verifying',links:[
    {kind:'pull_request',uri,revision}, {kind:'pull_request',uri:uri+'/files',revision},
    {kind:'executor_session',uri:'https://chatgpt.com/c/'+session,revision},
    {kind:'deployment',uri:'https://example.test/releases/4',revision},
    {kind:'ci_run',uri:run,revision},
  ]},attempts:[attempt]};
  const github={pulls:{observed_at:'2026-01-07T00:00:00Z',items:[
    {number:42,url:uri,created_at:'2026-01-01T00:00:00Z',merged_at:'2026-01-06T00:00:00Z'},
    {number:43,revision,created_at:'2026-01-01T00:00:00Z'},
  ]},ci:{items:[{id:23,url:run,revision:'b'.repeat(40),created_at:'2026-01-03T00:00:00Z'}]}};
  const activity=taskEngineeringActivity({task,canonical,attempts:[attempt],github});
  assert.equal(Object.fromEntries(activity.counts)['Formal Task Engine attempts'],1);
  assert.equal(Object.fromEntries(activity.counts)['Known executor sessions'],1);
  assert.equal(Object.fromEntries(activity.counts)['Linked pull requests'],1);
  assert.equal(Object.fromEntries(activity.counts)['Linked engineering operations'],3);
  assert.deepEqual(activity.events.map(event=>event.id),['github:pull:42:opened','github:pull:42:merged']);
  const timeline=buildTaskTimeline({task,attempts:[attempt],engineeringEvents:activity.events});
  assert.equal(timeline[0].id,'github:pull:42:merged');
  assert.equal(timeline.at(-1).id,'github:pull:42:opened');
  assert.equal(timeline.find(item=>item.id==='end:a1').outcome,'failed');
  assert.equal(timeline[0].details.find(([label])=>label==='Snapshot observed')[1],github.pulls.observed_at);
  const report=JSON.stringify(taskReportDefinition({task,canonical,attempts:[attempt],github}).content);
  for(const expected of ['Known executor sessions','Pull request #42 merged','https://example.test/releases/4'])
    assert.ok(report.includes(expected));
  const empty=taskEngineeringActivity({task,attempts:[attempt],github});
  assert.equal(Object.fromEntries(empty.counts)['Formal Task Engine attempts'],null);
  assert.equal(empty.events.length,0);
});
import { attemptTraceCoverage } from './src/trace-timeline.mjs';
import { attemptEvents, dependencyGraph, organizeTasks, overviewTaskResults, parseTaskHref, taskActivity, taskHref, workspaceActivity } from './src/task-workspace.mjs';

const accepted = { id: 'accepted', title: 'Ready input', state: 'accepted', classification: { primary: 'integration' } };
const blocked = { id: 'blocked', title: 'Build runtime', state: 'blocked', classification: { primary: 'integration' } };
const current = { id: 'task_a', title: 'Build editor', objective: 'Landing workspace', state: 'proposed',
  prerequisites: { task_ids: ['accepted', 'blocked', 'unknown', 'accepted'] }, classification: { primary: 'visual' } };
const downstream = { id: 'next', title: 'Verify workspace', state: 'ready', prerequisites: { task_ids: ['task_a'] } };

test('Task chronology keeps late arrivals ordered by occurrence and reports missing or discrepant receipt clocks', () => {
  const task={id:'task_clock',title:'Inspect clock',objective:'Inspect independent clocks'};
  const makeEvent=(event_id,occurred_at)=>({task_id:task.id,event_id,occurred_at,kind:'measurement',phase:'testing'});
  const late=makeEvent('late','2026-01-01T00:00:00.000Z');
  const earlierBatch=makeEvent('earlier-batch','2026-01-02T00:00:00.000Z');
  const legacy=makeEvent('legacy','2026-01-03T00:00:00.000Z');
  const future=makeEvent('future','2026-01-06T00:00:00.000Z');
  const telemetrySource={task_id:task.id,received_at:'2026-01-05T00:00:00.000Z',event_receipts:{
    'earlier-batch':'2026-01-04T00:00:00.000Z',
    late:'2026-01-05T00:00:00.000Z',
    future:'2026-01-05T00:00:00.000Z',
  }};
  const input={task,events:[earlierBatch,late,legacy,future],telemetrySource};
  const timeline=buildTaskTimeline(input);
  assert.deepEqual(timeline.map(event=>event.id),['trace:future','trace:legacy','trace:earlier-batch','trace:late']);
  assert.equal(Object.fromEntries(timeline[0].details)['Clock discrepancy'],
    'The journal occurrence is later than the Observatory receipt. Cross-source order is uncertain.');
  assert.equal(Object.fromEntries(timeline[1].details)['Observatory first received'],'Unavailable');
  assert.equal(Object.fromEntries(timeline[3].details)['Observatory first received'],telemetrySource.event_receipts.late);
  const wrongSource=buildTaskTimeline({...input,telemetrySource:{...telemetrySource,task_id:'unrelated'}});
  assert.equal(Object.fromEntries(wrongSource[3].details)['Observatory first received'],'Unavailable');
  const report=JSON.stringify(taskReportDefinition(input).content);
  assert.match(report,/Observatory first received/);
  assert.match(report,/Cross-source order is uncertain/);
  assert.match(report,/2026-01-04T00:00:00.000Z/);
});

test('attempt coverage clips correlated overlapping spans and excludes other revisions', () => {
  const [row] = attemptTraceCoverage([{
    id:'a',task_id:'t',revision:'r',attempt_number:1,started_at:new Date(0).toISOString(),finished_at:new Date(1000).toISOString(),
  }],[
    {complete:true,attempt:'a',task:'t',revision:'r',start:450,end:1100},
    {complete:true,attempt:'a',task:'t',revision:'r',start:300,end:500},
    {complete:true,attempt:'a',task:'t',revision:'other',start:0,end:1000},
    {complete:false,attempt:'a',task:'t',revision:'r',start:0,end:1000},
  ]);
  assert.deepEqual(row,{attemptId:'a',attemptNumber:1,elapsedMs:1000,coveredMs:700,
    untracedMs:300,beforeTraceMs:300,afterTraceMs:0});
});

test('task links preserve the registry and direct detail routes', () => {
  assert.deepEqual(parseTaskHref('#tasks'), { id: null });
  assert.deepEqual(parseTaskHref(taskHref(undefined,'active')),{id:null,work:'active'});
  assert.equal(parseTaskHref('#tasks?work=unknown'),null);
  assert.deepEqual(parseTaskHref(taskHref('roadmap:task.1')), { id: 'roadmap:task.1' });
  assert.equal(parseTaskHref('#tasks/../../private'), null);
  assert.equal(parseTaskHref('#tasks/a%2Fb'), null);
  assert.equal(parseTaskHref('#pull-requests/12'), null);
});

test('search and filters compose before grouping and priority order preserves unknowns', () => {
  const tasks = [accepted, blocked, current, downstream];
  assert.deepEqual(organizeTasks(tasks, { query: 'BUILD', source: 'private', sort: 'priority', group: 'state' },
    { task_a: { priority: 'urgent' } }).map(([name, items]) => [name, items.map(t => t.id)]), [['proposed', ['task_a']]]);
  const [group] = organizeTasks(tasks, { sort: 'priority' }, { blocked: { priority: 'low' }, task_a: { priority: 'urgent' } });
  assert.deepEqual(group[1].slice(0, 2).map(t => t.id), ['task_a', 'blocked']);
  assert.deepEqual(organizeTasks(tasks, { state: 'failed' }), []);
  assert.deepEqual(organizeTasks(tasks, { query: 'landing', group: 'category' }), [['visual', [current]]]);
});

test('direct dependency edges preserve direction and unknown evidence', () => {
  const graph = dependencyGraph(current, [current, accepted, blocked, downstream]);
  assert.deepEqual(graph.upstream.map(({ id, status }) => [id, status]), [
    ['accepted', 'satisfied'], ['blocked', 'unsatisfied'], ['unknown', 'unverified'],
  ]);
  assert.deepEqual(graph.downstream.map(({ id }) => id), ['next']);
});

import { commandForTask, desktopSessionTokens, executionActions, hasLiveTaskWork, reviewRevision, taskEngineRequest, taskTokenRows } from './src/task-engine-client.mjs';

test('fast registry polling follows changing work, including dependency-blocked admissions',()=>{
  const task=(state,stored_state)=>({lifecycle:{state,stored_state}});
  assert.equal(hasLiveTaskWork([task('proposed'),task('completed'),task('paused')]),false);
  assert.equal(hasLiveTaskWork([task('blocked','admitted')]),true);
  assert.equal(hasLiveTaskWork([task('verifying')]),true);
});

test('canonical checks and draft dependencies use authority without treating a missing Task as verified',()=>{
  const known={id:'current',state:'cancelled',owner_acceptance:'accepted'};
  const summaries=new Map([['current',{task:known,lifecycle:{stored_state:'archived'}}]]);
  const draft={prerequisites:{task_ids:['current','missing'],capabilities:['artifact access']}};
  assert.deepEqual(dependencyGraph(draft,[known],{summaries}).upstream.map(item=>item.status),['satisfied','unverified']);
  const lifecycle={prerequisite_status:[{type:'capability',id:'artifact access',status:'satisfied',state:'attested'}]};
  assert.equal(dependencyGraph(draft,[known],{lifecycle,summaries}).capabilities[0].status,'satisfied');
});

test('canonical operation choices use stored state and the current attempt count', () => {
  assert.deepEqual(executionActions({ lifecycle: { state: 'blocked', stored_state: 'admitted', executor: 'codex' } }), ['pause', 'cancel']);
  assert.deepEqual(executionActions({ lifecycle: { state: 'paused', stored_state: 'paused' }, attempts: [{}] }), ['resume', 'cancel']);
  assert.deepEqual(executionActions({ lifecycle: { state: 'failed', stored_state: 'failed' }, attempts: [{}, {}, {}] }), ['archive']);
  assert.deepEqual(executionActions({ lifecycle: { state: 'verifying', stored_state: 'verifying' } }), ['accept', 'reject', 'cancel']);
  assert.deepEqual(executionActions({ lifecycle: { stored_state: 'proposed' } }, { publishedIntake: true }), ['admit']);
  assert.deepEqual(commandForTask({ task: { id: 'task_a' }, version: 4 }, { type: 'pause' }, 'operation'),
    { op: 'command', task_id: 'task_a', expected_version: 4, operation_id: 'operation', action: { type: 'pause' } });
});

test('engine discovery distinguishes absent endpoints from errors and preserves server feedback', async () => {
  assert.equal(await taskEngineRequest({ op: 'list' }, {}, { fetcher: async () => new Response('', { status: 404 }) }), null);
  await assert.rejects(taskEngineRequest({ op: 'command' }, {}, {
    fetcher: async () => Response.json({ error: 'Owner action required' }, { status: 403 }),
  }), error => error.status === 403 && error.message === 'Owner action required');
  await assert.rejects(taskEngineRequest({ op: 'register' }, {}, { fetcher: async () => new Response('', { status: 404 }) }),
    error => error.status === 404);
});

test('Task token rows retain exact Task identity and observed null values', () => {
  const row = { taskId: 'task_a', attemptId: 'try_1', revision: 'a'.repeat(40), coverage: 'partial',
    observed: { inputTokens: 350, totalTokens: null } };
  assert.deepEqual(taskTokenRows({ schemaVersion: 1, byAttempt: [row, { ...row, taskId: 'other' }] }, 'task_a'), [row]);
  assert.deepEqual(taskTokenRows(undefined, 'task_a'), []);
});

test('registry activity distinguishes intake, reported attempts and authoritative engine state', () => {
  const task = { id: 'task_a', state: 'proposed' };
  assert.deepEqual(taskActivity(task, [], [], null), { label: 'No execution reported', at: null });
  const attempt = { id: 'attempt_a', task_id: task.id, state: 'running', started_at: '2026-11-19T20:00:00Z' };
  assert.deepEqual(taskActivity(task, [attempt], [{ task_id: 'another', occurred_at: '2026-11-20T00:00:00Z' }], null),
    { label: 'Attempt last reported running', at: attempt.started_at });
  assert.deepEqual(taskActivity(task, [{ ...attempt, state: 'succeeded', finished_at: '2026-11-19T20:05:00Z' }], [], null),
    { label: 'Latest attempt succeeded', at: '2026-11-19T20:05:00Z' });
  assert.deepEqual(taskActivity(task, [attempt], [], { state: 'scheduled', start_at: 1795200000000 }),
    { label: 'Engine scheduled', at: '2026-11-20T18:40:00.000Z' });
  assert.deepEqual(taskActivity(task,[attempt],[],{state:'ready'},'not_configured'),
    {label:'Waiting for Codex worker access',at:null});
  assert.deepEqual(taskActivity(task,[attempt],[],{state:'running'},'not_configured'),
    {label:'Engine running',at:null});
  assert.equal(task.state, 'proposed');
});

test('owner evidence pins the candidate revision rather than the attempt base', () => {
  const base = 'a'.repeat(40);
  const candidate = 'b'.repeat(40);
  assert.equal(reviewRevision({ revision: base, candidate_revision: candidate }), candidate);
  assert.equal(reviewRevision({ revision: base }), base);
  assert.equal(reviewRevision(undefined), null);
});

test('work counters separate live execution, historical attempts and explicit acceptance', () => {
  const tasks = ['active','old','done','bad','none','reported','review'].map(id=>({id,state:id==='done'?'accepted':'proposed',owner_acceptance:id==='done'?'accepted':'not_reviewed'}));
  const attempts = [{task_id:'old',state:'succeeded'},{task_id:'bad',state:'failed'},{task_id:'reported',state:'running'}];
  const summaries = new Map([['active',{lifecycle:{state:'running'}}], ['review',{lifecycle:{state:'verifying'}}]]);
  assert.deepEqual(workspaceActivity(tasks,attempts,summaries).counts,{active:1,accepted:1,succeeded:1,review:1,waiting:0,issues:1,unlinked:1,reportedRunning:1,archived:0});
  summaries.set('old',{lifecycle:{state:'queued'}});
  summaries.set('bad',{lifecycle:{state:'archived'}});
  attempts.push({task_id:'review',state:'failed'});
  const activity=workspaceActivity(tasks,attempts,summaries);
  assert.deepEqual(activity.counts,{active:1,accepted:1,succeeded:0,review:1,waiting:1,issues:0,unlinked:1,reportedRunning:1,archived:1});
  assert.deepEqual(organizeTasks(tasks,{work:'waiting'},{},activity.byTask).flatMap(([,items])=>items.map(item=>item.id)),['old']);
});

import { attemptJournal, mergeTaskAttempts } from './src/task-attempts.mjs';

test('attempt journal merges matching receipts and candidate records without pulling in other attempts',()=>{
  const task_id='task-a', id='attempt-a', revision='a'.repeat(40), candidate_revision='b'.repeat(40);
  const [attempt]=mergeTaskAttempts(task_id,[{id,task_id,revision,model:'Observed model',attempt_number:1}],
    [{id,revision,candidate_revision,state:'failed',failure:'Missing artifact',attempt_number:1}]);
  assert.equal(attempt.model,'Observed model');
  assert.equal(attempt.failure_diagnosis,'Missing artifact');
  const trace={event_id:'trace-a',task_id,attempt_id:id,revision,kind:'span_end',occurred_at:'2026-11-20T02:00:00Z'};
  const source={operation_id:'receipt-a',attempt_id:id,kind:'reject',reason:'Missing output',at:'2026-11-20T02:01:00Z'};
  const related={id:'evidence-a',task_id,attempt_id:id,revision:candidate_revision};
  const journal=attemptJournal(attempt,[trace,{...trace,event_id:'other',revision:candidate_revision}],
    [source,{...source,operation_id:'other',target_id:'task-b'}],
    [related,{...related,id:'unrelated',attempt_id:'other-attempt'}]);
  assert.deepEqual(journal.events.map(row=>row.title),['Owner rejected candidate','span_end']);
  assert.deepEqual(journal.evidence,[related]);
});

test('attempt details only include events bound to the Task, attempt and revision', () => {
  const attempt={id:'a',task_id:'t',revision:'v'};
  const event={attempt_id:'a',task_id:'t',revision:'v',occurred_at:'2'};
  assert.deepEqual(attemptEvents(attempt,[event,{...event,revision:'stale'}, {...event,task_id:'other'}, {...event,occurred_at:'1'}]),[{...event,occurred_at:'1'},event]);
});

test('desktop session counters select the latest observed Task reading without summing or attributing it to an attempt', () => {
  const metric={name:'desktop_total_tokens',unit:'tokens',source:'codex_desktop_session_usage',availability:'observed',value:10};
  const event={task_id:'a',occurred_at:'2',measurements:[metric]};
  assert.deepEqual(desktopSessionTokens('a',[event,{...event,occurred_at:'1',measurements:[{...metric,value:3}]},{...event,task_id:'b',occurred_at:'3',measurements:[{...metric,value:99}]}]),[{name:metric.name,value:10,at:'2'}]);
});

import { taskActivityHref } from './src/github-activity.mjs';

test('Task PR and CI references resolve to Observatory routes', () => {
  assert.equal(taskActivityHref('https://github.com/Kgray44/Aetherwake/pull/319/files'), '#pull-requests/319');
  assert.equal(taskActivityHref('https://github.com/Kgray44/Aetherwake/actions/runs/44121052124/job/123?x=1'), '#ci-runs/44121052124');
  assert.equal(taskActivityHref('https://github.com/someone/else/pull/319'), null);
  assert.equal(taskActivityHref('https://github.com.example.test/Kgray44/Aetherwake/pull/319'), null);
  assert.equal(taskActivityHref('https://github.com/Kgray44/Aetherwake/pull/9999999999999999999'), null);
});

test('Task Timeline orders dated source events and excludes records belonging to other Tasks', () => {
  const base = { id:'a',task_id:'task_a',revision:'r',attempt_number:1,started_at:'2026-11-19T20:01:00Z',finished_at:'2026-11-19T20:02:00Z',state:'failed' };
  const timeline = buildTaskTimeline({
    task: {id:'task_a',title:'Task A',created_at:'2026-11-19T20:00:00Z'},
    attempts: [base,{...base,id:'other',task_id:'other'}],
    audits: [{operation_id:'operation',type:'admit',state:'ready',at:'2026-11-19T20:00:30Z'}],
    events: [{event_id:'phase',task_id:'task_a',attempt_id:'a',revision:'r',phase:'verification',kind:'span_start',occurred_at:'2026-11-19T20:01:30Z'},
      {event_id:'outside',task_id:'other',occurred_at:'2026-11-19T20:03:00Z'}],
  });
  assert.deepEqual(timeline.map(item=>item.id),['end:a','trace:phase','start:a','audit:operation','task:task_a']);
  assert.equal(timeline[1].description,'Attempt 1');
  assert.ok(timeline[0].details.some(([name,value])=>name==='Outcome'&&value==='failed'));
});

test('App Server totals populate the same attempt token rows without adding to CLI counts', () => {
  const taskId = 'task_a', repository = 'Kgray44/Aetherwake';
  const attempt = { task_id:taskId, id:'a1', revision:'rev', attempt_number:1, executor:'codex' };
  const fields = {total:282838,input:280895,output:1943,cached_input:243456,reasoning_output:149,cache_write_input:0};
  const receipt = { kind:'measurement', task_id:taskId, attempt_id:attempt.id, revision:'rev', repository,
    measurements:Object.entries(fields).map(([name,value]) => ({
      name:'provider_' + name + '_tokens',unit:'tokens',value,availability:'observed',
      source:'codex_app_server_token_usage_updated',method:'single_ephemeral_thread_total',
    })),
  };
  const empty = {taskId,attemptId:'a1',revision:'rev',coverage:'unavailable',observed:{totalTokens:null}};
  const build = (row, events) => taskTokenRows({schemaVersion:1,byAttempt:[row]},taskId,[attempt],events,repository);
  const [usage] = build(empty,[receipt]);
  assert.deepEqual(usage.observed,{
    totalTokens:282838,inputTokens:280895,outputTokens:1943,cachedInputTokens:243456,
    reasoningOutputTokens:149,cacheWriteInputTokens:0,uncachedInputTokens:37439,turns:1,
  });
  const cli = {...empty,coverage:'complete',observed:{totalTokens:123}};
  assert.deepEqual(build(cli,[receipt]),[cli]);
  assert.deepEqual(build(empty,[receipt,receipt]),[empty]);
  assert.deepEqual(build(empty,[{...receipt,revision:'different'}]),[empty]);
});

test('heartbeat receipts update one executor indicator and stay out of the Timeline', () => {
  const task = {id:'test',created_at:'2026-11-20T04:00:00Z'};
  const attempt = {id:'attempt',task_id:task.id,started_at:task.created_at,lease_until:Date.parse('2026-11-20T04:01:00Z')};
  const audits = [
    {kind:'heartbeat',attempt_id:'attempt',operation_id:'one',at:'2026-11-20T04:00:10Z'},
    {kind:'heartbeat',attempt_id:'attempt',operation_id:'two',at:'2026-11-20T04:00:20Z'},
    {kind:'heartbeat',attempt_id:'other',operation_id:'three',at:'2026-11-20T04:00:40Z'},
    {kind:'lease_expired',attempt_id:'attempt',operation_id:'four',at:'2026-11-20T04:01:00Z'},
  ];
  const input = {taskId:task.id,attempt,audits,state:'running'};
  const heartbeat = executorHeartbeat({...input,now:Date.parse('2026-11-20T04:00:25Z')});
  assert.equal(heartbeat.lastAt,'2026-11-20T04:00:20Z');
  assert.equal(heartbeat.status,'receiving');
  assert.equal(executorHeartbeat({...input,now:attempt.lease_until}).status,'overdue');
  assert.equal(executorHeartbeat({...input,state:'failed'}).status,'ended');
  const timeline = buildTaskTimeline({task,attempts:[attempt],audits});
  assert.equal(timeline.some(item=>item.title==='Executor lease expired'),true);
  assert.equal(timeline.some(item=>item.title.includes('heartbeat')),false);
});

test('Overview shows the latest attempt metrics and a revision-pinned artifact', () => {
  const task = { id:'task-1', repository:'Kgray44/Aetherwake' };
  const latest = { id:'attempt-2', task_id:task.id, revision:'new', started_at:'2026-11-20T04:00:00Z' };
  const earlier = { id:'attempt-1', task_id:task.id, revision:'old', started_at:'2026-11-19T04:00:00Z' };
  const trace = { task_id:task.id, attempt_id:latest.id, revision:latest.revision, repository:task.repository,
    trace_id:'trace', span_id:'span', phase:'implementation' };
  const observed = { name:'provider_total_tokens',unit:'tokens',source:'codex_app_server_token_usage_updated',
    availability:'observed',method:'single_ephemeral_thread_total',value:75 };
  const artifact = {kind:'artifact',uri:'https://example.test/artifact',revision:'candidate'};
  const events = [
    {...trace,kind:'span_start',occurred_at:'2026-11-20T04:00:00.000Z'},
    {...trace,kind:'span_end',occurred_at:'2026-11-20T04:00:02.000Z'},
    {...trace,kind:'measurement',occurred_at:'2026-11-20T04:00:01.000Z',measurements:[observed]},
    {...trace,attempt_id:earlier.id,revision:earlier.revision,kind:'measurement',measurements:[{...observed,value:999}]},
  ];
  const summaries = new Map([[task.id,{lifecycle:{state:'ready',stored_state:'queued',links:[artifact]}}]]);
  assert.deepEqual(overviewTaskResults([task],[latest,earlier],events,summaries).get(task.id), {
    artifact,queued:true,observedMs:2000,observedTokens:75,
  });
  const duplicate = overviewTaskResults([task],[latest], [...events,events[2]],summaries).get(task.id);
  assert.equal(duplicate.observedTokens,null);
});
