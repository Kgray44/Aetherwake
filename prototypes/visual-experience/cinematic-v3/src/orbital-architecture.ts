import * as THREE from "three";

export type ArchitectureConcept = "ring" | "aperture" | "observatory";
export interface ArchitectureFrame {
  concept: ArchitectureConcept;
  quality: "cinematic" | "balanced" | "efficient";
  focus: number;
  /** Shared coordinator time in seconds. No independent animation loop. */
  time: number;
  ambientStrength: number;
  energy: number;
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
  const section: readonly [number, number][] = [
    [-half + bevel, 0],
    [half - bevel, 0],
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
        normals.push(radialNormal * c, radialNormal * s, axialNormal);
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
  private readonly veilUniforms = {
    uAWVeilTime: { value: 0 },
    uAWVeilFocus: { value: 0 },
  };
  private readonly rotationTracks: {
    group: THREE.Group;
    base: THREE.Euler;
    gain: number;
  }[] = [];
  private readonly shell = this.material(0x9b8ba9, 0.53, 0.34, 0.8);
  private readonly titanium = this.material(0xc0b7cb, 0.7, 0.28, 0.85);
  private readonly recess = this.material(0x100f1b, 0.6, 0.5, 0.28);
  private readonly rib = this.material(0x61556f, 0.64, 0.42, 0.52);
  private readonly porcelain = this.material(0x8e8caa, 0.6, 0.32, 0.6);
  private readonly panel = this.material(0x62566e, 0.4, 0.53, 0.48);
  private readonly inlay = this.material(0x9687a9, 0.78, 0.22, 0.9);
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
    this.buildDistantField();
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
    emissive = 0x171125,
    emission = 0.06,
  ) {
    const material = new THREE.MeshStandardMaterial({
      color,
      metalness,
      roughness,
      envMapIntensity: reflection,
      emissive,
      emissiveIntensity: emission,
    });
    // A spatial optical veil, separate from scene switching and semantic state.
    // Large moving regions quietly hide/reveal the same real geometry; this is
    // a bounded atmosphere approximation, not volumetric light transport.
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.veilUniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>\nvarying vec3 vAWArchitectureWorld;`,
        )
        .replace(
          "#include <worldpos_vertex>",
          `#include <worldpos_vertex>
          vec4 awArchitecturePosition = vec4(transformed, 1.);
          #ifdef USE_INSTANCING
            awArchitecturePosition = instanceMatrix * awArchitecturePosition;
          #endif
          vAWArchitectureWorld = (modelMatrix * awArchitecturePosition).xyz;
        `,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
          varying vec3 vAWArchitectureWorld;
          uniform float uAWVeilTime, uAWVeilFocus;
        `,
        )
        .replace(
          "#include <opaque_fragment>",
          `
          float awVeilBroad = sin(vAWArchitectureWorld.y * .15 + vAWArchitectureWorld.x * .065 + vAWArchitectureWorld.z * .04 - uAWVeilTime * .045);
          float awVeilDrift = sin(vAWArchitectureWorld.y * .07 - vAWArchitectureWorld.z * .06 + uAWVeilTime * .026);
          float awReveal = smoothstep(-.45, .65, awVeilBroad * .72 + awVeilDrift * .28);
          outgoingLight *= mix(.10, 1., awReveal) * (1. - uAWVeilFocus * .22);
          #include <opaque_fragment>
        `,
        );
    };
    material.customProgramCacheKey = () => "aw-orbital-veil-v1";
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
    // Keep the structural section at human-readable scale as orbital radius
    // grows. Only repeated bay count follows circumference; thickness does not.
    const circumferenceGain = radius / 10.8;
    const bayCount = Math.max(36, Math.round(52 * circumferenceGain));
    // The dark spine carries the broad front shell; a separated rear race and
    // radial webs produce real occlusion, readable thickness and shadow gaps.
    this.arc(
      parent,
      radius,
      1.8,
      1.4,
      -0.12,
      this.recess,
      "essential",
      -1.15,
      extent,
    );
    this.arc(
      parent,
      radius + 0.28,
      1.0,
      0.52,
      0.06,
      this.shell,
      "essential",
      -1.15,
      extent,
    );
    this.arc(
      parent,
      radius - 0.72,
      0.28,
      0.65,
      0.12,
      this.titanium,
      "essential",
      -1.15,
      extent,
    );
    this.arc(
      parent,
      radius + 0.94,
      0.18,
      0.55,
      -0.05,
      this.titanium,
      "essential",
      -1.15,
      extent,
    );
    this.arc(
      parent,
      radius + 1.2,
      0.42,
      0.72,
      -1.45,
      this.shell,
      "essential",
      -1.15,
      extent,
    );
    this.radialMembers(
      parent,
      radius + 0.47,
      bayCount,
      1.7,
      1.32,
      -0.98,
      "essential",
      -1.15,
      extent,
    );
    this.arc(
      parent,
      radius - 0.43,
      0.18,
      0.1,
      -0.055,
      this.recess,
      "balanced",
      -1.15,
      extent,
    );
    this.arc(
      parent,
      radius + 0.72,
      0.045,
      0.03,
      0.1,
      this.porcelain,
      "balanced",
      -1.15,
      extent,
    );
    // Short, recessed illuminated galleries. Their separation suggests scale
    // without outlining the entire structure as a luminous tube.
    for (let i = 0; i < 9; i++) {
      const start = -1.05 + i * (extent / 9);
      const gallery = this.arc(
        parent,
        radius - 0.43,
        0.055,
        0.038,
        -0.035,
        this.light,
        "balanced",
        start,
        0.145 / Math.max(1, circumferenceGain),
      );
      gallery.name = "recessed-gallery";
    }
    this.radialMembers(
      parent,
      radius + 0.28,
      bayCount,
      0.96,
      0.018,
      0.071,
      "balanced",
      -1.15,
      extent,
      this.recess,
      0.025,
    );
    this.insetPanels(parent, radius + 0.28, bayCount, extent);
    this.radialMembers(
      parent,
      radius + 0.28,
      bayCount * 2,
      0.95,
      0.032,
      0.11,
      "cinematic",
      -1.15,
      extent,
    );
    return parent;
  }

  private insetPanels(
    parent: THREE.Group,
    radius: number,
    count: number,
    extent: number,
  ) {
    const pitch = (radius * extent) / count;
    const geometry = new THREE.BoxGeometry(pitch * 0.58, 0.56, 0.024);
    const polishedCount = Math.ceil(count / 7);
    const rough = new THREE.InstancedMesh(
      geometry,
      this.panel,
      count - polishedCount,
    );
    const polished = new THREE.InstancedMesh(
      geometry,
      this.inlay,
      polishedCount,
    );
    rough.name = "inset-rough-panels";
    polished.name = "selective-polished-inlays";
    for (const mesh of [rough, polished])
      mesh.userData.architectureTier = "balanced";
    const matrix = new THREE.Matrix4(),
      rotation = new THREE.Quaternion(),
      position = new THREE.Vector3();
    const axis = new THREE.Vector3(0, 0, 1),
      scale = new THREE.Vector3(1, 1, 1);
    let roughIndex = 0,
      polishedIndex = 0;
    for (let i = 0; i < count; i++) {
      const angle = -1.15 + ((i + 0.5) * extent) / count;
      position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0.078);
      rotation.setFromAxisAngle(axis, angle - Math.PI / 2);
      matrix.compose(position, rotation, scale);
      if (i % 7 === 0) polished.setMatrixAt(polishedIndex++, matrix);
      else rough.setMatrixAt(roughIndex++, matrix);
    }
    rough.computeBoundingSphere();
    polished.computeBoundingSphere();
    parent.add(rough, polished);
  }

  private trackRotation(group: THREE.Group, gain = 1) {
    this.rotationTracks.push({ group, base: group.rotation.clone(), gain });
  }

  private buildRing() {
    // Owner-directed composition: only a gentle segment of an immense ring is
    // visible. The complete structure continues beyond BOTH vertical edges.
    // Forward center placement compensates for the deeper Y-rotated far rim,
    // retaining its previous visible depth instead of losing it to more fog.
    const frame = this.assembly(new THREE.Group(), 21.5);
    frame.position.set(-19.8, 1.4, -11.5);
    frame.rotation.set(0.19, 0.53, -0.1);
    frame.name = "monumental-open-span";
    this.trackRotation(frame);
    this.concepts.ring.add(frame);
    const distant = this.assembly(new THREE.Group(), 23.5);
    distant.position.set(-21.4, 2.6, -19);
    distant.rotation.set(0.12, 0.53, -0.1);
    distant.userData.architectureTier = "cinematic";
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

  private buildDistantField() {
    const positions: number[] = [];
    // Deterministic, sparse depth markers; no rotating galaxy or random texture.
    for (let i = 0; i < 38; i++) {
      const x = (((i * 0.61803398875) % 1) - 0.5) * 62;
      const y = (((i * 0.41421356237) % 1) - 0.5) * 30 + 4;
      positions.push(x, y, -38 - (i % 5) * 5);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    const points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color: 0x7f7c9c,
        size: 0.025,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        sizeAttenuation: true,
      }),
    );
    points.name = "distant-observation-field";
    points.userData.architectureTier = "balanced";
    this.root.add(points);
  }

  update(frame: ArchitectureFrame) {
    if (this.disposed) return;
    this.concept = frame.concept;
    this.quality = frame.quality;
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
    this.veilUniforms.uAWVeilTime.value = this.opticalClock;
    this.veilUniforms.uAWVeilFocus.value = focus;
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
        base.x + Math.sin(this.opticalClock * 0.037) * 0.009 * gain;
      group.rotation.y =
        base.y + Math.sin(this.opticalClock * 0.029) * 0.012 * gain;
      group.rotation.z = base.z + this.opticalClock * 0.0007 * gain;
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
      longitudinalRotationRadians: this.opticalClock * 0.0007,
      primaryRingRadiusWorldUnits: 21.5,
      revealAttenuationRange: [0.1, 1],
      revealKind: "spatial-procedural-light-attenuation",
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
