import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,rmSync } from 'node:fs';
import { join,resolve,relative,isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BackendCore } from '../src/core.mts';
import { localDocumentIntent,folderListingAnswer } from '../src/vela-file-proposals.mts';
import { CAPABILITIES,validateAction } from '../../vela-core/src/capabilities.ts';
import {selectBoundedHistory,validateFrozenHistoryMetadata} from '../../vela-core/src/bounded-history.mts';
import type { VelaFileProposal,VelaRequest } from '../../vela-core/src/contracts.ts';
const intent='Can you add the "Synthetic Library" project docs to this workspace?';
function fixture(){const base=resolve(tmpdir()),dir=mkdtempSync(join(base,'aerynth-file-proposal-')),root=join(dir,'Synthetic Library'),path=join(dir,'canonical.sqlite');
  mkdirSync(join(root,'docs'),{recursive:true});mkdirSync(join(root,'node_modules','ignored'),{recursive:true});
  writeFileSync(join(root,'README.md'),'SYNTHETIC PRIVATE DOCUMENT BODY A');writeFileSync(join(root,'docs','Guide.md'),'SYNTHETIC PRIVATE DOCUMENT BODY B');writeFileSync(join(root,'docs','Notes.txt'),'SYNTHETIC PRIVATE DOCUMENT BODY C');
  writeFileSync(join(root,'node_modules','ignored','README.md'),'EXCLUDED_PACKAGE_DOCUMENT');writeFileSync(join(root,'source.ts'),'export const source = 1;');
  const native={secrets:{available:async()=>false,seal:async()=>{throw Error('not used');},open:async()=>{throw Error('not used');}}};
  const create=()=>new BackendCore({path,provider:'fixture',contentPolicy:'synthetic-only',nativeMedia:true},()=>{},native,undefined,{fetch:async()=>{throw Error('No provider may be used for local discovery');}});
  let core=create();
  const state=async()=>await core.command('vela',{name:'state',input:{}}) as any;
  return {get core(){return core;},root,dir,state,
    async ready(){await core.command('desktop',{type:'createWorkspace',title:'Synthetic current workspace',projectId:null});},
    async prepare(){return await core.command('velaFileProposalPrepareNative',{intent,selectedDirectory:root});},
    async proposal(){return (await state()).fileProposals[0] as VelaFileProposal;},
    async act(name:'accept'|'cancel',proposal:VelaFileProposal){return await core.command('vela',{name:'fileProposal',input:{name,input:{id:proposal.id,digest:proposal.digest,expectedVersion:proposal.version}}}) as any;},
    async reopen(){await core.command('close',{});core=create();},
    async close(){await core.command('close',{}).catch(()=>{});const part=relative(base,resolve(dir));assert.ok(part.startsWith('aerynth-file-proposal-')&&!part.startsWith('..')&&!isAbsolute(part));rmSync(dir,{recursive:true,force:true});}};
}
test('empty resource workspace plans are rejected; an intentional empty workspace has its own canonical action',()=>{
  assert.throws(()=>validateAction({type:'workspaceFromResources',title:'Zero results',projectId:null,resourceIds:[]}),/invalid_action/);
  const descriptor=CAPABILITIES.find(item=>item.id==='workspaceFromResources')!;assert.equal((descriptor.schema as any).properties.resourceIds.minItems,1);
  assert.equal(validateAction({type:'createWorkspace',title:'Intentionally empty',projectId:null}).type,'createWorkspace');
  assert.deepEqual(localDocumentIntent(intent),{projectName:'Synthetic Library'});
  assert.deepEqual(localDocumentIntent('Please add the Synthetic Library project docs to this workspace'),{projectName:'Synthetic Library'});
  for(const explanation of ['How do I add files to this workspace?','Do not add documents to this workspace','Explain how to add documents to the workspace'])assert.equal(localDocumentIntent(explanation),null);
});
test('actual Core discovers local documents only after native root selection, reviews metadata and atomically imports into the existing workspace',async()=>{
  const f=fixture();try{await f.ready();const before=await f.core.command('desktop',{type:'snapshot'}),workspaceId=before.activeWorkspaceId!;
    const route=await f.core.command('velaRouteNative',{intent});assert.deepEqual(route,{matched:false,fileDiscovery:{projectName:'Synthetic Library'}});
    assert.equal((await f.core.command('snapshot',{})).conversations.length,0);
    const request=await f.prepare(),proposal=await f.proposal();assert.equal(request.id,proposal.requestId);assert.equal(request.nativeResponse?.classification,'observed');
    assert.equal(proposal.count,3);assert.equal(proposal.state,'proposed');assert.equal(proposal.target.workspaceId,workspaceId);
    assert.deepEqual(proposal.files.map(file=>file.relativePath).sort(),['README.md','docs/Guide.md','docs/Notes.txt'].sort());
    assert.ok(!JSON.stringify(proposal).includes(f.dir));assert.doesNotMatch(JSON.stringify(proposal),/PRIVATE DOCUMENT BODY|EXCLUDED_PACKAGE|authorizationRef/);
    assert.equal((await f.core.command('desktop',{type:'snapshot'})).resources.filter(resource=>resource.kind==='file').length,0);
    const accepted=await f.act('accept',proposal);assert.deepEqual(accepted.proposal.result,{importedCount:3,reusedCount:0,verified:true,workspaceId});
    const after=await f.core.command('desktop',{type:'snapshot'});assert.equal(after.activeWorkspaceId,workspaceId);assert.equal(after.workspaces.length,before.workspaces.length);
    const files=after.resources.filter(resource=>resource.kind==='file');assert.equal(files.length,3);assert.ok(files.every(file=>after.blocks.some(block=>block.workspace_id===workspaceId&&block.resource_id===file.id)));
    for(const file of files){const opened=await f.core.command('mediaDescribe',{resourceId:file.id});assert.equal(opened.metadata.source,'file');const metadata=opened.metadata as any;
      const chunk=await f.core.command('mediaReadChunk',{resourceId:file.id,expectedVersion:file.version,sourceRevision:metadata.sourceRevision,offset:0,length:metadata.byteLength});assert.match(Buffer.from(chunk.base64,'base64').toString(),/SYNTHETIC PRIVATE DOCUMENT BODY/);}
    const state=await f.state();assert.equal(state.requests.length,1);assert.equal(state.requests[0].id,request.id);assert.equal(state.requests[0].response.kind,'answer');
    assert.equal(state.conversation.messages.filter((message:any)=>message.role==='user').length,1,'Accept must not fabricate another user utterance');
    await assert.rejects(f.act('accept',proposal),/file_proposal_changed|file_proposal_already_resolved/);assert.equal((await f.core.command('desktop',{type:'snapshot'})).resources.filter(resource=>resource.kind==='file').length,3);
    assert.equal((await f.core.command('providerActivity',{})).providerRequests,0);assert.equal((await f.core.command('providerActivity',{})).codexConnections,0);
    await f.reopen();assert.equal((await f.proposal()).state,'applied');
    const reused=await f.core.command('velaRouteNative',{intent});assert.equal(reused.matched,true,'A previously selected root should not require another native picker for the same requested scope');
    const again=await f.proposal(),result=await f.act('accept',again);assert.equal(result.proposal.result.importedCount,0);assert.equal(result.proposal.result.reusedCount,3);
  }finally{await f.close();}
});
test('No cancels without importing; forged receipts, changed files and changed workspace versions cannot apply',async()=>{
  for(const change of ['cancel','digest','source','deleted','layout'] as const){const f=fixture();try{await f.ready();await f.prepare();const proposal=await f.proposal();
    if(change==='cancel'){const result=await f.act('cancel',proposal);assert.equal(result.proposal.state,'cancelled');assert.equal(result.request.id,proposal.requestId);}
    if(change==='digest')await assert.rejects(f.act('accept',{...proposal,digest:'0'.repeat(64)}),/file_proposal_changed/);
    if(change==='source'){writeFileSync(join(f.root,'README.md'),'Changed after the reviewed proposal.');await assert.rejects(f.act('accept',proposal),/file_proposal_source_changed/);}
    if(change==='deleted'){rmSync(join(f.root,'README.md'));await assert.rejects(f.act('accept',proposal),/file_proposal_source_changed/);assert.equal((await f.proposal()).state,'stale');}
    if(change==='layout'){await f.core.command('desktop',{type:'createResource',kind:'note',title:'Concurrent layout change',workspaceId:proposal.target.workspaceId});await assert.rejects(f.act('accept',proposal),/file_proposal_stale|file_proposal_target_changed/);}
    assert.equal((await f.core.command('desktop',{type:'snapshot'})).resources.filter(resource=>resource.kind==='file').length,0);
  }finally{await f.close();}}
});
test('domain verification failure rolls back the whole batch and empty discovery gives a truthful clarification',async()=>{
  const f=fixture();try{await f.ready();await f.prepare();const proposal=await f.proposal(),owner=f.core as any,original=owner.importFileProposal.bind(owner);
    owner.importFileProposal=(...args:any[])=>({...original(...args),verified:false});await assert.rejects(f.act('accept',proposal),/file_proposal_verification_failed/);
    assert.equal((await f.core.command('desktop',{type:'snapshot'})).resources.filter(resource=>resource.kind==='file').length,0);assert.equal((await f.proposal()).state,'proposed');
    owner.importFileProposal=original;await f.act('cancel',proposal);const empty=join(f.dir,'Empty project');mkdirSync(empty);
    const request=await f.core.command('velaFileProposalPrepareNative',{intent,selectedDirectory:empty});assert.equal(request.response?.kind,'clarification');assert.equal(request.nativeResponse?.classification,'observed');
    assert.equal((await f.state()).fileProposals.filter((item:any)=>item.state==='proposed').length,0);assert.equal((await f.core.command('providerActivity',{})).providerRequests,0);
  }finally{await f.close();}
});

