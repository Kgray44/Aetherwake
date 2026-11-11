import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID, createHash } from 'node:crypto';
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
import {VELA_TOOL_SCHEMAS,VELA_TOOL_INVOKE} from '../src/vela-semantic-tools.mts';
import { LIVE_ENDPOINT, PROMPT_VOICE_ENDPOINT } from '../../openai-provider/live.mts';
import {projectVelaManifestation} from '../../vela-core/src/manifestation-state.ts';
import type {VelaPlan} from '../../vela-core/src/contracts.ts';
import type {MissionPlan,MissionProjection} from '../src/mission-contracts.mts';

const credential = 'SYNTHETIC_ONLY_VELA_VOICE_CREDENTIAL';

test('live voice revalidates the exact messages sent in its bounded canonical context', async () => {
  const f = fixture();
  try {
    const owner = f.core as any;
    const { conversationId, trimmed, included, excluded } = owner.atomic(() => {
      const conversationId = owner.ensureVelaConversation();
      const graphId = owner.gid(conversationId);
      return {
        conversationId,
        trimmed: owner.graph.addMessage(graphId, 'user', 'x'.repeat(8192)),
        included: owner.graph.addMessage(graphId, 'assistant', 'Synthetic approved history'),
        excluded: owner.graph.addMessage(graphId, 'system', 'Synthetic excluded history'),
      };
    });
    const context = await owner.voiceContext(conversationId);
    assert.deepEqual(context.history, [{ role: 'assistant', content: included.content }]);
    owner.atomic(() => {
      owner.graph.markUnavailable(trimmed.id);
      owner.graph.markUnavailable(excluded.id);
    });
    owner.validateVoiceContext(context.contextRef, context.contextDigest);
    owner.atomic(() => owner.graph.markUnavailable(included.id));
    assert.throws(() => owner.validateVoiceContext(context.contextRef, context.contextDigest), /live_context_changed/);
  } finally {
    await f.close();
  }
});
const offer = 'v=0\r\no=SYNTHETIC_PRIVATE_VOICE_OFFER\r\n';
const answer = 'v=0\r\no=SYNTHETIC_PRIVATE_VOICE_ANSWER\r\n';
const idleMedia = (): GptLiveMediaState => ({ contract:'aerynth.gpt-live-media@1',connection:'idle',microphoneAccess:'not-requested',localTrackEnabled:false,
  localSourceMuted:null,providerInputMute:'unknown',playback:'idle',playbackObserved:false,humanAudibility:'unverified',inputDevice:'default',outputDevice:'default',
  localSpeech:'unavailable',remoteSignal:'unavailable',interruption:'none' });
