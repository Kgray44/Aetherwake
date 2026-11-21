import assert from 'node:assert/strict';
import test from 'node:test';
import { PassThrough, Readable } from 'node:stream';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { createInterface } from 'node:readline';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createSnapshot } from '../scripts/agent/context.mjs';
import { readJournal } from '../scripts/agent/journal.mjs';
import { reconstructAttempts } from '../scripts/agent/record-journal.mjs';
import { sanitizeExport } from '../scripts/agent/telemetry-export.mjs';
import { appServerTurnProfile, observeCodexStream } from '../scripts/agent/provider-events.mjs';
import { openObservatoryConnector } from '../scripts/agent/observatory-connector.mjs';
import { checkoutIdentity } from '../scripts/agent/observatory-task-worker.mjs';
import { reconcileAbandonedClaim } from '../scripts/agent/claim-telemetry.mjs';
import { realpath } from 'node:fs/promises';

test('forced worker termination preserves a recoverable claim until canonical orphan reconciliation', async t=>{
  const directory=await mkdtemp(join(tmpdir(),'aads-dead-worker-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const task={id:'task_00000000-0000-4000-8000-000000000001',repository:'Kgray44/Aetherwake'};
  const attempt={id:'attempt_00000000-0000-4000-8000-000000000002',revision:'a'.repeat(40),
    session_id:'00000000-0000-4000-8000-000000000003',state:'running'};
  const module=new URL('../scripts/agent/claim-telemetry.mjs',import.meta.url).href;
  const checkpoint={sessionId:attempt.session_id, branch:'codex/task-fixture',
    candidateRevision:'b'.repeat(40), terminalOperationId:'00000000-0000-4000-8000-000000000004'};
  const code='const {retainActiveClaim}=await import('+JSON.stringify(module)+');'+
    'const claim=await retainActiveClaim('+JSON.stringify(directory)+','+JSON.stringify({task,attempt})+');'+
    'await claim.update('+JSON.stringify(checkpoint)+');'+
    'console.log("ready");setInterval(()=>{},1000);';
  const worker=spawn(process.execPath,['--input-type=module','--eval',code],{stdio:['ignore','pipe','pipe'],windowsHide:true});
  t.after(()=>{if(worker.exitCode===null&&!worker.signalCode)worker.kill();});
  const ended=once(worker,'exit');
  const started=once(worker.stdout,'data').then(([output])=>String(output));
  assert.match(await Promise.race([started,ended.then(()=>{throw Error('Worker fixture exited before its durable claim');})]),/ready/);
  let reads=0;
  const recovery={directory,taskId:task.id,readTask:async()=>{reads++;return {task,attempts:[attempt]};}};
  await reconcileAbandonedClaim(recovery);
  assert.equal(reads,0);
  worker.kill('SIGKILL');
  await ended;
  await reconcileAbandonedClaim(recovery);
  assert.equal(reads,1);
  attempt.state='orphaned';
  attempt.finished_at='2026-11-20T23:51:42.040Z';
  await reconcileAbandonedClaim(recovery);
  await reconcileAbandonedClaim(recovery);
  const entries=await readJournal(join(directory,'claimed-execution.journal'));
  assert.deepEqual(entries.map(entry=>[entry.state,entry.attempt_id,entry.session_id,entry.occurred_at]),
    [['interrupted',attempt.id,attempt.session_id,attempt.finished_at]]);
  const markerPath=join(directory,'active-'+attempt.id+'.json');
  const preserved=JSON.parse(await readFile(markerPath,'utf8'));
  assert.equal(preserved.candidateRevision,checkpoint.candidateRevision);
  assert.equal(preserved.terminalOperationId,checkpoint.terminalOperationId);
  assert.equal(preserved.lease,undefined);
  attempt.state='verifying';
  attempt.candidate_revision=checkpoint.candidateRevision;
  await reconcileAbandonedClaim(recovery);
  await assert.rejects(readFile(markerPath),{code:'ENOENT'});
});

const findings = rows => Object.fromEntries(rows.map(row => [row.name, row]));
const stream = chunks => Readable.from(chunks.map(chunk => Buffer.from(chunk)));
const line = event => JSON.stringify(event) + '\n';

test('App Server profile reconciles response intervals without summing lifetime counters or exposing tool contents', () => {
  const usage = (inputTokens,cachedInputTokens,outputTokens) =>
    ({inputTokens,cachedInputTokens,outputTokens,totalTokens:inputTokens+outputTokens});
  const profile = appServerTurnProfile(false,125);
  const first = {total:usage(100,20,10),last:usage(100,20,10)};
  const command = {type:'commandExecution',id:'1',command:'private',cwd:'private',aggregatedOutput:'é',status:'completed'};
  profile.observeUsage(null);
  profile.observeUsage(first);
  profile.observeUsage(first);
  profile.observeUsage({total:usage(370,220,30),last:usage(150,120,12)}); // two responses before this notice
  profile.observeTool(command);
  profile.observeUsage({total:usage(570,400,40),last:usage(200,180,10)});
  profile.observeUsage(first); // stale read
  profile.observeTool(command);
  profile.observeTool({...command,id:'2',aggregatedOutput:null,status:'failed'});
  profile.observeTool({type:'mcpToolCall',id:'3',result:'private'});
  const rows = profile.measurements(true);
  const got = findings(rows);
  const value = field => got['app_server_'+field]?.value;
  assert.deepEqual([value('usage_notification_count'),value('observed_interval_count'),value('reconciled_response_count')],[3,3,2]);
  assert.deepEqual([value('first_response_input_tokens'),value('latest_response_input_tokens'),value('latest_response_cached_input_tokens')],[100,200,180]);
  assert.equal(value('interval_2_response_input_tokens'),undefined);
  assert.deepEqual([value('interval_3_response_output_tokens'),value('interval_3_command_count')],[10,1]);
  assert.deepEqual([value('command_count'),value('repeated_command_count'),value('failed_command_count'),
    value('command_event_output_bytes'),value('mcp_tool_count')],[2,1,1,2,1]);
  assert.doesNotMatch(JSON.stringify(rows),/private|é/);

  const resumed = appServerTurnProfile(true,125);
  resumed.observeUsage(first);
  resumed.observeUsage({total:usage(300,200,20),last:usage(200,180,10)});
  const resumedRows = findings(resumed.measurements(false));
  assert.equal(resumedRows.app_server_reconciled_response_count.value,1);
  assert.equal(resumedRows.app_server_first_response_input_tokens.value,200);

  const long = appServerTurnProfile(false,10);
  for (let i=1;i<=20;i++) long.observeUsage({total:usage(i*100,i*20,i*10),last:usage(100,20,10)});
  const bounded=long.measurements(true);
  assert.ok(bounded.length<=64);
  assert.deepEqual(bounded.flatMap(row=>row.name.match(/^app_server_interval_(\d+)_command_count$/)?.[1]??[]),
    ['1','2','3','4','17','18','19','20']);
});

test('checkout readback batches compatible queries and falls back on ambiguous records',async()=>{
  const cwd=await realpath(process.cwd());
  const root=join(cwd,'.git');
  const base='0'.repeat(40), revision='1'.repeat(40);
  const branch='codex/aads-task-fixture';
  const answers=new Map([
    ['rev-parse --show-toplevel',cwd],['rev-parse HEAD',revision],['rev-parse --absolute-git-dir',root],
    ['remote get-url origin','https://github.com/Kgray44/Aetherwake.git'],['symbolic-ref --short HEAD',branch],
    ['status --porcelain --untracked-files=normal','?? work'],['merge-base --is-ancestor '+base+' '+revision,''],
  ]);
  async function read(fastReadback, batch, override = {}) {
    let calls=0;
    const identity=await checkoutIdentity(cwd,base,{fastReadback,readGit:async(path,...args)=>{
      assert.equal(path,cwd);
      ++calls;
      const key=args.join(' ');
      if (key==='rev-parse --show-toplevel HEAD --absolute-git-dir') return batch;
      assert.ok(answers.has(key),key);
      return override[key]??answers.get(key);
    }});
    return {identity,calls};
  }
  const baseline=await read(false);
  assert.deepEqual(baseline,{identity:{branch,revision,dirty:true},calls:7});
  assert.deepEqual(await read(true,[cwd,revision,root].join('\r\n')),{identity:baseline.identity,calls:5});
  assert.deepEqual(await read(true,'ambiguous'),{identity:baseline.identity,calls:8});
  await assert.rejects(read(true,[cwd,revision,root].join('\n'),{'remote get-url origin':'https://example.com/other'}),/dedicated Aetherwake/);
});

function fixtureAppServer(status) {
  const child = Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough()});
  const requests=createInterface({input:child.stdin});
  child.kill=()=>{requests.close();child.stdout.end();};
  const session='11111111-1111-4111-8111-111111111111';
    const threadId=session, turnId='current';
    const send=value=>child.stdout.write(line(value));
    const notice=(method,params)=>send({method,params:{threadId,...params}});
    const usage=(totalTokens,id=turnId)=>notice('thread/tokenUsage/updated',{turnId:id,tokenUsage:{total:{totalTokens}}});
    requests.on('line',line=>{
      const {method,id,params}=JSON.parse(line);
      if (method==='initialize') send({id,result:{}});
      if (method==='thread/start') send({id,result:{thread:{id:threadId},sandbox:{type:'workspaceWrite',
        networkAccess:false,writableRoots:[params.cwd]}}});
      if (method==='turn/start') {
        notice('turn/completed',{turn:{id:'unrelated',status:'failed'}});
        notice('item/completed',{turnId:'unrelated',item:{id:'bad',type:'commandExecution'}});
        notice('item/completed',{turnId,item:{id:'early',type:'commandExecution'}});
        usage(100);
        usage(400,'unrelated');
        send({id,result:{turn:{id:turnId}}});
        setTimeout(()=>{
          usage(400,'unrelated'); usage(200); usage(125);
          notice('turn/completed',{turn:{id:turnId,status}});
        },30);
      }
    });
  return {session,child};
}

