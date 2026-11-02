import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash,randomUUID } from 'node:crypto';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,relative,isAbsolute } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { BackendCore } from '../src/core.mts';
import type { ProviderPort } from '../src/contracts.mts';
import { RESOURCE_OPENING_CONTRACT,parseResourceOpeningInput } from '../../application-contract/resource-opening.ts';

function fixture(mode='normal',forbidProvider=true){
 const dir=mkdtempSync(join(tmpdir(),'aerynth-resource-opening-')),path=join(dir,'canonical.sqlite');let core:BackendCore,calls=0;
 const create=()=>{core=new BackendCore({path,provider:'fixture',fixtureMode:mode,contentPolicy:'synthetic-only'});const port=(core as unknown as {port:ProviderPort}).port;for(const name of ['connect','capabilities','open','resume','read','items','turn','terminal','interrupt'] as const){const original=port[name];(port as any)[name]=(...args:unknown[])=>{calls++;if(forbidProvider)throw Error('Provider forbidden during opening fixture');return (original as (...a:unknown[])=>unknown).apply(port,args);};}};create();
 return {get core(){return core;},get owner(){return core as any;},get db(){return (core as unknown as {db:DatabaseSync}).db;},get calls(){return calls;},async reopen(){await core.command('close',{});create();},async close(){await core.command('close',{});const target=resolve(dir),part=relative(resolve(tmpdir()),target);assert(part.startsWith('aerynth-resource-opening-')&&!part.startsWith('..')&&!isAbsolute(part));rmSync(target,{recursive:true,force:true});}};
}
function state(f:ReturnType<typeof fixture>){
 const tables=f.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>String(row.name)),rows=tables.map(name=>{assert(/^[a-z_][a-z_0-9]*$/i.test(name));return [name,f.db.prepare('SELECT * FROM '+name).all().map(row=>JSON.stringify(row)).sort()];});
 return {sqlChanges:f.db.prepare('SELECT total_changes() AS n').get()!.n,digest:createHash('sha256').update(JSON.stringify(rows)).digest('hex'),graph:f.owner.graph.snapshot(),backend:structuredClone(f.owner.state),calls:f.calls};
}
async function note(f:ReturnType<typeof fixture>,kind:'note'|'research'|'task'|'task_group'|'reference'|'stream'='note'){
 const d=await f.core.command('desktop',{type:'createResource',kind,title:'Synthetic unplaced '+kind,workspaceId:null});return d.resources.find(r=>r.kind===kind)!;
}

test('browser-safe exact opening schema retains canonical IDs and rejects grants, unknown hints and accessors',()=>{
 const valid={resourceId:'canonical-resource',origin:{source:'constellation' as const,nodeKey:'resource:canonical-resource'},selection:{messageId:'canonical-message'},preferredPlacement:{workspaceId:'canonical-workspace',blockId:'canonical-block'}};
 const parsed=parseResourceOpeningInput(valid);assert.deepEqual(parsed,valid);valid.selection.messageId='Caller mutation';assert.equal(parsed.selection!.messageId,'canonical-message');
 let accessed=false;const getter={get resourceId(){accessed=true;return 'resource';}};
 for(const value of [null,[],{},'resource',{resourceId:''},{resourceId:'x'.repeat(257)},{resourceId:'x',authorized:true},{resourceId:'x',preferredPresentation:'editor'},{resourceId:'x',origin:'constellation'},{resourceId:'x',origin:{source:'unknown'}},{resourceId:'x',origin:{source:'library',nodeKey:' '}},{resourceId:'x',origin:{source:'vela',grantId:'no'}},{resourceId:'x',selection:{messageId:'m',include:true}},{resourceId:'x',preferredPlacement:{workspaceId:'w'}},getter])assert.throws(()=>parseResourceOpeningInput(value),/invalid_resource_opening_request/);
 assert.equal(accessed,false);assert.equal(parseResourceOpeningInput({resourceId:' x '}).resourceId,' x ','IDs are never silently rewritten');
});

