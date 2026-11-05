const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { createHash } = require("node:crypto");
const {
  assertNativeOwner,
  nativeInput,
} = require("../../../constellation/tests/native-input.cjs");
const {
  createNativeConsoleMonitor,
  frameCaptureHealth,
  assertFrameCaptureHealth,
} = require("../../../constellation/tests/native-console.cjs");

const REQUIRED_MATRIX = Object.freeze([
  { projects: 1, resources: 50 },
  { projects: 3, resources: 250 },
  { projects: 10, resources: 2000 },
  { projects: 10, resources: 10000 },
  { projects: 1, resources: 10000 },
]);
const LIMITS = Object.freeze({
  samples: 40,
  universeSamples: 40,
  tailSamples: 16,
  tailPauseMs: 250,
  markersPerPhase: 96,
  intervalValues: 50000,
  presentationCaptures: 2,
  screenshots: 5,
  samplePauseMs: 250,
  pngBytes: 8 * 1024 * 1024,
  csvBytes: 8 * 1024 * 1024,
  receiptBytes: 512 * 1024,
  progressBytes: 256 * 1024,
  seedBytes: 64 * 1024,
  toolBytes: 64 * 1024 * 1024,
});
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const monotonicNow = () => performance.now();

/** Supplemental diagnostics, not a responsiveness acceptance threshold. Every
 * finite value, including long gaps and zeros, participates in this summary. */
function intervalDistribution(values) {
  if (!Array.isArray(values)) return null;
  assert(values.length <= LIMITS.intervalValues, "interval diagnostic bound");
  const a = values.filter(Number.isFinite).sort((a, b) => a - b);
  const at = (fraction) => a[Math.floor(a.length * fraction)] ?? null;
  return {
    count: a.length,
    invalidValues: values.length - a.length,
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    p999: at(0.999),
    min: a[0] ?? null,
    max: a.at(-1) ?? null,
    mean: a.length ? a.reduce((sum, n) => sum + n, 0) / a.length : null,
    countsGreaterThanMs: Object.fromEntries(
      [16.667, 33.333, 50, 100, 250, 500].map((threshold) => [
        String(threshold),
        a.filter((value) => value > threshold).length,
      ]),
    ),
  };
}

/** Read-only supplement to the shared parser. Never merges swap chains or
 * removes a long interval. Raw-row accounting includes dropped/invalid rows. */
function presentationTailStatistics(csv, targetPid) {
  assert(
    Number.isInteger(targetPid) && targetPid > 0,
    "target GPU PID required",
  );
  assert(
    Buffer.byteLength(csv) <= LIMITS.csvBytes,
    "CSV diagnostic byte bound",
  );
  const lines = csv
    .replace(/^\uFEFF/, "")
    .trim()
    .split(/\r?\n/);
  assert(lines.length <= LIMITS.intervalValues + 1, "CSV diagnostic row bound");
  const cells = (line) => {
    const result = [];
    let value = "",
      quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (quoted && line[i + 1] === '"') {
          value += '"';
          i++;
        } else quoted = !quoted;
      } else if (c === "," && !quoted) {
        result.push(value);
        value = "";
      } else value += c;
    }
    assert(!quoted, "unterminated CSV diagnostic cell");
    result.push(value);
    return result;
  };
  const header = cells(lines.shift()).map((name) => name.trim().toLowerCase());
  assert.equal(new Set(header).size, header.length, "duplicate CSV columns");
  for (const name of [
    "processid",
    "swapchainaddress",
    "dropped",
    "msbetweendisplaychange",
  ])
    assert(header.includes(name), "missing CSV diagnostic column " + name);
  const groups = new Map();
  const number = (value) =>
    typeof value === "string" && value.trim() ? Number(value) : NaN;
  let targetRows = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    const values = cells(line);
    assert.equal(values.length, header.length, "CSV diagnostic column count");
    const row = Object.fromEntries(
      values.map((value, i) => [header[i], value]),
    );
    if (number(row.processid) !== targetPid) continue;
    targetRows++;
    let group = groups.get(row.swapchainaddress);
    if (!group) {
      group = {
        rows: 0,
        droppedRows: 0,
        unknownDroppedRows: 0,
        display: [],
        displayed: [],
        presents: [],
      };
      groups.set(row.swapchainaddress, group);
    }
    group.rows++;
    group.droppedRows += row.dropped === "1" ? 1 : 0;
    group.unknownDroppedRows += ["0", "1"].includes(row.dropped) ? 0 : 1;
    const interval = number(row.msbetweendisplaychange);
    group.display.push(interval);
    group.presents.push(number(row.msbetweenpresents));
    if (row.dropped === "0" && interval > 0) group.displayed.push(interval);
  }
  return {
    meaning:
      "Unfiltered target-row diagnostics; displayed intervals retain every positive non-dropped display event, including outliers. Threshold counts are observations, not acceptance limits.",
    targetRows,
    swapchains: [...groups].map(([key, group]) => ({
      id: createHash("sha256").update(key).digest("hex").slice(0, 12),
      rows: group.rows,
      droppedRows: group.droppedRows,
      unknownDroppedRows: group.unknownDroppedRows,
      allReportedDisplayIntervalsMs: intervalDistribution(group.display),
      displayedIntervalsMs: intervalDistribution(group.displayed),
      betweenPresentsMs: intervalDistribution(group.presents),
    })),
  };
}

