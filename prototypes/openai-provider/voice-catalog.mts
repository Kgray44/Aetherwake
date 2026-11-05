import type {NativeCredential} from './contracts.mts';
import type {SavedCustomVoice} from './live-contracts.mts';
import {abortable,boundedJSON,text} from './common.mts';

export const REQUESTED_VOICE_NAMES=['Vela 2','Vela 3'] as const;
export const VOICE_CATALOG_ENDPOINT='https://api.openai.com/v1/audio/voices';
export class VoiceCatalogError extends Error {readonly code:string;constructor(code:string){super(code);this.code=code;}}
const check:(condition:unknown,code:string)=>asserts condition=(condition,code)=>{if(!condition)throw new VoiceCatalogError(code);};
export interface SavedVoiceCatalog {
 contract:'aerynth.saved-voice-catalog@1';providerId:'openai-api-vela';configurationId:string;configurationVersion:number;
 boundaryDigest:string;project:string|null;organization:string|null;observedAt:number;expiresAt:number;voices:SavedCustomVoice[];
}
/** Read-only provider observation; unrelated names and metadata are discarded. */
export async function readSavedVoiceCatalog(input:{configurationId:string;configurationVersion:number;signal:AbortSignal;
 resolveCredential():Promise<NativeCredential>;revalidate(boundaryDigest:string):Promise<void>;fetch?:typeof fetch;now?:()=>number}):Promise<SavedVoiceCatalog>{
 const signal=AbortSignal.any([input.signal,AbortSignal.timeout(15000)]),now=input.now??Date.now;
 check(text(input.configurationId)&&Number.isSafeInteger(input.configurationVersion)&&input.configurationVersion>0,'live_voice_catalog_credential');
 const credential=await abortable(input.resolveCredential(),signal);
 check(credential.providerId==='openai-api-vela'&&credential.kind==='openai-api-key'&&text(credential.bearer,65536)&&/^[a-f0-9]{64}$/u.test(credential.boundaryDigest)&&(credential.expiresAt===undefined||credential.expiresAt>now()),'live_voice_catalog_credential');
 const headers:Record<string,string>={Authorization:'Bearer '+credential.bearer,Accept:'application/json'};
 for(const [name,value]of [['OpenAI-Project',credential.project],['OpenAI-Organization',credential.organization]] as const)if(value!==undefined){check(text(value),'live_voice_catalog_credential');headers[name]=value;}
 await abortable(input.revalidate(credential.boundaryDigest),signal);
 let response:Response;try{response=await abortable((input.fetch??fetch)(VOICE_CATALOG_ENDPOINT,{method:'GET',headers,signal,redirect:'error',credentials:'omit',cache:'no-store'}),signal);}catch{throw new VoiceCatalogError('live_voice_catalog_unavailable');}
 if(!response.ok){void response.body?.cancel().catch(()=>{});throw new VoiceCatalogError(response.status===403||response.status===404?'live_voice_catalog_access_unavailable':'live_voice_catalog_unavailable');}
 let value:unknown;try{value=await boundedJSON(response,524288,signal);}catch{throw new VoiceCatalogError('live_voice_catalog_invalid');}
 check(value&&typeof value==='object'&&!Array.isArray(value),'live_voice_catalog_invalid');const data=value as Record<string,unknown>;
 check(Array.isArray(data.data)&&data.data.length<=200&&data.has_more!==true,'live_voice_catalog_incomplete');
 const voices:SavedCustomVoice[]=[],ids=new Set<string>(),names=new Set<string>();
 for(const item of data.data){
  if(!item||typeof item!=='object'||Array.isArray(item))continue;const row=item as Record<string,unknown>;
  if(!REQUESTED_VOICE_NAMES.includes(row.name as typeof REQUESTED_VOICE_NAMES[number]))continue;
  check(typeof row.id==='string'&&/^[A-Za-z0-9_-]{1,256}$/u.test(row.id)&&!row.id.includes(credential.bearer)&&!ids.has(row.id)&&!names.has(String(row.name)),'live_voice_catalog_ambiguous');ids.add(row.id);names.add(String(row.name));
  const base={configurationId:input.configurationId,configurationVersion:input.configurationVersion,id:row.id,name:String(row.name)},createdAt=Number.isSafeInteger(row.created_at)&&Number(row.created_at)>=0?Number(row.created_at):null;
  if(row.type==='prompt'&&typeof row.prompt==='string'&&row.prompt.trim().length>0&&Buffer.byteLength(row.prompt)<=4000&&createdAt!==null){check(!row.prompt.includes(credential.bearer),'live_voice_catalog_invalid');voices.push({...base,type:'prompt',prompt:row.prompt,createdAt});}
  else voices.push({...base,type:'existing',createdAt,sourceType:row.type==='prompt'||row.type==='audio_sample'?row.type:'unknown'});
 }
 await abortable(input.revalidate(credential.boundaryDigest),signal);signal.throwIfAborted();const observedAt=now();
 return{contract:'aerynth.saved-voice-catalog@1',providerId:'openai-api-vela',configurationId:input.configurationId,configurationVersion:input.configurationVersion,boundaryDigest:credential.boundaryDigest,project:credential.project??null,organization:credential.organization??null,observedAt,expiresAt:observedAt+300000,voices};
}
