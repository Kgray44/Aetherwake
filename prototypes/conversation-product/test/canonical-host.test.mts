import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,relative,isAbsolute } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { WorkspaceKernel } from '../../workspace-kernel/kernel.mts';
import { BackendCore } from '../../integrated-backend/src/core.mts';
import type { Capability } from '../../integrated-backend/src/contracts.mts';
import { ConversationGraph,type ProviderAdapter } from '../../connected-conversations/src/graph.ts';
import { createCanonicalAccessHelper,createCanonicalOrganizationAdapter,createObservedCapabilityCache,matchObservedExecutionProvider,resolveLocalRecordingProvider,type CanonicalPolicy,type CanonicalCollection,type CanonicalMembershipResult } from '../src/canonical-host.mts';

function cleanup(path:string){const absolute=resolve(path),part=relative(resolve(tmpdir()),absolute);assert.ok(part.startsWith('aerynth-canonical-host-')&&!part.startsWith('..')&&!isAbsolute(part));rmSync(absolute,{recursive:true,force:true});}
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'aerynth-canonical-host-')),core=new BackendCore({path:join(dir,'canonical.sqlite'),contentPolicy:'synthetic-only',provider:'fixture'});
 const owning=core as unknown as {db:DatabaseSync;kernel:WorkspaceKernel;graph:ConversationGraph;state:any;atomic:<T>(operation:()=>T)=>T;localAdapters:()=>ProviderAdapter[]};
 const denied=new Set<string>();let touches=0,failTouch=false,failRename=false;
 const allow:CanonicalPolicy=request=>!denied.has(request.kind)&&!denied.has(request.kind+':'+('id' in request?String(request.id):request.resourceId));
 const options={db:owning.db,kernel:owning.kernel,atomic:<T,>(operation:()=>T)=>owning.atomic(operation),allow,
  conversation(resourceId:string){const c=owning.graph.snapshot().conversations.find(c=>c.id===owning.state.resources[resourceId])!;return {id:c.id,title:c.title,revision:owning.state.revisions[resourceId],providerId:c.providerId};},
  touchCollection(collectionId:string,expectedVersion:number){touches++;const result=owning.db.prepare('UPDATE collections SET version=version+1,updated_at=? WHERE id=? AND version=?').run(new Date().toISOString(),collectionId,expectedVersion);assert.equal(Number(result.changes),1);if(failTouch)throw new Error('synthetic_parent_touch_failure');},
  renameConversation(input:{resourceId:string;title:string;expectedVersion:number;expectedRevision:number}){
   owning.db.prepare('UPDATE resources SET title=?,version=version+1 WHERE id=? AND version=?').run(input.title,input.resourceId,input.expectedVersion);
   if(failRename)return {resourceId:input.resourceId};
   const graph=owning.graph.snapshot();graph.conversations.find(c=>c.id===owning.state.resources[input.resourceId])!.title=input.title;owning.graph=new ConversationGraph(owning.localAdapters(),graph);owning.state.revisions[input.resourceId]++;
   return {resourceId:input.resourceId,title:input.title};
  },
  associateProject(input:{resourceId:string;projectId:string|null;expectedVersion:number}){
   owning.db.prepare('UPDATE resources SET project_id=?,version=version+1 WHERE id=? AND version=?').run(input.projectId,input.resourceId,input.expectedVersion);if(owning.state.resources[input.resourceId])owning.state.revisions[input.resourceId]++;return {resourceId:input.resourceId};
  }
 };
 const organize=createCanonicalOrganizationAdapter(options);
 return {core,owning,organize,options,denied,allow,getTouches:()=>touches,failTouch(){failTouch=true;},failRename(){failRename=true;},async close(){await core.command('close',{});cleanup(dir);}};
}

