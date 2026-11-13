import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {checkNativeTestLaunch} from '../native/launch-native-test.cjs';

// Explicit engineering lease only. This test creates a hidden, inaudible, offline
// owned fixture; it is not a provider speech or human-audibility qualification.
test('actual hidden output-only DOM owns disabled synthetic tracks without any microphone permission',{
  skip:process.platform!=='win32'||process.env.AERYNTH_OUTPUT_ONLY_DOM_QA!=='1',timeout:25000,
},async t=>{
  checkNativeTestLaunch();
  const root=fileURLToPath(new URL('..',import.meta.url)),source=path.join(root,'src/gpt-live-media.ts');
  const digest=async()=>createHash('sha256').update(await readFile(source)).digest('hex'),before=await digest();
  const folder=await mkdtemp(path.join(tmpdir(),'aerynth-output-only-dom-'));
  const preload=path.join(folder,'private-preload.cjs'),main=path.join(folder,'fixture.cjs'),html=path.join(folder,'media.html');
  try{
    const {build}=createRequire(path.join(root,'package.json'))('esbuild');
    const compiled=await build({stdin:{resolveDir:root,sourcefile:'private-output-only-fixture.ts',contents:`
import {BrowserGptLiveMedia} from './src/gpt-live-media.ts';
const {ipcRenderer}=require('electron');
addEventListener('DOMContentLoaded',()=>{void(async()=>{
 let microphoneCalls=0,enumerationCalls=0,peer;const contexts=[],audios=[];
 const media=new BrowserGptLiveMedia({timeoutMs:5000,acceptNegotiation:async()=>{throw Error('NO_PROVIDER');},environment:{
  getUserMedia:async()=>{microphoneCalls++;throw Error('MIC_FORBIDDEN');},enumerateDevices:async()=>{enumerationCalls++;throw Error('ENUM_FORBIDDEN');},
  createPeer:()=>peer=new RTCPeerConnection({iceServers:[],iceTransportPolicy:'relay'}),createAudio:()=>{const audio=document.createElement('audio');audio.muted=true;audios.push(audio);return audio;},
  createAudioContext:()=>{const context=new AudioContext();contexts.push(context);return context;},
 }});
 try{
  await media.prepare({outputOnly:true});const track=peer.getSenders()[0]?.track;
  const prepared={state:media.state(),trackEnabled:track?.enabled,trackState:track?.readyState};
  let inputRejected=false;try{await media.setInputDevice('forbidden-mic');}catch{inputRejected=true;}
  const devices=await media.devices();media.setLocalMute(false);
  await media.dispose();
  ipcRenderer.send('owned-output-only-result',{microphoneCalls,enumerationCalls,inputRejected,devicesCount:devices.length,
   prepared,closed:media.state(),trackAfter:track?.readyState,contextsClosed:contexts.every(context=>context.state==='closed'),
   allAudioMuted:audios.every(audio=>audio.muted),peerClosed:peer.connectionState==='closed',iceConfiguration:peer.getConfiguration(),remoteDescriptionAbsent:peer.remoteDescription===null});
 }catch{await media.dispose();ipcRenderer.send('owned-output-only-result',{error:'fixture_failed'});}
})().catch(()=>ipcRenderer.send('owned-output-only-result',{error:'fixture_failed'}));},{once:true});
`},bundle:true,platform:'browser',format:'cjs',target:'chrome120',external:['electron'],write:false,logLevel:'silent'});
    assert(compiled.outputFiles[0].contents.byteLength<1024*1024);await writeFile(preload,compiled.outputFiles[0].contents);
    await writeFile(html,"<!doctype html><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'none'; connect-src 'none'; media-src 'self' blob:\"><title>Owned output-only media fixture</title>");
    await writeFile(main,`const {app,BrowserWindow:ElectronBrowserWindow,ipcMain}=require('electron');const {pathToFileURL}=require('node:url');
const {installDesktopTestAdmission}=require(${JSON.stringify(path.join(root,'native/native-test-admission.cjs'))});
const {BrowserWindow}=installDesktopTestAdmission({app,BrowserWindow:ElectronBrowserWindow});
app.setPath('userData',${JSON.stringify(path.join(folder,'profile'))});app.disableHardwareAcceleration();let win,permissionRequests=0,permissionChecks=0,deniedPermissionChecks=0;const checkedPermissions=[];
const deadline=setTimeout(()=>app.exit(2),15000);
app.whenReady().then(async()=>{const url=pathToFileURL(${JSON.stringify(html)}).href;
 win=new BrowserWindow({show:false,focusable:false,width:1,height:1,skipTaskbar:true,webPreferences:{preload:${JSON.stringify(preload)},sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,backgroundThrottling:false,partition:'aerynth-output-only-dom'}});
 const wc=win.webContents;wc.setAudioMuted(true);wc.setWindowOpenHandler(()=>({action:'deny'}));wc.on('will-navigate',event=>event.preventDefault());wc.on('will-attach-webview',event=>event.preventDefault());
 wc.session.setPermissionRequestHandler((_owner,_permission,callback)=>{permissionRequests++;callback(false);});
 wc.session.setPermissionCheckHandler((_owner,permission,_origin,details)=>{permissionChecks++;deniedPermissionChecks++;if(checkedPermissions.length<16)checkedPermissions.push({permission,mediaType:details?.mediaType??null});return false;});wc.session.setDevicePermissionHandler(()=>false);
 wc.session.webRequest.onBeforeRequest((details,callback)=>callback({cancel:details.url!==url}));
 ipcMain.once('owned-output-only-result',(event,result)=>{if(event.sender!==wc||event.senderFrame!==wc.mainFrame||event.senderFrame.url!==url)return app.exit(3);
  clearTimeout(deadline);const receipt={...result,permissionRequests,permissionChecks,deniedPermissionChecks,checkedPermissions,nativeAudioMuted:wc.isAudioMuted(),visible:win.isVisible(),focusable:win.isFocusable()};
  win.destroy();process.stdout.write('OUTPUT_ONLY_DOM_RECEIPT='+JSON.stringify(receipt));app.exit(0);
 });await win.loadURL(url);
}).catch(()=>app.exit(4));`);
    const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
    checkNativeTestLaunch(env);
    const result=await promisify(execFile)(path.join(root,'node_modules/electron/dist/electron.exe'),[main],{windowsHide:true,timeout:20000,maxBuffer:65536,env});
    const line=result.stdout.match(/OUTPUT_ONLY_DOM_RECEIPT=(\{[^\r\n]+\})/u);assert(line,'owned fixture emitted no receipt');
    const receipt=JSON.parse(line[1]);t.diagnostic(JSON.stringify({sourceSha256:before,...receipt}));assert.equal(receipt.error,undefined);assert.equal(receipt.microphoneCalls,0);assert.equal(receipt.enumerationCalls,0);
    // Chromium may passively check audio/video permission while creating WebRTC.
    // Every check is denied; no permission request or capture call is permitted.
    assert.equal(receipt.permissionRequests,0);assert.equal(receipt.deniedPermissionChecks,receipt.permissionChecks);assert.equal(receipt.inputRejected,true);assert.equal(receipt.devicesCount,0);
    assert.equal(receipt.prepared.trackEnabled,false);assert.equal(receipt.prepared.trackState,'live');assert.equal(receipt.prepared.state.microphoneAccess,'not-requested');
    assert.equal(receipt.closed.microphoneAccess,'not-requested');assert.equal(receipt.closed.localTrackEnabled,false);assert.equal(receipt.closed.humanAudibility,'unverified');
    assert.equal(receipt.trackAfter,'ended');assert.equal(receipt.contextsClosed,true);assert.equal(receipt.peerClosed,true);assert.equal(receipt.allAudioMuted,true);
    assert.equal(receipt.nativeAudioMuted,true);assert.equal(receipt.visible,false);assert.equal(receipt.focusable,false);assert.equal(await digest(),before);
    assert.deepEqual(receipt.iceConfiguration.iceServers,[]);assert.equal(receipt.iceConfiguration.iceTransportPolicy,'relay');assert.equal(receipt.remoteDescriptionAbsent,true);
  }finally{
    assert.equal(path.dirname(folder),path.resolve(tmpdir()));assert(path.basename(folder).startsWith('aerynth-output-only-dom-'));
    await rm(folder,{recursive:true,force:true});
  }
});
