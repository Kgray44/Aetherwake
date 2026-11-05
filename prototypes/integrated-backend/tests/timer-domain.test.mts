import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fixture } from '../../timer-product/tests/fixture.mts';
import { createTimerDomain, type TimerDomain, type TimerDomainOptions, type TimerDomainScheduler, type TimerDeliveryReceipt } from '../src/timer-domain.mts';
import type { TrustedTimerClockPort } from '../src/timer-clock.mts';
import type { TimerOperation } from '../../timer-product/contracts.ts';

class Scheduler implements TimerDomainScheduler {
  next = 1; maxActive = 0;
  jobs = new Map<number, { callback: () => void; delayMs: number }>();
  setTimeout(callback: () => void, delayMs: number) { const id = this.next++; this.jobs.set(id, { callback, delayMs }); this.maxActive = Math.max(this.maxActive, this.jobs.size); return id; }
  clearTimeout(handle: unknown) { this.jobs.delete(Number(handle)); }
  first() { return this.jobs.values().next().value!; }
  fire() { const [id, job] = this.jobs.entries().next().value!; this.jobs.delete(id); job.callback(); }
}
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
async function until(check: () => boolean) { for (let i = 0; i < 100 && !check(); i++) await new Promise<void>(resolve => setImmediate(resolve)); assert.ok(check(), 'Expected asynchronous timer state'); }
function fakeClock(f: ReturnType<typeof fixture>): TrustedTimerClockPort {
  let disposed = false;
  return { ready: async () => {}, onResume: async () => {}, read: () => { if (disposed) throw Error('timer_clock_disposed'); return { ...f.clock }; },
    status: () => ({ state: disposed ? 'disposed' : 'ready', source: 'injected-trusted-elapsed', includesSuspend: !disposed, calibrationDurationMs: 0 }),
    dispose: () => { disposed = true; } };
}
async function setup(t: TestContext, extra: Partial<TimerDomainOptions> = {}, supplied?: ReturnType<typeof fixture>) {
  const f = supplied ?? fixture(t), scheduler = new Scheduler(), domain = createTimerDomain({ kernel: f.kernel, host: f.host, clock: fakeClock(f), scheduler, ...extra });
  t.after(() => domain.dispose()); await domain.ready;
  const create = () => domain.command({ name: 'create', input: { commandId: randomUUID(), title: 'Synthetic native clocks' } });
  const mutate = async (resourceId: string, operations: TimerOperation[]) => domain.command({ name: 'mutate', input: {
    commandId: randomUUID(), resourceId, expectedVersion: f.service.read(resourceId).resource.version, operations } });
  const add = (resourceId: string, durationMs = 1000) => mutate(resourceId, [{ type: 'createTimer', key: 'timer', name: 'Synthetic timer', durationMs, start: true }]);
  const settle = () => domain.command({ name: 'list', input: {} });
  return { f, scheduler, domain, create, mutate, add, settle };
}

test('one native loop schedules independent timers, rejects stale callbacks and never depends on UI visibility', async t => {
  const m = await setup(t), resource = await m.create(), first = await m.add(resource.resourceId, 120000);
  const stale = m.scheduler.first(); assert.equal(stale.delayMs, 60000);
  await m.add(resource.resourceId, 2000); assert.equal(m.scheduler.jobs.size, 1); assert.equal(m.scheduler.first().delayMs, 2000);
  await m.mutate(resource.resourceId, [{ type: 'resetTimer', timerId: first.createdIds.timer }]); stale.callback(); await m.settle();
  assert.equal(m.f.count('timer_expiries'), 0); m.f.advance(2000); m.scheduler.fire(); await m.settle();
  assert.equal(m.f.count('timer_expiries'), 1); assert.equal(m.f.service.read(resource.resourceId).timers[1].state, 'completed');
  assert.equal(m.scheduler.jobs.size, 0); assert.equal(m.scheduler.maxActive, 1);
  await m.domain.dispose(); stale.callback(); assert.equal(m.f.count('timer_documents'), 1);
});

