import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmedVelaPlan, projectVelaManifestation, type VelaManifestationSelection, type VelaManifestationSource } from '../src/manifestation-state.ts';
import type { PlanState, VelaMessage, VelaPlan, VelaRequest } from '../src/contracts.ts';

const selection = (patch: Partial<VelaManifestationSelection> = {}): VelaManifestationSelection => ({ selectedRequestId: null, dismissedRequestIds: [], pinnedRequestIds: [], ...patch });
const context = { id: 'synthetic:manifest', createdAt: '2026-11-02T00:00:00Z', policyVersion: 'synthetic:policy', discovered: [], included: [], omitted: [], contentBytes: 0, coverage: 'explicit-resources-only' as const };
const request = (id: string, patch: Partial<VelaRequest> = {}): VelaRequest => ({ id, conversationId: 'synthetic:vela-resource', intent: 'Synthetic retained request', state: 'planning', createdAt: context.createdAt, updatedAt: context.createdAt, providerId: 'synthetic:provider', context, ...patch });
const source = (...requests: VelaRequest[]): VelaManifestationSource => ({ conversation: { resourceId: 'synthetic:vela-resource', revision: 7, messages: [] }, requests, plans: [], receipts: [] });
function reply(id: string, local = false, kind: 'answer' | 'clarification' | 'inability' = 'answer') {
  const r = request(id, { state: 'responded', providerId: local ? null : 'synthetic:provider', response: { kind, messageId: id + ':response' }, ...(local ? { local: { schemaVersion: 1, commandId: id + ':command', capabilityId: 'local.time', observedAt: context.createdAt, classification: 'observed', providerId: null, facts: { kind: 'unavailable', code: 'local_time_unavailable' } } } : {}) });
  const message: VelaMessage = { id: id + ':response', requestId: id, role: 'assistant', content: 'Synthetic canonical response body', responseKind: kind, source: local ? 'vela-native' : 'provider', classification: local ? 'observed' : 'reported', ...(local ? {} : { providerId: 'synthetic:provider', providerContribution: { providerId: 'synthetic:provider', classification: 'reported', executionId: 'synthetic:execution' } }) };
  return { r, message };
}
function addPlan(s: VelaManifestationSource, r: VelaRequest, state: PlanState): VelaPlan {
  const plan: VelaPlan = { id: r.id + ':plan', requestId: r.id, version: 1, fingerprint: 'synthetic:fingerprint', summary: 'Synthetic plan body', steps: [{ id: 'synthetic:step', explanation: 'Synthetic fixture', action: { type: 'createProject', title: 'Synthetic project' } }], targets: [], scope: { principalId: 'synthetic', policyVersion: 'synthetic', resourceIds: [], projectIds: [], workspaceIds: [] }, contribution: null, state, createdAt: context.createdAt, expiresAt: context.createdAt };
  r.planId = plan.id; s.plans.push(plan); return plan;
}

