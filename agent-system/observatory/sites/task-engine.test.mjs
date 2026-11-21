import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, mkdir, realpath, rmdir, unlink, writeFile } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { PassThrough, Readable, Writable } from 'node:stream';
import { EventEmitter, once } from 'node:events';
import { hostname, tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { proposedTask } from '../intake.mjs';
import { taskAttemptRecord, taskOperation } from './task-engine.mjs';
import { observeCodexStream } from '../../../scripts/agent/provider-events.mjs';
import { checkWorkerStorage, checkWorkspaceTelemetryScope, codexTaskPrompt, executeAppServer, prepareRecoveredCandidate, provisionTaskWorkspace, runClaim } from '../../../scripts/agent/observatory-task-worker.mjs';
import { reconcileAbandonedClaim } from '../../../scripts/agent/claim-telemetry.mjs';
import { hasLiveTaskWork, workerDispatchStatus } from '../src/task-engine-client.mjs';
import { openObservatoryConnector } from '../../../scripts/agent/observatory-connector.mjs';
import { readJournal } from '../../../scripts/agent/journal.mjs';
import { buildEngineeringAnalytics } from '../src/engineering-analytics.mjs';

const rev = 'a'.repeat(40);
const fields = name => ({
  title: 'Task ' + name, objective: 'Produce a checked artifact for task ' + name,
  primary: 'backend', profile_id: 'backend', criteria: ['Artifact is readable'], dependencies: [],
});

function setup(t, { countAuditWrites = false } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  for (const migration of ['0000_proposals', '0003_proposal_publication', '0004_cached_proposal_revision',
    '0007_proposal_controls', '0011_task_engine', '0013_task_worker_liveness', '0014_task_worker_scope']) {
    sqlite.exec(readFileSync(new URL('./drizzle/' + migration + '.sql', import.meta.url), 'utf8'));
  }
  const db = { prepare(statement) {
    const stmt = sqlite.prepare(statement);
    return { bind: (...args) => ({
      first: async () => stmt.get(...args) ?? null,
      all: async () => ({ results: stmt.all(...args) }),
      run: async () => {
        const meta = stmt.run(...args);
        const includesAuditWrite = /(?:UPDATE proposals SET record = \?, engine = \?|INSERT OR IGNORE INTO proposals)/.test(statement);
        if (countAuditWrites && includesAuditWrite && meta.changes === 1) meta.changes = 2;
        return { meta };
      },
    }) };
  } };
  let now = Date.now();
  let revision = rev;
  const call = (body, access = 'owner', owner = 'owner-1') => taskOperation({
    db, owner, namespace: 'live', body, access, validate: () => true, revision: async () => revision, now,
  });
  const register = async (name, deps = []) => {
    const response = await call({ op: 'register', operation_id: crypto.randomUUID(),
      fields: { ...fields(name), dependencies: deps } }, 'agent');
    assert.equal(response.status, 201);
    return response.body;
  };
  const get = async task => (await call({ op: 'get', task_id: task.task.id })).body;
  const command = (task, type, extra = {}, access) => call({ op: 'command', task_id: task.task.id,
    expected_version: task.version, operation_id: crypto.randomUUID(), action: { type, ...extra } }, access);
  return { sqlite, call, register, command, get, pin: value => { revision = value; }, advance: ms => { now += ms; } };
}

test('authenticated worker liveness is owner-scoped, expires, and does not create a Task or attempt', async t => {
  const { call, advance } = setup(t);
  const pulse = { op:'worker_pulse', worker_id:crypto.randomUUID(), worker_state:'available' };
  assert.equal((await call(pulse)).status, 403);
  assert.equal((await call({ ...pulse, worker_state:'arbitrary text' }, 'worker')).status, 400);
  const receipt = await call(pulse, 'worker');
  assert.equal(receipt.status, 200);
  const view = async () => (await call({ op:'list' })).body;
  assert.deepEqual((await view()).tasks, []);
  assert.equal(workerDispatchStatus((await view()).worker_dispatch, 'configured').label, 'Codex worker online');
  assert.deepEqual((await call({ op:'list' }, 'owner', 'other-owner')).body.worker_dispatch.states, []);
  assert.equal((await call({ op:'list' }, 'agent')).body.worker_dispatch, undefined);
  await call({ ...pulse, worker_state:'claim_rejected' }, 'worker');
  assert.equal(workerDispatchStatus((await view()).worker_dispatch, 'configured').label, 'Recent worker claim rejected');
  advance(60_000);
  const stale = workerDispatchStatus((await view()).worker_dispatch, 'configured');
  assert.equal(stale.label, 'Codex worker disconnected');
  assert.equal(stale.at, receipt.body.seen_at);
  assert.equal(hasLiveTaskWork([{ lifecycle:{ state:'ready' } }]), true);
});

test('storage guard permits slower verification and distinguishes timeout, reserve denial and unavailable data', async () => {
  const command = ['guard', 'bounded-budget'];
  await checkWorkerStorage(command, '.', async (file, args, options) => {
    assert.equal(file, 'guard');
    assert.deepEqual(args, ['bounded-budget']);
    assert.equal(options.timeout, 30_000);
  });
  for (const [cause, code] of [[{ killed:true },'storage_guard_timeout'], [{ code:2 },'storage_reserve_denied'],
    [{ code:'ENOENT' },'storage_guard_unavailable']]) {
    await assert.rejects(checkWorkerStorage(command, '.', async () => { throw cause; }), { code });
  }
  const measured = {utc:new Date().toISOString(),allowed:true,floorBytesEach:32_212_254_720,
    cFreeBytes:40_000_000_000,dFreeBytes:50_000_000_000,estimatedCBytes:1,estimatedDBytes:1};
  const reserveGuard = ['powershell.exe','-File','ReserveGuard.ps1'];
  await checkWorkerStorage(reserveGuard,'.',async()=>({stdout:JSON.stringify(measured)}));
  await assert.rejects(checkWorkerStorage(reserveGuard,'.',async()=>({
    stdout:JSON.stringify({...measured,utc:new Date(Date.now()-120_000).toISOString()}),
  })),{code:'storage_guard_unavailable'});
  await assert.rejects(checkWorkerStorage(reserveGuard,'.',async()=>{
    throw Object.assign(Error('reserve denied'),{code:2,stdout:JSON.stringify({
      ...measured,allowed:false,cFreeBytes:measured.floorBytesEach,
    })});
  }),error=>error.code==='storage_reserve_denied'&&error.reserve.floorBytesEach===measured.floorBytesEach);
});

test('owner amendments preserve the claimed spec and become effective on retry', async t => {
  const { register, command, call, get } = setup(t);
  const task = await register('amendment');
  const admitted = (await command(task, 'admit', { executor: 'codex' })).body;
  const edit = { fields: { ...fields('edited before claim'), priority: 'high' } };
  assert.equal((await command(admitted, 'edit', edit, 'agent')).status, 403);
  const edited = await command(admitted, 'edit', edit);
  assert.equal(edited.status, 200);
  assert.equal((await command(admitted, 'edit', edit)).status, 409);
  const claim = async () => (await call({ op: 'claim', operation_id: crypto.randomUUID() }, 'worker')).body.claim;
  const first = await claim();
  assert.equal(first.task.title, edit.fields.title);
  assert.equal(first.attempt.spec_version, edited.body.version);
  const revised = await command(await get(task), 'edit', {
    fields: { ...edit.fields, criteria: ['Revised review criterion'] },
  });
  assert.equal(revised.status, 200);
  assert.equal(revised.body.task.acceptance.criteria[0].description, 'Artifact is readable');
  assert.equal(revised.body.lifecycle.pending_spec.fields.acceptance.criteria[0].description, 'Revised review criterion');
  const failed = await call({ op: 'report', operation_id: crypto.randomUUID(), task_id: task.task.id,
    attempt_id: first.attempt.id, lease: first.lease, report: { type: 'failed', failure: 'Fixture failure' },
  }, 'worker');
  assert.equal(failed.status, 200);
  assert.equal((await command(failed.body, 'retry', { changed_assumption: 'Use the revised criterion' })).status, 200);
  const second = await claim();
  assert.equal(second.task.acceptance.criteria[0].description, 'Revised review criterion');
  assert.equal(second.attempt.spec_version, revised.body.version);
  assert.equal(second.attempt.revision, first.attempt.revision);
});

test('the runner delivers an exact-attempt addendum at the persisted thread boundary after a lost receipt', async t => {
  const { register, command, call, get } = setup(t);
  const task = await register('Live amendment');
  const dependent = await register('Dependent', [task.task.id]);
  await command(task, 'admit', { executor: 'codex' });
  await command(dependent, 'admit', { executor: 'codex' });
  const claimRequest = () => call({ op: 'claim', operation_id: crypto.randomUUID(), live_addenda: true }, 'worker');
  const { claim } = (await claimRequest()).body;
  assert.equal((await claimRequest()).body.claim, null);
  const workspace = await mkdtemp(join(tmpdir(), 'aads-addendum-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  await mkdir(join(workspace, '.git'));
  const session = crypto.randomUUID();
  const firstTurn = Promise.withResolvers();
  const followup = Promise.withResolvers();
  const deliveryRecorded = Promise.withResolvers();
  const turns = [];
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.kill = () => child.stdout.end();
  const emit = message => child.stdout.write(JSON.stringify(message) + '\n');
  const firstTurnId = crypto.randomUUID();
  const secondTurnId = crypto.randomUUID();
  const unexpectedRpc = [];
  child.stdin = new Writable({ write(chunk, _encoding, done) {
    const { method, id, params } = JSON.parse(chunk.toString());
    const reply = result => emit({ id, result });
    if (method === 'initialize') reply({});
    else if (method === 'thread/start' || method === 'thread/resume') {
      if (method === 'thread/resume' && params.threadId !== session) unexpectedRpc.push('thread identity');
      reply({ thread: { id: session, ephemeral: false }, model: 'fixture', modelProvider: 'fixture',
        sandbox: { type: 'workspaceWrite', networkAccess: false, writableRoots: [] } });
    } else if (method === 'turn/start') {
      if (params.threadId !== session) unexpectedRpc.push('turn identity');
      turns.push(params.input[0].text);
      reply({ turn: { id: turns.length === 1 ? firstTurnId : secondTurnId } });
      (turns.length === 1 ? firstTurn : followup).resolve();
    } else if (method === 'turn/interrupt') {
      reply({});
    } else if (method !== 'initialized') unexpectedRpc.push(method);
    done();
  } });
  const complete = id => emit({ method: 'turn/completed', params: { threadId: session, turn: { id, status: 'completed' } } });
  const usage = (turnId, inputTokens) => emit({ method:'thread/tokenUsage/updated', params:{
    threadId:session, turnId, tokenUsage:{total:{inputTokens,cachedInputTokens:0,outputTokens:10,totalTokens:inputTokens+10}},
  } });
  const connector = openObservatoryConnector({ cwd: workspace, spawnProcess: () => child });
  t.after(() => connector.close());
  const reservations = [];
  const send = async request => {
    const result = await call(request, 'worker');
    if (result.status !== 200) throw Object.assign(Error(result.body.error), { status: result.status });
    if (request.report.type === 'addenda_take') {
      reservations.push(request.operation_id);
      if (reservations.length === 1) throw Error('Fixture disconnected after the durable reservation');
    }
    if (request.report.type === 'addenda_delivered') deliveryRecorded.resolve();
    return result.body;
  };
  const usageReceipts = [];
  const execution = runClaim({ claim, send, workspace, signal: AbortSignal.timeout(6000),
    onTelemetryStart: async () => {}, admitStorage: async () => {},
    onUsage: async receipt => { usageReceipts.push(...receipt.measurements); },
    identify: async () => ({ revision: rev, branch: 'fixture', dirty: false }),
    execute: options => executeAppServer(connector, options),
  });
  const waitFor = promise => Promise.race([promise, execution.then(() => assert.fail('Worker ended before checkpoint'))]);
  await waitFor(firstTurn.promise);
  const addendum = { target: 'active_attempt', attempt_id: claim.attempt.id, text: 'Check the deliverable headings.' };
  const accepted = await command(await get(task), 'addendum', addendum);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.lifecycle.addenda[0].status, 'pending');
  assert.equal((await command(await get(task), 'addendum', addendum, 'agent')).status, 403);
  assert.equal((await command(await get(dependent), 'addendum', addendum)).status, 409);
  usage(firstTurnId,100);
  complete(firstTurnId);
  await waitFor(followup.promise);
  await waitFor(deliveryRecorded.promise);
  const late = await command(await get(task), 'addendum', { ...addendum, text: 'Late supplemental instruction' });
  assert.equal(late.body.lifecycle.addenda[1].status, 'deferred');
  usage(secondTurnId,200);
  complete(secondTurnId);
  await execution;
  assert.deepEqual(usageReceipts.filter(metric=>metric.name==='provider_total_tokens' && metric.method==='fresh_thread_total')
    .map(metric=>metric.value),[210]);
  assert.deepEqual(usageReceipts.filter(metric=>metric.name==='app_server_workspace_turn_ordinal')
    .map(metric=>metric.value),[1,2]);
  assert.deepEqual(unexpectedRpc, []);
  assert.deepEqual(reservations, [reservations[0], reservations[0]]);
  assert.equal(turns.length, 2);
  assert.ok(!turns[0].includes(addendum.text));
  assert.ok(turns[1].includes(addendum.text));
  assert.ok(!turns[1].includes('Late supplemental instruction'));
  const result = await get(task);
  const [delivered] = result.lifecycle.addenda;
  assert.equal(result.lifecycle.state, 'verifying');
  assert.equal(delivered.status, 'acknowledged');
  assert.equal(delivered.session_id, session);
  assert.equal(delivered.turn_id, secondTurnId);
  assert.equal(delivered.spec_version, claim.attempt.spec_version);
  assert.equal(result.events.filter(event => event.kind === 'addenda_take').length, 1);
  assert.equal((await claimRequest()).body.claim, null);
  const revisions = await Promise.all(['First update', 'Second update'].map(title =>
    command(result, 'edit', { fields: { ...fields(title), criteria: ['Criterion for a new review cycle'] } })));
  assert.deepEqual(revisions.map(response => response.status).sort(), [200, 409]);
  const reviewedSpec = await get(task);
  assert.equal(reviewedSpec.task.acceptance.criteria[0].id, task.task.acceptance.criteria[0].id);
  assert.equal((await command(reviewedSpec, 'accept', {
    evidence: [{ criterion_id: reviewedSpec.lifecycle.pending_spec.fields.acceptance.criteria[0].id,
      revision: rev, uri: 'https://example.test/review' }],
  })).status, 409);
  await command(reviewedSpec, 'accept', {
    evidence: [{ criterion_id: task.task.acceptance.criteria[0].id, revision: rev, uri: 'https://example.test/review' }],
  });
  assert.equal((await claimRequest()).body.claim.task.id, dependent.task.id);
});

test('scope observations and storage errors explain worker availability without creating an attempt', async t => {
  const { call, register, command, get, advance } = setup(t);
  const task = await register('Scoped');
  await command(task, 'admit', { executor: 'codex' });
  const pulse = { op: 'worker_pulse', worker_id: crypto.randomUUID(), worker_state: 'available', task_ids: [] };
  assert.equal((await call(pulse)).status, 403);
  await call(pulse, 'worker');
  assert.equal((await get(task)).worker_dispatch.no_matching_worker, true);
  await call({ ...pulse, task_ids: [task.task.id], worker_state: 'storage_guard_timeout' }, 'worker');
  assert.deepEqual((await get(task)).worker_dispatch.states, ['storage_guard_timeout']);
  advance(60_000);
  assert.deepEqual((await get(task)).worker_dispatch.states, []);
  assert.deepEqual((await get(task)).attempts, []);
  await checkWorkerStorage(['fixture', 'budget'], '.', async (_file, _args, options) => assert.equal(options.timeout, 30_000));
  await assert.rejects(checkWorkerStorage(['fixture'], '.', async () => { throw { killed: true }; }), { code: 'storage_guard_timeout' });
});

test('a restarted worker cannot deliver an expired reservation or replay it into a retry', async t => {
  const { call, register, command, get, advance } = setup(t);
  const task = await register('Interrupted delivery');
  const queuedAddendum = await command(task, 'addendum', { target: 'next_attempt', text: 'Keep the evidence link.' });
  await command(queuedAddendum.body, 'admit', { executor: 'codex' });
  const claim = async () => (await call({
    op: 'claim', operation_id: crypto.randomUUID(), live_addenda: true, conversation_continuation: true,
  }, 'worker')).body.claim;
  const first = await claim();
  const session_id = crypto.randomUUID();
  const report = (leased, type, fields = {}) => ({
    op: 'report', task_id: task.task.id, operation_id: crypto.randomUUID(),
    attempt_id: leased.attempt.id, lease: leased.lease, report: { type, session_id, ...fields },
  });
  await call(report(first, 'heartbeat'), 'worker');
  const checkpoint = report(first, 'addenda_take');
  const reserved = await call(checkpoint, 'worker');
  assert.equal(reserved.body.addenda[0].attempt_id, first.attempt.id);
  advance(60_001);
  assert.equal((await call(checkpoint, 'worker')).status, 409);
  const expired = await get(task);
  assert.equal(expired.lifecycle.addenda[0].status, 'deferred');
  assert.match(expired.lifecycle.addenda[0].reason, /could not be confirmed/);
  await command(expired, 'retry', { changed_assumption: 'The replacement worker is available' });
  const retry = await claim();
  assert.equal(retry.attempt.resume_session_id, session_id);
  await call(report(retry, 'heartbeat'), 'worker');
  assert.equal((await call(report(retry, 'addenda_delivered', {
    reservation_id: checkpoint.operation_id, turn_id: crypto.randomUUID(),
  }), 'worker')).status, 409);
  assert.deepEqual((await call(report(retry, 'addenda_take'), 'worker')).body.addenda, []);
});

test('legacy and Codex-created Tasks share one identity and versioned writes', async t => {
  const { sqlite, call, register, command, get } = setup(t);
  const legacy = proposedTask(fields('legacy'), rev);
  sqlite.prepare('INSERT INTO proposals(owner_id,namespace,task_id,created_at,record) VALUES (?,?,?,?,?)')
    .run('owner-1', 'live', legacy.id, legacy.created_at, JSON.stringify(legacy));
  const existing = await get({ task: legacy });
  assert.equal(existing.task.id, legacy.id);
  assert.equal(existing.lifecycle.state, 'proposed');
  const created = await register('new');
  const edit = { op: 'command', task_id: created.task.id, expected_version: created.version,
    operation_id: crypto.randomUUID(), action: { type: 'edit', fields: { ...fields('edited'), priority: 'urgent' } } };
  assert.equal((await call(edit, 'agent', 'other')).status, 404);
  assert.equal((await call(edit, 'agent')).body.priority, 'urgent');
  assert.equal((await call(edit, 'agent')).body.events.length, 2);
  assert.equal((await call({ ...edit, operation_id: crypto.randomUUID() }, 'agent')).status, 409);
  assert.equal((await command(created, 'admit', {}, 'agent')).status, 403);
  assert.equal((await command(await get(created), 'archive')).body.lifecycle.state, 'archived');
});

test('verified dependency gates, independent claims, leases and retry safety', async t => {
  const { call, register, command, get, advance } = setup(t);
  const a = await register('A');
  const b = await register('B', [a.task.id]);
  const c = await register('C');
  assert.equal((await command(a, 'edit', { fields: { ...fields('A'), priority: 'high', dependencies: [b.task.id] } })).status, 409);
  for (const task of [a, b, c]) {
    assert.equal((await command(task, 'admit', { executor: 'codex' })).status, 200);
  }
  const claim = () => call({ op: 'claim', operation_id: crypto.randomUUID() }, 'worker');
  const raced = await Promise.all([claim(), claim()]);
  assert.ok(raced.every(response => [200, 409].includes(response.status)));
  const claimed = raced.map(response => response.body.claim).filter(Boolean);
  assert.ok(claimed.length > 0);
  if (claimed.length === 1) claimed.push((await claim()).body.claim);
  assert.deepEqual(new Set(claimed.map(item => item.task.id)), new Set([a.task.id, c.task.id]));
  assert.equal((await get(b)).lifecycle.state, 'blocked');
  const active = claimed.find(item => item.task.id === a.task.id);
  const report = (item, type, extra = {}) => call({ op: 'report', task_id: item.task.id,
    operation_id: crypto.randomUUID(), attempt_id: item.attempt.id, lease: item.lease, report: { type, ...extra } }, 'worker');
  assert.equal((await report(active, 'finished', { result: 'candidate', revision: rev })).body.lifecycle.state, 'verifying');
  assert.equal((await get(b)).lifecycle.state, 'blocked');
  assert.equal((await command(await get(a), 'accept', { evidence: [] })).status, 409);
  const decision = { evidence: [{ criterion_id: 'criterion-1', uri: 'https://github.com/Kgray44/Aetherwake/actions/runs/1', revision: rev }] };
  assert.equal((await command(await get(a), 'accept', decision, 'agent')).status, 403);
  assert.equal((await command(await get(a), 'accept', decision)).body.lifecycle.state, 'completed');
  assert.equal((await get(b)).lifecycle.state, 'ready');
  const downstream = (await claim()).body.claim;
  assert.equal(downstream.task.id, b.task.id);
  advance(70_000);
  assert.equal((await claim()).body.claim, null);
  assert.equal((await get(b)).lifecycle.state, 'failed');
  assert.equal((await report(downstream, 'finished', { result: 'candidate', revision: rev })).status, 409);
});

test('four concurrent claims fence a fifth until an active attempt releases its slot', async t => {
  const { call, register, command } = setup(t);
  for (let i = 0; i < 5; i++) {
    const task = await register('capacity ' + i);
    assert.equal((await command(task, 'admit', { executor:'codex' })).status, 200);
  }
  const claim = () => call({ op:'claim', operation_id:crypto.randomUUID() }, 'worker');
  const first = (await claim()).body.claim;
  assert.ok(first);
  assert.ok((await claim()).body.claim);
  assert.ok((await claim()).body.claim);
  const lastSlot = await Promise.all([claim(), claim()]);
  assert.equal(lastSlot.filter(result => result.body.claim).length, 1);
  assert.deepEqual((await claim()).body, { claim:null, dispatch_state:'busy' });
  const { tasks:before, worker_dispatch:dispatch } = (await call({ op:'list' })).body;
  assert.equal(dispatch.active_slots, 4);
  assert.equal(dispatch.total_slots, 4);
  const waiting = before.filter(item => item.lifecycle.state === 'ready');
  assert.equal(waiting.length, 1);
  assert.equal(before.filter(item => item.lifecycle.state === 'running').length, 4);
  assert.equal((await call({
    op:'report', operation_id:crypto.randomUUID(), task_id:first.task.id, attempt_id:first.attempt.id, lease:first.lease,
    report:{ type:'finished', result:'candidate', revision:rev },
  }, 'worker')).status, 200);
  assert.equal((await claim()).body.claim.task.id, waiting[0].task.id);
});

test('owner can submit a checked recovered candidate without replaying execution or accepting it', async t=>{
  const {call,register,command,get,advance}=setup(t);
  const task=await register('recover orphan');
  const dependent=await register('downstream',[task.task.id]);
  await command(task,'admit',{executor:'codex'});
  await command(dependent,'admit',{executor:'codex'});
  const {body:{claim}}=await call({op:'claim',operation_id:crypto.randomUUID()},'worker');
  advance(65_000);
  const orphan=await get(task);
  assert.equal(orphan.attempts[0].state,'orphaned');
  const decision={attempt_id:claim.attempt.id,revision:'b'.repeat(40),reason:'Verified the preserved checkout against the pinned base.'};
  assert.equal((await command(orphan,'recover_candidate',decision,'agent')).status,403);
  assert.equal((await command(orphan,'recover_candidate',{...decision,attempt_id:'different'})).status,409);
  assert.equal((await command(orphan,'recover_candidate',{...decision,revision:rev})).status,409);
  const recovered=(await command(orphan,'recover_candidate',decision)).body;
  assert.equal(recovered.lifecycle.stored_state,'verifying');
  assert.equal(recovered.lifecycle.recovered_candidate,true);
  assert.equal(recovered.task.owner_acceptance,'not_reviewed');
  assert.equal(recovered.attempts[0].candidate_origin,'recovered');
  assert.equal(recovered.attempts[0].candidate_revision,decision.revision);
  assert.equal(recovered.events.at(-1).previous_failure,orphan.attempts[0].failure);
  assert.equal(recovered.events.at(-1).attempt_id,claim.attempt.id);
  assert.ok(recovered.events.some(event=>event.kind==='lease_expired'));
  assert.equal((await get(dependent)).lifecycle.state,'blocked');
  assert.equal((await command(recovered,'recover_candidate',decision)).status,409);
});

test('archive keeps accepted prerequisites and feedback reopens at the accepted revision', async t => {
  const {call,register,command,get}=setup(t);
  const task=await register('follow-up');
  const downstream=await register('dependent',[task.task.id]);
  assert.equal((await command(task,'reopen',{feedback:'Missing prerequisite'})).status,409);
  const admit=item=>command(item,'admit',{executor:'codex',cancel_with_dependency:true});
  await admit(task);
  await admit(downstream);
  const claim=(continuation=false)=>call({op:'claim',operation_id:crypto.randomUUID(),task_ids:[task.task.id],conversation_continuation:continuation},'worker');
  const first=(await claim()).body.claim;
  const session=crypto.randomUUID();
  const candidate='b'.repeat(40);
  const reported=await call({op:'report',task_id:task.task.id,operation_id:crypto.randomUUID(),
    attempt_id:first.attempt.id,lease:first.lease,report:{type:'finished',result:'candidate',revision:candidate,session_id:session}},'worker');
  assert.equal(reported.status,200);
  const evidence=[{criterion_id:'criterion-1',uri:'https://github.com/Kgray44/Aetherwake/actions/runs/1',revision:candidate}];
  const accepted=(await command(reported.body,'accept',{evidence})).body;
  assert.equal(accepted.lifecycle.stored_state,'completed');
  const archived=(await command(accepted,'archive')).body;
  assert.equal(archived.lifecycle.stored_state,'archived');
  assert.equal((await get(downstream)).lifecycle.state,'ready');
  assert.equal((await call({op:'list'})).body.tasks.some(entry=>entry.task.id===task.task.id),false);
  assert.equal((await call({op:'list',include_archived:true})).body.tasks.find(entry=>entry.task.id===task.task.id).lifecycle.state,'archived');
  assert.equal((await command(archived,'reopen',{feedback:'  '})).status,400);
  assert.equal((await command(archived,'reopen',{feedback:'Unapproved'},'agent')).status,403);
  const feedback='Add a verification receipt for the new behavior.';
  const reopened=(await command(archived,'reopen',{feedback})).body;
  assert.equal(reopened.task.id,task.task.id);
  assert.equal(reopened.task.objective,task.task.objective);
  assert.equal(reopened.task.owner_acceptance,'not_reviewed');
  assert.equal(reopened.lifecycle.stored_state,'queued');
  assert.equal(reopened.lifecycle.cycle_attempts,0);
  assert.deepEqual(reopened.lifecycle.evidence,[]);
  assert.equal(reopened.attempts[0].state,'succeeded');
  assert.deepEqual(reopened.events.find(event=>event.kind==='accept').evidence,evidence);
  assert.deepEqual(reopened.events.find(event=>event.kind==='reopen').evidence,evidence);
  assert.equal(reopened.events.find(event=>event.kind==='reopen').feedback,feedback);
  assert.equal((await claim()).body.claim,null);
  const next=(await claim(true)).body.claim;
  assert.equal(next.attempt.attempt_number,2);
  assert.equal(next.attempt.resume_session_id,session);
  assert.equal(next.attempt.resume_requires_clean,true);
  assert.equal(next.attempt.revision,candidate);
  assert.ok(next.task.objective.endsWith(feedback));
});

test('the owner can continue a partial candidate at the cycle limit without accepting it or replaying its lease', async t => {
  const {call,register,command,get}=setup(t);
  const task=await register('Long-running implementation');
  await command(task,'admit',{executor:'codex'});
  const claim=(continuation=false)=>call({op:'claim',operation_id:crypto.randomUUID(),
    task_ids:[task.task.id],conversation_continuation:continuation,separate_execution_notes:true},'worker');
  const report=(lease, fields)=>call({op:'report',task_id:task.task.id,operation_id:crypto.randomUUID(),
    attempt_id:lease.attempt.id,lease:lease.lease,report:fields},'worker');
  for (let i=0;i<2;i++) {
    const prior=(await claim()).body.claim;
    assert.equal((await report(prior,{type:'failed',failure:'Fixture provisioning failure'})).status,200);
    assert.equal((await command(await get(task),'retry',{changed_assumption:'Fixed fixture preflight '+i})).status,200);
  }
  const old=(await claim()).body.claim;
  const session=crypto.randomUUID(), revision='b'.repeat(40), branch='codex/aads-task-fixture';
  assert.equal((await report(old,{type:'finished',result:'candidate',revision,session_id:session,branch})).status,200);
  const reviewing=await get(task);
  assert.equal(reviewing.lifecycle.cycle_attempts,3);
  assert.equal(reviewing.lifecycle.can_continue_candidate,true);
  const action={attempt_id:old.attempt.id,revision,feedback:'Finish publication and verify the hosted merge path.'};
  assert.equal((await command(reviewing,'continue_candidate',action,'agent')).status,403);
  assert.equal((await command(reviewing,'continue_candidate',{...action,revision:rev})).status,409);
  const continued=await command(reviewing,'continue_candidate',action);
  assert.equal(continued.status,200);
  assert.equal(continued.body.task.id,task.task.id);
  assert.equal(continued.body.task.objective,task.task.objective);
  assert.equal(continued.body.task.owner_acceptance,'not_reviewed');
  assert.equal(continued.body.lifecycle.cycle_attempts,0);
  assert.equal(continued.body.lifecycle.can_continue_candidate,false);
  assert.equal(continued.body.attempts.at(-1).state,'checkpointed');
  assert.equal(continued.body.attempts.at(-1).candidate_revision,revision);
  assert.equal(continued.body.events.at(-1).attempt_id,old.attempt.id);
  assert.equal(continued.body.events.at(-1).revision,revision);
  assert.equal((await command(reviewing,'continue_candidate',action)).status,409);
  assert.equal((await report(old,{type:'heartbeat'})).status,409);
  assert.equal((await claim()).body.claim,null);
  const next=(await claim(true)).body.claim;
  assert.equal(next.attempt.attempt_number,4);
  assert.equal(next.attempt.revision,revision);
  assert.equal(next.attempt.resume_session_id,session);
  assert.equal(next.attempt.branch,branch);
  assert.equal(next.attempt.resume_requires_clean,true);
  assert.ok(next.execution_notes[0].endsWith(action.feedback));
  assert.equal((await claim(true)).body.claim,null);
  assert.equal((await report(old,{type:'heartbeat'})).status,409);
  assert.equal((await report(next,{type:'heartbeat',session_id:session,branch:'codex/other'})).status,400);
});

test('only the original worker recovery proof can return an expired candidate to verification', async t => {
  const {call,register,command,get,advance}=setup(t);
  const task=await register('Restart after candidate checkpoint');
  await command(task,'admit',{executor:'codex'});
  const recoveryKey='a'.repeat(64);
  const recovery_commitment=createHash('sha256').update(recoveryKey).digest('hex');
  const claim=(await call({op:'claim',operation_id:crypto.randomUUID(),recovery_commitment},'worker')).body.claim;
  assert.equal(claim.attempt.recovery_commitment,undefined);
  const session=crypto.randomUUID(), branch='codex/aads-task-fixture';
  const heartbeat={op:'report',task_id:task.task.id,attempt_id:claim.attempt.id,
    operation_id:crypto.randomUUID(),lease:claim.lease,report:{type:'heartbeat',session_id:session,branch}};
  assert.equal((await call(heartbeat,'worker')).status,200);
  const body={op:'recover_worker_candidate',task_id:task.task.id,attempt_id:claim.attempt.id,
    operation_id:crypto.randomUUID(),candidate_recovery:{key:recoveryKey,revision:'b'.repeat(40),session_id:session,branch}};
  assert.equal((await call(body,'worker')).status,409);
  advance(61_000);
  const orphan=await get(task);
  assert.equal(orphan.attempts.at(-1).state,'orphaned');
  assert.equal(orphan.attempts.at(-1).recovery_commitment,undefined);
  assert.equal((await call(body)).status,403);
  assert.equal((await call({...body,candidate_recovery:{...body.candidate_recovery,key:'c'.repeat(64)}},'worker')).status,409);
  assert.equal((await call({...body,candidate_recovery:{...body.candidate_recovery,branch:'codex/other'}},'worker')).status,409);
  const results=await Promise.all([call(body,'worker'),call(body,'worker')]);
  assert.ok(results.some(result=>result.status===200));
  assert.equal((await call(body,'worker')).status,200);
  const recovered=await get(task);
  assert.equal(recovered.lifecycle.stored_state,'verifying');
  assert.equal(recovered.task.owner_acceptance,'not_reviewed');
  assert.equal(recovered.attempts.length,1);
  assert.equal(recovered.attempts[0].candidate_revision,body.candidate_recovery.revision);
  assert.equal(recovered.events.filter(event=>event.kind===body.op).length,1);
  assert.equal((await call({...heartbeat,operation_id:crypto.randomUUID()},'worker')).status,409);
});

test('an owner retry resumes the exact dirty checkout after the recorded processes exit', {timeout:20000}, async t => {
  const {call,register,command,get,advance,pin}=setup(t);
  const temp=await realpath(tmpdir());
  const root=await realpath(await mkdtemp(join(temp,'aads-dirty-retry-')));
  assert.equal(dirname(root),temp);
  t.after(()=>rm(root,{recursive:true,force:true}));
  const workspace=join(root,'checkout'), telemetryDirectory=join(root,'journal');
  await mkdir(workspace);
  await mkdir(telemetryDirectory);
  const branch='codex/aads-task-interrupted';
  const git=async (...args)=>(await promisify(execFile)('git',args,{cwd:workspace,windowsHide:true})).stdout.trim();
  await git('init','-b',branch);
  await git('remote','add','origin','https://github.com/Kgray44/Aetherwake.git');
  await git('config','user.name','Fixture');
  await git('config','user.email','worker@example.test');
  await git('-c','commit.gpgsign=false','commit','--allow-empty','-m','Pinned source');
  const revision=await git('rev-parse','HEAD');
  pin(revision);
  const task=await register('Resume interrupted checkout');
  await command(task,'admit',{executor:'codex'});
  const recoveryKey='a'.repeat(64);
  const recovery_commitment=createHash('sha256').update(recoveryKey).digest('hex');
  const {body:{claim}}=await call({op:'claim',operation_id:crypto.randomUUID(),recovery_commitment},'worker');
  const session_id=crypto.randomUUID();
  const report={op:'report',task_id:task.task.id,attempt_id:claim.attempt.id,
    operation_id:crypto.randomUUID(),lease:claim.lease,report:{type:'heartbeat',session_id,branch}};
  assert.equal((await call(report,'worker')).status,200);
  const previousWorker=spawn(process.execPath,['-e',''],{windowsHide:true});
  const previousProvider=spawn(process.execPath,['-e','setInterval(() => {}, 1000)'],{windowsHide:true});
  const providerExited=once(previousProvider,'exit');
  t.after(async()=>{
    previousProvider.kill();
    await providerExited;
  });
  await once(previousWorker,'exit');
  const lock=join(workspace,'.git','aads-task-worker.lock');
  await mkdir(lock);
  await writeFile(join(lock,createHash('sha256').update(claim.attempt.id).digest('hex')),'');
  await writeFile(join(workspace,'retained.txt'),'Saved before the interruption.');
  await writeFile(join(telemetryDirectory,'active-'+claim.attempt.id+'.json'),JSON.stringify({
    host:hostname(),taskId:task.task.id,attemptId:claim.attempt.id,revision,workspace,branch,
    sessionId:session_id,turnId:crypto.randomUUID(),recoveryKey,pid:previousWorker.pid,providerPid:previousProvider.pid,
  }));
  advance(61_000);
  const orphan=await get(task);
  assert.equal(orphan.attempts[0].state,'orphaned');
  await reconcileAbandonedClaim({directory:telemetryDirectory,taskId:task.task.id,readTask:()=>get(task)});
  assert.ok(existsSync(join(telemetryDirectory,'interrupted-'+claim.attempt.id+'.json')));
  const claimAgain=()=>call({op:'claim',operation_id:crypto.randomUUID(),conversation_continuation:true},'worker');
  assert.equal((await claimAgain()).body.claim,null);
  assert.equal((await command(orphan,'retry',{changed_assumption:'Verify retained process custody.'})).status,200);
  const resumed=(await claimAgain()).body.claim;
  assert.equal(resumed.attempt.resume_requires_clean,true);
  assert.equal(resumed.attempt.resume_session_id,session_id);
  assert.deepEqual(resumed.interrupted_checkout,{attempt_id:claim.attempt.id,recovery_commitment,branch});
  assert.equal((await get(task)).attempts.at(-1).recovery_commitment,undefined);
  let executions=0;
  // Exercise the local preflight with an isolated report transport. The
  // canonical lease below remains usable once this fixture's provider exits.
  async function assertRefusesToUnlock(failureKind) {
    const denied=[];
    const trial={...resumed,attempt:{...resumed.attempt,id:'attempt_'+crypto.randomUUID()}};
    await runClaim({claim:trial,workspace,telemetryDirectory,signal:AbortSignal.timeout(12000),admitStorage:async()=>{},
      send:async ({report})=>{
        denied.push(report);
        return {lifecycle:{state:report.type==='failed'?'failed':'running'}};
      },
      execute:async ()=>{executions++;return {ok:false};}});
    assert.equal(executions,0);
    assert.equal(denied.at(-1).failure_kind,failureKind);
    assert.ok(existsSync(join(lock,createHash('sha256').update(claim.attempt.id).digest('hex'))));
  }
  await assertRefusesToUnlock('checkout');
  previousProvider.kill();
  await providerExited;
  await assertRefusesToUnlock('lease');
  await runClaim({claim:resumed,workspace,telemetryDirectory,signal:AbortSignal.timeout(12000),admitStorage:async()=>{},
    send:async request=>(await call(request,'worker')).body,
    execute:async ({onSession})=>{
      executions++;
      await onSession(session_id);
      assert.equal(readFileSync(join(workspace,'retained.txt'),'utf8'),'Saved before the interruption.');
      return {ok:true};
    }});
  assert.equal(executions,1);
  const saved=await get(task);
  assert.equal(saved.lifecycle.stored_state,'verifying');
  assert.equal(saved.task.owner_acceptance,'not_reviewed');
  assert.equal((await call({...report,operation_id:crypto.randomUUID()},'worker')).status,409);
  assert.equal(await git('show','HEAD:retained.txt'),'Saved before the interruption.');
});

test('the real worker can be killed before its terminal report and reconcile through the Task Engine on Windows', {timeout:20000}, async t => {
  const {call,register,command,get,pin,advance}=setup(t);
  const root=await realpath(await mkdtemp(join(tmpdir(),'aads-terminal-restart-')));
  let child,closed;
  t.after(async()=>{
    if (child&&child.exitCode===null&&!child.signalCode) child.kill();
    await closed;
    await rm(root,{recursive:true,force:true});
  });
  const workspace=join(root,'checkout'), telemetryDirectory=join(root,'worker');
  await mkdir(workspace);
  const git=async (...args)=>(await promisify(execFile)('git',args,{cwd:workspace,windowsHide:true})).stdout.trim();
  await git('init','-b','codex/aads-task-candidate-restart');
  await git('remote','add','origin','https://github.com/Kgray44/Aetherwake.git');
  await git('config','user.name','Fixture');
  await git('config','user.email','worker@example.test');
  await git('-c','commit.gpgsign=false','commit','--allow-empty','-m','Pinned source');
  const revision=await git('rev-parse','HEAD');
  pin(revision);
  const task=await register('Interrupted candidate report');
  await command(task,'admit',{executor:'codex'});
  const recoveryKey='b'.repeat(64);
  const recovery_commitment=createHash('sha256').update(recoveryKey).digest('hex');
  const {body:{claim}}=await call({op:'claim',operation_id:crypto.randomUUID(),recovery_commitment},'worker');
  const session=crypto.randomUUID();
  const workerModule=new URL('../../../scripts/agent/observatory-task-worker.mjs',import.meta.url).href;
  const fixture=`
    import {writeFile} from 'node:fs/promises';
    import {join} from 'node:path';
    import {runClaim} from ${JSON.stringify(workerModule)};
    const init=${JSON.stringify({claim,workspace,telemetryDirectory,recoveryKey})};
    const pending=new Map();
    process.on('message', ({id,result})=>pending.get(id)?.(result));
    const send=request=>new Promise(resolve=>{
      pending.set(request.operation_id,resolve);
      process.send(request);
    });
    await runClaim({...init,send,signal:AbortSignal.timeout(15000),admitStorage:async()=>{},
      execute:async ({onSession,onTurnStarted,onTurnFinished})=>{
        await onSession(${JSON.stringify(session)});
        await onTurnStarted('fixture-turn');
        await writeFile(join(init.workspace,'result.txt'),'A complete checkpoint.');
        await onTurnFinished('completed');
        return {ok:true};
      }});
  `;
  child=spawn(process.execPath,['--input-type=module','--eval',fixture],{
    cwd:root,stdio:['ignore','ignore','inherit','ipc'],windowsHide:true});
  closed=once(child,'close');
  const terminal=Promise.withResolvers();
  child.on('message',request=>{
    if (request.report.type==='finished') terminal.resolve(request);
    else {
      void call(request,'worker').then(result=>{
        if (child.connected) child.send({id:request.operation_id,result:result.body},error=>{
          if (error&&child.connected) terminal.reject(error);
        });
      },terminal.reject);
    }
  });
  const missed=await Promise.race([terminal.promise,closed.then(()=>{throw Error('Worker exited before the terminal checkpoint');})]);
  assert.equal((await get(task)).lifecycle.stored_state,'running');
  child.kill('SIGKILL');
  await closed;
  advance(61_000);
  assert.equal((await get(task)).attempts[0].state,'orphaned');
  let recoveries=0;
  const recovery={directory:telemetryDirectory,taskId:task.task.id,readTask:()=>get(task),recoverCandidate:async marker=>{
    assert.equal(marker.candidateRevision,missed.report.revision);
    assert.equal(marker.terminalOperationId,missed.operation_id);
    const lock=join(workspace,'.git','aads-task-worker.lock');
    assert.equal(existsSync(lock),true);
    assert.equal(await prepareRecoveredCandidate(workspace,marker),true);
    assert.equal(existsSync(lock),false);
    await mkdir(lock);
    const otherOwner=join(lock,createHash('sha256').update(crypto.randomUUID()).digest('hex'));
    await writeFile(otherOwner,'');
    assert.equal(await prepareRecoveredCandidate(workspace,marker),false);
    assert.equal(existsSync(otherOwner),true);
    await unlink(otherOwner);
    await rmdir(lock);
    recoveries++;
    const result=await call({op:'recover_worker_candidate',task_id:task.task.id,attempt_id:marker.attemptId,
      operation_id:marker.recoveryOperationId,candidate_recovery:{key:marker.recoveryKey,revision:marker.candidateRevision,
        session_id:marker.sessionId,branch:marker.branch}},'worker');
    return result.status===200 && result.body.attempts[0].candidate_revision===marker.candidateRevision;
  }};
  await reconcileAbandonedClaim(recovery);
  await reconcileAbandonedClaim(recovery);
  assert.equal(recoveries,1);
  const saved=await get(task);
  assert.equal(saved.lifecycle.stored_state,'verifying');
  assert.equal(saved.task.owner_acceptance,'not_reviewed');
  assert.equal(saved.attempts.length,1);
  assert.equal(await git('rev-parse','HEAD'),missed.report.revision);
  assert.equal(readFileSync(join(workspace,'result.txt'),'utf8'),'A complete checkpoint.');
  assert.equal((await call(missed,'worker')).status,409);
  assert.equal((await command(saved,'continue_candidate',{attempt_id:claim.attempt.id,
    revision:missed.report.revision,feedback:'Continue from the saved checkpoint.'})).status,200);
  const {body:{claim:next}}=await call({op:'claim',operation_id:crypto.randomUUID(),conversation_continuation:true},'worker');
  assert.equal(next.attempt.resume_session_id,session);
  assert.equal(next.attempt.revision,missed.report.revision);
  assert.equal(existsSync(join(workspace,'.git','aads-task-worker.lock')),false);
});

test('candidate recovery respects owner cancellation and a replacement attempt', async t => {
  const {call,register,command,get,advance}=setup(t);
  const recoveryKey='a'.repeat(64);
  const recovery_commitment=createHash('sha256').update(recoveryKey).digest('hex');
  for (const ownerAction of ['cancel','retry']) {
    const task=await register('Recovery fence '+ownerAction);
    await command(task,'admit',{executor:'codex'});
    const next=()=>call({op:'claim',operation_id:crypto.randomUUID(),recovery_commitment,task_ids:[task.task.id]},'worker');
    const claim=(await next()).body.claim;
    const session=crypto.randomUUID(),branch='codex/aads-task-fixture';
    await call({op:'report',task_id:task.task.id,attempt_id:claim.attempt.id,operation_id:crypto.randomUUID(),
      lease:claim.lease,report:{type:'heartbeat',session_id:session,branch}},'worker');
    if (ownerAction==='cancel') assert.equal((await command(await get(task),'cancel')).status,200);
    advance(61_000);
    const orphan=await get(task);
    if (ownerAction==='retry') {
      assert.equal((await command(orphan,'retry',{changed_assumption:'Use the owner-approved replacement execution'})).status,200);
      assert.notEqual((await call({op:'claim',operation_id:crypto.randomUUID(),conversation_continuation:true,
        task_ids:[task.task.id]},'worker')).body.claim.attempt.id,claim.attempt.id);
    }
    const recovered=await call({op:'recover_worker_candidate',task_id:task.task.id,attempt_id:claim.attempt.id,
      operation_id:crypto.randomUUID(),candidate_recovery:{key:recoveryKey,revision:'b'.repeat(40),session_id:session,branch}},'worker');
    assert.equal(recovered.status,409);
  }
});

test('owner can request another round from the exact pending candidate and then accept without URLs', async t => {
  const {call,register,command,get}=setup(t);
  const task=await register('simple owner review');
  await command(task,'admit',{executor:'codex'});
  const claim=async()=> (await call({op:'claim',operation_id:crypto.randomUUID(),
    task_ids:[task.task.id],conversation_continuation:true},'worker')).body.claim;
  const session=crypto.randomUUID();
  const finish=(item,revision)=>call({op:'report',task_id:task.task.id,operation_id:crypto.randomUUID(),
    attempt_id:item.attempt.id,lease:item.lease,report:{type:'finished',result:'candidate',revision,session_id:session,branch:'codex/aads-task-review'}},'worker');
  const firstRevision='b'.repeat(40);
  const first=(await finish(await claim(),firstRevision)).body;
  assert.equal((await command(first,'accept',{revision:rev})).status,409);
  assert.equal((await command(first,'accept',{revision:firstRevision},'agent')).status,403);
  assert.equal((await command(first,'reopen',{revision:firstRevision,feedback:'  '})).status,400);
  const feedback='Check the updated API output and add a link.';
  const rerun={revision:firstRevision,feedback};
  assert.equal((await command(first,'reopen',{...rerun,revision:rev})).status,409);
  assert.equal((await command(first,'reopen',rerun,'agent')).status,403);
  const queued=(await command(first,'reopen',rerun)).body;
  assert.equal(queued.lifecycle.stored_state,'queued');
  assert.equal(queued.lifecycle.cycle_attempts,1);
  assert.equal(queued.task.owner_acceptance,'not_reviewed');
  assert.equal(queued.events.at(-1).feedback,feedback);
  assert.equal(queued.events.at(-1).previous_state,'verifying');
  const next=await claim();
  assert.equal(next.attempt.resume_session_id,session);
  assert.equal(next.attempt.revision,firstRevision);
  assert.equal(next.attempt.branch,'codex/aads-task-review');
  assert.equal(next.attempt.attempt_number,2);
  assert.ok(next.task.objective.endsWith(feedback));

  const revision='c'.repeat(40);
  const second=(await finish(next,revision)).body;
  const receipt={revision,notes:'   Reviewed the result. https://example.test/test-report   '};
  const accepted=(await command(second,'accept',receipt)).body;
  assert.equal(accepted.lifecycle.stored_state,'completed');
  assert.equal(accepted.task.owner_acceptance,'accepted');
  assert.equal(accepted.events.at(-1).actor,'owner');
  assert.equal(accepted.events.at(-1).notes,receipt.notes.trim());
  assert.deepEqual((await get(task)).lifecycle.evidence,[
    {criterion_id:'criterion-1',revision,attested:true},
  ]);
});

test('versioned Task scope reaches the Codex worker with its input references and outcomes', async t => {
  const {call,register,command}=setup(t);
  const task=await register('task scope');
  const requirements=[{kind:'artifact',uri:'private-artifact:received-sample',revision:rev}];
  const deliverables=['Sample verification report','Candidate implementation'];
  const changed=await command(task,'edit',{fields:{...fields('task scope'),priority:'normal',requirements,deliverables}});
  assert.equal(changed.status,200);
  assert.deepEqual(changed.body.task.requirements,requirements);
  assert.deepEqual(changed.body.task.deliverables,deliverables);
  assert.deepEqual(changed.body.events.at(-1).fields,['requirements','deliverables']);
  await command(changed.body,'admit',{executor:'codex'});
  const {claim}=(await call({op:'claim',operation_id:crypto.randomUUID()},'worker')).body;
  assert.deepEqual(claim.task.deliverables,deliverables);
  assert.deepEqual(claim.task.requirements,requirements);
  const prompt=codexTaskPrompt(claim.task,claim.attempt);
  assert.ok(prompt.includes(requirements[0].uri));
  assert.ok(deliverables.every(item=>prompt.includes(item)));
});

test('failure reports retain a known category in the attempt and audit', async t => {
  const {call,register,command,get}=setup(t);
  const item=await register('Classified executor failure');
  await command(item,'admit',{executor:'codex'});
  const {claim}=(await call({op:'claim',operation_id:crypto.randomUUID()},'worker')).body;
  const failure={type:'failed',failure:'The provider reported an interrupted turn.'};
  const report=failure_kind=>call({op:'report',task_id:item.task.id,attempt_id:claim.attempt.id,
    operation_id:crypto.randomUUID(),lease:claim.lease,report:{...failure,failure_kind}},'worker');
  assert.equal((await report('arbitrary_remote_message')).status,400);
  assert.equal((await report('provider')).status,200);
  const result=await get(item);
  const attempt=result.attempts.at(-1);
  assert.equal(attempt.failure_kind,'provider');
  assert.equal(result.events.at(-1).failure_kind,'provider');
  assert.equal(taskAttemptRecord(result.task,attempt).failure_category,'environment');
});

test('owner time limits constrain the claim deadline and leave a specific receipt at expiry', async t => {
  const {call,register,command,get,advance}=setup(t);
  const task=await register('time limit');
  const admit=minutes=>command(task,'admit',{executor:'codex',max_attempt_minutes:minutes});
  for (const invalid of [0,31,1.5,'5',null]) assert.equal((await admit(invalid)).status,400);
  const admitted=await admit(1);
  assert.equal(admitted.status,200);
  assert.equal(admitted.body.lifecycle.max_attempt_minutes,1);
  assert.equal(admitted.body.events.at(-1).max_attempt_minutes,1);
  const {claim}=(await call({op:'claim',operation_id:crypto.randomUUID()},'worker')).body;
  assert.equal(claim.attempt.deadline-Date.parse(claim.attempt.started_at),60_000);
  assert.equal(claim.attempt.lease_until,claim.attempt.deadline);
  advance(59_999);
  assert.equal((await get(task)).lifecycle.state,'running');
  advance(1);
  const expired=await get(task);
  assert.equal(expired.lifecycle.state,'failed');
  assert.match(expired.attempts[0].failure,/time limit reached/i);
  assert.equal(expired.events.at(-1).kind,'attempt_time_limit_reached');
  const unattended=await register('lost contact');
  const longer=await command(unattended,'admit',{executor:'codex',max_attempt_minutes:2});
  assert.equal(longer.status,200);
  await call({op:'claim',operation_id:crypto.randomUUID()},'worker');
  advance(120_000);
  const lost=await get(unattended);
  assert.equal(lost.events.at(-1).kind,'lease_expired');
});

test('prerequisite readback distinguishes a missing reference from an unattested capability',async t=>{
  const {call,register,command,get}=setup(t);
  const upstream=await register('unaccepted dependency');
  const missing='task_'+crypto.randomUUID();
  const downstream=(await call({op:'register',operation_id:crypto.randomUUID(),fields:{
    ...fields('prerequisites'),dependencies:[upstream.task.id,missing],capabilities:['artifact access'],
  }})).body;
  const status=(detail,id)=>detail.lifecycle.prerequisite_status.find(row=>row.id===id).status;
  assert.equal(status(downstream,upstream.task.id),'unsatisfied');
  assert.equal(status(downstream,missing),'unverified');
  assert.equal(status(downstream,'artifact access'),'unverified');
  const ready=(await command(downstream,'admit',{executor:'codex',prerequisites:['artifact access']})).body;
  assert.equal(status(await get(ready),'artifact access'),'satisfied');
  assert.equal(ready.lifecycle.state,'blocked');
  assert.deepEqual(ready.lifecycle.blockers.map(row=>row.id),[upstream.task.id,missing]);
});

test('owners can reschedule waiting work without changing an active attempt',async t=>{
  const {call,register,command,get,advance}=setup(t);
  const proposed=await register('editable runtime settings');
  const admission=(await command(proposed,'admit',{executor:'codex',max_attempt_minutes:5,
    start_at:new Date(Date.now()+300_000).toISOString()})).body;
  assert.equal(admission.lifecycle.can_configure_execution,true);
  assert.equal((await command(admission,'configure_execution',{max_attempt_minutes:4},'agent')).status,403);
  const waiting=(await command(admission,'pause')).body;
  const change={start_at:new Date(Date.now()+900_000).toISOString(),max_attempt_minutes:4,cancel_with_dependency:true};
  assert.equal((await command(admission,'configure_execution',change)).status,409);
  const saved=(await command(waiting,'configure_execution',change)).body;
  assert.equal(saved.lifecycle.state,'paused');
  assert.equal(saved.lifecycle.start_at,Date.parse(change.start_at));
  assert.equal(saved.events.at(-1).cancel_with_dependency,true);
  const resumed=(await command(saved,'resume')).body;
  assert.equal(resumed.lifecycle.state,'scheduled');
  const claim=()=>call({op:'claim',operation_id:crypto.randomUUID()},'worker').then(result=>result.body.claim);
  advance(600_000);
  assert.equal(await claim(),null);
  const ready=(await command(resumed,'configure_execution',{start_at:null})).body;
  assert.equal(ready.lifecycle.state,'ready');
  const active=await claim();
  assert.equal(active.attempt.deadline-Date.parse(active.attempt.started_at),240_000);
  const actual=await get(proposed);
  assert.equal(actual.lifecycle.can_configure_execution,false);
  assert.equal((await command(actual,'configure_execution',{max_attempt_minutes:30})).status,409);
  assert.equal((await get(proposed)).attempts[0].deadline,active.attempt.deadline);
});

test('scheduled execution, cancellation propagation and checkpoint recovery', async t => {
  const { call, register, command, get, advance } = setup(t);
  const a = await register('A');
  const b = await register('B', [a.task.id]);
  const c = await register('C');
  const schedule = new Date(Date.now() + 30_000).toISOString();
  assert.equal((await command(a, 'admit', { executor: 'codex', start_at: schedule })).body.lifecycle.state, 'scheduled');
  await command(b, 'admit', { executor: 'codex', cancel_with_dependency: true });
  await command(c, 'admit', { executor: 'codex' });
  const claim = () => call({ op: 'claim', operation_id: crypto.randomUUID() }, 'worker');
  const running = (await claim()).body.claim;
  assert.equal(running.task.id, c.task.id);
  const report = (type, extra = {}) => call({ op: 'report', task_id: c.task.id,
    attempt_id: running.attempt.id, lease: running.lease, operation_id: crypto.randomUUID(),
    report: { type, ...extra } }, 'worker');
  assert.equal((await command(await get(c), 'pause')).body.lifecycle.state, 'pausing');
  const session_id = '01a12345-1234-7123-8123-123456789abc';
  assert.equal((await report('stopped', { session_id, revision: rev })).body.lifecycle.state, 'paused');
  assert.equal((await command(await get(c), 'resume')).body.lifecycle.state, 'ready');
  assert.equal((await claim()).body.claim.attempt.resume_session_id, session_id);
  assert.equal((await command(await get(a), 'cancel')).body.lifecycle.state, 'cancelled');
  advance(40_000);
  assert.equal((await claim()).body.claim, null);
  assert.equal((await get(b)).lifecycle.state, 'cancelled');
});

test('an admitted Task receives an isolated pinned checkout without a workspace mapping', async t => {
  const { call, register, get, command, pin } = setup(t);
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'aads-automatic-checkout-')));
  t.after(() => rm(parent, { force:true, recursive:true }));
  const source = join(parent, 'source');
  const root = process.platform==='win32' ? join(parent,'worker-'+'a'.repeat(Math.max(12,170-parent.length))) : join(parent,'worker');
  const nested = 'evidence-'+'n'.repeat(70);
  const filename = 'record-'+'v'.repeat(65)+'.txt';
  await mkdir(join(source,nested),{recursive:true});
  await writeFile(join(source,nested,filename),'source evidence');
  await mkdir(root);
  const exec = promisify(execFile);
  const git = async (cwd, ...args) => (await exec('git', args, { cwd, windowsHide:true })).stdout.trim();
  await git(source, 'init');
  if (process.platform==='win32') await git(source,'config','--local','core.longpaths','true');
  await git(source, 'add', '--', nested+'/'+filename);
  await git(source, '-c', 'user.name=Test', '-c', 'user.email=test@example.test',
    'commit', '-m', 'pinned');
  const baseline = await git(source, 'rev-parse', 'HEAD');
  await git(source, '-c', 'user.name=Test', '-c', 'user.email=test@example.test',
    'commit', '--allow-empty', '-m', 'new upstream head');
  pin(baseline);
  const task = await register('Provisioned');
  assert.equal((await command(task, 'admit', { executor:'codex' })).status, 200);
  const send = async request => {
    const response = await call(request, 'worker');
    assert.equal(response.status, 200, JSON.stringify(response.body));
    return response.body;
  };
  const { claim } = await send({ op:'claim', operation_id:crypto.randomUUID() });
  const author = { name:'Test worker', email:'test@example.test' };
  const cache = join(parent, 'partial-cache');
  await git(source, 'config', 'uploadpack.allowFilter', 'true');
  await git(source, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
  await git(source, 'clone', '--no-checkout', '--depth=2', '--filter=blob:none', pathToFileURL(source).href, cache);
  assert.equal(await git(cache, 'cat-file', '-t', baseline), 'commit');
  const provision = input => provisionTaskWorkspace({
    root, author, cloneOrigin:pathToFileURL(source).href, gitCache:cache, ...input,
  });
  const workspace = join(root, task.task.id);
  const signal = AbortSignal.timeout(45_000);
  // Exercise the same source handoff used by both provider transports.
  const objective = ' \r\n' + '🧭'.repeat(99_996) + ' ';
  claim.task.objective = objective;
  const cancelled = new AbortController();
  await assert.rejects(provision({
    task:claim.task, attempt:claim.attempt, signal:cancelled.signal,
    observe:async (name, action) => {
      if (name === 'checkout_materialization') cancelled.abort();
      return action();
    },
  }), {name:'AbortError'});
  assert.equal(existsSync(workspace),false);
  const independent = {...claim.task,id:'task_00000000-0000-4000-8000-000000000048'};
  const [firstCopy,secondCopy,other] = await Promise.all([
    provision({task:claim.task,attempt:claim.attempt,signal}),
    provision({task:claim.task,attempt:claim.attempt,signal}),
    provision({task:independent,attempt:claim.attempt,signal}),
  ]);
  assert.equal(firstCopy,workspace);
  assert.equal(secondCopy,workspace);
  assert.notEqual(other,workspace);
  const absent = {...independent,id:'task_00000000-0000-4000-8000-000000000049'};
  await assert.rejects(provision({task:absent,attempt:{revision:'f'.repeat(40)},signal}),{
    category:'revision_unavailable', exitCode:128, retryable:false,
  });
  await writeFile(join(other,'retained.txt'),'existing work');
  await assert.rejects(provision({task:independent,attempt:claim.attempt,signal}),{
    category:'reconciliation_required',
  });
  assert.equal(readFileSync(join(other,'retained.txt'),'utf8'),'existing work');
  await runClaim({
    claim, send, signal, admitStorage:async () => {},
    prepareWorkspace:provision,
    execute:async ({ cwd, task, attempt, objectiveSource }) => {
      assert.equal(cwd, workspace);
      assert.equal(task.objective,objective);
      const saved = JSON.parse(readFileSync(join(cwd,objectiveSource),'utf8'));
      assert.equal(saved.objective,objective);
      assert.equal(saved.attempt_id,attempt.id);
      assert.equal(saved.revision,attempt.revision);
      const prompt = codexTaskPrompt(task,attempt,{objectiveSource});
      assert.ok(prompt.includes(objectiveSource));
      assert.ok(!prompt.includes(objective));
      assert.equal(await git(cwd, 'rev-parse', 'HEAD'), baseline);
      if(process.platform==='win32') {
        assert.ok(join(cwd,nested,filename).length>260);
        assert.equal(await git(cwd,'config','--local','core.longpaths'),'true');
      }
      assert.equal(readFileSync(join(cwd,nested,filename),'utf8'),'source evidence');
      await exec(process.execPath, ['-e', 'require("node:fs").writeFileSync("artifact.txt", "worker output")'], { cwd });
      return { ok:true };
    },
  });
  const candidate = await get(task);
  assert.equal(candidate.lifecycle.state, 'verifying', candidate.attempts.at(-1)?.failure);
  const revision = candidate.attempts[0].candidate_revision;
  assert.notEqual(revision, baseline);
  assert.equal(await git(workspace, 'show', revision + ':artifact.txt'), 'worker output');
  assert.equal(await git(workspace, 'rev-parse', revision + '^'), baseline);
  assert.equal(await provision({ task:claim.task, attempt:{ revision }, signal }), workspace);
  await assert.rejects(provision({
    task:{ ...claim.task, id:'../unassigned' }, attempt:claim.attempt, signal,
  }), /Invalid Task checkout identity/);
});

