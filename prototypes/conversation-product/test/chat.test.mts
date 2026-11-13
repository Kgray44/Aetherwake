import test from 'node:test';
import assert from 'node:assert/strict';
import { mountConversationChat, composerShouldSubmit, type ConversationExecutionObservation, type ConversationMessageAction } from '../src/chat.ts';
import { mountConversationManager } from '../src/ui.ts';
import { ConversationDraftSession } from '../src/draft-session.ts';
import { createNativeChatGPTFidelityDescriptor } from '../src/native-chatgpt-fidelity.ts';
import { markdownBlocks, renderMarkdown } from '../src/markdown.ts';
import type { ConversationProductPort, ConversationView, ConversationViewSelected, Detail, Collection, SearchHit } from '../src/contracts.ts';
import { componentDocument, named, until } from './component-dom.mts';
import { pickerMotion } from './picker-motion.mts';
import { ConversationViewPersistence } from '../src/view-persistence.ts';

/** Synthetic port receipts only: these tests make no database, provider, native-window or network claims. */
function fixture(providerId='local') {
  const view=componentDocument(),restore=view.install(),calls:{name:string;input:any}[]=[];
  let draft={resourceId:'chat:synthetic',version:3,content:'Saved unsent text',updatedAt:'2026-11-02T00:00:00Z'},denied=false,detailGate:Promise<void>|null=null,searchError:string|null=null;
  const detail:Detail={conversation:{resourceId:draft.resourceId,conversationId:'graph:synthetic',title:'Synthetic conversation',providerId,revision:2,version:1,projectId:null,projectIds:[],state:'active',createdAt:'2026-11-02T00:00:00Z',favorite:false,messageCount:2,collectionIds:[]},messages:{items:[{id:'message:user',resourceId:draft.resourceId,role:'user',content:'A user message',createdAt:'2026-11-02T00:00:00Z',provenance:'user',inherited:false,sensitivity:'internal'},{id:'message:assistant',resourceId:draft.resourceId,role:'assistant',content:'A **readable** response.\n\n```ts\nconst answer = 42;\n```',createdAt:'2026-11-02T00:00:01Z',provenance:'application',inherited:false,sensitivity:'internal'}],total:2,offset:0,limit:50,hasMore:false},lineage:[],policy:{resourceId:draft.resourceId,revision:1,mode:'independent',allowedSourceIds:[],allowCrossProject:false,maxSensitivity:'internal',categories:['excerpt']},shares:[],providers:[{id:providerId,label:providerId==='local'?'Local recording':'Native Codex',available:true,record:true,execute:providerId!=='local',nativeFork:false,history:'local',simulated:false,models:[]}]};
  let pending: {input:any;resolve:(value:unknown)=>void;reject:(error:Error)=>void}|null=null;
  const collections:Collection[]=[],projects:{id:string;title:string;version:number}[]=[],history={items:[] as SearchHit[],total:0};
  const port={async command(name:string,input:any):Promise<any>{calls.push({name,input});if(denied)throw new Error('source_unavailable');
    if(name==='readDraft')return {...draft};if(name==='saveDraft'){if(input.expectedVersion!==draft.version)throw new Error('stale_draft_version');draft={...draft,version:draft.version+1,content:input.content};return {...draft};}
    if(name==='detail'){const captured=structuredClone(detail);await detailGate;return captured;}if(name==='send')return new Promise((resolve,reject)=>{pending={input,resolve,reject};}).finally(()=>{pending=null;});
    if(name==='providers')return detail.providers;if(name==='collections')return structuredClone(collections);if(name==='projects')return structuredClone(projects);if(name==='list'){if(searchError)throw new Error(searchError);return {items:history.items.filter(hit=>hit.kind==='conversation').map(hit=>hit.summary??{...detail.conversation,resourceId:hit.resourceId,title:hit.title}).slice(input.offset??0,(input.offset??0)+(input.limit??50)),total:history.total,offset:input.offset??0,limit:input.limit??50,hasMore:(input.offset??0)+(input.limit??50)<history.total};}if(name==='search'){if(searchError)throw new Error(searchError);const items=input.searchMode&&input.searchMode!=='all'?history.items.filter(hit=>hit.kind===input.searchMode.replace(/s$/,'')):history.items;return {...history,items,offset:input.offset??0,limit:50,hasMore:(input.offset??0)+50<history.total};}if(name==='favorite'){detail.conversation.favorite=input.favorite;return input.favorite;}throw new Error('Unexpected command '+name);
  }} as ConversationProductPort;
  const accept=(execution=false)=>{assert.ok(pending);const item={...detail.messages.items[0],id:'message:sent:'+detail.conversation.revision,content:pending.input.content};detail.messages.items.push(item);detail.messages.total++;detail.conversation.messageCount++;detail.conversation.revision++;const p=pending;pending=null;p.resolve(execution?{id:'execution:synthetic',resourceId:draft.resourceId,providerId,commandId:p.input.commandId,state:'provider_completed',taskVerified:false}:{...item,revision:detail.conversation.revision});};
  return {view,port,calls,detail,collections,projects,history,restore,accept,get pending(){return pending;},get draft(){return {...draft};},deny(value=true){denied=value;},failSearch(error:string|null){searchError=error;},gateDetail(gate:Promise<void>|null){detailGate=gate;},external(content:string){draft={...draft,version:draft.version+1,content};}};
}

function addChatGPTCompatibility(f:ReturnType<typeof fixture>,report=createNativeChatGPTFidelityDescriptor()){
  f.detail.providers.push({id:'chatgpt',label:'ChatGPT account history',available:false,record:false,execute:false,nativeFork:false,history:'unavailable',reason:report.reason,reasonCode:report.reasonCode,simulated:false,models:[],accountFidelity:report});
}

test('a matching confirmed interruption keeps the draft and allows an explicit next send',async()=>{
 const f=fixture('chatgpt-plan-responses');let chat;
 try{
  chat=mountConversationChat(f.view.root,{port:f.port,resourceId:f.draft.resourceId});await chat.ready;
  const form=f.view.root.querySelector('.cp-composer'),send=named(form,'Send'),editor=form.querySelector('textarea');
  form.fire('submit');await until(()=>!!f.pending);
  editor.value='New draft after stopping';editor.fire('input');
  f.pending!.resolve({id:'execution:stopped',resourceId:f.draft.resourceId,providerId:'chatgpt-plan-responses',commandId:f.pending!.input.commandId,state:'interrupted'});
  await chat.whenSubmissionSettled();await chat.flush();
  assert.equal(send.disabled,false);
  assert.match(f.view.root.querySelector('.cp-chat-status').textContent,/Reply stopped/);
  assert.equal(f.draft.content,'New draft after stopping');
  assert.equal(f.calls.filter(c=>c.name==='send').length,1);
  form.fire('submit');await until(()=>!!f.pending);
  assert.equal(f.pending!.input.content,'New draft after stopping');
  f.accept(true);await chat.whenSubmissionSettled();
 }finally{f.pending?.reject(Error('synthetic cleanup'));await chat?.dispose();f.restore();}
});

test('Stop follows the observed turn through acknowledgment, settlement and a subsequent turn',async()=>{
  for(const settleBeforeAck of [true,false]){
    const f=fixture('chatgpt-plan-responses');
    let chat, observe:(value:ConversationExecutionObservation)=>void;
    let acknowledge!:()=>void, requests=0;
    const pending=new Promise<void>(resolve=>{acknowledge=resolve;});
    const turn={id:'execution:first',resourceId:f.draft.resourceId,providerId:'chatgpt-plan-responses',commandId:'command:first',state:'running' as const,startedAt:'2026-11-02T00:00:02Z',endedAt:null,taskVerified:false};
    try{
      chat=mountConversationChat(f.view.root,{port:f.port,resourceId:f.draft.resourceId,execution:{
        observe(_id,listener){observe=listener;return()=>{};},
        cancel(id){assert.equal(id,turn.id);requests++;return pending;},
      }});
      await chat.ready;
      const stop=named(f.view.root,'Stop'),status=f.view.root.querySelector('.cp-chat-status');
      observe!({execution:turn});
      stop.fire('click');
      assert.equal(stop.disabled,true);
      const settle=()=>observe!({execution:{...turn,state:'interrupted',endedAt:'2026-11-02T00:00:03Z'}});
      if(settleBeforeAck)settle();
      acknowledge();
      await new Promise<void>(resolve=>setImmediate(resolve));
      if(!settleBeforeAck){
        observe!({execution:turn});
        assert.equal(stop.disabled,true,'Acknowledgment and later activity must not re-enable Stop');
        assert.match(status.textContent,/Stop requested/);
        stop.fire('click');
        settle();
      }
      assert.equal(requests,1);
      assert.match(status.textContent,/confirmed the turn stopped/);
      observe!({execution:{...turn,id:'execution:second',startedAt:'2026-11-02T00:00:04Z'}});
      assert.equal(stop.disabled,false);
      assert.match(status.textContent,/is running/);
    }finally{acknowledge();await chat?.dispose();f.restore();}
  }
});

function viewPort(f:ReturnType<typeof fixture>){
 const time='2026-11-03T00:00:00Z',resourceId=f.draft.resourceId,trace:{name:string;input:any}[]=[];let selected:ConversationViewSelected={version:2,resourceId,updatedAt:time},view:ConversationView={resourceId,version:4,position:{conversationRevision:2,anchor:{messageId:'message:user',offsetY:-20}},selection:{draftVersion:f.draft.version,start:2,end:6,direction:'backward'},positionStatus:'current',selectionStatus:'current',updatedAt:time};
 let before:((name:string,input:any)=>void|Promise<void>)|undefined;
 const port={async command(name:string,input:any){if(name==='readViewState'){trace.push({name,input});const reply={contract:'aerynth.conversation-view@1',selected:structuredClone(selected),view:structuredClone(view)};await before?.(name,input);return reply;}await before?.(name,input);
  if(name==='saveViewState'){trace.push({name,input:structuredClone(input)});assert.equal(input.expectedVersion,view.version);assert.equal(input.resourceId,resourceId);assert.equal(input.selection?.draftVersion,f.draft.version,'Selection requires exact canonical draft ACK');assert(input.selection.end<=f.draft.content.length);view={...view,version:view.version+1,position:input.position,selection:input.selection};return structuredClone(view);}
  if(name==='selectView'){trace.push({name,input});assert.equal(input.expectedVersion,selected.version);selected={...selected,resourceId:input.resourceId,version:selected.version+1};return structuredClone(selected);}
  return (f.port.command as any)(name,input);
 }} as ConversationProductPort;
 return {port,trace,persistence:new ConversationViewPersistence({port}),get view(){return view;},get selected(){return selected;},before(fn:typeof before){before=fn;}};
}

test('saved anchor and exact draft selection restore on the same mounted view only after positive transcript bounds, without autofocus or writes',async()=>{
 const f=fixture(),v=viewPort(f);let chat;try{const previous=f.view.doc.createElement('button');f.view.root.append(previous);previous.focus();chat=mountConversationChat(f.view.root,{port:v.port,resourceId:f.draft.resourceId,viewPersistence:v.persistence});const messages=f.view.root.querySelector('.cp-messages');messages.clientHeight=0;await chat.ready;const editor=f.view.root.querySelector('textarea');assert.equal(editor.value,f.draft.content);assert.deepEqual([editor.selectionStart,editor.selectionEnd,editor.selectionDirection],[2,6,'backward']);assert.equal(f.view.doc.activeElement===previous,true);assert.equal(messages.scrollTop,0);assert.deepEqual(f.calls.filter(c=>c.name==='detail').map(c=>c.input.aroundMessageId),['message:user']);
  messages.clientHeight=messages.offsetHeight=50;messages.scrollHeight=400;messages.getBoundingClientRect=()=>({top:200,bottom:250,height:50});messages.querySelector('.cp-message-content').getBoundingClientRect=()=>({top:300-messages.scrollTop,bottom:370-messages.scrollTop,height:70});chat.frame();assert.equal(messages.scrollTop,120);messages.fire('scroll');await chat.flush();assert.equal(v.trace.filter(c=>c.name==='saveViewState').length,0,'Restoration/programmatic scroll must not write a new view');assert.equal(v.trace.filter(c=>c.name==='selectView').length,0);
  editor.focus();editor.setSelectionRange(1,4,'forward');editor.fire('pointerup');await chat.flush();assert.equal(v.view.version,5);assert.deepEqual(v.view.selection,{draftVersion:f.draft.version,start:1,end:4,direction:'forward'});assert.deepEqual(v.view.position?.anchor,{messageId:'message:user',offsetY:-20});assert.equal(f.calls.some(c=>['send','interrupt','saveDraft'].includes(c.name)),false);
 }finally{await chat?.dispose();f.restore();}
});

