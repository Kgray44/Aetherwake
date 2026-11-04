import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {WorkspaceKernel} from '../../workspace-kernel/kernel.mts';
import {WorkspaceEngine} from '../../workspace-engine/engine.mts';
import {VelaWorkspaceAdjustment,matchWorkspaceAdjustment,type WorkspaceAdjustmentAction,type WorkspaceAdjustmentHost} from '../src/vela-workspace-adjustment.mts';
import type {HostActionResult,ResourceRef} from '../../vela-core/src/contracts.ts';
import {historyDigest} from '../../vela-core/src/bounded-history.mts';
import type {WorkspaceProjection} from '../../workspace-engine/contracts.mts';
import {BackendCore} from '../src/core.mts';
import type {VelaBackendState} from '../src/contracts.mts';
import type {CreatedBlock} from '../../block-library/contracts.ts';
import {validateAction} from '../../vela-core/src/capabilities.ts';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename,dirname,join,resolve} from 'node:path';

function fixture(t:TestContext,mode:'freeform'|'fluid'|'structured'='freeform') {
  const kernel=WorkspaceKernel.open(':memory:'),db=kernel.withTransaction(db=>db),engine=new WorkspaceEngine(kernel,{defaultOrganization:{mode}}),
    workspace=kernel.createWorkspace('Synthetic geometry workspace'),note=kernel.createNote('Synthetic note','Preserved note text'),task=kernel.createGenericResource('Synthetic task'),
    unrelated=kernel.createGenericResource('Unrelated reference');
  const kinds=new Map([[note.id,'note'],[task.id,'task'],[unrelated.id,'reference']]);let allowed=true,failRecord=false;
  t.after(()=>kernel.close());db.exec('CREATE TABLE synthetic_adjustment_receipts(id TEXT PRIMARY KEY,fingerprint TEXT,json TEXT);CREATE TABLE synthetic_adjustment_events(json TEXT);');
  let current=engine.project(workspace.id);
  for(const [resourceId,presentation] of [[note.id,{x:24,y:144,width:400,height:320}],[task.id,{x:750,y:144,width:420,height:260}],
    [unrelated.id,{x:24,y:1000,width:300,height:200}]] as const)current=engine.execute({type:'attachResource',commandId:randomUUID(),workspaceId:workspace.id,
      expectedRevision:current.revision,resourceId,presentation});
  const resource=(id:string):ResourceRef|null=>{
    if(!allowed||!kinds.has(id))return null;const row=kernel.getResource(id).resource;
    return {id,kind:'resource',resourceKind:kinds.get(id),version:row.version,title:row.title,state:row.state,projectId:row.project_id};
  };
  const host:WorkspaceAdjustmentHost={inspectWorkspace:id=>{assert.equal(allowed,true,'Synthetic current workspace access');return engine.inspectWorkspace(id);},
    preview:(id,request)=>engine.preview(id,request),execute:command=>engine.execute(command),resource,
    undoDepth:id=>Number(db.prepare("SELECT json_array_length(history_json,'$.undo') AS n FROM workspace_engine_layouts WHERE workspace_id=?").get(id)!.n),
    atomic:work=>kernel.withTransaction(work),once:(id,input,work)=>{
      const previous=db.prepare('SELECT * FROM synthetic_adjustment_receipts WHERE id=?').get(id),fingerprint=historyDigest(input);
      if(previous){assert.equal(previous.fingerprint,fingerprint);return JSON.parse(String(previous.json)) as HostActionResult;}
      const result=work();db.prepare('INSERT INTO synthetic_adjustment_receipts VALUES(?,?,?)').run(id,fingerprint,JSON.stringify(result));return result;
    },record:receipt=>{db.prepare('INSERT INTO synthetic_adjustment_events VALUES(?)').run(JSON.stringify(receipt));if(failRecord)throw Error('synthetic_adjustment_event_failure');}};
  const service=new VelaWorkspaceAdjustment(host),action:WorkspaceAdjustmentAction={type:'adjustWorkspace',workspaceId:workspace.id,adjustments:[
    {resourceIds:[task.id],position:'right',size:'keep'},{resourceIds:[note.id],position:'keep',size:'larger'}]};
  return {kernel,db,engine,workspace,note,task,unrelated,host,service,action,resource,deny:()=>{allowed=false;},fail:()=>{failRecord=true;}};
}
const geometry=(state:WorkspaceProjection)=>state.blocks.map(({blockId,resourceId,x,y,width,height,rotation,locked})=>({blockId,resourceId,x,y,width,height,rotation,locked})).sort((a,b)=>a.blockId.localeCompare(b.blockId));

