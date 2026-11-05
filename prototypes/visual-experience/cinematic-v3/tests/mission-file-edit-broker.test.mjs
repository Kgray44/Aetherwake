import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const { createMissionFileEditBroker, PRIVATE_MISSION_FILE_EDIT_COMMANDS } = createRequire(import.meta.url)('../native/mission-file-edit-broker.cjs');
const sha = value => createHash('sha256').update(value).digest('hex');
const operationId = '11111111-1111-4111-8111-111111111111';
const localUrl = 'file:///C:/Synthetic/Aerynth/index.html';
const nodeExecutable = 'C:\\Program Files\\nodejs\\node.exe';
const tick = () => new Promise(resolve => setImmediate(resolve));

/** Actual existing isolated review code, synthetic Electron events/native dialogs
 * and private Core replies. This opens no GUI and performs no file/provider work. */
function fixture({ auto = 'approve', ready = true } = {}) {
  let alive = true, visible = true, minimized = false, focused = true, documentUrl = localUrl;
  const win = new EventEmitter(), ipcMain = new EventEmitter(), calls = [], children = [], dialogs = [];
  const contents = new EventEmitter(); contents.mainFrame = { url: localUrl };
  Object.assign(contents, { isDestroyed: () => !alive, getURL: () => documentUrl });
  Object.assign(win, { webContents: contents, isDestroyed: () => !alive, isVisible: () => visible, isMinimized: () => minimized,
    isFocused: () => focused, getContentBounds: () => ({ width: 900, height: 700 }), focus: () => assert.fail('The broker must never force focus') });
  const event = { sender: contents, senderFrame: contents.mainFrame };
  const raw = { operationId, reviewId: randomUUID(), reviewDigest: 'a'.repeat(64), expiresAt: Date.now() + 120000,
    path: 'C:\\Synthetic\\M3\\source.mjs', before: 'export const add=(a,b)=>a-b;\n', after: 'export const add=(a,b)=>a+b;\n' };
  raw.beforeDigest = sha(raw.before); raw.afterDigest = sha(raw.after);
  const checkRaw = { operationId, reviewId: randomUUID(), reviewDigest: 'b'.repeat(64), expiresAt: raw.expiresAt,
    cwd: 'C:\\Synthetic\\M3', argv: [nodeExecutable, '--test', '--test-isolation=none', '--test-reporter=tap', '--', './source.test.mjs'], inputs: ['source.test.mjs'] };
  const view = { id: operationId, owner: { kind: 'api-mission', missionId: 'mission-1', taskId: 'task-1', attemptId: 'attempt-1', planRevision: 1 },
    source: { resourceId: 'file-1', version: 1 }, title: 'source.mjs', phase: 'awaiting-native-review', patchDigest: 'c'.repeat(64),
    verification: { state: 'not-run', criterion: 'reviewed-selected-node-test' },
    barrier: { kind: 'native-patch-review', operationId, patchDigest: 'c'.repeat(64) }, updatedAt: new Date().toISOString() };
  const token = randomUUID(); let selected = { canceled: false, filePaths: ['C:\\Synthetic\\M3\\source.test.mjs'] }, response = 2,gesture=true,onGesture=async()=>{};
  const requestId=randomUUID(),prompt=JSON.stringify({intent:'Fix the selected file',source:raw.before}),signature='d'.repeat(64);
  const egress={requestId,reviewId:randomUUID(),expiresAt:new Date(raw.expiresAt).toISOString(),preview:{id:requestId,signature,providerId:'openai-api-vela'},
    review:{previewId:requestId,signature,providerId:'openai-api-vela',prompt,promptDigest:sha(JSON.stringify(prompt)),reviewDigest:'e'.repeat(64),context:{included:[{id:'file-1',kind:'resource',title:'source.mjs',content:raw.before}]},historyOmissions:[]}};
  let onCall = async () => {}, onPicker = async () => {}, onMessageBox = async () => {}, returnExtra, runnerState = 'passed';
  let nativeChoices = 0, consumed = false;
  const decide = (child, decision, extra = {}, suppliedToken) => ipcMain.emit('vela-review-decision', {
    sender: child.webContents, senderFrame: child.webContents.mainFrame, ...extra,
  }, { token: suppliedToken ?? child.options.webPreferences.additionalArguments[0].slice(20), decision });
  const preload = (child, extra = {}) => ipcMain.emit('vela-review-ready', { sender: child.webContents, senderFrame: child.webContents.mainFrame, ...extra },
    { token: child.options.webPreferences.additionalArguments[0].slice(20) });
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.destroyed = false; this.shown = false; this.webContents = new EventEmitter();
      this.webContents.mainFrame = { url: '',executeJavaScript:async script=>{assert.equal(script,'navigator.userActivation.isActive && document.hasFocus()');await onGesture();return gesture;} }; this.webContents.isDestroyed = () => this.destroyed;
      this.webContents.getURL = () => this.url; this.webContents.setWindowOpenHandler = handler => { this.openHandler = handler; }; children.push(this);
    }
    isDestroyed() { return this.destroyed; }
    isFocused() { return this.shown&&!this.destroyed; }
    getParentWindow() { return this.options.parent; }
    destroy() { this.destroyed = true; this.emit('closed'); }
    show() { this.shown = true; if (auto) queueMicrotask(() => decide(this, auto)); }
    loadURL(url) { this.url = url; this.webContents.mainFrame.url = url; queueMicrotask(() => { this.emit('ready-to-show'); if (ready) preload(this); }); return Promise.resolve(); }
  }
  const partition = { setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, webRequest: { onBeforeRequest() {} } };
  const runtime = { BrowserWindow, ipcMain, session: { fromPartition: () => partition }, dialog: {
    async showOpenDialog(parent, options) { assert.equal(parent, win); dialogs.push({ kind: 'picker', options }); await onPicker(); return selected; },
    async showMessageBox(parent, options) { assert.equal(parent, win); dialogs.push({ kind: 'check', options }); await onMessageBox(); return { response }; },
  } };
  const call = async (name, input) => {
    calls.push({ name, input: structuredClone(input) }); await onCall(name, input);
    if(name==='missionFileEditPrepareNative')return egress;
    if(name==='missionFileEditRunNative')return {id:requestId,intent:'Fix the selected file',state:'responded',context:{included:[]}};
    if (name === 'missionFileEditReviewNative') return raw;
    if (name === 'missionFileEditCheckReviewNative') { view.phase = 'applied'; view.verification.state = 'awaiting-native-review'; view.barrier = null; return checkRaw; }
    if (name === 'missionFileEditChoiceNative') {
      nativeChoices++; assert.match(input.nativeChoiceId, /^[a-f0-9-]{36}$/u);
      if (input.decision === 'no') { if (input.purpose === 'patch') view.phase = 'cancelled'; else view.verification.state = 'blocked'; view.barrier = null; return null; }
      if (input.purpose === 'patch') view.phase = 'approved'; else view.verification.state = 'approved';
      return { authority: token, expiresAt: raw.expiresAt };
    }
    if (name === 'missionFileEditApplyNative' || name === 'missionFileEditCheckRunNative') {
      assert.equal(nativeChoices, 1); assert.equal(consumed, false); assert.equal(input.authority, token); consumed = true;
      view.phase = 'applied'; view.source.version = 2; view.barrier = null;
      if (name === 'missionFileEditCheckRunNative') view.verification.state = runnerState;
      return { ...structuredClone(view), ...returnExtra };
    }
    if (name === 'missionFileEditRead') return structuredClone(view);
    assert.fail('Unexpected private command ' + name);
  };
  const broker = createMissionFileEditBroker({ win, trustedDocumentUrl: localUrl, call, runtime, nodeExecutable });
  return { broker, win, contents, event, raw, checkRaw, view,egress, runtime, call, calls, children, dialogs, token, decide, preload,
    command: (type = 'apply', extra = {}) => broker.command(event, { type, operationId, ...extra }),
    set focused(value) { focused = value; }, set visible(value) { visible = value; }, set minimized(value) { minimized = value; },
    set alive(value) { alive = value; }, set documentUrl(value) { documentUrl = value; }, set selected(value) { selected = value; },
    set response(value) { response = value; }, set onCall(value) { onCall = value; }, set onPicker(value) { onPicker = value; },
    set onMessageBox(value) { onMessageBox = value; }, set returnExtra(value) { returnExtra = value; }, set runnerState(value) { runnerState = value; },
    set gesture(value){gesture=value;},set onGesture(value){onGesture=value;},
  };
}

