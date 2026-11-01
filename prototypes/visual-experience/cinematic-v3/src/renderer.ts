import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import {
  OrbitalArchitecture,
  type ArchitectureConcept,
} from "./orbital-architecture.ts";
import type { SceneWeights } from "./scene-transition";
import {
  CelestialEnvironment,
  type CelestialStudy,
} from "./celestial-environment.ts";
import { InstrumentStructure } from "./instrument-geometry.ts";
import {
  createInstrumentMaterials,
  updateInstrumentMaterials,
  mirrorDirectionalKey,
  type InstrumentMaterialSet,
  type InstrumentStudy,
} from "./instrument-materials.ts";

export type Study = "architecture" | "living" | "observatory";
export type Quality = "cinematic" | "balanced" | "efficient";
export type VelaState =
  | "idle"
  | "receiving"
  | "working"
  | "coordinating"
  | "attention"
  | "reported"
  | "verified"
  | "unavailable";

export interface SurfacePose {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  lift: number;
  yaw: number;
  selected: boolean;
  unfold: number;
  opacity?: number;
  kind?: "conversation" | "research" | "note";
}

export interface PresenceBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface EnvironmentFrame {
  time: number;
  focus: number;
  attention: number;
  pointer: { x: number; y: number };
  /** Real input, separate from the shared resource/semantic anchor in pointer. */
  inputPointer?: { x: number; y: number };
  /** Local interaction salience, e.g. dragging=1 or selected=.25. */
  interaction?: number;
  vela: VelaState;
  study: Study;
  sceneWeights?: SceneWeights;
  architectureConcept?: ArchitectureConcept;
  celestialStudy?: CelestialStudy;
  instrumentStudy?: InstrumentStudy;
  architecturePhase?: number | null;
  quality: Quality;
  reduced: boolean;
  ambientStrength?: number;
  width: number;
  height: number;
  surfaces?: readonly SurfacePose[];
}

// Openness, structural tension, directed flow. These are expression studies,
// never measurements of cognition, progress, or unrecorded agent relationships.
const EXPRESSIONS: Readonly<
  Record<VelaState, readonly [number, number, number]>
> = {
  idle: [0, 0, 0],
  receiving: [1, -0.2, 0],
  working: [0.12, 1, 1],
  coordinating: [0.65, 0.35, 0.65],
  attention: [0.2, 0.75, 0],
  reported: [-0.15, 0.3, 0],
  verified: [0.25, 0, 0],
  unavailable: [0, 0, 0],
};

interface FolioVisual {
  id: string | null;
  root: THREE.Group;
  slab: THREE.BufferGeometry;
  rim: THREE.BufferGeometry;
  rimMesh: THREE.Mesh;
  face: THREE.MeshPhysicalMaterial;
  edge: THREE.MeshPhysicalMaterial;
  polish: THREE.MeshPhysicalMaterial;
  materials: InstrumentMaterialSet;
  structure: InstrumentStructure;
  contact: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  width: number;
  height: number;
  unfold: number;
  kind: NonNullable<SurfacePose["kind"]>;
}

const ribbonVertex = /* glsl */ `
  uniform float uTime, uEnergy, uAmbient;
  uniform vec4 uExpression;
  varying vec3 vNormal, vView, vTangent;
  varying float vAcross, vAlong;
  vec3 surface(float t, float section) {
    // Ambient expression has its own gain; idle semantic energy never gates it.
    float ambient = sin(uTime * .56);
    // One continuous asymmetrical double-loop. Its central crossing is separated in Z.
    vec3 center = vec3(1.13 * sin(2. * t) * (.88 + .12 * cos(t)), 1.18 * cos(t) + .12 * sin(3. * t), .5 * sin(t));
    center *= 1. + ambient * .03 * uAmbient;
    center.x *= 1. + uExpression.x * .065;
    center.y *= 1. + uExpression.y * .035;
    center *= 1. + uExpression.w * .025;
    // Differentiate the deformed centerline, rather than the undeformed seed.
    // Its transported frame therefore stays tangent during breathing and expression.
    vec3 derivative = vec3(2.26 * cos(2. * t) * (.88 + .12 * cos(t)) - .1356 * sin(2. * t) * sin(t), -1.18 * sin(t) + .36 * cos(3. * t), .5 * cos(t));
    derivative *= 1. + ambient * .03 * uAmbient;
    derivative.x *= 1. + uExpression.x * .065;
    derivative.y *= 1. + uExpression.y * .035;
    derivative *= 1. + uExpression.w * .025;
    derivative.z += .036 * cos(t * 3.) + .195 * cos(t * 3. + uTime * .62) * uAmbient;
    vec3 tangent = normalize(derivative);
    vec3 normal = normalize(cross(tangent, vec3(0., 0., 1.)));
    vec3 binormal = normalize(cross(tangent, normal));
    float directed = sin(t * 2. - uTime * 1.1) * uExpression.z;
    float twist = t + .31 * sin(t * 2.) + .12 * sin(t * 3.) + sin(t * 2. + uTime * .62) * .1 * uAmbient;
    twist += uExpression.y * sin(t * 2.) * .045 + directed * .045;
    vec3 across = normal * cos(twist) + binormal * sin(twist);
    float width = (.235 + .095 * cos(t * 2. - .6)) * (1. + sin(uTime * .64 + t * 2.) * .1 * uAmbient);
    width *= 1. - uExpression.y * .045 + uExpression.x * .025 + uExpression.w * .04;
    center.z += sin(t * 3.) * .012 + sin(t * 3. + uTime * .62) * .065 * uAmbient;
    // A closed, thin elliptical skin supplies real edge thickness while keeping
    // the broad folded-ribbon silhouette. Both seams are periodic.
    float v = cos(section);
    vec3 skinNormal = normalize(cross(tangent, across));
    return center + across * v * width + binormal * v * v * .055
      + skinNormal * sin(section) * .014;
  }
  void main() {
    float t = position.x;
    float section = position.y;
    vec3 p = surface(t, section);
    // Symmetric differences avoid a directional normal bias at the closed join
    // and remain valid on both faces and the small rounded sidewalls.
    vec3 dt = surface(t + .002, section) - surface(t - .002, section);
    vec3 dv = surface(t, section + .004) - surface(t, section - .004);
    vec3 n = normalize(cross(dv, dt));
    vec4 view = modelViewMatrix * vec4(p, 1.);
    vNormal = normalize(normalMatrix * n);
    vView = -view.xyz;
    vTangent = normalize(normalMatrix * dt);
    vAcross = cos(section);
    vAlong = t;
    gl_Position = projectionMatrix * view;
  }
`;

const ribbonFragment = /* glsl */ `
  uniform float uEnergy, uTime, uUnavailable;
  uniform vec3 uTint, uSceneLight;
  varying vec3 vNormal, vView, vTangent;
  varying float vAcross, vAlong;
  void main() {
    vec3 n = normalize(vNormal);
    vec3 view = normalize(vView);
    float facing = clamp(abs(dot(n, view)), 0., 1.);
    float fresnel = .055 + .945 * pow(1. - facing, 5.);
    vec3 light = normalize(mix(normalize(vec3(-.7, 1.2, 1.)), uSceneLight, .32));
    float diffuse = max(0., dot(n, light));
    vec3 halfVector = normalize(light + view);
    // The closed skin can be subpixel at a grazing fold. Broaden and reduce
    // the sharp lobe when the normal changes rapidly across a pixel, instead
    // of letting individual sidewall facets sparkle as the ribbon moves.
    vec3 normalDx = dFdx(n), normalDy = dFdy(n);
    float normalVariance = max(dot(normalDx, normalDx), dot(normalDy, normalDy));
    float specularPower = clamp(96. / (1. + normalVariance * 80.), 12., 96.);
    float spec = pow(max(0., dot(n, halfVector)), specularPower) * (specularPower / 96.);
    float broad = pow(max(0., dot(n, normalize(vec3(.8, .5, .5) + view))), 18.);
    // Directional pearl lobe follows the ribbon instead of a screen-space stripe.
    float grain = 1. - pow(abs(dot(normalize(vTangent), halfVector)), 2.);
    float silk = pow(max(0., dot(n, halfVector)), 26.) * grain;
    float edge = smoothstep(.94, 1., abs(vAcross));
    float rim = pow(max(0., dot(n, normalize(vec3(-.9, -.1, .5)))), 16.);
    vec3 body = mix(vec3(.015, .011, .041), uTint * .32, diffuse * .48 + broad * .21);
    body *= .88 + .12 * abs(vAcross);
    vec3 pearl = vec3(.74, .72, 1.);
    vec3 optical = mix(vec3(.35,.28,.55), vec3(.39,.48,.59), pow(1. - facing, 2.));
    vec3 color = body + pearl * (spec * .86 + broad * .27 + silk * .15 + fresnel * .19 + rim * .24);
    color += optical * fresnel * .13 + pearl * edge * diffuse * .045;
    color += uTint * uEnergy * (.035 + .045 * sin(vAlong * 2. - uTime * .5));
    color = mix(color, vec3(dot(color, vec3(.2126,.7152,.0722))) * .43, uUnavailable);
    gl_FragColor = vec4(color, 1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const fieldVertex = /* glsl */ `
  uniform float uTime, uFocus, uEnergy, uSelectionStrength, uInteraction;
  uniform vec2 uPointer, uSelection, uSelectionSize, uFlow;
  attribute float aLayer;
  varying float vLayer, vDistance, vSignal;
  void main() {
    vec3 p = position;
    float wave = sin(p.x * .22 + aLayer * .24 + uTime * .35);
    float influence = exp(-pow((p.x - uPointer.x * 7.) * .3, 2.));
    vec2 local = (p.xz - uSelection) / uSelectionSize;
    float selection = exp(-dot(local,local)) * uSelectionStrength;
    p.y += wave * .055 * (1. - uFocus * .8) + influence * .09 * uEnergy;
    p.z += influence * uPointer.y * .16;
    p.y += selection * (.065 + uInteraction * .055) * (1. - uFocus * .6);
    p.xz += uFlow * selection * .035 * (1. - uFocus * .8);
    vLayer = aLayer;
    vSignal = max(influence, selection);
    vec4 view = modelViewMatrix * vec4(p, 1.);
    vDistance = -view.z;
    gl_Position = projectionMatrix * view;
  }
