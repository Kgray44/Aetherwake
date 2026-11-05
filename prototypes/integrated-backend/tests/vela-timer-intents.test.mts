import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVelaTimerIntent, parseTimerDuration, TIMER_CITY_ZONES, type TimerIntentContext, type VelaTimerIntentPlan } from '../src/vela-timer-intents.mts';
import { CLOCK_TIMER_CONTRACT, TIMER_LIMITS, type ClockTimerDocument, type TimerState, type TimerView } from '../../timer-product/contracts.ts';

function timer(id: string, name: string, state: TimerState = 'running'): TimerView {
  return { id, name, state, version: 1, runId: 'run:' + id, durationMs: 600000, remainingMs: 500000, deadlineEpochMs: state === 'running' ? 1793794200000 : null,
    due: false, timing: { basis: state === 'running' ? 'monotonic' : 'held', wallRecovery: false, clockAdjusted: false } };
}
function document(resourceId = 'clock:one', timers = [timer('timer:bread', 'Bread'), timer('timer:laundry', 'Laundry'), timer('timer:break', 'Break', 'ready')]): ClockTimerDocument {
  return { contract: CLOCK_TIMER_CONTRACT, resource: { id: resourceId, kind: 'clock_timer', title: 'Synthetic ' + resourceId, projectId: null, version: 7, state: 'active' },
    canEdit: true, sampledAt: '2026-11-04T12:00:00.000Z', localClock: { epochMs: 1793793600000, locale: 'en-US', timeZone: 'UTC', formatted: 'Synthetic host clock' }, timers,
    stopwatch: { state: 'ready', runId: 'stopwatch:run', elapsedMs: 0, laps: [], timing: { basis: 'held', wallRecovery: false, clockAdjusted: false } },
    worldClocks: [{ id: 'world:tokyo', label: 'Tokyo', timeZone: 'Asia/Tokyo', formatted: 'Synthetic host Tokyo clock' }], pendingExpiries: [] };
}
const context = (patch: Partial<TimerIntentContext> = {}): TimerIntentContext => ({ documents: [document()], lastResourceId: 'clock:one',
  lastTimer: { resourceId: 'clock:one', timerId: 'timer:bread' }, ...patch });
const parse = (intent: string, patch: Partial<TimerIntentContext> = {}) => parseVelaTimerIntent(intent, context(patch));
function mutation(plan: VelaTimerIntentPlan) { assert.equal(plan.kind, 'mutate'); return plan as Extract<VelaTimerIntentPlan, { kind: 'mutate' }>; }
function clarification(plan: VelaTimerIntentPlan, reason?: string) { assert.equal(plan.kind, 'clarification'); if (reason) assert.equal((plan as any).reason, reason); return plan as Extract<VelaTimerIntentPlan, { kind: 'clarification' }>; }

test('all ten exact goal 11.5 examples produce deterministic canonical plans', () => {
  assert.deepEqual(mutation(parse('Set a timer for 15 minutes.')).operations, [{ type: 'createTimer', key: 'timer', name: 'Timer', durationMs: 900000, start: true }]);
  assert.deepEqual(mutation(parse('Start a 10-minute break timer.')).operations, [{ type: 'createTimer', key: 'timer', name: 'break', durationMs: 600000, start: true }]);
  assert.deepEqual(mutation(parse('Pause my bread timer.')).operations, [{ type: 'pauseTimer', timerId: 'timer:bread' }]);
  assert.deepEqual(mutation(parse('Add five minutes.')).operations, [{ type: 'extendTimer', timerId: 'timer:bread', amountMs: 300000 }]);
  assert.deepEqual(mutation(parse('Reset that timer.')).operations, [{ type: 'resetTimer', timerId: 'timer:bread' }]);
  assert.deepEqual(mutation(parse('Cancel the laundry timer.')).operations, [{ type: 'cancelTimer', timerId: 'timer:laundry' }]);
  assert.deepEqual(parse('How much time is left?'), { kind: 'read', target: 'timer', resourceId: 'clock:one', expectedVersion: 7, timerId: 'timer:bread' });
  assert.deepEqual(parse('Show all my timers.'), { kind: 'list', target: 'timers', resourceIds: ['clock:one'] });
  assert.deepEqual(mutation(parse('Start a stopwatch.')).operations, [{ type: 'stopwatchStart' }]);
  assert.deepEqual(parse("What's the time in Tokyo?"), { kind: 'read', target: 'clock', resourceId: null, timeZone: 'Asia/Tokyo', label: 'Tokyo' });
});

