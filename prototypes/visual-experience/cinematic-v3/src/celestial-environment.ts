import * as THREE from "three";

export type CelestialStudy = "starlit" | "shadow" | "deep";
export type CelestialQuality = "cinematic" | "balanced" | "efficient";
export interface CelestialFrame {
  study: CelestialStudy;
  quality: CelestialQuality;
  focus: number;
  weight: number;
  time?: number;
  ambientStrength?: number;
}

export const CELESTIAL_SEED = 0x41e7a35d;
export const GALACTIC_NORMAL = new THREE.Vector3(0.55, 0.76, 0.09).normalize();
const GALACTIC_U = new THREE.Vector3()
  .crossVectors(GALACTIC_NORMAL, new THREE.Vector3(0, 0, 1))
  .normalize();
const GALACTIC_V = new THREE.Vector3()
  .crossVectors(GALACTIC_NORMAL, GALACTIC_U)
  .normalize();
const CAPACITY = 24000;
const COUNTS: Record<CelestialQuality, number> = {
  cinematic: CAPACITY,
  balanced: 14000,
  efficient: 6500,
};
const STUDIES: Record<CelestialStudy, readonly [number, number, number]> = {
  starlit: [3.4, 2.5, 1.15],
  shadow: [2.2, 1.1, 1],
  deep: [3.1, 3.4, 1.2],
};

export interface CelestialCatalog {
  positions: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
  luminances: Float32Array;
}

function randomSequence(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** A galactic concentration, broad sparse regions and a narrow dust-lane deficit.
 * These are original astronomical visual studies, not a measured sky catalog. */
function spatialDensity(x: number, y: number, z: number) {
  const latitude = Math.asin(
    THREE.MathUtils.clamp(
      x * GALACTIC_NORMAL.x + y * GALACTIC_NORMAL.y + z * GALACTIC_NORMAL.z,
      -1,
      1,
    ),
  );
  const longitude = Math.atan2(
    x * GALACTIC_V.x + y * GALACTIC_V.y + z * GALACTIC_V.z,
    x * GALACTIC_U.x + y * GALACTIC_U.y + z * GALACTIC_U.z,
  );
  const warp =
    0.027 * Math.sin(longitude * 2) + 0.012 * Math.sin(longitude * 5);
  const band = Math.exp(-(((latitude - warp) / 0.14) ** 2));
  const halo = Math.exp(-(((latitude - warp) / 0.32) ** 2));
  const lane = Math.exp(-(((latitude - warp + 0.018) / 0.025) ** 2));
  const clump =
    0.64 +
    0.2 * Math.sin(longitude * 3.0 + 0.8) +
    0.12 * Math.sin(longitude * 7.0 - latitude * 8.0);
  const sparse = 0.13 + 0.06 * (0.5 + 0.5 * Math.sin(x * 8 + y * 3 + z * 4));
  return THREE.MathUtils.clamp(
    sparse + (band * 0.62 + halo * 0.13) * clump * (1 - lane * 0.7),
    0.08,
    0.95,
  );
}

/** Allocate once, then keep stable directions, magnitudes, optical sizes and
 * restrained color temperatures. Bright-first prefixes preserve anchor stars
 * when quality drops; only the faintest distant population is reduced. */
export function generateCelestialCatalog(
  count = CAPACITY,
  seed = CELESTIAL_SEED,
): CelestialCatalog {
  if (!Number.isInteger(count) || count < 0 || count > CAPACITY)
    throw new Error(
      "Celestial catalog size must be an integer from 0 to 24000",
    );
  const random = randomSequence(seed);
  const stars: {
    x: number;
    y: number;
    z: number;
    r: number;
    g: number;
    b: number;
    size: number;
    luminance: number;
  }[] = [];
  for (let i = 0; i < count; i++) {
    let x = 0,
      y = 0,
      z = -1;
    for (let attempt = 0; attempt < 48; attempt++) {
      y = random() * 2 - 1;
      const azimuth = random() * Math.PI * 2;
      const radius = Math.sqrt(1 - y * y);
      x = Math.cos(azimuth) * radius;
      z = Math.sin(azimuth) * radius;
      if (random() < spatialDensity(x, y, z)) break;
    }
    const distance = 1100 + random() * 1200;
    const temperature = random();
    let r = 0.96,
      g = 0.97,
      b = 1;
    if (temperature < 0.28) {
      r = 1;
      g = 0.9 + temperature * 0.16;
      b = 0.76 + temperature * 0.65;
    } else if (temperature > 0.72) {
      r = 0.78 + (1 - temperature) * 0.5;
      g = 0.88 + (1 - temperature) * 0.3;
      b = 1;
    }
    let luminance = 0.01 + 0.075 * random() ** 5.2;
    if (random() < 0.005) luminance = 0.2 + random() ** 2 * 0.9;
    // A subpixel Gaussian lost nearly every faint star in the first native
    // capture. Keep a resolvable optical footprint while preserving a very
    // wide magnitude range; brightness still carries most of the hierarchy.
    const size = Math.min(3.8, 1.05 + 0.95 * Math.sqrt(luminance / 0.08));
    stars.push({
      x: x * distance,
      y: y * distance,
      z: z * distance,
      r,
      g,
      b,
      size,
      luminance,
    });
  }
  stars.sort((a, b) => b.luminance - a.luminance);
  const positions = new Float32Array(count * 3),
    colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count),
    luminances = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const star = stars[i];
    positions.set([star.x, star.y, star.z], i * 3);
    colors.set([star.r, star.g, star.b], i * 3);
    sizes[i] = star.size;
    luminances[i] = star.luminance;
  }
  return { positions, colors, sizes, luminances };
}

