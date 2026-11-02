const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { assertOwnedProfile, assertRead, assertTimeline, assertWindow, assertNoExecution, expectedViewport, passingCheckpoint, HEADER_KEYS, CAPABILITIES, verify } = require('../native/integration-timeline.cjs');
const { createSlot } = require('../native/integration-resource-opening.cjs');
const { validateBudget, admitPNG } = require('../native/integration-desktop-basics.cjs');
const source = () => ({ hashes: { source: 'a'.repeat(64) }, buildAssets: { 'app.js': 'b'.repeat(64) } });
const document = () => ({ contract: 'aerynth.timeline@1', schemaVersion: 1, resource: { id: 'synthetic-timeline', kind: 'timeline', title: 'Recent activity', projectId: null, version: 6, state: 'active' }, canEdit: true, view: { schemaVersion: 1, mode: 'activity', scope: { projectId: null, resourceIds: [] }, sources: { providerIds: ['aerynth-native'], eventTypes: ['checklist.created'], classifications: ['observed'] }, viewport: { from: '2026-11-02T00:00:00.000Z', to: '2026-11-03T00:00:00.000Z', displayTimeZone: 'America/New_York' }, selection: { eventId: 'synthetic-event', cursor: 3 } }, viewDigest: 'c'.repeat(64), selectionUnavailable: false, createdAt: '2026-11-02T12:00:00.000Z', updatedAt: '2026-11-02T12:05:00.000Z', capabilities: { ...CAPABILITIES } });
const event = () => ({ schemaVersion: 1, eventId: 'synthetic-event', cursor: 3, resourceId: 'synthetic-checklist', executionId: null, providerId: 'aerynth-native', providerInstanceId: 'synthetic-instance', connectionId: 'synthetic-connection', nativeEventId: null, nativeSequence: null, threadId: null, turnId: null, correlationId: 'synthetic-create-command', causationId: null, receivedAt: '2026-11-02T12:00:00.000Z', providerTime: null, providerTimeSource: null, type: 'checklist.created', classification: 'observed', status: null });
const item = () => ({ kind: 'recorded-event', temporalClass: 'historical', evidenceClass: 'observed', event: event(), source: { store: 'intelligence_events', cursor: 3, eventId: 'synthetic-event', schemaVersion: 1 }, navigation: { resourceId: 'synthetic-checklist', state: 'active' }, taskVerification: 'not-established-by-this-projection' });
const replay = () => ({ truncated: false, events: [{ ...event(), payload: { privateSyntheticBody: 'NOT A TIMELINE HEADER' } }] });
const window = () => ({ contract: 'aerynth.timeline-window@1', resourceId: 'synthetic-timeline', resourceVersion: 6, viewDigest: 'c'.repeat(64), order: 'capture-cursor', timeAxis: 'receivedAt', scopeBasis: 'current-authorized-canonical-resources', items: [item()], gaps: [], next: null, source: { store: 'intelligence_events', state: 'retained-history', earliestRetainedCursor: 1, throughCursor: 9, observedLatestCursor: 9 }, coverage: { matchingItems: 'complete-retained-window', allActivity: false, rawPayloads: false, unscopedEvents: 'authorized-global-only', timeComparability: 'capture-order-is-not-global-causality' }, hasNewEvents: false, selectionUnavailable: false, capabilities: { ...CAPABILITIES } });
const core = () => ({ executions: {}, handoffs: {}, bindings: {}, resourceMap: {}, graph: { messages: [], conversations: [] }, conversations: [] });
const counters = () => ({ scope: 'process-session-native-attempts', codexConnections: 0, providerRequests: 0, systemMemoryReads: 0 });
const desktop = () => ({ projects: [], workspaces: [], blocks: [], archivedWorkspaces: [], navigationBlocks: [], resources: [{ id: 'synthetic-checklist', kind: 'checklist' }, { id: 'synthetic-timeline', kind: 'timeline' }] });

test('native Timeline guard matches explicit canonical root and exact Chromium child, flag and automated window', () => {
  const root = 'C:\\Owned\\review-timeline-123', args = ['--integration-timeline', '--profile=' + root]; assertOwnedProfile(root, args, 'Aerynth Automated check', root + '\\chromium');
  for (const wrong of ['C:\\Users\\person', 'D:\\review-timeline-123', 'review-timeline-123', 'C:\\Owned\\review-timeline-real']) assert.throws(() => assertOwnedProfile(wrong, args, 'Automated check', root + '\\chromium'));
  assert.throws(() => assertOwnedProfile(root, [], 'Automated check', root + '\\chromium')); assert.throws(() => assertOwnedProfile(root, args, 'User window', root + '\\chromium'));
  for (const wrong of [root, root + '\\chromium-sibling', 'C:\\Owned\\review-timeline-124\\chromium']) assert.throws(() => assertOwnedProfile(root, args, 'Automated check', wrong));
  assert.throws(() => assertOwnedProfile(root, ['--integration-timeline', '--profile=' + root + '\\chromium'], 'Automated check', root + '\\chromium'));
});