test('private command names are explicit and the native factory rejects nonlocal or credential-bearing documents', () => {
  assert.deepEqual(PRIVATE_MISSION_FILE_EDIT_COMMANDS, ['missionFileEditPrepareNative','missionFileEditRunNative','missionFileEditReviewNative', 'missionFileEditChoiceNative', 'missionFileEditApplyNative',
    'missionFileEditCheckReviewNative', 'missionFileEditCheckRunNative', 'missionFileEditRead']);
  const f = fixture();
  for (const trustedDocumentUrl of ['https://example.invalid/', 'http://example.invalid/', 'file://other-host/share/index.html', 'http://user:password@localhost/'])
    assert.throws(() => createMissionFileEditBroker({ win: f.win, trustedDocumentUrl, call: f.call }), /invalid_mission_file_edit_host/);
});

test('foreign senders, nonprimary frames, changed URL and unavailable owner cannot reach any private Core command', async () => {
  for (const fault of ['sender', 'subframe', 'frame-url', 'document-url', 'hidden', 'minimized', 'blurred', 'destroyed']) {
    const f = fixture(), event = { ...f.event };
    if (fault === 'sender') event.sender = {};
    if (fault === 'subframe') event.senderFrame = { url: localUrl };
    if (fault === 'frame-url') f.contents.mainFrame.url = 'file:///C:/other.html';
    if (fault === 'document-url') f.documentUrl = 'file:///C:/other.html';
    if (fault === 'hidden') f.visible = false;
    if (fault === 'minimized') f.minimized = true;
    if (fault === 'blurred') f.focused = false;
    if (fault === 'destroyed') f.alive = false;
    await assert.rejects(f.broker.command(event, { type: 'apply', operationId }), /owner_unavailable/);
    assert.equal(f.calls.length, 0); assert.equal(f.children.length, 0);
  }
});

