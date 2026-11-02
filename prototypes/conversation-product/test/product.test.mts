import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { BackendCore } from '../../integrated-backend/src/core.mts';
import type { Snapshot } from '../../integrated-backend/src/contracts.mts';
import type { WorkspaceKernel } from '../../workspace-kernel/kernel.mts';
import type { ConversationGraph, GraphData } from '../../connected-conversations/src/graph.ts';
import { ConversationProduct, type CanonicalConversationHost, type ConversationReadView } from '../src/service.mts';

/** Synthetic source data only. The real canonical core owns all conversation writes. */
function removeFixture(dir:string){const absolute=resolve(dir),rel=relative(resolve(tmpdir()),absolute);assert.ok(rel&&!rel.startsWith('..')&&!isAbsolute(rel)&&rel.startsWith('aerynth-'),'fixture cleanup must stay in the explicitly created temp fixture');rmSync(absolute,{recursive:true,force:true});}
function fixture(path: string) {
 const core=new BackendCore({path,contentPolicy:'synthetic-only',provider:'fixture'});
 const owning=core as unknown as {db:DatabaseSync;kernel:WorkspaceKernel};
 const denied=new Set<string>();let transform:(s:Snapshot)=>Snapshot=s=>s;let rejectExecute=false;
 const host:CanonicalConversationHost={
  snapshot:async()=>transform(await core.command('snapshot',{})),desktop:()=>core.command('desktop',{type:'snapshot'}),
  command:async(name,input)=>{if(rejectExecute&&name==='execute')throw new Error('provider_disconnected');return core.command(name,input);},
  access:(id,messageId)=>!denied.has(messageId??id)&&!denied.has(id),
  organize:async input=>{
   const k=owning.kernel,db=owning.db;
   if(input.type==='createCollection')return k.createCollection(input.title,input.projectId);
   if(input.type==='renameCollection')return k.renameCollection(input.collectionId,input.title,input.expectedVersion);
   if(input.type==='archiveCollection')return k.setCollectionArchived(input.collectionId,input.archived,input.expectedVersion);
   if(input.type==='membership')return k.withTransaction(()=>{const c=db.prepare('SELECT version FROM collections WHERE id=?').get(input.collectionId);assert.equal(c?.version,input.expectedVersion);if(input.member)k.addToCollection(input.collectionId,input.resourceId);else db.prepare('DELETE FROM collection_members WHERE collection_id=? AND resource_id=?').run(input.collectionId,input.resourceId);db.prepare('UPDATE collections SET version=version+1 WHERE id=?').run(input.collectionId);});
   throw new Error('host_operation_unavailable');
  }
 };
 const product=new ConversationProduct(owning.db,host);
 return {core,db:owning.db,host,product,denied,setTransform(fn:typeof transform){transform=fn;},setRejectExecute(){rejectExecute=true;},close:()=>core.command('close',{})};
}
async function record(f:ReturnType<typeof fixture>,id:string,content:string){const detail=await f.product.command('detail',{resourceId:id});return f.core.command('addMessage',{resourceId:id,role:'user',content,expectedRevision:detail.conversation.revision});}
async function create(f:ReturnType<typeof fixture>,title='Synthetic conversation'){return f.product.command('create',{title,commandId:crypto.randomUUID()});}
async function branch(f:ReturnType<typeof fixture>,resourceId:string,messageId:string){const d=await f.product.command('detail',{resourceId});return f.product.command('branch',{resourceId,messageId,includeMessageIds:[messageId],providerId:d.conversation.providerId,title:'Synthetic sibling',commandId:crypto.randomUUID(),tokenBudget:32768,expectedRevision:d.conversation.revision});}

