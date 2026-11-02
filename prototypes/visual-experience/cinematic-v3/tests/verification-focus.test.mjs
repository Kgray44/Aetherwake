import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { createDriver } = createRequire(import.meta.url)(
  "../native/desktop-verify.cjs",
);
function nativeWindow() {
  const state = {
    focused: true,
    visible: true,
    minimized: false,
    destroyed: false,
    focusCalls: 0,
    reads: 0,
    inputs: 0,
  };
  return {
    state,
    win: {
      isFocused: () => state.focused,
      isVisible: () => state.visible,
      isMinimized: () => state.minimized,
      isDestroyed: () => state.destroyed,
      focus() {
        state.focusCalls++;
      },
      webContents: {
        executeJavaScript() {
          state.reads++;
          return Promise.resolve(true);
        },
        sendInputEvent() {
          state.inputs++;
        },
      },
    },
  };
}
test("native acceptance observes foreground ownership without ever reclaiming it", async () => {
  const { state, win } = nativeWindow();
  const driver = await createDriver(win);
  await driver.wait("true");
  assert.equal(state.reads, 1);
  assert.equal(state.focusCalls, 0);
  state.focused = false;
  await assert.rejects(driver.wait("true"), /native_verification_focus_lost/);
  await assert.rejects(
    driver.click("button"),
    /native_verification_focus_lost/,
  );
  await assert.rejects(
    driver.fill("input", "synthetic"),
    /native_verification_focus_lost/,
  );
  assert.equal(state.reads, 1);
  assert.equal(state.inputs, 0);
  assert.equal(state.focusCalls, 0);
});
test("unfocused, hidden, minimized or destroyed windows cannot start native acceptance input", async () => {
  for (const [key, value] of [
    ["focused", false],
    ["visible", false],
    ["minimized", true],
    ["destroyed", true],
  ]) {
    const { state, win } = nativeWindow();
    state[key] = value;
    await assert.rejects(createDriver(win), /native_verification_focus_lost/);
    assert.equal(state.focusCalls, 0);
    assert.equal(state.reads, 0);
    assert.equal(state.inputs, 0);
  }
});
