const { randomUUID, randomBytes } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { safeMedia, safeDevices } = require('./vela-voice-broker.cjs');
const CHANNEL = 'aerynth-private-live-media';
// Native-only QA readback; Electron does not return additionalArguments in every version.
const syntheticWindows=new WeakSet();
const isSyntheticLiveMediaWindow=window=>syntheticWindows.has(window);
const LIMITS = Object.freeze({ wireBytes: 196608, inFlight: 8, timeoutMs: 15000, eventsPerSecond: 128 });
const operations = new Set(['prepare','connect','send','close','devices','setInputDevice','setOutputDevice','setLocalMute','resumePlayback','interruptPlayback','state','dispose','quiesceCapture']);
const errors = new Set(['live_media_unavailable','live_media_protocol','live_media_capacity','live_media_backpressure','live_media_timeout','live_media_closed','live_media_operation_failed']);
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value)) && Reflect.ownKeys(value).length === keys.length &&
  keys.every(key => Object.hasOwn(Object.getOwnPropertyDescriptor(value,key) ?? {},'value'));
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\x00-\x20\x7f]/u.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value);
const bounded = value => { try { return Buffer.byteLength(JSON.stringify(value)) <= LIMITS.wireBytes; } catch { return false; } };
const sdp = value => typeof value === 'string' && Buffer.byteLength(value)>0 && Buffer.byteLength(value)<=65536;
const command = value => exact(value,['type','event_id']) && ['session.close','session.input_audio.mute','session.input_audio.unmute'].includes(value.type) && id(value.event_id) ||
  exact(value,['type','event_id','delegation_id','content']) && ['session.thinking.append','session.commentary.append'].includes(value.type) && id(value.event_id) &&
  (value.delegation_id===null||id(value.delegation_id)) && typeof value.content==='string' && Buffer.byteLength(value.content)<=500;
