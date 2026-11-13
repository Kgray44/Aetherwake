import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,relative,resolve,isAbsolute } from 'node:path';
import { BackendCore } from '../src/core.mts';
import type { ConversationProductRequest,ConversationSendInput,ProviderPort } from '../src/contracts.mts';
import type { ProductCommandMap } from '../../conversation-product/src/contracts.ts';
import type { ConversationReadView } from '../../conversation-product/src/service.mts';

function fixture(mode='normal'){
 const dir=mkdtempSync(join(tmpdir(),'aerynth-product-integration-')),path=join(dir,'canonical.sqlite');let core=new BackendCore({path,provider:'fixture',fixtureMode:mode,contentPolicy:'synthetic-only'});
 return {get core(){return core;},async reopen(){await core.command('close',{});core=new BackendCore({path,provider:'fixture',fixtureMode:mode,contentPolicy:'synthetic-only'});},async close(){await core.command('close',{});const target=resolve(dir),part=relative(resolve(tmpdir()),target);assert.ok(part.startsWith('aerynth-product-integration-')&&!part.startsWith('..')&&!isAbsolute(part));rmSync(target,{recursive:true,force:true});}};
}
async function product<K extends keyof ProductCommandMap>(core:BackendCore,name:K,input:ProductCommandMap[K]['input']):Promise<ProductCommandMap[K]['output']>{return core.command('conversation',{name,input} as ConversationProductRequest) as Promise<ProductCommandMap[K]['output']>;}
function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
async function approved(core:BackendCore,input:ConversationSendInput){const preview=await core.command('conversationSendPreview',input),grant=await core.command('authorizeConversationSend',{previewId:preview.id,fingerprint:preview.fingerprint,commandId:input.commandId});return {preview,dispatch:{previewId:preview.id,fingerprint:preview.fingerprint,commandId:input.commandId,grantId:grant.grantId}};}

test('desktop shutdown snapshot copies the graph once while returning every canonical conversation header', async () => {
 const f=fixture();
 try {
  const created=[];
  for(const title of ['Synthetic first chat','Synthetic second chat','Synthetic third chat'])
   created.push(await f.core.command('createConversation',{title,providerId:'local',commandId:crypto.randomUUID()}));
  const graph=(f.core as any).graph, snapshot=graph.snapshot.bind(graph);
  let copies=0;
  graph.snapshot=()=>{copies++;return snapshot();};
  const result=await f.core.command('snapshot',{});
  assert.equal(copies,1);
  assert.deepEqual(result.conversations,created);
  assert.equal(result.graph.conversations.length,created.length);
 } finally {await f.close();}
});

test('canonical read batches memoize only this synchronous authority check and fence every escaped lazy read',async()=>{
 const f=fixture();try{
  const c=await f.core.command('createConversation',{title:'Synthetic read-batch chat',providerId:'local',commandId:crypto.randomUUID()}),m=await f.core.command('addMessage',{resourceId:c.resourceId,role:'user',content:'Synthetic exact authorized body',expectedRevision:1});
  const core=f.core as any,access=core.conversationAccess.access;let checks=0,escaped!:ConversationReadView;
  core.conversationAccess.access=(...args:any[])=>{checks++;return access(...args);};
  const result=core.canonicalConversationReadBatch((v:ConversationReadView)=>{
   escaped=v;const gid=v.resourceMap[c.resourceId];
   assert.equal(v.messageMetadata(m.id)?.id,m.id);assert.equal(v.messageMetadata(m.id)?.id,m.id);
   assert.equal(v.graph.visibleMessages(gid)[0].content,'Synthetic exact authorized body');
   assert.throws(()=>core.canonicalConversationReadBatch(()=>null),/conversation_read_batch_active/);
   return m.id;
  });
  assert.equal(result,m.id);assert.equal(checks,1,'the first message read also resolves the resource, and later reads reuse both decisions');
  assert.throws(()=>escaped.messageMetadata(m.id),/conversation_read_batch_closed/);
  assert.throws(()=>escaped.graph.visibleMessages(escaped.resourceMap[c.resourceId]),/conversation_read_batch_closed/);
  assert.throws(()=>escaped.resourceContent(c.resourceId),/conversation_read_batch_closed/);
  core.conversationAccess.access=()=>false;
  assert.equal(core.canonicalConversationReadBatch((v:ConversationReadView)=>v.messageMetadata(m.id)),null,'a later batch never reuses a prior grant');
  core.conversationAccess.access=access;
  assert.throws(()=>core.canonicalConversationReadBatch((v:ConversationReadView)=>{escaped=v;throw Error('synthetic callback failure');}),/synthetic callback failure/);
  assert.throws(()=>escaped.messageMetadata(m.id),/conversation_read_batch_closed/);
  let asyncCalled=false;
  assert.throws(()=>core.canonicalConversationReadBatch(async()=>{asyncCalled=true;}),/synchronous_conversation_read_required/);assert.equal(asyncCalled,false);
  assert.throws(()=>core.canonicalConversationReadBatch((v:ConversationReadView)=>{escaped=v;return Promise.resolve('unaccepted async result');}),/synchronous_conversation_read_required/);
  assert.throws(()=>escaped.messageMetadata(m.id),/conversation_read_batch_closed/);
  assert.equal(core.conversationBatch,null);
  core.atomic(()=>core.graph.markUnavailable(m.id));
  assert.equal(core.canonicalConversationReadBatch((v:ConversationReadView)=>v.messageMetadata(m.id)),null);
  assert.equal(Object.keys((await f.core.command('snapshot',{})).executions).length,0);
 }finally{await f.close();}
});