test('command boundary is exact and read/list do not fabricate completion or duplicate resources', async t => {
  const m = await setup(t), resource = await m.create(); await m.add(resource.resourceId);
  m.f.advance(2000); const read = await m.domain.command({ name: 'read', input: { resourceId: resource.resourceId } });
  assert.equal(read.timers[0].due, true); assert.equal(read.timers[0].state, 'running'); assert.equal(m.f.count('timer_expiries'), 0);
  for (const request of [{ name: 'execute', input: {} }, { name: 'list', input: { grant: 'fake' } }, { name: 'read', input: { resourceId: resource.resourceId, hidden: true } },
    { name: 'list', input: {}, hidden: true }]) await assert.rejects(m.domain.command(request as any), /unsupported_clock_timer_command/u);
  assert.equal(m.f.count('resources'), 1); assert.equal(m.f.count('notes'), 0);
});

test('native synchronous factory composes empty clock identity/document in the owning transaction', async t => {
  const m = await setup(t);
  const created = m.f.kernel.withTransaction(() => m.domain.createCanonical({ commandId: 'synthetic:native-factory', title: 'Native canonical clock' }));
  assert.equal((await m.domain.command({ name: 'read', input: { resourceId: created.resourceId } })).timers.length, 0);
  assert.equal(m.scheduler.jobs.size, 0);
  assert.throws(() => m.f.kernel.withTransaction(() => {
    m.domain.createCanonical({ commandId: 'synthetic:rolled-back-factory', title: 'Rollback clock' }); throw Error('Outer rollback');
  }), /Outer rollback/u);
  assert.equal(m.f.count('resources'), 1); assert.equal(m.f.count('timer_documents'), 1);
});

test('default native Node wake timeout reconciles and delivers a real SQLite timer without a view', async t => {
  const f = fixture(t), received = deferred<void>(); let delivered = 0;
  const domain = createTimerDomain({ kernel: f.kernel, host: f.host, clock: fakeClock(f), deliverExpiry: input => {
    delivered++; received.resolve(); return { delivered: true, deliveryId: input.deliveryId, receiptId: 'receipt:native-timeout' };
  } }); t.after(() => domain.dispose()); await domain.ready;
  const resource = domain.createCanonical({ commandId: 'synthetic:node-wake', title: 'Native timeout clock' });
  await domain.command({ name: 'mutate', input: { commandId: 'synthetic:node-running', resourceId: resource.resourceId, expectedVersion: resource.version,
    operations: [{ type: 'createTimer', key: 'timer', name: 'Native wake timer', durationMs: 20, start: true }] } });
  f.advance(20);
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([received.promise, new Promise<never>((_resolve, reject) => { deadline = setTimeout(() => reject(Error('Native wake did not run')), 3000); })]); }
  finally { clearTimeout(deadline); }
  await domain.command({ name: 'list', input: {} });
  assert.equal(delivered, 1); assert.equal(f.service.read(resource.resourceId).timers[0].state, 'completed'); assert.equal(f.count('timer_delivery_receipts'), 1);
});

test('domain clock jumps preserve monotonic deadlines and exact command replay preserves canonical IDs', async t => {
  const m = await setup(t), input = { commandId: 'synthetic:create-clock', title: 'Replayable clock' };
  const resource = await m.domain.command({ name: 'create', input });
  assert.deepEqual(await m.domain.command({ name: 'create', input }), resource); assert.equal(m.f.count('resources'), 1);
  const mutation = { commandId: 'synthetic:create-running-timer', resourceId: resource.resourceId, expectedVersion: resource.version,
    operations: [{ type: 'createTimer', key: 'timer', name: 'Jump-safe', durationMs: 10000, start: true }] as TimerOperation[] };
  const added = await m.domain.command({ name: 'mutate', input: mutation });
  assert.deepEqual(await m.domain.command({ name: 'mutate', input: mutation }), added);
  m.f.advance(2000); m.f.clock.epochMs += 3600000; await m.domain.reconcile(resource.resourceId);
  assert.equal(m.f.service.read(resource.resourceId).timers[0].remainingMs, 8000); assert.equal(m.scheduler.first().delayMs, 8000);
  m.f.advance(1000); m.f.clock.epochMs -= 7200000; await m.domain.reconcile(resource.resourceId);
  assert.equal(m.f.service.read(resource.resourceId).timers[0].remainingMs, 7000); assert.equal(m.scheduler.first().delayMs, 7000);
  m.f.advance(7000); m.scheduler.fire(); await m.settle();
  assert.equal(m.f.service.read(resource.resourceId).pendingExpiries[0].wallRecovery, false); assert.equal(m.f.count('timer_expiries'), 1);
});

