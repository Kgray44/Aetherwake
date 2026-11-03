const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const {
  assertOwnedProfile,
  assertProfile,
  assertEffective,
  persistentEffective,
  assertNoExecution,
  assertNoPlacements,
  passingCheckpoint,
  FIXTURE,
  fillNative,
} = require("../native/integration-agents.cjs");
const { createSlot } = require("../native/integration-resource-opening.cjs");
const vm = require("node:vm");
const {
  validateBudget,
  admitPNG,
} = require("../native/integration-desktop-basics.cjs");
const fields = [
  "providerId",
  "modelId",
  "reasoningEffort",
  "additionalInstructions",
  "requiredCapabilities",
];
const profile = () => ({
  contract: "aerynth.agent-library@1",
  ref: { resourceId: "synthetic-agent", profileVersion: 4, resourceVersion: 4 },
  resource: {
    id: "synthetic-agent",
    kind: "agent",
    title: FIXTURE.revised,
    projectId: null,
    version: 4,
    state: "active",
  },
  profile: {
    purpose: FIXTURE.researchPurpose,
    specialties: ["evidence", "synthesis"],
    settings: Object.fromEntries(
      fields.map((key) => [key, { source: "inherit" }]),
    ),
  },
});
const configuration = (p) => ({
  agent: p.ref,
  projectId: null,
  policyVersion: "synthetic-policy",
  catalogRevision: "unobserved",
  catalogDigest: "a".repeat(64),
  settings: {
    providerId: null,
    modelId: null,
    reasoningEffort: null,
    additionalInstructions: "",
    requiredCapabilities: [],
  },
  origins: Object.fromEntries(
    fields.map((key) => [
      key,
      { scope: "global", id: null, version: "global:1" },
    ]),
  ),
  configurationState: "needs-setup",
  reasons: ["provider-or-model-not-configured"],
  verification: "catalog-only",
  digest: "b".repeat(64),
});
const core = () => ({
    executions: {},
    bindings: {},
    handoffs: {},
    graph: { messages: [], conversations: [] },
  }),
  events = () => ({
    truncated: false,
    events: [
      {
        type: "stream/reopened",
        nativeSequence: null,
        threadId: null,
        turnId: null,
      },
    ],
  }),
  counters = () => ({
    scope: "process-session-native-attempts",
    codexConnections: 0,
    providerRequests: 0,
    systemMemoryReads: 0,
  });
const desktop = () => ({
  projects: [],
  workspaces: [],
  blocks: [],
  resources: [{ id: "synthetic-agent", kind: "agent" }],
  navigationBlocks: [],
});

test("native fill waits for asynchronously delivered focus and full selection before exact text acceptance", async () => {
  const old = { value: "Previous title" }, target = { value: "Previous purpose", selectionStart: 4, selectionEnd: 4 }, events = [];
  let active = old, focusPending = false, selectionPending = false;
  const document = { querySelector: () => target, get activeElement() { return active; } };
  await fillNative({
    async click() { events.push("click-posted"); focusPending = true; },
    key(key, modifiers) { assert.equal(active, target); assert.equal(key, "A"); assert.deepEqual(modifiers, ["control"]); events.push("select-posted"); selectionPending = true; },
    async js(code) { return vm.runInNewContext(code, { document }); },
    async wait(label, check) {
      if (focusPending || selectionPending) assert.equal(await check(), false, "posted native input has not been delivered yet");
      if (focusPending) { active = target; focusPending = false; events.push("focus-observed"); }
      if (selectionPending) { target.selectionStart = 0; target.selectionEnd = target.value.length; selectionPending = false; events.push("selection-observed"); }
      assert.equal(await check(), true, label);
    },
    async insertText(text) { assert.equal(active, target); assert.equal(target.selectionStart, 0); assert.equal(target.selectionEnd, target.value.length); events.push("insert"); target.value = text; },
  }, "#purpose", "Exact new purpose");
  assert.deepEqual(events, ["click-posted", "focus-observed", "select-posted", "selection-observed", "insert"]);
  assert.equal(old.value, "Previous title"); assert.equal(target.value, "Exact new purpose");
});

