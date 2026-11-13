import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { BackendCore } from '../../integrated-backend/src/core.mts';
import { WorkspaceKernel } from '../../workspace-kernel/kernel.mts';
import type { ConversationGraph } from '../../connected-conversations/src/graph.ts';
import { ConversationProduct, type CanonicalConversationHost, type ConversationReadView } from '../src/service.mts';
import { CONVERSATION_VIEW_LIMITS as limits, type ProductCommandMap } from '../src/contracts.ts';
import { ConversationViewPersistence } from '../src/view-persistence.ts';

function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'aerynth-view-state-')),path=join(dir,'canonical.sqlite'),core=new BackendCore({path,contentPolicy:'synthetic-only',provider:'fixture'});
 const owner=core as unknown as {db:DatabaseSync;kernel:WorkspaceKernel;graph:ConversationGraph;conversationReadView():ConversationReadView;conversationReadAccess(id:string,messageId?:string):boolean;canonicalConversationReadBatch<T>(read:(view:ConversationReadView)=>T):T};
 const deniedResources=new Set<string>(),deniedMessages=new Set<string>(),host:CanonicalConversationHost={snapshot:()=>core.command('snapshot',{}),desktop:()=>core.command('desktop',{type:'snapshot'}),canonicalReadView:async()=>owner.conversationReadView(),canonicalReadBatch:read=>owner.canonicalConversationReadBatch(read),command:(name,input)=>core.command(name,input),organize:async()=>{throw Error('not_needed');},access:(id,messageId)=>!deniedResources.has(id)&&!deniedMessages.has(messageId??'')&&owner.conversationReadAccess(id,messageId)};
 let closed=false;const close=async()=>{if(!closed){await core.command('close',{});closed=true;}};
 const cleanup=async()=>{await close();const target=resolve(dir),rel=relative(resolve(tmpdir()),target);assert(rel&&!rel.startsWith('..')&&!isAbsolute(rel)&&rel.startsWith('aerynth-view-state-'));rmSync(target,{recursive:true,force:true});};
 const create=(title='SYNTHETIC manual title')=>core.command('createConversation',{title,providerId:'local',commandId:crypto.randomUUID()});
 return {core,owner,db:owner.db,kernel:owner.kernel,host,path,product:new ConversationProduct(owner.db,host),deniedResources,deniedMessages,close,cleanup,create};
}
type Fixture=ReturnType<typeof fixture>;
const manualTitle='SYNTHETIC manual title',draftText='SYNTHETIC 🧭 draft with exact UTF16 selection',messageText='SYNTHETIC canonical transcript anchor';
async function seed(f:Fixture){
 const c=await f.create(),m=await f.core.command('addMessage',{resourceId:c.resourceId,role:'user',content:messageText,expectedRevision:1}),draft=await f.product.command('saveDraft',{resourceId:c.resourceId,expectedVersion:0,content:draftText});
 const input:ProductCommandMap['saveViewState']['input']={resourceId:c.resourceId,expectedVersion:0,position:{conversationRevision:2,anchor:{messageId:m.id,offsetY:-23.5}},selection:{draftVersion:draft.version,start:10,end:12,direction:'backward'}};
 return {c,m,draft,input};
}