test('expiry delivery uses a stable identity and ACK only follows an exact idempotent receipt', async t => {
  const deliveries = new Map<string, TimerDeliveryReceipt>(), seen: string[] = [];
  const m = await setup(t, { deliverExpiry: input => {
    seen.push(input.deliveryId); const receipt = deliveries.get(input.deliveryId) ?? { delivered: true, deliveryId: input.deliveryId, receiptId: 'receipt:' + input.expiry.id };
    deliveries.set(input.deliveryId, receipt); return receipt;
  } });
  const resource = await m.create(); await m.add(resource.resourceId); m.f.advance(1000); await m.domain.reconcile(resource.resourceId);
  assert.equal(seen.length, 1); assert.equal(m.f.count('timer_delivery_receipts'), 1); assert.equal(m.f.service.read(resource.resourceId).pendingExpiries.length, 0);
  await m.domain.reconcile(resource.resourceId); assert.equal(seen.length, 1); assert.equal(deliveries.size, 1);
});

test('delivery/ACK event failure rolls back receipt and ACK, then an explicit retry reuses the same delivery ID', async t => {
  const receipts = new Map<string, TimerDeliveryReceipt>(), calls: string[] = [], errors: unknown[] = [];
  let f!: ReturnType<typeof fixture>, failAck = true;
  const m = await setup(t, { onError: error => errors.push(error), deliverExpiry: input => {
    calls.push(input.deliveryId); const receipt = receipts.get(input.deliveryId) ?? { delivered: true, deliveryId: input.deliveryId, receiptId: 'receipt:' + input.expiry.id };
    receipts.set(input.deliveryId, receipt); if (failAck) f.failEvent(); return receipt;
  } }); f = m.f;
  const resource = await m.create(); await m.add(resource.resourceId); f.advance(1000); await m.domain.reconcile(resource.resourceId);
  assert.equal(f.count('timer_expiries'), 1); assert.equal(f.count('timer_delivery_receipts'), 0); assert.equal(f.service.read(resource.resourceId).pendingExpiries.length, 1);
  assert.equal(m.scheduler.jobs.size, 0); assert.ok(errors.some((error: any) => error.phase === 'delivery'));
  failAck = false; f.failEvent(false); await m.domain.reconcile(resource.resourceId);
  assert.equal(calls.length, 2); assert.equal(calls[0], calls[1]); assert.equal(receipts.size, 1);
  assert.equal(f.count('timer_delivery_receipts'), 1); assert.equal(f.service.read(resource.resourceId).pendingExpiries.length, 0);
});

test('declined or malformed delivery stays pending without retry timers; revocation blocks ACK', async t => {
  let calls = 0, behavior = 'decline';
  const m = await setup(t, { deliverExpiry: input => {
    calls++;
    if (behavior === 'decline') return null;
    if (behavior === 'mismatch') return { delivered: true, deliveryId: 'another-expiry', receiptId: 'receipt:a' };
    m.f.revoked.add(input.resource.id); return { delivered: true, deliveryId: input.deliveryId, receiptId: 'receipt:a' };
  } });
  const resource = await m.create(); await m.add(resource.resourceId); m.f.advance(1000); await m.domain.reconcile(resource.resourceId);
  assert.equal(calls, 1); assert.equal(m.scheduler.jobs.size, 0); await m.settle(); assert.equal(calls, 1);
  behavior = 'mismatch'; await m.domain.reconcile(resource.resourceId); assert.equal(m.f.count('timer_delivery_receipts'), 0);
  behavior = 'revoke'; await m.domain.reconcile(resource.resourceId); assert.equal(m.f.count('timer_delivery_receipts'), 0);
  m.f.revoked.clear(); assert.equal(m.f.service.read(resource.resourceId).pendingExpiries.length, 1);
});

