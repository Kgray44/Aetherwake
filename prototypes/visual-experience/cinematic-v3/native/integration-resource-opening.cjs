/* Actual Electron/renderer integration, NOT physical-input or model acceptance.
 * Host: verify({win,app,privateRoot,call,source,startupErrors?,session,localURL,
 *               moduleStartedMonotonicMs}) --integration-resource-opening
 * Optional --record-resource-opening; --verify-restore uses the SAME profile,
 * resource-opening-expected.json and exact original source/build identities.
 * Initial/restore global slots: 45s/12s, or 60s/30s for --verify-reply-note.
 * Combined evidence:
 * <=6 PNG/24MiB and one exact-window WebM/48MiB. Root's caller must confirm exit.
 * Requires production library.inspectWorkspace({workspaceId}) ->
 * {result:WorkspaceProjection}; no private-command or partial-layout fallback.
 * Launch only through the explicit owned fresh-profile Main verification flag. */
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createDriver } = require('./desktop-verify.cjs');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2);
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const sorted = values => [...values].sort((a, b) => String(a.id ?? a.resourceId).localeCompare(String(b.id ?? b.resourceId)));
const unplacedSelector = resourceId => `[data-key=${JSON.stringify('resource:unplaced:' + resourceId)}]`;
async function remainingRace(promise, milliseconds, error) {
  assert(milliseconds > 0, String(error)); let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(error instanceof Error ? error : Error(error)), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
/** Each observed condition is bounded independently of the single global slot.
 * A timeout never sends input, retries an action, or bypasses sticky focus loss. */
async function waitForCondition({ slot, label, check, diagnose, timeoutMs = 4000, now = () => performance.now(), sleep = pause }) {
  assert(timeoutMs > 0 && timeoutMs <= 4000, 'bounded_condition_required');
  const until = now() + Math.min(timeoutMs, slot.workRemaining()), timeout = Error('resource_opening_condition_timeout: ' + String(label).slice(0, 160));
  while (now() < until) {
    slot.check(); const available = Math.min(until - now(), slot.workRemaining()); if (available <= 0) break;
    try { const value = await remainingRace(Promise.resolve().then(check), available, timeout); slot.check(); if (value && now() < until) return value; }
    catch (error) { if (error !== timeout) throw error; break; }
    const remaining = Math.min(until - now(), slot.workRemaining()); if (remaining > 0) await sleep(Math.min(35, remaining));
  }
  slot.check();
  if (diagnose) {
    try { timeout.diagnostics = await remainingRace(Promise.resolve().then(diagnose), Math.min(300, slot.workRemaining()), 'condition_diagnostics_deadline'); slot.check(); }
    catch { slot.check(); timeout.diagnostics = { unavailable: true }; }
  }
  throw timeout;
}

function createSlot({ win, startedAt, limitMs, now = () => performance.now(), cleanupMs = 3500 }) {
  assert(Number.isFinite(startedAt) && startedAt <= now() && now() - startedAt < limitMs, 'valid_monotonic_slot_required');
  assert(limitMs > cleanupMs && limitMs <= 45000, 'bounded_slot_required');
  let failure = null;
  const abort = code => { failure ??= Error(code); return failure; };
  const check = () => {
    if (failure) throw failure;
    if (now() >= startedAt + limitMs - cleanupMs) throw abort('resource_opening_work_deadline');
    if (win.isDestroyed() || win.webContents.isDestroyed?.() || !win.isVisible() || win.isMinimized() || !win.isFocused()) throw abort('resource_opening_focus_lost');
  };
  return { check, abort, remaining: () => Math.max(0, startedAt + limitMs - now()), workRemaining: () => Math.max(0, startedAt + limitMs - cleanupMs - now()), failure: () => failure?.message ?? null };
}
function sourceIdentity(source) { assert(source?.hashes && Object.keys(source.hashes).length && source?.buildAssets && Object.keys(source.buildAssets).length, 'source_and_build_binding_required'); return { hashes: source.hashes, buildAssets: source.buildAssets }; }
/** Existing WorkspaceProjection, retained whole: no synthetic fallback layout. */
function assertWorkspaceProjection(workspace, value) {
  const revision = n => Number.isSafeInteger(n) && n > 0;
  const geometry = v => v && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(v[key])) && v.width > 0 && v.height > 0;
  assert(value?.contract === 'aetherwake.workspace/1' && value.workspaceId === workspace.id && value.projectId === workspace.project_id && value.title === workspace.title && value.workspaceVersion === workspace.version, 'canonical_workspace_identity_required');
  assert(typeof value.layoutId === 'string' && value.layoutId && revision(value.revision), 'canonical_layout_revision_required');
  assert(value.viewport && ['x', 'y', 'zoom'].every(key => Number.isFinite(value.viewport[key])) && value.viewport.zoom > 0, 'canonical_viewport_required');
  assert(value.organization?.schemaVersion === 1 && revision(value.organization.revision) && ['fluid', 'freeform', 'structured'].includes(value.organization.mode) && value.organization.structured, 'canonical_organization_required');
  assert(value.presence?.id === 'system:vela' && value.presence.workspaceId === workspace.id && revision(value.presence.version) && geometry(value.presence), 'canonical_presence_required');
  assert(Array.isArray(value.blocks) && value.blocks.length <= 128 && new Set(value.blocks.map(block => block.blockId)).size === value.blocks.length && value.blocks.every(block => typeof block.blockId === 'string' && block.workspaceId === workspace.id && revision(block.version) && geometry(block) && Number.isFinite(block.zIndex) && Number.isFinite(block.rotation) && typeof block.shape === 'string' && typeof block.locked === 'boolean' && typeof block.minimized === 'boolean'), 'canonical_placement_presentation_required');
  assert(typeof value.canUndo === 'boolean' && typeof value.canRedo === 'boolean', 'canonical_layout_history_required');
  return value;
}
/** Camera/navigation are checked separately around direct opening, not erased. */
function canonicalProjection({ desktop, core, layouts, collections, notes, chats, draft, vela }) {
  for (const key of ['projects', 'workspaces', 'resources', 'blocks']) assert(Array.isArray(desktop[key]), 'canonical_desktop_projection_required');
  for (const key of ['graph', 'resourceMap', 'bindings', 'executions', 'handoffs', 'messageEvidence']) assert(core[key] && typeof core[key] === 'object', 'canonical_core_projection_required');
  assert(Array.isArray(core.conversations) && Array.isArray(core.resources) && Array.isArray(collections), 'canonical_history_and_collections_required');
  return stable({ projects: sorted(desktop.projects), workspaces: sorted(desktop.workspaces), archivedWorkspaces: sorted(desktop.archivedWorkspaces ?? []), resources: sorted(desktop.resources), placements: sorted(desktop.navigationBlocks ?? desktop.blocks), relationships: sorted(desktop.relationships),
    graph: core.graph, conversations: core.conversations, resourceMap: core.resourceMap, resourcesCanonical: core.resources, bindings: core.bindings, executions: core.executions, handoffs: core.handoffs, messageEvidence: core.messageEvidence,
    layouts, collections, notes, chats, draft, vela: { requests: vela.requests, plans: vela.plans, receipts: vela.receipts, preferences: vela.preferences, presentation: vela.presentation } });
}
function targetScript(selector, action, value) {
  return `(${function (selector, action, value) {
    const node = document.querySelector(selector); if (!node || node.disabled || node.closest('[hidden],[inert]')) return { unavailable: true };
    let opacity = 1; for (let e = node; e; e = e.parentElement) { const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden') return { unavailable: true }; opacity *= Number(s.opacity); }
    const r = node.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
    if (opacity < .99 || r.width <= 0 || r.height <= 0 || x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return { unavailable: true };
    const hit = document.elementFromPoint(x, y); if (!hit || !node.contains(hit)) return { occluded: true };
    if (action === 'click') node.click();
    else if (action === 'input') { node.value = value; node.dispatchEvent(new Event('input', { bubbles: true })); }
    return { ready: true, rect: { x: r.x, y: r.y, width: r.width, height: r.height } };
  }.toString()})(${JSON.stringify(selector)},${JSON.stringify(action)},${JSON.stringify(value)})`;
}
exports.createSlot = createSlot; exports.canonicalProjection = canonicalProjection; exports.sourceIdentity = sourceIdentity; exports.targetScript = targetScript; exports.unplacedSelector = unplacedSelector; exports.waitForCondition = waitForCondition; exports.assertWorkspaceProjection = assertWorkspaceProjection;