test('exact compound instruction resolves current canonical task/note IDs, never titles or new resources',t=>{
  const f=fixture(t),layout=f.engine.inspectWorkspace(f.workspace.id),refs=[f.resource(f.note.id)!,f.resource(f.task.id)!,f.resource(f.unrelated.id)!];
  assert.deepEqual(matchWorkspaceAdjustment('Put the project tasks on the right, and make the notes bigger.',layout,refs),f.action);
  assert.equal(matchWorkspaceAdjustment('Make this screen beautiful',layout,refs),null);
  assert.throws(()=>matchWorkspaceAdjustment('Put the project tasks on the right, and make the notes bigger.',layout,[]),/vela_adjustment_targets_missing/u);
});
for(const mode of ['freeform','fluid','structured'] as const)test(`one ${mode} adjustment preserves bindings/content/unrelated cards and creates one undo entry`,async t=>{
  const f=fixture(t,mode),before=f.engine.inspectWorkspace(f.workspace.id),depth=f.host.undoDepth(f.workspace.id),
    prepare=await f.service.prepare(f.action,'synthetic:adjust',new AbortController().signal);
  assert.deepEqual(geometry(f.engine.inspectWorkspace(f.workspace.id)),geometry(before));const result=prepare();
  assert.equal(result.status,'applied');assert.equal(result.workspaceAdjustment?.verification.oneUndoEntry,true);
  const actual=f.engine.inspectWorkspace(f.workspace.id),notes=actual.blocks.find(block=>block.resourceId===f.note.id)!,tasks=actual.blocks.find(block=>block.resourceId===f.task.id)!,
    oldNote=before.blocks.find(block=>block.resourceId===f.note.id)!;
  assert.ok(notes.width>oldNote.width&&notes.height>oldNote.height);assert.ok(tasks.x>=actual.presence.x+actual.presence.width+24);
  assert.equal(actual.revision,before.revision+1);assert.equal(f.host.undoDepth(f.workspace.id),depth+1);
  assert.deepEqual(actual.blocks.find(block=>block.resourceId===f.unrelated.id),before.blocks.find(block=>block.resourceId===f.unrelated.id));
  assert.equal(f.db.prepare('SELECT content FROM notes WHERE resource_id=?').get(f.note.id)!.content,'Preserved note text');assert.equal(f.db.prepare('SELECT count(*) AS n FROM resources').get()!.n,3);
  assert.deepEqual(prepare(),result);assert.equal(f.host.undoDepth(f.workspace.id),depth+1);
  f.engine.execute({type:'undoLayout',workspaceId:f.workspace.id,commandId:'synthetic:undo',expectedRevision:actual.revision});
  assert.deepEqual(geometry(f.engine.inspectWorkspace(f.workspace.id)),geometry(before));
});
test('locked targets, stale layout, aborted preparation and revoked access cannot change geometry',async t=>{
  const f=fixture(t),before=f.engine.inspectWorkspace(f.workspace.id),target=before.blocks.find(block=>block.resourceId===f.task.id)!;
  const aborted=new AbortController();aborted.abort();await assert.rejects(f.service.prepare(f.action,'synthetic:aborted',aborted.signal),/vela_adjustment_cancelled/u);
  const apply=await f.service.prepare(f.action,'synthetic:stale',new AbortController().signal);
  f.engine.execute({type:'setBlockLock',workspaceId:f.workspace.id,commandId:'synthetic:lock',expectedRevision:before.revision,blockId:target.blockId,locked:true});
  assert.throws(apply,/vela_adjustment_sources_changed/u);await assert.rejects(f.service.prepare(f.action,'synthetic:locked',new AbortController().signal),/vela_adjustment_locked_or_unavailable/u);
  const locked=f.engine.inspectWorkspace(f.workspace.id);assert.equal(locked.blocks.find(block=>block.blockId===target.blockId)!.locked,true);
  f.deny();assert.throws(apply,/vela_adjustment_resource_unavailable/u);
});
test('event or actual-postcondition failure rolls back all layout/history/receipt changes',async t=>{
  const f=fixture(t),before=f.engine.inspectWorkspace(f.workspace.id),depth=f.host.undoDepth(f.workspace.id),apply=await f.service.prepare(f.action,'synthetic:rollback',new AbortController().signal);
  f.fail();assert.throws(apply,/synthetic_adjustment_event_failure/u);assert.deepEqual(geometry(f.engine.inspectWorkspace(f.workspace.id)),geometry(before));
  assert.equal(f.host.undoDepth(f.workspace.id),depth);assert.equal(f.db.prepare('SELECT count(*) AS n FROM synthetic_adjustment_receipts').get()!.n,0);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM synthetic_adjustment_events').get()!.n,0);
});
test('a host that changes unrelated geometry after execute is detected and the complete mutation rolls back',async t=>{
  const f=fixture(t),before=f.engine.inspectWorkspace(f.workspace.id),depth=f.host.undoDepth(f.workspace.id),original=f.host.execute;
  f.host.execute=command=>{const result=original(command),other=result.blocks.find(block=>block.resourceId===f.unrelated.id)!;
    f.engine.execute({type:'moveBlock',commandId:'synthetic:unexpected-host-move',workspaceId:f.workspace.id,expectedRevision:result.revision,
      blockId:other.blockId,x:other.x+64,y:other.y});return result;};
  const apply=await f.service.prepare(f.action,'synthetic:corrupt-actual',new AbortController().signal);
  assert.throws(apply,/vela_adjustment_unrelated_geometry_changed/u);assert.deepEqual(geometry(f.engine.inspectWorkspace(f.workspace.id)),geometry(before));
  assert.equal(f.host.undoDepth(f.workspace.id),depth);assert.equal(f.db.prepare('SELECT count(*) AS n FROM synthetic_adjustment_receipts').get()!.n,0);
});
test('resource changes after preparation and cancellation before apply retain the exact current layout',async t=>{
  const f=fixture(t),before=f.engine.inspectWorkspace(f.workspace.id),controller=new AbortController(),cancelled=await f.service.prepare(f.action,'synthetic:late-abort',controller.signal);
  controller.abort();assert.throws(cancelled,/vela_adjustment_cancelled/u);
  const stale=await f.service.prepare(f.action,'synthetic:resource-stale',new AbortController().signal);
  f.kernel.updateNote(f.note.id,'Current user edit',f.kernel.getResource(f.note.id).resource.version);
  assert.throws(stale,/vela_adjustment_sources_changed/u);assert.deepEqual(geometry(f.engine.inspectWorkspace(f.workspace.id)),geometry(before));
  assert.equal(f.db.prepare('SELECT content FROM notes WHERE resource_id=?').get(f.note.id)!.content,'Current user edit');
});
test('workspace actions reject unknown fields, empty targets and nonfinite semantic controls',t=>{
  const f=fixture(t);assert.deepEqual(validateAction(f.action),f.action);
  for(const action of [{...f.action,extra:true},{...f.action,adjustments:[]},{...f.action,adjustments:[{resourceIds:[],position:'right',size:'keep'}]},
    {...f.action,adjustments:[{resourceIds:[f.task.id],position:'center',size:'keep'}]},
    {type:'recoverCreation',workspaceId:f.workspace.id,receiptId:'receipt:1',action:'delete'},
    {type:'recoverCreation',workspaceId:f.workspace.id,receiptId:'receipt:1',action:'restore',grant:'fake'},
  ])assert.throws(()=>validateAction(action),/invalid_action/u);
});

