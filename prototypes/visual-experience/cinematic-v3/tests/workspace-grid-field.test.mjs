import test from "node:test";
import assert from "node:assert/strict";
import { WorkspaceGridField } from "../src/workspace-grid-field.ts";
import { projectWorkspaceGrid } from "../src/workspace-grid.ts";

test("the background draw consumes the same CSS projection and continues through MC fade-out", () => {
  const field = new WorkspaceGridField();
  let calls = 0,
    submitted;
  const renderer = {
    render(scene) {
      calls++;
      submitted = scene.children[0];
    },
  };
  const projection = projectWorkspaceGrid(0.8, { x: -33, y: 88 });
  field.render(
    renderer,
    { visible: false, reveal: 0.4, projection },
    1600,
    1000,
  );
  assert.equal(calls, 1);
  const material = submitted.material;
  assert.equal(material.depthWrite, false);
  assert.equal(material.depthTest, false);
  assert.deepEqual(material.uniforms.uSize.value.toArray(), [1600, 1000]);
  assert.deepEqual(material.uniforms.uFamily0.value.toArray(), [
    projection[0].x,
    projection[0].y,
    projection[0].spacing,
  ]);
  assert.equal(material.uniforms.uReveal.value, 0.4);
  assert.deepEqual(
    material.uniforms.uWeights.value.toArray(),
    projection.map((p) => p.weight),
  );
  field.render(renderer, { visible: false, reveal: 0, projection }, 1600, 1000);
  field.render(renderer, null, 1600, 1000);
  field.render(
    renderer,
    { visible: true, reveal: NaN, projection },
    1600,
    1000,
  );
  field.render(renderer, { visible: true, reveal: 1, projection }, 0, 1000);
  field.render(
    renderer,
    {
      visible: true,
      reveal: 1,
      projection: [{ ...projection[0], spacing: 0 }, projection[1]],
    },
    1600,
    1000,
  );
  assert.equal(calls, 1);
  let geometryDisposals = 0,
    materialDisposals = 0;
  submitted.geometry.addEventListener("dispose", () => geometryDisposals++);
  material.addEventListener("dispose", () => materialDisposals++);
  field.dispose();
  field.dispose();
  field.render(renderer, { visible: true, reveal: 1, projection }, 1600, 1000);
  assert.equal(calls, 1);
  assert.equal(geometryDisposals, 1);
  assert.equal(materialDisposals, 1);
});
