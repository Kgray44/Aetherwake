import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { BackendCore } from '../src/core.mts';
import type { VelaLocalDispatch, VelaPresentationState } from '../../vela-core/src/contracts.ts';
import type { VelaBackendState } from '../src/contracts.mts';

function fixture(t:any) {
  const dir=mkdtempSync(join(tmpdir(),'aerynth-local-core-'));
  const options={path:join(dir,'canonical.sqlite'),provider:'fixture' as const,contentPolicy:'synthetic-only' as const};
  let core=new BackendCore(options);
  t.after(async()=>{
    (core as any).active=null;await core.command('close',{});
    const part=relative(resolve(tmpdir()),resolve(dir));assert(part.startsWith('aerynth-local-core-')&&!part.startsWith('..')&&!isAbsolute(part));
    rmSync(dir,{recursive:true,force:true});
  });
  return {get core(){return core;},async reopen(){await core.command('close',{});core=new BackendCore(options);}};
}
const local=(core:BackendCore,intent:string,commandId:string)=>core.command('vela',{name:'local',input:{intent,commandId}} as any) as Promise<VelaLocalDispatch>;

test('actual Core persists presentation references with CAS during unrelated execution without changing canonical history',async t=>{
  const f=fixture(t),answer=await local(f.core,'What time is it?','presentation-clock');assert(answer.matched);
  const before=await f.core.command('snapshot',{}),state=await f.core.command('vela',{name:'state',input:{}}) as VelaBackendState;
  assert(state.presentation);
  (f.core as any).port.connect=async()=>{throw Error('Presentation must not connect a provider');};
  (f.core as any).active={id:'synthetic-unrelated-execution'};
  const saved=await f.core.command('vela',{name:'presentation',input:{expectedVersion:state.presentation.version,patch:{view:'history',selectedRequestId:answer.request.id,pinnedRequestIds:[answer.request.id]}}}) as VelaPresentationState;
  assert.equal(saved.version,state.presentation.version+1);
  await assert.rejects(f.core.command('vela',{name:'presentation',input:{expectedVersion:state.presentation.version,patch:{view:'current'}}}),/stale_presentation_version/);
  (f.core as any).active=null;
  assert.deepEqual((await f.core.command('snapshot',{})).graph,before.graph);
  await f.reopen();assert.deepEqual((await f.core.command('vela',{name:'state',input:{}}) as VelaBackendState).presentation,saved);
  assert.deepEqual((await f.core.command('snapshot',{})).graph,JSON.parse(JSON.stringify(before.graph)));
});
function forbidContext(core:BackendCore) {
  for(const key of ['velaMetadata','velaContext','previewVelaRequest','nativeVelaReview','authorizeVelaRequest'])
    (core as any)[key]=()=>{throw Error('Unrelated context or provider consent was accessed: '+key);};
  (core as any).port.connect=async()=>{throw Error('A local answer must not connect a provider');};
  (core as any).velaPlanner.availability=()=>{throw Error('A local answer must not inspect provider availability');};
}

test('actual Core clock writes the same canonical pair without context projection, provider availability, consent or an execution',async t=>{
  const f=fixture(t);forbidContext(f.core);const before=Date.now(),value=await local(f.core,'What time is it?','native-clock-one');
  assert.equal(value.matched,true);if(!value.matched)return;
  assert.equal(value.request.state,'responded');assert.equal(value.request.providerId,null);assert.equal(value.result.facts.kind,'time');
  if(value.result.facts.kind==='time'){assert(value.result.facts.epochMs>=before&&value.result.facts.epochMs<=Date.now());assert.equal(value.result.facts.timeZone,new Intl.DateTimeFormat().resolvedOptions().timeZone);}
  assert.deepEqual(value.request.context.included,[]);assert.equal(value.request.context.contentBytes,0);
  const snapshot=await f.core.command('snapshot',{});assert.equal(snapshot.graph.messages.length,2);assert.equal(Object.keys(snapshot.executions).length,0);assert.equal(Object.values(snapshot.bindings).flat().length,0);
  const message=snapshot.graph.messages.find(message=>message.id===value.result.messageId)!;
  assert.equal(message.content,value.result.content);assert.equal(message.role,'assistant');assert.equal(message.provenance,'application');
  const again=await local(f.core,'What time is it?','native-clock-one');assert(again.matched);assert.equal(again.result.replayed,true);assert.equal(again.result.content,value.result.content);assert.equal(again.result.messageId,value.result.messageId);
  assert.equal((await f.core.command('snapshot',{})).graph.messages.length,2);
});

test('Core unknown local questions are zero-write and do not enter a metadata or provider path',async t=>{
  const f=fixture(t);forbidContext(f.core);const db=(f.core as any).db;
  const before=db.prepare('SELECT total_changes() AS n').get().n;
  assert.deepEqual(await local(f.core,'Explain electric motor torque','unknown-local-question'),{matched:false});
  assert.equal(db.prepare('SELECT total_changes() AS n').get().n,before);
  assert.equal((await f.core.command('snapshot',{})).graph.messages.length,0);
  await assert.rejects(f.core.command('vela',{name:'local',input:{intent:'What time is it?',commandId:'forged-clock',epochMs:0}} as any),/invalid_local_request/);
});

