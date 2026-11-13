/* Actual combined desktop / local-only chat motion. Main alone dispatches
 * --integration-chat-motion --profile=<C:absolute review-chat-motion-DIGITS>.
 * --verify-restore binds the original passing source/assets and canonical IDs.
 * 45s /12s including cleanup; <=3 PNG /16MiB combined. Optional initial-only
 * --record-chat-motion uses one existing exact-window video <=32MiB. Software input is
 * not physical OS input. No refocus, global hooks, auth, provider or fixture RPC.
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { execFileSync } = require('node:child_process');
const { createSlot, targetScript, waitForCondition, sourceIdentity } = require('./integration-resource-opening.cjs');
const { validateBudget, admitPNG } = require('./integration-desktop-basics.cjs');
const { assertOwnedApplicationProfile } = require('./integration-checklists.cjs');
const { fillNative } = require('./integration-agents.cjs');
const MiB = 1024 * 1024;
const FIXTURE = Object.freeze({ title: 'SYNTHETIC Motion conversation', folder: 'SYNTHETIC Motion folder',
  first: Array.from({ length: 10 }, (_, i) => `SYNTHETIC local line ${i + 1}: retain this canonical user text while opening the shared-motion controls.`).join('\n'),
  second: 'SYNTHETIC second local message. This is a manual record, not a model response.',
  draft: 'SYNTHETIC unsent draft; preserve exact selection and recovery.' });
const surface = '[data-surface-id="conversations"]';
const chat = id => `.cp-manager .cp-chat[data-resource-id=${JSON.stringify(id)}]`;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => { const text = JSON.stringify(value, null, 2); assert(Buffer.byteLength(text) <= MiB, 'chat_motion_receipt_capacity'); return text; };
function assertOwnedProfile(root, argv, title) {
  assert(argv.includes('--integration-chat-motion'), 'explicit_chat_motion_flag_required');
  assert(typeof root === 'string' && path.win32.isAbsolute(root) && path.win32.parse(root).root.toLowerCase() === 'c:\\' && /^review-chat-motion-\d+$/.test(path.win32.basename(root)), 'fresh_owned_chat_motion_profile_required');
  assert.match(title, /Automated check/i, 'owned_automated_window_required');
}
function assertRead(name, input) {
  if (name === 'conversation') { assert(input && Object.keys(input).every(k => ['name', 'input'].includes(k))); assert(['detail', 'readDraft', 'readViewState', 'list', 'collections'].includes(input?.name), 'chat_motion_ui_mutations_only'); const a = input.input; assert(a && typeof a === 'object'); if (input.name === 'collections') assert.deepEqual(a, {}); else if (input.name === 'list') assert(Object.keys(a).every(k => ['limit', 'offset'].includes(k))); else assert(typeof a.resourceId === 'string' && a.resourceId && Object.keys(a).every(k => ['resourceId', ...(input.name === 'detail' ? ['limit'] : [])].includes(k))); if (a.limit !== undefined) assert(Number.isSafeInteger(a.limit) && a.limit > 0 && a.limit <= 50); if (a.offset !== undefined) assert(Number.isSafeInteger(a.offset) && a.offset >= 0 && a.offset <= 50); return; }
  assert(['desktop', 'snapshot', 'replay'].includes(name), 'chat_motion_readonly_rpc_required');
  if (name === 'desktop') assert.deepEqual(input, { type: 'snapshot' });
  if (name === 'snapshot') assert.deepEqual(input, {});
  if (name === 'replay') assert.deepEqual(input, { after: 0 });
}
function assertNoProvider(core, events, counters) {
  assert.equal(Object.keys(core.executions).length, 0); assert.equal(Object.keys(core.handoffs).length, 0);
  assert(Object.values(core.bindings).every(value => value === null || Array.isArray(value) && value.length === 0), 'no_native_chat_binding');
  assert(core.conversations.every(c => c.providerId === 'local'), 'local_recording_identity_required');
  assert(core.graph.messages.every(m => m.role === 'user'), 'no_fabricated_assistant_output');
  assert.equal(events.truncated, false, 'complete_event_coverage_required');
  assert(!events.events.some(e => (e.nativeSequence ?? null) !== null || e.threadId || e.turnId || /^(?:provider\/|execution\/|item\/|turn\/|thread\/)/.test(e.type)), 'provider_activity_forbidden');
  assert.equal(counters?.scope, 'process-session-native-attempts');
  for (const key of ['codexConnections', 'providerRequests', 'systemMemoryReads']) assert.equal(counters[key], 0, 'native_attempt_forbidden:' + key);
}
function canonicalChat(detail, draft, desktop, core, collections) {
  const c = detail.conversation; assert.equal(c.providerId, 'local'); assert.equal(c.title, FIXTURE.title); assert.equal(c.state, 'active');
  assert.equal(core.conversations.length, 1); assert.equal(core.graph.conversations.length, 1); assert.equal(core.resourceMap[c.resourceId], c.conversationId); assert.equal(core.graph.conversations[0].id, c.conversationId);
  assert.deepEqual(detail.messages.items.map(m => m.content), [FIXTURE.first, FIXTURE.second]); assert.equal(detail.messages.total, 2); assert.equal(detail.messages.hasMore, false);
  assert.equal(new Set(detail.messages.items.map(m => m.id)).size, 2); assert(detail.messages.items.every(m => m.role === 'user' && !m.inherited && m.resourceId === c.resourceId && Number.isFinite(Date.parse(m.createdAt))));
  assert.equal(core.graph.messages.length, 2); assert.equal(draft.resourceId, c.resourceId); assert.equal(draft.content, FIXTURE.draft); assert(Number.isSafeInteger(draft.version) && draft.version > 0);
  for (const key of ['projects', 'workspaces', 'blocks', 'navigationBlocks', 'archivedWorkspaces']) assert.equal((desktop[key] ?? []).length, 0, 'chat_motion_no_' + key);
  assert.equal(desktop.resources.length, 1); assert.equal(desktop.resources[0].id, c.resourceId); assert.equal(desktop.resources[0].kind, 'conversation');
  assert.equal(collections.length, 1); assert.equal(collections[0].title, FIXTURE.folder); assert.equal(collections[0].state, 'active'); assert.equal(collections[0].parentId, null); assert.deepEqual(collections[0].memberIds, []); assert(Number.isSafeInteger(collections[0].version) && collections[0].version > 0);
  return { conversation: c, messages: detail.messages, lineage: detail.lineage, shares: detail.shares, policy: detail.policy, draft, graph: core.graph, resourceMap: core.resourceMap, resources: desktop.resources, relationships: desktop.relationships, collections };
}
function assertMotionSample(value, kind, state) {
  assert(value && Number.isFinite(value.opacity) && Number.isFinite(value.height) && value.height >= 0, 'actual_finite_motion_sample_required');
  assert(typeof value.cssSample === 'string' && value.cssSample.trim() && Number.isFinite(Number(value.cssSample)) && Math.abs(Number(value.cssSample) - value.opacity) < .002, 'shared_mc_css_sample_must_match_painted_opacity');
  assert.equal(value.semanticOpen, state !== 'closing' && state !== 'closed');
  assert.equal(value.inert, state === 'closing' || state === 'closed');
  if (state === 'closed') { assert.equal(value.hidden, true); return; }
  assert.equal(value.hidden, false); assert.equal(value.paintable, true); assert(value.height > 0, 'actual_painted_content_bounds_required');
  if (state === 'settled') assert(value.opacity >= .995);
  else assert(value.opacity > .005 && value.opacity < .995, kind + ': actual intermediate MC sample required');
  if (kind === 'details') { assert.equal(value.nativeOpen, value.semanticOpen, 'native_details_semantics_required'); assert.equal(value.contentVisibility, 'visible', 'ua_details_content_must_remain_paintable_during_mc_close'); }
}
function passingCheckpoint(checkpoint, receipt) {
  assert(checkpoint?.contract === 'aerynth.chat-motion-checkpoint@1' && receipt?.contract === 'aerynth.chat-motion-integration@1' && receipt.passed === true && receipt.restore === false && receipt.nativeCloseConfirmed === true, 'original_passing_chat_motion_receipt_required');
  assert.equal(receipt.scope, checkpoint.scope, 'original_chat_motion_scope_required');
  assert.deepEqual(sourceIdentity(receipt.source), checkpoint.source); assert.deepEqual(receipt.moduleHashes, checkpoint.moduleHashes); assert.deepEqual(receipt.canonical, checkpoint.canonical); assert.deepEqual(receipt.viewState, checkpoint.viewState);
  if (receipt.recording?.requested) {
    assert(receipt.recording.status === 'complete' && receipt.video, 'original_requested_recording_ack_required');
    admitVideo({ count: 0, bytes: 0, files: [], videos: 0, videoBytes: 0 }, receipt.video, 'chat-motion.webm');
  } else assert(!receipt.video, 'unexpected_original_chat_motion_recording');
}
function motionScript(selector, kind) {
  return `(${function(selector, kind) { const node = document.querySelector(selector); if (!node) return null; const body = node.querySelector(kind === 'picker' ? '.cp-picker-panel' : ':scope>.cp-motion-disclosure-body'); if (!body) return null; const style = getComputedStyle(body), rect = body.getBoundingClientRect(), trigger = kind === 'picker' ? node.querySelector('.cp-picker-trigger') : node.querySelector(':scope>summary'); let paintable = true; for (let p = body; p; p = p.parentElement) { const s = getComputedStyle(p); if (s.display === 'none' || s.visibility === 'hidden') paintable = false; } return { semanticOpen: trigger?.getAttribute('aria-expanded') === 'true', nativeOpen: kind === 'details' ? node.open : null, contentVisibility: kind === 'details' ? getComputedStyle(node, '::details-content').contentVisibility : null, inert: body.inert, hidden: body.hidden, height: rect.height, opacity: Number(style.opacity), paintable, cssSample: kind === 'picker' ? style.getPropertyValue('--cp-picker-opacity') : getComputedStyle(node).getPropertyValue('--cp-disclosure-open'), heightStyle: body.style.height }; }.toString()})(${JSON.stringify(selector)},${JSON.stringify(kind)})`;
}
function viewScript(id, save = false, anchorId = null) {
  return `(${function(id, save, anchorId) { const root = document.querySelector('.cp-manager'), node = root?.querySelector('.cp-chat[data-resource-id="' + CSS.escape(id) + '"]'), editor = node?.querySelector('textarea'), list = node?.querySelector('.cp-messages'); if (!editor || !list) return null; const key = Symbol.for('aerynth.test.chat-motion.refs'); if (save) window[key] = { editor, list, node }; const refs = window[key], clip = list.getBoundingClientRect(), scale = clip.height / list.offsetHeight, anchor = anchorId && list.querySelector('[data-message-id="' + CSS.escape(anchorId) + '"] .cp-message-content'), anchorOffsetY = anchor && scale > 0 ? (anchor.getBoundingClientRect().top - clip.top) / scale - list.clientTop : null; return { anchorOffsetY, direction: editor.selectionDirection, resourceId: root.dataset.resourceId, draft: editor.value, start: editor.selectionStart, end: editor.selectionEnd, scroll: list.scrollTop, editorScroll: editor.scrollTop, retained: !!refs && refs.editor === editor && refs.list === list && refs.node === node, focused: document.activeElement === editor }; }.toString()})(${JSON.stringify(id)},${save},${JSON.stringify(anchorId)})`;
}
function geometryScript(id) {
  return `(${function(id) { const root = document.querySelector('.cp-manager'), node = root?.querySelector('.cp-chat[data-resource-id="' + CSS.escape(id) + '"]'), messages = node?.querySelector('.cp-messages'), input = node?.querySelector('textarea'), send = node?.querySelector('[data-cp-control=send]'); if (!messages || !input || !send) return null; const box = n => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; }, clip = messages.getBoundingClientRect(), lines = []; for (const content of messages.querySelectorAll('.cp-message-content')) { const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT); let text; while (text = walker.nextNode()) if (text.textContent.trim()) { const range = document.createRange(); range.selectNodeContents(text); for (const r of range.getClientRects()) if (r.height > 0 && r.width > 0) lines.push({ messageId: content.closest('[data-message-id]').dataset.messageId, x: r.x, y: r.y, width: r.width, height: r.height, fullyVisible: r.top >= clip.top - .5 && r.bottom <= clip.bottom + .5 && r.left >= clip.left - .5 && r.right <= clip.right + .5 }); } } const scrollOwners = [...node.querySelectorAll('*')].filter(n => ['auto', 'scroll'].includes(getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight + 1 && n.clientHeight > 0).map(n => n.className); const visibleHit = n => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && n.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }; return { viewport: { width: innerWidth, height: innerHeight }, root: box(root), chat: box(node), messages: box(messages), input: box(input), send: box(send), rootOverflow: root.scrollWidth > root.clientWidth + 1, inputHit: visibleHit(input), sendHit: visibleHit(send), lines: lines.slice(-128), scrollOwners, redundantProviderSelects: root.querySelector('.cp-provider-capabilities')?.querySelectorAll('select').length ?? 0 }; }.toString()})(${JSON.stringify(id)})`;
}
function assertGeometry(value) {
  assert(value && !value.rootOverflow && value.inputHit && value.sendHit, 'actual_chat_composer_clipped_or_occluded'); assert.equal(value.redundantProviderSelects, 0);
  assert(value.messages.height >= 80 && value.input.height >= 32 && value.send.height >= 24, 'usable_transcript_composer_bounds_required');
  assert(value.lines.some(line => line.fullyVisible && line.height >= 12), 'complete_painted_canonical_text_line_required');
  assert.deepEqual(value.scrollOwners, ['cp-messages'], 'one_chat_transcript_vertical_scroll_owner_required');
}
async function bounded(promise, ms, code) { assert(ms > 0, code); let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(code)), ms); })]); } finally { clearTimeout(timer); } }
async function readJson(file) { assert((await fs.stat(file)).size <= MiB, 'bounded_chat_motion_checkpoint_required'); return JSON.parse(await fs.readFile(file, 'utf8')); }
function validateMotionBudget(budget) {
  validateBudget(budget); assert(Number.isSafeInteger(budget.videos) && budget.videos >= 0 && budget.videos <= 1 && Number.isSafeInteger(budget.videoBytes) && budget.videoBytes >= 0 && budget.videoBytes <= 32 * MiB && (budget.videos === 0) === (budget.videoBytes === 0), 'chat_motion_video_budget_invalid'); return budget;
}
function admitVideo(budget, video, destination) {
  validateMotionBudget(budget); assert(budget.videos === 0 && video && video.file === path.basename(destination) && path.basename(video.file) === video.file && Number.isSafeInteger(video.byteCount) && video.byteCount > 0 && video.byteCount <= 32 * MiB && /^[a-f0-9]{64}$/.test(video.sha256) && Number.isFinite(video.durationMs) && video.durationMs > 0 && video.durationMs <= 45000 && Number.isFinite(video.startedAt) && Number.isFinite(video.readyAt) && video.startedAt > 0 && video.readyAt >= video.startedAt && ['video/webm;codecs=vp9', 'video/webm;codecs=vp8'].includes(video.mimeType) && video.source === 'Exact application BrowserWindow' && video.audio === false && video.requestedFrameRate === 30, 'chat_motion_video_ack_invalid');
  const value = Object.fromEntries(['file', 'byteCount', 'sha256', 'durationMs', 'startedAt', 'readyAt', 'mimeType', 'source', 'audio', 'requestedFrameRate'].map(key => [key, video[key]]));
  budget.videos = 1; budget.videoBytes = video.byteCount; return value;
}
/** Existing recorder only. Late completion cannot resume the journey, create a
 * second recording or admit media after a deadline. Native exit remains final
 * cleanup when no recorder handle/stop acknowledgement is available. */
