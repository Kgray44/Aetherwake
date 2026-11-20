import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectJournal } from '../scripts/agent/export-journal.mjs';
import { stageSnapshot } from '../scripts/agent/stage-observatory.mjs';
import { journalDelivery, recoverWorkerTelemetry, startObservatorySync } from '../scripts/agent/observatory-sync.mjs';
import { applyTelemetryDelta } from '../agent-system/observatory/telemetry-delta.mjs';
import { appendEvent, traceEvent } from '../scripts/agent/journal.mjs';
import { recordEngineeringActivity } from '../scripts/agent/record-engineering-activity.mjs';
import { persistRecord } from '../scripts/agent/record-journal.mjs';

const cli = fileURLToPath(new URL('../scripts/agent/export-journal.mjs', import.meta.url));
const repository = 'Kgray44/Aetherwake';
const revision = '0'.repeat(40);
const time = '2026-11-17T00:00:00.000Z';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'aads-journal-export-'));
  t.after(() => rm(root, {recursive:true,force:true}));
  const directory = join(root, 'journal');
  await mkdir(directory, {mode:0o700});
  const task = {
    schema_version:1, record_type:'task', id:'task_fixture', created_at:time, repository, revision,
    title:'source-fixture-title', objective:'source-fixture-objective', classification:{primary:'backend',secondary:[]},
    prerequisites:{task_ids:[],capabilities:['private-capability']},
    acceptance:{profile_id:'profile',criteria:[{id:'criterion',description:'source-fixture-criterion'}]},
    state:'running'
  };
  const attempt = {
    schema_version:1, record_type:'attempt', id:'attempt_fixture', task_id:task.id, created_at:time, repository, revision,
    attempt_number:1, state:'running', started_at:time, branch:'private-branch'
  };
  const taskFile = join(root, 'task.json');
  await writeFile(taskFile, JSON.stringify(task));
  const run = () => spawnSync(process.execPath, [cli, '--task', taskFile, '--journal', directory], {encoding:'utf8'});
  return { task, attempt, directory, run, taskFile, root };
}

test('external activity survives export with stable identities and no source paths', async t=>{
  const {task,directory,taskFile,root}=await fixture(t);
  const receipt={kind:'deployment',source:'sites',source_id:'provider_run_42',revision,occurred_at:time,outcome:'succeeded',
    artifact_digest:'a'.repeat(64)};
  const first=await recordEngineeringActivity({task,directory,receipt});
  assert.equal(first.recorded,true);
  const receiptFile=join(root,'activity.json');
  await writeFile(receiptFile,JSON.stringify(receipt));
  const recorder=fileURLToPath(new URL('../scripts/agent/record-engineering-activity.mjs',import.meta.url));
  const replay=spawnSync(process.execPath,[recorder,'--task',taskFile,'--journal',directory,'--receipt',receiptFile],{encoding:'utf8'});
  assert.equal(replay.status,0,replay.stderr);
  assert.deepEqual(JSON.parse(replay.stdout),{...first,recorded:false});
  const git = spawnSync('git',['init','--quiet'],{cwd:root,encoding:'utf8'});
  assert.equal(git.status,0,git.stderr);
  const unconfigured=spawnSync(process.execPath,
    [recorder,'--task',taskFile,'--journal',directory,'--receipt',receiptFile,'--sync'],
    {cwd:root,encoding:'utf8'});
  assert.equal(unconfigured.status,1,unconfigured.stderr);
  assert.deepEqual(JSON.parse(unconfigured.stdout),{...first,recorded:false,delivery:'not_configured'});
  await assert.rejects(recordEngineeringActivity({task,directory,receipt:{...receipt,outcome:'failed'}}),/Conflicting event identity/);
  await assert.rejects(recordEngineeringActivity({task,directory,receipt:{...receipt,source_id:'D:\\private\\working-copy'}}),/Invalid engineering activity receipt/);
  await assert.rejects(recordEngineeringActivity({task,directory,receipt:{...receipt,outcome:'accepted'}}),/Invalid engineering trace/);
  const start=await recordEngineeringActivity({task,directory,receipt:{...receipt,occurred_at:'2026-11-16T00:00:00Z',outcome:'started'}});
  assert.notEqual(start.event_id,first.event_id);
  const json=await projectJournal({task,directory});
  const projected=JSON.parse(json);
  assert.equal(projected.events.length,2);
  assert.deepEqual(projected.events.map(event=>event.activity.outcome),['started','succeeded']);
  assert.equal(projected.events[0].activity.operation_id,projected.events[1].activity.operation_id);
  assert.equal(projected.events[1].activity.artifact_digest,receipt.artifact_digest);
  assert.doesNotMatch(json,/provider_run_42|working-copy/);
});

