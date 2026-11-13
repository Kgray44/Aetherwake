const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const helper = require('../native/integration-chat-motion.cjs');
const { assertOwnedApplicationProfile } = require('../native/integration-checklists.cjs');
const { createSlot } = require('../native/integration-resource-opening.cjs');
const { validateBudget, admitPNG } = require('../native/integration-desktop-basics.cjs');
const { FIXTURE } = helper;
const counters = () => ({ scope: 'process-session-native-attempts', codexConnections: 0, providerRequests: 0, systemMemoryReads: 0 });
const events = () => ({ truncated: false, events: [{ type: 'conversation/message', nativeSequence: null }] });
const fixture = () => {
 const conversation = { resourceId: 'synthetic-chat', conversationId: 'synthetic-graph', providerId: 'local', title: FIXTURE.title, state: 'active', revision: 3 }, messages = [FIXTURE.first, FIXTURE.second].map((content, i) => ({ id: 'synthetic-message-' + i, resourceId: 'synthetic-chat', role: 'user', content, inherited: false, createdAt: '2026-11-02T00:00:0' + i + 'Z' }));
 return { detail: { conversation, messages: { items: messages, total: 2, hasMore: false }, lineage: [], shares: [], policy: {} }, draft: { resourceId: 'synthetic-chat', version: 9, content: FIXTURE.draft }, desktop: { projects: [], workspaces: [], blocks: [], resources: [{ id: 'synthetic-chat', kind: 'conversation' }], relationships: [] }, core: { conversations: [conversation], resourceMap: { 'synthetic-chat': 'synthetic-graph' }, graph: { conversations: [{ id: 'synthetic-graph' }], messages }, executions: {}, handoffs: {}, bindings: { 'synthetic-chat': [] } }, collections: [{ id: 'synthetic-folder', title: FIXTURE.folder, state: 'active', parentId: null, version: 1, memberIds: [] }] };
};
const canonical = f => helper.canonicalChat(f.detail, f.draft, f.desktop, f.core, f.collections);

test('native motion helper requires exact owned flag/C profile/window and the canonical root with only its Chromium child', () => {
 const root = 'C:\\Owned\\review-chat-motion-123'; helper.assertOwnedProfile(root, ['--integration-chat-motion'], 'Aerynth Automated check'); assertOwnedApplicationProfile(root, root + '\\chromium', ['--profile=' + root]);
 for (const value of ['D:\\review-chat-motion-123', 'C:\\Owned\\review-chat-motion-personal', 'review-chat-motion-123']) assert.throws(() => helper.assertOwnedProfile(value, ['--integration-chat-motion'], 'Automated check'));
 assert.throws(() => helper.assertOwnedProfile(root, [], 'Automated check')); assert.throws(() => helper.assertOwnedProfile(root, ['--integration-chat-motion'], 'User review'));
 for (const value of [root, root + '\\chromium-other', 'C:\\Owned\\review-chat-motion-124\\chromium']) assert.throws(() => assertOwnedApplicationProfile(root, value, ['--profile=' + root]));
});

test('wrong actual Chromium profile performs zero control, RPC, evidence or app exit', async () => {
 const argv = process.argv, log = console.log; process.argv = [...argv, '--integration-chat-motion', '--record-chat-motion']; console.log = () => {}; let controls = 0; const forbidden = () => { controls++; throw Error('unowned_control'); };
 try { const result = await helper.verify({ privateRoot: 'C:\\Owned\\review-chat-motion-123', win: { getTitle: () => 'Automated check', on: forbidden, webContents: { executeJavaScript: forbidden, sendInputEvent: forbidden } }, app: { getPath: () => 'C:\\Owned\\review-chat-motion-124\\chromium', exit: forbidden }, call: forbidden }); assert.equal(result.passed, false); assert.match(result.error.message, /actual_same_owned_application_profile_required/); assert.equal(controls, 0); assert.equal(result.reserve, undefined); assert.equal(result.nativeCloseConfirmed, undefined); }
 finally { process.argv = argv; console.log = log; }
});