test('aborting a lost Task Engine reply releases the call without closing other RPCs', {timeout:2000}, async t => {
  const child = Object.assign(new EventEmitter(), {stdin:new PassThrough(),stdout:new PassThrough()});
  const requests = createInterface({input:child.stdin});
  child.kill = () => { requests.close(); child.stdout.end(); };
  const controller = new AbortController();
  let lostReply;
  requests.on('line', raw => {
    const {id,method,params} = JSON.parse(raw);
    const reply = result => child.stdout.write(line({id,result}));
    if (method === 'initialize') reply({});
    if (method === 'thread/start') reply({thread:{id:'control'}});
    if (method === 'mcpServer/tool/call') {
      if (params.arguments.operation === 'lost') {
        lostReply = () => reply({structuredContent:{status:200,result:'late'}});
        controller.abort(Error('request budget elapsed'));
      } else {
        lostReply();
        reply({structuredContent:{status:200,result:'renewed'}});
      }
    }
  });
  const connector = openObservatoryConnector({spawnProcess:()=>child});
  t.after(()=>connector.close());
  await assert.rejects(connector.call({operation:'lost'},undefined,{signal:controller.signal}),/request budget elapsed/);
  assert.equal((await connector.call({operation:'heartbeat'})).result,'renewed');
});

