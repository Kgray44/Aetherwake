import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {VelaApiRuntime} from '../src/vela-api-runtime.mts';
import {apiRunDiagnostics} from '../src/api-run-diagnostics.mts';
import {observeConversationProvider} from '../src/execution-profiler.mts';
import {WEATHER_TOOL_NAME,WEATHER_TOOL,type WeatherQuery} from '../src/weather-tool.mts';
import {readWeatherData} from '../src/weather-data.mts';
import {VELA_TOOL_SCHEMAS,VELA_TOOL_INVOKE} from '../src/vela-semantic-tools.mts';
import {createCapabilityCatalog} from '../../vela-core/src/capability-catalog.mts';
import {CAPABILITIES} from '../../vela-core/src/capabilities.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { BackendCore } from '../src/core.mts';
import { NativePersonalMemory } from '../src/personal-memory.mts';
import { createPersonalMemoryReview } from '../src/personal-memory-review.mts';
import type { PersonalScope } from '../../personal-context/src/contracts.ts';
import type { NativeHostServices } from '../src/native-host.mts';
import type { VelaRequest, VelaState } from '../../vela-core/src/contracts.ts';
import type { StreamEvent } from '../src/contracts.mts';
const marker = 'SYNTHETIC_ONLY_VELA_API_RUNTIME_CREDENTIAL';
const message = (content: string) => ({ type: 'message', id: 'msg-fixture', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: content, annotations: [] }] });
function response(content: string, id = 'resp-fixture', output = [message(content)], outcome = 'completed',
  deltas = content ? [content] : []) {
  const events = [{ type: 'response.created', response: { id, status: 'in_progress' } },
    ...deltas.map(delta => ({ type: 'response.output_text.delta', delta })),
    { type: outcome === 'completed' ? 'response.completed' : 'response.incomplete', response: { id, status: outcome, model: 'gpt-6-luna', output,
      ...(outcome === 'incomplete' ? { incomplete_details: { reason: 'max_output_tokens' } } : {}), usage: { input_tokens: 20, output_tokens: 8, total_tokens: 28 } } }];
  return new Response(events.map(event => 'data: '+JSON.stringify(event)+'\n\n').join(''),{headers:{'Content-Type':'text/event-stream'}});
}

test('conversation timing retains only the first nonblank provider output milestone and its kind', () => {
  const timing = observeConversationProvider('ordinary-adapter-entry', true, 'request-fixture');
  const identity = { providerId: 'chatgpt-plan-responses' as const, executionId: 'execution-fixture' };
  timing.observe({ ...identity, type: 'provider/text-delta', delta: ' \n\t' });
  const blank = timing.settlement();
  assert.notEqual(blank.firstTextDeltaMs, null);
  assert.equal(blank.firstNonblankOutput, null);
  timing.observe({ ...identity, type: 'provider/refusal-delta', delta: 'SYNTHETIC_REFUSAL' });
  const first = timing.settlement().firstNonblankOutput;
  assert.ok(first && first.elapsedMs >= blank.settlementStagedMs);
  assert.equal(first.kind, 'refusal');
  timing.observe({ ...identity, type: 'provider/text-delta', delta: 'SYNTHETIC_TEXT' });
  assert.deepEqual(timing.settlement().firstNonblankOutput, first);
  assert.doesNotMatch(JSON.stringify(timing.settlement()), /SYNTHETIC_/u);
});

