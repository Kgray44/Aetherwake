const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  JOURNEY_LIMITS,
  journeyDeadline,
  createJourneyGuard,
  createJourneyEvidence,
  verify,
} = require("./integrated-native.cjs");

function owner() {
  let time = 1000;
  const state = {
    focused: true,
    visible: true,
    minimized: false,
    destroyed: false,
    contentsDestroyed: false,
  };
  const inputs = [],
    queries = [];
  let execute = async () => "actual stub result";
  const win = {
    isDestroyed: () => state.destroyed,
    isVisible: () => state.visible,
    isMinimized: () => state.minimized,
    isFocused: () => state.focused,
    show: () => assert.fail("must not show/reclaim window"),
    focus: () => assert.fail("must not reclaim OS focus"),
    webContents: {
      isDestroyed: () => state.contentsDestroyed,
      executeJavaScript: async (...args) => {
        queries.push(args);
        return execute(...args);
      },
      sendInputEvent: (event) => inputs.push(event),
    },
  };
  const run = createJourneyGuard(
    win,
    2000,
    () => time,
    async (ms) => {
      time += ms;
    },
  );
  return {
    run,
    state,
    inputs,
    queries,
    setTime: (value) => {
      time = value;
    },
    execute: (fn) => {
      execute = fn;
    },
  };
}

test("journey admits exactly the existing host's absolute deadline, without resetting its startup clock", () => {
  const started = 1000000,
    startedMonotonic = 100;
  const budget = journeyDeadline(
    ["--verification-deadline-ms=90000"],
    new Date(started).toISOString(),
    startedMonotonic,
    startedMonotonic + 3000,
    started + 3000,
  );
  assert.equal(budget.expiresAtMonotonicMs, startedMonotonic + 90000);
  assert.equal(budget.clock.moduleStartedWallMs, started);
  assert.equal(budget.clock.startupElapsedMs, 3000);
  for (const args of [
    [],
    ["--verification-deadline-ms=0"],
    ["--verification-deadline-ms=180001"],
    ["--verification-deadline-ms=1000", "--verification-deadline-ms=90000"],
  ])
    assert.throws(() =>
      journeyDeadline(
        args,
        new Date(started).toISOString(),
        startedMonotonic,
        startedMonotonic + 3000,
        started + 3000,
      ),
    );
  assert.throws(() =>
    journeyDeadline(
      ["--verification-deadline-ms=90000"],
      "invalid",
      startedMonotonic,
      startedMonotonic + 3000,
      started + 3000,
    ),
  );
  assert.throws(
    () =>
      journeyDeadline(
        ["--verification-deadline-ms=90000"],
        new Date(started).toISOString(),
        undefined,
        startedMonotonic + 3000,
        started + 3000,
      ),
    /actual host monotonic start/,
  );
});

test("the actual driver's owner adapter fences every native input and renderer lookup at focus/deadline boundaries", async () => {
  const a = owner(),
    event = { type: "keyDown", keyCode: "Right" };
  a.run.owner.webContents.sendInputEvent(event);
  assert.equal(
    await a.run.owner.webContents.executeJavaScript("fixture"),
    "actual stub result",
  );
  assert.deepEqual(a.inputs, [event]);
  for (const [key, value] of [
    ["focused", false],
    ["visible", false],
    ["minimized", true],
    ["destroyed", true],
    ["contentsDestroyed", true],
  ]) {
    const b = owner();
    b.state[key] = value;
    assert.throws(() => b.run.owner.webContents.sendInputEvent(event));
    await assert.rejects(b.run.owner.webContents.executeJavaScript("fixture"));
    assert.equal(b.inputs.length, 0);
    assert.equal(b.queries.length, 0);
  }
  const c = owner();
  c.setTime(2000);
  assert.throws(() => c.run.input(event), /deadline/);
  await assert.rejects(c.run.js("fixture"), /deadline/);
  assert.equal(c.inputs.length, 0);
  assert.equal(c.queries.length, 0);
  assert.equal("focus" in a.run.owner, false);
  assert.equal("show" in a.run.owner, false);
});

test("a lost owner, deadline or operator Escape during an awaited renderer lookup prevents subsequent input", async () => {
  for (const reason of ["focus", "deadline", "Escape"]) {
    const a = owner();
    a.execute(async () => {
      if (reason === "focus") a.state.focused = false;
      if (reason === "deadline") a.setTime(2000);
      if (reason === "Escape")
        a.run.beforeInput({}, { type: "keyDown", key: "Escape" });
      return { x: 10, y: 20 };
    });
    await assert.rejects(a.run.js("fixture"));
    assert.throws(() => a.run.input({ type: "mouseDown", button: "left" }));
    assert.equal(a.inputs.length, 0);
  }
});

