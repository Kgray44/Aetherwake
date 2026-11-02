import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,relative,isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BackendCore } from '../src/core.mts';
import type { LibraryMethod,LibraryRequest,VelaOperation } from '../src/contracts.mts';
import { captureWorkspaceTemplate } from '../../block-library/model.ts';
import type { VelaPlanningPort } from '../../vela-core/src/contracts.ts';

function fixture(planner?:VelaPlanningPort){const dir=mkdtempSync(join(tmpdir(),'aerynth-library-backend-')),path=join(dir,'canonical.sqlite');let core=new BackendCore({path,provider:'fixture',contentPolicy:'synthetic-only',velaPlanningPort:planner});return {get core(){return core;},async reopen(){await core.command('close',{});core=new BackendCore({path,provider:'fixture',contentPolicy:'synthetic-only',velaPlanningPort:planner});},async close(){await core.command('close',{});const target=resolve(dir),part=relative(resolve(tmpdir()),target);assert.ok(part.startsWith('aerynth-library-backend-')&&!part.startsWith('..')&&!isAbsolute(part));rmSync(target,{recursive:true,force:true});}};}
const library=(core:BackendCore,name:LibraryMethod,input:any={})=>core.command('library',{name,input} as LibraryRequest) as Promise<any>;
const vela=(core:BackendCore,name:VelaOperation['name'],input:any={})=>core.command('vela',{name,input} as VelaOperation) as Promise<any>;

test('Vela construction invokes the actual released library, preserves selected canonical identities and its exact persisted receipt',async()=>{
 const f=fixture();try{
  let connections=0;(f.core as any).port.connect=async()=>{connections++;throw new Error('Library work must stay local');};
  const source=await f.core.command('createConversation',{title:'Existing canonical local chat',providerId:'local',commandId:randomUUID()});await f.core.command('addMessage',{resourceId:source.resourceId,role:'user',content:'This exact canonical history remains unique',expectedRevision:1});
  const noteDesktop=await f.core.command('desktop',{type:'createResource',kind:'note',title:'Existing canonical note',workspaceId:null}),note=noteDesktop.resources.find(r=>r.kind==='note')!;
  const before=await f.core.command('snapshot',{}),plan=await vela(f.core,'native',{intent:'Organize these exact existing resources',action:{type:'workspaceFromResources',title:'Actual released library workspace',projectId:null,resourceIds:[source.resourceId,note.id]}});
  assert.equal((await vela(f.core,'apply',plan.id)).state,'applied');const desktop=await f.core.command('desktop',{type:'snapshot'}),state=await vela(f.core,'state'),receipt=state.receipts.find((r:any)=>r.planId===plan.id);
  assert.equal(desktop.activeWorkspaceId,receipt.createdWorkspaceId);assert.deepEqual(desktop.blocks.map(b=>b.resource_id).sort(),[source.resourceId,note.id].sort());
  const exact=JSON.parse(String((f.core as any).db.prepare('SELECT json FROM block_library_receipts WHERE command_id=?').get(receipt.hostReceiptId).json));
  assert.deepEqual(exact.resourceIds,[source.resourceId,note.id]);assert.equal(exact.receipt.commandId,receipt.hostReceiptId);assert.equal(exact.createdWorkspaceId,receipt.createdWorkspaceId);assert.equal(exact.placementIds.length,2);
  const after=await f.core.command('snapshot',{});assert.deepEqual(after.graph.messages.filter(m=>m.conversationId===before.resourceMap[source.resourceId]),before.graph.messages.filter(m=>m.conversationId===before.resourceMap[source.resourceId]));assert.equal(after.resourceMap[source.resourceId],before.resourceMap[source.resourceId]);assert.equal(connections,0);assert.equal(Object.keys(after.executions).length,0);
  await vela(f.core,'apply',plan.id);assert.equal((await f.core.command('desktop',{type:'snapshot'})).workspaces.length,1);assert.equal(desktop.presence?.id,'system:vela');assert.equal(desktop.presence?.width,208);assert.equal(desktop.presence?.height,260);assert.equal(desktop.presence?.scale,.65);
 }finally{await f.close();}
});

