import type { Pose } from './motion.ts';
import type { VelaVisualState } from './vela-visual-state.ts';

/** Seven harmonic coefficients borrowed from the existing coordinator. These
 * are visual geometry, never measurements of work or new operational states. */
export type VelaShape = Pose;
export type VelaShapeState = 'idle' | 'receiving' | 'working' | 'coordinating' | 'attention' | 'reported' | 'verified' | 'unavailable';
export const VELA_SHAPES: Readonly<Record<VelaShapeState, Readonly<VelaShape>>> = Object.freeze({
  idle: Object.freeze({ x: 0, y: 1.13, w: 1.18, h: 0, lift: .12, yaw: .5, opacity: .235 }),
  receiving: Object.freeze({ x: 1.25, y: 0, w: .85, h: 0, lift: 0, yaw: .2, opacity: .13 }),
  working: Object.freeze({ x: .95, y: 0, w: .43, h: .16, lift: 0, yaw: .55, opacity: .10 }),
  coordinating: Object.freeze({ x: .4, y: 1.05, w: .2, h: .8, lift: .3, yaw: .5, opacity: .10 }),
  attention: Object.freeze({ x: .55, y: .2, w: 1.2, h: .1, lift: .1, yaw: .4, opacity: .20 }),
  reported: Object.freeze({ x: 0, y: 1.15, w: .5, h: 0, lift: 0, yaw: .3, opacity: .13 }),
  verified: Object.freeze({ x: .85, y: .28, w: .85, h: .28, lift: 0, yaw: .28, opacity: .17 }),
  unavailable: Object.freeze({ x: .3, y: .15, w: .65, h: 0, lift: .08, yaw: .3, opacity: .08 }),
});

export const OPERATIONAL_VELA_SHAPES: Readonly<Record<VelaVisualState, Readonly<VelaShape>>> = Object.freeze({
  idle: VELA_SHAPES.idle,
  aware: Object.freeze({ x: .28, y: .9, w: .98, h: .16, lift: -.08, yaw: .42, opacity: .19 }),
  'wake-armed': Object.freeze({ x: .72, y: .12, w: .72, h: 0, lift: .04, yaw: .18, opacity: .08 }),
  listening: VELA_SHAPES.receiving,
  interpreting: VELA_SHAPES.working,
  planning: Object.freeze({ x: .75, y: .75, w: .95, h: -.12, lift: .22, yaw: .38, opacity: .11 }),
  acting: Object.freeze({ x: 1.2, y: .4, w: .6, h: .32, lift: -.1, yaw: .3, opacity: .14 }),
  coordinating: VELA_SHAPES.coordinating,
  speaking: Object.freeze({ x: .9, y: .22, w: .65, h: .25, lift: -.15, yaw: .46, opacity: .18 }),
  waiting: Object.freeze({ x: .15, y: .55, w: 1.1, h: 0, lift: 0, yaw: .2, opacity: .09 }),
  'needs-input': VELA_SHAPES.attention,
  verified: VELA_SHAPES.verified,
  blocked: VELA_SHAPES.unavailable,
});

/** Identical analytic centerline/derivative in CPU bounds and GPU ribbon. */
export function velaCenter(
  t: number,
  shape: VelaShape,
  out: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0],
): readonly [number, number, number, number, number, number] {
  const s = Math.sin(t), c = Math.cos(t), s2 = Math.sin(2 * t), c2 = Math.cos(2 * t);
  out[0] = shape.x * s + shape.y * s2 * (.88 + .12 * c);
  out[1] = shape.w * c + shape.h * c2 + shape.lift * Math.sin(3 * t);
  out[2] = shape.yaw * s;
  out[3] = shape.x * c + shape.y * (2 * c2 * (.88 + .12 * c) - .12 * s2 * s);
  out[4] = -shape.w * s - 2 * shape.h * s2 + 3 * shape.lift * Math.cos(3 * t);
  out[5] = shape.yaw * c;
  return out;
}

export const velaCenterGLSL = /* glsl */ `
  uniform vec4 uShapeA;
  uniform vec3 uShapeB;
  vec3 velaCenter(float t) {
    return vec3(uShapeA.x * sin(t) + uShapeA.y * sin(2. * t) * (.88 + .12 * cos(t)),
      uShapeA.z * cos(t) + uShapeA.w * cos(2. * t) + uShapeB.x * sin(3. * t), uShapeB.y * sin(t));
  }
  vec3 velaDerivative(float t) {
    return vec3(uShapeA.x * cos(t) + uShapeA.y * (2. * cos(2. * t) * (.88 + .12 * cos(t)) - .12 * sin(2. * t) * sin(t)),
      -uShapeA.z * sin(t) - 2. * uShapeA.w * sin(2. * t) + 3. * uShapeB.x * cos(3. * t), uShapeB.y * cos(t));
  }
`;