test('App Server keeps early usage for the exact turn and ignores unrelated completion',async()=>{
  const {session,child}=fixtureAppServer('completed');
  const cwd=process.cwd();
  const connector=openObservatoryConnector({cwd,spawnProcess:()=>child});
  const observations=[];
  try {
    const result=await connector.runWorkspaceTurn({cwd,prompt:'Fixture',signal:AbortSignal.timeout(5000),onSession:()=>{},
      onUsageSnapshot:(usage,{sessionId,occurredAt})=>observations.push([usage.totalTokens,sessionId,Date.parse(occurredAt)]),
      onTurnFinished:()=>observations.push('finished')});
    assert.deepEqual(observations.map(value=>Array.isArray(value)?value.slice(0,2):value),[[100,session],'finished']);
    assert.ok(Number.isFinite(observations[0][2]));
    assert.equal(result.status,'completed');
    assert.equal(result.usage.totalTokens,200);
    assert.equal(result.sessionId,session);
    assert.equal(findings(result.profile).app_server_command_count.value,1);
  } finally {connector.close();}
});

test('a failed fresh App Server turn publishes its last observed usage as progress',async()=>{
  const {child}=fixtureAppServer('failed');
  const cwd=process.cwd();
  const connector=openObservatoryConnector({cwd,spawnProcess:()=>child});
  const observed=[];
  try {
    const result=await connector.runWorkspaceTurn({cwd,prompt:'Fixture',signal:AbortSignal.timeout(5000),
      onSession:()=>{},onUsageSnapshot:usage=>{
        observed.push(usage.totalTokens);
        if (observed.length===1) throw Error('Transient journal error');
      }});
    assert.equal(result.status,'failed');
    assert.equal(findings(result.profile).app_server_turn_completed.value,0);
    assert.deepEqual(observed,[100,200]);
  } finally {connector.close();}
});