test('a transient Git HTTP failure has bounded attempts and retains no remote output', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(),'aads-transient-fetch-')));
  t.after(() => rm(root,{force:true,recursive:true}));
  let requests = 0;
  const server = createServer((request,response) => {
    requests++;
    response.writeHead(503);
    response.end('PRIVATE upstream diagnostic');
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const start = Date.now();
  await assert.rejects(provisionTaskWorkspace({
    root,
    task:{id:'task_00000000-0000-4000-8000-000000000050',repository:'Kgray44/Aetherwake'},
    attempt:{id:'attempt_00000000-0000-4000-8000-000000000050',revision:'a'.repeat(40)},
    cloneOrigin:'http://127.0.0.1:'+server.address().port+'/fixture.git',
    author:{name:'Fixture',email:'worker@example.test'},
    signal:AbortSignal.timeout(20_000),
  }),error => error.category==='temporary_transport' && error.tries===3 && error.exitCode===128 &&
    !JSON.stringify(error).includes('PRIVATE') && !error.message.includes('127.0.0.1'));
  assert.equal(requests,3);
  assert.ok(Date.now()-start>=1500);
});

test('a checkout failure exposes live and terminal telemetry before any Codex thread exists',async t=>{
  const {call,register,command,get}=setup(t);
  const root=await mkdtemp(join(tmpdir(),'aads-provision-telemetry-'));
  t.after(()=>rm(root,{force:true,recursive:true}));
  const task=await register('Unavailable checkout');
  assert.equal((await command(task,'admit',{executor:'codex'})).status,200);
  const send=async request=>(await call(request,'worker')).body;
  const {claim}=await send({op:'claim',operation_id:crypto.randomUUID()});
  const journal=join(root,'claimed-execution.journal');
  let checkoutStarted=false;
  const {applyTelemetryDelta}=await import('../telemetry-delta.mjs');
  let projection;
  await runClaim({
    claim,send,signal:AbortSignal.timeout(10_000),admitStorage:async()=>{},
    telemetryDirectory:root,
    managedConnection:{async call({change}){
      if (!change) return {baseline:null};
      projection=applyTelemetryDelta(projection,change);
      return {digest:'a'.repeat(64),generated_at:projection.generated_at,received_at:new Date().toISOString(),
        events:projection.events.length,records:projection.records.length};
    }},
    prepareWorkspace:async ({observe})=>observe('checkout_fetch',async()=>{
      checkoutStarted=(await readJournal(journal)).some(event=>event.kind==='span_start'&&event.span_id.endsWith('-checkout_fetch'));
      throw Error('Pinned checkout unavailable');
    }),
    execute:async()=>assert.fail('Codex must not start without a verified checkout'),
  });
  assert.equal(checkoutStarted,true);
  const result=await get(task);
  assert.equal(result.lifecycle.state,'failed');
  assert.equal(result.attempts[0].failure_kind,'checkout');
  assert.equal(result.attempts[0].session_id,undefined);
  assert.ok(projection?.events.some(event=>event.kind==='span_end'&&event.span_id.endsWith('-checkout_fetch')&&event.state==='failed'));
  assert.ok(!projection.events.some(event=>event.phase==='implementation'));
});