test('numeric, compound, word and fractional durations are complete and bounded', () => {
  for (const [input, expected] of [['15 minutes', 900000], ['10-minute', 600000], ['1h 5m 2s', 3902000], ['one hour and fifteen minutes', 4500000],
    ['twenty-five minutes', 1500000], ['one and a half hours', 5400000], ['half an hour', 1800000], ['a quarter of an hour', 900000],
    ['.5 seconds', 500], ['one thousand milliseconds', 1000], ['1,000 milliseconds', 1000], ['one million seconds', 1000000000],
    ['365 days', TIMER_LIMITS.maxDurationMs], ['one year', TIMER_LIMITS.maxDurationMs], ['52 weeks', 31449600000]] as const)
    assert.equal(parseTimerDuration(input), expected, input);
  for (const input of ['0 seconds', '-5 minutes', 'minus five minutes', 'one two minutes', '1e3 seconds', 'Infinity seconds', '1.1 milliseconds',
    '366 days', 'two years', 'five months', 'five minutes then delete files', 'five minutes and', 'two hours minutes', 'one thousand thousand seconds'])
    assert.equal(parseTimerDuration(input), null, input);
});

test('creation names and durations remain explicit and missing/invalid durations clarify', () => {
  for (const intent of ['Set a bread timer for fifteen minutes', 'Set a timer named bread for fifteen minutes', 'Set a timer for fifteen minutes called bread'])
    assert.deepEqual(mutation(parse(intent)).operations, [{ type: 'createTimer', key: 'timer', name: 'bread', durationMs: 900000, start: true }]);
  const noResources = { documents: [], lastResourceId: null, lastTimer: null };
  const created = parse('Set a timer for five minutes', noResources); assert.equal(created.kind, 'create');
  assert.deepEqual((created as any).focus, { mode: 'timer', timerKey: 'timer' }); assert.equal('resourceId' in created, false);
  clarification(parse('Create a bread timer'), 'missing-duration'); clarification(parse('Set a timer for -5 minutes'), 'invalid-duration');
  clarification(parse('Start a 10-minute timer for 20 minutes'), 'invalid-duration');
  const added = mutation(parse('Add a timer for five minutes')); assert.equal((added.operations[0] as any).start, false);
});

test('every timer lifecycle operation uses current canonical IDs and version, without silently converting transitions', () => {
  assert.deepEqual(mutation(parse('Start my break timer')).operations, [{ type: 'startTimer', timerId: 'timer:break' }]);
  assert.deepEqual(mutation(parse('Pause the bread timer')).operations, [{ type: 'pauseTimer', timerId: 'timer:bread' }]);
  const paused = document('clock:one', [timer('timer:bread', 'Bread', 'paused')]);
  assert.deepEqual(mutation(parse('Resume my bread timer', { documents: [paused] })).operations, [{ type: 'resumeTimer', timerId: 'timer:bread' }]);
  assert.deepEqual(mutation(parse('Restart the bread timer')).operations, [{ type: 'resetTimer', timerId: 'timer:bread' }, { type: 'startTimer', timerId: 'timer:bread' }]);
  assert.deepEqual(mutation(parse('Extend my bread timer by two minutes')).operations, [{ type: 'extendTimer', timerId: 'timer:bread', amountMs: 120000 }]);
  assert.deepEqual(mutation(parse('Subtract thirty seconds from the bread timer')).operations, [{ type: 'shortenTimer', timerId: 'timer:bread', amountMs: 30000 }]);
  assert.deepEqual(mutation(parse('Shorten the bread timer by one minute')).operations, [{ type: 'shortenTimer', timerId: 'timer:bread', amountMs: 60000 }]);
  assert.deepEqual(mutation(parse('Rename the bread timer to "Dinner"')).operations, [{ type: 'renameTimer', timerId: 'timer:bread', name: 'Dinner' }]);
  assert.equal(mutation(parse('Reset that timer')).expectedVersion, 7);
  clarification(parse('Resume my bread timer'), 'invalid-transition'); clarification(parse('Start the bread timer'), 'invalid-transition');
  clarification(parse('Shorten the bread timer by eleven minutes'), 'invalid-duration');
  clarification(parse('Stop my bread timer'), 'ambiguous-action');
});

