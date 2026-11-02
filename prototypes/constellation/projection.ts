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
  const workspaceIds = new Set(workspaces.map((w) => w.id));
  const eligibleAnchors = new Set([
    ...projects.map((p) => keyOf("project", p.id)),
    ...workspaces.map((w) => keyOf("workspace", w.id)),
  ]);
  const resources = new Map(
    snapshot.resources.filter(permitted).map((r) => [r.id, r]),
  );
  const blocks = snapshot.blocks.filter(
    (b) =>
      permitted(b) &&
      workspaceIds.has(b.workspace_id) &&
      resources.has(b.resource_id),
  );
  const occupied = new Map<string, Set<string>>();
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
    let index = 0,
      x = 0,
      y = 0;
    do {
      x = (index % 4) - 1.5;
      y = Math.floor(index / 4) - 0.5;
      index++;
    } while (used.has(`${center.x + x * spacing},${center.y + y * spacing}`));
    used.add(`${center.x + x * spacing},${center.y + y * spacing}`);
    return (anchors[key] = {
      x: center.x + x * spacing,
      y: center.y + y * spacing,
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
      available: r.available !== false && b.available !== false,
      point: { x: center.x + b.x * 0.6, y: center.y + 160 + b.y * 0.6 },
    });
  }
  const placed = new Set(blocks.map((b) => b.resource_id));
  for (const r of resources.values())
    if (!placed.has(r.id) && r.project_id && projectIds.has(r.project_id)) {
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
