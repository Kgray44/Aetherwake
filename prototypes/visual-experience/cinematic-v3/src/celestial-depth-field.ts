import * as THREE from "three";

export const CELESTIAL_DEPTH_CAPACITY = 48;
export const CELESTIAL_DEPTH_SEED = 0x7d41a38b;
export type CelestialDepthCatalog = {
  positions: Float32Array;
  axesU: Float32Array;
  axesV: Float32Array;
  opacities: Float32Array;
  radii: Float32Array;
};

/** Sparse finite dust sheets in the existing galactic reference. These are
 * original bounded optical structures, not resources or a measured sky map.
 * No camera-relative respawn, random repositioning, clock or ambient drift. */
export function generateCelestialDepthCatalog(
  count = CELESTIAL_DEPTH_CAPACITY,
  seed = CELESTIAL_DEPTH_SEED,
): CelestialDepthCatalog {
  if (!Number.isInteger(count) || count < 0 || count > CELESTIAL_DEPTH_CAPACITY)
    throw new RangeError("Finite celestial depth capacity is 48 sheets");
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const normal = new THREE.Vector3(0.55, 0.76, 0.09).normalize();
  const u = new THREE.Vector3()
    .crossVectors(normal, new THREE.Vector3(0, 0, 1))
    .normalize();
  const v = new THREE.Vector3().crossVectors(normal, u).normalize();
  const result: CelestialDepthCatalog = {
    positions: new Float32Array(count * 3),
    axesU: new Float32Array(count * 3),
    axesV: new Float32Array(count * 3),
    opacities: new Float32Array(count),
    radii: new Float32Array(count),
  };
  for (let i = 0; i < count; i++) {
    const angle = i * 2.399963229728653 + random() * 0.3;
    const distance = 8000 + random() ** 0.65 * 60000;
    const center = u
      .clone()
      .multiplyScalar(Math.cos(angle) * distance)
      .addScaledVector(v, Math.sin(angle) * distance)
      .addScaledVector(normal, (random() - 0.5) * distance * 0.35);
    const radius = distance * (0.012 + random() * 0.018);
    const axisU = u.clone().applyAxisAngle(normal, random() * Math.PI * 2);
    const axisV = new THREE.Vector3()
      .crossVectors(normal, axisU)
      .applyAxisAngle(axisU, (random() - 0.5) * 0.8);
    center.toArray(result.positions, i * 3);
    axisU.multiplyScalar(radius).toArray(result.axesU, i * 3);
    axisV
      .multiplyScalar(radius * (0.14 + random() * 0.16))
      .toArray(result.axesV, i * 3);
    result.opacities[i] = 0.025 + random() * 0.035;
    result.radii[i] = radius;
  }
  return result;
}

/** One bounded mesh owned and submitted by the existing CelestialEnvironment.
 * It owns no camera, WebGLRenderer, scheduler, graph or navigation state. */
export class CelestialDepthField {
  readonly mesh: THREE.Mesh<
    THREE.InstancedBufferGeometry,
    THREE.ShaderMaterial
  >;
  private disposed = false;

  constructor(seed = CELESTIAL_DEPTH_SEED) {
    const catalog = generateCelestialDepthCatalog(
      CELESTIAL_DEPTH_CAPACITY,
      seed,
    );
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0],
        3,
      ),
    );
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    for (const [name, array, size] of [
      ["aCenter", catalog.positions, 3],
      ["aAxisU", catalog.axesU, 3],
      ["aAxisV", catalog.axesV, 3],
      ["aOpacity", catalog.opacities, 1],
      ["aRadius", catalog.radii, 1],
    ] as const)
      geometry.setAttribute(
        name,
        new THREE.InstancedBufferAttribute(array, size),
      );
    geometry.instanceCount = CELESTIAL_DEPTH_CAPACITY;
    this.mesh = new THREE.Mesh(
      geometry,
      new THREE.ShaderMaterial({
        uniforms: { uWeight: { value: 0 }, uDetail: { value: 1 } },
        side: THREE.DoubleSide,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        vertexShader: `
        attribute vec3 aCenter, aAxisU, aAxisV;
        attribute float aOpacity, aRadius;
        varying vec2 vLocal;
        varying float vOpacity;
        void main() {
          vLocal=position.xy;
          vec3 normal=normalize(cross(aAxisU,aAxisV));
          vec3 toViewer=cameraPosition-aCenter;
          float viewerDistance=length(toViewer);
          float proximity=smoothstep(aRadius*2.,aRadius*6.,viewerDistance);
          float grazing=smoothstep(.05,.3,abs(dot(normal,toViewer/max(viewerDistance,1.))));
          vOpacity=aOpacity*proximity*grazing;
          if(vOpacity<.00001) { gl_Position=vec4(2.,2.,2.,1.); return; }
          vec3 world=aCenter+position.x*aAxisU+position.y*aAxisV;
          gl_Position=projectionMatrix*modelViewMatrix*vec4(world,1.);
        }`,
        fragmentShader: `
        uniform float uWeight,uDetail;
        varying vec2 vLocal;
        varying float vOpacity;
        float grain(vec2 p) {
          return .5+.25*sin(p.x*3.1+p.y*2.7)+.25*cos(p.y*4.3-p.x*1.7);
        }
        void main() {
          float radius=dot(vLocal,vLocal);
          float edge=1.-smoothstep(.25,1.,radius);
          float density=exp(-radius*3.5)*edge*(.75+.25*grain(vLocal*2.));
          if(uDetail>.5) density*=.88+.12*grain(vLocal*7.);
          gl_FragColor=vec4(vec3(.24,.20,.31),density*vOpacity*uWeight);
          #include <colorspace_fragment>
        }`,
      }),
    );
    this.mesh.name = "celestial-finite-dust";
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  update(weight: number, quality: "cinematic" | "balanced" | "efficient") {
    if (this.disposed) return;
    const intensity = Number.isFinite(weight)
      ? Math.max(0, Math.min(1, weight))
      : 0;
    this.mesh.visible = intensity > 0;
    this.mesh.material.uniforms.uWeight.value = intensity;
    this.mesh.material.uniforms.uDetail.value = quality === "efficient" ? 0 : 1;
  }

  diagnostics() {
    return {
      capacity: CELESTIAL_DEPTH_CAPACITY,
      active: !this.disposed && this.mesh.visible,
      instances:
        this.disposed || !this.mesh.visible
          ? 0
          : this.mesh.geometry.instanceCount,
      geometryAllocations: this.disposed ? 0 : 1,
      textureAllocations: 0,
      cameraRelativeRespawn: false,
      timeVaryingMotion: false,
      disposed: this.disposed,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.mesh.visible = false;
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