test('representative search requires its explicit owned profile and a complete synthetic seed receipt', () => {
 const root = 'C:\\Owned\\library-scale-123-abcdef01\\large';
 const args = ['--integration-chat-motion', '--chat-search-seeded'];
 helper.assertOwnedProfile(root, args, 'Automated check');
 assert.throws(() => helper.assertOwnedProfile(root, args.slice(0, 1), 'Automated check'));
 assert.throws(() => helper.assertOwnedProfile(root, [...args, '--record-chat-motion'], 'Automated check'));
 assert.throws(() => helper.assertOwnedProfile(root.replace(/large$/, 'medium'), args, 'Automated check'));
 const target = { resourceId: '12345678-1234-1234-1234-123456789abc', messageId: 'msg-01019',
  query: 'SYNTHETIC_RARE_LIBRARY_TOKEN', draft: 'Synthetic unsent search acceptance draft.' };
 const receipt = { contract: 'aerynth.library-scale@1', synthetic: true, passed: true, providerCalls: 0,
  dataset: { name: 'large', actual: { conversations: 1072, graphMessages: 12072 } },
  profile: { directory: 'large', database: 'aerynth.sqlite', reopenedThroughCore: true, contentPolicy: 'local-private', sha256: 'a'.repeat(64), target } };
 assert.deepEqual(helper.validateSearchSeed(receipt), { ...target, databaseDigest: receipt.profile.sha256 });
 assert.throws(() => helper.validateSearchSeed({ ...receipt, providerCalls: 1 }), /passing_synthetic_search_seed_required/);
 assert.throws(() => helper.validateSearchSeed({ ...receipt, dataset: { name: 'large', actual: { conversations: 1, graphMessages: 2 } } }));
});

test('only bounded actual canonical reads are admitted; all creation/provider/auth/save paths require UI and never helper RPC', () => {
 for (const name of ['detail', 'readDraft', 'readViewState']) helper.assertRead('conversation', { name, input: { resourceId: 'synthetic-chat', ...(name === 'detail' ? { limit: 50 } : {}) } });
 helper.assertRead('conversation', { name: 'collections', input: {} }); helper.assertRead('conversation', { name: 'list', input: { limit: 50 } }); helper.assertRead('desktop', { type: 'snapshot' }); helper.assertRead('snapshot', {}); helper.assertRead('replay', { after: 0 });
 for (const name of ['send', 'create', 'saveDraft', 'branch', 'organize', 'selectProvider']) assert.throws(() => helper.assertRead('conversation', { name, input: {} }));
 for (const name of ['execute', 'providerConnection', 'providerAuth', 'ordinaryProviderCheck', 'notes', 'vela']) assert.throws(() => helper.assertRead(name, {}));
 assert.throws(() => helper.assertRead('desktop', { type: 'createResource' })); assert.throws(() => helper.assertRead('conversation', { name: 'detail', input: { resourceId: 'synthetic-chat', limit: 51 } })); assert.throws(() => helper.assertRead('conversation', { name: 'readDraft', input: { resourceId: 'synthetic-chat', content: 'forbidden' } }));
});

