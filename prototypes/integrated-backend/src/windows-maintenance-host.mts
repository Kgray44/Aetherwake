import {randomUUID} from 'node:crypto';
import {WINDOWS_MAINTENANCE_ERRORS,validWindowsMemorySnapshot,validWindowsProcessInspection,type WindowsMemorySnapshot,type WindowsProcessInspection} from '../../application-contract/windows-maintenance.ts';
/** Runtime-local native services. There is intentionally no model/worker apply operation. */
export interface NativeHostMaintenanceServices {
  diagnose(input:Record<string,never>,signal?:AbortSignal):Promise<WindowsMemorySnapshot>;
  inspect(input:{snapshotId:string;limit:number},signal?:AbortSignal):Promise<WindowsProcessInspection>;
}
export const isWindowsMaintenanceEnvelope=(value:unknown):value is {memoryHost:unknown}=>!!value&&typeof value==='object'&&Object.hasOwn(value,'memoryHost');
const record=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype&&Object.values(Object.getOwnPropertyDescriptors(v)).every(d=>'value'in d);
const exact=(v:Record<string,any>,keys:string[])=>Object.keys(v).sort().join('|')===[...keys].sort().join('|');
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(v);
const allowedError=(v:unknown)=>typeof v==='string'&&(WINDOWS_MAINTENANCE_ERRORS as readonly string[]).includes(v)?v:'memory_native_unavailable';
const operationInput=(operation:unknown,input:unknown)=>record(input)&&(operation==='diagnose'?exact(input,[]):operation==='inspect'&&exact(input,['snapshotId','limit'])&&uuid(input.snapshotId)&&Number.isSafeInteger(input.limit)&&input.limit>=1&&input.limit<=16);
const resultValid=(operation:string,result:unknown)=>operation==='diagnose'?validWindowsMemorySnapshot(result):operation==='inspect'&&validWindowsProcessInspection(result);
export function validWindowsMaintenanceRequest(value:unknown):boolean{
 if(!record(value)||!exact(value,['memoryHost'])||!record(value.memoryHost))return false;const h=value.memoryHost;
 return h.version===1&&uuid(h.id)&&(h.kind==='cancel'?exact(h,['version','kind','id']):h.kind==='request'&&exact(h,['version','kind','id','operation','input'])&&operationInput(h.operation,h.input));
}
export function createWindowsMaintenanceClient(send:(message:unknown)=>void):{services:NativeHostMaintenanceServices;handle(value:unknown):boolean;close():void}{
 const pending=new Map<string,{operation:string;input:any;finish:(error:Error|null,value?:unknown)=>void}>();let closed=false;
 const call=(operation:string,input:any,signal?:AbortSignal)=>new Promise<any>((resolve,reject)=>{
  if(closed||pending.size>=2||!operationInput(operation,input)){reject(Error(closed?'memory_native_unavailable':'memory_native_capacity'));return;}if(signal?.aborted){reject(Error('memory_cancelled'));return;}
  const id=randomUUID();let timer:ReturnType<typeof setTimeout>;const finish=(error:Error|null,value?:unknown)=>{if(!pending.delete(id))return;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(value);};
  const abort=()=>{try{send({memoryHost:{version:1,kind:'cancel',id}});}catch{}finish(Error('memory_cancelled'));};
  pending.set(id,{operation,input,finish});timer=setTimeout(()=>{try{send({memoryHost:{version:1,kind:'cancel',id}});}catch{}finish(Error('memory_native_timeout'));},5000);signal?.addEventListener('abort',abort,{once:true});
  try{send({memoryHost:{version:1,kind:'request',id,operation,input}});}catch{finish(Error('memory_native_unavailable'));}
 });
 return {services:{diagnose:(input,signal)=>call('diagnose',input,signal),inspect:(input,signal)=>call('inspect',input,signal)},
  handle(value){if(!isWindowsMaintenanceEnvelope(value))return false;if(!record(value)||!exact(value,['memoryHost'])||!record(value.memoryHost))return true;const h=value.memoryHost,p=pending.get(h.id);if(!p)return true;
   if(h.version!==1||h.kind!=='response'||h.operation!==p.operation)return true;
   if(exact(h,['version','kind','id','operation','error'])&&typeof h.error==='string'){p.finish(Error(allowedError(h.error)));return true;}
   if(!exact(h,['version','kind','id','operation','result'])||!resultValid(p.operation,h.result)||p.operation==='inspect'&&h.result.snapshotId!==p.input.snapshotId){p.finish(Error('memory_native_protocol'));return true;}
   p.finish(null,h.result);return true;},
  close(){closed=true;for(const [id,p]of pending){try{send({memoryHost:{version:1,kind:'cancel',id}});}catch{}p.finish(Error('memory_native_unavailable'));}}
 };
}
export function createWindowsMaintenanceServer(services:NativeHostMaintenanceServices|undefined,send:(message:unknown)=>void){
 const pending=new Map<string,{controller:AbortController;timer:ReturnType<typeof setTimeout>}>(),seen=new Set<string>();let closed=false;
 return {handle(value:unknown){if(!isWindowsMaintenanceEnvelope(value))return false;if(closed||!validWindowsMaintenanceRequest(value))return true;const h=(value as {memoryHost:any}).memoryHost;
  if(h.kind==='cancel'){pending.get(h.id)?.controller.abort();return true;}
  const reply=(body:any)=>{if(!closed)send({memoryHost:{version:1,kind:'response',id:h.id,operation:h.operation,...body}});};
  if(!services||seen.has(h.id)||pending.size>=2){reply({error:services?'memory_native_capacity':'memory_native_unavailable'});return true;}if(seen.size>=256)seen.delete(seen.values().next().value!);seen.add(h.id);
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),4000);pending.set(h.id,{controller,timer});
  void Promise.resolve().then(async():Promise<unknown>=>h.operation==='diagnose'?services.diagnose(h.input,controller.signal):services.inspect(h.input,controller.signal)).then(result=>{if(controller.signal.aborted)throw Error('memory_cancelled');if(!resultValid(h.operation,result)||h.operation==='inspect'&&(result as WindowsProcessInspection).snapshotId!==h.input.snapshotId)throw Error('memory_native_protocol');reply({result});}).catch(error=>reply({error:allowedError(error instanceof Error?error.message:null)})).finally(()=>{clearTimeout(timer);pending.delete(h.id);});return true;},
  close(){closed=true;for(const {controller,timer} of pending.values()){clearTimeout(timer);controller.abort();}pending.clear();}
 };
}