test('canonical IDs, multiple canonical collections, favorites and migrations survive restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'aerynth-conversation-product-')),path=join(dir,'canonical.sqlite');let f=fixture(path);
 try{
  const c=await create(f),m=await record(f,c.resourceId,'A synthetic persistent searchable sentence.');
  const before=await f.core.command('snapshot',{});
  await f.product.command('favorite',{resourceId:c.resourceId,favorite:true});
  for(const title of ['Folder A','Folder B']){const col=await f.product.command('organize',{type:'createCollection',title,projectId:null}) as {id:string;version:number};await f.product.command('organize',{type:'membership',collectionId:col.id,resourceId:c.resourceId,member:true,expectedVersion:col.version});}
  const first=await f.product.command('detail',{resourceId:c.resourceId});assert.equal(first.conversation.collectionIds.length,2);assert.equal(first.messages.items[0].id,m.id);
  assert.deepEqual((await f.core.command('snapshot',{})).graph,before.graph,'metadata never creates a second transcript');
  const tables=f.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'cp_%'").all().map(r=>r.name);assert.ok(!tables.includes('cp_messages'));assert.ok(!tables.includes('cp_conversations'));
  await f.close();f=fixture(path);new ConversationProduct(f.db,f.host);
  const restored=await f.product.command('detail',{resourceId:c.resourceId});assert.equal(restored.conversation.conversationId,first.conversation.conversationId);assert.equal(restored.conversation.favorite,true);assert.equal(restored.messages.items[0].id,m.id);assert.equal(restored.conversation.collectionIds.length,2);
  const found=await f.product.command('search',{text:'persistent searchable'});assert.ok(found.items.some(hit=>hit.resourceId===c.resourceId&&hit.messageId===m.id));
  f.db.prepare('UPDATE cp_schema SET version=99 WHERE id=1').run();assert.throws(()=>new ConversationProduct(f.db,f.host),/unsupported_conversation_product_schema/);assert.equal(f.db.prepare('SELECT version FROM cp_schema WHERE id=1').get()!.version,99);assert.equal((await f.core.command('snapshot',{})).graph.messages[0].id,m.id);f.db.prepare('UPDATE cp_schema SET version=2 WHERE id=1').run();
 }finally{await f.close();removeFixture(dir);}
});

test('forks reuse ancestry IDs and keep later histories independent; adoption has distinct stages',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'aerynth-branch-product-')),f=fixture(join(dir,'canonical.sqlite'));
 try{
  const source=await create(f),origin=await record(f,source.resourceId,'Shared synthetic origin'),child=await branch(f,source.resourceId,origin.id);
  const later=await record(f,source.resourceId,'Sibling discovery after the fork: voltage threshold is 4.'),other=await record(f,child.resourceId,'Independent child investigation');
  const d=await f.product.command('detail',{resourceId:child.resourceId});assert.equal(d.messages.items[0].id,origin.id);assert.equal(d.messages.items[0].inherited,true);assert.ok(d.messages.items.some(m=>m.id===other.id));assert.ok(!d.messages.items.some(m=>m.id===later.id));assert.equal(d.lineage.length,1);
  const share=await f.product.command('publish',{sourceResourceId:source.resourceId,sourceMessageId:later.id,evidence:'reported'});
  const found=await f.product.command('discover',{resourceId:child.resourceId,text:'voltage'});assert.equal(found[0].id,share.id);assert.equal(found[0].state,'discoverable');assert.equal(found[0].content,undefined);
  await assert.rejects(f.product.command('attachShare',{resourceId:child.resourceId,shareId:share.id,attach:true}),/inspect_before_attachment/);
  const inspected=await f.product.command('inspectShare',{resourceId:child.resourceId,shareId:share.id});assert.equal(inspected.state,'inspected');assert.match(inspected.content!,/voltage/);
  const attached=await f.product.command('attachShare',{resourceId:child.resourceId,shareId:share.id,attach:true});assert.equal(attached.state,'attached');assert.equal(attached.content,undefined);
  const context=await f.product.attachedContext(child.resourceId);assert.equal(context.length,1);assert.equal(context[0].sourceMessageId,later.id);
  await assert.rejects(f.product.confirmSupplied(child.resourceId,share.id,'not-a-real-execution'),/execution_context_receipt_required/);
  const final=await f.product.command('detail',{resourceId:child.resourceId});assert.equal(final.messages.total,2);assert.equal(final.shares[0].state,'attached');
  await f.product.command('revokeShare',{shareId:share.id});assert.deepEqual(await f.product.command('discover',{resourceId:child.resourceId}),[]);assert.deepEqual(await f.product.attachedContext(child.resourceId),[]);
 }finally{await f.close();removeFixture(dir);}
});

