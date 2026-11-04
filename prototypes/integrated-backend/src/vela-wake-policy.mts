import type { WakeDetection } from './wake-engine.mts';
import { randomUUID } from 'node:crypto';

export type VelaWakePhase = 'OFF'|'ARMED'|'ACTIVATING'|'LISTENING'|'SPEAKING'|'WORKING'|'COOLDOWN'|'ERROR';
export interface VelaWakePreferences {
  phraseId:string; sensitivity:number; idleTimeoutMs:number; inputDeviceId?:string; dynamicGreeting:boolean;
}
export const VELA_WAKE_DEFAULTS:Readonly<VelaWakePreferences> = Object.freeze({
  phraseId:'hey-vela',sensitivity:0.5,idleTimeoutMs:20000,dynamicGreeting:true,
});
export interface WakeCommandAudioLease { release():void }
export interface WakeOwnedVoice {
  sessionId?:string; activationId?:string;
  /** Deliberately global only for explicit master microphone-off and shutdown. */
  all?:true;
}
export interface WakeNativeVoiceObservation {
  owner:'wake'|'manual'; sessionId:string; connection:'active'|'closed'|'unknown';
  microphone:'live'|'muted'|'off'|'unknown';
  localSpeechActive:boolean; actualPlaybackActive:boolean; importantResponseQueued:boolean; backendWorking:boolean;
}
export interface VelaWakeView {
  phase:VelaWakePhase; enabled:boolean; microphone:'off'|'wake-only'|'live'|'muted'|'unknown';
  voice:'inactive'|'starting'|'active'|'closing'|'unknown'; detector:'stopped'|'starting'|'armed'|'suspended'|'unknown';
  owner:'wake'|'manual'|null; sessionId:string|null; generation:number; preferences:Readonly<VelaWakePreferences>;
  localSpeechActive:boolean; actualPlaybackActive:boolean; importantResponseQueued:boolean; backendWorking:boolean;
  lastError:string|null; errorBackoffUntil:number|null;
  budget:{startsInWindow:number;maximumStartsPerWindow:number;windowMs:number;dispatchedAttempts:number;
    initializationExposureSecondsPerAttempt:15; possibleInitializationExposureSeconds:number; classification:'potential-exposure-not-billed-usage'};
}
/** All ports are private native-host adapters. Neither renderer flags nor provider text is authority here.
 * Successful detector arm means actual local capture/engine readiness; voice start resolves only after
 * the native session.started event and actual microphone state. Stop must await session.closed or return unknown.
 * Every non-master voice operation MUST check the supplied session/attempt identity before touching resources. */
