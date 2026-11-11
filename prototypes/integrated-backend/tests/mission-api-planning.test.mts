import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv,createDecipheriv,randomBytes,randomUUID } from 'node:crypto';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,relative,resolve,isAbsolute } from 'node:path';
import { BackendCore } from '../src/core.mts';
import { nativeMissionExecutors, missionResultAvailable } from '../src/mission-native.mts';
import type { MissionPlanningOffer,MissionPreview,MissionProjection } from '../src/mission-contracts.mts';
import type { NativeHostServices } from '../src/native-host.mts';
import type { VelaBackendState } from '../src/contracts.mts';
const objective='Can you investigate why the Minecraft server is lagging?';
const marker='SYNTHETIC_ONLY_MISSION_API_KEY';
const graph={tasks:[{capability:'cpu',after:[]},{capability:'ram',after:[]},{capability:'backend',after:['cpu','ram']}],unsupported:['Server tick timings and logs are unavailable.']};
function response(content:string,model:string,terminal:string|null=content) {
  const id='synthetic-'+randomUUID(),output=[{type:'message',id:'message-'+id,role:'assistant',status:'completed',content:terminal===null?[{type:'refusal',refusal:'Synthetic terminal refusal'}]:[{type:'output_text',text:terminal,annotations:[]}]}];
  return new Response([{type:'response.created',response:{id,status:'in_progress'}},{type:'response.output_text.delta',delta:content},{type:'response.completed',response:{id,status:'completed',model,output,
    usage:{input_tokens:100,output_tokens:40,total_tokens:140}}}].map(event=>'data: '+JSON.stringify(event)+'\n\n').join(''),{headers:{'Content-Type':'text/event-stream'}});
}
function fixture(velaHistoryContext = false) {
  const base=resolve(tmpdir()),directory=mkdtempSync(join(base,'aerynth-mission-api-')),path=join(directory,'canonical.sqlite'),key=randomBytes(32),requests:any[]=[],replies:((body:any)=>Response|Promise<Response>)[]=[];
  const native:NativeHostServices={secrets:{available:async()=>true,
    seal:async value=>{const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,cipher.update(value),cipher.final(),cipher.getAuthTag()]);},
    open:async value=>{const data=Buffer.from(value),cipher=createDecipheriv('aes-256-gcm',key,data.subarray(0,12));cipher.setAuthTag(data.subarray(-16));return Buffer.concat([cipher.update(data.subarray(12,-16)),cipher.final()]).toString();}}};
  const api={fetch:(async(url,init)=>{if(String(url)==='https://api.openai.com/v1/models')return Response.json({data:[{id:'gpt-6-luna'},{id:'gpt-6.1-sol'}]});
    assert.equal(String(url),'https://api.openai.com/v1/responses');assert.equal(new Headers(init?.headers).get('authorization'),'Bearer '+marker);
    const body=JSON.parse(String(init?.body));requests.push(body);const next=replies.shift();assert.ok(next,'unexpected API inference');return next(body);}) as typeof fetch};
  const create=()=>new BackendCore({path,provider:'fixture',contentPolicy:'synthetic-only',velaHistoryContext},()=>{},native,undefined,api);let core=create();
  const preview=async(text=objective)=>await core.command('missions',{name:'preview',input:{objective:text}}) as MissionPlanningOffer;
  const plan=async(offer:MissionPlanningOffer,requestId=randomUUID())=>await core.command('missionPlanReviewed',{objective:offer.objective,fingerprint:offer.fingerprint,requestId}) as MissionPreview;
  return {get core(){return core;},requests,replies,preview,plan,
    async ready(){await core.command('velaApiConfigure',{credential:{configurationId:'vela-primary',apiKey:marker},expectedVersion:null});await core.command('velaApiUsageAuthorize',{expectedVersion:1,enabled:true});await core.command('desktop',{type:'createWorkspace',title:'Synthetic Minecraft investigation',projectId:null});},
    async pin(defaults:any){if(defaults.providerId==='openai-api-vela')await core.command('vela',{name:'routingOptions',input:{providerId:'openai-api-vela'}});await core.command('vela',{name:'saveRoutingSettings',input:{scope:'global',id:null,expectedVersion:0,defaults}});},
    async reopen(){await core.command('close',{});core=create();},
    async close(){await core.command('close',{}).catch(()=>{});const part=relative(base,resolve(directory));assert.ok(part.startsWith('aerynth-mission-api-')&&!part.startsWith('..')&&!isAbsolute(part));rmSync(directory,{recursive:true,force:true});},
  };
}

