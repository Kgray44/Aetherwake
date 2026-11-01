import * as THREE from "three";

export type InstrumentKind = "conversation" | "research" | "note";
export type InstrumentStudy = "optical" | "engineered" | "composite";
export interface InstrumentFrame {
  kind: InstrumentKind;
  width: number;
  height: number;
  unfold: number;
  quality: "cinematic" | "balanced" | "efficient";
  study: InstrumentStudy;
}
export interface InstrumentMaterials {
  frame: THREE.MeshStandardMaterial;
  recess: THREE.MeshStandardMaterial;
  optics: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
}

type Profile = readonly (readonly [number, number])[];
interface ProfileBand {
  geometry: THREE.BufferGeometry;
  position: THREE.BufferAttribute;
  normal: THREE.BufferAttribute;
}

const SEGMENTS = 96;
const PROFILE_POINTS = 12;
const FRAME_PROFILES: Readonly<Record<InstrumentStudy, Profile>> = {
  optical: [
    [2.42, 0.05],
    [2.66, 0.48],
    [3.02, 0.72],
    [3.46, 0.5],
    [3.82, -0.1],
    [3.94, -0.8],
    [3.94, -3.7],
    [3.74, -4.3],
    [2.58, -4.3],
    [2.22, -3.8],
    [2.22, -0.9],
    [2.26, -0.25],
  ],
  engineered: [
    [2.8, -0.1],
    [3.4, 0.7],
    [4.6, 1.0],
    [5.7, 0.7],
    [7.3, -0.35],
    [8.1, -1.2],
    [8.1, -6.3],
    [7, -7.5],
    [3.1, -7.5],
    [2, -6.3],
    [2, -1.1],
    [2.2, -0.55],
  ],
  composite: [
    [2.588, 0.1],
    [3.02, 0.6],
    [3.668, 0.85],
    [4.46, 0.55],
    [5.252, -0.2],
    [5.684, -0.9],
    [5.684, -4.5],
    [5.036, -5.6],
    [2.804, -5.6],
    [2.156, -4.7],
    [2.156, -0.8],
    [2.3, -0.2],
  ],
};
const RESEARCH_PROFILES: Readonly<Record<InstrumentStudy, Profile>> = {
  optical: [
    [-3, -0.4],
    [-1.6, 0.6],
    [1.5, 2.6],
    [5.7, 3.8],
    [10.8, 0.6],
    [14.8, -1.6],
    [15.2, -4],
    [13, -7.2],
    [6, -8],
    [-1.8, -7.2],
    [-3, -5.6],
    [-3, -2.4],
  ],
  engineered: [
    [-3, -0.6],
    [-1.4, 0.5],
    [2, 2.9],
    [6.2, 4.1],
    [12, 0.4],
    [16.4, -1.7],
    [16.8, -4.3],
    [14, -7.4],
    [6, -8],
    [-1.8, -7.4],
    [-3, -5.7],
    [-3, -2.6],
  ],
  composite: [
    [-3, -0.25],
    [-1.7, 0.9],
    [1.8, 2.8],
    [5.8, 3.95],
    [11, 0.75],
    [15.4, -1.1],
    [15.8, -3.6],
    [13.3, -6.5],
    [6, -7.2],
    [-1.8, -6.6],
    [-3, -5],
    [-3, -2],
  ],
};
const BACK_PROFILE: Profile = [
  [6.6, -4.5],
  [7, -4.4],
  [7.7, -4.35],
  [8.4, -4.6],
  [8.8, -5],
  [8.8, -5.6],
  [8.8, -6.7],
  [8.2, -7.4],
  [6.8, -7.4],
  [6.2, -6.8],
  [6.2, -5.6],
  [6.3, -5],
];
const OPTIC_PROFILE: Profile = [
  [0.1, 0.15],
  [0.5, 0.45],
  [1.3, 0.65],
  [2.2, 0.45],
  [2.8, 0.05],
  [3.1, -0.4],
  [3.1, -1.5],
  [2.4, -2],
  [0.1, -2],
  [-0.6, -1.5],
  [-0.6, -0.4],
  [-0.3, -0.05],
];
const RETAINER_PHASES: Readonly<Record<InstrumentKind, readonly number[]>> = {
  conversation: [0.02, 0.27, 0.52, 0.77],
  research: [1 / 12, 3 / 12, 5 / 12, 7 / 12, 9 / 12, 11 / 12],
  note: [0.04, 0.54],
};
const INLAY_PHASES: Readonly<Record<InstrumentKind, readonly number[]>> = {
  conversation: [0.015, 0.515],
  research: [0.125, 0.375, 0.625, 0.875],
  note: [0.035, 0.535],
};

