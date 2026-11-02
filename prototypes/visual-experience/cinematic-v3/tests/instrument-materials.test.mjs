import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  createInstrumentMaterials,
  updateInstrumentMaterials,
  mirrorDirectionalKey,
} from "../src/instrument-materials.ts";

const base = {
  study: "optical",
  kind: "conversation",
  unfold: 0,
  selected: false,
  quality: "balanced",
  architectureWeight: 1,
};
const dispose = (materials) =>
  Object.values(materials).forEach((material) => material.dispose());

test("instrument studies retain opaque readable substrates and physically bounded material parameters across kinds and tiers", () => {
  const materials = createInstrumentMaterials();
  try {
    for (const study of ["optical", "engineered", "composite"]) {
      for (const kind of ["conversation", "research", "note"]) {
        for (const quality of ["efficient", "balanced", "cinematic"]) {
          for (const unfold of [0, 0.4, 1]) {
            updateInstrumentMaterials(materials, {
              ...base,
              study,
              kind,
              quality,
              unfold,
              selected: true,
            });
            assert.equal(
              materials.face.opacity,
              1,
              "background cannot interfere through the text substrate",
            );
            assert.equal(materials.face.depthWrite, true);
            assert.equal(
              materials.face.transmission,
              0,
              "the reading substrate must not invoke scene refraction",
            );
            for (const material of Object.values(materials)) {
              for (const property of [
                "roughness",
                "metalness",
                "clearcoat",
                "clearcoatRoughness",
                "opacity",
                "specularIntensity",
              ]) {
                assert(Number.isFinite(material[property]));
                assert(material[property] >= 0 && material[property] <= 1);
              }
              assert(material.emissiveIntensity <= 0.12);
              assert(
                material.envMapIntensity >= 0 && material.envMapIntensity <= 1,
              );
              assert.equal(material.map, null);
              assert.equal(material.transmissionMap, null);
            }
            for (const material of [
              materials.edge,
              materials.frame,
              materials.polish,
            ]) {
              assert.equal(
                material.emissiveIntensity,
                0,
                "physical structure must not become a luminous outline",
              );
            }
            if (unfold === 1) {
              assert.equal(materials.face.emissiveIntensity, 0);
              assert.equal(materials.accent.emissiveIntensity, 0);
            }
          }
        }
      }
    }
  } finally {
    dispose(materials);
  }
});

test("study changes preserve material identity while reading reduces reflection and the note keeps warmth in its accent", () => {
  const materials = createInstrumentMaterials();
  const identities = Object.values(materials);
  const profiles = [];
  try {
    for (const study of ["optical", "engineered", "composite"]) {
      updateInstrumentMaterials(materials, {
        ...base,
        study,
        kind: "research",
      });
      profiles.push([
        materials.face.color.getHex(),
        materials.face.roughness,
        materials.face.metalness,
        materials.face.clearcoat,
      ]);
      const roughness = materials.face.roughness;
      const reflection = materials.face.envMapIntensity;
      const coat = materials.face.clearcoat;
      for (let step = 0; step <= 40; step++) {
        updateInstrumentMaterials(materials, {
          ...base,
          study,
          kind: "research",
          unfold: step / 40,
        });
        assert.deepEqual(Object.values(materials), identities);
      }
      assert(materials.face.roughness > roughness);
      assert(materials.face.envMapIntensity < reflection);
      assert(materials.face.clearcoat < coat);
    }
    assert.equal(
      new Set(profiles.map((profile) => JSON.stringify(profile))).size,
      3,
      "studies must differ in physical response rather than border tint alone",
    );
    updateInstrumentMaterials(materials, { ...base, kind: "note" });
    assert(
      materials.face.roughness > 0.18 && materials.face.roughness < 0.3,
      "the memory slate retains a slightly quieter coated-glass response rather than a matte substrate",
    );
    assert(
      materials.face.color.b >= materials.face.color.r,
      "memory slate substrate stays graphite rather than brown",
    );
    assert(
      materials.accent.color.r > materials.accent.color.b,
      "warm identity belongs to a restrained structural accent",
    );
    assert.equal(new Set(identities).size, 7);
  } finally {
    dispose(materials);
  }
});

test("the selected optical direction is glass-dominant outside an opaque reading substrate while the engineered comparison retains metal", () => {
  const materials = createInstrumentMaterials();
  try {
    updateInstrumentMaterials(materials, { ...base, kind: "research" });
    assert(materials.face.metalness < 0.15);
    assert(materials.face.clearcoat > 0.9);
    assert(materials.face.roughness < 0.2);
    assert.equal(materials.face.opacity, 1);
    assert.equal(materials.face.depthWrite, true);
    assert.equal(materials.recess.opacity, 1);
    assert.equal(materials.recess.depthWrite, true);
    for (const laminate of [
      materials.edge,
      materials.frame,
      materials.optics,
    ]) {
      assert(laminate.metalness < 0.15);
      assert(laminate.clearcoat > 0.9);
      assert(laminate.opacity > 0.4 && laminate.opacity < 0.8);
      assert.equal(laminate.depthWrite, false);
      assert.equal(laminate.emissiveIntensity, 0);
    }
    updateInstrumentMaterials(materials, {
      ...base,
      kind: "research",
      unfold: 1,
    });
    assert.equal(materials.face.opacity, 1);
    assert.equal(materials.frame.opacity, 1);
    assert(materials.face.roughness > 0.5);
    updateInstrumentMaterials(materials, { ...base, study: "engineered" });
    assert(materials.frame.metalness > 0.7);
    assert.equal(materials.frame.opacity, 1);
    assert.equal(materials.frame.depthWrite, true);
    assert.equal(materials.face.opacity, 1);
  } finally {
    dispose(materials);
  }
});

test("shared instrument key follows architectural world direction and color without changing the approved source", () => {
  const scene = new THREE.Scene();
  const rig = new THREE.Group();
  rig.rotation.set(0.2, -0.4, 0.1);
  rig.position.set(4, -2, -20);
  const source = new THREE.DirectionalLight(0xdce8ff, 3.6);
  source.position.set(-9, 10, -12);
  source.target.position.set(-3, 0, -25);
  rig.add(source, source.target);
  scene.add(rig);
  const destination = new THREE.DirectionalLight();
  const expectedPosition = new THREE.Vector3();
  const expectedTarget = new THREE.Vector3();
  const expectedDirection = new THREE.Vector3();
  const sourceState = {
    position: source.position.toArray(),
    target: source.target.position.toArray(),
    color: source.color.getHex(),
    intensity: source.intensity,
  };
  mirrorDirectionalKey(source, destination, 0.55);
  source.getWorldPosition(expectedPosition);
  source.target.getWorldPosition(expectedTarget);
  expectedDirection.subVectors(expectedPosition, expectedTarget).normalize();
  assert(
    destination.position.clone().normalize().distanceTo(expectedDirection) <
      1e-10,
  );
  assert.equal(destination.color.getHex(), source.color.getHex());
  assert.equal(destination.intensity, source.intensity * 0.55);
  assert.deepEqual(
    {
      position: source.position.toArray(),
      target: source.target.position.toArray(),
      color: source.color.getHex(),
      intensity: source.intensity,
    },
    sourceState,
  );
});
