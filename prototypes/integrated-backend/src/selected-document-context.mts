import {createHash,randomUUID} from 'node:crypto';
import {openSync,closeSync,fstatSync,lstatSync,realpathSync} from 'node:fs';
import type {ResourceRef} from '../../vela-core/src/contracts.ts';
import {mediaSourceRevision,type MediaSource} from './media-sources.mts';
import {DOCUMENT_TEXT_LIMITS,validDocumentTextResult,type NativeDocumentTextServices,type DocumentTextResult} from './document-text-host.mts';
import {ensure} from './contracts.mts';
interface Source {ref:ResourceRef;source:MediaSource}
interface Host {source(id:string):Source|null;scopeStamp():string;documents?:NativeDocumentTextServices}
type Cached={key:string;content?:string;coverage?:string;reason?:string};
const key=(scope:string,value:Source)=>createHash('sha256').update(JSON.stringify([scope,value.ref,value.source.metadata])).digest('hex');
function currentFile(source:MediaSource,fd?:number){ensure(source.path&&realpathSync(source.path)===source.path,'source_changed');const stat=lstatSync(source.path,{bigint:true});ensure(stat.isFile()&&!stat.isSymbolicLink()&&mediaSourceRevision(stat)===source.metadata.sourceRevision&&(fd===undefined||mediaSourceRevision(fstatSync(fd,{bigint:true}))===source.metadata.sourceRevision),'source_changed');}
const omission=(reason:string)=>reason==='text-budget'?'The extracted text exceeds the selected-source context budget; no partial document text was included. Choose a smaller document.':reason==='byte-budget'?'The selected document exceeds the 8 MiB local extraction limit; no document text was included.':reason==='unsupported'?'This document has no supported extractable text. Images, OCR and unsupported document parts were not read.':reason==='malformed'?'The document is malformed, encrypted or unsupported; no document text was included.':reason==='timeout'||reason==='cancelled'?'Document extraction was cancelled or exceeded its time limit; no document text was included.':'Local document extraction is unavailable; no document text was included.';
/** Volatile derived text only, at most four whole bounded extractions. Canonical files remain authoritative. */
export class SelectedDocumentContext {
  private readonly host:Host;private readonly cache=new Map<string,Cached>();private readonly abort=new AbortController();private busy=false;
  constructor(host:Host){this.host=host;}
  async prepare(ids:readonly string[]):Promise<void>{
    ensure(!this.abort.signal.aborted,'document_extraction_cancelled');ensure(!this.busy,'document_extraction_busy');this.busy=true;
    const scope=this.host.scopeStamp(),signal=AbortSignal.any([this.abort.signal,AbortSignal.timeout(DOCUMENT_TEXT_LIMITS.timeoutMs)]);let count=0;
    try{for(const id of ids){this.abort.signal.throwIfAborted();const selected=this.host.source(id);if(!selected){this.cache.delete(id);continue;}if(selected.source.metadata.source!=='file'||!['pdf','docx'].includes(selected.source.metadata.format))continue;
      const stamp=key(scope,selected),old=this.cache.get(id);if(old?.content&&old.key===stamp){currentFile(selected.source);continue;}
      if(++count>4){this.put(id,{key:stamp,reason:'At most four selected documents can be extracted in one request; no text from this document was included.'});continue;}
      if(selected.source.metadata.byteLength>DOCUMENT_TEXT_LIMITS.fileBytes){this.put(id,{key:stamp,reason:omission('byte-budget')});continue;}
      if(signal.aborted){this.put(id,{key:stamp,reason:omission('timeout')});continue;}
      if(!this.host.documents){this.put(id,{key:stamp,reason:omission('unavailable')});continue;}
      const fd=openSync(selected.source.path!,'r');try{currentFile(selected.source,fd);
        const input={jobId:randomUUID(),resourceId:id,expectedVersion:selected.ref.version,sourceRevision:selected.source.metadata.sourceRevision,format:selected.source.metadata.format as 'pdf'|'docx',maxTextBytes:DOCUMENT_TEXT_LIMITS.textBytes-400};
        let result:DocumentTextResult;try{result=await this.host.documents.extract(input,signal);}catch{this.abort.signal.throwIfAborted();this.put(id,{key:stamp,reason:omission(signal.aborted?'timeout':'unavailable')});continue;}
        signal.throwIfAborted();ensure(validDocumentTextResult(result,input),'document_extraction_protocol');currentFile(selected.source,fd);const actual=this.host.source(id);ensure(actual&&scope===this.host.scopeStamp()&&key(scope,actual)===stamp,'source_changed');
        if(result.state==='omitted'){this.put(id,{key:stamp,reason:omission(result.reason)});continue;}
        const preamble=result.coverage==='body-text'?'[Extracted DOCX body text. Headers, footers, comments, images and embedded objects are not guaranteed or included.]\n':'[Extractable PDF text from all '+result.units+' pages. Raster/OCR, image content, form fields, annotations and attachments are not guaranteed or included.]\n';
        const content=preamble+result.text;ensure(Buffer.byteLength(content)<=DOCUMENT_TEXT_LIMITS.textBytes,'document_extraction_protocol');this.put(id,{key:stamp,content,coverage:result.coverage});
      }finally{closeSync(fd);}
    }}finally{this.busy=false;}
  }
  private put(id:string,value:Cached){this.cache.delete(id);if(value.content)while([...this.cache.values()].filter(entry=>entry.content!==undefined).length>=4){const oldest=[...this.cache].find(([,entry])=>entry.content!==undefined);this.cache.delete(oldest![0]);}while(this.cache.size>=128)this.cache.delete(this.cache.keys().next().value!);this.cache.set(id,value);}
  read(id:string){const selected=this.host.source(id),entry=this.cache.get(id);if(!selected||!entry?.content||entry.key!==key(this.host.scopeStamp(),selected))return null;currentFile(selected.source);return {ref:selected.ref,content:entry.content,source:'aerynth://resource/'+encodeURIComponent(id)+'?sourceRevision='+selected.source.metadata.sourceRevision+'&extraction='+entry.coverage};}
  reason(id:string){const selected=this.host.source(id),entry=this.cache.get(id);return selected&&entry?.key===key(this.host.scopeStamp(),selected)?entry.reason:undefined;}
  close(){this.abort.abort();this.cache.clear();}
}
