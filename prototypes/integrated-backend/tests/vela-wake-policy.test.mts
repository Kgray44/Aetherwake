import test from 'node:test';
import assert from 'node:assert/strict';
import { VelaWakeCoordinator, VELA_WAKE_DEFAULTS, type VelaWakeHostPorts, type WakeNativeVoiceObservation, type WakeOwnedVoice } from '../src/vela-wake-policy.mts';
import type { WakeDetection } from '../src/wake-engine.mts';
const deferred=<T,>()=>{let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
async function flush(){for(let i=0;i<40;i++)await Promise.resolve();}
class FakeClock{
  value=0;serial=0;tasks=new Map<number,{at:number;callback:()=>void}>();
  now=()=>this.value;
  schedule=(delay:number,callback:()=>void)=>{const id=++this.serial;this.tasks.set(id,{at:this.value+delay,callback});return ()=>{this.tasks.delete(id);};};
  async advance(ms:number){const target=this.value+ms;for(let count=0;count<1000;count++){const next=[...this.tasks].filter(([,task])=>task.at<=target).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];
      if(!next)break;this.value=next[1].at;this.tasks.delete(next[0]);next[1].callback();await flush();}this.value=target;await flush();}
}
const detection:WakeDetection={phraseId:'hey-vela',text:'Hey Vela',keywordStartSample:1600,keywordEndSample:8000,detectedAtSample:9600,
  sampleRate:16000,timestampSource:'sherpa-token-alignment-40ms',boundaryAccuracy:'model-estimate'};
const observed=(sessionId:string,patch:Partial<WakeNativeVoiceObservation>={}):WakeNativeVoiceObservation=>({
  owner:'wake',sessionId,connection:'active',microphone:'live',localSpeechActive:false,actualPlaybackActive:false,importantResponseQueued:false,backendWorking:false,...patch,
});
function fixture(){
  const clock=new FakeClock(),calls:{kind:string;scope?:WakeOwnedVoice;input?:any}[]=[],views:unknown[]=[],sessions=new Map<string,{capture:boolean;playback:boolean;activationId?:string}>();
  let handler:((event:WakeDetection)=>Promise<void>)|undefined,detectorCapturing=false,starts=0,leaseReleases=0,postWakeSpeech:'present'|'absent'|'unknown'='absent';
  const controls:{arm?:ReturnType<typeof deferred<void>>;start?:ReturnType<typeof deferred<{sessionId:string;microphone:'live'|'muted'}>>;
    stop?:ReturnType<typeof deferred<{closure:'confirmed'|'unknown'}>>;capture?:ReturnType<typeof deferred<any>>;close:'confirmed'|'unknown';reconciled:'confirmed'|'unknown';fail:Set<string>}={
      close:'confirmed',reconciled:'confirmed',fail:new Set(),
    };
  const lease={release(){leaseReleases++;}};
  const fail=(kind:string)=>{if(controls.fail.has(kind))throw Error('PRIVATE_NATIVE_ERROR_'+kind);};
  const owned=(scope:WakeOwnedVoice,sessionId:string)=>scope.all||scope.sessionId===sessionId||!!scope.activationId&&sessions.get(sessionId)?.activationId===scope.activationId;
  const ports:VelaWakeHostPorts={
    authorizeEnable:async input=>{calls.push({kind:'authorize'});assert.equal(input.signal.aborted,false);fail('authorize');return {authorizationRef:'private-native-consent-never-a-view'};},
    detector:{arm:async input=>{calls.push({kind:'arm'});handler=input.onDetection;fail('arm');if(controls.arm)await controls.arm.promise;detectorCapturing=true;},
      suspend:async()=>{calls.push({kind:'suspend'});fail('suspend');detectorCapturing=false;},
      stop:async()=>{calls.push({kind:'detector.stop'});fail('detector.stop');detectorCapturing=false;}},
    commandAudio:{capture:async(_event,signal)=>{calls.push({kind:'capture',input:{signal}});fail('capture');return controls.capture?controls.capture.promise:{lease,postWakeSpeech};}},
    voice:{
      start:async input=>{calls.push({kind:'start',input});starts++;fail('start');const result=controls.start?await controls.start.promise:{sessionId:'session:'+starts,microphone:'live' as const};
        sessions.set(result.sessionId,{capture:result.microphone==='live',playback:false,activationId:input.activationId});return result;},
      quiesceCapture:async scope=>{calls.push({kind:'quiesce',scope});fail('quiesce');for(const [id,session]of sessions)if(owned(scope,id)){session.capture=false;session.playback=false;}},
      stop:async input=>{calls.push({kind:'stop',scope:input});fail('stop');return controls.stop?controls.stop.promise:{closure:controls.close};},
      releaseLocal:async scope=>{calls.push({kind:'release',scope});fail('release');for(const [id,session]of sessions)if(owned(scope,id)){session.capture=false;session.playback=false;}},
      reconcile:async scope=>{calls.push({kind:'reconcile',scope});fail('reconcile');return {closure:controls.reconciled};},
    },clock,observe:view=>{views.push(structuredClone(view));fail('observe');},
  };
  const coordinator=new VelaWakeCoordinator(ports);
  return {coordinator,ports,clock,calls,views,sessions,controls,lease,get handler(){return handler;},get starts(){return starts;},get leaseReleases(){return leaseReleases;},get detectorCapturing(){return detectorCapturing;},
    speech(value:'present'|'absent'|'unknown'){postWakeSpeech=value;},fire:(event=detection)=>{assert(handler);return handler(event);},
    async active(){await coordinator.enable();await handler!(detection);assert.equal(coordinator.state().phase,'LISTENING');return coordinator.state().sessionId!;},
    async manual(id='manual:1'){sessions.set(id,{capture:true,playback:false});await coordinator.observeNativeVoice(observed(id,{owner:'manual'}));return id;},
  };
}

