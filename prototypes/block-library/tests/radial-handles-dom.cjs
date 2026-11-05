// Parent-controlled hidden DOM runner. No backend/provider/profile data,
// visible window, foreground recovery, native input or GPU qualification.
const { app, BrowserWindow, session } = require("electron");
const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict");
const { createRequire } = require("node:module"),
  { pathToFileURL } = require("node:url"),
  { createHash } = require("node:crypto"),
  { execFileSync } = require("node:child_process");
const { beforeDeadline } = require("./dom-check-deadline.cjs");
const sourceRoot = path.resolve(__dirname, "../../.."),
  appRoot = path.join(sourceRoot, "prototypes/visual-experience/cinematic-v3"),
  started = Date.now(),
  deadlineAt = started + 27000,
  hardDeadlineAt = started + 30000,
  output = path.join(appRoot, ".runtime/radial-handles", String(started));
const stages = [],
  consoleErrors = [];
let win,
  stage = "bootstrap",
  exitCode = 1,
  admitted = false;
const timer = setTimeout(() => app.exit(1), 30000);
timer.unref();
app.disableHardwareAcceleration();
app.setPath(
  "userData",
  path.join(os.tmpdir(), "aerynth-radial-dom-" + started),
);
const save = async (name, value) => {
  const json = JSON.stringify(value, null, 2);
  assert(Buffer.byteLength(json) <= 512 * 1024, "bounded_DOM_receipt_required");
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, name), json);
};
const enter = async (name) => {
  stage = name;
  stages.push({ stage, elapsedMs: Date.now() - started });
  if (admitted) await save("progress.json", { started, stages });
};
const step = async (name, work) => {
  await enter(name);
  return beforeDeadline(deadlineAt, name, work);
};
app
  .whenReady()
  .then(async () => {
    try {
      await step("reserve-admission", async () => {
        if (process.platform !== "win32") {
          admitted = true;
          return;
        }
        const physical = await fs.realpath(appRoot),
          onC = /^C:/i.test(physical),
          onD = /^D:/i.test(physical);
        assert(onC || onD, "bounded_C_or_D_source_required");
        const admission = JSON.parse(
          execFileSync(
            "powershell.exe",
            [
              "-NoProfile",
              "-File",
              path.join(
                os.homedir(),
                "AppData/Local/AeroStorageWatch/ReserveGuard.ps1",
              ),
              "-EstimatedCBytes",
              String(onC ? 67108864 : 16777216),
              "-EstimatedDBytes",
              String(onD ? 67108864 : 0),
            ],
            { encoding: "utf8", windowsHide: true, timeout: 10000 },
          ),
        );
        assert.equal(admission.allowed, true);
        admitted = true;
      });
      await step("bundle-fixture", async () => {
        const requireApp = createRequire(path.join(appRoot, "package.json")),
          { build } = await import(
            pathToFileURL(requireApp.resolve("vite")).href
          );
        await build({
          root: appRoot,
          publicDir: false,
          configFile: false,
          logLevel: "error",
          build: {
            outDir: output,
            emptyOutDir: false,
            minify: false,
            lib: {
              entry: path.join(__dirname, "radial-handles.browser.mjs"),
              formats: ["iife"],
              name: "RadialQa",
              fileName: () => "suite.js",
            },
          },
        });
      });
      await step("write-fixture", async () => {
        const files = await fs.readdir(output),
          css = files.filter((file) => file.endsWith(".css"));
        await fs.writeFile(
          path.join(output, "index.html"),
          `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'self';style-src 'self' 'unsafe-inline'">${css.map((file) => `<link rel="stylesheet" href="${file}">`).join("")}<script src="suite.js" defer></script><body></body>`,
          { flag: "wx" },
        );
      });
      session.defaultSession.setPermissionRequestHandler((_w, _p, cb) =>
        cb(false),
      );
      session.defaultSession.webRequest.onBeforeRequest(
        { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] },
        (_d, cb) => cb({ cancel: true }),
      );
      win = new BrowserWindow({
        show: false,
        width: 1200,
        height: 900,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          backgroundThrottling: false,
        },
      });
      win.webContents.on("console-message", (_event, details) => {
        if (details.level === "error" && consoleErrors.length < 20)
          consoleErrors.push(String(details.message).slice(0, 1000));
      });
      await step("load-hidden-document", () =>
        win.loadFile(path.join(output, "index.html")),
      );
      const result = await step("actual-DOM-hit-tests", () =>
        win.webContents.executeJavaScript("RadialQa.run()", true),
      );
      const hashes = await step("bind-source", async () => {
        const hashes = {};
        for (const name of [
          "prototypes/block-library/direct-manipulation.css",
          "prototypes/block-library/identity-view.css",
          "prototypes/block-library/pose-style.ts",
          "prototypes/block-library/tests/radial-handles.browser.mjs",
          "prototypes/block-library/tests/radial-handles-dom.cjs",
          "prototypes/block-library/tests/dom-check-deadline.cjs",
          "prototypes/visual-experience/cinematic-v3/src/surface-contour.ts",
        ])
          hashes[name] = createHash("sha256")
            .update(await fs.readFile(path.join(sourceRoot, name)))
            .digest("hex");
        return hashes;
      });
      const failed = result.checks.filter((check) => !check.passed).length;
      await enter("completed");
      await save("verification.json", {
        ...result,
        passed: failed === 0 && consoleErrors.length === 0,
        stages,
        hashes,
        consoleErrors,
        environment: {
          visibleWindow: false,
          hardwareAcceleration: false,
          electron: process.versions.electron,
        },
      });
      process.stdout.write(
        JSON.stringify({
          output,
          checks: result.checks.length,
          handlePoints: result.handlePoints,
          contentPoints: result.contentPoints,
          failed,
          consoleErrors: consoleErrors.length,
        }) + "\n",
      );
      exitCode = failed || consoleErrors.length ? 1 : 0;
    } catch (error) {
      let progress = null;
      if (win && !win.isDestroyed())
        try {
          progress = await beforeDeadline(
            Math.min(hardDeadlineAt - 300, Date.now() + 500),
            "failure-progress",
            () =>
              win.webContents.executeJavaScript(
                "globalThis.__radialProgress??null",
                true,
              ),
          );
        } catch {}
      const failure = {
        contract: "aerynth.curved-card-dom@1",
        passed: false,
        stage,
        stages,
        elapsedMs: Date.now() - started,
        error: String(error?.stack ?? error).slice(0, 6000),
        progress,
        consoleErrors,
        environment: {
          visibleWindow: false,
          hardwareAcceleration: false,
          electron: process.versions.electron,
        },
      };
      try {
        if (admitted) await save("failure.json", failure);
      } catch (saveError) {
        process.stderr.write(
          String(saveError?.message ?? saveError).slice(0, 1000) + "\n",
        );
      }
      process.stderr.write(
        JSON.stringify({
          output,
          passed: false,
          stage,
          error: failure.error,
          progress,
        }) + "\n",
      );
    } finally {
      if (win && !win.isDestroyed()) win.destroy();
      clearTimeout(timer);
      app.exit(exitCode);
    }
  })
  .catch(async (error) => {
    try {
      if (admitted)
        await save("failure.json", {
          passed: false,
          stage,
          error: String(error?.stack ?? error).slice(0, 6000),
          stages,
        });
    } finally {
      clearTimeout(timer);
      app.exit(1);
    }
  });
