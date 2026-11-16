import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join,resolve,relative,isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { BackendCore } from '../src/core.mts';
import type { NoteDocument } from '../../block-library/note-contracts.ts';
import type { CreatedBlock } from '../../block-library/contracts.ts';
import { createRequire } from 'node:module';
const { conversationCommand } = createRequire(import.meta.url)('../../visual-experience/cinematic-v3/native/conversation-broker.cjs');
const { velaCommand } = createRequire(import.meta.url)('../../visual-experience/cinematic-v3/native/vela-broker.cjs');
const { validateReview: validateNativeVelaReview, reviewPage: nativeVelaReviewPage } = createRequire(import.meta.url)('../../visual-experience/cinematic-v3/native/vela-review.cjs');
import type { ConversationSendInput,OrdinaryConnectionPort,StreamEvent,VelaRequestPreview } from '../src/contracts.mts';
import type { ProviderConnectionStatus } from '../../application-contract/provider-connections.ts';
import type { VelaRequest, VelaState } from '../../vela-core/src/contracts.ts';
import type { VelaRoutingSettingsChange } from '../../vela-core/src/routing-settings.ts';
import type { VelaRoutingSample } from '../../vela-core/src/routing-calibration.ts';
import type { AgentMutationReceipt, AgentProviderCatalog } from '../../agent-product/contracts.ts';
import { RESPONSES_ENDPOINT } from '../../openai-provider/responses.mts';
import type { NativeDocumentTextServices } from '../src/document-text-host.mts';
import type { MissionPlanningOffer, MissionPreview, MissionProjection, MissionWorkroom, MissionWorkroomPreview } from '../src/mission-contracts.mts';
import type { MissionTeam } from '../src/mission-teams.mts';
const providerId='chatgpt-plan-responses',boundary='a'.repeat(64),model='synthetic-plan-model';
const documentedModel = { id: 'gpt-6.1-sol', label: 'Synthetic catalog Sol' };
function sse(events:unknown[]){return new Response(events.map(event=>'data: '+JSON.stringify(event)+'\n\n').join(''),{headers:{'Content-Type':'text/event-stream'}});}
function fixture(useCodexProtocolDouble = false, codexMode = 'air-inspection', historyContext?: boolean,fileEditRoots?:readonly string[], privateMemory=false){
 const dir=mkdtempSync(join(realpathSync.native(tmpdir()),'aerynth-ordinary-responses-')),path=join(dir,'canonical.sqlite'),events:StreamEvent[]=[],requests:Record<string,any>[]=[],responses:((init:RequestInit)=>Promise<Response>|Response)[]=[];
 let listedModels=[{id:model,label:'Synthetic eligible model'}];
 let version=1,ready=true,catalogReads=0,secretReads=0,codexCalls=0,finishResolve:(()=>void)|undefined,pending=false;
 const status=async():Promise<ProviderConnectionStatus>=>({contract:'aerynth.provider-connection@1',providerId,billingRoute:'chatgpt-plan',state:ready?'ready':'disconnected',storageAvailable:true,pending,registrationVersion:version,planUsageEnabled:ready,inferenceVerified:false,nativeAccountHistory:false,nativeAccountMemory:false,nativeAccountSync:false});
 const connection:OrdinaryConnectionPort={status,begin:async()=>{pending=true;return {attemptId:'synthetic-attempt',authorizationUrl:'https://auth.openai.com/synthetic-only',expiresAt:Date.now()+60000};},finish:async()=>new Promise<void>(resolve=>{finishResolve=()=>{pending=false;resolve();};}),cancel:async()=>{pending=false;finishResolve?.();},disconnect:async expected=>{assert.equal(expected,version);version++;ready=false;},refresh:async expected=>{assert.equal(expected,version);version++;},close:async()=>{finishResolve?.();},
  resolveCredential:async expected=>{secretReads++;assert.equal(expected,version,'credential version changed');assert(ready);return {providerId,kind:'chatgpt-plan',boundaryDigest:boundary,bearer:'SYNTHETIC_PLAN_TOKEN',expiresAt:Date.now()+60000,scopes:['chatgpt.tokens.use.direct']};},
  modelCatalog:async expected=>{catalogReads++;assert.equal(expected,version);assert(ready);return {providerId,boundaryDigest:boundary,observedAt:Date.now(),catalogOnly:true,models:listedModels};},
  revalidateCredential:async(expected,digest)=>{assert.equal(expected,version,'credential version changed');assert.equal(digest,boundary);assert(ready);},
 };
 const fakeFetch:typeof fetch=async(url,init)=>{assert.equal(url,RESPONSES_ENDPOINT);assert.equal(new Headers(init?.headers).get('authorization'),'Bearer SYNTHETIC_PLAN_TOKEN');const body=JSON.parse(String(init?.body));assert.equal(body.store,false);assert.equal(body.stream,true);assert.deepEqual(Object.keys(body),['model','instructions','input','store','stream',...(body.reasoning?['reasoning']:[]),...(body.tools?['tools','tool_choice']:[])]);requests.push(body);const response=responses.shift();assert(response,'unexpected provider request');return response(init!);};
 const provider = { provider: 'fixture' as const };
 let core: BackendCore;
 const documents: NativeDocumentTextServices = {async extract(){throw Error('TXT must not invoke a PDF/DOCX host');}};
 let wrapped='';const syntheticSecrets={available:async()=>true,seal:async(value:string)=>{wrapped=value;return Buffer.alloc(64,7);},open:async()=>wrapped};
 const create=()=>{core=new BackendCore({path,...provider,nativeMedia:true,contentPolicy:privateMemory?'local-private':'synthetic-only',...(privateMemory?{privateRoot:dir}:{}),...(historyContext===undefined?{}:{velaHistoryContext:historyContext})},event=>events.push(event),{documents,secrets:privateMemory?syntheticSecrets:{available:async()=>false,seal:async()=>{throw Error('No real custody in fixture');},open:async()=>{throw Error('No real custody in fixture');}}},{connection,fetch:fakeFetch});if(!useCodexProtocolDouble){const port=(core as any).port;for(const key of ['connect','capabilities','open','resume','read','items','turn','terminal','interrupt'])port[key]=()=>{codexCalls++;throw Error('Codex must never serve ordinary Responses');};}};try{create();}catch(error){rmSync(dir,{recursive:true,force:true});throw error;}
 return {dir,get core(){return core;},get owner(){return core as any;},events,requests,responses,connection,get catalogReads(){return catalogReads;},get secretReads(){return secretReads;},get codexCalls(){return codexCalls;},setListedModels(models:{id:string;label:string}[]){listedModels=models;},disconnect(){version++;ready=false;},async reopen(){if(!(core as any).closed)await core.command('close',{});create();},async close(){if(!(core as any).closed)await core.command('close',{});const part=relative(realpathSync.native(tmpdir()),resolve(dir));assert(part.startsWith('aerynth-ordinary-responses-')&&!part.startsWith('..')&&!isAbsolute(part));rmSync(dir,{recursive:true,force:true});}};
}
function complete(id:string,text='Synthetic response'){return sse([{type:'response.created',response:{id}},{type:'response.output_text.delta',delta:text},{type:'response.completed',response:{id,status:'completed',model,usage:{input_tokens:11,output_tokens:3,total_tokens:14},output:[]}}]);}
for (const format of ['txt'] as const) test('ordinary document send reviews ' + format + ' text and refuses replacement during review', async () => {
 const f = fixture();
 try {
  const path = join(f.dir, 'Synthetic brief.' + format);
  const content = { pdf: 'Searchable second page', docx: 'Table cell', txt: 'Synthetic document evidence: the sample weighs twelve grams.' }[format];
  writeFileSync(path, content);
  const { resource } = await f.core.command('mediaImportTrusted', {
   kind: 'file', variant: 'document', commandId: randomUUID(), selection: { kind: 'file', path },
  });
  const chat = await f.core.command('createConversation', { providerId, commandId: randomUUID() });
  const call = f.core.command.bind(f.core);
  const input = {
   name: 'send', input: { resourceId: chat.resourceId, expectedRevision: chat.revision,
    content: 'What does the sample weigh?', commandId: randomUUID(),
    documents: [{ id: resource.id, version: resource.version }] },
  };
  await assert.rejects(conversationCommand({ call, input, reviewSources: async () => false }), /authorization_cancelled/);
  assert.equal(f.requests.length, 0);
  f.responses.push(() => complete('resp-document', 'Twelve grams.'));
  const result = await conversationCommand({ call, input, reviewSources: async ({ review }: any) => {
   assert(review.context.included[0].content.includes(content));
   assert.equal(review.context.included[0].id, resource.id);
   assert.equal(review.prompt.includes(path), false);
   return true;
  } });
  assert.equal(result.state, 'provider_completed');
  assert.equal(f.requests.length, 1);
  assert(f.requests[0].input.some((message: { content: string }) => message.content.includes(content)));
  const revised = { ...input, input: { ...input.input, expectedRevision: chat.revision + 2, commandId: randomUUID() } };
  await assert.rejects(conversationCommand({ call, input: revised, reviewSources: async () => {
   writeFileSync(path, 'Changed synthetic document text');
   return true;
  } }), /document_text_unavailable|source_changed/);
  assert.equal(f.requests.length, 1);
 } finally { await f.close(); }
});


