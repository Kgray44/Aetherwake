import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {promisify} from 'node:util';import {execFile} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {buildWindowsSystem} from '../native/windows-system-build.mjs';
test('fixed Windows addon reads real memory/process facts, preserves consent diagnoses and rejects an unissued reclaim',{
 skip:process.platform!=='win32'&&'requires Windows, MSVC, and the Electron executable',
},async t=>{
 const root=fileURLToPath(new URL('..',import.meta.url)),folder=await mkdtemp(path.join(tmpdir(),'aerynth-system-addon-test-'));
 try{const built=await buildWindowsSystem(root),file=path.join(folder,'fixed.node');await writeFile(file,built.binary);assert(built.binary.length<4*1024*1024);assert.equal(Object.keys(built.metadata.inputs).join('|'),'native/windows-system.cpp|native/windows-computer.inc');t.diagnostic('Compiled asset '+built.binary.length+' bytes; measured post-compile temporary outputs '+built.allocation.postCompileTemporaryBytes+' bytes; no trim performed.');
 const code=`const a=require(process.argv[1]);const assert=require('node:assert/strict');
 const requireInteractive=process.env.AERYNTH_WINDOWS_INTERACTIVE_QA==='1';
 const unavailable=new Set(['computer_secure_desktop','computer_admin_denied']);
 const unissued='00000000-0000-4000-8000-000000000000';
 let stage='location';
 (async()=>{
   assert.throws(()=>a.locate('0',Date.now()),/location_foreground_ui_required/);
   stage='battery';
   const battery=a.battery();
   assert([0,1,255].includes(battery.acLineStatus));
   assert(Number.isInteger(battery.batteryLifePercent));
   stage='memory-snapshot';
   const memory=JSON.parse(await a.memorySnapshot());
   assert(memory.physicalTotalBytes>0&&memory.physicalAvailableBytes<=memory.physicalTotalBytes);
   assert.equal(memory.systemCommitHeadroomBytes,memory.systemCommitLimitBytes-memory.systemCommitBytes);
   stage='memory-inspect';
   const inspection=JSON.parse(await a.memoryInspect(1,String(process.pid)));
   assert(inspection.scanned>0&&inspection.scanned<=1024);
   assert(Array.isArray(inspection.processes)&&inspection.processes.length<=1);
   if(requireInteractive)assert.equal(inspection.processes.length,1);
   assert(inspection.processes.every(p=>Number.isSafeInteger(p.workingSetBytes)&&Number.isSafeInteger(p.privateCommitBytes)));
   stage='memory-reclaim';
   // An unissued reference is rejected before HWND validation or any OS trim.
   await assert.rejects(a.memoryReclaim(unissued,'0',String(process.pid),inspection.generation),e=>e==='memory_snapshot_expired');
   stage='computer-discovery';
   for(const name of ['computerDiscover','computerObserve','computerWindow','computerControl','computerLaunch','computerRevoke'])assert.equal(typeof a[name],'function');
   let outcome='electron-node-mode';
   if(!process.versions.electron){
     let discovery;
     try { discovery=JSON.parse(await a.computerDiscover()); }
     catch(error){ if(requireInteractive||!unavailable.has(error))throw error; outcome=error; }
     if(discovery){
       outcome='catalog-observed';
       assert.equal(discovery.catalogScope,'start-menu-shortcuts');
       assert(Array.isArray(discovery.windows)&&discovery.windows.length<=64);
       assert(Array.isArray(discovery.applications)&&discovery.applications.length<=256);
       assert(discovery.virtualBounds.width>0&&discovery.virtualBounds.height>0);
       assert(discovery.windows.every(w=>typeof w.identity.creation==='string'&&typeof w.identity.hwnd==='string'));
       if(requireInteractive)assert(discovery.windows.length>0&&discovery.applications.length>0);
     }
   }
   stage='unissued-computer-operations';
   await assert.rejects(a.computerObserve(unissued));
   await assert.rejects(a.computerLaunch(unissued));
   stage='computer-revocation';
   const pendingDiscovery=a.computerDiscover();
   a.computerRevoke();
   await assert.rejects(pendingDiscovery,e=>e==='computer_permission_revoked');
   stage='memory-revocation';
   const pendingMemory=a.memorySnapshot();
   a.memoryRevoke();
   await assert.rejects(pendingMemory,e=>e==='memory_permission_revoked');
   process.stdout.write('NATIVE_BOUNDARY_OK '+outcome);
 })().catch(error=>{
   const reason=typeof error==='string'&&/^(?:memory|computer)_[a-z_]+$/.test(error)?error:'assertion-or-unexpected-error';
   process.stderr.write('NATIVE_BOUNDARY_FAILED '+stage+' '+reason);process.exitCode=1;
 });`;
 for(const executable of [process.execPath,path.join(root,'node_modules/electron/dist/electron.exe')]){
  const result=await promisify(execFile)(executable,['-e',code,file],{windowsHide:true,timeout:15000,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}});
  assert.match(result.stdout,/^NATIVE_BOUNDARY_OK (catalog-observed|computer_secure_desktop|computer_admin_denied|electron-node-mode)$/);
  t.diagnostic(result.stdout);
 }
 // Compile the production helper functions in this same translation unit; no Geolocator or consent API is invoked.
 const production=path.join(root,'native/windows-system.cpp').replaceAll('\\','/');assert(!/["\r\n]/u.test(production+folder));
 const harness=path.join(folder,'diagnostics.cpp'),executable=path.join(folder,'diagnostics.exe');
 await writeFile(harness,`#include "${production}"
#include <cassert>
#include <iostream>
struct TerminalOperation {
 AsyncStatus state; HRESULT error=0; mutable bool canceled=false; mutable int reads=0;
 AsyncStatus wait_for(std::chrono::seconds) const{return state;}
 void Cancel() const{canceled=true;}
 int GetResults() const{reads++;if(error)throw winrt::hresult_error(error);return 7;}
};
static std::string diagnostic(const TerminalOperation& operation){
 try{assert(completedLocationOperation(operation,std::chrono::seconds(0),"location_permission_timeout")==7);return "allowed";}
 catch(const LocationFailure& error){return error.code;}
 catch(const winrt::hresult_error& error){return locationError(error.code(),"location_native_consent_unavailable");}
}
int main(){
 assert(consentDecision(GeolocationAccessStatus::Allowed)==nullptr);
 assert(std::string(consentDecision(GeolocationAccessStatus::Denied))=="location_os_denied");
 assert(std::string(consentDecision(GeolocationAccessStatus::Unspecified))=="location_permission_unspecified");
 TerminalOperation completed{AsyncStatus::Completed};assert(diagnostic(completed)=="allowed"&&completed.reads==1);
 TerminalOperation denied{AsyncStatus::Error,E_ACCESSDENIED};assert(diagnostic(denied)=="location_os_denied"&&denied.reads==1&&!denied.canceled);
 TerminalOperation failed{AsyncStatus::Error,E_FAIL};assert(diagnostic(failed)=="location_native_consent_unavailable"&&failed.reads==1&&!failed.canceled);
 TerminalOperation canceled{AsyncStatus::Canceled};assert(diagnostic(canceled)=="location_cancelled"&&canceled.reads==0&&!canceled.canceled);
 TerminalOperation canceledError{AsyncStatus::Error,HRESULT_FROM_WIN32(ERROR_CANCELLED)};assert(diagnostic(canceledError)=="location_cancelled"&&canceledError.reads==1);
 TerminalOperation aborted{AsyncStatus::Error,E_ABORT};assert(diagnostic(aborted)=="location_cancelled"&&aborted.reads==1);
 TerminalOperation timeout{AsyncStatus::Started};assert(diagnostic(timeout)=="location_permission_timeout"&&timeout.reads==0&&timeout.canceled);
 std::cout<<"NATIVE_DIAGNOSTICS_OK";
}
`);
 const execute=promisify(execFile),vswhere=path.join(process.env['ProgramFiles(x86)'],'Microsoft Visual Studio/Installer/vswhere.exe');
 const installation=(await execute(vswhere,['-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath'],{windowsHide:true,maxBuffer:8192})).stdout.trim();assert(installation&&!/["\r\n]/u.test(installation));
 const script=path.join(folder,'diagnostics.cmd');await writeFile(script,`@echo off\r\ncall "${path.join(installation,'VC/Auxiliary/Build/vcvars64.bat')}" >nul && cl.exe /nologo /Od /EHsc /std:c++20 /MT /DPSAPI_VERSION=2 /DWIN32_LEAN_AND_MEAN "${harness}" /Fo"${path.join(folder,'diagnostics.obj')}" /Fe"${executable}" /link windowsapp.lib ole32.lib runtimeobject.lib user32.lib advapi32.lib uiautomationcore.lib oleaut32.lib shell32.lib uuid.lib bcrypt.lib\r\n`);
 await execute('cmd.exe',['/d','/c',script],{cwd:folder,windowsHide:true,timeout:90000,maxBuffer:65536});
 assert.equal((await execute(executable,[],{windowsHide:true,timeout:5000})).stdout,'NATIVE_DIAGNOSTICS_OK');
 }finally{assert.equal(path.dirname(folder),path.resolve(tmpdir()));assert(path.basename(folder).startsWith('aerynth-system-addon-test-'));await rm(folder,{recursive:true,force:true});}
});
