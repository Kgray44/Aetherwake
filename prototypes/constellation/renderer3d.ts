import * as THREE from "three";
import type { ConstellationController } from "./controller.ts";
import { edges, hash, type SpatialEdge, SpatialNavigator } from "./spatial.ts";
import type {
  SpatialRenderFrame,
  SpatialRenderLayer,
  Vector3,
} from "./spatial-types.ts";
import type { Node } from "./types.ts";

export type ProjectedNode = {
  node: Node;
  x: number;
  y: number;
  depth: number;
  radius: number;
  anchorX: number;
  anchorY: number;
};
/** Bounded, procedural 3D presentation. No renderer/context/RAF/data store ownership. */
export class ConstellationScene implements SpatialRenderLayer {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(43, 1, 1, 180000);
  readonly objects = new Map<string, THREE.Group>();
  private primitives = {
    torus: new THREE.TorusGeometry(1, 0.028, 6, 72),
    crystal: new THREE.OctahedronGeometry(1, 0),
    globe: new THREE.IcosahedronGeometry(1, 1),
    slab: new THREE.BoxGeometry(1, 1, 1),
    spike: new THREE.ConeGeometry(1, 1, 6),
  };
  private materials = new Set<THREE.Material>();
  private links = new THREE.Group();
  private lineObjects: THREE.Line[] = [];
  private raycaster = new THREE.Raycaster();
  private candidates: Node[] = [];
  private shown: Node[] = [];
  private dataNodes: Map<string, Node> | null = null;
  private resourceKinds = new Map<string, string>();
  private linkKey = "";
  private lost = false;
  private disposed = false;
  private lastPositions = "";
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
    meaning:
      "Last active Constellation pass: CPU submission and geometry counts; not presented FPS or GPU timing",
  };
  readonly controller: ConstellationController;
  readonly navigation: SpatialNavigator;
  private bounds: () => DOMRect;
  constructor(
    controller: ConstellationController,
    navigation: SpatialNavigator,
    bounds: () => DOMRect,
  ) {
    this.controller = controller;
    this.navigation = navigation;
    this.bounds = bounds;
    this.scene.add(new THREE.HemisphereLight(0xc9c0ec, 0x171021, 2.2));
    const key = new THREE.DirectionalLight(0xf2e5ff, 4.4);
    key.position.set(-600, 1000, 800);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x9477db, 3);
    rim.position.set(900, -100, -700);
    this.scene.add(rim);
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
  private material(
    color: THREE.ColorRepresentation,
    emissive = 0x000000,
    wire = false,
  ) {
    const m = new THREE.MeshPhysicalMaterial({
      color,
      metalness: 0.68,
      roughness: 0.25,
      clearcoat: 0.8,
      clearcoatRoughness: 0.22,
      emissive,
      emissiveIntensity: 0.45,
      iridescence: 0.3,
      iridescenceIOR: 1.3,
      wireframe: wire,
    });
    this.materials.add(m);
    return m;
  }
  private add(
    root: THREE.Group,
    shape: keyof ConstellationScene["primitives"],
    m: THREE.Material,
    scale: Vector3,
    position: Vector3 = { x: 0, y: 0, z: 0 },
  ) {
    const mesh = new THREE.Mesh(this.primitives[shape], m);
    mesh.scale.set(scale.x, scale.y, scale.z);
    mesh.position.set(position.x, position.y, position.z);
    root.add(mesh);
    return mesh;
  }
  private create(n: Node) {
    const root = new THREE.Group(),
      h = hash(n.id),
      color = new THREE.Color().setHSL(0.72 + h * 0.065, 0.25, 0.45);
    const body = this.material(color, 0x261834),
      light = this.material(0xd9c6f1, 0x70508c),
      dark = this.material(0x171221, 0x0c0716);
    root.userData.key = n.key;
    if (n.kind === "project") {
      const variant = Math.floor(h * 3);
      const core = this.add(root, variant === 1 ? "globe" : "crystal", body, {
        x: 90,
        y: variant === 2 ? 155 : 110,
        z: 90,
      });
      core.rotation.z = 0.3;
      this.add(root, "crystal", light, { x: 25, y: 85, z: 25 });
      for (let i = 0; i < 3; i++) {
        const ring = this.add(root, "torus", i === 1 ? body : light, {
          x: 170 + i * 33,
          y: 170 + i * 33,
          z: 170 + i * 33,
        });
        ring.rotation.x = 0.5 + i * 0.72;
        ring.rotation.z = h * 2 + i * 0.48;
      }
      for (let i = 0; i < (variant === 0 ? 7 : 4); i++) {
        const a = (i * Math.PI * 2) / (variant === 0 ? 7 : 4),
          spike = this.add(
            root,
            "slab",
            dark,
            { x: 12, y: 80 + (i % 2) * 35, z: 22 },
            {
              x: Math.cos(a) * 125,
              y: ((i % 2) - 0.5) * 80,
              z: Math.sin(a) * 125,
            },
          );
        spike.lookAt(0, 0, 0);
      }
    } else if (n.kind === "workspace") {
      const ring = this.add(root, "torus", light, { x: 80, y: 80, z: 80 });
      ring.rotation.x = Math.PI * 0.62;
      this.add(root, "crystal", body, { x: 38, y: 60, z: 38 });
      for (let i = 0; i < 3; i++) {
        const slab = this.add(
          root,
          "slab",
          dark,
          { x: 90 - i * 15, y: 6, z: 50 - i * 5 },
          { x: 0, y: (i - 1) * 22, z: 0 },
        );
        slab.rotation.y = 0.35;
      }
    } else {
      const kind = this.resourceKinds.get(n.id) ?? "reference";
      if (kind === "conversation") {
        this.add(root, "slab", body, { x: 45, y: 30, z: 11 });
        this.add(
          root,
          "slab",
          light,
          { x: 33, y: 3, z: 13 },
          { x: 0, y: 8, z: 3 },
        );
        this.add(
          root,
          "spike",
          body,
          { x: 10, y: 17, z: 9 },
          { x: -13, y: -20, z: 0 },
        );
      } else if (kind === "task") {
        this.add(root, "crystal", body, { x: 27, y: 36, z: 27 });
        const ring = this.add(root, "torus", light, { x: 37, y: 37, z: 37 });
        ring.rotation.x = Math.PI / 2;
      } else if (kind === "note" || kind === "research") {
        for (let i = 0; i < 3; i++) {
          const slab = this.add(
            root,
            "slab",
            i === 2 ? light : body,
            { x: 37, y: 3, z: 48 },
            { x: 0, y: i * 8, z: i * 3 },
          );
          slab.rotation.y = 0.18 * i;
        }
      } else if (kind === "agent" || kind === "execution") {
        this.add(root, "globe", body, { x: 25, y: 25, z: 25 });
        this.add(root, "torus", light, { x: 38, y: 38, z: 38 });
      } else this.add(root, "crystal", body, { x: 26, y: 30, z: 26 });
    }
    root.traverse((o) => {
      o.userData.key = n.key;
    });
    root.rotation.y = h * Math.PI;
    return root;
  }
  private release(root: THREE.Group) {
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
        return `${p.x},${p.y},${p.z}`;
      })
      .join(";");
    const preparedKey = JSON.stringify([
      width,
      height,
      pose,
      this.controller.selected,
      this.selectedEdge,
      this.controller.policy.tier,
      positionKey,
    ]);
    if (
      this.dataNodes === this.controller.nodes &&
      preparedKey === this.preparedKey
    )
      return;
    this.preparedKey = preparedKey;
    if (this.dataNodes !== this.controller.nodes) {
      this.dataNodes = this.controller.nodes;
      this.resourceKinds = new Map(
        this.controller.snapshot.resources.map((r) => [r.id, r.kind]),
      );
      this.linkKey = "";
    }
    this.candidates = this.navigation.candidateNodes();
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
    this.shown = this.candidates
      .filter((n) => {
        const p = this.navigation.position(n.key);
        return frustum.intersectsSphere(
          new THREE.Sphere(
            new THREE.Vector3(p.x, p.y, p.z),
            n.kind === "project" ? 260 : n.kind === "workspace" ? 100 : 50,
          ),
        );
      })
      .sort((a, b) =>
        a.key === this.controller.selected
          ? -1
          : b.key === this.controller.selected
            ? 1
            : a.kind !== b.kind
              ? a.kind === "project"
                ? -1
                : b.kind === "project"
                  ? 1
                  : a.kind === "workspace"
                    ? -1
                    : 1
              : Math.hypot(
                  this.navigation.position(a.key).x - target.x,
                  this.navigation.position(a.key).z - target.z,
                ) -
                Math.hypot(
                  this.navigation.position(b.key).x - target.x,
                  this.navigation.position(b.key).z - target.z,
                ),
      )
      .slice(0, max);
    const visible = new Set(this.shown.map((n) => n.key));
    for (const [key, root] of this.objects)
      if (!visible.has(key)) {
        this.release(root);
        this.objects.delete(key);
      }
    for (const n of this.shown) {
      let root = this.objects.get(n.key);
      if (!root) {
        root = this.create(n);
        this.objects.set(n.key, root);
        this.scene.add(root);
      }
      const p = this.navigation.position(n.key);
      root.position.set(p.x, p.y, p.z);
      root.scale.setScalar(n.key === this.controller.selected ? 1.18 : 1);
      root.rotation.y =
        this.controller.state.anchors[n.key]?.rotation ?? hash(n.id) * Math.PI;
    }
    const positions = this.shown
      .map((n) => {
        const p = this.navigation.position(n.key);
        return `${n.key}:${p.x},${p.y},${p.z}`;
      })
      .join("|");
    const edgeData = edges(this.controller),
      edgeKey =
        positions +
        this.controller.selected +
        this.selectedEdge +
        edgeData.map((e) => e.id).join("|");
    if (edgeKey !== this.linkKey) {
      this.linkKey = edgeKey;
      this.rebuildLinks(edgeData);
    }
    this.lastPositions = positions;
    this.scene.updateMatrixWorld(true);
    this.diagnostics.nodes = this.shown.length;
    this.diagnostics.culled = this.candidates.length - this.shown.length;
  }
  private rebuildLinks(all: SpatialEdge[]) {
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
    const byResource = new Map(
      this.shown.filter((n) => n.kind === "resource").map((n) => [n.id, n]),
    );
    const selected = this.controller.nodes.get(this.controller.selected ?? "");
    let count = 0;
    for (const edge of all) {
      const a = edge.sourceKey
          ? this.shown.find((n) => n.key === edge.sourceKey)
          : byResource.get(edge.sourceId),
        b = edge.targetKey
          ? this.shown.find((n) => n.key === edge.targetKey)
          : byResource.get(edge.targetId);
      if (!a || !b) continue;
      if (
        selected?.kind === "resource" &&
        selected.id !== a.id &&
        selected.id !== b.id &&
        edge.id !== this.selectedEdge
      )
        continue;
      if (++count > 40) break;
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
    this.diagnostics.edges = Math.min(count, 40);
  }
  labels(width: number, height: number) {
    this.update(width, height);
    const accepted: ProjectedNode[] = [];
    const max = this.controller.policy.tier === "efficient" ? 16 : 30;
    for (const n of this.shown) {
      const p = this.project(n.key, width, height);
      if (p.depth < -1 || p.depth > 1) continue;
      const essential =
        n.kind !== "resource" || n.key === this.controller.selected;
      if (
        n.kind === "resource" &&
        this.navigation.camera.distance > 2400 &&
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
        const x = Math.max(90, Math.min(width - 90, p.x + offset.x)),
          y = Math.max(30, Math.min(height - 30, p.y + offset.y));
        if (
          x > width * 0.66 &&
          y < height * 0.5 &&
          n.key !== this.controller.selected
        )
          continue;
        if (
          accepted.some(
            (a) => Math.abs(a.x - x) < 180 && Math.abs(a.y - y) < 52,
          )
        )
          continue;
        accepted.push({
          node: n,
          x,
          y,
          anchorX: p.x,
          anchorY: p.y,
          depth: p.depth,
          radius: n.kind === "project" ? 90 : n.kind === "workspace" ? 55 : 25,
        });
        this.labelOffsets.set(n.key, { x: x - p.x, y: y - p.y });
        placed = true;
        break;
      }
      if (!placed && essential) {
        for (let row = 0; row < Math.floor(height / 56); row++) {
          const x = 95,
            y = 30 + row * 56;
          if (
            !accepted.some(
              (a) => Math.abs(a.x - x) < 180 && Math.abs(a.y - y) < 52,
            )
          ) {
            accepted.push({
              node: n,
              x,
              y,
              anchorX: p.x,
              anchorY: p.y,
              depth: p.depth,
              radius: 30,
            });
            placed = true;
            break;
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
    const hits = this.raycaster.intersectObjects(
      [...this.objects.values()],
      true,
    );
    if (hits.length) return { key: hits[0].object.userData.key };
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