test('manual native file picking imports context refs without placement or inference, and only selected text enters canonical context',async()=>{
  const f=fixture();try{await f.ready();const before=await f.core.command('desktop',{type:'snapshot'}),path=join(f.root,'README.md');
    const picked=await f.core.command('velaSourcesPickNative',{commandId:randomUUID(),selection:{kind:'files',paths:[path]},destination:'context'});
    assert.equal(picked.resources.length,1);const source=picked.resources[0];assert.equal(source.kind,'file');assert.equal(source.version,1);assert.equal(source.projectId,null);
    const after=await f.core.command('desktop',{type:'snapshot'});assert.equal(after.blocks.length,before.blocks.length);assert.equal(after.resources.filter(item=>item.kind==='file').length,1);
    const owner=f.core as any;assert.equal(owner.vela.previewContext([]).included.length,0);const context=owner.vela.previewContext([source.id]);assert.equal(context.included.length,1);assert.match(context.included[0].content,/SYNTHETIC PRIVATE DOCUMENT BODY A/);
    assert.equal(context.included[0].trust,'untrusted-source-data');assert.ok(!context.included[0].source.includes(f.dir));
    const attached=await f.core.command('velaSourcesPickNative',{commandId:randomUUID(),selection:{kind:'files',paths:[path]},destination:'workspace',workspaceId:after.activeWorkspaceId!,expectedLayoutVersion:after.layoutVersion});
    assert.equal(attached.resources[0].id,source.id);const workspace=await f.core.command('desktop',{type:'snapshot'});assert.equal(workspace.resources.filter(item=>item.kind==='file').length,1);assert.ok(workspace.blocks.some(block=>block.resource_id===source.id));
    writeFileSync(path,'Source changed after selection.');assert.equal(owner.vela.previewContext([source.id]).included.length,0,'A changed source is omitted whole rather than read under its old grant/version');
    assert.equal((await f.core.command('providerActivity',{})).providerRequests,0);assert.equal((await f.core.command('snapshot',{})).conversations.length,0,'Picking sources must not fabricate a conversation turn');
  }finally{await f.close();}
});

