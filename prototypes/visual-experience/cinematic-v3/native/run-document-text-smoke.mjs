import {mkdtemp,writeFile,readFile,mkdir,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {buildDocumentExtraction} from './document-extraction-build.mjs';
import {pdfFixture,docxFixture} from '../../../block-library/tests/media-fixtures.mts';
import {checkNativeTestLaunch} from './launch-native-test.cjs';
const app=path.resolve(fileURLToPath(new URL('..',import.meta.url)));if(process.platform!=='win32')throw Error('native_document_smoke_requires_windows');
checkNativeTestLaunch();
const guard=path.join(process.env.LOCALAPPDATA,'AeroStorageWatch/ReserveGuard.ps1');const admission=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',guard,'-EstimatedCBytes','134217728','-EstimatedDBytes','0'],{encoding:'utf8',windowsHide:true,maxBuffer:16384}));if(!admission.allowed)throw Error('document_smoke_reserve_denied');
const root=await mkdtemp(path.join(tmpdir(),'aerynth-document-native-'));try{const built=await buildDocumentExtraction(app);await mkdir(path.join(root,'dist'));await mkdir(path.join(root,'native'));for(const [name,bytes] of Object.entries(built.outputs))await writeFile(path.join(root,'dist',name),bytes);for(const name of ['document-extraction-broker.cjs','document-extraction-smoke.cjs','document-text.html','native-test-admission.cjs'])await copyFile(path.join(app,'native',name),path.join(root,'native',name));await writeFile(path.join(root,'fixtures.json'),JSON.stringify({pdf:Buffer.from(pdfFixture()).toString('base64'),docx:Buffer.from(docxFixture()).toString('base64')}));
  const environment={...process.env};
  delete environment.ELECTRON_RUN_AS_NODE;
  checkNativeTestLaunch(environment);
  const child=spawn(path.join(app,'node_modules/electron/dist/electron.exe'),[path.join(root,'native/document-extraction-smoke.cjs'),root],{windowsHide:true,shell:false,stdio:['ignore','pipe','pipe'],env:environment});
  let stdout='',stderr='';
  child.stdout.on('data',chunk=>{stdout=(stdout+String(chunk)).slice(-16384);});
  child.stderr.on('data',chunk=>{stderr=(stderr+String(chunk)).slice(-8192);});
  const timer=setTimeout(()=>child.kill(),30000);
  let exit;
  try {
    exit=await new Promise((resolve,reject)=>{child.once('close',resolve);child.once('error',reject);});
  } finally {
    clearTimeout(timer);
  }
  const line=stdout.trim().split(/\r?\n/u).findLast(value=>value.startsWith('{')),receipt=line?JSON.parse(line):{pass:false,error:'native_smoke_no_receipt'};receipt.sourceAssets=built.metadata.assets;receipt.brokerSha256=createHash('sha256').update(await readFile(path.join(root,'native/document-extraction-broker.cjs'))).digest('hex');receipt.exit=exit;process.stdout.write(JSON.stringify(receipt)+'\n');if(exit!==0||!receipt.pass){process.stderr.write(stderr.slice(-4096)+'\n');process.exitCode=1;}
  const artifact=path.join(process.env.USERPROFILE,'.codex/artifacts/aerynth-document-native-'+new Date().toISOString().replace(/[^0-9]/gu,''));await mkdir(artifact,{recursive:false});
  await writeFile(path.join(artifact,'native-receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
  const nativeSources={};for(const name of ['document-extraction-broker.cjs','document-extraction-smoke.cjs','document-text.html','native-test-admission.cjs'])nativeSources['native/'+name]=createHash('sha256').update(await readFile(path.join(root,'native',name))).digest('hex');
  await writeFile(path.join(artifact,'source-receipt.json'),JSON.stringify({...built.metadata,nativeSources},null,2)+'\n',{flag:'wx'});process.stdout.write(JSON.stringify({artifact})+'\n');
}finally{if(path.dirname(root)!==path.resolve(tmpdir())||!path.basename(root).startsWith('aerynth-document-native-'))throw Error('document_smoke_cleanup_scope');await rm(root,{recursive:true,force:true});}
