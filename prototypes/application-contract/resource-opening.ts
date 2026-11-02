import type { BlockKind, Resource } from './contracts.ts';

/** Browser-safe identity/presentation contract. Opening never places or mutates. */
export const RESOURCE_OPENING_CONTRACT='aerynth.resource-opening@1' as const;
export const RESOURCE_OPENING_ORIGIN_SOURCES=Object.freeze(['application','constellation','library','search','project','collection','related-resource','branch','vela','contextual-command','workspace','recent'] as const);
export type ResourceOpeningOriginSource=typeof RESOURCE_OPENING_ORIGIN_SOURCES[number];
export type ResourceOpeningInput={
 resourceId:string;
 preferredPresentation?:'direct'|'existing-placement';
 preferredPlacement?:{workspaceId:string;blockId:string};
 /** Bounded animation/navigation hint only, never authorization or identity. */
 origin?:{source:ResourceOpeningOriginSource;nodeKey?:string};
 selection?:{messageId:string};
};
export type ResourceOpeningResult=
 | {contract:typeof RESOURCE_OPENING_CONTRACT;status:'ready';resourceId:string;
    /** Conversation messages are deliberately not hydrated here. Use the same
     * canonical chat/draft ports; an empty projection is not a history count. */
    resource:Resource;presentation:{kind:BlockKind;mode:'direct'|'existing-placement'};
    placement?:{workspaceId:string;blockId:string};placementStatus?:'verified'|'unavailable';selection?:{messageId:string}}
 | {contract:typeof RESOURCE_OPENING_CONTRACT;status:'unavailable';resourceId:string;reason:'resource-unavailable'|'selection-unavailable'}
 | {contract:typeof RESOURCE_OPENING_CONTRACT;status:'unsupported';resourceId:string;reason:'resource-kind-unsupported'|'message-selection-unsupported';kind?:string};

export class ResourceOpeningInputError extends Error {
 readonly code='invalid_resource_opening_request';
 constructor(){super('invalid_resource_opening_request');this.name='ResourceOpeningInputError';}
}
const reject=():never=>{throw new ResourceOpeningInputError();};
function object(value:unknown,keys:readonly string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))return reject();
 const prototype=Object.getPrototypeOf(value);if(prototype!==Object.prototype&&prototype!==null)return reject();
 const fields=Reflect.ownKeys(value);if(fields.some(k=>typeof k!=='string'||!keys.includes(k)))return reject();
 const descriptors=Object.getOwnPropertyDescriptors(value);if(fields.some(k=>!Object.hasOwn(descriptors[k as string],'value')))return reject();
 return value as Record<string,unknown>;
}
const identifier=(value:unknown):string=>typeof value==='string'&&value.length>=1&&value.length<=256&&value.trim().length>0?value:reject();
/** Exact schema, copied scalar hints; never invokes caller getters or trims IDs. */
export function parseResourceOpeningInput(value:unknown):ResourceOpeningInput {
 const input=object(value,['resourceId','preferredPresentation','preferredPlacement','origin','selection']);
 const result:ResourceOpeningInput={resourceId:identifier(input.resourceId)};
 if(Object.hasOwn(input,'preferredPresentation')){if(input.preferredPresentation!=='direct'&&input.preferredPresentation!=='existing-placement')return reject();result.preferredPresentation=input.preferredPresentation;}
 if(Object.hasOwn(input,'preferredPlacement')){const hint=object(input.preferredPlacement,['workspaceId','blockId']);result.preferredPlacement={workspaceId:identifier(hint.workspaceId),blockId:identifier(hint.blockId)};}
 if(Object.hasOwn(input,'origin')){const origin=object(input.origin,['source','nodeKey']);if(!RESOURCE_OPENING_ORIGIN_SOURCES.includes(origin.source as ResourceOpeningOriginSource))return reject();result.origin={source:origin.source as ResourceOpeningOriginSource};if(Object.hasOwn(origin,'nodeKey'))result.origin.nodeKey=identifier(origin.nodeKey);}
 if(Object.hasOwn(input,'selection')){const selection=object(input.selection,['messageId']);result.selection={messageId:identifier(selection.messageId)};}
 return result;
}
