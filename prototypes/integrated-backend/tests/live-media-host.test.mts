import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createNativeLiveHostClient, createNativeLiveHostServer, validateNativeLiveHostMessage, NATIVE_LIVE_LIMITS } from '../src/live-media-host.mts';
import type { NativeLiveHostMessage, NativeLiveMediaServices, GptLiveMediaState } from '../src/live-media-host.mts';
import type { LiveChannel, LiveMediaAdapter } from '../../openai-provider/live-contracts.mts';

const tick=()=>new Promise<void>(done=>setImmediate(done));
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
const state=():GptLiveMediaState=>({contract:'aerynth.gpt-live-media@1',connection:'prepared',microphoneAccess:'active',localTrackEnabled:true,localSourceMuted:false,
  providerInputMute:'unknown',playback:'idle',playbackObserved:false,humanAudibility:'unverified',inputDevice:'default',outputDevice:'default',localSpeech:'silent',remoteSignal:'unavailable',interruption:'none'});
const request=(operation:string,payload:any,id=randomUUID()):NativeLiveHostMessage=>({nativeLiveHost:{version:1,kind:'request',id,operation,payload}});
const event=(operation:string,payload:any):NativeLiveHostMessage=>({nativeLiveHost:{version:1,kind:'event',id:randomUUID(),operation,payload}});
function fixture(overrides:Partial<NativeLiveMediaServices>={}) {
  const sent:NativeLiveHostMessage[]=[],commands:unknown[]=[],providerEvents:unknown[]=[];
  let peer:Parameters<LiveMediaAdapter['connect']>[0]|undefined,lost=0,closes=0,disposals=0;
  const services:NativeLiveMediaServices={prepare:async()=>({offerId:'synthetic-offer',sdpOffer:'v=0\r\no=private-offer\r\n'}),
    connect:async input=>{peer=input;return {send:async command=>{commands.push(command);},close:async()=>{closes++;}};},
    state:async()=>state(),devices:async()=>[{kind:'audioinput',id:'synthetic-input',label:'Synthetic input',labelAvailable:true}],
    setInputDevice:async()=>{},setOutputDevice:async()=>{},setLocalMute:async()=>{},resumePlayback:async()=>{},interruptPlayback:async()=>{},dispose:async()=>{disposals++;},...overrides};
  const server=createNativeLiveHostServer(services,message=>{sent.push(message);client.handle(message);},{timeoutMs:100});
  const client=createNativeLiveHostClient(message=>{sent.push(message);server.handle(message);},{timeoutMs:100});
  return {services,server,client,sent,commands,providerEvents,get peer(){return peer!;},get lost(){return lost;},get closes(){return closes;},get disposals(){return disposals;},
    connect:()=>client.services.connect({sessionId:'synthetic-session',sdpAnswer:'v=0\r\no=private-answer\r\n',onEvent:async value=>{providerEvents.push(value);},onConnectionLost:()=>{lost++;}}),
    close(){client.close();server.close();}};
}

test('native media host round trip retains SDP privately, authenticates active session events and exposes observed media without audibility claims',async()=>{
  const f=fixture();try{
    assert.equal((await f.client.services.prepare({attemptId:'synthetic-attempt'})).offerId,'synthetic-offer');const channel=await f.connect();
    await f.peer.onEvent({type:'session.started',event_id:'start',session:{id:'synthetic-session'}});await tick();assert.equal(f.providerEvents.length,1);
    f.client.handle(event('provider-event',{sessionId:'wrong-session',event:{type:'session.input_transcript.delta'}}));await tick();assert.equal(f.providerEvents.length,1);
    const command={type:'session.input_audio.mute',event_id:'mute-1'} as const;await channel.send(command);assert.deepEqual(f.commands,[command]);
    await f.client.services.setLocalMute(true);await f.client.services.interruptPlayback();assert.equal((await f.client.services.devices()).length,1);
    const observed=await f.client.services.state();assert.equal(observed.humanAudibility,'unverified');assert.equal(observed.providerInputMute,'unknown');
    assert.ok(f.sent.every(validateNativeLiveHostMessage));assert.ok(!JSON.stringify(f.sent).includes('apiKey'));
    await channel.close();f.client.handle(event('provider-event',{sessionId:'synthetic-session',event:{type:'late'}}));await tick();assert.equal(f.providerEvents.length,1);
    await f.client.services.dispose();assert.equal(f.disposals,1);assert.equal(f.closes,1);
  }finally{f.close();}
});

