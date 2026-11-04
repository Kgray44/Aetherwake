import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { BackendCore } from '../src/core.mts';
import type { NativeHostServices } from '../src/native-host.mts';
import type { NativeLiveMediaServices, GptLiveMediaState } from '../src/live-media-host.mts';
import type { VelaVoiceState, VoiceAuthorization, VelaVoiceNativeRequest } from '../src/vela-voice-runtime.mts';
import type { LiveClientCommand, LiveMediaAdapter, LiveTranscriptFragment } from '../../openai-provider/live-contracts.mts';
import type { VelaBackendState, StreamEvent } from '../src/contracts.mts';
import { LIVE_ENDPOINT, PROMPT_VOICE_ENDPOINT } from '../../openai-provider/live.mts';

const credential = 'SYNTHETIC_ONLY_VELA_VOICE_CREDENTIAL';
const offer = 'v=0\r\no=SYNTHETIC_PRIVATE_VOICE_OFFER\r\n';
const answer = 'v=0\r\no=SYNTHETIC_PRIVATE_VOICE_ANSWER\r\n';
const idleMedia = (): GptLiveMediaState => ({ contract:'aerynth.gpt-live-media@1',connection:'idle',microphoneAccess:'not-requested',localTrackEnabled:false,
  localSourceMuted:null,providerInputMute:'unknown',playback:'idle',playbackObserved:false,humanAudibility:'unverified',inputDevice:'default',outputDevice:'default',
  localSpeech:'unavailable',remoteSignal:'unavailable',interruption:'none' });