for (const scenario of ['changed during transport','foreign project','public search','local provider','stale version'] as const) test('document boundary: '+scenario,async()=>{
 const f=fixture();try{
  const path=join(f.dir,'Fence.txt');writeFileSync(path,'Original synthetic evidence');
  const {resource}=await f.core.command('mediaImportTrusted',{kind:'file',variant:'document',commandId:randomUUID(),selection:{kind:'file',path}});
  const chat=await f.core.command('createConversation',{providerId:scenario==='local provider'?'local':providerId,commandId:randomUUID()});
  if(scenario==='foreign project'){
   const project=(await f.core.command('desktop',{type:'createProject',title:'Foreign synthetic project'})).projects[0];
   f.owner.db.prepare('UPDATE resources SET project_id=? WHERE id=?').run(project.id,resource.id);
  }
  const input={name:'send',input:{resourceId:chat.resourceId,expectedRevision:chat.revision,content:'Read selected evidence',commandId:randomUUID(),documents:[{id:resource.id,version:resource.version+(scenario==='stale version'?1:0)}],...(scenario==='public search'?{webSearch:true}:{})}};
  if(scenario==='changed during transport'){
   f.responses.push(()=>{writeFileSync(path,'Replaced synthetic evidence during dispatch');return complete('changed-source','Must not be committed');});
   const result=await conversationCommand({call:f.core.command.bind(f.core),input,reviewSources:async()=>true});
   assert.equal(result.state,'unknown');assert.equal(result.outputMessageId,undefined);
   const detail=await f.core.command('conversation',{name:'detail',input:{resourceId:chat.resourceId}}) as any;
   assert(!JSON.stringify(detail).includes('Must not be committed'));assert.equal(f.requests.length,1);
  }else{
   await assert.rejects(conversationCommand({call:f.core.command.bind(f.core),input,reviewSources:async()=>true}));assert.equal(f.requests.length,0);
  }
  assert.equal(f.codexCalls,0);
 }finally{await f.close();}
});

