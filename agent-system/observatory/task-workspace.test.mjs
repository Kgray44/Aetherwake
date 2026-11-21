import test from 'node:test';
import assert from 'node:assert/strict';
import { taskEngineeringActivity } from './src/task-activity.mjs';
import { taskNextAction } from './src/task-engine-client.mjs';
import { buildTaskTimeline, executorHeartbeat, taskExecutionStatus } from './src/task-timeline.mjs';
import { developmentNoteBytes, taskDevelopmentNotes } from './development-notes.mjs';
import { taskReportDefinition } from './src/task-report.mjs';
import { executionTiming } from './src/execution-timing.mjs';
import { loadedSessionUsage, taskUsageAccounting } from './src/task-usage-accounting.mjs';
import { taskDataCoverage } from './src/task-data-coverage.mjs';
import { traceTimeline } from './src/trace-timeline.mjs';

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
import { taskExecutionDiagnostics } from './src/task-execution-diagnostics.mjs';
import { sanitizeExport } from '../../scripts/agent/telemetry-export.mjs';
import { attemptTraceCoverage } from './src/trace-timeline.mjs';
import { attemptEvents, dependencyGraph, organizeTasks, overviewTaskResults, parseTaskHref, taskActivity, taskHref, workspaceActivity } from './src/task-workspace.mjs';

const accepted = { id: 'accepted', title: 'Ready input', state: 'accepted', classification: { primary: 'integration' } };
const blocked = { id: 'blocked', title: 'Build runtime', state: 'blocked', classification: { primary: 'integration' } };
const current = { id: 'task_a', title: 'Build editor', objective: 'Landing workspace', state: 'proposed',
  prerequisites: { task_ids: ['accepted', 'blocked', 'unknown', 'accepted'] }, classification: { primary: 'visual' } };
const downstream = { id: 'next', title: 'Verify workspace', state: 'ready', prerequisites: { task_ids: ['task_a'] } };

test('Workspace diagnostics and PDF share the exact App Server turn profile receipt', () => {
  const task={...current,repository:'Kgray44/Aetherwake'};
  const attempt={id:'attempt',task_id:task.id,attempt_number:1,revision:'a'.repeat(40),
    session_id:'11111111-1111-4111-8111-111111111111',state:'failed'};
  const measurements=[['latest_response_input_tokens','tokens',300],['latest_response_cached_input_tokens','tokens',275],
    ['command_count','count',4]].map(([name,unit,value])=>({name:'app_server_'+name,unit,value,
    method:'observed_turn_notifications',source:'codex_app_server_turn_profile',availability:'observed'}));
  const receipt={event_id:'profile',task_id:task.id,attempt_id:attempt.id,repository:task.repository,
    session_id:attempt.session_id,revision:attempt.revision,kind:'measurement',occurred_at:'2026-01-04T00:00:00.000Z',measurements};
  const events=[receipt,{...receipt,event_id:'other',revision:'b'.repeat(40)}];
  const diagnostics=taskExecutionDiagnostics({task,attempts:[attempt],trace:traceTimeline(events),tokens:[],records:[],events});
  assert.equal(diagnostics.findings.filter(row=>row.key==='profile').length,1);
  assert.match(diagnostics.findings.find(row=>row.key==='profile').detail,/300 tokens.*275 cached/);
  const report=JSON.stringify(taskReportDefinition({task,attempts:[attempt],events}).content);
  assert.match(report,/Attempt 1 App Server turn profile/);
  assert.match(report,/Receipt profile at/);
});

test('Task status and Development Notes use exact attempt and session evidence in Workspace and PDF',()=>{
  const task={id:'task-notes',title:'Notes fixture',objective:'Verify development observations'};
  const attempt={id:'attempt',task_id:task.id,attempt_number:1,revision:'a'.repeat(40),
    session_id:'11111111-1111-4111-8111-111111111111',state:'running'};
  const at='2026-01-04T00:00:00.000Z';
  const scope={task_id:task.id,attempt_id:attempt.id,revision:attempt.revision,session_id:attempt.session_id};
  const note={...scope,kind:'development_note',event_id:'note_a',occurred_at:at,
    development_note:{category:'finding',text:'Fixture caught a stale cache.'}};
  const other={...note,event_id:'note_b',session_id:'11111111-1111-4111-8111-111111111112',
    development_note:{category:'warning',text:'Unrelated conversation note.'}};
  assert.deepEqual(taskDevelopmentNotes(task.id,[other,note],[attempt]),[note]);
  assert.equal(developmentNoteBytes([note]),29);
  const report=JSON.stringify(taskReportDefinition({task,attempts:[attempt],events:[note,other]}).content);
  assert.match(report,/Fixture caught a stale cache/);
  assert.doesNotMatch(report,/Unrelated conversation note/);
  assert.match(report,/provider reports turn-level usage only/);
  const started={...scope,kind:'span_start',span_id:'codex-attempt-codex_turn',occurred_at:at};
  const status={taskId:task.id,attempt,state:'running'};
  assert.equal(taskExecutionStatus(status).title,'Codex conversation connected');
  assert.equal(taskExecutionStatus({...status,events:[started]}).title,'Codex started working');
  assert.equal(taskExecutionStatus({...status,events:[{...started,kind:'span_end'}]}).title,'Codex stopped working');
  assert.equal(taskExecutionStatus({...status,state:'failed',attempt:{...attempt,state:'failed',failure:'Pinned checkout failed.'}}).description,
    'Pinned checkout failed.');
});

