import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv,createDecipheriv,randomBytes,randomUUID } from 'node:crypto';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,relative,resolve,isAbsolute } from 'node:path';
import { BackendCore } from '../src/core.mts';
import { encodeNativeWakeFrame, type WakeCaptureState } from '../src/wake-capture-host.mts';
import type { NativeHostServices } from '../src/native-host.mts';
import type { GptLiveMediaState, NativeLiveMediaServices } from '../src/live-media-host.mts';
import type { WakeEngineFactory, VelaWakeState } from '../src/vela-wake-runtime.mts';
import type { StreamEvent } from '../src/contracts.mts';
import { LIVE_ENDPOINT } from '../../openai-provider/live.mts';

const marker='SYNTHETIC_ONLY_WAKE_RUNTIME_CREDENTIAL';
const off=():WakeCaptureState=>({contract:'aerynth.wake-audio-capture@1',generation:null,phase:'off',microphone:'off',sampleRate:null,inputDevice:'default',frames:0,pendingFrames:0,signalActivity:'unavailable',activitySource:'local-rms-only'});
const mediaOff=():GptLiveMediaState=>({contract:'aerynth.gpt-live-media@1',connection:'idle',microphoneAccess:'not-requested',localTrackEnabled:false,localSourceMuted:null,providerInputMute:'unknown',playback:'idle',playbackObserved:false,humanAudibility:'unverified',inputDevice:'default',outputDevice:'default',localSpeech:'unavailable',remoteSignal:'unavailable',interruption:'none'});
function fixture(){
  const base=resolve(tmpdir()),dir=mkdtempSync(join(base,'aerynth-wake-core-')),path=join(dir,'canonical.sqlite'),key=randomBytes(32),events:StreamEvent[]=[],requests:any[]=[],prepared:any[]=[];
  let capture=off(),media=mediaOff(),arms=0,disposals=0,engines=0,engineDisposals=0,liveSerial=0,detect=false,postWakeSpeech:'present'|'absent'|'unknown'='absent';
  let nativePeer:Parameters<NativeLiveMediaServices['connect']>[0]|null=null,releaseEngine:(()=>void)|null=null,holdEngine=false;
  const samplesSeen:Float32Array[]=[],releasedLeases:string[]=[];
  let time=1000,serial=0;const scheduled=new Map<number,{at:number;callback:()=>void}>();
  const clock={now:()=>time,schedule:(delay:number,callback:()=>void)=>{const id=++serial;scheduled.set(id,{at:time+delay,callback});return()=>{scheduled.delete(id);};}};
  const engineFactory:WakeEngineFactory=async()=>{engines++;return {start:async()=>({}),dispose:async()=>{engineDisposals++;releaseEngine?.();},acceptPcm:async input=>{samplesSeen.push(input.samples);
    if(holdEngine)await new Promise<void>(resolve=>{releaseEngine=resolve;});
    const detections=detect?[{phraseId:'hey-vela',text:'Hey Vela',keywordStartSample:0,keywordEndSample:480,detectedAtSample:640,sampleRate:16000 as const,timestampSource:'sherpa-token-alignment-40ms' as const,boundaryAccuracy:'model-estimate' as const}]:[];detect=false;
    return {processedSamples:(input.sequence+1)*640,detections,metrics:{cpuMicroseconds:0,elapsedMs:0,rssBytes:0}};}};};
  const liveMedia:NativeLiveMediaServices={prepare:async input=>{prepared.push(input);media={...mediaOff(),connection:'prepared',microphoneAccess:'active',localTrackEnabled:true};return {offerId:'synthetic-offer',sdpOffer:'v=0\r\no=SYNTHETIC_WAKE_OFFER\r\n'};},
    connect:async input=>{nativePeer=input;media.connection='connected';setTimeout(()=>{void input.onEvent({type:'session.started',event_id:'start-'+input.sessionId,session:{id:input.sessionId}});},1);
      return {send:async command=>{if(command.type==='session.close'){await input.onEvent({type:'session.closed',event_id:'close-'+input.sessionId,session:{id:input.sessionId},usage:{seconds:2}});}
        else await input.onEvent({type:command.type==='session.commentary.append'?'session.commentary.appended':command.type==='session.input_audio.mute'?'session.input_audio.muted':'session.input_audio.unmuted',event_id:randomUUID(),client_event_id:command.event_id});},close:async()=>{media.connection='closed';}};},
    state:async()=>({...media}),devices:async()=>[],setInputDevice:async()=>{},setOutputDevice:async()=>{},setLocalMute:async muted=>{media.localTrackEnabled=!muted;},resumePlayback:async()=>{},interruptPlayback:async()=>{media.playback='interrupted';},
    quiesceCapture:async()=>{media.microphoneAccess='released';media.localTrackEnabled=false;media.playback='interrupted';},dispose:async()=>{disposals++;media={...mediaOff(),connection:'disposed',microphoneAccess:'released'};}};
  const native:NativeHostServices={liveMedia,wakeCapture:{arm:async input=>{arms++;capture={...off(),generation:input.generation,phase:'capturing',microphone:'active',sampleRate:16000};return {...capture};},
    pause:async input=>{assert.equal(input.generation,capture.generation);capture.phase='handoff';return {...capture};},stop:async input=>{if(input.generation!==undefined&&capture.generation!==input.generation)return {...capture};capture={...off(),generation:capture.generation,phase:'stopped',microphone:'released'};return {...capture};},state:async()=>({...capture}),
    lease:async input=>{assert.equal(input.generation,capture.generation);assert.equal(input.keywordEndSample,480);return {leaseRef:'synthetic-main-lease-'+input.generation,postWakeSpeech};},releaseLease:async input=>{releasedLeases.push(input.leaseRef);return {released:true};}},
    secrets:{available:async()=>true,seal:async text=>{const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,cipher.update(text),cipher.final(),cipher.getAuthTag()]);},open:async bytes=>{const data=Buffer.from(bytes),cipher=createDecipheriv('aes-256-gcm',key,data.subarray(0,12));cipher.setAuthTag(data.subarray(-16));return Buffer.concat([cipher.update(data.subarray(12,-16)),cipher.final()]).toString();}}};
  const fetchFixture=(async(url,init)=>{if(String(url).endsWith('/models'))return Response.json({data:[{id:'gpt-6-luna'}]});assert.equal(String(url),LIVE_ENDPOINT);assert.equal(new Headers(init?.headers).get('authorization'),'Bearer '+marker);requests.push(JSON.parse(String(init?.body)));
    return Response.json({session:{id:'synthetic-wake-live-'+ ++liveSerial},transport:{type:'webrtc',sdp:'v=0\r\no=SYNTHETIC_WAKE_ANSWER\r\n'}},{status:201});}) as typeof fetch;
  const create=()=>new BackendCore({path,provider:'fixture',contentPolicy:'synthetic-only'},event=>events.push(event),native,undefined,{fetch:fetchFixture,voice:{fetch:fetchFixture,acknowledgementMs:100},wake:{engineFactory,clock,limits:{cooldownMs:10,cleanupTimeoutMs:1000,startTimeoutMs:1000}}});
  let core=create();
  const state=async()=>await core.command('velaWake',{name:'state',input:{}});
  return {get core(){return core;},events,requests,prepared,releasedLeases,samplesSeen,get arms(){return arms;},get engines(){return engines;},get engineDisposals(){return engineDisposals;},get disposals(){return disposals;},get capture(){return capture;},get media(){return media;},state,
    async ready(){await core.command('velaApiConfigure',{credential:{configurationId:'vela-primary',apiKey:marker},expectedVersion:null});await core.command('velaApiUsageAuthorize',{expectedVersion:1,enabled:true});},
    async enable(preferences={}){const previous=await state();return core.command('velaWakeNative',{name:'enable',input:{expectedVersion:previous.settings.version,preferences}});},
    async frame(sequence=0,generation=capture.generation!){return core.command('velaWakeFrame',encodeNativeWakeFrame({generation,sequence,startSample:sequence*640,sampleRate:16000,samples:new Float32Array(640).fill(.1),signalActivity:'signal',rms:.1,mode:'detector'}));},
    detection(value=true){detect=value;},commandAudio(value:typeof postWakeSpeech){postWakeSpeech=value;},hold(){holdEngine=true;},release(){holdEngine=false;releaseEngine?.();},
    async advance(ms:number){time+=ms;for(const [id,work] of [...scheduled])if(work.at<=time){scheduled.delete(id);work.callback();}await new Promise(resolve=>setTimeout(resolve,5));},
    async observe(){await (core as any).velaWakeRuntime.observeVoice();},
    async reopen(){await core.command('close',{});core=create();},
    async close(){releaseEngine?.();await core.command('close',{}).catch(()=>{});const part=relative(base,resolve(dir));assert.ok(part.startsWith('aerynth-wake-core-')&&!part.startsWith('..')&&!isAbsolute(part));rmSync(dir,{recursive:true,force:true});},
  };
}
async function until(f:ReturnType<typeof fixture>,accept:(view:VelaWakeState)=>boolean){for(let i=0;i<200;i++){const view=await f.state();if(accept(view))return view;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('wake state did not settle');}

test('actual Core starts OFF, requires native opt-in and persists local-only consent without opening paid voice or another conversation',async()=>{
  const f=fixture();try{const initial=await f.state();assert.equal(initial.phase,'OFF');assert.equal(initial.settings.version,0);assert.equal(initial.settings.enabled,false);assert.equal(f.arms,0);assert.equal(f.requests.length,0);
    await f.core.command('velaWakeNative',{name:'ready',input:{}});assert.equal(f.arms,0);
    await assert.rejects(f.core.command('velaWake',{name:'enable',input:{}} as any),/wake_invalid_control/);await assert.rejects(f.frame(),/wake_frame_not_admitted/);
    const armed=await f.enable({idleTimeoutMs:25000});assert.equal(armed.phase,'ARMED');assert.equal(armed.microphone,'wake-only');assert.equal(armed.settings.version,1);assert.equal(f.requests.length,0);
    assert.equal((await f.core.command('snapshot',{})).conversations.length,0);const generation=f.capture.generation!;
    await f.reopen();assert.equal((await f.state()).phase,'OFF');assert.equal(f.arms,1);assert.equal((await f.state()).settings.preferences.idleTimeoutMs,25000);
    await f.core.command('velaWakeNative',{name:'ready',input:{}});assert.equal((await f.state()).phase,'ARMED');assert.equal(f.arms,2);assert.ok(f.capture.generation!>generation);assert.equal(f.requests.length,0);
    await assert.rejects(f.frame(0,generation),/wake_frame_not_admitted/);
  }finally{await f.close();}
});
test('actual wake uses canonical GPT-Live once, dynamic in-session greeting and confirmed idle close before returning to local arm',async()=>{
  const f=fixture();try{await f.ready();await f.enable();f.detection();await f.frame();const listening=await until(f,view=>view.phase==='LISTENING');assert.equal(listening.owner,'wake');assert.equal(f.requests.length,1);
    const body=f.requests[0];assert.match(JSON.stringify(body.session.input),/VAY-luh/);assert.ok(body.session.input.some((item:any)=>item.role==='developer'&&/brief|greet/iu.test(item.content[0].text)));assert.match(f.prepared[0].bufferLeaseRef,/synthetic-main-lease/);
    assert.equal((await f.core.command('snapshot',{})).conversations.length,1);assert.ok(f.samplesSeen.every(samples=>samples.every(value=>value===0)));
    await f.advance(20001);const cooled=await until(f,view=>view.phase==='COOLDOWN');assert.equal(cooled.voice,'inactive');assert.equal(f.media.microphoneAccess,'released');
    const voice=await f.core.command('velaVoice',{name:'state',input:{}}) as any;assert.equal(voice.session.finalization,'confirmed');assert.equal(voice.session.usage.seconds,2);
    await f.advance(11);assert.equal((await f.state()).phase,'ARMED');assert.equal(f.requests.length,1,'idle return must not reconnect paid voice');
  }finally{await f.close();}
});
test('post-wake command uses an opaque Main lease and suppresses the greeting without uploading ambient detector PCM',async()=>{
  const f=fixture();try{await f.ready();await f.enable();f.commandAudio('present');f.detection();await f.frame();await until(f,view=>view.phase==='LISTENING');
    assert.match(f.prepared[0].bufferLeaseRef,/synthetic-main-lease/);assert.ok(f.requests[0].session.input.some((item:any)=>item.role==='developer'&&/Do not add an opening greeting/u.test(item.content[0].text)));
    assert.equal(f.requests.length,1);assert.ok(f.releasedLeases.length===1);assert.ok(!JSON.stringify(f.events).includes('pcmBase64'));assert.ok(!JSON.stringify(await f.state()).includes('samples'));
  }finally{await f.close();}
});

test('native capture loss is generation-fenced, clears ARMED and emits metadata without audio',async()=>{
  const f=fixture();try{await f.enable();const generation=f.capture.generation!;
    const lost={...f.capture,phase:'failed' as const,microphone:'released' as const,sampleRate:null,pendingFrames:0,errorCode:'wake_capture_device_ended'};
    const stale=await f.core.command('velaWakeCaptureState',{...lost,generation:generation+1});assert.equal(stale.phase,'ARMED');
    await assert.rejects(f.core.command('velaWakeCaptureState',{...lost,privateAudio:new Float32Array(1)} as any),/wake_host_protocol/);
    const result=await f.core.command('velaWakeCaptureState',lost);assert.equal(result.phase,'ERROR');assert.equal(result.microphone,'off');
    assert.equal(result.detector,'stopped');assert.equal(f.engineDisposals,1);assert.equal(f.requests.length,0);
    await f.core.command('velaWakeCaptureState',lost);assert.equal(f.engineDisposals,1,'duplicate loss is inert after cleanup');
    const wakeEvents=(await f.core.command('replay',{after:0,limit:200})).events.filter(event=>event.type==='vela.wake/state');
    assert(wakeEvents.some(event=>(event.payload as any).wake.errorCode==='wake_capture_lost'));
    assert.doesNotMatch(JSON.stringify(wakeEvents),/pcmBase64|samples|rms|leaseRef|inputDeviceId|frames/);
  }finally{await f.close();}
});
test('usage revocation and key rotation invalidate standing wake spend authority before any paid request',async()=>{
  for(const change of ['usage','rotation'] as const){const f=fixture();try{await f.ready();await f.enable();
    if(change==='usage')await f.core.command('velaApiUsageAuthorize',{expectedVersion:1,enabled:false});else{await f.core.command('velaApiConfigure',{credential:{configurationId:'vela-primary',apiKey:marker},expectedVersion:1});await f.core.command('velaApiUsageAuthorize',{expectedVersion:2,enabled:true});}
    f.detection();await f.frame();await until(f,view=>view.phase==='ERROR');assert.equal(f.requests.length,0);assert.notEqual(f.media.microphoneAccess,'active');assert.notEqual(f.capture.microphone,'active');
  }finally{await f.close();}}
});
test('frame admission rejects wrong sequence/generation and bounded concurrency; processed PCM is zeroed and never journaled',async()=>{
  const f=fixture();try{await f.enable();await assert.rejects(f.frame(1),/wake_frame_not_admitted/);await assert.rejects(f.frame(0,f.capture.generation!+1),/wake_frame_not_admitted/);
    const before=(await f.core.command('replay',{after:0,limit:200})).events.length;f.hold();const pending=f.frame();await new Promise(resolve=>setTimeout(resolve,0));await assert.rejects(f.frame(1),/wake_frame_not_admitted/);f.release();await pending;
    assert.ok(f.samplesSeen.every(samples=>samples.every(value=>value===0)));assert.equal((await f.core.command('replay',{after:0,limit:200})).events.length,before);
    await f.core.command('velaWake',{name:'masterOff',input:{}});assert.equal((await f.state()).phase,'OFF');assert.equal((await f.state()).settings.enabled,false);await assert.rejects(f.frame(1),/wake_frame_not_admitted/);
    const wakeEvents=(await f.core.command('replay',{after:0,limit:200})).events.filter(event=>event.type==='vela.wake/state');
    assert.ok(wakeEvents.some(event=>(event.payload as any).wake.phase==='ARMED'));assert.ok(wakeEvents.some(event=>(event.payload as any).wake.phase==='OFF'));
    assert.doesNotMatch(JSON.stringify(wakeEvents),/pcmBase64|samples|rms|leaseRef|keywordEndSample|inputDeviceId/);
  }finally{await f.close();}
});

test('late wake-owned cleanup cannot quiesce or close a newer manual session; master off still closes that session',async()=>{
  const f=fixture();try{await f.ready();await f.enable();f.detection();await f.frame();await until(f,view=>view.phase==='LISTENING');
    const old=(await f.core.command('velaVoice',{name:'state',input:{}}) as any).session;
    await f.core.command('velaWake',{name:'masterOff',input:{}});
    const attemptId=randomUUID(),grant=await f.core.command('velaVoiceNative',{name:'authorize',input:{attemptId,operation:'start'}}) as any;
    await f.core.command('velaVoiceNative',{name:'start',input:{attemptId,authorizationRef:grant.authorizationRef}});await new Promise(resolve=>setTimeout(resolve,10));
    const voice=(f.core as any).velaVoiceRuntime,before=f.disposals;
    await voice.quiesceOwned({activationId:old.attemptId,sessionId:old.sessionId});await voice.stopOwned({activationId:old.attemptId,sessionId:old.sessionId});await voice.releaseOwned({activationId:old.attemptId,sessionId:old.sessionId});
    assert.equal(f.disposals,before);assert.equal(f.media.microphoneAccess,'active');assert.equal((await f.core.command('velaVoice',{name:'state',input:{}}) as any).session.state,'running');
    await f.core.command('velaWake',{name:'disableWake',input:{}});assert.equal(f.media.microphoneAccess,'active');
    await f.core.command('velaWake',{name:'masterOff',input:{}});assert.equal(f.media.microphoneAccess,'released');assert.equal((await f.core.command('velaVoice',{name:'state',input:{}}) as any).session.finalization,'confirmed');
  }finally{await f.close();}
});