test('real Core browse uses bodyless canonical metadata and retained lazy reads recheck current revocation and access',async()=>{
 const f=fixture();try{
  const conversation=await f.core.command('createConversation',{title:'Metadata-only synthetic chat',providerId:'local',commandId:crypto.randomUUID()});
  const message=await f.core.command('addMessage',{resourceId:conversation.resourceId,role:'user',content:'Synthetic retained source',expectedRevision:1});
  const internal=f.core as any,view:ConversationReadView=internal.conversationReadView(),gid=view.resourceMap[conversation.resourceId];
  const graphSnapshot=internal.graph.snapshot,desktopSnapshot=internal.desktop.snapshot,getResource=internal.kernel.getResource,visibleMessages=internal.graph.visibleMessages;
  try{
   internal.graph.snapshot=()=>{throw new Error('browse cloned all transcripts');};
   internal.desktop.snapshot=()=>{throw new Error('browse hydrated desktop bodies');};
   internal.kernel.getResource=()=>{throw new Error('browse read resource content');};
   internal.graph.visibleMessages=()=>{throw new Error('browse read complete histories');};
   const listed=await product(f.core,'list',{limit:50});assert.equal(listed.total,1);assert.equal(listed.items[0].messageCount,1);assert.equal(listed.items[0].historyMetadataStatus,'complete');
   assert.equal((await product(f.core,'search',{text:''})).items[0].resourceId,conversation.resourceId);
   assert.deepEqual(view.messageMetadata(message.id),{id:message.id,conversationId:gid,createdAt:view.messageMetadata(message.id)!.createdAt});
  }finally{internal.graph.snapshot=graphSnapshot;internal.desktop.snapshot=desktopSnapshot;internal.kernel.getResource=getResource;internal.graph.visibleMessages=visibleMessages;}
  const access=internal.conversationAccess.access;
  internal.conversationAccess.access=()=>false;
  try{
   assert.equal(view.messageMetadata(message.id),null);
   assert.throws(()=>view.graph.visibleMessages(gid),/source_unavailable/);
   assert.throws(()=>view.resourceContent(conversation.resourceId),/source_unavailable/);
  }finally{internal.conversationAccess.access=access;}
  internal.atomic(()=>internal.graph.markUnavailable(message.id));
  assert.equal(view.messageMetadata(message.id),null);
  assert.deepEqual(view.graph.visibleMessages(gid),[]);
  assert.equal(view.graph.visibleMessageMetadata(gid,{limit:1,maxScan:4096,maxBodyBytes:131072,allow:()=>true}).limitedBy,'denied');
 }finally{await f.close();}
});
async function sourceContext(core:BackendCore){
 const parent=await core.command('createConversation',{title:'Synthetic native parent',providerId:'fixture-codex',commandId:crypto.randomUUID()}),origin=await core.command('addMessage',{resourceId:parent.resourceId,role:'user',content:'Synthetic common origin',expectedRevision:1});
 const child=await core.command('branch',{resourceId:parent.resourceId,messageId:origin.id,includeMessageIds:[origin.id],providerId:'local',title:'Synthetic child',commandId:crypto.randomUUID(),tokenBudget:32768});
 const finding=await core.command('addMessage',{resourceId:child.conversation.resourceId,role:'user',content:'Synthetic selected finding: pressure is 12.',expectedRevision:1});await core.command('addMessage',{resourceId:child.conversation.resourceId,role:'user',content:'Synthetic unrelated material not selected.',expectedRevision:2});
 const share=await product(core,'publish',{sourceResourceId:child.conversation.resourceId,sourceMessageId:finding.id,evidence:'reported'});await product(core,'inspectShare',{resourceId:parent.resourceId,shareId:share.id});await product(core,'attachShare',{resourceId:parent.resourceId,shareId:share.id,attach:true});
 return {parent,child,finding,share,input:{resourceId:parent.resourceId,content:'Answer this exact synthetic request.',expectedRevision:2,commandId:crypto.randomUUID()}};
}

