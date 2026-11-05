import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pureCourtesyReply } from '../src/vela-courtesy.mts';
import { BackendCore } from '../src/core.mts';
import type { NativeHostServices } from '../src/native-host.mts';
import type { StreamEvent, VelaBackendState } from '../src/contracts.mts';
import type { VelaRequest } from '../../vela-core/src/contracts.ts';
import type { VelaTurnRouting } from '../../vela-core/src/adaptive-routing.ts';
const { velaCommand } = createRequire(import.meta.url)('../../visual-experience/cinematic-v3/native/vela-broker.cjs');

function fixture() {
  const base=resolve(tmpdir()),dir=mkdtempSync(join(base,'aerynth-courtesy-')),path=join(dir,'canonical.sqlite');
  const key=randomBytes(32),events:StreamEvent[]=[],bodies:unknown[]=[];let codexCalls=0,modelReads=0;
  const native:NativeHostServices={secrets:{available:async()=>true,
    seal:async text=>{const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,c.update(text),c.final(),c.getAuthTag()]);},
    open:async bytes=>{const b=Buffer.from(bytes),c=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));c.setAuthTag(b.subarray(-16));return Buffer.concat([c.update(b.subarray(12,-16)),c.final()]).toString();}}};
  const api={fetch:(async(url,init)=>{
    if(String(url)==='https://api.openai.com/v1/models'){modelReads++;return Response.json({data:[{id:'gpt-6-luna'}]});}
    assert.equal(String(url),'https://api.openai.com/v1/responses');bodies.push(JSON.parse(String(init?.body)));
    throw new TypeError('SYNTHETIC_UNKNOWN_TRANSPORT');
  }) as typeof fetch};
  const create=()=>{const core=new BackendCore({path,provider:'fixture',contentPolicy:'synthetic-only'},event=>events.push(event),native,undefined,api);
    const port=(core as any).port;for(const name of ['connect','capabilities','open','resume','read','items','turn','terminal','interrupt'])port[name]=()=>{codexCalls++;throw Error('Unexpected synthetic Codex call');};return core;};
  let core=create();
  return {get core(){return core;},events,bodies,get codexCalls(){return codexCalls;},get modelReads(){return modelReads;},
    state:async()=>await core.command('vela',{name:'state',input:{}}) as VelaBackendState,
    async send(intent:string){return await velaCommand({directMessageSend:true,offerPlanningByDefault:true,
      input:{name:'request',input:{intent,resourceIds:[],authorizeProvider:true}},call:(name:any,input:any)=>core.command(name,input)}) as VelaRequest;},
    async unknown(){await core.command('velaApiConfigure',{credential:{configurationId:'vela-primary',apiKey:'SYNTHETIC_COURTESY_KEY'},expectedVersion:null});
      await core.command('velaApiUsageAuthorize',{expectedVersion:1,enabled:true});
      const intent='Explain the synthetic inertial reference.',preview=await core.command('velaRequestPreview',{intent,resourceIds:[],adaptive:true});
      const input={previewId:preview.id,signature:preview.signature},review=await core.command('velaNativeReview',input);
      const grant=await core.command('authorizeVelaRequest',{...input,reviewDigest:review.reviewDigest,...(preview.sendDisposition==='routine'?{directSend:true}:{})});
      return await core.command('vela',{name:'request',input:{intent,resourceIds:[],authorizeProvider:true,previewId:preview.id,grantId:grant.grantId}}) as VelaRequest;},
    async reopen(){await core.command('close',{});core=create();},
    async close(){if(!(core as any).closed)await core.command('close',{});const part=relative(base,resolve(dir));assert(part.startsWith('aerynth-courtesy-')&&!part.startsWith('..')&&!isAbsolute(part));rmSync(dir,{recursive:true,force:true});}
  };
}

test('courtesy matching covers whole thanks/greetings and rejects questions, actions and quoted/compound content',()=>{
  for(const intent of ['thanks','Thank you!','awesome, thank you','Awesome, thanks!','Vela, thank you.','thank you, Vela!','thanks a lot','thank you so much'])assert.equal(pureCourtesyReply(intent),'You’re welcome.',intent);
  for(const intent of ['hi','Hello, Vela!','Vela, hey','good morning.'])assert.equal(pureCourtesyReply(intent),'Hello.',intent);
  for(const intent of ['awesome','thank you?','thanks, but check weather','thanks, cancel','thanks, delete the file','hello, list my tasks','thank you for checking the weather','say thanks','"thanks"','thanks; run tests','thanks\nstop the timer','hi there, what time is it?',null,{}])assert.equal(pureCourtesyReply(intent),null,String(intent));
});

