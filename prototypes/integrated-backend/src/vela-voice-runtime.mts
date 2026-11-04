import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { GptLiveController, LiveError } from '../../openai-provider/live.mts';
import type { CanonicalVelaRuntimePort, LiveCanonicalContext, LiveDelegationBinding, LiveNativeReview, LiveSessionView, LiveTranscriptFragment, PromptVoiceResult, SavedPromptVoice, SavedCustomVoice } from '../../openai-provider/live-contracts.mts';
import {abortable} from '../../openai-provider/common.mts';
import {readSavedVoiceCatalog,REQUESTED_VOICE_NAMES,VoiceCatalogError,type SavedVoiceCatalog} from '../../openai-provider/voice-catalog.mts';
import type { GptLiveAudioDevice, GptLiveMediaState, NativeLiveMediaServices } from './live-media-host.mts';
import { VELA_API_CONFIGURATION_ID, type VelaApiConnection } from './vela-api-connection.mts';
import type { VelaApiRuntime } from './vela-api-runtime.mts';
import type { WakeOwnedVoice, WakeNativeVoiceObservation } from './vela-wake-policy.mts';
export type VoiceOperation = 'start'|'reconnect'|'audition'|'voice-create'|'voice-save';
export interface VoiceAuthorization { authorizationRef:string;attemptId:string;configurationVersion:number;expiresAt:string }
export interface VoiceCaption { messageId:string;role:'user'|'assistant';content:string;startMs:number;endMs:number;completedTurn:false }
export interface VelaVoiceState {
  available:boolean;reason?:string;session:LiveSessionView;media:GptLiveMediaState|null;
  settings:{version:number;speechPersonality:string;selectedVoice:SavedCustomVoice|null;candidates:SavedCustomVoice[];catalog?:VoiceCatalogView};
  captions:VoiceCaption[];
  usage:{enabled:boolean;maximumVoiceSeconds:300;initializationExposureSeconds:15};
}
export interface VoiceCatalogView {state:'unresolved'|'ready'|'unavailable'|'stale';configurationVersion:number|null;observedAt:number|null;expiresAt:number|null;errorCode?:string}
type CatalogCache={configurationVersion:number;observedAt:number;expiresAt:number;data?:SavedVoiceCatalog;errorCode?:string};
export type VelaVoiceControlRequest = {name:'state'|'refreshVoices'|'devices'|'stop'|'resumePlayback'|'interruptPlayback';input:Record<string,never>} |
  {name:'mute';input:{muted:boolean}} | {name:'setInputDevice'|'setOutputDevice';input:{deviceId:string}};
export type VelaVoiceRequest = VelaVoiceControlRequest |
  {name:'start'|'reconnect';input:{inputDeviceId?:string;outputDeviceId?:string;intent?:string}} |
  {name:'audition';input:{voiceId?:string;sample?:string}} |
  {name:'createVoice';input:{name:string;prompt:string;scriptHint?:string}} |
  {name:'saveVoice';input:{voiceId:string|null;expectedSettingsVersion:number;speechPersonality:string}};
export type VelaVoiceNativeRequest = {name:'authorize';input:{attemptId:string;operation:VoiceOperation;maximumVoiceSeconds?:number;intent?:string}} |
  {name:'start'|'reconnect'|'audition';input:{attemptId:string;authorizationRef:string;inputDeviceId?:string;outputDeviceId?:string;sample?:string;voiceId?:string;intent?:string}} |
  {name:'voice-create';input:{attemptId:string;authorizationRef:string;name:string;prompt:string;scriptHint?:string}} |
  {name:'voice-save';input:{attemptId:string;authorizationRef:string;voiceId:string|null;expectedSettingsVersion:number;speechPersonality:string}};