test('unowned Timeline profile fails before any native control, RPC, writes or app exit', async () => {
  const previous = process.argv, log = console.log; process.argv = [...previous, '--integration-timeline']; console.log = () => {}; let controls = 0; const forbidden = () => { controls++; throw Error('unowned_control_forbidden'); };
  try { const result = await verify({ privateRoot: 'C:\\Owned\\review-timeline-123', win: { getTitle: () => 'Automated check', on: forbidden, removeListener: forbidden, webContents: { executeJavaScript: forbidden, sendInputEvent: forbidden, removeListener: forbidden } }, app: { getPath: () => 'C:\\Owned\\review-timeline-124\\chromium', exit: forbidden }, call: forbidden }); assert.equal(result.passed, false); assert.match(result.error.message, /actual_same_owned_application_profile_required/); assert.equal(controls, 0); assert.equal(result.reserve, undefined); }
  finally { process.argv = previous; console.log = log; }
});

test('Timeline helper permits reads only; actual UI must create source events and save views', () => {
  assertRead('timelines', { name: 'read', input: { resourceId: 'synthetic-timeline' } }); assertRead('timelines', { name: 'query', input: { resourceId: 'synthetic-timeline', expectedVersion: 6 } }); assertRead('checklists', { name: 'read', input: { resourceId: 'synthetic-checklist' } }); assertRead('desktop', { type: 'snapshot' }); assertRead('snapshot', {}); assertRead('replay', { after: 0 });
  for (const name of ['create', 'save', 'ingest', 'reexecute']) assert.throws(() => assertRead('timelines', { name, input: {} }));
  assert.throws(() => assertRead('checklists', { name: 'mutate', input: {} })); assert.throws(() => assertRead('desktop', { type: 'createResource' }));
  for (const name of ['conversation', 'execute', 'providerConnection', 'notes']) assert.throws(() => assertRead(name, {}));
});

test('Timeline document keeps canonical ID/version, real saved timezone and unsupported capabilities honest', () => {
  const value = document(); assert.equal(assertTimeline(value), value); assert.equal(value.view.viewport.displayTimeZone, 'America/New_York');
  for (const change of [d => d.resource.kind = 'note', d => d.resource.version = 0, d => d.resource.projectId = 'unexpected-project', d => d.view.viewport.displayTimeZone = 'Not/A_Zone', d => d.view.viewport.to = d.view.viewport.from, d => d.viewDigest = 'unbound', d => d.selectionUnavailable = true, d => d.capabilities.stateReconstruction = true]) { const value = document(); change(value); assert.throws(() => assertTimeline(value)); }
});

test('retained Timeline headers match exact actual source cursor/ID/provenance without copying payloads or promoting task completion', () => {
  const value = window(); assert.equal(assertWindow(value, document(), replay()), value); assert.deepEqual(Object.keys(value.items[0].event).sort(), [...HEADER_KEYS].sort());
  for (const change of [w => w.items[0].event.payload = 'PRIVATE_SYNTHETIC_PAYLOAD', w => w.items[0].source.store = 'another-store', w => w.items[0].source.cursor = 4, w => w.items[0].event.receivedAt = '2026-11-02T13:00:00.000Z', w => w.items[0].temporalClass = 'forecast', w => w.items[0].evidenceClass = 'simulated', w => w.items[0].taskVerification = 'verified', w => w.resourceVersion = 7, w => w.source.state = 'unavailable', w => w.coverage.rawPayloads = true, w => w.coverage.allActivity = true, w => w.capabilities.reexecution = true]) { const w = window(); change(w); assert.throws(() => assertWindow(w, document(), replay())); }
  assert.throws(() => assertWindow(window(), document(), { truncated: true, events: [event()] })); assert.throws(() => assertWindow(window(), document(), { truncated: false, events: [] }));
});

test('viewport expectations derive from actual UTC input values and preserve separate display timezone semantics', () => {
  const from = '2026-11-02T00:00:00', to = '2026-11-03T00:00:00';
  assert.deepEqual(expectedViewport(from, to, 'Earlier'), { from: '2026-11-01T00:00:00.000Z', to: '2026-11-02T00:00:00.000Z' });
  assert.deepEqual(expectedViewport(from, to, 'Later'), { from: '2026-11-03T00:00:00.000Z', to: '2026-11-04T00:00:00.000Z' });
  assert.deepEqual(expectedViewport(from, to, 'Zoom out'), { from: '2026-11-01T12:00:00.000Z', to: '2026-11-03T12:00:00.000Z' });
  assert.throws(() => expectedViewport(from, from, 'Earlier')); assert.throws(() => expectedViewport(from, to, 'Unregistered action'));
});

