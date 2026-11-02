const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { createHash } = require("node:crypto");
const {
  assertNativeOwner,
  nativeInput,
} = require("../../../constellation/tests/native-input.cjs");

const REQUIRED_MATRIX = Object.freeze([
  { projects: 1, resources: 50 },
  { projects: 3, resources: 250 },
  { projects: 10, resources: 2000 },
  { projects: 10, resources: 10000 },
  { projects: 1, resources: 10000 },
]);
const LIMITS = Object.freeze({
  samples: 40,
  samplePauseMs: 250,
  pngBytes: 8 * 1024 * 1024,
  csvBytes: 8 * 1024 * 1024,
  receiptBytes: 512 * 1024,
  progressBytes: 256 * 1024,
  seedBytes: 64 * 1024,
  toolBytes: 64 * 1024 * 1024,
});
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function verificationDeadline(argv, moduleStarted, now = Date.now()) {
  const args = argv.filter((arg) =>
    arg.startsWith("--verification-deadline-ms="),
  );
  assert.equal(
    args.length,
    1,
    "one explicit verification deadline is required",
  );
  const durationMs = Number(
    args[0].slice("--verification-deadline-ms=".length),
  );
  assert(
    Number.isInteger(durationMs) && durationMs >= 1000 && durationMs <= 180000,
    "verification deadline must be between 1000 and 180000 ms",
  );
  assert(
    Number.isFinite(moduleStarted) && moduleStarted > 0 && moduleStarted <= now,
    "actual host module start time required",
  );
  assert(
    moduleStarted + durationMs > now,
    "verification deadline already expired",
  );
  return { durationMs, expiresAt: moduleStarted + durationMs };
}

/** Standalone browser-side projection. Never transfer per-body geometry/IDs or
 * full GPU/renderer snapshots through each measurement IPC. Missing is null. */
function spatialObservation(snapshot) {
  const number = (value) =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  const boolean = (value) => (typeof value === "boolean" ? value : null);
  const r = snapshot?.spatial?.renderer ?? {},
    g = snapshot?.gpu ?? {},
    c = snapshot?.spatial?.camera ?? {},
    layer = g.spatialLayer ?? {};
  const renderer = Object.fromEntries(
    [
      "drawCalls",
      "triangles",
      "nodes",
      "edges",
      "culled",
      "cpuSubmitMs",
      "overlapCulled",
      "detailedBodies",
      "instancedBodies",
      "instanceDrawCount",
      "arrivingBodies",
    ].map((key) => [key, number(r[key])]),
  );
  return {
    renderer,
    gpu: {
      framesRendered: number(g.framesRendered),
      geometries: number(g.geometries),
      textures: number(g.textures),
      drawCalls: number(g.drawCalls),
      triangles: number(g.triangles),
      spatialLayer: {
        active: boolean(layer.active),
        failed: boolean(layer.failed),
      },
    },
    quality:
      typeof snapshot?.quality === "string"
        ? snapshot.quality.slice(0, 24)
        : null,
    camera: {
      target: {
        x: number(c.target?.x),
        y: number(c.target?.y),
        z: number(c.target?.z),
      },
      distance: number(c.distance),
      yaw: number(c.yaw),
      pitch: number(c.pitch),
    },
  };
}

async function nativeOrbit(win, js, key, guard = () => {}) {
  assert(
    ["Up", "Right", "Down", "Left"].includes(key),
    "bounded orbit direction",
  );
  guard();
  assertNativeOwner(win);
  const focused = await js(
    "(function(){const e=document.querySelector('.aw-spatial-field');if(!e||e.hidden||!e.getClientRects().length||e.closest('[inert]'))return false;e.focus({preventScroll:true});return document.activeElement===e})()",
  );
  guard();
  assertNativeOwner(win);
  assert.equal(focused, true, "actual spatial field must own keyboard focus");
  nativeInput(win, { type: "keyDown", keyCode: key, modifiers: ["shift"] });
  guard();
  nativeInput(win, { type: "keyUp", keyCode: key, modifiers: ["shift"] });
}

