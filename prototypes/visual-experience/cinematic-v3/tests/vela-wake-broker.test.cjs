const test=require('node:test'),assert=require('node:assert/strict');
const {createVelaWakeBroker}=require('../native/vela-wake-broker.cjs');
const preferences={phraseId:'hey-vela',sensitivity:.5,idleTimeoutMs:20000,dynamicGreeting:true};
test('local wake opt-in requires native gesture and storage, while passive status never grants capture',async()=>{
 const calls=[];let gesture=false,storage=true;
 const broker=createVelaWakeBroker({call:async(...args)=>{calls.push(args);return {phase:'OFF'};},authorize:async()=>gesture,storageAllowed:async()=>storage,masterOffLocal:async()=>{}});
 await broker.command({name:'state',input:{}});assert.deepEqual(calls,[['velaWake',{name:'state',input:{}}]]);
 const enable={name:'enable',input:{expectedVersion:0,preferences}};
 await assert.rejects(broker.command(enable,{observedGesture:true}),/wake_user_gesture_required/);assert.equal(calls.length,1);
 gesture=true;storage=false;await assert.rejects(broker.command(enable),/storage_reserve/);assert.equal(calls.length,1);
 storage=true;await broker.command(enable);assert.equal(calls.at(-1)[0],'velaWakeNative');
 await assert.rejects(broker.command({...enable,input:{...enable.input,approved:true}}),/wake_invalid_control/);broker.close();
});
test('explicit microphone-off bypasses an in-flight enable and releases local capture before canonical shutdown',async()=>{
 const events=[];let finish;
 const broker=createVelaWakeBroker({call:async(name,input)=>{events.push(name+':'+input.name);if(input.name==='enable')await new Promise(resolve=>finish=resolve);return {};},authorize:async()=>true,storageAllowed:async()=>true,masterOffLocal:async()=>{events.push('local-capture-off');}});
 const enabled=broker.command({name:'enable',input:{expectedVersion:0,preferences}});await new Promise(resolve=>setImmediate(resolve));
 await broker.command({name:'masterOff',input:{}});assert.deepEqual(events.slice(-2),['local-capture-off','velaWake:masterOff']);finish();await enabled;broker.close();
});