const savedCatalog=(names=['Vela 3','Vela 2'],prompt=true)=>Response.json({object:'list',has_more:false,data:names.map(name=>({object:'audio.voice',id:name==='Vela 3'?'voice-vela-3':'voice-vela-2',name,type:'prompt',created_at:1000,...(prompt?{prompt:'Synthetic adult '+name}:{})}))});
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
  let peer:Parameters<LiveMediaAdapter['connect']>[0]|undefined,sequence=0,prepared=0,disposed=0;let closeAcknowledged=true;let prepareHook:(input:Parameters<NativeLiveMediaServices['prepare']>[0])=>Promise<void>=async()=>{};const prepareInputs:Parameters<NativeLiveMediaServices['prepare']>[0][]=[];
  let catalogCalls=0,catalogReply:()=>Response|Promise<Response>=()=>Response.json({object:'list',has_more:false,data:[{object:'audio.voice',id:'voice-vela-3',type:'prompt',name:'Vela 3',prompt:'Synthetic adult voice three.',created_at:1000},{object:'audio.voice',id:'voice-vela-2',type:'prompt',name:'Vela 2',prompt:'Synthetic adult voice two.',created_at:1000}]});
  let expectedCredential=credential;
  const mediaState=idleMedia();
  const media:NativeLiveMediaServices={
    prepare:async input=>{prepareInputs.push(input);prepared++;await prepareHook(input);return {offerId:'synthetic-offer',sdpOffer:offer};},
    connect:async input=>{peer=input;mediaState.connection='connected';return {
      send:async command=>{commands.push(command);
        const type=command.type==='session.close'?'session.closed':command.type==='session.input_audio.mute'?'session.input_audio.muted':command.type==='session.input_audio.unmute'?'session.input_audio.unmuted':command.type==='session.commentary.append'?'session.commentary.appended':'session.thinking.appended';
        if(command.type==='session.close'&&!closeAcknowledged)return;await input.onEvent(command.type==='session.close'?{type,event_id:'close-'+command.event_id,session:{id:input.sessionId},usage:{seconds:2}}:{type,event_id:'ack-'+command.event_id,client_event_id:command.event_id});},
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
    assert.equal(new Headers(init?.headers).get('authorization'),'Bearer '+expectedCredential);
    if(String(url)===PROMPT_VOICE_ENDPOINT&&init?.method==='GET'){catalogCalls++;return catalogReply();}
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
  return {get core(){return core;},get peer(){return peer!;},get prepared(){return prepared;},get disposed(){return disposed;},get catalogCalls(){return catalogCalls;},setCatalogReply(next:typeof catalogReply){catalogReply=next;},setExpectedCredential(next:string){expectedCredential=next;},setPrepareHook(value:typeof prepareHook){prepareHook=value;},setCloseAcknowledged(value:boolean){closeAcknowledged=value;},requests,commands,events,replies,prepareInputs,mediaState,voice,vela,grant,emit,
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

function expireCatalog(f:ReturnType<typeof fixture>){const row=f.db().prepare('SELECT json FROM vela_voice_catalog WHERE id=1').get()!;const value=JSON.parse(String(row.json));value.expiresAt=0;f.db().prepare('UPDATE vela_voice_catalog SET json=? WHERE id=1').run(JSON.stringify(value));}
const replyDigest=(content:string)=>createHash('sha256').update(content).digest('hex');
async function speechReply(f:ReturnType<typeof fixture>,content='A synthetic completed primary reply.'){
  f.replies.push(()=>response(content,'speech-'+randomUUID()));await f.send('Explain this synthetic example without using tools.');
  const message=(await f.vela()).conversation!.messages.filter(message=>message.role==='assistant').at(-1)!;return {messageId:message.id,contentDigest:replyDigest(message.content),content:message.content};
}
async function enableReplies(f:ReturnType<typeof fixture>,enabled=true){const state=await f.voice();return f.core.command('velaVoiceNative',{name:'setSpeakReplies',input:{enabled,expectedSettingsVersion:state.settings.version}});}
async function speakReply(f:ReturnType<typeof fixture>,reply:{messageId:string;contentDigest:string}){const grant=await f.grant('speak',randomUUID(),{messageId:reply.messageId,contentDigest:reply.contentDigest});return f.core.command('velaVoiceNative',{name:'speak',input:{messageId:reply.messageId,contentDigest:reply.contentDigest,attemptId:grant.attemptId,authorizationRef:grant.authorizationRef}}) as Promise<VelaVoiceState>;}
async function flushSpeech(f:ReturnType<typeof fixture>){for(let i=0;i<20;i++){await new Promise(resolve=>setImmediate(resolve));if((await f.voice()).speech?.attemptId)return;}}
async function nativeWorkspaceReply(f:ReturnType<typeof fixture>,title='Synthetic spoken workspace'){
 const plan=await f.core.command('vela',{name:'native',input:{intent:'Create '+title,action:{type:'createWorkspace',title,projectId:null}}}) as VelaPlan;if(plan.state==='prepared')await f.core.command('vela',{name:'review',input:{planId:plan.id,fingerprint:plan.fingerprint,decision:'approve'}});else assert.equal(plan.state,'approved','existing host policy owns bounded native approval');await f.core.command('vela',{name:'apply',input:plan.id});const state=await f.vela(),message=state.conversation!.messages.findLast(message=>message.planId===plan.id)!;return {messageId:message.id,contentDigest:replyDigest(message.content),content:message.content,plan,workspaceId:state.receipts.find(receipt=>receipt.planId===plan.id)!.createdWorkspaceId!};
}
async function partialMissionReply(f:ReturnType<typeof fixture>){
 const desktop=await f.core.command('desktop',{type:'createWorkspace',title:'Synthetic spoken evidence',projectId:null}),owner=f.core as any,scope={workspaceId:desktop.activeWorkspaceId!,projectId:null};owner.missionExecutors['synthetic.voice-report']={lane:'native',replaySafe:true,available:()=>true,run:async()=>({source:'aerynth.synthetic-voice-fixture',value:{reportRegistered:true}}),verify:()=>({passed:true,detail:'Synthetic report receipt only; no domain claim'})};const plan:MissionPlan={objective:'Collect a synthetic report while preserving the incomplete investigation.',scope,criteria:['report-recorded'],tasks:[{id:'report',objective:'Register one synthetic report',executor:'synthetic.voice-report',dependencies:[],claims:[],criterion:'report-recorded',timeoutMs:1000,maxAttempts:1}],coverage:{status:'partial',limitations:['Independent measurements are still required.']},originConversationId:owner.vela.ensureMissionConversation()},started=owner.missions.create(randomUUID(),plan);let mission:MissionProjection=owner.missions.read(started.id,scope);for(let i=0;i<400&&['queued','running'].includes(mission.outcome);i++){await new Promise(done=>setTimeout(done,5));mission=owner.missions.read(started.id,scope);}assert.equal(mission.outcome,'blocked');await f.core.command('missions',{name:'post-report',input:{id:mission.id}});const state=await f.vela(),message=state.conversation!.messages.find(message=>message.missionReport?.missionId===mission.id)!;assert(message);return {messageId:message.id,contentDigest:replyDigest(message.content),content:message.content,mission};
}

test('current completed native success is speakable only with actual host receipts and current result scope',async()=>{
 const f=fixture();try{await f.ready();const reply=await nativeWorkspaceReply(f),before=(await f.vela()).conversation!.messages,owner=f.core as any,receipt=(await f.vela()).receipts.find(receipt=>receipt.planId===reply.plan.id)!,record=owner.state.receipts[receipt.commandId];assert(record);delete owner.state.receipts[receipt.commandId];await assert.rejects(speakReply(f,reply),/live_reply_unavailable/);owner.state.receipts[receipt.commandId]=record;
  const resolve=owner.velaHost.resolve.bind(owner.velaHost);owner.velaHost.resolve=(ref:any,...args:any[])=>ref.kind==='workspace'&&ref.id===reply.workspaceId?null:resolve(ref,...args);await assert.rejects(speakReply(f,reply),/live_reply_unavailable/);owner.velaHost.resolve=resolve;await assert.rejects(speakReply(f,{...reply,contentDigest:'f'.repeat(64)}),/live_reply_changed/);
  let state=await f.vela();await f.core.command('vela',{name:'presentation',input:{expectedVersion:state.presentation!.version,patch:{view:'history'}}});await assert.rejects(speakReply(f,reply),/live_reply_unavailable/);state=await f.vela();await f.core.command('vela',{name:'presentation',input:{expectedVersion:state.presentation!.version,patch:{view:'current'}}});const speech=await speakReply(f,reply);assert.equal(speech.speech?.messageId,reply.messageId);assert.equal(f.requests.filter(request=>request.url.endsWith('/responses')).length,0);assert.equal(f.requests.filter(request=>request.url===LIVE_ENDPOINT).length,1);assert.deepEqual(f.prepareInputs[0],{attemptId:speech.session.attemptId,outputOnly:true});assert.deepEqual((await f.vela()).conversation!.messages,before);await f.core.command('velaVoice',{name:'stopSpeech',input:{attemptId:speech.session.attemptId!}});
 }finally{await f.close();}
});

test('partial mission speech requires its canonical report link and scope and preserves the full incomplete result',async()=>{
 const f=fixture();try{await f.ready();const reply=await partialMissionReply(f),before=(await f.vela()).conversation!.messages,owner=f.core as any;assert.match(reply.content,/investigation remains incomplete/);f.db().prepare('DELETE FROM vela_mission_report_links WHERE mission_id=?').run(reply.mission.id);await assert.rejects(speakReply(f,reply),/live_reply_unavailable/);f.db().prepare('INSERT INTO vela_mission_report_links VALUES(?,?)').run(reply.mission.id,reply.messageId);
  const allowed=owner.libraryAuthorized.bind(owner);owner.libraryAuthorized=(subject:any)=>subject.kind==='workspace'&&subject.id===reply.mission.scope.workspaceId?false:allowed(subject);await assert.rejects(speakReply(f,reply),/live_reply_unavailable/);owner.libraryAuthorized=allowed;const metadata=owner.state.vela.messages[reply.messageId].missionReport,jobs=metadata.jobsDone;metadata.jobsDone=99;await assert.rejects(speakReply(f,reply),/live_reply_unavailable/);metadata.jobsDone=jobs;assert.equal(f.prepared,0);
  const speech=await speakReply(f,reply),body=f.requests.find(request=>request.url===LIVE_ENDPOINT)!.body;assert(body.session.input[0].content[0].text.endsWith(reply.content));assert.match(body.session.input[0].content[0].text,/investigation remains incomplete/);assert.equal(f.requests.filter(request=>request.url.endsWith('/responses')).length,0);assert.deepEqual((await f.vela()).conversation!.messages,before);await f.core.command('velaVoice',{name:'stopSpeech',input:{attemptId:speech.session.attemptId!}});
 }finally{await f.close();}
});

test('standing consent reads one fresh native success with lazy default Vela 3 and never speaks old history after opt-in or restart',async()=>{
 const f=fixture();try{await f.ready();await nativeWorkspaceReply(f,'Before speech opt-in');await enableReplies(f);for(let i=0;i<4;i++)await new Promise(done=>setImmediate(done));assert.equal(f.requests.filter(request=>request.url===LIVE_ENDPOINT).length,0);const reply=await nativeWorkspaceReply(f,'Fresh automatic speech'),before=(await f.vela()).conversation!.messages;await flushSpeech(f);const state=await f.voice();assert.equal(state.speech?.messageId,reply.messageId);assert.equal(f.catalogCalls,1,'first lazy catalog adoption must not invalidate an otherwise fresh observation');assert.equal(f.requests.find(request=>request.url===LIVE_ENDPOINT)!.body.session.audio.output.voice.id,'voice-vela-3');assert.equal(f.db().prepare('SELECT count(*) n FROM vela_voice_speech').get()!.n,1);await f.runtime().observeReply(reply.messageId);assert.equal(f.requests.filter(request=>request.url===LIVE_ENDPOINT).length,1);await f.core.command('velaVoice',{name:'stopSpeech',input:{attemptId:state.speech!.attemptId!}});assert.deepEqual((await f.vela()).conversation!.messages,before);await f.reopen();for(let i=0;i<4;i++)await new Promise(done=>setImmediate(done));assert.equal(f.requests.filter(request=>request.url===LIVE_ENDPOINT).length,1);assert.equal(f.requests.filter(request=>request.url.endsWith('/responses')).length,0);
 }finally{await f.close();}
});
test('a newly committed partial mission report is observed once without creating a duplicate conversation turn or replay on reopen',async()=>{
 const f=fixture();try{await f.ready();await enableReplies(f);const reply=await partialMissionReply(f),before=(await f.vela()).conversation!.messages;await flushSpeech(f);const state=await f.voice();assert.equal(state.speech?.messageId,reply.messageId);assert.match(f.requests.find(request=>request.url===LIVE_ENDPOINT)!.body.session.input[0].content[0].text,/investigation remains incomplete/);assert.equal(f.requests.filter(request=>request.url.endsWith('/responses')).length,0);assert.equal(f.db().prepare('SELECT count(*) n FROM vela_voice_speech').get()!.n,1);await f.runtime().observeReply(reply.messageId);assert.equal(f.requests.filter(request=>request.url===LIVE_ENDPOINT).length,1);await f.core.command('velaVoice',{name:'stopSpeech',input:{attemptId:state.speech!.attemptId!}});assert.deepEqual((await f.vela()).conversation!.messages,before);await f.reopen();for(let i=0;i<4;i++)await new Promise(done=>setImmediate(done));assert.equal(f.requests.filter(request=>request.url===LIVE_ENDPOINT).length,1);
 }finally{await f.close();}
});

test('persisted unpublished mission reports recover without automatic speech, including delayed startup publication',async()=>{
 for(const deferred of [false,true]){const f=fixture();try{await f.ready();await enableReplies(f);const desktop=await f.core.command('desktop',{type:'createWorkspace',title:'Synthetic recovery report',projectId:null}),owner=f.core as any,scope={workspaceId:desktop.activeWorkspaceId!,projectId:null};owner.missionPublication.flush=()=>({continue:false,retry:false});owner.missionExecutors['synthetic.recovery-report']={lane:'native',replaySafe:true,available:()=>true,run:async()=>({source:'aerynth.synthetic-recovery-fixture',value:{registered:true}}),verify:()=>({passed:true,detail:'Synthetic receipt registered'})};const plan:MissionPlan={objective:'Register an owned synthetic recovery fixture',scope,criteria:['registered'],tasks:[{id:'register',objective:'Register the synthetic receipt',executor:'synthetic.recovery-report',dependencies:[],claims:[],criterion:'registered',timeoutMs:1000,maxAttempts:1}],originConversationId:owner.vela.ensureMissionConversation()},started=owner.missions.create(randomUUID(),plan);let mission:MissionProjection=owner.missions.read(started.id,scope);for(let i=0;i<400&&['queued','running'].includes(mission.outcome);i++){await new Promise(done=>setTimeout(done,5));mission=owner.missions.read(started.id,scope);}assert.equal(mission.outcome,'verified');assert.equal(f.db().prepare('SELECT count(*) n FROM vela_mission_report_outbox WHERE mission_id=?').get(mission.id)!.n,1);assert.equal(f.db().prepare('SELECT count(*) n FROM vela_mission_report_links WHERE mission_id=?').get(mission.id)!.n,0);
  if(deferred)f.db().exec("CREATE TRIGGER synthetic_speech_report_retry BEFORE INSERT ON vela_mission_report_links BEGIN SELECT RAISE(ABORT,'synthetic deferred recovery publication'); END");await f.reopen();if(deferred){assert.equal(f.db().prepare('SELECT count(*) n FROM vela_mission_report_outbox WHERE mission_id=?').get(mission.id)!.n,1);f.db().exec('DROP TRIGGER synthetic_speech_report_retry');(f.core as any).flushMissionPublication();}for(let i=0;i<8;i++)await new Promise(done=>setImmediate(done));const state=await f.vela(),messages=state.conversation!.messages.filter(message=>message.missionReport?.missionId===mission.id);assert.equal(messages.length,1);assert.equal(f.db().prepare('SELECT count(*) n FROM vela_mission_report_outbox WHERE mission_id=?').get(mission.id)!.n,0);assert.equal((await f.voice()).settings.speakReplies,true);assert.equal(f.prepared,0);assert.equal(f.requests.length,0);assert.equal(f.db().prepare('SELECT count(*) n FROM vela_voice_speech').get()!.n,0);
  const message=messages[0];await speakReply(f,{messageId:message.id,contentDigest:replyDigest(message.content)});assert.equal(f.prepared,1,'recovery suppression must not remove current-report manual speech');assert.equal(f.requests.filter(request=>request.url===LIVE_ENDPOINT).length,1);
 }finally{await f.close();}}
});

test('queued fresh observers are one-shot and are invalidated by disable, explicit stop, close or rolled-back append',async()=>{
 for(const fault of ['disable','stop','close','rollback'] as const){const f=fixture();try{await f.ready();const old=await nativeWorkspaceReply(f);await enableReplies(f);const runtime=f.runtime(),capture=runtime.captureReplyObserver.bind(runtime),queued:{id:string;observe:(id:string)=>Promise<void>}[]=[];runtime.captureReplyObserver=()=>{const observe=capture();return observe?async(id:string)=>{queued.push({id,observe});}:undefined;};
  if(fault==='rollback'){const owner=f.core as any,state=await f.vela(),message=state.conversation!.messages.find(message=>message.id===old.messageId)!;assert.throws(()=>owner.atomic(()=>{const {id:_id,...body}=message;owner.appendVelaMessage(state.conversation!.resourceId,body);throw Error('Synthetic rolled-back primary append');}),/rolled-back primary append/);}else await nativeWorkspaceReply(f,'Queued result '+fault);
  for(let i=0;i<4;i++)await new Promise(done=>setImmediate(done));assert(queued.length>0);if(fault==='disable'){await enableReplies(f,false);await enableReplies(f,true);}else if(fault==='stop')await f.core.command('velaVoice',{name:'stop',input:{}});else if(fault==='close')await f.reopen();for(const pending of queued){await pending.observe(pending.id);await pending.observe(pending.id);}assert.equal(f.requests.filter(request=>request.url===LIVE_ENDPOINT).length,0);assert.equal(f.requests.filter(request=>request.url.endsWith('/responses')).length,0);assert.equal(f.prepared,0);
 }finally{await f.close();}}
});

test('Core close synchronously blocks a queued fresh speech observer while earlier cleanup is held',async()=>{
 const f=fixture();let release!:(()=>void),closing:Promise<unknown>|undefined;try{await f.ready();await enableReplies(f);const owner=f.core as any,runtime=f.runtime(),dispose=owner.toolWorkflows.dispose.bind(owner.toolWorkflows);let entered!:()=>void;const held=new Promise<void>(done=>{release=done;}),ready=new Promise<void>(done=>{entered=done;});owner.toolWorkflows.dispose=async()=>{entered();await held;return dispose();};await nativeWorkspaceReply(f,'Queued before shutdown');assert.equal(f.prepared,0);closing=f.core.command('close',{});await ready;for(let i=0;i<8;i++)await new Promise(done=>setImmediate(done));assert.equal(runtime.captureReplyObserver(),undefined);assert.equal(f.prepared,0);assert.equal(f.requests.filter(request=>request.url===LIVE_ENDPOINT).length,0);assert.equal(f.db().prepare('SELECT count(*) n FROM vela_voice_speech').get()!.n,0);release();await closing;
 }finally{release?.();await closing?.catch(()=>{});await f.close();}
});

test('a final API tool answer remains the current primary after real source effects and can use the same speech controller',async()=>{
 const f=fixture();try{await f.ready();const tool=(name:string,args:unknown)=>{const id=randomUUID();return new Response([{type:'response.created',response:{id,status:'in_progress'}},{type:'response.completed',response:{id,status:'completed',model:'gpt-6-luna',usage:{input_tokens:20,output_tokens:8,total_tokens:28},output:[{type:'function_call',id:'item-'+id,call_id:'call-'+id,name,arguments:JSON.stringify(args),status:'completed'}]}}].map(event=>'data: '+JSON.stringify(event)+'\n\n').join(''),{headers:{'Content-Type':'text/event-stream'}});},catalog=()=>[...(f.core as any).toolWorkflowRuns.values()][0].port.catalog;
  f.replies.push(()=>tool(VELA_TOOL_SCHEMAS,{catalogDigest:catalog().digest,ids:['application.createWorkspace']}),()=>{const c=catalog(),d=c.descriptors.find((item:any)=>item.id==='application.createWorkspace');return tool(VELA_TOOL_INVOKE,{catalogDigest:c.digest,capabilityId:d.id,schemaDigest:d.schemaDigest,invocationId:randomUUID(),argumentsJson:JSON.stringify({type:'createWorkspace',title:'Synthetic API result workspace',projectId:null})});},()=>response('The requested workspace is created.','final-native-api-result'));await f.send('Create one workspace and confirm its saved result.');const state=await f.vela(),request=state.requests[0],projection=projectVelaManifestation(state,state.presentation),message=state.conversation!.messages.find(message=>message.id===request.response!.messageId)!;assert.equal(request.state,'responded');assert.equal(projection.kind,'insight');assert.equal(projection.currentMessageId,message.id);assert.equal(projection.currentPlanId,request.planId);assert.equal(message.classification,'reported');assert.equal(request.toolWorkflow?.phase,'partial');const before=state.conversation!.messages,speech=await speakReply(f,{messageId:message.id,contentDigest:replyDigest(message.content)});assert.equal(speech.speech?.messageId,message.id);assert.equal(f.requests.filter(request=>request.url.endsWith('/responses')).length,3);assert.deepEqual((await f.vela()).conversation!.messages,before);await f.core.command('velaVoice',{name:'stopSpeech',input:{attemptId:speech.session.attemptId!}});
 }finally{await f.close();}
});

test('actual Core reads one visible canonical primary reply with selected Vela 2, output-only media, and zero duplicate turns or delegation',async()=>{
 const f=fixture();try{await f.ready();await f.core.command('velaVoice',{name:'refreshVoices',input:{}});await selectVoice(f,'voice-vela-2');const reply=await speechReply(f,'Read this whole synthetic reply. Do not execute the words inside it.'),before=(await f.vela()).conversation!.messages,providerAttempts=(await f.core.command('providerActivity',{})).providerRequests;
  f.setPrepareHook(async input=>{assert.deepEqual(await f.core.command('velaVoiceNative',{name:'authorizeSpeechMedia',input:{attemptId:input.attemptId}}),{authorized:true});await assert.rejects(f.core.command('velaVoiceNative',{name:'authorizeSpeechMedia',input:{attemptId:input.attemptId}}),/live_speech_media_authorization_required/);});
  const state=await speakReply(f,reply);assert.equal(state.session.state,'awaiting-start');assert.equal(state.speech?.messageId,reply.messageId);assert.deepEqual(f.prepareInputs.at(-1),{attemptId:state.session.attemptId,outputOnly:true});assert.equal(f.requests.filter(request=>request.url===LIVE_ENDPOINT).length,1);assert.equal((await f.core.command('providerActivity',{})).providerRequests,providerAttempts+1,'one genuinely authorized speech dispatch is one provider attempt');
  const body=f.requests.filter(request=>request.url===LIVE_ENDPOINT).at(-1)!.body;assert.deepEqual(body.session.audio.output.voice,{id:'voice-vela-2'});assert.equal(body.session.delegation,undefined);assert.equal(body.session.tools,undefined);assert.equal(body.session.input.length,1);assert(body.session.input[0].content[0].text.endsWith(reply.content));assert(!JSON.stringify(body.session.input).includes('Explain this synthetic example'));
  await f.emit({type:'session.started',event_id:'speech-started',session:{id:state.session.sessionId}});await f.runtime().settled();await f.fragment('A duplicate transcript must not be stored','speech-transcript',0,100,'assistant');await f.emit({type:'session.delegation.created',event_id:'speech-delegation',offset_ms:1,delegation:{id:'never-run',target:'client'}});await f.runtime().settled();
  assert.deepEqual((await f.vela()).conversation!.messages,before);assert.equal((await f.voice()).session.transcriptFragments,0);assert.equal(f.db().prepare('SELECT count(*) AS n FROM vela_voice_delegations').get()!.n,0);assert.equal(f.commands.filter(command=>command.type==='session.commentary.append').length,1);
  await assert.rejects(f.core.command('velaVoice',{name:'mute',input:{muted:false}}),/live_readback_input_disabled/);await f.core.command('velaVoice',{name:'stopSpeech',input:{attemptId:state.session.attemptId!}});assert.equal((await f.voice()).session.finalization,'confirmed');assert.equal((await f.voice()).speech?.endReason,'user-stop');assert.deepEqual((await f.vela()).conversation!.messages,before);
 }finally{await f.close();}
});

test('actual Core speak replies opt-in is CAS persisted, reads only newly completed replies once, and never replays on restart',async()=>{
 const f=fixture();try{await f.ready();assert.equal((await f.voice()).settings.speakReplies,false);const old=await speechReply(f);await enableReplies(f);assert.equal(f.requests.filter(request=>request.url===LIVE_ENDPOINT).length,0);const reply=await speechReply(f,'A newly completed reply.'+randomUUID());await flushSpeech(f);const state=await f.voice();assert.equal(state.speech?.messageId,reply.messageId);assert.equal(f.requests.filter(request=>request.url===LIVE_ENDPOINT).length,1);const grant=f.db().prepare('SELECT maximum_seconds FROM vela_voice_grants WHERE attempt_id=?').get(state.speech!.attemptId!);assert.equal(grant!.maximum_seconds,30);
  await f.runtime().observeReply(reply.messageId);assert.equal(f.requests.filter(request=>request.url===LIVE_ENDPOINT).length,1);await assert.rejects(f.core.command('velaVoiceNative',{name:'setSpeakReplies',input:{enabled:false,expectedSettingsVersion:0}}),/live_voice_settings_changed/);
  f.setCloseAcknowledged(false);f.peer.onConnectionLost();await f.runtime().observeReply(reply.messageId);await f.reopen();assert.equal((await f.voice()).settings.speakReplies,true);assert.equal((await f.voice()).speech?.state,'unknown');await f.runtime().observeReply(reply.messageId);assert.equal(f.requests.filter(request=>request.url===LIVE_ENDPOINT).length,1);await assert.rejects(speakReply(f,old),/live_reply_unavailable|live_reply_changed|live_session_busy/);
 }finally{await f.close();}
});

test('a durable unknown voice session blocks a different fresh automatic reply after restart without clearing uncertainty',async()=>{
 const f=fixture();try{await f.ready();await enableReplies(f);const first=await speechReply(f,'First automatic reply before an unconfirmed transport loss.');await flushSpeech(f);const attempt=(await f.voice()).speech!.attemptId!;f.setCloseAcknowledged(false);f.peer.onConnectionLost();await f.runtime().settled();await f.reopen();assert.equal((await f.voice()).speech?.state,'unknown');const prepared=f.prepared,posts=f.requests.filter(request=>request.url===LIVE_ENDPOINT).length,grants=Number(f.db().prepare("SELECT count(*) n FROM vela_voice_grants WHERE operation='speak'").get()!.n);const fresh=await nativeWorkspaceReply(f,'Different fresh reply after unknown restart');assert.notEqual(fresh.messageId,first.messageId);for(let i=0;i<8;i++)await new Promise(done=>setImmediate(done));await f.runtime().observeReply(fresh.messageId);assert.equal(f.runtime().captureReplyObserver(),undefined);assert.equal(f.prepared,prepared);assert.equal(f.requests.filter(request=>request.url===LIVE_ENDPOINT).length,posts);assert.equal(f.db().prepare("SELECT count(*) n FROM vela_voice_grants WHERE operation='speak'").get()!.n,grants);assert.equal(f.db().prepare('SELECT state FROM vela_voice_speech WHERE attempt_id=?').get(attempt)!.state,'unknown');assert.equal(JSON.parse(String(f.db().prepare('SELECT json FROM vela_voice_sessions WHERE attempt_id=?').get(attempt)!.json)).state,'unknown');
 }finally{await f.close();}
});

test('actual Core readback rejects changed digests, user/history messages and whole replies over capacity before media or paid dispatch',async()=>{
 const f=fixture();try{await f.ready();const old=await speechReply(f),current=await speechReply(f,'Current visible reply.');const user=(await f.vela()).conversation!.messages.find(message=>message.role==='user')!;
  for(const reply of [{messageId:current.messageId,contentDigest:'f'.repeat(64)},old,{messageId:user.id,contentDigest:replyDigest(user.content)}])await assert.rejects(speakReply(f,reply),/live_reply_unavailable|live_reply_changed/);
  const long=await speechReply(f,'x'.repeat(8193));await assert.rejects(speakReply(f,long),/live_reply_capacity/);assert.equal(f.prepared,0);assert.equal(f.requests.filter(request=>request.url===LIVE_ENDPOINT).length,0);await assert.rejects(f.core.command('velaVoice',{name:'speak',input:{messageId:current.messageId,contentDigest:current.contentDigest}} as any),/live_invalid_control/);
 }finally{await f.close();}
});

test('scoped speech stop cannot stop a newer manual conversation, and busy readback preserves its physical input',async()=>{
 const f=fixture();try{await f.ready();const reply=await speechReply(f),speech=await speakReply(f,reply);await f.emit({type:'session.started',event_id:'speech-before-manual',session:{id:speech.session.sessionId}});await f.runtime().settled();await f.core.command('velaVoice',{name:'stopSpeech',input:{attemptId:speech.session.attemptId!}});const manual=await f.start(),disposed=f.disposed,posts=f.requests.filter(request=>request.url===LIVE_ENDPOINT).length;
  await f.core.command('velaVoice',{name:'stopSpeech',input:{attemptId:speech.session.attemptId!}});assert.equal((await f.voice()).session.sessionId,manual.session.sessionId);assert.equal(f.disposed,disposed);await assert.rejects(speakReply(f,reply),/live_session_busy/);assert.equal((await f.voice()).session.state,'running');assert.equal(f.requests.filter(request=>request.url===LIVE_ENDPOINT).length,posts);assert.equal(f.prepareInputs.at(-1)!.outputOnly,undefined);
 }finally{await f.close();}
});
test('speech cost control closes only after observed remote audio then silence, never after the append acknowledgment alone',async t=>{
 const f=fixture();try{await f.ready();const reply=await speechReply(f);t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.now()});const speech=await speakReply(f,reply);await f.emit({type:'session.started',event_id:'idle-speech-started',session:{id:speech.session.sessionId}});await f.runtime().settled();
  f.mediaState.remoteSignal='silent';f.mediaState.playbackObserved=true;t.mock.timers.tick(3000);await new Promise(resolve=>setImmediate(resolve));assert.equal((await f.voice()).session.state,'running');
  f.mediaState.remoteSignal='detected';t.mock.timers.tick(250);await new Promise(resolve=>setImmediate(resolve));f.mediaState.remoteSignal='silent';t.mock.timers.tick(250);await new Promise(resolve=>setImmediate(resolve));t.mock.timers.tick(2500);for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve));
  const state=await f.voice();assert.equal(state.speech?.endReason,'audio-idle');assert.equal(state.session.state,'closed');assert.equal(state.session.audioPlayback,'unverified');assert.equal(state.session.finalization,'confirmed');assert.equal(f.disposed>0,true);
 }finally{t.mock.timers.reset();await f.close();}
});
test('disabling automatic readback under storage denial quiesces the owned attempt without claiming the preference persisted',async()=>{
 const f=fixture();try{await f.ready();await enableReplies(f);await speechReply(f);await flushSpeech(f);const before=await f.voice();assert(before.speech?.attemptId);(f.core as any).missionStorageAdmitted=false;
  await assert.rejects(f.runtime().native({name:'setSpeakReplies',input:{enabled:false,expectedSettingsVersion:before.settings.version}}),/storage_reserve_admission_denied/);await (f.runtime() as any).speechStopFlight;
  assert.equal((await f.voice()).settings.speakReplies,true);assert.equal((await f.voice()).session.state,'closed');assert.equal(f.disposed>0,true);const posts=f.requests.filter(request=>request.url===LIVE_ENDPOINT).length;await f.runtime().observeReply(before.speech!.messageId!);assert.equal(f.requests.filter(request=>request.url===LIVE_ENDPOINT).length,posts);
 }finally{(f.core as any).missionStorageAdmitted=true;await f.close();}
});
test('readback rechecks API usage and key rotation after media preparation before any provider dispatch',async()=>{
 for(const rotate of [false,true]){const f=fixture();try{await f.ready();const reply=await speechReply(f);f.setPrepareHook(async()=>{if(rotate){const next='SYNTHETIC_ROTATED_READBACK_CREDENTIAL';await f.core.command('velaApiConfigure',{credential:{configurationId:'vela-primary',apiKey:next},expectedVersion:1});f.setExpectedCredential(next);}else await f.core.command('velaApiUsageAuthorize',{expectedVersion:1,enabled:false});});await assert.rejects(speakReply(f,reply),/live_api_usage_authorization_required/);assert.equal(f.prepared,1);assert(f.disposed>0);assert.equal(f.requests.filter(request=>request.url===LIVE_ENDPOINT).length,0);assert.equal((await f.voice()).speech?.state,'failed');await assert.rejects(f.core.command('velaVoiceNative',{name:'authorizeSpeechMedia',input:{attemptId:'not-pending'}}),/live_speech_media_authorization_required/);
 }finally{await f.close();}}
});
test('failed speech preparation or post-prepare validation always disposes media when failure journaling also throws',async()=>{
 for(const fault of ['prepare','validation'] as const){const f=fixture();let atomic:unknown;try{await f.ready();const reply=await speechReply(f),runtime=f.runtime() as any;atomic=runtime.options.atomic;f.setPrepareHook(async()=>{if(fault==='validation')await f.core.command('velaApiUsageAuthorize',{expectedVersion:1,enabled:false});runtime.options.atomic=()=>{throw Error('SYNTHETIC_SPEECH_FAILURE_JOURNAL');};if(fault==='prepare')throw Error('SYNTHETIC_SPEECH_PREPARE_FAILURE');});await assert.rejects(speakReply(f,reply),fault==='prepare'?/SYNTHETIC_SPEECH_PREPARE_FAILURE/:/live_api_usage_authorization_required/);assert.equal(f.prepared,1);assert.equal(f.disposed,1);assert.equal(f.mediaState.connection,'disposed');assert.equal(f.requests.filter(request=>request.url===LIVE_ENDPOINT).length,0);assert.equal(runtime.controlBusy,false);assert.equal(runtime.pendingStart,null);assert.equal(f.db().prepare('SELECT state FROM vela_voice_speech').get()!.state,'claimed','failed journal must not fabricate a durable failure or confirmed closure');assert.equal(f.db().prepare('SELECT count(*) n FROM vela_voice_sessions').get()!.n,0);
 }finally{if(atomic)(f.runtime() as any).options.atomic=atomic;await f.close();}}
});

