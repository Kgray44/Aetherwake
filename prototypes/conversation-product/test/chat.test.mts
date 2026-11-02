import test from 'node:test';
import assert from 'node:assert/strict';
import { mountConversationChat, composerShouldSubmit, type ConversationExecutionObservation, type ConversationMessageAction } from '../src/chat.ts';
import { mountConversationManager } from '../src/ui.ts';
import { ConversationDraftSession } from '../src/draft-session.ts';
import { markdownBlocks, renderMarkdown } from '../src/markdown.ts';
import type { ConversationProductPort, Detail } from '../src/contracts.ts';
import { componentDocument, named, until } from './component-dom.mts';

/** Synthetic port receipts only: these tests make no database, provider, native-window or network claims. */
function fixture(providerId='local') {
  const view=componentDocument(),restore=view.install(),calls:{name:string;input:any}[]=[];
  let draft={resourceId:'chat:synthetic',version:3,content:'Saved unsent text',updatedAt:'2026-11-02T00:00:00Z'},denied=false,detailGate:Promise<void>|null=null;
  const detail:Detail={conversation:{resourceId:draft.resourceId,conversationId:'graph:synthetic',title:'Synthetic conversation',providerId,revision:2,version:1,projectId:null,projectIds:[],state:'active',createdAt:'2026-11-02T00:00:00Z',favorite:false,messageCount:2,collectionIds:[]},messages:{items:[{id:'message:user',resourceId:draft.resourceId,role:'user',content:'A user message',createdAt:'2026-11-02T00:00:00Z',provenance:'user',inherited:false,sensitivity:'internal'},{id:'message:assistant',resourceId:draft.resourceId,role:'assistant',content:'A **readable** response.\n\n```ts\nconst answer = 42;\n```',createdAt:'2026-11-02T00:00:01Z',provenance:'application',inherited:false,sensitivity:'internal'}],total:2,offset:0,limit:50,hasMore:false},lineage:[],policy:{resourceId:draft.resourceId,revision:1,mode:'independent',allowedSourceIds:[],allowCrossProject:false,maxSensitivity:'internal',categories:['excerpt']},shares:[],providers:[{id:providerId,label:providerId==='local'?'Local recording':'Native Codex',available:true,record:true,execute:providerId!=='local',nativeFork:false,history:'local',simulated:false,models:[]}]};
  let pending: {input:any;resolve:(value:unknown)=>void;reject:(error:Error)=>void}|null=null;
  const port={async command(name:string,input:any):Promise<any>{calls.push({name,input});if(denied)throw new Error('source_unavailable');
    if(name==='readDraft')return {...draft};if(name==='saveDraft'){if(input.expectedVersion!==draft.version)throw new Error('stale_draft_version');draft={...draft,version:draft.version+1,content:input.content};return {...draft};}
    if(name==='detail'){const captured=structuredClone(detail);await detailGate;return captured;}if(name==='send')return new Promise((resolve,reject)=>{pending={input,resolve,reject};}).finally(()=>{pending=null;});
    if(name==='providers')return detail.providers;if(name==='collections'||name==='projects')return [];if(name==='search')return {items:[],total:0,offset:0,limit:50,hasMore:false};throw new Error('Unexpected command '+name);
  }} as ConversationProductPort;
  const accept=(execution=false)=>{assert.ok(pending);const item={...detail.messages.items[0],id:'message:sent:'+detail.conversation.revision,content:pending.input.content};detail.messages.items.push(item);detail.messages.total++;detail.conversation.messageCount++;detail.conversation.revision++;const p=pending;pending=null;p.resolve(execution?{id:'execution:synthetic',resourceId:draft.resourceId,providerId,commandId:p.input.commandId,state:'provider_completed',taskVerified:false}:{...item,revision:detail.conversation.revision});};
  return {view,port,calls,detail,restore,accept,get pending(){return pending;},get draft(){return {...draft};},deny(value=true){denied=value;},gateDetail(gate:Promise<void>|null){detailGate=gate;},external(content:string){draft={...draft,version:draft.version+1,content};}};
}

