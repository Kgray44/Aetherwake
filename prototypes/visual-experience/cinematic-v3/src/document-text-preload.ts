import {ipcRenderer} from 'electron';

/** Private isolated-world preload only: no contextBridge or document/main-world API. */
let worker:Worker|undefined,active:string|undefined;
ipcRenderer.on('vela-private-document-extract',(_event,input)=>{
  if(active||!input||typeof input.token!=='string'||typeof input.jobId!=='string'||!(input.bytes instanceof Uint8Array)||!['pdf','docx'].includes(input.format)||!Number.isSafeInteger(input.maxTextBytes)||input.maxTextBytes<1||input.maxTextBytes>12000||input.bytes.byteLength>8*1024*1024)return;
  active=input.jobId;worker=new Worker(new URL('../dist/vela-document-text-worker.js',window.location.href),{type:'module'});
  const finish=(result:unknown)=>{worker?.terminate();worker=undefined;active=undefined;ipcRenderer.send('vela-private-document-result',{token:input.token,jobId:input.jobId,result});};
  worker.onmessage=event=>{if(event.data?.kind==='vela-document-text-result')finish(event.data.result);};worker.onerror=()=>finish({state:'omitted',reason:'malformed'});
  const bytes=input.bytes.slice();input.bytes.fill(0);worker.postMessage({bytes,format:input.format,maxTextBytes:input.maxTextBytes},[bytes.buffer]);
});
window.addEventListener('unload',()=>{worker?.terminate();worker=undefined;active=undefined;},{once:true});
