const {randomBytes,randomUUID,createHash}=require('node:crypto');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const fs=require('node:fs');
const {performance}=require('node:perf_hooks');
const CHANNEL='aerynth-private-wake-capture';
const LIMITS=Object.freeze({frameSamples:640,sampleRate:16000,pendingFrames:4,framesPerSecond:64,grantMs:30000,timeoutMs:10000,fixtureBytes:2097152});
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value))&&
  Reflect.ownKeys(value).length===keys.length&&keys.every(key=>Object.hasOwn(Object.getOwnPropertyDescriptor(value,key)??{},'value'));
const gen=value=>Number.isSafeInteger(value)&&value>0;
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value);
const filename=value=>typeof value==='string'?value.replaceAll('\\','/').split('/').at(-1):null;
const absolute=value=>typeof value==='string'&&(path.isAbsolute(value)||path.win32.isAbsolute(value));
function validFrame(value){
  try{
    if(!exact(value,['generation','sequence','startSample','sampleRate','samples','signalActivity','rms','mode'])||!gen(value.generation)||
      !Number.isSafeInteger(value.sequence)||value.sequence<0||!Number.isSafeInteger(value.startSample)||value.startSample!==value.sequence*640||
      value.sampleRate!==16000||!(value.samples instanceof Float32Array)||value.samples.buffer instanceof SharedArrayBuffer||
      value.samples.length!==640||value.samples.byteLength!==2560||!['quiet','signal'].includes(value.signalActivity)||!['detector','handoff'].includes(value.mode)||
      !Number.isFinite(value.rms)||value.rms<0||value.rms>1||!value.samples.every(sample=>Number.isFinite(sample)&&Math.abs(sample)<=1))return false;
    let square=0;for(const sample of value.samples)square+=sample*sample;const rms=Math.sqrt(square/640);
    return Math.abs(rms-value.rms)<=1e-6&&value.signalActivity===(rms>=0.01?'signal':'quiet');
  }catch{return false;}
}
function validState(value){
  return exact(value,['contract','generation','phase','microphone','sampleRate','inputDevice','frames','pendingFrames','signalActivity','activitySource',...(Object.hasOwn(value??{},'errorCode')?['errorCode']:[])])&&
    value.contract==='aerynth.wake-audio-capture@1'&&(value.generation===null||gen(value.generation))&&['off','arming','capturing','handoff','stopped','failed','disposed'].includes(value.phase)&&
    ['off','requesting','active','released','unknown'].includes(value.microphone)&&(value.sampleRate===null||value.sampleRate===16000)&&
    ['default','selected'].includes(value.inputDevice)&&Number.isSafeInteger(value.frames)&&value.frames>=0&&Number.isSafeInteger(value.pendingFrames)&&value.pendingFrames>=0&&value.pendingFrames<=4&&
    ['unavailable','quiet','signal'].includes(value.signalActivity)&&value.activitySource==='local-rms-only'&&
    (value.errorCode===undefined||['wake_capture_start_failed','wake_capture_processor_failed','wake_capture_device_ended','wake_capture_frame_invalid','wake_capture_frame_delivery_failed'].includes(value.errorCode));
}
function qaSource(qa){
  if(!qa)return null;
  const base=qa.localAppData??process.env.LOCALAPPDATA,profile=qa.profileDirectory;
  if(!qa.syntheticInput||!base||!absolute(profile)||!/^review-vela-missions-\d+$/u.test(path.basename(profile))||
    path.resolve(path.dirname(profile)).toLowerCase()!==path.resolve(base,'Aerynth').toLowerCase()||
    !Array.isArray(qa.argv)||!qa.argv.includes('--integration-vela-missions')||!qa.argv.includes('--wake-synthetic-input')||
    fs.lstatSync(profile).isSymbolicLink()||fs.realpathSync(profile).toLowerCase()!==path.resolve(profile).toLowerCase())throw Error('wake_media_owned_qa_required');
  if(!qa.fixture)return null;
  const value=qa.fixture;
  if(!exact(value,['sampleRate','samples','sha256'])||value.sampleRate!==16000||!(value.samples instanceof Float32Array)||value.samples.buffer instanceof SharedArrayBuffer||
    value.samples.length<1||value.samples.byteLength>LIMITS.fixtureBytes||!value.samples.every(sample=>Number.isFinite(sample)&&Math.abs(sample)<=1)||
    typeof value.sha256!=='string'||!/^[a-f0-9]{64}$/u.test(value.sha256)||
    createHash('sha256').update(Buffer.from(value.samples.buffer,value.samples.byteOffset,value.samples.byteLength)).digest('hex')!==value.sha256)throw Error('wake_media_qa_fixture_invalid');
  return new Float32Array(value.samples);
}
/** Private native-only local capture transport. No PCM enters application UI, state, logs or disk. */
function createWakeMediaBroker({BrowserWindow,ipcMain,preloadPath,htmlPath,workletPath,onFrame,onState,qa,now=()=>performance.now()}){
  if(![preloadPath,htmlPath,workletPath].every(absolute)||filename(preloadPath)!=='vela-wake-capture-preload.cjs'||
    filename(htmlPath)!=='wake-media.html'||filename(workletPath)!=='vela-wake-pcm-worklet.js'||typeof onFrame!=='function')throw Error('wake_media_paths_invalid');
  const fixture=qaSource(qa),url=pathToFileURL(htmlPath).href,workletUrl=pathToFileURL(workletPath).href;
  let win=null,token=null,closed=false,activeGeneration=null,lastGeneration=0,permission=false,controller=null;
  let ready=null,readyResolve,readyReject,readyTimer,sequence=0,rate=0,rateAt=now(),processing=null,mode='detector';
  const grants=new Map(),pending=new Map(),queue=[];
  let view={contract:'aerynth.wake-audio-capture@1',generation:null,phase:'off',microphone:'off',sampleRate:null,inputDevice:'default',
    frames:0,pendingFrames:0,signalActivity:'unavailable',activitySource:'local-rms-only'};
  const publish=()=>{try{onState?.(structuredClone(view));}catch{/* A consumer cannot prevent release. */}};
  const owns=event=>win&&!win.isDestroyed()&&!win.webContents.isDestroyed()&&event.sender===win.webContents&&event.senderFrame===win.webContents.mainFrame&&event.senderFrame?.url===url;
  const authenticated=(event,value)=>owns(event)&&exact(value,['token','value'])&&value.token===token;
  const reset=(code,disposed=false)=>{
    activeGeneration=null;permission=false;controller?.abort();controller=null;
    for(const value of queue)value.frame.samples.fill(0);queue.splice(0);processing?.frame.samples.fill(0);processing=null;
    clearTimeout(readyTimer);readyReject?.(Error(code??'wake_media_stopped'));ready=null;readyResolve=readyReject=null;
    for(const value of pending.values()){clearTimeout(value.timer);value.reject(Error(code??'wake_media_stopped'));}pending.clear();
    const prior=win;win=null;token=null;if(prior&&!prior.isDestroyed())prior.destroy();
    view={...view,phase:disposed?'disposed':code?'failed':'stopped',microphone:'released',sampleRate:null,pendingFrames:0,signalActivity:'unavailable'};
    if(code)view.errorCode='wake_capture_frame_delivery_failed';else delete view.errorCode;publish();
  };
  const crash=()=>reset('wake_media_failed');
  async function ensureWindow(){
    if(closed)throw Error('wake_media_disposed');if(ready)return ready;
    token=randomBytes(32).toString('hex');ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});const waiting=ready;
    win=new BrowserWindow({show:false,focusable:false,skipTaskbar:true,width:1,height:1,webPreferences:{preload:preloadPath,contextIsolation:true,nodeIntegration:false,
      sandbox:true,webSecurity:true,backgroundThrottling:false,autoplayPolicy:'no-user-gesture-required',webviewTag:false,spellcheck:false,
      partition:'aerynth-wake-capture-'+randomUUID(),additionalArguments:[
        '--aerynth-wake-token='+token,'--aerynth-wake-worklet='+workletUrl,...(qa?['--aerynth-wake-synthetic']:[])]}});
    const wc=win.webContents,session=wc.session;wc.setAudioMuted(true);wc.setWindowOpenHandler(()=>({action:'deny'}));
    for(const event of ['will-navigate','will-frame-navigate','will-attach-webview'])wc.on(event,value=>value.preventDefault());
    wc.on('render-process-gone',()=>{if(win?.webContents===wc)crash();});wc.on('destroyed',()=>{if(win?.webContents===wc)crash();});
    const permitted=(owner,kind,details)=>!qa&&permission&&activeGeneration!==null&&owner===wc&&kind==='media'&&wc.getURL()===url&&details?.requestingUrl===url&&details.isMainFrame===true;
    session.setPermissionRequestHandler((owner,kind,callback,details)=>callback(permitted(owner,kind,details)&&Array.isArray(details.mediaTypes)&&details.mediaTypes.length===1&&details.mediaTypes[0]==='audio'));
    session.setPermissionCheckHandler((owner,kind,_origin,details)=>permitted(owner,kind,details)&&details.mediaType==='audio');
    session.setDevicePermissionHandler?.(()=>false);
    session.webRequest?.onBeforeRequest((details,callback)=>callback({cancel:![url,workletUrl].includes(details.url)}));
    readyTimer=setTimeout(()=>{if(win?.webContents===wc)reset('wake_media_timeout');},LIMITS.timeoutMs);
    try{void win.loadURL(url).catch(()=>{if(win?.webContents===wc)reset('wake_media_load_failed');});}
    catch{if(win?.webContents===wc)reset('wake_media_load_failed');}return waiting;
  }
  const request=(operation,payload)=>new Promise((resolve,reject)=>{
    if(!win||closed)return reject(Error('wake_media_stopped'));if(pending.size>=4)return reject(Error('wake_media_capacity'));
    const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('wake_media_timeout'));reset('wake_media_timeout');},LIMITS.timeoutMs);
    pending.set(id,{resolve,reject,timer,operation});try{win.webContents.send(CHANNEL+'-command',{token,value:{nativeWakeCapture:{version:1,kind:'request',id,operation,payload}}});}
    catch{clearTimeout(timer);pending.delete(id);reject(Error('wake_media_stopped'));}
  });
  const onReady=(event,value)=>{if(!owns(event)||!exact(value,['token'])||value.token!==token)return;clearTimeout(readyTimer);readyResolve?.();readyResolve=readyReject=null;};
  const onReply=(event,value)=>{
    if(!authenticated(event,value))return;const message=value.value,h=message?.nativeWakeCapture,entry=pending.get(h?.id);
    if(!exact(message,['nativeWakeCapture'])||!entry||!uuid(h.id)||h.version!==1||h.kind!=='response'||h.operation!==entry.operation||
      !(exact(h,['version','kind','id','operation','result'])||exact(h,['version','kind','id','operation','error'])&&
        ['wake_capture_closed','wake_capture_busy','wake_capture_operation_failed'].includes(h.error)))return;
    clearTimeout(entry.timer);pending.delete(h.id);
    if(h.error)entry.reject(Error(h.error));else if(!validState(h.result)||h.result.generation!==activeGeneration)entry.reject(Error('wake_media_protocol'));
    else{view={...structuredClone(h.result),frames:Math.max(view.frames,h.result.frames),pendingFrames:queue.length+(processing?1:0)};publish();entry.resolve(structuredClone(view));}
  };
  const onObservedState=(event,value)=>{
    if(!authenticated(event,value)||!validState(value.value)||value.value.generation!==activeGeneration||value.value.phase==='handoff'&&mode!=='handoff')return;
    view={...structuredClone(value.value),frames:Math.max(view.frames,value.value.frames),pendingFrames:queue.length+(processing?1:0)};publish();if(view.phase==='failed')reset('wake_media_capture_failed');
  };
  async function drain(){
    if(processing||!queue.length)return;const job=queue.shift();processing=job;
    try{await onFrame(job.frame,job.signal);
      if(activeGeneration===job.frame.generation&&!job.signal.aborted&&win){win.webContents.send(CHANNEL+'-ack',{token,value:{generation:job.frame.generation,sequence:job.frame.sequence}});}
    }catch{if(activeGeneration===job.frame.generation&&!job.signal.aborted)reset('wake_media_frame_failed');}
    finally{job.frame.samples.fill(0);if(processing===job)processing=null;
      if(activeGeneration===job.frame.generation)view={...view,pendingFrames:queue.length+(processing?1:0)};void drain();}
  }
  const onPcm=(event,value)=>{
    if(!authenticated(event,value))return;const frame=value.value;
    if(!validFrame(frame)||frame.generation!==activeGeneration||frame.sequence!==sequence||frame.mode!==mode){reset('wake_media_pcm_invalid');return;}
    const stamp=now();if(stamp<rateAt){reset('wake_media_clock_invalid');return;}if(stamp-rateAt>=1000){rateAt=stamp;rate=0;}
    if(++rate>LIMITS.framesPerSecond||queue.length+(processing?1:0)>=4){frame.samples.fill(0);reset('wake_media_pcm_capacity');return;}
    sequence++;queue.push({frame,signal:controller.signal});view={...view,frames:sequence,pendingFrames:queue.length+(processing?1:0),signalActivity:frame.signalActivity};void drain();
  };
  ipcMain.on(CHANNEL+'-ready',onReady);ipcMain.on(CHANNEL+'-reply',onReply);ipcMain.on(CHANNEL+'-state',onObservedState);ipcMain.on(CHANNEL+'-frame',onPcm);
  return {
    authorizeArm(generation){
      if(closed||!gen(generation)||generation<=lastGeneration)throw Error('wake_media_generation');
      for(const [id,grant]of grants)if(grant.expires<now())grants.delete(id);
      if(grants.size>=4)throw Error('wake_media_grant_capacity');const ref=randomUUID();grants.set(ref,{generation,expires:now()+LIMITS.grantMs});return ref;
    },
    async arm(input,grantRef){
      if(!exact(input,['generation',...(Object.hasOwn(input??{},'inputDeviceId')?['inputDeviceId']:[])])||!gen(input.generation)||input.inputDeviceId!==undefined&&
        (typeof input.inputDeviceId!=='string'||!input.inputDeviceId.length||input.inputDeviceId.length>256||/[\x00-\x1f]/u.test(input.inputDeviceId)))throw Error('wake_media_input');
      const grant=grants.get(grantRef);grants.delete(grantRef);
      if(closed||!grant||grant.expires<now()||grant.generation!==input.generation||input.generation<=lastGeneration)throw Error('wake_media_arm_grant_required');
      if(win)reset();lastGeneration=input.generation;activeGeneration=input.generation;sequence=0;rate=0;rateAt=now();controller=new AbortController();permission=true;mode='detector';
      view={...view,generation:input.generation,phase:'arming',microphone:'requesting',sampleRate:null,inputDevice:input.inputDeviceId?'selected':'default',frames:0,pendingFrames:0};delete view.errorCode;publish();
      try{await ensureWindow();if(activeGeneration!==input.generation)throw Error('wake_media_stopped');
        if(fixture)win.webContents.send(CHANNEL+'-qa-source',{token,value:{sampleRate:16000,samples:new Float32Array(fixture)}});
        const result=await request('arm',input);if(result.phase!=='capturing'||result.microphone!=='active'||result.sampleRate!==16000)throw Error('wake_media_arm_failed');return result;
      }catch{if(activeGeneration===input.generation)reset('wake_media_arm_failed');throw Error('wake_media_arm_failed');}
      finally{if(activeGeneration===input.generation)permission=false;}
    },
    async pause({generation}){if(generation!==activeGeneration)throw Error('wake_media_generation');mode='handoff';return request('pause',{generation});},
    stop(input={}){if(!exact(input,Object.hasOwn(input,'generation')?['generation']:[])||input.generation!==undefined&&!gen(input.generation))throw Error('wake_media_input');
      if(input.generation!==undefined&&input.generation!==activeGeneration)return structuredClone(view);
      // Destroy is immediate and bypasses every pending command/permission/capacity queue.
      reset();return structuredClone(view);},
    state(){return structuredClone(view);},
    dispose(){if(closed)return;closed=true;grants.clear();reset(undefined,true);fixture?.fill(0);
      ipcMain.removeListener(CHANNEL+'-ready',onReady);ipcMain.removeListener(CHANNEL+'-reply',onReply);ipcMain.removeListener(CHANNEL+'-state',onObservedState);ipcMain.removeListener(CHANNEL+'-frame',onPcm);},
  };
}
module.exports={createWakeMediaBroker,validFrame,validState,LIMITS,CHANNEL};
