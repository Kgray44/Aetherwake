import {randomUUID} from 'node:crypto';
import type {WindowsComputerDiscovery,WindowsComputerObservation} from '../../application-contract/windows-computer.ts';
import {computerObject,computerExact,validWindowsComputerResult as validResult,validWindowsComputerScope} from './windows-computer-validation.mts';
export {WINDOWS_COMPUTER_ACTION_SCHEMA,validWindowsComputerAction,validWindowsComputerReceipt,validWindowsComputerReviewBinding} from './windows-computer-validation.mts';
export interface WindowsComputerReadScope {requestId:string;workflowId:string;scopeDigest:string}
export interface NativeWindowsComputerServices {
  discover(input:WindowsComputerReadScope,signal?:AbortSignal):Promise<WindowsComputerDiscovery>;
  observe(input:WindowsComputerReadScope&{windowRef:string},signal?:AbortSignal):Promise<WindowsComputerObservation>;
}
const object=computerObject;
const exact=computerExact;
const id=(v:unknown)=>typeof v==='string'&&/^[a-z0-9][a-z0-9_.:-]{0,127}$/iu.test(v);
const scope=validWindowsComputerScope;
export const validWindowsComputerResult=validResult;
const errors=new Set(['computer_native_unavailable','computer_native_protocol','computer_scope_required','computer_scope_expired','computer_scope_changed','computer_capacity','computer_cancelled','computer_timeout','computer_protocol','computer_permission_revoked','computer_reference_expired','computer_target_ineligible','computer_identity_changed','computer_secure_desktop','computer_admin_denied','computer_password_control','computer_control_stale','computer_pattern_unavailable','computer_geometry_invalid','computer_launch_source_changed','computer_launch_unavailable']);
const safeError=(value:unknown)=>typeof value==='string'&&errors.has(value)?value:'computer_native_unavailable';
export const isWindowsComputerEnvelope=(v:unknown):v is {computerHost:unknown}=>object(v)&&Object.hasOwn(v,'computerHost');
export function createWindowsComputerClient(send:(v:unknown)=>void,options:{timeoutMs?:number}={}){
  let closed=false;const pending=new Map<string,{operation:string;windowRef?:string;resolve(v:any):void;reject(e:Error):void;cleanup():void}>();
  const call=(operation:string,input:unknown,signal?:AbortSignal)=>new Promise<any>((resolve,reject)=>{
    if(closed||pending.size>=4||!scope(input,operation==='observe')){reject(Error(pending.size>=4?'computer_capacity':'computer_native_unavailable'));return;}
    const requestId=randomUUID(),cancel=(code='computer_cancelled')=>{const p=pending.get(requestId);if(p){pending.delete(requestId);p.cleanup();try{send({computerHost:{version:1,kind:'cancel',id:requestId}});}catch{}reject(Error(code));}},abort=()=>cancel(),timer=setTimeout(()=>cancel('computer_timeout'),Math.min(15000,Math.max(5,options.timeoutMs??15000)));
    const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};pending.set(requestId,{operation,...(operation==='observe'?{windowRef:(input as WindowsComputerReadScope&{windowRef:string}).windowRef}:{}),resolve,reject,cleanup});signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted){abort();return;}try{send({computerHost:{version:1,kind:'request',id:requestId,operation,input}});}catch{pending.delete(requestId);cleanup();reject(Error('computer_native_unavailable'));}
  });
  return {services:{discover:(input,signal)=>call('discover',input,signal),observe:(input,signal)=>call('observe',input,signal)} as NativeWindowsComputerServices,
    handle(v:unknown){if(!isWindowsComputerEnvelope(v))return false;if(!exact(v,['computerHost'])||!object(v.computerHost))return true;const h=v.computerHost,p=pending.get(h.id);if(!p)return true;if(h.version!==1||h.kind!=='response'||h.operation!==p.operation||!(exact(h,['version','kind','id','operation','result'])&&validWindowsComputerResult(h.operation,h.result)&&(h.operation!=='observe'||h.result.windowRef===p.windowRef)||exact(h,['version','kind','id','operation','error'])&&typeof h.error==='string'))return true;pending.delete(h.id);p.cleanup();Object.hasOwn(h,'error')?p.reject(Error(safeError(h.error))):p.resolve(h.result);return true;},
    close(){if(closed)return;closed=true;for(const [id,p]of pending){p.cleanup();try{send({computerHost:{version:1,kind:'cancel',id}});}catch{}p.reject(Error('computer_native_unavailable'));}pending.clear();}};
}
export function createWindowsComputerServer(services:NativeWindowsComputerServices|undefined,send:(v:unknown)=>void){let closed=false;const pending=new Map<string,AbortController>(),seen=new Set<string>();return{
  handle(v:unknown){if(!isWindowsComputerEnvelope(v))return false;if(closed||!exact(v,['computerHost'])||!object(v.computerHost))return true;const h=v.computerHost;if(exact(h,['version','kind','id'])&&h.version===1&&h.kind==='cancel'&&id(h.id)){pending.get(h.id)?.abort();return true;}if(!exact(h,['version','kind','id','operation','input'])||h.version!==1||h.kind!=='request'||!id(h.id)||!['discover','observe'].includes(h.operation)||!scope(h.input,h.operation==='observe'))return true;
    const reply=(body:unknown)=>{if(!closed)send({computerHost:{version:1,kind:'response',id:h.id,operation:h.operation,...body as object}});};if(!services||pending.size>=4||seen.has(h.id)){reply({error:pending.size>=4||seen.has(h.id)?'computer_capacity':'computer_native_unavailable'});return true;}if(seen.size>=256)seen.delete(seen.values().next().value!);seen.add(h.id);const controller=new AbortController();pending.set(h.id,controller);void Promise.resolve().then(async()=>h.operation==='discover'?await services.discover(h.input,controller.signal):await services.observe(h.input,controller.signal)).then(result=>{if(controller.signal.aborted)throw Error('computer_cancelled');if(!validWindowsComputerResult(h.operation,result)||h.operation==='observe'&&(result as WindowsComputerObservation).windowRef!==h.input.windowRef)throw Error('computer_protocol');reply({result});}).catch(error=>reply({error:safeError(error?.message)})).finally(()=>pending.delete(h.id));return true;},close(){closed=true;for(const controller of pending.values())controller.abort();pending.clear();}};}
