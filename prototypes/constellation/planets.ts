import * as THREE from "three";
import { hash } from "./spatial.ts";

/** Appearance v1: canonical identity determines geology; content is never read. */
export function planetAppearance(
  id: string,
  role: "project" | "workspace" | "resource",
) {
  const a = hash("terrain:" + id),
    b = hash("climate:" + id.split("").reverse().join("")),
    c = hash("light:" + id),
    d = hash("orbit:" + id);
  const type =
    role === "resource" ? (a < 0.6 ? 0 : a < 0.85 ? 3 : 1) : Math.floor(a * 5);
  const hue = (b + 0.11 * c) % 1;
  const palette =
    type === 1
      ? [
          [0.52 + b * 0.13, 0.62, 0.2],
          [0.1 + c * 0.19, 0.34, 0.3],
          [0.1, 0.12, 0.74],
        ]
      : type === 2
        ? [
            [hue, 0.27, 0.27],
            [(hue + 0.07) % 1, 0.32, 0.6],
            [(hue + 0.14) % 1, 0.27, 0.39],
          ]
        : type === 3
          ? [
              [hue, 0.3 + c * 0.22, 0.19 + b * 0.1],
              [(hue + 0.035) % 1, 0.25 + c * 0.2, 0.42 + b * 0.13],
              [(hue + 0.08) % 1, 0.1 + c * 0.12, 0.76 + b * 0.08],
            ]
          : type === 4
            ? [
                [0.03, 0.21, 0.11],
                [0.02 + c * 0.04, 0.63, 0.42],
                [0.09, 0.74, 0.71],
              ]
            : [
                [0.02 + b * 0.15, 0.15 + c * 0.22, 0.22],
                [0.02 + b * 0.16, 0.18 + c * 0.19, 0.49],
                [0.06 + b * 0.15, 0.15, 0.69],
              ];
  return {
    version: 1,
    type,
    seeds: [a, b, c, d],
    palette,
    rings:
      role === "project" ? d > 0.46 : role === "workspace" ? d > 0.8 : d > 0.98,
    atmosphere: type === 1 || type === 2 || type === 3 || role === "project",
    radius:
      role === "project"
        ? 148
        : role === "workspace"
          ? 62
          : 23 + (c - 0.5) * 10,
  };
}