/** Every awaited UI lookup is followed by a fresh deadline/operator/owner check
 * before input. The shared desktop driver does not accept that run guard. */
function benchmarkControls(win, js, guard, ownedPause) {
  const read = async (code) => {
    guard();
    const value = await js(code);
    guard();
    return value;
  };
  const wait = async (expression, timeout = 20000) => {
    const end = Date.now() + timeout;
    do {
      if (
        await read(`(()=>{try{return (${expression})}catch{return false}})()`)
      )
        return;
      await ownedPause(80);
    } while (Date.now() < end);
    throw Error("Timed out " + expression);
  };
  const click = async (selector) => {
    const end = Date.now() + 2000;
    let point, previous;
    do {
      await ownedPause(80);
      point = await read(
        `(()=>{const e=document.querySelector(${JSON.stringify(selector)});e?.scrollIntoView({block:'nearest',inline:'nearest'});const r=e?.getBoundingClientRect();if(!r||!r.width||!r.height||e.disabled||e.hidden||e.closest('[inert]'))return {error:'Unavailable control'};const x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2),hit=document.elementFromPoint(x,y);return hit&&(hit===e||e.contains(hit))?{x,y}:{error:'Occluded control'}})()`,
      );
      if (
        !point.error &&
        previous &&
        !previous.error &&
        Math.hypot(point.x - previous.x, point.y - previous.y) < 0.75
      ) {
        for (const type of ["mouseMove", "mouseDown", "mouseUp"]) {
          guard();
          nativeInput(win, { type, ...point, button: "left", clickCount: 1 });
        }
        await ownedPause(50);
        return;
      }
      previous = point;
    } while (Date.now() < end);
    throw Error(
      (point?.error ?? "Moving native click target") + ": " + selector,
    );
  };
  const fill = (selector, value) =>
    read(
      `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled||e.hidden||e.closest('[inert]'))throw Error('Unavailable control');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))})()`,
    );
  return {
    read,
    wait,
    click,
    fill,
    snapshot: () => read("window.__aerynth.application()"),
  };
}

function assertBodyCounters(renderer, cap, canonicalBound) {
  for (const key of [
    "nodes",
    "culled",
    "detailedBodies",
    "instancedBodies",
    "instanceDrawCount",
  ])
    assert(
      Number.isInteger(renderer[key]) && renderer[key] >= 0,
      "missing/invalid " + key,
    );
  assert(renderer.detailedBodies <= cap, "detailed-body quality budget");
  assert.equal(
    renderer.nodes,
    renderer.detailedBodies + renderer.instancedBodies,
    "all on-screen bodies use detailed or instanced presentation",
  );
  assert(
    renderer.nodes + renderer.culled <= canonicalBound,
    "canonical body allocation bound",
  );
  assert(
    renderer.instanceDrawCount <= canonicalBound,
    "instance allocation bound",
  );
  assert.equal(
    renderer.overlapCulled,
    0,
    "camera alignment must not remove bodies",
  );
}
function scalarMemory(value) {
  return Object.fromEntries(
    Object.entries(value ?? {})
      .filter(([, v]) => Number.isFinite(v))
      .slice(0, 16),
  );
}

exports.REQUIRED_MATRIX = REQUIRED_MATRIX;
exports.LIMITS = LIMITS;
exports.verificationDeadline = verificationDeadline;
exports.spatialObservation = spatialObservation;
exports.nativeOrbit = nativeOrbit;
exports.benchmarkControls = benchmarkControls;
exports.assertBodyCounters = assertBodyCounters;