test('expiry batches are bounded and use the same one timeout to drain successful backlog', async t => {
  const delivered = new Set<string>(), m = await setup(t, { deliverExpiry: input => {
    delivered.add(input.deliveryId); return { delivered: true, deliveryId: input.deliveryId, receiptId: 'receipt:' + input.expiry.id };
  } });
  const resource = await m.create();
  for (const count of [32, 8]) await m.mutate(resource.resourceId, Array.from({ length: count }, (_, i) => ({ type: 'createTimer', key: 't' + i, name: 'Bounded timer', durationMs: 1000, start: true })));
  m.f.advance(1000); await m.domain.reconcile(resource.resourceId);
  assert.equal(delivered.size, 16); assert.equal(m.scheduler.jobs.size, 1); assert.equal(m.scheduler.first().delayMs, 1000);
  m.f.advance(1000); m.scheduler.fire(); await m.settle(); assert.equal(delivered.size, 32); assert.equal(m.scheduler.jobs.size, 1);
  m.f.advance(1000); m.scheduler.fire(); await m.settle(); assert.equal(delivered.size, 40); assert.equal(m.scheduler.jobs.size, 0); assert.equal(m.scheduler.maxActive, 1);
});

test('async resume recalibrates before queued commands and reconciles overdue timers without provider activity', async t => {
  const f = fixture(t), gate = deferred<void>(), base = fakeClock(f); let resumed = false, readsDuringResume = 0;
  const clock = { ...base, onResume: async () => { await gate.promise; resumed = true; }, read: () => {
    if (!resumed) readsDuringResume++; return base.read();
  } };
  const m = await setup(t, { clock }, f), resource = await m.create(); await m.add(resource.resourceId, 5000);
  const before = readsDuringResume, resume = m.domain.onResume(); assert.equal(m.domain.onResume(), resume);
  let completed = false; const command = m.domain.command({ name: 'read', input: { resourceId: resource.resourceId } }).then(result => { completed = true; return result; });
  await Promise.resolve(); assert.equal(completed, false); assert.equal(readsDuringResume, before);
  f.advance(10000); gate.resolve(); await resume; assert.equal((await command).timers[0].state, 'completed');
  assert.equal(readsDuringResume, before); assert.equal(m.scheduler.jobs.size, 0);
});

test('clock startup failure installs no retry loop and cannot create resources until explicit successful resume', async t => {
  const f = fixture(t), scheduler = new Scheduler(); let available = false, warmups = 0;
  const clock: TrustedTimerClockPort = { ...fakeClock(f), ready: async () => { warmups++; throw Error('timer_sample_unavailable'); },
    read: () => { if (!available) throw Error('timer_sample_unavailable'); return { ...f.clock }; }, onResume: async () => { available = true; } };
  const domain = createTimerDomain({ kernel: f.kernel, host: f.host, clock, scheduler }); t.after(() => domain.dispose());
  await assert.rejects(domain.ready, /timer_sample_unavailable/u);
  await assert.rejects(domain.command({ name: 'create', input: { commandId: 'denied-clock', title: 'No clock' } }), /timer_sample_unavailable/u);
  assert.equal(f.count('resources'), 0); assert.equal(warmups, 1); assert.equal(scheduler.jobs.size, 0);
  await domain.onResume(); await domain.command({ name: 'create', input: { commandId: 'ready-clock', title: 'Ready clock' } }); assert.equal(f.count('resources'), 1);
});

