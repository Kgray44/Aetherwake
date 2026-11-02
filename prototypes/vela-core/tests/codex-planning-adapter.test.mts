import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CodexPlanningAdapter, CodexPlanningError, buildCodexPlanningPrompt, parseCodexPlanningOutput, planningDigest } from '../src/codex-planning-adapter.mts';
import { CAPABILITIES } from '../src/capabilities.ts';
import { createCapabilityCatalog } from '../src/capability-catalog.mts';
import type { CodexPlanningAdapterOptions, PlanningInput, PlanningObservation } from '../src/codex-planning-adapter.mts';
import type { Execution, Snapshot } from '../../integrated-backend/src/contracts.mts';

/** Explicit synthetic command-port doubles; these are adapter regressions, never real model qualification. */
function input(): PlanningInput {
  return { requestId: 'request:synthetic', conversationId: 'conversation:vela', intent: 'Create a research workspace referencing this note.',
    instruction: 'Keep provider identity and propose typed actions only.', capabilities: CAPABILITIES,
    context: { id: 'manifest:synthetic', createdAt: '2026-11-02T02:00:00Z', policyVersion: 'policy:synthetic',
      discovered: [{ id: 'note:synthetic', kind: 'resource', version: 1, title: 'Synthetic note' }],
      included: [{ id: 'note:synthetic', kind: 'resource', version: 1, title: 'Synthetic note', reason: 'explicit', content: 'Synthetic source text.', contentDigest: 'synthetic-digest', source: 'aerynth://note/synthetic', trust: 'untrusted-source-data' }],
      omitted: [], contentBytes: 22, coverage: 'explicit-resources-only' } };
}

