#!/usr/bin/env node
/** Offline Windows review packaging. --plan reads only; --build is an explicit separate invocation. */
import { createHash } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { builtinModules, stripTypeScriptTypes } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { readRendererReceipt, rendererReceiptName } from './review-renderer.mjs';

export const LIMITS = Object.freeze({ totalBytes:1024*1024*1024, fileBytes:512*1024*1024, files:4096, manifestBytes:2*1024*1024, metadataBytes:8*1024*1024, reserveBytes:32212254720 });
const APP = 'prototypes/visual-experience/cinematic-v3';
const BLOCKS = 'prototypes/block-library';
const OPENAI = 'prototypes/openai-provider';
const OPENAI_SOURCE = new Set(['auth.mts','common.mts','contracts.mts','responses.mts','model-controls.ts','native-storage.mts','loopback.mts','api-connection-contracts.mts','api-connections.mts','live-contracts.mts','live.mts','live-usage.mts'].map(name=>OPENAI+'/'+name));
export const JOSE_RUNTIME = Object.freeze({name:'jose',version:'6.2.15',integrity:'sha512-qdF6ewcZARtef63fJ9AKKZPgxw+t7USH6HLXYcD4CrdmSvDp79rpJSPFEKc90QBeGS63u1KQtN2MZQHC0yDIzA==',resolved:'https://registry.npmjs.org/jose/-/jose-6.2.15.tgz',importer:OPENAI+'/auth.mts',entry:'dist/webapi/index.js',files:128,bytes:1024*1024,tarBytes:2*1024*1024});
// BrowserWindow preload paths are loaded by Electron, not Node imports. Keep
// both trusted preload entry points explicit in the runtime dependency closure.
// Validate the lazy auth entry even while its default/native-disabled path does not load it.
export const NATIVE_RUNTIME_ENTRIES = Object.freeze([APP+'/native/desktop-main.cjs', APP+'/native/desktop-preload.cjs', APP+'/native/vela-review-preload.cjs', APP+'/native/voice-media.html',
  APP+'/native/document-text.html',APP+'/native/document-extraction-broker.cjs',
  APP+'/native/wake-media-broker.cjs',APP+'/native/wake-media.html',APP+'/native/wake-pcm-worklet.js',
  APP+'/native/windows-system-broker.cjs',APP+'/native/windows-system.cpp',
  'prototypes/integrated-backend/src/desktop-host.mts', 'prototypes/integrated-backend/src/worker.mts',JOSE_RUNTIME.importer]);
