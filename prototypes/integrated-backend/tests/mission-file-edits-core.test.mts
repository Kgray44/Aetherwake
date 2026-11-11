import test from 'node:test';
import assert from 'node:assert/strict';
import { ownedFileEditAdmission } from './fixture-file-edit-admission.mts';
import {execFileSync} from 'node:child_process';
import {createCipheriv,createDecipheriv,randomBytes,randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {BackendCore} from '../src/core.mts';
import type {NativeHostServices} from '../src/native-host.mts';
import type {VelaBackendState} from '../src/contracts.mts';
import type {MissionFileEditView} from '../../application-contract/mission-file-edits.ts';
const before='export const add=(a,b)=>a-b;\n',after='export const add=(a,b)=>a+b;\n';
const intent='Fix the subtraction bug in this selected file so add returns the sum.';
const tap='TAP version 13\nok 1 - adds\n1..1\n# tests 1\n# suites 0\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 1\n';
function response(model:string,text:string){const id='synthetic-'+randomUUID();return new Response([
  {type:'response.created',response:{id,status:'in_progress'}},{type:'response.output_text.delta',delta:text},
  {type:'response.completed',response:{id,model,status:'completed',usage:{input_tokens:90,output_tokens:50,total_tokens:140},output:[{type:'message',id:'msg-'+id,role:'assistant',status:'completed',content:[{type:'output_text',text,annotations:[]}]}]}},
].map(item=>'data: '+JSON.stringify(item)+'\n\n').join(''),{headers:{'Content-Type':'text/event-stream'}});}
function fixture(){
  const parent=resolve(homedir(),'Documents','Aerynth Validation'),root=join(parent,'mfec-'+randomUUID()),repo=join(root,'repo'),profile=join(root,'profile'),file=join(repo,'source.mjs'),testPath=join(repo,'source.test.mjs');
  mkdirSync(repo,{recursive:true});mkdirSync(profile);writeFileSync(file,before);writeFileSync(testPath,"import test from 'node:test';import assert from 'node:assert/strict';import {add} from './source.mjs';test('adds',()=>assert.equal(add(2,3),5));\n");
  const git=(args:string[])=>execFileSync(process.platform==='win32'?'git.exe':'git',['-C',repo,...args],{windowsHide:true,timeout:5000,stdio:'pipe'});
  git(['init','-q']);git(['add','source.mjs','source.test.mjs']);git(['-c','user.name=Synthetic Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-qm','Synthetic M3 file']);
  const key=randomBytes(32),bodies:any[]=[];let checkCalls=0,execute=async()=>({exitCode:0,stdout:tap,stderr:''}),holdApi=false,releaseApi=()=>{},nativeMedia=true;
  const native:NativeHostServices={fileEditAdmission:ownedFileEditAdmission([root]),secrets:{available:async()=>true,seal:async text=>{const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,c.update(text),c.final(),c.getAuthTag()]);},open:async bytes=>{const b=Buffer.from(bytes),c=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));c.setAuthTag(b.subarray(-16));return Buffer.concat([c.update(b.subarray(12,-16)),c.final()]).toString();}}};
  const api={fetch:(async(url,init)=>{if(String(url).endsWith('/models'))return Response.json({data:[{id:'gpt-6-luna'}]});assert.equal(String(url),'https://api.openai.com/v1/responses');const body=JSON.parse(String(init?.body));bodies.push(body);if(holdApi)await new Promise<void>(resolve=>{releaseApi=resolve;});const input=JSON.parse(body.input[0].content);return response(body.model,JSON.stringify({summary:'Fix addition',files:[{path:input.inspection.source.relativePath,replacement:after}]}));}) as typeof fetch};
  const create=()=>{const core=new BackendCore({path:join(profile,'canonical.sqlite'),privateRoot:profile,provider:'fixture',contentPolicy:'synthetic-only',nativeMedia},()=>{},native,undefined,api);
    (core as any).port.projectChecks={ready:async()=>true,execute:async(argv:string[],cwd:string)=>{checkCalls++;assert.equal(cwd.toLowerCase(),repo.toLowerCase());assert.deepEqual(argv.slice(1),['--test','--test-isolation=none','--test-reporter=tap','--','./source.test.mjs']);return execute();}};return core;};
  let core=create(),resourceId='';
  const ref=()=>{const row=(core as any).db.prepare('SELECT version,title FROM resources WHERE id=?').get(resourceId);return {id:resourceId,kind:'resource' as const,version:Number(row.version),title:String(row.title),resourceKind:'file'};};
  const state=async()=>await core.command('vela',{name:'state',input:{}}) as VelaBackendState;
  const prepare=async()=>await core.command('missionFileEditPrepareNative',{intent,resourceIds:[resourceId],resourceRefs:[ref()]});
  const run=async()=>{const prepared=await prepare();return await core.command('missionFileEditRunNative',{requestId:prepared.requestId,reviewId:prepared.reviewId,reviewDigest:prepared.review.reviewDigest});};
  const operation=async()=>{const current=await state();assert.equal(current.missionFileEdits?.length,1);return current.missionFileEdits![0];};
  const approve=async(op:MissionFileEditView,purpose:'patch'|'check'='patch')=>{const review=purpose==='patch'?await core.command('missionFileEditReviewNative',{operationId:op.id}):await core.command('missionFileEditCheckReviewNative',{operationId:op.id,selectedTestPath:testPath});
    return (await core.command('missionFileEditChoiceNative',{operationId:op.id,reviewId:review.reviewId,reviewDigest:review.reviewDigest,purpose,decision:'yes',nativeChoiceId:randomUUID()}))!;};
  return {file,testPath,root,repo,profile,bodies,ref,prepare,run,operation,approve,state,get core(){return core;},get db(){return (core as any).db;},get resourceId(){return resourceId;},get checkCalls(){return checkCalls;},set execute(next:typeof execute){execute=next;},
    set holdApi(value:boolean){holdApi=value;},releaseApi(){holdApi=false;releaseApi();},
    set nativeMedia(value:boolean){nativeMedia=value;},
    async ready(){await core.command('velaApiConfigure',{credential:{configurationId:'vela-primary',apiKey:'SYNTHETIC_M3_API_KEY'},expectedVersion:null});await core.command('velaApiUsageAuthorize',{expectedVersion:1,enabled:true});
      await core.command('desktop',{type:'createWorkspace',title:'Synthetic M3 workspace',projectId:null});const desktop=await core.command('desktop',{type:'snapshot'});
      const picked=await core.command('velaSourcesPickNative',{commandId:randomUUID(),selection:{kind:'files',paths:[file]},destination:'workspace',workspaceId:desktop.activeWorkspaceId!,expectedLayoutVersion:desktop.layoutVersion});resourceId=picked.resources[0].id;},
    restartClosedCore(){core=create();},
    async reopen(){await core.command('close',{});core=create();},
    async close(){releaseApi();await core.command('close',{}).catch(()=>{});const part=relative(parent,resolve(root));assert.ok(part.startsWith('mfec-')&&!part.startsWith('..')&&!isAbsolute(part));rmSync(root,{recursive:true,force:true});}
  };
}

