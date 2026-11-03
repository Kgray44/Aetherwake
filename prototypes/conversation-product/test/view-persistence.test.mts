import test from 'node:test';
import assert from 'node:assert/strict';
import {ConversationViewPersistence,type ConversationViewCapture} from '../src/view-persistence.ts';
import type {ConversationProductPort,ConversationView,ConversationViewSelected} from '../src/contracts.ts';
import {until} from './component-dom.mts';

const time='2026-11-03T00:00:00Z';
const virgin=(resourceId:string):ConversationView=>({resourceId,version:0,position:null,selection:null,positionStatus:'none',selectionStatus:'none',updatedAt:null});
const capture=(offsetY:number,resourceId='chat:one'):ConversationViewCapture=>({resourceId,position:{conversationRevision:2,anchor:{messageId:'message:one',offsetY}},selection:{draftVersion:3,start:1,end:3,direction:'backward'},draftReady:true});
function fixture(){
 const records=new Map<string,ConversationView>(),calls:{name:string;input:any}[]=[],denied=new Set<string>();let selected:ConversationViewSelected={resourceId:null,version:0,updatedAt:null};let before:((name:string,input:any)=>Promise<void>|void)|undefined;
 const port={async command(name:string,input:any){calls.push({name,input:structuredClone(input)});await before?.(name,input);if(name==='readViewState'){const current=selected.resourceId&&denied.has(selected.resourceId)?{...selected,resourceId:null,updatedAt:null}:selected,id=input.resourceId??current.resourceId;if(id&&denied.has(id))throw Error('source_unavailable');return {contract:'aerynth.conversation-view@1',selected:structuredClone(current),view:id?structuredClone(records.get(id)??virgin(id)):null};}
  if(name==='saveViewState'){const old=records.get(input.resourceId)??virgin(input.resourceId);if(old.version!==input.expectedVersion)throw Error('stale_conversation_view_version');const next={...old,version:old.version+1,position:input.position,selection:input.selection,positionStatus:input.position?'current':'none',selectionStatus:input.selection?'current':'none',updatedAt:time} as ConversationView;records.set(input.resourceId,next);return structuredClone(next);}
  if(name==='selectView'){if(selected.version!==input.expectedVersion)throw Error('stale_conversation_view_selection_version');selected={version:selected.version+1,resourceId:input.resourceId,updatedAt:time};return structuredClone(selected);}throw Error('Unexpected command '+name);
 }} as ConversationProductPort;
 return {port,records,calls,denied,before(fn:typeof before){before=fn;},get selected(){return selected;}};
}

test('shared coordinator coalesces latest coherent caret/position, including a revert while a different save is in flight',async()=>{
 const f=fixture(),p=new ConversationViewPersistence({port:f.port});await p.restore('chat:one');p.remember({...capture(50),draftReady:false});await p.flush();assert.equal(f.calls.filter(c=>c.name==='saveViewState').length,0);
 p.remember(capture(10));await p.flush();let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);f.before((name,input)=>{if(name==='saveViewState'&&input.position.anchor.offsetY===20)return gate;});
 p.remember(capture(20));await until(()=>f.calls.filter(c=>c.name==='saveViewState').length===2);p.remember(capture(30));p.remember(capture(10));release();await p.flush();
 const writes=f.calls.filter(c=>c.name==='saveViewState');assert.deepEqual(writes.map(c=>[c.input.expectedVersion,c.input.position.anchor.offsetY]),[[0,10],[1,20],[2,10]]);assert.deepEqual(writes.map(c=>Object.keys(c.input).sort()),Array(3).fill(['expectedVersion','position','resourceId','selection']));assert.equal(f.records.get('chat:one')?.position?.anchor?.offsetY,10);assert.equal(f.selected.resourceId,null);
});

test('a stale writer cannot retry or replace a newer canonical view until a distinct later user capture',async()=>{
 const f=fixture(),errors:Error[]=[],a=new ConversationViewPersistence({port:f.port,onError:error=>errors.push(error)}),b=new ConversationViewPersistence({port:f.port});await a.restore('chat:one');b.remember(capture(18));await b.flush();
 a.remember(capture(22));await assert.rejects(a.flush(),/stale_conversation_view_version/);assert.equal(f.records.get('chat:one')?.position?.anchor?.offsetY,18);assert.equal(f.calls.filter(c=>c.name==='saveViewState').length,2);assert.equal(errors.length,1);assert.equal(f.calls.filter(c=>c.name==='readViewState').length,2);
 a.remember(capture(31));await a.flush();assert.equal(f.records.get('chat:one')?.position?.anchor?.offsetY,31);assert.equal(f.records.get('chat:one')?.version,2);assert.equal(f.calls.filter(c=>c.name==='readViewState').length,3);
});

test('newer explicit selection supersedes an older pending restore and current denial cannot reuse an old authorized payload',async()=>{
 const f=fixture(),p=new ConversationViewPersistence({port:f.port});let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);f.before(name=>{if(name==='readViewState')return gate;});
 const older=p.select('chat:one');await until(()=>f.calls.some(c=>c.name==='readViewState'));const newer=p.select('chat:two');release();await Promise.all([older,newer]);await p.flush();
 assert.deepEqual(f.calls.filter(c=>c.name==='selectView').map(c=>c.input),[{resourceId:'chat:two',expectedVersion:0}]);assert.equal((await p.restore()).selected.resourceId,'chat:two');f.denied.add('chat:two');const hidden=await p.restore();assert.equal(hidden.selected.resourceId,null);assert.equal(hidden.view,null);await assert.rejects(p.restore('chat:two'),/source_unavailable/);
});
