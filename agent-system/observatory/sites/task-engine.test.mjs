import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, mkdir, realpath, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { proposedTask } from '../intake.mjs';
import { taskOperation } from './task-engine.mjs';
import { observeCodexStream } from '../../../scripts/agent/provider-events.mjs';
import { checkWorkspaceTelemetryScope, runClaim } from '../../../scripts/agent/observatory-task-worker.mjs';

const rev = 'a'.repeat(40);
const fields = name => ({
  title: 'Task ' + name, objective: 'Produce a checked artifact for task ' + name,
  primary: 'backend', profile_id: 'backend', criteria: ['Artifact is readable'], dependencies: [],
});

function setup(t, { countAuditWrites = false } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  for (const migration of ['0000_proposals', '0003_proposal_publication', '0004_cached_proposal_revision',
    '0007_proposal_controls', '0011_task_engine']) {
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
  const [first, raced] = await Promise.all([claim(), claim()]);
  assert.ok([200, 409].includes(raced.status));
  const second = raced.body.claim ? raced : await claim();
  const claimed = [first.body.claim, second.body.claim];
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
    onTelemetryStart: ({ attempt, verificationNamespace }) => observed.push({ type: 'start', id: attempt.id, verificationNamespace }),
    onUsage: ({ attempt, measurements }) => observed.push({ type: 'usage', id: attempt.id, measurements }),
    onTelemetryEnd: ({ attempt, measurements, state }) => observed.push({ type: 'end', id: attempt.id, measurements, state }),
    execute: async ({ cwd, task, onSession, onUsage }) => {
      onSession(crypto.randomUUID());
      await onUsage([{ name: 'test_observation' }]);
      if (parallel) {
        entered++;
        if (entered === 2) release();
        await overlap;
      }
      await exec(process.execPath, ['-e', 'require("node:fs").writeFileSync("artifact.txt", process.argv[1])', task.id], { cwd });
      return { ok: true, measurements: [{ name: 'test_summary' }] };
    },
  });
  await Promise.all([run(first, true), run(second, true)]);
  assert.deepEqual(observed.filter(item => item.id === first.attempt.id).map(item => item.type), ['start', 'usage', 'end']);
  assert.equal(observed.find(item => item.id === first.attempt.id && item.type === 'start').verificationNamespace, verificationNamespace);
  const end = observed.find(item => item.id === first.attempt.id && item.type === 'end');
  assert.equal(end.state, 'completed');
  assert.equal(end.measurements[0].name, 'test_summary');
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

test('verification route pins exact model and effort only with a matching fresh Codex catalog', async () => {
  const {buildCodexArgs,validateVerificationRoute} = await import('../../../scripts/agent/observatory-task-worker.mjs');
  const config = {model:'gpt-6.2-sol',effort:'medium'};
  const catalog = {
    client_version:'0.169.1', fetched_at:'2026-11-20T00:00:00.000Z',
    models:[{slug:config.model,supported_reasoning_levels:[{effort:'medium'}]}],
  };
  const now = Date.parse('2026-11-20T01:00:00.000Z');
  const verification = crypto.randomUUID();
  const qualify = (changes = {}) => validateVerificationRoute({config,catalog,version:'0.169.1',verification,now,...changes});
  const route = qualify();
  assert.deepEqual(route,{...config,clientVersion:'0.169.1',expiresAt:Date.parse('2026-11-21T00:00:00.000Z')});
  const args = buildCodexArgs('D:/trial',{},route);
  assert.deepEqual(args.slice(args.indexOf('--model'),args.indexOf('--model')+4),[
    '--model','gpt-6.2-sol','--config','model_reasoning_effort="medium"',
  ]);
  assert.equal(buildCodexArgs('D:/trial',{}).includes('--model'),false);
  assert.throws(() => qualify({verification:undefined}),/verification namespace/);
  assert.throws(() => qualify({version:'0.153.3'}),/fresh catalog for this Codex client/);
  assert.throws(() => qualify({now:now+86400000}),/fresh catalog for this Codex client/);
  assert.throws(() => qualify({config:{...config,effort:'ultra'}}),/not listed/);
  assert.throws(() => qualify({config:{...config,model:'gpt-6.2-astra'}}),/not listed/);
});