test('caret metadata follows only the latest draft ACK through an in-flight older text save',async()=>{
 const f=fixture(),v=viewPort(f);let chat,release!:()=>void,firstInFlight=false;try{chat=mountConversationChat(f.view.root,{port:v.port,resourceId:f.draft.resourceId,viewPersistence:v.persistence});await chat.ready;const gate=new Promise<void>(resolve=>release=resolve);v.before((name,input)=>{if(name==='saveDraft'&&input.content==='First synthetic edit'){firstInFlight=true;return gate;}});const editor=f.view.root.querySelector('textarea');editor.focus();editor.value='First synthetic edit';editor.setSelectionRange(1,2,'forward');editor.fire('input');const firstFlush=chat.flush();await until(()=>firstInFlight);editor.value='Exact later unsent draft 🧭';editor.setSelectionRange(3,9,'backward');editor.fire('input');editor.fire('pointerup');assert.equal(v.trace.filter(c=>c.name==='saveViewState').length,0);release();await firstFlush;await chat.flush();
  assert.equal(f.draft.version,5);assert.equal(f.draft.content,editor.value);assert.deepEqual(v.trace.filter(c=>c.name==='saveViewState').map(c=>c.input.selection),[{draftVersion:5,start:3,end:9,direction:'backward'}]);assert.deepEqual([editor.selectionStart,editor.selectionEnd,editor.selectionDirection],[3,9,'backward']);assert.equal(f.calls.some(c=>c.name==='send'),false);
 }finally{release?.();await chat?.dispose();f.restore();}
});

test('later actual editor intent suppresses a delayed saved anchor and selection without dropping new text',async()=>{
 const f=fixture(),v=viewPort(f);let chat,release!:()=>void;try{const gate=new Promise<void>(resolve=>release=resolve);v.before(name=>{if(name==='readViewState')return gate;});chat=mountConversationChat(f.view.root,{port:v.port,resourceId:f.draft.resourceId,viewPersistence:v.persistence});const editor=f.view.root.querySelector('textarea');await until(()=>editor.value===f.draft.content);editor.value='Exact new user intent while view loads';editor.setSelectionRange(4,8,'forward');editor.fire('input');release();await chat.ready;await chat.flush();assert.equal(editor.value,f.draft.content);assert.deepEqual([editor.selectionStart,editor.selectionEnd,editor.selectionDirection],[4,8,'forward']);assert.equal(f.calls.some(c=>c.name==='detail'&&c.input.aroundMessageId),false);assert.equal(v.view.selection?.draftVersion,f.draft.version);assert.equal(v.view.selection?.start,4);
 }finally{release?.();await chat?.dispose();f.restore();}
});

test('the newer full-view caret wins an older inline subscriber when both borrow the exact draft and view coordinators',async()=>{
 const f=fixture(),v=viewPort(f),shared=new ConversationDraftSession({port:v.port,resourceId:f.draft.resourceId});let earlier,later,release!:()=>void,started=false;try{const full=f.view.doc.createElement('section'),inline=f.view.doc.createElement('section');f.view.root.append(full,inline);const options={port:v.port,resourceId:f.draft.resourceId,viewPersistence:v.persistence,draftSession:shared};later=mountConversationChat(full,options);earlier=mountConversationChat(inline,{...options,presentation:'workspace'});await Promise.all([later.ready,earlier.ready]);
  const gate=new Promise<void>(resolve=>release=resolve);v.before((name,input)=>{if(name==='saveDraft'&&input.content==='Older inline edit'){started=true;return gate;}});const a=inline.querySelector('textarea'),b=full.querySelector('textarea');a.focus();a.value='Older inline edit';a.setSelectionRange(1,2,'forward');a.fire('input');const flushing=earlier.flush();await until(()=>started);b.focus();b.value='Newer full-view exact edit';b.setSelectionRange(5,10,'backward');b.fire('input');release();await flushing;await later.flush();
  assert.equal(f.draft.content,b.value);assert.deepEqual(v.trace.filter(c=>c.name==='saveViewState').map(c=>c.input.selection),[{draftVersion:f.draft.version,start:5,end:10,direction:'backward'}]);assert.equal(a.value,b.value);assert.deepEqual([b.selectionStart,b.selectionEnd,b.selectionDirection],[5,10,'backward']);assert.equal(v.trace.some(c=>c.name==='selectView'),false);
 }finally{release?.();await earlier?.dispose();await later?.dispose();await shared.dispose();f.restore();}
});

test('manager restores selected chat without a mutation, but a newer exact message open wins a delayed restore',async()=>{
 const f=fixture(),v=viewPort(f);let manager,release!:()=>void;try{manager=mountConversationManager(f.view.root,v.port,{viewPersistence:v.persistence});await manager.ready;assert.equal(manager.state.selectedResourceId,f.draft.resourceId);assert.equal(f.view.root.querySelector('textarea').selectionDirection,'backward');assert.equal(v.trace.filter(c=>c.name==='selectView'||c.name==='saveViewState').length,0);await manager.dispose();manager=undefined;
  const before=f.calls.length,gate=new Promise<void>(resolve=>release=resolve);v.before((name,input)=>{if(name==='readViewState'&&!input.resourceId)return gate;});manager=mountConversationManager(f.view.root,v.port,{viewPersistence:v.persistence});await until(()=>v.trace.filter(c=>c.name==='readViewState'&&!c.input.resourceId).length>=2);const newer=manager.open(f.draft.resourceId,'message:assistant');release();await Promise.all([manager.ready,newer]);await manager.flush();
  assert.deepEqual(f.calls.slice(before).filter(c=>c.name==='detail').map(c=>c.input.aroundMessageId),['message:assistant']);assert.equal(manager.state.selectedResourceId,f.draft.resourceId);assert.deepEqual(v.trace.filter(c=>c.name==='selectView').map(c=>c.input),[{resourceId:f.draft.resourceId,expectedVersion:2}]);assert.equal(v.view.position?.anchor?.messageId,'message:assistant');assert.equal(f.calls.some(c=>c.name==='send'),false);
 }finally{release?.();await manager?.dispose();f.restore();}
});

test('view and draft drains stay prompt during a pending provider receipt and retain the later exact selection',async()=>{
 const f=fixture('codex-app-server'),v=viewPort(f);let chat;try{chat=mountConversationChat(f.view.root,{port:v.port,resourceId:f.draft.resourceId,viewPersistence:v.persistence});await chat.ready;f.view.root.querySelector('.cp-composer').fire('submit');await until(()=>!!f.pending);const editor=f.view.root.querySelector('textarea');editor.value='Exact later unsent text during a turn';editor.setSelectionRange(3,7,'backward');editor.fire('input');let closed=false;void chat.dispose().then(()=>closed=true);await until(()=>closed);
  assert.ok(f.pending);assert.equal(f.draft.content,'Exact later unsent text during a turn');assert.deepEqual(v.view.selection,{draftVersion:f.draft.version,start:3,end:7,direction:'backward'});const saved=structuredClone(v.view);f.accept(true);await chat.whenSubmissionSettled();assert.deepEqual(v.view,saved);assert.equal(f.calls.filter(c=>c.name==='send').length,1);assert.equal(f.calls.some(c=>c.name==='interrupt'),false);
 }finally{f.pending?.reject(Error('synthetic cleanup'));await chat?.whenSubmissionSettled();await chat?.dispose();f.restore();}
});

test('empty/composer copy follows exact provider identity: ordinary plan and unknown providers never borrow Codex instructions',async()=>{
 for(const [providerId,placeholder,empty] of [['local','Write a message…','Save messages here without sending them to an AI.'],['mock-ordinary','Write a message…','Save messages here without sending them to an AI.'],['chatgpt-plan-responses','Ask anything…','History is saved in Aerynth.'],['codex-app-server','Ask Codex anything…','Start a conversation with Codex.'],['unverified-provider','Ask anything…','Start a conversation.']] as const){
  const f=fixture(providerId);let chat;try{f.detail.messages.items=[];f.detail.messages.total=f.detail.conversation.messageCount=0;chat=mountConversationChat(f.view.root,{port:f.port,resourceId:f.draft.resourceId});await chat.ready;assert.equal(f.view.root.querySelector('textarea').placeholder,placeholder);assert.ok(f.view.root.querySelector('.cp-chat-empty').textContent.includes(empty));if(!['codex-app-server'].includes(providerId))assert.equal(f.view.root.querySelector('.cp-chat-empty').textContent.includes('Codex'),false);assert.equal(f.calls.some(c=>['send','selectProvider','branch','create'].includes(c.name)),false);}finally{await chat?.dispose();f.restore();}
 }
});

test('ordinary plan submission reports preparation without claiming a Codex/native approval step or clearing the unsent draft',async()=>{
 const f=fixture('chatgpt-plan-responses');let chat;try{chat=mountConversationChat(f.view.root,{port:f.port,resourceId:f.draft.resourceId});await chat.ready;const editor=f.view.root.querySelector('textarea'),content=editor.value;f.view.root.querySelector('.cp-composer').fire('submit');await until(()=>!!f.pending);assert.equal(f.view.root.querySelector('.cp-chat-status').textContent,'Preparing your message. Your draft remains saved.');assert.equal(f.view.root.querySelector('.cp-capability-note').dataset.capabilityKind,'ordinary-plan');assert.equal(editor.value,content);assert.equal(f.draft.content,content);f.pending!.reject(new Error('synthetic_provider_unavailable'));await chat.whenSubmissionSettled();assert.equal(f.draft.content,content);assert.equal(f.calls.filter(c=>c.name==='send').length,1);}finally{f.pending?.reject(new Error('synthetic cleanup'));await chat?.dispose();f.restore();}
});

