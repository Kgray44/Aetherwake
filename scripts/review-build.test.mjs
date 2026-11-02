import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import vm from 'node:vm';
import { LIMITS, contained, runtimeSource, electronRuntimeFile, allocation, destination, nodeClosure, bootstrap, readme, argumentsFor } from './review-build.mjs';

async function fixture(work){const dir=await fs.mkdtemp(path.join(tmpdir(),'aerynth-review-packager-'));try{return await work(dir);}finally{const rel=path.relative(path.resolve(tmpdir()),path.resolve(dir));assert(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel)&&path.basename(dir).startsWith('aerynth-review-packager-'));await fs.rm(dir,{recursive:true,force:true});}}

test('runtime selection excludes profiles, historical evidence, synthetic setup and developer entries',()=>{
 for(const name of ['prototypes/integrated-backend/src/core.mts','prototypes/conversation-product/src/contracts.ts','prototypes/workspace-kernel/migrations/003-block-subjects.sql','prototypes/visual-experience/cinematic-v3/src/application.ts'])assert(runtimeSource(name),name);
 for(const name of ['prototypes/vela-core/test/native-live.cjs','prototypes/integrated-backend/src/demo.mts','prototypes/integrated-backend/src/journey.mts','prototypes/block-library/benchmark-scale.mts','prototypes/connected-conversations/src/cli.ts','prototypes/workspace-engine/tests/engine.test.mts','prototypes/block-library/evidence-scale/baseline.json','prototypes/visual-experience/cinematic-v3/.runtime/secret.ts','prototypes/codex-bridge/protocol-generated/v2/Account.ts'])assert.equal(runtimeSource(name),false,name);
});
test('allocation is bounded before any copy and stored ZIP accounts for both directory and archive',()=>{
 const files=[{target:'a.exe',bytes:374000000},{target:'vendor/node.exe',bytes:93000000}];const plan=allocation(files,true,4096);assert(plan.copyBound>467000000);assert(plan.totalBound>plan.copyBound+467000000);assert(plan.totalBound<LIMITS.totalBytes);assert.equal(allocation(files,false).zipBound,0);
 assert.throws(()=>allocation([{target:'unknown',bytes:undefined}],true),/unknown/);assert.throws(()=>allocation([{target:'large',bytes:LIMITS.fileBytes+1}],false),/excessive/);assert.throws(()=>allocation([{target:'a',bytes:LIMITS.fileBytes},{target:'b',bytes:LIMITS.fileBytes}],true),/1GiB/);
});
test('locked Electron runtime inventory cannot silently pick up local data or a developer default app',()=>{
 for(const file of ['electron.exe','LICENSE','LICENSES.chromium.html','locales/en-US.pak'])assert(electronRuntimeFile(file));assert.equal(electronRuntimeFile('resources/default_app.asar'),false);for(const file of ['resources/private.sqlite','profile.json','.runtime/trace.log','credentials.txt'])assert.throws(()=>electronRuntimeFile(file),/unexpected_Electron_runtime_file/);
});
test('CLI mode and destinations require an explicit new private custody path',async()=>{
 assert.deepEqual(argumentsFor(['--plan','--output=C:\\Private\\review','--archive']),{mode:'plan',output:'C:\\Private\\review',archive:true});
 assert.throws(()=>argumentsFor(['--plan','--build','--output=x']),/mutually_exclusive/);assert.throws(()=>argumentsFor(['--build','--output=x','--output=y']),/duplicate/);assert.throws(()=>argumentsFor(['--plan','--output=x','--guard=custom']),/unknown_argument/);
 await fixture(async dir=>{const source=path.join(dir,'source'),vendor=path.join(dir,'vendor'),target=path.join(dir,'new','review');await fs.mkdir(source);await fs.mkdir(vendor);assert.equal(await destination(target,source,[vendor]),target);assert.equal(await fs.stat(source).then(s=>s.isDirectory()),true);await assert.rejects(destination(path.join(source,'release'),source,[vendor]),/inside_source/);await assert.rejects(destination(path.join(vendor,'release'),source,[vendor]),/inside_source/);await fs.writeFile(target+'.zip','owned prior artifact').catch(async error=>{if(error.code!=='ENOENT')throw error;await fs.mkdir(path.dirname(target));await fs.writeFile(target+'.zip','owned prior artifact');});await assert.rejects(destination(target,source,[vendor]),/already_exists/);assert.equal(await fs.readFile(target+'.zip','utf8'),'owned prior artifact');});
});
test('Node runtime closure removes type-only dependencies and follows real workers/imports without executing them',async()=>{
 await fixture(async root=>{
  const data={'entry.mts':"import type { T } from 'uninstalled-types';\nimport { value } from './dep.mts';\nimport { Worker } from 'node:worker_threads';\nexport function run(){ return value; }\nnew Worker(new URL('./worker.mts',import.meta.url));\n",'dep.mts':'export const value:number=1;','worker.mts':"import './dep.mts';"};for(const[name,text]of Object.entries(data))await fs.writeFile(path.join(root,name),text);
  const traced=await nodeClosure(root,new Set(Object.keys(data)),['entry.mts']);assert.deepEqual(traced.files,['dep.mts','entry.mts','worker.mts']);
  await fs.writeFile(path.join(root,'dep.mts'),"import 'unbundled-dependency';");await assert.rejects(nodeClosure(root,new Set(Object.keys(data)),['entry.mts']),/unbundled_runtime_dependency/);
  await fs.writeFile(path.join(root,'dep.mts'),"import '../outside.mts';");await assert.rejects(nodeClosure(root,new Set(Object.keys(data)),['entry.mts']),/escapes_repository/);
 });
});
test('verification helpers are excluded explicitly while new actual native host seams remain required',async()=>{
 await fixture(async root=>{
  const base='prototypes/visual-experience/cinematic-v3/native/',files={[base+'desktop-main.cjs']:"require('electron'); require('./backend-executable.cjs'); if(process.argv.includes('--integration-live'))require('./desktop-verify.cjs');",[base+'backend-executable.cjs']:"const fs=require('node:fs');module.exports={};"};for(const[name,text]of Object.entries(files)){await fs.mkdir(path.dirname(path.join(root,name)),{recursive:true});await fs.writeFile(path.join(root,name),text);}const result=await nodeClosure(root,new Set(Object.keys(files)),[base+'desktop-main.cjs']);assert.deepEqual(result.files,[base+'backend-executable.cjs',base+'desktop-main.cjs']);assert.deepEqual(result.excludedVerificationImports,[base+'desktop-verify.cjs']);
 });
});
test('portable bootstrap compiles, preserves the real entry and blocks all verification/auto-grant routes',()=>{
 const text=bootstrap('a'.repeat(40));new vm.Script(text);assert(text.includes('process.env.AERYNTH_NODE_BIN=node'));assert(text.includes("require('./prototypes/visual-experience/cinematic-v3/native/desktop-main.cjs')"));assert(text.includes('manifest.complete!==true'));assert(text.includes('portable-review'));assert(text.includes('verification_and_recording_modes_are_not_in_this_review_package'));
 const help=readme('a'.repeat(40),'0.4.0');assert(help.includes('not an MSI/installer'));assert(help.includes('ReserveGuard.ps1'));assert(help.includes('No test auto-grants'));assert(help.includes('none is bundled'));assert(!/C:\\Users\\/.test(help));assert.equal(contained(path.resolve('/private'),path.resolve('/private-other')),false);
});
