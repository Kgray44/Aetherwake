const test=require('node:test');
const assert=require('node:assert/strict');
const {startReviewedMission}=require('../native/mission-start-broker.cjs');

// Real extracted broker, synthetic UI/Core ports; no window or provider is opened.
function fixture({external=false,local=false}={}){
  const log=[],calls=[],dialogs=[],localURL='file:///synthetic-aerynth/index.html';
  let focused=true,visible=true,minimized=false,alive=true,documentURL=localURL,storageAllowed=true,response=1,selection={canceled:false,filePaths:['C:\\Synthetic\\test.mjs']};
  let onCall=async()=>{},onDialog=async()=>{},onStorage=async()=>{},onBefore=async()=>{};
  const frame={url:localURL},contents={mainFrame:frame,isDestroyed:()=>!alive,getURL:()=>documentURL};
  const win={webContents:contents,isDestroyed:()=>!alive,isVisible:()=>visible,isMinimized:()=>minimized,isFocused:()=>focused,focus:()=>assert.fail('No forced focus')};
  const event={sender:contents,senderFrame:frame},input={name:'start',input:{objective:'Synthetic bounded review',fingerprint:'sealed-preview',proposalId:'proposal-1'}};
  const preview={fingerprint:'sealed-preview',plan:{objective:input.input.objective,criteria:['Synthetic result'],tasks:[{id:'task-1',objective:'Synthetic task',criterion:'Synthetic result',dependencies:[],specialist:external?{role:'engineering',provider:'openai-api-vela',model:'gpt-6-luna',instructions:'Synthetic instructions'}:undefined}]},executors:[{available:true}],
    ...(external?{externalReview:{provider:'Synthetic API provider',calls:1}}:{}),...(local?{localReview:{maxFiles:2}}:{})};
  const call=async(name,payload)=>{log.push(name==='missions'?`missions:${payload.name}`:name);calls.push({name,payload});await onCall(name,payload);
    if(name==='missions'&&payload.name==='preview')return preview;
    if(name==='missionCheckReview')return {cwd:'C:\\Synthetic',head:'a'.repeat(40),argv:['node','--test','test.mjs'],digest:'b'.repeat(64)};
    return {id:'mission-1',phase:'running'};};
  const dialog={showMessageBox:async(...args)=>{log.push('message-box');dialogs.push({type:'message',args});await onDialog('message');return{response};},
    showOpenDialog:async(...args)=>{log.push('open-dialog');dialogs.push({type:'open',args});await onDialog('open');return selection;}};
  const storage={allowWrite:async()=>{log.push('storage');const allowed=storageAllowed;await onStorage();return allowed;}};
  const beforeStart=async value=>{log.push('beforeStart');assert.equal(value.preview,preview);assert.equal(value.input,input.input);await onBefore();};
  return {log,calls,dialogs,preview,input,event,win,run:()=>startReviewedMission({win,event,localURL,storage,call,dialog,input,beforeStart}),
    focus:v=>{focused=v;},visible:v=>{visible=v;},minimized:v=>{minimized=v;},alive:v=>{alive=v;},url:v=>{documentURL=v;},storage:v=>{storageAllowed=v;},response:v=>{response=v;},selection:v=>{selection=v;},
    onCall:fn=>{onCall=fn;},onDialog:fn=>{onDialog=fn;},onStorage:fn=>{onStorage=fn;},onBefore:fn=>{onBefore=fn;}};
}
const starts=f=>f.calls.filter(call=>call.name==='missionStartReviewed'||call.name==='missions'&&call.payload.name!=='preview');

test('actual mission broker binds changed previews and declines before any beforeStart or mission effect',async()=>{
  const changed=fixture({external:true});changed.preview.fingerprint='changed';await assert.rejects(changed.run(),/mission_preview_changed/);
  assert.equal(changed.dialogs.length,0);assert.equal(starts(changed).length,0);assert(!changed.log.includes('beforeStart'));
  for(const options of [{external:true},{local:true}]){const f=fixture(options);f.response(0);await assert.rejects(f.run(),/mission_review_declined/);assert.equal(starts(f).length,0);assert(!f.log.includes('beforeStart'));}
  const unavailable=fixture({external:true});unavailable.preview.executors[0].available=false;await assert.rejects(unavailable.run(),/mission_specialist_unavailable/);assert.equal(unavailable.dialogs.length,0);
});