test('schema2 upgrades additively and same-file restart preserves exact view, draft, IDs, title and separate Constellation row',async()=>{
 const f=fixture();let reopened:WorkspaceKernel|undefined;try{
  const {c,draft,input}=await seed(f),constellation={schema:'aerynth.constellation@1',anchors:{},bookmarks:[],history:[]};await f.core.command('viewState',{state:constellation});
  f.db.exec('DROP TABLE cp_view_selection; DROP TABLE cp_views; ALTER TABLE cp_drafts DROP COLUMN documents_json; UPDATE cp_schema SET version=2 WHERE id=1');
  const before=await f.core.command('snapshot',{}),desktop=await f.core.command('desktop',{type:'snapshot'}),integration=f.db.prepare('SELECT json FROM integration_state WHERE id=1').get()!.json,viewState=f.db.prepare('SELECT json FROM desktop_view_state WHERE id=1').get()!.json;
  const product=new ConversationProduct(f.db,f.host);assert.equal(f.db.prepare('SELECT version FROM cp_schema').get()!.version,4);assert.deepEqual(await product.command('readDraft',{resourceId:c.resourceId}),draft);
  assert.deepEqual(await product.command('readViewState',{}),{contract:'aerynth.conversation-view@1',selected:{version:0,resourceId:null,updatedAt:null},view:null});
  const selected=await product.command('selectView',{resourceId:c.resourceId,expectedVersion:0}),view=await product.command('saveViewState',input);
  assert.equal(view.positionStatus,'current');assert.equal(view.selectionStatus,'current');assert.equal(draftText.slice(view.selection!.start,view.selection!.end),'🧭');
  const row=f.db.prepare('SELECT json FROM cp_views WHERE resource_id=?').get(c.resourceId)!;assert.deepEqual(JSON.parse(String(row.json)),{position:input.position,selection:input.selection});assert(!String(row.json).includes(draftText)&&!String(row.json).includes(messageText)&&!String(row.json).includes(manualTitle));
  assert.deepEqual((await f.core.command('snapshot',{})).graph,before.graph);assert.equal(f.db.prepare('SELECT json FROM integration_state WHERE id=1').get()!.json,integration);assert.equal(f.db.prepare('SELECT json FROM desktop_view_state WHERE id=1').get()!.json,viewState);
  await f.close();reopened=WorkspaceKernel.openExisting(f.path);let db!:DatabaseSync;reopened.withTransaction(connection=>{db=connection;});
  const restored=new ConversationProduct(db,{...f.host,canonicalReadView:undefined,canonicalReadBatch:undefined,snapshot:async()=>before,desktop:async()=>desktop,access:(id,messageId)=>id===c.resourceId&&(!messageId||messageId===input.position!.anchor!.messageId)});
  assert.deepEqual(await restored.command('readViewState',{}),{contract:'aerynth.conversation-view@1',selected,view});assert.deepEqual(await restored.command('readDraft',{resourceId:c.resourceId}),draft);
  assert.equal(db.prepare('SELECT title FROM resources WHERE id=?').get(c.resourceId)!.title,manualTitle);assert.equal(db.prepare('SELECT json FROM desktop_view_state WHERE id=1').get()!.json,viewState);assert.equal(db.prepare('SELECT json FROM integration_state WHERE id=1').get()!.json,integration);
  db.exec('UPDATE cp_schema SET version=99');assert.throws(()=>new ConversationProduct(db,{...f.host}),/unsupported_conversation_product_schema/);assert.deepEqual(db.prepare('SELECT json FROM cp_views WHERE resource_id=?').get(c.resourceId),row);assert.equal(db.prepare('SELECT version FROM cp_schema').get()!.version,99);
 }finally{reopened?.close();await f.cleanup();}
});

test('per-chat view CAS and selected chat CAS are independent and explicit clears remain monotonic tombstones',async()=>{
 const f=fixture();try{
  const {c,input}=await seed(f),other=await f.create('SYNTHETIC second chat');
  const selected=await f.product.command('selectView',{resourceId:c.resourceId,expectedVersion:0});const first=await f.product.command('saveViewState',input);
  const second=await f.product.command('saveViewState',{resourceId:other.resourceId,expectedVersion:0,position:null,selection:null});assert.equal(second.version,1);assert.deepEqual((await f.product.command('readViewState',{})).selected,selected);
  await assert.rejects(f.product.command('saveViewState',input),/stale_conversation_view_version/);await assert.rejects(f.product.command('selectView',{resourceId:other.resourceId,expectedVersion:0}),/stale_conversation_view_selection_version/);
  const empty=await f.product.command('saveViewState',{resourceId:c.resourceId,expectedVersion:first.version,position:null,selection:null});assert.equal(empty.version,2);assert.equal(empty.position,null);assert.equal(empty.selection,null);assert.equal(empty.positionStatus,'none');assert.equal(empty.selectionStatus,'none');
  const unselected=await f.product.command('selectView',{resourceId:null,expectedVersion:selected.version});assert.equal(unselected.version,2);assert.equal(unselected.resourceId,null);assert.equal((await f.product.command('readViewState',{})).view,null);
  assert.deepEqual((await f.product.command('readViewState',{resourceId:c.resourceId})).view,empty);await assert.rejects(f.product.command('saveViewState',input),/stale_conversation_view_version/);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM cp_views').get()!.n,2);
 }finally{await f.cleanup();}
});

