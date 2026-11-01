import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { OrbitalArchitecture } from "../src/orbital-architecture.ts";

const frame = {
  concept: "ring",
  quality: "balanced",
  focus: 0,
  time: 12,
  ambientStrength: 1,
  energy: 0.22,
};

test("architectural shells retain finite, outward-facing normals and bounded geometry", () => {
  const architecture = new OrbitalArchitecture();
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  const ab = new THREE.Vector3(),
    ac = new THREE.Vector3(),
    normal = new THREE.Vector3();
  const seen = new Set();
  architecture.root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || seen.has(object.geometry)) return;
    seen.add(object.geometry);
    const geometry = object.geometry,
      position = geometry.getAttribute("position"),
      normals = geometry.getAttribute("normal"),
      index = geometry.index;
    assert(position.count < 20000, "one structural object must remain bounded");
    for (const value of position.array) assert(Number.isFinite(value));
    for (let i = 0; i < normals.count; i++) {
      normal.fromBufferAttribute(normals, i);
      assert(
        Math.abs(normal.length() - 1) < 0.001,
        "lighting normals must be normalized",
      );
    }
    if (!index) return;
    for (let i = 0; i < index.count; i += 3) {
      a.fromBufferAttribute(position, index.getX(i));
      b.fromBufferAttribute(position, index.getX(i + 1));
      c.fromBufferAttribute(position, index.getX(i + 2));
      ab.subVectors(b, a);
      ac.subVectors(c, a);
      normal.fromBufferAttribute(normals, index.getX(i));
      assert(
        ab.cross(ac).dot(normal) >= -0.000001,
        "front-face winding must agree with lighting normals",
      );
    }
  });
  architecture.dispose();
});

test("all architectural concepts retain structural identity in Efficient and reuse geometry across repeated switching", () => {
  const architecture = new OrbitalArchitecture();
  const before = new Set();
  architecture.root.traverse((object) => {
    if (object instanceof THREE.Mesh) before.add(object.geometry);
  });
  for (const concept of ["ring", "aperture", "observatory"]) {
    architecture.update({ ...frame, concept, quality: "cinematic" });
    const rich = architecture.diagnostics();
    architecture.update({
      ...frame,
      concept,
      quality: "efficient",
      ambientStrength: 0,
    });
    const efficient = architecture.diagnostics();
    assert(
      efficient.drawObjects >= 6,
      "the essential architecture must survive quality reduction",
    );
    assert(efficient.triangles > 2000);
    assert(efficient.drawObjects < rich.drawObjects);
    assert(efficient.triangles < rich.triangles);
    assert.equal(
      efficient.opticalClockSeconds,
      rich.opticalClockSeconds,
      "Quiet/reduced input must freeze the current optical phase",
    );
    assert.equal(
      architecture.root.children.filter(
        (object) => object.visible && object.name.startsWith("architecture-"),
      ).length,
      1,
    );
  }
  const after = new Set();
  architecture.root.traverse((object) => {
    if (object instanceof THREE.Mesh) after.add(object.geometry);
  });
  assert.deepEqual(
    after,
    before,
    "scene/tier switches must not allocate replacement geometry",
  );
  architecture.dispose();
  architecture.dispose();
  assert.equal(architecture.root.children.length, 0);
});

test("optical motion freezes without resetting and resumes without a wall-clock jump", () => {
  const architecture = new OrbitalArchitecture();
  for (let i = 1; i <= 250; i++)
    architecture.update({ ...frame, time: i * 0.02 });
  const running = architecture.diagnostics();
  assert(Math.abs(running.opticalClockSeconds - 5) < 0.000001);
  const main = architecture.root.getObjectByName("monumental-open-span");
  const orientation = main.rotation.toArray();
  architecture.update({ ...frame, time: 900, ambientStrength: 0 });
  assert.equal(
    architecture.diagnostics().opticalClockSeconds,
    running.opticalClockSeconds,
  );
  assert.deepEqual(
    main.rotation.toArray(),
    orientation,
    "pausing must not snap orientation back to its original pose",
  );
  architecture.update({ ...frame, time: 900.02 });
  assert(
    Math.abs(
      architecture.diagnostics().opticalClockSeconds -
        running.opticalClockSeconds -
        0.02,
    ) < 0.000001,
  );
  architecture.update({ ...frame, time: 1200 });
  assert(
    architecture.diagnostics().opticalClockSeconds <
      running.opticalClockSeconds + 0.121,
    "resume/lost-frame intervals must not suddenly fast-forward the atmosphere",
  );
  const beforeFocus = architecture.diagnostics().opticalClockSeconds;
  architecture.update({ ...frame, time: 1200.02, focus: 1 });
  assert(
    Math.abs(
      architecture.diagnostics().opticalClockSeconds - beforeFocus - 0.004,
    ) < 0.000001,
  );
  architecture.dispose();
});
