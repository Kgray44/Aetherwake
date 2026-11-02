#!/usr/bin/env node
/** Offline Windows review packaging. --plan reads only; --build is an explicit separate invocation. */
import { createHash } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { builtinModules, stripTypeScriptTypes } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';

export const LIMITS = Object.freeze({ totalBytes:1024*1024*1024, fileBytes:512*1024*1024, files:4096, manifestBytes:2*1024*1024, metadataBytes:8*1024*1024, reserveBytes:32212254720 });
const APP = 'prototypes/visual-experience/cinematic-v3';
const REQUIRED_FOLDERS = ['prototypes/integrated-backend/src','prototypes/connected-conversations/src','prototypes/codex-bridge/src','prototypes/workspace-kernel','prototypes/workspace-engine','prototypes/constellation','prototypes/application-contract','prototypes/vela-core/src','prototypes/conversation-product/src','prototypes/block-library',APP+'/src',APP+'/native'];
const OMITTED = /(?:^|\/)(?:node_modules|\.runtime|\.local-data|profiles?|test|tests|fixtures?|demo|evidence[^/]*|protocol-generated)(?:\/|$)/i;
const NON_RUNTIME_FILE = /(?:^|\/)(?:benchmark[^/]*|demo|journey|reopen|cli)\.[cm]?[jt]s$/i;
const OPTIONAL_NATIVE = /(?:^|\/)(?:integration-[^/]+|desktop-verify|application-recording|recording|presentation-metrics)\.cjs$|\/(?:test|tests)\//;
const BUILTINS = new Set([...builtinModules,...builtinModules.map(name=>'node:'+name)]);
const ELECTRON_FILES = new Set(['chrome_100_percent.pak','chrome_200_percent.pak','d3dcompiler_47.dll','dxcompiler.dll','electron.exe','electron_wer.dll','ffmpeg.dll','icudtl.dat','LICENSE','LICENSES.chromium.html','resources.pak','snapshot_blob.bin','v8_context_snapshot.bin','version','vk_swiftshader.dll','vk_swiftshader_icd.json','vulkan-1.dll']);
const json = value => JSON.stringify(value,null,2)+'\n';
const sha = value => createHash('sha256').update(value).digest('hex');
const fail = (code, detail='') => { const error=new Error(code+(detail?': '+detail:''));error.code=code;throw error; };
const check = (condition, code, detail) => {if(!condition)fail(code,detail);};
export const contained = (root, target) => {const rel=path.relative(root,target);return rel!==''&&!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel);};
const same = (a,b) => process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
const slash = value => value.replaceAll('\\','/');
const git = (root,...args) => execFileSync('git',['-C',root,...args],{encoding:'utf8',maxBuffer:8*1024*1024,env:{...process.env,GIT_OPTIONAL_LOCKS:'0'},windowsHide:true}).trim();

