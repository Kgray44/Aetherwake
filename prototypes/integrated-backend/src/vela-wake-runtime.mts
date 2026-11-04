import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalWakeEngine, type WakePcmResult } from './wake-engine.mts';
import { DEFAULT_WAKE_PHRASES } from './wake-engine-phrases.mts';
import { verifyWakeArtifacts } from './wake-engine-artifacts.mts';
import { decodeNativeWakeFrame, type NativeWakeCaptureServices, type NativeWakePcmFrame } from './wake-capture-host.mts';
import { VelaWakeCoordinator, VELA_WAKE_DEFAULTS, validateWakePreferences, WakePolicyError, type VelaWakePreferences, type VelaWakeHostPorts, type VelaWakeLimits, type WakeCommandAudioLease } from './vela-wake-policy.mts';
import type { VelaVoiceRuntime } from './vela-voice-runtime.mts';
import type { VelaApiRuntime } from './vela-api-runtime.mts';

export interface WakeEnginePort { start():Promise<unknown>;acceptPcm(input:{sequence:number;sampleRate:16000;samples:Float32Array}):Promise<WakePcmResult>;dispose():Promise<void> }
export type WakeEngineFactory=(preferences:Readonly<VelaWakePreferences>,signal:AbortSignal)=>Promise<WakeEnginePort>;
export interface VelaWakeTestServices { engineFactory:WakeEngineFactory;clock?:VelaWakeHostPorts['clock'];limits?:VelaWakeLimits }
export type VelaWakeRequest={name:'state'|'disableWake'|'masterOff'|'reconcile';input:Record<string,never>};
export type VelaWakeNativeRequest={name:'enable'|'save';input:{expectedVersion:number;preferences:Partial<VelaWakePreferences>}}|{name:'ready';input:Record<string,never>};
interface Options {db:DatabaseSync;atomic<T>(work:()=>T):T;api:VelaApiRuntime;voice:VelaVoiceRuntime;capture?:NativeWakeCaptureServices;
  privateRoot?:string;engineFactory?:WakeEngineFactory;clock?:VelaWakeHostPorts['clock'];limits?:VelaWakeLimits;storageAllowed():boolean;
  observe?(view:{phase:string;enabled:boolean;microphone:string;voice:string;detector:string;owner:string|null;sessionId:string|null;settingsVersion:number;errorCode:string|null}):void}