test('lease renewals continue during pending preflight and a lost terminal acknowledgment is replayed', async t => {
  const {call,register,command,get}=setup(t);
  const task=await register('Lease reconciliation');
  assert.equal((await command(task,'admit',{executor:'codex'})).status,200);
  const {body:{claim}}=await call({op:'claim',operation_id:crypto.randomUUID()},'worker');
  const preflight=Promise.withResolvers();
  let beats=0;
  const heartbeatIds=[];
  const terminalIds=[];
  let receipt;
  const send=async request=>{
    if (request.report.type==='heartbeat') {
      heartbeatIds.push(request.operation_id);
      if (heartbeatIds.length===1) throw Object.assign(Error('Temporary transport failure'),{status:503});
      beats++;
      if (beats===2) preflight.resolve();
    }
    const result=await call(request,'worker');
    if (result.status!==200) throw Object.assign(Error(result.body.error),{status:result.status});
    if (request.report.type==='failed') {
      terminalIds.push(request.operation_id);
      if (terminalIds.length===1) {
        receipt=result.body.events.at(-1);
        throw Error('Connection closed after persistence');
      }
    }
    return result.body;
  };
  await runClaim({claim,send,interval:10,signal:AbortSignal.timeout(5000),
    admitStorage:async()=>{await Promise.race([preflight.promise,new Promise((_,reject)=>{
      const timeout=setTimeout(()=>reject(Error('Heartbeat did not reach the Engine during preflight')),1000);
      timeout.unref();
    })]);},
    prepareWorkspace:async()=>{throw Error('Synthetic checkout unavailable');},
    execute:async()=>assert.fail('No executor should start after failed preparation'),
  });
  const result=await get(task);
  assert.equal(beats>=2,true);
  assert.equal(heartbeatIds[0],heartbeatIds[1]);
  assert.equal(terminalIds.length,2);
  assert.equal(terminalIds[0],terminalIds[1]);
  assert.equal(result.events.filter(event=>event.kind==='failed').length,1);
  const report=result.events.find(event=>event.kind==='failed');
  assert.equal(report.operation_id,receipt.operation_id);
  assert.match(report.reason,/Checkout prepare checkout failed/);
  assert.equal(result.lifecycle.state,'failed');
  assert.match(result.attempts[0].failure,/Checkout prepare checkout failed/);
  const diagnostic = result.attempts[0].checkout_diagnostic;
  assert.equal(diagnostic.stage,'checkout_provisioning');
  assert.equal(diagnostic.operation,'prepare checkout');
  assert.equal(diagnostic.retryable,false);
  assert.deepEqual(result.events.find(event=>event.kind==='failed').checkout_diagnostic,diagnostic);
});