function createBand(): ProfileBand {
  const geometry = new THREE.BufferGeometry();
  const count = PROFILE_POINTS * (SEGMENTS + 1) * 2;
  const position = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
  const normal = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
  const index = new Uint16Array(PROFILE_POINTS * SEGMENTS * 6);
  let cursor = 0;
  for (let face = 0; face < PROFILE_POINTS; face++) {
    const base = face * (SEGMENTS + 1) * 2;
    for (let j = 0; j < SEGMENTS; j++) {
      const k = base + j * 2;
      index[cursor++] = k;
      index[cursor++] = k + 1;
      index[cursor++] = k + 2;
      index[cursor++] = k + 1;
      index[cursor++] = k + 3;
      index[cursor++] = k + 2;
    }
  }
  geometry.setAttribute("position", position);
  geometry.setAttribute("normal", normal);
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  position.setUsage(THREE.DynamicDrawUsage);
  normal.setUsage(THREE.DynamicDrawUsage);
  return { geometry, position, normal };
}

function roundedAttachment(width: number, height: number, depth: number) {
  const shape = new THREE.Shape();
  const x = width / 2,
    y = height / 2,
    r = Math.min(height * 0.35, 1.1);
  shape.moveTo(-x + r, -y);
  shape.lineTo(x - r, -y);
  shape.quadraticCurveTo(x, -y, x, -y + r);
  shape.lineTo(x, y - r);
  shape.quadraticCurveTo(x, y, x - r, y);
  shape.lineTo(-x + r, y);
  shape.quadraticCurveTo(-x, y, -x, y - r);
  shape.lineTo(-x, -y + r);
  shape.quadraticCurveTo(-x, -y, -x + r, -y);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSize: 0.3,
    bevelThickness: 0.3,
    bevelSegments: 2,
    steps: 1,
    curveSegments: 3,
  });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

/** Thin, persistent instrument construction around the readable DOM plane.
 * Coordinates are pixels around the resource center, matching FolioVisual.root.
 * Materials belong to the caller; this class owns geometry/instance pools only.
 */
export class InstrumentStructure {
  readonly root = new THREE.Group();
  private readonly front = createBand();
  private readonly back = createBand();
  private readonly seat = createBand();
  private readonly frameMesh: THREE.Mesh;
  private readonly backMesh: THREE.Mesh;
  private readonly seatMesh: THREE.Mesh;
  private readonly retainers: THREE.InstancedMesh;
  private readonly inlays: THREE.InstancedMesh;
  private readonly matrix = new THREE.Matrix4();
  private readonly orientation = new THREE.Quaternion();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly axis = new THREE.Vector3(0, 0, 1);
  private readonly contourPoint = { x: 0, y: 0, nx: 0, ny: 0 };
  private readonly profileX = new Float32Array(PROFILE_POINTS);
  private readonly profileZ = new Float32Array(PROFILE_POINTS);
  private readonly faceRadial = new Float32Array(PROFILE_POINTS);
  private readonly faceAxial = new Float32Array(PROFILE_POINTS);
  private width = -1;
  private height = -1;
  private unfold = -1;
  private kind: InstrumentKind = "conversation";
  private study: InstrumentStudy = "optical";
  private quality: InstrumentFrame["quality"] = "balanced";
  private disposed = false;
  private shapeUpdates = 0;

  constructor(materials: InstrumentMaterials) {
    this.root.name = "resource-instrument-structure";
    this.frameMesh = new THREE.Mesh(this.front.geometry, materials.frame);
    this.backMesh = new THREE.Mesh(this.back.geometry, materials.recess);
    this.seatMesh = new THREE.Mesh(this.seat.geometry, materials.optics);
    this.retainers = new THREE.InstancedMesh(
      roundedAttachment(9, 3.5, 1.8),
      materials.frame,
      6,
    );
    this.inlays = new THREE.InstancedMesh(
      roundedAttachment(8, 1.1, 0.9),
      materials.accent,
      6,
    );
    this.frameMesh.name = "machined-chamfer-frame";
    this.backMesh.name = "separated-recess-backing";
    this.seatMesh.name = "optical-retaining-seat";
    this.retainers.name = "finite-lens-and-corner-retainers";
    this.inlays.name = "structural-inset-identifiers";
    this.root.add(
      this.frameMesh,
      this.backMesh,
      this.seatMesh,
      this.retainers,
      this.inlays,
    );
    this.root.traverse((object) => {
      object.frustumCulled = false;
    });
    this.retainers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.inlays.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.update({
      kind: "conversation",
      width: 320,
      height: 220,
      unfold: 0,
      quality: "balanced",
      study: "optical",
    });
  }

