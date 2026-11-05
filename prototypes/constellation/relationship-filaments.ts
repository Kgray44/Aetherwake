import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import type { SpatialEdge } from "./spatial.ts";

const dashProjection = new THREE.Matrix4(),
  dashStart = new THREE.Vector4(),
  dashEnd = new THREE.Vector4();

/** Existing Three.js screen-width segments; the host still owns the renderer. */
export class RelationshipFilament extends Line2 {
  readonly points: readonly THREE.Vector3[];
  constructor(
    edge: SpatialEdge,
    curve: THREE.QuadraticBezierCurve3,
    color: number,
    selected: boolean,
  ) {
    const points = curve.getPoints(32),
      geometry = new LineGeometry();
    geometry.setPositions(points.flatMap((p) => [p.x, p.y, p.z]));
    super(
      geometry,
      new LineMaterial({
        color,
        linewidth: selected ? 2.25 : 1.6,
        worldUnits: false,
        dashed: edge.provenance === "inferred",
        dashSize: 6,
        gapSize: 4,
        transparent: true,
        opacity: selected
          ? 0.95
          : edge.id.startsWith("membership:")
            ? 0.5
            : 0.8,
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.points = points;
    this.computeLineDistances();
    this.userData.edge = edge.id;
    // A centerline bounding sphere omits the screen-width fringe. The bounded
    // scope set is submitted intact; the GPU clips individual curve segments.
    this.frustumCulled = false;
  }
  updateViewport(camera: THREE.Camera, width: number, height: number) {
    // CPU picking and the host's viewport use the same CSS pixels. Line2 also
    // refreshes this from renderer.getViewport at draw time (including DPR).
    this.material.resolution.set(width, height);
    if (!this.material.dashed) return;
    const { pixels, worldLength } = projectedLength(
      this.points,
      camera,
      width,
      height,
    );
    this.material.dashScale = Math.max(
      1e-6,
      pixels / Math.max(1e-6, worldLength),
    );
    // Subpixel dash gaps cannot convey provenance and can erase a short arc.
    // Close them continuously at small sizes; the inferred material/ID and
    // inspectable provenance remain unchanged. Longer arcs retain 6/4px dashes.
    this.material.gapSize = 4 * THREE.MathUtils.smoothstep(pixels, 8, 24);
  }
  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** Project clipped segments, never endpoint visibility, for dash density only. */
function projectedLength(
  points: readonly THREE.Vector3[],
  camera: THREE.Camera,
  width: number,
  height: number,
) {
  const matrix = dashProjection.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    ),
    a = dashStart,
    b = dashEnd;
  let pixels = 0,
    worldLength = 0;
  for (let i = 1; i < points.length; i++) {
    a.set(points[i - 1].x, points[i - 1].y, points[i - 1].z, 1).applyMatrix4(
      matrix,
    );
    b.set(points[i].x, points[i].y, points[i].z, 1).applyMatrix4(matrix);
    let start = 0,
      end = 1;
    // Homogeneous clip planes include near/far and retain a crossing segment
    // even when neither of its endpoints is inside the viewport.
    for (let axis = 0; axis < 3; axis++) {
      for (let side = -1; side <= 1; side += 2) {
        const da = a.w + side * a.getComponent(axis),
          db = b.w + side * b.getComponent(axis);
        if (da < 0 && db < 0) {
          end = -1;
          break;
        }
        if (da < 0) start = Math.max(start, da / (da - db));
        else if (db < 0) end = Math.min(end, da / (da - db));
      }
      if (start > end) break;
    }
    if (start > end) continue;
    const aw = THREE.MathUtils.lerp(a.w, b.w, start),
      bw = THREE.MathUtils.lerp(a.w, b.w, end);
    if (aw <= 0 || bw <= 0) continue;
    const x = THREE.MathUtils.lerp(a.x, b.x, start) / aw,
      y = THREE.MathUtils.lerp(a.y, b.y, start) / aw,
      x2 = THREE.MathUtils.lerp(a.x, b.x, end) / bw,
      y2 = THREE.MathUtils.lerp(a.y, b.y, end) / bw;
    pixels += Math.hypot(((x2 - x) * width) / 2, ((y2 - y) * height) / 2);
    worldLength += (end - start) * points[i - 1].distanceTo(points[i]);
  }
  return { pixels, worldLength };
}