test('speech stop releases playback and native media even when every speech lifecycle journal write fails',async()=>{
 const f=fixture();let atomic:unknown;try{await f.ready();const reply=await speechReply(f),speech=await speakReply(f,reply);await f.emit({type:'session.started',event_id:'journal-speech-started',session:{id:speech.session.sessionId}});await f.runtime().settled();const runtime=f.runtime() as any;atomic=runtime.options.atomic;runtime.options.atomic=()=>{throw Error('SYNTHETIC_SPEECH_JOURNAL_FAILURE');};await f.core.command('velaVoice',{name:'stopSpeech',input:{attemptId:speech.session.attemptId!}});assert.equal(f.mediaState.playback,'interrupted');assert(f.disposed>0);const state=await f.voice();assert.equal(state.session.state,'closed');assert.equal(state.session.finalization,'confirmed');assert.equal(state.session.errorCode,'live_state_journal_unavailable');assert.equal(state.speech?.state,'closed');assert.equal(state.speech?.errorCode,'live_state_journal_unavailable');assert.equal(f.db().prepare('SELECT state FROM vela_voice_speech WHERE attempt_id=?').get(speech.session.attemptId!)!.state,'running');
 }finally{if(atomic)(f.runtime() as any).options.atomic=atomic;await f.close();}
});
async function selectVoice(f:ReturnType<typeof fixture>,voiceId:string){const current=await f.voice(),grant=await f.grant('voice-save');return await f.core.command('velaVoiceNative',{name:'voice-save',input:{attemptId:grant.attemptId,authorizationRef:grant.authorizationRef,voiceId,expectedSettingsVersion:current.settings.version,speechPersonality:current.settings.speechPersonality}}) as VelaVoiceState;}

