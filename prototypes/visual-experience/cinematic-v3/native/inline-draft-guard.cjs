const assert = require("node:assert/strict");
const {
  assertNativeOwner,
} = require("../../../constellation/tests/native-input.cjs");

function verificationOptions(argv, moduleStarted) {
  const value = Number(
    argv
      .find((argument) => argument.startsWith("--verification-deadline-ms="))
      ?.split("=")[1],
  );
  assert(
    Number.isInteger(value) && value >= 1000 && value <= 90000,
    "inline_draft_explicit_deadline_1000_to_90000_required",
  );
  assert(
    Number.isFinite(moduleStarted) && moduleStarted > 0,
    "inline_draft_host_module_start_required",
  );
  return {
    deadlineMs: value,
    deadlineAt: moduleStarted + value,
    maxScreenshots: 2,
    maxPngBytes: 8 * 1024 * 1024,
    maxJsonBytes: 512 * 1024,
    maxCheckpointBytes: 128 * 1024,
  };
}

/** No focus acquisition. Every asynchronous continuation revalidates both the
 * exact owner window and the same host-started deadline before proceeding. */
function createInlineDraftGuard(
  win,
  {
    deadlineAt,
    now = Date.now,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  },
) {
  const check = () => {
    if (!Number.isFinite(deadlineAt) || now() >= deadlineAt)
      throw Object.assign(new Error("inline_draft_deadline_reached"), {
        code: "inline_draft_deadline_reached",
      });
    assertNativeOwner(win);
  };
  const around = async (work) => {
    check();
    const value = await work();
    check();
    return value;
  };
  return {
    check,
    around,
    input(event) {
      check();
      win.webContents.sendInputEvent(event);
      check();
    },
    insertText(text) {
      return around(() => win.webContents.insertText(text));
    },
    capture() {
      return around(() => win.webContents.capturePage());
    },
    pause(ms) {
      return around(() => sleep(Math.min(ms, Math.max(0, deadlineAt - now()))));
    },
  };
}
module.exports = { verificationOptions, createInlineDraftGuard };
