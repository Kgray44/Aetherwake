const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { createSlot, canonicalProjection, sourceIdentity, targetScript } = require('../native/integration-resource-opening.cjs');

test('one monotonic slot reserves cleanup, focus loss is sticky, and neither deadline nor regained focus permits continuation', () => {
  let now = 1000, focused = true; const win = { isDestroyed: () => false, isVisible: () => true, isMinimized: () => false, isFocused: () => focused, webContents: { isDestroyed: () => false } };
  const slot = createSlot({ win, startedAt: 0, limitMs: 45000, cleanupMs: 3500, now: () => now }); slot.check(); assert.equal(slot.remaining(), 44000); focused = false; assert.throws(() => slot.check(), /focus_lost/); focused = true; assert.throws(() => slot.check(), /focus_lost/);
  const restore = createSlot({ win, startedAt: now, limitMs: 12000, cleanupMs: 2500, now: () => now }); now += 9500; assert.throws(() => restore.check(), /work_deadline/); assert.equal(restore.remaining(), 2500); now--; assert.throws(() => restore.check(), /work_deadline/, 'time changes never reset a failed slot');
  assert.throws(() => createSlot({ win, startedAt: NaN, limitMs: 45000, now: () => now })); assert.throws(() => createSlot({ win, startedAt: now + 1, limitMs: 45000, now: () => now }));
});

function fixture() {
  const resource = { id: 'synthetic:note', version: 2, content: 'Synthetic canonical text', kind: 'note' }, block = { id: 'synthetic:block', resource_id: resource.id, x: 12, y: 25, version: 1 };
  return { desktop: { projects: [], workspaces: [{ id: 'synthetic:workspace' }], resources: [resource], blocks: [block], navigationBlocks: [block], relationships: [], navigation: { kind: 'workspace', workspaceId: 'synthetic:workspace' }, history: [], viewport: { x: 0, y: 0, zoom: 1 } }, core: { graph: { schemaVersion: 3, messages: [{ id: 'synthetic:message', content: 'Synthetic recorded user input' }] }, conversations: [], resourceMap: {}, resources: [resource], bindings: {}, executions: {}, handoffs: {}, messageEvidence: {} }, layouts: { 'synthetic:workspace': { blocks: [block], layout: { version: 1, viewport: { x: 0, y: 0, zoom: 1 } } } }, collections: [{ id: 'synthetic:collection', memberIds: [resource.id] }], notes: { [resource.id]: { resource, draft: null, draftRevision: 1 } }, chats: {}, draft: {}, vela: { requests: [], plans: [], receipts: [], preferences: { mode: 'quiet' } } };
}
test('canonical comparison preserves resource identity/content/revisions, all placements, messages, memberships, provider bindings and execution truth', () => {
  const value = fixture(), before = canonicalProjection(value); assert.deepEqual(canonicalProjection(structuredClone(value)), before);
  for (const change of [v => v.desktop.resources[0].id = 'synthetic:copy', v => v.desktop.resources[0].version++, v => v.desktop.resources[0].content = 'Changed text', v => v.desktop.navigationBlocks[0].x++, v => v.layouts['synthetic:workspace'].layout.version++, v => v.core.graph.messages[0].content = 'Changed history', v => v.collections[0].memberIds = [], v => v.core.bindings.new = [{ nativeThreadId: 'synthetic:unexpected' }], v => v.core.executions.new = { state: 'running' }, v => v.core.handoffs.new = { approved: true }]) { const changed = structuredClone(value); change(changed); assert.notDeepEqual(canonicalProjection(changed), before); }
  assert.throws(() => canonicalProjection({ ...value, core: { graph: {} } }), /projection_required|history_and_collections_required/);
});

test('restart source identity excludes startup time but never ignores changed source or original build hashes', () => {
  const first = { startedAt: 'first process', hashes: { 'native/helper.cjs': 'synthetic:source' }, buildAssets: { 'index.js': 'synthetic:asset' } };
  assert.deepEqual(sourceIdentity(first), sourceIdentity({ ...first, startedAt: 'second process' })); assert.notDeepEqual(sourceIdentity(first), sourceIdentity({ ...first, buildAssets: { 'index.js': 'different' } })); assert.throws(() => sourceIdentity({ hashes: {}, buildAssets: {} }));
});

test('renderer actions require an actually visible unobstructed control and dispatch exactly one real click/input handler, no focus manipulation', () => {
  let clicks = 0, inputs = 0, hidden = false, occluded = false, opacity = '1';
  const node = { disabled: false, parentElement: null, contains: value => value === node, closest: () => hidden ? node : null, getBoundingClientRect: () => ({ x: 20, y: 30, width: 100, height: 36 }), click: () => { clicks++; }, dispatchEvent: event => { assert.equal(event.type, 'input'); assert.equal(event.bubbles, true); inputs++; }, focus: () => { throw Error('Helper must not refocus'); } };
  const context = { document: { querySelector: () => node, elementFromPoint: () => occluded ? {} : node }, getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity }), innerWidth: 800, innerHeight: 600, Event: class { constructor(type, options) { this.type = type; this.bubbles = options.bubbles; } } };
  const run = (action, value) => vm.runInNewContext(targetScript('#actual-control', action, value), context);
  hidden = true; assert(run('click').unavailable); hidden = false; occluded = true; assert(run('click').occluded); occluded = false; opacity = '.5'; assert(run('click').unavailable); assert.equal(clicks, 0); opacity = '1'; assert(run('inspect').ready); assert.equal(clicks, 0); assert(run('click').ready); assert.equal(clicks, 1); assert(run('input', 'Synthetic exact text').ready); assert.equal(node.value, 'Synthetic exact text'); assert.equal(inputs, 1);
});