test('renderer Yes, grants, native paths, review IDs, alternate commands and malformed operation IDs are rejected', async () => {
  const f = fixture();
  for (const input of [{ type: 'apply', operationId, approved: true }, { type: 'apply', operationId, authority: f.token },
    { type: 'verify', operationId, selectedTestPath: 'C:\\FORGED.test.mjs' }, { type: 'apply', operationId, reviewId: f.raw.reviewId },
    { type: 'applyNative', operationId }, { type: 'apply', operationId: 'not-a-canonical-operation' }, { type: 'apply', operationId, nativeChoiceId: randomUUID() },{type:'apply',operationId,decision:'no'}])
    await assert.rejects(f.broker.command(f.event, input), /invalid_mission_file_edit_command/);
  assert.equal(f.calls.length, 0);
});

test('actual isolated review code requires ready owned primary-frame/token events before native Yes can issue a one-use write receipt', async () => {
  const f = fixture({ auto: null, ready: false }), running = f.command(); await tick();
  const child = f.children[0]; assert.equal(child.shown, false);
  f.decide(child, 'approve'); f.preload(child, { senderFrame: { url: child.url } });
  assert.deepEqual(f.calls.map(item => item.name), ['missionFileEditReviewNative']);
  f.preload(child); assert.equal(child.shown, true);
  for (const extra of [{ sender: f.contents }, { senderFrame: { url: child.url } }, { senderFrame: f.contents.mainFrame }]) f.decide(child, 'approve', extra);
  f.decide(child, 'approve', {}, 'wrong-token'); await tick(); assert.equal(f.calls.length, 1);
  f.decide(child, 'approve'); const result = await running;
  assert.deepEqual(f.calls.map(item => item.name), ['missionFileEditReviewNative', 'missionFileEditChoiceNative', 'missionFileEditApplyNative']);
  const receipt = f.calls[1].input;
  assert.equal(receipt.reviewId, f.raw.reviewId); assert.equal(receipt.reviewDigest, f.raw.reviewDigest); assert.equal(receipt.purpose, 'patch'); assert.equal(receipt.decision, 'yes');
  assert.equal(result.phase, 'applied'); assert.ok(!JSON.stringify(result).includes(f.token)); assert.ok(!JSON.stringify(result).includes(f.raw.path));
  assert.equal(child.destroyed, true); assert.equal(f.runtime.ipcMain.eventNames().length, 0);
});

