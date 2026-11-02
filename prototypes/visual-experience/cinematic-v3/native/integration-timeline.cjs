/* Actual-desktop retained Timeline acceptance. Main dispatches only with
 * --integration-timeline --profile=<C:absolute review-timeline-DIGITS>.
 * Initial/restore slots 45s/12s include cleanup; same source/profile required.
 * <=3 PNG/16MiB combined; no video, provider, event injection or mutation RPC.
 * Native app-window input is software input, never physical OS input. */
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { execFileSync } = require('node:child_process');
const { createSlot, targetScript, waitForCondition, sourceIdentity } = require('./integration-resource-opening.cjs');
const { validateBudget, admitPNG } = require('./integration-desktop-basics.cjs');
const { fillNative } = require('./integration-agents.cjs');
const { assertOwnedApplicationProfile, assertDocument: assertChecklist } = require('./integration-checklists.cjs');
const MiB = 1024 * 1024;
const FIXTURE = Object.freeze({ checklist: 'SYNTHETIC Timeline source checklist', item: 'Manually inspect the retained event source' });
const CAPABILITIES = Object.freeze({ planning: false, forecasts: false, dependencies: false, stateReconstruction: false, reexecution: false, export: false });
const HEADER_KEYS = Object.freeze(['schemaVersion', 'eventId', 'cursor', 'resourceId', 'executionId', 'providerId', 'providerInstanceId', 'connectionId', 'nativeEventId', 'nativeSequence', 'threadId', 'turnId', 'correlationId', 'causationId', 'receivedAt', 'providerTime', 'providerTimeSource', 'type', 'classification', 'status']);
const timelineScope = id => `.aw-timeline[data-resource-id=${JSON.stringify(id)}]`;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function encode(value) { const text = JSON.stringify(value, null, 2); assert(Buffer.byteLength(text) <= MiB, 'timeline_receipt_capacity'); return text; }
function assertOwnedProfile(root, argv, title, userData) {
  assert(argv.includes('--integration-timeline'), 'explicit_timeline_flag_required');
  assert(typeof root === 'string' && path.win32.isAbsolute(root) && path.win32.parse(root).root.toLowerCase() === 'c:\\' && /^review-timeline-\d+$/.test(path.win32.basename(root)), 'fresh_owned_timeline_profile_required');
  assert.match(title, /Automated check/i, 'owned_automated_window_required');
  assertOwnedApplicationProfile(root, userData, argv);
}
function assertRead(name, input) {
  assert(['timelines', 'checklists', 'desktop', 'snapshot', 'replay'].includes(name), 'timeline_readonly_rpc_required');
  if (name === 'timelines') assert(['read', 'query'].includes(input?.name), 'timeline_ui_mutations_only');
  if (name === 'checklists') assert(input?.name === 'read', 'source_ui_mutations_only');
  if (name === 'desktop') assert.equal(input?.type, 'snapshot');
}
function assertTimeline(value) {
  assert(value?.contract === 'aerynth.timeline@1' && value.schemaVersion === 1 && value.resource?.kind === 'timeline' && value.resource.state === 'active' && value.resource.projectId === null && Number.isSafeInteger(value.resource.version) && value.resource.version > 0 && value.canEdit === true, 'canonical_timeline_identity_required');
  assert(typeof value.resource.id === 'string' && value.resource.id && /^[a-f0-9]{64}$/.test(value.viewDigest), 'canonical_timeline_id_digest_required');
  assert(value.view?.schemaVersion === 1 && value.view.mode === 'activity' && value.view.scope.projectId === null && Array.isArray(value.view.scope.resourceIds), 'actual_activity_view_required');
  assert(Number.isFinite(Date.parse(value.view.viewport.from)) && Date.parse(value.view.viewport.from) < Date.parse(value.view.viewport.to));
  assert(typeof value.view.viewport.displayTimeZone === 'string' && value.view.viewport.displayTimeZone); new Intl.DateTimeFormat('en', { timeZone: value.view.viewport.displayTimeZone }); assert.equal(value.selectionUnavailable, false);
  assert(Number.isFinite(Date.parse(value.createdAt)) && Number.isFinite(Date.parse(value.updatedAt)));
  assert.deepEqual(value.capabilities, CAPABILITIES); return value;
}
function assertWindow(window, document, replay) {
  assert.equal(window?.contract, 'aerynth.timeline-window@1'); assert.equal(window.resourceId, document.resource.id); assert.equal(window.resourceVersion, document.resource.version); assert.equal(window.viewDigest, document.viewDigest);
  assert.equal(window.order, 'capture-cursor'); assert.equal(window.timeAxis, 'receivedAt'); assert.equal(window.scopeBasis, 'current-authorized-canonical-resources');
  assert.equal(window.source.store, 'intelligence_events'); assert.equal(window.source.state, 'retained-history');
  assert.equal(window.coverage.allActivity, false); assert.equal(window.coverage.rawPayloads, false); assert.equal(window.coverage.timeComparability, 'capture-order-is-not-global-causality'); assert.deepEqual(window.capabilities, CAPABILITIES);
  assert(Array.isArray(window.items) && window.items.length <= 200); assert.equal(replay.truncated, false, 'actual_complete_retained_event_coverage_required');
  let cursor = 0;
  for (const item of window.items) {
    assert.equal(item.kind, 'recorded-event'); assert.equal(item.temporalClass, 'historical'); assert.equal(item.taskVerification, 'not-established-by-this-projection');
    assert.equal(item.evidenceClass, item.event.classification); assert.deepEqual(Object.keys(item.event).sort(), [...HEADER_KEYS].sort(), 'bodyless_exact_header_required');
    assert(item.event.cursor > cursor); cursor = item.event.cursor;
    assert.deepEqual(item.source, { store: 'intelligence_events', cursor: item.event.cursor, eventId: item.event.eventId, schemaVersion: 1 });
    const actual = replay.events.find(e => e.cursor === item.event.cursor && e.eventId === item.event.eventId); assert(actual, 'actual_source_event_required');
    for (const key of HEADER_KEYS) assert.deepEqual(item.event[key], actual[key], 'retained_header_mismatch:' + key);
  }
  return window;
}
function assertNoExecution(core, events, counters, desktop) {
  for (const key of ['executions', 'bindings', 'handoffs', 'resourceMap']) assert.equal(Object.keys(core[key]).length, 0, 'timeline_no_provider_or_chat_state:' + key);
  assert.equal(core.graph.messages.length, 0); assert.equal(core.graph.conversations.length, 0); assert.equal(core.conversations.length, 0);
  assert.equal(events.truncated, false); assert(!events.events.some(e => (e.nativeSequence ?? null) !== null || e.threadId || e.turnId || /^(?:provider\/|execution\/|item\/|turn\/|thread\/)/.test(e.type)), 'timeline_no_provider_events');
  assert.equal(counters?.scope, 'process-session-native-attempts'); for (const key of ['codexConnections', 'providerRequests', 'systemMemoryReads']) assert.equal(counters[key], 0, 'timeline_no_native_attempt:' + key);
  for (const key of ['projects', 'workspaces', 'blocks']) assert.equal(desktop[key].length, 0); assert.equal((desktop.archivedWorkspaces ?? []).length, 0); assert.equal((desktop.navigationBlocks ?? []).length, 0);
  assert(desktop.resources.length <= 2 && desktop.resources.every(r => ['checklist', 'timeline'].includes(r.kind)) && desktop.resources.filter(r => r.kind === 'checklist').length <= 1 && desktop.resources.filter(r => r.kind === 'timeline').length <= 1, 'no_note_or_other_placeholder');
}
function expectedViewport(from, to, action) {
  const start = Date.parse(from + 'Z'), end = Date.parse(to + 'Z'), width = end - start; assert(width > 0);
  if (action === 'Earlier' || action === 'Later') { const shift = width * (action === 'Earlier' ? -1 : 1); return { from: new Date(start + shift).toISOString(), to: new Date(end + shift).toISOString() }; }
  assert.equal(action, 'Zoom out'); const half = Math.max(500, Math.min(315360000000, width)); const center = (start + end) / 2;
  return { from: new Date(center - half).toISOString(), to: new Date(center + half).toISOString() };
}
function passingCheckpoint(checkpoint, initial) {
  assert(checkpoint?.contract === 'aerynth.timeline-checkpoint@1' && initial?.contract === 'aerynth.timeline-integration@1' && initial.passed === true && initial.restore === false && initial.nativeCloseConfirmed === true, 'original_passing_timeline_receipt_required');
  assert.deepEqual(sourceIdentity(initial.source), checkpoint.source); assert.deepEqual(initial.moduleHashes, checkpoint.moduleHashes); assert.deepEqual(initial.canonical, checkpoint.canonical);
}
async function bounded(promise, ms, code) { assert(ms > 0, code); let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(code)), ms); })]); } finally { clearTimeout(timer); } }
async function readJson(file) { assert((await fs.stat(file)).size <= MiB, 'bounded_timeline_checkpoint_required'); return JSON.parse(await fs.readFile(file, 'utf8')); }
Object.assign(exports, { assertOwnedProfile, assertRead, assertTimeline, assertWindow, assertNoExecution, expectedViewport, passingCheckpoint, FIXTURE, HEADER_KEYS, CAPABILITIES });

