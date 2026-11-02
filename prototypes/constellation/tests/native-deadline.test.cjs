const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const {
  verificationDeadline,
  benchmarkControls,
  collectPresentationTail,
  LIMITS,
} = require("../../visual-experience/cinematic-v3/native/integration-spatial-benchmark.cjs");
const {
  journeyDeadline,
  createJourneyGuard,
} = require("./integrated-native.cjs");
const { assertNativeOwner, nativeInput } = require("./native-input.cjs");

function owner() {
  const inputs = [];
  const win = {
    isDestroyed: () => false,
    isVisible: () => true,
    isMinimized: () => false,
    isFocused: () => true,
    focus: () => assert.fail("never reclaim window focus"),
    webContents: {
      isDestroyed: () => false,
      sendInputEvent: (input) => inputs.push(input),
      executeJavaScript: async () => false,
    },
  };
  return { win, inputs };
}

test("wall rollback and forward jumps preserve the exact host-start monotonic budget and original wall evidence", () => {
  const wallStart = 1000000,
    monoStart = 1000,
    monoNow = 1400;
  for (const wallNow of [wallStart - 372, wallStart + 86400000]) {
    const budget = verificationDeadline(
      ["--verification-deadline-ms=90000"],
      wallStart,
      monoStart,
      monoNow,
      wallNow,
    );
    assert.equal(budget.expiresAtMonotonicMs, 91000);
    assert.notEqual(
      budget.expiresAtMonotonicMs,
      monoNow + 90000,
      "startup must consume the original budget",
    );
    assert.equal(budget.clock.moduleStartedWallMs, wallStart);
    assert.equal(budget.clock.admissionWallMs, wallNow);
    assert.equal(budget.clock.startupElapsedMs, 400);
    assert.equal(budget.clock.wallElapsedMs, wallNow - wallStart);
    assert.equal(budget.clock.discontinuityMs, wallNow - wallStart - 400);
    assert.equal(budget.clock.wallReversed, wallNow < wallStart);
    const journey = journeyDeadline(
      ["--verification-deadline-ms=90000"],
      new Date(wallStart).toISOString(),
      monoStart,
      monoNow,
      wallNow,
    );
    assert.deepEqual(journey, budget);
  }
  for (const sample of [NaN, Infinity, -1])
    assert.throws(
      () =>
        verificationDeadline(
          ["--verification-deadline-ms=90000"],
          wallStart,
          monoStart,
          sample,
          wallStart,
        ),
      /admission clock samples/,
    );
  assert.throws(
    () =>
      verificationDeadline(
        ["--verification-deadline-ms=1000"],
        wallStart,
        monoStart,
        monoStart + 1000,
        wallStart - 372,
      ),
    /already expired/,
  );
});

test("async lookups and native inputs stop at strict monotonic expiry despite either direction of wall jump", async () => {
  for (const wallJump of [-86400000, 86400000]) {
    const { win, inputs } = owner();
    let mono = 1000,
      wall = 100000000;
    const run = createJourneyGuard(
      win,
      1100,
      () => mono,
      async (ms) => {
        mono += ms;
      },
      () => wall,
    );
    win.webContents.executeJavaScript = async () => {
      mono = 1100;
      wall += wallJump;
      return { x: 10, y: 20 };
    };
    await assert.rejects(run.js("unit-only query"), /deadline/);
    assert.throws(
      () => run.input({ type: "mouseDown", button: "left" }),
      /deadline/,
    );
    assert.deepEqual(inputs, []);
  }
});

test("Escape allowance uses monotonic time while its diagnostic timestamp keeps real wall time", () => {
  const { win } = owner();
  let mono = 1000,
    wall = 100000000;
  const run = createJourneyGuard(
    win,
    2000,
    () => mono,
    async () => {},
    () => wall,
  );
  run.input({ type: "keyDown", keyCode: "Escape" });
  wall -= 86400000;
  mono = 1251;
  run.beforeInput({}, { type: "keyDown", key: "Escape", isAutoRepeat: false });
  assert.throws(run.guard, /operator_escape/);
  assert.equal(run.status.intentionalEscapesObserved, 0);
  assert.equal(run.status.operatorEscapeAt, new Date(wall).toISOString());
  assert.equal(run.status.operatorEscapeMonotonicMs, 1251);
});

