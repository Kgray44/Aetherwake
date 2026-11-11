import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,relative,isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

test('actual desktop stdio host and worker route Agent/Checklist reads and writes without connecting a provider',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'aerynth-domain-host-'));
  const child=spawn(process.execPath,[fileURLToPath(new URL('../src/desktop-host.mts',import.meta.url)),join(dir,'canonical.sqlite'),dir,process.cwd()],{stdio:['pipe','pipe','pipe'],windowsHide:true});
  let sequence=0;const pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  const lines=createInterface({input:child.stdout});let diagnostics='';child.stderr.on('data',b=>{diagnostics=(diagnostics+String(b)).slice(-4096);});
  const ended=new Promise<number|null>(resolve=>child.on('exit',resolve));
  lines.on('line',line=>{const reply=JSON.parse(line);if(!reply.id)return;const entry=pending.get(reply.id);if(!entry)return;pending.delete(reply.id);clearTimeout(entry.timer);if(reply.error)entry.reject(Error(reply.error));else entry.resolve(reply.result);});
  const call=(command:string,input:unknown)=>new Promise<any>((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject,timer:setTimeout(()=>{pending.delete(id);reject(Error('synthetic host deadline '+diagnostics));},8000)});child.stdin.write(JSON.stringify({id,command,input})+'\n');});
  try{
    await assert.rejects(call('resourcePolicyNative',{name:'inspect'}),/native_resource_policy_required/);
    for(const [command,input] of [['velaFileProposalPrepareNative',{intent:'Add project docs to this workspace',selectedDirectory:dir}],['velaSourcesPickNative',{commandId:'forged-picker',selection:{kind:'folder',path:dir},destination:'context'}],['folderOpenNative',{resourceId:'forged-folder'}]] as const)
      await assert.rejects(call(command,input),/native_api_configuration_required/,'Public stdio without the native host cannot mint selection authority or resolve private paths');
    await assert.rejects(call('folders',{type:'list',resourceId:'forged-folder'}),/folder_source_unavailable/,'The public metadata command routes through the worker but cannot invent a folder grant');
    const templates=(await call('agents',{name:'templates',input:{}})).result;
    const receipt=(await call('agents',{name:'create',input:{commandId:'synthetic-host-agent',title:'Synthetic host Researcher',projectId:null,profile:templates.find((t:any)=>t.id==='researcher').profile}})).result;
    assert.equal((await call('agents',{name:'inspect',input:{resourceId:receipt.agent.resourceId}})).result.resource.kind,'agent');
    const checklist=(await call('checklists',{name:'create',input:{commandId:'synthetic-host-checklist',title:'Synthetic host checklist'}})).result;
    // A valid bounded document can exceed the unrelated ordinary-chat packet
    // limit. Exercise the actual process/worker boundary rather than a DTO mock.
    const operations=Array.from({length:200},(_,i)=>({type:'addEntry',key:'entry'+i,entry:{text:'Synthetic entry '+i,description:'x'.repeat(1400)}}));
    const mutation={name:'mutate',input:{commandId:'synthetic-host-checklist-items',resourceId:checklist.resourceId,expectedVersion:checklist.version,operations}};
    assert(Buffer.byteLength(JSON.stringify(mutation))>256*1024);
    await call('checklists',mutation);
    const document=(await call('checklists',{name:'read',input:{resourceId:checklist.resourceId}})).result;
    assert.equal(document.entries.length,200);assert.equal(document.entries[199].description,'x'.repeat(1400));
    const timeline=(await call('timelines',{name:'create',input:{commandId:'synthetic-host-timeline',title:'Synthetic Checklist activity',projectId:null,view:{schemaVersion:1,mode:'activity',scope:{projectId:null,resourceIds:[checklist.resourceId]},sources:{providerIds:[],eventTypes:[],classifications:['observed','reported','inferred','simulated']},viewport:{from:new Date(Date.now()-3600000).toISOString(),to:new Date(Date.now()+3600000).toISOString(),displayTimeZone:'UTC'},selection:null}}})).result;
    const timelineDocument=(await call('timelines',{name:'read',input:{resourceId:timeline.resourceId}})).result;assert.equal(timelineDocument.canEdit,true);
    const window=(await call('timelines',{name:'query',input:{resourceId:timeline.resourceId,expectedVersion:timeline.version}})).result;assert(window.items.some((item:any)=>item.event.type==='checklist.changed'));assert.equal(window.coverage.rawPayloads,false);
    const task=(await call('taskObjectives',{name:'create',input:{commandId:'synthetic-host-objective',title:'Synthetic host objective',projectId:null,definition:{objective:'Inspect actual canonical evidence',requirements:[{id:'criterion-a',text:'Inspect the source'}],assignees:[],dependencies:[],sources:[]}}})).result;
    assert.equal((await call('taskObjectives',{name:'read',input:{resourceId:task.resourceId}})).result.resource.kind,'task_objective');
    const desktop=await call('desktop',{type:'snapshot'});assert.equal(desktop.workspaces.length,0);assert.equal(desktop.blocks.length,0);
    assert.deepEqual(await call('providerActivity',{}),{codexConnections:0,providerRequests:0,systemMemoryReads:0,scope:'process-session-native-attempts'});
    await call('close',{});assert.equal(await ended,0);
  }finally{
    for(const item of pending.values()){clearTimeout(item.timer);item.reject(Error('synthetic test closed'));}pending.clear();
    if(child.exitCode===null)child.kill();await ended;lines.close();
    const target=resolve(dir),part=relative(resolve(tmpdir()),target);assert(part.startsWith('aerynth-domain-host-')&&!part.startsWith('..')&&!isAbsolute(part));rmSync(target,{recursive:true,force:true});
  }
});