test('hung control report returns at lease expiry without submitting a stale terminal report', async t => {
  const {call,register,command}=setup(t);
  const task=await register('Hung control transport');
  assert.equal((await command(task,'admit',{executor:'codex'})).status,200);
  const {body:{claim}}=await call({op:'claim',operation_id:crypto.randomUUID()},'worker');
  // Simulate a monotonic timer firing while the wall clock still reads
  // before expiry, as it can around clock adjustment and timer rounding.
  const wallClock=Date.now();
  t.mock.method(Date,'now',()=>wallClock);
  claim.attempt.lease_until=wallClock+80;
  const reports=[];
  const guard=new AbortController();
  t.after(()=>guard.abort());
  const watchdog=setTimeout(()=>guard.abort(Error('Lease watchdog exceeded')),1000);
  t.after(()=>clearTimeout(watchdog));
  const result=runClaim({claim,signal:guard.signal,
    send:async (request,options)=>{
      reports.push(request.report.type);
      guard.signal.throwIfAborted();
      return new Promise((_,reject)=>{
        guard.signal.addEventListener('abort',()=>reject(guard.signal.reason),{once:true});
        options?.signal?.addEventListener('abort',()=>reject(options.signal.reason),{once:true});
      });
    },
    admitStorage:async()=>{throw Error('Synthetic preflight interruption');},
    execute:async()=>assert.fail('No executor should start after failed preflight'),
  });
  await assert.rejects(result,/lease.*expir/i);
  assert.deepEqual(reports,['heartbeat']);
});