test('current catalog prompt expands to every exact action schema, scope, effect and effective policy without changing source context',()=>{
  const request=input();
  request.instruction='Keep provider identity, current canonical scope, exact versions, reviewed commands and native permission boundaries. '.repeat(7);
  request.context.included[0].content='Synthetic canonical note with preserved provenance and current resource identifiers. '.repeat(4);
  request.context.contentBytes=Buffer.byteLength(request.context.included[0].content);
  const prompt=buildCodexPlanningPrompt(request),data=JSON.parse(prompt.split('\n').at(-1)!);
  assert(Buffer.byteLength(prompt)<=16384);assert(prompt.includes('inherits authorization and reversible'));
  assert.deepEqual(data.context,request.context,'No source text, source metadata or omission record is truncated');
  assert(data.$defs&&Object.keys(data.$defs).length>0);
  const expand=(value:any):any=>{
    if(Array.isArray(value))return value.map(expand);if(value===null||typeof value!=='object')return value;
    if(Object.hasOwn(value,'$ref')) {
      assert.deepEqual(Object.keys(value),['$ref']);assert.match(value.$ref,/^#\/\$defs\/s\d+$/);
      const definition=data.$defs[value.$ref.slice('#/$defs/'.length)];assert(definition);return expand(definition);
    }
    return Object.fromEntries(Object.entries(value).map(([key,entry])=>[key,expand(entry)]));
  };
  assert.deepEqual(data.capabilities.map((capability:any)=>({
    ...data.capabilityDefaults,...capability,schema:expand(capability.schema),
  })),request.capabilities.map(({label:_label,...capability})=>capability));
  assert.equal(data.capabilities.find((capability:any)=>capability.id==='delegateTask').authorization,'explicit-execution-authorization');
  assert.equal(data.capabilities.find((capability:any)=>capability.id==='search').reversible,'no-state-change');
});
const output = () => ({ schemaVersion: 1, summary: 'Propose a research workspace.', steps: [{ id: 'create', explanation: 'Use a reference to the selected canonical note.', action: { type: 'workspaceFromResources', title: 'Research', projectId: null, resourceIds: ['note:synthetic'] } }], contribution: { providerId: 'spoofed-provider', executionId: 'spoofed-execution', nativeThreadId: 'spoofed-thread', classification: 'reported' } });
function fixture(mode: 'normal' | 'invalid-json' | 'simulated' | 'unknown' | 'pending' | 'missing-output' = 'normal', providerOutput?: unknown) {
  let now = Date.parse('2026-11-02T02:00:00Z'), turns = 0, opens = 0, authorizations = 0, interrupts = 0;
  const observations: PlanningObservation[] = [], prompts: string[] = [];
  const snapshot = {
    contract: 'aerynth.integration@0.1', schemaVersion: 1, conversations: [], resources: [], relationships: [],
    resourceMap: {}, bindings: {}, handoffs: {}, executions: {}, messageEvidence: {},
    graph: { schemaVersion: 1, counter: 0, tick: 0, providers: [{ id: 'codex-app-server', mock: false, label: 'Explicit synthetic command-port double, not a live Codex connection' }], conversations: [], messages: [], artifacts: [], edges: [], handoffs: [], unavailableMessageIds: [], idempotency: {} },
  } as unknown as Snapshot;
  const options: CodexPlanningAdapterOptions = {
    now: () => now, wait: async ms => { now += ms; }, pollIntervalMs: 100, timeoutMs: 1000,
    availability: () => ({ available: true, busy: false }),
    backend: { command: async (name, request): Promise<any> => {
      if (name === 'snapshot') return structuredClone(snapshot);
      if (name === 'replay') return { events: [], earliest: null, latest: 0, truncated: false };
      if (name === 'interrupt') { interrupts++; const e = Object.values(snapshot.executions).find(e => e.id === (request as any).executionId)!; e.state = 'interrupted'; return { requested: true, confirmed: false }; }
      throw new Error('Unexpected synthetic command');
    } },
    authorizePlanning: request => { authorizations++; return { authorizationRef: 'host:synthetic-grant', requestId: request.requestId,
      sourceConversationId: request.sourceConversationId, providerId: 'codex-app-server', contextDigest: request.contextDigest, promptDigest: request.promptDigest, expiresAt: new Date(now + 60000).toISOString() }; },
    openPlanningConversation: async request => {
      opens++; assert.equal(request.grant.authorizationRef, 'host:synthetic-grant'); assert.equal(request.sourceConversationId, 'conversation:vela');
      snapshot.resourceMap['conversation:planning'] = 'graph:planning';
      return { resourceId: 'conversation:planning', revision: 1, title: request.title, providerId: 'codex-app-server', kind: 'codex', projectId: null, taskId: null };
    },
    executePlanning: async request => {
      turns++; prompts.push(request.prompt); assert.equal(request.grant.authorizationRef, 'host:synthetic-grant');
      const e: Execution = { id: 'execution:synthetic', resourceId: request.resourceId, providerId: 'codex-app-server',
        state: mode === 'pending' ? 'running' : mode === 'unknown' ? 'unknown' : 'provider_completed',
        binding: { providerId: 'codex-app-server', nativeThreadId: 'native-thread:synthetic', nativeSessionId: null, instanceId: 'instance:synthetic', accountScope: 'account:synthetic' },
        turnId: 'native-turn:synthetic', commandId: request.commandId, startedAt: new Date(now).toISOString(), endedAt: null, taskVerified: false };
      snapshot.executions[e.id] = e;
      if (mode !== 'missing-output') {
        snapshot.graph.messages.push({ id: 'message:synthetic', conversationId: 'graph:planning', role: 'assistant', sequence: 1,
          content: mode === 'invalid-json' ? 'This is not a JSON proposal.' : JSON.stringify(providerOutput === undefined ? output() : providerOutput), provenance: 'application', createdAt: new Date(now).toISOString(), referenceIds: [], constraint: false, sensitivity: 'internal', providerTurnId: e.turnId! });
        snapshot.messageEvidence['message:synthetic'] = { classification: mode === 'simulated' ? 'simulated' : 'reported', executionId: e.id, providerId: 'codex-app-server', nativeThreadId: e.binding!.nativeThreadId, nativeTurnId: e.turnId! };
      }
      return structuredClone(e);
    },
    observe: observation => { observations.push(structuredClone(observation)); },
  };
  return { options, snapshot, observations, prompts, counts: () => ({ turns, opens, authorizations, interrupts }), adapter: () => new CodexPlanningAdapter(options) };
}

test('real adapter routes through host-authorized canonical planning execution and replaces spoofed contribution with observed IDs', async () => {
  const f = fixture(), adapter = f.adapter();
  const proposal = await adapter.propose(input(), new AbortController().signal);
  assert.equal(proposal.contribution.providerId, 'codex-app-server');
  assert.equal(proposal.contribution.executionId, 'execution:synthetic');
  assert.equal(proposal.contribution.planningConversationId, 'conversation:planning');
  assert.equal(proposal.contribution.sourceMessageId, 'message:synthetic');
  assert.equal(proposal.contribution.nativeThreadId, 'native-thread:synthetic');
  assert.equal(proposal.contribution.nativeTurnId, 'native-turn:synthetic');
  assert.deepEqual(f.counts(), { turns: 1, opens: 1, authorizations: 1, interrupts: 0 });
  assert.equal(f.observations.at(-1)?.stage, 'proposal-ready');
  assert.equal(proposal.schemaVersion, 2); assert.equal(proposal.kind, 'plan', 'Legacy plan output normalizes explicitly');
  assert.ok(f.prompts[0].includes('You remain Codex'));
  assert.ok(f.prompts[0].includes('Synthetic source text.'));
  assert.ok(f.prompts[0].includes('"id":"note:synthetic"'));
});

test('bounded prompt and complete-manifest host authorization fail before any provider execution or source truncation', async () => {
  const f = fixture(), tooLarge = input(); tooLarge.context.included[0].content = 'x'.repeat(20000);
  await assert.rejects(f.adapter().propose(tooLarge, new AbortController().signal), /planning_prompt_capacity_exceeded/);
  assert.equal(f.counts().turns, 0); assert.equal(f.counts().opens, 0);
  const original = f.options.authorizePlanning;
  f.options.authorizePlanning = async request => { const grant = await original(request); return { ...grant, contextDigest: 'wrong-manifest' }; };
  await assert.rejects(f.adapter().propose(input(), new AbortController().signal), /host_planning_authorization_required/);
  assert.equal(f.counts().turns, 0); assert.equal(f.counts().opens, 0);
  assert.notEqual(planningDigest(input().context), planningDigest(tooLarge.context));
});

test('discovery prompt retains a representative source manifest and exact digest-bound index without embedding full action schemas',()=>{
  const request=input(),catalog=createCapabilityCatalog(request.capabilities);
  request.context.included[0].content='Synthetic reviewed source with exact provenance. '.repeat(140);
  request.context.contentBytes=Buffer.byteLength(request.context.included[0].content);
  const prompt=buildCodexPlanningPrompt(request,{projection:catalog.projection,declaration:catalog.declaration}),payload=JSON.parse(prompt.split('\n').at(-1)!);
  assert.deepEqual(payload.context,request.context);assert.deepEqual(payload.capabilityCatalog,catalog.projection);assert.deepEqual(payload.capabilityDiscovery,catalog.declaration);
  assert.equal(payload.schemaAvailability,'fetch-before-proposing');assert(!Object.hasOwn(payload,'capabilities'));assert(Buffer.byteLength(prompt)<16384);
  assert.throws(()=>buildCodexPlanningPrompt(request),/planning_prompt_capacity_exceeded/,'Legacy fallback never silently truncates the same sources');
  request.context.included[0].content='x'.repeat(17000);assert.throws(()=>buildCodexPlanningPrompt(request,{projection:catalog.projection,declaration:catalog.declaration}),/planning_prompt_capacity_exceeded/);
});

test('discovery grants bind the exact declaration and every proposed action passes the same-turn fetched-schema guard',async()=>{
  const catalog=createCapabilityCatalog(CAPABILITIES),f=fixture();let finished=0,checks=0;
  f.options.discovery={forRequest:()=>({projection:catalog.projection,declaration:catalog.declaration}),assertFetched:(requestId,ids,declaration)=>{checks++;assert.deepEqual(ids,['workspaceFromResources']);assert.deepEqual(declaration,catalog.declaration);},finish:()=>{finished++;}};
  const authorize=f.options.authorizePlanning;f.options.authorizePlanning=async request=>({...await authorize(request),discovery:request.discovery});
  await f.adapter().propose(input(),new AbortController().signal);assert.equal(checks,1);assert.equal(finished,1);
  const h=fixture();h.options.discovery={...f.options.discovery,assertFetched:()=>{throw Object.assign(new Error('Schema not fetched'),{code:'planning_capability_schema_not_discovered'});}};
  const authorizeH=h.options.authorizePlanning;h.options.authorizePlanning=async request=>({...await authorizeH(request),discovery:request.discovery});
  await assert.rejects(h.adapter().propose(input(),new AbortController().signal),/planning_capability_schema_not_discovered/);assert.equal(finished,2);
  const g=fixture();g.options.discovery={...f.options.discovery};
  await assert.rejects(g.adapter().propose(input(),new AbortController().signal),/capability_discovery_grant_mismatch/);assert.equal(g.counts().turns,0);assert.equal(g.counts().opens,0);
});

test('one-active-turn capacity and fixture provider identity block planning rather than simulating intelligence', async () => {
  const busy = fixture(); busy.options.availability = () => ({ available: true, busy: true });
  await assert.rejects(busy.adapter().propose(input(), new AbortController().signal), /provider_busy/); assert.equal(busy.counts().turns, 0);
  const simulated = fixture(); simulated.snapshot.graph.providers[0].mock = true;
  await assert.rejects(simulated.adapter().propose(input(), new AbortController().signal), /real_codex_planning_provider_required/); assert.equal(simulated.counts().turns, 0);
});

test('invalid/missing/simulated canonical output fails with retained source/execution references and no invented response', async () => {
  for (const [mode, code] of [['invalid-json', 'planning_output_not_json'], ['missing-output', 'planning_output_unavailable'], ['simulated', 'simulated_planning_output_rejected']] as const) {
    const f = fixture(mode);
    await assert.rejects(f.adapter().propose(input(), new AbortController().signal), (error: unknown) => {
      assert.ok(error instanceof CodexPlanningError); assert.equal(error.code, code);
      assert.equal(error.observation.executionId, 'execution:synthetic');
      assert.equal(error.observation.planningConversationId, 'conversation:planning');
      return true;
    });
    assert.equal(f.observations.at(-1)?.stage, 'invalid-output');
    if (mode === 'invalid-json') { assert.equal(f.snapshot.graph.messages[0].content, 'This is not a JSON proposal.'); assert.equal(f.observations.at(-1)?.sourceMessageId, 'message:synthetic'); }
  }
});

test('cancellation requests actual canonical interrupt and only confirms after recorded interrupted outcome', async () => {
  const f = fixture('pending'), controller = new AbortController(), original = f.options.executePlanning;
  f.options.executePlanning = async request => { const result = await original(request); controller.abort(); return result; };
  await assert.rejects(f.adapter().propose(input(), controller.signal), /planning_execution_interrupted/);
  assert.equal(f.counts().interrupts, 1);
  const requested = f.observations.find(o => o.cancellation.interruptRequested)!;
  assert.equal(requested.cancellation.confirmed, false);
  assert.equal(f.observations.at(-1)?.cancellation.confirmed, true);
  assert.equal(f.observations.at(-1)?.executionState, 'interrupted');
});

test('pre-dispatch cancellation starts no turn; canonical unknown and polling timeout stay unknown', async () => {
  const cancelled = fixture(), controller = new AbortController(); controller.abort();
  await assert.rejects(cancelled.adapter().propose(input(), controller.signal), /planning_cancelled_before_dispatch/);
  assert.equal(cancelled.counts().turns, 0); assert.equal(cancelled.counts().opens, 0);
  const unknown = fixture('unknown');
  await assert.rejects(unknown.adapter().propose(input(), new AbortController().signal), (error: unknown) => { assert.ok(error instanceof CodexPlanningError); assert.equal(error.observation.stage, 'unknown'); assert.equal(error.outcome, 'unknown'); return true; });
  const pending = fixture('pending');
  await assert.rejects(pending.adapter().propose(input(), new AbortController().signal), /planning_execution_outcome_unknown_timeout/);
  assert.equal(pending.counts().turns, 1); assert.equal(pending.counts().interrupts, 0);
});

test('parser accepts one enclosing JSON fence, rejects prose and unknown native actions, and trusts only host attribution', () => {
  const contribution = { providerId: 'codex-app-server', classification: 'reported' as const, executionId: 'e:trusted' };
  assert.equal(parseCodexPlanningOutput('```json\n' + JSON.stringify(output()) + '\n```', contribution).contribution.executionId, 'e:trusted');
  assert.throws(() => parseCodexPlanningOutput('Here is the plan:\n' + JSON.stringify(output()), contribution), /planning_output_not_json/);
  assert.throws(() => parseCodexPlanningOutput(JSON.stringify({ ...output(), steps: [{ id: 'bad', explanation: 'Unsupported action', action: { type: 'shell', command: 'not executable' } }] }), contribution), /unsupported_or_invalid_action/);
  assert.ok(Buffer.byteLength(buildCodexPlanningPrompt(input())) <= 16384);
});

test('wire-v2 conversational kinds use only the observed canonical provider turn and replace spoofed identity/native references', async () => {
  for (const kind of ['answer', 'clarification', 'inability'] as const) {
    const result = { schemaVersion: 2, kind, content: 'Explicit synthetic command-port ' + kind + '.', contribution: output().contribution }, f = fixture('normal', result);
    const response = await f.adapter().propose(input(), new AbortController().signal);
    assert.equal(response.kind, kind); assert.equal(response.schemaVersion, 2); assert.equal('content' in response && response.content, result.content); assert.equal('steps' in response, false);
    assert.deepEqual(response.contribution, { providerId: 'codex-app-server', classification: 'reported', executionId: 'execution:synthetic', planningConversationId: 'conversation:planning', sourceMessageId: 'message:synthetic', nativeThreadId: 'native-thread:synthetic', nativeTurnId: 'native-turn:synthetic' });
    assert.equal(f.observations.at(-1)!.stage, 'response-ready'); assert.equal(f.observations.at(-1)!.responseKind, kind); assert.equal(Object.keys(f.snapshot.executions).length, 1, 'The authorized response turn stays canonical, with no follow-on execution');
    assert.deepEqual(f.counts(), { turns: 1, opens: 1, authorizations: 1, interrupts: 0 }); assert.equal(f.snapshot.graph.messages[0].content, JSON.stringify(result), 'Exact raw provider output is retained separately from parsed conversation content');
    assert(f.prompts[0].includes('schemaVersion:2')); assert(f.prompts[0].includes('NO steps or actions')); assert(f.prompts[0].includes('You remain Codex')); assert(!f.prompts[0].includes('return an empty steps array')); assert(Buffer.byteLength(f.prompts[0]) <= 16384);
  }
});

test('conversational output remains strict bounded JSON and invalid response kinds preserve the canonical raw output', async () => {
  const contribution = { providerId: 'codex-app-server', classification: 'reported' as const, executionId: 'execution:trusted' };
  for (const bad of [{ schemaVersion: 2, kind: 'answer', content: 'x'.repeat(16001) }, { schemaVersion: 2, kind: 'answer', content: 'Not an action', steps: [] }, { schemaVersion: 2, kind: 'unknown', content: 'No guessing' }]) {
    const f = fixture('normal', bad);
    await assert.rejects(f.adapter().propose(input(), new AbortController().signal), /invalid_provider_result/); assert.equal(f.observations.at(-1)!.stage, 'invalid-output'); assert.equal(f.observations.at(-1)!.sourceMessageId, 'message:synthetic'); assert.equal(f.snapshot.graph.messages[0].content, JSON.stringify(bad)); assert.equal(f.counts().turns, 1);
  }
  assert.throws(() => parseCodexPlanningOutput('A plain conversational answer', contribution), /planning_output_not_json/);
  assert.throws(() => parseCodexPlanningOutput('x'.repeat(65537), contribution), /planning_output_capacity_exceeded/);
  const v2 = parseCodexPlanningOutput(JSON.stringify({ ...output(), schemaVersion: 2, kind: 'plan' }), contribution); assert.equal(v2.kind, 'plan');
});
