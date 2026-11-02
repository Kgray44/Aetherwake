const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { assertOwnedProfile, validateBudget, admitPNG, organizationInvariant, localEventScript, assertOptics, verify } = require('../native/integration-environments.cjs');
const { createSlot, waitForCondition, sourceIdentity } = require('../native/integration-resource-opening.cjs');
const MiB = 1024 * 1024;
const budget = () => ({ count: 0, bytes: 0, videos: 0, videoBytes: 0, files: [] });
const png = length => { const value = Buffer.alloc(length); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(value); return value; };

test('explicit flag, exact synthetic profile basename, absolute C drive and automated title all required', () => {
  const good = 'C:\\synthetic\\review-environments-1793000000000';
  assert.doesNotThrow(() => assertOwnedProfile(good, ['--integration-environments'], 'Aerynth — Automated check'));
  for (const candidate of ['review-environments-1', 'D:\\synthetic\\review-environments-1', 'C:\\review-user-f', 'C:\\review-environments-1\\nested', 'C:\\review-environments-1-extra', '\\\\host\\review-environments-1']) assert.throws(() => assertOwnedProfile(candidate, ['--integration-environments'], 'Automated check'));
  assert.throws(() => assertOwnedProfile(good, [], 'Automated check'));
  assert.throws(() => assertOwnedProfile(good, ['--integration-environments'], 'Aerynth owner view'));
});

test('shared initial/restore PNG count and byte limits cannot reset or overflow', () => {
  const value = budget(); admitPNG(value, png(32), 'initial-one.png'); admitPNG(value, png(32), 'initial-two.png');
  const restored = validateBudget(JSON.parse(JSON.stringify(value))); admitPNG(restored, png(32), 'restore.png');
  assert.equal(restored.count, 3); assert.equal(restored.bytes, 96); assert.throws(() => admitPNG(restored, png(32), 'fourth.png'), /budget_exceeded/);
  const full = budget(); admitPNG(full, png(16 * MiB), 'limit.png'); assert.throws(() => admitPNG(full, png(8), 'over.png'), /budget_exceeded/);
  assert.throws(() => admitPNG(budget(), Buffer.from('not png'), 'fake.png'), /native_png/);
  assert.throws(() => admitPNG(value, png(32), 'initial-one.png'), /budget_exceeded/);
  assert.throws(() => validateBudget({ ...value, bytes: 1 }), /sum_mismatch/);
  assert.throws(() => validateBudget({ ...value, videos: 2 })); assert.throws(() => validateBudget({ ...value, videoBytes: 32 * MiB + 1 }));
  assert.throws(() => validateBudget({ ...value, count: NaN }));
});

test('organization comparison ignores only expected workspace names/versions and retains geometry, identity, content and provider state', () => {
  const state = { projects: [{ id: 'p', version: 1 }], workspaces: [{ id: 'w', title: 'one', version: 1 }], archivedWorkspaces: [], layouts: { w: { workspaceId: 'w', projectId: 'p', title: 'one', workspaceVersion: 1, revision: 7, viewport: { x: 8, y: 9, zoom: .7 }, presence: { id: 'system:vela', x: 6 }, blocks: [{ blockId: 'b', resourceId: 'r', x: 20, shape: 'folio', version: 3 }], canUndo: true } }, resources: [{ id: 'r', content: 'Exact synthetic body', version: 2 }], placements: [{ id: 'b', resource_id: 'r', x: 20, version: 3 }], bindings: {}, executions: {}, graph: { messages: [] } };
  const renamed = structuredClone(state); renamed.workspaces[0].title = 'two'; renamed.workspaces[0].version++; renamed.layouts.w.title = 'two'; renamed.layouts.w.workspaceVersion++;
  assert.deepEqual(organizationInvariant(renamed), organizationInvariant(state)); assert.equal(state.layouts.w.title, 'one', 'input is not mutated');
  for (const change of [s => s.layouts.w.blocks[0].x++, s => s.layouts.w.blocks[0].shape = 'circle', s => s.layouts.w.blocks[0].version++, s => s.layouts.w.presence.x++, s => s.layouts.w.viewport.zoom++, s => s.layouts.w.revision++, s => s.resources[0].content = 'changed', s => s.placements[0].resource_id = 'copy', s => s.projects[0].version++, s => s.executions.e = { state: 'running' }, s => s.bindings.r = ['provider-thread'], s => s.graph.messages.push({ id: 'unauthorized' })]) {
    const altered = structuredClone(state); change(altered); assert.notDeepEqual(organizationInvariant(altered), organizationInvariant(state));
  }
});