test('real product create, local idempotent send, canonical folders, atomic organization and restart',async()=>{
 const f=fixture();try{
  let connections=0;const port=(f.core as unknown as {port:ProviderPort}).port;port.connect=async()=>{connections++;throw new Error('local_reads_must_not_connect');};
  const c=await product(f.core,'create',{title:'Synthetic local chat',commandId:crypto.randomUUID()});assert.equal((await product(f.core,'detail',{resourceId:c.resourceId})).conversation.providerId,'local');
  const input={resourceId:c.resourceId,content:'Synthetic searchable local request',expectedRevision:1,commandId:crypto.randomUUID()};const first=await product(f.core,'send',input);assert.deepEqual(await product(f.core,'send',input),first);assert.equal((await product(f.core,'detail',{resourceId:c.resourceId})).messages.total,1);
  const folder=await product(f.core,'organize',{type:'createCollection',title:'Synthetic folder',projectId:null}) as {id:string;version:number};await product(f.core,'organize',{type:'membership',collectionId:folder.id,resourceId:c.resourceId,member:true,expectedVersion:1});await product(f.core,'organize',{type:'membership',collectionId:folder.id,resourceId:c.resourceId,member:true,expectedVersion:2});
  const before=await f.core.command('snapshot',{});await product(f.core,'organize',{type:'renameConversation',resourceId:c.resourceId,title:'Renamed synthetic conversation',expectedVersion:1,expectedRevision:2});await assert.rejects(product(f.core,'organize',{type:'renameConversation',resourceId:c.resourceId,title:'Stale rename',expectedVersion:1,expectedRevision:2}),/stale_resource_version/);
  const desktop=await f.core.command('desktop',{type:'createProject',title:'Synthetic organization project'}),p=desktop.projects[0];await product(f.core,'organize',{type:'associateProject',resourceId:c.resourceId,projectId:p.id,expectedVersion:2});await product(f.core,'favorite',{resourceId:c.resourceId,favorite:true});
  assert.deepEqual((await f.core.command('snapshot',{})).graph.messages,before.graph.messages);assert.equal(connections,0,'ordinary local history/organization/send must never start a provider connection');await f.reopen();const restored=await product(f.core,'detail',{resourceId:c.resourceId});assert.equal(restored.conversation.title,'Renamed synthetic conversation');assert.equal(restored.conversation.projectId,p.id);assert.equal(restored.conversation.favorite,true);assert.equal(restored.conversation.conversationId,before.resourceMap[c.resourceId]);assert.equal((await product(f.core,'search',{text:'searchable local',collectionId:folder.id,projectId:p.id})).total,1);
 }finally{await f.close();}
});