test('existing requested voices default to Vela 3 once, persist explicit Vela 2 across restart, and never fetch during state polling',async()=>{
 const f=fixture();try{await f.ready();await Promise.all(Array.from({length:8},()=>f.voice()));assert.equal(f.catalogCalls,0);const refreshed=await f.core.command('velaVoice',{name:'refreshVoices',input:{}}) as VelaVoiceState;assert.equal(refreshed.settings.selectedVoice?.name,'Vela 3');assert.equal(refreshed.settings.selectedVoice?.id,'voice-vela-3');assert.equal(f.catalogCalls,1);assert.equal(f.prepared,0);assert.equal(f.requests.length,0);await selectVoice(f,'voice-vela-2');await f.reopen();assert.equal((await f.voice()).settings.selectedVoice?.id,'voice-vela-2');await f.core.command('velaVoice',{name:'refreshVoices',input:{}});assert.equal((await f.voice()).settings.selectedVoice?.name,'Vela 2');assert.equal(f.catalogCalls,1);assert.equal(f.requests.length,0);assert(!JSON.stringify(f.events).includes('Synthetic adult voice'));}finally{await f.close();}
});

test('an in-flight default catalog refresh cannot overwrite a later explicit Vela 2 CAS selection',async()=>{
 const f=fixture();try{await f.ready();f.db().prepare('INSERT INTO vela_voice_candidates VALUES(?,?)').run('voice-vela-2',JSON.stringify({configurationId:'vela-primary',configurationVersion:1,id:'voice-vela-2',name:'Vela 2',prompt:'Synthetic adult voice two.',createdAt:1000,type:'prompt'}));let release!:(value:Response)=>void,entered!:()=>void;const ready=new Promise<void>(resolve=>{entered=resolve;});f.setCatalogReply(()=>{entered();return new Promise(resolve=>{release=resolve;});});const pending=f.core.command('velaVoice',{name:'refreshVoices',input:{}});await ready;await selectVoice(f,'voice-vela-2');release(savedCatalog());await pending;assert.equal((await f.voice()).settings.selectedVoice?.name,'Vela 2');await f.reopen();assert.equal((await f.voice()).settings.selectedVoice?.id,'voice-vela-2');assert.equal(f.requests.length,0);}finally{await f.close();}
});

