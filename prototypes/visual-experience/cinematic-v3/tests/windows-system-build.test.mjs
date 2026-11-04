import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {promisify} from 'node:util';import {execFile} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {buildWindowsSystem} from '../native/windows-system-build.mjs';
test('fixed Windows addon actually compiles and loads in Node and Electron; invalid HWND rejects before any OS consent',async()=>{
 const root=fileURLToPath(new URL('..',import.meta.url)),folder=await mkdtemp(path.join(tmpdir(),'aerynth-system-addon-test-'));
 try{const built=await buildWindowsSystem(root),file=path.join(folder,'fixed.node');await writeFile(file,built.binary);assert(built.binary.length<4*1024*1024);assert.equal(Object.keys(built.metadata.inputs).join('|'),'native/windows-system.cpp');
 const code="const a=require(process.argv[1]);const assert=require('node:assert/strict');assert.throws(()=>a.locate('0',Date.now()),/location_foreground_ui_required/);const b=a.battery();assert([0,1,255].includes(b.acLineStatus));assert(Number.isInteger(b.batteryLifePercent));process.stdout.write('NATIVE_BOUNDARY_OK');";
 for(const executable of [process.execPath,path.join(root,'node_modules/electron/dist/electron.exe')]){const result=await promisify(execFile)(executable,['-e',code,file],{windowsHide:true,timeout:15000,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}});assert.equal(result.stdout,'NATIVE_BOUNDARY_OK');}
 }finally{assert.equal(path.dirname(folder),path.resolve(tmpdir()));assert(path.basename(folder).startsWith('aerynth-system-addon-test-'));await rm(folder,{recursive:true,force:true});}
});
