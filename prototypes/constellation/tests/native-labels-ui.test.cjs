const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { checkLabelClearance } = require("./native-labels.cjs");

function element(bounds, style = {}) {
  return {
    hidden: false,
    id: "fixture-ui",
    className: "fixture-ui",
    dataset: { key: "project:p" },
    getClientRects: () => [{}],
    getBoundingClientRect: () => bounds,
    style: { visibility: "visible", display: "block", opacity: "1", ...style },
  };
}
function fixture({ observed, full = true, ui = [] } = {}) {
  const bounds = full
      ? { left: 0, top: 0, width: 1280, height: 800 }
      : { left: 20, top: 30, width: 1000, height: 600 },
    label = element({ left: 500, top: 400, right: 650, bottom: 444 });
  let reads = 0;
  return {
    win: {
      webContents: {
        sendInputEvent() {
          assert.fail("clearance observation must never dispatch input");
        },
        async executeJavaScript(code) {
          reads++;
          const value = vm.runInNewContext(code, {
            innerWidth: 1280,
            innerHeight: 800,
            getComputedStyle: (e) => e.style,
            document: {
              querySelector: () => ({ getBoundingClientRect: () => bounds }),
              querySelectorAll: (selector) =>
                selector === ".aw-spatial-label" ? [label] : ui,
            },
            window: {
              __aerynth: {
                snapshot: () => ({ spatial: { uiExclusions: observed } }),
              },
            },
          });
          return JSON.parse(JSON.stringify(value));
        },
      },
    },
    reads: () => reads,
  };
}

test("full-viewport native clearance requires actual bounded UI observations; legacy inset scope stays explicit", async () => {
  const missing = fixture();
  await assert.rejects(
    checkLabelClearance(missing.win),
    /valid actual UI exclusion/,
  );
  const legacy = fixture({ full: false });
  const result = await checkLabelClearance(legacy.win);
  assert.equal(result.measuredUiExclusions, false);
  assert.equal(legacy.reads(), 1);
});

test("actual measured host exclusions detect collisions even for controls outside the legacy selector list", async () => {
  const collision = fixture({
    observed: [{ left: 520, top: 410, right: 700, bottom: 500 }],
  });
  await assert.rejects(
    checkLabelClearance(collision.win),
    /native destination labels clear/,
  );
  const clear = fixture({
    observed: [{ left: 0, top: 770, right: 1280, bottom: 800 }],
  });
  const result = await checkLabelClearance(clear.win);
  assert.equal(result.measuredUiExclusions, true);
  assert.equal(result.ui[0].role, "measured-ui-0");
  assert.deepEqual(result.collisions, []);
});

test("field-relative observations are translated to actual client pixels rather than compared in different coordinate systems", async () => {
  const shifted = fixture({
    full: false,
    observed: [{ left: 480, top: 370, right: 630, bottom: 414 }],
  });
  await assert.rejects(
    checkLabelClearance(shifted.win),
    /native destination labels clear/,
  );
});

test("missing, nonfinite, collapsed and unbounded region payloads cannot qualify the native clearance receipt", async () => {
  for (const observed of [
    null,
    {},
    [{ left: NaN, top: 0, right: 10, bottom: 10 }],
    [{ left: 0, top: 0, right: Infinity, bottom: 10 }],
    [{ left: 10, top: 0, right: 10, bottom: 10 }],
    Array(129).fill({ left: 0, top: 0, right: 1, bottom: 1 }),
  ]) {
    await assert.rejects(
      checkLabelClearance(fixture({ observed }).win),
      /valid actual UI exclusion/,
    );
  }
});

test("transparent host controls do not create invisible clearance obstacles", async () => {
  const invisible = element(
    { left: 500, top: 400, right: 650, bottom: 444 },
    { opacity: "0" },
  );
  const result = await checkLabelClearance(
    fixture({ observed: [], ui: [invisible] }).win,
  );
  assert.deepEqual(result.ui, []);
});