const REQUIRED_FOLDERS = ['prototypes/integrated-backend/src','prototypes/connected-conversations/src','prototypes/codex-bridge/src','prototypes/workspace-kernel','prototypes/workspace-engine','prototypes/constellation','prototypes/application-contract','prototypes/vela-core/src','prototypes/conversation-product/src','prototypes/block-library','prototypes/agent-product','prototypes/checklist-product','prototypes/timer-product','prototypes/timeline-product','prototypes/task-product',OPENAI,APP+'/src',APP+'/native'];
const OMITTED = /(?:^|\/)(?:node_modules|\.runtime|\.local-data|profiles?|test|tests|fixtures?|demo|evidence[^/]*|protocol-generated)(?:\/|$)/i;
const NON_RUNTIME_FILE = /(?:^|\/)(?:benchmark[^/]*|prepare-[^/]*native[^/]*|demo|journey|reopen|cli)\.[cm]?[jt]s$/i;
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
  if(name.startsWith(OPENAI+'/'))return OPENAI_SOURCE.has(name);
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
function importsOf(text){const patterns=[/\bimport\s+(?:[^'";]*?\s+from\s*)?['"]([^'"]+)['"]/g,/\bexport\s+(?:\*|\{[^}]*\})\s+from\s*['"]([^'"]+)['"]/g,/(?:\brequire\s*\(|\bimport\s*\(|\bnew\s+URL\s*\()\s*['"]([^'"]+)['"]/g];return patterns.flatMap(pattern=>[...text.matchAll(pattern)].map(match=>match[1]));}
/** Only the authenticated, already-owned cached tarball is parsed; nothing is extracted. */
function lockedTar(gzip){check(gzip.length<=JOSE_RUNTIME.bytes,'jose_tarball_size_exceeded');check('sha512-'+createHash('sha512').update(gzip).digest('base64')===JOSE_RUNTIME.integrity,'jose_tarball_integrity_mismatch');const tar=gunzipSync(gzip,{maxOutputLength:JOSE_RUNTIME.tarBytes}),files=new Map();let offset=0;
 const field=(header,start,length)=>header.subarray(start,start+length).toString('utf8').split('\0')[0];
 const octal=value=>{const clean=value.replaceAll('\0','').trim();check(/^[0-7]+$/.test(clean),'unsupported_jose_tar_header');return Number.parseInt(clean,8);};
 while(offset+512<=tar.length){const header=tar.subarray(offset,offset+512);if(header.every(byte=>byte===0)){check(tar.subarray(offset).every(byte=>byte===0)&&tar.length-offset>=1024,'invalid_jose_tar_end');return files;}
  const checksum=octal(field(header,148,8)),sum=header.reduce((value,byte,index)=>value+(index>=148&&index<156?32:byte),0);check(checksum===sum,'invalid_jose_tar_checksum');const prefix=field(header,345,155),name=(prefix?prefix+'/':'')+field(header,0,100),bytes=octal(field(header,124,12));check(header[156]===48||header[156]===0,'unsupported_jose_tar_entry');check(name.startsWith('package/')&&!name.includes('\\'),'unsafe_jose_tar_path');const relative=name.slice(8);check(relative&&path.posix.normalize(relative)===relative&&!relative.startsWith('../')&&!path.posix.isAbsolute(relative)&&!files.has(relative),'unsafe_jose_tar_path');check(Number.isSafeInteger(bytes)&&bytes>=0&&bytes<=JOSE_RUNTIME.bytes&&offset+512+bytes<=tar.length,'jose_tar_entry_size_exceeded');files.set(relative,tar.subarray(offset+512,offset+512+bytes));check(files.size<=JOSE_RUNTIME.files,'jose_file_count_exceeded');offset+=512+Math.ceil(bytes/512)*512;
 }fail('invalid_jose_tar_end');
}
/** Single explicitly approved npm package; never a generic node_modules copier. */
export async function joseRuntime(root,tracked){
 const metadata=[OPENAI+'/package.json',OPENAI+'/package-lock.json'];for(const name of metadata)check(tracked.has(name),'jose_tracked_lock_required',name);
 const bounded=async(file,base,max=JOSE_RUNTIME.bytes)=>{const stat=await regular(file,base);check(stat.size<=max,'jose_file_size_exceeded');return fs.readFile(file);};
 const provider=JSON.parse(await bounded(path.join(root,metadata[0]),root,65536)),lock=JSON.parse(await bounded(path.join(root,metadata[1]),root,65536)),pin=lock.packages?.['node_modules/jose'];
 check(provider.private===true&&provider.type==='module'&&Object.keys(provider.dependencies??{}).length===1&&Object.keys(provider.optionalDependencies??{}).length===0&&provider.dependencies.jose===JOSE_RUNTIME.version&&lock.name===provider.name&&lock.version===provider.version&&lock.lockfileVersion===3&&Object.keys(lock.packages??{}).sort().join('|')==='|node_modules/jose'&&lock.packages[''].name===provider.name&&lock.packages[''].version===provider.version&&lock.packages[''].dependencies?.jose===JOSE_RUNTIME.version&&Object.keys(lock.packages[''].dependencies??{}).length===1&&pin?.version===JOSE_RUNTIME.version&&pin.integrity===JOSE_RUNTIME.integrity&&pin.resolved===JOSE_RUNTIME.resolved&&pin.license==='MIT','locked_jose_metadata_mismatch');
 const lexical=path.join(root,OPENAI,'node_modules/jose'),stat=await fs.lstat(lexical);check(stat.isDirectory()&&!stat.isSymbolicLink(),'jose_vendor_root_must_be_local_real_directory');const vendorRoot=await fs.realpath(lexical);check(contained(root,vendorRoot)&&same(path.resolve(lexical),vendorRoot),'jose_vendor_escapes_local_module');
 const digest=Buffer.from(JOSE_RUNTIME.integrity.slice(7),'base64').toString('hex'),cacheLexical=path.join(root,OPENAI,'.runtime/npm-cache/_cacache/content-v2/sha512'),cache=path.join(cacheLexical,digest.slice(0,2),digest.slice(2,4),digest.slice(4));check(await exists(cache),'jose_owned_tarball_proof_missing');const cacheRoot=await fs.realpath(cacheLexical);check(contained(root,cacheRoot)&&same(path.resolve(cacheLexical),cacheRoot),'jose_cache_escapes_local_module');const archive=lockedTar(await bounded(cache,cacheRoot));
 const installed=new Map();let entries=0,total=0;const visit=async(dir,depth)=>{check(depth<=8,'jose_directory_depth_exceeded');for await(const entry of await fs.opendir(dir)){check(++entries<=256,'jose_inventory_entries_exceeded');const full=path.join(dir,entry.name),s=await fs.lstat(full);check(!s.isSymbolicLink(),'jose_vendor_symlink_forbidden');if(s.isDirectory())await visit(full,depth+1);else{check(s.isFile(),'jose_vendor_regular_file_required');const relative=slash(path.relative(vendorRoot,full));check(archive.has(relative),'unexpected_jose_installed_file',relative);total+=s.size;check(total<=JOSE_RUNTIME.bytes&&installed.size<JOSE_RUNTIME.files,'jose_inventory_bound_exceeded');const bytes=await bounded(full,vendorRoot);check(sha(bytes)===sha(archive.get(relative)),'jose_installed_tarball_bytes_mismatch',relative);installed.set(relative,{file:full,bytes:bytes.length,sha256:sha(bytes)});}}};await visit(vendorRoot,0);check(installed.size===archive.size&&[...archive.keys()].every(name=>installed.has(name)),'jose_installed_inventory_mismatch');
 const pkg=JSON.parse(archive.get('package.json'));check(pkg.name==='jose'&&pkg.version===JOSE_RUNTIME.version&&pkg.license==='MIT'&&pkg.type==='module'&&pkg.main==='./'+JOSE_RUNTIME.entry&&pkg.exports?.['.']?.default==='./'+JOSE_RUNTIME.entry&&['dependencies','optionalDependencies','peerDependencies'].every(key=>Object.keys(pkg[key]??{}).length===0)&&!pkg.bundleDependencies&&!pkg.bundledDependencies,'unsupported_jose_package_metadata');check(archive.get('LICENSE.md')?.toString('utf8').startsWith('The MIT License (MIT)'),'jose_dependency_license_missing');
 const selected=new Set(['package.json','LICENSE.md']),pending=[JOSE_RUNTIME.entry];while(pending.length){const name=pending.pop();if(selected.has(name))continue;check(/^dist\/webapi\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.js$/.test(name)&&installed.has(name),'jose_runtime_import_not_allowlisted',name);selected.add(name);for(const spec of importsOf(archive.get(name).toString('utf8'))){if(BUILTINS.has(spec))continue;check(spec.startsWith('.'),'jose_unreviewed_runtime_dependency',spec);const resolved=path.posix.normalize(path.posix.join(path.posix.dirname(name),spec));check(resolved.startsWith('dist/webapi/'),'jose_runtime_import_escape',spec);pending.push(resolved);}}
 const files=[...selected].sort().map(relative=>({...installed.get(relative),relative,target:'resources/app/'+OPENAI+'/node_modules/jose/'+relative,origin:'npm-runtime:jose@'+JOSE_RUNTIME.version+'/'+relative}));return {root:vendorRoot,files,metadata:{name:'jose',version:JOSE_RUNTIME.version,license:'MIT',lockfile:metadata[1],integrity:JOSE_RUNTIME.integrity,resolved:JOSE_RUNTIME.resolved,tarballSRIverified:true,installedInventoryVerified:true,installedFiles:installed.size,runtimeFiles:files.length,runtimeBytes:files.reduce((sum,file)=>sum+file.bytes,0),licensePath:'resources/app/'+OPENAI+'/node_modules/jose/LICENSE.md',inventorySha256:sha(json(files.map(({relative,bytes,sha256})=>({relative,bytes,sha256}))))}};
}
export async function nodeClosure(root, tracked, entries) {
  const selected=new Set(),pending=[...entries],optional=[];let jose=null;
  while(pending.length){const name=pending.pop();if(selected.has(name))continue;check(tracked.has(name),'untracked_or_missing_runtime_import',name);selected.add(name);
    let text=await fs.readFile(path.join(root,name),'utf8');if(/\.[cm]?ts$/.test(name))text=stripTypeScriptTypes(text,{mode:'strip'});
    for(const spec of name.endsWith('.html')?[]:importsOf(text)){if(spec.startsWith('node:')||BUILTINS.has(spec)||spec==='electron'&&name.startsWith(APP+'/native/'))continue;if(spec==='jose'&&name===JOSE_RUNTIME.importer){jose??=await joseRuntime(root,tracked);continue;}check(spec.startsWith('.'),'unbundled_runtime_dependency',spec);
      const resolved=slash(path.posix.normalize(path.posix.join(path.posix.dirname(name),spec)));check(!resolved.startsWith('../')&&!path.posix.isAbsolute(resolved),'runtime_import_escapes_repository',spec);
      if(OPTIONAL_NATIVE.test(resolved)){optional.push(resolved);continue;}check(!OMITTED.test(resolved)&&!NON_RUNTIME_FILE.test(resolved),'fixture_or_private_runtime_import',resolved);check(!resolved.startsWith(OPENAI+'/')||OPENAI_SOURCE.has(resolved),'unreviewed_openai_runtime_source',resolved);pending.push(resolved);
    }
  }
  return {files:[...selected].sort(),excludedVerificationImports:[...new Set(optional)].sort(),vendorFiles:jose?.files??[],vendors:jose?[jose.metadata]:[],vendorRoots:jose?[jose.root]:[]};
}
/** The only additional executable dist file is the isolated, receipt-bound voice preload. */
export async function validateLiveMediaPreload(root,dist,tracked,assets){
  const preload='vela-live-media-preload.cjs',metadata='vela-live-media-preload.sources.json';
  check(Object.hasOwn(assets,preload)&&Object.hasOwn(assets,metadata),'live_media_preload_receipt_missing');
  const source=await fs.readFile(path.join(dist,metadata));check(source.length<=16384,'live_media_preload_metadata_bound');
  const value=JSON.parse(source),required=['src/gpt-live-media.ts','src/gpt-live-native-media.ts','src/wake-live-input.ts'];
  check(value?.contract==='aerynth.private-live-media-build@1'&&value.asset===preload&&value.sha256===assets[preload]&&
    Object.keys(value).sort().join('|')==='asset|contract|inputs|sha256'&&value.inputs&&Object.keys(value.inputs).sort().join('|')===required.sort().join('|'),'live_media_preload_source_binding_invalid');
  for(const relative of required){const file=APP+'/'+relative;check(tracked.has(file)&&value.inputs[relative]===await hashFile(path.join(root,file)),'live_media_preload_source_changed',relative);}
  return new Set([preload,metadata]);
}
export async function validateDocumentTextAssets(root,dist,tracked,assets){
  const names=['vela-document-text-preload.cjs','vela-document-text-worker.js','vela-document-pdf.worker.js'],receipt='vela-document-text.sources.json';
  check([...names,receipt].every(name=>Object.hasOwn(assets,name)),'document_text_receipt_missing');const bytes=await fs.readFile(path.join(dist,receipt));check(bytes.length<=512*1024,'document_text_metadata_capacity');const value=JSON.parse(bytes);
  const required=[APP+'/src/document-text-preload.ts',APP+'/src/document-text-worker.ts',BLOCKS+'/media-docx-parser.ts',BLOCKS+'/media-pdf.ts',BLOCKS+'/media-policy.ts','prototypes/application-contract/media.ts'].sort();
  check(value?.contract==='aerynth.private-document-text-build@1'&&Object.keys(value).sort().join('|')==='assets|contract|dependencyLock|inputs|licenses|vendorInputs'&&value.assets&&Object.keys(value.assets).sort().join('|')===[...names].sort().join('|')&&names.every(name=>value.assets[name]===assets[name])&&value.inputs&&Object.keys(value.inputs).sort().join('|')===required.join('|'),'document_text_source_binding_invalid');
  for(const file of required)check(tracked.has(file)&&value.inputs[file]===await hashFile(path.join(root,file)),'document_text_source_changed',file);
  const lock=BLOCKS+'/package-lock.json';check(tracked.has(lock)&&value.dependencyLock?.source===lock&&value.dependencyLock.sha256===await hashFile(path.join(root,lock)),'document_text_dependency_lock_changed');const packages=JSON.parse(await fs.readFile(path.join(root,lock),'utf8')).packages;
  const vendor=value.vendorInputs;check(vendor&&typeof vendor==='object'&&!Array.isArray(vendor)&&Object.keys(vendor).length>0&&Object.keys(vendor).length<=512,'document_text_vendor_capacity');
  for(const [file,digest] of Object.entries(vendor)){check(file.startsWith(BLOCKS+'/node_modules/')&&!file.includes('\\')&&!file.split('/').some(part=>!part||part==='..'||part==='.')&&/\.(?:js|mjs|json)$/.test(file)&&/^[a-f0-9]{64}$/.test(digest),'document_text_vendor_path_invalid');
    const absolute=path.join(root,file),actual=await fs.realpath(absolute),stat=await fs.lstat(absolute);check(stat.isFile()&&!stat.isSymbolicLink()&&same(path.resolve(absolute),actual)&&contained(root,actual)&&stat.size<=8*1024*1024&&digest===await hashFile(actual),'document_text_vendor_changed',file);
    const relative=file.slice((BLOCKS+'/').length),parts=relative.split('/'),owner=parts[1].startsWith('@')?parts.slice(0,3).join('/'):parts.slice(0,2).join('/'),pin=packages?.[owner];check(pin?.version&&typeof pin.integrity==='string','document_text_vendor_unlocked',owner);
  }
  check(vendor[BLOCKS+'/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs']===assets[names[2]],'document_text_pdf_worker_changed');
  check(value.licenses&&Object.keys(value.licenses).sort().join('|')==='fflate|mammoth|pdfjs-dist','document_text_license_missing');
  for(const name of ['fflate','mammoth','pdfjs-dist']){const base=path.join(root,BLOCKS,'node_modules',name),pkg=JSON.parse(await fs.readFile(path.join(base,'package.json'),'utf8')),entry=value.licenses[name];let license;for(const file of ['LICENSE','LICENSE.md','LICENSE.txt'])try{license=await fs.readFile(path.join(base,file),'utf8');break;}catch{}
    check(entry?.version===packages['node_modules/'+name]?.version&&entry.version===pkg.version&&entry.license===pkg.license&&typeof license==='string'&&entry.text===license,'document_text_license_changed',name);}
  return new Set([...names,receipt]);
}
export async function validateWakeCapturePreload(root,dist,tracked,assets){
  const preload='vela-wake-capture-preload.cjs',metadata='vela-wake-capture-preload.sources.json',worklet='vela-wake-pcm-worklet.js';
  check([preload,metadata,worklet].every(name=>Object.hasOwn(assets,name)),'wake_capture_preload_receipt_missing');
  const source=await fs.readFile(path.join(dist,metadata));check(source.length<=16384,'wake_capture_preload_metadata_bound');
  const value=JSON.parse(source),required=['src/wake-audio-capture.ts','src/wake-native-capture.ts'];
  check(value?.contract==='aerynth.private-wake-capture-build@1'&&value.asset===preload&&value.sha256===assets[preload]&&
    Object.keys(value).sort().join('|')==='asset|contract|inputs|sha256|worklet'&&value.inputs&&Object.keys(value.inputs).sort().join('|')===required.join('|')&&
    value.worklet&&Object.keys(value.worklet).sort().join('|')==='asset|sha256|source'&&value.worklet.asset===worklet&&
    value.worklet.source==='native/wake-pcm-worklet.js'&&value.worklet.sha256===assets[worklet],'wake_capture_preload_source_binding_invalid');
  for(const relative of [...required,value.worklet.source]){
    const file=APP+'/'+relative,expected=relative===value.worklet.source?value.worklet.sha256:value.inputs[relative];
    check(tracked.has(file)&&expected===await hashFile(path.join(root,file)),'wake_capture_preload_source_changed',relative);
  }
  return new Set([preload,metadata,worklet]);
}
export async function validateWindowsSystemNative(root,dist,tracked,assets){
  const asset='aerynth-windows-system.node',metadata='aerynth-windows-system.sources.json',source='native/windows-system.cpp';
  check([asset,metadata].every(name=>Object.hasOwn(assets,name)),'windows_system_receipt_missing');
  const raw=await fs.readFile(path.join(dist,metadata));check(raw.length<=16384,'windows_system_metadata_bound');const value=JSON.parse(raw);
  check(value?.contract==='aerynth.private-windows-system-build@1'&&value.asset===asset&&value.sha256===assets[asset]&&Object.keys(value).sort().join('|')==='asset|contract|inputs|sha256'&&value.inputs&&Object.keys(value.inputs).join('|')===source,'windows_system_source_binding_invalid');
  check(tracked.has(APP+'/'+source)&&value.inputs[source]===await hashFile(path.join(root,APP,source)),'windows_system_source_changed');
  check((await fs.stat(path.join(dist,asset))).size<=4*1024*1024,'windows_system_binary_capacity');
  return new Set([asset,metadata]);
}
export async function validateWakeHostCore(root,dist,tracked,assets){
  const asset='vela-wake-host.cjs',metadata='vela-wake-host.sources.json',required=['prototypes/integrated-backend/src/native-wake-controller.mts','prototypes/integrated-backend/src/wake-audio-buffer.mts','prototypes/integrated-backend/src/wake-capture-host.mts'];
  check([asset,metadata].every(name=>Object.hasOwn(assets,name)),'wake_host_receipt_missing');const raw=await fs.readFile(path.join(dist,metadata));check(raw.length<=16384,'wake_host_metadata_bound');const value=JSON.parse(raw);
  check(value?.contract==='aerynth.private-wake-host-build@1'&&value.asset===asset&&value.sha256===assets[asset]&&Object.keys(value).sort().join('|')==='asset|contract|inputs|sha256'&&value.inputs&&Object.keys(value.inputs).sort().join('|')===required.join('|'),'wake_host_source_binding_invalid');
  for(const file of required)check(tracked.has(file)&&value.inputs[file]===await hashFile(path.join(root,file)),'wake_host_source_changed',file);
  check((await fs.stat(path.join(dist,asset))).size<=262144,'wake_host_asset_capacity');return new Set([asset,metadata]);
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
  return `Aerynth portable REVIEW build (${version})\r\nCandidate ${candidate}\r\n\r\nRun Launch-Aerynth.cmd after extracting the complete directory. No npm install, download, build, or account migration is performed by this package.\r\n\r\nThis is a Windows x64 portable review directory, not an MSI/installer, signed Aerynth distribution, production release, framework selection, or owner acceptance. Electron's vendor files/licenses are retained unchanged; their vendor signatures do not sign Aerynth. The manifest and SHA256 sidecar identify included bytes, not publisher authenticity.\r\n\r\nRequired local review-host prerequisites:\r\n- Windows x64.\r\n- The existing AeroStorageWatch ReserveGuard.ps1 at %LOCALAPPDATA%\\AeroStorageWatch\\ReserveGuard.ps1. The private host script is NOT bundled and there is no guard bypass. The actual host requires separate 30 GiB free reserves on C: and D: and fails writes/turns closed if admission is unavailable. This is monitoring, not an OS quota; unrelated writers remain outside its coverage.\r\n- Codex is optional for local work. Planning/inference requires the installed Codex CLI/account/configuration; none is bundled. Codex retains its installed identity and native instructions. Model catalogs do not establish entitlement; every turn still uses the actual host authorization boundary. No test auto-grants are included.\r\n\r\nThe bundled Node binary is used only by the actual canonical backend. Local chats, notes, workspaces and Vela use the same application/kernel/graph services. No source evidence directory, verification helper, synthetic setup, profile/database, private receipt, credentials, or node_modules development tree is included. The sole node_modules exception is the exact locked jose@6.2.15 runtime required by native auth, including its package metadata and MIT dependency license. Its bytes are checked against the existing SRI-authenticated npm tarball and individually hashed in the manifest. That dependency license does not change Aerynth's proprietary status. Auth source and the dependency being present do not prove successful OS protection, account consent or inference. The existing providers source contains its dormant test port implementation; normal desktop startup selects the real installed Codex path and does not seed or execute it.\r\n\r\nDefault data goes to %APPDATA%\\Aerynth\\portable-review\\${candidate.slice(0,12)}, outside this directory. An explicit --profile=<absolute external directory> is handled by the actual host. Profile-wide encryption is not added by this package; auth credential envelopes require the actual native host's available OS protection. Keep them private; back up aerynth.sqlite while closed. Closing retains local work. Do not merge a private profile into the application directory.\r\n\r\nOnly normal application startup is packaged. Verification, record/soak, resume and integration-test flags are rejected. Native windows, GPU behavior, accessibility, restart, provider execution, performance and artistic acceptance require separate validation of THIS artifact. A byte/hash check is not those tests. If manifest.json is absent, the directory is incomplete and must not be launched. Partial outputs are preserved, never automatically deleted.\r\n`;
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
  const closure=await nodeClosure(sourceRoot,tracked,NATIVE_RUNTIME_ENTRIES);
  for(const file of closure.files)if(!selected.includes(file))selected.push(file);
  const packages=new Set(REQUIRED_FOLDERS.map(folder=>folder.endsWith('/src')?folder.slice(0,-4):folder));
  for(const folder of packages)for(const name of ['package.json','package-lock.json'])if(tracked.has(folder+'/'+name))selected.push(folder+'/'+name);
  for(const file of [...new Set(selected)].sort())await addFile(files,targets,'repository:'+file,path.join(sourceRoot,file),'resources/app/'+file,sourceRoot);
  for(const file of closure.vendorFiles){await addFile(files,targets,file.origin,file.file,file.target,closure.vendorRoots[0]);files.at(-1).expectedSha256=file.sha256;}
  for(const file of ['package.json','package-lock.json'])if(tracked.has(file))await addFile(files,targets,'repository:'+file,path.join(sourceRoot,file),'resources/app/source-metadata/'+file,sourceRoot);
  const dist=await fs.realpath(path.join(sourceRoot,APP,'dist'));check(await exists(path.join(dist,'index.html'))&&await exists(path.join(dist,'assets')),'built_application_dist_missing');
  const rendererFiles=(await walk(dist)).filter(file=>file!==path.join(dist,rendererReceiptName));
  const rendererReceipt=await readRendererReceipt(dist,{head,tree},rendererFiles.map(file=>slash(path.relative(dist,file))));
  const privatePreload=await validateLiveMediaPreload(sourceRoot,dist,tracked,rendererReceipt.assets);
  for(const file of await validateDocumentTextAssets(sourceRoot,dist,tracked,rendererReceipt.assets))privatePreload.add(file);
  for(const file of await validateWakeCapturePreload(sourceRoot,dist,tracked,rendererReceipt.assets))privatePreload.add(file);
  for(const file of await validateWindowsSystemNative(sourceRoot,dist,tracked,rendererReceipt.assets))privatePreload.add(file);
  for(const file of await validateWakeHostCore(sourceRoot,dist,tracked,rendererReceipt.assets))privatePreload.add(file);
  const pdfWorker=path.join(sourceRoot,BLOCKS,'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
  for(const file of rendererFiles){
    const relative=slash(path.relative(dist,file)),worker=/^assets\/pdf\.worker-[A-Za-z0-9_-]+\.mjs$/.test(relative);
    check(!OMITTED.test(relative)&&(worker||privatePreload.has(relative)||/\.(?:html|js|css|png|svg|jpg|jpeg|woff2?|ico|txt)$/.test(relative)),'unexpected_dist_payload',relative);
    const canonicalAsset=APP+'/public/'+relative;
    check(!/\.(?:png|svg|jpe?g|woff2?|ico)$/.test(relative)||tracked.has(canonicalAsset),'unreviewed_static_asset_origin',relative);
    await addFile(files,targets,'built-dist:'+relative,file,'resources/app/'+APP+'/dist/'+relative,dist);
    const expected=rendererReceipt.assets[relative];
    files.at(-1).expectedSha256=expected;
    if(tracked.has(canonicalAsset))files.at(-1).canonicalAsset=canonicalAsset;
    if(worker)check(expected===await hashFile(pdfWorker),'unexpected_pdf_worker_bytes');
  }
  for(const file of await walk(electronRoot)){const relative=slash(path.relative(electronRoot,file));if(!electronRuntimeFile(relative))continue;await addFile(files,targets,'electron-runtime:'+relative,file,relative==='electron.exe'?'AerynthReview.exe':relative,electronRoot);}
  await addFile(files,targets,'node-runtime:node.exe',node,'vendor/node.exe',nodeRoot);await addFile(files,targets,'node-runtime:LICENSE',license,'vendor/node-LICENSE.txt',nodeRoot);
  check(Object.keys(app.dependencies??{}).every(name=>name==='three'),'unreviewed_frontend_dependency_license');
  const threeRoot=await fs.realpath(path.join(sourceRoot,APP,'node_modules/three'));await addFile(files,targets,'frontend-license:three',path.join(threeRoot,'LICENSE'),'licenses/three-LICENSE.txt',threeRoot);
  const mediaLock=JSON.parse(await fs.readFile(path.join(sourceRoot,BLOCKS,'package-lock.json'),'utf8'));
  for(const [key,entry] of Object.entries(mediaLock.packages)){
    if(!key||entry.optional)continue;
    const name=key.slice('node_modules/'.length);
    check(/^node_modules\/(?:@[\w.-]+\/)?[\w.-]+$/.test(key),'unexpected_media_dependency_path',key);
    const packageRoot=path.join(sourceRoot,BLOCKS,key);
    const installed=JSON.parse(await fs.readFile(path.join(packageRoot,'package.json'),'utf8'));
    check(installed.name===name&&installed.version===entry.version,'locked_media_dependency_mismatch',name);
    const notices=(await fs.readdir(packageRoot)).filter(file=>/^licen[cs]e(?:\.[\w-]+)?$|^notice(?:\.[\w-]+)?$/i.test(file)||name==='isarray'&&file==='README.md');
    check(notices.length>0,'media_dependency_license_missing',name);
    for(const file of notices)await addFile(files,targets,'frontend-license:'+name+'/'+file,path.join(packageRoot,file),'licenses/media/'+name+'/'+file,packageRoot);
  }
  for(const name of ['LICENSE','LICENSES.chromium.html'])check(files.some(file=>file.target===name),'Electron_vendor_license_missing',name);
  const generated=[{target:'resources/app/package.json',content:json({name:'aerynth-portable-review',version:app.version,private:true,type:'module',main:'portable-review-bootstrap.cjs'})},{target:'resources/app/portable-review-bootstrap.cjs',content:bootstrap(head)},{target:'README-portable-review.txt',content:readme(head,app.version)},{target:'Launch-Aerynth.cmd',content:'@echo off\r\nsetlocal\r\nset "ELECTRON_RUN_AS_NODE="\r\n"%~dp0AerynthReview.exe" %*\r\nexit /b %ERRORLEVEL%\r\n'}];
  for(const file of generated){check(!targets.has(file.target.toLowerCase()),'generated_target_collision');targets.add(file.target.toLowerCase());}
  const bytes=allocation(files,!!options.archive,generated.reduce((sum,file)=>sum+Buffer.byteLength(file.content),0)),main=await fs.readFile(path.join(sourceRoot,APP,'native/desktop-main.cjs'),'utf8');
  const hostNodeSeam=/backendExecutable\s*\(\s*process\.env\.AERYNTH_NODE_BIN\s*\)/.test(main)||/spawn\s*\(\s*process\.env\.AERYNTH_NODE_BIN/.test(main);
  const tar=path.join(process.env.SystemRoot??'C:\\Windows','System32/tar.exe');check(!options.archive||await exists(tar),'system_tar_unavailable');
  const guard=path.join(process.env.LOCALAPPDATA??'','AeroStorageWatch/ReserveGuard.ps1');check(path.isAbsolute(guard)&&await exists(guard),'ReserveGuard_unavailable');
  const drive=path.parse(output).root[0].toUpperCase(),blockers=[...(dirty?['source_worktree_not_clean']:[]),...(!hostNodeSeam?['bundled_Node_host_seam_missing']:[])];
  return {contract:'aerynth.review-build-plan@1',sourceRoot,vendorRoots:[electronRoot,nodeRoot,...closure.vendorRoots],output,head,tree,rendererReceiptSha256:rendererReceipt.sha256,version:app.version,runtimes:{electron:electronVersion,node:process.version,platform:process.platform,arch:process.arch},files:files.sort((a,b)=>a.target.localeCompare(b.target)),generated,closure,runtimeDependencies:closure.vendors,bytes,archive:!!options.archive,tar,guard,drive,blockers,externalPrerequisites:['installed AeroStorageWatch ReserveGuard.ps1; separate30GiB C/D reserves','installed Codex only for explicitly authorized Codex features','eligible ChatGPT account/user consent and actual native OS protection for optional ChatGPT-plan inference; no account is bundled'],excluded:['private runtime/profile/data/credentials/receipts','historical visual evidence/assets not used by dist','tests/fixtures/synthetic setup and verification/recording entry points','node_modules development trees except the SRI-verified locked jose runtime'],rootPackagePresent:tracked.has('package.json')};
}
export function summary(plan) {return {contract:plan.contract,candidate:{head:plan.head,tree:plan.tree,clean:!plan.blockers.includes('source_worktree_not_clean')},rendererReceiptSha256:plan.rendererReceiptSha256,runtimes:plan.runtimes,runtimeDependencies:plan.runtimeDependencies,output:plan.output,fileCount:plan.files.length,generatedCount:plan.generated.length,bytes:plan.bytes,estimatedCBytes:plan.drive==='C'?plan.bytes.totalBound:0,estimatedDBytes:plan.drive==='D'?plan.bytes.totalBound:0,blockers:plan.blockers,externalPrerequisites:plan.externalPrerequisites,excluded:plan.excluded,archive:plan.archive,sourceFolders:REQUIRED_FOLDERS};}
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
    const target=path.join(plan.output,file.target);check(contained(plan.output,target),'copy_outside_owned_output');await fs.mkdir(path.dirname(target),{recursive:true});const parent=await fs.realpath(path.dirname(target));check(same(plan.output,parent)||contained(plan.output,parent),'output_parent_link_escapes_owned_directory');const sourceSha256=await copyBounded(file,target,admit),copiedSha256=await hashFile(target);check(sourceSha256===copiedSha256,'copied_bytes_mismatch',file.origin);if(file.expectedSha256||file.origin.startsWith('npm-runtime:'))check(sourceSha256===file.expectedSha256,'locked_vendor_bytes_changed_since_plan',file.origin);if(file.canonicalAsset)check(await hashFile(path.join(plan.sourceRoot,file.canonicalAsset))===copiedSha256,'original_public_asset_changed_in_dist',file.canonicalAsset);copied+=file.bytes;files.push({path:file.target,origin:file.origin,bytes:file.bytes,sha256:copiedSha256,...(file.canonicalAsset?{originalAsset:file.canonicalAsset,originalBytesPreserved:true}:{})});
  }
  for(const file of plan.generated){admit();const entry=await writeExclusive(plan.output,file.target,file.content);files.push({...entry,origin:'generated-review-bootstrap'});copied+=entry.bytes;}
  // The native host hashes these folders at startup; each exists in the portable layout.
  for(const folder of REQUIRED_FOLDERS)await fs.mkdir(path.join(plan.output,'resources/app',folder),{recursive:true});
  check(git(plan.sourceRoot,'rev-parse','HEAD')===plan.head&&git(plan.sourceRoot,'status','--porcelain=v1')==='','source_changed_during_copy');
  const sourceHashes=Object.fromEntries(files.filter(f=>f.origin.startsWith('repository:')).map(f=>[f.origin.slice(11),f.sha256]));
  const buildAssets=Object.fromEntries(files.filter(f=>f.origin.startsWith('built-dist:')).map(f=>[f.origin.slice(11),f.sha256]));
  const manifest={contract:'aerynth.portable-review@1',complete:true,createdAt:new Date().toISOString(),candidate:{head:plan.head,tree:plan.tree,clean:true},runtimes:plan.runtimes,sourceHashes,buildAssets,runtimeDependencies:plan.runtimeDependencies,files:files.sort((a,b)=>a.path.localeCompare(b.path)),licenses:['LICENSE','LICENSES.chromium.html','vendor/node-LICENSE.txt',...files.filter(file=>file.origin.startsWith('frontend-license:')).map(file=>file.path),...(plan.runtimeDependencies??[]).map(dependency=>dependency.licensePath)],bounds:plan.bytes,reserve:firstAdmission,externalPrerequisites:plan.externalPrerequisites,exclusions:plan.excluded,acceptance:'Byte-preserving offline packaging only; no native/provider/performance/production acceptance is inferred.',rendererReceiptSha256:plan.rendererReceiptSha256,buildProvenance:'Renderer output matches the local Vite build receipt for the clean candidate.'};
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
