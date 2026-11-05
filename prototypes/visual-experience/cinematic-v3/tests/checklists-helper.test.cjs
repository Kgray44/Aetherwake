const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { assertOwnedProfile, assertOwnedApplicationProfile, assertRead, assertDocument, assertNoExecution, assertNoPlacements, assertFinished, passingCheckpoint, FIXTURE, verify } = require('../native/integration-checklists.cjs');
const { createSlot } = require('../native/integration-resource-opening.cjs');
const { fillNative } = require('../native/integration-agents.cjs');
const { validateBudget, admitPNG } = require('../native/integration-desktop-basics.cjs');
const attribution = () => ({ actor: { kind: 'user' }, authority: 'manual', at: '2026-11-02T00:00:00Z' });
const reference = () => ({ id: 'synthetic-reference', available: true, kind: 'conversation', title: 'Untitled chat', target: { kind: 'conversation', resourceId: 'synthetic-chat' } });
const entry = (id, text) => ({ id, text, description: '', checked: false, priority: 'normal', dueDate: null, groupId: null, references: [], created: attribution(), updated: attribution(), completion: null });
const document = (id = 'synthetic-manual') => ({ schemaVersion: 1, resource: { id, kind: 'checklist', title: FIXTURE.title, projectId: null, version: 7 }, canEdit: true, syncPolicy: 'manual', groups: [{ id: 'synthetic-group', title: FIXTURE.group }], entries: [Object.assign(entry('synthetic-entry-1', FIXTURE.edited), { description: FIXTURE.description, checked: true, priority: 'high', dueDate: FIXTURE.due, groupId: 'synthetic-group', completion: { ...attribution(), basis: 'manual' } }), entry('synthetic-entry-2', FIXTURE.second)], references: [reference()], created: attribution(), updated: attribution() });
const linked = () => ({ ...document('synthetic-linked'), resource: { ...document().resource, id: 'synthetic-linked', title: FIXTURE.linked, version: 1 }, entries: [], groups: [] });
const core = () => ({ executions: {}, handoffs: {}, bindings: {}, graph: { messages: [], conversations: [{ id: 'synthetic-graph-chat' }] }, conversations: [{ resourceId: 'synthetic-chat', providerId: 'local' }] });
const events = () => ({ truncated: false, events: [{ type: 'checklist.changed', nativeSequence: null, turnId: null, threadId: null }] });
const counters = () => ({ scope: 'process-session-native-attempts', codexConnections: 0, providerRequests: 0, systemMemoryReads: 0 });
const desktop = () => ({ projects: [], workspaces: [], blocks: [], navigationBlocks: [], resources: [{ id: 'synthetic-manual', kind: 'checklist' }, { id: 'synthetic-linked', kind: 'checklist' }, { id: 'synthetic-chat', kind: 'conversation' }] });

test('native Checklist helper admits only explicit owned fresh-profile flag and automated window', () => {
  assertOwnedProfile('C:\\Owned\\review-checklists-123', ['--integration-checklists'], 'Aerynth Automated check');
  for (const root of ['C:\\Users\\person', 'D:\\review-checklists-123', 'review-checklists-123', 'C:\\Owned\\review-checklists-real']) assert.throws(() => assertOwnedProfile(root, ['--integration-checklists'], 'Automated check'));
  assert.throws(() => assertOwnedProfile('C:\\Owned\\review-checklists-123', [], 'Automated check'));
  assert.throws(() => assertOwnedProfile('C:\\Owned\\review-checklists-123', ['--integration-checklists'], 'Ordinary user window'));
});

test('canonical profile root and its exact Chromium child match Main; other profiles, siblings and mismatched CLI roots are denied', () => {
  const root = 'C:\\Owned\\review-checklists-123', child = root + '\\chromium';
  assertOwnedApplicationProfile(root, child, ['--integration-checklists', '--profile=' + root]);
  assertOwnedApplicationProfile(root, child, ['--integration-checklists']);
  for (const userData of [root, root + '\\chromium-sibling', 'C:\\Owned\\review-checklists-124\\chromium', 'C:\\Owned\\chromium', 'chromium']) assert.throws(() => assertOwnedApplicationProfile(root, userData, ['--profile=' + root]));
  for (const explicit of [root + '\\chromium', 'C:\\Owned\\review-checklists-124', 'review-checklists-123']) assert.throws(() => assertOwnedApplicationProfile(root, child, ['--profile=' + explicit]));
  assert.throws(() => assertOwnedApplicationProfile(root, child, ['--profile=' + root, '--profile=' + root]));
});