test('a lost renewal reply is retried inside the lease without interrupting a running turn', async t => {
  const {call,register,command,get}=setup(t);
  const task=await register('Transient renewal interruption');
  assert.equal((await command(task,'admit',{executor:'codex'})).status,200);
  const {body:{claim}}=await call({op:'claim',operation_id:crypto.randomUUID()},'worker');
  const workspace=await mkdtemp(join(tmpdir(),'aads-lease-retry-'));
  claim.attempt.lease_until=Date.now()+3500;
  t.after(()=>rm(workspace,{force:true,recursive:true}));
  await mkdir(join(workspace,'.git'));
  const recovered=Promise.withResolvers();
  const renewalIds=[];
  let turns=0;
  const branch='fixture-lease-retry';
  const revision='b'.repeat(40);
  const send=async (request,{signal})=>{
    if (request.report.type==='heartbeat'&&turns) {
      renewalIds.push(request.operation_id);
      if (renewalIds.length===1) return new Promise(()=>{});
    }
    signal.throwIfAborted();
    const result=await call(request,'worker');
    if (result.status!==200) throw Object.assign(Error(result.body.error),{status:result.status});
    if (request.report.type==='heartbeat'&&renewalIds.length===2) recovered.resolve();
    return result.body;
  };
  const result=runClaim({claim,send,workspace,interval:15,requestTimeoutMs:60,
    signal:AbortSignal.timeout(3000),admitStorage:async()=>{},onTelemetryStart:()=>{},
    identify:async()=>({branch,revision:turns?revision:claim.attempt.revision,dirty:false}),
    execute:async ({signal,onSession})=>{
      await onSession('00000000-0000-4000-8000-000000000003');
      turns++;
      await Promise.race([recovered.promise,new Promise((_,reject)=>
        signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))]);
      signal.throwIfAborted();
      return {ok:true};
    },
  });
  await result;
  assert.equal(turns,1);
  assert.equal(renewalIds[0],renewalIds[1]);
  const detail=await get(task);
  assert.equal(detail.attempts.length,1);
  assert.equal(detail.attempts[0].state,'verifying');
  assert.equal(detail.attempts[0].candidate_revision,revision);
});

