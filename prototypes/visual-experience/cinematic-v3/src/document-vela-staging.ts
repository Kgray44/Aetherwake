import type { Resource } from '../../../application-contract/contracts.ts';
import { supportsDocumentQuestion } from './resource-surface.ts';

/** Canonical read only. Staging is not Send or approval to disclose. */
export async function stageChatDocumentForVela(document: {id:string;version:number}, port: {
  open(input:{resourceId:string;expectedVersion:number;origin:{source:'application'}}): Promise<{status:string;resource?:Resource}>;
  isCurrent():boolean;
  stage(resource:Resource):void;
}):Promise<void> {
  if(!document.id.trim()||!Number.isSafeInteger(document.version)||document.version<1)throw Error('invalid_document_source');
  if(!port.isCurrent())return;
  const result=await port.open({resourceId:document.id,expectedVersion:document.version,origin:{source:'application'}});
  if(!port.isCurrent())return;
  const resource=result.resource;
  if(result.status!=='ready'||!resource||resource.id!==document.id||resource.version!==document.version||resource.available===false||resource.visible===false||resource.state==='archived'||(resource.kind!=='note'&&!supportsDocumentQuestion(resource)))throw Error('resource_unavailable');
  port.stage(resource);
}