test('access revocation and source edits prevent search, inspection, and future attachment use',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'aerynth-access-product-')),f=fixture(join(dir,'canonical.sqlite'));
 try{
  const source=await create(f),origin=await record(f,source.resourceId,'Origin'),child=await branch(f,source.resourceId,origin.id),m=await record(f,source.resourceId,'Synthetic restricted-access needle');
  const share=await f.product.command('publish',{sourceResourceId:source.resourceId,sourceMessageId:m.id,evidence:'excerpt'});
  await f.product.command('inspectShare',{resourceId:child.resourceId,shareId:share.id});await f.product.command('attachShare',{resourceId:child.resourceId,shareId:share.id,attach:true});
  f.denied.add(m.id);assert.equal((await f.product.command('search',{text:'restricted-access needle'})).total,0);assert.deepEqual(await f.product.command('discover',{resourceId:child.resourceId}),[]);await assert.rejects(f.product.attachedContext(child.resourceId),/source_unavailable|source_revoked/);
  const detail=await f.product.command('detail',{resourceId:child.resourceId});assert.equal(detail.shares[0].status,'unavailable');assert.equal(detail.shares[0].content,undefined);
  f.denied.delete(m.id);f.setTransform(s=>{const out=structuredClone(s);out.graph.messages.find(msg=>msg.id===m.id)!.content='Source was corrected';return out;});
  assert.equal((await f.product.command('detail',{resourceId:child.resourceId})).shares[0].status,'stale');await assert.rejects(f.product.command('inspectShare',{resourceId:child.resourceId,shareId:share.id}),/source_stale/);await assert.rejects(f.product.attachedContext(child.resourceId),/source_stale/);
  f.setTransform(s=>s);const correction=await record(f,source.resourceId,'Synthetic corrected finding');const replacement=await f.product.command('publish',{sourceResourceId:source.resourceId,sourceMessageId:correction.id,evidence:'observed',supersedes:share.id});
  const superseded=(await f.product.command('detail',{resourceId:source.resourceId})).shares.find(s=>s.id===share.id)!;assert.equal(superseded.status,'superseded');assert.deepEqual(superseded.supersededBy,[replacement.id]);await assert.rejects(f.product.attachedContext(child.resourceId),/source_superseded/);
  await f.product.command('revokeShare',{shareId:replacement.id});assert.equal((await f.product.command('detail',{resourceId:source.resourceId})).shares.find(s=>s.id===share.id)!.status,'superseded','revoking a correction cannot silently reactivate a superseded claim');
 }finally{await f.close();removeFixture(dir);}
});

test('smart collection membership follows canonical content and preserves manual pins; rule conflicts reject',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'aerynth-collection-product-')),f=fixture(join(dir,'canonical.sqlite'));
 try{
  const one=await create(f,'Manual pin'),two=await create(f,'Unmatched');await record(f,two.resourceId,'Synthetic thermal result');
  const col=await f.product.command('organize',{type:'createCollection',title:'Thermal',projectId:null}) as {id:string;version:number};await f.product.command('organize',{type:'membership',collectionId:col.id,resourceId:one.resourceId,member:true,expectedVersion:col.version});
  let collection=(await f.product.command('collections',{}))[0];const input={collectionId:col.id,parentId:null,rule:{text:'thermal'},expectedVersion:collection.version,expectedRuleRevision:0};await f.product.command('collectionRule',input);collection=(await f.product.command('collections',{}))[0];assert.deepEqual(new Set(collection.memberIds),new Set([one.resourceId,two.resourceId]));assert.deepEqual(collection.pinnedIds,[one.resourceId]);assert.equal((await f.product.command('list',{collectionId:col.id})).total,2);
  await assert.rejects(f.product.command('collectionRule',input),/stale_collection_rule/);await assert.rejects(f.product.command('collectionRule',{...input,expectedRuleRevision:1,parentId:col.id}),/folder_cycle/);
 }finally{await f.close();removeFixture(dir);}
});

