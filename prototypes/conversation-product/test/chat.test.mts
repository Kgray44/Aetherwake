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
  let draft={resourceId:'chat:synthetic',version:3,content:'Saved unsent text',updatedAt:'2026-11-02T00:00:00Z'},denied=false;
  const detail:Detail={conversation:{resourceId:draft.resourceId,conversationId:'graph:synthetic',title:'Synthetic conversation',providerId,revision:2,version:1,projectId:null,projectIds:[],state:'active',createdAt:'2026-11-02T00:00:00Z',favorite:false,messageCount:2,collectionIds:[]},messages:{items:[{id:'message:user',resourceId:draft.resourceId,role:'user',content:'A user message',createdAt:'2026-11-02T00:00:00Z',provenance:'user',inherited:false,sensitivity:'internal'},{id:'message:assistant',resourceId:draft.resourceId,role:'assistant',content:'A **readable** response.\n\n```ts\nconst answer = 42;\n```',createdAt:'2026-11-02T00:00:01Z',provenance:'application',inherited:false,sensitivity:'internal'}],total:2,offset:0,limit:50,hasMore:false},lineage:[],policy:{resourceId:draft.resourceId,revision:1,mode:'independent',allowedSourceIds:[],allowCrossProject:false,maxSensitivity:'internal',categories:['excerpt']},shares:[],providers:[{id:providerId,label:providerId==='local'?'Local recording':'Native Codex',available:true,record:true,execute:providerId!=='local',nativeFork:false,history:'local',simulated:false,models:[]}]};
  let pending: {input:any;resolve:(value:unknown)=>void;reject:(error:Error)=>void}|null=null;
  const port={async command(name:string,input:any):Promise<any>{calls.push({name,input});if(denied)throw new Error('source_unavailable');
    if(name==='readDraft')return {...draft};if(name==='saveDraft'){if(input.expectedVersion!==draft.version)throw new Error('stale_draft_version');draft={...draft,version:draft.version+1,content:input.content};return {...draft};}
    if(name==='detail')return structuredClone(detail);if(name==='send')return new Promise((resolve,reject)=>{pending={input,resolve,reject};}).finally(()=>{pending=null;});
    if(name==='providers')return detail.providers;if(name==='collections'||name==='projects')return [];if(name==='search')return {items:[],total:0,offset:0,limit:50,hasMore:false};throw new Error('Unexpected command '+name);
  }} as ConversationProductPort;
  const accept=()=>{assert.ok(pending);const item={...detail.messages.items[0],id:'message:sent:'+detail.conversation.revision,content:pending.input.content};detail.messages.items.push(item);detail.messages.total++;detail.conversation.messageCount++;detail.conversation.revision++;const p=pending;pending=null;p.resolve({...item,revision:detail.conversation.revision});};
  return {view,port,calls,detail,restore,accept,get pending(){return pending;},get draft(){return {...draft};},deny(){denied=true;},external(content:string){draft={...draft,version:draft.version+1,content};}};
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

test('Enter submits once; Shift+Enter and IME do not submit; before-close draining retains later in-flight edits',async()=>{
  const f=fixture();let chat;try{chat=mountConversationChat(f.view.root,{port:f.port,resourceId:f.draft.resourceId});await chat.ready;const editor=f.view.root.querySelector('textarea');
    editor.fire('keydown',{key:'Enter',shiftKey:true});editor.fire('compositionstart');editor.fire('keydown',{key:'Enter'});assert.equal(f.pending,null);editor.fire('compositionend');
    editor.value='Exact submitted text';editor.fire('input');const entered=editor.fire('keydown',{key:'Enter'});assert.equal(entered.defaultPrevented,true);await until(()=>!!f.pending);assert.equal(f.pending!.input.content,'Exact submitted text');assert.equal(f.draft.content,'Exact submitted text');
    editor.value='Later typing while native approval waits';editor.fire('input');let drained=false;const drain=chat.flush().then(()=>{drained=true;});await new Promise(resolve=>setImmediate(resolve));assert.equal(drained,false);f.accept();await drain;
    assert.equal(editor.value,'Later typing while native approval waits');assert.equal(f.draft.content,editor.value);assert.equal(f.calls.filter(c=>c.name==='send').length,1);assert.match(f.view.root.querySelector('.cp-chat-status').textContent,/Later draft edits/);
  }finally{await chat?.dispose();f.restore();}
});

test('accepted local send clears only its captured CAS draft; unknown and native-cancelled sends retain recovery',async()=>{
  const f=fixture();let chat;try{chat=mountConversationChat(f.view.root,{port:f.port,resourceId:f.draft.resourceId});await chat.ready;const editor=f.view.root.querySelector('textarea'),form=f.view.root.querySelector('.cp-composer');
    form.fire('submit');await until(()=>!!f.pending);f.accept();await chat.flush();assert.equal(editor.value,'');assert.equal(f.draft.content,'');assert.ok(f.draft.version>3);
    editor.value='Native cancelled request';editor.fire('input');form.fire('submit');await until(()=>!!f.pending);f.pending!.reject(new Error('authorization_cancelled'));await chat.flush();assert.equal(editor.value,'Native cancelled request');assert.match(f.view.root.querySelector('.cp-chat-status').textContent,/cancelled/);
    form.fire('submit');await until(()=>!!f.pending);f.pending!.resolve({id:'execution:unknown',resourceId:f.draft.resourceId,state:'unknown'});await chat.flush();assert.equal(editor.value,'Native cancelled request');assert.equal(named(form,'Record message').disabled,true);const sends=f.calls.filter(c=>c.name==='send').length;named(f.view.root,'I reviewed the send outcome').fire('click');assert.equal(f.calls.filter(c=>c.name==='send').length,sends);
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
  const f=fixture('codex:native');let chat;try{chat=mountConversationChat(f.view.root,{port:f.port,resourceId:f.draft.resourceId});await chat.ready;const form=f.view.root.querySelector('.cp-composer');form.fire('submit');await until(()=>!!f.pending);assert.match(f.view.root.querySelector('.cp-chat-status').textContent,/native send review/);f.pending!.reject(new Error('provider_unavailable'));await chat.flush();assert.match(f.view.root.querySelector('.cp-chat-status').textContent,/provider_unavailable/);assert.equal(f.draft.content,'Saved unsent text');assert.equal(f.calls.filter(c=>c.name==='send').length,1);assert.equal(named(form,'Send').disabled,true);}
  finally{await chat?.dispose();f.restore();}
});

test('composer keyboard policy keeps newline and composition distinct from submit',()=>{
  const event={key:'Enter',shiftKey:false,isComposing:false,altKey:false,ctrlKey:false,metaKey:false};assert.equal(composerShouldSubmit(event),true);for(const field of ['shiftKey','isComposing','altKey']as const)assert.equal(composerShouldSubmit({...event,[field]:true}),false);assert.equal(composerShouldSubmit({...event,key:'Escape'}),false);
});
