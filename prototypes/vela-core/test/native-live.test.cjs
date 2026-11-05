const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {createSlot,trustedReviewWindow,nativeFocusSnapshot,consoleRecord,cancelObservedPlanning,submitStableTarget,readNativeRequestDiagnostics,nativeRequestFailure} = require('./native-live.cjs')._offline;

/** Pure lifecycle fixtures only. These never launch Electron or qualify actual native/provider behavior. */
function fixture(){
  let clock=100, focused=true, enabled=true; const windows=[];
  const win={isDestroyed:()=>false,isVisible:()=>true,isMinimized:()=>false,isFocused:()=>focused,isEnabled:()=>enabled,webContents:{isDestroyed:()=>false}};
  const child={id:7,isDestroyed:()=>false,isVisible:()=>true,isMinimized:()=>false,isFocused:()=>true,isModal:()=>true,getParentWindow:()=>win,webContents:{isDestroyed:()=>false,getLastWebPreferences:()=>({contextIsolation:true,sandbox:true,nodeIntegration:false}),getURL:()=> 'data:text/html;charset=utf-8,'+encodeURIComponent('<title>Vela · Review sharing</title>')}};
  const ownsNativeReviewWindow=(candidate,parent)=>candidate===child&&parent===win;
  const slot=createSlot({win,slotStartedAt:100,deadlineMs:85000,ownsNativeReviewWindow,now:()=>clock,windows:()=>windows});
  return {win,child,slot,windows,ownsNativeReviewWindow,advance:value=>{clock+=value;},focus:value=>{focused=value;},enable:value=>{enabled=value;}};
}

test('one monotonic slot includes startup and cleanup; invalid/extended budgets fail closed',()=>{
  const f=fixture();assert.equal(f.slot.check().kind,'parent');f.advance(83499);assert.equal(f.slot.remaining(),1);f.advance(1);assert.throws(()=>f.slot.check(),/slot_deadline/);f.advance(-80000);assert.throws(()=>f.slot.check(),/slot_deadline/,'Abort remains sticky, even if a caller clock is moved backwards');
  assert.throws(()=>createSlot({win:f.win,deadlineMs:85001}),/invalid_vela_live_deadline/);assert.throws(()=>createSlot({win:f.win,deadlineMs:1500}),/invalid_vela_live_deadline/);
});

test('real focus loss aborts immediately without refocus, renderer calls or a recovery wait',async()=>{
  const f=fixture();f.focus(false);assert.throws(()=>f.slot.check(),/focus_lost/);f.focus(true);let invoked=0;await assert.rejects(f.slot.bound(()=>{invoked++;}),/focus_lost/);assert.equal(invoked,0);
});

test('only the focused actual parent-disabled review child permits observational suspension',()=>{
  const f=fixture();f.windows.push(f.child);f.enable(false);f.focus(false);f.slot.consent(true);assert.equal(f.slot.check(true).child,f.child);assert.throws(()=>f.slot.check(),/focus_lost/,'Parent input/RPC guard remains closed during review');
  for(const change of [c=>{c.isModal=()=>false;},c=>{c.getParentWindow=()=>({});},c=>{c.isFocused=()=>false;},c=>{c.webContents.getURL=()=> 'https://example.invalid/';},c=>{c.webContents.getLastWebPreferences=()=>({sandbox:true,contextIsolation:false,nodeIntegration:false});},c=>{c.webContents.getLastWebPreferences=()=>({sandbox:false,contextIsolation:true,nodeIntegration:false});},c=>{c.webContents.getLastWebPreferences=()=>({sandbox:true,contextIsolation:true,nodeIntegration:true});}]){
    const v=fixture();v.enable(false);v.focus(false);change(v.child);assert.equal(trustedReviewWindow(v.win,[v.child],v.ownsNativeReviewWindow),null);
  }
  const enabled=fixture();assert.equal(trustedReviewWindow(enabled.win,[enabled.child],enabled.ownsNativeReviewWindow),null,'A matching title or child alone never authorizes the modal exception');
});

