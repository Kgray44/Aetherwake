const { randomUUID } = require('node:crypto');
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value))&&Reflect.ownKeys(value).length===keys.length&&keys.every(key=>Object.hasOwn(Object.getOwnPropertyDescriptor(value,key)??{},'value'));
const id=value=>typeof value==='string'&&value.length>0&&value.length<=512&&!/[\x00-\x20\x7f]/u.test(value);
const text=(value,max)=>typeof value==='string'&&value.length<=max&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(value);
const version=value=>Number.isSafeInteger(value)&&value>=1;
const settingsVersion=value=>Number.isSafeInteger(value)&&value>=0;
const codes=new Set(['voice_invalid_request','voice_user_gesture_required','voice_busy','voice_closed','voice_unavailable','voice_state_invalid','storage_reserve_admission_denied']);
const attempts=new Set(['start','reconnect','audition','createVoice','saveVoice']);
function validVoiceRequest(dto){
  if(!exact(dto,['name','input']))return false;const {name,input:p}=dto;
  if(['state','devices','stop','resumePlayback','interruptPlayback'].includes(name))return exact(p,[]);
  if(name==='mute')return exact(p,['muted'])&&typeof p.muted==='boolean';
  if(['setInputDevice','setOutputDevice'].includes(name))return exact(p,['deviceId'])&&id(p.deviceId);
  if(name==='start'||name==='reconnect')return exact(p,[...(Object.hasOwn(p??{},'inputDeviceId')?['inputDeviceId']:[]),...(Object.hasOwn(p??{},'outputDeviceId')?['outputDeviceId']:[]),...(Object.hasOwn(p??{},'intent')?['intent']:[])])&&(p.inputDeviceId===undefined||id(p.inputDeviceId))&&(p.outputDeviceId===undefined||id(p.outputDeviceId))&&(p.intent===undefined||text(p.intent,8000)&&p.intent.length>0);
  if(name==='audition')return exact(p,[...(Object.hasOwn(p??{},'sample')?['sample']:[]),...(Object.hasOwn(p??{},'voiceId')?['voiceId']:[])])&&(p.sample===undefined||text(p.sample,500)&&p.sample.length>0&&Buffer.byteLength(p.sample)<=500)&&(p.voiceId===undefined||id(p.voiceId));
  if(name==='createVoice')return exact(p,['name','prompt',...(Object.hasOwn(p??{},'scriptHint')?['scriptHint']:[])])&&text(p.name,100)&&p.name.length>0&&text(p.prompt,4000)&&p.prompt.length>0&&(p.scriptHint===undefined||text(p.scriptHint,2000));
  return name==='saveVoice'&&exact(p,['voiceId','expectedSettingsVersion','speechPersonality'])&&(p.voiceId===null||id(p.voiceId))&&settingsVersion(p.expectedSettingsVersion)&&text(p.speechPersonality,2000)&&Buffer.byteLength(p.speechPersonality)<=2000;
}
function safeMedia(value){
  if(value===null)return null;
  const keys=['contract','connection','microphoneAccess','localTrackEnabled','localSourceMuted','providerInputMute','playback','playbackObserved','humanAudibility','inputDevice','outputDevice','localSpeech','remoteSignal','interruption'];
  if(!exact(value,[...keys,...(Object.hasOwn(value??{},'errorCode')?['errorCode']:[])])||value.contract!=='aerynth.gpt-live-media@1'||
    !['idle','preparing','prepared','connecting','connected','closed','failed','disposed'].includes(value.connection)||
    !['not-requested','active','released'].includes(value.microphoneAccess)||typeof value.localTrackEnabled!=='boolean'||!(value.localSourceMuted===null||typeof value.localSourceMuted==='boolean')||
    !['unknown','unmuted','mute-pending','muted','unmute-pending'].includes(value.providerInputMute)||!['idle','pending','playing','blocked','paused','interrupted','ended','error'].includes(value.playback)||
    typeof value.playbackObserved!=='boolean'||value.humanAudibility!=='unverified'||!['default','selected'].includes(value.inputDevice)||!['default','selected'].includes(value.outputDevice)||
    !['unavailable','silent','detected'].includes(value.localSpeech)||!['unavailable','silent','detected'].includes(value.remoteSignal)||!['none','explicit-user','inferred-local-barge-in'].includes(value.interruption)||
    value.errorCode!==undefined&&(typeof value.errorCode!=='string'||!/^live_media_[a-z_]{1,64}$/u.test(value.errorCode)))throw Error('voice_state_invalid');
  return structuredClone(value);
}
function safeVoice(value){
  if(value===null)return null;
  if(!exact(value,['configurationId','configurationVersion','id','name','prompt','createdAt','type'])||!id(value.configurationId)||!version(value.configurationVersion)||!id(value.id)||!text(value.name,100)||!text(value.prompt,4000)||!Number.isSafeInteger(value.createdAt)||value.createdAt<0||value.type!=='prompt')throw Error('voice_state_invalid');
  return structuredClone(value);
}
function safeVoiceState(value){
  if(!exact(value,['available',...(Object.hasOwn(value??{},'reason')?['reason']:[]),'session','media','settings','captions','usage'])||typeof value.available!=='boolean'||
    value.reason!==undefined&&!['Native voice media is unavailable.','Enable Vela API usage in Connections before starting voice.'].includes(value.reason)||
    !exact(value.usage,['enabled','maximumVoiceSeconds','initializationExposureSeconds'])||typeof value.usage.enabled!=='boolean'||value.usage.maximumVoiceSeconds!==300||value.usage.initializationExposureSeconds!==15||
    !Array.isArray(value.captions)||value.captions.length>12||!value.captions.every(c=>exact(c,['messageId','role','content','startMs','endMs','completedTurn'])&&id(c.messageId)&&['user','assistant'].includes(c.role)&&text(c.content,65536)&&Number.isFinite(c.startMs)&&c.startMs>=0&&Number.isFinite(c.endMs)&&c.endMs>=c.startMs&&c.completedTurn===false))throw Error('voice_state_invalid');
  const s=value.session,k=['contract','model','attemptId','sessionId','conversationId','configurationVersion','state','dispatched','initializationExposureSeconds','inputMute','finalization','lastAppend','audioPlayback','transcriptFragments','backend','usage'];
  if(!exact(s,[...k,...(Object.hasOwn(s??{},'errorCode')?['errorCode']:[])])||s.contract!=='aerynth.gpt-live-session@1'||s.model!=='gpt-live-1'||!['attemptId','sessionId','conversationId'].every(key=>s[key]===null||id(s[key]))||
    !(s.configurationVersion===null||version(s.configurationVersion))||!['idle','starting','awaiting-start','running','closing','closed','unknown','failed'].includes(s.state)||typeof s.dispatched!=='boolean'||![0,15].includes(s.initializationExposureSeconds)||
    !['unmuted','mute-pending','muted','unmute-pending','unknown'].includes(s.inputMute)||!['not-requested','pending','confirmed','unconfirmed'].includes(s.finalization)||!['none','pending','accepted','rejected'].includes(s.lastAppend)||s.audioPlayback!=='unverified'||
    !Number.isSafeInteger(s.transcriptFragments)||s.transcriptFragments<0||!['idle','running','unknown'].includes(s.backend)||!exact(s.usage,['seconds','source','final'])||!(s.usage.seconds===null||Number.isFinite(s.usage.seconds)&&s.usage.seconds>=0)||!['provider-reported','unavailable'].includes(s.usage.source)||typeof s.usage.final!=='boolean'||
    s.errorCode!==undefined&&(typeof s.errorCode!=='string'||!/^live_[a-z_]{1,80}$/u.test(s.errorCode)))throw Error('voice_state_invalid');
  const settings=value.settings;
  if(!exact(settings,['version','speechPersonality','selectedVoice','candidates'])||!settingsVersion(settings.version)||!text(settings.speechPersonality,2000)||!Array.isArray(settings.candidates)||settings.candidates.length>64||settings.candidates.some(candidate=>candidate===null))throw Error('voice_state_invalid');
  return {available:value.available,...(value.reason===undefined?{}:{reason:value.reason}),session:structuredClone(s),media:safeMedia(value.media),settings:{version:settings.version,speechPersonality:settings.speechPersonality,selectedVoice:safeVoice(settings.selectedVoice),candidates:settings.candidates.map(safeVoice)},captions:structuredClone(value.captions),usage:structuredClone(value.usage)};
}
function safeDevices(value){
  if(!Array.isArray(value)||value.length>64||!value.every(d=>exact(d,['kind','id','label','labelAvailable'])&&['audioinput','audiooutput'].includes(d.kind)&&id(d.id)&&text(d.label,200)&&typeof d.labelAvailable==='boolean'))throw Error('voice_state_invalid');
  return structuredClone(value);
}
function safeVoiceCreation(value){
  if(!exact(value,['state','dispatched',...(Object.hasOwn(value??{},'candidate')?['candidate']:[]),'savedLocally','selected','audioPreview',...(Object.hasOwn(value??{},'errorCode')?['errorCode']:[])])||!['created','failed','unknown'].includes(value.state)||typeof value.dispatched!=='boolean'||typeof value.savedLocally!=='boolean'||value.selected!==false||value.audioPreview!==false||value.errorCode!==undefined&&(typeof value.errorCode!=='string'||!/^live_[a-z_]{1,80}$/u.test(value.errorCode))||Object.hasOwn(value,'candidate')&&value.candidate===null)throw Error('voice_state_invalid');
  return {...structuredClone(value),...(Object.hasOwn(value,'candidate')?{candidate:safeVoice(value.candidate)}:{})};
}
function createVelaVoiceBroker({call,mediaBroker,authorize,storageAllowed=async()=>true,maximumVoiceSeconds=300}){
  if(!Number.isSafeInteger(maximumVoiceSeconds)||maximumVoiceSeconds<15||maximumVoiceSeconds>300)throw Error('voice_invalid_request');
  let closed=false,busy=false;
  return {
    async command(dto,context){
      try{
        if(closed)throw Error('voice_closed');if(!validVoiceRequest(dto))throw Error('voice_invalid_request');
        const {name,input}=dto;
        if(!attempts.has(name))return name==='devices'?safeDevices(await call('velaVoice',dto)):safeVoiceState(await call('velaVoice',dto));
        if(busy)throw Error('voice_busy');busy=true;
        try{
          if(await authorize(context)!==true||closed)throw Error('voice_user_gesture_required');
          if(!await storageAllowed())throw Error('storage_reserve_admission_denied');
          const attemptId=randomUUID(),operation=name==='createVoice'?'voice-create':name==='saveVoice'?'voice-save':name;
          const grant=await call('velaVoiceNative',{name:'authorize',input:{attemptId,operation,maximumVoiceSeconds,...(input.intent===undefined?{}:{intent:input.intent})}});
          if(closed||!exact(grant,['authorizationRef','attemptId','configurationVersion','expiresAt'])||grant.attemptId!==attemptId||!id(grant.authorizationRef)||!version(grant.configurationVersion)||typeof grant.expiresAt!=='string'||!Number.isFinite(Date.parse(grant.expiresAt))||Date.parse(grant.expiresAt)<=Date.now())throw Error('voice_unavailable');
          if(['start','reconnect','audition'].includes(name))mediaBroker.authorizeAttempt(attemptId);
          const result=await call('velaVoiceNative',{name:operation,input:{...input,...(name==='audition'&&input.sample===undefined?{sample:'Hello. I am Vela. I will speak clearly, warmly, and briefly.'}:{}),attemptId,authorizationRef:grant.authorizationRef}});
          return name==='createVoice'?safeVoiceCreation(result):safeVoiceState(result);
        }finally{busy=false;}
      }catch(error){throw Error(codes.has(error?.message)?error.message:'voice_unavailable');}
    },close(){closed=true;},
  };
}
module.exports={createVelaVoiceBroker,validVoiceRequest,safeVoiceState,safeDevices,safeVoiceCreation,safeMedia};
