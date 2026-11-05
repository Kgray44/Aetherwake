const fs=require('node:fs');const path=require('node:path');const {createHash}=require('node:crypto');
const record=v=>v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,keys)=>Object.keys(v).sort().join('|')===keys.sort().join('|');
const settingsUri='ms-settings:privacy-location';
const LOCATION_ERRORS=new Set(['location_native_unavailable','location_native_source_changed','location_foreground_ui_required','location_native_capacity','location_native_busy','location_native_arguments','location_permission_timeout','location_os_denied','location_permission_unspecified','location_cancelled','location_fresh_fix_unavailable','location_source_unavailable','location_stale_fix','location_native_consent_unavailable','location_native_timeout','location_native_protocol']);
function loadWindowsSystem(root){
 if(process.platform!=='win32'||process.type!=='browser')throw Error('location_native_unavailable');
 const asset='aerynth-windows-system.node',metadata=JSON.parse(fs.readFileSync(path.join(root,'dist/aerynth-windows-system.sources.json'),'utf8'));
 const digest=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 const sources=['native/windows-system.cpp','native/windows-computer.inc'];
 if(!record(metadata)||!exact(metadata,['contract','asset','sha256','inputs'])||metadata.contract!=='aerynth.private-windows-system-build@1'||metadata.asset!==asset||!record(metadata.inputs)||!exact(metadata.inputs,sources)||metadata.sha256!==digest(path.join(root,'dist',asset))||sources.some(source=>metadata.inputs[source]!==digest(path.join(root,source))))throw Error('location_native_source_changed');
 return require(path.join(root,'dist',asset));
}
function createWindowsSystemBroker({root,getOwner,dialog,send,addon,now=Date.now}){
 let closed=false,locationPending=false,consentPending=null,inFlight=0;const seen=new Set();let native;
 const audit={purposePrompts:0,locationAttempts:0,batteryReads:0};
 const getNative=()=>native??=(addon??loadWindowsSystem(root));
 const owner=()=>{const w=getOwner();if(closed||!w||w.isDestroyed()||!w.isFocused())throw Error('location_foreground_ui_required');return w;};
 const purpose=()=>{
  if(consentPending)return consentPending;
  const task=(async()=>{const window=owner();audit.purposePrompts++;const result=await dialog.showMessageBox(window,{type:'question',title:'Aerynth weather permission',message:'Allow location for local weather?',detail:'Aerynth will ask Windows for a fresh device position when you ask about local weather. Only an approximate point (rounded to 0.01°) is sent to the US National Weather Service. Your location is not saved. This application permission is remembered until you change it. Windows controls its own separate location permission.',buttons:['Allow weather location','Don’t allow','Cancel'],defaultId:2,cancelId:2,noLink:true});return result.response===0?'allow':result.response===1?'deny':'cancel';})();consentPending=task;void task.finally(()=>{if(consentPending===task)consentPending=null;}).catch(()=>{});return task;
 };
 return {
  handle(value){if(!record(value)||!Object.hasOwn(value,'systemHost'))return false;
   if(closed||!exact(value,['systemHost'])||!record(value.systemHost))return true;
   const h=value.systemHost;if(!exact(h,['version','kind','id','operation','input'])||h.version!==1||h.kind!=='request'||typeof h.id!=='string'||!/^[a-f0-9-]{36}$/u.test(h.id)||!['weather-consent','locate','battery'].includes(h.operation)||!record(h.input)||!(h.operation==='locate'?exact(h.input,['requestedAtMs'])&&Number.isSafeInteger(h.input.requestedAtMs)&&h.input.requestedAtMs>0&&h.input.requestedAtMs<=now()+2000&&h.input.requestedAtMs>=now()-120000:exact(h.input,[])))return true;
   const reply=body=>{if(!closed)send({systemHost:{version:1,kind:'response',id:h.id,operation:h.operation,...body}});};
   if(seen.has(h.id)||inFlight>=4){reply({error:'location_native_capacity'});return true;}if(seen.size>=256)seen.delete(seen.values().next().value);seen.add(h.id);inFlight++;
   void Promise.resolve().then(async()=>{
    if(h.operation==='weather-consent')return purpose();
    if(h.operation==='battery'){audit.batteryReads++;return getNative().battery();}
    audit.locationAttempts++;
    if(locationPending)throw Error('location_native_busy');const window=owner();const bytes=window.getNativeWindowHandle();
    if(!Buffer.isBuffer(bytes)||![4,8].includes(bytes.length))throw Error('location_native_unavailable');
    const hwnd=bytes.length===8?bytes.readBigUInt64LE().toString(16):bytes.readUInt32LE().toString(16);locationPending=true;
    try{return await getNative().locate(hwnd,h.input.requestedAtMs);}finally{locationPending=false;}
   }).then(result=>reply({result})).catch(error=>{const code=typeof error==='string'?error:error?.message;reply({error:LOCATION_ERRORS.has(code)?code:'location_native_unavailable'});}).finally(()=>inFlight--);return true;
  },
  async permission(request,call,openExternal){
   if(closed||!record(request))throw Error('invalid_weather_permission');
   if(request.type==='status'&&exact(request,['type']))return call('velaWeatherPermissionNative',{type:'status'});
   owner();
   if(request.type==='windows-settings'&&exact(request,['type'])){await openExternal(settingsUri);return call('velaWeatherPermissionNative',{type:'status'});}
   if(request.type!=='change'||!exact(request,['type','expectedVersion'])||!Number.isSafeInteger(request.expectedVersion))throw Error('invalid_weather_permission');
   const before=await call('velaWeatherPermissionNative',{type:'status'});if(before.version!==request.expectedVersion)throw Error('stale_weather_permission');
   const decision=await purpose();if(decision==='cancel')return before;
   return call('velaWeatherPermissionNative',{type:'set',expectedVersion:request.expectedVersion,decision});
  },audit(){return Object.freeze({...audit});},close(){closed=true;native=undefined;seen.clear();},
 };
}
module.exports={createWindowsSystemBroker,loadWindowsSystem};
