import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { WorkspaceKernel } from "../workspace-kernel/kernel.mts";
import type { WorkspaceEngine } from "../workspace-engine/engine.mts";
import type {
  Geometry,
  WorkspaceProjection,
} from "../workspace-engine/contracts.mts";
import type { DesktopCommand } from "../application-contract/contracts.ts";
import type { NonResourceSubjectRef } from "../workspace-kernel/subjects.ts";
import type {
  BlockKind,
  CanonicalTemplateHost,
  LibraryCapabilities,
} from "./contracts.ts";
import { check, identifier, text } from "./model.ts";
import { assertBlockAvailable, blockDefinition } from "./registry.ts";

export type TaskGroupMembershipCommand = Extract<
  DesktopCommand,
  { type: "setTaskGroupMembers" }
>;
export type CanonicalTemplateHostOptions = {
  db: DatabaseSync;
  kernel: WorkspaceKernel;
  engine: WorkspaceEngine;
  /** Parent owns rollback of graph/provider mappings as well as the same SQLite transaction. */
  atomic<T>(operation: () => T): T;
  capabilities(): LibraryCapabilities;
  /** The parent's existing factory creates a new canonical subject, including conversation graph mapping. No placement or provider execution. */
  createResource(
    kind: BlockKind,
    title: string,
    provider: "local" | "codex" | undefined,
    projectId: string | null,
  ): string;
  resourceKind(resourceId: string): BlockKind;
  /** Synchronous canonical desktop-session navigation only. Publish renderer changes after the outer transaction commits. */
  navigateWorkspace(workspaceId: string): void;
  /** Delegate to the actual DesktopState command path, including its membership checks and version increment. */
  setTaskGroupMembers(command: TaskGroupMembershipCommand): void;
  /** Effective grants belong to the parent. Local existence alone never grants access. */
  isAuthorized(subject: {
    kind: "project" | "workspace" | "resource";
    id: string;
  }): boolean;
  /** Optional native usable canvas bounds, in canonical world coordinates. */
  bounds?(workspaceId: string): Geometry | undefined;
  authorizeSubject?(
    subject: NonResourceSubjectRef,
    workspaceId?: string,
  ): boolean;
};

