import test from 'node:test';
import assert from 'node:assert/strict';
import { ConversationGraph, type Conversation, type GraphData, type LineageEdge, type Message } from '../src/graph.ts';
import { mockAdapters, mockOrdinaryAdapter } from '../src/adapters.ts';

type Internal={data:GraphData;conversation(id:string):Conversation;message(id:string):Message;conversationsById:Map<string,Conversation>;messagesById:Map<string,Message>;parentsByChildId:Map<string,LineageEdge>};
const internal=(graph:ConversationGraph)=>graph as unknown as Internal;
const options={limit:256,maxScan:4096,maxBodyBytes:131072};

test('ID indices retain exact canonical objects across append, fork, revocation and copied outputs',()=>{
 const graph=new ConversationGraph(mockAdapters()),root=graph.createChat('ordinary','mock-ordinary','Synthetic canonical root'),a=graph.addMessage(root.id,'user','Synthetic origin'),b=graph.addMessage(root.id,'user','Synthetic boundary');
 const child=graph.branch({sourceConversationId:root.id,sourceMessageId:b.id,targetKind:'ordinary',targetProviderId:'mock-ordinary',title:'Synthetic child',includeMessageIds:[a.id,b.id]}),own=graph.addMessage(child.conversation.id,'user','Synthetic independent child'),late=graph.addMessage(root.id,'user','Synthetic parent future'),i=internal(graph);
 for(const c of i.data.conversations)assert.equal(i.conversation(c.id),c);
 for(const m of i.data.messages)assert.equal(i.message(m.id),m);
 assert.equal(i.parentsByChildId.get(child.conversation.id),i.data.edges[0]);
 assert.deepEqual(graph.visibleMessages(child.conversation.id).map(m=>m.id),[a.id,b.id,own.id]);assert(!graph.visibleMessages(child.conversation.id).some(m=>m.id===late.id));
 const handoff=graph.inspectHandoff(child.handoff.id);assert.deepEqual(handoff.items.map(m=>[m.sourceMessageId,m.content]),[[a.id,a.content],[b.id,b.content]]);
 graph.markUnavailable(a.id);assert.deepEqual(graph.inspectHandoff(child.handoff.id).staleMessageIds,[a.id]);assert.equal(i.message(a.id),i.data.messages[0]);
 const output=graph.visibleMessages(child.conversation.id);output[0].content='Caller output mutation';root.title='Caller conversation mutation';const snapshot=graph.snapshot();snapshot.messages[0].id='Caller identity mutation';
 assert.equal(i.message(a.id).content,a.content);assert.equal(i.conversation(root.id).title,'Synthetic canonical root');assert.equal(i.messagesById.has('Caller identity mutation'),false);
});

test('successful validate and constructor/import rebuild indices to current canonical references',()=>{
 const graph=new ConversationGraph(mockAdapters()),root=graph.createChat('ordinary','mock-ordinary','Synthetic original'),message=graph.addMessage(root.id,'user','Synthetic original body'),i=internal(graph),old=i.message(message.id);
 i.data.messages[0]={...old,content:'Synthetic changed body'};i.data.conversations[0]={...i.data.conversations[0],title:'Synthetic changed title'};graph.validate();
 assert.equal(i.message(message.id),i.data.messages[0]);assert.notEqual(i.message(message.id),old);assert.equal(i.conversation(root.id),i.data.conversations[0]);assert.equal(graph.visibleMessages(root.id)[0].content,'Synthetic changed body');
 const saved=graph.snapshot(),direct=new ConversationGraph(mockAdapters(),saved),restored=ConversationGraph.importJson(graph.exportJson(),mockAdapters()),r=internal(restored);
 assert.deepEqual(direct.snapshot(),saved);assert.deepEqual(restored.snapshot(),JSON.parse(JSON.stringify(saved)),'JSON round-trip retains existing omission of undefined fields');assert.equal(r.message(message.id),r.data.messages[0]);assert.notEqual(r.message(message.id),i.message(message.id));assert.notEqual(r.message(message.id),saved.messages[0]);
 restored.addMessage(root.id,'user','Synthetic after recovery');assert.equal(r.messagesById.size,r.data.messages.length);assert.equal(graph.visibleMessages(root.id).length,1);
});

