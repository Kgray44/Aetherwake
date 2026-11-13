import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fixtureFileEditHost, fixtureFileEditScratchRoot } from './fixture-file-edit-admission.mts';
import { tmpdir } from 'node:os';
import { join,resolve,relative,isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { BackendCore } from '../src/core.mts';
import type { NoteDocument } from '../../block-library/note-contracts.ts';
import type { CreatedBlock } from '../../block-library/contracts.ts';
import { createRequire } from 'node:module';
const { conversationCommand } = createRequire(import.meta.url)('../../visual-experience/cinematic-v3/native/conversation-broker.cjs');
const { velaCommand } = createRequire(import.meta.url)('../../visual-experience/cinematic-v3/native/vela-broker.cjs');
const { validateReview: validateNativeVelaReview, reviewPage: nativeVelaReviewPage } = createRequire(import.meta.url)('../../visual-experience/cinematic-v3/native/vela-review.cjs');
import type { ConversationSendInput,OrdinaryConnectionPort,StreamEvent,VelaRequestPreview } from '../src/contracts.mts';
import type { ProviderConnectionStatus } from '../../application-contract/provider-connections.ts';
import type { VelaRequest, VelaState } from '../../vela-core/src/contracts.ts';
import type { VelaRoutingSettingsChange } from '../../vela-core/src/routing-settings.ts';
import type { VelaRoutingSample } from '../../vela-core/src/routing-calibration.ts';
import { agentTemplates } from '../../agent-product/service.mts';
import { VELA_IDENTITY_PROMPT, VELA_IDENTITY_VERSION } from '../../vela-core/src/vela-identity.mts';
import type { AgentMutationReceipt, AgentProviderCatalog } from '../../agent-product/contracts.ts';
import { RESPONSES_ENDPOINT } from '../../openai-provider/responses.mts';
import type { MissionPlanningOffer, MissionPreview, MissionProjection, MissionWorkroom, MissionWorkroomPreview } from '../src/mission-contracts.mts';
import type { MissionTeam } from '../src/mission-teams.mts';
const providerId='chatgpt-plan-responses',boundary='a'.repeat(64),model='synthetic-plan-model';
const documentedModel = { id: 'gpt-6.1-sol', label: 'Synthetic catalog Sol' };
function sse(events:unknown[]){return new Response(events.map(event=>'data: '+JSON.stringify(event)+'\n\n').join(''),{headers:{'Content-Type':'text/event-stream'}});}
function fixture(useCodexProtocolDouble = false, codexMode = 'air-inspection', historyContext?: boolean,fileEditRoots?:readonly string[]){
 const dir=mkdtempSync(join(realpathSync.native(tmpdir()),'aerynth-ordinary-responses-')),path=join(dir,'canonical.sqlite'),events:StreamEvent[]=[],requests:Record<string,any>[]=[],responses:((init:RequestInit)=>Promise<Response>|Response)[]=[];
 let listedModels=[{id:model,label:'Synthetic eligible model'}];
 let version=1,ready=true,catalogReads=0,secretReads=0,codexCalls=0,finishResolve:(()=>void)|undefined,pending=false;
 const status=async():Promise<ProviderConnectionStatus>=>({contract:'aerynth.provider-connection@1',providerId,billingRoute:'chatgpt-plan',state:ready?'ready':'disconnected',storageAvailable:true,pending,registrationVersion:version,planUsageEnabled:ready,inferenceVerified:false,nativeAccountHistory:false,nativeAccountMemory:false,nativeAccountSync:false});
 const connection:OrdinaryConnectionPort={status,begin:async()=>{pending=true;return {attemptId:'synthetic-attempt',authorizationUrl:'https://auth.openai.com/synthetic-only',expiresAt:Date.now()+60000};},finish:async()=>new Promise<void>(resolve=>{finishResolve=()=>{pending=false;resolve();};}),cancel:async()=>{pending=false;finishResolve?.();},disconnect:async expected=>{assert.equal(expected,version);version++;ready=false;},refresh:async expected=>{assert.equal(expected,version);version++;},close:async()=>{finishResolve?.();},
  resolveCredential:async expected=>{secretReads++;assert.equal(expected,version,'credential version changed');assert(ready);return {providerId,kind:'chatgpt-plan',boundaryDigest:boundary,bearer:'SYNTHETIC_PLAN_TOKEN',expiresAt:Date.now()+60000,scopes:['chatgpt.tokens.use.direct']};},
  modelCatalog:async expected=>{catalogReads++;assert.equal(expected,version);assert(ready);return {providerId,boundaryDigest:boundary,observedAt:Date.now(),catalogOnly:true,models:listedModels};},
  revalidateCredential:async(expected,digest)=>{assert.equal(expected,version,'credential version changed');assert.equal(digest,boundary);assert(ready);},
 };
 const fakeFetch:typeof fetch=async(url,init)=>{assert.equal(url,RESPONSES_ENDPOINT);assert.equal(new Headers(init?.headers).get('authorization'),'Bearer SYNTHETIC_PLAN_TOKEN');const body=JSON.parse(String(init?.body));assert.equal(body.store,false);assert.equal(body.stream,true);assert.deepEqual(Object.keys(body),['model','instructions','input','store','stream',...(body.reasoning?['reasoning']:[]),...(body.tools?['tools','tool_choice']:[])]);requests.push(body);const response=responses.shift();assert(response,'unexpected provider request');return response(init!);};
 const provider = useCodexProtocolDouble ? { provider: 'codex' as const, codexExecutable: process.execPath,
   codexArgs: [fileURLToPath(new URL('../../codex-bridge/tests/catalog-server.mjs', import.meta.url)), codexMode] } : { provider: 'fixture' as const };
 let core:BackendCore;const create=()=>{core=new BackendCore({path,...provider,contentPolicy:'synthetic-only',...(historyContext===undefined?{}:{velaHistoryContext:historyContext})},event=>events.push(event),fileEditRoots?fixtureFileEditHost([dir,...fileEditRoots]):undefined,{connection,fetch:fakeFetch});if(!useCodexProtocolDouble){const port=(core as any).port;for(const key of ['connect','capabilities','open','resume','read','items','turn','terminal','interrupt'])port[key]=()=>{codexCalls++;throw Error('Codex must never serve ordinary Responses');};}};create();
 return {get core(){return core;},get owner(){return core as any;},events,requests,responses,connection,get catalogReads(){return catalogReads;},get secretReads(){return secretReads;},get codexCalls(){return codexCalls;},setListedModels(models:{id:string;label:string}[]){listedModels=models;},disconnect(){version++;ready=false;},async reopen(){if(!(core as any).closed)await core.command('close',{});create();},async close(){if(!(core as any).closed)await core.command('close',{});const part=relative(realpathSync.native(tmpdir()),resolve(dir));assert(part.startsWith('aerynth-ordinary-responses-')&&!part.startsWith('..')&&!isAbsolute(part));rmSync(dir,{recursive:true,force:true});}};
}
function complete(id:string,text='Synthetic response'){return sse([{type:'response.created',response:{id}},{type:'response.output_text.delta',delta:text},{type:'response.completed',response:{id,status:'completed',model,usage:{input_tokens:11,output_tokens:3,total_tokens:14},output:[]}}]);}
async function prepare(f:ReturnType<typeof fixture>,resourceId:string,content:string){const d=await f.core.command('conversation',{name:'detail',input:{resourceId}}) as any,input:ConversationSendInput={resourceId,content,expectedRevision:d.conversation.revision,commandId:randomUUID()},preview=await f.core.command('conversationSendPreview',input);return {input,preview};}

test('a captured chat reply retains the edited note, workspace placement and save receipt across restart', async () => {
 const f=fixture();
 try {
  const chat=await f.core.command('createConversation',{providerId:'local',commandId:randomUUID()});
  const user=await f.core.command('addMessage',{resourceId:chat.resourceId,role:'user',content:'Synthetic question',expectedRevision:chat.revision});
  const reply=await f.core.command('addMessage',{resourceId:chat.resourceId,role:'assistant',content:'Synthetic complete reply',expectedRevision:user.revision});
  const input={resourceId:chat.resourceId,messageId:reply.id,commandId:randomUUID()};
  const capture=(request:typeof input)=>f.core.command('conversation',{name:'captureReplyNote',input:request}) as Promise<{noteId:string}>;
  const receipt=await capture(input);
  const opened=await f.core.command('openResource',{resourceId:receipt.noteId,origin:{source:'application'}});
  assert.equal(opened.status,'ready');
  const readNote=async()=>(await f.core.command('notes',{name:'readNote',input:receipt.noteId})).result as NoteDocument;
  const note=await readNote();
  assert.equal(note.resource.content,reply.content);
  const edited='Synthetic edited reply note';
  const updated=(await f.core.command('notes',{name:'commitNote',input:{
    resourceId:receipt.noteId,expectedResourceVersion:note.resource.version,
    expectedDraftVersion:note.draftRevision,content:edited,
  }})).result as NoteDocument;
  assert.equal(updated.resource.content,edited);
  const workspace=await f.core.command('desktop',{type:'createWorkspace',title:'Synthetic saved reply workspace',projectId:null});
  const workspaceId=workspace.activeWorkspaceId!;
  const attachInput={commandId:randomUUID(),workspaceId,expectedLayoutVersion:workspace.layoutVersion,
    resourceId:receipt.noteId,expectedResourceVersion:updated.resource.version,kind:'note' as const};
  const place=async()=>(await f.core.command('library',{name:'attachBlock',input:attachInput})).result as CreatedBlock;
  const placement=await place();
  assert.equal(placement.resourceId,receipt.noteId);
  assert.equal(placement.workspaceId,workspaceId);
  await assert.rejects(capture({...input,messageId:user.id}),/source_unavailable/);
  const unrelated=await f.core.command('createConversation',{providerId:'local',commandId:randomUUID()});
  await assert.rejects(capture({...input,resourceId:unrelated.resourceId}),/source_unavailable/);
  f.owner.state.messageEvidence[reply.id]={outputState:'partial'};
  await assert.rejects(capture(input),/source_unavailable/);
  delete f.owner.state.messageEvidence[reply.id];
  await f.reopen();
  assert.deepEqual(await capture(input),receipt);
  assert.deepEqual(await place(),placement);
  const restored=await readNote();
  assert.equal(restored.resource.id,receipt.noteId);
  assert.equal(restored.resource.content,edited);
  const desktop=await f.core.command('desktop',{type:'snapshot'});
  assert.deepEqual(desktop.resources.filter(resource=>resource.kind==='note').map(resource=>resource.id),[receipt.noteId]);
  assert.deepEqual(desktop.blocks.filter(block=>block.resource_id===receipt.noteId).map(block=>[block.id,block.workspace_id]),
    [[placement.placementId,workspaceId]]);
 } finally {await f.close();}
});
async function grant(f:ReturnType<typeof fixture>,preview:Awaited<ReturnType<typeof prepare>>['preview']){const g=await f.core.command('authorizeConversationSend',{previewId:preview.id,fingerprint:preview.fingerprint,commandId:preview.commandId});return {previewId:preview.id,fingerprint:preview.fingerprint,commandId:preview.commandId,grantId:g.grantId};}

test('a reviewed planning request compiles one graph and runs native dependencies and a specialist after review', async () => {
  const f = fixture();
  try {
    const desktop = await f.core.command('desktop', { type: 'createWorkspace', title: 'Synthetic planning workspace', projectId: null });
    const workspaceId = desktop.workspaces[0].id;
    const enter = () => f.core.command('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId } });
    await enter();
    const objective = 'Plan a mission to read physical memory after recording processor load and get an independent review of measurement pitfalls';
    const preview = (objective: string) => f.core.command('missions', { name: 'preview', input: { objective } });
    const unavailable = await preview(objective) as MissionPlanningOffer;
    assert.equal(unavailable.kind, 'planning-offer');
    assert.equal(unavailable.planner, undefined);
    f.setListedModels([documentedModel]);
    await f.core.command('ordinaryProviderCheck', {});
    await f.core.command('vela', { name: 'saveRoutingSettings', input: { scope: 'global', id: null, expectedVersion: 0, defaults: { providerId } } });
    assert.equal(await preview('Explain how processor and memory counters differ'), null);
    const local = await preview('Run a mission to measure CPU and RAM') as MissionPreview;
    assert.ok(local.plan);
    const offer = await preview(objective) as MissionPlanningOffer;
    assert.equal(offer.planner?.model, documentedModel.id);
    const input = { objective, fingerprint: offer.fingerprint, requestId: randomUUID() };
    await assert.rejects(f.core.command('missions', { name: 'plan', input }), /invalid_mission_command/);
    await assert.rejects(f.core.command('missionPlanReviewed', { ...input, objective: objective + ' today' }), /mission_preview_changed/);
    assert.equal(f.requests.length, 0);
    const role = { title: 'Measurement design reviewer', responsibility: 'Identify control conditions for comparing CPU and RAM.' };
    const output = JSON.stringify({ tasks: [
      { capability: 'cpu', after: [] }, { capability: 'ram', after: ['cpu'] }, { capability: 'temporary-specialist-1', after: [], role },
    ], unsupported: [] });
    f.responses.push(() => sse([
      { type: 'response.created', response: { id: 'resp_synthetic_plan' } },
      { type: 'response.output_text.delta', delta: output },
      { type: 'response.completed', response: { id: 'resp_synthetic_plan', status: 'completed', model: documentedModel.id,
        usage: { input_tokens: 70, output_tokens: 18, total_tokens: 88 }, output: [] } },
    ]));
    const proposed = await f.core.command('missionPlanReviewed', input) as MissionPreview;
    assert.equal(proposed.proposalId, input.requestId);
    const planningTiming = proposed.plan.planning?.timing;
    assert.ok(planningTiming && planningTiming.responseCreatedMs !== null && planningTiming.firstTextDeltaMs !== null);
    assert.ok(planningTiming.responseCreatedMs <= planningTiming.firstTextDeltaMs &&
      planningTiming.firstTextDeltaMs <= planningTiming.providerResultMs);
    assert.deepEqual(proposed.plan.tasks.map(task => [task.id, task.dependencies]), [
      ['cpu', []], ['ram', ['cpu']], ['temporary-specialist-1', []], ['report', ['cpu', 'ram', 'temporary-specialist-1']],
    ]);
    const specialist = proposed.plan.tasks[2];
    assert.equal(specialist.specialist?.role, role.title);
    assert.equal(specialist.objective, role.responsibility);
    assert.equal(specialist.specialist?.profile, undefined);
    assert.equal(specialist.specialist?.webSearch, undefined);
    assert.equal(f.requests.length, 1);
    const body = f.requests[0];
    assert.equal(body.input.length, 1);
    assert.equal(body.input[0].role, 'user');
    const sent = JSON.parse(body.input[0].content);
    assert.deepEqual(Object.keys(sent).sort(), ['capabilities', 'objective']);
    assert.equal(sent.objective, objective);
    assert.ok(sent.capabilities.every((task: object) => Object.keys(task).sort().join(',') === 'description,id'));
    assert.deepEqual(await f.core.command('missions', { name: 'list', input: {} }), []);
    await assert.rejects(f.core.command('missionPlanReviewed', input), /mission_planning_already_attempted/);
    const start = { ...input, fingerprint: proposed.fingerprint, proposalId: proposed.proposalId };
    await assert.rejects(f.core.command('missions', { name: 'start', input: { ...start, proposalId: randomUUID() } }), /mission_preview_changed/);
    await assert.rejects(f.core.command('missions', { name: 'start', input: start }), /mission_native_review_or_connection_required/);
    assert.equal(f.requests.length, 1);
    f.responses.push(() => sse([
      { type: 'response.created', response: { id: 'resp_synthetic_review' } },
      { type: 'response.output_text.delta', delta: JSON.stringify({ observations: [
        'Measure CPU and RAM over comparable intervals', 'Separate process memory from system memory',
      ] }) },
      { type: 'response.completed', response: { id: 'resp_synthetic_review', status: 'completed', model: documentedModel.id,
        usage: { input_tokens: 42, output_tokens: 12, total_tokens: 54 }, output: [] } },
    ]));
    const { id } = await f.core.command('missionStartReviewed', start) as MissionProjection;
    const read = () => f.core.command('missions', { name: 'read', input: { id } }) as Promise<MissionProjection>;
    let mission = await read();
    const deadline = performance.now() + 5000;
    while (['queued', 'running'].includes(mission.outcome) && performance.now() < deadline) {
      await wait(25);
      mission = await read();
    }
    assert.equal(mission.outcome, 'verified');
    assert.ok(mission.events.find(event => event.kind === 'settled' && event.taskId === 'cpu')!.seq <
      mission.events.find(event => event.kind === 'started' && event.taskId === 'ram')!.seq);
    assert.equal(mission.profile.providerCalls, 2);
    assert.equal(mission.profile.reportedTotalTokens, null);
    assert.equal(mission.profile.verifiedObjectivesPerReportedToken, null);
    const profile = await f.core.command('missions', { name: 'execution-profile', input: { id } });
    assert.ok(profile && 'kind' in profile && profile.kind === 'execution-profile');
    assert.equal(profile.economics.simulatedTotalTokens, 142);
    assert.equal(f.requests.length, 2);
    assert.deepEqual(f.requests[1].input, [{ role: 'user', content: objective }]);
    assert(f.requests[1].instructions.includes(role.responsibility));
    assert.equal(f.requests[1].tools, undefined);
    await f.reopen();
    await enter();
    assert.equal((await read()).planning?.responseId, 'resp_synthetic_plan');
    await f.core.command('ordinaryProviderCheck', {});
    const fresh = await preview(objective) as MissionPlanningOffer;
    await assert.rejects(f.core.command('missionPlanReviewed', { ...input, fingerprint: fresh.fingerprint }), /mission_planning_already_attempted/);
    assert.equal(f.requests.length, 2);
  } finally { await f.close(); }
});

test('reviewed mission runs two isolated stateless specialists concurrently and retains attributable usage', async () => {
  const f = fixture();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  try {
    f.setListedModels([documentedModel]);
    await f.core.command('ordinaryProviderCheck', {});
    await f.core.command('vela', { name: 'saveRoutingSettings', input: { scope: 'global', id: null, expectedVersion: 0, defaults: { providerId } } });
    const d = await f.core.command('desktop', { type: 'createWorkspace', title: 'Synthetic performance mission', projectId: null });
    await f.core.command('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId: d.workspaces[0].id } });
    const objective = 'Investigate Aerynth backend performance with two independent specialists';
    const preview = await f.core.command('missions', { name: 'preview', input: { objective } }) as MissionPreview;
    assert.equal(preview.externalReview?.calls, 2);
    assert.equal(preview.externalReview?.model, documentedModel.id);
    const input = { objective, fingerprint: preview.fingerprint, requestId: randomUUID() };
    await assert.rejects(f.core.command('missions', { name: 'start', input }), /mission_native_review_or_connection_required/);
    assert.equal(f.requests.length, 0);
    const report = (id: string, items: string[]) => async () => {
      await gate;
      return sse([{ type: 'response.created', response: { id } },
        { type: 'response.output_text.delta', delta: JSON.stringify({ observations: items }) },
        { type: 'response.completed', response: { id, status: 'completed', model: documentedModel.id,
          usage: { input_tokens: 50, output_tokens: 12, total_tokens: 62 }, output: [] } }]);
    };
    f.responses.push(report('resp_synthetic_methods', ['Run multiple warmup iterations', 'Measure a fixed baseline workload']),
      report('resp_synthetic_review', ['Check competing processes during the run', 'Record CPU and renderer sampling windows']));
    const { id } = await f.core.command('missionStartReviewed', input) as MissionProjection;
    const until = performance.now() + 5000;
    while (f.requests.length < 2 && performance.now() < until) await wait(25);
    assert.equal(f.requests.length, 2, 'Both requests must reach the transport before either can finish');
    assert.notEqual(f.requests[0].instructions, f.requests[1].instructions);
    assert.deepEqual(f.requests.map(req => req.input), Array(2).fill([{ role: 'user', content: objective }]));
    assert.ok(f.requests.every(req => !req.tools && req.store === false && req.reasoning?.effort === 'low'));
    release();
    const read = () => f.core.command('missions', { name: 'read', input: { id } }) as Promise<MissionProjection>;
    // Dispatch and post-release verification have separate bounded waits.
    // A slow dispatch must not spend the native follow-up/report settlement budget.
    const settledUntil = performance.now() + 5000;
    let completed = await read();
    while (['queued', 'running'].includes(completed.outcome) && performance.now() < settledUntil) {
      await wait(25); completed = await read();
    }
    assert.equal(completed.outcome, 'verified', JSON.stringify(completed.tasks.map(t => [t.id, t.state, t.detail])));
    const specialists = completed.tasks.filter(t => t.specialist).map(t => t.attempts[0]);
    assert.equal(new Set(specialists.map(a => a.id)).size, 2);
    assert.equal(new Set(specialists.map(a => a.telemetry?.responseId)).size, 2);
    assert.ok(specialists.every(a => a.telemetry?.usage?.totalTokens === 62 && a.evidence?.source.endsWith(':reported')));
    assert.equal(f.events.filter(e => e.type === 'provider/usage' && e.correlationId === id && e.classification === 'simulated').length, 2);
  } finally { release(); await f.close(); }
});

test('reviewed saved teams bind roles, reconcile concurrent reports and link the originating Vela chat', async () => {
  const f = fixture();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  try {
    f.setListedModels([documentedModel]);
    await f.core.command('ordinaryProviderCheck', {});
    await f.core.command('vela', { name: 'saveRoutingSettings', input: { scope: 'global', id: null, expectedVersion: 0, defaults: { providerId } } });
    const desktop = await f.core.command('desktop', { type: 'createWorkspace', title: 'Synthetic team workspace', projectId: null });
    const workspaceId = desktop.activeWorkspaceId!;
    const navigate = (id: string) => f.core.command('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId: id } });
    await navigate(workspaceId);
    const members: MissionTeam['members'] = [];
    for (const [title, responsibility] of [
      ['Measurement specialist', 'Describe how to measure warmup.'],
      ['Evidence reviewer', 'Check the validity of warmup comparisons.'],
    ]) {
      const profile = structuredClone(agentTemplates()[0].profile);
      const { result } = await f.core.command('agents', { name: 'create', input: {
        commandId: randomUUID(), title, projectId: null, profile,
      } });
      members.push({ profileId: (result as AgentMutationReceipt).agent.resourceId, responsibility });
    }
    const save = async (title: string, previous?: MissionTeam) =>
      await f.core.command('missions', { name: 'team-save', input: {
        title, members, ...(previous ? { id: previous.id, expectedVersion: previous.version } : {}),
      } }) as MissionTeam;
    const team = await save('Synthetic measurement team');
    const objective = 'Assess a synthetic benchmark plan';
    const preview = () => f.core.command('missions', { name: 'preview', input: { objective, teamId: team.id } }) as Promise<MissionPreview>;
    const startInput = (review: MissionPreview) => ({ objective, teamId: team.id, fingerprint: review.fingerprint, requestId: randomUUID() });
    const stale = await preview();
    const saved = await save('Revised synthetic measurement team', team);
    await assert.rejects(f.core.command('missionStartReviewed', startInput(stale)), /mission_preview_changed/);
    const review = await preview();
    assert.equal(review.plan?.team?.version, saved.version);
    assert.deepEqual(review.plan?.tasks.slice(0, 2).map(task => task.specialist?.profile?.id), members.map(member => member.profileId));
    assert.equal(review.externalReview?.calls, 2);
    const input = startInput(review);
    await assert.rejects(f.core.command('missions', { name: 'start', input }), /mission_native_review_or_connection_required/);
    assert.equal(f.requests.length, 0);
    for (const [index, observation] of ['Use a fixed workload.', 'Record background activity.'].entries()) {
      f.responses.push(async () => {
        await gate;
        const id = 'resp_team_member_' + index;
        return sse([{ type: 'response.created', response: { id } },
          { type: 'response.output_text.delta', delta: JSON.stringify({ observations: ['Repeat the warmup.', observation],
            assessments: [{ claim: 'A fixed workload controls variability', position: index ? 'challenges' : 'supports', observation: 1 }] }) },
          { type: 'response.completed', response: { id, status: 'completed', model: documentedModel.id,
            usage: { input_tokens: 50, output_tokens: 12, total_tokens: 62 }, output: [] } }]);
      });
    }
    const mission = await f.core.command('missionStartReviewed', input) as MissionProjection;
    const post = () => f.core.command('missions', { name: 'post-report', input: { id: mission.id } });
    await assert.rejects(post(), /mission_report_unavailable/);
    const until = performance.now() + 5000;
    while (f.requests.length < 2 && performance.now() < until) await wait(10);
    assert.equal(f.requests.length, 2, 'Both roles must dispatch before either can return');
    for (const member of members) assert.equal(f.requests.filter(request => request.instructions.includes(member.responsibility)).length, 1);
    const roomReview = await f.core.command('missions', { name: 'workroom-preview', input: { id: mission.id } }) as MissionWorkroomPreview;
    assert.ok(roomReview.cards.some(card => card.title === 'Mission agent team' && card.kind === 'note'));
    const room = await f.core.command('missions', { name: 'workroom-apply', input: { id: mission.id, reviewId: roomReview.reviewId } }) as MissionWorkroom;
    const { team: teamCardId, evidence: evidenceCardId, stream: streamCardId } = room.missionCards ?? {};
    assert.ok(teamCardId && evidenceCardId && streamCardId);
    await navigate(room.workspaceId);
    const dashboard = async (resourceId: string) => {
      const card = await f.core.command('missions', { name: 'workroom-resource', input: { resourceId } });
      assert.ok(card && 'kind' in card && card.kind === 'workroom-resource' && card.dashboard);
      return card.dashboard;
    };
    const activeTeam = await dashboard(teamCardId);
    assert.deepEqual(activeTeam, { kind: 'team', title: saved.title, members: [
      { taskId: 'member-1', role: 'Measurement specialist', responsibility: members[0].responsibility,
        state: 'running', provider: providerId, model: documentedModel.id, attempts: 1 },
      { taskId: 'member-2', role: 'Evidence reviewer', responsibility: members[1].responsibility,
        state: 'running', provider: providerId, model: documentedModel.id, attempts: 1 },
    ] });
    const liveBefore = f.events.length;
    release();
    const read = () => f.core.command('missions', { name: 'read', input: { id: mission.id } }) as Promise<MissionProjection>;
    const settlesUntil = performance.now() + 5000;
    let completed = await read();
    while (['queued', 'running'].includes(completed.outcome) && performance.now() < settlesUntil) { await wait(10); completed = await read(); }
    assert.equal(completed.outcome, 'blocked', JSON.stringify(completed.tasks.map(t => [t.id, t.state, t.detail])));
    assert.equal(completed.coverage?.status,'partial');assert.equal(completed.profile.verifiedObjectivesPerReportedToken,null);
    const completedTeam = await dashboard(teamCardId);
    assert.ok(completedTeam.kind === 'team' && completedTeam.members.every(member => member.state === 'verified'));
    const delivered = f.events.slice(liveBefore).filter(event => event.mission?.id === mission.id);
    assert.equal(delivered.filter(event => event.mission?.kind === 'settled').length, 3);
    const workroomStream = await dashboard(streamCardId);
    assert.ok(workroomStream.kind === 'stream' && delivered.every(event => workroomStream.events.some(row => row.eventId === event.eventId)));
    const replayInWorkroom = await f.core.command('replay', { after: 0, limit: 1000 });
    assert.ok(replayInWorkroom.events.every(event => event.mission?.id !== mission.id));
    const evidence = await dashboard(evidenceCardId);
    assert.ok(evidence.kind === 'evidence');
    const findings = evidence.rows.find(row => row.taskId === 'member-1');
    assert.equal(findings?.source, 'chatgpt-plan-responses:reported');
    assert.deepEqual(findings?.findings, ['Repeat the warmup.', 'Use a fixed workload.']);
    const report = completed.tasks.find(task => task.executor === 'join.team')?.attempts[0].evidence;
    assert.deepEqual((report?.value as Record<string, unknown>).reports, completed.tasks.slice(0, 2).map(task => ({
      taskId: task.id, evidenceId: task.attempts[0].evidence?.id, attemptId: task.attempts[0].id,
    })));
    assert.deepEqual((report?.value as Record<string, unknown>).repeatedFindings, [[
      { taskId: 'member-1', index: 0 }, { taskId: 'member-2', index: 0 },
    ]]);
    assert.deepEqual((report?.value as Record<string, unknown>).conflictingAssessments, [[
      { taskId: 'member-1', index: 0, position: 'supports' }, { taskId: 'member-2', index: 0, position: 'challenges' },
    ]]);
    await navigate(workspaceId);
    const conversation = async () => (await f.core.command('vela', { name: 'state', input: {} }) as VelaState).conversation;
    const matchingLinks = async () => (await conversation())?.messages.filter(item => item.missionReport?.missionId === mission.id);
    assert.equal((await conversation())?.resourceId, mission.originConversationId);
    assert.deepEqual((await matchingLinks())?.map(item => item.missionReport), [{ missionId: mission.id, workspaceId, projectId: null, jobsDone: 2 }]);
    assert.match((await matchingLinks())?.[0].content ?? '', /reported:/u);
    assert.match((await matchingLinks())?.[0].content ?? '', /investigation remains incomplete.*independent domain evidence/su);
    const posted = await post();
    assert.deepEqual(await post(), posted);
    const other = await f.core.command('desktop', { type: 'createWorkspace', title: 'Other synthetic workspace', projectId: null });
    await navigate(other.activeWorkspaceId!);
    assert.equal((await matchingLinks())?.length, 0);
    await assert.rejects(post(), /mission_not_found/);
    await f.reopen();
    await navigate(workspaceId);
    assert.equal((await read()).team?.version, saved.version);
    assert.equal((await matchingLinks())?.length, 1);
    assert.deepEqual(await post(), posted);
    assert.equal(f.requests.length, 2);
  } finally { release(); await f.close(); }
});

test('a research mission authorizes web search only for the source specialist and requires provider citation evidence', async () => {
  const f = fixture();
  try {
    f.setListedModels([documentedModel]);
    await f.core.command('ordinaryProviderCheck', {});
    await f.core.command('vela', { name: 'saveRoutingSettings', input: { scope: 'global', id: null, expectedVersion: 0, defaults: { providerId } } });
    const d = await f.core.command('desktop', { type: 'createWorkspace', title: 'Synthetic research room', projectId: null });
    await f.core.command('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId: d.workspaces[0].id } });
    const objective = 'Research event loop instrumentation with two independent specialists';
    const preview = await f.core.command('missions', { name: 'preview', input: { objective } }) as MissionPreview;
    assert.equal(preview.plan.tasks.filter(t => t.specialist?.webSearch).length, 1);
    const text = JSON.stringify({ observations: ['Trace the event loop with a controlled workload', 'Use stable timing sources'] });
    const result = (id: string, withCitation: boolean) => () => sse([
      { type: 'response.created', response: { id } },
      { type: 'response.output_text.delta', delta: text },
      { type: 'response.completed', response: { id, status: 'completed', model: documentedModel.id, output: withCitation ? [
        { type: 'web_search_call', status: 'completed' },
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text, annotations: [
          { type: 'url_citation', start_index: 18, end_index: 33, url: 'https://example.org/measurement', title: 'Synthetic source' },
        ] }] },
      ] : [] } },
    ]);
    f.responses.push(result('resp_research', true), result('resp_review', false));
    const run = await f.core.command('missionStartReviewed', { objective, requestId: randomUUID(), fingerprint: preview.fingerprint }) as MissionProjection;
    const end = performance.now() + 5000;
    let mission: MissionProjection;
    do {
      mission = await f.core.command('missions', { name: 'read', input: { id: run.id } }) as MissionProjection;
      if (mission.outcome !== 'queued' && mission.outcome !== 'running') break;
      await wait(25);
    } while (performance.now() < end);
    assert.equal(mission.outcome, 'blocked');
    assert.equal(mission.coverage?.status,'partial');assert.ok(mission.tasks.every(task=>task.state==='verified'));
    assert.match(mission.coverage!.limitations.join(' '),/citations are provider reports.*do not independently verify/su);
    const researcher = mission.tasks.find(t => t.specialist?.webSearch)!;
    assert.deepEqual((researcher.attempts[0].evidence!.value as { citations: string[] }).citations, ['https://example.org/measurement']);
    assert.equal(f.requests.filter(req => req.tool_choice === 'required').length, 1);
    assert.equal(mission.profile.reportedTotalTokens, null);
    assert.equal(mission.profile.verifiedObjectivesPerReportedToken,null);
    const conversation=(await f.core.command('vela',{name:'state',input:{}}) as VelaState).conversation;
    const partial=conversation!.messages.find(message=>message.missionReport?.missionId===mission.id)!;
    assert.equal(partial.source,'vela-native');assert.match(partial.content,/investigation remains incomplete.*Specialist findings and citations are provider reports/su);
    const review = await f.core.command('missions', { name: 'workroom-preview', input: { id: mission.id } }) as MissionWorkroomPreview;
    const room = await f.core.command('missions', { name: 'workroom-apply', input: { id: mission.id, reviewId: review.reviewId } }) as MissionWorkroom;
    const resourceId = room.missionCards?.evidence;
    assert.ok(resourceId);
    await f.core.command('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId: room.workspaceId } });
    const card = await f.core.command('missions', { name: 'workroom-resource', input: { resourceId } });
    assert.ok(card && 'kind' in card && card.kind === 'workroom-resource' && card.dashboard?.kind === 'evidence');
    assert.deepEqual(card.dashboard.rows.find(row => row.taskId === researcher.id)?.citations, ['https://example.org/measurement']);
    assert.equal(f.requests.length, 2, 'Opening the workroom must use the recorded citations');
  } finally { await f.close(); }
});

test('Compare faster answers only when I turn it on, and keep my model choice', async () => {
  const f = fixture();
  try {
    const baseline = 'gpt-6-sol', alternative = 'gpt-6-luna';
    f.setListedModels([{ id: baseline, label: 'Baseline model' }, { id: alternative, label: 'Alternative model' }]);
    const rows = (model: string, elapsedMs: number, totalTokens: number, projectId: string | null = null): VelaRoutingSample[] =>
      Array.from({ length: 12 }, (_, i) => ({ requestId: randomUUID(), projectId, model, effort: 'none', depth: 'quick',
        evidence: 'observed', completed: true, modelConfirmed: true, elapsedMs: elapsedMs + i, totalTokens, feedback: 'useful' }));
    const seed = (samples: VelaRoutingSample[]) => f.owner.atomic(() => { f.owner.state.velaRoutingSamples = samples; });
    seed([...rows(baseline, 1500, 70), ...rows(alternative, 600, 50, 'synthetic-other-project')]);
    const input = { intent: 'Could you explain how a speaker works?', resourceIds: [], adaptive: true as const };
    const sendPreview = (overrides = {}) => f.core.command('velaRequestPreview', { ...input, ...overrides });
    const save = (expectedVersion: number, calibration: 'shadow' | 'adaptive' | 'off') => f.core.command('vela', {
      name: 'saveRoutingSettings', input: { scope: 'global', id: null, expectedVersion, defaults: { calibration } },
    });
    assert.equal((await sendPreview()).route?.model, baseline);
    await save(0, 'shadow');
    assert.equal((await sendPreview()).route?.kind, 'conversational');
    const sameScope = rows(alternative, 700, 60);
    seed([...rows(baseline, 1500, 70), ...sameScope.map(row => ({ ...row, evidence: 'simulated' as const }))]);
    const withoutEvidence = await sendPreview();
    assert(withoutEvidence.route?.kind === 'conversational');
    assert.equal(withoutEvidence.route.calibration, undefined);
    seed([...rows(baseline, 1500, 70), ...sameScope]);
    const shadow = await sendPreview();
    assert(shadow.route?.kind === 'conversational');
    assert.equal(shadow.route.model, baseline);
    assert.equal(shadow.route.calibration?.alternative.model, alternative);
    assert.equal(shadow.route.calibration?.mode, 'shadow');
    assert.equal(f.requests.length, 0, 'Comparing existing evidence starts no extra turn.');
    await save(1, 'adaptive');
    const adaptive = await sendPreview();
    assert(adaptive.route?.kind === 'conversational');
    assert.equal(adaptive.route.model, alternative);
    assert.equal(adaptive.route.calibration?.mode, 'adaptive');
    assert.equal((await sendPreview({ model: baseline })).route?.model, baseline);
    assert.equal((await sendPreview({ overrideDefaults: true })).route?.model, baseline);
    seed([...rows(baseline, 1500, 70), ...sameScope.map(row => ({ ...row, feedback: 'needs-correction' as const }))]);
    assert.equal((await sendPreview()).route?.model, baseline);
    await save(2, 'off');
    assert.equal((await sendPreview()).route?.model, baseline);
  } finally { await f.close(); }
});

test('Vela resolves a selected agent after saved defaults and binds its version to the native send', async () => {
  const f = fixture(true), codex = 'codex-app-server';
  try {
    f.setListedModels([documentedModel, { id: model, label: 'Synthetic second model' }]);
    await f.core.command('capabilities', {});
    await f.core.command('vela', { name: 'saveRoutingSettings', input: { scope: 'global', id: null, expectedVersion: 0,
      defaults: { mode: 'codex', providerId: codex, model: 'fixture-model', reasoningEffort: 'high' } } });
    const profile = structuredClone(agentTemplates()[0].profile);
    profile.settings.providerId = { source: 'override', value: providerId };
    profile.settings.modelId = { source: 'override', value: documentedModel.id };
    profile.settings.reasoningEffort = { source: 'override', value: 'high' };
    profile.settings.additionalInstructions = { source: 'override', value: 'SYNTHETIC_AGENT_INSTRUCTIONS_v1' };
    const created = (await f.core.command('agents', { name: 'create', input: {
      commandId: randomUUID(), title: 'Synthetic routing agent', projectId: null, profile,
    } })).result as AgentMutationReceipt;
    const routingAgentId = created.agent.resourceId;
    const intent = 'Explain a synthetic feedback circuit.';
    const input = { intent, resourceIds: [], routingAgentId, adaptive: true as const };
    const preview = await f.core.command('velaRequestPreview', input);
    assert.equal(preview.providerId, providerId);
    assert.equal(preview.routingSettings?.effective.mode, 'auto');
    assert.equal(preview.routingSettings?.origins.providerId, 'agent');
    assert.equal(preview.route?.model, documentedModel.id);
    assert.equal(preview.route?.effort, 'high');
    assert.equal(preview.routingAgent?.profileVersion, 1);
    assert.equal(preview.context.agentInstructions, undefined);
    const approval = { previewId: preview.id, signature: preview.signature };
    const reviewed = await f.core.command('velaNativeReview', approval);
    assert.equal(reviewed.agentInstructions, 'SYNTHETIC_AGENT_INSTRUCTIONS_v1');
    assert.match(nativeVelaReviewPage(reviewed, intent), /Additional agent instructions/);
    await assert.rejects(f.core.command('authorizeVelaRequest', { ...approval, reviewDigest: reviewed.reviewDigest, directSend: true }),
      /vela_attached_context_review_required/);
    const catalog = (await f.core.command('agents', { name: 'catalog', input: {} })).result as AgentProviderCatalog;
    assert(catalog.providers.find(item => item.id === providerId)?.models.find(entry => entry.id === documentedModel.id)?.reasoningEfforts.includes('high'));
    const changed = (await f.core.command('agents', { name: 'update', input: { commandId: randomUUID(), agent: created.agent,
      title: 'Synthetic routing agent', profile: { ...profile, settings: { ...profile.settings,
        additionalInstructions: { source: 'override', value: 'SYNTHETIC_AGENT_INSTRUCTIONS_v2' } } } } })).result as AgentMutationReceipt;
    await assert.rejects(f.core.command('authorizeVelaRequest', { ...approval, reviewDigest: reviewed.reviewDigest }), /stale_vela_agent_routing/);
    assert.equal(f.requests.length, 0);

    const replacement = await f.core.command('velaRequestPreview', { ...input, model });
    assert.equal(replacement.route?.model, model);
    assert.equal(replacement.routingSettings?.origins.model, 'turn');
    assert.equal(replacement.routingSettings?.effective.reasoningEffort, undefined);
    const codexTurn = { intent: 'Inspect the repository for a synthetic finding.', routingAgentId, resourceIds: [], authorizeProvider: true,
      providerId: codex, mode: 'codex', model: 'fixture-model', reasoningEffort: 'high' };
    const sent = await velaCommand({
      win: { isDestroyed: () => false, webContents: { isDestroyed: () => false } }, dialog: {},
      directMessageSend: true, offerPlanningByDefault: true, input: { name: 'request', input: codexTurn },
      reviewProvider: async ({ review }: any) => {
        assert.equal(review.routingAgent.profileVersion, 2);
        assert.equal(review.agentInstructions, 'SYNTHETIC_AGENT_INSTRUCTIONS_v2');
        assert.match(review.prompt, /SYNTHETIC_AGENT_INSTRUCTIONS_v2/);
        assert.doesNotMatch(review.prompt, /SYNTHETIC_AGENT_INSTRUCTIONS_v1/);
        return true;
      },
      call: (name: any, data: any) => f.core.command(name, data),
    }) as VelaRequest;
    assert.equal(sent.state, 'responded', sent.errorCode);
    assert.equal(sent.providerId, codex);
    assert.equal(sent.routingSettings?.origins.providerId, 'turn');
    assert.deepEqual(sent.routingAgent, { ...changed.agent, title: 'Synthetic routing agent' });
    assert.equal(sent.context.agentInstructions, undefined);
    assert.equal(f.requests.length, 0);
    assert.equal(JSON.stringify(f.events).includes('SYNTHETIC_AGENT_INSTRUCTIONS'), false);
  } finally { await f.close(); }
});

function allowFixtureHandoffEvidence(f: ReturnType<typeof fixture>) {
  // Supply the proof shape in this isolated database without changing the transport classification.
  const runOrdinary = f.owner.runOrdinary.bind(f.owner);
  f.owner.runOrdinary = async (...args: any[]) => {
    const execution = await runOrdinary(...args);
    if (execution.state === 'provider_completed') {
      const evidence = f.owner.state.messageEvidence[execution.outputMessageId];
      assert.equal(evidence.classification, 'simulated');
      f.owner.atomic(() => { evidence.classification = 'reported'; });
    }
    return execution;
  };
}

test('successive ordinary Vela Sends use bounded canonical history by default with no repeat native review and fresh remains one-send only', async () => {
  const f=fixture();let reviews=0;
  const previews:VelaRequestPreview[]=[];
  const send=(intent:string,includeRecentHistory?:boolean)=>velaCommand({
    win:{isDestroyed:()=>false,webContents:{isDestroyed:()=>false}},dialog:{},offerPlanningByDefault:true,directMessageSend:true,routeNative:true,
    input:{name:'request',input:{intent,resourceIds:[],authorizeProvider:true,...(includeRecentHistory===undefined?{}:{includeRecentHistory})}},
    reviewProvider:async()=>{reviews++;return true;},call:async(name:any,input:any)=>{
      const result=await f.core.command(name,input);if(name==='velaRequestPreview')previews.push(result as VelaRequestPreview);return result;
    },
  }) as Promise<VelaRequest>;
  try {
    // This isolated protocol fixture supplies the recorded proof shape, never real provider acceptance.
    allowFixtureHandoffEvidence(f);
    f.responses.push(()=>complete('resp_continuity_first','Synthetic canonical first answer.'));
    const first=await send('Explain the first synthetic option.');assert.equal(first.state,'responded',first.errorCode);
    f.responses.push(()=>complete('resp_continuity_second','Synthetic answer using the preceding exchange.'));
    const second=await send('Compare that with the second option.');assert.equal(second.state,'responded',second.errorCode);
    const secondPreview=previews[1] as import('../src/contracts.mts').VelaRequestPreview;
    assert.equal(secondPreview.sendDisposition,'routine');assert.equal(secondPreview.history?.messageCount,2);
    assert.equal(second.conversationId,first.conversationId);assert.equal(reviews,0);
    assert.match(JSON.stringify(f.requests[1].input),/Explain the first synthetic option\./);
    assert.match(JSON.stringify(f.requests[1].input),/Synthetic canonical first answer\./);
    assert.equal(second.history?.messages.length,2);assert.equal(second.context.history,undefined);
    assert.ok(!JSON.stringify(second.history).includes('Synthetic canonical first answer.'));
    await f.reopen();allowFixtureHandoffEvidence(f);
    f.responses.push(()=>complete('resp_continuity_fresh','Synthetic fresh answer.'));
    const fresh=await send('Explain an independent synthetic topic.',false);assert.equal(fresh.state,'responded',fresh.errorCode);
    const freshPreview=previews.at(-1) as import('../src/contracts.mts').VelaRequestPreview;
    assert.equal(freshPreview.history,undefined);assert.equal(fresh.history,undefined);assert.equal(fresh.conversationId,first.conversationId);
    assert.doesNotMatch(JSON.stringify(f.requests[2].input),/Synthetic canonical first answer|Compare that with the second option/);
    const next=await f.core.command('velaRequestPreview',{intent:'Continue the current topic.',resourceIds:[],adaptive:true});
    assert.ok(next.history&&next.history.messageCount>=2);assert.equal(next.sendDisposition,'routine');
    assert.equal(reviews,0);assert.equal(f.codexCalls,0);assert.equal(f.requests.length,3);
  }finally{await f.close();}
});

test('explicit legacy history enable still works when the runtime default is disabled',async()=>{
  const f=fixture(false,'air-inspection',false);
  try {
    allowFixtureHandoffEvidence(f);
    const preview=await f.core.command('velaRequestPreview',{intent:'Explain a synthetic baseline.',resourceIds:[],adaptive:true});
    const review=await f.core.command('velaNativeReview',{previewId:preview.id,signature:preview.signature});
    const grant=await f.core.command('authorizeVelaRequest',{previewId:preview.id,signature:preview.signature,reviewDigest:review.reviewDigest,directSend:true});
    f.responses.push(()=>complete('resp_legacy_history','Synthetic baseline for an explicit opt-in.'));
    const prior=await f.core.command('vela',{name:'request',input:{intent:preview.intent,resourceIds:[],authorizeProvider:true,previewId:preview.id,grantId:grant.grantId}}) as VelaRequest;
    assert.equal(prior.state,'responded');
    assert.equal((await f.core.command('velaRequestPreview',{intent:'New synthetic turn.',resourceIds:[],adaptive:true})).history,undefined);
    const enabled=await f.core.command('velaRequestPreview',{intent:'Continue the synthetic baseline.',resourceIds:[],adaptive:true,includeRecentHistory:true});
    assert.equal(enabled.history?.messageCount,2);assert.equal(enabled.sendDisposition,'routine');assert.equal(f.requests.length,1);
  }finally{await f.close();}
});

for(const mutation of ['source-change','source-revoked','routing-change','connection-version','billing-route'] as const){
  test('routine history Send rechecks '+mutation+' between preflight and grant without a second provider dispatch',async()=>{
    const f=fixture();let reviews=0,mutated=false;
    try{
      allowFixtureHandoffEvidence(f);
      const desktop=await f.core.command('desktop',{type:'createResource',kind:'note',workspaceId:null,title:'Synthetic continuity source'});
      const note=desktop.resources.find(resource=>resource.title==='Synthetic continuity source')!;
      const send=(intent:string,resourceIds:string[],change=false)=>velaCommand({
        win:{isDestroyed:()=>false,webContents:{isDestroyed:()=>false}},dialog:{},offerPlanningByDefault:true,directMessageSend:true,
        input:{name:'request',input:{intent,resourceIds,authorizeProvider:true}},reviewProvider:async()=>{reviews++;return true;},
        call:async(name:any,input:any)=>{
          const result=await f.core.command(name,input);
          if(change&&name==='velaNativeReview'){
            mutated=true;
            if(mutation==='source-change')await f.core.command('desktop',{type:'content',resourceId:note.id,expectedVersion:note.version,content:'Synthetic source changed after preflight.'});
            if(mutation==='source-revoked')await f.core.command('desktop',{type:'archiveSubject',kind:'resource',id:note.id,expectedVersion:note.version,archived:true});
            if(mutation==='routing-change')await f.core.command('vela',{name:'saveRoutingSettings',input:{scope:'global',id:null,expectedVersion:0,defaults:{mode:'deep'}}});
            if(mutation==='connection-version'){await f.connection.refresh(1);await f.core.command('ordinaryProviderStatus',{});}
            if(mutation==='billing-route')f.owner.ordinaryStatus.billingRoute='api-key';
          }
          return result;
        },
      }) as Promise<VelaRequest>;
      f.responses.push(()=>complete('resp_continuity_dependency','Synthetic answer derived from the selected note.'));
      assert.equal((await send('Explain the selected synthetic note.',[note.id])).state,'responded');
      assert.equal(reviews,1,'New explicit source content keeps its review');
      await assert.rejects(send('Continue the preceding explanation.',[],true),/upstream|source|stale|history|connection_changed/);
      assert.equal(mutated,true);assert.equal(reviews,1);assert.equal(f.requests.length,1);assert.equal(f.codexCalls,0);
    }finally{await f.close();}
  });
}

test('Check my CPU, explain the number, then look through my repository logs', async () => {
  for (const approveCodex of [false, true]) {
    const f = fixture(true);
    try {
      allowFixtureHandoffEvidence(f);
      const intent = 'Check CPU usage, explain what it means, then inspect the repository logs';
      const nextIntent = 'inspect the repository logs';
      const reviews: string[] = [];
      f.responses.push(() => complete('resp_workflow', 'Synthetic CPU analysis for this selected reading.'));
      await assert.rejects(f.core.command('velaRequestPreview', { intent, resourceIds: [], adaptive: true, providerId }), /vela_workflow_auto_required/);
      const outcome = await velaCommand({ win: { isDestroyed: () => false, webContents: { isDestroyed: () => false } },
        dialog: {}, directMessageSend: true, offerPlanningByDefault: true,
        input: { name: 'request', input: { intent, resourceIds: [], authorizeProvider: true } },
        async reviewProvider({ review }: any) {
          reviews.push(review.providerId);
          const payload = JSON.parse(review.prompt.split('\n').at(-1));
          if (review.providerId === providerId) {
            assert.equal(f.requests.length, 0);
            assert.equal(review.route.nativeMetric, 'system.cpu');
            assert.equal(payload.intent, 'explain what it means');
            assert.match(payload.nativeStage.text, /CPU usage was/u);
            assert.doesNotMatch(review.prompt, /inspect the repository/);
            return true;
          }
          assert.equal(f.requests.length, 1);
          assert.equal((await f.core.command('providerActivity', {})).providerRequests, 1);
          assert.equal(payload.intent, nextIntent);
          assert.equal(review.handoff.sourceProviderId, providerId);
          assert.match(review.prompt, /Synthetic CPU analysis/);
          return approveCodex;
        }, call: (name: any, input: any) => f.core.command(name, input),
      }) as VelaRequest;
      assert.equal(outcome.state, 'responded', outcome.errorCode);
      assert.deepEqual(reviews, [providerId, 'codex-app-server']);
      const state = await f.core.command('vela', { name: 'state', input: {} }) as { requests: VelaRequest[] };
      assert.equal(state.requests.length, approveCodex ? 2 : 1);
      const first = state.requests[0];
      assert.equal(first.intent, intent);
      const stage = f.events.find(event => event.type === 'vela.routing.stage_started' && event.payload.taskId === first.id);
      const timing = stage?.payload.timing;
      assert(timing && [timing.routingMs, timing.capabilityMs, timing.contextMs, timing.previewMs].every(ms => Number.isFinite(ms) && ms >= 0));
      assert(timing.previewMs >= timing.routingMs + timing.capabilityMs + timing.contextMs);
      const providerTiming = f.events.find(event =>
        event.type === 'execution/provider_completed' && event.providerId === providerId)?.payload.providerTiming;
      assert.equal(providerTiming?.parentRequestId, first.id);
      assert.equal(outcome.conversationId, first.conversationId);
      assert.equal(outcome.handoff?.taskId, approveCodex ? first.id : undefined);
      assert(f.events.some(event => event.type === 'vela.routing.native_stage_observed' && event.payload.taskId === first.id));
      assert.equal((await f.core.command('providerActivity', {})).providerRequests, approveCodex ? 2 : 1);
    } finally { await f.close(); }
  }
});

test('Read this log, tell me what happened, then fix the code and benchmark it', async () => {
  const f = fixture(true);
  try {
    const intent = 'Read the log note, explain the slowdown, then fix the code and run the benchmark';
    const request = { intent, resourceIds: [], adaptive: true as const };
    await assert.rejects(f.core.command('velaRequestPreview', request), /vela_edit_log_source_required/);
    const notes = await f.core.command('desktop', { type: 'createResource', title: 'Synthetic slow frame', kind: 'note', workspaceId: null });
    const note = notes.resources.find(resource => resource.title === 'Synthetic slow frame')!;
    await f.core.command('desktop', { type: 'content', resourceId: note.id, expectedVersion: note.version, content: 'Synthetic frame took 80 ms.' });
    const preview = await f.core.command('velaRequestPreview', { ...request, resourceIds: [note.id] });
    const review = await f.core.command('velaNativeReview', { previewId: preview.id, signature: preview.signature });
    assert.equal(review.route?.kind, 'conversational');
    assert.equal(review.route.nativeLog, true);
    assert.deepEqual(review.context.included.map(source => source.id), [note.id]);
    assert.match(review.prompt, /Synthetic frame took 80 ms/u);
    assert.doesNotMatch(review.prompt, /fix the code/u);
    await assert.rejects(f.core.command('authorizeVelaRequest', { previewId: preview.id, signature: preview.signature,
      reviewDigest: review.reviewDigest, directSend: true }), /vela_attached_context_review_required/);
    assert.equal((await f.core.command('providerActivity', {})).providerRequests, 0);
  } finally { await f.close(); }
});

test('Read the log, explain the slowdown, fix the count, and run the tests after I approve once', {
  skip: process.platform !== 'win32',
}, async () => {
  const runtime = fixtureFileEditScratchRoot();
  const dir = mkdtempSync(join(runtime, 'vela-file-edit-'));
  const file = join(dir, 'sample.json');
  const testFile = join(dir, 'sample.test.mjs');
  const original = '{"count":1}\n';
  const testSource = "import test from 'node:test'; import assert from 'node:assert/strict'; import {readFileSync} from 'node:fs';" +
    "test('count is two', () => assert.equal(JSON.parse(readFileSync('sample.json', 'utf8')).count, 2));\n";
  const git = (...args: string[]) => execFileSync('git.exe', ['-C', dir, '-c', 'core.hooksPath=NUL', ...args],
    { windowsHide: true, timeout: 6000, stdio: 'pipe' });
  const f = fixture(true, 'air-file-edit',undefined,[dir]);
  try {
    git('init', '--quiet', '--template=');
    writeFileSync(file, original);
    writeFileSync(testFile, testSource);
    git('add', '--', 'sample.json', 'sample.test.mjs');
    git('-c', 'user.name=AIR fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'Fixture');
    allowFixtureHandoffEvidence(f);
    const notes = await f.core.command('desktop', { type: 'createResource', title: 'Synthetic workflow log', kind: 'note', workspaceId: null });
    const note = notes.resources.find(resource => resource.title === 'Synthetic workflow log')!;
    await f.core.command('desktop', { type: 'content', resourceId: note.id, expectedVersion: note.version, content: 'A frame took 80 ms.' });
    const intent = 'Read the log note, explain the slowdown, then edit sample.json to set the count to two and run the tests';
    const send = (decide: (workflow: import('../src/contracts.mts').VelaWorkflowReview) => boolean) => {
      let selections = 0, reviews = 0;
      return velaCommand({ win: { isDestroyed: () => false, webContents: { isDestroyed: () => false } },
        directMessageSend: true, offerPlanningByDefault: true,
        dialog: {
          showOpenDialog: async () => ({ canceled: false, filePaths: [selections++ === 0 ? file : testFile] }),
          showMessageBox: async () => assert.fail('An approved workflow may not ask again'),
        },
        input: { name: 'request', input: { intent, resourceIds: [note.id], authorizeProvider: true } },
        async reviewProvider({ workflow }: { workflow: import('../src/contracts.mts').VelaWorkflowReview }) {
          assert.equal(++reviews, 1);
          assert.equal(selections, 2);
          assert.match(workflow.analysis.prompt, /A frame took 80 ms/u);
          assert.deepEqual(workflow.files, [{ path: file, operation: 'replace' }]);
          assert.equal(workflow.check.argv.at(-1), './sample.test.mjs');
          return decide(workflow);
        },
        call: (name: any, input: any) => f.core.command(name, input),
      }) as Promise<VelaRequest>;
    };
    await assert.rejects(send(() => false), /authorization_cancelled/u);
    await assert.rejects(send(() => { writeFileSync(testFile, testSource + '// changed\n'); return true; }), /vela_workflow_scope_changed/u);
    assert.equal((await f.core.command('providerActivity', {})).providerRequests, 0);
    assert.equal(readFileSync(file, 'utf8'), original);
    writeFileSync(testFile, testSource);
    f.responses.push(() => complete('resp_workflow_stale', 'Synthetic frame analysis before the test changed.'));
    await assert.rejects(send(() => {
      const respond = f.responses.shift()!;
      f.responses.push(init => { writeFileSync(testFile, testSource + '// changed mid-run\n'); return respond(init); });
      return true;
    }), /vela_workflow_scope_changed/u);
    assert.equal((await f.core.command('providerActivity', {})).providerRequests, 1);
    assert.equal(readFileSync(file, 'utf8'), original);
    writeFileSync(testFile, testSource);
    f.responses.push(() => complete('resp_workflow_single', 'Synthetic frame analysis.'));
    let approvedId = '';
    const result = await send(workflow => { approvedId = workflow.id; return true; });
    assert.equal(result.state, 'responded', result.errorCode);
    assert.equal(result.handoff?.destinationProviderId, 'codex-app-server');
    assert(result.response?.kind === 'answer');
    const message = (await f.core.command('snapshot', {})).graph.messages.find(item => item.id === result.response!.messageId);
    assert(message);
    assert.match(message.content, /workflow approval covers the changes/u);
    assert.doesNotMatch(message.content, /Vela will ask/u);
    const assertApplied = async () => {
      const state = await f.core.command('vela', { name: 'state', input: {} }) as VelaState;
      assert.equal(state.requests.at(-2)?.conversationId, result.conversationId);
      assert.equal(state.requests.at(-2)?.id, result.handoff?.taskId);
      const edit = state.fileEdits?.find(item => item.requestId === result.id);
      assert.equal(edit?.state, 'applied');
      assert.equal(edit?.projectChecks?.[0]?.state, 'passed');
      assert.equal(edit?.projectChecks?.[0]?.testCount, 1);
      assert.deepEqual(edit?.files[0].change, { before: original, after: '{"count":2}\n' });
      assert.equal(readFileSync(edit!.files[0].backupPath!, 'utf8'), original);
    };
    assert.equal(readFileSync(file, 'utf8'), '{"count":2}\n');
    assert.equal((await f.core.command('providerActivity', {})).providerRequests, 3);
    await assert.rejects(f.core.command('velaWorkflowRun', { id: approvedId }), /vela_workflow_review_required/u);
    await assertApplied();
    await f.reopen();
    await assertApplied();
  } finally {
    await f.close();
    assert.equal(resolve(dir, '..'), resolve(runtime));
    assert.match(dir, /[\\/]vela-file-edit-[^\\/]+$/u);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Vela hands off exactly the selected exchange in both directions with native consent and canonical provenance', async () => {
  const f = fixture(true), codex = 'codex-app-server';
  const win = { isDestroyed: () => false, webContents: { isDestroyed: () => false } };
  const send = (intent: string, options: { providerId: string; mode?: 'codex'; model?: string; reasoningEffort?: 'high'; handoffSourceRequestId?: string },
    reviewProvider = async (_value: any) => true) =>
    velaCommand({ win, dialog: {}, directMessageSend: true, offerPlanningByDefault: true,
      input: { name: 'request', input: { intent, resourceIds: [], authorizeProvider: true, ...options } },
      reviewProvider, call: (name: any, input: any) => f.core.command(name, input),
    }) as Promise<VelaRequest>;
  try {
    allowFixtureHandoffEvidence(f);
    f.responses.push(() => complete('resp_handoff_source', 'Synthetic selected answer marker.'));
    const source = await send('Explain the synthetic source objective.', { providerId });
    assert.equal(source.state, 'responded', source.errorCode);
    f.responses.push(() => complete('resp_handoff_neighbor', 'Synthetic unrelated answer marker.'));
    const neighbor = await send('Explain the unrelated synthetic task.', { providerId });
    assert.equal(neighbor.state, 'responded', neighbor.errorCode);

    const nextIntent = 'Inspect the repository for the selected finding.';
    const codexChoice = { providerId: codex, mode: 'codex' as const, model: 'fixture-model', reasoningEffort: 'high' as const,
      handoffSourceRequestId: source.id };
    await assert.rejects(f.core.command('velaRequestPreview', { ...codexChoice, providerId, mode: 'auto', model: undefined,
      reasoningEffort: undefined, intent: 'Summarize the selected exchange.', resourceIds: [], adaptive: true }), /vela_handoff_same_provider/);
    await assert.rejects(f.core.command('velaRequestPreview', { ...codexChoice, intent: nextIntent, resourceIds: [],
      adaptive: true, includeRecentHistory: true }), /vela_handoff_history_conflict/);
    await assert.rejects(f.core.command('velaRequestPreview', { ...codexChoice, intent: 'Run the Node tests', resourceIds: [],
      adaptive: true }), /vela_project_check_handoff_conflict/);
    const stale = await f.core.command('velaRequestPreview', { ...codexChoice, intent: nextIntent, resourceIds: [], adaptive: true });
    const staleInput = { previewId: stale.id, signature: stale.signature };
    const staleReview = await f.core.command('velaNativeReview', staleInput);
    const reviewHtml = nativeVelaReviewPage(staleReview, nextIntent);
    assert.match(reviewHtml, /Selected prior exchange/);
    assert.match(reviewHtml, /Handoff from ChatGPT plan to Codex/);
    assert.doesNotMatch(reviewHtml, /unrelated answer marker/i);
    const substituted = structuredClone(staleReview);
    (substituted.history!.messages[1] as { content: string }).content = 'Different text in the review';
    assert.throws(() => validateNativeVelaReview(stale, substituted), /invalid_native_vela_review/);
    await assert.rejects(f.core.command('authorizeVelaRequest', { ...staleInput, reviewDigest: staleReview.reviewDigest, directSend: true }),
      /vela_attached_context_review_required/);
    await f.core.command('velaRouteNative', { intent: 'What time is it?' });
    await assert.rejects(f.core.command('authorizeVelaRequest', { ...staleInput, reviewDigest: staleReview.reviewDigest }),
      /stale-history-revision|stale_vela_input_revision/);

    let nativeReviews = 0;
    const checkReview = async ({ review }: any, approve: boolean) => {
      nativeReviews++;
      assert.equal(review.providerId, codex);
      assert.deepEqual(review.history.messages.map((message: any) => message.requestId), [source.id, source.id]);
      assert.equal(review.handoff.sourceMessageId, source.response?.messageId);
      assert.equal(review.handoff.sourceProviderId, providerId);
      assert.match(review.prompt, /Synthetic selected answer marker/);
      assert.doesNotMatch(review.prompt, /unrelated synthetic task|unrelated answer marker/i);
      return approve;
    };
    const beforeCancel = (await f.core.command('providerActivity', {})).providerRequests;
    await assert.rejects(send(nextIntent, codexChoice, value => checkReview(value, false)), /authorization_cancelled/);
    assert.equal((await f.core.command('providerActivity', {})).providerRequests, beforeCancel);
    const continued = await send(nextIntent, codexChoice, value => checkReview(value, true));
    assert.equal(continued.state, 'responded', continued.errorCode);
    assert.equal(continued.conversationId, source.conversationId);
    assert.equal(continued.handoff?.sourceRequestId, source.id);
    assert.equal(continued.handoff?.taskId, source.id);
    assert.equal(continued.handoff?.destinationProviderId, codex);
    const snapshot = await f.core.command('snapshot', {});
    const execution = Object.values(snapshot.executions).find(item => item.commandId === 'vela-inspection:' + continued.id);
    assert(execution?.binding?.nativeThreadId);
    const codexInput = snapshot.graph.messages.find(message => message.conversationId === snapshot.resourceMap[execution.resourceId] &&
      message.role === 'user');
    assert.match(codexInput?.content ?? '', /Synthetic selected answer marker/);
    assert.doesNotMatch(codexInput?.content ?? '', /Synthetic unrelated answer marker/);

    f.responses.push(() => complete('resp_handoff_reverse', 'Synthetic summary of the Codex finding.'));
    const reversed = await send('Summarize the selected finding.', { providerId, handoffSourceRequestId: continued.id }, async ({ review }) => {
      nativeReviews++;
      assert.equal(review.handoff.sourceProviderId, codex);
      assert.deepEqual(review.history.messages.map((message: any) => message.requestId), [continued.id, continued.id]);
      return true;
    });
    assert.equal(reversed.state, 'responded', reversed.errorCode);
    assert.equal(reversed.conversationId, source.conversationId);
    assert.equal(reversed.handoff?.sourceRequestId, continued.id);
    assert.equal(reversed.handoff?.taskId, source.id);
    assert.match(JSON.stringify(f.requests.at(-1)?.input), /Synthetic repository finding/);
    assert.doesNotMatch(JSON.stringify(f.requests.at(-1)?.input), /Synthetic selected answer marker|Synthetic unrelated answer marker/);
    assert.equal(nativeReviews, 3);
    assert.equal(f.events.filter(event => event.type === 'vela.routing.handoff_authorized').length, 2);
    for (const stage of [source, continued, reversed])
      assert(f.events.some(event => event.type === 'vela.routing.stage_completed' && event.correlationId === stage.id && event.payload.taskId === source.id));

    f.owner.atomic(() => f.owner.graph.markUnavailable(neighbor.response!.messageId));
    await assert.rejects(f.core.command('velaRequestPreview', { ...codexChoice, intent: nextIntent, resourceIds: [],
      adaptive: true, handoffSourceRequestId: neighbor.id }), /vela_handoff_source_unavailable/);
    f.responses.push(() => {
      f.disconnect();
      return complete('resp_handoff_uncertain', 'Synthetic result after destination revocation.');
    });
    const uncertain = await send('Summarize the selected finding after a reconnect.',
      { providerId, handoffSourceRequestId: continued.id });
    assert.equal(uncertain.state, 'unknown', uncertain.errorCode);
    assert.equal(uncertain.handoff?.sourceRequestId, continued.id);
    const attempts = f.requests.length;
    await f.reopen();
    const state = await f.core.command('vela', { name: 'state', input: {} }) as { requests: VelaRequest[] };
    assert.deepEqual(state.requests.find(request => request.id === reversed.id)?.handoff, reversed.handoff);
    const restored = state.requests.find(request => request.id === uncertain.id);
    assert.equal(restored?.state, 'unknown');
    assert.deepEqual(restored?.handoff, uncertain.handoff);
    assert.equal((await f.core.command('providerActivity', {})).providerRequests, 0);
    assert.equal(f.requests.length, attempts);
  } finally { await f.close(); }
});

test('Vela routes a single frozen prompt through the connected ChatGPT plan without invoking Codex', async () => {
  const f = fixture();
  try {
    const intent = 'Give a brief greeting.';
    const preview = await f.core.command('velaRequestPreview', { intent, resourceIds: [], providerId });
    const approval = { previewId: preview.id, signature: preview.signature };
    const review = await f.core.command('velaNativeReview', approval);
    const { grantId } = await f.core.command('authorizeVelaRequest', { ...approval, reviewDigest: review.reviewDigest, directSend: true });
    f.responses.push(() => complete('resp_synthetic_vela', JSON.stringify({ schemaVersion: 2, kind: 'answer', content: 'Hello.' })));
    const request = await f.core.command('vela', { name: 'request', input: { intent, resourceIds: [], authorizeProvider: true, previewId: preview.id, grantId } }) as VelaRequest;
    assert.equal(f.requests.length, 1);
    assert(JSON.stringify(f.requests[0].input).includes(intent));
    assert(f.requests[0].instructions.startsWith(VELA_IDENTITY_PROMPT));
    assert.equal(f.codexCalls, 0);
    assert.equal(request.providerId, providerId);
    assert.equal(request.state, 'failed', 'simulated output must not be attributed to a real provider');
    const execution = Object.values(f.owner.state.executions as Record<string, {state: string; responseId?: string}>)
      .find(item => item.responseId === 'resp_synthetic_vela');
    assert.equal(execution?.state, 'provider_completed');
  } finally { await f.close(); }
});

test('a Vela response sends shared identity once and scoped current application facts without unselected note content', async () => {
  const f = fixture();
  try {
    f.setListedModels([documentedModel]);
    await f.core.command('ordinaryProviderCheck', {});
    const desktop = await f.core.command('desktop', { type: 'createWorkspace', title: 'Synthetic current observatory', projectId: null });
    const workspaceId = desktop.activeWorkspaceId!;
    const created = await f.core.command('desktop', { type: 'createResource', kind: 'note', title: 'Unselected local notes', workspaceId });
    const note = created.resources.find(resource => resource.title === 'Unselected local notes')!;
    await f.core.command('desktop', { type: 'content', resourceId: note.id, expectedVersion: note.version, content: 'PRIVATE_UNSELECTED_NOTE_BODY' });
    const input = { intent: 'What workspace do I have open?', resourceIds: [], providerId, model: documentedModel.id, adaptive: true as const };
    const preview = await f.core.command('velaRequestPreview', input);
    assert.equal(preview.route?.kind, 'conversational');
    const approval = { previewId: preview.id, signature: preview.signature };
    const review = await f.core.command('velaNativeReview', approval);
    const data = JSON.parse(review.prompt.slice(review.prompt.indexOf('\n{') + 1));
    assert.equal(data.application.surface.workspaceId, workspaceId);
    assert.equal(data.application.layout.placementCount, 1);
    assert(data.application.objects.some((object: { id: string; title: string }) => object.id === workspaceId && object.title === 'Synthetic current observatory'));
    assert.doesNotMatch(review.prompt, /PRIVATE_UNSELECTED_NOTE_BODY/);
    const { grantId } = await f.core.command('authorizeVelaRequest', { ...approval, reviewDigest: review.reviewDigest, directSend: true });
    f.responses.push(() => complete('resp_scoped_application', 'Synthetic response from the protocol fixture.'));
    await f.core.command('vela', { name: 'request', input: { ...input, authorizeProvider: true, previewId: preview.id, grantId } });
    assert.equal(f.requests.length, 1);
    const body = f.requests[0];
    assert.equal(body.instructions.split(VELA_IDENTITY_VERSION).length - 1, 1);
    assert(body.instructions.startsWith(VELA_IDENTITY_PROMPT));
    assert.doesNotMatch(JSON.stringify(body.input), /aerynth\.vela-identity@1|PRIVATE_UNSELECTED_NOTE_BODY/);
    const timing = f.events.find(event => event.type === 'execution/provider_completed')?.payload.providerTiming;
    assert.ok(timing?.fromPreview && timing.firstNonblankOutput);
    assert.equal(timing.fromPreview.id, preview.id);
    assert.equal(timing.fromPreview.toFirstNonblankOutputMs,
      timing.fromPreview.toAdapterMs + timing.firstNonblankOutput.elapsedMs);
    assert.equal(f.codexCalls, 0);
  } finally { await f.close(); }
});

test('the native Vela Send broker returns real RAM facts while disconnected and never contacts either model provider', async () => {
  const f = fixture();
  try {
    f.disconnect();
    const calls: string[] = [];
    const result = await velaCommand({
      directMessageSend: true, offerPlanningByDefault: true,
      input: { name: 'request', input: { intent: 'Vela, how much physical memory is currently in use?', resourceIds: [], authorizeProvider: true } },
      call(name: Parameters<BackendCore['command']>[0], data: never) {
        calls.push(name);
        return f.core.command(name, data);
      },
    }) as VelaRequest;
    assert.deepEqual(calls, ['velaRouteNative']);
    assert.equal(result.state, 'responded');
    assert.equal(result.local?.facts.kind, 'system-memory');
    assert.equal(result.providerId, null);
    assert.equal(f.codexCalls + f.catalogReads + f.secretReads + f.requests.length, 0);
  } finally { await f.close(); }
});

test('Level 0 records local time, date, CPU and arithmetic through the same native conversation', async () => {
  const f = fixture();
  try {
    f.disconnect();
    let conversationId: string | undefined;
    for (const [intent, expected] of [
      ['What time is it right now?', 'time'], ['What day is it today?', 'date'],
      ['What is the current CPU usage?', 'system-utilization'], ['What is 15% of 240?', 'calculator'],
    ]) {
      const result = await f.core.command('velaRouteNative', { intent });
      assert(result.matched);
      const { request } = result;
      assert.equal(request.state, 'responded');
      assert.equal(request.response?.kind, 'answer');
      assert.equal(request.local?.facts.kind, expected);
      conversationId ??= request.conversationId;
      assert.equal(request.conversationId, conversationId);
      if (request.local?.facts.kind === 'calculator') assert.equal(request.local.facts.value, 36);
    }
    const invalid = await f.core.command('velaRouteNative', { intent: 'Calculate 10/0' });
    assert(invalid.matched && invalid.request.response?.kind === 'inability');
    assert.equal(f.codexCalls + f.catalogReads + f.secretReads + f.requests.length, 0);
    await f.reopen();
    const state = await f.core.command('vela', { name: 'state', input: {} });
    assert.equal((state as {requests: VelaRequest[]}).requests.length, 5);
  } finally { await f.close(); }
});

test('How much RAM am I using if the first reader is unavailable?', { skip: process.platform !== 'win32' }, async () => {
  const f = fixture(true);
  try {
    const readHost = f.owner.localVelaHost.bind(f.owner);
    f.owner.localVelaHost = () => ({ ...readHost(), system: { memory() { throw Error('synthetic native failure'); } } });
    const gib = 2 ** 30;
    let checks = 0;
    f.owner.port.projectChecks = { async ready() { return true; }, async execute(argv: string[]) {
      assert.equal(argv[0], process.execPath);
      assert.equal(argv[1], '-e');
      assert.match(argv[2], /os\.totalmem\(\),os\.freemem\(\)/u);
      return { exitCode: 0, stdout: JSON.stringify(++checks === 1 ? [32 * gib, 8 * gib] : [32 * gib, 'invalid']), stderr: '' };
    } };
    const ask = () => f.core.command('velaRouteNative', { intent: 'How much RAM am I using?' });
    const result = await ask();
    assert(result.matched && result.request.local?.facts.kind === 'system-memory');
    assert.equal(result.request.local.facts.measurement.source.executor, 'codex-local-command');
    assert.equal(result.request.local.facts.measurement.usedBytes, 24 * gib);
    const unavailable = await ask();
    assert(unavailable.matched && unavailable.request.local?.facts.kind === 'unavailable');
    assert.equal(unavailable.request.response?.kind, 'inability');
    assert.equal(checks, 2);
    assert.equal((await f.core.command('providerActivity', {})).providerRequests, 0);
  } finally { await f.close(); }
});

test('natural weather delegates to the API without native location access and preserves an explicit denial across restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aerynth-weather-route-'));
  let prompts = 0, locations = 0, providerCalls = 0;
  const host: import('../src/native-host.mts').NativeHostServices = { secrets: {
    available: async () => false, seal: async () => { throw Error('unused'); }, open: async () => { throw Error('unused'); },
  }, systemFacts: {
    authorizeWeatherPurpose: async () => { prompts++; throw Error('routing_must_not_prompt'); },
    locate: async () => { locations++; throw Error('routing_must_not_locate'); },
    battery: async () => { throw Error('routing_must_not_read_battery'); },
  } };
  const create = () => new BackendCore({ path: join(dir, 'canonical.sqlite'), provider: 'fixture', contentPolicy: 'synthetic-only' },
    () => {}, host, undefined, { fetch: async () => { providerCalls++; throw Error('routing_must_not_dispatch'); } });
  let core = create();
  try {
    const probe = async () => {
      const intent = 'Will it rain here tomorrow?';
      assert.equal((await core.command('velaRouteNative', { intent })).matched, false);
      await assert.rejects(core.command('velaRequestPreview', { intent, resourceIds: [], adaptive: true, providerId: 'openai-api-vela' }), /vela_api_usage_authorization_required/);
    };
    await probe();
    const initial = await core.command('velaWeatherPermissionNative', { type: 'status' });
    assert.equal(initial.decision, 'unknown');
    const denied = await core.command('velaWeatherPermissionNative', { type: 'set', expectedVersion: initial.version, decision: 'deny' });
    await probe(); await core.command('close', {}); core = create(); await probe();
    assert.deepEqual(await core.command('velaWeatherPermissionNative', { type: 'status' }), denied);
    await assert.rejects(core.command('velaWeatherPermissionNative', { type: 'set', expectedVersion: initial.version, decision: 'allow' }), /stale_weather_permission/);
    const state = await core.command('vela', { name: 'state', input: {} }) as VelaState;
    assert.equal(state.requests.length, 0); assert.equal(state.plans.length, 0);
    assert.equal(prompts, 0); assert.equal(locations, 0);
    // Route probes do not send a weather question. API/tool consent is exercised in vela-api-weather.test.mts.
    const activity = await core.command('providerActivity', {});
    assert.equal(activity.providerRequests, 0); assert.equal(activity.codexConnections, 0); assert.equal(providerCalls, 0);
  } finally {
    await core.command('close', {});
    const part = relative(resolve(tmpdir()), resolve(dir)); assert(part.startsWith('aerynth-weather-route-') && !part.startsWith('..') && !isAbsolute(part));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Level 0 opens a unique workspace and prepares a checklist without a connected provider', async () => {
  const f = fixture();
  try {
    f.disconnect();
    const workspace = await f.core.command('workspace', { title: 'Synthetic checklist workspace' });
    const opened = await f.core.command('velaRouteNative', { intent: 'Open the workspace Synthetic checklist workspace' });
    assert(opened.matched);
    assert.equal(opened.request.state, 'completed');
    const proposed = await f.core.command('velaRouteNative', { intent: 'Could you add a checklist called Shopping here?' });
    assert(proposed.matched && proposed.request.planId);
    assert.equal(proposed.request.providerId, null);
    const applied = await f.core.command('vela', { name: 'apply', input: proposed.request.planId }) as { state: string };
    assert.equal(applied.state, 'applied');
    const desktop = await f.core.command('desktop', { type: 'snapshot' });
    const shopping = desktop.resources.find(resource => resource.kind === 'checklist' && resource.title === 'Shopping');
    assert(shopping);
    assert(desktop.blocks.some(block => block.workspace_id === workspace.id && 'resource_id' in block && block.resource_id === shopping.id));
    const found = await f.core.command('velaRouteNative', { intent: 'Can you find a resource called Shopping?' });
    const resource = await f.core.command('velaRouteNative', { intent: 'Open the resource called Shopping, please.' });
    assert(found.matched && resource.matched);
    const state = await f.core.command('vela', { name: 'state', input: {} }) as import('../../vela-core/src/contracts.ts').VelaState;
    const foundReceipt = state.receipts.find(receipt => receipt.requestId === found.request.id);
    assert(state.searchResults?.[foundReceipt!.id]?.some(ref => ref.id === shopping.id));
    assert(state.receipts.some(receipt => receipt.requestId === resource.request.id && receipt.openResourceId === shopping.id));
    assert.equal(f.codexCalls + f.requests.length, 0);
  } finally { await f.close(); }
});

test('Vela AIR binds supported quick and deep efforts to the actual Responses body', async () => {
  const f = fixture();
  try {
    f.setListedModels([documentedModel, { id: 'gpt-6-luna', label: 'Synthetic catalog Luna' }]);
    for (const [intent, depth, expectedModel, effort] of [
      ['How does a speaker crossover work?', 'quick', 'gpt-6-luna', 'none'],
      ['Derive the stability conditions for coupled oscillators.', 'deep', documentedModel.id, 'high'],
    ] as const) {
      const preview = await f.core.command('velaRequestPreview', { intent, resourceIds: [], adaptive: true });
      assert.equal(preview.providerId, providerId);
      assert.deepEqual(preview.route, { kind: 'conversational', depth, reason: depth === 'quick' ? 'routine-answer' : 'complex-analysis', model: expectedModel, effort });
      const approval = { previewId: preview.id, signature: preview.signature };
      const review = await f.core.command('velaNativeReview', approval);
      assert(!review.prompt.includes('capabilityCatalog'));
      const { grantId } = await f.core.command('authorizeVelaRequest', { ...approval, reviewDigest: review.reviewDigest, directSend: true });
      f.responses.push(() => complete('resp_synthetic_' + depth, 'Provider fixture output'));
      const request = await f.core.command('vela', { name: 'request', input: { intent, resourceIds: [], authorizeProvider: true, previewId: preview.id, grantId } }) as VelaRequest;
      assert.deepEqual(request.route, preview.route);
      assert.equal(request.state, 'failed', 'fixture output retains simulated provenance');
      const body = f.requests.at(-1)!;
      assert.equal(body.model, expectedModel);
      assert.deepEqual(body.reasoning, { effort });
      assert.equal(body.tools, undefined);
    }
    const pinned = await f.core.command('velaRequestPreview', { intent: 'Hi Vela', resourceIds: [], adaptive: true, model: documentedModel.id, reasoningEffort: 'high' });
    assert(pinned.route?.kind === 'conversational');
    assert.equal(pinned.route.model, documentedModel.id);
    assert.equal(pinned.route.effort, 'high');
    assert.equal(f.codexCalls, 0);
  } finally { await f.close(); }
});

test('AIR refuses invalid pins, execution through the conversation provider and unknown write authorization', async () => {
  const f = fixture();
  try {
    f.setListedModels([documentedModel]);
    const ask = { adaptive: true as const, intent: 'Tell me a joke', resourceIds: [] };
    await assert.rejects(f.core.command('velaRequestPreview', { ...ask, model: 'missing' }), /unsupported_model/);
    await assert.rejects(f.core.command('velaRequestPreview', { ...ask, model: documentedModel.id, reasoningEffort: 'none' }), /unsupported_reasoning_effort/);
    await assert.rejects(f.core.command('velaRequestPreview', { ...ask, budgetLimit: 10 }), /vela_budget_unverifiable/);
    await assert.rejects(f.core.command('velaRequestPreview', { ...ask, intent: 'Inspect the repository logs', providerId, mode:'codex' }), /vela_pinned_provider_cannot_execute/);
    await assert.rejects(f.core.command('velaRequestPreview', { ...ask, intent: 'Fix the resize bug and test it', mode:'codex', providerId:'codex-app-server' }), /vela_codex_write_unavailable/);
    f.disconnect();
    await assert.rejects(f.core.command('velaRequestPreview', ask), /vela_chatgpt_sign_in_required/);
    assert.equal(f.requests.length + f.codexCalls + f.secretReads, 0);
  } finally { await f.close(); }
});

test('ordinary provider cannot admit local execution, while Codex and file mentions in advice stay conversational', async () => {
  const f = fixture();
  try {
    const base = { adaptive: true as const, resourceIds: [] };
    for (const intent of ['Patch parser.mjs to handle empty rows', 'Inspect the checkout logs for the exit code',
      'Describe the parser failure, then patch parser.mjs.',
      'Describe the parser failure, and patch parser.mjs.',
      'Describe the parser failure and patch parser.mjs.',
      'Describe the parser failure. Patch parser.mjs.',
      'Describe the parser failure, then save the fix in parser.mjs.']) {
      for (const pin of [undefined, providerId]) {
        await assert.rejects(f.core.command('velaRequestPreview', { ...base, intent, providerId: pin }),
          /vela_local_execution_unavailable/);
      }
    }
    assert.equal(f.requests.length + f.codexCalls + f.secretReads, 0);
    const intent = 'Could you show me how Codex could write parser.mjs without touching the file?';
    const preview = await f.core.command('velaRequestPreview', { ...base, intent, providerId });
    assert.equal(preview.providerId, providerId);
    assert.equal(preview.route?.kind, 'conversational');
    const scope = { previewId: preview.id, signature: preview.signature };
    const review = await f.core.command('velaNativeReview', scope);
    const grant = await f.core.command('authorizeVelaRequest', { ...scope, reviewDigest: review.reviewDigest });
    f.responses.push(() => complete('resp-file-advice', 'Synthetic file-edit advice'));
    const result = await f.core.command('vela', { name: 'request', input: {
      intent, resourceIds: [], authorizeProvider: true, previewId: preview.id, grantId: grant.grantId,
    } }) as VelaRequest;
    assert.equal(result.state, 'failed', 'synthetic provider text cannot be adopted as real Vela provenance');
    const snapshot = await f.core.command('snapshot', {});
    const execution = Object.values(snapshot.executions)[0];
    assert.equal(execution.state, 'provider_completed');
    assert.equal(snapshot.messageEvidence[execution.outputMessageId!].classification, 'simulated');
    assert.equal(result.providerId, providerId);
    assert.equal(f.requests.length, 1);
    assert.equal(f.codexCalls, 0);
  } finally { await f.close(); }
});

test('reviewed ordinary advice can read an attached canonical note without local execution', async () => {
  const f = fixture();
  try {
    const created = await f.core.command('desktop', { type: 'createResource', kind: 'note',
      title: 'Synthetic selected source', workspaceId: null });
    const note = created.resources.find(resource => resource.title === 'Synthetic selected source')!;
    await f.core.command('desktop', { type: 'content', resourceId: note.id, expectedVersion: note.version,
      content: 'Synthetic source observation: the pump cycles every six minutes.' });
    const intent = 'Read the source note and summarize it.';
    const resourceIds = [note.id];
    const preview = await f.core.command('velaRequestPreview', { adaptive: true, intent, resourceIds, providerId });
    assert.equal(preview.route?.kind, 'conversational');
    const scope = { previewId: preview.id, signature: preview.signature };
    const review = await f.core.command('velaNativeReview', scope);
    const grant = await f.core.command('authorizeVelaRequest', { ...scope, reviewDigest: review.reviewDigest });
    f.responses.push(() => complete('resp-selected-note'));
    await f.core.command('vela', { name: 'request', input: {
      intent, resourceIds, authorizeProvider: true, previewId: preview.id, grantId: grant.grantId,
    } });
    assert.equal(f.requests.length, 1);
    assert.match(JSON.stringify(f.requests[0].input), /pump cycles every six minutes/);
    assert.equal(Object.values((await f.core.command('snapshot', {})).executions)[0].state, 'provider_completed');
    assert.equal(f.codexCalls, 0);
  } finally { await f.close(); }
});

test('a turn Codex destination replaces inherited Responses pins and admits only reviewed Codex', async () => {
  const f = fixture(true);
  try {
    f.setListedModels([documentedModel]);
    await f.core.command('ordinaryProviderCheck', {});
    await f.core.command('vela', { name: 'saveRoutingSettings', input: { scope: 'global', id: null, expectedVersion: 0,
      defaults: { providerId, model: documentedModel.id, reasoningEffort: 'medium' } } });
    const intent = 'Audit the repository logs for the exit code';
    const ask = { adaptive: true as const, intent, resourceIds: [], mode: 'codex' as const, reasoningEffort: 'high' as const };
    await assert.rejects(f.core.command('velaRequestPreview', { ...ask, providerId }), /vela_pinned_provider_cannot_execute/);
    const preview = await f.core.command('velaRequestPreview', ask);
    assert.equal(preview.providerId, 'codex-app-server');
    assert.equal(preview.route?.kind, 'agentic');
    assert.equal(preview.routingSettings?.effective.providerId, undefined);
    assert.equal(preview.routingSettings?.effective.model, undefined);
    assert.equal(preview.routingSettings?.effective.reasoningEffort, 'high');
    assert.equal(preview.route.effort, 'high');
    const scope = { previewId: preview.id, signature: preview.signature };
    const review = await f.core.command('velaNativeReview', scope);
    const grant = await f.core.command('authorizeVelaRequest', { ...scope, reviewDigest: review.reviewDigest });
    const result = await f.core.command('vela', { name: 'request', input: {
      intent, resourceIds: [], authorizeProvider: true, previewId: preview.id, grantId: grant.grantId,
    } }) as VelaRequest;
    assert.equal(result.state, 'responded', result.errorCode);
    assert.equal(result.providerId, 'codex-app-server');
    assert.equal((await f.core.command('providerActivity', {})).providerRequests, 1);
    assert.equal(f.requests.length + f.secretReads, 0);
  } finally { await f.close(); }
});

test('explicit Codex composite intent keeps its actual owner, selected-source fences and one reviewed execution',async()=>{
  const f=fixture(true);try{
    const created=await f.core.command('desktop',{type:'createResource',kind:'note',title:'Synthetic explicit inspection source',workspaceId:null}),note=created.resources.find(resource=>resource.title==='Synthetic explicit inspection source')!;
    await f.core.command('desktop',{type:'content',resourceId:note.id,expectedVersion:note.version,content:'Synthetic controlled inspection evidence.'});
    const intent='Read the log note, explain the slowdown, then inspect the repository logs',input={intent,resourceIds:[note.id],adaptive:true as const,mode:'codex' as const,providerId:'codex-app-server' as const,model:'fixture-model',reasoningEffort:'high' as const};
    await assert.rejects(f.core.command('velaRequestPreview',{...input,requireInspectionDirectory:true}),/vela_codex_inspection_target_required/);
    const first=await f.core.command('velaRequestPreview',input),approval={previewId:first.id,signature:first.signature},review=await f.core.command('velaNativeReview',approval);
    assert.equal(first.providerId,'codex-app-server');assert.equal(first.route?.kind,'agentic');assert.equal(first.route.model,'fixture-model');assert.equal(first.route.effort,'high');assert.match(review.prompt,/Synthetic controlled inspection evidence/u);assert.match(review.prompt,/then inspect the repository logs/u);
    const stale=await f.core.command('authorizeVelaRequest',{...approval,reviewDigest:review.reviewDigest}),current=(await f.core.command('desktop',{type:'snapshot'})).resources.find(resource=>resource.id===note.id)!;
    await f.core.command('desktop',{type:'content',resourceId:note.id,expectedVersion:current.version,content:'Synthetic changed inspection evidence.'});
    await assert.rejects(f.core.command('vela',{name:'request',input:{intent,resourceIds:[note.id],authorizeProvider:true,previewId:first.id,grantId:stale.grantId}}),/stale_vela_preview/);
    assert.equal((await f.core.command('providerActivity',{})).providerRequests,0);
    const fresh=await f.core.command('velaRequestPreview',input),freshApproval={previewId:fresh.id,signature:fresh.signature},freshReview=await f.core.command('velaNativeReview',freshApproval),grant=await f.core.command('authorizeVelaRequest',{...freshApproval,reviewDigest:freshReview.reviewDigest});
    const request=await f.core.command('vela',{name:'request',input:{intent,resourceIds:[note.id],authorizeProvider:true,previewId:fresh.id,grantId:grant.grantId}}) as VelaRequest;
    assert.equal(request.state,'responded',request.errorCode);assert.equal(request.providerId,'codex-app-server');assert.equal((await f.core.command('providerActivity',{})).providerRequests,1);assert.equal(f.requests.length,0);assert.equal(f.secretReads,0);
  }finally{await f.close();}
});

test('automatic routing keeps exact workspace navigation local with a qualified API', async () => {
  const f = fixture();
  try {
    const api = f.owner.velaApiRuntime;
    api.authorized = () => true;
    api.configurationVersion = () => 1;
    const workspace = await f.core.command('workspace', { title: 'Synthetic exact navigation' });
    const result = await f.core.command('velaRouteNative', { intent: 'Could you open the workspace Synthetic exact navigation?' });
    assert(result.matched);
    assert.equal(result.request.state, 'completed');
    assert.equal(result.request.providerId, null);
    assert.equal((await f.core.command('desktop', { type: 'snapshot' })).activeWorkspaceId, workspace.id);
    assert.equal(f.requests.length + f.secretReads + f.codexCalls, 0);
  } finally { await f.close(); }
});

test('a model-only pin keeps native checklist routing while automatic and explicit API retain their route', async () => {
  const f = fixture();
  try {
    const runtime = f.owner.velaApiRuntime;
    runtime.authorized = () => true;
    runtime.configurationVersion = () => 1;
    runtime.models = async () => ['gpt-6-luna'];
    const workspace = await f.core.command('workspace', { title: 'Synthetic pinned routing workspace' });
    await f.core.command('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId: workspace.id } });
    const intent = 'Could you add a checklist called Shopping here?';
    for (const settings of [undefined, { providerId: 'openai-api-vela' as const, model: 'gpt-6-luna' }]) {
      assert.equal((await f.core.command('velaRouteNative', { intent, settings })).matched, false);
      const selected = await f.owner.selectVelaRoute({ intent, resourceIds: [], adaptive: true, ...settings }, { capabilityMs: 0 });
      assert.equal(selected.providerId, 'openai-api-vela');
    }
    const native = await f.core.command('velaRouteNative', { intent, settings: { model: 'gpt-6.1-sol' } });
    assert(native.matched && native.request.planId);
    assert.equal(native.request.providerId, null);
    assert.equal(f.requests.length + f.codexCalls + f.secretReads, 0);
  } finally { await f.close(); }
});

test('an authorized primary API never enters the legacy regex analysis/handoff workflow',async()=>{
  const f=fixture();try{
    // Routing-only source fixture: no key, authority grant, context dispatch or HTTP.
    const runtime=f.owner.velaApiRuntime;runtime.authorized=()=>true;runtime.configurationVersion=()=>1;runtime.models=async()=>['gpt-6-luna'];
    for(const intent of ['Check CPU usage, explain what it means, then inspect the repository logs','Read the log note, explain the slowdown, then fix the code and run the benchmark','Run the tests for my project','Run the tests for this project'])for(const mode of [undefined,'auto']){
      const selected=await f.owner.selectVelaRoute({intent,resourceIds:[],adaptive:true,...(mode?{mode}:{})},{capabilityMs:0});
      assert.equal(selected.providerId,'openai-api-vela');assert.equal(selected.route.kind,'conversational');assert.equal(selected.route.nativeMetric,undefined);assert.equal(selected.route.nativeLog,undefined);
    }
    for(const pins of [{mode:'codex',providerId:'codex-app-server'},{providerId}])await assert.rejects(f.owner.selectVelaRoute({intent:'Run the tests for this project',resourceIds:[],adaptive:true,...pins},{capabilityMs:0}),/vela_project_check_native_review_required/);
    assert.equal(f.requests.length+f.codexCalls+f.secretReads,0);
  }finally{await f.close();}
});

test('AIR resolves saved scope defaults, preserves turn overrides, and invalidates stale approval across restart', async () => {
  const f = fixture();
  try {
    f.setListedModels([documentedModel]);
    await f.core.command('ordinaryProviderCheck', {});
    const save = (input: VelaRoutingSettingsChange) => f.core.command('vela', { name: 'saveRoutingSettings', input });
    const workspace = await f.core.command('workspace', { title: 'Scoped AIR workspace', projectTitle: 'Scoped AIR project' });
    assert(workspace.project_id);
    await f.core.command('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId: workspace.id } });
    const local = await f.core.command('velaRouteNative', { intent: 'What is 2 + 2?' });
    assert(local.matched);
    const chat = local.request.conversationId;
    await save({ scope: 'global', id: null, expectedVersion: 0, defaults: { mode: 'fast' } });
    await save({ scope: 'project', id: workspace.project_id, expectedVersion: 0, defaults: { providerId, model: documentedModel.id } });
    await save({ scope: 'workspace', id: workspace.id, expectedVersion: 0, defaults: { mode: 'deep' } });
    await save({ scope: 'chat', id: chat, expectedVersion: 0, defaults: { reasoningEffort: 'medium' } });
    assert((await f.core.command('velaRouteNative', { intent: 'What is 2 + 2?' })).matched, 'Clear native facts preserve saved inference pins without starting a model');
    assert((await f.core.command('velaRouteNative', { intent: 'What is 2 + 2?', settings: { overrideDefaults: true } })).matched);
    const input = { adaptive: true as const, intent: 'Say hello', resourceIds: [] };
    const preview = await f.core.command('velaRequestPreview', input);
    assert.deepEqual(preview.routingSettings, {
      effective: { mode: 'deep', providerId, model: documentedModel.id, reasoningEffort: 'medium' },
      origins: { mode: 'workspace', providerId: 'project', model: 'project', reasoningEffort: 'chat' },
    });
    const override = await f.core.command('velaRequestPreview', { ...input, reasoningEffort: 'high' });
    assert.equal(override.routingSettings?.origins.reasoningEffort, 'turn');
    const approval = { previewId: preview.id, signature: preview.signature };
    const review = await f.core.command('velaNativeReview', approval);
    await assert.rejects(save({ scope: 'workspace', id: 'wrong-workspace', expectedVersion: 0, defaults: { mode: 'auto' } }), /vela_routing_scope_unavailable/);
    await assert.rejects(save({ scope: 'workspace', id: workspace.id, expectedVersion: 0, defaults: {} }), /stale_vela_routing_defaults/);
    await save({ scope: 'workspace', id: workspace.id, expectedVersion: 1, defaults: {} });
    await assert.rejects(f.core.command('authorizeVelaRequest', { ...approval, reviewDigest: review.reviewDigest }), /stale_vela_routing_defaults/);
    assert.equal(f.requests.length, 0);
    await f.reopen();
    const reopened = await f.core.command('velaRequestPreview', input);
    assert.equal(reopened.routingSettings?.effective.mode, 'fast');
    assert.equal(reopened.routingSettings?.origins.reasoningEffort, 'chat');
    const reset = await f.core.command('velaRequestPreview', { ...input, overrideDefaults: true });
    assert.equal(reset.routingSettings?.effective.providerId, null);
    assert.equal(reset.routingSettings?.origins.mode, 'turn');
    await f.core.command('desktop', { type: 'navigate', target: { kind: 'constellation', projectId: null } });
    const elsewhere = await f.core.command('velaRequestPreview', input);
    assert.equal(elsewhere.routingSettings?.effective.providerId, undefined);
  } finally { await f.close(); }
});

test('AIR enforces durable project and provider attempt limits without counting previews or blocking Level 0', async () => {
  const f = fixture();
  try {
    f.setListedModels([documentedModel]);
    const save = (input: VelaRoutingSettingsChange) => f.core.command('vela', { name: 'saveRoutingSettings', input });
    const workspace = await f.core.command('workspace', { title: 'Synthetic limited workspace', projectTitle: 'Synthetic limited project' });
    assert(workspace.project_id);
    await f.core.command('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId: workspace.id } });
    await save({ scope: 'global', id: null, expectedVersion: 0, defaults: { attemptLimits: { [providerId]: 2 } } });
    await save({ scope: 'project', id: workspace.project_id, expectedVersion: 0, defaults: { attemptLimits: { total: 1 } } });
    await assert.rejects(save({ scope: 'workspace', id: workspace.id, expectedVersion: 0, defaults: { attemptLimits: { total: 5 } } }), /invalid_vela_attempt_limit_scope/);
    const ask = { adaptive: true as const, allowEscalation: true as const, intent: 'Explain AM versus FM', resourceIds: [] };
    const send = async () => {
      const preview = await f.core.command('velaRequestPreview', ask);
      const approval = { previewId: preview.id, signature: preview.signature };
      const review = await f.core.command('velaNativeReview', approval);
      const { grantId } = await f.core.command('authorizeVelaRequest', { ...approval, reviewDigest: review.reviewDigest });
      return f.core.command('vela', { name: 'request', input: { intent: ask.intent, resourceIds: [], authorizeProvider: true, previewId: preview.id, grantId } });
    };
    await f.core.command('velaRequestPreview', ask);
    f.responses.push(() => sse([
      { type: 'response.created', response: { id: 'resp_quota_incomplete' } },
      { type: 'response.incomplete', response: { id: 'resp_quota_incomplete', status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] } },
    ]));
    await send();
    assert.equal(f.requests.length, 1);
    assert(f.events.some(event => event.type === 'vela.routing.escalation_blocked'));
    await f.reopen();
    await assert.rejects(f.core.command('velaRequestPreview', { ...ask, overrideDefaults: true }), /vela_daily_attempt_limit_reached/);
    assert((await f.core.command('velaRouteNative', { intent: 'Calculate 5 * 5' })).matched);
    await f.core.command('desktop', { type: 'navigate', target: { kind: 'constellation', projectId: null } });
    f.responses.push(() => sse([{ type: 'response.created', response: { id: 'resp_quota_global_unknown' } }]));
    const uncertain = await send() as VelaRequest;
    assert.equal(uncertain.state, 'unknown');
    await assert.rejects(f.core.command('velaRequestPreview', ask), /vela_daily_attempt_limit_reached/);
    assert.equal(f.requests.length, 2);
    assert.equal(f.codexCalls, 0);
  } finally { await f.close(); }
});

test('AIR escalates an opted-in incomplete informational response once without replaying partial output', async () => {
  const f = fixture();
  try {
    f.setListedModels([documentedModel]);
    const intent = 'Explain the difference between AM and FM';
    const preview = await f.core.command('velaRequestPreview', { adaptive: true, allowEscalation: true, intent, resourceIds: [] });
    assert(preview.route?.kind === 'conversational');
    assert.deepEqual(preview.route.escalation, { model: documentedModel.id, effort: 'high', trigger: 'output-token-limit' });
    const approval = { previewId: preview.id, signature: preview.signature };
    const review = await f.core.command('velaNativeReview', approval);
    const { grantId } = await f.core.command('authorizeVelaRequest', { ...approval, reviewDigest: review.reviewDigest });
    f.responses.push(
      () => sse([
        { type: 'response.created', response: { id: 'resp_synthetic_limited' } },
        { type: 'response.output_text.delta', delta: 'Partial output never replayed' },
        { type: 'response.incomplete', response: { id: 'resp_synthetic_limited', status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] } },
      ]),
      () => complete('resp_synthetic_escalated', 'Complete fixture response'),
    );
    const request = await f.core.command('vela', { name: 'request', input: { intent, resourceIds: [], authorizeProvider: true, previewId: preview.id, grantId } }) as VelaRequest;
    assert.deepEqual(f.requests.map(body => body.reasoning.effort), ['low', 'high']);
    assert(f.requests.every(body => !JSON.stringify(body.input).includes('Partial output never replayed')));
    assert(f.events.some(event => event.type === 'vela.routing.route_escalated' && event.correlationId === request.id));
    assert.equal(f.codexCalls, 0);
  } finally { await f.close(); }
});

test('ordinary Send answers direct clock questions locally and keeps their transcript out of later provider egress', async () => {
  const f = fixture();
  try {
    await f.core.command('ordinaryProviderStatus', {});
    const chat = await f.core.command('createConversation', { providerId, commandId: randomUUID() });
    const clockInput = { resourceId: chat.resourceId, content: 'what time is it?', expectedRevision: chat.revision, commandId: randomUUID() };
    const calls: string[] = [];
    const send = (input: ConversationSendInput) => conversationCommand({
      input: { name: 'send', input },
      call: (name: Parameters<BackendCore['command']>[0], data: never) => {
        calls.push(name);
        return f.core.command(name, data);
      },
    });
    const startedAt = Date.now();
    const timeInput = { ...clockInput, model: documentedModel.id, reasoningEffort: 'high' as const };
    const time = await send(timeInput);
    assert.deepEqual(calls, ['desktop', 'conversationClock']);
    assert.deepEqual(await send(timeInput), time);
    assert.equal(time.revision, chat.revision + 2);
    const dateInput = { ...clockInput, content: "What's today's date?", expectedRevision: time.revision, commandId: randomUUID() };
    await assert.rejects(send({ ...dateInput, expectedRevision: chat.revision }), /stale_resource_version/);
    const date = await send(dateInput);
    const detail = () => f.core.command('conversation', { name: 'detail', input: { resourceId: chat.resourceId } }) as Promise<{ messages: { items: { id: string; content: string; provenance: string; createdAt: string }[] } }>;
    const { messages: { items } } = await detail();
    assert.deepEqual(items.map(item => item.id), [time.id, time.deviceClockMessageId, date.id, date.deviceClockMessageId]);
    const { timeZone, locale } = new Intl.DateTimeFormat().resolvedOptions();
    const now = Date.parse(items[1].createdAt);
    const clock = new Intl.DateTimeFormat(locale, { timeZone, calendar: 'gregory', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short' });
    assert.equal(items[1].provenance, 'device_clock');
    assert(now >= startedAt && now <= Date.now());
    assert([now, now - 1000].some(instant => items[1].content === `It’s ${clock.format(instant)}.`));
    assert.equal(items[3].provenance, 'device_clock');
    assert.match(items[3].content, /^Today is /);
    assert.equal(f.requests.length, 0);
    assert.equal(f.catalogReads, 0);
    assert.equal(f.secretReads, 0);
    assert.equal(f.codexCalls, 0);
    assert.deepEqual(Object.keys((await f.core.command('snapshot', {})).executions), []);
    await f.reopen();
    assert.deepEqual((await detail()).messages.items, items);
    assert.deepEqual(await send(timeInput), time);
    const remote = 'What time is it in Tokyo?';
    const followUp = { ...clockInput, content: remote, expectedRevision: date.revision, commandId: randomUUID() };
    assert.equal(await f.core.command('conversationClock', followUp), null);
    f.responses.push(() => complete('resp-synthetic-remote-clock'));
    const execution = await send(followUp);
    assert.equal(execution.state, 'provider_completed');
    assert.deepEqual(f.requests[0].input.filter((item: { role: string }) => item.role !== 'developer'), [{ role: 'user', content: remote }]);
  } finally { await f.close(); }
});

test('arbitrary date and reasoning questions reach the provider with a frozen current clock', async () => {
  const f = fixture();
  try {
    await f.core.command('ordinaryProviderStatus', {});
    const chat = await f.core.command('createConversation', { providerId, commandId: randomUUID() });
    const started = Date.now();
    const { input, preview } = await prepare(f, chat.resourceId, "whats the year, and what's the date 40 days from today?");
    const clock = preview.responses!.clock;
    assert(Date.parse(clock.utc) >= started && Date.parse(clock.utc) <= Date.now());
    assert(Math.abs(Date.parse(clock.local) - Date.parse(clock.utc)) < 1000);
    const grounding = preview.responses!.messages.at(-2)!;
    assert.equal(grounding.role, 'developer');
    assert(grounding.content.includes(clock.local));
    assert(grounding.content.includes(clock.utc));
    assert.equal(await f.core.command('conversationClock', input), null);
    await new Promise(resolve => setTimeout(resolve, 30));
    f.responses.push(() => complete('resp-synthetic-grounded-turn'));
    const sent = await f.core.command('conversationSend', await grant(f, preview));
    assert.equal(sent.state, 'provider_completed');
    assert.equal(f.requests[0].instructions, preview.responses!.instructions);
    assert.deepEqual(f.requests[0].input, [grounding, { role: 'user', content: input.content }]);
    const later = await prepare(f, chat.resourceId, 'Now write a short story about that date.');
    assert(Date.parse(later.preview.responses!.clock.utc) > Date.parse(clock.utc));
    assert.equal(later.preview.responses!.messages.length, 4);
    assert.equal(f.requests.length, 1);
  } finally { await f.close(); }
});

test('long ordinary chats keep sending within both history bounds and retain their full local transcript', async () => {
  const f = fixture();
  try {
    await f.core.command('ordinaryProviderStatus', {});
    const chat = await f.core.command('createConversation', { providerId, commandId: randomUUID() });
    let revision = chat.revision;
    for (let i = 0; i < 130; i++) {
      const message = await f.core.command('addMessage', { resourceId: chat.resourceId, role: 'user', content: 'Synthetic context ' + i, expectedRevision: revision });
      revision = message.revision;
    }
    const countBound = await prepare(f, chat.resourceId, 'A question after a long chat');
    assert.equal(countBound.preview.responses!.messages.length, 128);
    assert.equal(countBound.preview.responses!.messages[0].content, 'Synthetic context 4');
    const oversizedHistory = String.fromCharCode(34).repeat(60000);
    for (let i = 0; i < 4; i++) {
      const message = await f.core.command('addMessage', { resourceId: chat.resourceId, role: 'user', content: oversizedHistory + i, expectedRevision: revision });
      revision = message.revision;
    }
    const byteBound = await prepare(f, chat.resourceId, 'A new question after large messages');
    const messages = byteBound.preview.responses!.messages;
    assert.equal(messages.length, 4);
    assert.equal(messages[0].content, oversizedHistory + '2');
    assert.equal(messages[1].content, oversizedHistory + '3');
    f.responses.push(() => complete('resp-synthetic-bounded-context'));
    const result = await f.core.command('conversationSend', await grant(f, byteBound.preview));
    assert.equal(result.state, 'provider_completed');
    assert.deepEqual(f.requests[0].input, messages);
    assert.equal((await f.core.command('snapshot', {})).graph.messages.length, 136);
  } finally { await f.close(); }
});

test('explicit web search sends only the submitted draft and restores verified citation links after restart', async () => {
  const f = fixture();
  try {
    f.setListedModels([documentedModel]);
    await f.core.command('ordinaryProviderStatus', {});
    const chat = await f.core.command('createConversation', { providerId, commandId: randomUUID() });
    const prior = await f.core.command('addMessage', { resourceId: chat.resourceId, role: 'user', content: 'PRIVATE earlier transcript', expectedRevision: chat.revision });
    const input: ConversationSendInput = { resourceId: chat.resourceId, content: 'Look up a public reference for the lunar orbit.', model: documentedModel.id, reasoningEffort: 'high', webSearch: true, expectedRevision: prior.revision, commandId: randomUUID() };
    const answer = '🌙 Moon facts.';
    const safe = { type: 'url_citation', start_index: 2, end_index: 12, url: 'https://science.example.org/moon', title: 'Moon facts' };
    const tool = { type: 'web_search_call', status: 'completed', action: { query: 'RAW_QUERY_DO_NOT_RETAIN' } };
    f.responses.push(() => sse([
      { type: 'response.created', response: { id: 'resp-web-fixture' } },
      { type: 'response.output_item.added', item: { type: 'web_search_call', status: 'in_progress' } },
      { type: 'response.web_search_call.completed' },
      { type: 'response.output_text.delta', delta: answer },
      { type: 'response.completed', response: { id: 'resp-web-fixture', status: 'completed', model: documentedModel.id, output: [tool, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: answer, annotations: [safe, { ...safe, url: 'javascript:alert(1)' }, { ...safe, url: 'https://user:pass@science.example.org/moon' }, { ...safe, end_index: 99 }] }] }] } },
    ]));
    const calls: string[] = [];
    const call = (name: Parameters<BackendCore['command']>[0], data: never) => { calls.push(name); return f.core.command(name, data); };
    const sent = await conversationCommand({ call, input: { name: 'send', input } });
    assert.deepEqual(calls, ['desktop', 'conversationSendPreview', 'authorizeConversationSend', 'conversationSend']);
    assert.equal(sent.state, 'provider_completed');
    assert.deepEqual(f.requests[0].input, [{ role: 'user', content: input.content }]);
    assert.deepEqual(f.requests[0].tools, [{ type: 'web_search' }]);
    assert.deepEqual(f.requests[0].reasoning, { effort: 'high' });
    assert.equal(sent.requestedReasoningEffort, 'high');
    assert.equal(f.requests[0].tool_choice, 'required');
    assert.doesNotMatch(f.requests[0].instructions, /local date|PRIVATE/);
    const detail = () => f.core.command('conversation', { name: 'detail', input: { resourceId: chat.resourceId } }) as Promise<import('../../conversation-product/src/contracts.ts').Detail>;
    const response = (await detail()).messages.items.at(-1)!;
    assert.equal(response.content, answer);
    assert.deepEqual(response.webSearch, { completed: true, citations: [{ url: safe.url, title: safe.title, start: 3, end: 13 }] });
    const stored = await f.core.command('snapshot', {});
    assert.doesNotMatch(JSON.stringify(stored), /RAW_QUERY_DO_NOT_RETAIN|javascript:alert|user:pass/);
    await f.reopen();
    assert.deepEqual((await detail()).messages.items.at(-1), response);
    const launched: string[] = [];
    const openExternal = async (url: string) => { launched.push(url); };
    const open = { name: 'openCitation', input: { resourceId: chat.resourceId, messageId: response.id, index: 0, url: 'https://forged.invalid' } };
    assert.deepEqual(await conversationCommand({ call, openExternal, input: open }), { requested: true });
    assert.deepEqual(launched, [safe.url]);
    await assert.rejects(conversationCommand({ call, openExternal, input: { ...open, input: { ...open.input, index: 1 } } }), /source_unavailable/);
    const other = await f.core.command('createConversation', { providerId: 'local', commandId: randomUUID() });
    await assert.rejects(conversationCommand({ call, openExternal, input: { ...open, input: { ...open.input, resourceId: other.resourceId } } }), /source_unavailable/);
    await assert.rejects(conversationCommand({ call, input: { name: 'send', input: { ...input, resourceId: other.resourceId } } }), /invalid_web_search_scope/);
    assert.deepEqual(launched, [safe.url]);
    assert.equal(f.requests.length, 1);
    assert.equal(f.codexCalls, 0);
  } finally { await f.close(); }
});

test('web search rejection is explicit and causes no fallback inference', async () => {
  const f = fixture();
  try {
    f.setListedModels([documentedModel]);
    await f.core.command('ordinaryProviderStatus', {});
    const chat = await f.core.command('createConversation', { providerId, commandId: randomUUID() });
    const input: ConversationSendInput = { resourceId: chat.resourceId, content: 'Synthetic public lookup', webSearch: true, expectedRevision: chat.revision, commandId: randomUUID() };
    const preview = await f.core.command('conversationSendPreview', input);
    f.responses.push(() => Response.json({ error: { code: 'subscription_sharing_unsupported_capability' } }, { status: 403 }));
    const result = await f.core.command('conversationSend', await grant(f, preview));
    assert.equal(result.state, 'failed');
    assert.equal(result.errorCode, 'subscription_sharing_unsupported_capability');
    assert.equal(result.outputMessageId, undefined);
    assert.equal(f.requests.length, 1);
    assert.equal(f.codexCalls, 0);
  } finally { await f.close(); }
});

test('visible plan models receive only exact documented controls and unsupported sends stop before approval', async () => {
  const f = fixture();
  try {
    const unknown = { id: 'gpt-6.1-sol-undocumented', label: 'Synthetic undocumented alias' };
    f.setListedModels([documentedModel, unknown]);
    await f.core.command('ordinaryProviderStatus', {});
    const chat = await f.core.command('createConversation', { providerId, commandId: randomUUID() });
    await f.core.command('providerConnection', { type: 'refreshModels', providerId });
    const detail = await f.core.command('conversation', { name: 'detail', input: { resourceId: chat.resourceId } }) as import('../../conversation-product/src/contracts.ts').Detail;
    assert.deepEqual(detail.providers.find(item => item.id === providerId)?.modelOptions, [
      { ...documentedModel, reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'], eligibleTools: ['web_search'] },
      unknown,
    ]);
    const input: ConversationSendInput = { resourceId: chat.resourceId, content: 'Synthetic test', expectedRevision: chat.revision, commandId: randomUUID() };
    await assert.rejects(f.core.command('conversationSendPreview', { ...input, reasoningEffort: 'high' }), /unsupported_reasoning_effort/);
    await assert.rejects(f.core.command('conversationSendPreview', { ...input, model: documentedModel.id, reasoningEffort: 'none' }), /unsupported_reasoning_effort/);
    await assert.rejects(f.core.command('conversationSendPreview', { ...input, model: unknown.id, reasoningEffort: 'low' }), /unsupported_reasoning_effort/);
    await assert.rejects(f.core.command('conversationSendPreview', { ...input, model: unknown.id, webSearch: true }), /unsupported_web_search_model/);
    assert.equal(f.requests.length, 0);
    assert.equal(f.secretReads, 0);
    const snapshot = await f.core.command('snapshot', {});
    assert.equal(Object.keys(snapshot.executions).length, 0);
    assert.equal(snapshot.graph.messages.length, 0);
    const preview = await f.core.command('conversationSendPreview', { ...input, model: documentedModel.id, reasoningEffort: 'low' });
    f.setListedModels([unknown]);
    await f.core.command('providerConnection', { type: 'refreshModels', providerId });
    await assert.rejects(grant(f, preview), /unsupported_model/);
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test('the selected catalog model reaches ordinary Responses and an unlisted choice fails before dispatch', async () => {
  const f = fixture();
  try {
    const second = { id: 'synthetic-reasoning-model', label: 'Synthetic reasoning model' };
    const list = [{ id: model, label: 'Synthetic eligible model' }, second];
    f.setListedModels(list);
    await f.core.command('ordinaryProviderStatus', {});
    const chat = await f.core.command('createConversation', { providerId, commandId: randomUUID() });
    const details = () => f.core.command('conversation', { name: 'detail', input: { resourceId: chat.resourceId } }) as Promise<import('../../conversation-product/src/contracts.ts').Detail>;
    assert.deepEqual((await details()).providers.find(p => p.id === providerId)?.modelOptions, []);
    assert.equal(f.catalogReads, 0);
    await f.core.command('providerConnection', { type: 'refreshModels', providerId });
    assert.deepEqual((await details()).providers.find(p => p.id === providerId)?.modelOptions, list);
    assert.equal(f.catalogReads, 1);
    assert.equal(f.requests.length, 0);
    const request = { resourceId: chat.resourceId, content: 'A synthetic model-selection test', expectedRevision: chat.revision, commandId: randomUUID(), model: second.id };
    const send = (input: ConversationSendInput) => conversationCommand({ call: f.core.command.bind(f.core), input: { name: 'send', input } });
    await assert.rejects(send({ ...request, model: 'absent-catalog-model' }), /unsupported_model/);
    assert.equal(f.requests.length, 0);
    assert.equal((await details()).conversation.revision, chat.revision);
    f.responses.push(() => complete('resp-explicit-model'));
    assert.equal((await send(request)).state, 'provider_completed');
    assert.equal(f.requests[0].model, second.id);
    assert.equal(f.requests.length, 1);
  } finally { await f.close(); }
});

test('populated provider changes require a reviewed continuation and stale branch creation cannot relabel or clone history',async()=>{
 const f=fixture();try{
  await f.core.command('ordinaryProviderStatus',{});
  const empty=await f.core.command('createConversation',{providerId:'local',commandId:randomUUID()});
  const selected=await f.core.command('selectProvider',{resourceId:empty.resourceId,providerId,expectedRevision:1});assert.equal(selected.resourceId,empty.resourceId);assert.equal(selected.providerId,providerId);
  const message=await f.core.command('addMessage',{resourceId:empty.resourceId,role:'user',content:'Exact source history must retain its provider.',expectedRevision:selected.revision});
  const before=await f.core.command('snapshot',{});
  await assert.rejects(f.core.command('selectProvider',{resourceId:empty.resourceId,providerId:'local',expectedRevision:message.revision}),/provider_change_requires_branch/);
  await assert.rejects(f.core.command('branch',{resourceId:empty.resourceId,messageId:message.id,includeMessageIds:[message.id],providerId:'local',title:'Stale continuation',commandId:randomUUID(),tokenBudget:32768,expectedRevision:message.revision-1}),/stale_resource_version/);
  assert.deepEqual(await f.core.command('snapshot',{}),before);
  const branch=await f.core.command('branch',{resourceId:empty.resourceId,messageId:message.id,includeMessageIds:[message.id],providerId:'local',title:'Reviewed continuation',commandId:randomUUID(),tokenBudget:32768,expectedRevision:message.revision});
  assert.equal(branch.mode,'application_continuation');assert.equal(branch.handoff.state,'prepared');assert.notEqual(branch.conversation.resourceId,empty.resourceId);
  await assert.rejects(f.core.command('selectProvider',{resourceId:branch.conversation.resourceId,providerId,expectedRevision:1}),/provider_change_requires_branch/);
  const detail=await f.core.command('conversation',{name:'detail',input:{resourceId:empty.resourceId}}) as any;assert.equal(detail.conversation.providerId,providerId);assert.equal(detail.messages.items[0].content,message.content);
  assert.equal(f.requests.length,0);assert.equal(f.codexCalls,0);
 }finally{await f.close();}
});

test('a provider terminal error preserves its safe category and an explicit new send can succeed',async()=>{
 const f=fixture();try{
  await f.core.command('ordinaryProviderCheck',{});
  const chat=await f.core.command('createConversation',{providerId,commandId:randomUUID()});
  const first=await prepare(f,chat.resourceId,'Synthetic calendar question');
  f.responses.push(()=>{const reply=sse([{type:'response.created',response:{id:'resp-terminal-rejected'}},{type:'response.failed',response:{id:'resp-terminal-rejected',status:'failed',error:{code:'server_error',message:'PRIVATE terminal payload'}}}]);reply.headers.delete('content-type');return reply;});
  const failed=await f.core.command('conversationSend',await grant(f,first.preview));
  assert.equal(failed.state,'failed');assert.equal(failed.errorCode,'server_error');assert.equal(failed.httpDiagnostic?.remoteCode,'server_error');
  assert.equal(failed.httpDiagnostic?.bodyShape,'error');assert.equal(failed.outputMessageId,undefined);assert.equal(f.requests.length,1);
  assert.doesNotMatch(JSON.stringify(await f.core.command('snapshot',{})),/PRIVATE terminal payload/);
  const again=await prepare(f,chat.resourceId,'Synthetic explicit retry');
  f.responses.push(()=>complete('resp-explicit-retry'));
  assert.equal((await f.core.command('conversationSend',await grant(f,again.preview))).state,'provider_completed');
  assert.equal(f.requests.length,2);
 }finally{await f.close();}
});

for (const failUnknown of [false, true]) {
  test(`ordinary terminal journal failure releases admission (unknown journal failure: ${failUnknown})`, async () => {
    const f = fixture();
    try {
      await f.core.command('ordinaryProviderCheck', {});
      const chat = await f.core.command('createConversation', { providerId, commandId: randomUUID() });
      const first = await prepare(f, chat.resourceId, 'Synthetic terminal transaction question');
      const id = first.preview.responses!.executionId;
      const authorization = await grant(f, first.preview);
      f.owner.db.exec(`
        CREATE TEMP TRIGGER reject_ordinary_terminal BEFORE INSERT ON intelligence_events
        WHEN json_extract(NEW.json, '$.type') = 'execution/provider_completed'
        BEGIN SELECT RAISE(ABORT, 'synthetic completion journal failure'); END;
      `);
      if (failUnknown) {
        f.owner.db.exec(`
          CREATE TEMP TRIGGER reject_ordinary_unknown BEFORE INSERT ON intelligence_events
          WHEN json_extract(NEW.json, '$.type') = 'execution/unknown'
          BEGIN SELECT RAISE(ABORT, 'synthetic unknown journal failure'); END;
        `);
      }
      f.responses.push(() => complete('resp-terminal-transaction', 'Uncommitted synthetic answer'));
      const sending = f.core.command('conversationSend', authorization);
      if (failUnknown) {
        await assert.rejects(sending, /synthetic completion journal failure/);
      } else {
        const result = await sending;
        assert.equal(result.state, 'unknown');
        assert.equal(result.errorCode, 'ordinary_settlement_unavailable');
        assert.equal(result.responseId, 'resp-terminal-transaction');
      }
      assert.equal(f.owner.active, null);
      assert.equal(f.owner.ordinaryController, null);
      assert.equal(f.owner.liveVelaAnswer, undefined);
      assert.equal(f.owner.ordinaryTask, null);
      assert.equal(f.requests.length, 1);
      assert.equal(f.codexCalls, 0);

      const persisted = JSON.parse(String(f.owner.db.prepare('SELECT json FROM integration_state WHERE id=1').get().json));
      assert.equal(persisted.executions[id].state, failUnknown ? 'running' : 'unknown');
      assert.equal(persisted.executions[id].outputMessageId, undefined);
      assert.deepEqual(persisted.graph.messages.map((message: { role: string }) => message.role), ['user']);
      const replay = (await f.core.command('replay', {})).events.filter(event => event.executionId === id);
      assert.deepEqual(replay.filter(event => event.type.startsWith('execution/')).map(event => event.type),
        failUnknown ? [] : ['execution/unknown']);
      assert(!replay.some(event => event.payload.delta));
      await assert.rejects(f.core.command('conversationSend', authorization), /native_send_grant_consumed/);
      assert.equal(f.requests.length, 1);

      await f.reopen();
      const restored = await f.core.command('snapshot', {});
      assert.equal(restored.executions[id].state, 'unknown');
      assert.equal(restored.executions[id].responseId, 'resp-terminal-transaction');
      assert.equal(restored.executions[id].outputMessageId, undefined);
      const followup = await prepare(f, chat.resourceId, 'Synthetic explicit follow-up');
      f.responses.push(() => complete('resp-fresh-after-terminal-fault'));
      assert.equal((await f.core.command('conversationSend', await grant(f, followup.preview))).state, 'provider_completed');
      assert.equal(f.requests.length, 2);
    } finally { await f.close(); }
  });
}

test('ordinary live observer failure cannot change provider completion or reconnect replay', async () => {
  const f = fixture();
  try {
    await f.core.command('ordinaryProviderCheck', {});
    const chat = await f.core.command('createConversation', { providerId, commandId: randomUUID() });
    const first = await prepare(f, chat.resourceId, 'Synthetic observer question');
    const before = (await f.core.command('replay', {})).latest;
    const emit = f.owner.emit;
    let dropped = 0;
    f.owner.emit = (event: StreamEvent) => {
      if (event.payload.delta || event.type === 'execution/provider_completed') {
        dropped++;
        throw Error('synthetic observer disconnected');
      }
      emit(event);
    };
    f.responses.push(() => complete('resp-observer-failure'));
    const result = await f.core.command('conversationSend', await grant(f, first.preview));
    assert.equal(result.state, 'provider_completed');
    assert.equal(result.taskVerified, false);
    assert.equal(f.owner.active, null);
    assert.equal(dropped, 2);
    await f.reopen();
    const restored = await f.core.command('snapshot', {});
    assert.deepEqual(restored.executions[result.id], result);
    assert.equal(restored.messageEvidence[result.outputMessageId!].outputState, 'complete');
    const replay = (await f.core.command('replay', { after: before })).events.filter(event => event.executionId === result.id);
    assert(replay.every((event, index) => index === 0 || event.cursor > replay[index - 1].cursor));
    assert.deepEqual(replay.filter(event => event.type.startsWith('execution/')).map(event => event.type), ['execution/provider_completed']);
    assert(replay.some(event => event.type === 'item/agentMessage/delta' && event.payload.textBytes));
    assert(!replay.some(event => event.payload.delta));
    assert.equal(f.requests.length, 1);
  } finally { await f.close(); }
});

test('ordinary unknown non-stream HTTP facts persist without response bodies, false completion or retry',async()=>{
 const f=fixture();try{
  await f.core.command('ordinaryProviderCheck',{});const c=await f.core.command('createConversation',{commandId:randomUUID()}),p=await prepare(f,c.resourceId,'Synthetic inspectable transport test'),g=await grant(f,p.preview);
  f.responses.push(()=>Response.json({PRIVATE:'NEVER_RETAIN_PROVIDER_BODY'},{headers:{'x-request-id':'req_fixture_non_stream'}}));
  const result=await f.core.command('conversationSend',g);
  assert.equal(result.state,'unknown');assert.equal(result.errorCode,'invalid_stream_response');
  const diagnostic=result.httpDiagnostic;assert(diagnostic);assert.equal(diagnostic.httpStatus,200);assert.equal(diagnostic.contentType,'json');assert.equal(diagnostic.hasBody,true);assert.equal(diagnostic.serverRequestId,'req_fixture_non_stream');
  assert.equal(result.responseId,undefined);assert.equal(result.outputMessageId,undefined);assert.equal(f.requests.length,1);
  assert.equal(JSON.stringify(await f.core.command('snapshot',{})).includes('NEVER_RETAIN_PROVIDER_BODY'),false);
  await f.reopen();const after=await f.core.command('snapshot',{});assert.deepEqual(after.executions[result.id].httpDiagnostic,diagnostic);assert.equal(after.executions[result.id].state,'unknown');assert.equal(f.requests.length,1);
 }finally{await f.close();}
});

test('ordinary Responses uses canonical identity, exact grant and stateless local continuity across follow-up and SQLite restart',async()=>{
 const f=fixture();try{
  await f.core.command('ordinaryProviderCheck',{});const c=await f.core.command('createConversation',{commandId:randomUUID()});assert.equal(c.providerId,providerId);assert.equal(c.kind,'ordinary');assert.equal(c.title,'New conversation');assert.equal(f.owner.db.prepare('SELECT count(*) AS n FROM workspaces').get().n,0);
  const first=await prepare(f,c.resourceId,'Synthetic first question');assert(first.preview.responses);assert.deepEqual(first.preview.responses.messages.filter(m=>m.role!=='developer'),[{role:'user',content:'Synthetic first question'}]);
  await assert.rejects(f.core.command('conversationSend',{previewId:first.preview.id,fingerprint:first.preview.fingerprint,commandId:first.input.commandId,grantId:'missing'}),/native_send_grant_required/);assert.equal(f.requests.length,0);
  f.responses.push(()=>{const reply=complete('resp-synthetic-first','Synthetic first answer');reply.headers.delete('content-type');return reply;});const firstGrant=await grant(f,first.preview),e1=await f.core.command('conversationSend',firstGrant);assert.equal(e1.state,'provider_completed');assert.equal(e1.binding,null);assert.equal(e1.turnId,null);assert.equal(e1.responseId,'resp-synthetic-first');assert.equal(e1.httpDiagnostic?.contentType,'missing');assert.equal(e1.usage?.source,'provider-reported');assert.equal(e1.taskVerified,false);await assert.rejects(f.core.command('conversationSend',firstGrant),/native_send_grant_consumed/);
  const readTiming=async()=> (await f.core.command('replay',{limit:1000})).events
    .find(event=>event.executionId===e1.id&&event.type==='execution/provider_completed')?.payload.providerTiming;
  const timing=await readTiming();
  assert.ok(timing&&timing.firstTextDeltaMs!==null&&timing.responseCreatedMs!==null&&
    timing.resultObservedMs!==null&&timing.outputStagedMs!==null);
  assert.equal(timing.source,'simulated');
  assert.equal(timing.parentRequestId,null);
  assert.ok(timing.transport?.firstSseBytesMs != null && timing.transport.headersMs != null &&
    timing.transport.headersMs <= timing.transport.firstSseBytesMs);
  assert.ok(timing.responseCreatedMs<=timing.firstTextDeltaMs&&timing.firstTextDeltaMs<=timing.resultObservedMs&&
    timing.resultObservedMs<=timing.outputStagedMs&&timing.outputStagedMs<=timing.settlementStagedMs);
  assert.ok(timing.firstNonblankOutput?.kind === 'text' &&
    timing.firstTextDeltaMs <= timing.firstNonblankOutput.elapsedMs &&
    timing.firstNonblankOutput.elapsedMs <= timing.resultObservedMs);
  assert.doesNotMatch(JSON.stringify(timing),/Synthetic first (?:question|answer)/u);
  f.responses.push(()=>complete('resp-synthetic-second','Synthetic follow-up answer'));const second=await prepare(f,c.resourceId,'Synthetic follow-up');assert.deepEqual(second.preview.responses!.messages.filter(m=>m.role!=='developer').map(m=>[m.role,m.content]),[['user','Synthetic first question'],['assistant','Synthetic first answer'],['user','Synthetic follow-up']]);await f.core.command('conversationSend',await grant(f,second.preview));
  const before=await f.core.command('snapshot',{}),beforeIds=before.graph.messages.map(m=>m.id);assert.equal(before.bindings[c.resourceId],undefined);assert.equal(before.graph.messages.length,4);await f.reopen();
  assert.deepEqual(await readTiming(),timing);
  const third=await prepare(f,c.resourceId,'Synthetic after restart');assert.equal(third.preview.responses!.messages.length,6);f.responses.push(()=>complete('resp-synthetic-third','Synthetic restored answer'));await f.core.command('conversationSend',await grant(f,third.preview));
  const after=await f.core.command('snapshot',{});assert.deepEqual(after.graph.messages.slice(0,4).map(m=>m.id),beforeIds);assert.equal(after.graph.conversations.length,1);assert.equal(after.graph.conversations[0].kind,'ordinary');assert.equal(after.graph.messages.length,6);assert.equal(Object.values(after.executions).length,3);assert.equal(f.codexCalls,0);
  const delta=f.events.find(e=>e.payload.delta);assert.equal(delta?.providerId,providerId);assert.equal(delta?.threadId,null);assert.equal(delta?.turnId,null);assert(f.events.some(e=>e.payload.usage?.source==='provider-reported'));assert(!JSON.stringify(after).includes('SYNTHETIC_PLAN_TOKEN'));
 }finally{await f.close();}
});

test('ordinary history/provider reads never resolve credentials or catalogs; missing native service stays unavailable and manual local remains usable',async()=>{
 const f=fixture();try{
  for(let i=0;i<3;i++){await f.core.command('conversation',{name:'providers',input:{}});await f.core.command('conversation',{name:'list',input:{}});await f.core.command('ordinaryProviderStatus',{});}assert.equal(f.catalogReads,0);assert.equal(f.secretReads,0);
  await f.core.command('ordinaryProviderCheck',{});const providers=await f.core.command('conversation',{name:'providers',input:{}}) as any[];assert.equal(providers.find(p=>p.id===providerId).default,true);assert.equal(providers.find(p=>p.id==='chatgpt').available,false);assert.equal(providers.find(p=>p.id==='local').execute,false);assert.equal(f.codexCalls,0);
 }finally{await f.close();}
 const dir=mkdtempSync(join(tmpdir(),'aerynth-ordinary-unavailable-')),core=new BackendCore({path:join(dir,'canonical.sqlite'),provider:'fixture',contentPolicy:'synthetic-only'});try{assert.equal((await core.command('ordinaryProviderStatus',{})).state,'unavailable');const c=await core.command('createConversation',{providerId:'local',commandId:randomUUID()});await core.command('addMessage',{resourceId:c.resourceId,role:'user',content:'Synthetic useful local recording',expectedRevision:1});assert.equal((await core.command('snapshot',{})).graph.messages.length,1);}finally{await core.command('close',{});const part=relative(resolve(tmpdir()),resolve(dir));assert(part.startsWith('aerynth-ordinary-unavailable-')&&!part.startsWith('..')&&!isAbsolute(part));rmSync(dir,{recursive:true,force:true});}
});

test('authorized ordinary default survives restart without model configuration and only explicit Send checks models',async()=>{
 const f=fixture();try{
  await f.core.command('ordinaryProviderCheck',{});const beforeCatalog=f.catalogReads;await f.reopen();
  const c=await f.core.command('createConversation',{commandId:randomUUID()});assert.equal(c.providerId,providerId);assert.equal(c.kind,'ordinary');assert.equal(f.catalogReads,beforeCatalog);assert.equal(f.requests.length,0);assert.equal((await f.core.command('openResource',{resourceId:c.resourceId})).status,'ready');
  const fromManager=await f.core.command('conversation',{name:'create',input:{title:'',commandId:randomUUID()}}) as any;assert.equal(fromManager.providerId,providerId);const providers=await f.core.command('conversation',{name:'providers',input:{}}) as any[];assert.equal(providers.find(p=>p.id===providerId).default,true);assert.deepEqual(providers.find(p=>p.id===providerId).models,[]);assert.equal(f.catalogReads,beforeCatalog);
  const p=await prepare(f,c.resourceId,'Synthetic first Send after restart');assert.equal(f.catalogReads,beforeCatalog+1);assert.equal(f.requests.length,0);f.responses.push(()=>complete('resp-synthetic-restored-default'));await f.core.command('conversationSend',await grant(f,p.preview));assert.equal(f.requests.length,1);assert.equal(f.catalogReads,beforeCatalog+1);assert.equal(f.codexCalls,0);
 }finally{await f.close();}
});

test('explicit manual Desktop and Library choices stay local while omitted ordinary providers use the authorized default without model reads',async()=>{
 const f=fixture();try{
  await f.core.command('ordinaryProviderStatus',{});const desktop=await f.core.command('desktop',{type:'createResource',kind:'conversation',title:'Synthetic explicit Desktop manual',provider:'local',workspaceId:null}),manual=desktop.resources.find(r=>r.title==='Synthetic explicit Desktop manual')!;assert.equal(manual.providerId,'local');
  const automatic=await f.core.command('desktop',{type:'createResource',kind:'conversation',title:'Synthetic automatic Desktop ordinary',workspaceId:null});assert.equal(automatic.resources.find(r=>r.title==='Synthetic automatic Desktop ordinary')!.providerId,providerId);
  const ws=(await f.core.command('desktop',{type:'createWorkspace',title:'Synthetic library provider choices',projectId:null})).activeWorkspaceId!;
  const current=await f.core.command('desktop',{type:'snapshot'}),local=await f.core.command('library',{name:'createBlock',input:{commandId:randomUUID(),workspaceId:ws,expectedLayoutVersion:current.layoutVersion,kind:'conversation',title:'Synthetic explicit Library manual',provider:'local'}});
  assert.equal((local.result as any).resourceId,local.desktop!.resources.find(r=>r.providerId==='local'&&r.title==='Synthetic explicit Library manual')!.id);
  await f.reopen();const before=await f.core.command('desktop',{type:'snapshot'}),ready=await f.core.command('library',{name:'createBlock',input:{commandId:randomUUID(),workspaceId:ws,expectedLayoutVersion:before.layoutVersion,kind:'conversation',title:'Synthetic automatic Library ordinary'}});assert.equal(ready.desktop!.resources.find(r=>r.id===(ready.result as any).resourceId)!.providerId,providerId);
  assert.equal(f.catalogReads,0);assert.equal(f.requests.length,0);assert.equal(f.codexCalls,0);
 }finally{await f.close();}
});

test('ordinary stale revision/account/grant cannot dispatch, and permission loss invalidates approved history before any request',async()=>{
 const f=fixture();try{
  await f.core.command('ordinaryProviderCheck',{});const c=await f.core.command('createConversation',{commandId:randomUUID()}),p=await prepare(f,c.resourceId,'Synthetic reviewed request'),g=await grant(f,p.preview);
  await f.core.command('addMessage',{resourceId:c.resourceId,role:'user',content:'Synthetic intervening message',expectedRevision:1});await assert.rejects(f.core.command('conversationSend',g),/stale_resource_version|stale_send_preview/);assert.equal(f.requests.length,0);
  const fresh=await prepare(f,c.resourceId,'Synthetic permission-fenced request'),freshGrant=await grant(f,fresh.preview),access=f.owner.conversationAccess.access;f.owner.conversationAccess.access=()=>false;await assert.rejects(f.core.command('conversationSend',freshGrant),/stale_send_preview|source_unavailable/);f.owner.conversationAccess.access=access;assert.equal(f.requests.length,0);
  const changed=await prepare(f,c.resourceId,'Synthetic account-fenced request'),changedGrant=await grant(f,changed.preview);f.disconnect();await assert.rejects(f.core.command('conversationSend',changedGrant));assert.equal(f.requests.length,0);assert.equal(f.codexCalls,0);
 }finally{await f.close();}
});

test('credential resolution race rechecks authority before POST and preserves the accepted user message',async()=>{
 const f=fixture();let release:(()=>void)|undefined;try{
  await f.core.command('ordinaryProviderCheck',{});const c=await f.core.command('createConversation',{commandId:randomUUID()}),p=await prepare(f,c.resourceId,'Synthetic asynchronous credential fence'),g=await grant(f,p.preview),original=f.connection.resolveCredential;
  f.connection.resolveCredential=async version=>{const credential=await original(version);await new Promise<void>(resolve=>{release=resolve;});return credential;};
  const running=f.core.command('conversationSend',g);for(let i=0;i<100&&!release;i++)await new Promise(resolve=>setTimeout(resolve,1));assert(release);f.disconnect();release();const result=await running;assert.equal(result.state,'failed');assert.equal(f.requests.length,0);assert.equal((await f.core.command('snapshot',{})).graph.messages[0].content,p.input.content);assert.equal(f.codexCalls,0);
 }finally{release?.();await f.close();}
});

test('last async status revalidation cannot retain a resource grant revoked before the final synchronous dispatch fence',async()=>{
 const f=fixture();let release:(()=>void)|undefined;const originalStatus=f.connection.status;let activeStatuses=0;try{
  await f.core.command('ordinaryProviderCheck',{});const c=await f.core.command('createConversation',{commandId:randomUUID()}),p=await prepare(f,c.resourceId,'Synthetic final resource fence'),g=await grant(f,p.preview);
  f.connection.status=async()=>{const current=await originalStatus();if(f.owner.active&&++activeStatuses===2)await new Promise<void>(resolve=>{release=resolve;});return current;};
  const running=f.core.command('conversationSend',g);for(let i=0;i<100&&!release;i++)await new Promise(resolve=>setTimeout(resolve,1));assert(release,'gate must be the final active status, after credential resolution');const resource=f.owner.conversationAccess.resource;f.owner.conversationAccess.resource=()=>false;release();const result=await running;f.owner.conversationAccess.resource=resource;assert.equal(result.state,'failed');assert.equal(f.requests.length,0);assert.equal((await f.core.command('snapshot',{})).graph.messages[0].content,p.input.content);assert.equal(f.codexCalls,0);
 }finally{release?.();await f.close();}
});

test('an actual completed response after connection revocation keeps its reported receipt but cannot commit stale authorized output',async()=>{
 const f=fixture();try{
  await f.core.command('ordinaryProviderCheck',{});const c=await f.core.command('createConversation',{commandId:randomUUID()}),p=await prepare(f,c.resourceId,'Synthetic accepted before disconnect');
  f.responses.push(()=>{f.disconnect();return complete('resp-synthetic-disconnected','Synthetic output not committed after revocation');});const result=await f.core.command('conversationSend',await grant(f,p.preview));assert.equal(result.responseOutcome,'completed');assert.equal(result.responseId,'resp-synthetic-disconnected');assert.equal(result.state,'unknown');assert.equal(result.errorCode,'ordinary_context_changed');assert.equal(result.usage?.source,'provider-reported');assert.equal((await f.core.command('snapshot',{})).graph.messages.length,1);assert.equal(f.requests.length,1);assert.equal(f.codexCalls,0);
 }finally{await f.close();}
});

test('selective reviewed branch context survives ordinary restart without merging parent history; share supply needs actual response acceptance',async()=>{
 const f=fixture();try{
  await f.core.command('ordinaryProviderCheck',{});const parent=await f.core.command('createConversation',{providerId:'local',commandId:randomUUID()}),a=await f.core.command('addMessage',{resourceId:parent.resourceId,role:'user',content:'Synthetic selected source A',expectedRevision:1}),b=await f.core.command('addMessage',{resourceId:parent.resourceId,role:'user',content:'Synthetic EXCLUDED source B',expectedRevision:2}),branch=await f.core.command('branch',{resourceId:parent.resourceId,messageId:b.id,includeMessageIds:[a.id],providerId,title:'Synthetic ordinary branch',commandId:randomUUID(),tokenBudget:32768});assert.equal(branch.conversation.kind,'ordinary');
  await f.core.command('review',{handoffId:branch.handoff.id,fingerprint:branch.handoff.fingerprint,approve:true});
  const share=await f.core.command('conversation',{name:'publish',input:{sourceResourceId:parent.resourceId,sourceMessageId:a.id,evidence:'excerpt'}}) as any;await f.core.command('conversation',{name:'inspectShare',input:{resourceId:branch.conversation.resourceId,shareId:share.id}});await f.core.command('conversation',{name:'attachShare',input:{resourceId:branch.conversation.resourceId,shareId:share.id,attach:true}});
  const p=await prepare(f,branch.conversation.resourceId,'Synthetic branch question');assert.equal(p.preview.responses!.history.length,0);assert(p.preview.responses!.requiresSourceReview);assert(JSON.stringify(p.preview.responses!.messages).includes(a.content));assert(!JSON.stringify(p.preview.responses!.messages).includes(b.content));assert.equal((await f.core.command('conversation',{name:'detail',input:{resourceId:branch.conversation.resourceId}}) as any).shares[0].state,'attached');
  f.responses.push(()=>complete('resp-synthetic-selected','Synthetic selected-context answer'));const e=await f.core.command('conversationSend',await grant(f,p.preview));assert.equal(e.state,'provider_completed');assert.equal((await f.core.command('conversation',{name:'detail',input:{resourceId:branch.conversation.resourceId}}) as any).shares[0].state,'sent');
  await f.core.command('addMessage',{resourceId:parent.resourceId,role:'user',content:'Synthetic later independent parent C',expectedRevision:3});await f.reopen();
  const next=await prepare(f,branch.conversation.resourceId,'Synthetic retained-source follow-up');assert.equal(next.preview.handoff?.continued,true);assert(next.preview.responses!.history.every(h=>h.resourceId===branch.conversation.resourceId));assert(!JSON.stringify(next.preview.responses!.messages).includes(b.content));assert(!JSON.stringify(next.preview.responses!.messages).includes('later independent parent C'));assert(JSON.stringify(next.preview.responses!.messages).includes(a.content));
  f.owner.atomic(()=>f.owner.graph.markUnavailable(a.id));await assert.rejects(f.core.command('authorizeConversationSend',{previewId:next.preview.id,fingerprint:next.preview.fingerprint,commandId:next.input.commandId}),/source_unavailable|stale_context|source_revoked/);assert.equal(f.requests.length,1);assert.equal(f.codexCalls,0);
 }finally{await f.close();}
});

test('provider failure/EOF preserves exact user text and partial canonical evidence without silently reusing partial output',async()=>{
 const f=fixture();try{
  await f.core.command('ordinaryProviderCheck',{});const c=await f.core.command('createConversation',{commandId:randomUUID()});
  f.responses.push(()=>sse([{type:'response.created',response:{id:'resp-synthetic-gap'}},{type:'response.output_text.delta',delta:'Synthetic partial only'}]));const p=await prepare(f,c.resourceId,'Synthetic gap request'),e=await f.core.command('conversationSend',await grant(f,p.preview));assert.equal(e.state,'unknown');assert.equal(e.responseOutcome,'unknown');assert.equal(e.errorCode,'stream_terminal_unobserved');
  const d=await f.core.command('conversation',{name:'detail',input:{resourceId:c.resourceId}}) as any;assert.equal(d.messages.items[0].content,'Synthetic gap request');assert.equal(d.messages.items[1].content,'Synthetic partial only');assert.equal(d.messages.items[1].outputState,'partial');assert.equal(d.messages.items[1].executionId,e.id);
  await f.reopen();const next=await prepare(f,c.resourceId,'Synthetic explicit new request');assert.deepEqual(next.preview.responses!.messages.filter(m=>m.role!=='developer').map(m=>m.content),['Synthetic gap request','Synthetic explicit new request']);
  f.responses.push(()=>sse([{type:'response.failed',response:{id:'resp-synthetic-quota',status:'failed',error:{code:'subscription_sharing_usage_limit_exceeded'}}}]));const failed=await f.core.command('conversationSend',await grant(f,next.preview));assert.equal(failed.state,'failed');assert.equal(failed.errorCode,'subscription_sharing_usage_limit_exceeded');assert.equal(f.codexCalls,0);
 }finally{await f.close();}
});

test('Show my live Vela answer and clear it when I stop', async () => {
  const f = fixture();
  const state = async () => await f.core.command('vela', { name: 'state', input: {} }) as VelaState;
  let pending: Promise<VelaRequest> | undefined;
  try {
    const text = 'Synthetic partial response. '.repeat(21);
    f.responses.push(init => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        const events = [{ type: 'response.created', response: { id: 'resp-vela-stream' } },
          { type: 'response.output_text.delta', delta: text }];
        controller.enqueue(new TextEncoder().encode(events.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join('')));
        init.signal!.addEventListener('abort', () => controller.error(Error('Synthetic cancel')), { once: true });
      },
    }), { headers: { 'Content-Type': 'text/event-stream' } }));
    const sending = velaCommand({ win: { isDestroyed: () => false, webContents: { isDestroyed: () => false } }, dialog: {},
      directMessageSend: true, offerPlanningByDefault: true, call: (name: any, input: any) => f.core.command(name, input),
      input: { name: 'request', input: { intent: 'Tell me a short story.', resourceIds: [], authorizeProvider: true } },
    }) as Promise<VelaRequest>;
    pending = sending;
    let live: VelaState['activeAnswer'];
    for (let i = 0; i < 100 && !live; i++) {
      live = (await state()).activeAnswer;
      if (!live) await new Promise(resolve => setTimeout(resolve, 4));
    }
    assert(live);
    assert.equal(live.text, text.slice(0, 480));
    assert.equal(live.truncated, true);
    await f.core.command('vela', { name: 'cancel', input: live.requestId });
    assert.equal((await sending).state, 'cancelled');
    pending = undefined;
    assert.equal((await state()).activeAnswer, undefined);
    await f.reopen();
    const restored = await state();
    assert.equal(restored.activeAnswer, undefined);
    assert.equal(restored.requests.find(request => request.id === live.requestId)?.state, 'cancelled');
    assert(!restored.conversation?.messages.some(message => message.content.includes(text.slice(0, 50))));
    assert.equal(f.requests.length, 1);
  } finally { if (pending) { f.owner.ordinaryController?.abort(); await pending.catch(() => {}); } await f.close(); }
});

test('ordinary cancellation requests actual abort, retains unknown outcome/partial text and does not invoke Codex interrupt',async()=>{
 const f=fixture();let pending:Promise<unknown>|undefined;try{
  await f.core.command('ordinaryProviderCheck',{});const c=await f.core.command('createConversation',{commandId:randomUUID()});let started=false;
  f.responses.push(init=>new Response(new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify({type:'response.created',response:{id:'resp-synthetic-cancel'}})+'\n\ndata: '+JSON.stringify({type:'response.output_text.delta',delta:'Synthetic received before abort'})+'\n\n'));started=true;init.signal!.addEventListener('abort',()=>controller.error(new Error('Synthetic fetch abort')),{once:true});}}),{headers:{'Content-Type':'text/event-stream'}}));
  const p=await prepare(f,c.resourceId,'Synthetic cancel request');pending=f.core.command('conversationSend',await grant(f,p.preview));for(let i=0;i<100&&(!started||!f.owner.assistantText);i++)await new Promise(resolve=>setTimeout(resolve,2));assert(started);const execution=f.owner.active;assert(execution);
  assert.deepEqual(await f.core.command('interrupt',{executionId:execution.id}),{requested:true,confirmed:false});const result=await pending as any;pending=undefined;assert.equal(result.state,'unknown');assert.equal(result.cancellation.requested,true);assert.equal(result.cancellation.serverConfirmed,false);assert.equal(f.codexCalls,0);assert.equal((await f.core.command('conversation',{name:'detail',input:{resourceId:c.resourceId}}) as any).messages.items.at(-1).outputState,'partial');
 }finally{if(pending){f.owner.ordinaryController?.abort();await pending;}await f.close();}
});