test('delivery deadline is bounded and safe disposal prevents late receipts from mutating the canonical DB', async t => {
  const receipt = deferred<TimerDeliveryReceipt | null>(); let input: Parameters<NonNullable<TimerDomainOptions['deliverExpiry']>>[0] | undefined;
  const m = await setup(t, { deliveryTimeoutMs: 50, deliverExpiry: value => { input = value; return receipt.promise; } });
  const resource = await m.create(); await m.add(resource.resourceId); m.f.advance(1000);
  const operation = m.domain.reconcile(resource.resourceId); await until(() => !!input);
  await m.domain.dispose(); await operation; assert.equal(input!.signal.aborted, true); assert.equal(m.scheduler.jobs.size, 0);
  receipt.resolve({ delivered: true, deliveryId: input!.deliveryId, receiptId: 'receipt:late' }); await Promise.resolve();
  assert.equal(m.f.count('timer_delivery_receipts'), 0); assert.equal(m.f.service.read(resource.resourceId).pendingExpiries.length, 1);
  await assert.rejects(m.domain.command({ name: 'list', input: {} }), /timer_domain_disposed/u);
});

test('hung delivery times out once, leaving a durable pending expiry and no retry loop', async t => {
  let calls = 0;
  const m = await setup(t, { deliveryTimeoutMs: 50, deliverExpiry: () => { calls++; return new Promise(() => {}); } });
  const resource = await m.create(); await m.add(resource.resourceId); m.f.advance(1000);
  const operation = m.domain.reconcile(resource.resourceId);
  await new Promise(resolve => setTimeout(resolve, 80)); await operation;
  assert.equal(calls, 1); assert.equal(m.f.service.read(resource.resourceId).pendingExpiries.length, 1); assert.equal(m.scheduler.jobs.size, 0);
});

test('persistent reopen recovers wall deadlines with uncertainty and delivers the existing expiry exactly once', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'aerynth-native-timer-')), opened: ReturnType<typeof fixture>[] = [], domains: TimerDomain[] = [];
  t.after(async () => {
    for (const domain of domains) await domain.dispose(); opened.forEach(f => f.close());
    assert.equal(resolve(dirname(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith('aerynth-native-timer-'));
    rmSync(directory, { recursive: true, force: true });
  });
  const path = join(directory, 'canonical.db'), first = fixture(t, path); opened.push(first);
  const m = await setup(t, {}, first); domains.push(m.domain); const resource = await m.create(); await m.add(resource.resourceId, 3000);
  const initialEpoch = first.clock.epochMs; await m.domain.dispose(); first.close();
  const reopened = fixture(t, path); opened.push(reopened); reopened.clock.epochMs = initialEpoch + 6000; reopened.clock.sessionId = 'synthetic-restarted'; reopened.clock.monotonicMs = 0;
  const deliveries: string[] = [], n = await setup(t, { deliverExpiry: input => {
    assert.equal(input.expiry.wallRecovery, true); deliveries.push(input.deliveryId); return { delivered: true, deliveryId: input.deliveryId, receiptId: 'receipt:reopen' };
  } }, reopened); domains.push(n.domain);
  assert.equal(reopened.service.read(resource.resourceId).timers[0].state, 'completed'); assert.equal(deliveries.length, 0, 'Startup does not wait behind delivery IO');
  n.scheduler.fire(); await n.settle(); assert.equal(deliveries.length, 1); assert.equal(reopened.service.read(resource.resourceId).pendingExpiries.length, 0);
  await n.domain.dispose(); reopened.close();
  const again = fixture(t, path); opened.push(again); const last = await setup(t, { deliverExpiry: () => { throw Error('Duplicate native delivery'); } }, again); domains.push(last.domain);
  assert.equal(last.scheduler.jobs.size, 0); assert.equal(again.count('timer_delivery_receipts'), 1); assert.equal(deliveries.length, 1);
});

