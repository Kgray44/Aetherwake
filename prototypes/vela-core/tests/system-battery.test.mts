import test from 'node:test';import assert from 'node:assert/strict';
import {systemBattery,summarizeSystemBattery} from '../src/system-battery.ts';import {nativeVelaFact,nativeVelaWeather} from '../src/adaptive-routing.ts';import {CAPABILITIES} from '../src/capabilities.ts';
test('battery unknown sentinels and absent batteries remain truthful',()=>{
 assert.deepEqual(Object.fromEntries(Object.entries(systemBattery({acLineStatus:255,batteryFlag:255,batteryLifePercent:255,batteryLifeSeconds:0xffffffff})).filter(([key])=>!['contract','measuredAt','source'].includes(key))),{batteryPresent:null,percent:null,acConnected:null,charging:null,remainingSeconds:null});
 const absent=systemBattery({acLineStatus:1,batteryFlag:128,batteryLifePercent:255,batteryLifeSeconds:0xffffffff});assert.equal(summarizeSystemBattery(absent),'Windows reports no system battery. AC power is connected.');
 assert.match(summarizeSystemBattery(systemBattery({acLineStatus:0,batteryFlag:2,batteryLifePercent:20,batteryLifeSeconds:1801})),/20%.*31 minutes remaining/s);
 assert.throws(()=>systemBattery({acLineStatus:3,batteryFlag:0,batteryLifePercent:256,batteryLifeSeconds:1}));
});
test('common single-purpose local weather questions retain the native consent path without claiming other weather requests',()=>{
 for(const text of ["How's the weather in my area today?","What's the forecast for today?","What's the current weather at my location today?",'Weather here today'])assert.equal(nativeVelaWeather(text),'today',text);
 for(const text of ["What's the weather going to be like here tomorrow?",'Is it going to rain here tomorrow?','What will the weather be like near me tomorrow?'])assert.equal(nativeVelaWeather(text),'tomorrow',text);
 for(const text of ['Explain why weather changes','What is the weather in Paris today?','Show the weather tomorrow and create a workspace','Will it rain tomorrow? Email the forecast'])assert.equal(nativeVelaWeather(text),undefined,text);
});
test('narrow battery intent extends one generic descriptor and avoids control requests',()=>{
 for(const text of ["What's my battery level?",'How much battery do I have?','Am I on battery power?','Is my laptop charging?'])assert.equal(nativeVelaFact(text),'system.battery',text);
 for(const text of ['Turn on battery saver','Battery chemistry explained','Is my battery good enough to render this video?'])assert.notEqual(nativeVelaFact(text),'system.battery',text);
 assert.equal(CAPABILITIES.filter(value=>value.id==='readLocalFact').length,1);assert(!CAPABILITIES.some(value=>String(value.id)==='system.battery'));
});