test('actual native Send records exactly one local user/assistant pair and a truthful Stream event without model work',async()=>{
  const f=fixture();try{
    const request=await f.send('awesome, thank you');assert.equal(request.state,'responded');assert.equal(request.providerId,null);assert.deepEqual(request.nativeResponse,{schemaVersion:1,classification:'observed'});
    const state=await f.state(),messages=state.conversation!.messages;assert.equal(state.requests.length,1);assert.equal(state.plans.length,0);
    assert.deepEqual(messages.map(m=>[m.role,m.content,m.source]),[['user','awesome, thank you','user'],['assistant','You’re welcome.','vela-native']]);
    assert.equal(messages[0].id,request.inputMessageId);assert.equal(messages[1].id,request.response!.messageId);
    assert.equal(f.bodies.length+f.modelReads+f.codexCalls,0);assert.deepEqual(await f.core.command('providerActivity',{}),{codexConnections:0,providerRequests:0,systemMemoryReads:0,scope:'process-session-native-attempts'});
    const event=f.events.find(e=>e.type==='vela.routing.stage_completed'&&e.correlationId===request.id);assert(event);assert.equal(event.classification,'observed');assert.equal(event.providerId,'aerynth-native');
    assert.equal(Object.keys((await f.core.command('snapshot',{})).executions).length,0);
  }finally{await f.close();}
});

test('actual Core leaves pinned routes, handoffs, agents, selected resources and compound actions on their existing paths',async()=>{
  const f=fixture();try{
    const choices:VelaTurnRouting[]=[{providerId:'openai-api-vela'},{providerId:'codex-app-server'},{model:'gpt-6-luna'},{reasoningEffort:'low'},{mode:'codex'},{mode:'deep'},{mode:'fast'},{mode:'custom'},{handoffSourceRequestId:randomUUID()},{routingAgentId:randomUUID()}];
    for(const settings of choices)assert.deepEqual(await f.core.command('velaRouteNative',{intent:'awesome, thank you',settings}),{matched:false},JSON.stringify(settings));
    for(const intent of ['thanks, but check weather','thanks, cancel','hello, list my tasks','thanks, delete the file'])assert.deepEqual(await f.core.command('velaRouteNative',{intent}),{matched:false},intent);
    assert.deepEqual(await f.core.command('velaRouteNative',{intent:'thanks',resourceIds:[randomUUID()]}),{matched:false});
    await f.core.command('vela',{name:'saveRoutingSettings',input:{scope:'global',id:null,expectedVersion:0,defaults:{providerId:'codex-app-server'}}});
    assert.deepEqual(await f.core.command('velaRouteNative',{intent:'thanks'}),{matched:false});
    const state=await f.state();assert.equal(state.requests.length,0);assert.equal(f.bodies.length+f.codexCalls,0);
  }finally{await f.close();}
});

test('a local courtesy preserves the earlier actual Core unknown API request, execution and receipt through restart without replay',async()=>{
  const f=fixture();try{
    const unknown=await f.unknown();assert.equal(unknown.state,'unknown');assert.equal(f.bodies.length,1);
    const projectedUnknown={...unknown,...(unknown.toolWorkflow?{toolWorkflow:{...unknown.toolWorkflow,completedReadJobs:0}}:{})};
    const canonicalUnknown=()=>(f.core as any).vela.state().requests.find((request:VelaRequest)=>request.id===unknown.id);
    const before=await f.core.command('snapshot',{}),receipts=(f.core as any).db.prepare('SELECT * FROM vela_api_runs').all(),reads=f.modelReads;
    const reply=await f.send('awesome, thank you');assert.equal(reply.state,'responded');
    assert.deepEqual(canonicalUnknown(),unknown);assert.deepEqual((await f.state()).requests.find(r=>r.id===unknown.id),projectedUnknown);
    assert.deepEqual((await f.core.command('snapshot',{})).executions,before.executions);assert.deepEqual((f.core as any).db.prepare('SELECT * FROM vela_api_runs').all(),receipts);
    assert.equal(f.bodies.length,1);assert.equal(f.modelReads,reads);assert.equal(f.codexCalls,0);
    const current=await f.state();assert.equal(current.conversation!.messages.filter(m=>m.content==='awesome, thank you'&&m.role==='user').length,1);assert.equal(current.plans.length,0);
    await f.reopen();assert.deepEqual(canonicalUnknown(),unknown);assert.deepEqual((await f.state()).requests.find(r=>r.id===unknown.id),projectedUnknown);assert.deepEqual((await f.core.command('snapshot',{})).executions,before.executions);
    assert.equal(f.bodies.length,1);assert.equal((await f.state()).requests.find(r=>r.id===reply.id)!.state,'responded');
  }finally{await f.close();}
});
