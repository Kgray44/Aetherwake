import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { MissionPublication, lastMissionVerificationEvent } from '../src/mission-publication.mts';
import { MissionConversationReceipts } from '../src/mission-conversation.mts';
import { projectMissionExecution } from '../src/execution-profiler.mts';
import { MissionService, type MissionServiceHost } from '../src/mission-service.mts';
import { backendInspectionBinding } from '../src/mission-source-receipt.mts';
import { createMissionCpuPool } from '../src/mission-cpu-pool.mts';
import { createPooledBackendSourceExecutor } from '../src/mission-native.mts';
import type { Mission, MissionExecutor, MissionPlan } from '../src/mission-contracts.mts';

const scope = { workspaceId: 'synthetic-workspace', projectId: null };
const plan: MissionPlan = { scope, objective: 'Inspect actual shipped source with synthetic lost delivery', criteria: ['source'], tasks: [{
  id: 'source', executor: 'inspect.backend-source', objective: 'Read the fixed shipped backend module', criterion: 'source',
  claims: [{ resource: 'aerynth.backend-source', mode: 'exclusive' }], dependencies: [], timeoutMs: 5000, maxAttempts: 1,
}] };
async function fixture(forgeExit = false, takeover = false, holdResult = false, withSuccessors = false) {
  const db = new DatabaseSync(':memory:'), pool = createMissionCpuPool(1), real = createPooledBackendSourceExecutor(pool);
  let deniedScope: string | undefined;
  let access = true, failPublication = false, entries = 0, done!: () => void;
  let service: MissionService;
  const abandoned: MissionService[] = [];
  let releaseResult!: () => void;
  const resultGate = new Promise<void>(resolve => { releaseResult = resolve; });
  let releaseSuccessors!: () => void, readySuccessors!: () => void, finishedSuccessors!: () => void;
  let enteredSuccessors = 0, settledSuccessors = 0;
  const successorGate = new Promise<void>(resolve => { releaseSuccessors = resolve; });
  const successorsReady = new Promise<void>(resolve => { readySuccessors = resolve; });
  const successorsFinished = new Promise<void>(resolve => { finishedSuccessors = resolve; });
  const bounded = (promise: Promise<void>) => {
    let timer: NodeJS.Timeout;
    return Promise.race([promise, new Promise<void>((_resolve, reject) => {
      timer = setTimeout(() => reject(Error('synthetic_successor_timeout')), 5000);
    })]).finally(() => clearTimeout(timer));
  };
  const terminal = new Promise<void>(resolve => { done = resolve; });
  const executor: MissionExecutor = { ...real, async run(context) {
    entries++;
    // Real fixed worker and observed worker exit; only delivery loss is synthetic.
    const result = await real.run({ ...context, recordBackendInspection: terminal => {
      context.recordBackendInspection!(forgeExit ? structuredClone(terminal) : terminal);
      if (takeover) { abandoned.push(service); service = new MissionService(host); done(); }
      if (holdResult) done();
    } });
    if (holdResult) await resultGate;
    return { ...result, outcome: 'uncertain' };
  } };
  const successor: MissionExecutor = { lane: 'synthetic-successor', replaySafe: true, available: () => true,
    async run() { if (++enteredSuccessors === 2) readySuccessors(); await successorGate; return { source: 'synthetic-successor', value: true }; },
    verify: evidence => ({ passed: evidence.value === true, detail: 'Synthetic successor gate completed' }) };
  const host: MissionServiceHost = { db, executors: { 'inspect.backend-source': executor, successor }, laneLimit: lane => lane === 'synthetic-successor' ? 2 : 1,
    authorized: value => access && value.workspaceId !== deniedScope,
    atomic<T>(work: () => T): T { db.exec('BEGIN'); try { const value = work(); db.exec('COMMIT'); return value; }
      catch (error) { db.exec('ROLLBACK'); throw error; } },
    stagePublication() { if (failPublication) throw Error('synthetic-publication-failure'); },
    observe: (_mission, event) => { if (event.kind === 'settled') {
      done();
      if ((event.taskId === 'left' || event.taskId === 'right') && ++settledSuccessors === 2) finishedSuccessors();
    } },
  };
  service = new MissionService(host);
  const child = (id: string): MissionPlan['tasks'][number] => ({ id, executor: 'successor', objective: 'Synthetic gated successor', criterion: id,
    dependencies: ['source'], claims: [], timeoutMs: 5000, maxAttempts: 1 });
  const requested = withSuccessors ? { ...plan, criteria: ['source', 'left', 'right'], tasks: [...plan.tasks, child('left'), child('right')] } : plan;
  const created = service.create('original-inspection', requested);
  const timer = setTimeout(() => done(), 7000);
  await terminal; clearTimeout(timer);
  const read = () => service.read(created.id, scope);
  const raw = (): Mission => JSON.parse(String(db.prepare('SELECT json FROM vela_missions WHERE id=?').get(created.id)!.json));
  const write = (m: Mission) => db.prepare('UPDATE vela_missions SET json=? WHERE id=?').run(JSON.stringify(m), m.id);
  return { db, pool, read, raw, write, serviceHostAtomic: host.atomic, entries: () => entries, service: () => service,
    revoke: () => { access = false; }, denyWorkspace: (id?: string) => { deniedScope = id; }, fail: (value: boolean) => { failPublication = value; },
    async reopen() { await service.close(); service = new MissionService(host); },
    waitSuccessors: () => bounded(successorsReady), waitSuccessorSettlement: () => bounded(successorsFinished), releaseSuccessors,
    async close() { releaseSuccessors(); releaseResult(); for (const old of abandoned) await old.close(); await service.close(); await pool.close(); db.close(); } };
}