export function runtimeSource(name) {
  if(OMITTED.test(name)||NON_RUNTIME_FILE.test(name))return false;
  if(name.startsWith(APP+'/native/'))return false; // Actual required native files are resolved from entry points below.
  return REQUIRED_FOLDERS.some(folder=>name.startsWith(folder+'/'))&&/\.(?:ts|mts|css|sql)$/.test(name);
}
export function electronRuntimeFile(name){if(name==='resources/default_app.asar')return false;check(ELECTRON_FILES.has(name)||/^locales\/[A-Za-z0-9_-]+\.pak$/.test(name),'unexpected_Electron_runtime_file',name);return true;}
export function allocation(files, archive, generatedBytes=0) {
  check(files.length>0&&files.length<=LIMITS.files,'file_count_out_of_bounds');
  for(const file of files)check(Number.isSafeInteger(file.bytes)&&file.bytes>=0&&file.bytes<=LIMITS.fileBytes,'file_allocation_unknown_or_excessive',file.target);
  const payloadBytes=files.reduce((sum,file)=>sum+file.bytes,generatedBytes);
  const copyBound=payloadBytes+LIMITS.metadataBytes;
  // Stored ZIP: no compressor/temp copy. Allow generous local/central headers,
  // directory entries, Unicode extras, manifest/control files and filesystem allocation.
  const zipBound=archive?copyBound+files.reduce((sum,file)=>sum+1024+4*Buffer.byteLength(file.target),0)+2*1024*1024:0;
  const totalBound=copyBound+zipBound;
  check(Number.isSafeInteger(totalBound)&&totalBound<=LIMITS.totalBytes,'review_build_allocation_exceeds_1GiB');
  return {payloadBytes,copyBound,zipBound,totalBound,archiveMethod:archive?'ZIP store (no temporary compression copy)':'none'};
}
async function exists(file){try{await fs.lstat(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
async function regular(file, root) {
  const stat=await fs.lstat(file);check(stat.isFile()&&!stat.isSymbolicLink(),'not_a_regular_file',file);
  const real=await fs.realpath(file);check(contained(root,real),'source_link_escapes_root',file);return stat;
}
export async function destination(output, sourceRoot, vendorRoots=[]) {
  check(typeof output==='string'&&path.isAbsolute(output),'absolute_private_output_required');
  const absolute=path.resolve(output);check(!!path.basename(absolute)&&path.dirname(absolute)!==absolute,'output_cannot_be_a_drive_root');
  let ancestor=path.dirname(absolute),tail=[];
  while(!await exists(ancestor)){tail.unshift(path.basename(ancestor));const parent=path.dirname(ancestor);check(parent!==ancestor&&tail.length<16,'output_ancestor_unavailable');ancestor=parent;}
  const stat=await fs.lstat(ancestor);check(stat.isDirectory()&&!stat.isSymbolicLink(),'output_parent_must_be_an_existing_real_directory');
  const resolved=path.join(await fs.realpath(ancestor),...tail,path.basename(absolute));
  for(const root of [sourceRoot,...vendorRoots])check(!same(root,resolved)&&!contained(root,resolved),'output_inside_source_or_vendor');
  for(const file of [resolved,resolved+'.zip',resolved+'.zip.partial',resolved+'.zip.sha256'])check(!await exists(file),'output_already_exists',file);
  check(path.basename(resolved).length<=80,'output_leaf_too_long');return resolved;
}
async function walk(root) {
  const found=[];
  const visit=async dir=>{for(const entry of await fs.readdir(dir,{withFileTypes:true})){const full=path.join(dir,entry.name);check(!entry.isSymbolicLink(),'vendor_or_asset_symlink_forbidden',full);if(entry.isDirectory())await visit(full);else{check(entry.isFile(),'non_regular_vendor_or_asset',full);found.push(full);}check(found.length<=LIMITS.files,'file_count_out_of_bounds');}};
  await visit(root);return found;
}
/** Resolve actual Node/CJS imports without executing application modules. TS type imports disappear. */
export async function nodeClosure(root, tracked, entries) {
  const selected=new Set(),pending=[...entries],optional=[];
  while(pending.length){const name=pending.pop();if(selected.has(name))continue;check(tracked.has(name),'untracked_or_missing_runtime_import',name);selected.add(name);
    let text=await fs.readFile(path.join(root,name),'utf8');if(/\.[cm]?ts$/.test(name))text=stripTypeScriptTypes(text,{mode:'strip'});
    const patterns=[/\bimport\s+(?:[^'";]*?\s+from\s*)?['"]([^'"]+)['"]/g,/\bexport\s+(?:\*|\{[^}]*\})\s+from\s*['"]([^'"]+)['"]/g,/(?:\brequire\s*\(|\bimport\s*\(|\bnew\s+URL\s*\()\s*['"]([^'"]+)['"]/g];
    const imports=patterns.flatMap(pattern=>[...text.matchAll(pattern)].map(match=>match[1]));
    for(const spec of imports){if(spec.startsWith('node:')||BUILTINS.has(spec)||spec==='electron'&&name.startsWith(APP+'/native/'))continue;check(spec.startsWith('.'),'unbundled_runtime_dependency',spec);
      const resolved=slash(path.posix.normalize(path.posix.join(path.posix.dirname(name),spec)));check(!resolved.startsWith('../')&&!path.posix.isAbsolute(resolved),'runtime_import_escapes_repository',spec);
      if(OPTIONAL_NATIVE.test(resolved)){optional.push(resolved);continue;}check(!OMITTED.test(resolved),'fixture_or_private_runtime_import',resolved);pending.push(resolved);
    }
  }
  return {files:[...selected].sort(),excludedVerificationImports:[...new Set(optional)].sort()};
}
export function bootstrap(candidate) {
  return `/* Generated review entry. The real desktop host retains all permissions and provider identity. */
const fs=require('node:fs'),path=require('node:path');
const manifest=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../manifest.json'),'utf8'));
if(manifest.contract!=='aerynth.portable-review@1'||manifest.complete!==true)throw Error('incomplete_review_package');
if(process.argv.some(arg=>/^--(?:integration-|verify(?:=|-|$)|resume-|record(?:=|$)|soak(?:-|=|$)|benchmark(?:=|$))/.test(arg)))throw Error('verification_and_recording_modes_are_not_in_this_review_package');
const node=path.resolve(__dirname,'../../vendor/node.exe');
if(!fs.statSync(node).isFile())throw Error('bundled_node_unavailable');
process.env.AERYNTH_NODE_BIN=node;
if(!process.argv.some(arg=>arg.startsWith('--profile='))){const {app}=require('electron');process.argv.push('--profile='+path.join(app.getPath('appData'),'Aerynth','portable-review',${JSON.stringify(candidate.slice(0,12))}));}
require('./${APP}/native/desktop-main.cjs');
`;
}
export function readme(candidate, version) {
  return `Aerynth portable REVIEW build (${version})\r\nCandidate ${candidate}\r\n\r\nRun Launch-Aerynth.cmd after extracting the complete directory. No npm install, download, build, or account migration is performed by this package.\r\n\r\nThis is a Windows x64 portable review directory, not an MSI/installer, signed Aerynth distribution, production release, framework selection, or owner acceptance. Electron's vendor files/licenses are retained unchanged; their vendor signatures do not sign Aerynth. The manifest and SHA256 sidecar identify included bytes, not publisher authenticity.\r\n\r\nRequired local review-host prerequisites:\r\n- Windows x64.\r\n- The existing AeroStorageWatch ReserveGuard.ps1 at %LOCALAPPDATA%\\AeroStorageWatch\\ReserveGuard.ps1. The private host script is NOT bundled and there is no guard bypass. The actual host requires separate 30 GiB free reserves on C: and D: and fails writes/turns closed if admission is unavailable. This is monitoring, not an OS quota; unrelated writers remain outside its coverage.\r\n- Codex is optional for local work. Planning/inference requires the installed Codex CLI/account/configuration; none is bundled. Codex retains its installed identity and native instructions. Model catalogs do not establish entitlement; every turn still uses the actual host authorization boundary. No test auto-grants are included.\r\n\r\nThe bundled Node binary is used only by the actual canonical backend. Local chats, notes, workspaces and Vela use the same application/kernel/graph services. No source evidence directory, verification helper, synthetic setup, profile/database, private receipt, credentials, or node_modules development tree is included. The existing providers source contains its dormant test port implementation; normal desktop startup selects the real installed Codex path and does not seed or execute it.\r\n\r\nDefault data goes to %APPDATA%\\Aerynth\\portable-review\\${candidate.slice(0,12)}, outside this directory. An explicit --profile=<absolute external directory> is handled by the actual host. Profiles are not encrypted by this package. Keep them private; back up aerynth.sqlite while closed. Closing retains local work. Do not merge a private profile into the application directory.\r\n\r\nOnly normal application startup is packaged. Verification, record/soak, resume and integration-test flags are rejected. Native windows, GPU behavior, accessibility, restart, provider execution, performance and artistic acceptance require separate validation of THIS artifact. A byte/hash check is not those tests. If manifest.json is absent, the directory is incomplete and must not be launched. Partial outputs are preserved, never automatically deleted.\r\n`;
}
async function addFile(files, targets, origin, file, target, root) {
  check(!target.startsWith('/')&&!target.split('/').some(part=>!part||part==='..')&&!/[<>:"|?*]/.test(target),'unsafe_package_target',target);
  const key=target.toLowerCase();check(!targets.has(key),'package_target_collision',target);targets.add(key);
  const stat=await regular(file,root);files.push({origin,file,target,bytes:stat.size,mtimeMs:stat.mtimeMs,ino:stat.ino});
}
async function peX64(file){const handle=await fs.open(file,'r');try{const head=Buffer.alloc(64);await handle.read(head,0,64,0);check(head.toString('ascii',0,2)==='MZ','runtime_not_PE');const pe=Buffer.alloc(6);await handle.read(pe,0,6,head.readUInt32LE(60));check(pe.readUInt32LE(0)===0x4550&&pe.readUInt16LE(4)===0x8664,'runtime_not_Windows_x64');}finally{await handle.close();}}

export async function plan(options={}) {
  check(process.platform==='win32'&&process.arch==='x64'&&!process.versions.electron,'Windows_x64_Node_packager_required');
  check(/^v24\./.test(process.version)&&Number(process.version.split('.')[1])>=18,'Node_24_18_or_newer_24_required');
  const sourceRoot=await fs.realpath(path.resolve(options.source??path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')));
  check(same(await fs.realpath(git(sourceRoot,'rev-parse','--show-toplevel')),sourceRoot),'repository_root_required');
  const head=git(sourceRoot,'rev-parse','HEAD'),tree=git(sourceRoot,'rev-parse','HEAD^{tree}'),dirty=git(sourceRoot,'status','--porcelain=v1')!=='';
  const tracked=new Set(execFileSync('git',['-C',sourceRoot,'ls-files','-z'],{encoding:'utf8',maxBuffer:8*1024*1024,env:{...process.env,GIT_OPTIONAL_LOCKS:'0'},windowsHide:true}).split('\0').filter(Boolean));
  const app=JSON.parse(await fs.readFile(path.join(sourceRoot,APP,'package.json'),'utf8')),lock=JSON.parse(await fs.readFile(path.join(sourceRoot,APP,'package-lock.json'),'utf8'));
  const electronRoot=await fs.realpath(path.join(sourceRoot,APP,'node_modules/electron/dist')),electronVersion=(await fs.readFile(path.join(electronRoot,'version'),'utf8')).trim();
  check(electronVersion==='45.2.1'&&app.devDependencies.electron===electronVersion&&lock.packages['node_modules/electron'].version===electronVersion,'locked_Electron_runtime_mismatch');
  const node=await fs.realpath(process.execPath),nodeRoot=path.dirname(node),nodeLicense=['LICENSE','LICENSE.txt'].map(name=>path.join(nodeRoot,name));let license;for(const file of nodeLicense)if(await exists(file)){license=file;break;}check(license,'installed_Node_license_missing');
  await peX64(node);await peX64(path.join(electronRoot,'electron.exe'));
  const output=await destination(options.output,sourceRoot,[electronRoot,nodeRoot]);check(/^[CD]:\\/i.test(output),'private_output_must_be_on_C_or_D');
  const files=[],targets=new Set(),selected=[...tracked].filter(runtimeSource);
  const closure=await nodeClosure(sourceRoot,tracked,[APP+'/native/desktop-main.cjs',APP+'/native/desktop-preload.cjs','prototypes/integrated-backend/src/desktop-host.mts','prototypes/integrated-backend/src/worker.mts']);
  for(const file of closure.files)if(!selected.includes(file))selected.push(file);
  const packages=new Set(REQUIRED_FOLDERS.map(folder=>folder.endsWith('/src')?folder.slice(0,-4):folder));
  for(const folder of packages)for(const name of ['package.json','package-lock.json'])if(tracked.has(folder+'/'+name))selected.push(folder+'/'+name);
  for(const file of [...new Set(selected)].sort())await addFile(files,targets,'repository:'+file,path.join(sourceRoot,file),'resources/app/'+file,sourceRoot);
  for(const file of ['package.json','package-lock.json'])if(tracked.has(file))await addFile(files,targets,'repository:'+file,path.join(sourceRoot,file),'resources/app/source-metadata/'+file,sourceRoot);
  const dist=await fs.realpath(path.join(sourceRoot,APP,'dist'));check(await exists(path.join(dist,'index.html'))&&await exists(path.join(dist,'assets')),'built_application_dist_missing');
  for(const file of await walk(dist)){const relative=slash(path.relative(dist,file));check(!OMITTED.test(relative)&&/\.(?:html|js|css|png|svg|jpg|jpeg|woff2?|ico|txt)$/.test(relative),'unexpected_dist_payload',relative);const canonicalAsset=APP+'/public/'+relative;check(!/\.(?:png|svg|jpe?g|woff2?|ico)$/.test(relative)||tracked.has(canonicalAsset),'unreviewed_static_asset_origin',relative);await addFile(files,targets,'built-dist:'+relative,file,'resources/app/'+APP+'/dist/'+relative,dist);if(tracked.has(canonicalAsset))files.at(-1).canonicalAsset=canonicalAsset;}
  for(const file of await walk(electronRoot)){const relative=slash(path.relative(electronRoot,file));if(!electronRuntimeFile(relative))continue;await addFile(files,targets,'electron-runtime:'+relative,file,relative==='electron.exe'?'AerynthReview.exe':relative,electronRoot);}
  await addFile(files,targets,'node-runtime:node.exe',node,'vendor/node.exe',nodeRoot);await addFile(files,targets,'node-runtime:LICENSE',license,'vendor/node-LICENSE.txt',nodeRoot);
  check(Object.keys(app.dependencies??{}).every(name=>name==='three'),'unreviewed_frontend_dependency_license');
  const threeRoot=await fs.realpath(path.join(sourceRoot,APP,'node_modules/three'));await addFile(files,targets,'frontend-license:three',path.join(threeRoot,'LICENSE'),'licenses/three-LICENSE.txt',threeRoot);
  for(const name of ['LICENSE','LICENSES.chromium.html'])check(files.some(file=>file.target===name),'Electron_vendor_license_missing',name);
  const generated=[{target:'resources/app/package.json',content:json({name:'aerynth-portable-review',version:app.version,private:true,type:'module',main:'portable-review-bootstrap.cjs'})},{target:'resources/app/portable-review-bootstrap.cjs',content:bootstrap(head)},{target:'README-portable-review.txt',content:readme(head,app.version)},{target:'Launch-Aerynth.cmd',content:'@echo off\r\nsetlocal\r\nset "ELECTRON_RUN_AS_NODE="\r\n"%~dp0AerynthReview.exe" %*\r\nexit /b %ERRORLEVEL%\r\n'}];
  for(const file of generated){check(!targets.has(file.target.toLowerCase()),'generated_target_collision');targets.add(file.target.toLowerCase());}
  const bytes=allocation(files,!!options.archive,generated.reduce((sum,file)=>sum+Buffer.byteLength(file.content),0)),main=await fs.readFile(path.join(sourceRoot,APP,'native/desktop-main.cjs'),'utf8');
  const hostNodeSeam=/backendExecutable\s*\(\s*process\.env\.AERYNTH_NODE_BIN\s*\)/.test(main)||/spawn\s*\(\s*process\.env\.AERYNTH_NODE_BIN/.test(main);
  const tar=path.join(process.env.SystemRoot??'C:\\Windows','System32/tar.exe');check(!options.archive||await exists(tar),'system_tar_unavailable');
  const guard=path.join(process.env.LOCALAPPDATA??'','AeroStorageWatch/ReserveGuard.ps1');check(path.isAbsolute(guard)&&await exists(guard),'ReserveGuard_unavailable');
  const drive=path.parse(output).root[0].toUpperCase(),blockers=[...(dirty?['source_worktree_not_clean']:[]),...(!hostNodeSeam?['bundled_Node_host_seam_missing']:[])];
  return {contract:'aerynth.review-build-plan@1',sourceRoot,vendorRoots:[electronRoot,nodeRoot],output,head,tree,version:app.version,runtimes:{electron:electronVersion,node:process.version,platform:process.platform,arch:process.arch},files:files.sort((a,b)=>a.target.localeCompare(b.target)),generated,closure,bytes,archive:!!options.archive,tar,guard,drive,blockers,externalPrerequisites:['installed AeroStorageWatch ReserveGuard.ps1; separate30GiB C/D reserves','installed Codex only for explicitly authorized model features'],excluded:['private runtime/profile/data/credentials/receipts','historical visual evidence/assets not used by dist','tests/fixtures/synthetic setup and verification/recording entry points','node_modules development trees'],rootPackagePresent:tracked.has('package.json')};
}
export function summary(plan) {return {contract:plan.contract,candidate:{head:plan.head,tree:plan.tree,clean:!plan.blockers.includes('source_worktree_not_clean')},runtimes:plan.runtimes,output:plan.output,fileCount:plan.files.length,generatedCount:plan.generated.length,bytes:plan.bytes,estimatedCBytes:plan.drive==='C'?plan.bytes.totalBound:0,estimatedDBytes:plan.drive==='D'?plan.bytes.totalBound:0,blockers:plan.blockers,externalPrerequisites:plan.externalPrerequisites,excluded:plan.excluded,archive:plan.archive,sourceFolders:REQUIRED_FOLDERS};}
export function reserve(plan, remaining=plan.bytes.totalBound) {
  check(Number.isSafeInteger(remaining)&&remaining>=0&&remaining<=LIMITS.totalBytes,'invalid_remaining_allocation');
  const c=plan.drive==='C'?remaining:0,d=plan.drive==='D'?remaining:0;
  const output=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',plan.guard,'-EstimatedCBytes',String(c),'-EstimatedDBytes',String(d)],{encoding:'utf8',maxBuffer:64*1024,windowsHide:true});
  const value=JSON.parse(output.trim());check(value.allowed===true&&value.floorBytesEach>=LIMITS.reserveBytes,'storage_reserve_admission_denied');
  return {allowed:true,floorBytesEach:LIMITS.reserveBytes,estimatedCBytes:c,estimatedDBytes:d,coverage:'Instruction/check, not an OS quota; external/unloaded writers are not controlled.'};
}
async function hashFile(file){const digest=createHash('sha256');for await(const chunk of createReadStream(file))digest.update(chunk);return digest.digest('hex');}
async function copyBounded(file,target,progress=()=>{}){
  const source=await fs.open(file.file,'r');let destination;
  try{
    const before=await source.stat();check(before.size===file.bytes&&before.mtimeMs===file.mtimeMs&&before.ino===file.ino,'input_changed_since_plan',file.origin);
    destination=await fs.open(target,'wx');const buffer=Buffer.alloc(1024*1024),digest=createHash('sha256');let copied=0;
    while(copied<file.bytes){progress(copied);const {bytesRead}=await source.read(buffer,0,Math.min(buffer.length,file.bytes-copied),copied);check(bytesRead>0,'input_shrank_during_copy',file.origin);let written=0;while(written<bytesRead){const value=await destination.write(buffer,written,bytesRead-written,copied+written);check(value.bytesWritten>0,'short_package_write');written+=value.bytesWritten;}digest.update(buffer.subarray(0,bytesRead));copied+=bytesRead;}
    const extra=await source.read(buffer,0,1,file.bytes),after=await source.stat();check(extra.bytesRead===0&&after.size===before.size&&after.mtimeMs===before.mtimeMs,'input_changed_during_copy',file.origin);return digest.digest('hex');
  }finally{await destination?.close();await source.close();}
}
async function writeExclusive(root, relative, content){const target=path.join(root,relative);check(contained(root,target),'write_outside_owned_output');await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,content,{flag:'wx'});return {path:relative,bytes:Buffer.byteLength(content),sha256:sha(content)};}
async function archive(plan, manifestBytes) {
  reserve(plan,plan.bytes.zipBound);const partial=plan.output+'.zip.partial',final=plan.output+'.zip';const exclusive=await fs.open(partial,'wx');await exclusive.close();
  const expected=[...plan.files.map(f=>f.target),...plan.generated.map(f=>f.target),'manifest.json','manifest.sha256'].map(name=>path.basename(plan.output)+'/'+name).sort();
  let stderr='',guardError;const child=spawn(plan.tar,['-c','--format=zip','--options','zip:compression=store','-f',partial,'-C',path.dirname(plan.output),'--null','-T','-'],{windowsHide:true,stdio:['pipe','ignore','pipe']});
  child.stdin.on('error',error=>{if(error.code!=='EPIPE'){guardError=error;child.kill();}});child.stdin.end(expected.map(name=>'./'+name).join('\0')+'\0');
  child.stderr.on('data',chunk=>{stderr+=chunk.toString();if(stderr.length>16384){guardError=new Error('archive_diagnostic_limit');child.kill();}});
  const timer=setInterval(()=>{try{const size=statSync(partial).size;check(size<=plan.bytes.zipBound,'archive_bound_exceeded');reserve(plan,Math.max(0,plan.bytes.zipBound-size));}catch(error){guardError=error;child.kill();}},240000);
  try{await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0&&!guardError?resolve():reject(guardError??new Error('archive_failed: '+stderr.slice(0,2048))));});}finally{clearInterval(timer);}
  const stat=await fs.stat(partial);check(stat.size<=plan.bytes.zipBound,'archive_bound_exceeded');
  const listed=execFileSync(plan.tar,['-tf',partial],{encoding:'utf8',maxBuffer:4*1024*1024,windowsHide:true}).trim().split(/\r?\n/).map(name=>slash(name).replace(/^\.\//,'')).filter(name=>name&&!name.endsWith('/'));
  check(json(listed.sort())===json(expected),'archive_inventory_mismatch');
  const archiveSha256=await hashFile(partial);reserve(plan,1024*1024);await fs.link(partial,final);await fs.unlink(partial);await fs.writeFile(final+'.sha256',archiveSha256+'  '+path.basename(final)+'\n',{flag:'wx'});
  return {file:path.basename(final),bytes:stat.size,sha256:archiveSha256,manifestSha256:sha(manifestBytes),method:'system libarchive ZIP store'};
}
export async function build(plan) {
  check(plan.blockers.length===0,'plan_has_blockers',plan.blockers.join(','));
  check(git(plan.sourceRoot,'rev-parse','HEAD')===plan.head&&git(plan.sourceRoot,'rev-parse','HEAD^{tree}')===plan.tree&&git(plan.sourceRoot,'status','--porcelain=v1')==='','source_changed_since_plan');
  const firstAdmission=reserve(plan);check(same(await destination(plan.output,plan.sourceRoot,plan.vendorRoots),plan.output),'output_path_changed_since_plan');await fs.mkdir(path.dirname(plan.output),{recursive:true});await fs.mkdir(plan.output);
  let copied=0,lastGuard=Date.now();const files=[];
  const admit=(partial=0)=>{if(Date.now()-lastGuard>=240000){reserve(plan,Math.max(0,plan.bytes.totalBound-copied-partial));lastGuard=Date.now();}};
  for(const file of plan.files){admit();
    const before=await fs.lstat(file.file);check(before.isFile()&&!before.isSymbolicLink()&&before.size===file.bytes&&before.mtimeMs===file.mtimeMs&&before.ino===file.ino,'input_changed_since_plan',file.origin);
    const target=path.join(plan.output,file.target);check(contained(plan.output,target),'copy_outside_owned_output');await fs.mkdir(path.dirname(target),{recursive:true});const parent=await fs.realpath(path.dirname(target));check(same(plan.output,parent)||contained(plan.output,parent),'output_parent_link_escapes_owned_directory');const sourceSha256=await copyBounded(file,target,admit),copiedSha256=await hashFile(target);check(sourceSha256===copiedSha256,'copied_bytes_mismatch',file.origin);if(file.canonicalAsset)check(await hashFile(path.join(plan.sourceRoot,file.canonicalAsset))===copiedSha256,'original_public_asset_changed_in_dist',file.canonicalAsset);copied+=file.bytes;files.push({path:file.target,origin:file.origin,bytes:file.bytes,sha256:copiedSha256,...(file.canonicalAsset?{originalAsset:file.canonicalAsset,originalBytesPreserved:true}:{})});
  }
  for(const file of plan.generated){admit();const entry=await writeExclusive(plan.output,file.target,file.content);files.push({...entry,origin:'generated-review-bootstrap'});copied+=entry.bytes;}
  // The native host hashes these folders at startup; each exists in the portable layout.
  for(const folder of REQUIRED_FOLDERS)await fs.mkdir(path.join(plan.output,'resources/app',folder),{recursive:true});
  check(git(plan.sourceRoot,'rev-parse','HEAD')===plan.head&&git(plan.sourceRoot,'status','--porcelain=v1')==='','source_changed_during_copy');
  const sourceHashes=Object.fromEntries(files.filter(f=>f.origin.startsWith('repository:')).map(f=>[f.origin.slice(11),f.sha256]));
  const buildAssets=Object.fromEntries(files.filter(f=>f.origin.startsWith('built-dist:')).map(f=>[f.origin.slice(11),f.sha256]));
  const manifest={contract:'aerynth.portable-review@1',complete:true,createdAt:new Date().toISOString(),candidate:{head:plan.head,tree:plan.tree,clean:true},runtimes:plan.runtimes,sourceHashes,buildAssets,files:files.sort((a,b)=>a.path.localeCompare(b.path)),licenses:['LICENSE','LICENSES.chromium.html','vendor/node-LICENSE.txt','licenses/three-LICENSE.txt'],bounds:plan.bytes,reserve:firstAdmission,externalPrerequisites:plan.externalPrerequisites,exclusions:plan.excluded,acceptance:'Byte-preserving offline packaging only; no native/provider/performance/production acceptance is inferred.',buildProvenance:'Existing dist bytes are bound; packaging does not rebuild or independently prove their source compilation.'};
  const bytes=json(manifest);check(Buffer.byteLength(bytes)<=LIMITS.manifestBytes,'manifest_size_exceeded');admit();await writeExclusive(plan.output,'manifest.json',bytes);await writeExclusive(plan.output,'manifest.sha256',sha(bytes)+'  manifest.json\n');
  const zip=plan.archive?await archive(plan,bytes):null;return {contract:'aerynth.review-build-result@1',candidate:manifest.candidate,files:files.length,payloadBytes:copied,manifestSha256:sha(bytes),archive:zip,output:plan.output,acceptance:manifest.acceptance};
}
export function argumentsFor(args){
  const options={},seen=new Set();for(const argument of args){const key=argument.split('=')[0];check(!seen.has(key),'duplicate_argument',key);seen.add(key);if(argument==='--plan'||argument==='--build'){check(!options.mode,'plan_and_build_are_mutually_exclusive');options.mode=argument.slice(2);}else if(argument==='--archive')options.archive=true;else if(argument.startsWith('--source='))options.source=argument.slice(9);else if(argument.startsWith('--output='))options.output=argument.slice(9);else fail('unknown_argument',argument);}
  check(options.mode&&options.output,'usage','--plan|--build --output=<absolute NEW private directory> [--source=<repository>] [--archive]');
  return options;
}
export async function main(args=process.argv.slice(2)) {
  const options=argumentsFor(args);
  const value=await plan(options);if(options.mode==='plan'){const admission=reserve(value);process.stdout.write(json({...summary(value),reserve:admission,copiesPerformed:false}));return;}
  process.stdout.write(json(await build(value)));
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{process.stderr.write(json({error:error.code??'review_build_failed',message:error.message,partialOutputs:'Preserved. No recursive cleanup or overwrite is performed.'}));process.exitCode=1;});