test('a post-attempt receipt can retry private delivery without changing the completed attempt', async t=>{
  const {task,attempt,directory,root}=await fixture(t);
  const scope='11111111-1111-4111-8111-111111111111';
  const syncDirectory=join(root,'observatory-sync');
  const completed={...attempt,state:'succeeded',finished_at:'2026-11-17T00:01:00.000Z'};
  await persistRecord(directory,completed);
  let baseline, offline=false;
  const managedConnection={async call({task_id,verification,change}) {
    assert.equal(task_id,task.id);
    assert.equal(verification,scope);
    if (offline) throw Error('Temporarily unavailable');
    if (!change) return {baseline:baseline??null};
    assert.equal(change.base,baseline?.digest??null);
    const projection=applyTelemetryDelta(baseline?.projection,change);
    const digest=createHash('sha256').update(JSON.stringify(projection)).digest('hex');
    const received_at=new Date().toISOString();
    baseline={digest,received_at,projection};
    return {digest,received_at,generated_at:projection.generated_at,events:projection.events.length,records:projection.records.length};
  }};
  const syncOptions={directory:syncDirectory,verificationNamespace:scope,managedConnection};
  const initial=await startObservatorySync({task,journal:directory,...syncOptions});
  assert.equal((await initial.finish()).events,0);
  const receipt={kind:'verification',source:'verification_runner',source_id:'verify_42',revision,
    occurred_at:'2026-11-17T00:02:00.000Z',outcome:'succeeded'};
  offline=true;
  const queued=await recordEngineeringActivity({task,directory,receipt,syncOptions});
  assert.equal(queued.delivery,'pending');
  assert.equal(queued.recorded,true);
  offline=false;
  const replay=await recordEngineeringActivity({task,directory,receipt,syncOptions});
  assert.equal(replay.event_id,queued.event_id);
  assert.equal(replay.recorded,false);
  assert.equal(replay.delivery,'synchronized');
  assert.equal(baseline.projection.records.find(record=>record.id===attempt.id).state,'succeeded');
  assert.deepEqual(baseline.projection.events.map(event=>event.event_id),[queued.event_id]);
});

