import test from 'node:test';
import assert from 'node:assert/strict';
import { stageChatDocumentForVela } from '../src/document-vela-staging.ts';
const ref={id:'file:synthetic',version:3};
const resource={...ref,kind:'file',title:'Synthetic.txt',available:true,visible:true,state:'active',media:{source:'file',format:'text'}};
for(const kind of ['file','note'])test('exact canonical '+kind+' stages without a send',async()=>{
 const staged=[],reads=[];const value={...resource,kind};
 await stageChatDocumentForVela(ref,{isCurrent:()=>true,open:async input=>{reads.push(input);return {status:'ready',resource:value};},stage:r=>staged.push(r)});
 assert.deepEqual(staged,[value]);assert.deepEqual(reads,[{resourceId:ref.id,expectedVersion:3,origin:{source:'application'}}]);
});
for(const [label,patch] of [['wrong id',{id:'file:other'}],['stale version',{version:4}],['revoked',{available:false}],['hidden',{visible:false}],['archived',{state:'archived'}],['unsupported',{kind:'conversation'}]])test('staging refuses '+label,async()=>{
 await assert.rejects(stageChatDocumentForVela(ref,{isCurrent:()=>true,open:async()=>({status:'ready',resource:{...resource,...patch}}),stage:()=>assert.fail('must not stage')}),/resource_unavailable/);
});
test('changed selection while canonical read is pending cannot stage',async()=>{
 let current=true,finish;const task=stageChatDocumentForVela(ref,{isCurrent:()=>current,open:()=>new Promise(done=>{finish=done}),stage:()=>assert.fail('must not stage')});
 current=false;finish({status:'ready',resource});await task;
});