function response(content:string, id='voice-response') {
  const output=[{type:'message',id:'message-'+id,role:'assistant',status:'completed',content:[{type:'output_text',text:content,annotations:[]}]}];
  return new Response([
    {type:'response.created',response:{id,status:'in_progress'}},
    {type:'response.output_text.delta',delta:content},
    {type:'response.completed',response:{id,status:'completed',model:'gpt-6-luna',output,usage:{input_tokens:20,output_tokens:8,total_tokens:28}}},
  ].map(event=>'data: '+JSON.stringify(event)+'\n\n').join(''),{headers:{'Content-Type':'text/event-stream'}});
}
function fixture() {
  const base=resolve(tmpdir()),directory=mkdtempSync(join(base,'aerynth-voice-core-')),path=join(directory,'canonical.sqlite'),key=randomBytes(32);
  const requests:{url:string;body:any}[]=[],commands:LiveClientCommand[]=[],events:StreamEvent[]=[],replies:((body:any)=>Response|Promise<Response>)[]=[];
  let peer:Parameters<LiveMediaAdapter['connect']>[0]|undefined,sequence=0,prepared=0,disposed=0;
  const mediaState=idleMedia();
  const media:NativeLiveMediaServices={
    prepare:async()=>{prepared++;return {offerId:'synthetic-offer',sdpOffer:offer};},
    connect:async input=>{peer=input;mediaState.connection='connected';return {
      send:async command=>{commands.push(command);
        const type=command.type==='session.close'?'session.closed':command.type==='session.input_audio.mute'?'session.input_audio.muted':command.type==='session.input_audio.unmute'?'session.input_audio.unmuted':command.type==='session.commentary.append'?'session.commentary.appended':'session.thinking.appended';
        await input.onEvent(command.type==='session.close'?{type,event_id:'close-'+command.event_id,session:{id:input.sessionId},usage:{seconds:2}}:{type,event_id:'ack-'+command.event_id,client_event_id:command.event_id});},
      close:async()=>{mediaState.connection='closed';},
    };},
    devices:async()=>[{kind:'audioinput',id:'synthetic-microphone',label:'Synthetic microphone',labelAvailable:true}],
    state:async()=>structuredClone(mediaState),setInputDevice:async()=>{},setOutputDevice:async()=>{},setLocalMute:async muted=>{mediaState.localTrackEnabled=!muted;},
    resumePlayback:async()=>{mediaState.playback='playing';mediaState.playbackObserved=true;},interruptPlayback:async()=>{mediaState.playback='interrupted';},
    dispose:async()=>{disposed++;mediaState.connection='disposed';},
  };
  const native:NativeHostServices={liveMedia:media,secrets:{available:async()=>true,
    seal:async value=>{const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,cipher.update(value),cipher.final(),cipher.getAuthTag()]);},
    open:async value=>{const bytes=Buffer.from(value),cipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));cipher.setAuthTag(bytes.subarray(-16));return Buffer.concat([cipher.update(bytes.subarray(12,-16)),cipher.final()]).toString();},
  }};
  const fetchFixture=(async(url,init)=>{
    if(String(url)==='https://api.openai.com/v1/models')return Response.json({data:[{id:'gpt-6-luna'}]});
    assert.equal(new Headers(init?.headers).get('authorization'),'Bearer '+credential);
    const body=JSON.parse(String(init?.body));requests.push({url:String(url),body});
    if(String(url)===LIVE_ENDPOINT)return Response.json({session:{id:'synthetic-live-'+ ++sequence},transport:{type:'webrtc',sdp:answer}},{status:201});
    if(String(url)===PROMPT_VOICE_ENDPOINT)return Response.json({object:'audio.voice',id:'voice-synthetic',type:'prompt',name:body.name,prompt:body.prompt,created_at:1000});
    assert.equal(String(url),'https://api.openai.com/v1/responses');const reply=replies.shift();assert.ok(reply,'unexpected synthetic API inference');return reply(body);
  }) as typeof fetch;
  const create=()=>new BackendCore({path,provider:'fixture',contentPolicy:'synthetic-only',syntheticTimerClock:{epochMs:Date.parse('2026-11-04T12:00:00Z'),monotonicMs:1000,sessionId:'synthetic-voice-timers',timeZone:'UTC',locale:'en-US'}},event=>events.push(event),native,undefined,{fetch:fetchFixture,voice:{fetch:fetchFixture,acknowledgementMs:100}});
  let core=create();
  const voice=async()=>await core.command('velaVoice',{name:'state',input:{}}) as VelaVoiceState;
  const vela=async()=>await core.command('vela',{name:'state',input:{}}) as VelaBackendState;
  const grant=async(operation:Extract<VelaVoiceNativeRequest,{name:'authorize'}>['input']['operation'],attemptId:string=randomUUID(),extra={})=>await core.command('velaVoiceNative',{name:'authorize',input:{attemptId,operation,...extra}}) as VoiceAuthorization;
  const emit=async(event:unknown)=>{assert.ok(peer);await peer.onEvent(event);};
  return {get core(){return core;},get peer(){return peer!;},get prepared(){return prepared;},get disposed(){return disposed;},requests,commands,events,replies,voice,vela,grant,emit,
    db:()=> (core as any).db as DatabaseSync,
    runtime:()=> (core as any).velaVoiceRuntime,
    async configure(){await core.command('velaApiConfigure',{credential:{configurationId:'vela-primary',apiKey:credential},expectedVersion:null});},
    async authorize(){await core.command('velaApiUsageAuthorize',{expectedVersion:1,enabled:true});},
    async ready(){await this.configure();await this.authorize();},
    async start(extra:{intent?:string}={}){const authorization=await grant('start',randomUUID(),extra);const state=await core.command('velaVoiceNative',{name:'start',input:{attemptId:authorization.attemptId,authorizationRef:authorization.authorizationRef,...extra}}) as VelaVoiceState;
      assert.equal(state.session.state,'awaiting-start');await emit({type:'session.started',event_id:'started-'+state.session.sessionId,session:{id:state.session.sessionId}});return voice();},
    async fragment(delta:string,eventId:string,startMs=0,endMs=100,role:'user'|'assistant'='user'){await emit({type:role==='user'?'session.input_transcript.delta':'session.output_transcript.delta',event_id:eventId,delta,start_ms:startMs,end_ms:endMs});},
    async delegate(id='synthetic-delegation',offsetMs=100){await emit({type:'session.delegation.created',event_id:'event-'+id,offset_ms:offsetMs,delegation:{id,target:'client',task:'INJECTED_TASK_MUST_NEVER_EXECUTE'}});await (core as any).velaVoiceRuntime.settled();},
    async send(intent:string){const preview=await core.command('velaRequestPreview',{intent,resourceIds:[],adaptive:true}),review=await core.command('velaNativeReview',{previewId:preview.id,signature:preview.signature}),authorization=await core.command('authorizeVelaRequest',{previewId:preview.id,signature:preview.signature,reviewDigest:review.reviewDigest,directSend:true});return core.command('vela',{name:'request',input:{intent,resourceIds:[],authorizeProvider:true,previewId:preview.id,grantId:authorization.grantId}});},
    async reopen(){await core.command('close',{});core=create();},
    async close(){await core.command('close',{}).catch(()=>{});const part=relative(base,resolve(directory));assert.ok(part.startsWith('aerynth-voice-core-')&&!part.startsWith('..')&&!isAbsolute(part));rmSync(directory,{recursive:true,force:true});},
  };
}

