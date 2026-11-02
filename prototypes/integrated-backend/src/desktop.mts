import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { WorkspaceEngine } from "../../workspace-engine/engine.mts";
import type { Command as EngineCommand } from "../../workspace-engine/contracts.mts";
import type { WorkspaceKernel } from "../../workspace-kernel/kernel.mts";
import type {
  DesktopCommand,
  DesktopSnapshot,
  NavigationTarget,
  Block,
  Geometry,
  BlockKind,
  Resource,
  Shape,
} from "../../application-contract/contracts.ts";

const check = (v: unknown, code = "invalid_desktop_command"): void => {
  if (!v) throw Object.assign(new Error(code), { code });
};
const title = (v: unknown): string => {
  check(typeof v === "string" && v.trim().length > 0 && v.length <= 200);
  return (v as string).trim();
};
const kinds = [
  "conversation",
  "note",
  "research",
  "task",
  "reference",
  "stream",
];
const shapes = ["rectangle", "rounded", "circle", "pill", "folio", "lens"];
type Session = {
  activeWorkspaceId: string | null;
  navigation: NavigationTarget;
  history: NavigationTarget[];
  revision: number;
};
type LayoutCopy = { blocks: Block[] };

/** Versioned desktop extension of the existing kernel, never a second resource store. */
export class DesktopState {
  private kernel: WorkspaceKernel;
  private db: DatabaseSync;
  private engine!: WorkspaceEngine;
  constructor(kernel: WorkspaceKernel, db: DatabaseSync) {
    this.kernel = kernel;
    this.db = db;
    kernel.withTransaction(() => {
      db.exec(`CREATE TABLE IF NOT EXISTS desktop_schema(version INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS desktop_resources(resource_id TEXT PRIMARY KEY REFERENCES resources(id), kind TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS desktop_blocks(block_id TEXT PRIMARY KEY REFERENCES blocks(id) ON DELETE CASCADE, shape TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS desktop_session(id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS desktop_undo(id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT NOT NULL REFERENCES workspaces(id), json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS desktop_checkpoints(workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id), json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS desktop_view_state(id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL);`);
      const versions = db.prepare("SELECT version FROM desktop_schema").all();
      if (!versions.length)
        db.prepare("INSERT INTO desktop_schema VALUES(1)").run();
      else
        check(
          versions.length === 1 &&
            [1, 2, 3].includes(Number(versions[0].version)),
          "unsupported_desktop_schema",
        );
      this.engine = new WorkspaceEngine(kernel);
      const existing = db
        .prepare("SELECT id FROM workspaces ORDER BY created_at LIMIT 1")
        .get();
      const activeWorkspaceId = existing ? String(existing.id) : null;
      db.prepare("INSERT OR IGNORE INTO desktop_session VALUES(1,?)").run(
        JSON.stringify({
          activeWorkspaceId,
          navigation: activeWorkspaceId
            ? { kind: "workspace", workspaceId: activeWorkspaceId }
            : { kind: "constellation", projectId: null },
          history: [],
          revision: 1,
        }),
      );
      if (!versions.length || versions[0].version === 1) {
        // Upgrade the interim review adapter without deleting its recovery records.
        const convert = (copy: LayoutCopy) => ({
          viewport: { x: 0, y: 0, zoom: 1 },
          blocks: copy.blocks
            .map((b) => ({
              blockId: b.id,
              resourceId: b.resource_id,
              x: b.x,
              y: b.y,
              width: b.width,
              height: b.height,
              zIndex: b.z,
              shape: b.shape,
              rotation: 0,
              minimized: false,
              locked: false,
              materialVariant: "default",
            }))
            .sort((a, b) => a.blockId.localeCompare(b.blockId)),
        });
        for (const row of db
          .prepare(
            "SELECT b.id,d.shape FROM blocks b JOIN desktop_blocks d ON d.block_id=b.id",
          )
          .all())
          db.prepare(
            "INSERT OR IGNORE INTO block_presentations VALUES(?,?)",
          ).run(
            row.id,
            JSON.stringify({
              shape: row.shape,
              rotation: 0,
              minimized: false,
              locked: false,
              materialVariant: "default",
            }),
          );
        for (const w of db.prepare("SELECT id FROM workspaces").all()) {
          const id = String(w.id),
            old = db
              .prepare(
                "SELECT json FROM desktop_undo WHERE workspace_id=? ORDER BY id",
              )
              .all(id)
              .map((row) => convert(JSON.parse(String(row.json))));
          if (old.length) {
            const current = convert({ blocks: this.blocks(id) });
            db.prepare(
              "UPDATE workspace_engine_layouts SET history_json=? WHERE workspace_id=?",
            ).run(
              JSON.stringify({
                undo: old.map((before, i) => ({
                  before,
                  after: old[i + 1] ?? current,
                })),
                redo: [],
              }),
              id,
            );
          }
          const cp = db
            .prepare(
              "SELECT json FROM desktop_checkpoints WHERE workspace_id=?",
            )
            .get(id);
          if (cp)
            db.prepare(
              "INSERT INTO workspace_engine_checkpoints VALUES(?,?,?,?,?)",
            ).run(
              randomUUID(),
              id,
              "Imported desktop checkpoint",
              JSON.stringify(convert(JSON.parse(String(cp.json)))),
              new Date().toISOString(),
            );
        }
        db.exec("UPDATE desktop_schema SET version=2");
      }
      if (
        !db
          .prepare("PRAGMA table_info(desktop_resources)")
          .all()
          .some((row) => row.name === "metadata_json")
      )
        db.exec(
          "ALTER TABLE desktop_resources ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'",
        );
      db.exec("UPDATE desktop_schema SET version=3");
    });
  }
  private engineCommand(workspaceId: string, action: Record<string, unknown>) {
    return this.engine.execute({
      ...action,
      commandId: randomUUID(),
      workspaceId,
      expectedRevision: this.engine.project(workspaceId).revision,
    } as EngineCommand);
  }
  viewState(a: { state?: unknown }): unknown {
    if (a.state === undefined) {
      const row = this.db
        .prepare("SELECT json FROM desktop_view_state WHERE id=1")
        .get();
      return row ? JSON.parse(String(row.json)) : null;
    }
    const json = JSON.stringify(a.state);
    check(Buffer.byteLength(json) <= 2 * 1024 * 1024, "view_state_too_large");
    check(
      a.state &&
        typeof a.state === "object" &&
        (a.state as any).schema === "aerynth.constellation@1",
      "invalid_view_state",
    );
    check(
      Object.keys(a.state as object).every((k) =>
        ["schema", "anchors", "bookmarks", "location", "history"].includes(k),
      ),
      "invalid_view_state",
    );
    this.kernel.withTransaction(() =>
      this.db
        .prepare(
          "INSERT INTO desktop_view_state VALUES(1,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json",
        )
        .run(json),
    );
    return null;
  }
  private session(): Session {
    return JSON.parse(
      String(
        this.db.prepare("SELECT json FROM desktop_session WHERE id=1").get()!
          .json,
      ),
    );
  }
  private saveSession(s: Session) {
    s.revision++;
    this.db
      .prepare("UPDATE desktop_session SET json=? WHERE id=1")
      .run(JSON.stringify(s));
  }
  private workspace(id: unknown) {
    check(typeof id === "string");
    return this.kernel.openWorkspace(id as string);
  }
  private block(id: string, expected?: number): Block {
    const row = this.db
      .prepare(
        `SELECT b.*, coalesce(d.shape,'rectangle') AS shape FROM blocks b LEFT JOIN desktop_blocks d ON d.block_id=b.id WHERE b.id=?`,
      )
      .get(id) as Block | undefined;
    check(row, "block_not_found");
    if (expected !== undefined)
      check(row!.version === expected, "stale_block_version");
    return row!;
  }
  private blocks(id: string): Block[] {
    return this.engine
      .project(id)
      .blocks.map((b) => ({
        id: b.blockId,
        resource_id: b.resourceId,
        workspace_id: b.workspaceId,
        version: b.version,
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
        z: b.zIndex,
        shape: b.shape,
        rotation: b.rotation,
        minimized: b.minimized,
        locked: b.locked,
        materialVariant: b.materialVariant,
        contentMode: b.contentMode,
      }))
      .sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  private geometry(p: Geometry) {
    check(
      p &&
        ["x", "y", "width", "height", "z"].every((k) =>
          Number.isFinite(p[k as keyof Geometry]),
        ),
    );
    check(
      Math.abs(p.x) <= 50000 &&
        Math.abs(p.y) <= 50000 &&
        p.width >= 240 &&
        p.width <= 2400 &&
        p.height >= 160 &&
        p.height <= 1800 &&
        Number.isInteger(p.z) &&
        Math.abs(p.z) <= 10000,
      "invalid_geometry",
    );
  }
  private attach(workspaceId: string, resourceId: string) {
    const data = this.workspace(workspaceId);
    this.kernel.getResource(resourceId);
    const n = data.blocks.length;
    return this.engineCommand(workspaceId, {
      type: "attachResource",
      resourceId,
      presentation: {
        x: 70 + (n % 3) * 440,
        y: 260 + Math.floor(n / 3) * 300,
        width: 400,
        height: 250,
        zIndex: n,
        shape: "rectangle",
      },
    });
  }
  private navigate(s: Session, target: NavigationTarget, remember = true) {
    check(
      target &&
        (target.kind === "workspace" || target.kind === "constellation"),
    );
    if (target.kind === "workspace") {
      this.engine.switchWorkspace(target.workspaceId);
      s.activeWorkspaceId = target.workspaceId;
    } else if (target.projectId !== null)
      check(
        this.db
          .prepare("SELECT id FROM projects WHERE id=?")
          .get(target.projectId),
        "project_not_found",
      );
    if (remember && JSON.stringify(target) !== JSON.stringify(s.navigation))
      s.history = [...s.history, s.navigation].slice(-64);
    s.navigation = target;
  }
  apply(
    a: DesktopCommand,
    createConversation: (title: string, codex: boolean) => string,
  ): void {
    check(a && typeof a.type === "string");
    if (a.type === "snapshot") return;
    const s = this.session();
    switch (a.type) {
      case "createProject":
        this.kernel.createProject(title(a.title));
        break;
      case "createWorkspace": {
        const w = this.engine.createWorkspace(title(a.title), a.projectId);
        this.navigate(s, { kind: "workspace", workspaceId: w.workspaceId });
        break;
      }
      case "renameWorkspace":
        this.engine.renameWorkspace(
          a.workspaceId,
          title(a.title),
          a.expectedVersion,
        );
        break;
      case "navigate":
        this.navigate(s, a.target);
        break;
      case "back": {
        const target = s.history.pop();
        if (target) this.navigate(s, target, false);
        break;
      }
      case "createResource": {
        check(kinds.includes(a.kind));
        check(
          a.provider === undefined || ["local", "codex"].includes(a.provider),
        );
        if (a.workspaceId !== null) this.workspace(a.workspaceId);
        const resourceId =
          a.kind === "conversation"
            ? createConversation(title(a.title), a.provider === "codex")
            : this.kernel.createNote(
                title(a.title),
                "",
                a.workspaceId
                  ? this.workspace(a.workspaceId).workspace.project_id
                  : null,
              ).id;
        this.db
          .prepare(
            "INSERT INTO desktop_resources(resource_id,kind) VALUES(?,?)",
          )
          .run(resourceId, a.kind);
        if (a.workspaceId) {
          this.attach(a.workspaceId, resourceId);
        }
        break;
      }
      case "attach":
        this.attach(a.workspaceId, a.resourceId);
        break;
      case "detach": {
        const b = this.block(a.blockId, a.expectedVersion);
        this.engineCommand(b.workspace_id, {
          type: "detachBlock",
          blockId: b.id,
        });
        break;
      }
      case "geometry": {
        const b = this.block(a.blockId, a.expectedVersion);
        this.geometry(a.placement);
        check(shapes.includes(a.shape));
        if (a.rotation !== undefined) check(Number.isFinite(a.rotation) && Math.abs(a.rotation) <= 360, "invalid_rotation");
        this.engineCommand(b.workspace_id, {
          type: "saveLayout",
          placements: [
            {
              blockId: b.id,
              expectedVersion: b.version,
              presentation: {
                x: a.placement.x,
                y: a.placement.y,
                width: a.placement.width,
                height: a.placement.height,
                zIndex: a.placement.z,
                shape: a.shape,
                ...(a.rotation === undefined ? {} : {rotation:a.rotation}),
              },
            },
          ],
        });
        break;
      }
      case "content":
        check(
          typeof a.content === "string" &&
            Buffer.byteLength(a.content) <= 100000,
          "content_too_large",
        );
        this.kernel.updateNote(a.resourceId, a.content, a.expectedVersion);
        break;
      case "taskStatus": {
        const row = this.db
          .prepare("SELECT kind FROM desktop_resources WHERE resource_id=?")
          .get(a.resourceId);
        check(row?.kind === "task" && ["open", "done"].includes(a.status));
        const current = this.kernel.getResource(a.resourceId);
        this.kernel.updateNote(
          a.resourceId,
          current.note.content,
          a.expectedVersion,
        );
        this.db
          .prepare(
            "UPDATE desktop_resources SET metadata_json=? WHERE resource_id=?",
          )
          .run(JSON.stringify({ taskStatus: a.status }), a.resourceId);
        break;
      }
      case "checkpoint":
        check(s.activeWorkspaceId, "workspace_required");
        this.engineCommand(s.activeWorkspaceId!, {
          type: "checkpoint",
          name: "Saved layout",
        });
        break;
      case "restore": {
        check(s.activeWorkspaceId, "workspace_required");
        const cp = this.engine.listCheckpoints(s.activeWorkspaceId!).at(-1);
        check(cp, "checkpoint_missing");
        this.engineCommand(s.activeWorkspaceId!, {
          type: "restoreCheckpoint",
          checkpointId: cp!.id,
        });
        break;
      }
      case "undo":
        check(s.activeWorkspaceId, "workspace_required");
        this.engineCommand(s.activeWorkspaceId!, { type: "undoLayout" });
        break;
      default:
        check(false, "unsupported_desktop_command");
    }
    this.saveSession(s);
    this.db
      .prepare(
        `INSERT INTO change_events(id,entity_kind,entity_id,resource_version,occurred_at,origin,correlation_id,type,detail_json) VALUES(?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        randomUUID(),
        "desktop",
        s.activeWorkspaceId ?? "home",
        s.revision,
        new Date().toISOString(),
        "user",
        randomUUID(),
        "desktop." + a.type,
        "{}",
      );
  }
  snapshot(
    conversations: (id: string) => Pick<Resource, "provider" | "messages">,
  ): DesktopSnapshot {
    const s = this.session();
    const resources = this.kernel.searchResources().map((r) => {
      const entry = this.kernel.getResource(r.id);
      const kind = (this.db
        .prepare("SELECT kind FROM desktop_resources WHERE resource_id=?")
        .get(r.id)?.kind ??
        (r.kind === "generic" ? "reference" : r.kind)) as BlockKind;
      const metadata = this.db
        .prepare(
          "SELECT metadata_json FROM desktop_resources WHERE resource_id=?",
        )
        .get(r.id);
      return {
        id: r.id,
        title: r.title,
        kind,
        version: r.version,
        content: entry.note?.content ?? "",
        ...(kind === "task"
          ? {
              taskStatus:
                JSON.parse(String(metadata?.metadata_json ?? "{}"))
                  .taskStatus ?? "open",
            }
          : {}),
        provider: "local" as const,
        messages: [],
        ...(r.kind === "conversation" ? conversations(r.id) : {}),
      };
    });
    const w = s.activeWorkspaceId ? this.workspace(s.activeWorkspaceId) : null;
    return {
      contract: "aerynth.desktop@1",
      projects: this.db
        .prepare(
          "SELECT * FROM projects WHERE state='active' ORDER BY created_at",
        )
        .all() as any,
      workspaces: this.db
        .prepare(
          "SELECT * FROM workspaces WHERE state='active' ORDER BY created_at",
        )
        .all() as any,
      resources,
      blocks: s.activeWorkspaceId ? this.blocks(s.activeWorkspaceId) : [],
      relationships: this.db
        .prepare("SELECT * FROM relationships")
        .all() as any,
      ...s,
      navigationBlocks: this.db
        .prepare("SELECT * FROM blocks ORDER BY workspace_id,z,id")
        .all()
        .map((b: any) => ({ ...b, shape: "rectangle" as const })),
      layoutVersion: w?.layout.version ?? 0,
      viewport: s.activeWorkspaceId ? this.engine.project(s.activeWorkspaceId).viewport : undefined,
      canUndo: s.activeWorkspaceId
        ? this.engine.project(s.activeWorkspaceId).canUndo
        : false,
      hasCheckpoint: s.activeWorkspaceId
        ? this.engine.listCheckpoints(s.activeWorkspaceId).length > 0
        : false,
    };
  }
}
