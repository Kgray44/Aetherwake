import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import * as THREE from "three";

// Compile the actual renderer with the project's existing TypeScript compiler.
// Its constructor uses a parameter property that Node's strip-only mode cannot
// load. Calling the real prototype geometry helpers needs no WebGL constructor,
// DOM replacement, or reimplementation of the resource geometry.
const rendererURL = new URL("../src/renderer.ts", import.meta.url);
const { outputText } = ts.transpileModule(readFileSync(rendererURL, "utf8"), {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
  },
});
const compiledModule = { exports: {} };
new Function("require", "exports", "module", outputText)(
  createRequire(rendererURL),
  compiledModule.exports,
  compiledModule,
);
const { Environment } = compiledModule.exports;
const makeGeometry = (rim) => Environment.prototype.folioGeometry.call({}, rim);
const shapeGeometry = (geometry, w, h, rim, kind, unfold) =>
  Environment.prototype.shapeFolio.call({}, geometry, w, h, rim, kind, unfold);

test("resource faces and rims retain finite unit normals, valid indices and outward winding across transformations", () => {
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const face = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (const kind of ["conversation", "research", "note"]) {
    for (const unfold of [0, 0.25, 0.6, 1]) {
      for (const [width, height] of [
        [180, 120],
        [280, 280],
        [840, 600],
      ]) {
        for (const rim of [false, true]) {
          const geometry = makeGeometry(rim);
          try {
            shapeGeometry(geometry, width, height, rim, kind, unfold);
            const position = geometry.getAttribute("position");
            const normals = geometry.getAttribute("normal");
            const index = geometry.getIndex();
            assert(position.count < 512, "resource buffers must stay bounded");
            assert.equal(normals.count, position.count);
            assert(index && index.count % 3 === 0);
            for (const value of position.array) assert(Number.isFinite(value));
            for (let i = 0; i < normals.count; i++) {
              n.fromBufferAttribute(normals, i);
              assert(Number.isFinite(n.length()));
              assert(Math.abs(n.length() - 1) < 0.001);
            }
            for (const vertex of index.array) {
              assert(Number.isInteger(vertex));
              assert(vertex >= 0 && vertex < position.count);
            }
            for (let i = 0; i < index.count; i += 3) {
              const ia = index.getX(i);
              const ib = index.getX(i + 1);
              const ic = index.getX(i + 2);
              a.fromBufferAttribute(position, ia);
              b.fromBufferAttribute(position, ib);
              c.fromBufferAttribute(position, ic);
              ab.subVectors(b, a);
              ac.subVectors(c, a);
              face.crossVectors(ab, ac);
              normal.fromBufferAttribute(normals, ia);
              normal.add(n.fromBufferAttribute(normals, ib));
              normal.add(n.fromBufferAttribute(normals, ic));
              assert(face.lengthSq() > 1e-10, "no collapsed triangles");
              assert(
                face.dot(normal) >= -1e-5,
                "front faces must agree with outward lighting normals",
              );
            }
          } finally {
            geometry.dispose();
          }
        }
      }
    }
  }
});

test("the optical research face flattens continuously into a reading plane without replacing its buffers", () => {
  const geometry = makeGeometry(false);
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const index = geometry.getIndex();
  const frontHeight = () => {
    let height = -Infinity;
    for (let i = 0; i < position.count; i++)
      height = Math.max(height, position.getZ(i));
    return height;
  };
  try {
    shapeGeometry(geometry, 280, 280, false, "research", 0);
    const compactHeight = frontHeight();
    assert(
      compactHeight > 1,
      "the compact lens must have actual convex geometry",
    );
    let previousHeight = compactHeight;
    for (let step = 1; step <= 100; step++) {
      const unfold = step / 100;
      shapeGeometry(
        geometry,
        280 + 560 * unfold,
        280 + 320 * unfold,
        false,
        "research",
        unfold,
      );
      const height = frontHeight();
      assert(height <= previousHeight + 1e-6);
      assert(
        previousHeight - height < compactHeight * 0.05,
        "curvature must not pop between nearby unfold states",
      );
      assert.equal(geometry.getAttribute("position"), position);
      assert.equal(geometry.getAttribute("normal"), normal);
      assert.equal(geometry.getIndex(), index);
      previousHeight = height;
    }
    assert(
      Math.abs(frontHeight()) < 1e-6,
      "expanded reading face must be flat",
    );
    const front = geometry.groups.find((group) => group.materialIndex === 0);
    assert(front, "a separately shaded reading face must exist");
    for (let i = front.start; i < front.start + front.count; i++) {
      const vertex = index.getX(i);
      assert(Math.abs(position.getZ(vertex)) < 1e-6);
      assert(Math.abs(normal.getX(vertex)) < 1e-6);
      assert(Math.abs(normal.getY(vertex)) < 1e-6);
    }
    for (const unfold of [0.45, 0.9, 0.2, 1]) {
      shapeGeometry(geometry, 420, 360, false, "research", unfold);
      assert.equal(geometry.getAttribute("position"), position);
      assert.equal(geometry.getAttribute("normal"), normal);
      assert.equal(geometry.getIndex(), index);
    }
    shapeGeometry(geometry, 280, 180, false, "note", 0);
    assert(
      Math.abs(frontHeight()) < 1e-6,
      "the matte note must retain a flat face",
    );
  } finally {
    geometry.dispose();
  }
});