test('unplaced canonical note and conversation open directly with exact identity/drafts and zero hidden mutations or provider activity',async()=>{
 const f=fixture();try{
  const n=await note(f),c=await f.core.command('createConversation',{title:'Synthetic unplaced local conversation',providerId:'local',commandId:randomUUID()}),m=await f.core.command('addMessage',{resourceId:c.resourceId,role:'user',content:'Synthetic durable user message',expectedRevision:1});
  const initial=await f.core.command('openResource',{resourceId:n.id});assert.equal(initial.status,'ready');if(initial.status==='ready')assert.equal(initial.resource.content,'');
  await f.core.command('conversation',{name:'saveDraft',input:{resourceId:c.resourceId,expectedVersion:0,content:'Synthetic unsent exact draft'}});
  await f.core.command('notes',{name:'commitNote',input:{resourceId:n.id,expectedResourceVersion:n.version,expectedDraftVersion:0,content:'Synthetic canonical note body'}});
  const baseline=state(f);assert.equal(f.db.prepare('SELECT count(*) AS n FROM workspaces').get()!.n,0);assert.equal(f.db.prepare('SELECT count(*) AS n FROM blocks').get()!.n,0);
  const desktop=f.owner.desktop.snapshot;f.owner.desktop.snapshot=()=>{throw Error('Opening must not normalize desktop navigation');};
  try{for(let i=0;i<5;i++){
   const opened=await f.core.command('openResource',{resourceId:n.id,origin:{source:'library'}});assert.equal(opened.contract,RESOURCE_OPENING_CONTRACT);assert.equal(opened.status,'ready');if(opened.status!=='ready')throw Error('Expected note');assert.equal(opened.resource.id,n.id);assert.equal(opened.resource.content,'Synthetic canonical note body');assert.deepEqual(opened.presentation,{kind:'note',mode:'direct'});assert.equal(opened.placement,undefined);
   const chat=await f.core.command('openResource',{resourceId:c.resourceId,selection:{messageId:m.id},origin:{source:'constellation',nodeKey:'resource:'+c.resourceId}});assert.equal(chat.status,'ready');if(chat.status!=='ready')throw Error('Expected conversation');assert.equal(chat.resource.providerId,'local');assert.equal(chat.resource.conversationRevision,2);assert.deepEqual(chat.resource.messages,[]);assert.equal(chat.resource.messageCount,undefined);assert.deepEqual(chat.selection,{messageId:m.id});assert.equal(chat.presentation.kind,'conversation');
  }}finally{f.owner.desktop.snapshot=desktop;}
  assert.deepEqual(state(f),baseline);assert.equal((await f.core.command('conversation',{name:'readDraft',input:{resourceId:c.resourceId}}) as {content:string}).content,'Synthetic unsent exact draft');
  await f.reopen();const reopened=await f.core.command('openResource',{resourceId:n.id});assert.equal(reopened.status,'ready');if(reopened.status==='ready'){assert.equal(reopened.resource.id,n.id);assert.equal(reopened.resource.content,'Synthetic canonical note body');assert.equal(reopened.resource.version,2);}
  assert.equal((await f.core.command('conversation',{name:'readDraft',input:{resourceId:c.resourceId}}) as {content:string}).content,'Synthetic unsent exact draft');assert.equal(f.calls,0);
 }finally{await f.close();}
});