test('only explicit concise Codex messages become development notes',async()=>{
  const messages=[
    {id:'note',type:'agent_message',text:'Development note [warning]: Cache warmup masks the first-run regression.'},
    {id:'plain',type:'agent_message',text:'Normal progress message'},
    {id:'long',type:'agent_message',text:'Development note [finding]: '+'too long '.repeat(22)},
    {id:'path',type:'agent_message',text:'Development note [decision]: Use C:/private/file'},
    {id:'fake',type:'command_execution',aggregated_output:'Development note [finding]: raw process output'},
  ];
  const observed=[];
  await observeCodexStream(stream([
    line({type:'turn.started'}),...messages.map(item=>line({type:'item.completed',item})),
    line({type:'turn.completed',usage:{input_tokens:20,output_tokens:10}}),
  ]),{
    onTurnStarted:()=>observed.push('started'),
    onDevelopmentNote:(id,note)=>observed.push([id,note]),
    onTurnFinished:state=>observed.push(state),
  });
  assert.deepEqual(observed,['started',['note',{category:'warning',text:'Cache warmup masks the first-run regression.'}],'completed']);
});

test('observes Codex token usage incrementally and forwards stdout unchanged', async () => {
  const frames = [
    line({type:'thread.started',thread_id:'private-thread'}),
    line({type:'turn.started'}),
    line({type:'item.completed',item:{id:'private-item',type:'command_execution',status:'failed',exit_code:1,aggregated_output:'SECRET'}}),
    line({type:'turn.completed',usage:{input_tokens:12,cached_input_tokens:0,output_tokens:2}})
  ];
  const persisted = [];
  const forwarded = [];
  const rows = await observeCodexStream(stream([frames[0] + frames[1].slice(0,4),frames[1].slice(4) + frames[2],frames[3].trimEnd()]), {
    onUsage: async rows => { persisted.push(rows); },
    forward: async bytes => { forwarded.push(bytes); }
  });
  assert.equal(findings(rows).provider_stream_complete.value, 1);
  assert.equal(findings(rows).provider_command_failed_event_count.value, 1);
  assert.equal(persisted.length, 1);
  assert.equal(findings(persisted[0]).provider_input_tokens.value, 12);
  assert.equal(findings(persisted[0]).provider_cached_input_tokens.value, 0);
  assert.equal(findings(persisted[0]).provider_reasoning_output_tokens.availability, 'unavailable');
  assert.equal(Buffer.concat(forwarded).toString(), frames.join('').trimEnd());
  assert.doesNotMatch(JSON.stringify({rows,persisted}), /private-thread|private-item|SECRET/);
});

test('recovers after an oversized or malformed JSONL record and labels coverage partial', async () => {
  const persisted = [];
  const complete = line({type:'turn.completed',usage:{input_tokens:1}});
  const rows = findings(await observeCodexStream(stream([line({type:'turn.started'}),'x'.repeat(140),'y'.repeat(200) + '\n{broken}\n' + complete]), {
    maxLineBytes: 256,
    onUsage: async rows => { persisted.push(rows); }
  }));
  assert.equal(rows.provider_stream_complete.value, 0);
  assert.equal(rows.provider_stream_dropped_line_count.value, 2);
  assert.equal(persisted.length, 1);
});