test('smart conversation rules accept the exact UI mode, reject mixed-resource modes, and do not calculate activity to derive IDs',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'aerynth-smart-rule-mode-')),f=fixture(join(dir,'canonical.sqlite'));
 try{
  const one=await create(f,'Synthetic matching title'),two=await create(f,'Synthetic manual pin');
  const col=await f.product.command('organize',{type:'createCollection',title:'Synthetic smart folder',projectId:null}) as {id:string;version:number};
  await f.product.command('organize',{type:'membership',collectionId:col.id,resourceId:two.resourceId,member:true,expectedVersion:col.version});
  let collection=(await f.product.command('collections',{}))[0],metadataCalls=0;
  const view=(f.core as unknown as {conversationReadView():ConversationReadView}).conversationReadView();
  f.host.canonicalReadView=async()=>({...view,graph:{...view.graph,visibleMessages:view.graph.visibleMessages,visibleMessageMetadata(){metadataCalls++;throw Error('smart IDs must not calculate activity/count');}}});
  const input={collectionId:col.id,parentId:null,rule:{text:'matching title',searchMode:'conversations' as const},expectedVersion:collection.version,expectedRuleRevision:0};
  const saved=await f.product.command('collectionRule',input);collection=saved.find(c=>c.id===col.id)!;
  assert.deepEqual(new Set(collection.memberIds),new Set([one.resourceId,two.resourceId]));assert.deepEqual(collection.pinnedIds,[two.resourceId]);assert.equal(metadataCalls,0);
  for(const mode of ['resources','all','messages'] as const)await assert.rejects(f.product.command('collectionRule',{...input,expectedRuleRevision:1,rule:{...input.rule,searchMode:mode}}),/unsupported_collection_filter/);
  assert.equal((await f.product.command('collections',{}))[0].ruleRevision,1);assert.equal(metadataCalls,0);
 }finally{await f.close();removeFixture(dir);}
});

test('synchronous read batches scope derived projections and authority to one call, then recheck inherited denial and metadata changes',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'aerynth-read-batch-')),f=fixture(join(dir,'canonical.sqlite'));
 try{
  const parent=await create(f,'Synthetic parent'),anchor=await record(f,parent.resourceId,'Synthetic inherited text'),child=await branch(f,parent.resourceId,anchor.id);
  const col=await f.product.command('organize',{type:'createCollection',title:'Synthetic nested metadata',projectId:null}) as {id:string;version:number};
  const owner=f.core as unknown as {conversationReadView():ConversationReadView;kernel:WorkspaceKernel},access=f.host.access!;
  let active=false,batches=0,escaped:ConversationReadView|undefined,checks=0,duplicateChecks=0,asyncReads=0;
  f.host.canonicalReadBatch=<T,>(read:(view:ConversationReadView)=>T):T=>{
   assert.equal(active,false,'nested batch denied');return owner.kernel.withTransaction(()=>{
    active=true;batches++;const memo=new Map<string,boolean>(),calls=new Map<string,number>();
    f.host.access=(id,messageId)=>{assert(active,'closed_read_batch');const key=id+'\0'+(messageId??'');if(memo.has(key))return memo.get(key)!;checks++;calls.set(key,(calls.get(key)??0)+1);const allowed=access(id,messageId);memo.set(key,allowed);return allowed;};
    const current=owner.conversationReadView(),fence=()=>assert(active,'closed_read_batch');
    const view:ConversationReadView={...current,graph:{visibleMessages:id=>{fence();return current.graph.visibleMessages(id);},visibleMessageMetadata:(id,options)=>{fence();return current.graph.visibleMessageMetadata(id,options);}},messageMetadata:id=>{fence();return current.messageMetadata(id);},resourceContent:id=>{fence();return current.resourceContent(id);}};escaped=view;
    try{const result=read(view);assert(!result||typeof (result as {then?:unknown}).then!=='function','async_read_batch');duplicateChecks+=[...calls.values()].filter(n=>n>1).length;return result;}
    finally{active=false;memo.clear();f.host.access=access;}
   });
  };
  f.host.snapshot=async()=>{throw Error('batch must not use snapshot');};f.host.desktop=async()=>{throw Error('batch must not use desktop snapshot');};f.host.canonicalReadView=async()=>{asyncReads++;return owner.conversationReadView();};
  let list=await f.product.command('list',{});assert.equal(list.items.find(c=>c.resourceId===child.resourceId)!.messageCount,1);assert.equal(batches,1);assert(checks>0);assert.equal(duplicateChecks,0);assert.equal(asyncReads,0);
  assert.throws(()=>escaped!.messageMetadata(anchor.id),/closed_read_batch/);assert.throws(()=>escaped!.graph.visibleMessages(escaped!.resourceMap[child.resourceId]),/closed_read_batch/);
  // Caller mutation of detached results is not a retained service projection.
  list.items[0].title='caller mutation';await f.product.command('favorite',{resourceId:child.resourceId,favorite:true});
  list=await f.product.command('list',{favorite:true});assert.deepEqual(list.items.map(c=>c.resourceId),[child.resourceId]);assert.notEqual(list.items[0].title,'caller mutation');assert.equal(batches,2);
  f.denied.add(anchor.id);list=await f.product.command('list',{});const restricted=list.items.find(c=>c.resourceId===child.resourceId)!;assert.equal(restricted.messageCount,null);assert.equal(restricted.lastActivityAt,null);assert.equal(restricted.historyMetadataStatus,'unavailable');assert.equal(batches,3);
  f.denied.delete(anchor.id);assert.equal((await f.product.command('search',{})).items.find(c=>c.resourceId===child.resourceId)!.summary!.messageCount,1);assert.equal(batches,4);
  assert.deepEqual((await f.product.command('collections',{})).find(c=>c.id===col.id)!.memberIds,[]);assert.equal(batches,5);assert.equal(active,false);
  await assert.rejects(f.product.command('list',{sort:'invalid' as never}),/invalid_sort/);assert.equal(active,false);assert.throws(()=>escaped!.messageMetadata(anchor.id),/closed_read_batch/);
  assert.equal((await f.product.command('list',{})).items.find(c=>c.resourceId===child.resourceId)!.messageCount,1,'failed batch does not retain denial or close the next scope');
 }finally{await f.close();removeFixture(dir);}
});

