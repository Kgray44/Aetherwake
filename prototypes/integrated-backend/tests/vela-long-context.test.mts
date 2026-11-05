import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BackendCore } from '../src/core.mts';
import type { VelaBackendState } from '../src/contracts.mts';
import type { VelaRequest, VelaPlan } from '../../vela-core/src/contracts.ts';

/** Real Core/SQLite/provider protocol and policy gates; the stdio process is explicitly synthetic and has no network/account. */
function fixture(){
  const dir=mkdtempSync(join(tmpdir(),'aerynth-long-context-')),path=join(dir,'canonical.sqlite'),options={path,provider:'codex' as const,
    contentPolicy:'synthetic-only' as const,codexExecutable:process.execPath,codexArgs:[fileURLToPath(new URL('../../codex-bridge/tests/catalog-server.mjs',import.meta.url)),'answer-catalog'],velaCatalogDiscovery:true};
  let core=new BackendCore(options);
  const state=()=>core.command('vela',{name:'state',input:{}}) as Promise<VelaBackendState>;
  const review=async(intent:string,resourceIds:string[]=[],includeRecentHistory=true)=>{
    await core.command('capabilities',{});const preview=await core.command('velaRequestPreview',{intent,resourceIds,includeRecentHistory}),
      native=await core.command('velaNativeReview',{previewId:preview.id,signature:preview.signature});return {preview,native};};
  const approve=async(value:Awaited<ReturnType<typeof review>>)=>{const grant=await core.command('authorizeVelaRequest',{previewId:value.preview.id,signature:value.preview.signature,reviewDigest:value.native.reviewDigest});
    return {intent:value.preview.intent,resourceIds:value.preview.resourceIds,authorizeProvider:true,previewId:value.preview.id,grantId:grant.grantId};};
  return {get core(){return core;},state,review,approve,async ask(intent:string,ids:string[]=[],history=true){const value=await review(intent,ids,history),request=await core.command('vela',{name:'request',input:await approve(value)}) as VelaRequest;
    assert.equal(request.state,'responded',request.errorCode);return {...value,request};},async reopen(){await core.command('close',{});core=new BackendCore(options);},
    async close(){await core.command('close',{});const target=resolve(dir),part=relative(resolve(tmpdir()),target);assert(part.startsWith('aerynth-long-context-')&&!part.startsWith('..')&&!isAbsolute(part));rmSync(target,{recursive:true,force:true});}};
}

test('Core retrieves an exact earlier decision after 32 later real canonical turns and SQLite restart; revocation blocks frozen dispatch',async()=>{
  const f=fixture();try{
    const workspace=await f.core.command('desktop',{type:'createWorkspace',title:'Synthetic continuity review',projectId:null}),
      desktop=await f.core.command('desktop',{type:'createResource',kind:'note',title:'Aurora source',workspaceId:workspace.activeWorkspaceId!}),note=desktop.resources.find(resource=>resource.kind==='note')!;
    const first=await f.ask('Remember this user decision: the Aurora server port is 25581.',[note.id],false),before=(await f.state()).conversation!,
      sourceIds=before.messages.filter(message=>message.requestId===first.request.id).map(message=>message.id);
    for(let i=0;i<32;i++)await f.ask('Discuss unrelated coastal weather detail '+i,[],false);
    const prior=(await f.state()).conversation!;assert(prior.messages.length>=66);await f.reopen();assert.equal((await f.state()).conversation!.resourceId,before.resourceId);
    const recalled=await f.review('What did we decide earlier for the Aurora server port?'),history=recalled.native.history!;
    assert(history.messages.some(message=>message.id===sourceIds[0]&&message.content.includes('25581')));assert.equal(history.retrieval?.method,'lexical-canonical-exchanges');
    assert.equal(history.retrieval?.resolution,'matched');assert(history.retrieval!.scannedMessages>=66);assert.equal(history.retrieval?.partial,false);
    assert(history.messages.length<=4);assert(Buffer.byteLength(JSON.stringify(history))<=4096);assert(!JSON.stringify(history).includes('weather detail 15'));
    assert(!Object.hasOwn(recalled.preview.context,'history'),'public preview does not expose the private source transcript');
    const frozen=(f.core as any).velaPreviews.get(recalled.preview.id);assert.equal(frozen.historyFence.baseTailOrdinal,prior.messages.length);
    const accepted=await f.core.command('vela',{name:'request',input:await f.approve(recalled)}) as VelaRequest;assert.equal(accepted.state,'responded',accepted.errorCode);
    const stale=await f.review('Recall our earlier Aurora server port decision'),input=await f.approve(stale),activity=await f.core.command('providerActivity',{}),inside=f.core as any,read=inside.conversationAccess.resource.bind(inside.conversationAccess);
    inside.conversationAccess.resource=(id:string,...rest:unknown[])=>id!==note.id&&read(id,...rest);
    await assert.rejects(f.core.command('vela',{name:'request',input}),/stale_vela_preview|upstream-unavailable|message-unavailable/);
    assert.equal((await f.core.command('providerActivity',{})).providerRequests,activity.providerRequests,'withdrawn earlier evidence never starts a provider');
    const withdrawn=await f.review('Recall our earlier Aurora server port decision');assert(!withdrawn.native.history?.messages.some(message=>sourceIds.includes(message.id)));
  }finally{await f.close();}
});

test('Core retrieves older canonical operations by query after thirty later actions and asks to clarify an ambiguous correction',async()=>{
  const f=fixture();try{
    const workspace=await f.core.command('desktop',{type:'createWorkspace',title:'Synthetic operation context',projectId:null});
    for(let i=0;i<32;i++){
      const plan=await f.core.command('vela',{name:'native',input:{intent:i===0?'Create the Aurora launch note':'Create unrelated harbor note '+i,
        action:{type:'createResource',kind:'note',title:i===0?'Aurora launch note':'Harbor note '+i,workspaceId:workspace.activeWorkspaceId!}}}) as VelaPlan;
      await f.core.command('vela',{name:'apply',input:plan.id});
    }
    const oldest=(await f.state()).receipts[0];await f.reopen();
    const selected=await f.core.command('velaRequestPreview',{intent:'Recall the earlier Aurora launch note operation',resourceIds:[]});
    assert(selected.context.operations?.operations.some(operation=>operation.receiptId===oldest.id));assert(selected.context.operations!.operations.length<=4);
    const before=await f.core.command('desktop',{type:'snapshot'}),ambiguous=await f.core.command('velaRouteNative',{intent:'Fix that workspace'});
    assert.equal(ambiguous.matched,true);assert.equal(ambiguous.request!.response?.kind,'clarification');assert.equal(ambiguous.request!.providerId,null);
    assert.equal((await f.core.command('desktop',{type:'snapshot'})).resources.length,before.resources.length);
    assert.equal((await f.core.command('providerActivity',{})).providerRequests,0);
  }finally{await f.close();}
});
