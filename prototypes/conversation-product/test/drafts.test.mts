import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { BackendCore } from '../../integrated-backend/src/core.mts';
import { WorkspaceKernel } from '../../workspace-kernel/kernel.mts';
import { ConversationProduct, type CanonicalConversationHost } from '../src/service.mts';
import { CONVERSATION_DRAFT_LIMITS as limits } from '../src/contracts.ts';

function cleanup(dir:string){const absolute=resolve(dir),rel=relative(resolve(tmpdir()),absolute);assert(rel&&!rel.startsWith('..')&&!isAbsolute(rel)&&rel.startsWith('aerynth-drafts-'));rmSync(absolute,{recursive:true,force:true});}
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'aerynth-drafts-')),path=join(dir,'canonical.sqlite'),core=new BackendCore({path,contentPolicy:'synthetic-only',provider:'fixture'});
 const owning=core as unknown as {db:DatabaseSync;kernel:WorkspaceKernel},denied=new Set<string>();
 const host:CanonicalConversationHost={snapshot:()=>core.command('snapshot',{}),desktop:()=>core.command('desktop',{type:'snapshot'}),command:(name,input)=>core.command(name,input),access:id=>!denied.has(id),organize:async()=>{throw Error('not_needed');}};
 const product=new ConversationProduct(owning.db,host);
 return {dir,path,core,...owning,denied,host,product,create:(title='Synthetic draft conversation')=>core.command('createConversation',{title,providerId:'local',commandId:crypto.randomUUID()}),close:()=>core.command('close',{})};
}

test('v1 migration preserves canonical IDs and metadata; unknown versions never reset draft state',async()=>{
 const f=fixture();try{
  const c=await f.create(),m=await f.core.command('addMessage',{resourceId:c.resourceId,role:'user',content:'Synthetic durable source',expectedRevision:1});
  await f.product.command('favorite',{resourceId:c.resourceId,favorite:true});
  const share=await f.product.command('publish',{sourceResourceId:c.resourceId,sourceMessageId:m.id,evidence:'excerpt'}),before=await f.core.command('snapshot',{});
  // Exact v1 table layout: v2's empty draft table is absent, all v1 records survive.
  f.db.exec('DROP TABLE cp_drafts; UPDATE cp_schema SET version=1 WHERE id=1');
  const upgraded=new ConversationProduct(f.db,f.host);assert.equal(f.db.prepare('SELECT version FROM cp_schema').get()!.version,2);
  assert.deepEqual(await upgraded.command('readDraft',{resourceId:c.resourceId}),{resourceId:c.resourceId,version:0,content:'',updatedAt:null});
  assert.equal((await upgraded.command('detail',{resourceId:c.resourceId})).conversation.favorite,true);assert.equal((await upgraded.command('detail',{resourceId:c.resourceId})).shares[0].id,share.id);assert.deepEqual((await f.core.command('snapshot',{})).graph,before.graph);
  const draft=await upgraded.command('saveDraft',{resourceId:c.resourceId,expectedVersion:0,content:'Synthetic retained draft'});
  f.db.prepare('UPDATE cp_schema SET version=99').run();assert.throws(()=>new ConversationProduct(f.db,f.host),/unsupported_conversation_product_schema/);assert.equal(f.db.prepare('SELECT content FROM cp_drafts WHERE resource_id=?').get(c.resourceId)!.content,draft.content);assert.equal(f.db.prepare('SELECT version FROM cp_schema').get()!.version,99);f.db.prepare('UPDATE cp_schema SET version=2').run();
  assert.deepEqual(await new ConversationProduct(f.db,f.host).command('readDraft',{resourceId:c.resourceId}),draft);
 }finally{await f.close();cleanup(f.dir);}
});

