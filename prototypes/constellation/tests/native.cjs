/** Native integration harness. Runs only the synthetic loopback fixture. */
const { app, BrowserWindow } = require("electron");
const { installDesktopTestAdmission } = require("../../visual-experience/cinematic-v3/native/native-test-admission.cjs");
const checkDesktopTest = installDesktopTestAdmission({ app, BrowserWindow });
const { spawn } = require("node:child_process");
const {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} = require("node:fs");
const { createHash } = require("node:crypto");
const { tmpdir } = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const fixtureRoot = path.resolve(__dirname, "..");
const data = mkdtempSync(path.join(tmpdir(), "aerynth-constellation-native-"));
const evidence = path.join(fixtureRoot, "evidence");
mkdirSync(evidence, { recursive: true });
app.setPath("userData", path.join(data, "profile"));
app.on("window-all-closed", () => {});
let server, win;
const screenshots = [];
let captureBytes = 0;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function startServer() {
  server = spawn(
    process.env.CONSTELLATION_NODE || "node.exe",
    ["--experimental-strip-types", path.join(fixtureRoot, "demo/server.mts")],
    {
      windowsHide: true,
      env: {
        ...process.env,
        CONSTELLATION_PORT: "4327",
        CONSTELLATION_DATA: path.join(data, "canonical"),
      },
    },
  );
  let output = "";
  server.stdout.on("data", (d) => (output += d));
  server.stderr.on("data", (d) => (output += d));
  for (let i = 0; i < 100; i++) {
    if (output.includes("Synthetic Constellation fixture:")) return;
    await wait(50);
  }
  throw Error(output || "Fixture server failed");
}
async function stopServer() {
  if (!server) return;
  server.kill();
  for (let i = 0; i < 100 && server.exitCode === null; i++) await wait(20);
  server = null;
}
async function js(code) {
  try {
    return await win.webContents.executeJavaScript(code, true);
  } catch (e) {
    throw Error(`Renderer script failed: ${code}\n${e.message}`);
  }
}
async function until(code) {
  for (let i = 0; i < 100; i++) {
    if (await js(code)) return;
    await wait(30);
  }
  throw Error("Timed out: " + code);
}
async function command(id, title) {
  await js(
    "document.querySelector('.aw-quiet-control[aria-label=\"Commands and destinations\"]').click()",
  );
  await js(
    `(()=>{const input=document.querySelector('.aw-destinations input');input.value=${JSON.stringify(title)};input.dispatchEvent(new Event('input'));})()`,
  );
  await js(
    `document.querySelector('.aw-command-row[data-command="${id}"]').click()`,
  );
}
async function capture(name) {
  await wait(100);
  const png = (await win.webContents.capturePage()).toPNG();
  captureBytes += png.length;
  assert.ok(
    captureBytes < 16 * 1024 * 1024,
    "Screenshot allocation bound exceeded",
  );
  writeFileSync(path.join(evidence, name + ".png"), png);
  screenshots.push({
    file: name + ".png",
    bytes: png.length,
    sha256: createHash("sha256").update(png).digest("hex"),
  });
}
const browserErrors = [];
async function open() {
  checkDesktopTest();
  win = new BrowserWindow({
    width: 1440,
    height: 960,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      offscreen: true,
    },
  });
  win.webContents.on("console-message", (event) => {
    if (event.level === "error") browserErrors.push(event.message);
  });
  await win.loadURL("http://127.0.0.1:4327");
  await until("!!window.constellationDemo");
}
app
  .whenReady()
  .then(async () => {
    const started = Date.now();
    await startServer();
    await open();
    const original = await js(
      "JSON.stringify(constellationDemo.snapshot.blocks)",
    );
    assert.equal(
      await js("constellationDemo.view.controller.location.kind"),
      "workspace",
    );
    await capture("01-development-workspace");
    // Small on-demand command surface; no permanent navigation toolbar.
    await command("out", "Zoom out");
    await until("constellationDemo.view.controller.location.kind==='project'");
    await capture("02-project-overview");
    await command("universe", "Universe");
    await until("constellationDemo.view.controller.location.kind==='universe'");
    await wait(1100);
    await capture("03-universe");
    const b = await js(
      "constellationDemo.snapshot.workspaces.find(w=>w.title==='Engineering')",
    );
    await js(
      `constellationDemo.view.controller.approach('project:${b.project_id}')`,
    );
    await wait(300);
    // Keyboard Enter approaches selected workspace proxy.
    await until(`!!document.querySelector('[data-key="workspace:${b.id}"]')`);
    await js(
      `document.querySelector('[data-key="workspace:${b.id}"]').focus()`,
    );
    win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Return" });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Return" });
    await until(
      `constellationDemo.view.controller.location.workspaceId==='${b.id}'`,
    );
    const note = await js(
      "constellationDemo.snapshot.resources.find(r=>r.id===constellationDemo.snapshot.blocks.find(b=>b.workspace_id===constellationDemo.view.controller.location.workspaceId).resource_id)",
    );
    await js(
      `(()=>{let e=document.querySelector('[data-resource="${note.id}"]');e.value='Synthetic native interaction saved through canonical resource kernel.';e.parentElement.querySelector('button').click();})()`,
    );
    await until(
      `constellationDemo.snapshot.resources.find(r=>r.id==='${note.id}').content.startsWith('Synthetic native interaction')`,
    );
    await until(
      "document.querySelector('.aw-constellation').classList.contains('aw-working') && !document.querySelector('#workspace').hidden && document.querySelectorAll('.glass-panel').length===3",
    );
    await capture("04-engineering-workspace");
    await js("constellationDemo.view.controller.zoomOut()");
    await js("constellationDemo.view.controller.go({kind:'universe'})");
    const a = await js(
      "constellationDemo.snapshot.workspaces.find(w=>w.title==='Development')",
    );
    await js(
      `constellationDemo.view.controller.go({kind:'project',projectId:'${a.project_id}'})`,
    );
    await js(`constellationDemo.view.controller.approach('workspace:${a.id}')`);
    assert.equal(
      await js("JSON.stringify(constellationDemo.snapshot.blocks)"),
      original,
    );
    // Direct search by keyboard, pan, reversal, reduced motion and context fallback.
    await js(
      "document.querySelector('.aw-quiet-control[aria-label=\"Commands and destinations\"]').click()",
    );
    await js(
      "(()=>{let s=document.querySelector('input[type=search]');s.value='Engineering';s.dispatchEvent(new Event('input'));s.focus();})()",
    );
    win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Return" });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Return" });
    await until(
      `constellationDemo.view.controller.selected==='workspace:${b.id}'`,
    );
    await js(
      `document.querySelector('[data-key="workspace:${b.id}"]').focus()`,
    );
    win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Return" });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Return" });
    await until(
      `constellationDemo.view.controller.location.workspaceId==='${b.id}'`,
    );
    await js(
      "(async()=>{await constellationDemo.view.controller.zoomOut();document.querySelector('.aw-destinations').hidden=true;})()",
    );
    await js(
      "(()=>{constellationDemo.view.setPolicy({reduced:true});let c=constellationDemo.view.controller;c.spatial.orbit(60,-20);c.spatial.pan(50,40);return c.persist();})()",
    );
    const saved = await js(
      "JSON.stringify(constellationDemo.view.controller.spatial.camera)",
    );
    await js(
      "constellationDemo.view.setPolicy({graphicsAvailable:false});constellationDemo.wake()",
    );
    await wait(70);
    assert.equal(
      await js(
        "document.querySelector('.aw-constellation').classList.contains('aw-graphics-fallback')&&document.querySelectorAll('.aw-anchor').length>0",
      ),
      true,
    );
    await js(
      "constellationDemo.view.setPolicy({graphicsAvailable:true});constellationDemo.wake()",
    );
    await wait(70);
    // Fully restart renderer AND service process, keeping the canonical SQLite file.
    win.destroy();
    await stopServer();
    await startServer();
    await open();
    assert.equal(
      await js(
        "JSON.stringify(constellationDemo.view.controller.spatial.camera)",
      ),
      saved,
    );
    assert.equal(
      await js(
        `constellationDemo.snapshot.resources.find(r=>r.id==='${note.id}').content`,
      ),
      "Synthetic native interaction saved through canonical resource kernel.",
    );
    assert.equal(
      await js("JSON.stringify(constellationDemo.snapshot.blocks)"),
      original,
    );
    await capture("05-restarted-camera");
    const result = {
      schema: 1,
      elapsedMs: Date.now() - started,
      renderer: process.versions.chrome,
      electron: process.versions.electron,
      steps: [
        "Development workspace glass panels",
        "Zoom out to project",
        "Universe",
        "Voyagewright project",
        "Keyboard Enter Engineering workspace",
        "Real canonical note edit",
        "Return Development layout unchanged",
        "Search Enter direct navigation",
        "Reduced motion",
        "Graphics fallback and recovery",
        "Renderer and canonical service restart: camera, edit and geometry preserved",
      ],
      browserErrors,
      screenshots,
      sourceSha256: Object.fromEntries(
        [
          "controller.ts",
          "types.ts",
          "spatial-types.ts",
          "spatial.ts",
          "body-metrics.ts",
          "identity.ts",
          "spacing.ts",
          "renderer3d.ts",
          "planets.ts",
          "controls.ts",
          "graph-controls.ts",
          "projection.ts",
          "view.ts",
          "style.css",
          "demo/main.ts",
          "demo/service.mts",
          "tests/native.cjs",
        ].map((file) => [
          file,
          createHash("sha256")
            .update(readFileSync(path.join(fixtureRoot, file)))
            .digest("hex"),
        ]),
      ),
      limitations:
        "Synthetic isolated fixture, nonvisible Electron offscreen compositor capture. V3.5 scene/Vela and integrated shell acceptance belong to integration lead. Not a presented frame/GPU benchmark.",
    };
    writeFileSync(
      path.join(evidence, "native-verification.json"),
      JSON.stringify(result, null, 2) + "\n",
    );
    assert.deepEqual(browserErrors, []);
    console.log(JSON.stringify(result));
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    win?.destroy();
    await stopServer();
    if (
      path.resolve(data).startsWith(path.resolve(tmpdir()) + path.sep) &&
      path.basename(data).startsWith("aerynth-constellation-native-")
    ) {
      try {
        rmSync(data, { recursive: true, force: true });
      } catch {}
    }
    app.exit(process.exitCode || 0);
  });