test('safe Markdown supports readable code/list/inline text without executing HTML, script links or remote media',async()=>{
  const view=componentDocument(),restore=view.install();try{
    assert.deepEqual(markdownBlocks('# Heading\n\n- one\n- two\n\n```ts\nconst x = 1;\n```').map(b=>b.kind),['heading','list','code']);
    const copies:string[]=[];const rendered=renderMarkdown('<script>alert(1)</script> **bold** [unsafe](javascript:evil) ![image](https://example.test/x)\n\n```js\nconst exact = "<";\n```',async text=>{copies.push(text);},()=>{});
    assert.equal(rendered.querySelector('script'),null);assert.match(rendered.textContent,/<script>alert\(1\)<\/script>/);assert.equal(rendered.querySelector('img'),null);assert.equal([...rendered.querySelectorAll('a')].some((a:any)=>a.href?.startsWith('javascript:')),false);assert.equal(rendered.querySelector('strong')!.textContent,'bold');
    named(rendered,'Copy code').fire('click');await until(()=>copies.length===1);assert.deepEqual(copies,['const exact = "<";']);
  }finally{restore();}
});

test('mounted canonical chat reads only; refresh preserves composer, caret, keyed messages and scroll',async()=>{
  const f=fixture();let chat;try{chat=mountConversationChat(f.view.root,{port:f.port,resourceId:f.draft.resourceId});await chat.ready;
    assert.ok(f.calls.every(c=>['readDraft','detail'].includes(c.name)));const editor=f.view.root.querySelector('textarea'),article=f.view.root.querySelector('.cp-message'),messages=f.view.root.querySelector('.cp-messages');
    editor.focus();editor.setSelectionRange(3,8);messages.scrollTop=37;await chat.refresh();assert.equal(f.view.root.querySelector('textarea'),editor);assert.equal(f.view.root.querySelector('.cp-message'),article);assert.equal(editor.value,'Saved unsent text');assert.deepEqual([editor.selectionStart,editor.selectionEnd],[3,8]);assert.equal(messages.scrollTop,37);assert.equal(f.view.root.querySelector('.cp-composer-provider').textContent,'Local recording');
    assert.equal(f.view.root.querySelector('.cp-code').querySelector('code').textContent,'const answer = 42;');assert.equal(f.view.root.querySelectorAll('.cp-message-actions').every((n:any)=>!n.open),true);
  }finally{await chat?.dispose();f.restore();}
});

test('continued ordered Markdown lists preserve their actual starting number and text',()=>{
  const view=componentDocument(),restore=view.install();try{
    const source='Earlier steps remain in history.\n\n4. Inspect the canonical source\n5. Continue after review\n\nNext section.\n\n9. Preserve this continuation';
    const blocks=markdownBlocks(source),ordered=blocks.filter(block=>block.kind==='list');assert.deepEqual(ordered.map(block=>block.start),[4,9]);assert.deepEqual(ordered[0].items,['Inspect the canonical source','Continue after review']);
    const rendered=renderMarkdown(source,async()=>{},()=>{}),lists=rendered.querySelectorAll('ol');assert.equal(lists[0].getAttribute('start'),'4');assert.equal(lists[0].querySelectorAll('li').length,2);assert.equal(lists[1].getAttribute('start'),'9');assert.equal(lists[1].textContent,'Preserve this continuation');
    const unsupported='999999999999999999999. Keep the unsupported number literal';assert.deepEqual(markdownBlocks(unsupported),[{kind:'paragraph',text:unsupported}]);assert.equal(renderMarkdown(unsupported,async()=>{},()=>{}).querySelector('ol'),null);
  }finally{restore();}
});

