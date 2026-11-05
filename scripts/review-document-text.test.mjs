import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {buildDocumentExtraction} from '../prototypes/visual-experience/cinematic-v3/native/document-extraction-build.mjs';
import {validateDocumentTextAssets} from './review-build.mjs';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url))),app=path.join(root,'prototypes/visual-experience/cinematic-v3');
test('actual fixed document assets bind six reviewed sources, package lock, installed parser bytes and licenses; mutations fail closed',async()=>{const built=await buildDocumentExtraction(app),temporary=await mkdtemp(path.join(tmpdir(),'aerynth-document-assets-'));try{for(const [name,bytes] of Object.entries(built.outputs))await writeFile(path.join(temporary,name),bytes);const assets=Object.fromEntries(Object.entries(built.outputs).map(([name,bytes])=>[name,createHash('sha256').update(bytes).digest('hex')])),tracked=new Set([...Object.keys(built.metadata.inputs),built.metadata.dependencyLock.source]);
  assert.equal((await validateDocumentTextAssets(root,temporary,tracked,assets)).size,4);assert.equal(Object.keys(built.metadata.inputs).length,6);assert.ok(Object.keys(built.metadata.vendorInputs).length>0);
  for(const mutate of [value=>{value.inputs[Object.keys(value.inputs)[0]]='0'.repeat(64);},value=>{value.vendorInputs[Object.keys(value.vendorInputs)[0]]='0'.repeat(64);},value=>{value.licenses.mammoth.text='substituted license';},value=>{value.assets['vela-document-text-worker.js']='0'.repeat(64);}]){const invalid=structuredClone(built.metadata);mutate(invalid);await writeFile(path.join(temporary,'vela-document-text.sources.json'),JSON.stringify(invalid));await assert.rejects(validateDocumentTextAssets(root,temporary,tracked,assets),/document_text_/);}
}finally{assert.equal(path.dirname(temporary),path.resolve(tmpdir()));assert.ok(path.basename(temporary).startsWith('aerynth-document-assets-'));await rm(temporary,{recursive:true,force:true});}});
