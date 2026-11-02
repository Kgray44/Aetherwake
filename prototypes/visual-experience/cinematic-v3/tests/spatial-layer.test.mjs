import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import * as THREE from "three";
import { projectSurfacePoint } from "../src/material-compositing.ts";
const url = new URL("../src/renderer.ts", import.meta.url);
const compiled = { exports: {} };
new Function(
  "require",
  "exports",
  "module",
  ts.transpileModule(readFileSync(url, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText,
)(createRequire(url), compiled.exports, compiled);
const { Environment } = compiled.exports;
test("GPU surface matrix and DOM silhouette agree for yaw, planar rotation, lift and global arrival projection", () => {
  const camera = new THREE.PerspectiveCamera(39, 1.6, 0.1, 100);
  camera.position.set(0.3, 1.8, 12);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const host = {
    camera,
    width: 1600,
    height: 1000,
    surfaceProjection: new THREE.Matrix4(),
    surfaceRotation: new THREE.Matrix4(),
    surfaceYaw: new THREE.Matrix4(),
    surfaceScreen: new THREE.Matrix4(),
    surfaceWorld: new THREE.Matrix4(),
    surfaceView: { scale: 0.83, originX: 700, originY: 340 },
  };
  for (const yaw of [-22, 0, 18])
    for (const rotation of [-31, 0, 41])
      for (const lift of [0, 35]) {
        const p = { x: 370, y: 310, w: 420, h: 260, yaw, rotation, lift };
        const matrix = Environment.prototype.surfaceMatrix.call(
          host,
          p.x + p.w / 2,
          p.y + p.h / 2,
          lift,
          yaw,
          7,
          rotation,
        );
        for (const [x, y] of [
          [0, 0],
          [-130, -70],
          [160, 90],
        ]) {
          const actual = new THREE.Vector3(x, -y, 0)
            .applyMatrix4(matrix)
            .project(camera);
          const expected = projectSurfacePoint(p, x, y),
            v = host.surfaceView;
          assert(
            Math.abs(
              (actual.x * 0.5 + 0.5) * 1600 -
                (v.originX + (expected.x - v.originX) * v.scale),
            ) < 1e-7,
          );
          assert(
            Math.abs(
              (0.5 - actual.y * 0.5) * 1000 -
                (v.originY + (expected.y - v.originY) * v.scale),
            ) < 1e-7,
          );
        }
      }
});
function fixture(layer) {
  let target = "host-target",
    cube = 2,
    mip = 1,
    scissorTest = true,
    viewport = new THREE.Vector4(2, 3, 1400, 800),
    scissor = new THREE.Vector4(20, 30, 400, 500),
    clear = new THREE.Color(0.2, 0.3, 0.4),
    alpha = 0.6;
  const calls = [];
  const renderer = {
    autoClear: false,
    getRenderTarget: () => target,
    getActiveCubeFace: () => cube,
    getActiveMipmapLevel: () => mip,
    getScissorTest: () => scissorTest,
    getViewport: (v) => v.copy(viewport),
    getScissor: (v) => v.copy(scissor),
    getClearColor: (c) => c.copy(clear),
    getClearAlpha: () => alpha,
    clearDepth: () => calls.push("depth"),
    setRenderTarget: (t, c, m) => {
      target = t;
      cube = c;
      mip = m;
    },
    setViewport: (v) => viewport.copy(v),
    setScissor: (v) => scissor.copy(v),
    setScissorTest: (v) => (scissorTest = v),
    setClearColor: (v, a) => {
      clear.copy(v);
      alpha = a;
    },
  };
  const host = {
    renderer,
    spatialLayer: layer,
    spatialLayerFailed: false,
    savedViewport: new THREE.Vector4(),
    savedScissor: new THREE.Vector4(),
    savedClearColor: new THREE.Color(),
  };
  return {
    host,
    renderer,
    calls,
    state: () => ({
      target,
      cube,
      mip,
      scissorTest,
      viewport: viewport.toArray(),
      scissor: scissor.toArray(),
      clear: clear.toArray(),
      alpha,
      autoClear: renderer.autoClear,
    }),
  };
}
test("shared-context layer restores host target, viewport, scissor and clear state", () => {
  let received;
  const f = fixture({
    active: true,
    render: (r, frame) => {
      received = frame;
      r.autoClear = true;
      r.setRenderTarget(null, 0, 0);
      r.setViewport(new THREE.Vector4(0, 0, 20, 20));
      r.setScissorTest(false);
      r.setClearColor(new THREE.Color(1, 0, 0), 1);
    },
  });
  const before = f.state(),
    frame = {
      width: 1600,
      height: 1000,
      time: 23,
      quality: "balanced",
      reduced: false,
      quiet: true,
    };
  Environment.prototype.renderSpatialLayer.call(f.host, frame);
  assert.deepEqual(f.state(), before);
  assert.deepEqual(received, frame);
  assert.equal(f.calls.length, 2);
  assert.equal(f.host.spatialLayerFailed, false);
});
test("layer failure is contained and render state is restored before foreground work", () => {
  const f = fixture({
      active: true,
      render: (r) => {
        r.autoClear = true;
        throw Error("synthetic layer failure");
      },
    }),
    before = f.state();
  Environment.prototype.renderSpatialLayer.call(f.host, {
    width: 1,
    height: 1,
    time: 0,
    quality: "efficient",
    reduced: true,
  });
  assert.deepEqual(f.state(), before);
  assert.equal(f.host.spatialLayerFailed, true);
  Environment.prototype.renderSpatialLayer.call(f.host, {});
  assert.equal(f.calls.length, 2);
});
test("spatial layer attachment is stable and lifetime stays with its application owner", () => {
  let lost = 0,
    disposed = 0;
  const layer = {
      active: false,
      render() {},
      contextLost() {
        lost++;
      },
      dispose() {
        disposed++;
      },
    },
    host = { spatialLayer: null, spatialLayerFailed: true, lost: true };
  Environment.prototype.setSpatialLayer.call(host, layer);
  Environment.prototype.setSpatialLayer.call(host, layer);
  assert.equal(lost, 1);
  assert.equal(host.spatialLayerFailed, false);
  Environment.prototype.setSpatialLayer.call(host, null);
  assert.equal(disposed, 0);
});