test('canonical organization fences versions, preserves idempotent memberships, and rolls back parent failures',async()=>{
 const f=fixture();try{
  const c=await f.core.command('createConversation',{title:'Synthetic canonical resource',commandId:crypto.randomUUID()}),collection=await f.organize({type:'createCollection',title:'  Synthetic folder  ',projectId:null}) as CanonicalCollection;
  assert.equal(collection.title,'Synthetic folder');
  const one=await f.organize({type:'membership',collectionId:collection.id,resourceId:c.resourceId,member:true,expectedVersion:1}) as CanonicalMembershipResult;assert.equal(one.version,2);assert.equal(one.membership.changed,true);assert.equal(f.getTouches(),1);
  const same=await f.organize({type:'membership',collectionId:collection.id,resourceId:c.resourceId,member:true,expectedVersion:2}) as CanonicalMembershipResult;assert.equal(same.version,2);assert.equal(same.membership.changed,false);assert.equal(f.getTouches(),1);
  await assert.rejects(f.organize({type:'membership',collectionId:collection.id,resourceId:c.resourceId,member:true,expectedVersion:1}),/stale_collection_version/);
  await f.organize({type:'membership',collectionId:collection.id,resourceId:c.resourceId,member:false,expectedVersion:2});assert.equal(f.getTouches(),2);
  const absent=await f.organize({type:'membership',collectionId:collection.id,resourceId:c.resourceId,member:false,expectedVersion:3}) as CanonicalMembershipResult;assert.equal(absent.membership.changed,false);assert.equal(f.getTouches(),2);
  f.failTouch();await assert.rejects(f.organize({type:'membership',collectionId:collection.id,resourceId:c.resourceId,member:true,expectedVersion:3}),/synthetic_parent_touch_failure/);assert.equal(f.owning.db.prepare('SELECT version FROM collections WHERE id=?').get(collection.id)!.version,3);assert.equal(f.owning.kernel.listCollection(collection.id).length,0);
  const archived=await f.organize({type:'archiveCollection',collectionId:collection.id,archived:true,expectedVersion:3}) as CanonicalCollection;assert.equal(archived.version,4);await assert.rejects(f.organize({type:'renameCollection',collectionId:collection.id,title:'Denied',expectedVersion:4}),/collection_archived/);
  await f.organize({type:'archiveCollection',collectionId:collection.id,archived:false,expectedVersion:4});const renamed=await f.organize({type:'renameCollection',collectionId:collection.id,title:'Renamed',expectedVersion:5}) as CanonicalCollection;assert.equal(renamed.version,6);
  const events=f.owning.kernel.listEvents('resource',c.resourceId);assert.equal(events.filter(e=>e.type==='collection.member_added').length,1);assert.equal(events.filter(e=>e.type==='collection.member_removed').length,1);
 }finally{await f.close();}
});

test('conversation title and project callbacks preserve canonical identity, transcript and rollback on incomplete synchronization',async()=>{
 const f=fixture();try{
  const c=await f.core.command('createConversation',{title:'Original synthetic title',commandId:crypto.randomUUID()}),m=await f.core.command('addMessage',{resourceId:c.resourceId,role:'user',content:'Synthetic retained message',expectedRevision:1}),before=(await f.core.command('snapshot',{}));
  await f.organize({type:'renameConversation',resourceId:c.resourceId,title:'Renamed synthetic title',expectedVersion:1,expectedRevision:2});
  const after=await f.core.command('snapshot',{});assert.equal(after.resourceMap[c.resourceId],before.resourceMap[c.resourceId]);assert.equal(after.conversations[0].title,'Renamed synthetic title');assert.equal(after.conversations[0].revision,3);assert.deepEqual(after.graph.messages,before.graph.messages);assert.equal(after.graph.messages[0].id,m.id);
  await assert.rejects(f.organize({type:'renameConversation',resourceId:c.resourceId,title:'Stale title',expectedVersion:2,expectedRevision:2}),/stale_conversation_revision/);
  f.failRename();await assert.rejects(f.organize({type:'renameConversation',resourceId:c.resourceId,title:'Must roll back',expectedVersion:2,expectedRevision:3}),/canonical_rename_not_synchronized/);assert.equal(f.owning.kernel.getResource(c.resourceId).resource.title,'Renamed synthetic title');
  const project=f.owning.kernel.createProject('Synthetic destination');await f.organize({type:'associateProject',resourceId:c.resourceId,projectId:project.id,expectedVersion:2});assert.equal(f.owning.kernel.getResource(c.resourceId).resource.project_id,project.id);assert.equal((await f.core.command('snapshot',{})).conversations[0].revision,4);
  f.denied.add('association');await assert.rejects(f.organize({type:'associateProject',resourceId:c.resourceId,projectId:null,expectedVersion:3}),/project_association_denied/);assert.equal(f.owning.kernel.getResource(c.resourceId).resource.project_id,project.id);
 }finally{await f.close();}
});