const exact=(value:any,keys:string[])=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Reflect.ownKeys(value).length===keys.length&&keys.every(key=>Object.hasOwn(Object.getOwnPropertyDescriptor(value,key)??{},'value'));
const check:(value:unknown,code:string)=>asserts value=(value,code)=>{if(!value)throw new WakePolicyError(code);};
const clock:VelaWakeHostPorts['clock']={now:()=>Date.now(),schedule:(delay,callback)=>{const timer=setTimeout(callback,delay);timer.unref();return ()=>clearTimeout(timer);}};
const defaultRoots=()=>[join(resolve(dirname(fileURLToPath(import.meta.url)),'../../..'),'vendor','vela-wake'),...(process.env.LOCALAPPDATA?[join(process.env.LOCALAPPDATA,'Aerynth','vela-wake','assets','active')]:[])];
/** No measured Windows/custom-phrase acceptance receipt has been promoted. File presence is not qualification. */
export const productionWakeEngineAccepted=():boolean=>false;
/** Native fixed roots only. No renderer path, download, model install or audio persistence. */
export function defaultWakeEngineFactory(privateRoot:string):WakeEngineFactory{
  return async(preferences,signal)=>{
    check(productionWakeEngineAccepted(),'wake_engine_unqualified');
    check(!signal.aborted&&preferences.phraseId==='hey-vela','wake_engine_unavailable');
    const roots=defaultRoots();
    const root=roots.find(root=>existsSync(join(root,'manifest.json')));check(root,'wake_engine_unavailable');
    await verifyWakeArtifacts(root,join(root,'manifest.json'));check(!signal.aborted,'wake_shutdown');
    return createLocalWakeEngine({artifactRoot:root,manifestPath:join(root,'manifest.json'),workDirectory:join(privateRoot,'wake-runtime'),phrases:[...DEFAULT_WAKE_PHRASES],sensitivity:preferences.sensitivity});
  };
}
/** Settings and consent are canonical SQLite metadata. Audio lives only in Main's volatile lease owner. */
export class VelaWakeRuntime {
  private readonly options:Options;private readonly coordinator:VelaWakeCoordinator;
  private engine:WakeEnginePort|null=null;private captureGeneration:number|null=null;private sequence=0;private processing=false;private closed=false;
  private onDetection:Parameters<VelaWakeHostPorts['detector']['arm']>[0]['onDetection']|null=null;
  private permit:{ref:string;version:number;preferences:string}|null=null;private poll:ReturnType<typeof setInterval>|null=null;private polling=false;
  private readonly leases=new Map<WakeCommandAudioLease,string>();
  private lastObservation='';
  static migrate(db:DatabaseSync){check(db.isTransaction,'wake_storage_unavailable');db.exec(`CREATE TABLE IF NOT EXISTS vela_wake_settings(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL,enabled INTEGER NOT NULL CHECK(enabled IN(0,1)),preferences_json TEXT NOT NULL,configuration_version INTEGER,consented INTEGER NOT NULL CHECK(consented IN(0,1)),capture_generation INTEGER NOT NULL DEFAULT 0);
    INSERT OR IGNORE INTO vela_wake_settings(id,version,enabled,preferences_json,configuration_version,consented) VALUES(1,0,0,'${JSON.stringify(VELA_WAKE_DEFAULTS)}',NULL,0);`);
    if(!db.prepare('PRAGMA table_info(vela_wake_settings)').all().some(row=>row.name==='capture_generation'))db.exec('ALTER TABLE vela_wake_settings ADD COLUMN capture_generation INTEGER NOT NULL DEFAULT 0');}
  constructor(options:Options){this.options=options;
    this.coordinator=new VelaWakeCoordinator({clock:options.clock??clock,
      authorizeEnable:async({preferences,signal})=>{const settings=this.settings(),permit=this.permit;this.permit=null;
        check(!signal.aborted&&permit&&permit.version===settings.version&&permit.preferences===JSON.stringify(preferences)&&settings.enabled&&settings.consented,'wake_opt_in_required');return {authorizationRef:permit.ref};},
      detector:{arm:input=>this.arm(input),suspend:async()=>{const generation=this.captureGeneration;check(generation!==null&&options.capture,'wake_capture_unavailable');await options.capture.pause({generation});},stop:()=>this.stopDetector()},
      commandAudio:{capture:async(event,signal)=>{const generation=this.captureGeneration;check(generation!==null&&options.capture?.lease&&options.capture.releaseLease,'wake_command_audio_unavailable');
        const command=await options.capture.lease({generation,keywordEndSample:event.keywordEndSample,detectedAtSample:event.detectedAtSample});
        if(signal.aborted){await options.capture.releaseLease({leaseRef:command.leaseRef});throw new WakePolicyError('wake_shutdown');}
        let released=false;const lease:WakeCommandAudioLease={release:()=>{if(released)return;released=true;this.leases.delete(lease);void options.capture!.releaseLease!({leaseRef:command.leaseRef}).catch(()=>{});}};
        this.leases.set(lease,command.leaseRef);return {lease,postWakeSpeech:command.postWakeSpeech};}},
      voice:{start:input=>options.voice.wakeStart({activationId:input.activationId,signal:input.signal,inputDeviceId:input.inputDeviceId,
        ...(input.commandAudio?{bufferLeaseRef:this.leases.get(input.commandAudio)}:{}),greeting:input.greeting,validate:()=>this.authorizePaid()}),
        quiesceCapture:input=>options.voice.quiesceOwned(input),stop:input=>options.voice.stopOwned(input),releaseLocal:input=>options.voice.releaseOwned(input),reconcile:input=>options.voice.reconcileOwned(input)},
      observe:()=>{this.ensurePoll();this.observeState();},
    },this.settings().preferences,options.limits);
    this.lastObservation=JSON.stringify(this.observation());
  }
  private observation(){const view=this.coordinator.state();return {phase:view.phase,enabled:view.enabled,microphone:view.microphone,voice:view.voice,detector:view.detector,owner:view.owner,sessionId:view.sessionId,settingsVersion:this.settings().version,errorCode:view.lastError};}
  private observeState(){const view=this.observation(),key=JSON.stringify(view);if(key===this.lastObservation)return;this.options.observe?.(view);this.lastObservation=key;}
  private settings(){const row=this.options.db.prepare('SELECT * FROM vela_wake_settings WHERE id=1').get()!;return {version:Number(row.version),enabled:row.enabled===1,consented:row.consented===1,preferences:JSON.parse(String(row.preferences_json)) as VelaWakePreferences,
    provider:'openai-api-vela' as const,configurationVersion:row.configuration_version===null?null:Number(row.configuration_version)};}
  state(){const settings=this.settings();return {...this.coordinator.state(),settings,available:!!this.options.capture&&!!(this.options.engineFactory||productionWakeEngineAccepted()&&this.options.privateRoot&&defaultRoots().some(root=>existsSync(join(root,'manifest.json')))),
    engineQuality:'unverified' as const,privacy:{ambientAudioStored:false as const,localDetection:true as const,paidIdleDetection:false as const}};}
  private authorizePaid(){const settings=this.settings();check(!this.closed&&settings.enabled&&settings.consented&&this.options.storageAllowed()&&settings.configurationVersion!==null&&
    this.options.api.configurationVersion()===settings.configurationVersion&&this.options.api.authorized(settings.configurationVersion),'wake_paid_authorization_changed');}
  private async arm(input:Parameters<VelaWakeHostPorts['detector']['arm']>[0]){check(!this.closed&&this.options.capture&&this.options.storageAllowed(),'wake_capture_unavailable');
    const generation=this.options.atomic(()=>{const current=Number(this.options.db.prepare('SELECT capture_generation FROM vela_wake_settings WHERE id=1').get()!.capture_generation);
      check(Number.isSafeInteger(current)&&current>=0&&current<Number.MAX_SAFE_INTEGER,'wake_generation_unavailable');this.options.db.prepare('UPDATE vela_wake_settings SET capture_generation=? WHERE id=1').run(current+1);return current+1;});
    this.captureGeneration=generation;this.sequence=0;this.onDetection=input.onDetection;
    const factory=this.options.engineFactory??(this.options.privateRoot?defaultWakeEngineFactory(this.options.privateRoot):undefined);check(factory,'wake_engine_unavailable');
    let engine:WakeEnginePort|null=null;
    try{engine=await factory(input.preferences,input.signal);this.engine=engine;await engine.start();check(!input.signal.aborted&&!this.closed&&this.captureGeneration===generation,'wake_shutdown');
      const state=await this.options.capture.arm({generation,...(input.preferences.inputDeviceId?{inputDeviceId:input.preferences.inputDeviceId}:{})});
      check(state.generation===generation&&state.phase==='capturing'&&state.microphone==='active','wake_capture_unconfirmed');
      check(!input.signal.aborted&&!this.closed&&this.captureGeneration===generation,'wake_shutdown');
    }catch(error){if(this.engine===engine)this.engine=null;await engine?.dispose().catch(()=>{});await this.options.capture.stop({generation}).catch(()=>{});throw error;}
  }
  private async stopDetector(){const generation=this.captureGeneration,engine=this.engine;this.captureGeneration=null;this.engine=null;this.onDetection=null;
    try{await this.options.capture?.stop(generation===null?{}:{generation});}finally{await engine?.dispose();}}
  async frame(value:NativeWakePcmFrame){check(!this.closed&&this.settings().enabled&&this.captureGeneration!==null&&this.engine&&!this.processing,'wake_frame_not_admitted');
    const frame=decodeNativeWakeFrame(value);this.processing=true;
    try{check(frame.generation===this.captureGeneration&&frame.sequence===this.sequence,'wake_frame_not_admitted');this.sequence++;
      if(frame.mode==='handoff')return {accepted:true as const};
      const result=await this.engine!.acceptPcm({sequence:frame.sequence,sampleRate:16000,samples:frame.samples});
      if(frame.generation===this.captureGeneration)for(const event of result.detections)void this.onDetection?.(event).catch(()=>{});
      return {accepted:true as const};
    }finally{frame.samples.fill(0);this.processing=false;}
  }
  private ensurePoll(){if(this.closed)return;const view=this.coordinator.state();if(view.enabled||view.owner){if(!this.poll){this.poll=setInterval(()=>{void this.observeVoice();},250);this.poll.unref();}}else if(this.poll){clearInterval(this.poll);this.poll=null;}}
  async observeVoice(){if(this.polling||this.closed)return;this.polling=true;try{const view=await this.options.voice.wakeObservation();if(view)await this.coordinator.observeNativeVoice(view);}catch{/* A failed state read cannot grant another paid session. */}finally{this.polling=false;}}
  async request(request:VelaWakeRequest){check(request&&exact(request,['name','input'])&&exact(request.input,[]),'wake_invalid_control');
    if(request.name==='state')return this.state();
    if(request.name==='disableWake'||request.name==='masterOff'){try{this.options.atomic(()=>this.options.db.prepare('UPDATE vela_wake_settings SET version=version+1,enabled=0 WHERE id=1').run());}
      finally{if(request.name==='masterOff')await this.coordinator.masterMicrophoneOff();else await this.coordinator.disableWake();}}
    else if(request.name==='reconcile')await this.coordinator.reconcile();else throw new WakePolicyError('wake_invalid_control');
    return this.state();
  }
  async native(request:VelaWakeNativeRequest){check(!this.closed&&request&&exact(request,['name','input']),'wake_invalid_control');
    if(request.name==='ready'){check(exact(request.input,[]),'wake_invalid_control');const current=this.settings();if(current.enabled&&current.consented)await this.enable(current.version);return this.state();}
    check(['enable','save'].includes(request.name)&&exact(request.input,['expectedVersion','preferences'])&&Number.isSafeInteger(request.input.expectedVersion)&&request.input.expectedVersion>=0,'wake_invalid_control');
    const current=this.settings(),preferences=validateWakePreferences({...current.preferences,...request.input.preferences});check(preferences.phraseId==='hey-vela','wake_phrase_unavailable');
    check(current.version===request.input.expectedVersion&&this.options.storageAllowed(),'wake_settings_changed');
    const enabled=request.name==='enable'||current.enabled;
    await this.coordinator.disableWake();
    this.options.atomic(()=>{check(this.settings().version===current.version,'wake_settings_changed');this.options.db.prepare('UPDATE vela_wake_settings SET version=version+1,enabled=?,preferences_json=?,configuration_version=?,consented=? WHERE id=1 AND version=?')
      .run(Number(enabled),JSON.stringify(preferences),this.options.api.configurationVersion(),Number(enabled||current.consented),current.version);});
    if(enabled)await this.enable(current.version+1);return this.state();
  }
  private async enable(version:number){const settings=this.settings();check(settings.version===version,'wake_settings_changed');
    this.permit={ref:randomUUID(),version,preferences:JSON.stringify(settings.preferences)};try{await this.observeVoice();await this.coordinator.enable(settings.preferences);this.ensurePoll();}finally{this.permit=null;}}
  async dispose(){if(this.closed)return;try{await this.coordinator.shutdown();}finally{this.closed=true;clearInterval(this.poll!);this.poll=null;this.permit=null;await this.stopDetector().catch(()=>{});for(const lease of this.leases.keys())lease.release();}}
}
export type VelaWakeState=ReturnType<VelaWakeRuntime['state']>;
