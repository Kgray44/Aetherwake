const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const {
  REQUIRED_MATRIX,
  LIMITS,
  verificationDeadline,
  spatialObservation,
  nativeOrbit,
  benchmarkControls,
  assertBodyCounters,
  universeObservation,
  assertUniverseFrame,
  qualifyPerformanceCase,
  nativeRecenter,
  startPresentationCapture,
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

function universeFixture(count = 10, visible = count) {
  const ids = Array.from({ length: count }, (_, i) => "canonical-project-" + i),
    s = snapshot();
  s.spatial.location = { kind: "universe" };
  Object.assign(s.spatial.renderer, {
    nodes: visible,
    detailedBodies: visible,
    instancedBodies: 0,
    instanceDrawCount: count,
    culled: count - visible,
    projectedBodies: ids
      .slice(0, visible)
      .map((id) => ({ key: "project:" + id })),
  });
  return {
    ids,
    s,
    observation: {
      ...spatialObservation(s),
      universe: universeObservation(s, ids),
    },
  };
}

test("actual Universe browser projection verifies canonical star identity/count and never reads large project geometry in another scope", () => {
  const f = universeFixture();
  const value = vm.runInNewContext(
    "(" + universeObservation.toString() + ")(fixture,ids)",
    { fixture: f.s, ids: f.ids },
  );
  assert.deepEqual(JSON.parse(JSON.stringify(value)), f.observation.universe);
  assert.equal(value.visibleProjectStars, 10);
  assert.equal(value.allCanonicalStarsVisible, true);
  assert.ok(Buffer.byteLength(JSON.stringify(value)) < 1024);
  const wrong = snapshot();
  wrong.spatial.location = { kind: "project" };
  Object.defineProperty(wrong.spatial.renderer, "projectedBodies", {
    get() {
      assert.fail(
        "never scan the dense project array for Universe qualification",
      );
    },
  });
  assert.equal(universeObservation(wrong, f.ids).invalid, "not_universe");
  const oversized = universeFixture();
  oversized.s.spatial.renderer.projectedBodies = new Proxy(Array(10000), {
    get(target, key) {
      if (key !== "length") assert.fail("do not iterate unbounded body data");
      return target.length;
    },
  });
  assert.equal(
    universeObservation(oversized.s, oversized.ids).invalid,
    "unbounded_or_missing_universe_bodies",
  );
});

test("Universe frame admission rejects substituted/duplicate stars, stale counts and partial framing", () => {
  const f = universeFixture();
  assertUniverseFrame(f.observation, 10, true);
  const partial = universeFixture(10, 9);
  assertUniverseFrame(partial.observation, 10);
  assert.throws(
    () => assertUniverseFrame(partial.observation, 10, true),
    /framed together/,
  );
  for (const key of [
    "workspace:wrong",
    "project:foreign",
    "project:" + f.ids[0],
  ]) {
    const changed = universeFixture();
    changed.s.spatial.renderer.projectedBodies[1].key = key;
    assert.throws(() =>
      assertUniverseFrame(
        {
          ...changed.observation,
          universe: universeObservation(changed.s, changed.ids),
        },
        10,
        true,
      ),
    );
  }
  assert.throws(() =>
    assertUniverseFrame(
      {
        ...f.observation,
        renderer: {
          ...f.observation.renderer,
          nodes: 9,
          instancedBodies: 0,
          detailedBodies: 9,
        },
      },
      10,
    ),
  );
  assert.equal(
    universeObservation(f.s, [...f.ids, f.ids[0]]).invalid,
    "invalid_canonical_project_ids",
  );
});

test("case qualification requires both independent OS captures, complete native samples, GPU/camera progress and real Universe coverage", () => {
  const f = universeFixture();
  const phase = {
    presentation: { qualified: true },
    timing: { motionSamples: { initialGpuFrame: 1 } },
    samples: Array.from({ length: 40 }, () => ({
      ...structuredClone(f.observation),
      gpu: { framesRendered: 2 },
      camera: { yaw: 0.8, pitch: 0.4 },
    })),
  };
  const receipt = {
    ...structuredClone(phase),
    seed: { projectCount: 10 },
    initialCamera: { yaw: 0.4, pitch: 0.3 },
    universe: {
      ...structuredClone(phase),
      state: "completed",
      initialObservation: structuredClone(f.observation),
      finalObservation: structuredClone(f.observation),
    },
  };
  assert.equal(qualifyPerformanceCase(receipt), true);
  const mutations = [
    (r) => {
      r.presentation.qualified = false;
    },
    (r) => {
      r.universe.presentation.qualified = false;
    },
    (r) => {
      r.universe.state = "partial";
    },
    (r) => {
      r.samples.pop();
    },
    (r) => {
      r.universe.samples.pop();
    },
    (r) => {
      r.universe.finalObservation = universeFixture(10, 9).observation;
    },
    (r) => {
      r.universe.samples[0].universe.scope = "project";
    },
    (r) => {
      r.universe.samples.forEach((s) => (s.gpu.framesRendered = 1));
    },
    (r) => {
      r.universe.samples.forEach(
        (s) => (s.camera = structuredClone(f.observation.camera)),
      );
    },
  ];
  for (const change of mutations) {
    const copy = structuredClone(receipt);
    change(copy);
    assert.equal(qualifyPerformanceCase(copy), false);
  }
  assert.equal(qualifyPerformanceCase({}), false);
});

test("separate owned PresentMon captures use different files/session names, pinned bounded arguments and independent timestamps", async () => {
  const calls = [],
    children = [];
  let now = 1000000;
  const spawnChild = (tool, args, options) => {
    calls.push({ tool, args, options });
    const child = new EventEmitter();
    Object.assign(child, {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      pid: 200 + children.length,
      exitCode: null,
      signalCode: null,
    });
    children.push(child);
    return child;
  };
  const out = path.resolve("unit-evidence-not-written"),
    tool = path.resolve("unit-tool-not-executed.exe");
  const project = startPresentationCapture(
    tool,
    345,
    out,
    "project",
    spawnChild,
    () => now,
  );
  children[0].emit("spawn");
  children[0].stdout.emit("data", Buffer.alloc(70000, 65));
  now += 12000;
  children[0].emit("close", 0, null);
  const first = await project.done;
  const universe = startPresentationCapture(
    tool,
    346,
    out,
    "universe",
    spawnChild,
    () => now,
  );
  children[1].emit("spawn");
  now += 12000;
  children[1].emit("close", 0, null);
  const second = await universe.done;
  assert.notEqual(project.file, universe.file);
  assert.equal(path.dirname(universe.file), out);
  assert.notDeepEqual(project.timing, universe.timing);
  assert.equal(project.timing.endedAt, universe.timing.spawnRequestedAt);
  assert.equal(Buffer.byteLength(first.log), 65536);
  assert.equal(second.log, "");
  for (const call of calls) {
    assert.equal(call.options.windowsHide, true);
    assert.equal(call.options.stdio[0], "ignore");
    assert.equal(call.args[call.args.indexOf("--timed") + 1], "12");
    assert.ok(call.args.includes("--terminate_after_timed"));
  }
  assert.notEqual(
    calls[0].args[calls[0].args.indexOf("--session_name") + 1],
    calls[1].args[calls[1].args.indexOf("--session_name") + 1],
  );
  assert.throws(() =>
    startPresentationCapture(tool, 345, out, "../../escape", spawnChild),
  );
  assert.equal(calls.length, 2);
  const failed = startPresentationCapture(
    tool,
    345,
    out,
    "project",
    spawnChild,
    () => now,
  );
  children[2].emit("error", Error("capture unavailable"));
  assert.equal((await failed.done).error, "capture unavailable");
});

test("Universe recenter dispatches the real Home key with the same focus/deadline fences and no window reclamation", async () => {
  const a = owner();
  await nativeRecenter(a.win, async () => true);
  assert.deepEqual(a.sent, [
    { type: "keyDown", keyCode: "Home", modifiers: [] },
    { type: "keyUp", keyCode: "Home", modifiers: [] },
  ]);
  const b = owner();
  await assert.rejects(
    nativeRecenter(b.win, async () => {
      b.blur();
      return true;
    }),
  );
  assert.equal(b.sent.length, 0);
});