test('prepared canonical create is effect free until atomic apply, returns real IDs and replays the whole recipe', async t => {
  const m = await setup(t), signal = new AbortController().signal;
  const request = { name: 'create' as const, input: { commandId: 'synthetic:prepared-create', title: 'Prepared clock', operations: [
    { type: 'createTimer' as const, key: 'tea', name: 'Tea', durationMs: 10000, start: true },
    { type: 'stopwatchStart' as const }, { type: 'addWorldClock' as const, key: 'tokyo', label: 'Tokyo', timeZone: 'Asia/Tokyo' }] } };
  let validations = 0;
  const apply = await m.domain.prepareCanonical(request, { signal, validate: () => { validations++; } });
  assert.equal(m.f.count('resources'), 0); assert.equal(m.f.count('timer_receipts'), 0); assert.equal(m.f.events().length, 0); assert.equal(m.scheduler.jobs.size, 0);
  request.input.title = 'Mutated outside the recipe';
  const result = m.f.kernel.withTransaction(() => apply()); assert.ok(result.name === 'create');
  assert.equal(result.document.resource.title, 'Prepared clock'); assert.equal(result.document.timers[0].state, 'running');
  assert.equal(result.document.stopwatch.state, 'running'); assert.equal(result.document.worldClocks[0].timeZone, 'Asia/Tokyo');
  assert.deepEqual(result.operationIds.timerIds, [result.mutation.createdIds.tea]); assert.deepEqual(result.operationIds.clockIds, [result.mutation.createdIds.tokyo]);
  assert.equal(result.document.resource.version, result.mutation.version); assert.equal(result.postconditions.receiptMatchesCurrent, true);
  assert.equal(m.scheduler.jobs.size, 0, 'No native scheduling inside caller transaction');
  await until(() => m.scheduler.jobs.size === 1); assert.equal(m.scheduler.first().delayMs, 10000);
  const before = m.f.events().length, replay = apply(); assert.ok(replay.name === 'create');
  assert.deepEqual(replay.mutation, result.mutation); assert.equal(validations, 2); assert.equal(m.f.count('resources'), 1); assert.equal(m.f.events().length, before);
  const conflict = await m.domain.prepareCanonical({ name: 'create', input: { ...request.input, title: 'Prepared clock', operations: [] } }, { signal });
  assert.throws(conflict, /timer_command_conflict/u); assert.equal(m.f.count('resources'), 1);
});

test('prepared canonical create rolls back generic identity, document, timers, command receipts and events together', async t => {
  const m = await setup(t), apply = await m.domain.prepareCanonical({ name: 'create', input: { commandId: 'synthetic:rollback-all', title: 'Rollback all',
    operations: [{ type: 'createTimer', key: 'timer', name: 'Never committed', durationMs: 1000, start: true }] } }, { signal: new AbortController().signal });
  assert.throws(() => m.f.kernel.withTransaction(() => { apply(); throw Error('Outer receipt failed'); }), /Outer receipt failed/u);
  for (const table of ['resources', 'timer_documents', 'timer_expiries', 'timer_receipts', 'synthetic_timer_events']) assert.equal(m.f.count(table), 0);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(m.scheduler.jobs.size, 0);
  const result = apply(); assert.ok(result.name === 'create'); assert.equal(result.document.timers.length, 1);
  await until(() => m.scheduler.jobs.size === 1);
});