test('changing a saved voice during an active session is durable for the next session with no reconnect or extra voice request',async()=>{
 const f=fixture();try{await f.ready();const active=await f.start(),first=f.requests.find(request=>request.url===LIVE_ENDPOINT)!;assert.deepEqual(first.body.session.audio.output.voice,{id:'voice-vela-3'});const posts=f.requests.length,commands=f.commands.length;await selectVoice(f,'voice-vela-2');const current=await f.voice();assert.equal(current.session.sessionId,active.session.sessionId);assert.equal(current.session.state,'running');assert.equal(current.settings.selectedVoice?.name,'Vela 2');assert.equal(f.requests.length,posts);assert.equal(f.commands.length,commands);assert.deepEqual(first.body.session.audio.output.voice,{id:'voice-vela-3'});await f.core.command('velaVoice',{name:'stop',input:{}});await f.start();assert.deepEqual(f.requests.filter(request=>request.url===LIVE_ENDPOINT).at(-1)!.body.session.audio.output.voice,{id:'voice-vela-2'});}finally{await f.close();}
});

test('revoked or unavailable Vela 3 retains its preference and fails before microphone preparation without a built-in fallback',async()=>{
 for(const failure of ['revoked','catalog'] as const){const f=fixture();try{await f.ready();await f.core.command('velaVoice',{name:'refreshVoices',input:{}});expireCatalog(f);f.setCatalogReply(()=>failure==='revoked'?savedCatalog(['Vela 2']):Response.json({error:{message:'SYNTHETIC_PRIVATE_REMOTE_ERROR'}},{status:503}));await f.core.command('velaVoice',{name:'refreshVoices',input:{}});assert.equal((await f.voice()).settings.selectedVoice?.name,'Vela 3');await assert.rejects(f.start(),/live_voice_unavailable/);assert.equal(f.prepared,0);assert.equal(f.requests.length,0);assert(!JSON.stringify(f.events).includes('SYNTHETIC_PRIVATE_REMOTE_ERROR'));}finally{await f.close();}}
});

