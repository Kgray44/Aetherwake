import test from 'node:test';
import assert from 'node:assert/strict';
import { blockDocument } from '../../../block-library/tests/component-dom.mts';
import { until } from '../../../conversation-product/test/component-dom.mts';
import { fixture } from '../../../timer-product/tests/fixture.mts';
import { mountClockTimerExperience } from '../src/clock-timer-view.ts';
import { createProductClients } from '../src/product-clients.ts';
import { blockAvailability, blockDefinition, validateConfiguration } from '../../../block-library/registry.ts';
import { blockIdentity } from '../../../block-library/identity-model.ts';
import { mountDirectResourceExperience } from '../../../block-library/direct-resource-view.ts';

function dom() {
  const view = blockDocument(), create = view.doc.createElement;
  view.doc.hidden = false;
  const listeners = new Map();
  view.doc.addEventListener = (type, listener) => listeners.set(type, [...(listeners.get(type) ?? []), listener]);
  view.doc.removeEventListener = (type, listener) => listeners.set(type, (listeners.get(type) ?? []).filter(item => item !== listener));
  view.doc.fire = type => (listeners.get(type) ?? []).forEach(listener => listener());
  view.doc.createElement = tag => {
    const element = create(tag);
    element.style.setProperty = (key, value) => { element.style[key] = value; };
    element.click = () => { if (!element.disabled) element.onclick?.({ preventDefault() {} }); };
    return element;
  };
  return view;
}
function client(f) {
  const calls = [];
  return { calls, port: {
    create: async input => { calls.push({ name: 'create', input }); return f.service.create(input); },
    read: async resourceId => { calls.push({ name: 'read', resourceId }); return f.service.read(resourceId); },
    mutate: async input => { calls.push({ name: 'mutate', input }); return f.service.mutate(input); },
    list: async () => { calls.push({ name: 'list' }); return f.service.list(); },
  } };
}
async function mounted(t, options = {}, f = fixture(t), resource = f.create()) {
  const d = dom(), c = client(f); let instant = 0;
  const view = mountClockTimerExperience(d.root, resource.resourceId, c.port, { displayNow: () => instant, ...options });
  t.after(() => view.dispose()); await view.refresh();
  return { ...d, f, view, c, resource, advance(ms, host = true) { instant += ms; if (host) f.advance(ms); } };
}
const field = (root, label) => root.querySelectorAll('input,select').find(element => element.getAttribute('aria-label') === label);
const action = (root, name) => root.querySelector(`[data-clock-action="${name}"]`);
async function click(m, name) { action(m.root, name).click(); await m.view.flush(); }
async function mode(m, name) { m.root.querySelector(`button[data-clock-mode="${name}"]`).click(); await m.view.flush(); }
async function add(m, { name = 'Tea', minutes = '0.05', start = false } = {}) {
  field(m.root, 'New timer name').value = name; field(m.root, 'Duration in minutes').value = minutes;
  await click(m, start ? 'createAndStartTimer' : 'createTimer');
  return m.f.service.read(m.resource.resourceId).timers.at(-1).id;
}

test('manifest availability remains host-advertised and placement preferences are exact, bounded and separate', () => {
  const manifest = blockDefinition('clock_timer');
  assert.equal(manifest.title, 'Clock & Timers'); assert.equal(manifest.creation, undefined);
  assert.ok(manifest.requiredServices.includes('clock-timer-service'));
  const capabilities = { revision: 1, kinds: {}, providers: {}, velaPlanning: { state: 'unsupported' } };
  assert.equal(blockAvailability('clock_timer', capabilities).state, 'unknown');
  const config = { schemaVersion: 1, textScale: 1, contentMode: 'compact', clockTimer: { mode: 'stopwatch', selectedTimerId: 'timer:a' } };
  assert.deepEqual(validateConfiguration(config), config);
  for (const clockTimer of [{ mode: 'fake' }, { mode: 'timer', hidden: true }, { mode: 'clock', selectedTimerId: 'x'.repeat(201) }, { mode: 'clock', selectedTimerId: '../outside' }])
    assert.throws(() => validateConfiguration({ ...config, clockTimer }), /invalid_block_configuration/u);
});

test('public clockTimers client transports exact operations and applies returned desktop snapshots', async () => {
  const calls = [], snapshots = [], client = createProductClients({
    command: async (family, input) => { calls.push({ family, ...input }); return { result: input.name, desktop: { revision: calls.length } }; },
    apply: value => snapshots.push(value),
  }).clockTimers;
  await client.read('resource:a'); await client.create({ commandId: 'c1', title: 'Clock' });
  await client.mutate({ commandId: 'c2', resourceId: 'resource:a', expectedVersion: 2, operations: [{ type: 'stopwatchStart' }] }); await client.list();
  assert.deepEqual(calls.map(call => [call.family, call.name]), [['clockTimers', 'read'], ['clockTimers', 'create'], ['clockTimers', 'mutate'], ['clockTimers', 'list']]);
  assert.deepEqual(calls[0].input, { resourceId: 'resource:a' }); assert.deepEqual(calls[3].input, {}); assert.equal(snapshots.length, 4);
});