test('native multi-file import rolls back all resources when a selected file changes at either transaction boundary',async()=>{
  for(const moment of ['before','during'] as const){const f=fixture();try{await f.ready();const owner=f.core as any,path=join(f.root,'README.md'),originalOnce=owner.once.bind(owner),originalCreate=owner.kernel.createGenericResource.bind(owner.kernel);let changed=false;
    const change=()=>{if(!changed){changed=true;writeFileSync(path,'Changed by a concurrent local writer.');}};
    if(moment==='before')owner.once=(id:string,input:any,work:()=>unknown)=>originalOnce(id,input,()=>{if(input.operation==='vela-source-picker')change();return work();});
    else owner.kernel.createGenericResource=(...args:any[])=>{const resource=originalCreate(...args);change();return resource;};
    await assert.rejects(f.core.command('velaSourcesPickNative',{commandId:randomUUID(),selection:{kind:'files',paths:[path,join(f.root,'docs','Guide.md')]},destination:'context'}),/source_changed/);
    assert.equal((await f.core.command('desktop',{type:'snapshot'})).resources.filter(item=>item.kind==='file').length,0);assert.equal(owner.db.prepare('SELECT count(*) AS n FROM media_sources').get().n,0);
  }finally{await f.close();}}
});

test('manual folder selection is one persistent canonical source; explicit browsing returns metadata and only native opening resolves directories',async()=>{
  const f=fixture();try{await f.ready();const before=await f.core.command('desktop',{type:'snapshot'});
    const picked=await f.core.command('velaSourcesPickNative',{commandId:randomUUID(),selection:{kind:'folder',path:f.root},destination:'workspace',workspaceId:before.activeWorkspaceId!,expectedLayoutVersion:before.layoutVersion});
    assert.equal(picked.resources.length,1);const folder=picked.resources[0];assert.equal(folder.kind,'folder');assert.equal(folder.version,1);assert.equal(folder.projectId,null);
    const after=await f.core.command('desktop',{type:'snapshot'});assert.equal(after.resources.length,1);assert.equal(after.resources[0].kind,'folder');assert.equal(after.blocks.filter(block=>block.resource_id===folder.id).length,1);
    assert.deepEqual(Object.keys(after.resources[0].folder!).sort(),['name','source','sourceRevision']);assert.doesNotMatch(JSON.stringify(after),/SYNTHETIC PRIVATE DOCUMENT BODY|sourceGrantId|selected_path/);assert.ok(!JSON.stringify(after).includes(f.dir));
    const opened=await f.core.command('openResource',{resourceId:folder.id,origin:{source:'library'}});assert.equal(opened.status,'ready');if(opened.status==='ready')assert.equal(opened.resource.folder?.source,'folder');
    const description=await f.core.command('folders',{type:'describe',resourceId:folder.id});assert.equal('accessState' in description&&description.accessState,'available');
    const listed=await f.core.command('folders',{type:'list',resourceId:folder.id});assert.ok('entries' in listed);if(!('entries' in listed))throw Error('missing folder listing');
    assert.ok(listed.entries.some(entry=>entry.name==='README.md'&&entry.kind==='file'));assert.ok(!JSON.stringify(listed).includes(f.dir));assert.doesNotMatch(JSON.stringify(listed),/PRIVATE DOCUMENT BODY|sourceGrantId/);
    const child=listed.entries.find(entry=>entry.name==='docs')!,file=listed.entries.find(entry=>entry.name==='README.md')!;
    assert.equal((await f.core.command('folderOpenNative',{resourceId:folder.id,entryId:child.id})).path,join(f.root,'docs'));
    await assert.rejects(f.core.command('folderOpenNative',{resourceId:folder.id,entryId:file.id}),/folder_entry_not_directory/);
    await assert.rejects(f.core.command('folders',{type:'list',resourceId:folder.id,path:f.root} as any),/invalid_folder_request/);
    const repeated=await f.core.command('velaSourcesPickNative',{commandId:randomUUID(),selection:{kind:'folder',path:f.root},destination:'context'});assert.equal(repeated.resources[0].id,folder.id);
    assert.equal((f.core as any).db.prepare('SELECT count(*) AS n FROM folder_sources').get().n,1);assert.equal((await f.core.command('snapshot',{})).conversations.length,0);
    await f.reopen();assert.equal((await f.core.command('desktop',{type:'snapshot'})).resources[0].id,folder.id);
    await assert.rejects(f.core.command('folders',{type:'list',resourceId:folder.id,entryId:child.id}),/folder_listing_expired/);
    assert.equal((await f.core.command('providerActivity',{})).providerRequests,0);
  }finally{await f.close();}
});

