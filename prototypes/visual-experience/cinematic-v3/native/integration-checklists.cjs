/* Actual combined-desktop manual Checklist journey; Main alone dispatches
 * --integration-checklists --profile=<C:absolute review-checklists-DIGITS>.
 * --verify-restore requires the SAME owned profile and source/assets.
 * 45s/12s including cleanup; <=3 PNG/16MiB combined, no video or provider.
 * Software native-window input is not physical OS input. Date input uses an
 * explicitly labelled DOM input event against the visible actual date field.
 * No seeding/mutation RPC, refocus, global hooks, account, auth or clipboard.
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { execFileSync } = require('node:child_process');
const { createSlot, targetScript, waitForCondition, sourceIdentity } = require('./integration-resource-opening.cjs');
const { validateBudget, admitPNG } = require('./integration-desktop-basics.cjs');
const { fillNative } = require('./integration-agents.cjs');
const MiB = 1024 * 1024;
const FIXTURE = Object.freeze({
  title: 'SYNTHETIC Manual next steps', linked: 'SYNTHETIC Conversation next steps',
  first: 'Inspect the synthetic source', edited: 'Review the synthetic source manually',
  second: 'Keep the original canonical identities', group: 'SYNTHETIC Review',
  description: 'SYNTHETIC manual checklist annotation; no model or task execution.', due: '2026-12-15',
});
const scope = id => `.aw-checklist[data-resource-id=${JSON.stringify(id)}]`;
const entryScope = (id, entryId) => `${scope(id)} [data-checklist-entry-id=${JSON.stringify(entryId)}]`;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function encode(value) { const text = JSON.stringify(value, null, 2); assert(Buffer.byteLength(text) <= MiB, 'checklists_receipt_capacity'); return text; }
function assertOwnedProfile(root, argv, title) {
  assert(argv.includes('--integration-checklists'), 'explicit_checklists_flag_required');
  assert(typeof root === 'string' && path.win32.isAbsolute(root) && path.win32.parse(root).root.toLowerCase() === 'c:\\' && /^review-checklists-\d+$/.test(path.win32.basename(root)), 'fresh_owned_checklists_profile_required');
  assert.match(title, /Automated check/i, 'owned_automated_window_required');
}
/** Main owns canonical SQLite/evidence at root and isolates Chromium beneath it. */
function assertOwnedApplicationProfile(root, userData, argv) {
  const canonical = path.win32.resolve(root);
  assert(typeof userData === 'string' && path.win32.isAbsolute(userData), 'absolute_owned_chromium_profile_required');
  assert.equal(path.win32.resolve(userData), path.win32.join(canonical, 'chromium'), 'actual_same_owned_application_profile_required');
  const explicit = argv.filter(value => value.startsWith('--profile='));
  if (explicit.length) {
    assert.equal(explicit.length, 1, 'single_explicit_profile_argument_required');
    const value = explicit[0].slice('--profile='.length);
    assert(path.win32.isAbsolute(value), 'absolute_explicit_profile_required');
    assert.equal(path.win32.resolve(value), canonical, 'same_explicit_canonical_profile_required');
  }
}
function assertRead(name, input) {
  assert(['checklists', 'desktop', 'snapshot', 'replay'].includes(name), 'checklists_readonly_rpc_required');
  if (name === 'checklists') assert(input?.name === 'read' && typeof input.input?.resourceId === 'string' && Object.keys(input.input).length === 1, 'checklists_ui_mutations_only');
  if (name === 'desktop') assert.equal(input?.type, 'snapshot');
}
function assertManual(attribution) {
  assert(attribution?.actor?.kind === 'user' && attribution.authority === 'manual' && Number.isFinite(Date.parse(attribution.at)), 'actual_manual_user_attribution_required');
}
function assertDocument(value) {
  assert(value?.schemaVersion === 1 && value.resource?.kind === 'checklist' && typeof value.resource.id === 'string' && value.resource.id && value.resource.projectId === null && Number.isSafeInteger(value.resource.version) && value.resource.version > 0 && value.canEdit === true && value.syncPolicy === 'manual', 'canonical_manual_checklist_identity_required');
  assertManual(value.created); assertManual(value.updated);
  assert(Array.isArray(value.groups) && value.groups.length <= 32 && Array.isArray(value.entries) && value.entries.length <= 256 && Array.isArray(value.references), 'bounded_checklist_projection_required');
  const ids = [...value.groups, ...value.entries, ...value.references, ...value.entries.flatMap(e => e.references)].map(v => v.id);
  assert(ids.every(id => typeof id === 'string' && id) && new Set(ids).size === ids.length, 'exact_unique_subordinate_ids_required');
  for (const entry of value.entries) {
    assertManual(entry.created); assertManual(entry.updated);
    if (entry.checked) { assertManual(entry.completion); assert.equal(entry.completion.basis, 'manual'); }
    else assert.equal(entry.completion, null);
  }
  return value;
}
function assertNoExecution(core, events, counters) {
  assert.equal(Object.keys(core.executions).length, 0, 'checklists_no_execution');
  assert.equal(Object.keys(core.handoffs).length, 0, 'checklists_no_handoff');
  assert(Object.values(core.bindings).every(value => value === null), 'no_native_provider_binding');
  assert.equal(core.graph.messages.length, 0, 'manual_checklists_must_not_send_or_fabricate_messages');
  assert(core.graph.conversations.length <= 1 && core.conversations.length <= 1, 'one_explicit_local_chat_only');
  assert(core.conversations.every(c => c.providerId === 'local'), 'actual_local_recording_provider_required');
  assert.equal(events.truncated, false, 'complete_event_coverage_required');
  assert(!events.events.some(e => (e.nativeSequence ?? null) !== null || e.threadId || e.turnId || /^(?:provider\/|execution\/|item\/|turn\/|thread\/)/.test(e.type)), 'provider_activity_event_forbidden');
  assert.equal(counters?.scope, 'process-session-native-attempts');
  for (const key of ['codexConnections', 'providerRequests', 'systemMemoryReads']) assert.equal(counters[key], 0, 'checklists_native_attempt_forbidden:' + key);
}
function assertNoPlacements(desktop) {
  for (const key of ['projects', 'workspaces', 'blocks']) assert.equal(desktop[key].length, 0, 'manual_checklists_do_not_create_' + key);
  assert.equal((desktop.archivedWorkspaces ?? []).length, 0, 'manual_checklists_do_not_create_archived_workspaces');
  assert.equal((desktop.navigationBlocks ?? []).length, 0);
  assert(desktop.resources.length <= 3 && desktop.resources.every(r => ['checklist', 'conversation'].includes(r.kind)) && desktop.resources.filter(r => r.kind === 'checklist').length <= 2 && desktop.resources.filter(r => r.kind === 'conversation').length <= 1, 'no_note_task_or_placeholder_resource');
}
function assertFinished(manual, linked, chatId) {
  assertDocument(manual); assertDocument(linked);
  assert.notEqual(manual.resource.id, linked.resource.id);
  assert.equal(manual.resource.title, FIXTURE.title); assert.equal(linked.resource.title, FIXTURE.linked);
  assert.deepEqual(manual.groups.map(g => g.title), [FIXTURE.group]);
  assert.equal(manual.entries.length, 2);
  const [first, second] = manual.entries;
  assert.equal(first.text, FIXTURE.edited); assert.equal(first.description, FIXTURE.description);
  assert.equal(first.checked, true); assert.equal(first.priority, 'high'); assert.equal(first.dueDate, FIXTURE.due); assert.equal(first.groupId, manual.groups[0].id);
  assert.equal(second.text, FIXTURE.second); assert.equal(second.checked, false); assert.equal(second.priority, 'normal'); assert.equal(second.dueDate, null); assert.equal(second.groupId, null);
  assert.equal(first.references.length, 0); assert.equal(second.references.length, 0);
  assert.equal(linked.entries.length, 0); assert.equal(linked.groups.length, 0);
  for (const document of [manual, linked]) {
    assert.equal(document.references.length, 1); const ref = document.references[0];
    assert.equal(ref.available, true); assert.equal(ref.kind, 'conversation'); assert.deepEqual(ref.target, { kind: 'conversation', resourceId: chatId });
  }
}
function passingCheckpoint(checkpoint, initial) {
  assert(checkpoint?.contract === 'aerynth.checklists-checkpoint@1' && initial?.contract === 'aerynth.checklists-integration@1' && initial.passed === true && initial.restore === false && initial.nativeCloseConfirmed === true, 'original_passing_checklists_receipt_required');
  assert.deepEqual(sourceIdentity(initial.source), checkpoint.source); assert.deepEqual(initial.moduleHashes, checkpoint.moduleHashes); assert.deepEqual(initial.canonical, checkpoint.canonical);
}
async function bounded(promise, ms, code) {
  assert(ms > 0, code); let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(code)), ms); })]); }
  finally { clearTimeout(timer); }
}
async function readJson(file) { assert((await fs.stat(file)).size <= MiB, 'bounded_checklists_checkpoint_required'); return JSON.parse(await fs.readFile(file, 'utf8')); }
Object.assign(exports, { assertOwnedProfile, assertOwnedApplicationProfile, assertRead, assertDocument, assertNoExecution, assertNoPlacements, assertFinished, passingCheckpoint, FIXTURE });