const vertex = /*glsl*/ `
varying vec3 vLocal;
varying vec3 vWorld;
varying vec3 vNormal;
void main(){vLocal=position;vec4 world=modelMatrix*vec4(position,1.);vWorld=world.xyz;vNormal=normalize(mat3(modelMatrix)*normal);gl_Position=projectionMatrix*viewMatrix*world;}
`;
const noise = /*glsl*/ `
float rnd(vec3 p){p=fract(p*.1031+uSeed.x*11.);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}
float field(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(rnd(i),rnd(i+vec3(1,0,0)),f.x),mix(rnd(i+vec3(0,1,0)),rnd(i+vec3(1,1,0)),f.x),f.y),mix(mix(rnd(i+vec3(0,0,1)),rnd(i+vec3(1,0,1)),f.x),mix(rnd(i+vec3(0,1,1)),rnd(i+vec3(1,1,1)),f.x),f.y),f.z);}
`;
const surface = /*glsl*/ `
uniform vec4 uSeed;
uniform vec3 uLow,uMid,uHigh,uLight;
uniform float uType,uDetail;
varying vec3 vLocal,vWorld,vNormal;
${noise}
void main(){
 vec3 p=normalize(vLocal),N=normalize(vNormal),V=normalize(cameraPosition-vWorld),L=normalize(uLight);
 float broad=field(p*(3.+uSeed.y*3.)+uSeed.z*12.);
 float fine=uDetail>.02?field(p*(13.+uSeed.w*9.)):.5;
 vec3 color=mix(uLow,uMid,broad);float relief=1.;float water=0.;float lava=0.;
 if(uType<.5){
   color=mix(uLow,uMid,smoothstep(.23,.8,broad));color=mix(color,uHigh,fine*.25*uDetail);
   vec3 cell=p*(7.+uSeed.z*6.);vec3 id=floor(cell);vec3 center=.3+.4*vec3(rnd(id),rnd(id+3.),rnd(id+8.));
   float d=length(fract(cell)-center),bowl=1.-smoothstep(.07,.27,d),rim=smoothstep(.20,.27,d)*(1.-smoothstep(.27,.34,d));
   relief=1.-bowl*.34*uDetail+rim*.23*uDetail;
 }else if(uType<1.5){
   float continent=.7*broad+.3*field(p*7.3),land=smoothstep(.43+uSeed.y*.16,.46+uSeed.y*.16,continent);water=1.-land;
   vec3 terrain=mix(uMid,uHigh,smoothstep(.66,.88,continent));color=mix(uLow,terrain,land);
   float polar=smoothstep(.80+uSeed.z*.06,.97,abs(p.y));color=mix(color,uHigh,polar);
   float cloud=smoothstep(.65,.84,field(p*8.+vec3(uSeed.z*20.,0,2.)))*.60*uDetail;color=mix(color,vec3(.82,.84,.86),cloud);
 }else if(uType<2.5){
   float latitude=p.y*(10.+uSeed.w*14.)+broad*(2.+uSeed.z*3.);
   float bands=.5+.5*sin(latitude*3.14159);color=mix(uLow,uMid,smoothstep(.12,.9,bands));
   color=mix(color,uHigh,(.5+.5*sin(latitude*12.))*uDetail*.15);
   float longitude=atan(p.z,p.x),delta=atan(sin(longitude-uSeed.y*6.28),cos(longitude-uSeed.y*6.28));
   float storm=1.-smoothstep(.06,.20,length(vec2(delta*.55,(p.y-(uSeed.z-.5)) *2.8)));color=mix(color,uHigh,storm*.65);
 }else if(uType<3.5){
   float cracks=1.-smoothstep(.015,.08,abs(fine-.51));color=mix(uLow,uMid,smoothstep(.2,.76,broad));color=mix(color,uHigh,smoothstep(.78,.97,abs(p.y)));color=mix(color,uLow,cracks*.45*uDetail);
 }else{
   float fissure=1.-smoothstep(.01,.045,abs(fine-.5));color=mix(uLow,uMid,broad*.32);lava=fissure*uDetail*.6;color=mix(color,uHigh,lava);
 }
 float diffuse=max(dot(N,L),0.);float wrap=smoothstep(-.1,.3,dot(N,L));
 vec3 halfVector=normalize(L+V);float specular=pow(max(dot(N,halfVector),0.),56.)*water*.5;
 vec3 lit=color*(.07+diffuse*1.12)+vec3(.87,.91,1.)*specular*wrap+uHigh*lava*.14;
 gl_FragColor=vec4(lit*relief,1.);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
}
`;
const atmosphere = /*glsl*/ `
uniform vec3 uColor,uLight;
varying vec3 vWorld,vNormal;
void main(){vec3 N=normalize(vNormal),V=normalize(cameraPosition-vWorld);float rim=pow(1.-abs(dot(N,V)),3.8);float day=.18+.82*max(dot(N,normalize(uLight)),0.);gl_FragColor=vec4(uColor,rim*day*.38);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}
`;
const rings = /*glsl*/ `
uniform vec3 uColor;uniform vec4 uSeed;uniform float uDetail;varying vec3 vLocal;
void main(){float r=length(vLocal.xy);float band=.48+uDetail*(.35*sin(r*(90.+uSeed.z*50.))+.12*sin(r*310.));float gap=1.-smoothstep(.006,.015,abs(r-(.76+uSeed.x*.08)));float alpha=smoothstep(.63,.66,r)*(1.-smoothstep(.98,1.,r))*band*(1.-gap*.8*uDetail);gl_FragColor=vec4(uColor,alpha*.72);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}
`;
export type PlanetGeometries = {
  low: THREE.BufferGeometry;
  medium: THREE.BufferGeometry;
  high: THREE.BufferGeometry;
  ring: THREE.BufferGeometry;
};
export function createPlanet(
  id: string,
  role: "project" | "workspace" | "resource",
  geometry: PlanetGeometries,
) {
  const appearance = planetAppearance(id, role),
    group = new THREE.Group();
  const color = (i: number) =>
    new THREE.Color().setHSL(
      appearance.palette[i][0],
      appearance.palette[i][1],
      appearance.palette[i][2],
    );
  const light = new THREE.Vector3(-0.6, 0.7, 0.55).normalize();
  const material = new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: surface,
    uniforms: {
      uSeed: {
        value: new THREE.Vector4(
          ...(appearance.seeds as [number, number, number, number]),
        ),
      },
      uLow: { value: color(0) },
      uMid: { value: color(1) },
      uHigh: { value: color(2) },
      uType: { value: appearance.type },
      uDetail: { value: 1 },
      uLight: { value: light },
    },
  });
  const body = new THREE.Mesh(
    role === "project"
      ? geometry.high
      : role === "workspace"
        ? geometry.medium
        : geometry.low,
    material,
  );
  body.scale.setScalar(appearance.radius);
  group.add(body);
  if (appearance.atmosphere) {
    const tint =
      appearance.type === 1
        ? new THREE.Color(0x789ece)
        : appearance.type === 3
          ? new THREE.Color(0x97ced0)
          : color(1);
    const air = new THREE.Mesh(
      body.geometry,
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: atmosphere,
        uniforms: { uColor: { value: tint }, uLight: { value: light } },
        transparent: true,
        depthWrite: false,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    air.name = "atmosphere";
    air.scale.setScalar(appearance.radius * 1.055);
    group.add(air);
  }
  if (appearance.rings) {
    const ring = new THREE.Mesh(
      geometry.ring,
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: rings,
        uniforms: {
          uColor: { value: color(2) },
          uDetail: { value: 1 },
          uSeed: {
            value: new THREE.Vector4(
              ...(appearance.seeds as [number, number, number, number]),
            ),
          },
        },
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: false,
      }),
    );
    ring.name = "planet-ring";
    ring.scale.setScalar(appearance.radius * (1.8 + appearance.seeds[2] * 0.7));
    ring.rotation.x = 0.65 + appearance.seeds[1] * 0.75;
    ring.rotation.z = appearance.seeds[3] * 2;
    group.add(ring);
  }
  group.rotation.z = (appearance.seeds[1] - 0.5) * 0.8;
  group.userData.appearance = appearance;
  group.userData.body = body;
  return group;
}