test('explicit project document discovery reuses the canonical Folder grant and reviews children before adding them to the current workspace',async()=>{
  const f=fixture();try{await f.ready();const picked=await f.core.command('velaSourcesPickNative',{commandId:randomUUID(),selection:{kind:'folder',path:f.root},destination:'context'}),folder=picked.resources[0];
    const route=await f.core.command('velaRouteNative',{intent,resourceIds:[folder.id]});assert.equal(route.matched,true);const proposal=await f.proposal();assert.equal(proposal.count,3);
    assert.equal((f.core as any).db.prepare('SELECT count(*) AS n FROM vela_file_roots').get().n,0,'Reusing a Folder must not create a competing root grant');
    assert.equal((await f.core.command('desktop',{type:'snapshot'})).resources.filter(item=>item.kind==='file').length,0,'Discovery and review must not import children');
    await f.act('accept',proposal);const after=await f.core.command('desktop',{type:'snapshot'});assert.equal(after.resources.filter(item=>item.kind==='folder').length,1);assert.equal(after.resources.filter(item=>item.kind==='file').length,3);assert.equal(after.workspaces.length,1);
    const again=await f.core.command('velaRouteNative',{intent});assert.equal(again.matched,true,'An unambiguous matching connected folder needs no repeat root chooser');
    assert.equal((f.core as any).db.prepare('SELECT count(*) AS n FROM folder_sources').get().n,1);assert.equal((f.core as any).db.prepare('SELECT count(*) AS n FROM vela_file_roots').get().n,0);
    assert.equal((await f.core.command('providerActivity',{})).providerRequests,0);
  }finally{await f.close();}
});

