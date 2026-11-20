import test from 'node:test';
import assert from 'node:assert/strict';
import { attemptEvents, dependencyGraph, organizeTasks, parseTaskHref, taskActivity, taskHref, workspaceActivity } from './src/task-workspace.mjs';

const accepted = { id: 'accepted', title: 'Ready input', state: 'accepted', classification: { primary: 'integration' } };
const blocked = { id: 'blocked', title: 'Build runtime', state: 'blocked', classification: { primary: 'integration' } };
const current = { id: 'task_a', title: 'Build editor', objective: 'Landing workspace', state: 'proposed',
  prerequisites: { task_ids: ['accepted', 'blocked', 'unknown', 'accepted'] }, classification: { primary: 'visual' } };
const downstream = { id: 'next', title: 'Verify workspace', state: 'ready', prerequisites: { task_ids: ['task_a'] } };

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
import { buildTaskTimeline } from './src/task-timeline.mjs';

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
