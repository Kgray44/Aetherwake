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
import { journalDelivery, startObservatorySync } from '../scripts/agent/observatory-sync.mjs';
import { applyTelemetryDelta } from '../agent-system/observatory/telemetry-delta.mjs';
import { appendEvent, traceEvent } from '../scripts/agent/journal.mjs';
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
  let baseline, closed = false, unavailableOnce = true;
  const managedConnection = {
    async call({task_id,change,verification}) {
      assert.equal(task_id,task.id);
      assert.equal(verification,scope);
      if (unavailableOnce) {
        unavailableOnce = false;
        throw Error('The managed connection was temporarily busy');
      }
      if (!change) return {baseline:baseline??null};
      const projection = applyTelemetryDelta(baseline?.projection??null,change);
      baseline = {projection,digest:createHash('sha256').update(JSON.stringify(projection)).digest('hex'),
        received_at:new Date().toISOString()};
      return baseline;
    },
    close() { closed = true; },
  };
  const delivery = await startObservatorySync({task,journal:directory,directory:join(root,'observatory-sync'),
    verificationNamespace:scope,managedConnection});
  await delivery.finish();
  assert.equal(closed,false);
  assert.deepEqual(baseline?.projection.events.map(item=>item.event_id),[event.event_id]);
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
