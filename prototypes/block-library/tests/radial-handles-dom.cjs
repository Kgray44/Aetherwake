// Parent-controlled hidden DOM runner. SOURCE ONLY until explicitly run by the
// native-slot owner. No backend/provider/profile data, visible window or input.
const { app, BrowserWindow, session } = require("electron");
const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict");
const { createRequire } = require("node:module"),
  { pathToFileURL } = require("node:url"),
  { createHash } = require("node:crypto"),
  { execFileSync } = require("node:child_process");
const sourceRoot = path.resolve(__dirname, "../../.."),
  appRoot = path.join(sourceRoot, "prototypes/visual-experience/cinematic-v3"),
  output = path.join(appRoot, ".runtime/radial-handles", String(Date.now()));
let win;
const timer = setTimeout(() => app.exit(1), 30000);
timer.unref();
app.disableHardwareAcceleration();
app.setPath(
  "userData",
  path.join(os.tmpdir(), "aerynth-radial-dom-" + Date.now()),
);
app
  .whenReady()
  .then(async () => {
    try {
      if (process.platform === "win32") {
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
      }
      const requireApp = createRequire(path.join(appRoot, "package.json")),
        { build } = await import(
          pathToFileURL(requireApp.resolve("vite")).href
        );
      await build({
        root: appRoot,
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
      const files = await fs.readdir(output),
        css = files.filter((file) => file.endsWith(".css"));
      await fs.writeFile(
        path.join(output, "index.html"),
        `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'self';style-src 'self' 'unsafe-inline'">${css.map((file) => `<link rel="stylesheet" href="${file}">`).join("")}<script src="suite.js" defer></script><body></body>`,
        { flag: "wx" },
      );
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
      await win.loadFile(path.join(output, "index.html"));
      const result = await win.webContents.executeJavaScript(
          "RadialQa.run()",
          true,
        ),
        hashes = {};
      for (const name of [
        "prototypes/block-library/direct-manipulation.css",
        "prototypes/block-library/identity-view.css",
        "prototypes/block-library/pose-style.ts",
        "prototypes/block-library/tests/radial-handles.browser.mjs",
        "prototypes/block-library/tests/radial-handles-dom.cjs",
        "prototypes/visual-experience/cinematic-v3/src/surface-contour.ts",
      ])
        hashes[name] = createHash("sha256")
          .update(await fs.readFile(path.join(sourceRoot, name)))
          .digest("hex");
      const receipt = JSON.stringify(
        {
          ...result,
          hashes,
          environment: {
            visibleWindow: false,
            hardwareAcceleration: false,
            electron: process.versions.electron,
          },
        },
        null,
        2,
      );
      assert(
        Buffer.byteLength(receipt) <= 512 * 1024,
        "bounded_DOM_receipt_required",
      );
      await fs.writeFile(path.join(output, "verification.json"), receipt, {
        flag: "wx",
      });
      const failed = result.checks.filter((check) => !check.passed).length;
      process.stdout.write(
        JSON.stringify({
          output,
          checks: result.checks.length,
          handlePoints: result.handlePoints,
          contentPoints: result.contentPoints,
          failed,
        }) + "\n",
      );
      win.destroy();
      win = undefined;
      clearTimeout(timer);
      app.exit(failed ? 1 : 0);
    } catch (error) {
      process.stderr.write(String(error?.stack ?? error).slice(0, 6000) + "\n");
      if (win && !win.isDestroyed()) win.destroy();
      clearTimeout(timer);
      app.exit(1);
    }
  })
  .catch((error) => {
    process.stderr.write(String(error?.stack ?? error).slice(0, 6000) + "\n");
    app.exit(1);
  });
