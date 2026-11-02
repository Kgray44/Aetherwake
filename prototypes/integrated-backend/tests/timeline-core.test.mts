import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,relative,isAbsolute } from 'node:path';
import { BackendCore } from '../src/core.mts';
import type { AgentMutationReceipt } from '../../agent-product/contracts.ts';
import type { TimelineDocument,TimelineMutationResult,TimelineView,TimelineWindow } from '../../timeline-product/contracts.ts';

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
    assert.equal((await core.command('openResource',{resourceId:created.resourceId})).status,'unsupported','An unwired viewer must not be presented as a working Note or block');
    assert.deepEqual(await core.command('providerActivity',{}),{codexConnections:0,providerRequests:0,systemMemoryReads:0,scope:'process-session-native-attempts'});
    await core.command('close',{});core=new BackendCore({path,provider:'fixture',contentPolicy:'synthetic-only'});
    assert.deepEqual((await core.command('timelines',{name:'read',input:{resourceId:created.resourceId}})).result,expected);
    const restored=(await core.command('timelines',{name:'query',input:{resourceId:created.resourceId,expectedVersion:saved.version}})).result as TimelineWindow;
    assert(restored.items.some(item=>item.event.eventId===event.eventId&&item.event.receivedAt===event.receivedAt));
  }finally{
    await core.command('close',{});const target=resolve(dir),part=relative(resolve(tmpdir()),target);assert(part.startsWith('aerynth-timeline-core-')&&!part.startsWith('..')&&!isAbsolute(part));rmSync(target,{recursive:true,force:true});
  }
});