test('accessible named timer controls perform all lifecycle actions against the canonical service', async t => {
  const m = await mounted(t), id = await add(m);
  assert.equal(m.root.querySelector('[data-clock-timer-name]').textContent, 'Tea');
  assert.equal(action(m.root, 'startTimer').hidden, false);
  await click(m, 'startTimer'); m.advance(1000); m.view.frame();
  assert.equal(m.root.querySelector('[data-clock-remaining]').textContent, '00:02');
  await click(m, 'pauseTimer'); m.advance(5000); m.view.frame();
  assert.equal(m.root.querySelector('[data-clock-remaining]').textContent, '00:02');
  field(m.root, 'Adjust by seconds').value = '2'; await click(m, 'extendTimer');
  assert.equal(m.f.service.read(m.resource.resourceId).timers[0].remainingMs, 4000);
  await click(m, 'resumeTimer'); field(m.root, 'Adjust by seconds').value = '1'; await click(m, 'shortenTimer');
  const rename = field(m.root, 'Timer name'); rename.value = 'Green tea'; rename.oninput(); await click(m, 'renameTimer');
  assert.equal(m.f.service.read(m.resource.resourceId).timers[0].name, 'Green tea');
  await click(m, 'cancelTimer'); assert.equal(m.f.service.read(m.resource.resourceId).timers[0].state, 'cancelled');
  await click(m, 'resetTimer'); assert.equal(m.f.service.read(m.resource.resourceId).timers[0].state, 'ready');
  await click(m, 'deleteTimer'); assert.equal(m.f.service.read(m.resource.resourceId).timers[0].id, id, 'Delete opens an explicit review before removing saved state');
  await click(m, 'confirmDeleteTimer'); assert.equal(m.f.service.read(m.resource.resourceId).timers.length, 0);
  assert.equal(m.root.querySelector('[role="timer"]').getAttribute('aria-live'), 'off');
});

test('multiple named timers and mounted views retain the same identities without UI-driven completion', async t => {
  const f = fixture(t), resource = f.create(), left = await mounted(t, {}, f, resource), right = await mounted(t, {}, f, resource);
  const first = await add(left, { name: 'First', minutes: '0.05', start: true });
  const second = await add(left, { name: 'Second', minutes: '0.1', start: true }); await right.view.refresh();
  assert.equal(field(right.root, 'Selected timer').options.length, 2);
  field(right.root, 'Selected timer').value = second; field(right.root, 'Selected timer').onchange();
  assert.equal(right.root.querySelector('[data-timer-id]').dataset.timerId, second);
  left.advance(4000, false); left.view.frame();
  field(left.root, 'Selected timer').value = first; field(left.root, 'Selected timer').onchange();
  assert.match(left.root.querySelector('[data-clock-timer-state]').textContent, /Awaiting host completion confirmation/u);
  assert.equal(f.service.read(resource.resourceId).timers[0].state, 'running', 'Renderer interpolation never completes a canonical timer');
  f.advance(4000); f.service.reconcile(resource.resourceId); await Promise.all([left.view.refresh(), right.view.refresh()]);
  assert.equal(left.root.querySelector('[data-timer-state]').dataset.timerState, 'completed');
  assert.equal(right.root.querySelector('[data-timer-id]').dataset.timerId, second);
  assert.equal(f.service.read(resource.resourceId).pendingExpiries.length, 1);
  await click(left, 'acknowledgeExpiry'); assert.equal(f.service.read(resource.resourceId).pendingExpiries.length, 0);
});