function callbackWindowStatistics(metrics) {
  const number = (value) => (Number.isFinite(value) ? value : null);
  return {
    callbacks: number(metrics?.callbacks),
    draws: number(metrics?.draws),
    policy:
      typeof metrics?.policy === "string" ? metrics.policy.slice(0, 160) : null,
    callbackIntervalsMs: intervalDistribution(metrics?.intervals),
    drawIntervalsMs: intervalDistribution(metrics?.drawIntervals),
    intervalBufferSaturated: Array.isArray(metrics?.intervals)
      ? metrics.intervals.length >= 18000
      : null,
    drawBufferSaturated: Array.isArray(metrics?.drawIntervals)
      ? metrics.drawIntervals.length >= 18000
      : null,
    observedRendererErrors: Array.isArray(metrics?.errors)
      ? metrics.errors.slice(-16).map((error) => String(error).slice(0, 1024))
      : null,
  };
}

function hostClock(now = Date.now, monotonic = () => process.hrtime.bigint()) {
  return {
    utc: new Date(now()).toISOString(),
    monotonicNs: String(monotonic()),
  };
}

function nativeMarker(win, label) {
  return {
    label,
    ...hostClock(),
    native: {
      destroyed: win.isDestroyed(),
      visible: win.isVisible(),
      focused: win.isFocused(),
      minimized: win.isMinimized(),
      contentsDestroyed: win.webContents.isDestroyed(),
    },
  };
}

/** Standalone browser read. No focus, input, wake, snapshot or mutation. */
function browserTimingState() {
  return {
    visibilityState: document.visibilityState,
    hidden: document.hidden,
    focused: document.hasFocus(),
    timeOriginMs: performance.timeOrigin,
    nowMs: performance.now(),
  };
}

/** No-input observations after the original loop. Stop reading when capture
 * closure is observed; a read crossing closure is explicitly identified. */
async function collectPresentationTail({
  closed,
  observe,
  ownedPause,
  guard,
  mark,
  record = async () => {},
  deadlineAt,
  now = monotonicNow,
  elapsedNow = () => performance.now(),
}) {
  const result = {
    kind: "no-input measurement tail",
    samples: [],
    samplePauseMs: LIMITS.tailPauseMs,
    maxSamples: LIMITS.tailSamples,
  };
  let nextRead = elapsedNow() + LIMITS.tailPauseMs;
  while (!closed() && now() < deadlineAt) {
    guard();
    if (
      result.samples.length < LIMITS.tailSamples &&
      elapsedNow() >= nextRead
    ) {
      const requested = mark("tail-read-start");
      const observation = await observe();
      guard();
      const completed = mark("tail-read-end");
      const sample = {
        requested,
        completed,
        captureClosedAtReadCompletion: closed(),
        observation,
      };
      result.samples.push(sample);
      await record(sample, result.samples.length - 1);
      nextRead = elapsedNow() + LIMITS.tailPauseMs;
    } else await ownedPause(Math.min(50, Math.max(1, deadlineAt - now())));
  }
  guard();
  result.captureClosedObserved = closed();
  result.sampleLimitReached = result.samples.length === LIMITS.tailSamples;
  return result;
}

function verificationDeadline(
  argv,
  moduleStarted,
  moduleStartedMonotonicMs,
  nowMonotonicMs = monotonicNow(),
  nowWallMs = Date.now(),
) {
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
    Number.isFinite(moduleStarted) &&
      moduleStarted > 0 &&
      Number.isFinite(new Date(moduleStarted).getTime()),
    "actual host wall-clock start time required",
  );
  assert(
    Number.isFinite(nowMonotonicMs) &&
      nowMonotonicMs >= 0 &&
      Number.isFinite(nowWallMs),
    "actual admission clock samples required",
  );
  assert(
    Number.isFinite(moduleStartedMonotonicMs) &&
      moduleStartedMonotonicMs >= 0 &&
      moduleStartedMonotonicMs <= nowMonotonicMs,
    "actual host monotonic start time required",
  );
  const expiresAtMonotonicMs = moduleStartedMonotonicMs + durationMs;
  assert(
    expiresAtMonotonicMs > nowMonotonicMs,
    "verification deadline already expired",
  );
  const startupElapsedMs = nowMonotonicMs - moduleStartedMonotonicMs;
  const wallElapsedMs = nowWallMs - moduleStarted;
  return {
    durationMs,
    expiresAtMonotonicMs,
    clock: {
      basis: "performance.now() in the same Electron main process",
      moduleStartedWallMs: moduleStarted,
      moduleStartedMonotonicMs,
      admissionWallMs: nowWallMs,
      admissionMonotonicMs: nowMonotonicMs,
      startupElapsedMs,
      wallElapsedMs,
      discontinuityMs: wallElapsedMs - startupElapsedMs,
      wallReversed: nowWallMs < moduleStarted,
      deadlineAtMeaning:
        "Module-start wall-clock reference only; expiry is monotonic.",
    },
  };
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
  return nativeSpatialKey(win, js, key, ["shift"], guard);
}

async function nativeSpatialKey(win, js, key, modifiers, guard) {
  guard();
  assertNativeOwner(win);
  const focused = await js(
    "(function(){const e=document.querySelector('.aw-spatial-field');if(!e||e.hidden||!e.getClientRects().length||e.closest('[inert]'))return false;e.focus({preventScroll:true});return document.activeElement===e})()",
  );
  guard();
  assertNativeOwner(win);
  assert.equal(focused, true, "actual spatial field must own keyboard focus");
  nativeInput(win, { type: "keyDown", keyCode: key, modifiers });
  guard();
  nativeInput(win, { type: "keyUp", keyCode: key, modifiers });
}