test('draft acknowledgement version is exact, stale selection is pruned read-only, and an unchanged authorized anchor revalidates after history advances',async()=>{
 const f=fixture();try{
  const {c,draft,input}=await seed(f),first=await f.product.command('saveViewState',input),oldRow=f.db.prepare('SELECT json FROM cp_views WHERE resource_id=?').get(c.resourceId);
  const later=await f.product.command('saveDraft',{resourceId:c.resourceId,expectedVersion:draft.version,content:'SYNTHETIC new unsent edit'});
  await f.core.command('addMessage',{resourceId:c.resourceId,role:'user',content:'SYNTHETIC new history',expectedRevision:2});
  const read=(await f.product.command('readViewState',{resourceId:c.resourceId})).view!;assert.equal(read.version,first.version);assert.equal(read.selection,null);assert.equal(read.selectionStatus,'draft-changed');assert.equal(read.positionStatus,'anchor-revalidated');assert.equal(read.position?.conversationRevision,3);assert.deepEqual(read.position?.anchor,first.position?.anchor);assert.deepEqual(f.db.prepare('SELECT json FROM cp_views WHERE resource_id=?').get(c.resourceId),oldRow);
  await assert.rejects(f.product.command('saveViewState',{...input,expectedVersion:first.version,position:read.position}),/stale_view_draft_version/);
  await assert.rejects(f.product.command('saveViewState',{...input,expectedVersion:first.version,selection:null}),/stale_view_conversation_revision/);
  await assert.rejects(f.product.command('saveViewState',{...input,expectedVersion:first.version,position:read.position,selection:{draftVersion:later.version,start:0,end:later.content.length+1,direction:'forward'}}),/invalid_conversation_view_selection/);
  const next=await f.product.command('saveViewState',{...input,expectedVersion:first.version,position:read.position,selection:{draftVersion:later.version,start:0,end:9,direction:'forward'}});assert.equal(next.version,2);assert.equal(next.selection?.draftVersion,later.version);assert.deepEqual(await f.product.command('readDraft',{resourceId:c.resourceId}),later);
 }finally{await f.cleanup();}
});

test('a capture retired by a canonical message append leaves navigation and the next capture usable',async()=>{
 const f=fixture();let release!:()=>void;
 const gate=new Promise<void>(resolve=>release=resolve);
 try{
  const {c,draft,input}=await seed(f),first=await f.product.command('saveViewState',input);
  const readStored=()=>f.db.prepare('SELECT version,json FROM cp_views WHERE resource_id=?').get(c.resourceId);
  const original=readStored();let entered!:()=>void;const saving=new Promise<void>(resolve=>entered=resolve);
  const attempts:number[]=[];let rejected:unknown;
  const persistence=new ConversationViewPersistence({port:{
   async command(name,request){
    if(name==='saveViewState'){
     attempts.push((request as ProductCommandMap['saveViewState']['input']).position!.conversationRevision);
     if(attempts.length===1){entered();await gate;}
    }
    try{return await f.product.command(name,request);}catch(error){rejected=error;throw error;}
   },
  }});
  await persistence.restore(c.resourceId);
  const capture={resourceId:c.resourceId,position:{...input.position!,anchor:{...input.position!.anchor!,offsetY:19}},selection:input.selection,draftReady:true};
  persistence.remember(capture);
  await saving;
  const appended=await f.core.command('addMessage',{resourceId:c.resourceId,role:'user',content:'SYNTHETIC append during view save',expectedRevision:2});
  release();
  await persistence.flush();
  const destination={kind:'constellation' as const,projectId:null};
  const arrived=await f.core.command('desktop',{type:'navigate',target:destination});
  assert.deepEqual(arrived.navigation,destination);
  assert.match(String(rejected),/stale_view_conversation_revision/);
  assert.deepEqual(readStored(),original);
  assert.deepEqual(await f.product.command('readDraft',{resourceId:c.resourceId}),draft);
  assert.deepEqual(attempts,[2]);
  persistence.remember({...capture,position:{conversationRevision:3,anchor:{messageId:appended.id,offsetY:5}}});
  await persistence.flush();
  const next=(await f.product.command('readViewState',{resourceId:c.resourceId})).view!;
  assert.equal(next.version,first.version+1);
  assert.equal(next.position?.anchor?.messageId,appended.id);
  assert.deepEqual(attempts,[2,3]);
 }finally{release();await f.cleanup();}
});