function dom() {
  let hidden = false, occluded = false, opacity = '1', panelOpacity = '1', clicks = 0, submits = 0, valid = true;
  const events = [];
  const panel = { disabled: false, parentElement: null, contains: value => [panel, node].includes(value), closest: () => null, getBoundingClientRect: () => ({ x: 10, y: 10, width: 300, height: 300 }) };
  const node = { disabled: false, parentElement: panel, value: '', matches: query => query === '.en-more', contains: value => value === node, closest: () => hidden ? node : null, getBoundingClientRect: () => ({ x: 20, y: 30, width: 40, height: 36 }), click: () => { clicks++; }, dispatchEvent: event => events.push(event), form: { checkValidity: () => valid, requestSubmit: submitter => { assert.equal(submitter, node); submits++; } }, focus: () => { throw Error('No helper focus mutation'); } };
  const context = { document: { querySelector: query => query.includes('data-surface-id') ? panel : node, elementFromPoint: (x, y) => occluded ? {} : x === 160 ? panel : node }, getComputedStyle: value => ({ display: 'block', visibility: 'visible', opacity: value === panel ? panelOpacity : opacity }), innerWidth: 800, innerHeight: 600, Event: class { constructor(type, options) { Object.assign(this, { type, ...options }); } }, KeyboardEvent: class { constructor(type, options) { Object.assign(this, { type, ...options }); } } };
  return { context, node, events, get counts() { return { clicks, submits }; }, hidden: value => { hidden = value; }, occluded: value => { occluded = value; }, opacity: value => { opacity = value; }, panelOpacity: value => { panelOpacity = value; }, valid: value => { valid = value; } };
}
test('actual local form submit/change/key events pass visibility and hit tests and never manipulate focus', () => {
  const f = dom(), run = (kind, value) => vm.runInNewContext(localEventScript('#actual', kind, value), f.context);
  assert(run('change', 'canonical-project-id').ready); assert.equal(f.node.value, 'canonical-project-id'); assert.deepEqual(f.events.map(e => e.type), ['input', 'change']);
  assert(run('submit').ready); assert.equal(f.counts.submits, 1); f.valid(false); assert(run('submit').invalid); assert.equal(f.counts.submits, 1);
  assert(run('keydown', 'ArrowLeft').ready); assert.equal(f.events.at(-1).key, 'ArrowLeft'); assert.equal(f.events.at(-1).cancelable, true);
  f.hidden(true); assert(run('submit').unavailable); f.hidden(false); f.occluded(true); assert(run('change', 'forbidden').occluded); assert.equal(f.node.value, 'canonical-project-id');
  assert.throws(() => localEventScript('#actual', 'keydown', 'Escape')); assert.throws(() => localEventScript('#actual', 'arbitrary-method'));
});

test('optical acceptance rejects modal/full-scene blur/oversize/unhealthy rendering while allowing local glass', () => {
  const good = { modal: false, sceneModal: false, filters: [], glass: 'blur(22px)', bounds: { x: 20, y: 30, width: 400, height: 500 }, viewport: { width: 1280, height: 900 }, active: true, failed: false, contextLost: false, draws: 12, frames: 12, errors: [] };
  assert.equal(assertOptics(good), good);
  for (const change of [x => x.modal = true, x => x.sceneModal = true, x => x.filters.push({ id: 'world', filter: 'blur(5px)' }), x => x.bounds.width = 1280, x => x.bounds.x = -1, x => x.failed = true, x => x.contextLost = true, x => x.errors.push('renderer')]) { const value = structuredClone(good); change(value); assert.throws(() => assertOptics(value)); }
});

test('40/12 second slots include cleanup and focus loss remains sticky after regain', async () => {
  let now = 0, focused = true; const win = { isDestroyed: () => false, isVisible: () => true, isMinimized: () => false, isFocused: () => focused, webContents: { isDestroyed: () => false } };
  const initial = createSlot({ win, startedAt: 0, limitMs: 40000, cleanupMs: 4000, now: () => now }); now = 36000; assert.throws(() => initial.check(), /work_deadline/); assert.equal(initial.remaining(), 4000);
  now = 0; const restore = createSlot({ win, startedAt: 0, limitMs: 12000, cleanupMs: 2500, now: () => now }); focused = false; assert.throws(() => restore.check(), /focus_lost/); focused = true; assert.throws(() => restore.check(), /focus_lost/);
  let checks = 0; now = 0; await assert.rejects(waitForCondition({ slot: { check() {}, workRemaining: () => 36000 - now }, label: 'Unavailable control', check: () => { checks++; return false; }, now: () => now, sleep: async ms => { now += ms; } }), /condition_timeout/); assert.equal(now, 4000); assert(checks > 1);
});

test('same-source restart binding includes every build/source digest and excludes process start time only', () => {
  const a = { startedAt: 'process one', hashes: { 'native/helper.cjs': 'one', 'src/navigator.ts': 'two' }, buildAssets: { 'index.js': 'three' } };
  assert.deepEqual(sourceIdentity(a), sourceIdentity({ ...a, startedAt: 'process two' }));
  assert.notDeepEqual(sourceIdentity(a), sourceIdentity({ ...a, hashes: { ...a.hashes, 'src/navigator.ts': 'changed' } }));
});

test('unowned invocation performs no app close/control/backend calls', async () => {
  let close = 0, rpc = 0; const log = console.log; console.log = () => {};
  try { const value = await verify({ win: { getTitle: () => 'Owner view', removeListener() {}, webContents: { removeListener() {} } }, app: { exit() { close++; } }, privateRoot: 'C:\\owner-profile', call: () => { rpc++; }, source: {} }); assert.equal(value.passed, false); assert.equal(close, 0); assert.equal(rpc, 0); }
  finally { console.log = log; }
});

test('helper source contains no OS input APIs or focus reclamation and recorder is optional existing exact-window path', () => {
  const code = fs.readFileSync(require.resolve('../native/integration-environments.cjs'), 'utf8');
  assert(!/sendInputEvent|\.setCursorPos\(|\.focus\(|\.show\(|globalShortcut|uiohook|robotjs/.test(code));
  assert.match(code, /startWindowRecording\(win, session, localURL\)/); assert.match(code, /32 \* MiB/); assert.match(code, /Math\.min\(1500, slot\?\.remaining/); assert.match(code, /app\.exit\(receipt\.passed \? 0 : 1\)/);
});