test('only an explicit exact current placement hint is verified; removing the last placement preserves direct opening',async()=>{
 const f=fixture();try{
  const n=await note(f),other=await note(f,'reference'),w1=await f.core.command('workspace',{title:'Synthetic first workspace'}),w2=await f.core.command('workspace',{title:'Synthetic second workspace'});
  await f.core.command('desktop',{type:'attach',resourceId:n.id,workspaceId:w1.id});await f.core.command('desktop',{type:'attach',resourceId:other.id,workspaceId:w2.id});
  const row1=f.db.prepare('SELECT id,version FROM blocks WHERE resource_id=? AND workspace_id=?').get(n.id,w1.id)!,row2=f.db.prepare('SELECT id,version FROM blocks WHERE resource_id=? AND workspace_id=?').get(other.id,w2.id)!,p1={id:String(row1.id),version:Number(row1.version)},p2={id:String(row2.id)},baseline=state(f);
  const verified=await f.core.command('openResource',{resourceId:n.id,preferredPresentation:'existing-placement',preferredPlacement:{workspaceId:w1.id,blockId:p1.id}});assert.equal(verified.status,'ready');if(verified.status==='ready'){assert.deepEqual(verified.presentation,{kind:'note',mode:'existing-placement'});assert.equal(verified.placementStatus,'verified');assert.deepEqual(verified.placement,{workspaceId:w1.id,blockId:p1.id});}
  for(const request of [{resourceId:n.id,preferredPlacement:{workspaceId:w1.id,blockId:p1.id}},{resourceId:n.id,preferredPresentation:'existing-placement' as const},{resourceId:n.id,preferredPresentation:'existing-placement' as const,preferredPlacement:{workspaceId:w2.id,blockId:p2.id}}]){const opened=await f.core.command('openResource',request);assert.equal(opened.status,'ready');if(opened.status==='ready'){assert.equal(opened.presentation.mode,'direct');assert.equal(opened.placement,undefined);}}
  assert.deepEqual(state(f),baseline);await f.core.command('desktop',{type:'detach',blockId:p1.id,expectedVersion:p1.version});assert.equal(f.db.prepare('SELECT count(*) AS n FROM blocks WHERE resource_id=?').get(n.id)!.n,0);
  const afterDetach=state(f),opened=await f.core.command('openResource',{resourceId:n.id,preferredPresentation:'existing-placement',preferredPlacement:{workspaceId:w1.id,blockId:p1.id}});assert.equal(opened.status,'ready');if(opened.status==='ready'){assert.equal(opened.resource.id,n.id);assert.equal(opened.placementStatus,'unavailable');assert.equal(opened.presentation.mode,'direct');}assert.deepEqual(state(f),afterDetach);
 }finally{await f.close();}
});

test('unknown, denied and revoked selected sources disclose no content; inherited selection follows exact canonical cutoff',async()=>{
 const f=fixture();try{
  const n=await note(f),parent=await f.core.command('createConversation',{title:'Synthetic parent',providerId:'local',commandId:randomUUID()}),a=await f.core.command('addMessage',{resourceId:parent.resourceId,role:'user',content:'Synthetic fork source',expectedRevision:1}),child=await f.core.command('branch',{resourceId:parent.resourceId,messageId:a.id,includeMessageIds:[a.id],providerId:'local',title:'Synthetic child',commandId:randomUUID(),tokenBudget:32768}),later=await f.core.command('addMessage',{resourceId:parent.resourceId,role:'user',content:'Synthetic parent future',expectedRevision:2});
  const source=f.owner.graph.data.messages.find((m:any)=>m.id===a.id),body=Object.getOwnPropertyDescriptor(source,'content')!,get=f.owner.kernel.getResource,access=f.owner.conversationAccess.access;let bodyReads=0;
  Object.defineProperty(source,'content',{configurable:true,enumerable:true,get(){bodyReads++;throw Error('Opening must not clone source bodies');}});
  f.owner.kernel.getResource=()=>{bodyReads++;throw Error('Denied resource body read');};
  try{
   const inherited=await f.core.command('openResource',{resourceId:child.conversation.resourceId,selection:{messageId:a.id}});assert.equal(inherited.status,'ready');
   const cutoff=await f.core.command('openResource',{resourceId:child.conversation.resourceId,selection:{messageId:later.id}});assert.deepEqual(cutoff,{contract:RESOURCE_OPENING_CONTRACT,status:'unavailable',resourceId:child.conversation.resourceId,reason:'selection-unavailable'});
   const absent=await f.core.command('openResource',{resourceId:'synthetic-missing'});assert.deepEqual(absent,{contract:RESOURCE_OPENING_CONTRACT,status:'unavailable',resourceId:'synthetic-missing',reason:'resource-unavailable'});
   f.owner.conversationAccess.access=()=>false;assert.deepEqual(await f.core.command('openResource',{resourceId:n.id}),{contract:RESOURCE_OPENING_CONTRACT,status:'unavailable',resourceId:n.id,reason:'resource-unavailable'});assert.equal(bodyReads,0);
  }finally{f.owner.conversationAccess.access=access;f.owner.kernel.getResource=get;Object.defineProperty(source,'content',body);}
  f.owner.atomic(()=>f.owner.graph.markUnavailable(a.id));const revoked=await f.core.command('openResource',{resourceId:child.conversation.resourceId,selection:{messageId:a.id}});assert.equal(revoked.status,'unavailable');assert.equal('resource'in revoked,false);assert.equal((await f.core.command('openResource',{resourceId:child.conversation.resourceId})).status,'ready','an unavailable inherited source does not make the independent child unopenable');
  const noteSelection=await f.core.command('openResource',{resourceId:n.id,selection:{messageId:a.id}});assert.equal(noteSelection.status,'unsupported');
  await f.core.command('desktop',{type:'archiveSubject',kind:'resource',id:n.id,expectedVersion:n.version,archived:true});assert.equal((await f.core.command('openResource',{resourceId:n.id})).status,'unavailable');assert.equal(f.calls,0);
 }finally{await f.close();}
});