test('original entered fixed-worker receipt survives restart and reconciles without running the effect again', async () => {
  const f = await fixture();
  try {
    const before = f.read(), original = before.tasks[0].attempts[0];
    assert.equal(before.tasks[0].state, 'uncertain');
    assert.equal(original.backendInspection?.terminal.exit?.quiescence, 'worker-exit');
    assert.equal(original.dispatch?.state, 'entered');
    await f.reopen();
    const current = f.read();
    const verified = f.service().reconcileBackendInspection(current.id, scope, current.revision, 'source', original.id);
    assert.equal(verified.tasks[0].state, 'verified');
    assert.equal(verified.tasks[0].attempts[0].id, original.id);
    assert.equal(verified.tasks[0].attempts[0].evidence?.id, original.backendInspection?.evidenceId);
    assert.equal(verified.tasks[0].attempts[0].verification?.passed, true);
    assert.equal(verified.tasks[0].attempts[0].evidence?.observedAt, original.backendInspection?.observedAt);
    const profile = projectMissionExecution(verified);
    const recovered = lastMissionVerificationEvent(verified)!;
    assert.equal(profile.firstVerifiedTask?.eventSeq, recovered.seq);
    assert.equal(profile.verifiedTaskMilestones.first?.settlement.eventSeq, recovered.seq);
    assert.equal(profile.attempts.length, 1);
    assert.notEqual(profile.attempts[0].end?.eventSeq, recovered.seq);
    assert.equal(profile.admissionToFirstVerifiedTaskMs, null, 'restart crosses monotonic clocks');
    assert.equal(f.entries(), 1);
    const duplicate = f.service().reconcileBackendInspection(verified.id, scope, verified.revision, 'source', original.id);
    assert.deepEqual(duplicate, verified);
    await f.reopen();
    assert.deepEqual(f.read().tasks[0].attempts[0], verified.tasks[0].attempts[0]);
    assert.equal(f.entries(), 1);
  } finally { await f.close(); }
});