test('conversation timing joins only a preview that finished in the same clock domain', () => {
  const clock = { domain: 'domain-fixture', startedMs: 10, readyMs: 20 };
  const observe = (domain: string, started: number) => observeConversationProvider(
    'reviewed-api-dispatch-staging', true, 'request-fixture', started,
    { domain, preview: { id: 'preview-fixture', clock } });
  const linked = observe(clock.domain, 30).settlement().fromPreview;
  assert.deepEqual(linked, { id: 'preview-fixture', toAdapterMs: 20, toFirstNonblankOutputMs: null });
  assert.equal(observe('after-restart', 30).settlement().fromPreview, undefined);
  assert.equal(observe(clock.domain, 19).settlement().fromPreview, undefined);
});
function fixture() {
  const base = resolve(tmpdir()), dir = mkdtempSync(join(base,'aerynth-api-runtime-')), path = join(dir,'canonical.sqlite'), requests: any[] = [], events: StreamEvent[] = [], replies: ((body:any)=>Response|Promise<Response>)[] = [];
  const encryptionKey = randomBytes(32);
  const nativeHost: NativeHostServices = { secrets: {
    available: async () => true,
    seal: async text => { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm',encryptionKey,iv); return Buffer.concat([iv,cipher.update(text),cipher.final(),cipher.getAuthTag()]); },
    open: async bytes => { const data = Buffer.from(bytes), cipher = createDecipheriv('aes-256-gcm',encryptionKey,data.subarray(0,12)); cipher.setAuthTag(data.subarray(-16)); return Buffer.concat([cipher.update(data.subarray(12,-16)),cipher.final()]).toString(); },
  } };
  const api = { fetch: (async (url,init) => {
    if (url === 'https://api.openai.com/v1/models') return Response.json({data:[{id:'gpt-6-luna'},{id:'gpt-6.1-sol'}]});
    assert.equal(url,'https://api.openai.com/v1/responses');
    assert.equal(new Headers(init?.headers).get('authorization'),'Bearer '+marker);
    const body = JSON.parse(String(init?.body)); requests.push(body); const reply = replies.shift(); assert.ok(reply,'unexpected API inference'); return reply(body);
  }) as typeof fetch };
  let core: BackendCore;
  const create = () => new BackendCore({path,provider:'fixture',contentPolicy:'synthetic-only'},event=>events.push(event),nativeHost,undefined,api);
  core = create();
  return { get core() { return core; }, requests, replies, events,
    async configure() { return core.command('velaApiConfigure',{credential:{configurationId:'vela-primary',apiKey:marker},expectedVersion:null}); },
    async authorize() { return core.command('velaApiUsageAuthorize',{expectedVersion:1,enabled:true}); },
    async send(intent: string, extra: Record<string,unknown> = {}): Promise<VelaRequest> {
      const preview = await core.command('velaRequestPreview',{intent,resourceIds:[],adaptive:true,...extra});
      const review = await core.command('velaNativeReview',{previewId:preview.id,signature:preview.signature});
      const grant = await core.command('authorizeVelaRequest',{previewId:preview.id,signature:preview.signature,reviewDigest:review.reviewDigest,...(preview.sendDisposition==='routine'?{directSend:true}:{})});
      return core.command('vela',{name:'request',input:{intent,resourceIds:[],authorizeProvider:true,previewId:preview.id,grantId:grant.grantId}}) as Promise<VelaRequest>;
    },
    async reopen() { await core.command('close',{}); core = create(); },
    async close() { if(!(core as any).closed) await core.command('close',{}); const part=relative(base,resolve(dir)); assert.ok(part.startsWith('aerynth-api-runtime-')&&!part.startsWith('..')&&!isAbsolute(part)); rmSync(dir,{recursive:true,force:true}); },
  };
}

const weatherQuery:WeatherQuery={startDate:null,endDate:null,period:'tomorrow',metrics:['temperature','humidity'],aggregation:'range'};
const weatherCall=(query:unknown=weatherQuery,id='resp-weather',callId='call-weather')=>response('',id,[{type:'function_call',id:'fc-'+callId,call_id:callId,name:WEATHER_TOOL_NAME,arguments:JSON.stringify(query),status:'completed'}] as any);
const unavailableWeather=()=>readWeatherData(weatherQuery,new AbortController().signal,{authorize(){throw Error('location_os_denied');},locate:async()=>{throw Error('unexpected_location');},fetch:async()=>{throw Error('unexpected_weather_network');}});

test('Vela Core binds approved memory to its canonical request and exact transport', async () => {
  const f = fixture();
  try {
    await f.configure();
    await f.authorize();
    const state = await f.core.command('vela', { name: 'open', input: {} }) as VelaState;
    const conversationId = state.conversation!.resourceId;
    const project = (await f.core.command('desktop', { type: 'createProject', title: 'Synthetic relay project' })).projects[0];
    const workspace = (await f.core.command('desktop', { type: 'createWorkspace', title: 'Synthetic memory workspace', projectId: project.id })).workspaces[0];
    await f.core.command('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId: workspace.id } });
    const body = 'Use the synthetic quartz relay.';
    const source = { conversationId: 'source-chat', messageId: 'source-message', projectId: project.id,
      role: 'user' as const, sensitive: false, version: '1', contentDigest: createHash('sha256').update(body).digest('hex') };
    const sources = { resolveScope: (scope: PersonalScope) => ({ scope, version: '1' }), resolveConversationSource: () => source };
    const kernel = (f.core as any).kernel;
    const review = createPersonalMemoryReview({ ...sources, transaction: kernel.withTransaction.bind(kernel),
      open: () => owner.open(), readSourceText: () => body,
      resolveVelaRecallTarget: () => ({ conversationId, projectId: project.id }) });
    let key: string;
    const owner = new NativePersonalMemory({ kernel,
      secrets: { available: async () => true, async seal(value) { key = value; return randomBytes(64); }, async open() { return key; } },
      host: { ...sources, identity: () => ({ userId: 'synthetic', policyVersion: '1' }),
        authorize: input => review.authorize(input) ? { decision: 'allow', policyVersion: '1', authorizationRef: 'synthetic-review' } : { decision: 'deny' } } });
    Object.assign(f.core, { personalMemoryReview: review, personalMemory: owner });
    const saved = await review.commitCapture(await review.previewCapture({ conversationId: source.conversationId, messageId: source.messageId,
      text: body, scope: 'project', category: 'decisions', keywords: ['quartz'] }));
    const settings = await f.core.command('personalMemoryPolicyNative', {});
    await f.core.command('personalMemoryPolicyNative', { assistant: 'vela', enable: true, expectedVersion: settings.version });
    const intent = 'Which quartz relay should I use?';
    const preview = await f.core.command('velaRequestPreview', { intent, resourceIds: [], adaptive: true, providerId: 'openai-api-vela', useMemory: true });
    assert.equal(preview.sendDisposition, 'review-required');
    const binding = { previewId: preview.id, signature: preview.signature };
    const nativeReview = await f.core.command('velaNativeReview', binding);
    assert.deepEqual(nativeReview.memory, preview.memory);
    assert.match(nativeReview.prompt, /Use the synthetic quartz relay/);
    await assert.rejects(f.core.command('authorizeVelaRequest', { ...binding, reviewDigest: nativeReview.reviewDigest, directSend: true }), /review_required/);
    const grant = await f.core.command('authorizeVelaRequest', { ...binding, reviewDigest: nativeReview.reviewDigest });
    f.replies.push(request => {
      assert.deepEqual(request.input, [{ role: 'user', content: nativeReview.prompt }]);
      assert.equal(request.tools, undefined);
      return response('Synthetic relay answer.');
    });
    const result = await f.core.command('vela', { name: 'request', input: { intent, resourceIds: [], authorizeProvider: true, previewId: preview.id, grantId: grant.grantId } }) as VelaRequest;
    assert.equal(result.id, preview.id);
    assert.equal(result.state, 'responded');
    const followup = await f.core.command('velaRequestPreview', { intent: 'Could you explain that?', resourceIds: [], adaptive: true,
      providerId: 'openai-api-vela', includeRecentHistory: true });
    const followupReview = await f.core.command('velaNativeReview', { previewId: followup.id, signature: followup.signature });
    assert.doesNotMatch(followupReview.prompt, /Synthetic relay answer/);
    const pending = await f.core.command('velaRequestPreview', { intent, resourceIds: [], adaptive: true, providerId: 'openai-api-vela', useMemory: true });
    const pendingBinding = { previewId: pending.id, signature: pending.signature };
    const pendingReview = await f.core.command('velaNativeReview', pendingBinding);
    const pendingGrant = await f.core.command('authorizeVelaRequest', { ...pendingBinding, reviewDigest: pendingReview.reviewDigest });
    await review.commitManagement(await review.previewManagement({ action: 'revoke', id: saved.id, version: saved.version }));
    await assert.rejects(f.core.command('vela', { name: 'request', input: {
      intent, resourceIds: [], authorizeProvider: true, previewId: pending.id, grantId: pendingGrant.grantId,
    } }), /stale_personal_context/);
    assert.equal(f.requests.length, 1);
  } finally { await f.close(); }
});

test('Vela memory transport binds one reviewed user prompt and forbids tool continuations', async () => {
  const f = fixture();
  try {
    await f.configure();
    await f.authorize();
    const runtime = (f.core as any).velaApiRuntime as VelaApiRuntime;
    await runtime.models(1);
    const requestId = 'synthetic-vela-memory';
    const prompt = 'Which relay?\nQuoted personalization: synthetic relay.';
    let current = false;
    const memory = { requestId, promptDigest: createHash('sha256').update(prompt).digest('hex'), validate(value: string) {
      assert.equal(value, prompt);
      if (!current) throw Error('stale_personal_context');
      return 'synthetic-memory-grant';
    } };
    const input = { requestId, version: 1, model: 'gpt-6-luna', prompt, contextDigest: 'a'.repeat(64), memory, validate() {} };
    const signal = new AbortController().signal;
    await assert.rejects(runtime.run(input, signal), /stale_personal_context/);
    current = true;
    await assert.rejects(runtime.run({ ...input, prompt: prompt + ' altered' }, signal), /vela_memory_request_mismatch/);
    await assert.rejects(runtime.run({ ...input, requestId: requestId + '-foreign' }, signal), /vela_memory_request_mismatch/);
    await assert.rejects(runtime.run({ ...input, weatherTool: { async run() { throw Error('unexpected weather'); } } }, signal), /vela_memory_requires_conversation/);
    const connection = (f.core as any).velaApiConnection as import('../src/vela-api-connection.mts').VelaApiConnection;
    const revalidate = connection.revalidate.bind(connection);
    connection.revalidate = async (...args) => {
      await revalidate(...args);
      current = false;
    };
    try {
      const result = await runtime.run(input, signal);
      assert.notEqual(result.result.outcome, 'completed');
    } finally { connection.revalidate = revalidate; }
    assert.equal(f.requests.length, 0);
    current = true;
    const freshId = requestId + '-fresh-review';
    const fresh = { ...input, requestId: freshId, memory: { ...memory, requestId: freshId } };
    f.replies.push(body => {
      assert.deepEqual(body.input, [{ role: 'user', content: prompt }]);
      assert(!body.instructions.includes('synthetic relay'));
      assert.equal(body.tools, undefined);
      assert.equal(body.store, false);
      return response('Synthetic reply');
    });
    assert.equal((await runtime.run(fresh, signal)).result.outcome, 'completed');
    await assert.rejects(runtime.run(fresh, signal), /api_execution_already_dispatched/);
    assert.equal(f.requests.length, 1);
  } finally { await f.close(); }
});

test('model-requested current weather forwards actual native-reader temperature and humidity data with coordinates confined to the weather source',async()=>{
 const f=fixture();try{await f.configure();await f.authorize();const runtime=(f.core as any).velaApiRuntime as VelaApiRuntime;await runtime.models(1);const query:WeatherQuery={startDate:null,endDate:null,period:'current',metrics:['temperature','humidity'],aggregation:'current'},sourceRequests:string[]=[],now=()=>new Date('2026-11-04T12:30:00Z');let authorizations=0;
  const source:typeof fetch=async url=>{sourceRequests.push(String(url));if(String(url).includes('/points/'))return Response.json({properties:{timeZone:'UTC',forecastHourly:'https://api.weather.gov/gridpoints/BTV/100,30/forecast/hourly'}});return Response.json({properties:{generatedAt:'2026-11-04T12:00:00Z',periods:[{startTime:'2026-11-04T12:00:00Z',endTime:'2026-11-04T13:00:00Z',temperature:55,temperatureUnit:'F',relativeHumidity:{unitCode:'wmoUnit:percent',value:61}}]}});};
  f.replies.push(()=>weatherCall(query),body=>{const data=JSON.parse(body.input.find((item:any)=>item.type==='function_call_output').output);assert.equal(data.status,'complete');assert.equal(data.current.values.temperature.mean,55);assert.equal(data.current.values.humidity.mean,61);assert(!JSON.stringify(body).includes('43.46'));assert(!JSON.stringify(body).includes('-72.39'));assert(!JSON.stringify(data).includes('forecastHourly'));return response('Current hour forecast: 55°F and 61% humidity.','resp-current-weather-answer');});
  const run=await runtime.run({requestId:'synthetic-current-weather',version:1,model:'gpt-6-luna',prompt:'Synthetic natural weather question',contextDigest:'a'.repeat(64),weatherTool:{run:(input,signal)=>readWeatherData(input,signal,{locate:async input=>({latitude:43.45827,longitude:-72.38753,observedAtMs:input.requestedAtMs,source:'wifi'}),authorize(){authorizations++;},fetch:source,now})},validate(){}},new AbortController().signal);
  assert.equal(run.result.outcome,'completed');assert.equal(sourceRequests.length,2);assert.equal(sourceRequests[0],'https://api.weather.gov/points/43.46,-72.39');assert(authorizations>=4);assert.equal(f.requests.length,2);
 }finally{await f.close();}
});

test('optional native weather tool uses exact reviewed definition and receipt-bound continuation without implicit source authority',async()=>{
 const f=fixture();try{await f.configure();await f.authorize();const runtime=(f.core as any).velaApiRuntime as VelaApiRuntime;await runtime.models(1);const data=await unavailableWeather();let calls=0;
  f.replies.push(body=>{assert.deepEqual(body.tools,[WEATHER_TOOL.definition]);assert.equal(body.parallel_tool_calls,false);assert(!JSON.stringify(body).includes('latitude'));return weatherCall();},body=>{const output=body.input.find((item:any)=>item.type==='function_call_output');assert(output);assert.deepEqual(JSON.parse(output.output),data);assert.equal(body.store,false);return response('Windows did not authorize a fresh forecast; I cannot report current conditions.','resp-weather-answer');});
  const {result}=await runtime.run({requestId:'synthetic-weather-loop',version:1,model:'gpt-6-luna',prompt:'Synthetic question about outside temperature and humidity tomorrow.',contextDigest:'b'.repeat(64),weatherTool:{async run(query,signal){calls++;assert.deepEqual(query,weatherQuery);assert(!signal.aborted);return data;}},validate(){}},new AbortController().signal);
  assert.equal(result.outcome,'completed');assert.equal(calls,1);assert.equal(f.requests.length,2);const db=(f.core as any).db,receipt=db.prepare('SELECT arguments_digest,output_digest FROM vela_api_tool_receipts').get();assert.equal(receipt.arguments_digest,createHash('sha256').update(JSON.stringify(weatherQuery)).digest('hex'));assert.equal(receipt.output_digest,createHash('sha256').update(JSON.stringify(data)).digest('hex'));assert.equal((await f.core.command('velaApiUsageStatus',{})).usedToday,2);
 }finally{await f.close();}
});

test('weather tool is not available to mission workers and rejects extra authority, invalid output, and an unreviewed function',async()=>{
 for(const kind of ['mission','arguments','output','missing'] as const){const f=fixture();try{await f.configure();await f.authorize();const runtime=(f.core as any).velaApiRuntime as VelaApiRuntime;await runtime.models(1);let calls=0;const data=await unavailableWeather();
  const weatherTool={async run(){calls++;return kind==='output'?{...data,latitude:43} as any:data;}};
  const input={requestId:'synthetic-weather-negative-'+kind,version:1,model:'gpt-6-luna',prompt:'Synthetic weather request',contextDigest:'c'.repeat(64),...(kind==='missing'?{}:{weatherTool}),...(kind==='mission'?{lane:'mission-specialist' as const}:{}),validate(){}};
  if(kind==='mission'){await assert.rejects(runtime.run(input,new AbortController().signal),/weather_tool_not_allowed_for_mission/);assert.equal(f.requests.length,0);}
  else{f.replies.push(()=>weatherCall(kind==='arguments'?{...weatherQuery,latitude:43}:weatherQuery));if(kind==='missing'){const run=await runtime.run(input,new AbortController().signal);assert.equal(run.result.outcome,'unknown');assert.equal(run.result.errorCode,'unreviewed_api_function');}else await assert.rejects(runtime.run(input,new AbortController().signal));assert.equal(f.requests.length,1);}
  assert.equal(calls,kind==='output'?1:0);assert.equal((f.core as any).db.prepare('SELECT count(*) AS n FROM vela_api_tool_receipts').get().n,0);
 }finally{await f.close();}}
});

test('weather host cancellation and usage revocation prevent a continuation even when the native port ignores its signal',async()=>{
 for(const revoke of [false,true]){const f=fixture();try{await f.configure();await f.authorize();const runtime=(f.core as any).velaApiRuntime as VelaApiRuntime;await runtime.models(1);const data=await unavailableWeather(),controller=new AbortController();let release!:(value:typeof data)=>void,entered!:()=>void;const ready=new Promise<void>(resolve=>{entered=resolve;});f.replies.push(()=>weatherCall());
  const running=runtime.run({requestId:'synthetic-weather-interruption',version:1,model:'gpt-6-luna',prompt:'Synthetic weather',contextDigest:'d'.repeat(64),weatherTool:{async run(){entered();return new Promise(resolve=>{release=resolve;});}},validate(){}},controller.signal);await ready;
  if(revoke)await f.core.command('velaApiUsageAuthorize',{expectedVersion:1,enabled:false});else controller.abort();release(data);await assert.rejects(running,/vela_execution_cancelled|vela_api_usage_authorization_required/);assert.equal(f.requests.length,1);assert.equal((f.core as any).db.prepare('SELECT count(*) AS n FROM vela_api_tool_receipts').get().n,0);
 }finally{await f.close();}}
});

test('weather calls share the unchanged four-stage and three-native-call ceiling',async()=>{
 const f=fixture();try{await f.configure();await f.authorize();const runtime=(f.core as any).velaApiRuntime as VelaApiRuntime;await runtime.models(1);const data=await unavailableWeather();let calls=0;for(let index=0;index<4;index++)f.replies.push(()=>weatherCall(weatherQuery,'resp-weather-loop-'+index,'call-weather-loop-'+index));
  await assert.rejects(runtime.run({requestId:'synthetic-weather-stage-limit',version:1,model:'gpt-6-luna',prompt:'Synthetic weather repeated tool request',contextDigest:'e'.repeat(64),weatherTool:{async run(){calls++;return data;}},validate(){}},new AbortController().signal),/api_tool_call_limit/);assert.equal(f.requests.length,4);assert.equal(calls,3);assert.equal((f.core as any).db.prepare('SELECT count(*) AS n FROM vela_api_tool_receipts').get().n,3);
 }finally{await f.close();}
});

test('weather tool outputs cannot replay a call ID and structured planning uses the same optional native port',async()=>{
 const duplicate=fixture();try{await duplicate.configure();await duplicate.authorize();const runtime=(duplicate.core as any).velaApiRuntime as VelaApiRuntime;await runtime.models(1);const data=await unavailableWeather();let calls=0;duplicate.replies.push(()=>weatherCall(),()=>weatherCall(weatherQuery,'resp-duplicate-weather'));
  await assert.rejects(runtime.run({requestId:'synthetic-weather-duplicate',version:1,model:'gpt-6-luna',prompt:'Synthetic repeated call ID',contextDigest:'f'.repeat(64),weatherTool:{async run(){calls++;return data;}},validate(){}},new AbortController().signal),/api_tool_call_limit/);assert.equal(calls,1);assert.equal(duplicate.requests.length,2);
 }finally{await duplicate.close();}
 const planning=fixture();try{await planning.configure();await planning.authorize();const runtime=(planning.core as any).velaApiRuntime as VelaApiRuntime,data=await unavailableWeather();let calls=0;planning.replies.push(body=>{assert.equal(body.text.format.name,'vela_scoped_proposal');return weatherCall();},body=>{assert(body.input.some((item:any)=>item.type==='function_call_output'));return response('{"summary":"Authorized weather unavailable"}','resp-weather-plan');});
  const result=await runtime.structuredProposal({requestId:'synthetic-weather-planning',instruction:'Use weather data only when the reviewed native tool returns it.',payload:{intent:'Synthetic weather-aware planning'},schema:{type:'object',properties:{summary:{type:'string'}},required:['summary'],additionalProperties:false},weatherTool:{async run(){calls++;return data;}},validate(){}},new AbortController().signal);assert.deepEqual(result,{summary:'Authorized weather unavailable'});assert.equal(calls,1);assert.equal(planning.requests.length,2);
 }finally{await planning.close();}
});

test('actual runtime persists exact bounded SSE failure diagnostics and never replays an unknown request after restart',async()=>{
 const f=fixture();try{
  await f.configure();await f.authorize();let runtime=(f.core as any).velaApiRuntime as VelaApiRuntime;await runtime.models(1);
  const cases=[
   {id:'missing-terminal',code:'stream_terminal_unobserved',tail:'data: '+JSON.stringify({type:'response.output_text.delta',delta:'Synthetic partial'})+'\n\n'},
   {id:'malformed-json',code:'invalid_stream_json',tail:'data: {not-json\n\n'},
   {id:'changed-id',code:'response_identity_mismatch',tail:'data: '+JSON.stringify({type:'response.completed',response:{id:'different-response',status:'completed',output:[]}})+'\n\n'},
   {id:'unsupported-output',code:'unsupported_provider_output',tail:'data: '+JSON.stringify({type:'response.output_item.added',item:{id:'unreviewed',type:'computer_call'}})+'\n\n'},
  ];
  for(const item of cases){
   await runtime.models(1);
   f.replies.push(()=>new Response('data: '+JSON.stringify({type:'response.created',response:{id:'resp-'+item.id,status:'in_progress'}})+'\n\n'+item.tail,{headers:{'Content-Type':'text/event-stream','x-request-id':'req_synthetic_diagnostic'}}));
   const prompt='Synthetic failure diagnostics '+item.id,input={requestId:item.id,version:1,model:'gpt-6-luna',prompt,contextDigest:createHash('sha256').update(prompt).digest('hex'),oneUse:true as const,validate(){}};
   const run=await runtime.run(input,new AbortController().signal);assert.equal(run.result.outcome,'unknown');assert.equal(run.result.errorCode,item.code);
   const receipt=runtime.receiptsForRequest(item.id)[0];assert.equal(receipt.errorCode,item.code);assert.equal(receipt.state,'unknown');assert.equal(receipt.httpDiagnostic?.httpStatus,200);assert.equal(receipt.httpDiagnostic?.contentType,'event-stream');assert.equal(receipt.httpDiagnostic?.serverRequestId,'req_synthetic_diagnostic');assert(!Object.hasOwn(receipt,'partialText'));
   await f.reopen();runtime=(f.core as any).velaApiRuntime;assert.equal(runtime.receiptsForRequest(item.id)[0].errorCode,item.code);await assert.rejects(runtime.run(input,new AbortController().signal),/api_execution_already_dispatched/);
  }
  assert.equal(f.requests.length,cases.length);
 }finally{await f.close();}
});

test('HTTP rejection persists only bodyless diagnostics and known remote error enum, with no error body or secret text',async()=>{
 const f=fixture();try{await f.configure();await f.authorize();const runtime=(f.core as any).velaApiRuntime as VelaApiRuntime;await runtime.models(1);
  f.replies.push(()=>Response.json({error:{code:'rate_limit_exceeded',message:'SYNTHETIC_PRIVATE_BODY '+marker,account:'SYNTHETIC_PRIVATE_ACCOUNT'}},{status:429,headers:{'x-request-id':'req_synthetic_rate_limit'}}));
  const run=await runtime.run({requestId:'synthetic-http-failure',version:1,model:'gpt-6-luna',prompt:'Synthetic HTTP failure',contextDigest:'a'.repeat(64),validate(){}},new AbortController().signal);
  assert.equal(run.result.outcome,'failed');const receipt=runtime.receiptsForRequest('synthetic-http-failure')[0];assert.equal(receipt.errorCode,'rate_limit_exceeded');assert.equal(receipt.httpDiagnostic?.httpStatus,429);assert.equal(receipt.httpDiagnostic?.remoteCode,'rate_limit_exceeded');const stored=(f.core as any).db.prepare('SELECT error_code,http_diagnostic_json FROM vela_api_runs').get();assert(!JSON.stringify({stored,receipt}).includes('SYNTHETIC_PRIVATE'));assert(!JSON.stringify({stored,receipt}).includes(marker));
 }finally{await f.close();}
});

test('diagnostic migration preserves old receipts and marks only interrupted dispatches with a local interruption code',()=>{
 const db=new DatabaseSync(':memory:');try{db.exec("CREATE TABLE vela_api_runs(execution_id TEXT PRIMARY KEY,request_id TEXT NOT NULL,configuration_version INTEGER NOT NULL,utc_day TEXT NOT NULL,body_digest TEXT NOT NULL,context_digest TEXT NOT NULL,state TEXT NOT NULL,result_digest TEXT,response_id TEXT,usage_json TEXT,elapsed_ms INTEGER);INSERT INTO vela_api_runs(execution_id,request_id,configuration_version,utc_day,body_digest,context_digest,state)VALUES('old','old',1,'2000-01-01','body','context','unknown'),('interrupted','interrupted',1,'2000-01-01','body','context','dispatching');BEGIN");VelaApiRuntime.migrate(db);VelaApiRuntime.migrate(db);db.exec('COMMIT');const rows=db.prepare('SELECT execution_id,state,error_code FROM vela_api_runs ORDER BY execution_id').all();assert.deepEqual(rows.map(row=>({...row})),[{execution_id:'interrupted',state:'unknown',error_code:'api_process_interrupted'},{execution_id:'old',state:'unknown',error_code:null}]);}finally{db.close();}
});

test('diagnostic projection uses fixed enums, strips raw fields, and never invokes arbitrary getters',()=>{
 const diagnostic={contract:'aerynth.turn-http-diagnostic@1',httpStatus:200,contentType:'event-stream',hasBody:true,serverRequestId:'not a safe ID',bodyShape:'unavailable',remoteCode:'SYNTHETIC_PRIVATE_ACCOUNT',body:'SYNTHETIC_PRIVATE_BODY',headers:{authorization:marker}};
 const result=apiRunDiagnostics({errorCode:'synthetic_private_account',httpDiagnostic:diagnostic});assert.equal(result.errorCode,'provider_failed');assert.equal(result.httpDiagnostic?.serverRequestId,null);assert.equal(result.httpDiagnostic?.remoteCode,null);assert(!JSON.stringify(result).includes('SYNTHETIC_PRIVATE'));assert(!JSON.stringify(result).includes(marker));assert.deepEqual(apiRunDiagnostics(Object.defineProperty({},'httpDiagnostic',{get(){throw Error('getter invoked');}})),{});
 assert.deepEqual(apiRunDiagnostics({httpDiagnostic:{...diagnostic,contentType:{toString(){throw Error('coercion invoked');}}}}),{});
});

test('actual Core routine API Send uses durable explicit usage consent, shared identity, one canonical transcript and history proof', async () => {
  const f=fixture();
  try {
    await f.configure(); assert.equal((await f.core.command('velaApiUsageStatus',{})).enabled,false);
    await assert.rejects(f.send('Explain the difference between mass and weight',{providerId:'openai-api-vela'}),/vela_api_usage_authorization_required/);
    assert.equal(f.requests.length,0); await f.authorize();
    const answer = ' Mass measures inertia; weight is gravitational force.';
    f.replies.push(()=>response(answer, undefined, undefined, undefined, [' ', answer.slice(1)]));
    const first=await f.send('Explain the difference between mass and weight'); assert.equal(first.state,'responded'); assert.equal(first.providerId,'openai-api-vela');
    const wire=f.requests[0]; assert.equal(wire.model,'gpt-6-luna'); assert.deepEqual(wire.reasoning,{effort:'none'}); assert.equal(wire.max_output_tokens,2048); assert.equal(wire.store,false); assert(wire.tools.some((tool:any)=>tool.name===VELA_TOOL_INVOKE)); assert.ok(wire.instructions.includes('Vela is Aerynth'));
    const snapshot=await f.core.command('snapshot',{}); assert.equal(snapshot.conversations.length,1); assert.equal(snapshot.graph.messages.length,2);
    const output=snapshot.graph.messages.find(message=>message.role==='assistant')!;
    assert.equal(output.content,answer); assert.equal(snapshot.messageEvidence[output.id].providerId,'openai-api-vela');
    const execution=Object.values(snapshot.executions)[0]; assert.equal(execution.resourceId,first.conversationId); assert.equal(execution.outputMessageId,output.id); assert.equal(execution.usage?.totalTokens,28); assert.equal(execution.taskVerified,false);
    const timing=f.events.find(event=>event.executionId===execution.id&&event.type==='execution/provider_completed')?.payload.providerTiming;
    assert.ok(timing&&timing.firstTextDeltaMs!==null&&timing.responseCreatedMs!==null&&timing.resultObservedMs!==null);
    assert.equal(timing.source,'simulated');
    assert.equal(timing.parentRequestId,first.id);
    const transport = timing.transport;
    assert.ok(transport && transport.postAttemptMs !== null && transport.headersMs !== null && transport.firstSseBytesMs !== null);
    assert.ok(transport.postAttemptMs <= transport.headersMs && transport.headersMs <= transport.firstSseBytesMs &&
      transport.firstSseBytesMs <= transport.finishedMs);
    assert.ok(timing.responseCreatedMs<=timing.firstTextDeltaMs&&timing.firstTextDeltaMs<=timing.resultObservedMs&&
      timing.resultObservedMs<=timing.settlementStagedMs);
    assert.ok(timing.firstNonblankOutput?.kind === 'text' &&
      timing.firstTextDeltaMs < timing.firstNonblankOutput.elapsedMs &&
      timing.firstNonblankOutput.elapsedMs <= timing.resultObservedMs);
    const routing = f.events.find(event => event.correlationId === first.id && event.type === 'vela.routing.stage_started');
    assert.ok(routing?.payload.timing?.previewClock && timing.fromPreview);
    const admission = routing.payload.requestAdmission;
    assert.ok(admission && first.inputMessageId);
    assert.equal(execution.inputMessageId, first.inputMessageId);
    assert.equal(admission.source, 'canonical-user-message-staged');
    assert.ok(admission.requestToInputStagingMs >= 0 &&
      admission.requestToInputStagingMs <= admission.requestToProviderContextCheckMs);
    assert.ok(admission.previewToInputStagingMs !== null &&
      admission.previewToInputStagingMs >= routing.payload.timing.previewMs &&
      admission.previewToInputStagingMs <= timing.fromPreview.toAdapterMs);
    assert.equal(timing.fromPreview.id, routing.payload.previewId);
    assert.ok(timing.fromPreview.toAdapterMs >= routing.payload.timing.previewMs);
    assert.equal(timing.fromPreview.toFirstNonblankOutputMs,
      timing.fromPreview.toAdapterMs + timing.firstNonblankOutput.elapsedMs);
    assert.equal(timing.outputStagedMs,null);
    const outputTiming=execution.outputTiming;
    assert.ok(outputTiming);
    assert.equal(outputTiming.messageId,output.id);
    assert.equal(outputTiming.parentRequestId,first.id);
    assert.equal(outputTiming.source,'simulated');
    assert.ok(timing.settlementStagedMs<=outputTiming.compositionStartedMs&&
      outputTiming.compositionStartedMs<=outputTiming.readyMs&&outputTiming.readyMs<=outputTiming.stagedMs);
    assert.deepEqual(outputTiming.fromPreview, { id: timing.fromPreview.id,
      toStagingMs: timing.fromPreview.toAdapterMs + outputTiming.stagedMs });
    assert.ok(outputTiming.requestToStagingMs !== undefined &&
      outputTiming.requestToStagingMs >= admission.requestToInputStagingMs &&
      outputTiming.requestToStagingMs <= outputTiming.fromPreview.toStagingMs);
    assert.doesNotMatch(JSON.stringify(outputTiming),/Mass measures inertia/u);
    const readOutputTiming=async()=> (await f.core.command('conversationActivity',{resourceIds:[execution.resourceId]}))
      .executions.find(item=>item.id===execution.id)?.outputTiming;
    assert.deepEqual(await readOutputTiming(),outputTiming);
    assert.deepEqual((await f.core.command('conversationActivity',{resourceIds:['unavailable-conversation']})).executions,[]);
    const presented={executionId:execution.id,requestId:first.id,messageId:output.id};
    assert.equal((await f.core.command('rendererVelaOutput',{...presented,messageId:'different-message'})).accepted,false);
    assert.equal((await f.core.command('rendererVelaOutput',presented)).accepted,true);
    const observed=(await readOutputTiming())?.presentation;
    assert.ok(observed && observed.stagingToReceiptMs!==null && observed.stagingToReceiptMs>=0);
    assert.equal(observed.previewToReceiptMs,
      outputTiming.fromPreview!.toStagingMs + observed.stagingToReceiptMs);
    assert.equal(observed.requestToReceiptMs, outputTiming.requestToStagingMs + observed.stagingToReceiptMs);
    assert.equal((await f.core.command('rendererVelaOutput',presented)).accepted,true);
    assert.deepEqual((await readOutputTiming())?.presentation,observed);
    assert.equal((await f.core.command('velaApiUsageStatus',{})).usedToday,1); assert.ok(!JSON.stringify({snapshot,events:f.events}).includes(marker));
    await f.reopen(); assert.equal((await f.core.command('velaApiUsageStatus',{})).enabled,true);
    const replayedTiming = (await f.core.command('replay', { limit: 1000 })).events
      .find(event => event.executionId === execution.id && event.type === 'execution/provider_completed')?.payload.providerTiming;
    assert.deepEqual(replayedTiming?.fromPreview, timing.fromPreview);
    assert.deepEqual(replayedTiming?.transport, transport);
    const replayedAdmission = (await f.core.command('replay', { limit: 1000 })).events
      .filter(event => event.correlationId === first.id && event.type === 'vela.routing.stage_started');
    assert.equal(replayedAdmission.length, 1);
    assert.deepEqual(replayedAdmission[0].payload.requestAdmission, admission);
    assert.deepEqual(await readOutputTiming(),{...outputTiming,presentation:observed});
    f.replies.push(()=>response('Weight changes with gravity; mass stays the same.','resp-next'));
    const next=await f.send('And on the Moon?'); assert.equal(next.state,'responded'); assert.ok(next.history?.messages.some(message=>message.messageId===output.id));
    assert.ok(f.requests[1].input[0].content.includes('Mass measures inertia'));
    const nextExecution=Object.values((await f.core.command('snapshot',{})).executions)
      .find(item=>item.outputTiming?.parentRequestId===next.id)!;
    await f.reopen();
    assert.equal((await f.core.command('rendererVelaOutput',presented)).accepted,false);
    const newObservation={executionId:nextExecution.id,requestId:next.id,messageId:nextExecution.outputMessageId!};
    assert.equal((await f.core.command('rendererVelaOutput',newObservation)).accepted,true);
    const restored=(await f.core.command('snapshot',{})).executions[nextExecution.id];
    assert.ok(restored.outputTiming?.fromPreview);
    assert.equal(restored.outputTiming?.presentation?.stagingToReceiptMs,null);
    assert.equal(restored.outputTiming?.presentation?.previewToReceiptMs,null);
    assert.equal(restored.outputTiming?.presentation?.requestToReceiptMs,null);
  } finally { await f.close(); }
});

test('actual Core semantic application action uses standing source policy and continues with its real canonical receipt and fresh context', async () => {
  const f=fixture();
  try {
    await f.configure(); await f.authorize();
    f.replies.push(body=>{
      const envelope=JSON.parse(/Pinned host tools: ([^\n]+)/u.exec(body.instructions)![1]);assert(body.tools.some((tool:any)=>tool.name===VELA_TOOL_SCHEMAS));assert.equal(body.parallel_tool_calls,true);
      return response('','resp-discovery',[{type:'function_call',id:'fc-fixture',call_id:'call-fixture',name:VELA_TOOL_SCHEMAS,arguments:JSON.stringify({catalogDigest:envelope.catalogDigest,ids:['application.createWorkspace']}),status:'completed'}] as any);
    },body=>{
      const tool=body.input.find((item:any)=>item.type==='function_call_output'); assert.ok(tool);const discovery=JSON.parse(tool.output),descriptor=discovery.descriptors.find((item:any)=>item.id==='application.createWorkspace');assert(descriptor);
      assert.equal(descriptor.effect,'mutate');assert.equal(descriptor.authorization,'host-policy');return response('','resp-prepare',[{type:'function_call',id:'fc-prepare',call_id:'call-prepare',name:VELA_TOOL_INVOKE,arguments:JSON.stringify({catalogDigest:discovery.catalogDigest,capabilityId:descriptor.id,schemaDigest:descriptor.schemaDigest,invocationId:'synthetic-workspace-review',argumentsJson:JSON.stringify({type:'createWorkspace',title:'Research',projectId:null})}),status:'completed'}]as any);
    },async body=>{
      const desktop=await f.core.command('desktop',{type:'snapshot'}),workspace=desktop.workspaces.find(item=>item.title==='Research');assert(workspace);assert(String(body.input[0].content).includes(workspace.id));const receipt=body.input.filter((item:any)=>item.type==='function_call_output').map((item:any)=>JSON.parse(item.output)).find((item:any)=>item.contract==='aerynth.vela.tool-receipt@1');assert.equal(receipt.state,'observed');assert.equal(receipt.verification.kind,'owner-observed');return response('The Research workspace is ready.','resp-confirmation');
    });
    const result=await f.send('Create a workspace called Research');
    const state=await f.core.command('vela',{name:'state',input:{}}) as any,plan=state.plans.find((item:any)=>item.requestId===result.id);assert.equal(result.state,'responded',JSON.stringify({state:result.state,workflow:result.toolWorkflow,planState:plan?.state,requests:f.requests.length}));assert.equal(plan?.state,'applied');assert.equal(plan.steps[0].action.title,'Research'); const desktop=await f.core.command('desktop',{type:'snapshot'});assert.equal(desktop.workspaces.filter(item=>item.title==='Research').length,1);
    assert.equal(f.requests.length,3); assert.equal((await f.core.command('velaApiUsageStatus',{})).usedToday,3);assert.equal(state.requests.length,1);assert.equal(state.conversation.messages.filter((item:any)=>item.role==='user').length,1);
    const snapshot=await f.core.command('snapshot',{});
    assert.equal(snapshot.conversations.length,1);
    const staged=Object.values(snapshot.executions).filter(execution=>execution.outputTiming);
    assert.equal(staged.length,1);
    assert.equal(staged[0].responseId,'resp-confirmation');
    assert.equal(staged[0].outputTiming?.parentRequestId,result.id);
    assert.equal(staged[0].outputTiming?.messageId,staged[0].outputMessageId);
  } finally { await f.close(); }
});

test('API model pins and usage revocation fail closed and incomplete output never falls back or retries', async () => {
  const f=fixture();
  try {
    await f.configure(); await f.authorize();
    await assert.rejects(f.send('Hello',{providerId:'openai-api-vela',model:'unavailable-model'}),/unsupported_model/); assert.equal(f.requests.length,0);
    f.replies.push(()=>response('Partial answer','resp-incomplete',[message('Partial answer')],'incomplete'));
    const result=await f.send('Explain rainfall'); assert.equal(result.toolWorkflow?.phase,'blocked');assert.equal(result.state,'responded');assert.equal(result.response?.kind,'inability'); assert.equal(f.requests.length,1);
    assert.ok(Object.values((await f.core.command('snapshot',{})).executions).every(execution=>!execution.outputTiming));
    const state=await f.core.command('vela',{name:'state',input:{}}) as VelaState,visible=state.conversation!.messages.find(message=>message.id===result.response!.messageId)!;
    assert.equal(visible.source,'vela-native');assert.equal(visible.classification,'observed');assert.equal(visible.providerContribution,undefined);assert(!visible.content.includes('Partial answer'));
    const snapshot=await f.core.command('snapshot',{}); assert.equal(Object.values(snapshot.executions)[0].state,'failed');
    await f.core.command('velaApiUsageAuthorize',{expectedVersion:1,enabled:false});
    await assert.rejects(f.send('Hello',{providerId:'openai-api-vela'}),/vela_api_usage_authorization_required/); assert.equal(f.requests.length,1);
  } finally { await f.close(); }
});

test('Vela API reserves its foreground slot before admission observers can start Codex', async () => {
  const f = fixture();
  try {
    await f.configure();
    await f.authorize();
    const codex = await f.core.command('createConversation', { providerId: 'fixture-codex', commandId: 'synthetic-codex-chat' });
    const owner = f.core as any;
    const emit = owner.emit;
    let overlapping: Promise<unknown> | undefined;
    owner.emit = (event: StreamEvent) => {
      emit(event);
      if (event.type === 'execution/dispatching' && event.providerId === 'openai-api-vela') {
        overlapping = f.core.execute({ resourceId: codex.resourceId, commandId: 'synthetic-observer-race',
          prompt: 'Synthetic overlapping Codex request', authorized: true }).catch(error => error);
      }
    };
    f.replies.push(() => response('Synthetic API result', 'resp-foreground-admission'));
    const result = await f.send('Explain the difference between mass and weight', { providerId: 'openai-api-vela' });
    assert.equal(result.state, 'responded');
    assert.match(String(await overlapping), /execution_busy/);
    assert.equal(Object.values((await f.core.command('snapshot', {})).executions).length, 1);
    assert.equal(owner.active, null);
    assert.equal(owner.ordinaryController, null);
    assert.equal(f.requests.length, 1);
  } finally { await f.close(); }
});

test('Vela API deferred admission failure does not consume authority or count a request', async () => {
  const f = fixture();
  try {
    await f.configure();
    await f.authorize();
    const owner = f.core as any;
    owner.db.exec([
      'CREATE TEMP TABLE api_admission_parent(id INTEGER PRIMARY KEY);',
      'CREATE TEMP TABLE api_admission_child(id INTEGER REFERENCES api_admission_parent(id) DEFERRABLE INITIALLY DEFERRED);',
      'CREATE TEMP TRIGGER reject_api_admission AFTER INSERT ON intelligence_events',
      "WHEN json_extract(NEW.json, '$.type') = 'execution/dispatching'",
      'BEGIN INSERT INTO api_admission_child VALUES(1); END;',
    ].join(' '));
    const before = owner.providerActivity.providerRequests;
    const result = await f.send('Explain the difference between mass and weight', { providerId: 'openai-api-vela' });
    assert.equal(f.requests.length, 0);
    const grant = [...owner.velaGrants.values()].find((entry: { requestId: string }) => entry.requestId === result.id);
    assert.equal(grant?.consumed, false);
    assert.equal(owner.providerActivity.providerRequests, before);
    assert.equal(owner.active, null);
    assert.equal(owner.ordinaryController, null);
    assert.deepEqual((await f.core.command('snapshot', {})).executions, {});
    assert.equal((await f.core.command('velaApiUsageStatus', {})).usedToday, 0);
    assert(!f.events.some(event => event.type === 'execution/dispatching'));
    owner.db.exec('DROP TRIGGER reject_api_admission');
    f.replies.push(() => response('Synthetic answer after admission failure.', 'resp-api-after-admission'));
    assert.equal((await f.send('Explain the difference between mass and weight', { providerId: 'openai-api-vela' })).state, 'responded');
    assert.equal(f.requests.length, 1);
  } finally { await f.close(); }
});

test('Vela API deferred terminal commit failure keeps receipt, execution and replay aligned', async () => {
  const f = fixture();
  try {
    await f.configure();
    await f.authorize();
    const owner = f.core as any;
    const runtime = owner.velaApiRuntime as VelaApiRuntime;
    const emit = owner.emit;
    const early: string[] = [];
    owner.emit = (event: StreamEvent) => {
      if (owner.db.isTransaction) early.push(event.type);
      emit(event);
    };
    owner.db.exec(`
      CREATE TEMP TABLE api_parent(id INTEGER PRIMARY KEY);
      CREATE TEMP TABLE api_child(id INTEGER REFERENCES api_parent(id) DEFERRABLE INITIALLY DEFERRED);
      CREATE TEMP TRIGGER reject_api_terminal AFTER INSERT ON intelligence_events
      WHEN json_extract(NEW.json, '$.type') = 'vela.api/scoped-completed'
      BEGIN INSERT INTO api_child VALUES(1); END;
    `);
    const input = { requestId: 'synthetic-api-terminal', version: 1, model: 'gpt-6-luna',
      prompt: 'Synthetic terminal transaction', contextDigest: 'a'.repeat(64), oneUse: true as const, validate() {},
      outputSchema: { type: 'object' as const, properties: {}, required: [], additionalProperties: false },
      missionCognition: { owner: { kind: 'planning' as const, requestId: 'synthetic-planning-owner' }, stage: 'planning' as const } };
    f.replies.push(() => response('Uncommitted answer', 'resp-api-terminal-fault'));
    const run = await runtime.run(input, new AbortController().signal);
    assert.equal(run.result.outcome, 'unknown');
    assert.equal(run.result.errorCode, 'vela_api_settlement_unavailable');
    assert.equal(run.result.partialText, '');
    const [receipt] = runtime.receiptsForRequest(input.requestId);
    const execution = (await f.core.command('snapshot', {})).executions[receipt.executionId];
    assert.equal(receipt.state, 'unknown');
    assert.equal(execution.state, 'unknown');
    assert.equal(execution.responseId, 'resp-api-terminal-fault');
    assert.equal(receipt.responseId, execution.responseId);
    const observed = runtime.missionCognitiveReceipts('synthetic-planning-owner', 'unrelated-mission')!;
    assert.equal(observed.runs[0].transportOutcome, 'unknown');
    assert.equal(observed.runs[0].dispatched, true);
    assert.doesNotMatch(JSON.stringify(observed), /Uncommitted answer|Synthetic terminal transaction/);
    assert.deepEqual(early, []);
    const replay = (await f.core.command('replay', {})).events.filter(event => event.correlationId === input.requestId);
    assert.deepEqual(replay.filter(event => event.type.startsWith('vela.api/')).map(event => event.type),
      ['vela.api/scoped-dispatch', 'vela.api/scoped-unknown']);
    assert(!f.events.some(event => event.type === 'vela.api/scoped-completed'));
    await assert.rejects(runtime.run(input, new AbortController().signal), /api_execution_already_dispatched/);
    assert.equal(f.requests.length, 1);
    await f.reopen();
    assert.deepEqual((await f.core.command('snapshot', {})).executions[receipt.executionId], execution);
    const reopened = (f.core as any).velaApiRuntime as VelaApiRuntime;
    assert.deepEqual(reopened.receiptsForRequest(input.requestId), [receipt]);
    assert.deepEqual(reopened.missionCognitiveReceipts('synthetic-planning-owner', 'unrelated-mission'), observed);
    assert.equal(reopened.missionCognitiveReceipts(null, 'unrelated-mission'), undefined);
    f.replies.push(() => response('Synthetic subsequent answer', 'resp-api-after-fault'));
    assert.equal((await reopened.run({ ...input, requestId: 'synthetic-api-fresh' }, new AbortController().signal)).result.outcome, 'completed');
    assert.equal(f.requests.length, 2);
  } finally { await f.close(); }
});

test('scoped structured proposals use global canonical execution, journal correlation, measured usage and request receipts', async () => {
  const f=fixture();
  try {
    await f.configure(); await f.authorize(); const before=await f.core.command('providerActivity',{});
    f.replies.push(body=>{ assert.equal(body.text.format.name,'vela_scoped_proposal'); return response('{"roles":["notes"]}','resp-structure'); });
    let validations=0;
    const runtime=(f.core as any).velaApiRuntime;
    const raw=await runtime.structuredProposal({instruction:'Choose roles from the authorized candidates.',payload:{purpose:'Research',candidates:['notes']},
      schema:{type:'object',properties:{roles:{type:'array',items:{type:'string'}}},required:['roles'],additionalProperties:false},
      requestId:'synthetic-parent-construction',validate(){validations++;}},new AbortController().signal);
    assert.deepEqual(raw,{roles:['notes']}); assert.ok(validations>2);
    const after=await f.core.command('providerActivity',{}); assert.equal(after.providerRequests,before.providerRequests+1);
    const snapshot=await f.core.command('snapshot',{}); assert.equal(snapshot.graph.messages.length,0); assert.equal(Object.values(snapshot.executions).length,1);
    const correlated=f.events.filter(event=>event.correlationId==='synthetic-parent-construction');
    assert.ok(correlated.some(event=>event.type==='vela.api/scoped-dispatch'&&event.payload.api?.bodyDigest));
    assert.ok(correlated.some(event=>event.type==='provider/usage'&&event.payload.usage?.totalTokens===28));
    assert.ok(correlated.some(event=>event.type==='vela.api/scoped-completed'&&Number.isFinite(event.payload.api?.elapsedMs)));
    const receipts=runtime.receiptsForRequest('synthetic-parent-construction'); assert.equal(receipts.length,1); assert.equal(receipts[0].state,'completed');
  } finally { await f.close(); }
});

test('unavailable transport remains unknown and never retries; undiscovered action proposals perform no host changes', async () => {
  const f=fixture();
  try {
    await f.configure(); await f.authorize();
    f.replies.push(async()=>{throw new TypeError('SYNTHETIC_OFFLINE_NETWORK_DROP');});
    const unknown=await f.send('Explain inertia'); assert.equal(unknown.state,'unknown'); assert.equal(f.requests.length,1);
    assert.equal(Object.values((await f.core.command('snapshot',{})).executions)[0].state,'unknown');
    f.replies.push(()=>response(JSON.stringify({schemaVersion:2,kind:'plan',summary:'Create an unauthorized workspace.',steps:[{id:'create',explanation:'Unfetched action.',action:{type:'createWorkspace',title:'Must not exist',projectId:null}}]}),'resp-unfetched'));
    const invalid=await f.send('Describe possible ways to organize research.'); assert.equal(invalid.state,'responded');assert.equal(invalid.response?.kind,'answer');
    assert.equal((await f.core.command('desktop',{type:'snapshot'})).workspaces.length,0);
    assert.equal(f.requests.length,2);
  } finally { await f.close(); }
});

test('bounded discovery stops after four HTTP stages and three metadata reads without applying an action', async () => {
  const f=fixture();
  try {
    await f.configure(); await f.authorize();
    const runtime=(f.core as any).velaApiRuntime as VelaApiRuntime,catalog=createCapabilityCatalog(CAPABILITIES);await runtime.models(1);
    for(let i=0;i<4;i++) f.replies.push(body=>{
      const envelope=JSON.parse(body.input[0].content);
      return response('','resp-loop-'+i,[{type:'function_call',id:'fc-'+i,call_id:'call-'+i,name:'aerynth_capability_schemas',arguments:JSON.stringify({catalogDigest:envelope.capabilityCatalog.digest,ids:['createWorkspace']}),status:'completed'}] as any);
    });
    await assert.rejects(runtime.run({requestId:'synthetic-legacy-discovery',version:1,model:'gpt-6-luna',prompt:JSON.stringify({capabilityCatalog:catalog.projection}),contextDigest:'d'.repeat(64),catalog,validate(){}},new AbortController().signal),/api_tool_call_limit/);
    assert.equal(f.requests.length,4); assert.equal((await f.core.command('velaApiUsageStatus',{})).usedToday,4);
    assert.equal((await f.core.command('desktop',{type:'snapshot'})).workspaces.length,0);
  } finally { await f.close(); }
});

test('actual Core interruption cancels the API transport and retains an unknown dispatched outcome without replay', async () => {
  const f=fixture();
  try {
    await f.configure(); await f.authorize();
    f.replies.push(()=>new Response(new ReadableStream({start(controller){controller.enqueue(Buffer.from('data: '+JSON.stringify({type:'response.created',response:{id:'resp-cancel',status:'in_progress'}})+'\n\n'));}}),{headers:{'Content-Type':'text/event-stream'}}));
    const running=f.send('Explain ocean currents');
    let execution: any;
    for(let attempt=0;attempt<100;attempt++) {
      execution=Object.values((await f.core.command('snapshot',{})).executions).find(item=>item.state==='running');
      if(execution)break; await new Promise<void>(done=>setImmediate(done));
    }
    assert.ok(execution); assert.deepEqual(await f.core.command('interrupt',{executionId:execution.id}),{requested:true,confirmed:false});
    const request=await running; assert.equal(request.state,'unknown'); assert.equal(f.requests.length,1);
    const final=(await f.core.command('snapshot',{})).executions[execution.id]; assert.equal(final.state,'unknown');
    assert.equal(final.cancellation?.requested,true); assert.equal(final.cancellation?.serverConfirmed,false); assert.equal(final.taskVerified,false);
  } finally { await f.close(); }
});

test('a changed native usage grant cannot be bypassed by an already authorized routine API Send', async () => {
  const f=fixture();
  try {
    await f.configure(); await f.authorize();
    const intent='Explain evaporation', preview=await f.core.command('velaRequestPreview',{intent,resourceIds:[],adaptive:true});
    assert.equal(preview.sendDisposition,'routine');
    const review=await f.core.command('velaNativeReview',{previewId:preview.id,signature:preview.signature});
    const grant=await f.core.command('authorizeVelaRequest',{previewId:preview.id,signature:preview.signature,reviewDigest:review.reviewDigest,directSend:true});
    await f.core.command('velaApiUsageAuthorize',{expectedVersion:1,enabled:false});
    await assert.rejects(f.core.command('vela',{name:'request',input:{intent,resourceIds:[],authorizeProvider:true,previewId:preview.id,grantId:grant.grantId}}),/vela_api_connection_changed/);
    assert.equal(f.requests.length,0);
    assert.equal((await f.core.command('velaApiUsageStatus',{})).usedToday,0);
  } finally { await f.close(); }
});

test('explicit API model and reasoning pins reach the reviewed HTTP body while unsupported controls fail closed', async () => {
  const f=fixture();
  try {
    await f.configure(); await f.authorize();
    f.replies.push(body=>{ assert.equal(body.model,'gpt-6.1-sol'); assert.deepEqual(body.reasoning,{effort:'high'}); return response('Pinned answer.','resp-pinned'); });
    const result=await f.send('Explain tides',{providerId:'openai-api-vela',model:'gpt-6.1-sol',reasoningEffort:'high'});
    assert.equal(result.state,'responded'); assert.equal(result.route?.model,'gpt-6.1-sol'); assert.equal(result.route?.effort,'high');
    await assert.rejects(f.send('Explain tides',{providerId:'openai-api-vela',model:'gpt-6.1-sol',reasoningEffort:'none'}),/unsupported_reasoning_effort/);
    assert.equal(f.requests.length,1);
  } finally { await f.close(); }
});

test('ordinary API plan-shaped text outside the requested object family is only a report and cannot mutate', async () => {
  const f=fixture();
  try {
    await f.configure(); await f.authorize();
    f.replies.push(()=>response(JSON.stringify({schemaVersion:2,kind:'plan',summary:'Create a project instead.',steps:[{id:'project',explanation:'A different object family.',action:{type:'createProject',title:'Must need review'}}]}),'resp-project'));
    const result=await f.send('Describe a workspace for research'); assert.equal(result.state,'responded');assert.equal(result.response?.kind,'answer');
    const desktop=await f.core.command('desktop',{type:'snapshot'}); assert.equal(desktop.projects.length,0); assert.equal(desktop.workspaces.length,0);
  } finally { await f.close(); }
});

test('explicitly attached source data requires native review even with durable API usage enabled', async () => {
  const f=fixture();
  try {
    await f.configure(); await f.authorize();
    const desktop=await f.core.command('desktop',{type:'createResource',kind:'note',title:'Synthetic source note',workspaceId:null});
    const note=desktop.resources.find(resource=>resource.kind==='note')!; assert.ok(note);
    const preview=await f.core.command('velaRequestPreview',{intent:'Summarize this note',resourceIds:[note.id],adaptive:true});
    assert.equal(preview.sendDisposition,'review-required');
    const review=await f.core.command('velaNativeReview',{previewId:preview.id,signature:preview.signature});
    await assert.rejects(f.core.command('authorizeVelaRequest',{previewId:preview.id,signature:preview.signature,reviewDigest:review.reviewDigest,directSend:true}),/vela_attached_context_review_required/);
    assert.equal(f.requests.length,0);
  } finally { await f.close(); }
});

test('a stalled foreground API preview loses disclosure when its connection is revoked', {timeout: 5000}, async () => {
  const f = fixture();
  let closeStream: (() => void) | undefined;
  let sending: Promise<VelaRequest> | undefined;
  try {
    await f.configure();
    await f.authorize();
    const owner = f.core as any;
    const emit = owner.emit;
    let observePreview!: () => void;
    const previewObserved = new Promise<void>(resolve => { observePreview = resolve; });
    owner.emit = (event: StreamEvent) => {
      emit(event);
      if (event.payload.delta) observePreview();
    };
    const text = 'Synthetic foreground partial response';
    f.replies.push(() => new Response(new ReadableStream({
      start(stream) {
        closeStream = () => stream.close();
        for (const event of [
          {type: 'response.created', response: {id: 'resp-preview', status: 'in_progress'}},
          {type: 'response.output_text.delta', delta: text},
        ]) stream.enqueue(Buffer.from('data: ' + JSON.stringify(event) + '\n\n'));
      },
    }), {headers: {'Content-Type': 'text/event-stream'}}));
    sending = f.send('Explain the difference between mass and weight', {providerId: 'openai-api-vela'});
    await Promise.race([previewObserved, sending.then(() => { throw Error('Provider settled before preview'); })]);
    const resourceId = owner.active.resourceId as string;
    const read = () => f.core.command('conversationActivity', {resourceIds: [resourceId]});
    assert.equal((await read()).preview?.text, text);
    const before = await f.core.command('vela', {name: 'state', input: {}}) as VelaState;
    assert.equal(before.activeAnswer?.text, text);
    await f.core.command('velaApiUsageAuthorize', {expectedVersion: 1, enabled: false});
    assert.equal((await read()).preview, null);
    const after = await f.core.command('vela', {name: 'state', input: {}}) as VelaState;
    assert.equal(after.activeAnswer, undefined);
  } finally {
    closeStream?.();
    await sending?.catch(() => {});
    await f.close();
  }
});
