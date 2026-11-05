/* Private owned-child protocol only. Main must authenticate its actual child before handle(). */
const LIMITS = Object.freeze({
  plaintextBytes: 262144,
  cipherBytes: 524288,
  wireBytes: 1048576,
  inFlight: 8,
  timeoutMs: 15000,
});
const CODES = new Set([
  "native_secret_unavailable",
  "native_secret_protocol",
  "native_secret_capacity",
  "native_secret_backpressure",
  "native_secret_timeout",
  "native_secret_closed",
  "native_secret_failed",
  "os_encryption_unavailable",
  "secret_reencryption_required",
]);
const record = (value) =>
  !!value && typeof value === "object" && !Array.isArray(value);
const plainRecord = (value) =>
  record(value) &&
  (Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null);
const exact = (value, keys) =>
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const reserved = (value) =>
  value !== null &&
  (typeof value === "object" || typeof value === "function") &&
  Object.hasOwn(value, "nativeHost");
const plain = (value) =>
  typeof value === "string" &&
  value.length <= LIMITS.plaintextBytes &&
  Buffer.byteLength(value) <= LIMITS.plaintextBytes;
function cipher(value) {
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length > Math.ceil(LIMITS.cipherBytes / 3) * 4 ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  )
    return null;
  const result = Buffer.from(value, "base64");
  return result.length > 0 &&
    result.length <= LIMITS.cipherBytes &&
    result.toString("base64") === value
    ? result
    : null;
}
function request(value) {
  if (
    !reserved(value) ||
    !plainRecord(value) ||
    !exact(value, ["nativeHost"]) ||
    !plainRecord(value.nativeHost)
  )
    return false;
  const h = value.nativeHost;
  if (
    !exact(h, ["version", "kind", "id", "purpose", "operation", "payload"]) ||
    h.version !== 1 ||
    h.kind !== "request" ||
    h.purpose !== "openai-auth" ||
    typeof h.id !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      h.id,
    ) ||
    !plainRecord(h.payload)
  )
    return false;
  const valid =
    h.operation === "available"
      ? exact(h.payload, [])
      : h.operation === "seal"
        ? exact(h.payload, ["plaintext"]) && plain(h.payload.plaintext)
        : h.operation === "open"
          ? exact(h.payload, ["cipherBase64"]) &&
            !!cipher(h.payload.cipherBase64)
          : false;
  return valid && Buffer.byteLength(JSON.stringify(value)) <= LIMITS.wireBytes;
}
function createProtectedStorageBroker({
  safeStorage,
  isReady,
  send,
  platform = process.platform,
  timeoutMs = LIMITS.timeoutMs,
  inFlight = LIMITS.inFlight,
}) {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > LIMITS.timeoutMs ||
    !Number.isSafeInteger(inFlight) ||
    inFlight <= 0 ||
    inFlight > LIMITS.inFlight
  )
    throw Error("native_secret_capacity");
  const pending = new Map();
  let closed = false;
  const publish = (h, result, error) => {
    const inner = {
        version: 1,
        kind: "response",
        id: h.id,
        purpose: "openai-auth",
        operation: h.operation,
        ...(error ? { error } : { result }),
      },
      wire = { nativeHost: inner };
    if (Buffer.byteLength(JSON.stringify(wire)) > LIMITS.wireBytes) {
      delete inner.result;
      inner.error = "native_secret_capacity";
    }
    try {
      send(wire);
    } catch {
      /* owned channel closed; never reroute/log */
    }
  };
  const available = async () => {
    if (
      !isReady() ||
      !["win32", "darwin", "linux"].includes(platform) ||
      typeof safeStorage?.isAsyncEncryptionAvailable !== "function" ||
      typeof safeStorage?.encryptStringAsync !== "function" ||
      typeof safeStorage?.decryptStringAsync !== "function"
    )
      return false;
    if (
      platform === "linux" &&
      !["gnome_libsecret", "kwallet", "kwallet5", "kwallet6"].includes(
        safeStorage.getSelectedStorageBackend?.(),
      )
    )
      return false;
    return (await safeStorage.isAsyncEncryptionAvailable()) === true;
  };
  return {
    handle(value) {
      if (!reserved(value)) return false;
      if (!request(value)) return true;
      const h = structuredClone(value.nativeHost);
      if (closed) {
        publish(h, null, "native_secret_closed");
        return true;
      }
      if (pending.has(h.id)) {
        const old = pending.get(h.id);
        old.active = false;
        clearTimeout(old.timer);
        pending.delete(h.id);
        publish(h, null, "native_secret_protocol");
        return true;
      }
      if (pending.size >= inFlight) {
        publish(h, null, "native_secret_backpressure");
        return true;
      }
      const finish = (result, error) => {
          if (!entry.active || closed) return;
          entry.active = false;
          clearTimeout(entry.timer);
          pending.delete(h.id);
          publish(h, result, error);
        },
        entry = {
          active: true,
          timer: setTimeout(
            () => finish(null, "native_secret_timeout"),
            timeoutMs,
          ),
        };
      pending.set(h.id, entry);
      void Promise.resolve()
        .then(async () => {
          if (!entry.active || closed) return;
          const enabled = await available();
          if (!entry.active || closed) return;
          if (h.operation === "available") {
            finish({ available: enabled });
            return;
          }
          if (!enabled) {
            finish(null, "os_encryption_unavailable");
            return;
          }
          if (h.operation === "seal") {
            const value = await safeStorage.encryptStringAsync(
              h.payload.plaintext,
            );
            if (
              !(value instanceof Uint8Array) ||
              !value.length ||
              value.length > LIMITS.cipherBytes
            ) {
              finish(null, "native_secret_capacity");
              return;
            }
            finish({ cipherBase64: Buffer.from(value).toString("base64") });
          } else {
            const result = await safeStorage.decryptStringAsync(
              Buffer.from(cipher(h.payload.cipherBase64)),
            );
            if (!record(result) || result.shouldReEncrypt !== false) {
              finish(
                null,
                record(result) && result.shouldReEncrypt === true
                  ? "secret_reencryption_required"
                  : "native_secret_protocol",
              );
              return;
            }
            if (!plain(result.result)) {
              finish(null, "native_secret_capacity");
              return;
            }
            finish({ plaintext: result.result });
          }
        })
        .catch((error) =>
          finish(
            null,
            record(error) && CODES.has(error.code)
              ? error.code
              : "native_secret_failed",
          ),
        );
      return true;
    },
    close() {
      closed = true;
      for (const entry of pending.values()) {
        entry.active = false;
        clearTimeout(entry.timer);
      }
      pending.clear();
    },
  };
}
module.exports = {
  createProtectedStorageBroker,
  isProtectedStorageEnvelope: reserved,
  validateProtectedStorageRequest: request,
  PROTECTED_STORAGE_LIMITS: LIMITS,
};
