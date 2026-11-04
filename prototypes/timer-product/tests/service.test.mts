import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fixture } from './fixture.mts';
import { TimerError, TimerService } from '../service.mts';
import { TIMER_LIMITS as L, type TimerOperation } from '../contracts.ts';

const code = (expected: string) => (error: unknown) => error instanceof TimerError && error.code === expected;
const timer = (f: ReturnType<typeof fixture>, resourceId: string, index = 0) => f.service.read(resourceId).timers[index];
const add = (f: ReturnType<typeof fixture>, resourceId: string, durationMs = 10000, start = false) =>
  f.mutate(resourceId, [{ type: 'createTimer', key: 'timer', name: 'Synthetic timer', durationMs, start }]).createdIds.timer;

test('creates canonical generic identity with semantic clock_timer and no note or placement', t => {
  const f = fixture(t), r = f.create();
  assert.equal(f.kernel.getResource(r.resourceId).resource.kind, 'generic');
  assert.equal(f.service.read(r.resourceId).resource.kind, 'clock_timer');
  assert.equal(f.service.read(r.resourceId).localClock.timeZone, f.clock.timeZone);
  assert.equal(f.service.list()[0].id, r.resourceId);
  assert.equal(f.count('notes'), 0); assert.equal(f.count('blocks'), 0);
  assert.deepEqual(f.events().map(e => e.type), ['clock_timer.created']);
});

test('all timer lifecycle operations preserve elapsed state and stable IDs', t => {
  const f = fixture(t), r = f.create(), id = add(f, r.resourceId);
  assert.equal(timer(f, r.resourceId).state, 'ready');
  assert.throws(() => f.mutate(r.resourceId, [{ type: 'resumeTimer', timerId: id }]), code('timer_invalid_transition'));
  f.mutate(r.resourceId, [{ type: 'startTimer', timerId: id }]);
  const run = timer(f, r.resourceId).runId; f.advance(3000);
  f.mutate(r.resourceId, [{ type: 'pauseTimer', timerId: id }]);
  assert.equal(timer(f, r.resourceId).remainingMs, 7000); f.advance(5000);
  assert.equal(timer(f, r.resourceId).remainingMs, 7000);
  f.mutate(r.resourceId, [{ type: 'resumeTimer', timerId: id }, { type: 'extendTimer', timerId: id, amountMs: 4000 }]);
  assert.equal(timer(f, r.resourceId).runId, run); assert.equal(timer(f, r.resourceId).remainingMs, 11000);
  f.advance(1000);
  f.mutate(r.resourceId, [{ type: 'shortenTimer', timerId: id, amountMs: 2000 }, { type: 'renameTimer', timerId: id, name: 'Renamed' }]);
  assert.equal(timer(f, r.resourceId).remainingMs, 8000); assert.equal(timer(f, r.resourceId).name, 'Renamed');
  f.mutate(r.resourceId, [{ type: 'cancelTimer', timerId: id }]);
  assert.equal(timer(f, r.resourceId).state, 'cancelled');
  assert.throws(() => f.mutate(r.resourceId, [{ type: 'startTimer', timerId: id }]), code('timer_invalid_transition'));
  f.mutate(r.resourceId, [{ type: 'resetTimer', timerId: id }]);
  assert.equal(timer(f, r.resourceId).state, 'ready'); assert.equal(timer(f, r.resourceId).remainingMs, 12000);
  assert.notEqual(timer(f, r.resourceId).runId, run); assert.equal(timer(f, r.resourceId).id, id);
  f.mutate(r.resourceId, [{ type: 'deleteTimer', timerId: id }]); assert.equal(f.service.read(r.resourceId).timers.length, 0);
});

