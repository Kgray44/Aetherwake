import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {promisify} from 'node:util';import {execFile} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {buildWindowsSystem} from '../native/windows-system-build.mjs';
test('fixed Windows addon compiles, preserves terminal consent diagnoses, and rejects invalid HWND before OS consent',async()=>{
 const root=fileURLToPath(new URL('..',import.meta.url)),folder=await mkdtemp(path.join(tmpdir(),'aerynth-system-addon-test-'));
 try{const built=await buildWindowsSystem(root),file=path.join(folder,'fixed.node');await writeFile(file,built.binary);assert(built.binary.length<4*1024*1024);assert.equal(Object.keys(built.metadata.inputs).join('|'),'native/windows-system.cpp');
 const code="const a=require(process.argv[1]);const assert=require('node:assert/strict');assert.throws(()=>a.locate('0',Date.now()),/location_foreground_ui_required/);const b=a.battery();assert([0,1,255].includes(b.acLineStatus));assert(Number.isInteger(b.batteryLifePercent));process.stdout.write('NATIVE_BOUNDARY_OK');";
 for(const executable of [process.execPath,path.join(root,'node_modules/electron/dist/electron.exe')]){const result=await promisify(execFile)(executable,['-e',code,file],{windowsHide:true,timeout:15000,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}});assert.equal(result.stdout,'NATIVE_BOUNDARY_OK');}
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
 const script=path.join(folder,'diagnostics.cmd');await writeFile(script,`@echo off\r\ncall "${path.join(installation,'VC/Auxiliary/Build/vcvars64.bat')}" >nul && cl.exe /nologo /O2 /EHsc /std:c++20 /MT /DWIN32_LEAN_AND_MEAN "${harness}" /Fo"${path.join(folder,'diagnostics.obj')}" /Fe"${executable}" /link windowsapp.lib ole32.lib runtimeobject.lib user32.lib\r\n`);
 await execute('cmd.exe',['/d','/c',script],{cwd:folder,windowsHide:true,timeout:90000,maxBuffer:65536});
 assert.equal((await execute(executable,[],{windowsHide:true,timeout:5000})).stdout,'NATIVE_DIAGNOSTICS_OK');
 }finally{assert.equal(path.dirname(folder),path.resolve(tmpdir()));assert(path.basename(folder).startsWith('aerynth-system-addon-test-'));await rm(folder,{recursive:true,force:true});}
});