const state=async(core:BackendCore)=>await core.command('vela',{name:'state',input:{}}) as VelaBackendState;
const route=async(core:BackendCore,intent:string)=>{const result=await core.command('velaRouteNative',{intent});assert.ok(result.matched,intent);return result.request;};
async function coreFixture(t:TestContext) {
  const directory=mkdtempSync(join(tmpdir(),'aerynth-core-adjustment-')),open=()=>new BackendCore({path:join(directory,'canonical.db'),provider:'fixture',contentPolicy:'synthetic-only'});
  let core=open();const instances=[core];
  t.after(async()=>{for(const instance of instances)if(!(instance as any).closed)await instance.command('close',{});assert.equal(resolve(dirname(directory)),resolve(tmpdir()));assert.ok(basename(directory).startsWith('aerynth-core-adjustment-'));rmSync(directory,{recursive:true,force:true});});
  return {get core(){return core;},get db(){return (core as any).db;},get engine(){return (core as any).desktop.nativeBlockServices().engine as WorkspaceEngine;},
    async reopen(){await core.command('close',{});core=open();instances.push(core);}};
}
test('actual Core exact compound followup runs natively in one saveLayout and preserves task/note content',async t=>{
  const f=await coreFixture(t);let desktop=await f.core.command('desktop',{type:'createWorkspace',title:'Synthetic actual geometry',projectId:null});
  const workspaceId=desktop.activeWorkspaceId!,created:CreatedBlock[]=[];
  for(const kind of ['task','note'] as const) {
    const result=await f.core.command('library',{name:'createBlock',input:{commandId:randomUUID(),workspaceId,expectedLayoutVersion:desktop.layoutVersion,kind,title:'Synthetic '+kind}});
    created.push(result.result as CreatedBlock);desktop=result.desktop!;
  }
  const before=f.engine.inspectWorkspace(workspaceId),depth=Number(f.db.prepare("SELECT json_array_length(history_json,'$.undo') AS n FROM workspace_engine_layouts WHERE workspace_id=?").get(workspaceId).n),
    request=await route(f.core,'Put the project tasks on the right, and make the notes bigger.');
  assert.equal(request.state,'completed',request.errorCode);const receipt=(await state(f.core)).receipts.find(receipt=>receipt.requestId===request.id)!;
  assert.equal(receipt.workspaceAdjustment?.verification.oneUndoEntry,true);const actual=f.engine.inspectWorkspace(workspaceId);
  assert.equal(actual.revision,before.revision+1);assert.equal(actual.blocks.length,2);assert.equal(actual.blocks[0].resourceId,before.blocks[0].resourceId);
  assert.equal(Number(f.db.prepare("SELECT json_array_length(history_json,'$.undo') AS n FROM workspace_engine_layouts WHERE workspace_id=?").get(workspaceId).n),depth+1);
  assert.equal((await f.core.command('providerActivity',{})).providerRequests,0);assert.equal(f.db.prepare('SELECT count(*) AS n FROM resources').get().n,3);
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM change_events WHERE type='engine.saveLayout'").get().n,1);
  const ambiguous=await route(f.core,'Undo that');assert.equal(ambiguous.response?.kind,'clarification');assert.equal(f.engine.inspectWorkspace(workspaceId).revision,actual.revision);
});
test('actual Core natural creation undo and restore preserve all resources, content, history, bindings and layout',async t=>{
  const f=await coreFixture(t),request=await route(f.core,'Create a workspace for synthetic research project');assert.equal(request.state,'completed',request.errorCode);
  const proof=(await state(f.core)).receipts.find(receipt=>receipt.requestId===request.id)!.workspaceConstruction!,workspaceId=proof.workspaceId,
    before=f.engine.inspectWorkspace(workspaceId),resources=f.db.prepare('SELECT * FROM resources ORDER BY id').all(),blocks=f.db.prepare('SELECT * FROM blocks ORDER BY id').all(),
    history=f.db.prepare('SELECT history_json FROM workspace_engine_layouts WHERE workspace_id=?').get(workspaceId).history_json;
  const undone=await route(f.core,'Undo that');assert.equal(undone.state,'completed',undone.errorCode);
  const undoneState=await state(f.core),undoPlan=undoneState.plans.find(plan=>plan.id===undone.planId),undoReceipt=undoneState.receipts.find(receipt=>receipt.requestId===undone.id);
  assert.equal(undoPlan?.state,'applied');assert.equal(undoReceipt?.workspaceRecovery?.action,'undo-creation');assert.ok(undoReceipt?.hostReceiptId);
  const archiveReader=(f.core as any).velaHost.canInspectWorkspaceArchiveReceipt;
  (f.core as any).velaHost.canInspectWorkspaceArchiveReceipt=()=>false;
  const withdrawn=await state(f.core);assert.equal(withdrawn.plans.some(plan=>plan.id===undone.planId),false);assert.equal(withdrawn.receipts.some(receipt=>receipt.requestId===undone.id),false);
  (f.core as any).velaHost.canInspectWorkspaceArchiveReceipt=archiveReader;
  assert.equal(f.db.prepare('SELECT state FROM workspaces WHERE id=?').get(workspaceId).state,'archived');
  // User/assistant turns advance only the canonical Vela conversation entity; user resource content/IDs remain exact.
  const velaId=(await state(f.core)).conversation!.resourceId;
  assert.deepEqual(f.db.prepare('SELECT * FROM resources WHERE id<>? ORDER BY id').all(velaId),resources.filter((row:any)=>row.id!==velaId));
  assert.deepEqual(f.db.prepare('SELECT * FROM blocks ORDER BY id').all(),blocks);assert.equal(f.db.prepare('SELECT history_json FROM workspace_engine_layouts WHERE workspace_id=?').get(workspaceId).history_json,history);
  const restored=await route(f.core,'Restore that workspace');assert.equal(restored.state,'completed',restored.errorCode);
  assert.equal(f.db.prepare('SELECT state FROM workspaces WHERE id=?').get(workspaceId).state,'active');
  assert.deepEqual(geometry(f.engine.inspectWorkspace(workspaceId)),geometry(before));assert.deepEqual(f.db.prepare('SELECT * FROM blocks ORDER BY id').all(),blocks);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM recovery_actions').get().n,2);assert.equal((await f.core.command('providerActivity',{})).providerRequests,0);
});
test('natural creation undo refuses missing creation evidence and does not guess an older operation',async t=>{
  const f=await coreFixture(t),request=await route(f.core,'Create a workspace for synthetic reading');assert.equal(request.state,'completed');
  const proof=(await state(f.core)).receipts.find(receipt=>receipt.requestId===request.id)!.workspaceConstruction!;
  f.db.prepare("DELETE FROM change_events WHERE entity_kind='workspace' AND entity_id=? AND type='workspace.created'").run(proof.workspaceId);
  const reply=await route(f.core,'Undo that');assert.equal(reply.response?.kind,'clarification');
  assert.equal(f.db.prepare('SELECT state FROM workspaces WHERE id=?').get(proof.workspaceId).state,'active');
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM recovery_actions').get().n,0);
});
test('the exact followup adjusts the actual checklist and notes from a native-created workspace without recreating content',async t=>{
  const f=await coreFixture(t),created=await route(f.core,'Create a workspace for A World for Two for Minecraft');assert.equal(created.state,'completed');
  const proof=(await state(f.core)).receipts.find(receipt=>receipt.requestId===created.id)!.workspaceConstruction!,before=f.engine.inspectWorkspace(proof.workspaceId),
    rows=f.db.prepare('SELECT d.resource_id,d.kind FROM desktop_resources d JOIN blocks b ON b.resource_id=d.resource_id WHERE b.workspace_id=?').all(proof.workspaceId);
  assert.ok(rows.some((row:any)=>row.kind==='checklist'));const contents=f.db.prepare('SELECT resource_id,content FROM notes ORDER BY resource_id').all();
  const adjusted=await route(f.core,'Put the project tasks on the right, and make the notes bigger.');assert.equal(adjusted.state,'completed',adjusted.errorCode);
  const actual=f.engine.inspectWorkspace(proof.workspaceId);assert.equal(actual.blocks.length,before.blocks.length);
  const checklistIds=new Set(rows.filter((row:any)=>row.kind==='checklist').map((row:any)=>row.resource_id));
  for(const block of actual.blocks)if(checklistIds.has(block.resourceId))assert.ok(block.x>=actual.presence.x+actual.presence.width+24);
  assert.deepEqual(f.db.prepare('SELECT resource_id,content FROM notes ORDER BY resource_id').all(),contents);
});
test('natural recovery follows the existing creation receipt across Core restart without a second journal',async t=>{
  const f=await coreFixture(t),created=await route(f.core,'Create a workspace for synthetic recovery continuity'),
    proof=(await state(f.core)).receipts.find(receipt=>receipt.requestId===created.id)!.workspaceConstruction!;
  assert.equal((await route(f.core,'Undo that')).state,'completed');await f.reopen();
  const restored=await route(f.core,'Restore that workspace');assert.equal(restored.state,'completed',restored.errorCode);
  assert.equal(f.db.prepare('SELECT state FROM workspaces WHERE id=?').get(proof.workspaceId).state,'active');
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM recovery_actions').get().n,2);
});
test('revoked project management permission prevents natural creation recovery and leaves resources active',async t=>{
  const f=await coreFixture(t),created=await route(f.core,'Create a workspace for synthetic permission boundary'),
    proof=(await state(f.core)).receipts.find(receipt=>receipt.requestId===created.id)!.workspaceConstruction!,access=(f.core as any).conversationAccess,original=access.project.bind(access);
  access.project=(id:string,purpose?:string,...rest:unknown[])=>id===proof.projectId&&purpose==='organize'?false:original(id,purpose,...rest);
  const response=await route(f.core,'Undo that');assert.equal(response.response?.kind,'clarification');
  assert.equal(f.db.prepare('SELECT state FROM workspaces WHERE id=?').get(proof.workspaceId).state,'active');assert.equal(f.db.prepare('SELECT count(*) AS n FROM recovery_actions').get().n,0);
});
