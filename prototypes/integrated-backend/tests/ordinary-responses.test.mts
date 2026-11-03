import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,relative,isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BackendCore } from '../src/core.mts';
import { createRequire } from 'node:module';
const { conversationCommand } = createRequire(import.meta.url)('../../visual-experience/cinematic-v3/native/conversation-broker.cjs');
import type { ConversationSendInput,OrdinaryConnectionPort,StreamEvent } from '../src/contracts.mts';
import type { ProviderConnectionStatus } from '../../application-contract/provider-connections.ts';
import type { VelaRequest } from '../../vela-core/src/contracts.ts';
import { RESPONSES_ENDPOINT } from '../../openai-provider/responses.mts';
const providerId='chatgpt-plan-responses',boundary='a'.repeat(64),model='synthetic-plan-model';
const documentedModel = { id: 'gpt-6.1-sol', label: 'Synthetic catalog Sol' };
function sse(events:unknown[]){return new Response(events.map(event=>'data: '+JSON.stringify(event)+'\n\n').join(''),{headers:{'Content-Type':'text/event-stream'}});}
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'aerynth-ordinary-responses-')),path=join(dir,'canonical.sqlite'),events:StreamEvent[]=[],requests:Record<string,any>[]=[],responses:((init:RequestInit)=>Promise<Response>|Response)[]=[];
 let listedModels=[{id:model,label:'Synthetic eligible model'}];
 let version=1,ready=true,catalogReads=0,secretReads=0,codexCalls=0,finishResolve:(()=>void)|undefined,pending=false;
 const status=async():Promise<ProviderConnectionStatus>=>({contract:'aerynth.provider-connection@1',providerId,billingRoute:'chatgpt-plan',state:ready?'ready':'disconnected',storageAvailable:true,pending,registrationVersion:version,planUsageEnabled:ready,inferenceVerified:false,nativeAccountHistory:false,nativeAccountMemory:false,nativeAccountSync:false});
 const connection:OrdinaryConnectionPort={status,begin:async()=>{pending=true;return {attemptId:'synthetic-attempt',authorizationUrl:'https://auth.openai.com/synthetic-only',expiresAt:Date.now()+60000};},finish:async()=>new Promise<void>(resolve=>{finishResolve=()=>{pending=false;resolve();};}),cancel:async()=>{pending=false;finishResolve?.();},disconnect:async expected=>{assert.equal(expected,version);version++;ready=false;},refresh:async expected=>{assert.equal(expected,version);version++;},close:async()=>{finishResolve?.();},
  resolveCredential:async expected=>{secretReads++;assert.equal(expected,version,'credential version changed');assert(ready);return {providerId,kind:'chatgpt-plan',boundaryDigest:boundary,bearer:'SYNTHETIC_PLAN_TOKEN',expiresAt:Date.now()+60000,scopes:['chatgpt.tokens.use.direct']};},
  modelCatalog:async expected=>{catalogReads++;assert.equal(expected,version);assert(ready);return {providerId,boundaryDigest:boundary,observedAt:Date.now(),catalogOnly:true,models:listedModels};},
  revalidateCredential:async(expected,digest)=>{assert.equal(expected,version,'credential version changed');assert.equal(digest,boundary);assert(ready);},
 };
 const fakeFetch:typeof fetch=async(url,init)=>{assert.equal(url,RESPONSES_ENDPOINT);assert.equal(new Headers(init?.headers).get('authorization'),'Bearer SYNTHETIC_PLAN_TOKEN');const body=JSON.parse(String(init?.body));assert.equal(body.store,false);assert.equal(body.stream,true);assert.deepEqual(Object.keys(body),['model','instructions','input','store','stream',...(body.reasoning?['reasoning']:[]),...(body.tools?['tools','tool_choice']:[])]);requests.push(body);const response=responses.shift();assert(response,'unexpected provider request');return response(init!);};
 let core:BackendCore;const create=()=>{core=new BackendCore({path,provider:'fixture',contentPolicy:'synthetic-only'},event=>events.push(event),undefined,{connection,fetch:fakeFetch});const port=(core as any).port;for(const key of ['connect','capabilities','open','resume','read','items','turn','terminal','interrupt'])port[key]=()=>{codexCalls++;throw Error('Codex must never serve ordinary Responses');};};create();
 return {get core(){return core;},get owner(){return core as any;},events,requests,responses,connection,get catalogReads(){return catalogReads;},get secretReads(){return secretReads;},get codexCalls(){return codexCalls;},setListedModels(models:{id:string;label:string}[]){listedModels=models;},disconnect(){version++;ready=false;},async reopen(){if(!(core as any).closed)await core.command('close',{});create();},async close(){if(!(core as any).closed)await core.command('close',{});const part=relative(resolve(tmpdir()),resolve(dir));assert(part.startsWith('aerynth-ordinary-responses-')&&!part.startsWith('..')&&!isAbsolute(part));rmSync(dir,{recursive:true,force:true});}};
}
function complete(id:string,text='Synthetic response'){return sse([{type:'response.created',response:{id}},{type:'response.output_text.delta',delta:text},{type:'response.completed',response:{id,status:'completed',model,usage:{input_tokens:11,output_tokens:3,total_tokens:14},output:[]}}]);}
async function prepare(f:ReturnType<typeof fixture>,resourceId:string,content:string){const d=await f.core.command('conversation',{name:'detail',input:{resourceId}}) as any,input:ConversationSendInput={resourceId,content,expectedRevision:d.conversation.revision,commandId:randomUUID()},preview=await f.core.command('conversationSendPreview',input);return {input,preview};}
async function grant(f:ReturnType<typeof fixture>,preview:Awaited<ReturnType<typeof prepare>>['preview']){const g=await f.core.command('authorizeConversationSend',{previewId:preview.id,fingerprint:preview.fingerprint,commandId:preview.commandId});return {previewId:preview.id,fingerprint:preview.fingerprint,commandId:preview.commandId,grantId:g.grantId};}

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
    assert.match(f.requests[0].instructions, /contribute to Vela/);
    assert.equal(f.codexCalls, 0);
    assert.equal(request.providerId, providerId);
    assert.equal(request.state, 'failed', 'simulated output must not be attributed to a real provider');
    const execution = Object.values(f.owner.state.executions as Record<string, {state: string; responseId?: string}>)
      .find(item => item.responseId === 'resp_synthetic_vela');
    assert.equal(execution?.state, 'provider_completed');
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
  f.responses.push(()=>complete('resp-synthetic-second','Synthetic follow-up answer'));const second=await prepare(f,c.resourceId,'Synthetic follow-up');assert.deepEqual(second.preview.responses!.messages.filter(m=>m.role!=='developer').map(m=>[m.role,m.content]),[['user','Synthetic first question'],['assistant','Synthetic first answer'],['user','Synthetic follow-up']]);await f.core.command('conversationSend',await grant(f,second.preview));
  const before=await f.core.command('snapshot',{}),beforeIds=before.graph.messages.map(m=>m.id);assert.equal(before.bindings[c.resourceId],undefined);assert.equal(before.graph.messages.length,4);await f.reopen();
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

