import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { BackendCore } from '../../integrated-backend/src/core.mts';
import type { Snapshot } from '../../integrated-backend/src/contracts.mts';
import type { WorkspaceKernel } from '../../workspace-kernel/kernel.mts';
import { ConversationProduct, type CanonicalConversationHost } from '../src/service.mts';

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