test('native Cancel preserves waiting without recording a native No', async () => {
  const f = fixture({ auto: 'cancel' }), result = await f.command();
  assert.equal(result.phase, 'awaiting-native-review'); assert.deepEqual(f.calls.map(item => item.name), ['missionFileEditReviewNative', 'missionFileEditRead']);
  assert.equal(f.calls.filter(item => item.name === 'missionFileEditChoiceNative').length, 0); assert.equal(f.children[0].destroyed, true);
});

test('genuine isolated native No records one patch denial then reads canonical state, with no apply authority/effect',async()=>{
  const f=fixture({auto:'reject'}),result=await f.command();assert.equal(result.phase,'cancelled');assert.equal(result.barrier,null);
  assert.deepEqual(f.calls.map(item=>item.name),['missionFileEditReviewNative','missionFileEditChoiceNative','missionFileEditRead']);
  assert.equal(f.calls[1].input.decision,'no');assert.equal(f.calls[1].input.purpose,'patch');assert.equal(f.calls[1].input.reviewDigest,f.raw.reviewDigest);
  assert.equal(f.calls.filter(item=>item.name==='missionFileEditChoiceNative').length,1);assert(!JSON.stringify(result).includes(f.token));
});

test('rejected or stale activation and expired review never record native No or apply',async t=>{
  const inactive=fixture({auto:'reject'});inactive.gesture=false;assert.equal((await inactive.command()).phase,'awaiting-native-review');assert.deepEqual(inactive.calls.map(item=>item.name),['missionFileEditReviewNative','missionFileEditRead']);
  const changed=fixture({auto:'reject'});changed.onGesture=async()=>{changed.contents.mainFrame={url:localUrl};};await assert.rejects(changed.command(),/owner_unavailable/);assert.equal(changed.calls.length,1);
  t.mock.timers.enable({apis:['Date','setTimeout']});const expired=fixture({auto:null}),waiting=expired.command();await tick();t.mock.timers.tick(120001);expired.decide(expired.children[0],'reject');
  assert.equal((await waiting).phase,'awaiting-native-review');assert.deepEqual(expired.calls.map(item=>item.name),['missionFileEditReviewNative','missionFileEditRead']);
});

test('stale canonical No acknowledgment fails closed without a retry, apply or invented decline',async()=>{
  const f=fixture({auto:'reject'});f.onCall=async name=>{if(name==='missionFileEditChoiceNative')throw Error('mission_edit_review_changed');};
  await assert.rejects(f.command(),/mission_edit_review_changed/);assert.equal(f.view.phase,'awaiting-native-review');
  assert.deepEqual(f.calls.map(item=>item.name),['missionFileEditReviewNative','missionFileEditChoiceNative']);assert.equal(f.calls[1].input.decision,'no');
});

