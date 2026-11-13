const {
  app,
  BrowserWindow,
  session,
  screen,
  nativeTheme,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { createHash, randomBytes } = require("node:crypto");
const { readFileSync, readdirSync } = require("node:fs");
const { execFileSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const root = path.resolve(__dirname, "..");
const sourceHashesAtLaunch = Object.fromEntries(
  [
    "native/main.cjs",
    "native/recording.cjs",
    ...readdirSync(path.join(root, "src"))
      .filter((name) => /\.(ts|css)$/.test(name))
      .sort()
      .map((name) => `src/${name}`),
    "package-lock.json",
    "index.html",
  ].map((name) => [
    name,
    createHash("sha256")
      .update(readFileSync(path.join(root, name)))
      .digest("hex"),
  ]),
);
const buildAssetsAtLaunch = readdirSync(path.join(root, "dist/assets")).sort();
const buildAssetHashesAtLaunch = Object.fromEntries(
  buildAssetsAtLaunch.map((name) => [
    name,
    createHash("sha256")
      .update(readFileSync(path.join(root, "dist/assets", name)))
      .digest("hex"),
  ]),
);
let sourceRevisionAtLaunch = null;
try {
  sourceRevisionAtLaunch = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    timeout: 5000,
  }).trim();
} catch {
  /* Source hashes still identify a local export without Git. */
}
const runtime = path.join(root, ".runtime");
const verifyMode = process.argv.includes("--verify");
const relationshipOnly = verifyMode && process.argv.includes("--verify-relationship-only");
const recordMode = process.argv.includes("--record");
const previewMode = process.argv.includes("--preview");
const soakMode = process.argv.includes("--soak");
const recordingTitle = `Aerynth · V3.5 capture · ${Date.now()}`;
const renderWhileVisible = verifyMode || recordMode || previewMode || soakMode;
app.setPath(
  "userData",
  path.join(
    runtime,
    "v3-5-instruments",
    soakMode
      ? `soak-profile-${Date.now()}`
      : recordMode
        ? "recording-profile"
        : verifyMode
          ? relationshipOnly ? `relationship-profile-${Date.now()}` : "verification-profile"
          : previewMode
            ? "ambient-review-profile"
            : "profile",
  ),
);
app.setAppUserModelId("org.aetherwake.cinematic-v3-5");
let win;
const errors = [];
const moduleStarted = Date.now();
let moduleToLoadMs;
app
  .whenReady()
  .then(async () => {
    nativeTheme.themeSource = "dark";
    const localURL = pathToFileURL(path.join(root, "dist/index.html")).href;
    session.defaultSession.setPermissionRequestHandler(
      (contents, permission, callback) =>
        callback(
          recordMode &&
            permission === "display-capture" &&
            contents === win?.webContents &&
            contents.getURL() === localURL,
        ),
    );
    session.defaultSession.setPermissionCheckHandler(
      (contents, permission) =>
        recordMode &&
        permission === "display-capture" &&
        contents === win?.webContents &&
        contents.getURL() === localURL,
    );
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] },
      (_details, callback) => callback({ cancel: true }),
    );
    win = new BrowserWindow({
      show: !verifyMode && !soakMode,
      width: 1600,
      height: 1000,
      minWidth: 700,
      minHeight: 650,
      backgroundColor: "#05060c",
      titleBarStyle: "hidden",
      titleBarOverlay: { color: "#080910", symbolColor: "#d8cee9", height: 42 },
      title: recordMode
        ? recordingTitle
        : soakMode
          ? "Aerynth · V3.5 fresh-process memory probe"
          : verifyMode
            ? "Aerynth · Automated native checks"
            : previewMode
              ? "Aerynth · Cinematic V3.5 · Celestial observatory"
              : "Aerynth · Cinematic V3.5",
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        backgroundThrottling: !renderWhileVisible,
        additionalArguments: renderWhileVisible
          ? ["--render-while-visible"]
          : [],
      },
    });
    win.on("page-title-updated", (event) => event.preventDefault());
    if (
      verifyMode ||
      soakMode ||
      (recordMode && process.argv.includes("--ambient-study"))
    ) {
      win.setIgnoreMouseEvents(true);
      win.showInactive();
    }
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event, url) => {
      if (url !== localURL) event.preventDefault();
    });
    win.webContents.on("will-attach-webview", (event) =>
      event.preventDefault(),
    );
    win.webContents.on("render-process-gone", (_event, detail) =>
      errors.push(`Renderer gone: ${detail.reason}`),
    );
    win.webContents.on("console-message", (details) => {
      if (details.level === "error") errors.push(details.message);
    });
    let suspended = false;
    const active = () =>
      win.webContents.send(
        "host-active",
        !suspended &&
          (renderWhileVisible || win.isFocused()) &&
          !win.isMinimized() &&
          win.isVisible(),
      );
    for (const name of ["minimize", "hide"])
      win.on(name, () => {
        suspended = true;
        win.webContents.send("host-active", false);
      });
    for (const name of ["restore", "show"])
      win.on(name, () => {
        suspended = false;
        setImmediate(active);
      });
    for (const name of ["focus", "blur"])
      win.on(name, () => setImmediate(active));
    await win.loadURL(localURL);
    moduleToLoadMs = Date.now() - moduleStarted;
    if (renderWhileVisible)
      await win.webContents.executeJavaScript(
        "document.querySelector('#settings p:last-child').textContent='Visible reviews keep ambient motion while you use another window. Minimize or choose Quiet to still it. No other apps are monitored.'",
        true,
      );
    if (previewMode)
      await win.webContents.executeJavaScript(
        "window.__aerynth.setStudy('architecture');window.__aerynth.setArchitectureConcept('ring');window.__aerynth.setEnvironmentPhase(null)",
        true,
      );
    if (soakMode) {
      try {
        await memoryProbe();
      } catch (error) {
        console.error(error);
        app.exit(1);
      } finally {
        app.quit();
      }
      return;
    }
    if (recordMode) {
      try {
        const { recordNative } = require("./recording.cjs");
        const file = path.join(
          runtime,
          `aerynth-v3-5-instruments-${process.argv.includes("--ambient-study") ? "ambient" : "native"}-${Date.now()}.webm`,
        );
        const result = await recordNative(
          win,
          session.defaultSession,
          localURL,
          file,
        );
        Object.assign(result, {
          sourceRevisionAtLaunch,
          sourceHashesAtLaunch,
          buildAssetsAtLaunch,
          buildAssetHashesAtLaunch,
        });
        await fs.writeFile(
          file.replace(/\.webm$/, ".json"),
          JSON.stringify(result, null, 2),
          { flag: "wx" },
        );
        await fs.writeFile(
          path.join(runtime, `recording-v3-5-${Date.now()}.json`),
          JSON.stringify(result, null, 2),
          { flag: "wx" },
        );
        console.log(JSON.stringify(result, null, 2));
      } catch (error) {
        console.error(error);
        app.exit(1);
      } finally {
        session.defaultSession.setPermissionCheckHandler(() => false);
        session.defaultSession.setPermissionRequestHandler((_w, _p, callback) =>
          callback(false),
        );
        app.quit();
      }
      return;
    }
    if (verifyMode) {
      try {
        if (relationshipOnly) await verifyRelationship();
        else await verify();
      } catch (error) {
        console.error(error);
        await fs.mkdir(runtime, { recursive: true });
        await fs.writeFile(
          path.join(runtime, `verification-failure-${Date.now()}.json`),
          JSON.stringify(
            {
              at: new Date().toISOString(),
              message: String(error),
              stack: error.stack,
              errors,
            },
            null,
            2,
          ),
        );
        app.exit(1);
      } finally {
        app.quit();
      }
    }
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
app.on("window-all-closed", () => app.quit());

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const evaluate = (code) => win.webContents.executeJavaScript(code, true);
async function verifyRelationship() {
  admitStorage(64 * 1024 * 1024);
  const out = path.join(runtime, `relationship-witness-${Date.now()}`);
  const receipt = {
    sourceRevisionAtLaunch, sourceHashesAtLaunch, buildAssetHashesAtLaunch,
    syntheticStudy: true, passed: false,
  };
  const read = () => evaluate(`(() => {
    const path = document.querySelector("#relationships path");
    const snapshot = window.__aerynth?.snapshot();
    return { path: path.getAttribute("d"), opacity: Number(path.style.opacity),
      draws: snapshot?.metrics.draws, errors: snapshot?.metrics.errors,
      target: document.body.dataset.related };
  })()`);
  async function waitFor(predicate) {
    const end = performance.now() + 6000;
    do {
      const value = await read();
      if (predicate(value)) return value;
      await delay(50);
    } while (performance.now() < end);
    throw new Error("Relationship study did not reach its expected state");
  }
  await fs.mkdir(out, { recursive: true });
  try {
    const before = await waitFor((value) => value.draws > 0);
    await evaluate("window.__aerynth.demo()");
    receipt.visible = await waitFor((value) =>
      value.target && value.opacity > 0 && /^M.+ C/.test(value.path) && value.draws > before.draws);
    if (!win.isVisible() || win.isMinimized()) throw new Error("Native study window is not visible");
    const png = (await win.webContents.capturePage()).toPNG();
    if (png.length === 0 || png.length > 8 * 1024 * 1024) throw new Error("Invalid native capture size");
    await fs.writeFile(path.join(out, "relationship.png"), png, { flag: "wx" });
    receipt.captureSha256 = createHash("sha256").update(png).digest("hex");
    await evaluate("window.__aerynth.demo()");
    receipt.hidden = await waitFor((value) => !value.target && value.opacity === 0);
    if (errors.length || receipt.visible.errors?.length || receipt.hidden.errors?.length) {
      throw new Error("Native relationship study reported renderer errors");
    }
    receipt.passed = true;
  } catch (error) {
    receipt.error = String(error.message);
    throw error;
  } finally {
    await fs.writeFile(path.join(out, "relationship.json"), JSON.stringify(receipt, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ passed: receipt.passed, evidence: out }));
  }
}
function admitStorage(estimatedCBytes) {
  const guard = path.join(
    process.env.LOCALAPPDATA,
    "AeroStorageWatch",
    "ReserveGuard.ps1",
  );
  const shell = path.join(
    process.env.SystemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const output = execFileSync(
    shell,
    [
      "-NoProfile",
      "-File",
      guard,
      "-EstimatedCBytes",
      String(estimatedCBytes),
      "-EstimatedDBytes",
      "0",
    ],
    { encoding: "utf8", windowsHide: true, timeout: 15000 },
  );
  const receipt = JSON.parse(output.trim());
  if (!receipt.allowed)
    throw new Error(
      `Storage reserve declined native writer: ${receipt.reason}`,
    );
  return receipt;
}
async function memoryProbe() {
  const reserve = admitStorage(256 * 1024 * 1024);
  const durationMs = process.argv.includes("--soak-seconds=90") ? 90000 : 60000;
  const probeStartedAt = Date.now();
  const observeRuntime = async () => ({
    native: {
      visible: win.isVisible(),
      minimized: win.isMinimized(),
      contentBounds: {
        width: win.getContentBounds().width,
        height: win.getContentBounds().height,
      },
    },
    document: await evaluate(
      "(()=>{const s=window.__aerynth.snapshot();return {hidden:document.hidden,visibilityState:document.visibilityState,active:s.active,visualClockMs:s.visualClock,framesRendered:s.gpu?.framesRendered??0,callbacks:s.metrics.callbacks,draws:s.metrics.draws,policy:s.metrics.policy};})()",
    ),
  });
  const visibleRuntime = (observation) =>
    observation.native.visible &&
    !observation.native.minimized &&
    observation.native.contentBounds.width > 0 &&
    observation.native.contentBounds.height > 0 &&
    !observation.document.hidden;
  await evaluate(
    "window.__aerynth.home();window.__aerynth.setEnvironmentPhase(null);window.__aerynth.setAmbient(true);window.__aerynth.setReduced(false);document.querySelector('#quiet').checked=false;document.querySelector('#quiet').dispatchEvent(new Event('change'))",
  );
  const preflight = {
    passed: false,
    activatedOwnedWindow: false,
    observations: [],
    interventions: [],
  };
  const initial = await observeRuntime();
  preflight.observations.push({ elapsedMs: 0, ...initial });
  while (Date.now() - probeStartedAt < 8000) {
    const current = await observeRuntime();
    if (current.native.minimized) {
      win.restore();
      preflight.interventions.push({
        elapsedMs: Date.now() - probeStartedAt,
        action: "restore owned probe window",
      });
    }
    if (!current.native.visible || current.document.hidden) {
      win.showInactive();
      preflight.interventions.push({
        elapsedMs: Date.now() - probeStartedAt,
        action: "showInactive owned probe window",
      });
    }
    if (
      !preflight.activatedOwnedWindow &&
      Date.now() - probeStartedAt >= 1500 &&
      current.document.framesRendered <= initial.document.framesRendered
    ) {
      win.show();
      win.focus();
      preflight.activatedOwnedWindow = true;
      preflight.interventions.push({
        elapsedMs: Date.now() - probeStartedAt,
        action:
          "activate owned probe window once after observed non-rendering startup; measurement begins only after preflight and warm-up",
      });
    }
    const visible = await observeRuntime();
    if (
      visibleRuntime(visible) &&
      (!visible.document.active ||
        visible.document.framesRendered <= initial.document.framesRendered)
    ) {
      // Only reconcile this explicit visible-window lab after observing native
      // visibility, positive bounds and an unhidden document. Never override
      // a hidden/minimized product visibility gate to manufacture activity.
      await evaluate("window.__aerynth.setActive(true)");
      preflight.interventions.push({
        elapsedMs: Date.now() - probeStartedAt,
        action:
          "reassert controller active after observed visible/unhidden window",
      });
    }
    await delay(250);
    const observed = await observeRuntime();
    preflight.observations.push({
      elapsedMs: Date.now() - probeStartedAt,
      ...observed,
    });
    if (
      visibleRuntime(observed) &&
      observed.document.active &&
      observed.document.framesRendered > initial.document.framesRendered &&
      observed.document.callbacks > initial.document.callbacks &&
      observed.document.visualClockMs > initial.document.visualClockMs
    ) {
      preflight.passed = true;
      break;
    }
  }
  preflight.durationMs = Date.now() - probeStartedAt;
  if (!preflight.passed) {
    const failed = {
      kind: "Failed fresh-process probe preflight; not active-runtime memory evidence",
      status: "failed-preflight",
      sourceRevisionAtLaunch,
      sourceHashesAtLaunch,
      buildAssets: buildAssetsAtLaunch,
      buildAssetHashes: buildAssetHashesAtLaunch,
      capturedAtUTC: new Date().toISOString(),
      requestedDurationMs: durationMs,
      durationMs: 0,
      totalWallDurationMs: preflight.durationMs,
      preflight,
      phases: [],
      samples: [],
      reserve,
      errors,
      failure:
        "Visible dimensions, unhidden/active document, advancing rendered frames, callbacks and visual clock were not all observed within eight seconds.",
    };
    const output = path.join(runtime, `memory-v3-5-${Date.now()}.json`);
    await fs.writeFile(output, JSON.stringify(failed, null, 2), { flag: "wx" });
    console.error(
      JSON.stringify({ status: failed.status, outputPath: output, preflight }),
    );
    throw new Error(
      "Memory probe preflight failed; failed receipt preserved, no active-runtime memory result claimed",
    );
  }
  const initialVisibleBounds =
    preflight.observations.at(-1).native.contentBounds;
  const startedAt = Date.now();
  const deadline = startedAt + durationMs;
  const phaseDuration = (durationMs - 3000) / 7;
  const phases = [
    {
      name: "architecture-visible-ambient",
      setup:
        "window.__aerynth.home();window.__aerynth.setStudy('architecture');window.__aerynth.setArchitectureConcept('ring');window.__aerynth.setQuality('balanced');window.__aerynth.setVela('idle')",
    },
    {
      name: "living-visible-ambient",
      setup: "window.__aerynth.setStudy('living')",
    },
    {
      name: "resource-expand-return",
      setup: "window.__aerynth.home()",
      toggle: "expand",
    },
    {
      name: "focused-long-conversation",
      setup:
        "window.__aerynth.home();window.__aerynth.expand('conversation-tidal')",
    },
    {
      name: "environment-retarget",
      setup: "window.__aerynth.home()",
      toggle: "scene",
    },
    {
      name: "quiet-static",
      setup:
        "document.querySelector('#quiet').checked=true;document.querySelector('#quiet').dispatchEvent(new Event('change'))",
    },
    {
      name: "native-minimized",
      setup:
        "document.querySelector('#quiet').checked=false;document.querySelector('#quiet').dispatchEvent(new Event('change'))",
      minimized: true,
    },
  ];
  await delay(3000);
  const samples = [],
    phaseReports = [],
    validationFailures = [];
  app.getAppMetrics();
  for (const phase of phases) {
    await evaluate(phase.setup);
    if (phase.minimized) win.minimize();
    await evaluate("window.__aerynth.resetMetrics()");
    const runtimeBefore = await observeRuntime();
    const phaseStartedAt = Date.now(),
      phaseEnd = Math.min(deadline, phaseStartedAt + phaseDuration);
    const phaseSamples = [];
    let iteration = 0;
    while (Date.now() < phaseEnd) {
      if (phase.toggle === "expand")
        await evaluate("window.__aerynth.expand('conversation-tidal')");
      if (phase.toggle === "scene")
        await evaluate(
          `window.__aerynth.setStudy('${iteration % 2 ? "architecture" : "living"}')`,
        );
      await delay(Math.min(1000, Math.max(1, phaseEnd - Date.now())));
      const metrics = app.getAppMetrics();
      const sample = {
        phase: phase.name,
        elapsedMs: Date.now() - startedAt,
        cpuReportedSum: metrics.reduce(
          (sum, item) => sum + item.cpu.percentCPUUsage,
          0,
        ),
        workingSetKiBSum: metrics.reduce(
          (sum, item) => sum + item.memory.workingSetSize,
          0,
        ),
        processCount: metrics.length,
        runtime: await observeRuntime(),
      };
      samples.push(sample);
      phaseSamples.push(sample);
      iteration++;
    }
    const state = await evaluate("window.__aerynth.snapshot()");
    const runtimeAfter = await observeRuntime();
    const intendedActive = !phase.minimized && phase.name !== "quiet-static";
    const observedActivity = {
      renderedFrames:
        runtimeAfter.document.framesRendered -
        runtimeBefore.document.framesRendered,
      visualClockAdvanceMs:
        runtimeAfter.document.visualClockMs -
        runtimeBefore.document.visualClockMs,
      draws: state.metrics.draws,
      callbacks: state.metrics.callbacks,
    };
    const activityValid =
      !intendedActive ||
      (visibleRuntime(runtimeBefore) &&
        visibleRuntime(runtimeAfter) &&
        runtimeBefore.document.active &&
        runtimeAfter.document.active &&
        phaseSamples.length > 0 &&
        phaseSamples.every(
          (sample) =>
            visibleRuntime(sample.runtime) && sample.runtime.document.active,
        ) &&
        observedActivity.renderedFrames > 0 &&
        observedActivity.visualClockAdvanceMs > 0 &&
        observedActivity.draws > 0 &&
        observedActivity.callbacks > 0);
    if (!activityValid)
      validationFailures.push({
        phase: phase.name,
        reason:
          "Intended active phase did not retain visible/unhidden/active state and advance actual rendered frames, submissions, callbacks and visual clock.",
      });
    phaseReports.push({
      name: phase.name,
      durationMs: Date.now() - phaseStartedAt,
      drawSamples: state.metrics.draws,
      callbacks: state.metrics.callbacks,
      policy: state.metrics.policy,
      celestialStudy: state.celestialStudy ?? null,
      instrumentStudy: state.instrumentStudy ?? null,
      environmentPhaseOverrideSeconds: state.environmentPhase ?? null,
      intendedActive,
      activityValid,
      observedActivity,
      runtimeBefore,
      runtimeAfter,
      gpu: state.gpu,
      firstWorkingSetKiBSum: phaseSamples[0]?.workingSetKiBSum ?? null,
      lastWorkingSetKiBSum: phaseSamples.at(-1)?.workingSetKiBSum ?? null,
      deltaWorkingSetKiBSum: phaseSamples.length
        ? phaseSamples.at(-1).workingSetKiBSum -
          phaseSamples[0].workingSetKiBSum
        : null,
    });
    if (!activityValid || Date.now() >= deadline) break;
  }
  const report = {
    kind: "Fresh-process native memory probe with no screenshots, videos or forced GC",
    status:
      validationFailures.length || errors.length
        ? "failed-active-runtime"
        : "measured-active-runtime",
    sourceRevisionAtLaunch,
    sourceHashesAtLaunch,
    buildAssets: buildAssetsAtLaunch,
    buildAssetHashes: buildAssetHashesAtLaunch,
    capturedAtUTC: new Date().toISOString(),
    requestedDurationMs: durationMs,
    durationMs: Date.now() - startedAt,
    totalWallDurationMs: Date.now() - probeStartedAt,
    preflight,
    validationFailures,
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    },
    conditions: {
      tier: "balanced",
      contentBounds: initialVisibleBounds,
      finalNativeState: await observeRuntime(),
      newDedicatedProfile: true,
      renderWhileVisible: true,
      screenshotCount: 0,
      recording: false,
    },
    phases: phaseReports,
    samples,
    reserve,
    errors,
    limitations: [
      "Summed working sets include shared pages and are not unique resident memory or VRAM.",
      "A 60–90 second exploratory probe cannot establish long-term leak freedom, thermal stability or production memory acceptance.",
      "A fresh dedicated profile removes prior capture allocations; desktop load and Chromium allocation/cache changes remain uncontrolled.",
      "Callback and submission observations are not presented-frame timing.",
    ],
  };
  const output = path.join(runtime, `memory-v3-5-${Date.now()}.json`);
  const json = JSON.stringify(report, null, 2);
  if (Buffer.byteLength(json) > 8 * 1024 * 1024)
    throw new Error("Memory receipt exceeded its 8 MiB bound");
  await fs.writeFile(output, json, { flag: "wx" });
  console.log(
    JSON.stringify(
      {
        outputPath: output,
        durationMs: report.durationMs,
        phases: phaseReports,
        errors,
      },
      null,
      2,
    ),
  );
  if (errors.length || validationFailures.length)
    throw new Error(
      "Memory probe failed active-runtime validation; failed receipt preserved",
    );
}
async function verify() {
  const storageReceipts = [admitStorage(256 * 1024 * 1024)];
  let lastStorageCheck = Date.now();
  const evidence = process.env.AERYNTH_EVIDENCE_DIR
    ? path.resolve(process.env.AERYNTH_EVIDENCE_DIR)
    : path.join(
        root,
        "evidence-instruments",
        `run-${Date.now()}-${randomBytes(4).toString("hex")}`,
      );
  try {
    await fs.access(path.join(evidence, "verification.json"));
    throw new Error(
      "Verification evidence already exists; choose a new evidence directory to preserve earlier results",
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const raw = path.join(evidence, "raw");
  await fs.mkdir(raw, { recursive: true });
  const checks = [];
  const scenarios = [];
  const motionFrames = [];
  const captures = [];
  const manualReviews = [];
  const baselineArtifact =
    "evidence-celestial/review-radius-motion/verification.json";
  let comparisonBaseline = {
    artifact: baselineArtifact,
    status: "unavailable",
  };
  try {
    const bytes = await fs.readFile(path.join(root, baselineArtifact));
    const baseline = JSON.parse(bytes);
    comparisonBaseline = {
      artifact: baselineArtifact,
      status: "historical-reference",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      sourceRevision: baseline.sourceRevisionAtLaunch ?? null,
      capturedAt: baseline.capturedAt,
      scenarioCount: baseline.scenarios.length,
      limitation:
        "This is the qualified celestial candidate before the foreground integration addendum. Same-named workloads compare changed instrument materials/geometry, not an isolated shader cost.",
    };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let captureBytes = 0;
  const maxCaptureBytes = 190 * 1024 * 1024;
  const writeCapture = async (destination, image) => {
    if (Date.now() - lastStorageCheck >= 240000) {
      storageReceipts.push(
        admitStorage(maxCaptureBytes - captureBytes + 66 * 1024 * 1024),
      );
      lastStorageCheck = Date.now();
    }
    const png = image.toPNG();
    if (captureBytes + png.length > maxCaptureBytes)
      throw new Error(
        "Native screenshots exceeded the admitted 190 MiB evidence budget",
      );
    await fs.writeFile(destination, png, { flag: "wx" });
    captureBytes += png.length;
    return {
      byteCount: png.length,
      sha256: createHash("sha256").update(png).digest("hex"),
      pixels: image.getSize(),
    };
  };
  const check = (name, passed, detail) => {
    checks.push({ name, passed: !!passed, detail });
    if (!passed)
      console.error(`CHECK FAILED ${name}: ${JSON.stringify(detail)}`);
  };
  const snap = () => evaluate("window.__aerynth.snapshot()");
  const capture = async () => {
    try {
      return await win.webContents.capturePage();
    } catch (error) {
      if (!String(error).includes("UnknownVizError")) throw error;
      errors.push("Transient compositor capture error; retried once");
      win.restore();
      win.showInactive();
      await evaluate("window.__aerynth.setActive(true)");
      await delay(350);
      return win.webContents.capturePage();
    }
  };
  const shot = async (name) => {
    const state = await snap();
    const image = await capture();
    const file = `${name}.png`;
    const artifact = await writeCapture(path.join(evidence, file), image);
    const record = {
      file,
      atUTC: new Date().toISOString(),
      ...artifact,
      conditions: {
        study: state.study,
        architectureConcept: state.architectureConcept ?? null,
        celestialStudy: state.celestialStudy ?? null,
        instrumentStudy: state.instrumentStudy ?? null,
        environmentPhaseOverrideSeconds: state.environmentPhase ?? null,
        quality: state.quality,
        selected: state.selected,
        expanded: state.expanded,
        vela: state.vela,
        reduced: state.reduced,
        visualClock: state.visualClock,
        resourceOrder: state.order,
        resourcePoses: state.poses,
        contentBounds: {
          width: win.getContentBounds().width,
          height: win.getContentBounds().height,
        },
        zoomFactor: win.webContents.getZoomFactor(),
      },
      diagnostics: state.gpu,
    };
    captures.push(record);
    return { image, record };
  };
  const cropShot = async (name, source, region) => {
    const size = source.image.getSize();
    const rect = {
      x: Math.floor(size.width * region.x),
      y: Math.floor(size.height * region.y),
      width: Math.max(1, Math.floor(size.width * region.width)),
      height: Math.max(1, Math.floor(size.height * region.height)),
    };
    rect.width = Math.min(rect.width, size.width - rect.x);
    rect.height = Math.min(rect.height, size.height - rect.y);
    const image = source.image.crop(rect);
    const file = `${name}.png`;
    captures.push({
      file,
      atUTC: new Date().toISOString(),
      ...(await writeCapture(path.join(evidence, file), image)),
      kind: "actual-native-content-crop",
      source: {
        file: source.record.file,
        sha256: source.record.sha256,
        pixels: size,
      },
      cropRectPixels: rect,
      processing:
        "A crop of the recorded native PNG pixels, with no enlargement or offline scene rendering.",
      conditions: source.record.conditions,
    });
  };
  const frames = async (name, action, count = 14) => {
    await evaluate(action);
    for (let i = 0; i < count; i++) {
      const image = await capture();
      const sourcePixels = image.getSize();
      const retained =
        sourcePixels.width > 1280
          ? image.resize({ width: 1280, quality: "good" })
          : image;
      const file = `${name}-${String(i).padStart(2, "0")}.png`;
      const artifact = await writeCapture(path.join(raw, file), retained);
      motionFrames.push({
        sequence: name,
        index: i,
        at: Date.now(),
        file: `raw/${file}`,
        sourcePixels,
        pixels: artifact.pixels,
        processing:
          sourcePixels.width > 1280
            ? "Actual native frame downscaled to a 1280-pixel width for bounded motion evidence"
            : "Actual native frame, original dimensions",
      });
      await delay(45);
    }
  };
  await delay(800);
  win.showInactive();
  await evaluate("window.__aerynth.setActive(true)");
  await delay(500);
  await evaluate(
    "window.__aerynth.setEnvironmentPhase(null);window.__aerynth.setCelestialStudy('starlit')",
  );
  const originalInstrumentStudy = (await snap()).instrumentStudy;
  if (!["optical", "engineered", "composite"].includes(originalInstrumentStudy))
    throw new Error(
      "The instrument-study controller and snapshot are unavailable in the selected build",
    );
  for (const study of ["architecture", "living", "observatory"]) {
    await evaluate(`window.__aerynth.setStudy('${study}')`);
    await delay(900);
    await shot(`study-${study}`);
  }
  const conceptSnapshots = [];
  for (const concept of ["ring", "aperture", "observatory"]) {
    await evaluate(
      `window.__aerynth.setStudy('architecture');window.__aerynth.setArchitectureConcept('${concept}')`,
    );
    await delay(900);
    await shot(`architecture-${concept}`);
    const state = await snap();
    conceptSnapshots.push({
      concept,
      actual: state.architectureConcept,
      gpu: state.gpu,
    });
  }
  check(
    "three architectural compositions remain selectable without resource replacement",
    conceptSnapshots.every((state) => state.actual === state.concept) &&
      (await snap()).resources.length === 3,
    conceptSnapshots,
  );
  await evaluate("window.__aerynth.setArchitectureConcept('ring')");
  await evaluate("window.__aerynth.setStudy('architecture')");
  const celestialStudies = [
    { id: "starlit", label: "A-starlit-ring" },
    { id: "shadow", label: "B-shadow-reveal" },
    { id: "deep", label: "C-deep-observatory" },
  ];
  const celestialSnapshots = [];
  const celestialResourceIDs = (await snap()).resources
    .map((resource) => resource.id)
    .sort();
  for (const variant of celestialStudies) {
    await evaluate(
      `window.__aerynth.home();window.__aerynth.setQuality('balanced');window.__aerynth.setVela('idle');window.__aerynth.setCelestialStudy('${variant.id}');window.__aerynth.setEnvironmentPhase(0)`,
    );
    await delay(900);
    const source = await shot(`celestial-${variant.label}`);
    const state = await snap();
    celestialSnapshots.push({
      requested: variant.id,
      actual: state.celestialStudy,
      resourceIDs: state.resources.map((resource) => resource.id).sort(),
      cosmos: state.gpu?.cosmos ?? null,
      architecture: state.gpu?.architecture ?? null,
    });
    if (variant.id === "starlit")
      await cropShot("celestial-starlit-structure-native-crop", source, {
        x: 0.28,
        y: 0.16,
        width: 0.26,
        height: 0.64,
      });
    manualReviews.push({
      artifact: source.record.file,
      status: "requires-human-review",
      questions: [
        "Does the backdrop read as distant space with restrained stellar brightness, color and density?",
        "Does the opaque architectural shell correctly obscure stars behind it?",
        "Do the ring curvature, thickness and restrained structural details communicate monumental scale?",
        "Do Vela and usable foreground resources retain the visual hierarchy?",
      ],
    });
  }
  check(
    "three celestial studies preserve canonical resource identities and expose diagnostics",
    celestialSnapshots.every(
      (state) =>
        state.actual === state.requested &&
        state.cosmos !== null &&
        JSON.stringify(state.resourceIDs) ===
          JSON.stringify(celestialResourceIDs),
    ),
    celestialSnapshots,
  );
  const phaseSnapshots = [];
  await evaluate("window.__aerynth.setCelestialStudy('shadow')");
  for (const phase of [0, 30, 60]) {
    await evaluate(`window.__aerynth.setEnvironmentPhase(${phase})`);
    await delay(550);
    const source = await shot(`celestial-shadow-held-phase-${phase}s`);
    const state = await snap();
    phaseSnapshots.push({
      requested: phase,
      controller: state.environmentPhase,
      rendered: state.gpu?.architecture?.scriptedPhaseSeconds ?? null,
    });
    if (phase === 30)
      await cropShot(
        "celestial-shadow-phase-30-structure-native-crop",
        source,
        { x: 0.28, y: 0.16, width: 0.26, height: 0.64 },
      );
  }
  check(
    "held environment phases are labelled in controller and geometry diagnostics",
    phaseSnapshots.every(
      (state) =>
        state.controller === state.requested &&
        state.rendered === state.requested,
    ),
    phaseSnapshots,
  );
  manualReviews.push({
    artifacts: [0, 30, 60].map(
      (phase) => `celestial-shadow-held-phase-${phase}s.png`,
    ),
    status: "requires-human-review",
    method:
      "Scripted presentation phases under the selected study's fixed lighting; camera, viewport and resource layout are unchanged. Vela's separate animation clock is not phase-locked. These stills do not prove real-time pacing.",
    questions: [
      "Do fixed lights reveal different physically oriented shell/rib surfaces without a whole-object opacity pulse?",
      "Are the deep backdrop and ring occlusion coherent at each held phase?",
    ],
  });
  await evaluate("window.__aerynth.setEnvironmentPhase(null)");
  await evaluate(
    "window.__celestialArticle=document.querySelector('[data-resource=\"conversation-tidal\"]');window.__celestialEditor=window.__celestialArticle.querySelector('textarea')",
  );
  const celestialFocusStates = [];
  for (const variant of celestialStudies) {
    await evaluate(
      `window.__aerynth.setCelestialStudy('${variant.id}');window.__aerynth.expand('conversation-tidal')`,
    );
    await delay(900);
    await shot(`celestial-${variant.label}-focused-work`);
    celestialFocusStates.push(
      await evaluate(
        "({expanded:window.__aerynth.snapshot().expanded,phase:window.__aerynth.snapshot().environmentPhase,sameArticle:window.__celestialArticle===document.querySelector('[data-resource=\"conversation-tidal\"]'),sameEditor:window.__celestialEditor===window.__celestialArticle.querySelector('textarea')})",
      ),
    );
    manualReviews.push({
      artifact: `celestial-${variant.label}-focused-work.png`,
      status: "requires-human-review",
      questions: [
        "Do stars and architecture recede enough for sustained reading?",
        "Are bright details absent from important text regions, and is Vela reachable?",
      ],
    });
    await evaluate("window.__aerynth.home()");
    await delay(700);
  }
  check(
    "all celestial focus studies keep the same conversation article and editor",
    celestialFocusStates.every(
      (state) =>
        state.expanded === "conversation-tidal" &&
        state.phase === null &&
        state.sameArticle &&
        state.sameEditor,
    ),
    celestialFocusStates,
  );
  await evaluate(
    "window.__aerynth.setEnvironmentPhase(null);window.__aerynth.setCelestialStudy('starlit')",
  );
  const instrumentStudies = [
    { id: "optical", label: "A-optical-glass" },
    { id: "engineered", label: "B-engineered-instrument" },
    { id: "composite", label: "C-luminous-composite" },
  ];
  const instrumentResources = [
    { id: "conversation-tidal", kind: "conversation" },
    { id: "research-material", kind: "research-lens" },
    { id: "note-field", kind: "memory-slate" },
  ];
  await evaluate(
    "window.__instrumentArticles=Array.from(document.querySelectorAll('.folio'));window.__instrumentEditors=window.__instrumentArticles.map(el=>el.querySelector('textarea'));window.__instrumentNote=document.querySelector('[data-resource=\"note-field\"] textarea');window.__instrumentOriginalNote=window.__instrumentNote.value;window.__instrumentNote.value+='\\n\\nSynthetic instrument continuity checkpoint.';window.__instrumentNote.dispatchEvent(new Event('input',{bubbles:true}))",
  );
  const instrumentContentHash = createHash("sha256")
    .update(JSON.stringify((await snap()).resources))
    .digest("hex");
  const instrumentSnapshots = [];
  for (const variant of instrumentStudies) {
    await evaluate(
      `window.__aerynth.home();window.__aerynth.setStudy('architecture');window.__aerynth.setArchitectureConcept('ring');window.__aerynth.setCelestialStudy('starlit');window.__aerynth.setQuality('balanced');window.__aerynth.setInstrumentStudy('${variant.id}');window.__aerynth.setEnvironmentPhase(0)`,
    );
    await delay(900);
    const source = await shot(`instruments-${variant.label}-workspace`);
    const boxes = await evaluate(
      "({width:innerWidth,height:innerHeight,resources:Array.from(document.querySelectorAll('.folio')).map(el=>{const r=el.getBoundingClientRect();return {id:el.dataset.resource,x:r.x,y:r.y,right:r.right,bottom:r.bottom}})})",
    );
    for (const resource of instrumentResources) {
      const box = boxes.resources.find((item) => item.id === resource.id);
      const left = Math.max(0, box.x - 10),
        top = Math.max(0, box.y - 10);
      const right = Math.min(boxes.width, box.right + 10),
        bottom = Math.min(boxes.height, box.bottom + 10);
      await cropShot(
        `instruments-${variant.label}-${resource.kind}-native-crop`,
        source,
        {
          x: left / boxes.width,
          y: top / boxes.height,
          width: (right - left) / boxes.width,
          height: (bottom - top) / boxes.height,
        },
      );
    }
    await evaluate("window.__aerynth.select('conversation-tidal')");
    await delay(550);
    await shot(`instruments-${variant.label}-conversation-selected`);
    await evaluate("window.__aerynth.expand('conversation-tidal')");
    await delay(130);
    await shot(`instruments-${variant.label}-conversation-transforming`);
    await frames(`instruments-${variant.id}-unfold`, "void 0", 6);
    await delay(600);
    await shot(`instruments-${variant.label}-conversation-focused`);
    await evaluate(
      "window.__aerynth.home();window.__aerynth.expand('research-material')",
    );
    await delay(850);
    await shot(`instruments-${variant.label}-research-focused`);
    await evaluate(
      "window.__aerynth.home();window.__aerynth.expand('note-field')",
    );
    await delay(850);
    await shot(`instruments-${variant.label}-memory-slate-focused`);
    await evaluate(
      "window.__aerynth.home();window.__aerynth.setStudy('living')",
    );
    await delay(1000);
    await shot(`instruments-${variant.label}-living-workspace`);
    const state = await snap();
    instrumentSnapshots.push({
      requested: variant.id,
      actual: state.instrumentStudy,
      contentHash: createHash("sha256")
        .update(JSON.stringify(state.resources))
        .digest("hex"),
      identityRetained: await evaluate(
        "window.__instrumentArticles.every((el,index)=>el===document.querySelector('[data-resource=\"'+el.dataset.resource+'\"]')&&window.__instrumentEditors[index]===el.querySelector('textarea'))",
      ),
      instruments: state.gpu?.instruments ?? null,
    });
    manualReviews.push({
      artifacts: [
        `instruments-${variant.label}-workspace.png`,
        `instruments-${variant.label}-conversation-selected.png`,
        `instruments-${variant.label}-conversation-transforming.png`,
        `instruments-${variant.label}-conversation-focused.png`,
        `instruments-${variant.label}-living-workspace.png`,
      ],
      status: "requires-human-review",
      questions: [
        "Are the optical working plane, physical structure and type-specific resource details visible rather than hidden behind CSS?",
        "Do foreground highlights respond coherently to shared scene lighting without generic glowing borders?",
        "Are text regions opaque, crisp and calm when expanded and when resources overlap?",
        "Does the same instrument identity survive selection, unfolding, research/slate focus and the Living Intelligence scene?",
      ],
    });
  }
  check(
    "three instrument studies retain canonical resources, editable drafts and original DOM",
    instrumentSnapshots.every(
      (state) =>
        state.requested === state.actual &&
        state.contentHash === instrumentContentHash &&
        state.identityRetained &&
        state.instruments !== null,
    ),
    instrumentSnapshots,
  );
  await evaluate(
    "window.__aerynth.home();window.__aerynth.setStudy('architecture');window.__aerynth.setEnvironmentPhase(0)",
  );
  for (const variant of instrumentStudies) {
    await evaluate(`window.__aerynth.setInstrumentStudy('${variant.id}')`);
    await delay(250);
  }
  const allocationBefore = (await snap()).gpu;
  const allocationSamples = [];
  for (const variant of [...instrumentStudies, ...instrumentStudies]) {
    await evaluate(`window.__aerynth.setInstrumentStudy('${variant.id}')`);
    await delay(250);
    const gpu = (await snap()).gpu;
    allocationSamples.push({
      study: variant.id,
      residentGeometries: gpu?.geometries ?? null,
      geometryAllocations: gpu?.instruments?.geometryAllocations ?? null,
      materialAllocations: gpu?.instruments?.materialAllocations ?? null,
    });
  }
  const allocationStart = {
    residentGeometries: allocationBefore?.geometries ?? null,
    geometryAllocations:
      allocationBefore?.instruments?.geometryAllocations ?? null,
    materialAllocations:
      allocationBefore?.instruments?.materialAllocations ?? null,
  };
  check(
    "warmed instrument switching does not grow live geometry or reported allocation counters",
    Number.isFinite(allocationStart.residentGeometries) &&
      allocationSamples.every(
        (state) =>
          state.residentGeometries === allocationStart.residentGeometries &&
          (!Number.isFinite(allocationStart.geometryAllocations) ||
            state.geometryAllocations ===
              allocationStart.geometryAllocations) &&
          (!Number.isFinite(allocationStart.materialAllocations) ||
            state.materialAllocations === allocationStart.materialAllocations),
      ),
    {
      before: allocationStart,
      after: allocationSamples,
      meaning:
        "Live renderer geometry residency is measured; cumulative geometry/material allocation counters are checked only when actually exposed. Null counters remain unavailable, not a zero-allocation claim.",
    },
  );
  await evaluate(
    `window.__instrumentNote.value=window.__instrumentOriginalNote;window.__instrumentNote.dispatchEvent(new Event('input',{bubbles:true}));window.__aerynth.home();window.__aerynth.setStudy('architecture');window.__aerynth.setInstrumentStudy('${originalInstrumentStudy}');window.__aerynth.setEnvironmentPhase(null)`,
  );
  await delay(350);
  await shot("environment-idle");
  let s = await snap();
  if (process.argv.includes("--visual-only")) {
    await fs.writeFile(
      path.join(evidence, "exploration.json"),
      JSON.stringify(
        {
          capturedAt: new Date().toISOString(),
          kind: "Actual native composition exploration; not the full verifier or a performance result",
          sourceHashesAtLaunch,
          sourceRevisionAtLaunch,
          buildAssets: buildAssetsAtLaunch,
          buildAssetHashes: buildAssetHashesAtLaunch,
          captures,
          checks,
          manualReviews,
          comparisonBaseline,
          gpu: s.gpu,
          errors,
        },
        null,
        2,
      ),
      { flag: "wx" },
    );
    if (s.graphicsFailed || errors.length)
      throw new Error("Native exploration encountered graphics errors");
    console.log(
      JSON.stringify({ exploration: true, captures: captures.length, errors }),
    );
    return;
  }
  check("GPU constructed", !s.graphicsFailed, s.gpu);
  check(
    "isolated renderer",
    await evaluate(
      "typeof window.require === 'undefined' && typeof process === 'undefined'",
    ),
  );
  await evaluate(
    "window.__aerynth.home();window.__aerynth.setStudy('architecture');window.__aerynth.setArchitectureConcept('ring');window.__aerynth.setAmbient(true);window.__aerynth.setReduced(false);window.__aerynth.setEnvironmentPhase(null);window.__aerynth.setVela('idle');window.__naturalArticle=document.querySelector('[data-resource=\"conversation-tidal\"]');window.__naturalEditor=window.__naturalArticle.querySelector('textarea')",
  );
  await delay(700);
  const naturalBefore = await snap();
  const naturalWallStart = Date.now();
  await delay(5000);
  const naturalAfter = await snap();
  const naturalWallMs = Date.now() - naturalWallStart;
  const beforeArchitecture = naturalBefore.gpu?.architecture ?? {};
  const afterArchitecture = naturalAfter.gpu?.architecture ?? {};
  const opticalAdvance =
    afterArchitecture.opticalClockSeconds -
    beforeArchitecture.opticalClockSeconds;
  const angleAdvance =
    afterArchitecture.naturalLongitudinalRotationRadians -
    beforeArchitecture.naturalLongitudinalRotationRadians;
  const angularRate = afterArchitecture.angularRateRadiansPerSecond;
  const naturalIdentity = await evaluate(
    "window.__naturalArticle===document.querySelector('[data-resource=\"conversation-tidal\"]')&&window.__naturalEditor===window.__naturalArticle.querySelector('textarea')",
  );
  check(
    "five seconds without input advances the real orbital clock and geometry angle",
    naturalBefore.environmentPhase === null &&
      naturalAfter.environmentPhase === null &&
      beforeArchitecture.scriptedPhaseSeconds === null &&
      afterArchitecture.scriptedPhaseSeconds === null &&
      Number.isFinite(opticalAdvance) &&
      opticalAdvance > 0 &&
      opticalAdvance <= (naturalWallMs / 1000) * 1.2 &&
      Number.isFinite(angleAdvance) &&
      angleAdvance >= 0.005 &&
      angleAdvance <= 0.05 &&
      Number.isFinite(angularRate) &&
      Math.abs(angleAdvance - opticalAdvance * angularRate) < 1e-6 &&
      Math.abs(
        afterArchitecture.longitudinalRotationRadians -
          afterArchitecture.naturalLongitudinalRotationRadians,
      ) < 1e-9 &&
      naturalIdentity,
    {
      wallElapsedMs: naturalWallMs,
      visualClockBeforeMs: naturalBefore.visualClock,
      visualClockAfterMs: naturalAfter.visualClock,
      opticalClockBeforeSeconds: beforeArchitecture.opticalClockSeconds,
      opticalClockAfterSeconds: afterArchitecture.opticalClockSeconds,
      opticalAdvanceSeconds: opticalAdvance,
      angleBeforeRadians: beforeArchitecture.naturalLongitudinalRotationRadians,
      angleAfterRadians: afterArchitecture.naturalLongitudinalRotationRadians,
      angleAdvanceRadians: angleAdvance,
      angularRateRadiansPerSecond: angularRate,
      phaseOverride: null,
      sameArticleAndEditor: naturalIdentity,
      method:
        "Actual visible native runtime with no input or accelerated presentation phase for a five-second wall-clock wait. Geometry diagnostics establish motion state, not beauty or presented FPS.",
    },
  );
  const first = s.order[0];
  const labelClearances = [];
  for (let slot = 0; slot < 3; slot++) {
    await evaluate(
      `window.__aerynth.move('note-field',${slot});window.__aerynth.home()`,
    );
    await delay(700);
    labelClearances.push(
      await evaluate(
        "(()=>{const v=document.querySelector('.vela-label').getBoundingClientRect();return Array.from(document.querySelectorAll('.folio')).every(el=>{const r=el.getBoundingClientRect();return v.right<=r.left||v.left>=r.right||v.bottom<=r.top||v.top>=r.bottom});})()",
      ),
    );
  }
  await evaluate(
    "for(let i=0;i<3;i++)document.querySelector('#undo').click();window.__aerynth.home()",
  );
  await delay(700);
  check(
    "overview Vela label stays clear across reordered resource roles",
    labelClearances.every(Boolean) &&
      (await snap()).order.join("|") === s.order.join("|"),
    labelClearances,
  );
  await evaluate("window.__aerynth.move('conversation-tidal',2)");
  await delay(900);
  await shot("overlapping-materials");
  const overlapReadability = await evaluate(
    `Array.from(document.querySelectorAll('.folio')).map(el=>({id:el.dataset.resource,clip:getComputedStyle(el.querySelector(".resource-presentation")).clipPath,background:getComputedStyle(el,"::before").backgroundColor,covered:el.dataset.materialCovered}))`,
  );
  check(
    "overlap clips rear DOM content while preserving optical veils and opaque GPU substrates",
    overlapReadability.some((item) => item.clip !== "none") &&
      overlapReadability.every((item) => item.background.includes("rgba(")) &&
      (await snap()).gpu.instruments.surfaces.every(
        (item) => item.faceOpacity === 1 && item.clearcoat > 0.9,
      ),
    overlapReadability,
  );
  await evaluate("document.querySelector('#undo').click()");
  await delay(700);
  await evaluate(
    `window.__verificationArticle=document.querySelector('[data-resource="${first}"]');window.__verificationEditor=window.__verificationArticle.querySelector('textarea');`,
  );
  await frames("selection", `window.__aerynth.select('${first}')`, 10);
  await shot("resource-selected");
  await frames("expansion", `window.__aerynth.expand('${first}')`, 18);
  await shot("resource-expanded");
  check(
    "focused environment navigation stays visible and reachable",
    await evaluate(`Array.from(document.querySelectorAll('.scene-navigation button')).every(button => {
    const r = button.getBoundingClientRect();
    for(let p = button; p; p = p.parentElement) { const s = getComputedStyle(p); if(s.display==='none' || s.visibility==='hidden' || Number(s.opacity)<.01) return false; }
    return r.width>0 && r.height>0 && r.left>=0 && r.right<=innerWidth && document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===button;
  })`),
  );
  const presenceClearance = await evaluate(
    `(()=>{const v=document.querySelector('#vela').getBoundingClientRect(),r=document.querySelector('.expanded').getBoundingClientRect();return {left:v.left,right:v.right,resourceRight:r.right,width:innerWidth};})()`,
  );
  check(
    "focused Vela stays clear of the working surface and inside the viewport",
    presenceClearance.left > presenceClearance.resourceRight + 4 &&
      presenceClearance.right <= presenceClearance.width + 1,
    presenceClearance,
  );
  const anchorBounds = await evaluate(
    `Array.from(document.querySelectorAll('.receded .resource-anchor')).map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,label:el.getAttribute('aria-label'),keyboard:el.tabIndex===0,inert:el.parentElement.querySelector('.folio-inner').inert,visible:getComputedStyle(el).display!=='none',writingMode:getComputedStyle(el).writingMode};})`,
  );
  check(
    "horizontal resource anchors stay readable, separate and keyboard reachable",
    anchorBounds.length === 2 &&
      anchorBounds.every(
        (r) =>
          r.visible &&
          r.keyboard &&
          r.inert &&
          r.label &&
          r.writingMode === "horizontal-tb" &&
          r.x >= 0 &&
          r.x + r.w < 225 &&
          r.w > r.h &&
          r.y >= 100 &&
          r.y + r.h < 900,
      ),
    anchorBounds,
  );
  check(
    "focus state coherently calms ambient motion and the field",
    (await snap()).scene?.mode === "focused-work" &&
      (await snap()).scene?.ambientStrength < 0.5,
  );
  const nativeFrame = await evaluate(
    "({drag:getComputedStyle(document.querySelector('.window-drag')).getPropertyValue('-webkit-app-region'),height:document.querySelector('.window-drag').getBoundingClientRect().height})",
  );
  check(
    "dark caption integrates a supported native controls overlay",
    nativeFrame.drag === "drag" &&
      nativeFrame.height === 42 &&
      win.isResizable() &&
      win.isMaximizable() &&
      win.isMinimizable(),
    nativeFrame,
  );
  const before = await evaluate(
    `document.querySelector('[data-resource="${first}"] textarea').value`,
  );
  await evaluate(
    `document.querySelector('[data-resource="${first}"] textarea').value += '\\n\\nLocal persistence verification.';document.querySelector('[data-resource="${first}"] textarea').dispatchEvent(new Event('input',{bubbles:true}));`,
  );
  await evaluate(`window.__aerynth.expand('${first}')`);
  await delay(90);
  await evaluate(`window.__aerynth.expand('${first}')`);
  await delay(90);
  await evaluate(`window.__aerynth.expand('${first}')`);
  await delay(1000);
  s = await snap();
  check(
    "reversal reconciles to collapsed",
    s.expanded === null &&
      Object.values(s.poses).every((p) => Number.isFinite(p.x)),
    s.expanded,
  );
  check(
    "single persistent resource DOM",
    await evaluate(
      `document.querySelectorAll('[data-resource="${first}"]').length===1`,
    ),
  );
  check(
    "draft survives interruption",
    s.resources
      .find((r) => r.id === first)
      .text.endsWith("Local persistence verification."),
  );
  check(
    "same article and editor instances survive",
    await evaluate(
      `window.__verificationArticle===document.querySelector('[data-resource="${first}"]')&&window.__verificationEditor===window.__verificationArticle.querySelector('textarea')`,
    ),
  );
  await frames("rearrangement", `window.__aerynth.move('${first}',2)`, 16);
  await shot("workspace-rearranged");
  await evaluate("document.querySelector('#undo').click()");
  await delay(700);
  s = await snap();
  check("undo restores ID order", s.order[0] === first, s.order);
  await frames("vela-working", "window.__aerynth.setVela('working')", 14);
  await shot("vela-active");
  await evaluate("window.__aerynth.demo()");
  await delay(6500);
  await shot("intelligence-stream");
  await delay(5300);
  s = await snap();
  check(
    "synthetic provenance explicit",
    s.events.filter((e) => e.evidence === "synthetic").length === 6,
    s.events.filter((e) => e.evidence === "synthetic").map((e) => e.kind),
  );
  check(
    "fixture validation has actual local evidence",
    s.events.some(
      (e) =>
        e.evidence === "local-observed" && e.kind === "fixture.check.passed",
    ),
    s.events.filter((e) => e.kind.startsWith("fixture.check")),
  );
  await evaluate(
    "document.querySelector('#stream-close').click();window.__aerynth.home()",
  );
  await frames("return-to-calm", "window.__aerynth.setVela('idle')", 14);
  await evaluate(
    "window.__verificationLens=document.querySelector('[data-resource=\"research-material\"]')",
  );
  await frames(
    "lens-unfold",
    "window.__aerynth.expand('research-material')",
    18,
  );
  await shot("lens-expanded");
  check(
    "lens unfolds with its original DOM identity",
    await evaluate(
      "window.__verificationLens===document.querySelector('[data-resource=\"research-material\"]')&&window.__aerynth.snapshot().expanded==='research-material'",
    ),
  );
  await evaluate("window.__aerynth.home()");
  await delay(700);
  await evaluate(`window.__aerynth.expand('${first}')`);
  await delay(800);
  await shot("focused-working");
  await evaluate(
    `window.__aerynth.home();window.__aerynth.expand('conversation-tidal')`,
  );
  await delay(750);
  await evaluate("document.querySelector('.message-stream').scrollTop=0");
  await shot("focused-conversation");
  const localMessage =
    "A local conversation message, kept through resource navigation.";
  await evaluate(
    `(()=>{const editor=document.querySelector('[data-resource="conversation-tidal"] textarea');editor.value=${JSON.stringify(localMessage)};editor.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.keep-message').click();})()`,
  );
  const keptMessageCount = await evaluate(
    "document.querySelectorAll('.message-stream .message').length",
  );
  await evaluate("document.querySelector('#stream-button').click()");
  const streamClearance = await evaluate(
    "(()=>{const s=document.querySelector('#stream').getBoundingClientRect(),v=document.querySelector('#vela').getBoundingClientRect();return {streamTop:s.top,velaBottom:v.bottom};})()",
  );
  check(
    "focused activity record leaves Vela visible above it",
    streamClearance.streamTop > streamClearance.velaBottom + 10,
    streamClearance,
  );
  await evaluate("document.querySelector('#stream-close').click()");
  await evaluate(
    "window.__aerynth.expand('research-material');window.__aerynth.expand('note-field');window.__aerynth.expand('conversation-tidal')",
  );
  await delay(850);
  check(
    "local message history and separate composer survive rapid resource switching",
    await evaluate(
      `(()=>{const h=document.querySelector('.message-stream');return h.querySelectorAll('.message').length>=3&&h.lastElementChild.textContent.includes(${JSON.stringify(localMessage)})&&document.querySelector('[data-resource="conversation-tidal"] textarea').value===''&&document.querySelectorAll('.folio').length===3&&document.activeElement.closest('.folio')?.dataset.resource==='conversation-tidal';})()`,
    ),
  );
  check(
    "rapid resource switching does not duplicate messages",
    keptMessageCount ===
      (await evaluate(
        "document.querySelectorAll('.message-stream .message').length",
      )),
  );
  await shot("local-message-retained");
  const continuityBefore = await evaluate(`(()=>{
    const article=document.querySelector('[data-resource="conversation-tidal"]');
    const history=article.querySelector('.message-stream');
    window.__sceneArticle=article;window.__sceneEditor=article.querySelector('textarea');
    history.scrollTop=Math.min(100,history.scrollHeight-history.clientHeight);
    const range=document.createRange();range.selectNodeContents(history.querySelector('.message p'));
    const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
    return {order:window.__aerynth.snapshot().order,scroll:history.scrollTop,text:selection.toString(),resources:window.__aerynth.snapshot().resources};
  })()`);
  await evaluate("window.__aerynth.setStudy('living')");
  await delay(130);
  await shot("scene-transition");
  await evaluate("window.__aerynth.setStudy('architecture')");
  await delay(90);
  await evaluate("window.__aerynth.setStudy('living')");
  await delay(1000);
  const continuityAfter = await evaluate(`(()=>{
    const article=document.querySelector('[data-resource="conversation-tidal"]'),history=article.querySelector('.message-stream');
    return {sameArticle:article===window.__sceneArticle,sameEditor:article.querySelector('textarea')===window.__sceneEditor,
      order:window.__aerynth.snapshot().order,scroll:history.scrollTop,text:getSelection().toString(),
      resources:window.__aerynth.snapshot().resources,expanded:window.__aerynth.snapshot().expanded};
  })()`);
  check(
    "interruptible environment changes preserve resources, reading position and selected text",
    continuityAfter.sameArticle &&
      continuityAfter.sameEditor &&
      continuityAfter.expanded === "conversation-tidal" &&
      continuityAfter.scroll === continuityBefore.scroll &&
      continuityAfter.text === continuityBefore.text &&
      JSON.stringify(continuityAfter.order) ===
        JSON.stringify(continuityBefore.order) &&
      JSON.stringify(continuityAfter.resources) ===
        JSON.stringify(continuityBefore.resources),
    { before: continuityBefore, after: continuityAfter },
  );
  await evaluate(`(()=>{getSelection().removeAllRanges();const editor=window.__sceneEditor;window.__sceneDraft=editor.value;
    editor.value='Synthetic scene continuity: retain this local draft and caret.';
    editor.dispatchEvent(new Event('input',{bubbles:true}));editor.focus();editor.setSelectionRange(10,31);
    window.__aerynth.setStudy('architecture');})()`);
  await delay(1000);
  check(
    "scene changes preserve the focused editor, draft and caret range",
    await evaluate(
      "document.activeElement===window.__sceneEditor&&window.__sceneEditor.selectionStart===10&&window.__sceneEditor.selectionEnd===31&&window.__sceneEditor.value==='Synthetic scene continuity: retain this local draft and caret.'",
    ),
  );
  await shot("architecture-focused-conversation");
  await evaluate("window.__aerynth.setStudy('living')");
  await delay(900);
  await shot("living-focused-conversation");
  await evaluate(
    "window.__sceneEditor.value=window.__sceneDraft;window.__sceneEditor.dispatchEvent(new Event('input',{bubbles:true}));window.__sceneEditor.blur();window.__aerynth.home()",
  );
  for (const study of ["architecture", "living"]) {
    await evaluate(`window.__aerynth.setStudy('${study}')`);
    await delay(900);
    await frames(
      `${study}-resource-transform`,
      "window.__aerynth.expand('research-material')",
      8,
    );
    check(
      `${study} resource transformation retains canonical lens and returns to the workspace`,
      (await snap()).expanded === "research-material" &&
        (await snap()).resources.length === 3,
    );
    await evaluate("window.__aerynth.home()");
    await delay(800);
    await frames(
      `${study}-resource-field`,
      "window.__aerynth.move('conversation-tidal',2)",
      8,
    );
    await shot(`${study}-resource-interaction`);
    await evaluate("document.querySelector('#undo').click()");
    await delay(800);
  }
  const expressionStates = [
    "idle",
    "receiving",
    "working",
    "coordinating",
    "attention",
    "reported",
    "verified",
    "unavailable",
  ];
  const expressionResults = [];
  for (const state of expressionStates) {
    await evaluate(`window.__aerynth.setVela('${state}')`);
    await delay(600);
    const actual = await snap();
    expressionResults.push({
      requested: state,
      actual: actual.vela,
      graphicsFailed: actual.graphicsFailed,
    });
    await shot(`vela-${state}`);
  }
  check(
    "all eight Vela presentation states retain GPU availability and explicit state",
    expressionResults.every(
      (result) => result.requested === result.actual && !result.graphicsFailed,
    ),
    expressionResults,
  );
  await evaluate(
    "window.__aerynth.setVela('idle');window.__aerynth.setStudy('architecture')",
  );
  await evaluate(
    "window.__aerynth.home();window.__aerynth.setQuality('efficient')",
  );
  await delay(700);
  await shot("efficient-materials");
  check(
    "Efficient preserves opaque resource readability fallback",
    await evaluate(
      "document.querySelector('#world').dataset.materials === 'opaque'",
    ),
  );
  await evaluate("window.__aerynth.setQuality('balanced')");
  await delay(700);
  check(
    "Balanced restores confirmed physical resource faces",
    await evaluate(
      "document.querySelector('#world').dataset.materials === 'physical'",
    ),
  );
  await evaluate(
    "window.__aerynth.home();window.__aerynth.expand('research-material')",
  );
  await delay(80);
  win.setContentSize(1100, 720);
  await evaluate("window.__aerynth.expand('note-field')");
  await delay(850);
  check(
    "resize during resource switching reconciles without identity loss",
    await evaluate(
      "window.__aerynth.snapshot().expanded==='note-field'&&document.querySelectorAll('.folio').length===3&&Array.from(document.querySelectorAll('.folio')).every(el=>{const r=el.getBoundingClientRect();return r.x>=0&&r.right<=innerWidth+30&&r.bottom<=innerHeight})",
    ),
  );
  win.setContentSize(1600, 1000);
  await delay(600);
  win.maximize();
  await delay(550);
  const maximized = win.isMaximized();
  win.unmaximize();
  await delay(550);
  check(
    "native maximize and restore retain focused resource and draft",
    maximized && !win.isMaximized() && (await snap()).expanded === "note-field",
  );
  await evaluate(
    `document.querySelector('[data-resource="${first}"] textarea').value=${JSON.stringify(before)};document.querySelector('[data-resource="${first}"] textarea').dispatchEvent(new Event('input',{bubbles:true}));window.__aerynth.home();`,
  );
  await delay(800);
  await evaluate(
    `window.__aerynth.setReduced(true);window.__aerynth.expand('${first}')`,
  );
  await delay(150);
  s = await snap();
  check(
    "reduced snaps with draft preserved",
    s.reduced && s.expanded === first && s.poses[first].yaw === 0,
    s.poses[first],
  );
  await shot("reduced-motion");
  await evaluate("window.__aerynth.home();window.__aerynth.setReduced(false)");
  await delay(750);
  const resizeOriginalSize = win.getContentSize();
  await evaluate(
    "window.__workspaceResizeArticles=Array.from(document.querySelectorAll('.folio'));window.__workspaceResizeEditors=window.__workspaceResizeArticles.map(el=>el.querySelector('textarea'))",
  );
  const sampleWorkspaceAnchors = async function () {
    const samples = [];
    const startedAt = performance.now();
    for (let index = 0; index < 18; index++) {
      const frameDelivered = await new Promise((resolve) => {
        const frame = requestAnimationFrame(() => {
          clearTimeout(timeout);
          resolve(true);
        });
        const timeout = setTimeout(() => {
          cancelAnimationFrame(frame);
          resolve(false);
        }, 120);
      });
      const state = window.__aerynth.snapshot();
      samples.push({
        frameDelivered,
        elapsedMs: performance.now() - startedAt,
        viewport: { width: innerWidth, height: innerHeight },
        selected: state.selected,
        expanded: state.expanded,
        anchors: Array.from(document.querySelectorAll(".resource-anchor")).map(
          (el) => ({
            resource: el.closest(".folio").dataset.resource,
            opacity: Number.parseFloat(getComputedStyle(el).opacity),
          }),
        ),
        identityRetained: window.__workspaceResizeArticles.every(
          (el, item) =>
            el ===
              document.querySelector(
                '[data-resource="' + el.dataset.resource + '"]',
              ) &&
            window.__workspaceResizeEditors[item] ===
              el.querySelector("textarea"),
        ),
      });
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return samples;
  };
  const workspaceResizeSamples = [];
  for (const selectedID of [null, first]) {
    await evaluate("window.__aerynth.home()");
    if (selectedID) await evaluate(`window.__aerynth.select('${selectedID}')`);
    await delay(750);
    for (const [width, height] of [[1100, 720], resizeOriginalSize]) {
      win.setContentSize(width, height);
      workspaceResizeSamples.push({
        selected: selectedID,
        requestedContentSize: { width, height },
        samples: await evaluate(`(${sampleWorkspaceAnchors.toString()})()`),
      });
    }
  }
  await evaluate("window.__aerynth.home()");
  win.setContentSize(...resizeOriginalSize);
  await delay(650);
  check(
    "ordinary native workspace resize keeps peripheral labels hidden and original editors intact",
    workspaceResizeSamples.length === 4 &&
      workspaceResizeSamples.every(
        (transition) =>
          transition.samples.length === 18 &&
          transition.samples.every(
            (frame) =>
              frame.frameDelivered &&
              frame.expanded === null &&
              frame.selected === transition.selected &&
              frame.identityRetained &&
              frame.anchors.length === 3 &&
              frame.anchors.every(
                (anchor) =>
                  Number.isFinite(anchor.opacity) && anchor.opacity <= 0.01,
              ),
          ),
      ),
    {
      method:
        "Actual owned BrowserWindow content resize narrower and restored, first unselected then selected without expansion; 18 animation-frame samples approximately 25ms apart per transition. Computed anchor opacity is measured, not inferred from controller state.",
      transitions: workspaceResizeSamples,
    },
  );
  for (const [width, height] of [
    [900, 850],
    [1280, 800],
    [1920, 1080],
  ]) {
    win.setContentSize(width, height);
    await delay(900);
    s = await snap();
    check(
      `resize ${width}x${height}`,
      Object.values(s.poses).every(
        (p) =>
          p.x >= 0 &&
          p.y >= 0 &&
          p.x + p.w <= width + 30 &&
          p.y + p.h <= height,
      ),
      s.poses,
    );
    await shot(`resize-${width}`);
    if (width === 900) {
      await evaluate("window.__aerynth.expand('conversation-tidal')");
      await delay(950);
      const compact = await evaluate(
        "(()=>{const v=document.querySelector('#vela').getBoundingClientRect(),r=document.querySelector('.expanded').getBoundingClientRect();return {left:v.left,right:v.right,resourceRight:r.right,width:innerWidth};})()",
      );
      check(
        "compact focused Vela retains a reachable separate corridor",
        compact.left >= compact.resourceRight &&
          compact.right <= compact.width + 1,
        compact,
      );
      await shot("compact-focused");
      await evaluate("window.__aerynth.home()");
    }
  }
  win.setContentSize(1600, 1000);
  await delay(600);
  for (const zoom of [0.8, 1.25, 1.5]) {
    win.webContents.setZoomFactor(zoom);
    await delay(1000);
    s = await snap();
    const viewport = await evaluate("({width:innerWidth,height:innerHeight})");
    check(
      `content zoom ${zoom}`,
      Object.values(s.poses).every(
        (p) =>
          p.x >= 0 &&
          p.y >= 0 &&
          p.x + p.w <= viewport.width + 30 &&
          p.y + p.h <= viewport.height,
      ),
      { viewport, poses: s.poses },
    );
    if (zoom === 1.5) await shot("content-zoom-150");
  }
  win.webContents.setZoomFactor(1);
  await delay(600);
  const sample = async (name, setup, duration = 4500, toggle = false) => {
    if (Date.now() - lastStorageCheck >= 240000) {
      storageReceipts.push(
        admitStorage(maxCaptureBytes - captureBytes + 66 * 1024 * 1024),
      );
      lastStorageCheck = Date.now();
    }
    await evaluate(setup);
    await delay(1200);
    await evaluate("window.__aerynth.resetMetrics()");
    app.getAppMetrics();
    const start = Date.now(),
      cpu = [];
    let workingSets = [];
    while (Date.now() - start < duration) {
      if (toggle === "resize")
        win.setContentSize(
          cpu.length % 2 ? 1600 : 1280,
          cpu.length % 2 ? 1000 : 800,
        );
      else if (toggle === "scene")
        await evaluate(
          `window.__aerynth.setStudy('${cpu.length % 2 ? "architecture" : "living"}')`,
        );
      else if (toggle === "selection")
        await evaluate(
          `window.__aerynth.select(window.__aerynth.snapshot().order[${cpu.length % 3}])`,
        );
      else if (toggle === "rearrange")
        await evaluate(`window.__aerynth.move('${first}',${cpu.length % 3})`);
      else if (toggle === "vela")
        await evaluate(
          `window.__aerynth.setVela('${["receiving", "working", "coordinating", "attention"][cpu.length % 4]}')`,
        );
      else if (toggle === "celestial")
        await evaluate(
          `window.__aerynth.setCelestialStudy('${["starlit", "shadow", "deep"][cpu.length % 3]}')`,
        );
      else if (toggle === "instrument")
        await evaluate(
          `window.__aerynth.setInstrumentStudy('${["optical", "engineered", "composite"][cpu.length % 3]}')`,
        );
      else if (toggle) await evaluate(`window.__aerynth.expand('${first}')`);
      await delay(500);
      const m = app.getAppMetrics();
      cpu.push(m.reduce((sum, p) => sum + p.cpu.percentCPUUsage, 0));
      workingSets.push(m.reduce((sum, p) => sum + p.memory.workingSetSize, 0));
    }
    const state = await snap();
    const sorted = state.metrics.intervals
      .filter((x) => x > 0)
      .sort((a, b) => a - b);
    const ds = state.metrics.drawIntervals
      .filter((x) => x > 0)
      .sort((a, b) => a - b);
    const percentile = (a, p) =>
      a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : null;
    scenarios.push({
      name,
      durationMs: Date.now() - start,
      warmupMs: 1200,
      workload:
        toggle === "resize"
          ? "Focused resource with native content size alternating 1280x800 / 1600x1000 every approximately 500ms"
          : name === "integrated-focus-stream"
            ? "Synthetic sequence, visible event stream, field response and repeated conversation focus/reversal"
            : toggle === "scene"
              ? "Living Intelligence / Luminous Architecture retarget every approximately 500ms around the same resources"
              : toggle === "selection"
                ? "Canonical resource selection changes every approximately 500ms"
                : toggle === "rearrange"
                  ? "Resource reorder and reactive field motion every approximately 500ms"
                  : toggle === "vela"
                    ? "Explicitly synthetic presentation state changes every approximately 500ms"
                    : toggle === "celestial"
                      ? "Celestial study lighting/composition changes every approximately 500ms around the same resources"
                      : toggle === "instrument"
                        ? "Instrument material/structure study changes every approximately 500ms around the same canonical resources"
                        : toggle
                          ? "Scripted resource expansion/reversal every approximately 500ms"
                          : "Same workspace and Vela working expression; no scripted movement (except explicit idle/minimized cases)",
      callbackSamples: sorted.length,
      callbackMs: {
        p50: percentile(sorted, 0.5),
        p95: percentile(sorted, 0.95),
        p99: percentile(sorted, 0.99),
        max: sorted.at(-1) || null,
      },
      drawSamples: state.metrics.draws,
      drawMs: {
        p50: percentile(ds, 0.5),
        p95: percentile(ds, 0.95),
        p99: percentile(ds, 0.99),
      },
      cpuReportedSumMean: cpu.reduce((a, b) => a + b, 0) / cpu.length,
      workingSetKiBSumMean:
        workingSets.reduce((a, b) => a + b, 0) / workingSets.length,
      workingSetKiBSum: {
        first: workingSets[0],
        last: workingSets.at(-1),
        min: Math.min(...workingSets),
        max: Math.max(...workingSets),
        delta: workingSets.at(-1) - workingSets[0],
      },
      state: {
        study: state.study,
        architectureConcept: state.architectureConcept ?? null,
        celestialStudy: state.celestialStudy ?? null,
        instrumentStudy: state.instrumentStudy ?? null,
        environmentPhaseOverrideSeconds: state.environmentPhase ?? null,
        quality: state.quality,
        expanded: state.expanded,
        vela: state.vela,
      },
      policy: state.metrics.policy,
      gpu: state.gpu,
    });
  };
  await evaluate(
    "window.__aerynth.setEnvironmentPhase(null);window.__aerynth.setCelestialStudy('starlit')",
  );
  for (let repeat = 1; repeat <= 2; repeat++) {
    await sample(
      `balanced-active-${repeat}`,
      "window.__aerynth.home();window.__aerynth.setStudy('architecture');window.__aerynth.setArchitectureConcept('ring');window.__aerynth.setQuality('balanced');window.__aerynth.setVela('working')",
    );
    await sample(
      `cinematic-transition-${repeat}`,
      "window.__aerynth.home();window.__aerynth.setStudy('architecture');window.__aerynth.setArchitectureConcept('ring');window.__aerynth.setVela('working');window.__aerynth.setQuality('cinematic')",
      4500,
      true,
    );
    await sample(
      `efficient-${repeat}`,
      "window.__aerynth.home();window.__aerynth.setStudy('architecture');window.__aerynth.setArchitectureConcept('ring');window.__aerynth.setQuality('efficient');window.__aerynth.setVela('working')",
    );
  }
  await sample(
    "cinematic-active",
    "window.__aerynth.home();window.__aerynth.setStudy('architecture');window.__aerynth.setArchitectureConcept('ring');window.__aerynth.setQuality('cinematic');window.__aerynth.setVela('working')",
  );
  for (let repeat = 1; repeat <= 2; repeat++) {
    for (const variant of ["starlit", "shadow", "deep"])
      await sample(
        `celestial-${variant}-ambient-${repeat}`,
        `window.__aerynth.home();window.__aerynth.setStudy('architecture');window.__aerynth.setArchitectureConcept('ring');window.__aerynth.setCelestialStudy('${variant}');window.__aerynth.setQuality('balanced');window.__aerynth.setVela('idle')`,
        3000,
      );
    await sample(
      `celestial-study-switching-${repeat}`,
      "window.__aerynth.home();window.__aerynth.setStudy('architecture');window.__aerynth.setQuality('balanced')",
      3000,
      "celestial",
    );
  }
  await evaluate("window.__aerynth.setCelestialStudy('starlit')");
  for (let repeat = 1; repeat <= 2; repeat++) {
    for (const variant of ["optical", "engineered", "composite"])
      await sample(
        `instrument-${variant}-ambient-${repeat}`,
        `window.__aerynth.home();window.__aerynth.setStudy('architecture');window.__aerynth.setArchitectureConcept('ring');window.__aerynth.setInstrumentStudy('${variant}');window.__aerynth.setQuality('balanced');window.__aerynth.setVela('idle')`,
        3000,
      );
    await sample(
      `instrument-study-switching-${repeat}`,
      "window.__aerynth.home();window.__aerynth.setStudy('architecture');window.__aerynth.setQuality('balanced')",
      3000,
      "instrument",
    );
  }
  await evaluate(
    `window.__aerynth.setInstrumentStudy('${originalInstrumentStudy}')`,
  );
  for (let repeat = 1; repeat <= 2; repeat++) {
    for (const concept of ["ring", "aperture", "observatory"])
      await sample(
        `architecture-${concept}-ambient-${repeat}`,
        `window.__aerynth.home();window.__aerynth.setStudy('architecture');window.__aerynth.setArchitectureConcept('${concept}');window.__aerynth.setQuality('balanced');window.__aerynth.setVela('idle')`,
        3000,
      );
    await sample(
      `living-ambient-${repeat}`,
      "window.__aerynth.home();window.__aerynth.setStudy('living');window.__aerynth.setQuality('balanced');window.__aerynth.setVela('idle')",
      3000,
    );
  }
  await sample(
    "resource-selection",
    "window.__aerynth.home();window.__aerynth.setStudy('living')",
    3000,
    "selection",
  );
  const orderBeforePerformanceMove = (await snap()).order;
  await sample(
    "resource-rearrangement",
    "window.__aerynth.home()",
    4500,
    "rearrange",
  );
  await evaluate(
    `(${JSON.stringify(orderBeforePerformanceMove)}).forEach((id,index)=>window.__aerynth.move(id,index));window.__aerynth.home()`,
  );
  await sample(
    "focused-long-conversation",
    "window.__aerynth.expand('conversation-tidal');window.__aerynth.setStudy('architecture');window.__aerynth.setArchitectureConcept('ring')",
  );
  await sample(
    "focused-research-notebook",
    "window.__aerynth.home();window.__aerynth.expand('research-material')",
  );
  await sample(
    "scene-transitions",
    "window.__aerynth.home();window.__aerynth.setVela('idle')",
    4500,
    "scene",
  );
  await sample(
    "vela-state-changes",
    "window.__aerynth.home();window.__aerynth.setStudy('architecture')",
    4500,
    "vela",
  );
  await sample(
    "integrated-focus-stream",
    "window.__aerynth.home();window.__aerynth.expand('conversation-tidal');window.__aerynth.setQuality('balanced');window.__aerynth.demo()",
    4500,
    true,
  );
  await evaluate(
    "window.__aerynth.stopDemo(true);document.querySelector('#stream-close').click();window.__aerynth.home();window.__aerynth.expand('conversation-tidal');window.__aerynth.setVela('working')",
  );
  await sample("focused-native-resize", "void 0", 4500, "resize");
  win.setContentSize(1600, 1000);
  await evaluate(
    "window.__aerynth.setQuality('balanced');window.__aerynth.home();window.__aerynth.setVela('idle')",
  );
  await delay(13500);
  await sample("ambient-idle", "void 0", 4000);
  s = await snap();
  check(
    "idle Vela keeps ambient motion without pointer input",
    s.metrics.draws >= 40 &&
      s.ambient &&
      s.metrics.policy.includes("ambient idle"),
    { draws: s.metrics.draws, policy: s.metrics.policy },
  );
  await sample("ambient-off", "window.__aerynth.setAmbient(false)", 2500);
  s = await snap();
  check(
    "ambient off stops autonomous rendering",
    s.metrics.draws === 0,
    s.metrics.draws,
  );
  const quietOpticalBefore = (await snap()).gpu?.architecture
    ?.opticalClockSeconds;
  await sample(
    "quiet-static",
    "window.__aerynth.setAmbient(true);document.querySelector('#quiet').checked=true;document.querySelector('#quiet').dispatchEvent(new Event('change'))",
    2500,
  );
  s = await snap();
  check(
    "quiet mode stills the environment",
    s.metrics.draws === 0 &&
      Number.isFinite(quietOpticalBefore) &&
      Math.abs(s.gpu?.architecture?.opticalClockSeconds - quietOpticalBefore) <
        1e-9,
    {
      draws: s.metrics.draws,
      opticalClockBeforeSeconds: quietOpticalBefore,
      opticalClockAfterSeconds: s.gpu?.architecture?.opticalClockSeconds,
    },
  );
  await sample(
    "reduced-motion-static",
    "document.querySelector('#quiet').checked=false;document.querySelector('#quiet').dispatchEvent(new Event('change'));window.__aerynth.setReduced(true);window.__aerynth.home()",
    2500,
  );
  check(
    "reduced motion stops autonomous rendering after reconciliation",
    (await snap()).metrics.draws === 0,
    (await snap()).metrics.draws,
  );
  await evaluate("window.__aerynth.setReduced(false)");
  await evaluate(
    "document.querySelector('#quiet').checked=false;document.querySelector('#quiet').dispatchEvent(new Event('change'))",
  );
  win.minimize();
  await delay(700);
  await sample("native-minimized", "void 0", 4000);
  s = await snap();
  check(
    "native minimized stops rendering",
    s.metrics.draws === 0 && s.active === false,
    {
      draws: s.metrics.draws,
      active: s.active,
      nativeMinimized: win.isMinimized(),
      nativeVisible: win.isVisible(),
    },
  );
  win.restore();
  win.showInactive();
  await delay(700);
  await shot("final-calm");
  s = await snap();
  check(
    "no renderer errors",
    s.metrics.errors.length === 0 && errors.length === 0,
    { renderer: s.metrics.errors, host: errors },
  );
  await evaluate(
    "window.__aerynth.setCelestialStudy('deep');window.__aerynth.setInstrumentStudy('composite');window.__aerynth.setEnvironmentPhase(null)",
  );
  await delay(600);
  await evaluate(
    "document.querySelector('#vela-input').value='Unsent local verification input';window.__aerynth.simulateContextLoss()",
  );
  await delay(600);
  s = await snap();
  check(
    "forced graphics loss retains resources",
    s.graphicsFailed && s.resources.length === 3,
    s.resources.length,
  );
  await shot("graphics-fallback");
  await evaluate("window.__aerynth.restoreContext()");
  await delay(1000);
  s = await snap();
  check(
    "graphics restoration retains DOM and drafts",
    !s.graphicsFailed &&
      s.resources.find((r) => r.id === first).text === before,
    s.graphicsFailed,
  );
  check(
    "unsent Vela input survives graphics restoration",
    await evaluate(
      "document.querySelector('#vela-input').value==='Unsent local verification input'",
    ),
  );
  check(
    "celestial study and phase permission survive actual graphics restoration",
    s.celestialStudy === "deep" &&
      s.environmentPhase === null &&
      s.gpu?.cosmos != null &&
      !s.graphicsFailed,
    {
      celestialStudy: s.celestialStudy,
      environmentPhase: s.environmentPhase,
      cosmos: s.gpu?.cosmos ?? null,
    },
  );
  check(
    "instrument study and original editors survive actual graphics restoration",
    s.instrumentStudy === "composite" &&
      s.gpu?.instruments != null &&
      (await evaluate(
        "window.__instrumentArticles.every((el,index)=>el===document.querySelector('[data-resource=\"'+el.dataset.resource+'\"]')&&window.__instrumentEditors[index]===el.querySelector('textarea'))",
      )),
    {
      instrumentStudy: s.instrumentStudy,
      instruments: s.gpu?.instruments ?? null,
    },
  );
  await evaluate("document.querySelector('#vela-input').value=''");
  await shot("graphics-restored");
  await evaluate("window.__aerynth.resetMetrics()");
  for (let i = 0; i < 16; i++) {
    await evaluate(
      `document.querySelector('[data-resource="${first}"] .title-select').click()`,
    );
    await delay(90);
  }
  s = await snap();
  const inputSamples = s.metrics.inputFeedback;
  const sortedInput = [...inputSamples].sort((a, b) => a - b);
  const inputFeedback = {
    kind: "programmatic DOM click dispatch to next coordinator callback; not optical input-to-display",
    samples: inputSamples.length,
    p50: sortedInput[Math.floor(sortedInput.length * 0.5)],
    p95: sortedInput[Math.floor(sortedInput.length * 0.95)],
    max: sortedInput.at(-1),
  };
  check("input feedback sampled", inputSamples.length >= 12, inputFeedback);
  const display = screen.getDisplayMatching(win.getBounds());
  const report = {
    capturedAt: new Date().toISOString(),
    kind: "actual Electron native renderer; synthetic content",
    sourceRevisionAtLaunch,
    sourceHashesAtLaunch,
    buildAssets: buildAssetsAtLaunch,
    buildAssetHashes: buildAssetHashesAtLaunch,
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    },
    display: {
      size: display.size,
      scaleFactor: display.scaleFactor,
      refreshRate: display.displayFrequency,
    },
    window: {
      width: win.getContentBounds().width,
      height: win.getContentBounds().height,
    },
    startup: {
      moduleToRendererLoadMs: moduleToLoadMs,
      meaning:
        "Native module evaluation to local page load, not OS cold-process startup",
    },
    checks,
    scenarios,
    inputFeedback,
    motionFrames,
    captures,
    manualReviews,
    comparisonBaseline,
    referenceBudgets: {
      hz60FrameMs: 1000 / 60,
      hz120FrameMs: 1000 / 120,
      meaning:
        "Reference display intervals only. Callback and renderer submission observations do not establish presented-frame acceptance.",
    },
    storage: {
      receipts: storageReceipts,
      captureBytes,
      maxCaptureBytes,
      coverage:
        "Bounded local native writer only; not an OS quota, and cannot stop unrelated applications, cloud tasks or processes that did not load this rule.",
    },
    graphicsFeatureStatus: app.getGPUFeatureStatus(),
    errors,
    unavailable: [
      "presented-frame timing",
      "GPU utilization attributable to application",
      "dedicated VRAM attributable to application",
      "optical input-to-display latency",
      "power",
      "multi-display acceptance",
      "physical 60Hz display mode test",
      "external game automatic detection",
    ],
    method:
      "Callback and draw intervals are scheduler observations, not presented FPS. CPU is Electron app-metrics sum, working-set KiB sums can double-count shared pages. Short repeated exploratory runs.",
  };
  await fs.writeFile(
    path.join(evidence, "verification.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        checks: checks.map((c) => ({ name: c.name, passed: c.passed })),
        scenarios: scenarios.map((s) => ({
          name: s.name,
          draws: s.drawSamples,
          p95: s.callbackMs.p95,
        })),
      },
      null,
      2,
    ),
  );
  if (checks.some((c) => !c.passed)) {
    process.exitCode = 1;
    app.exit(1);
  }
}