test('existing duplicate import rejection and low-counter append first-match behavior remain unchanged',()=>{
 const initial=new ConversationGraph(mockAdapters()),root=initial.createChat('ordinary','mock-ordinary','Synthetic first'),first=initial.addMessage(root.id,'user','Synthetic first message'),data=initial.snapshot();
 const duplicate=structuredClone(data);duplicate.messages.push({...duplicate.messages[0]});assert.throws(()=>new ConversationGraph(mockAdapters(),duplicate),/duplicate identity/);
 data.counter=0;const graph=new ConversationGraph(mockAdapters(),data),second=graph.createChat('ordinary','mock-ordinary','Synthetic duplicate generated ID');assert.equal(second.id,root.id);
 graph.renameConversation(root.id,'Synthetic renamed first');assert.equal(graph.snapshot().conversations[1].title,second.title);
 const collision=graph.addMessage(root.id,'user','Synthetic second generated message',{key:'synthetic-collision'});assert.equal(collision.id,first.id);assert.equal(collision.sequence,2);
 assert.deepEqual(graph.visibleMessages(root.id).map(m=>m.content),[first.content,first.content]);assert.equal(graph.addMessage(root.id,'user','Retry is ignored',{key:'synthetic-collision'}).content,first.content);
 assert.equal(internal(graph).message(first.id),internal(graph).data.messages[0]);assert.throws(()=>graph.validate(),/duplicate identity/);
 const lineage=new ConversationGraph(mockAdapters()),parent=lineage.createChat('ordinary','mock-ordinary','Synthetic first parent'),a=lineage.addMessage(parent.id,'user','Synthetic first boundary'),child=lineage.branch({sourceConversationId:parent.id,sourceMessageId:a.id,targetKind:'ordinary',targetProviderId:'mock-ordinary',title:'Synthetic first child'}),later=lineage.addMessage(parent.id,'user','Synthetic later boundary'),colliding=lineage.snapshot();colliding.counter=3;
 const imported=new ConversationGraph(mockAdapters(),colliding),again=imported.branch({sourceConversationId:parent.id,sourceMessageId:later.id,targetKind:'ordinary',targetProviderId:'mock-ordinary',title:'Synthetic duplicate child ID'});assert.equal(again.conversation.id,child.conversation.id);assert.equal(internal(imported).parentsByChildId.get(child.conversation.id),internal(imported).data.edges[0]);assert.deepEqual(imported.visibleMessages(child.conversation.id).map(m=>m.id),[a.id]);
});

test('untyped non-reflexive imported IDs retain strict-equality missing lookup semantics without new validation',()=>{
 const initial=new ConversationGraph(mockAdapters()),root=initial.createChat('ordinary','mock-ordinary','Synthetic untyped ID'),data=initial.snapshot(),nan=Number.NaN as unknown as string;
 data.conversations[0].id=nan;const graph=new ConversationGraph(mockAdapters(),data);assert.throws(()=>graph.renameConversation(nan,'Still unresolved'),/conversation missing: NaN/);
 const source=initial.addMessage(root.id,'user','Synthetic untyped message'),messages=initial.snapshot();messages.messages[0].id=nan;messages.conversations[0].ownMessageIds=[nan];
 const messageGraph=new ConversationGraph(mockAdapters(),messages);assert.throws(()=>messageGraph.visibleMessages(root.id),/message missing: NaN/);assert.throws(()=>messageGraph.markUnavailable(nan),/message missing: NaN/);assert.equal(source.sequence,1);
});

test('mutable mock adapter canonical fields refresh shallow indices even when respond throws',()=>{
 const adapter=mockOrdinaryAdapter();let graph:ConversationGraph,originalId:string,changedId:string;
 adapter.respond=conversation=>{conversation.id=changedId;throw Error('Synthetic adapter failure after identity mutation');};
 graph=new ConversationGraph([adapter]);const root=graph.createChat('ordinary',adapter.snapshot.id,'Synthetic adapter state');originalId=root.id;changedId='synthetic-mutated-canonical-id';
 assert.throws(()=>graph.runMock(originalId,'Synthetic request'),/Synthetic adapter failure/);assert.throws(()=>graph.renameConversation(originalId,'Old key'),/conversation missing/);
 assert.equal(graph.renameConversation(changedId,'Synthetic current key').id,changedId);assert.equal(internal(graph).conversation(changedId),internal(graph).data.conversations[0]);assert.equal(graph.visibleMessages(changedId)[0].content,'Synthetic request');
});

test('indexed metadata preserves callback order, current revocation and denial before any body access',()=>{
 const graph=new ConversationGraph(mockAdapters()),root=graph.createChat('ordinary','mock-ordinary','Synthetic policy source'),a=graph.addMessage(root.id,'user','Synthetic first'),b=graph.addMessage(root.id,'user','Synthetic second'),child=graph.branch({sourceConversationId:root.id,sourceMessageId:b.id,targetKind:'ordinary',targetProviderId:'mock-ordinary',title:'Synthetic policy child'});graph.addMessage(child.conversation.id,'user','Synthetic own child');
 let bodyReads=0;for(const message of internal(graph).data.messages){const value=message.content;Object.defineProperty(message,'content',{configurable:true,enumerable:true,get(){bodyReads++;throw Error('Denied body must never be read: '+value);}});}
 const seen:string[]=[];const denied=graph.visibleMessageMetadata(child.conversation.id,{...options,allow:meta=>{seen.push(meta.id);if(meta.id===a.id)graph.markUnavailable(b.id);return !meta.unavailable;}});
 assert.deepEqual(seen,[a.id,b.id]);assert.deepEqual(denied,{items:[],emittedCount:0,emittedBodyBytes:0,hasMore:false,limitedBy:'denied'});assert.equal(bodyReads,0);
});