test('unapproved patch review close cannot fabricate a native No receipt, token, apply or completed decline', async () => {
  const f = fixture({ auto: null }), running = f.command(); await tick();
  f.children[0].destroy(); const result = await running;
  assert.equal(result.phase, 'awaiting-native-review'); assert.equal(result.barrier.kind, 'native-patch-review');
  assert.deepEqual(f.calls.map(item => item.name), ['missionFileEditReviewNative', 'missionFileEditRead']);
  assert.equal(f.runtime.ipcMain.eventNames().length, 0); assert.ok(!JSON.stringify(result).includes(f.token));
});

test('owner focus loss and primary-frame replacement after review abort before minting native choice authority', async () => {
  for (const change of ['focus', 'primary-frame']) {
    const f = fixture({ auto: null }), running = f.command(); await tick();
    if (change === 'focus') { f.focused = false; f.children[0].emit('blur'); }
    else { f.decide(f.children[0], 'approve'); f.contents.mainFrame = { url: localUrl }; }
    await assert.rejects(running, /owner_unavailable/); assert.deepEqual(f.calls.map(item => item.name), ['missionFileEditReviewNative']);
    assert.equal(f.children[0].destroyed, true);
  }
});

test('invalid immutable review bodies, hashes, expiry, type or operation identity never open a review window', async () => {
  for (const change of [{ afterDigest: 'f'.repeat(64) }, { before: null, beforeDigest: null }, { path: 'C:\\Synthetic\\source.json' },
    { expiresAt: Date.now() - 1 }, { operationId: randomUUID() }, { reviewDigest: 'forged' }, { reviewId: 'forged' }, { grantId: 'private-extra' }]) {
    const f = fixture(); Object.assign(f.raw, change);
    await assert.rejects(f.command(), /invalid_(?:mission_file_edit_review|vela_edit_review)/); assert.equal(f.children.length, 0); assert.equal(f.calls.length, 1);
  }
});

test('review DTO is captured immutably; later mutation of a private transport object cannot replace displayed bytes or digest', async () => {
  const f = fixture({ auto: null }), expected = f.raw.reviewDigest, after = f.raw.after, running = f.command(); await tick();
  try {
    f.raw.after = 'export const changed=true;'; f.raw.afterDigest = sha(f.raw.after); f.raw.reviewDigest = 'f'.repeat(64);
    assert.ok(decodeURIComponent(f.children[0].url).includes(after.replace(/>/gu, '&gt;')));
    assert.ok(!decodeURIComponent(f.children[0].url).includes('export const changed=true;'));
    f.decide(f.children[0], 'approve'); await running; assert.equal(f.calls[1].input.reviewDigest, expected);
  } finally { if (!f.children[0].destroyed) f.decide(f.children[0], 'cancel'); await running; }
});

test('native choice issuance does not permit apply after owner focus changes during the private acknowledgment', async () => {
  const f = fixture(); f.onCall = async name => { if (name === 'missionFileEditChoiceNative') f.focused = false; };
  await assert.rejects(f.command(), /owner_unavailable/); assert.deepEqual(f.calls.map(item => item.name), ['missionFileEditReviewNative', 'missionFileEditChoiceNative']);
});

test('one owned window cannot have duplicate M3 reviews even through separate factory instances', async () => {
  const f = fixture({ auto: null }), running = f.command(); await tick();
  const sibling = createMissionFileEditBroker({ win: f.win, trustedDocumentUrl: localUrl, call: f.call, runtime: f.runtime, nodeExecutable });
  await assert.rejects(f.command(), /review_busy/); await assert.rejects(sibling.command(f.event, { type: 'apply', operationId }), /review_busy/);
  assert.equal(f.calls.length, 1); f.decide(f.children[0], 'cancel'); await running;
  assert.equal(f.runtime.ipcMain.eventNames().length, 0);
});

