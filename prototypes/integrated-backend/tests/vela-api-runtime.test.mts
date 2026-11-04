import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { BackendCore } from '../src/core.mts';
import type { NativeHostServices } from '../src/native-host.mts';
import type { VelaRequest } from '../../vela-core/src/contracts.ts';
import type { StreamEvent } from '../src/contracts.mts';
const marker = 'SYNTHETIC_ONLY_VELA_API_RUNTIME_CREDENTIAL';
const message = (content: string) => ({ type: 'message', id: 'msg-fixture', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: content, annotations: [] }] });
function response(content: string, id = 'resp-fixture', output = [message(content)], outcome = 'completed') {
  const events = [{ type: 'response.created', response: { id, status: 'in_progress' } },
    ...(content ? [{ type: 'response.output_text.delta', delta: content }] : []),
    { type: outcome === 'completed' ? 'response.completed' : 'response.incomplete', response: { id, status: outcome, model: 'gpt-6-luna', output,
      ...(outcome === 'incomplete' ? { incomplete_details: { reason: 'max_output_tokens' } } : {}), usage: { input_tokens: 20, output_tokens: 8, total_tokens: 28 } } }];
  return new Response(events.map(event => 'data: '+JSON.stringify(event)+'\n\n').join(''),{headers:{'Content-Type':'text/event-stream'}});
}
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

test('actual Core routine API Send uses durable explicit usage consent, shared identity, one canonical transcript and history proof', async () => {
  const f=fixture();
  try {
    await f.configure(); assert.equal((await f.core.command('velaApiUsageStatus',{})).enabled,false);
    await assert.rejects(f.send('Explain the difference between mass and weight',{providerId:'openai-api-vela'}),/vela_api_usage_authorization_required/);
    assert.equal(f.requests.length,0); await f.authorize();
    f.replies.push(()=>response('Mass measures inertia; weight is gravitational force.'));
    const first=await f.send('Explain the difference between mass and weight'); assert.equal(first.state,'responded'); assert.equal(first.providerId,'openai-api-vela');
    const wire=f.requests[0]; assert.equal(wire.model,'gpt-6-luna'); assert.deepEqual(wire.reasoning,{effort:'none'}); assert.equal(wire.max_output_tokens,2048); assert.equal(wire.store,false); assert.equal(wire.tools,undefined); assert.ok(wire.instructions.includes('Vela is Aerynth'));
    const snapshot=await f.core.command('snapshot',{}); assert.equal(snapshot.conversations.length,1); assert.equal(snapshot.graph.messages.length,2);
    const output=snapshot.graph.messages.find(message=>message.role==='assistant')!;
    assert.equal(output.content,'Mass measures inertia; weight is gravitational force.'); assert.equal(snapshot.messageEvidence[output.id].providerId,'openai-api-vela');
    const execution=Object.values(snapshot.executions)[0]; assert.equal(execution.resourceId,first.conversationId); assert.equal(execution.outputMessageId,output.id); assert.equal(execution.usage?.totalTokens,28); assert.equal(execution.taskVerified,false);
    assert.equal((await f.core.command('velaApiUsageStatus',{})).usedToday,1); assert.ok(!JSON.stringify({snapshot,events:f.events}).includes(marker));
    await f.reopen(); assert.equal((await f.core.command('velaApiUsageStatus',{})).enabled,true);
    f.replies.push(()=>response('Weight changes with gravity; mass stays the same.','resp-next'));
    const next=await f.send('And on the Moon?'); assert.equal(next.state,'responded'); assert.ok(next.history?.messages.some(message=>message.messageId===output.id));
    assert.ok(f.requests[1].input[0].content.includes('Mass measures inertia'));
  } finally { await f.close(); }
});