test('native media wire rejects unknown keys, response types, commands, session identifiers and bounded payload overflows before dispatch',()=>{
  const samples=[request('unknown',{}),request('prepare',{attemptId:'space id'}),request('prepare',{attemptId:'valid',apiKey:'never-allowed'}),
    request('connect',{sessionId:'valid',sdpAnswer:'x'.repeat(65537)}),request('setLocalMute',{muted:'true'}),
    request('send',{sessionId:'valid',command:{type:'session.update',event_id:'unsupported'}}),
    request('send',{sessionId:'valid',command:{type:'session.commentary.append',event_id:'append',delegation_id:null,content:'x'.repeat(501)}}),
    event('provider-event',{sessionId:'valid',event:{payload:'x'.repeat(NATIVE_LIVE_LIMITS.eventBytes)}}),
    {...request('state',{}),unexpected:true},
  ];
  for(const sample of samples)assert.equal(validateNativeLiveHostMessage(sample),false,JSON.stringify(sample).slice(0,160));
  assert.equal(validateNativeLiveHostMessage(request('send',{sessionId:'valid',command:{type:'session.thinking.append',event_id:'append',delegation_id:null,content:'é'.repeat(250)}})),true);
  const circular:any={};circular.loop=circular;assert.equal(validateNativeLiveHostMessage(event('provider-event',{sessionId:'valid',event:circular})),false);
  for(const config of [{inFlight:9},{inFlight:0},{timeoutMs:15001},{timeoutMs:0}]){
    assert.throws(()=>createNativeLiveHostClient(()=>{},config),/live_media_capacity/);assert.throws(()=>createNativeLiveHostServer(undefined,()=>{},config),/live_media_capacity/);
  }
});

test('output-only host preparation retains the closed private contract and rejects combined input authority',async()=>{
  const prepared:unknown[]=[],f=fixture({prepare:async input=>{prepared.push(input);return{offerId:'output-offer',sdpOffer:'v=0'};}});
  try{
    await f.client.services.prepare({attemptId:'output-attempt',outputOnly:true,outputDeviceId:'speaker'});
    assert.deepEqual(prepared,[{attemptId:'output-attempt',outputOnly:true,outputDeviceId:'speaker'}]);
    for(const payload of [{attemptId:'attempt',outputOnly:false},{attemptId:'attempt',outputOnly:true,inputDeviceId:'mic'},{attemptId:'attempt',outputOnly:true,bufferLeaseRef:'lease'},{attemptId:'attempt',outputOnly:undefined}])assert.equal(validateNativeLiveHostMessage(request('prepare',payload)),false);
  }finally{f.close();}
});

test('native media host unavailable and thrown native failures return only bounded public error codes',async()=>{
  let client:ReturnType<typeof createNativeLiveHostClient>;const wire:NativeLiveHostMessage[]=[];
  const server=createNativeLiveHostServer(undefined,message=>{wire.push(message);client.handle(message);});client=createNativeLiveHostClient(message=>server.handle(message));
  try{await assert.rejects(client.services.devices(),/live_media_unavailable/);assert.ok(wire.every(validateNativeLiveHostMessage));}finally{client.close();server.close();}
  const marker='SYNTHETIC_PRIVATE_NATIVE_FAILURE';const f=fixture({devices:async()=>{throw Error(marker);}});
  try{await assert.rejects(f.client.services.devices(),/live_media_operation_failed/);assert.ok(!JSON.stringify(f.sent).includes(marker));}finally{f.close();}
});