test('private command errors do not leak paths or source bodies and never trigger an automatic apply retry', async () => {
  const f = fixture(); f.onCall = async name => { if (name === 'missionFileEditApplyNative') throw Error('C:\\Private\\source.mjs: export const PRIVATE_BODY=true'); };
  await assert.rejects(f.command(), error => error.message === 'mission_file_edit_private_command_failed');
  assert.equal(f.calls.filter(item => item.name === 'missionFileEditApplyNative').length, 1);
  const stale = fixture(); stale.onCall = async name => { if (name === 'missionFileEditReviewNative') throw Error('mission_edit_source_changed'); };
  await assert.rejects(stale.command(), /mission_edit_source_changed/); assert.equal(stale.children.length, 0);
});

test('private authority or source fields cannot escape in public command results', async () => {
  for (const extra of [{ authority: 'private-token' }, { path: 'C:\\Private\\source.mjs' }, { before: 'PRIVATE_BODY' }, { grantId: 'private-grant' },{apiProvenance:{providerId:'openai-api-vela',executionId:'execution-1',responseId:'response-1',model:'model-1',path:'C:\\Private'}}]) {
    const f = fixture(); f.returnExtra = extra; await assert.rejects(f.command(), error => error.message === 'invalid_mission_file_edit_metadata');
  }
});

test('safe API attribution reaches shared details without private source, grant or output fields',async()=>{
  const f=fixture(),proof={providerId:'openai-api-vela',executionId:'execution-1',responseId:'response-1',model:'gpt-6-luna'};f.returnExtra={apiProvenance:proof};
  assert.deepEqual((await f.command()).apiProvenance,proof);
});

test('verification selects one real native path, reviews exact fixed argv, issues distinct check authority and returns safe metadata only', async () => {
  const f = fixture(), result = await f.command('verify');
  assert.deepEqual(f.calls.map(item => item.name), ['missionFileEditCheckReviewNative', 'missionFileEditChoiceNative', 'missionFileEditCheckRunNative']);
  assert.deepEqual(f.calls[0].input, { operationId, selectedTestPath: 'C:\\Synthetic\\M3\\source.test.mjs' });
  assert.equal(f.calls[1].input.purpose, 'check'); assert.equal(f.calls[1].input.reviewDigest, f.checkRaw.reviewDigest);
  assert.equal(f.dialogs[0].options.properties.includes('multiSelections'), false);
  assert.equal(f.dialogs[1].options.defaultId, 0); assert.equal(f.dialogs[1].options.cancelId, 0);
  assert.ok(f.dialogs[1].options.detail.includes(JSON.stringify(nodeExecutable))); assert.ok(f.dialogs[1].options.detail.includes('./source.test.mjs'));
  assert.equal(result.verification.state, 'passed'); assert.ok(!JSON.stringify(result).includes(f.token)); assert.ok(!JSON.stringify(result).includes(f.checkRaw.cwd));
});

test('native picker cancellation, check Cancel and explicit check No remain distinct without executing', async () => {
  const cancelled = fixture(); cancelled.selected = { canceled: true, filePaths: [] }; await cancelled.command('verify');
  assert.deepEqual(cancelled.calls.map(item => item.name), ['missionFileEditRead']); assert.equal(cancelled.dialogs.length, 1);
  const cancelledReview=fixture();cancelledReview.response=0;const pending=await cancelledReview.command('verify');assert.equal(pending.verification.state,'awaiting-native-review');
  assert.deepEqual(cancelledReview.calls.map(item=>item.name),['missionFileEditCheckReviewNative','missionFileEditRead']);
  const denied = fixture(); denied.response = 1; const result = await denied.command('verify');
  assert.equal(result.verification.state, 'blocked'); assert.deepEqual(denied.calls.map(item => item.name), ['missionFileEditCheckReviewNative', 'missionFileEditChoiceNative', 'missionFileEditRead']);
  assert.equal(denied.calls[1].input.decision, 'no');
});