test('Enter submits once; Shift+Enter and IME do not submit; draft draining is independent of a pending send',async()=>{
  const f=fixture();let chat;try{chat=mountConversationChat(f.view.root,{port:f.port,resourceId:f.draft.resourceId});await chat.ready;const editor=f.view.root.querySelector('textarea');
    editor.fire('keydown',{key:'Enter',shiftKey:true});editor.fire('compositionstart');editor.fire('keydown',{key:'Enter'});assert.equal(f.pending,null);editor.fire('compositionend');
    editor.value='Exact submitted text';editor.fire('input');const entered=editor.fire('keydown',{key:'Enter'});assert.equal(entered.defaultPrevented,true);await until(()=>!!f.pending);assert.equal(f.pending!.input.content,'Exact submitted text');assert.equal(f.draft.content,'Exact submitted text');
    editor.value='Later typing while native approval waits';editor.fire('input');let drained=false;const drain=chat.flush().then(()=>{drained=true;});await until(()=>drained);assert.ok(f.pending,'Provider/native send is still pending after draft drain');assert.equal(f.draft.content,editor.value);f.accept();await drain;await chat.whenSubmissionSettled();
    assert.equal(editor.value,'Later typing while native approval waits');assert.equal(f.draft.content,editor.value);assert.equal(f.calls.filter(c=>c.name==='send').length,1);assert.match(f.view.root.querySelector('.cp-chat-status').textContent,/Later draft edits/);
  }finally{await chat?.dispose();f.restore();}
});

test('accepted local send clears only its captured CAS draft; unknown and native-cancelled sends retain recovery',async()=>{
  const f=fixture();let chat;try{chat=mountConversationChat(f.view.root,{port:f.port,resourceId:f.draft.resourceId});await chat.ready;const editor=f.view.root.querySelector('textarea'),form=f.view.root.querySelector('.cp-composer');
    form.fire('submit');await until(()=>!!f.pending);f.accept();await chat.whenSubmissionSettled();assert.equal(editor.value,'');assert.equal(f.draft.content,'');assert.ok(f.draft.version>3);
    editor.value='Native cancelled request';editor.fire('input');form.fire('submit');await until(()=>!!f.pending);f.pending!.reject(new Error('authorization_cancelled'));await chat.whenSubmissionSettled();assert.equal(editor.value,'Native cancelled request');assert.match(f.view.root.querySelector('.cp-chat-status').textContent,/cancelled/);
    form.fire('submit');await until(()=>!!f.pending);f.pending!.resolve({id:'execution:unknown',resourceId:f.draft.resourceId,state:'unknown'});await chat.whenSubmissionSettled();assert.equal(editor.value,'Native cancelled request');assert.equal(named(form,'Record message').disabled,true);const sends=f.calls.filter(c=>c.name==='send').length;named(f.view.root,'I reviewed the send outcome').fire('click');assert.equal(f.calls.filter(c=>c.name==='send').length,sends);
  }finally{await chat?.dispose();f.restore();}
});