test('native tool blockers surface the same canonical observed reply while keeping API identity and unknown outcome',()=>{
 for(const phase of ['blocked','budget-exhausted','clarification','unknown'] as const){
  const {r,message}=reply('synthetic:tool-'+phase,false,phase==='clarification'?'clarification':'inability');r.providerId='openai-api-vela';r.toolWorkflow={id:'synthetic:workflow',phase};if(phase==='unknown')r.state='unknown';
  message.source='vela-native';message.classification='observed';delete message.providerId;delete message.providerContribution;
  const state=source(r);state.conversation!.messages.push(message);assert.equal(projectVelaManifestation(state).currentMessageId,message.id);
  const applied=addPlan(state,r,'applied');assert.equal(projectVelaManifestation(state).currentMessageId,message.id);assert.equal(projectVelaManifestation(state).currentPlanId,applied.id);
  message.providerContribution={providerId:'openai-api-vela',classification:'reported'};assert.notEqual(projectVelaManifestation(state).currentMessageId,message.id);delete message.providerContribution;
  r.toolWorkflow.phase='awaiting-review';assert.notEqual(projectVelaManifestation(state).currentMessageId,message.id);
 }
});
test('empty/unhydrated state yields none and canonical history uses the actual resource and revision, never system:vela', () => {
  assert.equal(projectVelaManifestation(null).kind, 'none');
  const s = source(); assert.deepEqual(projectVelaManifestation(s).historyResource, { resourceId: 'synthetic:vela-resource', revision: 7 });
  assert.equal(projectVelaManifestation({ ...s, conversation: null }).historyResource, null);
});
test('exact observed native local response projects Whisper without copying facts/body/provider fields', () => {
  const { r, message } = reply('synthetic:clock', true), s = source(r); s.conversation!.messages.push(message);
  const result = projectVelaManifestation(s); assert.equal(result.kind, 'whisper'); assert.equal(result.currentRequestId, r.id); assert.equal(result.currentMessageId, message.id); assert.equal(result.currentPlanId, null); assert.equal(result.canDismiss, true);
  assert.deepEqual(Object.keys(result).sort(), ['kind', 'currentRequestId', 'currentMessageId', 'currentPlanId', 'historyResource', 'pinned', 'canDismiss', 'requiredPlanIds', 'selectionReason'].sort());
});
test('shows a scoped native mission answer as the current reply without displacing a pending request', () => {
  const report: VelaMessage = { id: 'synthetic:mission-answer', role: 'assistant', source: 'vela-native',
    classification: 'observed', content: 'CPU usage was 15% over a 250 ms sample.', responseKind: 'answer',
    missionReport: { missionId: 'synthetic:mission', workspaceId: 'synthetic:workspace', projectId: null } };
  const ready = source();
  ready.conversation!.messages.push(report);
  assert.equal(projectVelaManifestation(ready).currentMessageId, report.id);
  const pending = source(request('synthetic:pending'));
  pending.conversation!.messages.push(report);
  assert.equal(projectVelaManifestation(pending).currentMessageId, null);
  ready.conversation!.messages.push({ ...report, id: 'synthetic:untrusted', source: 'provider', classification: 'reported' });
  assert.equal(projectVelaManifestation(ready).kind, 'none');
});
test('attributed answer/clarification/inability are Insight; missing or spoofed canonical response attribution never becomes a surfaced message', () => {
  for (const kind of ['answer', 'clarification', 'inability'] as const) {
    const { r, message } = reply('synthetic:' + kind, false, kind), s = source(r); s.conversation!.messages.push(message);
    assert.equal(projectVelaManifestation(s).kind, 'insight'); assert.equal(projectVelaManifestation(s).currentMessageId, message.id);
    message.providerId = 'synthetic:other-provider'; assert.equal(projectVelaManifestation(s).currentMessageId, null);
  }
  const { r, message } = reply('synthetic:bad-local', true), s = source(r); message.classification = 'reported'; s.conversation!.messages.push(message); assert.equal(projectVelaManifestation(s).kind, 'insight'); assert.equal(projectVelaManifestation(s).currentMessageId, null);
});
test('standalone check surfaces only the matching observed terminal response', () => {
  const { r, message } = reply('synthetic:check', true), s = source(r);
  delete r.local;
  r.route = { kind: 'project-check', reason: 'reviewed-local-check', environment: 'local-read-only', check: 'node-test' };
  r.projectCheck = { id: 'synthetic:check-receipt', kind: 'node-test', state: 'passed', inputs: ['synthetic.test.mjs'],
    sourceHead: 'a'.repeat(40), inputDigest: 'b'.repeat(64), startedAt: context.createdAt, testCount: 1 };
  s.conversation!.messages.push(message);
  assert.equal(projectVelaManifestation(s).kind, 'insight');
  assert.equal(projectVelaManifestation(s).currentMessageId, message.id);
  r.projectCheck.state = 'running';
  assert.equal(projectVelaManifestation(s).currentMessageId, null);
  r.projectCheck.state = 'passed';
  message.source = 'provider';
  assert.equal(projectVelaManifestation(s).currentMessageId, null);
});
test('pending/error canonical requests remain references with no invented answer, plan, progress, provider or receipt', () => {
  for (const state of ['planning', 'provider-unavailable', 'invalid-plan', 'failed', 'cancelled', 'unknown'] as const) { const r = request('synthetic:' + state, { state }), result = projectVelaManifestation(source(r)); assert.equal(result.kind, 'insight'); assert.equal(result.currentMessageId, null); assert.equal(result.currentPlanId, null); assert.equal(result.currentRequestId, r.id); }
});
test('prepared/approved/applying/unknown actual plans override dismissal/old selection without fabricating applied effects', () => {
  for (const state of ['prepared', 'approved', 'applying', 'unknown'] as const) {
    const older = reply('synthetic:older', true), r = request('synthetic:action'), s = source(older.r, r), plan = addPlan(s, r, state); s.conversation!.messages.push(older.message);
    const result = projectVelaManifestation(s, selection({ selectedRequestId: older.r.id, dismissedRequestIds: [r.id] })); assert.equal(result.kind, 'action'); assert.equal(result.currentRequestId, r.id); assert.equal(result.currentPlanId, plan.id); assert.equal(result.currentMessageId, null); assert.equal(result.canDismiss, false); assert.equal(result.selectionReason, 'required-plan'); assert.deepEqual(result.requiredPlanIds, [plan.id]);
  }
});
test('all required canonical plans stay discoverable, and only exact action-linked canonical assistant messages can surface', () => {
  const a = request('synthetic:first'), b = request('synthetic:second'), s = source(a, b), first = addPlan(s, a, 'prepared'), second = addPlan(s, b, 'unknown');
  s.conversation!.messages.push({ id: 'synthetic:observed-action', role: 'assistant', content: 'Synthetic observed action state', source: 'vela-native', classification: 'observed', requestId: b.id, planId: second.id });
  const result = projectVelaManifestation(s); assert.deepEqual(result.requiredPlanIds, [first.id, second.id]); assert.equal(result.currentMessageId, 'synthetic:observed-action'); assert.equal(result.currentPlanId, second.id);
});

