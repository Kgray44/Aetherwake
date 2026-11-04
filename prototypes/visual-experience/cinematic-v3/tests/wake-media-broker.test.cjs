const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{createHash}=require('node:crypto');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createWakeMediaBroker,validFrame,validState,CHANNEL}=require('../native/wake-media-broker.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const state=(generation=1,phase='capturing')=>({contract:'aerynth.wake-audio-capture@1',generation,phase,microphone:'active',sampleRate:16000,inputDevice:'default',
  frames:0,pendingFrames:0,signalActivity:'unavailable',activitySource:'local-rms-only'});
const frame=(sequence=0,generation=1,mode='detector')=>({generation,sequence,startSample:sequence*640,sampleRate:16000,samples:new Float32Array(640).fill(0.25),signalActivity:'signal',rms:0.25,mode});
function fixture({answer=true,ready=true,load=true,qa,onFrame}={}){
  const ipcMain=new EventEmitter(),windows=[],sent=[],states=[],received=[];let stamp=0;
  class Window{
    constructor(options){this.options=options;this.dead=false;windows.push(this);const wc=new EventEmitter();this.webContents=wc;
      wc.mainFrame={url:''};wc.getURL=()=>wc.mainFrame.url;wc.isDestroyed=()=>this.dead;wc.setAudioMuted=value=>wc.audioMuted=value;
      wc.setWindowOpenHandler=fn=>wc.windowOpen=fn;wc.session={setPermissionRequestHandler:fn=>wc.permissionRequest=fn,setPermissionCheckHandler:fn=>wc.permissionCheck=fn,
        setDevicePermissionHandler:fn=>wc.devicePermission=fn,webRequest:{onBeforeRequest:fn=>wc.network=fn}};
      wc.send=(channel,value)=>{sent.push({channel,value});if(!answer||channel!==CHANNEL+'-command')return;
        const h=value.value.nativeWakeCapture,result=state(h.payload.generation,h.operation==='pause'?'handoff':'capturing');
        queueMicrotask(()=>ipcMain.emit(CHANNEL+'-reply',this.event(),{token:this.token(),value:{nativeWakeCapture:{version:1,kind:'response',id:h.id,operation:h.operation,result}}}));};
    }
    token(){return this.options.webPreferences.additionalArguments.find(arg=>arg.startsWith('--aerynth-wake-token=')).split('=')[1];}
    event(){return {sender:this.webContents,senderFrame:this.webContents.mainFrame};}
    isDestroyed(){return this.dead;}destroy(){this.dead=true;this.webContents.emit('destroyed');}
    loadURL(url){this.webContents.mainFrame.url=url;if(ready)queueMicrotask(()=>ipcMain.emit(CHANNEL+'-ready',this.event(),{token:this.token()}));return load?Promise.resolve():new Promise(()=>{});}
  }
  const options={BrowserWindow:Window,ipcMain,preloadPath:'C:\\app\\dist\\vela-wake-capture-preload.cjs',htmlPath:'C:\\app\\native\\wake-media.html',
    workletPath:'C:\\app\\dist\\vela-wake-pcm-worklet.js',onFrame:async(value,signal)=>{received.push({value,signal});await onFrame?.(value,signal);},
    onState:value=>states.push(value),now:()=>stamp,...(qa?{qa}:{})};
  const broker=createWakeMediaBroker(options);
  return {broker,ipcMain,windows,sent,states,received,options,stamp(value){stamp=value;},
    arm(generation=1){return broker.arm({generation},broker.authorizeArm(generation));},
    send(value,window=windows.at(-1),event=window.event(),token=window.token()){ipcMain.emit(CHANNEL+'-frame',event,{token,value});}};
}
test('OFF and state never create a private window; only one-use native arm grants can capture',async()=>{
  const f=fixture();try{assert.equal(f.broker.state().phase,'off');assert.equal(f.windows.length,0);
    await assert.rejects(f.broker.arm({generation:1},'renderer-boolean'),/grant_required/);assert.equal(f.windows.length,0);
    const grant=f.broker.authorizeArm(1);await f.broker.arm({generation:1},grant);await assert.rejects(f.broker.arm({generation:2},grant),/grant_required/);
    assert.equal(f.windows.length,1);const w=f.windows[0],p=w.options.webPreferences;
    assert.equal(w.options.show,false);assert.equal(w.options.focusable,false);assert.equal(p.contextIsolation,true);assert.equal(p.sandbox,true);assert.equal(p.nodeIntegration,false);
    assert.equal(p.webSecurity,true);assert(!p.partition.startsWith('persist:'));assert.equal(w.webContents.audioMuted,true);assert.equal(w.webContents.windowOpen().action,'deny');
  }finally{f.broker.dispose();}
});
test('media permission is exact known main-frame audio and exists only during an active native arm',async()=>{
  const f=fixture({answer:false});try{const armed=f.arm();await tick();const w=f.windows[0],wc=w.webContents,request=(mediaTypes,patch={},owner=wc)=>{let allowed;
      wc.permissionRequest(owner,'media',value=>allowed=value,{mediaTypes,isMainFrame:true,requestingUrl:wc.getURL(),...patch});return allowed;};
    assert.equal(request(['audio']),true);for(const types of [['video'],['audio','video'],[]])assert.equal(request(types),false);
    assert.equal(request(['audio'],{isMainFrame:false}),false);assert.equal(request(['audio'],{requestingUrl:'file:///foreign'}),false);assert.equal(request(['audio'],{},{}),false);
    assert.equal(wc.permissionCheck(wc,'media','file://',{mediaType:'audio',isMainFrame:true,requestingUrl:wc.getURL()}),true);assert.equal(wc.devicePermission(),false);
    const h=f.sent.find(value=>value.channel===CHANNEL+'-command').value.value.nativeWakeCapture;
    f.ipcMain.emit(CHANNEL+'-reply',w.event(),{token:w.token(),value:{nativeWakeCapture:{version:1,kind:'response',id:h.id,operation:h.operation,result:state()}}});await armed;
    assert.equal(request(['audio']),false);
    for(const url of ['https://example.invalid','file:///foreign','data:text/plain,test']){let cancel;wc.network({url},value=>cancel=value.cancel);assert.equal(cancel,true);}
    for(const name of ['will-navigate','will-frame-navigate','will-attach-webview']){const event={preventDefault(){this.stopped=true;}};wc.emit(name,event);assert.equal(event.stopped,true);}
  }finally{f.broker.dispose();}
});
test('private token and exact owned WebContents/mainFrame gate every PCM frame',async()=>{
  const f=fixture();try{await f.arm();const w=f.windows[0];
    f.send(frame(),w,{sender:{},senderFrame:w.webContents.mainFrame});f.send(frame(),w,{sender:w.webContents,senderFrame:{url:w.webContents.getURL()}});f.send(frame(),w,w.event(),'wrong');await tick();
    assert.equal(f.received.length,0);f.send(frame());await tick();assert.equal(f.received.length,1);assert.equal(f.sent.filter(value=>value.channel===CHANNEL+'-ack').length,1);
    assert(f.received[0].value.samples.every(value=>value===0));assert.doesNotMatch(JSON.stringify(f.states),/samples|token|PRIVATE|speech/);
  }finally{f.broker.dispose();}
});
test('stop bypasses an unanswered arm and hung navigation immediately and late replies cannot revive its window',async()=>{
  const f=fixture({answer:false,ready:false,load:false});const arming=f.arm();await tick();const w=f.windows[0];
  const stopped=f.broker.stop();assert.equal(w.isDestroyed(),true);assert.equal(stopped.microphone,'released');await assert.rejects(arming,/arm_failed/);
  f.ipcMain.emit(CHANNEL+'-ready',w.event(),{token:w.token()});assert.equal(f.broker.state().phase,'stopped');f.broker.dispose();
});
test('four outstanding frames are bounded, stop aborts native processing and zeroes active and queued PCM',async()=>{
  const gate=deferred(),f=fixture({onFrame:()=>gate.promise});try{await f.arm();const values=Array.from({length:4},(_,i)=>frame(i));for(const value of values)f.send(value);await tick();
    assert.equal(f.received.length,1);assert.equal(f.sent.filter(value=>value.channel===CHANNEL+'-ack').length,0);
    f.broker.stop();assert.equal(f.received[0].signal.aborted,true);assert(values.every(value=>value.samples.every(sample=>sample===0)));
    gate.resolve();await tick();assert.equal(f.sent.filter(value=>value.channel===CHANNEL+'-ack').length,0);
  }finally{f.broker.dispose();}
});
test('a fifth unacknowledged frame fails closed instead of dropping sequence or allocating an unbounded queue',async()=>{
  const gate=deferred(),f=fixture({onFrame:()=>gate.promise});try{await f.arm();for(let i=0;i<5;i++)f.send(frame(i));assert.equal(f.windows[0].isDestroyed(),true);
    assert.equal(f.broker.state().phase,'failed');assert.equal(f.received[0].signal.aborted,true);gate.resolve();await tick();
  }finally{f.broker.dispose();}
});
test('PCM must be contiguous exact 640/16k finite normalized samples with honest RMS and native pause mode',async()=>{
  for(const value of [{...frame(),samples:new Float32Array(641)}, {...frame(),samples:new Float32Array(640).fill(NaN)}, {...frame(),rms:0.9},
    {...frame(),sampleRate:48000},frame(1),{...frame(),rawDiagnostics:'PRIVATE'},frame(0,1,'handoff')]){
    assert.equal(validFrame(value),value.sequence===1||value.mode==='handoff','local validator validates values, native handler additionally enforces sequence/mode');
    const f=fixture();await f.arm();f.send(value);assert.equal(f.windows[0].isDestroyed(),true);assert.equal(f.received.length,0);f.broker.dispose();
  }
});
test('native handoff mode is generation-owned; stale stop/frame cannot affect a newer generation',async()=>{
  const f=fixture();try{await f.arm();await f.broker.pause({generation:1});f.send(frame(0,1,'handoff'));await tick();assert.equal(f.received[0].value.mode,'handoff');
    const old=f.windows[0];await f.arm(2);f.broker.stop({generation:1});assert.equal(f.windows[1].isDestroyed(),false);
    f.send(frame(1,1,'handoff'),old);await tick();assert.equal(f.windows[1].isDestroyed(),false);assert.equal(f.broker.state().generation,2);
  }finally{f.broker.dispose();}
});
test('native frame rate above 64/sec is rejected and every state remains content-free',async()=>{
  const f=fixture();try{await f.arm();for(let i=0;i<65;i++){f.send(frame(i));await tick();}
    assert.equal(f.received.length,64);assert.equal(f.broker.state().phase,'failed');assert.equal(f.windows[0].isDestroyed(),true);
  }finally{f.broker.dispose();}
});
test('native grants expire, cannot be renderer-shaped extras, and never allocate on refusal',async()=>{
  const f=fixture();try{const grant=f.broker.authorizeArm(1);f.stamp(30001);await assert.rejects(f.broker.arm({generation:1},grant),/grant_required/);
    await assert.rejects(f.broker.arm({generation:1,userGesture:true},f.broker.authorizeArm(1)),/wake_media_input/);assert.equal(f.windows.length,0);
    for(let i=0;i<3;i++)f.broker.authorizeArm(i+2);assert.throws(()=>f.broker.authorizeArm(9),/grant_capacity/);
  }finally{f.broker.dispose();}
});
test('QA fixture PCM is constructor-only hash-bounded and ambient permissions remain denied',async t=>{
  const local=fs.mkdtempSync(path.join(os.tmpdir(),'aerynth-wake-broker-')),profile=path.join(local,'Aerynth','review-vela-missions-123456');fs.mkdirSync(profile,{recursive:true});
  t.after(()=>{assert.equal(path.dirname(local),path.resolve(os.tmpdir()));assert(path.basename(local).startsWith('aerynth-wake-broker-'));fs.rmSync(local,{recursive:true,force:true});});
  const samples=new Float32Array(640).fill(0.1),sha256=createHash('sha256').update(Buffer.from(samples.buffer)).digest('hex'),qa={syntheticInput:true,localAppData:local,profileDirectory:profile,
    argv:['--integration-vela-missions','--wake-synthetic-input'],fixture:{sampleRate:16000,samples,sha256}};
  const f=fixture({qa});try{await f.arm();const w=f.windows[0];let allowed;w.webContents.permissionRequest(w.webContents,'media',value=>allowed=value,{mediaTypes:['audio'],isMainFrame:true,requestingUrl:w.webContents.getURL()});
    assert.equal(allowed,false);assert(w.options.webPreferences.additionalArguments.includes('--aerynth-wake-synthetic'));
    assert.equal(f.sent.filter(value=>value.channel===CHANNEL+'-qa-source').length,1);
    assert.throws(()=>fixture({qa:{...qa,argv:[]}}),/owned_qa_required/);assert.throws(()=>fixture({qa:{...qa,fixture:{...qa.fixture,sha256:'0'.repeat(64)}}}),/fixture_invalid/);
  }finally{f.broker.dispose();}
});
test('dispose removes every private IPC listener and source paths are a fixed closed set',()=>{
  const f=fixture();f.broker.dispose();for(const suffix of ['ready','reply','state','frame'])assert.equal(f.ipcMain.listenerCount(CHANNEL+'-'+suffix),0);
  assert.throws(()=>createWakeMediaBroker({...f.options,preloadPath:'C:\\app\\arbitrary.cjs'}),/paths_invalid/);
  assert.equal(validState({...state(),speechRecognized:true}),false);
});
