import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,relative,isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BackendCore } from '../src/core.mts';
import type { ConversationSendInput,OrdinaryConnectionPort,StreamEvent } from '../src/contracts.mts';
import type { ProviderConnectionStatus } from '../../application-contract/provider-connections.ts';
import { RESPONSES_ENDPOINT } from '../../openai-provider/responses.mts';
const providerId='chatgpt-plan-responses',boundary='a'.repeat(64),model='synthetic-plan-model';
function sse(events:unknown[]){return new Response(events.map(event=>'data: '+JSON.stringify(event)+'\n\n').join(''),{headers:{'Content-Type':'text/event-stream'}});}
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'aerynth-ordinary-responses-')),path=join(dir,'canonical.sqlite'),events:StreamEvent[]=[],requests:Record<string,any>[]=[],responses:((init:RequestInit)=>Promise<Response>|Response)[]=[];
 let version=1,ready=true,catalogReads=0,secretReads=0,codexCalls=0,finishResolve:(()=>void)|undefined,pending=false;
 const status=async():Promise<ProviderConnectionStatus>=>({contract:'aerynth.provider-connection@1',providerId,billingRoute:'chatgpt-plan',state:ready?'ready':'disconnected',storageAvailable:true,pending,registrationVersion:version,planUsageEnabled:ready,inferenceVerified:false,nativeAccountHistory:false,nativeAccountMemory:false,nativeAccountSync:false});
 const connection:OrdinaryConnectionPort={status,begin:async()=>{pending=true;return {attemptId:'synthetic-attempt',authorizationUrl:'https://auth.openai.com/synthetic-only',expiresAt:Date.now()+60000};},finish:async()=>new Promise<void>(resolve=>{finishResolve=()=>{pending=false;resolve();};}),cancel:async()=>{pending=false;finishResolve?.();},disconnect:async expected=>{assert.equal(expected,version);version++;ready=false;},refresh:async expected=>{assert.equal(expected,version);version++;},close:async()=>{finishResolve?.();},
  resolveCredential:async expected=>{secretReads++;assert.equal(expected,version,'credential version changed');assert(ready);return {providerId,kind:'chatgpt-plan',boundaryDigest:boundary,bearer:'SYNTHETIC_PLAN_TOKEN',expiresAt:Date.now()+60000,scopes:['chatgpt.tokens.use.direct']};},
  modelCatalog:async expected=>{catalogReads++;assert.equal(expected,version);assert(ready);return {providerId,boundaryDigest:boundary,observedAt:Date.now(),catalogOnly:true,models:[{id:model,label:'Synthetic eligible model'}]};},
  revalidateCredential:async(expected,digest)=>{assert.equal(expected,version,'credential version changed');assert.equal(digest,boundary);assert(ready);},
 };
 const fakeFetch:typeof fetch=async(url,init)=>{assert.equal(url,RESPONSES_ENDPOINT);assert.equal(new Headers(init?.headers).get('authorization'),'Bearer SYNTHETIC_PLAN_TOKEN');const body=JSON.parse(String(init?.body));assert.equal(body.store,false);assert.equal(body.stream,true);assert.deepEqual(Object.keys(body),['model','instructions','input','store','stream']);requests.push(body);const response=responses.shift();assert(response,'unexpected provider request');return response(init!);};
 let core:BackendCore;const create=()=>{core=new BackendCore({path,provider:'fixture',contentPolicy:'synthetic-only'},event=>events.push(event),undefined,{connection,fetch:fakeFetch});const port=(core as any).port;for(const key of ['connect','capabilities','open','resume','read','items','turn','terminal','interrupt'])port[key]=()=>{codexCalls++;throw Error('Codex must never serve ordinary Responses');};};create();
 return {get core(){return core;},get owner(){return core as any;},events,requests,responses,connection,get catalogReads(){return catalogReads;},get secretReads(){return secretReads;},get codexCalls(){return codexCalls;},disconnect(){version++;ready=false;},async reopen(){if(!(core as any).closed)await core.command('close',{});create();},async close(){if(!(core as any).closed)await core.command('close',{});const part=relative(resolve(tmpdir()),resolve(dir));assert(part.startsWith('aerynth-ordinary-responses-')&&!part.startsWith('..')&&!isAbsolute(part));rmSync(dir,{recursive:true,force:true});}};
}
function complete(id:string,text='Synthetic response'){return sse([{type:'response.created',response:{id}},{type:'response.output_text.delta',delta:text},{type:'response.completed',response:{id,status:'completed',model,usage:{input_tokens:11,output_tokens:3,total_tokens:14},output:[]}}]);}
async function prepare(f:ReturnType<typeof fixture>,resourceId:string,content:string){const d=await f.core.command('conversation',{name:'detail',input:{resourceId}}) as any,input:ConversationSendInput={resourceId,content,expectedRevision:d.conversation.revision,commandId:randomUUID()},preview=await f.core.command('conversationSendPreview',input);return {input,preview};}
async function grant(f:ReturnType<typeof fixture>,preview:Awaited<ReturnType<typeof prepare>>['preview']){const g=await f.core.command('authorizeConversationSend',{previewId:preview.id,fingerprint:preview.fingerprint,commandId:preview.commandId});return {previewId:preview.id,fingerprint:preview.fingerprint,commandId:preview.commandId,grantId:g.grantId};}