test('seeded search observes only the exact visible matching text and unchanged draft', () => {
 const target = {resourceId:'synthetic-chat',messageId:'msg-1',query:'RARE_MARKER',draft:'Unsent draft'};
 const switcher = {open:false};
 const editor = {value:target.draft};
 const content = {contains: node => node === content};
 const clip = {top:100,bottom:300,left:50,right:600};
 const rect = {top:120,bottom:136,left:80,right:160,width:80,height:16};
 let hit = content, text = 'Prefix RARE_MARKER suffix';
 const messages = {
   querySelector: selector => selector === '[data-message-id="msg-1"] .cp-message-content' ? content : null,
   getBoundingClientRect: () => clip,
 };
 const chat = {querySelector: selector => selector === '.cp-messages' ? messages : selector === 'textarea' ? editor : null};
 const manager = {
   dataset:{resourceId:target.resourceId},
   querySelector: selector => selector === '.cp-switcher' ? switcher : selector === '.cp-chat[data-resource-id="synthetic-chat"]' ? chat : null,
 };
 const context = {
   CSS:{escape: value => value}, NodeFilter:{SHOW_TEXT:4}, innerHeight:800, innerWidth:1100,
   document:{
     querySelector: () => manager,
     createTreeWalker: node => {
       assert.equal(node,content);
       const nodes = [{textContent:text}].values();
       return {nextNode: () => nodes.next().value ?? null};
     },
     createRange: () => ({
       setStart: (_node,offset) => assert.equal(offset,7),
       setEnd: (_node,offset) => assert.equal(offset,18),
       getClientRects: () => [rect],
     }),
     elementFromPoint: () => hit,
   },
 };
 const observed = requireClosed => vm.runInNewContext(helper.seededSearchVisibleScript(target,requireClosed),context);
 assert.equal(observed(true),true);
 switcher.open=true; assert.equal(observed(true),false); assert.equal(observed(false),true);
 switcher.open=false;
 hit={}; assert.equal(observed(true),false); hit=content;
 rect.bottom=301; assert.equal(observed(true),false); rect.bottom=136;
 text='Other content in the same message'; assert.equal(observed(true),false); text='Prefix RARE_MARKER suffix';
 editor.value='Different draft'; assert.equal(observed(true),false);
});

test('local-only proof needs actual zero attempt counters, complete events and no assistant/native execution', () => {
 const f = fixture(); helper.assertNoProvider(f.core, events(), counters());
 for (const key of ['codexConnections', 'providerRequests', 'systemMemoryReads']) assert.throws(() => helper.assertNoProvider(f.core, events(), { ...counters(), [key]: 1 }));
 assert.throws(() => helper.assertNoProvider(f.core, events(), null)); assert.throws(() => helper.assertNoProvider(f.core, { ...events(), truncated: true }, counters())); assert.throws(() => helper.assertNoProvider(f.core, { truncated: false, events: [{ type: 'provider/connection' }] }, counters()));
 for (const change of [c => c.executions.e = {}, c => c.handoffs.h = {}, c => c.bindings.x = [{ threadId: 'native' }], c => c.conversations[0].providerId = 'chatgpt-plan-responses', c => c.graph.messages[0].role = 'assistant']) { const copy = structuredClone(f.core); change(copy); assert.throws(() => helper.assertNoProvider(copy, events(), counters())); }
});

test('restart canonical proof binds real local messages/IDs/draft revision and folder, without workspace/placeholder creation', () => {
 const f = fixture(); assert.equal(canonical(f).draft.version, 9);
 for (const change of [f => f.detail.messages.items[0].id = f.detail.messages.items[1].id, f => f.detail.messages.items[0].content = 'changed', f => f.draft.content = '', f => f.draft.version = 0, f => f.core.resourceMap['synthetic-chat'] = 'other', f => f.desktop.workspaces.push({ id: 'extra' }), f => f.desktop.resources[0].kind = 'note', f => f.collections[0].title = 'changed', f => f.collections[0].memberIds.push('other')]) { const value = structuredClone(f); change(value); assert.throws(() => canonical(value)); }
});

test('MC opening/closing/reversal observations require real intermediate painted bounds, semantics and matching sampled opacity', () => {
 const opening = { semanticOpen: true, nativeOpen: true, contentVisibility: 'visible', inert: false, hidden: false, paintable: true, height: 120, opacity: .4, cssSample: '.4' }, closing = { ...opening, semanticOpen: false, nativeOpen: false, inert: true };
 helper.assertMotionSample(opening, 'details', 'opening'); helper.assertMotionSample(closing, 'details', 'closing'); helper.assertMotionSample(opening, 'details', 'opening'); helper.assertMotionSample({ ...opening, opacity: 1, cssSample: '1' }, 'details', 'settled'); helper.assertMotionSample({ ...closing, opacity: 0, cssSample: '0', height: 0, hidden: true }, 'details', 'closed');
 for (const change of [v => v.paintable = false, v => v.opacity = 0, v => v.height = 0, v => v.nativeOpen = true, v => v.hidden = true, v => v.inert = false, v => v.cssSample = '1', v => v.contentVisibility = 'hidden']) { const v = { ...closing }; change(v); assert.throws(() => helper.assertMotionSample(v, 'details', 'closing')); }
 assert.throws(() => helper.assertMotionSample({ ...opening, opacity: 1, cssSample: '1' }, 'picker', 'opening'));
});