test('actual Core voice starts with canonical text history, identity and observed operation context; public commands cannot authorize paid starts',async()=>{
  const f=fixture();try{
    assert.equal((await f.voice()).available,false);
    await assert.rejects(f.grant('start'),/live_media_unavailable/);
    await f.ready();f.replies.push(()=>response('Synthetic gravity answer.','text-before-voice'));await f.send('Explain gravity');
    const before=await f.vela();await f.start({intent:'Continue this conversation by voice'});
    const wire=f.requests.find(request=>request.url===LIVE_ENDPOINT)!.body;
    assert.equal(wire.session.model,'gpt-live-1');assert.deepEqual(wire.session.delegation,{type:'client'});assert.equal(wire.session.store,false);
    assert.ok(wire.session.instructions.includes('Vela is Aerynth'));assert.ok(wire.session.instructions.includes('recorded operations'));
    assert.ok(wire.session.input.some((input:any)=>input.content[0].text==='Synthetic gravity answer.'));
    assert.ok(wire.session.input.some((input:any)=>input.content[0].text==='Continue this conversation by voice'));
    assert.equal((await f.voice()).session.conversationId,before.conversation!.resourceId);
    assert.equal((await f.core.command('snapshot',{})).conversations.length,1);
    await assert.rejects(f.core.command('velaVoice',{name:'start',input:{}} as any),/live_invalid_control/);
    await assert.rejects(f.core.command('velaVoice',{name:'authorize',input:{attemptId:'public',operation:'start'}} as any),/live_invalid_control/);
    const exposed=JSON.stringify({voice:await f.voice(),state:await f.core.command('snapshot',{}),events:f.events});
    for(const secret of [credential,offer,answer])assert.ok(!exposed.includes(secret));
  }finally{await f.close();}
});

test('actual Core durably groups fragments, preserves spaces/timestamps and speaker transitions without inventing completed turns',async()=>{
  const f=fixture();try{
    await f.ready();const started=await f.start(),sessionId=started.session.sessionId!,conversationId=started.session.conversationId!;
    await f.fragment('Pause ','first',0,100);await f.fragment('the timer','second',100,200);await f.fragment('the timer','second',100,200);
    await f.fragment('Okay','backchannel',120,180,'assistant');await f.fragment(' please.','after-backchannel',200,250);
    const state=await f.vela(),messages=state.conversation!.messages;
    assert.deepEqual(messages.map(message=>[message.role,message.content]),[['user','Pause the timer'],['assistant','Okay'],['user',' please.']]);
    assert.deepEqual(messages.map(message=>[message.voice!.startMs,message.voice!.endMs,message.voice!.completedTurn]),[[0,200,false],[120,180,false],[200,250,false]]);
    assert.equal(messages[1].providerId,'gpt-live-1');assert.ok(messages.every(message=>message.classification==='reported'&&message.voice?.transcription==='provider-reported'));
    assert.equal((await f.voice()).captions.length,3);assert.equal((await f.voice()).session.audioPlayback,'unverified');
    const first=messages[0].id,fragment:LiveTranscriptFragment={sessionId,eventId:'first',conversationId,role:'user',delta:'Pause ',startMs:0,endMs:100,completedTurn:false,playback:'unverified'};
    await f.reopen();assert.equal((await f.voice()).session.state,'closed');assert.equal((await f.voice()).session.finalization,'confirmed');await f.start();await f.runtime().receiveFragment(fragment);
    assert.equal((await f.vela()).conversation!.messages.length,3);assert.equal((await f.vela()).conversation!.messages[0].id,first);
    await assert.rejects(f.runtime().receiveFragment({...fragment,delta:'Different'}),/live_transcript_duplicate_mismatch/);
    assert.equal(Number(f.db().prepare('SELECT count(*) AS n FROM vela_voice_fragments').get()!.n),4);
  }finally{await f.close();}
});

