import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { setImmediate as flush } from 'node:timers/promises';
import { MissionService, type MissionServiceHost } from '../src/mission-service.mts';
import type { Mission, MissionPlan } from '../src/mission-contracts.mts';

const scope = { workspaceId: 'synthetic-workspace', projectId: null };
const plan: MissionPlan = { scope, objective: 'Synthetic dispatch recovery', criteria: ['done'], tasks: [{
  id: 'effect', executor: 'effect', objective: 'Synthetic local effect', criterion: 'done', dependencies: [],
  claims: [{ resource: 'shared-target', mode: 'exclusive' }], timeoutMs: 2000, maxAttempts: 1,
}] };
function fixture() {
  const db = new DatabaseSync(':memory:');
  let entries = 0, release: (() => void) | undefined, access = true, failPublication = false;
  const host: MissionServiceHost = { db, authorized: () => access, laneLimit: () => 2,
    atomic<T>(work: () => T): T { db.exec('BEGIN'); try { const value = work(); db.exec('COMMIT'); return value; }
      catch (error) { db.exec('ROLLBACK'); throw error; } },
    stagePublication() { if (failPublication) throw Error('synthetic-publication-failure'); },
    executors: { effect: { lane: 'synthetic', replaySafe: false, available: () => true,
      async run() { entries++; await new Promise<void>(resolve => { release = resolve; }); return { source: 'synthetic', value: true }; },
      verify: () => ({ passed: true, detail: 'Synthetic postcondition' }) } },
  };
  const raw = (id: string): Mission => JSON.parse(String(db.prepare('SELECT json FROM vela_missions WHERE id=?').get(id)!.json));
  return { db, host, raw, entries: () => entries, release: () => release?.(), revoke: () => { access = false; },
    fail: () => { failPublication = true; }, clearFailure: () => { failPublication = false; } };
}

test('reserved recovery atomically proves no dispatch and fences the old continuation before run', async () => {
  const f = fixture(), old = new MissionService(f.host); let recovered: MissionService | undefined;
  try {
    const created = old.create('reserved-recovery', plan); await Promise.resolve();
    const reserved = old.read(created.id, scope);
    assert.equal(reserved.tasks[0].attempts[0].dispatch?.state, 'reserved');
    assert.equal(f.entries(), 0);
    // Same canonical database, modelling takeover; the old continuation is deliberately still queued.
    recovered = new MissionService(f.host);
    const terminal = recovered.read(created.id, scope), attempt = terminal.tasks[0].attempts[0];
    assert.equal(terminal.tasks[0].state, 'failed');
    assert.equal(attempt.reconciliation?.outcome, 'not-dispatched');
    assert.equal(attempt.reconciliation?.attemptId, attempt.id);
    assert.equal(attempt.reconciliation?.reservedRevision, reserved.tasks[0].attempts[0].dispatch?.reservedRevision);
    assert.equal(attempt.reconciliation?.observedRevision, reserved.revision);
    await flush();
    assert.equal(f.entries(), 0, 'old continuation cannot invoke the effect after recovery');
    assert.deepEqual(recovered.read(created.id, scope), terminal, 'late settlement cannot overwrite recovery');
    await recovered.close(); recovered = new MissionService(f.host);
    assert.deepEqual(recovered.read(created.id, scope).tasks[0].attempts[0], attempt);
    const next = recovered.create('new-explicit-request', plan); await flush();
    assert.equal(f.entries(), 1, 'only separately requested work may execute');
    assert.equal(recovered.read(next.id, scope).tasks[0].state, 'running');
  } finally { f.release(); await old.close(); await recovered?.close(); f.db.close(); }
});

test('entered recovery remains uncertain; late original output cannot erase its fence or create no-effect proof', async () => {
  const f = fixture(), old = new MissionService(f.host); let recovered: MissionService | undefined;
  try {
    const created = old.create('entered-recovery', plan); await flush();
    assert.equal(f.entries(), 1);
    assert.equal(old.read(created.id, scope).tasks[0].attempts[0].dispatch?.state, 'entered');
    recovered = new MissionService(f.host);
    const before = recovered.read(created.id, scope);
    assert.equal(before.tasks[0].state, 'uncertain');
    assert.equal(before.tasks[0].attempts[0].reconciliation, undefined);
    f.release(); await flush();
    assert.deepEqual(recovered.read(created.id, scope), before);
    const next = recovered.create('conflicting-request', plan); await flush();
    assert.equal(recovered.read(next.id, scope).waits.effect, 'resource-conflict');
    assert.equal(f.entries(), 1);
  } finally { f.release(); await old.close(); await recovered?.close(); f.db.close(); }
});

for (const variant of ['legacy', 'wrong-attempt', 'wrong-revision', 'wrong-contract'] as const)
  test(`${variant} reservation cannot supply no-dispatch recovery proof`, async () => {
    const f = fixture(), old = new MissionService(f.host); let recovered: MissionService | undefined;
    try {
      const created = old.create(variant, plan); await Promise.resolve();
      const m = f.raw(created.id), a = m.tasks[0].attempts[0];
      if (variant === 'legacy') delete a.dispatch;
      else if (variant === 'wrong-attempt') a.dispatch!.attemptId = 'another-attempt';
      else if (variant === 'wrong-revision') a.dispatch!.reservedRevision++;
      else (a.dispatch as unknown as { contract: string }).contract = 'unsupported';
      f.db.prepare('UPDATE vela_missions SET json=? WHERE id=?').run(JSON.stringify(m), m.id);
      recovered = new MissionService(f.host); await flush();
      const observed = recovered.read(created.id, scope);
      assert.equal(observed.tasks[0].state, 'uncertain');
      assert.equal(observed.tasks[0].attempts[0].reconciliation, undefined);
      assert.equal(f.entries(), 0);
    } finally { f.release(); await old.close(); await recovered?.close(); f.db.close(); }
  });

test('recovery publication failure rolls back terminal state and receipt together', async () => {
  const f = fixture(), old = new MissionService(f.host); let recovered: MissionService | undefined;
  try {
    const created = old.create('atomic-recovery', plan); await Promise.resolve();
    const before = f.raw(created.id);
    f.fail();
    assert.throws(() => new MissionService(f.host), /synthetic-publication-failure/);
    assert.deepEqual(f.raw(created.id), before);
    f.clearFailure(); recovered = new MissionService(f.host); await flush();
    assert.equal(recovered.read(created.id, scope).tasks[0].attempts[0].reconciliation?.outcome, 'not-dispatched');
    assert.equal(f.entries(), 0);
  } finally { f.release(); await old.close(); await recovered?.close(); f.db.close(); }
});

test('scope revocation blocks run and public projection; internal no-dispatch receipt grants no access', async () => {
  const f = fixture(), service = new MissionService(f.host);
  try {
    const created = service.create('revoked', plan); await Promise.resolve(); f.revoke(); await flush();
    assert.equal(f.entries(), 0);
    assert.equal(f.raw(created.id).tasks[0].state, 'blocked');
    assert.equal(f.raw(created.id).tasks[0].attempts[0].reconciliation?.outcome, 'not-dispatched');
    assert.throws(() => service.read(created.id, scope), /mission_not_found/);
    assert.throws(() => service.read(created.id, { ...scope, workspaceId: 'wrong-workspace' }), /mission_not_found/);
  } finally { f.release(); await service.close(); f.db.close(); }
});