test('tight layout never qualifies clipped composer, nested chat scrolling or a canonical line wholly outside the transcript', () => {
 const value = { rootOverflow: false, inputHit: true, sendHit: true, redundantProviderSelects: 0, messages: { height: 120 }, input: { height: 34 }, send: { height: 30 }, lines: [{ fullyVisible: true, height: 20 }], scrollOwners: ['cp-messages'] }; helper.assertGeometry(value);
 for (const change of [v => v.rootOverflow = true, v => v.sendHit = false, v => v.input.height = 8, v => v.messages.height = 40, v => v.lines[0].fullyVisible = false, v => v.scrollOwners.push('cp-draft-recovery'), v => v.redundantProviderSelects = 1]) { const v = structuredClone(value); change(v); assert.throws(() => helper.assertGeometry(v)); }
});

test('restoring requires original PASS/close and exact helper/source/build/canonical identity; failures remain nonqualifying', () => {
 const source = { hashes: { source: 'a'.repeat(64) }, buildAssets: { 'app.js': 'b'.repeat(64) } }, projection = canonical(fixture()), checkpoint = { contract: 'aerynth.chat-motion-checkpoint@1', source, moduleHashes: { helper: 'c'.repeat(64) }, canonical: projection }, receipt = { contract: 'aerynth.chat-motion-integration@1', passed: true, restore: false, nativeCloseConfirmed: true, source, moduleHashes: checkpoint.moduleHashes, canonical: projection }; helper.passingCheckpoint(checkpoint, receipt);
 for (const change of [r => r.passed = false, r => r.nativeCloseConfirmed = false, r => r.restore = true, r => r.source.buildAssets['app.js'] = 'd'.repeat(64), r => r.canonical.draft.version++, r => r.canonical.messages.items[0].id = 'replacement']) { const r = structuredClone(receipt); change(r); assert.throws(() => helper.passingCheckpoint(checkpoint, r)); }
 const recorded = { ...receipt, recording: { requested: true, status: 'complete' }, video: videoAck() }; helper.passingCheckpoint(checkpoint, recorded);
 const readingScope = 'resize-search-and-reading';
 helper.passingCheckpoint({ ...checkpoint, scope: readingScope }, { ...receipt, scope: readingScope });
 assert.throws(() => helper.passingCheckpoint({ ...checkpoint, scope: 'full-chat-motion' }, { ...receipt, scope: readingScope }), /original_chat_motion_scope_required/);
 assert.throws(() => helper.passingCheckpoint(checkpoint, { ...recorded, recording: { requested: true, status: 'incomplete' } }), /recording_ack_required/);
 assert.throws(() => helper.passingCheckpoint(checkpoint, { ...recorded, video: { file: 'chat-motion.webm' } }), /video_ack_invalid/);
});

test('renderer query generators serialize selector/id data; no injected input or control is executed', () => {
 const selector = "x'); throw Error('injected');//"; let queried; const value = vm.runInNewContext(helper.motionScript(selector, 'details'), { document: { querySelector(s) { queried = s; return null; } } }); assert.equal(value, null); assert.equal(queried, selector);
 for (const fn of [helper.viewScript, helper.geometryScript]) assert.equal(typeof new vm.Script(fn(selector)), 'object');
});

test('45/12 slots retain sticky focus loss and cleanup while combined PNG budget cannot be reset on restart', () => {
 let focused = true, now = 0; const win = { isDestroyed: () => false, isVisible: () => true, isMinimized: () => false, isFocused: () => focused, webContents: { isDestroyed: () => false } }, slot = createSlot({ win, startedAt: 0, limitMs: 45000, cleanupMs: 4000, now: () => now }); focused = false; assert.throws(() => slot.check()); focused = true; assert.throws(() => slot.check()); const restore = createSlot({ win, startedAt: 0, limitMs: 12000, cleanupMs: 2500, now: () => now }); now = 9500; assert.throws(() => restore.check()); assert.equal(restore.remaining(), 2500);
 const budget = { count: 0, bytes: 0, files: [] }, png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(8)]); admitPNG(budget, png, 'before'); admitPNG(budget, png, 'after'); const copy = validateBudget(structuredClone(budget)); admitPNG(copy, png, 'restore'); assert.throws(() => admitPNG(copy, png, 'fourth'));
});

