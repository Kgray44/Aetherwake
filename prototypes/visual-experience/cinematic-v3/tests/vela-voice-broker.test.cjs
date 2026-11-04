const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createVelaVoiceBroker,validVoiceRequest,safeVoiceState,safeVoiceCreation,safeMedia}=require('../native/vela-voice-broker.cjs');
const state=()=>({available:true,captions:[],usage:{enabled:true,maximumVoiceSeconds:300,initializationExposureSeconds:15},session:{contract:'aerynth.gpt-live-session@1',model:'gpt-live-1',attemptId:null,sessionId:null,conversationId:null,configurationVersion:null,state:'idle',dispatched:false,initializationExposureSeconds:0,inputMute:'unknown',finalization:'not-requested',lastAppend:'none',audioPlayback:'unverified',transcriptFragments:0,backend:'idle',usage:{seconds:null,source:'unavailable',final:false}},media:null,settings:{version:1,speechPersonality:'Clear',selectedVoice:null,candidates:[]}});
test('public native voice assigns one native attempt and a fixed budget after actual native authorization',async()=>{
  const calls=[],attempts=[];let authorized=false;
  const broker=createVelaVoiceBroker({authorize:async()=>authorized,mediaBroker:{authorizeAttempt:id=>attempts.push(id)},call:async(name,dto)=>{calls.push({name,dto});return dto.name==='authorize'?{authorizationRef:'private-native-grant',attemptId:dto.input.attemptId,configurationVersion:2,expiresAt:new Date(Date.now()+30000).toISOString()}:state();}});
  await assert.rejects(broker.command({name:'start',input:{intent:'Open the clock'}}),/voice_user_gesture_required/);assert.equal(calls.length,0);
  authorized=true;assert.deepEqual(await broker.command({name:'start',input:{intent:'Open the clock',inputDeviceId:'microphone-a'}}),state());
  assert.equal(calls[0].name,'velaVoiceNative');assert.equal(calls[0].dto.input.maximumVoiceSeconds,300);assert.equal(calls[0].dto.input.intent,'Open the clock');assert.equal(calls[1].dto.input.intent,'Open the clock');assert.equal(calls[0].dto.input.attemptId,attempts[0]);assert.equal(calls[1].dto.input.authorizationRef,'private-native-grant');
  broker.close();await assert.rejects(broker.command({name:'state',input:{}}),/voice_closed/);
});

test('saved voice catalog refresh has no paid attempt and accepts honest imported metadata without private scope fields',async()=>{
 const value=state();value.settings.catalog={state:'ready',configurationVersion:1,observedAt:1000,expiresAt:301000};value.settings.selectedVoice={configurationId:'vela-primary',configurationVersion:1,id:'voice-three',name:'Vela 3',createdAt:null,type:'existing',sourceType:'prompt'};value.settings.candidates=[value.settings.selectedVoice];let authorization=0;const calls=[];const broker=createVelaVoiceBroker({authorize:async()=>{authorization++;return true;},mediaBroker:{authorizeAttempt(){throw Error('unexpected_paid_attempt');}},call:async(command,input)=>{calls.push({command,input});return value;}});try{const result=await broker.command({name:'refreshVoices',input:{}});assert.equal(result.settings.selectedVoice.type,'existing');assert(!Object.hasOwn(result.settings.selectedVoice,'prompt'));assert.equal(authorization,0);assert.deepEqual(calls,[{command:'velaVoice',input:{name:'refreshVoices',input:{}}}]);assert.throws(()=>safeVoiceState({...value,settings:{...value.settings,catalog:{...value.settings.catalog,boundaryDigest:'PRIVATE_SCOPE'}}}),/voice_state_invalid/);assert.throws(()=>safeVoiceState({...value,settings:{...value.settings,catalog:{...value.settings.catalog,errorCode:'live_voice_catalog_private_account'}}}),/voice_state_invalid/);}finally{broker.close();}
});
test('public voice cannot supply private SDP, grants, budget, provider events or native-only commands',async()=>{
  let count=0;const broker=createVelaVoiceBroker({authorize:async()=>true,mediaBroker:{authorizeAttempt(){}},call:async()=>{count++;return state();}});
  for(const dto of [{name:'authorize',input:{}},{name:'start',input:{authorizationRef:'forged'}},{name:'start',input:{maximumVoiceSeconds:9000}},{name:'start',input:{sdpOffer:'PRIVATE'}},{name:'connect',input:{sessionId:'x',sdpAnswer:'PRIVATE'}},{name:'state',input:{providerEvent:{type:'session.started'}}},{name:'saveVoice',input:{voiceId:null,expectedSettingsVersion:1,speechPersonality:'Clear',apiKey:'PRIVATE'}}]){
    assert.equal(validVoiceRequest(dto),false);await assert.rejects(broker.command(dto),/voice_invalid_request/);
  }assert.equal(count,0);broker.close();
});