test('unowned Chromium profile fails before any window control, RPC, output write or app exit', async () => {
  const previous = process.argv; process.argv = [...previous, '--integration-checklists'];
  const originalLog = console.log; console.log = () => {};
  let controls = 0;
  const forbidden = () => { controls++; throw Error('must_not_control_unowned_profile'); };
  try {
    const result = await verify({ privateRoot: 'C:\\Owned\\review-checklists-123', win: { getTitle: () => 'Automated check', on: forbidden, removeListener: forbidden, webContents: { executeJavaScript: forbidden, sendInputEvent: forbidden, removeListener: forbidden } }, app: { getPath: () => 'C:\\Owned\\review-checklists-124\\chromium', exit: forbidden }, call: forbidden });
    assert.equal(result.passed, false); assert.match(result.error.message, /actual_same_owned_application_profile_required/); assert.equal(controls, 0); assert.equal(result.nativeCloseConfirmed, undefined); assert.equal(result.reserve, undefined);
  } finally { process.argv = previous; console.log = originalLog; }
});

test('only actual read RPC is admitted; creation and edits must come through public UI', () => {
  assertRead('checklists', { name: 'read', input: { resourceId: 'synthetic-manual' } });
  assertRead('desktop', { type: 'snapshot' }); assertRead('snapshot', {}); assertRead('replay', { after: 0 });
  for (const name of ['create', 'mutate']) assert.throws(() => assertRead('checklists', { name, input: { resourceId: 'synthetic-manual' } }));
  for (const name of ['execute', 'conversation', 'providerConnection', 'notes', 'agents']) assert.throws(() => assertRead(name, {}));
  assert.throws(() => assertRead('desktop', { type: 'createResource' }));
  assert.throws(() => assertRead('checklists', { name: 'read', input: { resourceId: 'synthetic-manual', execute: true } }));
});

test('canonical Checklist proof preserves resource, entry, group, reference IDs and actual manual attribution', () => {
  const a = document(), b = linked(); assert.equal(assertDocument(a), a); assertFinished(a, b, 'synthetic-chat');
  for (const edit of [d => d.resource.kind = 'note', d => d.resource.projectId = 'synthetic-project', d => d.resource.version = 0, d => d.syncPolicy = 'automatic', d => d.entries[0].created.actor.kind = 'assistant', d => d.entries[0].completion.basis = 'model', d => d.entries[0].id = d.groups[0].id, d => d.updated.at = 'not-a-timestamp']) { const copy = structuredClone(a); edit(copy); assert.throws(() => assertDocument(copy)); }
  for (const edit of [d => d.entries[0].checked = false, d => d.entries[0].dueDate = null, d => d.entries[0].priority = 'normal', d => d.entries[0].groupId = 'replacement', d => d.references[0].target.resourceId = 'provider-thread-imitation', d => d.references[0].available = false]) { const copy = structuredClone(a); edit(copy); assert.throws(() => assertFinished(copy, b, 'synthetic-chat')); }
});

test('zero provider attempts require actual counters plus complete events and no fabricated transcript or bindings', () => {
  assertNoExecution(core(), events(), counters());
  for (const key of ['codexConnections', 'providerRequests', 'systemMemoryReads']) assert.throws(() => assertNoExecution(core(), events(), { ...counters(), [key]: 1 }));
  assert.throws(() => assertNoExecution(core(), events(), null));
  for (const change of [c => c.executions.actual = {}, c => c.handoffs.actual = {}, c => c.bindings.actual = { threadId: 'native' }, c => c.graph.messages.push({ role: 'assistant', content: 'fabricated' }), c => c.conversations[0].providerId = 'codex-app-server']) { const value = core(); change(value); assert.throws(() => assertNoExecution(value, events(), counters())); }
  assert.throws(() => assertNoExecution(core(), { ...events(), truncated: true }, counters()));
  assert.throws(() => assertNoExecution(core(), { truncated: false, events: [{ type: 'provider/connection' }] }, counters()));
});

test('manual and linked Checklist cannot qualify by creating workspaces, placements, notes, tasks or placeholder resources', () => {
  assertNoPlacements(desktop());
  for (const key of ['projects', 'workspaces', 'blocks', 'navigationBlocks', 'archivedWorkspaces']) { const d = desktop(); d[key] ??= []; d[key].push({ id: 'unrequested' }); assert.throws(() => assertNoPlacements(d)); }
  for (const kind of ['note', 'task', 'agent', 'generic']) { const d = desktop(); d.resources[0].kind = kind; assert.throws(() => assertNoPlacements(d)); }
  const d = desktop(); d.resources.push({ id: 'extra-checklist', kind: 'checklist' }); assert.throws(() => assertNoPlacements(d));
});