test('broker rejects tampered document identity and reviewed extracted text before dispatch',async()=>{
 const f=fixture();try{
  const path=join(f.dir,'Tamper.txt');writeFileSync(path,'Synthetic unchanged review evidence');
  const {resource}=await f.core.command('mediaImportTrusted',{kind:'file',variant:'document',commandId:randomUUID(),selection:{kind:'file',path}});
  const chat=await f.core.command('createConversation',{providerId,commandId:randomUUID()});
  for(const changed of ['id','content','version']){
   const input={name:'send',input:{resourceId:chat.resourceId,expectedRevision:chat.revision,content:'Read this',commandId:randomUUID(),documents:[{id:resource.id,version:resource.version}]}};
   const call=async(name:any,arg:any)=>{const value:any=await f.core.command(name,arg);if(name==='conversationSendPreview'){
    value.documents[0][changed]=changed==='version'?resource.version+1:'altered synthetic value';
   }return value;};
   await assert.rejects(conversationCommand({call,input,reviewSources:async()=>{assert.fail('Tampered review must not be offered');}}),/invalid_native_responses_preview/);
  }
  assert.equal(f.requests.length,0);assert.equal(f.codexCalls,0);
 }finally{await f.close();}
});


test('private profiles preserve the ban on synthetic ordinary transport injection',()=>{
 assert.throws(()=>fixture(false,undefined,undefined,undefined,true),/synthetic_ordinary_services_forbidden/);
});