test("intentional helper Escape gets one bounded allowance; unmatched, repeated and late Escape abort irreversibly", () => {
  const a = owner();
  a.run.input({ type: "keyDown", keyCode: "Escape" });
  a.run.beforeInput(
    {},
    { type: "keyDown", key: "Escape", isAutoRepeat: false },
  );
  a.run.input({ type: "keyUp", keyCode: "Escape" });
  a.run.guard();
  assert.equal(a.run.status.intentionalEscapesObserved, 1);
  let prevented = false;
  a.run.beforeInput(
    {
      preventDefault: () => {
        prevented = true;
      },
    },
    { type: "keyDown", key: "Escape" },
  );
  assert.equal(prevented, true);
  assert.throws(a.run.guard, /operator_escape/);
  a.setTime(1100);
  assert.throws(a.run.guard, /operator_escape/);
  for (const late of [false, true]) {
    const b = owner();
    b.run.input({ type: "keyDown", keyCode: "Escape" });
    if (late) b.setTime(1251);
    b.run.beforeInput(
      {},
      { type: "keyDown", key: "Escape", isAutoRepeat: !late },
    );
    assert.throws(b.run.guard, /operator_escape/);
  }
  const c = owner();
  c.run.beforeInput({}, { type: "keyUp", key: "Escape" });
  c.run.guard();
});

test("long pauses split into guarded 50 ms slices and cannot defer an operator abort until the end", async () => {
  const a = owner();
  await assert.rejects(a.run.pause(1200), /deadline/);
  const b = owner();
  let waits = 0;
  const run = createJourneyGuard(
    { ...b.run.owner },
    2000,
    () => 1000,
    async (ms) => {
      assert.ok(ms <= 50);
      waits++;
      run.beforeInput({}, { type: "keyDown", key: "Escape" });
    },
  );
  await assert.rejects(run.pause(1200), /operator_escape/);
  assert.equal(waits, 1);
});

test("each completed step is durably checkpointed, with bounded journal/receipt and prior evidence retained on overflow", async () => {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), "constellation-journey-unit-"),
  );
  try {
    const receipt = {
      passed: false,
      state: "running",
      actions: [],
      steps: [{ number: 1, label: "Synthetic unit step" }],
    };
    const evidence = createJourneyEvidence(dir, receipt);
    await evidence.record({ phase: "step-completed", number: 1 });
    const first = JSON.parse(
      await fs.readFile(path.join(dir, "expanded.json"), "utf8"),
    );
    assert.equal(first.passed, false);
    assert.deepEqual(first.steps, receipt.steps);
    receipt.steps.push({ number: 2, label: "Synthetic next unit step" });
    await evidence.record({ phase: "step-completed", number: 2 });
    const before = await fs.readFile(path.join(dir, "expanded.json"), "utf8");
    assert.equal(JSON.parse(before).steps.length, 2);
    await assert.rejects(
      evidence.record({ text: "x".repeat(JOURNEY_LIMITS.journalEventBytes) }),
      /event byte bound/,
    );
    receipt.oversized = "x".repeat(JOURNEY_LIMITS.receiptBytes);
    await assert.rejects(evidence.checkpoint(), /receipt byte bound/);
    assert.equal(
      await fs.readFile(path.join(dir, "expanded.json"), "utf8"),
      before,
    );
    assert.equal(
      (await fs.readFile(path.join(dir, "expanded-progress.jsonl"), "utf8"))
        .trim()
        .split("\n").length,
      2,
    );
    delete receipt.oversized;
    receipt.steps = Array.from({ length: 26 }, (_, number) => ({ number }));
    await assert.rejects(evidence.checkpoint(), /step count bound/);
  } finally {
    // Only this mkdtemp-created unit-test directory; no native evidence/profile.
    assert.equal(
      path.dirname(await fs.realpath(dir)),
      await fs.realpath(os.tmpdir()),
    );
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("initial admission failure still quits the owned host without hydration, inputs or evidence fabrication", async () => {
  const previousExit = process.exitCode,
    previousError = console.error;
  let quit = 0,
    errors = [];
  try {
    console.error = (text) => errors.push(JSON.parse(text));
    await verify({
      app: {
        quit: () => {
          quit++;
        },
      },
    });
    assert.equal(quit, 1);
    assert.equal(process.exitCode, 1);
    assert.equal(errors[0].state, "journey-initialization-failed");
  } finally {
    process.exitCode = previousExit;
    console.error = previousError;
  }
});