exports.verify = async ({
  win,
  app,
  call,
  source,
  privateRoot,
  moduleStarted,
}) => {
  const base = path.resolve(__dirname, "../.runtime/application-evidence");
  await fs.mkdir(base, { recursive: true });
  const out = await fs.mkdtemp(
    path.join(base, "spatial-scale-" + Date.now() + "-"),
  );
  const helperStarted = Date.now();
  const receipt = {
    contract: "aerynth.spatial-scale@2",
    source,
    syntheticData: true,
    passed: false,
    state: "preflight",
    host: "Actual Aerynth desktop, canonical SQLite corpus and shared V3.5 GPU context",
    requiredSeparateRuns: REQUIRED_MATRIX,
    matrixComplete: false,
    limits: LIMITS,
    timing: { helperStartedAt: new Date(helperStarted).toISOString() },
    captures: [],
    samples: [],
    regressions: [],
    limitations: [
      "This receipt qualifies one explicit matrix case, not the complete required matrix.",
      "Constellation CPU submission may reuse earlier host-frame preparation; it is not whole-frame or GPU elapsed time.",
      "Callback/draw intervals are not presented frames; PresentMon has its own independently recorded window.",
      "Sampling includes guarded input, IPC and a deliberate pause; its cadence is not frame pacing.",
      "Bounded progress/checkpoint I/O and CSV-size monitoring are part of this harness's overhead.",
      "Bounded samples do not establish long-term memory, power, thermal or full product/artistic acceptance.",
      "Other applications and background hardware load were not controlled.",
    ],
  };
  let present,
    budget,
    abort,
    ownerContents,
    progressBytes = 0;
  const beforeInput = (_event, input) => {
    if (input.type === "keyDown" && input.key === "Escape")
      abort = new Error("native_spatial_operator_escape");
  };
  function guard(ownership = true) {
    if (abort) throw abort;
    if (budget && Date.now() >= budget.expiresAt)
      throw Error("native_spatial_deadline");
    if (ownership) assertNativeOwner(win);
  }
  async function ownedPause(ms, ownership = true) {
    const end = Date.now() + ms;
    do {
      guard(ownership);
      await pause(Math.min(50, Math.max(1, end - Date.now())));
      if (present)
        try {
          assert(
            (await fs.stat(path.join(out, "presentation.csv"))).size <=
              LIMITS.csvBytes,
            "presentation CSV byte bound",
          );
        } catch (error) {
          if (error.code !== "ENOENT") {
            if (present.exitCode === null) present.kill();
            throw error;
          }
        }
    } while (Date.now() < end);
    guard(ownership);
  }
  async function progress(event) {
    const text =
      JSON.stringify({ at: new Date().toISOString(), ...event }) + "\n";
    assert(
      progressBytes + Buffer.byteLength(text) <= LIMITS.progressBytes,
      "progress byte bound",
    );
    await fs.appendFile(path.join(out, "progress.jsonl"), text);
    progressBytes += Buffer.byteLength(text);
  }
  async function checkpoint() {
    const text = JSON.stringify(receipt, null, 2);
    assert(
      Buffer.byteLength(text) <= LIMITS.receiptBytes,
      "receipt byte bound",
    );
    await fs.writeFile(path.join(out, "scale.pending.json"), text);
    await fs.rename(
      path.join(out, "scale.pending.json"),
      path.join(out, "scale.json"),
    );
  }
  async function capture(name) {
    guard();
    const bytes = (await win.webContents.capturePage()).toPNG();
    guard();
    assert(bytes.length <= LIMITS.pngBytes, "screenshot byte bound");
    await fs.writeFile(path.join(out, name + ".png"), bytes, { flag: "wx" });
    receipt.captures.push({
      file: name + ".png",
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      at: new Date().toISOString(),
    });
  }
  try {
    budget = verificationDeadline(process.argv, moduleStarted);
    receipt.timing.moduleStartedAt = new Date(moduleStarted).toISOString();
    receipt.timing.deadlineAt = new Date(budget.expiresAt).toISOString();
    receipt.timing.deadlineMs = budget.durationMs;
    assert(
      source?.hashes && source?.buildAssets,
      "source and build hashes required",
    );
    await checkpoint();
    await progress({ phase: "preflight", complete: false });
    // Preserve an earlier host timeout if this canonical seed is reused.
    try {
      const old = path.join(privateRoot, "verification-timeout.json");
      assert(
        (await fs.stat(old)).size <= LIMITS.seedBytes,
        "prior-timeout byte bound",
      );
      await fs.writeFile(
        path.join(out, "prior-verification-timeout.json"),
        await fs.readFile(old),
        { flag: "wx" },
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const seedPath = path.join(privateRoot, "scale-seed.json");
    assert(
      (await fs.stat(seedPath)).size <= LIMITS.seedBytes,
      "seed byte bound",
    );
    const seed = JSON.parse(await fs.readFile(seedPath, "utf8"));
    assert(seed.canonical === true && seed.syntheticData === true);
    assert(
      [1, 3, 10].includes(seed.projectCount) &&
        [50, 250, 2000, 10000].includes(seed.resourceCount),
      "explicit bounded project/resource case required",
    );
    assert(Number.isInteger(seed.workspaceCount) && seed.workspaceCount > 0);
    receipt.seed = seed;
    receipt.case = {
      projects: seed.projectCount,
      resources: seed.resourceCount,
    };
    const canonicalBound =
      seed.resourceCount + seed.workspaceCount + seed.projectCount;
    const {
      checkLabelClearance,
    } = require("../../../constellation/tests/native-labels.cjs");
    const {
      percentiles,
      summarizePresentMon,
    } = require("./presentation-metrics.cjs");
    guard();
    ownerContents = win.webContents;
    ownerContents.on("before-input-event", beforeInput);
    const js = (code) => win.webContents.executeJavaScript(code, true);
    const { read, wait, click, fill, snapshot } = benchmarkControls(
      win,
      js,
      guard,
      ownedPause,
    );
    const waitOwned = async (code, ms = 20000) => {
      guard();
      await wait(
        code,
        Math.max(1, Math.min(ms, budget.expiresAt - Date.now())),
      );
      guard();
    };
    await waitOwned('document.body.dataset.applicationHydrated === "true"');
    const observe = () =>
      read(
        "(" + spatialObservation.toString() + ")(window.__aerynth.snapshot())",
      );
    receipt.startupToInteractiveMs = Date.now() - moduleStarted;
    let s = await snapshot();
    guard();
    assert.equal(s.resources.length, seed.resourceCount);
    assert.equal(s.projects.length, seed.projectCount);
    assert.equal(s.relationships.length, seed.relationshipCount);
    assert.equal(s.navigation.kind, "constellation");
    assert(s.navigation.projectId);
    await waitOwned(
      "window.__aerynth.snapshot().gpu?.spatialLayer.active&&!window.__aerynth.snapshot().gpu.spatialLayer.failed&&window.__aerynth.snapshot().spatial.renderer.nodes>0",
    );
    await click("#settings-button");
    await fill("#quality", "balanced");
    for (const selector of ["#quiet", "#reduced"])
      if (
        await read(
          "document.querySelector(" + JSON.stringify(selector) + ").checked",
        )
      )
        await click(selector);
    await click("#settings-close");
    await ownedPause(1200);
    receipt.foreground = win.isFocused();
    receipt.labelClearance = await checkLabelClearance(win);
    await capture("project-before");
    const initial = await observe();
    assertBodyCounters(initial.renderer, 160, canonicalBound);
    receipt.initialCamera = initial.camera;
    receipt.state = "ready";
    await checkpoint();
    const gpu = app.getAppMetrics().find((p) => p.type === "GPU");
    const tool = process.argv
      .find((a) => a.startsWith("--presentmon="))
      ?.slice(13);
    let presentDone;
    if (tool && gpu) {
      guard();
      assert(path.isAbsolute(tool));
      assert(
        (await fs.stat(tool)).size <= LIMITS.toolBytes,
        "presentation tool byte bound",
      );
      assert.equal(
        createHash("sha256")
          .update(await fs.readFile(tool))
          .digest("hex"),
        "b2a706bc6ad475749e3b7e3409263aa1e6906d45bdcf993f6dbc0f660188f1af",
      );
      receipt.timing.presentMon = {
        spawnRequestedAt: new Date().toISOString(),
        requestedSeconds: 12,
        targetGpuPid: gpu.pid,
      };
      present = spawn(
        tool,
        [
          "--process_id",
          String(gpu.pid),
          "--output_file",
          path.join(out, "presentation.csv"),
          "--timed",
          "12",
          "--terminate_after_timed",
          "--no_console_stats",
          "--v1_metrics",
          "--session_name",
          "Aerynth-" + process.pid + "-" + Date.now(),
        ],
        { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
      );
      present.once("spawn", () => {
        receipt.timing.presentMon.spawnedAt = new Date().toISOString();
      });
      const log = [];
      let logBytes = 0;
      for (const stream of [present.stdout, present.stderr])
        stream.on("data", (chunk) => {
          const take = chunk.subarray(0, Math.max(0, 65536 - logBytes));
          if (take.length) {
            log.push(take.toString());
            logBytes += take.length;
          }
        });
      presentDone = new Promise((resolve) => {
        present.once("error", (error) =>
          resolve({ error: error.message, endedAt: new Date().toISOString() }),
        );
        present.once("exit", (code) =>
          resolve({
            code,
            log: log.join(""),
            endedAt: new Date().toISOString(),
          }),
        );
      });
    }
    receipt.timing.callbackWindow = {
      resetRequestedAt: new Date().toISOString(),
    };
    await read("window.__aerynth.resetMetrics()");
    const samplingStart = await observe();
    assert(
      Number.isFinite(samplingStart.gpu.framesRendered),
      "real GPU frame counter required",
    );
    receipt.state = "sampling";
    receipt.timing.motionSamples = {
      startedAt: new Date().toISOString(),
      targetPauseMs: LIMITS.samplePauseMs,
      initialGpuFrame: samplingStart.gpu.framesRendered,
    };
    await checkpoint();
    for (let i = 0; i < LIMITS.samples; i++) {
      guard();
      await nativeOrbit(win, js, ["Up", "Right", "Down", "Left"][i % 4], guard);
      await ownedPause(LIMITS.samplePauseMs);
      const observation = await observe();
      assertBodyCounters(observation.renderer, 160, canonicalBound);
      assert(
        observation.gpu.spatialLayer.active &&
          observation.gpu.spatialLayer.failed === false,
      );
      assert(
        Number.isFinite(observation.renderer.cpuSubmitMs) &&
          observation.renderer.cpuSubmitMs >= 0,
      );
      const sample = {
        at: new Date().toISOString(),
        moduleElapsedMs: Date.now() - moduleStarted,
        ...observation,
        focused: win.isFocused(),
        minimized: win.isMinimized(),
      };
      receipt.samples.push(sample);
      await progress({ phase: "sample", index: i, sample });
      if ((i + 1) % 10 === 0) await checkpoint();
    }
    receipt.timing.motionSamples.endedAt = new Date().toISOString();
    receipt.timing.motionSamples.count = receipt.samples.length;
    assert(
      receipt.samples.some(
        (sample) =>
          sample.gpu.framesRendered > samplingStart.gpu.framesRendered,
      ),
      "actual GPU draws must advance during camera input",
    );
    assert(
      receipt.samples.some(
        (sample) =>
          Math.abs(sample.camera.yaw - initial.camera.yaw) > 0.001 ||
          Math.abs(sample.camera.pitch - initial.camera.pitch) > 0.001,
      ),
      "actual keyboard input must move the 3D camera",
    );
    receipt.foregroundThroughoutSamples = receipt.samples.every(
      (sample) => sample.focused && !sample.minimized,
    );
    const metrics = await read("window.__aerynth.snapshot().metrics");
    receipt.timing.callbackWindow.readCompletedAt = new Date().toISOString();
    receipt.callbackMetrics = {
      callbacks: metrics.callbacks,
      draws: metrics.draws,
      policy: String(metrics.policy).slice(0, 160),
    };
    receipt.callbackIntervalsMs = percentiles(metrics.intervals);
    receipt.drawIntervalsMs = percentiles(metrics.drawIntervals);
    receipt.spatialCpuSubmissionMs = percentiles(
      receipt.samples
        .filter(
          (sample, i) =>
            i === 0 ||
            sample.gpu.framesRendered !==
              receipt.samples[i - 1].gpu.framesRendered,
        )
        .map((sample) => sample.renderer.cpuSubmitMs),
    );
    receipt.spatialMax = Object.fromEntries(
      [
        "nodes",
        "detailedBodies",
        "instancedBodies",
        "instanceDrawCount",
        "drawCalls",
        "triangles",
        "culled",
      ].map((key) => [
        key,
        Math.max(...receipt.samples.map((sample) => sample.renderer[key])),
      ]),
    );
    const memoryAt = new Date().toISOString(),
      ownMetrics = app.getAppMetrics();
    receipt.memory = {
      requestedAt: memoryAt,
      rendererKiB: scalarMemory(
        ownMetrics.find((p) => p.pid === win.webContents.getOSProcessId())
          ?.memory,
      ),
      gpuKiB: scalarMemory(ownMetrics.find((p) => p.type === "GPU")?.memory),
      backendBytes: scalarMemory(await call("metrics", {})),
    };
    receipt.memory.completedAt = new Date().toISOString();
    receipt.state = "sampled";
    await checkpoint();
    if (presentDone) {
      const end = Math.min(budget.expiresAt, Date.now() + 16000);
      let done;
      presentDone.then((result) => {
        done = result;
      });
      while (!done && Date.now() < end) await ownedPause(50);
      const result = done ?? {
        error: "presentation_capture_timeout",
        endedAt: new Date().toISOString(),
      };
      receipt.presentMon = result;
      receipt.timing.presentMon.endedAt = result.endedAt;
      if (result.error && present?.exitCode === null) present.kill();
      try {
        assert(
          !result.error && result.code === 0,
          "presentation process did not finish successfully",
        );
        const file = path.join(out, "presentation.csv");
        assert(
          (await fs.stat(file)).size <= LIMITS.csvBytes,
          "presentation CSV byte bound",
        );
        receipt.presentation = summarizePresentMon(
          await fs.readFile(file, "utf8"),
          gpu.pid,
        );
      } catch (error) {
        receipt.presentation = { qualified: false, reason: error.message };
      }
    } else
      receipt.presentation = {
        qualified: false,
        reason: "PresentMon_or_target_GPU_PID_unavailable",
      };
    if (process.argv.includes("--spatial-regression")) {
      await ownedPause(14500);
      receipt.idlePolicy = await read(
        "window.__aerynth.snapshot().metrics.policy",
      );
      assert(receipt.idlePolicy.includes("idle"));
      receipt.regressions.push("real-visible-idle-policy");
      await click("#settings-button");
      receipt.qualityChecks = [];
      for (const [quality, cap] of [
        ["efficient", 70],
        ["balanced", 160],
        ["cinematic", 280],
      ]) {
        const before = (await observe()).gpu.framesRendered;
        await fill("#quality", quality);
        await waitOwned(
          "window.__aerynth.snapshot().quality===" +
            JSON.stringify(quality) +
            "&&window.__aerynth.snapshot().gpu.framesRendered>" +
            before,
        );
        const observed = await observe();
        assertBodyCounters(observed.renderer, cap, canonicalBound);
        receipt.qualityChecks.push({
          quality,
          at: new Date().toISOString(),
          renderer: observed.renderer,
        });
      }
      receipt.regressions.push(
        "three-real-graphics-tiers-preserve-visible-bodies-with-bounded-detail",
      );
      await click("#quiet");
      await click("#settings-close");
      await ownedPause(350);
      const quietDraws = await read(
        "window.__aerynth.snapshot().metrics.draws",
      );
      await ownedPause(500);
      assert.equal(
        await read("window.__aerynth.snapshot().metrics.draws"),
        quietDraws,
      );
      receipt.regressions.push("Quiet-suspends-settled-graphics");
      await click("#settings-button");
      await click("#quiet");
      await click("#reduced");
      await click("#settings-close");
      const camera = (await observe()).camera;
      await nativeOrbit(win, js, "Right", guard);
      await ownedPause(100);
      assert.notEqual((await observe()).camera.yaw, camera.yaw);
      assert.equal(await read("window.__aerynth.snapshot().reduced"), true);
      receipt.regressions.push(
        "reduced-motion-retains-native-spatial-navigation",
      );
      guard();
      const size = win.getSize();
      win.setContentSize(1050, 800);
      await ownedPause(900);
      const labels = await read(
        "[...document.querySelectorAll('.aw-anchor[data-key]')].map(e=>e.dataset.key)",
      );
      assert(labels.length > 0);
      assert.equal(new Set(labels).size, labels.length);
      receipt.smallWindowLabelClearance = await checkLabelClearance(win);
      guard();
      win.setSize(...size);
      await ownedPause(250);
      receipt.regressions.push(
        "native-window-resize-keeps-unique-current-labels",
      );
      await read("window.__aerynth.simulateContextLoss()");
      await waitOwned("window.__aerynth.snapshot().graphicsFailed");
      await read("window.__aerynth.restoreContext()");
      await waitOwned(
        "!window.__aerynth.snapshot().graphicsFailed&&window.__aerynth.snapshot().gpu.spatialLayer.active&&!window.__aerynth.snapshot().gpu.spatialLayer.failed",
      );
      receipt.regressions.push(
        "real-WebGL-recovery-restores-combined-spatial-layer",
      );
      await click('button[data-scene="living"]');
      await ownedPause(200);
      assert.equal(await read("window.__aerynth.snapshot().study"), "living");
      await click('button[data-scene="architecture"]');
      receipt.regressions.push("native-scene-change-retains-spatial-layer");
      // Explicit lifecycle regression: read-only suspension observations while
      // minimized. Restore never calls focus(); absent ownership stops the run.
      guard();
      receipt.timing.minimize = { startedAt: new Date().toISOString() };
      win.minimize();
      await ownedPause(500, false);
      assert(win.isMinimized());
      const stopped = await js("window.__aerynth.snapshot().metrics.draws");
      await ownedPause(400, false);
      assert.equal(
        await js("window.__aerynth.snapshot().metrics.draws"),
        stopped,
      );
      guard(false);
      win.restore();
      await ownedPause(150, false);
      guard();
      await waitOwned("window.__aerynth.snapshot().active");
      receipt.timing.minimize.endedAt = new Date().toISOString();
      receipt.regressions.push(
        "actual-native-minimize-suspension-and-owned-restore",
      );
    }
    s = await snapshot();
    guard();
    assert.equal(s.resources.length, seed.resourceCount);
    assert.equal(s.relationships.length, seed.relationshipCount);
    await capture("project-after");
    receipt.passed = receipt.presentation?.qualified === true;
    receipt.state = receipt.passed ? "completed" : "partial";
    await progress({
      phase: receipt.state,
      currentCaseOnly: true,
      presentedTimingQualified: receipt.passed,
    });
  } catch (error) {
    receipt.passed = false;
    receipt.state = "failed";
    receipt.error = String(error.stack ?? error).slice(0, 16384);
    try {
      await progress({ phase: "failed", error: receipt.error });
    } catch {}
    if (budget)
      try {
        await capture("failure");
      } catch {}
  } finally {
    try {
      try {
        ownerContents?.removeListener("before-input-event", beforeInput);
      } catch (error) {
        receipt.listenerCleanupError = String(error.message).slice(0, 1024);
      }
      try {
        if (present?.exitCode === null) present.kill();
      } catch (error) {
        receipt.presentationCleanupError = String(error.message).slice(0, 1024);
      }
      receipt.timing.finishedAt = new Date().toISOString();
      receipt.helperElapsedMs = Date.now() - helperStarted;
      try {
        await checkpoint();
      } catch (error) {
        // Retain a bounded failure record even if expanded metadata exceeds its
        // admission ceiling; earlier checkpoints and the progress log remain.
        receipt.passed = false;
        await fs.writeFile(
          path.join(out, "scale-finalization-failure.json"),
          JSON.stringify({
            passed: false,
            state: "failed",
            error: String(error.message).slice(0, 1024),
            at: new Date().toISOString(),
            currentCaseOnly: true,
          }),
          { flag: "wx" },
        );
      }
      console.log(
        JSON.stringify({
          passed: receipt.passed,
          error: receipt.error,
          presentation: receipt.presentation,
          projects: receipt.seed?.projectCount,
          resources: receipt.seed?.resourceCount,
          matrixComplete: false,
          evidence: out,
        }),
      );
    } finally {
      process.exitCode = receipt.passed ? 0 : 1;
      app.quit();
    }
  }
};