test('positive exact host ownership attestation accepts exposed security fields without undocumented preload metadata',()=>{
  const f=fixture();f.enable(false);f.focus(false);let attestations=0;
  assert.equal(trustedReviewWindow(f.win,[f.child],(child,parent)=>{attestations++;assert.equal(child,f.child);assert.equal(parent,f.win);return f.ownsNativeReviewWindow(child,parent);}),f.child);assert.equal(attestations,1);
  const snapshot=nativeFocusSnapshot(f.win,()=>[f.child],f.ownsNativeReviewWindow);assert.equal(snapshot.windows[0].trust.hostAttested,true);assert.equal(snapshot.windows[0].metadata.preloadMetadataPresent,false);assert.equal(snapshot.windows[0].metadata.tokenArgumentsMetadataPresent,false);assert.equal(snapshot.windows[0].trustedByCurrentPredicate,true);
});

test('absent, false, throwing, nonboolean and wrong-window host attestations remain fail closed without fallback or grace',()=>{
  for(const mode of ['absent','false','throw','nonboolean','wrong-window']){
    const f=fixture();f.enable(false);f.focus(false);const candidate=mode==='wrong-window'?{...f.child}:f.child;
    const checked=mode==='absent'?undefined:mode==='false'?()=>false:mode==='throw'?()=>{throw Error('private host failure');}:mode==='nonboolean'?()=>1:f.ownsNativeReviewWindow;
    assert.equal(trustedReviewWindow(f.win,[candidate],checked),null);
    const slot=createSlot({win:f.win,slotStartedAt:100,deadlineMs:85000,now:()=>100,windows:()=>[candidate],ownsNativeReviewWindow:checked});slot.consent(true);assert.throws(()=>slot.check(true),/focus_lost/);assert.equal(slot.focusFailureSnapshot().windows[0].trust.hostAttested,['throw','nonboolean'].includes(mode)?null:false);f.focus(true);f.enable(true);assert.throws(()=>slot.check(true),/focus_lost/);
  }
  const f=fixture();f.enable(false);assert.equal(f.ownsNativeReviewWindow(f.child,{}),false);const other={...f.child};assert.equal(f.ownsNativeReviewWindow(other,f.win),false);
});

test('first focus failure distinguishes hidden/loading, disabled-parent gap and visible-unfocused child without waiting or changing abort',()=>{
  const hidden=fixture();hidden.enable(false);hidden.focus(false);hidden.windows.push(hidden.child);hidden.child.isVisible=()=>false;hidden.child.webContents.isLoading=()=>true;hidden.child.webContents.getURL=()=>'';hidden.slot.consent(true);
  assert.throws(()=>hidden.slot.check(true),/focus_lost/);const loading=hidden.slot.focusFailureSnapshot();assert.equal(loading.parent.enabled,false);assert.equal(loading.windows[0].visible,false);assert.equal(loading.windows[0].loading,true);assert.equal(loading.windows[0].trust.reviewDataUrlShape,false);assert.equal(loading.windows[0].trustedByCurrentPredicate,false);
  const gap=fixture();gap.enable(false);gap.focus(false);gap.slot.consent(true);assert.throws(()=>gap.slot.check(true),/focus_lost/);assert.equal(gap.slot.focusFailureSnapshot().parent.enabled,false);assert.deepEqual(gap.slot.focusFailureSnapshot().windows,[]);
  const unfocused=fixture();unfocused.enable(false);unfocused.focus(false);unfocused.windows.push(unfocused.child);unfocused.child.isFocused=()=>false;unfocused.slot.consent(true);assert.throws(()=>unfocused.slot.check(true),/focus_lost/);const snapshot=unfocused.slot.focusFailureSnapshot();assert.equal(snapshot.windows[0].visible,true);assert.equal(snapshot.windows[0].focused,false);assert.equal(snapshot.windows[0].trust.hostAttested,true);assert.equal(snapshot.windows[0].metadata.preloadMetadataPresent,false);assert.equal(snapshot.windows[0].metadata.tokenArgumentsMetadataPresent,false);assert.equal(snapshot.windows[0].metadata.preloadMatches,null);assert.equal(snapshot.windows[0].trustedByCurrentPredicate,false);
  unfocused.child.isFocused=()=>true;unfocused.focus(true);assert.throws(()=>unfocused.slot.check(true),/focus_lost/);assert.deepEqual(unfocused.slot.focusFailureSnapshot(),snapshot,'Later window recovery never overwrites the first failure or clears abort');
});

