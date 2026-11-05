const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const vm = require("node:vm");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createJourneyEvidence } = require("./integrated-native.cjs");
const {
  CONSOLE_LIMITS,
  createNativeConsoleMonitor,
  frameCaptureHealth,
  assertFrameCaptureHealth,
} = require("./native-console.cjs");

test("Electron FIRST-details error events preserve source and line; non-errors do not fail the run", () => {
  const contents = new EventEmitter();
  const at = 1793610000000;
  const monitor = createNativeConsoleMonitor(contents, [], () => at);
  try {
    assert.equal(contents.listeners("console-message")[0].length, 1);
    for (const level of ["info", "warning", "debug"])
      contents.emit("console-message", { level, message: "diagnostic" });
    monitor.assertClean();
    contents.emit("console-message", {
      level: "error",
      message: "verification script failed",
      sourceId: "local-verifier.js",
      lineNumber: 17,
      get privatePayload() {
        assert.fail("must not inspect unrelated event fields");
      },
    });
    const state = monitor.snapshot();
    assert.equal(state.runtime.ignoredNonErrors, 3);
    assert.equal(state.runtime.observedErrors, 1);
    assert.deepEqual(state.runtime.errors, [
      {
        event: "console-message",
        level: "error",
        message: "verification script failed",
        source: "local-verifier.js",
        line: 17,
        at: new Date(at).toISOString(),
      },
    ]);
    assert.throws(() => monitor.assertClean(), /runtime console errors/);
  } finally {
    monitor.dispose();
  }
});

test("the live host buffer covers startup and later errors without summing overlapping buffers", () => {
  const contents = new EventEmitter(),
    startupErrors = [];
  const monitor = createNativeConsoleMonitor(contents, startupErrors);
  try {
    monitor.assertClean();
    const error = {
      message: "late host observation",
      line: 9,
      source: "local-startup.js",
    };
    startupErrors.push(error);
    contents.emit("console-message", {
      level: "error",
      message: error.message,
      lineNumber: 9,
      sourceId: error.source,
    });
    const state = monitor.snapshot();
    assert.equal(state.startupProvidedRecords, 1);
    assert.equal(state.startupErrors[0].source, error.source);
    assert.equal(state.startupErrors[0].line, 9);
    assert.equal(state.startupErrors[0].at, null);
    assert.equal(state.runtime.observedErrors, 1);
    assert.match(state.scope, /not additive counts/);
    assert.throws(() => monitor.assertClean(), /host recorded/);
  } finally {
    monitor.dispose();
  }
});

test("unobserved startup and legacy console signatures cannot silently pass as clean", () => {
  for (const startup of [undefined, null, {}]) {
    const contents = new EventEmitter();
    const monitor = createNativeConsoleMonitor(contents, startup);
    try {
      assert.equal(monitor.snapshot().startupErrors, null);
      assert.throws(
        () => monitor.assertClean(),
        /startup console errors are unobserved/,
      );
    } finally {
      monitor.dispose();
    }
  }
  const contents = new EventEmitter();
  const monitor = createNativeConsoleMonitor(contents, []);
  try {
    contents.emit("console-message", {}, 3, "legacy error", 10, "legacy.js");
    assert.equal(monitor.snapshot().runtime.malformedEvents, 1);
    assert.throws(
      () => monitor.assertClean(),
      /signature\/record is unrecognized/,
    );
  } finally {
    monitor.dispose();
  }
});

test("malformed host and runtime records fail monitoring without throwing into Electron", () => {
  const contents = new EventEmitter();
  const startupErrors = [
    null,
    { message: 42 },
    { message: "warning", level: "warning" },
  ];
  const monitor = createNativeConsoleMonitor(contents, startupErrors);
  try {
    assert.equal(monitor.snapshot().malformedStartupRecords, 3);
    assert.doesNotThrow(() =>
      contents.emit("console-message", {
        get level() {
          throw Error("unreadable details");
        },
      }),
    );
    assert.equal(monitor.snapshot().runtime.malformedEvents, 1);
    assert.throws(() => monitor.assertClean(), /unrecognized/);
  } finally {
    monitor.dispose();
  }
});