`;

const fieldFragment = /* glsl */ `
  uniform float uFocus, uEnergy, uDetail, uEnvironmentWeight;
  varying float vLayer, vDistance, vSignal;
  void main() {
    if(vLayer > uDetail) discard;
    float fog = exp(-vDistance * .055);
    float alpha = (.065 + vSignal * .06 * uEnergy) * fog * (1. - uFocus * .82);
    vec3 c = mix(vec3(.22,.21,.45), vec3(.47,.51,.77), vSignal * .65);
    gl_FragColor = vec4(c, alpha * uEnvironmentWeight);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const livingVertex = /* glsl */ `
  uniform float uTime, uFocus, uEnergy, uSelectionStrength, uInteraction;
  uniform vec2 uPointer, uSelection, uSelectionSize, uFlow;
  varying vec3 vPos, vWorld;
  varying float vRise, vSelection;
  void main() {
    vec3 p = position;
    // Related low-frequency waves share a timebase; interaction bends this same
    // surface instead of switching it to a separate ripple animation.
    float wave = sin(p.x * .28 + uTime * .27) * cos(p.z * .2 - uTime * .16);
    wave += sin(p.x * .17 - p.z * .13 + uTime * .11) * .18;
    float influence = exp(-length(p.xz - uPointer * 6.) * .22);
    vec2 local = ((modelMatrix * vec4(p,1.)).xz - uSelection) / uSelectionSize;
    float selection = exp(-dot(local,local)) * uSelectionStrength;
    p.y = wave * 1.08 + influence * (.3 + uEnergy * .25) - uFocus * .4;
    float pressure = .15 + uInteraction * .14;
    float wake = dot(local, uFlow) * .045 * uInteraction;
    p.y += selection * (pressure + wake) * (1. - uFocus * .7);
    p.xz += uFlow * selection * .055 * (1. - uFocus * .8);
    vPos = p;
    vWorld = (modelMatrix * vec4(p,1.)).xyz;
    vRise = wave;
    vSelection = selection;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.);
  }
`;

const livingFragment = /* glsl */ `
  uniform float uFocus;
  uniform vec3 uSceneLight, uSceneTint;
  varying vec3 vPos, vWorld;
  varying float vRise, vSelection;
  void main() {
    vec3 dx = dFdx(vWorld), dy = dFdy(vWorld);
    vec3 n = normalize(cross(dx, dy));
    if (n.y < 0.) n = -n;
    vec3 lightDirection = normalize(uSceneLight);
    float light = pow(max(0., dot(n, lightDirection)), 3.);
    // Broad ceramic reflection reveals curvature. Fine contours remain dim
    // and derivative filtered so their frequency does not dominate the field.
    vec3 view = normalize(cameraPosition - vWorld);
    vec3 halfVector = normalize(lightDirection + view);
    float reflection = pow(max(0., dot(n, halfVector)), 32.);
    float fresnel = pow(1. - max(0., dot(n, view)), 3.);
    float phase = vPos.y * 13. + vPos.z * .18;
    float filterWidth = max(fwidth(phase), .001);
    float contour = pow(.5 + .5 * sin(phase), 18.) / (1. + filterWidth * 1.5);
    float fade = exp(-length(vPos.xz) * .065) * (1. - uFocus * .7);
    vec3 c = vec3(.022,.014,.061) + vec3(.105,.066,.25) * light;
    c += vec3(.29,.25,.45) * (reflection * .21 + fresnel * .055 + contour * .12);
    c += uSceneTint * vSelection * .035;
    gl_FragColor = vec4(c, fade * .69);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const contactVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.);
  }
`;
const contactFragment = /* glsl */ `
  uniform vec2 uSize, uRect;
  uniform float uLift, uSelected, uEnergy, uOpacity, uRound;
  uniform vec3 uSceneTint;
  varying vec2 vUv;
  void main() {
    vec2 p = (vUv - .5) * uSize;
    vec2 q = abs(p) - uRect * .5 + vec2(12.);
    float rectangle = length(max(q, 0.)) + min(max(q.x,q.y),0.) - 12.;
    float ellipse = (length(p / (uRect * .5)) - 1.) * min(uRect.x,uRect.y) * .5;
    float distance = mix(rectangle, ellipse, uRound);
    float softness = 14. + uLift * .35;
    float shadow = exp(-max(distance,0.) / softness) * (.28 - min(uLift,60.) * .0012);
    float ground = exp(-pow((p.y + uRect.y * .46 + 9.) / (18. + uLift * .18),2.)) * exp(-pow(p.x / (uRect.x * .65),2.));
    float light = ground * (.12 + uSelected * .13 + uEnergy * .045);
    vec3 color = uSceneTint * .27 * light;
    float alpha = max(shadow, light * .7) * uOpacity;
    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** A procedural GPU stage. Scheduling and semantic truth remain in the caller. */
export class Environment {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  // The middle depth region has its own fixed lights. Foreground studio lights
  // continue serving Vela/resources without washing out architectural shadows.
  private readonly architecturalScene = new THREE.Scene();
  private readonly cosmos = new CelestialEnvironment();
  private readonly camera = new THREE.PerspectiveCamera(39, 1, 0.1, 100);
  private readonly architecture = new THREE.Group();
  private readonly living = new THREE.Group();
  private readonly observatory = new THREE.Group();
  private readonly vela = new THREE.Group();
  private readonly ribbons: THREE.Mesh<
    THREE.BufferGeometry,
    THREE.ShaderMaterial
  >[] = [];
  private readonly ribbonLevels: THREE.BufferGeometry[] = [];
  private readonly orbital = new OrbitalArchitecture();
  private readonly stellarKey = new THREE.DirectionalLight(0xdce8ff, 4.6);
  private readonly stellarAmbient = new THREE.HemisphereLight(
    0xa9b8d3,
    0x070812,
    0.18,
  );
  private readonly architecturalGraze = new THREE.SpotLight(
    0xb9b4d0,
    250,
    48,
    0.4,
    0.85,
    2,
  );
  private shadowResolution = 0;
  private celestialStudy: CelestialStudy = "starlit";
  private readonly sceneFades = new Map<
    Study,
    {
      uniform: { value: number };
      materials: { material: THREE.Material; depthWrite: boolean }[];
      lights: { light: THREE.Light; intensity: number }[];
    }
  >();
  private readonly folios: FolioVisual[] = [];
  private readonly folioById = new Map<string, FolioVisual>();
  private readonly surfaceProjection = new THREE.Matrix4();
  private readonly surfaceRotation = new THREE.Matrix4();
  private readonly surfaceWorld = new THREE.Matrix4();
  private readonly contactScale = new THREE.Vector3();
  private readonly foregroundAmbient = new THREE.HemisphereLight(
    0xa7b7ff,
    0x020207,
    1.6,
  );
  private readonly foregroundKey = new THREE.DirectionalLight(0xd9d6ff, 3.5);
  private readonly foregroundViolet = new THREE.DirectionalLight(0x7561eb, 2.3);
  private readonly instrumentKey = new THREE.DirectionalLight(0xdce8ff, 0);
  private instrumentStudy: InstrumentStudy = "optical";
  private readonly projectedPresence: PresenceBounds = {
    x: 0,
    y: 0,
    w: 0,
    h: 0,
  };
  private readonly presencePoint = new THREE.Vector3();
  private presenceEnvelopeGain = 0;
  private readonly expression = new THREE.Vector4();
  private expressionState: VelaState = "idle";
  private expressionEnteredAt = 0;
  private readonly selectionRay = new THREE.Vector3();
  private readonly selectedWorld = new THREE.Vector3();
  private readonly lightTarget = new THREE.Vector3();
  private readonly ribbonLightDirection = new THREE.Vector3(
    -0.4,
    0.7,
    0.6,
  ).normalize();
  private readonly fieldLightDirection = new THREE.Vector3(
    -0.42,
    0.82,
    0.48,
  ).normalize();
  private readonly sceneMaterialTint = new THREE.Color(0x8c7cdb);
  private readonly fieldUniforms = {
    uTime: { value: 0 },
    uFocus: { value: 0 },
    uEnergy: { value: 0.3 },
    uPointer: { value: new THREE.Vector2() },
    uSelection: { value: new THREE.Vector2() },
    uSelectionSize: { value: new THREE.Vector2(3.8, 4.5) },
    uFlow: { value: new THREE.Vector2() },
    uSelectionStrength: { value: 0 },
    uInteraction: { value: 0 },
    uDetail: { value: 30 },
    uEnvironmentWeight: { value: 1 },
  };
  private readonly livingUniforms = {
    uTime: this.fieldUniforms.uTime,
    uFocus: this.fieldUniforms.uFocus,
    uEnergy: this.fieldUniforms.uEnergy,
    uPointer: this.fieldUniforms.uPointer,
    uSelection: this.fieldUniforms.uSelection,
    uSelectionSize: this.fieldUniforms.uSelectionSize,
    uFlow: this.fieldUniforms.uFlow,
    uSelectionStrength: this.fieldUniforms.uSelectionStrength,
    uInteraction: this.fieldUniforms.uInteraction,
    uSceneLight: { value: this.fieldLightDirection },
    uSceneTint: { value: this.sceneMaterialTint },
  };
  private readonly environmentMap: THREE.WebGLRenderTarget;
  private readonly fill: THREE.PointLight;
  private readonly detail: THREE.Group = new THREE.Group();
  private quality: Quality = "balanced";
  private study: Study = "architecture";
  private width = 0;
  private height = 0;
  private pixelRatio = 0;
  private frames = 0;
  private previousTime = 0;
  private semanticEnergy = 0.22;
  private readonly semanticTint = new THREE.Color(0x8c7cdb);
  private readonly targetTint = new THREE.Color(0x8c7cdb);
  private lost = false;
  private disposed = false;
  private readonly onContextLost = () => {
    this.lost = true;
  };
  private readonly onContextRestored = () => {
    this.lost = false;
  };

  constructor(private readonly canvas: HTMLCanvasElement) {
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: false,
        powerPreference: "low-power",
      });
    } catch (error) {
      throw new Error(
        `Aerynth GPU environment could not initialize WebGL2: ${String(error)}`,
      );
    }
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.autoClear = false;
    this.renderer.info.autoReset = false;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setClearColor(0x05060d, 1);
    this.scene.fog = new THREE.FogExp2(0x05060d, 0.024);
    this.camera.position.set(0, 1.8, 12);
    this.camera.lookAt(0, 0.35, 0);

    // Procedural studio reflection: no downloaded imagery or asynchronous asset dependency.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const studio = new RoomEnvironment();
    this.environmentMap = pmrem.fromScene(studio, 0.055);
    this.scene.environment = this.environmentMap.texture;
    this.architecturalScene.environment = this.environmentMap.texture;
    this.architecturalScene.fog = new THREE.FogExp2(0x050711, 0.009);
    studio.dispose();
    pmrem.dispose();
    this.foregroundKey.position.set(-5, 8, 6);
    this.foregroundViolet.position.set(7, 1, -3);
    this.scene.add(
      this.foregroundAmbient,
      this.foregroundKey,
      this.foregroundViolet,
      this.instrumentKey,
      this.instrumentKey.target,
    );
    this.fill = new THREE.PointLight(0x8d7bff, 22, 18, 2);
    this.fill.position.set(1.3, 1.5, 2);
    this.scene.add(this.fill);
    this.scene.add(this.living, this.observatory, this.vela, this.detail);
    this.architecturalScene.add(this.architecture);
    this.buildArchitecture();
    this.buildLiving();
    this.buildObservatory();
    this.buildVela();
    this.buildField();
    this.buildFolios();
    this.prepareSceneFades();
    canvas.addEventListener("webglcontextlost", this.onContextLost);
    canvas.addEventListener("webglcontextrestored", this.onContextRestored);
  }

  private prepareSceneFades() {
    for (const [name, group] of [
      ["architecture", this.architecture],
      ["living", this.living],
      ["observatory", this.observatory],
    ] as const) {
      const uniform = { value: name === "architecture" ? 1 : 0 };
      const materials = new Map<THREE.Material, boolean>();
      const lights: { light: THREE.Light; intensity: number }[] = [];
      group.traverse((object) => {
        if (object instanceof THREE.Light)
          lights.push({ light: object, intensity: object.intensity });
        const item = object as THREE.Mesh;
        if (!item.material) return;
        for (const material of Array.isArray(item.material)
          ? item.material
          : [item.material]) {
          if (materials.has(material)) continue;
          materials.set(material, material.depthWrite);
          material.transparent = true;
          if (material instanceof THREE.ShaderMaterial) {
            material.uniforms.uEnvironmentWeight = uniform;
            material.fragmentShader =
              "uniform float uEnvironmentWeight;\n" +
              material.fragmentShader.replace(
                "#include <tonemapping_fragment>",
                "gl_FragColor.a *= uEnvironmentWeight;\n#include <tonemapping_fragment>",
              );
          } else {
            const originalCompile = material.onBeforeCompile;
            const originalKey = material.customProgramCacheKey();
            material.onBeforeCompile = (shader, renderer) => {
              originalCompile.call(material, shader, renderer);
              shader.uniforms.uEnvironmentWeight = uniform;
              shader.fragmentShader =
                "uniform float uEnvironmentWeight;\n" +
                shader.fragmentShader.replace(
                  "#include <tonemapping_fragment>",
                  "gl_FragColor.a *= uEnvironmentWeight;\n#include <tonemapping_fragment>",
                );
            };
            material.customProgramCacheKey = () =>
              `${originalKey}:aerynth-scene-fade-v1`;
          }
        }
      });
      this.sceneFades.set(name, {
        uniform,
        lights,
        materials: [...materials].map(([material, depthWrite]) => ({
          material,
          depthWrite,
        })),
      });
    }
  }

  private updateSceneFades(frame: EnvironmentFrame) {
    for (const [name, group] of [
      ["architecture", this.architecture],
      ["living", this.living],
      ["observatory", this.observatory],
    ] as const) {
      const weight =
        frame.sceneWeights?.[name] ?? (frame.study === name ? 1 : 0);
      const fade = this.sceneFades.get(name)!;
      fade.uniform.value = weight;
      group.visible = weight > 0.001;
      for (const item of fade.materials)
        item.material.depthWrite = item.depthWrite && weight > 0.999;
      for (const item of fade.lights)
        item.light.intensity = item.intensity * weight;
    }
  }

  private buildArchitecture() {
    this.architecture.add(this.orbital.root);
    const graze = this.architecturalGraze;
    graze.position.set(5, 5, -10);
    graze.target.position.set(-2.8, 2.4, -28);
    this.architecture.add(graze, graze.target);
    this.stellarKey.position.set(9, 8, 2);
    this.stellarKey.target.position.set(-3, 0, -25);
    this.stellarKey.castShadow = true;
    Object.assign(this.stellarKey.shadow.camera, {
      left: -15,
      right: 15,
      top: 20,
      bottom: -20,
      near: 0.5,
      far: 85,
    });
    this.stellarKey.shadow.camera.updateProjectionMatrix();
    this.stellarKey.shadow.bias = -0.00008;
    this.stellarKey.shadow.normalBias = 0.025;
    this.architecturalScene.add(
      this.stellarKey,
      this.stellarKey.target,
      this.stellarAmbient,
    );
  }

  private updateCelestialLighting(frame: EnvironmentFrame, focus: number) {
    const study = frame.celestialStudy ?? "starlit";
    this.celestialStudy = study;
    const weight =
      frame.sceneWeights?.architecture ??
      (frame.study === "architecture" ? 1 : 0);
    const recession = 1 - focus * 0.66;
    // Each study uses fixed world-space sources. Only real geometry rotates;
    // no light scans, highlight masks or autonomous opacity modulation.
    if (study === "shadow") {
      this.stellarKey.position.set(-13, 10, -18);
      this.stellarKey.intensity = 3.8 * weight * recession;
      this.stellarAmbient.intensity = 0.06 * weight * recession;
      this.architecturalGraze.intensity = 480 * weight * recession;
    } else if (study === "deep") {
      this.stellarKey.position.set(-7, 12, -10);
      this.stellarKey.intensity = 3.2 * weight * recession;
      this.stellarAmbient.intensity = 0.25 * weight * recession;
      this.architecturalGraze.intensity = 240 * weight * recession;
    } else {
      this.stellarKey.position.set(-9, 10, -12);
      this.stellarKey.intensity = 3.6 * weight * recession;
      this.stellarAmbient.intensity = 0.18 * weight * recession;
      this.architecturalGraze.intensity = 320 * weight * recession;
    }
    const resolution =
      frame.quality === "cinematic"
        ? 2048
        : frame.quality === "balanced"
          ? 1024
          : 0;
    this.renderer.shadowMap.enabled = resolution > 0 && weight > 0.001;
    if (resolution > 0 && resolution !== this.shadowResolution) {
      this.stellarKey.shadow.map?.dispose();
      this.stellarKey.shadow.map = null;
      this.stellarKey.shadow.mapSize.set(resolution, resolution);
      this.shadowResolution = resolution;
      this.stellarKey.shadow.needsUpdate = true;
    }
  }

  private updateInstrumentLighting(frame: EnvironmentFrame) {
    const architectureWeight = THREE.MathUtils.clamp(
      frame.sceneWeights?.architecture ??
        (frame.study === "architecture" ? 1 : 0),
      0,
      1,
    );
    // Keep the approved background lights completely independent. Materials in
    // the foreground receive the same world-space source direction and color,
    // with lower irradiance appropriate to small near-field instruments.
    mirrorDirectionalKey(this.stellarKey, this.instrumentKey, 0.55);
    this.foregroundAmbient.intensity = 1.6 * (1 - architectureWeight * 0.87);
    this.foregroundKey.intensity = 3.5 * (1 - architectureWeight * 0.92);
    this.foregroundViolet.intensity = 2.3 * (1 - architectureWeight * 0.96);
    this.fill.intensity *= 1 - architectureWeight * 0.95;
  }

  private buildLiving() {
    const geometry = new THREE.PlaneGeometry(42, 30, 112, 80);
    geometry.rotateX(-Math.PI / 2);
    const sheet = new THREE.Mesh(
      geometry,
      new THREE.ShaderMaterial({
        uniforms: this.livingUniforms,
        vertexShader: livingVertex,
        fragmentShader: livingFragment,
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: false,
      }),
    );
    sheet.position.set(0, -2.8, -8);
    this.living.add(sheet);
    // A second, recessed contour layer gives the field material thickness.
    const under = sheet.clone();
    under.position.y -= 0.37;
    under.rotation.y = 0.12;
    this.living.add(under);
  }

  private buildObservatory() {
    const frame = new THREE.Group();
    frame.position.set(0.7, -0.75, -5);
    frame.rotation.set(1.08, -0.23, 0.12);
    for (let i = 0; i < 5; i++) {
      const radius = 3.9 + i * 0.56;
      const ring = this.curveLine(
        220,
        (t) =>
          new THREE.Vector3(
            Math.cos(t * Math.PI * 2) * radius,
            Math.sin(t * Math.PI * 2) * radius,
            0,
          ),
        0x827ca8,
        i === 0 ? 0.43 : 0.16,
      );
      frame.add(ring);
    }
    const ticks: number[] = [];
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      const r = i % 6 === 0 ? 6.3 : 6.45;
      ticks.push(
        Math.cos(a) * r,
        Math.sin(a) * r,
        0,
        Math.cos(a) * 6.55,
        Math.sin(a) * 6.55,
        0,
      );
    }
    const tickGeometry = new THREE.BufferGeometry();
    tickGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(ticks, 3),
    );
    frame.add(
      new THREE.LineSegments(
        tickGeometry,
        new THREE.LineBasicMaterial({
          color: 0x8d89ac,
          transparent: true,
          opacity: 0.38,
        }),
      ),
    );
    this.observatory.add(frame);
    const meridian = new THREE.Mesh(
      new THREE.TorusGeometry(6.7, 0.045, 8, 160, Math.PI * 1.67),
      new THREE.MeshStandardMaterial({
        color: 0x3b3856,
        metalness: 0.7,
        roughness: 0.3,
      }),
    );
    meridian.position.set(0, 0.8, -10);
    meridian.rotation.set(0.2, -0.65, -0.35);
    this.observatory.add(meridian);
  }

  private buildVela() {
    for (const [along, across] of [
      [320, 20],
      [256, 16],
      [128, 12],
    ]) {
      const geometry = new THREE.PlaneGeometry(1, 1, along, across);
      const position = geometry.getAttribute("position");
      for (let j = 0; j < position.count; j++) {
        const t = (position.getX(j) + 0.5) * Math.PI * 2;
        const section = (position.getY(j) + 0.5) * Math.PI * 2;
        position.setXYZ(j, t, section, 0);
      }
      const indices = geometry.getIndex()!;
      // The closed cross-section uses the opposite outward winding to a plane.
      for (let j = 0; j < indices.count; j += 3) {
        const first = indices.getX(j);
        indices.setX(j, indices.getX(j + 2));
        indices.setX(j + 2, first);
      }
      // Bounds are procedural rather than the parameter-space geometry bounds.
      geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2.3);
      this.ribbonLevels.push(geometry);
    }
    // One closed broad ribbon keeps the two-loop identity. Its very thin
    // sidewalls replace a zero-thickness double-sided plane, without a second
    // independently moving companion surface or wirelike folded joins.
    {
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uEnergy: { value: 0.3 },
          uAmbient: { value: 1 },
          uExpression: { value: this.expression },
          uSceneLight: { value: this.ribbonLightDirection },
          uTint: { value: new THREE.Color(0x7067dc) },
          uUnavailable: { value: 0 },
        },
        vertexShader: ribbonVertex,
        fragmentShader: ribbonFragment,
        side: THREE.FrontSide,
      });
      const ribbon = new THREE.Mesh(this.ribbonLevels[1], material);
      this.ribbons.push(ribbon);
      this.vela.add(ribbon);
    }
    this.vela.position.set(1.35, 1.7, 0.1);
    this.vela.rotation.set(-0.18, -0.35, -0.13);
  }

  private buildField() {
    const positions: number[] = [],
      layers: number[] = [];
    for (let line = 0; line < 28; line++) {
      for (let i = 0; i < 120; i++) {
        for (let end = 0; end < 2; end++) {
          const t = (i + end) / 120;
          const a = -0.28 + t * Math.PI * 0.68;
          const radius = 7 + line * 0.58;
          const x = -5.2 + Math.cos(a) * radius;
          const z = -9 + Math.sin(a) * radius * 0.73;
          const y = -2.36 + Math.sin(t * Math.PI * 1.4 + line * 0.15) * 0.055;
          positions.push(x, y, z);
          layers.push(line);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setAttribute(
      "aLayer",
      new THREE.Float32BufferAttribute(layers, 1),
    );
    const material = new THREE.ShaderMaterial({
      uniforms: this.fieldUniforms,
      vertexShader: fieldVertex,
      fragmentShader: fieldFragment,
      transparent: true,
      depthWrite: false,
    });
    this.detail.add(new THREE.LineSegments(geometry, material));
  }

  private curveLine(
    segments: number,
    point: (t: number) => THREE.Vector3,
    color: number,
    opacity: number,
  ) {
    const vertices = Array.from({ length: segments + 1 }, (_, i) =>
      point(i / segments),
    );
    return new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(vertices),
      new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthWrite: false,
      }),
    );
  }

  private buildFolios() {
    // Exactly three persistent resources are supported by this isolated study.
    // Fixed buffers, materials, and identities survive every move/unfold/quality transition.
    for (let i = 0; i < 3; i++) {
      const root = new THREE.Group();
      root.matrixAutoUpdate = false;
      root.visible = false;
      const slab = this.folioGeometry(false);
      const rim = this.folioGeometry(true);
      const materials = createInstrumentMaterials();
      const { face, edge, polish } = materials;
      const structure = new InstrumentStructure(materials);
      const slabMesh = new THREE.Mesh(slab, [face, edge]);
      slabMesh.frustumCulled = false;
      slabMesh.renderOrder = 4;
      const rimMesh = new THREE.Mesh(rim, polish);
      rimMesh.frustumCulled = false;
      rimMesh.renderOrder = 4;
      root.add(slabMesh, rimMesh, structure.root);
      // Opaque dark backing precedes translucent glass laminate; central text
      // still sits over the fully opaque face. Explicit ordering is necessary
      // because these small perimeter meshes share the same object origin.
      structure.root.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.renderOrder =
          object.material === materials.recess
            ? 3
            : object.material === materials.optics
              ? 6
              : object.material === materials.accent
                ? 7
                : 5;
      });
      const contact = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.ShaderMaterial({
          uniforms: {
            uSize: { value: new THREE.Vector2() },
            uRect: { value: new THREE.Vector2() },
            uLift: { value: 0 },
            uSelected: { value: 0 },
            uEnergy: this.fieldUniforms.uEnergy,
            uSceneTint: { value: this.sceneMaterialTint },
            uOpacity: { value: 1 },
            uRound: { value: 0 },
          },
          vertexShader: contactVertex,
          fragmentShader: contactFragment,
          transparent: true,
          depthWrite: false,
        }),
      );
      contact.matrixAutoUpdate = false;
      contact.frustumCulled = false;
      contact.renderOrder = 2;
      contact.visible = false;
      this.scene.add(root, contact);
      this.folios.push({
        id: null,
        root,
        slab,
        rim,
        rimMesh,
        face,
        edge,
        polish,
        materials,
        structure,
        contact,
        width: 0,
        height: 0,
        unfold: -1,
        kind: "conversation",
      });
    }
  }

  /** Three front rings reveal shallow optical curvature above a fixed bevel/backing. */
  private folioGeometry(rimOnly: boolean) {
    const n = 32,
      rings = rimOnly ? 2 : 6;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array((n * rings + (rimOnly ? 0 : 2)) * 3);
    const normals = new Float32Array(positions.length);
    for (let ring = 0; ring < rings; ring++) {
      for (let j = 0; j < n; j++) {
        const angle = (Math.floor(j / 8) + (j % 8) / 8) * Math.PI * 0.5;
        const radial = rimOnly
          ? 0
          : ring < 3
            ? 0
            : ring === 3
              ? 0.78
              : ring === 4
                ? 0.98
                : 0.62;
        const z = rimOnly
          ? 1
          : Math.sqrt(1 - radial * radial) * (ring === 5 ? -1 : 1);
        const at = (ring * n + j) * 3;
        normals[at] = Math.cos(angle) * radial;
        normals[at + 1] = Math.sin(angle) * radial;
        normals[at + 2] = z;
      }
    }
    const indices: number[] = [];
    if (!rimOnly) {
      normals[n * rings * 3 + 2] = 1;
      normals[(n * rings + 1) * 3 + 2] = -1;
      for (let j = 0; j < n; j++)
        indices.push(n * rings, n * 2 + j, n * 2 + ((j + 1) % n));
      for (let ring = 0; ring < 2; ring++) {
        for (let j = 0; j < n; j++) {
          const next = (j + 1) % n,
            a = ring * n + j,
            b = ring * n + next,
            c = (ring + 1) * n + j,
            d = (ring + 1) * n + next;
          indices.push(a, b, c, b, d, c);
        }
      }
      geometry.addGroup(0, indices.length, 0);
    }
    const sideStart = indices.length;
    const sideRings = rimOnly ? [0, 1] : [0, 3, 4, 5];
    for (let ring = 0; ring < sideRings.length - 1; ring++) {
      for (let j = 0; j < n; j++) {
        const next = (j + 1) % n,
          a = sideRings[ring] * n + j,
          b = sideRings[ring] * n + next,
          c = sideRings[ring + 1] * n + j,
          d = sideRings[ring + 1] * n + next;
        if (rimOnly) indices.push(a, b, c, b, d, c);
        else indices.push(a, c, b, b, c, d);
      }
    }
    if (!rimOnly) {
      for (let j = 0; j < n; j++)
        indices.push(
          n * rings + 1,
          (rings - 1) * n + ((j + 1) % n),
          (rings - 1) * n + j,
        );
      geometry.addGroup(sideStart, indices.length - sideStart, 1);
    }
    geometry.setIndex(indices);
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage),
    );
    geometry.setAttribute(
      "normal",
      new THREE.BufferAttribute(normals, 3).setUsage(THREE.DynamicDrawUsage),
    );
    return geometry;
  }

  private shapeFolio(
    geometry: THREE.BufferGeometry,
    width: number,
    height: number,
    rimOnly: boolean,
    kind: NonNullable<SurfacePose["kind"]>,
    unfold: number,
  ) {
    const n = 32,
      rings = rimOnly ? 2 : 6;
    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    const normal = geometry.getAttribute("normal") as THREE.BufferAttribute;
    const dome =
      kind === "research"
        ? 12 * (1 - unfold) ** 2
        : kind === "conversation"
          ? 3.4 * (1 - unfold)
          : 0;
    for (let ring = 0; ring < rings; ring++) {
      const inset = rimOnly
        ? ring === 0
          ? 1.8
          : 2.65
        : ring < 3
          ? 1.8
          : ring === 5
            ? 2.5
            : 0;
      // The research face sits inside the physical housing. Keeping the old
      // full-radius opaque slab would conceal its real recessed optical seat,
      // even if the DOM veil outside the text was completely clear.
      const opticalInset =
        !rimOnly && kind === "research" ? 14.3 * (1 - unfold) : 0;
      const halfW = width * 0.5 + 5 - inset - opticalInset,
        halfH = height * 0.5 + 5 - inset - opticalInset;
      const z = rimOnly
        ? 0.22
        : ring < 3
          ? dome * (1 - (ring === 0 ? 1 : ring === 1 ? 0.66 : 0.33) ** 2)
          : ring === 3
            ? -1.4
            : ring === 4
              ? -6.5
              : -8;
      const faceScale =
        !rimOnly && ring < 3 ? (ring === 0 ? 1 : ring === 1 ? 0.66 : 0.33) : 1;
      for (let j = 0; j < n; j++) {
        const corner = Math.floor(j / 8);
        const angle = (corner + (j % 8) / 8) * Math.PI * 0.5;
        const baseCorner = kind === "research" ? 7 : corner === 0 ? 22 : 7;
        const radius = Math.max(2, baseCorner + 4 - inset);
        const round = kind === "research" ? 1 - unfold : 0;
        const radiusX = halfW * round + radius * (1 - round);
        const radiusY = halfH * round + radius * (1 - round);
        const centerX =
          (corner === 0 || corner === 3 ? 1 : -1) * (halfW - radiusX);
        const centerY = (corner < 2 ? 1 : -1) * (halfH - radiusY);
        const x = (centerX + Math.cos(angle) * radiusX) * faceScale;
        const y = (centerY + Math.sin(angle) * radiusY) * faceScale;
        position.setXYZ(ring * n + j, x, y, z);
        if (!rimOnly && ring < 3) {
          const nx = (2 * dome * x) / (halfW * halfW);
          const ny = (2 * dome * y) / (halfH * halfH);
          const reciprocal = 1 / Math.sqrt(nx * nx + ny * ny + 1);
          normal.setXYZ(
            ring * n + j,
            nx * reciprocal,
            ny * reciprocal,
            reciprocal,
          );
        }
      }
    }
    if (!rimOnly) {
      position.setXYZ(n * rings, 0, 0, dome);
      position.setXYZ(n * rings + 1, 0, 0, -8);
    }
    position.needsUpdate = true;
    normal.needsUpdate = true;
  }

  /** Match CSS perspective(1500px) around each folio's own center, including yaw and lift. */
  private surfaceMatrix(
    cx: number,
    cy: number,
    lift: number,
    yaw: number,
    baselineDepth: number,
  ) {
    const worldPerPixel =
      (2 *
        baselineDepth *
        Math.tan(THREE.MathUtils.degToRad(this.camera.fov * 0.5))) /
      this.height;
    const x = cx - this.width * 0.5,
      y = this.height * 0.5 - cy;
    const zScale = baselineDepth / 1500;
    const perspective = 1 - lift / 1500;
    // The Z shear keeps perspective-origin at the local resource center, exactly as CSS does.
    this.surfaceProjection.set(
      worldPerPixel,
      0,
      (-x * worldPerPixel) / 1500,
      x * worldPerPixel * perspective,
      0,
      worldPerPixel,
      (-y * worldPerPixel) / 1500,
      y * worldPerPixel * perspective,
      0,
      0,
      zScale,
      -baselineDepth * perspective,
      0,
      0,
      0,
      1,
    );
    this.surfaceRotation.makeRotationY(THREE.MathUtils.degToRad(yaw));
    this.surfaceWorld
      .multiplyMatrices(this.camera.matrixWorld, this.surfaceProjection)
      .multiply(this.surfaceRotation);
    return this.surfaceWorld;
  }

  private updateFolios(frame: EnvironmentFrame) {
    const surfaces = frame.surfaces;
    const quality = frame.quality;
    const study = frame.instrumentStudy ?? "optical";
    const architectureWeight =
      frame.sceneWeights?.architecture ??
      (frame.study === "architecture" ? 1 : 0);
    const livingWeight =
      frame.sceneWeights?.living ?? (frame.study === "living" ? 1 : 0);
    this.instrumentStudy = study;
    for (const visual of this.folios) {
      visual.root.visible = false;
      visual.contact.visible = false;
    }
    if (!surfaces) {
      if (this.canvas.dataset.materials !== "opaque")
        this.canvas.dataset.materials = "opaque";
      return;
    }
    for (let i = 0; i < Math.min(3, surfaces.length); i++) {
      const pose = surfaces[i];
      if (
        !Number.isFinite(pose.x) ||
        !Number.isFinite(pose.y) ||
        !Number.isFinite(pose.w) ||
        !Number.isFinite(pose.h) ||
        !Number.isFinite(pose.lift) ||
        !Number.isFinite(pose.yaw) ||
        pose.w <= 0 ||
        pose.h <= 0
      )
        continue;
      let visual = this.folioById.get(pose.id);
      if (!visual) {
        visual = this.folios.find((folio) => folio.id === null);
        if (!visual) continue;
        visual.id = pose.id;
        this.folioById.set(pose.id, visual);
      }
      visual.root.visible = true;
      visual.contact.visible = livingWeight > 0.001;
      const opacity = THREE.MathUtils.clamp(pose.opacity ?? 1, 0, 1);
      const kind = pose.kind ?? "conversation";
      const unfold = Number.isFinite(pose.unfold)
        ? THREE.MathUtils.clamp(pose.unfold, 0, 1)
        : 0;
      if (
        visual.width !== pose.w ||
        visual.height !== pose.h ||
        visual.unfold !== unfold ||
        visual.kind !== kind
      ) {
        this.shapeFolio(visual.slab, pose.w, pose.h, false, kind, unfold);
        this.shapeFolio(visual.rim, pose.w, pose.h, true, kind, unfold);
        visual.width = pose.w;
        visual.height = pose.h;
        visual.unfold = unfold;
        visual.kind = kind;
      }
      visual.root.matrix.copy(
        this.surfaceMatrix(
          pose.x + pose.w * 0.5,
          pose.y + pose.h * 0.5,
          pose.lift,
          pose.yaw,
          7,
        ),
      );
      visual.root.matrixWorldNeedsUpdate = true;
      updateInstrumentMaterials(visual.materials, {
        study,
        kind,
        unfold,
        selected: pose.selected,
        quality,
        architectureWeight,
      });
      for (const material of Object.values(visual.materials))
        material.opacity *= opacity;
      visual.root.visible = opacity > 0.01;
      visual.structure.update({
        kind,
        width: pose.w,
        height: pose.h,
        unfold,
        quality,
        study,
      });
      // Preserve the old buffer for baseline custody, but let the real housing
      // own reflections instead of drawing a second continuous bright outline.
      visual.rimMesh.visible = false;
      const spread = 46 + Math.max(0, pose.lift) * 0.6;
      const contactW = pose.w + spread * 2,
        contactH = pose.h + spread * 2;
      visual.contact.material.uniforms.uSize.value.set(contactW, contactH);
      visual.contact.material.uniforms.uRect.value.set(pose.w + 6, pose.h + 6);
      visual.contact.material.uniforms.uLift.value = Math.max(0, pose.lift);
      visual.contact.material.uniforms.uSelected.value = pose.selected ? 1 : 0;
      visual.contact.material.uniforms.uOpacity.value = opacity * livingWeight;
      visual.contact.material.uniforms.uRound.value =
        kind === "research" ? 1 - unfold : 0;
      visual.contact.matrix.copy(
        this.surfaceMatrix(
          pose.x + pose.w * 0.5,
          pose.y + pose.h * 0.5 + 12 + Math.max(0, pose.lift) * 0.3,
          0,
          pose.yaw,
          7.8,
        ),
      );
      this.contactScale.set(contactW, contactH, 1);
      visual.contact.matrix.scale(this.contactScale);
      visual.contact.matrixWorldNeedsUpdate = true;
    }
    // CSS exposes these opaque GPU faces only after they are available. The
    // default DOM backing remains complete for initialization, Efficient and
    // graphics loss, so translucency never requires the moving scene for text.
    const materialMode =
      quality !== "efficient" &&
      this.folios.every((folio) => folio.root.visible)
        ? "physical"
        : "opaque";
    if (this.canvas.dataset.materials !== materialMode)
      this.canvas.dataset.materials = materialMode;
  }

  private updatePresenceBounds() {
    // The shader's actual surface is bounded by this known local envelope.
    // BufferGeometry positions contain (t, v) parameters, so Box3 would be wrong.
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    this.vela.updateMatrixWorld(true);
    const envelopeScale =
      1 +
      this.presenceEnvelopeGain * 0.05 +
      Math.max(0, this.expression.x) * 0.045 +
      Math.abs(this.expression.y) * 0.025 +
      Math.abs(this.expression.w) * 0.02;
    for (let corner = 0; corner < 8; corner++) {
      this.presencePoint
        .set(
          (corner & 1 ? 1.35 : -1.35) * envelopeScale,
          (corner & 2 ? 1.5 : -1.5) * envelopeScale,
          (corner & 4 ? 1 : -1) * (0.85 + this.presenceEnvelopeGain * 0.08),
        )
        .applyMatrix4(this.vela.matrixWorld)
        .project(this.camera);
      const x = (this.presencePoint.x * 0.5 + 0.5) * this.width;
      const y = (0.5 - this.presencePoint.y * 0.5) * this.height;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    this.projectedPresence.x = minX;
    this.projectedPresence.y = minY;
    this.projectedPresence.w = maxX - minX;
    this.projectedPresence.h = maxY - minY;
  }

  private updateSceneLighting(
    frame: EnvironmentFrame,
    focus: number,
    settle: number,
    inputX: number,
  ) {
    let selected: SurfacePose | undefined;
    if (frame.surfaces) {
      for (const surface of frame.surfaces) {
        if (surface.selected) {
          selected = surface;
          break;
        }
      }
    }
    // Attributed activity can illuminate its shared anchor without selecting it.
    let illuminated = selected;
    if (frame.attention > 0 && frame.surfaces) {
      let nearest = 0.0025;
      for (const surface of frame.surfaces) {
        const x = ((surface.x + surface.w * 0.5) / this.width) * 2 - 1;
        const y = 1 - ((surface.y + surface.h * 0.5) / this.height) * 2;
        const distance =
          (x - frame.pointer.x) ** 2 + (y - frame.pointer.y) ** 2;
        if (distance < nearest) {
          nearest = distance;
          illuminated = surface;
        }
      }
    }
    const requestedInteraction = frame.interaction ?? (selected ? 0.25 : 0);
    const interaction = Number.isFinite(requestedInteraction)
      ? THREE.MathUtils.clamp(requestedInteraction, 0, 1)
      : 0;
    const targetStrength = illuminated
      ? illuminated !== selected
        ? 0.25 + THREE.MathUtils.clamp(frame.attention, 0, 1) * 0.25
        : THREE.MathUtils.clamp(
            0.35 +
              Math.max(0, illuminated.lift) / 110 +
              illuminated.unfold * 0.15,
            0,
            1,
          )
      : 0;
    this.fieldUniforms.uSelectionStrength.value +=
      (targetStrength - this.fieldUniforms.uSelectionStrength.value) * settle;
    this.fieldUniforms.uInteraction.value +=
      (interaction - this.fieldUniforms.uInteraction.value) * settle;
    const footprint = this.fieldUniforms.uSelectionSize.value;
    if (illuminated) {
      const radial = illuminated.kind === "research";
      const breadth = illuminated.kind === "note" ? 2.5 : radial ? 3.35 : 4.1;
      const size = THREE.MathUtils.clamp(illuminated.w / 340, 0.78, 1.28);
      const targetX = breadth * size;
      const targetY = radial ? targetX : Math.max(2.8, breadth * 1.16);
      footprint.x += (targetX - footprint.x) * settle;
      footprint.y += (targetY - footprint.y) * settle;
    } else {
      this.fieldUniforms.uFlow.value.multiplyScalar(1 - settle);
    }
    this.lightTarget.set(this.vela.position.x + inputX * 0.4, 1.5, 2);
    if (illuminated) {
      const cx = illuminated.x + illuminated.w * 0.5;
      const cy = illuminated.y + illuminated.h * 0.5;
      // Project the same resource pose into the shared scene, then find its
      // floor footprint. This is an optical approximation, not a shadow map.
      this.selectedWorld
        .set(0, 0, 0)
        .applyMatrix4(
          this.surfaceMatrix(cx, cy, illuminated.lift, illuminated.yaw, 7),
        );
      this.lightTarget.lerp(
        this.selectedWorld,
        this.fieldUniforms.uSelectionStrength.value * 0.25,
      );
      const floorY = Math.max(
        illuminated.y + illuminated.h * 0.8,
        this.height * 0.55,
      );
      this.selectionRay
        .set((cx / this.width) * 2 - 1, 1 - (floorY / this.height) * 2, 0.5)
        .unproject(this.camera)
        .sub(this.camera.position);
      const distance =
        this.selectionRay.y < -0.0001
          ? Math.min(
              (-2.4 - this.camera.position.y) / this.selectionRay.y,
              30 / this.selectionRay.length(),
            )
          : 15 / this.selectionRay.length();
      this.selectionRay.multiplyScalar(distance).add(this.camera.position);
      const anchor = this.fieldUniforms.uSelection.value;
      const flow = this.fieldUniforms.uFlow.value;
      // Short, bounded transport follows observed resource motion. It decays
      // as the footprint catches up; no unbounded trail/history is allocated.
      const flowX = frame.reduced
        ? 0
        : THREE.MathUtils.clamp(
            (this.selectionRay.x - anchor.x) * 2,
            -1.5,
            1.5,
          );
      const flowY = frame.reduced
        ? 0
        : THREE.MathUtils.clamp(
            (this.selectionRay.z - anchor.y) * 2,
            -1.5,
            1.5,
          );
      flow.x += (flowX - flow.x) * settle;
      flow.y += (flowY - flow.y) * settle;
      anchor.x += (this.selectionRay.x - anchor.x) * settle;
      anchor.y += (this.selectionRay.z - anchor.y) * settle;
      if (frame.vela !== "unavailable") {
        const acknowledgment =
          this.fieldUniforms.uSelectionStrength.value * (1 - focus * 0.35);
        this.vela.rotation.y +=
          THREE.MathUtils.clamp(frame.pointer.x - 0.2, -1, 1) *
          0.085 *
          acknowledgment;
        this.vela.rotation.x -=
          THREE.MathUtils.clamp(frame.pointer.y + 0.2, -1, 1) *
          0.045 *
          acknowledgment;
      }
    }
    this.fill.position.lerp(this.lightTarget, settle);
    this.fill.color.copy(this.semanticTint);
    this.sceneMaterialTint.copy(this.semanticTint);
    this.fill.intensity *=
      1 + this.fieldUniforms.uSelectionStrength.value * 0.1;
    this.ribbonLightDirection
      .copy(this.fill.position)
      .sub(this.vela.position)
      .transformDirection(this.camera.matrixWorldInverse);
  }

  /** Cached conservative CSS-pixel bounds; callers must not mutate the returned object. */
  presenceBounds(): Readonly<PresenceBounds> {
    return this.projectedPresence;
  }

  render(frame: EnvironmentFrame) {
    if (this.disposed || this.lost) return;
    const width = Math.max(1, frame.width),
      height = Math.max(1, frame.height);
    const dpr = Math.min(
      window.devicePixelRatio || 1,
      frame.quality === "cinematic"
        ? 1.75
        : frame.quality === "balanced"
          ? 1.25
          : 0.8,
    );
    if (
      width !== this.width ||
      height !== this.height ||
      dpr !== this.pixelRatio
    ) {
      this.width = width;
      this.height = height;
      this.pixelRatio = dpr;
      this.renderer.setPixelRatio(dpr);
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }
    this.quality = frame.quality;
    this.study = frame.study;
    this.updateSceneFades(frame);
    const time = frame.reduced ? 0 : frame.time * 0.001;
    const focus = THREE.MathUtils.clamp(frame.focus, 0, 1);
    const energyByState: Record<VelaState, number> = {
      idle: 0.22,
      receiving: 0.55,
      working: 0.78,
      coordinating: 1,
      attention: 0.65,
      reported: 0.38,
      verified: 0.48,
      unavailable: 0,
    };
    const elapsed = Math.min(
      0.1,
      Math.max(0, (frame.time - this.previousTime) * 0.001),
    );
    this.previousTime = frame.time;
    const settle =
      frame.reduced || frame.vela === "unavailable"
        ? 1
        : 1 - Math.exp(-elapsed * 9);
    this.semanticEnergy +=
      (energyByState[frame.vela] - this.semanticEnergy) * settle;
    const energy = this.semanticEnergy;
    const input = frame.inputPointer ?? frame.pointer;
    const pointerX = frame.reduced ? 0 : input.x;
    const pointerY = frame.reduced ? 0 : input.y;
    this.fieldUniforms.uTime.value = time;
    this.fieldUniforms.uFocus.value = focus;
    this.fieldUniforms.uEnergy.value = energy + frame.attention * 0.15;
    this.fieldUniforms.uPointer.value.set(
      frame.reduced ? 0 : frame.pointer.x,
      frame.reduced ? 0 : frame.pointer.y,
    );
    this.fieldUniforms.uDetail.value =
      frame.quality === "cinematic"
        ? 28
        : frame.quality === "balanced"
          ? 16
          : 5;
    for (const object of this.detail.children) {
      const lines = object as THREE.LineSegments;
      lines.geometry.setDrawRange(
        0,
        Math.min(28, this.fieldUniforms.uDetail.value + 1) * 120 * 2,
      );
    }
    const detailWeight =
      frame.sceneWeights?.observatory ??
      (frame.study === "observatory" ? 1 : 0);
    this.detail.visible = detailWeight > 0.001;
    this.fieldUniforms.uEnvironmentWeight.value = detailWeight;

    // Same form across semantic states. Small expressive deformation is explicitly presentation.
    const palette =
      frame.vela === "attention"
        ? 0xcfaa78
        : frame.vela === "verified"
          ? 0xa6c9c7
          : 0x8c7cdb;
    this.targetTint.setHex(palette);
    this.semanticTint.lerp(this.targetTint, settle);
    const presenceTime = frame.vela === "unavailable" ? 0 : time;
    if (this.expressionState !== frame.vela) {
      this.expressionState = frame.vela;
      this.expressionEnteredAt = time;
    }
    const expressionTarget = EXPRESSIONS[frame.vela];
    const expressionAge = Math.max(0, time - this.expressionEnteredAt);
    const release =
      frame.vela === "verified"
        ? Math.sin(Math.min(1, expressionAge / 1.6) * Math.PI) *
          Math.exp(-expressionAge * 0.5)
        : frame.vela === "reported"
          ? -0.25
          : 0;
    this.expression.x += (expressionTarget[0] - this.expression.x) * settle;
    this.expression.y += (expressionTarget[1] - this.expression.y) * settle;
    this.expression.z += (expressionTarget[2] - this.expression.z) * settle;
    this.expression.w += (release - this.expression.w) * settle;
    const ambientGain =
      frame.reduced || frame.vela === "unavailable"
        ? 0
        : THREE.MathUtils.clamp(frame.ambientStrength ?? 1, 0, 1.5);
    this.presenceEnvelopeGain = ambientGain;
    for (let i = 0; i < this.ribbons.length; i++) {
      const ribbon = this.ribbons[i];
      ribbon.material.uniforms.uTime.value = presenceTime;
      ribbon.material.uniforms.uEnergy.value = energy;
      ribbon.material.uniforms.uAmbient.value = ambientGain;
      ribbon.material.uniforms.uUnavailable.value =
        frame.vela === "unavailable" ? 1 : 0;
      ribbon.material.uniforms.uTint.value.copy(this.semanticTint);
      // Preallocated LOD preserves the entire silhouette at every tier.
      ribbon.geometry =
        this.ribbonLevels[
          frame.quality === "cinematic"
            ? 0
            : frame.quality === "balanced"
              ? 1
              : 2
        ];
    }
    const compact = width / height < 1.25;
    const baseX = compact ? 0.75 : 1.35;
    this.vela.position.set(
      baseX + focus * (compact ? 1.15 : 2.8),
      1.68 + focus * 0.65 + Math.sin(presenceTime * 0.58) * 0.025 * ambientGain,
      0.1 - focus * 1.2,
    );
    const scale = (compact ? 0.78 : 0.91) * (1 - focus * 0.4);
    this.vela.scale.setScalar(scale);
    this.vela.rotation.y =
      -0.35 +
      Math.sin(presenceTime * 0.58) * 0.18 * ambientGain +
      (frame.vela === "unavailable" ? 0 : pointerX * 0.045);
    this.vela.rotation.x =
      -0.18 +
      Math.sin(presenceTime * 0.49) * 0.08 * ambientGain +
      (frame.vela === "unavailable" ? 0 : pointerY * 0.025);
    this.vela.rotation.z =
      -0.13 + Math.sin(presenceTime * 0.67) * 0.05 * ambientGain;
    this.fill.intensity =
      (12 + energy * 15) *
      (1 - focus * 0.72) *
      (1 + Math.sin(presenceTime * 0.58) * 0.025 * ambientGain);
    this.orbital.update({
      concept: frame.architectureConcept ?? "ring",
      quality: frame.quality,
      focus,
      time,
      ambientStrength: frame.ambientStrength ?? 0,
      energy,
      celestialStudy: frame.celestialStudy ?? "starlit",
      phaseOverride: frame.architecturePhase ?? null,
    });
    this.camera.position.x = pointerX * 0.035 * (1 - focus);
    this.camera.position.y = 1.8 + pointerY * 0.025 * (1 - focus);
    this.camera.lookAt(0, 0.35, 0);
    this.camera.updateMatrixWorld();
    let maxFocusedWidth = Infinity;
    if (compact || focus > 0) {
      // Keep the workspace composition, then project smoothly into the actual
      // right-hand working corridor instead of letting the document occlude Vela.
      this.presencePoint.copy(this.vela.position).project(this.camera);
      const currentX = compact
        ? width * 0.8
        : (this.presencePoint.x * 0.5 + 0.5) * width;
      let corridorLeft = width - (width < 1100 ? 48 : 300);
      for (const surface of frame.surfaces ?? []) {
        if (surface.selected && surface.unfold > 0.01) {
          const yaw = THREE.MathUtils.degToRad(surface.yaw);
          const localX = surface.w * 0.5;
          const right =
            surface.x +
            localX +
            (localX * Math.cos(yaw) * 1500) /
              (1500 - surface.lift + localX * Math.sin(yaw));
          corridorLeft = Math.min(width - 20, right + 8);
          break;
        }
      }
      const preferredX = width - THREE.MathUtils.clamp(width * 0.08, 90, 150);
      const focusedX =
        width - corridorLeft < 220 ? (corridorLeft + width) * 0.5 : preferredX;
      maxFocusedWidth = Math.max(
        16,
        Math.min(focusedX - corridorLeft - 4, width - focusedX - 4) * 2,
      );
      const targetX = THREE.MathUtils.lerp(currentX, focusedX, focus);
      this.presencePoint
        .copy(this.vela.position)
        .applyMatrix4(this.camera.matrixWorldInverse);
      const ndcX = (targetX / width) * 2 - 1;
      this.presencePoint.x =
        ndcX *
        -this.presencePoint.z *
        Math.tan(THREE.MathUtils.degToRad(this.camera.fov * 0.5)) *
        this.camera.aspect;
      this.presencePoint.applyMatrix4(this.camera.matrixWorld);
      this.vela.position.copy(this.presencePoint);
      if (compact)
        this.vela.scale.setScalar(THREE.MathUtils.lerp(0.78, 0.2, focus));
    }
    this.updateSceneLighting(frame, focus, settle, pointerX);
    this.updatePresenceBounds();
    if (focus > 0 && this.projectedPresence.w > maxFocusedWidth) {
      const fit = maxFocusedWidth / this.projectedPresence.w;
      this.vela.scale.multiplyScalar(THREE.MathUtils.lerp(1, fit, focus));
      this.updatePresenceBounds();
    }
    this.updateCelestialLighting(frame, focus);
    this.updateInstrumentLighting(frame);
    this.updateFolios(frame);
    this.renderer.info.reset();
    this.renderer.clear();
    this.cosmos.render(this.renderer, this.camera, {
      study: frame.celestialStudy ?? "starlit",
      quality: frame.quality,
      focus,
      weight:
        frame.sceneWeights?.architecture ??
        (frame.study === "architecture" ? 1 : 0),
    });
    this.renderer.clearDepth();
    if (this.architecture.visible)
      this.renderer.render(this.architecturalScene, this.camera);
    this.renderer.render(this.scene, this.camera);
    this.frames++;
  }

  stats() {
    const instrumentResources = this.disposed ? [] : this.folios;
    const structures = instrumentResources.map((folio) => ({
      id: folio.id,
      ...folio.structure.diagnostics(),
    }));
    return {
      backend: "Three.js WebGL2",
      framesRendered: this.frames,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      lines: this.renderer.info.render.lines,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      pixelRatio: this.pixelRatio,
      quality: this.quality,
      study: this.study,
      contextLost: this.lost,
      cosmos: this.cosmos.diagnostics(),
      celestialStudy: this.celestialStudy,
      instruments: {
        study: this.instrumentStudy,
        resourceCount: instrumentResources.length,
        boundResourceCount: instrumentResources.filter(
          (folio) => folio.id !== null,
        ).length,
        typeCounts: {
          conversation: instrumentResources.filter(
            (folio) => folio.kind === "conversation",
          ).length,
          research: instrumentResources.filter(
            (folio) => folio.kind === "research",
          ).length,
          note: instrumentResources.filter((folio) => folio.kind === "note")
            .length,
        },
        geometryAllocations: instrumentResources.reduce(
          (sum, folio) =>
            sum + 3 + folio.structure.diagnostics().geometryAllocations,
          0,
        ),
        materialAllocations: instrumentResources.reduce(
          (sum, folio) => sum + Object.values(folio.materials).length + 1,
          0,
        ),
        meshAllocations: instrumentResources.reduce(
          (sum, folio) => sum + 3 + folio.structure.diagnostics().meshCount,
          0,
        ),
        contactCuesRendered: instrumentResources.filter(
          (folio) => folio.contact.visible && folio.root.visible,
        ).length,
        sharedKey: {
          direction: this.instrumentKey.position.clone().normalize().toArray(),
          color: this.instrumentKey.color.getHex(),
          intensity: this.instrumentKey.intensity,
          meaning:
            "Mirrors the existing architectural directional source; its background light is unchanged.",
        },
        structures,
        allocationMeaning:
          "Live constructor-owned buffers/materials, including three legacy slab/rim/contact geometries and one contact shader per resource; renderer caches are reported separately.",
      },
      shadows: {
        enabled: this.renderer.shadowMap.enabled,
        mapSize: this.shadowResolution,
        meaning:
          "One fixed architectural directional source; Efficient disables its shadow map.",
      },
      architecture: {
        ...this.orbital.diagnostics(),
        environmentVisible: this.architecture.visible,
        environmentWeight: this.sceneFades.get("architecture")?.uniform.value,
        meaning:
          "Selected composition geometry estimates, including when its environment is hidden. Actual total submissions are renderer drawCalls/triangles above.",
      },
      surfaceCapacity: 3,
      surfacesRendered: this.folios.filter((folio) => folio.root.visible)
        .length,
      // Submission counters are not presented FPS, GPU utilization, or VRAM usage.
    };
  }

  /** Native verification only: exercises the driver's loss path, not a synthetic DOM event. */
  loseContextForTest() {
    if (this.disposed)
      throw new Error("Cannot lose a disposed environment context");
    if (!this.renderer.getContext().getExtension("WEBGL_lose_context")) {
      throw new Error("WEBGL_lose_context is unavailable in this runtime");
    }
    this.renderer.forceContextLoss();
  }

  /** Restore the context previously lost by the native verification hook. */
  restoreContextForTest() {
    if (this.disposed)
      throw new Error("Cannot restore a disposed environment context");
    this.renderer.forceContextRestore();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
    this.canvas.removeEventListener(
      "webglcontextrestored",
      this.onContextRestored,
    );
    const geometries = new Set<THREE.BufferGeometry>(),
      materials = new Set<THREE.Material>();
    for (const folio of this.folios) {
      for (const material of Object.values(folio.materials))
        materials.add(material);
      // InstrumentStructure owns its geometries and clears its root. Its
      // caller-owned materials join the same exactly-once disposal set.
      folio.structure.dispose();
    }
    const collect = (object: THREE.Object3D) => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) geometries.add(mesh.geometry);
      if (Array.isArray(mesh.material))
        mesh.material.forEach((material) => materials.add(material));
      else if (mesh.material) materials.add(mesh.material);
    };
    this.scene.traverse(collect);
    this.architecturalScene.traverse(collect);
    geometries.forEach((geometry) => geometry.dispose());
    this.ribbonLevels
      .filter((geometry) => !geometries.has(geometry))
      .forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    this.environmentMap.dispose();
    this.stellarKey.shadow.dispose();
    this.cosmos.dispose();
    this.renderer.dispose();
  }
}
