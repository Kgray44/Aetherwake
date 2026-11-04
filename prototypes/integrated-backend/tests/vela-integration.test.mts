import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,relative,isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BackendCore } from '../src/core.mts';
import type { VelaOperation, VelaRequestInput, VelaBackendState } from '../src/contracts.mts';
import type { VelaPlanningPort } from '../../vela-core/src/contracts.ts';

function fixture(planner?:VelaPlanningPort) {
  const dir=mkdtempSync(join(tmpdir(),'aerynth-vela-backend-')),path=join(dir,'canonical.sqlite');
  let core=new BackendCore({path,provider:'fixture',contentPolicy:'synthetic-only',velaPlanningPort:planner});
  return {get core(){return core;},async reopen(){await core.command('close',{});core=new BackendCore({path,provider:'fixture',contentPolicy:'synthetic-only',velaPlanningPort:planner});},async close(){await core.command('close',{});const target=resolve(dir),part=relative(resolve(tmpdir()),target);assert.ok(part.startsWith('aerynth-vela-backend-')&&!part.startsWith('..')&&!isAbsolute(part));rmSync(target,{recursive:true,force:true});}};
}
async function vela(core:BackendCore,name:VelaOperation['name'],input:any={}):Promise<any>{return core.command('vela',{name,input} as VelaOperation);}
async function note(core:BackendCore,title='Synthetic Vela note') {const before=await core.command('desktop',{type:'snapshot'}),after=await core.command('desktop',{type:'createResource',kind:'note',title,workspaceId:null});return after.resources.find(r=>!before.resources.some(old=>old.id===r.id))!;}
function planner(value?:unknown) {let calls=0;const port:VelaPlanningPort={providerId:'synthetic-planning-test-double',availability:()=>({available:true,busy:false}),propose:async()=>{calls++;return value??{schemaVersion:1,summary:'Propose an explicitly local synthetic note',steps:[{id:'capture',explanation:'Test-only proposal through an injected port, never real model qualification',action:{type:'createResource',kind:'note',title:'Synthetic proposed capture',workspaceId:null}}],contribution:{providerId:'synthetic-planning-test-double',classification:'reported'}};}};return {port,calls:()=>calls};}
async function granted(core:BackendCore,intent:string,resourceIds:string[]) {const preview=await core.command('velaRequestPreview',{intent,resourceIds}),review=await core.command('velaNativeReview',{previewId:preview.id,signature:preview.signature}),grant=await core.command('authorizeVelaRequest',{previewId:preview.id,signature:preview.signature,reviewDigest:review.reviewDigest});return {preview,review,grant,input:{intent,resourceIds,authorizeProvider:true,previewId:preview.id,grantId:grant.grantId} satisfies VelaRequestInput};}

