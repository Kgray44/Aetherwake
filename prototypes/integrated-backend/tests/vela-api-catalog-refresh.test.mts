import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {VelaApiConnection} from '../src/vela-api-connection.mts';
import {VelaApiRuntime} from '../src/vela-api-runtime.mts';
import { investigateReviewedVelaNotes } from '../src/vela-semantic-history.mts';
import {createCapabilityCatalog} from '../../vela-core/src/capability-catalog.mts';
import {CAPABILITIES} from '../../vela-core/src/capabilities.ts';

function fixture(){
 const db=new DatabaseSync(':memory:'),key=randomBytes(32),catalog=createCapabilityCatalog(CAPABILITIES),bodies:any[]=[],catalogErrors:string[]=[],catalogOperations=new Set<Promise<unknown>>();
 let clock=Date.now(),sequence=0,gets=0,live=true,serial=0;
 const replies:(()=>Response|Promise<Response>)[]=[];
 let catalogReply:()=>Response|Promise<Response>=()=>Response.json({data:[{id:'gpt-6-luna'}]});
 const atomic=<T,>(fn:()=>T):T=>{const name='catalog_'+ ++sequence;db.exec('SAVEPOINT '+name);try{const value=fn();db.exec('RELEASE '+name);return value;}catch(error){db.exec('ROLLBACK TO '+name);db.exec('RELEASE '+name);throw error;}};
 atomic(()=>{VelaApiConnection.migrate(db);VelaApiRuntime.migrate(db);});
 const fetchFixture=(async(url,init)=>{
  if(String(url)==='https://api.openai.com/v1/models'){gets++;return catalogReply();}
  assert.equal(String(url),'https://api.openai.com/v1/responses');bodies.push(JSON.parse(String(init?.body)));const reply=replies.shift();assert(reply,'unexpected synthetic provider call');return reply();
 }) as typeof fetch;
 const connection=new VelaApiConnection({db,transaction:fn=>atomic(()=>fn(db)),now:()=>clock,fetch:fetchFixture,nativeHost:{secrets:{available:async()=>true,
  seal:async text=>{const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,cipher.update(text),cipher.final(),cipher.getAuthTag()]);},
  open:async value=>{const bytes=Buffer.from(value),cipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));cipher.setAuthTag(bytes.subarray(-16));return Buffer.concat([cipher.update(bytes.subarray(12,-16)),cipher.final()]).toString();}}}});
 const resolve=connection.resolveCatalog.bind(connection);connection.resolveCatalog=async version=>{try{return await resolve(version);}catch(error){catalogErrors.push((error as {code:string}).code);throw error;}};
 const load=connection.catalog.bind(connection);connection.catalog=version=>{const operation=load(version);catalogOperations.add(operation);void operation.finally(()=>catalogOperations.delete(operation)).catch(()=>{});return operation;};
 const runtime=new VelaApiRuntime({db,transaction:atomic,connection,test:{fetch:fetchFixture}}),controller=new AbortController();
 const prompt=JSON.stringify({intent:'Synthetic scoped discovery',capabilityCatalog:catalog.projection}),contextDigest=createHash('sha256').update(prompt).digest('hex');
 const input={requestId:'synthetic-catalog-expiry',version:1,model:'gpt-6-luna',reasoningEffort:'low' as const,prompt,contextDigest,catalog,oneUse:true as const,validate(){assert(live,'synthetic_scope_revoked');}};
 const reply=(discovery=false, text='Synthetic discovery complete.')=>{const id='synthetic-response-'+ ++serial,output=discovery?[{type:'function_call',id:'synthetic-item-'+serial,call_id:'synthetic-call-'+serial,name:'aerynth_capability_schemas',arguments:JSON.stringify({catalogDigest:catalog.projection.digest,ids:['createWorkspace']}),status:'completed'}]:[{type:'message',id:'synthetic-answer-'+serial,role:'assistant',status:'completed',content:[{type:'output_text',text,annotations:[]}]}];return new Response([{type:'response.created',response:{id}},...(!discovery?[{type:'response.output_text.delta',delta:text}]:[]),{type:'response.completed',response:{id,status:'completed',model:'gpt-6-luna',output,usage:{input_tokens:2,output_tokens:1,total_tokens:3}}}].map(event=>'data: '+JSON.stringify(event)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}});};
 return {db,connection,runtime,controller,input,bodies,replies,catalogErrors,reply,get gets(){return gets;},set catalogReply(value:()=>Response|Promise<Response>){catalogReply=value;},expire(){clock+=60001;},revokeScope(){live=false;},async ready(){await connection.configureNative({configurationId:'vela-primary',apiKey:'SYNTHETIC_ONLY_CATALOG_REFRESH'},null);await connection.catalog(1);runtime.authorizeUsage(1,true);},run(){return runtime.run(input,controller.signal);},async settleRefresh(){await Promise.allSettled([...catalogOperations]);},async close(){await Promise.allSettled([...catalogOperations]);runtime.close();connection.close();db.close();}};
}

