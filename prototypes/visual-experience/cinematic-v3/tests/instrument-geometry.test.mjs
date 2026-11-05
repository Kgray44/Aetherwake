import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { InstrumentStructure } from "../src/instrument-geometry.ts";

const base = {
  kind: "conversation",
  width: 360,
  height: 240,
  unfold: 0,
  quality: "balanced",
  study: "optical",
};
const materials = () => ({
  frame: new THREE.MeshPhysicalMaterial(),
  recess: new THREE.MeshStandardMaterial(),
  optics: new THREE.MeshPhysicalMaterial(),
  accent: new THREE.MeshStandardMaterial(),
});
const release = (materials) =>
  Object.values(materials).forEach((material) => material.dispose());

test("instrument geometry keeps finite outward normals across all resource shapes and unfolding", () => {
  const owned = materials(),
    instrument = new InstrumentStructure(owned);
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3(),
    normal = new THREE.Vector3(),
    ab = new THREE.Vector3(),
    ac = new THREE.Vector3();
  for (const kind of ["conversation", "research", "note"])
    for (const unfold of [0, 0.35, 1]) {
      instrument.update({ ...base, kind, unfold, study: "engineered" });
      instrument.root.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        assert.equal(object.frustumCulled, false);
        const position = object.geometry.getAttribute("position"),
          normals = object.geometry.getAttribute("normal"),
          index = object.geometry.index;
        for (const value of position.array) assert(Number.isFinite(value));
        for (let i = 0; i < normals.count; i++) {
          normal.fromBufferAttribute(normals, i);
          assert(
            Math.abs(normal.length() - 1) < 0.001,
            "surface normals must remain normalized during morphing",
          );
        }
        const count = index?.count ?? position.count;
        for (let i = 0; i < count; i += 3) {
          const first = index ? index.getX(i) : i;
          a.fromBufferAttribute(position, first);
          b.fromBufferAttribute(position, index ? index.getX(i + 1) : i + 1);
          c.fromBufferAttribute(position, index ? index.getX(i + 2) : i + 2);
          normal.fromBufferAttribute(normals, first);
          ab.subVectors(b, a);
          ac.subVectors(c, a);
          assert(
            ab.cross(ac).dot(normal) > -0.0001,
            "visible-face winding must agree with physical lighting normals",
          );
        }
      });
    }
  instrument.dispose();
  release(owned);
});

test("structural layers leave the reading plane empty and provide real perimeter thickness", () => {
  const owned = materials(),
    instrument = new InstrumentStructure(owned),
    ray = new THREE.Raycaster();
  for (const kind of ["conversation", "research", "note"])
    for (const unfold of [0, 1]) {
      instrument.update({ ...base, kind, unfold, study: "engineered" });
      instrument.root.updateMatrixWorld(true);
      ray.set(new THREE.Vector3(0, 0, 20), new THREE.Vector3(0, 0, -1));
      assert.equal(
        ray.intersectObjects(instrument.root.children, true).length,
        0,
        "instrument fittings must not obstruct central text",
      );
      ray.set(
        new THREE.Vector3(base.width / 2 + 5, 0, 20),
        new THREE.Vector3(0, 0, -1),
      );
      assert(
        ray.intersectObjects(instrument.root.children, true).length > 0,
        "perimeter must be an actual shaded surface",
      );
    }
  instrument.dispose();
  release(owned);
});

test("resource morphs and quality changes reuse the same GPU geometry and instance buffers", () => {
  const owned = materials(),
    instrument = new InstrumentStructure(owned);
  const meshes = instrument.root.children.slice(),
    geometries = meshes.map((mesh) => mesh.geometry),
    positions = geometries.map(
      (geometry) => geometry.getAttribute("position").array,
    );
  const matrices = meshes
    .filter((mesh) => mesh instanceof THREE.InstancedMesh)
    .map((mesh) => mesh.instanceMatrix.array);
  for (const study of ["optical", "engineered", "composite"])
    for (const kind of ["conversation", "research", "note"])
      for (const unfold of [0, 0.5, 1]) {
        instrument.update({
          ...base,
          kind,
          study,
          unfold,
          width: 420,
          height: 280,
        });
        assert.deepEqual(instrument.root.children, meshes);
        meshes.forEach((mesh, i) => {
          assert.equal(mesh.geometry, geometries[i]);
          assert.equal(
            mesh.geometry.getAttribute("position").array,
            positions[i],
          );
        });
        const before = instrument.diagnostics().shapeUpdates;
        instrument.update({
          ...base,
          kind,
          study,
          unfold,
          width: 420,
          height: 280,
          quality: "efficient",
        });
        assert.equal(
          instrument.diagnostics().shapeUpdates,
          before,
          "quality policy must not rebuild physical geometry",
        );
        assert(
          instrument.diagnostics().visibleObjects <= 3,
          "Efficient retains a bounded instrument silhouette",
        );
      }
  meshes
    .filter((mesh) => mesh instanceof THREE.InstancedMesh)
    .forEach((mesh, i) => assert.equal(mesh.instanceMatrix.array, matrices[i]));
  assert.equal(instrument.diagnostics().geometryAllocations, 5);
  assert.equal(instrument.diagnostics().materialAllocations, 0);
  instrument.dispose();
  release(owned);
});

