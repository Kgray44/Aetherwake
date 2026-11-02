import type { Snapshot, Node, Point, Location } from "./types.ts";

export const keyOf = (kind: Node["kind"], id: string) => `${kind}:${id}`;
export const scopeOf = (l: Location) =>
  l.kind === "universe"
    ? "universe"
    : l.kind === "project"
      ? `project:${l.projectId}`
      : `workspace:${l.workspaceId}`;
export const permitted = (value: { visible?: boolean }) =>
  value.visible !== false;
/** Logical Universe scope; this does not create a canonical domain object. */
export const isUniverseRoot = (node: Node) => node.parent === null;

/** Filter BEFORE layout/counts/search. The service remains the policy authority. */
export function project(
  snapshot: Snapshot,
  anchors: Record<string, Point>,
): Map<string, Node> {
  const nodes = new Map<string, Node>();
  const projects = snapshot.projects.filter(permitted);
  const projectIds = new Set(projects.map((p) => p.id));
  const workspaces = snapshot.workspaces.filter(
    (w) =>
      permitted(w) && (w.project_id === null || projectIds.has(w.project_id)),
  );
  const workspacesById = new Map(workspaces.map((w) => [w.id, w]));
  const eligibleAnchors = new Set([
    ...projects.map((p) => keyOf("project", p.id)),
    ...workspaces.map((w) => keyOf("workspace", w.id)),
  ]);
  const resources = new Map(
    snapshot.resources.filter(permitted).map((r) => [r.id, r]),
  );
  const blocks = snapshot.blocks.filter(
    (b): b is Snapshot["blocks"][number] & { resource_id: string } =>
      permitted(b) &&
      typeof b.resource_id === "string" &&
      (!b.subject ||
        (b.subject.kind === "resource" &&
          b.subject.resourceId === b.resource_id)) &&
      workspacesById.has(b.workspace_id) &&
      resources.has(b.resource_id),
  );
  const placedResources = new Set(blocks.map((block) => block.resource_id)),
    universeResources = [...resources.values()]
      .filter(
        (resource) =>
          resource.project_id == null && !placedResources.has(resource.id),
      )
      .toSorted((a, b) => a.id.localeCompare(b.id));
  for (const resource of universeResources)
    eligibleAnchors.add(keyOf("resource", "unplaced:" + resource.id));
  const occupied = new Map<string, Set<string>>(),
    cursors = new Map<string, number>();
  const position = (
    key: string,
    scope: string,
    center: Point,
    spacing: number,
  ): Point => {
    if (anchors[key]) return anchors[key];
    let used = occupied.get(scope);
    if (!used) {
      used = new Set(
        Object.entries(anchors)
          .filter(([key]) => eligibleAnchors.has(key))
          .map(([, p]) => `${p.x},${p.y}`),
      );
      occupied.set(scope, used);
    }
    // Incremental grid: new objects occupy empty cells; existing objects never move.
    let index = cursors.get(scope) ?? 0,
      x = 0,
      y = 0;
    const scale = scope === "universe-resources" ? 1 : spacing;
    do {
      if (scope === "universe-resources") {
        // A compact append-only spiral avoids a long strip as independent
        // resources grow. Existing/manual points remain authoritative.
        const radius = Math.sqrt(index),
          angle = index * 2.399963229728653;
        x = Math.round(Math.cos(angle) * radius * spacing);
        y = Math.round(Math.sin(angle) * radius * spacing);
      } else {
        x = (index % 4) - 1.5;
        y = Math.floor(index / 4) - 0.5;
      }
      index++;
    } while (used.has(`${center.x + x * scale},${center.y + y * scale}`));
    used.add(`${center.x + x * scale},${center.y + y * scale}`);
    cursors.set(scope, index);
    return (anchors[key] = {
      x: center.x + x * scale,
      y: center.y + y * scale,
    });
  };
  for (const p of projects.toSorted((a, b) => a.id.localeCompare(b.id))) {
    const key = keyOf("project", p.id);
    nodes.set(key, {
      key,
      id: p.id,
      title: p.title,
      kind: "project",
      parent: null,
      available: p.available !== false,
      point: position(key, "universe", { x: 0, y: 0 }, 1000),
    });
  }
  for (const w of workspaces.toSorted((a, b) => a.id.localeCompare(b.id))) {
    const key = keyOf("workspace", w.id),
      parent = w.project_id ? keyOf("project", w.project_id) : null;
    const center = parent ? nodes.get(parent)!.point : { x: 0, y: 1500 };
    nodes.set(key, {
      key,
      id: w.id,
      title: w.title,
      kind: "workspace",
      parent,
      available: w.available !== false,
      point: position(key, parent ?? "standalone", center, 300),
      workspaceId: w.id,
    });
  }
  for (const b of blocks) {
    const r = resources.get(b.resource_id)!,
      key = keyOf("resource", b.id),
      parent = keyOf("workspace", b.workspace_id),
      center = nodes.get(parent)!.point;
    // Geometry comes from canonical block placement, not graph proximity.
    nodes.set(key, {
      key,
      id: r.id,
      resourceId: r.id,
      resourceKind: r.kind,
      workspaceId: b.workspace_id,
      title: r.title,
      kind: "resource",
      parent,
      available:
        r.available !== false &&
        b.available !== false &&
        b.subjectState !== "archived" &&
        b.subjectState !== "unavailable",
      point: { x: center.x + b.x * 0.6, y: center.y + 160 + b.y * 0.6 },
    });
  }
  // A reference in another project does not replace the resource's canonical
  // project association. Existing workspace representations retain their parent.
  const placedInProjects = new Map<string, Set<string>>();
  for (const b of blocks) {
    const projectId = workspacesById.get(b.workspace_id)!.project_id;
    if (!projectId) continue;
    const represented =
      placedInProjects.get(b.resource_id) ?? new Set<string>();
    represented.add(projectId);
    placedInProjects.set(b.resource_id, represented);
  }
  for (const r of resources.values())
    if (
      r.project_id &&
      projectIds.has(r.project_id) &&
      !placedInProjects.get(r.id)?.has(r.project_id)
    ) {
      const key = keyOf("resource", "unplaced:" + r.id),
        parent = keyOf("project", r.project_id),
        center = nodes.get(parent)!.point;
      nodes.set(key, {
        key,
        id: r.id,
        resourceId: r.id,
        resourceKind: r.kind,
        title: r.title,
        kind: "resource",
        parent,
        available: r.available !== false,
        point: { x: center.x + 200, y: center.y + 200 },
      });
    }
  // Independently granted resources need no project or placement to exist here.
  for (const resource of universeResources) {
    const key = keyOf("resource", "unplaced:" + resource.id);
    nodes.set(key, {
      key,
      id: resource.id,
      resourceId: resource.id,
      resourceKind: resource.kind,
      title: resource.title,
      kind: "resource",
      parent: null,
      available: resource.available !== false,
      point: position(key, "universe-resources", { x: 0, y: 0 }, 160),
    });
  }
  // Canonical membership may organize a presentation, never change placement or ownership.
  const memberships = snapshot.relationships.filter(
    (e) =>
      e.kind === "contains_task" &&
      permitted(e) &&
      e.available !== false &&
      e.provenance !== "inferred",
  );
  if (memberships.length) {
    const placements = new Map<string, Node[]>();
    for (const n of nodes.values())
      if (
        n.kind === "resource" &&
        n.available &&
        n.workspaceId &&
        nodes.get(keyOf("workspace", n.workspaceId))?.available &&
        ["task", "task_group"].includes(n.resourceKind ?? "")
      ) {
        const list = placements.get(n.id) ?? [];
        list.push(n);
        placements.set(n.id, list);
      }
    const parents = new Map<string, Set<string>>();
    for (const edge of memberships)
      for (const group of placements.get(edge.source_id) ?? [])
        if (group.resourceKind === "task_group")
          for (const member of placements.get(edge.target_id) ?? [])
            if (
              member.resourceKind === "task" &&
              group.workspaceId === member.workspaceId
            ) {
              const candidates = parents.get(member.key) ?? new Set<string>();
              candidates.add(group.key);
              parents.set(member.key, candidates);
            }
    for (const [key, candidates] of parents)
      if (candidates.size === 1) {
        const member = nodes.get(key)!;
        member.parent = [...candidates][0];
        // Keep parents before children for incremental layout and coherent cluster moves.
        nodes.delete(key);
        nodes.set(key, member);
      }
  }
  return nodes;
}

export function isLocation(l: unknown): l is Location {
  if (!l || typeof l !== "object") return false;
  const x = l as Record<string, unknown>;
  const id = (v: unknown) =>
    typeof v === "string" && v.length > 0 && v.length < 512;
  return (
    x.kind === "universe" ||
    (x.kind === "project" && id(x.projectId)) ||
    (x.kind === "workspace" && id(x.workspaceId)) ||
    (x.kind === "surface" &&
      id(x.workspaceId) &&
      id(x.resourceId) &&
      id(x.blockId))
  );
}
export function locationNode(
  l: Location,
  nodes: Map<string, Node>,
): Node | undefined {
  return l.kind === "universe"
    ? undefined
    : nodes.get(
        l.kind === "project"
          ? keyOf("project", l.projectId)
          : l.kind === "workspace"
            ? keyOf("workspace", l.workspaceId)
            : keyOf("resource", l.blockId),
      );
}
export function allowedLocation(
  l: Location,
  nodes: Map<string, Node>,
): boolean {
  if (l.kind === "universe") return true;
  const n = locationNode(l, nodes);
  return (
    !!n &&
    n.available &&
    (l.kind !== "surface" ||
      (n.workspaceId === l.workspaceId && n.resourceId === l.resourceId))
  );
}