test('constructor and saved preferences never opt in or open a microphone; defaults and bounds are explicit',()=>{
  const f=fixture();assert.deepEqual(f.coordinator.state().preferences,VELA_WAKE_DEFAULTS);assert.equal(f.coordinator.state().phase,'OFF');
  assert.equal(f.coordinator.state().microphone,'off');assert.equal(f.calls.length,0);
  for(const value of [{idleTimeoutMs:14999},{idleTimeoutMs:120001},{sensitivity:-1},{phraseId:'unsupported phrase text'},{enabled:true}]){
    assert.throws(()=>new VelaWakeCoordinator(f.ports,value as any),/wake_preferences_invalid/);
  }
  assert.equal(new VelaWakeCoordinator(f.ports,{idleTimeoutMs:120000}).state().phase,'OFF');
});
test('native opt-in is required before local arm and repeated enabled configuration does not duplicate capture',async()=>{
  const f=fixture();f.controls.fail.add('authorize');await f.coordinator.enable();assert.equal(f.coordinator.state().phase,'ERROR');
  assert(!f.calls.some(call=>call.kind==='arm'));assert.equal(f.starts,0);await assert.rejects(f.coordinator.enable(),/wake_error_backoff/);
  f.controls.fail.delete('authorize');await f.clock.advance(5000);await f.coordinator.enable();await f.coordinator.enable();
  assert.equal(f.calls.filter(call=>call.kind==='arm').length,1);assert.equal(f.coordinator.state().microphone,'wake-only');assert.equal(f.starts,0);
});
test('one native wake starts one session; model-estimated boundaries remain private and bare wake requests in-session dynamic greeting',async()=>{
  const f=fixture();await f.active();const start=f.calls.find(call=>call.kind==='start')!.input;
  assert.equal(start.greeting,'dynamic-in-session');assert.equal(start.pronunciation,'VAY-luh');assert.equal(start.initializationExposureSeconds,15);assert.equal(start.commandAudio,f.lease);
  assert.equal(f.leaseReleases,1);assert.equal(f.coordinator.state().voice,'active');assert.equal(f.coordinator.state().detector,'suspended');
  const visible=JSON.stringify(f.views);assert.doesNotMatch(visible,/private-native-consent|Float32Array|keywordEndSample|samples|commandAudio|PRIVATE_NATIVE/);
  assert.equal(f.coordinator.state().budget.dispatchedAttempts,1);assert.equal(f.coordinator.state().budget.possibleInitializationExposureSeconds,15);
});
test('wake followed by actual command VAD transfers only an opaque lease and suppresses an extraneous greeting',async()=>{
  const f=fixture();f.speech('present');await f.active();const start=f.calls.find(call=>call.kind==='start')!.input;
  assert.equal(start.greeting,'none');assert.equal(start.commandAudio,f.lease);assert.equal(f.leaseReleases,1);
  const unknown=fixture();unknown.speech('unknown');await unknown.active();assert.equal(unknown.calls.find(call=>call.kind==='start')!.input.greeting,'none');
  assert.equal(unknown.calls.find(call=>call.kind==='start')!.input.commandAudio,unknown.lease);
});
test('duplicate engine events and Vela playback cannot create a second paid start, while full-duplex live input remains enabled',async()=>{
  const f=fixture();f.controls.start=deferred();await f.coordinator.enable();const first=f.fire();await flush();const old=f.handler!;
  await old(detection);assert.equal(f.starts,1);assert.equal(f.coordinator.state().phase,'ACTIVATING');
  f.controls.start.resolve({sessionId:'first',microphone:'live'});await first;await f.coordinator.observeNativeVoice(observed('first',{actualPlaybackActive:true,localSpeechActive:true}));
  assert.equal(f.coordinator.state().phase,'SPEAKING');assert.equal(f.coordinator.state().microphone,'live');await old(detection);assert.equal(f.starts,1);
});
test('master microphone off quiesces capture/playback before waiting for close acknowledgement',async()=>{
  const f=fixture(),id=await f.active();f.sessions.get(id)!.playback=true;f.controls.stop=deferred();
  const off=f.coordinator.masterMicrophoneOff();assert(f.calls.some(call=>call.kind==='quiesce'&&call.scope?.all));
  assert.equal(f.sessions.get(id)!.capture,false);assert.equal(f.sessions.get(id)!.playback,false);await flush();
  assert.equal(f.coordinator.state().voice,'closing');assert.equal(f.coordinator.state().microphone,'off');
  f.controls.stop.resolve({closure:'confirmed'});await off;assert.equal(f.coordinator.state().phase,'OFF');assert.equal(f.coordinator.state().voice,'inactive');
});
test('a cancelled late successful start is closed by its own identities and never resurrects capture or active state',async()=>{
  const f=fixture();f.controls.start=deferred();await f.coordinator.enable();const activation=f.fire();await flush();
  const signal=f.calls.find(call=>call.kind==='start')!.input.signal;await f.coordinator.masterMicrophoneOff();
  assert.equal(signal.aborted,true);assert.equal(f.coordinator.state().voice,'unknown');assert.equal(f.coordinator.state().phase,'ERROR');
  f.controls.start.resolve({sessionId:'late:old',microphone:'live'});await activation;
  assert.equal(f.sessions.get('late:old')!.capture,false);assert.equal(f.coordinator.state().phase,'OFF');assert.equal(f.coordinator.state().voice,'inactive');
  assert(f.calls.some(call=>call.kind==='stop'&&call.scope?.sessionId==='late:old'&&!call.scope.all));assert.equal(f.starts,1);
});
test('cleanup of an old cancelled start cannot stop a newer independently authorized manual session',async()=>{
  const f=fixture();f.controls.start=deferred();await f.coordinator.enable();const activation=f.fire();await flush();await f.coordinator.masterMicrophoneOff();
  const manual=await f.manual('manual:new');f.controls.start.resolve({sessionId:'late:old',microphone:'live'});await activation;
  assert.equal(f.sessions.get(manual)!.capture,true);assert.equal(f.sessions.get('late:old')!.capture,false);
  assert.equal(f.coordinator.state().owner,'manual');assert.equal(f.coordinator.state().sessionId,manual);assert.equal(f.coordinator.state().microphone,'live');
  const stops=f.calls.filter(call=>call.kind==='stop').length;await f.coordinator.disableWake();
  assert.equal(f.calls.filter(call=>call.kind==='stop').length,stops);assert.equal(f.sessions.get(manual)!.capture,true);
  await f.coordinator.masterMicrophoneOff();assert.equal(f.sessions.get(manual)!.capture,false);
});
test('late local arm is stopped after cancellation and cannot reopen a microphone after master off',async()=>{
  const f=fixture();f.controls.arm=deferred();const enable=f.coordinator.enable();await flush();assert.equal(f.coordinator.state().detector,'starting');
  await f.coordinator.masterMicrophoneOff();f.controls.arm.resolve();await enable;assert.equal(f.detectorCapturing,false);
  assert.equal(f.coordinator.state().phase,'OFF');assert.equal(f.starts,0);
});
test('shutdown cancels pending audio acquisition, releases a late lease and never starts a paid session',async()=>{
  const f=fixture();f.controls.capture=deferred();await f.coordinator.enable();const activation=f.fire();await flush();await f.coordinator.shutdown();
  f.controls.capture.resolve({lease:f.lease,postWakeSpeech:'present'});await activation;assert.equal(f.leaseReleases,1);assert.equal(f.starts,0);
  await f.clock.advance(120000);assert.equal(f.coordinator.state().phase,'OFF');await assert.rejects(f.coordinator.enable(),/wake_shutdown/);
});
test('idle closes a wake session despite independent backend work and returns to local arm only after confirmed closure and cooldown',async()=>{
  const f=fixture(),id=await f.active();await f.coordinator.observeNativeVoice(observed(id,{backendWorking:true}));
  assert.equal(f.coordinator.state().phase,'WORKING');await f.clock.advance(20000);
  assert.equal(f.coordinator.state().voice,'inactive');assert.equal(f.coordinator.state().phase,'COOLDOWN');assert.equal(f.coordinator.state().backendWorking,true);
  assert.equal(f.starts,1);await f.clock.advance(1999);assert.equal(f.coordinator.state().phase,'COOLDOWN');await f.clock.advance(1);
  assert.equal(f.coordinator.state().phase,'ARMED');assert.equal(f.coordinator.state().microphone,'wake-only');assert.equal(f.starts,1);
});
test('actual speech, actual playback and important queued responses each defer idle closure; backend flags alone do not renew it',async()=>{
  const f=fixture(),id=await f.active();
  for(const flag of ['localSpeechActive','actualPlaybackActive','importantResponseQueued'] as const){
    await f.coordinator.observeNativeVoice(observed(id,{[flag]:true}));await f.clock.advance(25000);assert.equal(f.coordinator.state().voice,'active');
    await f.coordinator.observeNativeVoice(observed(id));await f.clock.advance(19999);assert.equal(f.coordinator.state().voice,'active');
  }
  await f.coordinator.observeNativeVoice(observed(id,{backendWorking:true}));await f.clock.advance(1);assert.equal(f.coordinator.state().voice,'inactive');assert.equal(f.starts,1);
});
test('muting is a visible active voice state and does not masquerade as paid-session closure',async()=>{
  const f=fixture(),id=await f.active();await f.coordinator.observeNativeVoice(observed(id,{microphone:'muted'}));
  assert.equal(f.coordinator.state().microphone,'muted');assert.equal(f.coordinator.state().voice,'active');assert(!f.calls.some(call=>call.kind==='stop'));
  await f.clock.advance(20000);assert(f.calls.some(call=>call.kind==='stop'));assert.equal(f.coordinator.state().voice,'inactive');
});
test('unknown remote closure prevents automatic rearming and new paid starts until explicit successful reconciliation',async()=>{
  const f=fixture();await f.active();f.controls.close='unknown';await f.clock.advance(20000);assert.equal(f.coordinator.state().phase,'ERROR');
  assert.equal(f.coordinator.state().voice,'unknown');assert.equal(f.coordinator.state().microphone,'off');await f.clock.advance(120000);
  assert.equal(f.starts,1);assert.equal(f.coordinator.state().detector,'stopped');await assert.rejects(f.coordinator.enable(),/wake_reconciliation_required/);
  f.controls.close='confirmed';await f.coordinator.reconcile();assert.equal(f.coordinator.state().phase,'ARMED');assert.equal(f.starts,1);
});
test('unknown native connection events release local resources and remain ERROR even if a best-effort close succeeds',async()=>{
  const f=fixture(),id=await f.active();await f.coordinator.observeNativeVoice(observed(id,{connection:'unknown',microphone:'unknown'}));
  assert.equal(f.coordinator.state().phase,'ERROR');assert.equal(f.coordinator.state().voice,'unknown');assert.equal(f.sessions.get(id)!.capture,false);
  await f.clock.advance(60000);assert.equal(f.starts,1);assert.equal(f.coordinator.state().phase,'ERROR');
});
test('master off attempts every independent release even when detector, quiesce and remote stop throw; raw errors do not escape in metadata',async()=>{
  const f=fixture();await f.active();for(const name of ['detector.stop','quiesce','stop','observe'])f.controls.fail.add(name);
  await f.coordinator.masterMicrophoneOff();assert(f.calls.some(call=>call.kind==='release'&&call.scope?.all));assert.equal(f.coordinator.state().phase,'ERROR');
  assert.equal(f.coordinator.state().voice,'unknown');assert.doesNotMatch(JSON.stringify(f.coordinator.state()),/PRIVATE_NATIVE|private-native-consent/);
});
test('device changes stop capture and voice without automatic paid reconnection',async()=>{
  const f=fixture(),id=await f.active();await f.coordinator.deviceChanged();assert.equal(f.sessions.get(id)!.capture,false);await f.clock.advance(120000);
  assert.equal(f.starts,1);assert.equal(f.coordinator.state().phase,'OFF');assert.equal(f.coordinator.state().enabled,false);
});
test('wake disable preserves independent manual voice; master off releases it, and completed backend work has no cancellation port',async()=>{
  const f=fixture(),id=await f.manual();await f.coordinator.enable();assert.equal(f.coordinator.state().owner,'manual');assert(!f.calls.some(call=>call.kind==='arm'));
  await f.coordinator.disableWake();assert.equal(f.sessions.get(id)!.capture,true);assert(!f.calls.some(call=>call.kind==='stop'));
  await f.coordinator.masterMicrophoneOff();assert.equal(f.sessions.get(id)!.capture,false);assert.equal(f.coordinator.state().voice,'inactive');
});
test('rate limits count each dispatched start once, enforce finite exposure and never create an automatic retry loop',async()=>{
  const f=fixture();await f.coordinator.enable();
  for(let i=0;i<3;i++){await f.fire();const id=f.coordinator.state().sessionId!;await f.coordinator.observeNativeVoice(observed(id,{connection:'closed',microphone:'off'}));await f.clock.advance(2000);}
  await f.fire();assert.equal(f.starts,3);assert.equal(f.coordinator.state().phase,'ERROR');assert.equal(f.coordinator.state().lastError,'wake_attempt_budget_exhausted');
  assert.equal(f.coordinator.state().budget.possibleInitializationExposureSeconds,45);await f.clock.advance(120000);assert.equal(f.starts,3);assert.equal(f.coordinator.state().phase,'ERROR');
});
test('a start deadline aborts the attempt and cleans a late success without re-requesting',async()=>{
  const f=fixture();f.controls.start=deferred();await f.coordinator.enable();const activation=f.fire();await flush();await f.clock.advance(15000);await activation;
  assert.equal(f.coordinator.state().phase,'ERROR');assert.equal(f.coordinator.state().voice,'unknown');assert.equal(f.starts,1);
  f.controls.start.resolve({sessionId:'late:timeout',microphone:'live'});await flush();assert.equal(f.sessions.get('late:timeout')!.capture,false);
  assert.equal(f.coordinator.state().phase,'ERROR');await f.clock.advance(120000);assert.equal(f.starts,1);
});
test('invalid phrase/boundary events and stale detector generations cannot invoke paid start',async()=>{
  const f=fixture();await f.coordinator.enable();const old=f.handler!;await f.fire({...detection,phraseId:'other'});
  await f.fire({...detection,keywordEndSample:10000,detectedAtSample:9000});assert.equal(f.starts,0);await f.coordinator.disableWake();await f.coordinator.enable();
  await old(detection);assert.equal(f.starts,0);await f.fire();assert.equal(f.starts,1);
});
test('pre-dispatch local adapter failure spends no attempt and leaves no capture or autonomous reconnect',async()=>{
  const f=fixture();await f.coordinator.enable();f.controls.fail.add('suspend');await f.fire();
  assert.equal(f.starts,0);assert.equal(f.coordinator.state().budget.dispatchedAttempts,0);assert.equal(f.detectorCapturing,false);assert.equal(f.coordinator.state().phase,'ERROR');
});
test('a slow remote close is bounded while physical capture is already off',async()=>{
  const f=fixture(),id=await f.active();f.controls.stop=deferred();const off=f.coordinator.masterMicrophoneOff();await flush();
  assert.equal(f.sessions.get(id)!.capture,false);await f.clock.advance(5000);await off;assert.equal(f.coordinator.state().phase,'ERROR');assert.equal(f.coordinator.state().voice,'unknown');
  assert(f.calls.some(call=>call.kind==='release'&&call.scope?.all));assert.equal(f.starts,1);assert.equal(f.coordinator.state().microphone,'off');
});
test('unknown closure retains an owned session reference for explicit reconciliation after the visible session is cleared',async()=>{
  const f=fixture(),id=await f.active();f.controls.close='unknown';await f.clock.advance(20000);await f.clock.advance(5000);
  f.controls.close='confirmed';await f.coordinator.reconcile();
  assert(f.calls.some(call=>call.kind==='reconcile'&&call.scope?.sessionId===id));assert.equal(f.coordinator.state().phase,'ARMED');
});
test('a late rejected arm is cleaned again because cancellation may have preceded native partial allocation',async()=>{
  const f=fixture();f.controls.arm=deferred();const enabling=f.coordinator.enable();await flush();await f.coordinator.masterMicrophoneOff();
  const stops=f.calls.filter(call=>call.kind==='detector.stop').length;f.controls.arm.reject(Error('PRIVATE_LATE_ARM'));await enabling;
  assert.equal(f.calls.filter(call=>call.kind==='detector.stop').length,stops+1);assert.equal(f.coordinator.state().phase,'OFF');assert.equal(f.starts,0);
});
test('a late rejected start still receives attempt-bound cleanup after cancellation',async()=>{
  const f=fixture();f.controls.start=deferred();await f.coordinator.enable();const starting=f.fire();await flush();
  const activationId=f.calls.find(call=>call.kind==='start')!.input.activationId;await f.coordinator.masterMicrophoneOff();
  f.controls.start.reject(Error('PRIVATE_LATE_START'));await starting;
  assert(f.calls.some(call=>call.kind==='stop'&&call.scope?.activationId===activationId&&!call.scope?.all));
  assert.equal(f.coordinator.state().phase,'OFF');assert.equal(f.coordinator.state().voice,'inactive');assert.equal(f.starts,1);
});