for(const scenario of ['approve','cancel-first','cancel-final','frame-changed','invalid-coverage'] as const)test('synthetic broker combined review: '+scenario,async()=>{
 const f=fixture();try{
  const chat=await f.core.command('createConversation',{providerId,commandId:randomUUID()});
  const path=join(f.dir,'Combined.txt');writeFileSync(path,'Synthetic document specification: twelve grams.');
  const {resource}=await f.core.command('mediaImportTrusted',{kind:'file',variant:'document',commandId:randomUUID(),selection:{kind:'file',path}});
  const input={name:'send',input:{resourceId:chat.resourceId,expectedRevision:chat.revision,content:'Recall the quartz relay preference and read this specification.',commandId:randomUUID(),useMemory:true,documents:[{id:resource.id,version:resource.version}]}};
  const reviews:string[]=[];let valid=true,dispatched=0;
  // Broker-only composition double, not a private-profile Core or real memory receipt.
  const call=async(name:any,arg:any)=>{
   if(name==='conversationSendPreview'){
    const {useMemory,...rest}=arg;const preview:any=await f.core.command(name,rest);
    const r=preview.responses;r.messages.splice(0,0,{role:'developer',content:'Synthetic saved memory: quartz relay preferred.'});
    r.memoryDigest='b'.repeat(64);r.memoryPartialCoverage=scenario==='invalid-coverage'?false:true;
    const body=JSON.stringify({model:r.model,instructions:r.instructions,input:r.messages.map(({role,content}:any)=>({role,content})),store:false,stream:true});
    r.bodyDigest=createHash('sha256').update(body).digest('hex');r.bodyBytes=Buffer.byteLength(body);return preview;
   }
   if(name==='authorizeConversationSend'){assert.match(arg.reviewedBodyDigest,/^[a-f0-9]{64}$/);return {grantId:'synthetic-only-grant'};}
   if(name==='conversationSend'){dispatched++;return {state:'synthetic-completed'};}
   return f.core.command(name,arg);
  };
  const run=conversationCommand({call,input,beforeMemoryPreview:async()=>{reviews.push('memory-consent');if(scenario==='cancel-first')throw Error('authorization_cancelled');},validateMemoryReview:()=>valid,
   reviewSources:async({review}:any)=>{reviews.push('exact-body');assert.match(review.prompt,/quartz relay preferred/);assert.match(review.prompt,/twelve grams/);assert(review.memory.manifestDigest);assert.equal(review.memory.partialCoverage,true);assert.equal(review.prompt.includes("memoryPartialCoverage"),false);assert.equal(review.prompt.includes("partialCoverage"),false);assert.equal(review.context.included[0].id,resource.id);if(scenario==='frame-changed')valid=false;return scenario!=='cancel-final';},
  });
  if(scenario==='approve'){await run;assert.equal(dispatched,1);}else{await assert.rejects(run);assert.equal(dispatched,0);}
  assert.deepEqual(reviews,scenario==='cancel-first'||scenario==='invalid-coverage'?['memory-consent']:['memory-consent','exact-body']);assert.equal(f.requests.length,0);assert.equal(f.codexCalls,0);
 }finally{await f.close();}
});

for (const outcome of ['completed','newer draft','unknown','document']) test('restart reconciles an ordinary draft ('+outcome+')', async () => {
 const f = fixture();
 try {
  const chat = await f.core.command('createConversation',{providerId,commandId:randomUUID()});
  const resourceId = chat.resourceId, content = 'Synthetic submitted question';
  let documents: {id:string;version:number}[] | undefined;
  if (outcome==='document') {
   const path=join(f.dir,'Synthetic restart.txt');
   writeFileSync(path,'Synthetic evidence for the restart journey.');
   const {resource}=await f.core.command('mediaImportTrusted',{
    kind:'file',variant:'document',commandId:randomUUID(),selection:{kind:'file',path},
   });
   documents=[{id:resource.id,version:resource.version}];
  }
  const save = (expectedVersion:number,text:string) => f.core.command('conversation',{
   name:'saveDraft',input:{resourceId,expectedVersion,content:text,documents},
  }) as Promise<import('../../conversation-product/src/contracts.ts').ConversationDraft>;
  const read = () => f.core.command('conversation',{name:'readDraft',input:{resourceId}});
  const draft = await save(0,content);
  f.responses.push(() => outcome === 'unknown'
   ? sse([{type:'response.created',response:{id:'resp-draft-recovery'}}])
   : complete('resp-draft-recovery'));
  const result = await conversationCommand({ call:f.core.command.bind(f.core),reviewSources:async()=>true,
   input:{name:'send',input:{resourceId,content,expectedRevision:chat.revision,commandId:randomUUID(),draftVersion:draft.version,documents}},
  });
  assert.equal(result.state,outcome==='unknown'?'unknown':'provider_completed');
  assert.deepEqual(await read(),draft);
  if(outcome==='newer draft')await save(draft.version,'Synthetic later edits');
  await f.reopen();
  const recovered = await read() as Awaited<ReturnType<typeof save>>;
  assert.equal(recovered.version,draft.version+(outcome==='unknown'?0:1));
  assert.equal(recovered.content,outcome==='unknown'?content:outcome==='newer draft'?'Synthetic later edits':'');
  assert.equal(recovered.documents,undefined);
  await f.reopen();
  assert.deepEqual(await read(),recovered);
  assert.equal(f.requests.length,1);
  const egress=JSON.stringify(f.requests[0]);
  assert.doesNotMatch(egress,/draftVersion|draftCheckpoint|documentsDigest/);
  if(documents){
   assert.match(egress,/Synthetic evidence for the restart journey/);
   const stored=(await f.core.command('snapshot',{})).executions[result.id];
   assert.equal(stored.draftCheckpoint,undefined);
   assert.deepEqual(Object.keys(result.draftCheckpoint).sort(),['documentsDigest','version']);
   assert.match(result.draftCheckpoint.documentsDigest,/^[a-f0-9]{64}$/);
  }
 } finally { await f.close(); }
});