test('provider absence, stale commands, unrelated branches and policy restrictions fail honestly',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'aerynth-provider-product-')),f=fixture(join(dir,'canonical.sqlite'));
 try{
  const providers=await f.product.command('providers',{});assert.equal(providers.find(p=>p.id==='chatgpt')?.available,false);assert.equal(providers[0].execute,false);
  await assert.rejects(f.product.command('create',{title:'Unavailable',providerId:'chatgpt',commandId:crypto.randomUUID()}),/provider_unavailable/);
  const one=await create(f),m=await record(f,one.resourceId,'Local conversation works without AI'),child=await branch(f,one.resourceId,m.id),outside=await create(f,'Unrelated');
  await assert.rejects(f.product.command('send',{resourceId:one.resourceId,content:'Stale',expectedRevision:1,commandId:crypto.randomUUID()}),/stale_resource_version/);
  const codex=await f.product.command('create',{title:'Synthetic disconnected Codex',providerId:'fixture-codex',commandId:crypto.randomUUID()});f.setRejectExecute();
  await assert.rejects(f.product.command('send',{resourceId:codex.resourceId,content:'Must fail without an invented response',expectedRevision:1,commandId:crypto.randomUUID()}),/provider_disconnected/);assert.equal((await f.product.command('detail',{resourceId:codex.resourceId})).messages.total,0);
  const p=(await f.product.command('detail',{resourceId:child.resourceId})).policy;await f.product.command('policy',{...p,expectedRevision:0,allowedSourceIds:[outside.resourceId]});await assert.rejects(f.product.command('policy',{...p,expectedRevision:0}),/stale_policy_version/);
  const s=await f.product.command('publish',{sourceResourceId:one.resourceId,sourceMessageId:m.id,evidence:'excerpt'});assert.deepEqual(await f.product.command('discover',{resourceId:child.resourceId}),[]);await assert.rejects(f.product.command('inspectShare',{resourceId:outside.resourceId,shareId:s.id}),/outside_branch_family/);
  const original=f.host.command;let connections=0;f.host.command=async(name,input)=>{if(name==='capabilities'){connections++;throw new Error('offline');}return original(name,input);};f.host.capabilitySnapshot=()=>undefined;const d=await f.product.command('detail',{resourceId:one.resourceId});await f.product.command('send',{resourceId:one.resourceId,content:'Still local while offline',expectedRevision:d.conversation.revision,commandId:crypto.randomUUID()});assert.equal((await f.product.command('detail',{resourceId:one.resourceId})).messages.total,2);assert.equal(connections,0,'offline history and local recording must not start a provider connection when host supplies snapshot');
 }finally{await f.close();removeFixture(dir);}
});