test('unrelated/inherited/revoked anchors and denied or archived selected resources cannot disclose old IDs or erase metadata',async()=>{
 const f=fixture();try{
  const {c,m,input}=await seed(f),other=await f.create('SYNTHETIC unrelated chat');
  await assert.rejects(f.product.command('saveViewState',{...input,resourceId:other.resourceId,position:{conversationRevision:1,anchor:input.position!.anchor},selection:null}),/view_anchor_unavailable/);
  const branch=await f.core.command('branch',{resourceId:c.resourceId,messageId:m.id,includeMessageIds:[m.id],providerId:'local',title:'SYNTHETIC inherited view',commandId:crypto.randomUUID(),tokenBudget:32768});const child=branch.conversation.resourceId;
  const view=await f.product.command('saveViewState',{resourceId:child,expectedVersion:0,position:{conversationRevision:1,anchor:input.position!.anchor},selection:null});const selected=await f.product.command('selectView',{resourceId:child,expectedVersion:0});
  f.deniedResources.add(c.resourceId);const denied=(await f.product.command('readViewState',{})).view!;assert.equal(denied.position,null);assert.equal(denied.positionStatus,'unavailable');assert(!JSON.stringify(denied).includes(m.id));
  await assert.rejects(f.product.command('saveViewState',{resourceId:child,expectedVersion:view.version,position:view.position,selection:null}),/view_anchor_unavailable/);
  f.deniedResources.delete(c.resourceId);assert.deepEqual((await f.product.command('readViewState',{})).view,view);f.deniedMessages.add(m.id);assert.equal((await f.product.command('readViewState',{})).view!.position,null);f.deniedMessages.delete(m.id);
  f.deniedResources.add(child);const hidden=await f.product.command('readViewState',{});assert.deepEqual(hidden.selected,{version:selected.version,resourceId:null,updatedAt:null});assert.equal(hidden.view,null);assert(!JSON.stringify(hidden).includes(child));await assert.rejects(f.product.command('readViewState',{resourceId:child}),/source_unavailable/);f.deniedResources.delete(child);
  const resource=f.kernel.getResource(child).resource;f.kernel.setResourceArchived(child,true,resource.version);assert.equal((await f.product.command('readViewState',{})).view,null);await assert.rejects(f.product.command('selectView',{resourceId:child,expectedVersion:selected.version}),/source_unavailable/);f.kernel.setResourceArchived(child,false,resource.version+1);
  assert.deepEqual((await f.product.command('readViewState',{})).view,view);f.owner.graph.markUnavailable(m.id);assert.equal((await f.product.command('readViewState',{})).view!.position,null);assert.equal(f.db.prepare('SELECT version FROM cp_views WHERE resource_id=?').get(child)!.version,view.version);
 }finally{await f.cleanup();}
});

test('view operations are bodyless projections with explicit authority, no provider/Graph/content calls or extra writes on read',async()=>{
 const f=fixture();try{
  const {c,input}=await seed(f);let forbidden=0;const fail=()=>{forbidden++;throw Error('view_must_not_read_body_or_connect');};
  const projection=(view:ConversationReadView):ConversationReadView=>({...view,graph:{visibleMessages:fail,visibleMessageMetadata:fail},resourceContent:fail});
  const host:CanonicalConversationHost={...f.host,snapshot:fail,desktop:fail,command:fail,canonicalReadView:async()=>projection(f.owner.conversationReadView()),canonicalReadBatch:read=>f.owner.canonicalConversationReadBatch(view=>read(projection(view)))};
  const product=new ConversationProduct(f.db,host);await product.command('selectView',{resourceId:c.resourceId,expectedVersion:0});const saved=await product.command('saveViewState',input),before=f.db.prepare('SELECT total_changes() AS n').get()!.n;
  assert.deepEqual((await product.command('readViewState',{})).view,saved);assert.equal(f.db.prepare('SELECT total_changes() AS n').get()!.n,before);assert.equal(forbidden,0);
  const denied=new ConversationProduct(f.db,{...host,access:undefined});assert.equal((await denied.command('readViewState',{})).selected.resourceId,null);await assert.rejects(denied.command('readViewState',{resourceId:c.resourceId}),/source_unavailable/);
  let checks=0;const recheck=new ConversationProduct(f.db,{...host,access:(id,m)=>id!==c.resourceId||m!==undefined||++checks<=2});await assert.rejects(recheck.command('saveViewState',{...input,expectedVersion:saved.version}),/source_unavailable/);assert.deepEqual((await product.command('readViewState',{})).view,saved);
 }finally{await f.cleanup();}
});