test('actual Core schema tool loop returns receipt-bound continuation then validates and applies a bounded create request', async () => {
  const f=fixture();
  try {
    await f.configure(); await f.authorize();
    f.replies.push(body=>{
      const envelope=JSON.parse(body.input[0].content); assert.equal(body.tools.length,1); assert.equal(body.parallel_tool_calls,false);
      return response('','resp-discovery',[{type:'function_call',id:'fc-fixture',call_id:'call-fixture',name:'aerynth_capability_schemas',arguments:JSON.stringify({catalogDigest:envelope.capabilityCatalog.digest,ids:['createWorkspace']}),status:'completed'}] as any);
    },body=>{
      const tool=body.input.find((item:any)=>item.type==='function_call_output'); assert.ok(tool); assert.ok(JSON.parse(tool.output).descriptors.some((item:any)=>item.id==='createWorkspace'));
      return response(JSON.stringify({schemaVersion:2,kind:'plan',summary:'Create the requested workspace.',steps:[{id:'create',explanation:'Create the requested workspace.',action:{type:'createWorkspace',title:'Research',projectId:null}}]}),'resp-plan');
    });
    const result=await f.send('Create a workspace called Research');
    assert.equal(result.state,'completed'); const desktop=await f.core.command('desktop',{type:'snapshot'}); assert.ok(desktop.workspaces.some(workspace=>workspace.title==='Research'));
    assert.equal(f.requests.length,2); assert.equal((await f.core.command('velaApiUsageStatus',{})).usedToday,2);
    assert.equal((await f.core.command('snapshot',{})).conversations.length,1);
  } finally { await f.close(); }
});

test('API model pins and usage revocation fail closed and incomplete output never falls back or retries', async () => {
  const f=fixture();
  try {
    await f.configure(); await f.authorize();
    await assert.rejects(f.send('Hello',{providerId:'openai-api-vela',model:'unavailable-model'}),/unsupported_model/); assert.equal(f.requests.length,0);
    f.replies.push(()=>response('Partial answer','resp-incomplete',[message('Partial answer')],'incomplete'));
    const result=await f.send('Explain rainfall'); assert.equal(result.state,'failed'); assert.equal(f.requests.length,1);
    const snapshot=await f.core.command('snapshot',{}); assert.equal(Object.values(snapshot.executions)[0].state,'failed');
    await f.core.command('velaApiUsageAuthorize',{expectedVersion:1,enabled:false});
    await assert.rejects(f.send('Hello',{providerId:'openai-api-vela'}),/vela_api_usage_authorization_required/); assert.equal(f.requests.length,1);
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
    const invalid=await f.send('Create a workspace for research'); assert.equal(invalid.state,'failed'); assert.equal(invalid.errorCode,'planning_failed');
    assert.equal((await f.core.command('desktop',{type:'snapshot'})).workspaces.length,0);
    assert.equal(f.requests.length,2);
  } finally { await f.close(); }
});

test('bounded discovery stops after four HTTP stages and three metadata reads without applying an action', async () => {
  const f=fixture();
  try {
    await f.configure(); await f.authorize();
    for(let i=0;i<4;i++) f.replies.push(body=>{
      const envelope=JSON.parse(body.input[0].content);
      return response('','resp-loop-'+i,[{type:'function_call',id:'fc-'+i,call_id:'call-'+i,name:'aerynth_capability_schemas',arguments:JSON.stringify({catalogDigest:envelope.capabilityCatalog.digest,ids:['createWorkspace']}),status:'completed'}] as any);
    });
    const result=await f.send('Create a workspace for research'); assert.equal(result.state,'failed'); assert.equal(result.errorCode,'api_tool_call_limit');
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

test('a typed API plan outside the requested object family stays reviewable without mutation', async () => {
  const f=fixture();
  try {
    await f.configure(); await f.authorize();
    f.replies.push(body=>{
      const envelope=JSON.parse(body.input[0].content);
      return response('','resp-discovery-project',[{type:'function_call',id:'fc-project',call_id:'call-project',name:'aerynth_capability_schemas',arguments:JSON.stringify({catalogDigest:envelope.capabilityCatalog.digest,ids:['createProject']}),status:'completed'}] as any);
    },()=>response(JSON.stringify({schemaVersion:2,kind:'plan',summary:'Create a project instead.',steps:[{id:'project',explanation:'A different object family.',action:{type:'createProject',title:'Must need review'}}]}),'resp-project'));
    const result=await f.send('Create a workspace for research'); assert.equal(result.state,'awaiting-review');
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
