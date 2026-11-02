/* Owned real-app acceptance helper. No OS input, foreground reclamation, OAuth,
 * provider calls, or global hooks. Root's caller must independently confirm exit.
 * --integration-environments --profile=<absolute review-environments-TIMESTAMP>
 * --verify-restore reuses ONLY that profile and identical source/build checkpoint.
 * Optional --record-environments: one initial exact-window recording <=32MiB.
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { createDriver } = require('./desktop-verify.cjs');
const { createSlot, targetScript, waitForCondition, sourceIdentity, assertWorkspaceProjection } = require('./integration-resource-opening.cjs');
const MiB = 1024 * 1024;
const json = value => JSON.stringify(value, null, 2);
const hash = value => createHash('sha256').update(value).digest('hex');
const sorted = values => [...values].sort((a, b) => a.id.localeCompare(b.id));
const selector = { panel: '[data-surface-id="environments"]', navigator: '.en-navigator', search: '.en-navigator input[name="query"]', editor: '.en-editor:not([hidden])' };
const actionSelector = action => `.en-navigator [data-action=${JSON.stringify(action)}]`;
const groupSelector = id => `.en-group[data-project-id=${JSON.stringify(id)}]`;
const rowSelector = (id, archived = false) => `${archived ? '.en-archive-list' : '.en-tree'} .en-workspace-row[data-workspace-id=${JSON.stringify(id)}]`;
async function bounded(promise, ms, code) {
  assert(ms > 0, code); let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(code)), ms); })]); }
  finally { clearTimeout(timer); }
}
function assertOwnedProfile(privateRoot, argv, title) {
  assert(argv.includes('--integration-environments'), 'explicit_environments_flag_required');
  assert(path.win32.isAbsolute(privateRoot) && path.win32.parse(privateRoot).root.toLowerCase() === 'c:\\' && /^review-environments-\d+$/.test(path.win32.basename(privateRoot)), 'fresh_owned_environments_profile_required');
  assert.match(title, /Automated check/i, 'owned_automated_window_required');
}
function validateBudget(value) {
  assert(value && Number.isSafeInteger(value.count) && value.count >= 0 && value.count <= 3 && Number.isSafeInteger(value.bytes) && value.bytes >= 0 && value.bytes <= 16 * MiB && Number.isSafeInteger(value.videos) && value.videos >= 0 && value.videos <= 1 && Number.isSafeInteger(value.videoBytes) && value.videoBytes >= 0 && value.videoBytes <= 32 * MiB && Array.isArray(value.files) && value.files.length === value.count, 'invalid_environments_evidence_budget');
  let bytes = 0; const names = new Set();
  for (const item of value.files) { assert(typeof item.file === 'string' && !names.has(item.file) && Number.isSafeInteger(item.bytes) && item.bytes > 0 && /^[a-f0-9]{64}$/.test(item.sha256), 'invalid_environments_capture'); names.add(item.file); bytes += item.bytes; }
  assert.equal(bytes, value.bytes, 'capture_budget_sum_mismatch');
  return value;
}
function admitPNG(budget, bytes, file) {
  validateBudget(budget);
  assert(Buffer.isBuffer(bytes) && bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'native_png_required');
  assert(budget.count < 3 && budget.bytes + bytes.length <= 16 * MiB && !budget.files.some(item => item.file === file), 'environments_png_budget_exceeded');
  const item = { file, bytes: bytes.length, sha256: hash(bytes) };
  budget.files.push(item); budget.count++; budget.bytes += bytes.length; return item;
}
/** Only workspace display name/version may change during organization. Every
 * engine geometry/presentation/revision, resource and provider field remains. */
function organizationInvariant(value) {
  const copy = structuredClone(value);
  for (const key of ['workspaces', 'archivedWorkspaces']) copy[key] = copy[key].map(({ title, version, ...identity }) => identity);
  for (const layout of Object.values(copy.layouts)) { delete layout.title; delete layout.workspaceVersion; }
  return copy;
}
function layoutGeometry(value) {
  const result = structuredClone({ blocks: value.blocks, presence: value.presence });
  for (const block of result.blocks) delete block.version;
  delete result.presence.version;
  return result;
}
/** Reuse the exact visibility/hit-test gate before local form/key events. These
 * are renderer events, never a native keyboard or trusted physical-input claim. */
