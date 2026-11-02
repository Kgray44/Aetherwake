import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,relative,isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BackendCore } from '../src/core.mts';
import type { NoteMethod,NoteRequest } from '../src/contracts.mts';

function fixture(mode='normal'){const dir=mkdtempSync(join(tmpdir(),'aerynth-notes-backend-')),path=join(dir,'canonical.sqlite');let core=new BackendCore({path,provider:'fixture',fixtureMode:mode,contentPolicy:'synthetic-only'});return {get core(){return core;},async reopen(){await core.command('close',{});core=new BackendCore({path,provider:'fixture',fixtureMode:mode,contentPolicy:'synthetic-only'});},async close(){await core.command('close',{});const target=resolve(dir),part=relative(resolve(tmpdir()),target);assert.ok(part.startsWith('aerynth-notes-backend-')&&!part.startsWith('..')&&!isAbsolute(part));rmSync(target,{recursive:true,force:true});}};}
const notes=(core:BackendCore,name:NoteMethod,input:any)=>core.command('notes',{name,input} as NoteRequest) as Promise<any>;
async function createNote(core:BackendCore){const desktop=await core.command('desktop',{type:'createResource',kind:'note',title:'Canonical recovery note',workspaceId:null});return desktop.resources.find(r=>r.kind==='note')!;}

test('released note recovery survives restart without replacing canonical content, then commits through the existing desktop path',async()=>{
 const f=fixture();try{
  let connections=0;(f.core as any).port.connect=async()=>{connections++;throw new Error('Notes remain local');};const resource=await createNote(f.core),draft=await notes(f.core,'saveNoteDraft',{resourceId:resource.id,expectedDraftVersion:0,baseResourceVersion:resource.version,content:'Durable unsaved canonical recovery text'});
  assert.equal(draft.result.version,1);assert.equal((await f.core.command('desktop',{type:'snapshot'})).resources.find(r=>r.id===resource.id)!.content,'');await f.reopen();const recovered=await notes(f.core,'readNote',resource.id);assert.equal(recovered.result.draft.content,'Durable unsaved canonical recovery text');assert.equal(recovered.result.resource.content,'');
  const committed=await notes(f.core,'commitNote',{resourceId:resource.id,expectedResourceVersion:resource.version,expectedDraftVersion:1,content:recovered.result.draft.content});assert.equal(committed.result.draft,null);assert.equal(committed.result.draftRevision,2);assert.equal(committed.desktop.resources.find((r:any)=>r.id===resource.id).content,'Durable unsaved canonical recovery text');assert.equal(committed.result.resource.id,resource.id);assert.equal(connections,0);assert.equal(Object.keys((await f.core.command('snapshot',{})).executions).length,0);
 }finally{await f.close();}
});

test('draft and canonical version fences retain competing editor text and expose conflicts instead of silently rebasing',async()=>{
 const f=fixture();try{
  const resource=await createNote(f.core);await notes(f.core,'saveNoteDraft',{resourceId:resource.id,expectedDraftVersion:0,baseResourceVersion:1,content:'First editor unsaved text'});
  await assert.rejects(notes(f.core,'saveNoteDraft',{resourceId:resource.id,expectedDraftVersion:0,baseResourceVersion:1,content:'Stale competing editor'}),/note_draft_conflict/);
  await f.core.command('desktop',{type:'content',resourceId:resource.id,expectedVersion:1,content:'New canonical user content'});assert.equal((await notes(f.core,'readNote',resource.id)).result.conflict,true);
  await assert.rejects(notes(f.core,'commitNote',{resourceId:resource.id,expectedResourceVersion:1,expectedDraftVersion:1,content:'First editor unsaved text'}),/note_version_conflict/);
  const retained=await notes(f.core,'readNote',resource.id);assert.equal(retained.result.draft.content,'First editor unsaved text');assert.equal(retained.result.resource.content,'New canonical user content');
  const discarded=await notes(f.core,'discardNoteDraft',{resourceId:resource.id,expectedDraftVersion:1});assert.equal(discarded.result.draft,null);assert.equal(discarded.result.draftRevision,2);
  await assert.rejects(notes(f.core,'saveNoteDraft',{resourceId:resource.id,expectedDraftVersion:1,baseResourceVersion:2,content:'Old tab resurrected stale draft'}),/note_draft_conflict/);
 }finally{await f.close();}
});

test('failed canonical note mutation rolls back content/version and preserves recovery; rename and archive remain canonical',async()=>{
 const f=fixture();try{
  const resource=await createNote(f.core);await notes(f.core,'saveNoteDraft',{resourceId:resource.id,expectedDraftVersion:0,baseResourceVersion:1,content:'Retain this recovery text'});
  const desktop=(f.core as any).desktop,original=desktop.apply;desktop.apply=function(...args:any[]){original.apply(this,args);if(args[0].type==='content')throw new Error('Synthetic failure after actual canonical content update');};
  await assert.rejects(notes(f.core,'commitNote',{resourceId:resource.id,expectedResourceVersion:1,expectedDraftVersion:1,content:'Retain this recovery text'}),/Synthetic failure/);desktop.apply=original;
  const retained=await notes(f.core,'readNote',resource.id);assert.equal(retained.result.resource.version,1);assert.equal(retained.result.resource.content,'');assert.equal(retained.result.draft.content,'Retain this recovery text');
  const renamed=await notes(f.core,'renameNote',{resourceId:resource.id,expectedResourceVersion:1,title:'Renamed canonical recovery note'});assert.equal(renamed.result.resource.title,'Renamed canonical recovery note');assert.equal(renamed.desktop.resources.find((r:any)=>r.id===resource.id).title,'Renamed canonical recovery note');
  await f.core.command('desktop',{type:'archiveSubject',kind:'resource',id:resource.id,expectedVersion:2,archived:true});await assert.rejects(notes(f.core,'readNote',resource.id),/note_unavailable/);
  await f.core.command('desktop',{type:'archiveSubject',kind:'resource',id:resource.id,expectedVersion:3,archived:false});assert.equal((await notes(f.core,'readNote',resource.id)).result.draft.content,'Retain this recovery text');
 }finally{await f.close();}
});

test('recovery drafts remain usable during an explicitly synthetic pending fixture turn while canonical commit honors the busy fence',async()=>{
 const f=fixture('wait-interrupt');try{
  const resource=await createNote(f.core),conversation=await f.core.command('createConversation',{title:'Explicit synthetic fixture run',providerId:'fixture-codex',commandId:randomUUID()}),running=f.core.command('execute',{resourceId:conversation.resourceId,prompt:'Synthetic fixture only; no actual model',commandId:randomUUID(),authorized:true});let executionId='';
  for(let i=0;i<50;i++){const state=await f.core.command('snapshot',{}),execution=Object.values(state.executions).find(e=>e.resourceId===conversation.resourceId);if(execution?.turnId){executionId=execution.id;break;}await new Promise(resolve=>setTimeout(resolve,10));}assert.ok(executionId);
  assert.equal((await notes(f.core,'saveNoteDraft',{resourceId:resource.id,expectedDraftVersion:0,baseResourceVersion:1,content:'Draft while fixture is busy'})).result.version,1);await assert.rejects(notes(f.core,'commitNote',{resourceId:resource.id,expectedResourceVersion:1,expectedDraftVersion:1,content:'Draft while fixture is busy'}),/execution_busy/);
  await f.core.command('interrupt',{executionId});assert.equal((await running).state,'interrupted');assert.equal((await notes(f.core,'readNote',resource.id)).result.draft.content,'Draft while fixture is busy');
 }finally{await f.close();}
});
