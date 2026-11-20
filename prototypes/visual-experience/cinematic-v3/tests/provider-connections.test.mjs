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
  return {
    host, calls, activation,
    click(trusted = true) {
      const event = { isTrusted: trusted, eventPhase: 2 };
      click(event);
      return () => { event.eventPhase = 0; };
    },
  };
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
  fixture.click()();
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
  let handler, brokerOptions, focused = true, active = true, writeAllowed = true;
  let observeBlink = () => {};
  let now = 10000;
  const winEvents = new Map(), ownerEvents = new Map();
  const dispatched = [], localURL = "file:///synthetic-aerynth/index.html";
  const frame = {
    url: localURL,
    async executeJavaScript(_source, userGesture) {
      assert.equal(userGesture, false);
      await observeBlink();
      return active;
    },
  };
  const webContents = {
    mainFrame: frame, isDestroyed: () => false, getURL: () => localURL,
    on: (name, listener) => ownerEvents.set(name, listener),
  };
  const win = {
    webContents, isDestroyed: () => false, isVisible: () => true,
    isMinimized: () => false, isFocused: () => focused,
    on: (name, listener) => winEvents.set(name, listener),
  };
  const event = { sender: webContents, senderFrame: frame };
  const call = async () => assert.fail("unexpected core call");
  const shell = { openExternal: () => assert.fail("unexpected browser launch") };
  const reviews = [];
  let response = 0;
  const blur = () => { focused = false; winEvents.get("blur")(); };
  const context = {
    ipcMain: { handle(_name, callback) { handler = callback; } },
    Buffer,
    performance: { now: () => now },
    win,
    owner: webContents,
    localURL,
    PRIVATE_MISSION_FILE_EDIT_COMMANDS,
    backendWritable: () => true,
    closing: false,
    call,
    shell,
    sendMissionHostSignal: () => {},
    checkDesktopTest: () => {},
    dialog: {
      async showMessageBox(parent, options) {
        assert.equal(parent, win);
        reviews.push(options);
        return { response };
      },
    },
    createProviderConnectionBroker: (options) => {
      brokerOptions = options;
      return {
        async command(input, authority) { dispatched.push({ input, authority }); return status; },
      };
    },
    isConversationRead: () => false,
    isVelaRead: () => false,
    isProductRead: () => false,
    storage: { allowWrite: async () => writeAllowed },
    providerConnections: null,
  };
  const mainBlock = (from, to) => {
    const offset = source.indexOf(from);
    const limit = source.indexOf(to, offset);
    assert.ok(offset >= 0 && limit > offset);
    return source.slice(offset, limit);
  };
  vm.runInNewContext([
    mainBlock("  let lastMissionActivity", "  const mediaOwnerAlive"),
    mainBlock("  const trustedApplicationFrame", "  const policyReady"),
    source.slice(start, end),
  ].join("\n"), context);
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
    brokerOptions,
    reviews,
    envelope,
    invoke: (input, received = event) => handler(received, "providerConnection", input),
    invokePrivate: () => handler(event, "providerAuth", { type: "status" }),
    activate(value) { active = value; },
    beforeBlink(callback) { observeBlink = callback; },
    blur,
    focus() { focused = true; },
    denyWrites() { writeAllowed = false; },
    reviewResponse(value) { response = value; },
    reload() { ownerEvents.get("did-start-navigation")({ isMainFrame: true, isSameDocument: false }); },
    nativeActivation(age = 0) {
      ownerEvents.get("before-mouse-event")(null, { type: "mouseDown", button: "left" });
      now += age;
    },
  };
}

test("actual Main consumes activation before await and rejects replay, stale focus and untrusted frames", async () => {
  const main = mainBoundary();
  assert.equal((await main.invoke(main.envelope("status", 0))).ok, true);
  assert.equal((await main.invokePrivate()).error, "unauthorized_private_command");
  assert.equal((await main.invoke({ type: "connect", providerId })).error, "invalid_provider_connection_transport");
  assert.equal((await main.invoke({ ...main.envelope("connect", 1), activation: null })).error, "provider_user_gesture_required");
  main.nativeActivation();
  const disconnect = main.envelope("disconnect", 1, 4);
  disconnect.activation.expectedVersion = 5;
  assert.equal((await main.invoke(disconnect)).error, "provider_user_gesture_required");
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
  main.beforeBlink(main.blur);
  assert.equal((await main.invoke(main.envelope("refreshModels", 4))).error, "provider_user_gesture_required");
  assert.equal((await main.invoke(main.envelope("refreshModels", 5), { ...main.event, senderFrame: { ...main.event.senderFrame } })).error, "unauthorized_sender");
  assert.equal(main.dispatched.length, 2);
  assert.equal(main.dispatched[0].input.type, "status");
  assert.equal(main.dispatched[1].input.type, "connect");
  assert.equal(main.dispatched[1].authority.type, "connect");
});

