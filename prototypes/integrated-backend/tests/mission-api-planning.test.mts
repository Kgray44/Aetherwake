import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv,createDecipheriv,createHash,randomBytes,randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtempSync,rmSync,writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join,relative,resolve,isAbsolute } from 'node:path';
import { BackendCore } from '../src/core.mts';
import { nativeMissionExecutors, missionResultAvailable } from '../src/mission-native.mts';
import type { MissionExecutor,MissionPlanningOffer,MissionPreview,MissionProjection } from '../src/mission-contracts.mts';
import type { NativeHostServices } from '../src/native-host.mts';
import type { ProviderPort, VelaBackendState, VelaNativeReview } from '../src/contracts.mts';
import { createMissionProjectCheck } from '../src/mission-project-check.mts';
import { planningDigest } from '../../vela-core/src/codex-planning-adapter.mts';
import type { VelaRequest } from '../../vela-core/src/contracts.ts';
import type { VelaApiRuntime } from '../src/vela-api-runtime.mts';
import type { NativeDocumentTextServices } from '../src/document-text-host.mts';
import { docxFixture } from '../../block-library/tests/media-fixtures.mts';
const objective='Can you investigate why the Minecraft server is lagging?';
const marker='SYNTHETIC_ONLY_MISSION_API_KEY';
const graph={tasks:[{capability:'cpu',after:[]},{capability:'ram',after:[]},{capability:'backend',after:['cpu','ram']}],unsupported:['Server tick timings and logs are unavailable.']};
function response(content:string,model:string,terminal:string|null=content, fragments: readonly string[] = [content]) {
  const id='synthetic-'+randomUUID(),output=[{type:'message',id:'message-'+id,role:'assistant',status:'completed',content:terminal===null?[{type:'refusal',refusal:'Synthetic terminal refusal'}]:[{type:'output_text',text:terminal,annotations:[]}]}];
  return new Response([{type:'response.created',response:{id,status:'in_progress'}},...fragments.map(delta=>({type:'response.output_text.delta',delta})),{type:'response.completed',response:{id,status:'completed',model,output,
    usage:{input_tokens:100,output_tokens:40,total_tokens:140}}}].map(event=>'data: '+JSON.stringify(event)+'\n\n').join(''),{headers:{'Content-Type':'text/event-stream'}});
}
function fixture(velaHistoryContext = false, nativeMedia = false, documents?: NativeDocumentTextServices) {
  const base=resolve(tmpdir()),directory=mkdtempSync(join(base,'aerynth-mission-api-')),path=join(directory,'canonical.sqlite'),key=randomBytes(32),requests:any[]=[],replies:((body:any)=>Response|Promise<Response>)[]=[];
  let catalogModels = ['gpt-6-luna', 'gpt-6.1-sol'];
  let beforeCredentialOpen: (() => Promise<void>) | undefined;
  const native:NativeHostServices={documents,secrets:{available:async()=>true,
    seal:async value=>{const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,cipher.update(value),cipher.final(),cipher.getAuthTag()]);},
    open:async value=>{const before=beforeCredentialOpen;beforeCredentialOpen=undefined;await before?.();
      const data=Buffer.from(value),cipher=createDecipheriv('aes-256-gcm',key,data.subarray(0,12));cipher.setAuthTag(data.subarray(-16));return Buffer.concat([cipher.update(data.subarray(12,-16)),cipher.final()]).toString();}}};
  const api={fetch:(async(url,init)=>{if(String(url)==='https://api.openai.com/v1/models')return Response.json({data:catalogModels.map(id=>({id}))});
    assert.equal(String(url),'https://api.openai.com/v1/responses');assert.equal(new Headers(init?.headers).get('authorization'),'Bearer '+marker);
    const body=JSON.parse(String(init?.body));requests.push(body);const next=replies.shift();assert.ok(next,'unexpected API inference');return next(body);}) as typeof fetch};
  const create=()=>new BackendCore({path,provider:'fixture',contentPolicy:'synthetic-only',velaHistoryContext,nativeMedia},()=>{},native,undefined,api);let core=create();
  const preview=async(text=objective)=>await core.command('missions',{name:'preview',input:{objective:text}}) as MissionPlanningOffer;
  const plan=async(offer:MissionPlanningOffer,requestId=randomUUID())=>await core.command('missionPlanReviewed',{objective:offer.objective,fingerprint:offer.fingerprint,requestId}) as MissionPreview;
  return {get core(){return core;},directory,requests,replies,preview,plan,
    setCatalogModels(models: string[]) { catalogModels = models; },
    onNextCredentialRead(action: () => Promise<void>) { beforeCredentialOpen = action; },
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
    const state=await f.core.command('vela',{name:'state',input:{}}) as VelaBackendState;
    const report=state.conversation!.messages.find(message=>message.missionReport?.missionId===running.id)!;assert.ok(report);assert.equal(report.source,'vela-native');
    assert.match(report.content,/investigation remains incomplete/);assert.match(report.content,/CPU.*RAM/su);assert.match(report.content,/cannot establish the server lag cause/);assert.doesNotMatch(report.content,/server lag (?:is caused|was fixed)/iu);
    await f.reopen();const restored=await f.core.command('missions',{name:'read',input:{id:running.id}}) as MissionProjection;
    assert.equal(restored.outcome,'blocked');assert.deepEqual(restored.coverage,settled.coverage);assert.equal(f.requests.length,1);
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
      assert.match(JSON.stringify(body.input), /Which safeguard stopped the batch/);
      assert.deepEqual(body.text.format.schema.properties.version.enum, [3]);
      assert.match(JSON.stringify(body.input), /duplicate batch/);
      return response(JSON.stringify({ version: 3, clarification: '', assessment: [{ key: 'safeguard', status: 'missing', passages: [], query: '' }] }), body.model);
    });
    const found = await f.core.investigateVelaHistory(intent, admission);
    assert.equal(found.state, 'assessed');
    assert.equal(found.proposal?.version, 2);
    assert.deepEqual(found.coverage, [{ key: 'safeguard', status: 'missing', sources: [], passages: [] }]);
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
    const request = { id: started.id, revision: settled.revision, triggerSeq: trigger.seq };
    const review = await f.core.command('missionExecutiveReview', request);
    assert.equal(review.packet.basedOnRevision, settled.revision);
    assert.equal(review.packet.trigger.sequence, trigger.seq);
    await assert.rejects(f.core.command('missionExecutiveReviewed', { ...request, fingerprint: 'wrong' }), /mission_executive_review_changed/);
    assert.equal(f.requests.length, 0);
    const approved = { ...request, fingerprint: review.fingerprint };
    const require = createRequire(import.meta.url);
    const { reviewMissionExecutive } = require('../../visual-experience/cinematic-v3/native/mission-executive-broker.cjs');
    const { reviewPage } = require('../../visual-experience/cinematic-v3/native/vela-review.cjs');
    let current = true;
    const broker = { request, parent: {}, call: f.core.command.bind(f.core), isCurrent: () => current, allowWrite: async () => true };
    await assert.rejects(reviewMissionExecutive({ ...broker, reviewProvider: async () => false }), /mission_review_declined/);
    await assert.rejects(reviewMissionExecutive({ ...broker, reviewProvider: async () => true,
      allowWrite: async () => { current = false; return true; } }), /unauthorized_sender/);
    assert.equal(f.requests.length, 0);
    current = true;
    const result = await reviewMissionExecutive({ ...broker, reviewProvider: async ({ review: nativeReview }: { review: unknown }) => {
      assert.match(reviewPage(nativeReview), /one request with the mission objective/);
      assert.match(reviewPage(nativeReview), /basedOnPlanRevision/);
      return true;
    } }) as Awaited<ReturnType<typeof f.core.command<'missionExecutiveReviewed'>>>;
    assert.equal(result.result.state, 'advisory');
    await assert.rejects(f.core.command('missionExecutiveReviewed', approved), /mission_executive_already_attempted/);
    await f.pin({ providerId: 'openai-api-vela', model: 'gpt-6.1-sol', reasoningEffort: 'high' });
    const differentRoute = await f.core.command('missionExecutiveReview', request);
    assert.equal(differentRoute.model, 'gpt-6.1-sol');
    assert.notEqual(differentRoute.fingerprint, review.fingerprint);
    await assert.rejects(f.core.command('missionExecutiveReviewed', { ...request, fingerprint: differentRoute.fingerprint }), /mission_executive_already_attempted/);
    assert.equal(f.requests.length, 1);
    const after = await f.core.command('missions', { name: 'read', input: { id: started.id } }) as MissionProjection;
    assert.equal(after.revision, settled.revision);
    assert.deepEqual(after.tasks, settled.tasks);
    assert.deepEqual(after.cognitiveReceipts?.runs.map(run => run.attribution.stage), ['executive']);
    assert.deepEqual(after.cognitiveReceipts?.runs[0].attribution.owner,
      { kind: 'checkpoint', missionId: started.id, revision: settled.revision, planRevision: settled.planRevision, triggerSeq: trigger.seq });
  } finally { await f.close(); }
});

test('native Executive specialist advice is visible without starting a specialist', async () => {
  const f = fixture();
  try {
    await f.ready();
    const { missionExecutors } = f.core as unknown as { missionExecutors: Record<string, MissionExecutor> };
    const ram = missionExecutors['sample.ram'];
    missionExecutors['sample.ram'] = {
      ...ram,
      verify: () => ({ passed: false, detail: 'Controlled failure of memory verification.' }),
    };
    const objective = 'Measure CPU and RAM';
    const preview = await f.core.command('missions', { name: 'preview', input: { objective } }) as MissionPreview;
    const started = await f.core.command('missions', { name: 'start',
      input: { objective, requestId: randomUUID(), fingerprint: preview.fingerprint } }) as MissionProjection;
    const read = () => f.core.command('missions', { name: 'read', input: { id: started.id } }) as Promise<MissionProjection>;
    let settled = await read();
    for (let attempt = 0; attempt < 150 && ['queued', 'running'].includes(settled.outcome); attempt++) {
      await new Promise(done => setTimeout(done, 10));
      settled = await read();
    }
    const task = settled.tasks.find(row => row.executor === 'sample.ram')!;
    assert.equal(task.state, 'failed');
    const request = { id: started.id, revision: settled.revision, triggerSeq: settled.events.findLast(row => row.kind === 'settled')!.seq };
    const review = await f.core.command('missionExecutiveReview', request);
    const handle = review.packet.tasks.find(row => row.executor === 'sample.ram')!.handle;
    f.replies.push(body => {
      assert.ok(body.text.format.schema.properties.action.enum.includes('recommend-specialist'));
      assert.equal(body.tools, undefined);
      return response(JSON.stringify({ version: 1, action: 'recommend-specialist', target: handle, related: [],
        reason: 'An operating-system diagnostics specialist could review the memory sample and verifier.' }), body.model);
    });
    const require = createRequire(import.meta.url);
    const { reviewMissionExecutive } = require('../../visual-experience/cinematic-v3/native/mission-executive-broker.cjs');
    const broker = { request, parent: {}, call: f.core.command.bind(f.core), isCurrent: () => true, allowWrite: async () => true };
    await assert.rejects(reviewMissionExecutive({ ...broker, reviewProvider: async () => false }), /mission_review_declined/);
    assert.equal(f.requests.length, 0);
    const { result } = await reviewMissionExecutive({ ...broker, reviewProvider: async () => true }) as
      Awaited<ReturnType<typeof f.core.command<'missionExecutiveReviewed'>>>;
    assert.equal(result.state, 'advisory');
    if (result.state !== 'advisory' || result.action !== 'recommend-specialist') assert.fail();
    assert.equal(result.taskId, task.id);
    assert.equal(f.requests.length, 1);
    const after = await read();
    assert.equal(after.revision, settled.revision);
    assert.deepEqual(after.tasks, settled.tasks);
  } finally { await f.close(); }
});