test('missing, stale, mismatched and unquiesced receipts cannot release the original fence', async () => {
  const f = await fixture();
  try {
    const before = f.raw(), original = before.tasks[0].attempts[0];
    assert.ok(original.backendInspection);
    const mutate: ((m: Mission) => void)[] = [
      m => { delete m.tasks[0].attempts[0].backendInspection; },
      m => { m.tasks[0].attempts[0].backendInspection!.terminal = null!; },
      m => { m.tasks[0].attempts[0].backendInspection!.attemptId = 'wrong-attempt'; },
      m => { m.tasks[0].attempts[0].backendInspection!.scopeDigest = 'wrong-scope'; },
      m => { m.tasks[0].attempts[0].backendInspection!.claimsDigest = 'wrong-resource'; },
      m => { m.tasks[0].attempts[0].backendInspection!.terminal.evidence.value.sha256 = '0'.repeat(64); },
      m => { delete m.tasks[0].attempts[0].backendInspection!.terminal.exit; },
      m => { (m.tasks[0].attempts[0].backendInspection!.terminal.exit as unknown as { quiescence: string }).quiescence = 'still-running'; },
      m => { m.tasks[0].attempts[0].backendInspection!.terminal.evidence.source = 'node:os.cpus'; },
      m => { m.tasks[0].attempts[0].backendInspection!.terminal.exit!.effectId = '00000000-0000-0000-0000-000000000000'; },
      m => { m.tasks[0].attempts[0].backendInspection!.contextDigest = 'wrong-context'; },
      m => { m.tasks[0].attempts[0].backendInspection!.terminal.bindingDigest = '0'.repeat(64); },
      m => { m.tasks[0].attempts[0].dispatch!.state = 'reserved'; },
    ];
    for (const change of mutate) {
      const changed = structuredClone(before); change(changed);
      const receipt = changed.tasks[0].attempts[0].backendInspection;
      // Valid envelope checksum does not make stale/foreign/unquiesced source evidence authoritative.
      if (receipt) receipt.terminalDigest = createHash('sha256').update(JSON.stringify(receipt.terminal)).digest('hex');
      f.write(changed);
      assert.throws(() => f.service().reconcileBackendInspection(before.id, scope, before.revision, 'source', original.id), /mission_reconciliation_denied/);
      assert.deepEqual(f.raw(), changed);
    }
    f.write(before);
    assert.throws(() => f.service().reconcileBackendInspection(before.id, scope, before.revision, 'unknown-task', original.id), /mission_reconciliation_denied/);
    assert.throws(() => f.service().reconcileBackendInspection(before.id, scope, before.revision, 'source', 'wrong-attempt'), /mission_reconciliation_denied/);
    assert.throws(() => f.service().reconcileBackendInspection(before.id, scope, before.revision - 1, 'source', original.id), /mission_revision_changed/);
    assert.throws(() => f.service().reconcileBackendInspection(before.id, { ...scope, workspaceId: 'wrong' }, before.revision, 'source', original.id), /mission_not_found/);
    f.revoke();
    assert.throws(() => f.service().reconcileBackendInspection(before.id, scope, before.revision, 'source', original.id), /mission_not_found/);
    assert.deepEqual(f.raw(), before);
    assert.equal(f.entries(), 1);
  } finally { await f.close(); }
});

test('reconciliation receipt, terminal state and publication roll back together', async () => {
  const f = await fixture();
  try {
    const before = f.raw(), original = before.tasks[0].attempts[0];
    f.fail(true);
    assert.throws(() => f.service().reconcileBackendInspection(before.id, scope, before.revision, 'source', original.id), /synthetic-publication-failure/);
    assert.deepEqual(f.raw(), before);
    f.fail(false);
    assert.equal(f.service().reconcileBackendInspection(before.id, scope, before.revision, 'source', original.id).tasks[0].state, 'verified');
    assert.equal(f.entries(), 1);
  } finally { await f.close(); }
});


test('copied exit assertion has no live producer custody and cannot mint a durable receipt', async () => {
  const f = await fixture(true);
  try {
    const before = f.read(), attempt = before.tasks[0].attempts[0];
    assert.equal(attempt.backendInspection, undefined);
    assert.throws(() => f.service().reconcileBackendInspection(before.id, scope, before.revision, 'source', attempt.id), /mission_reconciliation_denied/);
    assert.deepEqual(f.read(), before);
    assert.equal(f.entries(), 1);
  } finally { await f.close(); }
});