test('prepared mutation outer rollback preserves the old timer and wake with no leaked expiry or event', async t => {
  let delivered = 0;
  const m = await setup(t, { deliverExpiry: input => { delivered++; return { delivered: true, deliveryId: input.deliveryId, receiptId: 'receipt:after-rollback' }; } });
  const resource = await m.create(), initial = await m.add(resource.resourceId, 10000), oldWake = m.scheduler.first(); m.f.advance(1000);
  const before = m.f.events().length, receipts = m.f.count('timer_receipts');
  const apply = await m.domain.prepareCanonical({ name: 'mutate', input: { commandId: 'synthetic:rollback-expiry', resourceId: resource.resourceId,
    expectedVersion: initial.version, operations: [{ type: 'shortenTimer', timerId: initial.createdIds.timer, amountMs: 9900 }] } }, { signal: new AbortController().signal });
  assert.equal(m.scheduler.first(), oldWake);
  assert.throws(() => m.f.kernel.withTransaction(() => {
    const result = apply(); assert.ok(result.name === 'mutate'); assert.equal(result.document.timers[0].state, 'completed');
    assert.equal(m.scheduler.first(), oldWake, 'The old wake remains installed until the outer transaction settles');
    throw Error('Outer Vela receipt rolled back');
  }), /Outer Vela receipt rolled back/u);
  assert.equal(m.f.count('timer_expiries'), 0); assert.equal(m.f.events().length, before); assert.equal(m.f.count('timer_receipts'), receipts); assert.equal(delivered, 0);
  const document = m.f.service.read(resource.resourceId); assert.equal(document.resource.version, initial.version);
  assert.equal(document.timers[0].state, 'running'); assert.equal(document.timers[0].remainingMs, 9000);
  await until(() => m.scheduler.first().delayMs === 9000); assert.equal(m.scheduler.jobs.size, 1); assert.equal(m.scheduler.maxActive, 1);
  m.f.advance(9000); m.scheduler.fire(); await m.settle();
  assert.equal(delivered, 1); assert.equal(m.f.count('timer_expiries'), 1); assert.equal(m.f.service.read(resource.resourceId).timers[0].state, 'completed');
});

test('prepared mutations recheck canonical version, access, write authority and caller grant at synchronous commit', async t => {
  const m = await setup(t), resource = await m.create(), initial = await m.add(resource.resourceId, 10000), signal = new AbortController().signal;
  const request = () => ({ name: 'mutate' as const, input: { commandId: randomUUID(), resourceId: resource.resourceId,
    expectedVersion: m.f.service.read(resource.resourceId).resource.version, operations: [{ type: 'pauseTimer' as const, timerId: initial.createdIds.timer }] } });
  const stale = await m.domain.prepareCanonical(request(), { signal });
  await m.mutate(resource.resourceId, [{ type: 'renameTimer', timerId: initial.createdIds.timer, name: 'Renamed' }]);
  assert.throws(stale, /timer_version_conflict/u);
  const revoked = await m.domain.prepareCanonical(request(), { signal }); m.f.revoked.add(resource.resourceId);
  assert.throws(revoked, /timer_unavailable/u); m.f.revoked.clear();
  const readOnly = await m.domain.prepareCanonical(request(), { signal }); m.f.readOnly.add(resource.resourceId);
  assert.throws(readOnly, /timer_read_only/u); m.f.readOnly.clear();
  let granted = true;
  const authority = await m.domain.prepareCanonical(request(), { signal, validate: () => { if (!granted) throw Error('synthetic_grant_revoked'); } });
  granted = false; assert.throws(authority, /synthetic_grant_revoked/u);
  assert.equal(m.f.service.read(resource.resourceId).timers[0].state, 'running'); assert.equal(m.f.count('timer_expiries'), 0);
});

test('prepared commands reject cancellation before prepare, after prepare and during authority validation', async t => {
  const m = await setup(t), resource = await m.create(), initial = await m.add(resource.resourceId, 10000);
  const request = { name: 'mutate' as const, input: { commandId: 'synthetic:abort', resourceId: resource.resourceId,
    expectedVersion: initial.version, operations: [{ type: 'pauseTimer' as const, timerId: initial.createdIds.timer }] } };
  const early = new AbortController(); early.abort(); await assert.rejects(m.domain.prepareCanonical(request, { signal: early.signal }), /timer_preparation_cancelled/u);
  const later = new AbortController(), apply = await m.domain.prepareCanonical(request, { signal: later.signal }); later.abort(); assert.throws(apply, /timer_preparation_cancelled/u);
  const boundary = new AbortController(), race = await m.domain.prepareCanonical(request, { signal: boundary.signal, validate: () => boundary.abort() });
  assert.throws(race, /timer_preparation_cancelled/u); assert.equal(m.f.service.read(resource.resourceId).timers[0].state, 'running');
  assert.equal(m.f.events().length, 2); assert.equal(m.scheduler.jobs.size, 1);
});

