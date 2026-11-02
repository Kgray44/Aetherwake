import test from "node:test";
import assert from "node:assert/strict";
import {
  createNativeHostClient,
  createNativeHostServer,
  isNativeHostEnvelope,
  validateNativeSecretRequest,
  validateNativeSecretResponse,
  type NativeSecretRequest,
} from "../src/native-host.mts";
test("private native seam exact roundtrip, malformed/mixed reservations and no public fanout", async () => {
  let client!: ReturnType<typeof createNativeHostClient>;
  const server = createNativeHostServer(
    {
      secrets: {
        available: async () => true,
        seal: async (value) => Buffer.from("synthetic:" + value),
        open: async (value) => Buffer.from(value).toString().slice(10),
      },
    },
    (message) => {
      client.handle(message);
    },
  );
  client = createNativeHostClient((message) => {
    server.handle(message);
  });
  assert.equal(await client.services.secrets.available(), true);
  const cipher = await client.services.secrets.seal("private-synthetic");
  assert.equal(await client.services.secrets.open(cipher), "private-synthetic");
  for (const message of [
    { nativeHost: null, event: { private: "do-not-fanout" } },
    { nativeHost: "bad", id: 1, result: "private" },
    { nativeHost: { purpose: "other" } },
  ]) {
    assert.equal(isNativeHostEnvelope(message), true);
    assert.equal(server.handle(message), true);
    assert.equal(client.handle(message), true);
  }
  assert.equal(server.handle({ event: { safe: true } }), false);
  client.close();
  server.close();
});
test("private native seam capacity, timeout, late result and close reject without leaking diagnostics", async () => {
  let request!: NativeSecretRequest;
  const client = createNativeHostClient(
    (message) => {
      request = message;
    },
    { timeoutMs: 10, inFlight: 1 },
  );
  await assert.rejects(
    client.services.secrets.seal("x".repeat(262145)),
    /native_secret_capacity/,
  );
  const first = client.services.secrets.available();
  await assert.rejects(
    client.services.secrets.available(),
    /native_secret_backpressure/,
  );
  await assert.rejects(first, /native_secret_timeout/);
  assert.equal(
    client.handle({
      nativeHost: {
        ...request.nativeHost,
        kind: "response",
        result: { available: true },
        payload: undefined,
      },
    }),
    true,
  );
  const pending = client.services.secrets.open(Buffer.of(1));
  client.close();
  await assert.rejects(pending, /native_secret_closed/);
});
test("private native seam validators enforce canonical bytes, purpose, operation and exact reply fields", () => {
  const id = "12345678-1234-4123-8123-123456789abc";
  const valid = {
    nativeHost: {
      version: 1,
      kind: "request",
      id,
      purpose: "openai-auth",
      operation: "open",
      payload: { cipherBase64: "AQ==" },
    },
  };
  assert.equal(validateNativeSecretRequest(valid), true);
  for (const bad of [
    { ...valid, event: {} },
    { nativeHost: { ...valid.nativeHost, purpose: "other" } },
    { nativeHost: { ...valid.nativeHost, operation: "exec" } },
    { nativeHost: { ...valid.nativeHost, payload: { cipherBase64: "AR==" } } },
  ])
    assert.equal(validateNativeSecretRequest(bad), false);
  assert.equal(
    validateNativeSecretResponse({
      nativeHost: {
        version: 1,
        kind: "response",
        id,
        purpose: "openai-auth",
        operation: "available",
        result: { available: true },
      },
    }),
    true,
  );
  assert.equal(
    validateNativeSecretResponse({
      nativeHost: {
        version: 1,
        kind: "response",
        id,
        purpose: "openai-auth",
        operation: "available",
        error: "private raw text",
      },
    }),
    false,
  );
});
test("private native seam deadline/close suppress late publication and queued secret work", async () => {
  const replies: unknown[] = [];
  let release!: (value: boolean) => void,
    calls = 0;
  const server = createNativeHostServer(
    {
      secrets: {
        available: () =>
          new Promise((resolve) => {
            release = resolve;
          }),
        seal: async () => {
          calls++;
          return Buffer.of(1);
        },
        open: async () => "",
      },
    },
    (message) => replies.push(message),
    { timeoutMs: 5 },
  );
  const req: NativeSecretRequest = {
    nativeHost: {
      version: 1,
      kind: "request",
      id: "12345678-1234-4123-8123-123456789abc",
      purpose: "openai-auth",
      operation: "available",
      payload: {},
    },
  };
  server.handle(req);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(
    (replies[0] as { nativeHost: { error: string } }).nativeHost.error,
    "native_secret_timeout",
  );
  release(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(replies.length, 1);
  server.close();
  const queued = createNativeHostServer(
    {
      secrets: {
        available: async () => true,
        seal: async () => {
          calls++;
          return Buffer.of(1);
        },
        open: async () => "",
      },
    },
    (message) => replies.push(message),
  );
  queued.handle({
    nativeHost: {
      ...req.nativeHost,
      operation: "seal",
      payload: { plaintext: "PRIVATE_MARKER" },
    },
  });
  queued.close();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 0);
  assert.equal(replies.length, 1);
});
test("private native seam malformed structural objects are consumed without stringification or fanout", () => {
  const server = createNativeHostServer(undefined, () =>
    assert.fail("malformed must not publish"),
  );
  for (const value of [
    Object.assign([], { nativeHost: null, event: "PRIVATE_MARKER" }),
    Object.assign(Buffer.alloc(0), { nativeHost: null }),
    {
      nativeHost: {
        version: 1,
        kind: "request",
        id: "12345678-1234-4123-8123-123456789abc",
        purpose: "openai-auth",
        operation: Object.create(null),
        payload: {},
      },
    },
    {
      nativeHost: {
        version: 1,
        kind: "request",
        id: "12345678-1234-4123-8123-123456789abc",
        purpose: "openai-auth",
        operation: "seal",
        payload: { plaintext: 1n },
      },
    },
  ]) {
    assert.equal(isNativeHostEnvelope(value), true);
    assert.equal(validateNativeSecretRequest(value), false);
    assert.equal(server.handle(value), true);
  }
  server.close();
});