const videoBudget = () => ({ count: 0, bytes: 0, files: [], videos: 0, videoBytes: 0 });
const videoAck = (file = 'chat-motion.webm') => ({ file, byteCount: 1024, sha256: 'a'.repeat(64), durationMs: 750, startedAt: 1700000000000, readyAt: 1700000000500, mimeType: 'video/webm;codecs=vp9', source: 'Exact application BrowserWindow', audio: false, requestedFrameRate: 30 });
function recording(overrides = {}) { const budget = videoBudget(), win = {}, session = {}, localURL = 'http://127.0.0.1:1234/synthetic', stops = [], starts = []; const control = helper.optionalRecording({ requested: true, restore: false, slot: { check() {}, workRemaining: () => 100, remaining: () => 4500 }, win, session, localURL, out: 'synthetic-owned-evidence', budget, start: async (...args) => { starts.push(args); return { stop: async destination => { stops.push(destination); return videoAck(require('node:path').basename(destination)); } }; }, ...overrides }); return { ...control, budget, win, session, localURL, starts, stops }; }
test('chat video is opt-in initial only and one exact owned window/session/URL gets one stop acknowledgement', async () => {
 for (const [requested, restore, status] of [[false, false, 'not-requested'], [true, true, 'skipped-restore']]) { const f = recording({ requested, restore, start: async () => assert.fail('capture must not start') }); await f.begin(); assert.equal(await f.finish(true), undefined); assert.equal(f.state.status, status); assert.equal(f.budget.videos, 0); }
 const f = recording(); await f.begin(); assert.equal(f.state.status, 'recording'); assert.deepEqual(f.starts, [[f.win, f.session, f.localURL]]); await assert.rejects(f.begin(), /recording_once_only/);
 const first = await f.finish(true); assert.deepEqual(first, videoAck()); assert.deepEqual(await f.finish(true), first); assert.equal(f.stops.length, 1); assert.match(f.stops[0], /chat-motion\.webm$/); assert.equal(f.state.status, 'complete'); assert.equal(f.budget.videos, 1); assert.equal(f.budget.videoBytes, 1024);
});
test('video admission requires real bounded stop metadata, never mere file identity or audio/foreign source', () => {
 const budget = videoBudget(), png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(8)]); admitPNG(budget, png, 'initial-1'); const pngs = structuredClone(budget.files);
 for (const patch of [{ byteCount: 0 }, { byteCount: 32 * 1024 * 1024 + 1 }, { audio: true }, { source: 'Other Window' }, { file: '../chat-motion.webm' }, { mimeType: 'video/mp4' }, { sha256: 'missing' }, { durationMs: 45001 }, { requestedFrameRate: 120 }]) assert.throws(() => helper.admitVideo(budget, { ...videoAck(), ...patch }, 'chat-motion.webm'), /video_ack_invalid/);
 assert.throws(() => helper.admitVideo(budget, { file: 'chat-motion.webm' }, 'chat-motion.webm'), /video_ack_invalid/); assert.equal(budget.videos, 0);
 const accepted = helper.admitVideo(budget, { ...videoAck(), byteCount: 32 * 1024 * 1024, privateExtra: 'never retained' }, 'chat-motion.webm'); assert.equal(accepted.privateExtra, undefined); assert.deepEqual(budget.files, pngs); assert.equal(helper.validateMotionBudget(structuredClone(budget)).videos, 1); assert.throws(() => helper.admitVideo(budget, videoAck(), 'chat-motion.webm'), /video_ack_invalid/); assert.throws(() => helper.validateMotionBudget({ ...budget, videos: 0 }), /video_budget_invalid/);
});
test('failed or late recorder startup is explicitly incomplete and a late handle gets only one cleanup stop', async () => {
 const failed = recording({ start: async () => { throw Error('PRIVATE recorder error'); } }); await assert.rejects(failed.begin(), /^Error: chat_motion_recording_start_incomplete$/); assert.equal(await failed.finish(true), undefined); assert.deepEqual(failed.state, { requested: true, status: 'incomplete', errorCode: 'chat_motion_recording_start_incomplete' });
 let starts = 0; const noTime = recording({ slot: { check() {}, workRemaining: () => 0, remaining: () => 1500 }, start: async () => { starts++; } }); await assert.rejects(noTime.begin(), /start_incomplete/); assert.equal(starts, 0);
 let resolveStart, stopCalls = 0; const late = recording({ slot: { check() {}, workRemaining: () => 4, remaining: () => 1510 }, start: () => new Promise(resolve => { resolveStart = resolve; }) }); await assert.rejects(late.begin(), /start_incomplete/); assert.equal(await late.finish(true), undefined);
 resolveStart({ stop: async destination => { stopCalls++; assert.match(destination, /partial-chat-motion\.webm$/); return videoAck('partial-chat-motion.webm'); } }); await new Promise(resolve => setImmediate(resolve)); assert.equal(await late.finish(true), undefined); assert.equal(stopCalls, 1); assert.equal(late.state.status, 'incomplete'); assert.equal(late.budget.videos, 0, 'Late cleanup does not admit a movie');
});
test('stop respects the canonical close reserve, and late/failed stop cannot admit media or retry', async () => {
 let settle, stops = 0; const f = recording({ slot: { check() {}, workRemaining: () => 100, remaining: () => 1504 }, start: async () => ({ stop: () => { stops++; return new Promise(resolve => { settle = resolve; }); } }) }); await f.begin(); await assert.rejects(f.finish(true), /stop_incomplete/); assert.equal(f.state.status, 'incomplete'); assert.equal(f.budget.videos, 0);
 settle(videoAck()); await new Promise(resolve => setImmediate(resolve)); await assert.rejects(f.finish(true), /stop_incomplete/); assert.equal(stops, 1); assert.equal(f.budget.videos, 0);
 let immediate = 0; const noTime = recording({ slot: { check() {}, workRemaining: () => 100, remaining: () => 1500 }, start: async () => ({ stop: async () => { immediate++; return videoAck(); } }) }); await noTime.begin(); await assert.rejects(noTime.finish(true), /stop_incomplete/); assert.equal(immediate, 1); assert.equal(noTime.budget.videos, 0);
 const partial = recording(); await partial.begin(); assert.equal((await partial.finish(false)).file, 'partial-chat-motion.webm'); assert.equal(partial.state.status, 'incomplete'); assert.equal(partial.budget.videos, 1);
});