const skyVertex = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
  }
`;

const skyFragment = /* glsl */ `
  uniform vec3 uNormal, uAxisU, uAxisV;
  uniform float uDust, uBase, uEmphasis, uDetail, uWeight;
  varying vec3 vDirection;
  float hash(vec3 p) {
    p = fract(p * .1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }
  float noise(vec3 p) {
    vec3 cell = floor(p), f = fract(p);
    f = f * f * (3. - 2. * f);
    float a = mix(hash(cell), hash(cell + vec3(1.,0.,0.)), f.x);
    float b = mix(hash(cell + vec3(0.,1.,0.)), hash(cell + vec3(1.,1.,0.)), f.x);
    float c = mix(hash(cell + vec3(0.,0.,1.)), hash(cell + vec3(1.,0.,1.)), f.x);
    float d = mix(hash(cell + vec3(0.,1.,1.)), hash(cell + vec3(1.,1.,1.)), f.x);
    return mix(mix(a,b,f.y), mix(c,d,f.y), f.z);
  }
  void main() {
    vec3 direction = normalize(vDirection);
    float latitude = asin(clamp(dot(direction, uNormal), -1., 1.));
    float longitude = atan(dot(direction, uAxisV), dot(direction, uAxisU));
    float cloud = 0., amplitude = .62;
    vec3 frequency = direction * 5.4;
    for (int octave = 0; octave < 3; octave++) {
      if (float(octave) >= uDetail) break;
      cloud += noise(frequency) * amplitude;
      frequency = frequency * 2.13 + vec3(7.3,2.1,9.4);
      amplitude *= .43;
    }
    float warp = .027 * sin(longitude * 2.) + .012 * sin(longitude * 5.);
    float latitudeBand = latitude - warp;
    float band = exp(-pow(latitudeBand / .14, 2.));
    float halo = exp(-pow(latitudeBand / .32, 2.));
    float lane = exp(-pow((latitudeBand + .018 + (cloud - .4) * .025) / .022, 2.));
    float secondLane = exp(-pow((latitudeBand - .073 - .012 * sin(longitude * 3.)) / .029, 2.));
    float dust = (band * (.35 + cloud * .95) + halo * .12) * (1. - lane * .88) * (1. - secondLane * .5);
    vec3 base = mix(vec3(.0008,.00105,.0018), vec3(.0015,.0019,.0034), cloud) * uBase;
    vec3 dustColor = mix(vec3(.011,.014,.022), vec3(.024,.021,.026), cloud);
    vec3 color = (base + dustColor * dust * uDust) * uEmphasis;
    // Static screen-grain dither softens near-black SDR quantization. It is not
    // animated optical noise or a claim of a calibrated/HDR presentation.
    float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056,.00583715)))) - .5;
    color += dither * .00010;
    gl_FragColor = vec4(max(color, 0.), uWeight);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const starVertex = /* glsl */ `
  attribute vec3 aPosition, aColor;
  attribute float aSize, aLuminance;
  uniform vec2 uViewport;
  uniform float uPixelRatio;
  varying vec2 vOptical;
  varying vec3 vColor;
  varying float vLuminance;
  void main() {
    vec4 clip = projectionMatrix * viewMatrix * vec4(aPosition, 1.);
    clip.xy += position.xy * aSize * .5 * uPixelRatio * (2. / uViewport) * clip.w;
    gl_Position = clip;
    vOptical = position.xy;
    vColor = aColor;
    vLuminance = aLuminance;
  }
`;