test('real-observation port alone drives live text/cancel; foreign, duplicate and regressive events cannot fabricate activity',async()=>{
  const f=fixture('codex:native');let chat,observe:((value:ConversationExecutionObservation)=>void)|undefined;const cancellations:string[]=[];let unsubscribed=false;
  try{chat=mountConversationChat(f.view.root,{port:f.port,resourceId:f.draft.resourceId,execution:{observe(_id,listener){observe=listener;return()=>{unsubscribed=true;};},async cancel(id){cancellations.push(id);return {requested:true,confirmed:false};}}});await chat.ready;
    const execution={id:'execution:observed',resourceId:f.draft.resourceId,providerId:'codex:native',commandId:'command:observed',state:'running' as const,startedAt:'2026-11-02T00:00:00Z',endedAt:null,taskVerified:false as const};
    observe!({execution:{...execution,resourceId:'chat:other'},delta:{eventId:'foreign',cursor:1,text:'Not this chat'}});assert.equal(f.view.root.querySelector('.cp-stream').hidden,true);
    observe!({execution});observe!({execution,delta:{eventId:'event:2',cursor:2,text:'Actual synthetic delta'}});observe!({execution,delta:{eventId:'event:2',cursor:2,text:' duplicated'}});assert.equal(f.view.root.querySelector('.cp-stream-text').textContent,'Actual synthetic delta');assert.equal(named(f.view.root,'Stop').hidden,false);assert.equal(named(f.view.root,'Send').disabled,true);
    observe!({connection:'unavailable'});assert.match(f.view.root.querySelector('.cp-chat-status').textContent,/Last observed: running.*unconfirmed/);assert.equal(f.view.root.querySelector('.cp-chat').dataset.executionState,'running');assert.equal(named(f.view.root,'Stop').disabled,true);observe!({execution,connection:'available'});
    await chat.refresh();assert.equal(f.view.root.querySelectorAll('.cp-message').length,2,'History reads remain usable while running');named(f.view.root,'Stop').fire('click');await until(()=>cancellations.length===1);assert.deepEqual(cancellations,[execution.id]);assert.equal(f.view.root.querySelector('.cp-chat').dataset.executionState,'running','Cancellation request is not confirmed cancellation');
    observe!({execution:{...execution,state:'interrupted',endedAt:'2026-11-02T00:00:02Z'}});observe!({execution});assert.equal(f.view.root.querySelector('.cp-chat').dataset.executionState,'interrupted');assert.equal(f.view.root.querySelector('.cp-stream').hidden,true);
  }finally{await chat?.dispose();assert.equal(unsubscribed,true);f.restore();}
});

test('externally owned draft session survives unmount; explicit conflict resolution is required and publication retains exact source offsets',async()=>{
  const f=fixture();const session=new ConversationDraftSession({port:f.port,resourceId:f.draft.resourceId});let chat;const actions:ConversationMessageAction[]=[];
  try{f.detail.messages.items[1].content='Before **αβ 🧭** after';f.detail.messages.items[1].resourceId='chat:source';f.detail.messages.items[1].inherited=true;
    chat=mountConversationChat(f.view.root,{port:f.port,resourceId:f.draft.resourceId,draftSession:session,onMessageAction:event=>{actions.push(event);}});await chat.ready;
    const raw=f.view.root.querySelectorAll('.cp-message-raw')[1],text='αβ 🧭',start=raw.textContent.indexOf(text);f.view.select({isCollapsed:false,rangeCount:1,anchorNode:raw.firstChild,focusNode:raw.firstChild,getRangeAt:()=>({startContainer:raw.firstChild,startOffset:start,toString:()=>text})});raw.fire('mouseup');const publish=f.view.root.querySelectorAll('.cp-message-actions')[1];named(publish,'Publish selected excerpt').fire('click');assert.deepEqual(actions[0].selection,{start,end:start+text.length,text});assert.equal(actions[0].message.resourceId,'chat:source');assert.equal(f.calls.some(c=>c.name==='publish'),false,'Component delegates reviewed source operation; never publishes itself');
    f.external('Competing durable draft');session.update('Local recovery');await assert.rejects(chat.flush(),/stale_draft_version/);assert.equal(named(f.view.root,'Record message').disabled,true);named(f.view.root,'Keep this editor’s draft').fire('click');await until(()=>session.snapshot().phase==='clean');assert.equal(f.draft.content,'Local recovery');await chat.dispose();chat=undefined;session.update('Owner can still edit');await session.flush();assert.equal(f.draft.content,'Owner can still edit');
  }finally{await chat?.dispose();await session.dispose();f.restore();}
});

