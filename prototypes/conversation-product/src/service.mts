import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { ConversationGraph, type Message } from '../../connected-conversations/src/graph.ts';
import type { Snapshot, CommandMap } from '../../integrated-backend/src/contracts.mts';
import type { DesktopSnapshot } from '../../application-contract/contracts.ts';
import type { BranchPolicy, CanonicalOrganizationCommand, Collection, ConversationProductPort, ConversationSummary, Detail, Evidence, MessageView, Page, ProductCommandMap, ProviderCapability, SearchHit, SearchQuery, Share } from './contracts.ts';
import { CONVERSATION_DRAFT_LIMITS, type ConversationDraft } from './contracts.ts';

export interface CanonicalConversationHost {
 snapshot(): Promise<Snapshot>;
 desktop(): Promise<DesktopSnapshot>;
 command<K extends keyof CommandMap>(name: K, input: CommandMap[K]['input']): Promise<CommandMap[K]['output']>;
 organize(input: CanonicalOrganizationCommand): Promise<unknown>;
 /** Optional side-effect-free catalog, so reading local history never starts a connection. */
 capabilitySnapshot?(): CommandMap['capabilities']['output'] | undefined;
 /** Host policy authority: connections/family membership never grant access. */
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
const page = <T,>(items: T[], q: { offset?: number; limit?: number }): Page<T> => {
 const offset = q.offset ?? 0, limit = q.limit ?? 50;
 check(Number.isInteger(offset) && offset >= 0 && Number.isInteger(limit) && limit > 0 && limit <= 200, 'invalid_page');
 return { items: items.slice(offset, offset + limit), total: items.length, offset, limit, hasMore: offset + limit < items.length };
};
type View = { snapshot: Snapshot; desktop: DesktopSnapshot; graph: ConversationGraph; publicIds: Map<string, string> };

/** Additive metadata on the injected canonical connection. Never opens/closes/resets a DB. */
export class ConversationProduct implements ConversationProductPort {
 private db: DatabaseSync;
 private host: CanonicalConversationHost;
 constructor(db: DatabaseSync, host: CanonicalConversationHost) {
  this.db=db;this.host=host;
  this.tx(() => {
   const installed=!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='cp_schema'").get();
   if(installed){const versions=db.prepare('SELECT id,version FROM cp_schema').all();check(versions.length===1&&versions[0].id===1&&(versions[0].version===1||versions[0].version===2),'unsupported_conversation_product_schema');}
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
 private async view(): Promise<View> {
  // Sequential reads share the backend's owning command queue. Access is checked again below.
  const snapshot = await this.host.snapshot(), desktop = await this.host.desktop();
  return { snapshot, desktop, graph: new ConversationGraph([], snapshot.graph), publicIds: new Map(Object.entries(snapshot.resourceMap).map(([rid, gid]) => [gid, rid])) };
 }
 private resource(v: View, id: string, messageId?: string, archived = false) {
  const r = v.desktop.resources.find(r => r.id === id);
  check(r && (archived || r.visible !== false && r.available !== false) && this.host.access?.(id, messageId) !== false, 'source_unavailable');
  // Archived content is accessible only through an explicit host authorization, never merely a surviving placement.
  if (r.visible === false || r.available === false) check(archived && this.host.access?.(id, messageId) === true, 'source_unavailable');
  if (messageId) check(!v.snapshot.graph.unavailableMessageIds.includes(messageId), 'source_revoked');
  return r;
 }
 private readable(v: View, id: string, messageId?: string, archived = false) { try { this.resource(v, id, messageId, archived); return true; } catch { return false; } }
 private draftResource(v: View, id: string) {
  const r=this.resource(v,id),canonical=this.db.prepare('SELECT kind,state FROM resources WHERE id=?').get(id);
  check(r.kind==='conversation'&&(r.state===undefined||r.state==='active')&&canonical?.kind==='conversation'&&canonical.state==='active'&&!!v.snapshot.resourceMap[id]&&v.snapshot.conversations.some(c=>c.resourceId===id),'source_unavailable');
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
 private message(v: View, resourceId: string, messageId: string): Message {
  this.resource(v, resourceId, messageId);
  const gid = v.snapshot.resourceMap[resourceId]; check(gid, 'conversation_missing');
  const m = v.graph.visibleMessages(gid).find(m => m.id === messageId); check(m, 'message_missing');
  const sourceId = v.publicIds.get(m.conversationId); check(sourceId, 'source_unavailable'); this.resource(v, sourceId, m.id);
  return m;
 }
 private family(v: View, id: string): Set<string> {
  check(v.snapshot.resourceMap[id], 'conversation_missing');
  const ids = new Set([v.snapshot.resourceMap[id]]); let expanded = true;
  while (expanded) { expanded = false; for (const e of v.snapshot.graph.edges) if (ids.has(e.parentId) || ids.has(e.childId)) { if (!ids.has(e.parentId) || !ids.has(e.childId)) expanded = true; ids.add(e.parentId); ids.add(e.childId); } }
  return new Set([...ids].map(gid => v.publicIds.get(gid)!).filter(Boolean));
 }
 private projectIds(v: View, id: string): string[] {
  const resource=v.desktop.resources.find(r=>r.id===id);
  if(resource?.project_id)return [resource.project_id];
  // Legacy records can lack primary ownership while their canonical placements
  // remain project-scoped. Referencing a placement does not change that record.
  const workspaces=new Set(v.desktop.blocks.filter(b=>b.resource_id===id).map(b=>b.workspace_id));
  return [...new Set(v.desktop.workspaces.filter(w=>workspaces.has(w.id)&&w.project_id).map(w=>w.project_id!))].sort();
 }
 private summary(v: View, resourceId: string): ConversationSummary {
  const c = v.snapshot.conversations.find(c => c.resourceId === resourceId); check(c, 'conversation_missing');
  const r = this.resource(v, resourceId, undefined, true), g = v.snapshot.graph.conversations.find(g => g.id === v.snapshot.resourceMap[resourceId])!;
  return { resourceId, conversationId: g.id, title: r.title, providerId: c.providerId, revision: c.revision, version: r.version, projectId: r.project_id ?? null, projectIds:this.projectIds(v,resourceId), state: r.state ?? 'active', createdAt: g.createdAt, favorite: this.db.prepare('SELECT favorite FROM cp_flags WHERE resource_id=?').get(resourceId)?.favorite === 1, messageCount: v.graph.visibleMessages(g.id).filter(m => this.readable(v, v.publicIds.get(m.conversationId)!, m.id,true)).length, collectionIds: this.db.prepare('SELECT collection_id FROM collection_members WHERE resource_id=?').all(resourceId).map(row => String(row.collection_id)) };
 }
 private summaries(v: View, q: SearchQuery = {}, ignoreCollection = false): ConversationSummary[] {
  check(!q.text || typeof q.text === 'string' && q.text.length <= 1000, 'invalid_query');
  const family = q.familyOf ? this.family(v, q.familyOf) : null;
  const collection = !ignoreCollection && q.collectionId ? this.collections(v).find(c => c.id === q.collectionId) : null;
  if (q.collectionId && !ignoreCollection) check(collection, 'collection_missing');
  return v.snapshot.conversations.filter(c => this.readable(v, c.resourceId, undefined, !!q.archived)).map(c => this.summary(v, c.resourceId)).filter(c =>
   (q.archived ? c.state === 'archived' : c.state === 'active') &&
   (q.projectId === undefined || (q.projectId===null?c.projectIds.length===0:c.projectIds.includes(q.projectId))) && (!q.providerId || c.providerId === q.providerId) && (!q.favorite || c.favorite) &&
   (!q.after || c.createdAt >= q.after) && (!q.before || c.createdAt <= q.before) && (!family || family.has(c.resourceId)) &&
   (!collection || collection.memberIds.includes(c.resourceId)) && (!q.text || this.matches(v, c, q.text,!!q.archived)))
   .sort((a,b) => b.createdAt.localeCompare(a.createdAt) || a.resourceId.localeCompare(b.resourceId));
 }
 private matches(v: View, c: ConversationSummary, query: string, archived=false) {
  const needle = query.toLocaleLowerCase();
  return c.title.toLocaleLowerCase().includes(needle) || v.graph.visibleMessages(c.conversationId).some(m => this.readable(v, v.publicIds.get(m.conversationId)!, m.id,archived) && m.content.toLocaleLowerCase().includes(needle));
 }
 private collections(v: View): Collection[] {
  const rows = this.db.prepare("SELECT c.*, x.parent_id, x.rule, x.version AS rule_revision FROM collections c LEFT JOIN cp_collection_rules x ON x.collection_id=c.id WHERE c.state='active' ORDER BY c.title,c.id").all();
  return rows.filter(r => r.project_id === null || v.desktop.projects.some(p => p.id === r.project_id)).map(r => {
   const pinnedIds = this.db.prepare('SELECT resource_id FROM collection_members WHERE collection_id=?').all(r.id).map(m => String(m.resource_id)).filter(id => this.readable(v,id));
   const rule = r.rule ? JSON.parse(String(r.rule)) as SearchQuery : null;
   const derived = rule ? this.summaries(v, { ...rule, collectionId: undefined }, true).map(c => c.resourceId) : [];
   return { id: String(r.id), title: String(r.title), projectId: r.project_id === null ? null : String(r.project_id), version: Number(r.version), ruleRevision:Number(r.rule_revision??0), state: String(r.state), parentId: r.parent_id ? String(r.parent_id) : null, rule, memberIds: [...new Set([...pinnedIds,...derived])], pinnedIds };
  });
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
 private async providers(v: View): Promise<ProviderCapability[]> {
  let live: CommandMap['capabilities']['output'] | undefined; try { live = this.host.capabilitySnapshot ? this.host.capabilitySnapshot() : await this.host.command('capabilities',{}); } catch { /* catalog is not proof of a connected provider */ }
  const local = v.snapshot.graph.providers.find(p => p.id === 'local') ?? v.snapshot.graph.providers.find(p=>p.id==='mock-ordinary');
  const items: ProviderCapability[] = [{ id: local?.id ?? 'local', label: 'Local conversation', available: true, record: true, execute: false, nativeFork:false, history:'local', simulated:false, models:[] }];
  const codex = v.snapshot.graph.providers.find(p => p.id !== local?.id && p.id!=='mock-ordinary' && p.id!=='local');
  const authenticated=live?.authentication==='available';
  if (codex) items.push({id:codex.id,label:live?.mock ? 'Codex fixture (simulated)' : 'Codex',available:authenticated,record:true,execute:authenticated,nativeFork:false,history:'local',simulated:live?.mock ?? codex.mock,models:live?.models ?? [],reason:authenticated?'Connected and authenticated; model catalog only. Execution outcomes are recorded per turn.':'Provider disconnected or authentication unavailable'});
  items.push({id:'chatgpt',label:'ChatGPT account history',available:false,record:false,execute:false,nativeFork:false,history:'unavailable',reason:'No supported account-history connector is installed',simulated:false,models:[]});
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
  const a = input as any, v = await this.view(); let result: unknown;
  switch(name) {
   case 'list': result = page(this.summaries(v,a),a); break;
   case 'search': {
    const needle = String(a.text ?? '').toLocaleLowerCase(); check(needle.length <= 1000,'invalid_query'); const hits: SearchHit[] = [];
    for (const c of this.summaries(v,{...a,text:undefined})) {
     if (!needle || c.title.toLocaleLowerCase().includes(needle)) hits.push({kind:'conversation',resourceId:c.resourceId,title:c.title,excerpt:c.title});
     for (const m of v.graph.visibleMessages(c.conversationId)) { const sourceId = v.publicIds.get(m.conversationId)!; if (!this.readable(v,sourceId,m.id,!!a.archived)) continue; const index = m.content.toLocaleLowerCase().indexOf(needle); if (needle && index >= 0) hits.push({kind:'message',resourceId:c.resourceId,messageId:m.id,title:c.title,excerpt:m.content.slice(Math.max(0,index-60),index+160),sourceTime:m.createdAt}); }
    }
    const resourceCollection=a.collectionId?this.collections(v).find(c=>c.id===a.collectionId):undefined;
    if (!a.familyOf && !a.providerId && !a.favorite) for (const r of v.desktop.resources) {
     if(r.kind==='conversation'||!this.readable(v,r.id,undefined,!!a.archived)||(a.archived?r.state!=='archived':r.state==='archived'))continue;
     const scopes=this.projectIds(v,r.id);if(a.projectId!==undefined&&(a.projectId===null?scopes.length>0:!scopes.includes(a.projectId)))continue;
     if(resourceCollection&&!resourceCollection.memberIds.includes(r.id))continue;
     const created=String(this.db.prepare('SELECT created_at FROM resources WHERE id=?').get(r.id)?.created_at??'');if(a.after&&created<a.after||a.before&&created>a.before)continue;
     const content=r.title+'\n'+r.content,index=content.toLocaleLowerCase().indexOf(needle);if(index>=0)hits.push({kind:'resource',resourceId:r.id,title:r.title,excerpt:content.slice(Math.max(0,index-60),index+160)});
    }
    result=page(hits,a); break;
   }
   case 'detail': {
    this.resource(v,a.resourceId,undefined,true); const c = this.summary(v,a.resourceId), all = v.graph.visibleMessages(c.conversationId).filter(m => this.readable(v,v.publicIds.get(m.conversationId)!,m.id,true)).map(m => ({id:m.id,resourceId:v.publicIds.get(m.conversationId)!,role:m.role,content:m.content,createdAt:m.createdAt,provenance:m.provenance,inherited:m.conversationId!==c.conversationId,sensitivity:m.sensitivity}));
    const around = a.aroundMessageId ? all.findIndex(m => m.id === a.aroundMessageId) : -1; if (a.aroundMessageId) check(around>=0,'message_unavailable');
    const family=this.family(v,a.resourceId); const lineage=v.snapshot.graph.edges.map(e=>({id:e.id,parentResourceId:v.publicIds.get(e.parentId)!,childResourceId:v.publicIds.get(e.childId)!,sourceMessageId:e.sourceMessageId,mode:e.mode,createdAt:e.createdAt})).filter(e=>family.has(e.parentResourceId)&&this.readable(v,e.parentResourceId)&&this.readable(v,e.childResourceId));
    result={conversation:c,messages:page<MessageView>(all,{...a,...(around>=0?{offset:Math.max(0,around-Math.min(10,Math.floor((a.limit??50)/2)))}:{})}),lineage,policy:this.policy(a.resourceId),shares:this.db.prepare('SELECT * FROM cp_shares WHERE source_resource_id=? OR id IN(SELECT share_id FROM cp_adoptions WHERE target_id=?)').all(a.resourceId,a.resourceId).map(row=>this.share(v,row,a.resourceId)),providers:await this.providers(v)} satisfies Detail; break;
   }
   case 'readDraft': this.draftResource(v,a.resourceId);result=this.draft(a.resourceId);break;
   case 'saveDraft': result=this.saveDraft(v,a);break;
   case 'collections': result=this.collections(v); break;
   case 'projects': result=v.desktop.projects;break;
   case 'organize': {
    if (a.resourceId) this.resource(v,a.resourceId,undefined,true);
    if (a.projectId) check(v.desktop.projects.some(p=>p.id===a.projectId),'project_unavailable');
    if (a.title!==undefined) text(a.title);
    result=await this.host.organize(a); break;
   }
   case 'collectionRule': {
    const collection=this.collections(v).find(c=>c.id===a.collectionId); check(collection,'collection_missing'); check(collection.version===a.expectedVersion,'stale_collection_version');check(collection.ruleRevision===a.expectedRuleRevision,'stale_collection_rule');
    check(a.rule===null || typeof a.rule==='object' && !Array.isArray(a.rule) && !a.rule.collectionId,'invalid_collection_rule');
    const allowedKeys=['text','projectId','familyOf','providerId','favorite','archived','after','before']; check(a.rule===null || Object.keys(a.rule).every(k=>allowedKeys.includes(k)),'unsupported_collection_filter');
    if (a.rule) this.summaries(v,a.rule,true);
    let parent=a.parentId, seen=new Set([a.collectionId]); while(parent) { check(!seen.has(parent),'folder_cycle'); seen.add(parent); const c=this.collections(v).find(c=>c.id===parent); check(c,'parent_collection_missing'); parent=c.parentId; }
    this.tx(()=>{const revision=Number(this.db.prepare('SELECT version FROM cp_collection_rules WHERE collection_id=?').get(a.collectionId)?.version??0);check(revision===a.expectedRuleRevision,'stale_collection_rule');this.db.prepare('INSERT INTO cp_collection_rules VALUES(?,?,?,1) ON CONFLICT(collection_id) DO UPDATE SET parent_id=excluded.parent_id,rule=excluded.rule,version=cp_collection_rules.version+1').run(a.collectionId,a.parentId,a.rule===null?null:JSON.stringify(a.rule)); this.audit('collection.rule',a.collectionId); }); result=this.collections(v);break;
   }
   case 'favorite': this.resource(v,a.resourceId);result=this.favorite(a);break;
   case 'providers': result=await this.providers(v);break;
   case 'create': {text(a.title);const p=(await this.providers(v)).find(p=>p.id===a.providerId || !a.providerId&&p.record&&!p.execute);check(p?.record,'provider_unavailable');result=await this.host.command('createConversation',{...a,providerId:p.id});break;}
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
    const gid=current.snapshot.resourceMap[a.resourceId];check(gid,'conversation_missing');
    const items=current.graph.visibleMessages(gid).filter(m=>this.readable(current,current.publicIds.get(m.conversationId)!,m.id,true)).map(m=>({id:m.id,resourceId:current.publicIds.get(m.conversationId)!,role:m.role,content:m.content,createdAt:m.createdAt,provenance:m.provenance,inherited:m.conversationId!==gid,sensitivity:m.sensitivity}));
    result={format:'aerynth.conversation-export@1',detail:{...detail,messages:{items,total:items.length,offset:0,limit:items.length,hasMore:false}}};break;
   }
   default: throw new ProductError('unsupported_product_command');
  }
  return result as ProductCommandMap[K]['output'];
 }
}