for(const change of ['document id','document version','archived'] as const)test('startup recovery preserves conflicting '+change,async()=>{
 const f=fixture();try{
  const chat=await f.core.command('createConversation',{providerId,commandId:randomUUID()});
  const path=join(f.dir,'Preserve.txt');writeFileSync(path,'Synthetic recovery evidence');
  const {resource}=await f.core.command('mediaImportTrusted',{kind:'file',variant:'document',commandId:randomUUID(),selection:{kind:'file',path}});
  const documents=[{id:resource.id,version:resource.version}],content='Synthetic submitted draft';
  const draft:any=await f.core.command('conversation',{name:'saveDraft',input:{resourceId:chat.resourceId,expectedVersion:0,content,documents}});
  f.responses.push(()=>complete('preserved-draft'));
  const result=await conversationCommand({call:f.core.command.bind(f.core),reviewSources:async()=>true,input:{name:'send',input:{resourceId:chat.resourceId,expectedRevision:chat.revision,content,commandId:randomUUID(),draftVersion:draft.version,documents}}});
  assert.equal(result.state,'provider_completed');
  // Synthetic storage fault isolates digest defense independently of the version guard.
  if(change==='document id')f.owner.db.prepare('UPDATE cp_drafts SET documents_json=? WHERE resource_id=?').run(JSON.stringify([{id:'synthetic:other',version:resource.version}]),chat.resourceId);
  if(change==='document version')f.owner.db.prepare('UPDATE cp_drafts SET documents_json=? WHERE resource_id=?').run(JSON.stringify([{id:resource.id,version:resource.version+1}]),chat.resourceId);
  if(change==='archived')await f.core.command('conversation',{name:'archive',input:{resourceId:chat.resourceId,archived:true,expectedVersion:1}});
  const readRow=()=>({...f.owner.db.prepare('SELECT version,content,documents_json FROM cp_drafts WHERE resource_id=?').get(chat.resourceId)});
  const before=readRow();await f.reopen();assert.deepEqual(readRow(),before);
  await f.reopen();assert.deepEqual(readRow(),before);assert.equal(f.requests.length,1);assert.equal(f.codexCalls,0);
 }finally{await f.close();}
});

test('broker rejects changed checkpoint version before authorization or transport',async()=>{
 const f=fixture();try{
  const chat=await f.core.command('createConversation',{providerId,commandId:randomUUID()});
  const content='Synthetic checkpoint binding';
  const draft:any=await f.core.command('conversation',{name:'saveDraft',input:{resourceId:chat.resourceId,expectedVersion:0,content}});
  const call=async(name:any,arg:any)=>{if(name==='authorizeConversationSend')assert.fail('Changed checkpoint must not be authorized');const value:any=await f.core.command(name,arg);if(name==='conversationSendPreview')value.draftVersion++;return value;};
  await assert.rejects(conversationCommand({call,input:{name:'send',input:{resourceId:chat.resourceId,content,expectedRevision:chat.revision,commandId:randomUUID(),draftVersion:draft.version}}}),/invalid_native_responses_preview/);
  assert.equal(f.requests.length,0);
 }finally{await f.close();}
});

