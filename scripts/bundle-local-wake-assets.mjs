/** Copies only the approved standalone runtime/model closure. Never downloads or runs npm. */
import {mkdir,lstat,copyFile,writeFile} from 'node:fs/promises';import {constants} from 'node:fs';import path from 'node:path';import {homedir} from 'node:os';import {execFileSync} from 'node:child_process';import {pathToFileURL} from 'node:url';
import {verifyWakeArtifacts} from '../prototypes/integrated-backend/src/wake-engine-artifacts.mts';import {WAKE_ARTIFACT_REGISTRY} from '../prototypes/integrated-backend/src/wake-engine-artifact-registry.mts';
export async function bundleLocalWakeAssets(sourceRoot,destination,{copy=false}={}){
  if(!path.isAbsolute(sourceRoot)||!path.isAbsolute(destination)||path.parse(destination).root.toUpperCase()!=='C:\\')throw Error('absolute_owned_C_asset_bundle_required');
  const source=await verifyWakeArtifacts(sourceRoot,path.join(sourceRoot,'wake-model-manifest.json'));
  if(await lstat(destination).then(()=>true).catch(error=>{if(error.code==='ENOENT')return false;throw error;}))throw Error('new_asset_bundle_directory_required');
  const estimatedCBytes=source.totalBytes+Buffer.byteLength(JSON.stringify(WAKE_ARTIFACT_REGISTRY))+65536;
  if(estimatedCBytes>64*1024*1024)throw Error('wake_asset_bundle_bound');
  if(!copy)return {contract:'aerynth.local-wake-bundle-plan@1',files:WAKE_ARTIFACT_REGISTRY.files.length,estimatedCBytes,estimatedDBytes:0};
  const guard=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-File',path.join(homedir(),'AppData/Local/AeroStorageWatch/ReserveGuard.ps1'),'-EstimatedCBytes',String(estimatedCBytes),'-EstimatedDBytes','0'],{encoding:'utf8',windowsHide:true,maxBuffer:8192,timeout:10000}));if(!guard.allowed)throw Error('storage_reserve_admission_denied');
  await mkdir(destination,{recursive:true});
  for(const file of WAKE_ARTIFACT_REGISTRY.files){const target=path.join(destination,file.path);await mkdir(path.dirname(target),{recursive:true});await copyFile(path.join(source.root,file.path),target,constants.COPYFILE_EXCL);}
  await writeFile(path.join(destination,'wake-model-manifest.json'),JSON.stringify(WAKE_ARTIFACT_REGISTRY),{flag:'wx'});
  await verifyWakeArtifacts(destination,path.join(destination,'wake-model-manifest.json'));
  return {contract:'aerynth.local-wake-bundle@1',destination,files:WAKE_ARTIFACT_REGISTRY.files.length,bytes:source.totalBytes,licenses:WAKE_ARTIFACT_REGISTRY.runtimeLicenses,modelLicense:WAKE_ARTIFACT_REGISTRY.modelLicense,reserve:guard};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const [source,destination,flag]=process.argv.slice(2);if(flag!==undefined&&flag!=='--copy')throw Error('explicit_copy_flag_required');console.log(JSON.stringify(await bundleLocalWakeAssets(source,destination,{copy:flag==='--copy'})));}
