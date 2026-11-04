const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {randomUUID}=require('node:crypto');
const {createLiveMediaBroker,CHANNEL,validRequest,isSyntheticLiveMediaWindow}=require('../native/live-media-broker.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const request=(operation,payload={})=>({nativeLiveHost:{version:1,kind:'request',id:randomUUID(),operation,payload}});
function fixture({syntheticInput=false,answer=true}={}){
  const ipcMain=new EventEmitter(),windows=[],sent=[],backend=[];
  class Window{
    constructor(options){this.options=options;this.dead=false;windows.push(this);const wc=new EventEmitter();this.webContents=wc;wc.mainFrame={url:''};wc.getURL=()=>wc.mainFrame.url;wc.isDestroyed=()=>this.dead;wc.setWindowOpenHandler=handler=>{wc.windowOpen=handler;};
      wc.session={setPermissionRequestHandler:fn=>{wc.permissionRequest=fn;},setPermissionCheckHandler:fn=>{wc.permissionCheck=fn;},setDevicePermissionHandler:fn=>{wc.devicePermission=fn;},webRequest:{onBeforeRequest:fn=>{wc.network=fn;}}};
      wc.setAudioMuted=value=>{wc.audioMuted=value;};wc.isAudioMuted=()=>wc.audioMuted===true;
      wc.send=(_name,value)=>{sent.push(value);if(!answer)return;const h=value.message.nativeLiveHost,result=h.operation==='prepare'?{offerId:'offer-fixture',sdpOffer:'v=0\r\nPRIVATE_OFFER'}:null;queueMicrotask(()=>ipcMain.emit(CHANNEL+'-reply',this.event(),{token:this.token(),message:{nativeLiveHost:{version:1,kind:'response',id:h.id,operation:h.operation,result}}}));};
    }
    token(){return this.options.webPreferences.additionalArguments[0].split('=')[1];}
    event(){return{sender:this.webContents,senderFrame:this.webContents.mainFrame};}
    isDestroyed(){return this.dead;}
    destroy(){this.dead=true;this.webContents.emit('destroyed');}
    async loadURL(url){this.webContents.mainFrame.url=url;queueMicrotask(()=>ipcMain.emit(CHANNEL+'-ready',this.event(),{token:this.token()}));}
  }
  const broker=createLiveMediaBroker({BrowserWindow:Window,ipcMain,send:wire=>backend.push(wire),preloadPath:'C:\\app\\dist\\vela-live-media-preload.cjs',htmlPath:'C:\\app\\native\\voice-media.html',syntheticInput});
  return{broker,ipcMain,windows,sent,backend};
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
