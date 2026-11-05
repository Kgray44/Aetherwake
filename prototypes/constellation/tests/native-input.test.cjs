const { test } = require("node:test");
const assert = require("node:assert/strict");
const { nativeInput } = require("./native-input.cjs");

function windowStub() {
  const state = { focused: true, visible: true, minimized: false, destroyed: false, contentsDestroyed: false };
  const inputs = [];
  let focusCalls = 0;
  return {
    state, inputs,
    get focusCalls() { return focusCalls; },
    win: {
      isFocused: () => state.focused,
      isVisible: () => state.visible,
      isMinimized: () => state.minimized,
      isDestroyed: () => state.destroyed,
      focus: () => { focusCalls++; },
      webContents: {
        isDestroyed: () => state.contentsDestroyed,
        sendInputEvent: (event) => inputs.push(event),
      },
    },
  };
}

test("native input reaches only the focused visible owner window without refocusing", () => {
  const stub = windowStub(), event = { type: "mouseMove", x: 12, y: 34 };
  nativeInput(stub.win, event);
  assert.deepEqual(stub.inputs, [event]);
  assert.equal(stub.focusCalls, 0);
});

test("blur, hidden, minimized and destroyed windows receive no native input", () => {
  for (const [key, value] of [
    ["focused", false], ["visible", false], ["minimized", true],
    ["destroyed", true], ["contentsDestroyed", true],
  ]) {
    const stub = windowStub();
    stub.state[key] = value;
    assert.throws(() => nativeInput(stub.win, { type: "keyDown", keyCode: "Enter" }), { code: "native_owner_window_inactive" });
    assert.equal(stub.inputs.length, 0, key);
    assert.equal(stub.focusCalls, 0, key);
  }
});

test("a focus change during a drag pause stops subsequent input without reclaiming focus", async () => {
  const stub = windowStub();
  nativeInput(stub.win, { type: "mouseDown", button: "left" });
  await new Promise((resolve) => setImmediate(resolve));
  stub.state.focused = false;
  assert.throws(() => nativeInput(stub.win, { type: "mouseMove", x: 20, y: 30 }), { code: "native_owner_window_inactive" });
  assert.equal(stub.inputs.length, 1);
  assert.equal(stub.focusCalls, 0);
});
