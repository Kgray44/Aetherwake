import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Mutation, WorkspaceKernel } from '../../workspace-kernel/kernel.mts';
import type { Capability } from '../../integrated-backend/src/contracts.mts';
import type { GraphData } from '../../connected-conversations/src/graph.ts';
import type { CanonicalOrganizationCommand } from './contracts.ts';

export class CanonicalAdapterError extends Error {
 code: string;
 constructor(code: string) { super(code); this.code=code; }
}
const requireValue: (condition: unknown, code: string) => asserts condition = (condition, code) => { if(!condition)throw new CanonicalAdapterError(code); };
const id = (value: unknown) => { requireValue(typeof value==='string'&&value.trim().length>0&&value.length<=256,'invalid_identity'); return value; };
const title = (value: unknown) => { requireValue(typeof value==='string'&&value.trim().length>0&&value.length<=500,'invalid_title'); return value.trim(); };
const version = (value: unknown) => { requireValue(Number.isSafeInteger(value)&&Number(value)>0,'invalid_expected_version'); return Number(value); };
const synchronous = <T,>(value:T): T => { requireValue(!value||typeof (value as any).then!=='function','synchronous_canonical_callback_required');return value; };

export type CanonicalAccessRequest =
 | { kind:'project'; id:string|null; intent:'read'|'organize' }
 | { kind:'workspace'; id:string; intent:'read'|'organize' }
 | { kind:'resource'; id:string; intent:'read'|'organize' }
 | { kind:'collection'; id:string; intent:'read'|'organize' }
 | { kind:'message'; resourceId:string; messageId:string; intent:'read' }
 | { kind:'membership'; collectionId:string; resourceId:string; intent:'organize' }
 | { kind:'association'; resourceId:string; projectId:string|null; intent:'organize' };
export type CanonicalPolicy = (request:CanonicalAccessRequest)=>boolean;
export type AccessHelperOptions = {
 db:DatabaseSync;
 /** Parent policy is mandatory; relationships/placement never manufacture permission. */
 allow:CanonicalPolicy;
 /** Resolve canonical graph ancestry, message ownership and current revocation. */
 messageVisible?:(resourceId:string,messageId:string)=>boolean;
 /** Archival is not deletion; product service still requires explicit archived reads. */
 allowArchivedResources?:boolean;
};
export type CanonicalCollection = { id:string; project_id:string|null; title:string; state:'active'|'archived'; version:number; created_at:string; updated_at:string };