test('populated provider changes require a reviewed continuation and stale branch creation cannot relabel or clone history',async()=>{
 const f=fixture();try{
  await f.core.command('ordinaryProviderStatus',{});
  const empty=await f.core.command('createConversation',{providerId:'local',commandId:randomUUID()});
  const selected=await f.core.command('selectProvider',{resourceId:empty.resourceId,providerId,expectedRevision:1});assert.equal(selected.resourceId,empty.resourceId);assert.equal(selected.providerId,providerId);
  const message=await f.core.command('addMessage',{resourceId:empty.resourceId,role:'user',content:'Exact source history must retain its provider.',expectedRevision:selected.revision});
  const before=await f.core.command('snapshot',{});
  await assert.rejects(f.core.command('selectProvider',{resourceId:empty.resourceId,providerId:'local',expectedRevision:message.revision}),/provider_change_requires_branch/);
  await assert.rejects(f.core.command('branch',{resourceId:empty.resourceId,messageId:message.id,includeMessageIds:[message.id],providerId:'local',title:'Stale continuation',commandId:randomUUID(),tokenBudget:32768,expectedRevision:message.revision-1}),/stale_resource_version/);
  assert.deepEqual(await f.core.command('snapshot',{}),before);
  const branch=await f.core.command('branch',{resourceId:empty.resourceId,messageId:message.id,includeMessageIds:[message.id],providerId:'local',title:'Reviewed continuation',commandId:randomUUID(),tokenBudget:32768,expectedRevision:message.revision});
  assert.equal(branch.mode,'application_continuation');assert.equal(branch.handoff.state,'prepared');assert.notEqual(branch.conversation.resourceId,empty.resourceId);
  await assert.rejects(f.core.command('selectProvider',{resourceId:branch.conversation.resourceId,providerId,expectedRevision:1}),/provider_change_requires_branch/);
  const detail=await f.core.command('conversation',{name:'detail',input:{resourceId:empty.resourceId}}) as any;assert.equal(detail.conversation.providerId,providerId);assert.equal(detail.messages.items[0].content,message.content);
  assert.equal(f.requests.length,0);assert.equal(f.codexCalls,0);
 }finally{await f.close();}
});

