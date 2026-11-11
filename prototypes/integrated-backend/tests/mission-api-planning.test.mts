import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv,createDecipheriv,createHash,randomBytes,randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,relative,resolve,isAbsolute } from 'node:path';
import { BackendCore } from '../src/core.mts';
import { projectMissionExecution } from '../src/execution-profiler.mts';
import { nativeMissionExecutors, missionResultAvailable } from '../src/mission-native.mts';
import type { MissionPlanningOffer,MissionPreview,MissionProjection } from '../src/mission-contracts.mts';
import type { NativeHostServices } from '../src/native-host.mts';
import type { VelaBackendState, VelaNativeReview } from '../src/contracts.mts';
import type { VelaRequest } from '../../vela-core/src/contracts.ts';
import type { VelaApiRuntime } from '../src/vela-api-runtime.mts';
import type { NativeDocumentTextServices } from '../src/document-text-host.mts';
import { docxFixture } from '../../block-library/tests/media-fixtures.mts';
const objective='Can you investigate why the Minecraft server is lagging?';
const marker='SYNTHETIC_ONLY_MISSION_API_KEY';
const graph={tasks:[{capability:'cpu',after:[]},{capability:'ram',after:[]},{capability:'backend',after:['cpu','ram']}],unsupported:['Server tick timings and logs are unavailable.']};
function response(content:string,model:string,terminal:string|null=content) {
  const id='synthetic-'+randomUUID(),output=[{type:'message',id:'message-'+id,role:'assistant',status:'completed',content:terminal===null?[{type:'refusal',refusal:'Synthetic terminal refusal'}]:[{type:'output_text',text:terminal,annotations:[]}]}];
  return new Response([{type:'response.created',response:{id,status:'in_progress'}},{type:'response.output_text.delta',delta:content},{type:'response.completed',response:{id,status:'completed',model,output,
    usage:{input_tokens:100,output_tokens:40,total_tokens:140}}}].map(event=>'data: '+JSON.stringify(event)+'\n\n').join(''),{headers:{'Content-Type':'text/event-stream'}});
}
function fixture(velaHistoryContext = false, nativeMedia = false, documents?: NativeDocumentTextServices) {
  const base=resolve(tmpdir()),directory=mkdtempSync(join(base,'aerynth-mission-api-')),path=join(directory,'canonical.sqlite'),key=randomBytes(32),requests:any[]=[],replies:((body:any)=>Response|Promise<Response>)[]=[];
  let beforeCredentialOpen: (() => Promise<void>) | undefined;
  const native:NativeHostServices={documents,secrets:{available:async()=>true,
    seal:async value=>{const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,cipher.update(value),cipher.final(),cipher.getAuthTag()]);},
    open:async value=>{const before=beforeCredentialOpen;beforeCredentialOpen=undefined;await before?.();
      const data=Buffer.from(value),cipher=createDecipheriv('aes-256-gcm',key,data.subarray(0,12));cipher.setAuthTag(data.subarray(-16));return Buffer.concat([cipher.update(data.subarray(12,-16)),cipher.final()]).toString();}}};
  const api={fetch:(async(url,init)=>{if(String(url)==='https://api.openai.com/v1/models')return Response.json({data:[{id:'gpt-6-luna'},{id:'gpt-6.1-sol'}]});
    assert.equal(String(url),'https://api.openai.com/v1/responses');assert.equal(new Headers(init?.headers).get('authorization'),'Bearer '+marker);
    const body=JSON.parse(String(init?.body));requests.push(body);const next=replies.shift();assert.ok(next,'unexpected API inference');return next(body);}) as typeof fetch};
  const create=()=>new BackendCore({path,provider:'fixture',contentPolicy:'synthetic-only',velaHistoryContext,nativeMedia},()=>{},native,undefined,api);let core=create();
  const preview=async(text=objective)=>await core.command('missions',{name:'preview',input:{objective:text}}) as MissionPlanningOffer;
  const plan=async(offer:MissionPlanningOffer,requestId=randomUUID())=>await core.command('missionPlanReviewed',{objective:offer.objective,fingerprint:offer.fingerprint,requestId}) as MissionPreview;
  return {get core(){return core;},directory,requests,replies,preview,plan,
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
      const contract = 'aerynth.vela-mission-proposal@1';
      assert(body.text.format.schema.required.includes('contract'));
      assert.deepEqual(body.text.format.schema.properties.contract.enum, [contract]);
      const payload=JSON.parse(body.input[0].content);assert.equal(payload.objective,objective);assert.ok(!payload.capabilities.some((item:any)=>/server.*(?:log|process)/iu.test(item.description)));return response(JSON.stringify({contract,...graph}),body.model);});
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
    assert.equal(profile.quality.objectiveVerified, false);
    assert.ok(profile.quality.criteria.every(criterion => criterion.state === 'verified' && criterion.proofs.length > 0));
    assert.ok(profile.experiment.blockers.includes('objective-not-verified'));
    const timing=profile.planning?.timing;
    assert.ok(timing&&timing.firstTextDeltaMs!==null&&timing.responseCreatedMs!==null);
    const clock = timing.lifecycleClock;
    assert.ok(clock && profile.requestIntake && profile.admission?.monotonicMs != null);
    assert.equal(clock.domain, profile.requestIntake.clock);
    assert.deepEqual(profile.planning?.lifecycle, {
      validatedToStartCommandMs: profile.requestIntake.monotonicMs - clock.validatedMs,
      planningCommandToAdmissionMs: profile.admission.monotonicMs - clock.commandStartedMs,
      planningCommandToFirstVerifiedTaskMs: profile.verifiedTaskMilestones.first!.settlement.monotonicMs! - clock.commandStartedMs,
      planningCommandToLastSettlementMs: profile.lastSettlement!.monotonicMs! - clock.commandStartedMs,
      planningCommandToReportStagedMs: profile.reportPublication!.timing!.stagedMs - clock.commandStartedMs,
      planningCommandToRendererReceiptMs: null,
    });
    assert.ok(profile.planning!.lifecycle!.validatedToStartCommandMs >= 0);
    const transport = timing.transport;
    assert.ok(transport && transport.postAttemptMs !== null && transport.headersMs !== null && transport.firstSseBytesMs !== null);
    assert.ok(transport.postAttemptMs <= transport.headersMs && transport.headersMs <= transport.firstSseBytesMs &&
      transport.firstSseBytesMs <= transport.finishedMs && transport.finishedMs <= timing.providerResultMs);
    assert.ok(timing.responseCreatedMs<=timing.firstTextDeltaMs&&timing.firstTextDeltaMs<=timing.providerResultMs);
    assert.ok(timing.validationMs>=0&&timing.providerResultMs+timing.validationMs<=profile.planning!.durationMs);
    assert.equal(profile.planning?.providerEvidence,'simulated');
    const leaseReceipts = settled.tasks.map(task => task.attempts[0].resourceLease);
    for (const lease of leaseReceipts) {
      assert.ok(lease);
      assert.equal(lease.schemaVersion, 1);
      assert.ok(lease.epoch && lease.policyRevision > 0);
    }
    assert.equal(new Set(leaseReceipts.map(lease => lease?.leaseId)).size, settled.tasks.length);
    const state=await f.core.command('vela',{name:'state',input:{}}) as VelaBackendState;
    const report=state.conversation!.messages.find(message=>message.missionReport?.missionId===running.id)!;assert.ok(report);assert.equal(report.source,'vela-native');
    assert.match(report.content,/investigation remains incomplete/);assert.match(report.content,/CPU.*RAM/su);assert.match(report.content,/cannot establish the server lag cause/);assert.doesNotMatch(report.content,/server lag (?:is caused|was fixed)/iu);
    assert.deepEqual(await f.core.command('rendererVelaOutput', { missionId: running.id, messageId: report.id }), { accepted: true });
    const delivered = await readProfile();
    assert.ok(delivered && 'kind' in delivered && delivered.kind === 'execution-profile' && delivered.userDelivery?.stagingToReceiptMs != null);
    assert.equal(delivered.planning?.lifecycle?.planningCommandToRendererReceiptMs,
      profile.planning!.lifecycle!.planningCommandToReportStagedMs! + delivered.userDelivery.stagingToReceiptMs);
    await f.reopen();const restored=await f.core.command('missions',{name:'read',input:{id:running.id}}) as MissionProjection;
    assert.equal(restored.outcome,'blocked');assert.deepEqual(restored.coverage,settled.coverage);assert.equal(f.requests.length,1);
    const restoredProfile=await readProfile();
    assert.ok(restoredProfile&&'kind' in restoredProfile&&restoredProfile.kind==='execution-profile');
    assert.deepEqual(restored.tasks.map(task => task.attempts[0].resourceLease), leaseReceipts);
    assert.deepEqual(restoredProfile.planning,delivered.planning);
    const publication = delivered.reportPublication!;
    const unrelatedPublication = { ...publication, timing: { ...publication.timing!, clock: 'unrelated-report-clock' } };
    const unrelatedDelivery = projectMissionExecution(restored, unrelatedPublication, delivered.userDelivery).planning?.lifecycle;
    assert.equal(unrelatedDelivery?.planningCommandToAdmissionMs, profile.planning!.lifecycle!.planningCommandToAdmissionMs);
    assert.equal(unrelatedDelivery?.planningCommandToReportStagedMs, null);
    assert.equal(unrelatedDelivery?.planningCommandToRendererReceiptMs, null);
    const unlinked = structuredClone(restored);
    const unlinkedClock = unlinked.planning!.timing!.lifecycleClock!;
    unlinkedClock.domain = 'unrelated-clock-fixture';
    assert.equal(projectMissionExecution(unlinked).planning?.lifecycle, null);
    unlinkedClock.domain = clock.domain;
    unlinkedClock.validatedMs = profile.requestIntake.monotonicMs + 1;
    assert.equal(projectMissionExecution(unlinked).planning?.lifecycle, null);
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
    const profile = await f.core.command('missions', { name: 'execution-profile', input: { id: mission.id } });
    assert.ok(profile && 'kind' in profile && profile.kind === 'execution-profile');
    assert.equal(profile.planning?.executionId, cognition.runs.at(-1)?.executionId);
    const timing = profile.planning?.timing;
    assert.ok(timing?.transport && timing.transport.finishedMs <= timing.providerResultMs);
    assert.ok(settled.tasks.every(task => task.attempts[0].resourceLease?.schemaVersion === 1));
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