test('helper has only native actual UI mutations, FALSE evaluation, observed input barriers, positive draw and guarded cleanup', () => {
 const source = fs.readFileSync(require.resolve('../native/integration-chat-motion.cjs'), 'utf8'); assert(source.includes('executeJavaScript(code, false)')); assert(source.includes('fillNative({ click, key, js, wait')); assert(source.includes('native reading scroll delivery and settling'));
 assert(!/executeJavaScript\([^\n]+, true\)|createDriver\(|driver\.js\(|win\.focus\(|webContents\.focus\(|globalShortcut|setCursorPos|\.click\(\)|\.focus\(\)|window\.__aerynth\.(?:execute|openResource|setReduced)\(/.test(source));
 assert(source.includes('assertRead(name, input)')); assert(source.includes('next.frames > before.frames && next.draws > before.draws')); assert(source.includes('original_passing_chat_motion_receipt_required')); assert(source.includes("call('close', {})")); assert(source.indexOf("win.removeListener('blur'") > source.indexOf("call('close'")); assert(source.includes('Exact saved caret, selection and authorized message anchor restored'));
 assert.equal(source.match(/\.startWindowRecording\(/g).length, 1); assert(source.includes("process.argv.includes('--record-chat-motion')")); assert(source.indexOf('recording?.finish(') < source.indexOf("call('close'")); assert(source.includes('(record && !restore ? 64 : 32) * MiB'));
});
