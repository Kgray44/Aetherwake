import * as THREE from "three";

export type InstrumentStudy = "optical" | "engineered" | "composite";
export type InstrumentKind = "conversation" | "research" | "note";
export interface InstrumentMaterialFrame {
  study: InstrumentStudy;
  kind: InstrumentKind;
  unfold: number;
  selected: boolean;
  emphasis?: number;
  quality: "cinematic" | "balanced" | "efficient";
  architectureWeight: number;
}
export interface InstrumentMaterialSet {
  face: THREE.MeshPhysicalMaterial;
  edge: THREE.MeshPhysicalMaterial;
  polish: THREE.MeshPhysicalMaterial;
  frame: THREE.MeshPhysicalMaterial;
  recess: THREE.MeshPhysicalMaterial;
  optics: THREE.MeshPhysicalMaterial;
  accent: THREE.MeshPhysicalMaterial;
}

const PROFILES = {
  optical: {
    face: 0x0c0a16,
    roughness: 0.15,
    metalness: 0.07,
    coat: 1,
    reflection: 0.32,
    frame: 0x171322,
    frameRoughness: 0.14,
    frameMetalness: 0.07,
  },
  engineered: {
    face: 0x121820,
    roughness: 0.54,
    metalness: 0.72,
    coat: 0.22,
    reflection: 0.25,
    frame: 0x293440,
    frameRoughness: 0.54,
    frameMetalness: 0.84,
  },
  composite: {
    face: 0x111321,
    roughness: 0.23,
    metalness: 0.12,
    coat: 0.98,
    reflection: 0.3,
    frame: 0x151c29,
    frameRoughness: 0.2,
    frameMetalness: 0.12,
  },
} as const;

const faceGlareProtection = new WeakMap<
  THREE.MeshPhysicalMaterial,
  { value: number }
>();

/** Keep bright studio reflections from whitening a content-bearing glass face.
 * The shoulder acts on the completed physical lighting, including clearcoat:
 * dark shading is unchanged and brighter shading keeps its hue and ordering.
 * It covers the continuous face, never a rectangle behind individual text.
 * The separate bevel, perimeter optics and environmental lights stay intact. */
function protectFaceHighlights(face: THREE.MeshPhysicalMaterial) {
  const protection = { value: 1 };
  faceGlareProtection.set(face, protection);
  const originalCompile = face.onBeforeCompile;
  const originalKey = face.customProgramCacheKey();
  face.onBeforeCompile = (shader, renderer) => {
    originalCompile.call(face, shader, renderer);
    shader.uniforms.uFaceGlareProtection = protection;
    shader.fragmentShader =
      "uniform float uFaceGlareProtection;\n" +
      shader.fragmentShader.replace(
        "#include <opaque_fragment>",
        `
        float facePeak = max(outgoingLight.r, max(outgoingLight.g, outgoingLight.b));
        if (uFaceGlareProtection > 0.5 && facePeak > 0.025) {
          float faceExcess = facePeak - 0.025;
          float faceShoulder = 0.025 + 0.04 * faceExcess / (0.04 + faceExcess);
          outgoingLight *= faceShoulder / facePeak;
        }
        #include <opaque_fragment>`,
      );
  };
  face.customProgramCacheKey = () => `${originalKey}:aerynth-face-glare-v1`;
}

/** Seven caller-owned materials are allocated once per canonical resource.
 * Optical glass here means an opaque dark substrate with an optical coat and
 * a separate translucent perimeter seat, not unqualified volumetric refraction. */
export function createInstrumentMaterials(): InstrumentMaterialSet {
  const opaque = () =>
    new THREE.MeshPhysicalMaterial({
      color: 0x0b1018,
      roughness: 0.4,
      metalness: 0.4,
      clearcoat: 0.4,
      clearcoatRoughness: 0.2,
      specularIntensity: 0.8,
      envMapIntensity: 0.3,
      transparent: true,
      opacity: 1,
      depthWrite: true,
    });
  const materials = {
    face: opaque(),
    edge: opaque(),
    polish: opaque(),
    frame: opaque(),
    recess: opaque(),
    optics: opaque(),
    accent: opaque(),
  };
  protectFaceHighlights(materials.face);
  materials.optics.transparent = true;
  materials.optics.depthWrite = false;
  updateInstrumentMaterials(materials, {
    study: "optical",
    kind: "conversation",
    unfold: 0,
    selected: false,
    quality: "balanced",
    architectureWeight: 1,
  });
  return materials;
}