for(const scenario of ['approved','cancelled','archived','changed','oversized','foreign project'] as const)test('canonical saved-note attachment: '+scenario,async()=>{
 const f=fixture();try{
  const snapshot=await f.core.command('desktop',{type:'createResource',kind:'note',title:'Synthetic saved note',workspaceId:null});
  const resource=snapshot.resources.find(item=>item.kind==='note')!;
  const committed=scenario==='oversized'?'x'.repeat(16385):'Synthetic committed note, not private unsaved edits.';
  const note=(await f.core.command('notes',{name:'commitNote',input:{resourceId:resource.id,expectedResourceVersion:resource.version,expectedDraftVersion:0,content:committed}})).result as NoteDocument;
  if(scenario==='approved')await f.core.command('notes',{name:'saveNoteDraft',input:{resourceId:resource.id,expectedDraftVersion:note.draftRevision,baseResourceVersion:note.resource.version,content:'Synthetic unsaved edits must remain local.'}});
  const chat=await f.core.command('createConversation',{providerId,commandId:randomUUID()});
  const docs=[{id:resource.id,version:note.resource.version}];
  const draft=await f.core.command('conversation',{name:'saveDraft',input:{resourceId:chat.resourceId,expectedVersion:0,content:'Summarize the exact saved note.',documents:docs}}) as any;
  assert.equal(draft.documents[0].unavailable,undefined);assert.equal(draft.documents[0].title,'Synthetic saved note');
  const input={name:'send',input:{resourceId:chat.resourceId,expectedRevision:chat.revision,commandId:randomUUID(),content:draft.content,draftVersion:draft.version,documents:docs}};
  const run=()=>conversationCommand({call:f.core.command.bind(f.core),input,reviewSources:async({review}:any)=>{
    const included=review.context.included.find((item:any)=>item.id===resource.id);
    assert.equal(included.content,committed);assert.equal(included.version,note.resource.version);assert.equal(included.attachmentType,'note');
    assert.match(nativeVelaReviewPage(review,draft.content),new RegExp('Saved note · version '+note.resource.version));
    if(scenario==='foreign project'){const project=(await f.core.command('desktop',{type:'createProject',title:'Foreign synthetic project'})).projects[0];f.owner.db.prepare('UPDATE resources SET project_id=? WHERE id=?').run(project.id,resource.id);}
    if(scenario==='archived')await f.core.command('desktop',{type:'archiveSubject',kind:'resource',id:resource.id,expectedVersion:note.resource.version,archived:true});
    if(scenario==='changed')await f.core.command('notes',{name:'commitNote',input:{resourceId:resource.id,expectedResourceVersion:note.resource.version,expectedDraftVersion:note.draftRevision,content:'Different synthetic committed note'}});
    return scenario!=='cancelled';
  }});
  if(scenario==='approved'){
    f.responses.push(()=>complete('resp-saved-note','Synthetic summary'));
    const result=await run();assert.equal(result.state,'provider_completed');assert.equal(f.requests.length,1);
    assert.ok(JSON.stringify(f.requests[0].input).includes(committed));assert.ok(!JSON.stringify(f.requests[0].input).includes('Synthetic unsaved edits'));
    const activity=await f.core.command('conversationActivity',{resourceIds:[chat.resourceId]});
    const execution=activity.executions.find(item=>item.commandId===input.input.commandId);assert.ok(execution?.inputMessageId);
    const detail=await f.core.command('conversation',{name:'detail',input:{resourceId:chat.resourceId,aroundMessageId:execution.inputMessageId}}) as any;
    assert.ok(detail.messages.items.some((message:any)=>message.id===execution.inputMessageId&&!message.inherited&&message.role==='user'&&message.content===input.input.content));
    f.owner.graph.markUnavailable(execution.inputMessageId);
    const revoked=await f.core.command('conversationActivity',{resourceIds:[chat.resourceId]});
    assert.equal(revoked.executions.find(item=>item.commandId===input.input.commandId)?.inputMessageId,undefined);
    await f.reopen();const opened=await f.core.command('openResource',{resourceId:resource.id,expectedVersion:note.resource.version});assert.equal(opened.status,'ready');
  }else{
    await assert.rejects(run(),scenario==='cancelled'?/authorization_cancelled/:scenario==='oversized'?/document_text_unavailable/:/source_selection_unavailable|source_selection_changed|source_changed|stale_send_preview/);
    assert.equal(f.requests.length,0);
  }
 }finally{await f.close();}
});
