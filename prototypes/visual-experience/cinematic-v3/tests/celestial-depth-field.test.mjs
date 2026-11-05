import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { CelestialEnvironment } from "../src/celestial-environment.ts";
import {
  CelestialDepthField,
  CELESTIAL_DEPTH_CAPACITY,
  generateCelestialDepthCatalog,
} from "../src/celestial-depth-field.ts";

const frame = { study: "starlit", quality: "balanced", focus: 0, weight: 1 };
const renderer = () => ({
  calls: [],
  getDrawingBufferSize(out) {
    return out.set(1600, 1000);
  },
  getPixelRatio() {
    return 1.25;
  },
  render(scene, camera) {
    this.calls.push({ scene, camera });
  },
});

test("finite dust is sparse, deterministic, world-fixed and bounded", () => {
  const a = generateCelestialDepthCatalog();
  assert.deepEqual(a, generateCelestialDepthCatalog());
  assert.notDeepEqual(
    a.positions,
    generateCelestialDepthCatalog(48, 123).positions,
  );
  assert.equal(a.positions.length, CELESTIAL_DEPTH_CAPACITY * 3);
  for (let i = 0; i < CELESTIAL_DEPTH_CAPACITY; i++) {
    const center = new THREE.Vector3().fromArray(a.positions, i * 3);
    const u = new THREE.Vector3().fromArray(a.axesU, i * 3);
    const v = new THREE.Vector3().fromArray(a.axesV, i * 3);
    assert(center.length() >= 7999 && center.length() < 71000);
    assert(u.length() > 90 && u.length() < 2100);
    assert(
      v.length() / u.length() >= 0.13999 && v.length() / u.length() <= 0.30001,
    );
    assert(Math.abs(u.clone().normalize().dot(v.clone().normalize())) < 1e-6);
    assert(a.opacities[i] >= 0.02499 && a.opacities[i] <= 0.06001);
    assert(Math.abs(a.radii[i] - u.length()) < 0.001);
  }
  for (const count of [-1, 0.5, NaN, 49])
    assert.throws(() => generateCelestialDepthCatalog(count));
});

test("quality, opacity and repeated updates reuse one mesh without moving its world structure", () => {
  const field = new CelestialDepthField();
  const mesh = field.mesh,
    geometry = mesh.geometry,
    material = mesh.material;
  const centers = geometry.getAttribute("aCenter").array;
  const frozen = centers.slice();
  try {
    assert.equal(field.diagnostics().active, false);
    for (const quality of ["efficient", "balanced", "cinematic", "efficient"]) {
      for (const intensity of [0, 0.25, 1, 0.75]) {
        field.update(intensity, quality);
        assert.equal(field.mesh, mesh);
        assert.equal(mesh.geometry, geometry);
        assert.equal(mesh.material, material);
        assert.equal(geometry.getAttribute("aCenter").array, centers);
        assert.deepEqual(centers, frozen);
        assert.equal(material.uniforms.uWeight.value, intensity);
        assert.equal(geometry.instanceCount, 48);
      }
    }
    field.update(NaN, "balanced");
    assert.equal(field.diagnostics().active, false);
  } finally {
    field.dispose();
  }
});

test("existing celestial render borrows the exact prepared navigation camera for finite depth", () => {
  const sky = new CelestialEnvironment();
  const fallback = new THREE.PerspectiveCamera(39, 1.6, 0.1, 100);
  const navigation = new THREE.PerspectiveCamera(43, 1.6, 1, 180000);
  navigation.position.set(12000, 7000, 21000);
  navigation.lookAt(1200, 300, -900);
  const pose = [navigation.position.toArray(), navigation.quaternion.toArray()];
  const output = renderer();
  try {
    sky.render(output, fallback, { ...frame, spatialCamera: navigation });
    assert.equal(
      output.calls.length,
      2,
      "existing far pass plus one finite batch",
    );
    assert.equal(output.calls[0].camera, sky.camera);
    assert.equal(
      output.calls[1].camera,
      navigation,
      "no reconstructed or competing camera",
    );
    assert.equal(
      output.calls[1].scene.children[0].name,
      "celestial-finite-dust",
    );
    assert.deepEqual(
      [navigation.position.toArray(), navigation.quaternion.toArray()],
      pose,
    );
    assert.equal(sky.camera.fov, navigation.fov);
    assert.equal(sky.camera.aspect, navigation.aspect);
    assert.equal(sky.camera.position.length(), 0);
    assert(sky.camera.quaternion.angleTo(navigation.quaternion) < 1e-7);
    assert.equal(sky.diagnostics().batches, 3);
    // A retained camera is still valid when the host hides navigable objects
    // for focused work. Celestial rendering has no graph.active visibility gate.
    output.calls.length = 0;
    sky.render(output, fallback, {
      ...frame,
      spatialCamera: navigation,
      time: 1e9,
    });
    assert.equal(output.calls[1].camera, navigation);
  } finally {
    sky.dispose();
  }
});

