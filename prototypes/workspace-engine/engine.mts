import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { WorkspaceKernel } from '../workspace-kernel/kernel.mts';
import { CONTRACT, type Command, type CommandResult, type WorkspaceProjection, type Presentation, type Viewport, type BlockTemplate, type WorkspaceSummary, type PresencePlacement, type Geometry } from './contracts.mts';
import { ensure, WorkspaceError, defaults, presentation, resize, snapValue, presetGeometry } from './geometry.mts';
import { resolveCollisions, validateBounds } from './collisions.mts';
export { WorkspaceError } from './geometry.mts';
export type * from './contracts.mts';

type StoredBlock = Presentation & { blockId: string; resourceId: string };
type StoredPresence = Omit<PresencePlacement, 'version'>;
type Snapshot = { viewport: Viewport; blocks: StoredBlock[]; presence: StoredPresence };
type Entry = { before: Snapshot; after: Snapshot };
type History = { undo: Entry[]; redo: Entry[] };
const files = ['001-presentation.sql', '002-history.sql', '003-presence.sql'];
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
}
/** Main-process service. Owns no database connection and never stores resource content. */
export class WorkspaceEngine {
  readonly kernel: WorkspaceKernel;
  private db!: DatabaseSync;
  private options: EngineOptions;
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
      while (version < files.length) {
        db.exec(readFileSync(new URL(`./migrations/${files[version]}`, import.meta.url), 'utf8'));
        version++;
        db.prepare('UPDATE workspace_engine_schema SET version=?').run(version);
      }
      for (const w of db.prepare('SELECT id FROM workspaces').all()) {
        const workspaceId = String(w.id); this.layout(workspaceId);
        if (upgradePresence) {
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
    return row;
  }
  private readPresence(workspaceId: string): PresencePlacement {
    const p = JSON.parse(this.layout(workspaceId).presence_json) as PresencePlacement;
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
  private normalizeSnapshot(workspaceId: string, snapshot: any, baseline?: PresencePlacement): Snapshot {
    ensure(snapshot && Array.isArray(snapshot.blocks) && snapshot.viewport, 'INTEGRITY');
    const { version, ...presence } = snapshot.presence ?? baseline ?? JSON.parse(this.layout(workspaceId).legacy_presence_json);
    return { ...snapshot, presence };
  }
  private viewport(v: any): Viewport {
    ensure(v && typeof v === 'object' && !Array.isArray(v));
    const p = { x: v.x ?? 0, y: v.y ?? 0, zoom: v.zoom ?? 1, ...(v.displayId === undefined ? {} : { displayId: v.displayId }) };
    ensure(Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) <= 1e6 && Math.abs(p.y) <= 1e6);
    ensure(Number.isFinite(p.zoom) && p.zoom >= 0.1 && p.zoom <= 4);
    ensure(p.displayId === undefined || text(p.displayId));
    return p;
  }
  private block(row: any): StoredBlock {
    const extra = this.db.prepare('SELECT json FROM block_presentations WHERE block_id=?').get(row.id);
    // Legacy geometry is preserved exactly, even if smaller than new interaction minima.
    const p = extra ? JSON.parse(String(extra.json)) : {};
    const valid = presentation(p);
    return { ...valid, x: row.x, y: row.y, width: row.width, height: row.height, zIndex: row.z, blockId: row.id, resourceId: row.resource_id };
  }
  private snapshot(workspaceId: string): Snapshot {
    const state = this.kernel.openWorkspace(workspaceId);
    const { version, ...presence } = this.readPresence(workspaceId);
    return { viewport: this.viewport(state.layout.viewport), presence, blocks: state.blocks.map(row => this.block(row)).sort((a, b) => a.blockId.localeCompare(b.blockId)) };
  }
  private history(workspaceId: string): History {
    const h = JSON.parse(this.layout(workspaceId).history_json);
    ensure(h && Array.isArray(h.undo) && Array.isArray(h.redo), 'INTEGRITY');
    const baseline = JSON.parse(this.layout(workspaceId).legacy_presence_json);
    for (const stack of [h.undo, h.redo]) for (const entry of stack) {
      entry.before = this.normalizeSnapshot(workspaceId, entry.before, baseline); entry.after = this.normalizeSnapshot(workspaceId, entry.after, baseline);
    }
    return h;
  }
  private writeHistory(workspaceId: string, h: History) {
    // Explicit finite recovery window: most recent 100 committed layout operations.
    h.undo = h.undo.slice(-100); h.redo = h.redo.slice(-100);
    this.db.prepare('UPDATE workspace_engine_layouts SET history_json=? WHERE workspace_id=?').run(JSON.stringify(h), workspaceId);
  }
  project(workspaceId: string): WorkspaceProjection {
    return this.atomic(() => {
      const state = this.kernel.openWorkspace(workspaceId), l = this.layout(workspaceId), h = this.history(workspaceId);
      return {
        contract: CONTRACT, workspaceId, projectId: state.workspace.project_id, title: state.workspace.title,
        workspaceVersion: state.workspace.version, layoutId: l.id, revision: state.layout.version,
        viewport: this.viewport(state.layout.viewport), presence: this.readPresence(workspaceId),
        blocks: state.blocks.map(row => {
          const b = this.block(row);
          return { ...b, workspaceId, version: row.version, resourceState: this.kernel.getResource(b.resourceId).resource.state,
            contentMode: b.minimized || ['circle', 'pill', 'lens'].includes(b.shape) ? 'summary' as const : 'reading' as const };
        }), canUndo: h.undo.length > 0, canRedo: h.redo.length > 0,
      };
    });
  }
  listWorkspaces(): WorkspaceSummary[] {
    return this.db.prepare('SELECT * FROM workspaces ORDER BY created_at,id').all().map((w: any) => ({ workspaceId: w.id, projectId: w.project_id, title: w.title, version: w.version, state: w.state }));
  }
  createWorkspace(title: string, projectId: string | null = null): WorkspaceProjection {
    return this.atomic(() => {
      const w = this.kernel.createWorkspace(title, projectId); this.layout(w.id);
      this.switchWorkspace(w.id); return this.project(w.id);
    });
  }
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
  private apply(workspaceId: string, updates: { blockId: string; expectedVersion: number; presentation: Partial<Presentation> }[], revision: number, viewport: Viewport) {
    const state = this.project(workspaceId), seen = new Set();
    const placements = updates.map(u => {
      ensure(u && text(u.blockId) && !seen.has(u.blockId), 'DUPLICATE_ID'); seen.add(u.blockId);
      const b = state.blocks.find(b => b.blockId === u.blockId); ensure(b, 'NOT_FOUND');
      ensure(b.version === u.expectedVersion, 'CONFLICT');
      ensure(!b.locked || (Object.keys(u.presentation).length === 1 && u.presentation.locked === false), 'LOCKED');
      const { blockId, resourceId, workspaceId: _workspaceId, version, resourceState, contentMode, ...base } = b;
      const p = presentation(u.presentation, base); this.writePresentation(blockId, p);
      return { blockId, expectedVersion: b.version, placement: { x: p.x, y: p.y, width: p.width, height: p.height, z: p.zIndex } };
    });
    return this.kernel.saveLayout(workspaceId, 'freeform', viewport, placements, revision);
  }
  private restore(workspaceId: string, target: Snapshot, revision: number) {
    const current = this.kernel.openWorkspace(workspaceId);
    const seen = new Set();
    for (const b of target.blocks) {
      ensure(text(b.blockId) && !seen.has(b.blockId), 'DUPLICATE_ID'); seen.add(b.blockId);
      this.kernel.getResource(b.resourceId);
      const other = this.db.prepare('SELECT workspace_id FROM blocks WHERE id=?').get(b.blockId);
      ensure(!other || other.workspace_id === workspaceId, 'CONFLICT');
    }
    for (const b of current.blocks) this.kernel.detachBlock(b.id);
    for (const b of target.blocks) {
      const old = current.blocks.find(row => row.id === b.blockId);
      this.db.prepare('INSERT INTO blocks(id,workspace_id,resource_id,x,y,width,height,z,version) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(b.blockId, workspaceId, b.resourceId, b.x, b.y, b.width, b.height, b.zIndex, (old?.version ?? 0) + 1);
      this.writePresentation(b.blockId, b);
    }
    const oldPresence = this.readPresence(workspaceId);
    const presence = this.presencePatch(oldPresence, { x: target.presence.x, y: target.presence.y, width: target.presence.width, height: target.presence.height, locked: target.presence.locked });
    this.writePresence(workspaceId, { ...presence, version: oldPresence.version + 1 });
    this.kernel.saveLayout(workspaceId, 'freeform', this.viewport(target.viewport), [], revision);
  }
  private resolve(workspaceId: string, targets: string[], bounds?: Geometry): string[] {
    const state = this.kernel.openWorkspace(workspaceId), presence = this.readPresence(workspaceId);
    const blocks = state.blocks.map(row => this.block(row));
    const inputs = blocks.map(b => ({ ...b, id: b.blockId }));
    const resolved = resolveCollisions([...inputs, { ...presence, keepVisible: true }], targets, bounds);
    const changed: string[] = [];
    for (const p of resolved) {
      if (p.id === presence.id) {
        if (p.x === presence.x && p.y === presence.y) continue;
        this.writePresence(workspaceId, { ...presence, x: p.x, y: p.y, version: presence.version + 1 });
      } else {
        const old = blocks.find(b => b.blockId === p.id)!;
        if (p.x === old.x && p.y === old.y) continue;
        this.db.prepare('UPDATE blocks SET x=?,y=?,version=version+1 WHERE id=?').run(p.x, p.y, p.id);
      }
      changed.push(p.id);
    }
    return changed;
  }
  execute(command: Command): CommandResult {
    ensure(command && text(command.commandId) && text(command.workspaceId));
    ensure(Number.isSafeInteger(command.expectedRevision) && command.expectedRevision > 0);
    ensure(Buffer.byteLength(JSON.stringify(command)) <= 262144, 'INPUT_TOO_LARGE');
    if (command.bounds) validateBounds(command.bounds);
    const fingerprint = hash(command);
    return this.atomic(() => {
      const receipt = this.db.prepare('SELECT * FROM workspace_engine_receipts WHERE command_id=?').get(command.commandId);
      if (receipt) {
        ensure(receipt.fingerprint === fingerprint, 'COMMAND_ID_REUSED'); const result = JSON.parse(String(receipt.result_json));
        return { ...result, presence: result.presence ?? defaultPresence(command.workspaceId) };
      }
      const state = this.project(command.workspaceId); ensure(state.revision === command.expectedRevision, 'CONFLICT');
      const workspaceId = state.workspaceId, before = this.snapshot(workspaceId), h = this.history(workspaceId);
      let checkpointId: string | undefined;
      const targets: string[] = [];
      const find = (blockId: string) => { const b = state.blocks.find(b => b.blockId === blockId); ensure(b, 'NOT_FOUND'); return b; };
      const patch = (blockId: string, p: Partial<Presentation>) => { targets.push(blockId); return this.apply(workspaceId, [{ blockId, expectedVersion: find(blockId).version, presentation: p }], state.revision, state.viewport); };
      const newPresentation = (c: { templateId?: string; presentation?: Partial<Presentation> }) => {
        const t = c.templateId ? templates.find(t => t.id === c.templateId) : undefined;
        ensure(!c.templateId || t, 'UNKNOWN_TEMPLATE');
        return presentation({ x: 32 + state.blocks.length % 10 * 24, y: 32 + state.blocks.length % 10 * 24, ...t?.presentation, ...c.presentation });
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
        case 'duplicateBlock': {
          const { blockId, resourceId, workspaceId: _w, version, resourceState, contentMode, ...p } = find(command.blockId);
          targets.push(this.attach(workspaceId, resourceId, presentation({ x: p.x + 24, y: p.y + 24, locked: false }, p))); break;
        }
        case 'detachBlock': ensure(!find(command.blockId).locked, 'LOCKED'); this.kernel.detachBlock(command.blockId); break;
        case 'moveBlock': patch(command.blockId, { x: snapValue(command.x, command.snap), y: snapValue(command.y, command.snap) }); break;
        case 'resizeBlock': {
          const b = find(command.blockId); const p = resize(b, command.width, command.height, command.aspectRatio, command.snap);
          patch(command.blockId, { width: p.width, height: p.height }); break;
        }
        case 'setBlockShape': patch(command.blockId, { shape: command.shape }); break;
        case 'setBlockLayer': patch(command.blockId, { zIndex: command.zIndex }); break;
        case 'setBlockLock': patch(command.blockId, { locked: command.locked }); break;
        case 'setBlockPresentation': patch(command.blockId, command.patch); break;
        case 'setPresence': {
          ensure(command.expectedVersion === state.presence.version, 'CONFLICT');
          const next = this.presencePatch(state.presence, command.presentation);
          ensure(!state.presence.locked || (Object.keys(command.presentation).length === 1 && command.presentation.locked === false), 'LOCKED');
          this.writePresence(workspaceId, { ...next, version: state.presence.version + 1 }); targets.push(next.id); break;
        }
        case 'resolveLayout': break;
        case 'saveLayout': ensure(Array.isArray(command.placements)); this.apply(workspaceId, command.placements, state.revision, this.viewport(command.viewport ?? state.viewport)); targets.push(...command.placements.map(p => p.blockId)); break;
        case 'applyPreset': {
          const ps = presetGeometry(command.preset, state.blocks, command.width, command.height);
          this.apply(workspaceId, state.blocks.filter(b => !b.locked).map(b => {
            const p = ps[state.blocks.indexOf(b)];
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
          ensure(row, 'NOT_FOUND'); this.restore(workspaceId, this.normalizeSnapshot(workspaceId, JSON.parse(String(row.snapshot_json))), state.revision); break;
        }
        default: throw new WorkspaceError('UNKNOWN_COMMAND');
      }
      const resolve = ['createBlock', 'attachResource', 'duplicateBlock', 'moveBlock', 'resizeBlock', 'setBlockShape', 'setBlockPresentation', 'setPresence', 'saveLayout', 'applyPreset', 'resolveLayout', 'restoreCheckpoint'].includes(command.type);
      const rearrangedPlacementIds = resolve ? this.resolve(workspaceId, targets, command.bounds) : [];
      const noOp = command.type === 'resolveLayout' && !rearrangedPlacementIds.length;
      if (!noOp && this.kernel.openWorkspace(workspaceId).layout.version === state.revision)
        this.kernel.saveLayout(workspaceId, 'freeform', state.viewport, [], state.revision);
      if (!noOp && !['undoLayout', 'redoLayout', 'checkpoint'].includes(command.type)) {
        const after = this.snapshot(workspaceId);
        h.undo.push({ before, after }); h.redo = []; this.writeHistory(workspaceId, h);
      }
      const result: CommandResult = { ...this.project(workspaceId), ...(checkpointId ? { checkpointId } : {}) };
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
      const history = this.db.prepare('SELECT history_json AS json FROM workspace_engine_layouts UNION ALL SELECT snapshot_json AS json FROM workspace_engine_checkpoints UNION ALL SELECT json FROM workspace_engine_v2_recovery_archive').all();
      ensure(!history.some(row => String(row.json).includes(resourceId)), 'RECOVERY_REFERENCE');
      this.kernel.deleteResource(resourceId, expectedVersion, { correlationId: approvalId });
    });
  }
}