test('preflight retries a transient storage timeout inside the claim and honors a reserve denial', async t => {
  const {call,register,command,get}=setup(t);
  for (const failure of ['storage_guard_timeout','storage_reserve_denied']) {
    const task=await register('Storage preflight '+failure);
    await command(task,'admit',{executor:'codex'});
    const {body:{claim}}=await call({op:'claim',operation_id:crypto.randomUUID(),task_ids:[task.task.id]},'worker');
    let guards=0,provisions=0;
    const send=async request=>(await call(request,'worker')).body;
    await runClaim({claim,send,signal:AbortSignal.timeout(5000),
      admitStorage:async()=>{
        if (++guards===1) throw Object.assign(Error('Fixture guard failure'),{code:failure});
      },
      prepareWorkspace:async()=>{provisions++;throw Error('Fixture checkout end');},
      execute:async()=>assert.fail('Fixture must stop at checkout preparation'),
    });
    assert.equal(guards,failure==='storage_guard_timeout'?2:1);
    assert.equal(provisions,failure==='storage_guard_timeout'?1:0);
    assert.equal((await get(task)).attempts.length,1);
  }
});

test('a report aborted during connector thread startup is not sent when startup completes', async t => {
  const root=await mkdtemp(join(tmpdir(),'aads-control-startup-'));
  t.after(()=>rm(root,{force:true,recursive:true}));
  const fixture=join(root,'fake-codex.cjs');
  const ready=join(root,'thread-started');
  const release=join(root,'release-thread');
  const requests=join(root,'tool-requests');
  await writeFile(fixture,`const fs=require('node:fs');
const rl=require('node:readline').createInterface({input:process.stdin});
const reply=(id,result)=>process.stdout.write(JSON.stringify({id,result})+'\\n');
rl.on('line',line=>{
  const request=JSON.parse(line);
  if (request.method==='initialize') reply(request.id,{});
  if (request.method==='thread/start') {
    fs.writeFileSync('thread-started','');
    const timer=setInterval(()=>{
      if (!fs.existsSync('release-thread')) return;
      clearInterval(timer);
      reply(request.id,{thread:{id:'fixture-thread'}});
    },5);
  }
  if (request.method==='mcpServer/tool/call') {
    fs.appendFileSync('tool-requests',request.params.arguments.marker+'\\n');
    reply(request.id,{structuredContent:{status:200}});
  }
});
`);
  let exited;
  const connector=openObservatoryConnector({cwd:root,executable:process.execPath,
    spawnProcess:(executable,_appServerArguments,options)=>{
      const child=spawn(executable,[fixture],options);
      exited=new Promise(resolve=>child.once('close',resolve));
      return child;
    }});
  try {
    const controller=new AbortController();
    const pending=connector.call({marker:'expired'}, undefined,{signal:controller.signal});
    const watchdog=AbortSignal.timeout(5000);
    while(!existsSync(ready)) await sleep(5,undefined,{signal:watchdog});
    controller.abort(Error('Lease expired before the tool thread was ready'));
    const outcome=assert.rejects(pending,/Lease expired/);
    await writeFile(release,'');
    await outcome;
    assert.equal((await connector.call({marker:'still-valid'})).status,200);
    assert.equal(readFileSync(requests,'utf8'),'still-valid\n');
  } finally {
    connector.close();
    await exited;
  }
});