test('draft CAS, same-content writes and empty tombstones are monotonic across a real SQLite connection restart',async()=>{
 const f=fixture();let closed=false,reopened:WorkspaceKernel|undefined;try{
  const c=await f.create(),virgin=await f.create('Synthetic empty draft tombstone'),initialEmpty=await f.product.command('saveDraft',{resourceId:virgin.resourceId,expectedVersion:0,content:''});assert.equal(initialEmpty.version,1);await assert.rejects(f.product.command('saveDraft',{resourceId:virgin.resourceId,expectedVersion:0,content:'Stale absent writer'}),/stale_draft_version/);const graphBefore=(await f.core.command('snapshot',{})).graph;
  const first=await f.product.command('saveDraft',{resourceId:c.resourceId,expectedVersion:0,content:'  Synthetic unsent text\n\t🙂\0end  '});assert.equal(first.version,1);
  const same=await f.product.command('saveDraft',{resourceId:c.resourceId,expectedVersion:1,content:first.content});assert.equal(same.version,2);
  await assert.rejects(f.product.command('saveDraft',{resourceId:c.resourceId,expectedVersion:1,content:'Lost update'}),/stale_draft_version/);assert.deepEqual(await f.product.command('readDraft',{resourceId:c.resourceId}),same);
  const empty=await f.product.command('saveDraft',{resourceId:c.resourceId,expectedVersion:2,content:''});assert.equal(empty.version,3);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM cp_drafts WHERE resource_id=?').get(c.resourceId)!.n,1);
  await assert.rejects(f.product.command('saveDraft',{resourceId:c.resourceId,expectedVersion:0,content:'ABA stale writer'}),/stale_draft_version/);
  const snapshot=await f.core.command('snapshot',{}),desktop=await f.core.command('desktop',{type:'snapshot'}),canonicalJson=String(f.db.prepare('SELECT json FROM integration_state WHERE id=1').get()!.json);assert.deepEqual(snapshot.graph,graphBefore);
  await f.close();closed=true;
  // Reopen the SAME canonical file/connection through its kernel owner. The read-only
  // cached host snapshots remain exact because no canonical mutation occurs here.
  reopened=WorkspaceKernel.openExisting(f.path);let db!:DatabaseSync;reopened.withTransaction(connection=>{db=connection;});
  assert.equal(String(db.prepare('SELECT json FROM integration_state WHERE id=1').get()!.json),canonicalJson);
  const product=new ConversationProduct(db,{...f.host,snapshot:async()=>snapshot,desktop:async()=>desktop});assert.deepEqual(await product.command('readDraft',{resourceId:c.resourceId}),empty);
  const next=await product.command('saveDraft',{resourceId:c.resourceId,expectedVersion:3,content:'Synthetic after restart'});assert.equal(next.version,4);assert.equal(next.resourceId,c.resourceId);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM resources WHERE id=?').get(c.resourceId)!.n,1);assert.equal(String(db.prepare('SELECT json FROM integration_state WHERE id=1').get()!.json),canonicalJson);
 }finally{reopened?.close();if(!closed)await f.close();cleanup(f.dir);}
});

test('active conversation authorization gates reads and writes without deleting archived or revoked drafts',async()=>{
 const f=fixture();try{
  const c=await f.create(),draft=await f.product.command('saveDraft',{resourceId:c.resourceId,expectedVersion:0,content:'Synthetic scoped private draft'});
  f.denied.add(c.resourceId);await assert.rejects(f.product.command('readDraft',{resourceId:c.resourceId}),/source_unavailable/);await assert.rejects(f.product.command('saveDraft',{resourceId:c.resourceId,expectedVersion:1,content:''}),/source_unavailable/);assert.equal(f.db.prepare('SELECT content FROM cp_drafts WHERE resource_id=?').get(c.resourceId)!.content,draft.content);
  f.denied.delete(c.resourceId);f.kernel.setResourceArchived(c.resourceId,true,1);await assert.rejects(f.product.command('readDraft',{resourceId:c.resourceId}),/source_unavailable/);await assert.rejects(f.product.command('saveDraft',{resourceId:c.resourceId,expectedVersion:1,content:''}),/source_unavailable/);f.kernel.setResourceArchived(c.resourceId,false,2);assert.deepEqual(await f.product.command('readDraft',{resourceId:c.resourceId}),draft);
  const note=f.kernel.createNote('Synthetic non-conversation','');await assert.rejects(f.product.command('readDraft',{resourceId:note.id}),/source_unavailable/);await assert.rejects(f.product.command('readDraft',{resourceId:'missing'}),/source_unavailable/);
  let reads=0;const revoking=new ConversationProduct(f.db,{...f.host,access:id=>id!==c.resourceId||++reads===1});await assert.rejects(revoking.command('saveDraft',{resourceId:c.resourceId,expectedVersion:1,content:'Denied at mutation boundary'}),/source_unavailable/);assert.deepEqual(await f.product.command('readDraft',{resourceId:c.resourceId}),draft);
 }finally{await f.close();cleanup(f.dir);}
});