test('ordinary Responses uses canonical identity, exact grant and stateless local continuity across follow-up and SQLite restart',async()=>{
 const f=fixture();try{
  await f.core.command('ordinaryProviderCheck',{});const c=await f.core.command('createConversation',{commandId:randomUUID()});assert.equal(c.providerId,providerId);assert.equal(c.kind,'ordinary');assert.equal(c.title,'New conversation');assert.equal(f.owner.db.prepare('SELECT count(*) AS n FROM workspaces').get().n,0);
  const first=await prepare(f,c.resourceId,'Synthetic first question');assert(first.preview.responses);assert.deepEqual(first.preview.responses.messages,[{role:'user',content:'Synthetic first question'}]);
  await assert.rejects(f.core.command('conversationSend',{previewId:first.preview.id,fingerprint:first.preview.fingerprint,commandId:first.input.commandId,grantId:'missing'}),/native_send_grant_required/);assert.equal(f.requests.length,0);
  f.responses.push(()=>complete('resp-synthetic-first','Synthetic first answer'));const firstGrant=await grant(f,first.preview),e1=await f.core.command('conversationSend',firstGrant);assert.equal(e1.state,'provider_completed');assert.equal(e1.binding,null);assert.equal(e1.turnId,null);assert.equal(e1.responseId,'resp-synthetic-first');assert.equal(e1.usage?.source,'provider-reported');assert.equal(e1.taskVerified,false);await assert.rejects(f.core.command('conversationSend',firstGrant),/native_send_grant_consumed/);
  f.responses.push(()=>complete('resp-synthetic-second','Synthetic follow-up answer'));const second=await prepare(f,c.resourceId,'Synthetic follow-up');assert.deepEqual(second.preview.responses!.messages.map(m=>[m.role,m.content]),[['user','Synthetic first question'],['assistant','Synthetic first answer'],['user','Synthetic follow-up']]);await f.core.command('conversationSend',await grant(f,second.preview));
  const before=await f.core.command('snapshot',{}),beforeIds=before.graph.messages.map(m=>m.id);assert.equal(before.bindings[c.resourceId],undefined);assert.equal(before.graph.messages.length,4);await f.reopen();
  const third=await prepare(f,c.resourceId,'Synthetic after restart');assert.equal(third.preview.responses!.messages.length,5);f.responses.push(()=>complete('resp-synthetic-third','Synthetic restored answer'));await f.core.command('conversationSend',await grant(f,third.preview));
  const after=await f.core.command('snapshot',{});assert.deepEqual(after.graph.messages.slice(0,4).map(m=>m.id),beforeIds);assert.equal(after.graph.conversations.length,1);assert.equal(after.graph.conversations[0].kind,'ordinary');assert.equal(after.graph.messages.length,6);assert.equal(Object.values(after.executions).length,3);assert.equal(f.codexCalls,0);
  const delta=f.events.find(e=>e.payload.delta);assert.equal(delta?.providerId,providerId);assert.equal(delta?.threadId,null);assert.equal(delta?.turnId,null);assert(f.events.some(e=>e.payload.usage?.source==='provider-reported'));assert(!JSON.stringify(after).includes('SYNTHETIC_PLAN_TOKEN'));
 }finally{await f.close();}
});

test('ordinary history/provider reads never resolve credentials or catalogs; missing native service stays unavailable and manual local remains usable',async()=>{
 const f=fixture();try{
  for(let i=0;i<3;i++){await f.core.command('conversation',{name:'providers',input:{}});await f.core.command('conversation',{name:'list',input:{}});await f.core.command('ordinaryProviderStatus',{});}assert.equal(f.catalogReads,0);assert.equal(f.secretReads,0);
  await f.core.command('ordinaryProviderCheck',{});const providers=await f.core.command('conversation',{name:'providers',input:{}}) as any[];assert.equal(providers.find(p=>p.id===providerId).default,true);assert.equal(providers.find(p=>p.id==='chatgpt').available,false);assert.equal(providers.find(p=>p.id==='local').execute,false);assert.equal(f.codexCalls,0);
 }finally{await f.close();}
 const dir=mkdtempSync(join(tmpdir(),'aerynth-ordinary-unavailable-')),core=new BackendCore({path:join(dir,'canonical.sqlite'),provider:'fixture',contentPolicy:'synthetic-only'});try{assert.equal((await core.command('ordinaryProviderStatus',{})).state,'unavailable');const c=await core.command('createConversation',{providerId:'local',commandId:randomUUID()});await core.command('addMessage',{resourceId:c.resourceId,role:'user',content:'Synthetic useful local recording',expectedRevision:1});assert.equal((await core.command('snapshot',{})).graph.messages.length,1);}finally{await core.command('close',{});const part=relative(resolve(tmpdir()),resolve(dir));assert(part.startsWith('aerynth-ordinary-unavailable-')&&!part.startsWith('..')&&!isAbsolute(part));rmSync(dir,{recursive:true,force:true});}
});