test('native adaptive CIE requires qualified stages and reviews the resolved model', async () => {
  const f = fixture(true);
  try {
    await f.ready();
    const intent = 'When should I inspect the fictional pump?';
    const admission = { configurationVersion: 1, models: ['gpt-6.1-sol', 'gpt-6-luna'], authorize: (review: {
      model: string; purpose: string; qualification?: { evidence: string };
    }) => {
      assert.equal(review.purpose, 'investigation');
      assert.equal(review.qualification?.evidence, 'simulated');
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
    f.replies.push(reply(interpreted), reply({ version: 3, clarification: '', assessment: [
      { key: 'day', status: 'missing', passages: [], query: '' },
    ] }));
    const result = await f.core.investigateVelaHistory(intent, { ...admission, ...callerMetadata });
    assert.equal(result.state, 'assessed');
    assert.equal(f.requests.length, 6);
    const runtime = (f.core as unknown as { velaApiRuntime: VelaApiRuntime }).velaApiRuntime;
    assert.equal(runtime.missionCognitiveReceipts(callerMetadata.planningRequestId, 'unrelated-mission'), undefined);
    await f.pin({providerId:'openai-api-vela',model:'gpt-6.1-sol'});
    assert.equal((await f.core.investigateVelaHistory(intent, admission)).state, 'unavailable');
    assert.equal(f.requests.length, 6);
    await f.core.command('vela',{name:'saveRoutingSettings',input:{scope:'global',id:null,expectedVersion:1,defaults:{}}});
    await f.core.command('velaApiUsageAuthorize',{expectedVersion:1,enabled:false});
    await f.core.command('velaApiUsageAuthorize',{expectedVersion:1,enabled:true});
    assert.equal((await f.core.investigateVelaHistory(intent, admission)).state, 'unavailable');
    assert.equal(f.requests.length, 6);
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
