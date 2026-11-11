import assert from 'node:assert/strict';
import { existsSync,mkdirSync,realpathSync,statfsSync,lstatSync } from 'node:fs';
import { basename,dirname,isAbsolute,relative,resolve,sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FileEditAdmission } from '../src/vela-file-edit.mts';
import type { NativeHostServices } from '../src/native-host.mts';

export const FIXTURE_FILE_EDIT_BYTES=64*1024*1024;
const fixtureName=/^(?:mfe-|mfec-|aerynth-tool-core-|vela-file-edit-|vela-air-inspection-|aerynth-ordinary-responses-|aerynth-frozen-history-)[a-z0-9_-]+$/iu;
const inside=(root:string,path:string)=>{const part=relative(root,path);return part!=='..'&&!part.startsWith('..'+sep)&&!isAbsolute(part);};

export function fixtureFileEditScratchRoot(): string {
  const override = process.env.AERYNTH_FIXTURE_FILE_EDIT_ROOT;
  if (override !== undefined) {
    assert.ok(isAbsolute(override), 'File-edit fixture scratch root must be absolute');
    return realpathSync.native(override);
  }
  // The override supports local worktrees under .codex, where real edit routes deny targets.
  const fallback = fileURLToPath(new URL('../.runtime/', import.meta.url));
  mkdirSync(fallback, { recursive: true });
  return realpathSync.native(fallback);
}

/** Synthetic tests only: bounded real fixture-volume admission, not the AERO host policy. */
export function ownedFileEditAdmission(roots:readonly string[],statfs:typeof statfsSync=statfsSync):FileEditAdmission {
 assert(roots.length>0&&roots.length<=4,'fixture_storage_roots_required');
 const canonical=roots.map(root=>{assert(isAbsolute(root)&&fixtureName.test(basename(root)),'fixture_storage_broad_root');const value=realpathSync.native(root);assert(lstatSync(value).isDirectory(),'fixture_storage_directory_required');return value;});
 return (targetPath,privateRoot)=>{
  for(const input of [targetPath,...(privateRoot?[privateRoot]:[])]){
   assert(isAbsolute(input),'fixture_storage_absolute_path_required');let existing=resolve(input);while(!existsSync(existing)){const parent=dirname(existing);assert(parent!==existing,'fixture_storage_path_unavailable');existing=parent;}
   const current=realpathSync.native(existing);assert(canonical.some(root=>inside(root,current)),'fixture_storage_scope_escape');
   const stats=statfs(current,{bigint:true});assert(stats.bsize*stats.bavail>=BigInt(2*FIXTURE_FILE_EDIT_BYTES),'fixture_storage_admission_denied');
  }
 };
}
export function fixtureFileEditHost(roots:readonly string[]):NativeHostServices {
 return {fileEditAdmission:ownedFileEditAdmission(roots),secrets:{available:async()=>false,seal:async()=>{throw Error('fixture_secret_unavailable');},open:async()=>{throw Error('fixture_secret_unavailable');}}};
}