test('native ChatGPT fidelity metadata cannot promote account history, inference or catalog availability',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'aerynth-chatgpt-fidelity-')),f=fixture(join(dir,'canonical.sqlite'));
 try{
  let capabilityRequests=0;const original=f.host.command;
  f.host.command=async(name,input)=>{if(name==='capabilities')capabilityRequests++;return original(name,input);};
  f.host.capabilitySnapshot=()=>({providerId:'fixture-codex',mock:true,authentication:'available',models:['synthetic-model'],catalogOnly:true,nativeFork:false,chatgptHistory:false});
  const providers=await f.product.command('providers',{}),chatgpt=providers.find(provider=>provider.id==='chatgpt')!;
  assert.deepEqual({available:chatgpt.available,record:chatgpt.record,execute:chatgpt.execute,history:chatgpt.history,models:chatgpt.models},{available:false,record:false,execute:false,history:'unavailable',models:[]});
  assert.equal(chatgpt.accountFidelity!.id,'openai.native-chatgpt-account-fidelity');assert.equal(chatgpt.accountFidelity!.aims.length,13);
  assert.equal(chatgpt.reasonCode,chatgpt.accountFidelity!.reasonCode);assert.equal(chatgpt.reason,chatgpt.accountFidelity!.reason);
  const local=await create(f);await assert.rejects(f.product.command('selectProvider',{resourceId:local.resourceId,providerId:'chatgpt',expectedRevision:1}),/provider_unavailable/);
  await assert.rejects(f.product.command('create',{title:'Unavailable native account',providerId:'chatgpt',commandId:crypto.randomUUID()}),/provider_unavailable/);
  const detail=await f.product.command('detail',{resourceId:local.resourceId});assert.deepEqual(detail.providers.find(provider=>provider.id==='chatgpt')!.accountFidelity,chatgpt.accountFidelity);
  (chatgpt.accountFidelity!.aims[0] as unknown as {status:string}).status='Supported';
  assert.equal((await f.product.command('providers',{})).find(provider=>provider.id==='chatgpt')!.accountFidelity!.aims[0].status,'RequiresAdditionalAuthorization');
  assert.equal(capabilityRequests,0,'metadata/history reads must not initiate a provider connection when cached observations are supplied');
 }finally{await f.close();removeFixture(dir);}
});

test('reserved plan/API provider IDs and foreign cached catalogs never become Codex by provider order',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'aerynth-provider-identity-')),f=fixture(join(dir,'canonical.sqlite'));
 try{
  f.setTransform(snapshot=>{const out=structuredClone(snapshot),template=out.graph.providers.find(p=>p.id==='fixture-codex')!;out.graph.providers.unshift({...template,id:'chatgpt-plan-responses',label:'Plan inference',mock:false},{...template,id:'openai-api-vela',label:'Vela API',mock:false});return out;});
  f.host.capabilitySnapshot=()=>({providerId:'chatgpt-plan-responses',mock:false,authentication:'available',models:['plan-only-model'],catalogOnly:true,nativeFork:false,chatgptHistory:false});
  let providers=await f.product.command('providers',{}),codex=providers.find(p=>p.id==='fixture-codex')!;assert.equal(codex.available,false);assert.equal(codex.execute,false);assert.deepEqual(codex.models,[]);assert.equal(codex.simulated,true);assert.equal(providers.some(p=>p.id==='chatgpt-plan-responses'||p.id==='openai-api-vela'),false,'Graph metadata alone does not register an operational provider');assert.equal(providers.find(p=>p.id==='chatgpt')!.available,false);
  await assert.rejects(f.product.command('create',{title:'Unregistered plan route',providerId:'chatgpt-plan-responses',commandId:crypto.randomUUID()}),/provider_unavailable/);
  f.host.capabilitySnapshot=()=>({providerId:'fixture-codex',mock:true,authentication:'available',models:['synthetic-codex-model'],catalogOnly:true,nativeFork:false,chatgptHistory:false});providers=await f.product.command('providers',{});codex=providers.find(p=>p.id==='fixture-codex')!;assert.equal(codex.available,true);assert.deepEqual(codex.models,['synthetic-codex-model']);
 }finally{await f.close();removeFixture(dir);}
});