test('the same model path selects a device tool and a reviewed layout tool against the canonical active workspace', async () => {
  const calls: Parameters<VelaPlanningPort['propose']>[0][] = [];
  const providerId = 'synthetic-planning-test-double';
  const clockQuestion = 'What time is it?';
  const layoutQuestion = 'Could you give the cards in here a more orderly arrangement?';
  const f = fixture({
    providerId,
    availability: () => ({ available: true, busy: false }),
    propose: async input => {
      calls.push(input);
      const workspace = input.context.discovered.find(ref => ref.kind === 'workspace');
      assert(workspace);
      const action = input.intent === clockQuestion
        ? { type: 'readLocalFact', capabilityId: 'local.time' }
        : { type: 'applyStructuredPreset', workspaceId: workspace.id, preset: 'balanced' };
      assert(input.capabilities.some(capability => capability.id === action.type));
      return { schemaVersion: 2, kind: 'plan', summary: 'Synthetic model-selected action',
        steps: [{ id: 'tool', explanation: 'Synthetic provider response', action }],
        contribution: { providerId, classification: 'reported' } };
    },
  });
  try {
    await f.core.command('desktop', { type: 'createWorkspace', title: 'Synthetic active layout', projectId: null });
    const active = await f.core.command('desktop', { type: 'snapshot' });
    const workspaceId = active.activeWorkspaceId!;
    assert(workspaceId);
    for (const kind of ['note', 'task'] as const)
      await f.core.command('desktop', { type: 'createResource', workspaceId, title: 'Synthetic ' + kind, kind });
    const baseline = await f.core.command('desktop', { type: 'snapshot' });

    const unapproved = await vela(f.core, 'request', { intent: clockQuestion, resourceIds: [], authorizeProvider: false });
    assert.equal(unapproved.state, 'provider-unavailable');
    assert.equal(calls.length, 0);
    const clock = await granted(f.core, clockQuestion, []);
    const observed = await vela(f.core, 'request', clock.input);
    assert.equal(observed.state, 'completed');
    const state = await vela(f.core, 'state') as VelaBackendState;
    const message = state.conversation!.messages.find(message => message.requestId === observed.id && message.role === 'assistant');
    assert.equal(message?.source, 'vela-native');
    assert.equal(message?.classification, 'observed');
    assert.equal(message?.providerId, undefined);
    assert.match(message!.content, /It.s \d{1,2}:\d{2}/u);
    assert(state.receipts.some(receipt => receipt.requestId === observed.id && receipt.state === 'applied'));

    const layout = await granted(f.core, layoutQuestion, []);
    const proposed = await vela(f.core, 'request', layout.input);
    assert.equal(proposed.state, 'awaiting-review');
    assert.deepEqual(calls.map(call => call.intent), [clockQuestion, layoutQuestion]);
    const plan = (await vela(f.core, 'state') as VelaBackendState).plans.find(plan => plan.id === proposed.planId)!;
    assert(plan.targets.some(target => target.kind === 'workspace' && target.id === workspaceId));
    assert.equal((await f.core.command('desktop', { type: 'snapshot' })).layoutVersion, baseline.layoutVersion);
    await vela(f.core, 'review', { planId: plan.id, fingerprint: plan.fingerprint, decision: 'approve' });
    const applied = await vela(f.core, 'apply', plan.id);
    assert.equal(applied.state, 'applied');
    const arranged = await f.core.command('desktop', { type: 'snapshot' });
    assert.equal(arranged.organization?.mode, 'structured');
    assert.notEqual(arranged.layoutVersion, baseline.layoutVersion);
    assert.deepEqual(arranged.blocks.map(block => [block.id, block.resource_id]), baseline.blocks.map(block => [block.id, block.resource_id]));
    await f.reopen();
    const restored = await f.core.command('desktop', { type: 'snapshot' });
    assert.deepEqual(restored.blocks, arranged.blocks);
    assert.deepEqual(restored.organization, arranged.organization);
  } finally { await f.close(); }
});

test('Vela has independent canonical local identity, offline native capture/edit, message provenance and restart continuity',async()=>{
 const f=fixture();try{
  const port=(f.core as any).port;let connections=0;port.connect=async()=>{connections++;throw new Error('must remain offline');};
  assert.equal((await vela(f.core,'state')).conversation,null);
  const opened=await vela(f.core,'open') as VelaBackendState,id=opened.conversation!.resourceId;
  assert.equal((await f.core.command('snapshot',{})).conversations.find(c=>c.resourceId===id)!.providerId,'local');
  const plan=await vela(f.core,'native',{intent:'Capture a local note',action:{type:'createResource',kind:'note',title:'Vela native note',workspaceId:null}});assert.equal((await vela(f.core,'apply',plan.id)).state,'applied');
  const state=await vela(f.core,'state'),created=state.receipts.find((r:any)=>r.planId===plan.id).createdResourceId;
  const resource=(await f.core.command('desktop',{type:'snapshot'})).resources.find(r=>r.id===created)!;
  const edit=await vela(f.core,'native',{intent:'Save actual canonical note content',action:{type:'content',resourceId:created,expectedVersion:resource.version,content:'Actual native Vela content'}});await vela(f.core,'apply',edit.id);
  assert.equal((await f.core.command('desktop',{type:'snapshot'})).resources.find(r=>r.id===created)!.content,'Actual native Vela content');
  assert.equal(connections,0);assert.ok((await vela(f.core,'state')).conversation.messages.some((m:any)=>m.source==='vela-native'&&m.classification==='observed'));
  const count=(await f.core.command('snapshot',{})).graph.messages.length;await f.reopen();const restored=await vela(f.core,'state');assert.equal(restored.conversation.resourceId,id);assert.equal((await f.core.command('snapshot',{})).graph.messages.length,count);assert.equal(Object.keys((await f.core.command('snapshot',{})).executions).length,0);
 }finally{await f.close();}
});