function localEventScript(query, kind, value) {
  assert(['change', 'submit', 'keydown'].includes(kind), 'unsupported_local_event');
  if (kind === 'keydown') assert(['ArrowLeft', 'ArrowRight', 'Enter'].includes(value), 'unsupported_local_key');
  return `(()=>{const checked=${targetScript(query, 'inspect')};if(!checked.ready)return checked;const node=document.querySelector(${JSON.stringify(query)});${kind === 'change' ? `node.value=${JSON.stringify(value)};node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));` : kind === 'submit' ? `const form=node.form;if(!form||!form.checkValidity())return{invalid:true};form.requestSubmit(node);` : `node.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(value)},bubbles:true,cancelable:true}));`}return checked})()`;
}
function opticalScript(panel = selector.panel, content = selector.navigator) {
  return `(()=>{const p=document.querySelector(${JSON.stringify(panel)}),n=document.querySelector(${JSON.stringify(content)}),s=window.__aerynth.snapshot();if(!p||!n)return null;const r=p.getBoundingClientRect(),filters=[];for(const leaf of [document.querySelector('#world'),document.querySelector('#folios')])for(let e=leaf;e;e=e.parentElement){const c=getComputedStyle(e);if(c.filter!=='none'||c.backdropFilter!=='none')filters.push({tag:e.tagName,id:e.id,filter:c.filter,backdrop:c.backdropFilter})}return{modal:p.matches(':modal')||p.getAttribute('aria-modal')==='true',sceneModal:!!document.querySelector('dialog:modal'),filters,glass:getComputedStyle(p).backdropFilter,bounds:{x:r.x,y:r.y,width:r.width,height:r.height},viewport:{width:innerWidth,height:innerHeight},active:s.active,failed:s.graphicsFailed,contextLost:s.gpu?.contextLost,draws:s.metrics.draws,frames:s.gpu?.framesRendered,errors:s.metrics.errors}})()`;
}
function assertOptics(value) {
  assert(value && value.modal === false && value.sceneModal === false && value.filters.length === 0, 'navigator_must_not_modalize_or_blur_scene');
  const { bounds: r, viewport: v } = value;
  assert(r.width > 0 && r.height > 0 && r.x >= 0 && r.y >= 0 && r.x + r.width <= v.width + 1 && r.y + r.height <= v.height + 1 && r.width * r.height < v.width * v.height * .75, 'navigator_must_be_locally_sized_and_visible');
  assert(value.active === true && value.failed === false && value.contextLost === false && Array.isArray(value.errors) && value.errors.length === 0 && Number.isFinite(value.draws) && Number.isFinite(value.frames), 'healthy_actual_renderer_required');
  return value;
}
exports.assertOwnedProfile = assertOwnedProfile;
exports.validateBudget = validateBudget;
exports.admitPNG = admitPNG;
exports.organizationInvariant = organizationInvariant;
exports.layoutGeometry = layoutGeometry;
exports.localEventScript = localEventScript;
exports.assertOptics = assertOptics;