test('concurrent timers and two workspace representations share one canonical document', t => {
  const f = fixture(t), r = f.create(), first = add(f, r.resourceId, 5000, true), second = add(f, r.resourceId, 2000, true);
  const a = f.kernel.createWorkspace('Synthetic left'), b = f.kernel.createWorkspace('Synthetic right');
  const p = { x: 0, y: 0, width: 300, height: 250, z: 1 };
  const left = f.kernel.attachBlock(a.id, r.resourceId, p), right = f.kernel.attachBlock(b.id, r.resourceId, p);
  assert.notEqual(left.id, right.id);
  assert.equal(f.service.nextWake()!.timerId, second);
  f.advance(2000); f.service.reconcile(r.resourceId);
  const leftResource = String(f.kernel.openWorkspace(a.id).blocks[0].resource_id), rightResource = String(f.kernel.openWorkspace(b.id).blocks[0].resource_id);
  assert.equal(leftResource, rightResource);
  assert.deepEqual(f.service.read(leftResource), f.service.read(rightResource));
  assert.equal(timer(f, r.resourceId).id, first); assert.equal(timer(f, r.resourceId).remainingMs, 3000);
  assert.equal(timer(f, r.resourceId, 1).state, 'completed');
});

test('monotonic time survives forward and backward wall jumps and is rebased durably', t => {
  const f = fixture(t), r = f.create(); add(f, r.resourceId, 10000, true);
  f.advance(2000); f.clock.epochMs += 3600000;
  const before = timer(f, r.resourceId);
  assert.equal(before.remainingMs, 8000); assert.equal(before.timing.basis, 'monotonic'); assert.equal(before.timing.clockAdjusted, true);
  f.service.reconcile(r.resourceId);
  assert.equal(timer(f, r.resourceId).timing.clockAdjusted, false);
  f.advance(1000); f.clock.epochMs -= 7200000;
  assert.equal(timer(f, r.resourceId).remainingMs, 7000);
  f.service.reconcile(r.resourceId); f.advance(7000);
  const result = f.service.reconcile(r.resourceId);
  assert.equal(result.expiries.length, 1); assert.equal(result.expiries[0].wallRecovery, false);
});

test('clock sessions recover from wall deadlines and retain uncertainty after rebase', t => {
  const f = fixture(t), r = f.create(); add(f, r.resourceId, 10000, true);
  f.clock.epochMs += 3000; f.clock.monotonicMs = 1; f.clock.sessionId = 'synthetic-session:2';
  assert.equal(timer(f, r.resourceId).remainingMs, 7000); assert.equal(timer(f, r.resourceId).timing.basis, 'wall-recovery');
  f.service.reconcile(r.resourceId);
  assert.equal(timer(f, r.resourceId).timing.wallRecovery, true); assert.equal(timer(f, r.resourceId).timing.basis, 'monotonic');
  f.advance(7000);
  assert.equal(f.service.reconcile(r.resourceId).expiries[0].wallRecovery, true);
});

test('backward wall recovery never increases remaining and noncomparable monotonic clocks are disclosed', t => {
  const f = fixture(t), r = f.create(), id = add(f, r.resourceId, 10000, true);
  f.clock.epochMs -= 3000; f.clock.monotonicMs = 0; f.clock.sessionId = 'synthetic-session:2';
  assert.equal(timer(f, r.resourceId).remainingMs, 10000); assert.equal(timer(f, r.resourceId).timing.wallRecovery, true);
  f.service.reconcile(r.resourceId); f.advance(1000);
  assert.equal(timer(f, r.resourceId).remainingMs, 9000);
  f.mutate(r.resourceId, [{ type: 'pauseTimer', timerId: id }, { type: 'resumeTimer', timerId: id }]);
  f.clock.monotonicMs = 0;
  assert.equal(timer(f, r.resourceId).timing.basis, 'wall-recovery');
});

test('fractional monotonic samples remain valid across durable pause/resume and clock rebasing', t => {
  const f = fixture(t), r = f.create(), id = add(f, r.resourceId, 10000, true);
  f.clock.monotonicMs += 123.25; f.clock.epochMs += 123;
  f.mutate(r.resourceId, [{ type: 'pauseTimer', timerId: id }]);
  assert.equal(timer(f, r.resourceId).remainingMs, 9876.75);
  f.mutate(r.resourceId, [{ type: 'resumeTimer', timerId: id }]);
  assert.equal(timer(f, r.resourceId).deadlineEpochMs, f.clock.epochMs + 9876.75);
  f.clock.epochMs += 5000; f.service.reconcile(r.resourceId);
  assert.equal(timer(f, r.resourceId).remainingMs, 9876.75);
});