export function updateInstrumentMaterials(
  materials: InstrumentMaterialSet,
  input: InstrumentMaterialFrame,
) {
  const profile = PROFILES[input.study];
  const unfold = THREE.MathUtils.clamp(input.unfold, 0, 1);
  const reading = unfold * unfold;
  const note = input.kind === "note";
  const lens = input.kind === "research";
  const glass = input.study !== "engineered";
  const efficient = input.quality === "efficient";
  const architecture = THREE.MathUtils.clamp(input.architectureWeight, 0, 1);
  const emphasis = Number.isFinite(input.emphasis)
    ? THREE.MathUtils.clamp(input.emphasis!, 0, 1)
    : 0;
  const reflection =
    profile.reflection *
    (1 - reading * 0.6) *
    (efficient ? 0.65 : 1) *
    (1.1 - architecture * 0.1) *
    (1 + emphasis * 0.1);
  const face = materials.face;
  const protection = faceGlareProtection.get(face);
  if (protection) protection.value = glass ? 1 : 0;
  face.color.setHex(note ? (glass ? 0x101019 : 0x101419) : profile.face);
  face.roughness = THREE.MathUtils.lerp(
    note
      ? glass
        ? 0.21
        : 0.72
      : lens && input.study === "optical"
        ? 0.13
        : profile.roughness,
    glass ? (note ? 0.28 : 0.26) : note ? 0.82 : 0.62,
    reading,
  );
  face.metalness = note
    ? glass
      ? 0.08
      : 0.22
    : profile.metalness * (1 - reading * 0.3);
  face.clearcoat =
    (note ? (glass ? 1 : 0.16) : profile.coat) *
    (1 - reading * (glass ? 0.2 : 0.68));
  face.clearcoatRoughness =
    (glass ? (lens ? 0.12 : 0.15) : 0.23) + reading * (glass ? 0.05 : 0.22);
  face.specularIntensity =
    (glass ? 1 : note ? 0.38 : 0.88) - reading * (glass ? 0.1 : 0.3);
  face.envMapIntensity = reflection;
  face.ior = 1.48;
  face.opacity = 1;
  face.emissive.setHex(input.study === "composite" ? 0x17323e : 0x000000);
  face.emissiveIntensity =
    input.study === "composite" ? 0.028 * (1 - reading) : 0;

  for (const material of [materials.edge, materials.frame]) {
    material.color.setHex(profile.frame);
    material.metalness = profile.frameMetalness;
    material.roughness =
      profile.frameRoughness + reading * (glass ? 0.06 : 0.15);
    material.clearcoat = glass ? 1 : 0.16;
    material.clearcoatRoughness =
      (glass ? 0.12 : 0.26) + reading * (glass ? 0.06 : 0.16);
    material.specularIntensity = glass ? 1 : 0.8;
    material.ior = 1.5;
    // Wide housing faces must remain graphite under the shared stellar key;
    // the actual cambered bevel supplies selective reflections, not a uniform
    // bright ring from the studio environment's large reflection panels.
    material.envMapIntensity =
      reflection * (input.study === "engineered" ? 0.5 : 0.72) * 0.95;
    material.emissiveIntensity = 0;
    material.opacity = glass
      ? THREE.MathUtils.lerp(
          input.study === "optical" ? 0.58 : 0.72,
          1,
          reading,
        )
      : 1;
    material.depthWrite = !glass;
  }
  materials.polish.color.setHex(glass ? 0x29243a : note ? 0x786e5c : 0x788998);
  materials.polish.metalness = glass ? 0.08 : 0.93;
  materials.polish.roughness =
    (glass ? 0.12 : 0.24) + reading * (glass ? 0.06 : 0.18);
  materials.polish.clearcoat = glass ? 1 : 0.4;
  materials.polish.envMapIntensity = reflection * 0.85;
  materials.polish.emissiveIntensity = 0;
  materials.polish.opacity = glass ? 0.6 + reading * 0.4 : 1;
  materials.polish.depthWrite = !glass;

  materials.recess.color.setHex(0x02060b);
  materials.recess.metalness = 0.46;
  materials.recess.roughness = 0.76;
  materials.recess.clearcoat = 0.08;
  materials.recess.envMapIntensity = 0.1;
  materials.recess.opacity = 1;
  materials.recess.emissiveIntensity = 0;

  materials.optics.color.setHex(
    input.study === "composite"
      ? 0x172332
      : input.study === "optical"
        ? 0x20172f
        : 0x15202c,
  );
  materials.optics.metalness = input.study === "engineered" ? 0.54 : 0.05;
  materials.optics.roughness =
    (input.study === "optical" ? 0.11 : 0.24) + reading * 0.2;
  materials.optics.clearcoat = 0.96;
  materials.optics.clearcoatRoughness = 0.14 + reading * 0.18;
  materials.optics.envMapIntensity = reflection * 1.35;
  materials.optics.opacity =
    input.study === "optical"
      ? 0.52
      : input.study === "engineered"
        ? 0.35
        : 0.78;
  materials.optics.emissive.setHex(0x1a4658);
  materials.optics.emissiveIntensity =
    input.study === "composite" ? 0.04 * (1 - reading) : 0;

  materials.accent.color.setHex(
    note ? 0x8b7960 : input.study === "composite" ? 0x5e8490 : 0x8998a3,
  );
  materials.accent.metalness = glass ? 0.12 : note ? 0.8 : 0.88;
  materials.accent.roughness = note ? 0.36 : 0.26;
  materials.accent.clearcoat = glass ? 0.9 : 0.3;
  materials.accent.envMapIntensity = reflection;
  materials.accent.emissive.setHex(note ? 0x5f4526 : 0x2d7189);
  materials.accent.emissiveIntensity =
    input.study === "composite" ? (0.07 + emphasis * 0.05) * (1 - reading) : 0;
  materials.accent.opacity = glass ? 0.68 + reading * 0.32 : 1;
  materials.accent.depthWrite = !glass;
}

const sourcePosition = new THREE.Vector3();
const sourceTarget = new THREE.Vector3();
/** Mirror the architecture's actual world-space key direction/color into the
 * independent foreground scene, with material-appropriate irradiance. Never
 * change the approved architectural source or introduce a scanning highlight. */
export function mirrorDirectionalKey(
  source: THREE.DirectionalLight,
  destination: THREE.DirectionalLight,
  gain: number,
) {
  source.updateWorldMatrix(true, false);
  source.target.updateWorldMatrix(true, false);
  source.getWorldPosition(sourcePosition);
  source.target.getWorldPosition(sourceTarget);
  destination.position
    .copy(sourcePosition)
    .sub(sourceTarget)
    .normalize()
    .multiplyScalar(20);
  destination.target.position.set(0, 0, 0);
  destination.color.copy(source.color);
  destination.intensity = source.intensity * Math.max(0, gain);
}