test('paged message navigation includes exact hit; resource search honors collection and archive filters',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'aerynth-paging-product-')),f=fixture(join(dir,'canonical.sqlite'));
 try{
  const c=await create(f);const ids:string[]=[];for(let i=0;i<8;i++)ids.push((await record(f,c.resourceId,`Synthetic message ${i}`)).id);
  const first=await f.product.command('detail',{resourceId:c.resourceId,limit:3});assert.equal(first.messages.items.length,3);assert.equal(first.messages.hasMore,true);
  const around=await f.product.command('detail',{resourceId:c.resourceId,aroundMessageId:ids[6],limit:3});assert.ok(around.messages.items.some(m=>m.id===ids[6]));await assert.rejects(f.product.command('detail',{resourceId:c.resourceId,limit:201}),/invalid_page/);
  const desktop=await f.core.command('desktop',{type:'createResource',kind:'note',title:'Synthetic searchable note',workspaceId:null});const note=desktop.resources.find(r=>r.kind==='note')!;
  await f.core.command('desktop',{type:'content',resourceId:note.id,expectedVersion:note.version,content:'Synthetic resource needle'});
  const col=await f.product.command('organize',{type:'createCollection',title:'Notes and conversations',projectId:null}) as {id:string;version:number};await f.product.command('organize',{type:'membership',collectionId:col.id,resourceId:note.id,member:true,expectedVersion:col.version});
  assert.equal((await f.product.command('search',{text:'resource needle',collectionId:col.id})).items[0]?.resourceId,note.id);assert.equal((await f.product.command('search',{text:'resource needle',archived:true})).total,0);
  const exportData=await f.product.command('export',{resourceId:c.resourceId});assert.equal(exportData.detail.messages.total,8);assert.equal(exportData.detail.messages.hasMore,false);
 }finally{await f.close();removeFixture(dir);}
});

test('conversation-first browse, activity/created/title sorts and explicit search modes preserve canonical IDs across restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'aerynth-navigation-product-')),path=join(dir,'canonical.sqlite');let f=fixture(path);
 try{
  const older=await create(f,'Zulu older'),newer=await create(f,'Alpha newer'),message=await record(f,older.resourceId,'Synthetic old-topic exact message needle');
  const desktop=await f.core.command('desktop',{type:'createResource',kind:'note',title:'Synthetic resource needle',workspaceId:null}),note=desktop.resources.find(r=>r.kind==='note')!;
  assert.deepEqual((await f.product.command('list',{})).items.map(c=>c.resourceId),[older.resourceId,newer.resourceId]);
  assert.deepEqual((await f.product.command('list',{sort:'created'})).items.map(c=>c.resourceId),[newer.resourceId,older.resourceId]);
  assert.deepEqual((await f.product.command('list',{sort:'title'})).items.map(c=>c.resourceId),[newer.resourceId,older.resourceId]);
  const browse=await f.product.command('search',{});assert.ok(browse.items.every(hit=>hit.kind==='conversation'));assert.equal(browse.total,2);
  assert.ok((await f.product.command('search',{searchMode:'all'})).items.some(hit=>hit.resourceId===note.id));
  assert.deepEqual((await f.product.command('search',{text:'exact message needle',searchMode:'conversations'})).items.map(hit=>[hit.kind,hit.resourceId]),[['conversation',older.resourceId]]);
  assert.deepEqual((await f.product.command('search',{text:'exact message needle',searchMode:'messages'})).items.map(hit=>[hit.kind,hit.messageId]),[['message',message.id]]);
  assert.deepEqual((await f.product.command('search',{text:'resource needle',searchMode:'resources'})).items.map(hit=>hit.resourceId),[note.id]);
  f.denied.add(message.id);const denied=(await f.product.command('list',{})).items.find(c=>c.resourceId===older.resourceId)!;assert.equal(denied.messageCount,null);assert.equal(denied.lastActivityAt,null);assert.equal(denied.historyMetadataStatus,'unavailable');assert.equal((await f.product.command('search',{text:'exact message needle'})).total,0);f.denied.delete(message.id);
  const before=await f.product.command('list',{});await f.close();f=fixture(path);assert.deepEqual(await f.product.command('list',{}),before);assert.equal((await f.product.command('detail',{resourceId:older.resourceId,aroundMessageId:message.id})).messages.items[0].id,message.id);
  await assert.rejects(f.product.command('list',{sort:'guessed' as never}),/invalid_sort/);await assert.rejects(f.product.command('search',{searchMode:'guessed' as never}),/invalid_search_mode/);
 }finally{await f.close();removeFixture(dir);}
});