test('Core targeted status facts retain workspace layout/resources and do not conflate drafts with layout persistence',async t=>{
  const f=fixture(t);await f.core.command('desktop',{type:'createProject',title:'Synthetic local facts'});
  const desktop=await f.core.command('desktop',{type:'createWorkspace',title:'Synthetic active workspace',projectId:null});
  forbidContext(f.core);
  const status=await local(f.core,'Is this workspace saved?','workspace-facts');assert(status.matched);assert.equal(status.result.facts.kind,'workspace-status');assert.match(status.result.content,/layout is saved/);
  if(status.result.facts.kind==='workspace-status')assert.equal(status.result.facts.workspace?.id,desktop.activeWorkspaceId);
  const count=await local(f.core,'How many projects do I have?','project-facts');assert(count.matched);assert.deepEqual(count.result.facts,{kind:'project-count',count:1,coverage:'authorized-active-projects'});
  const work=await local(f.core,'Are any agents running?','execution-facts');assert(work.matched);assert.deepEqual(work.result.facts,{kind:'execution-status',running:0,unknown:0,coverage:'aerynth-owned-executions'});
  const after=await f.core.command('desktop',{type:'snapshot'});assert.deepEqual(after.blocks,desktop.blocks);assert.deepEqual(after.presence,desktop.presence);assert.deepEqual(after.viewport,desktop.viewport);
});

test('clock facts remain available through the existing execution busy gate without opening a provider',async t=>{
  const f=fixture(t);forbidContext(f.core);(f.core as any).active={id:'synthetic-busy-lock'};
  try{const answer=await local(f.core,"What's today's date?",'clock-while-busy');assert(answer.matched);assert.equal(answer.result.facts.kind,'date');}
  finally{(f.core as any).active=null;}
});

test('actual Core restart replays the original local fact/body/IDs without duplicate messages or a new clock/context lookup',async t=>{
  const f=fixture(t);const original=await local(f.core,'What time is it?','durable-local-clock');assert(original.matched);
  await f.reopen();forbidContext(f.core);(f.core as any).vela.opts.local.clock=()=>{throw Error('Idempotent replay must not refresh the clock');};
  const graph=(f.core as any).graph,snapshot=graph.snapshot,visible=graph.visibleMessages;
  graph.snapshot=graph.visibleMessages=()=>{throw Error('A committed own-message replay must not project unrelated transcripts');};
  const restored=await local(f.core,'What time is it?','durable-local-clock');assert(restored.matched);
  assert.deepEqual(restored.request,original.request);assert.equal(restored.result.content,original.result.content);assert.equal(restored.result.messageId,original.result.messageId);assert.equal(restored.result.replayed,true);
  graph.snapshot=snapshot;graph.visibleMessages=visible;
  (f.core as any).atomic(()=>{graph.markUnavailable(original.result.messageId);assert.equal((f.core as any).conversationAccess.access(original.request.conversationId,original.result.messageId),false,'An in-flight revocation cannot use the committed-graph fast path');});
  await assert.rejects(local(f.core,'What time is it?','durable-local-clock'),/local_response_unavailable/);
  assert.equal((await f.core.command('snapshot',{})).graph.messages.length,2);
  await assert.rejects(local(f.core,"What's today's date?",'durable-local-clock'),/local_command_id_conflict/);
});

for (const failure of ['append','save'] as const) test('local '+failure+' rollback preserves an awaiting execution and approved handoff through real terminal commit/restart',async t=>{
  const f=fixture(t),core=f.core as any;
  const source=await f.core.command('createConversation',{title:'Synthetic rollback source',commandId:'rollback-source'});
  const message=await f.core.command('addMessage',{resourceId:source.resourceId,role:'user',content:'Synthetic reviewed context',expectedRevision:1,sensitivity:'public'});
  const branch=await f.core.command('branch',{resourceId:source.resourceId,messageId:message.id,includeMessageIds:[message.id],providerId:'fixture-codex',title:'Synthetic awaiting turn',commandId:'rollback-branch',tokenBudget:8192});
  await f.core.command('review',{handoffId:branch.handoff.id,fingerprint:branch.handoff.fingerprint,approve:true});
  let resume!:()=>void,entered!:()=>void;
  const waiting=new Promise<void>(resolve=>{resume=resolve;}),ready=new Promise<void>(resolve=>{entered=resolve;});
  const terminal=core.port.terminal.bind(core.port);core.port.terminal=async(...args:unknown[])=>{entered();await waiting;return terminal(...args);};
  const pending=f.core.command('execute',{resourceId:branch.conversation.resourceId,handoffId:branch.handoff.id,prompt:'Synthetic suspended fixture turn',commandId:'rollback-execute',authorized:true});
  await ready;
  const execution=core.active,review=core.state.reviews[branch.handoff.id];
  const before=await f.core.command('snapshot',{}),key=failure==='append'?'appendVelaMessage':'save',original=core[key];let failed=false;
  core[key]=function(...args:unknown[]){const result=original.apply(this,args);if(!failed){failed=true;throw Error('synthetic-local-'+failure+'-failure');}return result;};
  try {
    await assert.rejects(local(f.core,'What time is it?','rollback-clock'),new RegExp('synthetic-local-'+failure+'-failure'));
    assert.equal(core.state.executions[execution.id],execution,'The pending turn retains its canonical execution object');
    assert.equal(core.active,execution);assert.equal(core.state.reviews[review.id],review);
    const rolledBack=await f.core.command('snapshot',{});assert.deepEqual(rolledBack.graph,before.graph);assert.deepEqual(rolledBack.executions,before.executions);assert.deepEqual(rolledBack.handoffs,before.handoffs);
  } finally {core[key]=original;resume();}
  const completed=await pending;assert.equal(completed.state,'provider_completed');
  let after=await f.core.command('snapshot',{});assert.deepEqual(after.executions[completed.id],completed);assert.equal(after.handoffs[review.id].state,'applied');
  assert.equal(after.graph.messages.filter(item=>item.content==='INTEGRATION_OK').length,1);
  assert.equal(after.graph.messages.some(item=>item.content==='What time is it?'),false);
  await f.reopen();after=await f.core.command('snapshot',{});assert.deepEqual(after.executions[completed.id],completed);assert.equal(after.handoffs[review.id].state,'applied');
});
