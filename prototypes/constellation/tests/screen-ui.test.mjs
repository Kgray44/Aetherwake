import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pointInsideUi,
  segmentCrossesUi,
  visibleUiRectangles,
} from "../screen-ui.ts";

function element(left, top, right, bottom, style = {}) {
  return {
    hidden: false,
    style: { visibility: "visible", display: "block", opacity: "1", ...style },
    getClientRects: () => [{}],
    getBoundingClientRect: () => ({ left, top, right, bottom }),
  };
}
const styleFor = (element) => element.style;

test("caption leaders cannot cross or originate behind real UI, while unrelated lines remain visible", () => {
  const ui = [{ left: 100, top: 100, right: 200, bottom: 200 }];
  for (const [a, b] of [
    [
      { x: 0, y: 150 },
      { x: 300, y: 150 },
    ],
    [
      { x: 150, y: 0 },
      { x: 150, y: 300 },
    ],
    [
      { x: 300, y: 300 },
      { x: 0, y: 0 },
    ],
    [
      { x: 150, y: 150 },
      { x: 300, y: 300 },
    ],
    [
      { x: 100, y: 100 },
      { x: 100, y: 100 },
    ],
  ])
    assert(segmentCrossesUi(a, b, ui));
  assert.equal(segmentCrossesUi({ x: 0, y: 50 }, { x: 300, y: 50 }, ui), false);
  assert.equal(segmentCrossesUi({ x: 50, y: 0 }, { x: 50, y: 300 }, ui), false);
  assert.equal(segmentCrossesUi({ x: 0, y: 0 }, { x: 0, y: 0 }, ui), false);
  assert.equal(
    segmentCrossesUi({ x: 0, y: 150 }, { x: 99, y: 150 }, ui),
    false,
  );
  assert.equal(
    segmentCrossesUi({ x: 201, y: 150 }, { x: 300, y: 150 }, ui),
    false,
  );
  assert.equal(segmentCrossesUi({ x: 0, y: 0 }, { x: 300, y: 300 }, []), false);
});

test("host controls, Vela and footer use the same actual field-relative rectangles for labels and input", () => {
  const controls = [
      element(20, 30, 120, 80),
      element(900, 200, 1050, 500),
      element(0, 970, 1200, 1000),
    ],
    saved = controls.map((e) => e.getBoundingClientRect()),
    rectangles = visibleUiRectangles(controls, { left: 20, top: 30 }, styleFor);
  assert.deepEqual(rectangles, [
    { left: 0, top: 0, right: 100, bottom: 50 },
    { left: 880, top: 170, right: 1030, bottom: 470 },
    { left: -20, top: 940, right: 1180, bottom: 970 },
  ]);
  assert(pointInsideUi(20, 20, rectangles));
  assert(pointInsideUi(900, 300, rectangles));
  assert(pointInsideUi(500, 950, rectangles));
  assert.equal(pointInsideUi(500, 500, rectangles), false);
  assert.deepEqual(
    controls.map((e) => e.getBoundingClientRect()),
    saved,
  );
});

test("hidden, transparent, detached, collapsed and invalid host geometry cannot reserve invisible hit targets", () => {
  const hidden = {
      hidden: true,
      getClientRects() {
        assert.fail("hidden geometry is never read");
      },
    },
    detached = {
      hidden: false,
      getClientRects: () => [],
      getBoundingClientRect() {
        assert.fail("detached geometry is never read");
      },
    },
    controls = [
      hidden,
      detached,
      element(0, 0, 100, 100, { visibility: "hidden" }),
      element(0, 0, 100, 100, { display: "none" }),
      element(0, 0, 100, 100, { opacity: "0" }),
      element(20, 0, 20, 100),
      element(0, 20, 100, 20),
      element(0, 0, Infinity, 100),
      element(NaN, 0, 100, 100),
    ];
  assert.deepEqual(
    visibleUiRectangles(controls, { left: 0, top: 0 }, styleFor),
    [],
  );
  assert.deepEqual(
    visibleUiRectangles(
      [element(0, 0, 100, 100)],
      { left: NaN, top: 0 },
      styleFor,
    ),
    [],
  );
  assert.equal(pointInsideUi(50, 50, []), false);
});

test("moving or closing real UI releases its previous region without changing canonical scene coordinates", () => {
  let position = { left: 20, top: 20, right: 120, bottom: 120 };
  const control = element(0, 0, 1, 1);
  control.getBoundingClientRect = () => position;
  const before = visibleUiRectangles([control], { left: 0, top: 0 }, styleFor);
  position = { left: 400, top: 300, right: 500, bottom: 400 };
  const after = visibleUiRectangles([control], { left: 0, top: 0 }, styleFor);
  assert(pointInsideUi(50, 50, before));
  assert.equal(pointInsideUi(50, 50, after), false);
  assert(pointInsideUi(450, 350, after));
  assert(pointInsideUi(400, 300, after), "actual UI borders remain protected");
  control.hidden = true;
  assert.deepEqual(
    visibleUiRectangles([control], { left: 0, top: 0 }, styleFor),
    [],
  );
});
