import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { WorkspaceKernel } from '../../workspace-kernel/kernel.mts';
import type { DesktopCommand, DesktopSnapshot, NavigationTarget, Block, Geometry, BlockKind, Resource, Shape } from '../../application-contract/contracts.ts';

const check = (v: unknown, code = 'invalid_desktop_command'): void => { if (!v) throw Object.assign(new Error(code), { code }); };
const title = (v: unknown): string => { check(typeof v === 'string' && v.trim().length > 0 && v.length <= 200); return (v as string).trim(); };
const kinds = ['conversation', 'note', 'research', 'task', 'reference', 'stream'];
const shapes = ['rectangle', 'rounded', 'circle'];
type Session = { activeWorkspaceId: string | null; navigation: NavigationTarget; history: NavigationTarget[]; revision: number };
type LayoutCopy = { blocks: Block[] };

/** Versioned desktop extension of the existing kernel, never a second resource store. */
export class DesktopState {
  private kernel: WorkspaceKernel;
  private db: DatabaseSync;
  constructor(kernel: WorkspaceKernel, db: DatabaseSync) {
    this.kernel = kernel; this.db = db;
    kernel.withTransaction(() => {
      db.exec(`CREATE TABLE IF NOT EXISTS desktop_schema(version INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS desktop_resources(resource_id TEXT PRIMARY KEY REFERENCES resources(id), kind TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS desktop_blocks(block_id TEXT PRIMARY KEY REFERENCES blocks(id) ON DELETE CASCADE, shape TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS desktop_session(id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS desktop_undo(id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT NOT NULL REFERENCES workspaces(id), json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS desktop_checkpoints(workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id), json TEXT NOT NULL);`);
      const versions = db.prepare('SELECT version FROM desktop_schema').all();
      if (!versions.length) db.prepare('INSERT INTO desktop_schema VALUES(1)').run();
      else check(versions.length === 1 && versions[0].version === 1, 'unsupported_desktop_schema');
      const existing = db.prepare('SELECT id FROM workspaces ORDER BY created_at LIMIT 1').get();
      const activeWorkspaceId = existing ? String(existing.id) : null;
      db.prepare('INSERT OR IGNORE INTO desktop_session VALUES(1,?)').run(JSON.stringify({ activeWorkspaceId, navigation: activeWorkspaceId ? { kind: 'workspace', workspaceId: activeWorkspaceId } : { kind: 'constellation', projectId: null }, history: [], revision: 1 }));
    });
  }
  private session(): Session { return JSON.parse(String(this.db.prepare('SELECT json FROM desktop_session WHERE id=1').get()!.json)); }
  private saveSession(s: Session) { s.revision++; this.db.prepare('UPDATE desktop_session SET json=? WHERE id=1').run(JSON.stringify(s)); }
  private workspace(id: unknown) { check(typeof id === 'string'); return this.kernel.openWorkspace(id as string); }
  private block(id: string, expected?: number): Block {
    const row = this.db.prepare(`SELECT b.*, coalesce(d.shape,'rectangle') AS shape FROM blocks b LEFT JOIN desktop_blocks d ON d.block_id=b.id WHERE b.id=?`).get(id) as Block | undefined;
    check(row, 'block_not_found'); if (expected !== undefined) check(row!.version === expected, 'stale_block_version'); return row!;
  }
  private blocks(id: string): Block[] { return this.db.prepare(`SELECT b.*, coalesce(d.shape,'rectangle') AS shape FROM blocks b LEFT JOIN desktop_blocks d ON d.block_id=b.id WHERE b.workspace_id=? ORDER BY b.z,b.id`).all(id) as Block[]; }
  private remember(id: string) {
    this.db.prepare('INSERT INTO desktop_undo(workspace_id,json) VALUES(?,?)').run(id, JSON.stringify({ blocks: this.blocks(id) }));
    this.db.prepare('DELETE FROM desktop_undo WHERE workspace_id=? AND id NOT IN (SELECT id FROM desktop_undo WHERE workspace_id=? ORDER BY id DESC LIMIT 32)').run(id, id);
  }
  private geometry(p: Geometry) {
    check(p && ['x', 'y', 'width', 'height', 'z'].every(k => Number.isFinite(p[k as keyof Geometry])));
    check(Math.abs(p.x) <= 50000 && Math.abs(p.y) <= 50000 && p.width >= 240 && p.width <= 2400 && p.height >= 160 && p.height <= 1800 && Number.isInteger(p.z) && Math.abs(p.z) <= 10000, 'invalid_geometry');
  }
  private attach(workspaceId: string, resourceId: string) {
    const data = this.workspace(workspaceId); this.kernel.getResource(resourceId);
    const n = data.blocks.length;
    const b = this.kernel.attachBlock(workspaceId, resourceId, { x: 70 + (n % 3) * 440, y: 260 + Math.floor(n / 3) * 300, width: 400, height: 250, z: n });
    this.db.prepare('INSERT INTO desktop_blocks VALUES(?,?)').run(b.id, 'rectangle'); return b;
  }
  private navigate(s: Session, target: NavigationTarget, remember = true) {
    check(target && (target.kind === 'workspace' || target.kind === 'constellation'));
    if (target.kind === 'workspace') { this.workspace(target.workspaceId); s.activeWorkspaceId = target.workspaceId; }
    else if (target.projectId !== null) check(this.db.prepare('SELECT id FROM projects WHERE id=?').get(target.projectId), 'project_not_found');
    if (remember && JSON.stringify(target) !== JSON.stringify(s.navigation)) s.history = [...s.history, s.navigation].slice(-64);
    s.navigation = target;
  }
  private restore(workspaceId: string, copy: LayoutCopy) {
    // Restores placements with original IDs; resource content is deliberately independent.
    for (const b of this.blocks(workspaceId)) this.kernel.detachBlock(b.id);
    for (const b of copy.blocks) {
      this.kernel.getResource(b.resource_id); this.geometry(b); check(shapes.includes(b.shape));
      this.db.prepare('INSERT INTO blocks(id,workspace_id,resource_id,x,y,width,height,z,version) VALUES(?,?,?,?,?,?,?,?,?)').run(b.id, workspaceId, b.resource_id, b.x, b.y, b.width, b.height, b.z, b.version + 1);
      this.db.prepare('INSERT INTO desktop_blocks VALUES(?,?)').run(b.id, b.shape);
    }
    const data = this.workspace(workspaceId);
    this.kernel.saveLayout(workspaceId, 'freeform', JSON.parse(data.layout.viewport_json), [], data.layout.version);
  }
  apply(a: DesktopCommand, createConversation: (title: string, codex: boolean) => string): void {
    check(a && typeof a.type === 'string');
    if (a.type === 'snapshot') return;
    const s = this.session();
    switch (a.type) {
      case 'createProject': this.kernel.createProject(title(a.title)); break;
      case 'createWorkspace': { const w = this.kernel.createWorkspace(title(a.title), a.projectId); this.navigate(s, { kind: 'workspace', workspaceId: w.id }); break; }
      case 'renameWorkspace': this.kernel.renameWorkspace(a.workspaceId, title(a.title), a.expectedVersion); break;
      case 'navigate': this.navigate(s, a.target); break;
      case 'back': { const target = s.history.pop(); if (target) this.navigate(s, target, false); break; }
      case 'createResource': {
        check(kinds.includes(a.kind)); check(a.provider === undefined || ['local', 'codex'].includes(a.provider));
        if (a.workspaceId !== null) this.workspace(a.workspaceId);
        const resourceId = a.kind === 'conversation' ? createConversation(title(a.title), a.provider === 'codex') : this.kernel.createNote(title(a.title), '', a.workspaceId ? this.workspace(a.workspaceId).workspace.project_id : null).id;
        this.db.prepare('INSERT INTO desktop_resources VALUES(?,?)').run(resourceId, a.kind);
        if (a.workspaceId) { this.remember(a.workspaceId); this.attach(a.workspaceId, resourceId); }
        break;
      }
      case 'attach': this.remember(a.workspaceId); this.attach(a.workspaceId, a.resourceId); break;
      case 'detach': { const b = this.block(a.blockId, a.expectedVersion); this.remember(b.workspace_id); this.kernel.detachBlock(b.id); break; }
      case 'geometry': {
        const b = this.block(a.blockId, a.expectedVersion); this.geometry(a.placement); check(shapes.includes(a.shape)); this.remember(b.workspace_id);
        const data = this.workspace(b.workspace_id);
        this.kernel.saveLayout(b.workspace_id, 'freeform', JSON.parse(data.layout.viewport_json), [{ blockId: b.id, expectedVersion: b.version, placement: a.placement }], data.layout.version);
        this.db.prepare('INSERT INTO desktop_blocks VALUES(?,?) ON CONFLICT(block_id) DO UPDATE SET shape=excluded.shape').run(b.id, a.shape); break;
      }
      case 'content': check(typeof a.content === 'string' && Buffer.byteLength(a.content) <= 100000, 'content_too_large'); this.kernel.updateNote(a.resourceId, a.content, a.expectedVersion); break;
      case 'checkpoint': check(s.activeWorkspaceId, 'workspace_required'); this.db.prepare('INSERT INTO desktop_checkpoints VALUES(?,?) ON CONFLICT(workspace_id) DO UPDATE SET json=excluded.json').run(s.activeWorkspaceId!, JSON.stringify({ blocks: this.blocks(s.activeWorkspaceId!) })); break;
      case 'restore': {
        check(s.activeWorkspaceId, 'workspace_required'); const row = this.db.prepare('SELECT json FROM desktop_checkpoints WHERE workspace_id=?').get(s.activeWorkspaceId!); check(row, 'checkpoint_missing'); this.remember(s.activeWorkspaceId!); this.restore(s.activeWorkspaceId!, JSON.parse(String(row!.json))); break;
      }
      case 'undo': {
        check(s.activeWorkspaceId, 'workspace_required'); const row = this.db.prepare('SELECT id,json FROM desktop_undo WHERE workspace_id=? ORDER BY id DESC LIMIT 1').get(s.activeWorkspaceId!); check(row, 'undo_empty'); this.restore(s.activeWorkspaceId!, JSON.parse(String(row!.json))); this.db.prepare('DELETE FROM desktop_undo WHERE id=?').run(row!.id); break;
      }
      default: check(false, 'unsupported_desktop_command');
    }
    this.saveSession(s);
    this.db.prepare(`INSERT INTO change_events(id,entity_kind,entity_id,resource_version,occurred_at,origin,correlation_id,type,detail_json) VALUES(?,?,?,?,?,?,?,?,?)`).run(randomUUID(), 'desktop', s.activeWorkspaceId ?? 'home', s.revision, new Date().toISOString(), 'user', randomUUID(), 'desktop.' + a.type, '{}');
  }
  snapshot(conversations: (id: string) => Pick<Resource, 'provider' | 'messages'>): DesktopSnapshot {
    const s = this.session();
    const resources = this.kernel.searchResources().map(r => {
      const entry = this.kernel.getResource(r.id);
      const kind = (this.db.prepare('SELECT kind FROM desktop_resources WHERE resource_id=?').get(r.id)?.kind ?? (r.kind === 'generic' ? 'reference' : r.kind)) as BlockKind;
      return { id: r.id, title: r.title, kind, version: r.version, content: entry.note?.content ?? '', provider: 'local' as const, messages: [], ...(r.kind === 'conversation' ? conversations(r.id) : {}) };
    });
    const w = s.activeWorkspaceId ? this.workspace(s.activeWorkspaceId) : null;
    return { contract: 'aerynth.desktop@1', projects: this.db.prepare("SELECT * FROM projects WHERE state='active' ORDER BY created_at").all() as any, workspaces: this.db.prepare("SELECT * FROM workspaces WHERE state='active' ORDER BY created_at").all() as any, resources, blocks: s.activeWorkspaceId ? this.blocks(s.activeWorkspaceId) : [], relationships: this.db.prepare('SELECT * FROM relationships').all() as any, ...s, layoutVersion: w?.layout.version ?? 0, canUndo: !!this.db.prepare('SELECT id FROM desktop_undo WHERE workspace_id=? LIMIT 1').get(s.activeWorkspaceId), hasCheckpoint: !!this.db.prepare('SELECT workspace_id FROM desktop_checkpoints WHERE workspace_id=?').get(s.activeWorkspaceId) };
  }
}