test('independent release receipts synchronize across interleaved worker updates without replacing worker records',async t=>{
  const {task,attempt,directory,root}=await fixture(t);
  const releases=join(root,'release-journal');
  const completed={...attempt,state:'succeeded',finished_at:'2026-11-17T00:01:00.000Z'};
  await persistRecord(directory,completed);
  let baseline=null;
  let writes=0;
  const connector={async call({task_id,change}) {
    assert.equal(task_id,task.id);
    if (!change) return {baseline};
    if (change.base!==(baseline?.digest??null)) throw Object.assign(Error('Stale baseline'),{status:409});
    const projection=applyTelemetryDelta(baseline?.projection,change);
    const digest=createHash('sha256').update(JSON.stringify(projection)).digest('hex');
    baseline={projection,digest,received_at:new Date().toISOString()};
    writes++;
    return {digest,received_at:baseline.received_at,generated_at:projection.generated_at,
      records:projection.records.length,events:projection.events.length};
  }};
  const worker=journalDelivery({task,journal:directory,statePath:join(root,'worker.state'),connector});
  await worker();
  const oldTask={...task,state:'proposed',title:'Older task title'};
  const release=()=>journalDelivery({task:oldTask,journal:releases,
    statePath:join(root,'release.state'),connector,activityOnly:true});
  const deployed=await recordEngineeringActivity({task:oldTask,directory:releases,receipt:{
    kind:'deployment',source:'sites',source_id:'release_42',revision,
    occurred_at:'2026-11-17T00:02:00.000Z',outcome:'succeeded',
  }});
  await release()();
  assert.equal(baseline.projection.records.find(item=>item.record_type==='task').state,'running');
  const workerReceipt=await recordEngineeringActivity({task,directory,receipt:{
    kind:'test',source:'local_runner',source_id:'worker_test',revision,attempt_id:attempt.id,
    occurred_at:'2026-11-17T00:00:30.000Z',outcome:'succeeded',
  }});
  await assert.rejects(worker({force:true}),/baseline changed/);
  await worker({force:true});
  const validation=await recordEngineeringActivity({task:oldTask,directory:releases,receipt:{
    kind:'deployment_validation',source:'sites',source_id:'release_42',revision,
    occurred_at:'2026-11-17T00:03:00.000Z',outcome:'succeeded',
  }});
  await assert.rejects(release()({force:true}),/baseline changed/);
  await release()({force:true});
  assert.deepEqual(baseline.projection.events.map(event=>event.event_id),[
    deployed.event_id,workerReceipt.event_id,validation.event_id,
  ]);
  assert.equal(baseline.projection.records.find(item=>item.id===attempt.id).state,'succeeded');
  assert.equal(baseline.projection.records.find(item=>item.id===task.id).state,'running');
  await release()({force:true});
  assert.equal(writes,4);
  const invalid={
    kind:'verification',source:'sites',source_id:'invalid_attempt_binding',attempt_id:attempt.id,revision,
    occurred_at:'2026-11-17T00:04:00.000Z',outcome:'succeeded',
  };
  await assert.rejects(recordEngineeringActivity({task:oldTask,directory:releases,receipt:invalid,
    syncOptions:{activityOnly:true}}),/cannot bind an attempt/);
  assert.equal((await readdir(releases)).filter(name=>name.endsWith('.json')).length,2);
  await recordEngineeringActivity({task:oldTask,directory:releases,receipt:invalid});
  await assert.rejects(release()({force:true}),/unbound engineering receipts/);
  assert.equal(writes,4);
});

test('staging preserves a retryable snapshot on unchanged input and on corrupt new journal data', async t => {
  const { task, attempt, directory, taskFile, root } = await fixture(t);
  const stagingDirectory = join(root, 'staging');
  const options = { taskFile, journal: directory, stagingDirectory };
  const output = join(stagingDirectory, 'observatory-projection.json');
  await persistRecord(directory, attempt);
  assert.equal((await stageSnapshot(options)).changed, true);
  const first = await readFile(output, 'utf8');
  assert.equal((await stageSnapshot(options)).changed, false);
  assert.equal(await readFile(output, 'utf8'), first);
  await appendEvent(directory, traceEvent({ task, attemptId: attempt.id, kind: 'measurement' }));
  assert.equal((await stageSnapshot(options)).events, 1);
  const second = await readFile(output, 'utf8');
  assert.notEqual(second, first);
  await persistRecord(directory, { ...attempt, id: 'unrelated', task_id: 'other-task' });
  await assert.rejects(stageSnapshot(options), /another Task/);
  assert.equal(await readFile(output, 'utf8'), second);
});