test("the same research lens progressively becomes a rectangular working instrument", () => {
  const owned = materials(),
    instrument = new InstrumentStructure(owned);
  const frame = instrument.root.getObjectByName("machined-chamfer-frame"),
    position = frame.geometry.getAttribute("position");
  const cornerIndex = 12 * 2;
  instrument.update({ ...base, kind: "research", unfold: 0 });
  const compact = {
    x: position.getX(cornerIndex),
    y: position.getY(cornerIndex),
  };
  instrument.update({ ...base, kind: "research", unfold: 0.5 });
  const middle = {
    x: position.getX(cornerIndex),
    y: position.getY(cornerIndex),
  };
  instrument.update({ ...base, kind: "research", unfold: 1 });
  assert(position.getX(cornerIndex) > middle.x && middle.x > compact.x);
  assert(position.getY(cornerIndex) > middle.y && middle.y > compact.y);
  assert.equal(
    instrument.root.getObjectByName("machined-chamfer-frame"),
    frame,
  );
  instrument.dispose();
  release(owned);
});

test("circular research resources use the same bounded thin perimeter as their resource family", () => {
  const owned = materials(),
    instrument = new InstrumentStructure(owned);
  for (const study of ["optical", "engineered", "composite"]) {
    const extents = [];
    for (const kind of ["conversation", "note", "research"]) {
      instrument.update({
        ...base,
        kind,
        width: 300,
        height: 300,
        unfold: 0,
        study,
      });
      const position = instrument.root
        .getObjectByName("machined-chamfer-frame")
        .geometry.getAttribute("position");
      let outer = -Infinity,
        inner = Infinity;
      for (let i = 0; i < position.count; i++) {
        const radius =
          kind === "research"
            ? Math.hypot(position.getX(i), position.getY(i))
            : position.getX(i);
        outer = Math.max(outer, radius);
        if (kind === "research") inner = Math.min(inner, radius);
      }
      extents.push(outer - 150);
      if (kind === "research" && study === "optical") {
        assert(
          outer - inner > 1.65 && outer - inner < 1.8,
          "Optical retains a thin 1.72px glass laminate, not a wide annular housing",
        );
        for (const mesh of instrument.root.children) {
          if (!mesh.visible || mesh instanceof THREE.InstancedMesh) continue;
          const p = mesh.geometry.getAttribute("position");
          let visibleRadius = 0;
          for (let i = 0; i < p.count; i++)
            visibleRadius = Math.max(
              visibleRadius,
              Math.hypot(p.getX(i), p.getY(i)),
            );
          assert(
            visibleRadius - 150 < 4.1,
            "no oversized rear race or optical ring may dominate the circular card",
          );
        }
      }
    }
    assert(
      Math.max(...extents) - Math.min(...extents) < 0.001,
      "all resource shapes must share the same visual perimeter weight within each study",
    );
  }
  instrument.dispose();
  release(owned);
});

test("material studies change structural depth and layering without changing resource identity", () => {
  const owned = materials(),
    instrument = new InstrumentStructure(owned),
    states = [];
  const frame = instrument.root.getObjectByName("machined-chamfer-frame");
  for (const study of ["optical", "engineered", "composite"]) {
    instrument.update({ ...base, study });
    const p = frame.geometry.getAttribute("position");
    let min = Infinity,
      max = -Infinity;
    for (let i = 0; i < p.count; i++) {
      min = Math.min(min, p.getZ(i));
      max = Math.max(max, p.getZ(i));
    }
    states.push({
      depth: max - min,
      visible: instrument.root.children
        .filter((mesh) => mesh.visible)
        .map((mesh) => mesh.name)
        .join(","),
    });
    assert.equal(frame.material, owned.frame);
  }
  assert(
    states[1].depth > states[2].depth && states[2].depth > states[0].depth,
  );
  assert.equal(new Set(states.map((state) => state.visible)).size, 3);
  instrument.dispose();
  release(owned);
});

test("instrument disposal releases owned pools once while preserving caller-owned materials", () => {
  const owned = materials(),
    instrument = new InstrumentStructure(owned);
  let geometryDisposals = 0,
    materialDisposals = 0;
  instrument.root.children.forEach((mesh) =>
    mesh.geometry.addEventListener("dispose", () => geometryDisposals++),
  );
  Object.values(owned).forEach((material) =>
    material.addEventListener("dispose", () => materialDisposals++),
  );
  assert.throws(() => instrument.update({ ...base, width: NaN }), RangeError);
  instrument.dispose();
  instrument.dispose();
  assert.equal(geometryDisposals, 5);
  assert.equal(materialDisposals, 0);
  assert.equal(instrument.root.children.length, 0);
  release(owned);
});