test('real specialist review precedes storage and beforeStart, which precedes the reviewed start effect',async()=>{
  const f=fixture({external:true});assert.equal((await f.run()).id,'mission-1');
  assert.deepEqual(f.log.filter(item=>item!=='storage'),['missions:preview','message-box','beforeStart','missionStartReviewed']);
  assert(f.log.indexOf('storage')>f.log.indexOf('message-box'));assert(f.log.indexOf('storage')<f.log.indexOf('beforeStart'));
  assert(f.log.lastIndexOf('storage')>f.log.indexOf('beforeStart'));assert(f.log.lastIndexOf('storage')<f.log.indexOf('missionStartReviewed'));
  const review=f.dialogs[0].args[1];assert.match(review.title,/Review specialist/);assert.match(review.detail,/Synthetic instructions/);assert.equal(review.defaultId,0);assert.equal(review.cancelId,0);
  assert.equal(starts(f).length,1);assert.deepEqual(starts(f)[0].payload,f.input.input);
});

test('local project selection and exact reviewed digest are carried into the canonical start only after native Yes',async()=>{
  const f=fixture({local:true});await f.run();assert.deepEqual(f.log.filter(item=>item!=='storage'),['missions:preview','open-dialog','missionCheckReview','message-box','beforeStart','missionStartReviewed']);
  assert(f.log.indexOf('storage')>f.log.indexOf('message-box'));assert(f.log.indexOf('storage')<f.log.indexOf('beforeStart'));assert(f.log.lastIndexOf('storage')>f.log.indexOf('beforeStart'));assert(f.log.lastIndexOf('storage')<f.log.indexOf('missionStartReviewed'));
  assert.deepEqual(starts(f)[0].payload.approvedProjectCheck,{paths:['C:\\Synthetic\\test.mjs'],digest:'b'.repeat(64)});
  for(const selection of [{canceled:true,filePaths:[]},{canceled:false,filePaths:[]},{canceled:false,filePaths:['a','b','c']}]){
    const denied=fixture({local:true});denied.selection(selection);await assert.rejects(denied.run(),/mission_review_declined|mission_project_check_selection_limit/);assert.equal(starts(denied).length,0);assert(!denied.log.includes('beforeStart'));
  }
});

test('Start reviews a preselected project check without reopening the file picker',async()=>{
  const f=fixture({local:true});
  f.preview.localReview.preselected=true;
  f.preview.proposalId='proposal-1';
  await f.run();
  assert.deepEqual(f.log.filter(item=>item!=='storage'),['missions:preview','missionCheckReview','message-box','beforeStart','missionStartReviewed']);
  assert.deepEqual(f.calls.find(call=>call.name==='missionCheckReview').payload,{proposalId:'proposal-1',fingerprint:'sealed-preview'});
  assert.deepEqual(starts(f)[0].payload,f.input.input);
});

function mixedReview() {
  const f = fixture({ external: true, local: true });
  f.preview.artifactReview = {
    prompt: 'Draw a blue square', digest: 'c'.repeat(64), model: 'gpt-image-2.6-sunburst',
    quality: 'medium', width: 1024, height: 1024, files: ['illustration.png', 'illustration-notes.txt'],
    rates: { textInput: 5, imageInput: 8, imageOutput: 30 },
  };
  return f;
}

