const test=require('node:test'),assert=require('node:assert/strict');const {randomUUID}=require('node:crypto');
const {createWindowsSystemBroker}=require('../native/windows-system-broker.cjs');
const wait=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({locateError}={}){const sent=[],dialogs=[],calls=[];let focused=true,promptResult=0;const owner={isDestroyed:()=>false,isFocused:()=>focused,getNativeWindowHandle:()=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(1234n);return b;}};
 const broker=createWindowsSystemBroker({root:__dirname,getOwner:()=>owner,dialog:{showMessageBox:async(w,input)=>{assert.equal(w,owner);dialogs.push(input);return {response:promptResult};}},addon:{locate:async(hwnd,requestedAtMs)=>{calls.push({hwnd,requestedAtMs});if(locateError!==undefined)throw locateError;return {latitude:43,longitude:-72,observedAtMs:requestedAtMs,source:'wifi'};},battery:()=>({acLineStatus:1,batteryFlag:8,batteryLifePercent:88,batteryLifeSeconds:0xffffffff})},send:m=>sent.push(m)});
 const request=(operation,input={})=>({systemHost:{version:1,kind:'request',id:randomUUID(),operation,input}});return {broker,sent,dialogs,calls,request,focus:value=>{focused=value;},choice:value=>{promptResult=value;}};
}
test('native location binds foreground owned HWND, forwards fresh timestamp and keeps genuine OS access in fixed addon',async()=>{
 const f=fixture();try{const requestedAtMs=Date.now();f.broker.handle(f.request('locate',{requestedAtMs}));await wait();assert.deepEqual(f.calls,[{hwnd:'4d2',requestedAtMs}]);assert.equal(f.sent[0].systemHost.result.observedAtMs,requestedAtMs);assert.equal(f.dialogs.length,0);
 f.focus(false);f.broker.handle(f.request('locate',{requestedAtMs:Date.now()}));await wait();assert.equal(f.sent.at(-1).systemHost.error,'location_foreground_ui_required');assert.equal(f.calls.length,1);
 }finally{f.broker.close();}
});
test('weather purpose dialog is explicitly application consent and permissions expose only fixed Settings URI',async()=>{
 const f=fixture();try{f.broker.handle(f.request('weather-consent'));await wait();assert.equal(f.sent[0].systemHost.result,'allow');assert.match(f.dialogs[0].detail,/application permission.*Windows controls its own separate location permission/s);
 const calls=[],opened=[];const call=async(command,input)=>{calls.push({command,input});return {version:3};};f.focus(false);assert.deepEqual(await f.broker.permission({type:'status'},call,async()=>{}),{version:3});assert.equal(f.dialogs.length,1,'passive state does not ask permission');await assert.rejects(f.broker.permission({type:'change',expectedVersion:3},call,async()=>{}),/foreground_ui_required/);f.focus(true);await f.broker.permission({type:'change',expectedVersion:3},call,async url=>opened.push(url));assert.deepEqual(calls.at(-1),{command:'velaWeatherPermissionNative',input:{type:'set',expectedVersion:3,decision:'allow'}});
 await f.broker.permission({type:'windows-settings'},call,async url=>opened.push(url));assert.deepEqual(opened,['ms-settings:privacy-location']);await assert.rejects(f.broker.permission({type:'change',expectedVersion:2},call,async()=>{}),/stale_weather_permission/);
 await assert.rejects(f.broker.permission({type:'windows-settings',url:'https://wrong.invalid'},call,async()=>{}),/invalid_weather_permission/);
 }finally{f.broker.close();}
});
test('mixed, stale, oversized-authority and duplicate requests cannot start native location',async()=>{
 const f=fixture();try{for(const value of [{systemHost:null,event:{}},{...f.request('locate',{requestedAtMs:Date.now()}),command:'execute'},f.request('locate',{requestedAtMs:Date.now()-120001}),f.request('locate',{requestedAtMs:Date.now(),allow:true})])assert.equal(f.broker.handle(value),true);await wait();assert.equal(f.calls.length,0);assert.equal(f.sent.length,0);
 const valid=f.request('locate',{requestedAtMs:Date.now()});f.broker.handle(valid);f.broker.handle(valid);await wait();assert.equal(f.calls.length,1);assert(f.sent.some(v=>v.systemHost.error==='location_native_capacity'));f.broker.close();f.broker.handle(f.request('locate',{requestedAtMs:Date.now()}));assert.equal(f.calls.length,1);
 }finally{f.broker.close();}
});
test('native terminal consent errors survive only as exact bounded diagnostic enums',async()=>{
 for(const code of ['location_os_denied','location_permission_unspecified','location_cancelled','location_permission_timeout','location_native_consent_unavailable','location_fresh_fix_unavailable']){
  const f=fixture({locateError:Error(code)});try{f.broker.handle(f.request('locate',{requestedAtMs:Date.now()}));await wait();assert.equal(f.sent.at(-1).systemHost.error,code);assert.equal(f.dialogs.length,0);}finally{f.broker.close();}
 }
 for(const locateError of [Error('location_private_account_details'),Error('C:\\private\\location.txt'),{message:'location_permission_unspecified',detail:'not forwarded'}]){
  const f=fixture({locateError});try{f.broker.handle(f.request('locate',{requestedAtMs:Date.now()}));await wait();assert.deepEqual(Object.keys(f.sent.at(-1).systemHost).sort(),['error','id','kind','operation','version']);assert.equal(f.sent.at(-1).systemHost.error,locateError.message==='location_permission_unspecified'?'location_permission_unspecified':'location_native_unavailable');}finally{f.broker.close();}
 }
});
