import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
const execute=promisify(execFile);
export async function buildWindowsSystem(root){
 if(process.platform!=='win32')throw Error('windows_system_build_requires_windows');
 const vswhere=path.join(process.env['ProgramFiles(x86)'],'Microsoft Visual Studio/Installer/vswhere.exe');
 const installation=(await execute(vswhere,['-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath'],{windowsHide:true,maxBuffer:8192})).stdout.trim();
 if(!installation||/["\r\n]/u.test(installation+root))throw Error('windows_system_compiler_unavailable');
 const temporary=await mkdtemp(path.join(tmpdir(),'aerynth-native-system-'));
 try{
  const source='native/windows-system.cpp',input=path.join(root,source),output=path.join(temporary,'aerynth-windows-system.node');
  const command=`call "${path.join(installation,'VC/Auxiliary/Build/vcvars64.bat')}" >nul && cl.exe /nologo /O2 /EHsc /std:c++20 /MT /LD /DNDEBUG /DWIN32_LEAN_AND_MEAN "${input}" /Fo"${path.join(temporary,'system.obj')}" /link windowsapp.lib ole32.lib runtimeobject.lib user32.lib /OUT:"${output}" /IMPLIB:"${path.join(temporary,'system.lib')}"`;
  const script=path.join(temporary,'build.cmd');await writeFile(script,'@echo off\r\n'+command+'\r\n');
  await execute('cmd.exe',['/d','/c',script],{cwd:temporary,windowsHide:true,timeout:90000,maxBuffer:65536});
  const binary=await readFile(output);if(binary.length>4*1024*1024)throw Error('windows_system_binary_capacity');
  const hash=value=>createHash('sha256').update(value).digest('hex');
  return {binary,metadata:{contract:'aerynth.private-windows-system-build@1',asset:'aerynth-windows-system.node',sha256:hash(binary),inputs:{[source]:hash(await readFile(input))}}};
 }finally{if(path.dirname(temporary)!==path.resolve(tmpdir())||!path.basename(temporary).startsWith('aerynth-native-system-'))throw Error('windows_system_cleanup_scope');await rm(temporary,{recursive:true,force:true});}
}
export function windowsSystemNative(){let root;return {name:'aerynth-private-windows-system',apply:'build',configResolved(config){root=config.root;},async generateBundle(){const {binary,metadata}=await buildWindowsSystem(root);this.emitFile({type:'asset',fileName:metadata.asset,source:binary});this.emitFile({type:'asset',fileName:'aerynth-windows-system.sources.json',source:JSON.stringify(metadata)+'\n'});}};}