test('trusted same-graph metadata browse avoids snapshot/transcript cloning and fails closed on newly denied inherited sources',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'aerynth-read-view-product-')),f=fixture(join(dir,'canonical.sqlite'));let restore:()=>void=()=>{};
 try{
  const parent=await create(f,'Canonical parent'),anchor=await record(f,parent.resourceId,'Synthetic inherited source'),child=await branch(f,parent.resourceId,anchor.id),snapshot=await f.core.command('snapshot',{}),desktop=await f.core.command('desktop',{type:'snapshot'});
  const graph=(f.core as unknown as {graph:ConversationGraph}).graph,originalVisible=graph.visibleMessages,originalSnapshot=graph.snapshot;let clones=0,bodyReads=0;
  const headers=new Map(snapshot.graph.messages.map(m=>[m.id,{id:m.id,conversationId:m.conversationId,createdAt:m.createdAt}]));
  f.host.canonicalReadView=async()=>({conversations:snapshot.conversations,resourceMap:snapshot.resourceMap,graph,graphMetadata:{providers:snapshot.graph.providers,conversations:snapshot.graph.conversations,edges:snapshot.graph.edges,unavailableMessageIds:snapshot.graph.unavailableMessageIds},executions:{},desktop:{projects:desktop.projects,workspaces:desktop.workspaces,blocks:desktop.blocks,resources:desktop.resources.map(({id,kind,title,version,state,visible,available,project_id})=>({id,kind,title,version,state,visible,available,project_id}))},messageMetadata:id=>headers.get(id)??null,resourceContent:()=>{throw new Error('metadata browse must not request resource bodies');}});
  f.host.snapshot=async()=>{throw new Error('full snapshot forbidden');};f.host.desktop=async()=>{throw new Error('full desktop forbidden');};graph.visibleMessages=()=>{clones++;throw new Error('transcript cloning forbidden');};graph.snapshot=()=>{throw new Error('graph cloning forbidden');};
  const source=(graph as unknown as {data:GraphData}).data.messages.find(m=>m.id===anchor.id)!,content=Object.getOwnPropertyDescriptor(source,'content')!;
  restore=()=>{graph.visibleMessages=originalVisible;graph.snapshot=originalSnapshot;Object.defineProperty(source,'content',content);};
  const first=await f.product.command('list',{});assert.equal(first.items.find(c=>c.resourceId===child.resourceId)!.messageCount,1);assert.equal(clones,0);
  Object.defineProperty(source,'content',{configurable:true,get(){bodyReads++;throw new Error('denied source body read');}});f.denied.add(parent.resourceId);
  const current=await f.product.command('list',{});assert.equal(current.items.some(c=>c.resourceId===parent.resourceId),false);const visibleChild=current.items.find(c=>c.resourceId===child.resourceId)!;assert.equal(visibleChild.messageCount,null);assert.equal(visibleChild.lastActivityAt,null);assert.equal(visibleChild.historyMetadataStatus,'unavailable');assert.equal(bodyReads,0);assert.equal(clones,0);
 }finally{restore();await f.close();removeFixture(dir);}
});