test('native QA budget stays within the production ceiling and cannot be supplied by a public request',async()=>{
  const calls=[];const options={authorize:async()=>true,mediaBroker:{authorizeAttempt(){}},call:async(name,dto)=>{calls.push({name,dto});return dto.name==='authorize'?{authorizationRef:'native-short-grant',attemptId:dto.input.attemptId,configurationVersion:1,expiresAt:new Date(Date.now()+30000).toISOString()}:state();}};
  for(const maximumVoiceSeconds of [0,14,30.5,301,NaN])assert.throws(()=>createVelaVoiceBroker({...options,maximumVoiceSeconds}),/voice_invalid_request/);
  const broker=createVelaVoiceBroker({...options,maximumVoiceSeconds:30});
  try{await broker.command({name:'start',input:{}});assert.equal(calls[0].dto.input.maximumVoiceSeconds,30);assert.equal(calls[1].dto.input.authorizationRef,'native-short-grant');
    assert.equal(validVoiceRequest({name:'start',input:{maximumVoiceSeconds:300}}),false);
  }finally{broker.close();}
});
test('voice state projection refuses private fields, raw diagnostics and fabricated audibility',async()=>{
  for(const tamper of [s=>{s.session.sdpAnswer='PRIVATE';},s=>{s.session.errorCode='PRIVATE_RAW_ERROR';},s=>{s.session.errorCode=['live_unavailable'];},s=>{s.session.audioPlayback='heard';},s=>{s.settings.apiKey='PRIVATE';},s=>{s.settings.selectedVoice={apiKey:'PRIVATE'};},s=>{s.settings.candidates=[null];}]){const value=state();tamper(value);assert.throws(()=>safeVoiceState(value),/voice_state_invalid/);}
  const broker=createVelaVoiceBroker({authorize:async()=>true,mediaBroker:{authorizeAttempt(){}},call:async()=>{throw Error('PRIVATE_RAW_PROVIDER_ERROR');}});
  await assert.rejects(broker.command({name:'state',input:{}}),error=>error.message==='voice_unavailable');broker.close();
});

test('voice creation and media projections reject non-string errors and malformed optional candidates',()=>{
  const creation={state:'failed',dispatched:false,savedLocally:false,selected:false,audioPreview:false,errorCode:'live_voice_unavailable'};
  assert.deepEqual(safeVoiceCreation(creation),creation);
  for(const candidate of [null,false,0,undefined])assert.throws(()=>safeVoiceCreation({...creation,candidate}),/voice_state_invalid/);
  assert.throws(()=>safeVoiceCreation({...creation,errorCode:['live_unavailable']}),/voice_state_invalid/);
  const media={contract:'aerynth.gpt-live-media@1',connection:'idle',microphoneAccess:'not-requested',localTrackEnabled:false,localSourceMuted:null,providerInputMute:'unknown',playback:'idle',playbackObserved:false,humanAudibility:'unverified',inputDevice:'default',outputDevice:'default',localSpeech:'unavailable',remoteSignal:'unavailable',interruption:'none'};
  assert.deepEqual(safeMedia(media),media);assert.throws(()=>safeMedia({...media,errorCode:['live_media_unavailable']}),/voice_state_invalid/);
});
test('safe controls use safe Core command; camel-case voice changes map to reviewed private operations',async()=>{
  const calls=[];const broker=createVelaVoiceBroker({authorize:async()=>true,mediaBroker:{authorizeAttempt(){throw Error('must not capture');}},call:async(name,dto)=>{calls.push([name,dto]);if(dto.name==='authorize')return{authorizationRef:'grant',attemptId:dto.input.attemptId,configurationVersion:1,expiresAt:new Date(Date.now()+10000).toISOString()};if(dto.name==='voice-create')return{state:'failed',dispatched:false,savedLocally:false,selected:false,audioPreview:false,errorCode:'live_voice_creation_unavailable'};if(dto.name==='devices')return[];return state();}});
  await broker.command({name:'mute',input:{muted:true}});assert.equal(calls[0][0],'velaVoice');
  await broker.command({name:'createVoice',input:{name:'Calm',prompt:'Calm and clear'}});assert.equal(calls.at(-1)[1].name,'voice-create');
  await broker.command({name:'saveVoice',input:{voiceId:null,expectedSettingsVersion:1,speechPersonality:'Clear'}});assert.equal(calls.at(-1)[1].name,'voice-save');
  assert.deepEqual(await broker.command({name:'devices',input:{}}),[]);broker.close();
});
test('ordinary sandbox preload exposes only public voice command and requires actual Blink activation for paid changes',async()=>{
  let host,active=false;const calls=[];
  vm.runInNewContext(readFileSync(path.join(__dirname,'../native/desktop-preload.cjs'),'utf8'),{require:name=>{assert.equal(name,'electron');return{contextBridge:{exposeInMainWorld:(_name,value)=>{host=value;}},ipcRenderer:{on(){},removeListener(){},async invoke(...args){calls.push(args);return{ok:true,result:state()};}}};},process:{argv:[]},navigator:{userActivation:{get isActive(){return active;}}}});
  await host.command('velaVoice',{name:'state',input:{}});
  await assert.rejects(host.command('velaVoiceNative',{name:'authorize'}),/unsupported_command/);
  await assert.rejects(host.command('velaVoice',{name:'start',input:{}}),/voice_user_gesture_required/);
  active=true;await host.command('velaVoice',{name:'start',input:{}});assert.equal(calls.length,2);
  assert.ok(!Object.keys(host).some(key=>key.includes('private')||key.includes('Media')));
});