test('authorized ordinary default survives restart without model configuration and only explicit Send checks models',async()=>{
 const f=fixture();try{
  await f.core.command('ordinaryProviderCheck',{});const beforeCatalog=f.catalogReads;await f.reopen();
  const c=await f.core.command('createConversation',{commandId:randomUUID()});assert.equal(c.providerId,providerId);assert.equal(c.kind,'ordinary');assert.equal(f.catalogReads,beforeCatalog);assert.equal(f.requests.length,0);assert.equal((await f.core.command('openResource',{resourceId:c.resourceId})).status,'ready');
  const fromManager=await f.core.command('conversation',{name:'create',input:{title:'',commandId:randomUUID()}}) as any;assert.equal(fromManager.providerId,providerId);const providers=await f.core.command('conversation',{name:'providers',input:{}}) as any[];assert.equal(providers.find(p=>p.id===providerId).default,true);assert.deepEqual(providers.find(p=>p.id===providerId).models,[]);assert.equal(f.catalogReads,beforeCatalog);
  const p=await prepare(f,c.resourceId,'Synthetic first Send after restart');assert.equal(f.catalogReads,beforeCatalog+1);assert.equal(f.requests.length,0);f.responses.push(()=>complete('resp-synthetic-restored-default'));await f.core.command('conversationSend',await grant(f,p.preview));assert.equal(f.requests.length,1);assert.equal(f.catalogReads,beforeCatalog+1);assert.equal(f.codexCalls,0);
 }finally{await f.close();}
});

test('explicit manual Desktop and Library choices stay local while omitted ordinary providers use the authorized default without model reads',async()=>{
 const f=fixture();try{
  await f.core.command('ordinaryProviderStatus',{});const desktop=await f.core.command('desktop',{type:'createResource',kind:'conversation',title:'Synthetic explicit Desktop manual',provider:'local',workspaceId:null}),manual=desktop.resources.find(r=>r.title==='Synthetic explicit Desktop manual')!;assert.equal(manual.providerId,'local');
  const automatic=await f.core.command('desktop',{type:'createResource',kind:'conversation',title:'Synthetic automatic Desktop ordinary',workspaceId:null});assert.equal(automatic.resources.find(r=>r.title==='Synthetic automatic Desktop ordinary')!.providerId,providerId);
  const ws=(await f.core.command('desktop',{type:'createWorkspace',title:'Synthetic library provider choices',projectId:null})).activeWorkspaceId!;
  const current=await f.core.command('desktop',{type:'snapshot'}),local=await f.core.command('library',{name:'createBlock',input:{commandId:randomUUID(),workspaceId:ws,expectedLayoutVersion:current.layoutVersion,kind:'conversation',title:'Synthetic explicit Library manual',provider:'local'}});
  assert.equal((local.result as any).resourceId,local.desktop!.resources.find(r=>r.providerId==='local'&&r.title==='Synthetic explicit Library manual')!.id);
  await f.reopen();const before=await f.core.command('desktop',{type:'snapshot'}),ready=await f.core.command('library',{name:'createBlock',input:{commandId:randomUUID(),workspaceId:ws,expectedLayoutVersion:before.layoutVersion,kind:'conversation',title:'Synthetic automatic Library ordinary'}});assert.equal(ready.desktop!.resources.find(r=>r.id===(ready.result as any).resourceId)!.providerId,providerId);
  assert.equal(f.catalogReads,0);assert.equal(f.requests.length,0);assert.equal(f.codexCalls,0);
 }finally{await f.close();}
});

test('ordinary stale revision/account/grant cannot dispatch, and permission loss invalidates approved history before any request',async()=>{
 const f=fixture();try{
  await f.core.command('ordinaryProviderCheck',{});const c=await f.core.command('createConversation',{commandId:randomUUID()}),p=await prepare(f,c.resourceId,'Synthetic reviewed request'),g=await grant(f,p.preview);
  await f.core.command('addMessage',{resourceId:c.resourceId,role:'user',content:'Synthetic intervening message',expectedRevision:1});await assert.rejects(f.core.command('conversationSend',g),/stale_resource_version|stale_send_preview/);assert.equal(f.requests.length,0);
  const fresh=await prepare(f,c.resourceId,'Synthetic permission-fenced request'),freshGrant=await grant(f,fresh.preview),access=f.owner.conversationAccess.access;f.owner.conversationAccess.access=()=>false;await assert.rejects(f.core.command('conversationSend',freshGrant),/stale_send_preview|source_unavailable/);f.owner.conversationAccess.access=access;assert.equal(f.requests.length,0);
  const changed=await prepare(f,c.resourceId,'Synthetic account-fenced request'),changedGrant=await grant(f,changed.preview);f.disconnect();await assert.rejects(f.core.command('conversationSend',changedGrant));assert.equal(f.requests.length,0);assert.equal(f.codexCalls,0);
 }finally{await f.close();}
});

