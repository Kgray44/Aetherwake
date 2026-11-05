import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {PRIVATE_MISSION_FILE_EDIT_COMMANDS}=require('../native/mission-file-edit-broker.cjs');
const source=readFileSync(new URL('../native/desktop-main.cjs',import.meta.url),'utf8');
const privateNames=['hostOperationReviewNative','hostOperationDispatchNative','hostOperationResultNative'];

function preload(active){
  let host;const calls=[];
  vm.runInNewContext(readFileSync(new URL('../native/desktop-preload.cjs',import.meta.url),'utf8'),{
    process:{argv:[]},navigator:{userActivation:{isActive:active}},require:()=>({
      contextBridge:{exposeInMainWorld(_name,value){host=value;}},
      ipcRenderer:{on(){},removeListener(){},invoke:async(...args)=>{calls.push(args);return {ok:true,result:'safe-view'};}}
    })});
  return {host,calls};
}
function main(){
  const start=source.indexOf('  ipcMain.handle("application-command", async (event, command, input) => {');
  const end=source.indexOf('  const active = () => {',start);assert(start>=0&&end>start);
  let handler,focused=true,activation=true,loseFocus=false,reviews=0,kind='aerynth.windows.maintenance-review@1';const frames=new Map(),calls=[],dispatches=[],localURL='file:///synthetic-aerynth/index.html';
  const frame={url:localURL,executeJavaScript:async()=>{if(loseFocus)focused=false;return activation;}};
  const webContents={mainFrame:frame,isDestroyed:()=>false};const win={webContents,isDestroyed:()=>false};
  const event={sender:webContents,senderFrame:frame};
  const context={ipcMain:{handle(_name,fn){handler=fn;}},Buffer,win,localURL,PRIVATE_MISSION_FILE_EDIT_COMMANDS,
    trustedActiveFrame:e=>e===event&&focused,isVelaRead:()=>false,isProductRead:()=>false,
    storage:{allowWrite:async()=>true},maintenanceReviewFrames:frames,
    call:async(name,input)=>{calls.push({name,input});assert.equal(name,'hostOperationReviewNative');return {contract:kind,operationId:input.operationId};},
    windowsMaintenanceBroker:{review:async operationId=>{reviews++;dispatches.push('memory');assert.equal(frames.get(operationId),frame);return {id:operationId,reviewAvailable:false};}},
    windowsComputerBroker:{review:async operationId=>{reviews++;dispatches.push('computer');assert.equal(frames.get(operationId),frame);return {id:operationId,reviewAvailable:false};}},
    reviewVelaOwner:async({binding})=>{reviews++;dispatches.push('owner');assert.equal(frames.get(binding.operationId),frame);return {id:binding.operationId,reviewAvailable:false};},
    validateHostOperation:()=>assert.fail('Review selection is not OS dispatch'),reviewDialogs:{},nativeReviewGate:()=>{},
    BrowserWindow:{},session:{},dialog:{},backendExecutable:()=>'',process:{env:{}},
  };
  vm.runInNewContext(source.slice(start,end),context);
  return {frames,event,frame,context,calls,dispatches,kind:v=>{kind=v;},focus:v=>{focused=v;},activation:v=>{activation=v;},loseFocus:()=>{loseFocus=true;},
    invoke:(command,input,received=event)=>handler(received,command,input),get reviews(){return reviews;}};
}
function reclaimGuard(){
  const marker='  const trustedApplicationFrame =',start=source.indexOf(marker),middle=source.indexOf('  let nativeReviewBusy=',start);
  const guardStart=source.indexOf('  const validateHostOperation=',middle),end=source.indexOf('  const protectedPids=',guardStart);
  assert(start>=0&&middle>start&&guardStart>middle&&end>guardStart);
  const frames=new Map(),localURL='file:///synthetic-aerynth/index.html',frame={url:localURL},binding={operationId:'operation:one',operationDigest:'a'.repeat(64)};
  frames.set(binding.operationId,frame);let focused=true,alive=true,visible=true,minimized=false,storage=true,current=binding,afterRead=()=>{},afterStorage=()=>{},storageChecks=0,reads=0;
  const webContents={mainFrame:frame,isDestroyed:()=>!alive},win={webContents,isDestroyed:()=>!alive,isVisible:()=>visible,isMinimized:()=>minimized,isFocused:()=>focused};
  const context={maintenanceReviewFrames:frames,closing:false,backendFailed:false,win,localURL,JSON,
    storage:{allowWrite:async()=>{storageChecks++;const result=storage;afterStorage();return result;}},
    call:async(name,input)=>{reads++;assert.equal(name,'hostOperationReviewNative');assert.equal(input.operationId,binding.operationId);afterRead();return current;}};
  const guard=vm.runInNewContext(source.slice(start,middle)+source.slice(guardStart,end)+'\nvalidateHostOperation',context);
  return {guard,binding,frames,frame,context,focus:v=>{focused=v;},alive:v=>{alive=v;},visible:v=>{visible=v;},minimized:v=>{minimized=v;},
    storage:v=>{storage=v;},current:v=>{current=v;},afterRead:fn=>{afterRead=fn;},afterStorage:fn=>{afterStorage=fn;},metrics:()=>({storageChecks,reads})};
}