test('actual Core voice delegates exact sealed user once through native facts even after a speaker backchannel',async()=>{
  const f=fixture();try{
    await f.ready();await f.start();await f.fragment('What time is it?','native-intent');await f.fragment('Let me check.','native-backchannel',50,90,'assistant');
    const input=(await f.vela()).conversation!.messages[0];await f.delegate('native-time');await f.delegate('native-time');
    const state=await f.vela(),adopted=state.conversation!.messages.find(message=>message.id===input.id)!;
    assert.ok(adopted.requestId);assert.equal(adopted.voice?.acceptedRequestId,adopted.requestId);assert.equal(adopted.voice?.sealed,true);assert.equal(adopted.voice?.completedTurn,false);
    assert.equal(state.conversation!.messages.filter(message=>message.content==='What time is it?').length,1);
    assert.equal(state.requests.length,1);assert.equal(state.requests[0].state,'responded');
    assert.ok(state.conversation!.messages.some(message=>message.requestId===adopted.requestId&&message.source==='vela-native'&&message.classification==='observed'));
    assert.equal(f.requests.filter(request=>request.url.endsWith('/responses')).length,0);
    const spoken=f.commands.filter(command=>command.type==='session.commentary.append');assert.equal(spoken.length,1);assert.ok(!JSON.stringify(state).includes('INJECTED_TASK'));
  }finally{await f.close();}
});

test('actual Core voice timer delegation mutates one canonical timer and binds the adopted utterance to the applied receipt',async()=>{
  const f=fixture();try{
    await f.ready();await f.start();await f.fragment('Set a bread timer for fifteen minutes','timer-intent');await f.delegate('timer-operation');await f.delegate('timer-operation');
    const state=await f.vela(),request=state.requests[0],user=state.conversation!.messages.find(message=>message.role==='user')!;
    assert.equal(request.state,'completed');assert.equal(request.inputMessageId,user.id);assert.equal(user.voice?.acceptedRequestId,request.id);
    const receipt=state.receipts.find(receipt=>receipt.requestId===request.id)!;assert.equal(receipt.state,'applied');assert.ok(receipt.clockTimer);
    assert.equal(Number(f.db().prepare('SELECT count(*) AS n FROM timer_documents').get()!.n),1);
    assert.equal(f.requests.filter(request=>request.url.endsWith('/responses')).length,0);assert.equal(f.commands.filter(command=>command.type==='session.commentary.append').length,1);
  }finally{await f.close();}
});

test('actual Core voice delegates API answers through the same Vela turn with exact canonical adoption and continues in text after restart',async()=>{
  const f=fixture();try{
    await f.ready();await f.start();await f.fragment('Explain ocean currents.','api-intent');const input=(await f.vela()).conversation!.messages[0];
    f.replies.push(body=>{assert.ok(body.instructions.includes('Vela is Aerynth'));assert.ok(body.input[0].content.includes('Canonical voice context'));return response('Winds and density differences drive currents.');});
    await f.delegate('api-answer');await f.delegate('api-answer');
    const state=await f.vela(),request=state.requests[0],user=state.conversation!.messages.find(message=>message.id===input.id)!;
    assert.equal(request.state,'responded');assert.equal(request.inputMessageId,input.id);assert.equal(user.voice?.acceptedRequestId,request.id);
    assert.equal(state.conversation!.messages.filter(message=>message.role==='user').length,1);assert.equal(state.conversation!.messages.filter(message=>message.role==='assistant').length,1);
    assert.equal(f.requests.filter(request=>request.url.endsWith('/responses')).length,1);assert.equal(f.commands.filter(command=>command.type==='session.commentary.append').length,1);
    await f.core.command('velaVoice',{name:'stop',input:{}});await f.reopen();
    f.replies.push(body=>{assert.ok(body.input[0].content.includes('Explain ocean currents.'));assert.ok(body.input[0].content.includes('Winds and density differences'));return response('Yes, temperature affects density.','text-after-voice');});
    const continued:any=await f.send('Does temperature affect that?');assert.equal(continued.state,'responded');assert.equal(continued.conversationId,request.conversationId);
  }finally{await f.close();}
});

