import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { ConversationGraph, type GraphData, type Message } from '../../connected-conversations/src/graph.ts';
import type { Snapshot, CommandMap } from '../../integrated-backend/src/contracts.mts';
import type { DesktopSnapshot, PublicConversationExecution, Resource } from '../../application-contract/contracts.ts';
import type { BranchPolicy, CanonicalOrganizationCommand, Collection, ConversationProductPort, ConversationSummary, Detail, Evidence, MessageView, Page, ProductCommandMap, ProviderCapability, SearchHit, SearchQuery, Share } from './contracts.ts';
import { CONVERSATION_DRAFT_LIMITS, CONVERSATION_VIEW_LIMITS, type ConversationDraft, type ConversationView, type ConversationViewPosition, type ConversationViewSelection, type ConversationViewSelected } from './contracts.ts';
import { createNativeChatGPTFidelityDescriptor } from './native-chatgpt-fidelity.ts';

export interface CanonicalConversationHost {
 snapshot(): Promise<Snapshot>;
 desktop(): Promise<DesktopSnapshot>;
 /** Trusted in-process read projection over the SAME canonical graph. No renderer/provider access. */
 canonicalReadView?(): Promise<ConversationReadView>;
 /** Optional trusted SAME-connection synchronous read transaction. The host
  * creates a fresh view + authorization memo for this call only, rejects nested
  * or thenable callbacks, and fences every lazy callback when the call closes.
  * No await/provider/native work or escaping lazy authority is permitted. */
 canonicalReadBatch?<T>(read:(view:ConversationReadView)=>T):T;
 command<K extends keyof CommandMap>(name: K, input: CommandMap[K]['input']): Promise<CommandMap[K]['output']>;
 organize(input: CanonicalOrganizationCommand): Promise<unknown>;
 /** Optional side-effect-free catalog, so reading local history never starts a connection. */
 capabilitySnapshot?(): CommandMap['capabilities']['output'] | undefined;
 /** Side-effect-free, explicit canonical registry; history reads never connect. */
 providerRegistrySnapshot?():{providers:readonly ProviderCapability[];defaultProviderId?:string};
 /** Current host authority. A message check includes its canonical visibility
  * from the given conversation and its source policy, not merely owner ACL. */
 access?(resourceId: string, messageId?: string): boolean;
 /** Uses existing canonical execution service, with context receipt after actual dispatch. */
 sendWithContext?(input: ProductCommandMap['send']['input'], context: AttachedContext[]): Promise<unknown>;
 contextReceipt?(executionId: string, resourceId: string, shareId: string, digest: string): boolean;
}
export type AttachedContext = { shareId: string; sourceResourceId: string; sourceMessageId: string; digest: string; evidence: Evidence; content: string };
export class ProductError extends Error { code: string; constructor(code: string) { super(code); this.code=code; } }
const check: (condition: unknown, code: string) => asserts condition = (condition, code) => { if (!condition) throw new ProductError(code); };
const hash = (content: string) => createHash('sha256').update(content).digest('hex');
const stamp = () => new Date().toISOString();
const evidence: Evidence[] = ['excerpt', 'reported', 'observed', 'hypothesis', 'decision', 'disputed'];
const text = (value: unknown, limit = 500) => { check(typeof value === 'string' && value.trim() && value.length <= limit, 'invalid_text'); return value.trim(); };
const fields=(value:unknown,keys:readonly string[],code:string,optional=false)=>{
 check(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>keys.includes(k))&&(optional||keys.every(k=>Object.hasOwn(value,k))),code);
 return value as Record<string,unknown>;
};
const viewId=(value:unknown,code='invalid_conversation_view_id')=>{check(typeof value==='string'&&!!value.trim()&&value.length<=CONVERSATION_VIEW_LIMITS.idUnits,code);return value;};
const viewVersion=(value:unknown,code='invalid_conversation_view_version',minimum=0)=>{check(typeof value==='number'&&Number.isSafeInteger(value)&&value>=minimum,code);return value;};
function parseViewPosition(value:unknown,code='invalid_conversation_view_position'):ConversationViewPosition|null{
 if(value===null)return null;const a=fields(value,['conversationRevision','anchor'],code),conversationRevision=viewVersion(a.conversationRevision,code,1);
 if(a.anchor===null)return {conversationRevision,anchor:null};const p=fields(a.anchor,['messageId','offsetY'],code),messageId=viewId(p.messageId,code),offsetY=p.offsetY;
 check(typeof offsetY==='number'&&Number.isFinite(offsetY)&&Math.abs(offsetY)<=CONVERSATION_VIEW_LIMITS.offsetY,code);return {conversationRevision,anchor:{messageId,offsetY}};
}
function parseViewSelection(value:unknown,code='invalid_conversation_view_selection'):ConversationViewSelection|null{
 if(value===null)return null;const a=fields(value,['draftVersion','start','end','direction'],code),draftVersion=viewVersion(a.draftVersion,code),start=viewVersion(a.start,code),end=viewVersion(a.end,code),direction=a.direction;
 check(start<=end&&end<=CONVERSATION_DRAFT_LIMITS.contentUnits&&(direction==='forward'||direction==='backward'||direction==='none'),code);return {draftVersion,start,end,direction};
}
const page = <T,>(items: T[], q: { offset?: number; limit?: number }): Page<T> => {
 const offset = q.offset ?? 0, limit = q.limit ?? 50;
 check(Number.isInteger(offset) && offset >= 0 && Number.isInteger(limit) && limit > 0 && limit <= 200, 'invalid_page');
 return { items: items.slice(offset, offset + limit), total: items.length, offset, limit, hasMore: offset + limit < items.length };
};
export interface ConversationReadView {
 readonly conversations: readonly Snapshot['conversations'][number][]; readonly resourceMap: Readonly<Snapshot['resourceMap']>;
 readonly graph: Pick<ConversationGraph,'visibleMessages'|'visibleMessageMetadata'>;
 readonly graphMetadata: Readonly<Pick<GraphData,'providers'|'conversations'|'edges'|'unavailableMessageIds'>>;
 readonly executions: Readonly<Record<string,PublicConversationExecution>>;
 readonly messageEvidence?:Readonly<Record<string,{executionId:string;outputState?:'complete'|'partial'}>>;
 /** Only currently visible canonical metadata. Bodies are deliberately absent from this shape. */
 readonly desktop: Readonly<Pick<DesktopSnapshot,'projects'|'workspaces'>> & {readonly blocks:readonly {readonly workspace_id:string;readonly resource_id?:string}[];readonly resources:readonly Readonly<Pick<Resource,'id'|'kind'|'title'|'version'|'state'|'visible'|'available'|'project_id'>>[]};
 messageMetadata(messageId:string): {id:string;conversationId:string;createdAt:string}|null;
 /** Both lazy callbacks must recheck current source authorization; retained views never confer permission. */
 resourceContent(resourceId:string): string;
}
type View = ConversationReadView & {
 publicIds:Map<string,string>;
 indices:{resources:Map<string,ConversationReadView['desktop']['resources'][number]>;conversations:Map<string,ConversationReadView['conversations'][number]>;headers:Map<string,GraphData['conversations'][number]>;projectIds:Map<string,string[]>;unavailable:Set<string>;executions:Map<string,PublicConversationExecution>;flags?:Set<string>;memberships?:Map<string,string[]>;members?:Map<string,string[]>};
 /** Derived metadata only, usable while the host's synchronous batch is open. */
 projection?:{summaries:Map<string,ConversationSummary>;collections?:Collection[]};
};