test('isolated preload rejects native authority commands and requires actual activation for operation review',async()=>{
  const denied=preload(false);
  for(const name of privateNames)await assert.rejects(denied.host.command(name,{accepted:true}),/unsupported_command/);
  await assert.rejects(denied.host.command('vela',{name:'hostOperation',input:{operationId:'operation:one',observedGesture:true}}),/vela_user_gesture_required/);
  assert.equal(denied.calls.length,0);
  const allowed=preload(true);assert.equal(await allowed.host.command('vela',{name:'hostOperation',input:{operationId:'operation:one'}}),'safe-view');
  assert.equal(allowed.calls.length,1);
});
test('actual Main rejects direct authority calls, forged frames and extra approval fields before native review',async()=>{
  const m=main();
  for(const name of privateNames)assert.equal((await m.invoke(name,{accepted:true})).ok,false);
  const input={name:'hostOperation',input:{operationId:'operation:one'}};
  assert.equal((await m.invoke('vela',input,{...m.event,senderFrame:{...m.frame}})).ok,false);
  for(const extra of [{accepted:true},{binding:{}},{pid:123}])assert.equal((await m.invoke('vela',{...input,input:{...input.input,...extra}})).ok,false);
  assert.equal(m.reviews,0);assert.equal(m.frames.size,0);
  assert.equal(m.calls.length,0);
});
test('actual Main requires focused activation and keeps review frame custody only for the pending review',async()=>{
  const input={name:'hostOperation',input:{operationId:'operation:one'}};
  for(const mode of ['focus','activation','late-focus']){const m=main();if(mode==='focus')m.focus(false);else if(mode==='activation')m.activation(false);else m.loseFocus();assert.equal((await m.invoke('vela',input)).ok,false);assert.equal(m.reviews,0);}
  const m=main();assert.equal((await m.invoke('vela',input)).ok,true);assert.equal(m.reviews,1);assert.equal(m.frames.size,0);
  m.context.windowsMaintenanceBroker.review=async()=>{throw Error('synthetic-native-failure');};
  assert.equal((await m.invoke('vela',input)).ok,false);assert.equal(m.frames.size,0);
});
test('Main dispatches only the three recognized native review contracts after the private canonical lookup',async()=>{
  const input={name:'hostOperation',input:{operationId:'operation:one'}};
  for(const [contract,owner]of [['aerynth.windows.maintenance-review@1','memory'],['aerynth.windows.computer-review@1','computer'],['aerynth.vela.owner-review@1','owner']]){
    const m=main();m.kind(contract);assert.equal((await m.invoke('vela',input)).ok,true);assert.deepEqual(m.dispatches,[owner]);assert.equal(m.calls.length,1);assert.equal(m.frames.size,0);
  }
  for(const contract of [undefined,'aerynth.windows.maintenance-review@2','model-supplied-owner']){const m=main();m.kind(contract);assert.equal((await m.invoke('vela',input)).ok,false);assert.equal(m.reviews,0);assert.equal(m.frames.size,0);}
});
test('the actual pre-OS callback awaits storage and rejects changed binding, frame loss and late revocation',async()=>{
  const g=reclaimGuard();assert.equal(await g.guard(g.binding),true);
  g.storage(false);assert.equal(await g.guard(g.binding),false,'a Promise resolving false is not storage authority');g.storage(true);
  g.current({...g.binding,operationDigest:'b'.repeat(64)});assert.equal(await g.guard(g.binding),false);g.current(g.binding);
  g.afterRead(()=>g.focus(false));assert.equal(await g.guard(g.binding),false);g.focus(true);
  g.afterRead(()=>g.storage(false));assert.equal(await g.guard(g.binding),false);g.storage(true);g.afterRead(()=>{});
  g.frames.clear();assert.equal(await g.guard(g.binding),false);
});
test('after-dispatch focus transfer is permitted only while original trusted frame, URL, storage and canonical binding remain current',async()=>{
  const g=reclaimGuard(),after={phase:'after-dispatch'};g.focus(false);g.visible(false);g.minimized(true);
  assert.equal(await g.guard(g.binding),false);assert.equal(await g.guard(g.binding,after),true);
  for(const fault of ['frame','url','closing','backend','storage','binding','destroyed']){
    const f=reclaimGuard();f.focus(false);
    if(fault==='frame')f.context.win.webContents.mainFrame={url:f.frame.url};
    if(fault==='url')f.frame.url='https://untrusted.invalid';
    if(fault==='closing')f.context.closing=true;
    if(fault==='backend')f.context.backendFailed=true;
    if(fault==='storage')f.storage(false);
    if(fault==='binding')f.current({...f.binding,operationDigest:'b'.repeat(64)});
    if(fault==='destroyed')f.alive(false);
    assert.equal(await f.guard(f.binding,after),false,fault);
  }
  const late=reclaimGuard();late.afterRead(()=>{late.context.win.webContents.mainFrame={url:late.frame.url};});assert.equal(await late.guard(late.binding,after),false);
  const storageRace=reclaimGuard();storageRace.afterStorage(()=>storageRace.frames.clear());assert.equal(await storageRace.guard(storageRace.binding,after),false);
});