/** Reads only the existing canonical tables. No cached permission/content projection. */
export function createCanonicalAccessHelper(options:AccessHelperOptions) {
 const {db}=options;
 const allow=(request:CanonicalAccessRequest)=>options.allow(request)===true;
 const project=(projectId:string|null,intent:'read'|'organize'='read',includeArchived=false):boolean=>{
  if(!allow({kind:'project',id:projectId,intent}))return false;
  if(projectId===null)return true;
  const row=db.prepare('SELECT state FROM projects WHERE id=?').get(projectId);
  return !!row&&(row.state==='active'||includeArchived&&row.state==='archived');
 };
 const placements=(resourceId:string)=>db.prepare(`SELECT w.id AS workspace_id,w.project_id,w.state AS workspace_state,p.state AS project_state
  FROM blocks b JOIN workspaces w ON w.id=b.workspace_id LEFT JOIN projects p ON p.id=w.project_id
  WHERE b.resource_id=? ORDER BY w.id`).all(resourceId);
 const projectIds=(resourceId:string):string[]=>{
  const row=db.prepare('SELECT project_id FROM resources WHERE id=?').get(resourceId);
  if(!row)return [];
  if(row.project_id!==null)return [String(row.project_id)];
  return [...new Set(placements(resourceId).filter(p=>p.project_id!==null).map(p=>String(p.project_id)))].sort();
 };
 const resource=(resourceId:string,intent:'read'|'organize'='read',includeArchived=false):boolean=>{
  const row=db.prepare('SELECT project_id,state FROM resources WHERE id=?').get(resourceId);
  if(!row||!(row.state==='active'||includeArchived&&row.state==='archived')||!allow({kind:'resource',id:resourceId,intent}))return false;
  if(row.project_id!==null)return project(String(row.project_id),intent);
  const locations=placements(resourceId);
  // An unplaced local resource remains independently useful. A legacy placed
  // resource needs a still-visible authorized path; an archived-only placement
  // must not masquerade as an unassigned global resource.
  if(!locations.length)return project(null,intent);
  return locations.some(p=>p.workspace_state==='active'&&allow({kind:'workspace',id:String(p.workspace_id),intent})&&project(p.project_id===null?null:String(p.project_id),intent));
 };
 const collection=(collectionId:string,intent:'read'|'organize'='read',includeArchived=false):boolean=>{
  const row=db.prepare('SELECT project_id,state FROM collections WHERE id=?').get(collectionId);
  return !!row&&(row.state==='active'||includeArchived&&row.state==='archived')&&allow({kind:'collection',id:collectionId,intent})&&project(row.project_id===null?null:String(row.project_id),intent);
 };
 const access=(resourceId:string,messageId?:string):boolean=>{
  if(!resource(resourceId,'read',!!options.allowArchivedResources))return false;
  if(messageId===undefined)return true;
  return allow({kind:'message',resourceId,messageId,intent:'read'})&&options.messageVisible?.(resourceId,messageId)===true;
 };
 return {access,resource,project,collection,projectIds};
}

export type CanonicalConversationIdentity = { id:string; title:string; revision:number; providerId:string };
export type CanonicalOrganizationAdapterOptions = {
 db:DatabaseSync;
 kernel:WorkspaceKernel;
 /** Owning backend transaction must roll back its graph/state as well as SQLite. */
 atomic:<T>(operation:()=>T)=>T;
 allow:CanonicalPolicy;
 conversation:(resourceId:string)=>CanonicalConversationIdentity;
 renameConversation:(input:Extract<CanonicalOrganizationCommand,{type:'renameConversation'}>,mutation:Mutation)=>unknown;
 associateProject:(input:Extract<CanonicalOrganizationCommand,{type:'associateProject'}>,mutation:Mutation)=>unknown;
 /** Existing kernel membership helpers emit membership events but do not touch collection.version. */
 touchCollection:(collectionId:string,expectedVersion:number,mutation:Mutation)=>unknown;
 mutation?:()=>Mutation;
};
export type CanonicalMembershipResult = CanonicalCollection & { membership:{ resourceId:string; member:boolean; changed:boolean } };

