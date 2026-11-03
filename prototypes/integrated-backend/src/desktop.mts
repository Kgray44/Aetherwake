import { randomUUID } from "node:crypto";
import { BUILTIN_BLOCKS } from "../../block-library/registry.ts";
import type { DatabaseSync } from "node:sqlite";
import { WorkspaceEngine, type EngineOptions } from "../../workspace-engine/engine.mts";
import type { Command as EngineCommand, WorkspaceProjection } from "../../workspace-engine/contracts.mts";
import type { WorkspaceKernel } from "../../workspace-kernel/kernel.mts";
import { WORKSPACE_PANELS } from "../../application-contract/contracts.ts";
import type {
  DesktopCommand,
  DesktopSnapshot,
  NavigationTarget,
  Block,
  Geometry,
  BlockKind,
  CanonicalResourceKind,
  Resource,
  Shape,
  WorkspacePanelPreferences,
  WorkspacePanelRequest,
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
  "task_group",
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
  private commandRevision?: number;
  private commandBounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  constructor(kernel: WorkspaceKernel, db: DatabaseSync, blockOptions:EngineOptions={}) {
    this.kernel = kernel;
    this.db = db;
    kernel.withTransaction(() => {
      db.exec(`CREATE TABLE IF NOT EXISTS desktop_schema(version INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS desktop_resources(resource_id TEXT PRIMARY KEY REFERENCES resources(id), kind TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS desktop_blocks(block_id TEXT PRIMARY KEY REFERENCES blocks(id) ON DELETE CASCADE, shape TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS desktop_session(id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS desktop_undo(id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT NOT NULL REFERENCES workspaces(id), json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS desktop_checkpoints(workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id), json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS desktop_view_state(id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS desktop_workspace_panels(workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, panel TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY(workspace_id,panel));`);
      const versions = db.prepare("SELECT version FROM desktop_schema").all();
      if (!versions.length)
        db.prepare("INSERT INTO desktop_schema VALUES(1)").run();
      else
        check(
          versions.length === 1 &&
            [1, 2, 3].includes(Number(versions[0].version)),
          "unsupported_desktop_schema",
        );
      this.engine = new WorkspaceEngine(kernel,blockOptions);
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
  /** Trusted in-process bridge only. Never expose the engine or callbacks through renderer IPC. */
  nativeBlockServices():Readonly<{engine:WorkspaceEngine;navigateWorkspace(workspaceId:string):void}>{
    return Object.freeze({engine:this.engine,navigateWorkspace:(workspaceId:string)=>{this.apply({type:'navigate',target:{kind:'workspace',workspaceId}},()=>{throw new Error('unexpected_block_bridge_conversation_creation');});}});
  }
  private engineCommand(workspaceId: string, action: Record<string, unknown>) {
    return this.engine.execute({
      ...action,
      commandId: randomUUID(),
      workspaceId,
      expectedRevision:
        this.commandRevision ?? this.engine.project(workspaceId).revision,
      ...(this.commandBounds ? { bounds: this.commandBounds } : {}),
    } as EngineCommand);
  }
  viewState(a: { state?: unknown; panels?: WorkspacePanelRequest }): unknown {
    if (a.panels !== undefined) {
      check(a.state === undefined, "invalid_view_state");
      return this.workspacePanels(a.panels);
    }
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
        ["schema", "anchors", "bookmarks", "location", "history", "future", "savedViews"].includes(k),
      ),
      "invalid_view_state",
    );
    // Optional schema-1 Forward history uses the same view-only entries as Back.
    // The navigation controller owns entry validation and permission pruning.
    const { future, savedViews } = a.state as { future?: unknown; savedViews?: unknown };
    check(
      future === undefined || (Array.isArray(future) && future.length <= 32),
      "invalid_view_state",
    );
    check(
      savedViews === undefined || (Array.isArray(savedViews) && savedViews.length <= 32),
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
  private workspacePanels(input: WorkspacePanelRequest): WorkspacePanelPreferences {
    const invalid = "invalid_workspace_panel";
    check(input && typeof input.workspaceId === "string" && input.workspaceId.length <= 256, invalid);
    this.workspace(input.workspaceId);
    if (input.update !== undefined) {
      const update = input.update;
      check(update && WORKSPACE_PANELS.includes(update.panel), invalid);
      const p = update.preference;
      check(p && typeof p.pinned === "boolean", invalid);
      const size = p.size;
      check(
        size === undefined ||
          (size && [size.width, size.height].every((n) => Number.isInteger(n) && n >= 1 && n <= 4096)),
        invalid,
      );
      const json = JSON.stringify({
        pinned: p.pinned,
        ...(size ? { size: { width: size.width, height: size.height } } : {}),
      });
      this.kernel.withTransaction(() =>
        this.db.prepare(
          "INSERT INTO desktop_workspace_panels VALUES(?,?,?) ON CONFLICT(workspace_id,panel) DO UPDATE SET json=excluded.json",
        ).run(input.workspaceId, update.panel, json),
      );
    }
    return Object.fromEntries(
      this.db.prepare("SELECT panel,json FROM desktop_workspace_panels WHERE workspace_id=?").all(input.workspaceId)
        .filter((row) => WORKSPACE_PANELS.some((panel) => panel === row.panel))
        .map((row) => [String(row.panel), JSON.parse(String(row.json))]),
    );
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
    const result = this.kernel.openWorkspace(id as string);
    check(result.workspace.state === "active", "workspace_archived");
    if (result.workspace.project_id)
      check(
        this.db
          .prepare("SELECT id FROM projects WHERE id=? AND state='active'")
          .get(result.workspace.project_id),
        "project_archived",
      );
    return result;
  }
  private visibleWorkspaces(): any[] {
    return this.db
      .prepare(
        "SELECT w.* FROM workspaces w LEFT JOIN projects p ON p.id=w.project_id WHERE w.state='active' AND (w.project_id IS NULL OR p.state='active') ORDER BY w.created_at,w.id",
      )
      .all();
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
  private resourceKind(id: string) {
    return this.db
      .prepare("SELECT kind FROM desktop_resources WHERE resource_id=?")
      .get(id)?.kind;
  }
  private checkTaskMembership(groupId: string, taskId: string) {
    check(
      this.resourceKind(groupId) === "task_group" &&
        this.resourceKind(taskId) === "task",
      "invalid_task_membership",
    );
    for (const id of [groupId, taskId]) {
      const r = this.kernel.getResource(id).resource;
      check(r.state === "active", "resource_archived");
      if (r.project_id)
        check(
          this.db
            .prepare("SELECT id FROM projects WHERE id=? AND state='active'")
            .get(r.project_id),
          "project_archived",
        );
    }
  }
  private touchGroup(id: string) {
    const group = this.kernel.getResource(id);
    this.kernel.updateNote(id, group.note.content, group.resource.version);
  }
  private blocks(id: string, projection?: WorkspaceProjection): Block[] {
    return (projection ?? this.engine.project(id))
      .blocks.map((b):Block => ({
        id: b.blockId,
        ...(typeof b.resourceId==='string'?{resource_id:b.resourceId,subject:{kind:'resource' as const,resourceId:b.resourceId}}:{subject:b.subject}),
        subjectState:b.subjectState??b.resourceState,
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
      Math.abs(p.x) <= 1000000 &&
        Math.abs(p.y) <= 1000000 &&
        p.width >= 128 &&
        p.width <= 4096 &&
        p.height >= 96 &&
        p.height <= 4096 &&
        Number.isInteger(p.z) &&
        Math.abs(p.z) <= 10000,
      "invalid_geometry",
    );
  }
  private attach(workspaceId: string, resourceId: string) {
    const data = this.workspace(workspaceId);
    this.kernel.getResource(resourceId);
    const resource=this.kernel.getResource(resourceId).resource;
    const definition=BUILTIN_BLOCKS.find(item=>item.kind===(this.resourceKind(resourceId)??resource.kind));
    check(definition,'resource_presenter_unavailable');
    const n = data.blocks.length;
    return this.engineCommand(workspaceId, {
      type: "attachResource",
      resourceId,
      presentation: {
        x: 70 + (n % 3) * 440,
        y: 260 + Math.floor(n / 3) * 300,
        width: definition!.defaultPresentation.width,
        height: definition!.defaultPresentation.height,
        zIndex: n,
        shape: definition!.defaultPresentation.shape,
      },
    });
  }
  private navigate(s: Session, target: NavigationTarget, remember = true) {
    check(
      target &&
        (target.kind === "workspace" || target.kind === "constellation"),
    );
    if (target.kind === "workspace") {
      this.workspace(target.workspaceId);
      this.engine.switchWorkspace(target.workspaceId);
      s.activeWorkspaceId = target.workspaceId;
    } else if (target.projectId !== null)
      check(
        this.db
          .prepare("SELECT id FROM projects WHERE id=? AND state='active'")
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
    this.commandBounds = a.bounds;
    this.commandRevision = a.expectedLayoutVersion;
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
      case "archiveWorkspace": {
        check(typeof a.archived === "boolean");
        this.kernel.setWorkspaceArchived(
          a.workspaceId,
          a.archived,
          a.expectedVersion,
        );
        if (a.archived) {
          s.history = s.history.filter(
            (target) =>
              target.kind !== "workspace" ||
              target.workspaceId !== a.workspaceId,
          );
          if (s.activeWorkspaceId === a.workspaceId) {
            const next = this.visibleWorkspaces()[0];
            s.activeWorkspaceId = next ? String(next.id) : null;
            if (s.navigation.kind === "workspace") {
              this.navigate(
                s,
                s.activeWorkspaceId
                  ? { kind: "workspace", workspaceId: s.activeWorkspaceId }
                  : { kind: "constellation", projectId: null },
                false,
              );
            } else if (s.activeWorkspaceId) {
              // Update the return workspace while keeping the current sky view.
              this.engine.switchWorkspace(s.activeWorkspaceId);
            }
          }
        }
        break;
      }
      case "archiveSubject": {
        check(typeof a.archived === "boolean");
        if (a.kind === "project")
          this.kernel.setProjectArchived(a.id, a.archived, a.expectedVersion);
        else if (a.kind === "resource")
          this.kernel.setResourceArchived(a.id, a.archived, a.expectedVersion);
        else check(false);
        break;
      }
      case "relate": {
        check(
          typeof a.kind === "string" &&
            /^[a-zA-Z][a-zA-Z0-9_.:-]{0,99}$/.test(a.kind),
          "invalid_relationship_kind",
        );
        for (const id of [a.sourceId, a.targetId]) {
          const r = this.kernel.getResource(id).resource;
          check(r.state === "active", "resource_archived");
          if (r.project_id)
            check(
              this.db
                .prepare(
                  "SELECT id FROM projects WHERE id=? AND state='active'",
                )
                .get(r.project_id),
              "project_archived",
            );
        }
        if (a.kind === "contains_task")
          this.checkTaskMembership(a.sourceId, a.targetId);
        this.kernel.relate(a.sourceId, a.targetId, a.kind, "user");
        if (a.kind === "contains_task") this.touchGroup(a.sourceId);
        break;
      }
      case "unrelate": {
        check(typeof a.relationshipId === "string");
        const edge = this.db
          .prepare("SELECT * FROM relationships WHERE id=?")
          .get(a.relationshipId);
        if (edge?.kind === "contains_task")
          this.checkTaskMembership(
            String(edge.source_id),
            String(edge.target_id),
          );
        this.kernel.unlinkRelationship(a.relationshipId);
        if (edge?.kind === "contains_task")
          this.touchGroup(String(edge.source_id));
        break;
      }
      case "setTaskGroupMembers": {
        const group = this.kernel.getResource(a.groupId);
        check(
          group.resource.version === a.expectedVersion,
          "stale_resource_version",
        );
        check(
          this.resourceKind(a.groupId) === "task_group" &&
            group.resource.state === "active",
          "task_group_required",
        );
        check(
          Array.isArray(a.taskIds) &&
            a.taskIds.length <= 500 &&
            a.taskIds.every((id) => typeof id === "string") &&
            new Set(a.taskIds).size === a.taskIds.length,
          "invalid_task_members",
        );
        for (const id of a.taskIds) this.checkTaskMembership(a.groupId, id);
        const old = this.db
          .prepare(
            "SELECT * FROM relationships WHERE source_id=? AND kind='contains_task'",
          )
          .all(a.groupId);
        const desired = new Set(a.taskIds),
          existing = new Set(old.map((e) => String(e.target_id)));
        if (
          desired.size === existing.size &&
          a.taskIds.every((id) => existing.has(id))
        )
          return;
        for (const edge of old)
          if (!desired.has(String(edge.target_id)))
            this.kernel.unlinkRelationship(String(edge.id));
        for (const id of desired)
          if (!existing.has(id))
            this.kernel.relate(a.groupId, id, "contains_task", "user");
        this.touchGroup(a.groupId);
        break;
      }
      case "navigate":
        this.navigate(s, a.target);
        break;
      case "setPresence":
        this.workspace(a.workspaceId);
        this.engineCommand(a.workspaceId, {
          type: "setPresence",
          expectedVersion: a.expectedVersion,
          presentation: a.placement,
        });
        break;
      case "resolveLayout":
        this.workspace(a.workspaceId);
        this.engineCommand(a.workspaceId, { type: "resolveLayout" });
        break;
      case "setOrganization":
        this.workspace(a.workspaceId);
        this.engineCommand(a.workspaceId, {
          type: a.type,
          organization: a.organization,
          expectedOrganizationRevision: a.expectedOrganizationRevision,
        });
        break;
      case "applyStructuredPreset":
        this.workspace(a.workspaceId);
        this.engineCommand(a.workspaceId, { type: a.type, preset: a.preset });
        break;
      case "reorderPlacements":
        this.workspace(a.workspaceId);
        this.engineCommand(a.workspaceId, { type: a.type, order: a.order });
        break;
      case "bringAllIntoView":
        this.workspace(a.workspaceId);
        this.engineCommand(a.workspaceId, { type: a.type });
        break;
      case "layerBlock": {
        const b = this.block(a.blockId);
        this.workspace(b.workspace_id);
        this.engineCommand(b.workspace_id, {
          type: a.type,
          blockId: b.id,
          direction: a.direction,
        });
        break;
      }
      case "setViewport":
        this.workspace(a.workspaceId);
        this.engineCommand(a.workspaceId, {
          type: "saveLayout",
          placements: [],
          viewport: a.viewport,
        });
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
      case "setBlockMinimized": {
        check(typeof a.minimized === "boolean" && Number.isSafeInteger(a.expectedVersion) && a.expectedVersion > 0);
        this.workspace(a.workspaceId);
        check(s.activeWorkspaceId === a.workspaceId && s.navigation.kind === "workspace" && s.navigation.workspaceId === a.workspaceId, "stale_workspace_context");
        const b = this.block(a.blockId, a.expectedVersion);
        check(b.workspace_id === a.workspaceId, "block_workspace_mismatch");
        const beforeRevision = this.engine.project(a.workspaceId).revision;
        const result = this.engineCommand(a.workspaceId, {
          type: "setBlockMinimized",
          blockId: b.id,
          expectedVersion: b.version,
          minimized: a.minimized,
        });
        // Still run all engine fences on a no-op, without creating a desktop
        // event/session revision or a second presentation store.
        if (result.revision === beforeRevision) return;
        break;
      }
      case "lockBlock": {
        const b = this.block(a.blockId, a.expectedVersion);
        this.workspace(b.workspace_id);
        this.engineCommand(b.workspace_id, {
          type: "setBlockLock",
          blockId: b.id,
          locked: a.locked,
        });
        break;
      }
      case "geometry": {
        const b = this.block(a.blockId, a.expectedVersion);
        this.geometry(a.placement);
        check(shapes.includes(a.shape));
        if (a.rotation !== undefined)
          check(
            Number.isFinite(a.rotation) && Math.abs(a.rotation) <= 360,
            "invalid_rotation",
          );
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
                ...(a.rotation === undefined ? {} : { rotation: a.rotation }),
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
        check(
          this.kernel.getResource(a.resourceId).resource.state === "active",
          "resource_archived",
        );
        this.kernel.updateNote(a.resourceId, a.content, a.expectedVersion);
        break;
      case "taskStatus":
      case "taskPriority": {
        const row = this.db
          .prepare("SELECT kind,metadata_json FROM desktop_resources WHERE resource_id=?")
          .get(a.resourceId);
        check(row?.kind === "task" && (a.type==='taskStatus'?["open", "done"].includes(a.status):['low','normal','high','urgent'].includes(a.priority)));
        const current = this.kernel.getResource(a.resourceId);
        check(current.resource.state==='active','resource_archived');
        this.kernel.updateNote(
          a.resourceId,
          current.note.content,
          a.expectedVersion,
        );
        this.db
          .prepare(
            "UPDATE desktop_resources SET metadata_json=? WHERE resource_id=?",
          )
          .run(JSON.stringify({...JSON.parse(String(row!.metadata_json??'{}')),...(a.type==='taskStatus'?{taskStatus:a.status}:{taskPriority:a.priority})}), a.resourceId);
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
      case "redo":
        check(s.activeWorkspaceId, "workspace_required");
        this.engineCommand(s.activeWorkspaceId!, { type: "redoLayout" });
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
    graph: {
      revision: number;
      branches: NonNullable<DesktopSnapshot["conversationBranches"]>;
    } = { revision: 0, branches: [] },
  ): DesktopSnapshot {
    const s = this.session();
    const projects = this.db
      .prepare(
        "SELECT * FROM projects WHERE state='active' ORDER BY created_at,id",
      )
      .all() as any[];
    const projectIds = new Set(projects.map((p) => String(p.id)));
    const workspaces = this.visibleWorkspaces(),
      workspaceIds = new Set(workspaces.map((w) => String(w.id)));
    const eligible = (target: NavigationTarget) =>
      target.kind === "workspace"
        ? workspaceIds.has(target.workspaceId)
        : target.projectId === null || projectIds.has(target.projectId);
    const previous = JSON.stringify(s);
    if (s.activeWorkspaceId && !workspaceIds.has(s.activeWorkspaceId))
      s.activeWorkspaceId = workspaces[0]?.id ?? null;
    if (!eligible(s.navigation))
      s.navigation = s.activeWorkspaceId
        ? { kind: "workspace", workspaceId: s.activeWorkspaceId }
        : { kind: "constellation", projectId: null };
    s.history = s.history.filter(eligible);
    if (previous !== JSON.stringify(s))
      this.kernel.withTransaction(() => {
        if (s.activeWorkspaceId)
          this.engine.switchWorkspace(s.activeWorkspaceId);
        this.saveSession(s);
      });
    // Keep truthful unavailable placeholders for surviving placements. Navigation never
    // exposes archived subjects, and the renderer never receives dangling references.
    const resources: Resource[] = this.kernel
      .searchResources("", true)
      .map((r) => {
        const entry = this.kernel.getResource(r.id);
        const kind = (this.db
          .prepare("SELECT kind FROM desktop_resources WHERE resource_id=?")
          .get(r.id)?.kind ??
          (r.kind === "generic" ? "reference" : r.kind)) as CanonicalResourceKind;
        const visible =
          r.state === "active" &&
          (r.project_id === null || projectIds.has(r.project_id));
        const metadata = this.db
          .prepare(
            "SELECT metadata_json FROM desktop_resources WHERE resource_id=?",
          )
          .get(r.id);
        return {
          id: r.id,
          title: r.title,
          kind,
          project_id: r.project_id,
          version: r.version,
          state: r.state,
          visible,
          available: visible,
          content: visible ? (entry.note?.content ?? "") : "",
          ...(kind === "task"
            ? {
                taskStatus:
                  JSON.parse(String(metadata?.metadata_json ?? "{}"))
                    .taskStatus ?? "open",
                taskPriority:JSON.parse(String(metadata?.metadata_json??'{}')).taskPriority??'normal',
              }
            : {}),
          provider: "local" as const,
          messages: [],
          ...(visible && r.kind === "conversation" ? conversations(r.id) : {}),
        };
      });
    const visibleIds = new Set(
      resources.filter((r) => r.visible).map((r) => r.id),
    );
    const relationships = (
      this.db
        .prepare("SELECT * FROM relationships")
        .all() as DesktopSnapshot["relationships"]
    ).filter(
      (edge) =>
        visibleIds.has(edge.source_id) && visibleIds.has(edge.target_id),
    );
    const byResource = new Map(resources.map((r) => [r.id, r]));
    for (const resource of resources)
      if (resource.kind === "task_group" && resource.visible)
        resource.taskMembers = [];
    for (const edge of relationships)
      if (edge.kind === "contains_task") {
        const group = byResource.get(edge.source_id),
          task = byResource.get(edge.target_id);
        if (group?.taskMembers && task?.kind === "task")
          group.taskMembers.push({
            id: task.id,
            title: task.title,
            status: task.taskStatus ?? "open",
          });
      }
    const w = s.activeWorkspaceId ? this.workspace(s.activeWorkspaceId) : null;
    // One synchronous publication uses one canonical projection. Rebuilding it for
    // each field repeatedly normalizes the same complete undo/redo history.
    const projection = s.activeWorkspaceId ? this.engine.project(s.activeWorkspaceId) : null;
    return {
      contract: "aerynth.desktop@1",
      projects,
      workspaces,
      archivedWorkspaces: this.db
        .prepare(
          "SELECT * FROM workspaces WHERE state='archived' ORDER BY created_at,id",
        )
        .all() as any,
      resources,
      blocks: s.activeWorkspaceId && projection ? this.blocks(s.activeWorkspaceId,projection) : [],
      relationships,
      ...s,
      navigationBlocks: this.db
        .prepare("SELECT * FROM blocks ORDER BY workspace_id,z,id")
        .all()
        .filter(
          (b: any) =>
            workspaceIds.has(b.workspace_id) && (b.resource_id?visibleIds.has(b.resource_id):this.kernel.subjectState(this.kernel.readBlockSubject(String(b.id)))==='active'),
        )
        .map((b: any):Block => {const {resource_id,subject_ref_id,...placement}=b;const subject=this.kernel.readBlockSubject(String(b.id));return subject.kind==='resource'?{...placement,resource_id:subject.resourceId,subject,subjectState:this.kernel.subjectState(subject),shape:'rectangle'}:{...placement,subject,subjectState:this.kernel.subjectState(subject),shape:'rounded'};}),
      layoutVersion: w?.layout.version ?? 0,
      viewport: projection?.viewport,
      organization: projection?.organization,
      presence: projection?.presence,
      graphRevision:
        graph.revision +
        Number(
          this.db
            .prepare(
              "SELECT coalesce(max(rowid),0) AS cursor FROM change_events",
            )
            .get()!.cursor,
        ),
      conversationBranches: graph.branches.filter(
        (edge) =>
          visibleIds.has(edge.parentResourceId) &&
          visibleIds.has(edge.childResourceId),
      ),
      canUndo: projection?.canUndo ?? false,
      canRedo: projection?.canRedo ?? false,
      hasCheckpoint: s.activeWorkspaceId
        ? this.engine.listCheckpoints(s.activeWorkspaceId).length > 0
        : false,
    };
  }
}
