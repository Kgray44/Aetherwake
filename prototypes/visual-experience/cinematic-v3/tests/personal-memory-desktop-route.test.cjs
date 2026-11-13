const assert = require("node:assert/strict");
const test = require("node:test");
const { applicationFrameTrust, nativeReviewBoundary, createPersonalMemoryDesktopRoute } =
  require("../native/personal-memory-desktop-route.cjs");

test("the native memory route shares desktop admission and retires consent with its exact frame and backend", async () => {
  const url = "file:///synthetic-inspector.html";
  let activation = true, admitted = false, backend = {};
  const frame = { url, async executeJavaScript(_script, activate) { assert.equal(activate, false); return activation; } };
  const contents = { mainFrame: frame, isDestroyed: () => false };
  const win = {
    webContents: contents, isDestroyed: () => false, isVisible: () => true,
    isMinimized: () => false, isFocused: () => true,
  };
  const event = { sender: contents, senderFrame: frame };
  const frames = applicationFrameTrust(win, url);
  const { nativeReviewGate, reviewDialogs } = nativeReviewBoundary({
    checkDesktopTest() { if (!admitted) throw Error("native_test_desktop_slot_closed"); },
    dialog: {
      async showMessageBox(parent, options) {
        assert.equal(parent, win);
        assert.match(options.message, /Vela’s OpenAI API/);
        assert.equal(options.defaultId, options.cancelId);
        backend = {};
        return { response: 1 };
      },
    },
  });
  const route = createPersonalMemoryDesktopRoute({
    win, frames, backendIdentity: () => backend, backendReady: () => true,
    allowWrite: () => true, reviewDialogs,
    async call(name, request) {
      assert.equal(name, "personalMemoryPolicyNative");
      assert.deepEqual(request, {});
      return { version: 1, storageEnabled: true, velaEnabled: false };
    },
  });
  const request = { type: "enableProviderMemory", assistant: "vela", version: 1 };
  await assert.rejects(route({ ...event, senderFrame: { ...frame } }, request), /personal_memory_frame_changed/);
  activation = false;
  await assert.rejects(route(event, request), /personal_memory_user_gesture_required/);
  activation = true;
  await assert.rejects(route(event, request), /native_test_desktop_slot_closed/);
  admitted = true;
  await nativeReviewGate(async () => {
    await assert.rejects(route(event, request), /native_review_busy/);
  });
  await assert.rejects(route(event, request), /personal_memory_frame_changed/);
});