test('persistent SQLite reopen recovers timer, stopwatch, zones, receipts and pending expiry', t => {
  const directory = mkdtempSync(join(tmpdir(), 'aerynth-timer-domain-'));
  const opened: ReturnType<typeof fixture>[] = [];
  t.after(() => {
    opened.forEach(f => f.close());
    assert.equal(resolve(dirname(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('aerynth-timer-domain-'));
    rmSync(directory, { recursive: true, force: true });
  });
  const path = join(directory, 'timers.db'), f = fixture(t, path), r = f.create(), id = add(f, r.resourceId, 3000, true);
  opened.push(f);
  f.mutate(r.resourceId, [{ type: 'stopwatchStart' }, { type: 'addWorldClock', key: 'zone', label: 'Tokyo', timeZone: 'Asia/Tokyo' }]);
  const oldEpoch = f.clock.epochMs, receipts = f.count('timer_receipts'); f.close();
  const reopened = fixture(t, path);
  opened.push(reopened);
  reopened.clock.epochMs = oldEpoch + 6000; reopened.clock.monotonicMs = 0; reopened.clock.sessionId = 'synthetic-restart';
  assert.equal(reopened.service.read(r.resourceId).stopwatch.elapsedMs, 6000);
  assert.equal(reopened.service.read(r.resourceId).worldClocks[0].timeZone, 'Asia/Tokyo');
  assert.equal(timer(reopened, r.resourceId).id, id); assert.equal(timer(reopened, r.resourceId).due, true);
  reopened.service.reconcile(r.resourceId); const expiry = reopened.service.read(r.resourceId).pendingExpiries[0];
  assert.equal(expiry.wallRecovery, true); assert.equal(reopened.count('timer_receipts'), receipts); reopened.close();
  const again = fixture(t, path);
  opened.push(again);
  assert.equal(again.service.read(r.resourceId).pendingExpiries[0].id, expiry.id);
  assert.equal(again.service.reconcile(r.resourceId).expiries.length, 0);
  again.mutate(r.resourceId, [{ type: 'acknowledgeExpiry', expiryId: expiry.id }]);
  assert.equal(again.service.read(r.resourceId).pendingExpiries.length, 0);
});

test('stale callbacks, duplicate expiry reconciliation and ACK are idempotent across runs', t => {
  const f = fixture(t), r = f.create(), id = add(f, r.resourceId, 1000, true), wake = f.service.nextWake()!;
  f.mutate(r.resourceId, [{ type: 'extendTimer', timerId: id, amountMs: 1000 }]); f.advance(3000);
  assert.equal(f.service.reconcile(r.resourceId, wake).changed, false); assert.equal(f.count('timer_expiries'), 0);
  const active = f.service.nextWake()!; assert.equal(active.delayMs, 0);
  const expired = f.service.reconcile(r.resourceId, active), expiry = expired.expiries[0];
  assert.equal(f.service.reconcile(r.resourceId, active).changed, false); assert.equal(f.count('timer_expiries'), 1);
  f.mutate(r.resourceId, [{ type: 'resetTimer', timerId: id }, { type: 'startTimer', timerId: id }]);
  assert.equal(f.service.read(r.resourceId).pendingExpiries[0].id, expiry.id);
  assert.equal(f.service.reconcile(r.resourceId, active).changed, false);
  f.advance(3000); const second = f.service.reconcile(r.resourceId).expiries[0]; assert.notEqual(second.runId, expiry.runId);
  f.mutate(r.resourceId, [{ type: 'deleteTimer', timerId: id }, { type: 'acknowledgeExpiry', expiryId: expiry.id },
    { type: 'acknowledgeExpiry', expiryId: expiry.id }]);
  assert.deepEqual(f.service.read(r.resourceId).pendingExpiries.map(item => item.id), [second.id]);
});

test('wake requests are bounded and resource/run-bound; stopping every timer yields no wake', t => {
  const f = fixture(t), r = f.create(), id = add(f, r.resourceId, 120000, true), wake = f.service.nextWake()!;
  assert.equal(wake.delayMs, L.maxWakeDelayMs);
  f.advance(120001);
  assert.equal(f.service.reconcile(r.resourceId, { ...wake, resourceId: 'wrong-resource' }).changed, false);
  assert.equal(f.service.reconcile(r.resourceId, { ...wake, runId: 'wrong-run' }).changed, false);
  f.mutate(r.resourceId, [{ type: 'resetTimer', timerId: id }]);
  assert.equal(f.service.nextWake(), null);
});

test('version CAS and command idempotence keep creation, mutation and receipts atomic', t => {
  const f = fixture(t), commandId = randomUUID(), input = { commandId, title: 'Repeatable' }, first = f.service.create(input);
  assert.deepEqual(f.service.create(input), first); assert.equal(f.count('resources'), 1);
  assert.throws(() => f.service.create({ ...input, title: 'Other' }), code('timer_command_conflict'));
  const mutation = { commandId: randomUUID(), resourceId: first.resourceId, expectedVersion: first.version,
    operations: [{ type: 'createTimer', key: 'timer', name: 'One', durationMs: 1000 }] as TimerOperation[] };
  const result = f.service.mutate(mutation); assert.deepEqual(f.service.mutate(mutation), result);
  assert.equal(f.count('timer_receipts'), 2); assert.equal(timer(f, first.resourceId).id, result.createdIds.timer);
  assert.throws(() => f.service.mutate({ ...mutation, commandId: randomUUID() }), code('timer_version_conflict'));
  assert.throws(() => f.service.mutate({ ...mutation, operations: [{ type: 'stopwatchStart' }] }), code('timer_command_conflict'));
});

test('event failure rolls back create, body, version, receipt, reconciliation and outbox together', t => {
  const f = fixture(t); f.failEvent();
  assert.throws(() => f.create(), /synthetic_event_failure/u);
  assert.equal(f.count('resources'), 0); assert.equal(f.count('timer_documents'), 0); assert.equal(f.count('timer_receipts'), 0);
  f.failEvent(false); const r = f.create(), id = add(f, r.resourceId, 1000, true);
  f.advance(2000); const version = f.service.read(r.resourceId).resource.version, receipts = f.count('timer_receipts'), events = f.events();
  f.failEvent(); assert.throws(() => f.mutate(r.resourceId, [{ type: 'renameTimer', timerId: id, name: 'Rollback' }]), /synthetic_event_failure/u);
  assert.equal(f.service.read(r.resourceId).resource.version, version); assert.equal(timer(f, r.resourceId).state, 'running');
  assert.equal(timer(f, r.resourceId).name, 'Synthetic timer'); assert.equal(f.count('timer_expiries'), 0);
  assert.equal(f.count('timer_receipts'), receipts); assert.deepEqual(f.events(), events);
});

test('a later invalid operation rolls back preceding operations and implicit expiry', t => {
  const f = fixture(t), r = f.create(), id = add(f, r.resourceId, 1000, true); f.advance(2000);
  assert.throws(() => f.mutate(r.resourceId, [{ type: 'renameTimer', timerId: id, name: 'Rollback' },
    { type: 'resumeTimer', timerId: id }]), code('timer_invalid_transition'));
  assert.equal(timer(f, r.resourceId).name, 'Synthetic timer'); assert.equal(f.count('timer_expiries'), 0);
  assert.equal(timer(f, r.resourceId).state, 'running');
});

test('denial, read-only state, revocation and archival block writes and receipt replay', t => {
  const f = fixture(t), project = f.kernel.createProject('Synthetic project'), r = f.create('Scoped', project.id);
  const input = { commandId: randomUUID(), resourceId: r.resourceId, expectedVersion: r.version,
    operations: [{ type: 'stopwatchStart' }] as TimerOperation[] };
  f.service.mutate(input); f.readOnly.add(r.resourceId);
  assert.equal(f.service.read(r.resourceId).canEdit, false);
  assert.throws(() => f.service.mutate(input), code('timer_read_only'));
  assert.throws(() => f.service.reconcile(r.resourceId), code('timer_read_only')); assert.equal(f.service.nextWake(), null);
  f.readOnly.clear(); f.revoked.add(r.resourceId);
  assert.throws(() => f.service.read(r.resourceId), code('timer_unavailable'));
  assert.throws(() => f.service.mutate(input), code('timer_unavailable')); assert.deepEqual(f.service.list(), []);
  f.revoked.clear(); f.kernel.setProjectArchived(project.id, true, 1);
  assert.throws(() => f.service.read(r.resourceId), code('timer_unavailable'));
  f.denyCreate(); assert.throws(() => f.create(), /synthetic_create_denied/u);
});

test('IDs from another resource cannot mutate timers or acknowledge expiries', t => {
  const f = fixture(t), a = f.create('A'), b = f.create('B'), id = add(f, a.resourceId, 1000, true); f.advance(1000);
  const expiry = f.service.reconcile(a.resourceId).expiries[0];
  assert.throws(() => f.mutate(b.resourceId, [{ type: 'renameTimer', timerId: id, name: 'Intrusion' }]), code('timer_not_found'));
  assert.throws(() => f.mutate(b.resourceId, [{ type: 'acknowledgeExpiry', expiryId: expiry.id }]), code('timer_expiry_unavailable'));
  assert.equal(f.service.read(b.resourceId).pendingExpiries.length, 0); assert.equal(f.service.read(a.resourceId).pendingExpiries.length, 1);
});

test('stopwatch start, pause, resume, laps, recovery and reset use canonical elapsed time', t => {
  const f = fixture(t), r = f.create();
  assert.throws(() => f.mutate(r.resourceId, [{ type: 'stopwatchLap' }]), code('timer_invalid_transition'));
  f.mutate(r.resourceId, [{ type: 'stopwatchStart' }]); const run = f.service.read(r.resourceId).stopwatch.runId;
  f.advance(1200); f.mutate(r.resourceId, [{ type: 'stopwatchLap' }]);
  f.advance(800); f.clock.epochMs += 3600000;
  f.mutate(r.resourceId, [{ type: 'stopwatchLap' }, { type: 'stopwatchPause' }]);
  const watch = f.service.read(r.resourceId).stopwatch;
  assert.equal(watch.elapsedMs, 2000); assert.deepEqual(watch.laps.map(lap => lap.splitMs), [1200, 800]);
  f.advance(5000); assert.equal(f.service.read(r.resourceId).stopwatch.elapsedMs, 2000);
  f.mutate(r.resourceId, [{ type: 'stopwatchResume' }]); f.clock.epochMs += 3000;
  f.clock.monotonicMs = 0; f.clock.sessionId = 'new-session'; f.service.reconcile(r.resourceId);
  assert.equal(f.service.read(r.resourceId).stopwatch.elapsedMs, 5000); assert.equal(f.service.read(r.resourceId).stopwatch.timing.wallRecovery, true);
  f.mutate(r.resourceId, [{ type: 'stopwatchReset' }]);
  const reset = f.service.read(r.resourceId).stopwatch;
  assert.equal(reset.state, 'ready'); assert.equal(reset.elapsedMs, 0); assert.deepEqual(reset.laps, []); assert.notEqual(reset.runId, run);
});

test('world clocks use canonical IANA zones, support rename/remove and reject invalid or duplicate zones', t => {
  const f = fixture(t), r = f.create();
  const result = f.mutate(r.resourceId, [{ type: 'addWorldClock', key: 'tokyo', timeZone: 'Asia/Tokyo', label: 'Tokyo' },
    { type: 'addWorldClock', key: 'utc', timeZone: 'UTC', label: 'UTC' }]);
  const document = f.service.read(r.resourceId);
  assert.equal(document.worldClocks.length, 2); assert.ok(document.worldClocks[0].formatted.includes('2026'));
  for (const timeZone of ['Unreal/Moon', '+01:00', '-08:00']) assert.throws(() => f.mutate(r.resourceId,
    [{ type: 'addWorldClock', key: 'bad', timeZone, label: 'Bad' }]), code('invalid_timer_time_zone'));
  assert.throws(() => f.mutate(r.resourceId, [{ type: 'addWorldClock', key: 'dupe', timeZone: 'Asia/Tokyo', label: 'Duplicate' }]), code('timer_world_clock_capacity'));
  f.mutate(r.resourceId, [{ type: 'renameWorldClock', clockId: result.createdIds.tokyo, label: 'Japan' },
    { type: 'removeWorldClock', clockId: result.createdIds.utc }]);
  assert.equal(f.service.read(r.resourceId).worldClocks[0].label, 'Japan'); assert.equal(f.service.read(r.resourceId).worldClocks.length, 1);
});

test('caps bound timers, resources, laps and zones; malformed input is atomic', t => {
  const f = fixture(t), r = f.create();
  const ops = (offset: number): TimerOperation[] => Array.from({ length: 32 }, (_, i) =>
    ({ type: 'createTimer', key: 't' + (offset + i), name: 'Bounded ' + i, durationMs: 1000 }));
  f.mutate(r.resourceId, ops(0)); f.mutate(r.resourceId, ops(32));
  assert.equal(f.service.read(r.resourceId).timers.length, L.timersPerResource);
  assert.throws(() => add(f, r.resourceId), code('timer_capacity'));
  f.mutate(r.resourceId, [{ type: 'stopwatchStart' }]);
  for (let batch = 0; batch < 4; batch++) f.mutate(r.resourceId, Array.from({ length: 32 }, () => ({ type: 'stopwatchLap' })));
  assert.throws(() => f.mutate(r.resourceId, [{ type: 'stopwatchLap' }]), code('timer_lap_capacity'));
  const zones = ['UTC', 'Asia/Tokyo', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Asia/Kolkata', 'Asia/Shanghai', 'Asia/Seoul', 'Australia/Sydney',
    'Pacific/Auckland', 'Africa/Cairo', 'Africa/Johannesburg'];
  f.mutate(r.resourceId, zones.map((timeZone, i) => ({ type: 'addWorldClock', key: 'z' + i, timeZone, label: timeZone })));
  assert.throws(() => f.mutate(r.resourceId, [{ type: 'addWorldClock', key: 'extra', timeZone: 'America/Phoenix', label: 'Extra' }]), code('timer_world_clock_capacity'));
  for (let i = 1; i < L.resources; i++) f.create('Bounded ' + i);
  assert.throws(() => f.create(), code('timer_resource_capacity'));
  assert.throws(() => f.mutate(r.resourceId, Array.from({ length: L.operations + 1 }, () => ({ type: 'stopwatchReset' }))), code('invalid_timer_input'));
});

test('invalid durations, unknown operation fields, unsupported schema and mismatched connections fail closed', t => {
  const f = fixture(t), r = f.create();
  for (const durationMs of [0, -1, 1.5, NaN, Infinity, L.maxDurationMs + 1]) assert.throws(() => add(f, r.resourceId, durationMs), code('invalid_timer_input'));
  assert.throws(() => f.mutate(r.resourceId, [{ type: 'stopwatchStart', hidden: true } as unknown as TimerOperation]), code('invalid_timer_input'));
  const other = fixture(t);
  assert.throws(() => new TimerService(other.kernel, f.host), code('canonical_timer_connection_required'));
  f.db.exec('UPDATE timer_schema SET version=999'); assert.throws(() => new TimerService(f.kernel, f.host), code('unsupported_timer_schema'));
});