test('storage loss during catalog refresh preserves the existing choice and cannot claim a new default or cache',async()=>{
 const f=fixture();try{await f.ready();let release!:(value:Response)=>void,entered!:()=>void;const ready=new Promise<void>(resolve=>{entered=resolve;});f.setCatalogReply(()=>{entered();return new Promise(resolve=>{release=resolve;});});const pending=f.core.command('velaVoice',{name:'refreshVoices',input:{}});await ready;(f.core as any).missionStorageAdmitted=false;release(savedCatalog());await assert.rejects(pending,/storage_reserve_admission_denied/);const state=await f.voice();assert.equal(state.settings.selectedVoice,null);assert.equal(state.settings.version,0);assert.equal(f.db().prepare('SELECT count(*) AS n FROM vela_voice_catalog').get()!.n,0);assert.equal(f.prepared,0);assert.equal(f.requests.length,0);}finally{(f.core as any).missionStorageAdmitted=true;await f.close();}
});

test('catalog entries without prompts remain imported voices and start with their provider ID without invented description',async()=>{
 const f=fixture();try{await f.ready();f.setCatalogReply(()=>savedCatalog(undefined,false));await f.core.command('velaVoice',{name:'refreshVoices',input:{}});const selected=(await f.voice()).settings.selectedVoice;assert.equal(selected?.type,'existing');assert(selected&&!Object.hasOwn(selected,'prompt'));await f.start();const body=f.requests.find(request=>request.url===LIVE_ENDPOINT)!.body;assert.deepEqual(body.session.audio.output.voice,{id:'voice-vela-3'});assert(!body.session.instructions.includes('undefined'));}finally{await f.close();}
});

