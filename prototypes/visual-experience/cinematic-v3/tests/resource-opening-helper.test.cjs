const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { createSlot, canonicalProjection, sourceIdentity, targetScript, unplacedSelector, waitForCondition, assertWorkspaceProjection } = require('../native/integration-resource-opening.cjs');

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

test('workspace inspection requires the complete canonical engine projection and preserves every layout field', () => {
  const workspace = { id: 'synthetic:workspace', project_id: null, title: 'Synthetic workspace', version: 1 };
  const projection = { contract: 'aetherwake.workspace/1', workspaceId: workspace.id, projectId: null, title: workspace.title, workspaceVersion: 1, layoutId: 'synthetic:layout', revision: 3, viewport: { x: 42, y: -4, zoom: .8 }, organization: { schemaVersion: 1, revision: 2, mode: 'fluid', structured: { order: [], spans: {} } }, presence: { id: 'system:vela', workspaceId: workspace.id, version: 1, x: 600, y: 200, width: 200, height: 200 }, blocks: [{ blockId: 'synthetic:placement', workspaceId: workspace.id, version: 2, x: 20, y: 30, width: 400, height: 250, zIndex: 2, shape: 'folio', rotation: .1, locked: false, minimized: false, materialVariant: 'default', resourceId: 'synthetic:note' }], canUndo: true, canRedo: false };
  assert.equal(assertWorkspaceProjection(workspace, projection), projection);
  for (const field of ['viewport', 'organization', 'presence', 'blocks', 'layoutId', 'revision', 'canUndo']) { const missing = structuredClone(projection); delete missing[field]; assert.throws(() => assertWorkspaceProjection(workspace, missing)); }
  assert.throws(() => assertWorkspaceProjection(workspace, { ...projection, workspaceId: 'synthetic:other' }), /identity_required/);
  assert.throws(() => assertWorkspaceProjection({ ...workspace, project_id: 'synthetic:unauthorized' }, projection), /identity_required/);
  for (const mutate of [value => value.viewport.x++, value => value.organization.structured.order.push('synthetic:placement'), value => value.presence.x++, value => value.blocks[0].shape = 'circle', value => value.blocks[0].rotation += .1, value => value.blocks[0].version++]) { const changed = structuredClone(projection); mutate(changed); assert.notDeepEqual(assertWorkspaceProjection(workspace, changed), projection, 'inspection fields are never normalized away'); }
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

test('unplaced Constellation lookup uses its public key and the dynamic canonical resource identity', () => {
  const id = 'synthetic:unplaced-note-723', selector = unplacedSelector(id); let clicks = 0;
  assert.equal(selector, '[data-key="resource:unplaced:synthetic:unplaced-note-723"]');
  assert.notEqual(unplacedSelector('synthetic:other'), selector);
  const node = { parentElement: null, closest: () => null, contains: value => value === node, getBoundingClientRect: () => ({ x: 20, y: 30, width: 120, height: 36 }), click: () => { clicks++; } };
  const context = { document: { querySelector: query => query === selector ? node : null, elementFromPoint: () => node }, getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }), innerWidth: 800, innerHeight: 600 };
  assert(vm.runInNewContext(targetScript(`[data-key="resource:${id}"]`, 'inspect'), context).unavailable, 'the old wrong key cannot qualify a visible target');
  assert(vm.runInNewContext(targetScript(selector, 'inspect'), context).ready); assert.equal(clicks, 0);
});

test('missing conditions stop at four seconds with bounded diagnostics, not the global work deadline', async () => {
  let now = 0, checks = 0, diagnostics = 0;
  const slot = { check: () => assert(now < 41500), workRemaining: () => 41500 - now };
  await assert.rejects(waitForCondition({ slot, label: 'Missing actual anchor', check: () => { checks++; return false; }, diagnose: () => { diagnostics++; return { status: 'Synthetic unavailable', anchors: [] }; }, now: () => now, sleep: async ms => { now += ms; } }), error => error.message.includes('condition_timeout: Missing actual anchor') && error.diagnostics.status === 'Synthetic unavailable');
  assert.equal(now, 4000); assert(checks > 1); assert.equal(diagnostics, 1); assert.equal(slot.workRemaining(), 37500);
});

test('condition deadline covers a hanging read and focus loss skips diagnostics without grace or input', async () => {
  const slot = { check() {}, workRemaining: () => 10000 };
  await assert.rejects(waitForCondition({ slot, label: 'Hung read', check: () => new Promise(() => {}), timeoutMs: 10 }), /condition_timeout: Hung read/);
  let now = 0, focused = true, diagnostics = 0;
  const guarded = { check: () => { if (!focused) throw Error('sticky_focus_lost'); }, workRemaining: () => 10000 - now };
  await assert.rejects(waitForCondition({ slot: guarded, label: 'Lost focus', check: () => { focused = false; return false; }, diagnose: () => { diagnostics++; }, now: () => now, sleep: async ms => { now += ms; } }), /sticky_focus_lost/);
  assert.equal(diagnostics, 0);
});