test('does not convert failed, unfinished, or empty streams into complete usage', async () => {
  const failed = findings(await observeCodexStream(stream([
    line({type:'turn.started'}),
    line({type:'turn.failed',error:{message:'SECRET'}})
  ])));
  assert.equal(failed.provider_stream_complete.value, 1);
  assert.equal(failed.provider_turn_failed_event_count.value, 1);
  assert.equal(failed.provider_usage_complete.value, 0);
  assert.doesNotMatch(JSON.stringify(failed), /SECRET/);
  for (const frames of [[], [line({type:'turn.started'}), '{"type":"turn.completed"']]) {
    const rows = findings(await observeCodexStream(stream(frames)));
    assert.equal(rows.provider_stream_complete.value, 0);
    assert.equal(rows.provider_usage_complete.value, 0);
  }
});

test('reports journal callback failure and still consumes and forwards subsequent frames', async () => {
  const frames = [line({type:'turn.started'}),line({type:'turn.completed',usage:{input_tokens:1}}),line({type:'error',message:'SECRET'})];
  const forwarded = [];
  const rows = findings(await observeCodexStream(stream(frames), {
    onUsage: async () => { throw Error('private journal path'); },
    forward: async bytes => { forwarded.push(bytes); }
  }));
  assert.equal(rows.provider_stream_complete.value, 1);
  assert.equal(rows.provider_usage_complete.value, 0);
  assert.equal(rows.provider_usage_write_failure_count.value, 1);
  assert.equal(rows.provider_error_event_count.value, 1);
  assert.equal(Buffer.concat(forwarded).toString(), frames.join(''));
  assert.doesNotMatch(JSON.stringify(rows), /private journal path|SECRET/);
});

async function wrapperFixture(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'aetherwake-provider-observed-'));
  t.after(() => rm(cwd, { recursive:true, force:true }));
  const git = (...argv) => execFileSync('git', argv, { cwd, encoding:'utf8' }).trim();
  git('init', '-q');
  await writeFile(join(cwd, 'authority.md'), 'Canonical authority\n');
  git('add', 'authority.md');
  git('-c', 'user.name=Agent Test', '-c', 'user.email=agent-test@example.invalid', 'commit', '-qm', 'Fixture');
  const task = {
    schema_version:1, record_type:'task', id:'task_provider_fixture',
    repository:'example/repo', revision:git('rev-parse','HEAD'),
    created_at:new Date().toISOString(), title:'Provider fixture', objective:'Observe a supplied JSONL stream',
    classification:{primary:'integration',secondary:[]}, prerequisites:{task_ids:[],capabilities:[]},
    acceptance:{profile_id:'integration-test',criteria:[{id:'verify',description:'Observe the fixture'}]},
    state:'ready', owner_acceptance:'not_reviewed', requirements:[{kind:'document',uri:'authority.md'}],
    deliverables:['A reproducible checked artifact']
  };
  const context = await createSnapshot({root:cwd,task,repository:task.repository,owners:['governance=authority.md']});
  const cli = fileURLToPath(new URL('../scripts/agent/telemetry.mjs', import.meta.url));
  const journalPath = join(cwd, 'events.jsonl.journal');
  const taskPath = join(cwd, 'task.json');
  const contextPath = join(cwd, 'context.json');
  await Promise.all([writeFile(taskPath, JSON.stringify(task)), writeFile(contextPath, JSON.stringify(context))]);
  const argv = command => [cli, 'run', '--task', taskPath, '--context', contextPath, '--repo', task.repository,
    '--event-stream', 'codex-exec-json', '--out', join(cwd, 'events.jsonl'), '--', process.execPath, '-e', command];
  return { cwd, journalPath, task, argv };
}

