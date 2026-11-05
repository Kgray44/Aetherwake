const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const {
  createProtectedStorageBroker,
  isProtectedStorageEnvelope,
  validateProtectedStorageRequest,
  PROTECTED_STORAGE_LIMITS,
} = require("./protected-storage.cjs");
const request = (operation, payload = {}) => ({
  nativeHost: {
    version: 1,
    kind: "request",
    id: randomUUID(),
    purpose: "openai-auth",
    operation,
    payload,
  },
});
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function fixture(options = {}) {
  const replies = [],
    calls = [];
  const safeStorage = {
    isAsyncEncryptionAvailable: async () => {
      calls.push("available");
      return true;
    },
    encryptStringAsync: async (value) => {
      calls.push("seal");
      return Buffer.from("SYNTHETIC:" + value);
    },
    decryptStringAsync: async (value) => {
      calls.push("open");
      return { result: value.toString().slice(10), shouldReEncrypt: false };
    },
    ...options.safeStorage,
  };
  const broker = createProtectedStorageBroker({
    safeStorage,
    isReady: () => true,
    platform: "win32",
    send: (message) => replies.push(message),
    ...options,
    safeStorage,
  });
  return { broker, replies, calls };
}
test("private storage broker interoperates with canonical client and returns no normal events/RPC", async () => {
  const {
    createNativeHostClient,
    validateNativeSecretResponse,
    NATIVE_SECRET_LIMITS,
  } = await import("../../../integrated-backend/src/native-host.mts");
  assert.deepEqual(PROTECTED_STORAGE_LIMITS, NATIVE_SECRET_LIMITS);
  let client;
  const f = fixture({
    send: (message) => {
      assert.equal(validateNativeSecretResponse(message), true);
      assert.deepEqual(Object.keys(message), ["nativeHost"]);
      client.handle(message);
    },
  });
  client = createNativeHostClient((message) => f.broker.handle(message));
  assert.equal(await client.services.secrets.available(), true);
  const value = await client.services.secrets.seal("native-synthetic-private");
  assert.equal(
    await client.services.secrets.open(value),
    "native-synthetic-private",
  );
  client.close();
  f.broker.close();
});
test("private storage broker reserves malformed/mixed/response envelopes before any public routing", async () => {
  const { validateNativeSecretRequest } = await import(
    "../../../integrated-backend/src/native-host.mts"
  );
  const f = fixture();
  const valid = request("open", { cipherBase64: "AQ==" });
  const cases = [
    { nativeHost: null, event: { private: "SECRET_MARKER" } },
    { ...valid, event: {} },
    { nativeHost: { ...valid.nativeHost, purpose: "another-purpose" } },
    { nativeHost: { ...valid.nativeHost, operation: "getPassword" } },
    { nativeHost: { ...valid.nativeHost, payload: { cipherBase64: "AR==" } } },
    { nativeHost: { ...valid.nativeHost, kind: "response" } },
    {
      nativeHost: {
        ...valid.nativeHost,
        payload: { cipherBase64: "AQ==", token: "secret" },
      },
    },
  ];
  for (const value of cases) {
    assert.equal(isProtectedStorageEnvelope(value), true);
    assert.equal(validateProtectedStorageRequest(value), false);
    assert.equal(validateNativeSecretRequest(value), false);
    assert.equal(f.broker.handle(value), true);
  }
  await delay(5);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.replies, []);
  assert.equal(f.broker.handle({ event: { safe: true } }), false);
  f.broker.close();
});
test("private storage broker denies unavailable/early/basic_text/unknown storage, no legacy plaintext fallback", async () => {
  for (const options of [
    { isReady: () => false },
    {
      platform: "linux",
      safeStorage: {
        isAsyncEncryptionAvailable: async () => true,
        getSelectedStorageBackend: () => "basic_text",
      },
    },
    {
      platform: "linux",
      safeStorage: {
        isAsyncEncryptionAvailable: async () => true,
        getSelectedStorageBackend: () => "unknown",
      },
    },
    { safeStorage: { isAsyncEncryptionAvailable: async () => false } },
  ]) {
    let seal = 0;
    const f = fixture({
      ...options,
      safeStorage: {
        ...options.safeStorage,
        encryptStringAsync: async () => {
          seal++;
          throw Error("private");
        },
      },
    });
    f.broker.handle(request("seal", { plaintext: "synthetic" }));
    await delay(5);
    assert.equal(f.replies[0]?.nativeHost.error, "os_encryption_unavailable");
    assert.equal(seal, 0);
    f.broker.close();
  }
});
test("private storage broker returns allowlisted code only for diagnostics/rotation/invalid crypto result", async () => {
  for (const [safeStorage, code] of [
    [
      {
        encryptStringAsync: async () => {
          throw Error("SUPER_PRIVATE_DIAGNOSTIC");
        },
      },
      "native_secret_failed",
    ],
    [
      {
        decryptStringAsync: async () => ({
          result: "SUPER_PRIVATE_DIAGNOSTIC",
          shouldReEncrypt: true,
        }),
      },
      "secret_reencryption_required",
    ],
    [
      {
        decryptStringAsync: async () => ({
          result: 42,
          shouldReEncrypt: false,
        }),
      },
      "native_secret_capacity",
    ],
  ]) {
    const f = fixture({
      safeStorage: {
        isAsyncEncryptionAvailable: async () => true,
        encryptStringAsync: async () => Buffer.of(1),
        decryptStringAsync: async () => ({
          result: "synthetic",
          shouldReEncrypt: false,
        }),
        ...safeStorage,
      },
    });
    f.broker.handle(
      request(
        Object.hasOwn(safeStorage, "encryptStringAsync") ? "seal" : "open",
        Object.hasOwn(safeStorage, "encryptStringAsync")
          ? { plaintext: "synthetic" }
          : { cipherBase64: "AQ==" },
      ),
    );
    await delay(5);
    assert.equal(f.replies[0]?.nativeHost.error, code);
    assert.ok(!JSON.stringify(f.replies).includes("SUPER_PRIVATE"));
    f.broker.close();
  }
});
test("private storage broker byte/wire caps and canonical base64 match backend validators", async () => {
  const { validateNativeSecretRequest } = await import(
    "../../../integrated-backend/src/native-host.mts"
  );
  for (const value of [
    request("seal", { plaintext: "x".repeat(262145) }),
    request("seal", { plaintext: "\u0000".repeat(262144) }),
    request("open", { cipherBase64: Buffer.alloc(524289).toString("base64") }),
  ]) {
    assert.equal(validateProtectedStorageRequest(value), false);
    assert.equal(validateNativeSecretRequest(value), false);
  }
  assert.equal(
    validateProtectedStorageRequest(
      request("open", {
        cipherBase64: Buffer.alloc(524288).toString("base64"),
      }),
    ),
    true,
  );
});
test("private storage broker timeout/close invalidate before late completion or next crypto call", async () => {
  let release;
  const f = fixture({
    timeoutMs: 10,
    safeStorage: {
      isAsyncEncryptionAvailable: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
      encryptStringAsync: async () => {
        throw Error("must-not-run-after-timeout");
      },
    },
  });
  f.broker.handle(request("seal", { plaintext: "secret" }));
  await delay(20);
  assert.equal(f.replies[0]?.nativeHost.error, "native_secret_timeout");
  release(true);
  await delay(5);
  assert.equal(f.replies.length, 1);
  f.broker.close();
  const closed = fixture();
  closed.broker.handle(request("seal", { plaintext: "secret" }));
  closed.broker.close();
  await delay(5);
  assert.deepEqual(closed.calls, []);
  assert.deepEqual(closed.replies, []);
});
test("private storage broker in-flight and duplicate IDs cannot create extra crypto calls", async () => {
  let release;
  const f = fixture({
    inFlight: 1,
    safeStorage: {
      isAsyncEncryptionAvailable: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    },
  });
  const first = request("available");
  f.broker.handle(first);
  f.broker.handle(request("available"));
  assert.equal(f.replies[0]?.nativeHost.error, "native_secret_backpressure");
  await delay(0);
  f.broker.handle(first);
  assert.equal(f.replies[1]?.nativeHost.error, "native_secret_protocol");
  release(true);
  await delay(5);
  assert.equal(f.replies.length, 2);
  f.broker.close();
});