test('supported task/research/reference/stream kinds keep their real presentation and unsupported kinds never become a note editor',async()=>{
 const f=fixture();try{
  for(const kind of ['task','task_group','research','reference','stream'] as const){const r=await note(f,kind),opened=await f.core.command('openResource',{resourceId:r.id});assert.equal(opened.status,'ready');if(opened.status==='ready')assert.deepEqual(opened.presentation,{kind,mode:'direct'});}
  const n=await note(f);f.db.prepare('UPDATE desktop_resources SET kind=? WHERE resource_id=?').run('synthetic-unreleased-kind',n.id);const baseline=state(f),unsupported=await f.core.command('openResource',{resourceId:n.id});assert.deepEqual(unsupported,{contract:RESOURCE_OPENING_CONTRACT,status:'unsupported',resourceId:n.id,reason:'resource-kind-unsupported',kind:'synthetic-unreleased-kind'});assert.deepEqual(state(f),baseline);assert.equal(f.calls,0);
 }finally{await f.close();}
});

test('opening remains a read during a deterministic pending execution and makes no additional provider connections or revisions',async()=>{
 const f=fixture('wait-interrupt',false);let running:Promise<unknown>|undefined,executionId='';
 try{
  const c=await f.core.command('createConversation',{title:'Synthetic pending execution',providerId:'fixture-codex',commandId:randomUUID()}),n=await note(f),input={resourceId:c.resourceId,content:'Synthetic pending fixture request',expectedRevision:1,commandId:randomUUID()},preview=await f.core.command('conversationSendPreview',input),grant=await f.core.command('authorizeConversationSend',{previewId:preview.id,fingerprint:preview.fingerprint,commandId:input.commandId});
  running=f.core.command('conversationSend',{previewId:preview.id,grantId:grant.grantId,fingerprint:preview.fingerprint,commandId:input.commandId});
  for(let n=0;n<50;n++){const e=Object.values(f.owner.state.executions) as {id:string;turnId:string|null}[];if(e[0]?.turnId){executionId=e[0].id;break;}await new Promise(resolve=>setTimeout(resolve,5));}assert(executionId);
  const baseline=state(f);assert.equal((await f.core.command('openResource',{resourceId:c.resourceId})).status,'ready');assert.equal((await f.core.command('openResource',{resourceId:n.id})).status,'ready');assert.deepEqual(state(f),baseline);
  await f.core.command('interrupt',{executionId});await running;running=undefined;
 }finally{if(running&&executionId){await f.core.command('interrupt',{executionId});await running;}await f.close();}
});