test('typed library creates true local conversation blocks, captures content-free templates and persists settings/favorites/recovery',async()=>{
 const f=fixture();try{
  const blank=await library(f.core,'getTemplate','builtin:blank'),workspace=await library(f.core,'applyTemplate',{commandId:randomUUID(),templateId:blank.result.id,expectedVersion:blank.result.version,title:'Library workspace',projectId:null});
  assert.equal(workspace.desktop.activeWorkspaceId,workspace.result.workspaceId);
  const created=await library(f.core,'createBlock',{commandId:randomUUID(),workspaceId:workspace.result.workspaceId,expectedLayoutVersion:workspace.desktop.layoutVersion,kind:'conversation',title:'A real local conversation',provider:'local'});
  const canonical=await f.core.command('snapshot',{});assert.equal(canonical.conversations.find(c=>c.resourceId===created.result.resourceId)!.providerId,'local');assert.equal(Object.keys(canonical.executions).length,0);
  const setting=await library(f.core,'configureBlock',{placementId:created.result.placementId,expectedVersion:1,configuration:{schemaVersion:1,textScale:1.2,contentMode:'reading'}});assert.equal(setting.result.version,2);
  const prefs=await library(f.core,'preferences');await library(f.core,'setFavorite',{kind:'conversation',favorite:true,expectedVersion:prefs.result.version});
  const body=captureWorkspaceTemplate(created.desktop,{[created.result.resourceId]:'reference'}),saved=await library(f.core,'saveTemplate',{name:'Saved actual workspace',description:'Explicit references only',tags:['synthetic'],body});
  assert.ok(!JSON.stringify(saved.result.body).includes('messages'));await f.reopen();assert.ok((await library(f.core,'preferences')).result.favorites.includes('conversation'));assert.equal((await library(f.core,'getBlockSettings',created.result.placementId)).result.configuration.textScale,1.2);assert.equal((await library(f.core,'getTemplate',saved.result.id)).result.name,'Saved actual workspace');
  await assert.rejects(library(f.core,'saveTemplate',{name:'Spoofed AI source',description:'',tags:[],body,source:'vela',provenance:{requestId:'fake',providerId:'fake'}}),/native_template_provenance_required/);
  await assert.rejects(library(f.core,'requestVelaTemplate',{requestId:randomUUID(),prompt:'Do not fabricate a template plan',projectId:null}),/vela_planning_unavailable/);
 }finally{await f.close();}
});

test('library scope fences reject cross-project and stale references, and parent atomic rollback includes canonical graph mappings',async()=>{
 const f=fixture();try{
  const p1=(await f.core.command('desktop',{type:'createProject',title:'Source project'})).projects[0],p2=(await f.core.command('desktop',{type:'createProject',title:'Destination project'})).projects.find(p=>p.id!==p1.id)!;
  const workspace=(await f.core.command('desktop',{type:'createWorkspace',title:'Source workspace',projectId:p1.id})).workspaces.find(w=>w.project_id===p1.id)!;
  const current=await f.core.command('desktop',{type:'snapshot'}),created=await library(f.core,'createBlock',{commandId:randomUUID(),workspaceId:workspace.id,expectedLayoutVersion:current.layoutVersion,kind:'note',title:'Owned note'}),resource=created.desktop.resources.find((r:any)=>r.id===created.result.resourceId);
  const before=await f.core.command('desktop',{type:'snapshot'});
  await assert.rejects(library(f.core,'workspaceFromResources',{commandId:randomUUID(),title:'Denied cross-project',projectId:p2.id,expectedProjectVersion:p2.version,resources:[{resourceId:resource.id,expectedVersion:resource.version}]}),/cross_project_reference/);
  await assert.rejects(library(f.core,'attachBlock',{commandId:randomUUID(),workspaceId:workspace.id,expectedLayoutVersion:before.layoutVersion-1,kind:'note',resourceId:resource.id,expectedResourceVersion:resource.version}),/layout_version_conflict/);
  assert.equal((await f.core.command('desktop',{type:'snapshot'})).workspaces.length,before.workspaces.length);
  const original=(f.core as any).createLibraryResource,graph=await f.core.command('snapshot',{});(f.core as any).createLibraryResource=function(...args:any[]){original.apply(this,args);throw new Error('Synthetic failure after canonical graph/resource creation');};
  await assert.rejects(library(f.core,'createBlock',{commandId:randomUUID(),workspaceId:workspace.id,expectedLayoutVersion:before.layoutVersion,kind:'conversation',provider:'local',title:'Must roll back canonical identity'}),/Synthetic failure/);(f.core as any).createLibraryResource=original;
  assert.deepEqual((await f.core.command('snapshot',{})).graph,graph.graph);assert.equal((await f.core.command('desktop',{type:'snapshot'})).resources.length,before.resources.length);
  await f.core.command('desktop',{type:'archiveSubject',kind:'resource',id:resource.id,expectedVersion:resource.version,archived:true});await assert.rejects(library(f.core,'workspaceFromResources',{commandId:randomUUID(),title:'Denied archived source',projectId:p1.id,expectedProjectVersion:p1.version,resources:[{resourceId:resource.id,expectedVersion:resource.version+1}]}),/reference_unavailable/);
 }finally{await f.close();}
});