exports.verify = async function verify({ win, app, privateRoot, call, source, startupErrors = [], moduleStartedMonotonicMs, observeProviderActivity }) {
  const restore = process.argv.includes('--verify-restore'), limitMs = restore ? 12000 : 45000;
  const root = path.resolve(privateRoot), out = path.join(root, 'timeline-evidence', `${restore ? 'restore' : 'initial'}-${Date.now()}`);
  const expectedFile = path.join(root, 'timeline-expected.json'), budgetFile = path.join(root, 'timeline-capture-budget.json');
  const receipt = { contract: 'aerynth.timeline-integration@1', source, restore, passed: false, syntheticOnly: true,
    inputMethod: 'Software native-window mouse/key/insertText against actual App controls, with observed focus/selection/value barriers. Every renderer evaluation false. No event injection, mutation RPC, provider, account, auth, OS input/global hooks, clipboard or refocus.',
    limits: { milliseconds: limitMs, combinedPNGs: 3, combinedPNGBytes: 16 * MiB, videos: 0 }, actions: [], checks: [], captures: [], errors: [],
    limitations: ['Retained headers are not all activity, raw payloads, verified tasks or globally causal/provider-time order.', 'Planning, forecasts, dependencies, state reconstruction, reexecution and export remain unsupported.', 'A fresh GPU draw is not monitor-presentation, artistic or performance acceptance. Root must inspect native-window captures and confirm all processes exited.', 'Startup stream/reopened and saved-view events may advance the observed source cursor; restart compares exact saved view and selected source header, not a falsely frozen global event window.'] };
  let owned = false, admitted = false, listenersInstalled = false, budgetWritable = false, passed = false, slot, expected, pendingExpected, workTimer, hardTimer, rejectAbort, failureCapture;
  let budget = { count: 0, bytes: 0, files: [] };
  const aborted = new Promise((_, reject) => { rejectAbort = reject; }); aborted.catch(() => {});
  const abort = code => rejectAbort(slot?.abort(code) ?? Error(code));
  const blur = () => abort('timeline_focus_lost');
  const escape = (_event, input) => { if (input?.type === 'keyDown' && input.key === 'Escape') abort('timeline_operator_escape'); };
  const consoleError = (_event, details) => { if ((details?.level === 'error' || details?.level === 3) && receipt.errors.length < 24) receipt.errors.push(String(details.message).slice(0, 1000)); };
  const run = async () => {
    assertOwnedProfile(privateRoot, process.argv, win.getTitle(), app.getPath('userData')); sourceIdentity(source); owned = true;
    slot = createSlot({ win, startedAt: moduleStartedMonotonicMs, limitMs, cleanupMs: restore ? 2500 : 4000 }); slot.check();
    hardTimer = setTimeout(() => { receipt.hardDeadline = true; abort('timeline_hard_deadline'); app.exit(1); }, slot.remaining());
    workTimer = setTimeout(() => abort('timeline_work_deadline'), slot.workRemaining());
    listenersInstalled = true; win.on('blur', blur); win.on('hide', blur); win.on('minimize', blur); win.webContents.on('before-input-event', escape); win.webContents.on('console-message', consoleError);
    receipt.reserve = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.join(process.env.LOCALAPPDATA || '', 'AeroStorageWatch', 'ReserveGuard.ps1'), '-EstimatedCBytes', String(32 * MiB), '-EstimatedDBytes', '0'], { windowsHide: true, timeout: Math.floor(Math.min(4000, slot.workRemaining())), maxBuffer: 8192, encoding: 'utf8' }));
    assert.equal(receipt.reserve.allowed, true); admitted = true; slot.check(); await fs.mkdir(out, { recursive: true });
    receipt.moduleHashes = { helper: hash(await fs.readFile(__filename)) };
    for (const relative of ['timeline-product/contracts.ts', 'timeline-product/service.mts', 'block-library/timeline-view.ts', 'block-library/timeline-view.css', 'block-library/direct-resource-view.ts', 'checklist-product/service.mts', 'checklist-product/view.ts', 'checklist-product/creator.ts']) receipt.moduleHashes[relative] = hash(await fs.readFile(path.resolve(__dirname, '../../..', relative)));
    for (const name of ['integration-agents.cjs', 'integration-checklists.cjs', 'integration-resource-opening.cjs', 'integration-desktop-basics.cjs']) receipt.moduleHashes[name] = hash(await fs.readFile(path.join(__dirname, name)));
    for (const [name, digest] of Object.entries(source.buildAssets)) { assert.equal(path.basename(name), name); assert.equal(hash(await fs.readFile(path.join(__dirname, '../dist/assets', name))), digest, 'actual_build_asset_binding'); }
    if (restore) {
      expected = await readJson(expectedFile); assert.deepEqual(expected.source, sourceIdentity(source)); assert.deepEqual(expected.moduleHashes, receipt.moduleHashes);
      const prior = path.resolve(root, expected.initialReceipt), relative = path.relative(root, prior); assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'owned_passing_timeline_receipt_required'); passingCheckpoint(expected, await readJson(prior));
      budget = validateBudget(await readJson(budgetFile)); budgetWritable = true;
    } else { await assert.rejects(fs.stat(expectedFile), { code: 'ENOENT' }); await assert.rejects(fs.stat(budgetFile), { code: 'ENOENT' }); budgetWritable = true; }
    const js = async code => { slot.check(); const result = await bounded(win.webContents.executeJavaScript(code, false), slot.workRemaining(), 'timeline_renderer_deadline'); slot.check(); return result; };
    const rpc = async (name, input) => { assertRead(name, input); slot.check(); const result = await bounded(call(name, input), slot.workRemaining(), 'timeline_read_deadline'); slot.check(); return result; };
    const desktop = () => rpc('desktop', { type: 'snapshot' });
    const read = async id => { const document = assertTimeline((await rpc('timelines', { name: 'read', input: { resourceId: id } })).result); assert.equal(document.resource.id, id); return document; };
    const checklist = async id => { const document = assertChecklist((await rpc('checklists', { name: 'read', input: { resourceId: id } })).result); assert.equal(document.resource.id, id); return document; };
    const query = async document => { const value = (await rpc('timelines', { name: 'query', input: { resourceId: document.resource.id, expectedVersion: document.resource.version, limit: 200 } })).result; return assertWindow(value, document, await rpc('replay', { after: 0 })); };
    const wait = (label, check) => { receipt.phase = label; return waitForCondition({ slot, label, check, diagnose: () => js("({timeline:[...document.querySelectorAll('.aw-timeline')].map(n=>({id:n.dataset.resourceId,title:n.querySelector('h3')?.textContent,busy:n.getAttribute('aria-busy'),status:n.querySelector('.aw-timeline-status')?.textContent,coverage:n.querySelector('.aw-timeline-coverage')?.textContent,events:[...n.querySelectorAll('[data-event-id]')].map(e=>({id:e.dataset.eventId,cursor:e.dataset.eventCursor})),selection:n.querySelector('.aw-timeline-selection')?.textContent})),checklist:document.querySelector('.aw-checklist-status')?.textContent,surfaces:[...document.querySelectorAll('[data-surface-id]')].map(n=>n.dataset.surfaceId),error:document.querySelector('#command-error')?.textContent})") }); };
    const click = async selector => {
      await js(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'})`); let previous, point;
      await wait('Actual visible stable Timeline control ' + selector, async () => {
        const result = await js(targetScript(selector, 'inspect'));
        if (!result.ready) { await js(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n||n.closest('[hidden],[inert]'))return;const r=n.getBoundingClientRect();let clipped=r.left<0||r.top<0||r.right>innerWidth||r.bottom>innerHeight;for(let p=n.parentElement;p&&!clipped;p=p.parentElement){const s=getComputedStyle(p),b=p.getBoundingClientRect();clipped=(s.overflowX!=='visible'&&(r.left<b.left||r.right>b.right))||(s.overflowY!=='visible'&&(r.top<b.top||r.bottom>b.bottom));}if(clipped)n.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});})()`); previous = undefined; return false; }
        point = { x: Math.round(result.rect.x + result.rect.width / 2), y: Math.round(result.rect.y + result.rect.height / 2) }; const stable = previous && Math.abs(point.x - previous.x) < 1 && Math.abs(point.y - previous.y) < 1; previous = point; return stable;
      });
      receipt.actions.push({ method: 'software-native-window-mouse', selector }); for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) { slot.check(); win.webContents.sendInputEvent({ type, ...point, button: 'left', clickCount: 1 }); }
    };
    const key = (keyCode, modifiers = []) => { for (const type of ['keyDown', 'keyUp']) { slot.check(); win.webContents.sendInputEvent({ type, keyCode, modifiers }); } };
    const fill = async (selector, text) => { await fillNative({ click, key, js, wait, insertText: text => bounded(win.webContents.insertText(text), slot.workRemaining(), 'timeline_text_input_deadline') }, selector, text); receipt.actions.push({ method: 'software-native-window-insertText', selector, characters: text.length }); };
    const select = async (selector, value) => {
      const index = await js(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});return n?[...n.options].findIndex(o=>o.value===${JSON.stringify(value)}&&!o.disabled):-1})()`); assert(index >= 0 && index <= 32, 'actual_bounded_timeline_option_required');
      await click(selector); await wait('Actual native Timeline select focus', () => js(`document.activeElement===document.querySelector(${JSON.stringify(selector)})`)); key('Home'); for (let i = 0; i < index; i++) key('Down'); key('Return'); await wait('Exact actual Timeline selection', () => js(`document.querySelector(${JSON.stringify(selector)})?.value===${JSON.stringify(value)}`));
    };
    const byText = async (container, text) => {
      let selector; await wait('Actual Timeline public control ' + text, async () => { selector = await js(`(()=>{const n=[...document.querySelector(${JSON.stringify(container)})?.querySelectorAll('button')??[]].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!n)return null;let p=n,parts=[];while(p&&p!==document.documentElement){parts.unshift(p.tagName.toLowerCase()+':nth-child('+([...p.parentElement.children].indexOf(p)+1)+')');p=p.parentElement;}return 'html>'+parts.join('>')})()`); return !!selector; }); await click(selector);
    };
    const close = async () => { await click('[data-surface-id="canonical-resource"] .aw-contextual-dismiss'); await wait('Canonical resource surface actually closes', () => js('!document.querySelector(\'[data-surface-id="canonical-resource"]\')')); };
    const openTimeline = async document => {
      await click('#application-resources'); await fill('#resource-search', document.resource.title); await click(`#resource-results [data-open-resource=${JSON.stringify(document.resource.id)}]`);
      await wait('Exact canonical direct Timeline ready', () => js(`(()=>{const n=document.querySelector(${JSON.stringify(timelineScope(document.resource.id))});return n&&!n.closest('[hidden],[inert]')&&n.getAttribute('aria-busy')==='false'&&n.querySelector('h3')?.textContent===${JSON.stringify(document.resource.title)}})()`));
    };
    // Canonical acknowledgment can precede the viewer's awaited read/query.
    // Never derive the next gesture from fields belonging to the previous view.
    const readyDocument = document => wait('Actual viewer caught up with canonical saved viewport', () => js(`(()=>{const n=document.querySelector(${JSON.stringify(timelineScope(document.resource.id))});return n?.getAttribute('aria-busy')==='false'&&n.querySelector('[aria-label="From (UTC)"]')?.value===${JSON.stringify(document.view.viewport.from.slice(0, 19))}&&n.querySelector('[aria-label="To (UTC)"]')?.value===${JSON.stringify(document.view.viewport.to.slice(0, 19))}})()`));
    const proof = async () => {
      const core = await rpc('snapshot', {}), d = await desktop(), events = await rpc('replay', { after: 0 }); assert.equal(typeof observeProviderActivity, 'function', 'actual_provider_observer_required'); const counters = await bounded(observeProviderActivity(), slot.workRemaining(), 'timeline_observer_deadline'); assertNoExecution(core, events, counters, d);
      return { graph: core.graph, resourceMap: core.resourceMap, projects: d.projects, workspaces: d.workspaces, blocks: d.blocks, resources: d.resources.map(r => ({ id: r.id, kind: r.kind, title: r.title, version: r.version, projectId: r.project_id })).sort((a, b) => a.id.localeCompare(b.id)), relationships: d.relationships, counters };
    };
    const capture = async name => {
      const sample = () => js("(()=>{const s=window.__aerynth.snapshot();return{frames:s.gpu?.framesRendered,draws:s.metrics.draws,active:s.active,lost:s.gpu?.contextLost,failed:s.graphicsFailed,errors:s.metrics.errors}})()");
      const before = await sample(); await wait('Focused new actual Timeline GPU draw', async () => { const next = await sample(); return next.active === true && next.failed === false && next.lost === false && next.errors.length === 0 && next.frames > before.frames && next.draws > before.draws; });
      const png = (await bounded(win.webContents.capturePage(), slot.workRemaining(), 'timeline_capture_deadline')).toPNG(); slot.check(); const file = path.join(out, name + '.png'), item = admitPNG(budget, png, file); await fs.writeFile(file, png, { flag: 'wx' }); receipt.captures.push({ ...item, focused: true, before, after: await sample() });
    }; failureCapture = () => capture('failure');
    const renderedSelection = async (document, item) => {
      const container = timelineScope(document.resource.id), event = item.event;
      await wait('Actual selected source provenance rendered', () => js(`(()=>{const n=document.querySelector(${JSON.stringify(container)}),r=n?.querySelector('[data-event-id="'+CSS.escape(${JSON.stringify(event.eventId)})+'"]>button'),d=n?.querySelector('.aw-timeline-selection dl');if(r?.getAttribute('aria-pressed')!=='true'||!d)return false;const v=Object.fromEntries([...d.querySelectorAll('dt')].map(e=>[e.textContent,e.nextElementSibling?.textContent]));return v['Event reference']===${JSON.stringify(event.eventId)}&&v['Capture cursor']===${JSON.stringify(String(event.cursor))}&&v['Event type']===${JSON.stringify(event.type)}&&v['Source']===${JSON.stringify(event.providerId)}&&v['Evidence']===${JSON.stringify(item.evidenceClass)}})()`));
    };
    const canonical = async (timelineId, checklistId, selection) => {
      const document = await read(timelineId), producer = await checklist(checklistId), window = await query(document); receipt.windowObservation = window;
      assert.equal(producer.resource.title, FIXTURE.checklist); assert.equal(producer.entries.length, 1); assert.equal(producer.entries[0].text, FIXTURE.item); assert.equal(producer.entries[0].checked, true);
      assert.deepEqual(document.view.selection, selection); assert.deepEqual(document.view.sources, { providerIds: ['aerynth-native'], eventTypes: ['checklist.created'], classifications: ['observed'] });
      const item = window.items.find(i => i.event.eventId === selection.eventId && i.event.cursor === selection.cursor); assert(item, 'saved_selected_source_visible_in_actual_retained_window');
      assert.equal(item.event.resourceId, checklistId); assert.deepEqual(item.navigation, { resourceId: checklistId, state: 'active' });
      const state = await proof(); assert.deepEqual(state.resources.map(r => r.id).sort(), [timelineId, checklistId].sort());
      return { document, producer, source: item, desktop: state };
    };
    await wait('Combined app ready', () => js("document.body.dataset.applicationHydrated==='true'")); receipt.startingCanonical = await proof();
    if (restore) {
      const value = await canonical(expected.timelineId, expected.checklistId, expected.canonical.document.view.selection); assert.deepEqual(value, expected.canonical, 'exact_timeline_view_version_selection_source_and_checklist_restart');
      await openTimeline(value.document); await readyDocument(value.document); await renderedSelection(value.document, value.source); await byText(timelineScope(value.document.resource.id) + ' .aw-timeline-tools', 'Filters');
      await wait('Actual restored filter controls', () => js(`(()=>{const n=document.querySelector(${JSON.stringify(timelineScope(value.document.resource.id))});return n?.querySelector('[aria-label="Source"]')?.value==='aerynth-native'&&n.querySelector('[aria-label="Event type"]')?.value==='checklist.created'&&n.querySelector('[aria-label="Evidence class"]')?.value==='observed'})()`));
      await capture('03-timeline-restart'); receipt.canonical = value;
    } else {
      assert.equal(receipt.startingCanonical.resources.length, 0, 'fresh_empty_timeline_profile_required');
      await click('#application-resources'); await click('#standalone-checklist'); await fill('.aw-checklist-creator input[aria-label="Checklist title"]', FIXTURE.checklist); await byText('.aw-checklist-creator', 'Create checklist');
      let checklistId; await wait('Actual canonical Checklist event producer created', async () => { const resource = (await desktop()).resources.find(r => r.kind === 'checklist' && r.title === FIXTURE.checklist); if (resource) checklistId = resource.id; return !!resource; });
      const producerScope = `.aw-checklist[data-resource-id=${JSON.stringify(checklistId)}]`;
      await fill(producerScope + ' input[aria-label="New checklist item"]', FIXTURE.item); await byText(producerScope + ' .aw-checklist-add', 'Add item');
      let producer; await wait('Actual manual source item saved', async () => { producer = await checklist(checklistId); return producer.entries.length === 1 && producer.entries[0].text === FIXTURE.item; });
      const entryId = producer.entries[0].id; await click(`${producerScope} [data-checklist-entry-id=${JSON.stringify(entryId)}] input[aria-label="Check item manually"]`); await wait('Actual source item manually checked', async () => (await checklist(checklistId)).entries[0].checked); await close();
      await click('#application-resources'); await click('#new-activity-timeline');
      let timelineId, document; await wait('Immediate canonical Recent activity Timeline created by UI', async () => { const resource = (await desktop()).resources.find(r => r.kind === 'timeline'); if (!resource) return false; timelineId = resource.id; document = await read(timelineId); return document.view.mode === 'activity'; });
      const container = timelineScope(timelineId); await wait('Actual Timeline read and query ready', () => js(`document.querySelector(${JSON.stringify(container)})?.getAttribute('aria-busy')==='false'`));
      await readyDocument(document); const initial = document, firstWindow = await query(document); receipt.initialWindow = firstWindow;
      assert(firstWindow.items.some(i => i.event.type === 'checklist.created' && i.event.resourceId === checklistId), 'actual_checklist_event_must_already_be_retained'); await capture('01-retained-activity-timeline');
      for (const action of ['Earlier', 'Zoom out', 'Later']) {
        const before = await read(timelineId); await readyDocument(before); const fields = await js(`(()=>{const n=document.querySelector(${JSON.stringify(container)});return{from:n.querySelector('[aria-label="From (UTC)"]').value,to:n.querySelector('[aria-label="To (UTC)"]').value}})()`), viewport = expectedViewport(fields.from, fields.to, action);
        await byText(container + ' .aw-timeline-tools', action); await wait('Exact canonical saved viewport ' + action, async () => { document = await read(timelineId); return document.resource.version === before.resource.version + 1; });
        assert.equal(document.view.viewport.from, viewport.from); assert.equal(document.view.viewport.to, viewport.to); receipt.actions.push({ method: 'actual-saved-viewport-proof', action, version: document.resource.version, viewport: document.view.viewport });
      }
      assert.notDeepEqual(document.view.viewport, initial.view.viewport); await readyDocument(document); await byText(container + ' .aw-timeline-tools', 'Filters');
      await select(container + ' [aria-label="Source"]', 'aerynth-native'); await select(container + ' [aria-label="Event type"]', 'checklist.created'); await select(container + ' [aria-label="Evidence class"]', 'observed');
      let before = await read(timelineId); await byText(container + ' .aw-timeline-filters', 'Save view'); await wait('Actual source filters saved', async () => { document = await read(timelineId); return document.resource.version === before.resource.version + 1; });
      const filtered = await query(document), sourceItem = filtered.items.find(i => i.event.type === 'checklist.created' && i.event.resourceId === checklistId); assert(sourceItem, 'permitted_actual_source_in_saved_window');
      await click(`${container} .aw-timeline-items [data-event-id=${JSON.stringify(sourceItem.event.eventId)}][data-event-cursor=${JSON.stringify(String(sourceItem.event.cursor))}]>button`); await renderedSelection(document, sourceItem);
      before = await read(timelineId); await byText(container + ' .aw-timeline-filters', 'Save view'); await wait('Actual selected source saved on canonical Timeline ID', async () => { document = await read(timelineId); return document.resource.version === before.resource.version + 1 && document.view.selection?.eventId === sourceItem.event.eventId; });
      await readyDocument(document); await renderedSelection(document, sourceItem); await capture('02-selected-source-provenance'); await byText(container + ' .aw-timeline-selection', 'Open source');
      await wait('Actual canonical source opens without workspace or copy', () => js(`(()=>{const n=document.querySelector(${JSON.stringify(producerScope)}),e=n?.querySelector('[data-checklist-entry-id="'+CSS.escape(${JSON.stringify(entryId)})+'"]');return n&&!n.closest('[hidden],[inert]')&&e?.querySelector('[aria-label="Checklist item text"]')?.value===${JSON.stringify(FIXTURE.item)}&&e.querySelector('[aria-label="Check item manually"]')?.checked===true})()`));
      await close(); const value = await canonical(timelineId, checklistId, document.view.selection); await openTimeline(value.document); await readyDocument(value.document); await renderedSelection(value.document, value.source);
      assert.deepEqual(await read(timelineId), value.document, 'source_open_and_return_preserve_exact_saved_timeline_view'); receipt.canonical = value;
      pendingExpected = { contract: 'aerynth.timeline-checkpoint@1', source: sourceIdentity(source), moduleHashes: receipt.moduleHashes, timelineId, checklistId, canonical: value, initialReceipt: path.relative(root, path.join(out, 'journey.json')) };
    }
    await proof(); assert.equal(startupErrors.length, 0); assert.equal(receipt.errors.length, 0); slot.check(); passed = true;
  };
  try { await Promise.race([run(), aborted]); }
  catch (error) { receipt.error = { message: String(error.message).slice(0, 1200), ...(error.diagnostics ? { diagnostics: error.diagnostics } : {}) }; if (admitted && failureCapture && !slot.failure()) try { await failureCapture(); } catch {} }
  finally {
    clearTimeout(workTimer);
    try {
      if (!owned) { console.log(JSON.stringify({ passed: false, error: receipt.error?.message, cleanup: 'Unowned profile/window: no writes or control' })); return receipt; }
      try { assert.equal(await bounded(call('close', {}), Math.min(1500, slot?.remaining() ?? 1500), 'timeline_canonical_close_deadline'), null); receipt.nativeCloseConfirmed = true; } catch (error) { passed = false; receipt.nativeCloseError = String(error.message).slice(0, 1000); }
      receipt.elapsedMs = performance.now() - moduleStartedMonotonicMs; receipt.slotFailure = slot?.failure() ?? null; receipt.startupErrors = startupErrors.slice(0, 24); receipt.passed = passed && receipt.nativeCloseConfirmed === true && !receipt.slotFailure && !receipt.errors.length && !startupErrors.length;
      if (admitted) {
        if (receipt.passed && pendingExpected) await fs.writeFile(expectedFile, encode(pendingExpected), { flag: 'wx' }); if (budgetWritable) await fs.writeFile(budgetFile, encode(validateBudget(budget))); await fs.mkdir(out, { recursive: true }); const file = path.join(out, restore ? 'restore.json' : 'journey.json'); await fs.writeFile(file, encode(receipt), { flag: 'wx' });
        if (slot?.failure() || receipt.errors.length || startupErrors.length) { receipt.passed = false; receipt.slotFailure = slot?.failure() ?? null; await fs.writeFile(file, encode(receipt)); }
      }
      console.log(JSON.stringify({ passed: receipt.passed, restore, evidence: admitted ? out : null, error: receipt.error?.message, elapsedMs: receipt.elapsedMs }));
    } catch (error) { receipt.passed = false; console.log(JSON.stringify({ passed: false, error: String(error.message).slice(0, 1000) })); }
    finally { if (listenersInstalled) { win.removeListener('blur', blur); win.removeListener('hide', blur); win.removeListener('minimize', blur); win.webContents.removeListener('before-input-event', escape); win.webContents.removeListener('console-message', consoleError); } clearTimeout(hardTimer); if (owned) app.exit(receipt.passed ? 0 : 1); }
  }
  return receipt;
};