test('mission cancellation cannot be undone by a valid historical source receipt', async () => {
  const f = await fixture();
  try {
    const before = f.read(), attempt = before.tasks[0].attempts[0];
    const stopped = f.service().control(before.id, scope, before.revision, { type: 'cancel' });
    assert.throws(() => f.service().reconcileBackendInspection(before.id, scope, stopped.revision, 'source', attempt.id), /mission_reconciliation_denied/);
    assert.deepEqual(f.read(), stopped);
  } finally { await f.close(); }
});


test('takeover after durable producer capture preserves original result and rejects stale settlement', async () => {
  const f = await fixture(false, true);
  try {
    const before = f.read(), attempt = before.tasks[0].attempts[0];
    assert.equal(before.tasks[0].state, 'failed');
    assert.equal(before.tasks[0].detail, 'interrupted_by_restart');
    assert.ok(attempt.backendInspection);
    const verified = f.service().reconcileBackendInspection(before.id, scope, before.revision, 'source', attempt.id);
    assert.equal(verified.tasks[0].state, 'verified');
    await f.reopen();
    assert.equal(f.read().tasks[0].state, 'verified');
    assert.equal(f.read().tasks[0].attempts[0].backendInspection?.terminal.exit?.effectId,
      attempt.backendInspection?.terminal.exit?.effectId);
    assert.equal(f.entries(), 1);
  } finally { await f.close(); }
});


test('even a valid terminal producer receipt cannot settle a still-running attempt', async () => {
  const f = await fixture(false, false, true);
  try {
    const before = f.read(), attempt = before.tasks[0].attempts[0];
    assert.equal(before.tasks[0].state, 'running');
    assert.ok(attempt.backendInspection);
    const journal = f.raw();
    assert.throws(() => f.service().reconcileBackendInspection(before.id, scope, before.revision, 'source', attempt.id), /mission_reconciliation_denied/);
    assert.deepEqual(f.raw(), journal);
    assert.equal(f.entries(), 1);
  } finally { await f.close(); }
});


test('only the shipped producer can mint an immutable original-job exit receipt', async () => {
  const pool = createMissionCpuPool(1);
  let injectedSpawns = 0;
  const injected = createMissionCpuPool(1, () => { injectedSpawns++; throw Error('must not spawn'); });
  const binding = backendInspectionBinding({ missionId: 'synthetic-mission', task: plan.tasks[0], attemptId: 'synthetic-attempt', scope });
  try {
    await assert.rejects(injected.inspect(new AbortController().signal, binding), /mission_cpu_terminal_unsupported_worker/);
    assert.equal(injectedSpawns, 0);
    const terminal = await pool.inspect(new AbortController().signal, binding);
    assert.equal(terminal.bindingDigest, binding);
    assert.throws(() => { terminal.bindingDigest = '0'.repeat(64); }, TypeError);
    assert.throws(() => { terminal.exit!.workerInstanceId = 'another-worker'; }, TypeError);
    assert.throws(() => { terminal.evidence.value.sha256 = '0'.repeat(64); }, TypeError);
  } finally { await pool.close(); await injected.close(); }
});