test('Executive assessment records canonical observations and unresolved objective gaps across restart', async () => {
  const f = fixture();
  try {
    await f.ready();
    const offer = await f.preview();
    const requestId = randomUUID();
    f.replies.push(body => response(JSON.stringify(graph), body.model));
    const planned = await f.plan(offer, requestId);
    const started = await f.core.command('missions', { name: 'start', input: {
      objective, proposalId: requestId, requestId, fingerprint: planned.fingerprint,
    } }) as MissionProjection;
    const read = () => f.core.command('missions', { name: 'read', input: { id: started.id } }) as Promise<MissionProjection>;
    let settled = started;
    for (let attempt = 0; attempt < 150 && ['queued', 'running'].includes(settled.outcome); attempt++) {
      await new Promise(done => setTimeout(done, 10));
      settled = await read();
    }
    assert.equal(settled.outcome, 'blocked');
    const chatReports = async () => (await f.core.command('vela', { name: 'state', input: {} }) as VelaBackendState)
      .conversation!.messages.filter(message => message.missionReport?.missionId === started.id);
    const [priorReport] = await chatReports();
    assert.ok(priorReport?.missionReport);
    assert.equal(priorReport.missionReport.assessment, undefined);
    const checkpoint = settled.events.findLast(event => event.kind === 'settled')!;
    const request = { id: settled.id, revision: settled.revision, triggerSeq: checkpoint.seq };
    const review = await f.core.command('missionExecutiveReview', request);
    const observation = review.packet.completion!.observations.find(item => item.kind === 'sample.ram')!;
    const ram = settled.tasks.find(task => task.executor === 'sample.ram')!;
    const ramEvidence = ram.attempts.at(-1)!.evidence!;
    assert.deepEqual(Object.keys(observation.values), ['utilizationPercent', 'totalBytes', 'availableBytes']);
    assert.ok(!review.packet.completion!.observations.some(item => item.kind === 'join.samples'));
    const require = createRequire(import.meta.url);
    const { reviewMissionExecutive } = require('../../visual-experience/cinematic-v3/native/mission-executive-broker.cjs');
    const { reviewPage } = require('../../visual-experience/cinematic-v3/native/vela-review.cjs');
    const broker = { request, parent: {}, call: f.core.command.bind(f.core), isCurrent: () => true, allowWrite: async () => true };
    await assert.rejects(reviewMissionExecutive({ ...broker, reviewProvider: async () => false }), /mission_review_declined/);
    assert.equal(f.requests.length, 1);
    f.replies.push(body => {
      const packet = JSON.parse(body.input[0].content);
      assert.deepEqual(packet.completion, review.packet.completion);
      assert.equal(body.tools, undefined);
      return response(JSON.stringify({ version: 1, findings: [
        { status: 'supported', statement: 'The server lag is definitely fixed.', evidence: [observation.handle] },
        { status: 'unverified', statement: 'Server tick timings and logs are needed to establish the cause.', evidence: [] },
      ] }), body.model);
    });
    const result = await reviewMissionExecutive({ ...broker, reviewProvider: async ({ review: nativeReview }: { review: unknown }) => {
      assert.match(reviewPage(nativeReview), /checked observations/);
      return true;
    } }) as Awaited<ReturnType<typeof f.core.command<'missionExecutiveReviewed'>>>;
    assert.equal(result.result.state, 'completion-assessed');
    const assessed = await read();
    assert.equal(assessed.outcome, 'blocked');
    assert.deepEqual(assessed.tasks, settled.tasks);
    assert.equal(assessed.events.at(-1)?.kind, 'objective-assessed');
    assert.equal(assessed.objectiveAssessment?.triggerSeq, checkpoint.seq);
    assert.deepEqual(assessed.objectiveAssessment?.findings[0].evidence, [{ taskId: ram.id, evidenceId: ramEvidence.id }]);
    assert.match(assessed.objectiveAssessment!.findings[0].statement, /^RAM \d/);
    assert.doesNotMatch(JSON.stringify(assessed.objectiveAssessment), /definitely fixed/);
    assert.match(assessed.objectiveAssessment!.findings[1].statement, /tick timings and logs/);
    const reports = await chatReports();
    assert.equal(reports.length, 1);
    const [currentReport] = reports;
    assert.equal(currentReport.id, priorReport.id);
    assert.equal(currentReport.content, priorReport.content);
    assert.deepEqual(currentReport.missionReport?.assessment, { model: 'gpt-6-luna', planRevision: settled.planRevision,
      gaps: ['Server tick timings and logs are needed to establish the cause.'] });
    await assert.rejects(f.core.command('missionExecutiveReview', { ...request, revision: assessed.revision }), /mission_executive_already_attempted/);
    await f.reopen();
    assert.deepEqual((await read()).objectiveAssessment, assessed.objectiveAssessment);
    assert.deepEqual(await chatReports(), reports);
    assert.equal(f.requests.length, 2);
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

test('preselected tracked tests bind provider review and Start without disclosing local checkout data',
  { skip: process.platform !== 'win32' }, async () => {
  const f = fixture(true);
  const base = resolve(homedir());
  const repo = mkdtempSync(join(base, 'aerynth-reviewed-tests-'));
  try {
    const path = join(repo, 'harness.test.mjs'), secondPath = join(repo, 'alternative.test.mjs');
    const source = 'export const observed = true;\n';
    writeFileSync(path, source);
    writeFileSync(secondPath, source);
    const git = (...args: string[]) => execFileSync('git.exe', ['-C', repo, '-c', 'core.hooksPath=NUL', ...args],
      { stdio: 'pipe', windowsHide: true, timeout: 5000 });
    git('init', '-q', '--template=');
    git('add', '.');
    const commit = (message: string) => git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
      '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-qm', message);
    commit('Track two test fixtures');
    await f.ready();
    let effects = 0;
    const runner = { ready: async () => true, execute: async (argv: string[], cwd: string) => {
      effects++;
      assert.equal(cwd.toLowerCase(), repo.toLowerCase());
      assert.equal(argv.at(-1), './harness.test.mjs');
      return { exitCode: 0, stderr: '', stdout: 'TAP version 13\nok 1 - fixture\n1..1\n# tests 1\n# suites 0\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 1\n' };
    } };
    const host = f.core as unknown as { port: ProviderPort; missionExecutors: Record<string, MissionExecutor> };
    host.port.projectChecks = runner;
    host.missionExecutors['codex.project-check'] = createMissionProjectCheck({ runner, digest: planningDigest, lease: () => () => {} });
    const objective = 'Plan a mission to run my chosen check and measure physical RAM.';
    const workspace = await f.core.command('desktop', { type: 'snapshot' });
    const created = await f.core.command('desktop', { type: 'createResource', kind: 'note', title: 'Check instructions',
      workspaceId: workspace.activeWorkspaceId });
    const note = created.resources.find(item => item.title === 'Check instructions')!;
    const content = 'Run the operator-selected tracked test and measure physical RAM.';
    await f.core.command('desktop', { type: 'content', resourceId: note.id, expectedVersion: note.version, content });
    const selection = { objective, noteIds: [note.id] };
    const offer = await f.core.command('missions', { name: 'preview', input: selection }) as MissionPlanningOffer;
    assert.equal(offer.planner?.projectCheck, true);
    const check = await f.core.command('missionCheckReview', { paths: [path] });
    const approvedProjectCheck = { paths: [path], digest: check.digest };
    const baseReview = { ...selection, fingerprint: offer.fingerprint, approvedProjectCheck };
    const reviewed = await f.core.command('missionPlanningReview', baseReview);
    const checkContext = { files: ['harness.test.mjs'], commandKind: 'node-test',
      commandState: 'validated-locally', requiresStartApproval: true };
    assert.deepEqual(reviewed.projectCheck?.context, checkContext);
    const requestId = randomUUID();
    const input = { ...baseReview, requestId, projectCheckReviewFingerprint: reviewed.projectCheck!.fingerprint };
    await assert.rejects(f.core.command('missionPlanReviewed', { ...input, projectCheckReviewFingerprint: 'f'.repeat(64) }),
      /mission_project_check_scope_changed/);
    await assert.rejects(f.core.command('missionPlanReviewed', { ...input, approvedProjectCheck: { ...approvedProjectCheck, paths: [secondPath] } }),
      /mission_project_check_scope_changed/);
    writeFileSync(path, 'export const observed = false;\n');
    await assert.rejects(f.core.command('missionPlanReviewed', input), /mission_project_check_scope_changed/);
    writeFileSync(path, source);
    await f.core.command('velaApiUsageAuthorize', { expectedVersion: 1, enabled: false });
    await assert.rejects(f.core.command('missionPlanReviewed', input), /mission_preview_changed/);
    assert.equal(f.requests.length, 0);
    await f.core.command('velaApiUsageAuthorize', { expectedVersion: 1, enabled: true });
    const freshCheck = await f.core.command('missionCheckReview', { paths: [path] });
    const freshSelection = { paths: [path], digest: freshCheck.digest };
    const freshReview = await f.core.command('missionPlanningReview', { ...baseReview, approvedProjectCheck: freshSelection });
    const perceive = (key: string) => ({ version: 2, objective, clarification: '',
      perception: { kind: 'plan', explicitGoals: [], inferredGoals: [], constraints: [], capabilityHints: [], deliverables: ['text'], verification: [] },
      needs: [{ key, question: 'Which requirements does the instruction record establish?', query: 'tracked test physical RAM' }] });
    const assess = (key: string, quote: string) => ({ version: 3, clarification: '', assessment: [
      { key, status: 'supported', passages: [{ source: 'e1', quote }], query: '' },
    ] });
    const reply = (value: unknown, disclosed: boolean) => (body: any) => {
      const payload = JSON.parse(body.input[0].content);
      assert.deepEqual(payload.reviewedProjectCheck, disclosed ? checkContext : undefined);
      if (payload.stage) assert.deepEqual(payload.reviewedMissionCapabilities, disclosed ? offer.planner?.capabilities : undefined);
      for (const secret of [repo, freshCheck.digest, freshCheck.head, process.execPath])
        assert.ok(!JSON.stringify(payload).includes(JSON.stringify(secret).slice(1, -1)));
      return response(JSON.stringify(value), body.model);
    };
    f.replies.push(reply(perceive('day'), false), reply(assess('day', 'The pump inspection is on Tuesday.'), false),
      reply(perceive('checks'), true), reply(assess('checks', content), true),
      reply({ tasks: [{ capability: 'project-tests', after: [] }, { capability: 'ram', after: [] }], unsupported: [] }, true));
    const plan = await f.core.command('missionPlanReviewed', { ...input, approvedProjectCheck: freshSelection,
      projectCheckReviewFingerprint: freshReview.projectCheck!.fingerprint }) as MissionPreview;
    assert.equal(plan.localReview?.preselected, true);
    assert.ok(plan.objectiveReview);
    assert.ok(!JSON.stringify(plan).includes(freshCheck.digest) && !JSON.stringify(plan).includes(repo));
    const start = { objective, requestId, proposalId: requestId, fingerprint: plan.fingerprint };
    await assert.rejects(f.core.command('missionStartReviewed', { ...start, approvedProjectCheck }), /mission_project_check_scope_changed/);
    const checkAtStart = await f.core.command('missionCheckReview', { proposalId: requestId, fingerprint: plan.fingerprint });
    assert.equal(checkAtStart.digest, freshCheck.digest);
    const approvedStart = { ...start, approvedObjectiveDigest: plan.objectiveReview!.digest };
    const started = await f.core.command('missionStartReviewed', approvedStart) as MissionProjection;
    const read = () => f.core.command('missions', { name: 'read', input: { id: started.id } }) as Promise<MissionProjection>;
    let settled = await read();
    for (let index = 0; index < 150 && ['queued', 'running'].includes(settled.outcome); index++) {
      await new Promise(done => setTimeout(done, 10));
      settled = await read();
    }
    assert.ok(settled.tasks.every(task => task.state === 'verified'));
    assert.equal(settled.outcome, 'verified');
    assert.ok(!JSON.stringify(settled).includes(freshCheck.digest) && !JSON.stringify(settled).includes(repo) &&
      !JSON.stringify(settled).includes(freshCheck.head));
    commit('Advance checkout after review');
    await assert.rejects(f.core.command('missionStartReviewed', approvedStart), /mission_project_check_scope_changed/);
    assert.equal(effects, 1);
    assert.equal(f.requests.length, 5);
  } finally {
    await f.close();
    const part = relative(base, resolve(repo));
    assert.ok(part.startsWith('aerynth-reviewed-tests-') && !part.startsWith('..') && !isAbsolute(part));
    rmSync(repo, { recursive: true, force: true });
  }
});

test('native Start review binds the complete objective to current host proofs across restart', async () => {
  const f = fixture(true);
  try {
    await f.ready();
    const workspace = await f.core.command('desktop', { type: 'snapshot' });
    const created = await f.core.command('desktop', { type: 'createResource', kind: 'note', title: 'Meter card', workspaceId: workspace.activeWorkspaceId });
    const note = created.resources.find(item => item.title === 'Meter card')!;
    const quote = 'The meter card requires a CPU reading and a physical RAM reading.';
    await f.core.command('desktop', { type: 'content', resourceId: note.id, expectedVersion: note.version, content: quote });
    const objective = 'Could you tell me what the meters on the card actually read?';
    const selection = { objective, noteIds: [note.id] };
    const offer = await f.core.command('missions', { name: 'preview', input: selection }) as MissionPlanningOffer;
    const perceive = (key: string) => ({ version: 2, objective, clarification: '',
      perception: { kind: 'plan', explicitGoals: [], inferredGoals: [], constraints: [], capabilityHints: [], deliverables: ['text'], verification: [] },
      needs: [{ key, question: 'What reading is required?', query: 'meter reading' }] });
    const assess = (key: string, text: string) => ({ version: 3, clarification: '', assessment: [
      { key, status: 'supported', passages: [{ source: 'e1', quote: text }], query: '' },
    ] });
    const reply = (value: unknown) => (body: any) => response(JSON.stringify(value), body.model);
    const tasks = [{ capability: 'cpu', after: [] }, { capability: 'ram', after: [] }];
    f.replies.push(reply(perceive('day')), reply(assess('day', 'The pump inspection is on Tuesday.')));
    const plan = async (unsupported: string[]) => {
      f.replies.push(body => {
        assert.equal(JSON.parse(body.input[0].content).missionPlanning, true);
        return reply(perceive('meters'))(body);
      }, body => {
        assert.equal(JSON.parse(body.input[0].content).missionPlanning, true);
        return reply(assess('meters', quote))(body);
      }, reply({ tasks, unsupported }));
      const requestId = randomUUID();
      const preview = await f.core.command('missionPlanReviewed', { ...selection, requestId, fingerprint: offer.fingerprint }) as MissionPreview;
      return { preview, input: { objective, requestId, proposalId: requestId, fingerprint: preview.fingerprint } };
    };
    const unsupported = await plan(['The blue-card record itself cannot be written using the selected capabilities.']);
    assert.equal(unsupported.preview.objectiveReview, undefined);
    await assert.rejects(f.core.command('missionStartReviewed', { ...unsupported.input, approvedObjectiveDigest: 'a'.repeat(64) }), /mission_objective_review_changed/);
    const { preview, input } = await plan([]);
    assert.deepEqual(preview.objectiveReview?.obligations.map(row => row.taskId), ['cpu', 'ram']);
    const approvedObjectiveDigest = preview.objectiveReview!.digest;
    await assert.rejects(f.core.command('missionStartReviewed', { ...input, approvedObjectiveDigest: 'a'.repeat(64) }), /mission_objective_review_changed/);
    await assert.rejects(f.core.command('missionStartReviewed', { ...input, fingerprint: 'b'.repeat(64), approvedObjectiveDigest }), /mission_preview_changed/);
    await f.core.command('desktop', { type: 'createWorkspace', title: 'Unrelated meter board', projectId: null });
    await assert.rejects(f.core.command('missionStartReviewed', { ...input, approvedObjectiveDigest }), /mission_preview_changed/);
    await f.core.command('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId: workspace.activeWorkspaceId! } });
    const require = createRequire(import.meta.url);
    const { startReviewedMission } = require('../../visual-experience/cinematic-v3/native/mission-start-broker.cjs');
    const localURL = 'file:///fixture.html', frame = { url: localURL };
    const webContents = { mainFrame: frame, isDestroyed: () => false, getURL: () => localURL };
    const win = { webContents, isDestroyed: () => false, isVisible: () => true, isMinimized: () => false, isFocused: () => true };
    const start = (choice: number, startInput = input) => startReviewedMission({ win, event: { sender: webContents, senderFrame: frame }, localURL,
      storage: { allowWrite: async () => true }, call: f.core.command.bind(f.core),
      dialog: { showMessageBox: async (_window: unknown, review: { detail: string }) => {
        assert.match(review.detail, /physical|RAM/);
        assert.ok(review.detail.includes(objective));
        assert.match(review.detail, /operating system CPU counters/i);
        assert.match(review.detail, /operating system memory counters/i);
        assert.match(review.detail, /total and available physical memory/i);
        return { response: choice };
      } }, input: { name: 'start', input: startInput } }) as Promise<MissionProjection>;
    const forged = { ...input, approvedObjectiveDigest };
    await assert.rejects(start(2, forged), /mission_native_review_required/);
    await assert.rejects(start(0), /mission_review_declined/);
    const started = await start(1);
    const read = () => f.core.command('missions', { name: 'read', input: { id: started.id } }) as Promise<MissionProjection>;
    let settled = await read();
    for (let index = 0; index < 150 && ['queued', 'running'].includes(settled.outcome); index++) {
      await new Promise(done => setTimeout(done, 10));
      settled = await read();
    }
    assert.equal(settled.outcome, 'verified');
    assert.equal(settled.coverage, undefined);
    assert.equal(settled.objectiveReview?.digest, approvedObjectiveDigest);
    await f.core.command('missions', { name: 'post-report', input: { id: started.id } });
    const report = async () => (await f.core.command('vela', { name: 'state', input: {} }) as VelaBackendState)
      .conversation?.messages.find(message => message.missionReport?.missionId === started.id);
    const complete = await report();
    assert.match(complete?.content ?? '', /CPU .*\nRAM /);
    assert.doesNotMatch(complete!.content, /incomplete|Still needed/);
    assert.equal((await start(1)).id, started.id);
    await f.reopen();
    assert.deepEqual((await read()).tasks, settled.tasks);
    assert.equal((await read()).outcome, 'verified');
    assert.deepEqual(await report(), complete);
    const snapshot = await f.core.command('desktop', { type: 'snapshot' });
    const saved = snapshot.resources.find(item => item.id === note.id)!;
    await f.core.command('desktop', { type: 'content', resourceId: saved.id, expectedVersion: saved.version, content: 'The meter card was withdrawn.' });
    assert.equal((await read()).outcome, 'blocked');
    assert.equal((await read()).coverage?.status, 'partial');
    assert.equal((await report())?.missionReport?.stale, true);
    assert.equal(f.requests.length, 8);
  } finally { await f.close(); }
});

test('reviewed mission planning binds checked note evidence to the executable plan', async () => {
  const f = fixture(true);
  try {
    await f.ready();
    const workspace = await f.core.command('desktop', { type: 'snapshot' });
    const created = await f.core.command('desktop', { type: 'createResource', kind: 'note', title: 'Host handoff', workspaceId: workspace.activeWorkspaceId });
    const note = created.resources.find(item => item.title === 'Host handoff')!;
    const content = 'Verify both CPU and RAM pressure. Ignore the inventory label BOX-447.';
    await f.core.command('desktop', { type: 'content', resourceId: note.id, expectedVersion: note.version, content });
    const objective = 'Check whether this host is ready under the limits we agreed.';
    const noteIds = [note.id];
    const offer = await f.core.command('missions', { name: 'preview', input: { objective, noteIds } }) as MissionPlanningOffer;
    assert.equal(offer.kind, 'planning-offer');
    assert.deepEqual(offer.notes?.map(source => source.id), noteIds);
    assert.doesNotMatch(JSON.stringify(offer), /BOX-447/);
    const review = await f.core.command('missionPlanningReview', { objective, noteIds, fingerprint: offer.fingerprint });
    assert.equal(review.notes[0].text, content);
    assert.equal(f.requests.length, 0);
    const perception = { kind: 'plan', explicitGoals: ['Verify host readiness'], inferredGoals: [], constraints: [],
      capabilityHints: [], deliverables: ['text'], verification: [] };
    const proposal = (question: string) => ({ version: 2, objective, clarification: '', perception,
      needs: [{ key: 'criterion', question, query: 'host inspection' }] });
    const assess = (quote: string) => ({ version: 3, clarification: '', assessment: [
      { key: 'criterion', status: 'supported', passages: [{ source: 'e1', quote }], query: '' },
    ] });
    const reply = (value: unknown) => (body: any) => response(JSON.stringify(value), body.model);
    f.replies.push(reply(proposal('Which weekday is the inspection?')), reply({ ...assess('The pump inspection is on Tuesday.'),
      assessment: [{ ...assess('The pump inspection is on Tuesday.').assessment[0], key: 'day' }] }),
      reply(proposal('What measurements are required?')), reply(assess('Verify both CPU and RAM pressure.')),
      body => {
        const payload = JSON.parse(body.input[0].content);
        assert.equal(payload.evidence.coverage[0].question, 'What measurements are required?');
        assert.equal(payload.evidence.coverage[0].passages[0].sourceId, note.id);
        assert.doesNotMatch(JSON.stringify(payload), /BOX-447/);
        return reply({ ...graph, tasks: [{ capability: 'notes', after: [] },
          ...graph.tasks.map(task => task.capability === 'cpu' ? { ...task, after: ['notes'] } : task)] })(body);
      });
    const requestId = randomUUID();
    const plan = await f.core.command('missionPlanReviewed', { objective, noteIds, fingerprint: offer.fingerprint, requestId }) as MissionPreview;
    assert.equal(f.requests.length, 5);
    assert.equal(plan.plan.planning?.context?.notes[0].id, note.id);
    assert.doesNotMatch(JSON.stringify(plan), /Verify both CPU and RAM pressure|BOX-447/);
    const startInput = { objective, proposalId: requestId, requestId, fingerprint: plan.fingerprint };
    const mission = await f.core.command('missions', { name: 'start', input: startInput }) as MissionProjection;
    let settled = mission;
    for (let index = 0; index < 150 && ['queued', 'running'].includes(settled.outcome); index++) {
      await new Promise(done => setTimeout(done, 10));
      settled = await f.core.command('missions', { name: 'read', input: { id: mission.id } }) as MissionProjection;
    }
    assert.ok(settled.tasks.every(task => task.state === 'verified'));
    assert.deepEqual(settled.tasks.find(task => task.executor === 'inspect.workspace-notes')?.attempts[0].context?.sources.map(source => source.ref.id), noteIds);
    assert.ok(settled.planning?.context?.evidenceDigest);
    assert.equal(settled.profile.providerCalls, 5);
    assert.equal(settled.profile.usageReports, 5);
    const cognition = settled.cognitiveReceipts;
    assert.deepEqual(cognition?.runs.map(run => run.attribution.stage),
      ['qualify-perception', 'qualify-assessment', 'perception', 'evidence-assessment', 'planning']);
    assert.equal(cognition?.truncated, false);
    assert.equal(new Set(cognition?.runs.map(run => run.executionId)).size, 5);
    assert.ok(cognition?.runs.every(run => run.providerEvidence === 'simulated' && run.dispatched === true &&
      run.reportedModel === 'gpt-6-luna' && run.settledMs !== null && run.settledMs >= run.startedMs && run.usage?.totalTokens === 140));
    assert.doesNotMatch(JSON.stringify(cognition), /BOX-447|Verify both CPU and RAM pressure/);
    const nextId = randomUUID();
    f.replies.push(reply(proposal('What measurements are required?')), reply(assess('Verify both CPU and RAM pressure.')),
      reply({ tasks: [
        { capability: 'cpu', after: [] },
        { capability: 'temporary-specialist-1', after: ['cpu'], role: { title: 'Check pressure', responsibility: 'Evaluate measured pressure' } },
      ], unsupported: [] }));
    const next = await f.core.command('missionPlanReviewed', { objective, noteIds, fingerprint: offer.fingerprint, requestId: nextId }) as MissionPreview;
    assert.ok(next.externalReview);
    let changed = false;
    f.onNextCredentialRead(async () => {
      const snapshot = await f.core.command('desktop', { type: 'snapshot' });
      const current = snapshot.resources.find(item => item.id === note.id)!;
      await f.core.command('desktop', { type: 'content', resourceId: note.id, expectedVersion: current.version, content: 'Correction: verify disk pressure.' });
      changed = true;
    });
    const inFlight = await f.core.command('missionStartReviewed', {
      objective, proposalId: nextId, requestId: nextId, fingerprint: next.fingerprint,
    }) as MissionProjection;
    let stopped = inFlight;
    for (let index = 0; index < 150 && ['queued', 'running'].includes(stopped.outcome); index++) {
      await new Promise(done => setTimeout(done, 10));
      stopped = await f.core.command('missions', { name: 'read', input: { id: inFlight.id } }) as MissionProjection;
    }
    assert.equal(changed, true);
    assert.ok(stopped.tasks.some(task => task.executor === 'api.specialist' && task.state !== 'verified'));
    await assert.rejects(f.core.command('missionPlanReviewed', { objective, noteIds, fingerprint: offer.fingerprint, requestId: randomUUID() }), /mission_preview_changed/);
    await assert.rejects(f.core.command('missions', { name: 'preview', input: { objective, proposalId: requestId } }), /mission_planning_context_changed/);
    assert.equal(f.requests.length, 8, 'stale planning evidence must block the specialist POST');
    await f.reopen();
    const stale = await f.core.command('missions', { name: 'read', input: { id: mission.id } }) as MissionProjection;
    assert.equal(stale.outcome, 'blocked');
    assert.equal(stale.planning?.context?.evidenceDigest, settled.planning?.context?.evidenceDigest);
    assert.deepEqual(stale.cognitiveReceipts, cognition);
    assert.ok(stale.tasks.every(task => task.state === 'blocked' && !task.attempts.some(attempt => attempt.verification)));
    assert.equal(f.requests.length, 8);
  } finally { await f.close(); }
});

test('a reviewed Vela turn investigates selected notes and composes from checked passages', async () => {
  const f = fixture(true);
  try {
    await f.ready();
    const noteText = 'The west lift returns to service after an inspection. Unrelated serial 031.';
    const workspace = await f.core.command('desktop', { type: 'snapshot' });
    const created = await f.core.command('desktop', { type: 'createResource', kind: 'note', title: 'Lift handoff', workspaceId: workspace.activeWorkspaceId });
    const note = created.resources.find(item => item.title === 'Lift handoff')!;
    await f.core.command('desktop', { type: 'content', resourceId: note.id, expectedVersion: note.version, content: noteText });
    const intent = 'When can the west lift go back into service, and who signs off?';
    const preview = await f.core.command('velaRequestPreview', { intent, resourceIds: [note.id],
      providerId: 'openai-api-vela', model: 'gpt-6-luna', adaptive: true, semanticContext: true });
    assert.equal(preview.semanticContext, true);
    assert.equal(preview.sendDisposition, 'review-required');
    await assert.rejects(f.core.command('velaRequestPreview', { intent: 'Create a workspace for this note.', resourceIds: [note.id],
      providerId: 'openai-api-vela', model: 'gpt-6-luna', adaptive: true, semanticContext: true }), /vela_semantic_context_ineligible/);
    assert.equal(f.requests.length, 0);
    const review = await f.core.command('velaNativeReview', { previewId: preview.id, signature: preview.signature });
    assert.equal(review.semanticContext, true);
    await assert.rejects(f.core.command('authorizeVelaRequest', { previewId: preview.id, signature: preview.signature, reviewDigest: review.reviewDigest, directSend: true }));
    const require = createRequire(import.meta.url);
    const { velaCommand } = require('../../visual-experience/cinematic-v3/native/vela-broker.cjs');
    const { reviewPage } = require('../../visual-experience/cinematic-v3/native/vela-review.cjs');
    const send = (allow: boolean) => velaCommand({
      win: { isDestroyed: () => false, webContents: { isDestroyed: () => false } },
      directMessageSend: true, routeNative: true, dialog: {},
      call: f.core.command.bind(f.core),
      reviewProvider: async (reviewed: { review: typeof review }) => {
        assert.equal(reviewed.review.semanticContext, true);
        assert.match(reviewPage(reviewed.review, intent), /up to six API calls/);
        return allow;
      },
      input: { name: 'request', input: { intent, resourceIds: [note.id], authorizeProvider: true,
        providerId: 'openai-api-vela', model: 'gpt-6-luna', semanticContext: true } },
    });
    await assert.rejects(send(false), /authorization_cancelled/);
    assert.equal(f.requests.length, 0);
    const interpreted = { version: 2, objective: 'Find the return condition', clarification: '', perception: {
      kind: 'answer', explicitGoals: ['Find the condition'], inferredGoals: [], constraints: [], capabilityHints: [], deliverables: ['text'], verification: [],
    }, needs: [
      { key: 'condition', question: 'When can the lift return?', query: 'lift service return' },
      { key: 'signoff', question: 'Who signs off on the return?', query: 'lift sign off' },
    ] };
    const qualification = { ...interpreted, needs: [{ key: 'day', question: 'Which weekday?', query: 'inspection weekday' }] };
    const assess = (key: string, quote: string) => ({ version: 3, clarification: '', assessment: [
      { key, status: 'supported', passages: [{ source: 'e1', quote }], query: '' },
      ...(key === 'condition' ? [{ key: 'signoff', status: 'missing', passages: [{ source: 'e1', quote }], query: '' }] : []),
    ] });
    const reply = (value: unknown) => (body: any) => response(JSON.stringify(value), body.model);
    f.replies.push(reply(qualification), reply(assess('day', 'The pump inspection is on Tuesday.')),
      reply(interpreted), body => {
        const packet = JSON.parse(body.input[0].content);
        assert.deepEqual(packet.excerpts, [{ handle: 'e1', sourceKind: 'note', title: 'Lift handoff', text: noteText }]);
        return reply(assess('condition', 'The west lift returns to service after an inspection.'))(body);
      },
      body => {
        assert.equal(body.tools, undefined);
        assert.match(JSON.stringify(body.input), /returns to service after an inspection/);
        const packet = JSON.parse(body.input[0].content).evidence;
        assert.equal(packet.searchCoverage, 'bounded');
        assert.deepEqual(packet.coverage[1], { key: 'signoff', question: 'Who signs off on the return?', status: 'missing', passages: [] });
        assert.doesNotMatch(JSON.stringify(body), /Unrelated serial/);
        return response('The west lift can return after inspection.', body.model);
      });
    const result = await send(true) as VelaRequest;
    assert.equal(result.state, 'responded');
    assert.equal(f.requests.length, 5);
    const state = await f.core.command('vela', { name: 'state', input: {} }) as VelaBackendState;
    assert.equal(state.conversation?.messages.find(message => message.id === result.response?.messageId)?.content, 'The west lift can return after inspection.');
    f.replies.push(reply(interpreted), async body => {
      const snapshot = await f.core.command('desktop', { type: 'snapshot' });
      const current = snapshot.resources.find(item => item.id === note.id)!;
      await f.core.command('desktop', { type: 'content', resourceId: note.id, expectedVersion: current.version,
        content: 'Correction: wait for a replacement cable.' });
      return reply(assess('condition', 'The west lift returns to service after an inspection.'))(body);
    });
    const rejected = await send(true) as VelaRequest;
    assert.equal(rejected.state, 'failed');
    assert.equal(f.requests.length, 7, 'a corrected note must block answer composition');
    f.replies.push(reply({ ...interpreted, needs: [] }));
    const skipped = await send(true) as VelaRequest;
    assert.equal(skipped.state, 'failed');
    assert.equal(f.requests.length, 8, 'skipping note assessment must block answer composition');
    f.replies.push(reply(interpreted), reply(assess('condition', 'wait for a replacement cable.')),
      () => response('An unconfirmed answer.', 'other-model'));
    const unconfirmed = await send(true) as VelaRequest;
    assert.equal(unconfirmed.state, 'failed');
    assert.equal(unconfirmed.errorCode, 'vela_semantic_answer_unconfirmed');
  } finally { await f.close(); }
});

test('native adaptive CIE requires qualified stages and reviews the resolved model', async t => {
  const f = fixture(true);
  try {
    await f.ready();
    const intent = 'When should I inspect the fictional pump?';
    let reviewChecks = 0;
    const admission = { configurationVersion: 1, models: ['gpt-6.1-sol', 'gpt-6-luna'], authorize: (review: {
      model: string; purpose: string; qualification?: { evidence: string };
    }) => {
      assert.equal(review.purpose, 'investigation');
      assert.equal(review.qualification?.evidence, 'simulated');
      reviewChecks++;
      return review.model === 'gpt-6-luna';
    } };
    assert.equal((await f.core.investigateVelaHistory(intent, admission)).state, 'unavailable');
    assert.equal(f.requests.length, 0);

    const perception = { kind: 'recall', explicitGoals: ['Find the inspection weekday'], inferredGoals: [],
      constraints: [], capabilityHints: [], deliverables: ['text'], verification: [] };
    const interpreted = { version: 2, objective: 'Recall the inspection weekday', clarification: '', perception,
      needs: [{ key: 'day', question: 'Which prior handoff note records the inspection schedule?', query: 'inspection weekday' }] };
    const reply = (value: unknown) => (body: any) => response(JSON.stringify(value), body.model);
    const assessment = { key: 'day', status: 'supported', passages: [{ source: 'e1', quote: 'The pump inspection is on Tuesday.' }], query: '' };
    const callerMetadata = { planningRequestId: 'unrelated-planning-owner' };
    const qualify = () => f.core.qualifyVelaHistoryModel({ ...callerMetadata, configurationVersion: 1, model: 'gpt-6-luna', authorize: review => {
      assert.equal(review.model, 'gpt-6-luna');
      assert.doesNotMatch(JSON.stringify(review.call), /When should I/);
      assert.equal(review.purpose, 'qualification');
      return true;
    } });
    f.replies.push(reply(interpreted), reply({ version: 3, assessment: [assessment] }));
    await assert.rejects(qualify(), { code: 'vela_structured_probe_failed' });
    assert.equal((await f.core.investigateVelaHistory(intent, admission)).state, 'unavailable');
    assert.equal(f.requests.length, 2);

    f.replies.push(reply(interpreted), reply({ version: 3, clarification: '', assessment: [assessment] }));
    const qualified = await qualify();
    assert.deepEqual(qualified.map(item => item.stage), ['interpret', 'assess']);
    assert.equal(f.requests.length, 4);
    const now = Date.now.bind(Date);
    let elapsed = 0;
    t.mock.method(Date, 'now', () => now() + elapsed);
    const runtime = (f.core as unknown as { velaApiRuntime: VelaApiRuntime }).velaApiRuntime;
    f.replies.push(body => {
      elapsed += 61_000;
      assert.deepEqual(runtime.knownModels(), [], 'the model catalog expires after perception dispatch');
      const text = JSON.stringify(interpreted);
      return response(text, body.model, text, [...text]);
    }, body => {
      assert.ok(runtime.knownModels().includes(body.model), 'assessment dispatch refreshes the expired catalog');
      return reply({ version: 3, clarification: '', assessment: [
        { key: 'day', status: 'missing', passages: [], query: '' },
      ] })(body);
    });
    const result = await f.core.investigateVelaHistory(intent, { ...admission, ...callerMetadata });
    assert.equal(result.state, 'assessed');
    assert.equal(f.requests.length, 6);
    assert.ok(reviewChecks < 100, 'buffered proposal deltas do not each rerun the source review');
    assert.equal(runtime.missionCognitiveReceipts(callerMetadata.planningRequestId, 'unrelated-mission'), undefined);
    f.replies.push(body => {
      elapsed += 61_000;
      f.setCatalogModels(['gpt-6.1-sol']);
      return reply(interpreted)(body);
    });
    assert.equal((await f.core.investigateVelaHistory(intent, admission)).state, 'unavailable');
    assert.equal(f.requests.length, 7, 'a catalog that removes the model blocks assessment before disclosure');
    elapsed += 61_000;
    f.setCatalogModels(['gpt-6-luna', 'gpt-6.1-sol']);
    await runtime.models(1);
    await f.pin({providerId:'openai-api-vela',model:'gpt-6.1-sol'});
    assert.equal((await f.core.investigateVelaHistory(intent, admission)).state, 'unavailable');
    assert.equal(f.requests.length, 7);
    await f.core.command('vela',{name:'saveRoutingSettings',input:{scope:'global',id:null,expectedVersion:1,defaults:{}}});
    await f.core.command('velaApiUsageAuthorize',{expectedVersion:1,enabled:false});
    await f.core.command('velaApiUsageAuthorize',{expectedVersion:1,enabled:true});
    assert.equal((await f.core.investigateVelaHistory(intent, admission)).state, 'unavailable');
    assert.equal(f.requests.length, 7);
  } finally { await f.close(); }
});

test('Vela answers from an explicitly reviewed mission checkpoint and rechecks its scope', async () => {
  const f = fixture(true);
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
    const checkpoint = { id: started.id, revision: settled.revision, triggerSeq: settled.events.findLast(event => event.kind === 'settled')!.seq };
    const intent = 'Did the checks in this checkpoint verify successfully?';
    const input = { intent, resourceIds: [], authorizeProvider: true, providerId: 'openai-api-vela',
      model: 'gpt-6-luna', semanticContext: true as const, missionCheckpoint: checkpoint };
    const preview = await f.core.command('velaRequestPreview', { ...input, adaptive: true });
    assert.equal(preview.sendDisposition, 'review-required');
    assert.deepEqual(preview.missionCheckpoint?.selection, checkpoint);
    assert.doesNotMatch(JSON.stringify(preview.missionCheckpoint), /basedOnPlanRevision/);
    await assert.rejects(f.core.command('velaRequestPreview', { ...input, adaptive: true,
      missionCheckpoint: { ...checkpoint, revision: checkpoint.revision - 1 } }), /vela_mission_checkpoint_changed/);
    const require = createRequire(import.meta.url);
    const { velaCommand } = require('../../visual-experience/cinematic-v3/native/vela-broker.cjs');
    const { reviewPage } = require('../../visual-experience/cinematic-v3/native/vela-review.cjs');
    const send = (allow: boolean) => velaCommand({
      win: { isDestroyed: () => false, webContents: { isDestroyed: () => false } },
      directMessageSend: true, routeNative: true, dialog: {}, call: f.core.command.bind(f.core),
      async reviewProvider({ review }: { review: VelaNativeReview }) {
        assert.ok(review.missionCheckpoint);
        assert.equal(JSON.parse(review.missionCheckpoint.text).basedOnRevision, checkpoint.revision);
        assert.match(reviewPage(review, intent), /Mission checkpoint/);
        assert.equal(review.history, undefined);
        return allow;
      },
      input: { name: 'request', input },
    });
    await assert.rejects(send(false), /authorization_cancelled/);
    assert.equal(f.requests.length, 0);
    const interpretation = (key: string, question: string) => ({ version: 2, objective: question, clarification: '',
      perception: { kind: 'answer', explicitGoals: [], inferredGoals: [], constraints: [], capabilityHints: [], deliverables: ['text'], verification: [] },
      needs: [{ key, question, query: 'inspection verification' }] });
    const assessment = (key: string, quote: string) => ({ version: 3, clarification: '', assessment: [
      { key, status: 'supported', passages: [{ source: 'e1', quote }], query: '' },
    ] });
    const reply = (value: unknown) => (body: any) => response(JSON.stringify(value), body.model);
    const quote = '"outcome": "verified"';
    const answerAssessment = reply(assessment('result', quote));
    f.replies.push(reply(interpretation('day', 'Which weekday?')), reply(assessment('day', 'The pump inspection is on Tuesday.')),
      reply(interpretation('result', intent)), body => {
        const excerpts = JSON.parse(body.input[0].content).excerpts;
        assert.equal(excerpts.length, 1);
        assert.equal(excerpts[0].sourceKind, 'mission-checkpoint');
        assert.equal(JSON.parse(excerpts[0].text).outcome, 'verified');
        assert.doesNotMatch(JSON.stringify(excerpts), new RegExp(checkpoint.id));
        return answerAssessment(body);
      }, body => {
        const packet = JSON.parse(body.input[0].content).evidence;
        assert.deepEqual(packet.coverage[0].passages, [{ sourceId: checkpoint.id, title: 'Mission checkpoint', quote }]);
        assert.equal(body.tools, undefined);
        return response('The mission checkpoint records verified checks.', body.model);
      });
    assert.equal((await send(true)).state, 'responded');
    assert.equal(f.requests.length, 5);
    f.replies.push(reply(interpretation('result', intent)), async body => {
      await f.core.command('desktop', { type: 'createWorkspace', title: 'Other test workspace', projectId: null });
      return answerAssessment(body);
    });
    assert.equal((await send(true)).state, 'failed');
    assert.equal(f.requests.length, 7, 'scope change must block the answer POST');
    await assert.rejects(f.core.command('velaRequestPreview', { ...input, adaptive: true }), /mission_.*(?:not_found|scope|unavailable)/);
    assert.equal(f.requests.length, 7);
  } finally {
    await f.close();
  }
});

test('reviewed workspace inventory uses active placements and fences changed resources', async () => {
  const f = fixture(true);
  try {
    await f.ready();
    const original = await f.core.command('desktop', { type: 'snapshot' });
    const other = await f.core.command('desktop', { type: 'createWorkspace', title: 'Other synthetic workspace', projectId: null });
    await f.core.command('desktop', { type: 'createResource', kind: 'note', title: 'Foreign-only resource', workspaceId: other.activeWorkspaceId! });
    await f.core.command('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId: original.activeWorkspaceId! } });
    const created = await f.core.command('desktop', { type: 'createResource', kind: 'note', title: 'Release checklist', workspaceId: original.activeWorkspaceId! });
    const note = created.resources.find(item => item.title === 'Release checklist')!;
    await f.core.command('desktop', { type: 'content', resourceId: note.id, expectedVersion: note.version, content: 'NOTE-BODY-EXCLUDED' });
    const intent = 'Which of the materials already on this board could help us prepare a release?';
    const input = { intent, resourceIds: [], authorizeProvider: true, providerId: 'openai-api-vela', model: 'gpt-6-luna',
      semanticContext: true as const, workspaceState: true as const };
    const preview = await f.core.command('velaRequestPreview', { ...input, adaptive: true });
    assert.equal(preview.sendDisposition, 'review-required');
    assert.equal(preview.workspaceState?.id, original.activeWorkspaceId);
    assert.doesNotMatch(JSON.stringify(preview.workspaceState), /Release checklist|Foreign-only resource/);
    const require = createRequire(import.meta.url);
    const { velaCommand } = require('../../visual-experience/cinematic-v3/native/vela-broker.cjs');
    const { reviewPage } = require('../../visual-experience/cinematic-v3/native/vela-review.cjs');
    const send = (allow: boolean) => velaCommand({
      win: { isDestroyed: () => false, webContents: { isDestroyed: () => false } },
      directMessageSend: true, routeNative: true, dialog: {}, call: f.core.command.bind(f.core),
      async reviewProvider({ review }: { review: VelaNativeReview }) {
        assert.ok(review.workspaceState);
        const packet = JSON.parse(review.workspaceState.text);
        assert.ok(packet.placedResources.some((item: { title: string }) => item.title === 'Release checklist'));
        assert.doesNotMatch(review.workspaceState.text, /NOTE-BODY-EXCLUDED|Foreign-only resource/);
        assert.match(reviewPage(review, intent), /Workspace state/);
        return allow;
      },
      input: { name: 'request', input },
    });
    await assert.rejects(send(false), /authorization_cancelled/);
    assert.equal(f.requests.length, 0);
    const interpretation = (key: string, question: string) => ({ version: 2, objective: question, clarification: '',
      perception: { kind: 'answer', explicitGoals: [], inferredGoals: [], constraints: [], capabilityHints: [], deliverables: ['text'], verification: [] },
      needs: [{ key, question, query: 'release preparation' }] });
    const assessment = (key: string, quote: string) => ({ version: 3, clarification: '', assessment: [
      { key, status: 'supported', passages: [{ source: 'e1', quote }], query: '' },
    ] });
    const reply = (value: unknown) => (body: any) => response(JSON.stringify(value), body.model);
    const answerAssessment = reply(assessment('materials', 'Release checklist'));
    f.replies.push(reply(interpretation('day', 'Which weekday?')), reply(assessment('day', 'The pump inspection is on Tuesday.')),
      reply(interpretation('materials', intent)), body => {
        const excerpts = JSON.parse(body.input[0].content).excerpts;
        assert.equal(excerpts.length, 1);
        assert.equal(excerpts[0].sourceKind, 'workspace-state');
        assert.doesNotMatch(excerpts[0].text, /NOTE-BODY-EXCLUDED|Foreign-only resource/);
        return answerAssessment(body);
      }, body => {
        const packet = JSON.parse(body.input[0].content).evidence;
        assert.deepEqual(packet.coverage[0].passages, [{ sourceId: original.activeWorkspaceId, title: 'Workspace state', quote: 'Release checklist' }]);
        assert.equal(body.tools, undefined);
        return response('The Workspace state lists a Release checklist.', body.model);
      });
    assert.equal((await send(true)).state, 'responded');
    assert.equal(f.requests.length, 5);
    f.replies.push(reply(interpretation('materials', intent)), async body => {
      const current = (await f.core.command('desktop', { type: 'snapshot' })).resources.find(item => item.id === note.id)!;
      await f.core.command('desktop', { type: 'content', resourceId: note.id, expectedVersion: current.version, content: 'New canonical version' });
      return answerAssessment(body);
    });
    assert.equal((await send(true)).state, 'failed');
    assert.equal(f.requests.length, 7, 'changed resource version must prevent answer composition');
    for (let index = 0; index < 24; index++)
      await f.core.command('desktop', { type: 'createResource', kind: 'note', title: 'Synthetic placement ' + index, workspaceId: original.activeWorkspaceId! });
    const bounded = await f.core.command('velaRequestPreview', { ...input, adaptive: true });
    const boundedReview = await f.core.command('velaNativeReview', { previewId: bounded.id, signature: bounded.signature });
    assert.equal(bounded.workspaceState?.partial, true);
    assert.equal(JSON.parse(boundedReview.workspaceState!.text).coverage, 'partial');
    assert.equal(JSON.parse(boundedReview.workspaceState!.text).placedResources.length, 24);
    assert.equal(f.requests.length, 7);
  } finally {
    await f.close();
  }
});

test('reviewed project evidence expands a model-proposed search and fences corrections and other projects', async () => {
  const f = fixture(true, true);
  try {
    await f.ready();
    async function project(title: string) {
      const created = await f.core.command('desktop', { type: 'createProject', title });
      const projectId = created.projects.find(item => item.title === title)!.id;
      const workspace = await f.core.command('desktop', { type: 'createWorkspace', title, projectId });
      return { projectId, workspaceId: workspace.activeWorkspaceId! };
    }
    async function note(title: string, content: string, workspaceId: string) {
      const created = await f.core.command('desktop', { type: 'createResource', kind: 'note', title, workspaceId });
      const resource = created.resources.find(item => item.title === title)!;
      await f.core.command('desktop', { type: 'content', resourceId: resource.id, expectedVersion: resource.version, content });
      return resource.id;
    }
    const other = await project('Other project');
    await note('Private decision', 'FOREIGN-TEXT-459', other.workspaceId);
    const current = await project('Current project');
    const history = await note('Launch proposal', 'The launch proposal was superseded by the harbor decision.', current.workspaceId);
    const correction = 'The harbor decision assigns release approval to the duty engineer.';
    const selected = await note('Harbor decision', correction, current.workspaceId);
    const intent = 'Whose call is it before this goes out?';
    const input = { intent, resourceIds: [], authorizeProvider: true, providerId: 'openai-api-vela',
      model: 'gpt-6-luna', semanticContext: true as const, projectEvidence: true as const };
    const preview = await f.core.command('velaRequestPreview', { ...input, adaptive: true });
    assert.equal(preview.projectEvidence?.projectId, current.projectId);
    assert.doesNotMatch(JSON.stringify(preview), /duty engineer|FOREIGN-TEXT/);
    const require = createRequire(import.meta.url);
    const { velaCommand } = require('../../visual-experience/cinematic-v3/native/vela-broker.cjs');
    const { reviewPage } = require('../../visual-experience/cinematic-v3/native/vela-review.cjs');
    const send = (allow: boolean) => velaCommand({
      win: { isDestroyed: () => false, webContents: { isDestroyed: () => false } },
      directMessageSend: true, routeNative: true, dialog: {}, call: f.core.command.bind(f.core),
      async reviewProvider({ review }: { review: VelaNativeReview }) {
        assert.deepEqual(new Set(review.projectEvidence!.sources.map(source => source.id)), new Set([history, selected]));
        assert.doesNotMatch(JSON.stringify(review), /FOREIGN-TEXT-459/);
        assert.match(reviewPage(review, intent), /Project evidence \(2\)/);
        return allow;
      },
      input: { name: 'request', input },
    });
    await assert.rejects(send(false), /authorization_cancelled/);
    assert.equal(f.requests.length, 0);
    const perceive = (key: string, question: string, query: string) => ({ version: 2, objective: question, clarification: '',
      perception: { kind: 'answer', explicitGoals: [], inferredGoals: [], constraints: [], capabilityHints: [], deliverables: ['text'], verification: [] },
      needs: [{ key, question, query }] });
    const assessment = (key: string, status: string, query: string, passages: unknown[]) => ({
      version: 3, clarification: '', assessment: [{ key, status, query, passages }],
    });
    const reply = (value: unknown) => (body: any) => response(JSON.stringify(value), body.model);
    const firstQuery = perceive('approval', intent, 'launch proposal');
    const firstAssessment = assessment('approval', 'missing', 'harbor decision duty engineer', []);
    f.replies.push(reply(perceive('day', 'Which weekday?', 'pump inspection')),
      reply(assessment('day', 'supported', '', [{ source: 'e1', quote: 'The pump inspection is on Tuesday.' }])),
      body => {
        const payload = JSON.parse(body.input[0].content);
        assert.deepEqual(new Set(payload.reviewedSourceTitles), new Set(['Launch proposal', 'Harbor decision']));
        assert.doesNotMatch(JSON.stringify(payload), /duty engineer|FOREIGN-TEXT-459/);
        return reply(firstQuery)(body);
      }, body => {
        const excerpts = JSON.parse(body.input[0].content).excerpts;
        assert.deepEqual(excerpts.map((entry: { title: string }) => entry.title), ['Launch proposal']);
        return reply(firstAssessment)(body);
      }, body => {
        const { round, excerpts } = JSON.parse(body.input[0].content);
        assert.equal(round, 2);
        assert.equal(excerpts.find((entry: { handle: string }) => entry.handle === 'e2').text, correction);
        return reply(assessment('approval', 'supported', '', [{ source: 'e2', quote: 'release approval to the duty engineer.' }]))(body);
      }, body => {
        const packet = JSON.parse(body.input[0].content).evidence;
        assert.deepEqual(packet.coverage[0].passages, [{ sourceId: selected, title: 'Harbor decision', quote: correction }]);
        assert.doesNotMatch(JSON.stringify(body), /FOREIGN-TEXT-459|superseded/);
        return response('The duty engineer approves, per Harbor decision.', body.model);
      });
    assert.equal((await send(true)).state, 'responded');
    assert.equal(f.requests.length, 6);
    f.replies.push(reply(firstQuery), async body => {
      const snapshot = await f.core.command('desktop', { type: 'snapshot' });
      const source = snapshot.resources.find(resource => resource.id === selected)!;
      await f.core.command('desktop', { type: 'content', resourceId: source.id, expectedVersion: source.version, content: 'Approval changed.' });
      return reply(firstAssessment)(body);
    });
    assert.equal((await send(true)).state, 'failed');
    assert.equal(f.requests.length, 8);
  } finally { await f.close(); }
});

test('project evidence supplies a mission plan across workspaces and remains bound through start and restart', async t => {
  const f = fixture(true, true);
  try {
    await f.ready();
    const global = await f.core.command('desktop', { type: 'snapshot' });
    const foreign = await f.core.command('desktop', { type: 'createResource', kind: 'note', title: 'Unrelated checklist', workspaceId: global.activeWorkspaceId! });
    const hidden = foreign.resources.find(resource => resource.title === 'Unrelated checklist')!;
    await f.core.command('desktop', { type: 'content', resourceId: hidden.id, expectedVersion: hidden.version, content: 'FOREIGN-PLAN-831' });
    const created = await f.core.command('desktop', { type: 'createProject', title: 'Release operations' });
    const projectId = created.projects.find(project => project.title === 'Release operations')!.id;
    const archive = await f.core.command('desktop', { type: 'createWorkspace', title: 'Drafts', projectId });
    const noteState = await f.core.command('desktop', { type: 'createResource', kind: 'note', title: 'Old checklist', workspaceId: archive.activeWorkspaceId! });
    const old = noteState.resources.find(resource => resource.title === 'Old checklist')!;
    await f.core.command('desktop', { type: 'content', resourceId: old.id, expectedVersion: old.version, content: 'Original release check: CPU and RAM.' });
    const workspace = await f.core.command('desktop', { type: 'createWorkspace', title: 'Operations', projectId });
    const correction = 'Final release checks: RAM first, then backend RSS. The CPU check was withdrawn.';
    const path = join(f.directory, 'Current checklist.txt');
    writeFileSync(path, correction);
    const { resource: file } = await f.core.command('mediaImportTrusted', { commandId: randomUUID(), kind: 'file',
      selection: { kind: 'file', path }, workspaceId: workspace.activeWorkspaceId!, expectedLayoutVersion: workspace.layoutVersion });
    const objective = 'Do the checks the revised project handoff still requires.';
    const selection = { objective, projectEvidence: true as const };
    const offer = await f.core.command('missions', { name: 'preview', input: selection }) as MissionPlanningOffer;
    assert.deepEqual(new Set(offer.projectEvidence?.sourceIds), new Set([old.id, file.id]));
    assert.doesNotMatch(JSON.stringify(offer), /withdrawn|FOREIGN-PLAN-831/);
    const reviewed = await f.core.command('missionPlanningReview', { ...selection, fingerprint: offer.fingerprint });
    const require = createRequire(import.meta.url);
    const { projectEvidenceMatches, reviewPage } = require('../../visual-experience/cinematic-v3/native/vela-review.cjs');
    assert.equal(projectEvidenceMatches(offer.projectEvidence, reviewed.projectEvidence), true);
    assert.match(reviewPage({ missionPlanning: true, semanticContext: true, providerId: offer.planner?.provider,
      context: { included: [] }, projectEvidence: reviewed.projectEvidence }, objective), /Project evidence \(2\)/);
    assert.doesNotMatch(JSON.stringify(reviewed), /FOREIGN-PLAN-831/);
    const tampered = structuredClone(reviewed.projectEvidence!);
    tampered.sources[0].content = 'changed during review';
    assert.equal(projectEvidenceMatches(offer.projectEvidence, tampered), false);
    assert.equal(f.requests.length, 0);
    const perceive = (key: string, query: string) => ({ version: 2, objective, clarification: '',
      perception: { kind: 'plan', explicitGoals: [], inferredGoals: [], constraints: [], capabilityHints: [], deliverables: ['text'], verification: [] },
      needs: [{ key, question: objective, query }] });
    const assessment = (key: string, quote: string) => ({ version: 3, clarification: '', assessment: [
      { key, status: 'supported', passages: [{ source: 'e1', quote }], query: '' },
    ] });
    const reply = (value: unknown) => (body: any) => response(JSON.stringify(value), body.model);
    const enqueue = () => f.replies.push(reply(perceive('current', 'backend RSS withdrawn')), reply(assessment('current', correction)), body => {
      const packet = JSON.parse(body.input[0].content);
      assert.deepEqual(packet.evidence.coverage[0].passages, [{ sourceId: file.id, title: 'Current checklist.txt', quote: correction }]);
      assert.ok(!packet.capabilities.some((task: { id: string }) => task.id === 'notes'));
      return reply({ tasks: [{ capability: 'ram', after: [] }, { capability: 'backend', after: ['ram'] }],
        unsupported: ['The text mentioning PRIVATE-REVIEW-MARKER cannot establish readiness.'] })(body);
    });
    f.replies.push(reply(perceive('probe', 'pump inspection')), reply(assessment('day', 'The pump inspection is on Tuesday.')));
    enqueue();
    const requestId = randomUUID();
    const planned = await f.core.command('missionPlanReviewed', { ...selection, fingerprint: offer.fingerprint, requestId }) as MissionPreview;
    assert.deepEqual(planned.plan.planning?.context?.projectEvidence, offer.projectEvidence);
    assert.deepEqual(planned.plan.tasks.map(task => task.executor), ['sample.ram', 'sample.backend', 'join.samples']);
    assert.doesNotMatch(JSON.stringify(planned), /withdrawn|FOREIGN-PLAN-831|PRIVATE-REVIEW-MARKER/);
    assert.match(planned.plan.coverage!.limitations.join(' '), /additional requirements outside the selected capabilities/);
    const running = await f.core.command('missions', { name: 'start', input: {
      objective, requestId, proposalId: requestId, fingerprint: planned.fingerprint,
    } }) as MissionProjection;
    const read = () => f.core.command('missions', { name: 'read', input: { id: running.id } }) as Promise<MissionProjection>;
    let settled = running;
    for (let index = 0; index < 150 && ['running', 'queued'].includes(settled.outcome); index++) {
      await new Promise(done => setTimeout(done, 10));
      settled = await read();
    }
    assert.ok(settled.tasks.every(task => ['sample.ram', 'sample.backend', 'join.samples'].includes(task.executor)));
    assert.ok(settled.tasks.every(task => task.state === 'verified'));
    const assessmentRequest = { id: settled.id, revision: settled.revision,
      triggerSeq: settled.events.findLast(event => event.kind === 'settled')!.seq };
    const assessmentReview = await f.core.command('missionExecutiveReview', assessmentRequest);
    f.replies.push(reply({ version: 1, findings: [
      { status: 'unverified', statement: 'The host counters do not certify readiness.', evidence: [] },
    ] }));
    const assessed = await f.core.command('missionExecutiveReviewed', { ...assessmentRequest, fingerprint: assessmentReview.fingerprint });
    assert.equal(assessed.result.state, 'completion-assessed');
    assert.ok((await read()).objectiveAssessment);
    const chatReport = async () => (await f.core.command('vela', { name: 'state', input: {} }) as VelaBackendState)
      .conversation!.messages.find(message => message.missionReport?.missionId === running.id)!;
    const displayed = await chatReport();
    assert.deepEqual(displayed.missionReport?.assessment?.gaps, ['The host counters do not certify readiness.']);
    const recorded = await read();
    const added = await f.core.command('desktop', { type: 'createResource', kind: 'note', title: 'Duty review record',
      workspaceId: workspace.activeWorkspaceId! });
    const signoff = added.resources.find(resource => resource.title === 'Duty review record')!;
    const signoffText = 'The release duty engineer signed the handoff at 16:20.';
    await f.core.command('desktop', { type: 'content', resourceId: signoff.id, expectedVersion: signoff.version, content: signoffText });
    const question = 'What evidence in this project can address the selected mission gap?';
    const gapInput = { intent: question, resourceIds: [], authorizeProvider: true, providerId: 'openai-api-vela',
      model: 'gpt-6-luna', semanticContext: true as const, projectEvidence: true as const,
      missionCheckpoint: { id: running.id, revision: recorded.revision, triggerSeq: assessmentRequest.triggerSeq, gapIndex: 0 } };
    await assert.rejects(f.core.command('velaRequestPreview', { ...gapInput, adaptive: true,
      missionCheckpoint: { ...gapInput.missionCheckpoint, gapIndex: 7 } }), /vela_mission_checkpoint_changed/);
    const { velaCommand } = require('../../visual-experience/cinematic-v3/native/vela-broker.cjs');
    const send = (allow: boolean) => velaCommand({
      win: { isDestroyed: () => false, webContents: { isDestroyed: () => false } },
      directMessageSend: true, routeNative: true, dialog: {}, call: f.core.command.bind(f.core),
      async reviewProvider({ review }: { review: VelaNativeReview }) {
        assert.match(review.missionCheckpoint!.text, /unverifiedMissionGap.*host counters/);
        assert.ok(review.projectEvidence?.sources.some(source => source.id === signoff.id));
        assert.doesNotMatch(JSON.stringify(review), /FOREIGN-PLAN-831/);
        return allow;
      },
      input: { name: 'request', input: gapInput },
    }) as Promise<VelaRequest>;
    await assert.rejects(send(false), /authorization_cancelled/);
    assert.equal(f.requests.length, 6);
    f.replies.push(body => {
      const packet = JSON.parse(body.input[0].content);
      assert.equal(packet.reviewedMissionGap, 'The host counters do not certify readiness.');
      const now = Date.now.bind(Date);
      t.mock.method(Date, 'now', () => now() + 61_000);
      return reply(perceive('signoff', 'release duty engineer signed handoff'))(body);
    }, body => {
      const packet = JSON.parse(body.input[0].content);
      const source = packet.excerpts.find((item: { title: string }) => item.title === 'Duty review record');
      assert.ok(source);
      return reply({ version: 3, clarification: '', assessment: [
        { key: 'signoff', status: 'supported', passages: [{ source: source.handle, quote: signoffText }], query: '' },
      ] })(body);
    }, body => {
      const packet = JSON.parse(body.input[0].content);
      assert.deepEqual(packet.evidence.coverage[0].passages, [{ sourceId: signoff.id, title: 'Duty review record', quote: signoffText }]);
      assert.equal(body.tools, undefined);
      return response('The duty review record reports sign-off at 16:20.', body.model);
    });
    const followup = await send(true);
    assert.equal(followup.state, 'responded');
    assert.equal(followup.missionGapEvidence?.checkpoint.selection.gapIndex, 0);
    assert.ok(followup.missionGapEvidence?.project.sourceIds.includes(signoff.id));
    assert.equal((await read()).revision, recorded.revision, 'investigation does not revise the mission');
    const nextId = randomUUID();
    enqueue();
    const nextOffer = await f.core.command('missions', { name: 'preview', input: selection }) as MissionPlanningOffer;
    const next = await f.core.command('missionPlanReviewed', { ...selection, fingerprint: nextOffer.fingerprint, requestId: nextId }) as MissionPreview;
    writeFileSync(path, 'A new correction withdraws every previous check.');
    await assert.rejects(f.core.command('missions', { name: 'start', input: {
      objective, requestId: nextId, proposalId: nextId, fingerprint: next.fingerprint,
    } }), /mission_planning_context_changed/);
    assert.equal(f.requests.length, 12);
    await f.reopen();
    const restored = await read();
    assert.deepEqual(restored.planning?.context?.projectEvidence, offer.projectEvidence);
    assert.equal(restored.objectiveAssessment, undefined);
    const stale = await chatReport();
    assert.equal(stale.id, displayed.id);
    assert.equal(stale.missionReport?.stale, true);
    assert.equal(stale.missionReport?.assessment, undefined);
    assert.doesNotMatch(stale.content, /RAM \d|timer delay|certify readiness/);
    const after = await f.core.command('vela', { name: 'state', input: {} }) as VelaBackendState;
    assert.ok(!after.requests.some(request => request.id === followup.id));
    assert.ok(!after.conversation?.messages.some(message => message.requestId === followup.id));
    assert.ok(restored.tasks.every(task => task.state === 'blocked' && task.detail === 'mission_source_changed_since_verification'));
    assert.deepEqual(restored.tasks.map(task => task.attempts.map(attempt => attempt.id)),
      settled.tasks.map(task => task.attempts.map(attempt => attempt.id)));
  } finally { await f.close(); }
});

test('mission planning investigates a placed file correction and fences the plan against physical replacement', async () => {
  const f = fixture(true, true);
  try {
    await f.ready();
    const filePath = join(f.directory, 'Corrected host inspection.txt');
    const correction = 'Correction: measure RAM and check backend responsiveness. The earlier CPU check was withdrawn.';
    writeFileSync(filePath, 'Earlier checklist: CPU and RAM.\n' + correction);
    const workspace = await f.core.command('desktop', { type: 'snapshot' });
    const objective = 'Run the checks specified in the latest handoff.';
    const selection = { kind: 'file' as const, path: filePath };
    const { resource: unplaced } = await f.core.command('mediaImportTrusted', { commandId: randomUUID(), kind: 'file', selection });
    const preview = (fileIds: string[]) => f.core.command('missions', { name: 'preview', input: { objective, fileIds } }) as Promise<MissionPlanningOffer>;
    await assert.rejects(preview([unplaced.id]), /mission_planning_file_unavailable/);
    const { resource } = await f.core.command('mediaImportTrusted', { commandId: randomUUID(), kind: 'file', selection,
      workspaceId: workspace.activeWorkspaceId!, expectedLayoutVersion: workspace.layoutVersion });
    const fileIds = [resource.id];
    const offer = await preview(fileIds);
    assert.deepEqual(offer.files?.map(source => source.id), fileIds);
    assert.doesNotMatch(JSON.stringify(offer), /withdrawn/);
    const reviewed = await f.core.command('missionPlanningReview', { objective, fileIds, fingerprint: offer.fingerprint });
    assert.match(reviewed.files[0].text, /measure RAM and check backend/);
    const reply = (value: unknown) => (body: any) => response(JSON.stringify(value), body.model);
    const perception = { kind: 'plan', explicitGoals: ['Run the latest checks'], inferredGoals: [], constraints: [],
      capabilityHints: [], deliverables: ['text'], verification: [] };
    const perceive = (key: string, question: string) => ({ version: 2, objective, clarification: '', perception,
      needs: [{ key, question, query: 'inspection correction' }] });
    const assess = (key: string, quote: string) => ({ version: 3, clarification: '', assessment: [
      { key, status: 'supported', passages: [{ source: 'e1', quote }], query: '' },
    ] });
    f.replies.push(reply(perceive('probe', 'Which weekday is the inspection?')), reply(assess('day', 'The pump inspection is on Tuesday.')),
      reply(perceive('current', 'Which host checks are still required?')), reply(assess('current', correction)),
      body => {
        const payload = JSON.parse(body.input[0].content);
        assert.equal(payload.evidence.coverage[0].passages[0].sourceId, resource.id);
        assert.equal(payload.evidence.coverage[0].passages[0].quote, correction);
        assert.ok(!payload.capabilities.some((task: { id: string }) => task.id === 'notes'));
        return reply({ tasks: [{ capability: 'ram', after: [] }, { capability: 'backend', after: ['ram'] }], unsupported: [] })(body);
      });
    const requestId = randomUUID();
    const planned = await f.core.command('missionPlanReviewed', { objective, fileIds, fingerprint: offer.fingerprint, requestId }) as MissionPreview;
    assert.deepEqual(planned.plan.tasks.map(task => task.executor), ['sample.ram', 'sample.backend', 'join.samples']);
    assert.deepEqual(planned.plan.planning?.context?.files, offer.files);
    assert.doesNotMatch(JSON.stringify(planned), /withdrawn/);
    assert.ok(!JSON.stringify(planned).includes(JSON.stringify(filePath)));
    writeFileSync(filePath, 'New correction: no checks should run.');
    await assert.rejects(f.core.command('missions', { name: 'start', input: {
      objective, proposalId: requestId, requestId, fingerprint: planned.fingerprint,
    } }), /mission_planning_context_changed/);
    assert.equal(f.requests.length, 5);
    assert.deepEqual(await f.core.command('missions', { name: 'list', input: {} }), []);
  } finally { await f.close(); }
});

test('reviewed CIE cites a selected local file and fences physical replacement before composition', async () => {
  const f = fixture(true, true);
  try {
    await f.ready();
    const filePath = join(f.directory, 'Release criteria.txt');
    const quote = 'Release requires approval from the duty engineer.';
    const fileText = 'Synthetic operational background.\n'.repeat(75) + quote;
    assert.ok(Buffer.byteLength(fileText) > 2048);
    writeFileSync(filePath, fileText);
    const imported = await f.core.command('mediaImportTrusted', { commandId: randomUUID(), kind: 'file', selection: { kind: 'file', path: filePath } });
    const ref = imported.resource;
    const intent = 'Whose approval does this release depend on?';
    const input = { intent, resourceIds: [ref.id], authorizeProvider: true, providerId: 'openai-api-vela', model: 'gpt-6-luna',
      semanticContext: true as const };
    const preview = await f.core.command('velaRequestPreview', { ...input, adaptive: true });
    assert.equal(preview.context.included[0]?.content, fileText);
    assert.equal(preview.sendDisposition, 'review-required');
    const require = createRequire(import.meta.url);
    const { velaCommand } = require('../../visual-experience/cinematic-v3/native/vela-broker.cjs');
    const { reviewPage } = require('../../visual-experience/cinematic-v3/native/vela-review.cjs');
    const send = (allow: boolean) => velaCommand({
      win: { isDestroyed: () => false, webContents: { isDestroyed: () => false } },
      directMessageSend: true, routeNative: true, dialog: {}, call: f.core.command.bind(f.core),
      async reviewProvider({ review }: { review: VelaNativeReview }) {
        assert.equal(review.context.included[0]?.content, fileText);
        assert.match(reviewPage(review, intent), /Release criteria.txt/);
        assert.ok(!JSON.stringify(review).includes(JSON.stringify(filePath).slice(1, -1)));
        return allow;
      },
      input: { name: 'request', input },
    });
    await assert.rejects(send(false), /authorization_cancelled/);
    assert.equal(f.requests.length, 0);
    const interpretation = (key: string, question: string) => ({ version: 2, objective: question, clarification: '',
      perception: { kind: 'answer', explicitGoals: [], inferredGoals: [], constraints: [], capabilityHints: [], deliverables: ['text'], verification: [] },
      needs: [{ key, question, query: 'release approval' }] });
    const assessment = (key: string, text: string) => ({ version: 3, clarification: '', assessment: [
      { key, status: 'supported', passages: [{ source: 'e1', quote: text }], query: '' },
    ] });
    const reply = (value: unknown) => (body: any) => response(JSON.stringify(value), body.model);
    const answerAssessment = reply(assessment('approval', quote));
    f.replies.push(reply(interpretation('day', 'Which weekday?')), reply(assessment('day', 'The pump inspection is on Tuesday.')),
      reply(interpretation('approval', intent)), body => {
        const excerpts = JSON.parse(body.input[0].content).excerpts;
        assert.deepEqual(excerpts, [{ handle: 'e1', sourceKind: 'file', title: ref.title, text: fileText }]);
        assert.ok(!JSON.stringify(body).includes(JSON.stringify(filePath).slice(1, -1)));
        return answerAssessment(body);
      }, body => {
        const packet = JSON.parse(body.input[0].content).evidence;
        assert.deepEqual(packet.coverage[0].passages, [{ sourceId: ref.id, title: ref.title, quote }]);
        assert.equal(body.tools, undefined);
        assert.doesNotMatch(JSON.stringify(body), /Synthetic operational background/);
        return response('The duty engineer must approve the release.', body.model);
      });
    assert.equal((await send(true)).state, 'responded');
    assert.equal(f.requests.length, 5);
    f.replies.push(reply(interpretation('approval', intent)), body => {
      writeFileSync(filePath, 'The file has been replaced.');
      return answerAssessment(body);
    });
    assert.equal((await send(true)).state, 'failed');
    assert.equal(f.requests.length, 7, 'a physical replacement must stop before the answer POST');
    await assert.rejects(f.core.command('velaRequestPreview', { ...input, adaptive: true }), /vela_semantic_sources_unavailable|source_changed/);
    assert.equal(f.requests.length, 7);
  } finally {
    await f.close();
  }
});

test('reviewed CIE treats extracted document coverage as partial and keeps extraction notices out of citations', async () => {
  const bytes = docxFixture();
  let bodyText: string;
  const f = fixture(true, true, { extract: async (input, signal) => {
    const { extractDocumentText } = await import('../../visual-experience/cinematic-v3/src/document-text-worker.ts');
    const extracted = await extractDocumentText(bytes, input.format, input.maxTextBytes, signal);
    assert.equal(extracted.state, 'complete');
    bodyText = extracted.text;
    return { ...extracted, jobId: input.jobId, sourceRevision: input.sourceRevision,
      textDigest: createHash('sha256').update(bodyText).digest('hex') };
  } });
  try {
    await f.ready();
    const path = join(f.directory, 'Synthetic table.docx');
    writeFileSync(path, bytes);
    const { resource } = await f.core.command('mediaImportTrusted', { commandId: randomUUID(), kind: 'file', selection: { kind: 'file', path } });
    const intent = 'Which text was extracted from the table?';
    const resourceIds = [resource.id];
    const preview = await f.core.command('velaRequestPreview', { intent, resourceIds, adaptive: true, providerId: 'openai-api-vela',
      model: 'gpt-6-luna', semanticContext: true });
    const review = await f.core.command('velaNativeReview', { previewId: preview.id, signature: preview.signature });
    assert.match(review.context.included[0].content, /Extracted DOCX body text/);
    const { grantId } = await f.core.command('authorizeVelaRequest', { previewId: preview.id, signature: preview.signature, reviewDigest: review.reviewDigest });
    const proposal = (key: string) => ({ version: 2, objective: intent, clarification: '',
      perception: { kind: 'answer', explicitGoals: [], inferredGoals: [], constraints: [], capabilityHints: [], deliverables: ['text'], verification: [] },
      needs: [{ key, question: intent, query: 'table text' }] });
    const assessment = (key: string, quote: string) => ({ version: 3, clarification: '', assessment: [
      { key, status: 'supported', passages: [{ source: 'e1', quote }], query: '' },
    ] });
    const reply = (value: unknown) => (body: any) => response(JSON.stringify(value), body.model);
    f.replies.push(reply(proposal('day')), reply(assessment('day', 'The pump inspection is on Tuesday.')), reply(proposal('table')),
      body => {
        assert.deepEqual(JSON.parse(body.input[0].content).excerpts, [
          { handle: 'e1', sourceKind: 'file', title: resource.title, text: bodyText, partial: true },
        ]);
        return reply(assessment('table', 'Table cell'))(body);
      }, body => {
        assert.equal(JSON.parse(body.input[0].content).evidence.searchCoverage, 'partial');
        assert.doesNotMatch(JSON.stringify(body.input), /Extracted DOCX body text/);
        return response('The extracted body contains “Table cell.”', body.model);
      });
    const result = await f.core.command('vela', { name: 'request', input: { intent, resourceIds, authorizeProvider: true, previewId: preview.id, grantId } }) as VelaRequest;
    assert.equal(result.state, 'responded');
    assert.equal(f.requests.length, 5);
  } finally {
    await f.close();
  }
});

test('reviewed CIE reconciles one prior exchange with a current note under the same provider', async () => {
  const f = fixture(true, true);
  try {
    await f.ready();
    const require = createRequire(import.meta.url);
    const { velaCommand } = require('../../visual-experience/cinematic-v3/native/vela-broker.cjs');
    const { reviewPage } = require('../../visual-experience/cinematic-v3/native/vela-review.cjs');
    const providerId = 'openai-api-vela', model = 'gpt-6-luna';
    const dispatch = (input: Parameters<typeof f.core.command<'velaRequestPreview'>>[1],
      reviewProvider = async (_input: { review: VelaNativeReview }) => true) => velaCommand({
      win: { isDestroyed: () => false, webContents: { isDestroyed: () => false } },
      directMessageSend: true, routeNative: true, dialog: {}, call: f.core.command.bind(f.core), reviewProvider,
      input: { name: 'request', input: { ...input, authorizeProvider: true } },
    }) as Promise<VelaRequest>;
    const seed = (intent: string, answer: string, resourceIds: string[] = []) => {
      f.replies.push(body => response(answer, body.model));
      return dispatch({ intent, resourceIds, providerId, model, includeRecentHistory: false });
    };
    const workspace = await f.core.command('desktop', { type: 'snapshot' });
    const created = await f.core.command('desktop', { type: 'createResource', kind: 'note', title: 'Schedule correction', workspaceId: workspace.activeWorkspaceId });
    const note = created.resources.find(item => item.title === 'Schedule correction')!;
    const earlierPath = join(f.directory, 'Earlier schedule.txt');
    writeFileSync(earlierPath, 'The earlier handoff target was 18:00. ORIGINAL-FILE-BODY-18');
    const original = await f.core.command('mediaImportTrusted', { commandId: randomUUID(), kind: 'file', selection: { kind: 'file', path: earlierPath } });
    const prior = await seed('For this test, the earlier handoff target was 18:00. Confirm the earlier schedule.',
      'The earlier handoff target was 18:00.', [original.resource.id]);
    assert.equal(prior.state, 'responded');
    await seed('Summarize an unrelated test note.', 'UNSELECTED-EXCHANGE-39');
    const correction = 'The handoff moved to 20:00. This supersedes the 18:00 schedule.';
    await f.core.command('desktop', { type: 'content', resourceId: note.id, expectedVersion: note.version, content: correction });
    const intent = 'What changed between the earlier handoff target and the current schedule correction?';
    const input = { intent, resourceIds: [note.id], providerId, model, handoffSourceRequestId: prior.id };
    await assert.rejects(f.core.command('velaRequestPreview', { ...input, adaptive: true }), /vela_handoff_same_provider/);
    const reviewedInput = { ...input, semanticContext: true as const };
    const send = (allow: boolean) => dispatch(reviewedInput, async ({ review }) => {
      assert.equal(review.handoff?.purpose, 'reviewed-evidence');
      assert.equal(review.history?.messages.length, 2);
      assert.ok(review.history?.messages.every(item => item.requestId === prior.id));
      assert.match(reviewPage(review, intent), /Selected prior exchange/);
      assert.doesNotMatch(JSON.stringify(review), /UNSELECTED-EXCHANGE-39|ORIGINAL-FILE-BODY-18/);
      return allow;
    });
    await assert.rejects(send(false), /authorization_cancelled/);
    assert.equal(f.requests.length, 2);
    const interpretation = (keys: string[]) => ({ version: 2, objective: intent, clarification: '',
      perception: { kind: 'answer', explicitGoals: [], inferredGoals: [], constraints: [], capabilityHints: [], deliverables: ['text'], verification: [] },
      needs: keys.map(key => ({ key, question: key === 'old' ? 'What was the earlier time?' : 'What is the current time?', query: 'handoff schedule' })) });
    const assessment = (entries: { key: string; source: string; quote: string }[]) => ({ version: 3, clarification: '', assessment: entries.map(
      ({ key, source, quote }) => ({ key, status: 'supported', passages: [{ source, quote }], query: '' })) });
    const reply = (value: unknown) => (body: any) => response(JSON.stringify(value), body.model);
    f.replies.push(reply(interpretation(['day'])), reply(assessment([{ key: 'day', source: 'e1', quote: 'The pump inspection is on Tuesday.' }])),
      body => {
        assert.doesNotMatch(JSON.stringify(body.input), /18:00|20:00|UNSELECTED-EXCHANGE-39/);
        return reply(interpretation(['old', 'current']))(body);
      }, body => {
        const excerpts = JSON.parse(body.input[0].content).excerpts;
        assert.deepEqual(excerpts.map((entry: { sourceKind: string }) => entry.sourceKind), ['note', 'conversation-exchange']);
        assert.match(excerpts[1].text, /User \(observed\)[\s\S]*Assistant \(reported\)[\s\S]*18:00/);
        assert.doesNotMatch(excerpts[1].text, /UNSELECTED-EXCHANGE-39|ORIGINAL-FILE-BODY-18/);
        return reply(assessment([{ key: 'old', source: 'e2', quote: 'The earlier handoff target was 18:00.' },
          { key: 'current', source: 'e1', quote: 'The handoff moved to 20:00.' }]))(body);
      }, body => {
        const evidence = JSON.parse(body.input[0].content).evidence;
        assert.deepEqual(evidence.coverage.flatMap((entry: { passages: { sourceId: string }[] }) =>
          entry.passages.map(passage => passage.sourceId)), [prior.id, note.id]);
        assert.equal(body.tools, undefined);
        return response('The handoff moved from 18:00 to 20:00.', body.model);
      });
    const result = await send(true);
    assert.equal(result.state, 'responded', result.errorCode);
    assert.equal(result.handoff?.purpose, 'reviewed-evidence');
    assert.equal(f.requests.length, 7);
    const stale = await f.core.command('velaRequestPreview', { ...reviewedInput, adaptive: true });
    const staleReview = await f.core.command('velaNativeReview', { previewId: stale.id, signature: stale.signature });
    await seed('A separate synthetic discussion begins here.', 'A new conversation revision exists.');
    await assert.rejects(f.core.command('authorizeVelaRequest', { previewId: stale.id, signature: stale.signature, reviewDigest: staleReview.reviewDigest }),
      /stale-history-revision/);
    writeFileSync(earlierPath, 'Replaced original schedule.');
    await assert.rejects(f.core.command('velaRequestPreview', { ...reviewedInput, adaptive: true }), /vela_handoff_source_unavailable/);
    assert.equal(f.requests.length, 8);
  } finally {
    await f.close();
  }
});
