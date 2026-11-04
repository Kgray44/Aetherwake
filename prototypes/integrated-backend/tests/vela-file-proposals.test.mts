import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,rmSync } from 'node:fs';
import { join,resolve,relative,isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BackendCore } from '../src/core.mts';
import { localDocumentIntent } from '../src/vela-file-proposals.mts';
import { CAPABILITIES,validateAction } from '../../vela-core/src/capabilities.ts';
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