test('actual Core natural Minecraft investigation makes one authorized API graph request, verifies host data and reports incomplete whole-objective coverage',async()=>{
  const f=fixture();try{
    await f.ready();const offer=await f.preview();assert.equal(offer.kind,'planning-offer');assert.equal(offer.planner?.provider,'openai-api-vela');assert.equal(f.requests.length,0);
    await assert.rejects(f.core.command('missions',{name:'plan',input:{objective,fingerprint:offer.fingerprint,requestId:randomUUID()}}),/invalid_mission_command/);
    f.replies.push(body=>{assert.equal(body.model,'gpt-6-luna');assert.equal(body.store,false);assert.equal(body.tools,undefined);assert.equal(body.text.format.type,'json_schema');
      const payload=JSON.parse(body.input[0].content);assert.equal(payload.objective,objective);assert.ok(!payload.capabilities.some((item:any)=>/server.*(?:log|process)/iu.test(item.description)));return response(JSON.stringify(graph),body.model);});
    const id=randomUUID(),planned=await f.plan(offer,id);assert.equal(f.requests.length,1);assert.equal(planned.plan.planning?.provider,'openai-api-vela');assert.equal(planned.plan.planning?.usage?.totalTokens,140);
    assert.equal(planned.plan.coverage?.status,'partial');assert.match(planned.plan.coverage!.limitations.join(' '),/Minecraft server logs.*TPS.*network/);
    assert.equal((await f.core.command('missions',{name:'list',input:{}}) as any[]).length,0,'planning must not start execution');
    await assert.rejects(f.plan(offer,id),/mission_planning_already_attempted/);assert.equal(f.requests.length,1);
    const running=await f.core.command('missions',{name:'start',input:{objective,proposalId:id,requestId:id,fingerprint:planned.fingerprint}}) as MissionProjection;
    let settled=running;for(let attempt=0;attempt<150;attempt++){settled=await f.core.command('missions',{name:'read',input:{id:running.id}}) as MissionProjection;if(!['running','queued'].includes(settled.outcome))break;await new Promise(done=>setTimeout(done,10));}
    assert.equal(settled.outcome,'blocked');assert.ok(settled.tasks.every(task=>task.state==='verified'));assert.equal(missionResultAvailable(settled),true);
    const cpu=settled.tasks.find(task=>task.executor==='sample.cpu')!,ram=settled.tasks.find(task=>task.executor==='sample.ram')!,backend=settled.tasks.find(task=>task.executor==='sample.backend')!;
    assert.equal(cpu.attempts[0].evidence?.source,'node:os.cpus');assert.equal(ram.attempts[0].evidence?.source,'node:os.totalmem+freemem');assert.equal(backend.attempts[0].evidence?.source,'aerynth.backend.node');
    assert.ok(cpu.attempts[0].verification?.passed&&ram.attempts[0].verification?.passed&&backend.attempts[0].verification?.passed);
    assert.ok(Date.parse(backend.attempts[0].admittedAt)>=Math.max(Date.parse(cpu.attempts[0].finishedAt!),Date.parse(ram.attempts[0].finishedAt!)),'dependent backend task started before its verified prerequisites');
    assert.equal(settled.profile.verifiedObjectivesPerReportedToken,null,'partial evidence must not count as a verified user objective');
    const readProfile=()=>f.core.command('missions',{name:'execution-profile',input:{id:running.id}});
    const profile=await readProfile();
    assert.ok(profile&&'kind' in profile&&profile.kind==='execution-profile');
    const timing=profile.planning?.timing;
    assert.ok(timing&&timing.firstTextDeltaMs!==null&&timing.responseCreatedMs!==null);
    assert.ok(timing.responseCreatedMs<=timing.firstTextDeltaMs&&timing.firstTextDeltaMs<=timing.providerResultMs);
    assert.ok(timing.validationMs>=0&&timing.providerResultMs+timing.validationMs<=profile.planning!.durationMs);
    assert.equal(profile.planning?.providerEvidence,'simulated');
    const state=await f.core.command('vela',{name:'state',input:{}}) as VelaBackendState;
    const report=state.conversation!.messages.find(message=>message.missionReport?.missionId===running.id)!;assert.ok(report);assert.equal(report.source,'vela-native');
    assert.match(report.content,/investigation remains incomplete/);assert.match(report.content,/CPU.*RAM/su);assert.match(report.content,/cannot establish the server lag cause/);assert.doesNotMatch(report.content,/server lag (?:is caused|was fixed)/iu);
    await f.reopen();const restored=await f.core.command('missions',{name:'read',input:{id:running.id}}) as MissionProjection;
    assert.equal(restored.outcome,'blocked');assert.deepEqual(restored.coverage,settled.coverage);assert.equal(f.requests.length,1);
    const restoredProfile=await readProfile();
    assert.ok(restoredProfile&&'kind' in restoredProfile&&restoredProfile.kind==='execution-profile');
    assert.deepEqual(restoredProfile.planning,profile.planning);
    assert.equal((await f.core.command('providerActivity',{})).codexConnections,0);
  }finally{await f.close();}
});