test('prepared reads/list/clock queries remain authorized reads and do not reconcile due timers', async t => {
  const m = await setup(t), resource = await m.create(), initial = await m.add(resource.resourceId, 1000), signal = new AbortController().signal; m.f.advance(2000);
  const before = m.f.events().length;
  const read = (await m.domain.prepareCanonical({ name: 'read', input: { resourceId: resource.resourceId, expectedVersion: initial.version } }, { signal }))();
  assert.ok(read.name === 'read'); assert.equal(read.document.timers[0].due, true); assert.equal(read.document.timers[0].state, 'running');
  const listed = (await m.domain.prepareCanonical({ name: 'list', input: { resourceIds: [resource.resourceId] } }, { signal }))();
  assert.ok(listed.name === 'list'); assert.equal(listed.documents.length, 1);
  const clock = (await m.domain.prepareCanonical({ name: 'readClock', input: { timeZone: 'Asia/Tokyo' } }, { signal }))();
  assert.ok(clock.name === 'readClock'); assert.equal(clock.clock.timeZone, 'Asia/Tokyo'); assert.equal(clock.clock.epochMs, m.f.clock.epochMs);
  assert.equal(m.f.count('resources'), 1); assert.equal(m.f.count('timer_expiries'), 0); assert.equal(m.f.events().length, before);
  const denied = await m.domain.prepareCanonical({ name: 'list', input: { resourceIds: [resource.resourceId] } }, { signal }); m.f.revoked.add(resource.resourceId);
  assert.throws(denied, /timer_unavailable/u);
});

test('prepared seam queues behind clock resume and rejects synchronous commit after disposal', async t => {
  const f = fixture(t), gate = deferred<void>(), base = fakeClock(f);
  const m = await setup(t, { clock: { ...base, onResume: () => gate.promise } }, f), resource = await m.create();
  const resume = m.domain.onResume(); let prepared = false;
  const preparation = m.domain.prepareCanonical({ name: 'read', input: { resourceId: resource.resourceId } }, { signal: new AbortController().signal }).then(apply => { prepared = true; return apply; });
  await Promise.resolve(); assert.equal(prepared, false); gate.resolve(); await resume;
  const apply = await preparation; await m.domain.dispose(); assert.throws(apply, /timer_domain_disposed/u);
});

test('preparation never opens host atomic or changes scheduling, including scoped read preparation', async t => {
  const f = fixture(t); let transactions = 0;
  const m = await setup(t, { host: { ...f.host, atomic: work => { transactions++; return f.host.atomic(work); } } }, f);
  const resource = await m.create(), initial = await m.add(resource.resourceId, 10000), wake = m.scheduler.first(), before = transactions;
  const signal = new AbortController().signal;
  for (const request of [
    { name: 'create' as const, input: { commandId: 'synthetic:unapplied-create', title: 'No effects', operations: [] } },
    { name: 'mutate' as const, input: { commandId: 'synthetic:unapplied-mutation', resourceId: resource.resourceId,
      expectedVersion: initial.version, operations: [{ type: 'pauseTimer' as const, timerId: initial.createdIds.timer }] } },
    { name: 'read' as const, input: { resourceId: resource.resourceId, expectedVersion: initial.version } },
    { name: 'list' as const, input: { resourceIds: [resource.resourceId] } }, { name: 'readClock' as const, input: { timeZone: 'UTC' } },
  ]) await m.domain.prepareCanonical(request, { signal });
  assert.equal(transactions, before); assert.equal(m.scheduler.first(), wake); assert.equal(m.f.events().length, 2); assert.equal(m.f.count('resources'), 1);
});