test('draft content and aggregate byte capacity reject losslessly; explicit empty saves reclaim only text capacity',async()=>{
 const f=fixture();try{
  const first=await f.create();await assert.rejects(f.product.command('saveDraft',{resourceId:first.resourceId,expectedVersion:-1,content:''}),/invalid_draft_version/);await assert.rejects(f.product.command('saveDraft',{resourceId:first.resourceId,expectedVersion:0,content:'x'.repeat(limits.contentUnits+1)}),/invalid_draft_content/);await assert.rejects(f.product.command('saveDraft',{resourceId:first.resourceId,expectedVersion:0,content:'\ud800'}),/invalid_draft_content/);
  const content='界'.repeat(limits.contentUnits),count=Math.floor(limits.aggregateBytes/Buffer.byteLength(content));const ids=[first.resourceId];
  for(let i=1;i<count+2;i++)ids.push((await f.create('Synthetic aggregate '+i)).resourceId);
  for(let i=0;i<count;i++)await f.product.command('saveDraft',{resourceId:ids[i],expectedVersion:0,content});
  const remainder='🙂'.repeat((limits.aggregateBytes-count*Buffer.byteLength(content))/4);await f.product.command('saveDraft',{resourceId:ids[count],expectedVersion:0,content:remainder});assert.equal(f.db.prepare('SELECT SUM(content_bytes) AS bytes FROM cp_drafts').get()!.bytes,limits.aggregateBytes);
  await assert.rejects(f.product.command('saveDraft',{resourceId:ids[count+1],expectedVersion:0,content:'x'}),/draft_capacity_exceeded/);assert.equal((await f.product.command('readDraft',{resourceId:ids[count+1]})).version,0);assert.equal((await f.product.command('readDraft',{resourceId:ids[0]})).content,content);
  const empty=await f.product.command('saveDraft',{resourceId:ids[0],expectedVersion:1,content:''});assert.equal(empty.version,2);const next=await f.product.command('saveDraft',{resourceId:ids[count+1],expectedVersion:0,content:'x'});assert.equal(next.version,1);assert.equal((await f.product.command('readDraft',{resourceId:ids[0]})).version,2);
 }finally{await f.close();cleanup(f.dir);}
});

test('draft row retention is bounded without tombstone eviction',async()=>{
 const f=fixture();try{
  const candidate=await f.create();
  // Canonical resource references plus empty metadata model a full retained store.
  f.kernel.withTransaction(db=>{const insert=db.prepare('INSERT INTO cp_drafts VALUES(?,1,\'\',0,?)');for(let i=0;i<limits.records;i++){const resource=f.kernel.createConversationRef('Synthetic retained empty draft '+i,null);insert.run(resource.id,new Date().toISOString());}});
  await assert.rejects(f.product.command('saveDraft',{resourceId:candidate.resourceId,expectedVersion:0,content:''}),/draft_capacity_exceeded/);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM cp_drafts').get()!.n,limits.records);assert.equal((await f.product.command('readDraft',{resourceId:candidate.resourceId})).version,0);
 }finally{await f.close();cleanup(f.dir);}
});

test('unsent text never becomes search/export/context/transcript and send failures or later edits never clear it',async()=>{
 const f=fixture();try{
  const c=await f.create(),draft=await f.product.command('saveDraft',{resourceId:c.resourceId,expectedVersion:0,content:'Synthetic unsent-only-secret needle'}),before=await f.core.command('snapshot',{});
  assert.equal((await f.product.command('search',{text:draft.content})).total,0);assert.equal((await f.product.command('export',{resourceId:c.resourceId})).detail.messages.total,0);assert.deepEqual(await f.product.attachedContext(c.resourceId),[]);assert.deepEqual((await f.core.command('snapshot',{})).graph,before.graph);
  await f.product.command('send',{resourceId:c.resourceId,content:'Explicitly submitted different message',expectedRevision:1,commandId:crypto.randomUUID()});assert.deepEqual(await f.product.command('readDraft',{resourceId:c.resourceId}),draft,'A successful send never implicitly consumes a draft');
  const recorded=(await f.product.command('detail',{resourceId:c.resourceId})).messages.items;assert.deepEqual(recorded.map(m=>m.content),['Explicitly submitted different message']);
  const child=await f.product.command('branch',{resourceId:c.resourceId,messageId:recorded[0].id,includeMessageIds:[recorded[0].id],providerId:'local',title:'Synthetic draft-independent child',commandId:crypto.randomUUID(),tokenBudget:32768,expectedRevision:2});assert.equal((await f.product.command('readDraft',{resourceId:child.resourceId})).version,0);
  const codex=await f.core.command('createConversation',{title:'Synthetic provider path',providerId:'fixture-codex',commandId:crypto.randomUUID()});const sent=await f.product.command('saveDraft',{resourceId:codex.resourceId,expectedVersion:0,content:'Synthetic submitted text'});
  let rejectSend!:(error:Error)=>void,started!:()=>void;const pending=new Promise<unknown>((_resolve,reject)=>{rejectSend=reject;}),entered=new Promise<void>(resolve=>{started=resolve;});f.host.sendWithContext=async()=>{started();return pending;};
  const sending=f.product.command('send',{resourceId:codex.resourceId,content:sent.content,expectedRevision:1,commandId:crypto.randomUUID()});await entered;const later=await f.product.command('saveDraft',{resourceId:codex.resourceId,expectedVersion:sent.version,content:'Synthetic later in-flight typing'});rejectSend(Error('synthetic_provider_failure'));await assert.rejects(sending,/synthetic_provider_failure/);assert.deepEqual(await f.product.command('readDraft',{resourceId:codex.resourceId}),later);
  await assert.rejects(f.product.command('saveDraft',{resourceId:codex.resourceId,expectedVersion:sent.version,content:''}),/stale_draft_version/);assert.deepEqual(await f.product.command('readDraft',{resourceId:codex.resourceId}),later);
 }finally{await f.close();cleanup(f.dir);}
});