const cleanup=h=>['dispose','close','quiesceCapture'].includes(h.operation)||h.operation==='send'&&h.payload?.command?.type==='session.close';
function resultValid(operation,value){
  if(operation==='prepare')return exact(value,['offerId','sdpOffer'])&&id(value.offerId)&&sdp(value.sdpOffer);
  try{if(operation==='state')return value!==null&&!!safeMedia(value);if(operation==='devices')return !!safeDevices(value);}catch{return false;}
  return value===null;
}
function validRequest(value) {
  if(!exact(value,['nativeLiveHost'])||!bounded(value))return false;
  const h=value.nativeLiveHost;
  if(!exact(h,['version','kind','id','operation','payload'])||h.version!==1||h.kind!=='request'||!uuid(h.id)||!operations.has(h.operation))return false;
  const p=h.payload;
  if(h.operation==='prepare')return exact(p,['attemptId',...['inputDeviceId','outputDeviceId','bufferLeaseRef'].filter(key=>Object.hasOwn(p??{},key))])&&id(p.attemptId)&&['inputDeviceId','outputDeviceId','bufferLeaseRef'].every(key=>p[key]===undefined||id(p[key]));
  if(h.operation==='quiesceCapture')return exact(p,['attemptId',...(Object.hasOwn(p??{},'sessionId')?['sessionId']:[])])&&id(p.attemptId)&&(p.sessionId===undefined||id(p.sessionId));
  if(h.operation==='connect')return exact(p,['sessionId','sdpAnswer'])&&id(p.sessionId)&&sdp(p.sdpAnswer);
  if(h.operation==='send')return exact(p,['sessionId','command'])&&id(p.sessionId)&&command(p.command);
  if(h.operation==='close')return exact(p,['sessionId'])&&id(p.sessionId);
  if(h.operation==='setInputDevice'||h.operation==='setOutputDevice')return exact(p,['deviceId'])&&id(p.deviceId);
  if(h.operation==='setLocalMute')return exact(p,['muted'])&&typeof p.muted==='boolean';
  return exact(p,[]);
}
/** Private transport: neither this channel nor its token is exposed by a contextBridge. */
function createLiveMediaBroker({ BrowserWindow, ipcMain, send, preloadPath, htmlPath, syntheticInput=false, now=Date.now }) {
  let win=null, token=null, ready=null, readyResolve, readyReject, readyTimer, closed=false, currentSession=null, currentAttempt=null, permissionDepth=0,quiesceFlight=null;
  let lastState={contract:'aerynth.gpt-live-media@1',connection:'idle',microphoneAccess:'not-requested',localTrackEnabled:false,localSourceMuted:null,providerInputMute:'unknown',playback:'idle',playbackObserved:false,humanAudibility:'unverified',inputDevice:'default',outputDevice:'default',localSpeech:'unavailable',remoteSignal:'unavailable',interruption:'none'};
  let rateAt=now(), rate=0, activeRequests=0, generation=0;
  const attempts=new Map(), pending=new Map(), seen=new Set();
  const url=pathToFileURL(htmlPath).href;
  const publish=message=>{try{send(message);}catch{/* Owned backend transport is gone. */}};
  const response=(h,result,error)=>publish({nativeLiveHost:{version:1,kind:'response',id:h.id,operation:h.operation,...(error?{error}:{result})}});
  const owns=event=>!!win&&!win.isDestroyed()&&!win.webContents.isDestroyed()&&event.sender===win.webContents&&event.senderFrame===win.webContents.mainFrame&&event.senderFrame?.url===url;
  const authenticated=(event,value)=>owns(event)&&exact(value,['token','message'])&&value.token===token&&bounded(value.message);
  function reset(code='live_media_closed',disposed=false) {
    generation++;
    const prior=win;win=null;token=null;permissionDepth=0;currentSession=null;currentAttempt=null;
    lastState={...lastState,connection:disposed?'disposed':code==='live_media_closed'?'closed':'failed',microphoneAccess:lastState.microphoneAccess==='active'?'released':lastState.microphoneAccess,localTrackEnabled:false,localSourceMuted:null,providerInputMute:'unknown',playback:'idle',localSpeech:'unavailable',remoteSignal:'unavailable',interruption:'none'};
    if(disposed)delete lastState.errorCode;
    else if(code!=='live_media_closed')lastState.errorCode=code;
    clearTimeout(readyTimer);readyReject?.(Error(code));ready=null;readyResolve=null;readyReject=null;
    for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error(code));}pending.clear();
    if(prior&&!prior.isDestroyed())prior.destroy();
  }
  function failed() {
    const sessionId=currentSession;reset();
    if(sessionId)publish({nativeLiveHost:{version:1,kind:'event',id:randomUUID(),operation:'connection-lost',payload:{sessionId}}});
  }
  async function ensureWindow() {
    if(closed)throw Error('live_media_closed');
    if(ready)return ready;
    token=randomBytes(32).toString('hex');
    ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
    const waiting=ready;
    // Non-persistent partition, no application scripts, no renderer navigation or Node access.
    win=new BrowserWindow({show:false,focusable:false,width:1,height:1,skipTaskbar:true,webPreferences:{preload:preloadPath,contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,backgroundThrottling:false,partition:'aerynth-live-media-'+randomUUID(),additionalArguments:['--aerynth-live-media-token='+token,...(syntheticInput?['--aerynth-live-media-synthetic']:[])]}});
    if(syntheticInput)syntheticWindows.add(win);
    const wc=win.webContents, mediaSession=wc.session;
    // QA must remain inaudible even if a future media adapter changes its element mute.
    if(syntheticInput)wc.setAudioMuted(true);
    wc.setWindowOpenHandler(()=>({action:'deny'}));
    wc.on('will-navigate',(event)=>event.preventDefault());
    wc.on('will-frame-navigate',(event)=>event.preventDefault());
    wc.on('will-attach-webview',event=>event.preventDefault());
    wc.on('render-process-gone',failed);wc.on('destroyed',()=>{if(win?.webContents===wc)failed();});
    const permitted=(owner,permission,details)=>permission==='media'&&!syntheticInput&&permissionDepth>0&&owner===wc&&wc.getURL()===url&&
      (details.requestingUrl===undefined||details.requestingUrl===url)&&details.isMainFrame!==false;
    mediaSession.setPermissionRequestHandler((owner,permission,callback,details)=>callback(permitted(owner,permission,details)&&Array.isArray(details?.mediaTypes)&&details.mediaTypes.length===1&&details.mediaTypes[0]==='audio'));
    mediaSession.setPermissionCheckHandler((owner,permission,_origin,details)=>permitted(owner,permission,details)&&details?.mediaType==='audio'&&details.isMainFrame===true);
    mediaSession.setDevicePermissionHandler?.(()=>false);
    mediaSession.webRequest?.onBeforeRequest((details,callback)=>callback({cancel:details.url!==url}));
    readyTimer=setTimeout(()=>reset('live_media_timeout'),LIMITS.timeoutMs);
    Promise.resolve(win.loadURL(url)).catch(()=>reset('live_media_unavailable'));
    return waiting;
  }
  const onReady=(event,value)=>{if(!owns(event)||!exact(value,['token'])||value.token!==token)return;clearTimeout(readyTimer);readyResolve?.();readyResolve=null;readyReject=null;};
  const onReply=(event,value)=>{
    if(!authenticated(event,value))return;
    const m=value.message,h=m?.nativeLiveHost,p=pending.get(h?.id);
    if(!exact(m,['nativeLiveHost'])||!p||h.version!==1||h.kind!=='response'||h.operation!==p.operation||
      !(exact(h,['version','kind','id','operation','result'])||exact(h,['version','kind','id','operation','error'])&&errors.has(h.error)))return;
    pending.delete(h.id);clearTimeout(p.timer);
    if(h.error)p.reject(Error(h.error));
    else if(!resultValid(h.operation,h.result))p.reject(Error('live_media_protocol'));
    else {if(h.operation==='state')lastState=structuredClone(h.result);p.resolve(h.result);}
  };
  const onEvent=(event,value)=>{
    if(!authenticated(event,value))return;
    const m=value.message,h=m?.nativeLiveHost,p=h?.payload;
    if(!exact(m,['nativeLiveHost'])||!exact(h,['version','kind','id','operation','payload'])||h.version!==1||h.kind!=='event'||!uuid(h.id))return;
    if(now()-rateAt>=1000){rateAt=now();rate=0;}if(++rate>LIMITS.eventsPerSecond){failed();return;}
    if(h.operation==='state'){if(!exact(p,['sessionId','state'])||(p.sessionId!==null&&p.sessionId!==currentSession)||!resultValid('state',p.state))return;lastState=structuredClone(p.state);}
    else if(h.operation==='provider-event'){if(!exact(p,['sessionId','event'])||p.sessionId!==currentSession||!p.event||typeof p.event!=='object'||Array.isArray(p.event)||Buffer.byteLength(JSON.stringify(p.event))>65536)return;}
    else if(h.operation==='connection-lost'){if(!exact(p,['sessionId'])||p.sessionId!==currentSession)return;currentSession=null;}
    else return;
    publish(m);
  };
  ipcMain.on(CHANNEL+'-ready',onReady);ipcMain.on(CHANNEL+'-reply',onReply);ipcMain.on(CHANNEL+'-event',onEvent);
  async function request(h) {
    const startedGeneration=generation;
    // Teardown is native-owned: it cannot wait behind a stalled preload or media permission.
    // Destroying this window releases its tracks; it is not a provider finalization acknowledgment.
    if(h.operation==='dispose'){reset('live_media_closed',true);return null;}
    const quiesce=h.operation==='quiesceCapture'||h.operation==='quiesceAll';
    if(quiesce){
      if(h.operation==='quiesceCapture'&&(h.payload.attemptId!==currentAttempt||h.payload.sessionId!==undefined&&h.payload.sessionId!==currentSession))throw Error('live_media_protocol');
      permissionDepth=0;if(!win)return null;win.webContents.setAudioMuted(true);
      generation++;
    }
    if(h.operation==='state'&&!win)return structuredClone(lastState);
    if(h.operation==='prepare'){
      const expiry=attempts.get(h.payload.attemptId);attempts.delete(h.payload.attemptId);
      if(!expiry||expiry<now())throw Error('live_media_protocol');
      currentAttempt=h.payload.attemptId;
    }
    if(h.operation==='connect'){if(currentSession)throw Error('live_media_backpressure');currentSession=h.payload.sessionId;}
    if(['send','close'].includes(h.operation)&&h.payload.sessionId!==currentSession)throw Error('live_media_protocol');
    await ensureWindow();
    if(['prepare','connect','setInputDevice'].includes(h.operation)&&startedGeneration!==generation)throw Error('live_media_closed');
    if(h.operation==='prepare'&&!syntheticInput)win.webContents.setAudioMuted(false);
    const microphoneOperation=['prepare','setInputDevice'].includes(h.operation);if(microphoneOperation)permissionDepth++;
    try{return await new Promise((resolve,reject)=>{
      if(pending.size>=(h.operation==='quiesceAll'?12:cleanup(h)?11:LIMITS.inFlight))return reject(Error('live_media_backpressure'));
      const timer=setTimeout(()=>{pending.delete(h.id);reject(Error('live_media_timeout'));failed();},quiesce?500:LIMITS.timeoutMs);
      pending.set(h.id,{operation:h.operation,resolve,reject,timer});
      try{win.webContents.send(CHANNEL+'-command',{token,message:{nativeLiveHost:h}});}catch{clearTimeout(timer);pending.delete(h.id);reject(Error('live_media_closed'));}
    });}finally{if(microphoneOperation)permissionDepth=Math.max(0,permissionDepth-1);if(h.operation==='close')currentSession=null;}
  }
  return {
    /** Native master switch only. It bypasses Core/worker capacity and never opens a media window. */
    quiesceAll(){if(quiesceFlight)return quiesceFlight;attempts.clear();const h={version:1,kind:'request',id:randomUUID(),operation:'quiesceAll',payload:{}};
      const work=request(h).then(()=>undefined);quiesceFlight=work;void work.finally(()=>{if(quiesceFlight===work)quiesceFlight=null;}).catch(()=>{});return work;},
    authorizeAttempt(attemptId){if(closed||!uuid(attemptId))throw Error('live_media_protocol');for(const [key,expiry]of attempts)if(expiry<now())attempts.delete(key);if(attempts.size>=8)throw Error('live_media_backpressure');attempts.set(attemptId,now()+30000);},
    handle(value){
      if(!value||!Object.hasOwn(value,'nativeLiveHost'))return false;
      if(!validRequest(value))return true;
      const h=structuredClone(value.nativeLiveHost);
      if(closed){response(h,null,'live_media_closed');return true;}
      if(seen.has(h.id)||activeRequests>=(cleanup(h)?11:LIMITS.inFlight)&&h.operation!=='dispose'){response(h,null,'live_media_backpressure');return true;}
      seen.add(h.id);if(seen.size>512)seen.delete(seen.values().next().value);
      activeRequests++;const requestGeneration=generation;
      void request(h).then(result=>{response(h,result);}).catch(error=>{response(h,null,errors.has(error?.message)?error.message:'live_media_operation_failed');if(['prepare','connect'].includes(h.operation)&&win&&requestGeneration===generation)reset();}).finally(()=>activeRequests--);
      return true;
    },
    close(){if(closed)return;closed=true;attempts.clear();seen.clear();reset();ipcMain.removeListener(CHANNEL+'-ready',onReady);ipcMain.removeListener(CHANNEL+'-reply',onReply);ipcMain.removeListener(CHANNEL+'-event',onEvent);},
  };
}
module.exports={createLiveMediaBroker,validRequest,LIMITS,CHANNEL,isSyntheticLiveMediaWindow};
