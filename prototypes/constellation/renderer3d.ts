import * as THREE from "three";
import type { ConstellationController } from "./controller.ts";
import { edges, hash, type SpatialEdge, SpatialNavigator } from "./spatial.ts";
import type {
  SpatialRenderFrame,
  SpatialRenderLayer,
  Vector3,
} from "./spatial-types.ts";
import type { Node } from "./types.ts";
import {
  createPlanet,
  createPlanetInstances,
  planetAppearance,
  setPlanetInstance,
} from "./planets.ts";
import { BODY_MAX_SCALE } from "./body-metrics.ts";

export type ProjectedNode = {
  node: Node;
  x: number;
  y: number;
  depth: number;
  radius: number;
  anchorX: number;
  anchorY: number;
  bodyVisible: boolean;
};
/** Field-local CSS-pixel bounds occupied by real foreground controls. */
export type LabelExclusion = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};
/** Bounded, procedural 3D presentation. No renderer/context/RAF/data store ownership. */
export class ConstellationScene implements SpatialRenderLayer {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(43, 1, 1, 180000);
  readonly objects = new Map<string, THREE.Group>();
  private primitives = {
    low: new THREE.SphereGeometry(1, 16, 10),
    distant: new THREE.SphereGeometry(1, 8, 6),
    medium: new THREE.SphereGeometry(1, 28, 18),
    high: new THREE.SphereGeometry(1, 48, 32),
    ring: new THREE.RingGeometry(0.63, 1, 72),
    spike: new THREE.ConeGeometry(1, 1, 6),
  };
  private materials = new Set<THREE.Material>();
  private links = new THREE.Group();
  private lineObjects: THREE.Line[] = [];
  private raycaster = new THREE.Raycaster();
  private candidates: Node[] = [];
  private shown: Node[] = [];
  private labelNodes: Node[] = [];
  private visibleKeys = new Set<string>();
  private distant?: ReturnType<typeof createPlanetInstances>;
  private distantKeys: string[] = [];
  private distantKey = "";
  private distantIndex = new Map<string, number>();
  private instanceHidden = new Set<string>();
  private distantPicker?: THREE.Mesh;
  private appearances = new Map<
    string,
    { identity: string; appearance: ReturnType<typeof planetAppearance> }
  >();
  private dataNodes: Map<string, Node> | null = null;
  private edgeData: SpatialEdge[] = [];
  private candidateScope = "";
  private orderKey = "";
  private orderTarget?: Vector3;
  private orderedBodies: { n: Node; point: Vector3; radius: number }[] = [];
  private resourceKeys = new Map<string, string[]>();
  private relatedKeys = new Set<string>();
  private linkKey = "";
  private lost = false;
  private disposed = false;
  private preparedKey = "";
  private labelOffsets = new Map<string, { x: number; y: number }>();
  selectedEdge: string | null = null;
  enabled = true;
  diagnostics = {
    drawCalls: 0,
    triangles: 0,
    nodes: 0,
    edges: 0,
    culled: 0,
    cpuSubmitMs: 0,
    overlapCulled: 0,
    detailedBodies: 0,
    instancedBodies: 0,
    instanceDrawCount: 0,
    projectedBodies: [] as {
      key: string;
      x: number;
      y: number;
      radius: number;
      world: Vector3;
      worldRadius: number;
    }[],
    meaning:
      "Last active Constellation pass: CPU submission and geometry counts; not presented FPS or GPU timing",
  };
  readonly controller: ConstellationController;
  readonly navigation: SpatialNavigator;
  private bounds: () => DOMRect;
  private wake: () => void;
  private exclusions: () => readonly LabelExclusion[];
  constructor(
    controller: ConstellationController,
    navigation: SpatialNavigator,
    bounds: () => DOMRect,
    wake: () => void = () => {},
    exclusions: () => readonly LabelExclusion[] = () => [],
  ) {
    this.controller = controller;
    this.navigation = navigation;
    this.bounds = bounds;
    this.wake = wake;
    this.exclusions = exclusions;
    const rect = bounds();
    navigation.setViewport(rect.width, rect.height);
    this.scene.add(this.links);
    this.raycaster.params.Line = { threshold: 12 };
  }
  get active() {
    return (
      this.enabled &&
      !this.disposed &&
      !this.lost &&
      !this.controller.policy.hidden &&
      this.controller.policy.graphicsAvailable &&
      ["project", "universe"].includes(this.controller.location.kind)
    );
  }
  private create(n: Node) {
    const root = createPlanet(n.id, n.kind, this.primitives);
    root.userData.key = n.key;
    root.traverse((o) => {
      o.userData.key = n.key;
      if (o instanceof THREE.Mesh)
        for (const m of Array.isArray(o.material) ? o.material : [o.material])
          this.materials.add(m);
    });
    return root;
  }
  private release(root: THREE.Group) {
    this.controller.motion.bodies.delete(
      this.controller.motionId + ":body:" + root.userData.key,
    );
    const used = new Set<THREE.Material>();
    root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        for (const m of Array.isArray(o.material) ? o.material : [o.material])
          used.add(m);
      }
    });
    for (const m of used) {
      m.dispose();
      this.materials.delete(m);
    }
    root.removeFromParent();
  }
  private configure(width: number, height: number) {
    this.navigation.setViewport(width, height);
    const p = this.navigation.camera,
      d = p.distance,
      cp = Math.cos(p.pitch);
    this.camera.aspect = Math.max(0.01, width / Math.max(1, height));
    this.camera.position.set(
      p.target.x + Math.sin(p.yaw) * cp * d,
      p.target.y + Math.sin(p.pitch) * d,
      p.target.z + Math.cos(p.yaw) * cp * d,
    );
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(p.target.x, p.target.y, p.target.z);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }
  project(key: string, width: number, height: number) {
    this.configure(width, height);
    return this.projectPrepared(key, width, height);
  }
  private projectPrepared(key: string, width: number, height: number) {
    const p = this.navigation.position(key),
      v = new THREE.Vector3(p.x, p.y, p.z).project(this.camera);
    return {
      x: (v.x * 0.5 + 0.5) * width,
      y: (-0.5 * v.y + 0.5) * height,
      depth: v.z,
    };
  }
  update(width: number, height: number) {
    this.configure(width, height);
    const pose = this.navigation.camera;
    const positionKey = [...this.objects.keys()]
      .map((key) => {
        if (!this.controller.nodes.has(key)) return "removed:" + key;
        const p = this.navigation.position(key);
        const scale =
          this.controller.motion.bodies.get(
            this.controller.motionId + ":body:" + key,
          )?.channels.x.value ?? 1;
        return `${p.x},${p.y},${p.z},${scale}`;
      })
      .join(";");
    const preparedKey = JSON.stringify([
      width,
      height,
      pose,
      this.controller.location,
      this.controller.selected,
      this.selectedEdge,
      this.controller.policy.tier,
      positionKey,
      this.navigation.layoutRevision,
    ]);
    if (
      this.dataNodes === this.controller.nodes &&
      preparedKey === this.preparedKey
    )
      return;
    this.preparedKey = preparedKey;
    if (this.dataNodes !== this.controller.nodes) {
      this.dataNodes = this.controller.nodes;
      this.edgeData = edges(this.controller);
      this.resourceKeys.clear();
      for (const n of this.controller.nodes.values())
        if (n.kind === "resource") {
          const keys = this.resourceKeys.get(n.id) ?? [];
          keys.push(n.key);
          this.resourceKeys.set(n.id, keys);
        }
      this.candidateScope = "";
      this.orderKey = "";
      this.orderTarget = undefined;
      this.linkKey = "";
      this.distantKey = "";
      for (const key of this.appearances.keys())
        if (!this.controller.nodes.has(key)) this.appearances.delete(key);
    }
    const scope = JSON.stringify([
      this.controller.location,
      this.navigation.neighborhood,
    ]);
    if (this.candidateScope !== scope) {
      this.candidateScope = scope;
      this.candidates = this.navigation.candidateNodes();
      this.relatedKeys = new Set(
        this.navigation.relatedNodes().map((n) => n.key),
      );
      this.orderKey = "";
      this.orderTarget = undefined;
    }
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(
        this.camera.projectionMatrix,
        this.camera.matrixWorldInverse,
      ),
    );
    const max =
      this.controller.policy.tier === "efficient"
        ? 70
        : this.controller.policy.tier === "balanced"
          ? 160
          : 280;
    const target = this.navigation.camera.target;
    // Detail priority uses a stable local center. Panning within this radius
    // cannot repeatedly sort a dense project or swap neighboring detail levels.
    if (
      !this.orderTarget ||
      Math.hypot(
        target.x - this.orderTarget.x,
        target.y - this.orderTarget.y,
        target.z - this.orderTarget.z,
      ) > 512
    )
      this.orderTarget = { ...target };
    const sortTarget = this.orderTarget;
    // Orbiting changes the frustum, not distance-to-target ordering. Cache that
    // metadata sort so even a 10k-resource project avoids sorting every frame.
    const orderKey = JSON.stringify([
      sortTarget.x,
      sortTarget.y,
      sortTarget.z,
      this.controller.selected,
      this.navigation.layoutRevision,
    ]);
    if (orderKey !== this.orderKey) {
      this.orderKey = orderKey;
      this.orderedBodies = this.candidates
        .map((n) => {
          const p = this.navigation.position(n.key);
          return {
            n,
            point: p,
            radius: this.navigation.radius(n.key),
            priority:
              n.key === this.controller.selected
                ? -1
                : this.relatedKeys.has(n.key) && n.kind === "resource"
                  ? 0
                  : n.kind === "project"
                    ? 1
                    : n.kind === "workspace"
                      ? 2
                      : 3,
            distance:
              (p.x - sortTarget.x) ** 2 +
              (p.y - sortTarget.y) ** 2 +
              (p.z - sortTarget.z) ** 2,
          };
        })
        .sort((a, b) => a.priority - b.priority || a.distance - b.distance);
    }
    const sphere = new THREE.Sphere();
    // Physical envelopes stay separated in world space. Camera alignment is
    // normal depth occlusion, never a reason to erase an on-screen body.
    const discs: typeof this.diagnostics.projectedBodies = [],
      focal = height / (2 * Math.tan((43 * Math.PI) / 360)),
      viewMatrix = this.camera.matrixWorldInverse.elements;
    this.shown = [];
    this.diagnostics.overlapCulled = 0;
    for (const { n, point: p, radius: worldRadius } of this.orderedBodies) {
      sphere.center.set(p.x, p.y, p.z);
      sphere.radius = worldRadius;
      if (!frustum.intersectsSphere(sphere)) continue;
      this.shown.push(n);
      const vx =
          viewMatrix[0] * p.x +
          viewMatrix[4] * p.y +
          viewMatrix[8] * p.z +
          viewMatrix[12],
        vy =
          viewMatrix[1] * p.x +
          viewMatrix[5] * p.y +
          viewMatrix[9] * p.z +
          viewMatrix[13],
        vz =
          viewMatrix[2] * p.x +
          viewMatrix[6] * p.y +
          viewMatrix[10] * p.z +
          viewMatrix[14],
        depth = Math.max(1, -vz),
        // Perspective also stretches the silhouette away from the optical axis.
        // This bound contains the entire projected sphere, including tilted rings.
        radius =
          (focal *
            worldRadius *
            Math.sqrt(1 + (vx ** 2 + vy ** 2) / depth ** 2)) /
          Math.max(1, depth - worldRadius);
      discs.push({
        key: n.key,
        x: width / 2 + (focal * vx) / (-vz || 1e-8),
        y: height / 2 - (focal * vy) / (-vz || 1e-8),
        radius,
        world: { ...p },
        worldRadius,
      });
    }
    this.diagnostics.projectedBodies = discs;
    this.visibleKeys = new Set(this.shown.map((n) => n.key));
    this.labelNodes = this.shown;
    const detailed = this.shown.filter(
        (n, i) => n.kind === "project" || i < max,
      ),
      detailedKeys = new Set(detailed.map((n) => n.key));
    this.updateDistant();
    this.detailInstances(detailedKeys);
    for (const [key, root] of this.objects)
      if (!detailedKeys.has(key)) {
        this.release(root);
        this.objects.delete(key);
      }
    for (const n of detailed) {
      let root = this.objects.get(n.key);
      if (!root) {
        root = this.create(n);
        this.objects.set(n.key, root);
        this.scene.add(root);
        const id = this.controller.motionId + ":body:" + n.key;
        this.controller.motion.add(id, {
          x: 1,
          y: 0,
          w: 0,
          h: 0,
          lift: 0,
          yaw: 0,
          opacity: 1,
        });
      }
      const p = this.navigation.position(n.key);
      root.position.set(p.x, p.y, p.z);
      const motionId = this.controller.motionId + ":body:" + n.key,
        bodyMotion = this.controller.motion.bodies.get(motionId)!,
        targetScale = n.key === this.controller.selected ? 1.08 : 1;
      if (bodyMotion.channels.x.target !== targetScale) {
        this.controller.motion.target(
          motionId,
          { x: targetScale, y: 0, w: 0, h: 0, lift: 0, yaw: 0, opacity: 1 },
          "spatial body emphasis",
        );
        this.wake();
      }
      if (
        this.controller.policy.reduced ||
        this.controller.policy.quiet ||
        this.controller.policy.hidden
      )
        this.controller.motion.snap(motionId);
      root.scale.setScalar(
        Math.min(BODY_MAX_SCALE, this.controller.motion.pose(motionId).x),
      );
      const body = root.userData.body as THREE.Mesh<
          THREE.BufferGeometry,
          THREE.ShaderMaterial
        >,
        radius = root.userData.appearance.radius as number,
        distance = this.camera.position.distanceTo(root.position),
        pixels =
          (radius * height) /
          (2 * Math.tan((43 * Math.PI) / 360) * Math.max(1, distance));
      const level =
        pixels > 75 && this.controller.policy.tier !== "efficient"
          ? this.primitives.high
          : pixels > 20
            ? this.primitives.medium
            : this.primitives.low;
      body.geometry = level;
      body.material.uniforms.uDetail.value = Math.max(
        0,
        Math.min(1, (pixels - 5) / 24),
      );
      const air = root.getObjectByName("atmosphere") as THREE.Mesh | undefined;
      if (air) air.geometry = level;
      const ring = root.getObjectByName("planet-ring") as
        | THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
        | undefined;
      if (ring)
        ring.material.uniforms.uDetail.value = Math.max(
          0,
          Math.min(1, (pixels - 9) / 30),
        );
      root.rotation.y =
        this.controller.state.anchors[n.key]?.rotation ?? hash(n.id) * Math.PI;
    }
    const visibleEdges = this.visibleEdges(),
      edgeKey = JSON.stringify([
        this.navigation.layoutRevision,
        this.controller.selected,
        this.selectedEdge,
        visibleEdges.map(({ edge, a, b }) => [edge.id, a.key, b.key]),
      ]);
    if (edgeKey !== this.linkKey) {
      this.linkKey = edgeKey;
      this.rebuildLinks(visibleEdges);
    }
    this.scene.updateMatrixWorld(true);
    this.diagnostics.nodes = this.shown.length;
    this.diagnostics.detailedBodies = detailed.length;
    this.diagnostics.instancedBodies = this.shown.length - detailed.length;
    this.diagnostics.instanceDrawCount = this.distantKeys.length;
    this.diagnostics.culled = this.candidates.length - this.shown.length;
  }
  private updateDistant() {
    // Camera movement never rewrites positions, geology or colors. Off-screen
    // low-detail instances are clipped by the GPU; only detailed counterparts
    // are suppressed, through a small visibility attribute.
    const key = JSON.stringify([
      this.candidateScope,
      this.navigation.layoutRevision,
    ]);
    if (key === this.distantKey) return;
    this.distantKey = key;
    const nodes = this.candidates.filter((n) => n.kind !== "project");
    this.distantKeys = nodes.map((n) => n.key);
    this.distantIndex = new Map(this.distantKeys.map((key, i) => [key, i]));
    this.instanceHidden.clear();
    if (!nodes.length) {
      if (this.distant) this.distant.count = 0;
      return;
    }
    if (!this.distant || this.distant.instanceMatrix.count < nodes.length) {
      this.releaseDistant();
      this.distant = createPlanetInstances(
        this.candidates.length,
        this.primitives.distant,
      );
      this.scene.add(this.distant);
    }
    const transform = new THREE.Object3D();
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i],
        p = this.navigation.position(n.key);
      const identity = n.kind + ":" + n.id,
        cached = this.appearances.get(n.key);
      let appearance =
        cached?.identity === identity ? cached.appearance : undefined;
      if (!appearance) {
        appearance = planetAppearance(n.id, n.kind);
        this.appearances.set(n.key, { identity, appearance });
      }
      transform.position.set(p.x, p.y, p.z);
      transform.rotation.set(
        0,
        this.controller.state.anchors[n.key]?.rotation ?? hash(n.id) * Math.PI,
        (appearance.seeds[1] - 0.5) * 0.8,
      );
      transform.scale.setScalar(appearance.radius);
      transform.updateMatrix();
      setPlanetInstance(this.distant, i, appearance, transform.matrix);
    }
    this.distant.count = nodes.length;
    this.distant.instanceMatrix.needsUpdate = true;
    for (const name of ["aSeed", "aLow", "aMid", "aHigh", "aType", "aVisible"])
      (
        this.distant.geometry.getAttribute(
          name,
        ) as THREE.InstancedBufferAttribute
      ).needsUpdate = true;
    this.distant.computeBoundingSphere();
  }
  private detailInstances(detailedKeys: Set<string>) {
    if (!this.distant) return;
    const visibility = this.distant.geometry.getAttribute(
      "aVisible",
    ) as THREE.InstancedBufferAttribute;
    let changed = false;
    for (const key of this.instanceHidden)
      if (!detailedKeys.has(key)) {
        visibility.setX(this.distantIndex.get(key)!, 1);
        changed = true;
      }
    const hidden = new Set<string>();
    for (const key of detailedKeys) {
      const index = this.distantIndex.get(key);
      if (index === undefined) continue;
      hidden.add(key);
      if (!this.instanceHidden.has(key)) {
        visibility.setX(index, 0);
        changed = true;
      }
    }
    this.instanceHidden = hidden;
    this.distant.visible = hidden.size < this.distantKeys.length;
    if (changed) visibility.needsUpdate = true;
  }
  private releaseDistant() {
    if (!this.distant) return;
    this.distant.removeFromParent();
    this.distant.geometry.dispose();
    this.distant.material.dispose();
    this.distant.dispose();
    this.distant = undefined;
    this.distantPicker = undefined;
  }
  private visibleEdges() {
    const result: { edge: SpatialEdge; a: Node; b: Node }[] = [],
      selected = this.controller.nodes.get(this.controller.selected ?? "");
    const resolve = (key: string | undefined, id: string) => {
      const visible =
        key ??
        this.resourceKeys.get(id)?.find((key) => this.visibleKeys.has(key));
      return visible && this.visibleKeys.has(visible)
        ? this.controller.nodes.get(visible)
        : undefined;
    };
    for (const edge of this.edgeData) {
      const a = resolve(edge.sourceKey, edge.sourceId),
        b = resolve(edge.targetKey, edge.targetId);
      if (!a || !b) continue;
      if (
        selected?.kind === "resource" &&
        selected.id !== a.id &&
        selected.id !== b.id &&
        edge.id !== this.selectedEdge
      )
        continue;
      result.push({ edge, a, b });
      if (result.length >= 40) break;
    }
    return result;
  }
  private rebuildLinks(all: { edge: SpatialEdge; a: Node; b: Node }[]) {
    for (const child of [...this.links.children]) {
      if (child instanceof THREE.Line) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      } else if (child instanceof THREE.Mesh) {
        (child.material as THREE.Material).dispose();
      }
      child.removeFromParent();
    }
    this.lineObjects = [];
    for (const { edge, a, b } of all) {
      const pa = this.navigation.position(a.key),
        pb = this.navigation.position(b.key),
        start = new THREE.Vector3(pa.x, pa.y, pa.z),
        end = new THREE.Vector3(pb.x, pb.y, pb.z),
        middle = start.clone().lerp(end, 0.5);
      middle.y += Math.min(150, start.distanceTo(end) * 0.16) + 40;
      const curve = new THREE.QuadraticBezierCurve3(start, middle, end),
        geometry = new THREE.BufferGeometry().setFromPoints(
          curve.getPoints(32),
        ),
        color =
          edge.id === this.selectedEdge
            ? 0xf0d9ff
            : edge.provenance === "inferred"
              ? 0x9e8aa6
              : edge.kind.includes("continuation") ||
                  edge.kind.includes("branch")
                ? 0xbaa0e0
                : 0x9189b8;
      const material =
        edge.provenance === "inferred"
          ? new THREE.LineDashedMaterial({
              color,
              dashSize: 12,
              gapSize: 10,
              transparent: true,
              opacity: 0.7,
            })
          : new THREE.LineBasicMaterial({
              color,
              transparent: true,
              opacity: edge.id.startsWith("membership:") ? 0.17 : 0.75,
            });
      const line = new THREE.Line(geometry, material);
      line.computeLineDistances();
      line.userData.edge = edge.id;
      this.links.add(line);
      this.lineObjects.push(line);
      const point = curve.getPoint(0.83),
        tangent = curve.getTangent(0.83).normalize(),
        arrow = new THREE.Mesh(
          this.primitives.spike,
          new THREE.MeshBasicMaterial({ color }),
        );
      arrow.position.copy(point);
      arrow.scale.set(6, 17, 6);
      arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
      this.links.add(arrow);
    }
    this.diagnostics.edges = all.length;
  }
  labels(width: number, height: number) {
    this.update(width, height);
    const accepted: ProjectedNode[] = [];
    const max = this.controller.policy.tier === "efficient" ? 16 : 30;
    const blocked = this.exclusions(),
      halfWidth = 95,
      halfHeight = 34;
    const free = (x: number, y: number, selected: boolean) =>
      !(x > width * 0.66 && y < height * 0.5 && !selected) &&
      !accepted.some(
        (a) =>
          Math.abs(a.x - x) < halfWidth * 2 &&
          Math.abs(a.y - y) < halfHeight * 2,
      ) &&
      !blocked.some(
        (r) =>
          x + halfWidth + 8 > r.left &&
          x - halfWidth - 8 < r.right &&
          y + halfHeight + 8 > r.top &&
          y - halfHeight - 8 < r.bottom,
      );
    for (const n of this.labelNodes) {
      const p = this.projectPrepared(n.key, width, height);
      if (p.depth < -1 || p.depth > 1) continue;
      const essential =
        n.kind !== "resource" ||
        n.key === this.controller.selected ||
        this.relatedKeys.has(n.key);
      if (
        n.kind === "resource" &&
        this.navigation.camera.distance > 2400 &&
        !this.relatedKeys.has(n.key) &&
        n.key !== this.controller.selected
      )
        continue;
      if (
        !essential &&
        (p.x < 50 || p.x > width - 50 || p.y < 30 || p.y > height - 40)
      )
        continue;
      const below =
        n.kind === "project" ? 70 : n.kind === "workspace" ? 42 : 25;
      const previous = this.labelOffsets.get(n.key);
      const choices = [
        ...(previous ? [previous] : []),
        { x: 0, y: below },
        { x: -180, y: below },
        { x: 180, y: below },
        { x: 0, y: below + 60 },
        { x: 0, y: -65 },
        { x: -180, y: below + 60 },
        { x: 180, y: below + 60 },
        { x: -360, y: below },
        { x: 360, y: below },
      ];
      let placed = false;
      for (const offset of choices) {
        const x = Math.max(
            halfWidth,
            Math.min(width - halfWidth, p.x + offset.x),
          ),
          y = Math.max(
            halfHeight,
            Math.min(height - halfHeight, p.y + offset.y),
          );
        if (
          width < halfWidth * 2 ||
          height < halfHeight * 2 ||
          !free(x, y, n.key === this.controller.selected)
        )
          continue;
        accepted.push({
          node: n,
          x,
          y,
          anchorX: p.x,
          anchorY: p.y,
          bodyVisible: this.visibleKeys.has(n.key),
          depth: p.depth,
          radius: n.kind === "project" ? 90 : n.kind === "workspace" ? 55 : 25,
        });
        this.labelOffsets.set(n.key, { x: x - p.x, y: y - p.y });
        placed = true;
        break;
      }
      if (!placed && essential) {
        const slots = (size: number, half: number, edges: number[]) =>
          [
            ...new Set([
              ...Array.from(
                { length: Math.max(0, Math.floor(size / (half * 2))) },
                (_, i) => half + i * half * 2,
              ),
              size - half,
              ...edges,
            ]),
          ]
            .filter((v) => v >= half && v <= size - half)
            .sort((a, b) => a - b);
        const xs = slots(
            width,
            halfWidth,
            blocked.flatMap((r) => [
              r.left - halfWidth - 8,
              r.right + halfWidth + 8,
            ]),
          ),
          ys = slots(
            height,
            halfHeight,
            blocked.flatMap((r) => [
              r.top - halfHeight - 8,
              r.bottom + halfHeight + 8,
            ]),
          );
        scan: for (const y of ys)
          for (const x of xs) {
            if (free(x, y, n.key === this.controller.selected)) {
              accepted.push({
                node: n,
                x,
                y,
                anchorX: p.x,
                anchorY: p.y,
                bodyVisible: this.visibleKeys.has(n.key),
                depth: p.depth,
                radius: 30,
              });
              this.labelOffsets.set(n.key, { x: x - p.x, y: y - p.y });
              placed = true;
              break scan;
            }
          }
      }
      if (accepted.length >= max) break;
    }
    return accepted;
  }
  pick(
    x: number,
    y: number,
    width: number,
    height: number,
  ): { key?: string; edge?: string } | null {
    this.update(width, height);
    this.raycaster.setFromCamera(
      new THREE.Vector2((x / width) * 2 - 1, (-y / height) * 2 + 1),
      this.camera,
    );
    // Screen bounds contain the entire body. Only ray-test nearby geometry,
    // rather than walking every instance on each inward wheel event.
    const hits: { distance: number; key: string }[] = [];
    for (const disc of this.diagnostics.projectedBodies) {
      if ((disc.x - x) ** 2 + (disc.y - y) ** 2 > disc.radius ** 2) continue;
      const root = this.objects.get(disc.key);
      if (root) {
        for (const hit of this.raycaster.intersectObject(root, true))
          hits.push({ distance: hit.distance, key: disc.key });
      } else if (this.distant) {
        const index = this.distantIndex.get(disc.key);
        if (index === undefined || this.instanceHidden.has(disc.key)) continue;
        this.distantPicker ??= new THREE.Mesh(
          this.distant.geometry,
          this.distant.material,
        );
        this.distant.getMatrixAt(index, this.distantPicker.matrixWorld);
        this.distantPicker.matrixWorld.premultiply(this.distant.matrixWorld);
        for (const hit of this.raycaster.intersectObject(this.distantPicker))
          hits.push({ distance: hit.distance, key: disc.key });
      }
    }
    hits.sort((a, b) => a.distance - b.distance);
    if (hits.length) return { key: hits[0].key };
    const links = this.raycaster.intersectObjects(this.lineObjects);
    return links.length ? { edge: links[0].object.userData.edge } : null;
  }
  dragPosition(
    x: number,
    y: number,
    width: number,
    height: number,
    key: string,
  ): Vector3 | null {
    this.configure(width, height);
    this.raycaster.setFromCamera(
      new THREE.Vector2((x / width) * 2 - 1, (-y / height) * 2 + 1),
      this.camera,
    );
    const n = this.navigation.position(key),
      plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
        this.camera.getWorldDirection(new THREE.Vector3()),
        new THREE.Vector3(n.x, n.y, n.z),
      ),
      p = this.raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    return p ? { x: p.x, y: p.y, z: p.z } : null;
  }
  render(renderer: THREE.WebGLRenderer, frame: SpatialRenderFrame) {
    if (!this.active) return;
    const rect = this.bounds();
    if (rect.width < 1 || rect.height < 1) return;
    const start = performance.now();
    this.update(rect.width, rect.height);
    const viewport = renderer.getViewport(new THREE.Vector4()),
      scissor = renderer.getScissor(new THREE.Vector4()),
      test = renderer.getScissorTest(),
      auto = renderer.autoClear;
    const beforeCalls = renderer.info.autoReset
        ? 0
        : renderer.info.render.calls,
      beforeTriangles = renderer.info.autoReset
        ? 0
        : renderer.info.render.triangles;
    renderer.autoClear = false;
    try {
      renderer.setViewport(
        rect.left,
        frame.height - rect.bottom,
        rect.width,
        rect.height,
      );
      renderer.setScissor(
        rect.left,
        frame.height - rect.bottom,
        rect.width,
        rect.height,
      );
      renderer.setScissorTest(true);
      renderer.clearDepth();
      renderer.render(this.scene, this.camera);
      this.diagnostics.drawCalls = renderer.info.render.calls - beforeCalls;
      this.diagnostics.triangles =
        renderer.info.render.triangles - beforeTriangles;
      this.diagnostics.cpuSubmitMs = performance.now() - start;
    } finally {
      renderer.setViewport(viewport);
      renderer.setScissor(scissor);
      renderer.setScissorTest(test);
      renderer.autoClear = auto;
    }
  }
  contextLost() {
    this.lost = true;
  }
  contextRestored() {
    this.lost = false;
    this.linkKey = "";
  }
  dispose() {
    this.disposed = true;
    for (const root of this.objects.values()) this.release(root);
    this.objects.clear();
    this.releaseDistant();
    this.appearances.clear();
    for (const g of Object.values(this.primitives)) g.dispose();
    for (const o of this.links.children)
      if (o instanceof THREE.Line) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      } else if (o instanceof THREE.Mesh)
        (o.material as THREE.Material).dispose();
    this.links.clear();
  }
}