test('canonical access reads current ownership and legacy placements without granting permissions or resetting data',async()=>{
 const f=fixture();let other:DatabaseSync|undefined;try{
  other=new DatabaseSync(':memory:');assert.throws(()=>createCanonicalOrganizationAdapter({...f.options,db:other!}),/canonical_connection_mismatch/);other.close();other=undefined;
  const p=f.owning.kernel.createProject('Synthetic project'),w=f.owning.kernel.createWorkspace('Synthetic workspace',p.id),c=await f.core.command('createConversation',{title:'Legacy unowned conversation',commandId:crypto.randomUUID()});f.owning.kernel.attachBlock(w.id,c.resourceId,{x:0,y:0,width:320,height:240,z:0});
  const access=createCanonicalAccessHelper({db:f.owning.db,allow:f.allow});assert.equal(access.access(c.resourceId),true);assert.deepEqual(access.projectIds(c.resourceId),[p.id]);assert.equal(access.access(c.resourceId,'unresolved-message'),false);
  f.owning.kernel.setProjectArchived(p.id,true,1);assert.equal(access.access(c.resourceId),false,'archived-only placement cannot become globally visible');
  f.owning.kernel.setProjectArchived(p.id,false,2);f.denied.add('project:'+p.id);assert.equal(access.access(c.resourceId),false);f.denied.delete('project:'+p.id);assert.equal(access.access(c.resourceId),true);
  const global=f.owning.kernel.createWorkspace('Synthetic standalone workspace');f.owning.kernel.attachBlock(global.id,c.resourceId,{x:0,y:0,width:320,height:240,z:0});f.owning.kernel.setProjectArchived(p.id,true,3);assert.equal(access.access(c.resourceId),true,'another explicitly authorized live presentation remains usable');f.denied.add('resource:'+c.resourceId);assert.equal(access.access(c.resourceId),false,'placement never overrides parent resource policy');f.denied.clear();
  f.owning.kernel.setResourceArchived(c.resourceId,true,1);assert.equal(access.access(c.resourceId),false);const archivedAccess=createCanonicalAccessHelper({db:f.owning.db,allow:f.allow,allowArchivedResources:true});assert.equal(archivedAccess.access(c.resourceId),true);assert.equal(archivedAccess.resource(c.resourceId,'organize'),false);
 }finally{other?.close();await f.close();}
});

test('observed capability cache is side-effect free, cloned, expires honestly and preserves real local/provider IDs',async()=>{
 const f=fixture();try{
  let now=1000;const cache=createObservedCapabilityCache({maxAgeMs:60,now:()=>now});assert.equal(cache.snapshot(),undefined);
  const capability:Capability={providerId:'fixture-codex',mock:true,authentication:'available',models:['synthetic-model'],catalogOnly:true,nativeFork:false,chatgptHistory:false};cache.observe(capability);capability.models.push('external mutation');assert.deepEqual(cache.snapshot()!.models,['synthetic-model']);cache.snapshot()!.models.push('returned mutation');assert.deepEqual(cache.snapshot()!.models,['synthetic-model']);
  now=1061;assert.equal(cache.inspect().state,'stale');assert.equal(cache.snapshot(),undefined);now=999;assert.equal(cache.snapshot(),undefined);cache.clear();assert.equal(cache.inspect().state,'unknown');assert.throws(()=>cache.observe({...capability,providerId:'local'}),/invalid_observed_capability/);
  const graph=(await f.core.command('snapshot',{})).graph,legacyOnly={providers:graph.providers.filter(p=>p.id!=='local')};assert.equal(resolveLocalRecordingProvider(legacyOnly).legacyCompatibility,true);assert.deepEqual(resolveLocalRecordingProvider(graph),{providerId:'local',legacyCompatibility:false,modelExecution:false});assert.equal(matchObservedExecutionProvider(graph,capability)?.id,'fixture-codex');assert.equal(matchObservedExecutionProvider(graph,{...capability,providerId:'mock-ordinary'}),undefined);
 }finally{await f.close();}
});
