import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const {PRIVATE_MISSION_FILE_EDIT_COMMANDS}=createRequire(import.meta.url)('../../visual-experience/cinematic-v3/native/mission-file-edit-broker.cjs') as {PRIVATE_MISSION_FILE_EDIT_COMMANDS:string[]};
test('actual stdio/worker transport refuses every M3 and tool host-operation private command without native authority',async()=>{
  const base=resolve(tmpdir()),dir=mkdtempSync(join(base,'aerynth-m3-private-'));
  const child=spawn(process.execPath,[fileURLToPath(new URL('../src/desktop-host.mts',import.meta.url)),join(dir,'canonical.sqlite'),dir,process.cwd()],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  let serial=0;const pending=new Map<number,{resolve(value:any):void;reject(error:Error):void;timer:ReturnType<typeof setTimeout>}>(),lines=createInterface({input:child.stdout});
  child.stderr.on('data',()=>{});const exited=new Promise<void>(resolve=>child.once('exit',()=>resolve()));
  lines.on('line',line=>{const reply=JSON.parse(line),entry=pending.get(reply.id);if(!entry)return;pending.delete(reply.id);clearTimeout(entry.timer);if(reply.error)entry.reject(Error(reply.error));else entry.resolve(reply.result);});
  const call=(command:string,input:unknown)=>new Promise<any>((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('synthetic_private_host_deadline'));},8000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,command,input})+'\n');});
  try{for(const command of [...PRIVATE_MISSION_FILE_EDIT_COMMANDS,'hostOperationReviewNative','hostOperationDispatchNative','hostOperationResultNative'])await assert.rejects(call(command,{operationId:'forged',decision:'yes',authority:'forged'}),/native_api_configuration_required/);
    const activity=await call('providerActivity',{});assert.equal(activity.providerRequests,0);assert.equal(activity.codexConnections,0);
    await call('close',{});await exited;
  }finally{child.stdin.end();if(child.exitCode===null){await Promise.race([exited,new Promise<void>(resolve=>setTimeout(resolve,2000))]);if(child.exitCode===null)child.kill();await exited;}
    lines.close();for(const entry of pending.values())clearTimeout(entry.timer);const part=relative(base,resolve(dir));assert.ok(part.startsWith('aerynth-m3-private-')&&!part.startsWith('..')&&!isAbsolute(part));rmSync(dir,{recursive:true,force:true});}
});