test("native fill refuses to type if actual focus or exact text acknowledgement is missing", async () => {
  let keys = 0, inserts = 0;
  await assert.rejects(fillNative({ click: async () => {}, key() { keys++; }, js: async () => false, wait: async (_label, check) => { assert.equal(await check(), false); throw Error("focus_not_delivered"); }, insertText: async () => { inserts++; } }, "#purpose", "text"), /focus_not_delivered/);
  assert.equal(keys, 0); assert.equal(inserts, 0);
  let reads = 0;
  await assert.rejects(fillNative({ click: async () => {}, key() {}, js: async () => ++reads <= 2, wait: async (_label, check) => { if (!await check()) throw Error("text_not_accepted"); }, insertText: async () => {} }, "#purpose", "text"), /text_not_accepted/);
});

test("native Agent Library profile/flag/window admission rejects real or reused unrelated profile names", () => {
  const root = "C:\\synthetic\\review-agents-1793000000000";
  assert.doesNotThrow(() =>
    assertOwnedProfile(
      root,
      ["--integration-agents"],
      "Aerynth Automated check",
    ),
  );
  for (const bad of [
    "review-agents-1",
    "D:\\review-agents-1",
    "C:\\review-user-profile",
    "C:\\review-agents-1\\nested",
    "C:\\review-agents-1-extra",
    "\\\\host\\review-agents-1",
  ])
    assert.throws(() =>
      assertOwnedProfile(bad, ["--integration-agents"], "Automated check"),
    );
  assert.throws(() => assertOwnedProfile(root, [], "Automated check"));
  assert.throws(() =>
    assertOwnedProfile(root, ["--integration-agents"], "Aerynth user window"),
  );
});
test("canonical agent identity includes both exact version fences and a real agent resource without project imitation", () => {
  assert.equal(assertProfile(profile()).ref.profileVersion, 4);
  for (const change of [
    (p) => (p.resource.kind = "note"),
    (p) => (p.resource.id = "copy"),
    (p) => p.ref.resourceVersion++,
    (p) => (p.ref.profileVersion = 0),
    (p) => (p.resource.projectId = "invented-project"),
    (p) => (p.profile.settings.modelId.source = "assumed"),
  ]) {
    const p = profile();
    change(p);
    assert.throws(() => assertProfile(p));
  }
});
test("effective settings distinguish inherited/global from explicit profile overrides and never promote absent catalog to support", () => {
  const p = profile(),
    e = configuration(p);
  assert.doesNotThrow(() => assertEffective(e, p, null));
  const supported = { ...e, configurationState: "supported" };
  assert.throws(() => assertEffective(supported, p, null));
  assert.throws(() =>
    assertEffective({ ...e, verification: "execution-verified" }, p, null),
  );
  p.profile.settings.additionalInstructions = {
    source: "override",
    value: FIXTURE.instructions,
  };
  const override = configuration(p);
  override.origins.additionalInstructions = {
    scope: "profile",
    id: p.resource.id,
    version: "4",
  };
  override.settings.additionalInstructions = FIXTURE.instructions;
  assert.doesNotThrow(() => assertEffective(override, p, null));
  override.origins.additionalInstructions.id = "another-agent";
  assert.throws(() => assertEffective(override, p, null));
});
test("restart compares durable settings/origins and profile refs while current catalog/setup observations remain explicit", () => {
  const p = profile(),
    a = configuration(p),
    b = configuration(p);
  b.catalogRevision = "new-process-cache";
  b.catalogDigest = "c".repeat(64);
  b.configurationState = "unknown";
  b.reasons = ["provider-capability-unknown"];
  b.digest = "d".repeat(64);
  assert.deepEqual(persistentEffective(a), persistentEffective(b));
  b.settings.additionalInstructions = "unapproved change";
  assert.notDeepEqual(persistentEffective(a), persistentEffective(b));
  assert.equal(a.settings.additionalInstructions, "");
  assert(!Object.hasOwn(persistentEffective(a), "catalogDigest"));
});
test("no runner/provider/chat activity is inferred from profiles; actual complete event coverage and zero boundary counts are mandatory", () => {
  assert.doesNotThrow(() => assertNoExecution(core(), events(), counters()));
  for (const key of [
    "codexConnections",
    "providerRequests",
    "systemMemoryReads",
  ])
    assert.throws(() =>
      assertNoExecution(core(), events(), { ...counters(), [key]: 1 }),
    );
  assert.throws(() => assertNoExecution(core(), events()));
  const chat = core();
  chat.graph.conversations.push({ id: "fake-chat" });
  assert.throws(() => assertNoExecution(chat, events(), counters()));
  const exec = core();
  exec.executions.e = { state: "running" };
  assert.throws(() => assertNoExecution(exec, events(), counters()));
  assert.throws(() =>
    assertNoExecution(core(), { ...events(), truncated: true }, counters()),
  );
  assert.throws(() =>
    assertNoExecution(
      core(),
      {
        truncated: false,
        events: [{ type: "execution/running", nativeSequence: null }],
      },
      counters(),
    ),
  );
});
test("Agent Library cannot qualify by creating a workspace, placement, note placeholder, task or extra resource", () => {
  assert.doesNotThrow(() => assertNoPlacements(desktop()));
  for (const change of [
    (d) => d.projects.push({ id: "p" }),
    (d) => d.workspaces.push({ id: "w" }),
    (d) => d.blocks.push({ id: "b" }),
    (d) => d.navigationBlocks.push({ id: "b" }),
    (d) => (d.resources[0].kind = "note"),
    (d) => (d.resources[0].kind = "task"),
    (d) => d.resources.push(...Array.from({ length: 11 }, () => ({ kind: "agent" }))),
  ]) {
    const d = desktop();
    change(d);
    assert.throws(() => assertNoPlacements(d));
  }
});
test("same-source restart requires the original passing receipt and preserves profile canonical data exactly", () => {
  const checkpoint = {
    contract: "aerynth.agents-checkpoint@1",
    source: { hashes: { a: "synthetic" }, buildAssets: { b: "synthetic" } },
    moduleHashes: { helper: "synthetic-hash" },
    canonical: { profiles: [profile()] },
  };
  const initial = {
    contract: "aerynth.agents-integration@1",
    restore: false,
    passed: true,
    nativeCloseConfirmed: true,
    source: checkpoint.source,
    moduleHashes: checkpoint.moduleHashes,
    canonical: checkpoint.canonical,
  };
  assert.doesNotThrow(() => passingCheckpoint(checkpoint, initial));
  for (const change of [
    (x) => (x.passed = false),
    (x) => (x.restore = true),
    (x) => (x.nativeCloseConfirmed = false),
    (x) => (x.moduleHashes.helper = "other-source"),
    (x) => (x.canonical.profiles[0].resource.id = "copy"),
  ]) {
    const invalid = structuredClone(initial);
    change(invalid);
    assert.throws(() => passingCheckpoint(checkpoint, invalid));
  }
});
test("45/12-second slots include cleanup and never recover from focus loss; combined screenshots cannot reset on restore", () => {
  let now = 0,
    focused = true;
  const win = {
    isDestroyed: () => false,
    isVisible: () => true,
    isMinimized: () => false,
    isFocused: () => focused,
    webContents: { isDestroyed: () => false },
  };
  const slot = createSlot({
    win,
    startedAt: 0,
    limitMs: 45000,
    cleanupMs: 4000,
    now: () => now,
  });
  focused = false;
  assert.throws(() => slot.check());
  focused = true;
  assert.throws(() => slot.check());
  const short = createSlot({
    win,
    startedAt: 0,
    limitMs: 12000,
    cleanupMs: 2500,
    now: () => now,
  });
  now = 9500;
  assert.throws(() => short.check());
  assert.equal(short.remaining(), 2500);
  const b = { count: 0, bytes: 0, files: [] },
    png = Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      Buffer.alloc(8),
    ]);
  admitPNG(b, png, "initial-a");
  admitPNG(b, png, "initial-b");
  const restored = validateBudget(JSON.parse(JSON.stringify(b)));
  admitPNG(restored, png, "restore");
  assert.throws(() => admitPNG(restored, png, "extra"));
});
test("helper mutates only through actual UI and uses false renderer evaluations without launch/refocus/hooks or provider probes", () => {
  const source = fs.readFileSync(
    require.resolve("../native/integration-agents.cjs"),
    "utf8",
  );
  assert(source.includes("executeJavaScript(code, false)"));
  assert(
    !/executeJavaScript\([^\n]+, true\)|createDriver\(|driver\.js\(|win\.focus\(|webContents\.focus\(|globalShortcut|setCursorPos/.test(
      source,
    ),
  );
  assert(!/agents\(['"](?:create|update|archive)['"]/.test(source));
  assert(source.includes("agents_ui_mutations_only"));
  assert(!source.includes("window.__aerynth.execute("));
  assert(source.includes("window.__aerynth.openResource("));
  const remove = source.match(/win\.removeListener\(["']blur["']/),
    close = source.match(/call\(["']close["']/);
  assert(remove.index > close.index);
  assert(
    source.includes("current") || source.includes("effectiveObservations"),
  );
});