test('credential resolution race rechecks authority before POST and preserves the accepted user message',async()=>{
 const f=fixture();let release:(()=>void)|undefined;try{
  await f.core.command('ordinaryProviderCheck',{});const c=await f.core.command('createConversation',{commandId:randomUUID()}),p=await prepare(f,c.resourceId,'Synthetic asynchronous credential fence'),g=await grant(f,p.preview),original=f.connection.resolveCredential;
  f.connection.resolveCredential=async version=>{const credential=await original(version);await new Promise<void>(resolve=>{release=resolve;});return credential;};
  const running=f.core.command('conversationSend',g);for(let i=0;i<100&&!release;i++)await new Promise(resolve=>setTimeout(resolve,1));assert(release);f.disconnect();release();const result=await running;assert.equal(result.state,'failed');assert.equal(f.requests.length,0);assert.equal((await f.core.command('snapshot',{})).graph.messages[0].content,p.input.content);assert.equal(f.codexCalls,0);
 }finally{release?.();await f.close();}
});

test('last async status revalidation cannot retain a resource grant revoked before the final synchronous dispatch fence',async()=>{
 const f=fixture();let release:(()=>void)|undefined;const originalStatus=f.connection.status;let activeStatuses=0;try{
  await f.core.command('ordinaryProviderCheck',{});const c=await f.core.command('createConversation',{commandId:randomUUID()}),p=await prepare(f,c.resourceId,'Synthetic final resource fence'),g=await grant(f,p.preview);
  f.connection.status=async()=>{const current=await originalStatus();if(f.owner.active&&++activeStatuses===2)await new Promise<void>(resolve=>{release=resolve;});return current;};
  const running=f.core.command('conversationSend',g);for(let i=0;i<100&&!release;i++)await new Promise(resolve=>setTimeout(resolve,1));assert(release,'gate must be the final active status, after credential resolution');const resource=f.owner.conversationAccess.resource;f.owner.conversationAccess.resource=()=>false;release();const result=await running;f.owner.conversationAccess.resource=resource;assert.equal(result.state,'failed');assert.equal(f.requests.length,0);assert.equal((await f.core.command('snapshot',{})).graph.messages[0].content,p.input.content);assert.equal(f.codexCalls,0);
 }finally{release?.();await f.close();}
});

test('an actual completed response after connection revocation keeps its reported receipt but cannot commit stale authorized output',async()=>{
 const f=fixture();try{
  await f.core.command('ordinaryProviderCheck',{});const c=await f.core.command('createConversation',{commandId:randomUUID()}),p=await prepare(f,c.resourceId,'Synthetic accepted before disconnect');
  f.responses.push(()=>{f.disconnect();return complete('resp-synthetic-disconnected','Synthetic output not committed after revocation');});const result=await f.core.command('conversationSend',await grant(f,p.preview));assert.equal(result.responseOutcome,'completed');assert.equal(result.responseId,'resp-synthetic-disconnected');assert.equal(result.state,'unknown');assert.equal(result.errorCode,'ordinary_context_changed');assert.equal(result.usage?.source,'provider-reported');assert.equal((await f.core.command('snapshot',{})).graph.messages.length,1);assert.equal(f.requests.length,1);assert.equal(f.codexCalls,0);
 }finally{await f.close();}
});

