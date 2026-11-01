import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  CelestialEnvironment,
  generateCelestialCatalog,
  GALACTIC_NORMAL,
} from "../src/celestial-environment.ts";

const frame = {
  study: "starlit",
  quality: "balanced",
  focus: 0,
  weight: 1,
  time: 0,
  ambientStrength: 1,
};

test("celestial catalogs are deterministic and preserve rare bright points among a mostly faint, naturally concentrated population", () => {
  const a = generateCelestialCatalog(2048, 731);
  const b = generateCelestialCatalog(2048, 731);
  assert.deepEqual(a, b);
  assert.notDeepEqual(
    a.positions,
    generateCelestialCatalog(2048, 732).positions,
  );
  const catalog = generateCelestialCatalog();
  let faint = 0,
    bright = 0,
    band = 0,
    polar = 0;
  for (let i = 0; i < catalog.luminances.length; i++) {
    const x = catalog.positions[i * 3],
      y = catalog.positions[i * 3 + 1],
      z = catalog.positions[i * 3 + 2];
    const distance = Math.hypot(x, y, z);
    assert(Number.isFinite(distance));
    assert(distance >= 1099.99 && distance <= 2300.01);
    const latitude = Math.abs(
      (x * GALACTIC_NORMAL.x + y * GALACTIC_NORMAL.y + z * GALACTIC_NORMAL.z) /
        distance,
    );
    band += latitude < 0.12;
    polar += latitude > 0.6;
    const luminance = catalog.luminances[i];
    assert(
      Number.isFinite(luminance) &&
        luminance >= 0.00999 &&
        luminance <= 1.10001,
    );
    if (i) assert(luminance <= catalog.luminances[i - 1]);
    faint += luminance < 0.03;
    bright += luminance > 0.2;
    assert(
      catalog.sizes[i] > 1.3 && catalog.sizes[i] <= 3.80001,
      "faint stars need a resolvable optical footprint rather than vanishing subpixel kernels",
    );
    for (let channel = 0; channel < 3; channel++) {
      const color = catalog.colors[i * 3 + channel];
      assert(Number.isFinite(color) && color >= 0.75 && color <= 1);
    }
  }
  assert(
    faint > catalog.luminances.length * 0.75,
    "most stars must remain faint",
  );
  assert(
    bright > 0 && bright < catalog.luminances.length * 0.01,
    "bright optical anchors must be sparse",
  );
  // Both regions' spherical solid angles are known fractions of a sphere.
  // Count per solid angle, rather than comparing unequal sky areas directly.
  assert(
    band / 0.12 > (polar / 0.4) * 2,
    "the catalog must not be uniform random dots",
  );
  assert(
    polar > 1000,
    "the background must remain spatially populated beyond one band",
  );
  for (const count of [-1, 0.5, NaN, 24001])
    assert.throws(() => generateCelestialCatalog(count));
});

test("quality and study changes reuse the same two GPU batches and stable stellar geometry", () => {
  const sky = new CelestialEnvironment();
  const camera = new THREE.PerspectiveCamera(39, 1.6, 0.1, 100);
  const before = sky.scene.children.map((object) => ({
    object,
    geometry: object.geometry,
    material: object.material,
  }));
  const stars = sky.scene.getObjectByName("celestial-stars");
  const positions = stars.geometry.getAttribute("aPosition").array;
  const colors = stars.geometry.getAttribute("aColor").array;
  const frozenPositions = positions.slice();
  const frozenColors = colors.slice();
  const counts = [];
  try {
    for (const quality of ["efficient", "balanced", "cinematic"]) {
      for (const study of ["starlit", "shadow", "deep"]) {
        sky.update(camera, { ...frame, quality, study });
        const diagnostic = sky.diagnostics();
        assert.equal(diagnostic.batches, 2);
        assert.equal(diagnostic.geometryAllocations, 2);
        assert.equal(diagnostic.textureAllocations, 0);
        assert(diagnostic.catalogBytes < 1024 * 1024);
        assert(diagnostic.activeStars <= diagnostic.starCapacity);
      }
      counts.push(sky.diagnostics().activeStars);
    }
    assert(counts[0] >= 6000 && counts[0] < counts[1] && counts[1] < counts[2]);
    assert.deepEqual(
      sky.scene.children,
      before.map((entry) => entry.object),
    );
    for (const entry of before) {
      assert.equal(entry.object.geometry, entry.geometry);
      assert.equal(entry.object.material, entry.material);
    }
    assert.equal(stars.geometry.getAttribute("aPosition").array, positions);
    assert.equal(stars.geometry.getAttribute("aColor").array, colors);
    assert.deepEqual(positions, frozenPositions);
    assert.deepEqual(colors, frozenColors);
  } finally {
    sky.dispose();
  }
});