test('revoked Folder grants fence both metadata reads and previously reviewed document imports',async()=>{
  const f=fixture();try{await f.ready();const picked=await f.core.command('velaSourcesPickNative',{commandId:randomUUID(),selection:{kind:'folder',path:f.root},destination:'context'}),folder=picked.resources[0];
    await f.core.command('velaRouteNative',{intent,resourceIds:[folder.id]});const proposal=await f.proposal(),owner=f.core as any;
    owner.kernel.withTransaction(()=>owner.db.prepare("UPDATE folder_sources SET grant_state='revoked' WHERE resource_id=?").run(folder.id));
    const description=await f.core.command('folders',{type:'describe',resourceId:folder.id});assert.equal('accessState' in description&&description.accessState,'revoked');
    await assert.rejects(f.core.command('folders',{type:'list',resourceId:folder.id}),/folder_source_unavailable/);await assert.rejects(f.core.command('folderOpenNative',{resourceId:folder.id}),/folder_source_unavailable/);
    await assert.rejects(f.act('accept',proposal),/file_proposal_scope_changed/);assert.equal((await f.core.command('desktop',{type:'snapshot'})).resources.filter(item=>item.kind==='file').length,0);
  }finally{await f.close();}
});

test('explicit selected file and folder Add attaches exact canonical refs to the current workspace without rediscovery, review or another user turn',async()=>{
  const f=fixture();try{await f.ready();const files=await f.core.command('velaSourcesPickNative',{commandId:randomUUID(),selection:{kind:'files',paths:[join(f.root,'README.md'),join(f.root,'docs','Guide.md')]},destination:'context'}),folder=await f.core.command('velaSourcesPickNative',{commandId:randomUUID(),selection:{kind:'folder',path:f.root},destination:'context'});
    const refs=[...files.resources,...folder.resources].map(ref=>({id:ref.id,kind:'resource' as const,resourceKind:ref.kind,title:ref.title,version:ref.version,projectId:ref.projectId}));
    const route=await f.core.command('velaRouteNative',{intent:'Can you add these selected files and folder to this workspace?',resourceIds:refs.map(ref=>ref.id),resourceRefs:refs});assert.equal(route.matched,true);if(!route.matched)throw Error('native route required');
    assert.equal(route.request.nativeAttachment?.addedCount,3);assert.equal(route.request.nativeAttachment?.verified,true);assert.equal(route.request.response?.kind,'answer');
    const state=await f.state(),after=await f.core.command('desktop',{type:'snapshot'});assert.equal(state.requests.length,1);assert.equal(state.conversation.messages.filter((message:any)=>message.role==='user').length,1);assert.equal(state.conversation.messages.filter((message:any)=>message.requestId===route.request.id&&message.role==='assistant').length,1);
    assert.equal(after.workspaces.length,1);assert.equal(after.resources.filter(ref=>ref.kind==='file').length,2);assert.equal(after.resources.filter(ref=>ref.kind==='folder').length,1);assert.ok(refs.every(ref=>after.blocks.filter(block=>block.resource_id===ref.id).length===1));assert.equal(state.fileProposals.length,0);
    const again=await f.core.command('velaRouteNative',{intent:'Add these files and folder to this workspace',resourceIds:refs.map(ref=>ref.id),resourceRefs:refs});assert.equal(again.matched&&again.request.nativeAttachment?.addedCount,0);assert.equal(again.matched&&again.request.nativeAttachment?.existingCount,3);
    await f.reopen();assert.equal((await f.state()).requests[0].nativeAttachment.verified,true);assert.equal((await f.core.command('providerActivity',{})).providerRequests,0);
  }finally{await f.close();}
});