test('journal delivery replays the durable outbox, sends incremental data and detects committed-file changes', async t => {
  const { task, attempt, directory, root } = await fixture(t);
  const statePath = join(root, 'delivery.json');
  const exported = [];
  let projection = null;
  let receipt = null;
  let lost = true;
  const connector = { async call({ task_id, change }) {
    assert.equal(task_id, task.id);
    if (!change) return { baseline: receipt ? { ...receipt, projection } : null };
    exported.push(change);
    const current = applyTelemetryDelta(projection, change);
    const digest = createHash('sha256').update(JSON.stringify(current)).digest('hex');
    if (digest === receipt?.digest) return receipt;
    assert.equal(change.base, receipt?.digest ?? null);
    projection = current;
    receipt = { digest, records: current.records.length, events: current.events.length,
      generated_at: current.generated_at, received_at: new Date().toISOString() };
    if (lost) { lost = false; throw Error('response lost after commit'); }
    return receipt;
  } };
  const restart = () => journalDelivery({ task, journal: directory, statePath, connector });
  await persistRecord(directory, attempt);
  const event = traceEvent({ task, attemptId: attempt.id, kind: 'measurement' });
  await appendEvent(directory, event);
  await assert.rejects(restart()(), /response lost/);
  assert.ok(JSON.parse(await readFile(statePath, 'utf8')).pending);
  const sync = restart();
  assert.equal((await sync()).events, 1);
  assert.deepEqual(exported[0], exported[1]);
  assert.equal(await sync(), null);
  const next = traceEvent({ task, attemptId: attempt.id, kind: 'measurement' });
  await appendEvent(directory, next);
  assert.equal((await sync()).sent_events, 1);
  assert.equal(exported[2].records.length, 0);
  assert.deepEqual(exported[2].events.map(item => item.event_id), [next.event_id]);
  const name = (await readdir(directory)).find(path => path === createHash('sha256').update(event.event_id).digest('hex') + '.json');
  await writeFile(join(directory, name), JSON.stringify({ ...event, phase: 'context' }));
  await assert.rejects(sync({ force: true }), /Committed journal entry changed/);
  await assert.rejects(restart()(), /rewrites a synchronized trace event/);
  assert.equal(exported.length, 3);
});

test('managed telemetry can deliver for a new checkout using the admitted worker connection', async t => {
  const { task, attempt, directory, root } = await fixture(t);
  const event = traceEvent({task,attemptId:attempt.id,kind:'measurement'});
  await appendEvent(directory,event);
  const scope = '11111111-1111-4111-8111-111111111111';
  let baseline, closed = false, transientFailures = 2;
  const managedConnection = {
    async call({task_id,change,verification}) {
      assert.equal(task_id,task.id);
      assert.equal(verification,scope);
      if (transientFailures > 0) {
        transientFailures -= 1;
        throw Error('The managed connection was temporarily busy');
      }
      if (!change) return {baseline:baseline??null};
      const projection = applyTelemetryDelta(baseline?.projection??null,change);
      baseline = {projection,digest:createHash('sha256').update(JSON.stringify(projection)).digest('hex'),
        received_at:new Date().toISOString()};
      return {...baseline,generated_at:projection.generated_at,events:projection.events.length,records:projection.records.length};
    },
    close() { closed = true; },
  };
  const delivery = await startObservatorySync({task,journal:directory,directory:join(root,'observatory-sync'),
    verificationNamespace:scope,managedConnection});
  const receipt = await delivery.finish();
  assert.equal(closed,false);
  assert.equal(receipt?.error,null);
  assert.equal(receipt.events,1);
  assert.deepEqual(baseline?.projection.events.map(item=>item.event_id),[event.event_id]);
});

test('idle worker replays pending telemetry and flushes later journal entries without another claim',async t=>{
  const {task,attempt,root:telemetryDirectory}=await fixture(t);
  const journal=join(telemetryDirectory,'claimed-execution.journal');
  const directory=join(telemetryDirectory,'observatory-sync');
  const first=traceEvent({task,attemptId:attempt.id,kind:'measurement'});
  await appendEvent(journal,first);
  let online=false, projection=null, receipt=null;
  const updates=[];
  const connector={async call({task_id,change,verification}) {
    assert.equal(task_id,task.id);
    assert.equal(verification,undefined);
    if (!change) return {baseline:receipt&&{...receipt,projection}};
    updates.push(change);
    if (!online) throw Error('Site unavailable');
    assert.equal(change.base,receipt?.digest??null);
    projection=applyTelemetryDelta(projection,change);
    receipt={digest:createHash('sha256').update(JSON.stringify(projection)).digest('hex'),
      records:projection.records.length,events:projection.events.length,generated_at:projection.generated_at,
      received_at:new Date().toISOString()};
    return receipt;
  }};
  const delivery=await startObservatorySync({task,journal,directory,managedConnection:connector});
  assert.equal((await delivery.finish()).error,'delivery_unavailable');
  const pending=updates[0];
  const preserved=updates.length;
  online=true;
  const second=traceEvent({task,attemptId:attempt.id,kind:'measurement'});
  await appendEvent(journal,second);
  const recover=options=>recoverWorkerTelemetry({taskId:task.id,telemetryDirectory,connector,...options});
  assert.equal(await recover({verification:'11111111-1111-4111-8111-111111111111'}),null);
  assert.equal((await recover()).events,2);
  assert.deepEqual(updates[preserved],pending);
  assert.deepEqual(updates[preserved+1].events.map(entry=>entry.event_id),[second.event_id]);
  assert.equal(await recover(),null);
  assert.equal(updates.length,preserved+2);
  const third=traceEvent({task,attemptId:attempt.id,kind:'measurement'});
  await appendEvent(journal,third);
  assert.equal((await recover()).events,3);
  assert.deepEqual(updates.at(-1).events.map(entry=>entry.event_id),[third.event_id]);
});