function optionalRecording({ requested, restore, slot, win, session, localURL, out, budget, start }) {
  const state = { requested, status: !requested ? 'not-requested' : restore ? 'skipped-restore' : 'not-started' };
  const eligible = requested && !restore; let attempted = false, active, stopping, finishing = false, startFailed = false;
  const incomplete = code => { state.status = 'incomplete'; state.errorCode = code; };
  const stopOnce = (recorder, complete, cleanupOnly = false) => {
    if (stopping) return stopping;
    const destination = path.join(out, complete ? 'chat-motion.webm' : 'partial-chat-motion.webm'), available = Math.min(2000, Math.max(0, slot.remaining() - 1500)), until = performance.now() + available;
    // Ask the same handle to stop even if no await budget remains. Never wait
    // past the canonical-close reserve or publish a late success.
    const operation = Promise.resolve().then(() => recorder.stop(destination));
    const acknowledgement = available > 0 ? bounded(operation, available, 'chat_motion_recording_stop_deadline') : Promise.reject(Error('chat_motion_recording_stop_deadline'));
    if (available === 0) operation.catch(() => {});
    stopping = acknowledgement.then(video => {
      if (cleanupOnly) return;
      assert(performance.now() < until && slot.remaining() >= 1500, 'chat_motion_recording_stop_deadline');
      const accepted = admitVideo(budget, video, destination);
      if (complete && !startFailed) state.status = 'complete'; else incomplete('chat_motion_recording_journey_incomplete');
      return accepted;
    })
      .catch(() => { if (!cleanupOnly) incomplete('chat_motion_recording_stop_incomplete'); throw Error('chat_motion_recording_stop_incomplete'); });
    stopping.catch(() => {}); return stopping;
  };
  return { state,
    async begin() {
      if (!eligible) return; assert(!attempted && !finishing, 'chat_motion_recording_once_only'); attempted = true; state.status = 'starting';
      try {
        slot.check(); validateMotionBudget(budget); assert(budget.videos === 0 && session && typeof localURL === 'string' && localURL && typeof start === 'function', 'chat_motion_recording_host_required');
        const available = Math.min(4000, slot.workRemaining()), until = performance.now() + available; assert(available > 0, 'chat_motion_recording_start_deadline');
        const pending = Promise.resolve().then(() => start(win, session, localURL));
        pending.then(value => { active = value; if ((startFailed || finishing) && typeof active?.stop === 'function') void stopOnce(active, false, true); }, () => {});
        const value = await bounded(pending, available, 'chat_motion_recording_start_deadline');
        assert(typeof value?.stop === 'function', 'chat_motion_recording_handle_required'); slot.check(); assert(!finishing && performance.now() < until, 'chat_motion_recording_closed_or_late'); state.status = 'recording';
      } catch { startFailed = true; incomplete('chat_motion_recording_start_incomplete'); if (typeof active?.stop === 'function') void stopOnce(active, false, true); throw Error('chat_motion_recording_start_incomplete'); }
    },
    async finish(complete) {
      if (!eligible) return; finishing = true;
      if (typeof active?.stop !== 'function') { startFailed = true; incomplete('chat_motion_recording_start_incomplete'); return; }
      return stopOnce(active, complete && !startFailed, startFailed);
    },
  };
}
Object.assign(exports, { assertOwnedProfile, assertRead, assertNoProvider, canonicalChat, assertMotionSample, assertGeometry, passingCheckpoint, motionScript, viewScript, geometryScript, validateMotionBudget, admitVideo, optionalRecording, FIXTURE });

