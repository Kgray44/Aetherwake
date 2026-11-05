const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const {
  assertOwnedProfile,
  parseCim,
  compareMemory,
  memoryAnswer,
  assertNoProviders,
  validateBudget,
  admitPNG,
  CIM_SCRIPT,
  CLIPBOARD_FIXTURE,
  resourceInformation,
  namedControlScript,
  assertSyntheticClipboard,
  passingCheckpoint,
  nativeHover,
} = require("../native/integration-desktop-basics.cjs");
const { createSlot } = require("../native/integration-resource-opening.cjs");
const GiB = 1073741824,
  MiB = 1024 * 1024;
const measurement = () => ({
  contract: "aerynth.system-memory@1",
  totalBytes: 32 * GiB,
  availableBytes: 14 * GiB,
  usedBytes: 18 * GiB,
  utilizationPercent: 56.25,
  measuredAt: "2026-11-02T12:00:00.000Z",
  source: {
    kind: "node:os",
    api: "totalmem+freemem",
    scope: "host-physical-memory",
    platform: "win32",
  },
  interpretation: {
    available: "windows-available-physical",
    used: "total-minus-available",
    excludes: "process-and-committed-memory",
  },
});

test("message hover uses one actual app-window mouseMove with focus guards and never manufactures activation or a click", () => {
  const events = [];
  let checks = 0;
  const win = {
      webContents: { sendInputEvent: (event) => events.push(event) },
    },
    slot = {
      check() {
        checks++;
      },
    };
  nativeHover(win, slot, { x: 140, y: 220 });
  assert.deepEqual(events, [{ type: "mouseMove", x: 140, y: 220 }]);
  assert.equal(checks, 2);
  assert.throws(() => nativeHover(win, slot, { x: NaN, y: 1 }), /hover_point/);
  assert.throws(
    () =>
      nativeHover(
        win,
        {
          check() {
            throw Error("sticky_focus_lost");
          },
        },
        { x: 1, y: 1 },
      ),
    /sticky_focus_lost/,
  );
  assert.equal(events.length, 1);
  const source = fs.readFileSync(
    require.resolve("../native/integration-desktop-basics.cjs"),
    "utf8",
  );
  const rendered = source.indexOf(
      "Actual canonical conversation message rendered",
    ),
    hover = source.indexOf("await hover(", rendered),
    summary = source.indexOf(".cp-message-actions > summary", rendered);
  assert(hover > rendered && summary > hover);
  assert(
    source.includes("targetScript(query, 'inspect')") ||
      source.includes('targetScript(query, "inspect")'),
  );
  assert(
    !/\.classList\.(?:add|toggle)|style\.opacity\s*=|dispatchEvent\(.*(?:mouseover|mouseenter)/.test(
      source,
    ),
  );
});
const state = () => ({
  identity: { id: "system:vela", name: "Vela", role: "application-assistant" },
  conversation: {
    resourceId: "canonical:vela",
    messages: [
      { id: "m:u", role: "user", content: "What is my current RAM usage?" },
      {
        id: "m:a",
        requestId: "q:1",
        source: "vela-native",
        role: "assistant",
        classification: "observed",
        responseKind: "answer",
        content:
          "Your computer is using 18.00 GiB of 32.00 GiB RAM (56.25%); 14.00 GiB is available. Measured at 2026-11-02T12:00:00.000Z. Used is not Aerynth process memory or committed memory.",
      },
    ],
  },
  requests: [
    {
      id: "q:1",
      inputMessageId: "m:u",
      intent: "What is my current RAM usage?",
      state: "responded",
      providerId: null,
      local: {
        capabilityId: "system.memory",
        providerId: null,
        classification: "observed",
        observedAt: "2026-11-02T12:00:00.000Z",
        facts: { kind: "system-memory", measurement: measurement() },
      },
      response: { messageId: "m:a" },
    },
  ],
  plans: [],
  receipts: [],
  planningReferences: {},
});
const activity = () => ({
  codexConnections: 0,
  providerRequests: 0,
  systemMemoryReads: 1,
  scope: "process-session-native-attempts",
});
const budget = () => ({ count: 0, bytes: 0, files: [] });
const png = (bytes) => {
  const value = Buffer.alloc(bytes);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(value);
  return value;
};

test("only the explicit exact owned C-drive profile/window is eligible; no generic owner profile accepted", () => {
  const root = "C:\\synthetic\\review-desktop-basics-1793000000000";
  assert.doesNotThrow(() =>
    assertOwnedProfile(
      root,
      ["--integration-desktop-basics"],
      "Aerynth Automated check",
    ),
  );
  for (const bad of [
    "review-desktop-basics-1",
    "D:\\review-desktop-basics-1",
    "C:\\review-user-profile",
    "C:\\review-desktop-basics-1\\nested",
    "C:\\review-desktop-basics-1-extra",
    "\\\\host\\review-desktop-basics-1",
  ])
    assert.throws(() =>
      assertOwnedProfile(
        bad,
        ["--integration-desktop-basics"],
        "Automated check",
      ),
    );
  assert.throws(() => assertOwnedProfile(root, [], "Automated check"));
  assert.throws(() =>
    assertOwnedProfile(
      root,
      ["--integration-desktop-basics"],
      "Aerynth owner window",
    ),
  );
});
test("independent fixed CIM query is bounded and projects only physical-memory facts without host/user identity", () => {
  const input = {
      totalVisibleKiB: (32 * GiB) / 1024,
      freePhysicalKiB: (14 * GiB) / 1024,
      observedAt: "2026-11-02T12:00:00.0000000Z",
    },
    value = parseCim(JSON.stringify(input));
  assert.equal(value.totalBytes, 32 * GiB);
  assert.equal(value.availableBytes, 14 * GiB);
  assert.equal(value.usedBytes, 18 * GiB);
  for (const bad of [
    { ...input, freePhysicalKiB: -1 },
    { ...input, totalVisibleKiB: 0 },
    { ...input, totalVisibleKiB: Number.MAX_SAFE_INTEGER },
    { ...input, observedAt: "unknown" },
    { ...input, privateHostName: "SYNTHETIC_NOT_ALLOWED" },
  ])
    assert.throws(() => parseCim(JSON.stringify(bad)));
  assert.throws(() => parseCim(" ".repeat(16385)));
  assert.match(CIM_SCRIPT, /Get-CimInstance -ClassName Win32_OperatingSystem/);
  assert(
    !/UserName|ComputerName|Get-Process|Get-Content|Invoke-Expression/.test(
      CIM_SCRIPT,
    ),
  );
});
test("physical comparisons preserve actual signed deltas/times and enforce the declared tolerances", () => {
  const independent = parseCim(
      JSON.stringify({
        totalVisibleKiB: (32 * GiB) / 1024,
        freePhysicalKiB: (14 * GiB) / 1024 + 2048,
        observedAt: "2026-11-02T11:59:59.000Z",
      }),
    ),
    result = compareMemory(measurement(), independent);
  assert.equal(result.availableDeltaBytes, -2 * MiB);
  assert.equal(result.sampleDeltaMs, 1000);
  assert.equal(result.totalDeltaBytes, 0);
  assert.throws(
    () =>
      compareMemory(measurement(), { ...independent, totalBytes: 64 * GiB }),
    /total_physical_memory_mismatch/,
  );
  assert.throws(
    () => compareMemory(measurement(), { ...independent, availableBytes: 0 }),
    /outside_declared_envelope/,
  );
  assert.throws(
    () =>
      compareMemory(measurement(), {
        ...independent,
        measuredAt: "2026-11-02T10:00:00Z",
      }),
    /too_far_apart/,
  );
});
test("exact canonical memory answer requires actual source/timestamp/numbers and original Vela/message identity", () => {
  const value = memoryAnswer(state());
  assert.equal(value.answerId, "m:a");
  assert.equal(value.conversation.resourceId, "canonical:vela");
  for (const change of [
    (s) => (s.requests[0].providerId = "codex-app-server"),
    (s) =>
      (s.requests[0].local.facts.measurement.source.api =
        "process.memoryUsage"),
    (s) => (s.requests[0].local.facts.measurement.usedBytes = 1),
    (s) => (s.requests[0].local.observedAt = "old"),
    (s) => (s.conversation.messages[1].content = "RAM is fine"),
    (s) => (s.conversation.messages[1].source = "provider"),
    (s) => (s.requests[0].intent = "another question"),
    (s) => (s.requests[0].response.messageId = "missing"),
  ]) {
    const invalid = state();
    change(invalid);
    assert.throws(() => memoryAnswer(invalid));
  }
});
test("zero execution is not inferred as zero connections; actual process-session boundary observations are mandatory", () => {
  const core = { executions: {}, bindings: {}, handoffs: {} },
    events = {
      truncated: false,
      events: [
        {
          type: "stream/reopened",
          nativeSequence: null,
          threadId: null,
          turnId: null,
        },
      ],
    };
  assert.doesNotThrow(() =>
    assertNoProviders(core, state(), events, activity()),
  );
  assert.throws(
    () => assertNoProviders(core, state(), events),
    /observation_required/,
  );
  for (const patch of [
    { codexConnections: 1 },
    { providerRequests: 1 },
    { systemMemoryReads: undefined },
    { scope: "fixture-assumption" },
  ])
    assert.throws(() =>
      assertNoProviders(core, state(), events, { ...activity(), ...patch }),
    );
  assert.throws(() =>
    assertNoProviders(
      core,
      state(),
      { ...events, truncated: true },
      activity(),
    ),
  );
  assert.throws(() =>
    assertNoProviders(
      core,
      state(),
      {
        truncated: false,
        events: [{ type: "provider/response-created", nativeSequence: null }],
      },
      activity(),
    ),
  );
  assert.throws(() =>
    assertNoProviders(
      { ...core, executions: { e: {} } },
      state(),
      events,
      activity(),
    ),
  );
});
test("combined evidence never resets count or bytes between initial and restore and rejects fabricated PNG data", () => {
  const b = budget();
  admitPNG(b, png(32), "initial.png");
  admitPNG(b, png(32), "initial-clipboard.png");
  const restored = validateBudget(JSON.parse(JSON.stringify(b)));
  admitPNG(restored, png(32), "restore.png");
  assert.equal(restored.count, 3);
  assert.throws(() => admitPNG(restored, png(32), "fourth.png"));
  assert.throws(() => admitPNG(budget(), Buffer.from("notpng"), "fake"));
  assert.throws(() => validateBudget({ ...restored, bytes: 1 }));
  const full = budget();
  admitPNG(full, png(16 * MiB), "limit.png");
  assert.throws(() => admitPNG(full, png(32), "over.png"));
});
test("focus loss/deadline are sticky and the 45/12s slots reserve cleanup rather than refocusing", () => {
  let now = 0,
    focused = true;
  const win = {
      isDestroyed: () => false,
      isVisible: () => true,
      isMinimized: () => false,
      isFocused: () => focused,
      webContents: { isDestroyed: () => false },
    },
    slot = createSlot({
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
  now = 0;
  const restore = createSlot({
    win,
    startedAt: 0,
    limitMs: 12000,
    cleanupMs: 2500,
    now: () => now,
  });
  now = 9500;
  assert.throws(() => restore.check());
  assert.equal(restore.remaining(), 2500);
});
test("helper never grants renderer activation; all clipboard reads follow explicit synthetic copying and all seven contexts are required", () => {
  const source = fs.readFileSync(
    require.resolve("../native/integration-desktop-basics.cjs"),
    "utf8",
  );
  assert.match(source, /executeJavaScript\(code, false\)/);
  assert(!/executeJavaScript\([^\n]+, true\)/.test(source));
  assert(
    !/createDriver\(|driver\.js\(|win\.focus\(|webContents\.focus\(|globalShortcut|setCursorPos/.test(
      source,
    ),
  );
  assert.equal(
    (source.match(/clipboard\.readText\(/g) ?? []).length,
    1,
    "one awaited readback boundary, no original clipboard capture",
  );
  assert(
    source.indexOf("clipboardReadback =") >
      source.indexOf("scripted_copy_must_not_gain_activation"),
  );
  assert(
    source.indexOf("await clipboardReadback(context") >
      source.indexOf("Actual copy success for"),
  );
  assert.match(source, /all_seven_clipboard_contexts_required/);
  assert.match(source, /actual-provider|providerActivityInterpretation/);
  assert(!/addMessage.*assistant/.test(source));
  assert.match(source, /desktop-basics-memory-only/);
  assert.match(source, /maxBuffer: 16384/);
  assert.match(source, /Math\.min\(10000, slot\.workRemaining\(\)\)/);
});

test("copy comparison never prints an unexpected clipboard value, and resource information has exactly five canonical lines", () => {
  assert.doesNotThrow(() =>
    assertSyntheticClipboard("SYNTHETIC copy", "SYNTHETIC copy"),
  );
  let message = "";
  try {
    assertSyntheticClipboard("PRIVATE_ORIGINAL_MUST_NOT_LOG", "SYNTHETIC copy");
  } catch (error) {
    message = error.message;
  }
  assert(message.includes("native_clipboard_exact_synthetic_copy_mismatch"));
  assert(!message.includes("PRIVATE_ORIGINAL_MUST_NOT_LOG"));
  assert.equal(
    resourceInformation({
      title: "SYNTHETIC note",
      kind: "note",
      id: "r:canonical",
      version: 3,
      project_id: null,
    }),
    "Title: SYNTHETIC note\nType: note\nResource ID: r:canonical\nVersion: 3\nProject ID: Unassigned",
  );
  assert.equal(
    resourceInformation({
      title: "SYNTHETIC note",
      kind: "note",
      id: "r:canonical",
      version: 4,
      project_id: "p:canonical",
    })
      .split("\n")
      .at(-1),
    "Project ID: p:canonical",
  );
});

test("synthetic URLs match the released normalizer and fenced code keeps CRLF plus final EOL without fake model output", async () => {
  const { sourceLinks } = await import(
    "../../../block-library/source-links.ts"
  );
  assert.deepEqual(sourceLinks(CLIPBOARD_FIXTURE.reference), [
    CLIPBOARD_FIXTURE.referenceURL,
  ]);
  assert.deepEqual(sourceLinks(CLIPBOARD_FIXTURE.research), [
    CLIPBOARD_FIXTURE.researchURL,
  ]);
  assert(CLIPBOARD_FIXTURE.code.endsWith("\r\n"));
  assert(
    CLIPBOARD_FIXTURE.note.includes(
      "```text\r\n" + CLIPBOARD_FIXTURE.code + "```",
    ),
  );
  assert(CLIPBOARD_FIXTURE.message.includes("No provider turn was requested."));
});

test("named target discovery reads actual semantic controls without click, focus, DOM mutation or activation", () => {
  let actions = 0;
  const root = { children: [], querySelectorAll: () => [node] },
    node = {
      parentElement: root,
      tagName: "BUTTON",
      closest: () => null,
      getClientRects: () => [{}],
      getAttribute: () => "Copy link",
      textContent: "Copy link",
      click() {
        actions++;
      },
      focus() {
        actions++;
      },
    };
  root.children = [node];
  const result = vm.runInNewContext(
    namedControlScript("#actual", "Copy link"),
    { document: { querySelector: () => root } },
  );
  assert.equal(result, "#actual > button:nth-of-type(1)");
  assert.equal(actions, 0);
});

test("restore requires the exact original passing scoped receipt; a failed/partial/late-aborted run cannot qualify a checkpoint", () => {
  const checkpoint = {
    contract: "aerynth.desktop-basics-checkpoint@1",
    scope: "all-seven-clipboard-contexts-and-memory",
    source: { hashes: { a: "synthetic" }, buildAssets: { b: "synthetic" } },
    helperSha256: "synthetic-helper",
    memory: { id: "actual-canonical-fixture" },
  };
  const initial = {
    contract: "aerynth.desktop-basics-integration@1",
    restore: false,
    passed: true,
    nativeCloseConfirmed: true,
    scope: checkpoint.scope,
    source: checkpoint.source,
    helperSha256: checkpoint.helperSha256,
    memory: checkpoint.memory,
    coverage: {
      clipboardContexts: Object.fromEntries(
        [
          "reference-link",
          "research-link",
          "conversation-message",
          "code-block",
          "note-text",
          "resource-info",
          "selected-text",
        ].map((k) => [k, "actual-observed"]),
      ),
    },
  };
  assert.doesNotThrow(() => passingCheckpoint(checkpoint, initial));
  for (const change of [
    (v) => (v.passed = false),
    (v) => (v.restore = true),
    (v) => (v.nativeCloseConfirmed = false),
    (v) => (v.scope = "memory-only"),
    (v) => (v.helperSha256 = "another-source"),
    (v) => (v.coverage.clipboardContexts["research-link"] = "unverified"),
  ]) {
    const invalid = structuredClone(initial);
    change(invalid);
    assert.throws(() => passingCheckpoint(checkpoint, invalid));
  }
  const source = fs.readFileSync(
    require.resolve("../native/integration-desktop-basics.cjs"),
    "utf8",
  );
  assert(
    source.lastIndexOf('win.removeListener("blur"') >
      source.lastIndexOf('call("close"'),
  );
  assert(source.includes("passingCheckpoint(expected"));
  assert(!source.includes('rpc("executionStatus"'));
});