test('actual connection refreshes an expired catalog between tool stages without replay or changed pins',async()=>{
 const f=fixture();try{await f.ready();f.replies.push(()=>f.reply(true),()=>{f.expire();return f.reply(true);},()=>f.reply());const result=await f.run();
  assert.equal(result.result.outcome,'completed');assert.equal(f.gets,2);assert.equal(f.bodies.length,3);assert(f.catalogErrors.includes('api_catalog_stale'));
  for(const body of f.bodies){assert.equal(body.model,'gpt-6-luna');assert.deepEqual(body.reasoning,{effort:'low'});assert.equal(body.max_output_tokens,2048);assert.equal(body.store,false);}
  assert.deepEqual(f.db.prepare('SELECT state FROM vela_api_runs ORDER BY rowid').all().map(row=>row.state),['completed','completed','completed']);assert.equal(f.db.prepare('SELECT count(*) n FROM vela_api_tool_receipts').get()!.n,2);
  await assert.rejects(f.run(),/api_execution_already_dispatched/);assert.equal(f.bodies.length,3);
 }finally{await f.close();}
});

test('catalog refresh failure or removal of the pinned model cannot fall back or dispatch the next provider stage',async()=>{
 for(const kind of ['unavailable','model-removed'] as const){const f=fixture();try{await f.ready();f.replies.push(()=>{f.expire();f.catalogReply=()=>kind==='unavailable'?new Response('',{status:503}):Response.json({data:[{id:'gpt-6.1-sol'}]});return f.reply(true);});const result=await f.run();assert.equal(result.result.outcome,'failed');assert.equal(result.result.dispatched,false);assert.equal(f.gets,2);assert.equal(f.bodies.length,1);assert.equal(f.db.prepare('SELECT count(*) n FROM vela_api_runs').get()!.n,2);await assert.rejects(f.run(),/api_execution_already_dispatched/);assert.equal(f.bodies.length,1);}finally{await f.close();}}
});

test('cancellation, usage/scope revocation and key rotation during refresh cannot dispatch a late continuation',async()=>{
 for(const kind of ['cancel','usage','scope','rotate'] as const){const f=fixture();let release!:(value:Response)=>void,entered!:()=>void;const ready=new Promise<void>(resolve=>{entered=resolve;});try{
  await f.ready();f.replies.push(()=>{f.expire();f.catalogReply=()=>{entered();return new Promise(resolve=>{release=resolve;});};return f.reply(true);});const running=f.run();await ready;
  if(kind==='cancel')f.controller.abort();else if(kind==='usage')f.runtime.authorizeUsage(1,false);else if(kind==='scope')f.revokeScope();else await f.connection.configureNative({configurationId:'vela-primary',apiKey:'SYNTHETIC_ONLY_ROTATED_CATALOG'},1);
  release(Response.json({data:[{id:'gpt-6-luna'}]}));const result=await running;await f.settleRefresh();assert.notEqual(result.result.outcome,'completed');assert.equal(f.bodies.length,1);assert.equal(f.gets,2);assert.equal(result.result.dispatched,false);
 }finally{await f.close();}}
});


test('reviewed notes refresh catalog membership without repeating current semantic probes', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const f = fixture();
  try {
    await f.ready();
    const perception = { version: 2, objective: 'Find the inspection weekday', clarification: '',
      perception: { kind: 'recall', explicitGoals: [], inferredGoals: [], constraints: [], capabilityHints: [], deliverables: [], verification: [] },
      needs: [{ key: 'day', question: 'What weekday is the inspection?', query: 'inspection weekday' }] };
    const assessment = { version: 3, clarification: '', assessment: [{ key: 'day', status: 'supported', query: '',
      passages: [{ source: 'e1', quote: 'The pump inspection is on Tuesday.' }] }] };
    const note = { sourceId: 'note-1', sourceKind: 'note' as const, title: 'Inspection', revision: '1',
      text: 'The pump inspection is on Tuesday.', proofDigest: 'synthetic' };
    const respond = (value: unknown) => () => f.reply(false, JSON.stringify(value));
    const investigate = () => investigateReviewedVelaNotes(f.runtime, 'Which weekday is the pump inspection?', [note],
      1, 'gpt-6-luna', () => {}, f.controller.signal);
    f.replies.push(respond(perception), respond(assessment), respond(perception), respond(assessment));
    assert.equal((await investigate()).state, 'assessed');
    assert.equal(f.bodies.length, 4);

    f.expire();
    t.mock.timers.tick(60001);
    f.replies.push(respond(perception), respond(assessment));
    assert.equal((await investigate()).state, 'assessed');
    assert.equal(f.gets, 2);
    assert.equal(f.bodies.length, 6);
  } finally {
    await f.close();
  }
});
