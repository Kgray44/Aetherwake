/* Actual combined-desktop Task Objective acceptance, Main-dispatched only.
 * --integration-task-objectives --profile=<C:absolute review-task-objectives-DIGITS>
 * 45s initial/12s restart include cleanup; <=3 PNG/16MiB combined, no video.
 * Software app-window input, never physical OS input or a model result. */
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
const FIXTURE = Object.freeze({ title: 'SYNTHETIC Reviewed task objective', objective: 'Manually inspect the synthetic source and record an accountable review.', criterion: 'The synthetic source checklist retains its canonical item.', checklist: 'SYNTHETIC Task evidence checklist', item: 'Inspect the retained synthetic source manually', review: 'SYNTHETIC manual review of the retained checklist. No agent or provider execution was performed.' });
const CAPABILITIES = Object.freeze({ execution: 'reference-only', startsExecution: false, interruptsExecution: false, automaticVerification: false, automaticAcceptance: false });
const scope = id => `.aw-task-tracker[data-resource-id=${JSON.stringify(id)}]`;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function encode(value) { const json = JSON.stringify(value, null, 2); assert(Buffer.byteLength(json) <= MiB, 'task_objectives_receipt_capacity'); return json; }
function assertOwnedProfile(root, argv, title, userData) {
  assert(argv.includes('--integration-task-objectives'), 'explicit_task_objectives_flag_required');
  assert(typeof root === 'string' && path.win32.isAbsolute(root) && path.win32.parse(root).root.toLowerCase() === 'c:\\' && /^review-task-objectives-\d+$/.test(path.win32.basename(root)), 'fresh_owned_task_objectives_profile_required');
  assert.equal(argv.filter(value => value.startsWith('--profile=')).length, 1, 'single_explicit_task_profile_required');
  assert.match(title, /Automated check/i, 'owned_automated_window_required'); assertOwnedApplicationProfile(root, userData, argv);
}
function assertRead(name, input) {
  assert(['taskObjectives', 'checklists', 'desktop', 'snapshot', 'replay'].includes(name), 'task_objectives_readonly_rpc_required');
  const fields = (v, required, optional = []) => v && typeof v === 'object' && !Array.isArray(v) && required.every(k => Object.hasOwn(v, k)) && Reflect.ownKeys(v).every(k => required.includes(k) || optional.includes(k));
  const id = v => typeof v === 'string' && v.length > 0 && v.length <= 512 && v.trim() === v && !/[\x00-\x1f]/.test(v);
  if (name === 'taskObjectives' || name === 'checklists') {
    assert(fields(input, ['name', 'input']), 'exact_task_read_envelope_required');
    if (name === 'checklists' || input.name === 'read') assert(input.name === 'read' && fields(input.input, ['resourceId']) && id(input.input.resourceId), 'exact_resource_read_required');
    else if (input.name === 'history') assert(fields(input.input, ['resourceId'], ['afterVersion', 'limit']) && id(input.input.resourceId) && (input.input.afterVersion === undefined || Number.isSafeInteger(input.input.afterVersion) && input.input.afterVersion >= 0) && (input.input.limit === undefined || Number.isSafeInteger(input.input.limit) && input.input.limit >= 1 && input.input.limit <= 64), 'bounded_task_history_required');
    else if (input.name === 'list') assert(fields(input.input, [], ['projectId', 'limit']) && (input.input.projectId === undefined || input.input.projectId === null || id(input.input.projectId)) && (input.input.limit === undefined || Number.isSafeInteger(input.input.limit) && input.input.limit >= 1 && input.input.limit <= 128), 'bounded_task_list_required');
    else assert.fail('task_objectives_ui_mutations_only');
  }
  if (name === 'desktop') assert(fields(input, ['type']) && input.type === 'snapshot', 'desktop_snapshot_only');
  if (name === 'snapshot') assert(fields(input, []), 'exact_snapshot_read_required');
  if (name === 'replay') assert(fields(input, ['after']) && Number.isSafeInteger(input.after) && input.after >= 0, 'exact_replay_read_required');
}
function assertManual(value) {
  assert(value?.actor?.actorKind === 'user' && value.actor.authority === 'manual' && value.actor.principalId && value.actor.policyVersion && typeof value.authorizationRef === 'string' && value.authorizationRef && Number.isFinite(Date.parse(value.at)), 'actual_manual_task_provenance_required');
}
function assertTask(value) {
  assert(value?.contract === 'aerynth.task-objective@1' && value.resource?.kind === 'task_objective' && typeof value.resource.id === 'string' && value.resource.id && value.resource.state === 'active' && value.resource.projectId === null && Number.isSafeInteger(value.resource.version) && value.resource.version > 0 && value.canEdit === true, 'actual_canonical_task_objective_required');
  assert(value.proofCoverage === 'complete' && Number.isSafeInteger(value.definitionVersion) && value.definitionVersion > 0 && /^[a-f0-9]{64}$/.test(value.definitionDigest) && value.lastMutationVersion === value.resource.version, 'exact_task_definition_version_required');
  assert.deepEqual(value.capabilities, CAPABILITIES); assert.equal(value.definition.objective, FIXTURE.objective);
  assert.equal(value.definition.requirements.length, 1); assert.equal(value.definition.requirements[0].text, FIXTURE.criterion); assert(value.definition.requirements[0].id);
  assert.equal(value.assignees.length, 0); assert.equal(value.dependencies.length, 0); assert.equal(value.attempts.length, 0, 'manual_fixture_must_not_link_or_invent_execution');
  for (const review of value.reviews) { assertManual(review.provenance); assert.equal(review.attemptId, null); assert.equal(review.execution, null); }
  if (value.acceptance.record) assertManual(value.acceptance.record.provenance); return value;
}
function assertAccepted(value, checklistId) {
  assertTask(value); assert.equal(value.disposition, 'accepted'); assert.equal(value.verification, 'verified'); assert.equal(value.acceptance.state, 'valid');
  assert.equal(value.definitionVersion, 2); assert.equal(value.resource.version, 4); assert.equal(value.sources.length, 1);
  const source = value.sources[0]; assert.equal(source.freshness, 'current'); assert.equal(source.reference.resourceId, checklistId); assert.equal(typeof source.reference.revision, 'string'); assert(source.reference.revision); assert.equal(source.reference.messageId, undefined); assert.deepEqual(source.reference, source.current);
  assert.equal(value.reviews.length, 1); const review = value.reviews[0]; assert.equal(review.decision, 'verified'); assert.equal(review.freshness, 'current'); assert.equal(review.note, FIXTURE.review); assert.equal(review.definitionVersion, value.definitionVersion); assert.equal(review.definitionDigest, value.definitionDigest);
  assert.deepEqual(review.requirementIds, value.definition.requirements.map(item => item.id)); assert.equal(review.evidence.length, 1); assert.equal(review.evidence[0].freshness, 'current'); assert.deepEqual(review.evidence[0].reference, source.reference); assert.deepEqual(review.evidence[0].current, source.current);
  assert.deepEqual(value.acceptance.record.reviewIds, [review.id]); assert.equal(value.acceptance.record.definitionVersion, value.definitionVersion); assert.equal(value.acceptance.record.definitionDigest, value.definitionDigest); assert.notEqual(value.acceptance.record.id, review.id); return value;
}
function assertHistory(history, document) {
  assert.equal(history?.resourceId, document.resource.id); assert.equal(history.currentResourceVersion, document.resource.version); assert.equal(history.coverage, 'complete'); assert.equal(history.nextAfterVersion, null);
  assert.deepEqual(history.items.map(item => item.operation), ['create', 'replaceDefinition', 'review', 'accept']); assert.deepEqual(history.items.map(item => item.version), [1, 2, 3, 4]);
  for (const item of history.items) { assertManual(item.provenance); assert.equal(item.snapshot.attempts.length, 0); assert.deepEqual(item.snapshot.capabilities, CAPABILITIES); }
  assert.equal(history.items[0].snapshot.verification, 'unreviewed'); assert.equal(history.items[0].snapshot.acceptance.state, 'not-accepted');
  assert.equal(history.items[2].snapshot.verification, 'verified'); assert.equal(history.items[2].snapshot.acceptance.state, 'not-accepted'); assert.equal(history.items[3].snapshot.acceptance.state, 'valid'); return history;
}
function assertNoExecution(core, replay, counters, desktop) {
  for (const key of ['executions', 'bindings', 'handoffs', 'resourceMap']) assert.equal(Object.keys(core[key]).length, 0, 'task_objectives_no_provider_or_chat:' + key);
  assert.equal(core.graph.messages.length, 0); assert.equal(core.graph.conversations.length, 0); assert.equal(core.conversations.length, 0);
  assert.equal(replay.truncated, false); assert(!replay.events.some(event => (event.nativeSequence ?? null) !== null || event.threadId || event.turnId || /^(?:provider\/|execution\/|item\/|turn\/|thread\/)/.test(event.type)), 'task_objectives_no_provider_events');
  assert.equal(counters?.scope, 'process-session-native-attempts'); for (const key of ['codexConnections', 'providerRequests', 'systemMemoryReads']) assert.equal(counters[key], 0, 'task_objectives_no_native_attempt:' + key);
  for (const key of ['projects', 'workspaces', 'blocks']) assert.equal(desktop[key].length, 0); assert.equal((desktop.archivedWorkspaces ?? []).length, 0); assert.equal((desktop.navigationBlocks ?? []).length, 0);
  assert(desktop.resources.length <= 2 && desktop.resources.every(r => ['task_objective', 'checklist'].includes(r.kind)) && desktop.resources.filter(r => r.kind === 'task_objective').length <= 1 && desktop.resources.filter(r => r.kind === 'checklist').length <= 1, 'no_note_task_or_placeholder_substitution');
}
function passingCheckpoint(checkpoint, initial) {
  assert(checkpoint?.contract === 'aerynth.task-objectives-checkpoint@1' && initial?.contract === 'aerynth.task-objectives-integration@1' && initial.passed === true && initial.restore === false && initial.nativeCloseConfirmed === true, 'original_passing_task_objectives_receipt_required');
  assert.deepEqual(sourceIdentity(initial.source), checkpoint.source); assert.deepEqual(initial.moduleHashes, checkpoint.moduleHashes); assert.deepEqual(initial.canonical, checkpoint.canonical);
}
/** Screenshots require a fully revealed actual owning Task surface. No focus,
 * mutation, timer, motion override or application-content read in this script. */