test('changed executable/arguments, escaped input, different selected test and expired check review cannot reach command consent', async () => {
  for (const change of [{ argv: ['node', '--eval', 'process.exit(0)'] }, { inputs: ['../escape.test.mjs'] },
    { inputs: ['other.test.mjs'] }, { cwd: 'D:\\Other' }, { expiresAt: Date.now() - 1 }, { reviewDigest: 'forged' }]) {
    const f = fixture(); Object.assign(f.checkRaw, change);
    await assert.rejects(f.command('verify'), /invalid_mission_file_edit_check_review/); assert.equal(f.dialogs.length, 1); assert.equal(f.calls.length, 1);
  }
  for (const filePaths of [[], ['C:\\one.test.mjs', 'C:\\two.test.mjs'], ['C:\\ordinary.mjs'], ['C:\\line\nbreak.test.mjs']]) {
    const f = fixture(); f.selected = { canceled: false, filePaths }; await assert.rejects(f.command('verify'), /invalid_mission_file_edit_check_selection/); assert.equal(f.calls.length, 0);
  }
});

test('native focus loss during picker or command review blocks the next private command without forcing focus', async () => {
  const selected = fixture(); selected.onPicker = async () => { selected.focused = false; };
  await assert.rejects(selected.command('verify'), /owner_unavailable/); assert.equal(selected.calls.length, 0);
  const reviewed = fixture(); reviewed.onMessageBox = async () => { reviewed.focused = false; };
  await assert.rejects(reviewed.command('verify'), /owner_unavailable/); assert.deepEqual(reviewed.calls.map(item => item.name), ['missionFileEditCheckReviewNative']);
});

test('unknown check outcome remains unknown; broker has no replay, runner-release or direct Node execution path', async () => {
  const f = fixture(); f.runnerState = 'unknown';
  const result = await f.command('verify'); assert.equal(result.verification.state, 'unknown');
  assert.equal(f.calls.filter(item => item.name === 'missionFileEditCheckRunNative').length, 1);
  assert.ok(f.calls.every(item => PRIVATE_MISSION_FILE_EDIT_COMMANDS.includes(item.name)));
});

test('API preparation runs only after the exact source-bearing native sharing review; no write authority is issued',async()=>{
  const f=fixture(),result=await f.broker.prepare(f.event,{intent:'Fix the selected file',resourceIds:['file-1']});
  assert.deepEqual(f.calls.map(item=>item.name),['missionFileEditPrepareNative','missionFileEditRunNative']);
  assert.deepEqual(f.calls[1].input,{requestId:f.egress.requestId,reviewId:f.egress.reviewId,reviewDigest:f.egress.review.reviewDigest});
  assert.equal(result.id,f.egress.requestId);assert.ok(!JSON.stringify(result).includes(f.raw.before));assert.ok(!JSON.stringify(result).includes(f.raw.path));
  assert.equal(f.children[0].destroyed,true);assert.equal(f.runtime.ipcMain.eventNames().length,0);
});

test('unapproved API sharing or changed owner cannot dispatch preparation or fabricate provider consent',async()=>{
  const f=fixture({auto:'cancel'});await assert.rejects(f.broker.prepare(f.event,{intent:'Fix the selected file',resourceIds:['file-1']}),/authorization_cancelled/);
  assert.deepEqual(f.calls.map(item=>item.name),['missionFileEditPrepareNative']);
  const changed=fixture({auto:null}),running=changed.broker.prepare(changed.event,{intent:'Fix the selected file',resourceIds:['file-1']});await tick();changed.decide(changed.children[0],'approve');changed.focused=false;
  await assert.rejects(running,/owner_unavailable/);assert.deepEqual(changed.calls.map(item=>item.name),['missionFileEditPrepareNative']);
});