test('message times and keyed day dividers use canonical creation instants in the actual local calendar without changing editor or reading state',async()=>{
 const previousTZ=process.env.TZ;process.env.TZ='America/New_York';const f=fixture();let chat;
 try{f.detail.messages.items[0].createdAt='2026-11-02T03:30:00Z';f.detail.messages.items[1].createdAt='2026-11-02T05:30:00Z';f.detail.messages.items.push({...f.detail.messages.items[0],id:'message:third',content:'Same second local day',createdAt:'2026-11-02T06:30:00Z'});f.detail.messages.total=f.detail.conversation.messageCount=3;chat=mountConversationChat(f.view.root,{port:f.port,resourceId:f.draft.resourceId,initialScroll:123});await chat.ready;
  const editor=f.view.root.querySelector('textarea'),messages=f.view.root.querySelector('.cp-messages'),dividers=messages.querySelectorAll('.cp-chat-day'),articles=messages.querySelectorAll('.cp-message');assert.deepEqual(dividers.map((n:any)=>n.dataset.day),['2026-11-01','2026-11-02']);assert.deepEqual(dividers.map((n:any)=>n.dataset.beforeMessageId),['message:user','message:assistant']);assert.ok(dividers.every((n:any)=>n.getAttribute('role')==='separator'&&!!n.querySelector('hr')));
  for(const [index,message]of f.detail.messages.items.entries()){const time=articles[index].querySelector('time');assert.equal(time.getAttribute('datetime'),message.createdAt);assert.equal(time.textContent,new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit'}).format(new Date(message.createdAt)));}
  editor.focus();editor.setSelectionRange(2,6);messages.scrollTop=123;const draft=f.draft;await chat.refresh();assert.equal(f.view.root.querySelector('textarea'),editor);assert.equal(f.view.doc.activeElement,editor);assert.equal(editor.selectionStart,2);assert.equal(editor.selectionEnd,6);assert.equal(messages.scrollTop,123);assert.deepEqual(messages.querySelectorAll('.cp-chat-day'),dividers);assert.deepEqual(messages.querySelectorAll('.cp-message'),articles);assert.deepEqual(f.draft,draft);
 }finally{await chat?.dispose();f.restore();if(previousTZ===undefined)delete process.env.TZ;else process.env.TZ=previousTZ;}
});

test('invalid or revoked timestamp metadata is never replaced with current time and access loss clears day/time DOM with transcript',async()=>{
 const f=fixture();let chat,observe:((value:ConversationExecutionObservation)=>void)|undefined;try{for(const message of f.detail.messages.items)message.createdAt='invalid';chat=mountConversationChat(f.view.root,{port:f.port,resourceId:f.draft.resourceId,execution:{observe(_id,listener){observe=listener;return()=>{};},async cancel(){throw Error('no implicit interrupt');}}});await chat.ready;assert.equal(f.view.root.querySelector('.cp-chat-day').dataset.day,'unavailable');for(const time of f.view.root.querySelectorAll('time')){assert.equal(time.textContent,'Time unavailable');assert.equal(time.getAttribute('datetime'),null);}const draft=f.draft;observe!({resourceAvailable:false});assert.equal(f.view.root.querySelectorAll('.cp-chat-day').length,0);assert.equal(f.view.root.querySelectorAll('time').length,0);assert.deepEqual(f.draft,draft);}finally{await chat?.dispose();f.restore();}
});

test('history and quick-switch chat rows show only canonical title while actual metadata stays contextual',async()=>{
 const f=fixture();let manager;try{const summary={...f.detail.conversation,favorite:true,lastActivityAt:'2026-11-01T12:30:00Z'};f.history.items=[{kind:'conversation',resourceId:summary.resourceId,title:summary.title,excerpt:'',summary}];f.history.total=1;manager=mountConversationManager(f.view.root,f.port,{resourceId:f.draft.resourceId});await manager.ready;const row=f.view.root.querySelector('.cp-results').querySelector('button');assert.equal(row.textContent,summary.title);assert.ok(row.title.includes('Favorite'));assert.ok(row.getAttribute('aria-description').includes('Local recording'));assert.equal(f.view.root.querySelector('.cp-results').querySelectorAll('.cp-result-meta').length,0);await manager.openSwitcher();const quick=f.view.root.querySelector('.cp-switcher-results').querySelector('button');assert.equal(quick.textContent,summary.title);assert.ok(quick.title.includes('Favorite'));assert.ok(quick.getAttribute('aria-description').includes('Local recording'));assert.equal(f.calls.some(c=>['send','selectProvider','organize','branch'].includes(c.name)),false);}finally{await manager?.dispose();f.restore();}
});

test('quick search opens the exact message from the keyboard and never activates a superseded result',async()=>{
  const f=fixture();
  const resourceId=f.draft.resourceId,messageId=f.detail.messages.items[1].id;
  const summary=f.detail.conversation;
  f.history.items=[{kind:'conversation',resourceId,title:summary.title,excerpt:'',summary}];
  f.history.total=1;
  let manager,release!:()=>void,started!:()=>void;
  const slow=new Promise<void>(resolve=>{release=resolve;});
  const searchStarted=new Promise<void>(resolve=>{started=resolve;});
  const opened:string[][]=[];
  const port={async command(name:string,input:any){
    if(name==='search'&&input.text==='slow query'){
      started();
      await slow;
      return {items:[],total:0,offset:0,limit:12,hasMore:false};
    }
    if(name==='search'&&input.text==='readable'){
      assert.equal(input.limit,12);
      return {items:[{kind:'message',resourceId,messageId,title:summary.title,excerpt:'A readable response.'}],total:1,offset:0,limit:12,hasMore:false};
    }
    return (f.port.command as any)(name,input);
  }} as ConversationProductPort;
  try{
    manager=mountConversationManager(f.view.root,port,{resourceId,onResource:(id,message)=>opened.push([id,message??''])});
    await manager.ready;
    const editor=f.view.root.querySelector('textarea');
    editor.value='Unsent follow-up';editor.fire('input');
    await manager.openSwitcher();
    const switcher=f.view.root.querySelector('.cp-switcher'),input=switcher.querySelector('input');
    const results=switcher.querySelector('.cp-switcher-results'),oldRow=results.querySelector('button');
    input.value='slow query';input.fire('input');
    assert.equal(!!results.querySelector('button'),false);
    oldRow.fire('click');
    await searchStarted;
    input.value='readable';input.fire('input');
    input.fire('keydown',{key:'Enter'});
    assert.deepEqual(opened,[]);
    await new Promise(resolve=>setTimeout(resolve,160));
    assert.equal(results.querySelector('button').dataset.messageId,messageId);
    assert.match(results.textContent,/A readable response/);
    release();
    await new Promise<void>(resolve=>setImmediate(resolve));
    input.fire('keydown',{key:'Enter',isComposing:true});
    assert.deepEqual(opened,[]);
    input.fire('keydown',{key:'Enter'});
    await until(()=>opened.length===1);
    assert.deepEqual(opened,[[resourceId,messageId]]);
    assert.equal(f.calls.filter(c=>c.name==='detail').at(-1)?.input.aroundMessageId,messageId);
    assert.equal(f.view.root.querySelector('textarea'),editor);
    assert.equal(f.draft.content,'Unsent follow-up');
    assert.equal(switcher.open,false);
  }finally{release();await manager?.dispose();f.restore();}
});

test('mounted manager menus, branch/context and canonical nested folders borrow the same frame lifecycle without replacing the live composer',async()=>{
 const f=fixture(),m=pickerMotion();let manager;try{f.projects.push({id:'project:canonical',title:'Canonical project',version:1});f.collections.push({id:'folder:canonical',title:'Canonical folder',projectId:'project:canonical',version:1,ruleRevision:0,state:'active',parentId:null,rule:null,memberIds:[f.draft.resourceId],pinnedIds:[f.draft.resourceId]});manager=mountConversationManager(f.view.root,f.port,{resourceId:f.draft.resourceId,motion:m.motion,viewId:'manager:disclosures'});await manager.ready;manager.frame();const editor=f.view.root.querySelector('textarea');editor.value='Same canonical draft through menu motion 🧭';editor.fire('input');editor.setSelectionRange(2,8);await manager.flush();const draft=f.draft;
  for(const selector of ['.cp-new-chat','.cp-switcher','.cp-filters','.cp-history-tools','.cp-chat-options','.cp-chat-extras','[data-collection-id="folder:canonical"]']){const node=f.view.root.querySelector(selector);assert.ok(node,selector);assert.equal(node.dataset.cpMotionDisclosure,'true',selector);const body=node.querySelector('.cp-motion-disclosure-body');node.open=true;node.fire('toggle');manager.frame();assert.equal(body.inert,false,selector);assert.equal(body.hidden,false,selector);m.step(.5);manager.frame();assert.ok(Number.parseFloat(body.style.height)>0,selector);node.open=false;node.fire('toggle');manager.frame();assert.equal(body.inert,true,selector);assert.equal(body.hidden,false,selector+' retains closing paint');m.step();manager.frame();assert.equal(body.hidden,true,selector);assert.equal(f.view.root.querySelector('textarea')===editor,true);assert.deepEqual([editor.selectionStart,editor.selectionEnd],[2,8]);}
  assert.deepEqual(f.draft,draft);assert.equal(manager.state.selectedResourceId,f.draft.resourceId);assert.equal(f.calls.some(call=>['send','selectProvider','organize','branch'].includes(call.name)),false);
 }finally{await manager?.dispose();assert.equal(m.poses.size,0);f.restore();}
});

test('shared provider pill passes exact empty/continuation hints to the host without optimistic provider changes or draft replacement',async()=>{
 const f=fixture(),m=pickerMotion(),requests:any[]=[];let chat;try{f.detail.providers.push({id:'chatgpt-plan-responses',label:'ChatGPT plan',available:true,record:true,execute:true,nativeFork:false,history:'local',simulated:false,models:[]});const message=f.detail.messages.items[0];f.detail.messages.items=[];f.detail.messages.total=f.detail.conversation.messageCount=0;chat=mountConversationChat(f.view.root,{port:f.port,resourceId:f.draft.resourceId,motion:m.motion,viewId:'pill:test',onProviderChange:event=>{requests.push(event);}});await chat.ready;const editor=f.view.root.querySelector('textarea');editor.focus();editor.setSelectionRange(2,6);const draft=f.draft;
  const choose=()=>{f.view.root.querySelector('[data-cp-picker-for="Conversation provider"]').fire('click');f.view.root.querySelector('[data-cp-option-value="chatgpt-plan-responses"]').fire('click');};choose();await until(()=>requests.length===1);assert.deepEqual(requests[0],{resourceId:f.draft.resourceId,targetProviderId:'chatgpt-plan-responses',expectedRevision:2,mode:'empty'});assert.equal(f.detail.conversation.providerId,'local');assert.ok(f.view.root.querySelector('textarea')===editor);assert.deepEqual([editor.selectionStart,editor.selectionEnd],[2,6]);assert.deepEqual(f.draft,draft);
  f.detail.messages.items=[message];f.detail.messages.total=f.detail.conversation.messageCount=1;await chat.refresh();choose();await until(()=>requests.length===2);assert.equal(requests[1].mode,'continuation');assert.equal(f.calls.some(c=>['selectProvider','branch','send'].includes(c.name)),false);chat.frame();
 }finally{await chat?.dispose();assert.equal(m.poses.size,0);f.restore();}
});

test('manager continuation reviews selected canonical messages on a new provider and opens the child only after explicit review',async()=>{
 const f=fixture(),m=pickerMotion(),actions:any[]=[];let manager;const target='chatgpt-plan-responses',childId='chat:child-reviewed';f.detail.providers.push({id:target,label:'ChatGPT plan',available:true,record:true,execute:true,nativeFork:false,history:'local',simulated:false,models:[]});const native=f.port.command.bind(f.port),port={async command(name:any,input:any){if(name==='branch'){actions.push({name,input});return {resourceId:childId,handoffId:'handoff:reviewed',fingerprint:'fingerprint:reviewed'};}if(name==='reviewBranch'){actions.push({name,input});return {};}if(name==='readDraft'&&input.resourceId===childId)return {resourceId:childId,version:0,content:'',updatedAt:null};if(name==='detail'&&input.resourceId===childId){const detail=structuredClone(f.detail);detail.conversation={...detail.conversation,resourceId:childId,conversationId:'graph:child-reviewed',title:'Reviewed child',providerId:target,revision:1,messageCount:0};detail.messages={items:[],offset:0,total:0,limit:50,hasMore:false};detail.policy.resourceId=childId;return detail;}return (native as any)(name,input);}} as ConversationProductPort;
 try{manager=mountConversationManager(f.view.root,port,{resourceId:f.draft.resourceId,motion:m.motion,viewId:'manager:review'});await manager.ready;const editor=f.view.root.querySelector('textarea'),draft=f.draft;await manager.beginProviderContinuation(target);assert.equal(actions.length,0);assert.equal(manager.state.selectedResourceId,f.draft.resourceId);assert.equal(f.detail.conversation.providerId,'local');assert.ok(f.view.root.querySelector('textarea')===editor);assert.deepEqual(f.draft,draft);const sourceForm=f.view.root.querySelector('.cp-secondary').querySelector('form'),provider=sourceForm.querySelector('select[aria-label="Branch provider"]');assert.equal(provider.value,target);assert.equal(provider.hidden,true);const boxes=sourceForm.querySelector('fieldset').querySelectorAll('input');boxes[0].checked=true;boxes[0].fire('change');boxes[1].checked=false;boxes[1].fire('change');sourceForm.fire('submit');await until(()=>actions.length===1&&!!named(f.view.root,'Approve selected context'));assert.deepEqual(actions[0].input.includeMessageIds,['message:user']);assert.equal(actions[0].input.messageId,'message:assistant');assert.equal(actions[0].input.providerId,target);assert.equal(actions[0].input.expectedRevision,2);assert.equal(manager.state.selectedResourceId,f.draft.resourceId);named(f.view.root,'Approve selected context').fire('click');await until(()=>manager!.state.selectedResourceId===childId&&!!f.view.root.querySelector('.cp-chat[data-resource-id="chat:child-reviewed"]'));await until(()=>f.view.root.querySelector('.cp-manager').getAttribute('aria-busy')===null);assert.deepEqual(actions.map(a=>a.name),['branch','reviewBranch']);assert.equal(actions[1].input.approve,true);assert.equal(f.detail.conversation.providerId,'local');assert.deepEqual(f.draft,draft);assert.equal(f.calls.some(c=>['send','selectProvider'].includes(c.name)),false);manager.frame();}
 finally{await manager?.dispose();assert.equal(m.poses.size,0);f.restore();}
});

test('unknown send recovery and actual live preview share one transcript scroll owner with a compact MC summary and stable editor',async()=>{
 const f=fixture('codex-app-server'),m=pickerMotion();let chat;try{chat=mountConversationChat(f.view.root,{port:f.port,resourceId:f.draft.resourceId,motion:m.motion,viewId:'chat:feedback',presentation:'workspace'});await chat.ready;const editor=f.view.root.querySelector('textarea'),messages=f.view.root.querySelector('.cp-messages'),feedback=f.view.root.querySelector('.cp-chat-feedback');f.view.root.querySelector('.cp-composer').fire('submit');await until(()=>!!f.pending);f.pending!.resolve({id:'execution:unknown',resourceId:f.draft.resourceId,state:'unknown'});await chat.whenSubmissionSettled();assert.equal(f.view.root.querySelector('.cp-chat-status').textContent.includes('not confirmed'),true);assert.ok(messages.contains(f.view.root.querySelector('.cp-stream')));assert.ok(messages.contains(f.view.root.querySelector('.cp-draft-recovery')));assert.equal(feedback.querySelectorAll('.cp-draft-status').length,0);assert.equal(feedback.querySelectorAll('.cp-capability-note').length,0);assert.ok((m.targets.get('chat:feedback:feedback-bar')?.h??1000)<=40);const toggle=named(feedback,'Review send outcome'),body=f.view.root.querySelector('.cp-chat-inspection');assert.equal(body.hidden,true);toggle.fire('click');assert.equal(body.hidden,false);assert.equal(body.inert,false);assert.equal(named(f.view.root,'Send').disabled,true,'Opening recovery never acknowledges unknown send');m.step();chat.frame();toggle.fire('click');assert.equal(body.inert,true);assert.equal(body.hidden,false,'Close keeps actual body until shared motion settles');m.step();chat.frame();assert.equal(body.hidden,true);assert.ok(f.view.root.querySelector('textarea')===editor);assert.equal(f.draft.content,editor.value);assert.equal(f.calls.filter(c=>c.name==='send').length,1);}finally{f.pending?.reject(new Error('synthetic cleanup'));await chat?.dispose();assert.equal(m.poses.size,0);f.restore();}
});

test('an observed unknown Codex turn can be checked from the composer without sending or changing its draft', async () => {
  const f = fixture('codex-app-server');
  const resourceId = f.draft.resourceId;
  const execution = {
    id: 'exact-turn', resourceId, providerId: 'codex-app-server',
    commandId: 'exact-send', state: 'unknown' as const, startedAt: '2026-11-02T00:00:00Z',
    endedAt: null, taskVerified: false as const, recoveryAvailable: true as const,
  };
  const checks: string[][] = [];
  let observe!: (event: ConversationExecutionObservation) => void;
  const chat = mountConversationChat(f.view.root, { port: f.port, resourceId, execution: {
    observe(_resourceId, listener) { observe = listener; return () => {}; },
    async cancel() { throw Error('Unexpected interrupt'); },
    async recoverTurn(id, turnId) {
      checks.push([id, turnId]);
      if (checks.length === 1) return { state: 'unchanged' };
      observe({ execution: { ...execution, state: 'provider_completed', recoveryAvailable: undefined } });
      return { state: 'provider_completed' };
    },
  } });
  try {
    await chat.ready;
    const editor = f.view.root.querySelector('textarea');
    const draft = f.draft;
    observe({ execution });
    assert.equal(named(f.view.root, 'Send').disabled, true);
    named(f.view.root, 'Details').fire('click');
    const check = named(f.view.root, 'Check Codex outcome');
    assert.equal(check.hidden, false);
    check.fire('click');
    await until(() => f.view.root.querySelector('.cp-chat-status').textContent.includes('did not confirm'));
    assert.equal(named(f.view.root, 'Send').disabled, true);
    check.fire('click');
    await until(() => f.view.root.querySelector('.cp-chat-status').textContent.includes('Recovered the completed Codex turn'));
    assert.deepEqual(checks, [[resourceId, execution.id], [resourceId, execution.id]]);
    assert.equal(named(f.view.root, 'Send').disabled, true);
    assert.equal(f.view.root.querySelector('textarea'), editor);
    assert.deepEqual(f.draft, draft);
    assert.equal(f.calls.some(call => call.name === 'send' || call.name === 'saveDraft'), false);
  } finally { await chat.dispose(); f.restore(); }
});

test('actual live deltas follow only at the existing transcript tail; metadata refresh and deliberate scrolling do not jump reading position',async()=>{
 const f=fixture('codex-app-server'),m=pickerMotion();let chat,observe:((value:ConversationExecutionObservation)=>void)|undefined;const execution={id:'execution:stream-scroll',resourceId:f.draft.resourceId,providerId:'codex-app-server',commandId:'command:stream-scroll',state:'running' as const,startedAt:'2026-11-02T00:00:00Z',endedAt:null,taskVerified:false as const};try{chat=mountConversationChat(f.view.root,{port:f.port,resourceId:f.draft.resourceId,motion:m.motion,viewId:'chat:scroll',execution:{observe(_id,listener){observe=listener;return()=>{};},async cancel(){throw Error('no automatic cancel');}}});await chat.ready;const messages=f.view.root.querySelector('.cp-messages');messages.clientHeight=80;messages.scrollHeight=1000;messages.scrollTop=920;observe!({execution,delta:{eventId:'event:1',cursor:1,text:'Actual synthetic live text'}});messages.scrollHeight=1200;chat.frame();assert.equal(messages.scrollTop,1120);messages.scrollTop=100;messages.fire('wheel');observe!({execution,delta:{eventId:'event:2',cursor:2,text:' plus another actual delta'}});messages.scrollHeight=1400;chat.frame();assert.equal(messages.scrollTop,100);observe!({execution});chat.frame();assert.equal(messages.scrollTop,100);assert.equal(f.calls.some(c=>c.name==='send'),false);}finally{await chat?.dispose();assert.equal(m.poses.size,0);f.restore();}
});

test('linked checklist is an explicit contextual single-flight action for the current canonical conversation without replacing its editor',async()=>{
 const f=fixture();let manager,finish!:()=>void;const created:string[]=[];
 try{manager=mountConversationManager(f.view.root,f.port,{resourceId:f.draft.resourceId,onCreateChecklist:id=>{created.push(id);return new Promise<void>(resolve=>{finish=resolve;});}});await manager.ready;
  const editor=f.view.root.querySelector('textarea'),messages=f.view.root.querySelector('.cp-messages');editor.value='Exact unsent checklist-adjacent draft';editor.fire('input');editor.focus();editor.setSelectionRange(3,9);messages.scrollTop=17;await manager.flush();const draft=f.draft,before=f.calls.length;
  const options=f.view.root.querySelector('.cp-chat-options');assert.equal(options.open,false);assert.equal(created.length,0);options.open=true;options.fire('toggle');const create=named(options,'Create linked checklist');assert.equal(create.dataset.cpControl,'action');assert.equal(create.dataset.aerynthMotionControl,'true');create.fire('click');create.fire('click');assert.deepEqual(created,[f.detail.conversation.resourceId]);assert.notEqual(created[0],f.detail.conversation.conversationId);assert.equal(create.disabled,true);
  assert.equal(f.view.root.querySelector('textarea'),editor);assert.equal(f.view.doc.activeElement,editor);assert.equal(editor.selectionStart,3);assert.equal(editor.selectionEnd,9);assert.equal(messages.scrollTop,17);assert.deepEqual(f.draft,draft);assert.equal(f.calls.length,before,'Creation delegates only to the supplied creator, with no product command or refresh');
  await manager.refresh();const replacement=named(f.view.root.querySelector('.cp-chat-options'),'Create linked checklist');assert.equal(replacement.disabled,true);replacement.fire('click');assert.equal(created.length,1);finish();await until(()=>!replacement.disabled);assert.equal(f.view.root.querySelector('textarea'),editor);assert.deepEqual(f.draft,draft);assert.equal(f.calls.slice(before).some(c=>['create','organize','send','branch'].includes(c.name)),false);
 }finally{finish?.();await manager?.dispose();f.restore();}
});

test('linked checklist is omitted when the host has no creator or no conversation is selected',async()=>{
 const f=fixture();let manager;
 try{manager=mountConversationManager(f.view.root,f.port,{resourceId:f.draft.resourceId});await manager.ready;assert.equal(f.view.root.querySelectorAll('button').some((node:any)=>node.textContent==='Create linked checklist'),false);await manager.dispose();manager=mountConversationManager(f.view.root,f.port,{onCreateChecklist:()=>{throw new Error('must not run');}});await manager.ready;assert.equal(f.view.root.querySelectorAll('button').some((node:any)=>node.textContent==='Create linked checklist'),false);
 }finally{await manager?.dispose();f.restore();}
});

test('linked checklist rejection reports an honest failure without retrying or changing the current draft and view',async()=>{
 const f=fixture();let manager,calls=0;
 try{manager=mountConversationManager(f.view.root,f.port,{resourceId:f.draft.resourceId,onCreateChecklist:async()=>{calls++;throw new Error('synthetic_creator_denied');}});await manager.ready;const editor=f.view.root.querySelector('textarea'),draft=f.draft,before=f.calls.length,create=named(f.view.root.querySelector('.cp-chat-options'),'Create linked checklist');create.fire('click');await until(()=>f.view.root.querySelector('.cp-status').textContent.includes('synthetic_creator_denied'));assert.equal(calls,1);assert.equal(create.disabled,false);assert.equal(f.view.root.querySelector('.cp-status').textContent,'Could not create linked checklist: synthetic_creator_denied');assert.equal(f.view.root.querySelector('textarea'),editor);assert.deepEqual(f.draft,draft);assert.equal(manager.state.selectedResourceId,f.draft.resourceId);assert.equal(f.calls.length,before);
 }finally{await manager?.dispose();f.restore();}
});

test('manager honors a ready ordinary default until explicit provider choice and preserves unavailable choice without sending',async()=>{
 const f=fixture(),plan={id:'chatgpt-plan-responses',label:'ChatGPT plan · local history',available:true,record:true,execute:true,nativeFork:false,history:'local' as const,simulated:false,models:['synthetic-model'],default:true};f.detail.providers.push(plan);let manager;
 try{manager=mountConversationManager(f.view.root,f.port,{resourceId:f.draft.resourceId});await manager.ready;const editor=f.view.root.querySelector('textarea'),picker=f.view.root.querySelector('select[aria-label="New conversation provider"]');assert.equal(picker.value,plan.id);
  picker.value='local';picker.fire('change');await manager.refresh();assert.equal(picker.value,'local');assert.equal(f.view.root.querySelector('textarea'),editor);
  picker.value=plan.id;picker.fire('change');plan.available=plan.record=false;await manager.refresh();assert.equal(picker.value,plan.id);assert.equal(named(f.view.root,'Create conversation').disabled,true);assert.equal(f.calls.some(c=>['send','create','selectProvider'].includes(c.name)),false);
 }finally{await manager?.dispose();f.restore();}
});

test('canonical partial output is labelled separately while exact text, editor identity and draft remain intact',async()=>{
 const f=fixture('chatgpt-plan-responses');f.detail.messages.items[1].outputState='partial';f.detail.messages.items[1].executionId='execution:actual-receipt';let chat;
 try{chat=mountConversationChat(f.view.root,{port:f.port,resourceId:f.draft.resourceId});await chat.ready;const editor=f.view.root.querySelector('textarea'),message=f.view.root.querySelector('[data-message-id="message:assistant"]');assert.equal(message.dataset.outputState,'partial');assert.match(message.querySelector('.cp-message-source').textContent,/partial response/);assert.match(message.querySelector('.cp-message-content').textContent,/readable/);await chat.refresh();assert.equal(f.view.root.querySelector('textarea'),editor);assert.equal(editor.value,'Saved unsent text');assert.equal(f.calls.some(c=>c.name==='send'),false);
 }finally{await chat?.dispose();f.restore();}
});

test('conversation search groups exact message links instead of a message wall and retains canonical open targets',async()=>{
  const f=fixture();let manager;
  try{const original=f.detail.messages.items[0];f.detail.messages.items=Array.from({length:8},(_,i)=>({...original,id:'message:match:'+i,content:'needle excerpt '+i}));f.detail.messages.total=f.detail.conversation.messageCount=8;
    f.history.items=f.detail.messages.items.map(message=>({kind:'message',resourceId:f.draft.resourceId,messageId:message.id,title:f.detail.conversation.title,excerpt:message.content,providerId:'local'}));f.history.items.push({kind:'resource',resourceId:'note:matched',title:'Authorized note',excerpt:'needle source'});f.history.total=9;
    const state={selectedResourceId:null,drafts:{},scroll:{},query:{text:'needle'},messageOffset:{}};manager=mountConversationManager(f.view.root,f.port,{state});await manager.ready;
    const results=f.view.root.querySelector('.cp-results');assert.equal(results.querySelectorAll('.cp-result-group').length,1);const group=results.querySelector('.cp-result-group');assert.equal(group.children.filter((node:any)=>node.dataset.resultKind==='message').length,3);const more=group.querySelector('.cp-search-matches');assert.equal(more.open,false);assert.equal(more.querySelectorAll('[data-message-id]').length,5);assert.equal(results.querySelector('.cp-resource-matches').open,false);
    more.open=true;more.fire('toggle');more.querySelectorAll('[data-message-id]').find((node:any)=>node.dataset.messageId==='message:match:7').fire('click');await until(()=>f.calls.some(call=>call.name==='detail'&&call.input.aroundMessageId==='message:match:7'));await until(()=>f.view.root.querySelector('.cp-manager').getAttribute('aria-busy')===null);assert.equal(state.selectedResourceId,f.draft.resourceId);assert.equal(f.calls.some(call=>['send','selectProvider','organize'].includes(call.name)),false);
  }finally{await manager?.dispose();f.restore();}
});

test('canonical project/folder tree is truly nested, preserves disclosure state and identifies smart versus manual membership',async()=>{
  const f=fixture();let manager;
  try{f.projects.push({id:'project:canonical',title:'Canonical project',version:1});const base={projectId:'project:canonical',version:1,ruleRevision:0,state:'active',memberIds:[f.draft.resourceId,'chat:derived'],pinnedIds:[f.draft.resourceId]};f.collections.push({...base,id:'folder:parent',title:'Parent folder',parentId:null,rule:null},{...base,id:'folder:child',title:'Nested smart collection',parentId:'folder:parent',rule:{text:'needle'}});f.history.items=[{kind:'conversation',resourceId:f.draft.resourceId,title:f.detail.conversation.title,excerpt:''}];f.history.total=1;
    manager=mountConversationManager(f.view.root,f.port,{resourceId:f.draft.resourceId});await manager.ready;const tree=f.view.root.querySelector('.cp-library-tree'),project=tree.querySelector('[data-project-id="project:canonical"]'),parent=tree.querySelector('[data-collection-id="folder:parent"]'),child=tree.querySelector('[data-collection-id="folder:child"]');assert.equal(project.tagName,'DETAILS');assert.equal(parent.tagName,'DETAILS');assert.equal(child.parentElement,parent.querySelector('.cp-tree-children'));assert.equal(child.dataset.collectionKind,'smart');assert.match(child.textContent,/1 manual · 1 smart matches/);
    for(const node of [project,parent,child]){node.open=true;node.fire('toggle');}const editor=f.view.root.querySelector('textarea');editor.value='Durable draft before folder navigation';editor.fire('input');named(child,'View smart collection').fire('click');await until(()=>manager!.state.query.collectionId==='folder:child');await until(()=>f.view.root.querySelector('.cp-manager').getAttribute('aria-busy')===null);assert.equal(f.draft.content,editor.value);assert.equal(manager.state.selectedResourceId,null);assert.match(f.view.root.querySelector('.cp-results').querySelector('button').title,/Manual member/);await manager.refresh();assert.equal(f.view.root.querySelector('[data-collection-id="folder:parent"]').open,true);assert.equal(f.calls.some(call=>['organize','collectionRule','send'].includes(call.name)),false);
  }finally{await manager?.dispose();f.restore();}
});

test('quick switcher requests only a bounded conversation page, supports keyboard focus and reuses canonical open/draft state',async()=>{
  const f=fixture();let manager;
  try{f.history.items=Array.from({length:20},(_,i)=>({kind:'conversation',resourceId:i?'chat:recent:'+i:f.draft.resourceId,title:i?'Recent chat '+i:f.detail.conversation.title,excerpt:''}));f.history.total=20;manager=mountConversationManager(f.view.root,f.port,{resourceId:f.draft.resourceId});await manager.ready;const editor=f.view.root.querySelector('textarea');editor.value='Exact quick-switch draft';editor.fire('input');editor.setSelectionRange(2,7);const before=f.calls.filter(call=>call.name==='detail').length;await manager.openSwitcher();
    const switcher=f.view.root.querySelector('.cp-switcher'),input=switcher.querySelector('input'),rows=switcher.querySelector('.cp-switcher-results').querySelectorAll('button');assert.equal(rows.length,12);assert.equal(f.calls.filter(call=>call.name==='list').at(-1)!.input.limit,12);assert.equal(f.calls.filter(call=>call.name==='detail').length,before);input.fire('keydown',{key:'ArrowDown'});assert.equal(f.view.doc.activeElement,rows[0]);rows[0].fire('keydown',{key:'ArrowDown'});assert.equal(f.view.doc.activeElement,rows[1]);rows[1].fire('keydown',{key:'ArrowUp'});rows[0].fire('click');await until(()=>f.view.root.querySelector('.cp-manager').getAttribute('aria-busy')===null);assert.equal(f.view.root.querySelector('textarea'),editor);assert.equal(f.draft.content,editor.value);assert.equal(manager.state.selectedResourceId,f.draft.resourceId);assert.equal(switcher.open,false);assert.equal(f.calls.some(call=>['send','create','capabilities'].includes(call.name)),false);
  }finally{await manager?.dispose();f.restore();}
});

test('quick local creation explicitly selects actual recording identity and default title while a canonical refusal stays a failure',async()=>{
  const f=fixture();let manager,created:any;const native=f.port.command.bind(f.port),port={async command(name:any,input:any){if(name==='create'){created=input;throw new Error('synthetic_create_refused');}return (native as any)(name,input);}} as ConversationProductPort;
  try{manager=mountConversationManager(f.view.root,port,{resourceId:f.draft.resourceId});await manager.ready;const editor=f.view.root.querySelector('textarea');await manager.openSwitcher();named(f.view.root.querySelector('.cp-switcher'),'New local conversation').fire('click');await until(()=>f.view.root.querySelector('.cp-status').textContent==='synthetic_create_refused');assert.equal(created.providerId,'local');assert.equal(created.title,'New conversation');assert.ok(created.commandId);assert.equal(manager.state.selectedResourceId,f.draft.resourceId);assert.equal(f.view.root.querySelector('textarea'),editor);assert.equal(f.calls.some(call=>['send','selectProvider','execute'].includes(call.name)),false);
  }finally{await manager?.dispose();f.restore();}
});

test('latest explicit open queued during a read is not dropped or replayed through older navigation intents',async()=>{
  const f=fixture();let manager,release:(()=>void)|undefined;
  try{manager=mountConversationManager(f.view.root,f.port,{resourceId:f.draft.resourceId});await manager.ready;f.detail.messages.items.push({...f.detail.messages.items[0],id:'message:third'});f.detail.messages.total=f.detail.conversation.messageCount=3;const gate=new Promise<void>(resolve=>{release=resolve;});f.gateDetail(gate);const before=f.calls.filter(call=>call.name==='detail').length,reading=manager.refresh();await until(()=>f.calls.filter(call=>call.name==='detail').length>before);const a=manager.open(f.draft.resourceId,'message:user'),b=manager.open(f.draft.resourceId,'message:assistant'),c=manager.open(f.draft.resourceId,'message:third');release!();f.gateDetail(null);await Promise.all([reading,a,b,c]);assert.deepEqual(f.calls.filter(call=>call.name==='detail'&&call.input.aroundMessageId).map(call=>call.input.aroundMessageId),['message:third']);assert.equal(manager.state.selectedResourceId,f.draft.resourceId);assert.equal(f.calls.some(call=>['send','interrupt','create'].includes(call.name)),false);
  }finally{release?.();f.gateDetail(null);await manager?.dispose();f.restore();}
});

test('closing a view cancels queued navigation rendering while retaining exact durable drafts and ongoing provider ownership',async()=>{
  const f=fixture();let manager,release:(()=>void)|undefined;
  try{manager=mountConversationManager(f.view.root,f.port,{resourceId:f.draft.resourceId});await manager.ready;const editor=f.view.root.querySelector('textarea');editor.value='Exact close-during-navigation draft';editor.fire('input');const before=f.calls.filter(call=>call.name==='detail').length;f.gateDetail(new Promise<void>(resolve=>{release=resolve;}));const reading=manager.refresh();await until(()=>f.calls.filter(call=>call.name==='detail').length>before);const queued=manager.open(f.draft.resourceId,'message:assistant');await manager.dispose();assert.equal(f.draft.content,editor.value);assert.equal(f.view.root.querySelector('.cp-manager'),null);release!();f.gateDetail(null);await Promise.all([reading,queued]);assert.equal(f.calls.some(call=>call.name==='detail'&&call.input.aroundMessageId==='message:assistant'),false);assert.equal(f.calls.some(call=>['send','interrupt','create'].includes(call.name)),false);
  }finally{release?.();f.gateDetail(null);await manager?.dispose();f.restore();}
});

test('smart conversation save uses the returned collection ID when titles are duplicated',async()=>{
  const f=fixture();let manager;const ruleWrites:any[]=[],native=f.port.command.bind(f.port),base={title:'Repeated title',projectId:null,version:1,ruleRevision:0,state:'active',parentId:null,rule:null,memberIds:[],pinnedIds:[]};f.collections.push({...base,id:'collection:old'});
  const port={async command(name:any,input:any){if(name==='organize'&&input.type==='createCollection'){f.collections.push({...base,id:'collection:new'});return {id:'collection:new',version:1};}if(name==='collectionRule'){ruleWrites.push(input);return f.collections;}return (native as any)(name,input);}} as ConversationProductPort;
  try{manager=mountConversationManager(f.view.root,port,{resourceId:f.draft.resourceId});await manager.ready;f.view.root.querySelector('input[aria-label="New folder title"]').value='Repeated title';named(f.view.root,'Save as smart conversation collection').fire('click');await until(()=>ruleWrites.length===1);assert.equal(ruleWrites[0].collectionId,'collection:new');assert.equal(ruleWrites[0].rule.searchMode,'conversations');assert.equal(f.collections.find(c=>c.id==='collection:old')!.rule,null);assert.equal(f.calls.some(call=>call.name==='send'),false);
  }finally{await manager?.dispose();f.restore();}
});

test('new nested folder uses its canonical parent project and returned ID without broadening a collection-scoped smart search',async()=>{
  const f=fixture();let manager;const writes:any[]=[],native=f.port.command.bind(f.port);f.projects.push({id:'project:parent',title:'Parent project',version:1});f.collections.push({id:'folder:parent',title:'Parent',projectId:'project:parent',version:1,ruleRevision:0,state:'active',parentId:null,rule:null,memberIds:[],pinnedIds:[]});
  const port={async command(name:any,input:any){if(name==='organize'&&input.type==='createCollection'){writes.push(input);f.collections.push({id:'folder:created',title:input.title,projectId:input.projectId,version:1,ruleRevision:0,state:'active',parentId:null,rule:null,memberIds:[],pinnedIds:[]});return {id:'folder:created'};}if(name==='collectionRule'){writes.push(input);f.collections.find(c=>c.id===input.collectionId)!.parentId=input.parentId;return f.collections;}return (native as any)(name,input);}} as ConversationProductPort;
  try{manager=mountConversationManager(f.view.root,port,{state:{selectedResourceId:f.draft.resourceId,drafts:{},scroll:{},query:{collectionId:'folder:parent'},messageOffset:{}}});await manager.ready;const smart=named(f.view.root,'Save as smart conversation collection');assert.equal(smart.disabled,true);assert.match(smart.title,/within one folder cannot be saved/);const title=f.view.root.querySelector('input[aria-label="New folder title"]');title.value='Child';title.closest('form').fire('submit');await until(()=>writes.length===2);await until(()=>f.view.root.querySelector('.cp-manager').getAttribute('aria-busy')===null);assert.equal(writes[0].projectId,'project:parent');assert.equal(writes[1].collectionId,'folder:created');assert.equal(writes[1].parentId,'folder:parent');assert.equal(f.collections.filter(c=>c.id==='folder:created').length,1);assert.equal(f.view.root.querySelector('[data-collection-id="folder:created"]').parentElement,f.view.root.querySelector('[data-collection-id="folder:parent"]').querySelector('.cp-tree-children'));
  }finally{await manager?.dispose();f.restore();}
});

test('compact branch navigation shows parent/current/child/sibling and exact fork source without merging provider identities',async()=>{
  const f=fixture();let manager;
  try{const edge={id:'edge:parent',parentResourceId:'chat:parent',childResourceId:f.draft.resourceId,sourceMessageId:'message:user',mode:'native_fork',createdAt:'2026-11-02T00:00:00Z'};f.detail.lineage=[edge,{...edge,id:'edge:child',parentResourceId:f.draft.resourceId,childResourceId:'chat:child',mode:'application_continuation'},{...edge,id:'edge:sibling',childResourceId:'chat:sibling',mode:'application_continuation'}];f.history.items=[f.draft.resourceId,'chat:parent','chat:child','chat:sibling'].map((resourceId,i)=>({kind:'conversation',resourceId,title:'Branch '+i,excerpt:'',summary:{...f.detail.conversation,resourceId,title:'Branch '+i,providerId:i===1?'codex-app-server':'local'}}));f.history.total=4;manager=mountConversationManager(f.view.root,f.port,{resourceId:f.draft.resourceId});await manager.ready;
    const extras=f.view.root.querySelector('.cp-chat-extras'),navigator=f.view.root.querySelector('.cp-branch-navigator');for(const node of [extras,navigator]){node.open=true;node.fire('toggle');}await until(()=>navigator.querySelectorAll('.cp-branch-row').length===4);const rows=navigator.querySelectorAll('.cp-branch-row');assert.deepEqual(rows.map((row:any)=>row.dataset.relation),['parent','current','child','sibling']);assert.match(rows[0].textContent,/Native provider fork/);assert.match(rows[2].textContent,/Application context continuation/);assert.equal(rows[1].querySelector('button').disabled,true);assert.equal(rows[0].dataset.resourceId,'chat:parent');named(rows[2],'Fork source').fire('click');await until(()=>f.calls.some(call=>call.name==='detail'&&call.input.aroundMessageId==='message:user'));assert.equal(f.calls.some(call=>['branch','publish','attachShare','send'].includes(call.name)),false);
  }finally{await manager?.dispose();f.restore();}
});

test('first-party Open is explicit and single-flight across detail refresh without sending or changing conversation authority',async()=>{
  const f=fixture();let manager,calls=0,finish!:(receipt:{status:'requested'})=>void;
  try{addChatGPTCompatibility(f);manager=mountConversationManager(f.view.root,f.port,{resourceId:f.draft.resourceId,onOpenChatGPT:()=>{calls++;return new Promise(resolve=>{finish=resolve;});}});await manager.ready;
    const editor=f.view.root.querySelector('textarea');editor.focus();editor.setSelectionRange(2,6);const draft=f.draft,priorCalls=f.calls.length;
    const compatibility=f.view.root.querySelector('.cp-chatgpt-compatibility');compatibility.open=true;compatibility.fire('toggle');assert.equal(calls,0);
    const open=named(compatibility,'Open ChatGPT');assert.equal(open.dataset.firstPartyTarget,'chatgpt-home');open.fire('click');open.fire('click');assert.equal(calls,1);assert.equal(open.disabled,true);
    await manager.refresh();const current=named(f.view.root.querySelector('.cp-chatgpt-compatibility'),'Open ChatGPT');assert.equal(current.disabled,true);current.fire('click');assert.equal(calls,1);
    finish({status:'requested'});await until(()=>!current.disabled);assert.equal(f.view.root.querySelector('.cp-status').textContent,'Open requested. Continue in ChatGPT.');
    assert.equal(f.view.root.querySelector('textarea'),editor);assert.equal(f.view.doc.activeElement,editor);assert.equal(editor.selectionStart,2);assert.equal(editor.selectionEnd,6);assert.deepEqual(f.draft,draft);
    assert.equal(f.detail.providers.find(p=>p.id==='chatgpt')?.available,false);assert.equal(f.calls.slice(priorCalls).some(c=>['send','selectProvider','branch','create'].includes(c.name)),false);
  }finally{finish?.({status:'requested'});await manager?.dispose();f.restore();}
});

for(const outcome of ['unknown','unavailable','error']as const)test('first-party '+outcome+' receipt never becomes account connection or an automatic retry',async()=>{
  const f=fixture();let manager,calls=0;
  try{addChatGPTCompatibility(f);manager=mountConversationManager(f.view.root,f.port,{resourceId:f.draft.resourceId,onOpenChatGPT:async()=>{calls++;if(outcome==='error')throw Error('Synthetic OS response lost');return {status:outcome};}});await manager.ready;
    const open=named(f.view.root.querySelector('.cp-chatgpt-compatibility'),'Open ChatGPT');assert.equal(calls,0);open.fire('click');await until(()=>!open.disabled);
    const status=f.view.root.querySelector('.cp-status').textContent;assert.match(status,outcome==='unavailable'?/unavailable/:/could not be confirmed/);assert.doesNotMatch(status,/connected|synchroniz|signed in/i);await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);
    assert.equal(f.calls.some(c=>['send','selectProvider','branch','create'].includes(c.name)),false);
  }finally{await manager?.dispose();f.restore();}
});

test('a host without first-party navigation still exposes compatibility without a dead Open control',async()=>{
  const f=fixture();let manager;
  try{addChatGPTCompatibility(f);manager=mountConversationManager(f.view.root,f.port,{resourceId:f.draft.resourceId});await manager.ready;assert.equal(f.view.root.querySelectorAll('.cp-fidelity-aim').length,13);assert.equal(named(f.view.root,'Open ChatGPT'),undefined);}
  finally{await manager?.dispose();f.restore();}
});

test('an invoked evidence link requests its exact public reference through the host without page navigation or account actions',async()=>{
  const f=fixture(),references:(string|undefined)[]=[];let manager;
  try{addChatGPTCompatibility(f);manager=mountConversationManager(f.view.root,f.port,{resourceId:f.draft.resourceId,onOpenChatGPT:async reference=>{references.push(reference);return {status:'requested'};}});await manager.ready;
    assert.equal(references.length,0);const link=f.view.root.querySelector('.cp-fidelity-evidence').querySelector('a'),event=link.fire('click');assert.equal(event.defaultPrevented,true);await until(()=>f.view.root.querySelector('.cp-status').textContent==='Reference open requested.');
    assert.deepEqual(references,[link.href]);assert.equal(f.calls.some(c=>['send','selectProvider','branch','create'].includes(c.name)),false);
  }finally{await manager?.dispose();f.restore();}
});

test('mounted ChatGPT compatibility is explicitly collapsed with exactly 13 labelled status rows and provider gates only in the centered pill',async()=>{
  const f=fixture(),m=pickerMotion();let manager;
  try{addChatGPTCompatibility(f);manager=mountConversationManager(f.view.root,f.port,{resourceId:f.draft.resourceId,motion:m.motion,viewId:'compatibility:single-provider'});await manager.ready;
    const compatibility=f.view.root.querySelector('.cp-chatgpt-compatibility'),providers=f.view.root.querySelector('.cp-provider-capabilities');
    assert.equal(compatibility.tagName,'DETAILS');assert.equal(compatibility.open,false);assert.equal(providers.open,false);assert.equal(named(compatibility,'ChatGPT compatibility','summary').dataset.cpControl,'providers');
    const report=createNativeChatGPTFidelityDescriptor(),rows=compatibility.querySelectorAll('.cp-fidelity-aim');assert.equal(rows.length,13);
    assert.deepEqual(rows.map((row:any)=>row.dataset.aimId),report.aims.map(aim=>aim.id));
    for(const [index,row]of rows.entries()){assert.equal(row.open,false);assert.equal(row.dataset.status,report.aims[index].status);assert.equal(row.querySelector('.cp-control-label').textContent,report.aims[index].label);assert.ok(row.querySelector('.cp-fidelity-status').textContent);}
    assert.equal(providers.querySelector('select'),null);assert.equal(named(providers,'Use provider for future turns'),undefined);assert.equal(named(providers,'Continue with this provider'),undefined);const pill=f.view.root.querySelector('[data-cp-picker-for="Conversation provider"]');pill.fire('click');const blocked=f.view.root.querySelector('[data-cp-option-value="chatgpt"]');assert.equal(blocked.disabled,true);blocked.fire('click');assert.equal(f.calls.some(call=>call.name==='selectProvider'),false);
    assert.equal(f.view.root.querySelector('select[aria-label="New conversation provider"]').options.some((option:any)=>option.value==='chatgpt'),false);
    assert.ok(f.calls.every(call=>['collections','providers','projects','list','search','readDraft','detail'].includes(call.name)),'Mounting compatibility cannot authorize, send or connect');
  }finally{await manager?.dispose();f.restore();}
});

test('invoked compatibility exposes exact interface/scope/reason/evidence, date and runtime limits; inference/navigation remain separate',async()=>{
  const f=fixture();let manager;
  try{const report=createNativeChatGPTFidelityDescriptor();addChatGPTCompatibility(f,report);manager=mountConversationManager(f.view.root,f.port,{resourceId:f.draft.resourceId});await manager.ready;
    const extras=f.view.root.querySelector('.cp-chat-extras'),providers=f.view.root.querySelector('.cp-provider-capabilities'),compatibility=f.view.root.querySelector('.cp-chatgpt-compatibility');for(const node of [extras,providers,compatibility]){node.open=true;node.fire('toggle');}
    const count=f.calls.length,row=compatibility.querySelectorAll('.cp-fidelity-aim').find((node:any)=>node.dataset.aimId==='existing-chat-discovery');row.open=true;row.fire('toggle');
    const aim=report.aims.find(item=>item.id==='existing-chat-discovery')!,values=row.querySelectorAll('dd').map((node:any)=>node.textContent);assert.deepEqual(values,[aim.interfaceName,aim.statusScope,aim.reason,report.statusDefinitions[aim.status]]);
    assert.match(row.querySelector('.cp-fidelity-alternative').textContent,/Other native-account interfaces: Unverified/);
    assert.deepEqual(row.querySelectorAll('a').map((link:any)=>link.href),aim.evidence.map(source=>new URL(source.url).href));for(const link of row.querySelectorAll('a')){assert.equal(link.target,'_blank');assert.equal(link.rel,'noopener noreferrer');}
    assert.match(compatibility.querySelector('.cp-fidelity-review').textContent,/2026-11-02.*Runtime account access unverified/);
    const related=compatibility.querySelector('.cp-fidelity-related');assert.equal(related.querySelectorAll('.cp-fidelity-aim').length,0);assert.deepEqual(related.querySelectorAll('.cp-fidelity-related-row').map((node:any)=>node.dataset.relatedCapabilityId),report.relatedCapabilities.map(item=>item.id));assert.match(related.textContent,/do not establish native ChatGPT account fidelity/);assert.match(related.querySelectorAll('.cp-fidelity-related-row')[0].textContent,/Implementation in progress; account authorization and live inference remain unverified/);
    const escaped=row.querySelector('summary').fire('keydown',{key:'Escape'});assert.equal(escaped.defaultPrevented,true);assert.equal(row.open,false);assert.equal(compatibility.open,true);assert.equal(f.view.doc.activeElement,row.querySelector('summary'));assert.equal(f.calls.length,count);
  }finally{await manager?.dispose();f.restore();}
});

test('compatibility inspection and same-chat refresh retain composer, caret, draft, keyed messages and disclosure scope',async()=>{
  const f=fixture();let manager;
  try{addChatGPTCompatibility(f);manager=mountConversationManager(f.view.root,f.port,{resourceId:f.draft.resourceId});await manager.ready;
    const extras=f.view.root.querySelector('.cp-chat-extras'),providers=f.view.root.querySelector('.cp-provider-capabilities'),compatibility=f.view.root.querySelector('.cp-chatgpt-compatibility'),row=compatibility.querySelectorAll('.cp-fidelity-aim')[7];for(const node of [extras,providers,compatibility,row]){node.open=true;node.fire('toggle');}
    const editor=f.view.root.querySelector('textarea'),message=f.view.root.querySelector('.cp-message'),messages=f.view.root.querySelector('.cp-messages');messages.scrollTop=37;editor.value='Exact unsent draft while reviewing compatibility';editor.fire('input');editor.focus();editor.setSelectionRange(6,12);await manager.flush();await manager.refresh();
    assert.equal(f.view.root.querySelector('textarea'),editor);assert.equal(f.view.root.querySelector('.cp-message'),message);assert.equal(f.view.root.querySelector('.cp-messages'),messages);assert.equal(messages.scrollTop,37);assert.equal(f.view.doc.activeElement,editor);assert.deepEqual([editor.selectionStart,editor.selectionEnd],[6,12]);assert.equal(f.draft.content,editor.value);
    assert.equal(f.view.root.querySelector('.cp-provider-capabilities').open,true);const refreshed=f.view.root.querySelector('.cp-chatgpt-compatibility');assert.equal(refreshed.open,true);assert.equal(refreshed.querySelectorAll('.cp-fidelity-aim').find((node:any)=>node.dataset.aimId==='account-memories').open,true);
    assert.equal(f.calls.some(call=>['send','selectProvider','create','capabilities','interrupt'].includes(call.name)),false);
  }finally{await manager?.dispose();f.restore();}
});

test('compatibility evidence is text-safe and rejects unsafe links; legacy provider descriptors remain usable',async()=>{
  const f=fixture();let manager;
  try{const report=JSON.parse(JSON.stringify(createNativeChatGPTFidelityDescriptor()));report.aims[0].evidence[0].url='javascript:alert(1)';report.aims[0].reason='<img src=x onerror=alert(1)>';addChatGPTCompatibility(f,report);manager=mountConversationManager(f.view.root,f.port,{resourceId:f.draft.resourceId});await manager.ready;
    const row=f.view.root.querySelector('.cp-fidelity-aim');assert.equal(row.querySelector('img'),null);assert.match(row.textContent,/<img src=x/);assert.match(row.textContent,/Evidence link unavailable/);assert.equal(row.querySelectorAll('a').some((link:any)=>link.href.startsWith('javascript:')),false);
    f.detail.providers[1]={id:'chatgpt',label:'Legacy ChatGPT unavailable',available:false,record:false,execute:false,nativeFork:false,history:'unavailable',reason:'Legacy unavailable reason',simulated:false,models:[]};await manager.refresh();assert.equal(f.view.root.querySelector('.cp-chatgpt-compatibility'),null);assert.match(f.view.root.querySelector('.cp-provider-capabilities').textContent,/Legacy unavailable reason/);assert.equal(f.view.root.querySelector('.cp-provider-capabilities').querySelector('select'),null);assert.equal(f.view.root.querySelector('select[aria-label="New conversation provider"]').options.some((option:any)=>option.value==='chatgpt'),false);
  }finally{await manager?.dispose();f.restore();}
});

test('an exact failed ordinary reply keeps its draft and enables a new explicit send',async()=>{
 const f=fixture('chatgpt-plan-responses');let chat;
 try{
  chat=mountConversationChat(f.view.root,{port:f.port,resourceId:f.draft.resourceId});await chat.ready;
  const form=f.view.root.querySelector('form'),send=named(form,'Send');
  form.fire('submit');await until(()=>!!f.pending);
  f.pending?.resolve({id:'execution:failed',resourceId:f.draft.resourceId,providerId:'chatgpt-plan-responses',commandId:f.pending?.input.commandId,state:'failed',errorCode:'server_error'});
  await until(()=>!send.disabled);
  assert.match(f.view.root.querySelector('.cp-chat-status').textContent,/ended the reply with an error/);
  assert.equal(f.view.root.querySelector('textarea').value,f.draft.content);
  assert.equal(f.calls.filter(call=>call.name==='send').length,1);
  form.fire('submit');await until(()=>!!f.pending);
  f.accept(true);
  await until(()=>!f.view.root.querySelector('textarea').value);
  assert.equal(f.calls.filter(call=>call.name==='send').length,2);
 }finally{await chat?.dispose();f.restore();}
});

test('the animated model picker refreshes explicitly and sends the selected catalog ID without switching provider',async()=>{
 const f=fixture('chatgpt-plan-responses'),m=pickerMotion();
 const choice={id:'account-model-slug',label:'Account model display name'};
 const models={selections:new Map(),async refresh(){refreshes++;f.detail.providers[0].modelOptions=[choice];}};
 let chat,refreshes=0;
 try{
  chat=mountConversationChat(f.view.root,{port:f.port,resourceId:f.draft.resourceId,motion:m.motion,viewId:'model-selection',models});await chat.ready;
  const trigger=f.view.root.querySelector('[data-cp-picker-for="Conversation model"]');
  const editor=f.view.root.querySelector('textarea');
  assert.equal(refreshes,0);
  trigger.fire('click');
  assert.equal(trigger.getAttribute('aria-expanded'),'true');
  f.view.root.querySelector('[data-cp-option-value="refresh"]').fire('click');
  await until(()=>!!f.view.root.querySelector('[data-cp-option-value="model:account-model-slug"]'));
  trigger.fire('click');
  const row=f.view.root.querySelector('[data-cp-option-value="model:account-model-slug"]');
  assert.match(row.textContent,/Account model display name/);
  row.fire('click');
  assert.equal(models.selections.get(f.draft.resourceId)?.id,choice.id);
  assert.equal(f.view.root.querySelector('textarea'),editor);
  assert.equal(f.calls.some(call=>call.name==='send'||call.name==='selectProvider'),false);
  f.view.root.querySelector('form').fire('submit');
  await until(()=>!!f.pending);
  assert.equal(f.pending?.input.model,choice.id);
  assert.equal(f.detail.conversation.providerId,'chatgpt-plan-responses');
  f.accept(true);
  assert.equal(refreshes,1);
 }finally{await chat?.dispose();f.restore();}
});

test('the mounted chat submits an explicit web lookup and opens only canonical citation references',async()=>{
 const f=fixture('chatgpt-plan-responses');let chat;
 try{
  f.detail.providers[0].modelOptions=[{id:'ordinary-only',label:'Synthetic text-only model'},{id:'gpt-6.1-sol',label:'Synthetic Sol catalog entry',eligibleTools:['web_search']}];
  const message=f.detail.messages.items[1];
  message.webSearch={completed:true,citations:[{url:'https://science.example.org/moon',title:'Moon facts',start:0,end:1},{url:'https://science.example.org/second',title:'Second source',start:1,end:message.content.length-1}]};
  const port={command:async(name:string,input:any)=>name==='openCitation'?(f.calls.push({name,input}),{requested:true}):(f.port.command as any)(name,input)} as ConversationProductPort;
  const selections=new Map([[f.draft.resourceId,{id:'ordinary-only',label:'Synthetic text-only model'}]]);
  chat=mountConversationChat(f.view.root,{port,resourceId:f.draft.resourceId,models:{selections,async refresh(){}}});await chat.ready;
  const form=f.view.root.querySelector('form'),web=named(form,'Search web'),refs=f.view.root.querySelectorAll('.cp-web-citation');
  assert.equal(web.hidden,true,'An explicitly selected model must be respected');
  selections.clear();await chat.refresh();
  assert(web && !web.hidden && !web.disabled);
  assert.equal(refs.length,2);
  assert.equal(refs[0].parentNode?.tagName,'P','ordinary annotated text has an inline source');
  assert.equal(refs[1].textContent,'2','fenced code keeps its source outside the code');
  assert.equal(f.view.root.querySelector('.cp-code').querySelector('code').textContent,'const answer = 42;');
  refs[0].fire('click');
  assert.deepEqual(f.calls.find(call=>call.name==='openCitation')?.input,{resourceId:f.draft.resourceId,messageId:message.id,index:0});
  form.fire('submit',{submitter:web});
  await until(()=>!!f.pending);
  assert.equal(f.pending?.input.webSearch,true);
  assert.equal(f.pending?.input.model,'gpt-6.1-sol');
  f.pending?.resolve({id:'execution:search-failed',resourceId:f.draft.resourceId,providerId:'chatgpt-plan-responses',commandId:f.pending?.input.commandId,state:'failed',errorCode:'subscription_sharing_unsupported_capability'});
  await until(()=>f.view.root.querySelector('.cp-chat-status').textContent.includes('could not use web search'));
  assert.equal(f.view.root.querySelector('textarea').value,f.draft.content);
  assert.equal(f.calls.filter(call=>call.name==='send').length,1);
 }finally{await chat?.dispose();f.restore();}
});

test('thinking is bound to the observed model and applies only to the next submitted message', async () => {
 const f = fixture('chatgpt-plan-responses'), motion = pickerMotion();
 f.detail.providers[0].modelOptions = [{ id: 'gpt-6.1-sol', label: 'Synthetic Sol', reasoningEfforts: ['low', 'high'] }];
 let chat;
 try {
  chat = mountConversationChat(f.view.root, { port: f.port, resourceId: f.draft.resourceId,
   motion: motion.motion, viewId: 'thinking-selection', models: { selections: new Map(), async refresh() {} } });
  await chat.ready;
  const trigger = f.view.root.querySelector('[data-cp-picker-for="Thinking for next message"]');
  const editor = f.view.root.querySelector('textarea'), form = f.view.root.querySelector('form');
  trigger.fire('click');
  assert.equal(f.view.root.querySelector('[data-cp-option-value="max"]'), null);
  f.view.root.querySelector('[data-cp-option-value="high"]').fire('click');
  assert.match(trigger.textContent, /High/);
  assert.equal(f.calls.some(call => call.name === 'selectProvider' || call.name === 'send'), false);
  form.fire('submit');
  await until(() => !!f.pending);
  assert.equal(f.pending?.input.model, 'gpt-6.1-sol');
  assert.equal(f.pending?.input.reasoningEffort, 'high');
  f.accept(true);
  await chat.whenSubmissionSettled();
  assert.match(trigger.textContent, /Default thinking/);
  assert.equal(f.view.root.querySelector('textarea'), editor);
  editor.value = 'Synthetic second message';
  editor.fire('input');
  form.fire('submit');
  await until(() => !!f.pending);
  assert.equal(Object.hasOwn(f.pending?.input, 'reasoningEffort'), false);
  assert.equal(Object.hasOwn(f.pending?.input, 'model'), false);
  f.accept(true);
  await chat.whenSubmissionSettled();
 } finally { await chat?.dispose(); f.restore(); }
});

test('an undocumented catalog model offers no tool and a stale thinking choice cannot silently send', async () => {
 const f = fixture('chatgpt-plan-responses'), motion = pickerMotion();
 f.detail.providers[0].modelOptions = [{ id: 'gpt-6.1-sol', label: 'Synthetic Sol', reasoningEfforts: ['low'], eligibleTools: ['web_search'] }];
 let chat;
 try {
  chat = mountConversationChat(f.view.root, { port: f.port, resourceId: f.draft.resourceId,
   motion: motion.motion, viewId: 'thinking-stale', models: { selections: new Map(), async refresh() {} } });
  await chat.ready;
  const trigger = f.view.root.querySelector('[data-cp-picker-for="Thinking for next message"]');
  const form = f.view.root.querySelector('form'), web = named(form, 'Search web');
  assert.equal(web.hidden, false);
  trigger.fire('click');
  f.view.root.querySelector('[data-cp-option-value="low"]').fire('click');
  f.detail.providers[0].modelOptions = [{ id: 'gpt-6.1-sol-undocumented', label: 'Synthetic other model' }];
  await chat.refresh();
  assert.equal(web.hidden, true);
  form.fire('submit', { submitter: web });
  form.fire('submit');
  assert.equal(f.calls.some(call => call.name === 'send'), false);
  assert.match(f.view.root.querySelector('.cp-chat-status').textContent, /thinking level is unavailable/);
  assert.equal(f.view.root.querySelector('textarea').value, f.draft.content);
  trigger.fire('click');
  f.view.root.querySelector('[data-cp-option-value="default"]').fire('click');
  form.fire('submit');
  await until(() => !!f.pending);
  assert.equal(Object.hasOwn(f.pending?.input, 'reasoningEffort'), false);
  assert.equal(Object.hasOwn(f.pending?.input, 'webSearch'), false);
  f.accept(true);
  await chat.whenSubmissionSettled();
 } finally { await chat?.dispose(); f.restore(); }
});

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
  const f=fixture();let chat,target:Element|null=null,resize:ResizeObserverCallback|undefined,disconnected=false,layoutActive=true,hostMoving=false,id=0;const previous=globalThis.ResizeObserver,priorFrame=globalThis.requestAnimationFrame,priorCancel=globalThis.cancelAnimationFrame,frames=new Map<number,FrameRequestCallback>();f.view.root.clientWidth=400;f.view.root.style.height='600px';
  class MeasuredResizeObserver {constructor(callback:ResizeObserverCallback){resize=callback;}observe(node:Element){target=node;}disconnect(){disconnected=true;}unobserve(){}}
  globalThis.ResizeObserver=MeasuredResizeObserver as unknown as typeof ResizeObserver;globalThis.requestAnimationFrame=callback=>{frames.set(++id,callback);return id;};globalThis.cancelAnimationFrame=key=>{frames.delete(key);};
  const deliver=(height:number,width=400)=>resize!([{target,contentRect:{height,width}} as unknown as ResizeObserverEntry],{} as ResizeObserver),frame=()=>{const entry=frames.entries().next().value;assert.ok(entry);frames.delete(entry[0]);entry[1](0);};
  try{chat=mountConversationChat(f.view.root,{port:f.port,resourceId:f.draft.resourceId,layoutHost:f.view.root,layoutActive:()=>layoutActive,deferHostResize:()=>hostMoving});await chat.ready;const root=f.view.root.querySelector('.cp-chat'),editor=root.querySelector('textarea'),composer=root.querySelector('.cp-composer');editor.focus();editor.setSelectionRange(3,9);assert.equal(target,f.view.root);assert.notEqual(target,root,'The auto-sized chat is never its own observer target');Object.defineProperty(root,'clientHeight',{get(){throw new Error('Self-dependent chat height must never be read');}});
    let writes=0;editor.style=new Proxy(editor.style,{set(object,key,value){writes++;object[key]=value;return true;}});deliver(180);deliver(180);deliver(190);assert.equal(writes,0,'ResizeObserver delivery does not write layout');assert.equal(frames.size,1,'Changed bounds coalesce into one reconciliation');frame();assert.ok(root.className.split(' ').includes('cp-chat-compact'));assert.equal(editor.rows,1);assert.ok(parseFloat(editor.style.height)<=48);assert.ok(root.children.at(-1)===composer,'Composer remains the final stable child');assert.ok(root.querySelector('.cp-chat-feedback').contains(root.querySelector('.cp-chat-status')),'Status remains in the compact feedback summary');assert.ok(root.querySelector('.cp-messages').contains(root.querySelector('.cp-draft-recovery')),'Recovery uses the one transcript scroll owner');
    writes=0;deliver(190);chat.setPresentation('focused');assert.equal(frames.size,0);assert.equal(writes,0,'Unchanged frames do not reset auto height or write its final value');
    layoutActive=false;
    deliver(520);
    deliver(580);
    chat.frame();
    assert.equal(frames.size,0,'Retained previews do not schedule layout work');
    assert.equal(writes,0);
    layoutActive=true;
    chat.frame();
    assert.equal(frames.size,1,'Working presentation reconciles the latest deferred bounds once');
    frame();
    assert.equal(root.className.split(' ').includes('cp-chat-compact'),false);assert.equal(editor.rows,2);assert.equal(root.querySelector('textarea'),editor);assert.deepEqual([editor.selectionStart,editor.selectionEnd],[3,9]);assert.equal(editor.value,'Saved unsent text');assert.equal(f.draft.content,editor.value);
    deliver(500);
    hostMoving=true;
    frame();
    deliver(380);
    deliver(225);
    chat.frame();
    assert.equal(frames.size,0,'A queued resize defers once host motion starts');
    assert.equal(editor.rows,2);
    hostMoving=false;
    chat.frame();
    assert.equal(frames.size,1);
    frame();
    assert.equal(editor.rows,1,'The latest measured host size takes effect after motion settles');
    assert.deepEqual([editor.selectionStart,editor.selectionEnd],[3,9]);
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
    const results=f.view.root.querySelector('.cp-results'),selected=results.querySelector('[data-resource-id="chat:synthetic"]');assert.equal(selected.getAttribute('aria-current'),'true');assert.equal(selected.querySelector('.cp-result-title').textContent,f.detail.conversation.title);assert.equal(selected.querySelector('.cp-result-excerpt'),null,'Empty browse is a bodyless conversation row');assert.equal(results.querySelector('[data-resource-id="note:canonical"]'),null,'Non-chat resources require an explicit search scope or collection');assert.equal(named(f.view.root,'Previous results').disabled,true);assert.equal(named(f.view.root,'More results').disabled,false);
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

test('presentation reflow keeps the visible message and yields to transcript scrolling', async () => {
  const f = fixture();
  let chat;
  try {
    chat = mountConversationChat(f.view.root, {
      port: f.port, resourceId: f.draft.resourceId, presentation: 'workspace',
    });
    await chat.ready;
    const root = f.view.root.querySelector('.cp-chat');
    const messages = root.querySelector('.cp-messages');
    const content = messages.querySelector('.cp-message-content');
    messages.clientHeight = messages.offsetHeight = 100;
    messages.scrollHeight = 500;
    messages.getBoundingClientRect = () => ({ top: 0, bottom: 100, height: 100 });
    let contentTop = 180;
    content.getBoundingClientRect = () => ({
      top: contentTop - messages.scrollTop, bottom: contentTop - messages.scrollTop + 60, height: 60,
    });
    messages.scrollTop = 165;
    chat.setPresentation('focused', { captureOnly: true });
    assert.equal(root.dataset.presentation, 'workspace');
    contentTop = 80;
    chat.setPresentation('focused');
    assert.equal(messages.scrollTop, 65);
    contentTop = 112;
    chat.setPresentation('focused');
    assert.equal(messages.scrollTop, 97);
    messages.fire('wheel');
    messages.scrollTop = 45;
    contentTop = 125;
    chat.setPresentation('focused');
    assert.equal(messages.scrollTop, 45);
    assert.ok(f.calls.every(call => ['readDraft', 'detail'].includes(call.name)));
  } finally {
    await chat?.dispose();
    f.restore();
  }
});

test('short workspace follows canonical text above its in-flow action footer, preserves reading/around targets and never scrolls its page',async()=>{
  const f=fixture();let chat,around=0;const copies:string[]=[];f.detail.messages.items=f.detail.messages.items.filter(message=>message.role==='user');f.detail.messages.total=f.detail.conversation.messageCount=1;
  const geometry=()=>{const messages=f.view.root.querySelector('.cp-messages'),content=messages.querySelector('.cp-message-content'),article=messages.querySelector('.cp-message');messages.clientHeight=messages.offsetHeight=50;messages.scrollHeight=164;messages.getBoundingClientRect=()=>({top:200,bottom:250,height:50});content.getBoundingClientRect=()=>({top:140-(messages.scrollTop-96),bottom:210-(messages.scrollTop-96),height:70});article.scrollIntoView=()=>{around++;};};
  try{f.view.root.scrollTop=71;chat=mountConversationChat(f.view.root,{port:f.port,resourceId:f.draft.resourceId,presentation:'workspace',onDetail:geometry,copy:async text=>{copies.push(text);}});await chat.ready;const messages=f.view.root.querySelector('.cp-messages'),editor=f.view.root.querySelector('textarea');assert.equal(messages.scrollTop,56,'Content end, not the 64px trailing action/footer region, is followed');const lastLine={top:176-(messages.scrollTop-96),bottom:198-(messages.scrollTop-96)};assert.ok(lastLine.top>=200&&lastLine.bottom<=250,'The complete modelled text line is inside the real scroller bounds');assert.equal(around,0);assert.equal(f.view.root.scrollTop,71);
    editor.focus();editor.setSelectionRange(2,6);messages.scrollTop=10;await chat.refresh();assert.equal(messages.scrollTop,10,'A reader above the follow region retains their position');assert.equal(f.view.root.querySelector('textarea'),editor);assert.equal(f.view.doc.activeElement,editor);assert.deepEqual([editor.selectionStart,editor.selectionEnd],[2,6]);await chat.refresh({aroundMessageId:'message:user'});assert.equal(around,1,'Explicit source navigation retains its existing around-message path');assert.equal(messages.scrollTop,10);
    const actions=f.view.root.querySelector('.cp-message-actions');actions.open=true;actions.fire('toggle');named(actions,'Copy').fire('click');await until(()=>copies.length===1);assert.equal(copies[0],f.detail.messages.items[0].content);assert.equal(f.view.root.scrollTop,71);assert.ok(f.calls.every(call=>['readDraft','detail'].includes(call.name)));
  }finally{await chat?.dispose();f.restore();}
});

test('workspace content following accounts for a scaled scroller and respects an explicit restored scroll offset',async()=>{
  const f=fixture();let chat;f.detail.messages.items=f.detail.messages.items.filter(message=>message.role==='user');f.detail.messages.total=f.detail.conversation.messageCount=1;
  const geometry=()=>{const messages=f.view.root.querySelector('.cp-messages'),content=messages.querySelector('.cp-message-content');messages.clientHeight=messages.offsetHeight=50;messages.scrollHeight=164;messages.getBoundingClientRect=()=>({top:200,bottom:225,height:25});content.getBoundingClientRect=()=>({top:170-(messages.scrollTop-96)*.5,bottom:205-(messages.scrollTop-96)*.5,height:35});};
  try{chat=mountConversationChat(f.view.root,{port:f.port,resourceId:f.draft.resourceId,presentation:'workspace',onDetail:geometry});await chat.ready;assert.equal(f.view.root.querySelector('.cp-messages').scrollTop,56);await chat.dispose();chat=mountConversationChat(f.view.root,{port:f.port,resourceId:f.draft.resourceId,presentation:'workspace',initialScroll:12,onDetail:geometry});await chat.ready;assert.equal(f.view.root.querySelector('.cp-messages').scrollTop,12);}
  finally{await chat?.dispose();f.restore();}
});

test('explicit accepted Send follows its new canonical user message from a restored reading position; input and background/unknown refresh do not',async()=>{
  for(const providerId of ['local','codex:native']){const f=fixture(providerId);let chat;f.detail.messages.items=f.detail.messages.items.filter(message=>message.role==='user');f.detail.messages.total=f.detail.conversation.messageCount=1;
    const geometry=()=>{const messages=f.view.root.querySelector('.cp-messages');messages.clientHeight=messages.offsetHeight=68;messages.scrollHeight=f.detail.messages.items.length===1?164:317;messages.getBoundingClientRect=()=>({top:200,bottom:268,height:68});for(const [index,content]of messages.querySelectorAll('.cp-message-content').entries()){const bottom=index?454:290;content.getBoundingClientRect=()=>({top:bottom-70-messages.scrollTop,bottom:bottom-messages.scrollTop,height:70});}};
    try{chat=mountConversationChat(f.view.root,{port:f.port,resourceId:f.draft.resourceId,presentation:'workspace',initialScroll:0,onDetail:geometry});await chat.ready;const messages=f.view.root.querySelector('.cp-messages'),editor=f.view.root.querySelector('textarea'),form=f.view.root.querySelector('.cp-composer');await chat.refresh();assert.equal(messages.scrollTop,0,'Ordinary refresh preserves restored reading above the physical tail');form.fire('submit');await until(()=>!!f.pending);editor.value='Exact later draft after explicit Send';editor.setSelectionRange(5,5);editor.fire('input');assert.equal(messages.scrollTop,0,'Typing alone never forces a new follow');f.accept(providerId!=='local');await chat.whenSubmissionSettled();
      const message=f.detail.messages.items.at(-1)!;assert.equal(messages.scrollTop,186);assert.ok(f.calls.some(call=>call.name==='detail'&&call.input.aroundMessageId===message.id),'The followed page is bound to the actual newly authored message ID');assert.ok(420-messages.scrollTop>=200&&442-messages.scrollTop<=268,'The modelled new user text line is complete in the viewport');assert.equal(editor.value,'Exact later draft after explicit Send');assert.equal(f.view.root.querySelector('textarea'),editor);assert.deepEqual([editor.selectionStart,editor.selectionEnd],[5,5]);
      messages.scrollTop=0;await chat.refresh();assert.equal(messages.scrollTop,0);form.fire('submit');await until(()=>!!f.pending);f.pending!.resolve({id:'execution:unknown',resourceId:f.draft.resourceId,state:'unknown'});await chat.whenSubmissionSettled();assert.equal(messages.scrollTop,0,'An unknown outcome never forces acknowledged-message follow');assert.equal(f.calls.filter(call=>call.name==='send').length,2);
    }finally{f.pending?.reject(new Error('synthetic cleanup'));await chat?.whenSubmissionSettled();await chat?.dispose();f.restore();}
  }
});

test('undefined-scroll initial follow waits for measurable geometry without a loop; explicit offsets and deliberate reading override it',async()=>{
  for(const mode of ['initial','restored','reader']as const){const f=fixture();let chat,visible=false;f.detail.messages.items=f.detail.messages.items.filter(message=>message.role==='user');f.detail.messages.total=f.detail.conversation.messageCount=1;
    const geometry=()=>{const messages=f.view.root.querySelector('.cp-messages'),content=messages.querySelector('.cp-message-content');messages.scrollHeight=164;messages.offsetHeight=50;Object.defineProperty(messages,'clientHeight',{configurable:true,get:()=>visible?50:0});messages.getBoundingClientRect=()=>({top:200,bottom:visible?250:200,height:visible?50:0});content.getBoundingClientRect=()=>({top:visible?236-messages.scrollTop:0,bottom:visible?306-messages.scrollTop:0,height:visible?70:0});};
    try{chat=mountConversationChat(f.view.root,{port:f.port,resourceId:f.draft.resourceId,presentation:'workspace',...(mode==='restored'?{initialScroll:12}:{}),onDetail:geometry});await chat.ready;const messages=f.view.root.querySelector('.cp-messages');assert.equal(messages.scrollTop,mode==='restored'?12:0);if(mode==='reader')messages.fire('wheel');visible=true;chat.setPresentation('workspace');assert.equal(messages.scrollTop,mode==='initial'?56:mode==='restored'?12:0);assert.ok(f.calls.every(call=>['readDraft','detail'].includes(call.name)),'Geometry reconciliation creates no read retry, mutation or provider work');}
    finally{await chat?.dispose();f.restore();}
  }
});

test('an acknowledged Send retains its exact follow target while geometry is zero and applies it on the next existing host reconciliation',async()=>{
  const f=fixture();let chat,visible=true;f.detail.messages.items=f.detail.messages.items.filter(message=>message.role==='user');f.detail.messages.total=f.detail.conversation.messageCount=1;
  const geometry=()=>{const messages=f.view.root.querySelector('.cp-messages');messages.scrollHeight=f.detail.messages.items.length===1?164:317;messages.offsetHeight=68;Object.defineProperty(messages,'clientHeight',{configurable:true,get:()=>visible?68:0});messages.getBoundingClientRect=()=>({top:200,bottom:visible?268:200,height:visible?68:0});for(const [index,content]of messages.querySelectorAll('.cp-message-content').entries()){const bottom=index?454:290;content.getBoundingClientRect=()=>({top:visible?bottom-70-messages.scrollTop:0,bottom:visible?bottom-messages.scrollTop:0,height:visible?70:0});}};
  try{chat=mountConversationChat(f.view.root,{port:f.port,resourceId:f.draft.resourceId,presentation:'workspace',initialScroll:0,onDetail:geometry});await chat.ready;f.view.root.querySelector('.cp-composer').fire('submit');await until(()=>!!f.pending);visible=false;f.accept();await chat.whenSubmissionSettled();const messages=f.view.root.querySelector('.cp-messages');assert.equal(messages.scrollTop,0);visible=true;chat.setPresentation('workspace');assert.equal(messages.scrollTop,186);assert.equal(f.calls.filter(call=>call.name==='send').length,1);}
  finally{f.pending?.reject(new Error('synthetic cleanup'));await chat?.whenSubmissionSettled();await chat?.dispose();f.restore();}
});

test('filter and clear-search changes made during an existing read drain to the latest actual query without replaying actions',async()=>{
  const f=fixture();let manager,release!:()=>void;
  try{manager=mountConversationManager(f.view.root,f.port,{resourceId:f.draft.resourceId});await manager.ready;const priorDetails=f.calls.filter(call=>call.name==='detail').length;f.gateDetail(new Promise<void>(resolve=>{release=resolve;}));const reading=manager.refresh();await until(()=>f.calls.filter(call=>call.name==='detail').length>priorDetails);
    const filters=f.view.root.querySelector('.cp-filters'),favorite=filters.querySelector('input'),search=f.view.root.querySelector('input[aria-label="Search conversation history"]');favorite.checked=true;favorite.fire('change');search.value='A pending search';search.fire('input');named(f.view.root,'Clear history search').fire('click');release();f.gateDetail(null);await reading;await until(()=>f.view.root.querySelector('.cp-manager').getAttribute('aria-busy')===null);
    const final=f.calls.filter(call=>call.name==='list'||call.name==='search').at(-1)!;assert.equal(final.input.favorite,true);assert.equal(final.input.text,'');assert.equal(final.input.offset,0);assert.equal(f.calls.some(call=>['send','organize','favorite'].includes(call.name)),false);assert.equal(f.draft.content,'Saved unsent text');
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
    assert.deepEqual(f.calls.filter(call=>call.name==='search').at(-1)!.input,{collectionId:'collection:canonical',offset:0,limit:50,searchMode:'all'});assert.ok(f.calls.every(call=>['readDraft','saveDraft','detail','collections','providers','projects','list','search'].includes(call.name)));
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

test('Save reply as note sends exact IDs, recovers the same command and preserves the draft',async()=>{
 const f=fixture(),attempts:unknown[]=[],opened:string[]=[];
 let chat,complete!:(receipt:{noteId:string})=>void,reject!:(error:Error)=>void;
 try{
  chat=mountConversationChat(f.view.root,{port:f.port,resourceId:f.draft.resourceId,
   async saveReplyNote(input){attempts.push(input);return new Promise((resolve,fail)=>{complete=resolve;reject=fail;});},
   openReplyNote(id){opened.push(id);},
  });
  await chat.ready;
  const user=f.view.root.querySelector('.cp-message-user'),assistant=f.view.root.querySelector('.cp-message-assistant');
  assert.equal(!!named(user,'Save reply as note'),false);
  const save=named(assistant,'Save reply as note');
  assert.ok(save);
  save.fire('click');save.fire('click');
  assert.equal(attempts.length,1);
  const request=attempts[0] as Record<string,string>;
  assert.deepEqual(Object.keys(request).sort(),['commandId','messageId','resourceId']);
  assert.equal(request.resourceId,f.draft.resourceId);
  assert.equal(request.messageId,'message:assistant');
  reject(Error('connection lost'));
  await until(()=>!save.disabled);
  save.fire('click');
  assert.deepEqual(attempts,[request,request]);
  f.detail.messages.items[1].outputState='complete';
  await chat.refresh();
  const refreshed=f.view.root.querySelector('.cp-message-assistant');
  assert.equal(named(refreshed,'Saving reply…').disabled,true);
  complete({noteId:'note:saved'});
  await until(()=>!!named(refreshed,'Open saved note'));
  named(refreshed,'Open saved note').fire('click');
  assert.deepEqual(opened,['note:saved']);
  assert.equal(f.draft.content,'Saved unsent text');
 }finally{await chat?.dispose();f.restore();}
});