test('read-only Vela preview cannot open chats or infer; raw provider booleans cannot grant native consent',async()=>{
 const p=planner(),f=fixture(p.port);try{
  const resource=await note(f.core),before=await f.core.command('snapshot',{}),preview=await f.core.command('velaRequestPreview',{intent:'Plan a local capture',resourceIds:[resource.id]});
  assert.equal(preview.context.included[0].id,resource.id);assert.equal((await vela(f.core,'state')).conversation,null);assert.deepEqual((await f.core.command('snapshot',{})).graph.messages,before.graph.messages);
  await assert.rejects(vela(f.core,'request',{intent:preview.intent,resourceIds:[resource.id],authorizeProvider:true}),/native_vela_grant_required/);assert.equal(p.calls(),0);
  const authorization=await granted(f.core,preview.intent,[resource.id]);const request=await vela(f.core,'request',authorization.input);assert.equal(request.state,'awaiting-review');assert.equal(p.calls(),1);assert.equal(Object.keys((await f.core.command('snapshot',{})).executions).length,0,'synthetic planning port is not actual provider execution');
  await assert.rejects(vela(f.core,'request',authorization.input),/native_vela_grant_consumed/);assert.equal(p.calls(),1);
 }finally{await f.close();}
});

test('native Vela grant binds exact intent, metadata/content versions, expiry and current scope',async()=>{
 const p=planner(),f=fixture(p.port);try{
  const resource=await note(f.core),authorization=await granted(f.core,'Use this exact intent',[resource.id]);
  await assert.rejects(vela(f.core,'request',{...authorization.input,intent:'Changed intent'}),/native_vela_grant_mismatch/);
  await f.core.command('desktop',{type:'content',resourceId:resource.id,expectedVersion:resource.version,content:'Changed after native preview'});
  await assert.rejects(vela(f.core,'request',authorization.input),/stale_vela_preview/);assert.equal(p.calls(),0);
  const next=await granted(f.core,'Plan from current scope',[resource.id]);await f.core.command('desktop',{type:'createProject',title:'A new synthetic scope'});const desktop=await f.core.command('desktop',{type:'snapshot'});await f.core.command('desktop',{type:'navigate',target:{kind:'constellation',projectId:desktop.projects[0].id}});
  await assert.rejects(vela(f.core,'request',next.input),/stale_vela_preview/);assert.equal(p.calls(),0);
  const expiring=await granted(f.core,'Expiry check',[resource.id]),clock=Date.now;try{Date.now=()=>clock()+61000;await assert.rejects(vela(f.core,'request',expiring.input),/native_vela_grant_expired/);}finally{Date.now=clock;}
  const other=await f.core.command('desktop',{type:'createProject',title:'Other private synthetic scope'}),otherProject=other.projects.find(p=>p.id!==desktop.projects[0].id)!;
  const inOther=await f.core.command('desktop',{type:'createWorkspace',title:'Other scope workspace',projectId:otherProject.id}),otherWorkspace=inOther.workspaces.find(w=>w.project_id===otherProject.id)!;
  const legacy=await f.core.command('createConversation',{title:'Legacy null-owner chat placed elsewhere',providerId:'local',commandId:randomUUID()});await f.core.command('desktop',{type:'attach',workspaceId:otherWorkspace.id,resourceId:legacy.resourceId});
  await f.core.command('desktop',{type:'navigate',target:{kind:'constellation',projectId:desktop.projects[0].id}});await assert.rejects(f.core.command('velaRequestPreview',{intent:'No placement-based scope escape',resourceIds:[legacy.resourceId]}),/resource_not_authorized/);
 }finally{await f.close();}
});