test('stopwatch controls record real service laps and world clocks can be added, renamed and removed', async t => {
  const m = await mounted(t); await mode(m, 'stopwatch'); await click(m, 'stopwatchStart');
  m.advance(1250); m.view.frame(); assert.equal(m.root.querySelector('[data-clock-stopwatch]').textContent, '00:01.2');
  await click(m, 'stopwatchLap'); m.advance(750); await click(m, 'stopwatchLap');
  assert.equal(m.root.querySelectorAll('[data-clock-lap]').length, 2); assert.match(m.root.textContent, /Split 00:00.7/u);
  await click(m, 'stopwatchPause'); m.advance(5000); m.view.frame(); assert.equal(m.f.service.read(m.resource.resourceId).stopwatch.elapsedMs, 2000);
  await click(m, 'stopwatchResume'); await click(m, 'stopwatchReset'); assert.equal(m.root.querySelectorAll('[data-clock-lap]').length, 0);
  await mode(m, 'clock'); field(m.root, 'World clock name').value = 'Tokyo'; field(m.root, 'IANA time zone').value = 'Asia/Tokyo';
  await click(m, 'addWorldClock'); const row = m.root.querySelector('[data-clock-world]'); assert.match(row.textContent, /Asia\/Tokyo/u);
  const label = field(row, 'World clock label'); label.value = 'Japan'; label.oninput(); await click(m, 'renameWorldClock');
  assert.equal(m.f.service.read(m.resource.resourceId).worldClocks[0].label, 'Japan');
  await click(m, 'removeWorldClock'); assert.equal(m.root.querySelectorAll('[data-clock-world]').length, 0);
  field(m.root, 'World clock name').value = 'Bad zone'; field(m.root, 'IANA time zone').value = '+01:00'; await click(m, 'addWorldClock');
  assert.match(m.root.querySelector('[role="status"]').textContent, /valid IANA time zone/u);
});

test('mode and selected timer persist per placement through existing settings CAS, without canonical mutation', async t => {
  const f = fixture(t), resource = f.create(), first = f.mutate(resource.resourceId, [{ type: 'createTimer', key: 'a', name: 'A', durationMs: 10000 },
    { type: 'createTimer', key: 'b', name: 'B', durationMs: 20000 }]);
  const saved = new Map(), writes = [], base = { schemaVersion: 1, textScale: 1, contentMode: 'compact' };
  const host = {
    getBlockSettings: async placementId => structuredClone(saved.get(placementId) ?? { placementId, resourceId: resource.resourceId, kind: 'clock_timer', manifestVersion: 1, version: 1, configuration: base }),
    configureBlock: async input => {
      const current = await host.getBlockSettings(input.placementId); assert.equal(input.expectedVersion, current.version);
      const result = { ...current, version: current.version + 1, configuration: structuredClone(input.configuration) }; saved.set(input.placementId, result); writes.push(input); return result;
    },
  };
  const a = await mounted(t, { placement: { placementId: 'block:a', host } }, f, resource);
  const b = await mounted(t, { placement: { placementId: 'block:b', host } }, f, resource);
  await mode(a, 'stopwatch'); await mode(b, 'clock'); await mode(a, 'timer');
  field(a.root, 'Selected timer').value = first.createdIds.b; field(a.root, 'Selected timer').onchange(); await a.view.flush();
  assert.deepEqual(saved.get('block:a').configuration.clockTimer, { mode: 'timer', selectedTimerId: first.createdIds.b });
  assert.equal(saved.get('block:b').configuration.clockTimer.mode, 'clock'); assert.equal(f.service.read(resource.resourceId).resource.version, first.version);
  const restored = await mounted(t, { placement: { placementId: 'block:a', host } }, f, resource);
  await until(() => restored.root.querySelector('[data-timer-id]')?.dataset.timerId === first.createdIds.b);
  assert.equal(restored.root.querySelector('.aw-clock-timer').dataset.compact, 'true'); assert.ok(writes.every(write => write.expectedVersion >= 1));
});

test('stale domain versions reread without automatic mutation retries or lost name drafts', async t => {
  const m = await mounted(t), id = await add(m), name = field(m.root, 'Timer name');
  name.value = 'Unsaved draft'; name.oninput(); name.focus();
  m.f.mutate(m.resource.resourceId, [{ type: 'renameTimer', timerId: id, name: 'Other view' }]);
  const before = m.c.calls.filter(call => call.name === 'mutate').length; await click(m, 'startTimer');
  assert.equal(m.c.calls.filter(call => call.name === 'mutate').length, before + 1);
  assert.match(m.root.querySelector('[role="status"]').textContent, /changed in another view/u);
  assert.equal(name.value, 'Unsaved draft'); assert.equal(m.doc.activeElement, name);
  assert.equal(m.f.service.read(m.resource.resourceId).timers[0].state, 'ready');
  await click(m, 'renameTimer'); assert.equal(m.f.service.read(m.resource.resourceId).timers[0].name, 'Unsaved draft');
});

test('preference CAS failure restores the latest placement mode without touching canonical timer state', async t => {
  const f = fixture(t), resource = f.create(); let settingsVersion = 1, savedMode = 'timer', attempted = 0;
  const host = {
    getBlockSettings: async placementId => ({ placementId, resourceId: resource.resourceId, kind: 'clock_timer', manifestVersion: 1,
      version: settingsVersion, configuration: { schemaVersion: 1, textScale: 1, contentMode: 'auto', clockTimer: { mode: savedMode } } }),
    configureBlock: async () => { attempted++; settingsVersion++; savedMode = 'clock'; throw Error('configuration_version_conflict'); },
  };
  const m = await mounted(t, { placement: { placementId: 'block:conflict', host } }, f, resource); await m.view.flush();
  await mode(m, 'stopwatch');
  assert.equal(attempted, 1); assert.equal(m.root.querySelector('.aw-clock-timer').dataset.clockMode, 'clock');
  assert.match(m.root.querySelector('[role="status"]').textContent, /View preferences could not be saved/u);
  assert.equal(f.service.read(resource.resourceId).resource.version, 1); assert.equal(m.c.calls.filter(call => call.name === 'mutate').length, 0);
});