test('focused trusted child stays accepted only in the existing modal phase; diagnostics never broaden focus policy',()=>{
  const f=fixture();f.enable(false);f.focus(false);f.windows.push(f.child);f.slot.consent(true);assert.equal(f.slot.check(true).child,f.child);assert.equal(f.slot.focusFailureSnapshot(),null);
  assert.throws(()=>f.slot.check(),/focus_lost/);const snapshot=f.slot.focusFailureSnapshot();assert.equal(snapshot.allowReview,false);assert.equal(snapshot.consentPending,true);assert.equal(snapshot.windows[0].trustedByCurrentPredicate,true);
  snapshot.windows[0].focused=false;assert.equal(f.slot.focusFailureSnapshot().windows[0].focused,true,'Receipt accessor returns a clone of the immutable first observation');
});

test('native window diagnostics return at most eight boolean-only projections with no URL, token, path, ID or page content',()=>{
  const f=fixture();f.enable(false);const snapshot=nativeFocusSnapshot(f.win,()=>Array(10).fill(f.child),f.ownsNativeReviewWindow);assert.equal(snapshot.windows.length,8);assert.equal(snapshot.truncated,true);
  const leaves=value=>{if(value&&typeof value==='object')Object.values(value).forEach(leaves);else assert(value===null||typeof value==='boolean');};leaves(snapshot);
  const raw=JSON.stringify(snapshot);assert(!raw.includes('data:text'));assert(!raw.includes('12345678-'));assert(!raw.includes('Review sharing'));assert(!raw.includes('vela-review-preload'));assert(!raw.includes('PRIVATE'));
  const unavailable=nativeFocusSnapshot(f.win,()=>{throw Error('PRIVATE');});assert.equal(unavailable.enumerationAvailable,false);assert.deepEqual(unavailable.windows,[]);leaves(unavailable);
});

test('pending async work is bounded by the same abort and cannot restart after its late completion',async()=>{
  const f=fixture();let resolve;const pending=f.slot.bound(()=>new Promise(done=>{resolve=done;}));await Promise.resolve();f.advance(83500);assert.throws(()=>f.slot.check(),/slot_deadline/);await assert.rejects(pending,/slot_deadline/);resolve('late');await assert.rejects(f.slot.bound(()=> 'retry'),/slot_deadline/);
});

const rectangle=left=>({x:left+20,y:30,left,top:10,width:40,height:40});
test('moving submit target must reach three consecutive stable actual rectangles before exactly one native gesture',async()=>{
  const f=fixture(),inputs=[],positions=[0,4,9,9,9];let samples=0;
  const result=await submitStableTarget({slot:f.slot,sample:async()=>{assert.equal(inputs.length,0,'No input while waiting for geometry');return rectangle(positions[samples++]);},wait:async ms=>f.advance(ms),sendInput:event=>inputs.push(event)});
  assert.equal(result.samples,5);assert.deepEqual(inputs.map(e=>e.type),['mouseMove','mouseDown','mouseUp']);assert(inputs.every(e=>e.x===29&&e.y===30&&e.clickCount===1));
});