test("a pending native claim keeps its own activation and cannot borrow freshness from later input", async () => {
  const main = mainBoundary();
  let release;
  const blink = new Promise(resolve => { release = resolve; });
  main.beforeBlink(() => blink);
  main.nativeActivation();
  const first = main.invoke(main.envelope("connect", 1));
  const second = await main.invoke(main.envelope("refreshModels", 2));
  assert.equal(second.error, "provider_user_gesture_required");
  main.nativeActivation(6000);
  main.nativeActivation();
  release();
  assert.equal((await first).error, "provider_user_gesture_required");
  assert.equal((await main.invoke(main.envelope("refreshModels", 2))).ok, true);
  assert.deepEqual(main.dispatched.map(({ input }) => input.type), ["refreshModels"]);
});

test("native disconnect review defaults to keeping the connection and stays bound to the reviewed version", async () => {
  const main = mainBoundary();
  main.nativeActivation();
  assert.equal((await main.invoke(main.envelope("disconnect", 1, 4))).ok, true);
  const context = main.dispatched[0].authority;
  const binding = Object.freeze({ type: "disconnect", providerId, expectedVersion: 4 });
  const { authorize, revalidate, reviewDisconnect } = main.brokerOptions;
  assert.equal(authorize(context, { ...binding, expectedVersion: 5 }), null);
  assert.equal(authorize(context, { ...binding, type: "refreshSession" }), null);
  const authority = authorize(context, binding);
  assert.ok(authority);
  assert.equal(authorize(context, binding), null);
  assert.equal(await reviewDisconnect(authority, binding, ready()), false);
  assert.equal(main.reviews[0].defaultId, 0);
  assert.equal(main.reviews[0].cancelId, 0);
  assert.match(main.reviews[0].detail, /Connection version: 4/);
  await assert.rejects(reviewDisconnect(authority, binding, { ...ready(), registrationVersion: 5 }), /provider_connection_changed/);
  main.reviewResponse(1);
  assert.equal(await reviewDisconnect(authority, binding, ready()), true);
  main.blur();
  assert.equal(await revalidate(authority, binding, { phase: "after-review" }), false);
  assert.equal(await revalidate(authority, binding, { phase: "after-external" }), false);
  main.focus();
  assert.equal(await revalidate(authority, binding, { phase: "after-review" }), true);
  main.denyWrites();
  assert.equal(await revalidate(authority, binding, { phase: "after-review" }), false);
  assert.equal((await main.invoke(main.envelope("status", 0))).ok, true);
});

test("only an existing connect authority allows the external-browser handoff without focus", async () => {
  const main = mainBoundary();
  main.nativeActivation();
  assert.equal((await main.invoke(main.envelope("connect", 1))).ok, true);
  const binding = { type: "connect", providerId, expectedVersion: null };
  const { authorize, revalidate } = main.brokerOptions;
  const authority = authorize(main.dispatched[0].authority, binding);
  assert.ok(authority);
  main.blur();
  assert.equal(await revalidate(authority, binding), false);
  assert.equal(await revalidate(authority, binding, { phase: "after-external" }), true);
  main.focus();
  main.reload();
  assert.equal(await revalidate(authority, binding, { phase: "after-external" }), false);
  main.nativeActivation();
  assert.equal((await main.invoke(main.envelope("connect", 1))).ok, true);
});

test("a version change during native review prevents the confirmed disconnect", async () => {
  let version = 4;
  const broker = createBroker({
    call: async (name, input) => {
      assert.equal(name, "providerConnection");
      assert.equal(input.type, "status");
      return { ...ready(), registrationVersion: version };
    },
    openExternal: async () => assert.fail("unexpected browser launch"),
    reviewDisconnect: async () => { version = 5; return true; },
  });
  await assert.rejects(
    broker.command({ type: "disconnect", providerId, expectedVersion: 4 }, allowed),
    /provider_connection_changed/,
  );
});