test("error records stay within 32 by 2 KiB even with Unicode and JSON control escaping", () => {
  const contents = new EventEmitter();
  const startupErrors = Array.from({ length: 40 }, (_, i) => ({
    message: "host " + i,
  }));
  const monitor = createNativeConsoleMonitor(contents, startupErrors);
  try {
    for (let i = 0; i < 40; i++)
      contents.emit("console-message", {
        level: "error",
        message: (i % 2 ? "🪐" : '\u0000\n\t"\\').repeat(5000),
        sourceId: "\u0000".repeat(1000),
        lineNumber: i,
      });
    const state = monitor.snapshot();
    assert.equal(state.runtime.errors.length, CONSOLE_LIMITS.records);
    assert.equal(state.runtime.observedErrors, 40);
    assert.equal(state.runtime.discardedErrorRecords, 8);
    assert.equal(state.startupErrors.length, CONSOLE_LIMITS.records);
    assert.equal(state.startupErrors[0].message, "host 8");
    assert.equal(state.startupAtCapacity, true);
    for (const row of [...state.runtime.errors, ...state.startupErrors]) {
      assert(
        Buffer.byteLength(JSON.stringify(row)) <= CONSOLE_LIMITS.recordBytes,
      );
      assert(
        !row.message.includes("\uFFFD"),
        "valid Unicode must not be split",
      );
    }
    state.runtime.errors[0].message = "mutated snapshot";
    state.startupErrors[0].message = "mutated snapshot";
    assert.notEqual(
      monitor.snapshot().runtime.errors[0].message,
      "mutated snapshot",
    );
    assert.equal(startupErrors[8].message, "host 8");
  } finally {
    monitor.dispose();
  }
});

test("finally disposes only the owned console listener, preserving finalizer errors", () => {
  const contents = new EventEmitter();
  let otherCalls = 0,
    time = 1000;
  const other = () => otherCalls++;
  contents.on("console-message", other);
  const monitor = createNativeConsoleMonitor(contents, [], () => time);
  try {
    monitor.assertClean();
    // Represents an error emitted during owned recorder/child cleanup.
    contents.emit("console-message", {
      level: "error",
      message: "cleanup failed",
    });
  } finally {
    time = 2000;
    monitor.dispose();
  }
  assert.throws(() => monitor.assertClean(), /runtime console errors/);
  assert.equal(
    monitor.snapshot().runtime.disposedAt,
    new Date(2000).toISOString(),
  );
  monitor.dispose();
  assert.deepEqual(contents.listeners("console-message"), [other]);
  contents.emit("console-message", {
    level: "error",
    message: "outside helper scope",
  });
  assert.equal(otherCalls, 2);
  assert.equal(monitor.snapshot().runtime.observedErrors, 1);
});

test("the standalone renderer health read distinguishes unavailable observations from zero", () => {
  const read = (state) =>
    vm.runInNewContext("(" + frameCaptureHealth.toString() + ")()", {
      window: { __aerynth: { snapshot: () => state } },
    });
  const valid = read({
    graphicsFailed: false,
    gpu: { framesRendered: 5 },
    metrics: { errors: [] },
  });
  assert.equal(valid.graphicsFailed, false);
  assert.equal(valid.gpuFrames, 5);
  assert.equal(valid.windowErrorCount, 0);
  const unknown = read({});
  assert.equal(unknown.graphicsFailed, null);
  assert.equal(unknown.gpuFrames, null);
  assert.equal(unknown.windowErrorCount, null);
});

test("journey checkpoints retain the latest bounded console errors before finalization", async () => {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), "constellation-console-unit-"),
  );
  const contents = new EventEmitter();
  const monitor = createNativeConsoleMonitor(contents, []);
  try {
    const receipt = { passed: false, actions: [], steps: [] };
    const evidence = createJourneyEvidence(dir, receipt, () => {
      receipt.consoleDiagnostics = monitor.snapshot();
    });
    await evidence.checkpoint();
    contents.emit("console-message", {
      level: "error",
      message: "intermediate failure",
      sourceId: "unit-fixture.js",
      lineNumber: 4,
    });
    await evidence.record({ phase: "unit-only diagnostic" });
    const saved = JSON.parse(
      await fs.readFile(path.join(dir, "expanded.json"), "utf8"),
    );
    assert.equal(saved.passed, false);
    assert.equal(
      saved.consoleDiagnostics.runtime.errors[0].message,
      "intermediate failure",
    );
    assert.equal(saved.consoleDiagnostics.runtime.disposedAt, null);
  } finally {
    monitor.dispose();
    // Only this unit-test mkdtemp directory, never a native evidence/profile path.
    assert.equal(
      path.dirname(await fs.realpath(dir)),
      await fs.realpath(os.tmpdir()),
    );
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("failure-only capture can show errors, while passing capture requires healthy graphics and an error-free window", () => {
  const healthy = { graphicsFailed: false, gpuFrames: 10, windowErrorCount: 0 };
  assert.doesNotThrow(() => assertFrameCaptureHealth(healthy));
  for (const count of [2, null]) {
    const failed = { ...healthy, windowErrorCount: count };
    assert.throws(
      () => assertFrameCaptureHealth(failed),
      /window\/runtime errors/,
    );
    assert.doesNotThrow(() => assertFrameCaptureHealth(failed, true));
  }
  for (const failureOnly of [false, true]) {
    for (const graphicsFailed of [true, null])
      assert.throws(
        () =>
          assertFrameCaptureHealth({ ...healthy, graphicsFailed }, failureOnly),
        /available graphics/,
      );
    for (const gpuFrames of [0, null, NaN])
      assert.throws(
        () => assertFrameCaptureHealth({ ...healthy, gpuFrames }, failureOnly),
        /observed GPU draws/,
      );
  }
});
