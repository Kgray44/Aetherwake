import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture } from '../../timer-product/tests/fixture.mts';
import { createTimerDomain, type TimerCanonicalResult } from '../src/timer-domain.mts';
import { parseVelaTimerIntent, type TimerIntentContext } from '../src/vela-timer-intents.mts';
import { createVelaTimerExecutionRecipe, resolveVelaTimerExecutionFocus, describeVelaTimerExecution,
  type VelaTimerExecutionAction } from '../src/vela-timer-execution.mts';

async function setup(t: TestContext) {
  const f = fixture(t), domain = createTimerDomain({ kernel: f.kernel, host: f.host, clock: {
    ready: async () => {}, onResume: async () => {}, read: () => ({ ...f.clock }), dispose: () => {},
    status: () => ({ state: 'ready', source: 'injected-trusted-elapsed', includesSuspend: true, calibrationDurationMs: 0 }),
  } }); t.after(() => domain.dispose()); await domain.ready;
  const context = (patch: Partial<TimerIntentContext> = {}): TimerIntentContext => ({
    documents: f.service.list().map(resource => f.service.read(resource.id)), ...patch,
  });
  const recipe = (intent: string, patch: Partial<TimerIntentContext> = {}) => {
    const result = createVelaTimerExecutionRecipe(parseVelaTimerIntent(intent, context(patch)), { commandId: randomUUID() });
    assert.ok(result.kind === 'execute', JSON.stringify(result)); return result;
  };
  const apply = async (recipe: VelaTimerExecutionAction): Promise<TimerCanonicalResult> => {
    assert.equal(recipe.requiresConfirmation, false, 'Synthetic auto-apply only permits unreviewed low-risk operations');
    const commit = await domain.prepareCanonical(recipe.request, { signal: new AbortController().signal });
    return f.kernel.withTransaction(commit);
  };
  return { f, domain, context, recipe, apply };
}

test('pure recipe preserves clarification/unmatched decisions and creates no resource or execution claim', () => {
  for (const intent of ['Draw a lighthouse', 'Create a bread timer', 'Delete all my timers']) {
    const plan = parseVelaTimerIntent(intent, { documents: [] }), recipe = createVelaTimerExecutionRecipe(plan, { commandId: 'synthetic:recipe-only' });
    assert.deepEqual(recipe, plan); assert.ok(recipe.kind === 'unmatched' || recipe.kind === 'clarification');
  }
});

test('new-resource and existing-resource timer recipes resolve the actual canonical timer ID', async t => {
  const m = await setup(t), first = m.recipe('Set a bread timer for fifteen minutes');
  assert.equal(first.request.name, 'create'); assert.deepEqual(first.expectedVersions, []);
  const created = await m.apply(first); assert.ok(created.name === 'create');
  const focus = resolveVelaTimerExecutionFocus(first, created)!;
  assert.deepEqual(focus, { mode: 'timer', resourceId: created.mutation.resourceId, timerId: created.mutation.createdIds.timer });
  assert.match(describeVelaTimerExecution(first, created), /bread: running, 15m 0s remaining/u);
  const second = m.recipe('Set a laundry timer for ten minutes'), added = await m.apply(second); assert.ok(added.name === 'mutate');
  assert.deepEqual(second.expectedVersions, [{ resourceId: created.mutation.resourceId, version: created.mutation.version }]);
  assert.deepEqual(resolveVelaTimerExecutionFocus(second, added), { mode: 'timer', resourceId: created.mutation.resourceId, timerId: added.mutation.createdIds.timer });
  assert.equal(m.f.count('resources'), 1); assert.equal(added.document.timers.length, 2);
});

test('lifecycle recipes retain canonical last-target identity and version throughout native apply', async t => {
  const m = await setup(t), created = await m.apply(m.recipe('Start a 10-minute break timer')); assert.ok(created.name === 'create');
  const lastTimer = { resourceId: created.mutation.resourceId, timerId: created.mutation.createdIds.timer };
  for (const [intent, state] of [['Pause my break timer', 'paused'], ['Resume my break timer', 'running'], ['Add five minutes', 'running'], ['Reset that timer', 'ready'],
    ['Start my break timer', 'running'], ['Cancel my break timer', 'cancelled']] as const) {
    const recipe = m.recipe(intent, { lastTimer }), result = await m.apply(recipe); assert.ok(result.name === 'mutate');
    assert.equal(result.document.timers[0].id, lastTimer.timerId); assert.equal(result.document.timers[0].state, state);
    assert.equal(resolveVelaTimerExecutionFocus(recipe, result)?.timerId, lastTimer.timerId);
  }
  assert.equal(m.f.count('resources'), 1);
});