test('completed plans surface the observed result only when every native effect is confirmed', () => {
  const r = request('synthetic:complete', { state: 'completed', providerId: null }), s = source(r), plan = addPlan(s, r, 'applied');
  s.conversation!.messages.push({ id: 'synthetic:result', role: 'assistant', content: 'Created the workspace with three blocks.',
    source: 'vela-native', classification: 'observed', requestId: r.id, planId: plan.id });
  const receipt = { id: 'synthetic:receipt', requestId: r.id, planId: plan.id, stepId: plan.steps[0].id,
    commandId: 'synthetic:command', source: 'vela' as const, providerId: null, taskVerified: false as const,
    state: 'applied' as const, hostReceiptId: 'synthetic:host', startedAt: context.createdAt, endedAt: context.createdAt };
  assert.equal(projectVelaManifestation(s).kind, 'action', 'A completed flag alone is insufficient');
  s.receipts.push(receipt);
  assert.equal(projectVelaManifestation(s).kind, 'insight');
  assert.equal(projectVelaManifestation(s).currentMessageId, 'synthetic:result');
  assert.equal(projectVelaManifestation(s).currentPlanId, plan.id, 'Details retain the canonical plan');
  s.receipts[0].requestId = 'synthetic:other'; assert.equal(projectVelaManifestation(s).kind, 'action');
  s.receipts[0].requestId = r.id;
  plan.steps[0].action = { type: 'delegateTask', title: 'Delegation', objective: 'Run an investigation', providerId: 'codex-app-server', resourceIds: [], constraints: [] };
  assert.equal(projectVelaManifestation(s).kind, 'action', 'Dispatch is not verified delegated work');
});
test('the final same-request API answer follows receipted effects without losing details or promoting reported completion',()=>{
  const {r,message}=reply('synthetic:tool-result'),s=source(r);r.providerId='openai-api-vela';r.toolWorkflow={id:'synthetic:workflow',phase:'partial'};message.providerId='openai-api-vela';message.providerContribution!.providerId='openai-api-vela';const plan=addPlan(s,r,'applied');s.conversation!.messages.push({id:'synthetic:native-step',role:'assistant',requestId:r.id,planId:plan.id,source:'vela-native',classification:'observed',content:'Created the project.'},message);
  assert.equal(projectVelaManifestation(s).kind,'action','reported response alone cannot verify an unreceipted effect');s.receipts.push({id:'synthetic:receipt',requestId:r.id,planId:plan.id,stepId:plan.steps[0].id,commandId:'synthetic:command',source:'vela',providerId:null,state:'applied',hostReceiptId:'synthetic:host',startedAt:context.createdAt,taskVerified:false});
  const projected=projectVelaManifestation(s);assert.equal(projected.kind,'insight');assert.equal(projected.currentMessageId,message.id);assert.equal(projected.currentPlanId,plan.id);assert.equal(confirmedVelaPlan(s,r,plan),false);assert.equal(message.classification,'reported');assert.equal(r.toolWorkflow.phase,'partial');assert.equal(projectVelaManifestation(s,selection({dismissedRequestIds:[r.id]})).kind,'none');
  plan.steps[0].action={type:'delegateTask',title:'Report',objective:'Investigate',providerId:'codex-app-server',resourceIds:[],constraints:[]};assert.equal(projectVelaManifestation(s).currentMessageId,message.id);assert.equal(confirmedVelaPlan(s,r,plan),false,'a reported dispatch stays unverified');s.receipts[0].state='unknown';assert.equal(projectVelaManifestation(s).kind,'action');
  s.receipts.length=0;plan.state='rejected';plan.reviewedAt=context.createdAt;assert.equal(projectVelaManifestation(s).currentMessageId,message.id,'a canonical refusal can be reconciled without inventing an effect');delete plan.reviewedAt;assert.equal(projectVelaManifestation(s).kind,'action');
});
test('dismiss/latest stays quiet without rewinding history; pin does not force selection, and explicit reopen preserves the canonical identity', () => {
  const a = reply('synthetic:old', true), b = reply('synthetic:new'), s = source(a.r, b.r); s.conversation!.messages.push(a.message, b.message); const before = structuredClone(s);
  const dismissed = selection({ dismissedRequestIds: [b.r.id], pinnedRequestIds: [a.r.id] }); assert.equal(projectVelaManifestation(s, dismissed).kind, 'none');
  const reopened = projectVelaManifestation(s, selection({ selectedRequestId: a.r.id, pinnedRequestIds: [a.r.id] })); assert.equal(reopened.currentRequestId, a.r.id); assert.equal(reopened.currentMessageId, a.message.id); assert.equal(reopened.pinned, true); assert.equal(reopened.selectionReason, 'selected'); assert.deepEqual(s, before);
});
test('stale/foreign/duplicate IDs and orphaned filtered plans cannot resurrect canonical objects', () => {
  const valid = reply('synthetic:valid'), foreign = request('synthetic:foreign', { conversationId: 'synthetic:other-history' }), s = source(valid.r, foreign); s.conversation!.messages.push(valid.message); addPlan(s, foreign, 'prepared');
  assert.equal(projectVelaManifestation(s, selection({ selectedRequestId: foreign.id })).currentRequestId, valid.r.id); assert.deepEqual(projectVelaManifestation(s).requiredPlanIds, []);
  s.requests.push({ ...valid.r }); assert.equal(projectVelaManifestation(s).kind, 'none');
  const orphan = source(request('synthetic:orphan', { planId: 'synthetic:filtered-plan', state: 'awaiting-review' })); assert.equal(projectVelaManifestation(orphan).currentPlanId, null); assert.equal(projectVelaManifestation(orphan).kind, 'insight');
});
test('projection is idempotent on frozen canonical state and never reads canonical content/intent/plan bodies', () => {
  const { r, message } = reply('synthetic:no-body-read', true), s = source(r); s.conversation!.messages.push(message);
  Object.defineProperty(message, 'content', { get() { throw Error('Projection must not read/copy message body'); } }); Object.defineProperty(r, 'intent', { get() { throw Error('Projection must not read/copy intent'); } });
  Object.freeze(message); Object.freeze(r); Object.freeze(s.requests); Object.freeze(s.conversation!.messages); Object.freeze(s.conversation); Object.freeze(s);
  const choice = Object.freeze(selection({ pinnedRequestIds: Object.freeze([r.id, r.id, 'synthetic:missing']), dismissedRequestIds: Object.freeze([]) }));
  assert.deepEqual(projectVelaManifestation(s, choice), projectVelaManifestation(s, choice)); assert.equal(projectVelaManifestation(s, choice).kind, 'whisper');
});