const nativeRecenter = (win, js, guard = () => {}) =>
  nativeSpatialKey(win, js, "Home", [], guard);

/** Standalone browser projection. Inspect only the at-most-ten Universe body
 * keys after verifying scope/length; never transfer the project geometry array. */
function universeObservation(snapshot, expectedProjectIds) {
  const scope = snapshot?.spatial?.location?.kind;
  if (scope !== "universe")
    return {
      scope: typeof scope === "string" ? scope.slice(0, 24) : null,
      invalid: "not_universe",
    };
  if (
    !Array.isArray(expectedProjectIds) ||
    !expectedProjectIds.length ||
    expectedProjectIds.length > 10 ||
    expectedProjectIds.some(
      (id) => typeof id !== "string" || !id.length || id.length > 128,
    ) ||
    new Set(expectedProjectIds).size !== expectedProjectIds.length
  )
    return { scope, invalid: "invalid_canonical_project_ids" };
  const bodies = snapshot?.spatial?.renderer?.projectedBodies;
  if (!Array.isArray(bodies) || bodies.length > 10)
    return {
      scope,
      canonicalProjectCount: expectedProjectIds.length,
      invalid: "unbounded_or_missing_universe_bodies",
    };
  const expected = new Set(expectedProjectIds.map((id) => "project:" + id)),
    visible = new Set();
  let unexpectedBodies = 0,
    duplicateBodies = 0;
  for (const body of bodies) {
    if (!expected.has(body?.key)) unexpectedBodies++;
    else if (visible.has(body.key)) duplicateBodies++;
    else visible.add(body.key);
  }
  return {
    scope,
    canonicalProjectCount: expected.size,
    visibleProjectStars: visible.size,
    unexpectedBodies,
    duplicateBodies,
    allCanonicalStarsVisible:
      visible.size === expected.size && !unexpectedBodies && !duplicateBodies,
  };
}

function assertUniverseObservation(value, expectedCount, allVisible = false) {
  assert.equal(value.scope, "universe", "actual Universe scope required");
  assert.equal(value.invalid, undefined, "valid bounded Universe observation");
  assert.equal(
    value.canonicalProjectCount,
    expectedCount,
    "actual canonical project count",
  );
  assert.equal(
    value.unexpectedBodies,
    0,
    "only canonical project stars in this seeded Universe",
  );
  assert.equal(
    value.duplicateBodies,
    0,
    "each canonical star has one rendered body",
  );
  assert(
    Number.isInteger(value.visibleProjectStars) &&
      value.visibleProjectStars > 0 &&
      value.visibleProjectStars <= expectedCount,
  );
  if (allVisible)
    assert.equal(
      value.allCanonicalStarsVisible,
      true,
      "all canonical project stars framed together",
    );
}

function assertUniverseFrame(observation, expectedCount, allVisible = false) {
  assertUniverseObservation(observation.universe, expectedCount, allVisible);
  assertBodyCounters(observation.renderer, 160, expectedCount);
  assert.equal(
    observation.renderer.nodes,
    observation.universe.visibleProjectStars,
    "rendered body count matches canonical projected stars",
  );
  assert.equal(
    observation.renderer.nodes + observation.renderer.culled,
    expectedCount,
    "all canonical project stars remain allocated",
  );
}

function qualifyPerformanceCase(receipt) {
  const universe = receipt.universe;
  const progresses = (phase, initial, count) => {
    const frame = phase?.timing?.motionSamples?.initialGpuFrame;
    return (
      phase?.presentation?.qualified === true &&
      phase.samples?.length === count &&
      Number.isFinite(frame) &&
      phase.samples.some((sample) => sample.gpu?.framesRendered > frame) &&
      phase.samples.some(
        (sample) =>
          Math.abs(sample.camera?.yaw - initial?.yaw) > 0.001 ||
          Math.abs(sample.camera?.pitch - initial?.pitch) > 0.001,
      )
    );
  };
  if (
    !progresses(receipt, receipt.initialCamera, LIMITS.samples) ||
    universe?.state !== "completed" ||
    !progresses(
      universe,
      universe.initialObservation?.camera,
      LIMITS.universeSamples,
    )
  )
    return false;
  try {
    assert([1, 3, 10].includes(receipt.seed?.projectCount));
    assertUniverseFrame(
      universe.initialObservation,
      receipt.seed.projectCount,
      true,
    );
    assertUniverseFrame(
      universe.finalObservation,
      receipt.seed.projectCount,
      true,
    );
    for (const sample of universe.samples)
      assertUniverseFrame(sample, receipt.seed.projectCount);
    return true;
  } catch {
    return false;
  }
}

/** Start only from an admitted native slot after checking the pinned tool hash.
 * The returned child belongs to this run; separate phases never share a CSV. */
