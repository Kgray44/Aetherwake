import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createProviderConnectionBroker } = require(
  "../native/provider-connections.cjs",
);
const { PRIVATE_MISSION_FILE_EDIT_COMMANDS } = require(
  "../native/mission-file-edit-broker.cjs",
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
const ready = () => ({
  ...status,
  state: "ready",
  registrationVersion: 4,
  planUsageEnabled: true,
});
const attemptId = "65f5dbdd-aefe-434f-879f-480df8f11dbe";
const authorizationUrl =
  "https://auth.openai.com/api/accounts/authorize?state=synthetic&code_challenge=synthetic";
const allowed = { allowed: true };

function createBroker(options) {
  return createProviderConnectionBroker({
    authorize: async (context, binding) =>
      context?.allowed === true ? Object.freeze({ binding }) : null,
    revalidate: async (authority, binding) => authority?.binding === binding,
    reviewDisconnect: async () => true,
    ...options,
  });
}

test("only one authorized connect opens the fixed official URL and keeps private OAuth state native", async () => {
  const calls = [], opened = [];
  let pending = false;
  const broker = createBroker({
    call: async (name, input) => {
      calls.push({ name, input });
      if (input.type === "begin") {
        pending = true;
        return { attemptId, authorizationUrl, expiresAt: Date.now() + 60000 };
      }
      return { ...status, pending, privateToken: "must never escape" };
    },
    openExternal: async (url) => opened.push(url),
  });
  const result = await broker.command({ type: "connect", providerId }, allowed);
  assert.deepEqual(opened, [authorizationUrl]);
  assert.deepEqual(result, { ...status, pending: true });
  assert.equal(JSON.stringify(result).includes(attemptId), false);
  assert.equal(JSON.stringify(result).includes("privateToken"), false);
  assert.deepEqual(
    calls.filter((value) => value.name === "providerAuth").map((value) => value.input.type),
    ["begin", "finish"],
  );
});

test("renderer URLs, callbacks, tokens, account IDs and invalid versions are rejected before native calls", async () => {
  let calls = 0;
  const broker = createBroker({
    call: async () => { calls++; return status; },
    openExternal: async () => assert.fail("must not open"),
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
      broker.command(input, allowed),
      /invalid_provider_connection_request/,
    );
  assert.equal(calls, 0);
});

test("an untrusted browser destination is cancelled without opening", async () => {
  const opened = [], operations = [];
  let pending = false;
  const broker = createBroker({
    call: async (_name, input) => {
      operations.push(input.type);
      if (input.type === "begin") {
        pending = true;
        return {
          attemptId,
          authorizationUrl: "https://example.invalid/steal",
          expiresAt: Date.now() + 60000,
        };
      }
      if (input.type === "cancel") pending = false;
      return { ...status, pending };
    },
    openExternal: async (url) => opened.push(url),
  });
  await assert.rejects(
    broker.command({ type: "connect", providerId }, allowed),
    /invalid_native_sign_in_destination/,
  );
  assert.deepEqual(opened, []);
  assert.deepEqual(operations.filter((type) => ["begin", "cancel"].includes(type)), ["begin", "cancel"]);
});

test("cancel during native preparation prevents browser launch and cancels the exact returned attempt", async () => {
  let release, markBegun, pending = false;
  const preparing = new Promise((resolve) => { release = resolve; });
  const begun = new Promise((resolve) => { markBegun = resolve; });
  const opened = [], cancellations = [];
  const broker = createBroker({
    call: async (_name, input) => {
      if (input.type === "begin") { pending = true; markBegun(); return preparing; }
      if (input.type === "cancel") { cancellations.push(input.attemptId); pending = false; }
      return { ...status, pending };
    },
    openExternal: async (url) => opened.push(url),
  });
  const connect = broker.command({ type: "connect", providerId }, allowed);
  await begun;
  await broker.command({ type: "cancel", providerId }, allowed);
  release({ attemptId, authorizationUrl, expiresAt: Date.now() + 60000 });
  await connect;
  assert.deepEqual(opened, []);
  assert.deepEqual(cancellations, [attemptId]);
});

test("every provider mutation requires a fresh broker authority while status remains passive", async () => {
  const calls = [], reviews = [];
  const broker = createBroker({
    call: async (name, input) => { calls.push({ name, input }); return ready(); },
    openExternal: async () => assert.fail("must not open"),
    authorize: async () => null,
    reviewDisconnect: async () => { reviews.push(true); return true; },
  });
  assert.deepEqual(await broker.command({ type: "status", providerId }), ready());
  for (const input of [
    { type: "connect", providerId },
    { type: "cancel", providerId },
    { type: "refreshModels", providerId },
    { type: "disconnect", providerId, expectedVersion: 4 },
    { type: "refreshSession", providerId, expectedVersion: 4 },
  ])
    await assert.rejects(
      broker.command(input),
      /provider_user_gesture_required/,
    );
  assert.equal(calls.some((entry) => entry.name === "providerAuth"), false);
  assert.deepEqual(reviews, []);
});

test("a version race invalidates the exact operation binding before provider dispatch", async () => {
  let version = 4, binding;
  const calls = [];
  const broker = createBroker({
    call: async (name, input) => {
      calls.push({ name, input });
      return { ...ready(), registrationVersion: version };
    },
    openExternal: async () => assert.fail("must not open"),
    authorize: async (_context, value) => {
      binding = value;
      version = 5;
      return Object.freeze({ binding: value });
    },
  });
  await assert.rejects(
    broker.command({ type: "refreshModels", providerId }, allowed),
    /provider_connection_changed/,
  );
  assert.equal(Object.isFrozen(binding), true);
  assert.deepEqual(
    { type: binding.type, providerId: binding.providerId, connectionVersion: binding.connectionVersion, expectedVersion: binding.expectedVersion },
    { type: "refreshModels", providerId, connectionVersion: 4, expectedVersion: null },
  );
  assert.equal(calls.some((entry) => entry.input.type === "refreshModels"), false);
});

test("disconnect requires native review and revalidation before its exact private effect", async () => {
  let approve = false, reviews = 0, disconnects = 0;
  const broker = createBroker({
    call: async (name, input) => {
      if (name === "providerAuth" && input.type === "disconnect") disconnects++;
      return ready();
    },
    openExternal: async () => assert.fail("must not open"),
    reviewDisconnect: async (_authority, binding, current) => {
      reviews++;
      assert.equal(binding.type, "disconnect");
      assert.equal(binding.expectedVersion, 4);
      assert.equal(current.registrationVersion, 4);
      return approve;
    },
  });
  await broker.command({ type: "disconnect", providerId, expectedVersion: 4 }, allowed);
  assert.equal(disconnects, 0);
  approve = true;
  await broker.command({ type: "disconnect", providerId, expectedVersion: 4 }, allowed);
  assert.equal(disconnects, 1);
  assert.equal(reviews, 2);
});

function preload() {
  let host, click;
  const calls = [];
  const activation = { isActive: true };
  vm.runInNewContext(
    readFileSync(new URL("../native/desktop-preload.cjs", import.meta.url), "utf8"),
    {
      process: { argv: [] },
      navigator: { userActivation: activation },
      addEventListener(name, listener) { if (name === "click") click = listener; },
      require: () => ({
        contextBridge: { exposeInMainWorld(_name, value) { host = value; } },
        ipcRenderer: {
          on() {}, removeListener() {},
          async invoke(...args) { calls.push(args); return { ok: true, result: status }; },
        },
      }),
    },
  );
  return { host, calls, activation, click: (trusted = true) => click({ isTrusted: trusted }) };
}

test("isolated preload spends one trusted click on one exactly bound provider mutation", async () => {
  const fixture = preload();
  await fixture.host.command("providerConnection", { type: "status", providerId });
  await assert.rejects(
    fixture.host.command("providerConnection", { type: "connect", providerId }),
    /provider_user_gesture_required/,
  );
  fixture.click();
  await fixture.host.command("providerConnection", { type: "connect", providerId });
  await assert.rejects(
    fixture.host.command("providerConnection", { type: "refreshModels", providerId }),
    /provider_user_gesture_required/,
  );
  fixture.click(false);
  await assert.rejects(
    fixture.host.command("providerConnection", { type: "refreshModels", providerId }),
    /provider_user_gesture_required/,
  );
  fixture.click();
  await fixture.host.command("providerConnection", { type: "disconnect", providerId, expectedVersion: 4 });
  const connectEnvelope = fixture.calls[1][2];
  assert.deepEqual(
    JSON.parse(JSON.stringify(connectEnvelope.activation)),
    { contract: "aerynth.provider-activation@1", serial: 1, type: "connect", providerId, expectedVersion: null },
  );
  assert.equal(fixture.calls[0][2].activation, null);
  assert.equal(fixture.calls[2][2].activation.serial, 2);
});

function mainBoundary() {
  const source = readFileSync(new URL("../native/desktop-main.cjs", import.meta.url), "utf8");
  const start = source.indexOf('  ipcMain.handle("application-command", async (event, command, input) => {');
  const end = source.indexOf("  const active = () => {", start);
  assert.ok(start >= 0 && end > start);
  let handler, focused = true, active = true, loseFocus = false;
  const dispatched = [], localURL = "file:///synthetic-aerynth/index.html";
  const frame = {
    url: localURL,
    async executeJavaScript() { if (loseFocus) focused = false; return active; },
  };
  const webContents = { mainFrame: frame, isDestroyed: () => false };
  const win = { webContents, isDestroyed: () => false };
  const event = { sender: webContents, senderFrame: frame };
  const providerNativeActivation = { serial: 1, observedAt: performance.now() };
  const context = {
    ipcMain: { handle(_name, callback) { handler = callback; } },
    Buffer,
    performance,
    win,
    localURL,
    PRIVATE_MISSION_FILE_EDIT_COMMANDS,
    providerActivationSerials: new WeakMap(),
    providerNativeActivation,
    consumedProviderNativeActivation: 0,
    trustedActiveFrame: (received) => received === event && focused,
    isConversationRead: () => false,
    isVelaRead: () => false,
    isProductRead: () => false,
    storage: { allowWrite: async () => true },
    providerConnections: {
      async command(input, context) { dispatched.push({ input, context }); return status; },
    },
  };
  vm.runInNewContext(source.slice(start, end), context);
  const envelope = (type, serial, expectedVersion = null) => ({
    contract: "aerynth.provider-command-envelope@1",
    request: { type, providerId, ...(expectedVersion === null ? {} : { expectedVersion }) },
    activation: type === "status" ? null : {
      contract: "aerynth.provider-activation@1", serial, type, providerId, expectedVersion,
    },
  });
  return {
    event,
    dispatched,
    envelope,
    invoke: (input, received = event) => handler(received, "providerConnection", input),
    activate(value) { active = value; },
    loseFocus() { loseFocus = true; },
    nativeActivation(age = 0) {
      providerNativeActivation.serial++;
      providerNativeActivation.observedAt = performance.now() - age;
    },
  };
}

test("actual Main consumes activation before await and rejects replay, stale focus and untrusted frames", async () => {
  const main = mainBoundary();
  assert.equal((await main.invoke(main.envelope("status", 0))).ok, true);
  assert.equal((await main.invoke({ type: "connect", providerId })).error, "invalid_provider_connection_transport");
  assert.equal((await main.invoke({ ...main.envelope("connect", 1), activation: null })).error, "provider_user_gesture_required");
  main.activate(false);
  assert.equal((await main.invoke(main.envelope("connect", 1))).error, "provider_user_gesture_required");
  main.activate(true);
  assert.equal((await main.invoke(main.envelope("connect", 1))).error, "provider_user_gesture_required");
  main.nativeActivation(6000);
  assert.equal((await main.invoke(main.envelope("connect", 2))).error, "provider_user_gesture_required");
  main.nativeActivation();
  assert.equal((await main.invoke(main.envelope("connect", 3))).ok, true);
  assert.equal((await main.invoke(main.envelope("connect", 3))).error, "provider_user_gesture_required");
  main.nativeActivation();
  main.loseFocus();
  assert.equal((await main.invoke(main.envelope("refreshModels", 4))).error, "provider_user_gesture_required");
  assert.equal((await main.invoke(main.envelope("refreshModels", 5), { ...main.event, senderFrame: { ...main.event.senderFrame } })).error, "unauthorized_sender");
  assert.equal(main.dispatched.length, 2);
  assert.equal(main.dispatched[0].input.type, "status");
  assert.equal(main.dispatched[1].input.type, "connect");
  assert.equal(main.dispatched[1].context.observedGesture, true);
});
