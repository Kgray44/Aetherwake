import * as THREE from "three";
import type { WorkspaceGridFrame } from "./workspace-grid.ts";

/** Background optical field, submitted before physical surfaces. The existing
 * Motion Coordinator owns its reveal and projection; this owns no timebase. */
export class WorkspaceGridField {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly geometry = new THREE.PlaneGeometry(2, 2);
  private readonly uniforms = {
    uSize: { value: new THREE.Vector2(1, 1) },
    uFamily0: { value: new THREE.Vector3(0, 0, 128) },
    uFamily1: { value: new THREE.Vector3(0, 0, 256) },
    uWeights: { value: new THREE.Vector2(1, 0) },
    uReveal: { value: 0 },
    uColor: { value: new THREE.Color(0xd4c2ef) },
  };
  private readonly material = new THREE.ShaderMaterial({
    uniforms: this.uniforms,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    vertexShader: `varying vec2 vUv;
      void main() { vUv=uv; gl_Position=vec4(position.xy,0.,1.); }`,
    fragmentShader: `
      varying vec2 vUv;
      uniform vec2 uSize, uWeights;
      uniform vec3 uFamily0, uFamily1, uColor;
      uniform float uReveal;
      float feather(float distance) {
        if(distance < .7) return mix(24./255.,11./255.,distance/.7);
        if(distance < 1.5) return mix(11./255.,4./255.,(distance-.7)/.8);
        return mix(4./255.,0.,clamp((distance-1.5)/1.25,0.,1.));
      }
      float family(vec2 pixel, vec3 grid) {
        vec2 d=abs(mod(pixel-grid.xy+grid.z*.5,grid.z)-grid.z*.5);
        float x=feather(d.x), y=feather(d.y);
        return x+y-x*y;
      }
      void main() {
        vec2 point=vec2(vUv.x,1.-vUv.y)*uSize;
        float a=family(point,uFamily0)*uWeights.x;
        float b=family(point,uFamily1)*uWeights.y;
        float radius=length((point-uSize*.5)/(uSize*vec2(.62,.66)));
        float mask=radius<.66 ? mix(1.,.8,clamp((radius-.32)/.34,0.,1.))
                             : mix(.8,0.,clamp((radius-.66)/.34,0.,1.));
        gl_FragColor=vec4(uColor,(a+b-a*b)*mask*uReveal);
        #include <colorspace_fragment>
      }`,
  });
  private disposed = false;

  constructor() {
    const plane = new THREE.Mesh(this.geometry, this.material);
    plane.frustumCulled = false;
    this.scene.add(plane);
  }

  render(
    renderer: Pick<THREE.WebGLRenderer, "render">,
    frame: WorkspaceGridFrame | null | undefined,
    width: number,
    height: number,
  ) {
    if (
      this.disposed ||
      !frame ||
      !Number.isFinite(frame.reveal) ||
      frame.reveal <= 0 ||
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0 ||
      frame.projection?.length !== 2 ||
      frame.projection.some(
        (p) =>
          ![p.x, p.y, p.spacing, p.weight].every(Number.isFinite) ||
          p.spacing <= 0 ||
          p.weight < 0 ||
          p.weight > 1,
      )
    )
      return;
    const [first, second] = frame.projection;
    this.uniforms.uSize.value.set(width, height);
    this.uniforms.uFamily0.value.set(first.x, first.y, first.spacing);
    this.uniforms.uFamily1.value.set(second.x, second.y, second.spacing);
    this.uniforms.uWeights.value.set(first.weight, second.weight);
    this.uniforms.uReveal.value = Math.min(1, frame.reveal);
    renderer.render(this.scene, this.camera);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.geometry.dispose();
    this.material.dispose();
    this.scene.clear();
  }
}
