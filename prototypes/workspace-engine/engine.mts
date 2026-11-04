import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { WorkspaceKernel } from '../workspace-kernel/kernel.mts';
import { validateSubjectRef, type BlockSubjectRef, type NonResourceSubjectRef } from '../workspace-kernel/subjects.ts';
import { CONTRACT, type Command, type CommandResult, type WorkspaceProjection, type Presentation, type Viewport, type BlockTemplate, type WorkspaceSummary, type PresencePlacement, type Geometry, type WorkspaceOrganization, type OrganizationUpdate, type LayoutPreviewRequest } from './contracts.mts';
import { ensure, WorkspaceError, defaults, presentation, resize, snapValue, presetGeometry } from './geometry.mts';
import { findVacantGridPlacement, STRUCTURED_GRID_SIZE } from './structured-grid.mts';
import { validateBounds, findVacantPlacement } from './collisions.mts';
import { defaultOrganization, updateOrganization, applyOrganizationPolicy, previewLayout, type PolicyOptions } from './organization.mts';
export { WorkspaceError } from './geometry.mts';
export type * from './contracts.mts';

type StoredBlock = Presentation & { blockId: string } & ({ resourceId: string; subject?: never; subjectBindingId?: never } | { resourceId?: never; subject: NonResourceSubjectRef; subjectBindingId: string });
type StoredPresence = Omit<PresencePlacement, 'version'>;
type StoredOrganization = Omit<WorkspaceOrganization, 'revision'>;
type Snapshot = { viewport: Viewport; blocks: StoredBlock[]; presence: StoredPresence; organization: StoredOrganization };
type Entry = { before: Snapshot; after: Snapshot };
type History = { undo: Entry[]; redo: Entry[] };
const files = ['001-presentation.sql', '002-history.sql', '003-presence.sql', '004-organization.sql'];
const now = () => new Date().toISOString();
const stable = (v: any): string => JSON.stringify(v, (_key, value) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map(k => [k, value[k]])) : value);
const hash = (v: unknown) => createHash('sha256').update(stable(v)).digest('hex');
const text = (v: unknown): v is string => typeof v === 'string' && !!v.trim() && v.length <= 512;
export const defaultPresence = (workspaceId: string): PresencePlacement => ({
  id: 'system:vela', kind: 'vela', workspaceId, version: 1, scale: 0.65, locked: false,
  x: 480, y: 64, width: 208, height: 260,
});
export const templates: readonly BlockTemplate[] = [
  { id: 'note', title: 'Reading note', presentation: { shape: 'folio', width: 400, height: 320 } },
  { id: 'conversation', title: 'Conversation', presentation: { shape: 'rounded', width: 480, height: 360 } },
  { id: 'research', title: 'Research lens', presentation: { shape: 'lens', width: 320, height: 240 } },
  { id: 'compact', title: 'Compact summary', presentation: { shape: 'pill', width: 256, height: 128 } },
];
export interface EngineOptions {
  /** Host-owned retention/approval policy. Default is fail closed. Never deletes provider data. */
  allowResourceDeletion?: (request: { resourceId: string; expectedVersion: number; approvalId: string }) => boolean;
  defaultOrganization?: OrganizationUpdate;
  /** Trusted host policy. Non-resource attachment fails closed without this grant. */
  allowSubjectAttachment?: (subject: NonResourceSubjectRef, workspaceId: string) => boolean;
}
/** Main-process service. Owns no database connection and never stores resource content. */
export class WorkspaceEngine {
  readonly kernel: WorkspaceKernel;
  private db!: DatabaseSync;
  private options: EngineOptions;
  // Geometry/identity metadata only; one workspace and at most 4 MiB of encoded
  // history are retained. Exact database strings fence every reuse, including rollback.
  private historyMemo: {workspaceId:string;json:string;presence:string;organization:string;value:History}|null = null;
  constructor(kernel: WorkspaceKernel, options: EngineOptions = {}) {
    this.kernel = kernel; this.options = options;
    kernel.withTransaction(db => {
      this.db = db;
      const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE name='workspace_engine_schema'").get();
      let version = 0;
      if (exists) {
        const rows = db.prepare('SELECT version FROM workspace_engine_schema').all();
        ensure(rows.length === 1 && Number.isInteger(rows[0].version), 'INTEGRITY');
        version = Number(rows[0].version);
      }
      ensure(version >= 0 && version <= files.length, 'UNSUPPORTED_SCHEMA');
      const upgradePresence = version < 3;
      const upgradeOrganization = version < 4;
      while (version < files.length) {
        db.exec(readFileSync(new URL(`./migrations/${files[version]}`, import.meta.url), 'utf8'));
        version++;
        db.prepare('UPDATE workspace_engine_schema SET version=?').run(version);
      }
      for (const w of db.prepare('SELECT id FROM workspaces').all()) {
        const workspaceId = String(w.id); this.layout(workspaceId);
        if (upgradePresence || upgradeOrganization) {
          this.writeHistory(workspaceId, this.history(workspaceId));
          for (const cp of db.prepare('SELECT id,snapshot_json FROM workspace_engine_checkpoints WHERE workspace_id=?').all(workspaceId))
            db.prepare('UPDATE workspace_engine_checkpoints SET snapshot_json=? WHERE id=?').run(JSON.stringify(this.normalizeSnapshot(workspaceId, JSON.parse(String(cp.snapshot_json)))), cp.id);
        }
      }
    });
  }
  private atomic<T>(fn: () => T): T {
    try { return this.kernel.withTransaction(fn); }
    catch (e: any) {
      if (/database is locked|SQLITE_BUSY/.test(e.message)) throw new WorkspaceError('CONFLICT', 'Concurrent writer; refresh and retry with the same command ID');
      throw e;
    }
  }
  private layout(workspaceId: string): any {
    let row = this.db.prepare('SELECT * FROM workspace_engine_layouts WHERE workspace_id=?').get(workspaceId);
    if (!row) {
      this.kernel.openWorkspace(workspaceId);
      this.db.prepare('INSERT INTO workspace_engine_layouts(id,workspace_id) VALUES(?,?)').run(randomUUID(), workspaceId);
      row = this.db.prepare('SELECT * FROM workspace_engine_layouts WHERE workspace_id=?').get(workspaceId);
    }
    if (!row!.presence_json) {
      const presence = JSON.stringify(defaultPresence(workspaceId));
      this.db.prepare('UPDATE workspace_engine_layouts SET presence_json=?,legacy_presence_json=? WHERE workspace_id=?').run(presence, presence, workspaceId);
      row = this.db.prepare('SELECT * FROM workspace_engine_layouts WHERE workspace_id=?').get(workspaceId);
    }
    if (!row!.organization_json) {
      const legacy = this.kernel.openWorkspace(workspaceId).layout;
      const mode = legacy.viewport.organization?.mode ?? legacy.viewport.organizationMode ?? (legacy.mode === 'structured' ? 'structured' : 'fluid');
      const organization = updateOrganization(defaultOrganization(), { mode });
      const json = JSON.stringify(organization);
      this.db.prepare('UPDATE workspace_engine_layouts SET organization_json=?,legacy_organization_json=? WHERE workspace_id=?').run(json, json, workspaceId);
      row = this.db.prepare('SELECT * FROM workspace_engine_layouts WHERE workspace_id=?').get(workspaceId);
    }
    return row;
  }
  private readOrganization(workspaceId: string): WorkspaceOrganization {
    return this.parseOrganization(this.layout(workspaceId).organization_json);
  }
  private parseOrganization(json: string): WorkspaceOrganization {
    const o = JSON.parse(json);
    ensure(o.schemaVersion === 1 && Number.isSafeInteger(o.revision) && o.revision > 0, 'INTEGRITY');
    return updateOrganization(o);
  }
  private writeOrganization(workspaceId: string, organization: WorkspaceOrganization) {
    this.db.prepare('UPDATE workspace_engine_layouts SET organization_json=? WHERE workspace_id=?').run(JSON.stringify(organization), workspaceId);
  }
  private organizationChanged(a: WorkspaceOrganization, b: WorkspaceOrganization) {
    const { revision: _a, ...left } = a, { revision: _b, ...right } = b; return hash(left) !== hash(right);
  }
  private readPresence(workspaceId: string): PresencePlacement {
    return this.parsePresence(workspaceId, this.layout(workspaceId).presence_json);
  }
  private parsePresence(workspaceId: string, json: string): PresencePlacement {
    const p = JSON.parse(json) as PresencePlacement;
    ensure(p.id === 'system:vela' && p.kind === 'vela' && p.workspaceId === workspaceId && p.scale === 0.65
      && Number.isSafeInteger(p.version) && p.version > 0, 'INTEGRITY');
    this.presencePatch(p, {}); return p;
  }
  private presencePatch(base: PresencePlacement, patch: Partial<Geometry & { locked: boolean }>): PresencePlacement {
    ensure(patch && typeof patch === 'object' && !Array.isArray(patch) && Object.keys(patch).every(k => ['x', 'y', 'width', 'height', 'locked'].includes(k)));
    const p = { ...base, ...patch };
    ensure([p.x, p.y, p.width, p.height].every(Number.isFinite) && Math.abs(p.x) <= 1e6 && Math.abs(p.y) <= 1e6
      && p.width >= 128 && p.height >= 96 && p.width <= 4096 && p.height <= 4096 && typeof p.locked === 'boolean');
    return p;
  }
  private writePresence(workspaceId: string, p: PresencePlacement) {
    this.db.prepare('UPDATE workspace_engine_layouts SET presence_json=? WHERE workspace_id=?').run(JSON.stringify(p), workspaceId);
  }
  /** Compatibility for old imported desktop histories written after constructor migration. */
  private normalizeSnapshot(workspaceId: string, snapshot: any, baseline?: PresencePlacement, organizationBaseline?: WorkspaceOrganization): Snapshot {
    ensure(snapshot && Array.isArray(snapshot.blocks) && snapshot.viewport, 'INTEGRITY');
    const { version, ...presence } = snapshot.presence ?? baseline ?? JSON.parse(this.layout(workspaceId).legacy_presence_json);
    const { revision, ...organization } = snapshot.organization ?? organizationBaseline ?? JSON.parse(this.layout(workspaceId).legacy_organization_json);
    const blocks=snapshot.blocks.map((b:any)=>{if(b.resourceId){ensure(!b.subject || b.subject.kind==='resource'&&b.subject.resourceId===b.resourceId,'INTEGRITY');const {subject,...legacy}=b;return legacy;}ensure(b.subject&&text(b.subjectBindingId),'INTEGRITY');const subject=validateSubjectRef(b.subject);ensure(subject.kind!=='resource','INTEGRITY');return {...b,subject};});
    return { ...snapshot, blocks, presence, organization };
  }
  private viewport(v: any): Viewport {
    ensure(v && typeof v === 'object' && !Array.isArray(v));
    const p = { x: v.x ?? 0, y: v.y ?? 0, zoom: v.zoom ?? 1, ...(v.displayId === undefined ? {} : { displayId: v.displayId }) };
    ensure(Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) <= 1e12 && Math.abs(p.y) <= 1e12);
    ensure(Number.isFinite(p.zoom) && p.zoom > 0 && p.zoom <= 4);
    ensure(p.displayId === undefined || text(p.displayId));
    return p;
  }
  private block(row: any): StoredBlock {
    const extra = this.db.prepare('SELECT json FROM block_presentations WHERE block_id=?').get(row.id);
    // Legacy geometry is preserved exactly, even if smaller than new interaction minima.
    const p = extra ? JSON.parse(String(extra.json)) : {};
    const valid = presentation(p);
    const geometry={ ...valid, x: row.x, y: row.y, width: row.width, height: row.height, zIndex: row.z, blockId: row.id };
    return row.resource_id?{...geometry,resourceId:String(row.resource_id)}:{...geometry,subject:this.kernel.readSubjectBinding(String(row.subject_ref_id)),subjectBindingId:String(row.subject_ref_id)};
  }
  private snapshot(workspaceId: string): Snapshot {
    const state = this.kernel.openWorkspace(workspaceId);
    const { version, ...presence } = this.readPresence(workspaceId);
    const { revision, ...organization } = this.readOrganization(workspaceId);
    return { viewport: this.viewport(state.layout.viewport), presence, organization, blocks: state.blocks.map(row => this.block(row)).sort((a, b) => a.blockId.localeCompare(b.blockId)) };
  }
  private normalizedHistory(workspaceId: string): History {
    const row=this.layout(workspaceId),json=String(row.history_json),presence=String(row.legacy_presence_json),organizationJson=String(row.legacy_organization_json),memo=this.historyMemo;
    if(memo?.workspaceId===workspaceId&&memo.json===json&&memo.presence===presence&&memo.organization===organizationJson)return memo.value;
    const h = JSON.parse(json);
    ensure(h && Array.isArray(h.undo) && Array.isArray(h.redo), 'INTEGRITY');
    const baseline = JSON.parse(presence);
    const organization = JSON.parse(organizationJson);
    for (const stack of [h.undo, h.redo]) for (const entry of stack) {
      entry.before = this.normalizeSnapshot(workspaceId, entry.before, baseline, organization); entry.after = this.normalizeSnapshot(workspaceId, entry.after, baseline, organization);
    }
    this.historyMemo=Buffer.byteLength(json)<=4*1024*1024?{workspaceId,json,presence,organization:organizationJson,value:h}:null;
    return h;
  }
  private history(workspaceId: string): History {
    const history=this.normalizedHistory(workspaceId);
    // Writers receive independent data. Cached validation must never be changed
    // by an undo/redo pop, a new command, or a transaction that later rolls back.
    return this.historyMemo?.value===history?structuredClone(history):history;
  }
  private writeHistory(workspaceId: string, h: History) {
    // Explicit finite recovery window: most recent 100 committed layout operations.
    h.undo = h.undo.slice(-100); h.redo = h.redo.slice(-100);
    this.db.prepare('UPDATE workspace_engine_layouts SET history_json=? WHERE workspace_id=?').run(JSON.stringify(h), workspaceId);
  }
  project(workspaceId: string): WorkspaceProjection {
    return this.atomic(() => {
      const state = this.kernel.openWorkspace(workspaceId), l = this.layout(workspaceId), h = this.normalizedHistory(workspaceId);
      return {
        contract: CONTRACT, workspaceId, projectId: state.workspace.project_id, title: state.workspace.title,
        workspaceVersion: state.workspace.version, layoutId: l.id, revision: state.layout.version,
        viewport: this.viewport(state.layout.viewport), presence: this.readPresence(workspaceId), organization: this.readOrganization(workspaceId),
        blocks: state.blocks.map(row => {
          const b = this.block(row);
          const subject=this.subject(b),subjectState=this.kernel.subjectState(subject),projected={...this.presentationOf(b),blockId:b.blockId};
          const common={workspaceId,version:row.version,resourceState:subjectState,subjectState,contentMode:b.minimized || ['circle','pill','lens'].includes(b.shape)?'summary' as const:'reading' as const};
          return b.resourceId?{...projected,...common,resourceId:b.resourceId,subject:{kind:'resource' as const,resourceId:b.resourceId}}:{...projected,...common,subject:b.subject!};
        }), canUndo: h.undo.length > 0, canRedo: h.redo.length > 0,
      };
    });
  }
  /** Main-process read seam. The trusted host must reauthorize the workspace
   * and its owning project before exposing this projection. Like project(),
   * this engine does not own canonical grants. Unlike project(), this method
   * never initializes, normalizes history, backfills, changes session or writes.
   * A deferred read transaction keeps all SELECTs on one SQLite snapshot. */
  inspectWorkspace(workspaceId: string): WorkspaceProjection {
    ensure(text(workspaceId));
    return this.atomic(() => {
      const workspace = this.db.prepare('SELECT * FROM workspaces WHERE id=?').get(workspaceId);
      ensure(workspace?.state === 'active', 'UNAVAILABLE');
      if (workspace.project_id !== null)
        ensure(this.db.prepare('SELECT state FROM projects WHERE id=?').get(workspace.project_id)?.state === 'active', 'UNAVAILABLE');
      const layout = this.db.prepare('SELECT * FROM workspace_layouts WHERE workspace_id=?').get(workspaceId);
      const initialized = this.db.prepare('SELECT * FROM workspace_engine_layouts WHERE workspace_id=?').get(workspaceId);
      ensure(layout && initialized && typeof initialized.presence_json === 'string' && !!initialized.presence_json
        && typeof initialized.organization_json === 'string' && !!initialized.organization_json
        && typeof initialized.history_json === 'string' && !!initialized.history_json, 'UNAVAILABLE');
      ensure(Number.isSafeInteger(layout.version) && Number(layout.version) > 0, 'INTEGRITY');
      const history = JSON.parse(initialized.history_json);
      ensure(history && Array.isArray(history.undo) && Array.isArray(history.redo), 'INTEGRITY');
      const rows = this.db.prepare('SELECT b.*,p.json AS initialized_presentation FROM blocks b LEFT JOIN block_presentations p ON p.block_id=b.id WHERE b.workspace_id=? ORDER BY b.z,b.id').all(workspaceId);
      ensure(rows.every(row => typeof row.initialized_presentation === 'string' && !!row.initialized_presentation), 'UNAVAILABLE');
      return {
        contract: CONTRACT, workspaceId, projectId: workspace.project_id as string | null, title: String(workspace.title),
        workspaceVersion: Number(workspace.version), layoutId: String(initialized.id), revision: Number(layout.version),
        viewport: this.viewport(JSON.parse(String(layout.viewport_json))),
        presence: this.parsePresence(workspaceId, initialized.presence_json), organization: this.parseOrganization(initialized.organization_json),
        blocks: rows.map(row => {
          const block = this.block(row), subject = this.subject(block), subjectState = this.kernel.subjectState(subject);
          const common = { ...this.presentationOf(block), blockId: block.blockId, workspaceId, version: Number(row.version),
            resourceState: subjectState, subjectState, contentMode: block.minimized || ['circle', 'pill', 'lens'].includes(block.shape) ? 'summary' as const : 'reading' as const };
          return block.resourceId ? { ...common, resourceId: block.resourceId, subject: { kind: 'resource' as const, resourceId: block.resourceId } }
            : { ...common, subject: block.subject! };
        }), canUndo: history.undo.length > 0, canRedo: history.redo.length > 0,
      };
    });
  }
  listWorkspaces(): WorkspaceSummary[] {
    return this.db.prepare('SELECT * FROM workspaces ORDER BY created_at,id').all().map((w: any) => ({ workspaceId: w.id, projectId: w.project_id, title: w.title, version: w.version, state: w.state }));
  }
  createWorkspace(title: string, projectId: string | null = null, organizationOverride?: OrganizationUpdate): WorkspaceProjection {
    return this.atomic(() => {
      const w = this.kernel.createWorkspace(title, projectId); this.layout(w.id);
      const organization = updateOrganization(defaultOrganization(), organizationOverride ?? this.options.defaultOrganization);
      this.writeOrganization(w.id, organization);
      this.db.prepare('UPDATE workspace_engine_layouts SET legacy_organization_json=? WHERE workspace_id=?').run(JSON.stringify(organization), w.id);
      this.switchWorkspace(w.id); return this.project(w.id);
    });
  }
  preview(workspaceId: string, request: LayoutPreviewRequest) { return previewLayout(this.project(workspaceId), request); }
  renameWorkspace(workspaceId: string, title: string, expectedVersion: number): WorkspaceProjection {
    return this.atomic(() => { this.kernel.renameWorkspace(workspaceId, title, expectedVersion); return this.project(workspaceId); });
  }
  activeWorkspaceId(): string | null { return this.db.prepare('SELECT workspace_id FROM workspace_engine_session WHERE id=1').get()!.workspace_id as string | null; }
  switchWorkspace(workspaceId: string): WorkspaceProjection {
    return this.atomic(() => {
      const state = this.project(workspaceId);
      this.db.prepare('UPDATE workspace_engine_session SET workspace_id=? WHERE id=1').run(workspaceId);
      return state;
    });
  }
  private writePresentation(blockId: string, p: Presentation) {
    // Geometry remains canonical in kernel.blocks. Only independent presentation goes here.
    const extra = { shape: p.shape, rotation: p.rotation, minimized: p.minimized, locked: p.locked, materialVariant: p.materialVariant };
    this.db.prepare('INSERT INTO block_presentations VALUES(?,?) ON CONFLICT(block_id) DO UPDATE SET json=excluded.json').run(blockId, JSON.stringify(extra));
  }
  private attach(workspaceId: string, resourceId: string, p: Presentation): string {
    ensure(this.kernel.getResource(resourceId).resource.state === 'active', 'RESOURCE_ARCHIVED');
    const b = this.kernel.attachBlock(workspaceId, resourceId, { x: p.x, y: p.y, width: p.width, height: p.height, z: p.zIndex });
    this.writePresentation(b.id, p); return b.id;
  }
  private subject(block:{resourceId?:string;subject?:BlockSubjectRef}):BlockSubjectRef{if(block.resourceId)return {kind:'resource',resourceId:block.resourceId};ensure(block.subject,'INTEGRITY');return validateSubjectRef(block.subject);}
  private presentationOf(block:Presentation):Presentation{return Object.fromEntries(Object.keys(defaults).map(key=>[key,block[key as keyof Presentation]])) as Presentation;}
  private attachSubject(workspaceId:string,subject:NonResourceSubjectRef,p:Presentation):string{
    ensure(this.options.allowSubjectAttachment?.(subject,workspaceId)===true,'SUBJECT_POLICY_REQUIRED');
    const b=this.kernel.attachSubjectBlock(workspaceId,subject,{x:p.x,y:p.y,width:p.width,height:p.height,z:p.zIndex});this.writePresentation(b.id,p);return b.id;
  }
  private apply(workspaceId: string, updates: { blockId: string; expectedVersion: number; presentation: Partial<Presentation> }[], revision: number, viewport: Viewport) {
    const state = this.project(workspaceId), seen = new Set();
    const placements = updates.map(u => {
      ensure(u && text(u.blockId) && !seen.has(u.blockId), 'DUPLICATE_ID'); seen.add(u.blockId);
      const b = state.blocks.find(b => b.blockId === u.blockId); ensure(b, 'NOT_FOUND');
      ensure(b.version === u.expectedVersion, 'CONFLICT');
      ensure(!b.locked || (Object.keys(u.presentation).length === 1 && u.presentation.locked === false), 'LOCKED');
      const p = presentation(u.presentation, this.presentationOf(b)); this.writePresentation(u.blockId, p);
      return { blockId:u.blockId, expectedVersion: b.version, placement: { x: p.x, y: p.y, width: p.width, height: p.height, z: p.zIndex } };
    });
    return this.kernel.saveLayout(workspaceId, state.organization.mode === 'structured' ? 'structured' : 'freeform', viewport, placements, revision);
  }
  private restore(workspaceId: string, target: Snapshot, revision: number) {
    const current = this.kernel.openWorkspace(workspaceId);
    const seen = new Set();
    for (const b of target.blocks) {
      ensure(text(b.blockId) && !seen.has(b.blockId), 'DUPLICATE_ID'); seen.add(b.blockId);
      const subject=this.subject(b);if(subject.kind==='resource')this.kernel.getResource(subject.resourceId);else ensure(hash(this.kernel.readSubjectBinding(b.subjectBindingId!))===hash(subject),'INTEGRITY');
      const other = this.db.prepare('SELECT workspace_id FROM blocks WHERE id=?').get(b.blockId);
      ensure(!other || other.workspace_id === workspaceId, 'CONFLICT');
    }
    for (const b of current.blocks) this.kernel.detachBlock(b.id);
    for (const b of target.blocks) {
      const old = current.blocks.find(row => row.id === b.blockId);
      this.db.prepare('INSERT INTO blocks(id,workspace_id,resource_id,x,y,width,height,z,version,subject_ref_id) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(b.blockId, workspaceId, b.resourceId??null, b.x, b.y, b.width, b.height, b.zIndex, (old?.version ?? 0) + 1,b.subjectBindingId??null);
      this.writePresentation(b.blockId, b);
    }
    const oldPresence = this.readPresence(workspaceId);
    const presence = this.presencePatch(oldPresence, { x: target.presence.x, y: target.presence.y, width: target.presence.width, height: target.presence.height, locked: target.presence.locked });
    this.writePresence(workspaceId, { ...presence, version: oldPresence.version + 1 });
    const oldOrganization = this.readOrganization(workspaceId);
    this.writeOrganization(workspaceId, { ...target.organization, revision: oldOrganization.revision + 1 });
    this.kernel.saveLayout(workspaceId, target.organization.mode === 'structured' ? 'structured' : 'freeform', this.viewport(target.viewport), [], revision);
  }
  private resolve(workspaceId: string, options: PolicyOptions, initialOrganizationRevision: number): {
    changed: string[]; viewport: Viewport; unresolvedPlacementIds?: string[];
  } {
    const state = this.project(workspaceId), presence = state.presence, blocks = state.blocks;
    const result = applyOrganizationPolicy(state, options);
    const resolved = [...result.blocks.map(b => ({ ...b, id: b.blockId })), result.presence];
    const changed: string[] = [];
    for (const p of resolved) {
      if (p.id === presence.id) {
        if (p.x === presence.x && p.y === presence.y && p.width === presence.width && p.height === presence.height) continue;
        this.writePresence(workspaceId, { ...presence, x: p.x, y: p.y, width: p.width, height: p.height, version: presence.version + 1 });
      } else {
        const old = blocks.find(b => b.blockId === p.id)!;
        if (p.x === old.x && p.y === old.y && p.width === old.width && p.height === old.height) continue;
        this.db.prepare('UPDATE blocks SET x=?,y=?,width=?,height=?,version=version+1 WHERE id=?').run(p.x, p.y, p.width, p.height, p.id);
      }
      changed.push(p.id);
    }
    if (this.organizationChanged(state.organization, result.organization))
      this.writeOrganization(workspaceId, { ...result.organization, revision: Math.max(state.organization.revision, initialOrganizationRevision + 1) });
    return { changed, viewport: result.viewport, unresolvedPlacementIds: result.unresolvedPlacementIds };
  }
  execute(command: Command): CommandResult {
    ensure(command && text(command.commandId) && text(command.workspaceId));
    ensure(Number.isSafeInteger(command.expectedRevision) && command.expectedRevision > 0);
    ensure(Buffer.byteLength(JSON.stringify(command)) <= 262144, 'INPUT_TOO_LARGE');
    if (command.bounds) validateBounds(command.bounds);
    if ('placement' in command) ensure(['createBlock', 'attachResource', 'attachSubject'].includes(command.type) && (command.placement === undefined || command.placement === 'nearest-free'));
    const fingerprint = hash(command);
    return this.atomic(() => {
      const receipt = this.db.prepare('SELECT * FROM workspace_engine_receipts WHERE command_id=?').get(command.commandId);
      if (receipt) {
        ensure(receipt.fingerprint === fingerprint, 'COMMAND_ID_REUSED'); const result = JSON.parse(String(receipt.result_json));
        return { ...result, presence: result.presence ?? defaultPresence(command.workspaceId), organization: result.organization ?? JSON.parse(this.layout(command.workspaceId).legacy_organization_json) };
      }
      const state = this.project(command.workspaceId); ensure(state.revision === command.expectedRevision, 'CONFLICT');
      const workspaceId = state.workspaceId, before = this.snapshot(workspaceId), h = this.history(workspaceId);
      let checkpointId: string | undefined;
      const targets: string[] = [];
      const resizeIds: string[] = [];
      const policy: PolicyOptions = { bounds: command.bounds };
      const find = (blockId: string) => { const b = state.blocks.find(b => b.blockId === blockId); ensure(b, 'NOT_FOUND'); return b; };
      const patch = (blockId: string, p: Partial<Presentation>) => {
        const old = find(blockId); targets.push(blockId);
        if ((p.width !== undefined && p.width !== old.width) || (p.height !== undefined && p.height !== old.height) || (p.shape === 'circle' && old.width !== old.height)) resizeIds.push(blockId);
        return this.apply(workspaceId, [{ blockId, expectedVersion: old.version, presentation: p }], state.revision, state.viewport);
      };
      const newPresentation = (c: { templateId?: string; presentation?: Partial<Presentation>; placement?: 'nearest-free' }) => {
        const t = c.templateId ? templates.find(t => t.id === c.templateId) : undefined;
        ensure(!c.templateId || t, 'UNKNOWN_TEMPLATE');
        const next = presentation({ x: 32 + state.blocks.length % 10 * 24, y: 32 + state.blocks.length % 10 * 24, ...t?.presentation, ...c.presentation });
        if (c.placement !== 'nearest-free') return next;
        const anchors = [...state.blocks.map(b => ({ ...b, id: b.blockId })), state.presence];
        const vacant = state.organization.mode === 'structured'
          ? findVacantGridPlacement({ ...next, id: 'initial-placement', keepVisible: true, x: snapValue(next.x, STRUCTURED_GRID_SIZE), y: snapValue(next.y, STRUCTURED_GRID_SIZE) }, anchors, command.bounds, state.organization.gap)
          : findVacantPlacement({ ...next, id: 'initial-placement' }, anchors, command.bounds, state.organization.gap);
        return presentation({ x: vacant.x, y: vacant.y }, next);
      };
      switch (command.type) {
        case 'createBlock': {
          ensure(command.resource && ['note', 'conversation'].includes(command.resource.kind));
          const r = command.resource.kind === 'note'
            ? this.kernel.createNote(command.resource.title, command.resource.content, state.projectId)
            : this.kernel.createConversationRef(command.resource.title, state.projectId);
          targets.push(this.attach(workspaceId, r.id, newPresentation(command))); break;
        }
        case 'attachResource': targets.push(this.attach(workspaceId, command.resourceId, newPresentation(command))); break;
        case 'attachSubject': {const subject=validateSubjectRef(command.subject);ensure(subject.kind!=='resource','INVALID');targets.push(this.attachSubject(workspaceId,subject,newPresentation(command)));break;}
        case 'duplicateBlock': {
          const b=find(command.blockId),p=this.presentationOf(b),next=presentation({x:p.x+24,y:p.y+24,locked:false},p),subject=this.subject(b);
          targets.push(subject.kind==='resource'?this.attach(workspaceId,subject.resourceId,next):this.attachSubject(workspaceId,subject,next));break;
        }
        case 'detachBlock': ensure(!find(command.blockId).locked, 'LOCKED'); this.kernel.detachBlock(command.blockId); break;
        case 'moveBlock': patch(command.blockId, { x: snapValue(command.x, command.snap), y: snapValue(command.y, command.snap) }); break;
        case 'resizeBlock': {
          const b = find(command.blockId); const p = resize(b, command.width, command.height, command.aspectRatio, command.snap);
          patch(command.blockId, { width: p.width, height: p.height }); break;
        }
        case 'setBlockShape': patch(command.blockId, { shape: command.shape }); break;
        case 'setBlockLayer': patch(command.blockId, { zIndex: command.zIndex }); break;
        case 'layerBlock': {
          ensure(['front', 'back', 'raise', 'lower'].includes(command.direction)); const b = find(command.blockId);
          const zIndex = command.direction === 'front' ? Math.max(...state.blocks.map(b => b.zIndex)) + 1 : command.direction === 'back' ? Math.min(...state.blocks.map(b => b.zIndex)) - 1 : b.zIndex + (command.direction === 'raise' ? 1 : -1);
          patch(b.blockId, { zIndex }); break;
        }
        case 'setBlockLock': patch(command.blockId, { locked: command.locked }); break;
        case 'setBlockMinimized': {
          ensure(typeof command.minimized === 'boolean' && Number.isSafeInteger(command.expectedVersion) && command.expectedVersion > 0);
          const block = find(command.blockId);
          ensure(block.version === command.expectedVersion, 'CONFLICT');
          ensure((block.subjectState ?? block.resourceState) === 'active', 'SUBJECT_UNAVAILABLE');
          ensure(!block.locked, 'LOCKED');
          // A view-state change must not resolve collisions, reframe the camera,
          // rewrite dimensions or involve the independent Vela presence.
          if (block.minimized !== command.minimized) patch(block.blockId, { minimized: command.minimized });
          break;
        }
        case 'setBlockPresentation': patch(command.blockId, command.patch); break;
        case 'setPresence': {
          ensure(command.expectedVersion === state.presence.version, 'CONFLICT');
          const next = this.presencePatch(state.presence, command.presentation);
          ensure(!state.presence.locked || (Object.keys(command.presentation).length === 1 && command.presentation.locked === false), 'LOCKED');
          this.writePresence(workspaceId, { ...next, version: state.presence.version + 1 }); targets.push(next.id);
          if (next.width !== state.presence.width || next.height !== state.presence.height) resizeIds.push(next.id); break;
        }
        case 'resolveLayout': break;
        case 'optimizeLayout': policy.intent = 'optimize'; policy.movableBlockIds = command.movableBlockIds; break;
        case 'setOrganization': {
          ensure(command.expectedOrganizationRevision === undefined || command.expectedOrganizationRevision === state.organization.revision, 'CONFLICT');
          const next = updateOrganization(state.organization, command.organization);
          if (this.organizationChanged(state.organization, next)) this.writeOrganization(workspaceId, { ...next, revision: state.organization.revision + 1 });
          policy.intent = 'mode'; policy.spanOverrides = Object.keys(command.organization.structured?.spans ?? {}); break;
        }
        case 'applyStructuredPreset': {
          const next = updateOrganization(state.organization, { mode: 'structured', structured: { preset: command.preset } });
          this.writeOrganization(workspaceId, { ...next, revision: state.organization.revision + 1 }); policy.intent = 'mode'; policy.preset = command.preset; break;
        }
        case 'reorderPlacements': ensure(state.organization.mode === 'structured', 'UNSUPPORTED_POLICY'); ensure(Array.isArray(command.order), 'INVALID_ORDER'); policy.order = command.order; policy.intent = 'reorder'; break;
        case 'bringAllIntoView': policy.intent = 'recover'; break;
        case 'saveLayout': {
          ensure(Array.isArray(command.placements)); this.apply(workspaceId, command.placements, state.revision, this.viewport(command.viewport ?? state.viewport));
          for (const p of command.placements) { targets.push(p.blockId); const b = find(p.blockId); if ((p.presentation.width !== undefined && p.presentation.width !== b.width) || (p.presentation.height !== undefined && p.presentation.height !== b.height) || (p.presentation.shape === 'circle' && b.width !== b.height)) resizeIds.push(p.blockId); }
          if (!command.placements.length && (command.viewport || state.organization.mode !== 'fluid')) policy.intent = 'view';
          break;
        }
        case 'applyPreset': {
          const ps = presetGeometry(command.preset, state.blocks, command.width, command.height);
          if (state.organization.mode === 'freeform') policy.intent = 'move';
          this.apply(workspaceId, state.blocks.filter(b => !b.locked).map(b => {
            const p = ps[state.blocks.indexOf(b)];
            if (state.organization.mode === 'freeform') targets.push(b.blockId);
            return { blockId: b.blockId, expectedVersion: b.version, presentation: { x: p.x, y: p.y, width: p.width, height: p.height } };
          }), state.revision, state.viewport); break;
        }
        case 'undoLayout': case 'redoLayout': {
          const undo = command.type === 'undoLayout', src = undo ? h.undo : h.redo, dst = undo ? h.redo : h.undo;
          const entry = src.at(-1); ensure(entry, 'HISTORY_EMPTY');
          ensure(hash(before) === hash(undo ? entry.after : entry.before), 'HISTORY_DIVERGED');
          this.restore(workspaceId, undo ? entry.before : entry.after, state.revision);
          dst.push(src.pop()!); this.writeHistory(workspaceId, h); break;
        }
        case 'checkpoint':
          ensure(text(command.name));
          ensure(Number(this.db.prepare('SELECT count(*) AS n FROM workspace_engine_checkpoints WHERE workspace_id=?').get(workspaceId)!.n) < 64, 'CHECKPOINT_LIMIT');
          checkpointId = randomUUID();
          this.db.prepare('INSERT INTO workspace_engine_checkpoints VALUES(?,?,?,?,?)').run(checkpointId, workspaceId, command.name.trim(), JSON.stringify(before), now()); break;
        case 'restoreCheckpoint': {
          const row = this.db.prepare('SELECT snapshot_json FROM workspace_engine_checkpoints WHERE id=? AND workspace_id=?').get(command.checkpointId, workspaceId);
          ensure(row, 'NOT_FOUND'); this.restore(workspaceId, this.normalizeSnapshot(workspaceId, JSON.parse(String(row.snapshot_json))), state.revision);
          if (this.readOrganization(workspaceId).mode !== 'fluid') policy.intent = 'view';
          break;
        }
        default: throw new WorkspaceError('UNKNOWN_COMMAND');
      }
      policy.targets = targets; policy.resizeIds = resizeIds; policy.intent ??= resizeIds.length ? 'resize' : targets.length ? 'move' : 'resolve';
      const resolve = ['createBlock', 'attachResource', 'attachSubject', 'duplicateBlock', 'moveBlock', 'resizeBlock', 'setBlockShape', 'setBlockPresentation', 'setPresence', 'saveLayout', 'applyPreset', 'resolveLayout', 'optimizeLayout', 'restoreCheckpoint', 'setOrganization', 'applyStructuredPreset', 'reorderPlacements', 'bringAllIntoView'].includes(command.type);
      // Fluid's nearest-free search already reserved every existing footprint.
      // A second pass would treat a valid overflow placement like a drag and
      // pull it into bounds by moving cards the user didn't touch.
      const fluidVacancy = state.organization.mode === 'fluid' && 'placement' in command && command.placement === 'nearest-free';
      const resolved = resolve && !fluidVacancy ? this.resolve(workspaceId, { ...policy, before: state }, state.organization.revision) :
        { changed: [], viewport: state.viewport, unresolvedPlacementIds: undefined };
      const rearrangedPlacementIds = resolved.changed;
      const noOp = ['resolveLayout', 'optimizeLayout', 'setOrganization', 'bringAllIntoView', 'reorderPlacements', 'setBlockMinimized'].includes(command.type) && hash(before) === hash(this.snapshot(workspaceId)) && hash(state.viewport) === hash(resolved.viewport);
      if (!noOp && this.kernel.openWorkspace(workspaceId).layout.version === state.revision)
        this.kernel.saveLayout(workspaceId, this.readOrganization(workspaceId).mode === 'structured' ? 'structured' : 'freeform', resolved.viewport, [], state.revision);
      if (!noOp && !['undoLayout', 'redoLayout', 'checkpoint'].includes(command.type)) {
        const after = this.snapshot(workspaceId);
        h.undo.push({ before, after }); h.redo = []; this.writeHistory(workspaceId, h);
      }
      const result: CommandResult = { ...this.project(workspaceId), ...(checkpointId ? { checkpointId } : {}),
        ...(resolved.unresolvedPlacementIds === undefined ? {} : { unresolvedPlacementIds: resolved.unresolvedPlacementIds }) };
      this.db.prepare('INSERT INTO workspace_engine_receipts VALUES(?,?,?)').run(command.commandId, fingerprint, JSON.stringify(result));
      // Retried commands outside this bounded receipt window fail revision checks.
      this.db.exec('DELETE FROM workspace_engine_receipts WHERE rowid NOT IN (SELECT rowid FROM workspace_engine_receipts ORDER BY rowid DESC LIMIT 256)');
      if (!noOp) this.db.prepare(`INSERT INTO change_events(id,entity_kind,entity_id,resource_version,occurred_at,origin,correlation_id,type,detail_json)
        VALUES(?,'workspace',?,?,?,'user',?,?,?)`).run(randomUUID(), workspaceId, result.revision, now(), command.commandId, `engine.${command.type}`, JSON.stringify({ layoutId: result.layoutId, rearrangedPlacementIds }));
      return result;
    });
  }
  listCheckpoints(workspaceId: string): { id: string; name: string; created_at: string }[] {
    return this.db.prepare('SELECT id,name,created_at FROM workspace_engine_checkpoints WHERE workspace_id=? ORDER BY created_at,id').all(workspaceId) as any;
  }
  setResourceArchived(resourceId: string, archived: boolean, expectedVersion: number) {
    return this.kernel.setResourceArchived(resourceId, archived, expectedVersion);
  }
  deleteResource(resourceId: string, expectedVersion: number, approvalId: string): void {
    ensure(text(approvalId) && this.options.allowResourceDeletion?.({ resourceId, expectedVersion, approvalId }) === true, 'DELETE_POLICY_REQUIRED');
    this.atomic(() => {
      // Keep history/checkpoints recoverable; forgetting recovery data is a separate policy decision.
      const history = this.db.prepare('SELECT history_json AS json FROM workspace_engine_layouts UNION ALL SELECT snapshot_json AS json FROM workspace_engine_checkpoints UNION ALL SELECT json FROM workspace_engine_v2_recovery_archive UNION ALL SELECT json FROM workspace_engine_v3_recovery_archive').all();
      ensure(!history.some(row => String(row.json).includes(resourceId)), 'RECOVERY_REFERENCE');
      this.kernel.deleteResource(resourceId, expectedVersion, { correlationId: approvalId });
    });
  }
}