  private contour(
    width: number,
    height: number,
    kind: InstrumentKind,
    unfold: number,
    phase: number,
    outset: number,
  ) {
    const p = phase >= 1 ? 0 : phase;
    const corner = Math.min(3, Math.floor(p * 4));
    const angle = p * Math.PI * 2;
    const halfW = Math.max(3, width * 0.5 + outset),
      halfH = Math.max(3, height * 0.5 + outset);
    const cornerBase = kind === "research" ? 7 : corner === 0 ? 22 : 7;
    const radius = Math.max(2, Math.min(cornerBase + outset - 1, halfW, halfH));
    const round = kind === "research" ? 1 - unfold : 0;
    const rx = halfW * round + radius * (1 - round),
      ry = halfH * round + radius * (1 - round);
    const c = Math.cos(angle),
      s = Math.sin(angle);
    this.contourPoint.x =
      (corner === 0 || corner === 3 ? 1 : -1) * (halfW - rx) + c * rx;
    this.contourPoint.y = (corner < 2 ? 1 : -1) * (halfH - ry) + s * ry;
    const nx = c / rx,
      ny = s / ry,
      inv = 1 / Math.hypot(nx, ny);
    this.contourPoint.nx = nx * inv;
    this.contourPoint.ny = ny * inv;
    return this.contourPoint;
  }

  private shapeBand(
    band: ProfileBand,
    profile: Profile,
    width: number,
    height: number,
    kind: InstrumentKind,
    unfold: number,
    depthScale: number,
    outsetShift = 0,
    zShift = 0,
    targetProfile: Profile = profile,
    profileBlend = 0,
  ) {
    for (let i = 0; i < PROFILE_POINTS; i++) {
      this.profileX[i] =
        profile[i][0] +
        (targetProfile[i][0] - profile[i][0]) * profileBlend +
        outsetShift;
      this.profileZ[i] =
        (profile[i][1] + (targetProfile[i][1] - profile[i][1]) * profileBlend) *
          depthScale +
        zShift;
    }
    for (let i = 0; i < PROFILE_POINTS; i++) {
      const next = (i + 1) % PROFILE_POINTS;
      const dx = this.profileX[next] - this.profileX[i],
        dz = this.profileZ[next] - this.profileZ[i];
      const reciprocal = 1 / Math.hypot(dx, dz);
      this.faceRadial[i] = -dz * reciprocal;
      this.faceAxial[i] = dx * reciprocal;
    }
    for (let face = 0; face < PROFILE_POINTS; face++) {
      const next = (face + 1) % PROFILE_POINTS;
      for (let side = 0; side < 2; side++) {
        const vertex = side ? next : face;
        let radial = this.faceRadial[face],
          axial = this.faceAxial[face];
        // Optical/composite crowns are one polished laminate. Smooth their
        // radial normals while retaining finite, crisp side and cavity bevels.
        if (this.study !== "engineered" && vertex >= 1 && vertex <= 4) {
          const before = (vertex + PROFILE_POINTS - 1) % PROFILE_POINTS;
          radial = this.faceRadial[before] + this.faceRadial[vertex];
          axial = this.faceAxial[before] + this.faceAxial[vertex];
          const inverse = 1 / Math.hypot(radial, axial);
          radial *= inverse;
          axial *= inverse;
        }
        for (let j = 0; j <= SEGMENTS; j++) {
          const point = this.contour(
            width,
            height,
            kind,
            unfold,
            j / SEGMENTS,
            this.profileX[vertex],
          );
          const index = (face * (SEGMENTS + 1) + j) * 2 + side;
          band.position.setXYZ(index, point.x, point.y, this.profileZ[vertex]);
          band.normal.setXYZ(
            index,
            point.nx * radial,
            point.ny * radial,
            axial,
          );
        }
      }
    }
    band.position.needsUpdate = true;
    band.normal.needsUpdate = true;
  }