exports.verify = async function verify({ win, app, privateRoot, call, source, startupErrors = [], moduleStartedMonotonicMs, observeProviderActivity, session, localURL }) {
  const restore = process.argv.includes('--verify-restore'), record = process.argv.includes('--record-chat-motion'), limitMs = restore ? 12000 : 45000, root = path.resolve(privateRoot), out = path.join(root, 'chat-motion-evidence', `${restore ? 'restore' : 'initial'}-${Date.now()}`), expectedFile = path.join(root, 'chat-motion-expected.json'), budgetFile = path.join(root, 'chat-motion-capture-budget.json');
  const scope = process.argv.includes('--chat-reading-only') ? 'resize-search-and-reading' : 'full-chat-motion';
  const receipt = { contract: 'aerynth.chat-motion-integration@1', source, restore, passed: false, syntheticOnly: true, inputMethod: 'App-only software native-window mouse/key/wheel/insertText; all journey evaluations FALSE. Optional recorder alone uses the existing exact-window media authority. Renderer writes only temporary observation references, never product state or activation.', limits: { milliseconds: limitMs, combinedPNGs: 3, combinedPNGBytes: 16 * MiB, videos: record && !restore ? 1 : 0, combinedVideoBytes: 32 * MiB }, actions: [], samples: [], captures: [], checks: [], errors: [], limitations: ['No provider/handoff/account/native-thread or generated-title proof.', 'Shared-MC CSS samples and native-window capture are not physical input, monitor-presentation, artistic or performance acceptance.', 'Reading position compares the canonical message anchor at matching viewport geometry; this does not qualify arbitrary viewport changes or IME recovery.', 'Optional initial-only exact-window/no-audio recording needs successful bounded stop acknowledgement; capture overhead is included and requested30fps is not monitor performance.', 'Root must inspect PNGs/optional WebM and independently confirm all test processes exited.'] };
  receipt.scope = scope;
  if (scope === 'resize-search-and-reading') receipt.limitations.push('Picker and disclosure motion samples are outside this run.');
  let owned = false, admitted = false, installed = false, budgetWritable = false, passed = false, slot, expected, pendingExpected, workTimer, hardTimer, rejectAbort, failureCapture, recording, budget = { count: 0, bytes: 0, files: [], videos: 0, videoBytes: 0 };
  const aborted = new Promise((_, reject) => { rejectAbort = reject; }); aborted.catch(() => {});
  const abort = code => rejectAbort(slot?.abort(code) ?? Error(code)), blur = () => abort('chat_motion_focus_lost'), escape = (_event, input) => { if (input?.type === 'keyDown' && input.key === 'Escape') abort('chat_motion_operator_escape'); }, consoleError = (_event, details) => { if ((details?.level === 'error' || details?.level === 3) && receipt.errors.length < 24) receipt.errors.push(String(details.message).slice(0, 1000)); };
  const run = async () => {
    assertOwnedProfile(privateRoot, process.argv, win.getTitle()); assertOwnedApplicationProfile(privateRoot, app.getPath('userData'), process.argv); sourceIdentity(source); owned = true;
    slot = createSlot({ win, startedAt: moduleStartedMonotonicMs, limitMs, cleanupMs: restore ? 2500 : 4000 }); slot.check(); hardTimer = setTimeout(() => { receipt.hardDeadline = true; abort('chat_motion_hard_deadline'); app.exit(1); }, slot.remaining()); workTimer = setTimeout(() => abort('chat_motion_work_deadline'), slot.workRemaining());
    installed = true; win.on('blur', blur); win.on('hide', blur); win.on('minimize', blur); win.webContents.on('before-input-event', escape); win.webContents.on('console-message', consoleError);
    receipt.reserve = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.join(process.env.LOCALAPPDATA || '', 'AeroStorageWatch', 'ReserveGuard.ps1'), '-EstimatedCBytes', String((record && !restore ? 64 : 32) * MiB), '-EstimatedDBytes', '0'], { windowsHide: true, timeout: Math.floor(Math.min(4000, slot.workRemaining())), maxBuffer: 8192, encoding: 'utf8' })); assert.equal(receipt.reserve.allowed, true); admitted = true; await fs.mkdir(out, { recursive: true });
    receipt.moduleHashes = { helper: hash(await fs.readFile(__filename)) }; for (const relative of ['chat.ts', 'ui.ts', 'style.css', 'picker.ts', 'picker.css', 'draft-session.ts']) receipt.moduleHashes[relative] = hash(await fs.readFile(path.resolve(__dirname, '../../../conversation-product/src', relative))); for (const name of ['integration-agents.cjs', 'integration-checklists.cjs', 'integration-resource-opening.cjs', 'integration-desktop-basics.cjs', 'application-recording.cjs']) receipt.moduleHashes[name] = hash(await fs.readFile(path.join(__dirname, name)));
    for (const [name, digest] of Object.entries(source.buildAssets)) { assert.equal(path.basename(name), name); assert.equal(hash(await fs.readFile(path.join(__dirname, '../dist/assets', name))), digest, 'actual_build_asset_binding'); }
    if (restore) { expected = await readJson(expectedFile); assert.equal(expected.scope ?? 'full-chat-motion', scope, 'chat_motion_restore_scope_mismatch'); assert.deepEqual(expected.source, sourceIdentity(source)); assert.deepEqual(expected.moduleHashes, receipt.moduleHashes); const prior = path.resolve(root, expected.initialReceipt), relative = path.relative(root, prior); assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative)); const initial = await readJson(prior); passingCheckpoint(expected, initial); budget = validateMotionBudget(await readJson(budgetFile)); assert.equal(budget.videos, initial.video ? 1 : 0); assert.equal(budget.videoBytes, initial.video?.byteCount ?? 0); budgetWritable = true; }
    else { await assert.rejects(fs.stat(expectedFile), { code: 'ENOENT' }); await assert.rejects(fs.stat(budgetFile), { code: 'ENOENT' }); budgetWritable = true; }
    recording = optionalRecording({ requested: record, restore, slot, win, session, localURL, out, budget, start: (ownedWin, ownedSession, ownedURL) => require('./application-recording.cjs').startWindowRecording(ownedWin, ownedSession, ownedURL) }); receipt.recording = recording.state;
    const js = async code => { slot.check(); const result = await bounded(win.webContents.executeJavaScript(code, false), slot.workRemaining(), 'chat_motion_renderer_deadline'); slot.check(); return result; };
    const rpc = async (name, input) => { assertRead(name, input); slot.check(); const result = await bounded(call(name, input), slot.workRemaining(), 'chat_motion_read_deadline'); slot.check(); return result; };
    const wait = (label, check) => { receipt.phase = label; return waitForCondition({ slot, label, check, diagnose: () => js("({status:document.querySelector('.cp-status')?.textContent,chatStatus:document.querySelector('.cp-chat-status')?.textContent,surfaces:[...document.querySelectorAll('[data-surface-id]')].map(n=>n.dataset.surfaceId),pickers:[...document.querySelectorAll('.cp-picker-trigger')].map(n=>({label:n.getAttribute('aria-label'),open:n.getAttribute('aria-expanded')})),errors:window.__aerynth?.snapshot?.().metrics.errors})") }); };
    const click = async query => { let previous, point; await wait('Visible stable native control ' + query, async () => { const value = await js(targetScript(query, 'inspect')); if (!value.ready) { previous = null; return false; } point = { x: Math.round(value.rect.x + value.rect.width / 2), y: Math.round(value.rect.y + value.rect.height / 2) }; const stable = previous && Math.abs(point.x - previous.x) < 1 && Math.abs(point.y - previous.y) < 1; previous = point; return stable; }); receipt.actions.push({ method: 'software-native-window-mouse', selector: query }); for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) { slot.check(); win.webContents.sendInputEvent({ type, ...point, button: 'left', clickCount: 1 }); } };
    const key = (keyCode, modifiers = []) => { for (const type of ['keyDown', 'keyUp']) { slot.check(); win.webContents.sendInputEvent({ type, keyCode, modifiers }); } };
    const fill = async (query, text) => { await fillNative({ click, key, js, wait, insertText: text => bounded(win.webContents.insertText(text), slot.workRemaining(), 'chat_motion_input_deadline') }, query, text); receipt.actions.push({ method: 'software-native-window-insertText', selector: query, characters: text.length }); };
    const desktop = () => rpc('desktop', { type: 'snapshot' }), detail = id => rpc('conversation', { name: 'detail', input: { resourceId: id, limit: 50 } }), draft = id => rpc('conversation', { name: 'readDraft', input: { resourceId: id } });
    const proof = async () => { const core = await rpc('snapshot', {}), d = await desktop(), events = await rpc('replay', { after: 0 }); assert.equal(typeof observeProviderActivity, 'function'); const counters = await bounded(observeProviderActivity(), slot.workRemaining(), 'chat_motion_observer_deadline'); assertNoProvider(core, events, counters); receipt.counters = counters; return { core, desktop: d }; };
    const openManager = async () => { await click('#workspace-manager'); await click('.en-navigator [data-action="conversations"]'); await wait('Actual Conversations surface and manager', () => js(`!!document.querySelector(${JSON.stringify(surface + ' .cp-manager')})`)); };
    const capture = async name => { const sample = () => js("(()=>{const s=window.__aerynth.snapshot(),n=document.querySelector('[data-surface-id=conversations]');if(!n)return null;const r=n.getBoundingClientRect();let opacity=1;for(let p=n;p;p=p.parentElement)opacity*=Number(getComputedStyle(p).opacity);return{frames:s.gpu?.framesRendered,draws:s.metrics.draws,active:s.active,lost:s.gpu?.contextLost,failed:s.graphicsFailed,errors:s.metrics.errors,bounds:{x:r.x,y:r.y,w:r.width,h:r.height},opacity,inBounds:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight}})()"); const before = await sample(); let previous, stable = 0; await wait('Focused fully revealed stable surface and fresh GPU draw', async () => { const next = await sample(); stable = next?.inBounds && next.opacity >= .995 && previous && ['x', 'y', 'w', 'h'].every(k => Math.abs(next.bounds[k] - previous[k]) < .75) ? stable + 1 : 0; previous = next?.bounds; return stable >= 2 && next.active && !next.failed && !next.lost && next.errors.length === 0 && next.frames > before.frames && next.draws > before.draws; }); const png = (await bounded(win.webContents.capturePage(), slot.workRemaining(), 'chat_motion_capture_deadline')).toPNG(); slot.check(); const file = path.join(out, name + '.png'), item = admitPNG(budget, png, file); await fs.writeFile(file, png, { flag: 'wx' }); receipt.captures.push({ ...item, focused: true, before, after: await sample() }); }; failureCapture = () => capture('failure');
    const verifyRendered = async (id, value) => { await wait('Exact canonical two user messages with actual timestamps/day dividers', () => js(`(()=>{const n=document.querySelector(${JSON.stringify(chat(id))});if(!n)return false;return ${JSON.stringify(value.messages.items)}.every(m=>{const a=n.querySelector('[data-message-id="'+CSS.escape(m.id)+'"]');return a?.querySelector('.cp-message-content')?.textContent===m.content&&a.querySelector('time')?.dateTime===m.createdAt&&!!a.querySelector('time').textContent})&&n.querySelectorAll('.cp-message').length===2&&n.querySelectorAll('.cp-chat-day[role=separator]').length===new Set(${JSON.stringify(value.messages.items.map(m => m.createdAt))}.map(t=>new Date(t).toLocaleDateString())).size&&n.querySelector('textarea')?.value===${JSON.stringify(FIXTURE.draft)}})()`)); };
    const savedView = id => rpc('conversation', { name: 'readViewState', input: { resourceId: id } });
    const waitForGeometry = (label, id, visibleMessageId) => wait(label, async () => {
      const sample = await js(geometryScript(id));
      try {
        assertGeometry(sample);
        if (visibleMessageId) assert(sample.lines.some(line => line.messageId === visibleMessageId && line.fullyVisible && line.height >= 12), 'latest_message_line_required_after_resize');
        delete receipt.layoutFailure;
        return sample;
      } catch (error) {
        receipt.layoutFailure = { check: error.message, sample };
        return false;
      }
    });
    const canonical = async id => { const { core, desktop: d } = await proof(); return canonicalChat(await detail(id), await draft(id), d, core, await rpc('conversation', { name: 'collections', input: {} })); };
    await wait('Combined actual app ready', () => js("document.body.dataset.applicationHydrated==='true'")); const start = await proof();
    let id;
    if (restore) { id = expected.resourceId; receipt.canonical = await canonical(id); assert.deepEqual(receipt.canonical, expected.canonical, 'exact_local_chat_draft_message_identity_restart_without_replay'); assert(expected.viewState?.view?.position?.anchor, 'saved_native_chat_anchor_required'); assert.deepEqual(await savedView(id), expected.viewState);
      win.setContentSize(780, 700); await openManager(); await wait('Saved conversation selected on actual library open', () => js(`document.querySelector('.cp-manager')?.dataset.resourceId===${JSON.stringify(id)}`)); await verifyRendered(id, receipt.canonical);
      await wait('Exact saved caret, selection and authorized message anchor restored', async () => { const saved=expected.viewState.view, view=await js(viewScript(id,false,saved.position.anchor.messageId)); if(!view||view.focused||view.start!==saved.selection.start||view.end!==saved.selection.end||view.direction!==saved.selection.direction||view.anchorOffsetY===null||Math.abs(view.anchorOffsetY-saved.position.anchor.offsetY)>1.2)return false; receipt.restoredView=view;return true; });
      receipt.viewState=await savedView(id);assert.deepEqual(receipt.viewState,expected.viewState,'restoration_must_not_write_view_state');receipt.restoreGeometry=await waitForGeometry('Restored tight actual layout',id);await capture('03-chat-motion-restart'); }
    else {
      assert.equal(start.desktop.resources.length, 0, 'fresh_empty_chat_motion_profile_required'); assert.equal(start.core.conversations.length, 0); win.setContentSize(1100, 800); await recording.begin(); await openManager(); await click('.cp-new-chat>summary'); await fill('input[aria-label="New conversation title"]', FIXTURE.title);
      if (await js("document.querySelector('select[aria-label=\"New conversation provider\"]')?.value!=='local'")) { await click('[data-cp-picker-for="New conversation provider"]'); await click('.cp-new-chat [data-cp-option-value="local"]'); }
      assert.equal(await js("document.querySelector('select[aria-label=\"New conversation provider\"]')?.value"), 'local'); await click('.cp-new-chat [data-cp-control="create-chat"]'); await wait('One actual canonical local conversation', async () => { const d = await desktop(); const r = d.resources.find(r => r.kind === 'conversation' && r.title === FIXTURE.title); if (r) id = r.id; return !!r; }); await wait('Canonical manager chat selected', () => js(`document.querySelector('.cp-manager')?.dataset.resourceId===${JSON.stringify(id)}`));
      for (const [index, content] of [FIXTURE.first, FIXTURE.second].entries()) { await fill(chat(id) + ' textarea', content); await click(chat(id) + ' [data-cp-control="send"]'); await wait('Exact manual user message durable ' + index, async () => { const d = await detail(id); return d.messages.items.length === index + 1 && d.messages.items[index].content === content && d.messages.items[index].role === 'user'; }); }
      await fill(chat(id) + ' textarea', FIXTURE.draft); await wait('Exact unsent canonical draft durable', async () => (await draft(id)).content === FIXTURE.draft);
      await click('.cp-history-tools>summary'); await fill('input[aria-label="New folder title"]', FIXTURE.folder); await click('.cp-history-tools [data-cp-control="new-folder"]'); await wait('Actual canonical folder for native expansion', async () => { const all = await rpc('conversation', { name: 'collections', input: {} }); return all.length === 1 && all[0].title === FIXTURE.folder; }); await click('.cp-history-tools>summary'); await wait('Organization menu fully closed', () => js("document.querySelector('.cp-history-tools>.cp-motion-disclosure-body')?.hidden===true"));
      receipt.canonical = await canonical(id); await verifyRendered(id, receipt.canonical);
      const history = await js(`(()=>{const r=document.querySelector('.cp-results [data-resource-id='+${JSON.stringify(JSON.stringify(id))}+']');return r?{text:r.textContent,title:r.title,children:[...r.children].map(n=>n.className)}:null})()`); assert.equal(history?.text, FIXTURE.title); assert.equal(history.children.length, 2); assert.equal(history.children[0], 'cp-control-glyph'); assert(history.children[1].split(' ').includes('cp-result-title')); receipt.history = history;
      const match = receipt.canonical.messages.items[1];
      await capture('01-local-chat'); win.setContentSize(780, 700); receipt.tightGeometry=await waitForGeometry('Actual tight-width usable latest message and composer', id, match.id);
      await click('.cp-switcher>summary');
      const quickInput = '.cp-switcher input[type="search"]';
      await click(quickInput);
      await wait('Quick search input focused', () => js(`document.activeElement===document.querySelector(${JSON.stringify(quickInput)})`));
      const typedAt = performance.now();
      await bounded(win.webContents.insertText('second local message'), slot.workRemaining(), 'chat_motion_input_deadline');
      const enterAt = performance.now();
      key('Return');
      const insertToEnterMs = enterAt - typedAt;
      assert(insertToEnterMs < 120, 'enter_must_precede_typeahead_debounce');
      const timing = receipt.quickSearch = {
        resourceId: id, messageId: match.id, method: 'software-native-window-keyboard',
        insertToEnterMs, tier: 'native key dispatch to polled renderer geometry and backend draft/view acknowledgement',
        pollIntervalMs: 35, fixtureMessages: receipt.canonical.messages.total,
      };
      await wait('Enter closes the switcher and reveals the exact message line', async () => {
        if (await js("document.querySelector('.cp-switcher')?.open!==false")) return false;
        const sample = await js(geometryScript(id));
        return sample?.lines.some(line => line.messageId === match.id && line.fullyVisible && line.height >= 12);
      });
      timing.enterToVisibleMessageMs = performance.now() - enterAt;
      await wait('Exact message anchor and unchanged draft are acknowledged', async () => {
        const view = await js(viewScript(id, false, match.id));
        return view?.draft === FIXTURE.draft && view.anchorOffsetY !== null && (await savedView(id)).view?.position?.anchor?.messageId === match.id;
      });
      timing.enterToSavedViewMs = performance.now() - enterAt;
      await click(chat(id) + ' textarea'); await wait('Actual message editor focus', () => js(`document.activeElement===document.querySelector(${JSON.stringify(chat(id) + ' textarea')})`)); key('Home', ['control']); for (let i = 0; i < 3; i++) key('Right'); for (let i = 0; i < 8; i++) key('Right', ['shift']); await wait('Exact native draft selection', () => js(`(()=>{const n=document.querySelector(${JSON.stringify(chat(id) + ' textarea')});return n.selectionStart===3&&n.selectionEnd===11})()`));
      const v = await js(geometryScript(id)), priorScroll = (await js(viewScript(id))).scroll, point = { x: Math.round(v.messages.x + v.messages.width / 2), y: Math.round(v.messages.y + v.messages.height / 2) }; assert(priorScroll > 0, 'long_actual_transcript_required_for_reading_position_test'); assert(await js(`!!document.elementFromPoint(${point.x},${point.y})?.closest('.cp-messages')`), 'actual_transcript_wheel_hit_required'); win.webContents.sendInputEvent({ type: 'mouseMove', ...point }); win.webContents.sendInputEvent({ type: 'mouseWheel', ...point, deltaX: 0, deltaY: 180, canScroll: true }); receipt.actions.push({ method: 'software-native-window-wheel', deltaY: 180, priorScroll }); let previousScroll, stableScroll = 0; await wait('Actual native reading scroll delivery and settling', async () => { const a = await js(viewScript(id)); stableScroll = a?.scroll < priorScroll && a.scroll === previousScroll ? stableScroll + 1 : 0; previousScroll = a?.scroll; return stableScroll >= 2; }); const before = await js(viewScript(id, true));
      if (scope === 'full-chat-motion') {
        const sampleUntil = (selector, kind, state) => wait('Actual MC ' + kind + ' ' + state, async () => { const value = await js(motionScript(selector, kind)); try { assertMotionSample(value, kind, state); receipt.samples.push({ kind, state, selector, value }); return value; } catch { return false; } });
        assert.equal(await js("window.__aerynth.snapshot().reduced"), false, 'normal_motion_policy_required_for_intermediate_samples');
        const provider = chat(id) + ' .cp-chat-provider-slot .cp-picker', trigger = provider + ' .cp-picker-trigger'; await click(trigger); await sampleUntil(provider, 'picker', 'opening'); key('Home'); key('End'); await wait('Picker native keyboard keeps focus on actual enabled option', () => js(`(()=>{const n=document.activeElement,p=document.querySelector(${JSON.stringify(provider)});return !!n&&n.getAttribute('role')==='option'&&!n.disabled&&p.contains(n)})()`)); await click(trigger); await sampleUntil(provider, 'picker', 'closing'); await click(trigger); await sampleUntil(provider, 'picker', 'opening'); await sampleUntil(provider, 'picker', 'settled'); await click(trigger); await sampleUntil(provider, 'picker', 'closed');
        for (const selector of ['.cp-chat-options', '.cp-chat-extras', '.cp-filters', '.cp-history-tools', '.cp-new-chat', '.cp-switcher']) { const revealHistory = !(await js(targetScript(selector + '>summary', 'inspect'))).ready && ['.cp-filters', '.cp-history-tools'].includes(selector); if (revealHistory) await click('.cp-history-toggle'); await click(selector + '>summary'); await sampleUntil(selector, 'details', 'opening'); await sampleUntil(selector, 'details', 'settled'); await click(selector + '>summary'); await sampleUntil(selector, 'details', 'closing'); if (selector === '.cp-chat-options') { await click(selector + '>summary'); await sampleUntil(selector, 'details', 'opening'); await sampleUntil(selector, 'details', 'settled'); await click(selector + '>summary'); } await sampleUntil(selector, 'details', 'closed'); if (revealHistory) await click('.cp-history-toggle'); }
        await click('.cp-history-toggle'); const collectionGroup = '.cp-library-tree [data-tree-key="collections"]', folder = `[data-collection-id=${JSON.stringify(receipt.canonical.collections[0].id)}]`; await click(collectionGroup + '>summary'); await sampleUntil(collectionGroup, 'details', 'opening'); await sampleUntil(collectionGroup, 'details', 'settled'); await click(folder + '>summary'); await sampleUntil(folder, 'details', 'opening'); await sampleUntil(folder, 'details', 'settled'); await click(folder + '>summary'); await sampleUntil(folder, 'details', 'closing'); await sampleUntil(folder, 'details', 'closed'); await click(collectionGroup + '>summary'); await sampleUntil(collectionGroup, 'details', 'closing'); await sampleUntil(collectionGroup, 'details', 'closed'); await click('.cp-history-toggle');
      }
      const after = await js(viewScript(id)); receipt.retainedView = { before, after }; assert.equal(after.retained, true); for (const field of ['resourceId', 'draft', 'start', 'end', 'scroll', 'editorScroll']) assert.equal(after[field], before[field], 'same_composer_' + field); assert.deepEqual(await canonical(id), receipt.canonical, 'view_only_motion_must_not_mutate_canonical_history_or_draft'); assertGeometry(await js(geometryScript(id))); await capture('02-tight-chat-motion');
      receipt.reducedMotion = { status: 'not-run', reason: 'This bounded journey measures normal-motion continuity. The scene policy control needs a separate native check at a usable width.' };
      await wait('Exact native view metadata acknowledged by canonical service', async () => { const stored=await savedView(id), v=stored.view, anchor=v?.position?.anchor, selection=v?.selection; if(stored.selected.resourceId!==id||!anchor||selection?.draftVersion!==receipt.canonical.draft.version||selection.start!==before.start||selection.end!==before.end||selection.direction!==before.direction)return false;const actual=await js(viewScript(id,false,anchor.messageId));if(actual?.anchorOffsetY==null||Math.abs(actual.anchorOffsetY-anchor.offsetY)>1.2)return false;receipt.viewState=stored;return true; });
      await click('.cp-header-actions [data-cp-control="close"]'); await wait('Actual chat surface closed after canonical draft drain', () => js(`!document.querySelector(${JSON.stringify(surface)})`)); await openManager(); await wait('Same-process exact draft, selection and message anchor restored', async () => { const saved=receipt.viewState.view, v=await js(viewScript(id,false,saved.position.anchor.messageId)); if(!v||v.draft!==FIXTURE.draft||v.start!==saved.selection.start||v.end!==saved.selection.end||v.direction!==saved.selection.direction||v.anchorOffsetY===null||Math.abs(v.anchorOffsetY-saved.position.anchor.offsetY)>1.2)return false;receipt.reopenedView=v;return true; });
      pendingExpected = { contract: 'aerynth.chat-motion-checkpoint@1', scope, source: sourceIdentity(source), moduleHashes: receipt.moduleHashes, resourceId: id, canonical: receipt.canonical, viewState: receipt.viewState, initialReceipt: path.relative(root, path.join(out, 'journey.json')) };
    }
    await proof(); assert.equal(startupErrors.length, 0); assert.equal(receipt.errors.length, 0); slot.check(); passed = true;
  };
  try { await Promise.race([run(), aborted]); } catch (error) { receipt.error = { message: String(error.message).slice(0, 1200), ...(error.diagnostics ? { diagnostics: error.diagnostics } : {}) }; if (admitted && failureCapture && !slot.failure()) try { await failureCapture(); } catch {} }
  finally {
    clearTimeout(workTimer);
    try {
      if (!owned) { console.log(JSON.stringify({ passed: false, error: receipt.error?.message, cleanup: 'Unowned profile/window: no writes or control' })); return receipt; }
      if (record && !restore) {
        if (!recording) receipt.recording = { requested: true, status: 'incomplete', errorCode: 'chat_motion_recording_start_incomplete' };
        try { const video = await recording?.finish(passed && !slot.failure() && !receipt.errors.length && !startupErrors.length); if (video) receipt.video = video; } catch { /* Recording state contains the bounded failure code. */ }
        if (receipt.recording?.status !== 'complete' || !receipt.video) { passed = false; receipt.recordingError = receipt.recording?.errorCode ?? 'chat_motion_recording_incomplete'; }
      }
      try { assert.equal(await bounded(call('close', {}), Math.min(1500, slot?.remaining() ?? 1500), 'chat_motion_close_deadline'), null); receipt.nativeCloseConfirmed = true; } catch (error) { passed = false; receipt.nativeCloseError = String(error.message).slice(0, 1000); }
      receipt.elapsedMs = performance.now() - moduleStartedMonotonicMs; receipt.slotFailure = slot?.failure() ?? null; receipt.startupErrors = startupErrors.slice(0, 24); receipt.passed = passed && receipt.nativeCloseConfirmed === true && !receipt.slotFailure && !receipt.errors.length && !startupErrors.length;
      if (admitted) {
        if (receipt.passed && pendingExpected) await fs.writeFile(expectedFile, encode(pendingExpected), { flag: 'wx' });
        if (budgetWritable) await fs.writeFile(budgetFile, encode(validateMotionBudget(budget)));
        await fs.mkdir(out, { recursive: true }); const file = path.join(out, restore ? 'restore.json' : 'journey.json'); await fs.writeFile(file, encode(receipt), { flag: 'wx' });
        if (slot?.failure() || receipt.errors.length || startupErrors.length) { receipt.passed = false; receipt.slotFailure = slot?.failure() ?? null; await fs.writeFile(file, encode(receipt)); }
      }
      console.log(JSON.stringify({ passed: receipt.passed, restore, evidence: admitted ? out : null, error: receipt.error?.message, recording: receipt.recording?.status, recordingError: receipt.recordingError, elapsedMs: receipt.elapsedMs }));
    } catch (error) { receipt.passed = false; console.log(JSON.stringify({ passed: false, error: String(error.message).slice(0, 1000) })); }
    finally { if (installed) { win.removeListener('blur', blur); win.removeListener('hide', blur); win.removeListener('minimize', blur); win.webContents.removeListener('before-input-event', escape); win.webContents.removeListener('console-message', consoleError); } clearTimeout(hardTimer); if (owned) app.exit(receipt.passed ? 0 : 1); }
  }
  return receipt;
};
