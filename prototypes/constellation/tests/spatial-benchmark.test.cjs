const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const {
  REQUIRED_MATRIX,
  LIMITS,
  verificationDeadline,
  spatialObservation,
  nativeOrbit,
  benchmarkControls,
  assertBodyCounters,
} = require("../../visual-experience/cinematic-v3/native/integration-spatial-benchmark.cjs");

function snapshot() {
  return {
    quality: "balanced",
    spatial: {
      renderer: {
        drawCalls: 42,
        triangles: 12000,
        nodes: 5000,
        edges: 40,
        culled: 2,
        cpuSubmitMs: 1.4,
        overlapCulled: 0,
        detailedBodies: 160,
        instancedBodies: 4840,
        instanceDrawCount: 5001,
      },
      camera: {
        target: { x: 100, y: 20, z: -80 },
        distance: 4500,
        yaw: 0.6,
        pitch: 0.2,
      },
    },
    gpu: {
      framesRendered: 70,
      geometries: 24,
      textures: 8,
      drawCalls: 84,
      triangles: 30000,
      spatialLayer: { active: true, failed: false },
    },
  };
}

test("scale observations exclude arbitrarily large body/GPU payloads and remain scalar-bounded", () => {
  const s = snapshot();
  Object.defineProperty(s.spatial.renderer, "projectedBodies", {
    get() {
      assert.fail("body arrays must never be sampled");
    },
  });
  Object.defineProperty(s.gpu, "privateTrace", {
    get() {
      assert.fail("unbounded GPU diagnostics must not be sampled");
    },
  });
  const result = spatialObservation(s),
    json = JSON.stringify(result);
  assert.ok(Buffer.byteLength(json) < 4096);
  assert.equal(result.renderer.nodes, 5000);
  assert.equal(result.renderer.instancedBodies, 4840);
  assert.equal(result.gpu.framesRendered, 70);
  assert.equal(
    result.renderer.arrivingBodies,
    null,
    "unavailable optional metrics are never invented as zero",
  );
  assert.equal(json.includes("projectedBodies"), false);
  assert.equal(json.includes("privateTrace"), false);
});

test("the actual observation function runs in an isolated browser-style realm without Node or closure dependencies", () => {
  const s = snapshot(),
    expected = spatialObservation(s);
  const result = vm.runInNewContext(
    "(" + spatialObservation.toString() + ")(fixture)",
    { fixture: s },
  );
  assert.deepEqual(JSON.parse(JSON.stringify(result)), expected);
});

test("the real host deadline flag is explicit, bounded, singular and still live after startup", () => {
  const started = 1000000,
    now = started + 500;
  assert.deepEqual(
    verificationDeadline(["--verification-deadline-ms=90000"], started, now),
    { durationMs: 90000, expiresAt: started + 90000 },
  );
  for (const argv of [
    [],
    ["--verification-deadline-ms="],
    ["--verification-deadline-ms=180001"],
    ["--verification-deadline-ms=NaN"],
    ["--verification-deadline-ms=999"],
    ["--verification-deadline-ms=1000", "--verification-deadline-ms=2000"],
  ])
    assert.throws(() => verificationDeadline(argv, started, now));
  assert.throws(() =>
    verificationDeadline(
      ["--verification-deadline-ms=1000"],
      started,
      started + 1001,
    ),
  );
  assert.throws(() =>
    verificationDeadline(["--verification-deadline-ms=90000"], undefined, now),
  );
});

test("quality limits detailed geometry while all visible instanced bodies remain counted", () => {
  const r = spatialObservation(snapshot()).renderer;
  assertBodyCounters(r, 160, 5002);
  assert.throws(() => assertBodyCounters(r, 70, 5002), /quality budget/);
  assert.throws(
    () => assertBodyCounters({ ...r, instancedBodies: 0 }, 160, 5002),
    /all on-screen/,
  );
  assert.throws(
    () => assertBodyCounters({ ...r, instanceDrawCount: 6000 }, 160, 5002),
    /instance allocation/,
  );
  assert.throws(
    () => assertBodyCounters({ ...r, overlapCulled: 1 }, 160, 5002),
    /camera alignment/,
  );
});

function owner() {
  let focused = true;
  const sent = [];
  const win = {
    isDestroyed: () => false,
    isVisible: () => true,
    isMinimized: () => false,
    isFocused: () => focused,
    focus: () => assert.fail("never reclaim OS focus"),
    show: () => assert.fail("never show/reclaim a test window"),
    webContents: {
      isDestroyed: () => false,
      sendInputEvent: (event) => sent.push(event),
    },
  };
  return {
    win,
    sent,
    blur: () => {
      focused = false;
    },
  };
}

test("actual orbit dispatch uses the current field and Shift+arrow, stopping at focus/deadline boundaries", async () => {
  const a = owner();
  await nativeOrbit(
    a.win,
    async (code) => {
      assert.ok(code.includes(".aw-spatial-field"));
      return true;
    },
    "Right",
  );
  assert.deepEqual(a.sent, [
    { type: "keyDown", keyCode: "Right", modifiers: ["shift"] },
    { type: "keyUp", keyCode: "Right", modifiers: ["shift"] },
  ]);
  const b = owner();
  b.blur();
  await assert.rejects(
    nativeOrbit(
      b.win,
      async () => assert.fail("inactive owner cannot even receive field focus"),
      "Left",
    ),
  );
  assert.equal(b.sent.length, 0);
  const c = owner();
  await assert.rejects(
    nativeOrbit(
      c.win,
      async () => {
        c.blur();
        return true;
      },
      "Up",
    ),
  );
  assert.equal(c.sent.length, 0);
  const d = owner();
  let expired = false;
  await assert.rejects(
    nativeOrbit(
      d.win,
      async () => {
        expired = true;
        return true;
      },
      "Down",
      () => {
        if (expired) throw Error("deadline");
      },
    ),
    /deadline/,
  );
  assert.equal(d.sent.length, 0);
});

test("benchmark control settling rechecks the run guard before dispatching any delayed native click", async () => {
  const a = owner();
  const controls = benchmarkControls(
    a.win,
    async () => ({ x: 10, y: 20 }),
    () => {},
    async () => {},
  );
  await controls.click("#settings-button");
  assert.deepEqual(
    a.sent.map((event) => event.type),
    ["mouseMove", "mouseDown", "mouseUp"],
  );
  for (const reason of ["operator_escape", "deadline", "focus_lost"]) {
    const b = owner();
    let reads = 0,
      stopped = false;
    const guarded = benchmarkControls(
      b.win,
      async () => {
        if (++reads === 2) stopped = true;
        return { x: 10, y: 20 };
      },
      () => {
        if (stopped) throw Error(reason);
      },
      async () => {},
    );
    await assert.rejects(guarded.click("#settings-button"), new RegExp(reason));
    assert.equal(b.sent.length, 0);
  }
});

test("the required separate native matrix retains all project/resource scales and the dense single-project case", () => {
  for (const count of [1, 3, 10])
    assert.ok(REQUIRED_MATRIX.some((entry) => entry.projects === count));
  for (const count of [50, 250, 2000, 10000])
    assert.ok(REQUIRED_MATRIX.some((entry) => entry.resources === count));
  assert.ok(
    REQUIRED_MATRIX.some(
      (entry) => entry.projects === 1 && entry.resources === 10000,
    ),
  );
  assert.equal(LIMITS.samples, 40);
  assert.ok(LIMITS.receiptBytes <= 1024 * 1024);
});
