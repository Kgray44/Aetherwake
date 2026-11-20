import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createSnapshot } from '../scripts/agent/context.mjs';
import { readJournal } from '../scripts/agent/journal.mjs';
import { reconstructAttempts } from '../scripts/agent/record-journal.mjs';
import { sanitizeExport } from '../scripts/agent/telemetry-export.mjs';
import { observeCodexStream } from '../scripts/agent/provider-events.mjs';
import { openObservatoryConnector } from '../scripts/agent/observatory-connector.mjs';

const findings = rows => Object.fromEntries(rows.map(row => [row.name, row]));
const stream = chunks => Readable.from(chunks.map(chunk => Buffer.from(chunk)));
const line = event => JSON.stringify(event) + '\n';

test('App Server delivers a scoped live sample before the turn ends and preserves the newest cumulative total',async t=>{
  const cwd=await mkdtemp(join(tmpdir(),'aads-app-server-usage-'));
  t.after(()=>rm(cwd,{recursive:true,force:true,maxRetries:10,retryDelay:50}));
  const session='11111111-1111-4111-8111-111111111111';
  await writeFile(join(cwd,'app-server'),`
    const {createInterface}=require('node:readline');
    const threadId=${JSON.stringify(session)}, turnId='current';
    const send=value=>console.log(JSON.stringify(value));
    const notice=(method,params)=>send({method,params:{threadId,...params}});
    const usage=(totalTokens,id=turnId)=>notice('thread/tokenUsage/updated',{turnId:id,tokenUsage:{total:{totalTokens}}});
    createInterface({input:process.stdin}).on('line',line=>{
      const {method,id,params}=JSON.parse(line);
      if (method==='initialize') send({id,result:{}});
      if (method==='thread/start') send({id,result:{thread:{id:threadId},sandbox:{type:'workspaceWrite',
        networkAccess:false,writableRoots:[params.cwd]}}});
      if (method==='turn/start') {
        usage(100);
        send({id,result:{turn:{id:turnId}}});
        setTimeout(()=>{
          usage(400,'unrelated'); usage(200); usage(125);
          notice('turn/completed',{turn:{id:turnId,status:'completed'}});
        },30);
      }
    });
  `);
  const connector=openObservatoryConnector({executable:process.execPath,cwd});
  const observations=[];
  try {
    const result=await connector.runWorkspaceTurn({cwd,prompt:'Fixture',signal:AbortSignal.timeout(5000),onSession:()=>{},
      onUsageSnapshot:(usage,{sessionId,occurredAt})=>observations.push([usage.totalTokens,sessionId,Date.parse(occurredAt)]),
      onTurnFinished:()=>observations.push('finished')});
    assert.deepEqual(observations.map(value=>Array.isArray(value)?value.slice(0,2):value),[[100,session],'finished']);
    assert.ok(Number.isFinite(observations[0][2]));
    assert.equal(result.usage.totalTokens,200);
    assert.equal(result.sessionId,session);
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