test('a retired ordinary response-created callback cannot journal against a newer send', async () => {
  const f = fixture();
  let enterConfirmation!: () => void, releaseConfirmation!: () => void, finishConfirmation!: () => void;
  let enterNextPost!: () => void, releaseNextPost!: () => void;
  const confirming = new Promise<void>(resolve => { enterConfirmation = resolve; });
  const allowConfirmation = new Promise<void>(resolve => { releaseConfirmation = resolve; });
  const confirmationFinished = new Promise<void>(resolve => { finishConfirmation = resolve; });
  const nextPost = new Promise<void>(resolve => { enterNextPost = resolve; });
  const allowNextPost = new Promise<void>(resolve => { releaseNextPost = resolve; });
  let firstSend: ReturnType<BackendCore['execute']> | undefined;
  let nextSend: ReturnType<BackendCore['execute']> | undefined;
  try {
    await f.core.command('ordinaryProviderCheck', {});
    const parent = await f.core.command('createConversation', { providerId: 'local', commandId: randomUUID() });
    const source = await f.core.command('addMessage', { resourceId: parent.resourceId, role: 'user',
      content: 'Synthetic selected source', expectedRevision: 1 });
    const branch = await f.core.command('branch', { resourceId: parent.resourceId, messageId: source.id,
      includeMessageIds: [source.id], providerId, title: 'Synthetic reviewed branch', commandId: randomUUID(), tokenBudget: 32768 });
    await f.core.command('review', { handoffId: branch.handoff.id, fingerprint: branch.handoff.fingerprint, approve: true });
    const firstResource = branch.conversation.resourceId;
    const share = await f.core.command('conversation', { name: 'publish',
      input: { sourceResourceId: parent.resourceId, sourceMessageId: source.id, evidence: 'excerpt' } }) as { id: string };
    await f.core.command('conversation', { name: 'inspectShare', input: { resourceId: firstResource, shareId: share.id } });
    await f.core.command('conversation', { name: 'attachShare', input: { resourceId: firstResource, shareId: share.id, attach: true } });
    const next = await f.core.command('createConversation', { providerId, commandId: randomUUID() });

    const confirmSupplied = f.owner.conversations.confirmSupplied.bind(f.owner.conversations);
    f.owner.conversations.confirmSupplied = async (resourceId: string, shareId: string, executionId: string) => {
      enterConfirmation();
      await allowConfirmation;
      try { await confirmSupplied(resourceId, shareId, executionId); }
      finally { finishConfirmation(); }
    };
    const retiredResponseId = 'resp-synthetic-retired';
    const nextResponseId = 'resp-synthetic-successor';
    f.responses.push(
      () => sse([{ type: 'response.created', response: { id: retiredResponseId } }]),
      async () => { enterNextPost(); await allowNextPost; return complete(nextResponseId); },
    );
    const first = await prepare(f, firstResource, 'Synthetic first question');
    firstSend = f.core.command('conversationSend', await grant(f, first.preview));
    await Promise.race([confirming, firstSend.then(() => { throw Error('First send settled before confirmation was held'); })]);
    const firstExecutionId = first.preview.responses!.executionId;
    assert.deepEqual(await f.core.command('interrupt', { executionId: firstExecutionId }), { requested: true, confirmed: false });
    const retired = await firstSend;
    assert.equal(retired.state, 'unknown');
    assert.equal(retired.responseId, retiredResponseId);

    const successor = await prepare(f, next.resourceId, 'Synthetic successor question');
    nextSend = f.core.command('conversationSend', await grant(f, successor.preview));
    await Promise.race([nextPost, nextSend.then(() => { throw Error('Successor settled before its POST was held'); })]);
    const nextExecutionId = successor.preview.responses!.executionId;
    assert.equal(f.owner.active?.id, nextExecutionId);
    releaseConfirmation();
    await confirmationFinished;
    // Drain the retired callback's continuations while the successor still owns the lane.
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(f.owner.active?.id, nextExecutionId);
    releaseNextPost();
    assert.equal((await nextSend).state, 'provider_completed');

    const replay = await f.core.command('replay', { after: 0 });
    for (const events of [replay.events, f.events]) {
      const observed = events.filter(event => event.type === 'provider/response-created' && event.executionId === nextExecutionId);
      assert.deepEqual(observed.map(event => [event.resourceId, event.payload.responseId]), [[next.resourceId, nextResponseId]]);
    }
    assert.equal(f.requests.length, 2);
  } finally {
    releaseConfirmation();
    releaseNextPost();
    f.owner.ordinaryController?.abort();
    await Promise.allSettled([firstSend, nextSend]);
    await f.close();
  }
});