test('native send requires exact nonexpired grant and revalidates stale revisions and attached scope',async()=>{
 const f=fixture();try{
  const setup=await sourceContext(f.core);await assert.rejects(f.core.command('conversationSend',{previewId:'missing',grantId:'missing',fingerprint:'missing',commandId:setup.input.commandId}),/native_send_grant_required/);
  const preview=await f.core.command('conversationSendPreview',setup.input);await assert.rejects(f.core.command('authorizeConversationSend',{previewId:preview.id,fingerprint:'wrong',commandId:setup.input.commandId}),/approval_scope_mismatch/);
  await f.core.command('addMessage',{resourceId:setup.parent.resourceId,role:'user',content:'Concurrent synthetic change',expectedRevision:2});await assert.rejects(f.core.command('authorizeConversationSend',{previewId:preview.id,fingerprint:preview.fingerprint,commandId:setup.input.commandId}),/stale_resource_version/);
  setup.input.expectedRevision=3;setup.input.commandId=crypto.randomUUID();const authorization=await approved(f.core,setup.input);await product(f.core,'revokeShare',{shareId:setup.share.id});await assert.rejects(f.core.command('conversationSend',authorization.dispatch),/stale_send_preview/);
  setup.input.commandId=crypto.randomUUID();const expiring=await approved(f.core,setup.input),clock=Date.now;try{Date.now=()=>clock()+61000;await assert.rejects(f.core.command('conversationSend',expiring.dispatch),/native_send_grant_expired/);}finally{Date.now=clock;}
  assert.equal(Object.keys((await f.core.command('snapshot',{})).executions).length,0);
 }finally{await f.close();}
});

test('a native Send grant that expires during context preparation never admits execution', async () => {
  const f = fixture();
  const clock = Date.now;
  const resume = gate();
  const entered = gate();
  try {
    const setup = await sourceContext(f.core);
    const { dispatch } = await approved(f.core, setup.input);
    const core = f.core as any;
    const grant = core.sendGrants.get(dispatch.grantId);
    const context = core.conversations.attachedContext.bind(core.conversations);
    core.conversations.attachedContext = async (id: string) => {
      entered.release();
      await resume.promise;
      return context(id);
    };
    const before = await f.core.command('snapshot', {});
    const sending = f.core.command('conversationSend', dispatch);
    await entered.promise;
    Date.now = () => Date.parse(grant.expiresAt) + 1;
    resume.release();
    await assert.rejects(sending, /native_send_grant_expired/);
    assert.equal(grant.consumed, false);
    const after = await f.core.command('snapshot', {});
    assert.deepEqual(after.executions, before.executions);
    assert.deepEqual(after.graph.messages, before.graph.messages);
  } finally {
    Date.now = clock;
    resume.release();
    await f.close();
  }
});

test('managed Codex cannot disclose terminal output after its attached source is revoked', async () => {
  const f = fixture();
  const held = gate();
  const resume = gate();
  let sending: Promise<unknown> | undefined;
  try {
    const setup = await sourceContext(f.core);
    const { dispatch } = await approved(f.core, setup.input);
    const core = f.core as any;
    const port = core.port as ProviderPort;
    const terminal = port.terminal.bind(port);
    port.terminal = async (threadId, turnId) => {
      const event = await terminal(threadId, turnId);
      held.release();
      await resume.promise;
      return event;
    };
    sending = f.core.command('conversationSend', dispatch);
    await held.promise;
    const beforeRevocation = await f.core.command('rendererEventPage', { recent: true });
    await product(f.core, 'revokeShare', { shareId: setup.share.id });
    const page = await f.core.command('rendererEventPage', { after: beforeRevocation.scannedThrough });
    const revocation = page.events.find(event => event.type === 'policy/share-revoked');
    assert(revocation && !revocation.resourceId && !JSON.stringify(revocation).includes(setup.share.id));
    assert.equal((await f.core.command('conversationActivity', { resourceIds: [setup.parent.resourceId] })).preview, null);
    resume.release();
    const execution = await sending as Awaited<ReturnType<BackendCore['execute']>>;
    assert.equal(execution.state, 'unknown');
    assert.equal(execution.errorCode, 'source_unavailable');
    assert(execution.turnId && execution.binding);
    const snapshot = await f.core.command('snapshot', {});
    const childId = snapshot.resourceMap[setup.parent.resourceId];
    assert(!snapshot.graph.messages.some(message => message.conversationId === childId && message.role === 'assistant'));
    assert.equal(core.active, null);
    await f.reopen();
    assert.equal((await f.core.command('snapshot', {})).executions[execution.id].state, 'unknown');
  } finally {
    resume.release();
    await sending?.catch(() => {});
    await f.close();
  }
});