test('never-stable submit readiness expires within its local bound and the existing global monotonic slot without input',async()=>{
  for(const global of [false,true]){
    const f=fixture(),inputs=[];let samples=0;if(global)f.advance(83400);const before=f.slot.now();
    await assert.rejects(submitStableTarget({slot:f.slot,sample:async()=>rectangle(++samples),wait:async ms=>f.advance(ms),sendInput:event=>inputs.push(event)}),global?/slot_deadline/:/bounded readiness did not settle/);
    assert(f.slot.now()-before<=2500);assert.deepEqual(inputs,[]);assert(samples>=1);
  }
});

test('submit readiness aborts for occlusion, focus loss and Escape before any input; partial input is never retried',async()=>{
  for(const reason of ['occluded','focus','escape']){
    const f=fixture(),inputs=[];let samples=0;
    await assert.rejects(submitStableTarget({slot:f.slot,sample:async()=>{samples++;if(reason==='occluded')throw Error('Native submit occluded');return rectangle(0);},wait:async ms=>{f.advance(ms);if(reason==='focus')f.focus(false);else if(reason==='escape')f.slot.abort(Error('vela_live_operator_escape'));},sendInput:event=>inputs.push(event)}),/occluded|focus_lost|operator_escape/);
    assert.deepEqual(inputs,[]);assert.equal(samples,1);
  }
  const f=fixture(),inputs=[];let samples=0;
  await assert.rejects(submitStableTarget({slot:f.slot,sample:async()=>{samples++;return rectangle(0);},wait:async ms=>f.advance(ms),sendInput:event=>{inputs.push(event);throw Error('Actual native input failed');}}),/Actual native input failed/);
  assert.equal(samples,3);assert.equal(inputs.length,1,'One failed input attempt is terminal, never a retried gesture');
});

test('native cleanup can cancel only one actually observed pending request and never claims provider interruption',async()=>{
  const f=fixture();let calls=0;assert.equal(await cancelObservedPlanning(f.slot,async()=>{calls++;}),undefined);f.slot.pendingRequestId='canonical-own-request';f.focus(false);assert.throws(()=>f.slot.check(),/focus_lost/);
  const result=await cancelObservedPlanning(f.slot,async input=>{calls++;assert.deepEqual(input,{requestId:'canonical-own-request',reason:'focus-lost'});return{id:input.requestId,state:'cancelled'};});assert.equal(calls,1);assert.equal(result.confirmed,false);assert.deepEqual(result.hostResponse,{id:'canonical-own-request',state:'cancelled'});assert.equal(await cancelObservedPlanning(f.slot,async()=>{calls++;}),undefined);assert.equal(calls,1);
  const preview=fixture();preview.focus(false);assert.throws(()=>preview.slot.check());assert.equal(await cancelObservedPlanning(preview.slot,async()=>{calls++;}),undefined);assert.equal(calls,1,'Consent preview has no canonical own request to cancel');
});

test('current console detail shape and legacy level record actual errors, never ordinary logs',()=>{
  assert.deepEqual(consoleRecord({level:'error',message:'shader failed',lineNumber:9,sourceId:'actual.js'}),{message:'shader failed',line:9,source:'actual.js'});assert.deepEqual(consoleRecord(3,'legacy error',4,'legacy.js'),{message:'legacy error',line:4,source:'legacy.js'});assert.equal(consoleRecord({level:'info',message:'ordinary log'}),null);
});

