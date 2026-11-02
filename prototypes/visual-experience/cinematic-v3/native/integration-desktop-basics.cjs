/* Actual owned desktop acceptance; no launch, OS hooks, refocus or provider.
 * --integration-desktop-basics --profile=<absolute review-desktop-basics-DIGITS>
 * --desktop-basics-memory-only explicitly qualifies RAM + copy-denial preflight
 * ONLY. Default full mode also verifies all seven released clipboard contexts.
 * --verify-restore reuses that exact profile/source/assets; no RAM resampling.
 * All renderer evaluation is executeJavaScript(code, FALSE), including reads.
 * App-window sendInputEvent is software native-window input, not OS physical.
 */
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { performance } = require("node:perf_hooks");
const {
  createSlot,
  targetScript,
  waitForCondition,
  sourceIdentity,
} = require("./integration-resource-opening.cjs");
const MiB = 1024 * 1024;
const QUESTION = "What is my current RAM usage?";
const CONTEXTS = [
  "reference-link",
  "research-link",
  "conversation-message",
  "code-block",
  "note-text",
  "resource-info",
  "selected-text",
];
const CLIPBOARD_FIXTURE = {
  noteTitle: "SYNTHETIC native clipboard note",
  referenceTitle: "SYNTHETIC native clipboard reference",
  researchTitle: "SYNTHETIC native clipboard research",
  code: "SYNTHETIC code Ω\r\nreturn 'clipboard';\r\n",
  note: "SYNTHETIC_SELECTION\r\nNative clipboard note Ω 🚀.\r\n```text\r\nSYNTHETIC code Ω\r\nreturn 'clipboard';\r\n```\r\n",
  editedNote:
    "SYNTHETIC_SELECTION\nExact current editor text Ω 🚀.\nUnsent text must copy exactly.\n",
  reference:
    "Synthetic source only: https://EXAMPLE.COM:443/native-clipboard/reference?marker=SYNTHETIC#source.\n",
  referenceURL:
    "https://example.com/native-clipboard/reference?marker=SYNTHETIC#source",
  research:
    "Synthetic research only: https://EXAMPLE.ORG:443/research?q=SYNTHETIC%20only.\n",
  researchURL: "https://example.org/research?q=SYNTHETIC%20only",
  message:
    "SYNTHETIC desktop clipboard message Ω 🚀\nNo provider turn was requested.",
  selected: "SYNTHETIC_SELECTION",
};
function resourceInformation(resource) {
  return `Title: ${resource.title}\nType: ${resource.kind}\nResource ID: ${resource.id}\nVersion: ${resource.version}\nProject ID: ${resource.project_id ?? "Unassigned"}`;
}
function namedControlScript(scope, label) {
  return `(()=>{const root=document.querySelector(${JSON.stringify(scope)});if(!root)return null;const node=[...root.querySelectorAll('button')].find(n=>!n.closest('[hidden],[inert]')&&n.getClientRects().length&&(n.getAttribute('aria-label')===${JSON.stringify(label)}||n.textContent.trim()===${JSON.stringify(label)}));if(!node)return null;const parts=[];for(let n=node;n!==root;n=n.parentElement){const peers=[...n.parentElement.children].filter(p=>p.tagName===n.tagName);parts.unshift(n.tagName.toLowerCase()+':nth-of-type('+(peers.indexOf(n)+1)+')')}return ${JSON.stringify(scope)}+' > '+parts.join(' > ')})()`;
}
function assertSyntheticClipboard(actual, expected) {
  assert(
    typeof actual === "string" && actual === expected,
    "native_clipboard_exact_synthetic_copy_mismatch",
  );
}
function nativeHover(win, slot, point) {
  slot.check();
  assert(
    Number.isSafeInteger(point?.x) &&
      point.x >= 0 &&
      Number.isSafeInteger(point?.y) &&
      point.y >= 0,
    "visible_native_hover_point_required",
  );
  // Movement alone does not click, focus, select or grant transient activation.
  win.webContents.sendInputEvent({ type: "mouseMove", x: point.x, y: point.y });
  slot.check();
}
function passingCheckpoint(checkpoint, initial) {
  assert(
    checkpoint?.contract === "aerynth.desktop-basics-checkpoint@1" &&
      initial?.contract === "aerynth.desktop-basics-integration@1" &&
      initial.passed === true &&
      initial.restore === false &&
      initial.nativeCloseConfirmed === true &&
      initial.scope === checkpoint.scope,
    "original_passing_receipt_required",
  );
  assert.deepEqual(sourceIdentity(initial.source), checkpoint.source);
  assert.equal(initial.helperSha256, checkpoint.helperSha256);
  assert.deepEqual(initial.memory, checkpoint.memory);
  if (checkpoint.scope === "all-seven-clipboard-contexts-and-memory")
    assert(
      CONTEXTS.every(
        (key) =>
          typeof initial.coverage?.clipboardContexts?.[key] === "string" &&
          initial.coverage.clipboardContexts[key] !== "unverified",
      ),
      "original_seven_context_receipt_required",
    );
}
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const encode = (value) => {
  const text = JSON.stringify(value, null, 2);
  assert(Buffer.byteLength(text) <= MiB, "desktop_basics_receipt_capacity");
  return text;
};
const CIM_SCRIPT =
  "$ErrorActionPreference='Stop';$m=Get-CimInstance -ClassName Win32_OperatingSystem;[pscustomobject]@{totalVisibleKiB=[double]$m.TotalVisibleMemorySize;freePhysicalKiB=[double]$m.FreePhysicalMemory;observedAt=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json -Compress";
