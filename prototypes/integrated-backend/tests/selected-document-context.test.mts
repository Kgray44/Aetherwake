import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {Backend} from '../src/service.mts';
import type {NativeDocumentTextServices} from '../src/document-text-host.mts';
import {extractDocumentText} from '../../visual-experience/cinematic-v3/src/document-text-worker.ts';
import {pdfFixture,docxFixture} from '../../block-library/tests/media-fixtures.mts';

function fixture(){const dir=mkdtempSync(join(tmpdir(),'aerynth-selected-doc-'));let reads=0,release:(()=>void)|undefined,entered:(()=>void)|undefined,hold=false;
  let backend:Backend;const documents:NativeDocumentTextServices={extract:async(input,signal)=>{reads++;const description=await backend.call('mediaDescribe',{resourceId:input.resourceId});const metadata=description.metadata;assert.equal(metadata.source,'file');if(metadata.source!=='file')throw Error();
    const bytes=new Uint8Array(metadata.byteLength);for(let offset=0;offset<bytes.length;offset+=1024*1024){signal.throwIfAborted();const length=Math.min(1024*1024,bytes.length-offset),chunk=await backend.call('mediaReadChunk',{resourceId:input.resourceId,expectedVersion:input.expectedVersion,sourceRevision:input.sourceRevision,offset,length});bytes.set(Buffer.from(chunk.base64,'base64'),offset);}
    try{const result=await extractDocumentText(bytes,input.format,input.maxTextBytes,signal);if(hold)await new Promise<void>(resolve=>{release=resolve;entered?.();signal.addEventListener('abort',()=>resolve(),{once:true});});signal.throwIfAborted();if(result.state==='complete')return {...result,jobId:input.jobId,sourceRevision:input.sourceRevision,textDigest:createHash('sha256').update(result.text).digest('hex')};return {...result,jobId:input.jobId,sourceRevision:input.sourceRevision};}finally{bytes.fill(0);}}};
  backend=new Backend({path:join(dir,'canonical.sqlite'),provider:'fixture',contentPolicy:'synthetic-only',nativeMedia:true},{documents,secrets:{available:async()=>false,seal:async()=>{throw Error();},open:async()=>{throw Error();}}});
  return {dir,get reads(){return reads;},backend,
    async pick(name:string,bytes:Uint8Array){const path=join(dir,name);writeFileSync(path,bytes);const selected=await backend.call('mediaImportTrusted',{commandId:randomUUID(),kind:'file',selection:{kind:'file',path}});return {path,ref:selected.resource};},
    async preview(ids:string[]){return backend.call('velaRequestPreview',{intent:'Explain the explicitly selected document.',resourceIds:ids});},
    hold(){hold=true;return new Promise<void>(resolve=>{entered=resolve;});},release(){release?.();},
    async close(){release?.();await backend.close();const part=relative(resolve(tmpdir()),resolve(dir));assert.ok(part.startsWith('aerynth-selected-doc-')&&!part.startsWith('..')&&!isAbsolute(part));rmSync(dir,{recursive:true,force:true});}};
}
test('actual Core plus both private worker hops extract real PDF all-page text and DOCX body text only after explicit Send preparation',async()=>{
  const f=fixture();try{for(const [name,bytes,expected] of [['fixture.pdf',pdfFixture(),'Searchable second page'],['fixture.docx',docxFixture(),'Table cell']] as const){const selected=await f.pick(name,bytes);assert.equal(f.reads,name.endsWith('.pdf')?0:1,'Picking never extracts document contents');
      const preview=await f.preview([selected.ref.id]);assert.equal(preview.context.included.length,1);const included=preview.context.included[0];assert.match(included.content,new RegExp(expected));assert.equal(included.trust,'untrusted-source-data');assert.ok(!included.source.includes(f.dir));assert.equal(included.id,selected.ref.id);assert.match(included.content,name.endsWith('.pdf')?/Extractable PDF text from all 2 pages/:/Extracted DOCX body text/);assert.doesNotMatch(included.content,/whole original|complete document transcription/);
      await f.preview([selected.ref.id]);assert.equal(f.reads,name.endsWith('.pdf')?1:2,'A current exact-source cache avoids repeat parsing');}
    assert.equal((await f.backend.call('providerActivity',{})).providerRequests,0);assert.equal((await f.backend.call('snapshot',{})).conversations.length,0,'Context preview never fabricates a transcript');
  }finally{await f.close();}
});
test('malformed DOCX and over-budget extracted text are omitted whole with explicit reasons',async()=>{
  const f=fixture();try{const xml=new TextEncoder().encode('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>'+('synthetic '.repeat(2000))+'</w:t></w:r></w:p></w:body></w:document>');
    const large=await f.pick('large.docx',docxFixture({'word/document.xml':xml})),bad=await f.pick('malformed.docx',new Uint8Array([80,75,3,4,1,2,3,4]));
    const oversized=await f.preview([large.ref.id]);assert.equal(oversized.context.included.length,0);assert.match(oversized.context.omitted[0].reason,/exceeds.*budget.*no partial/i);
    const invalid=await f.preview([bad.ref.id]);assert.equal(invalid.context.included.length,0);assert.match(invalid.context.omitted[0].reason,/malformed|unsupported/i);assert.equal((await f.backend.call('providerActivity',{})).providerRequests,0);
  }finally{await f.close();}
});
test('source replacement or archive during real extraction cannot commit stale selected document context',async()=>{
  for(const change of ['source','revoke'] as const){const f=fixture();try{const selected=await f.pick('held.pdf',pdfFixture()),entered=f.hold(),pending=f.preview([selected.ref.id]);pending.catch(()=>{});await entered;
    if(change==='source')writeFileSync(selected.path,Buffer.from('%PDF-1.4\nchanged while parsing'));
    else await f.backend.call('desktop',{type:'archiveSubject',kind:'resource',id:selected.ref.id,expectedVersion:selected.ref.version,archived:true});
    f.release();await assert.rejects(pending,/source_changed|source_unavailable|resource_not_authorized/);assert.equal((await f.backend.call('providerActivity',{})).providerRequests,0);
  }finally{await f.close();}}
});
test('actual Core close aborts its pending private extraction without a provider request or late context commit',async()=>{
  const f=fixture();try{const selected=await f.pick('cancelled.pdf',pdfFixture()),entered=f.hold(),pending=f.preview([selected.ref.id]);pending.catch(()=>{});await entered;await f.backend.close();await assert.rejects(pending,/cancel|disconnect|operation_failed|aborted/i);assert.equal(f.reads,1);}finally{await f.close();}
});