test('reopening an ongoing execution restores only its scoped complete preview then appends strictly later deltas without a duplicate prefix',async()=>{
  const f=fixture('codex:native');let chat,observe:((value:ConversationExecutionObservation)=>void)|undefined;
  const execution={id:'execution:ongoing',resourceId:f.draft.resourceId,providerId:'codex:native',commandId:'command:ongoing',state:'running' as const,startedAt:'2026-11-02T00:00:00Z',endedAt:null,taskVerified:false as const};
  const executionPort={observe(_id:string,listener:(value:ConversationExecutionObservation)=>void){observe=listener;return()=>{};},async cancel(){}};
  try{chat=mountConversationChat(f.view.root,{port:f.port,resourceId:f.draft.resourceId,execution:executionPort});await chat.ready;observe!({execution,delta:{eventId:'event:10',cursor:10,text:'Earlier live prefix'}});await chat.dispose();
    chat=mountConversationChat(f.view.root,{port:f.port,resourceId:f.draft.resourceId,execution:executionPort});await chat.ready;assert.equal(f.view.root.querySelector('.cp-stream-text').textContent,'','A new view never reconstructs output from its own discarded DOM');
    observe!({execution,preview:{executionId:execution.id,cursor:20,text:'Earlier live prefix plus output while closed'}});assert.equal(f.view.root.querySelector('.cp-stream-text').textContent,'Earlier live prefix plus output while closed');
    observe!({execution,delta:{eventId:'event:20',cursor:20,text:' plus output while closed'}});observe!({execution,delta:{eventId:'event:21',cursor:21,text:' and the next delta'}});
    const complete='Earlier live prefix plus output while closed and the next delta';assert.equal(f.view.root.querySelector('.cp-stream-text').textContent,complete);
    observe!({preview:{executionId:execution.id,cursor:19,text:'Older snapshot'}});observe!({preview:{executionId:'execution:other',cursor:99,text:'Wrong execution'}});observe!({preview:{executionId:execution.id,cursor:-1,text:'Invalid cursor'}});assert.equal(f.view.root.querySelector('.cp-stream-text').textContent,complete);
    observe!({preview:{executionId:execution.id,cursor:21,text:complete}});observe!({execution,delta:{eventId:'event:21',cursor:21,text:' duplicate'}});assert.equal(f.view.root.querySelector('.cp-stream-text').textContent,complete);assert.equal(f.calls.some(c=>c.name==='send'),false);assert.equal(f.view.root.querySelector('.cp-chat').dataset.executionState,'running');
    observe!({execution:{...execution,state:'provider_completed',endedAt:'2026-11-02T00:00:10Z'},preview:{executionId:execution.id,cursor:22,text:'Not a committed assistant message'}});assert.equal(f.view.root.querySelector('.cp-stream').hidden,true);assert.equal(f.detail.messages.items.length,2,'A live preview never writes a transcript or claims completion output');
  }finally{await chat?.dispose();f.restore();}
});

