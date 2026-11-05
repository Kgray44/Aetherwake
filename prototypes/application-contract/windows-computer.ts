/** Model-safe discovery; captions, process identities and native authorities stay private. */
export interface WindowsComputerDiscovery {
  contract:'aerynth.windows.computer@1';snapshotId:string;observedAt:string;partial:boolean;
  windows:{ref:string;application:string;state:'normal'|'minimized'|'maximized';
    bounds:{x:number;y:number;width:number;height:number};eligible:boolean}[];
  applications:{ref:string;name:string}[];
  coverage?:{windowsObserved:number;windowsReturned:number;applicationsObserved:number;applicationsReturned:number};
}
export interface WindowsComputerObservation {
  contract:'aerynth.windows.window-observation@1';snapshotId:string;windowRef:string;observedAt:string;
  trust:'untrusted-application-data';partial:boolean;
  controls:{ref:string;name:string;role:string;enabled:boolean;password:boolean;
    value?:string;bounds:{x:number;y:number;width:number;height:number}}[];
  coverage?:{controlsObserved:number;controlsReturned:number};
}
export type WindowsComputerAction =
  | {type:'select-window';windowRef?:string}
  | {type:'launch';applicationRef:string}
  | {type:'activate'|'minimize'|'maximize'|'restore';windowRef:string}
  | {type:'move-resize';windowRef:string;x:number;y:number;width:number;height:number}
  | {type:'invoke-control';windowRef:string;controlRef:string;snapshotId:string}
  | {type:'set-text';windowRef:string;controlRef:string;snapshotId:string;text:string};
export interface WindowsComputerReviewBinding {
  contract:'aerynth.windows.computer-review@1';operationId:string;expectedVersion:number;
  requestId:string;workflowId:string;scopeDigest:string;operationDigest:string;
  action:WindowsComputerAction;
}
export interface WindowsComputerReceipt {
  contract:'aerynth.windows.computer-receipt@1';id:string;operationId:string;operationDigest:string;
  observedAt:string;state:'observed'|'no-op'|'denied'|'unavailable'|'unknown';reason:string;
  claimId:string|null;identityDigest:string|null;approvalDigest:string|null;
  nativeCallSucceeded:boolean|null;
  verification:'verified'|'unverified';
  /** Permitted actual observation only. It cannot contain native tokens or process IDs. */
  outputJson:string;
}