  private placeParts(
    mesh: THREE.InstancedMesh,
    phases: readonly number[],
    frame: InstrumentFrame,
    unfold: number,
    outset: number,
    z: number,
    tangentScale: number,
    radialScale: number,
  ) {
    mesh.count = phases.length;
    for (let i = 0; i < phases.length; i++) {
      const point = this.contour(
        frame.width,
        frame.height,
        frame.kind,
        unfold,
        phases[i],
        outset,
      );
      this.position.set(point.x, point.y, z);
      this.orientation.setFromAxisAngle(
        this.axis,
        Math.atan2(point.ny, point.nx) - Math.PI / 2,
      );
      this.scale.set(tangentScale, radialScale, 1);
      this.matrix.compose(this.position, this.orientation, this.scale);
      mesh.setMatrixAt(i, this.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  update(frame: InstrumentFrame) {
    if (this.disposed) return;
    if (
      !Number.isFinite(frame.width) ||
      !Number.isFinite(frame.height) ||
      frame.width <= 0 ||
      frame.height <= 0 ||
      !Number.isFinite(frame.unfold)
    )
      throw new RangeError(
        "Instrument dimensions and unfolding must be finite and positive",
      );
    const unfold = THREE.MathUtils.clamp(frame.unfold, 0, 1);
    const reshaped =
      this.width !== frame.width ||
      this.height !== frame.height ||
      this.kind !== frame.kind ||
      this.unfold !== unfold ||
      this.study !== frame.study;
    this.quality = frame.quality;
    if (reshaped) {
      this.width = frame.width;
      this.height = frame.height;
      this.kind = frame.kind;
      this.unfold = unfold;
      this.study = frame.study;
      const depthScale =
        (frame.kind === "note" ? 0.72 : 1) * (1 - unfold * 0.17);
      this.shapeBand(
        this.front,
        frame.kind === "research"
          ? RESEARCH_PROFILES[frame.study]
          : FRAME_PROFILES[frame.study],
        frame.width,
        frame.height,
        frame.kind,
        unfold,
        depthScale,
        0,
        0,
        FRAME_PROFILES[frame.study],
        frame.kind === "research" ? unfold : 0,
      );
      const backDepth =
        depthScale *
        (frame.study === "optical"
          ? 0.65
          : frame.study === "composite"
            ? 0.8
            : 1);
      this.shapeBand(
        this.back,
        BACK_PROFILE,
        frame.width,
        frame.height,
        frame.kind,
        unfold,
        backDepth,
        frame.kind === "research" ? 4.2 * (1 - unfold) : 0,
      );
      const seatShift =
        frame.kind === "research" ? -10.8 * (1 - unfold) + 0.4 * unfold : 0.4;
      const seatZ =
        frame.kind === "research" ? 2.35 * (1 - unfold) + 0.15 * unfold : 0.15;
      this.shapeBand(
        this.seat,
        OPTIC_PROFILE,
        frame.width,
        frame.height,
        frame.kind,
        unfold,
        0.7 + unfold * 0.1,
        seatShift,
        seatZ,
      );
      this.placeParts(
        this.retainers,
        RETAINER_PHASES[frame.kind],
        frame,
        unfold,
        frame.kind === "research" ? 8.4 * (1 - unfold) + 5.2 * unfold : 5.2,
        frame.kind === "research" ? 3.0 * (1 - unfold) + 0.8 * unfold : 0.8,
        (frame.kind === "research" ? 1.3 : 0.82) * (1 - unfold * 0.25),
        frame.kind === "research"
          ? 2.2 * (1 - unfold) + 0.75 * unfold
          : 1 - unfold * 0.25,
      );
      this.placeParts(
        this.inlays,
        INLAY_PHASES[frame.kind],
        frame,
        unfold,
        frame.study === "engineered"
          ? 7.7
          : frame.study === "composite"
            ? 4.8
            : 3.1,
        -1.5 * (1 - unfold * 0.2),
        frame.kind === "note" ? (frame.study === "optical" ? 0.7 : 1.0) : 0.7,
        frame.kind === "note"
          ? frame.study === "optical"
            ? 0.65
            : 1.0
          : frame.study === "composite"
            ? 1.3
            : 0.8,
      );
      this.shapeUpdates++;
    }
    const efficient = frame.quality === "efficient";
    this.frameMesh.visible = true;
    this.backMesh.visible =
      frame.study !== "optical" || frame.kind === "research";
    this.seatMesh.visible =
      frame.kind === "research" ||
      (!efficient && frame.kind !== "note" && frame.study !== "engineered");
    this.retainers.visible = !efficient && frame.study === "engineered";
    this.inlays.visible =
      !efficient && (frame.kind === "note" || frame.study === "composite");
  }

  diagnostics() {
    let visibleObjects = 0,
      triangles = 0;
    for (const object of this.root.children) {
      if (!object.visible || !(object instanceof THREE.Mesh)) continue;
      visibleObjects++;
      triangles +=
        ((object.geometry.index?.count ??
          object.geometry.getAttribute("position").count) /
          3) *
        (object instanceof THREE.InstancedMesh ? object.count : 1);
    }
    return {
      kind: this.kind,
      study: this.study,
      quality: this.quality,
      width: this.width,
      height: this.height,
      unfold: this.unfold,
      geometryAllocations: 5,
      materialAllocations: 0,
      meshCount: 5,
      visibleObjects,
      triangles,
      shapeUpdates: this.shapeUpdates,
      coordinates: "resource-local-pixels",
      callerOwnsMaterials: true,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.front.geometry.dispose();
    this.back.geometry.dispose();
    this.seat.geometry.dispose();
    this.retainers.geometry.dispose();
    this.inlays.geometry.dispose();
    this.retainers.dispose();
    this.inlays.dispose();
    this.root.clear();
  }
}
