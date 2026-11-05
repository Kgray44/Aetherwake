import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { VELA_SHAPES, velaCenter } from '../src/vela-shape.ts';
import { MotionCoordinator } from '../src/motion.ts';
import { PresenceProjection } from '../src/presence-projection.ts';

test('every current operational silhouette is distinct and analytic tangents match the centerline', () => {
  const signatures = new Set();
  for (const shape of Object.values(VELA_SHAPES)) {
    const outline = [];
    for (let n = 0; n < 128; n++) {
      const t = n / 128 * Math.PI * 2, p = velaCenter(t, shape), a = velaCenter(t - .00001, shape), b = velaCenter(t + .00001, shape);
      assert(p.every(Number.isFinite));
      for (let k = 0; k < 3; k++) assert(Math.abs((b[k] - a[k]) / .00002 - p[k + 3]) < 1e-7);
      assert(Math.hypot(p[3], p[4]) > .001, 'transport frame must not be singular');
      outline.push(p[0].toFixed(3), p[1].toFixed(3));
    }
    signatures.add(outline.join(','));
  }
  assert.equal(signatures.size, 8);
  assert(VELA_SHAPES.working.w < VELA_SHAPES.receiving.w * .6, 'working contracts into a focused lens');
});

test('state retargeting preserves displayed harmonic coefficients and velocity; reduced motion is immediate', () => {
  const motion = new MotionCoordinator(); motion.add('shape', { ...VELA_SHAPES.idle });
  motion.target('shape', { ...VELA_SHAPES.receiving }, 'observed input'); motion.step(.03);
  const displayed = motion.pose('shape'), velocity = motion.bodies.get('shape').channels.x.velocity;
  motion.target('shape', { ...VELA_SHAPES.working }, 'observed work');
  assert.deepEqual(motion.pose('shape'), displayed);
  assert.equal(motion.bodies.get('shape').channels.x.velocity, velocity);
  motion.reduced = true; motion.target('shape', { ...VELA_SHAPES.unavailable }, 'disconnected');
  assert.deepEqual(motion.pose('shape'), VELA_SHAPES.unavailable);
});

test('production CPU bounds contain every silhouette and intermediate morph at small and large native placements', () => {
  const sampler = new PresenceProjection(), geometry = new THREE.PlaneGeometry(1, 1, 128, 12), parameters = geometry.getAttribute('position');
  for (let i = 0; i < parameters.count; i++) parameters.setXYZ(i, (parameters.getX(i) + .5) * 2 * Math.PI, (parameters.getY(i) + .5) * 2 * Math.PI, 0);
  const root = new THREE.Group(), mesh = new THREE.Mesh(geometry); root.add(mesh);
  const camera = new THREE.PerspectiveCamera(39, 1.6, .1, 100); camera.position.set(.02, 1.8, 9); camera.lookAt(0, .35, 0); camera.updateMatrixWorld();
  const values = Object.values(VELA_SHAPES), out = { x: 0, y: 0, w: 0, h: 0 };
  for (const from of values) for (const to of values) for (const mix of [0, .25, .5, .75, 1]) {
    const shape = Object.fromEntries(Object.keys(from).map(k => [k, from[k] + (to[k] - from[k]) * mix]));
    sampler.sample(parameters, { time: 3.4, ambient: 1.5, expression: { x: .7, y: .8, z: .5, w: .2 }, shape });
    for (const size of [36, 208, 640]) {
      root.position.set(1.35, 1.68, .1); root.scale.setScalar(.91); root.rotation.set(-.18, -.35, -.13);
      const fit = sampler.fit(root, mesh, camera, 1600, 1000, { x: 800, y: 120, w: size, h: size }, out);
      assert(Object.values(out).every(Number.isFinite));
      assert(fit.centerErrorCssPx < .03); assert(fit.overflowCssPx < .01);
    }
  }
  sampler.dispose(); geometry.dispose();
});
