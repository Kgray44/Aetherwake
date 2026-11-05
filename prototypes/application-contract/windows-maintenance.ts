/** Native Windows observations. Opaque references confer neither selection nor mutation authority. */
export const WINDOWS_MEMORY_POLICY='windows-memory-pressure/v1' as const;
export interface WindowsMemorySnapshot {
  contract:'aerynth.windows.memory@1';snapshotId:string;observedAt:string;sampleDurationMs:number;
  physicalTotalBytes:number;physicalAvailableBytes:number;systemCommitBytes:number;
  systemCommitLimitBytes:number;systemCommitHeadroomBytes:number;systemCacheBytes:number;
  lowMemoryNotification:boolean|null;
  pressure:'healthy'|'pressured'|'unknown';policyVersion:typeof WINDOWS_MEMORY_POLICY;
  source:'windows-native';
}
/** Model-safe inspection: names, PIDs, paths, SID and HANDLE never enter this DTO. */
export interface WindowsProcessInspection {
  contract:'aerynth.windows.processes@1';snapshotId:string;observedAt:string;
  scanned:number;unavailable:number;partial:boolean;
  processes:{ref:string;workingSetBytes:number;privateCommitBytes:number;eligibility:'native-selection-required'|'ineligible'|'unknown';cpu?:{percent:number;sampleMs:number;logicalProcessors:number}|null}[];
}
/** Private Core -> Main binding. Core owns canonical pending operation/version and consumption. */
export interface WindowsMaintenanceReviewBinding {
  contract:'aerynth.windows.maintenance-review@1';operationId:string;expectedVersion:number;
  requestId:string;workflowId:string;snapshotId:string;scopeDigest:string;operationDigest:string;
  policyVersion:typeof WINDOWS_MEMORY_POLICY;
}
export interface WindowsMaintenanceDispatchRequest {binding:WindowsMaintenanceReviewBinding;identityDigest:string;approvalDigest:string}
export interface WindowsMaintenanceDispatchClaim {operationId:string;operationDigest:string;claimId:string;identityDigest:string;approvalDigest:string}
export type WindowsMaintenanceReason='memory-healthy'|'pressure-unknown'|'no-eligible-process'|'user-declined'|'idle-not-attested'|
  'target-busy'|'identity-changed'|'permission-revoked'|'review-expired'|'native-failure'|
  'measurement-unavailable'|'working-set-reduced'|'no-measured-benefit'|'cancelled';
export interface WindowsReclaimReceipt {
  contract:'aerynth.windows.reclaim-receipt@1';id:string;operationId:string;operationDigest:string;
  snapshotId:string;
  claimId:string|null;approvalDigest:string|null;
  observedAt:string;state:'observed'|'no-op'|'denied'|'unavailable'|'unknown';reason:WindowsMaintenanceReason;
  targetCount:0|1;identityDigest:string|null;nativeCallSucceeded:boolean|null;
  before:WindowsMemorySnapshot;after:WindowsMemorySnapshot|null;
  workingSetBeforeBytes:number|null;workingSetAfterBytes:number|null;
  privateCommitBeforeBytes:number|null;privateCommitAfterBytes:number|null;
  workingSetReductionBytes:number|null;physicalAvailableDeltaBytes:number|null;
  verificationSource:'windows-native';
}
export interface WindowsMaintenanceNativeResult {binding:WindowsMaintenanceReviewBinding;receipt:WindowsReclaimReceipt}