function taskCaptureScript(resourceId) {
  assert(typeof resourceId === 'string' && resourceId && resourceId.length <= 512, 'task_capture_identity_required');
  return `(${function (id) {
    const missing = { ready: false, resourceId: id }, nodes = document.querySelectorAll('[data-surface-id="canonical-resource"]'); if (nodes.length !== 1) return missing;
    const surface = nodes[0], viewer = surface.querySelector('.aw-task-tracker[data-resource-id=' + JSON.stringify(id) + ']'), owner = viewer?.closest('.application-direct-resource');
    if (!viewer || !owner || viewer.dataset.resourceId !== id || owner.dataset.resourceId !== id || viewer.closest('[data-surface-id]') !== surface || !viewer.isConnected || !owner.isConnected || !surface.isConnected || viewer.closest('[hidden],[inert],[aria-hidden="true"]')) return missing;
    let opacity = 1; for (let p = viewer; p; p = p.parentElement) { const s = getComputedStyle(p), a = Number(s.opacity); if (p.hidden || p.inert || s.display === 'none' || ['hidden', 'collapse'].includes(s.visibility) || !Number.isFinite(a) || a < 0 || a > 1) return missing; opacity *= a; }
    const r = surface.getBoundingClientRect(), v = viewer.getBoundingClientRect(), rect = { x: r.x, y: r.y, width: r.width, height: r.height }, viewport = { width: innerWidth, height: innerHeight };
    const contained = [...Object.values(rect), ...Object.values(viewport), v.x, v.y, v.width, v.height].every(Number.isFinite) && r.width > 0 && r.height > 0 && r.x >= 0 && r.y >= 0 && r.x + r.width <= innerWidth && r.y + r.height <= innerHeight;
    const hit = contained ? document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) : null;
    return { ready: contained && v.width > 0 && v.height > 0 && Math.max(r.x, v.x) < Math.min(r.x + r.width, v.x + v.width) && Math.max(r.y, v.y) < Math.min(r.y + r.height, v.y + v.height) && !!hit && surface.contains(hit) && opacity >= .98, resourceId: id, ownerId: owner.dataset.resourceId, taskId: viewer.dataset.resourceId, opacity, rect, viewport };
  }.toString()})(${JSON.stringify(resourceId)})`;
}
function taskCaptureReady(a, id, b) {
  const valid = v => v?.ready === true && v.resourceId === id && v.ownerId === id && v.taskId === id && Number.isFinite(v.opacity) && v.opacity >= .98 && v.opacity <= 1 && v.rect && v.viewport && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(v.rect[k])) && ['width', 'height'].every(k => Number.isFinite(v.viewport[k]) && v.viewport[k] > 0) && v.rect.x >= 0 && v.rect.y >= 0 && v.rect.width > 0 && v.rect.height > 0 && v.rect.x + v.rect.width <= v.viewport.width && v.rect.y + v.rect.height <= v.viewport.height;
  return !!(valid(a) && valid(b) && ['x', 'y', 'width', 'height'].every(k => Math.abs(a.rect[k] - b.rect[k]) <= .5) && ['width', 'height'].every(k => a.viewport[k] === b.viewport[k]));
}
async function captureTask({ slot, resourceId, observe, wait, freshDraw, capture }) {
  let previous; const revealed = await wait('Fully revealed stable owning Task surface', async () => { slot.check(); const current = await observe(); slot.check(); const ready = taskCaptureReady(current, resourceId, previous); previous = current; return ready ? current : false; });
  await freshDraw(); slot.check(); const before = await observe(); slot.check(); assert(taskCaptureReady(before, resourceId, revealed), 'task_capture_retargeted_or_dim');
  const png = await capture(); slot.check(); const after = await observe(); slot.check(); assert(taskCaptureReady(after, resourceId, before), 'task_capture_retargeted_or_dim'); return { png, before, after };
}
async function bounded(promise, ms, code) { assert(ms > 0, code); let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(code)), ms); })]); } finally { clearTimeout(timer); } }
async function readJson(file) { assert((await fs.stat(file)).size <= MiB, 'bounded_task_checkpoint_required'); return JSON.parse(await fs.readFile(file, 'utf8')); }
Object.assign(exports, { FIXTURE, CAPABILITIES, assertOwnedProfile, assertRead, assertManual, assertTask, assertAccepted, assertHistory, assertNoExecution, passingCheckpoint, taskCaptureScript, taskCaptureReady, captureTask });

