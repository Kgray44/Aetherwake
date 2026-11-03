import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,relative,isAbsolute } from 'node:path';
import { BackendCore } from '../src/core.mts';
import type { AgentMutationReceipt } from '../../agent-product/contracts.ts';
import type { TimelineDocument,TimelineMutationResult,TimelineView,TimelineWindow } from '../../timeline-product/contracts.ts';
import type { VelaNativeAction, VelaPlan, VelaPlanningPort, VelaRequest, VelaState } from '../../vela-core/src/contracts.ts';

test('actual Core Timeline commands persist one canonical view over existing authorized event headers without Notes, workspace or copied events',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'aerynth-timeline-core-')),path=join(dir,'canonical.sqlite');
  let core=new BackendCore({path,provider:'fixture',contentPolicy:'synthetic-only'});
  try{
    const templates=(await core.command('agents',{name:'templates',input:{}})).result as any[];
    const profile=structuredClone(templates[0].profile);profile.settings.additionalInstructions={source:'override',value:'SYNTHETIC private configuration is not a timeline header'};
    const agent=(await core.command('agents',{name:'create',input:{commandId:'synthetic-timeline-source',title:'Synthetic timeline source',projectId:null,profile}})).result as AgentMutationReceipt;
    const view:TimelineView={schemaVersion:1,mode:'activity',scope:{projectId:null,resourceIds:[agent.agent.resourceId]},sources:{providerIds:[],eventTypes:[],classifications:['observed','reported','inferred','simulated']},viewport:{from:new Date(Date.now()-3600000).toISOString(),to:new Date(Date.now()+3600000).toISOString(),displayTimeZone:'UTC'},selection:null};
    const input={commandId:'synthetic-timeline-create',title:'Synthetic source activity',projectId:null,view};
    const created=(await core.command('timelines',{name:'create',input})).result as TimelineMutationResult;
    assert.deepEqual((await core.command('timelines',{name:'create',input})).result,created);
    const document=(await core.command('timelines',{name:'read',input:{resourceId:created.resourceId}})).result as TimelineDocument;
    assert.equal(document.resource.kind,'timeline');assert.equal(document.canEdit,true);assert.equal(document.capabilities.planning,false);assert.equal(document.capabilities.stateReconstruction,false);
    const window=(await core.command('timelines',{name:'query',input:{resourceId:created.resourceId,expectedVersion:document.resource.version}})).result as TimelineWindow;
    assert(window.items.some(item=>item.event.type==='agent.created'&&item.event.resourceId===agent.agent.resourceId));assert(window.items.every(item=>item.event.resourceId===agent.agent.resourceId));
    assert.equal(window.coverage.allActivity,false);assert.equal(window.coverage.rawPayloads,false);assert(!JSON.stringify(window).includes(profile.settings.additionalInstructions.value));
    const event=window.items[0].event;assert.equal(event.providerId,'aerynth-native');assert.equal(event.executionId,null);assert.equal(event.classification,'observed');
    const changed={...view,viewport:{...view.viewport,from:new Date(Date.now()-1800000).toISOString()},selection:{eventId:event.eventId,cursor:event.cursor}};
    const saved=(await core.command('timelines',{name:'save',input:{commandId:'synthetic-timeline-save',resourceId:created.resourceId,expectedVersion:document.resource.version,view:changed}})).result as TimelineMutationResult;
    assert.equal(saved.version,document.resource.version+1);
    const expected=(await core.command('timelines',{name:'read',input:{resourceId:created.resourceId}})).result;
    const desktop=await core.command('desktop',{type:'snapshot'});assert.equal(desktop.workspaces.length,0);assert.equal(desktop.blocks.length,0);assert.equal(desktop.resources.find(r=>r.id===created.resourceId)!.kind,'timeline');
    assert.equal((core as any).db.prepare('SELECT count(*) n FROM notes').get().n,0);
    const opened=await core.command('openResource',{resourceId:created.resourceId});assert.equal(opened.status,'ready');if(opened.status==='ready'){assert.equal(opened.presentation.kind,'timeline');assert.equal(opened.resource.content,'');}
    assert.deepEqual(await core.command('providerActivity',{}),{codexConnections:0,providerRequests:0,systemMemoryReads:0,scope:'process-session-native-attempts'});
    await core.command('close',{});core=new BackendCore({path,provider:'fixture',contentPolicy:'synthetic-only'});
    assert.deepEqual((await core.command('timelines',{name:'read',input:{resourceId:created.resourceId}})).result,expected);
    const restored=(await core.command('timelines',{name:'query',input:{resourceId:created.resourceId,expectedVersion:saved.version}})).result as TimelineWindow;
    assert(restored.items.some(item=>item.event.eventId===event.eventId&&item.event.receivedAt===event.receivedAt));
  }finally{
    await core.command('close',{});const target=resolve(dir),part=relative(resolve(tmpdir()),target);assert(part.startsWith('aerynth-timeline-core-')&&!part.startsWith('..')&&!isAbsolute(part));rmSync(target,{recursive:true,force:true});
  }
});