test('a bound Codex turn cannot inherit late journal events from a prior turn on the same thread', async () => {
  const f = fixture();
  const waitingForTerminal = gate();
  const releaseTerminal = gate();
  let sending: ReturnType<BackendCore['execute']> | undefined;
  try {
    const chat = await f.core.command('createConversation', { providerId: 'fixture-codex', commandId: crypto.randomUUID() });
    const execute = (prompt: string) => f.core.command('execute', {
      resourceId: chat.resourceId, commandId: crypto.randomUUID(), prompt, authorized: true,
    });
    const first = await execute('Synthetic first Codex turn');
    assert.equal(first.state, 'provider_completed');
    assert(first.binding && first.turnId);
    const cursor = (await f.core.command('replay', { after: 0 })).latest;

    const core = f.core as any;
    const port = core.port as ProviderPort;
    const terminal = port.terminal.bind(port);
    port.terminal = async (threadId, turnId) => {
      waitingForTerminal.release();
      await releaseTerminal.promise;
      return terminal(threadId, turnId);
    };
    const connect = port.connect.bind(port);
    const prebindId = crypto.randomUUID();
    port.connect = async () => {
      assert.equal(core.active.binding, null);
      core.ingest({
        schemaVersion: 1, eventId: prebindId, sequence: core.sequence,
        provider: 'codex-app-server', providerThreadId: first.binding!.nativeThreadId, providerTurnId: first.turnId,
        method: 'item/agentMessage/delta', observedAt: new Date().toISOString(), observedAtSource: 'bridge-clock',
        providerTime: null, providerTimeSource: null, evidence: 'observed', terminalStatus: null,
        payload: { delta: 'Synthetic retired text before binding' },
      });
      await connect();
    };
    sending = execute('Synthetic successor Codex turn');
    await Promise.race([waitingForTerminal.promise, sending.then(() => { throw Error('Successor settled before terminal was held'); })]);
    const snapshot = await f.core.command('snapshot', {});
    const next = Object.values(snapshot.executions).find(execution => execution.id !== first.id);
    assert(next?.binding && next.turnId);
    assert.equal(next.state, 'running');
    assert.equal(next.binding.nativeThreadId, first.binding.nativeThreadId);
    assert.notEqual(next.turnId, first.turnId);

    const eventBase = {
      schemaVersion: 1, provider: 'codex-app-server', providerThreadId: first.binding.nativeThreadId,
      method: 'item/agentMessage/delta', observedAt: new Date().toISOString(), observedAtSource: 'bridge-clock',
      providerTime: null, providerTimeSource: null, evidence: 'observed', terminalStatus: null,
    };
    const emit = core.emit;
    const live: import('../src/contracts.mts').StreamEvent[] = [];
    core.emit = (event: import('../src/contracts.mts').StreamEvent) => { live.push(event); emit(event); };
    const ingest = (turnId: string, sequence: number, delta: string, threadless = false) => {
      const eventId = crypto.randomUUID();
      core.ingest({ ...eventBase, eventId, sequence, providerTurnId: turnId,
        ...(threadless ? { providerThreadId: null } : {}), payload: { delta } });
      return eventId;
    };
    const beforeInjection = await f.core.command('replay', { after: cursor });
    assert(!beforeInjection.events.some(event => event.nativeEventId === prebindId || event.type === 'stream/gap-or-reorder'));
    const afterBinding = beforeInjection.latest;
    const sequence = core.sequence as number;
    const staleFuture = ingest(first.turnId, sequence + 50, 'Synthetic retired future text', true);
    const staleNext = ingest(first.turnId, sequence + 1, 'Synthetic retired next text');
    const accepted = ingest(next.turnId, sequence + 2, ' Synthetic valid continuation');
    const gap = ingest(next.turnId, sequence + 4, ' Synthetic valid after real gap');
    releaseTerminal.release();
    assert.equal((await sending).state, 'provider_completed');

    const replay = (await f.core.command('replay', { after: afterBinding })).events;
    assert.deepEqual(replay.map(event => [event.type, event.nativeEventId, event.nativeSequence, event.executionId]), [
      ['item/agentMessage/delta', accepted, sequence + 2, next.id],
      ['stream/gap-or-reorder', null, null, next.id],
      ['item/agentMessage/delta', gap, sequence + 4, next.id],
    ]);
    assert.deepEqual(live.filter(event => event.payload.delta).map(event => [event.nativeEventId, event.turnId]), [
      [accepted, next.turnId], [gap, next.turnId],
    ]);
    assert(!live.some(event => event.nativeEventId === staleFuture || event.nativeEventId === staleNext));
    const after = await f.core.command('snapshot', {});
    const last = after.graph.messages.filter(message => message.role === 'assistant').at(-1);
    assert.equal(last?.content, 'INTEGRATION_OK Synthetic valid continuation Synthetic valid after real gap');
  } finally {
    releaseTerminal.release();
    await sending?.catch(() => {});
    await f.close();
  }
});