exports.verify = async function verify({ win, app, privateRoot, call, source, startupErrors = [], session, localURL, moduleStartedMonotonicMs }) {
  const restore = process.argv.includes('--verify-restore'), record = process.argv.includes('--record-environments'), limitMs = restore ? 12000 : 45000;
  const root = path.resolve(privateRoot), out = path.join(root, 'environments-evidence', `${restore ? 'restore' : 'initial'}-${Date.now()}`), expectedFile = path.join(root, 'environments-expected.json'), budgetFile = path.join(root, 'environments-capture-budget.json');
  const receipt = { contract: 'aerynth.environments-integration@1', source, restore, passed: false, syntheticOnly: true, inputMethod: 'Visible renderer DOM click/input/change/submit/keydown and existing canonical App capabilities; no OS input or global hooks', limits: { milliseconds: limitMs, conditionMilliseconds: 4000, combinedPNGs: 3, combinedPNGBytes: 16 * MiB, combinedVideos: 1, videoBytes: 32 * MiB }, actions: [], checks: [], captures: [], motion: {}, errors: [], limitations: ['Requires independent caller confirmation of process/window/backend exit.', 'Callback and CSS presentation samples are not measured monitor presentation performance.', 'Synthetic fresh-profile real-app acceptance; no provider, OAuth, account or existing user-profile access.', 'Screenshots and optional exact-window video require separate artistic inspection.'] };
  let owned = false, admitted = false, slot, driver, recorder, pendingExpected, workTimer, hardTimer, passed = false;
  let budget = { count: 0, bytes: 0, videos: 0, videoBytes: 0, files: [] };
  let rejectAbort; const aborted = new Promise((_, reject) => { rejectAbort = reject; }); aborted.catch(() => {});
  const abort = code => rejectAbort(slot?.abort(code) ?? Error(code));
  const blur = () => abort('environments_focus_lost');
  const escape = (_event, input) => { if (input?.type === 'keyDown' && input.key === 'Escape') abort('environments_operator_escape'); };
  const consoleError = (_event, details) => { if ((details?.level === 'error' || details?.level === 3) && receipt.errors.length < 24) receipt.errors.push(String(details.message).slice(0, 1000)); };
  const run = async () => {
    assertOwnedProfile(privateRoot, process.argv, win.getTitle()); sourceIdentity(source); assert(!restore || !record, 'record_initial_only'); owned = true;
    slot = createSlot({ win, startedAt: moduleStartedMonotonicMs, limitMs, cleanupMs: restore ? 2500 : 4000 }); slot.check();
    hardTimer = setTimeout(() => { receipt.hardDeadline = true; abort('environments_hard_deadline'); app.exit(1); }, slot.remaining());
    workTimer = setTimeout(() => abort('environments_work_deadline'), slot.workRemaining());
    win.on('blur', blur); win.on('hide', blur); win.on('minimize', blur); win.webContents.on('before-input-event', escape); win.webContents.on('console-message', consoleError);
    receipt.reserve = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-File', path.join(process.env.LOCALAPPDATA || '', 'AeroStorageWatch', 'ReserveGuard.ps1'), '-EstimatedCBytes', String((record ? 64 : 32) * MiB), '-EstimatedDBytes', '0'], { windowsHide: true, timeout: 4000, maxBuffer: 8192, encoding: 'utf8' }));
    assert.equal(receipt.reserve.allowed, true, 'storage_reserve_denied'); admitted = true; slot.check();
    if (!restore) { await assert.rejects(fs.stat(expectedFile), { code: 'ENOENT' }); await assert.rejects(fs.stat(budgetFile), { code: 'ENOENT' }); }
    else { budget = validateBudget(JSON.parse(await fs.readFile(budgetFile, 'utf8'))); assert(budget.count <= 2, 'restore_png_reserved'); }
    await fs.mkdir(out, { recursive: true });
    driver = await bounded(createDriver(win, { assertActive: () => slot.check() }), Math.min(4000, slot.workRemaining()), 'environments_driver_deadline');
    const js = async code => { slot.check(); const value = await bounded(driver.js(code), slot.workRemaining(), 'environments_renderer_deadline'); slot.check(); return value; };
    const rpc = async (name, input) => { slot.check(); const value = await bounded(call(name, input), slot.workRemaining(), 'environments_backend_deadline'); slot.check(); return value; };
    const wait = async (label, check) => { receipt.phase = label; return waitForCondition({ slot, label, check, diagnose: () => js("({status:document.querySelector('#status')?.textContent?.slice(0,240),navigatorStatus:document.querySelector('.en-status')?.textContent?.slice(0,240),editor:document.querySelector('.en-editor')?.dataset.mode})") }); };
    const expression = (label, code) => wait(label, () => js(`(()=>{try{return (${code})}catch{return false}})()`));
    const action = async (query, kind = 'click', value) => {
      await js(`document.querySelector(${JSON.stringify(query)})?.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'})`);
      await wait('Visible ' + query, async () => (await js(targetScript(query, 'inspect'))).ready);
      assert(['click', 'input', 'change', 'submit', 'keydown'].includes(kind), 'unsupported_navigator_action');
      const result = await js(['change', 'submit', 'keydown'].includes(kind) ? localEventScript(query, kind, value) : targetScript(query, kind, value));
      assert.equal(result.ready, true, 'environments_target_changed'); assert(!result.invalid, 'actual_form_invalid');
      receipt.actions.push({ method: 'renderer-DOM-' + kind, selector: query, ...(kind === 'input' ? { characters: value.length } : {}) });
    };
    const appCommand = input => { receipt.actions.push({ method: 'canonical-App-fixture', type: input.type }); return js(`window.__aerynth.execute(${JSON.stringify(input)})`); };
    const desktop = () => rpc('desktop', { type: 'snapshot' });
    const flush = () => js('window.__aerynth.flush()');
    const settled = () => expression('Real navigator settled', "!!document.querySelector('.en-navigator')&&!document.querySelector('.en-navigator').closest('[inert]')&&document.querySelector('.en-navigator').getAttribute('aria-busy')!=='true'");
    const open = async () => { await action('#workspace-manager'); await settled(); await wait('Contextual panel visible', async () => (await js(targetScript(selector.search, 'inspect'))).ready); };
    const canonical = async () => {
      await flush(); const d = await desktop(), core = await rpc('snapshot', {}), layouts = {}, notes = {};
      assert(d.projects.length <= 2 && d.workspaces.length <= 3 && d.resources.length <= 4, 'bounded_environments_fixture_required');
      assert.equal(Object.keys(core.executions).length, 0, 'provider_execution_forbidden'); assert.equal(Object.keys(core.handoffs).length, 0, 'delegation_forbidden');
      for (const w of d.workspaces) layouts[w.id] = assertWorkspaceProjection(w, (await rpc('library', { name: 'inspectWorkspace', input: { workspaceId: w.id } })).result);
      for (const r of d.resources) if (r.kind === 'note') notes[r.id] = (await rpc('notes', { name: 'readNote', input: r.id })).result;
      const vela = await rpc('vela', { name: 'state', input: {} });
      assert.equal(vela.requests.length, 0); assert.equal(vela.plans.length, 0); assert.equal(vela.receipts.length, 0);
      return { projects: sorted(d.projects), workspaces: sorted(d.workspaces), archivedWorkspaces: sorted(d.archivedWorkspaces ?? []), resources: sorted(d.resources), placements: sorted(d.navigationBlocks ?? d.blocks), relationships: sorted(d.relationships), layouts, notes, graph: core.graph, conversations: core.conversations, canonicalResources: core.resources, resourceMap: core.resourceMap, bindings: core.bindings, executions: core.executions, handoffs: core.handoffs, messageEvidence: core.messageEvidence, vela: { requests: vela.requests, plans: vela.plans, receipts: vela.receipts, preferences: vela.preferences } };
    };
    const optics = async (panel, content) => assertOptics(await js(opticalScript(panel, content)));
    const capture = async (name, panel, content) => {
      const before = await optics(panel, content); let prior, stable = 0;
      await wait('Fresh GPU draw and stable contextual surface', async () => { const value = await optics(panel, content), r = value.bounds; stable = prior && Object.keys(r).every(key => Math.abs(r[key] - prior[key]) < .75) ? stable + 1 : 0; prior = r; return stable >= 2 && value.draws > before.draws && value.frames > before.frames; });
      const png = (await bounded(win.webContents.capturePage(), slot.workRemaining(), 'environments_capture_deadline')).toPNG(); slot.check();
      const file = path.join(out, name + '.png'), item = admitPNG(budget, png, file);
      await fs.writeFile(file, png, { flag: 'wx' }); receipt.captures.push({ ...item, evidence: 'Actual integrated owned Electron window', optics: await optics(panel, content) }); await fs.writeFile(budgetFile, json(budget));
    };
    const searchOpen = async (id, title) => { await open(); await action(selector.search, 'input', title); await action(rowSelector(id) + ' [data-action="open-workspace"]'); await expression('Exact searched workspace opens', `window.__aerynth.application().navigation.kind==='workspace'&&window.__aerynth.application().activeWorkspaceId===${JSON.stringify(id)}`); };
    const begin = async mode => { if (!(await js(`document.querySelector(${JSON.stringify(actionSelector('toggle-create'))})?.getAttribute('aria-expanded')==='true'`))) await action(actionSelector('toggle-create')); await action(actionSelector(mode)); await expression('Actual inline editor', `document.querySelector('.en-editor')?.dataset.mode===${JSON.stringify(mode === 'create-project' ? 'project-create' : 'workspace-create')}&&!document.querySelector('.en-editor').hidden`); };
    const submit = mode => action(actionSelector('submit-' + mode), 'submit');
    const createWorkspace = async (title, projectId) => { await open(); await begin('create-workspace'); await action(selector.editor + ' input[name="title"]', 'input', title); await action(selector.editor + ' select[name="projectId"]', 'change', projectId ?? ''); await submit('workspace-create'); let found; await wait('Canonical created workspace and project identity', async () => { found = (await desktop()).workspaces.find(w => w.title === title && w.project_id === projectId); return !!found; }); return found.id; };
    const more = async id => { await action(rowSelector(id) + ' [data-action="workspace-more"]'); await expression('Exact workspace contextual actions', `document.querySelector('.en-workspace-actions')?.dataset.workspaceId===${JSON.stringify(id)}&&!document.querySelector('.en-workspace-actions').hidden`); };
    const workspaceActions = async fixture => {
      const panel = '[data-surface-id="workspace-actions"]', content = '.aw-workspace-actions', control = name => `${content} [data-action=${JSON.stringify(name)}]`;
      const inspect = async () => {
        const w = (await desktop()).workspaces.find(w => w.id === fixture.workspaceId); assert(w);
        return assertWorkspaceProjection(w, (await rpc('library', { name: 'inspectWorkspace', input: { workspaceId: w.id } })).result);
      };
      const ready = mode => expression('Actual Workspace Actions canonical readiness', `(()=>{const e=document.querySelector(${JSON.stringify(content)});return e?.dataset.workspaceId===${JSON.stringify(fixture.workspaceId)}&&e.dataset.state==='ready'${mode ? `&&e.dataset.mode===${JSON.stringify(mode)}` : ''}})()`);
      const show = async () => { await action('#layout-manager'); await ready(); };
      const dismiss = async () => {
        if (await js(`!!document.querySelector(${JSON.stringify(panel)})&&!document.querySelector(${JSON.stringify(panel)}).inert`)) await action(panel + ' .aw-contextual-dismiss');
        await expression('Workspace Actions closes through shared coordinator', `!document.querySelector(${JSON.stringify(panel)})`);
      };
      await show(); const initial = await inspect(), initialGeometry = layoutGeometry(initial), originalViewport = initial.viewport;
      await action(control('mode-structured')); await ready('structured'); const structured = await inspect(); assert.equal(structured.organization.mode, 'structured'); assert.deepEqual(layoutGeometry(structured), initialGeometry, 'Mode-only Structured preserves off-grid canonical geometry');
      await action(control('mode-fluid')); await ready('fluid'); const checkpoint = await inspect(); assert.equal(checkpoint.organization.mode, 'fluid'); assert.deepEqual(layoutGeometry(checkpoint), initialGeometry, 'Mode-only Fluid preserves canonical geometry');
      await action(control('history-toggle')); await action(control('checkpoint')); await ready('fluid'); assert.equal((await desktop()).hasCheckpoint, true);
      const block = (await desktop()).blocks.find(b => b.resource_id === fixture.noteId); assert(block); fixture.blockId = block.id;
      await appCommand({ type: 'geometry', blockId: block.id, expectedVersion: block.version, placement: { x: block.x + 64, y: block.y + 32, width: block.width, height: block.height, z: block.z }, shape: block.shape, rotation: block.rotation ?? 0 });
      await ready('fluid'); const edited = await inspect(); assert.notDeepEqual(layoutGeometry(edited), initialGeometry, 'Real canonical fixture move must change geometry');
      await action(control('undo')); await ready('fluid'); assert.deepEqual(layoutGeometry(await inspect()), initialGeometry, 'Actual Undo restores canonical placement and Vela');
      await action(control('redo')); await ready('fluid'); assert.deepEqual(layoutGeometry(await inspect()), layoutGeometry(edited), 'Actual Redo restores edited canonical placement');
      await action(control('restore')); await ready('fluid'); assert.deepEqual(layoutGeometry(await inspect()), initialGeometry, 'Actual checkpoint Restore preserves original resource identities/geometry');
      await action(control('find-toggle')); await action(control('find-vela')); await flush();
      await wait('Find Vela callback centers actual canonical presence', async () => { const d = await desktop(), size = await js('({width:innerWidth,height:innerHeight})'), p = d.presence, v = d.viewport; return v?.zoom === 1 && p && Math.abs(v.x + p.x + p.width / 2 - size.width / 2) < 1 && Math.abs(v.y + p.y + p.height / 2 - size.height / 2) < 1; });
      await dismiss(); await show();
      if (!(await js(`document.querySelector(${JSON.stringify(control('find-toggle'))})?.getAttribute('aria-expanded')==='true'`))) await action(control('find-toggle'));
      await action(`${control('find-block')}[data-block-id=${JSON.stringify(block.id)}]`); await expression('Find block callback opens exact canonical card', `window.__aerynth.snapshot().expanded===${JSON.stringify(block.id)}`); await dismiss();
      await js('window.__aerynth.home()'); await appCommand({ type: 'setViewport', workspaceId: fixture.workspaceId, viewport: originalViewport }); await flush();
      assert.deepEqual(layoutGeometry(await inspect()), initialGeometry, 'Locate/return must preserve all resource geometry and Vela');
      assert.equal((await rpc('notes', { name: 'readNote', input: fixture.noteId })).result.resource.content, fixture.noteText);
      await show(); await capture('02-workspace-actions', panel, content); await dismiss();
      receipt.checks.push('Real contextual Workspace Actions mode-only Structured/Fluid, checkpoint, App geometry edit, actual Undo/Redo/Restore, Find Vela/block and return retain canonical geometry/IDs/text');
    };
    await expression('Actual combined application ready', "typeof window.__aerynth.execute==='function'&&typeof window.__aerynth.setReduced==='function'&&document.body.dataset.applicationHydrated==='true'");
    if (restore) {
      const expected = JSON.parse(await fs.readFile(expectedFile, 'utf8')); assert.equal(expected.contract, 'aerynth.environments-checkpoint@1'); assert.equal(expected.initialPassed, true); assert.deepEqual(sourceIdentity(source), expected.source);
      assert.deepEqual(await canonical(), expected.canonical, 'Exact canonical projects/workspaces/resources/content/geometry/provider state survive same-source restart'); receipt.fixture = expected.fixture;
      await open(); await action(selector.search, 'input', expected.fixture.finalTitle); await expression('Renamed restored canonical workspace discoverable', `!!document.querySelector(${JSON.stringify(rowSelector(expected.fixture.workspaceId))})`); await capture('03-restart-navigator');
      await action(rowSelector(expected.fixture.workspaceId) + ' [data-action="open-workspace"]'); await expression('Restored exact workspace ID opened', `window.__aerynth.application().activeWorkspaceId===${JSON.stringify(expected.fixture.workspaceId)}`);
      assert.deepEqual(await canonical(), expected.canonical); receipt.checks.push('Same-source fresh-process restore and real navigator search/open preserve exact canonical state');
    } else {
      const empty = await desktop(); assert.equal(empty.projects.length, 0); assert.equal(empty.workspaces.length, 0); assert.equal(empty.resources.length, 0); assert.equal((empty.archivedWorkspaces ?? []).length, 0);
      const fixture = receipt.fixture = { projectTitle: 'Synthetic environment project', workspaceTitle: 'Synthetic project workspace', independentTitle: 'Synthetic independent workspace', finalTitle: 'Synthetic renamed environment', noteText: 'Synthetic persisted environment navigator preservation note. No provider request.' };
      if (record) { recorder = await bounded(require('./application-recording.cjs').startWindowRecording(win, session, localURL), Math.min(4000, slot.workRemaining()), 'environments_recording_start_deadline'); slot.check(); }
      await open(); await begin('create-project'); await action(selector.editor + ' input[name="title"]', 'input', fixture.projectTitle); await submit('project-create'); await settled();
      const project = (await desktop()).projects.find(p => p.title === fixture.projectTitle); assert(project); fixture.projectId = project.id;
      // A project create keeps the nonmodal navigator open; no forced reopen.
      await begin('create-workspace'); await action(selector.editor + ' input[name="title"]', 'input', fixture.workspaceTitle); await action(selector.editor + ' select[name="projectId"]', 'change', project.id); await submit('workspace-create');
      await wait('Project workspace persisted', async () => { const w = (await desktop()).workspaces.find(w => w.title === fixture.workspaceTitle && w.project_id === project.id); fixture.workspaceId = w?.id; return !!w; });
      fixture.independentId = await createWorkspace(fixture.independentTitle, null); receipt.checks.push('Real inline forms create project, associated workspace and independent workspace with canonical IDs');
      await searchOpen(fixture.workspaceId, fixture.workspaceTitle);
      await appCommand({ type: 'createResource', kind: 'note', title: 'Synthetic environment preservation note', workspaceId: fixture.workspaceId });
      const note = (await desktop()).resources.find(r => r.title === 'Synthetic environment preservation note'); assert(note); fixture.noteId = note.id;
      await appCommand({ type: 'content', resourceId: note.id, expectedVersion: note.version, content: fixture.noteText });
      await workspaceActions(fixture);
      const invariant = organizationInvariant(await canonical());
      await open(); await action(selector.search, 'input', '');
      const group = groupSelector(project.id), toggle = group + ' [data-action="toggle-project"]', projectName = group + ' [data-action="open-project"]';
      // The real keyboard listener changes disclosure without requiring a click
      // on the label, which independently navigates to the project overview.
      await js('window.__aerynth.setReduced(true)'); await action(projectName, 'keydown', 'ArrowLeft');
      await expression('Keyboard collapses real hierarchy', `document.querySelector(${JSON.stringify(projectName)})?.getAttribute('aria-expanded')==='false'`);
      await js('window.__aerynth.setReduced(false)'); const startReceipts = await js('window.__aerynth.snapshot().receipts');
      await action(toggle); let intermediate;
      await wait('Shared MC reveal has intermediate state', async () => { intermediate = await js(`Number.parseFloat(getComputedStyle(document.querySelector(${JSON.stringify(group)})).getPropertyValue('--en-reveal'))`); return intermediate > 0 && intermediate < 1; });
      await action(toggle); const retarget = await js('window.__aerynth.snapshot().receipts');
      assert(retarget.some(r => r.cause === 'environment group disclosure' && r.status === 'retargeted' && r.at >= (startReceipts.at(-1)?.at ?? 0)), 'shared_MC_interrupted_retarget_required');
      await expression('Interrupted hierarchy closes', `document.querySelector(${JSON.stringify(projectName)})?.getAttribute('aria-expanded')==='false'`);
      await js('window.__aerynth.setReduced(true)'); await action(toggle);
      const reduced = await js(`({reduced:window.__aerynth.snapshot().reduced,reveal:Number.parseFloat(getComputedStyle(document.querySelector(${JSON.stringify(group)})).getPropertyValue('--en-reveal')),expanded:document.querySelector(${JSON.stringify(projectName)}).getAttribute('aria-expanded')})`);
      assert.deepEqual(reduced, { reduced: true, reveal: 1, expanded: 'true' });
      receipt.motion = { intermediateReveal: intermediate, retargetReceipts: retarget.filter(r => r.cause === 'environment group disclosure').slice(-8), reduced, evidence: 'Shared Motion Coordinator callback/CSS state, not monitor presentation timing' };
      await js('window.__aerynth.setReduced(false)'); await capture('01-environments-hierarchy');
      await action(projectName); await expression('Project title opens canonical Constellation overview', `window.__aerynth.application().navigation.kind==='constellation'&&window.__aerynth.application().navigation.projectId===${JSON.stringify(project.id)}`);
      await searchOpen(fixture.workspaceId, fixture.workspaceTitle); assert.deepEqual(organizationInvariant(await canonical()), invariant);
      receipt.checks.push('Hierarchy keyboard/disclosure, MC intermediate/retarget/reduced policy, exact-ID search and project Constellation navigation');
      await open(); await action(selector.search, 'input', fixture.workspaceTitle); await more(fixture.workspaceId); await action(actionSelector('rename-workspace'));
      const stale = (await desktop()).workspaces.find(w => w.id === fixture.workspaceId); assert(stale);
      await action(selector.editor + ' input[name="title"]', 'input', 'Synthetic stale name must not win');
      await appCommand({ type: 'renameWorkspace', workspaceId: stale.id, expectedVersion: stale.version, title: fixture.workspaceTitle + ' concurrent' });
      await submit('workspace-rename'); await expression('Stale real form reports canonical CAS conflict', "document.querySelector('.en-status')?.dataset.state==='error'&&!document.querySelector('.en-editor').hidden");
      assert.equal((await desktop()).workspaces.find(w => w.id === stale.id).title, fixture.workspaceTitle + ' concurrent'); await action(actionSelector('cancel-editor'));
      await action(selector.search, 'input', fixture.workspaceTitle + ' concurrent'); await more(stale.id); await action(actionSelector('rename-workspace')); await action(selector.editor + ' input[name="title"]', 'input', fixture.finalTitle); await submit('workspace-rename'); await settled();
      const renamed = (await desktop()).workspaces.find(w => w.id === stale.id); assert.equal(renamed.title, fixture.finalTitle); assert.equal(renamed.version, stale.version + 2);
      await action(selector.search, 'input', fixture.finalTitle); await more(stale.id); await action(actionSelector('review-archive')); await submit('workspace-archive'); await settled();
      const archived = await desktop(); assert(!archived.workspaces.some(w => w.id === stale.id)); const saved = archived.archivedWorkspaces.find(w => w.id === stale.id); assert.equal(saved.version, renamed.version + 1);
      await action(actionSelector('toggle-archive')); await action(rowSelector(stale.id, true) + ' [data-action="review-restore"]'); await submit('workspace-restore'); await settled();
      const restored = (await desktop()).workspaces.find(w => w.id === stale.id); assert.equal(restored.title, fixture.finalTitle); assert.equal(restored.version, saved.version + 1);
      await action(rowSelector(stale.id) + ' [data-action="open-workspace"]'); await expression('Restored workspace returns', `window.__aerynth.application().activeWorkspaceId===${JSON.stringify(stale.id)}`);
      const final = await canonical(); assert.deepEqual(organizationInvariant(final), invariant, 'Organization must preserve exact resource IDs/content, placements/layout, history/provider state'); assert.equal(final.notes[fixture.noteId].resource.content, fixture.noteText);
      receipt.checks.push('Real stale-CAS form rejection, rename/archive/restore exact versions and invariant resources/content/geometry/history');
      pendingExpected = { contract: 'aerynth.environments-checkpoint@1', initialPassed: true, source: sourceIdentity(source), fixture, canonical: final };
    }
    assert.equal(startupErrors.length, 0); assert.equal(receipt.errors.length, 0); slot.check(); passed = true;
  };
  try { await Promise.race([run(), aborted]); }
  catch (error) { receipt.error = { message: String(error.message).slice(0, 1000), stack: String(error.stack).slice(0, 4000), ...(error.diagnostics ? { diagnostics: error.diagnostics } : {}) }; }
  finally {
    clearTimeout(workTimer); win.removeListener('blur', blur); win.removeListener('hide', blur); win.removeListener('minimize', blur); win.webContents.removeListener('before-input-event', escape); win.webContents.removeListener('console-message', consoleError);
    try {
      if (!owned) { console.log(JSON.stringify({ passed: false, error: receipt.error?.message, cleanup: 'Unowned profile/window rejected without writes or control' })); return receipt; }
      if (recorder) {
        try { receipt.video = await bounded(recorder.stop(path.join(out, passed ? 'environments.webm' : 'partial-environments.webm')), Math.min(2000, slot.remaining()), 'environments_recording_stop_deadline'); assert(receipt.video.byteCount > 0 && receipt.video.byteCount <= 32 * MiB && budget.videos === 0, 'environments_video_budget_exceeded'); budget.videos++; budget.videoBytes += receipt.video.byteCount; }
        catch (error) { passed = false; receipt.recordingError = String(error.message).slice(0, 1000); }
        recorder = null;
      }
      try { assert.equal(await bounded(call('close', {}), Math.min(1500, slot?.remaining() ?? 1500), 'environments_canonical_close_deadline'), null); receipt.nativeCloseConfirmed = true; }
      catch (error) { passed = false; receipt.nativeCloseError = String(error.message).slice(0, 1000); }
      receipt.appExitRequested = true; receipt.shutdownProof = 'Canonical close acknowledged; caller must independently verify actual process/window/backend exit';
      receipt.startupErrors = startupErrors.slice(0, 24); receipt.elapsedMs = performance.now() - moduleStartedMonotonicMs; receipt.slotFailure = slot?.failure() ?? null;
      receipt.passed = passed && receipt.nativeCloseConfirmed === true && !receipt.slotFailure && !receipt.errors.length && !startupErrors.length;
      if (admitted) {
        if (receipt.passed && pendingExpected) { const encoded = json(pendingExpected); assert(Buffer.byteLength(encoded) <= 2 * MiB, 'environments_checkpoint_capacity'); await fs.writeFile(expectedFile, encoded, { flag: 'wx' }); }
        validateBudget(budget); await fs.writeFile(budgetFile, json(budget)); const encoded = json(receipt); assert(Buffer.byteLength(encoded) <= 2 * MiB, 'environments_receipt_capacity'); await fs.writeFile(path.join(out, restore ? 'restore.json' : 'journey.json'), encoded, { flag: 'wx' });
      }
      console.log(JSON.stringify({ passed: receipt.passed, restore, evidence: admitted ? out : null, error: receipt.error?.message, captures: receipt.captures.length, elapsedMs: receipt.elapsedMs }));
    } catch (error) { receipt.passed = false; console.log(JSON.stringify({ passed: false, error: String(error.message).slice(0, 1000) })); }
    finally { clearTimeout(hardTimer); if (owned) app.exit(receipt.passed ? 0 : 1); }
  }
  return receipt;
};