exports.verify = async function verify({ win, app, privateRoot, call, source, startupErrors = [], moduleStartedMonotonicMs, observeProviderActivity }) {
  const restore = process.argv.includes('--verify-restore'), limitMs = restore ? 12000 : 45000;
  const root = path.resolve(privateRoot), out = path.join(root, 'checklists-evidence', `${restore ? 'restore' : 'initial'}-${Date.now()}`);
  const expectedFile = path.join(root, 'checklists-expected.json'), budgetFile = path.join(root, 'checklists-capture-budget.json');
  const receipt = { contract: 'aerynth.checklists-integration@1', source, restore, passed: false, syntheticOnly: true,
    inputMethod: 'App-only software native-window mouse/key/insertText events; visible date field uses explicitly recorded DOM input. Every renderer evaluation is false. No OS/global hooks, seeding or mutation RPC, provider, account, auth or clipboard.',
    limits: { milliseconds: limitMs, combinedPNGs: 3, combinedPNGBytes: 16 * MiB, videos: 0 }, actions: [], captures: [], checks: [], errors: [],
    limitations: ['Manual completion is not agent/task/provider execution or verification.', 'Fresh GPU draw is not monitor-presentation, performance or artistic qualification.', 'Root must inspect native-window PNGs and independently confirm window/process/backend exit.', 'Cross-workspace placement is outside this bounded journey.'] };
  let owned = false, admitted = false, listenersInstalled = false, budgetWritable = false, passed = false, slot, expected, pendingExpected, workTimer, hardTimer, rejectAbort, failureCapture;
  let budget = { count: 0, bytes: 0, files: [] };
  const aborted = new Promise((_, reject) => { rejectAbort = reject; }); aborted.catch(() => {});
  const abort = code => rejectAbort(slot?.abort(code) ?? Error(code));
  const blur = () => abort('checklists_focus_lost');
  const escape = (_event, input) => { if (input?.type === 'keyDown' && input.key === 'Escape') abort('checklists_operator_escape'); };
  const consoleError = (_event, details) => { if ((details?.level === 'error' || details?.level === 3) && receipt.errors.length < 24) receipt.errors.push(String(details.message).slice(0, 1000)); };
  const run = async () => {
    assertOwnedProfile(privateRoot, process.argv, win.getTitle()); assertOwnedApplicationProfile(privateRoot, app.getPath('userData'), process.argv); sourceIdentity(source); owned = true;
    slot = createSlot({ win, startedAt: moduleStartedMonotonicMs, limitMs, cleanupMs: restore ? 2500 : 4000 }); slot.check();
    hardTimer = setTimeout(() => { receipt.hardDeadline = true; abort('checklists_hard_deadline'); app.exit(1); }, slot.remaining());
    workTimer = setTimeout(() => abort('checklists_work_deadline'), slot.workRemaining());
    listenersInstalled = true; win.on('blur', blur); win.on('hide', blur); win.on('minimize', blur);
    win.webContents.on('before-input-event', escape); win.webContents.on('console-message', consoleError);
    receipt.reserve = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.join(process.env.LOCALAPPDATA || '', 'AeroStorageWatch', 'ReserveGuard.ps1'), '-EstimatedCBytes', String(32 * MiB), '-EstimatedDBytes', '0'], { windowsHide: true, timeout: Math.floor(Math.min(4000, slot.workRemaining())), maxBuffer: 8192, encoding: 'utf8' }));
    assert.equal(receipt.reserve.allowed, true); admitted = true; slot.check(); await fs.mkdir(out, { recursive: true });
    receipt.moduleHashes = { helper: hash(await fs.readFile(__filename)) };
    const dependencies = ['application-contract/checklist.ts', ...['service.mts', 'model.ts', 'view.ts', 'view.css', 'creator.ts', 'creator.css'].map(name => 'checklist-product/' + name)];
    for (const relative of dependencies) receipt.moduleHashes[relative] = hash(await fs.readFile(path.resolve(__dirname, '../../..', relative)));
    for (const name of ['integration-agents.cjs', 'integration-resource-opening.cjs', 'integration-desktop-basics.cjs']) receipt.moduleHashes[name] = hash(await fs.readFile(path.join(__dirname, name)));
    for (const [name, digest] of Object.entries(source.buildAssets)) { assert.equal(path.basename(name), name); assert.equal(hash(await fs.readFile(path.join(__dirname, '../dist/assets', name))), digest, 'actual_build_asset_binding'); }
    if (restore) {
      expected = await readJson(expectedFile); assert.deepEqual(expected.source, sourceIdentity(source)); assert.deepEqual(expected.moduleHashes, receipt.moduleHashes);
      const prior = path.resolve(root, expected.initialReceipt), relative = path.relative(root, prior);
      assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'owned_passing_checklists_receipt_required');
      passingCheckpoint(expected, await readJson(prior)); budget = validateBudget(await readJson(budgetFile)); budgetWritable = true;
    } else { await assert.rejects(fs.stat(expectedFile), { code: 'ENOENT' }); await assert.rejects(fs.stat(budgetFile), { code: 'ENOENT' }); budgetWritable = true; }
    const js = async code => { slot.check(); const result = await bounded(win.webContents.executeJavaScript(code, false), slot.workRemaining(), 'checklists_renderer_deadline'); slot.check(); return result; };
    const rpc = async (name, input) => { assertRead(name, input); slot.check(); const result = await bounded(call(name, input), slot.workRemaining(), 'checklists_read_deadline'); slot.check(); return result; };
    const desktop = () => rpc('desktop', { type: 'snapshot' });
    const read = async id => { const value = assertDocument((await rpc('checklists', { name: 'read', input: { resourceId: id } })).result); assert.equal(value.resource.id, id); return value; };
    const wait = (label, check) => { receipt.phase = label; return waitForCondition({ slot, label, check, diagnose: () => js("({checklist:[...document.querySelectorAll('.aw-checklist')].map(n=>({id:n.dataset.resourceId,title:n.querySelector('h3')?.textContent,status:n.querySelector('[role=status]')?.textContent,entries:[...n.querySelectorAll('[data-checklist-entry-id]')].map(e=>e.dataset.checklistEntryId)})),creator:document.querySelector('.aw-checklist-create-status')?.textContent,manager:document.querySelector('.cp-status')?.textContent,surfaces:[...document.querySelectorAll('[data-surface-id]')].map(n=>n.dataset.surfaceId),error:document.querySelector('#command-error')?.textContent})") }); };
    const click = async query => {
      await js(`document.querySelector(${JSON.stringify(query)})?.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'})`);
      let previous, point;
      await wait('Visible stable actual Checklist control ' + query, async () => {
        const value = await js(targetScript(query, 'inspect'));
        if (!value.ready) { await js(`(()=>{const n=document.querySelector(${JSON.stringify(query)});if(!n||n.closest('[hidden],[inert]'))return;const r=n.getBoundingClientRect();let clipped=r.left<0||r.top<0||r.right>innerWidth||r.bottom>innerHeight;for(let p=n.parentElement;p&&!clipped;p=p.parentElement){const s=getComputedStyle(p),b=p.getBoundingClientRect();clipped=(s.overflowX!=='visible'&&(r.left<b.left||r.right>b.right))||(s.overflowY!=='visible'&&(r.top<b.top||r.bottom>b.bottom));}if(clipped)n.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});})()`); previous = undefined; return false; }
        point = { x: Math.round(value.rect.x + value.rect.width / 2), y: Math.round(value.rect.y + value.rect.height / 2) };
        const stable = previous && Math.abs(point.x - previous.x) < 1 && Math.abs(point.y - previous.y) < 1; previous = point; return stable;
      });
      receipt.actions.push({ method: 'software-native-window-mouse', selector: query });
      for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) { slot.check(); win.webContents.sendInputEvent({ type, ...point, button: 'left', clickCount: 1 }); }
    };
    const key = (keyCode, modifiers = []) => { for (const type of ['keyDown', 'keyUp']) { slot.check(); win.webContents.sendInputEvent({ type, keyCode, modifiers }); } };
    const fill = async (query, text) => { await fillNative({ click, key, js, wait, insertText: text => bounded(win.webContents.insertText(text), slot.workRemaining(), 'checklists_text_input_deadline') }, query, text); receipt.actions.push({ method: 'software-native-window-insertText', selector: query, characters: text.length }); };
    const select = async (query, value) => {
      const index = await js(`(()=>{const n=document.querySelector(${JSON.stringify(query)});return n?[...n.options].findIndex(o=>o.value===${JSON.stringify(value)}&&!o.disabled):-1})()`); assert(index >= 0 && index <= 32, 'actual_bounded_checklist_option_required');
      await click(query); await wait('Actual native select focus', () => js(`document.activeElement===document.querySelector(${JSON.stringify(query)})`)); key('Home'); for (let i = 0; i < index; i++) key('Down'); key('Return');
      await wait('Exact actual native option value', () => js(`document.querySelector(${JSON.stringify(query)})?.value===${JSON.stringify(value)}`));
    };
    const byText = async (container, text, tag = 'button') => {
      let index; await wait('Exact public control ' + text, async () => { index = await js(`(()=>{const n=document.querySelector(${JSON.stringify(container)});return n?[...n.querySelectorAll(${JSON.stringify(tag)})].findIndex(b=>b.textContent.trim()===${JSON.stringify(text)}):-1})()`); return index >= 0; });
      // The index comes from the current actual DOM, not a manufactured test ID.
      const query = await js(`(()=>{const n=document.querySelector(${JSON.stringify(container)})?.querySelectorAll(${JSON.stringify(tag)})[${index}];if(!n)return null;let p=n,parts=[];while(p&&p!==document.documentElement){parts.unshift(p.tagName.toLowerCase()+':nth-child('+([...p.parentElement.children].indexOf(p)+1)+')');p=p.parentElement;}return 'html>'+parts.join('>')})()`); assert(query); await click(query);
    };
    const close = async surfaceId => { const query = `[data-surface-id=${JSON.stringify(surfaceId)}]`; await click(query + ' .aw-contextual-dismiss'); await wait('Actual surface closed ' + surfaceId, () => js(`!document.querySelector(${JSON.stringify(query)})`)); };
    const openChecklist = async id => {
      await click('#application-resources'); await fill('#resource-search', id === expected?.linkedId ? FIXTURE.linked : FIXTURE.title);
      await click(`#resource-results [data-open-resource=${JSON.stringify(id)}]`);
      await wait('Exact actual direct canonical Checklist', () => js(`(()=>{const n=document.querySelector(${JSON.stringify(scope(id))});return n&&!n.closest('[hidden],[inert]')&&n.querySelector('h3')?.textContent===${JSON.stringify(id === expected?.linkedId ? FIXTURE.linked : FIXTURE.title)}})()`));
      await wait('Actual Checklist input ready', async () => (await js(targetScript(scope(id) + ' input[aria-label="New checklist item"]', 'inspect'))).ready);
    };
    const proof = async () => {
      const core = await rpc('snapshot', {}), d = await desktop(), events = await rpc('replay', { after: 0 }); assert.equal(typeof observeProviderActivity, 'function', 'actual_provider_observer_required');
      const counters = await bounded(observeProviderActivity(), slot.workRemaining(), 'checklists_observer_deadline'); assertNoExecution(core, events, counters); assertNoPlacements(d);
      return { graph: core.graph, resourceMap: core.resourceMap, conversations: core.conversations.map(c => ({ resourceId: c.resourceId, graphId: core.resourceMap[c.resourceId], providerId: c.providerId, revision: c.revision })), projects: d.projects, workspaces: d.workspaces, blocks: d.blocks, resources: d.resources.map(r => ({ id: r.id, kind: r.kind, title: r.title, projectId: r.project_id, version: r.version })).sort((a, b) => a.id.localeCompare(b.id)), relationships: d.relationships, counters };
    };
    const capture = async name => {
      const sample = () => js("(()=>{const s=window.__aerynth.snapshot();return{frames:s.gpu?.framesRendered,draws:s.metrics.draws,active:s.active,lost:s.gpu?.contextLost,failed:s.graphicsFailed,errors:s.metrics.errors}})()");
      const before = await sample(); await wait('Focused new actual GPU draw', async () => { const next = await sample(); return next.active === true && next.failed === false && next.lost === false && next.errors.length === 0 && next.frames > before.frames && next.draws > before.draws; });
      const png = (await bounded(win.webContents.capturePage(), slot.workRemaining(), 'checklists_capture_deadline')).toPNG(); slot.check();
      const file = path.join(out, name + '.png'), item = admitPNG(budget, png, file); await fs.writeFile(file, png, { flag: 'wx' }); receipt.captures.push({ ...item, focused: true, before, after: await sample() });
    }; failureCapture = () => capture('failure');
    const canonical = async (manualId, linkedId, chatId) => {
      const manual = await read(manualId), linked = await read(linkedId); assertFinished(manual, linked, chatId); const state = await proof();
      assert.deepEqual(state.resources.map(r => r.id).sort(), [manualId, linkedId, chatId].sort(), 'exact_two_checklists_one_local_chat_resources');
      assert.deepEqual(Object.keys(state.resourceMap), [chatId]); assert.equal(state.graph.conversations.length, 1); assert.equal(state.graph.conversations[0].id, state.resourceMap[chatId]);
      return { manual, linked, chatId, desktop: state };
    };
    const rendered = async document => {
      const id = document.resource.id; await wait('Exact rendered Checklist entries and saved metadata', () => js(`(()=>{const n=document.querySelector(${JSON.stringify(scope(id))});return n?.querySelectorAll('[data-checklist-entry-id]').length===${document.entries.length}&&${JSON.stringify(document.entries.map(e => ({ id: e.id, text: e.text, checked: e.checked, description: e.description, priority: e.priority, due: e.dueDate ?? '', group: e.groupId ?? '' })))}.every(e=>{const r=n.querySelector('[data-checklist-entry-id="'+CSS.escape(e.id)+'"]');return r?.querySelector('[aria-label="Checklist item text"]')?.value===e.text&&r.querySelector('[aria-label="Check item manually"]')?.checked===e.checked&&r.querySelector('textarea')?.value===e.description&&r.querySelector('label:nth-of-type(2) select')?.value===e.priority&&r.querySelector('input[type=date]')?.value===e.due&&r.querySelector('label:nth-of-type(4) select')?.value===e.group})&&n.querySelectorAll('.aw-checklist-sources .aw-checklist-reference').length===${document.references.length}})()`));
    };
    await wait('Combined app ready', () => js("document.body.dataset.applicationHydrated==='true'"));
    receipt.startingCanonical = await proof();
    if (restore) {
      const value = await canonical(expected.manualId, expected.linkedId, expected.chatId); assert.deepEqual(value, expected.canonical, 'same_source_exact_checklist_identity_content_attribution_restart');
      await openChecklist(expected.manualId); await rendered(value.manual); await close('canonical-resource'); await openChecklist(expected.linkedId); await rendered(value.linked); await capture('03-checklists-restart'); receipt.canonical = value;
    } else {
      assert.equal(receipt.startingCanonical.resources.length, 0, 'fresh_empty_resources_required');
      await click('#application-resources'); await click('.aw-context-create > summary'); await click('#standalone-checklist');
      await fill('.aw-checklist-creator input[aria-label="Checklist title"]', FIXTURE.title); await byText('.aw-checklist-creator', 'Create checklist');
      let manualId; await wait('One canonical Checklist created through UI', async () => { const all = (await desktop()).resources; const r = all.find(r => r.kind === 'checklist' && r.title === FIXTURE.title); if (r) manualId = r.id; return !!r; });
      const add = async text => { const before = await read(manualId); await fill(scope(manualId) + ' input[aria-label="New checklist item"]', text); await byText(scope(manualId) + ' .aw-checklist-add', 'Add item'); let document; await wait('Exact manual item saved', async () => { document = await read(manualId); return document.entries.length === before.entries.length + 1 && document.entries.at(-1).text === text; }); assert.equal(document.resource.version, before.resource.version + 1); return document; };
      await add(FIXTURE.first); let manual = await add(FIXTURE.second); const entryIds = manual.entries.map(e => e.id);
      await byText(scope(manualId) + ' .aw-checklist-tools', 'Groups'); await fill(scope(manualId) + ' input[aria-label="New checklist group"]', FIXTURE.group); await byText(scope(manualId) + ' .aw-checklist-groups', 'Add group');
      await wait('Canonical group created through UI', async () => { manual = await read(manualId); return manual.groups.length === 1 && manual.groups[0].title === FIXTURE.group; });
      const row = entryScope(manualId, entryIds[0]); await byText(row, 'Details');
      await fill(row + ' input[aria-label="Checklist item text"]', FIXTURE.edited); await fill(row + ' textarea', FIXTURE.description);
      await select(row + ' label:nth-of-type(2) select', 'high');
      await wait('Visible actual date field', async () => (await js(targetScript(row + ' input[type="date"]', 'inspect'))).ready);
      const date = await js(targetScript(row + ' input[type="date"]', 'input', FIXTURE.due)); assert.equal(date.ready, true); receipt.actions.push({ method: 'renderer-DOM-input', selector: row + ' input[type="date"]', reason: 'Native segmented date input uses exact ISO value on the actual visible field; no activation or click is fabricated.' });
      await wait('Exact date input value', () => js(`document.querySelector(${JSON.stringify(row + ' input[type="date"]')})?.value===${JSON.stringify(FIXTURE.due)}`));
      await select(row + ' label:nth-of-type(4) select', manual.groups[0].id); await byText(row, 'Save changes');
      await wait('Exact entry edit saved on same canonical ID', async () => { manual = await read(manualId); const e = manual.entries[0]; return e.id === entryIds[0] && e.text === FIXTURE.edited && e.description === FIXTURE.description && e.priority === 'high' && e.dueDate === FIXTURE.due && e.groupId === manual.groups[0].id; });
      await click(row + ' input[aria-label="Check item manually"]'); await wait('Actual manual completion attribution', async () => { manual = await read(manualId); return manual.entries[0].checked === true; }); assert.deepEqual(manual.entries.map(e => e.id), entryIds); assertManual(manual.entries[0].completion); await rendered(manual); await capture('01-manual-checklist'); await close('canonical-resource');
      await click('#application-new-chat'); let chatId, chatTitle;
      await wait('Actual new empty local recording chat', async () => { const core = await rpc('snapshot', {}); if (core.conversations.length !== 1) return false; const chat = core.conversations[0]; assert.equal(chat.providerId, 'local'); chatId = chat.resourceId; chatTitle = (await desktop()).resources.find(r => r.id === chatId)?.title; return !!chatTitle; });
      await wait('Canonical chat selected in manager', () => js(`document.querySelector('.cp-manager')?.dataset.resourceId===${JSON.stringify(chatId)}`));
      await byText('.cp-chat-options', 'Chat options', 'summary'); await byText('.cp-chat-options', 'Create linked checklist');
      await fill('.aw-checklist-creator input[aria-label="Checklist title"]', FIXTURE.linked); await byText('.aw-checklist-creator', 'Create checklist');
      let linkedId; await wait('Linked Checklist created with actual conversation resource reference', async () => { const r = (await desktop()).resources.find(r => r.kind === 'checklist' && r.title === FIXTURE.linked); if (!r) return false; linkedId = r.id; const d = await read(linkedId); return d.references.some(ref => ref.available && ref.target?.kind === 'conversation' && ref.target.resourceId === chatId); });
      await rendered(await read(linkedId)); await close('canonical-resource');
      // A real conversation now exists to choose; no synthetic source or seed.
      await openChecklist(manualId); await byText(scope(manualId) + ' .aw-checklist-tools', 'Link source');
      await fill('.application-source-choice input[aria-label="Find a checklist source"]', chatTitle); await byText('.application-source-choice', chatTitle);
      await wait('Actual selected canonical source reference saved', async () => { manual = await read(manualId); return manual.references.length === 1 && manual.references[0].target?.resourceId === chatId; });
      const value = await canonical(manualId, linkedId, chatId); assert.deepEqual(value.manual.entries.map(e => e.id), entryIds); receipt.canonical = value; receipt.manualId = manualId; receipt.linkedId = linkedId; receipt.chatId = chatId;
      await close('canonical-resource'); expected = { linkedId }; await openChecklist(linkedId); await rendered(value.linked); await capture('02-conversation-linked-checklist');
      pendingExpected = { contract: 'aerynth.checklists-checkpoint@1', source: sourceIdentity(source), moduleHashes: receipt.moduleHashes, manualId, linkedId, chatId, canonical: value, initialReceipt: path.relative(root, path.join(out, 'journey.json')) };
    }
    await proof(); assert.equal(startupErrors.length, 0); assert.equal(receipt.errors.length, 0); slot.check(); passed = true;
  };
  try { await Promise.race([run(), aborted]); }
  catch (error) { receipt.error = { message: String(error.message).slice(0, 1200), ...(error.diagnostics ? { diagnostics: error.diagnostics } : {}) }; if (admitted && failureCapture && !slot.failure()) try { await failureCapture(); } catch {} }
  finally {
    clearTimeout(workTimer);
    try {
      if (!owned) { console.log(JSON.stringify({ passed: false, error: receipt.error?.message, cleanup: 'Unowned profile/window: no writes or control' })); return receipt; }
      try { assert.equal(await bounded(call('close', {}), Math.min(1500, slot?.remaining() ?? 1500), 'checklists_canonical_close_deadline'), null); receipt.nativeCloseConfirmed = true; }
      catch (error) { passed = false; receipt.nativeCloseError = String(error.message).slice(0, 1000); }
      receipt.elapsedMs = performance.now() - moduleStartedMonotonicMs; receipt.slotFailure = slot?.failure() ?? null; receipt.startupErrors = startupErrors.slice(0, 24);
      receipt.passed = passed && receipt.nativeCloseConfirmed === true && !receipt.slotFailure && !receipt.errors.length && !startupErrors.length;
      if (admitted) {
        if (receipt.passed && pendingExpected) await fs.writeFile(expectedFile, encode(pendingExpected), { flag: 'wx' });
        if (budgetWritable) await fs.writeFile(budgetFile, encode(validateBudget(budget)));
        await fs.mkdir(out, { recursive: true }); const file = path.join(out, restore ? 'restore.json' : 'journey.json'); await fs.writeFile(file, encode(receipt), { flag: 'wx' });
        if (slot?.failure() || receipt.errors.length || startupErrors.length) { receipt.passed = false; receipt.slotFailure = slot?.failure() ?? null; await fs.writeFile(file, encode(receipt)); }
      }
      console.log(JSON.stringify({ passed: receipt.passed, restore, evidence: admitted ? out : null, error: receipt.error?.message, elapsedMs: receipt.elapsedMs }));
    } catch (error) { receipt.passed = false; console.log(JSON.stringify({ passed: false, error: String(error.message).slice(0, 1000) })); }
    finally { if (listenersInstalled) { win.removeListener('blur', blur); win.removeListener('hide', blur); win.removeListener('minimize', blur); win.webContents.removeListener('before-input-event', escape); win.webContents.removeListener('console-message', consoleError); } clearTimeout(hardTimer); if (owned) app.exit(receipt.passed ? 0 : 1); }
  }
  return receipt;
};