test('same-source restart requires original passing close receipt and exact canonical documents, attribution and source/assets', () => {
  const source = { hashes: { source: 'a'.repeat(64) }, buildAssets: { 'app.js': 'b'.repeat(64) } }, canonical = { manual: document(), linked: linked(), chatId: 'synthetic-chat' };
  const checkpoint = { contract: 'aerynth.checklists-checkpoint@1', source, moduleHashes: { helper: 'c'.repeat(64) }, canonical };
  const receipt = { contract: 'aerynth.checklists-integration@1', passed: true, restore: false, nativeCloseConfirmed: true, source, moduleHashes: checkpoint.moduleHashes, canonical };
  passingCheckpoint(checkpoint, receipt);
  for (const change of [r => r.passed = false, r => r.nativeCloseConfirmed = false, r => r.restore = true, r => r.source.buildAssets['app.js'] = 'd'.repeat(64), r => r.canonical.manual.entries[0].id = 'replaced-entry', r => r.canonical.manual.updated.at = '2026-11-03T00:00:00Z']) { const value = structuredClone(receipt); change(value); assert.throws(() => passingCheckpoint(checkpoint, value)); }
});

test('Checklist native typing shares asynchronous focus/selection/value barriers instead of pretending a posted click is focus', async () => {
  const target = { value: 'Old title', selectionStart: 2, selectionEnd: 2 }, previous = { value: 'Other field' }; let active = previous, stage = 0, inserted = false;
  const doc = { querySelector: () => target, get activeElement() { return active; } };
  await fillNative({ click: async () => {}, key() { assert.equal(active, target); stage = 2; }, js: async code => vm.runInNewContext(code, { document: doc }), wait: async (_label, check) => { if (stage === 0) { assert.equal(await check(), false); active = target; stage = 1; } else if (stage === 2) { assert.equal(await check(), false); target.selectionStart = 0; target.selectionEnd = target.value.length; stage = 3; } assert.equal(await check(), true); }, insertText: async text => { assert.equal(stage, 3); target.value = text; inserted = true; } }, '#title', 'Exact Checklist title');
  assert.equal(inserted, true); assert.equal(target.value, 'Exact Checklist title'); assert.equal(previous.value, 'Other field');
});

test('45/12-second slots reserve cleanup, focus loss is sticky, and shared PNG budget cannot reset on restore', () => {
  let focused = true, now = 0; const win = { isDestroyed: () => false, isVisible: () => true, isMinimized: () => false, isFocused: () => focused, webContents: { isDestroyed: () => false } };
  const slot = createSlot({ win, startedAt: 0, limitMs: 45000, cleanupMs: 4000, now: () => now }); focused = false; assert.throws(() => slot.check()); focused = true; assert.throws(() => slot.check());
  const restore = createSlot({ win, startedAt: 0, limitMs: 12000, cleanupMs: 2500, now: () => now }); now = 9500; assert.throws(() => restore.check()); assert.equal(restore.remaining(), 2500);
  const budget = { count: 0, bytes: 0, files: [] }, png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(8)]); admitPNG(budget, png, 'initial-1'); admitPNG(budget, png, 'initial-2'); const resumed = validateBudget(structuredClone(budget)); admitPNG(resumed, png, 'restore'); assert.throws(() => admitPNG(resumed, png, 'fourth'));
});

test('helper runs actual UI paths without seeding, mutations, true evaluation, focus bypass, OS input, auth or provider probe', () => {
  const source = fs.readFileSync(require.resolve('../native/integration-checklists.cjs'), 'utf8');
  assert(source.includes('executeJavaScript(code, false)')); assert(source.includes('fillNative({ click, key, js, wait'));
  assert(!/executeJavaScript\([^\n]+, true\)|createDriver\(|driver\.js\(|win\.focus\(|webContents\.focus\(|globalShortcut|setCursorPos|window\.__aerynth\.(?:execute|openResource)\(|\.focus\(\)/.test(source));
  assert(!/rpc\(['"](?:execute|conversation|notes|providerConnection)['"]/.test(source));
  assert(source.includes('assertRead(name, input)')); assert(source.includes("#standalone-checklist")); assert(source.includes("#application-new-chat")); assert(source.includes("'Create linked checklist'")); assert(source.includes("'Link source'")); assert(source.includes("'renderer-DOM-input'"));
  assert(source.indexOf("win.removeListener('blur'") > source.indexOf("call('close'"));
  assert(source.includes('next.frames > before.frames && next.draws > before.draws')); assert(source.includes("call('close', {})"));
});
