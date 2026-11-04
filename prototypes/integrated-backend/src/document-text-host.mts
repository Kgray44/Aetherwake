import {randomUUID,createHash} from 'node:crypto';

/** Private native transport. Only canonical identifiers cross; no path, credential or file body. */
export const DOCUMENT_TEXT_LIMITS=Object.freeze({fileBytes:8*1024*1024,textBytes:12000,inFlight:1,timeoutMs:10000});
export interface DocumentTextInput {jobId:string;resourceId:string;expectedVersion:number;sourceRevision:string;format:'pdf'|'docx';maxTextBytes:number}
export type DocumentTextResult={jobId:string;sourceRevision:string}&({state:'complete';text:string;textDigest:string;coverage:'body-text'|'extractable-text-all-pages';units:number|null;omittedImages:number|null;unsupportedParts:string[]}|{state:'omitted';reason:'byte-budget'|'text-budget'|'unsupported'|'malformed'|'timeout'|'cancelled'|'unavailable'});
export interface NativeDocumentTextServices {extract(input:DocumentTextInput,signal:AbortSignal):Promise<DocumentTextResult>}
const record=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:Record<string,any>,keys:string[])=>Object.keys(v).sort().join('|')===keys.sort().join('|');
const id=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,198}$/u.test(v);
const digest=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/u.test(v);
export const isDocumentTextEnvelope=(v:unknown):v is {documentHost:any}=>record(v)&&Object.hasOwn(v,'documentHost');
export function validDocumentTextInput(v:unknown):v is DocumentTextInput{return record(v)&&exact(v,['jobId','resourceId','expectedVersion','sourceRevision','format','maxTextBytes'])&&id(v.jobId)&&id(v.resourceId)&&Number.isSafeInteger(v.expectedVersion)&&v.expectedVersion>=1&&digest(v.sourceRevision)&&['pdf','docx'].includes(v.format)&&Number.isSafeInteger(v.maxTextBytes)&&v.maxTextBytes>=1&&v.maxTextBytes<=DOCUMENT_TEXT_LIMITS.textBytes;}
export function validDocumentTextResult(v:unknown,input:DocumentTextInput):v is DocumentTextResult{
  if(!record(v)||v.jobId!==input.jobId||v.sourceRevision!==input.sourceRevision)return false;
  if(v.state==='omitted')return exact(v,['jobId','sourceRevision','state','reason'])&&['byte-budget','text-budget','unsupported','malformed','timeout','cancelled','unavailable'].includes(v.reason);
  return exact(v,['jobId','sourceRevision','state','text','textDigest','coverage','units','omittedImages','unsupportedParts'])&&v.state==='complete'&&typeof v.text==='string'&&v.text.trim().length>0&&Buffer.byteLength(v.text)<=input.maxTextBytes&&digest(v.textDigest)&&createHash('sha256').update(v.text).digest('hex')===v.textDigest&&v.coverage===(input.format==='pdf'?'extractable-text-all-pages':'body-text')&&(input.format==='pdf'?Number.isSafeInteger(v.units)&&v.units>=1&&v.units<=500:v.units===null)&&(v.omittedImages===null||Number.isSafeInteger(v.omittedImages)&&v.omittedImages>=0&&v.omittedImages<=4096)&&Array.isArray(v.unsupportedParts)&&v.unsupportedParts.length<=8&&v.unsupportedParts.every((s:unknown)=>typeof s==='string'&&s.length>0&&s.length<=120&&!/[\x00-\x1f]/u.test(s));
}
export function createDocumentTextClient(send:(v:any)=>void){
  const pending=new Map<string,{input:DocumentTextInput;resolve:(v:DocumentTextResult)=>void;reject:(e:Error)=>void;cleanup:()=>void}>();let closed=false;
  const cancel=(id:string,input:DocumentTextInput)=>{try{send({documentHost:{version:1,kind:'cancel',id,jobId:input.jobId}});}catch{}};
  return {services:{extract(input,signal){return new Promise<DocumentTextResult>((resolve,reject)=>{if(closed||pending.size>=DOCUMENT_TEXT_LIMITS.inFlight||!validDocumentTextInput(input)){reject(Error('document_extraction_unavailable'));return;}
    const requestId=randomUUID();let timer:ReturnType<typeof setTimeout>;const stop=(code:string)=>{const p=pending.get(requestId);if(!p)return;pending.delete(requestId);p.cleanup();cancel(requestId,input);p.reject(Error(code));};
    const abort=()=>stop('document_extraction_cancelled');timer=setTimeout(()=>stop('document_extraction_timeout'),DOCUMENT_TEXT_LIMITS.timeoutMs);
    pending.set(requestId,{input,resolve,reject,cleanup:()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);}});signal.addEventListener('abort',abort,{once:true});if(signal.aborted){abort();return;}
    try{send({documentHost:{version:1,kind:'request',id:requestId,input}});}catch{stop('document_extraction_unavailable');}});}} as NativeDocumentTextServices,
    handle(value:unknown){if(!isDocumentTextEnvelope(value))return false;if(!record(value)||!exact(value,['documentHost'])||!record(value.documentHost))return true;const h=value.documentHost,p=pending.get(h.id);if(!p||h.version!==1||h.kind!=='response')return true;
      if(exact(h,['version','kind','id','result'])&&validDocumentTextResult(h.result,p.input)){pending.delete(h.id);p.cleanup();p.resolve(h.result);}else if(exact(h,['version','kind','id','error'])&&typeof h.error==='string'){pending.delete(h.id);p.cleanup();p.reject(Error('document_extraction_unavailable'));}return true;},
    close(){closed=true;for(const [id,p] of pending){p.cleanup();cancel(id,p.input);p.reject(Error('document_extraction_unavailable'));}pending.clear();}};
}
export function createDocumentTextServer(services:NativeDocumentTextServices|undefined,send:(v:any)=>void){
  const active=new Map<string,{jobId:string;abort:AbortController}>();let closed=false;
  return {handle(value:unknown){if(!isDocumentTextEnvelope(value))return false;if(!record(value)||!exact(value,['documentHost'])||!record(value.documentHost)||closed)return true;const h=value.documentHost;
    if(h.version===1&&h.kind==='cancel'&&exact(h,['version','kind','id','jobId'])){const entry=active.get(h.id);if(entry&&entry.jobId===h.jobId)entry.abort.abort();return true;}
    if(h.version!==1||h.kind!=='request'||!exact(h,['version','kind','id','input'])||!id(h.id)||!validDocumentTextInput(h.input))return true;
    const reply=(body:any)=>{if(!closed)send({documentHost:{version:1,kind:'response',id:h.id,...body}});};if(!services||active.has(h.id)||active.size>=DOCUMENT_TEXT_LIMITS.inFlight){reply({error:'document_extraction_unavailable'});return true;}
    const abort=new AbortController();active.set(h.id,{jobId:h.input.jobId,abort});void Promise.resolve().then(()=>services.extract(h.input,abort.signal)).then(result=>{if(!validDocumentTextResult(result,h.input))throw Error();if(!abort.signal.aborted)reply({result});}).catch(()=>reply({error:'document_extraction_unavailable'})).finally(()=>active.delete(h.id));return true;},
    close(){closed=true;for(const entry of active.values())entry.abort.abort();active.clear();}};
}