test('ordinary cancellation requests actual abort, retains unknown outcome/partial text and does not invoke Codex interrupt',async()=>{
 const f=fixture();let pending:Promise<unknown>|undefined;try{
  await f.core.command('ordinaryProviderCheck',{});const c=await f.core.command('createConversation',{commandId:randomUUID()});let started=false;
  f.responses.push(init=>new Response(new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify({type:'response.created',response:{id:'resp-synthetic-cancel'}})+'\n\ndata: '+JSON.stringify({type:'response.output_text.delta',delta:'Synthetic received before abort'})+'\n\n'));started=true;init.signal!.addEventListener('abort',()=>controller.error(new Error('Synthetic fetch abort')),{once:true});}}),{headers:{'Content-Type':'text/event-stream'}}));
  const p=await prepare(f,c.resourceId,'Synthetic cancel request');pending=f.core.command('conversationSend',await grant(f,p.preview));for(let i=0;i<100&&(!started||!f.owner.assistantText);i++)await new Promise(resolve=>setTimeout(resolve,2));assert(started);const execution=f.owner.active;assert(execution);
  assert.deepEqual(await f.core.command('interrupt',{executionId:execution.id}),{requested:true,confirmed:false});const result=await pending as any;pending=undefined;assert.equal(result.state,'unknown');assert.equal(result.cancellation.requested,true);assert.equal(result.cancellation.serverConfirmed,false);assert.equal(f.codexCalls,0);assert.equal((await f.core.command('conversation',{name:'detail',input:{resourceId:c.resourceId}}) as any).messages.items.at(-1).outputState,'partial');
 }finally{if(pending){f.owner.ordinaryController?.abort();await pending;}await f.close();}
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