test('real subprocess demo persists two artifacts before verified A admits B', async t => {
  const { call, register, command, get, pin } = setup(t);
  const parent = await mkdtemp(join(tmpdir(), 'aads-task-engine-'));
  t.after(() => rm(parent, { force: true, recursive: true }));
  const exec = promisify(execFile);
  const git = async (cwd, ...args) => (await exec('git', args, { cwd, windowsHide: true })).stdout.trim();
  const source = join(parent, 'source');
  await mkdir(source);
  await git(source, 'init');
  await git(source, '-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--allow-empty', '-m', 'base');
  const base = await git(source, 'rev-parse', 'HEAD');
  pin(base);
  const a = await register('A');
  const b = await register('B', [a.task.id]);
  const c = await register('C');
  const workspaces = new Map();
  for (const [name, task] of [['a', a], ['b', b], ['c', c]]) {
    const path = join(parent, name);
    await git(parent, 'clone', '--quiet', '--no-local', source, path);
    await git(path, 'remote', 'set-url', 'origin', 'https://github.com/Kgray44/Aetherwake.git');
    await git(path, 'switch', '-c', 'codex/aads-task-' + name);
    await git(path, 'config', 'user.name', 'Test worker');
    await git(path, 'config', 'user.email', 'test@example.test');
    workspaces.set(task.task.id, await realpath(path));
    assert.equal((await command(task, 'admit', { executor: 'codex' })).status, 200);
  }
  const claim = async () => (await call({ op: 'claim', operation_id: crypto.randomUUID() }, 'worker')).body.claim;
  const send = async request => {
    const response = await call(request, 'worker');
    if (response.status !== 200) throw Object.assign(Error(response.body.error), { status: response.status });
    return response.body;
  };
  const first = await claim();
  const second = await claim();
  assert.deepEqual(new Set([first.task.id, second.task.id]), new Set([a.task.id, c.task.id]));
  let entered = 0;
  let release;
  const overlap = new Promise(resolve => { release = resolve; });
  const observed = [];
  const verificationNamespace = crypto.randomUUID();
  const run = (claim, parallel) => runClaim({
    verificationNamespace,
    claim, send, workspace: workspaces.get(claim.task.id), signal: AbortSignal.timeout(15_000),
    admitStorage: async () => {},
    ...(parallel ? {
      onTelemetryStart: ({ attempt, verificationNamespace }) => observed.push({ type: 'start', id: attempt.id, verificationNamespace }),
      onUsage: ({ attempt, measurements }) => observed.push({ type: 'usage', id: attempt.id, measurements }),
      onTelemetryEnd: ({ attempt, measurements, state }) => observed.push({ type: 'end', id: attempt.id, measurements, state }),
    } : {}),
    execute: async ({ cwd, task, onSession, onUsage }) => {
      const frames = [
        {type:'thread.started',thread_id:crypto.randomUUID()},
        {type:'turn.started'},
        {type:'turn.completed',usage:{input_tokens:40,output_tokens:6,cached_input_tokens:10,private:'discard me'}},
      ];
      const measurements = await observeCodexStream(
        Readable.from(frames.map(frame => JSON.stringify(frame) + '\n')), {onSession,onUsage}
      );
      if (parallel) {
        entered++;
        if (entered === 2) release();
        await overlap;
      }
      await exec(process.execPath, ['-e', 'require("node:fs").writeFileSync("artifact.txt", process.argv[1])', task.id], { cwd });
      return { ok: true, measurements };
    },
  });
  await Promise.all([run(first, true), run(second, true)]);
  assert.deepEqual(observed.filter(item => item.id === first.attempt.id).map(item => item.type), ['start', 'usage', 'end']);
  assert.equal(observed.find(item => item.id === first.attempt.id && item.type === 'start').verificationNamespace, verificationNamespace);
  const end = observed.find(item => item.id === first.attempt.id && item.type === 'end');
  assert.equal(end.state, 'completed');
  assert.equal(end.measurements.find(item => item.name === 'provider_core_usage_complete').value, 1);
  assert.equal((await get(c)).lifecycle.state, 'verifying');
  assert.equal((await get(b)).lifecycle.state, 'blocked');
  const candidate = await get(a);
  assert.equal(candidate.lifecycle.state, 'verifying');
  assert.equal(candidate.attempts[0].revision, base);
  const revision = candidate.attempts[0].candidate_revision;
  assert.notEqual(revision, base);
  assert.equal(await git(workspaces.get(a.task.id), 'rev-parse', revision + '^'), base);
  assert.equal(await git(workspaces.get(a.task.id), 'status', '--porcelain'), '');
  assert.equal(await git(workspaces.get(a.task.id), 'show', revision + ':artifact.txt'), a.task.id);
  assert.equal((await command(candidate, 'accept', { evidence: [
    { criterion_id: 'criterion-1', uri: 'https://example.test/reviewed-artifact', revision },
  ] })).body.lifecycle.state, 'completed');
  const downstream = await claim();
  assert.equal(downstream.task.id, b.task.id);
  await run(downstream, false);
  const readback = await get(b);
  assert.equal(readback.lifecycle.state, 'verifying');
  assert.equal(await git(workspaces.get(b.task.id), 'show', readback.attempts[0].candidate_revision + ':artifact.txt'), b.task.id);
  const journal = join(workspaces.get(b.task.id),'.git','agent-harness','claimed-execution.journal');
  const events = await readJournal(journal);
  const stages = events.filter(event=>event.kind==='span_end').map(event=>event.measurements
    .find(metric=>metric.name==='elapsed_wall_ms'));
  assert.deepEqual(stages.map(metric=>metric.method).sort(), [
    'candidate_git_verification','candidate_submission','checkout_lock_release',
    'checkout_validation','worker_capture_interval','worker_initialization',
  ]);
  assert.ok(stages.every(metric=>Number.isFinite(metric.value)&&metric.value>=0));
  assert.ok(events.some(event=>event.phase==='implementation'&&event.kind==='measurement'));
  assert.equal(events.every(event => event.revision === downstream.attempt.revision), true);
  assert.doesNotMatch(JSON.stringify(events), /discard me/);
  const records = [readback.task, taskAttemptRecord(readback.task, readback.attempts[0])];
  const analytics = buildEngineeringAnalytics({records,events}).tokenAccounting;
  assert.equal(analytics.byAttempt[0].observed.totalTokens, 46);
  assert.equal(analytics.byAttempt[0].revision, base);
  assert.equal(analytics.byAttempt[0].coverage, 'partial');
});