/** No canonical SQL writes here: existing kernel or parent-owned mutation callbacks only. */
export function createCanonicalOrganizationAdapter(options:CanonicalOrganizationAdapterOptions) {
 const {db,kernel}=options;
 // Object identity matters: equal paths opened twice are still competing connections.
 kernel.withTransaction(connection=>requireValue(connection===db,'canonical_connection_mismatch'));
 const access=createCanonicalAccessHelper({db,allow:options.allow});
 const readCollection=(collectionId:string,expectedVersion:number,includeArchived=false)=>{
  const row=db.prepare('SELECT * FROM collections WHERE id=?').get(id(collectionId)) as CanonicalCollection|undefined;
  requireValue(row,'collection_missing');requireValue(row.version===version(expectedVersion),'stale_collection_version');
  requireValue(includeArchived||row.state==='active','collection_archived');requireValue(access.collection(collectionId,'organize',includeArchived),'collection_access_denied');return row;
 };
 const readResource=(resourceId:string,expectedVersion?:number)=>{
  const row=db.prepare('SELECT * FROM resources WHERE id=?').get(id(resourceId));requireValue(row,'resource_missing');
  if(expectedVersion!==undefined)requireValue(row.version===version(expectedVersion),'stale_resource_version');
  requireValue(row.state==='active','resource_archived');requireValue(access.resource(resourceId,'organize'),'resource_access_denied');return row;
 };
 const identity=(resourceId:string)=>{
  const value=structuredClone(synchronous(options.conversation(resourceId)));
  requireValue(value&&typeof value.id==='string'&&typeof value.title==='string'&&Number.isSafeInteger(value.revision)&&value.revision>0,'invalid_canonical_conversation');return value;
 };
 const run=(input:CanonicalOrganizationCommand):unknown=>{
  requireValue(input&&typeof input==='object'&&typeof input.type==='string','invalid_organization_command');
  return synchronous(options.atomic(()=>{
   const mutation=synchronous(options.mutation?.()??{origin:'user' as const,correlationId:randomUUID()});
   switch(input.type){
    case 'createCollection': {
     const projectId=input.projectId===null?null:id(input.projectId);
     requireValue(access.project(projectId,'organize'),'project_access_denied');return kernel.createCollection(title(input.title),projectId,mutation);
    }
    case 'renameCollection': {
     readCollection(input.collectionId,input.expectedVersion);return kernel.renameCollection(input.collectionId,title(input.title),input.expectedVersion,mutation);
    }
    case 'archiveCollection': {
     requireValue(typeof input.archived==='boolean','invalid_archive_state');readCollection(input.collectionId,input.expectedVersion,true);return kernel.setCollectionArchived(input.collectionId,input.archived,input.expectedVersion,mutation);
    }
    case 'membership': {
     requireValue(typeof input.member==='boolean','invalid_membership_state');const collection=readCollection(input.collectionId,input.expectedVersion);readResource(input.resourceId);
     requireValue(options.allow({kind:'membership',collectionId:input.collectionId,resourceId:input.resourceId,intent:'organize'})===true,'membership_access_denied');
     const present=!!db.prepare('SELECT 1 FROM collection_members WHERE collection_id=? AND resource_id=?').get(input.collectionId,input.resourceId);
     if(present===input.member)return {...collection,membership:{resourceId:input.resourceId,member:present,changed:false}} satisfies CanonicalMembershipResult;
     if(input.member)kernel.addToCollection(input.collectionId,input.resourceId,mutation);else kernel.removeFromCollection(input.collectionId,input.resourceId,mutation);
     synchronous(options.touchCollection(input.collectionId,input.expectedVersion,mutation));
     const updated=db.prepare('SELECT * FROM collections WHERE id=?').get(input.collectionId) as CanonicalCollection|undefined;
     requireValue(updated&&updated.version===input.expectedVersion+1,'canonical_collection_version_not_advanced');
     requireValue(updated.title===collection.title&&updated.project_id===collection.project_id&&updated.state===collection.state,'canonical_collection_identity_changed');
     requireValue(!!db.prepare('SELECT 1 FROM collection_members WHERE collection_id=? AND resource_id=?').get(input.collectionId,input.resourceId)===input.member,'canonical_membership_not_applied');
     return {...updated,membership:{resourceId:input.resourceId,member:input.member,changed:true}} satisfies CanonicalMembershipResult;
    }
    case 'renameConversation': {
     const resource=readResource(input.resourceId,input.expectedVersion);requireValue(resource.kind==='conversation','not_a_conversation');const before=identity(input.resourceId);
     requireValue(before.revision===version(input.expectedRevision),'stale_conversation_revision');const normalized={...input,title:title(input.title)};
     const result=synchronous(options.renameConversation(normalized,mutation));const after=identity(input.resourceId),updated=readResource(input.resourceId);
     requireValue(after.id===before.id&&after.providerId===before.providerId,'canonical_conversation_identity_changed');
     requireValue(after.title===normalized.title&&updated.title===normalized.title&&after.revision===before.revision+1&&updated.version===input.expectedVersion+1&&updated.project_id===resource.project_id,'canonical_rename_not_synchronized');return result;
    }
    case 'associateProject': {
     const resource=readResource(input.resourceId,input.expectedVersion),projectId=input.projectId===null?null:id(input.projectId);
     requireValue(access.project(projectId,'organize'),'project_access_denied');requireValue(options.allow({kind:'association',resourceId:input.resourceId,projectId,intent:'organize'})===true,'project_association_denied');
     const before=resource.kind==='conversation'?identity(input.resourceId):null;
     const result=synchronous(options.associateProject({...input,projectId},mutation));const updated=readResource(input.resourceId);
     requireValue(updated.project_id===projectId&&updated.version===input.expectedVersion+1,'canonical_project_not_synchronized');
     if(before){const after=identity(input.resourceId);requireValue(after.id===before.id&&after.title===before.title&&after.providerId===before.providerId&&after.revision===before.revision+1,'canonical_conversation_identity_changed');}return result;
    }
    default: throw new CanonicalAdapterError('unsupported_organization_command');
   }
  }));
 };
 // Trusted synchronous host path shares the exact checks and transaction.
 // The ordinary product port retains its asynchronous contract.
 return Object.assign(async(input:CanonicalOrganizationCommand):Promise<unknown>=>run(input),{native:run});
}