test('refresh keeps completion actions focused and revocation clears saved source text', async t => {
  const m = await mounted(t); await add(m, { name: 'Private saved timer', start: true }); m.f.advance(4000); m.f.service.reconcile(m.resource.resourceId);
  await m.view.refresh(); const dismiss = action(m.root, 'acknowledgeExpiry'); dismiss.focus();
  await m.view.refresh(); assert.equal(action(m.root, 'acknowledgeExpiry'), dismiss); assert.equal(m.doc.activeElement, dismiss);
  m.f.revoked.add(m.resource.resourceId); await m.view.refresh();
  assert.equal(m.root.querySelector('[data-clock-timer-name]').textContent, '');
  assert.equal(m.root.querySelector('[data-timer-id]'), null);
  assert.equal(m.root.querySelectorAll('[data-clock-expiry]').length, 0);
});

test('read-only/revoked views disable stale controls and never fall back to a new domain resource', async t => {
  const m = await mounted(t); await add(m);
  const stale = action(m.root, 'startTimer'), count = m.f.count('resources'); m.f.readOnly.add(m.resource.resourceId); await m.view.refresh();
  assert.equal(stale.disabled, true); stale.onclick(); await m.view.flush(); assert.equal(m.f.service.read(m.resource.resourceId).timers[0].state, 'ready');
  m.f.revoked.add(m.resource.resourceId); await m.view.refresh();
  assert.match(m.root.querySelector('[role="status"]').textContent, /unavailable with the current access/u);
  stale.onclick(); await m.view.flush(); assert.equal(m.f.count('resources'), count); assert.equal(m.root.querySelector('[data-clock-timer-select]').options.length, 0);
});

test('shared frame interpolation pauses when hidden/inactive/disposed and no rendering loop owns timer lifetime', async t => {
  const m = await mounted(t); await add(m, { start: true });
  const display = m.root.querySelector('[data-clock-remaining]'); const initial = display.textContent;
  m.doc.hidden = true; const reads = m.c.calls.filter(call => call.name === 'read').length; m.advance(30000); m.view.frame();
  assert.equal(display.textContent, initial); assert.equal(m.c.calls.filter(call => call.name === 'read').length, reads);
  m.doc.hidden = false; m.doc.fire('visibilitychange'); await m.view.refresh();
  assert.match(m.root.querySelector('[data-clock-timer-state]').textContent, /Awaiting host/u);
  m.view.setActive(false); const after = m.c.calls.length; m.advance(60000); m.view.frame(); assert.equal(m.c.calls.length, after);
  m.view.dispose(); const count = m.f.count('timer_documents'); m.advance(60000); m.view.frame();
  assert.equal(m.c.calls.length, after); assert.equal(m.f.count('timer_documents'), count); assert.equal(m.f.service.read(m.resource.resourceId).timers[0].state, 'running');
});

test('canonical clock projection has its own identity and direct surface disposes without deleting state', async t => {
  const f = fixture(t), created = f.create(), c = client(f), d = dom(), restore = d.install();
  const document = f.service.read(created.resourceId), resource = { id: created.resourceId, kind: 'clock_timer', title: document.resource.title,
    version: document.resource.version, provider: 'local', messages: [], content: '' };
  const identity = blockIdentity({ kind: 'clock_timer', resource, clockTimer: document });
  assert.equal(identity.layout, 'clock'); assert.equal(identity.label, 'Clock & Timer'); assert.equal(identity.phase, 'ready');
  const forbidden = () => { throw Error('Unrelated resource operation'); };
  const experience = mountDirectResourceExperience(d.root, resource, { clockTimers: { port: c.port }, notes: {}, noteSession: forbidden,
    saveContent: forbidden, setTaskStatus: forbidden, setTaskPriority: forbidden, manageMembers: forbidden, openResource: forbidden });
  try {
    await experience.refresh(); assert.ok(d.root.querySelector('[data-clock-timer-resource]'));
    experience.update({ ...resource, version: 2 }); await experience.refresh(); experience.setActive(false); experience.frame(); experience.dispose();
    assert.equal(f.count('timer_documents'), 1); assert.equal(f.count('notes'), 0);
  } finally { experience.dispose(); restore(); }
});
