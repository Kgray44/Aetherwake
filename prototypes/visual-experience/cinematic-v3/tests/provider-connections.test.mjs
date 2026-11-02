import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { createProviderConnectionBroker } = createRequire(import.meta.url)(
  "../native/provider-connections.cjs",
);
const providerId = "chatgpt-plan-responses";
const status = {
  contract: "aerynth.provider-connection@1",
  providerId,
  billingRoute: "chatgpt-plan",
  state: "disconnected",
  storageAvailable: true,
  pending: false,
  registrationVersion: null,
  planUsageEnabled: false,
  inferenceVerified: false,
  nativeAccountHistory: false,
  nativeAccountMemory: false,
  nativeAccountSync: false,
};
const attemptId = "65f5dbdd-aefe-434f-879f-480df8f11dbe";
const authorizationUrl =
  "https://auth.openai.com/api/accounts/authorize?state=synthetic&code_challenge=synthetic";

test("only the native browser opener sees the fixed official authorization URL", async () => {
  const calls = [],
    opened = [];
  const broker = createProviderConnectionBroker({
    call: async (name, input) => {
      calls.push({ name, input });
      return input.type === "begin"
        ? { attemptId, authorizationUrl, expiresAt: Date.now() + 60000 }
        : {
            ...status,
            pending: input.type === "finish",
            privateToken: "must never escape",
          };
    },
    openExternal: async (url) => opened.push(url),
  });
  const result = await broker.command({ type: "connect", providerId });
  assert.deepEqual(opened, [authorizationUrl]);
  assert.deepEqual(result, { ...status, pending: true });
  assert.equal(JSON.stringify(result).includes(attemptId), false);
  assert.equal(JSON.stringify(result).includes("privateToken"), false);
  assert.deepEqual(
    calls.map((value) => value.input.type),
    ["begin", "finish"],
  );
});

test("renderer URLs, OAuth callbacks, tokens, account IDs and invalid versions are rejected before native calls", async () => {
  let calls = 0;
  const broker = createProviderConnectionBroker({
    call: async () => {
      calls++;
      return status;
    },
    openExternal: async () => {
      throw Error("must not open");
    },
  });
  for (const input of [
    { type: "connect", providerId, authorizationUrl },
    { type: "connect", providerId, attemptId },
    { type: "finish", providerId },
    { type: "status", providerId, accessToken: "synthetic" },
    { type: "disconnect", providerId, expectedVersion: 0 },
    { type: "connect", providerId: "codex-app-server" },
  ])
    await assert.rejects(
      broker.command(input),
      /invalid_provider_connection_request/,
    );
  assert.equal(calls, 0);
});

test("an untrusted browser destination cannot be opened", async () => {
  const opened = [],
    operations = [];
  const broker = createProviderConnectionBroker({
    call: async (_name, input) => {
      operations.push(input.type);
      return input.type === "begin"
        ? {
            attemptId,
            authorizationUrl: "https://example.invalid/steal",
            expiresAt: Date.now() + 60000,
          }
        : status;
    },
    openExternal: async (url) => opened.push(url),
  });
  await assert.rejects(
    broker.command({ type: "connect", providerId }),
    /invalid_native_sign_in_destination/,
  );
  assert.deepEqual(opened, []);
  assert.deepEqual(operations, ["begin", "cancel"]);
});

test("cancel during native preparation prevents the browser from opening and cancels the exact returned attempt", async () => {
  let release;
  const preparing = new Promise((resolve) => {
    release = resolve;
  });
  const opened = [],
    cancellations = [];
  const broker = createProviderConnectionBroker({
    call: async (_name, input) => {
      if (input.type === "begin") return preparing;
      if (input.type === "cancel") cancellations.push(input.attemptId);
      return status;
    },
    openExternal: async (url) => opened.push(url),
  });
  const connect = broker.command({ type: "connect", providerId });
  await broker.command({ type: "cancel", providerId });
  release({ attemptId, authorizationUrl, expiresAt: Date.now() + 60000 });
  await connect;
  assert.deepEqual(opened, []);
  assert.deepEqual(cancellations, [attemptId]);
});
