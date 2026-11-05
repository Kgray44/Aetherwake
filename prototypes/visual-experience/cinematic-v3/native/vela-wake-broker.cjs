const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join('|')===keys.slice().sort().join('|');
const preferences=p=>exact(p,['phraseId','sensitivity','idleTimeoutMs','dynamicGreeting',...(p?.inputDeviceId===undefined?[]:['inputDeviceId'])])&&typeof p.phraseId==='string'&&/^[a-zA-Z0-9:_-]{1,80}$/u.test(p.phraseId)&&Number.isFinite(p.sensitivity)&&p.sensitivity>=0&&p.sensitivity<=1&&Number.isInteger(p.idleTimeoutMs)&&p.idleTimeoutMs>=15000&&p.idleTimeoutMs<=120000&&typeof p.dynamicGreeting==='boolean'&&(p.inputDeviceId===undefined||typeof p.inputDeviceId==='string'&&p.inputDeviceId.length>0&&p.inputDeviceId.length<=256&&!/[\x00-\x1f]/u.test(p.inputDeviceId));
function validWakeRequest(v){
 if(!exact(v,['name','input']))return false;
 if(['state','disableWake','masterOff','reconcile'].includes(v.name))return exact(v.input,[]);
 return ['enable','save'].includes(v.name)&&exact(v.input,['expectedVersion','preferences'])&&Number.isSafeInteger(v.input.expectedVersion)&&v.input.expectedVersion>=0&&preferences(v.input.preferences);
}
function createVelaWakeBroker({call,authorize,storageAllowed,masterOffLocal}){
 let closed=false,busy=false;
 return {async command(request,context){
  if(closed||!validWakeRequest(request))throw Error('wake_invalid_control');
  const guarded=['enable','save'].includes(request.name);
  if(!guarded){
   if(request.name==='masterOff'){try{await masterOffLocal();}finally{return await call('velaWake',request);}}
   return call('velaWake',request);
  }
  if(busy)throw Error('wake_control_busy');busy=true;
  try{if(await authorize(context)!==true||closed)throw Error('wake_user_gesture_required');if(!await storageAllowed())throw Error('storage_reserve_admission_denied');return await call('velaWakeNative',request);}
  finally{busy=false;}
 },close(){closed=true;}};
}
module.exports={createVelaWakeBroker,validWakeRequest};