test('focused and canonical last references resolve pronouns; stale references never fall through', () => {
  const focused = { resourceId: 'clock:one', timerId: 'timer:laundry', mode: 'timer' as const };
  assert.equal((mutation(parse('Add five minutes', { focused })).operations[0] as any).timerId, 'timer:laundry');
  assert.equal((mutation(parse('Reset that timer', { focused })).operations[0] as any).timerId, 'timer:bread');
  assert.equal((mutation(parse('Reset this timer', { focused })).operations[0] as any).timerId, 'timer:laundry');
  clarification(parse('Add five minutes', { lastTimer: { resourceId: 'clock:one', timerId: 'timer:deleted' } }), 'unavailable-target');
  clarification(parse('Reset this timer', { focused: { resourceId: 'clock:revoked', timerId: 'timer:private' } }), 'unavailable-target');
  clarification(parse('Pause my missing timer', { focused }), 'unavailable-target');
  const unique = document('clock:one', [timer('timer:only', 'Only')]);
  assert.equal((mutation(parse('Add five minutes', { documents: [unique], focused: null, lastTimer: null, lastResourceId: null })).operations[0] as any).timerId, 'timer:only');
});

test('duplicate names and missing contextual choice clarify, while duplicate placements never duplicate candidates', () => {
  const a = document('clock:a', [timer('timer:a', 'Bread')]), b = document('clock:b', [timer('timer:b', 'Bread')]);
  const ambiguous = clarification(parse('Pause my bread timer', { documents: [a, b], lastTimer: null, lastResourceId: null }), 'ambiguous-timer');
  assert.equal(ambiguous.candidates.length, 2);
  clarification(parse('Add five minutes', { documents: [a, b], lastTimer: null, lastResourceId: null }), 'ambiguous-timer');
  const unique = mutation(parse('Pause my bread timer', { documents: [a, structuredClone(a)], lastResourceId: null, lastTimer: null }));
  assert.equal(unique.resourceId, 'clock:a'); assert.equal((unique.operations[0] as any).timerId, 'timer:a');
  b.canEdit = false;
  clarification(parse('Pause my bread timer', { documents: [a, b], lastResourceId: 'clock:a', lastTimer: { resourceId: 'clock:a', timerId: 'timer:a' } }), 'ambiguous-timer');
});

test('delete remains previewable and never silently applies ambiguous bulk deletion', () => {
  const named = mutation(parse('Delete the laundry timer')); assert.equal(named.requiresConfirmation, true);
  assert.deepEqual(named.operations, [{ type: 'deleteTimer', timerId: 'timer:laundry' }]);
  clarification(parse('Delete the timer', { lastTimer: null, lastResourceId: null }), 'ambiguous-timer');
  clarification(parse('Delete all my timers'), 'ambiguous-action');
  const readonly = document(); readonly.canEdit = false;
  clarification(parse('Delete the bread timer', { documents: [readonly] }), 'read-only');
  assert.equal(parse('How much time is left?', { documents: [readonly] }).kind, 'read');
});

