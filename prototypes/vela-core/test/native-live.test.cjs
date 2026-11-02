const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {createSlot,trustedReviewWindow,consoleRecord,cancelObservedPlanning} = require('./native-live.cjs')._offline;

/** Pure lifecycle fixtures only. These never launch Electron or qualify actual native/provider behavior. */
function fixture(){
  let clock=100, focused=true, enabled=true; const windows=[];
  const win={isDestroyed:()=>false,isVisible:()=>true,isMinimized:()=>false,isFocused:()=>focused,isEnabled:()=>enabled,webContents:{isDestroyed:()=>false}};
  const child={id:7,isDestroyed:()=>false,isVisible:()=>true,isMinimized:()=>false,isFocused:()=>true,isModal:()=>true,getParentWindow:()=>win,webContents:{isDestroyed:()=>false,getLastWebPreferences:()=>({contextIsolation:true,sandbox:true,nodeIntegration:false,preload:path.resolve(__dirname,'../../visual-experience/cinematic-v3/native/vela-review-preload.cjs'),additionalArguments:['--vela-review-token=12345678-1234-1234-1234-123456789abc']}),getURL:()=> 'data:text/html;charset=utf-8,'+encodeURIComponent('<title>Vela · Review sharing</title>')}};
  const slot=createSlot({win,slotStartedAt:100,deadlineMs:85000,now:()=>clock,windows:()=>windows});
  return {win,child,slot,windows,advance:value=>{clock+=value;},focus:value=>{focused=value;},enable:value=>{enabled=value;}};
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
  for(const change of [c=>{c.isModal=()=>false;},c=>{c.getParentWindow=()=>({});},c=>{c.isFocused=()=>false;},c=>{c.webContents.getURL=()=> 'https://example.invalid/';},c=>{c.webContents.getLastWebPreferences=()=>({sandbox:true,contextIsolation:true,nodeIntegration:false,preload:'untrusted.cjs'});}]){
    const v=fixture();v.enable(false);v.focus(false);change(v.child);assert.equal(trustedReviewWindow(v.win,[v.child]),null);
  }
  const enabled=fixture();assert.equal(trustedReviewWindow(enabled.win,[enabled.child]),null,'A matching title or child alone never authorizes the modal exception');
});

test('pending async work is bounded by the same abort and cannot restart after its late completion',async()=>{
  const f=fixture();let resolve;const pending=f.slot.bound(()=>new Promise(done=>{resolve=done;}));await Promise.resolve();f.advance(83500);assert.throws(()=>f.slot.check(),/slot_deadline/);await assert.rejects(pending,/slot_deadline/);resolve('late');await assert.rejects(f.slot.bound(()=> 'retry'),/slot_deadline/);
});

test('native cleanup can cancel only one actually observed pending request and never claims provider interruption',async()=>{
  const f=fixture();let calls=0;assert.equal(await cancelObservedPlanning(f.slot,async()=>{calls++;}),undefined);f.slot.pendingRequestId='canonical-own-request';f.focus(false);assert.throws(()=>f.slot.check(),/focus_lost/);
  const result=await cancelObservedPlanning(f.slot,async input=>{calls++;assert.deepEqual(input,{requestId:'canonical-own-request',reason:'focus-lost'});return{id:input.requestId,state:'cancelled'};});assert.equal(calls,1);assert.equal(result.confirmed,false);assert.deepEqual(result.hostResponse,{id:'canonical-own-request',state:'cancelled'});assert.equal(await cancelObservedPlanning(f.slot,async()=>{calls++;}),undefined);assert.equal(calls,1);
  const preview=fixture();preview.focus(false);assert.throws(()=>preview.slot.check());assert.equal(await cancelObservedPlanning(preview.slot,async()=>{calls++;}),undefined);assert.equal(calls,1,'Consent preview has no canonical own request to cancel');
});

test('current console detail shape and legacy level record actual errors, never ordinary logs',()=>{
  assert.deepEqual(consoleRecord({level:'error',message:'shader failed',lineNumber:9,sourceId:'actual.js'}),{message:'shader failed',line:9,source:'actual.js'});assert.deepEqual(consoleRecord(3,'legacy error',4,'legacy.js'),{message:'legacy error',line:4,source:'legacy.js'});assert.equal(consoleRecord({level:'info',message:'ordinary log'}),null);
});

test('helper source retains real canonical/consent/restart evidence and removes obsolete waits without adding approval transport',()=>{
  const source=fs.readFileSync(path.join(__dirname,'native-live.cjs'),'utf8');assert(!source.includes('240000'));assert(!source.includes('45000'));assert(!/\.focus\s*\(/.test(source));assert(!/command\(['"](?:authorizeVelaRequest|velaNativeReview|execute)['"]/.test(source));assert(!/click\([^\n]*#approve/.test(source));
  const transition=source.slice(source.indexOf('const observeNativeReview ='),source.indexOf('const control ='));assert(!transition.includes('win.webContents.executeJavaScript'),'Even pre-child observation cannot queue parent reads across the modal transition');assert(transition.includes('mode.child.webContents.executeJavaScript'));
  for(const required of ['planningCoverage','Complete scoped planning evidence must contain no tool or file-change items','Original placements remain canonical and unchanged','Restart retains the exact execution and native IDs','Dispatch retains the exact displayed native source/context bytes','One exact semantic provider input','taskVerified','--resume-reviewed-plan'])assert(source.includes(required),required);
});