/** Additive metadata on the injected canonical connection. Never opens/closes/resets a DB. */
export class ConversationProduct implements ConversationProductPort {
 private db: DatabaseSync;
 private host: CanonicalConversationHost;
 constructor(db: DatabaseSync, host: CanonicalConversationHost) {
  this.db=db;this.host=host;
  this.tx(() => {
   const installed=!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='cp_schema'").get();
   if(installed){const versions=db.prepare('SELECT id,version FROM cp_schema').all();check(versions.length===1&&versions[0].id===1&&(versions[0].version===1||versions[0].version===2||versions[0].version===3),'unsupported_conversation_product_schema');}
   db.exec(`CREATE TABLE IF NOT EXISTS cp_schema(id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS cp_flags(resource_id TEXT PRIMARY KEY REFERENCES resources(id), favorite INTEGER NOT NULL CHECK(favorite IN(0,1)));
    CREATE TABLE IF NOT EXISTS cp_collection_rules(collection_id TEXT PRIMARY KEY REFERENCES collections(id), parent_id TEXT REFERENCES collections(id), rule TEXT, version INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS cp_policy(resource_id TEXT PRIMARY KEY REFERENCES resources(id), revision INTEGER NOT NULL, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS cp_shares(id TEXT PRIMARY KEY, source_resource_id TEXT NOT NULL REFERENCES resources(id), source_message_id TEXT NOT NULL, source_time TEXT NOT NULL, digest TEXT NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL, evidence TEXT NOT NULL, created_at TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, supersedes TEXT REFERENCES cp_shares(id));
    CREATE TABLE IF NOT EXISTS cp_adoptions(share_id TEXT NOT NULL REFERENCES cp_shares(id), target_id TEXT NOT NULL REFERENCES resources(id), inspected_at TEXT, attached_at TEXT, sent_at TEXT, execution_id TEXT, PRIMARY KEY(share_id,target_id));
    CREATE TABLE IF NOT EXISTS cp_audit(id TEXT PRIMARY KEY, action TEXT NOT NULL, subject_id TEXT NOT NULL, at TEXT NOT NULL);`);
   if(!installed)db.prepare('INSERT INTO cp_schema VALUES(1,1)').run();
   const row = db.prepare('SELECT version FROM cp_schema WHERE id=1').get()!;
   if(row.version===1){
    db.exec(`CREATE TABLE cp_drafts(resource_id TEXT PRIMARY KEY REFERENCES resources(id), version INTEGER NOT NULL CHECK(version>=1 AND version<=9007199254740991), content TEXT NOT NULL, content_bytes INTEGER NOT NULL CHECK(content_bytes>=0 AND content_bytes<=65536 AND content_bytes=length(CAST(content AS BLOB))), updated_at TEXT NOT NULL) STRICT;`);
    db.prepare('UPDATE cp_schema SET version=2 WHERE id=1 AND version=1').run();
   }else check(!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='cp_drafts'").get(),'conversation_draft_storage_unavailable');
   if(Number(db.prepare('SELECT version FROM cp_schema WHERE id=1').get()!.version)===2){
    db.exec(`CREATE TABLE cp_views(resource_id TEXT PRIMARY KEY REFERENCES resources(id),version INTEGER NOT NULL CHECK(version>=1 AND version<=9007199254740991),json TEXT NOT NULL,bytes INTEGER NOT NULL CHECK(bytes>=0 AND bytes<=2048 AND bytes=length(CAST(json AS BLOB))),updated_at TEXT NOT NULL) STRICT;
     CREATE TABLE cp_view_selection(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL CHECK(version>=1 AND version<=9007199254740991),resource_id TEXT REFERENCES resources(id),updated_at TEXT NOT NULL) STRICT;`);
    db.prepare('UPDATE cp_schema SET version=3 WHERE id=1 AND version=2').run();
   }else for(const table of ['cp_views','cp_view_selection'])check(!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table),'conversation_view_storage_unavailable');
  });
 }
 private tx<T>(fn: () => T): T { this.db.exec('SAVEPOINT conversation_product'); try { const result = fn(); this.db.exec('RELEASE conversation_product'); return result; } catch (error) { this.db.exec('ROLLBACK TO conversation_product'); this.db.exec('RELEASE conversation_product'); throw error; } }
 private audit(action: string, id: string) { this.db.prepare('INSERT INTO cp_audit VALUES(?,?,?,?)').run(randomUUID(), action, id, stamp()); }
 private favorite(input:ProductCommandMap['favorite']['input']):boolean {
  check(typeof input.favorite==='boolean','invalid_favorite');
  this.tx(()=>{this.db.prepare('INSERT INTO cp_flags VALUES(?,?) ON CONFLICT(resource_id) DO UPDATE SET favorite=excluded.favorite').run(input.resourceId,input.favorite?1:0);this.audit('favorite',input.resourceId);});
  return input.favorite;
 }
 /** Trusted synchronous canonical host path only; deliberately absent from ProductCommandMap. */
 nativeFavorite(input:ProductCommandMap['favorite']['input']):boolean {
  check(input&&typeof input==='object'&&!Array.isArray(input)&&typeof input.resourceId==='string'&&input.resourceId.length>0&&input.resourceId.length<=256&&Object.keys(input).every(key=>['resourceId','favorite'].includes(key)),'invalid_favorite');
  const row=this.db.prepare('SELECT kind,state,project_id FROM resources WHERE id=?').get(input.resourceId);
  check(row?.kind==='conversation'&&row.state==='active'&&this.host.access?.(input.resourceId)===true,'source_unavailable');
  check(row.project_id===null||this.db.prepare("SELECT id FROM projects WHERE id=? AND state='active'").get(row.project_id)!==undefined,'source_unavailable');
  return this.favorite(input);
 }
 private indexed(view:ConversationReadView,batch=false):View {
  const resources=new Map(view.desktop.resources.map(r=>[r.id,r])),projectIds=new Map<string,string[]>(),workspaces=new Map(view.desktop.workspaces.map(w=>[w.id,w])),executions=new Map<string,PublicConversationExecution>();
  for(const r of view.desktop.resources)projectIds.set(r.id,r.project_id?[r.project_id]:[]);
  for(const b of view.desktop.blocks){if(!b.resource_id||resources.get(b.resource_id)?.project_id)continue;const project=workspaces.get(b.workspace_id)?.project_id;if(project){const ids=projectIds.get(b.resource_id);if(ids&&!ids.includes(project))ids.push(project);}}
  for(const ids of projectIds.values())ids.sort();
  for(const e of Object.values(view.executions)){const prior=executions.get(e.resourceId);if(!prior||e.startedAt>prior.startedAt||e.startedAt===prior.startedAt&&e.id<prior.id)executions.set(e.resourceId,e);}
  return {...view,publicIds:new Map(Object.entries(view.resourceMap).map(([rid,gid])=>[gid,rid])),indices:{resources,conversations:new Map(view.conversations.map(c=>[c.resourceId,c])),headers:new Map(view.graphMetadata.conversations.map(c=>[c.id,c])),projectIds,unavailable:new Set(view.graphMetadata.unavailableMessageIds),executions},...(batch?{projection:{summaries:new Map()}}:{})};
 }
 private summaryMetadata(v:View) {
  // One command-local projection of existing canonical metadata, not a store
  // or authorization cache. Resource/message permission checks remain live.
  if(!v.indices.flags)v.indices.flags=new Set(this.db.prepare('SELECT resource_id FROM cp_flags WHERE favorite=1').all().map(r=>String(r.resource_id)));
  if(!v.indices.memberships){const memberships=new Map<string,string[]>(),members=new Map<string,string[]>();for(const row of this.db.prepare('SELECT collection_id,resource_id FROM collection_members').all()){const rid=String(row.resource_id),cid=String(row.collection_id);if(!v.indices.resources.has(rid))continue;const cs=memberships.get(rid)??[];cs.push(cid);memberships.set(rid,cs);const rs=members.get(cid)??[];rs.push(rid);members.set(cid,rs);}v.indices.memberships=memberships;v.indices.members=members;}
 }
 private async view(): Promise<View> {
  if(this.host.canonicalReadView)return this.indexed(await this.host.canonicalReadView());
  // Sequential reads share the backend's owning command queue. Access is checked again below.
  const snapshot = await this.host.snapshot(), desktop = await this.host.desktop();
  // Compatibility fallback is explicitly unscaled: it still receives/reconstructs the full graph.
  return this.indexed({conversations:snapshot.conversations,resourceMap:snapshot.resourceMap,graphMetadata:{providers:snapshot.graph.providers,conversations:snapshot.graph.conversations,edges:snapshot.graph.edges,unavailableMessageIds:snapshot.graph.unavailableMessageIds},messageEvidence:Object.fromEntries(Object.entries(snapshot.messageEvidence).map(([id,e])=>[id,{executionId:e.executionId,...(e.outputState?{outputState:e.outputState}:{})}])),executions:Object.fromEntries(Object.entries(snapshot.executions).map(([id,e])=>[id,{id:e.id,resourceId:e.resourceId,providerId:e.providerId,state:e.state,commandId:e.commandId,startedAt:e.startedAt,endedAt:e.endedAt,taskVerified:false,...(e.errorCode?{errorCode:e.errorCode}:{})}])),desktop:{projects:desktop.projects,workspaces:desktop.workspaces,blocks:desktop.blocks,resources:desktop.resources.map(({id,kind,title,version,state,visible,available,project_id})=>({id,kind,title,version,state,visible,available,project_id}))},graph:new ConversationGraph([],snapshot.graph),messageMetadata:id=>{const m=snapshot.graph.messages.find(m=>m.id===id);return m?{id:m.id,conversationId:m.conversationId,createdAt:m.createdAt}:null;},resourceContent:id=>desktop.resources.find(r=>r.id===id)?.content??''});
 }
 private resource(v: View, id: string, messageId?: string, archived = false) {
  const r = v.indices.resources.get(id);
  check(r && (archived || r.visible !== false && r.available !== false) && this.host.access?.(id, messageId) !== false, 'source_unavailable');
  // Archived content is accessible only through an explicit host authorization, never merely a surviving placement.
  if (r.visible === false || r.available === false) check(archived && this.host.access?.(id, messageId) === true, 'source_unavailable');
  if (messageId) check(!v.indices.unavailable.has(messageId), 'source_revoked');
  return r;
 }
 private readable(v: View, id: string, messageId?: string, archived = false) { try { this.resource(v, id, messageId, archived); return true; } catch { return false; } }
 private draftResource(v: View, id: string) {
  const r=this.resource(v,id),canonical=this.db.prepare('SELECT kind,state FROM resources WHERE id=?').get(id);
  check(r.kind==='conversation'&&(r.state===undefined||r.state==='active')&&canonical?.kind==='conversation'&&canonical.state==='active'&&!!v.resourceMap[id]&&v.conversations.some(c=>c.resourceId===id),'source_unavailable');
 }
 private draft(id: string): ConversationDraft {
  const row=this.db.prepare('SELECT version,content,content_bytes,updated_at FROM cp_drafts WHERE resource_id=?').get(id);
  if(!row)return {resourceId:id,version:0,content:'',updatedAt:null};
  const content=String(row.content),version=Number(row.version),updatedAt=String(row.updated_at);
  check(Number.isSafeInteger(version)&&version>=1&&content.length<=CONVERSATION_DRAFT_LIMITS.contentUnits&&Buffer.byteLength(content,'utf8')===row.content_bytes&&Number(row.content_bytes)<=CONVERSATION_DRAFT_LIMITS.contentBytes&&!Number.isNaN(Date.parse(updatedAt)),'corrupt_conversation_draft');
  return {resourceId:id,version,content,updatedAt};
 }
 private saveDraft(v: View, input: ProductCommandMap['saveDraft']['input']): ConversationDraft {
  this.draftResource(v,input.resourceId);
  check(Number.isSafeInteger(input.expectedVersion)&&input.expectedVersion>=0,'invalid_draft_version');
  check(typeof input.content==='string'&&input.content.length<=CONVERSATION_DRAFT_LIMITS.contentUnits,'invalid_draft_content');
  const encoded=Buffer.from(input.content,'utf8');check(encoded.length<=CONVERSATION_DRAFT_LIMITS.contentBytes&&encoded.toString('utf8')===input.content,'invalid_draft_content');
  return this.tx(()=>{
   this.draftResource(v,input.resourceId);const previous=this.draft(input.resourceId);
   check(previous.version===input.expectedVersion,'stale_draft_version');check(previous.version<Number.MAX_SAFE_INTEGER,'draft_revision_exhausted');
   const usage=this.db.prepare('SELECT COUNT(*) AS records,COALESCE(SUM(content_bytes),0) AS bytes FROM cp_drafts').get()!;
   check((previous.version>0||Number(usage.records)<CONVERSATION_DRAFT_LIMITS.records)&&Number(usage.bytes)-Buffer.byteLength(previous.content,'utf8')+encoded.length<=CONVERSATION_DRAFT_LIMITS.aggregateBytes,'draft_capacity_exceeded');
   const updatedAt=stamp(),version=previous.version+1;
   const result=this.db.prepare('INSERT INTO cp_drafts(resource_id,version,content,content_bytes,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(resource_id) DO UPDATE SET version=excluded.version,content=excluded.content,content_bytes=excluded.content_bytes,updated_at=excluded.updated_at WHERE cp_drafts.version=?').run(input.resourceId,version,input.content,encoded.length,updatedAt,input.expectedVersion);
   check(Number(result.changes)===1,'stale_draft_version');return {resourceId:input.resourceId,version,content:input.content,updatedAt};
  });
 }
 /** View metadata requires explicit current host authority, including for an
  * inherited anchor. The host already owns canonical lineage visibility. */
 private viewResource(v:View,id:string){this.draftResource(v,id);check(this.host.access?.(id)===true,'source_unavailable');const revision=v.indices.conversations.get(id)?.revision;return viewVersion(revision,'source_unavailable',1);}
 private viewAvailable(v:View,id:string){try{this.viewResource(v,id);return true;}catch(error){if(error instanceof ProductError&&error.code==='source_unavailable')return false;throw error;}}
 private viewAnchor(v:View,id:string,messageId:string):boolean{
  if(v.indices.unavailable.has(messageId)||this.host.access?.(id,messageId)!==true)return false;
  const metadata=v.messageMetadata(messageId),source=metadata&&v.publicIds.get(metadata.conversationId);
  return !!source&&this.readable(v,source,messageId)&&this.host.access?.(source,messageId)===true;
 }
 private storedViewSelected():ConversationViewSelected{
  const row=this.db.prepare('SELECT version,resource_id,updated_at FROM cp_view_selection WHERE id=1').get();if(!row)return {version:0,resourceId:null,updatedAt:null};
  const code='corrupt_conversation_view_selection',version=viewVersion(row.version,code,1),resourceId=row.resource_id===null?null:viewId(row.resource_id,code),updatedAt=row.updated_at;
  check(typeof updatedAt==='string'&&Number.isFinite(Date.parse(updatedAt)),code);return {version,resourceId,updatedAt};
 }
 private viewRecord(v:View,id:string):ConversationView{
  const revision=this.viewResource(v,id),row=this.db.prepare('SELECT version,json,bytes,updated_at FROM cp_views WHERE resource_id=?').get(id);
  if(!row)return {resourceId:id,version:0,position:null,selection:null,positionStatus:'none',selectionStatus:'none',updatedAt:null};
  const code='corrupt_conversation_view',version=viewVersion(row.version,code,1),updatedAt=row.updated_at;
  check(typeof row.json==='string'&&row.bytes===Buffer.byteLength(row.json,'utf8')&&Number(row.bytes)<=CONVERSATION_VIEW_LIMITS.entryBytes&&typeof updatedAt==='string'&&Number.isFinite(Date.parse(updatedAt)),code);
  let stored:unknown;try{stored=JSON.parse(row.json);}catch{throw new ProductError(code);}
  const a=fields(stored,['position','selection'],code);let position=parseViewPosition(a.position,code),selection=parseViewSelection(a.selection,code);
  let positionStatus:ConversationView['positionStatus']='none',selectionStatus:ConversationView['selectionStatus']='none';
  if(position){if(position.anchor&&!this.viewAnchor(v,id,position.anchor.messageId)||!position.anchor&&position.conversationRevision!==revision){position=null;positionStatus='unavailable';}else if(position.conversationRevision!==revision){position={...position,conversationRevision:revision};positionStatus='anchor-revalidated';}else positionStatus='current';}
  if(selection){const storedVersion=Number(this.db.prepare('SELECT version FROM cp_drafts WHERE resource_id=?').get(id)?.version??0);if(selection.draftVersion!==storedVersion){selection=null;selectionStatus='draft-changed';}else{check(selection.end<=this.draft(id).content.length,code);selectionStatus='current';}}
  return {resourceId:id,version,position,selection,positionStatus,selectionStatus,updatedAt};
 }
 private readViewState(v:View,input:ProductCommandMap['readViewState']['input']):ProductCommandMap['readViewState']['output']{
  const a=fields(input,['resourceId'],'invalid_conversation_view_input',true),stored=this.storedViewSelected(),selected=stored.resourceId&&!this.viewAvailable(v,stored.resourceId)?{version:stored.version,resourceId:null,updatedAt:null}:stored;
  const id=a.resourceId===undefined?selected.resourceId:viewId(a.resourceId);return {contract:'aerynth.conversation-view@1',selected,view:id===null?null:this.viewRecord(v,id)};
 }
 private saveViewState(v:View,input:ProductCommandMap['saveViewState']['input']):ConversationView{
  const a=fields(input,['resourceId','expectedVersion','position','selection'],'invalid_conversation_view_input'),id=viewId(a.resourceId),expected=viewVersion(a.expectedVersion),position=parseViewPosition(a.position),selection=parseViewSelection(a.selection);
  this.viewResource(v,id);
  return this.tx(()=>{
   const revision=this.viewResource(v,id),previous=this.db.prepare('SELECT version,bytes FROM cp_views WHERE resource_id=?').get(id),version=viewVersion(previous?.version??0,'corrupt_conversation_view');
   check(version===expected,'stale_conversation_view_version');check(version<Number.MAX_SAFE_INTEGER,'conversation_view_revision_exhausted');
   if(position){check(position.conversationRevision===revision,'stale_view_conversation_revision');if(position.anchor)check(this.viewAnchor(v,id,position.anchor.messageId),'view_anchor_unavailable');}
   if(selection){const draft=this.draft(id);check(selection.draftVersion===draft.version,'stale_view_draft_version');check(selection.end<=draft.content.length,'invalid_conversation_view_selection');}
   const json=JSON.stringify({position,selection}),bytes=Buffer.byteLength(json,'utf8'),usage=this.db.prepare('SELECT COUNT(*) AS records,COALESCE(SUM(bytes),0) AS bytes FROM cp_views').get()!;
   check(bytes<=CONVERSATION_VIEW_LIMITS.entryBytes&&(previous||Number(usage.records)<CONVERSATION_VIEW_LIMITS.records)&&Number(usage.bytes)-Number(previous?.bytes??0)+bytes<=CONVERSATION_VIEW_LIMITS.aggregateBytes,'conversation_view_capacity_exceeded');
   const updatedAt=stamp(),result=this.db.prepare('INSERT INTO cp_views(resource_id,version,json,bytes,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(resource_id) DO UPDATE SET version=excluded.version,json=excluded.json,bytes=excluded.bytes,updated_at=excluded.updated_at WHERE cp_views.version=?').run(id,version+1,json,bytes,updatedAt,expected);
   check(Number(result.changes)===1,'stale_conversation_view_version');return {resourceId:id,version:version+1,position,selection,positionStatus:position?'current':'none',selectionStatus:selection?'current':'none',updatedAt};
  });
 }
 private selectView(v:View,input:ProductCommandMap['selectView']['input']):ConversationViewSelected{
  const a=fields(input,['resourceId','expectedVersion'],'invalid_conversation_view_input'),resourceId=a.resourceId===null?null:viewId(a.resourceId),expected=viewVersion(a.expectedVersion);
  if(resourceId!==null)this.viewResource(v,resourceId);
  return this.tx(()=>{
   if(resourceId!==null)this.viewResource(v,resourceId);const previous=this.storedViewSelected();check(previous.version===expected,'stale_conversation_view_selection_version');check(previous.version<Number.MAX_SAFE_INTEGER,'conversation_view_revision_exhausted');
   const version=previous.version+1,updatedAt=stamp(),result=this.db.prepare('INSERT INTO cp_view_selection(id,version,resource_id,updated_at) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,resource_id=excluded.resource_id,updated_at=excluded.updated_at WHERE cp_view_selection.version=?').run(version,resourceId,updatedAt,expected);
   check(Number(result.changes)===1,'stale_conversation_view_selection_version');return {version,resourceId,updatedAt};
  });
 }
 private message(v: View, resourceId: string, messageId: string): Message {
  this.resource(v, resourceId, messageId);
  const gid = v.resourceMap[resourceId]; check(gid, 'conversation_missing');
  const m = v.graph.visibleMessages(gid).find(m => m.id === messageId); check(m, 'message_missing');
  const sourceId = v.publicIds.get(m.conversationId); check(sourceId, 'source_unavailable'); this.resource(v, sourceId, m.id);
  return m;
 }
 private family(v: View, id: string): Set<string> {
  check(v.resourceMap[id], 'conversation_missing');
  const ids = new Set([v.resourceMap[id]]); let expanded = true;
  while (expanded) { expanded = false; for (const e of v.graphMetadata.edges) if (ids.has(e.parentId) || ids.has(e.childId)) { if (!ids.has(e.parentId) || !ids.has(e.childId)) expanded = true; ids.add(e.parentId); ids.add(e.childId); } }
  return new Set([...ids].map(gid => v.publicIds.get(gid)!).filter(Boolean));
 }
 private projectIds(v: View, id: string): string[] {
  return v.indices.projectIds.get(id)??[];
 }
 private summary(v: View, resourceId: string, archived=false): ConversationSummary {
  const key=(archived?'archived:':'active:')+resourceId,cached=v.projection?.summaries.get(key);if(cached)return cached;
  const c = v.indices.conversations.get(resourceId); check(c, 'conversation_missing');
  const r = this.resource(v, resourceId, undefined, archived), g = v.indices.headers.get(v.resourceMap[resourceId])!;
  const tail=v.graph.visibleMessageMetadata(g.id,{limit:1,maxScan:4096,maxBodyBytes:131072,tail:true,allow:m=>!m.unavailable&&this.readable(v,v.publicIds.get(m.conversationId)!,m.id,archived)}),last=tail.items[0],info=last?v.messageMetadata(last.id):null;
  const complete=tail.limitedBy===null&&(!last||info?.id===last.id),messageCount=complete?(last?.ordinal??0):null,historyMetadataStatus=complete?'complete':tail.limitedBy==='denied'?'unavailable':'limited';
  const observed=v.indices.executions.get(resourceId);
  const execution=observed?{id:observed.id,resourceId:observed.resourceId,providerId:observed.providerId,state:observed.state,commandId:observed.commandId,startedAt:observed.startedAt,endedAt:observed.endedAt,taskVerified:false as const,...(observed.errorCode?{errorCode:observed.errorCode}:{})}:undefined;
  const lastActivityAt=complete?[g.createdAt,info?.createdAt??'',execution?.startedAt??''].sort().at(-1)!:null;
  this.summaryMetadata(v);
  const result:ConversationSummary={ resourceId, conversationId: g.id, title: r.title, providerId: c.providerId, revision: c.revision, version: r.version, projectId: r.project_id ?? null, projectIds:[...this.projectIds(v,resourceId)], state: r.state ?? 'active', createdAt: g.createdAt,lastActivityAt,historyMetadataStatus,...(execution?{execution}:{}),favorite:v.indices.flags!.has(resourceId),messageCount,collectionIds:[...(v.indices.memberships!.get(resourceId)??[])] };
  v.projection?.summaries.set(key,result);return result;
 }
 private candidates(v:View,q:SearchQuery,ignoreCollection=false) {
  this.validateQuery(q);
  const family = q.familyOf ? this.family(v, q.familyOf) : null;
  const collection = !ignoreCollection && q.collectionId ? this.collections(v).find(c => c.id === q.collectionId) : null;
  if (q.collectionId && !ignoreCollection) check(collection, 'collection_missing');
  if(q.favorite)this.summaryMetadata(v);
  return v.conversations.filter(c=>{
   const r=v.indices.resources.get(c.resourceId),g=v.indices.headers.get(v.resourceMap[c.resourceId]);
   return !!r&&!!g&&(q.archived?r.state==='archived':(r.state??'active')==='active')&&(!q.providerId||c.providerId===q.providerId)&&(!family||family.has(c.resourceId))&&(!collection||collection.memberIds.includes(c.resourceId))&&(q.projectId===undefined||(q.projectId===null?this.projectIds(v,c.resourceId).length===0:this.projectIds(v,c.resourceId).includes(q.projectId)))&&(!q.favorite||v.indices.flags!.has(c.resourceId))&&(!q.after||g.createdAt>=q.after)&&(!q.before||g.createdAt<=q.before)&&this.readable(v,c.resourceId,undefined,!!q.archived);
  });
 }
 private summaries(v: View, q: SearchQuery = {}, ignoreCollection = false): ConversationSummary[] {
  return this.candidates(v,q,ignoreCollection).filter(c=>!q.text||this.matches(v,{title:v.indices.resources.get(c.resourceId)!.title,conversationId:v.resourceMap[c.resourceId]},q.text,!!q.archived)).map(c=>this.summary(v,c.resourceId,!!q.archived))
   .sort((a,b) => (q.sort==='active'?Number(!!b.execution&&['dispatching','running'].includes(b.execution.state))-Number(!!a.execution&&['dispatching','running'].includes(a.execution.state)):0)||(q.sort==='title'?a.title.localeCompare(b.title):q.sort==='created'?b.createdAt.localeCompare(a.createdAt):(b.lastActivityAt??b.createdAt).localeCompare(a.lastActivityAt??a.createdAt))||a.resourceId.localeCompare(b.resourceId));
 }
 private validateQuery(q:SearchQuery) {
  check(!q.text || typeof q.text === 'string' && q.text.length <= 1000, 'invalid_query');
  check(q.sort===undefined||['activity','created','title','active'].includes(q.sort),'invalid_sort');check(q.searchMode===undefined||['conversations','messages','resources','all'].includes(q.searchMode),'invalid_search_mode');
 }
 private matches(v: View, c: Pick<ConversationSummary,'title'|'conversationId'>, query: string, archived=false) {
  const needle = query.toLocaleLowerCase();
  return c.title.toLocaleLowerCase().includes(needle) || v.graph.visibleMessages(c.conversationId).some(m => this.readable(v, v.publicIds.get(m.conversationId)!, m.id,archived) && m.content.toLocaleLowerCase().includes(needle));
 }
 private collections(v: View): Collection[] {
  if(v.projection?.collections)return v.projection.collections;
  this.summaryMetadata(v);
  const rows = this.db.prepare("SELECT c.*, x.parent_id, x.rule, x.version AS rule_revision FROM collections c LEFT JOIN cp_collection_rules x ON x.collection_id=c.id WHERE c.state='active' ORDER BY c.title,c.id").all();
  const result=rows.filter(r => r.project_id === null || v.desktop.projects.some(p => p.id === r.project_id)).map(r => {
   const pinnedIds = (v.indices.members!.get(String(r.id))??[]).filter(id => this.readable(v,id));
   const rule = r.rule ? JSON.parse(String(r.rule)) as SearchQuery : null;
   // Membership needs matching canonical IDs, not activity/count projections.
   // Body queries remain explicit, authorized canonical reads, independently
   // measured from empty metadata browse and never indexed in another store.
   const derived = rule ? this.candidates(v,{...rule,collectionId:undefined},true).filter(c=>!rule.text||this.matches(v,{title:v.indices.resources.get(c.resourceId)!.title,conversationId:v.resourceMap[c.resourceId]},rule.text,!!rule.archived)).map(c=>c.resourceId) : [];
   return { id: String(r.id), title: String(r.title), projectId: r.project_id === null ? null : String(r.project_id), version: Number(r.version), ruleRevision:Number(r.rule_revision??0), state: String(r.state), parentId: r.parent_id ? String(r.parent_id) : null, rule, memberIds: [...new Set([...pinnedIds,...derived])], pinnedIds };
  });
  if(v.projection)v.projection.collections=result;return result;
 }
 private readProjection(v:View,name:'list'|'search'|'collections',a:SearchQuery):unknown {
  if(name==='list')return page(this.summaries(v,a),a);
  if(name==='collections')return this.collections(v);
  const needle = String(a.text ?? '').trim().toLocaleLowerCase(); check(needle.length <= 1000,'invalid_query'); const hits: SearchHit[] = [],mode=a.searchMode??(needle?'all':'conversations');check(['conversations','messages','resources','all'].includes(mode),'invalid_search_mode');
  // A conversation-only search can authorize/match first and summarize just
  // the matching IDs. It needs no activity/count scan of every non-match.
  if(mode!=='resources')for (const c of this.summaries(v,{...a,text:mode==='conversations'&&needle?needle:undefined})) {
   if (mode==='conversations'||mode==='all'&&(!needle||c.title.toLocaleLowerCase().includes(needle))) hits.push({kind:'conversation',resourceId:c.resourceId,title:c.title,excerpt:c.title,providerId:c.providerId,summary:c,sourceTime:c.lastActivityAt??undefined});
   if(needle&&(mode==='all'||mode==='messages'))for (const m of v.graph.visibleMessages(c.conversationId)) { const sourceId = v.publicIds.get(m.conversationId)!; if (!this.readable(v,sourceId,m.id,!!a.archived)) continue; const index = m.content.toLocaleLowerCase().indexOf(needle); if (index >= 0) hits.push({kind:'message',resourceId:c.resourceId,messageId:m.id,title:c.title,excerpt:m.content.slice(Math.max(0,index-60),index+160),sourceTime:m.createdAt,providerId:c.providerId}); }
  }
  const resourceCollection=a.collectionId?this.collections(v).find(c=>c.id===a.collectionId):undefined;
  if ((mode==='all'||mode==='resources')&&!a.familyOf && !a.providerId && !a.favorite) for (const r of v.desktop.resources) {
   if(r.kind==='conversation'||!this.readable(v,r.id,undefined,!!a.archived)||(a.archived?r.state!=='archived':r.state==='archived'))continue;
   const scopes=this.projectIds(v,r.id);if(a.projectId!==undefined&&(a.projectId===null?scopes.length>0:!scopes.includes(a.projectId)))continue;
   if(resourceCollection&&!resourceCollection.memberIds.includes(r.id))continue;
   const created=String(this.db.prepare('SELECT created_at FROM resources WHERE id=?').get(r.id)?.created_at??'');if(a.after&&created<a.after||a.before&&created>a.before)continue;
   const content=needle?r.title+'\n'+v.resourceContent(r.id):r.title,index=content.toLocaleLowerCase().indexOf(needle);if(index>=0)hits.push({kind:'resource',resourceId:r.id,title:r.title,excerpt:content.slice(Math.max(0,index-60),index+160)});
  }
  return page(hits,a);
 }
 private policy(id: string): BranchPolicy {
  const row = this.db.prepare('SELECT json FROM cp_policy WHERE resource_id=?').get(id);
  return row ? JSON.parse(String(row.json)) : { resourceId: id, revision: 0, mode: 'independent', allowedSourceIds: [], allowCrossProject: false, maxSensitivity: 'internal', categories: [...evidence] };
 }
 private share(v: View, row: Record<string, any>, targetId?: string, includeContent = false): Share {
  const id = String(row.id), sourceId = String(row.source_resource_id), messageId = String(row.source_message_id);
  let status: Share['status'] = row.revoked ? 'revoked' : 'current', content: string | undefined;
  const supersededBy=this.db.prepare('SELECT id FROM cp_shares WHERE supersedes=? ORDER BY created_at,id').all(id).map(r=>String(r.id));
  if(status==='current'&&supersededBy.length)status='superseded';
  if (!this.readable(v, sourceId, messageId)) status = 'unavailable';
  if (status === 'current') { try { const m = this.message(v,sourceId,messageId); if (hash(m.content) !== row.digest) status = 'stale'; else if (includeContent) content = m.content.slice(Number(row.start),Number(row.end)); } catch { status='unavailable'; } }
  const a = targetId ? this.db.prepare('SELECT * FROM cp_adoptions WHERE share_id=? AND target_id=?').get(id,targetId) : undefined;
  return { id, sourceResourceId: sourceId, sourceMessageId: messageId, sourceTime: String(row.source_time), digest: String(row.digest), range: { start: Number(row.start), end: Number(row.end) }, evidence: row.evidence, createdAt: String(row.created_at), supersedes: row.supersedes ? String(row.supersedes) : null, supersededBy, status, state: a?.sent_at ? 'sent' : a?.attached_at ? 'attached' : a?.inspected_at ? 'inspected' : 'discoverable', attached:!!a?.attached_at, ...(targetId ? { targetResourceId:targetId } : {}), ...(a?.execution_id ? { executionId:String(a.execution_id) } : {}), ...(content === undefined ? {} : {content}) };
 }
 private allowedShare(v: View, row: Record<string,any>, target: string) {
  this.resource(v,target); this.resource(v,String(row.source_resource_id),String(row.source_message_id));
  const p = this.policy(target), sourcePolicy = this.policy(String(row.source_resource_id));
  check(this.family(v,target).has(String(row.source_resource_id)), 'outside_branch_family');
  check(!p.allowedSourceIds.length || p.allowedSourceIds.includes(String(row.source_resource_id)), 'source_scope_denied');
  const sourceScopes=this.projectIds(v,String(row.source_resource_id)),targetScopes=this.projectIds(v,target);
  check(JSON.stringify(sourceScopes)===JSON.stringify(targetScopes) || p.allowCrossProject && sourcePolicy.allowCrossProject, 'cross_project_sharing_denied');
  const m = this.message(v,String(row.source_resource_id),String(row.source_message_id));
  const ranks: Record<string,number> = {public:0,internal:1,sensitive:2,restricted:3};
  check(ranks[m.sensitivity] <= Math.min(ranks[p.maxSensitivity],ranks[sourcePolicy.maxSensitivity]) && m.sensitivity !== 'restricted', 'sensitivity_denied');
  check(p.categories.includes(row.evidence) && sourcePolicy.categories.includes(row.evidence), 'category_denied');
  const s = this.share(v,row,target); check(s.status === 'current','source_' + s.status); return s;
 }
 /** Trusted canonical host only, absent from RPC/tool command maps. Metadata
  * comes from the current canonical source, never a renderer's sensitivity. */
 private contextSources(v:View,target:string,sources:readonly {resourceId:string;messageId:string;sensitivity:string;evidence?:Evidence}[]) {
  this.resource(v,target);const p=this.policy(target),family=this.family(v,target),ranks:Record<string,number>={public:0,internal:1,sensitive:2,restricted:3};
  for(const source of sources){
   this.resource(v,source.resourceId,source.messageId);check(family.has(source.resourceId),'outside_branch_family');check(!p.allowedSourceIds.length||p.allowedSourceIds.includes(source.resourceId),'source_scope_denied');
   const sp=this.policy(source.resourceId);check(JSON.stringify(this.projectIds(v,source.resourceId))===JSON.stringify(this.projectIds(v,target))||p.allowCrossProject&&sp.allowCrossProject,'cross_project_sharing_denied');
   check(ranks[source.sensitivity]!==undefined&&ranks[source.sensitivity]<=Math.min(ranks[p.maxSensitivity],ranks[sp.maxSensitivity])&&source.sensitivity!=='restricted','sensitivity_denied');check(p.categories.includes(source.evidence??'excerpt')&&sp.categories.includes(source.evidence??'excerpt'),'category_denied');
  }
 }
 async authorizeContextSources(target:string,sources:readonly {resourceId:string;messageId:string;sensitivity:string}[]):Promise<void> {this.contextSources(await this.view(),target,sources);}
 /** Final synchronous host fence after async credentials/context preparation. */
 nativeAuthorizeContextSources(target:string,sources:readonly {resourceId:string;messageId:string;sensitivity:string;evidence?:Evidence}[]):void {
  check(this.host.canonicalReadBatch,'canonical_read_batch_required');this.host.canonicalReadBatch(view=>this.contextSources(this.indexed(view,true),target,sources));
 }
 private async providers(v: View): Promise<ProviderCapability[]> {
  let live: CommandMap['capabilities']['output'] | undefined; try { live = this.host.capabilitySnapshot ? this.host.capabilitySnapshot() : await this.host.command('capabilities',{}); } catch { /* catalog is not proof of a connected provider */ }
  const local = v.graphMetadata.providers.find(p => p.id === 'local') ?? v.graphMetadata.providers.find(p=>p.id==='mock-ordinary');
  const items: ProviderCapability[] = [{ id: local?.id ?? 'local', label: 'Local conversation', available: true, record: true, execute: false, nativeFork:false, history:'local', simulated:false, models:[] }];
  const codex = v.graphMetadata.providers.find(p=>p.id==='codex-app-server')??v.graphMetadata.providers.find(p=>p.id==='fixture-codex');
  const observed=!!codex&&live?.providerId===codex.id,authenticated=observed&&live?.authentication==='available',simulated=observed?live!.mock:!!codex?.mock;
  if (codex) items.push({id:codex.id,label:simulated ? 'Codex fixture (simulated)' : 'Codex',available:authenticated,record:true,execute:authenticated,nativeFork:false,history:'local',simulated,models:observed?live!.models:[],reason:authenticated?'Connected and authenticated; model catalog only. Execution outcomes are recorded per turn.':'Provider disconnected or authentication unavailable'});
  const accountFidelity=createNativeChatGPTFidelityDescriptor();
  const registry=this.host.providerRegistrySnapshot?.();
  for(const provider of registry?.providers??[])if(provider.id==='chatgpt-plan-responses')items.push({...structuredClone(provider),...(registry?.defaultProviderId===provider.id?{default:true}:{})});
  items.push({id:'chatgpt',label:'ChatGPT account history',available:false,record:false,execute:false,nativeFork:false,history:'unavailable',reason:accountFidelity.reason,reasonCode:accountFidelity.reasonCode,accountFidelity,simulated:false,models:[]});
  return items;
 }
 async attachedContext(resourceId: string): Promise<AttachedContext[]> {
  const v = await this.view(); this.resource(v,resourceId);
  return this.db.prepare('SELECT s.* FROM cp_shares s JOIN cp_adoptions a ON a.share_id=s.id WHERE a.target_id=? AND a.attached_at IS NOT NULL ORDER BY s.created_at,s.id').all(resourceId).map(row => { this.allowedShare(v,row,resourceId); const s = this.share(v,row,resourceId,true); return {shareId:s.id,sourceResourceId:s.sourceResourceId,sourceMessageId:s.sourceMessageId,digest:s.digest,evidence:s.evidence,content:s.content!}; });
 }
 /** Trusted host path only; never exposed through renderer commands. */
 async confirmSupplied(resourceId: string, shareId: string, executionId: string): Promise<void> {
  const v = await this.view(), row = this.db.prepare('SELECT * FROM cp_shares WHERE id=?').get(shareId); check(row,'share_missing');
  const s = this.allowedShare(v,row,resourceId); check(this.host.contextReceipt?.(executionId,resourceId,shareId,s.digest) === true,'execution_context_receipt_required');
  const result = this.db.prepare('UPDATE cp_adoptions SET sent_at=?,execution_id=? WHERE share_id=? AND target_id=? AND attached_at IS NOT NULL').run(stamp(),executionId,shareId,resourceId); check(Number(result.changes) === 1,'share_not_attached');
 }
 async command<K extends keyof ProductCommandMap>(name: K, input: ProductCommandMap[K]['input']): Promise<ProductCommandMap[K]['output']> {
  const a = input as any;
  if(this.host.canonicalReadBatch&&(name==='list'||name==='search'||name==='collections'||name==='readViewState')){
   const result=this.host.canonicalReadBatch(view=>name==='readViewState'?this.readViewState(this.indexed(view,true),a):this.readProjection(this.indexed(view,true),name,a));
   check(!result||typeof (result as {then?:unknown}).then!=='function','synchronous_canonical_callback_required');
   return result as ProductCommandMap[K]['output'];
  }
  const v = await this.view(); let result: unknown;
  switch(name) {
   case 'list': case 'search': case 'collections': result=this.readProjection(v,name,a);break;
   case 'detail': {
    this.resource(v,a.resourceId,undefined,true); const c = this.summary(v,a.resourceId,true), all = v.graph.visibleMessages(c.conversationId).filter(m => this.readable(v,v.publicIds.get(m.conversationId)!,m.id,true)).map(m => ({id:m.id,resourceId:v.publicIds.get(m.conversationId)!,role:m.role,content:m.content,createdAt:m.createdAt,provenance:m.provenance,inherited:m.conversationId!==c.conversationId,sensitivity:m.sensitivity,...v.messageEvidence?.[m.id]}));
    const around = a.aroundMessageId ? all.findIndex(m => m.id === a.aroundMessageId) : -1; if (a.aroundMessageId) check(around>=0,'message_unavailable');
    const family=this.family(v,a.resourceId); const lineage=v.graphMetadata.edges.filter(e=>family.has(v.publicIds.get(e.parentId)!)&&this.readable(v,v.publicIds.get(e.parentId)!)&&this.readable(v,v.publicIds.get(e.childId)!)).filter(e=>{if(v.graphMetadata.unavailableMessageIds.includes(e.sourceMessageId))return false;const source=v.messageMetadata(e.sourceMessageId);return !!source&&this.readable(v,v.publicIds.get(source.conversationId)!,e.sourceMessageId);}).map(e=>({id:e.id,parentResourceId:v.publicIds.get(e.parentId)!,childResourceId:v.publicIds.get(e.childId)!,sourceMessageId:e.sourceMessageId,mode:e.mode,createdAt:e.createdAt}));
    result={conversation:{...c,messageCount:all.length},messages:page<MessageView>(all,{...a,...(around>=0?{offset:Math.max(0,around-Math.min(10,Math.floor((a.limit??50)/2)))}:{})}),lineage,policy:this.policy(a.resourceId),shares:this.db.prepare('SELECT * FROM cp_shares WHERE source_resource_id=? OR id IN(SELECT share_id FROM cp_adoptions WHERE target_id=?)').all(a.resourceId,a.resourceId).map(row=>this.share(v,row,a.resourceId)),providers:await this.providers(v)} satisfies Detail; break;
   }
   case 'readDraft': this.draftResource(v,a.resourceId);result=this.draft(a.resourceId);break;
   case 'saveDraft': result=this.saveDraft(v,a);break;
   case 'readViewState': result=this.tx(()=>this.readViewState(v,a));break;
   case 'saveViewState': result=this.saveViewState(v,a);break;
   case 'selectView': result=this.selectView(v,a);break;
   case 'projects': result=v.desktop.projects;break;
   case 'organize': {
    if (a.resourceId) this.resource(v,a.resourceId,undefined,true);
    if (a.projectId) check(v.desktop.projects.some(p=>p.id===a.projectId),'project_unavailable');
    if (a.title!==undefined) text(a.title);
    result=await this.host.organize(a); break;
   }
   case 'collectionRule': {
    // Rule/header validation must not run every existing smart content query.
    const headers=this.db.prepare("SELECT c.id,c.version,c.project_id,x.parent_id,COALESCE(x.version,0) AS rule_revision FROM collections c LEFT JOIN cp_collection_rules x ON x.collection_id=c.id WHERE c.state='active'").all().filter(c=>c.project_id===null||v.desktop.projects.some(p=>p.id===c.project_id)),byId=new Map(headers.map(c=>[String(c.id),c]));
    const collection=byId.get(a.collectionId); check(collection,'collection_missing'); check(collection.version===a.expectedVersion,'stale_collection_version');check(collection.rule_revision===a.expectedRuleRevision,'stale_collection_rule');
    check(a.rule===null || typeof a.rule==='object' && !Array.isArray(a.rule) && !a.rule.collectionId,'invalid_collection_rule');
    const allowedKeys=['text','projectId','familyOf','providerId','favorite','archived','after','before','searchMode']; check(a.rule===null || Object.keys(a.rule).every(k=>allowedKeys.includes(k))&&(a.rule.searchMode===undefined||a.rule.searchMode==='conversations'),'unsupported_collection_filter');
    if (a.rule){this.validateQuery(a.rule);if(a.rule.familyOf)this.family(v,a.rule.familyOf);}
    let parent=a.parentId, seen=new Set([a.collectionId]); while(parent) { check(!seen.has(parent),'folder_cycle'); seen.add(parent); const c=byId.get(parent); check(c,'parent_collection_missing'); parent=c.parent_id; }
    this.tx(()=>{const current=this.db.prepare("SELECT version FROM collections WHERE id=? AND state='active'").get(a.collectionId);check(current?.version===a.expectedVersion,'stale_collection_version');const revision=Number(this.db.prepare('SELECT version FROM cp_collection_rules WHERE collection_id=?').get(a.collectionId)?.version??0);check(revision===a.expectedRuleRevision,'stale_collection_rule');this.db.prepare('INSERT INTO cp_collection_rules VALUES(?,?,?,1) ON CONFLICT(collection_id) DO UPDATE SET parent_id=excluded.parent_id,rule=excluded.rule,version=cp_collection_rules.version+1').run(a.collectionId,a.parentId,a.rule===null?null:JSON.stringify(a.rule)); this.audit('collection.rule',a.collectionId); });
    result=this.host.canonicalReadBatch?this.host.canonicalReadBatch(view=>this.collections(this.indexed(view,true))):this.collections(v);break;
   }
   case 'favorite': this.resource(v,a.resourceId);result=this.favorite(a);break;
   case 'providers': result=await this.providers(v);break;
   case 'create': {const title=a.title===undefined||typeof a.title==='string'&&!a.title.trim()?'New conversation':text(a.title);if(a.providerId)check((await this.providers(v)).find(p=>p.id===a.providerId)?.record,'provider_unavailable');result=await this.host.command('createConversation',{...a,title});break;}
   case 'archive': this.resource(v,a.resourceId,undefined,true);result=await this.host.command('desktop',{type:'archiveSubject',kind:'resource',id:a.resourceId,expectedVersion:a.expectedVersion,archived:a.archived});break;
   case 'selectProvider': this.resource(v,a.resourceId);check((await this.providers(v)).some(p=>p.id===a.providerId&&p.available),'provider_unavailable');result=await this.host.command('selectProvider',a);break;
   case 'send': {
    this.resource(v,a.resourceId);text(a.content,16384);const c=this.summary(v,a.resourceId);check(c.revision===a.expectedRevision,'stale_resource_version');
    const p=(await this.providers(v)).find(p=>p.id===c.providerId);check(p?.available,'provider_unavailable');
    if (!p.execute) result=await this.host.command('addMessage',{resourceId:a.resourceId,role:'user',content:a.content,expectedRevision:a.expectedRevision,...{commandId:a.commandId}});
    else { const context=await this.attachedContext(a.resourceId); if(this.host.sendWithContext) result=await this.host.sendWithContext(a,context); else {check(context.length===0,'attachment_transport_unavailable');result=await this.host.command('execute',{resourceId:a.resourceId,prompt:a.content,commandId:a.commandId,model:a.model,authorized:true});} }
    break;
   }
   case 'branch': {
    const c=this.summary(v,a.resourceId);check(c.revision===a.expectedRevision,'stale_resource_version');check(Array.isArray(a.includeMessageIds)&&a.includeMessageIds.length>0,'explicit_source_selection_required');for(const id of a.includeMessageIds)this.message(v,a.resourceId,id);this.message(v,a.resourceId,a.messageId);
    check((await this.providers(v)).some(p=>p.id===a.providerId&&p.record),'provider_unavailable');const b=await this.host.command('branch',a);result={resourceId:b.conversation.resourceId,handoffId:b.handoff.id,fingerprint:b.handoff.fingerprint,mode:b.mode};break;
   }
   case 'reviewBranch': result=await this.host.command('review',a);break;
   case 'policy': {
    this.resource(v,a.resourceId);const previous=this.policy(a.resourceId);check(previous.revision===a.expectedRevision,'stale_policy_version');
    check(['independent','connected','collaborative'].includes(a.mode)&&['public','internal','sensitive'].includes(a.maxSensitivity)&&typeof a.allowCrossProject==='boolean'&&Array.isArray(a.allowedSourceIds)&&Array.isArray(a.categories)&&a.categories.every((x:Evidence)=>evidence.includes(x)),'invalid_policy');for(const id of a.allowedSourceIds)this.resource(v,id);
    const p:BranchPolicy={resourceId:a.resourceId,revision:previous.revision+1,mode:a.mode,allowedSourceIds:[...new Set(a.allowedSourceIds)] as string[],allowCrossProject:a.allowCrossProject,maxSensitivity:a.maxSensitivity,categories:[...new Set(a.categories)] as Evidence[]};
    this.tx(()=>{const current=this.policy(a.resourceId);check(current.revision===a.expectedRevision,'stale_policy_version');this.db.prepare('INSERT INTO cp_policy VALUES(?,?,?) ON CONFLICT(resource_id) DO UPDATE SET revision=excluded.revision,json=excluded.json').run(a.resourceId,p.revision,JSON.stringify(p));this.audit('branch.policy',a.resourceId);});result=p;break;
   }
   case 'publish': {
    const m=this.message(v,a.sourceResourceId,a.sourceMessageId);check(evidence.includes(a.evidence),'invalid_evidence');check(m.sensitivity!=='restricted'&&(m.sensitivity!=='sensitive'||a.allowSensitive===true),'sensitive_source_requires_consent');
    const range=a.range??{start:0,end:m.content.length};check(Number.isInteger(range.start)&&Number.isInteger(range.end)&&range.start>=0&&range.end>range.start&&range.end<=m.content.length&&range.end-range.start<=16384,'invalid_source_range');
    if(a.supersedes){const old=this.db.prepare('SELECT source_resource_id FROM cp_shares WHERE id=?').get(a.supersedes);check(old?.source_resource_id===a.sourceResourceId,'invalid_supersedes');}
    const id=randomUUID();this.tx(()=>{this.db.prepare('INSERT INTO cp_shares VALUES(?,?,?,?,?,?,?,?,?,0,?)').run(id,a.sourceResourceId,m.id,m.createdAt,hash(m.content),range.start,range.end,a.evidence,stamp(),a.supersedes??null);this.audit('share.publish',id);});result=this.share(v,this.db.prepare('SELECT * FROM cp_shares WHERE id=?').get(id)!);break;
   }
   case 'discover': {
    this.resource(v,a.resourceId);const needle=String(a.text??'').toLocaleLowerCase();check(needle.length<=1000,'invalid_query');result=this.db.prepare('SELECT * FROM cp_shares WHERE revoked=0 ORDER BY created_at,id').all().flatMap(row=>{try{const s=this.allowedShare(v,row,a.resourceId);const inspected=this.share(v,row,a.resourceId,true);return !needle||inspected.content!.toLocaleLowerCase().includes(needle)?[s]:[];}catch{return [];}});break;
   }
   case 'inspectShare': case 'attachShare': {
    const row=this.db.prepare('SELECT * FROM cp_shares WHERE id=?').get(a.shareId);check(row,'share_missing');this.allowedShare(v,row,a.resourceId);
    if(name==='attachShare'){check(typeof a.attach==='boolean','invalid_attachment');const adoption=this.db.prepare('SELECT inspected_at FROM cp_adoptions WHERE share_id=? AND target_id=?').get(a.shareId,a.resourceId);check(adoption?.inspected_at,'inspect_before_attachment');}
    this.tx(()=>{this.db.prepare('INSERT OR IGNORE INTO cp_adoptions(share_id,target_id) VALUES(?,?)').run(a.shareId,a.resourceId);if(name==='inspectShare')this.db.prepare('UPDATE cp_adoptions SET inspected_at=? WHERE share_id=? AND target_id=?').run(stamp(),a.shareId,a.resourceId);else this.db.prepare('UPDATE cp_adoptions SET attached_at=? WHERE share_id=? AND target_id=?').run(a.attach?stamp():null,a.shareId,a.resourceId);this.audit(name,a.shareId);});result=this.share(v,row,a.resourceId,name==='inspectShare');break;
   }
   case 'revokeShare': {const row=this.db.prepare('SELECT * FROM cp_shares WHERE id=?').get(a.shareId);check(row,'share_missing');this.resource(v,String(row.source_resource_id));this.tx(()=>{this.db.prepare('UPDATE cp_shares SET revoked=1 WHERE id=?').run(a.shareId);this.db.prepare('UPDATE cp_adoptions SET attached_at=NULL WHERE share_id=?').run(a.shareId);this.audit('share.revoke',a.shareId);});result=null;break;}
   case 'export': {
    const detail=await this.command('detail',{resourceId:a.resourceId,limit:200});
    const current=await this.view();this.resource(current,a.resourceId,undefined,true);
    const gid=current.resourceMap[a.resourceId];check(gid,'conversation_missing');
    const items=current.graph.visibleMessages(gid).filter(m=>this.readable(current,current.publicIds.get(m.conversationId)!,m.id,true)).map(m=>({id:m.id,resourceId:current.publicIds.get(m.conversationId)!,role:m.role,content:m.content,createdAt:m.createdAt,provenance:m.provenance,inherited:m.conversationId!==gid,sensitivity:m.sensitivity,...current.messageEvidence?.[m.id]}));
    result={format:'aerynth.conversation-export@1',detail:{...detail,messages:{items,total:items.length,offset:0,limit:items.length,hasMore:false}}};break;
   }
   default: throw new ProductError('unsupported_product_command');
  }
  return result as ProductCommandMap[K]['output'];
 }
}