const usageFrames = line({type:'thread.started',thread_id:'private-thread'}) +
  line({type:'turn.started'}) +
  line({type:'item.completed',item:{id:'private-item',type:'file_change',changes:[{path:'secret-path'}]}}) +
  line({type:'turn.completed',usage:{input_tokens:15,cached_input_tokens:5,cache_write_input_tokens:0,output_tokens:2,reasoning_output_tokens:1}});

test('command wrapper journals selected usage and preserves the child stdout and exit status', async t => {
  const {cwd, journalPath, task, argv} = await wrapperFixture(t);
  const command = 'process.stdout.write(' + JSON.stringify(usageFrames) + ');process.exitCode=23';
  await assert.rejects(promisify(execFile)(process.execPath, argv(command), {cwd}), error => {
    assert.equal(error.code, 23);
    assert.equal(error.stdout, usageFrames);
    return true;
  });
  const events = await readJournal(journalPath);
  const start = events.find(event => event.kind === 'span_start');
  const usage = events.find(event => event.kind === 'measurement');
  const end = events.find(event => event.kind === 'span_end');
  assert.equal(usage.task_id, task.id);
  assert.equal(usage.revision, task.revision);
  assert.equal(usage.attempt_id, start.attempt_id);
  assert.equal(usage.span_id, start.span_id);
  assert.equal(findings(usage.measurements).provider_input_tokens.value, 15);
  assert.equal(findings(end.measurements).provider_usage_complete.value, 1);
  assert.equal(findings(end.measurements).process_exit_code.value, 23);
  const exported = sanitizeExport({repository:task.repository,events});
  assert.doesNotMatch(JSON.stringify(events), /private-thread|private-item|secret-path/);
  assert.deepEqual(exported.events.find(event => event.kind === 'measurement').measurements, usage.measurements);
});