async function closeWhileExternalWorkIsHeld(core: BackendCore) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const started = performance.now();
  try {
    await Promise.race([
      core.command('close', {}),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(Error('Core shutdown did not finish with external work held')), 10_000);
      }),
    ]);
    return performance.now() - started;
  } finally {
    clearTimeout(timeout);
  }
}

// The Windows CI job retains every native write, recovery and authority assertion.
if(process.platform!=='win32'){
test('non-Windows actual Core refuses selected-file preparation before API dispatch or write authority',async()=>{
 const f=fixture();try{await f.ready();await assert.rejects(f.prepare(),/vela_codex_write_unavailable/);assert.equal(f.bodies.length,0);assert.equal(f.checkCalls,0);assert.equal(readFileSync(f.file,'utf8'),before);for(const table of ['mission_file_inspections','mission_file_operations','mission_file_authorities'])assert.equal(f.db.prepare('SELECT count(*) n FROM '+table).get()!.n,0);}finally{await f.close();}
});
}else{
test('actual stale second Core closes without a mutation and cannot overwrite the first host', async () => {
  const f=fixture(); let second:BackendCore|undefined,reopened:BackendCore|undefined;
  try {
    const path=join(f.profile,'canonical.sqlite');
    second=new BackendCore({path,privateRoot:f.profile,provider:'fixture',contentPolicy:'synthetic-only'},()=>{});
    await second.command('snapshot',{});
    await f.core.command('createConversation',{title:'Synthetic first writer',commandId:randomUUID()});
    await assert.rejects(second.command('createConversation',{title:'Synthetic stale writer',commandId:randomUUID()}),/concurrent_backend_writer/);
    const owner=second as any,close=owner.port.close.bind(owner.port);let closed=0;
    owner.port.close=()=>{closed++;return close();};
    await f.core.command('close',{});await second.command('close',{});
    assert.equal(closed,1);assert.equal(owner.closed,true);second=undefined;
    reopened=new BackendCore({path,privateRoot:f.profile,provider:'fixture',contentPolicy:'synthetic-only'},()=>{});
    const state=await reopened.command('snapshot',{});
    assert.deepEqual(state.conversations.map(c=>c.title),['Synthetic first writer']);
  } finally { await second?.command('close',{}).catch(()=>{});await reopened?.command('close',{});await f.close(); }
});

test('owned-authority journal failure during actual Core close still releases wake, voice, worker and SQLite',async()=>{
  const f=fixture();try{
    await f.ready();await f.run();await f.approve(await f.operation());
    const owner=f.core as any,observed:string[]=[];
    for(const [name,target,method] of [['wake',owner.velaWakeRuntime,'dispose'],['voice',owner.velaVoiceRuntime,'dispose'],['worker',owner.port,'close'],['sqlite',owner.kernel,'close']] as const){
      const original=target[method].bind(target);target[method]=(...args:unknown[])=>{observed.push(name);return original(...args);};
    }
    owner.atomic=()=>{throw Error('synthetic close journal failure');};
    await assert.rejects(f.core.command('close',{}),/synthetic close journal failure/);
    assert.deepEqual(observed,['wake','voice','worker','sqlite']);assert.equal(owner.closed,true);
    assert.throws(()=>owner.missionFileEdits.view('unused'),/mission_edit_closed/);
  }finally{await f.close();}
});

test('startup quarantines a persisted running check without rewriting its uncertain source record',async()=>{
  const f=fixture();try{
    await f.ready();await f.run();const op=await f.operation(),grant=await f.approve(op);
    await f.core.command('missionFileEditApplyNative',{operationId:op.id,authority:grant.authority});
    await f.approve(await f.operation(),'check');
    const raw=JSON.parse(String(f.db.prepare('SELECT json FROM mission_file_operations WHERE id=?').get(op.id).json));raw.check.state='running';
    (f.core as any).atomic(()=>{f.db.prepare('UPDATE mission_file_operations SET json=? WHERE id=?').run(JSON.stringify(raw),op.id);f.db.prepare('DELETE FROM mission_file_check_custody').run();});
    await f.reopen();
    assert.equal(f.db.prepare('SELECT state FROM mission_file_check_custody').get().state,'unknown');
    assert.equal((await f.operation()).verification.state,'unknown');
    assert.equal(JSON.parse(String(f.db.prepare('SELECT json FROM mission_file_operations WHERE id=?').get(op.id).json)).check.state,'running');
    await assert.rejects(f.prepare(),/mission_edit_unavailable/);assert.equal(f.checkCalls,0);
  }finally{await f.close();}
});

test('actual Core API selected-file edit binds one real user request and typed API receipt, then native Yes applies with same-resource CAS and separately reviewed check',async()=>{
  const f=fixture();try{await f.ready();const route=await f.core.command('velaRouteNative',{intent,resourceIds:[f.resourceId],resourceRefs:[f.ref()]});assert.deepEqual(route,{matched:false},'nontrivial selected-file intent belongs to the general semantic tool route');
    const desktop=await f.core.command('desktop',{type:'snapshot'}),block=desktop.blocks.find(b=>b.resource_id===f.resourceId)!;
    const selected=await f.core.command('velaRouteNative',{intent,activeCard:{workspaceId:block.workspace_id,blockId:block.id}});assert.deepEqual(selected,{matched:false},'an active card does not reintroduce a pre-AI file-edit classifier');
    const result=await f.run(),op=await f.operation();assert.equal(op.owner.kind,'api-selected-file-intent');assert.equal((op.owner as any).requestId,result.id);assert.equal(op.phase,'awaiting-native-review');assert.equal(f.bodies.length,1);assert.equal(readFileSync(f.file,'utf8'),before);
    const body=f.bodies[0],input=JSON.parse(body.input[0].content);assert.equal(body.store,false);assert.equal(body.tools,undefined);assert.equal(body.previous_response_id,undefined);assert.equal(body.text.format.type,'json_schema');assert.equal(input.inspection.kind,'native-selected-file');assert.equal(input.inspection.source.content,before);assert.ok(!JSON.stringify(body).includes(f.repo));assert.doesNotMatch(JSON.stringify(body),/read-grant|readAuthority|sourceGrantId/);
    const state=await f.state();assert.equal(state.conversation!.messages.filter(m=>m.role==='user').length,1);assert.ok(!JSON.stringify(state).includes(f.repo));assert.ok(!JSON.stringify(state).includes(before));
    const executions=Object.values((await f.core.command('snapshot',{})).executions);assert.equal(executions.length,1);assert.equal(executions[0].providerId,'openai-api-vela');assert.equal(executions[0].taskVerified,false);assert.equal(executions[0].binding,null);assert.equal(executions[0].turnId,null);
    assert.deepEqual(op.apiProvenance,{providerId:'openai-api-vela',executionId:executions[0].id,responseId:executions[0].responseId,model:'gpt-6-luna'});
    await f.core.command('desktop',{type:'createResource',kind:'note',title:'Unrelated workspace card',workspaceId:desktop.activeWorkspaceId!});
    await assert.rejects(f.core.command('missionFileEditApplyNative',{operationId:op.id,authority:'read-grant-only'}),/write_authority_required/);
    const grant=await f.approve(op),applied=await f.core.command('missionFileEditApplyNative',{operationId:op.id,authority:grant.authority});assert.equal(applied.phase,'applied');assert.equal(applied.verification.state,'not-run');assert.deepEqual(applied.source,{resourceId:f.resourceId,version:2});assert.equal(readFileSync(f.file,'utf8'),after);assert.equal(f.checkCalls,0);
    const check=await f.approve(applied,'check'),verified=await f.core.command('missionFileEditCheckRunNative',{operationId:op.id,authority:check.authority});assert.equal(verified.verification.state,'passed');assert.equal(f.checkCalls,1);assert.equal(f.db.prepare('SELECT state FROM mission_file_check_custody').get().state,'exit-observed');
    await f.reopen();assert.equal((await f.operation()).phase,'applied');assert.equal(f.bodies.length,1);assert.equal(f.db.prepare("SELECT count(*) AS n FROM mission_file_check_custody WHERE state!='exit-observed'").get().n,0);
  }finally{await f.close();}
});

test('actual Core restart revokes a pending write authority without replaying API or editing bytes',async()=>{
  const f=fixture();try{await f.ready();await f.run();const op=await f.operation(),grant=await f.approve(op);await f.reopen();assert.equal((await f.operation()).phase,'awaiting-native-review');
    await assert.rejects(f.core.command('missionFileEditApplyNative',{operationId:op.id,authority:grant.authority}),/write_authority_required/);assert.equal(readFileSync(f.file,'utf8'),before);assert.equal(f.bodies.length,1);
  }finally{await f.close();}
});

test('actual Core native No and stale/revoked source grants cannot apply; read authority is separate from write permission',async()=>{
  for(const fault of ['no','version','revoked'] as const){const f=fixture();try{await f.ready();await f.run();const op=await f.operation();
    if(fault==='no'){const review=await f.core.command('missionFileEditReviewNative',{operationId:op.id});const result=await f.core.command('missionFileEditChoiceNative',{operationId:op.id,reviewId:review.reviewId,reviewDigest:review.reviewDigest,purpose:'patch',decision:'no',nativeChoiceId:randomUUID()});assert.equal(result,null);assert.equal((await f.operation()).phase,'cancelled');}
    else{const grant=await f.approve(op);if(fault==='version')f.db.prepare('UPDATE resources SET version=version+1 WHERE id=?').run(f.resourceId);else f.db.prepare("UPDATE mission_file_read_grants SET state='revoked'").run();
      await assert.rejects(f.core.command('missionFileEditApplyNative',{operationId:op.id,authority:grant.authority}),/source_changed|scope_changed/);}
    assert.equal(readFileSync(f.file,'utf8'),before);assert.equal(f.checkCalls,0);
  }finally{await f.close();}}
});

test('changed bytes before API dispatch fail closed; resolved non-API pins are never overridden',async()=>{
  const f=fixture();try{await f.ready();const prepared=await f.prepare();writeFileSync(f.file,before+'// changed after selected read\n');
    await assert.rejects(f.core.command('missionFileEditRunNative',{requestId:prepared.requestId,reviewId:prepared.reviewId,reviewDigest:prepared.review.reviewDigest}),/source_changed/);assert.equal(f.bodies.length,0);
    const route=await f.core.command('velaRouteNative',{intent,resourceIds:[f.resourceId],settings:{providerId:'codex-app-server',mode:'codex'}});assert.deepEqual(route,{matched:false});
    await assert.rejects(f.core.command('missionFileEditPrepareNative',{intent,resourceIds:[f.resourceId],settings:{budgetLimit:0}}),/vela_budget_unverifiable/);assert.equal(f.bodies.length,0);
  }finally{await f.close();}
});

test('unknown restricted-runner transport persists startup quarantine and cannot be cleared by restart or a new edit',async()=>{
  const f=fixture();try{await f.ready();await f.run();const op=await f.operation(),grant=await f.approve(op);await f.core.command('missionFileEditApplyNative',{operationId:op.id,authority:grant.authority});
    f.execute=async()=>{throw Error('Synthetic transport lost without an exit receipt');};const check=await f.approve(await f.operation(),'check');const unknown=await f.core.command('missionFileEditCheckRunNative',{operationId:op.id,authority:check.authority});assert.equal(unknown.verification.state,'unknown');assert.equal(f.db.prepare('SELECT state FROM mission_file_check_custody').get().state,'unknown');
    await f.reopen();assert.equal(f.db.prepare('SELECT state FROM mission_file_check_custody').get().state,'unknown');await assert.rejects(f.prepare(),/mission_edit_unavailable/);assert.equal(f.bodies.length,1);assert.equal(f.checkCalls,1);
  }finally{await f.close();}
});

test('actual Core closes with a held runner, and restart preserves its durable ownership quarantine',async t=>{
  const f=fixture();let release=()=>{};try{await f.ready();await f.run();const op=await f.operation(),grant=await f.approve(op);await f.core.command('missionFileEditApplyNative',{operationId:op.id,authority:grant.authority});
    let started!:()=>void;const entered=new Promise<void>(resolve=>{started=resolve;}),held=new Promise<void>(resolve=>{release=resolve;});f.execute=async()=>{started();await held;return {exitCode:0,stdout:tap,stderr:''};};
    const check=await f.approve(await f.operation(),'check'),running=f.core.command('missionFileEditCheckRunNative',{operationId:op.id,authority:check.authority});await entered;
    const refused=assert.rejects(running,/mission_edit_closed/);
    t.diagnostic('Core shutdown with runner held: '+(await closeWhileExternalWorkIsHeld(f.core)).toFixed(1)+' ms');
    await refused;
    f.restartClosedCore();
    assert.equal(f.db.prepare('SELECT state FROM mission_file_check_custody').get().state,'unknown');await assert.rejects(f.prepare(),/mission_edit_unavailable/);
    release();await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(f.db.prepare('SELECT state FROM mission_file_check_custody').get().state,'unknown','late old-host exit cannot clear a new process fence without its owned reconciliation');
    assert.equal(f.checkCalls,1);assert.equal(f.bodies.length,1);assert.equal(readFileSync(f.file,'utf8'),after);
  }finally{release();await f.close();}
});

test('actual Core close drains an aborted API preparation before closing SQLite and never replays an unknown paid dispatch',async t=>{
  const f=fixture();try{await f.ready();f.holdApi=true;const prepared=await f.prepare(),running=f.core.command('missionFileEditRunNative',{requestId:prepared.requestId,reviewId:prepared.reviewId,reviewDigest:prepared.review.reviewDigest});
    for(let i=0;i<200&&f.bodies.length===0;i++)await new Promise(resolve=>setTimeout(resolve,5));assert.equal(f.bodies.length,1);
    const refused=assert.rejects(running);
    t.diagnostic('Core shutdown with API transport held: '+(await closeWhileExternalWorkIsHeld(f.core)).toFixed(1)+' ms');
    await refused;
    f.restartClosedCore();
    assert.equal(f.db.prepare('SELECT state FROM mission_file_requests WHERE request_id=?').get(prepared.requestId).state,'unknown');assert.equal(f.db.prepare('SELECT state FROM vela_api_runs WHERE request_id=?').get(prepared.requestId).state,'unknown');
    f.releaseApi();await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(f.bodies.length,1);assert.equal(readFileSync(f.file,'utf8'),before);assert.equal((await f.state()).missionFileEdits!.length,0);
  }finally{f.releaseApi();await f.close();}
});

test('native file access disabled on restart revokes the route even when API credentials and an earlier source grant exist',async()=>{
  const f=fixture();try{await f.ready();await f.run();const op=await f.operation();f.nativeMedia=false;await f.reopen();
    await assert.rejects(f.core.command('missionFileEditReviewNative',{operationId:op.id}),/mission_edit_native_required/);assert.equal((await f.state()).missionFileEdits!.length,0);assert.equal(readFileSync(f.file,'utf8'),before);assert.equal(f.bodies.length,1);
  }finally{await f.close();}
});
}