test('no provider/state imitation or hidden workspace/resource substitutes can qualify', () => {
  assertNoExecution(core(), replay(), counters(), desktop());
  for (const key of ['codexConnections', 'providerRequests', 'systemMemoryReads']) assert.throws(() => assertNoExecution(core(), replay(), { ...counters(), [key]: 1 }, desktop()));
  for (const key of ['executions', 'handoffs', 'bindings', 'resourceMap']) { const value = core(); value[key].unexpected = {}; assert.throws(() => assertNoExecution(value, replay(), counters(), desktop())); }
  const c = core(); c.graph.messages.push({ role: 'assistant' }); assert.throws(() => assertNoExecution(c, replay(), counters(), desktop()));
  for (const key of ['projects', 'workspaces', 'blocks', 'archivedWorkspaces', 'navigationBlocks']) { const d = desktop(); d[key].push({ id: 'unexpected' }); assert.throws(() => assertNoExecution(core(), replay(), counters(), d)); }
  const d = desktop(); d.resources[1].kind = 'note'; assert.throws(() => assertNoExecution(core(), replay(), counters(), d));
});

test('restart binds exact saved view/version/selection/source while new global cursor observations remain distinct', () => {
  const canonical = { document: document(), source: item(), sourceChecklistId: 'synthetic-checklist' }, checkpoint = { contract: 'aerynth.timeline-checkpoint@1', source: source(), moduleHashes: { helper: 'd'.repeat(64) }, canonical };
  const receipt = { contract: 'aerynth.timeline-integration@1', passed: true, restore: false, nativeCloseConfirmed: true, source: source(), moduleHashes: checkpoint.moduleHashes, canonical, windowObservation: window() }; passingCheckpoint(checkpoint, receipt);
  receipt.windowObservation.source.observedLatestCursor = 10; receipt.windowObservation.hasNewEvents = true; passingCheckpoint(checkpoint, receipt);
  for (const change of [r => r.passed = false, r => r.nativeCloseConfirmed = false, r => r.restore = true, r => r.canonical.document.resource.version++, r => r.canonical.document.view.selection.eventId = 'replacement', r => r.canonical.source.event.cursor = 7, r => r.source.buildAssets['app.js'] = 'e'.repeat(64)]) { const r = structuredClone(receipt); change(r); assert.throws(() => passingCheckpoint(checkpoint, r)); }
});

test('45/12-second slots retain sticky focus loss and cleanup; native captures share one capped initial/restart budget', () => {
  let now = 0, focused = true; const win = { isDestroyed: () => false, isVisible: () => true, isMinimized: () => false, isFocused: () => focused, webContents: { isDestroyed: () => false } };
  const slot = createSlot({ win, startedAt: 0, limitMs: 45000, cleanupMs: 4000, now: () => now }); focused = false; assert.throws(() => slot.check()); focused = true; assert.throws(() => slot.check());
  const short = createSlot({ win, startedAt: 0, limitMs: 12000, cleanupMs: 2500, now: () => now }); now = 9500; assert.throws(() => short.check()); assert.equal(short.remaining(), 2500);
  const budget = { count: 0, bytes: 0, files: [] }, png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(8)]); admitPNG(budget, png, 'initial-1'); admitPNG(budget, png, 'initial-2'); const shared = validateBudget(structuredClone(budget)); admitPNG(shared, png, 'restore'); assert.throws(() => admitPNG(shared, png, 'fourth'));
});

test('Timeline journey uses source-producing UI and native barriers without synthetic source events, true evaluation or authority bypass', () => {
  const source = fs.readFileSync(require.resolve('../native/integration-timeline.cjs'), 'utf8'); assert(source.includes('executeJavaScript(code, false)')); assert(source.includes('fillNative({ click, key, js, wait'));
  assert(!/executeJavaScript\([^\n]+, true\)|createDriver\(|driver\.js\(|win\.focus\(|webContents\.focus\(|globalShortcut|setCursorPos|window\.__aerynth\.(?:execute|openResource)\(|\.focus\(\)/.test(source));
  assert(!/rpc\(['"](?:execute|conversation|notes|providerConnection)['"]/.test(source)); assert(!/rpc\('timelines', \{ name: '(?:create|save)'/.test(source));
  for (const hook of ['#standalone-checklist', '#new-activity-timeline', 'Open source', 'Earlier', 'Zoom out', 'Later', 'Save view', 'assertWindow(value, document', 'assertOwnedProfile(privateRoot']) assert(source.includes(hook));
  assert(source.includes('next.frames > before.frames && next.draws > before.draws')); assert(source.indexOf("win.removeListener('blur'") > source.indexOf("call('close'")); assert(source.includes('if (listenersInstalled)'));
  assert(source.includes('await readyDocument(before)')); assert(source.includes('await readyDocument(document); await renderedSelection(document, sourceItem)'));
});