test('native media client bounds pending work and rejects mismatched operations, malformed messages and closed transport safely',async()=>{
  const sent:NativeLiveHostMessage[]=[],client=createNativeLiveHostClient(message=>sent.push(message),{timeoutMs:25,inFlight:1});
  try{
    const first=client.services.state();await assert.rejects(client.services.devices(),/live_media_backpressure/);
    const header=sent[0].nativeLiveHost;client.handle({nativeLiveHost:{version:1,kind:'response',id:header.id,operation:'devices',result:[]}});
    await assert.rejects(first,/live_media_protocol/);
    const malformed=client.services.state();client.handle({nativeLiveHost:{version:1,kind:'response',id:sent.at(-1)!.nativeLiveHost.id,operation:'state',result:{apiKey:'never-allowed'}}});
    await assert.rejects(malformed,/live_media_timeout/);
    const pending=client.services.devices();client.close();await assert.rejects(pending,/live_media_closed/);await assert.rejects(client.services.state(),/live_media_closed/);
    assert.equal(client.handle({unrelated:true}),false);assert.equal(client.handle({nativeLiveHost:null}),true);
  }finally{client.close();}
  const thrown=createNativeLiveHostClient(()=>{throw Error('SYNTHETIC_PRIVATE_TRANSPORT');});try{await assert.rejects(thrown.services.state(),/live_media_closed/);}finally{thrown.close();}
});

test('native media server independently bounds parallel requests and duplicate wire identifiers without repeating native effects',async()=>{
  const gate=deferred<any>(),replies:NativeLiveHostMessage[]=[],id=randomUUID();let calls=0;
  const f=fixture();const server=createNativeLiveHostServer({...f.services,prepare:async()=>{calls++;return gate.promise;}},message=>replies.push(message),{inFlight:1,timeoutMs:100});
  try{
    server.handle(request('prepare',{attemptId:'first'},id));await tick();server.handle(request('prepare',{attemptId:'duplicate'},id));server.handle(request('prepare',{attemptId:'overflow'}));
    assert.equal(calls,1);assert.equal(replies.filter(message=>message.nativeLiveHost.error==='live_media_backpressure').length,2);
    gate.resolve({offerId:'synthetic-offer',sdpOffer:'v=0'});await tick();assert.equal(calls,1);assert.equal(replies.filter(message=>message.nativeLiveHost.result?.offerId==='synthetic-offer').length,1);
  }finally{gate.resolve({offerId:'synthetic-offer',sdpOffer:'v=0'});server.close();f.close();}
});

test('native media server permits one connection during asynchronous negotiation and closes a late timed-out channel',async()=>{
  const connected=deferred<LiveChannel>(),messages:NativeLiveHostMessage[]=[],f=fixture();let opens=0,closes=0;
  const server=createNativeLiveHostServer({...f.services,connect:async()=>{opens++;return connected.promise;}},message=>messages.push(message),{timeoutMs:20});
  try{
    server.handle(request('connect',{sessionId:'first',sdpAnswer:'v=0'}));await tick();server.handle(request('connect',{sessionId:'second',sdpAnswer:'v=0'}));await tick();
    assert.equal(opens,1);assert.equal(messages.filter(message=>message.nativeLiveHost.error==='live_media_backpressure').length,1);
    await new Promise(done=>setTimeout(done,30));assert.equal(messages.filter(message=>message.nativeLiveHost.error==='live_media_timeout').length,1);
    connected.resolve({send:async()=>{},close:async()=>{closes++;}});await tick();assert.equal(closes,1);
    assert.equal(messages.filter(message=>message.nativeLiveHost.result===null).length,0);
  }finally{connected.resolve({send:async()=>{},close:async()=>{closes++;}});server.close();f.close();}
});

test('native media event flood has a bounded queue and loss closes the projection without delivering unowned session events',async()=>{
  const messages:NativeLiveHostMessage[]=[],client=createNativeLiveHostClient(message=>messages.push(message));let delivered=0,lost=0;
  try{
    const connecting=client.services.connect({sessionId:'bounded-session',sdpAnswer:'v=0',onEvent:async()=>{delivered++;},onConnectionLost:()=>{lost++;}});
    const h=messages[0].nativeLiveHost;client.handle({nativeLiveHost:{version:1,kind:'response',id:h.id,operation:'connect',result:null}});await connecting;
    for(let index=0;index<100;index++)client.handle(event('provider-event',{sessionId:'bounded-session',event:{type:'synthetic',index}}));
    await tick();assert.equal(lost,1);assert.equal(delivered,32);
    client.handle(event('connection-lost',{sessionId:'bounded-session'}));assert.equal(lost,1);
  }finally{client.close();}
});