export type ObservedCapabilitySnapshot = { state:'unknown'|'fresh'|'stale'; capability?:Capability; observedAt?:string; source:'canonical.capabilities' };
/** Memory-only observation cache. It never connects, refreshes or executes a provider. */
export function createObservedCapabilityCache(options:{maxAgeMs?:number;now?:()=>number}={}) {
 const maxAgeMs=options.maxAgeMs??60_000,now=options.now??Date.now;
 requireValue(Number.isSafeInteger(maxAgeMs)&&maxAgeMs>0&&maxAgeMs<=86_400_000,'invalid_capability_cache_age');
 let observed:{capability:Capability;at:number}|undefined;
 const inspect=():ObservedCapabilitySnapshot=>{
  if(!observed)return {state:'unknown',source:'canonical.capabilities'};
  const age=now()-observed.at,fresh=age>=0&&age<=maxAgeMs;
  return {state:fresh?'fresh':'stale',capability:structuredClone(observed.capability),observedAt:new Date(observed.at).toISOString(),source:'canonical.capabilities'};
 };
 const snapshot=():Capability|undefined=>{const value=inspect();return value.state==='fresh'?value.capability:undefined;};
 return {snapshot,inspect,clear(){observed=undefined;},observe(capability:Capability){
  requireValue(capability&&typeof capability.providerId==='string'&&capability.providerId!=='local'&&capability.providerId!=='mock-ordinary'&&['available','required','unavailable'].includes(capability.authentication)&&Array.isArray(capability.models)&&capability.models.every(m=>typeof m==='string')&&capability.catalogOnly===true,'invalid_observed_capability');
  const at=now();requireValue(Number.isFinite(at),'invalid_observation_time');observed={capability:structuredClone(capability),at};
 }};
}

/** Canonical aliases only; local recording never pretends to be model execution. */
export function resolveLocalRecordingProvider(graph:Pick<GraphData,'providers'>):{providerId:'local'|'mock-ordinary';legacyCompatibility:boolean;modelExecution:false} {
 if(graph.providers.some(p=>p.id==='local'))return {providerId:'local',legacyCompatibility:false,modelExecution:false};
 requireValue(graph.providers.some(p=>p.id==='mock-ordinary'),'local_recording_provider_unavailable');
 return {providerId:'mock-ordinary',legacyCompatibility:true,modelExecution:false};
}

export function matchObservedExecutionProvider(graph:Pick<GraphData,'providers'>,observed:Capability|undefined) {
 if(!observed||observed.providerId==='local'||observed.providerId==='mock-ordinary')return undefined;
 return graph.providers.find(provider=>provider.id===observed.providerId);
}