test('unsupported block actions are honestly unavailable and only released parent capabilities receive workspace composites',async()=>{
 const f=fixture();try{
  f.core.registerVelaNativeCapabilities({supportedActions:[],dispatch:()=>{throw new Error('Explicitly disabled host capability');}});
  const state=await vela(f.core,'state') as VelaBackendState;assert.equal(state.nativeCapabilities.workspaceFromResources.available,false);assert.ok(!state.capabilities.some(c=>c.id==='workspaceFromResources'));
  await assert.rejects(vela(f.core,'native',{intent:'Requires released block capability',action:{type:'workspaceFromResources',title:'Unsupported workspace',projectId:null,resourceIds:[]}}),/host_policy_denied/);
  let calls=0;f.core.registerVelaNativeCapabilities({supportedActions:['workspaceFromResources'],dispatch:input=>{calls++;assert.equal(input.action.type,'workspaceFromResources');return {status:'applied',receiptId:'synthetic-released-capability-receipt'};}});
  const plan=await vela(f.core,'native',{intent:'Forward the exact typed workspace command',action:{type:'workspaceFromResources',title:'Parent released workspace command',projectId:null,resourceIds:[]}});await vela(f.core,'apply',plan.id);assert.equal(calls,1);
  assert.equal((await f.core.command('desktop',{type:'snapshot'})).workspaces.length,0,'the integration does not create fallback blocks or workspaces');
 }finally{await f.close();}
});

test('canonical message revision changes stale Vela sources and paired freshness never becomes native mutation expectedVersion',async()=>{
 const f=fixture();try{
  const c=await f.core.command('createConversation',{title:'Synthetic source chat',providerId:'local',commandId:randomUUID()}),before=await f.core.command('velaRequestPreview',{intent:'Read this current chat',resourceIds:[c.resourceId]});
  await f.core.command('addMessage',{resourceId:c.resourceId,role:'user',content:'A new canonical source message',expectedRevision:1});
  await assert.rejects(f.core.command('authorizeVelaRequest',{previewId:before.id,signature:before.signature}),/stale_vela_preview/);
  const current=await f.core.command('velaRequestPreview',{intent:'Read current chat',resourceIds:[c.resourceId]});assert.notEqual(current.context.discovered[0].version,before.context.discovered[0].version);
  const resource=await note(f.core),plan=await vela(f.core,'native',{intent:'Do not accept stale raw mutation version',action:{type:'content',resourceId:resource.id,expectedVersion:resource.version,content:'Prepared write'}});
  await f.core.command('desktop',{type:'content',resourceId:resource.id,expectedVersion:resource.version,content:'Concurrent user write'});await assert.rejects(vela(f.core,'apply',plan.id),/stale_target_version/);
 }finally{await f.close();}
});

test('canonical application events feed explicit attention with no external watcher and opening never reviews them',async()=>{
 const f=fixture();try{
  await vela(f.core,'preferences',{expectedVersion:1,patch:{monitoringEnabled:true,allowedEventTypes:['application.createResource'],mode:'quiet'}});
  await note(f.core,'Attention source');const state=await vela(f.core,'state');assert.equal(state.attention.length,1);assert.equal(state.attention[0].disposition,'silent');assert.equal(state.attention[0].classification,'observed');
  await vela(f.core,'open');assert.equal((await vela(f.core,'state')).attention[0].reviewedAt,null);await vela(f.core,'reviewAttention',[state.attention[0].id]);assert.ok((await vela(f.core,'state')).attention[0].reviewedAt);
  await f.reopen();assert.ok((await vela(f.core,'state')).attention[0].reviewedAt);assert.equal((await vela(f.core,'state')).adaptation.policy.enabled,false);
 }finally{await f.close();}
});

