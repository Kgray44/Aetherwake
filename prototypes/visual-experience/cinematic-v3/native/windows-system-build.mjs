import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,writeFile,rm,readdir,stat} from 'node:fs/promises';
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
  const sources=['native/windows-system.cpp','native/windows-computer.inc'],hash=value=>createHash('sha256').update(value).digest('hex');
  const inputs=Object.fromEntries(await Promise.all(sources.map(async source=>[source,hash(await readFile(path.join(root,source)))])));
  const input=path.join(root,sources[0]),output=path.join(temporary,'aerynth-windows-system.node');
  const command=`call "${path.join(installation,'VC/Auxiliary/Build/vcvars64.bat')}" >nul && cl.exe /nologo /O2 /EHsc /std:c++20 /MT /LD /DNDEBUG /DPSAPI_VERSION=2 /DWIN32_LEAN_AND_MEAN "${input}" /Fo"${path.join(temporary,'system.obj')}" /link windowsapp.lib ole32.lib runtimeobject.lib user32.lib advapi32.lib uiautomationcore.lib oleaut32.lib shell32.lib uuid.lib bcrypt.lib /OUT:"${output}" /IMPLIB:"${path.join(temporary,'system.lib')}"`;
  const script=path.join(temporary,'build.cmd');await writeFile(script,'@echo off\r\n'+command+'\r\n');
  await execute('cmd.exe',['/d','/c',script],{cwd:temporary,windowsHide:true,timeout:90000,maxBuffer:65536});
  const outputBytes=(await Promise.all((await readdir(temporary)).map(async name=>(await stat(path.join(temporary,name))).size))).reduce((sum,size)=>sum+size,0);
  if(outputBytes>96*1024*1024)throw Error('windows_system_temporary_capacity');
  const binary=await readFile(output);if(binary.length>4*1024*1024)throw Error('windows_system_binary_capacity');
  for(const source of sources)if(inputs[source]!==hash(await readFile(path.join(root,source))))throw Error('windows_system_source_changed_during_build');
  return {binary,allocation:{postCompileTemporaryBytes:outputBytes,estimateBytes:128*1024*1024},metadata:{contract:'aerynth.private-windows-system-build@1',asset:'aerynth-windows-system.node',sha256:hash(binary),inputs}};
 }finally{if(path.dirname(temporary)!==path.resolve(tmpdir())||!path.basename(temporary).startsWith('aerynth-native-system-'))throw Error('windows_system_cleanup_scope');await rm(temporary,{recursive:true,force:true});}
}
export function windowsSystemNative(){let root;return {name:'aerynth-private-windows-system',apply:'build',configResolved(config){root=config.root;},async generateBundle(){const {binary,metadata}=await buildWindowsSystem(root);this.emitFile({type:'asset',fileName:metadata.asset,source:binary});this.emitFile({type:'asset',fileName:'aerynth-windows-system.sources.json',source:JSON.stringify(metadata)+'\n'});}};}