test('a mixed mission requires independent native review of image, specialists and exact local test', async () => {
  const f = mixedReview();
  await f.run();
  assert.deepEqual(f.dialogs.map(dialog => dialog.args[1].title), [
    'Review illustration mission', 'Review specialist mission', 'Choose tracked Node test files in one Git checkout',
    'Review read-only project tests',
  ]);
  assert.match(f.dialogs[0].args[1].detail, /Draw a blue square/);
  assert.match(f.dialogs[1].args[1].detail, /Synthetic instructions/);
  assert.match(f.dialogs[3].args[1].detail, /\["node","--test","test\.mjs"\]/);
  assert.deepEqual(starts(f), [{ name: 'missionStartReviewed', payload: {
    ...f.input.input, approvedArtifactDigest: 'c'.repeat(64),
    approvedProjectCheck: { paths: ['C:\\Synthetic\\test.mjs'], digest: 'b'.repeat(64) },
  } }]);
});

test('declining any review in a mixed mission prevents all execution', async () => {
  for (const declined of [1, 2, 3]) {
    const f = mixedReview();
    let reviews = 0;
    f.onDialog(async type => {
      if (type === 'message' && ++reviews === declined) f.response(0);
    });
    await assert.rejects(f.run(), /mission_review_declined/);
    assert.equal(reviews, declined);
    assert.equal(starts(f).length, 0);
    assert.ok(!f.log.includes('beforeStart'));
  }
});

test('upfront owner, focus and visibility guards prevent even preview dispatch',async()=>{
  for(const fault of ['focus','visible','minimized','destroyed','sender','frame','frame-url','document-url']){
    const f=fixture({external:true});if(fault==='focus')f.focus(false);if(fault==='visible')f.visible(false);if(fault==='minimized')f.minimized(true);if(fault==='destroyed')f.alive(false);
    if(fault==='sender')f.event.sender={};if(fault==='frame')f.event.senderFrame={...f.event.senderFrame};if(fault==='frame-url')f.event.senderFrame.url='https://untrusted.invalid';if(fault==='document-url')f.url('https://untrusted.invalid');
    await assert.rejects(f.run(),/unauthorized_sender/,fault);assert.equal(f.calls.length,0,fault);
  }
});

test('native review rechecks current owner after preview/dialog awaits and never consumes a beforeStart on lost focus',async()=>{
  const previewRace=fixture({external:true});previewRace.onCall(async name=>{if(name==='missions')previewRace.focus(false);});await assert.rejects(previewRace.run(),/unauthorized_sender/);assert.equal(previewRace.dialogs.length,0);
  const dialogRace=fixture({external:true});dialogRace.onDialog(async()=>dialogRace.focus(false));await assert.rejects(dialogRace.run(),/unauthorized_sender/);assert.equal(starts(dialogRace).length,0);assert(!dialogRace.log.includes('beforeStart'));
});

test('storage is awaited before beforeStart and final focus/storage revocation prevents every start path',async()=>{
  for(const options of [{},{external:true},{local:true}]){
    const denied=fixture(options);denied.storage(false);await assert.rejects(denied.run(),/storage_reserve_admission_denied/);assert(!denied.log.includes('beforeStart'));assert.equal(starts(denied).length,0);
    const focusRace=fixture(options);focusRace.onStorage(async()=>focusRace.focus(false));await assert.rejects(focusRace.run(),/unauthorized_sender/);assert(!focusRace.log.includes('beforeStart'));assert.equal(starts(focusRace).length,0);
    const afterHook=fixture(options);afterHook.onBefore(async()=>afterHook.storage(false));await assert.rejects(afterHook.run(),/storage_reserve_admission_denied/);assert.equal(starts(afterHook).length,0);
    const lost=fixture(options);lost.onBefore(async()=>lost.focus(false));await assert.rejects(lost.run(),/unauthorized_sender/);assert.equal(starts(lost).length,0);
  }
});

test('beforeStart failure cannot start a mission or silently repeat a paid authorization',async()=>{
  const f=fixture({external:true});let calls=0;f.onBefore(async()=>{calls++;throw Error('synthetic_authority_revoked');});
  await assert.rejects(f.run(),/synthetic_authority_revoked/);assert.equal(calls,1);assert.equal(starts(f).length,0);
});
