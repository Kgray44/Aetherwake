// Isolated hidden DOM/component validation. It never imports the application
// backend, provider, workspace data or production renderer scheduling.
const { app, BrowserWindow, session } = require("electron");
const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os"),
  { createHash } = require("node:crypto");
const root = path.resolve(__dirname, ".."),
  out = path.join(root, ".runtime/contextual-surfaces", String(Date.now()));
app.setPath(
  "userData",
  path.join(os.tmpdir(), "aerynth-contextual-component-" + Date.now()),
);
// DOM/focus/layout checks do not need a hardware GPU or a visible window.
app.disableHardwareAcceleration();
app
  .whenReady()
  .then(async () => {
    const { build } = await import("vite");
    await build({
      root,
      configFile: false,
      logLevel: "error",
      build: {
        outDir: out,
        emptyOutDir: false,
        minify: false,
        lib: {
          entry: path.join(root, "tests/contextual-surfaces.browser.mjs"),
          formats: ["iife"],
          name: "ContextualQa",
          fileName: () => "suite.js",
        },
      },
    });
    const css = (await fs.readdir(out)).filter((f) => f.endsWith(".css"));
    await fs.writeFile(
      path.join(out, "index.html"),
      `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'self';style-src 'self' 'unsafe-inline'">${css.map((f) => `<link rel="stylesheet" href="${f}">`).join("")}<script src="suite.js" defer></script><body></body>`,
    );
    session.defaultSession.setPermissionRequestHandler((_w, _p, callback) =>
      callback(false),
    );
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] },
      (_d, callback) => callback({ cancel: true }),
    );
    const win = new BrowserWindow({
      show: false,
      width: 800,
      height: 600,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    await win.loadFile(path.join(out, "index.html"));
    const result = await win.webContents.executeJavaScript(
      "ContextualQa.run()",
      true,
    );
    const hashes = {};
    for (const file of [
      "src/contextual-surfaces.ts",
      "src/contextual-surfaces.css",
      "tests/contextual-surfaces.browser.mjs",
      "native/contextual-surfaces-verify.cjs",
    ]) {
      const bytes = await fs.readFile(path.join(root, file));
      hashes[file] = createHash("sha256").update(bytes).digest("hex");
    }
    await fs.writeFile(
      path.join(out, "verification.json"),
      JSON.stringify(
        {
          ...result,
          sources: hashes,
          environment: {
            visibleWindow: false,
            hardwareAcceleration: false,
            electron: process.versions.electron,
          },
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({
        out,
        checks: result.checks.length,
        failed: result.checks.filter((c) => !c.passed).length,
      }),
    );
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