test('read/list recipes use actual canonical query results and disclose overdue timers without fabricating completion', async t => {
  const m = await setup(t), created = await m.apply(m.recipe('Set a timer for one second')); assert.ok(created.name === 'create');
  m.f.advance(2000);
  const resourceId = created.mutation.resourceId, timerId = created.mutation.createdIds.timer;
  const read = m.recipe('How much time is left?', { lastTimer: { resourceId, timerId } }), result = await m.apply(read);
  assert.equal(result.name, 'read'); assert.match(describeVelaTimerExecution(read, result), /running, 0s remaining \(due; native completion is pending\)/u);
  const running = m.recipe('Show all my running timers'), list = await m.apply(running);
  assert.equal(list.name, 'list'); assert.match(describeVelaTimerExecution(running, list), /running/u);
  assert.equal(m.f.count('timer_expiries'), 0); assert.equal(m.f.count('resources'), 1);
});

test('stopwatch and world-clock recipes use the same canonical timer owner and query trusted time without creating resources', async t => {
  const m = await setup(t), clock = m.recipe("What's the time in Tokyo?"), current = await m.apply(clock);
  assert.equal(clock.request.name, 'readClock'); assert.ok(current.name === 'readClock'); assert.equal(current.clock.timeZone, 'Asia/Tokyo');
  assert.equal(m.f.count('resources'), 0); assert.match(describeVelaTimerExecution(clock, current), /Asia\/Tokyo/u);
  const started = await m.apply(m.recipe('Start a stopwatch')); assert.ok(started.name === 'create'); m.f.advance(2500);
  const lap = m.recipe('Record a lap on the stopwatch'), lapped = await m.apply(lap); assert.ok(lapped.name === 'mutate');
  assert.equal(lapped.document.stopwatch.laps[0].elapsedMs, 2500); assert.match(describeVelaTimerExecution(lap, lapped), /running, 2s elapsed, 1 lap/u);
  const added = await m.apply(m.recipe('Add a clock for Tokyo')); assert.ok(added.name === 'mutate'); assert.equal(added.document.worldClocks[0].timeZone, 'Asia/Tokyo');
  const listed = m.recipe('Show all my world clocks'), worldClocks = await m.apply(listed);
  assert.match(describeVelaTimerExecution(listed, worldClocks), /Tokyo \(Asia\/Tokyo\):/u); assert.equal(m.f.count('resources'), 1);
});

test('destructive recipes require caller review and never preserve a deleted timer as the focused canonical ID', async t => {
  const m = await setup(t), created = await m.apply(m.recipe('Set a bread timer for one minute')); assert.ok(created.name === 'create');
  const parsed = parseVelaTimerIntent('Delete my bread timer', m.context()); assert.ok(parsed.kind === 'mutate');
  parsed.requiresConfirmation = false;
  const recipe = createVelaTimerExecutionRecipe(parsed, { commandId: 'synthetic:reviewed-delete' }); assert.ok(recipe.kind === 'execute');
  assert.equal(recipe.requiresConfirmation, true); assert.equal(m.f.service.read(created.mutation.resourceId).timers.length, 1);
  let reviewed = false;
  const commit = await m.domain.prepareCanonical(recipe.request, { signal: new AbortController().signal,
    validate: () => { if (!reviewed) throw Error('synthetic_review_required'); } });
  assert.throws(commit, /synthetic_review_required/u); assert.equal(m.f.service.read(created.mutation.resourceId).timers.length, 1);
  reviewed = true; const deleted = m.f.kernel.withTransaction(commit); assert.ok(deleted.name === 'mutate');
  assert.equal(deleted.document.timers.length, 0); assert.deepEqual(resolveVelaTimerExecutionFocus(recipe, deleted), { mode: 'timer', resourceId: created.mutation.resourceId });
});

test('replayed historical command responses disclose current canonical divergence', async t => {
  const m = await setup(t), recipe = m.recipe('Set a bread timer for one minute'), original = await m.apply(recipe); assert.ok(original.name === 'create');
  await m.apply(m.recipe('Pause my bread timer'));
  const replay = await m.apply(recipe); assert.ok(replay.name === 'create');
  assert.deepEqual(replay.mutation, original.mutation); assert.equal(replay.document.timers[0].state, 'paused');
  assert.equal(replay.postconditions.receiptMatchesCurrent, false); assert.match(describeVelaTimerExecution(recipe, replay), /already applied at version 2; the canonical resource is now version 3/u);
  assert.equal(m.f.count('resources'), 1); assert.equal(m.f.events().length, 3);
});
