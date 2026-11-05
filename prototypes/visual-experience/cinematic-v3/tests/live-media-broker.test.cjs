const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {randomUUID}=require('node:crypto');
const {createLiveMediaBroker,CHANNEL,validRequest,isSyntheticLiveMediaWindow}=require('../native/live-media-broker.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const request=(operation,payload={})=>({nativeLiveHost:{version:1,kind:'request',id:randomUUID(),operation,payload}});
function fixture({syntheticInput=false,answer=true,wakeSource,wakeAck=true,loadError=false,authorizeOutputOnlyPrepare}={}){
  const ipcMain=new EventEmitter(),windows=[],sent=[],backend=[],pcm=[];
  class Window{
    constructor(options){this.options=options;this.dead=false;windows.push(this);const wc=new EventEmitter();this.webContents=wc;wc.mainFrame={url:''};wc.getURL=()=>wc.mainFrame.url;wc.isDestroyed=()=>this.dead;wc.setWindowOpenHandler=handler=>{wc.windowOpen=handler;};
      wc.session={setPermissionRequestHandler:fn=>{wc.permissionRequest=fn;},setPermissionCheckHandler:fn=>{wc.permissionCheck=fn;},setDevicePermissionHandler:fn=>{wc.devicePermission=fn;},webRequest:{onBeforeRequest:fn=>{wc.network=fn;}}};
      wc.setAudioMuted=value=>{wc.audioMuted=value;};wc.isAudioMuted=()=>wc.audioMuted===true;
      wc.send=(_name,value)=>{if(_name===CHANNEL+'-wake-pcm'){pcm.push(structuredClone(value));if(wakeAck)queueMicrotask(()=>ipcMain.emit(CHANNEL+'-wake-ack',this.event(),{token:this.token(),attemptId:value.frame.attemptId,startSample:value.frame.startSample,result:{accepted:true,nextSample:value.frame.startSample+value.frame.samples.length}}));return;}
        sent.push(value);if(!answer)return;const h=value.message.nativeLiveHost,result=h.operation==='prepare'?{offerId:'offer-fixture',sdpOffer:'v=0\r\nPRIVATE_OFFER'}:null;queueMicrotask(()=>ipcMain.emit(CHANNEL+'-reply',this.event(),{token:this.token(),message:{nativeLiveHost:{version:1,kind:'response',id:h.id,operation:h.operation,result}}}));};
    }
    token(){return this.options.webPreferences.additionalArguments[0].split('=')[1];}
    event(){return{sender:this.webContents,senderFrame:this.webContents.mainFrame};}
    isDestroyed(){return this.dead;}
    destroy(){this.dead=true;this.webContents.emit('destroyed');}
    async loadURL(url){if(loadError)throw Error('PRIVATE_LOAD_ERROR');this.webContents.mainFrame.url=url;queueMicrotask(()=>ipcMain.emit(CHANNEL+'-ready',this.event(),{token:this.token()}));}
  }
  const broker=createLiveMediaBroker({BrowserWindow:Window,ipcMain,send:wire=>backend.push(wire),preloadPath:'C:\\app\\dist\\vela-live-media-preload.cjs',htmlPath:'C:\\app\\native\\voice-media.html',syntheticInput,wakeSource,authorizeOutputOnlyPrepare});
  return{broker,ipcMain,windows,sent,backend,pcm,setAnswer(value){answer=value;}};
}
test('native media requires an owned one-use attempt and creates an isolated memory-partition window',async()=>{
  const f=fixture();try{
    f.broker.handle(request('prepare',{attemptId:randomUUID()}));await tick();assert.equal(f.windows.length,0);assert.equal(f.backend[0].nativeLiveHost.error,'live_media_protocol');
    const attemptId=randomUUID();f.broker.authorizeAttempt(attemptId);f.broker.handle(request('prepare',{attemptId}));await tick();
    const w=f.windows[0],p=w.options.webPreferences;assert.equal(w.options.show,false);assert.equal(w.options.focusable,false);assert.equal(p.sandbox,true);assert.equal(p.contextIsolation,true);assert.equal(p.nodeIntegration,false);assert.ok(!p.partition.startsWith('persist:'));assert.equal(p.webSecurity,true);assert.equal(w.webContents.windowOpen().action,'deny');
    assert.equal(f.backend.at(-1).nativeLiveHost.result.offerId,'offer-fixture');assert.equal(isSyntheticLiveMediaWindow(w),false);
    f.broker.handle(request('prepare',{attemptId}));await tick();assert.equal(f.backend.at(-1).nativeLiveHost.error,'live_media_protocol');
  }finally{f.broker.close();}assert.equal(f.ipcMain.listenerCount(CHANNEL+'-reply'),0);
});

test('standing speech media admission is private output-only, one-use, and rechecks close/generation after asynchronous approval',async()=>{
 let admissions=0;const f=fixture({authorizeOutputOnlyPrepare:async input=>{admissions++;assert.equal(input.outputOnly,true);return true;}});try{
  f.broker.handle(request('prepare',{attemptId:randomUUID()}));await tick();assert.equal(admissions,0);assert.equal(f.windows.length,0);
  const attemptId=randomUUID();f.broker.handle(request('prepare',{attemptId,outputOnly:true}));await tick();assert.equal(admissions,1);assert.equal(f.windows.length,1);assert.equal(f.backend.at(-1).nativeLiveHost.error,undefined);
  f.broker.handle(request('prepare',{attemptId,outputOnly:true}));await tick();assert.equal(admissions,1);assert.equal(f.backend.at(-1).nativeLiveHost.error,'live_media_protocol');
 }finally{f.broker.close();}
 const declined=fixture({authorizeOutputOnlyPrepare:async()=>false});try{declined.broker.handle(request('prepare',{attemptId:randomUUID(),outputOnly:true}));await tick();assert.equal(declined.windows.length,0);assert.equal(declined.backend.at(-1).nativeLiveHost.error,'live_media_protocol');}finally{declined.broker.close();}
 for(const close of [true,false]){let release;const pending=fixture({authorizeOutputOnlyPrepare:()=>new Promise(resolve=>{release=resolve;})});try{pending.broker.handle(request('prepare',{attemptId:randomUUID(),outputOnly:true}));await tick();if(close)pending.broker.close();else pending.broker.handle(request('dispose'));await tick();release(true);await tick();assert.equal(pending.windows.length,0);}finally{pending.broker.close();}}
 const normal=fixture({authorizeOutputOnlyPrepare:async()=>{throw Error('must not call standing grant');}});try{const attemptId=randomUUID();normal.broker.authorizeAttempt(attemptId);normal.broker.handle(request('prepare',{attemptId,outputOnly:true}));await tick();assert.equal(normal.windows.length,1);}finally{normal.broker.close();}
});

test('native master quiesce creates no window and bypasses8 normal requests while preserving provider finalization',async()=>{
  const f=fixture();try{
    await f.broker.quiesceAll();assert.equal(f.windows.length,0);
    const attemptId=randomUUID();f.broker.authorizeAttempt(attemptId);f.broker.handle(request('prepare',{attemptId}));await tick();f.broker.handle(request('connect',{sessionId:'session-kept',sdpAnswer:'v=0'}));await tick();
    const w=f.windows[0];f.setAnswer(false);for(let i=0;i<8;i++)f.broker.handle(request('devices'));await tick();
    const quiesce=f.broker.quiesceAll(),same=f.broker.quiesceAll();assert.equal(quiesce,same);await tick();
    const h=f.sent.at(-1).message.nativeLiveHost;assert.equal(h.operation,'quiesceAll');assert.equal(w.webContents.isAudioMuted(),true);
    f.ipcMain.emit(CHANNEL+'-reply',w.event(),{token:w.token(),message:{nativeLiveHost:{version:1,kind:'response',id:h.id,operation:h.operation,result:null}}});await quiesce;
    assert.equal(w.isDestroyed(),false);
    const close=request('send',{sessionId:'session-kept',command:{type:'session.close',event_id:'finish'}});f.broker.handle(close);await tick();assert.equal(f.sent.at(-1).message.nativeLiveHost.id,close.nativeLiveHost.id);
    const before=f.backend.length;f.broker.handle(request('quiesceCapture',{attemptId:'old',sessionId:'session-kept'}));await tick();assert.equal(f.backend.at(-1).nativeLiveHost.error,'live_media_protocol');assert.equal(f.backend.length,before+1);
  }finally{f.broker.close();await tick();}
});

test('unanswered native master quiesce physically tears down only its owned media window within the bounded fallback',async()=>{
  const f=fixture();try{const attemptId=randomUUID();f.broker.authorizeAttempt(attemptId);f.broker.handle(request('prepare',{attemptId}));await tick();const w=f.windows[0];f.setAnswer(false);
    await assert.rejects(f.broker.quiesceAll(),/live_media_timeout/);assert.equal(w.isDestroyed(),true);
  }finally{f.broker.close();}
});
test('private IPC rejects foreign frames and wrong tokens; only audio gets an active attempt permission',async()=>{
  const f=fixture({answer:false});try{
    const attemptId=randomUUID();f.broker.authorizeAttempt(attemptId);const req=request('prepare',{attemptId});f.broker.handle(req);await tick();const w=f.windows[0],wc=w.webContents;
    const permission=(types,owner=wc)=>{let allowed;wc.permissionRequest(owner,'media',value=>{allowed=value;},{mediaTypes:types,isMainFrame:true,requestingUrl:wc.getURL()});return allowed;};
    assert.equal(permission(['audio']),true);assert.equal(permission(['video']),false);assert.equal(permission(['audio','video']),false);assert.equal(permission(['audio'],{}),false);
    assert.equal(wc.permissionCheck(wc,'media','file://',{mediaType:'audio',isMainFrame:true,requestingUrl:wc.getURL()}),true);assert.equal(wc.permissionCheck(wc,'media','file://',{mediaType:'video',isMainFrame:true}),false);assert.equal(wc.devicePermission(),false);
    const reply={nativeLiveHost:{...req.nativeLiveHost,kind:'response',result:{offerId:'owned',sdpOffer:'v=0'}}};delete reply.nativeLiveHost.payload;
    for(const [event,token]of [[{sender:{},senderFrame:wc.mainFrame},w.token()],[{sender:wc,senderFrame:{url:wc.getURL()}},w.token()],[w.event(),'wrong']])f.ipcMain.emit(CHANNEL+'-reply',event,{token,message:reply});
    await tick();assert.equal(f.backend.length,0);
    f.ipcMain.emit(CHANNEL+'-reply',w.event(),{token:w.token(),message:reply});await tick();assert.equal(f.backend.length,1);assert.equal(permission(['audio']),false);
    let cancel;wc.network({url:'https://example.invalid'},value=>{cancel=value.cancel;});assert.equal(cancel,true);
    const nav={preventDefault(){this.prevented=true;}};wc.emit('will-frame-navigate',nav);assert.equal(nav.prevented,true);
  }finally{f.broker.close();}
});
test('session event provenance and crash cleanup are native-owned, with bounded pre-ready requests',async()=>{
  const f=fixture();try{
    const attemptId=randomUUID();f.broker.authorizeAttempt(attemptId);f.broker.handle(request('prepare',{attemptId}));await tick();f.broker.handle(request('connect',{sessionId:'session-a',sdpAnswer:'v=0 PRIVATE_ANSWER'}));await tick();const w=f.windows[0];
    const event=sessionId=>({nativeLiveHost:{version:1,kind:'event',id:randomUUID(),operation:'provider-event',payload:{sessionId,event:{type:'session.started'}}}});
    f.ipcMain.emit(CHANNEL+'-event',w.event(),{token:w.token(),message:event('foreign')});await tick();assert.equal(f.backend.length,2);
    f.ipcMain.emit(CHANNEL+'-event',w.event(),{token:w.token(),message:event('session-a')});assert.equal(f.backend.at(-1).nativeLiveHost.operation,'provider-event');
    w.webContents.emit('render-process-gone');assert.equal(w.dead,true);assert.equal(f.backend.at(-1).nativeLiveHost.operation,'connection-lost');
    assert.equal(JSON.stringify(f.backend.filter(v=>v.nativeLiveHost.kind==='event')).includes('PRIVATE_'),false);
  }finally{f.broker.close();}
  const blocked=fixture({answer:false});try{for(let i=0;i<9;i++)blocked.broker.handle(request('devices'));await tick();assert.equal(blocked.backend.at(-1).nativeLiveHost.error,'live_media_backpressure');}finally{blocked.broker.close();await tick();}
});
test('synthetic QA never grants ambient audio and private protocol rejects credentials/oversized input',async()=>{
  const f=fixture({syntheticInput:true,answer:false});try{const attemptId=randomUUID();f.broker.authorizeAttempt(attemptId);f.broker.handle(request('prepare',{attemptId}));await tick();const w=f.windows[0];let allowed;w.webContents.permissionRequest(w.webContents,'media',value=>{allowed=value;},{mediaTypes:['audio']});assert.equal(allowed,false);assert.ok(w.options.webPreferences.additionalArguments.includes('--aerynth-live-media-synthetic'));assert.equal(w.webContents.isAudioMuted(),true);assert.equal(isSyntheticLiveMediaWindow(w),true);}finally{f.broker.close();await tick();}
  for(const value of [request('prepare',{attemptId:'x',apiKey:'PRIVATE'}),request('connect',{sessionId:'s',sdpAnswer:'x'.repeat(65537)}),request('send',{sessionId:'s',command:{type:'session.update',event_id:'x'}}),request('state',{nativeGrant:true})])assert.equal(validRequest(value),false);
});

test('output-only preparation has no microphone permission window and rejects input switching',async()=>{
  const f=fixture({answer:false});try{
    const attemptId=randomUUID();f.broker.authorizeAttempt(attemptId);const prepare=request('prepare',{attemptId,outputOnly:true});
    assert.equal(validRequest(prepare),true);f.broker.handle(prepare);await tick();const w=f.windows[0],wc=w.webContents;
    let allowed;wc.permissionRequest(wc,'media',value=>{allowed=value;},{mediaTypes:['audio'],isMainFrame:true,requestingUrl:wc.getURL()});assert.equal(allowed,false);
    assert.equal(wc.permissionCheck(wc,'media','file://',{mediaType:'audio',isMainFrame:true,requestingUrl:wc.getURL()}),false);
    assert.equal(w.options.webPreferences.autoplayPolicy,'no-user-gesture-required');
    const before=f.sent.length;f.broker.handle(request('setInputDevice',{deviceId:'mic-A'}));await tick();
    assert.equal(f.sent.length,before);assert.equal(f.backend.at(-1).nativeLiveHost.error,'live_media_protocol');
    assert.equal(f.sent[0].message.nativeLiveHost.payload.outputOnly,true);
    for(const payload of [{attemptId,outputOnly:false},{attemptId,outputOnly:true,inputDeviceId:'mic'},{attemptId,outputOnly:true,bufferLeaseRef:'lease'}])assert.equal(validRequest(request('prepare',payload)),false);
  }finally{f.broker.close();await tick();}
});

test('private state events reject extra diagnostics and invalid media, and provider events must be objects',async()=>{
  const f=fixture();try{
    const attemptId=randomUUID();f.broker.authorizeAttempt(attemptId);f.broker.handle(request('prepare',{attemptId}));await tick();
    f.broker.handle(request('connect',{sessionId:'session-a',sdpAnswer:'v=0'}));await tick();const w=f.windows[0];
    const state={contract:'aerynth.gpt-live-media@1',connection:'connected',microphoneAccess:'active',localTrackEnabled:true,localSourceMuted:false,providerInputMute:'unmuted',playback:'idle',playbackObserved:false,humanAudibility:'unverified',inputDevice:'default',outputDevice:'default',localSpeech:'silent',remoteSignal:'unavailable',interruption:'none'};
    const publish=(operation,payload)=>f.ipcMain.emit(CHANNEL+'-event',w.event(),{token:w.token(),message:{nativeLiveHost:{version:1,kind:'event',id:randomUUID(),operation,payload}}});
    const before=f.backend.length;
    for(const invalid of [{...state,rawDiagnostics:'PRIVATE'}, {...state,humanAudibility:'heard'},null])publish('state',{sessionId:'session-a',state:invalid});
    publish('provider-event',{sessionId:'session-a',event:[]});assert.equal(f.backend.length,before);
    publish('state',{sessionId:'session-a',state});assert.equal(f.backend.length,before+1);assert.deepEqual(f.backend.at(-1).nativeLiveHost.payload.state,state);
  }finally{f.broker.close();}
});

test('private result validation rejects unsolicited prepare fields and releases its owned window',async()=>{
  const f=fixture({answer:false});try{
    const attemptId=randomUUID();f.broker.authorizeAttempt(attemptId);const req=request('prepare',{attemptId});f.broker.handle(req);await tick();const w=f.windows[0];
    f.ipcMain.emit(CHANNEL+'-reply',w.event(),{token:w.token(),message:{nativeLiveHost:{version:1,kind:'response',id:req.nativeLiveHost.id,operation:'prepare',result:{offerId:'offer-a',sdpOffer:'v=0',rawDiagnostics:'PRIVATE'}}}});
    await tick();assert.equal(f.backend.at(-1).nativeLiveHost.error,'live_media_protocol');assert.equal(w.isDestroyed(),true);assert.equal(JSON.stringify(f.backend).includes('PRIVATE'),false);
  }finally{f.broker.close();}
});

test('state polling never creates a window and native dispose cancels an unanswered preparation',async()=>{
  const f=fixture({answer:false});try{
    f.broker.handle(request('state'));await tick();assert.equal(f.windows.length,0);assert.equal(f.backend.at(-1).nativeLiveHost.result.microphoneAccess,'not-requested');
    const attemptId=randomUUID();f.broker.authorizeAttempt(attemptId);const prepare=request('prepare',{attemptId});f.broker.handle(prepare);await tick();const w=f.windows[0];
    for(let index=0;index<7;index++)f.broker.handle(request('devices'));await tick();
    const dispose=request('dispose');f.broker.handle(dispose);await tick();
    assert.equal(w.isDestroyed(),true);assert.equal(f.backend.find(wire=>wire.nativeLiveHost.id===dispose.nativeLiveHost.id).nativeLiveHost.result,null);
    assert.equal(f.backend.find(wire=>wire.nativeLiveHost.id===prepare.nativeLiveHost.id).nativeLiveHost.error,'live_media_closed');
    f.broker.handle(request('state'));await tick();assert.equal(f.windows.length,1);assert.equal(f.backend.at(-1).nativeLiveHost.result.connection,'disposed');assert.equal(f.backend.at(-1).nativeLiveHost.result.localTrackEnabled,false);
  }finally{f.broker.close();}
});

test('wake preparation waits for authenticated command-prefix acceptance before enabling paid transport',async()=>{
  let feed;const released=[],prefix=new Float32Array([.2,.4]);
  const f=fixture({wakeAck:false,wakeSource:{claimLive(ref,attempt,callback){assert.equal(ref,'opaque-main-lease');feed=callback;return{samples:prefix,release(){prefix.fill(0);}};},releaseLive:attempt=>released.push(attempt)}});
  const attemptId=randomUUID();try{
    const prepare=request('prepare',{attemptId,bufferLeaseRef:'opaque-main-lease'});f.broker.handle(prepare);await tick();
    assert.equal(f.backend.length,0,'no prepare offer may reach Core until its prefix is accepted');assert.equal(f.pcm.length,1);assert.deepEqual([...prefix],[0,0]);
    const w=f.windows[0],packet=f.pcm[0],ack={token:w.token(),attemptId,startSample:0,result:{accepted:true,nextSample:2}};
    assert(w.options.webPreferences.additionalArguments.includes('--aerynth-live-wake-input'));
    for(const [event,token]of [[{sender:{},senderFrame:w.webContents.mainFrame},w.token()],[w.event(),'foreign']])f.ipcMain.emit(CHANNEL+'-wake-ack',event,{...ack,token});
    await tick();assert.equal(f.backend.length,0);
    f.ipcMain.emit(CHANNEL+'-wake-ack',w.event(),ack);await tick();assert.equal(f.backend.at(-1).nativeLiveHost.result.offerId,'offer-fixture');
    await feed({startSample:2,samples:new Float32Array([.6])});await tick();assert.equal(f.pcm[1].frame.startSample,2);
    f.ipcMain.emit(CHANNEL+'-wake-ack',w.event(),{...ack,startSample:2,result:{accepted:true,nextSample:3}});await tick();
    f.broker.handle(request('connect',{sessionId:'wake-owned',sdpAnswer:'v=0'}));await tick();
    f.broker.wakeSourceLost('stale-attempt');assert.equal(w.isDestroyed(),false);
    f.broker.wakeSourceLost(attemptId);assert.equal(w.isDestroyed(),true);assert.deepEqual(released,[attemptId]);assert.equal(f.backend.at(-1).nativeLiveHost.operation,'connection-lost');
    assert(!JSON.stringify(f.backend).includes('samples'));assert(!JSON.stringify(f.backend).includes('opaque-main-lease'));
  }finally{f.broker.close();await tick();}
});

test('a failed media load releases a claimed physical capture and a stale prepare cannot destroy the active attempt',async()=>{
  const released=[];const f=fixture({loadError:true,wakeSource:{claimLive(){return{samples:new Float32Array(1),release(){}};},releaseLive:attempt=>released.push(attempt)}});
  const attemptId=randomUUID();try{f.broker.handle(request('prepare',{attemptId,bufferLeaseRef:'owned'}));await tick();await tick();assert.deepEqual(released,[attemptId]);assert(f.windows[0].isDestroyed());assert.equal(f.backend.at(-1).nativeLiveHost.error,'live_media_unavailable');}finally{f.broker.close();}
  const active=fixture();try{const attemptId=randomUUID();active.broker.authorizeAttempt(attemptId);active.broker.handle(request('prepare',{attemptId}));await tick();const w=active.windows[0];
    active.broker.handle(request('prepare',{attemptId:randomUUID(),bufferLeaseRef:'stale'}));await tick();assert.equal(w.isDestroyed(),false);assert.equal(active.backend.at(-1).nativeLiveHost.error,'live_media_protocol');
    active.broker.handle(request('connect',{sessionId:'still-owned',sdpAnswer:'v=0'}));await tick();assert.equal(active.backend.at(-1).nativeLiveHost.result,null);
  }finally{active.broker.close();}
});