test('rotated API key and configuration rebind the catalog while retaining an explicit Vela 2 selection',async()=>{
 const f=fixture();try{await f.ready();await f.core.command('velaVoice',{name:'refreshVoices',input:{}});await selectVoice(f,'voice-vela-2');const previous=JSON.parse(String(f.db().prepare('SELECT json FROM vela_voice_catalog').get()!.json));await f.core.command('velaApiConfigure',{credential:{configurationId:'vela-primary',apiKey:credential+'-ROTATED'},expectedVersion:1});f.setExpectedCredential(credential+'-ROTATED');await f.core.command('velaApiUsageAuthorize',{expectedVersion:2,enabled:true});await f.core.command('velaVoice',{name:'refreshVoices',input:{}});const state=await f.voice(),next=JSON.parse(String(f.db().prepare('SELECT json FROM vela_voice_catalog').get()!.json));assert.equal(state.settings.selectedVoice?.name,'Vela 2');assert.equal(state.settings.selectedVoice?.configurationVersion,2);assert.notEqual(next.data.boundaryDigest,previous.data.boundaryDigest);assert.equal(f.catalogCalls,2);assert.equal(f.requests.length,0);}finally{await f.close();}
});

test('storage rejection during refresh preserves both an active Vela 3 session and the saved next-session Vela 2 choice',async()=>{
 const f=fixture();try{await f.ready();const active=await f.start();await selectVoice(f,'voice-vela-2');const version=(await f.voice()).settings.version;expireCatalog(f);const reads=f.catalogCalls,posts=f.requests.length;(f.core as any).missionStorageAdmitted=false;await assert.rejects(f.core.command('velaVoice',{name:'refreshVoices',input:{}}),/storage_reserve_admission_denied/);const state=await f.voice();assert.equal(state.settings.selectedVoice?.name,'Vela 2');assert.equal(state.settings.version,version);assert.equal(state.session.sessionId,active.session.sessionId);assert.equal(state.session.state,'running');assert.equal(f.catalogCalls,reads);assert.equal(f.requests.length,posts);}finally{(f.core as any).missionStorageAdmitted=true;await f.close();}
});

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