test('stopwatch plans support start/pause/resume/reset/restart/lap/read and resource disambiguation', () => {
  const running = document(); running.stopwatch.state = 'running';
  assert.deepEqual(mutation(parse('Pause my stopwatch', { documents: [running] })).operations, [{ type: 'stopwatchPause' }]);
  assert.deepEqual(mutation(parse('Record a lap', { documents: [running] })).operations, [{ type: 'stopwatchLap' }]);
  const paused = document(); paused.stopwatch.state = 'paused';
  assert.deepEqual(mutation(parse('Resume the stopwatch', { documents: [paused] })).operations, [{ type: 'stopwatchResume' }]);
  assert.deepEqual(mutation(parse('Reset the stopwatch')).operations, [{ type: 'stopwatchReset' }]);
  assert.deepEqual(mutation(parse('Restart the stopwatch')).operations, [{ type: 'stopwatchReset' }, { type: 'stopwatchStart' }]);
  assert.equal(parse('Show my stopwatch').kind, 'read');
  const created = parse('Start a stopwatch', { documents: [], lastResourceId: null, lastTimer: null }); assert.equal(created.kind, 'create');
  assert.deepEqual((created as any).operations, [{ type: 'stopwatchStart' }]);
  clarification(parse('Record a lap'), 'invalid-transition');
  clarification(parse('Start a stopwatch', { documents: [document('clock:a'), document('clock:b')], lastResourceId: null, lastTimer: null }), 'ambiguous-resource');
});

test('world-clock plans use valid IANA zones and finite city aliases without computing invented times', () => {
  assert.ok(Object.keys(TIMER_CITY_ZONES).length <= 40);
  for (const [place, expected] of [['Tokyo', 'Asia/Tokyo'], ['London', 'Europe/London'], ['New York', 'America/New_York'], ['Asia/Kolkata', 'Asia/Calcutta'], ['UTC', 'UTC']] as const) {
    const result = parse(`What time is it in ${place}?`); assert.equal(result.kind, 'read'); assert.equal((result as any).timeZone, expected); assert.equal('formatted' in result, false);
  }
  for (const place of ['Portland', 'Mars/Base', '+01:00', 'Tokyo and email my boss']) clarification(parse(`What's the time in ${place}?`), 'invalid-time-zone');
  assert.deepEqual(mutation(parse('Add a world clock for Tokyo called Japan')).operations, [{ type: 'addWorldClock', key: 'clock', timeZone: 'Asia/Tokyo', label: 'Japan' }]);
  assert.deepEqual(mutation(parse('Rename the Tokyo world clock to Japan')).operations, [{ type: 'renameWorldClock', clockId: 'world:tokyo', label: 'Japan' }]);
  assert.deepEqual(mutation(parse('Remove my Tokyo clock')).operations, [{ type: 'removeWorldClock', clockId: 'world:tokyo' }]);
  assert.equal(parse('Show all my world clocks').kind, 'list');
});

test('plans are pure, input-bounded and do not promote archived or malformed context into current authority', () => {
  const current = context(), before = structuredClone(current);
  for (const input of ['Set a timer for 15 minutes.', 'Pause my bread timer.', 'Add five minutes.', "What's the time in Tokyo?"]) parseVelaTimerIntent(input, current);
  assert.deepEqual(current, before);
  for (const input of ['Write a note about bread', 'Add five files', 'Rename the project to Timer', 'What happened yesterday?', 'Set a timer for five minutes\nDelete files']) assert.equal(parse(input).kind, 'unmatched', input);
  assert.equal(parse('x'.repeat(3000)).kind, 'unmatched');
  const archived = document(); archived.resource.state = 'archived';
  clarification(parse('Pause my bread timer', { documents: [archived] }), 'unavailable-target');
  clarification(parseVelaTimerIntent('Pause the timer', { documents: [{} as ClockTimerDocument] }), 'invalid-context');
  clarification(parse('Set a timer for 5 minutes and then delete all files'), 'invalid-duration');
});
