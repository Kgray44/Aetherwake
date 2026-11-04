import {extractDocxBodyText} from '../../../block-library/media-docx-parser.ts';
import {openPdf} from '../../../block-library/media-pdf.ts';

export type ExtractedDocumentText={state:'complete';text:string;coverage:'body-text'|'extractable-text-all-pages';units:number|null;omittedImages:number|null;unsupportedParts:string[]}|{state:'omitted';reason:'byte-budget'|'text-budget'|'unsupported'|'malformed'|'timeout'|'cancelled'};
const byteLength=(value:string)=>new TextEncoder().encode(value).length;
/** The outer native worker is killed at its deadline; this function never reads a path or URL. */
export async function extractDocumentText(bytes:Uint8Array,format:'pdf'|'docx',maxTextBytes:number,signal?:AbortSignal):Promise<ExtractedDocumentText>{
  if(bytes.byteLength>8*1024*1024)return {state:'omitted',reason:'byte-budget'};
  if(!Number.isSafeInteger(maxTextBytes)||maxTextBytes<1||maxTextBytes>12000)return {state:'omitted',reason:'text-budget'};
  try{signal?.throwIfAborted();
    if(format==='docx'){
      const result=await extractDocxBodyText(bytes);signal?.throwIfAborted();
        if(byteLength(result.value)>maxTextBytes)return {state:'omitted',reason:'text-budget'};if(!result.value.trim())return {state:'omitted',reason:'unsupported'};
        return {state:'complete',text:result.value,coverage:'body-text',units:null,omittedImages:null,unsupportedParts:['headers/footers/comments not guaranteed','images and embedded objects not extracted']};
    }
    if(format!=='pdf')return {state:'omitted',reason:'unsupported'};
    const pdf=await openPdf(bytes,signal);try{const pages:string[]=[];let total=0;
      for(let page=1;page<=pdf.pageCount;page++){signal?.throwIfAborted();const value=await pdf.text(page),part=(page>1?'\n\n':'')+value;total+=byteLength(part);if(total>maxTextBytes)return {state:'omitted',reason:'text-budget'};pages.push(part);}
      const text=pages.join('');if(!text.trim())return {state:'omitted',reason:'unsupported'};
      return {state:'complete',text,coverage:'extractable-text-all-pages',units:pdf.pageCount,omittedImages:null,unsupportedParts:['raster/OCR and image content not extracted','form fields, annotations and attachments not guaranteed']};
    }finally{await pdf.dispose();}
  }catch(error){return {state:'omitted',reason:signal?.aborted?'cancelled':(error as {code?:string}).code==='timeout'?'timeout':'malformed'};}
}
if(typeof self!=='undefined'&&typeof document==='undefined'&&typeof self.postMessage==='function')self.onmessage=event=>{
  const input=event.data,bytes=input?.bytes;if(!(bytes instanceof Uint8Array))return;
  void extractDocumentText(bytes,input.format,input.maxTextBytes).then(result=>self.postMessage({kind:'vela-document-text-result',result})).finally(()=>bytes.fill(0));
};
