import { DatabaseSync, backup } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { validateSubjectRef, type BlockSubjectRef, type NonResourceSubjectRef, type SubjectState } from './subjects.ts';
export type { BlockSubjectRef, NonResourceSubjectRef, SubjectState } from './subjects.ts';

const migrationDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
const migrations = ['001-initial.sql', '002-external-refs.sql', '003-block-subjects.sql'];
const stamp = () => new Date().toISOString();
const id = () => randomUUID();
const required = (value: string, label: string) => {
  if (typeof value !== 'string' || !value.trim()) throw new KernelError('INVALID', `${label} is required`);
  return value.trim();
};
const finite = (value: number, label: string) => {
  if (!Number.isFinite(value)) throw new KernelError('INVALID', `${label} must be finite`);
  return value;
};

export class KernelError extends Error {
  code: 'INVALID' | 'NOT_FOUND' | 'CONFLICT' | 'INTEGRITY' | 'STORAGE';
  constructor(code: 'INVALID' | 'NOT_FOUND' | 'CONFLICT' | 'INTEGRITY' | 'STORAGE', message: string) {
    super(message);
    this.name = 'KernelError';
    this.code = code;
  }
}

export type Origin = 'user' | 'system' | 'import';
export type Mutation = { origin?: Origin; correlationId?: string };
export type Placement = { x: number; y: number; width: number; height: number; z: number };
export type ResourceKind = 'note' | 'conversation' | 'generic';
export type Resource = { id: string; project_id: string | null; kind: ResourceKind; title: string; state: 'active' | 'archived'; version: number; created_at: string; updated_at: string };

function translate(error: unknown): never {
  if (error instanceof KernelError) throw error;
  const message = error instanceof Error ? error.message : String(error);
  if (/SQLITE_CONSTRAINT|constraint failed|FOREIGN KEY constraint/i.test(message)) throw new KernelError('INTEGRITY', message);
  if (/database disk image is malformed|file is not a database|database is locked/i.test(message)) throw new KernelError('INTEGRITY', message);
  throw new KernelError('STORAGE', message);
}

export class WorkspaceKernel {
  private db: DatabaseSync;
  readonly path: string;
  private constructor(db: DatabaseSync, path: string) { this.db = db; this.path = path; }

  static open(path: string): WorkspaceKernel {
    const db = new DatabaseSync(path);
    try {
      db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
      const kernel = new WorkspaceKernel(db, path);
      kernel.migrate();
      kernel.assertIntegrity();
      return kernel;
    } catch (error) {
      db.close();
      translate(error);
    }
  }

  static openExisting(path: string): WorkspaceKernel {
    if (!existsSync(path)) throw new KernelError('NOT_FOUND', 'Database file does not exist');
    return WorkspaceKernel.open(path);
  }

  close(): void { this.db.close(); }

  private tx<T>(operation: () => T): T {
    try { return this.withTransaction(() => operation()); }
    catch (error) { translate(error); }
  }