test('native diagnostics are a cloned bounded metadata projection, with no authority or raw error/body fields',()=>{
  assert.deepEqual(readNativeRequestDiagnostics(undefined),[]);const records=[{stage:'preview',state:'started'},{stage:'preview',state:'completed'},{stage:'review',state:'failed',code:'planning_prompt_capacity_exceeded'}];let calls=0;
  const snapshot=readNativeRequestDiagnostics(()=>{calls++;return records;});assert.equal(calls,1);assert.deepEqual(snapshot,records);assert.notEqual(snapshot[0],records[0]);records[0].state='failed';assert.equal(snapshot[0].state,'started');assert.equal(snapshot.at(-1).code,'planning_prompt_capacity_exceeded');
  for(const invalid of [Array(25).fill({stage:'preview',state:'started'}),[{stage:'execute',state:'started'}],[{stage:'review',state:'approved'}],[{stage:'review',state:'failed',code:'raw private error text'}],[{stage:'preview',state:'failed',code:'x'.repeat(161)}],[{stage:'preview',state:'completed',prompt:'PRIVATE'}],Promise.resolve([])])assert.throws(()=>readNativeRequestDiagnostics(()=>invalid),/invalid_native_request_diagnostics/);
  assert.throws(()=>readNativeRequestDiagnostics(()=>{throw Error('PRIVATE prompt or error body');}),error=>error.message==='native_request_diagnostics_unavailable');
});

test('explicit native failure is terminal; stage completion never substitutes for the real trusted child or consent',()=>{
  for(const stage of ['preview','review','grant','request'])assert.equal(nativeRequestFailure([{stage,state:'failed',code:'native_test_failure'}]).message,'native_'+stage+'_failed:native_test_failure');
  assert.equal(nativeRequestFailure([{stage:'preview',state:'started'},{stage:'review',state:'completed'},{stage:'grant',state:'completed'}]),null);
  const f=fixture();f.focus(false);f.enable(false);f.slot.consent(true);assert.throws(()=>f.slot.check(true),/focus_lost/,'Diagnostic completion cannot fabricate a trusted child or parent foreground');
});