test('explicit resource loss clears visible context and invalidates in-flight detail; only an authorized reload can restore the same draft',async()=>{
  const f=fixture('codex:native'),shared=new ConversationDraftSession({port:f.port,resourceId:f.draft.resourceId});let chat,observe:((value:ConversationExecutionObservation)=>void)|undefined,unavailable=0,release!:()=>void;
  const execution={id:'execution:access',resourceId:f.draft.resourceId,providerId:'codex:native',commandId:'command:access',state:'running' as const,startedAt:'2026-11-02T00:00:00Z',endedAt:null,taskVerified:false as const};
  f.detail.shares.push({id:'share:attached',sourceResourceId:'chat:source',sourceMessageId:'message:source',sourceTime:'2026-11-02T00:00:00Z',digest:'a'.repeat(64),range:{start:0,end:6},evidence:'excerpt',createdAt:'2026-11-02T00:00:00Z',status:'current',supersedes:null,supersededBy:[],state:'attached',attached:true,targetResourceId:f.draft.resourceId});
  try{chat=mountConversationChat(f.view.root,{port:f.port,resourceId:f.draft.resourceId,draftSession:shared,onUnavailable:()=>{unavailable++;},execution:{observe(_id,listener){observe=listener;return()=>{};},async cancel(){throw new Error('No implicit interruption');}}});await chat.ready;assert.match(f.view.root.querySelector('.cp-context-note').textContent,/1 source excerpt attached/);observe!({execution,preview:{executionId:execution.id,cursor:30,text:'Observed live output before access loss'}});
    const editor=f.view.root.querySelector('textarea');editor.value='Exact unsent recovery 🧭';editor.fire('input');await chat.flush();const saved=f.draft;
    const gate=new Promise<void>(resolve=>{release=resolve;});f.gateDetail(gate);const pending=chat.refresh();observe!({resourceAvailable:false});assert.equal(f.view.root.querySelectorAll('.cp-message').length,0);assert.equal(f.view.root.querySelector('.cp-stream-text').textContent,'');assert.equal(f.view.root.querySelector('.cp-context-note').textContent,'');assert.equal(f.view.root.querySelector('.cp-composer').hidden,true);assert.equal(named(f.view.root,'Send').disabled,true);assert.equal(unavailable,1);
    release();await pending;assert.equal(f.view.root.querySelectorAll('.cp-message').length,0,'A pre-revocation successful response cannot re-expose stale content');
    observe!({resourceAvailable:true,execution,preview:{executionId:execution.id,cursor:31,text:'Must stay hidden'}});assert.equal(f.view.root.querySelector('.cp-chat').dataset.resourceAvailable,'false');assert.equal(f.view.root.querySelector('.cp-stream-text').textContent,'');assert.deepEqual(f.draft,saved);assert.equal(shared.snapshot().content,saved.content);
    f.gateDetail(null);f.deny();await assert.rejects(chat.refresh(),/source_unavailable/);assert.equal(unavailable,1);f.deny(false);await chat.refresh();assert.equal(f.view.root.querySelector('.cp-chat').dataset.resourceAvailable,'true');assert.equal(editor.value,saved.content);assert.equal(f.view.root.querySelectorAll('.cp-message').length,2);
    observe!({execution,preview:{executionId:execution.id,cursor:32,text:'Authorized live output after restoration'}});assert.equal(f.view.root.querySelector('.cp-stream-text').textContent,'Authorized live output after restoration');assert.equal(f.calls.some(c=>c.name==='send'),false);
  }finally{release?.();await chat?.dispose();shared.update('Host still owns its draft after component close');await shared.flush();await shared.dispose();f.restore();}
});

test('revoked detail is removed from view without erasing the retained unsent draft',async()=>{
  const f=fixture();let chat,observe:((value:ConversationExecutionObservation)=>void)|undefined,unavailable=false;
  try{chat=mountConversationChat(f.view.root,{port:f.port,resourceId:f.draft.resourceId,onUnavailable:()=>{unavailable=true;},execution:{observe(_id,listener){observe=listener;return()=>{};},async cancel(){}}});await chat.ready;f.deny();await assert.rejects(chat.refresh(),/source_unavailable/);assert.equal(f.view.root.querySelectorAll('.cp-message').length,0);assert.equal(f.view.root.querySelector('.cp-composer').hidden,true);assert.equal(f.draft.content,'Saved unsent text');assert.equal(unavailable,true);
    observe!({execution:{id:'execution:revoked',resourceId:f.draft.resourceId,providerId:'codex:native',commandId:'command:revoked',state:'running',startedAt:'2026-11-02T00:00:00Z',endedAt:null,taskVerified:false},delta:{eventId:'event:revoked',cursor:1,text:'Must remain hidden'}});assert.equal(f.view.root.querySelector('.cp-stream').hidden,true);assert.equal(f.view.root.querySelector('.cp-stream-text').textContent,'');}
  finally{await chat?.dispose();f.restore();}
});

test('global manager mounts the same chat component with contextual extras and stable canonical identity',async()=>{
  const f=fixture();let manager;try{manager=mountConversationManager(f.view.root,f.port,{resourceId:f.draft.resourceId});await manager.ready;assert.equal(f.view.root.querySelectorAll('.cp-chat').length,1);assert.equal(f.view.root.querySelectorAll('.cp-composer').length,1);assert.equal(f.view.root.querySelector('.cp-chat-extras').open,false);const editor=f.view.root.querySelector('textarea');await manager.refresh();assert.equal(f.view.root.querySelector('textarea'),editor);assert.equal(f.view.root.querySelector('.cp-chat').dataset.resourceId,f.draft.resourceId);assert.equal(f.calls.some(c=>c.name==='send'),false);}
  finally{await manager?.dispose();f.restore();}
});