test('direct selected source attachment refuses stale refs and rolls back the whole current-workspace batch on a placement failure',async()=>{
  for(const fault of ['stale','placement'] as const){const f=fixture();try{await f.ready();const picked=await f.core.command('velaSourcesPickNative',{commandId:randomUUID(),selection:{kind:'files',paths:[join(f.root,'README.md'),join(f.root,'docs','Guide.md')]},destination:'context'}),refs=picked.resources.map(ref=>({id:ref.id,kind:'resource' as const,resourceKind:ref.kind,title:ref.title,version:ref.version,projectId:ref.projectId}));
    if(fault==='stale')refs[0].version++;
    else{const engine=(f.core as any).desktop.nativeBlockServices().engine,original=engine.execute.bind(engine);let attaches=0;engine.execute=(command:any)=>{const result=original(command);if(command.type==='attachResource'&&++attaches===1)throw Error('Synthetic placement fault');return result;};}
    await assert.rejects(f.core.command('velaRouteNative',{intent:'Add these files to this workspace',resourceIds:refs.map(ref=>ref.id),resourceRefs:refs}),fault==='stale'?/source_selection_changed/:/Synthetic placement fault/);
    const after=await f.core.command('desktop',{type:'snapshot'});assert.equal(after.blocks.filter(block=>refs.some(ref=>ref.id===block.resource_id)).length,0);assert.equal((await f.state()).requests.length,0);
  }finally{await f.close();}}
});

test('typed native search continuation attaches only an actual applied search result and never invents future IDs',async()=>{
  const f=fixture();try{await f.ready();const picked=await f.core.command('velaSourcesPickNative',{commandId:randomUUID(),selection:{kind:'files',paths:[join(f.root,'README.md')]},destination:'context'});
    const plan=await f.core.command('vela',{name:'native',input:{intent:'Find README files',action:{type:'search',query:'README'}}}) as any;
    await f.core.command('vela',{name:'apply',input:plan.id});const selection=(f.core as any).vela.nativeSearchSelection();assert.equal(selection.resources.length,1);assert.equal(selection.resources[0].id,picked.resources[0].id);
    await f.reopen();const route=await f.core.command('velaRouteNative',{intent:'Add those results to this workspace'});assert.equal(route.matched,true);assert.equal(route.matched&&route.request.nativeAttachment?.searchReceiptId,selection.receiptId);assert.equal(route.matched&&route.request.nativeAttachment?.addedCount,1);
    const after=await f.core.command('desktop',{type:'snapshot'});assert.equal(after.resources.filter(resource=>resource.kind==='file').length,1);assert.equal(after.blocks.filter(block=>block.resource_id===picked.resources[0].id).length,1);
    const noReplay=await f.core.command('velaRouteNative',{intent:'Add those results to this workspace'});assert.equal(noReplay.matched&&noReplay.request.response?.kind,'clarification','An intervening turn must not silently choose an older search');
    const absentFiles=await f.core.command('velaRouteNative',{intent:'Add those files to this workspace'});assert.equal(absentFiles.matched&&absentFiles.request.response?.kind,'clarification','A missing selected-file receipt must not turn into unrelated folder discovery');
  }finally{await f.close();}
});