exports.verify = async function verify({ win, app, privateRoot, call, source, startupErrors = [], moduleStartedMonotonicMs, observeProviderActivity }) {
  const restore = process.argv.includes('--verify-restore'), limitMs = restore ? 12000 : 45000, root = path.resolve(privateRoot), out = path.join(root, 'task-objectives-evidence', `${restore ? 'restore' : 'initial'}-${Date.now()}`);
  const expectedFile = path.join(root, 'task-objectives-expected.json'), budgetFile = path.join(root, 'task-objectives-capture-budget.json');
  const receipt = { contract: 'aerynth.task-objectives-integration@1', source, restore, passed: false, syntheticOnly: true, inputMethod: 'Software native-window mouse/key/insertText through actual App UI. Every renderer evaluation false; no mutation RPC, refocus, OS input/global hooks, clipboard, provider, auth or copied profile.', limits: { milliseconds: limitMs, combinedPNGs: 3, combinedPNGBytes: 16 * MiB, videos: 0 }, actions: [], checks: [], captures: [], errors: [], limitations: ['Manual synthetic review/acceptance are accountable decisions, not agent execution or independent correctness verification.', 'Fresh empty profile contains no legacy Note-backed Task; this journey does not establish native legacy migration/nonconversion.', 'Workspace attachment/detachment is not exercised by this bounded placement-free journey.', 'A fresh GPU draw and native screenshot are not monitor-performance or artistic acceptance; Root must examine actual captures and confirm process cleanup.'] };
  let owned = false, admitted = false, listenersInstalled = false, budgetWritable = false, passed = false, slot, expected, pendingExpected, lastTaskId, workTimer, hardTimer, rejectAbort, failureCapture;
  let budget = { count: 0, bytes: 0, files: [] };
  const aborted = new Promise((_, reject) => { rejectAbort = reject; }); aborted.catch(() => {});
  const abort = code => rejectAbort(slot?.abort(code) ?? Error(code)), blur = () => abort('task_objectives_focus_lost');
  const escape = (_event, input) => { if (input?.type === 'keyDown' && input.key === 'Escape') abort('task_objectives_operator_escape'); };
  const consoleError = (_event, details) => { if ((details?.level === 'error' || details?.level === 3) && receipt.errors.length < 24) receipt.errors.push(String(details.message).slice(0, 1000)); };
  const run = async () => {
    assertOwnedProfile(privateRoot, process.argv, win.getTitle(), app.getPath('userData')); sourceIdentity(source); owned = true;
    slot = createSlot({ win, startedAt: moduleStartedMonotonicMs, limitMs, cleanupMs: restore ? 2500 : 4000 }); slot.check();
    hardTimer = setTimeout(() => { receipt.hardDeadline = true; abort('task_objectives_hard_deadline'); app.exit(1); }, slot.remaining()); workTimer = setTimeout(() => abort('task_objectives_work_deadline'), slot.workRemaining());
    listenersInstalled = true; win.on('blur', blur); win.on('hide', blur); win.on('minimize', blur); win.webContents.on('before-input-event', escape); win.webContents.on('console-message', consoleError);
    receipt.reserve = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.join(process.env.LOCALAPPDATA || '', 'AeroStorageWatch', 'ReserveGuard.ps1'), '-EstimatedCBytes', String(32 * MiB), '-EstimatedDBytes', '0'], { windowsHide: true, timeout: Math.floor(Math.min(4000, slot.workRemaining())), maxBuffer: 8192, encoding: 'utf8' })); assert.equal(receipt.reserve.allowed, true); admitted = true; slot.check(); await fs.mkdir(out, { recursive: true });
    receipt.moduleHashes = { helper: hash(await fs.readFile(__filename)) };
    for (const relative of ['task-product/contracts.ts', 'task-product/service.mts', 'integrated-backend/src/task-objectives.mts', 'block-library/task-tracker-view.ts', 'block-library/task-tracker-view.css', 'block-library/task-objective-creator.ts', 'block-library/task-objective-creator.css', 'block-library/direct-resource-view.ts', 'checklist-product/service.mts', 'checklist-product/view.ts', 'checklist-product/creator.ts']) receipt.moduleHashes[relative] = hash(await fs.readFile(path.resolve(__dirname, '../../..', relative)));
    for (const name of ['integration-resource-opening.cjs', 'integration-desktop-basics.cjs', 'integration-agents.cjs', 'integration-checklists.cjs']) receipt.moduleHashes[name] = hash(await fs.readFile(path.join(__dirname, name)));
    for (const [name, digest] of Object.entries(source.buildAssets)) { assert.equal(path.basename(name), name); assert.equal(hash(await fs.readFile(path.join(__dirname, '../dist/assets', name))), digest, 'actual_build_asset_binding'); }
    if (restore) { expected = await readJson(expectedFile); assert.deepEqual(expected.source, sourceIdentity(source)); assert.deepEqual(expected.moduleHashes, receipt.moduleHashes); passingCheckpoint(expected, await readJson(path.join(root, expected.initialReceipt))); budget = validateBudget(await readJson(budgetFile)); assert.equal(budget.count, 2); budgetWritable = true; }
    else { await assert.rejects(fs.stat(expectedFile), { code: 'ENOENT' }); await assert.rejects(fs.stat(budgetFile), { code: 'ENOENT' }); budgetWritable = true; }
    const js = async code => { slot.check(); const result = await bounded(win.webContents.executeJavaScript(code, false), slot.workRemaining(), 'task_renderer_deadline'); slot.check(); return result; };
    const rpc = async (name, input) => { assertRead(name, input); slot.check(); const result = await bounded(call(name, input), slot.workRemaining(), 'task_read_deadline'); slot.check(); return result; };
    const desktop = () => rpc('desktop', { type: 'snapshot' }), task = async id => { const value = assertTask((await rpc('taskObjectives', { name: 'read', input: { resourceId: id } })).result); assert.equal(value.resource.id, id); lastTaskId = id; return value; }, checklist = async id => assertChecklist((await rpc('checklists', { name: 'read', input: { resourceId: id } })).result);
    const wait = (label, check) => { receipt.phase = label; return waitForCondition({ slot, label, check, diagnose: () => js("({task:[...document.querySelectorAll('.aw-task-tracker')].map(n=>({id:n.dataset.resourceId,busy:n.getAttribute('aria-busy'),status:n.querySelector('.aw-task-status')?.textContent,states:n.querySelector('.aw-task-outcome-states')?.textContent})),creator:document.querySelector('.aw-task-create-status')?.textContent,picker:!!document.querySelector('[data-surface-id=\"task-reference-picker\"]'),surfaces:[...document.querySelectorAll('[data-surface-id]')].map(n=>n.dataset.surfaceId),error:document.querySelector('#command-error')?.textContent})") }); };
    const click = async selector => {
      await js(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'})`); let previous, point;
      await wait('Actual visible stable Task control ' + selector, async () => { const result = await js(targetScript(selector, 'inspect')); if (!result.ready) {
        await js(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n||n.closest('[hidden],[inert]'))return;const r=n.getBoundingClientRect();let clipped=r.left<0||r.top<0||r.right>innerWidth||r.bottom>innerHeight;for(let p=n.parentElement;p&&!clipped;p=p.parentElement){const s=getComputedStyle(p),b=p.getBoundingClientRect();clipped=(s.overflowX!=='visible'&&(r.left<b.left||r.right>b.right))||(s.overflowY!=='visible'&&(r.top<b.top||r.bottom>b.bottom));}if(clipped)n.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});})()`);
        previous = undefined; return false; } point = { x: Math.round(result.rect.x + result.rect.width / 2), y: Math.round(result.rect.y + result.rect.height / 2) }; const stable = previous && Math.abs(point.x - previous.x) < 1 && Math.abs(point.y - previous.y) < 1; previous = point; return stable; });
      receipt.actions.push({ method: 'software-native-window-mouse', selector }); for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) { slot.check(); win.webContents.sendInputEvent({ type, ...point, button: 'left', clickCount: 1 }); }
    };
    const key = (keyCode, modifiers = []) => { for (const type of ['keyDown', 'keyUp']) { slot.check(); win.webContents.sendInputEvent({ type, keyCode, modifiers }); } };
    const fill = async (selector, text) => { await fillNative({ click, key, js, wait, insertText: text => bounded(win.webContents.insertText(text), slot.workRemaining(), 'task_text_input_deadline') }, selector, text); receipt.actions.push({ method: 'software-native-window-insertText', selector, characters: text.length }); };
    const byText = async (container, text) => { let selector; await wait('Actual Task public control ' + text, async () => { selector = await js(`(()=>{const n=[...document.querySelector(${JSON.stringify(container)})?.querySelectorAll('button')??[]].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!n)return null;let p=n,parts=[];while(p&&p!==document.documentElement){parts.unshift(p.tagName.toLowerCase()+':nth-child('+([...p.parentElement.children].indexOf(p)+1)+')');p=p.parentElement;}return 'html>'+parts.join('>')})()`); return !!selector; }); await click(selector); };
    const select = async (selector, value) => { const index = await js(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});return n?[...n.options].findIndex(o=>o.value===${JSON.stringify(value)}&&!o.disabled):-1})()`); assert(index >= 0 && index <= 32, 'actual_task_option_required'); await click(selector); await wait('Actual Task select focus', () => js(`document.activeElement===document.querySelector(${JSON.stringify(selector)})`)); key('Home'); for (let i = 0; i < index; i++) key('Down'); key('Return'); await wait('Actual Task select acknowledged', () => js(`document.querySelector(${JSON.stringify(selector)})?.value===${JSON.stringify(value)}`)); };
    const close = async () => { await click('[data-surface-id="canonical-resource"] .aw-contextual-dismiss'); await wait('Actual Task resource surface closes', () => js('!document.querySelector(\'[data-surface-id="canonical-resource"]\')')); };
    const readyTask = async document => wait('Actual canonical Task Tracker read caught up', () => js(`(()=>{const n=document.querySelector(${JSON.stringify(scope(document.resource.id))});return n&&!n.closest('[hidden],[inert]')&&n.getAttribute('aria-busy')==='false'&&n.querySelector('.aw-task-objective')?.textContent===${JSON.stringify(document.definition.objective)}})()`));
    const openTask = async document => { await click('#application-resources'); await fill('#resource-search', document.resource.title); await click(`#resource-results [data-open-resource=${JSON.stringify(document.resource.id)}]`); await readyTask(document); };
    const renderedHistory = async id => { const selector = scope(id) + ' [data-task-panel="history"] li:nth-child(4) strong';
      await wait('Actual fourth Task history entry loaded', () => js(`document.querySelector(${JSON.stringify(selector)})?.textContent.startsWith('Version 4')`));
      await wait('Actual fourth Task history entry visible', async () => { await js(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'})`); return (await js(targetScript(selector, 'inspect'))).ready; }); };
    const pickChecklist = async () => { const picker = '[data-surface-id="task-reference-picker"]'; await fill(picker + ' input[aria-label="Find a task reference"]', FIXTURE.checklist); let keyValue;
      await wait('Actual official Checklist target key', async () => { const keys = await js(`(()=>{const n=document.querySelector(${JSON.stringify(picker)});return [...n?.querySelectorAll('button[data-task-target-key]')??[]].filter(b=>b.textContent.includes(${JSON.stringify(FIXTURE.checklist)})&&!b.disabled).map(b=>b.dataset.taskTargetKey)})()`); assert(keys.length <= 1, 'unambiguous_official_task_target_required'); keyValue = keys[0]; return typeof keyValue === 'string' && !!keyValue && keyValue.length <= 2048; });
      await click(picker + ` button[data-task-target-key=${JSON.stringify(keyValue)}]`); await wait('Actual official Task target selected', () => js(`!document.querySelector(${JSON.stringify(picker)})`)); receipt.actions.push({ method: 'official-task-target-key-selection', title: FIXTURE.checklist }); };
    const proof = async () => { const core = await rpc('snapshot', {}), d = await desktop(), replay = await rpc('replay', { after: 0 }); assert.equal(typeof observeProviderActivity, 'function', 'actual_provider_observer_required'); const counters = await bounded(observeProviderActivity(), slot.workRemaining(), 'task_observer_deadline'); assertNoExecution(core, replay, counters, d); return { resources: d.resources.map(r => ({ id: r.id, kind: r.kind, title: r.title, version: r.version, projectId: r.project_id })).sort((a, b) => a.id.localeCompare(b.id)), relationships: d.relationships, graph: core.graph, resourceMap: core.resourceMap, counters }; };
    const capture = async (name, resourceId = lastTaskId) => { const sample = () => js("(()=>{const s=window.__aerynth.snapshot();return{frames:s.gpu?.framesRendered,draws:s.metrics.draws,active:s.active,lost:s.gpu?.contextLost,failed:s.graphicsFailed,errors:s.metrics.errors}})()"); let gpuBefore;
      const result = await captureTask({ slot, resourceId, observe: () => js(taskCaptureScript(resourceId)), wait, freshDraw: async () => { gpuBefore = await sample(); await wait('Fresh actual Task GPU draw', async () => { const next = await sample(); return next.active === true && next.failed === false && next.lost === false && next.errors.length === 0 && next.frames > gpuBefore.frames && next.draws > gpuBefore.draws; }); }, capture: async () => (await bounded(win.webContents.capturePage(), slot.workRemaining(), 'task_capture_deadline')).toPNG() });
      const file = path.join(out, name + '.png'), item = admitPNG(budget, result.png, file); await fs.writeFile(file, result.png, { flag: 'wx' }); receipt.captures.push({ ...item, resourceId, focused: true, surfaceBefore: result.before, surfaceAfter: result.after, gpuBefore, gpuAfter: await sample() }); }; failureCapture = () => capture('failure');
    const canonical = async (taskId, checklistId) => { const document = assertAccepted(await task(taskId), checklistId), source = await checklist(checklistId), history = assertHistory((await rpc('taskObjectives', { name: 'history', input: { resourceId: taskId, limit: 64 } })).result, document);
      assert.equal(source.resource.title, FIXTURE.checklist); assert.equal(source.entries.length, 1); assert.equal(source.entries[0].text, FIXTURE.item); assert.equal(source.entries[0].checked, true); return { document, source, history, desktop: await proof() }; };
    await wait('Combined app ready', () => js("document.body.dataset.applicationHydrated==='true'")); receipt.startingCanonical = await proof();
    if (restore) {
      const current = await canonical(expected.taskId, expected.checklistId); assert.deepEqual(current, expected.canonical, 'exact_task_source_review_acceptance_and_history_restart'); await openTask(current.document);
      await byText(scope(expected.taskId) + ' .aw-task-actions', 'History'); await renderedHistory(expected.taskId); await capture('03-task-objective-restart', expected.taskId); receipt.canonical = current;
    } else {
      assert.equal(receipt.startingCanonical.resources.length, 0, 'fresh_empty_task_objectives_profile_required'); await click('#application-resources'); await click('#standalone-task-objective');
      const creator = '.aw-task-objective-creator'; await fill(creator + ' input[aria-label="Task title"]', FIXTURE.title); await fill(creator + ' textarea[aria-label="Objective"]', FIXTURE.objective); await byText(creator, 'Add requirement'); await fill(creator + ' input[aria-label="Requirement text"]', FIXTURE.criterion); await byText(creator, 'Create task objective');
      let taskId, document; await wait('Actual canonical Task Objective created', async () => { const resource = (await desktop()).resources.find(r => r.kind === 'task_objective' && r.title === FIXTURE.title); if (!resource) return false; taskId = resource.id; document = await task(taskId); return document.disposition === 'open'; }); await readyTask(document);
      assert.equal(document.verification, 'unreviewed'); assert.equal(document.acceptance.state, 'not-accepted'); assert.equal(document.resource.version, 1); const criterionId = document.definition.requirements[0].id; await capture('01-task-objective', taskId); await close();
      await click('#application-resources'); await click('#standalone-checklist'); await fill('.aw-checklist-creator input[aria-label="Checklist title"]', FIXTURE.checklist); await byText('.aw-checklist-creator', 'Create checklist');
      let checklistId; await wait('Actual canonical Checklist evidence source created', async () => { const r = (await desktop()).resources.find(r => r.kind === 'checklist' && r.title === FIXTURE.checklist); if (r) checklistId = r.id; return !!r; }); const sourceScope = `.aw-checklist[data-resource-id=${JSON.stringify(checklistId)}]`;
      await fill(sourceScope + ' input[aria-label="New checklist item"]', FIXTURE.item); await byText(sourceScope + ' .aw-checklist-add', 'Add item'); let entryId;
      await wait('Actual source item saved', async () => { const source = await checklist(checklistId); entryId = source.entries[0]?.id; return source.entries.length === 1 && source.entries[0].text === FIXTURE.item; }); await click(sourceScope + ` [data-checklist-entry-id=${JSON.stringify(entryId)}] input[aria-label="Check item manually"]`); await wait('Actual source manually checked', async () => (await checklist(checklistId)).entries[0].checked); await close(); await openTask(document);
      const tracker = scope(taskId), editor = tracker + ' [data-task-panel="definition"]', review = tracker + ' [data-task-panel="review"]', acceptance = tracker + ' [data-task-panel="acceptance"]';
      await byText(tracker + ' .aw-task-actions', 'Edit definition'); await byText(editor, 'Add source'); await pickChecklist(); await byText(editor, 'Record definition');
      await wait('Actual saved Task source reference', async () => { document = await task(taskId); return document.resource.version === 2 && document.sources.length === 1 && document.sources[0].reference?.resourceId === checklistId && document.sources[0].freshness === 'current'; }); assert.equal(document.definition.requirements[0].id, criterionId); assert.equal(document.acceptance.state, 'not-accepted');
      await readyTask(document); await byText(tracker + ' .aw-task-actions', 'Review outcome'); await select(review + ' select[aria-label="Decision"]', 'verified'); await click(review + ` input[data-requirement-id=${JSON.stringify(criterionId)}]`); await byText(review, 'Choose review evidence'); await pickChecklist(); await fill(review + ' textarea[aria-label="Review note"]', FIXTURE.review); await byText(review, 'Record manual review');
      await wait('Manual verification recorded separately from acceptance', async () => { document = await task(taskId); return document.resource.version === 3 && document.verification === 'verified'; }); assert.equal(document.disposition, 'open'); assert.equal(document.acceptance.state, 'not-accepted'); assert.equal(document.reviews.length, 1); assertManual(document.reviews[0].provenance);
      await readyTask(document); await byText(tracker + ' .aw-task-actions', 'Review acceptance'); await click(acceptance + ' input[type="checkbox"]'); await byText(acceptance, 'Confirm acceptance'); await wait('Actual separate manual acceptance', async () => { document = await task(taskId); return document.resource.version === 4 && document.acceptance.state === 'valid' && document.disposition === 'accepted'; }); assertAccepted(document, checklistId);
      await readyTask(document); await byText(tracker + ' .aw-task-actions', 'History'); await renderedHistory(taskId); await capture('02-reviewed-accepted-task', taskId);
      const value = await canonical(taskId, checklistId); await close(); await openTask(document); assert.deepEqual(await task(taskId), value.document, 'closing_and_reopening_keeps_exact_task_identity_and_decisions'); receipt.canonical = value;
      receipt.checks.push('Real placement-free Task creator, canonical requirement/source IDs, official target key selection, accountable manual review, separate acceptance, whole history and exact reopen');
      pendingExpected = { contract: 'aerynth.task-objectives-checkpoint@1', source: sourceIdentity(source), moduleHashes: receipt.moduleHashes, taskId, checklistId, canonical: value, initialReceipt: path.relative(root, path.join(out, 'journey.json')) };
    }
    await proof(); assert.equal(startupErrors.length, 0); assert.equal(receipt.errors.length, 0); slot.check(); passed = true;
  };
  try { await Promise.race([run(), aborted]); }
  catch (error) { receipt.error = { message: String(error.message).slice(0, 1200), ...(error.diagnostics ? { diagnostics: error.diagnostics } : {}) }; if (admitted && failureCapture && !slot.failure()) try { await failureCapture(); } catch {} }
  finally {
    clearTimeout(workTimer);
    try {
      if (!owned) { console.log(JSON.stringify({ passed: false, error: receipt.error?.message, cleanup: 'Unowned profile/window: no writes or control' })); return receipt; }
      try { assert.equal(await bounded(call('close', {}), Math.min(1500, slot?.remaining() ?? 1500), 'task_canonical_close_deadline'), null); receipt.nativeCloseConfirmed = true; } catch (error) { passed = false; receipt.nativeCloseError = String(error.message).slice(0, 1000); }
      receipt.elapsedMs = performance.now() - moduleStartedMonotonicMs; receipt.slotFailure = slot?.failure() ?? null; receipt.startupErrors = startupErrors.slice(0, 24); receipt.passed = passed && receipt.nativeCloseConfirmed === true && !receipt.slotFailure && !receipt.errors.length && !startupErrors.length;
      if (admitted) { if (receipt.passed && pendingExpected) await fs.writeFile(expectedFile, encode(pendingExpected), { flag: 'wx' }); if (budgetWritable) await fs.writeFile(budgetFile, encode(validateBudget(budget))); await fs.mkdir(out, { recursive: true }); const file = path.join(out, restore ? 'restore.json' : 'journey.json'); await fs.writeFile(file, encode(receipt), { flag: 'wx' }); if (slot?.failure() || receipt.errors.length || startupErrors.length) { receipt.passed = false; receipt.slotFailure = slot?.failure() ?? null; await fs.writeFile(file, encode(receipt)); } }
      console.log(JSON.stringify({ passed: receipt.passed, restore, evidence: admitted ? out : null, error: receipt.error?.message, elapsedMs: receipt.elapsedMs }));
    } catch (error) { receipt.passed = false; console.log(JSON.stringify({ passed: false, error: String(error.message).slice(0, 1000) })); }
    finally { if (listenersInstalled) { win.removeListener('blur', blur); win.removeListener('hide', blur); win.removeListener('minimize', blur); win.webContents.removeListener('before-input-event', escape); win.webContents.removeListener('console-message', consoleError); } clearTimeout(hardTimer); if (owned) app.exit(receipt.passed ? 0 : 1); }
  }
  return receipt;
};
