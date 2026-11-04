const {randomUUID,createHash}=require('node:crypto');
const {isAbsolute,join,dirname}=require('node:path');
const {pathToFileURL}=require('node:url');
const LIMITS=Object.freeze({bytes:8*1024*1024,text:12000,chunk:1024*1024,timeout:9000});
const record=v=>v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,keys)=>record(v)&&Object.keys(v).sort().join('|')===keys.sort().join('|');
const id=v=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,198}$/u.test(v);
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/u.test(v);
const valid=v=>exact(v,['jobId','resourceId','expectedVersion','sourceRevision','format','maxTextBytes'])&&id(v.jobId)&&id(v.resourceId)&&Number.isSafeInteger(v.expectedVersion)&&v.expectedVersion>=1&&hash(v.sourceRevision)&&['pdf','docx'].includes(v.format)&&Number.isSafeInteger(v.maxTextBytes)&&v.maxTextBytes>=1&&v.maxTextBytes<=LIMITS.text;

/** Fixed private utility window. It has no renderer bridge, credentials, filesystem path or network grant. */
function createDocumentExtractionBroker({BrowserWindow,ipcMain,call,send,preloadPath,htmlPath,observe}){
  if(!isAbsolute(preloadPath)||!isAbsolute(htmlPath))throw Error('document_extraction_unavailable');
  let active=null,closed=false;const seen=new Set();
  const note=value=>{try{observe?.(Object.freeze(value));}catch{}};
  async function extract(input,signal){
    let win,bytes;const owner=active,timer=setTimeout(()=>owner?.abort.abort(),LIMITS.timeout);
    const check=()=>{if(closed||signal.aborted)throw Error('document_extraction_unavailable');};
    try{const description=await call('mediaDescribe',{resourceId:input.resourceId});check();const metadata=description?.metadata;note({stage:'metadata',format:input.format});
    if(metadata?.source!=='file'||metadata.format!==input.format||metadata.sourceRevision!==input.sourceRevision||!Number.isSafeInteger(metadata.byteLength)||metadata.byteLength<1)throw Error('document_extraction_unavailable');
    if(metadata.byteLength>LIMITS.bytes)return {state:'omitted',reason:'byte-budget'};
    bytes=new Uint8Array(metadata.byteLength);
      for(let offset=0;offset<bytes.length;offset+=LIMITS.chunk){check();const length=Math.min(LIMITS.chunk,bytes.length-offset),part=await call('mediaReadChunk',{resourceId:input.resourceId,expectedVersion:input.expectedVersion,sourceRevision:input.sourceRevision,offset,length});check();
        if(typeof part?.base64!=='string'||part.base64.length>4*Math.ceil(length/3))throw Error('document_extraction_unavailable');const buffer=Buffer.from(part.base64,'base64');try{if(buffer.length!==length||buffer.toString('base64')!==part.base64)throw Error('document_extraction_unavailable');bytes.set(buffer,offset);}finally{buffer.fill(0);}}
      const token=randomUUID();win=new BrowserWindow({show:false,focusable:false,width:1,height:1,paintWhenInitiallyHidden:false,webPreferences:{preload:preloadPath,contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,partition:'aerynth-document-'+randomUUID()}});
      active.win=win;win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',event=>event.preventDefault());win.webContents.on('will-frame-navigate',event=>event.preventDefault());win.webContents.on('will-attach-webview',event=>event.preventDefault());win.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
      const allowed=new Set([htmlPath,join(dirname(preloadPath),'vela-document-text-worker.js'),join(dirname(preloadPath),'vela-document-pdf.worker.js')].map(file=>pathToFileURL(file).href));
      win.webContents.session.webRequest.onBeforeRequest({urls:['<all_urls>']},(details,callback)=>callback({cancel:!allowed.has(details.url)}));
      const result=new Promise((resolve,reject)=>{const done=(error,value)=>{ipcMain.removeListener('vela-private-document-result',receive);signal.removeEventListener('abort',abort);if(error)reject(error);else resolve(value);};
        const abort=()=>{if(win&&!win.isDestroyed())win.destroy();done(Error('document_extraction_unavailable'));};
        const receive=(event,value)=>{if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame||!exact(value,['token','jobId','result'])||value.token!==token||value.jobId!==input.jobId)return;
          const data=value.result;note({stage:'worker-result',state:record(data)?data.state:null,coverage:record(data)?data.coverage:null,textBytes:typeof data?.text==='string'?Buffer.byteLength(data.text):null});if(!record(data)||!['complete','omitted'].includes(data.state)){done(Error('document_extraction_unavailable'));return;}
          if(data.state==='complete'&&(typeof data.text!=='string'||Buffer.byteLength(data.text)>input.maxTextBytes||data.coverage!==(input.format==='pdf'?'extractable-text-all-pages':'body-text'))){done(Error('document_extraction_unavailable'));return;}
          done(null,data);};
        signal.addEventListener('abort',abort,{once:true});ipcMain.on('vela-private-document-result',receive);win.once('closed',()=>done(Error('document_extraction_unavailable')));
        void win.loadFile(htmlPath).then(()=>{check();note({stage:'loaded',format:input.format});win.webContents.send('vela-private-document-extract',{token,jobId:input.jobId,bytes,format:input.format,maxTextBytes:input.maxTextBytes});}).catch(()=>{note({stage:'load-failed',format:input.format});done(Error('document_extraction_unavailable'));});
      });return await result;
    }finally{clearTimeout(timer);bytes?.fill(0);if(win&&!win.isDestroyed())win.destroy();}
  }
  return {handle(value){if(!record(value)||!Object.hasOwn(value,'documentHost'))return false;if(!exact(value,['documentHost'])||!record(value.documentHost)||closed)return true;const h=value.documentHost;
      if(h.version===1&&h.kind==='cancel'&&exact(h,['version','kind','id','jobId'])){if(active?.id===h.id&&active.input.jobId===h.jobId)active.abort.abort();return true;}
      if(h.version!==1||h.kind!=='request'||!exact(h,['version','kind','id','input'])||!id(h.id)||!valid(h.input))return true;
      const reply=body=>{if(!closed)send({documentHost:{version:1,kind:'response',id:h.id,...body}});};if(active||seen.has(h.id)){reply({error:'document_extraction_unavailable'});return true;}
      seen.add(h.id);while(seen.size>128)seen.delete(seen.values().next().value);const owned={id:h.id,input:h.input,abort:new AbortController(),win:null};active=owned;
      void extract(h.input,owned.abort.signal).then(result=>reply({result:{...result,jobId:h.input.jobId,sourceRevision:h.input.sourceRevision,...(result.state==='complete'?{textDigest:createHash('sha256').update(result.text).digest('hex')}:{})}})).catch(()=>reply({error:'document_extraction_unavailable'})).finally(()=>{if(active===owned)active=null;});return true;},
    close(){closed=true;active?.abort.abort();if(active?.win&&!active.win.isDestroyed())active.win.destroy();active=null;}};
}
module.exports={createDocumentExtractionBroker,LIMITS};