const starFragment = /* glsl */ `
  uniform float uGain, uEmphasis;
  varying vec2 vOptical;
  varying vec3 vColor;
  varying float vLuminance;
  void main() {
    float r2 = dot(vOptical, vOptical);
    float edge = 1. - smoothstep(.72, 1., r2);
    float core = exp(-r2 * 3.2);
    float halo = exp(-r2 * 2.7) * smoothstep(.18, .8, vLuminance) * .025;
    float kernel = (core + halo) * edge;
    gl_FragColor = vec4(vColor * vLuminance * uGain, kernel * uEmphasis);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** An infinite-distance celestial environment: orientation follows the scene
 * camera while translation is deliberately canceled. The host owns scheduling,
 * autoClear and foreground clearDepth; this object owns no frame loop. */
export class CelestialEnvironment {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(39, 1, 0.1, 3000);
  private readonly catalog: CelestialCatalog;
  private readonly stars: THREE.Mesh<
    THREE.InstancedBufferGeometry,
    THREE.ShaderMaterial
  >;
  private readonly dome: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly viewport = new THREE.Vector2(1, 1);
  private readonly worldOrientation = new THREE.Quaternion();
  private quality: CelestialQuality = "balanced";
  private study: CelestialStudy = "starlit";
  private environmentWeight = 0;
  private renderedStars = 0;
  private renderedFrames = 0;
  private disposed = false;

  constructor(seed = CELESTIAL_SEED) {
    this.catalog = generateCelestialCatalog(CAPACITY, seed);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0],
        3,
      ),
    );
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute(
      "aPosition",
      new THREE.InstancedBufferAttribute(this.catalog.positions, 3),
    );
    geometry.setAttribute(
      "aColor",
      new THREE.InstancedBufferAttribute(this.catalog.colors, 3),
    );
    geometry.setAttribute(
      "aSize",
      new THREE.InstancedBufferAttribute(this.catalog.sizes, 1),
    );
    geometry.setAttribute(
      "aLuminance",
      new THREE.InstancedBufferAttribute(this.catalog.luminances, 1),
    );
    geometry.instanceCount = COUNTS.balanced;
    this.stars = new THREE.Mesh(
      geometry,
      new THREE.ShaderMaterial({
        uniforms: {
          uViewport: { value: this.viewport },
          uPixelRatio: { value: 1 },
          uGain: { value: 3.4 },
          uEmphasis: { value: 1 },
        },
        vertexShader: starVertex,
        fragmentShader: starFragment,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.stars.name = "celestial-stars";
    this.stars.frustumCulled = false;
    this.stars.renderOrder = 1;
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(2800, 48, 24),
      new THREE.ShaderMaterial({
        uniforms: {
          uNormal: { value: GALACTIC_NORMAL.clone() },
          uAxisU: { value: GALACTIC_U.clone() },
          uAxisV: { value: GALACTIC_V.clone() },
          uDust: { value: 2.5 },
          uBase: { value: 1.15 },
          uEmphasis: { value: 1 },
          uDetail: { value: 2 },
          uWeight: { value: 0 },
        },
        vertexShader: skyVertex,
        fragmentShader: skyFragment,
        side: THREE.BackSide,
        transparent: true,
        blending: THREE.NormalBlending,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.dome.name = "celestial-dust-dome";
    this.dome.frustumCulled = false;
    this.dome.renderOrder = 0;
    this.scene.add(this.dome, this.stars);
  }

  update(mainCamera: THREE.PerspectiveCamera, frame: CelestialFrame) {
    if (this.disposed)
      throw new Error("Cannot update a disposed celestial environment");
    mainCamera.updateWorldMatrix(true, false);
    mainCamera.getWorldQuaternion(this.worldOrientation);
    this.camera.position.set(0, 0, 0);
    this.camera.quaternion.copy(this.worldOrientation);
    if (
      this.camera.fov !== mainCamera.fov ||
      this.camera.aspect !== mainCamera.aspect ||
      this.camera.zoom !== mainCamera.zoom
    ) {
      this.camera.fov = mainCamera.fov;
      this.camera.aspect = mainCamera.aspect;
      this.camera.zoom = mainCamera.zoom;
      this.camera.updateProjectionMatrix();
    }
    this.camera.updateMatrixWorld(true);
    this.quality = frame.quality;
    this.study = frame.study;
    const gains = STUDIES[frame.study];
    this.environmentWeight = THREE.MathUtils.clamp(frame.weight, 0, 1);
    const focusedSalience = 1 - THREE.MathUtils.clamp(frame.focus, 0, 1) * 0.78;
    const emphasis = this.environmentWeight * focusedSalience;
    this.stars.geometry.instanceCount = COUNTS[frame.quality];
    this.stars.material.uniforms.uGain.value = gains[0];
    this.stars.material.uniforms.uEmphasis.value = emphasis;
    this.dome.material.uniforms.uDust.value = gains[1];
    this.dome.material.uniforms.uBase.value = gains[2];
    this.dome.material.uniforms.uEmphasis.value = focusedSalience;
    this.dome.material.uniforms.uWeight.value = this.environmentWeight;
    this.dome.material.uniforms.uDetail.value =
      frame.quality === "cinematic" ? 3 : frame.quality === "balanced" ? 2 : 1;
    // Time/ambient strength intentionally do not move or twinkle distant stars.
    // Quiet/reduced motion scheduling remains entirely owned by the host.
  }

  render(
    renderer: THREE.WebGLRenderer,
    mainCamera: THREE.PerspectiveCamera,
    frame: CelestialFrame,
  ) {
    this.update(mainCamera, frame);
    if (this.environmentWeight <= 0.001) {
      this.renderedStars = 0;
      return;
    }
    renderer.getDrawingBufferSize(this.viewport);
    this.stars.material.uniforms.uPixelRatio.value = renderer.getPixelRatio();
    renderer.render(this.scene, this.camera);
    this.renderedStars = this.stars.geometry.instanceCount;
    this.renderedFrames++;
  }

  diagnostics() {
    const visible = !this.disposed && this.environmentWeight > 0.001;
    return {
      backend:
        "deterministic 3D celestial dome and instanced stellar billboards",
      study: this.study,
      quality: this.quality,
      starCapacity: CAPACITY,
      configuredStars: this.stars.geometry.instanceCount,
      activeStars: visible ? this.stars.geometry.instanceCount : 0,
      renderedStars: this.disposed ? 0 : this.renderedStars,
      renderedFrames: this.renderedFrames,
      environmentWeight: this.environmentWeight,
      visible,
      batches: visible ? 2 : 0,
      geometryAllocations: this.disposed ? 0 : 2,
      textureAllocations: 0,
      catalogBytes:
        this.catalog.positions.byteLength +
        this.catalog.colors.byteLength +
        this.catalog.sizes.byteLength +
        this.catalog.luminances.byteLength,
      translationParallax:
        "canceled at infinite distance; world orientation copied",
      timeVaryingTwinkle: false,
      disposed: this.disposed,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stars.geometry.dispose();
    this.stars.material.dispose();
    this.dome.geometry.dispose();
    this.dome.material.dispose();
    this.scene.clear();
  }
}