test('existing Retry reuses the original receipt and canonical reporting publishes that verification once', async () => {
  const f = await fixture();
  try {
    const before = f.read(), attempt = before.tasks[0].attempts[0];
    const value = f.raw();
    value.originConversationId = 'synthetic-origin';
    value.workroom = { kind: 'workroom', workspaceId: scope.workspaceId, title: 'Synthetic room', templateId: 'synthetic',
      missionConversationResourceId: 'synthetic-conversation' };
    f.write(value);
    const verified = f.service().control(before.id, scope, before.revision, { type: 'retry', taskId: 'source' });
    assert.equal(verified.tasks[0].state, 'verified');
    assert.equal(verified.tasks[0].attempts[0].id, attempt.id);
    assert.equal(verified.tasks[0].attempts.length, 1);
    assert.equal(f.entries(), 1);
    const milestone = lastMissionVerificationEvent(verified)!;
    assert.equal(milestone.kind, 'recovered');
    assert.equal(verified.events.filter(event => event.kind === 'settled').length, before.events.filter(event => event.kind === 'settled').length);
    const publication = new MissionPublication(f.db);
    f.db.exec('BEGIN'); publication.stage(f.raw(), before.events.length); f.db.exec('COMMIT');
    assert.equal(publication.hasReport(before.id), true);
    assert.equal(publication.hasConversation(before.id), true);
    let messages = 0;
    const conversation = new MissionConversationReceipts({ db: f.db, atomic: f.serviceHostAtomic,
      read: () => f.read(), allowed: () => true,
      append: (_id, content) => { messages++; assert.ok(content.includes(milestone.time)); return 'synthetic-message'; }, record() {} });
    assert.equal(conversation.publish(f.read(), () => {}), true);
    assert.equal(conversation.publish(f.read(), () => {}), true);
    assert.equal(messages, 1);
    const unsupported = structuredClone(verified);
    unsupported.tasks[0].attempts[0].backendInspection!.reconciledRevision = -1;
    assert.equal(lastMissionVerificationEvent(unsupported), undefined);
    unsupported.tasks[0].attempts = [];
    assert.equal(lastMissionVerificationEvent(unsupported), undefined);
  } finally { await f.close(); }
});

test('an authorized linked workroom can request Retry while the receipt remains bound to its originating scope', async () => {
  const f = await fixture();
  try {
    const before = f.raw(), attempt = before.tasks[0].attempts[0];
    before.workroom = { kind: 'workroom', workspaceId: 'synthetic-linked-workroom', title: 'Linked source workroom', templateId: 'synthetic' };
    f.write(before);
    const linkedScope = { ...scope, workspaceId: before.workroom.workspaceId };
    assert.throws(() => f.service().control(before.id, { ...scope, workspaceId: 'unlinked-workspace' }, before.revision,
      { type: 'retry', taskId: 'source' }), /mission_not_found/);
    assert.throws(() => f.service().control(before.id, { ...linkedScope, projectId: 'another-project' }, before.revision,
      { type: 'retry', taskId: 'source' }), /mission_not_found/);
    f.denyWorkspace(scope.workspaceId);
    assert.throws(() => f.service().control(before.id, linkedScope, before.revision,
      { type: 'retry', taskId: 'source' }), /mission_not_found/);
    assert.deepEqual(f.raw(), before);
    f.denyWorkspace();
    const verified = f.service().control(before.id, linkedScope, before.revision, { type: 'retry', taskId: 'source' });
    assert.equal(verified.tasks[0].state, 'verified');
    assert.deepEqual(verified.scope, scope);
    assert.equal(verified.tasks[0].attempts[0].id, attempt.id);
    assert.equal(verified.tasks[0].attempts[0].backendInspection?.terminal.bindingDigest,
      attempt.backendInspection?.terminal.bindingDigest);
    assert.equal(f.entries(), 1);
  } finally { await f.close(); }
});


test('verification-only recovery cannot reduce the measured peak of two actually running successors', async () => {
  const f = await fixture(false, false, false, true);
  try {
    const before = f.read();
    assert.equal(before.tasks[0].state, 'uncertain');
    assert.equal(before.tasks.filter(task => task.state === 'queued').length, 2);
    f.service().control(before.id, scope, before.revision, { type: 'retry', taskId: 'source' });
    await f.waitSuccessors();
    const overlapping = f.read();
    assert.equal(overlapping.tasks.filter(task => task.state === 'running').length, 2);
    assert.equal(overlapping.profile.peakWorkers, 2);
    assert.equal(f.entries(), 1);
    f.releaseSuccessors(); await f.waitSuccessorSettlement();
    const completed = f.read();
    assert.equal(completed.outcome, 'verified');
    assert.equal(completed.profile.peakWorkers, 2);
  } finally { await f.close(); }
});
