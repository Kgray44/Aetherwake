import type {WindowsMaintenanceReviewBinding,WindowsReclaimReceipt} from './windows-maintenance.ts';
import type {WindowsComputerReviewBinding,WindowsComputerReceipt} from './windows-computer.ts';
type OwnerBindingBase={
  contract:'aerynth.vela.owner-review@1';operationId:string;expectedVersion:number;
  requestId:string;workflowId:string;scopeDigest:string;operationDigest:string;
};
/** References resolve through the existing owner. Digests never substitute for its permissions. */
export type VelaOwnerReviewBinding=OwnerBindingBase & (
  | {owner:'application-plan';ownerRef:{id:string;digest:string}}
  | {owner:'selected-file-edit';ownerRef:{id:string;digest:string;action:'apply'|'verify'}}
  | {owner:'codex-inspection';ownerRef:{id:string;digest:string;directory?:string}}
  | {owner:'specialist-mission';ownerRef:{id:string;digest:string;objective:string}}
);
export type VelaHostReviewBinding=WindowsMaintenanceReviewBinding|WindowsComputerReviewBinding|VelaOwnerReviewBinding;
export interface VelaOwnerOperationReceipt {
  contract:'aerynth.vela.owner-receipt@1';id:string;operationId:string;operationDigest:string;
  owner:VelaOwnerReviewBinding['owner'];ownerReceiptRef:{id:string;digest:string};
  claimId:string|null;identityDigest:string|null;approvalDigest:string|null;
  /** Core re-reads and verifies the source owner's actual canonical receipt. */
  state:'observed'|'no-op'|'denied'|'unavailable'|'unknown';
}
export type VelaHostOperationReceipt=WindowsReclaimReceipt|WindowsComputerReceipt|VelaOwnerOperationReceipt;
export interface VelaHostOperationNativeResult {binding:VelaHostReviewBinding;receipt:VelaHostOperationReceipt}