test('actual Core API planning honors explicit provider/model/effort defaults and never silently switches a ChatGPT pin',async()=>{
  const pinned=fixture();try{await pinned.ready();await pinned.pin({providerId:'chatgpt-plan-responses'});const offer=await pinned.preview();assert.equal(offer.planner,undefined);assert.equal(pinned.requests.length,0);}finally{await pinned.close();}
  const f=fixture();try{
    await f.ready();await f.pin({providerId:'openai-api-vela',model:'gpt-6.1-sol',reasoningEffort:'high'});const offer=await f.preview();assert.equal(offer.planner?.model,'gpt-6.1-sol');
    f.replies.push(body=>{assert.equal(body.model,'gpt-6.1-sol');assert.deepEqual(body.reasoning,{effort:'high'});return response(JSON.stringify(graph),body.model);});
    await f.plan(offer);assert.equal(f.requests.length,1);
  }finally{await f.close();}
});

test('actual Core API mission planning revalidates revocation, navigation, settings and storage admission before any dispatch',async()=>{
  for(const change of ['usage','navigation','settings','storage'] as const){const f=fixture();try{
    await f.ready();const offer=await f.preview();
    if(change==='usage')await f.core.command('velaApiUsageAuthorize',{expectedVersion:1,enabled:false});
    if(change==='navigation')await f.core.command('desktop',{type:'createWorkspace',title:'Different synthetic scope',projectId:null});
    if(change==='settings')await f.pin({providerId:'codex-app-server'});
    if(change==='storage')(f.core as any).missionStorageAdmitted=false;
    await assert.rejects(f.plan(offer),/mission_preview_changed|mission_planner_unavailable|mission_planning_scope_changed/);assert.equal(f.requests.length,0);
  }finally{await f.close();}}
});

test('actual Core unsupported graph capabilities and ambiguous JSON cannot invent server or tool access',async()=>{
  for(const content of [JSON.stringify({tasks:[{capability:'cpu',after:[]},{capability:'minecraft-server-logs',after:[]}],unsupported:[]}),
    '{"tasks":[],"tasks":[{"capability":"cpu","after":[]},{"capability":"ram","after":[]}],"unsupported":[]}']){
    const f=fixture();try{await f.ready();const offer=await f.preview();f.replies.push(body=>response(content,body.model));await assert.rejects(f.plan(offer),/mission_proposal_unknown_capability|invalid_mission_proposal/);
      assert.deepEqual(await f.core.command('missions',{name:'list',input:{}}),[]);assert.equal(f.requests.length,1);
    }finally{await f.close();}}
});

test('actual Core unknown API graph dispatch is never automatically retried across restart',async()=>{
  const f=fixture();try{await f.ready();const offer=await f.preview(),id=randomUUID();f.replies.push(()=>{throw Error('synthetic network loss after dispatch');});
    await assert.rejects(f.plan(offer,id));assert.equal(f.requests.length,1);await f.reopen();await assert.rejects(f.plan(await f.preview(),id),/mission_planning_already_attempted/);assert.equal(f.requests.length,1);
    assert.deepEqual(await f.core.command('missions',{name:'list',input:{}}),[]);
  }finally{await f.close();}
});

test('host-owned coverage cannot be removed by a planner claiming a complete investigation or an explicit mission prefix',async()=>{
  for(const text of [objective,'Run a mission to investigate why the Minecraft server is lagging']){
    const f=fixture();try{await f.ready();const offer=await f.preview(text);f.replies.push(body=>response(JSON.stringify({...graph,unsupported:[]}),body.model));const planned=await f.plan(offer);
      assert.equal(planned.plan.coverage?.status,'partial');assert.match(planned.plan.coverage!.limitations.join(' '),/Minecraft server logs.*cannot establish/su);
    }finally{await f.close();}
  }
});

test('native domain verifiers reject malformed measured evidence instead of accepting an agent JSON success claim',()=>{
  const evidence:any={id:'synthetic-evidence',source:'provider:reported',value:{status:'success',percent:0,metric:'cpu'},attemptId:'synthetic-attempt',observedAt:new Date().toISOString()};
  for(const executor of ['sample.cpu','sample.ram','sample.backend','inspect.backend-source'])assert.equal(nativeMissionExecutors[executor].verify(evidence,{} as any).passed,false,executor);
});