test('failed released capabilities retain uncertain receipt and provider-independent request/proposal provenance',async()=>{
 const p=planner(),f=fixture(p.port);try{
  f.core.registerVelaNativeCapabilities({supportedActions:['workspaceFromResources'],dispatch:()=>{throw new Error('Synthetic lost host response');}});
  const plan=await vela(f.core,'native',{intent:'Preserve the user objective on uncertain effects',action:{type:'workspaceFromResources',title:'Uncertain operation',projectId:null,resourceIds:[]}}),applied=await vela(f.core,'apply',plan.id);assert.equal(applied.state,'unknown');
  assert.equal((await vela(f.core,'state')).receipts.find((r:any)=>r.planId===plan.id).state,'unknown');await assert.rejects(vela(f.core,'apply',plan.id),/review_authorization_required/);
  const approved=await granted(f.core,'Preserve this exact original planning intent',[]),request=await vela(f.core,'request',approved.input),state=await vela(f.core,'state');assert.equal(request.state,'awaiting-review');assert.equal(state.requests.find((r:any)=>r.id===request.id).intent,approved.input.intent);assert.equal(state.plans.find((p:any)=>p.id===request.planId).contribution.providerId,'synthetic-planning-test-double');assert.ok(state.conversation.messages.some((m:any)=>m.source==='provider'&&m.providerId==='synthetic-planning-test-double'));
 }finally{await f.close();}
});

test('explicit app preset events supply inspectable adaptation evidence while learning remains default off',async()=>{
 const f=fixture();try{
  const desktop=await f.core.command('desktop',{type:'createWorkspace',title:'Synthetic preference workspace',projectId:null}),workspace=desktop.workspaces[0];
  await vela(f.core,'preferences',{expectedVersion:1,patch:{monitoringEnabled:true,allowedEventTypes:['workspace.presetSelected'],mode:'quiet'}});
  await vela(f.core,'adaptationPolicy',{expectedVersion:1,enabled:true,categories:{presentation:{enabled:false,level:'manual'},organization:{enabled:true,level:'suggestive'}}});
  await f.core.command('desktop',{type:'applyStructuredPreset',workspaceId:workspace.id,preset:'focus'});
  const state=await vela(f.core,'state');assert.equal(state.adaptation.hypotheses.length,1);assert.equal(state.adaptation.hypotheses[0].source,'inferred');assert.equal(state.adaptation.hypotheses[0].state,'suggested');assert.equal(state.adaptation.hypotheses[0].evidence[0].actor,'user');
  const replay=await f.core.command('replay',{after:0,limit:100});assert.ok(replay.events.some(e=>e.eventId===state.adaptation.hypotheses[0].evidence[0].eventId));assert.equal(state.adaptation.applicationAvailable,false);
 }finally{await f.close();}
});

test('delegated execution requires a separate native step grant and retains canonical fixture execution links without verified task claims',async()=>{
 const p=planner({schemaVersion:1,summary:'Synthetic delegation proposal',steps:[{id:'delegate',explanation:'Explicit synthetic regression, not real Codex qualification',action:{type:'delegateTask',title:'Synthetic delegated objective',objective:'Inspect synthetic state',providerId:'fixture-codex',resourceIds:[],constraints:['No real provider']}}],contribution:{providerId:'synthetic-planning-test-double',classification:'reported'}}),f=fixture(p.port);try{
  await f.core.command('capabilities',{});await vela(f.core,'preferences',{expectedVersion:1,patch:{delegationEnabled:true}});
  const prepare=async()=>{const authorization=await granted(f.core,'Prepare a separately authorized synthetic delegation',[]),request=await vela(f.core,'request',authorization.input),state=await vela(f.core,'state'),plan=state.plans.find((p:any)=>p.id===request.planId);assert.ok(plan);await vela(f.core,'review',{planId:plan.id,fingerprint:plan.fingerprint,decision:'approve'});return plan;};
  const denied=await prepare();assert.equal((await vela(f.core,'apply',denied.id)).state,'failed');assert.equal(Object.keys((await f.core.command('snapshot',{})).executions).length,0);
  const approved=await prepare();await f.core.command('authorizeVelaDelegation',{planId:approved.id,stepId:'delegate',fingerprint:approved.fingerprint});assert.equal((await vela(f.core,'apply',approved.id)).state,'applied');
  const state=await vela(f.core,'state'),receipt=state.receipts.find((r:any)=>r.planId===approved.id),snapshot=await f.core.command('snapshot',{});assert.equal(receipt.taskVerified,false);assert.equal(snapshot.executions[receipt.hostReceiptId].providerId,'fixture-codex');assert.equal(snapshot.executions[receipt.hostReceiptId].taskVerified,false);assert.ok(snapshot.relationships.some(r=>r.kind==='vela_delegation'));
 }finally{await f.close();}
});
