import test from 'node:test';import assert from 'node:assert/strict';
import {blockDocument} from './component-dom.mts';import {mountFolderExperience} from '../folder-view.ts';
import type {Resource} from '../../application-contract/contracts.ts';
const resource:Resource={id:'folder:one',kind:'folder',title:'Project docs',content:'',version:1,folder:{source:'folder',name:'Project docs',sourceRevision:'revision:one'}};
test('folder view is passive until opened, browses opaque IDs and never creates child source resources',async()=>{
 const {doc,root}=blockDocument(),calls:unknown[]=[],opened:unknown[]=[];
 const view=mountFolderExperience(root,resource,{list:async input=>{calls.push(input);return {resourceId:resource.id,entryId:input.entryId??null,name:input.entryId?'Design':'Project docs',entries:input.entryId?[]:[{id:'lease:design',name:'Design',kind:'folder',sourceRevision:'one'},{id:'lease:readme',name:'README.md',kind:'file',sourceRevision:'two'}],cursor:null,truncated:false,observedRevision:'listing:one',scope:'metadata-only'};},openExternal:async input=>{opened.push(input);}});
 const button=(name:string)=>root.querySelectorAll('button').find((node:{textContent:string})=>node.textContent===name)!;
 assert.equal(calls.length,0);button('Browse folder').fire('click');await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(calls,[{resourceId:resource.id}]);assert.equal(root.querySelectorAll('li').length,2);
 button('Design').fire('click');await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls[1],{resourceId:resource.id,entryId:'lease:design'});
 button('Open folder').fire('click');await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(opened,[{resourceId:resource.id,entryId:'lease:design'}]);
 view.update({...resource,available:false});assert.equal(root.querySelectorAll('li').length,0);view.dispose();
});
test('late folder metadata cannot reappear after its grant or source revision changes',async()=>{
 const {root}=blockDocument();let finish!:(value:unknown)=>void;
 const view=mountFolderExperience(root,resource,{list:()=>new Promise(resolve=>{finish=resolve as typeof finish;}),openExternal:async()=>{}});
 root.querySelectorAll('button').find((node:{textContent:string})=>node.textContent==='Browse folder')!.fire('click');
 view.update({...resource,available:false});finish({resourceId:resource.id,entryId:null,name:'Old private listing',entries:[{id:'old',name:'Old private file',kind:'file',sourceRevision:'one'}],cursor:null,truncated:false,observedRevision:'old',scope:'metadata-only'});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(root.textContent.includes('Old private'),false);view.dispose();
});
