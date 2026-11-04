import {randomUUID} from 'node:crypto';
export type DeviceLocation={latitude:number;longitude:number;observedAtMs:number;source:'satellite'|'cellular'|'wifi'};
export type NativeBatteryStatus={acLineStatus:number;batteryFlag:number;batteryLifePercent:number;batteryLifeSeconds:number};
export interface NativeSystemFactsServices {
 authorizeWeatherPurpose():Promise<'allow'|'deny'|'cancel'>;
 locate(input:{requestedAtMs:number}):Promise<DeviceLocation>;
 battery():Promise<NativeBatteryStatus>;
}
export const isSystemFactsEnvelope=(value:unknown):value is {systemHost:unknown}=>!!value&&typeof value==='object'&&Object.hasOwn(value,'systemHost');
const record=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:Record<string,any>,keys:string[])=>Object.keys(v).sort().join('|')===keys.sort().join('|');
const operations=['weather-consent','locate','battery'];
const id=(v:unknown)=>typeof v==='string'&&/^[a-f0-9-]{36}$/u.test(v);
export function validateSystemFactsRequest(v:unknown):v is {systemHost:{version:1;kind:'request';id:string;operation:string;input:any}}{
 if(!record(v)||!exact(v,['systemHost'])||!record(v.systemHost))return false;const h=v.systemHost;
 return exact(h,['version','kind','id','operation','input'])&&h.version===1&&h.kind==='request'&&id(h.id)&&operations.includes(h.operation)&&record(h.input)&&
 (h.operation==='locate'?exact(h.input,['requestedAtMs'])&&Number.isSafeInteger(h.input.requestedAtMs)&&h.input.requestedAtMs>0:exact(h.input,[]));
}
export function validSystemFactsResult(operation:string,result:unknown):boolean{
 if(operation==='weather-consent')return ['allow','deny','cancel'].includes(String(result));
 if(!record(result))return false;
 if(operation==='locate')return exact(result,['latitude','longitude','observedAtMs','source'])&&Number.isFinite(result.latitude)&&Math.abs(result.latitude)<=90&&Number.isFinite(result.longitude)&&Math.abs(result.longitude)<=180&&Number.isFinite(result.observedAtMs)&&['satellite','cellular','wifi'].includes(result.source);
 return operation==='battery'&&exact(result,['acLineStatus','batteryFlag','batteryLifePercent','batteryLifeSeconds'])&&[0,1,255].includes(result.acLineStatus)&&Number.isInteger(result.batteryFlag)&&result.batteryFlag>=0&&result.batteryFlag<=255&&Number.isInteger(result.batteryLifePercent)&&(result.batteryLifePercent<=100||result.batteryLifePercent===255)&&result.batteryLifePercent>=0&&Number.isInteger(result.batteryLifeSeconds)&&result.batteryLifeSeconds>=0&&result.batteryLifeSeconds<=0xffffffff;
}
const safeError=(v:unknown)=>typeof v==='string'&&/^location_[a-z_]{1,60}$/u.test(v)?v:'location_native_unavailable';
/** Private transport only. Coordinates never enter generic RPC events or renderer state. */
export function createSystemFactsClient(send:(message:any)=>void){
 const pending=new Map<string,{operation:string;resolve:(v:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();let closed=false;
 const call=(operation:string,input={})=>new Promise<any>((resolve,reject)=>{if(closed||pending.size>=4){reject(Error('location_native_unavailable'));return;}const requestId=randomUUID();const timer=setTimeout(()=>{pending.delete(requestId);reject(Error('location_native_timeout'));},45000);pending.set(requestId,{operation,resolve,reject,timer});try{send({systemHost:{version:1,kind:'request',id:requestId,operation,input}});}catch{clearTimeout(timer);pending.delete(requestId);reject(Error('location_native_unavailable'));}});
 return {services:{authorizeWeatherPurpose:()=>call('weather-consent'),locate:input=>call('locate',input),battery:()=>call('battery')} as NativeSystemFactsServices,
 handle(value:unknown){if(!isSystemFactsEnvelope(value))return false;if(!record(value)||!exact(value,['systemHost'])||!record(value.systemHost))return true;const h=value.systemHost,p=pending.get(h.id);if(!p)return true;
 if(h.version!==1||h.kind!=='response'||h.operation!==p.operation||!(exact(h,['version','kind','id','operation','result'])&&validSystemFactsResult(h.operation,h.result)||exact(h,['version','kind','id','operation','error'])&&typeof h.error==='string'))return true;
 clearTimeout(p.timer);pending.delete(h.id);h.error?p.reject(Error(safeError(h.error))):p.resolve(h.result);return true;},
 close(){closed=true;for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('location_native_unavailable'));}pending.clear();}};
}
export function createSystemFactsServer(services:NativeSystemFactsServices|undefined,send:(message:any)=>void){let closed=false,inFlight=0;return{
 handle(value:unknown){if(!isSystemFactsEnvelope(value))return false;if(!validateSystemFactsRequest(value)||closed)return true;const h=value.systemHost;const reply=(body:any)=>{if(!closed)send({systemHost:{version:1,kind:'response',id:h.id,operation:h.operation,...body}});};
 if(!services||inFlight>=4){reply({error:'location_native_unavailable'});return true;}inFlight++;void Promise.resolve().then(async():Promise<unknown>=>h.operation==='weather-consent'?services.authorizeWeatherPurpose():h.operation==='locate'?services.locate(h.input):services.battery()).then(result=>{if(!validSystemFactsResult(h.operation,result))throw Error('location_native_protocol');reply({result});}).catch(error=>reply({error:safeError(error instanceof Error?error.message:null)})).finally(()=>inFlight--);return true;},close(){closed=true;}};}