test('actual Core unknown API delegation remains durable and cannot be replayed or reconciled into new external effects',async()=>{
  const f=fixture();try{
    await f.ready();await f.start();await f.fragment('Explain an uncertain external result.','unknown-intent');f.replies.push(()=>{throw Error('synthetic disconnected after dispatch');});
    await f.delegate('unknown-work');await f.delegate('unknown-work');
    assert.equal((await f.vela()).requests[0].state,'unknown');assert.equal((await f.voice()).session.backend,'unknown');
    const row=f.db().prepare('SELECT * FROM vela_voice_delegations').get()!;assert.equal(row.state,'unknown');
    assert.equal(f.requests.filter(request=>request.url.endsWith('/responses')).length,1);assert.equal(f.commands.filter(command=>command.type==='session.commentary.append').length,0);
    f.peer.onConnectionLost();const authorization=await f.grant('reconnect');
    await assert.rejects(f.core.command('velaVoiceNative',{name:'reconnect',input:{attemptId:authorization.attemptId,authorizationRef:authorization.authorizationRef}}),/live_reconciliation_required/);
    await f.reopen();assert.equal(f.db().prepare('SELECT state FROM vela_voice_delegations').get()!.state,'unknown');
    assert.equal((await f.vela()).requests.length,1);assert.equal(f.requests.filter(request=>request.url===LIVE_ENDPOINT).length,1);
  }finally{await f.close();}
});

test('actual Core private voice grant binds operation/intent/attempt, is single use and expires before dispatch',async()=>{
  const f=fixture();try{
    await f.ready();const authorization=await f.grant('start','bound-attempt',{intent:'Continue by voice'});
    const input={attemptId:authorization.attemptId,authorizationRef:authorization.authorizationRef,intent:'Continue by voice'};
    await assert.rejects(f.core.command('velaVoiceNative',{name:'start',input:{...input,intent:'Different instruction'}}),/live_paid_start_review_required/);
    await assert.rejects(f.core.command('velaVoiceNative',{name:'audition',input:{...input,sample:'Hello'}}),/live_paid_start_review_required/);
    await assert.rejects(f.core.command('velaVoiceNative',{name:'start',input:{...input,attemptId:'wrong-attempt'}}),/live_paid_start_review_required/);
    assert.equal(f.prepared,0);assert.equal(f.requests.length,0);
    await f.core.command('velaVoiceNative',{name:'start',input});
    await assert.rejects(f.core.command('velaVoiceNative',{name:'start',input}),/live_paid_start_review_required/);
    assert.equal(f.requests.length,1);
    const expired=await f.grant('start');f.db().prepare('UPDATE vela_voice_grants SET expires_at=0 WHERE ref=?').run(expired.authorizationRef);
    await assert.rejects(f.core.command('velaVoiceNative',{name:'start',input:{attemptId:expired.attemptId,authorizationRef:expired.authorizationRef}}),/live_paid_start_review_required/);
    assert.equal(f.requests.length,1);
  }finally{await f.close();}
});

test('actual Core custom voice settings are durable CAS; revoked usage and rotated keys invalidate native grants',async()=>{
  const f=fixture();try{
    await f.ready();const creation=await f.grant('voice-create');const result:any=await f.core.command('velaVoiceNative',{name:'voice-create',input:{attemptId:creation.attemptId,authorizationRef:creation.authorizationRef,name:'Synthetic Vela',prompt:'An adult warm voice.'}});
    assert.equal(result.state,'created');assert.equal(result.audioPreview,false);assert.equal(f.prepared,0);
    const save=async(expectedSettingsVersion:number)=>{const grant=await f.grant('voice-save');return f.core.command('velaVoiceNative',{name:'voice-save',input:{attemptId:grant.attemptId,authorizationRef:grant.authorizationRef,voiceId:'voice-synthetic',expectedSettingsVersion,speechPersonality:'Warm, brief and clear.'}});};
    await save(0);assert.equal((await f.voice()).settings.version,1);await assert.rejects(save(0),/live_voice_settings_changed/);
    await f.reopen();assert.equal((await f.voice()).settings.selectedVoice?.id,'voice-synthetic');assert.equal((await f.voice()).settings.speechPersonality,'Warm, brief and clear.');
    const authorization=await f.grant('start');await f.core.command('velaApiUsageAuthorize',{expectedVersion:1,enabled:false});
    await assert.rejects(f.core.command('velaVoiceNative',{name:'start',input:{attemptId:authorization.attemptId,authorizationRef:authorization.authorizationRef}}),/live_api_usage_authorization_required/);
    await f.authorize();const old=await f.grant('start');await f.core.command('velaApiConfigure',{credential:{configurationId:'vela-primary',apiKey:credential},expectedVersion:1});await f.core.command('velaApiUsageAuthorize',{expectedVersion:2,enabled:true});
    await assert.rejects(f.core.command('velaVoiceNative',{name:'start',input:{attemptId:old.attemptId,authorizationRef:old.authorizationRef}}),/live_api_usage_authorization_required/);
    assert.equal(f.requests.filter(request=>request.url===LIVE_ENDPOINT).length,0);
  }finally{await f.close();}
});