exports.verify = async function verify({ win, app, privateRoot, call, source, startupErrors = [], session, localURL, moduleStartedMonotonicMs }) {
  const restore = process.argv.includes('--verify-restore'), replyNote = process.argv.includes('--verify-reply-note'), limitMs = restore ? (replyNote ? 30000 : 12000) : (replyNote ? 60000 : 45000), started = performance.now(), root = path.resolve(privateRoot), out = path.join(root, 'resource-opening-evidence', (restore ? 'restore-' : 'initial-') + Date.now());
  const expectedFile = path.join(root, 'resource-opening-expected.json'), budgetFile = path.join(root, 'resource-opening-capture-budget.json');
  const receipt = { contract: 'aerynth.resource-opening-integration@1', source, passed: false, restore, syntheticOnly: true, inputMethod: 'Renderer integration: actual visible DOM click/input handlers and application capabilities; no OS mouse/keyboard input', limits: { milliseconds: limitMs, combinedPNGs: 6, combinedPNGBytes: 24 * 1024 * 1024, combinedVideos: 1, videoBytes: 48 * 1024 * 1024 }, actions: [], checks: [], captures: [], errors: [], coverage: {}, limitations: ['No physical input, live model, sign-in, multiuser revocation, artistic or production qualification.', 'F covers the real Vela source-search Open control; natural-language interpretation is untested.', 'Fresh positive GPU draw acknowledgement is not monitor-presentation or performance acceptance.'] };
  let slot, driver, recorder, budget = { count: 0, bytes: 0, videos: 0, files: [] }, pendingExpected, runPassed = false, owned = false, admitted = false, hardTimer, workTimer, abortReject;
  const abortPromise = new Promise((_, reject) => { abortReject = reject; }); abortPromise.catch(() => {});
  const abort = code => { const error = slot?.abort(code) ?? Error(code); abortReject(error); };
  const blur = () => abort('resource_opening_focus_lost');
  const escape = (_event, input) => { if (input?.type === 'keyDown' && input.key === 'Escape') abort('resource_opening_operator_escape'); };
  const consoleError = (_event, details) => { if (details?.level === 'error' || details?.level === 3) { if (receipt.errors.length < 24) receipt.errors.push(String(details.message).slice(0, 1000)); } };
  const run = async () => {
    assert(path.isAbsolute(privateRoot) && /^review-resource-opening-\d+$/.test(path.basename(root)) && path.parse(root).root.toLowerCase() === 'c:\\', 'fresh_owned_resource_profile_required');
    sourceIdentity(source); assert.match(win.getTitle(), /Automated check/i, 'owned_automated_window_required');
    assert(process.argv.includes('--integration-resource-opening'), 'explicit_resource_verification_flag_required'); owned = true;
    slot = createSlot({ win, startedAt: moduleStartedMonotonicMs, limitMs, cleanupMs: restore ? 2500 : 3500 }); slot.check();
    hardTimer = setTimeout(() => { receipt.hardDeadline = true; abort('resource_opening_hard_deadline'); app.exit(1); }, slot.remaining());
    workTimer = setTimeout(() => abort('resource_opening_work_deadline'), slot.workRemaining());
    win.on('blur', blur); win.on('hide', blur); win.on('minimize', blur); win.webContents.on('before-input-event', escape); win.webContents.on('console-message', consoleError);
    const guardFile = path.join(process.env.LOCALAPPDATA || '', 'AeroStorageWatch', 'ReserveGuard.ps1');
    const guard = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-File', guardFile, '-EstimatedCBytes', String(160 * 1024 * 1024), '-EstimatedDBytes', '0'], { windowsHide: true, timeout: Math.min(10000, slot.workRemaining()), maxBuffer: 8192, encoding: 'utf8' })); assert.equal(guard.allowed, true, 'storage_reserve_denied'); receipt.reserve = guard; admitted = true; slot.check();
    if (!restore) { await assert.rejects(fs.stat(expectedFile), { code: 'ENOENT' }); await assert.rejects(fs.stat(budgetFile), { code: 'ENOENT' }); }
    else { budget = JSON.parse(await fs.readFile(budgetFile, 'utf8')); assert(Number.isSafeInteger(budget.count) && budget.count >= 0 && budget.count <= 4 && Number.isSafeInteger(budget.bytes) && budget.bytes >= 0 && budget.bytes <= receipt.limits.combinedPNGBytes && budget.videos <= 1 && Array.isArray(budget.files), 'invalid_combined_evidence_budget'); }
    await fs.mkdir(out, { recursive: true });
    driver = await remainingRace(createDriver(win, { assertActive: () => slot.check() }), Math.min(4000, slot.workRemaining()), 'resource_opening_driver_ready_deadline');
    const connection = await remainingRace(driver.js("window.aerynthHost.command('providerConnection',{type:'status',providerId:'chatgpt-plan-responses'})"), Math.min(4000, slot.workRemaining()), 'native_connection_status_deadline');
    assert.equal(connection.contract, 'aerynth.provider-connection@1');
    assert.equal(connection.storageAvailable, true, 'Actual native protected-storage hop must be available');
    assert.equal(connection.state, 'disconnected', 'Fresh synthetic profile must not contain an account');
    assert.equal(connection.nativeAccountHistory, false);
    assert.equal(connection.nativeAccountMemory, false);
    assert.equal(connection.nativeAccountSync, false);
    receipt.checks.push('Actual renderer/Main/desktop/worker/Core/native-secret status hop; OS protection available, no account or inference');
    const js = code => { slot.check(); return remainingRace(driver.js(code), slot.workRemaining(), 'resource_opening_renderer_deadline'); };
    const rpc = async (name, input) => { slot.check(); const value = await remainingRace(call(name, input), slot.workRemaining(), 'resource_opening_backend_deadline'); slot.check(); return value; };
    const diagnose = () => js("(()=>{const a=window.__aerynth?.application?.(),s=window.__aerynth?.snapshot?.(),where=s?.spatial?.location??a?.navigation;return{status:(document.querySelector('#status')?.textContent??'').slice(0,240),location:where?{kind:where.kind,projectId:where.projectId,workspaceId:where.workspaceId,blockId:where.blockId}:null,anchors:[...document.querySelectorAll('.aw-anchor[data-key]')].slice(0,16).map(e=>({key:e.dataset.key.slice(0,160),label:(e.querySelector('strong')?.textContent??'').slice(0,80),visible:!!e.getClientRects().length&&!e.closest('[hidden],[inert]')&&getComputedStyle(e).visibility!=='hidden'}))}})()");
    const wait = async (label, check) => { receipt.phase = label; try { return await waitForCondition({ slot, label, check, diagnose }); } catch (error) { if (error.diagnostics) receipt.conditionFailure = { label, diagnostics: error.diagnostics }; throw error; } };
    const expression = (label, code) => wait(label, () => js(`(()=>{try{return (${code})}catch{return false}})()`));
    const action = async (selector, kind = 'click', value) => {
      await wait('Visible renderer target ' + selector, async () => {
        const result = await js(targetScript(selector, kind, value));
        assert(result && typeof result === 'object', 'renderer_action_outcome_unknown');
        return result.ready === true;
      }); receipt.actions.push({ method: 'renderer-DOM-' + kind, selector, ...(kind === 'input' ? { characters: value.length } : {}) }); };
    const application = async input => { receipt.actions.push({ method: 'application-capability-fixture', type: input.type }); return js(`window.__aerynth.execute(${JSON.stringify(input)})`); };
    const open = async (resourceId, extra = {}) => { receipt.actions.push({ method: 'application-openResource', resourceId, ...extra }); const result = await js(`window.__aerynth.openResource(${JSON.stringify({ resourceId, ...extra })})`); assert.equal(result.resourceId, resourceId); return result; };
    const flush = () => js('window.__aerynth.flush()');
    const flushEditor = async selector => {
      const value = await js(`(async()=>{const selector=${JSON.stringify(selector)},editor=document.querySelector(selector);if(!editor)return{missing:true};const observe=e=>({value:e.value,start:e.selectionStart,end:e.selectionEnd,direction:e.selectionDirection,top:e.scrollTop,left:e.scrollLeft}),before=observe(editor);await window.__aerynth.flush();const current=document.querySelector(selector);return{retained:current===editor,before,after:current?observe(current):null}})()`);
      assert.equal(value.retained, true, 'Save flush replaced the real editor'); assert.deepEqual(value.after, value.before, 'Save flush changed editor content/caret/scroll'); receipt.checks.push('Actual editor/caret/scroll retained across canonical flush: ' + selector);
    };
    const desktop = () => rpc('desktop', { type: 'snapshot' });
    const chat = resourceId => rpc('conversation', { name: 'detail', input: { resourceId, limit: 50 } });
    const note = async resourceId => (await rpc('notes', { name: 'readNote', input: resourceId })).result;
    const directSelector = id => `.application-direct-resource[data-resource-id="${id}"]`;
    const waitNote = id => expression('Actual direct Note session', `(()=>{const r=document.querySelector(${JSON.stringify(directSelector(id))});return r?.querySelector('.aw-direct-editor')&&!r.querySelector('.aw-direct-editor').disabled&&['ready','saved','recovered'].includes(r.querySelector('[data-note-state]')?.dataset.noteState)})()`);
    const close = async id => { const selector = `[data-surface-id="${id}"]`; const control = id === 'conversations' ? ' .cp-header-actions [data-cp-control="close"]' : ' .aw-contextual-dismiss'; await action(selector + control); await expression('Surface closes after actual flush', `!document.querySelector(${JSON.stringify(selector)})`); };
    const canonical = async () => {
      const d = await desktop(), core = await rpc('snapshot', {}), layouts = {};
      assert.equal(Object.keys(core.executions).length, 0, 'No provider execution authorized'); assert.equal(Object.keys(core.handoffs).length, 0, 'No delegated handoff authorized');
      assert(d.resources.length <= 16 && d.workspaces.length <= 4, 'bounded_synthetic_fixture_required');
      for (const workspace of d.workspaces) {
        const inspection = await rpc('library', { name: 'inspectWorkspace', input: { workspaceId: workspace.id } });
        layouts[workspace.id] = assertWorkspaceProjection(workspace, inspection.result);
      }
      const notes = {}, chats = {}, draft = {};
      for (const resource of d.resources) if (resource.available !== false && resource.state !== 'archived') {
        if (resource.kind === 'note') notes[resource.id] = await note(resource.id);
        if (resource.kind === 'conversation') { const value = await chat(resource.id); chats[resource.id] = { conversation: value.conversation, messages: value.messages, lineage: value.lineage, policy: value.policy, shares: value.shares }; draft[resource.id] = await rpc('conversation', { name: 'readDraft', input: { resourceId: resource.id } }); }
      }
      const collections = await rpc('conversation', { name: 'collections', input: {} }), vela = await rpc('vela', { name: 'state', input: {} });
      assert.equal(vela.requests.length, 0); assert.equal(vela.plans.length, 0); assert.equal(vela.receipts.length, 0);
      return { projection: canonicalProjection({ desktop: d, core, layouts, collections, notes, chats, draft, vela }), desktop: d };
    };
    const viewOnly = async (label, work, navigation = true) => { const before = await canonical(); await work(); await flush(); const after = await canonical(); assert.deepEqual(after.projection, before.projection, label + ': canonical identities/content/layouts/history/provider state changed'); if (navigation) for (const key of ['navigation', 'history', 'activeWorkspaceId', 'viewport', 'layoutVersion']) assert.deepEqual(after.desktop[key], before.desktop[key], label + ': navigation context changed'); receipt.checks.push(label); return after; };
    const graphics = () => js("(()=>{const s=window.__aerynth.snapshot();return {active:s.active,failed:s.graphicsFailed,errors:s.metrics.errors,draws:s.metrics.draws,frames:s.gpu?.framesRendered,contextLost:s.gpu?.contextLost}})()");
    const capture = async (label, selector, prior) => {
      receipt.phase = 'Capture ' + label; const before = prior ?? await graphics(); let last, stableFrames = 0;
      await wait('Stable visible surface and fresh GPU draw', async () => {
        const bounds = await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.closest('[hidden]'))return null;let opacity=1;for(let n=e;n;n=n.parentElement){const s=getComputedStyle(n);if(s.display==='none'||s.visibility==='hidden')return null;opacity*=Number(s.opacity);}const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,opacity,inBounds:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight}})()`), current = await graphics(); receipt.lastCaptureSample = { bounds, before, current };
        stableFrames = bounds?.opacity >= .995 && bounds.inBounds && last && ['x','y','width','height'].every(key => Math.abs(bounds[key] - last[key]) < .75) ? stableFrames + 1 : 0; last = bounds;
        const healthy = value => value.active === true && value.failed === false && value.contextLost === false && Array.isArray(value.errors) && value.errors.length === 0 && Number.isFinite(value.draws) && Number.isFinite(value.frames);
        return stableFrames >= 2 && healthy(before) && healthy(current) && current.draws > before.draws && current.frames > before.frames;
      });
      slot.check(); const png = (await remainingRace(win.webContents.capturePage(), slot.workRemaining(), 'capture_deadline')).toPNG(); slot.check(); assert(budget.count < 6 && png.length > 0 && budget.bytes + png.length <= 24 * 1024 * 1024, 'combined_capture_budget_exceeded');
      const file = path.join(out, label + '.png'); await fs.writeFile(file, png, { flag: 'wx' }); const item = { file, bytes: png.length, sha256: hash(png), evidence: 'Actual owned Electron window; renderer-handler input', ...receipt.lastCaptureSample }; budget.count++; budget.bytes += png.length; budget.files.push(item); receipt.captures.push(item); await fs.writeFile(budgetFile, json(budget));
    };
    await expression('Real application capabilities ready', "typeof window.__aerynth.openResource==='function'&&document.body.dataset.applicationHydrated==='true'");
    if (restore) {
      const expected = JSON.parse(await fs.readFile(expectedFile, 'utf8')); assert.equal(expected.contract, 'aerynth.resource-opening-checkpoint@1'); assert.equal(expected.initialPassed, true); assert.deepEqual(sourceIdentity(source), expected.source);
      assert.equal(!!expected.fixture.replyNoteId, replyNote, 'reply_note_scope_mismatch');
      const current = await canonical(); assert.deepEqual(current.projection, expected.canonical); receipt.fixture = expected.fixture;
      await viewOnly('A/restart exact Note identity/content', async () => { const prior = await graphics(); assert.equal((await open(expected.fixture.noteId)).status, 'ready'); await waitNote(expected.fixture.noteId); assert.equal(await js(`document.querySelector(${JSON.stringify(directSelector(expected.fixture.noteId) + ' .aw-direct-editor')}).value`), expected.fixture.noteText); await capture('05-restart-note', directSelector(expected.fixture.noteId), prior); await close('canonical-resource'); });
      await viewOnly('C/restart exact local transcript/draft', async () => { const prior = await graphics(); assert.equal((await open(expected.fixture.chatId)).status, 'ready'); await expression('Actual saved chat draft', `document.querySelector('.cp-chat[data-resource-id="${expected.fixture.chatId}"] .cp-composer textarea')?.value===${JSON.stringify(expected.fixture.chatDraft)}`); await capture('06-restart-chat', '.cp-manager', prior); await close('conversations'); });
      if (expected.fixture.replyNoteId) {
        assert.equal((await open(expected.fixture.replyNoteId)).status, 'ready');
        await waitNote(expected.fixture.replyNoteId);
        assert.equal((await note(expected.fixture.replyNoteId)).resource.content, expected.fixture.editedReplyNote);
        await close('canonical-resource');
        receipt.checks.push('Edited reply note reopened after restart with the same canonical ID');
        assert.equal(current.desktop.activeWorkspaceId, expected.fixture.replyWorkspaceId);
        const placements = current.desktop.blocks.filter(block => block.resource_id === expected.fixture.replyNoteId);
        assert.deepEqual(placements.map(block => [block.id, block.workspace_id]), [
          [expected.fixture.replyBlockId, expected.fixture.replyWorkspaceId],
        ]);
        const card = `[data-block="${expected.fixture.replyBlockId}"]`;
        await action(card + ' .unfold');
        const editor = card + ' .working-content textarea';
        await expression('Restored workspace Note has the exact saved edit',
          `document.querySelector(${JSON.stringify(editor)})?.value===${JSON.stringify(expected.fixture.editedReplyNote)}`);
        receipt.checks.push('The same placed note and edit survived a fresh process');
      }
      receipt.checks.push('same-source fresh-process canonical restore, zero new executions/grants/handoffs');
    } else {
      const initial = await desktop(); assert.equal(initial.projects.length, 0); assert.equal(initial.workspaces.length, 0); assert.equal(initial.resources.length, 0, 'Only a fresh empty synthetic profile is authorized');
      // Explicit assistant initialization is a fixture mutation, never concealed
      // inside a subsequent view-only Open check.
      await rpc('vela', { name: 'open', input: {} }); receipt.actions.push({ method: 'canonical-fixture-initialize-Vela', provider: 'none' });
      const fixture = receipt.fixture = { noteText: 'Synthetic independent Note. Same canonical identity across direct and workspace views.', chatMessage: 'Synthetic local recording only; no model response requested.', chatDraft: 'Synthetic unsent draft retained across a real restart.' };
      if (process.argv.includes('--record-resource-opening')) { assert.equal(budget.videos, 0); recorder = await require('./application-recording.cjs').startWindowRecording(win, session, localURL); slot.check(); }
      // A: the actual visible zero-workspace Resources/New note handlers.
      await action('#application-resources'); await action('.aw-context-create > summary'); await action('#standalone-note');
      await wait('Unplaced Note created', async () => { const d = await desktop(), value = d.resources.find(resource => resource.kind === 'note'); if (value) fixture.noteId = value.id; return !!value; }); await waitNote(fixture.noteId);
      await action(directSelector(fixture.noteId) + ' .aw-direct-editor', 'input', fixture.noteText); await flushEditor(directSelector(fixture.noteId) + ' .aw-direct-editor'); assert.equal((await note(fixture.noteId)).resource.content, fixture.noteText); await close('canonical-resource');
      await viewOnly('A/Resources Open creates no workspace or placement', async () => { const prior = await graphics(); await action('#application-resources'); await action(`[data-open-resource="${fixture.noteId}"]`); await waitNote(fixture.noteId); await capture('01-unplaced-note', directSelector(fixture.noteId), prior); await close('canonical-resource'); });
      let d = await desktop(); assert.equal(d.workspaces.length, 0); assert.equal(d.projects.length, 0); assert.equal(d.blocks.length, 0);
      // B: actual Constellation selected-resource Open command; unchanged camera/nav.
      const unplaced = unplacedSelector(fixture.noteId);
      await expression('Unplaced Constellation label', `!!document.querySelector(${JSON.stringify(unplaced)})`); await action(unplaced); await action('.aw-constellation-bar button[aria-label="Commands and destinations"]'); await action('.aw-destinations input', 'input', 'Open destination');
      const camera = await js('window.__aerynth.snapshot().spatial.camera');
      await viewOnly('B/Constellation Open preserves exact prior camera and canonical navigation', async () => { const prior = await graphics(); await action('.aw-command-row[data-command="open"]'); await waitNote(fixture.noteId); await capture('02-constellation-direct-note', directSelector(fixture.noteId), prior); await close('canonical-resource'); assert.deepEqual(await js('window.__aerynth.snapshot().spatial.camera'), camera); });
      // C: real default local chat, one recorded user message, then durable unsent draft.
      const chatDraw = await graphics(); await action('#application-new-chat'); await wait('Actual new local conversation', async () => { const value = await js("document.querySelector('.cp-chat')?.dataset.resourceId"); if (value) fixture.chatId = value; return !!value; });
      assert.equal((await chat(fixture.chatId)).conversation.providerId, 'local'); await action('.cp-composer textarea', 'input', fixture.chatMessage); await action('.cp-composer button[type="submit"]'); await wait('Local message durably recorded', async () => (await chat(fixture.chatId)).messages.items.some(message => message.role === 'user' && message.content === fixture.chatMessage));
      if (replyNote) {
        fixture.replyText = 'Synthetic assistant reply for editable artifact acceptance.';
        fixture.editedReplyNote = fixture.replyText + ' Edited in the native note.';
        const detail = await chat(fixture.chatId);
        const reply = await rpc('addMessage', { resourceId: fixture.chatId, role: 'assistant', content: fixture.replyText, expectedRevision: detail.conversation.revision });
        receipt.actions.push({ method: 'canonical-fixture-add-assistant-reply', provider: 'none' });
        await action('[data-surface-id="conversations"] .cp-header-actions [data-cp-control="close"]');
        await expression('Chat closes before canonical reopen', '!document.querySelector(\'[data-surface-id="conversations"]\')');
        assert.equal((await open(fixture.chatId, { selection: { messageId: reply.id } })).status, 'ready');
        const message = `[data-message-id=${JSON.stringify(reply.id)}]`;
        const hover = await wait('Assistant reply body is visible for pointer reveal', async () => {
          const result = await js(targetScript(message + ' .cp-message-content', 'inspect'));
          return result.ready && result.rect;
        });
        slot.check();
        win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(hover.x + hover.width / 2), y: Math.round(hover.y + hover.height / 2) });
        receipt.actions.push({ method: 'software-native-window-mouse-move', selector: message + ' .cp-message-content' });
        const summarySelector = message + ' .cp-message-actions > summary';
        const summary = await wait('Message action summary can receive native click', async () => {
          const result = await js(targetScript(summarySelector, 'inspect'));
          return result.ready && result.rect;
        });
        const point = { x: Math.round(summary.x + summary.width / 2), y: Math.round(summary.y + summary.height / 2) };
        slot.check();
        win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
        win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
        await expression('Native message menu open and focused', `(()=>{const n=document.querySelector(${JSON.stringify(summarySelector)});return n?.parentElement.open&&document.activeElement===n})()`);
        for (let i = 0; i < 3; i++) {
          slot.check();
          for (const type of ['keyDown', 'keyUp']) win.webContents.sendInputEvent({ type, keyCode: 'Tab' });
        }
        await expression('Save reply control reached by keyboard', `document.activeElement===document.querySelector(${JSON.stringify(message + ' [data-reply-note]')})`);
        receipt.actions.push({ method: 'software-native-window-menu-keyboard', selector: message + ' [data-reply-note]' });
        const activateReplyAction = async () => {
          await expression('Reply action focused and enabled', `(()=>{const n=document.querySelector(${JSON.stringify(message + ' [data-reply-note]')});return n&&document.activeElement===n&&!n.disabled})()`);
          slot.check();
          assert.equal(await js(`(()=>{const n=document.querySelector(${JSON.stringify(message + ' [data-reply-note]')});if(!n||document.activeElement!==n||n.disabled)return false;n.click();return true})()`), true);
        };
        await activateReplyAction();
        await wait('Exact reply copied into one canonical note', async () => {
          const status = await js("document.querySelector('.cp-chat-status')?.textContent");
          if (status?.includes('could not be confirmed')) throw Error('reply_note_save_unconfirmed');
          const matches = (await desktop()).resources.filter(resource => resource.kind === 'note' && resource.title === 'Saved chat reply');
          if (matches.length !== 1) return false;
          fixture.replyNoteId = matches[0].id;
          return (await note(fixture.replyNoteId)).resource.content === fixture.replyText;
        });
        await expression('Saved reply action can open the note', `document.querySelector(${JSON.stringify(message + ' [data-reply-note]')})?.textContent.includes('Open saved note')`);
        assert.equal(await js(`(()=>{const n=document.querySelector(${JSON.stringify(message + ' [data-reply-note]')});if(!n||n.disabled||!n.closest('details')?.open||!n.textContent.includes('Open saved note'))return false;n.click();return true})()`), true);
        await waitNote(fixture.replyNoteId);
        const editor = directSelector(fixture.replyNoteId) + ' .aw-direct-editor';
        await action(editor, 'input', fixture.editedReplyNote);
        await flushEditor(editor);
        assert.equal((await note(fixture.replyNoteId)).resource.content, fixture.editedReplyNote);
        await close('canonical-resource');
        if (!await js("!!document.querySelector('.cp-composer textarea')")) assert.equal((await open(fixture.chatId)).status, 'ready');
        receipt.checks.push('Visible reply action created and opened one editable canonical note');
      }
      await action('.cp-composer textarea', 'input', fixture.chatDraft); await flushEditor('.cp-composer textarea'); assert.equal((await rpc('conversation', { name: 'readDraft', input: { resourceId: fixture.chatId } })).content, fixture.chatDraft); await capture('03-local-chat-draft', '.cp-manager', chatDraw); await close('conversations'); d = await desktop(); assert.equal(d.workspaces.length, 0); assert.equal(d.projects.length, 0);
      if (replyNote) {
        await application({ type: 'createWorkspace', title: 'Synthetic reply-note workspace', projectId: null });
        fixture.replyWorkspaceId = (await desktop()).activeWorkspaceId;
        assert(fixture.replyWorkspaceId, 'reply_note_workspace_required');
        assert.equal((await open(fixture.replyNoteId)).status, 'ready');
        await waitNote(fixture.replyNoteId);
        const placement = directSelector(fixture.replyNoteId) + ' .aw-note-placement';
        await action(placement);
        await wait('The visible Add note action placed the exact saved note once', async () => {
          const snapshot = await desktop();
          const blocks = snapshot.blocks.filter(block => block.resource_id === fixture.replyNoteId);
          assert(blocks.length <= 1, 'duplicate_reply_note_placement');
          if (!blocks.length) return false;
          assert.equal(blocks[0].workspace_id, fixture.replyWorkspaceId);
          fixture.replyBlockId = blocks[0].id;
          return true;
        });
        await expression('The placement control hides while the same note editor remains open',
          `document.querySelector(${JSON.stringify(placement)})?.hidden===true &&
            document.querySelector(${JSON.stringify(directSelector(fixture.replyNoteId) + ' .aw-direct-editor')})?.value===
            ${JSON.stringify(fixture.editedReplyNote)}`);
        await close('canonical-resource');
        receipt.checks.push('The visible action placed the saved reply without creating another note');
        const final = await canonical();
        pendingExpected = { contract: 'aerynth.resource-opening-checkpoint@1', initialPassed: true, source: sourceIdentity(source), fixture, canonical: final.projection };
        assert.equal(startupErrors.length, 0, 'startup_console_error');
        assert.equal(receipt.errors.length, 0, 'renderer_console_error');
        slot.check();
        receipt.coverage = { A: true, B: true, C: true, replyNote: true, replyNotePlacement: true };
        runPassed = true;
        return;
      }
      // F: actual Vela source-search Open handler, explicitly NOT NL/model proof.
      await viewOnly('F/Vela source Open uses the same canonical unplaced resource', async () => { await action('#vela'); await action('.vela-core-compose-actions button[aria-label="Add sources"]'); await action('.vela-core-search input', 'input', 'Untitled note'); await action('.vela-core-search button[type="submit"]'); await expression('Vela resource search result', `!![...document.querySelectorAll('.vela-core-result')].find(row=>row.textContent.includes('Untitled note'))?.querySelector('button')`); await action('.vela-core-result button'); await waitNote(fixture.noteId); await close('canonical-resource'); });
      // D: explicit fixture organization; subsequent Open operations are read-only.
      await application({ type: 'createWorkspace', title: 'Synthetic shared workspace one', projectId: null }); fixture.workspaceIds = [(await desktop()).activeWorkspaceId]; await application({ type: 'createWorkspace', title: 'Synthetic shared workspace two', projectId: null }); fixture.workspaceIds.push((await desktop()).activeWorkspaceId);
      for (const workspaceId of fixture.workspaceIds) await application({ type: 'attach', workspaceId, resourceId: fixture.noteId });
      fixture.blockIds = [];
      for (const [index, workspaceId] of fixture.workspaceIds.entries()) {
        // Explicit navigation is fixture intent. The actual card's unfold/read
        // is checked separately; default direct Open never gets this exception.
        await application({ type: 'navigate', target: { kind: 'workspace', workspaceId } });
        const current = await desktop(); assert.equal(current.activeWorkspaceId, workspaceId); assert.deepEqual(current.navigation, { kind: 'workspace', workspaceId });
        const block = current.blocks.find(block => block.resource_id === fixture.noteId); assert(block); fixture.blockIds.push(block.id);
        await viewOnly('D/actual workspace card reads the same canonical Note ' + index, async () => {
          const prior = await graphics(); await action(`[data-block="${block.id}"] .unfold`); const editor = `[data-block="${block.id}"] .working-content textarea`;
          await wait('Actual focused workspace Note editor is usable', async () => (await js(targetScript(editor, 'inspect'))).ready);
          await expression('Existing placement shows canonical content', `document.querySelector(${JSON.stringify(editor)})?.value===${JSON.stringify(fixture.noteText)}`);
          if (index === 1) await capture('04-shared-canonical-note', `[data-block="${block.id}"]`, prior);
          await js('window.__aerynth.home()');
        });
      }
      await viewOnly('D/direct Open shares the exact two-placement canonical Note', async () => { assert.equal((await open(fixture.noteId)).status, 'ready'); await waitNote(fixture.noteId); assert.equal(await js(`document.querySelector(${JSON.stringify(directSelector(fixture.noteId) + ' .aw-direct-editor')}).value`), fixture.noteText); await close('canonical-resource'); });
      // E/G: canonical explicit synthetic fixture mutations, not hidden Open effects.
      await application({ type: 'createResource', kind: 'note', title: 'Synthetic detached-only Note', workspaceId: fixture.workspaceIds[1] }); d = await desktop(); fixture.detachedId = d.resources.find(resource => resource.title === 'Synthetic detached-only Note').id; const placed = d.blocks.find(block => block.resource_id === fixture.detachedId); assert(placed); await application({ type: 'detach', blockId: placed.id, expectedVersion: placed.version });
      await viewOnly('E/removing the only placement preserves direct opening', async () => { assert.equal((await open(fixture.detachedId)).status, 'ready'); await waitNote(fixture.detachedId); await close('canonical-resource'); });
      await application({ type: 'createResource', kind: 'note', title: 'Synthetic actually unavailable Note', workspaceId: null }); d = await desktop(); const unavailable = d.resources.find(resource => resource.title === 'Synthetic actually unavailable Note'); fixture.unavailableId = unavailable.id; await application({ type: 'archiveSubject', kind: 'resource', id: unavailable.id, expectedVersion: unavailable.version, archived: true });
      await viewOnly('G/real archived resource is unavailable without bypass or placeholder editor', async () => { const result = await rpc('openResource', { resourceId: unavailable.id }); assert.equal(result.status, 'unavailable'); assert.equal((await open(unavailable.id)).status, 'unavailable'); await expression('Truthful unavailable application status', "document.querySelector('#status').textContent.toLowerCase().includes('unavailable')"); assert.equal(await js(`!!document.querySelector(${JSON.stringify(directSelector(unavailable.id))})`), false); });
      for (let repeat = 0; repeat < 2; repeat++) await viewOnly('H/repeated Open/close has no canonical mutations ' + repeat, async () => { await open(fixture.noteId); await waitNote(fixture.noteId); await close('canonical-resource'); });
      await flush(); const final = await canonical(); assert.equal(final.desktop.projects.length, 0); assert.equal(final.desktop.workspaces.length, 2); assert.equal(final.projection.chats[fixture.chatId].conversation.providerId, 'local'); assert.deepEqual(final.projection.chats[fixture.chatId].messages.items.map(message => [message.role, message.content]), [['user', fixture.chatMessage], ...(fixture.replyText ? [['assistant', fixture.replyText]] : [])]); assert.equal(final.projection.draft[fixture.chatId].content, fixture.chatDraft);
      pendingExpected = { contract: 'aerynth.resource-opening-checkpoint@1', initialPassed: true, source: sourceIdentity(source), fixture, canonical: final.projection };
    }
    assert.equal(startupErrors.length, 0, 'startup_console_error'); assert.equal(receipt.errors.length, 0, 'renderer_console_error'); slot.check(); receipt.coverage = { A: true, B: !restore, C: true, ...(replyNote ? { replyNote: true, replyNotePlacement: true } : {}), D: !restore, E: !restore, F: !restore ? 'Actual Vela source-search Open; no natural-language inference claim' : false, G: !restore ? 'Actual archived canonical resource; no multiuser revocation claim' : false, H: true }; runPassed = true;
  };
  try { await Promise.race([run(), abortPromise]); }
  catch (error) { receipt.error = { message: String(error.message).slice(0, 1000), stack: String(error.stack).slice(0, 4000) }; }
  finally {
    clearTimeout(workTimer); win.removeListener('blur', blur); win.removeListener('hide', blur); win.removeListener('minimize', blur); win.webContents.removeListener('before-input-event', escape); win.webContents.removeListener('console-message', consoleError);
    try {
      if (!owned) { console.log(JSON.stringify({ passed: false, restore, error: receipt.error?.message, cleanup: 'Unowned window/profile rejected without control or writes' })); return receipt; }
      if (recorder) { try { receipt.video = await remainingRace(recorder.stop(path.join(out, runPassed ? 'resource-opening.webm' : 'partial-resource-opening.webm')), slot?.remaining() ?? 1000, 'recording_cleanup_deadline'); budget.videos++; assert(budget.videos <= 1); await fs.writeFile(budgetFile, json(budget)); } catch (error) { runPassed = false; receipt.recordingError = String(error.message).slice(0, 1000); } recorder = null; }
      try { const result = await remainingRace(call('close', {}), Math.min(1500, slot?.remaining() ?? 1500), 'canonical_close_deadline'); assert.equal(result, null); receipt.nativeCloseConfirmed = true; } catch (error) { runPassed = false; receipt.nativeCloseError = String(error.message).slice(0, 1000); }
      // app.exit bypasses the generic before-quit UI, which must never open a
      // recovery/approval dialog during an owned bounded test. The caller must
      // independently confirm that this PID/window/backend have exited.
      receipt.appExitRequested = true; receipt.windowId = win.id; receipt.shutdownProof = 'Canonical close acknowledged; actual process/window exit requires caller observation';
      receipt.startupErrors = startupErrors.slice(0, 24); receipt.elapsedMs = performance.now() - (moduleStartedMonotonicMs ?? started); receipt.slotFailure = slot?.failure() ?? null; receipt.passed = runPassed && receipt.nativeCloseConfirmed === true && !receipt.slotFailure && !startupErrors.length && !receipt.errors.length;
      if (admitted) {
        if (receipt.passed && pendingExpected) { assert(Buffer.byteLength(json(pendingExpected)) <= 2 * 1024 * 1024, 'checkpoint_capacity'); await fs.writeFile(expectedFile, json(pendingExpected), { flag: 'wx' }); }
        await fs.mkdir(out, { recursive: true }); const encoded = json(receipt); assert(Buffer.byteLength(encoded) <= 2 * 1024 * 1024, 'receipt_capacity'); await fs.writeFile(path.join(out, restore ? 'restore.json' : 'journey.json'), encoded, { flag: 'wx' });
      }
      console.log(JSON.stringify({ passed: receipt.passed, restore, error: receipt.error?.message, evidence: admitted ? out : null, inputMethod: receipt.inputMethod, captures: receipt.captures.length, elapsedMs: receipt.elapsedMs }));
    } catch (error) { receipt.passed = false; console.log(JSON.stringify({ passed: false, restore, error: String(error.message).slice(0, 1000), evidence: out })); }
    finally { clearTimeout(hardTimer); if (owned) { process.exitCode = receipt.passed ? 0 : 1; app.exit(process.exitCode); } }
  }
  return receipt;
};