test('CLI reconstructs latest Attempts and retains incomplete spans across Task revisions', async t => {
  const {task,attempt,directory,run} = await fixture(t);
  const terminal = {...attempt,state:'succeeded',finished_at:'2026-11-17T00:00:01.000Z'};
  const otherAttempt = {...attempt,id:'attempt_continued',attempt_number:2,revision:'1'.repeat(40)};
  await persistRecord(directory, task);
  await persistRecord(directory, attempt);
  await persistRecord(directory, terminal);
  await persistRecord(directory, otherAttempt);
  await appendEvent(directory, traceEvent({
    task:{...task,revision:otherAttempt.revision},attemptId:otherAttempt.id,
    spanId:'open-span',kind:'span_start',phase:'implementation',state:'started'
  }));
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /source-fixture-title|source-fixture-objective|source-fixture-criterion|private-capability|private-branch/);
  const projection = JSON.parse(result.stdout);
  assert.equal(projection.authority, 'local-task-records');
  assert.equal(projection.records.length, 3);
  assert.equal(projection.records.find(record => record.id === attempt.id).state, 'succeeded');
  assert.equal(projection.records.find(record => record.id === otherAttempt.id).state, 'running');
  assert.deepEqual(projection.events.map(event => [event.kind,event.span_id]), [['span_start','open-span']]);
});

test('CLI fails with empty stdout on an unrelated bundled record or trace', async t => {
  const f = await fixture(t);
  await persistRecord(f.directory, {...f.attempt,task_id:'unrelated-task'});
  const result = f.run();
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /another Task/);

  const g = await fixture(t);
  await appendEvent(g.directory, traceEvent({task:{...g.task,repository:'other/repo'},kind:'span_start'}));
  await assert.rejects(projectJournal(g), /unrelated trace/);
});

test('export rejects conflicting record and span identities', async t => {
  const f = await fixture(t);
  await persistRecord(f.directory, {...f.task,objective:'Conflicting task content'});
  await assert.rejects(projectJournal(f), /Conflicting journal record identity/);

  const {task,directory} = await fixture(t);
  for (const kind of ['span_start','span_end','span_start']) {
    await appendEvent(directory, traceEvent({task,spanId:'collision',kind}));
  }
  await assert.rejects(projectJournal({task,directory}), /Conflicting journal span identity/);
});

test('export rejects a mismatched Attempt revision and false owner acceptance', async t => {
  const f = await fixture(t);
  await persistRecord(f.directory, f.attempt);
  await appendEvent(f.directory, traceEvent({
    task:{...f.task,revision:'1'.repeat(40)},attemptId:f.attempt.id,kind:'span_start'
  }));
  await assert.rejects(projectJournal(f), /Attempt revision mismatch/);

  const {task,directory} = await fixture(t);
  await assert.rejects(projectJournal({task:{...task,state:'accepted'},directory}), /Owner acceptance/);
});

test('export refuses a projection exceeding the Sites byte limit without truncating history', async t => {
  const {task,directory} = await fixture(t);
  const measurement = {name:'safe_metric',availability:'observed',value:1234,unit:'ms',source:'measurement_source',method:'measurement_method'};
  const measurements = Array.from({length:9000}, () => measurement);
  await appendEvent(directory, traceEvent({task,kind:'measurement',measurements}));
  await assert.rejects(projectJournal({task,directory}), /exceeds the Sites upload limit/);
});