test('manager and inline component share one externally owned draft, with independent listeners and lifecycle',async()=>{
  const f=fixture(),shared=new ConversationDraftSession({port:f.port,resourceId:f.draft.resourceId});let manager,inline;
  try{const inlineHost=f.view.doc.createElement('aside');f.view.root.append(inlineHost);inline=mountConversationChat(inlineHost,{port:f.port,resourceId:f.draft.resourceId,draftSession:shared});await inline.ready;
    const managerHost=f.view.doc.createElement('main');f.view.root.append(managerHost);manager=mountConversationManager(managerHost,f.port,{resourceId:f.draft.resourceId,draftSession:()=>shared});await manager.ready;
    const editor=inlineHost.querySelector('textarea'),other=managerHost.querySelector('textarea');editor.value='One shared draft, two views';editor.fire('input');assert.equal(other.value,editor.value);await manager.dispose();manager=undefined;
    editor.value='Inline owner continues';editor.fire('input');await shared.flush();assert.equal(f.draft.content,'Inline owner continues');await inline.dispose();inline=undefined;shared.update('Root owner continues');await shared.flush();assert.equal(f.draft.content,'Root owner continues');
  }finally{await manager?.dispose();await inline?.dispose();await shared.dispose();f.restore();}
});

test('provider failure remains visible and never clears or automatically replays a submission',async()=>{
  const f=fixture('codex:native');let chat;try{chat=mountConversationChat(f.view.root,{port:f.port,resourceId:f.draft.resourceId});await chat.ready;const form=f.view.root.querySelector('.cp-composer');form.fire('submit');await until(()=>!!f.pending);assert.match(f.view.root.querySelector('.cp-chat-status').textContent,/native send review/);f.pending!.reject(new Error('provider_unavailable'));await chat.whenSubmissionSettled();assert.match(f.view.root.querySelector('.cp-chat-status').textContent,/provider_unavailable/);assert.equal(f.draft.content,'Saved unsent text');assert.equal(f.calls.filter(c=>c.name==='send').length,1);assert.equal(named(form,'Send').disabled,true);}
  finally{await chat?.dispose();f.restore();}
});

test('closing an internally owned chat promptly detaches during a deferred provider turn; later typing and eventual canonical acceptance stay durable',async()=>{
  const f=fixture('codex:native');let chat,changed=0,released=0,interrupts=0,unsubscribed=false;
  const originalDispose=ConversationDraftSession.prototype.dispose;
  ConversationDraftSession.prototype.dispose=async function(){released++;await originalDispose.call(this);};
  try{chat=mountConversationChat(f.view.root,{port:f.port,resourceId:f.draft.resourceId,onChanged:()=>{changed++;},execution:{observe(){return()=>{unsubscribed=true;};},async cancel(){interrupts++;}}});await chat.ready;
    const editor=f.view.root.querySelector('textarea');editor.value='Submitted before a long provider turn';editor.fire('input');f.view.root.querySelector('.cp-composer').fire('submit');await until(()=>!!f.pending);
    const settled=chat.whenSubmissionSettled();editor.value='Exact later 🧭 typing while turn runs';editor.fire('input');let flushed=false;void chat.flush().then(()=>{flushed=true;});await until(()=>flushed);const saved=f.draft;assert.equal(saved.content,editor.value);
    let closed=false;void chat.dispose().then(()=>{closed=true;});await until(()=>closed);assert.equal(released,0,'The pending internally owned session remains alive for exact acceptance work');assert.ok(f.pending,'Closing did not wait for or cancel the provider');assert.equal(unsubscribed,true);assert.equal(f.view.root.querySelector('.cp-chat'),null);assert.equal(interrupts,0);assert.equal(f.calls.filter(c=>c.name==='send').length,1);
    f.accept(true);await settled;await until(()=>released===1);assert.equal(changed,0,'Detached acceptance must not refresh or re-open its closed host view');assert.deepEqual(f.draft,saved,'Later durable text and its revision survive the captured submission acknowledgement');assert.equal(f.detail.messages.items.at(-1)?.content,'Submitted before a long provider turn');assert.equal(interrupts,0);assert.equal(f.calls.filter(c=>c.name==='send').length,1);
  }finally{f.pending?.reject(new Error('synthetic cleanup'));await chat?.whenSubmissionSettled();await chat?.dispose();ConversationDraftSession.prototype.dispose=originalDispose;f.restore();}
});

