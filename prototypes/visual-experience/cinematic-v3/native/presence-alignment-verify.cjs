const { app } = require("electron");
const path = require("node:path"),
  fs = require("node:fs/promises"),
  sync = require("node:fs");
const { createHash } = require("node:crypto"),
  { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, ".."),
  stamp = Date.now(),
  out = path.join(root, ".runtime/presence-alignment", String(stamp));
process.argv.push(
  `--profile=${path.join(app.getPath("temp"), "aerynth-presence-alignment-" + stamp)}`,
);
const pause = (ms) => new Promise((r) => setTimeout(r, ms)),
  hash = (b) => createHash("sha256").update(b).digest("hex");
const hashes = {};
for (const dir of ["src", "native"])
  for (const name of sync.readdirSync(path.join(root, dir)))
    if (/\.(ts|css|cjs)$/.test(name))
      hashes[dir + "/" + name] = hash(
        sync.readFileSync(path.join(root, dir, name)),
      );
const receipt = {
  kind: "Actual native animated Vela containment and independent GPU raster verification",
  at: new Date().toISOString(),
  synthetic: true,
  sourceRevision: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  }).trim(),
  sourceHashes: hashes,
  buildAssets: Object.fromEntries(
    sync
      .readdirSync(path.join(root, "dist/assets"))
      .map((n) => [
        n,
        hash(sync.readFileSync(path.join(root, "dist/assets", n))),
      ]),
  ),
  checks: [],
  samples: [],
  captures: [],
  errors: [],
};
app.on("browser-window-created", (_e, win) =>
  win.webContents.once("did-finish-load", () =>
    run(win)
      .then(() => app.quit())
      .catch(async (e) => {
        receipt.errors.push(String(e));
        await fs.mkdir(out, { recursive: true });
        await fs.writeFile(
          path.join(out, "failed.json"),
          JSON.stringify(receipt, null, 2),
        );
        console.error(e);
        app.exit(1);
      }),
  ),
);
async function run(win) {
  await fs.mkdir(out, { recursive: true });
  win.focus();
  const js = (c) => win.webContents.executeJavaScript(c, true),
    state = () => js("window.__aerynth.application()");
  const execute = (c) => js(`window.__aerynth.execute(${JSON.stringify(c)})`);
  const check = (name, passed, detail) => {
    receipt.checks.push({ name, passed: !!passed, detail });
    if (!passed) throw Error(name);
  };
  const deadline = Date.now() + 15000;
  while (!(await js('document.body.classList.contains("application-ready")'))) {
    if (Date.now() > deadline) throw Error("startup timeout");
    await pause(60);
  }
  win.webContents.on("console-message", (e) => {
    if (e.level === "error") receipt.errors.push(e.message);
  });
  await execute({
    type: "createWorkspace",
    title: "Synthetic Vela alignment",
    projectId: null,
  });
  const workspace = (await state()).activeWorkspaceId;
  for (const [kind, title] of [
    ["note", "A neighboring resource"],
    ["conversation", "Vela remains independent"],
  ])
    await execute({
      type: "createResource",
      workspaceId: workspace,
      kind,
      title,
    });
  let s = await state();
  await execute({
    type: "setPresence",
    workspaceId: workspace,
    expectedVersion: s.presence.version,
    placement: { x: 650, y: 280, width: 208, height: 260 },
  });
  const canonical = () => state().then((s) => JSON.stringify(s.presence));
  const gather = async (name, mask = true) => {
    const a = await js(
      `(()=>{const e=document.querySelector('#vela'),r=e.getBoundingClientRect(),snap=window.__aerynth.snapshot();return{snapshot:snap,card:{x:r.x,y:r.y,w:r.width,h:r.height},children:[...e.querySelectorAll('.vela-grip,.vela-label small')].filter(e=>getComputedStyle(e).display!=='none').map(e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})}})()`,
    );
    const m = mask
      ? await js("window.__aerynth.presenceMaskForReview()")
      : null;
    const b = a.snapshot.gpu.presenceBounds,
      f = a.snapshot.gpu.presenceProjection.fit;
    const c = a.card;
    check(
      name + " actual deformed vertex center/containment",
      f && f.centerErrorCssPx < 0.05 && f.overflowCssPx < 0.05,
      { bounds: b, fit: f },
    );
    if (
      a.snapshot.spatial?.location?.kind === "workspace" ||
      (await state()).navigation.kind === "workspace"
    )
      check(
        name + " descendants remain in the exact card",
        a.children.every(
          (r) =>
            r.x >= c.x - 0.5 &&
            r.y >= c.y - 0.5 &&
            r.x + r.w <= c.x + c.w + 0.5 &&
            r.y + r.h <= c.y + c.h + 0.5,
        ),
        { card: c, children: a.children },
      );
    if (m) {
      const p = m.bounds,
        t = f.target;
      check(
        name + " independent GPU raster agrees",
        p &&
          Math.abs(p.x - b.x) < 1.6 &&
          Math.abs(p.y - b.y) < 1.6 &&
          Math.abs(p.x + p.w - b.x - b.w) < 1.6 &&
          Math.abs(p.y + p.h - b.y - b.h) < 1.6,
        { gpuMask: m, cpuBounds: b },
      );
      check(
        name + " raster stays in the reserved body region",
        p &&
          p.x >= t.x - 1 &&
          p.y >= t.y - 1 &&
          p.x + p.w <= t.x + t.w + 1 &&
          p.y + p.h <= t.y + t.h + 1,
        { mask: p, target: t },
      );
    }
    receipt.samples.push({
      name,
      card: c,
      children: a.children,
      bounds: b,
      projection: a.snapshot.gpu.presenceProjection,
      gpuMask: m,
      quality: a.snapshot.gpu.quality,
      reduced: a.snapshot.reduced,
      phase: a.snapshot.presenceReviewPhase,
    });
    return a;
  };
  let written = 0;
  const shot = async (name) => {
    const b = (await win.webContents.capturePage()).toPNG();
    written += b.length;
    if (written > 96 * 1024 * 1024 || b.length > 8 * 1024 * 1024)
      throw Error("PNG cap");
    await fs.writeFile(path.join(out, name + ".png"), b, { flag: "wx" });
    receipt.captures.push({
      file: name + ".png",
      bytes: b.length,
      sha256: hash(b),
    });
  };
  for (const quality of ["cinematic", "balanced", "efficient"]) {
    await js(`window.__aerynth.setQuality(${JSON.stringify(quality)})`);
    for (const zoom of [0.125, 0.25, 1, 1.75]) {
      // Recenter the canonical workspace view so every raster probe is onscreen.
      await execute({
        type: "setViewport",
        workspaceId: workspace,
        viewport: { x: 350 - 754 * zoom, y: 430 - 410 * zoom, zoom },
      });
      await pause(850);
      for (const phase of [0, 2.7, 6.1, 11.3, 18.8, 30.2]) {
        await js(`window.__aerynth.setPresencePhaseForReview(${phase})`);
        await pause(55);
        await gather(quality + " zoom" + zoom + " phase" + phase);
      }
      if (zoom === 1 || zoom === 0.125) await shot(quality + "-zoom-" + zoom);
    }
  }
  await execute({
    type: "setViewport",
    workspaceId: workspace,
    viewport: { x: 0, y: 0, zoom: 1 },
  });
  await pause(850);
  await js(
    'window.__aerynth.setQuality("balanced");window.__aerynth.setPresencePhaseForReview(null)',
  );
  const p = await js(
    `(()=>{const e=document.querySelector('.vela-grip'),r=e.getBoundingClientRect(),x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2),h=document.elementFromPoint(x,y);if(h!==e&&!e.contains(h))throw Error('Vela grip occluded');return{x,y}})()`,
  );
  const before = await canonical();
  win.webContents.sendInputEvent({ type: "mouseMove", ...p });
  win.webContents.sendInputEvent({
    type: "mouseDown",
    button: "left",
    clickCount: 1,
    ...p,
  });
  await pause(80);
  for (let i = 1; i <= 24; i++) {
    win.webContents.sendInputEvent({
      type: "mouseMove",
      x: Math.round(p.x + (240 * i) / 24),
      y: Math.round(p.y + (75 * i) / 24),
      modifiers: ["leftbuttondown"],
    });
    await pause(45);
    if (i % 6 === 0) {
      await gather("actual native drag step" + i);
      if (i === 12) await shot("native-drag-midpoint");
    }
  }
  win.webContents.sendInputEvent({
    type: "mouseUp",
    button: "left",
    clickCount: 1,
    x: p.x + 240,
    y: p.y + 75,
  });
  await pause(850);
  check(
    "native drag commits real canonical placement",
    (await canonical()) !== before,
  );
  await gather("native drop settled");
  await shot("native-drop");
  await js("window.__aerynth.setReduced(true)");
  await gather("reduced motion");
  await shot("reduced-motion");
  await js("window.__aerynth.setReduced(false)");
  win.setContentSize(1050, 800);
  await pause(900);
  await gather("native resized viewport");
  await shot("native-resized");
  const saved = await canonical();
  await execute({
    type: "navigate",
    target: { kind: "constellation", projectId: null },
  });
  await pause(1200);
  await gather("universe upper-right");
  await shot("universe-upper-right");
  check(
    "overview preserves exact saved workspace presence",
    (await canonical()) === saved,
  );
  check("no renderer errors", receipt.errors.length === 0, receipt.errors);
  receipt.pngBytes = written;
  await fs.writeFile(
    path.join(out, "verification.json"),
    JSON.stringify(receipt, null, 2),
  );
  console.log(
    JSON.stringify({
      out,
      checks: receipt.checks.length,
      samples: receipt.samples.length,
      captures: receipt.captures.length,
      errors: receipt.errors,
    }),
  );
}
require("./desktop-main.cjs");