function assertOwnedProfile(root, argv, title) {
  assert(
    argv.includes("--integration-desktop-basics"),
    "explicit_desktop_basics_flag_required",
  );
  assert(
    typeof root === "string" &&
      path.win32.isAbsolute(root) &&
      path.win32.parse(root).root.toLowerCase() === "c:\\" &&
      /^review-desktop-basics-\d+$/.test(path.win32.basename(root)),
    "fresh_owned_desktop_basics_profile_required",
  );
  assert.match(title, /Automated check/i, "owned_automated_window_required");
}
function parseCim(text) {
  assert(
    typeof text === "string" && Buffer.byteLength(text) <= 16384,
    "bounded_cim_output_required",
  );
  const v = JSON.parse(text.trim());
  assert(
    v &&
      Object.keys(v).sort().join(",") ===
        "freePhysicalKiB,observedAt,totalVisibleKiB" &&
      Number.isSafeInteger(v.totalVisibleKiB) &&
      v.totalVisibleKiB > 0 &&
      Number.isSafeInteger(v.freePhysicalKiB) &&
      v.freePhysicalKiB >= 0 &&
      v.freePhysicalKiB <= v.totalVisibleKiB &&
      typeof v.observedAt === "string" &&
      v.observedAt.length <= 64 &&
      Number.isFinite(Date.parse(v.observedAt)),
    "invalid_cim_memory",
  );
  const totalBytes = v.totalVisibleKiB * 1024,
    availableBytes = v.freePhysicalKiB * 1024;
  assert(
    Number.isSafeInteger(totalBytes) && Number.isSafeInteger(availableBytes),
    "invalid_cim_capacity",
  );
  return {
    totalBytes,
    availableBytes,
    usedBytes: totalBytes - availableBytes,
    measuredAt: v.observedAt,
    source:
      "Windows CIM Win32_OperatingSystem.TotalVisibleMemorySize/FreePhysicalMemory; KiB ×1024; independent of Node reader",
  };
}
function validateMemory(v) {
  assert(
    v?.contract === "aerynth.system-memory@1" &&
      Number.isSafeInteger(v.totalBytes) &&
      v.totalBytes > 0 &&
      Number.isSafeInteger(v.availableBytes) &&
      v.availableBytes >= 0 &&
      v.availableBytes <= v.totalBytes &&
      v.usedBytes === v.totalBytes - v.availableBytes &&
      Number.isFinite(v.utilizationPercent) &&
      v.utilizationPercent ===
        Math.round((v.usedBytes / v.totalBytes) * 10000) / 100 &&
      typeof v.measuredAt === "string" &&
      Number.isFinite(Date.parse(v.measuredAt)),
    "invalid_actual_memory",
  );
  assert.deepEqual(v.source, {
    kind: "node:os",
    api: "totalmem+freemem",
    scope: "host-physical-memory",
    platform: "win32",
  });
  assert.deepEqual(v.interpretation, {
    available: "windows-available-physical",
    used: "total-minus-available",
    excludes: "process-and-committed-memory",
  });
  return v;
}
function compareMemory(actual, independent) {
  validateMemory(actual);
  const totalDeltaBytes = actual.totalBytes - independent.totalBytes,
    availableDeltaBytes = actual.availableBytes - independent.availableBytes,
    sampleDeltaMs =
      Date.parse(actual.measuredAt) - Date.parse(independent.measuredAt);
  assert(
    Math.abs(totalDeltaBytes) <= MiB,
    "independent_total_physical_memory_mismatch",
  );
  // Separate non-atomic live observations can vary while the desktop operates.
  // This envelope is declared in advance; actual deltas/times remain evidence.
  const availableEnvelopeBytes = Math.max(256 * MiB, actual.totalBytes * 0.05);
  assert(
    Math.abs(sampleDeltaMs) <= 20000,
    "independent_memory_sample_too_far_apart",
  );
  assert(
    Math.abs(availableDeltaBytes) <= availableEnvelopeBytes,
    "independent_available_memory_outside_declared_envelope",
  );
  return {
    totalDeltaBytes,
    availableDeltaBytes,
    usedDeltaBytes: actual.usedBytes - independent.usedBytes,
    sampleDeltaMs,
    availableEnvelopeBytes,
    totalToleranceBytes: MiB,
    definition:
      "Available physical RAM is distinct from committed/virtual memory and Aerynth process RSS. Adjacent Node/CIM samples are not atomic or a continuous monitor.",
  };
}
function assertNoProviders(core, vela, events, activity) {
  assert.equal(
    Object.keys(core.executions).length,
    0,
    "provider_executions_forbidden",
  );
  assert.equal(
    Object.keys(core.bindings).length,
    0,
    "native_provider_bindings_forbidden",
  );
  assert.equal(
    Object.keys(core.handoffs).length,
    0,
    "provider_handoffs_forbidden",
  );
  assert.equal(vela.plans.length, 0);
  assert.equal(vela.receipts.length, 0);
  assert.deepEqual(vela.planningReferences ?? {}, {});
  assert(
    !vela.conversation?.messages.some(
      (m) => m.source === "provider" || m.providerId || m.providerContribution,
    ),
    "provider_contribution_forbidden",
  );
  assert.equal(events.truncated, false, "provider_event_coverage_incomplete");
  assert(
    !events.events.some(
      (e) =>
        e.nativeSequence !== null ||
        e.threadId ||
        e.turnId ||
        /^(?:provider\/|execution\/|item\/|turn\/|thread\/)/.test(e.type),
    ),
    "provider_events_forbidden",
  );
  assert(
    activity &&
      Number.isSafeInteger(activity.codexConnections) &&
      Number.isSafeInteger(activity.providerRequests),
    "actual_provider_activity_observation_required",
  );
  assert.equal(activity.scope, "process-session-native-attempts");
  assert(
    Number.isSafeInteger(activity.systemMemoryReads) &&
      activity.systemMemoryReads >= 0,
    "actual_memory_reader_observation_required",
  );
  assert.equal(
    activity.codexConnections,
    0,
    "provider_connection_attempt_forbidden",
  );
  assert.equal(
    activity.providerRequests,
    0,
    "provider_request_attempt_forbidden",
  );
}
function memoryAnswer(state) {
  assert.deepEqual(state.identity, {
    id: "system:vela",
    name: "Vela",
    role: "application-assistant",
  });
  assert(
    state.conversation?.resourceId && state.conversation.messages.length === 2,
    "one_canonical_vela_pair_required",
  );
  assert.equal(state.requests.length, 1);
  const request = state.requests[0],
    local = request.local,
    input = state.conversation.messages.find(
      (m) => m.id === request.inputMessageId,
    ),
    answer = state.conversation.messages.find(
      (m) => m.id === request.response?.messageId,
    );
  assert.equal(request.intent, QUESTION);
  assert.equal(request.state, "responded");
  assert.equal(request.providerId, null);
  assert.equal(local?.capabilityId, "system.memory");
  assert.equal(local.providerId, null);
  assert.equal(local.classification, "observed");
  assert.equal(local.facts.kind, "system-memory");
  const measurement = validateMemory(local.facts.measurement);
  assert.equal(local.observedAt, measurement.measuredAt);
  assert.equal(input?.content, QUESTION);
  assert.equal(input.role, "user");
  assert.equal(answer?.source, "vela-native");
  assert.equal(answer.classification, "observed");
  assert.equal(answer.responseKind, "answer");
  assert.equal(answer.requestId, request.id);
  assert(
    answer.content.includes(measurement.measuredAt) &&
      answer.content.includes(
        measurement.utilizationPercent.toFixed(2) + "%",
      ) &&
      answer.content.includes("not Aerynth process memory or committed memory"),
    "canonical_memory_answer_must_explain_actual_facts",
  );
  assert(
    answer.content.includes(
      `${(measurement.usedBytes / 1073741824).toFixed(2)} GiB of ${(measurement.totalBytes / 1073741824).toFixed(2)} GiB RAM`,
    ) &&
      answer.content.includes(
        `${(measurement.availableBytes / 1073741824).toFixed(2)} GiB is available`,
      ),
    "canonical_memory_numeric_answer_mismatch",
  );
  return {
    identity: state.identity,
    conversation: state.conversation,
    requests: state.requests,
    measurement,
    answerId: answer.id,
    answer: answer.content,
    requestId: request.id,
  };
}
function validateBudget(budget) {
  assert(
    budget &&
      Number.isSafeInteger(budget.count) &&
      budget.count >= 0 &&
      budget.count <= 3 &&
      Number.isSafeInteger(budget.bytes) &&
      budget.bytes >= 0 &&
      budget.bytes <= 16 * MiB &&
      Array.isArray(budget.files) &&
      budget.files.length === budget.count &&
      budget.files.every(
        (f) =>
          typeof f.file === "string" &&
          f.file.length <= 2048 &&
          Number.isSafeInteger(f.bytes) &&
          f.bytes > 0 &&
          /^[a-f0-9]{64}$/.test(f.sha256),
      ) &&
      new Set(budget.files.map((f) => f.file)).size === budget.count &&
      budget.files.reduce((n, f) => n + f.bytes, 0) === budget.bytes,
    "invalid_desktop_basics_capture_budget",
  );
  return budget;
}
function admitPNG(budget, png, file) {
  validateBudget(budget);
  assert(
    Buffer.isBuffer(png) &&
      png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    "actual_png_required",
  );
  assert(
    budget.count < 3 &&
      budget.bytes + png.length <= 16 * MiB &&
      !budget.files.some((f) => f.file === file),
    "desktop_basics_capture_budget_exceeded",
  );
  const item = { file, bytes: png.length, sha256: hash(png) };
  budget.count++;
  budget.bytes += png.length;
  budget.files.push(item);
  return item;
}
async function bounded(promise, ms, code) {
  assert(ms > 0, code);
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error(code)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function readJson(file) {
  assert(
    (await fs.stat(file)).size <= MiB,
    "bounded_owned_checkpoint_required",
  );
  return JSON.parse(await fs.readFile(file, "utf8"));
}
exports.assertOwnedProfile = assertOwnedProfile;
exports.parseCim = parseCim;
exports.compareMemory = compareMemory;
exports.memoryAnswer = memoryAnswer;
exports.assertNoProviders = assertNoProviders;
exports.validateBudget = validateBudget;
exports.admitPNG = admitPNG;
exports.CIM_SCRIPT = CIM_SCRIPT;
exports.CLIPBOARD_FIXTURE = CLIPBOARD_FIXTURE;
exports.resourceInformation = resourceInformation;
exports.namedControlScript = namedControlScript;
exports.assertSyntheticClipboard = assertSyntheticClipboard;
exports.passingCheckpoint = passingCheckpoint;
exports.nativeHover = nativeHover;

exports.verify = async function verify({
  win,
  app,
  privateRoot,
  call,
  source,
  startupErrors = [],
  moduleStartedMonotonicMs,
  clipboard,
  observeProviderActivity,
}) {
  const restore = process.argv.includes("--verify-restore"),
    memoryOnly = process.argv.includes("--desktop-basics-memory-only"),
    limitMs = restore ? 12000 : 45000,
    root = path.resolve(privateRoot),
    out = path.join(
      root,
      "desktop-basics-evidence",
      `${restore ? "restore" : "initial"}-${Date.now()}`,
    ),
    expectedFile = path.join(root, "desktop-basics-expected.json"),
    budgetFile = path.join(root, "desktop-basics-capture-budget.json");
  const receipt = {
    contract: "aerynth.desktop-basics-integration@1",
    restore,
    scope: memoryOnly
      ? "memory-and-scripted-copy-denial-only"
      : "all-seven-clipboard-contexts-and-memory",
    passed: false,
    source,
    actions: [],
    captures: [],
    errors: [],
    coverage: {
      memory: "unverified",
      clipboardPreflight: "unverified",
      clipboardContexts: Object.fromEntries(
        CONTEXTS.map((k) => [k, "unverified"]),
      ),
    },
    limits: {
      milliseconds: limitMs,
      combinedPNGs: 3,
      combinedPNGBytes: 16 * MiB,
    },
    limitations: [
      "Software native-window sendInputEvent is not physical OS input.",
      "Independent CIM and Node readings have different timestamps and can vary; raw definitions/deltas are retained privately.",
      "No original clipboard is read or logged. Completed synthetic-copy phases leave the last explicit synthetic value in the clipboard.",
      "Root caller must independently confirm process/window/backend exit.",
      "A memory-only checkpoint does not close the clipboard defect or full owner P0 acceptance.",
    ],
  };
  let owned = false,
    admitted = false,
    budgetWritable = false,
    passed = false,
    slot,
    expected,
    pendingExpected,
    workTimer,
    hardTimer,
    budget = { count: 0, bytes: 0, files: [] },
    rejectAbort;
  const aborted = new Promise((_, reject) => {
    rejectAbort = reject;
  });
  aborted.catch(() => {});
  const abort = (code) => rejectAbort(slot?.abort(code) ?? Error(code));
  const blur = () => abort("desktop_basics_focus_lost"),
    escape = (_e, input) => {
      if (input?.type === "keyDown" && input.key === "Escape")
        abort("desktop_basics_operator_escape");
    },
    consoleError = (_e, d) => {
      if (
        (d?.level === "error" || d?.level === 3) &&
        receipt.errors.length < 24
      )
        receipt.errors.push(String(d.message).slice(0, 1000));
    };
  const run = async () => {
    assertOwnedProfile(privateRoot, process.argv, win.getTitle());
    sourceIdentity(source);
    owned = true;
    slot = createSlot({
      win,
      startedAt: moduleStartedMonotonicMs,
      limitMs,
      cleanupMs: restore ? 2500 : 4000,
    });
    slot.check();
    hardTimer = setTimeout(() => {
      receipt.hardDeadline = true;
      abort("desktop_basics_hard_deadline");
      app.exit(1);
    }, slot.remaining());
    workTimer = setTimeout(
      () => abort("desktop_basics_work_deadline"),
      slot.workRemaining(),
    );
    win.on("blur", blur);
    win.on("hide", blur);
    win.on("minimize", blur);
    win.webContents.on("before-input-event", escape);
    win.webContents.on("console-message", consoleError);
    receipt.reserve = JSON.parse(
      execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-File",
          path.join(
            process.env.LOCALAPPDATA || "",
            "AeroStorageWatch",
            "ReserveGuard.ps1",
          ),
          "-EstimatedCBytes",
          String(32 * MiB),
          "-EstimatedDBytes",
          "0",
        ],
        {
          windowsHide: true,
          timeout: Math.min(4000, slot.workRemaining()),
          maxBuffer: 8192,
          encoding: "utf8",
        },
      ),
    );
    assert.equal(receipt.reserve.allowed, true);
    admitted = true;
    slot.check();
    if (restore) {
      expected = await readJson(expectedFile);
      assert.equal(expected.contract, "aerynth.desktop-basics-checkpoint@1");
      assert.equal(expected.scope, receipt.scope);
      assert.deepEqual(expected.source, sourceIdentity(source));
      assert(
        typeof expected.initialReceipt === "string" &&
          expected.initialReceipt.length <= 512,
        "original_receipt_path_required",
      );
      const originalReceipt = path.resolve(root, expected.initialReceipt),
        relative = path.relative(root, originalReceipt);
      assert(
        relative && !relative.startsWith("..") && !path.isAbsolute(relative),
        "owned_original_receipt_required",
      );
      passingCheckpoint(expected, await readJson(originalReceipt));
      budget = validateBudget(await readJson(budgetFile));
      budgetWritable = true;
    } else {
      await assert.rejects(fs.stat(expectedFile), { code: "ENOENT" });
      await assert.rejects(fs.stat(budgetFile), { code: "ENOENT" });
      budgetWritable = true;
    }
    await fs.mkdir(out, { recursive: true });
    receipt.helperSha256 = hash(await fs.readFile(__filename));
    if (restore) assert.equal(receipt.helperSha256, expected.helperSha256);
    receipt.assets = {};
    for (const [name, digest] of Object.entries(source.buildAssets)) {
      assert(path.basename(name) === name, "bounded_build_asset_name");
      const actual = hash(
        await fs.readFile(path.join(__dirname, "../dist/assets", name)),
      );
      assert.equal(actual, digest);
      receipt.assets[name] = actual;
    }
    // Deliberately no createDriver: its legacy js wrapper grants userGesture=true.
    const js = async (code) => {
      slot.check();
      const value = await bounded(
        win.webContents.executeJavaScript(code, false),
        slot.workRemaining(),
        "desktop_basics_renderer_deadline",
      );
      slot.check();
      return value;
    };
    const rpc = async (name, input) => {
      assert(
        [
          "vela",
          "snapshot",
          "replay",
          "desktop",
          "notes",
          "conversation",
        ].includes(name),
        "desktop_basics_readonly_rpc_required",
      );
      if (name === "vela") assert.equal(input.name, "state");
      if (name === "desktop") assert.equal(input.type, "snapshot");
      if (name === "notes") assert.equal(input.name, "readNote");
      if (name === "conversation")
        assert(["detail", "readDraft"].includes(input.name));
      slot.check();
      const value = await bounded(
        call(name, input),
        slot.workRemaining(),
        "desktop_basics_read_deadline",
      );
      slot.check();
      return value;
    };
    const wait = (label, check) =>
      waitForCondition({
        slot,
        label,
        check,
        diagnose: () =>
          js(
            "({status:document.querySelector('.vela-core-status')?.textContent,requestState:document.querySelector('.vela-core-status')?.dataset.requestState,answer:document.querySelector('.vela-manifestation')?.dataset.currentMessageId,copy:[...document.querySelectorAll('.aw-note-copy-status,.cp-chat-status')].filter(n=>n.getClientRects().length).map(n=>n.textContent),documents:[...document.querySelectorAll('.aw-note-status')].filter(n=>n.getClientRects().length).map(n=>n.textContent)})",
          ),
      });
    const click = async (query) => {
      await js(
        `document.querySelector(${JSON.stringify(query)})?.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'})`,
      );
      let previous, point;
      await wait("Stable actual input target " + query, async () => {
        const v = await js(targetScript(query, "inspect"));
        if (!v.ready) return false;
        point = {
          x: Math.round(v.rect.x + v.rect.width / 2),
          y: Math.round(v.rect.y + v.rect.height / 2),
        };
        const stable =
          previous &&
          Math.abs(previous.x - point.x) < 1 &&
          Math.abs(previous.y - point.y) < 1;
        previous = point;
        return stable;
      });
      receipt.actions.push({
        method: "software-native-window-mouse",
        selector: query,
      });
      for (const type of ["mouseMove", "mouseDown", "mouseUp"]) {
        slot.check();
        win.webContents.sendInputEvent({
          type,
          ...point,
          button: "left",
          clickCount: 1,
        });
      }
    };
    const hover = async (query) => {
      await js(
        `document.querySelector(${JSON.stringify(query)})?.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'})`,
      );
      let point;
      await wait("Visible actual message hover target " + query, async () => {
        const value = await js(targetScript(query, "inspect"));
        if (!value.ready) return false;
        point = {
          x: Math.round(value.rect.x + value.rect.width / 2),
          y: Math.round(value.rect.y + value.rect.height / 2),
        };
        return true;
      });
      nativeHover(win, slot, point);
      receipt.actions.push({
        method: "software-native-window-hover",
        selector: query,
      });
    };
    const key = (keyCode, modifiers = []) => {
      for (const type of ["keyDown", "keyUp"]) {
        slot.check();
        win.webContents.sendInputEvent({ type, keyCode, modifiers });
      }
    };
    const fill = async (query, text) => {
      await click(query);
      key("A", ["control"]);
      await bounded(
        win.webContents.insertText(text),
        slot.workRemaining(),
        "desktop_basics_text_input_deadline",
      );
      slot.check();
      receipt.actions.push({
        method: "software-native-window-insertText",
        selector: query,
        characters: text.length,
      });
    };
    const snapshot = () =>
      js(
        "(()=>{const s=window.__aerynth.snapshot();return{frames:s.gpu?.framesRendered,draws:s.metrics.draws,active:s.active,failed:s.graphicsFailed,lost:s.gpu?.contextLost,errors:s.metrics.errors}})()",
      );
    const capture = async (name) => {
      const before = await snapshot();
      await wait(
        "Positive focus and newly advancing actual GPU draw",
        async () => {
          const after = await snapshot();
          return (
            after.active === true &&
            after.failed === false &&
            after.lost === false &&
            after.errors.length === 0 &&
            after.frames > before.frames &&
            after.draws > before.draws
          );
        },
      );
      slot.check();
      const png = (
        await bounded(
          win.webContents.capturePage(),
          slot.workRemaining(),
          "desktop_basics_capture_deadline",
        )
      ).toPNG();
      slot.check();
      const file = path.join(out, name + ".png");
      const item = admitPNG(budget, png, file);
      await fs.writeFile(file, png, { flag: "wx" });
      receipt.captures.push({
        ...item,
        focused: true,
        before,
        after: await snapshot(),
      });
      await fs.writeFile(budgetFile, encode(budget));
    };
    const readProof = async () => {
      const core = await rpc("snapshot", {}),
        vela = await rpc("vela", { name: "state", input: {} }),
        events = await rpc("replay", { after: 0 });
      assert.deepEqual(
        await js("window.aerynthHost.command('executionStatus',{})"),
        [],
      );
      assert.equal(
        typeof observeProviderActivity,
        "function",
        "actual_provider_activity_observation_required",
      );
      const activity = await bounded(
        observeProviderActivity(),
        slot.workRemaining(),
        "desktop_basics_activity_deadline",
      );
      assertNoProviders(core, vela, events, activity);
      return { core, vela, activity };
    };
    await wait("Actual app hydration", () =>
      js("document.body.dataset.applicationHydrated==='true'"),
    );
    // This is the first clipboard operation and precedes every native click/key.
    const preflight = await js(
      "(async()=>{const before=navigator.userActivation?.isActive;if(before!==false)throw Error('fresh_inactive_activation_required');if(typeof window.aerynthHost?.copyText!=='function')throw Error('native_copy_capability_unavailable');const result=await window.aerynthHost.copyText('AERYNTH SYNTHETIC DENIED SCRIPT COPY');return{before,result,after:navigator.userActivation.isActive}})()",
    );
    assert.equal(preflight.before, false);
    assert.equal(preflight.result?.contract, "aerynth.clipboard@1");
    assert.equal(
      preflight.result.status,
      "denied",
      "scripted_copy_must_not_gain_activation",
    );
    receipt.clipboardPreflight = preflight;
    receipt.coverage.clipboardPreflight =
      "actual-script-denial-without-fabricated-activation";
    const before = await readProof();
    if (!restore)
      assert.equal(
        before.vela.requests.length,
        0,
        "fresh_unseeded_vela_required",
      );
    let independent;
    if (!restore) {
      const t0 = performance.now();
      independent = parseCim(
        execFileSync(
          "powershell.exe",
          ["-NoProfile", "-NonInteractive", "-Command", CIM_SCRIPT],
          {
            windowsHide: true,
            timeout: Math.min(10000, slot.workRemaining()),
            maxBuffer: 16384,
            encoding: "utf8",
          },
        ),
      );
      receipt.independentMemory = {
        ...independent,
        elapsedMs: performance.now() - t0,
      };
      slot.check();
    }
    await click("#vela");
    await wait("Actual Vela composer", () =>
      js(
        "!!document.querySelector('[data-surface-id=vela] .vela-core-compose textarea')",
      ),
    );
    let memory;
    if (restore) {
      memory = memoryAnswer((await readProof()).vela);
      assert.deepEqual(memory, expected.memory);
      assert.deepEqual((await rpc("snapshot", {})).graph, expected.graph);
    } else {
      const startedAt = Date.now();
      await fill(
        "[data-surface-id=vela] .vela-core-compose textarea",
        QUESTION,
      );
      await click('[data-surface-id=vela] button[aria-label="Send to Vela"]');
      await wait("Canonical native RAM answer", async () => {
        const state = await rpc("vela", { name: "state", input: {} });
        if (
          !state.requests.some(
            (r) => r.intent === QUESTION && r.state === "responded",
          )
        )
          return false;
        memory = memoryAnswer(state);
        return true;
      });
      assert(
        Date.parse(memory.measurement.measuredAt) >= startedAt - 1000 &&
          Date.parse(memory.measurement.measuredAt) <= Date.now() + 1000,
        "actual_request_measurement_timestamp_required",
      );
      receipt.memoryComparison = compareMemory(memory.measurement, independent);
    }
    await wait(
      "Canonical answer actually rendered, not just backend completion",
      () =>
        js(
          `(()=>{const m=document.querySelector('.vela-manifestation'),body=m?.querySelector('.vela-manifestation-content');return m?.dataset.requestId===${JSON.stringify(memory.requestId)}&&m.dataset.currentMessageId===${JSON.stringify(memory.answerId)}&&!m.hidden&&body?.textContent===${JSON.stringify(memory.answer)}&&document.querySelector('.vela-core-status')?.dataset.requestState==='responded'})()`,
        ),
    );
    const proof = await readProof();
    receipt.providerActivity = proof.activity;
    assert.equal(
      proof.activity.systemMemoryReads,
      restore ? 0 : 1,
      "native_memory_reader_exact_call_count",
    );
    receipt.memory = memory;
    receipt.coverage.memory = restore
      ? "exact-canonical-restart-no-submission"
      : "actual-native-answer-and-independent-CIM";
    receipt.providerActivityInterpretation =
      "Registered native/provider boundary invocation attempts in this process session; not remote success or a global network monitor.";
    await capture(restore ? "02-memory-restored" : "01-native-memory-answer");
    let finalProof = proof,
      clipboardFixture;
    if (!memoryOnly) {
      assert(
        clipboard && typeof clipboard.readText === "function",
        "trusted_test_clipboard_reader_required",
      );
      receipt.clipboardCopies = [];
      receipt.clipboardInputBoundary =
        "Every Copy uses software native-window sendInputEvent; all inspection executeJavaScript calls use false. Main readback is awaited only after that explicit synthetic copy. No original clipboard is read or retained.";
      await click("[data-surface-id=vela] .aw-contextual-dismiss");
      await wait("Vela closes through actual shared surface motion", () =>
        js("!document.querySelector('[data-surface-id=vela]')"),
      );
      const named = async (scope, label) => {
        let query;
        await wait("Actual released " + label, async () => {
          query = await js(namedControlScript(scope, label));
          return !!query;
        });
        return query;
      };
      const openResource = async (id) => {
        receipt.actions.push({
          method: "canonical-App-direct-open",
          resourceId: id,
        });
        const result = await js(
          `window.__aerynth.openResource(${JSON.stringify({ resourceId: id, origin: { source: "application" } })})`,
        );
        assert.equal(result.status, "ready");
        assert.equal(result.resourceId, id);
      };
      const noteScope = (id) =>
        `.aw-direct-resource[data-resource-id=${JSON.stringify(id)}]`;
      const clipboardReadback = async (context, expectedText, resourceId) => {
        let matched = false;
        await wait(
          "Exact synthetic native clipboard readback: " + context,
          async () => {
            slot.check();
            const actual = await bounded(
              clipboard.readText(),
              slot.workRemaining(),
              "native_clipboard_readback_deadline",
            );
            slot.check();
            matched = typeof actual === "string" && actual === expectedText;
            return matched;
          },
        );
        assert(matched, "native_clipboard_exact_synthetic_copy_mismatch");
        receipt.clipboardCopies.push({
          context,
          resourceId,
          text: expectedText,
          bytes: Buffer.byteLength(expectedText),
          sha256: hash(expectedText),
          at: new Date().toISOString(),
          evidence:
            "Exact awaited Electron Main clipboard.readText after this explicit synthetic native-window copy",
        });
        receipt.lastSyntheticClipboard = expectedText;
      };
      const copy = async (
        context,
        scope,
        label,
        expectedText,
        success,
        resourceId,
        statusSelector = ".aw-note-copy-status",
      ) => {
        await click(await named(scope, label));
        await wait("Actual copy success for " + context, () =>
          js(
            `document.querySelector(${JSON.stringify(scope)})?.querySelector(${JSON.stringify(statusSelector)})?.textContent===${JSON.stringify(success)}`,
          ),
        );
        await clipboardReadback(context, expectedText, resourceId);
        assert(
          !(await js(
            `document.querySelector(${JSON.stringify(scope)})?.querySelector('.aw-note-status')?.textContent.includes('Save failed')??false`,
          )),
          "copy_must_not_be_document_save_failure",
        );
      };
      const noteDocument = async (id) =>
        (await rpc("notes", { name: "readNote", input: id })).result;
      const chatDocument = async (id) => {
        const detail = await rpc("conversation", {
          name: "detail",
          input: { resourceId: id },
        });
        assert.equal(
          detail.conversation.providerId,
          "local",
          "fresh_manual_chat_must_stay_true_local",
        );
        return {
          conversation: detail.conversation,
          messages: detail.messages.items,
          draft: await rpc("conversation", {
            name: "readDraft",
            input: { resourceId: id },
          }),
        };
      };
      const canonicalClipboard = async (fixture) => {
        await js("window.__aerynth.flush()");
        const desktop = await rpc("desktop", { type: "snapshot" });
        assert(
          desktop.resources.length <= 5 &&
            desktop.blocks.length === 0 &&
            desktop.workspaces.length === 0 &&
            desktop.projects.length === 0,
          "bounded_unplaced_clipboard_fixture_required",
        );
        const documents = {};
        for (const id of [
          fixture.noteId,
          fixture.referenceId,
          fixture.researchId,
        ])
          documents[id] = await noteDocument(id);
        return {
          documents,
          chat: await chatDocument(fixture.chatId),
          resourceIds: desktop.resources.map((r) => r.id).sort(),
        };
      };
      const actionsMenu = async (scope) => {
        if (
          !(await js(
            `document.querySelector(${JSON.stringify(scope)})?.querySelector('.aw-note-actions')?.open`,
          ))
        )
          await click(scope + " .aw-note-actions > summary");
      };
      const selectedPrefix = async (scope, text) => {
        const query = scope + " textarea.aw-direct-editor";
        await click(query);
        key("Home", ["control"]);
        for (let i = 0; i < text.length; i++) key("Right", ["shift"]);
        assert.equal(
          await js(
            `(()=>{const e=document.querySelector(${JSON.stringify(query)});return e.value.slice(e.selectionStart,e.selectionEnd)})()`,
          ),
          text,
        );
      };
      if (restore) {
        clipboardFixture = expected.clipboardFixture;
        assert(
          clipboardFixture?.canonical,
          "passing_clipboard_checkpoint_required",
        );
        const actual = await canonicalClipboard(clipboardFixture);
        assert.deepEqual(
          actual,
          clipboardFixture.canonical,
          "exact_clipboard_resources_notes_recovery_chat_ids_after_restart",
        );
        await openResource(clipboardFixture.noteId);
        const scope = noteScope(clipboardFixture.noteId);
        await wait("Restored current note text", () =>
          js(
            `document.querySelector(${JSON.stringify(scope + " textarea.aw-direct-editor")})?.value===${JSON.stringify(CLIPBOARD_FIXTURE.editedNote)}`,
          ),
        );
        await actionsMenu(scope);
        await copy(
          "note-text-restored",
          scope,
          "Copy text",
          CLIPBOARD_FIXTURE.editedNote,
          "Text copied.",
          clipboardFixture.noteId,
        );
        await openResource(clipboardFixture.chatId);
        await wait("Exact restored canonical user message", () =>
          js(
            `document.querySelector(${JSON.stringify(`.cp-chat[data-resource-id=${JSON.stringify(clipboardFixture.chatId)}] .cp-message[data-message-id=${JSON.stringify(clipboardFixture.messageId)}] .cp-message-content`)})?.textContent===${JSON.stringify(CLIPBOARD_FIXTURE.message)}`,
          ),
        );
        assert.deepEqual(
          await canonicalClipboard(clipboardFixture),
          clipboardFixture.canonical,
          "restore_open_copy_reads_do_not_edit_or_replay",
        );
        for (const context of CONTEXTS)
          receipt.coverage.clipboardContexts[context] =
            "initial-passing-receipt-and-exact-canonical-restart";
      } else {
        const appFixture = async (command) => {
          receipt.actions.push({
            method: "explicit-synthetic-canonical-App-fixture",
            type: command.type,
            kind: command.kind,
            resourceId: command.resourceId,
          });
          await js(`window.__aerynth.execute(${JSON.stringify(command)})`);
        };
        const createDocument = async (kind, title, content) => {
          const beforeIds = new Set(
            (await rpc("desktop", { type: "snapshot" })).resources.map(
              (r) => r.id,
            ),
          );
          await appFixture({
            type: "createResource",
            kind,
            title,
            workspaceId: null,
          });
          const created = (
            await rpc("desktop", { type: "snapshot" })
          ).resources.filter((r) => !beforeIds.has(r.id));
          assert.equal(created.length, 1);
          const resource = created[0];
          assert.equal(resource.kind, kind);
          await appFixture({
            type: "content",
            resourceId: resource.id,
            content,
            expectedVersion: resource.version,
          });
          assert.equal(
            (await noteDocument(resource.id)).resource.content,
            content,
          );
          return resource.id;
        };
        const referenceId = await createDocument(
            "reference",
            CLIPBOARD_FIXTURE.referenceTitle,
            CLIPBOARD_FIXTURE.reference,
          ),
          researchId = await createDocument(
            "research",
            CLIPBOARD_FIXTURE.researchTitle,
            CLIPBOARD_FIXTURE.research,
          ),
          noteId = await createDocument(
            "note",
            CLIPBOARD_FIXTURE.noteTitle,
            CLIPBOARD_FIXTURE.note,
          );
        for (const [context, id, url] of [
          ["reference-link", referenceId, CLIPBOARD_FIXTURE.referenceURL],
          ["research-link", researchId, CLIPBOARD_FIXTURE.researchURL],
        ]) {
          await openResource(id);
          const scope = noteScope(id);
          await copy(
            context,
            scope,
            "Copy link",
            url,
            "Source link copied.",
            id,
          );
          receipt.coverage.clipboardContexts[context] =
            "actual-native-input-exact-OS-readback";
        }
        await openResource(noteId);
        const scope = noteScope(noteId);
        await click(await named(scope, "Read document"));
        await copy(
          "code-block",
          scope,
          "Copy code",
          CLIPBOARD_FIXTURE.code,
          "Code copied.",
          noteId,
        );
        receipt.coverage.clipboardContexts["code-block"] =
          "actual-Note-fenced-code-body-CRLF-and-final-EOL-native-copy";
        receipt.conversationCodeCopy =
          "Unverified separately: no fake assistant/model response was injected to manufacture a CP Markdown code block.";
        await click(await named(scope, "Edit document"));
        await fill(
          scope + " textarea.aw-direct-editor",
          CLIPBOARD_FIXTURE.editedNote,
        );
        assert.equal(
          await js(
            `document.querySelector(${JSON.stringify(scope + " textarea.aw-direct-editor")}).value`,
          ),
          CLIPBOARD_FIXTURE.editedNote,
        );
        await actionsMenu(scope);
        await copy(
          "note-text",
          scope,
          "Copy text",
          CLIPBOARD_FIXTURE.editedNote,
          "Text copied.",
          noteId,
        );
        receipt.coverage.clipboardContexts["note-text"] =
          "actual-current-editor-native-copy";
        await selectedPrefix(scope, CLIPBOARD_FIXTURE.selected);
        await actionsMenu(scope);
        await copy(
          "note-selection-button",
          scope,
          "Copy selection",
          CLIPBOARD_FIXTURE.selected,
          "Selected text copied.",
          noteId,
        );
        await js("window.__aerynth.flush()");
        const document = await noteDocument(noteId);
        await actionsMenu(scope);
        await copy(
          "resource-info",
          scope,
          "Copy resource information",
          resourceInformation(document.resource),
          "Resource information copied.",
          noteId,
        );
        receipt.coverage.clipboardContexts["resource-info"] =
          "actual-canonical-five-line-resource-information-native-copy";
        await selectedPrefix(scope, CLIPBOARD_FIXTURE.selected);
        key("C", ["control"]);
        receipt.actions.push({
          method: "software-native-window-keyboard-Ctrl+C",
          resourceId: noteId,
          selectionCharacters: CLIPBOARD_FIXTURE.selected.length,
        });
        await clipboardReadback(
          "selected-text",
          CLIPBOARD_FIXTURE.selected,
          noteId,
        );
        receipt.coverage.clipboardContexts["selected-text"] =
          "actual-textarea-native-selection-and-Ctrl+C-no-global-hook";
        const chatIds = new Set(
          (await rpc("snapshot", {})).conversations.map((c) => c.resourceId),
        );
        await click("#application-new-chat");
        let chatId;
        await wait("Actual title-optional local New chat", async () => {
          const next = (await rpc("snapshot", {})).conversations.filter(
            (c) => !chatIds.has(c.resourceId),
          );
          if (!next.length) return false;
          assert.equal(next.length, 1);
          assert.equal(next[0].providerId, "local");
          chatId = next[0].resourceId;
          return true;
        });
        const chatScope = `.cp-chat[data-resource-id=${JSON.stringify(chatId)}]`;
        await fill(
          chatScope + " .cp-composer textarea",
          CLIPBOARD_FIXTURE.message,
        );
        await click(chatScope + ' button[aria-label="Send message"]');
        let chat;
        await wait(
          "Durable exact user message without a provider turn",
          async () => {
            chat = await chatDocument(chatId);
            return (
              chat.messages.length === 1 &&
              chat.messages[0].role === "user" &&
              chat.messages[0].content === CLIPBOARD_FIXTURE.message &&
              chat.draft.content === ""
            );
          },
        );
        const messageId = chat.messages[0].id;
        await wait("Actual canonical conversation message rendered", () =>
          js(
            `document.querySelector(${JSON.stringify(chatScope + ` .cp-message[data-message-id=${JSON.stringify(messageId)}] .cp-message-content`)})?.textContent===${JSON.stringify(CLIPBOARD_FIXTURE.message)}`,
          ),
        );
        await hover(
          chatScope +
            ` .cp-message[data-message-id=${JSON.stringify(messageId)}] .cp-message-content`,
        );
        await click(
          chatScope +
            ` .cp-message[data-message-id=${JSON.stringify(messageId)}] .cp-message-actions > summary`,
        );
        await copy(
          "conversation-message",
          chatScope,
          "Copy",
          CLIPBOARD_FIXTURE.message,
          "Copied",
          chatId,
          ".cp-chat-status",
        );
        receipt.coverage.clipboardContexts["conversation-message"] =
          "actual-user-Send-and-message-Copy-native-readback-no-model";
        clipboardFixture = {
          noteId,
          referenceId,
          researchId,
          chatId,
          messageId,
        };
        clipboardFixture.canonical = await canonicalClipboard(clipboardFixture);
        assert(
          Object.values(receipt.coverage.clipboardContexts).every(
            (v) => v !== "unverified",
          ),
          "all_seven_clipboard_contexts_required",
        );
        await capture("03-native-clipboard-copy");
      }
      finalProof = await readProof();
      assert.equal(finalProof.activity.systemMemoryReads, restore ? 0 : 1);
      receipt.providerActivity = finalProof.activity;
      receipt.clipboardDisposition =
        "Left the last explicitly copied synthetic value shown in lastSyntheticClipboard; no original user clipboard read, log or restore.";
    }
    assert.equal(startupErrors.length, 0);
    assert.equal(receipt.errors.length, 0);
    slot.check();
    passed = true;
    if (!restore)
      pendingExpected = {
        contract: "aerynth.desktop-basics-checkpoint@1",
        scope: receipt.scope,
        source: sourceIdentity(source),
        helperSha256: receipt.helperSha256,
        initialReceipt: path.relative(root, path.join(out, "journey.json")),
        memory,
        graph: finalProof.core.graph,
        ...(clipboardFixture ? { clipboardFixture } : {}),
      };
  };
  try {
    await Promise.race([run(), aborted]);
  } catch (error) {
    receipt.error = {
      message: String(error.message).slice(0, 1000),
      ...(error.diagnostics ? { diagnostics: error.diagnostics } : {}),
    };
  } finally {
    clearTimeout(workTimer);
    try {
      if (!owned) {
        console.log(
          JSON.stringify({
            passed: false,
            error: receipt.error?.message,
            cleanup: "Unowned window/profile: no control or writes",
          }),
        );
        return receipt;
      }
      try {
        assert.equal(
          await bounded(
            call("close", {}),
            Math.min(1500, slot?.remaining() ?? 1500),
            "desktop_basics_close_deadline",
          ),
          null,
        );
        receipt.nativeCloseConfirmed = true;
      } catch (error) {
        passed = false;
        receipt.nativeCloseError = String(error.message).slice(0, 1000);
      }
      receipt.elapsedMs = performance.now() - moduleStartedMonotonicMs;
      receipt.slotFailure = slot?.failure() ?? null;
      receipt.startupErrors = startupErrors.slice(0, 24);
      receipt.passed =
        passed &&
        receipt.nativeCloseConfirmed === true &&
        !receipt.slotFailure &&
        !receipt.errors.length &&
        !startupErrors.length;
      if (admitted) {
        if (receipt.passed && pendingExpected)
          await fs.writeFile(expectedFile, encode(pendingExpected), {
            flag: "wx",
          });
        if (budgetWritable) {
          validateBudget(budget);
          await fs.writeFile(budgetFile, encode(budget));
        }
        await fs.mkdir(out, { recursive: true });
        await fs.writeFile(
          path.join(out, restore ? "restore.json" : "journey.json"),
          encode(receipt),
          { flag: "wx" },
        );
        // A late blur/Escape during close or disk persistence invalidates the
        // original receipt too; restore requires that exact passing receipt.
        if (slot?.failure() || receipt.errors.length || startupErrors.length) {
          receipt.passed = false;
          receipt.slotFailure = slot?.failure() ?? null;
          await fs.writeFile(
            path.join(out, restore ? "restore.json" : "journey.json"),
            encode(receipt),
          );
        }
      }
      console.log(
        JSON.stringify({
          passed: receipt.passed,
          scope: receipt.scope,
          evidence: admitted ? out : null,
          error: receipt.error?.message,
          elapsedMs: receipt.elapsedMs,
        }),
      );
    } catch (error) {
      receipt.passed = false;
      console.log(
        JSON.stringify({
          passed: false,
          error: String(error.message).slice(0, 1000),
        }),
      );
    } finally {
      win.removeListener("blur", blur);
      win.removeListener("hide", blur);
      win.removeListener("minimize", blur);
      win.webContents.removeListener("before-input-event", escape);
      win.webContents.removeListener("console-message", consoleError);
      clearTimeout(hardTimer);
      if (owned) app.exit(receipt.passed ? 0 : 1);
    }
  }
  return receipt;
};