test('native auth finish returns pending promptly, suppresses secret URL in public state and closes the caught background task',async()=>{
 const f=fixture();try{
  const start=await f.core.command('providerAuth',{providerId,type:'begin'});assert('authorizationUrl'in start);const t=performance.now(),pending=await f.core.command('providerAuth',{providerId,type:'finish',attemptId:'synthetic-attempt'});assert(performance.now()-t<1000);assert(!('authorizationUrl'in pending));assert('pending'in pending&&pending.pending);assert(!JSON.stringify(await f.core.command('providerConnection',{providerId,type:'status'})).includes('https://'));
  await f.core.command('providerAuth',{providerId,type:'cancel',attemptId:'synthetic-attempt'});for(let i=0;i<20&&f.owner.ordinaryAuth.size;i++)await new Promise(resolve=>setTimeout(resolve,1));assert.equal(f.owner.ordinaryAuth.size,0);assert.equal(f.requests.length,0);
 }finally{await f.close();}
});

test('close during an ordinary pending stream waits for canonical unknown/partial settlement before closing SQLite',async()=>{
 const f=fixture();let running:Promise<unknown>|undefined;try{
  await f.core.command('ordinaryProviderCheck',{});const c=await f.core.command('createConversation',{commandId:randomUUID()});let aborted=false;
  f.responses.push(init=>new Response(new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify({type:'response.created',response:{id:'resp-synthetic-close'}})+'\n\ndata: '+JSON.stringify({type:'response.output_text.delta',delta:'Synthetic retained at close'})+'\n\n'));init.signal!.addEventListener('abort',()=>{aborted=true;controller.error(new Error('Synthetic close abort'));},{once:true});}}),{headers:{'Content-Type':'text/event-stream'}}));
  const p=await prepare(f,c.resourceId,'Synthetic durable close request');running=f.core.command('conversationSend',await grant(f,p.preview));for(let i=0;i<100&&!f.owner.assistantText;i++)await new Promise(resolve=>setTimeout(resolve,2));assert(f.owner.assistantText);
  await f.core.command('close',{});const e=await running as any;running=undefined;assert(aborted);assert.equal(e.state,'unknown');assert.equal(e.cancellation.serverConfirmed,false);assert.equal(f.owner.closed,true);assert.equal(f.codexCalls,0);
  await f.reopen();const restored=await f.core.command('snapshot',{});assert.equal(restored.executions[e.id].state,'unknown');assert.deepEqual(restored.graph.messages.map(m=>m.content),['Synthetic durable close request','Synthetic retained at close']);assert.equal(restored.messageEvidence[e.outputMessageId].outputState,'partial');assert.equal(f.requests.length,1);
 }finally{if(running){f.owner.ordinaryController?.abort();await running;}await f.close();}
});