test("infinite-distance sky cancels camera translation but follows actual world orientation and viewport projection", () => {
  const sky = new CelestialEnvironment();
  const rig = new THREE.Group();
  const camera = new THREE.PerspectiveCamera(39, 1.6, 0.1, 100);
  rig.rotation.set(0.1, -0.2, 0.03);
  camera.rotation.set(-0.04, 0.07, 0);
  rig.add(camera);
  try {
    sky.update(camera, frame);
    const direction = new THREE.Vector3(120, 80, -1500);
    const initial = direction.clone().project(sky.camera);
    const orientation = new THREE.Quaternion();
    camera.getWorldQuaternion(orientation);
    assert(sky.camera.quaternion.angleTo(orientation) < 1e-7);
    rig.position.set(85, -23, 140);
    camera.position.set(4, -2, 12);
    sky.update(camera, frame);
    assert(sky.camera.position.length() === 0);
    assert(direction.clone().project(sky.camera).distanceTo(initial) < 1e-10);
    rig.rotation.y += 0.015;
    sky.update(camera, frame);
    camera.getWorldQuaternion(orientation);
    assert(sky.camera.quaternion.angleTo(orientation) < 1e-7);
    assert(direction.clone().project(sky.camera).distanceTo(initial) > 0.001);
    camera.aspect = 0.9;
    camera.fov = 46;
    camera.zoom = 1.2;
    sky.update(camera, frame);
    assert.equal(sky.camera.aspect, camera.aspect);
    assert.equal(sky.camera.fov, camera.fov);
    assert.equal(sky.camera.zoom, camera.zoom);
    assert(
      sky.camera.far > 2300,
      "the foreground camera far plane must not clip the cosmos",
    );
    assert.equal(
      sky.camera.layers.mask,
      1,
      "sky stays on its independent scene's default layer",
    );
  } finally {
    sky.dispose();
  }
});

test("time and ambient scheduling never invent stellar twinkle or regenerate positions, while focus reduces salience", () => {
  const sky = new CelestialEnvironment();
  const camera = new THREE.PerspectiveCamera();
  try {
    sky.update(camera, frame);
    const stars = sky.scene.getObjectByName("celestial-stars");
    const dome = sky.scene.getObjectByName("celestial-dust-dome");
    const positions = stars.geometry.getAttribute("aPosition").array.slice();
    const gain = stars.material.uniforms.uGain.value;
    const emphasis = stars.material.uniforms.uEmphasis.value;
    for (const time of [30, 12000, 1e9]) {
      sky.update(camera, { ...frame, time, ambientStrength: time % 2 });
      assert.equal(stars.material.uniforms.uGain.value, gain);
      assert.equal(stars.material.uniforms.uEmphasis.value, emphasis);
      assert.deepEqual(
        stars.geometry.getAttribute("aPosition").array,
        positions,
      );
    }
    sky.update(camera, { ...frame, focus: 1 });
    assert(stars.material.uniforms.uEmphasis.value < emphasis * 0.3);
    assert(dome.material.uniforms.uEmphasis.value < emphasis * 0.3);
    sky.update(camera, { ...frame, weight: 0 });
    assert.equal(stars.material.uniforms.uEmphasis.value, 0);
    assert.equal(dome.material.uniforms.uWeight.value, 0);
    // A hidden sky requires no renderer, performs no draw, and cannot replace
    // Living Intelligence's existing clear color with an opaque black dome.
    assert.doesNotThrow(() =>
      sky.render(undefined, camera, { ...frame, weight: 0 }),
    );
    assert.equal(sky.diagnostics().batches, 0);
    assert.equal(sky.diagnostics().activeStars, 0);
    assert.equal(sky.diagnostics().renderedStars, 0);
    assert.equal(sky.diagnostics().renderedFrames, 0);
    assert(sky.diagnostics().configuredStars > 6000);
    sky.update(camera, { ...frame, weight: 0.5 });
    assert.equal(dome.material.uniforms.uWeight.value, 0.5);
    assert.equal(
      dome.material.uniforms.uEmphasis.value,
      1,
      "crossfade uses alpha, not a black radiance multiplier",
    );
  } finally {
    sky.dispose();
  }
});

test("celestial resources dispose once without leaving hidden geometry or a renderer loop", () => {
  const sky = new CelestialEnvironment();
  let disposals = 0;
  for (const object of sky.scene.children) {
    object.geometry.addEventListener("dispose", () => disposals++);
    object.material.addEventListener("dispose", () => disposals++);
  }
  sky.dispose();
  sky.dispose();
  assert.equal(disposals, 4);
  assert.equal(sky.scene.children.length, 0);
  assert.equal(sky.diagnostics().activeStars, 0);
  assert.equal(sky.diagnostics().batches, 0);
  assert.throws(
    () => sky.update(new THREE.PerspectiveCamera(), frame),
    /disposed/,
  );
});