export interface VelaWakeHostPorts {
  authorizeEnable(input:{preferences:Readonly<VelaWakePreferences>;signal:AbortSignal}):Promise<{authorizationRef:string}>;
  detector:{
    arm(input:{preferences:Readonly<VelaWakePreferences>;signal:AbortSignal;onDetection(event:WakeDetection):Promise<void>}):Promise<void>;
    suspend():Promise<void>; stop():Promise<void>;
  };
  /** Capture must release any unreturned allocation when it rejects or observes cancellation. */
  commandAudio?:{capture(event:WakeDetection,signal:AbortSignal):Promise<{lease?:WakeCommandAudioLease;postWakeSpeech:'present'|'absent'|'unknown'}>};
  voice:{
    start(input:{activationId:string;signal:AbortSignal;inputDeviceId?:string;commandAudio?:WakeCommandAudioLease;
      greeting:'dynamic-in-session'|'none';pronunciation:'VAY-luh';initializationExposureSeconds:15}):Promise<{sessionId:string;microphone:'live'|'muted'}>;
    /** Stop mic tracks and audible playback immediately, preserving the data channel for close acknowledgement. */
    quiesceCapture(input:WakeOwnedVoice):Promise<void>;
    stop(input:WakeOwnedVoice&{reason:string}):Promise<{closure:'confirmed'|'unknown'}>;
    releaseLocal(input:WakeOwnedVoice):Promise<void>;
    /** Read/reconcile prior closure only. It must never start/reconnect a paid session. */
    reconcile(input:WakeOwnedVoice):Promise<{closure:'confirmed'|'unknown'}>;
  };
  clock:{now():number;schedule(delayMs:number,callback:()=>void):()=>void};
  observe?(view:Readonly<VelaWakeView>):void;
}
export interface VelaWakeLimits { cooldownMs?:number;errorBackoffMs?:number;startTimeoutMs?:number;cleanupTimeoutMs?:number;maximumStartsPerWindow?:number;attemptWindowMs?:number }
export class WakePolicyError extends Error {readonly code:string;constructor(code:string){super(code);this.code=code;}}
const requireValue:(value:unknown,code:string)=>asserts value=(value,code)=>{if(!value)throw new WakePolicyError(code);};
export function validateWakePreferences(value:Partial<VelaWakePreferences>={}):VelaWakePreferences {
  requireValue(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>['phraseId','sensitivity','idleTimeoutMs','inputDeviceId','dynamicGreeting'].includes(key)),'wake_preferences_invalid');
  const result={...VELA_WAKE_DEFAULTS,...value};
  requireValue(typeof result.phraseId==='string'&&/^[a-zA-Z0-9:_-]{1,80}$/u.test(result.phraseId)&&Number.isFinite(result.sensitivity)&&result.sensitivity>=0&&result.sensitivity<=1&&
    Number.isInteger(result.idleTimeoutMs)&&result.idleTimeoutMs>=15000&&result.idleTimeoutMs<=120000&&typeof result.dynamicGreeting==='boolean'&&
    (result.inputDeviceId===undefined||typeof result.inputDeviceId==='string'&&result.inputDeviceId.length>0&&result.inputDeviceId.length<=256&&!/[\x00-\x1f]/u.test(result.inputDeviceId)),'wake_preferences_invalid');
  return result;
}
type Session={sessionId:string;activationId?:string;owner:'wake'|'manual'};
type Activation={id:string;generation:number;controller:AbortController;lease?:WakeCommandAudioLease;released:boolean};

/** Volatile lifecycle coordinator only. The canonical host persists preferences/consent and owns all work,
 * transcripts, audio buffering, model policy, billing and credential authority. Constructor is always OFF. */