test('exact bounded metadata rejects text/raw scroll/invalid UTF16 bounds and full storage does not evict another view',async()=>{
 const f=fixture();try{
  const {c,input}=await seed(f);for(const bad of [{...input,content:'duplicate draft'}, {...input,position:{...input.position,scrollTop:50}}, {...input,position:{conversationRevision:2,anchor:{messageId:'x'.repeat(257),offsetY:0}}}, {...input,position:{conversationRevision:2,anchor:{messageId:'message',offsetY:Infinity}}}, {...input,selection:{...input.selection,start:12,end:10}}, {...input,selection:{...input.selection,direction:'other'}}, {...input,expectedVersion:-1}])await assert.rejects(f.product.command('saveViewState',bad as typeof input),/invalid_conversation_view/);
  // Bounded fixture-only capacity seeding. No second graph/conversation is used by product.
  const json=JSON.stringify({position:null,selection:null});f.db.exec(`WITH RECURSIVE n(i) AS(SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<${limits.records}) INSERT INTO resources(id,kind,title,created_at,updated_at) SELECT 'synthetic-view-cap-'||i,'conversation','SYNTHETIC capacity row','2026-11-02','2026-11-02' FROM n`);
  f.db.prepare("INSERT INTO cp_views(resource_id,version,json,bytes,updated_at) SELECT id,1,?,?,'2026-11-02' FROM resources WHERE id LIKE 'synthetic-view-cap-%'").run(json,Buffer.byteLength(json));
  await assert.rejects(f.product.command('saveViewState',input),/conversation_view_capacity_exceeded/);assert.equal((await f.product.command('readViewState',{resourceId:c.resourceId})).view!.version,0);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM cp_views').get()!.n,limits.records);
  assert.throws(()=>f.db.prepare("INSERT INTO cp_views(resource_id,version,json,bytes,updated_at) VALUES(?,1,?,?,'2026-11-02')").run(c.resourceId,'x'.repeat(limits.entryBytes+1),limits.entryBytes+1),/CHECK constraint/);
  f.db.exec("DELETE FROM cp_views WHERE resource_id LIKE 'synthetic-view-cap-%'");
  const large=JSON.stringify({position:{conversationRevision:1,anchor:{messageId:'界'.repeat(limits.idUnits),offsetY:0}},selection:null}),bytes=Buffer.byteLength(large),count=Math.floor(limits.aggregateBytes/bytes),remainder=limits.aggregateBytes-count*bytes;assert(count<limits.records&&bytes+remainder<=limits.entryBytes);
  f.db.prepare("INSERT INTO cp_views(resource_id,version,json,bytes,updated_at) SELECT id,1,?,?,'2026-11-02' FROM resources WHERE id LIKE 'synthetic-view-cap-%' ORDER BY id LIMIT ?").run(large,bytes,count);
  f.db.prepare("UPDATE cp_views SET json=json||?,bytes=bytes+? WHERE resource_id='synthetic-view-cap-1'").run(' '.repeat(remainder),remainder);
  assert.equal(f.db.prepare('SELECT SUM(bytes) AS n FROM cp_views').get()!.n,limits.aggregateBytes);await assert.rejects(f.product.command('saveViewState',input),/conversation_view_capacity_exceeded/);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM cp_views').get()!.n,count);
 }finally{await f.cleanup();}
});