test('Vela discovers Timeline creation, composes with approved GitHub evidence, and restores canonical resources after restart', async t => {
  const dir=mkdtempSync(join(tmpdir(),'aerynth-github-timeline-')),path=join(dir,'canonical.sqlite');
  let proposed!: VelaNativeAction;
  const planner: VelaPlanningPort = {
    providerId:'synthetic-timeline-planner',
    availability:()=>({available:true,busy:false}),
    async propose(input) {
      const capability=input.capabilities.find(capability=>capability.id==='createTimeline');
      assert(capability?.scope.includes('Linked repository: https://github.com/synthetic/example'));
      return {schemaVersion:2,kind:'plan',summary:'Save the reviewed development history',steps:[{id:'timeline',explanation:'Use the selected public repository',action:proposed}],
        contribution:{providerId:'synthetic-timeline-planner',classification:'reported'}};
    },
  };
  const options = {path,provider:'fixture' as const,contentPolicy:'synthetic-only' as const,velaPlanningPort:planner};
  let core=new BackendCore(options);
  const calls: URL[] = [];
  const sha='f'.repeat(40);
  let holdCommits: (() => void) | undefined;
  t.mock.method(globalThis,'fetch',async (url:URL, options:RequestInit)=>{
    calls.push(url);
    assert.equal(url.origin,'https://api.github.com');
    assert.equal(options.redirect,'error');
    assert(!new Headers(options.headers).has('Authorization'));
    if(url.pathname==='/repos/synthetic/example')
      return Response.json({full_name:'Synthetic/Example',private:false,default_branch:'main'});
    assert.equal(url.pathname,'/repos/synthetic/example/commits');
    assert.equal(url.searchParams.get('sha'),'main');
    assert.equal(url.searchParams.get('per_page'),'30');
    if(holdCommits){
      holdCommits();
      return await new Promise<Response>((_,reject)=>options.signal!.addEventListener('abort',()=>reject(options.signal!.reason),{once:true}));
    }
    return Response.json([{sha,commit:{message:'Public commit title\nPrivate fixture body',committer:{date:new Date(Date.now()-60000).toISOString(),email:'SYNTHETIC_EMAIL'}}}],{
      headers:{link:'<https://api.github.com/ignored>; rel="next"'},
    });
  });
  try {
    const project=(await core.command('desktop',{type:'createProject',title:'Synthetic development'})).projects[0]!;
    const desktop=await core.command('desktop',{type:'createWorkspace',projectId:project.id,title:'Development'});
    const workspaceId=desktop.activeWorkspaceId!;
    proposed={type:'createTimeline',title:'Development history',projectId:project.id,workspaceId,source:{kind:'github-commits',repositoryUrl:'https://github.com/Synthetic/Example'}};
    await assert.rejects(core.command('vela',{name:'native',input:{intent:'Invalid repository',action:{...proposed,source:{kind:'github-commits',repositoryUrl:'https://github.com.evil.invalid/Synthetic/Example'}}}}),/unsupported_or_invalid_action/);
    await assert.rejects(core.command('vela',{name:'native',input:{intent:'Unspecified repository',action:proposed}}),/host_policy_denied/);
    const withReference=await core.command('desktop',{type:'createResource',kind:'reference',title:'Development source',workspaceId});
    const reference=withReference.resources.find(resource=>resource.title==='Development source')!;
    await core.command('desktop',{type:'content',resourceId:reference.id,expectedVersion:reference.version,content:'https://github.com/Synthetic/Example/'});
    assert.equal(calls.length,0);
    const intent='Give me a development history from the public source we discussed';
    const preview=await core.command('velaRequestPreview',{intent,resourceIds:[]});
    const grant=await core.command('authorizeVelaRequest',{previewId:preview.id,signature:preview.signature});
    const request=await core.command('vela',{name:'request',input:{intent,resourceIds:[],authorizeProvider:true,previewId:preview.id,grantId:grant.grantId}}) as VelaRequest;
    const state=()=>core.command('vela',{name:'state',input:{}}) as Promise<VelaState>;
    const plan=(await state()).plans.find(plan=>plan.id===request.planId)!;
    assert.equal(plan.state,'prepared');
    await assert.rejects(core.command('vela',{name:'apply',input:plan.id}),/review_authorization_required/);
    assert.equal(calls.length,0);
    await core.command('vela',{name:'review',input:{planId:plan.id,fingerprint:plan.fingerprint,decision:'approve'}});
    assert.equal(calls.length,0);
    const applied=await core.command('vela',{name:'apply',input:plan.id}) as VelaPlan;
    assert.equal(applied.state,'applied');
    assert.deepEqual(await core.command('vela',{name:'apply',input:plan.id}),applied);
    const receipt=(await state()).receipts.find(receipt=>receipt.planId===plan.id)!;
    assert.equal(receipt.state,'applied');
    const result={resourceId:receipt.createdResourceId!};
    assert.equal(calls.length,2);
    const read=(await core.command('timelines',{name:'read',input:{resourceId:result.resourceId}})).result as TimelineDocument;
    const query={name:'query' as const,input:{resourceId:result.resourceId,expectedVersion:read.resource.version}};
    const window=(await core.command('timelines',query)).result as TimelineWindow;
    assert.equal(window.timeAxis,'reportedAt');
    assert.equal(window.sourceCoverage?.status,'partial');
    assert(Date.parse(read.view.viewport.from)>Date.parse(window.sourceCoverage!.requestedFrom));
    assert(Date.parse(read.view.viewport.to)-Date.parse(read.view.viewport.from)<86400000);
    const item=window.items[0]!;
    assert.equal(item.externalEvidence?.title,'Public commit title');assert.equal(item.evidenceClass,'reported');
    assert.equal(item.externalEvidence?.source.ref,reference.id);
    assert.doesNotMatch(JSON.stringify(window),/Private fixture body|SYNTHETIC_EMAIL/);
    const target={timelineId:result.resourceId,eventId:item.event.eventId,cursor:item.event.cursor};
    const url='https://github.com/Synthetic/Example/commit/'+sha;
    assert.deepEqual(await core.command('githubTimeline',{name:'openCommit',input:target}),{url});
    await assert.rejects(core.command('githubTimeline',{name:'openCommit',input:{...target,eventId:'wrong'}}),/github_commit_unavailable/);
    assert.doesNotMatch(JSON.stringify(await core.command('replay',{after:0,limit:100})),/Public commit title|Synthetic\/Example/);
    const stored=await core.command('desktop',{type:'snapshot'});
    const placement=stored.blocks.find(block=>block.resource_id===result.resourceId);
    assert(placement);assert.equal(placement.workspace_id,workspaceId);
    await core.command('close',{});
    core=new BackendCore(options);
    const restored=(await core.command('timelines',query)).result as TimelineWindow;
    assert.deepEqual(restored.items,window.items);
    assert.deepEqual(restored.sourceCoverage,window.sourceCoverage);
    assert.deepEqual((await core.command('desktop',{type:'snapshot'})).blocks.find(block=>block.id===placement.id),placement);
    assert.deepEqual(await core.command('githubTimeline',{name:'sources',input:{}}),{repositories:['https://github.com/synthetic/example']});
    const local=await core.command('vela',{name:'native',input:{intent:'Show recorded activity',action:{
      type:'createTimeline',title:'Activity',projectId:project.id,workspaceId:null,source:{kind:'application-activity'},
    }}}) as VelaPlan;
    await core.command('vela',{name:'review',input:{planId:local.id,fingerprint:local.fingerprint,decision:'approve'}});
    assert.equal((await core.command('vela',{name:'apply',input:local.id}) as VelaPlan).state,'applied');
    const localId=(await state()).receipts.find(receipt=>receipt.planId===local.id)!.createdResourceId!;
    const localDoc=(await core.command('timelines',{name:'read',input:{resourceId:localId}})).result as TimelineDocument;
    assert.equal(localDoc.view.timeAxis,undefined);
    assert.equal(localDoc.resource.title,'Activity');
    assert.equal(calls.length,2);
    const pending=await core.command('vela',{name:'native',input:{intent:'Prepare another development timeline',action:proposed}}) as VelaPlan;
    await core.command('vela',{name:'review',input:{planId:pending.id,fingerprint:pending.fingerprint,decision:'approve'}});
    const fetching=new Promise<void>(resolve=>{holdCommits=resolve;});
    const operation=core.command('vela',{name:'apply',input:pending.id}) as Promise<VelaPlan>;
    await fetching;
    await core.command('vela',{name:'cancel',input:pending.requestId});
    assert.equal((await operation).state,'cancelled');
    const afterCancel=await core.command('desktop',{type:'snapshot'});
    assert.deepEqual(afterCancel.resources.filter(r=>r.kind==='timeline').map(r=>r.id).sort(),[result.resourceId,localId].sort());
  } finally {
    await core.command('close',{});
    const target=resolve(dir),part=relative(resolve(tmpdir()),target);
    assert(part.startsWith('aerynth-github-timeline-')&&!part.startsWith('..')&&!isAbsolute(part));
    rmSync(target,{recursive:true,force:true});
  }
});