test('consent includes actual project/workspace/owner metadata before binding and contextual proposals retain the reviewed project',async()=>{
 let observed:any,calls=0;
 const port:VelaPlanningPort={providerId:'synthetic-context-planning-double',availability:()=>({available:true,busy:false}),propose:async input=>{calls++;observed=input.context;const project=input.context.discovered.find(r=>r.kind==='project')!,resource=input.context.included[0];return {schemaVersion:1,summary:'Synthetic typed proposal using real supplied IDs',steps:[{id:'organize',explanation:'Use the explicit canonical owner project from the manifest',action:{type:'workspaceFromResources',title:'Contextual project workspace',projectId:project.id,resourceIds:[resource.id]}}],contribution:{providerId:'synthetic-context-planning-double',classification:'reported'}};}};
 const f=fixture(port);try{
  const project=(await f.core.command('desktop',{type:'createProject',title:'Actual selected project'})).projects[0],workspace=(await f.core.command('desktop',{type:'createWorkspace',title:'Actual selected workspace',projectId:project.id})).workspaces[0],desktop=await f.core.command('desktop',{type:'snapshot'}),created=await library(f.core,'createBlock',{commandId:randomUUID(),workspaceId:workspace.id,expectedLayoutVersion:desktop.layoutVersion,kind:'note',title:'Actual project note'});
  const first=await f.core.command('velaRequestPreview',{intent:'Create a workspace in this actual project',resourceIds:[created.result.resourceId]});assert.equal((await vela(f.core,'state')).conversation,null);
  assert.equal(first.context.included[0].projectId,project.id);assert.ok(first.context.discovered.some(ref=>ref.kind==='project'&&ref.id===project.id&&ref.title==='Actual selected project'));assert.ok(first.context.discovered.some(ref=>ref.kind==='workspace'&&ref.id===workspace.id));
  (f.core as any).kernel.renameProject(project.id,'Renamed actual project',project.version);await assert.rejects(f.core.command('authorizeVelaRequest',{previewId:first.id,signature:first.signature}),/stale_vela_preview/);
  const preview=await f.core.command('velaRequestPreview',{intent:first.intent,resourceIds:[created.result.resourceId]}),grant=await f.core.command('authorizeVelaRequest',{previewId:preview.id,signature:preview.signature}),request=await vela(f.core,'request',{intent:preview.intent,resourceIds:preview.resourceIds,authorizeProvider:true,previewId:preview.id,grantId:grant.grantId});
  assert.equal(calls,1);assert.ok(observed.discovered.some((ref:any)=>ref.kind==='project'&&ref.title==='Renamed actual project'));const state=await vela(f.core,'state'),plan=state.plans.find((p:any)=>p.id===request.planId);assert.equal(plan.steps[0].action.projectId,project.id);await vela(f.core,'review',{planId:plan.id,fingerprint:plan.fingerprint,decision:'approve'});assert.equal((await vela(f.core,'apply',plan.id)).state,'applied');
  const after=await f.core.command('desktop',{type:'snapshot'});assert.equal(after.workspaces.find(w=>w.id===after.activeWorkspaceId)!.project_id,project.id);assert.equal(after.blocks[0].resource_id,created.result.resourceId);
 }finally{await f.close();}
});
