import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { PresenceProjection } from "../src/presence-projection.ts";
function parameters(along, across) {
  const g = new THREE.PlaneGeometry(1, 1, along, across),
    p = g.getAttribute("position");
  for (let i = 0; i < p.count; i++)
    p.setXYZ(
      i,
      (p.getX(i) + 0.5) * Math.PI * 2,
      (p.getY(i) + 0.5) * Math.PI * 2,
      0,
    );
  return g;
}
test("current deformed LOD vertices remain centered and contained after late rotation across phases, views, zooms and offscreen placements", () => {
  const sampler = new PresenceProjection(),
    scene = new THREE.Scene(),
    root = new THREE.Group();
  scene.add(root);
  const mesh = new THREE.Mesh();
  root.add(mesh);
  const out = { x: 0, y: 0, w: 0, h: 0 };
  let cases = 0;
  for (const lod of [
    [320, 20],
    [256, 16],
    [128, 12],
  ]) {
    const g = parameters(...lod);
    mesh.geometry = g;
    for (const [width, height] of [
      [1600, 1000],
      [800, 1100],
      [2600, 900],
    ]) {
      const camera = new THREE.PerspectiveCamera(39, width / height, 0.1, 100);
      camera.position.set(0.02, 1.8, 9);
      camera.lookAt(0, 0.35, 0);
      camera.updateMatrixWorld();
      for (let phase = 0; phase < 12; phase++)
        for (const zoom of [0.125, 0.5, 1, 2]) {
          sampler.sample(g.getAttribute("position"), {
            time: phase * 4.7,
            ambient: 1.5,
            expression: { x: 0.8, y: -0.6, z: 0.7, w: 0.25 },
          });
          for (const [x, y] of [
            [-25, -15],
            [width * 0.48, height * 0.3],
            [width - 240, height - 280],
          ]) {
            root.position.set(1.35, 1.68, 0.1);
            root.scale.setScalar(0.91 * 0.65);
            root.rotation.set(
              -0.18 + Math.sin(phase) * 0.1,
              -0.35 + Math.cos(phase) * 0.25,
              -0.13 + Math.sin(phase * 0.7) * 0.1,
            );
            const target = { x, y, w: 208 * zoom, h: 204 * zoom };
            const fit = sampler.fit(
              root,
              mesh,
              camera,
              width,
              height,
              target,
              out,
            );
            assert(Object.values(out).every(Number.isFinite));
            assert(
              fit.centerErrorCssPx < 0.03,
              JSON.stringify({ phase, zoom, fit }),
            );
            assert(
              fit.overflowCssPx < 0.01,
              JSON.stringify({ phase, zoom, fit }),
            );
            assert(
              fit.scaleCorrection <= 1,
              "fitting cannot cancel the requested65% scale by enlarging it",
            );
            cases++;
          }
        }
    }
    g.dispose();
  }
  assert.equal(cases, 1296);
  assert.equal(sampler.diagnostics().cachedLods, 3);
  sampler.dispose();
  assert.equal(sampler.diagnostics().cachedLods, 0);
});