test('actual Core voice timer delegation uses semantic source schemas and one canonical paused timer receipt',async()=>{
  const f=fixture();try{
    await f.ready();const desktop=await f.core.command('desktop',{type:'createWorkspace',title:'Synthetic voice timer workspace',projectId:null});await f.start();await f.fragment('Create a paused bread timer for fifteen minutes','timer-intent');
    const tool=(name:string,args:unknown)=>{const id=randomUUID();return new Response([{type:'response.created',response:{id,status:'in_progress'}},{type:'response.completed',response:{id,status:'completed',model:'gpt-6-luna',usage:{input_tokens:20,output_tokens:8,total_tokens:28},output:[{type:'function_call',id:'item-'+id,call_id:'call-'+id,name,arguments:JSON.stringify(args),status:'completed'}]}}].map(event=>'data: '+JSON.stringify(event)+'\n\n').join(''),{headers:{'Content-Type':'text/event-stream'}});};
    const catalog=()=>[...(f.core as any).toolWorkflowRuns.values()][0].port.catalog;
    f.replies.push(()=>tool(VELA_TOOL_SCHEMAS,{catalogDigest:catalog().digest,ids:['application.clockTimer']}),()=>{const c=catalog(),d=c.descriptors.find((item:any)=>item.id==='application.clockTimer');return tool(VELA_TOOL_INVOKE,{catalogDigest:c.digest,capabilityId:d.id,schemaDigest:d.schemaDigest,invocationId:'voice-timer-once',argumentsJson:JSON.stringify({type:'clockTimer',workspaceId:desktop.activeWorkspaceId,request:{name:'create',input:{title:'Bread timer',projectId:null,operations:[{type:'createTimer',key:'bread',name:'Bread',durationMs:900000,start:false}]}},focus:{mode:'timer',timerId:null,timerKey:'bread'},query:null})});},()=>response('Your paused fifteen-minute bread timer is saved.','timer-source-result'));
    await f.delegate('timer-operation');await f.delegate('timer-operation');const state=await f.vela(),request=state.requests[0],user=state.conversation!.messages.find(message=>message.role==='user')!;
    assert.equal(request.state,'responded');assert.equal(request.inputMessageId,user.id);assert.equal(user.voice?.acceptedRequestId,request.id);const receipt=state.receipts.find(receipt=>receipt.requestId===request.id)!;assert.equal(receipt.state,'applied');assert.ok(receipt.clockTimer);assert.equal(Number(f.db().prepare('SELECT count(*) AS n FROM timer_documents').get()!.n),1);assert.equal(f.requests.filter(request=>request.url.endsWith('/responses')).length,3);assert.equal(f.commands.filter(command=>command.type==='session.commentary.append').length,1);assert.equal(state.conversation!.messages.filter(message=>message.role==='user').length,1);
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
    f.setCloseAcknowledged(false);f.peer.onConnectionLost();const authorization=await f.grant('reconnect');
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
