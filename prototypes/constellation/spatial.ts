import type { ConstellationController } from "./controller.ts";
import { keyOf, locationNode } from "./projection.ts";
import type { Anchor, Node } from "./types.ts";
import type { SpatialCamera, Vector3 } from "./spatial-types.ts";

export const hash = (text: string) => {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0) / 4294967296;
};
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const rounded = (p: Vector3): Vector3 => ({
  x: Math.round(p.x * 1000) / 1000,
  y: Math.round(p.y * 1000) / 1000,
  z: Math.round(p.z * 1000) / 1000,
});
export const validVector = (p: unknown): p is Vector3 =>
  !!p &&
  typeof p === "object" &&
  ["x", "y", "z"].every(
    (k) =>
      Number.isFinite((p as Record<string, number>)[k]) &&
      Math.abs((p as Record<string, number>)[k]) < 1e7,
  );
export function validSpatialCamera(p: unknown): p is SpatialCamera {
  const c = p as SpatialCamera;
  return (
    !!c &&
    validVector(c.target) &&
    Number.isFinite(c.yaw) &&
    Math.abs(c.yaw) <= Math.PI * 100 &&
    Number.isFinite(c.pitch) &&
    Math.abs(c.pitch) <= 1.35 &&
    Number.isFinite(c.distance) &&
    c.distance >= 100 &&
    c.distance <= 100000 &&
    ["orbit", "pan"].includes(c.mode) &&
    Number.isFinite(c.sensitivity) &&
    c.sensitivity >= 0.1 &&
    c.sensitivity <= 3 &&
    (c.neighborhood === undefined ||
      (typeof c.neighborhood === "string" && c.neighborhood.length < 1024)) &&
    (c.presentation === undefined ||
      c.presentation === "spatial" ||
      c.presentation === "list")
  );
}
export type SpatialEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  kind: string;
  provenance: string;
  createdAt?: string;
  evidenceRef?: string;
  freshness?: string;
  sourceMessageId?: string;
  sourceKey?: string;
  targetKey?: string;
};
export function edges(controller: ConstellationController): SpatialEdge[] {
  const allowed = new Set(
    [...controller.nodes.values()]
      .filter((n) => n.kind === "resource")
      .map((n) => n.id),
  );
  const direct: SpatialEdge[] = controller.snapshot.relationships
    .filter(
      (e) =>
        e.visible !== false &&
        allowed.has(e.source_id) &&
        allowed.has(e.target_id),
    )
    .map((e) => ({
      id: e.id,
      sourceId: e.source_id,
      targetId: e.target_id,
      kind: e.kind,
      provenance: e.provenance,
      createdAt: e.created_at,
      evidenceRef: e.evidenceRef,
      freshness: e.freshness,
    }));
  for (const b of controller.snapshot.conversationBranches ?? [])
    if (
      b.visible !== false &&
      allowed.has(b.parentResourceId) &&
      allowed.has(b.childResourceId)
    )
      direct.push({
        id: `lineage:${b.parentResourceId}:${b.childResourceId}:${b.sourceMessageId}`,
        sourceId: b.parentResourceId,
        targetId: b.childResourceId,
        kind:
          b.mode === "native_fork"
            ? "branches_from_native"
            : "application_continuation",
        provenance: b.mode,
        createdAt: b.createdAt,
        sourceMessageId: b.sourceMessageId,
      } as SpatialEdge);
  for (const n of controller.nodes.values()) {
    const parent = n.parent ? controller.nodes.get(n.parent) : undefined;
    if (parent && n.available && parent.available)
      direct.push({
        id: "membership:" + n.key,
        sourceId: n.id,
        targetId: parent.id,
        sourceKey: n.key,
        targetKey: parent.key,
        kind:
          n.kind === "workspace" ? "project_membership" : "workspace_placement",
        provenance: "canonical application fields",
        evidenceRef:
          n.kind === "workspace"
            ? "workspace.project_id"
            : "block.workspace_id / block.resource_id",
        freshness: "current projection",
      });
  }
  return direct;
}

