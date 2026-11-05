import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrustedTimerClock, TimerClockError } from '../src/timer-clock.mts';
const code = (expected: string) => (error: unknown) => error instanceof TimerClockError && error.code === expected;
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };

test('trusted elapsed calibration is cheap between samples and independent of wall-clock jumps', async () => {
  let highResolution = 100, wall = 1700000000000, samples = 0;
  const clock = createTrustedTimerClock({ sampleElapsed: async () => { samples++; return 50000; }, performanceNow: () => highResolution,
    wallNow: () => wall, timeZone: () => 'UTC', locale: () => 'en-US' });
  await clock.ready(); const first = clock.read();
  highResolution += 123.5; wall += 3600000;
  assert.equal(clock.read().monotonicMs, first.monotonicMs + 123.5); assert.equal(clock.read().epochMs, wall);
  wall -= 7200000; for (let i = 0; i < 20; i++) clock.read();
  assert.equal(samples, 1); assert.equal(clock.status().includesSuspend, true); assert.equal(clock.read().sessionId, first.sessionId); clock.dispose();
});

test('resume recalibration is awaited, coalesces samples and includes elapsed suspend time', async () => {
  let highResolution = 100, samples = 0; const resumed = deferred<number>();
  const clock = createTrustedTimerClock({ sampleElapsed: async () => ++samples === 1 ? 50000 : resumed.promise, performanceNow: () => highResolution });
  await clock.ready(); const before = clock.read(); highResolution += 50;
  const first = clock.onResume(), second = clock.onResume(); assert.equal(first, second);
  assert.throws(() => clock.read(), code('timer_clock_not_ready'));
  resumed.resolve(65000); await first;
  assert.equal(clock.read().monotonicMs, 65000); assert.equal(clock.read().sessionId, before.sessionId); assert.equal(samples, 2); clock.dispose();
});

test('new clock instances and incomparable native origins use distinct recovery sessions', async () => {
  let ticks = 50000;
  const options = { sampleElapsed: async () => ticks, performanceNow: () => 100 };
  const a = createTrustedTimerClock(options), b = createTrustedTimerClock(options); await Promise.all([a.ready(), b.ready()]);
  const first = a.read().sessionId; assert.notEqual(first, b.read().sessionId);
  ticks = 1; await a.onResume(); assert.notEqual(a.read().sessionId, first); assert.equal(a.read().monotonicMs, 1);
  a.dispose(); b.dispose();
});

test('sample failures do not retry until explicit resume and unsupported platforms never fabricate a trusted fallback', async () => {
  let samples = 0, fail = true;
  const clock = createTrustedTimerClock({ sampleElapsed: async () => { samples++; if (fail) throw Error('synthetic sampler failure'); return 100; } });
  await assert.rejects(clock.ready(), code('timer_elapsed_sample_failed')); await assert.rejects(clock.ready(), code('timer_elapsed_sample_failed'));
  assert.equal(samples, 1); assert.equal(clock.status().includesSuspend, false);
  fail = false; await clock.onResume(); assert.equal(samples, 2); assert.equal(clock.status().state, 'ready'); clock.dispose();
  const unsupported = createTrustedTimerClock({ platform: 'linux' });
  await assert.rejects(unsupported.ready(), code('timer_elapsed_clock_unsupported'));
  assert.throws(() => unsupported.read(), code('timer_elapsed_clock_unsupported')); assert.equal(unsupported.status().source, 'unsupported'); unsupported.dispose();
});

test('dispose cancels an in-flight sample and cannot later publish a ready clock', async () => {
  let signal: AbortSignal | undefined;
  const clock = createTrustedTimerClock({ sampleElapsed: received => new Promise((_resolve, reject) => {
    signal = received; received.addEventListener('abort', () => reject(Error('aborted')), { once: true });
  }) });
  const ready = clock.ready(); clock.dispose(); await assert.rejects(ready, code('timer_clock_disposed'));
  assert.equal(signal?.aborted, true); assert.equal(clock.status().state, 'disposed'); assert.throws(() => clock.read(), code('timer_clock_disposed'));
});

test('malformed native/high-resolution/wall readings fail closed without sampling loops', async () => {
  for (const ticks of [-1, NaN, Infinity, 1.5]) {
    const clock = createTrustedTimerClock({ sampleElapsed: async () => ticks });
    await assert.rejects(clock.ready(), code('invalid_timer_elapsed_sample')); assert.equal(clock.status().state, 'unavailable'); clock.dispose();
  }
  let highResolution = 100, wall = 1000;
  const clock = createTrustedTimerClock({ sampleElapsed: async () => 500, performanceNow: () => highResolution, wallNow: () => wall });
  await clock.ready(); highResolution = 99; assert.throws(() => clock.read(), code('invalid_timer_clock_reading')); assert.equal(clock.status().state, 'unavailable');
  highResolution = 100; await clock.onResume(); wall = NaN; assert.throws(() => clock.read(), code('invalid_timer_clock_reading')); clock.dispose();
});
