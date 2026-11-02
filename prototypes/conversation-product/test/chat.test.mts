import test from 'node:test';
import assert from 'node:assert/strict';
import { mountConversationChat, composerShouldSubmit, type ConversationExecutionObservation, type ConversationMessageAction } from '../src/chat.ts';
import { mountConversationManager } from '../src/ui.ts';
import { ConversationDraftSession } from '../src/draft-session.ts';
import { markdownBlocks, renderMarkdown } from '../src/markdown.ts';
import type { ConversationProductPort, Detail, Collection, SearchHit } from '../src/contracts.ts';
import { componentDocument, named, until } from './component-dom.mts';

/** Synthetic port receipts only: these tests make no database, provider, native-window or network claims. */
function fixture(providerId='local') {
  const view=componentDocument(),restore=view.install(),calls:{name:string;input:any}[]=[];
  let draft={resourceId:'chat:synthetic',version:3,content:'Saved unsent text',updatedAt:'2026-11-02T00:00:00Z'},denied=false,detailGate:Promise<void>|null=null,searchError:string|null=null;
  const detail:Detail={conversation:{resourceId:draft.resourceId,conversationId:'graph:synthetic',title:'Synthetic conversation',providerId,revision:2,version:1,projectId:null,projectIds:[],state:'active',createdAt:'2026-11-02T00:00:00Z',favorite:false,messageCount:2,collectionIds:[]},messages:{items:[{id:'message:user',resourceId:draft.resourceId,role:'user',content:'A user message',createdAt:'2026-11-02T00:00:00Z',provenance:'user',inherited:false,sensitivity:'internal'},{id:'message:assistant',resourceId:draft.resourceId,role:'assistant',content:'A **readable** response.\n\n```ts\nconst answer = 42;\n```',createdAt:'2026-11-02T00:00:01Z',provenance:'application',inherited:false,sensitivity:'internal'}],total:2,offset:0,limit:50,hasMore:false},lineage:[],policy:{resourceId:draft.resourceId,revision:1,mode:'independent',allowedSourceIds:[],allowCrossProject:false,maxSensitivity:'internal',categories:['excerpt']},shares:[],providers:[{id:providerId,label:providerId==='local'?'Local recording':'Native Codex',available:true,record:true,execute:providerId!=='local',nativeFork:false,history:'local',simulated:false,models:[]}]};
  let pending: {input:any;resolve:(value:unknown)=>void;reject:(error:Error)=>void}|null=null;
  const collections:Collection[]=[],history={items:[] as SearchHit[],total:0};
  const port={async command(name:string,input:any):Promise<any>{calls.push({name,input});if(denied)throw new Error('source_unavailable');
    if(name==='readDraft')return {...draft};if(name==='saveDraft'){if(input.expectedVersion!==draft.version)throw new Error('stale_draft_version');draft={...draft,version:draft.version+1,content:input.content};return {...draft};}
    if(name==='detail'){const captured=structuredClone(detail);await detailGate;return captured;}if(name==='send')return new Promise((resolve,reject)=>{pending={input,resolve,reject};}).finally(()=>{pending=null;});
    if(name==='providers')return detail.providers;if(name==='collections')return structuredClone(collections);if(name==='projects')return [];if(name==='search'){if(searchError)throw new Error(searchError);return {...history,offset:input.offset??0,limit:50,hasMore:(input.offset??0)+50<history.total};}if(name==='favorite'){detail.conversation.favorite=input.favorite;return input.favorite;}throw new Error('Unexpected command '+name);
  }} as ConversationProductPort;
  const accept=(execution=false)=>{assert.ok(pending);const item={...detail.messages.items[0],id:'message:sent:'+detail.conversation.revision,content:pending.input.content};detail.messages.items.push(item);detail.messages.total++;detail.conversation.messageCount++;detail.conversation.revision++;const p=pending;pending=null;p.resolve(execution?{id:'execution:synthetic',resourceId:draft.resourceId,providerId,commandId:p.input.commandId,state:'provider_completed',taskVerified:false}:{...item,revision:detail.conversation.revision});};
  return {view,port,calls,detail,collections,history,restore,accept,get pending(){return pending;},get draft(){return {...draft};},deny(value=true){denied=value;},failSearch(error:string|null){searchError=error;},gateDetail(gate:Promise<void>|null){detailGate=gate;},external(content:string){draft={...draft,version:draft.version+1,content};}};
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

test('only an earlier successful send acknowledgement clears on new editor input; failures, unknown outcomes and conflicts remain',async()=>{
  const f=fixture(),session=new ConversationDraftSession({port:f.port,resourceId:f.draft.resourceId});let chat;
  try{chat=mountConversationChat(f.view.root,{port:f.port,resourceId:f.draft.resourceId,draftSession:session,presentation:'workspace'});await chat.ready;const editor=f.view.root.querySelector('textarea'),form=f.view.root.querySelector('.cp-composer'),status=f.view.root.querySelector('.cp-chat-status');form.fire('submit');await until(()=>!!f.pending);f.accept();await chat.whenSubmissionSettled();assert.equal(status.dataset.statusKind,'send-accepted');assert.match(status.textContent,/Message accepted/);
    await chat.refresh();editor.fire('input');assert.match(status.textContent,/Message accepted/,'Refresh and unchanged input do not erase an acknowledgement');session.update('Shared session recovery update');assert.match(status.textContent,/Message accepted/,'A programmatic recovery notification is not new user input');editor.value='Actual next draft';editor.setSelectionRange(3,3);editor.fire('input');assert.equal(status.textContent,'');assert.equal(status.dataset.statusKind,'notice');assert.equal(f.view.root.querySelector('textarea'),editor);assert.deepEqual([editor.selectionStart,editor.selectionEnd],[3,3]);await chat.flush();assert.equal(f.draft.content,'Actual next draft');
    form.fire('submit');await until(()=>!!f.pending);f.pending!.reject(new Error('provider_unavailable'));await chat.whenSubmissionSettled();const failed=status.textContent;editor.value='Text after failure';editor.fire('input');assert.equal(status.textContent,failed);assert.match(failed,/provider_unavailable/);assert.equal(status.dataset.statusKind,'notice');named(f.view.root,'I reviewed the send outcome').fire('click');form.fire('submit');await until(()=>!!f.pending);f.pending!.resolve({id:'execution:unknown',resourceId:f.draft.resourceId,state:'unknown'});await chat.whenSubmissionSettled();const unknown=status.textContent;editor.value='Text after unknown outcome';editor.fire('input');assert.equal(status.textContent,unknown);assert.match(unknown,/not confirmed/);await chat.flush();
    f.external('Concurrent canonical recovery');editor.value='This editor conflict';editor.fire('input');await assert.rejects(chat.flush(),/stale_draft_version/);editor.value='Further conflict edit';editor.fire('input');assert.equal(status.textContent,unknown);assert.equal(f.view.root.querySelector('.cp-draft-status').dataset.phase,'conflict');assert.match(f.view.root.querySelector('.cp-draft-status').textContent,/Choose which text to keep/);assert.equal(session.snapshot().content,'Further conflict edit');
  }finally{f.pending?.reject(new Error('synthetic cleanup'));await chat?.whenSubmissionSettled();const remote=session.snapshot().remote;if(remote)await session.resolve('keep-local',remote.version);await chat?.dispose();await session.dispose();f.restore();}
});

test('capability hooks distinguish redundant true-local recording from unavailable or simulated provider notices',async()=>{
  const f=fixture();let chat;
  try{chat=mountConversationChat(f.view.root,{port:f.port,resourceId:f.draft.resourceId,presentation:'workspace'});await chat.ready;const note=f.view.root.querySelector('.cp-capability-note'),provider=f.view.root.querySelector('.cp-composer-provider');assert.equal(note.dataset.capabilityKind,'local-recording');assert.equal(provider.dataset.providerId,'local');assert.equal(provider.textContent,'Local recording');
    f.detail.providers[0].available=false;f.detail.providers[0].reason='Local storage unavailable';await chat.refresh();assert.equal(note.dataset.capabilityKind,'provider-reason');assert.equal(note.textContent,'Local storage unavailable');f.detail.providers[0].available=true;f.detail.providers[0].simulated=true;f.detail.providers[0].reason='SIMULATED fixture';await chat.refresh();assert.equal(note.dataset.capabilityKind,'provider-reason');assert.match(note.textContent,/SIMULATED/);assert.ok(f.calls.every(call=>['readDraft','detail'].includes(call.name)));
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
  const f=fixture();let manager;try{manager=mountConversationManager(f.view.root,f.port,{resourceId:f.draft.resourceId});await manager.ready;assert.equal(f.view.root.querySelectorAll('.cp-chat').length,1);assert.equal(f.view.root.querySelectorAll('.cp-composer').length,1);assert.equal(f.view.root.querySelector('.cp-chat-extras').open,false);assert.equal(f.view.root.querySelector('.cp-chat-extras').parentElement,f.view.root.querySelector('.cp-detail-header'),'Context extras share the identity header, without a permanent separate transcript row');const editor=f.view.root.querySelector('textarea');await manager.refresh();assert.equal(f.view.root.querySelector('textarea'),editor);assert.equal(f.view.root.querySelector('.cp-chat').dataset.resourceId,f.draft.resourceId);assert.equal(f.calls.some(c=>c.name==='send'),false);}
  finally{await manager?.dispose();f.restore();}
});

test('measured short chat hosts compact the stable editor and consolidate feedback before the final composer without mutating its draft',async()=>{
  const f=fixture();let chat,target:Element|null=null,resize:ResizeObserverCallback|undefined,disconnected=false,id=0;const previous=globalThis.ResizeObserver,priorFrame=globalThis.requestAnimationFrame,priorCancel=globalThis.cancelAnimationFrame,frames=new Map<number,FrameRequestCallback>();f.view.root.clientWidth=400;f.view.root.style.height='600px';
  class MeasuredResizeObserver {constructor(callback:ResizeObserverCallback){resize=callback;}observe(node:Element){target=node;}disconnect(){disconnected=true;}unobserve(){}}
  globalThis.ResizeObserver=MeasuredResizeObserver as unknown as typeof ResizeObserver;globalThis.requestAnimationFrame=callback=>{frames.set(++id,callback);return id;};globalThis.cancelAnimationFrame=key=>{frames.delete(key);};
  const deliver=(height:number,width=400)=>resize!([{target,contentRect:{height,width}} as unknown as ResizeObserverEntry],{} as ResizeObserver),frame=()=>{const entry=frames.entries().next().value;assert.ok(entry);frames.delete(entry[0]);entry[1](0);};
  try{chat=mountConversationChat(f.view.root,{port:f.port,resourceId:f.draft.resourceId,layoutHost:f.view.root});await chat.ready;const root=f.view.root.querySelector('.cp-chat'),editor=root.querySelector('textarea'),composer=root.querySelector('.cp-composer');editor.focus();editor.setSelectionRange(3,9);assert.equal(target,f.view.root);assert.notEqual(target,root,'The auto-sized chat is never its own observer target');Object.defineProperty(root,'clientHeight',{get(){throw new Error('Self-dependent chat height must never be read');}});
    let writes=0;editor.style=new Proxy(editor.style,{set(object,key,value){writes++;object[key]=value;return true;}});deliver(180);deliver(180);deliver(190);assert.equal(writes,0,'ResizeObserver delivery does not write layout');assert.equal(frames.size,1,'Changed bounds coalesce into one reconciliation');frame();assert.ok(root.className.split(' ').includes('cp-chat-compact'));assert.equal(editor.rows,1);assert.ok(parseFloat(editor.style.height)<=48);assert.equal(root.children.at(-1),composer);assert.equal(root.querySelector('.cp-chat-status').parentElement,root.querySelector('.cp-chat-feedback'));
    writes=0;deliver(190);chat.setPresentation('focused');assert.equal(frames.size,0);assert.equal(writes,0,'Unchanged frames do not reset auto height or write its final value');deliver(580);frame();assert.equal(root.className.split(' ').includes('cp-chat-compact'),false);assert.equal(editor.rows,2);assert.equal(root.querySelector('textarea'),editor);assert.deepEqual([editor.selectionStart,editor.selectionEnd],[3,9]);assert.equal(editor.value,'Saved unsent text');assert.equal(f.draft.content,editor.value);
    deliver(180);assert.equal(frames.size,1);deliver(0,0);assert.equal(frames.size,0,'Hidden hosts cancel pending work');const hiddenWrites=writes;chat.setPresentation('workspace');assert.equal(writes,hiddenWrites);deliver(300);assert.equal(frames.size,1);await chat.dispose();assert.equal(frames.size,0);assert.equal(disconnected,true);assert.ok(f.calls.every(call=>['readDraft','detail'].includes(call.name)));
  }finally{await chat?.dispose();for(const [key,value]of Object.entries({ResizeObserver:previous,requestAnimationFrame:priorFrame,cancelAnimationFrame:priorCancel})){if(value===undefined)delete (globalThis as any)[key];else (globalThis as any)[key]=value;}f.restore();}
});

test('generic auto-height workspace has no resize feedback edge or repeated height writes on identical presentation',async()=>{
  const f=fixture();let chat,observations=0,ownHeightReads=0;const previous=globalThis.ResizeObserver;class CountingObserver{constructor(_callback:ResizeObserverCallback){}observe(){observations++;}disconnect(){}}
  globalThis.ResizeObserver=CountingObserver as unknown as typeof ResizeObserver;
  try{chat=mountConversationChat(f.view.root,{port:f.port,resourceId:f.draft.resourceId,presentation:'workspace'});const root=f.view.root.querySelector('.cp-chat'),editor=root.querySelector('textarea');Object.defineProperty(root,'clientHeight',{get(){ownHeightReads++;return 170+parseFloat(editor.style.height||'0');}});await chat.ready;let writes=0;editor.style=new Proxy(editor.style,{set(object,key,value){writes++;object[key]=value;return true;}});
    for(let i=0;i<20;i++)chat.setPresentation('workspace');assert.equal(ownHeightReads,0,'Auto-height root cannot feed its own editor cap');assert.equal(observations,0);assert.equal(writes,0);assert.ok(parseFloat(editor.style.height)<=96);assert.equal(editor.value,'Saved unsent text');assert.ok(f.calls.every(call=>['readDraft','detail'].includes(call.name)));
  }finally{await chat?.dispose();if(previous===undefined)delete (globalThis as any).ResizeObserver;else globalThis.ResizeObserver=previous;f.restore();}
});

test('layout hosts must be finite external ancestors rather than self/auto or unrelated nodes',()=>{
  const f=fixture();try{const foreign=f.view.doc.createElement('aside');assert.throws(()=>mountConversationChat(f.view.root,{port:f.port,resourceId:f.draft.resourceId,layoutHost:foreign}),/invalid_chat_layout_host/);f.view.root.style.height='auto';assert.throws(()=>mountConversationChat(f.view.root,{port:f.port,resourceId:f.draft.resourceId,layoutHost:f.view.root}),/invalid_chat_layout_host/);f.view.root.style.height='300px';f.view.root.clientHeight=Infinity;assert.throws(()=>mountConversationChat(f.view.root,{port:f.port,resourceId:f.draft.resourceId,layoutHost:f.view.root}),/invalid_chat_layout_host/);f.view.root.clientHeight=300;f.view.root.className='cp-chat';assert.throws(()=>mountConversationChat(f.view.root,{port:f.port,resourceId:f.draft.resourceId,layoutHost:f.view.root}),/invalid_chat_layout_host/);assert.equal(f.calls.length,0);}
  finally{f.restore();}
});

test('semantic control groups expose actual selection/filter/folder/paging state and clear search without provider actions',async()=>{
  const f=fixture();let manager;f.history.items=[{kind:'conversation',resourceId:f.draft.resourceId,title:f.detail.conversation.title,excerpt:'Exact canonical history excerpt'},{kind:'resource',resourceId:'note:canonical',title:'Canonical note',excerpt:'Authorized note excerpt'}];f.history.total=60;
  f.collections.push({id:'folder:canonical',title:'Canonical folder',projectId:null,version:4,ruleRevision:0,state:'active',parentId:null,rule:null,memberIds:[],pinnedIds:[]});
  try{manager=mountConversationManager(f.view.root,f.port,{resourceId:f.draft.resourceId});await manager.ready;
    const filter=f.view.root.querySelector('.cp-filters'),summary=filter.querySelector('summary'),caption=summary.querySelector('.cp-control-label');assert.equal(summary.tagName,'SUMMARY');assert.equal(summary.dataset.cpControl,'filters');assert.equal(caption.textContent,'Filters');assert.equal(summary.querySelector('.cp-control-glyph').getAttribute('aria-hidden'),'true');assert.equal(filter.querySelector('.cp-disclosure-panel').getAttribute('role'),'group');assert.equal(summary.getAttribute('aria-controls'),filter.querySelector('.cp-disclosure-panel').id);
    filter.open=true;filter.fire('toggle');assert.equal(filter.dataset.open,'true');assert.equal(filter.dataset.active,'false');
    const results=f.view.root.querySelector('.cp-results'),selected=results.querySelector('[data-resource-id="chat:synthetic"]');assert.equal(selected.getAttribute('aria-current'),'true');assert.equal(selected.querySelector('.cp-result-title').textContent,f.detail.conversation.title);assert.equal(selected.querySelector('.cp-result-excerpt').textContent,'\nExact canonical history excerpt');assert.equal(named(f.view.root,'Previous results').disabled,true);assert.equal(named(f.view.root,'More results').disabled,false);
    const manage=named(f.view.root,'Manage selected folder');assert.equal(manage.disabled,true);const folder=filter.querySelectorAll('select')[1];folder.value='folder:canonical';folder.fire('change');await until(()=>f.calls.some(call=>call.name==='search'&&call.input.collectionId==='folder:canonical'));assert.equal(manage.disabled,false);assert.equal(filter.dataset.active,'true');assert.equal(summary.getAttribute('aria-label'),'Filters · 1 active');
    const search=f.view.root.querySelector('input[aria-label="Search conversation history"]'),clear=named(f.view.root,'Clear history search');search.value='Local search text';search.fire('input');assert.equal(clear.hidden,false);await new Promise(resolve=>setImmediate(resolve));clear.fire('click');await until(()=>clear.hidden);assert.equal(search.value,'');assert.equal(f.view.doc.activeElement,search);assert.equal(f.draft.content,'Saved unsent text');assert.equal(f.calls.some(call=>['send','branch','selectProvider'].includes(call.name)),false);
    await until(()=>f.view.root.querySelector('.cp-manager').getAttribute('aria-busy')===null);await manager.refresh();assert.equal(named(f.view.root,'Favorite').getAttribute('aria-pressed'),'false');named(f.view.root,'Favorite').fire('click');await until(()=>!!named(f.view.root,'Unfavorite'));assert.equal(named(f.view.root,'Unfavorite').getAttribute('aria-pressed'),'true');assert.equal(f.calls.filter(call=>call.name==='favorite').length,1);
  }finally{await manager?.dispose();f.restore();}
});

test('workspace/focused presentation switches preserve one canonical chat, draft session, caret and scroll without actions',async()=>{
  const f=fixture(),session=new ConversationDraftSession({port:f.port,resourceId:f.draft.resourceId});let chat;
  try{chat=mountConversationChat(f.view.root,{port:f.port,resourceId:f.draft.resourceId,draftSession:session,presentation:'workspace'});await chat.ready;const root=f.view.root.querySelector('.cp-chat'),editor=root.querySelector('textarea'),article=root.querySelector('.cp-message'),messages=root.querySelector('.cp-messages');editor.focus();editor.setSelectionRange(2,8);messages.scrollTop=37;const saved=session.snapshot();assert.equal(root.dataset.presentation,'workspace');assert.equal(editor.rows,1);
    chat.setPresentation('focused');assert.equal(root.dataset.presentation,'focused');assert.ok(root.className.split(' ').includes('cp-chat-focused'));assert.equal(editor.rows,2);chat.setPresentation('workspace');assert.equal(root.dataset.presentation,'workspace');assert.equal(root.querySelector('textarea'),editor);assert.equal(root.querySelector('.cp-message'),article);assert.equal(f.view.doc.activeElement,editor);assert.deepEqual([editor.selectionStart,editor.selectionEnd],[2,8]);assert.equal(messages.scrollTop,37);assert.deepEqual(session.snapshot(),saved);assert.ok(f.calls.every(call=>['readDraft','detail'].includes(call.name)));assert.throws(()=>chat!.setPresentation('invalid' as any),/invalid_chat_presentation/);
    await chat.dispose();session.update('Host retains ownership after mode switching');await session.flush();assert.equal(f.draft.content,'Host retains ownership after mode switching');
  }finally{await chat?.dispose();await session.dispose();f.restore();}
});

test('filter and clear-search changes made during an existing read drain to the latest actual query without replaying actions',async()=>{
  const f=fixture();let manager,release!:()=>void;
  try{manager=mountConversationManager(f.view.root,f.port,{resourceId:f.draft.resourceId});await manager.ready;const priorDetails=f.calls.filter(call=>call.name==='detail').length;f.gateDetail(new Promise<void>(resolve=>{release=resolve;}));const reading=manager.refresh();await until(()=>f.calls.filter(call=>call.name==='detail').length>priorDetails);
    const filters=f.view.root.querySelector('.cp-filters'),favorite=filters.querySelector('input'),search=f.view.root.querySelector('input[aria-label="Search conversation history"]');favorite.checked=true;favorite.fire('change');search.value='A pending search';search.fire('input');named(f.view.root,'Clear history search').fire('click');release();f.gateDetail(null);await reading;await until(()=>f.view.root.querySelector('.cp-manager').getAttribute('aria-busy')===null);
    const final=f.calls.filter(call=>call.name==='search').at(-1)!;assert.equal(final.input.favorite,true);assert.equal(final.input.text,'');assert.equal(final.input.offset,0);assert.equal(f.calls.some(call=>['send','organize','favorite'].includes(call.name)),false);assert.equal(f.draft.content,'Saved unsent text');
  }finally{release?.();f.gateDetail(null);await manager?.dispose();f.restore();}
});

test('openCollection validates canonical metadata, drains shared drafts and resets every history filter without replacing other inline editors',async()=>{
  const f=fixture(),shared=new ConversationDraftSession({port:f.port,resourceId:f.draft.resourceId});let manager,inline;
  f.collections.push({id:'collection:canonical',title:'Canonical collection',projectId:null,version:3,ruleRevision:2,state:'active',parentId:null,rule:{favorite:true},memberIds:['note:canonical'],pinnedIds:[]});
  try{const host=f.view.doc.createElement('main'),inlineHost=f.view.doc.createElement('aside');f.view.root.append(host,inlineHost);inline=mountConversationChat(inlineHost,{port:f.port,resourceId:f.draft.resourceId,draftSession:shared});await inline.ready;
    const state={selectedResourceId:f.draft.resourceId,drafts:{},scroll:{},query:{text:'Old search',projectId:'project:old',archived:true,favorite:true,providerId:'provider:old',familyOf:'chat:old',after:'old',offset:50},messageOffset:{}};manager=mountConversationManager(host,f.port,{state,draftSession:()=>shared});await manager.ready;const editor=inlineHost.querySelector('textarea');editor.value='Exact unsent shared collection navigation 🧭';editor.fire('input');
    f.history.items=[{kind:'resource',resourceId:'note:canonical',title:'Canonical member',excerpt:'Exact returned member'}];f.history.total=1;await manager.openCollection('collection:canonical');
    assert.deepEqual(state.query,{collectionId:'collection:canonical',offset:0});assert.equal(state.selectedResourceId,null);assert.equal(f.draft.content,editor.value);assert.equal(inlineHost.querySelector('textarea'),editor);assert.equal(host.querySelector('.cp-chat'),null);assert.equal(host.querySelector('.cp-manager').dataset.resourceId,undefined);assert.equal(host.querySelector('.cp-manager').dataset.collectionId,'collection:canonical');assert.match(host.querySelector('.cp-detail-header').textContent,/Canonical collection/);
    const controls=host.querySelector('.cp-filters').querySelectorAll('select'),search=host.querySelector('input[aria-label="Search conversation history"]');assert.equal(search.value,'');assert.equal(controls[0].value,'');assert.equal(controls[1].value,'collection:canonical');assert.equal(controls[2].value,'active');assert.equal(host.querySelector('.cp-filters').querySelector('input').checked,false);assert.equal(f.view.doc.activeElement,search);assert.equal(host.querySelector('.cp-results').querySelector('button').dataset.resourceId,'note:canonical');
    assert.deepEqual(f.calls.filter(call=>call.name==='search').at(-1)!.input,{collectionId:'collection:canonical',offset:0,limit:50});assert.ok(f.calls.every(call=>['readDraft','saveDraft','detail','collections','providers','projects','search'].includes(call.name)));
    await manager.dispose();manager=undefined;shared.update('Inline session remains host owned');await shared.flush();assert.equal(editor.value,'Inline session remains host owned');
  }finally{await manager?.dispose();await inline?.dispose();await shared.dispose();f.restore();}
});

test('missing, archived and denied collection opens reject without relabelling or detaching the current conversation',async()=>{
  const f=fixture();let manager;
  try{f.collections.push({id:'collection:archived',title:'Archived collection',projectId:null,version:1,ruleRevision:0,state:'archived',parentId:null,rule:null,memberIds:[],pinnedIds:[]},{id:'collection:active',title:'Visible collection',projectId:null,version:1,ruleRevision:0,state:'active',parentId:null,rule:null,memberIds:[],pinnedIds:[]});manager=mountConversationManager(f.view.root,f.port,{resourceId:f.draft.resourceId});await manager.ready;await manager.flush();const before=structuredClone(manager.state),editor=f.view.root.querySelector('textarea'),header=f.view.root.querySelector('.cp-detail-header').textContent;
    await assert.rejects(manager.openCollection('collection:missing'),/collection_missing/);await assert.rejects(manager.openCollection('collection:archived'),/collection_missing/);f.failSearch('source_unavailable');await assert.rejects(manager.openCollection('collection:active'),/source_unavailable/);f.failSearch(null);f.deny();await assert.rejects(manager.openCollection('collection:active'),/source_unavailable/);f.deny(false);
    assert.deepEqual(manager.state,before);assert.equal(f.view.root.querySelector('textarea'),editor);assert.equal(f.view.root.querySelector('.cp-detail-header').textContent,header);assert.equal(f.view.root.querySelector('.cp-manager').dataset.collectionId,undefined);assert.equal(f.calls.some(call=>['send','organize','archive'].includes(call.name)),false);
  }finally{f.deny(false);f.failSearch(null);await manager?.dispose();f.restore();}
});

test('openCollection detaches a pending provider view promptly without cancelling its eventual exact draft acceptance',async()=>{
  const f=fixture('codex:native'),shared=new ConversationDraftSession({port:f.port,resourceId:f.draft.resourceId});let manager,interrupts=0;
  try{f.collections.push({id:'collection:pending',title:'Canonical target',projectId:null,version:1,ruleRevision:0,state:'active',parentId:null,rule:null,memberIds:[],pinnedIds:[]});manager=mountConversationManager(f.view.root,f.port,{resourceId:f.draft.resourceId,draftSession:()=>shared,execution:{observe(){return()=>{};},async cancel(){interrupts++;}}});await manager.ready;f.view.root.querySelector('.cp-composer').fire('submit');await until(()=>!!f.pending);
    let opened=false;const opening=manager.openCollection('collection:pending').then(()=>{opened=true;});await until(()=>opened);await opening;assert.ok(f.pending,'Collection navigation does not wait for provider completion');assert.equal(interrupts,0);assert.equal(manager.state.selectedResourceId,null);f.accept(true);await until(()=>shared.snapshot().content==='');assert.equal(f.draft.content,'');assert.equal(f.calls.filter(call=>call.name==='send').length,1);assert.equal(f.view.root.querySelector('.cp-manager').dataset.collectionId,'collection:pending');
  }finally{f.pending?.reject(new Error('synthetic cleanup'));await manager?.dispose();await shared.dispose();f.restore();}
});

test('openCollection revalidates active visibility after the draft drain before detaching any existing chat',async()=>{
  const f=fixture();let manager,armed=false;const native=f.port.command.bind(f.port);f.collections.push({id:'collection:revoked-during-drain',title:'Initially active',projectId:null,version:1,ruleRevision:0,state:'active',parentId:null,rule:null,memberIds:[],pinnedIds:[]});
  const port={async command(name:any,input:any){const result=await (native as any)(name,input);if(armed&&name==='saveDraft')f.collections[0].state='archived';return result;}} as ConversationProductPort;
  try{manager=mountConversationManager(f.view.root,port,{resourceId:f.draft.resourceId});await manager.ready;const editor=f.view.root.querySelector('textarea');editor.value='Draft made durable before rechecking collection';editor.fire('input');armed=true;await assert.rejects(manager.openCollection('collection:revoked-during-drain'),/collection_missing/);assert.equal(f.draft.content,editor.value);assert.equal(manager.state.selectedResourceId,f.draft.resourceId);assert.deepEqual(manager.state.query,{});assert.equal(f.view.root.querySelector('textarea'),editor);assert.equal(f.calls.some(call=>call.name==='search'&&call.input.collectionId==='collection:revoked-during-drain'),false);}
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