test("pauses spend only monotonic time and cannot wait through the global deadline after wall changes", async () => {
  for (const wallJump of [-86400000, 86400000]) {
    const { win } = owner();
    let mono = 1000,
      wall = 100000000;
    const run = createJourneyGuard(
      win,
      1200,
      () => mono,
      async (ms) => {
        assert(ms > 0 && ms <= 50);
        mono += ms;
        wall += wallJump;
      },
      () => wall,
    );
    await run.pause(80);
    assert.equal(mono, 1080);
    await assert.rejects(run.pause(500), /deadline/);
    assert.equal(mono, 1200);
  }
});

test("actual default guard clock is monotonic rather than an epoch wall sample", () => {
  const { win } = owner();
  let mono = 1000;
  const run = vm.runInNewContext(
    "(" + createJourneyGuard.toString() + ")(win, 1200, undefined, sleep)",
    {
      win,
      assert,
      assertNativeOwner,
      nativeInput,
      monotonicNow: () => mono,
      sleep: async (ms) => {
        mono += ms;
      },
      Date: { now: () => 100000000 },
    },
  );
  run.guard();
  mono = 1200;
  assert.throws(run.guard, /deadline/);
});

test("actual local UI wait and click deadlines never read wall time", async () => {
  for (const action of ["wait", "click"]) {
    const { win, inputs } = owner();
    let mono = 0;
    const controls = vm.runInNewContext(
      "(" + benchmarkControls.toString() + ")(win, query, guard, sleep)",
      {
        win,
        nativeInput,
        monotonicNow: () => mono,
        Date: {
          now: () => assert.fail("local UI deadlines must not use Date.now"),
        },
        query: async () =>
          action === "wait" ? false : { error: "Occluded control" },
        guard: () => {},
        sleep: async (ms) => {
          mono += ms;
          assert(mono <= 2100, "bounded local timeout must terminate");
        },
      },
    );
    if (action === "wait")
      await assert.rejects(controls.wait("false", 200), /Timed out/);
    else
      await assert.rejects(
        controls.click(".unit-only-target"),
        /Occluded control/,
      );
    assert(mono >= (action === "wait" ? 200 : 2000));
    assert.deepEqual(inputs, []);
  }
});

test("an awaited click lookup crossing monotonic expiry cannot dispatch input", async () => {
  const { win, inputs } = owner();
  let mono = 1000,
    wall = 100000000;
  const run = createJourneyGuard(
    win,
    1100,
    () => mono,
    async (ms) => {
      mono += ms;
    },
    () => wall,
  );
  win.webContents.executeJavaScript = async () => {
    mono = 1100;
    wall -= 86400000;
    return { x: 10, y: 20 };
  };
  const controls = benchmarkControls(
    win,
    run.js,
    run.guard,
    run.pause,
    () => mono,
  );
  await assert.rejects(controls.click(".unit-only-target"), /deadline/);
  assert.deepEqual(inputs, []);
});

test("actual tail cutoff and spacing use the monotonic clock with no wall-time dependency", async () => {
  let mono = 0;
  const collect = vm.runInNewContext(
    "(" + collectPresentationTail.toString() + ")",
    {
      LIMITS,
      monotonicNow: () => mono,
      performance: { now: () => mono },
      Date: { now: () => assert.fail("tail cutoff must not use wall time") },
    },
  );
  const reads = [];
  const result = await collect({
    closed: () => false,
    observe: async () => {
      reads.push(mono);
      return {};
    },
    ownedPause: async (ms) => {
      assert(ms > 0 && ms <= 50);
      mono += ms;
      assert(mono <= 1000);
    },
    guard: () => {},
    mark: () => ({ monotonicNs: String(mono * 1000000) }),
    deadlineAt: 1000,
  });
  assert.deepEqual(reads, [250, 500, 750]);
  assert.equal(mono, 1000);
  assert.equal(result.captureClosedObserved, false);
});