export interface VoiceCanonicalHost {
  context(input:Parameters<CanonicalVelaRuntimePort['context']>[0]):Promise<LiveCanonicalContext>;
  validateContext(ref:string,digest:string):Promise<void>;
  conversationId():string;
  fragment(fragment:LiveTranscriptFragment,existingMessageId?:string):string;
  message(messageId:string):{id:string;role:'user'|'assistant'|'system';content:string}|null;
  seal(messageId:string,sessionId:string):void;
  acceptIntent(intent:string,attemptId:string):void;
  delegate(binding:LiveDelegationBinding,intent:string,messageId:string):Promise<{state:'verified'|'failed'|'unknown';content?:string;receiptRef?:string}>;
  observe(type:string,details:{sessionId?:string;attemptId?:string;state?:string;usageSeconds?:number;messageId?:string;delegationId?:string;catalogCount?:number;errorCode?:string}):void;
}
interface Options {
  storageAllowed?:()=>boolean;
  db:DatabaseSync;atomic<T>(work:()=>T):T;connection:VelaApiConnection;api:VelaApiRuntime;media?:NativeLiveMediaServices;host:VoiceCanonicalHost;
  test?:{fetch:typeof fetch;acknowledgementMs?:number};
}
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const check:(condition:unknown,code:string)=>asserts condition=(condition,code)=>{if(!condition)throw new LiveError(code);};
const id=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=256&&!/[\x00-\x20\x7f]/u.test(value);
const exact=(value:unknown,keys:string[]):value is Record<string,any>=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Reflect.ownKeys(value).length===keys.length&&keys.every(key=>Object.hasOwn(Object.getOwnPropertyDescriptor(value,key)??{},'value'));
const brief=(value:string)=>{let out='';for(const part of value){if(Buffer.byteLength(out+part)>480)break;out+=part;}return out;};
/** Canonical metadata owner. Transcript bodies live only in the existing graph. */
export class VelaVoiceRuntime {
  private readonly options:Options;
  private readonly controller:GptLiveController;
  private closed=false;
  private controlBusy=false;
  private wakePreparing:string|null=null;
  private pendingStart:{attemptId:string;controller:AbortController}|null=null;
  private readonly wakeOwners=new Map<string,{attemptId:string;signal:AbortSignal;validate():void}>();
  private readonly catalogLifetime=new AbortController();
  private catalogFlight?:{version:number;promise:Promise<void>};
  static migrate(db:DatabaseSync){
    check(db.isTransaction,'live_storage_unavailable');
    db.exec(`CREATE TABLE IF NOT EXISTS vela_voice_grants(ref TEXT PRIMARY KEY,attempt_id TEXT NOT NULL,operation TEXT NOT NULL,configuration_version INTEGER NOT NULL,expires_at INTEGER NOT NULL,used INTEGER NOT NULL,maximum_seconds INTEGER NOT NULL,intent_digest TEXT);
      CREATE TABLE IF NOT EXISTS vela_voice_sessions(attempt_id TEXT PRIMARY KEY,json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS vela_voice_fragments(session_id TEXT NOT NULL,event_id TEXT NOT NULL,fingerprint TEXT NOT NULL,message_id TEXT NOT NULL,PRIMARY KEY(session_id,event_id));
      CREATE TABLE IF NOT EXISTS vela_voice_groups(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,role TEXT NOT NULL,message_id TEXT NOT NULL,start_ms REAL NOT NULL,end_ms REAL NOT NULL,sealed INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS vela_voice_delegations(session_id TEXT NOT NULL,delegation_id TEXT NOT NULL,group_id TEXT NOT NULL,state TEXT NOT NULL,receipt_ref TEXT,PRIMARY KEY(session_id,delegation_id),UNIQUE(session_id,group_id));
      CREATE TABLE IF NOT EXISTS vela_voice_settings(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL,personality TEXT NOT NULL,selected_voice TEXT);
      INSERT OR IGNORE INTO vela_voice_settings(id,version,personality,selected_voice) VALUES(1,0,'Speak naturally, warmly and concisely. Use brief backchannels and yield when interrupted.',NULL);
      CREATE TABLE IF NOT EXISTS vela_voice_candidates(id TEXT PRIMARY KEY,json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS vela_voice_catalog(id INTEGER PRIMARY KEY CHECK(id=1),json TEXT NOT NULL);`);
    if(!db.prepare('PRAGMA table_info(vela_voice_settings)').all().some(row=>row.name==='selection_policy'))db.exec('ALTER TABLE vela_voice_settings ADD COLUMN selection_policy INTEGER NOT NULL DEFAULT 0');
    db.prepare("UPDATE vela_voice_delegations SET state='unknown' WHERE state='claimed'").run();
    for(const row of db.prepare('SELECT attempt_id,json FROM vela_voice_sessions').all()){
      const view=JSON.parse(String(row.json));if(['starting','awaiting-start','running','closing'].includes(view.state)){
        view.state='unknown';view.finalization='unconfirmed';view.errorCode='live_restart_unknown';db.prepare('UPDATE vela_voice_sessions SET json=? WHERE attempt_id=?').run(JSON.stringify(view),row.attempt_id!);
      }
    }
  }
  constructor(options:Options){
    this.options=options;
    const unavailable:NativeLiveMediaServices={prepare:async()=>{throw new LiveError('live_media_unavailable');},connect:async()=>{throw new LiveError('live_media_unavailable');},devices:async()=>[],state:async()=>{throw new LiveError('live_media_unavailable');},setInputDevice:async()=>{},setOutputDevice:async()=>{},setLocalMute:async()=>{},resumePlayback:async()=>{},interruptPlayback:async()=>{},dispose:async()=>{}};
    const media=options.media??unavailable;
    const runtime:CanonicalVelaRuntimePort={context:input=>options.host.context(input),validateContext:(ref,digest)=>options.host.validateContext(ref,digest),
      receiveFragment:fragment=>this.receiveFragment(fragment),claimDelegation:binding=>this.claim(binding),delegate:binding=>this.delegate(binding),
      reconcile:async input=>{
        check(!input.signal.aborted,'live_operation_aborted');
        const unknown=options.db.prepare("SELECT 1 FROM vela_voice_delegations WHERE state IN('claimed','unknown') AND session_id=?").get(input.previousSessionId??'');
        return unknown?{state:'unknown'}:{state:'reconciled',reconciliationRef:'voice-reconciled:'+hash(input.previousAttemptId)};
      },recordVoiceCandidate:async voice=>this.recordCandidate(voice),saveVoiceSelection:async input=>this.saveSelection(input.voice,input.expectedSettingsVersion,input.speechPersonality),};
    this.controller=new GptLiveController({runtime,media,limits:{maximumVoiceSeconds:300,...(options.test?.acknowledgementMs?{acknowledgementMs:options.test.acknowledgementMs}:{})},
      ...(options.test?{fetch:options.test.fetch}:{}),native:{authorize:review=>this.authorizeReview(review),
        resolveCredential:async(configurationId,version)=>{this.allowed(version);check(configurationId===VELA_API_CONFIGURATION_ID,'live_credential_boundary');return options.connection.resolveNativeCredential(version);},
        revalidate:async(review,boundary)=>{this.validateWakeAttempt(review.attemptId);this.allowed(review.configurationVersion);await options.connection.revalidate(review.configurationVersion,boundary);this.validateWakeAttempt(review.attemptId);this.allowed(review.configurationVersion);},},
      onState:view=>{
        if(this.closed)return;
        options.atomic(()=>{if(view.attemptId)options.db.prepare('INSERT INTO vela_voice_sessions VALUES(?,?) ON CONFLICT(attempt_id) DO UPDATE SET json=excluded.json').run(view.attemptId,JSON.stringify(view));});
        options.host.observe('state',{...(view.sessionId?{sessionId:view.sessionId}:{}),...(view.attemptId?{attemptId:view.attemptId}:{}),state:view.state,
          ...(view.usage.seconds===null?{}:{usageSeconds:view.usage.seconds})});
      },});
  }
  private allowed(version:number){check(!this.closed&&this.options.api.authorized(version),'live_api_usage_authorization_required');}
  private validateWakeAttempt(attemptId:string){for(const owner of this.wakeOwners.values())if(owner.attemptId===attemptId){check(!owner.signal.aborted,'live_operation_aborted');owner.validate();}}
  private catalogCache():CatalogCache|null{const row=this.options.db.prepare('SELECT json FROM vela_voice_catalog WHERE id=1').get();if(!row||typeof row.json!=='string'||Buffer.byteLength(row.json)>32768)return null;try{return JSON.parse(row.json) as CatalogCache;}catch{return null;}}
  private catalogView():VoiceCatalogView{const version=this.options.api.configurationVersion(),cache=this.catalogCache();if(!cache||cache.configurationVersion!==version)return{state:'unresolved',configurationVersion:version,observedAt:null,expiresAt:null};return{state:cache.expiresAt<=Date.now()?'stale':cache.errorCode?'unavailable':'ready',configurationVersion:version,observedAt:cache.observedAt,expiresAt:cache.expiresAt,...(cache.errorCode?{errorCode:cache.errorCode}:{})};}
  private settings(){const row=this.options.db.prepare('SELECT * FROM vela_voice_settings WHERE id=1').get()!,cache=this.catalogCache(),candidates=this.options.db.prepare('SELECT json FROM vela_voice_candidates ORDER BY rowid DESC LIMIT 16').all().map(row=>JSON.parse(String(row.json)) as SavedCustomVoice),byId=new Map(candidates.map(voice=>[voice.id,voice]));
    if(cache?.configurationVersion===this.options.api.configurationVersion())for(const voice of cache.data?.voices??[])byId.set(voice.id,voice);
    const requested=cache?.configurationVersion===this.options.api.configurationVersion()?cache.data?.voices??[]:[];
    return {version:Number(row.version),selectionPolicy:Number(row.selection_policy),speechPersonality:String(row.personality),selectedVoice:row.selected_voice?JSON.parse(String(row.selected_voice)) as SavedCustomVoice:null,candidates:requested.length?[...requested,...[...byId.values()].filter(voice=>!REQUESTED_VOICE_NAMES.includes(voice.name as typeof REQUESTED_VOICE_NAMES[number]))]:[...byId.values()]};}
  private storage(){check(this.options.storageAllowed?.()??true,'storage_reserve_admission_denied');}
  private adoptCatalog(data:SavedVoiceCatalog,expectedVersion:number){this.storage();this.options.atomic(()=>{
    this.storage();this.allowed(data.configurationVersion);const row=this.options.db.prepare('SELECT * FROM vela_voice_settings WHERE id=1').get()!;if(Number(row.version)!==expectedVersion)return;
    const current=row.selected_voice?JSON.parse(String(row.selected_voice)) as SavedCustomVoice:null;
    let selected=current;
    if(Number(row.selection_policy)===0||current===null)selected=current?.name==='Vela 2'?data.voices.find(voice=>voice.id===current.id&&voice.name==='Vela 2')??current:data.voices.find(voice=>voice.name==='Vela 3')??current;
    else if(REQUESTED_VOICE_NAMES.includes(current.name as typeof REQUESTED_VOICE_NAMES[number]))selected=data.voices.find(voice=>voice.id===current.id&&voice.name===current.name)??current;
    if(Number(row.selection_policy)!==1||JSON.stringify(selected)!==JSON.stringify(current))this.options.db.prepare('UPDATE vela_voice_settings SET version=version+1,selected_voice=?,selection_policy=1 WHERE id=1 AND version=?').run(selected?JSON.stringify(selected):null,expectedVersion);
  });}
  private async refreshVoices():Promise<void>{
    const version=this.options.api.configurationVersion();check(version!==null,'live_api_usage_authorization_required');this.allowed(version);
    if(this.catalogFlight?.version===version)return this.catalogFlight.promise;
    const snapshot=this.settings(),cached=this.catalogCache();
    if(cached?.configurationVersion===version&&cached.expiresAt>Date.now()){
      if(cached.data){try{await this.options.connection.revalidate(version,cached.data.boundaryDigest);this.allowed(version);this.adoptCatalog(cached.data,snapshot.version);return;}catch(error){if((error as {code?:string}).code==='storage_reserve_admission_denied')throw error;}}
      else return;
    }
    this.storage();
    const task=(async()=>{
      try{const data=await readSavedVoiceCatalog({configurationId:VELA_API_CONFIGURATION_ID,configurationVersion:version,signal:this.catalogLifetime.signal,
        resolveCredential:async()=>{this.allowed(version);return this.options.connection.resolveNativeCredential(version);},revalidate:async boundary=>{this.allowed(version);await this.options.connection.revalidate(version,boundary);this.allowed(version);},...(this.options.test?{fetch:this.options.test.fetch}:{})});
        this.allowed(version);this.storage();this.options.atomic(()=>{this.storage();this.options.db.prepare('INSERT INTO vela_voice_catalog VALUES(1,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').run(JSON.stringify({configurationVersion:version,observedAt:data.observedAt,expiresAt:data.expiresAt,data} satisfies CatalogCache));});this.adoptCatalog(data,snapshot.version);this.options.host.observe('voice-catalog',{state:'ready',catalogCount:data.voices.length});
      }catch(error){if(this.closed||this.catalogLifetime.signal.aborted||!this.options.api.authorized(version))return;this.storage();const allowed=['live_voice_catalog_unavailable','live_voice_catalog_access_unavailable','live_voice_catalog_invalid','live_voice_catalog_incomplete','live_voice_catalog_ambiguous','live_voice_catalog_credential'];const errorCode=error instanceof VoiceCatalogError&&allowed.includes(error.code)?error.code:'live_voice_catalog_unavailable',now=Date.now();this.options.atomic(()=>{this.storage();this.options.db.prepare('INSERT INTO vela_voice_catalog VALUES(1,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').run(JSON.stringify({configurationVersion:version,observedAt:now,expiresAt:now+30000,errorCode} satisfies CatalogCache));});this.options.host.observe('voice-catalog',{state:'unavailable',errorCode});}
    })();const flight={version,promise:task};this.catalogFlight=flight;try{await task;}finally{if(this.catalogFlight===flight)this.catalogFlight=undefined;}
  }
  private async voiceForStart(voiceId:string|undefined,signal:AbortSignal):Promise<SavedCustomVoice>{
    const initial=this.settings(),chosen=voiceId?initial.candidates.find(voice=>voice.id===voiceId):initial.selectedVoice;
    // Explicit locally created voices remain supported; the requested named voices use provider discovery.
    if(initial.selectionPolicy===1&&chosen&&!REQUESTED_VOICE_NAMES.includes(chosen.name as typeof REQUESTED_VOICE_NAMES[number])){this.allowed(chosen.configurationVersion);return chosen;}
    await abortable(this.refreshVoices(),signal);signal.throwIfAborted();const settings=this.settings(),cache=this.catalogCache(),selected=voiceId?settings.candidates.find(voice=>voice.id===voiceId):settings.selectedVoice;
    check(cache?.data&&cache.configurationVersion===this.options.api.configurationVersion()&&cache.expiresAt>Date.now()&&selected,'live_voice_unavailable');
    const voice=cache.data.voices.find(voice=>voice.id===selected.id&&voice.name===selected.name);check(voice,'live_voice_unavailable');return voice;
  }
  async state():Promise<VelaVoiceState>{
    const current=this.controller.state(),prior=!current.attemptId?this.options.db.prepare('SELECT json FROM vela_voice_sessions ORDER BY rowid DESC LIMIT 1').get():null;
    let media:GptLiveMediaState|null=null;try{media=await this.options.media?.state()??null;}catch{/* Native media may be absent/offline. */}
    const session=prior?JSON.parse(String(prior.json)) as LiveSessionView:current;
    const captions=this.options.db.prepare('SELECT message_id,role,start_ms,end_ms FROM vela_voice_groups ORDER BY rowid DESC LIMIT 12').all().reverse().flatMap(row=>{
      const message=this.options.host.message(String(row.message_id));return message?[{messageId:message.id,role:row.role as 'user'|'assistant',content:message.content,startMs:Number(row.start_ms),endMs:Number(row.end_ms),completedTurn:false as const}]:[];});
    const enabled=this.options.api.authorized(),settings=this.settings();return {available:!!this.options.media&&enabled,...(!this.options.media?{reason:'Native voice media is unavailable.'}:!enabled?{reason:'Enable Vela API usage in Connections before starting voice.'}:{}),session,media,settings:{version:settings.version,speechPersonality:settings.speechPersonality,selectedVoice:settings.selectedVoice,candidates:settings.candidates,catalog:this.catalogView()},captions,
      usage:{enabled,maximumVoiceSeconds:300,initializationExposureSeconds:15}};
  }
  async request(request:VelaVoiceControlRequest):Promise<VelaVoiceState|GptLiveAudioDevice[]>{
    check(request&&typeof request==='object'&&exact(request,['name','input']),'live_invalid_control');
    const {name,input}=request;
    if(name==='state'){check(exact(input,[]),'live_invalid_control');return this.state();}
    if(name==='refreshVoices'){check(exact(input,[]),'live_invalid_control');await this.refreshVoices();return this.state();}
    check(this.options.media,'live_media_unavailable');
    if(name==='devices'){check(exact(input,[]),'live_invalid_control');return this.options.media.devices();}
    if(name==='mute'){check(exact(input,['muted'])&&typeof input.muted==='boolean','live_invalid_control');await this.options.media.setLocalMute(input.muted);await this.controller.mute(input.muted);}
    else if(name==='setInputDevice'||name==='setOutputDevice'){check(exact(input,['deviceId'])&&id(input.deviceId),'live_invalid_control');await this.options.media[name](input.deviceId);}
    else {check(exact(input,[]),'live_invalid_control');if(name==='stop'){this.pendingStart?.controller.abort();try{await this.controller.stop();}finally{await this.options.media.dispose();}}
      else if(name==='resumePlayback')await this.options.media.resumePlayback();else if(name==='interruptPlayback')await this.options.media.interruptPlayback();else throw new LiveError('live_invalid_control');}
    return this.state();
  }
  authorize(input:Extract<VelaVoiceNativeRequest,{name:'authorize'}>['input']):VoiceAuthorization{
    check(exact(input,['attemptId','operation',...(Object.hasOwn(input??{},'maximumVoiceSeconds')?['maximumVoiceSeconds']:[]),...(Object.hasOwn(input??{},'intent')?['intent']:[])])&&id(input.attemptId)&&['start','reconnect','audition','voice-create','voice-save'].includes(input.operation)&&
      (input.maximumVoiceSeconds===undefined||Number.isSafeInteger(input.maximumVoiceSeconds)&&input.maximumVoiceSeconds>=15&&input.maximumVoiceSeconds<=300)&&
      (input.intent===undefined||typeof input.intent==='string'&&input.intent.length>0&&input.intent.length<=16000),'live_paid_start_review_required');
    const version=this.options.api.configurationVersion();check(version!==null&&this.options.media,'live_media_unavailable');this.allowed(version);
    const ref=randomUUID(),expires=Date.now()+60000;
    this.options.atomic(()=>{
      this.options.db.prepare('DELETE FROM vela_voice_grants WHERE expires_at<?').run(Date.now());
      check(Number(this.options.db.prepare('SELECT count(*) AS n FROM vela_voice_grants').get()!.n)<32,'live_authorization_capacity');
      this.options.db.prepare('INSERT INTO vela_voice_grants VALUES(?,?,?,?,?,0,?,?)').run(ref,input.attemptId,input.operation,version,expires,input.maximumVoiceSeconds??300,input.intent===undefined?null:hash(input.intent));
    });return {authorizationRef:ref,attemptId:input.attemptId,configurationVersion:version,expiresAt:new Date(expires).toISOString()};
  }
  private grant(ref:string){check(id(ref),'live_paid_start_review_required');const row=this.options.db.prepare('SELECT * FROM vela_voice_grants WHERE ref=?').get(ref);check(row,'live_paid_start_review_required');return row;}
  private async authorizeReview(review:LiveNativeReview){
    this.validateWakeAttempt(review.attemptId);
    this.allowed(review.configurationVersion);
    this.options.atomic(()=>{
      const grant=this.grant(review.authorizationRef),first=['start','reconnect','audition','voice-create','voice-save'].includes(review.operation);
      check(grant.configuration_version===review.configurationVersion&&review.configurationId===VELA_API_CONFIGURATION_ID,'live_configuration_changed');
      if(first){check(grant.used===0&&Number(grant.expires_at)>Date.now()&&grant.operation===review.operation&&(review.operation==='voice-save'||grant.attempt_id===review.attemptId),'live_paid_start_review_required');
        if(review.paidSession)check(review.budget?.maximumVoiceSeconds===grant.maximum_seconds&&review.budget.initializationExposureSeconds===15,'live_budget_changed');
        this.options.db.prepare('UPDATE vela_voice_grants SET used=1 WHERE ref=? AND used=0').run(review.authorizationRef);
      }else check(grant.used===1&&grant.attempt_id===review.attemptId&&this.controller.state().sessionId===review.sessionId,'live_session_replaced');
    });
    this.options.host.observe(review.operation,{attemptId:review.attemptId,...(review.sessionId?{sessionId:review.sessionId}:{})});
  }
  async native(request:VelaVoiceNativeRequest):Promise<VelaVoiceState|VoiceAuthorization|PromptVoiceResult>{
    check(request&&exact(request,['name','input']),'live_invalid_control');if(request.name==='authorize')return this.authorize(request.input);
    check(!this.controlBusy&&this.options.media,'live_session_busy');this.controlBusy=true;let startup:AbortController|undefined;
    try{
      const input=request.input,grant=this.grant(input.authorizationRef);this.allowed(Number(grant.configuration_version));
      check(grant.used===0&&Number(grant.expires_at)>Date.now()&&grant.operation===request.name&&grant.attempt_id===input.attemptId,'live_paid_start_review_required');
      if(request.name==='voice-create')return this.controller.createPromptVoice({...request.input,configurationId:VELA_API_CONFIGURATION_ID,configurationVersion:Number(grant.configuration_version)});
      if(request.name==='voice-save'){
        const input=request.input;check(typeof input.speechPersonality==='string'&&Buffer.byteLength(input.speechPersonality)<=2000,'live_invalid_voice_selection');
        const voice=input.voiceId===null?null:this.settings().candidates.find(voice=>voice.id===input.voiceId);check(input.voiceId===null||voice,'live_invalid_voice_selection');
        if(voice)await this.controller.saveVoiceSelection({voice,expectedSettingsVersion:input.expectedSettingsVersion,speechPersonality:input.speechPersonality,authorizationRef:input.authorizationRef});
        else {await this.authorizeReview({operation:'voice-save',attemptId:input.attemptId,configurationId:VELA_API_CONFIGURATION_ID,configurationVersion:Number(grant.configuration_version),authorizationRef:input.authorizationRef,bodyDigest:hash(input),bodyBytes:Buffer.byteLength(JSON.stringify(input)),paidSession:false});this.saveSelection(null,input.expectedSettingsVersion,input.speechPersonality);}
        return this.state();
      }
      check(!['starting','awaiting-start','running','closing'].includes(this.controller.state().state),'live_session_busy');
      const start=request.input;
      check(exact(start,['attemptId','authorizationRef',...['inputDeviceId','outputDeviceId','sample','voiceId','intent'].filter(key=>Object.hasOwn(start,key))])&&
        (start.intent===undefined?grant.intent_digest===null:hash(start.intent)===grant.intent_digest),'live_paid_start_review_required');
      if(start.intent)this.options.host.acceptIntent(start.intent,start.attemptId);
      startup=new AbortController();this.pendingStart={attemptId:start.attemptId,controller:startup};
      const voice=await this.voiceForStart(start.voiceId,startup.signal);this.allowed(Number(grant.configuration_version));
      let prepared;
      try{prepared=await this.options.media.prepare({attemptId:start.attemptId,...(start.inputDeviceId?{inputDeviceId:start.inputDeviceId}:{}),...(start.outputDeviceId?{outputDeviceId:start.outputDeviceId}:{})});}
      catch(error){await this.options.media.dispose().catch(()=>{});throw error;}
      try{
      check(!startup.signal.aborted,'live_operation_aborted');
      const live={attemptId:start.attemptId,authorizationRef:start.authorizationRef,configurationId:VELA_API_CONFIGURATION_ID,configurationVersion:Number(grant.configuration_version),conversationId:this.options.host.conversationId(),sdpOffer:prepared.sdpOffer,
         voice:{id:voice.id,...(voice.type==='prompt'?{description:voice.prompt}:{})},budget:{ref:'voice-budget:'+start.attemptId,maximumVoiceSeconds:Number(grant.maximum_seconds),initializationExposureSeconds:15 as const}};
      if(request.name==='audition'){check(typeof start.sample==='string'&&Buffer.byteLength(start.sample)>0&&Buffer.byteLength(start.sample)<=500,'live_append_capacity');await this.controller.audition(live,start.sample,startup.signal);}
      else if(request.name==='reconnect')await this.controller.reconnect(live,startup.signal);else await this.controller.start(live,startup.signal);
      if(['failed','unknown'].includes(this.controller.state().state))await this.options.media.dispose().catch(()=>{});
      return this.state();
      }catch(error){await this.options.media.dispose().catch(()=>{});throw error;}
    }finally{if(startup&&this.pendingStart?.controller===startup)this.pendingStart=null;this.controlBusy=false;}
  }
  private async receiveFragment(fragment:LiveTranscriptFragment){
    this.allowed(this.controller.state().configurationVersion!);
    this.options.atomic(()=>{
      const prior=this.options.db.prepare('SELECT fingerprint FROM vela_voice_fragments WHERE session_id=? AND event_id=?').get(fragment.sessionId,fragment.eventId),fingerprint=hash(fragment);
      if(prior){check(prior.fingerprint===fingerprint,'live_transcript_duplicate_mismatch');return;}
      const latest=this.options.db.prepare('SELECT role FROM vela_voice_groups WHERE session_id=? ORDER BY rowid DESC LIMIT 1').get(fragment.sessionId);
      if(latest&&latest.role!==fragment.role){
        for(const group of this.options.db.prepare('SELECT message_id FROM vela_voice_groups WHERE session_id=? AND sealed=0').all(fragment.sessionId))this.options.host.seal(String(group.message_id),fragment.sessionId);
        this.options.db.prepare('UPDATE vela_voice_groups SET sealed=1 WHERE session_id=? AND sealed=0').run(fragment.sessionId);
      }
      const group=this.options.db.prepare('SELECT * FROM vela_voice_groups WHERE session_id=? AND role=? AND sealed=0 ORDER BY rowid DESC LIMIT 1').get(fragment.sessionId,fragment.role);
      if(group)check(Number(group.start_ms)<=fragment.startMs&&Number(group.end_ms)<=fragment.endMs,'live_transcript_time_regression');
      const messageId=this.options.host.fragment(fragment,group?String(group.message_id):undefined);
      if(group)this.options.db.prepare('UPDATE vela_voice_groups SET end_ms=? WHERE id=?').run(fragment.endMs,group.id!);
      else this.options.db.prepare('INSERT INTO vela_voice_groups VALUES(?,?,?,?,?,?,0)').run(randomUUID(),fragment.sessionId,fragment.role,messageId,fragment.startMs,fragment.endMs);
      this.options.db.prepare('INSERT INTO vela_voice_fragments VALUES(?,?,?,?)').run(fragment.sessionId,fragment.eventId,fingerprint,messageId);
      this.options.host.observe('transcript',{sessionId:fragment.sessionId,messageId});
    });
  }
  private async claim(binding:LiveDelegationBinding):Promise<'claimed'|'duplicate'|'unknown'>{
    this.allowed(binding.configurationVersion);
    return this.options.atomic(()=>{
      const prior=this.options.db.prepare('SELECT state FROM vela_voice_delegations WHERE session_id=? AND delegation_id=?').get(binding.sessionId,binding.delegationId);
      if(prior)return prior.state==='unknown'?'unknown':'duplicate';
      // A speaker change seals transcript editing; it does not consume the user's intent.
      // Only a durable delegation consumes a group, including one sealed by a backchannel.
      const group=this.options.db.prepare("SELECT g.* FROM vela_voice_groups g WHERE g.session_id=? AND g.role='user' AND g.end_ms<=? AND NOT EXISTS (SELECT 1 FROM vela_voice_delegations d WHERE d.session_id=g.session_id AND d.group_id=g.id) ORDER BY g.end_ms DESC,g.rowid DESC LIMIT 1").get(binding.sessionId,binding.offsetMs);
      if(!group)return 'unknown';
      this.options.db.prepare('INSERT INTO vela_voice_delegations VALUES(?,?,?,\'claimed\',NULL)').run(binding.sessionId,binding.delegationId,group.id!);
      for(const item of this.options.db.prepare('SELECT message_id FROM vela_voice_groups WHERE session_id=? AND sealed=0').all(binding.sessionId))this.options.host.seal(String(item.message_id),binding.sessionId);
      this.options.db.prepare('UPDATE vela_voice_groups SET sealed=1 WHERE session_id=? AND sealed=0').run(binding.sessionId);
      this.options.host.observe('delegation-claimed',{sessionId:binding.sessionId,delegationId:binding.delegationId,messageId:String(group.message_id)});return 'claimed';
    });
  }
  private async delegate(binding:LiveDelegationBinding){
    const row=this.options.db.prepare('SELECT d.state,g.message_id FROM vela_voice_delegations d JOIN vela_voice_groups g ON g.id=d.group_id WHERE d.session_id=? AND d.delegation_id=?').get(binding.sessionId,binding.delegationId);
    check(row?.state==='claimed','live_delegation_unavailable');const message=this.options.host.message(String(row.message_id));check(message?.role==='user'&&message.content.trim(),'live_canonical_intent_unavailable');
    let result:{state:'verified'|'failed'|'unknown';content?:string;receiptRef?:string};
    try{result=await this.options.host.delegate(binding,message.content,message.id);}catch{result={state:'unknown'};}
    this.options.atomic(()=>this.options.db.prepare('UPDATE vela_voice_delegations SET state=?,receipt_ref=? WHERE session_id=? AND delegation_id=?').run(result.state,result.receiptRef??null,binding.sessionId,binding.delegationId));
    this.options.host.observe('delegation-'+result.state,{sessionId:binding.sessionId,delegationId:binding.delegationId});
    return {...result,...(result.content?{content:brief(result.content)}:{})};
  }
  private recordCandidate(voice:SavedPromptVoice){this.allowed(voice.configurationVersion);this.options.atomic(()=>{
    check(Number(this.options.db.prepare('SELECT count(*) AS n FROM vela_voice_candidates').get()!.n)<16,'live_voice_candidate_capacity');
    this.options.db.prepare('INSERT INTO vela_voice_candidates VALUES(?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').run(voice.id,JSON.stringify(voice));});}
  private saveSelection(voice:SavedCustomVoice|null,expected:number,personality:string){this.storage();return this.options.atomic(()=>{
    check(Number.isSafeInteger(expected)&&expected>=0&&typeof personality==='string'&&Buffer.byteLength(personality)<=2000,'live_invalid_voice_selection');
    const row=this.options.db.prepare('SELECT version FROM vela_voice_settings WHERE id=1').get();check(row?.version===expected,'live_voice_settings_changed');
    this.storage();this.options.db.prepare('UPDATE vela_voice_settings SET version=version+1,personality=?,selected_voice=?,selection_policy=1 WHERE id=1 AND version=?').run(personality,voice?JSON.stringify(voice):null,expected);return {settingsVersion:expected+1};});}
  speechPersonality(){return this.settings().speechPersonality;}
  /** Private coordinator port. Standing native opt-in is checked before minting an ordinary one-use grant. */
  async wakeStart(input:{activationId:string;signal:AbortSignal;inputDeviceId?:string;bufferLeaseRef?:string;greeting:'dynamic-in-session'|'none';validate():void}):Promise<{sessionId:string;microphone:'live'|'muted'}>{
    check(!this.controlBusy&&this.options.media&&id(input.activationId),'live_session_busy');input.validate();check(!input.signal.aborted,'live_operation_aborted');
    const attemptId=input.activationId,startup=new AbortController(),signal=AbortSignal.any([input.signal,startup.signal]);this.controlBusy=true;this.wakePreparing=input.activationId;
    this.pendingStart={attemptId,controller:startup};
    this.wakeOwners.set(input.activationId,{attemptId,signal,validate:input.validate});
    while(this.wakeOwners.size>32)this.wakeOwners.delete(this.wakeOwners.keys().next().value!);
    try{
      const grant=this.authorize({attemptId,operation:'start'});
      const voice=await this.voiceForStart(undefined,signal);this.validateWakeAttempt(attemptId);
      const prepared=await this.options.media.prepare({attemptId,...(input.inputDeviceId?{inputDeviceId:input.inputDeviceId}:{}),...(input.bufferLeaseRef?{bufferLeaseRef:input.bufferLeaseRef}:{})});
      this.validateWakeAttempt(attemptId);
      await this.controller.start({attemptId,authorizationRef:grant.authorizationRef,configurationId:VELA_API_CONFIGURATION_ID,configurationVersion:grant.configurationVersion,
         conversationId:this.options.host.conversationId(),sdpOffer:prepared.sdpOffer,voice:{id:voice.id,...(voice.type==='prompt'?{description:voice.prompt}:{})},
        wake:{greeting:input.greeting==='dynamic-in-session'?'dynamic':'none',pronunciation:'VAY-luh'},
        budget:{ref:'voice-budget:'+attemptId,maximumVoiceSeconds:300,initializationExposureSeconds:15}},signal);
      const until=Date.now()+14000;
      while(this.controller.state().attemptId===attemptId&&['starting','awaiting-start'].includes(this.controller.state().state)&&Date.now()<until){this.validateWakeAttempt(attemptId);await new Promise(resolve=>setTimeout(resolve,10));}
      this.validateWakeAttempt(attemptId);const view=this.controller.state(),media=await this.options.media.state();
      check(view.attemptId===attemptId&&view.sessionId&&view.state==='running'&&media.microphoneAccess==='active','live_start_unconfirmed');
      return {sessionId:view.sessionId,microphone:media.localTrackEnabled?'live':'muted'};
    }catch(error){await this.releaseOwned({activationId:input.activationId}).catch(()=>{});throw error;}
    finally{if(this.wakePreparing===input.activationId)this.wakePreparing=null;if(this.pendingStart?.controller===startup)this.pendingStart=null;this.controlBusy=false;}
  }
  private owned(scope:WakeOwnedVoice){const view=this.controller.state();
    if(scope.all)return true;
    if(scope.sessionId&&scope.sessionId!==view.sessionId)return false;
    if(scope.activationId){const owner=this.wakeOwners.get(scope.activationId);return !!owner&&(view.attemptId===owner.attemptId||this.wakePreparing===scope.activationId);}
    return !!scope.sessionId&&scope.sessionId===view.sessionId;
  }
  async quiesceOwned(scope:WakeOwnedVoice){if(!this.owned(scope))return;this.pendingStart?.controller.abort();const view=this.controller.state();
    if(this.options.media?.quiesceCapture&&view.attemptId)await this.options.media.quiesceCapture({attemptId:view.attemptId,...(view.sessionId?{sessionId:view.sessionId}:{})});
    else await this.options.media?.dispose();
  }
  async stopOwned(scope:WakeOwnedVoice):Promise<{closure:'confirmed'|'unknown'}>{
    if(!this.owned(scope))return this.reconcileOwned(scope);
    const view=await this.controller.stop();return {closure:view.state==='idle'||view.state==='closed'&&view.finalization==='confirmed'?'confirmed':'unknown'};
  }
  async releaseOwned(scope:WakeOwnedVoice){if(this.owned(scope))await this.options.media?.dispose();}
  async reconcileOwned(scope:WakeOwnedVoice):Promise<{closure:'confirmed'|'unknown'}>{
    const current=this.controller.state();if((scope.all||this.owned(scope))&&(current.state==='idle'||current.state==='closed'&&current.finalization==='confirmed'))return {closure:'confirmed'};
    const attemptId=scope.activationId?this.wakeOwners.get(scope.activationId)?.attemptId??scope.activationId:undefined;
    const row=attemptId?this.options.db.prepare('SELECT json FROM vela_voice_sessions WHERE attempt_id=?').get(attemptId):null;
    const prior=row?JSON.parse(String(row.json)) as LiveSessionView:null;
    return {closure:prior?.state==='closed'&&prior.finalization==='confirmed'?'confirmed':'unknown'};
  }
  async wakeObservation():Promise<WakeNativeVoiceObservation|null>{const view=this.controller.state();if(!view.sessionId)return null;
    const media=await this.options.media?.state();const owner=[...this.wakeOwners.values()].some(owner=>owner.attemptId===view.attemptId)?'wake':'manual';
    return {owner,sessionId:view.sessionId,connection:view.state==='running'?'active':view.state==='closed'&&view.finalization==='confirmed'?'closed':'unknown',
      microphone:media?.microphoneAccess==='released'||media?.microphoneAccess==='not-requested'?'off':media?.microphoneAccess==='active'?media.localTrackEnabled?'live':'muted':'unknown',
      localSpeechActive:media?.localSpeech==='detected',actualPlaybackActive:media?.playback==='playing'&&media.playbackObserved,
      importantResponseQueued:view.lastAppend==='pending',backendWorking:view.backend==='running'};
  }
  async settled(){await this.controller.settled();}
  async dispose(){if(this.closed)return;this.catalogLifetime.abort();try{await this.controller.dispose();}finally{try{await this.options.media?.dispose().catch(()=>{});}finally{this.closed=true;}}}
}