export class VelaWakeCoordinator {
  private readonly ports:VelaWakeHostPorts;
  private readonly limits:Required<VelaWakeLimits>;
  private prefs:VelaWakePreferences;
  private enabled=false;private closed=false;private generation=0;
  private phase:VelaWakePhase='OFF';private microphone:VelaWakeView['microphone']='off';
  private voice:VelaWakeView['voice']='inactive';private detector:VelaWakeView['detector']='stopped';
  private session:Session|null=null;private activation:Activation|null=null;private controller:AbortController|null=null;
  private unknownScope:WakeOwnedVoice|null=null;
  private pendingArms=0;private pendingStarts=new Set<string>();private starts:number[]=[];private dispatched=0;
  private lastError:string|null=null;private backoffUntil:number|null=null;private lastNow=-Infinity;private lastActivity=0;
  private activity={localSpeechActive:false,actualPlaybackActive:false,importantResponseQueued:false,backendWorking:false};
  private idleCancel:(()=>void)|null=null;private cooldownCancel:(()=>void)|null=null;
  constructor(ports:VelaWakeHostPorts,value:Partial<VelaWakePreferences>={},limits:VelaWakeLimits={}){
    this.ports=ports;this.prefs=validateWakePreferences(value);
    this.limits={cooldownMs:2000,errorBackoffMs:5000,startTimeoutMs:15000,cleanupTimeoutMs:5000,maximumStartsPerWindow:3,attemptWindowMs:60000,...limits};
    requireValue(Object.values(this.limits).every(value=>Number.isSafeInteger(value)&&value>0)&&this.limits.cooldownMs<=10000&&this.limits.errorBackoffMs<=60000&&
      this.limits.startTimeoutMs<=30000&&this.limits.cleanupTimeoutMs<=10000&&this.limits.maximumStartsPerWindow<=10&&this.limits.attemptWindowMs<=300000,'wake_limits_invalid');
    this.lastActivity=this.now();
  }
  private now(){const value=this.ports.clock.now();requireValue(Number.isFinite(value)&&value>=this.lastNow,'wake_clock_invalid');this.lastNow=value;return value;}
  state():Readonly<VelaWakeView>{
    const now=this.now(),startsInWindow=this.starts.filter(value=>value>now-this.limits.attemptWindowMs).length;
    return Object.freeze({phase:this.phase,enabled:this.enabled,microphone:this.microphone,voice:this.voice,detector:this.detector,
      owner:this.session?.owner??(this.activation?'wake':null),sessionId:this.session?.sessionId??null,generation:this.generation,
      preferences:Object.freeze({...this.prefs}),...this.activity,lastError:this.lastError,errorBackoffUntil:this.backoffUntil,
      budget:Object.freeze({startsInWindow,maximumStartsPerWindow:this.limits.maximumStartsPerWindow,windowMs:this.limits.attemptWindowMs,
        dispatchedAttempts:this.dispatched,initializationExposureSecondsPerAttempt:15 as const,possibleInitializationExposureSeconds:this.dispatched*15,
        classification:'potential-exposure-not-billed-usage' as const})});
  }
  private emit(){try{this.ports.observe?.(this.state());}catch{/* A view observer cannot defeat microphone cleanup. */}}
  private invalidate(){this.generation++;this.controller?.abort();this.activation?.controller.abort();this.releaseLease(this.activation);this.controller=null;
    this.idleCancel?.();this.cooldownCancel?.();this.idleCancel=this.cooldownCancel=null;return this.generation;}
  private releaseLease(value:Activation|null){if(!value||value.released||!value.lease)return;value.released=true;try{value.lease.release();}catch{/* Continue all other resource cleanup. */}}
  private isCurrent(generation:number){return !this.closed&&generation===this.generation;}
  private scope(value:Session|Activation|null=this.session??this.activation):WakeOwnedVoice {
    return value&&'sessionId' in value?{sessionId:value.sessionId,...(value.activationId?{activationId:value.activationId}:{})}:value?{activationId:value.id}:{};
  }
  private async bounded<T>(work:Promise<T>,ms:number):Promise<T>{
    let cancel=()=>{};try{return await Promise.race([work,new Promise<T>((_,reject)=>{cancel=this.ports.clock.schedule(ms,()=>reject(new WakePolicyError('wake_adapter_timeout')));})]);}finally{cancel();}
  }
  private fault(code:string){this.phase='ERROR';this.lastError=code;this.backoffUntil=this.now()+this.limits.errorBackoffMs;this.emit();}
  private livePhase(){this.phase=this.activity.actualPlaybackActive?'SPEAKING':this.activity.backendWorking?'WORKING':'LISTENING';}
  async enable(value:Partial<VelaWakePreferences>=this.prefs):Promise<void>{
    requireValue(!this.closed,'wake_shutdown');requireValue(!this.unknownScope&&this.voice!=='unknown'&&this.voice!=='closing'&&!this.pendingStarts.size,'wake_reconciliation_required');
    requireValue(this.pendingArms===0,'wake_local_cleanup_pending');
    if(this.backoffUntil!==null)requireValue(this.now()>=this.backoffUntil,'wake_error_backoff');
    const next=validateWakePreferences(value);
    if(this.enabled&&this.phase==='ARMED'&&JSON.stringify(next)===JSON.stringify(this.prefs))return;
    const generation=this.invalidate(),controller=new AbortController();this.controller=controller;
    try{
      const grant=await this.ports.authorizeEnable({preferences:Object.freeze({...next}),signal:controller.signal});
      if(!this.isCurrent(generation)||controller.signal.aborted)return;
      requireValue(grant&&typeof grant.authorizationRef==='string'&&grant.authorizationRef.length>0&&grant.authorizationRef.length<=256,'wake_opt_in_required');
      this.prefs=next;this.enabled=true;this.lastError=null;this.backoffUntil=null;
      if(this.session){this.detector='suspended';this.livePhase();this.emit();return;}
      if(this.detector!=='stopped')await this.stopDetector();
      if(this.isCurrent(generation))await this.arm(generation);
    }catch{if(this.isCurrent(generation)){this.enabled=false;await this.stopDetector();this.fault('wake_enable_failed');}}
  }
  private async arm(generation:number){
    if(!this.enabled||!this.isCurrent(generation)||this.session||this.pendingStarts.size||this.unknownScope)return;
    const controller=new AbortController();this.controller=controller;this.detector='starting';this.microphone='off';this.phase='OFF';this.pendingArms++;this.emit();
    try{
      await this.ports.detector.arm({preferences:Object.freeze({...this.prefs}),signal:controller.signal,onDetection:event=>this.detected(event,generation)});
      if(!this.isCurrent(generation)||controller.signal.aborted){await this.stopDetector();return;}
      this.detector='armed';this.microphone='wake-only';this.voice='inactive';this.phase='ARMED';this.emit();
    }catch{await this.stopDetector();if(this.isCurrent(generation))this.fault('wake_detector_failed');}
    finally{this.pendingArms--;}
  }
  private async stopDetector(){try{await this.bounded(this.ports.detector.stop(),this.limits.cleanupTimeoutMs);this.detector='stopped';if(this.microphone==='wake-only')this.microphone='off';return true;}
    catch{this.detector='unknown';this.microphone='unknown';return false;}}
  private validDetection(event:WakeDetection){return event&&event.phraseId===this.prefs.phraseId&&event.sampleRate===16000&&event.boundaryAccuracy==='model-estimate'&&
    event.timestampSource==='sherpa-token-alignment-40ms'&&[event.keywordStartSample,event.keywordEndSample,event.detectedAtSample].every(Number.isSafeInteger)&&
    event.keywordStartSample>=0&&event.keywordStartSample<=event.keywordEndSample&&event.keywordEndSample<=event.detectedAtSample;}
  private async detected(event:WakeDetection,armedGeneration:number):Promise<void>{
    if(!this.isCurrent(armedGeneration)||!this.enabled||this.phase!=='ARMED'||this.detector!=='armed'||this.session||!this.validDetection(event))return;
    const now=this.now();this.starts=this.starts.filter(value=>value>now-this.limits.attemptWindowMs);
    if(this.starts.length>=this.limits.maximumStartsPerWindow){this.invalidate();await this.stopDetector();this.fault('wake_attempt_budget_exhausted');return;}
    const generation=++this.generation,activation:Activation={id:'wake-activation:'+randomUUID(),generation,controller:new AbortController(),released:false};
    this.activation=activation;this.phase='ACTIVATING';this.voice='starting';this.emit();
    try{
      await this.ports.detector.suspend();
      if(!this.isCurrent(generation)||activation.controller.signal.aborted)return;
      this.detector='suspended';
      const command=await this.ports.commandAudio?.capture(event,activation.controller.signal);
      if(command?.lease)activation.lease=command.lease;
      if(!this.isCurrent(generation)||activation.controller.signal.aborted){this.releaseLease(activation);return;}
      const hasCommand=command?.postWakeSpeech==='present';
      this.starts.push(this.now());this.dispatched++;this.pendingStarts.add(activation.id);this.emit();
      let raw:ReturnType<VelaWakeHostPorts['voice']['start']>;
      try{raw=this.ports.voice.start({activationId:activation.id,signal:activation.controller.signal,...(this.prefs.inputDeviceId?{inputDeviceId:this.prefs.inputDeviceId}:{}),
        ...(activation.lease?{commandAudio:activation.lease}:{}),greeting:!hasCommand&&command?.postWakeSpeech==='absent'&&this.prefs.dynamicGreeting?'dynamic-in-session':'none',
        pronunciation:'VAY-luh',initializationExposureSeconds:15});}catch(error){this.pendingStarts.delete(activation.id);throw error;}
      // The raw continuation cleans a late successful start even after timeout, cancellation, device change or shutdown.
      const guarded=raw.then(async result=>{
        this.pendingStarts.delete(activation.id);
        requireValue(result&&typeof result.sessionId==='string'&&result.sessionId.length>0&&['live','muted'].includes(result.microphone),'wake_start_unconfirmed');
        if(!this.isCurrent(generation)||activation.controller.signal.aborted){
          const outcome=await this.closeOwned({activationId:activation.id,sessionId:result.sessionId},'late-start');
          if(!this.session&&!this.pendingStarts.size){this.voice=outcome?'inactive':'unknown';if(!outcome)this.fault('wake_late_close_unknown');
            else if(!this.enabled){this.phase='OFF';this.microphone=this.detector==='stopped'?'off':'unknown';this.emit();}}
          return null;
        }
        return result;
      },async()=>{
        this.pendingStarts.delete(activation.id);
        if(!this.isCurrent(generation)||activation.controller.signal.aborted){
          const outcome=await this.closeOwned({activationId:activation.id},'late-start-failed');
          if(!this.session&&!this.pendingStarts.size){this.voice=outcome?'inactive':'unknown';if(!outcome)this.fault('wake_late_close_unknown');
            else if(!this.enabled){this.phase='OFF';this.microphone=this.detector==='stopped'?'off':'unknown';this.emit();}}
          return null;
        }
        throw new WakePolicyError('wake_native_start_failed');
      });
      const result=await this.bounded(guarded,this.limits.startTimeoutMs);
      if(!result||!this.isCurrent(generation)||activation.controller.signal.aborted)return;
      this.session={sessionId:result.sessionId,activationId:activation.id,owner:'wake'};this.activation=null;
      this.voice='active';this.microphone=result.microphone;this.activity={localSpeechActive:false,actualPlaybackActive:false,importantResponseQueued:false,backendWorking:false};
      this.lastActivity=this.now();this.livePhase();this.scheduleIdle();this.emit();
    }catch{
      if(this.isCurrent(generation)){activation.controller.abort();const stopped=await this.closeOwned(this.scope(activation),'activation-failed');await this.stopDetector();
        this.voice=stopped&&!this.pendingStarts.size?'inactive':'unknown';this.fault(stopped?'wake_activation_failed':'wake_activation_close_unknown');}
    }finally{this.releaseLease(activation);if(this.activation===activation)this.activation=null;}
  }
  private async closeOwned(scope:WakeOwnedVoice,reason:string):Promise<boolean>{
    // Quiesce before waiting for provider closure. Keep the channel alive to drain session.closed.
    const previousScope=scope.all?this.scope():scope;
    let quiesced=false,confirmed=false,released=false;
    try{await this.bounded(this.ports.voice.quiesceCapture(scope),this.limits.cleanupTimeoutMs);quiesced=true;}
    catch{try{await this.bounded(this.ports.voice.releaseLocal(scope),this.limits.cleanupTimeoutMs);}catch{/* Still attempt remote close. */}}
    if(!this.session||scope.all||this.session.sessionId===scope.sessionId){this.microphone=quiesced?'off':'unknown';this.emit();}
    try{const result=await this.bounded(this.ports.voice.stop({...scope,reason}),this.limits.cleanupTimeoutMs);confirmed=result?.closure==='confirmed';}
    catch{/* Unknown closure is never promoted to confirmed. */}
    finally{try{await this.bounded(this.ports.voice.releaseLocal(scope),this.limits.cleanupTimeoutMs);released=true;
      if((!this.session||scope.all||this.session.sessionId===scope.sessionId)&&this.detector!=='unknown')this.microphone='off';
    }catch{/* Retain unknown local state. */}}
    if(!confirmed&&(previousScope.sessionId||previousScope.activationId))this.unknownScope={...previousScope};
    else if(confirmed&&(scope.all||JSON.stringify(this.unknownScope)===JSON.stringify(scope)))this.unknownScope=null;
    return confirmed&&released&&(quiesced||released);
  }
  private scheduleIdle(){
    this.idleCancel?.();this.idleCancel=null;
    if(this.session?.owner!=='wake'||this.voice!=='active')return;
    const generation=this.generation,delay=Math.max(1,this.lastActivity+this.prefs.idleTimeoutMs-this.now());
    this.idleCancel=this.ports.clock.schedule(delay,()=>{this.idleCancel=null;void this.checkIdle(generation);});
  }
  private async checkIdle(generation:number){
    if(!this.isCurrent(generation)||this.session?.owner!=='wake'||this.voice!=='active')return;
    if(this.activity.localSpeechActive||this.activity.actualPlaybackActive||this.activity.importantResponseQueued){this.lastActivity=this.now();this.scheduleIdle();return;}
    if(this.now()-this.lastActivity<this.prefs.idleTimeoutMs){this.scheduleIdle();return;}
    await this.endSession('idle');
  }
  private cooldown(){
    this.cooldownCancel?.();this.cooldownCancel=null;
    if(this.unknownScope){this.voice='unknown';this.fault('wake_prior_close_unknown');return;}
    if(!this.enabled||this.closed){this.phase='OFF';this.emit();return;}
    this.phase='COOLDOWN';const generation=this.generation;this.emit();
    this.cooldownCancel=this.ports.clock.schedule(this.limits.cooldownMs,()=>{this.cooldownCancel=null;if(this.isCurrent(generation))void this.arm(generation);});
  }
  private async endSession(reason:string){
    const scope=this.scope(),generation=this.invalidate();this.voice='closing';this.phase='COOLDOWN';this.emit();
    const [detectorStopped,confirmed]=await Promise.all([this.stopDetector(),this.closeOwned(scope,reason)]);
    if(!this.isCurrent(generation))return;
    this.session=null;this.activation=null;this.activity={localSpeechActive:false,actualPlaybackActive:false,importantResponseQueued:false,backendWorking:this.activity.backendWorking};
    if(!confirmed||!detectorStopped||this.pendingStarts.size){this.voice='unknown';this.fault('wake_close_unknown');return;}
    this.voice='inactive';this.microphone='off';this.cooldown();
  }
  async disableWake():Promise<void>{
    this.enabled=false;const manual=this.session?.owner==='manual',generation=this.invalidate();
    const stopped=await this.stopDetector();
    if(manual){if(stopped){this.livePhase();this.emit();}else this.fault('wake_detector_stop_failed');return;}
    if(this.session||this.activation||this.pendingStarts.size){this.voice='closing';this.emit();const confirmed=await this.closeOwned(this.scope(),'wake-disabled');
      if(generation!==this.generation)return;this.session=null;this.activation=null;this.voice=confirmed&&!this.pendingStarts.size?'inactive':'unknown';
      if(!confirmed||this.pendingStarts.size||!stopped){this.fault('wake_disabled_close_unknown');return;}}
    this.phase=stopped?'OFF':'ERROR';if(stopped){this.microphone='off';this.lastError=null;}this.emit();
  }
  async masterMicrophoneOff():Promise<void>{
    this.enabled=false;const generation=this.invalidate();this.voice=this.session||this.pendingStarts.size?'closing':this.voice;this.emit();
    // Both begin before the first await. A slow remote close cannot leave the detector capturing.
    const detectorWork=this.stopDetector(),voiceWork=this.closeOwned({all:true},'master-microphone-off');
    const [stopped,confirmed]=await Promise.all([detectorWork,voiceWork]);
    if(generation!==this.generation)return;
    this.session=null;this.activation=null;this.activity={localSpeechActive:false,actualPlaybackActive:false,importantResponseQueued:false,backendWorking:this.activity.backendWorking};
    if(!stopped||!confirmed||this.pendingStarts.size){this.voice='unknown';if(!stopped)this.microphone='unknown';this.fault('wake_master_close_unknown');return;}
    this.voice='inactive';this.microphone='off';this.phase='OFF';this.lastError=null;this.emit();
  }
  /** Native media/session events only; never a renderer assertion of microphone, playback or session state. */
  async observeNativeVoice(observation:WakeNativeVoiceObservation):Promise<void>{
    requireValue(observation&&typeof observation.sessionId==='string'&&observation.sessionId.length>0&&['wake','manual'].includes(observation.owner)&&
      ['active','closed','unknown'].includes(observation.connection)&&['live','muted','off','unknown'].includes(observation.microphone)&&
      ['localSpeechActive','actualPlaybackActive','importantResponseQueued','backendWorking'].every(key=>typeof observation[key as keyof WakeNativeVoiceObservation]==='boolean'),'wake_native_observation_invalid');
    if(this.closed)return;
    if(observation.connection==='active'&&observation.owner==='manual'&&this.session?.sessionId!==observation.sessionId){
      this.invalidate();this.session={sessionId:observation.sessionId,owner:'manual'};this.activation=null;
      try{await this.ports.detector.suspend();this.detector='suspended';}catch{await this.stopDetector();}
    }
    if(this.session?.sessionId!==observation.sessionId||this.session.owner!==observation.owner)return;
    if(observation.connection==='unknown'){
      this.invalidate();this.voice='unknown';this.microphone=observation.microphone;
      await Promise.allSettled([this.stopDetector(),this.closeOwned(this.scope(),'native-connection-unknown')]);this.fault('wake_native_closure_unknown');return;
    }
    if(observation.connection==='closed'){
      this.invalidate();const released=await this.closeOwned(this.scope(),'observed-closed');await this.stopDetector();this.session=null;
      this.voice=released?'inactive':'unknown';this.microphone=released?'off':'unknown';if(released)this.cooldown();else this.fault('wake_observed_close_unknown');return;
    }
    const meaningful=observation.localSpeechActive!==this.activity.localSpeechActive||observation.actualPlaybackActive!==this.activity.actualPlaybackActive||
      observation.importantResponseQueued!==this.activity.importantResponseQueued;
    this.voice='active';this.microphone=observation.microphone;
    this.activity={localSpeechActive:observation.localSpeechActive,actualPlaybackActive:observation.actualPlaybackActive,
      importantResponseQueued:observation.importantResponseQueued,backendWorking:observation.backendWorking};
    if(meaningful)this.lastActivity=this.now();this.livePhase();this.scheduleIdle();this.emit();
  }
  /** Explicit host/device change. It stops the session; it never charges for an automatic reconnect. */
  async deviceChanged():Promise<void>{await this.masterMicrophoneOff();}
  async reconcile():Promise<void>{
    requireValue(!this.closed,'wake_shutdown');requireValue(!this.pendingStarts.size&&!this.pendingArms,'wake_cleanup_pending');
    if(this.backoffUntil!==null)requireValue(this.now()>=this.backoffUntil,'wake_error_backoff');
    const scope=this.unknownScope??this.scope(),generation=this.invalidate();
    let confirmed=false;try{const result=await this.bounded(this.ports.voice.reconcile(scope),this.limits.cleanupTimeoutMs);confirmed=result?.closure==='confirmed';}catch{/* Remain unknown. */}
    const stopped=await this.stopDetector(),released=await this.closeOwned(scope,'explicit-reconciliation');
    if(!this.isCurrent(generation))return;
    if(!confirmed||!released||!stopped){this.voice='unknown';this.fault('wake_reconciliation_unknown');return;}
    this.unknownScope=null;this.lastError=null;this.backoffUntil=null;
    if(this.session?.owner==='manual'&&this.session.sessionId!==scope.sessionId){this.voice='active';this.livePhase();this.emit();return;}
    this.session=null;this.voice='inactive';this.microphone='off';
    if(this.enabled)await this.arm(generation);else{this.phase='OFF';this.emit();}
  }
  async shutdown():Promise<void>{if(this.closed)return;await this.masterMicrophoneOff();this.closed=true;this.invalidate();}
}