function startPresentationCapture(
  tool,
  gpuPid,
  out,
  phase,
  spawnChild = spawn,
  now = Date.now,
) {
  assert(["project", "universe"].includes(phase), "bounded presentation phase");
  assert(
    Number.isInteger(gpuPid) && gpuPid > 0,
    "actual target GPU PID required",
  );
  assert(
    path.isAbsolute(tool) && path.isAbsolute(out),
    "absolute presentation tool/output required",
  );
  const file = path.join(
    out,
    phase === "project" ? "presentation.csv" : "universe-presentation.csv",
  );
  const timing = {
    spawnRequestedAt: new Date(now()).toISOString(),
    requestedSeconds: 12,
    targetGpuPid: gpuPid,
    phase,
    spawnRequestedClock: hostClock(now),
  };
  const child = spawnChild(
    tool,
    [
      "--process_id",
      String(gpuPid),
      "--output_file",
      file,
      "--timed",
      "12",
      "--terminate_after_timed",
      "--no_console_stats",
      "--v1_metrics",
      "--session_name",
      "Aerynth-" + phase + "-" + process.pid + "-" + now(),
    ],
    { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  child.once("spawn", () => {
    timing.spawnedAt = new Date(now()).toISOString();
    timing.spawnedClock = hostClock(now);
  });
  const log = [];
  let logBytes = 0;
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (chunk) => {
      const take = chunk.subarray(0, Math.max(0, 65536 - logBytes));
      if (take.length) {
        log.push(take.toString());
        logBytes += take.length;
      }
    });
  const capture = { child, file, timing, result: undefined, done: undefined };
  capture.done = new Promise((resolve) => {
    const finish = (result) => {
      if (capture.result) return;
      capture.result = {
        ...result,
        log: log.join(""),
        endedAt: new Date(now()).toISOString(),
      };
      timing.endedAt = capture.result.endedAt;
      timing.endedClock = hostClock(now);
      resolve(capture.result);
    };
    child.once("error", (error) =>
      finish({ error: String(error.message).slice(0, 4096) }),
    );
    child.once("close", (code, signal) => finish({ code, signal }));
  });
  return capture;
}

/** Every awaited UI lookup is followed by a fresh deadline/operator/owner check
 * before input. The shared desktop driver does not accept that run guard. */
function benchmarkControls(win, js, guard, ownedPause, now = monotonicNow) {
  const read = async (code) => {
    guard();
    const value = await js(code);
    guard();
    return value;
  };
  const wait = async (expression, timeout = 20000) => {
    const end = now() + timeout;
    do {
      if (
        await read(`(()=>{try{return (${expression})}catch{return false}})()`)
      )
        return;
      await ownedPause(80);
    } while (now() < end);
    throw Error("Timed out " + expression);
  };
  const click = async (selector) => {
    const end = now() + 2000;
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
    } while (now() < end);
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

function assertSpatialRecovery(before, after, canonicalBound) {
  for (const [phase, observation] of [
    ["before loss", before],
    ["after recovery", after],
  ]) {
    assert.equal(observation.quality, "cinematic", phase + " quality");
    assertBodyCounters(observation.renderer, 280, canonicalBound);
    assert(
      observation.gpu.spatialLayer.active === true &&
        observation.gpu.spatialLayer.failed === false,
      phase + " healthy spatial layer",
    );
    assert(
      Number.isInteger(observation.gpu.framesRendered) &&
        observation.gpu.framesRendered > 0,
      phase + " requires an actual GPU frame in its Environment epoch",
    );
  }
  const camera = before.camera;
  for (const value of [
    camera?.target?.x,
    camera?.target?.y,
    camera?.target?.z,
    camera?.distance,
    camera?.yaw,
    camera?.pitch,
  ])
    assert(Number.isFinite(value), "actual pre-loss camera required");
  assert(camera.distance > 0, "actual pre-loss camera distance");
  assert.deepEqual(after.camera, camera, "recovery preserves the camera pose");
  assert(before.renderer.nodes > 0, "visible bodies before context loss");
  assert.equal(
    after.renderer.nodes + after.renderer.culled,
    before.renderer.nodes + before.renderer.culled,
    "recovery preserves canonical body candidates",
  );
  assert.equal(
    after.renderer.nodes,
    before.renderer.nodes,
    "recovery preserves visible bodies at the unchanged view",
  );
  if (before.renderer.instancedBodies > 0)
    assert(
      after.renderer.instancedBodies > 0,
      "visible instance batch survives context recovery",
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
exports.nativeRecenter = nativeRecenter;
exports.universeObservation = universeObservation;
exports.assertUniverseObservation = assertUniverseObservation;
exports.assertUniverseFrame = assertUniverseFrame;
exports.qualifyPerformanceCase = qualifyPerformanceCase;
exports.startPresentationCapture = startPresentationCapture;
exports.benchmarkControls = benchmarkControls;
exports.assertBodyCounters = assertBodyCounters;
exports.assertSpatialRecovery = assertSpatialRecovery;
exports.intervalDistribution = intervalDistribution;
exports.presentationTailStatistics = presentationTailStatistics;
exports.callbackWindowStatistics = callbackWindowStatistics;
exports.hostClock = hostClock;
exports.nativeMarker = nativeMarker;
exports.browserTimingState = browserTimingState;
exports.collectPresentationTail = collectPresentationTail;

exports.verify = async ({
  win,
  app,
  call,
  source,
  privateRoot,
  moduleStarted,
  moduleStartedMonotonicMs,
  startupErrors,
}) => {
  const base = path.resolve(__dirname, "../.runtime/application-evidence");
  await fs.mkdir(base, { recursive: true });
  const out = await fs.mkdtemp(
    path.join(base, "spatial-scale-" + Date.now() + "-"),
  );
  const helperStarted = Date.now();
  const helperStartedMonotonicMs = monotonicNow();
  const receipt = {
    contract: "aerynth.spatial-scale@3",
    diagnosticsVersion: 1,
    source,
    syntheticData: true,
    passed: false,
    state: "preflight",
    host: "Actual Aerynth desktop, canonical SQLite corpus and shared V3.5 GPU context",
    requiredSeparateRuns: REQUIRED_MATRIX,
    matrixComplete: false,
    limits: LIMITS,
    timing: {
      helperStartedAt: new Date(helperStarted).toISOString(),
      helperStartedMonotonicMs,
    },
    captures: [],
    consoleDiagnostics: null,
    rendererErrorScope:
      "Window error events and caught graphics construction/recovery exceptions; console-message errors are recorded separately.",
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
      "Project and Universe use separate OS presentation windows; their samples are never merged.",
      "Universe body counts identify actual canonical stars, not the total stored resource count.",
      "No-input tail observations and phase markers add bounded measurement overhead; they do not establish a cause for presentation gaps.",
      "Post-capture callback statistics cover reset before tool launch through a read after capture closure, a wider window than ETW. UTC/host monotonic clocks are not exact ETW/QPC alignment.",
      "UTC timestamps and deadlineAt are wall-clock evidence and may reverse; only the explicit host monotonic start drives expiry and elapsed durations.",
    ],
  };
  let present,
    presentFile,
    budget,
    abort,
    ownerContents,
    consoleMonitor,
    progressBytes = 0;
  const presentationChildren = new Set();
  const beforeInput = (_event, input) => {
    if (input.type === "keyDown" && input.key === "Escape")
      abort = new Error("native_spatial_operator_escape");
  };
  function guard(ownership = true) {
    if (abort) throw abort;
    if (budget && monotonicNow() >= budget.expiresAtMonotonicMs)
      throw Error("native_spatial_deadline");
    if (ownership) assertNativeOwner(win);
  }
  function markPhase(target, label) {
    guard();
    const markers = (target.timing.diagnosticMarkers ??= []);
    assert(markers.length < LIMITS.markersPerPhase, "phase marker bound");
    assert(label.length <= 64, "phase marker label bound");
    const marker = nativeMarker(win, label);
    markers.push(marker);
    guard();
    return marker;
  }
  async function ownedPause(ms, ownership = true) {
    const end = monotonicNow() + ms;
    do {
      guard(ownership);
      const remaining = budget
        ? budget.expiresAtMonotonicMs - monotonicNow()
        : Infinity;
      if (remaining <= 0) guard(ownership);
      await pause(Math.min(50, Math.max(1, end - monotonicNow()), remaining));
      if (present)
        try {
          assert(
            (await fs.stat(presentFile)).size <= LIMITS.csvBytes,
            "presentation CSV byte bound",
          );
        } catch (error) {
          if (error.code !== "ENOENT") {
            if (present.exitCode === null) present.kill();
            throw error;
          }
        }
    } while (monotonicNow() < end);
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
    receipt.consoleDiagnostics = consoleMonitor?.snapshot() ?? null;
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
  async function capture(name, failureOnly = false) {
    guard();
    const health = async () => {
      if (!failureOnly) consoleMonitor.assertClean();
      guard();
      const observed = await win.webContents.executeJavaScript(
        "(" + frameCaptureHealth.toString() + ")()",
        true,
      );
      guard();
      assertFrameCaptureHealth(observed, failureOnly);
    };
    await health();
    const target = name.startsWith("universe") ? receipt.universe : receipt;
    markPhase(target, "png-" + name + "-start");
    assert(
      receipt.captures.length < LIMITS.screenshots,
      "screenshot count bound",
    );
    const bytes = (await win.webContents.capturePage()).toPNG();
    guard();
    await health();
    assert(bytes.length <= LIMITS.pngBytes, "screenshot byte bound");
    await fs.writeFile(path.join(out, name + ".png"), bytes, { flag: "wx" });
    receipt.captures.push({
      file: name + ".png",
      purpose: failureOnly ? "failure-diagnostic" : "verification",
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      at: new Date().toISOString(),
    });
    markPhase(target, "png-" + name + "-end");
  }
  try {
    budget = verificationDeadline(
      process.argv,
      moduleStarted,
      moduleStartedMonotonicMs,
    );
    receipt.timing.moduleStartedAt = new Date(moduleStarted).toISOString();
    receipt.timing.deadlineAt = new Date(
      moduleStarted + budget.durationMs,
    ).toISOString();
    receipt.timing.deadlineAtMonotonicMs = budget.expiresAtMonotonicMs;
    receipt.timing.clock = budget.clock;
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
    consoleMonitor = createNativeConsoleMonitor(ownerContents, startupErrors);
    consoleMonitor.assertClean();
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
        Math.max(1, Math.min(ms, budget.expiresAtMonotonicMs - monotonicNow())),
      );
      guard();
    };
    await waitOwned('document.body.dataset.applicationHydrated === "true"');
    const observe = () =>
      read(
        "(" + spatialObservation.toString() + ")(window.__aerynth.snapshot())",
      );
    receipt.startupToInteractiveMs = monotonicNow() - moduleStartedMonotonicMs;
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
    receipt.viewport = await read(
      "({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})",
    );
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
    if (tool) {
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
    }
    let captureCount = 0;
    const running = (child) =>
      child?.pid && child.exitCode === null && child.signalCode === null;
    const launchPresentation = (target, phase, currentGpu) => {
      guard();
      markPhase(target, "capture-launch-start");
      assert(
        !present || !running(present),
        "previous owned presentation capture must finish before the next phase",
      );
      if (!tool || !currentGpu) {
        markPhase(target, "capture-unavailable");
        return null;
      }
      assert(
        captureCount++ < LIMITS.presentationCaptures,
        "presentation capture count bound",
      );
      const started = startPresentationCapture(
        tool,
        currentGpu.pid,
        out,
        phase,
      );
      present = started.child;
      presentFile = started.file;
      presentationChildren.add(started.child);
      target.timing.presentMon = started.timing;
      target.timing.presentMon.file = path.basename(started.file);
      markPhase(target, "capture-launch-end");
      return started;
    };
    const tailObservation = async (observePhase) => {
      const observation = await observePhase();
      const browser = await read("(" + browserTimingState.toString() + ")()");
      assert(
        browser.visibilityState === "visible" &&
          !browser.hidden &&
          browser.focused,
        "tail observation lost document visibility/focus",
      );
      return { ...observation, browser };
    };
    const finishPresentation = async (target, started, observePhase) => {
      if (!started) {
        target.presentation = {
          qualified: false,
          reason: "PresentMon_or_target_GPU_PID_unavailable",
        };
        return;
      }
      markPhase(target, "capture-wait-start");
      const end = Math.min(budget.expiresAtMonotonicMs, monotonicNow() + 16000);
      target.measurementTail = await collectPresentationTail({
        closed: () => !!started.result,
        observe: () => tailObservation(observePhase),
        ownedPause,
        guard,
        mark: (label) => markPhase(target, label),
        record: (sample, index) =>
          progress({
            phase: target === receipt ? "project-tail" : "universe-tail",
            index,
            sample,
          }),
        deadlineAt: end,
      });
      markPhase(target, "capture-wait-end");
      const result = started.result ?? {
        error: "presentation_capture_timeout",
        endedAt: new Date().toISOString(),
      };
      target.presentMon = result;
      target.timing.presentMon.observationCompletedAt =
        new Date().toISOString();
      if (result.error && running(started.child)) {
        started.child.kill();
        const drain = Math.min(
          budget.expiresAtMonotonicMs,
          monotonicNow() + 2000,
        );
        while (running(started.child) && monotonicNow() < drain)
          await ownedPause(50);
        assert(
          !running(started.child),
          "owned presentation process did not stop",
        );
      }
      markPhase(target, "capture-close-observed");
      const callbackReadStart = markPhase(
        target,
        "post-capture-callback-read-start",
      );
      const fullMetrics = await read("window.__aerynth.snapshot().metrics");
      const callbackReadEnd = markPhase(
        target,
        "post-capture-callback-read-end",
      );
      target.fullCaptureCallbacks = {
        meaning:
          "Reset before tool launch through post-closure read, including the original loop and no-input tail/measurement overhead; not an exactly aligned ETW window.",
        resetRequestedAt: target.timing.callbackWindow.resetRequestedAt,
        requested: callbackReadStart,
        completed: callbackReadEnd,
        captureClosedBeforeRead: !!started.result,
        ...callbackWindowStatistics(fullMetrics),
      };
      try {
        assert(
          !result.error && result.code === 0 && !result.signal,
          "presentation process did not finish successfully",
        );
        assert(
          (await fs.stat(started.file)).size <= LIMITS.csvBytes,
          "presentation CSV byte bound",
        );
        const csv = await fs.readFile(started.file);
        assert(
          csv.length <= LIMITS.csvBytes,
          "presentation CSV read byte bound",
        );
        target.timing.presentMon.csvBytes = csv.length;
        target.timing.presentMon.csvSha256 = createHash("sha256")
          .update(csv)
          .digest("hex");
        target.presentation = summarizePresentMon(
          csv.toString("utf8"),
          started.timing.targetGpuPid,
        );
        target.presentation.tails = presentationTailStatistics(
          csv.toString("utf8"),
          started.timing.targetGpuPid,
        );
      } catch (error) {
        target.presentation = { qualified: false, reason: error.message };
      }
      if (present === started.child && !running(started.child)) {
        present = undefined;
        presentFile = undefined;
      }
    };
    markPhase(receipt, "sample-callback-reset-start");
    receipt.timing.callbackWindow = {
      resetRequestedAt: new Date().toISOString(),
    };
    await read("window.__aerynth.resetMetrics()");
    markPhase(receipt, "sample-callback-reset-end");
    const projectCapture = launchPresentation(receipt, "project", gpu);
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
        moduleElapsedMs: monotonicNow() - moduleStartedMonotonicMs,
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
    markPhase(receipt, "input-sample-loop-end");
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
    markPhase(receipt, "sample-callback-read-start");
    const metrics = await read("window.__aerynth.snapshot().metrics");
    receipt.timing.callbackWindow.readCompletedAt = new Date().toISOString();
    markPhase(receipt, "sample-callback-read-end");
    receipt.callbackMetrics = {
      callbacks: metrics.callbacks,
      draws: metrics.draws,
      policy: String(metrics.policy).slice(0, 160),
    };
    receipt.observedRendererErrors = Array.isArray(metrics.errors)
      ? metrics.errors.slice(-16).map((error) => String(error).slice(0, 1024))
      : null;
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
    markPhase(receipt, "memory-read-start");
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
    markPhase(receipt, "memory-read-end");
    receipt.state = "sampled";
    markPhase(receipt, "sample-checkpoint-start");
    await checkpoint();
    markPhase(receipt, "sample-checkpoint-end");
    await finishPresentation(receipt, projectCapture, observe);
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
      const observeRecovery = async () => {
        const requested = hostClock();
        const observation = await observe();
        return { requested, completed: hostClock(), observation };
      };
      const recovery = (receipt.contextRecovery = {
        detailedBodyCap: 280,
        canonicalBodyBound: canonicalBound,
        frameCounterMeaning:
          "The host creates a new Environment on WebGL restoration, resetting framesRendered to zero. A positive recovered counter proves a fresh frame; counters from different epochs are not compared.",
        before: await observeRecovery(),
        after: null,
        passed: false,
      });
      await read("window.__aerynth.simulateContextLoss()");
      await waitOwned("window.__aerynth.snapshot().graphicsFailed");
      await read("window.__aerynth.restoreContext()");
      await waitOwned(
        "!window.__aerynth.snapshot().graphicsFailed&&window.__aerynth.snapshot().gpu.spatialLayer.active&&!window.__aerynth.snapshot().gpu.spatialLayer.failed",
      );
      await waitOwned(
        "!window.__aerynth.snapshot().graphicsFailed&&window.__aerynth.snapshot().gpu.framesRendered>0",
      );
      recovery.after = await observeRecovery();
      assertSpatialRecovery(
        recovery.before.observation,
        recovery.after.observation,
        canonicalBound,
      );
      recovery.passed = true;
      receipt.regressions.push(
        "real-WebGL-recovery-restores-combined-spatial-layer",
      );
      receipt.regressions.push(
        "real-WebGL-recovery-preserves-cinematic-body-counters",
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
    receipt.universe = {
      state: "navigating",
      timing: { navigationRequestedAt: new Date().toISOString() },
      samples: [],
      canonicalProjectCount: seed.projectCount,
    };
    const universe = receipt.universe;
    markPhase(universe, "navigation-start");
    receipt.state = "universe-navigating";
    await progress({ phase: receipt.state });
    await checkpoint();
    // Optional project regressions leave different policy settings. Measure the
    // second scope in the same standard policy through the real controls.
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
    await click('.aw-quiet-control[aria-label="Commands and destinations"]');
    await fill(".aw-destinations input", "Universe");
    await click('.aw-command-row[data-command="universe"]');
    await waitOwned(
      "window.__aerynth.snapshot().spatial.location.kind==='universe'",
    );
    await nativeRecenter(win, js, guard);
    await waitOwned(
      "JSON.stringify(window.__aerynth.snapshot().spatial.camera)===JSON.stringify(window.__aerynth.snapshot().spatial.bookmark)",
    );
    const canonicalProjectIds = await read(
      "window.__aerynth.application().projects.map(p=>p.id)",
    );
    assert.equal(canonicalProjectIds.length, seed.projectCount);
    assert.equal(new Set(canonicalProjectIds).size, seed.projectCount);
    assert(
      canonicalProjectIds.every(
        (id) => typeof id === "string" && id.length && id.length <= 128,
      ),
    );
    universe.canonicalProjectIdentitySha256 = createHash("sha256")
      .update(JSON.stringify([...canonicalProjectIds].sort()))
      .digest("hex");
    const observeUniverse = () =>
      read(
        "(()=>{const s=window.__aerynth.snapshot();return {...(" +
          spatialObservation.toString() +
          ")(s),universe:(" +
          universeObservation.toString() +
          ")(s," +
          JSON.stringify(canonicalProjectIds) +
          ")}})()",
      );
    const universeInitial = await observeUniverse();
    universe.initialObservation = universeInitial;
    assertUniverseFrame(universeInitial, seed.projectCount, true);
    universe.viewport = await read(
      "({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})",
    );
    universe.timing.navigationCompletedAt = new Date().toISOString();
    markPhase(universe, "navigation-end");
    await capture("universe-before");
    const universeGpu = app.getAppMetrics().find((p) => p.type === "GPU");
    markPhase(universe, "sample-callback-reset-start");
    universe.timing.callbackWindow = {
      resetRequestedAt: new Date().toISOString(),
    };
    await read("window.__aerynth.resetMetrics()");
    markPhase(universe, "sample-callback-reset-end");
    const universeCapture = launchPresentation(
      universe,
      "universe",
      universeGpu,
    );
    const universeStart = await observeUniverse();
    assert(
      Number.isFinite(universeStart.gpu.framesRendered),
      "real Universe GPU frame counter required",
    );
    universe.state = "sampling";
    receipt.state = "universe-sampling";
    universe.timing.motionSamples = {
      startedAt: new Date().toISOString(),
      targetPauseMs: LIMITS.samplePauseMs,
      initialGpuFrame: universeStart.gpu.framesRendered,
    };
    await checkpoint();
    for (let i = 0; i < LIMITS.universeSamples; i++) {
      await nativeOrbit(win, js, ["Up", "Right", "Down", "Left"][i % 4], guard);
      await ownedPause(LIMITS.samplePauseMs);
      const observation = await observeUniverse();
      assertUniverseFrame(observation, seed.projectCount);
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
        moduleElapsedMs: monotonicNow() - moduleStartedMonotonicMs,
        ...observation,
        focused: win.isFocused(),
        minimized: win.isMinimized(),
      };
      universe.samples.push(sample);
      await progress({ phase: "universe-sample", index: i, sample });
      if ((i + 1) % 10 === 0) await checkpoint();
    }
    universe.timing.motionSamples.endedAt = new Date().toISOString();
    universe.timing.motionSamples.count = universe.samples.length;
    markPhase(universe, "input-sample-loop-end");
    assert(
      universe.samples.some(
        (sample) =>
          sample.gpu.framesRendered > universeStart.gpu.framesRendered,
      ),
      "actual GPU draws must advance during Universe input",
    );
    assert(
      universe.samples.some(
        (sample) =>
          Math.abs(sample.camera.yaw - universeInitial.camera.yaw) > 0.001 ||
          Math.abs(sample.camera.pitch - universeInitial.camera.pitch) > 0.001,
      ),
      "actual native input must move the Universe camera",
    );
    universe.foregroundThroughoutSamples = universe.samples.every(
      (sample) => sample.focused && !sample.minimized,
    );
    markPhase(universe, "sample-callback-read-start");
    const universeMetrics = await read("window.__aerynth.snapshot().metrics");
    universe.timing.callbackWindow.readCompletedAt = new Date().toISOString();
    markPhase(universe, "sample-callback-read-end");
    universe.callbackMetrics = {
      callbacks: universeMetrics.callbacks,
      draws: universeMetrics.draws,
      policy: String(universeMetrics.policy).slice(0, 160),
    };
    universe.observedRendererErrors = Array.isArray(universeMetrics.errors)
      ? universeMetrics.errors
          .slice(-16)
          .map((error) => String(error).slice(0, 1024))
      : null;
    universe.callbackIntervalsMs = percentiles(universeMetrics.intervals);
    universe.drawIntervalsMs = percentiles(universeMetrics.drawIntervals);
    universe.spatialCpuSubmissionMs = percentiles(
      universe.samples
        .filter(
          (sample, i) =>
            i === 0 ||
            sample.gpu.framesRendered !==
              universe.samples[i - 1].gpu.framesRendered,
        )
        .map((sample) => sample.renderer.cpuSubmitMs),
    );
    universe.visibleProjectStars = {
      min: Math.min(
        ...universe.samples.map(
          (sample) => sample.universe.visibleProjectStars,
        ),
      ),
      max: Math.max(
        ...universe.samples.map(
          (sample) => sample.universe.visibleProjectStars,
        ),
      ),
    };
    universe.state = "sampled";
    markPhase(universe, "sample-checkpoint-start");
    await checkpoint();
    markPhase(universe, "sample-checkpoint-end");
    await finishPresentation(universe, universeCapture, observeUniverse);
    markPhase(universe, "post-capture-recenter-start");
    await nativeRecenter(win, js, guard);
    await waitOwned(
      "JSON.stringify(window.__aerynth.snapshot().spatial.camera)===JSON.stringify(window.__aerynth.snapshot().spatial.bookmark)",
    );
    markPhase(universe, "post-capture-recenter-end");
    universe.finalObservation = await observeUniverse();
    assertUniverseFrame(universe.finalObservation, seed.projectCount, true);
    assert.deepEqual(
      (
        await read("window.__aerynth.application().projects.map(p=>p.id)")
      ).sort(),
      [...canonicalProjectIds].sort(),
      "canonical project identities remain unchanged across Universe sampling",
    );
    markPhase(universe, "memory-read-start");
    const universeMemory = app.getAppMetrics();
    universe.memory = {
      requestedAt: new Date().toISOString(),
      rendererKiB: scalarMemory(
        universeMemory.find((p) => p.pid === win.webContents.getOSProcessId())
          ?.memory,
      ),
      gpuKiB: scalarMemory(
        universeMemory.find((p) => p.type === "GPU")?.memory,
      ),
      backendBytes: scalarMemory(await call("metrics", {})),
    };
    universe.memory.completedAt = new Date().toISOString();
    markPhase(universe, "memory-read-end");
    await capture("universe-after");
    universe.state =
      universe.presentation?.qualified === true ? "completed" : "partial";
    universe.timing.finishedAt = new Date().toISOString();
    for (const phase of [receipt, universe]) {
      assert.deepEqual(
        phase.observedRendererErrors,
        [],
        "recorded window/runtime sample errors fail the case",
      );
      if (phase.fullCaptureCallbacks)
        assert.deepEqual(
          phase.fullCaptureCallbacks.observedRendererErrors,
          [],
          "recorded window/runtime capture errors fail the case",
        );
    }
    consoleMonitor.assertClean();
    receipt.passed = qualifyPerformanceCase(receipt);
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
        await capture("failure", true);
      } catch (captureError) {
        receipt.failureCaptureError = String(captureError.message).slice(
          0,
          1024,
        );
      }
  } finally {
    try {
      try {
        ownerContents?.removeListener("before-input-event", beforeInput);
      } catch (error) {
        receipt.listenerCleanupError = String(error.message).slice(0, 1024);
      }
      try {
        for (const child of presentationChildren)
          if (child.pid && child.exitCode === null && child.signalCode === null)
            child.kill();
      } catch (error) {
        receipt.presentationCleanupError = String(error.message).slice(0, 1024);
      }
      if (consoleMonitor) {
        try {
          consoleMonitor.dispose();
          consoleMonitor.assertClean();
        } catch (error) {
          receipt.passed = false;
          receipt.state = "failed";
          receipt.consoleMonitoringError = String(error.message).slice(0, 1024);
          receipt.error ??= receipt.consoleMonitoringError;
        }
      }
      receipt.timing.finishedAt = new Date().toISOString();
      receipt.timing.finishedMonotonicMs = monotonicNow();
      receipt.helperElapsedMs =
        receipt.timing.finishedMonotonicMs - helperStartedMonotonicMs;
      if (budget)
        receipt.timing.endClockDiscontinuityMs =
          Date.parse(receipt.timing.finishedAt) -
          moduleStarted -
          (receipt.timing.finishedMonotonicMs - moduleStartedMonotonicMs);
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
          universePresentation: receipt.universe?.presentation,
          universeProjectStars:
            receipt.universe?.finalObservation?.universe.visibleProjectStars,
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
