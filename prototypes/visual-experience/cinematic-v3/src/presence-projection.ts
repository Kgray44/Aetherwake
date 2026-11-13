import * as THREE from "three";
import { velaCenter, type VelaShape } from './vela-shape.ts';

export interface PresenceRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface RibbonPose {
  time: number;
  ambient: number;
  expression: { x: number; y: number; z: number; w: number };
  thinking?: number;
  shape?: VelaShape;
}
interface Samples {
  along: number[];
  frames: Float64Array;
  codes: Uint16Array;
  cosine: Float64Array;
  sine: Float64Array;
  points: Float64Array;
}

/** CPU evaluation of the production ribbonVertex surface, using the actual
 * Float32 parameter attributes and active LOD. Independent GPU-mask readback
 * verifies this evaluator against the unchanged production vertex shader. */
export class PresenceProjection {
  private caches = new Map<THREE.BufferAttribute, Samples>();
  private current?: Samples;
  private matrix = new THREE.Matrix4();
  private point = new THREE.Vector3();
  private readonly centerline: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
  sample(attribute: THREE.BufferAttribute, pose: RibbonPose) {
    let s = this.caches.get(attribute);
    if (!s) {
      const along: number[] = [],
        codes = new Uint16Array(attribute.count);
      const lookup = new Map<number, number>();
      const cosine = new Float64Array(attribute.count),
        sine = new Float64Array(attribute.count);
      for (let i = 0; i < attribute.count; i++) {
        const t = attribute.getX(i);
        if (!lookup.has(t)) {
          lookup.set(t, along.length);
          along.push(t);
        }
        codes[i] = lookup.get(t)!;
        cosine[i] = Math.cos(attribute.getY(i));
        sine[i] = Math.sin(attribute.getY(i));
      }
      s = {
        along,
        codes,
        cosine,
        sine,
        frames: new Float64Array(along.length * 13),
        points: new Float64Array(attribute.count * 3),
      };
      this.caches.set(attribute, s);
    }
    const { time, ambient: gain, expression: e, thinking = 0 } = pose;
    const morph = (seed: number, coil: number) => seed + (coil - seed) * thinking;
    const breathe = 1 + Math.sin(time * 0.56) * 0.03 * gain;
    const ex = (1 + e.x * 0.065) * (1 + e.w * 0.025) * breathe;
    const ey = (1 + e.y * 0.035) * (1 + e.w * 0.025) * breathe;
    const ez = (1 + e.w * 0.025) * breathe;
    for (let i = 0; i < s.along.length; i++) {
      const t = s.along[i],
        f = i * 13;
      const sin = Math.sin(t), cos = Math.cos(t);
      const sinDouble = Math.sin(2 * t), cosDouble = Math.cos(2 * t);
      const radius = 0.93 + 0.23 * cos, radiusDerivative = -0.23 * sin;
      const shaped = pose.shape ? velaCenter(t, pose.shape, this.centerline) : null;
      const cx = (shaped?.[0] ?? morph(1.13 * sinDouble * (0.88 + 0.12 * cos), radius * sinDouble)) * ex;
      const cy = (shaped?.[1] ?? morph(1.18 * cos + 0.12 * Math.sin(3 * t), radius * cosDouble)) * ey;
      const cz =
        (shaped?.[2] ?? morph(0.5 * sin, 0.52 * sin)) * ez +
        0.012 * Math.sin(3 * t) +
        0.065 * Math.sin(3 * t + time * 0.62) * gain;
      let tx =
        (shaped?.[3] ?? morph(2.26 * cosDouble * (0.88 + 0.12 * cos) - 0.1356 * sinDouble * sin,
          radiusDerivative * sinDouble + 2 * radius * cosDouble)) * ex;
      let ty = (shaped?.[4] ?? morph(-1.18 * sin + 0.36 * Math.cos(3 * t),
        radiusDerivative * cosDouble - 2 * radius * sinDouble)) * ey;
      let tz =
        (shaped?.[5] ?? morph(0.5 * cos, 0.52 * cos)) * ez +
        0.036 * Math.cos(3 * t) +
        0.195 * Math.cos(3 * t + time * 0.62) * gain;
      const length = Math.hypot(tx, ty, tz);
      tx /= length;
      ty /= length;
      tz /= length;
      const xy = Math.hypot(tx, ty),
        nx = ty / xy,
        ny = -tx / xy;
      const bx = -tz * ny,
        by = tz * nx,
        bz = tx * ny - ty * nx;
      const twist =
        t +
        0.31 * Math.sin(2 * t) +
        0.12 * Math.sin(3 * t) +
        0.1 * Math.sin(2 * t + time * 0.62) * gain +
        e.y * Math.sin(2 * t) * 0.045 +
        Math.sin(2 * t - time * 1.1) * e.z * 0.045;
      const c = Math.cos(twist),
        z = Math.sin(twist);
      const ax = nx * c + bx * z,
        ay = ny * c + by * z,
        az = bz * z;
      let sx = ty * az - tz * ay,
        sy = tz * ax - tx * az,
        sz = tx * ay - ty * ax;
      const skin = Math.hypot(sx, sy, sz);
      sx /= skin;
      sy /= skin;
      sz /= skin;
      const baseWidth = pose.shape?.opacity ?? .235;
      const width =
        (baseWidth + (pose.shape ? baseWidth * .4 : .095) * Math.cos(2 * t - 0.6)) *
        (1 + Math.sin(time * 0.64 + 2 * t) * 0.1 * gain) *
        (1 - e.y * 0.045 + e.x * 0.025 + e.w * 0.04);
      s.frames[f] = cx;
      s.frames[f + 1] = cy;
      s.frames[f + 2] = cz;
      s.frames[f + 3] = ax;
      s.frames[f + 4] = ay;
      s.frames[f + 5] = az;
      s.frames[f + 6] = bx;
      s.frames[f + 7] = by;
      s.frames[f + 8] = bz;
      s.frames[f + 9] = sx;
      s.frames[f + 10] = sy;
      s.frames[f + 11] = sz;
      s.frames[f + 12] = width;
    }
    for (let i = 0; i < attribute.count; i++) {
      const f = s.codes[i] * 13,
        v = s.cosine[i],
        thick = s.sine[i] * 0.014;
      for (let k = 0; k < 3; k++)
        s.points[i * 3 + k] =
          s.frames[f + k] +
          s.frames[f + 3 + k] * v * s.frames[f + 12] +
          s.frames[f + 6 + k] * v * v * 0.055 +
          s.frames[f + 9 + k] * thick;
    }
    this.current = s;
  }
  project(
    mesh: THREE.Object3D,
    camera: THREE.PerspectiveCamera,
    width: number,
    height: number,
    out: PresenceRect,
  ) {
    mesh.updateWorldMatrix(true, false);
    this.matrix
      .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      .multiply(mesh.matrixWorld);
    const m = this.matrix.elements,
      points = this.current!.points;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (let i = 0; i < points.length; i += 3) {
      const x = points[i],
        y = points[i + 1],
        z = points[i + 2];
      const w = m[3] * x + m[7] * y + m[11] * z + m[15];
      const px =
        (((m[0] * x + m[4] * y + m[8] * z + m[12]) / w) * 0.5 + 0.5) * width;
      const py =
        (0.5 - ((m[1] * x + m[5] * y + m[9] * z + m[13]) / w) * 0.5) * height;
      minX = Math.min(minX, px);
      minY = Math.min(minY, py);
      maxX = Math.max(maxX, px);
      maxY = Math.max(maxY, py);
    }
    Object.assign(out, { x: minX, y: minY, w: maxX - minX, h: maxY - minY });
    return out;
  }
  fit(
    root: THREE.Object3D,
    mesh: THREE.Object3D,
    camera: THREE.PerspectiveCamera,
    width: number,
    height: number,
    target: PresenceRect,
    out: PresenceRect,
  ) {
    const margin = Math.min(1, target.w * 0.05, target.h * 0.05);
    let iterations = 0,
      scaleCorrection = 1;
    this.project(mesh, camera, width, height, out);
    for (; iterations < 6; iterations++) {
      const fit = Math.min(
        1,
        (target.w - 2 * margin) / out.w,
        (target.h - 2 * margin) / out.h,
      );
      if (fit < 1) {
        const correction = fit * 0.999;
        root.scale.multiplyScalar(correction);
        scaleCorrection *= correction;
        this.project(mesh, camera, width, height, out);
      }
      const dx = target.x + target.w * 0.5 - out.x - out.w * 0.5;
      const dy = target.y + target.h * 0.5 - out.y - out.h * 0.5;
      this.point
        .setFromMatrixPosition(root.matrixWorld)
        .applyMatrix4(camera.matrixWorldInverse);
      const unit =
        (2 *
          -this.point.z *
          Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5))) /
        height;
      this.point.x += dx * unit;
      this.point.y -= dy * unit;
      this.point.applyMatrix4(camera.matrixWorld);
      if (root.parent) root.parent.worldToLocal(this.point);
      root.position.copy(this.point);
      this.project(mesh, camera, width, height, out);
      const error = Math.hypot(
        target.x + target.w * 0.5 - out.x - out.w * 0.5,
        target.y + target.h * 0.5 - out.y - out.h * 0.5,
      );
      if (
        error < 0.02 &&
        out.w <= target.w - 2 * margin + 0.01 &&
        out.h <= target.h - 2 * margin + 0.01
      )
        break;
    }
    return {
      iterations: iterations + 1,
      scaleCorrection,
      margin,
      centerErrorCssPx: Math.hypot(
        target.x + target.w * 0.5 - out.x - out.w * 0.5,
        target.y + target.h * 0.5 - out.y - out.h * 0.5,
      ),
      overflowCssPx: Math.max(
        0,
        target.x - out.x,
        target.y - out.y,
        out.x + out.w - target.x - target.w,
        out.y + out.h - target.y - target.h,
      ),
      target: { ...target },
    };
  }
  diagnostics() {
    return {
      cachedLods: this.caches.size,
      sampledVertices: (this.current?.points.length ?? 0) / 3,
      method:
        "current production-shader-deformed LOD vertex projection; independent native GPU mask readback available for validation",
    };
  }
  dispose() {
    this.caches.clear();
    this.current = undefined;
  }
}