test('selected-folder questions read actual bounded metadata without a workspace or inference and bind later history to the current Folder grant',async()=>{
  const f=fixture();try{const picked=await f.core.command('velaSourcesPickNative',{commandId:randomUUID(),selection:{kind:'folder',path:f.root},destination:'context'}),folder=picked.resources[0],ref={id:folder.id,kind:'resource' as const,resourceKind:'folder',title:folder.title,version:folder.version,projectId:folder.projectId};
    const route=await f.core.command('velaRouteNative',{intent:'What files are in this folder?',resourceIds:[folder.id],resourceRefs:[ref]});assert.equal(route.matched,true);if(!route.matched)throw Error('native folder answer required');
    const owner=f.core as any,state=await f.state(),answer=state.conversation.messages.find((message:any)=>message.id===route.request.response?.messageId);assert.match(answer.content,/README\.md|docs/);assert.doesNotMatch(answer.content,/PRIVATE DOCUMENT BODY|sourceGrantId|fentry-|fcursor-/);assert.ok(!answer.content.includes(f.dir));
    assert.equal(route.request.context.discovered[0].id,folder.id);assert.equal(route.request.context.discovered[0].version,folder.version);assert.equal(route.request.nativeSourceObservation?.kind,'folder-metadata');assert.match(route.request.nativeSourceObservation!.bindingDigest,/^[a-f0-9]{64}$/);
    assert.ok(owner.vela.historyRequestMetadata(route.request.id));const before=owner.vela.previewProviderContext([],{includeHistory:true,fits:()=>true});assert.ok(before.context.history?.messages.some((message:any)=>message.content.includes('README.md')),JSON.stringify(before.historyOmissions));
    const entry=before.context.history.messages.find((message:any)=>message.content.includes('README.md'));assert.equal(entry.source,'vela-native');assert.equal(entry.classification,'observed');assert.equal(entry.providerId,undefined,'Native facts must not acquire fabricated provider attribution');
    const readers=owner.vela.historyReaders(),snapshot=owner.vela.opts.history.snapshot(route.request.conversationId,12),missingHost=selectBoundedHistory({enabled:true,origin:before.origin,snapshot,reader:{...readers.full,verifyNativeSourceObservation:undefined},fits:()=>true});assert.equal(missingHost.fence,null,'A typed-looking native reply without the current host validator never becomes history authority');
    assert.throws(()=>validateFrozenHistoryMetadata({fence:before.historyFence,origin:before.origin,reader:{...readers.metadata,verifyNativeSourceObservation:undefined},current:{conversationId:before.historyFence.conversationId,revision:before.historyFence.baseRevision}}),/upstream-unavailable/);
    owner.kernel.withTransaction(()=>owner.db.prepare("UPDATE folder_sources SET grant_state='revoked' WHERE resource_id=?").run(folder.id));assert.equal(owner.vela.historyRequestMetadata(route.request.id),null,'Revocation invalidates the observed source proof');
    assert.throws(()=>owner.vela.validateProviderHistory(before),/unavailable|scope|unproven|changed|source/);const after=owner.vela.previewProviderContext([],{includeHistory:true,fits:()=>true});assert.ok(!after.context.history?.messages.some((message:any)=>message.content.includes('README.md')),'Revoked folder metadata cannot enter later provider history');
    const desktop=await f.core.command('desktop',{type:'snapshot'});assert.equal(desktop.workspaces.length,0);assert.equal(desktop.resources.filter(item=>item.kind==='folder').length,1);assert.equal(desktop.resources.filter(item=>item.kind==='file').length,0);assert.equal((await f.core.command('providerActivity',{})).providerRequests,0);
  }finally{await f.close();}
});

test('a Folder grant revoked during native metadata listing cannot append an observed answer or expose names to history',async()=>{
  const f=fixture();try{const picked=await f.core.command('velaSourcesPickNative',{commandId:randomUUID(),selection:{kind:'folder',path:f.root},destination:'context'}),folder=picked.resources[0],owner=f.core as any;
    const pending=f.core.command('velaRouteNative',{intent:'List this folder',resourceIds:[folder.id]});pending.catch(()=>{});owner.kernel.withTransaction(()=>owner.db.prepare("UPDATE folder_sources SET grant_state='revoked' WHERE resource_id=?").run(folder.id));
    await assert.rejects(pending,/folder_permission_revoked|folder_source_unavailable|source_selection_changed/);assert.equal((await f.state()).requests.length,0);assert.equal((await f.core.command('providerActivity',{})).providerRequests,0);
  }finally{await f.close();}
});

test('folder answers pack complete long Unicode names below 1800 UTF-8 bytes and disclose a partial preview',()=>{
  const entries=Array.from({length:20},(_,i)=>({id:'opaque-'+i,name:'界'.repeat(115)+String(i)+'.txt',kind:'file' as const,sourceRevision:'a'.repeat(64)}));
  const answer=folderListingAnswer('界'.repeat(120),{resourceId:'synthetic',entryId:null,name:'Synthetic',entries,cursor:null,truncated:false,observedRevision:'b'.repeat(64),scope:'metadata-only'});
  assert.ok(Buffer.byteLength(answer)<=1800);assert.match(answer,/bounded preview/);const shown=entries.filter(entry=>answer.includes(JSON.stringify(entry.name)));assert.ok(shown.length>0&&shown.length<12);for(const line of answer.split('\n').filter(line=>line.startsWith('• ')))assert.ok(entries.some(entry=>line==='• '+JSON.stringify(entry.name)),'Every displayed filename stays whole');
});