test('native semantic shadow dispatch uses strict output and denies revoked admission', async () => {
  const f = fixture(true);
  try {
    await f.ready();
    const intent = 'Which safeguard stopped the batch from being applied twice?';
    const before = (await f.core.command('vela', {name:'state',input:{}}) as VelaBackendState).conversation;
    let allow = false;
    const admission = { configurationVersion: 1, model: 'gpt-6-luna', authorize: () => allow };
    assert.equal((await f.core.investigateVelaHistory(intent, admission)).state, 'unavailable');
    assert.equal(f.requests.length, 0);

    allow = true;
    const perception = { kind: 'recall', explicitGoals: ['Identify the safeguard'], inferredGoals: [],
      constraints: [], capabilityHints: [], deliverables: ['text'], verification: ['Cite the relevant exchange'] };
    f.replies.push(body => {
      assert.equal(body.model, admission.model);
      assert.equal(body.store, false);
      assert.equal(body.text.format.strict, true);
      assert.equal(body.tools, undefined);
      assert.match(JSON.stringify(body.input), /Which safeguard/);
      return response(JSON.stringify({ version: 2, objective: 'Locate the duplication safeguard', clarification: '', perception,
        needs: [{ key: 'safeguard', question: 'Which safeguard was selected?', query: 'duplicate batch' }] }), body.model);
    });
    f.replies.push(body => {
      assert.match(JSON.stringify(body.input), /excerpts/);
      assert.match(JSON.stringify(body.input), /duplicate batch/);
      return response(JSON.stringify({ version: 1, assessment: [{ key: 'safeguard', status: 'missing', sources: [], query: '' }] }), body.model);
    });
    const found = await f.core.investigateVelaHistory(intent, admission);
    assert.equal(found.state, 'assessed');
    assert.equal(found.proposal?.version, 2);
    assert.deepEqual(found.coverage, [{ key: 'safeguard', status: 'missing', sources: [] }]);
    assert.equal(f.requests.length, 2);
    const validDelta = JSON.stringify({ version: 2, objective: 'No source required', clarification: '', needs: [], perception });
    for (const terminal of [null, validDelta.replace('No source required', 'Different terminal result')]) {
      f.replies.push(body => response(validDelta, body.model, terminal));
      assert.equal((await f.core.investigateVelaHistory(intent, admission)).state, 'unavailable');
    }
    assert.equal(f.requests.length, 4);
    assert.deepEqual((await f.core.command('vela', {name:'state',input:{}}) as VelaBackendState).conversation, before);
  } finally { await f.close(); }
});

test('Executive reviews a real native mission checkpoint through the synthetic Responses transport', async () => {
  const f = fixture();
  try {
    await f.ready();
    const objective = 'Measure CPU and RAM';
    const planned = await f.core.command('missions', { name: 'preview', input: { objective } }) as MissionPreview;
    const started = await f.core.command('missions', { name: 'start',
      input: { objective, requestId: randomUUID(), fingerprint: planned.fingerprint } }) as MissionProjection;
    let settled = started;
    for (let attempt = 0; attempt < 150 && ['queued', 'running'].includes(settled.outcome); attempt++) {
      await new Promise(done => setTimeout(done, 10));
      settled = await f.core.command('missions', { name: 'read', input: { id: started.id } }) as MissionProjection;
    }
    assert.equal(settled.outcome, 'verified');
    const trigger = settled.events.findLast(event => event.kind === 'settled')!;
    const options = { configurationVersion: 1, model: 'gpt-6-luna', authorize: () => false };
    assert.equal((await f.core.proposeVelaMissionRevision(started.id, trigger.seq, options)).state, 'unavailable');
    assert.equal(f.requests.length, 0);
    f.replies.push(body => {
      assert.equal(body.text.format.strict, true);
      assert.equal(body.tools, undefined);
      assert.match(JSON.stringify(body.input), /basedOnPlanRevision/);
      return response(JSON.stringify({ version: 1, action: 'request-completion-review', target: '', related: [],
        reason: 'Check the native verification receipts before reporting completion.' }), body.model);
    });
    const result = await f.core.proposeVelaMissionRevision(started.id, trigger.seq, { ...options, authorize: review => {
      assert.equal(review.packet.basedOnRevision, settled.revision);
      assert.equal(review.packet.trigger.sequence, trigger.seq);
      return true;
    } });
    assert.equal(result.state, 'advisory');
    assert.equal(f.requests.length, 1);
    const after = await f.core.command('missions', { name: 'read', input: { id: started.id } }) as MissionProjection;
    assert.equal(after.revision, settled.revision);
    assert.deepEqual(after.tasks, settled.tasks);
  } finally { await f.close(); }
});

test('reviewed API mission planning rejects a terminal response that disagrees with streamed plan text', async () => {
  const f = fixture();
  try {
    await f.ready();
    const offer = await f.preview();
    const validDelta = JSON.stringify(graph);
    f.replies.push(body => response(validDelta, body.model, null));
    await assert.rejects(f.plan(offer), /vela_api_proposal_unconfirmed/);
    assert.equal(f.requests.length, 1);
    assert.deepEqual(await f.core.command('missions', { name: 'list', input: {} }), []);
  } finally { await f.close(); }
});