test('selective reviewed branch context survives ordinary restart without merging parent history; share supply needs actual response acceptance',async()=>{
 const f=fixture();try{
  await f.core.command('ordinaryProviderCheck',{});const parent=await f.core.command('createConversation',{providerId:'local',commandId:randomUUID()}),a=await f.core.command('addMessage',{resourceId:parent.resourceId,role:'user',content:'Synthetic selected source A',expectedRevision:1}),b=await f.core.command('addMessage',{resourceId:parent.resourceId,role:'user',content:'Synthetic EXCLUDED source B',expectedRevision:2}),branch=await f.core.command('branch',{resourceId:parent.resourceId,messageId:b.id,includeMessageIds:[a.id],providerId,title:'Synthetic ordinary branch',commandId:randomUUID(),tokenBudget:32768});assert.equal(branch.conversation.kind,'ordinary');
  await f.core.command('review',{handoffId:branch.handoff.id,fingerprint:branch.handoff.fingerprint,approve:true});
  const share=await f.core.command('conversation',{name:'publish',input:{sourceResourceId:parent.resourceId,sourceMessageId:a.id,evidence:'excerpt'}}) as any;await f.core.command('conversation',{name:'inspectShare',input:{resourceId:branch.conversation.resourceId,shareId:share.id}});await f.core.command('conversation',{name:'attachShare',input:{resourceId:branch.conversation.resourceId,shareId:share.id,attach:true}});
  const p=await prepare(f,branch.conversation.resourceId,'Synthetic branch question');assert.equal(p.preview.responses!.history.length,0);assert(p.preview.responses!.requiresSourceReview);assert(JSON.stringify(p.preview.responses!.messages).includes(a.content));assert(!JSON.stringify(p.preview.responses!.messages).includes(b.content));assert.equal((await f.core.command('conversation',{name:'detail',input:{resourceId:branch.conversation.resourceId}}) as any).shares[0].state,'attached');
  f.responses.push(()=>complete('resp-synthetic-selected','Synthetic selected-context answer'));const e=await f.core.command('conversationSend',await grant(f,p.preview));assert.equal(e.state,'provider_completed');assert.equal((await f.core.command('conversation',{name:'detail',input:{resourceId:branch.conversation.resourceId}}) as any).shares[0].state,'sent');
  await f.core.command('addMessage',{resourceId:parent.resourceId,role:'user',content:'Synthetic later independent parent C',expectedRevision:3});await f.reopen();
  const next=await prepare(f,branch.conversation.resourceId,'Synthetic retained-source follow-up');assert.equal(next.preview.handoff?.continued,true);assert(next.preview.responses!.history.every(h=>h.resourceId===branch.conversation.resourceId));assert(!JSON.stringify(next.preview.responses!.messages).includes(b.content));assert(!JSON.stringify(next.preview.responses!.messages).includes('later independent parent C'));assert(JSON.stringify(next.preview.responses!.messages).includes(a.content));
  f.owner.atomic(()=>f.owner.graph.markUnavailable(a.id));await assert.rejects(f.core.command('authorizeConversationSend',{previewId:next.preview.id,fingerprint:next.preview.fingerprint,commandId:next.input.commandId}),/source_unavailable|stale_context|source_revoked/);assert.equal(f.requests.length,1);assert.equal(f.codexCalls,0);
 }finally{await f.close();}
});

test('provider failure/EOF preserves exact user text and partial canonical evidence without silently reusing partial output',async()=>{
 const f=fixture();try{
  await f.core.command('ordinaryProviderCheck',{});const c=await f.core.command('createConversation',{commandId:randomUUID()});
  f.responses.push(()=>sse([{type:'response.created',response:{id:'resp-synthetic-gap'}},{type:'response.output_text.delta',delta:'Synthetic partial only'}]));const p=await prepare(f,c.resourceId,'Synthetic gap request'),e=await f.core.command('conversationSend',await grant(f,p.preview));assert.equal(e.state,'unknown');assert.equal(e.responseOutcome,'unknown');assert.equal(e.errorCode,'stream_terminal_unobserved');
  const d=await f.core.command('conversation',{name:'detail',input:{resourceId:c.resourceId}}) as any;assert.equal(d.messages.items[0].content,'Synthetic gap request');assert.equal(d.messages.items[1].content,'Synthetic partial only');assert.equal(d.messages.items[1].outputState,'partial');assert.equal(d.messages.items[1].executionId,e.id);
  await f.reopen();const next=await prepare(f,c.resourceId,'Synthetic explicit new request');assert.deepEqual(next.preview.responses!.messages.map(m=>m.content),['Synthetic gap request','Synthetic explicit new request']);
  f.responses.push(()=>sse([{type:'response.failed',response:{id:'resp-synthetic-quota',status:'failed',error:{code:'subscription_sharing_usage_limit_exceeded'}}}]));const failed=await f.core.command('conversationSend',await grant(f,next.preview));assert.equal(failed.state,'failed');assert.equal(failed.errorCode,'subscription_sharing_usage_limit_exceeded');assert.equal(f.codexCalls,0);
 }finally{await f.close();}
});