test('helper source retains real canonical/consent/restart evidence and removes obsolete waits without adding approval transport',()=>{
  const source=fs.readFileSync(path.join(__dirname,'native-live.cjs'),'utf8');assert(!source.includes('240000'));assert(!source.includes('45000'));assert(!/\.focus\s*\(/.test(source));assert(!/command\(['"](?:authorizeVelaRequest|velaNativeReview|execute)['"]/.test(source));assert(!/click\([^\n]*#approve/.test(source));
  const transition=source.slice(source.indexOf('const observeNativeReview ='),source.indexOf('const control ='));assert(!transition.includes('win.webContents.executeJavaScript'),'Even pre-child observation cannot queue parent reads across the modal transition');assert(transition.includes('mode.child.webContents.executeJavaScript'));
  assert(transition.includes('nativeRequestFailure(observeDiagnostics())'));assert(source.includes("nativeRequestDiagnosticsError='native_request_diagnostics_unavailable'"));
  assert(source.includes("if (slot.isConsentPending()) return {error:'parent_diagnostic_withheld_during_native_consent'}"));assert(source.includes('if(driver&&!slot.failure()&&!slot.isConsentPending())for'));
  for(const required of ['planningCoverage','Complete scoped planning evidence must contain no tool or file-change items','Original placements remain canonical and unchanged','Restart retains the exact execution and native IDs','Dispatch retains the exact displayed native source/context bytes','One exact semantic provider input','taskVerified','--resume-reviewed-plan'])assert(source.includes(required),required);
});

test('active product source contracts match the helper controls, including shared inline chat rather than legacy fallback markup', t=>{
  const root=process.env.AERYNTH_SELECTOR_SOURCE_ROOT??path.resolve(__dirname,'../../..'), helper=fs.readFileSync(path.join(__dirname,'native-live.cjs'),'utf8');
  const files={app:'prototypes/visual-experience/cinematic-v3/src/application.ts',main:'prototypes/visual-experience/cinematic-v3/src/main.ts',surfaces:'prototypes/visual-experience/cinematic-v3/src/contextual-surfaces.ts',environments:'prototypes/visual-experience/cinematic-v3/src/environment-navigator.ts',workspace:'prototypes/visual-experience/cinematic-v3/src/workspace-actions.ts',blockChat:'prototypes/block-library/chat-view.ts',chat:'prototypes/conversation-product/src/chat.ts',library:'prototypes/block-library/view.ts',registry:'prototypes/block-library/registry.ts',layout:'prototypes/block-library/direct-manipulation.ts',note:'prototypes/block-library/note-view.ts',vela:'prototypes/vela-core/src/panel.ts',status:'prototypes/vela-core/src/panel-status.ts',review:'prototypes/visual-experience/cinematic-v3/native/vela-review.cjs'};
  const sources=Object.fromEntries(Object.entries(files).map(([key,file])=>[key,fs.readFileSync(path.join(root,file),'utf8')]));
  const normalized = text => text.replaceAll("'", '"').replace(/\s+/gu, ' ');
  const requireTokens=(name,tokens)=>{for(const token of tokens)assert(normalized(sources[name]).includes(normalized(token)),files[name]+' missing '+token);};
  // Follow the mounted component chain; stale App cleanup strings alone cannot prove the active composer contract.
  requireTokens('app',['view = mountBlockChat(surface, {','resourceId: r.id','id="workspace-manager"','mountEnvironmentNavigator(','mountWorkspaceActions(','surface.id = "vela-assistant-surface"','id: "block-library"','controller = mountBlockLibrary(content, libraryClient']);
  requireTokens('environments',['"create-project"','"create-workspace"','name.name = "title"','project.name = "projectId"','node.dataset.workspaceId = w.id','"open-workspace"']);
  requireTokens('workspace',['disclosure("Find in workspace", "find"','b.dataset.action = "find-block"']);
  requireTokens('blockChat',['mountConversationChat,','root.replaceChildren();','const chat = mountConversationChat(root, {']);
  requireTokens('chat',["'cp-chat aw-optical-controls'","'cp-composer'","'cp-messages'","send.type = 'submit'","'Send message'"]);
  assert(!helper.includes('.conversation-compose'));assert(!helper.includes('.conversation-transcript'));assert(helper.includes('.cp-composer textarea'));assert(helper.includes('.cp-composer button[type="submit"]'));assert(helper.includes('.cp-messages'));
  requireTokens('surfaces',['document.createElement("dialog")','node.className = "aw-contextual-surface"','node.dataset.surfaceId = request.id','dismiss.className = "aw-contextual-dismiss"']);
  requireTokens('layout',['section.className = "aw-workspace-layout"','add.className = "aw-workspace-add"','"aria-label", "Workspace actions"']);
  requireTokens('library',['"aw-library__list"','"aw-library__detail"','"aw-library__status"','const form = node("form")','field("Title", title)','field("Conversation backend", provider)','["local", "codex"]','"Add New " + definition.title','setAttribute("aria-busy", "true")']);
  assert(/"conversation",\s*"Conversation"/.test(sources.registry));assert(/"note",\s*"Note"/.test(sources.registry));
  requireTokens('vela',["'vela-core-source-panel'","'vela-core-results'","'vela-core-provider-controls'","'vela-core-compose'","icon('Add sources'","icon('Provider'","button('Check connection'","'Use ' + providerName(state.planner.providerId) + ' for this request'","'Send to Vela'","'vela-core-plan'","'vela-core-plan-details'","'vela-core-effects'","button('Approve and apply'",'JSON.stringify({ actions: plan.steps, targets: plan.targets, provider: plan.contribution, receipts }','card.dataset.planId = plan.id']);
  requireTokens('status',['The reviewed plan was applied.']);requireTokens('main',['class="working-content"','class="unfold"','el.classList.toggle("expanded"','snapshot: () =>','active: nativeActive','metrics: { ...metrics }','gpu: environment?.stats()']);requireTokens('note',['root.dataset.noteState = value.phase']);
  requireTokens('review',['id="review-title"','class="intent"','Exact provider request','Request digest:']);
  const {createHash}=require('node:crypto');t.diagnostic(JSON.stringify({evidence:'read-only-source-selector-audit-not-native-qualification',root,hashes:Object.fromEntries(Object.entries(files).map(([key,file])=>[file,createHash('sha256').update(sources[key]).digest('hex')]))}));
});