test('selective context is supplied only after real fixture turn acceptance; exact user text and receipts survive restart',async()=>{
 const f=fixture();try{
  const setup=await sourceContext(f.core);await f.core.command('capabilities',{});await assert.rejects(product(f.core,'send',setup.input),/native_send_approval_required/);
  const native=(f.core as unknown as {port:ProviderPort}).port,original=native.turn;let sent='';native.turn=async(thread,text,model)=>{sent=text;return original(thread,text,model);};
  const authorization=await approved(f.core,setup.input);assert.match(authorization.preview.executionText,/pressure is 12/);assert.doesNotMatch(authorization.preview.executionText,/unrelated material/);assert.equal((await product(f.core,'detail',{resourceId:setup.parent.resourceId})).shares[0].state,'attached');
  const execution=await f.core.command('conversationSend',authorization.dispatch);assert.equal(execution.state,'provider_completed');assert.equal(sent,authorization.preview.executionText);await assert.rejects(f.core.command('conversationSend',authorization.dispatch),/native_send_grant_consumed/);
  const snapshot=await f.core.command('snapshot',{}),own=snapshot.graph.messages.filter(m=>m.conversationId===snapshot.resourceMap[setup.parent.resourceId]&&m.role==='user');assert.equal(own.at(-1)!.content,setup.input.content);assert.ok(!own.some(m=>m.content.includes('pressure is 12')));assert.equal(snapshot.graph.messages.filter(m=>m.id===setup.finding.id).length,1);
  await f.reopen();const detail=await product(f.core,'detail',{resourceId:setup.parent.resourceId});assert.equal(detail.shares[0].state,'sent');assert.equal(detail.shares[0].executionId,execution.id);assert.equal(detail.shares[0].attached,true);
 }finally{await f.close();}
});

test('provider failure keeps raw user request, without marking attached content sent',async()=>{
 for(const mode of ['unavailable','unknown-outcome']){const f=fixture(mode);try{
  const setup=await sourceContext(f.core),authorization=await approved(f.core,setup.input),execution=await f.core.command('conversationSend',authorization.dispatch);assert.equal(execution.state,mode==='unavailable'?'failed':'unknown');const detail=await product(f.core,'detail',{resourceId:setup.parent.resourceId});assert.equal(detail.messages.items.at(-1)!.content,setup.input.content);assert.equal(detail.shares[0].state,'attached');assert.equal(detail.shares[0].executionId,undefined);assert.ok(!detail.messages.items.some(m=>m.role==='assistant'));
 }finally{await f.close();}}
});

test('conversation reads remain live during execution while graph mutations are fenced',async()=>{
 const f=fixture('wait-interrupt');try{
  const setup=await sourceContext(f.core),authorization=await approved(f.core,setup.input),running=f.core.command('conversationSend',authorization.dispatch);let executionId='';
  for(let attempt=0;attempt<50;attempt++){const snapshot=await f.core.command('snapshot',{}),e=Object.values(snapshot.executions)[0];if(e?.turnId){executionId=e.id;break;}await new Promise(resolve=>setTimeout(resolve,10));}assert.ok(executionId);
  assert.ok((await product(f.core,'search',{text:'common origin'})).total>0);assert.equal((await product(f.core,'detail',{resourceId:setup.parent.resourceId})).shares[0].state,'sent');await assert.rejects(product(f.core,'organize',{type:'createCollection',title:'Must wait',projectId:null}),/execution_busy/);
  await f.core.command('interrupt',{executionId});assert.equal((await running).state,'interrupted');
 }finally{await f.close();}
});