test("translation produces finite world parallax while original far stars stay translation-invariant", () => {
  const sky = new CelestialEnvironment();
  const fallback = new THREE.PerspectiveCamera();
  const navigation = new THREE.PerspectiveCamera(43, 1.6, 1, 180000);
  const output = renderer();
  try {
    sky.render(output, fallback, { ...frame, spatialCamera: navigation });
    const mesh = output.calls[1].scene.children[0];
    const center = new THREE.Vector3().fromBufferAttribute(
      mesh.geometry.getAttribute("aCenter"),
      0,
    );
    navigation.position.copy(center).add(new THREE.Vector3(0, 0, 20000));
    navigation.lookAt(center);
    sky.update(fallback, { ...frame, spatialCamera: navigation });
    const beforeFinite = center.clone().project(navigation);
    const farDirection = new THREE.Vector3(120, 70, -1600);
    const beforeFar = farDirection.clone().project(sky.camera);
    const positions = sky.scene
      .getObjectByName("celestial-stars")
      .geometry.getAttribute("aPosition").array;
    const frozen = positions.slice();
    navigation.position.x += 500;
    sky.update(fallback, { ...frame, spatialCamera: navigation });
    assert(center.clone().project(navigation).distanceTo(beforeFinite) > 0.02);
    assert(
      farDirection.clone().project(sky.camera).distanceTo(beforeFar) < 1e-10,
    );
    assert.deepEqual(positions, frozen);
    assert.equal(mesh.geometry.getAttribute("aCenter").array[0], center.x);
  } finally {
    sky.dispose();
  }
});

test("full yaw rotations share one stable stellar reference and finite catalog", () => {
  const sky = new CelestialEnvironment();
  const navigation = new THREE.PerspectiveCamera(43, 1.6, 1, 180000);
  const fallback = new THREE.PerspectiveCamera();
  const reference = new THREE.Vector3(120, 70, -1600);
  let initial;
  try {
    for (let step = 0; step <= 16; step++) {
      navigation.rotation.set(0.2, (step * Math.PI) / 8, 0, "YXZ");
      sky.update(fallback, { ...frame, spatialCamera: navigation });
      assert(sky.camera.quaternion.angleTo(navigation.quaternion) < 1e-7);
      const p = reference.clone().project(sky.camera);
      if (!step) initial = p;
      if (step === 16) assert(p.distanceTo(initial) < 1e-10);
    }
  } finally {
    sky.dispose();
  }
});

test("missing navigation, zero salience and disposal add no finite draw or hidden lifecycle", () => {
  const sky = new CelestialEnvironment();
  const camera = new THREE.PerspectiveCamera();
  const output = renderer();
  sky.render(output, camera, frame);
  assert.equal(output.calls.length, 1);
  assert.equal(sky.diagnostics().finiteDepth.active, false);
  sky.render(output, camera, { ...frame, weight: 0, spatialCamera: camera });
  assert.equal(output.calls.length, 1);
  assert.equal(sky.diagnostics().finiteDepth.active, false);
  sky.dispose();
  sky.dispose();
  assert.equal(sky.diagnostics().geometryAllocations, 0);
  assert.equal(sky.diagnostics().finiteDepth.geometryAllocations, 0);
  assert.equal(sky.diagnostics().finiteDepth.disposed, true);
  assert.equal(sky.diagnostics().finiteDepth.instances, 0);
});