  /** Experimental integration seam. Synchronous callbacks only; the caller owns
   * extension tables. Savepoints compose kernel writes with extension writes.
   * Never expose this database handle to a renderer or provider adapter. */
  withTransaction<T>(operation: (db: DatabaseSync) => T): T {
    const savepoint = 'kernel_' + randomUUID().replaceAll('-', '');
    this.db.exec(`SAVEPOINT ${savepoint}`);
    try {
      const result = operation(this.db);
      if (result instanceof Promise) throw new KernelError('INVALID', 'Transaction callback must be synchronous');
      this.db.exec(`RELEASE ${savepoint}`);
      return result;
    } catch (error) {
      this.db.exec(`ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
      throw error;
    }
  }

  schemaVersion(): number {
    const exists = this.db.prepare("SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name='app_schema_version'").get();
    if (!exists) return 0;
    const rows = this.db.prepare('SELECT version FROM app_schema_version').all();
    if (rows.length !== 1 || !Number.isInteger(rows[0].version)) throw new KernelError('INTEGRITY', 'Invalid schema version record');
    return Number(rows[0].version);
  }

  migrate(): void {
    let version = this.schemaVersion();
    if (version > migrations.length) throw new KernelError('INTEGRITY', `Unsupported future schema ${version}`);
    if (version === 0) {
      const otherTables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
      if (otherTables.length) throw new KernelError('INTEGRITY', 'Unrecognized database without schema version');
    }
    while (version < migrations.length) {
      const script = readFileSync(join(migrationDir, migrations[version]), 'utf8');
      if(version===2){
        // SQLite ignores foreign_keys changes inside a transaction. Rebuild only
        // at the owning startup boundary, retaining extension rows and FK names.
        this.db.exec('PRAGMA foreign_keys=OFF');
        if(this.db.prepare('PRAGMA foreign_keys').get()!.foreign_keys!==0)throw new KernelError('INTEGRITY','Subject migration requires the owning startup boundary');
        try{this.tx(()=>{this.db.exec(script);const foreign=this.db.prepare('PRAGMA foreign_key_check').all();if(foreign.length)throw new KernelError('INTEGRITY','Subject migration foreign-key validation failed');});}
        finally{this.db.exec('PRAGMA foreign_keys=ON');}
      }else this.tx(() => this.db.exec(script));
      version++;
      if (this.schemaVersion() !== version) throw new KernelError('INTEGRITY', `Migration ${version} did not set schema version`);
    }
  }

  assertIntegrity(): void {
    const quick = this.db.prepare('PRAGMA quick_check').all();
    const foreign = this.db.prepare('PRAGMA foreign_key_check').all();
    const missingNote = this.db.prepare("SELECT 1 FROM resources r LEFT JOIN notes n ON n.resource_id=r.id WHERE r.kind='note' AND n.resource_id IS NULL LIMIT 1").get();
    const missingConversation = this.db.prepare("SELECT 1 FROM resources r LEFT JOIN conversation_refs c ON c.resource_id=r.id WHERE r.kind='conversation' AND c.resource_id IS NULL LIMIT 1").get();
    const wrongNote = this.db.prepare("SELECT 1 FROM notes n JOIN resources r ON r.id=n.resource_id WHERE r.kind<>'note' LIMIT 1").get();
    const wrongConversation = this.db.prepare("SELECT 1 FROM conversation_refs c JOIN resources r ON r.id=c.resource_id WHERE r.kind<>'conversation' LIMIT 1").get();
    const missingLayout = this.db.prepare('SELECT 1 FROM workspaces w LEFT JOIN workspace_layouts l ON l.workspace_id=w.id WHERE l.workspace_id IS NULL LIMIT 1').get();
    if (quick.length !== 1 || quick[0].quick_check !== 'ok' || foreign.length || missingNote || missingConversation || wrongNote || wrongConversation || missingLayout) {
      throw new KernelError('INTEGRITY', `Database integrity failure: ${JSON.stringify({ quick, foreign, missingNote: !!missingNote, missingConversation: !!missingConversation, wrongNote: !!wrongNote, wrongConversation: !!wrongConversation, missingLayout: !!missingLayout })}`);
    }
    if(this.schemaVersion()>=3){try{for(const row of this.db.prepare('SELECT id FROM block_subject_refs').all())this.readSubjectBinding(String(row.id));}catch{throw new KernelError('INTEGRITY','Invalid retained block subject binding');}}
  }

  private get(table: 'projects' | 'workspaces' | 'resources' | 'blocks' | 'collections', key: string): any {
    const row = this.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(key);
    if (!row) throw new KernelError('NOT_FOUND', `${table} ${key} not found`);
    return row;
  }

  private event(entityKind: string, entityId: string, resourceVersion: number, type: string, mutation: Mutation = {}, detail: object = {}): void {
    this.db.prepare(`INSERT INTO change_events(id,entity_kind,entity_id,resource_id,resource_version,occurred_at,origin,correlation_id,type,detail_json)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id(), entityKind, entityId, entityKind === 'resource' && type !== 'resource.deleted' ? entityId : null,
      resourceVersion, stamp(), mutation.origin ?? 'user', mutation.correlationId ?? id(), type, JSON.stringify(detail));
  }

  createProject(title: string, mutation: Mutation = {}): any {
    return this.tx(() => {
      const project = { id: id(), title: required(title, 'project title'), state: 'active', version: 1, created_at: stamp(), updated_at: stamp() };
      this.db.prepare('INSERT INTO projects VALUES(?,?,?,?,?,?)').run(...Object.values(project));
      this.event('project', project.id, 1, 'project.created', mutation);
      return project;
    });
  }

  renameProject(projectId: string, title: string, expectedVersion: number, mutation: Mutation = {}): any {
    return this.tx(() => {
      const project = this.get('projects', projectId);
      if (project.version !== expectedVersion) throw new KernelError('CONFLICT', 'Project version changed');
      const updated = stamp();
      this.db.prepare('UPDATE projects SET title=?,version=version+1,updated_at=? WHERE id=?').run(required(title, 'project title'), updated, projectId);
      this.event('project', projectId, expectedVersion + 1, 'project.renamed', mutation);
      return this.get('projects', projectId);
    });
  }

  renameWorkspace(workspaceId: string, title: string, expectedVersion: number, mutation: Mutation = {}): any {
    return this.tx(() => {
      const workspace = this.get('workspaces', workspaceId);
      if (workspace.version !== expectedVersion) throw new KernelError('CONFLICT', 'Workspace version changed');
      this.db.prepare('UPDATE workspaces SET title=?,version=version+1,updated_at=? WHERE id=?').run(required(title, 'workspace title'),stamp(),workspaceId);
      this.event('workspace', workspaceId, expectedVersion + 1, 'workspace.renamed', mutation);
      return this.get('workspaces', workspaceId);
    });
  }

  setWorkspaceArchived(workspaceId: string, archived: boolean, expectedVersion: number, mutation: Mutation = {}): any {
    return this.tx(() => {
      const workspace = this.get('workspaces', workspaceId);
      if (workspace.version !== expectedVersion) throw new KernelError('CONFLICT', 'Workspace version changed');
      const state = archived ? 'archived' : 'active';
      if (workspace.state === state) return workspace;
      this.db.prepare('UPDATE workspaces SET state=?,version=version+1,updated_at=? WHERE id=?').run(state,stamp(),workspaceId);
      this.event('workspace', workspaceId, expectedVersion + 1, archived ? 'workspace.archived' : 'workspace.restored', mutation);
      return this.get('workspaces', workspaceId);
    });
  }

  deleteWorkspace(workspaceId: string, expectedVersion: number, mutation: Mutation = {}): void {
    this.tx(() => {
      const workspace = this.get('workspaces', workspaceId);
      if (workspace.version !== expectedVersion) throw new KernelError('CONFLICT', 'Workspace version changed');
      if (workspace.state !== 'archived') throw new KernelError('INVALID', 'Archive workspace before deletion');
      if (this.db.prepare('SELECT 1 FROM blocks WHERE workspace_id=? LIMIT 1').get(workspaceId)) throw new KernelError('INTEGRITY', 'Workspace still contains blocks');
      this.db.prepare('DELETE FROM workspace_layouts WHERE workspace_id=?').run(workspaceId);
      this.db.prepare('DELETE FROM workspaces WHERE id=?').run(workspaceId);
      this.event('workspace', workspaceId, expectedVersion + 1, 'workspace.deleted', mutation);
    });
  }

  setProjectArchived(projectId: string, archived: boolean, expectedVersion: number, mutation: Mutation = {}): any {
    return this.tx(() => {
      const project = this.get('projects', projectId);
      if (project.version !== expectedVersion) throw new KernelError('CONFLICT', 'Project version changed');
      const state = archived ? 'archived' : 'active';
      if (project.state === state) return project;
      this.db.prepare('UPDATE projects SET state=?,version=version+1,updated_at=? WHERE id=?').run(state,stamp(),projectId);
      this.event('project', projectId, expectedVersion + 1, archived ? 'project.archived' : 'project.restored', mutation);
      return this.get('projects', projectId);
    });
  }

  deleteProject(projectId: string, expectedVersion: number, mutation: Mutation = {}): void {
    this.tx(() => {
      const project = this.get('projects', projectId);
      if (project.version !== expectedVersion) throw new KernelError('CONFLICT', 'Project version changed');
      if (project.state !== 'archived') throw new KernelError('INVALID', 'Archive project before deletion');
      for (const table of ['workspaces','resources','collections'] as const) {
        if (this.db.prepare(`SELECT 1 FROM ${table} WHERE project_id=? LIMIT 1`).get(projectId)) throw new KernelError('INTEGRITY', `Project still referenced by ${table}`);
      }
      this.db.prepare('DELETE FROM projects WHERE id=?').run(projectId);
      this.event('project', projectId, expectedVersion + 1, 'project.deleted', mutation);
    });
  }

  createWorkspace(title: string, projectId: string | null = null, mutation: Mutation = {}): any {
    return this.tx(() => {
      if (projectId) this.get('projects', projectId);
      const workspace = { id: id(), project_id: projectId, title: required(title, 'workspace title'), state: 'active', version: 1, created_at: stamp(), updated_at: stamp() };
      this.db.prepare('INSERT INTO workspaces VALUES(?,?,?,?,?,?,?)').run(...Object.values(workspace));
      this.db.prepare('INSERT INTO workspace_layouts(workspace_id,updated_at) VALUES(?,?)').run(workspace.id, workspace.updated_at);
      this.event('workspace', workspace.id, 1, 'workspace.created', mutation);
      return workspace;
    });
  }

  openWorkspace(workspaceId: string): { workspace: any; layout: any; blocks: any[] } {
    const workspace = this.get('workspaces', workspaceId);
    const layout = this.db.prepare('SELECT * FROM workspace_layouts WHERE workspace_id=?').get(workspaceId);
    const blocks = this.db.prepare('SELECT * FROM blocks WHERE workspace_id=? ORDER BY z,id').all(workspaceId);
    return { workspace, layout: { ...layout, viewport: JSON.parse(String(layout?.viewport_json)) }, blocks };
  }

  private createResource(kind: ResourceKind, title: string, projectId: string | null, mutation: Mutation): Resource {
    if (projectId) this.get('projects', projectId);
    const resource = { id: id(), project_id: projectId, kind, title: required(title, 'resource title'), state: 'active', version: 1, created_at: stamp(), updated_at: stamp() } as Resource;
    this.db.prepare('INSERT INTO resources VALUES(?,?,?,?,?,?,?,?)').run(...Object.values(resource));
    this.event('resource', resource.id, 1, 'resource.created', mutation, { kind });
    return resource;
  }

  /** Canonical identity for a specialized domain. Its host composes domain
   * metadata in the same transaction; this never creates a note or placement. */
  createGenericResource(title: string, projectId: string | null = null, mutation: Mutation = {}): Resource {
    return this.tx(() => this.createResource('generic', title, projectId, mutation));
  }

  /** Advance a specialized domain's canonical resource fence without changing
   * its title/content/ownership. Compose the actual domain edit in withTransaction. */
  touchGenericResource(resourceId: string, expectedVersion: number, mutation: Mutation = {}): Resource {
    return this.tx(() => {
      const resource = this.get('resources', resourceId) as Resource;
      if (resource.kind !== 'generic' || resource.state !== 'active') throw new KernelError('INVALID', 'Generic resource is unavailable');
      if (resource.version !== expectedVersion) throw new KernelError('CONFLICT', 'Resource version changed');
      this.db.prepare('UPDATE resources SET version=version+1,updated_at=? WHERE id=?').run(stamp(), resourceId);
      this.event('resource', resourceId, expectedVersion + 1, 'resource.metadata_updated', mutation);
      return this.get('resources', resourceId);
    });
  }

  createNote(title: string, content: string, projectId: string | null = null, mutation: Mutation = {}): Resource {
    return this.tx(() => {
      if (typeof content !== 'string') throw new KernelError('INVALID', 'Note content must be text');
      const resource = this.createResource('note', title, projectId, mutation);
      this.db.prepare('INSERT INTO notes VALUES(?,?,1)').run(resource.id, content);
      return resource;
    });
  }

  createConversationRef(title: string, projectId: string | null = null, mutation: Mutation = {}): Resource {
    return this.tx(() => {
      const resource = this.createResource('conversation', title, projectId, mutation);
      this.db.prepare('INSERT INTO conversation_refs(resource_id) VALUES(?)').run(resource.id);
      return resource;
    });
  }

  getResource(resourceId: string): { resource: Resource; note?: any; conversation?: any; externalRefs: any[] } {
    const resource = this.get('resources', resourceId) as Resource;
    const note = this.db.prepare('SELECT * FROM notes WHERE resource_id=?').get(resourceId);
    const conversation = this.db.prepare('SELECT * FROM conversation_refs WHERE resource_id=?').get(resourceId);
    const externalRefs = this.db.prepare('SELECT * FROM external_provider_refs WHERE resource_id=? ORDER BY provider,namespace').all(resourceId);
    return { resource, ...(note ? { note } : {}), ...(conversation ? { conversation } : {}), externalRefs };
  }

  updateNote(resourceId: string, content: string, expectedVersion: number, mutation: Mutation = {}): Resource {
    return this.tx(() => {
      const resource = this.get('resources', resourceId);
      if (resource.kind !== 'note') throw new KernelError('INVALID', 'Resource is not a note');
      if (resource.version !== expectedVersion) throw new KernelError('CONFLICT', 'Note version changed');
      if (typeof content !== 'string') throw new KernelError('INVALID', 'Note content must be text');
      this.db.prepare('UPDATE notes SET content=?,revision=revision+1 WHERE resource_id=?').run(content, resourceId);
      this.db.prepare('UPDATE resources SET version=version+1,updated_at=? WHERE id=?').run(stamp(), resourceId);
      this.event('resource', resourceId, expectedVersion + 1, 'note.updated', mutation);
      return this.get('resources', resourceId);
    });
  }

  renameResource(resourceId: string, title: string, expectedVersion: number, mutation: Mutation = {}): Resource {
    return this.tx(() => {
      const resource = this.get('resources', resourceId) as Resource;
      if (resource.version !== expectedVersion) throw new KernelError('CONFLICT', 'Resource version changed');
      if (resource.state !== 'active') throw new KernelError('INVALID', 'Resource is archived');
      this.db.prepare('UPDATE resources SET title=?,version=version+1,updated_at=? WHERE id=?').run(required(title, 'resource title'), stamp(), resourceId);
      this.event('resource', resourceId, expectedVersion + 1, 'resource.renamed', mutation);
      return this.get('resources', resourceId);
    });
  }

  assignResourceProject(resourceId: string, projectId: string | null, expectedVersion: number, mutation: Mutation = {}): Resource {
    return this.tx(() => {
      const resource = this.get('resources', resourceId) as Resource;
      if (resource.version !== expectedVersion) throw new KernelError('CONFLICT', 'Resource version changed');
      if (resource.state !== 'active') throw new KernelError('INVALID', 'Resource is archived');
      if (projectId !== null && (typeof projectId !== 'string' || this.get('projects', projectId).state !== 'active')) throw new KernelError('INVALID', 'Destination project is unavailable');
      this.db.prepare('UPDATE resources SET project_id=?,version=version+1,updated_at=? WHERE id=?').run(projectId, stamp(), resourceId);
      this.event('resource', resourceId, expectedVersion + 1, 'resource.project_assigned', mutation, { projectId });
      return this.get('resources', resourceId);
    });
  }

  addExternalRef(resourceId: string, provider: string, namespace: string, externalId: string, mutation: Mutation = {}): any {
    return this.tx(() => {
      const resource = this.get('resources', resourceId);
      const ref = { id: id(), resource_id: resourceId, provider: required(provider, 'provider'), namespace, external_id: required(externalId, 'external ID'), state: 'unverified', created_at: stamp() };
      this.db.prepare('INSERT INTO external_provider_refs VALUES(?,?,?,?,?,?,?)').run(...Object.values(ref));
      this.event('resource', resourceId, resource.version, 'external_ref.added', mutation, { provider: ref.provider });
      return ref;
    });
  }

  attachBlock(workspaceId: string, resourceId: string, placement: Placement, mutation: Mutation = {}): any {
    return this.tx(() => {
      this.get('workspaces', workspaceId); const resource = this.get('resources', resourceId);
      const block = { id: id(), workspace_id: workspaceId, resource_id: resourceId, ...this.placement(placement), version: 1 };
      this.db.prepare('INSERT INTO blocks(id,workspace_id,resource_id,x,y,width,height,z,version) VALUES(?,?,?,?,?,?,?,?,?)').run(...Object.values(block));
      this.event('resource', resourceId, resource.version, 'block.attached', mutation, { blockId: block.id, workspaceId });
      return block;
    });
  }

  /** Typed binding metadata. This never creates a resource, note, project or collection. */
  attachSubjectBlock(workspaceId:string,subjectInput:NonResourceSubjectRef,placement:Placement,mutation:Mutation={}):any{
    return this.tx(()=>{this.get('workspaces',workspaceId);const subject=validateSubjectRef(subjectInput);if(subject.kind==='resource')throw new KernelError('INVALID','Use attachBlock for resources');if(this.subjectState(subject)!=='active')throw new KernelError('INVALID','Subject is unavailable');
      if(Number(this.db.prepare('SELECT count(*) AS n FROM block_subject_refs').get()!.n)>=32768)throw new KernelError('STORAGE','Block subject retention capacity reached');
      const subjectId=id();this.db.prepare('INSERT INTO block_subject_refs VALUES(?,?,?,?,?)').run(subjectId,subject.kind,subject.kind==='project'?subject.projectId:subject.kind==='resource-query'?subject.projectId:null,subject.kind==='collection'?subject.collectionId:subject.kind==='resource-query'?subject.collectionId??null:null,subject.kind==='resource-query'?JSON.stringify(subject):null);
      const block={id:id(),workspace_id:workspaceId,resource_id:null,...this.placement(placement),version:1,subject_ref_id:subjectId};this.db.prepare('INSERT INTO blocks(id,workspace_id,resource_id,x,y,width,height,z,version,subject_ref_id) VALUES(?,?,?,?,?,?,?,?,?,?)').run(...Object.values(block));this.event('workspace',workspaceId,this.get('workspaces',workspaceId).version,'block.subject_attached',mutation,{blockId:block.id,subject});return block;});
  }
  readBlockSubject(blockId:string):BlockSubjectRef{const block=this.get('blocks',blockId);return block.resource_id?{kind:'resource',resourceId:String(block.resource_id)}:this.readSubjectBinding(String(block.subject_ref_id));}
  readSubjectBinding(subjectId:string):NonResourceSubjectRef{const row=this.db.prepare('SELECT * FROM block_subject_refs WHERE id=?').get(subjectId);if(!row)throw new KernelError('NOT_FOUND','Block subject binding missing');const value=row.kind==='project'?{kind:'project',projectId:row.project_id}:row.kind==='collection'?{kind:'collection',collectionId:row.collection_id}:JSON.parse(String(row.query_json));const subject=validateSubjectRef(value);if(subject.kind==='resource'||subject.kind!==row.kind||subject.kind==='resource-query'&&(subject.projectId!==row.project_id||(subject.collectionId??null)!==row.collection_id))throw new KernelError('INTEGRITY','Invalid subject binding');return subject;}
  subjectState(subjectInput:BlockSubjectRef):SubjectState{const subject=validateSubjectRef(subjectInput);const state=(table:'projects'|'collections'|'resources',subjectId:string):SubjectState=>{const row=this.db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(subjectId);if(!row)return 'unavailable';if(row.state==='archived')return 'archived';if(row.project_id){const project=this.db.prepare('SELECT state FROM projects WHERE id=?').get(String(row.project_id));if(!project)return 'unavailable';if(project.state==='archived')return 'archived';}return 'active';};
    if(subject.kind==='resource')return state('resources',subject.resourceId);if(subject.kind==='project')return state('projects',subject.projectId);if(subject.kind==='collection')return state('collections',subject.collectionId);const project=subject.projectId===null?'active':state('projects',subject.projectId);return project!=='active'?project:subject.collectionId?state('collections',subject.collectionId):'active';}

  private placement(p: Placement): Placement {
    if (!p || typeof p !== 'object') throw new KernelError('INVALID', 'Placement required');
    const result = { x: finite(p.x, 'x'), y: finite(p.y, 'y'), width: finite(p.width, 'width'), height: finite(p.height, 'height'), z: finite(p.z, 'z') };
    if (result.width <= 0 || result.height <= 0 || !Number.isInteger(result.z)) throw new KernelError('INVALID', 'Invalid block dimensions or z');
    return result;
  }

  moveBlock(blockId: string, destinationWorkspaceId: string, expectedVersion: number, mutation: Mutation = {}): any {
    return this.tx(() => {
      const block = this.get('blocks', blockId);
      this.get('workspaces', destinationWorkspaceId);
      if (block.version !== expectedVersion) throw new KernelError('CONFLICT', 'Block version changed');
      this.db.prepare('UPDATE blocks SET workspace_id=?,version=version+1 WHERE id=?').run(destinationWorkspaceId, blockId);
      if(block.resource_id)this.event('resource', block.resource_id, this.get('resources', block.resource_id).version, 'block.moved', mutation, { blockId, from: block.workspace_id, to: destinationWorkspaceId });
      else this.event('workspace',destinationWorkspaceId,this.get('workspaces',destinationWorkspaceId).version,'block.subject_moved',mutation,{blockId,from:block.workspace_id,to:destinationWorkspaceId});
      return this.get('blocks', blockId);
    });
  }

  saveLayout(workspaceId: string, mode: 'freeform' | 'structured', viewport: object, placements: { blockId: string; expectedVersion: number; placement: Placement }[], expectedLayoutVersion: number, mutation: Mutation = {}): any {
    return this.tx(() => {
      this.get('workspaces', workspaceId);
      const layout = this.db.prepare('SELECT * FROM workspace_layouts WHERE workspace_id=?').get(workspaceId) as any;
      if (layout.version !== expectedLayoutVersion) throw new KernelError('CONFLICT', 'Layout version changed');
      if (!['freeform','structured'].includes(mode) || !viewport || Array.isArray(viewport) || typeof viewport !== 'object') throw new KernelError('INVALID', 'Invalid layout metadata');
      const seen = new Set<string>();
      for (const item of placements) {
        if (seen.has(item.blockId)) throw new KernelError('INVALID', 'Duplicate block placement');
        seen.add(item.blockId);
        const block = this.get('blocks', item.blockId);
        if (block.workspace_id !== workspaceId) throw new KernelError('INVALID', 'Block belongs to another workspace');
        if (block.version !== item.expectedVersion) throw new KernelError('CONFLICT', 'Block version changed');
        const p = this.placement(item.placement);
        this.db.prepare('UPDATE blocks SET x=?,y=?,width=?,height=?,z=?,version=version+1 WHERE id=?').run(p.x,p.y,p.width,p.height,p.z,item.blockId);
      }
      this.db.prepare('UPDATE workspace_layouts SET mode=?,viewport_json=?,version=version+1,updated_at=? WHERE workspace_id=?').run(mode,JSON.stringify(viewport),stamp(),workspaceId);
      this.event('workspace', workspaceId, expectedLayoutVersion + 1, 'layout.saved', mutation, { blockCount: placements.length });
      return this.openWorkspace(workspaceId);
    });
  }

  relate(sourceId: string, targetId: string, kind: string, provenance: 'user' | 'inferred' | 'imported' = 'user', mutation: Mutation = {}): any {
    return this.tx(() => {
      this.get('resources', sourceId); this.get('resources', targetId);
      if (sourceId === targetId) throw new KernelError('INVALID', 'Self relationship is unsupported');
      const edge = { id: id(), source_id: sourceId, target_id: targetId, kind: required(kind, 'relationship kind'), provenance, created_at: stamp() };
      this.db.prepare('INSERT INTO relationships VALUES(?,?,?,?,?,?)').run(...Object.values(edge));
      this.event('resource', sourceId, this.get('resources', sourceId).version, 'relationship.added', mutation, { edgeId: edge.id, targetId, kind });
      return edge;
    });
  }

  listRelationships(resourceId: string): any[] {
    this.get('resources', resourceId);
    return this.db.prepare('SELECT * FROM relationships WHERE source_id=? OR target_id=? ORDER BY created_at,id').all(resourceId, resourceId);
  }

  createCollection(title: string, projectId: string | null = null, mutation: Mutation = {}): any {
    return this.tx(() => {
      if (projectId) this.get('projects', projectId);
      const collection = { id: id(), project_id: projectId, title: required(title, 'collection title'), state: 'active', version: 1, created_at: stamp(), updated_at: stamp() };
      this.db.prepare('INSERT INTO collections VALUES(?,?,?,?,?,?,?)').run(...Object.values(collection));
      this.event('collection', collection.id, 1, 'collection.created', mutation);
      return collection;
    });
  }

  renameCollection(collectionId: string, title: string, expectedVersion: number, mutation: Mutation = {}): any {
    return this.tx(() => {
      const collection = this.get('collections', collectionId);
      if (collection.version !== expectedVersion) throw new KernelError('CONFLICT', 'Collection version changed');
      this.db.prepare('UPDATE collections SET title=?,version=version+1,updated_at=? WHERE id=?').run(required(title, 'collection title'),stamp(),collectionId);
      this.event('collection', collectionId, expectedVersion + 1, 'collection.renamed', mutation);
      return this.get('collections', collectionId);
    });
  }

  /** Advances the canonical collection fence after a composed membership change. */
  touchCollection(collectionId: string, expectedVersion: number, mutation: Mutation = {}): any {
    return this.tx(() => {
      const collection = this.get('collections', collectionId);
      if (collection.version !== expectedVersion) throw new KernelError('CONFLICT', 'Collection version changed');
      if (collection.state !== 'active') throw new KernelError('INVALID', 'Collection is archived');
      this.db.prepare('UPDATE collections SET version=version+1,updated_at=? WHERE id=?').run(stamp(), collectionId);
      this.event('collection', collectionId, expectedVersion + 1, 'collection.membership_changed', mutation);
      return this.get('collections', collectionId);
    });
  }

  setCollectionArchived(collectionId: string, archived: boolean, expectedVersion: number, mutation: Mutation = {}): any {
    return this.tx(() => {
      const collection = this.get('collections', collectionId);
      if (collection.version !== expectedVersion) throw new KernelError('CONFLICT', 'Collection version changed');
      const state = archived ? 'archived' : 'active';
      if (collection.state === state) return collection;
      this.db.prepare('UPDATE collections SET state=?,version=version+1,updated_at=? WHERE id=?').run(state,stamp(),collectionId);
      this.event('collection', collectionId, expectedVersion + 1, archived ? 'collection.archived' : 'collection.restored', mutation);
      return this.get('collections', collectionId);
    });
  }

  deleteCollection(collectionId: string, expectedVersion: number, mutation: Mutation = {}): void {
    this.tx(() => {
      const collection = this.get('collections', collectionId);
      if (collection.version !== expectedVersion) throw new KernelError('CONFLICT', 'Collection version changed');
      if (collection.state !== 'archived') throw new KernelError('INVALID', 'Archive collection before deletion');
      if (this.db.prepare('SELECT 1 FROM collection_members WHERE collection_id=? LIMIT 1').get(collectionId)) throw new KernelError('INTEGRITY', 'Collection still contains resources');
      this.db.prepare('DELETE FROM collections WHERE id=?').run(collectionId);
      this.event('collection', collectionId, expectedVersion + 1, 'collection.deleted', mutation);
    });
  }

  addToCollection(collectionId: string, resourceId: string, mutation: Mutation = {}): void {
    this.tx(() => { this.get('collections', collectionId); this.get('resources', resourceId); this.db.prepare('INSERT INTO collection_members VALUES(?,?)').run(collectionId, resourceId); this.event('resource', resourceId, this.get('resources', resourceId).version, 'collection.member_added', mutation, { collectionId }); });
  }

  listCollection(collectionId: string): Resource[] {
    this.get('collections', collectionId);
    return this.db.prepare('SELECT r.* FROM resources r JOIN collection_members m ON m.resource_id=r.id WHERE m.collection_id=? ORDER BY r.title,r.id').all(collectionId) as Resource[];
  }

  searchResources(query = '', includeArchived = false): Resource[] {
    const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
    return this.db.prepare("SELECT * FROM resources WHERE title LIKE ? ESCAPE '\\' AND (?=1 OR state='active') ORDER BY title,id").all(pattern, includeArchived ? 1 : 0) as Resource[];
  }

  setResourceArchived(resourceId: string, archived: boolean, expectedVersion: number, mutation: Mutation = {}): Resource {
    return this.tx(() => {
      const resource = this.get('resources', resourceId);
      if (resource.version !== expectedVersion) throw new KernelError('CONFLICT', 'Resource version changed');
      const state = archived ? 'archived' : 'active';
      if (resource.state === state) return resource;
      this.db.prepare('UPDATE resources SET state=?,version=version+1,updated_at=? WHERE id=?').run(state,stamp(),resourceId);
      this.event('resource', resourceId, expectedVersion + 1, archived ? 'resource.archived' : 'resource.restored', mutation);
      return this.get('resources', resourceId);
    });
  }

  deleteResource(resourceId: string, expectedVersion: number, mutation: Mutation = {}): void {
    this.tx(() => {
      const resource = this.get('resources', resourceId);
      if (resource.version !== expectedVersion) throw new KernelError('CONFLICT', 'Resource version changed');
      if (resource.state !== 'archived') throw new KernelError('INVALID', 'Archive resource before deletion');
      for (const [table, predicate] of [['blocks','resource_id=?'], ['relationships','source_id=? OR target_id=?'], ['collection_members','resource_id=?'], ['external_provider_refs','resource_id=?']] as const) {
        const bindings = table === 'relationships' ? [resourceId,resourceId] : [resourceId];
        if (this.db.prepare(`SELECT 1 FROM ${table} WHERE ${predicate} LIMIT 1`).get(...bindings)) throw new KernelError('INTEGRITY', `Resource still referenced by ${table}`);
      }
      this.db.prepare('DELETE FROM notes WHERE resource_id=?').run(resourceId);
      this.db.prepare('DELETE FROM conversation_refs WHERE resource_id=?').run(resourceId);
      this.db.prepare('DELETE FROM resources WHERE id=?').run(resourceId);
      this.event('resource', resourceId, expectedVersion + 1, 'resource.deleted', mutation);
    });
  }

  detachBlock(blockId: string, mutation: Mutation = {}): void {
    this.tx(() => { const block = this.get('blocks', blockId); this.db.prepare('DELETE FROM blocks WHERE id=?').run(blockId);if(block.resource_id)this.event('resource', block.resource_id, this.get('resources', block.resource_id).version, 'block.detached', mutation, { blockId });else this.event('workspace',block.workspace_id,this.get('workspaces',block.workspace_id).version,'block.subject_detached',mutation,{blockId}); });
  }
  unlinkRelationship(edgeId: string, mutation: Mutation = {}): void {
    this.tx(() => { const edge = this.db.prepare('SELECT * FROM relationships WHERE id=?').get(edgeId) as any; if (!edge) throw new KernelError('NOT_FOUND', 'Relationship not found'); this.db.prepare('DELETE FROM relationships WHERE id=?').run(edgeId); this.event('resource', edge.source_id, this.get('resources', edge.source_id).version, 'relationship.removed', mutation, { edgeId }); });
  }
  removeFromCollection(collectionId: string, resourceId: string, mutation: Mutation = {}): void {
    this.tx(() => { const result = this.db.prepare('DELETE FROM collection_members WHERE collection_id=? AND resource_id=?').run(collectionId,resourceId); if (!result.changes) throw new KernelError('NOT_FOUND', 'Collection membership not found'); this.event('resource', resourceId, this.get('resources', resourceId).version, 'collection.member_removed', mutation, { collectionId }); });
  }
  removeExternalRef(refId: string, mutation: Mutation = {}): void {
    this.tx(() => { const ref = this.db.prepare('SELECT * FROM external_provider_refs WHERE id=?').get(refId) as any; if (!ref) throw new KernelError('NOT_FOUND', 'External reference not found'); this.db.prepare('DELETE FROM external_provider_refs WHERE id=?').run(refId); this.event('resource', ref.resource_id, this.get('resources', ref.resource_id).version, 'external_ref.removed', mutation, { refId }); });
  }

  listEvents(entityKind: string, entityId: string): any[] {
    return this.db.prepare('SELECT * FROM change_events WHERE entity_kind=? AND entity_id=? ORDER BY rowid').all(entityKind,entityId);
  }

  async backupTo(destination: string): Promise<void> {
    this.assertIntegrity();
    await backup(this.db, destination);
    const copy = WorkspaceKernel.open(destination);
    try { copy.assertIntegrity(); } finally { copy.close(); }
  }
}
