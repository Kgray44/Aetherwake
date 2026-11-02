import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sculptureRegion,
  overviewPresence,
  overviewChromeBottom,
} from "../src/presence-layout.ts";

test("a bottom-left navigation capsule never pushes overview Vela to the bottom right", () => {
  const capsule = { left: 40, right: 245, top: 788, bottom: 833 };
  const reserve = overviewChromeBottom(1600, 1000, capsule);
  const rect = overviewPresence(1600, 1000, reserve);
  assert(rect.y + rect.h / 2 < 500);
  assert(rect.x > 1200);
});
test("only intersecting top chrome reserves Vela's overview column", () => {
  assert.equal(
    overviewChromeBottom(1600, 1000, {
      left: 10,
      right: 1590,
      top: 140,
      bottom: 215,
    }),
    215,
  );
  assert.equal(
    overviewChromeBottom(1600, 1000, {
      left: 10,
      right: 800,
      top: 140,
      bottom: 215,
    }),
    104,
  );
  assert.equal(
    overviewChromeBottom(1600, 1000, {
      left: 1300,
      right: 1590,
      top: 800,
      bottom: 850,
    }),
    104,
  );
});
test("sculpture region stays centered inside the saved card at every viewport scale and offscreen position", () => {
  for (const zoom of [4, 1, 0.65, 0.369, 0.1, 0.01, 0.0001])
    for (const origin of [-100000, 0, 25000]) {
      const card = {
          x: origin * zoom,
          y: origin * zoom,
          w: 208 * zoom,
          h: 260 * zoom,
        },
        body = sculptureRegion(card);
      assert(body.w > 0 && body.h > 0);
      assert(body.x >= card.x && body.y >= card.y);
      assert(body.x + body.w <= card.x + card.w + 1e-8);
      assert(body.y + body.h <= card.y + card.h + 1e-8);
      assert(Math.abs(body.x + body.w / 2 - card.x - card.w / 2) < 1e-8);
      assert(Math.abs(body.y + body.h / 2 - card.y - card.h / 2) < 1e-8);
    }
});
test("overview pose occupies the upper right and clears navigation and bottom controls without a workspace mutation", () => {
  for (const [width, height, bar] of [
    [1600, 1000, 201],
    [800, 650, 249],
    [2400, 1500, 201],
  ]) {
    const rect = overviewPresence(width, height, bar);
    assert(rect.x > width * 0.7);
    assert(rect.x + rect.w <= width - 20);
    assert(rect.y >= bar + 10);
    assert(rect.y + rect.h <= height - 140);
  }
});
