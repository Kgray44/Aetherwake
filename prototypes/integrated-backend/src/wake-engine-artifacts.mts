import {lstat,readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {WAKE_ARTIFACT_REGISTRY} from './wake-engine-artifact-registry.mts';
export const WAKE_ENGINE_ASSET_LIMIT=64*1024*1024;
const WAKE_ENGINE_ENTRY='node_modules/sherpa-onnx-node/sherpa-onnx.js';
const fail=()=>{throw Error('wake_artifact_invalid');};
const same=(a:string,b:string)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
export async function verifyWakeArtifacts(artifactRoot:string,manifestPath:string){
  if(typeof artifactRoot!=='string'||!path.isAbsolute(artifactRoot)||typeof manifestPath!=='string'||!path.isAbsolute(manifestPath))fail();
  const root=await realpath(artifactRoot),manifest=path.resolve(manifestPath),manifestInfo=await lstat(manifest);
  const manifestRelative=path.relative(root,await realpath(manifest));
  if(!manifestInfo.isFile()||manifestInfo.isSymbolicLink()||manifestInfo.size>32768||manifestRelative.startsWith('..')||path.isAbsolute(manifestRelative))fail();
  const value=JSON.parse(await readFile(manifest,'utf8'));
  if(JSON.stringify(value)!==JSON.stringify(WAKE_ARTIFACT_REGISTRY))fail();
  let total=0;
  for(const file of WAKE_ARTIFACT_REGISTRY.files){
    if(path.isAbsolute(file.path)||file.path.split('/').some(part=>!part||part==='.'||part==='..'))fail();
    const target=path.resolve(root,...file.path.split('/')),relative=path.relative(root,target),info=await lstat(target);
    if(relative.startsWith('..')||path.isAbsolute(relative)||!info.isFile()||info.isSymbolicLink()||!same(await realpath(target),target)||info.size!==file.bytes)fail();
    total+=info.size;if(total>WAKE_ENGINE_ASSET_LIMIT)fail();
    if(createHash('sha256').update(await readFile(target)).digest('hex')!==file.sha256)fail();
  }
  // The executable entry must be one of the exact files whose size and hash passed above.
  const entry=WAKE_ARTIFACT_REGISTRY.files.find(file=>file.path===WAKE_ENGINE_ENTRY);
  if(!entry)fail();
  return {root,registry:WAKE_ARTIFACT_REGISTRY,totalBytes:total,entryPath:path.resolve(root,...entry!.path.split('/'))};
}