test('actual Core mute, local playback interruption and provider acknowledgments remain separate from canonical work and audibility',async()=>{
  const f=fixture();try{
    await f.ready();await f.start();await f.core.command('velaVoice',{name:'mute',input:{muted:true}});assert.equal((await f.voice()).session.inputMute,'muted');
    await f.core.command('velaVoice',{name:'resumePlayback',input:{}});assert.equal((await f.voice()).media?.playbackObserved,true);assert.equal((await f.voice()).media?.humanAudibility,'unverified');
    await f.core.command('velaVoice',{name:'interruptPlayback',input:{}});assert.equal((await f.voice()).media?.playback,'interrupted');assert.equal((await f.voice()).session.audioPlayback,'unverified');
    await f.core.command('velaVoice',{name:'stop',input:{}});assert.equal((await f.voice()).session.finalization,'confirmed');assert.equal((await f.voice()).session.usage.final,true);
    assert.equal((await f.vela()).requests.length,0);assert.ok(f.disposed>0);
  }finally{await f.close();}
});

test('actual Core active API usage revocation stops voice delegation before a durable claim or canonical request',async()=>{
  const f=fixture();try{
    await f.ready();await f.start();await f.fragment('Set a revoked timer for one minute','revoked-intent');
    await f.core.command('velaApiUsageAuthorize',{expectedVersion:1,enabled:false});await f.delegate('revoked-delegation');
    assert.equal((await f.vela()).requests.length,0);assert.equal(Number(f.db().prepare('SELECT count(*) AS n FROM vela_voice_delegations').get()!.n),0);
    assert.equal((await f.voice()).session.backend,'unknown');assert.equal(f.commands.length,0);
    assert.equal(f.requests.filter(request=>request.url.endsWith('/responses')).length,0);
  }finally{await f.close();}
});

test('actual voice stop still releases native media when its canonical lifecycle journal cannot write',async()=>{
  const f=fixture();let restore:(()=>void)|undefined;
  try{await f.ready();await f.start();const runtime=f.runtime(),options=runtime.options,atomic=options.atomic;restore=()=>{options.atomic=atomic;};
    options.atomic=()=>{throw Error('SYNTHETIC_JOURNAL_DISK_FAILURE');};const before=f.disposed;
    const stopped=await runtime.request({name:'stop',input:{}}) as VelaVoiceState;
    assert.ok(f.disposed>before);assert.equal(stopped.media?.connection,'disposed');assert.equal(stopped.session.state,'closed');assert.equal(stopped.session.finalization,'confirmed');assert.equal(stopped.session.errorCode,'live_state_journal_unavailable');
    const persisted=JSON.parse(String(f.db().prepare('SELECT json FROM vela_voice_sessions').get()!.json));assert.equal(persisted.state,'running','a failed journal must not claim durable closure');
  }finally{restore?.();await f.close();}
});

test('native media disposal is unconditional if controller stop or disposal throws',async()=>{
  for(const operation of ['stop','dispose'] as const){const f=fixture();let restore:(()=>void)|undefined;
    try{await f.ready();await f.start();const runtime=f.runtime(),controller=runtime.controller,prior=controller[operation];restore=async()=>{controller[operation]=prior;await controller.dispose();};
      controller[operation]=async()=>{throw Error('live_state_journal_unavailable');};const before=f.disposed;
      await assert.rejects(operation==='stop'?runtime.request({name:'stop',input:{}}):runtime.dispose(),/live_state_journal_unavailable/);assert.ok(f.disposed>before);
    }finally{await restore?.();await f.close();}
  }
});
