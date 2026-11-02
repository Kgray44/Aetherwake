import test from "node:test";
import assert from "node:assert/strict";
import {
  contourPoint,
  surfaceBorderRadius,
  CARD_CORNER_RADIUS,
} from "../src/surface-contour.ts";

test("all rectangular card families share the same GPU outline and DOM corner curve through focus", () => {
  for (const unfold of [0, 0.35, 1])
    for (const [width, height] of [
      [128, 96],
      [400, 280],
      [900, 600],
    ]) {
      const reference = { x: 0, y: 0, nx: 0, ny: 0 },
        candidate = { ...reference };
      for (const shape of ["rectangle", "rounded", "folio"]) {
        assert.equal(
          surfaceBorderRadius(shape, width, height, unfold),
          CARD_CORNER_RADIUS + "px",
        );
        for (let i = 0; i < 96; i++) {
          contourPoint(width, height, "rounded", unfold, i / 96, 0, reference);
          contourPoint(width, height, shape, unfold, i / 96, 0, candidate);
          assert.deepEqual(candidate, reference);
        }
      }
    }
});
test("compact lenses keep their optical silhouette and every focused reader joins the common card outline", () => {
  assert.equal(surfaceBorderRadius("lens", 320, 240, 0), "160px / 120px");
  assert.equal(surfaceBorderRadius("circle", 240, 240, 0), "120px / 120px");
  for (const shape of ["circle", "lens", "pill"])
    for (let i = 0; i < 96; i++) {
      const radial = { x: 0, y: 0, nx: 0, ny: 0 },
        card = { ...radial };
      contourPoint(400, 280, shape, 1, i / 96, 0, radial);
      contourPoint(400, 280, "rounded", 1, i / 96, 0, card);
      assert.deepEqual(radial, card);
    }
});