test('ordinary cancellation requests actual abort, retains unknown outcome/partial text and does not invoke Codex interrupt',async()=>{
 const f=fixture();let pending:Promise<unknown>|undefined;try{
  await f.core.command('ordinaryProviderCheck',{});const c=await f.core.command('createConversation',{commandId:randomUUID()});let started=false;
  f.responses.push(init=>new Response(new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify({type:'response.created',response:{id:'resp-synthetic-cancel'}})+'\n\ndata: '+JSON.stringify({type:'response.output_text.delta',delta:'Synthetic received before abort'})+'\n\n'));started=true;init.signal!.addEventListener('abort',()=>controller.error(new Error('Synthetic fetch abort')),{once:true});}}),{headers:{'Content-Type':'text/event-stream'}}));
  const p=await prepare(f,c.resourceId,'Synthetic cancel request');pending=f.core.command('conversationSend',await grant(f,p.preview));for(let i=0;i<100&&(!started||!f.owner.assistantText);i++)await new Promise(resolve=>setTimeout(resolve,2));assert(started);const execution=f.owner.active;assert(execution);
  assert.deepEqual(await f.core.command('interrupt',{executionId:execution.id}),{requested:true,confirmed:false});const result=await pending as any;pending=undefined;assert.equal(result.state,'unknown');assert.equal(result.cancellation.requested,true);assert.equal(result.cancellation.serverConfirmed,false);assert.equal(f.codexCalls,0);assert.equal((await f.core.command('conversation',{name:'detail',input:{resourceId:c.resourceId}}) as any).messages.items.at(-1).outputState,'partial');
 }finally{if(pending){f.owner.ordinaryController?.abort();await pending;}await f.close();}
});

test('native auth finish returns pending promptly, suppresses secret URL in public state and closes the caught background task',async()=>{
 const f=fixture();try{
  const start=await f.core.command('providerAuth',{providerId,type:'begin'});assert('authorizationUrl'in start);const t=performance.now(),pending=await f.core.command('providerAuth',{providerId,type:'finish',attemptId:'synthetic-attempt'});assert(performance.now()-t<1000);assert(!('authorizationUrl'in pending));assert('pending'in pending&&pending.pending);assert(!JSON.stringify(await f.core.command('providerConnection',{providerId,type:'status'})).includes('https://'));
  await f.core.command('providerAuth',{providerId,type:'cancel',attemptId:'synthetic-attempt'});for(let i=0;i<20&&f.owner.ordinaryAuth.size;i++)await new Promise(resolve=>setTimeout(resolve,1));assert.equal(f.owner.ordinaryAuth.size,0);assert.equal(f.requests.length,0);
 }finally{await f.close();}
});

test('close during an ordinary pending stream waits for canonical unknown/partial settlement before closing SQLite',async()=>{
 const f=fixture();let running:Promise<unknown>|undefined;try{
  await f.core.command('ordinaryProviderCheck',{});const c=await f.core.command('createConversation',{commandId:randomUUID()});let aborted=false;
  f.responses.push(init=>new Response(new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify({type:'response.created',response:{id:'resp-synthetic-close'}})+'\n\ndata: '+JSON.stringify({type:'response.output_text.delta',delta:'Synthetic retained at close'})+'\n\n'));init.signal!.addEventListener('abort',()=>{aborted=true;controller.error(new Error('Synthetic close abort'));},{once:true});}}),{headers:{'Content-Type':'text/event-stream'}}));
  const p=await prepare(f,c.resourceId,'Synthetic durable close request');running=f.core.command('conversationSend',await grant(f,p.preview));for(let i=0;i<100&&!f.owner.assistantText;i++)await new Promise(resolve=>setTimeout(resolve,2));assert(f.owner.assistantText);
  await f.core.command('close',{});const e=await running as any;running=undefined;assert(aborted);assert.equal(e.state,'unknown');assert.equal(e.cancellation.serverConfirmed,false);assert.equal(f.owner.closed,true);assert.equal(f.codexCalls,0);
  await f.reopen();const restored=await f.core.command('snapshot',{});assert.equal(restored.executions[e.id].state,'unknown');assert.deepEqual(restored.graph.messages.map(m=>m.content),['Synthetic durable close request','Synthetic retained at close']);assert.equal(restored.messageEvidence[e.outputMessageId].outputState,'partial');assert.equal(f.requests.length,1);
 }finally{if(running){f.owner.ordinaryController?.abort();await running;}await f.close();}
});
