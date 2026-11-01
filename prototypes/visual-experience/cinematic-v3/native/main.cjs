const {
  app,
  BrowserWindow,
  session,
  screen,
  nativeTheme,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { pathToFileURL } = require("node:url");
const root = path.resolve(__dirname, "..");
const runtime = path.join(root, ".runtime");
const verifyMode = process.argv.includes("--verify");
const recordMode = process.argv.includes("--record");
const previewMode = process.argv.includes("--preview");
const renderWhileVisible = verifyMode || recordMode || previewMode;
app.setPath(
  "userData",
  path.join(
    runtime,
    recordMode
      ? "recording-profile"
      : verifyMode
        ? "verification-profile"
        : previewMode
          ? "ambient-review-profile"
          : "profile",
  ),
);
app.setAppUserModelId("org.aetherwake.cinematic-v3");
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
      show: !verifyMode,
      width: 1600,
      height: 1000,
      minWidth: 700,
      minHeight: 650,
      backgroundColor: "#05060c",
      titleBarStyle: "hidden",
      titleBarOverlay: { color: "#080910", symbolColor: "#d8cee9", height: 42 },
      title: verifyMode
        ? "Aerynth · Automated native checks"
        : previewMode
          ? "Aerynth · Cinematic V3 · Expressive ambient"
          : "Aerynth · Cinematic V3",
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
    if (verifyMode) {
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
        "window.__aerynth.setStudy('living')",
        true,
      );
    if (recordMode) {
      try {
        const { recordNative } = require("./recording.cjs");
        const file = path.join(runtime, `aerynth-v3-native-${Date.now()}.webm`);
        const result = await recordNative(
          win,
          session.defaultSession,
          localURL,
          file,
        );
        await fs.writeFile(
          path.join(runtime, "recording-latest.json"),
          JSON.stringify(result, null, 2),
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
        await verify();
      } catch (error) {
        console.error(error);
        await fs.mkdir(runtime, { recursive: true });
        await fs.writeFile(
          path.join(runtime, "verification-failure.json"),
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
async function verify() {
  const evidence = path.join(root, "evidence");
  const raw = path.join(evidence, "raw");
  await fs.mkdir(raw, { recursive: true });
  const checks = [];
  const scenarios = [];
  const motionFrames = [];
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
    const image = await capture();
    await fs.writeFile(path.join(evidence, `${name}.png`), image.toPNG());
  };
  const frames = async (name, action, count = 14) => {
    await evaluate(action);
    for (let i = 0; i < count; i++) {
      const image = await capture();
      const file = `${name}-${String(i).padStart(2, "0")}.png`;
      await fs.writeFile(path.join(raw, file), image.toPNG());
      motionFrames.push({
        sequence: name,
        index: i,
        at: Date.now(),
        file: `raw/${file}`,
      });
      await delay(45);
    }
  };
  await delay(800);
  win.showInactive();
  await evaluate("window.__aerynth.setActive(true)");
  await delay(500);
  for (const study of ["architecture", "living", "observatory"]) {
    await evaluate(`window.__aerynth.setStudy('${study}')`);
    await delay(400);
    await shot(`study-${study}`);
  }
  await evaluate("window.__aerynth.setStudy('architecture')");
  await delay(350);
  await shot("environment-idle");
  let s = await snap();
  check("GPU constructed", !s.graphicsFailed, s.gpu);
  check(
    "isolated renderer",
    await evaluate(
      "typeof window.require === 'undefined' && typeof process === 'undefined'",
    ),
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
  await evaluate(
    `window.__verificationArticle=document.querySelector('[data-resource="${first}"]');window.__verificationEditor=window.__verificationArticle.querySelector('textarea');`,
  );
  await frames("selection", `window.__aerynth.select('${first}')`, 10);
  await shot("resource-selected");
  await frames("expansion", `window.__aerynth.expand('${first}')`, 18);
  await shot("resource-expanded");
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
      policy: state.metrics.policy,
      gpu: state.gpu,
    });
  };
  for (let repeat = 1; repeat <= 2; repeat++) {
    await sample(
      `balanced-active-${repeat}`,
      "window.__aerynth.home();window.__aerynth.setQuality('balanced');window.__aerynth.setVela('working')",
    );
    await sample(
      `cinematic-transition-${repeat}`,
      "window.__aerynth.home();window.__aerynth.setVela('working');window.__aerynth.setQuality('cinematic')",
      4500,
      true,
    );
    await sample(
      `efficient-${repeat}`,
      "window.__aerynth.home();window.__aerynth.setQuality('efficient');window.__aerynth.setVela('working')",
    );
  }
  await sample(
    "cinematic-active",
    "window.__aerynth.home();window.__aerynth.setQuality('cinematic');window.__aerynth.setVela('working')",
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
  await sample(
    "quiet-static",
    "window.__aerynth.setAmbient(true);document.querySelector('#quiet').checked=true;document.querySelector('#quiet').dispatchEvent(new Event('change'))",
    2500,
  );
  s = await snap();
  check(
    "quiet mode stills the environment",
    s.metrics.draws === 0,
    s.metrics.draws,
  );
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
    buildAssets: (await fs.readdir(path.join(root, "dist/assets"))).sort(),
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
