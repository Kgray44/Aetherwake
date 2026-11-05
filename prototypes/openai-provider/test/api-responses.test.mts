import test from 'node:test';
import assert from 'node:assert/strict';
import { ResponsesTransport, prepareResponsesTurn, RESPONSES_ENDPOINT } from '../responses.mts';
import type { ApiRecoveryReference, ApiResponseItem, DispatchReview, NativeDispatchPort, ReviewedApiFunction, TurnEvent, TurnInput } from '../contracts.mts';
import { digest } from '../common.mts';

const boundary = 'a'.repeat(64), contextDigest = 'b'.repeat(64);
const definition: ReviewedApiFunction['definition'] = { type: 'function', name: 'read_timer', description: 'Read a canonical timer.', strict: true, parameters: { type: 'object', properties: { timerId: { type: 'string' } }, required: ['timerId'], additionalProperties: false } };
const reviewed: ReviewedApiFunction = { definition, schemaDigest: digest(JSON.stringify(definition)), authorizationRef: 'native-tool-review' };
const input = (): TurnInput => ({ executionId: 'execution-api-1', requestId: 'request-api-1', configurationId: 'vela-api', providerId: 'openai-api-vela', assistant: 'vela', model: 'gpt-api-fixture', instructions: 'Versioned Vela identity.', messages: [{ role: 'user', content: 'Read the timer.' }], contextDigest, api: { configurationVersion: 3, instructionVersion: 'vela-identity@1', maxOutputTokens: 1024, tools: [reviewed] } });
const call: Extract<ApiResponseItem, { type: 'function_call' }> = { type: 'function_call', id: 'fc-fixture', call_id: 'call-fixture', name: 'read_timer', arguments: '{"timerId":"timer-1"}', status: 'completed' };
const message: ApiResponseItem = { type: 'message', id: 'msg-fixture', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'The timer has 30 seconds left.', annotations: [] }] };
const created = { type: 'response.created', response: { id: 'resp-fixture', status: 'in_progress' } };
const completed = (output: ApiResponseItem[] = [call]) => ({ type: 'response.completed', response: { id: 'resp-fixture', status: 'completed', model: 'gpt-api-fixture', output, usage: { input_tokens: 40, output_tokens: 10, total_tokens: 50, input_tokens_details: { cached_tokens: 20 } } } });
function stream(events: unknown[], chunk = 999999): Response {
  const bytes = Buffer.from(events.map(event => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`).join('')); let offset = 0;
  return new Response(new ReadableStream({ pull(controller) { if (offset >= bytes.length) controller.close(); else { const end = Math.min(bytes.length, offset + chunk); controller.enqueue(bytes.subarray(offset, end)); offset = end; } } }), { headers: { 'Content-Type': 'text/event-stream' } });
}
function native(overrides: Partial<NativeDispatchPort> = {}): NativeDispatchPort { return { authorize: async () => {}, resolveCredential: async () => ({ providerId: 'openai-api-vela', kind: 'openai-api-key', bearer: 'SYNTHETIC_API_KEY', boundaryDigest: boundary, organization: 'org-fixture', project: 'proj-fixture' }), resolveCatalog: async () => ({ boundaryDigest: boundary, expiresAt: 100000, models: ['gpt-api-fixture'] }), revalidate: async () => {}, ...overrides }; }
function fixture(fetcher: typeof fetch = async () => stream([created, completed()]), port = native(), limits = {}) {
  const events: TurnEvent[] = [], requests: { url: string; init?: RequestInit }[] = [];
  const transport = new ResponsesTransport({ native: port, now: () => 1000, limits, onEvent: event => { events.push(event); }, fetch: async (url, init) => { requests.push({ url: String(url), init }); return fetcher(url, init); } });
  return { transport, events, requests };
}
function recovery(retention: ApiRecoveryReference['retention'] = { store: true, background: false, authorizationRef: 'retention-review' }): ApiRecoveryReference {
  return { contract: 'aerynth.api-response-recovery@1', providerId: 'openai-api-vela', configurationId: 'vela-api', configurationVersion: 3, executionId: 'execution-api-1', requestId: 'request-api-1', model: 'gpt-api-fixture', contextDigest, bodyDigest: 'c'.repeat(64), instructionVersion: 'vela-identity@1', boundaryDigest: boundary, responseId: 'resp-fixture', ...(retention ? { retention } : {}), tools: [{ name: definition.name, schemaDigest: reviewed.schemaDigest, authorizationRef: reviewed.authorizationRef }] };
}
const snapshot = (overrides: Record<string, unknown> = {}) => ({ id: 'resp-fixture', status: 'completed', output: [message], usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 }, ...overrides });

test('offline API-only reviewed function, schema, configurable reasoning, code prompt version and current cache wire contracts', async () => {
  const turn: TurnInput = { ...input(), reasoningEffort: 'high', api: { ...input().api!, reasoningEfforts: ['low', 'high'], outputFormat: { type: 'json_schema', name: 'vela_reply', strict: true, schema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false } }, prompt: { id: 'pmpt-existing-legacy', version: '2', variables: { name: 'Vela' } }, cache: { key: 'opaque-vela-cache', options: { mode: 'implicit', ttl: '30m' } } } };
  const prepared = prepareResponsesTurn(turn), wire = JSON.parse(prepared.body);
  assert.equal(wire.store, false); assert.equal(wire.stream, true); assert.equal(wire.max_output_tokens, 1024);
  assert.deepEqual(wire.reasoning, { effort: 'high' }); assert.deepEqual(wire.tools, [definition]); assert.equal(wire.parallel_tool_calls, false);
  assert.deepEqual(wire.text.format, turn.api!.outputFormat); assert.deepEqual(wire.prompt, turn.api!.prompt);
  assert.deepEqual(wire.prompt_cache_options, { mode: 'implicit', ttl: '30m' }); assert.equal(wire.prompt_cache_key, 'opaque-vela-cache'); assert.equal('prompt_cache_retention' in wire, false);
  assert.equal('authorizationRef' in wire.tools[0], false); assert.equal('configurationVersion' in wire, false); assert.equal('api' in wire, false);
  assert.equal(prepared.review.api!.configurationVersion, 3); assert.equal(prepared.review.api!.instructionVersion, 'vela-identity@1'); assert.equal(prepared.review.api!.tools[0].authorizationRef, 'native-tool-review');
  let checked = false;
  const f = fixture(async (url, init) => { assert.equal(url, RESPONSES_ENDPOINT); assert.equal(init?.body, prepared.body); assert.equal(new Headers(init?.headers).get('OpenAI-Project'), 'proj-fixture'); return stream([created, completed()]); }, native({ authorize: async review => { checked = true; assert.deepEqual(review, prepared.review); } }));
  const result = await f.transport.turn(turn); assert.equal(checked, true); assert.equal(result.outcome, 'completed'); assert.equal(result.api!.toolCalls.length, 1); assert.equal(result.taskVerified, false); assert.equal(result.usage!.cachedInputTokens, 20);
});

test('offline no implicit API policy or weakened ordinary route, unreviewed tools, schema and request ceilings deny before dispatch', async () => {
  const base = input(), changed = { ...structuredClone(reviewed), schemaDigest: 'f'.repeat(64) };
  const bad = [
    { ...base, providerId: 'chatgpt-plan-responses', assistant: 'ordinary' },
    { ...base, reasoningEffort: 'high' },
    { ...base, api: { ...base.api!, tools: [changed] } },
    { ...base, api: { ...base.api!, tools: [{ ...reviewed, authorizationRef: '' }] } },
    { ...base, api: { ...base.api!, tools: [reviewed, reviewed] } },
    { ...base, api: { ...base.api!, maxOutputTokens: 32769 } },
    { ...base, api: { ...base.api!, maxOutputTokens: 0 } },
    { ...base, api: { ...base.api!, configurationVersion: 0 } },
    { ...base, api: { ...base.api!, retention: { store: true, background: false } } },
    { ...base, api: { ...base.api!, outputFormat: { type: 'json_schema', name: 'answer', strict: false, schema: {} } } },
    { ...base, api: { ...base.api!, outputFormat: { type: 'json_schema', name: 'answer', strict: true, schema: { type: 'object', properties: { nested: { type: 'object', properties: {}, required: [] } }, required: ['nested'], additionalProperties: false } } } },
    { ...base, api: { ...base.api!, cache: { options: { mode: 'implicit', ttl: '24h' } } } },
    { ...base, api: { ...base.api!, providerParameters: { temperature: 0 } } },
    { ...base, webSearch: true },
  ];
  let authorizations = 0; const f = fixture(undefined, native({ authorize: async () => { authorizations++; } }));
  for (const turn of bad) await assert.rejects(f.transport.turn(turn as TurnInput));
  assert.equal(authorizations, 0); assert.equal(f.requests.length, 0);
  const denied = fixture(undefined, native({ authorize: async () => { throw Error('SYNTHETIC_API_KEY raw policy failure'); } }));
  const result = await denied.transport.turn(base); assert.equal(result.dispatched, false); assert.equal(result.outcome, 'failed'); assert.ok(!JSON.stringify(result).includes('SYNTHETIC_API_KEY'));
});

test('offline fragmented API function arguments remain distinct from assistant text and require canonical host validation', async () => {
  const events = [created,
    { type: 'response.output_item.added', output_index: 0, item: { ...call, status: 'in_progress', arguments: '' } },
    { type: 'response.function_call_arguments.delta', item_id: call.id, output_index: 0, delta: '{"timerId":' },
    { type: 'response.function_call_arguments.delta', item_id: call.id, output_index: 0, delta: '"timer-1"}' },
    { type: 'response.function_call_arguments.done', item_id: call.id, output_index: 0, arguments: call.arguments },
    { type: 'response.output_item.done', output_index: 0, item: call }, completed(),
  ];
  const f = fixture(async () => stream(events, 1)), result = await f.transport.turn(input());
  assert.equal(result.outcome, 'completed'); assert.equal(result.partialText, ''); assert.deepEqual(result.api!.outputItems, [call]); assert.equal(result.api!.toolCalls.length, 1);
  const observed = result.api!.toolCalls[0]; assert.equal(observed.callId, call.call_id); assert.equal(observed.argumentsDigest, digest(call.arguments)); assert.equal(observed.schemaDigest, reviewed.schemaDigest);
  assert.equal(observed.contextDigest, contextDigest); assert.equal(observed.configurationVersion, 3); assert.equal(observed.executionId, input().executionId); assert.equal(observed.responseId, 'resp-fixture'); assert.equal(observed.requiresHostValidation, true);
  assert.equal(f.events.filter(event => event.type === 'provider/function-arguments-delta').length, 2); assert.equal(f.events.filter(event => event.type === 'provider/function-call').length, 1); assert.equal(f.events.some(event => event.type === 'provider/text-delta'), false);
});

test('offline stateless continuation sends actual function_call_output bound to observed call and native result receipt', async () => {
  const first = await fixture().transport.turn(input()), items = first.api!.outputItems;
  const turn: TurnInput = { ...input(), executionId: 'execution-api-2', requestId: 'request-api-2', contextDigest, api: { ...input().api!, continuation: { sourceExecutionId: input().executionId, responseId: first.responseId!, configurationVersion: 3, contextDigest, sourceOutcome: 'completed', itemsDigest: digest(JSON.stringify(items)), items, toolOutputs: [{ callId: call.call_id, name: call.name, argumentsDigest: digest(call.arguments), output: '{"secondsLeft":30}', receiptId: 'canonical-read-receipt' }] } } };
  let review: DispatchReview | undefined;
  const f = fixture(async () => stream([created, { type: 'response.output_text.delta', delta: 'The timer has 30 seconds left.' }, completed([message])]), native({ authorize: async value => { review = value; } }));
  const result = await f.transport.turn(turn), body = JSON.parse(String(f.requests[0].init?.body));
  assert.equal(result.outcome, 'completed'); assert.equal(body.store, false); assert.equal('previous_response_id' in body, false);
  assert.deepEqual(body.input.slice(-2), [call, { type: 'function_call_output', call_id: call.call_id, output: '{"secondsLeft":30}' }]);
  assert.equal(review!.api!.continuation!.responseId, 'resp-fixture'); assert.equal(review!.api!.continuation!.contextDigest, contextDigest); assert.equal(review!.api!.continuation!.toolOutputs[0].receiptId, 'canonical-read-receipt');
  assert.equal(review!.api!.continuation!.toolOutputs[0].outputDigest, digest('{"secondsLeft":30}'));
  for (const patch of [{ callId: 'other-call' }, { name: 'delete_timer' }, { argumentsDigest: 'f'.repeat(64) }, { receiptId: '' }]) {
    const bad = structuredClone(turn); Object.assign(bad.api!.continuation!.toolOutputs[0], patch); await assert.rejects(f.transport.turn(bad));
  }
  const changed = structuredClone(turn); (changed.api!.continuation! as any).configurationVersion = 4; await assert.rejects(f.transport.turn(changed), /invalid_api_continuation/);
  const injected = structuredClone(turn); (injected.api!.continuation! as any).itemsDigest = 'f'.repeat(64); await assert.rejects(f.transport.turn(injected), /api_continuation_changed/);
  assert.equal(f.requests.length, 1);
});

test('offline unknown function, unbound/mismatched arguments, terminal substitution and hidden hosted tools remain unknown', async () => {
  const added = { type: 'response.output_item.added', output_index: 0, item: { ...call, status: 'in_progress', arguments: '' } };
  const streams = [
    [created, completed([{ ...call, name: 'delete_timer' }])],
    [created, { type: 'response.function_call_arguments.delta', item_id: call.id, output_index: 0, delta: '{}' }],
    [created, added, { type: 'response.function_call_arguments.delta', item_id: call.id, output_index: 1, delta: '{}' }],
    [created, added, { type: 'response.function_call_arguments.delta', item_id: call.id, output_index: 0, delta: '{}' }, { type: 'response.function_call_arguments.done', item_id: call.id, output_index: 0, arguments: call.arguments }],
    [created, { type: 'response.output_item.done', output_index: 0, item: call }, completed([{ ...call, arguments: '{}' }])],
    [created, completed([call, { ...call, id: 'other-item' }])],
    [created, completed([{ type: 'web_search_call', id: 'hosted-tool', status: 'completed' } as any])],
    [created, { type: 'response.mcp_call_arguments.delta', delta: '{}' }],
  ];
  for (const events of streams) { const f = fixture(async () => stream(events)), result = await f.transport.turn(input()); assert.equal(result.outcome, 'unknown'); assert.equal(result.taskVerified, false); assert.equal(f.requests.length, 1); }
  const partial = await fixture(async () => stream([created, added, { type: 'response.function_call_arguments.delta', item_id: call.id, output_index: 0, delta: '{"timerId":' }])).transport.turn(input());
  assert.equal(partial.outcome, 'unknown'); assert.deepEqual(partial.api!.toolCalls, []); assert.equal(partial.cancellation.serverConfirmed, false);
});

test('offline provider reasoning keeps only supported summary/encrypted continuation state, never raw reasoning text', async () => {
  const reasoning = { type: 'reasoning', id: 'reasoning-fixture', summary: [{ type: 'summary_text', text: 'A supported summary.' }], encrypted_content: 'opaque-encrypted-state', content: [{ type: 'reasoning_text', text: 'RAW_PRIVATE_REASONING_MARKER' }] };
  const f = fixture(async () => stream([created, completed([reasoning as any, call])])), result = await f.transport.turn(input());
  assert.equal(result.outcome, 'completed'); assert.equal(result.api!.outputItems[0].type, 'reasoning'); assert.equal(JSON.stringify(result.api!.outputItems).includes('RAW_PRIVATE_REASONING_MARKER'), false);
  assert.equal(JSON.stringify(result.api!.outputItems).includes('opaque-encrypted-state'), true);
});

test('offline streamed done versus terminal items accepts key order and monotonic reasoning metadata without losing encrypted state', async () => {
  const reasoning = { type:'reasoning',id:'reasoning-fixture',summary:[] };
  const richer = { ...reasoning,summary:[{type:'summary_text',text:'A supported summary.'}],encrypted_content:'opaque-encrypted-state' };
  const annotated = { ...message,content:[{type:'output_text',text:'The timer has 30 seconds left.',annotations:[{type:'fixture_annotation',label:'synthetic',value:1}]}] };
  const reordered = { ...annotated,content:[{type:'output_text',text:'The timer has 30 seconds left.',annotations:[{value:1,label:'synthetic',type:'fixture_annotation'}]}] };
  const f=fixture(async()=>stream([created,{type:'response.output_item.done',output_index:0,item:reasoning},
    {type:'response.output_item.done',output_index:1,item:annotated},completed([richer as any,reordered as any])]));
  const result=await f.transport.turn(input()); assert.equal(result.outcome,'completed'); assert.deepEqual(result.api!.outputItems[0],richer);
  const retained=fixture(async()=>stream([created,{type:'response.output_item.done',output_index:0,item:richer},completed([{...richer,encrypted_content:undefined} as any])]));
  const retainedResult=await retained.transport.turn(input()); assert.equal(retainedResult.outcome,'completed');
  assert.equal((retainedResult.api!.outputItems[0] as any).encrypted_content,'opaque-encrypted-state');
});

test('offline terminal enrichment cannot change observed reasoning summaries, message text or function arguments', async () => {
  const reasoning={type:'reasoning',id:'reasoning-fixture',summary:[{type:'summary_text',text:'Observed summary.'}],encrypted_content:'opaque-original'};
  for(const [prior,next,code] of [
    [reasoning,{...reasoning,summary:[{type:'summary_text',text:'Substituted summary.'}]},'api_response_item_changed_reasoning_summary'],
    [message,{...message,content:[{type:'output_text',text:'Substituted answer.',annotations:[]}]},'api_response_item_changed_message_content'],
    [call,{...call,arguments:'{"timerId":"other"}'},'api_response_item_changed_function_call'],
  ] as const) {
    const f=fixture(async()=>stream([created,{type:'response.output_item.done',output_index:0,item:prior},completed([next as any])]));
    const result=await f.transport.turn(input()); assert.equal(result.outcome,'unknown'); assert.equal(result.errorCode,code);
  }
});

test('offline reasoning continuation keeps authoritative item-done ciphertext across added and terminal snapshots', async () => {
  const added = { type:'reasoning',id:'reasoning-fixture',summary:[],encrypted_content:'opaque-in-progress' };
  const done = { ...added,encrypted_content:'opaque-item-done',content:[{type:'reasoning_text',text:'RAW_PRIVATE_REASONING_MARKER'}] };
  const terminal = { ...done,encrypted_content:'opaque-response-snapshot' };
  const firstFixture=fixture(async()=>stream([created,{type:'response.output_item.added',output_index:0,item:added},
    {type:'response.output_item.done',output_index:0,item:done},
    {type:'response.output_item.done',output_index:1,item:call},completed([terminal as any,call])],7));
  const first=await firstFixture.transport.turn(input());
  assert.equal(first.outcome,'completed');assert.equal(firstFixture.requests.length,1);assert.equal(first.api!.toolCalls.length,1);
  assert.deepEqual(first.api!.outputItems[0],{type:'reasoning',id:done.id,summary:[],encrypted_content:done.encrypted_content});
  assert.equal(first.usage!.totalTokens,50);
  const items=first.api!.outputItems,turn:TurnInput={...input(),executionId:'execution-api-2',requestId:'request-api-2',api:{...input().api!,continuation:{
    sourceExecutionId:input().executionId,responseId:first.responseId!,configurationVersion:3,contextDigest,sourceOutcome:'completed',itemsDigest:digest(JSON.stringify(items)),items,
    toolOutputs:[{callId:call.call_id,name:call.name,argumentsDigest:digest(call.arguments),output:'{"secondsLeft":30}',receiptId:'canonical-read-receipt'}]}}};
  const secondFixture=fixture(async()=>stream([created,completed([message])])),second=await secondFixture.transport.turn(turn);
  assert.equal(second.outcome,'completed');assert.equal(secondFixture.requests.length,1);
  const body=String(secondFixture.requests[0].init!.body),wire=JSON.parse(body);
  assert.deepEqual(wire.input.find((item:ApiResponseItem)=>item.type==='reasoning'),items[0]);
  for(const excluded of ['opaque-in-progress','opaque-response-snapshot','RAW_PRIVATE_REASONING_MARKER'])assert.equal(body.includes(excluded),false);
  assert.equal(prepareResponsesTurn(turn).review.api!.continuation!.itemsDigest,digest(JSON.stringify(items)));
});

test('offline conflicting item-done ciphertext and changed terminal identity remain unknown without a callable result', async () => {
  const done={type:'reasoning',id:'reasoning-fixture',summary:[],encrypted_content:'opaque-item-done'};
  for(const [events,code] of [
    [[created,{type:'response.output_item.done',output_index:0,item:done},{type:'response.output_item.done',output_index:0,item:{...done,encrypted_content:'opaque-other-done'}},completed([done as any])],'api_response_item_changed_reasoning_encrypted'],
    [[created,{type:'response.output_item.done',output_index:0,item:done},completed([{...done,id:'foreign-reasoning'} as any])],'api_terminal_items_mismatch'],
    [[created,{type:'response.output_item.done',output_index:0,item:done},completed([{...message,id:done.id}])],'api_response_item_changed_identity'],
  ] as const){
    const f=fixture(async()=>stream([...events])),result=await f.transport.turn(input());
    assert.equal(result.outcome,'unknown');assert.equal(result.errorCode,code);assert.equal(result.taskVerified,false);assert.equal(f.requests.length,1);assert.deepEqual(result.api!.toolCalls,[]);
  }
});

test('offline token-limited function arguments stay incomplete and never become a callable host action', async () => {
  const partial = { ...call, status: 'incomplete', arguments: '{"timerId":' };
  const f = fixture(async () => stream([created, { type: 'response.output_item.done', output_index: 0, item: partial }, { type: 'response.incomplete', response: { id: 'resp-fixture', status: 'incomplete', output: [partial], incomplete_details: { reason: 'max_output_tokens' } } }]));
  const result = await f.transport.turn(input()); assert.equal(result.outcome, 'incomplete'); assert.equal(result.incompleteReason, 'max_output_tokens'); assert.deepEqual(result.api!.toolCalls, []); assert.equal(f.events.some(event => event.type === 'provider/function-call'), false);
});

test('offline foreground store:false cannot retrieve/cancel/replay; stored foreground still cannot claim server cancellation', async () => {
  const f = fixture(); const result = await f.transport.turn(input());
  assert.equal((await f.transport.retrieve(result.api!.recovery)).reason, 'not-retained'); assert.equal((await f.transport.cancel(result.api!.recovery)).reason, 'not-retained'); assert.equal(f.requests.length, 1);
  assert.equal((await f.transport.cancel(recovery())).reason, 'not-background'); assert.equal(f.requests.length, 1);
  const absent = { ...recovery(), responseId: undefined }; assert.equal((await f.transport.retrieve(absent)).reason, 'response-id-unavailable');
});

test('offline explicit retention/background fields remain reviewed even with store:false temporary provider retention', async () => {
  const turn: TurnInput = { ...input(), api: { ...input().api!, retention: { store: false, background: true, authorizationRef: 'explicit-background-retention-review' } } };
  const f = fixture(), result = await f.transport.turn(turn), body = JSON.parse(String(f.requests[0].init?.body));
  assert.equal(body.store, false); assert.equal(body.background, true); assert.equal(result.api!.recovery.retention!.authorizationRef, 'explicit-background-retention-review'); assert.equal(result.api!.recovery.boundaryDigest, boundary);
  assert.equal('authorizationRef' in body, false); assert.equal(result.cancellation.serverConfirmed, false);
});

test('offline retained response retrieval binds exact GET to original durable execution and revalidates before trusting output', async () => {
  let fences = 0; const reviews: DispatchReview[] = [];
  const f = fixture(async (url, init) => { assert.equal(url, RESPONSES_ENDPOINT + '/resp-fixture'); assert.equal(init?.method, 'GET'); assert.equal(init?.body, undefined); assert.equal(init?.redirect, 'error'); assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer SYNTHETIC_API_KEY'); return Response.json(snapshot()); }, native({ authorize: async review => { reviews.push(review); }, revalidate: async () => { fences++; } }));
  const result = await f.transport.retrieve(recovery());
  assert.equal(result.state, 'observed'); assert.equal(result.responseStatus, 'completed'); assert.equal(result.partialText, 'The timer has 30 seconds left.'); assert.equal(result.usage!.totalTokens, 5); assert.equal(result.taskVerified, false); assert.equal(result.serverCancellationConfirmed, false); assert.equal(fences, 2);
  assert.equal(reviews[0].recovery!.originalBodyDigest, 'c'.repeat(64)); assert.equal(reviews[0].recovery!.responseId, 'resp-fixture'); assert.equal(reviews[0].recovery!.operation, 'retrieve'); assert.equal(reviews[0].api!.configurationVersion, 3); assert.equal(f.requests.length, 1);
});

test('offline background cancel reports server confirmation only for observed matching cancelled state', async () => {
  const reference = recovery({ store: false, background: true, authorizationRef: 'background-retention' });
  for (const status of ['cancelled', 'completed']) {
    const f = fixture(async (url, init) => { assert.equal(url, RESPONSES_ENDPOINT + '/resp-fixture/cancel'); assert.equal(init?.method, 'POST'); assert.equal(init?.body, undefined); return Response.json(snapshot({ status, background: true })); });
    const result = await f.transport.cancel(reference); assert.equal(result.state, 'observed'); assert.equal(result.serverCancellationConfirmed, status === 'cancelled'); assert.equal(result.responseStatus, status); assert.equal(f.requests.length, 1);
  }
  const mismatch = await fixture(async () => Response.json(snapshot({ id: 'other-response', status: 'cancelled', background: true }))).transport.cancel(reference);
  assert.equal(mismatch.state, 'unknown'); assert.equal(mismatch.serverCancellationConfirmed, false);
  const serverFailure = fixture(async () => Response.json({ error: 'SYNTHETIC_API_KEY raw body' }, { status: 503 })), failure = await serverFailure.transport.cancel(reference);
  assert.equal(failure.state, 'unknown'); assert.equal(failure.serverCancellationConfirmed, false); assert.ok(!JSON.stringify(failure).includes('SYNTHETIC_API_KEY')); assert.equal(serverFailure.requests.length, 1);
});

test('offline polling an in-progress retained function response observes pending state without exposing a callable partial result', async () => {
  const f = fixture(async () => Response.json(snapshot({ status: 'in_progress', output: [{ ...call, status: 'in_progress', arguments: '{"timerId":' }] })));
  const result = await f.transport.retrieve(recovery()); assert.equal(result.state, 'observed'); assert.equal(result.responseStatus, 'in_progress'); assert.deepEqual(result.toolCalls, []); assert.deepEqual(result.outputItems, []); assert.equal(result.serverCancellationConfirmed, false);
});

test('offline recovery denies stale credential/policy and post-fetch revocation, abort and timeout without retries', async () => {
  const denied = fixture(undefined, native({ revalidate: async () => { throw Error('SYNTHETIC_API_KEY revoked'); } }));
  const before = await denied.transport.retrieve(recovery()); assert.equal(before.dispatched, false); assert.equal(before.state, 'failed'); assert.equal(denied.requests.length, 0); assert.ok(!JSON.stringify(before).includes('SYNTHETIC_API_KEY'));
  const wrongBoundary = fixture(); const changed = await wrongBoundary.transport.retrieve({ ...recovery(), boundaryDigest: 'f'.repeat(64) }); assert.equal(changed.dispatched, false); assert.equal(wrongBoundary.requests.length, 0);
  let fences = 0;
  const after = await fixture(async () => Response.json(snapshot()), native({ revalidate: async () => { if (++fences === 2) throw Error('revoked'); } })).transport.retrieve(recovery()); assert.equal(after.state, 'unknown'); assert.equal(after.serverCancellationConfirmed, false);
  const aborted = new AbortController(); aborted.abort(); const pre = fixture(); const cancelled = await pre.transport.retrieve(recovery(), aborted.signal); assert.equal(cancelled.dispatched, false); assert.equal(pre.requests.length, 0);
  const timer = setTimeout(() => {}, 100);
  try { const slow = fixture(async () => new Promise(() => {}), native(), { timeoutMs: 10 }), timedOut = await slow.transport.retrieve(recovery()); assert.equal(timedOut.state, 'unknown'); assert.equal(timedOut.errorCode, 'provider_timeout'); assert.equal(slow.requests.length, 1); }
  finally { clearTimeout(timer); }
  await assert.rejects(fixture().transport.retrieve({ ...recovery(), providerId: 'chatgpt-plan-responses' } as any), /invalid_api_recovery/);
});