export const WINDOWS_MAINTENANCE_ERRORS=Object.freeze(['memory_native_unavailable','memory_native_protocol','memory_native_capacity','memory_native_timeout','memory_cancelled','memory_snapshot_expired','memory_review_required','memory_target_ineligible','memory_identity_changed','memory_permission_revoked','memory_review_expired','memory_native_busy','memory_measurement_unavailable','memory_foreground_required'] as const);
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype&&Object.values(Object.getOwnPropertyDescriptors(v)).every(d=>'value'in d);
const exact=(v:Record<string,any>,names:string[])=>Object.keys(v).sort().join('|')===[...names].sort().join('|');
const integer=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(v);
const opaque=(v:unknown)=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/u.test(v);
const digest=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/u.test(v);
const timestamp=(v:unknown)=>typeof v==='string'&&v.length<=40&&Number.isFinite(Date.parse(v));
/** Product heuristic v1, not a Windows guarantee: observation never authorizes mutation. */
export function windowsMemoryPressure(v:Pick<WindowsMemorySnapshot,'physicalTotalBytes'|'physicalAvailableBytes'|'systemCommitLimitBytes'|'systemCommitHeadroomBytes'|'lowMemoryNotification'>):WindowsMemorySnapshot['pressure']{
 const physicalLow=v.physicalAvailableBytes<Math.max(2**30,v.physicalTotalBytes*.05),commitLow=v.systemCommitHeadroomBytes<Math.max(2**30,v.systemCommitLimitBytes*.05);
 return v.lowMemoryNotification===true||physicalLow||commitLow?'pressured':v.lowMemoryNotification===false?'healthy':'unknown';
}
function bounded(value:unknown){try{const visit=(v:unknown,depth:number):boolean=>depth<8&&(v===null||typeof v==='boolean'||typeof v==='string'&&v.length<=512||typeof v==='number'&&Number.isFinite(v)||Array.isArray(v)&&v.length<=16&&v.every(i=>visit(i,depth+1))||object(v)&&Object.values(v).every(i=>visit(i,depth+1)));return visit(value,0)&&new TextEncoder().encode(JSON.stringify(value)).length<=8192;}catch{return false;}}
export function validWindowsMemorySnapshot(v:unknown):v is WindowsMemorySnapshot{
 if(!bounded(v)||!object(v)||!exact(v,['contract','snapshotId','observedAt','sampleDurationMs','physicalTotalBytes','physicalAvailableBytes','systemCommitBytes','systemCommitLimitBytes','systemCommitHeadroomBytes','systemCacheBytes','lowMemoryNotification','pressure','policyVersion','source']))return false;
 return v.contract==='aerynth.windows.memory@1'&&uuid(v.snapshotId)&&timestamp(v.observedAt)&&typeof v.sampleDurationMs==='number'&&v.sampleDurationMs>=0&&v.sampleDurationMs<=5000&&
 ['physicalTotalBytes','physicalAvailableBytes','systemCommitBytes','systemCommitLimitBytes','systemCommitHeadroomBytes','systemCacheBytes'].every(k=>integer(v[k]))&&v.physicalTotalBytes>0&&v.systemCommitLimitBytes>0&&v.physicalAvailableBytes<=v.physicalTotalBytes&&v.systemCommitBytes<=v.systemCommitLimitBytes&&v.systemCommitHeadroomBytes===v.systemCommitLimitBytes-v.systemCommitBytes&&(v.lowMemoryNotification===null||typeof v.lowMemoryNotification==='boolean')&&v.pressure===windowsMemoryPressure(v as unknown as WindowsMemorySnapshot)&&v.policyVersion===WINDOWS_MEMORY_POLICY&&v.source==='windows-native';
}
export function validWindowsProcessInspection(v:unknown):v is WindowsProcessInspection{
 return bounded(v)&&object(v)&&exact(v,['contract','snapshotId','observedAt','scanned','unavailable','partial','processes'])&&v.contract==='aerynth.windows.processes@1'&&uuid(v.snapshotId)&&timestamp(v.observedAt)&&integer(v.scanned)&&v.scanned<=1024&&integer(v.unavailable)&&v.unavailable<=v.scanned&&typeof v.partial==='boolean'&&Array.isArray(v.processes)&&v.processes.length<=16&&new Set(v.processes.map((p:any)=>p?.ref)).size===v.processes.length&&v.processes.every((p:unknown)=>object(p)&&exact(p,['ref','workingSetBytes','privateCommitBytes','eligibility',...(Object.hasOwn(p,'cpu')?['cpu']:[])])&&uuid(p.ref)&&integer(p.workingSetBytes)&&integer(p.privateCommitBytes)&&['native-selection-required','ineligible','unknown'].includes(p.eligibility)&&(p.cpu===undefined||p.cpu===null||object(p.cpu)&&exact(p.cpu,['percent','sampleMs','logicalProcessors'])&&typeof p.cpu.percent==='number'&&Number.isFinite(p.cpu.percent)&&p.cpu.percent>=0&&p.cpu.percent<=100&&integer(p.cpu.sampleMs)&&p.cpu.sampleMs>=200&&p.cpu.sampleMs<=5000&&integer(p.cpu.logicalProcessors)&&p.cpu.logicalProcessors>=1&&p.cpu.logicalProcessors<=4096));
}
export function validWindowsMaintenanceReviewBinding(v:unknown):v is WindowsMaintenanceReviewBinding{
 return bounded(v)&&object(v)&&exact(v,['contract','operationId','expectedVersion','requestId','workflowId','snapshotId','scopeDigest','operationDigest','policyVersion'])&&v.contract==='aerynth.windows.maintenance-review@1'&&[v.operationId,v.requestId,v.workflowId].every(opaque)&&integer(v.expectedVersion)&&v.expectedVersion>=1&&uuid(v.snapshotId)&&digest(v.scopeDigest)&&digest(v.operationDigest)&&v.policyVersion===WINDOWS_MEMORY_POLICY;
}
export function validWindowsReclaimReceipt(v:unknown):v is WindowsReclaimReceipt{
 if(!bounded(v)||!object(v)||!exact(v,['contract','id','operationId','operationDigest','snapshotId','claimId','approvalDigest','observedAt','state','reason','targetCount','identityDigest','nativeCallSucceeded','before','after','workingSetBeforeBytes','workingSetAfterBytes','privateCommitBeforeBytes','privateCommitAfterBytes','workingSetReductionBytes','physicalAvailableDeltaBytes','verificationSource']))return false;
 if(v.contract!=='aerynth.windows.reclaim-receipt@1'||!uuid(v.id)||!opaque(v.operationId)||!digest(v.operationDigest)||!uuid(v.snapshotId)||!timestamp(v.observedAt)||!['observed','no-op','denied','unavailable','unknown'].includes(v.state)||!['memory-healthy','pressure-unknown','no-eligible-process','user-declined','idle-not-attested','target-busy','identity-changed','permission-revoked','review-expired','native-failure','measurement-unavailable','working-set-reduced','no-measured-benefit','cancelled'].includes(v.reason)||![0,1].includes(v.targetCount)||(v.identityDigest!==null&&!digest(v.identityDigest))||(v.nativeCallSucceeded!==null&&typeof v.nativeCallSucceeded!=='boolean')||!validWindowsMemorySnapshot(v.before)||(v.after!==null&&!validWindowsMemorySnapshot(v.after))||v.verificationSource!=='windows-native')return false;
 if(!['workingSetBeforeBytes','workingSetAfterBytes','privateCommitBeforeBytes','privateCommitAfterBytes','workingSetReductionBytes'].every(k=>v[k]===null||integer(v[k]))||(v.physicalAvailableDeltaBytes!==null&&!Number.isSafeInteger(v.physicalAvailableDeltaBytes)))return false;
 if(v.workingSetReductionBytes!==null&&(v.workingSetBeforeBytes===null||v.workingSetAfterBytes===null||v.workingSetReductionBytes!==Math.max(0,v.workingSetBeforeBytes-v.workingSetAfterBytes)))return false;
 if(v.physicalAvailableDeltaBytes!==null&&(!v.after||v.physicalAvailableDeltaBytes!==v.after.physicalAvailableBytes-v.before.physicalAvailableBytes))return false;
 if(v.state==='observed'&&(v.reason!=='working-set-reduced'||v.targetCount!==1||v.nativeCallSucceeded!==true||!v.after||!v.identityDigest||!(v.workingSetReductionBytes>0)))return false;
 if(v.targetCount===0&&(v.identityDigest!==null||v.nativeCallSucceeded!==null||v.workingSetReductionBytes!==null))return false;
 if(v.claimId===null?(v.approvalDigest!==null||v.targetCount!==0):!opaque(v.claimId)||!digest(v.approvalDigest)||!digest(v.identityDigest)||v.targetCount!==1)return false;
 if(v.nativeCallSucceeded!==null&&v.claimId===null)return false;
 return true;
}
export function validWindowsMaintenanceNativeResult(v:unknown):v is WindowsMaintenanceNativeResult{
 return object(v)&&exact(v,['binding','receipt'])&&validWindowsMaintenanceReviewBinding(v.binding)&&validWindowsReclaimReceipt(v.receipt)&&v.binding.operationId===v.receipt.operationId&&v.binding.operationDigest===v.receipt.operationDigest&&v.binding.snapshotId===v.receipt.snapshotId;
}
export function validWindowsMaintenanceDispatchRequest(v:unknown):v is WindowsMaintenanceDispatchRequest{return bounded(v)&&object(v)&&exact(v,['binding','identityDigest','approvalDigest'])&&validWindowsMaintenanceReviewBinding(v.binding)&&digest(v.identityDigest)&&digest(v.approvalDigest);}
export function validWindowsMaintenanceDispatchClaim(v:unknown):v is WindowsMaintenanceDispatchClaim{return bounded(v)&&object(v)&&exact(v,['operationId','operationDigest','claimId','identityDigest','approvalDigest'])&&opaque(v.operationId)&&digest(v.operationDigest)&&opaque(v.claimId)&&digest(v.identityDigest)&&digest(v.approvalDigest);}