test('completed usage survives observer interruption without claiming the Attempt completed', async t => {
  const {cwd, journalPath, argv} = await wrapperFixture(t);
  const command = 'process.stdout.write(' + JSON.stringify(usageFrames) + ');process.stdin.resume()';
  const wrapper = spawn(process.execPath, argv(command), {cwd,stdio:['pipe','ignore','ignore'],windowsHide:true});
  const closed = once(wrapper, 'close');
  let saved = false;
  try {
    const deadline = performance.now() + 30_000;
    while (performance.now() < deadline && wrapper.exitCode === null && wrapper.signalCode === null) {
      const events = await readJournal(journalPath).catch(error => {
        if (error.code === 'ENOENT') return [];
        throw error;
      });
      saved = events.some(event => event.kind === 'measurement');
      if (saved) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.equal(saved, true, 'provider measurement persisted before child exit');
  } finally {
    wrapper.kill('SIGKILL');
    wrapper.stdin.destroy();
    await closed;
  }
  const rebuilt = await reconstructAttempts(journalPath);
  assert.equal(rebuilt.attempts[0].state, 'running');
  assert.equal(rebuilt.coverage[0].coverage, 'partial');
  assert.equal(rebuilt.coverage[0].execution_liveness, 'unknown');
  const events = await readJournal(journalPath);
  assert.equal(findings(events.find(event => event.kind === 'measurement').measurements).provider_input_tokens.value, 15);
  assert.equal(events.some(event => event.kind === 'span_end'), false);
});

test('core coverage tolerates absent optional fields and rejects invalid token subsets', async () => {
  const persisted = [];
  const frames = usage => [line({type:'turn.started'}),line({type:'turn.completed',usage})];
  const observe = usage => observeCodexStream(stream(frames(usage)), {onUsage: async rows => { persisted.push(findings(rows)); }});
  const valid = findings(await observe({input_tokens:12,output_tokens:3,cached_input_tokens:0}));
  assert.equal(valid.provider_core_usage_complete?.value, 1);
  assert.equal(valid.provider_usage_complete.value, 0);
  const invalid = findings(await observe({
    input_tokens:12,output_tokens:3,cached_input_tokens:13,reasoning_output_tokens:4
  }));
  assert.equal(invalid.provider_core_usage_complete?.value, 1);
  assert.equal(persisted[1].provider_cached_input_tokens.availability, 'unavailable');
  assert.equal(persisted[1].provider_reasoning_output_tokens.availability, 'unavailable');
  const missing = findings(await observe({output_tokens:3}));
  assert.equal(missing.provider_core_usage_complete?.value, 0);
});

test('claimed execution journals usage against its immutable revision without publishing an Attempt copy', async t => {
  const {createClaimTelemetry} = await import('../scripts/agent/claim-telemetry.mjs');
  const {projectJournal} = await import('../scripts/agent/export-journal.mjs');
  const {journalPath, task:fixtureTask} = await wrapperFixture(t);
  const task = {...fixtureTask,repository:'Kgray44/Aetherwake'};
  const attempt = {id:'attempt_engine',revision:'d'.repeat(40)};
  const collector = createClaimTelemetry({journal:journalPath,task,attempt});
  await collector.start();
  const note={itemId:'private-item',sessionId:'11111111-1111-4111-8111-111111111111',
    occurredAt:'2026-11-20T00:00:00.000Z',note:{category:'finding',text:'The checksum matched.'}};
  await collector.onDevelopmentNote(note);
  await collector.onDevelopmentNote(note);
  const summary = await observeCodexStream(stream([usageFrames]), {onUsage:collector.onUsage});
  let events = await readJournal(journalPath);
  assert.deepEqual(events.map(event => event.kind).sort(), ['development_note','measurement','span_start']);
  assert.deepEqual(events.find(event=>event.kind==='development_note')?.development_note,note.note);
  assert.equal(events.every(event => event.attempt_id === attempt.id && event.revision === attempt.revision), true);
  assert.doesNotMatch(JSON.stringify(events), /private-thread|private-item|secret-path/);
  await collector.finish({measurements:summary,state:'completed'});
  events = await readJournal(journalPath);
  const close = events.find(event => event.kind === 'span_end');
  assert.equal(findings(close.measurements).provider_core_usage_complete.value, 1);
  assert.equal(findings(close.measurements).elapsed_wall_ms.availability, 'observed');
  const exported = JSON.parse(await projectJournal({task,directory:journalPath}));
  assert.deepEqual(exported.records.map(record => record.record_type), ['task']);
  assert.equal(exported.events.length, 4);
  const retry = createClaimTelemetry({journal:journalPath,task,attempt});
  await assert.rejects(retry.start(), /already exists|Conflicting/);
  assert.equal((await readJournal(journalPath)).length, 4);
});

test('default engine hooks use the dedicated checkout journal with no connection required', async t => {
  const {createClaimTelemetryHooks} = await import('../scripts/agent/claim-telemetry.mjs');
  const {cwd, task} = await wrapperFixture(t);
  const attempt = {id:'attempt_worker',revision:task.revision};
  const hooks = createClaimTelemetryHooks(cwd);
  await hooks.onTelemetryStart({task,attempt});
  const measurements = await observeCodexStream(stream([usageFrames]), {
    onUsage: usage => hooks.onUsage({task,attempt,measurements:usage})
  });
  await hooks.onTelemetryEnd({task,attempt,measurements,state:'interrupted'});
  const rows = await readJournal(join(cwd,'.git','agent-harness','claimed-execution.journal'));
  assert.equal(rows.length, 3);
  assert.equal(rows.find(event => event.kind === 'span_end').state, 'interrupted');
});

test('claim delivery forwards isolated and explicit live namespace to the existing synchronizer', async t => {
  const {createClaimTelemetryHooks} = await import('../scripts/agent/claim-telemetry.mjs');
  const {cwd,task} = await wrapperFixture(t);
  const calls = [];
  const verification = '10971a67-3899-4980-8d25-5500a0499fd6';
  for (const [index,scope] of [verification,null].entries()) {
    const attempt = {id:'attempt_namespace_'+index,revision:task.revision};
    const hooks = createClaimTelemetryHooks(cwd, {startDelivery:async request => calls.push(request)});
    await hooks.onTelemetryStart({task,attempt,verificationNamespace:scope});
  }
  assert.deepEqual(calls.map(request => request.verificationNamespace), [verification,null]);
});
