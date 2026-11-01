import * as THREE from "three";

export type ArchitectureConcept = "ring" | "aperture" | "observatory";
export type CelestialStudy = "starlit" | "shadow" | "deep";
export interface ArchitectureFrame {
  concept: ArchitectureConcept;
  quality: "cinematic" | "balanced" | "efficient";
  focus: number;
  /** Shared coordinator time in seconds. No independent animation loop. */
  time: number;
  ambientStrength: number;
  energy: number;
  celestialStudy?: CelestialStudy;
  /** Explicit capture-only orientation sample; never advances natural time. */
  phaseOverride?: number | null;
}

type Tier = "essential" | "balanced" | "cinematic";
interface OpticalMaterial {
  material: THREE.MeshStandardMaterial;
  reflection: number;
  emission: number;
}

/** A chamfered rectangular structural section swept around a circular centerline.
 * Each face has its own normal; the long cylindrical surfaces remain smooth.
 * Unlike a torus, this has distinct front face, inset bevel, wall and rear face.
 */
function structuralArc(
  radius: number,
  breadth: number,
  depth: number,
  start = -1.15,
  extent = Math.PI * 1.95,
  steps = 180,
) {
  const bevel = Math.min(breadth * 0.15, depth * 0.18, 0.065);
  const half = breadth / 2;
  const frontHalf = half - bevel;
  const crown = Math.min(breadth * 0.13, depth * 0.2, 0.14);
  const front: [number, number][] = Array.from({ length: 5 }, (_, i) => {
    const x = -frontHalf + (i * frontHalf) / 2;
    return [x, crown * Math.cos(((x / frontHalf) * Math.PI) / 2)];
  });
  const section: readonly [number, number][] = [
    ...front,
    [half, -bevel],
    [half, -depth + bevel],
    [half - bevel, -depth],
    [-half + bevel, -depth],
    [-half, -depth + bevel],
    [-half, -bevel],
  ];
  const positions: number[] = [],
    normals: number[] = [],
    indices: number[] = [];
  for (let face = 0; face < section.length; face++) {
    const p = section[face],
      q = section[(face + 1) % section.length];
    const length = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const radialNormal = -(q[1] - p[1]) / length;
    const axialNormal = (q[0] - p[0]) / length;
    const base = positions.length / 3;
    for (let i = 0; i <= steps; i++) {
      const angle = start + (i / steps) * extent;
      const c = Math.cos(angle),
        s = Math.sin(angle);
      for (const point of [p, q]) {
        positions.push(
          (radius + point[0]) * c,
          (radius + point[0]) * s,
          point[1],
        );
        if (face < 4) {
          const slope =
            ((-crown * Math.PI) / (2 * frontHalf)) *
            Math.sin(((point[0] / frontHalf) * Math.PI) / 2);
          const inverseLength = 1 / Math.hypot(slope, 1);
          normals.push(
            -slope * inverseLength * c,
            -slope * inverseLength * s,
            inverseLength,
          );
        } else normals.push(radialNormal * c, radialNormal * s, axialNormal);
      }
      if (i < steps) {
        const k = base + i * 2;
        indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
  }
  // Closed end plates: visible cuts read as thick fabricated sections.
  for (const end of [0, 1]) {
    const angle = start + extent * end;
    const c = Math.cos(angle),
      s = Math.sin(angle);
    const normal = new THREE.Vector3(-s, c, 0).multiplyScalar(end ? 1 : -1);
    const base = positions.length / 3;
    positions.push(radius * c, radius * s, -depth / 2);
    normals.push(normal.x, normal.y, normal.z);
    for (const point of section) {
      positions.push(
        (radius + point[0]) * c,
        (radius + point[0]) * s,
        point[1],
      );
      normals.push(normal.x, normal.y, normal.z);
    }
    for (let i = 0; i < section.length; i++) {
      const a = base + 1 + i,
        b = base + 1 + ((i + 1) % section.length);
      indices.push(...(end ? [base, a, b] : [base, b, a]));
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

/** Original, procedural architectural studies. Semantic/user data stays outside
 * this projection. All geometry is allocated once; tiers reuse the same object.
 */
export class OrbitalArchitecture {
  readonly root = new THREE.Group();
  private readonly concepts: Record<ArchitectureConcept, THREE.Group> = {
    ring: new THREE.Group(),
    aperture: new THREE.Group(),
    observatory: new THREE.Group(),
  };
  private readonly optical: OpticalMaterial[] = [];
  private concept: ArchitectureConcept = "ring";
  private quality: ArchitectureFrame["quality"] = "balanced";
  private disposed = false;
  private previousTime: number | null = null;
  private opticalClock = 0;
  private renderedPhase = 0;
  private scriptedPhase: number | null = null;
  private celestialStudy: CelestialStudy = "starlit";
  private readonly rotationTracks: {
    group: THREE.Group;
    base: THREE.Euler;
    gain: number;
  }[] = [];
  private readonly shell = this.material(0x353a42, 0.88, 0.38, 0.09);
  private readonly titanium = this.material(0x626972, 0.93, 0.25, 0.13);
  private readonly recess = this.material(0x0d1117, 0.68, 0.6, 0.025);
  private readonly rib = this.material(0x30363f, 0.9, 0.42, 0.06);
  private readonly porcelain = this.material(0x666573, 0.1, 0.48, 0.06);
  private readonly panel = this.material(0x262c35, 0.86, 0.48, 0.055);
  private readonly inlay = this.material(0x4d555f, 0.93, 0.28, 0.11);
  private readonly light = this.material(
    0x9c92b5,
    0.68,
    0.3,
    0.55,
    0x9c8bbd,
    1.1,
  );

  constructor() {
    this.root.name = "celestial-architecture";
    for (const [name, group] of Object.entries(this.concepts)) {
      group.name = `architecture-${name}`;
      this.root.add(group);
    }
    this.buildRing();
    this.buildAperture();
    this.buildObservatory();
    this.update({
      concept: "ring",
      quality: "balanced",
      focus: 0,
      time: 0,
      ambientStrength: 0,
      energy: 0.22,
    });
  }

  private material(
    color: number,
    metalness: number,
    roughness: number,
    reflection: number,
    emissive = 0x000000,
    emission = 0,
  ) {
    const material = new THREE.MeshStandardMaterial({
      color,
      metalness,
      roughness,
      envMapIntensity: reflection,
      emissive,
      emissiveIntensity: emission,
    });
    // Static, object-bound machined roughness only. Visibility/highlights come
    // from real normals, geometry, occlusion and scene lights as it rotates.
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>\nvarying vec3 vAWMachiningPosition;`,
        )
        .replace(
          "#include <worldpos_vertex>",
          `#include <worldpos_vertex>
          vec4 awArchitecturePosition = vec4(transformed, 1.);
          #ifdef USE_INSTANCING
            awArchitecturePosition = instanceMatrix * awArchitecturePosition;
          #endif
          vAWMachiningPosition = awArchitecturePosition.xyz;
        `,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
          varying vec3 vAWMachiningPosition;
        `,
        )
        .replace(
          "#include <roughnessmap_fragment>",
          `
          #include <roughnessmap_fragment>
          float awMachiningCoordinate = length(vAWMachiningPosition.xy) * 64. + vAWMachiningPosition.z * 27.;
          float awMachiningFootprint = fwidth(awMachiningCoordinate);
          float awMachining = sin(awMachiningCoordinate) * exp(-awMachiningFootprint * awMachiningFootprint);
          float awSatin = sin(length(vAWMachiningPosition.xy) * 4.2 + vAWMachiningPosition.z * 2.);
          roughnessFactor = clamp(roughnessFactor + awMachining * .032 + awSatin * .018, .14, .94);
        `,
        );
    };
    material.customProgramCacheKey = () => "aw-orbital-machined-v2";
    this.optical.push({ material, reflection, emission });
    return material;
  }

  private add(
    parent: THREE.Group,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    tier: Tier = "essential",
  ) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.architectureTier = tier;
    parent.add(mesh);
    return mesh;
  }

  private arc(
    parent: THREE.Group,
    radius: number,
    breadth: number,
    depth: number,
    z: number,
    material: THREE.Material,
    tier: Tier = "essential",
    start = -1.15,
    extent = Math.PI * 2,
  ) {
    const mesh = this.add(
      parent,
      structuralArc(radius, breadth, depth, start, extent),
      material,
      tier,
    );
    mesh.position.z = z;
    return mesh;
  }

  private radialMembers(
    parent: THREE.Group,
    radius: number,
    count: number,
    length: number,
    depth: number,
    z: number,
    tier: Tier = "essential",
    start = -1.15,
    extent = Math.PI * 2,
    material: THREE.Material = this.rib,
    breadth = 0.072,
  ) {
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(breadth, length, depth),
      material,
      count,
    );
    mesh.userData.architectureTier = tier;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const matrix = new THREE.Matrix4(),
      rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1),
      p = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const a = start + ((i + 0.5) / count) * extent;
      p.set(Math.cos(a) * radius, Math.sin(a) * radius, z);
      rotation.setFromAxisAngle(new THREE.Vector3(0, 0, 1), a - Math.PI / 2);
      matrix.compose(p, rotation, scale);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.computeBoundingSphere();
    parent.add(mesh);
    return mesh;
  }

  private assembly(parent: THREE.Group, radius: number, extent = Math.PI * 2) {
    // Four separated load spines form a genuinely open torsion cage. There is
    // deliberately no solid backing sheet hiding the axial core or framework.
    const bayCount = Math.max(24, Math.round((radius * 1.67) / 4) * 4);
    const innerFront = this.arc(
      parent,
      radius - 1.15,
      0.4,
      0.65,
      0.1,
      this.titanium,
      "essential",
      -1.15,
      extent,
    );
    const outerFront = this.arc(
      parent,
      radius + 1.5,
      0.45,
      0.8,
      -0.15,
      this.shell,
      "essential",
      -1.15,
      extent,
    );
    const innerRear = this.arc(
      parent,
      radius - 0.95,
      0.32,
      0.65,
      -2.8,
      this.rib,
      "essential",
      -1.15,
      extent,
    );
    const outerRear = this.arc(
      parent,
      radius + 1.48,
      0.6,
      0.85,
      -3,
      this.inlay,
      "essential",
      -1.15,
      extent,
    );
    innerFront.name = "inner-front-load-spine";
    outerFront.name = "outer-front-load-spine";
    innerRear.name = "inner-rear-load-spine";
    outerRear.name = "outer-rear-load-spine";
    const bulkheads = this.radialMembers(
      parent,
      radius + 0.15,
      bayCount,
      2.95,
      2.85,
      -1.43,
      "essential",
      -1.15 - (extent / bayCount) * 0.5,
      extent,
      this.rib,
      0.13,
    );
    bulkheads.name = "radial-bulkhead-frames";
    this.loadBearingTruss(parent, radius, bayCount, extent);
    // Non-emissive conduits occupy the cavity, over a world unit behind the
    // shell. Their depth is visible through the long slot and service bays.
    for (const [offset, z] of [
      [-0.32, -1.2],
      [0.02, -1.42],
    ] as const) {
      const conduit = this.arc(
        parent,
        radius + offset,
        0.105,
        0.14,
        z,
        this.inlay,
        "balanced",
        -1.15,
        extent,
      );
      conduit.name = "recessed-core-conduit";
    }
    this.arc(
      parent,
      radius + 0.36,
      0.08,
      0.12,
      -1.63,
      this.porcelain,
      "cinematic",
      -1.15,
      extent,
    ).name = "ceramic-core-insulator";
    this.curvedShellModules(
      parent,
      radius + 0.55,
      1.45,
      0.24,
      0.14,
      bayCount,
      extent,
      this.shell,
      "inset-rough-panels",
      "essential",
      true,
    );
    this.curvedShellModules(
      parent,
      radius - 0.75,
      0.55,
      0.17,
      0.15,
      bayCount,
      extent,
      this.panel,
      "inner-shell-modules",
      "essential",
      true,
    );
    this.curvedShellModules(
      parent,
      radius - 1.45,
      0.36,
      0.82,
      -0.38,
      bayCount,
      extent,
      this.rib,
      "segmented-inner-flange",
      "essential",
      false,
    );
    this.inspectionLamps(parent, radius - 0.42, extent);
    this.fastenerGroups(parent, radius, bayCount, extent);
    const innerRiblets = this.radialMembers(
      parent,
      radius - 0.75,
      bayCount * 2,
      0.49,
      0.04,
      0.205,
      "cinematic",
      -1.15,
      extent,
      this.inlay,
      0.035,
    );
    innerRiblets.name = "inner-flange-riblets";
    parent.userData.openServiceBays = Math.floor(bayCount / 4);
    parent.userData.structuralBayCount = bayCount;
    parent.userData.radialBreadthWorldUnits = 3.36;
    parent.userData.axialDepthWorldUnits = 4.1;
    return parent;
  }

  private curvedShellModules(
    parent: THREE.Group,
    radius: number,
    breadth: number,
    depth: number,
    z: number,
    count: number,
    extent: number,
    material: THREE.Material,
    name: string,
    tier: Tier,
    serviceGaps: boolean,
  ) {
    const pitch = extent / count;
    const indices = Array.from({ length: count }, (_, i) => i).filter(
      (i) => !serviceGaps || i % 4 !== 3,
    );
    const geometry = structuralArc(
      radius,
      breadth,
      depth,
      -pitch * 0.465,
      pitch * 0.93,
      8,
    );
    const modules = new THREE.InstancedMesh(geometry, material, indices.length);
    modules.name = name;
    modules.userData.architectureTier = tier;
    modules.userData.serviceGapCount = serviceGaps ? count - indices.length : 0;
    modules.castShadow = true;
    modules.receiveShadow = true;
    const matrix = new THREE.Matrix4(),
      q = new THREE.Quaternion();
    const axis = new THREE.Vector3(0, 0, 1),
      position = new THREE.Vector3(0, 0, z),
      scale = new THREE.Vector3(1, 1, 1);
    for (let j = 0; j < indices.length; j++) {
      const angle = -1.15 + (indices[j] + 0.5) * pitch;
      q.setFromAxisAngle(axis, angle);
      matrix.compose(position, q, scale);
      modules.setMatrixAt(j, matrix);
    }
    modules.computeBoundingSphere();
    parent.add(modules);
  }

  private fastenerGroups(
    parent: THREE.Group,
    radius: number,
    count: number,
    extent: number,
  ) {
    const closed = Array.from({ length: count }, (_, i) => i).filter(
      (i) => i % 4 !== 3,
    );
    const geometry = new THREE.CylinderGeometry(0.035, 0.035, 0.025, 6);
    geometry.rotateX(Math.PI / 2);
    const fasteners = new THREE.InstancedMesh(
      geometry,
      this.titanium,
      closed.length * 4,
    );
    fasteners.name = "paired-shell-attachment-groups";
    fasteners.userData.architectureTier = "balanced";
    fasteners.receiveShadow = true;
    const matrix = new THREE.Matrix4(),
      q = new THREE.Quaternion(),
      position = new THREE.Vector3();
    const axis = new THREE.Vector3(0, 0, 1),
      scale = new THREE.Vector3(1, 1, 1);
    let index = 0;
    for (const i of closed) {
      for (const side of [-1, 1]) {
        const angle = -1.15 + ((i + 0.5 + side * 0.36) * extent) / count;
        for (const offset of [0.02, 1.1]) {
          position.set(
            Math.cos(angle) * (radius + offset),
            Math.sin(angle) * (radius + offset),
            0.168,
          );
          q.setFromAxisAngle(axis, angle);
          matrix.compose(position, q, scale);
          fasteners.setMatrixAt(index++, matrix);
        }
      }
    }
    fasteners.computeBoundingSphere();
    parent.add(fasteners);
  }

  private loadBearingTruss(
    parent: THREE.Group,
    radius: number,
    count: number,
    extent: number,
  ) {
    const truss = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.11, 1, 0.11),
      this.rib,
      count * 4,
    );
    truss.name = "triangulated-axial-load-framework";
    truss.userData.architectureTier = "essential";
    truss.castShadow = true;
    truss.receiveShadow = true;
    const matrix = new THREE.Matrix4(),
      q = new THREE.Quaternion();
    const a = new THREE.Vector3(),
      b = new THREE.Vector3(),
      center = new THREE.Vector3(),
      direction = new THREE.Vector3();
    const axis = new THREE.Vector3(0, 1, 0),
      scale = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const angle = -1.15 + ((i + 0.5) * extent) / count;
      const halfBay = (extent / count) * 0.45;
      for (let wall = 0; wall < 2; wall++) {
        for (let side = 0; side < 2; side++) {
          const sign = side ? -1 : 1;
          const frontRadius = radius + (wall ? 1.5 : -1.15);
          const rearRadius = radius + (wall ? 1.48 : -0.95);
          a.set(
            Math.cos(angle - halfBay * sign) * frontRadius,
            Math.sin(angle - halfBay * sign) * frontRadius,
            wall ? -0.45 : -0.2,
          );
          b.set(
            Math.cos(angle + halfBay * sign) * rearRadius,
            Math.sin(angle + halfBay * sign) * rearRadius,
            wall ? -3.2 : -2.95,
          );
          direction.subVectors(b, a);
          scale.set(1, direction.length(), 1);
          q.setFromUnitVectors(axis, direction.normalize());
          center.addVectors(a, b).multiplyScalar(0.5);
          matrix.compose(center, q, scale);
          truss.setMatrixAt(i * 4 + wall * 2 + side, matrix);
        }
      }
    }
    truss.computeBoundingSphere();
    parent.add(truss);
  }

  private inspectionLamps(parent: THREE.Group, radius: number, extent: number) {
    const count = 12;
    const lamps = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.055, 0.08, 0.028),
      this.light,
      count,
    );
    lamps.name = "recessed-inspection-points";
    lamps.userData.architectureTier = "balanced";
    const matrix = new THREE.Matrix4(),
      q = new THREE.Quaternion(),
      position = new THREE.Vector3();
    const axis = new THREE.Vector3(0, 0, 1),
      scale = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < count; i++) {
      const angle = -1.07 + ((i + 0.5) * extent) / count;
      position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, -0.025);
      q.setFromAxisAngle(axis, angle);
      matrix.compose(position, q, scale);
      lamps.setMatrixAt(i, matrix);
    }
    lamps.computeBoundingSphere();
    parent.add(lamps);
  }

  private trackRotation(group: THREE.Group, gain = 1) {
    this.rotationTracks.push({ group, base: group.rotation.clone(), gain });
  }

  private buildRing() {
    // Owner-directed composition: only a gentle segment of an immense ring is
    // visible. The complete structure continues beyond BOTH vertical edges.
    // The structure occupies a deeper middle distance. An oblique section
    // exposes the axial framework and satin side walls behind the front shell.
    const frame = this.assembly(new THREE.Group(), 21.5);
    frame.position.set(-17.8, 1.4, -20);
    frame.rotation.set(0.24, 0.72, -0.14);
    frame.name = "monumental-open-span";
    this.trackRotation(frame);
    this.concepts.ring.add(frame);
    const distant = this.assembly(new THREE.Group(), 23.5);
    distant.position.set(-19.4, 2.6, -28);
    distant.rotation.set(0.17, 0.72, -0.14);
    distant.userData.architectureTier = "cinematic";
    distant.userData.celestialSupport = true;
    this.trackRotation(distant, 0.62);
    this.concepts.ring.add(distant);
  }

  private buildAperture() {
    const aperture = new THREE.Group();
    aperture.position.set(-7.1, 3.3, -26);
    aperture.rotation.set(0.35, -0.58, 0.08);
    this.trackRotation(aperture, 0.8);
    this.assembly(aperture, 9.5, Math.PI * 2);
    // Axially separated inner collimator makes this a view through an aperture,
    // not the same ring with a different color or camera offset.
    this.arc(aperture, 8.65, 0.48, 0.6, -3.1, this.shell);
    this.arc(aperture, 7.85, 0.25, 0.4, -5.5, this.titanium);
    this.radialMembers(
      aperture,
      8.95,
      32,
      0.85,
      4.2,
      -2.7,
      "balanced",
      0,
      Math.PI * 2,
    );
    this.arc(aperture, 7.67, 0.055, 0.07, -5.48, this.recess, "balanced");
    this.concepts.aperture.add(aperture);
  }

  private buildObservatory() {
    const dominant = this.assembly(new THREE.Group(), 11.7, Math.PI * 1.5);
    dominant.position.set(-9.2, 3.2, -20.5);
    dominant.rotation.set(0.62, 0.25, -0.3);
    this.trackRotation(dominant, 0.75);
    this.concepts.observatory.add(dominant);
    const receiver = new THREE.Group();
    receiver.position.set(1.5, 3.4, -40);
    receiver.rotation.set(1.05, -0.32, 0.1);
    this.trackRotation(receiver, 0.4);
    this.arc(
      receiver,
      6.1,
      0.32,
      0.58,
      0,
      this.shell,
      "essential",
      0,
      Math.PI * 2,
    );
    this.arc(
      receiver,
      5.65,
      0.12,
      0.26,
      0.15,
      this.titanium,
      "essential",
      0,
      Math.PI * 2,
    );
    this.radialMembers(
      receiver,
      5.86,
      24,
      0.52,
      0.3,
      -0.2,
      "balanced",
      0,
      Math.PI * 2,
    );
    this.concepts.observatory.add(receiver);
    // One deliberate connecting spire, rather than arbitrary floating debris.
    const spire = this.add(
      this.concepts.observatory,
      new THREE.BoxGeometry(0.26, 6.6, 0.8),
      this.recess,
    );
    spire.position.set(-0.1, 0.7, -33);
    spire.rotation.z = -0.09;
    const cap = this.add(
      this.concepts.observatory,
      new THREE.BoxGeometry(1.7, 0.18, 1.3),
      this.shell,
      "balanced",
    );
    cap.position.set(0.2, 3.9, -33);
  }

  update(frame: ArchitectureFrame) {
    if (this.disposed) return;
    this.concept = frame.concept;
    this.quality = frame.quality;
    this.celestialStudy = frame.celestialStudy ?? "starlit";
    for (const [name, group] of Object.entries(this.concepts))
      group.visible = name === frame.concept;
    this.root.traverse((object) => {
      const tier = object.userData.architectureTier as Tier | undefined;
      if (tier)
        object.visible =
          tier === "essential" ||
          (tier === "balanced"
            ? frame.quality !== "efficient"
            : frame.quality === "cinematic");
      if (object.userData.celestialSupport)
        object.visible =
          this.celestialStudy === "deep" && frame.quality !== "efficient";
    });
    const focus = THREE.MathUtils.clamp(frame.focus, 0, 1);
    const delta =
      this.previousTime === null
        ? 0
        : Math.max(0, Math.min(0.1, frame.time - this.previousTime));
    this.previousTime = frame.time;
    this.opticalClock +=
      delta *
      THREE.MathUtils.clamp(frame.ambientStrength, 0, 1) *
      (1 - focus * 0.8);
    this.scriptedPhase =
      typeof frame.phaseOverride === "number" &&
      Number.isFinite(frame.phaseOverride)
        ? THREE.MathUtils.clamp(frame.phaseOverride, 0, 3600)
        : null;
    this.renderedPhase = this.scriptedPhase ?? this.opticalClock;
    for (const { material, reflection, emission } of this.optical) {
      material.envMapIntensity = reflection * (1 - focus * 0.56);
      material.emissiveIntensity =
        emission *
        (1 - focus * 0.7) *
        (0.94 + Math.min(1, frame.energy) * 0.06);
    }
    // Rotate around each assembly's own offscreen center. The enormous rim
    // stays composed while actual normals/inlays catch the fixed scene lights.
    // Accumulated permitted time freezes under Quiet/AmbientOff/reduced motion;
    // turning ambience off never teleports a partially rotated structure.
    for (const { group, base, gain } of this.rotationTracks) {
      group.rotation.x =
        base.x + Math.sin(this.renderedPhase * 0.037) * 0.018 * gain;
      group.rotation.y =
        base.y + Math.sin(this.renderedPhase * 0.029) * 0.025 * gain;
      group.rotation.z = base.z + this.renderedPhase * 0.001 * gain;
    }
  }

  diagnostics() {
    let drawObjects = 0,
      triangles = 0;
    const count = (object: THREE.Object3D, parentVisible: boolean) => {
      const visible = parentVisible && object.visible;
      if (!visible) return;
      if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
        drawObjects++;
        if (object instanceof THREE.Mesh)
          triangles +=
            ((object.geometry.index?.count ??
              object.geometry.getAttribute("position").count) /
              3) *
            (object instanceof THREE.InstancedMesh ? object.count : 1);
      }
      for (const child of object.children) count(child, visible);
    };
    count(this.root, true);
    return {
      concept: this.concept,
      quality: this.quality,
      drawObjects,
      triangles,
      opticalClockSeconds: this.opticalClock,
      longitudinalRotationRadians: this.renderedPhase * 0.001,
      primaryRingRadiusWorldUnits: 21.5,
      primaryShellServiceBays: this.root.getObjectByName("monumental-open-span")
        ?.userData.openServiceBays,
      structuralDesign:
        "paired-front-rear-load-spines-with-open-triangulated-service-bays",
      scriptedPhaseSeconds: this.scriptedPhase,
      celestialStudy: this.celestialStudy,
      revealKind: "orientation-driven-PBR-lighting-and-geometric-occlusion",
      proceduralSurfaceDetail: "static-derivative-filtered-machined-roughness",
      originalProceduralGeometry: true,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const geometries = new Set<THREE.BufferGeometry>(),
      materials = new Set<THREE.Material>();
    this.root.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material])
          materials.add(material);
      }
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    this.root.clear();
  }
}