test('linked PRs expose only confirmed GitHub merge commits and keep existing explicit links unique',()=>{
  const task={id:'task-merge',title:'Merge activity',objective:'Inspect the linked merge'};
  const prefix='https://github.com/Kgray44/Aetherwake';
  const merged_at='2026-01-04T00:00:00Z';
  const sha='a'.repeat(40),preview='b'.repeat(40);
  const refs=[{kind:'pull_request',uri:prefix+'/pull/12'},{kind:'pull_request',uri:prefix+'/pull/13'}];
  const explicit={kind:'commit',uri:prefix+'/commit/'+sha,revision:sha};
  const canonical={task,lifecycle:{state:'verifying',links:refs},engineering_snapshots:[
    {cache_key:'pulls:12',number:12,merged_at,merge_commit_sha:sha},
    {cache_key:'pulls:13',number:13,state:'open',merge_commit_sha:preview},
    {cache_key:'pulls:14',number:14,merged_at,merge_commit_sha:'c'.repeat(40)},
  ]};
  const activity=taskEngineeringActivity({task,canonical});
  const merges=activity.references.filter(ref=>ref.kind==='commit');
  assert.deepEqual(merges.map(ref=>[ref.url,ref.provenance]),[[explicit.uri,'GitHub merge of linked pull request #12']]);
  assert.equal(activity.events.find(event=>event.outcome==='merged').mergeCommitHref,explicit.uri);
  assert.match(JSON.stringify(taskReportDefinition({task,canonical}).content),/GitHub merge of linked pull request #12/);
  assert.equal(taskEngineeringActivity({task,canonical:{...canonical,lifecycle:{links:[...refs,explicit]}}})
    .references.filter(ref=>ref.kind==='commit').length,1);
});

test('linked PR commit snapshots share exact links and clock provenance across Workspace and PDF',()=>{
  const task={id:'task-pr-commits',title:'Commit activity',objective:'Inspect linked engineering work'};
  const repo='https://github.com/Kgray44/Aetherwake';
  const sha='a'.repeat(40), undated='b'.repeat(40), unrelated='c'.repeat(40);
  const commitAt='2026-01-02T00:00:00Z', observedAt='2026-01-04T00:00:00Z';
  const snapshot={cache_key:'pulls:12',number:12,commit_head:undated,
    commits_status:'partial',commits_observed_at:observedAt,commit_items:[
      {revision:sha,committed_at:commitAt},{revision:undated,committed_at:null},
    ]};
  const canonical={task,lifecycle:{state:'verifying',links:[
    {kind:'pull_request',uri:repo+'/pull/12'}, {kind:'pull_request',uri:repo+'/pull/13'},
  ]},engineering_snapshots:[snapshot,{...snapshot,cache_key:'pulls:13',number:13},
    {...snapshot,cache_key:'pulls:14',number:14,commit_items:[{revision:unrelated,committed_at:commitAt}]}]};
  const activity=taskEngineeringActivity({task,canonical});
  const commits=activity.references.filter(ref=>ref.kind==='commit');
  assert.deepEqual(commits.map(ref=>ref.revisions[0]),[sha,undated]);
  assert.equal(activity.events.length,1);
  assert.equal(activity.events[0].at,commitAt);
  assert.equal(activity.events[0].href,repo+'/commit/'+sha);
  assert.ok(activity.events[0].details.some(([,value])=>value.includes(observedAt)));
  assert.ok(activity.events[0].details.some(([,value])=>value.includes('#13')));
  const pdf=JSON.stringify(taskReportDefinition({task,canonical}).content);
  assert.ok(pdf.includes(repo+'/commit/'+sha));
  assert.ok(pdf.includes('Git commit committer time'));
  assert.ok(pdf.includes('partial'));
  assert.ok(!pdf.includes(unrelated));
});

test('cached review and CI detail stay revision bound across Workspace and PDF',()=>{
  const task={id:'t',title:'Activity fixture',objective:'Link source activity'};
  const revision='a'.repeat(40);
  const repo='https://github.com/Kgray44/Aetherwake';
  const at='2026-01-02T00:00:00Z';
  const canonical={task,lifecycle:{state:'verifying',links:[
    {kind:'pull_request',uri:repo+'/pull/12',revision},
    {kind:'ci_run',uri:repo+'/actions/runs/23/job/51',revision},
    {kind:'ci_run',uri:repo+'/actions/runs/24',revision},
  ]},engineering_snapshots:[
    {cache_key:'pulls:12',reviews:[{id:42,submitted_at:at,state:'APPROVED'}],reviews_status:'partial'},
    {cache_key:'pulls:13',reviews:[{id:40,submitted_at:at,state:'APPROVED'}]},
    {cache_key:'runs:23',revision,attempt:2,started_at:at,jobs:[
      {id:51,name:'Browser checks',completed_at:at,conclusion:'success'},
      {id:52,name:'Unlinked job',completed_at:at,conclusion:'failure'},
    ]},
    {cache_key:'runs:24',revision:'b'.repeat(40),attempt:1,jobs:[{id:53,completed_at:at}]},
  ]};
  const github={ci:{items:[
    {id:25,revision,created_at:at,pull_requests:[12]},
    {id:26,revision:'b'.repeat(40),created_at:at,pull_requests:[12]},
    {id:27,revision,created_at:at,pull_requests:[13]},
    {id:28,revision,created_at:at},
  ]}};
  const activity=taskEngineeringActivity({task,canonical,github});
  assert.deepEqual(activity.events.map(event=>event.id),[
    'github:pull:12:review:42','github:ci:23:job:51:finished','github:ci:25:created',
  ]);
  assert.equal(Object.fromEntries(activity.counts)['Dated engineering events'],3);
  const report=JSON.stringify(taskReportDefinition({task,canonical,github}).content);
  assert.match(report,/Review submitted on pull request #12/);
  assert.match(report,/Browser checks/);
  assert.match(report,/GitHub-linked pull request #12 at the Task-linked revision/);
  assert.doesNotMatch(report,/Unlinked job/);
});

test('reported external operation chronology and timing stay separate from formal attempts',()=>{
  const task={id:'activity-fixture',repository:'Kgray44/Aetherwake',title:'External operation',objective:'Collect observed events'};
  const revision='a'.repeat(40), digest='b'.repeat(64), operation='c'.repeat(64);
  const make=(outcome,occurred_at)=>({event_id:'activity_'+operation+'_'+outcome,task_id:task.id,repository:task.repository,
    revision,occurred_at,kind:'engineering_activity',activity:{kind:'verification',source:'verification_runner',
      operation_id:operation,outcome,artifact_digest:digest}});
  const start=make('started','2026-01-01T00:00:00Z');
  const finish=make('succeeded','2026-01-03T00:00:00Z');
  const telemetrySource={task_id:task.id,event_receipts:{[finish.event_id]:'2026-01-04T00:00:00Z'}};
  const canonical={task,lifecycle:{state:'verifying'},attempts:[]};
  const input={task,canonical,telemetrySource,events:[finish,{...finish,task_id:'another'},start]};
  const activity=taskEngineeringActivity(input);
  const counts=Object.fromEntries(activity.counts);
  assert.equal(counts['Formal Task Engine attempts'],0);
  assert.equal(counts['Reported external operations'],1);
  assert.equal(counts['Reported verification operations'],1);
  assert.equal(counts['Reported benchmark operations'],0);
  assert.equal(counts['Criterion evidence records'],0);
  assert.deepEqual(activity.verificationReports.map(item=>[item.outcome,item.operationId]),[['succeeded',operation]]);
  const chronology=buildTaskTimeline({...input,engineeringEvents:activity.events});
  assert.equal(chronology.length,2);
  assert.equal(chronology[0].outcome,'succeeded');
  assert.equal(Object.fromEntries(chronology[0].details)['Observatory first received'],'2026-01-04T00:00:00Z');
  assert.equal(Object.fromEntries(chronology[0].details)['Reported artifact SHA-256'],digest);
  const report=JSON.stringify(taskReportDefinition(input).content);
  assert.match(report,/Reported verification · succeeded/);
  assert.match(report,/Reported by the source journal/);
  assert.match(report,/Imported engineering activity/);
  assert.match(report,/Reported verification activity/);
  assert.match(report,/"Reported verification operations","1"/);
});

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
  assert.match(report,/First-receipt timestamps are available for 3 of 4 journal events/);
  assert.match(report,/Occurrence is later than receipt for 1 event/);
  assert.match(report,/Cross-source order is uncertain/);
  assert.match(report,/2026-01-04T00:00:00.000Z/);
});

test('execution timing preserves overlapping spans, unknown ends, and source-dated engineering points', () => {
  const task={id:'task_timing',title:'Overlap fixture',objective:'Compare timing coverage'};
  const iso=ms=>new Date(ms).toISOString();
  const attempt={id:'a',task_id:task.id,revision:'a',attempt_number:1,started_at:iso(1000),finished_at:iso(2000)};
  const open={...attempt,id:'b',attempt_number:2,started_at:iso(2200),finished_at:undefined};
  const span=(key,start,end,revision='a')=>({key,id:key,complete:true,start,end,revision,task:task.id,
    attempt:attempt.id,phase:key,events:[]});
  const linkedEvents=[{id:'pr',at:iso(500),title:'PR opened'}];
  const timing=executionTiming({taskId:task.id,attempts:[attempt,open],
    spans:[span('check',1400,2100),span('build',1100,1600),span('wrong',2100,3000,'b')],linkedEvents});
  assert.equal(timing.coveredMs,1000);
  assert.equal(timing.overlapMs,200);
  assert.equal(timing.unavailable,1);
  assert.deepEqual(timing.rows.map(row=>row.id),['pr','attempt:a','span:build','span:check','attempt:b']);
  assert.equal(timing.rows[0].elapsedMs,null);
  assert.equal(timing.rows.at(-1).elapsedMs,null);
  assert.equal(timing.rows.at(-1).offset,1);
  assert.equal(timing.rows[1].width,1000/1700);
  assert.equal(executionTiming({taskId:'empty'}).coveredMs,null);
  const report=JSON.stringify(taskReportDefinition({task,attempts:[attempt,open]}).content);
  assert.match(report,/Relative clock axis/);
  assert.match(report,/1000 ms elapsed/);
  assert.match(report,/End unavailable/);
});

test('execution timing links only continuous engine history to the matching claim', () => {
  const task={id:'task_wait',title:'Wait fixture',objective:'Compare lifecycle timing'};
  const iso=ms=>new Date(ms).toISOString();
  const attempt={id:'a',task_id:task.id,attempt_number:1,started_at:iso(1000),finished_at:iso(2000)};
  const second={...attempt,id:'b',attempt_number:2,started_at:iso(4000),finished_at:iso(5000)};
  const receipt=(version,kind,at,attempt_id)=>({version,kind,at:iso(at),attempt_id,
    actor:kind==='claim'?'worker':'owner'});
  const events=[receipt(2,'admit',100),receipt(3,'configure_execution',200),receipt(4,'claim',1000,'a'),
    receipt(5,'pause',2100),receipt(6,'resume',2500),receipt(7,'claim',4000,'b')];
  const canonical={task,lifecycle:{state:'verifying'},events:[...events].reverse()};
  const attempts=[attempt,second];
  const timing=executionTiming({taskId:task.id,canonical,attempts});
  assert.deepEqual(timing.rows.filter(row=>row.kind==='wait').map(row=>[row.label,row.attemptId,row.elapsedMs]),
    [['Admission to claim','a',900],['Resume to claim','b',1500]]);
  assert.equal(timing.coveredMs,null);
  const broken=executionTiming({taskId:task.id,attempts,canonical:{task,events:[events[0],events[2],
    receipt(5,'resume',2200),receipt(6,'pause',2500),events[5]]}});
  assert.equal(broken.rows.some(row=>row.kind==='wait'),false);
  const report=JSON.stringify(taskReportDefinition({task,canonical,attempts,audits:events}).content);
  assert.match(report,/Admission to claim/);
  assert.match(report,/Task Engine audit receipts/);
  assert.match(report,/1500 ms elapsed/);
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

test('matched receipt evidence yields the same private comparison in diagnostics and PDF', () => {
  const task={id:'task_evidence',repository:'Kgray44/Aetherwake',title:'Review',objective:'Read reports'};
  const revision='a'.repeat(40), attempt={id:'attempt_fixture',task_id:task.id,revision};
  const record={
    schema_version:1,record_type:'evidence',id:'evidence_pair',repository:task.repository,
    revision,task_id:task.id,attempt_id:attempt.id,criterion_id:'criterion-5',
    kind:'benchmark',result:'inconclusive',synthetic:false,artifact:{kind:'artifact',uri:'secret/local/path'},
    matched_benchmark:{
      source_revision:'b'.repeat(40),artifact_path:'reports/result.md',artifact_sha256:'a'.repeat(64),
      provider:'example',model:'model-fixture',
      standard:{receipt_sha256:'b'.repeat(64),input_tokens:100,cached_input_tokens:20,output_tokens:2,total_tokens:102,commands:2,turn_ms:1000},
      compact:{receipt_sha256:'c'.repeat(64),input_tokens:120,cached_input_tokens:38,output_tokens:3,total_tokens:123,commands:4,turn_ms:2000},
    },
  };
  const projection=sanitizeExport({repository:task.repository,records:[record]});
  assert.equal(projection.records[0].artifact.uri,'private-artifact:evidence_pair');
  const {artifact_path,...reportedPair}=record.matched_benchmark;
  assert.deepEqual(projection.records[0].matched_benchmark,reportedPair);
  assert.deepEqual(sanitizeExport(projection).records,projection.records);
  const diagnostics=records=>taskExecutionDiagnostics({task,attempts:[attempt],trace:{spans:[]},tokens:[],records});
  const [pair]=diagnostics(projection.records).comparisons;
  assert.deepEqual(pair.rows.find(row=>row[0]==='Uncached input tokens'),['Uncached input tokens','80','82','+2']);
  assert.deepEqual(pair.rows.at(-1),['Billing','Unknown','Unknown','Unknown']);
  assert.match(pair.summary,/reported.*byte identity.*unverified/i);
  assert.deepEqual(pair.provenance.find(([label])=>label==='Reported evidence result'),['Reported evidence result','Inconclusive']);
  const report=taskReportDefinition({task,attempts:[attempt],records:projection.records});
  assert.ok(report.content.some(block=>block.table?.body.slice(1).some(row=>JSON.stringify(row)===JSON.stringify(pair.rows.at(-1)))));
  const reportText=JSON.stringify(report.content);
  for(const [,value] of pair.provenance) assert.ok(reportText.includes(value));
  assert.doesNotMatch(reportText,/Verified artifact|matched benchmark \/|reports\/result\.md/);
  const mismatched={...record,id:'evidence_mismatched_pair',revision:'c'.repeat(40),
    matched_benchmark:{...record.matched_benchmark,artifact_sha256:'d'.repeat(64)}};
  assert.equal(diagnostics([mismatched]).comparisons.length,0);
  const rejectedReport=JSON.stringify(taskReportDefinition({task,attempts:[attempt],records:[mismatched]}).content);
  assert.match(rejectedReport,/evidence_mismatched_pair/);
  assert.match(rejectedReport,/inconclusive/);
  for(const omitted of ['Standard vs compact benchmark',mismatched.matched_benchmark.artifact_sha256,
    mismatched.matched_benchmark.standard.receipt_sha256,artifact_path]) assert.ok(!rejectedReport.includes(omitted),omitted);
  const unsafe={...record,matched_benchmark:{...record.matched_benchmark,artifact_path:'../result.md'}};
  assert.equal(diagnostics([unsafe]).comparisons.length,0);
  assert.throws(()=>sanitizeExport({repository:task.repository,records:[unsafe]}),/Invalid matched benchmark/);
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
  assert.deepEqual(executionActions({ lifecycle: { state: 'verifying', stored_state: 'verifying' } }), ['accept', 'cancel']);
  assert.deepEqual(executionActions({ lifecycle: { state: 'verifying', stored_state: 'verifying',
    can_continue_candidate:true } }), ['accept', 'continue_candidate', 'cancel']);
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

test('attempt supervision separates the current lease, provider turn and source progress', () => {
  const attempt={id:'a',task_id:'t',revision:'v',state:'orphaned',lease_until:Date.parse('2026-11-21T19:24:11Z')};
  const event={attempt_id:'a',task_id:'t',revision:'v'};
  const traces=[
    {...event,kind:'development_note',phase:'implementation',occurred_at:'2026-11-21T19:22:07Z'},
    {...event,kind:'span_end',phase:'implementation',span_id:'codex-a-codex_turn',state:'interrupted',occurred_at:'2026-11-21T19:24:13Z'},
    {...event,kind:'span_end',phase:'integration',span_id:'codex-a-terminal_reporting',state:'failed',occurred_at:'2026-11-21T19:24:14Z'},
  ];
  const heartbeat={attempt_id:'a',kind:'heartbeat',at:'2026-11-21T19:23:11Z'};
  const audits=[heartbeat,{...heartbeat,attempt_id:'other',at:'2026-11-21T19:24:14Z'},
    {...heartbeat,target_id:'another-task',at:'2026-11-21T19:24:15Z'},
    {attempt_id:'a',kind:'lease_expired',at:'2026-11-21T19:24:19Z'}];
  const {supervision}=attemptJournal(attempt,traces,audits,[]);
  assert.equal(supervision.lastRenewal,heartbeat.at);
  assert.equal(supervision.leaseUntil,attempt.lease_until);
  assert.deepEqual(supervision.provider,{state:'interrupted',at:traces[1].occurred_at});
  assert.deepEqual(supervision.progress,{label:'Development note',at:traces[0].occurred_at});
  assert.equal(supervision.recovery,'Reconciliation required');
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

test('live App Server usage is scoped, separately reported and superseded by the final receipt',()=>{
  const task={id:'task_live_tokens',repository:'Kgray44/Aetherwake',title:'Live tokens',objective:'Verify usage snapshots'};
  const attempt={task_id:task.id,id:'a1',revision:'a'.repeat(40),attempt_number:1,executor:'codex',state:'running',
    session_id:'10000000-0000-4000-8000-000000000001'};
  const event=(id,second,total,method='fresh_thread_progress',sessionId=attempt.session_id)=>({
    event_id:id,task_id:task.id,attempt_id:attempt.id,revision:attempt.revision,repository:task.repository,session_id:sessionId,
    occurred_at:'2026-01-01T00:00:'+second+'.000Z',kind:'measurement',phase:'implementation',trace_id:'trace',span_id:'span',
    measurements:[{name:'provider_total_tokens',source:'codex_app_server_token_usage_updated',method,
      unit:'tokens',availability:'observed',value:total},{name:'provider_input_tokens',source:'codex_app_server_token_usage_updated',method,
      unit:'tokens',availability:'observed',value:total-10}],
  });
  const latest=event('latest','10',700);
  const events=[latest,event('first','01',300),event('middle','05',450),latest,event('unlinked','11',900,'fresh_thread_progress','different')];
  const input={task,attempts:[attempt],events};
  const live=taskUsageAccounting(input);
  assert.equal(live.observed.totalTokens,null);
  assert.equal(live.coverage.attemptTotals,0);
  assert.deepEqual(live.progressRows.map(row=>[row.receiptId,row.observed.totalTokens]),[['latest',700]]);
  assert.deepEqual(live.progressRows[0].pace,{inputPerMinute:3000,elapsedMs:5000,sustained:true});
  assert.deepEqual(buildTaskTimeline(input).filter(row=>row.id.startsWith('trace:')),[]);
  assert.match(JSON.stringify(taskReportDefinition(input).content),/In-progress Codex usage/);
  const failed={...input,attempts:[{...attempt,state:'failed'}]};
  const failedUsage=taskUsageAccounting(failed);
  assert.equal(failedUsage.observed.totalTokens,null);
  assert.equal(failedUsage.progressRows[0].observed.totalTokens,700);
  assert.match(JSON.stringify(taskReportDefinition(failed).content),/Partial Codex usage/);
  const finished=taskUsageAccounting({...input,events:[...events,event('final','18',1000,'fresh_thread_total')]});
  assert.equal(finished.observed.totalTokens,1000);
  assert.equal(finished.progressRows.length,0);
  assert.equal(taskUsageAccounting({...input,attempts:[{...attempt,resume_session_id:attempt.session_id}]}).progressRows.length,0);
});

test('Workspace and PDF distinguish coverage, source reports and owner receipts',()=>{
  const task={id:'task_coverage',repository:'Kgray44/Aetherwake',title:'Coverage fixture',objective:'Compare source evidence',
    state:'accepted',owner_acceptance:'accepted',acceptance:{criteria:[{id:'c1',description:'Inspect candidate'}]}};
  const revision='a'.repeat(40),candidate_revision='b'.repeat(40);
  const started_at='2026-11-17T00:00:00Z',finished_at='2026-11-17T00:00:13Z';
  const attempt={task_id:task.id,id:'attempt',attempt_number:1,revision,candidate_revision,state:'succeeded',
    started_at,finished_at,execution_identity:{model:'observed-model',provider:'openai',source:'codex_app_server_thread_start'}};
  const receipt={kind:'accept',attempt_id:attempt.id,revision:candidate_revision,at:finished_at};
  const canonical={task,attempts:[attempt],lifecycle:{state:'completed',stored_state:'completed',
    evidence:[{criterion_id:'c1',revision:candidate_revision,uri:'https://example.test/artifact'}]},events:[receipt]};
  const common={task_id:task.id,attempt_id:attempt.id,repository:task.repository,phase:'implementation',revision,trace_id:'trace',span_id:'span',measurements:[]};
  const events=[{...common,kind:'span_start',event_id:'start',occurred_at:started_at},
    {...common,kind:'span_end',event_id:'end',occurred_at:finished_at}];
  const records=[{...common,id:'evidence',record_type:'evidence',kind:'test',criterion_id:'c1',result:'passed',synthetic:false}];
  const telemetrySource={task_id:task.id,event_receipts:{start:finished_at}};
  const input={task,canonical,attempts:[attempt],events,records,telemetrySource};
  const usage=taskUsageAccounting(input);
  const trace=traceTimeline(events);
  const diagnostics=taskExecutionDiagnostics({...input,tokens:usage.rows,trace});
  const layout=taskDataCoverage({...input,usage,diagnostics});
  assert.deepEqual(layout.map(row=>row.status),['observed','observed','unavailable','observed','verified','reported','unavailable']);
  const pdf=JSON.stringify(taskReportDefinition(input).content);
  for (const row of layout) assert.ok(pdf.includes(row.basis),row.topic);
  const empty={...input,canonical:{...canonical,attempts:[]},attempts:[],events:[],records:[]};
  const unavailable=taskDataCoverage({...empty,usage:taskUsageAccounting(empty),
    diagnostics:taskExecutionDiagnostics({...empty,trace:traceTimeline([]),tokens:[]})});
  assert.equal(unavailable.find(row=>row.topic==='Attempt timing').status,'inapplicable');
  assert.equal(unavailable.find(row=>row.topic==='Telemetry arrival').status,'unavailable');
});

test('Task usage deduplicates attempt and session scopes and keeps unknown billing', () => {
  const task = {id:'task_usage',repository:'Kgray44/Aetherwake',title:'Usage fixture',objective:'Compare scopes'};
  const revision = 'a'.repeat(40);
  const managed = '10000000-0000-4000-8000-000000000001';
  const dedicated = '10000000-0000-4000-8000-000000000002';
  const unknown = '10000000-0000-4000-8000-000000000003';
  const attempt = {id:'failed-first',task_id:task.id,revision,state:'failed',attempt_number:1,session_id:managed};
  const resumed = {...attempt,id:'retry',state:'succeeded',attempt_number:2,resume_session_id:managed};
  const link = session => ({kind:'executor_session',uri:'https://chatgpt.com/c/'+session,revision});
  const canonical = {task,attempts:[attempt,resumed],lifecycle:{state:'verifying',links:[link(managed),link(dedicated),link(unknown)]}};
  const now = Date.parse('2026-02-01T00:00:00Z');
  const make = (id,session,fields,extra={}) => {
    const {prefix='desktop',source='codex_desktop_session_usage',method='task_dedicated_session_total',...rest}=extra;
    return {task_id:task.id,repository:task.repository,revision,event_id:id,session_id:session,kind:'measurement',
      occurred_at:'2026-01-02T00:00:00Z',measurements:Object.entries(fields).map(([name,value])=>({
        name:prefix+'_'+name+'_tokens',value,unit:'tokens',availability:'observed',source,method,
      })),...rest};
  };
  const app = {prefix:'provider',source:'codex_app_server_token_usage_updated',method:'fresh_thread_total'};
  const first = make('attempt-receipt',managed,{total:80,input:70,cached_input:50,output:10},{...app,attempt_id:attempt.id});
  const stale = make('old-session',dedicated,{total:10}, {occurred_at:'2026-01-01T00:00:00Z'});
  const latest = make('latest-session',dedicated,{total:20,input:15,cached_input:10,output:5});
  const events = [first,latest,stale,{...first},make('managed-overlap',managed,{total:80}),
    make('resume-history',managed,{total:500},{...app,attempt_id:resumed.id}),
    make('unscoped',undefined,{total:200}),make('different-revision',unknown,{total:999},{revision:'b'.repeat(40)})];
  const input = {task,canonical,attempts:[attempt,resumed],events,now};
  const model = taskUsageAccounting(input);
  assert.deepEqual(model.observed,{totalTokens:100,cachedInputTokens:60,uncachedInputTokens:25,outputTokens:15});
  assert.equal(model.billing,'Unknown');
  assert.deepEqual(model.coverage,{attemptTotals:1,attempts:2,sessionTotals:2,sessions:3,conflicts:0});
  assert.equal(model.desktop[0].value,200);
  assert.equal(model.sessionRows.find(row=>row.id===dedicated).receiptId,latest.event_id);
  const report=JSON.stringify(taskReportDefinition(input).content);
  assert.match(report,/"Task","100","60","25","15"/);
  assert.match(report,/Attempt totals 1 of 2 · Session totals 2 of 3 · Conflicts 0 · Billing Unknown/);
  assert.match(report,/latest-session/);
  const conflict = make('conflicting',dedicated,{total:21});
  const disputed = taskUsageAccounting({...input,events:[...events,conflict]});
  assert.equal(disputed.observed.totalTokens,80);
  assert.equal(disputed.coverage.conflicts,1);

  const fallbackInput = {...input,events:events.filter(event=>event.event_id!==first.event_id)};
  const fallback = taskUsageAccounting(fallbackInput);
  const reportedSession = fallback.sessionRows.find(row=>row.id===managed);
  assert.equal(reportedSession.receiptId,'managed-overlap');
  assert.deepEqual(reportedSession.attemptIds,[attempt.id,resumed.id]);
  assert.equal(fallback.observed.totalTokens,100);
  assert.deepEqual(fallback.coverage,{attemptTotals:0,attempts:2,sessionTotals:2,sessions:3,conflicts:0});
  assert.match(JSON.stringify(taskReportDefinition(fallbackInput).content),
    /Attempt totals 0 of 2 · Session totals 2 of 3 · Conflicts 0 · Billing Unknown/);
});

test('loaded session totals keep shared and formal sessions out of session-only accounting', () => {
  const repository='Kgray44/Aetherwake', revision='a'.repeat(40);
  const id=n=>'10000000-0000-4000-8000-00000000000'+n;
  const records=['task-a','task-b'].map(taskId=>({record_type:'task',id:taskId,repository}));
  const link=n=>({kind:'executor_session',uri:'https://chatgpt.com/c/'+id(n),revision});
  const bindings=[
    {task_id:'task-a',links:[link(1),link(2),link(3),link(4)],attempt_sessions:[]},
    {task_id:'task-b',links:[link(2)],attempt_sessions:[id(3)]},
  ];
  const receipt=(n,suffix,value,at,extra={})=>({event_id:n+'-'+suffix,kind:'measurement',task_id:'task-a',
    revision,repository,session_id:id(n),occurred_at:'2026-01-0'+at+'T00:00:00Z',
    measurements:[{name:'desktop_total_tokens',source:'codex_desktop_session_usage',method:'task_dedicated_session_total',
      availability:'observed',unit:'tokens',value}],...extra});
  const latest=receipt(1,'latest',40,2);
  const events=[latest,{...latest},receipt(1,'earlier',20,1),receipt(1,'wrong-revision',200,3,{revision:'b'.repeat(40)}),
    receipt(2,'shared',60,2),receipt(3,'attempt',80,2),receipt(4,'early',30,1),receipt(4,'regression',10,2)];
  const usage=loadedSessionUsage({records,events,bindings});
  assert.deepEqual([usage.observed.totalTokens,usage.measured,usage.overlapping,usage.shared,usage.conflicting,usage.linked],
    [40,1,1,1,1,4]);
  assert.equal(loadedSessionUsage({records,events}),null);
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

test('Task usage and its PDF share current API estimates based on the final attempt receipt', () => {
  const task = {id:'task_price', repository:'Kgray44/Aetherwake', title:'Pricing', objective:'Verify token estimates'};
  const revision = 'a'.repeat(40);
  const attempt = {id:'attempt_price',task_id:task.id,revision,attempt_number:1,state:'succeeded',
    execution_identity:{model:'gpt-6.2-sol',provider:'openai'}};
  const now = Date.now();
  const receipt = {
    task_id:task.id,repository:task.repository,revision,attempt_id:attempt.id,event_id:'sample-final',kind:'measurement',
    occurred_at:new Date(now-1000).toISOString(),
    measurements:Object.entries({total:282838,input:280895,cached_input:243456,output:1943,reasoning_output:149,cache_write_input:0})
      .map(([name,value])=>({name:'provider_'+name+'_tokens',value,unit:'tokens',availability:'observed',
        source:'codex_app_server_token_usage_updated',method:'fresh_thread_total'})),
  };
  const quote={model:'gpt-6.2-sol',usdPerMillion:{input:2,cachedInput:0.1,output:10},
    retrievedAt:new Date(now-1500).toISOString(),expiresAt:new Date(now+6*3600_000).toISOString()};
  const input={task,attempts:[attempt],events:[receipt],pricing:{[quote.model]:quote},now};
  const usage=taskUsageAccounting(input);
  assert.ok(Math.abs(usage.referencePrice.total-0.1186536)<1e-12);
  assert.equal(usage.billing,'Unknown');
  const report=JSON.stringify(taskReportDefinition(input).content);
  assert.match(report,/OpenAI API reference estimate \$0\.1186536/);
  assert.match(report,/"link":"https:\/\/developers\.openai\.com\/api\/docs\/models\/gpt-6\.2-sol"/);
  assert.match(report,/Actual billing Unknown/);
  assert.equal(taskUsageAccounting({...input,now:Date.parse(quote.expiresAt)}).referencePrice.total,null);
  const oldReceipt={...receipt,measurements:receipt.measurements.filter(item=>item.name!=='provider_cache_write_input_tokens')};
  assert.equal(taskUsageAccounting({...input,events:[oldReceipt]}).referencePrice.total,null);
});

test('retry queue guidance follows canonical state while the previous failure remains in the PDF history', () => {
  const task = {id:'task_retry',repository:'Kgray44/Aetherwake',title:'Retry fixture',objective:'Recover a failed checkout'};
  const attempt = {id:'attempt_failed',task_id:task.id,revision:'a'.repeat(40),attempt_number:1,state:'failed',
    failure:'Pinned checkout failed.',finished_at:'2026-01-04T00:00:00.000Z'};
  const lifecycle = {state:'ready',stored_state:'queued',executor:'codex'};
  const canonical = {task,lifecycle,attempts:[attempt]};
  assert.equal(taskExecutionStatus({taskId:task.id,state:lifecycle.state,attempt}),null);
  assert.equal(taskNextAction(canonical).title,'Eligible · awaiting worker claim');
  assert.equal(taskNextAction(canonical,'configured',{states:['busy']}).description,'Codex worker at capacity.');
  assert.equal(taskNextAction(canonical,'not_configured').title,'Configure Codex worker access');
  const report = JSON.stringify(taskReportDefinition({task,canonical,attempts:[attempt]}).content);
  assert.match(report,/Eligible · awaiting worker claim/);
  assert.match(report,/Pinned checkout failed/);

  const blocked = {...canonical,lifecycle:{...lifecycle,state:'blocked',blockers:[{type:'task',id:'task_parent'}]}};
  assert.equal(taskNextAction(blocked).description,'1 prerequisite is outstanding.');
  const verifying = {...canonical,lifecycle:{...lifecycle,state:'verifying'}};
  assert.equal(taskNextAction(verifying).section,'task-evidence');
});