test('one bounded Codex stream delivers session identity and sanitized usage', async () => {
  const sessionId = '01a12345-1234-7123-8123-123456789abc';
  const seen = [];
  const input = [
    { type: 'thread.started', thread_id: sessionId },
    { type: 'turn.started' },
    { type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 4, private: 'do not retain' } },
  ];
  await observeCodexStream(Readable.from(input.map(item => JSON.stringify(item) + '\n')), {
    onSession: id => seen.push(id),
    onUsage: usage => seen.push(usage),
  });
  assert.equal(seen[0], sessionId);
  assert.equal(seen[1].find(item => item.name === 'provider_input_tokens').value, 10);
  assert.equal(JSON.stringify(seen).includes('do not retain'), false);
});

test('an observer reconciles lost workers and persists one fenced lease-expiry receipt', async t => {
  const { call, register, command, get, advance } = setup(t);
  const starting = await register('Expired worker');
  await command(starting, 'admit', { executor: 'codex' });
  const { claim } = (await call({ op: 'claim', operation_id: crypto.randomUUID() }, 'worker')).body;
  assert.equal((await get(starting)).lifecycle.state, 'running');
  advance(60_001);
  const [first, second] = await Promise.all([get(starting), get(starting)]);
  for (const readback of [first, second]) {
    assert.equal(readback.lifecycle.state, 'failed');
    assert.equal(readback.attempts[0].state, 'orphaned');
    assert.equal(readback.attempts[0].failure_kind, 'lease');
    const events = readback.events.filter(event => event.kind === 'lease_expired');
    assert.equal(events.length, 1);
    assert.equal(events[0].actor, 'scheduler');
    assert.equal(events[0].attempt_id, claim.attempt.id);
  }
  const report = await call({ op: 'report', task_id: claim.task.id, attempt_id: claim.attempt.id,
    lease: claim.lease, operation_id: crypto.randomUUID(), report: { type: 'heartbeat' } }, 'worker');
  assert.equal(report.status, 409);
  assert.equal((await get(starting)).version, first.version);
});

test('a leased worker can bind an observed App Server model to an immutable attempt session', async t => {
  const {call,register,command,get}=setup(t);
  const task=await register('Observed executor model');
  await command(task,'admit',{executor:'codex'});
  const {claim}=(await call({op:'claim',operation_id:crypto.randomUUID()},'worker')).body;
  const session_id=crypto.randomUUID();
  const identity={provider:'openai',model:'observed-model',source:'codex_app_server_thread_start'};
  const report=execution_identity=>call({op:'report',task_id:task.task.id,attempt_id:claim.attempt.id,
    lease:claim.lease,operation_id:crypto.randomUUID(),report:{type:'heartbeat',session_id,execution_identity}},'worker');
  assert.equal((await report(identity)).status,200);
  assert.equal((await report({...identity,model:'changed-model'})).status,400);
  const attempt=(await get(task)).attempts[0];
  assert.deepEqual(attempt.execution_identity,identity);
  assert.equal(taskAttemptRecord(task.task,attempt).model,identity.model);
});

test('revision-pinned PR and CI references survive replay and stay owner scoped', async t => {
  const { call, register, command, get } = setup(t);
  const created = await register('References');
  const link = (kind, path) => ({ kind, uri: 'https://github.com/Kgray44/Aetherwake/' + path, revision: rev });
  const pull = link('pull_request', 'pull/1');
  const ci = link('ci_run', 'actions/runs/2');
  const request = { op: 'command', task_id: created.task.id, expected_version: created.version,
    operation_id: crypto.randomUUID(), action: { type: 'associate', reference: pull } };
  const first = await call(request, 'agent');
  assert.equal(first.status, 200);
  assert.equal((await call(request, 'agent')).body.version, first.body.version);
  assert.equal((await call(request, 'agent', 'other')).status, 404);
  const attached = await command(await get(created), 'associate', { reference: ci }, 'agent');
  assert.equal(attached.status, 200);
  const bad = { ...ci, uri: ci.uri + '?token=private' };
  assert.equal((await command(await get(created), 'associate', { reference: bad }, 'agent')).status, 400);
  const detail = await get(created);
  assert.deepEqual(detail.lifecycle.links, [pull, ci]);
  assert.equal(detail.events.filter(event => event.kind === 'associate').length, 2);
});

test('verification workers reject checkouts connected to a different delivery namespace', async t => {
  const root = await mkdtemp(join(tmpdir(), 'aads-verification-scope-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  const verification = crypto.randomUUID();
  const connection = join(root, '.git', 'agent-harness', 'observatory-sync');
  await checkWorkspaceTelemetryScope(root, verification);
  await mkdir(connection, { recursive: true });
  const config = namespace => writeFile(join(connection, 'connection.json'), JSON.stringify({
    version: 1, ...(namespace ? { verification: namespace } : {}),
  }), { mode: 0o600 });
  await config();
  await checkWorkspaceTelemetryScope(root, undefined);
  await assert.rejects(checkWorkspaceTelemetryScope(root, verification), /telemetry namespace/);
  await config(verification);
  await assert.rejects(checkWorkspaceTelemetryScope(root, undefined), /telemetry namespace/);
  await checkWorkspaceTelemetryScope(root, verification);
});

test('trigger-backed Task writes return success independently of D1 change counts', async t => {
  const { call, register, command, get } = setup(t, { countAuditWrites: true });
  const task = await register('D1 trigger write counts');
  const admission = await command(task, 'admit', { executor: 'codex' });
  assert.equal(admission.status, 200);
  const claim = await call({ op: 'claim', operation_id: crypto.randomUUID(), task_ids: [task.task.id] }, 'worker');
  assert.equal(claim.status, 200);
  const active = claim.body.claim;
  const status = await call({ op: 'report', task_id: task.task.id, attempt_id: active.attempt.id, lease: active.lease,
    operation_id: crypto.randomUUID(), report: { type: 'finished', result: 'candidate', revision: rev } }, 'worker');
  assert.equal(status.status, 200);
  const detail = await get(task);
  assert.equal(detail.lifecycle.state, 'verifying');
  assert.deepEqual(detail.events.map(item => item.kind), ['register', 'admit', 'claim', 'finished']);
});