test('standalone manager closes during a pending turn, retains its owned coordinator until settlement, and clears only an exact accepted draft',async()=>{
  const f=fixture('codex:native');let manager;
  try{manager=mountConversationManager(f.view.root,f.port,{resourceId:f.draft.resourceId});await manager.ready;f.view.root.querySelector('.cp-composer').fire('submit');await until(()=>!!f.pending);const saved=f.draft;
    let closed=false;void manager.dispose().then(()=>{closed=true;});await until(()=>closed);assert.ok(f.pending);assert.equal(f.view.root.querySelector('.cp-manager'),null);assert.equal(f.draft.content,saved.content);
    f.accept(true);await until(()=>f.draft.content==='');assert.equal(f.draft.version,saved.version+1);assert.equal(f.calls.filter(c=>c.name==='send').length,1);assert.equal(f.calls.some(c=>c.name==='interrupt'),false);
  }finally{f.pending?.reject(new Error('synthetic cleanup'));await manager?.dispose();f.restore();}
});

test('closing a shared view during a deferred turn never disposes its external session or clears later owner edits',async()=>{
  const f=fixture('codex:native'),shared=new ConversationDraftSession({port:f.port,resourceId:f.draft.resourceId});let chat;
  try{chat=mountConversationChat(f.view.root,{port:f.port,resourceId:f.draft.resourceId,draftSession:shared});await chat.ready;f.view.root.querySelector('.cp-composer').fire('submit');await until(()=>!!f.pending);const settled=chat.whenSubmissionSettled();
    let closed=false;void chat.dispose().then(()=>{closed=true;});await until(()=>closed);assert.ok(f.pending);shared.update('Owner editing after pane close');await shared.flush();f.accept(true);await settled;assert.equal(f.draft.content,'Owner editing after pane close');shared.update('Owner editing after receipt');await shared.flush();assert.equal(f.draft.content,'Owner editing after receipt');assert.equal(f.calls.filter(c=>c.name==='send').length,1);
  }finally{f.pending?.reject(new Error('synthetic cleanup'));await chat?.whenSubmissionSettled();await chat?.dispose();await shared.dispose();f.restore();}
});

test('a detached send rejection is caught and leaves exact durable recovery without replay',async()=>{
  const f=fixture('codex:native');let chat;
  try{chat=mountConversationChat(f.view.root,{port:f.port,resourceId:f.draft.resourceId});await chat.ready;f.view.root.querySelector('.cp-composer').fire('submit');await until(()=>!!f.pending);const settled=chat.whenSubmissionSettled();await chat.dispose();const saved=f.draft;f.pending!.reject(new Error('provider_unavailable'));await settled;await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(f.draft,saved);assert.equal(f.calls.filter(c=>c.name==='send').length,1);assert.equal(f.view.root.querySelector('.cp-chat'),null);}
  finally{f.pending?.reject(new Error('synthetic cleanup'));await chat?.whenSubmissionSettled();await chat?.dispose();f.restore();}
});

test('composer keyboard policy keeps newline and composition distinct from submit',()=>{
  const event={key:'Enter',shiftKey:false,isComposing:false,altKey:false,ctrlKey:false,metaKey:false};assert.equal(composerShouldSubmit(event),true);for(const field of ['shiftKey','isComposing','altKey']as const)assert.equal(composerShouldSubmit({...event,[field]:true}),false);assert.equal(composerShouldSubmit({...event,key:'Escape'}),false);
});