/** All coordinates are view state, never ownership/content/permission state. */
export class SpatialNavigator {
  readonly id: string;
  mode: "orbit" | "pan" = "orbit";
  presentation: "spatial" | "list" = "spatial";
  sensitivity = 1;
  neighborhood: string | undefined;
  private undo: { key: string; position: Vector3; pinned: boolean }[] = [];
  readonly controller: ConstellationController;
  private dirty: () => void;
  constructor(controller: ConstellationController, dirty: () => void) {
    this.controller = controller;
    this.dirty = dirty;
    this.id = controller.motionId + ":orbit";
    this.updateGraph();
    const p = this.defaultCamera();
    controller.motion.add(this.id, this.pose(p));
  }
  private pose(c: SpatialCamera) {
    return {
      x: c.target.x,
      y: c.target.y,
      h: c.target.z,
      w: c.distance,
      lift: c.yaw,
      yaw: c.pitch,
      opacity: 1,
    };
  }
  get camera(): SpatialCamera {
    const p = this.controller.motion.pose(this.id);
    return {
      target: { x: p.x, y: p.y, z: p.h },
      distance: p.w,
      yaw: p.lift,
      pitch: p.yaw,
      mode: this.mode,
      sensitivity: this.sensitivity,
      presentation: this.presentation,
      ...(this.neighborhood ? { neighborhood: this.neighborhood } : {}),
    };
  }
  bookmark(): SpatialCamera {
    const p = this.controller.motion.bodies.get(this.id)!.channels;
    return {
      target: { x: p.x.target, y: p.y.target, z: p.h.target },
      distance: p.w.target,
      yaw: p.lift.target,
      pitch: p.yaw.target,
      mode: this.mode,
      sensitivity: this.sensitivity,
      presentation: this.presentation,
      ...(this.neighborhood ? { neighborhood: this.neighborhood } : {}),
    };
  }
  position(key: string): Vector3 {
    const n = this.controller.nodes.get(key);
    if (!n) throw Error("Object unavailable");
    const p = this.controller.state.anchors[key]?.spatial;
    return p ?? { x: n.point.x, y: 0, z: n.point.y };
  }
  updateGraph() {
    const c = this.controller,
      nodes = [...c.nodes.values()];
    const ordinals = new Map<string, number>(),
      added = new Set<string>();
    for (const n of nodes) {
      const base: Anchor = c.state.anchors[n.key] ?? { ...n.point };
      if (!validVector(base.spatial)) {
        added.add(n.key);
        const h = hash(n.key),
          parent = n.parent ? c.state.anchors[n.parent]?.spatial : undefined;
        if (n.kind === "project" || !parent)
          base.spatial = {
            x: n.point.x,
            y: (h - 0.5) * 240,
            z: n.point.y * 0.8,
          };
        else {
          const i = ordinals.get(n.parent!) ?? 0,
            angle = h * Math.PI * 2;
          ordinals.set(n.parent!, i + 1);
          const radius =
            n.kind === "workspace" ? 520 : 145 + Math.floor(i / 12) * 70;
          base.spatial = {
            x: parent.x + Math.cos(angle) * radius,
            y: parent.y + (h - 0.5) * (n.kind === "workspace" ? 280 : 190),
            z: parent.z + Math.sin(angle) * radius,
          };
        }
        base.spatial = rounded(base.spatial);
        c.state.anchors[n.key] = base;
      }
    }
    // Place newly created branch nodes near their real source without moving pins.
    for (const b of c.snapshot.conversationBranches ?? []) {
      if (b.visible === false) continue;
      const source = nodes.find(
        (n) => n.kind === "resource" && n.id === b.parentResourceId,
      );
      if (!source) continue;
      for (const child of nodes.filter(
        (n) => n.kind === "resource" && n.id === b.childResourceId,
      )) {
        const a = c.state.anchors[child.key];
        if (a && !a.pinned && added.has(child.key)) {
          const p = this.position(source.key),
            h = hash(child.key);
          a.spatial = rounded({
            x: p.x + 130,
            y: p.y + 70,
            z: p.z + (h - 0.5) * 180,
          });
        }
      }
    }
    if (this.neighborhood && !c.nodes.has(this.neighborhood))
      this.neighborhood = undefined;
  }
  defaultCamera(): SpatialCamera {
    const l = this.controller.location,
      n = locationNode(l, this.controller.nodes);
    let target = n ? this.position(n.key) : { x: 0, y: 0, z: 0 },
      distance =
        l.kind === "project" ? 1900 : l.kind === "universe" ? 4700 : 800;
    if (l.kind === "universe") {
      const roots = [...this.controller.nodes.values()].filter(
        (n) => n.parent === null,
      );
      if (roots.length) {
        const ps = roots.map((n) => this.position(n.key));
        target = {
          x: ps.reduce((s, p) => s + p.x, 0) / ps.length,
          y: 0,
          z: ps.reduce((s, p) => s + p.z, 0) / ps.length,
        };
        distance = Math.max(
          2800,
          ...ps.map(
            (p) => Math.hypot(p.x - target.x, p.z - target.z) * 2.5 + 1500,
          ),
        );
      }
    }
    return {
      target,
      distance,
      yaw: 0.42,
      pitch: 0.38,
      mode: this.mode,
      sensitivity: this.sensitivity,
    };
  }
  target(camera: SpatialCamera, cause = "spatial navigation") {
    if (!validSpatialCamera(camera)) throw Error("Invalid spatial camera");
    this.mode = camera.mode;
    this.sensitivity = camera.sensitivity;
    this.presentation = camera.presentation ?? this.presentation;
    this.neighborhood =
      camera.neighborhood && this.controller.nodes.has(camera.neighborhood)
        ? camera.neighborhood
        : undefined;
    this.controller.motion.target(this.id, this.pose(camera), cause);
    if (
      this.controller.policy.reduced ||
      this.controller.policy.quiet ||
      this.controller.policy.hidden
    )
      this.controller.motion.snap(this.id);
    this.dirty();
  }
  restore(camera?: SpatialCamera) {
    this.target(
      camera && validSpatialCamera(camera) ? camera : this.defaultCamera(),
    );
  }
  orbit(dx: number, dy: number) {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const p = this.bookmark();
    this.target(
      {
        ...p,
        yaw: clamp(
          p.yaw - dx * 0.004 * this.sensitivity,
          -Math.PI * 20,
          Math.PI * 20,
        ),
        pitch: clamp(p.pitch + dy * 0.003 * this.sensitivity, -1.2, 1.2),
      },
      "orbit",
    );
  }
  pan(dx: number, dy: number) {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const p = this.bookmark(),
      scale = p.distance / 1400;
    p.target = {
      x: p.target.x + dx * Math.cos(p.yaw) * scale,
      y: p.target.y + dy * scale,
      z: p.target.z - dx * Math.sin(p.yaw) * scale,
    };
    this.target(p, "spatial pan");
  }
  zoom(factor: number) {
    if (!Number.isFinite(factor) || factor <= 0) return;
    const p = this.bookmark();
    this.target(
      { ...p, distance: clamp(p.distance / factor, 180, 100000) },
      "dolly",
    );
  }
  fit(key = this.controller.selected) {
    if (!key || !this.controller.nodes.has(key)) return;
    const n = this.controller.nodes.get(key)!;
    this.target(
      {
        ...this.bookmark(),
        target: this.position(key),
        distance:
          n.kind === "project" ? 1750 : n.kind === "workspace" ? 850 : 550,
      },
      "approach selection",
    );
  }
  interrupt() {
    this.controller.motion.target(
      this.id,
      this.pose(this.camera),
      "stop orbit",
      true,
    );
    this.controller.motion.snap(this.id);
    this.dirty();
  }
  recenter() {
    this.neighborhood = undefined;
    this.target(this.defaultCamera(), "recenter spatial view");
  }
  async place(key: string, position: Vector3, pinned = true) {
    if (!validVector(position) || !this.controller.nodes.has(key))
      throw Error("Invalid spatial position");
    const a = this.controller.state.anchors[key] ?? {
      ...this.controller.nodes.get(key)!.point,
    };
    this.undo.push({
      key,
      position: { ...this.position(key) },
      pinned: a.pinned === true,
    });
    this.undo = this.undo.slice(-32);
    a.spatial = rounded(position);
    a.pinned = pinned;
    this.controller.state.anchors[key] = a;
    this.dirty();
    await this.controller.persist();
  }
  async undoPosition() {
    const u = this.undo.pop();
    if (!u || !this.controller.nodes.has(u.key)) return;
    Object.assign(this.controller.state.anchors[u.key], {
      spatial: u.position,
      pinned: u.pinned,
    });
    this.dirty();
    await this.controller.persist();
  }
  async explore(key: string) {
    const n = this.controller.nodes.get(key);
    if (!n || n.kind !== "resource") return;
    await this.controller.locate(key);
    this.neighborhood = key;
    this.fit(key);
    await this.controller.persist();
    this.dirty();
  }
  candidateNodes(): Node[] {
    const c = this.controller,
      l = c.location;
    if (l.kind === "workspace" || l.kind === "surface") return [];
    let all = [...c.nodes.values()];
    if (l.kind === "universe")
      return all.filter(
        (n) => n.kind === "project" || (n.kind === "workspace" && !n.parent),
      );
    const p = keyOf("project", l.projectId),
      workspaces = new Set(all.filter((n) => n.parent === p).map((n) => n.key));
    all = all.filter(
      (n) => n.key === p || n.parent === p || workspaces.has(n.parent ?? ""),
    );
    if (this.neighborhood) {
      const focus = c.nodes.get(this.neighborhood),
        ids = new Set(focus ? [focus.id] : []);
      for (const e of edges(c))
        if (e.sourceId === focus?.id || e.targetId === focus?.id) {
          ids.add(e.sourceId);
          ids.add(e.targetId);
        }
      all = all.filter((n) => n.kind !== "resource" || ids.has(n.id));
    }
    return all;
  }
  dispose() {
    this.controller.motion.bodies.delete(this.id);
  }
}
