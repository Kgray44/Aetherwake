import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const {
  verificationOptions,
  createInlineDraftGuard,
} = require("../native/inline-draft-guard.cjs");
const { createDriver } = require("../native/desktop-verify.cjs");

function fixture() {
  const state = {
      focused: true,
      visible: true,
      minimized: false,
      destroyed: false,
      contentsDestroyed: false,
    },
    inputs = [];
  let focusCalls = 0,
    captures = 0,
    inserts = 0;
  const win = {
    isDestroyed: () => state.destroyed,
    isFocused: () => state.focused,
    isVisible: () => state.visible,
    isMinimized: () => state.minimized,
    focus() {
      focusCalls++;
    },
    show() {
      throw Error("unexpected_show");
    },
    webContents: {
      isDestroyed: () => state.contentsDestroyed,
      sendInputEvent(event) {
        inputs.push(event);
      },
      async insertText() {
        inserts++;
      },
      async capturePage() {
        captures++;
        return { toPNG: () => Buffer.from("synthetic capture") };
      },
      async executeJavaScript(code) {
        return code.includes("getBoundingClientRect") ? { x: 40, y: 60 } : true;
      },
    },
  };
  return {
    state,
    inputs,
    win,
    get focusCalls() {
      return focusCalls;
    },
    get captures() {
      return captures;
    },
    get inserts() {
      return inserts;
    },
  };
}

test("inline verification requires a bounded explicit host-started deadline", () => {
  for (const value of [undefined, 0, 999, 90001, Infinity, "bad"])
    assert.throws(
      () =>
        verificationOptions(
          value === undefined ? [] : ["--verification-deadline-ms=" + value],
          1000,
        ),
      /explicit_deadline/,
    );
  assert.throws(
    () => verificationOptions(["--verification-deadline-ms=30000"], undefined),
    /host_module_start/,
  );
  assert.deepEqual(
    verificationOptions(["--verification-deadline-ms=30000"], 1000),
    {
      deadlineMs: 30000,
      deadlineAt: 31000,
      maxScreenshots: 2,
      maxPngBytes: 8388608,
      maxJsonBytes: 524288,
      maxCheckpointBytes: 131072,
    },
  );
});

test("every input, insert and capture fails closed on inactive ownership or expired deadline without focus acquisition", async () => {
  for (const [name, value] of [
    ["focused", false],
    ["visible", false],
    ["minimized", true],
    ["destroyed", true],
    ["contentsDestroyed", true],
  ]) {
    const f = fixture();
    f.state[name] = value;
    const guard = createInlineDraftGuard(f.win, {
      deadlineAt: 100,
      now: () => 1,
    });
    assert.throws(
      () => guard.input({ type: "keyDown" }),
      /native_owner_window_inactive/,
    );
    await assert.rejects(
      guard.insertText("Synthetic"),
      /native_owner_window_inactive/,
    );
    await assert.rejects(guard.capture(), /native_owner_window_inactive/);
    assert.equal(f.inputs.length + f.inserts + f.captures + f.focusCalls, 0);
  }
  const f = fixture(),
    expired = createInlineDraftGuard(f.win, {
      deadlineAt: 100,
      now: () => 100,
    });
  assert.throws(() => expired.input({ type: "mouseDown" }), /deadline_reached/);
  await assert.rejects(expired.capture(), /deadline_reached/);
  assert.equal(f.captures + f.inputs.length, 0);
});

test("await continuations cannot insert or capture after a focus/deadline change", async () => {
  const f = fixture();
  let now = 1;
  const guard = createInlineDraftGuard(f.win, {
    deadlineAt: 100,
    now: () => now,
    sleep: async () => {
      f.state.focused = false;
    },
  });
  await assert.rejects(guard.pause(20), /native_owner_window_inactive/);
  await assert.rejects(
    guard.insertText("Must not be inserted"),
    /native_owner_window_inactive/,
  );
  f.state.focused = true;
  f.win.webContents.capturePage = async () => {
    now = 100;
    return { toPNG: () => Buffer.from("not accepted") };
  };
  await assert.rejects(guard.capture(), /deadline_reached/);
  assert.equal(f.inserts, 0);
  assert.equal(f.focusCalls, 0);
});

test("shared driver fences each mouse event and executeJavaScript continuation with the same guard", async () => {
  const f = fixture();
  let now = 1;
  const guard = createInlineDraftGuard(f.win, {
    deadlineAt: 100,
    now: () => now,
  });
  const driver = await createDriver(f.win, { assertActive: guard.check });
  f.win.webContents.sendInputEvent = (event) => {
    f.inputs.push(event);
    f.state.focused = false;
  };
  await assert.rejects(
    driver.click("#synthetic-target"),
    /native_owner_window_inactive/,
  );
  assert.deepEqual(
    f.inputs.map((event) => event.type),
    ["mouseMove"],
  );
  f.state.focused = true;
  f.win.webContents.executeJavaScript = async () => {
    now = 100;
    return true;
  };
  await assert.rejects(driver.js("synthetic read"), /deadline_reached/);
  assert.equal(f.focusCalls, 0);
});

test("the actual direct-verification route forwards the host start to its inline draft helper", async () => {
  const location = require.resolve("../native/integration-inline-drafts.cjs"),
    prior = require.cache[location],
    argv = process.argv;
  let received;
  require.cache[location] = {
    id: location,
    filename: location,
    loaded: true,
    exports: {
      verify: async (context) => {
        received = context;
      },
    },
  };
  process.argv = [...argv, "--verify-inline-drafts"];
  try {
    const context = {
      win: {},
      app: {},
      privateRoot: "synthetic-only",
      source: { head: "synthetic-source" },
      moduleStarted: 1000,
    };
    await require("../native/integration-direct.cjs").verify(context);
    assert.deepEqual(received, context);
  } finally {
    process.argv = argv;
    if (prior) require.cache[location] = prior;
    else delete require.cache[location];
  }
});
