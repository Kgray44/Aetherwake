import type { ConstellationController } from "./controller.ts";
import { keyOf, locationNode } from "./projection.ts";
import type { Anchor, Node } from "./types.ts";
import type { SpatialCamera, Vector3 } from "./spatial-types.ts";
import { hash } from "./identity.ts";
export { hash } from "./identity.ts";
import { BODY_GAP, bodyEnvelope } from "./body-metrics.ts";
import { BodySpace } from "./spacing.ts";

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
    const parent =
      n.kind === "resource" && n.workspaceId
        ? controller.nodes.get(keyOf("workspace", n.workspaceId))
        : n.parent
          ? controller.nodes.get(n.parent)
          : undefined;
    if (parent && n.available && parent.available)
      direct.push({
        id: "membership:" + n.key,
        sourceId: n.id,
        targetId: parent.id,
        sourceKey: n.key,
        targetKey: parent.key,
        kind:
          n.kind === "workspace"
            ? "project_membership"
            : parent.kind === "project"
              ? "resource_project_membership"
              : "workspace_placement",
        provenance: "canonical application fields",
        evidenceRef:
          n.kind === "workspace"
            ? "workspace.project_id"
            : parent.kind === "project"
              ? "resource.project_id"
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
  manualRevision = 0;
  layoutRevision = 0;
  private semanticPending = false;
  private undo: { key: string; position: Vector3; pinned: boolean }[][] = [];
  private preview = new Map<string, Vector3>();
  private space = new BodySpace();
  private radii = new Map<string, { identity: string; radius: number }>();
  notice = "";
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
    const p =
      this.preview.get(key) ?? this.controller.state.anchors[key]?.spatial;
    return p ?? { x: n.point.x, y: 0, z: n.point.y };
  }
  radius(key: string) {
    const n = this.controller.nodes.get(key);
    if (!n) throw Error("Object unavailable");
    const identity = n.kind + ":" + n.id,
      old = this.radii.get(key);
    if (old?.identity === identity) return old.radius;
    const radius = bodyEnvelope(n.id, n.kind);
    this.radii.set(key, { identity, radius });
    return radius;
  }
  updateGraph() {
    const c = this.controller,
      nodes = [...c.nodes.values()];
    for (const key of this.preview.keys())
      if (!c.nodes.has(key)) this.preview.delete(key);
    for (const key of this.radii.keys())
      if (!c.nodes.has(key)) {
        this.radii.delete(key);
        this.space.remove(key);
      }
    if (
      nodes.some((n) => {
        const old = this.space.bodies.get(n.key),
          p = c.state.anchors[n.key]?.spatial;
        return (
          old &&
          (!validVector(p) ||
            old.radius !== this.radius(n.key) ||
            old.point.x !== p.x ||
            old.point.y !== p.y ||
            old.point.z !== p.z)
        );
      })
    )
      this.space.clear();
    const pending = nodes.filter((n) => !this.space.bodies.has(n.key));
    if (!pending.length) {
      if (this.neighborhood && !c.nodes.has(this.neighborhood))
        this.neighborhood = undefined;
      return;
    }
    // A canonical refresh can add an obstacle while a layout is being previewed.
    // Cancel that transient presentation before packing the new graph.
    this.preview.clear();
    this.layoutRevision++;
    const oldPositions = new Map(
      nodes
        .filter((n) => validVector(c.state.anchors[n.key]?.spatial))
        .map((n) => [n.key, { ...c.state.anchors[n.key].spatial! }]),
    );
    const ordinals = new Map<string, number>(),
      ranks = new Map<string, number>();
    for (const n of nodes) {
      const parent = n.parent ?? "universe",
        rank = ordinals.get(parent) ?? 0;
      ranks.set(n.key, rank);
      ordinals.set(parent, rank + 1);
    }
    const byResource = new Map(
      nodes.filter((n) => n.kind === "resource").map((n) => [n.id, n]),
    );
    const branchSources = new Map<string, string>();
    for (const b of c.snapshot.conversationBranches ?? [])
      if (
        b.visible !== false &&
        byResource.has(b.parentResourceId) &&
        byResource.has(b.childResourceId)
      )
        branchSources.set(
          b.childResourceId,
          byResource.get(b.parentResourceId)!.key,
        );
    const pinned = pending
      .filter((n) => c.state.anchors[n.key]?.pinned && oldPositions.has(n.key))
      .sort((a, b) => a.key.localeCompare(b.key));
    const pinnedKeys = new Set(pinned.map((n) => n.key)),
      order = [...pinned, ...pending.filter((n) => !pinnedKeys.has(n.key))];
    let repaired = 0,
      pinRepairs = 0;
    for (const n of order) {
      const base: Anchor = c.state.anchors[n.key] ?? { ...n.point },
        old = oldPositions.get(n.key),
        r = this.radius(n.key),
        parent = n.parent ? c.state.anchors[n.parent]?.spatial : undefined,
        h = hash(n.key),
        rank = ranks.get(n.key) ?? 0;
      let legacy = false;
      if (
        old &&
        !base.pinned &&
        n.kind === "project" &&
        Math.abs(old.x - n.point.x) < 0.01 &&
        Math.abs(old.z - n.point.y * 0.8) < 0.01 &&
        Math.abs(old.y - (h - 0.5) * 240) < 0.01
      )
        legacy = true;
      if (old && !base.pinned && n.kind !== "project")
        for (const parentKey of new Set([
          n.parent,
          n.workspaceId ? keyOf("workspace", n.workspaceId) : null,
        ])) {
          const p = parentKey ? oldPositions.get(parentKey) : undefined;
          if (!p) continue;
          const distance = Math.hypot(old.x - p.x, old.z - p.z),
            shell = (distance - 145) / 70,
            oldRadius =
              n.kind === "workspace" ? 520 : 145 + Math.round(shell) * 70;
          if (
            (n.kind === "workspace" || shell >= -0.001) &&
            Math.abs(old.x - p.x - Math.cos(h * Math.PI * 2) * oldRadius) <
              0.01 &&
            Math.abs(old.z - p.z - Math.sin(h * Math.PI * 2) * oldRadius) <
              0.01 &&
            Math.abs(
              old.y - p.y - (h - 0.5) * (n.kind === "workspace" ? 280 : 190),
            ) < 0.01
          )
            legacy = true;
        }
      let preferred =
        old && !legacy
          ? old
          : { x: n.point.x * 2, y: (h - 0.5) * 240, z: n.point.y * 1.6 };
      if ((!old || legacy) && parent) {
        const centerKey = branchSources.get(n.id) ?? n.parent!,
          center = c.state.anchors[centerKey]?.spatial ?? parent,
          pr = this.radius(centerKey),
          distance =
            pr +
            r +
            BODY_GAP +
            (n.kind === "workspace" ? 160 : 65) +
            hash("distance:" + n.key) * (n.kind === "workspace" ? 420 : 170) +
            (Math.cbrt(rank + 1) - 1) * (r * 2 + BODY_GAP) * 1.3,
          elevation = (hash("elevation:" + n.key) - 0.5) * 1.1,
          angle = hash("azimuth:" + n.key) * Math.PI * 2,
          flat = Math.sqrt(1 - elevation * elevation);
        preferred = {
          x: center.x + Math.cos(angle) * distance * flat,
          y: center.y + elevation * distance,
          z: center.z + Math.sin(angle) * distance * flat,
        };
      }
      const point = this.space.find(n.key, preferred, r);
      if (
        old &&
        (point.x !== old.x || point.y !== old.y || point.z !== old.z)
      ) {
        repaired++;
        if (base.pinned) pinRepairs++;
      }
      base.spatial = point;
      c.state.anchors[n.key] = base;
      this.space.set({ key: n.key, point, radius: r });
    }
    if (repaired)
      this.notice = pinRepairs
        ? "Conflicting saved pins were moved to the nearest clear positions."
        : "Existing crowded positions were separated with a clear gap.";
    if (this.neighborhood && !c.nodes.has(this.neighborhood))
      this.neighborhood = undefined;
  }
  defaultCamera(): SpatialCamera {
    const l = this.controller.location,
      n = locationNode(l, this.controller.nodes);
    let target = n ? this.position(n.key) : { x: 0, y: 0, z: 0 },
      distance =
        l.kind === "project" ? 1450 : l.kind === "universe" ? 2800 : 800;
    if (l.kind === "project" && n) distance = this.projectDistance(n);
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
          3300,
          ...ps.map(
            (p) => Math.hypot(p.x - target.x, p.z - target.z) * 1.6 + 900,
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
  private projectDistance(n: Node) {
    const target = this.position(n.key);
    let distance = 1800;
    for (const child of this.controller.nodes.values())
      if (child.kind === "workspace" && child.parent === n.key) {
        const p = this.position(child.key);
        distance = Math.max(
          distance,
          Math.hypot(p.x - target.x, p.y - target.y, p.z - target.z) * 2 +
            this.radius(child.key),
        );
      }
    return Math.min(3000, distance);
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
    this.manualRevision++;
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
  pan(dx: number, dy: number, viewportHeight = 1100) {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    this.manualRevision++;
    const p = this.bookmark(),
      scale =
        (2 * p.distance * Math.tan((43 * Math.PI) / 360)) /
        Math.max(1, viewportHeight),
      sy = Math.sin(p.yaw),
      cy = Math.cos(p.yaw),
      sp = Math.sin(p.pitch),
      cp = Math.cos(p.pitch);
    p.target = {
      x: p.target.x + (dx * cy - dy * sy * sp) * scale,
      y: p.target.y + dy * cp * scale,
      z: p.target.z + (-dx * sy - dy * cy * sp) * scale,
    };
    this.target(p, "spatial pan");
  }
  zoom(factor: number) {
    if (!Number.isFinite(factor) || factor <= 0) return;
    this.manualRevision++;
    const p = this.bookmark();
    p.distance = clamp(p.distance / factor, 180, 100000);
    const c = this.controller;
    if (c.location.kind === "universe" && factor > 1) {
      const selected = c.nodes.get(c.selected ?? "");
      if (selected?.kind === "project")
        p.target = { ...this.position(selected.key) };
    }
    this.target(p, "dolly");
    if (this.neighborhood && p.distance > 2200) {
      this.neighborhood = undefined;
      delete p.neighborhood;
    }
    if (this.semanticPending || c.pending) return;
    let destination: import("./types.ts").Location | undefined;
    if (
      c.location.kind === "project" &&
      factor < 1 &&
      p.distance >
        Math.max(
          3300,
          this.projectDistance(
            c.nodes.get(keyOf("project", c.location.projectId))!,
          ) * 1.5,
        )
    )
      destination = { kind: "universe" };
    else if (c.location.kind === "universe" && factor > 1) {
      const nearest = [...c.nodes.values()]
        .filter((n) => n.kind === "project")
        .sort((a, b) => {
          const ap = this.position(a.key),
            bp = this.position(b.key);
          return (
            Math.hypot(ap.x - p.target.x, ap.z - p.target.z) -
            Math.hypot(bp.x - p.target.x, bp.z - p.target.z)
          );
        })[0];
      if (nearest) {
        const at = this.position(nearest.key);
        if (
          p.distance < Math.max(1900, this.projectDistance(nearest) * 1.2) &&
          Math.hypot(at.x - p.target.x, at.y - p.target.y, at.z - p.target.z) <
            900
        )
          destination = { kind: "project", projectId: nearest.id };
      }
    }
    if (destination) {
      this.semanticPending = true;
      void c
        .go(destination, undefined, p)
        .catch((e) => {
          c.error = e instanceof Error ? e.message : "Navigation unavailable";
          this.dirty();
        })
        .finally(() => {
          this.semanticPending = false;
        });
    }
  }
  fit(key = this.controller.selected) {
    if (!key || !this.controller.nodes.has(key)) return;
    this.manualRevision++;
    const n = this.controller.nodes.get(key)!;
    this.target(
      {
        ...this.bookmark(),
        target: this.position(key),
        distance:
          n.kind === "project"
            ? this.projectDistance(n)
            : n.kind === "workspace"
              ? 850
              : 550,
      },
      "approach selection",
    );
  }
  interrupt(manual = true) {
    if (manual) this.manualRevision++;
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
    this.manualRevision++;
    this.neighborhood = undefined;
    this.target(this.defaultCamera(), "recenter spatial view");
  }
  private cluster(key: string) {
    const moved = new Set([key]);
    for (const n of this.controller.nodes.values())
      if (
        n.parent &&
        moved.has(n.parent) &&
        !this.controller.state.anchors[n.key]?.pinned
      )
        moved.add(n.key);
    return [...moved].map((key) => ({
      key,
      point: { ...this.controller.state.anchors[key].spatial! },
      radius: this.radius(key),
    }));
  }
  private clearPlan(targets: Map<string, Vector3>) {
    const test = new BodySpace();
    for (const entry of this.space.bodies.values())
      if (!targets.has(entry.key)) test.set(entry);
    for (const [key, point] of targets) {
      if (!test.free(key, point, this.radius(key))) return false;
      test.set({ key, point, radius: this.radius(key) });
    }
    return true;
  }
  async place(key: string, position: Vector3, pinned = true) {
    if (!validVector(position) || !this.controller.nodes.has(key))
      throw Error("Invalid spatial position");
    const moving = this.cluster(key),
      before = moving[0].point;
    const delta = {
      x: position.x - before.x,
      y: position.y - before.y,
      z: position.z - before.z,
    };
    const requested = new Map(
      moving.map((b) => [
        b.key,
        rounded({
          x: b.point.x + delta.x,
          y: b.point.y + delta.y,
          z: b.point.z + delta.z,
        }),
      ]),
    );
    const fraction = this.clearPlan(requested)
        ? 1
        : this.space.fraction(moving, delta),
      changes = moving.map((b) => ({
        key: b.key,
        position: b.point,
        pinned: this.controller.state.anchors[b.key].pinned === true,
      }));
    for (const body of moving) {
      const point = rounded({
        x: body.point.x + delta.x * fraction,
        y: body.point.y + delta.y * fraction,
        z: body.point.z + delta.z * fraction,
      });
      this.controller.state.anchors[body.key].spatial = point;
      this.space.set({ key: body.key, point, radius: body.radius });
    }
    this.undo.push(changes);
    this.undo = this.undo.slice(-32);
    this.controller.state.anchors[key].pinned = pinned;
    this.layoutRevision++;
    this.notice =
      fraction < 0.99999
        ? "Movement stopped with a clear gap from neighboring bodies."
        : "";
    this.dirty();
    await this.controller.persist();
    return this.controller.state.anchors[key].spatial!;
  }
  async undoPosition() {
    const changes = this.undo.at(-1);
    if (!changes) return;
    const targets = new Map(
      changes
        .filter((u) => this.controller.nodes.has(u.key))
        .map((u) => [u.key, u.position]),
    );
    if (!this.clearPlan(targets)) {
      this.controller.error =
        "The previous position is now occupied. Move the newer body first.";
      this.dirty();
      return;
    }
    this.undo.pop();
    this.layoutRevision++;
    for (const u of changes)
      if (this.controller.nodes.has(u.key)) {
        Object.assign(this.controller.state.anchors[u.key], {
          spatial: u.position,
          pinned: u.pinned,
        });
        this.space.set({
          key: u.key,
          point: u.position,
          radius: this.radius(u.key),
        });
      }
    this.dirty();
    await this.controller.persist();
  }
  previewLayout(strategy: "radial" | "hierarchical") {
    this.layoutRevision++;
    this.preview.clear();
    let nodes = this.candidateNodes();
    if (this.controller.location.kind === "universe") {
      const keys = new Set(
        nodes
          .filter((n) => !this.controller.state.anchors[n.key]?.pinned)
          .flatMap((n) => this.cluster(n.key).map((b) => b.key)),
      );
      nodes = [...this.controller.nodes.values()].filter(
        (n) => keys.has(n.key) || this.controller.state.anchors[n.key]?.pinned,
      );
    }
    const center = this.defaultCamera().target,
      groups = new Map<string, Node[]>();
    for (const n of nodes) {
      const key = n.parent ?? "universe";
      const list = groups.get(key) ?? [];
      list.push(n);
      groups.set(key, list);
    }
    const movable = new Set(
        nodes
          .filter(
            (n) =>
              !this.controller.state.anchors[n.key]?.pinned &&
              (n.kind !== "project" ||
                this.controller.location.kind === "universe"),
          )
          .map((n) => n.key),
      ),
      test = new BodySpace();
    for (const entry of this.space.bodies.values())
      if (!movable.has(entry.key)) test.set(entry);
    for (const [parent, group] of groups)
      for (const [i, n] of group.entries()) {
        if (
          this.controller.state.anchors[n.key]?.pinned ||
          (n.kind === "project" && this.controller.location.kind !== "universe")
        )
          continue;
        const p = parent === "universe" ? center : this.position(parent),
          a =
            (i * Math.PI * 2) / group.length +
            hash("arrange-angle:" + n.key) * 0.35,
          radius = this.radius(n.key),
          parentRadius = parent === "universe" ? 0 : this.radius(parent),
          r =
            parentRadius +
            radius +
            BODY_GAP +
            100 +
            hash("arrange-distance:" + n.key) * 240 +
            Math.cbrt(i + 1) * (radius * 2 + BODY_GAP),
          spacing = radius * 2 + BODY_GAP + 100;
        const point = test.find(
          n.key,
          strategy === "radial"
            ? {
                x: p.x + Math.cos(a) * r,
                y: p.y + Math.sin(a * 2) * 80,
                z: p.z + Math.sin(a) * r,
              }
            : {
                x: p.x + ((i % 5) - 2) * spacing,
                y: p.y - Math.floor(i / 5) * spacing * 0.4,
                z:
                  p.z +
                  parentRadius +
                  radius +
                  BODY_GAP +
                  100 +
                  Math.floor(i / 5) * spacing * 1.3 +
                  hash("arrange-depth:" + n.key) * 130,
              },
          radius,
        );
        this.preview.set(n.key, point);
        test.set({ key: n.key, point, radius });
      }
    this.dirty();
    return this.preview.size;
  }
  cancelLayout() {
    if (this.preview.size) this.layoutRevision++;
    this.preview.clear();
    this.dirty();
  }
  previewMove(key: string, position: Vector3) {
    if (!validVector(position) || !this.controller.nodes.has(key)) return;
    this.preview.clear();
    this.layoutRevision++;
    const moving = this.cluster(key),
      a = moving[0].point,
      delta = { x: position.x - a.x, y: position.y - a.y, z: position.z - a.z },
      fraction = this.space.fraction(moving, delta);
    for (const body of moving)
      this.preview.set(
        body.key,
        rounded({
          x: body.point.x + delta.x * fraction,
          y: body.point.y + delta.y * fraction,
          z: body.point.z + delta.z * fraction,
        }),
      );
    this.notice =
      fraction < 0.99999
        ? "Movement stopped with a clear gap from neighboring bodies."
        : "";
    this.dirty();
    return this.preview.get(key);
  }
  async applyLayout() {
    if (!this.clearPlan(this.preview)) {
      this.controller.error =
        "The layout changed during preview. Preview the arrangement again.";
      this.dirty();
      throw Error(this.controller.error);
    }
    const changes = [];
    this.layoutRevision++;
    for (const [key, p] of this.preview)
      if (
        this.controller.nodes.has(key) &&
        !this.controller.state.anchors[key]?.pinned
      ) {
        const a = this.controller.state.anchors[key];
        changes.push({
          key,
          position: { ...a.spatial! },
          pinned: a.pinned === true,
        });
        a.spatial = p;
        this.space.set({ key, point: p, radius: this.radius(key) });
      }
    if (changes.length) {
      this.undo.push(changes);
      this.undo = this.undo.slice(-32);
    }
    this.preview.clear();
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
      (n) =>
        n.key === p ||
        n.parent === p ||
        workspaces.has(n.parent ?? "") ||
        (n.workspaceId !== undefined &&
          workspaces.has(keyOf("workspace", n.workspaceId))),
    );
    if (this.neighborhood) {
      all = [...c.nodes.values()];
      const focus = c.nodes.get(this.neighborhood),
        ids = new Set(focus ? [focus.id] : []);
      for (const e of edges(c))
        if (e.sourceId === focus?.id || e.targetId === focus?.id) {
          ids.add(e.sourceId);
          ids.add(e.targetId);
        }
      const related = all.filter((n) => n.kind === "resource" && ids.has(n.id)),
        parents = new Set(related.map((n) => n.parent));
      for (const parent of [...parents]) {
        let p = parent ? c.nodes.get(parent)?.parent : null;
        while (p && !parents.has(p)) {
          parents.add(p);
          p = c.nodes.get(p)?.parent;
        }
      }
      all = all.filter((n) =>
        n.kind === "resource" ? ids.has(n.id) : parents.has(n.key),
      );
    }
    return all;
  }
  dispose() {
    this.controller.motion.bodies.delete(this.id);
  }
}