/** Adapter over the existing canonical kernel and engine. It opens no connection and writes no extension/resource/placement table itself. */
export function createCanonicalTemplateHost(
  options: CanonicalTemplateHostOptions,
): CanonicalTemplateHost<DatabaseSync> {
  const { db, kernel, engine } = options;
  check(engine.kernel === kernel, "canonical_engine_required");
  kernel.withTransaction((actualDb) =>
    check(actualDb === db, "canonical_connection_required"),
  );
  const authorized = (kind: "project" | "workspace" | "resource", id: string) =>
    options.isAuthorized({ kind, id }) === true;
  const readProject: CanonicalTemplateHost<DatabaseSync>["readProject"] = (
    id,
  ) => {
    const row = db
      .prepare("SELECT id,version,state FROM projects WHERE id=?")
      .get(identifier(id));
    return row
      ? {
          id: String(row.id),
          version: Number(row.version),
          state: String(row.state),
          authorized:
            row.state === "active" && authorized("project", String(row.id)),
        }
      : null;
  };
  const projectVisible = (id: string | null) =>
    id === null || readProject(id)?.authorized === true;
  const readResource: CanonicalTemplateHost<DatabaseSync>["readResource"] = (
    id,
  ) => {
    const row = db
      .prepare(
        "SELECT id,kind,project_id,version,state FROM resources WHERE id=?",
      )
      .get(identifier(id));
    if (!row) return null;
    const kind = options.resourceKind(String(row.id));
    blockDefinition(kind);
    return {
      id: String(row.id),
      kind,
      projectId: row.project_id as string | null,
      version: Number(row.version),
      state: String(row.state),
      authorized:
        row.state === "active" &&
        projectVisible(row.project_id as string | null) &&
        authorized("resource", String(row.id)),
    };
  };
  const readWorkspace: CanonicalTemplateHost<DatabaseSync>["readWorkspace"] = (
    id,
  ) => {
    // Read the canonical layout fence directly, without initializing engine state for an invisible workspace.
    const row = db
      .prepare(
        "SELECT w.id,w.project_id,w.state,l.version AS layout_version FROM workspaces w JOIN workspace_layouts l ON l.workspace_id=w.id WHERE w.id=?",
      )
      .get(identifier(id));
    return row
      ? {
          id: String(row.id),
          projectId: row.project_id as string | null,
          layoutVersion: Number(row.layout_version),
          state: String(row.state),
          authorized:
            row.state === "active" &&
            projectVisible(row.project_id as string | null) &&
            authorized("workspace", String(row.id)),
        }
      : null;
  };
  const requireProject = (projectId: string | null) =>
    check(projectVisible(projectId), "project_unavailable");
  const workspaceState = (workspaceId: string) => {
    const workspace = readWorkspace(workspaceId);
    check(workspace?.authorized, "workspace_unavailable");
    const state = engine.project(workspaceId);
    check(
      state.revision === workspace.layoutVersion,
      "layout_version_conflict",
    );
    return state;
  };
  const envelope = (state: WorkspaceProjection, bounds?: Geometry) => ({
    commandId: "library-engine:" + randomUUID(),
    workspaceId: state.workspaceId,
    expectedRevision: state.revision,
    ...(bounds ? { bounds } : options.bounds ? { bounds: options.bounds(state.workspaceId) } : {}),
  });
  const capabilities = (): LibraryCapabilities => {
    const snapshot = structuredClone(options.capabilities());
    return {
      ...snapshot,
      discoveryFilters: {
        project: snapshot.discoveryFilters?.project ?? { state: "available" },
        collection:
          snapshot.discoveryFilters?.collection ??
          (options.authorizeSubject
            ? { state: "available" }
            : {
                state: "unsupported",
                reason: "Collection authorization is unavailable.",
              }),
      },
    };
  };
  return {
    db,
    initialPlacement: 'nearest-free',
    atomic: <T,>(operation: () => T) => options.atomic(operation),
    capabilities,
    readProject,
    readResource,
    readWorkspace,
    subjectTargets(workspaceId) {
      const workspace = readWorkspace(identifier(workspaceId));
      check(workspace?.authorized, "workspace_unavailable");
      const projectRows = db
          .prepare(
            "SELECT id,title,version FROM projects WHERE state='active' ORDER BY title,id LIMIT 101",
          )
          .all(),
        collectionRows = db
          .prepare(
            "SELECT id,title,project_id,version FROM collections WHERE state='active' ORDER BY title,id LIMIT 101",
          )
          .all();
      return {
        projectId: workspace.projectId,
        projects: projectRows
          .slice(0, 100)
          .filter(
            (row) =>
              readProject(String(row.id))?.authorized &&
              options.authorizeSubject?.({
                kind: "project",
                projectId: String(row.id),
              }) === true,
          )
          .map((row) => ({
            id: String(row.id),
            title: String(row.title),
            version: Number(row.version),
          })),
        collections: collectionRows
          .slice(0, 100)
          .filter(
            (row) =>
              projectVisible(row.project_id as string | null) &&
              options.authorizeSubject?.({
                kind: "collection",
                collectionId: String(row.id),
              }) === true,
          )
          .map((row) => ({
            id: String(row.id),
            title: String(row.title),
            projectId: row.project_id as string | null,
            version: Number(row.version),
          })),
        globalQueryAllowed:
          options.authorizeSubject?.({
            kind: "resource-query",
            projectId: null,
            query: "",
          }) === true,
        truncated: projectRows.length > 100 || collectionRows.length > 100,
      };
    },
    readSubject(subject) {
      return {
        authorized: options.authorizeSubject?.(subject) === true,
        state: kernel.subjectState(subject),
      };
    },
    placeSubject(input) {
      const state = workspaceState(input.workspaceId);
      check(
        options.authorizeSubject?.(input.subject, input.workspaceId) === true &&
          kernel.subjectState(input.subject) === "active",
        "subject_unavailable",
      );
      const existing = new Set(state.blocks.map((block) => block.blockId));
      const result = engine.execute({
        type: "attachSubject",
        ...envelope(state, input.bounds),
        subject: input.subject,
        presentation: input.presentation,
        ...(input.placement ? { placement: input.placement } : {}),
      });
      const added = result.blocks.filter(
        (block) => !existing.has(block.blockId),
      );
      check(added.length === 1, "canonical_placement_required");
      return { id: added[0].blockId };
    },
    readPlacement(id) {
      const row = db
        .prepare("SELECT id,resource_id,workspace_id FROM blocks WHERE id=?")
        .get(identifier(id));
      if (!row) return null;
      if (!row.resource_id) {
        const subject = kernel.readBlockSubject(String(row.id));
        check(subject.kind !== "resource", "invalid_block_subject");
        return {
          id: String(row.id),
          subject,
          workspaceId: String(row.workspace_id),
          authorized:
            readWorkspace(String(row.workspace_id))?.authorized === true &&
            options.authorizeSubject?.(subject, String(row.workspace_id)) ===
              true &&
            kernel.subjectState(subject) === "active",
        };
      }
      const workspace = readWorkspace(String(row.workspace_id)),
        resource = readResource(String(row.resource_id));
      return {
        id: String(row.id),
        resourceId: String(row.resource_id),
        workspaceId: String(row.workspace_id),
        authorized:
          workspace?.authorized === true && resource?.authorized === true,
      };
    },
    findResources(input) {
      const workspace = readWorkspace(input.workspaceId);
      check(workspace?.authorized, "workspace_unavailable");
      blockDefinition(input.kind);
      const limit = input.limit ?? 30,
        terms = (input.query ?? "")
          .trim()
          .toLocaleLowerCase()
          .split(/\s+/)
          .filter(Boolean);
      check(
        [undefined, "compatible", "workspace-project", "unassigned"].includes(
          input.projectScope,
        ),
        "invalid_resource_query",
      );
      if (input.projectScope && input.projectScope !== "compatible")
        check(
          capabilities().discoveryFilters?.project?.state === "available",
          "project_filter_unavailable",
        );
      const predicates = [
          "r.id>?",
          "r.state='active'",
          "coalesce(d.kind,r.kind)=?",
          "(r.project_id IS NULL OR r.project_id=?)",
        ],
        parameters: (string | null)[] = [
          input.afterId ?? "",
          input.kind,
          workspace.projectId,
        ];
      if (input.projectScope === "workspace-project") {
        // An independent workspace has no project-owned candidates.
        predicates.push("r.project_id=?");
        parameters.push(workspace.projectId);
      } else if (input.projectScope === "unassigned")
        predicates.push("r.project_id IS NULL");
      if (input.collectionId !== undefined) {
        check(
          capabilities().discoveryFilters?.collection?.state === "available",
          "collection_filter_unavailable",
        );
        const collectionId = identifier(input.collectionId),
          subject = { kind: "collection" as const, collectionId },
          collection = db
            .prepare("SELECT project_id,state FROM collections WHERE id=?")
            .get(collectionId);
        check(
          collection?.state === "active" &&
            projectVisible(collection.project_id as string | null) &&
            options.authorizeSubject?.(subject) === true,
          "subject_unavailable",
        );
        predicates.push(
          "EXISTS(SELECT 1 FROM collection_members m WHERE m.collection_id=? AND m.resource_id=r.id)",
        );
        parameters.push(collectionId);
      }
      // Bounded keyset pages. Authorization is checked before exposing any title or identity.
      const rows = db
        .prepare(
          "SELECT r.id,r.title FROM resources r LEFT JOIN desktop_resources d ON d.resource_id=r.id WHERE " +
            predicates.join(" AND ") +
            " ORDER BY r.id LIMIT 256",
        )
        .all(...parameters);
      const resources = [];
      let scanned = input.afterId ?? "",
        consumed = 0;
      for (const row of rows) {
        scanned = String(row.id);
        consumed++;
        const resource = readResource(scanned);
        if (
          !resource?.authorized ||
          resource.kind !== input.kind ||
          !terms.every(
            (term) =>
              String(row.title).toLocaleLowerCase().includes(term) ||
              scanned.toLocaleLowerCase().includes(term),
          )
        )
          continue;
        resources.push({
          id: resource.id,
          title: String(row.title),
          kind: resource.kind,
          projectId: resource.projectId,
          version: resource.version,
        });
        if (resources.length === limit) break;
      }
      return {
        resources,
        nextCursor:
          consumed < rows.length || rows.length === 256 ? scanned : null,
      };
    },
    createWorkspace(input) {
      requireProject(input.projectId);
      // Staging Freeform prevents per-attachment reflow from destroying saved geometry. Final policy is applied once, below.
      const workspace = engine.createWorkspace(
        text(input.title),
        input.projectId,
        { mode: "freeform" },
      );
      const result: unknown = options.navigateWorkspace(workspace.workspaceId);
      check(!(result instanceof Promise), "synchronous_host_required");
      check(
        readWorkspace(workspace.workspaceId)?.authorized,
        "workspace_unavailable",
      );
      return { id: workspace.workspaceId };
    },
    createResource(input) {
      check(blockDefinition(input.kind).creation !== 'reference-only', input.kind === 'agent' ? 'agent_library_creation_required' : input.kind === 'task_objective' ? 'task_objective_creation_required' : 'timeline_creation_required');
      requireProject(input.projectId);
      assertBlockAvailable(input.kind, options.capabilities(), input.provider);
      const previousRowid = Number(
        db.prepare("SELECT coalesce(max(rowid),0) AS n FROM resources").get()!
          .n,
      );
      const id = options.createResource(
        input.kind,
        text(input.title),
        input.provider,
        input.projectId,
      );
      check(typeof id === "string", "synchronous_resource_factory_required");
      const resource = readResource(id);
      check(
        resource?.authorized && resource.state === "active",
        "created_resource_unavailable",
      );
      check(
        resource.kind === input.kind && resource.projectId === input.projectId,
        "created_resource_scope_mismatch",
      );
      if (input.kind === 'checklist')
        check(kernel.getResource(id).resource.kind === 'generic', 'canonical_checklist_resource_required');
      const stored = db
        .prepare("SELECT rowid FROM resources WHERE id=?")
        .get(id);
      check(
        Number(stored?.rowid) > previousRowid,
        "resource_factory_must_create_new",
      );
      return { id };
    },
    placeResource(input) {
      const state = workspaceState(input.workspaceId),
        resource = readResource(input.resourceId);
      check(
        resource?.authorized && resource.state === "active",
        "reference_unavailable",
      );
      check(
        resource.projectId === null || resource.projectId === state.projectId,
        "cross_project_reference",
      );
      const existing = new Set(state.blocks.map((block) => block.blockId));
      const result = engine.execute({
        type: "attachResource",
        ...envelope(state, input.bounds),
        resourceId: resource.id,
        presentation: input.presentation,
        ...(input.placement ? { placement: input.placement } : {}),
      });
      const added = result.blocks.filter(
        (block) => !existing.has(block.blockId),
      );
      check(
        added.length === 1 && added[0].resourceId === resource.id,
        "canonical_placement_required",
      );
      return { id: added[0].blockId };
    },
    setOrganization(input) {
      const state = workspaceState(input.workspaceId),
        ids = new Set(state.blocks.map((block) => block.blockId));
      const order = input.organization.structured?.order,
        spans = input.organization.structured?.spans;
      if (order)
        check(
          order.length === ids.size &&
            new Set(order).size === ids.size &&
            order.every((id) => ids.has(id)),
          "invalid_template_placement_order",
        );
      if (spans)
        check(
          Object.keys(spans).every((id) => ids.has(id)),
          "invalid_template_span_target",
        );
      const organized = engine.execute({
        ...envelope(state),
        type: "setOrganization",
        organization: input.organization,
        expectedOrganizationRevision: state.organization.revision,
      });
      engine.execute({
        ...envelope(organized),
        type: "saveLayout",
        placements: [],
        viewport: input.viewport,
      });
    },
    setTaskGroupMembers(input) {
      const group = readResource(input.groupId);
      check(
        group?.authorized && group.kind === "task_group",
        "task_group_required",
      );
      for (const id of input.taskIds) {
        const task = readResource(id);
        check(task?.authorized && task.kind === "task", "task_unavailable");
      }
      const command: TaskGroupMembershipCommand = {
        type: "setTaskGroupMembers",
        groupId: group.id,
        expectedVersion: group.version,
        taskIds: [...input.taskIds],
      };
      const result: unknown = options.setTaskGroupMembers(command);
      check(!(result instanceof Promise), "synchronous_host_required");
    },
  };
}
