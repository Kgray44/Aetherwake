import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { BackendCore } from '../src/core.mts';
import { managePersonalMemory } from '../../visual-experience/cinematic-v3/native/personal-memory-management.cjs';

test('inspector source revocation withdraws existing share and cached branch through real Core',async()=>{
 const root=mkdtempSync(join(tmpdir(),'inspector-core-synthetic-'));const envelopes=new Map();
 const core=new BackendCore({path:join(root,'profile.sqlite'),privateRoot:root,provider:'fixture',contentPolicy:'local-private'},undefined,{secrets:{available:async()=>true,seal:async(value)=>{const b=randomBytes(64);envelopes.set(b.toString('hex'),value);return b},open:async(b)=>envelopes.get(Buffer.from(b).toString('hex'))}});
 try {
  const chat=await core.command('createConversation',{title:'Synthetic inspector',commandId:'chat'});
  const message=await core.command('addMessage',{resourceId:chat.resourceId,role:'user',content:'Synthetic quartz decision',expectedRevision:chat.revision,commandId:'message'});
  const saved=await core.command('personalMemoryCaptureCommitNative',await core.command('personalMemoryCapturePreviewNative',{conversationId:chat.resourceId,messageId:message.id,scope:'conversation',category:'decisions',text:'Synthetic quartz decision',keywords:['quartz']}));
  let confirmed=false;
  const manage=(input)=>managePersonalMemory({input,trustedFrame:()=>true,observeGesture:async()=>true,allowWrite:async()=>true,call:(name,input)=>core.command(name,input),confirm:async()=>confirmed,chooseExport:async()=>null,writeExport:async()=>{throw Error('unexpected export')}});
  const listed=await manage({type:'list'});assert(listed.records.some(r=>r.id===saved.id));
  const fact=await manage({type:'read',id:saved.id});assert.equal(fact.text,'Synthetic quartz decision');
  const branchInput={resourceId:chat.resourceId,messageId:message.id,includeMessageIds:[message.id],providerId:'local',title:'Synthetic downstream',commandId:'branch-before-revoke',tokenBudget:8192,expectedRevision:message.revision};
  const branch=await core.command('branch',branchInput);
  const publish={name:'publish',input:{sourceResourceId:chat.resourceId,sourceMessageId:message.id,evidence:'excerpt'}};
  const share=await core.command('conversation',publish);
  const inspect=()=>core.command('conversation',{name:'inspectShare',input:{shareId:share.id,resourceId:branch.conversation.resourceId}});
  assert.match(JSON.stringify(await inspect()),/Synthetic quartz decision/);

  const policy=await core.command('personalMemoryPolicyNative',{});
  const enabled=await core.command('personalMemoryPolicyNative',{enable:true,expectedVersion:policy.version});
  const disabled=await manage({type:'disableProviderMemory',assistant:'ordinary',version:enabled.version});assert.equal(disabled.ordinaryEnabled,false);
  assert.deepEqual(await manage({type:'revokeSource',id:saved.id,version:fact.version}),{status:'cancelled'});
  assert.equal((await manage({type:'read',id:saved.id})).text,fact.text);
  assert.match(JSON.stringify(await inspect()),/Synthetic quartz decision/);
  confirmed=true;const revoked=await manage({type:'revokeSource',id:saved.id,version:fact.version});assert.equal(revoked.status,'applied');assert.equal(revoked.erasedFacts,1);
  await assert.rejects(inspect(),/source_unavailable/);
  await assert.rejects(core.command('conversation',publish),/source_unavailable/);
  await assert.rejects(core.command('branch',branchInput),/source_unavailable/);
  await assert.rejects(manage({type:'read',id:saved.id}),/personal_record_unavailable/);
  assert.equal((await core.command('openResource',{resourceId:chat.resourceId,selection:{messageId:message.id}})).status,'unavailable');
 } finally {await core.command('close',{});rmSync(root,{recursive:true,force:true});}
});
