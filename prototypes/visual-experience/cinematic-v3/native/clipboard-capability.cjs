// No Electron import, clipboard reads, generic IPC, provider authority or logs.
// Main injects exactly clipboard.writeText and native-owned per-invocation gates.
// Electron45 writeText is Promise<void>: success requires its actual resolution.
const CONTRACT = "aerynth.clipboard@1";
const MAX_TEXT_BYTES = 256 * 1024;
const result = (status, code) =>
  code ? { contract: CONTRACT, status, code } : { contract: CONTRACT, status };
function validText(value) {
  if (
    typeof value !== "string" ||
    value.length > MAX_TEXT_BYTES ||
    value.includes("\0")
  )
    return false;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (c >= 0xdc00 && c <= 0xdfff) return false;
  }
  return Buffer.byteLength(value, "utf8") <= MAX_TEXT_BYTES;
}
function copyRequest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  try {
    const proto = Object.getPrototypeOf(input),
      d = Object.getOwnPropertyDescriptors(input),
      keys = Reflect.ownKeys(d);
    if (
      (proto !== Object.prototype && proto !== null) ||
      keys.length !== 2 ||
      !Object.hasOwn(d, "type") ||
      !Object.hasOwn(d, "text") ||
      !keys.every((key) => typeof key === "string" && "value" in d[key])
    )
      return null;
    return d.type.value === "copyText" && validText(d.text.value)
      ? { type: "copyText", text: d.text.value }
      : null;
  } catch {
    return null;
  }
}
/** isTrustedApplicationFrame(event): synchronous exact owned WebContents,
 * top/main frame+URL+focus/liveness check, repeated after authorization await.
 * authorizeUserCopy(event): mandatory current native-owned gesture check; NEVER
 * a renderer-supplied boolean. IpcMainInvokeEvent has no gesture attestation.
 * Root's isolated preload gate and dedicated IPC are required integration seams.
 * Deadline/close cannot undo a dispatched OS write: report unknown, never retry.
 */
function createClipboardCapability({
  writeText,
  isTrustedApplicationFrame,
  authorizeUserCopy,
  deadlineMs = 2000,
} = {}) {
  if (
    typeof writeText !== "function" ||
    typeof isTrustedApplicationFrame !== "function" ||
    typeof authorizeUserCopy !== "function" ||
    !Number.isSafeInteger(deadlineMs) ||
    deadlineMs < 1 ||
    deadlineMs > 5000
  )
    throw Error("clipboard_native_dependencies_required");
  let closed = false,
    active = null;
  const trusted = (event) => {
    try {
      return isTrustedApplicationFrame(event) === true;
    } catch {
      return false;
    }
  };
  return Object.freeze({
    async copy(event, input) {
      if (closed) return result("unavailable", "clipboard_closed");
      const request = copyRequest(input);
      if (!request) return result("denied", "clipboard_invalid_request");
      if (!trusted(event))
        return result("denied", "clipboard_unauthorized_sender");
      if (active) return result("unavailable", "clipboard_busy");
      const operation = {
        valid: true,
        dispatched: false,
        replied: false,
        timer: null,
        reply: null,
      };
      active = operation;
      const done = new Promise((resolve) => {
        operation.reply = resolve;
      });
      const finish = (value, release = true) => {
        if (release && active === operation) active = null;
        if (operation.replied) return;
        operation.replied = true;
        clearTimeout(operation.timer);
        operation.reply(value);
      };
      operation.cancel = () => {
        operation.valid = false;
        finish(
          result(
            operation.dispatched ? "unknown" : "unavailable",
            operation.dispatched
              ? "clipboard_closed_after_dispatch"
              : "clipboard_closed",
          ),
          !operation.dispatched,
        );
      };
      operation.timer = setTimeout(() => {
        operation.valid = false;
        // The uncancelable injected native check/write still counts against the
        // one-operation budget until it settles. Never accumulate timed-out jobs.
        finish(
          result(
            operation.dispatched ? "unknown" : "unavailable",
            operation.dispatched
              ? "clipboard_write_timeout"
              : "clipboard_authorization_timeout",
          ),
          false,
        );
      }, deadlineMs);
      void (async () => {
        let authorized;
        try {
          authorized = await authorizeUserCopy(event);
        } catch {
          if (operation.valid)
            finish(
              result("unavailable", "clipboard_authorization_unavailable"),
            );
          else if (active === operation) active = null;
          return;
        }
        if (!operation.valid || closed || active !== operation) {
          if (active === operation) active = null;
          return;
        }
        if (authorized !== true) {
          finish(result("denied", "clipboard_user_gesture_required"));
          return;
        }
        if (!trusted(event)) {
          finish(result("denied", "clipboard_unauthorized_sender"));
          return;
        }
        operation.dispatched = true;
        let nativeWrite;
        try {
          nativeWrite = writeText(request.text);
        } catch {
          finish(result("unknown", "clipboard_write_unconfirmed"), false);
          return;
        }
        if (!nativeWrite || typeof nativeWrite.then !== "function") {
          // A missing returned promise cannot prove the installed async API
          // completed. Keep this channel busy until close rather than race it.
          finish(result("unknown", "clipboard_write_unconfirmed"), false);
          return;
        }
        try {
          await nativeWrite;
        } catch {
          finish(result("unknown", "clipboard_write_unconfirmed"));
          return;
        }
        if (!operation.valid || closed) {
          if (active === operation) active = null;
          return;
        }
        finish(result("copied"));
      })().catch(() => {
        operation.valid = false;
        finish(
          result(
            operation.dispatched ? "unknown" : "unavailable",
            operation.dispatched
              ? "clipboard_write_unconfirmed"
              : "clipboard_authorization_unavailable",
          ),
          !operation.dispatched,
        );
      });
      return done;
    },
    close() {
      if (closed) return;
      closed = true;
      active?.cancel();
    },
  });
}
module.exports = {
  CLIPBOARD_CONTRACT: CONTRACT,
  CLIPBOARD_TEXT_MAX_BYTES: MAX_TEXT_BYTES,
  copyRequest,
  createClipboardCapability,
};
