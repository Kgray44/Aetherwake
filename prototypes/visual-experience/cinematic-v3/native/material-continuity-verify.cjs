const { app, session } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, ".."),
  repository = path.resolve(root, "../../..");
const stamp = Date.now(),
  out = path.join(root, ".runtime/material-continuity", String(stamp));
process.argv.push(
  `--profile=${path.join(app.getPath("temp"), "aerynth-material-continuity-" + stamp)}`,
);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sourceHashes = {};
function hashTree(folder) {
  for (const entry of fsSync.readdirSync(folder, { withFileTypes: true })) {
    if (
      entry.name.startsWith(".") ||
      entry.name === "node_modules" ||
      entry.name === "evidence"
    )
      continue;
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) hashTree(full);
    else if (/\.(ts|mts|css|cjs|sql)$/.test(entry.name))
      sourceHashes[path.relative(repository, full).replaceAll("\\", "/")] =
        hash(fsSync.readFileSync(full));
  }
}
for (const folder of [
  "prototypes/visual-experience/cinematic-v3/src",
  "prototypes/visual-experience/cinematic-v3/native",
  "prototypes/workspace-engine",
  "prototypes/workspace-kernel",
  "prototypes/integrated-backend/src",
  "prototypes/application-contract",
])
  hashTree(path.join(repository, folder));
const receipt = {
  kind: "Native optical continuity and overlap verification",
  at: new Date().toISOString(),
  sourceRevision: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  }).trim(),
  sourceHashes,
  buildAssets: Object.fromEntries(
    fsSync
      .readdirSync(path.join(root, "dist/assets"))
      .map((name) => [
        name,
        hash(fsSync.readFileSync(path.join(root, "dist/assets", name))),
      ]),
  ),
  synthetic: true,
  checks: [],
  samples: [],
  captures: [],
  pointerInputs: [],
  scale: [],
  errors: [],
  limits: {
    pngBytes: 160 * 1024 * 1024,
    videoBytes: 32 * 1024 * 1024,
    videoMs: 35000,
  },
};
let written = 0;
app.on("browser-window-created", (_event, win) =>
  win.webContents.once("did-finish-load", () => {
    run(win)
      .then(() => app.quit())
      .catch(async (error) => {
        receipt.errors.push(String(error));
        await fs.mkdir(out, { recursive: true });
        await fs.writeFile(
          path.join(out, "verification-failed.json"),
          JSON.stringify(receipt, null, 2),
        );
        console.error(error);
        app.exit(1);
      });
  }),
);
async function run(win) {
  await fs.mkdir(out, { recursive: true });
  win.setTitle(`Aerynth · Optical continuity review · ${stamp}`);
  win.focus();
  const js = (code) => win.webContents.executeJavaScript(code, true);
  win.webContents.on("console-message", (event) => {
    if (event.level === "error") receipt.errors.push(event.message);
  });
  const wait = async (expression) => {
    const end = Date.now() + 15000;
    while (Date.now() < end) {
      if (await js(expression)) return;
      await pause(60);
    }
    throw Error("Timed out: " + expression);
  };
  const check = (name, ok, detail) => {
    receipt.checks.push({ name, passed: !!ok, detail });
    if (!ok) throw Error(name);
  };
  await wait('document.body.classList.contains("application-ready")');
  const execute = (command) =>
    js(`window.__aerynth.execute(${JSON.stringify(command)})`);
  const snapshot = () => js("window.__aerynth.snapshot()");
  const state = () => js("window.__aerynth.application()");
  await execute({
    type: "createWorkspace",
    title: "Synthetic glass continuity",
    projectId: null,
  });
  const workspace = (await state()).activeWorkspaceId;
  for (const [kind, title] of [
    ["conversation", "Light stays with the surface"],
    ["research", "An optical research lens"],
    ["note", "A quiet glass note"],
  ])
    await execute({
      type: "createResource",
      kind,
      title,
      workspaceId: workspace,
    });
  let blocks = (await state()).blocks;
  const ids = ["conversation", "research", "note"].map(
    (kind) =>
      blocks.find((b) =>
        (receipt.resources ?? []).some(
          (r) => r.id === b.resource_id && r.kind === kind,
        ),
      )?.id,
  );
  const current = await state();
  receipt.resources = current.resources;
  for (let i = 0; i < ids.length; i++)
    ids[i] = current.blocks.find(
      (b) =>
        current.resources.find((r) => r.id === b.resource_id)?.kind ===
        ["conversation", "research", "note"][i],
    ).id;
  const geometry = async (id, pose, shape) => {
    const b = (await state()).blocks.find((b) => b.id === id);
    await execute({
      type: "geometry",
      blockId: id,
      expectedVersion: b.version,
      placement: {
        x: pose.x,
        y: pose.y,
        width: pose.w,
        height: pose.h,
        z: pose.z ?? b.z,
      },
      shape: shape ?? b.shape,
      rotation: pose.rotation ?? b.rotation ?? 0,
    });
  };
  await geometry(ids[0], { x: 100, y: 310, w: 440, h: 230, z: 30 }, "folio");
  await geometry(ids[1], { x: 1030, y: 405, w: 270, h: 270, z: 20 }, "lens");
  await geometry(ids[2], { x: 620, y: 650, w: 330, h: 170, z: 10 }, "rounded");
  const baselineIds = (await state()).blocks.map((b) => [b.id, b.resource_id]);
  const separated = [
    {
      id: ids[0],
      pose: { x: 100, y: 300, w: 440, h: 230, lift: 0, yaw: 0, opacity: 1 },
    },
    {
      id: ids[1],
      pose: { x: 1030, y: 405, w: 270, h: 270, lift: 0, yaw: 0, opacity: 1 },
    },
    {
      id: ids[2],
      pose: { x: 620, y: 650, w: 330, h: 170, lift: 0, yaw: 0, opacity: 1 },
    },
  ];
  const preview = async (updates, snap = true) => {
    await js(
      `window.__aerynth.previewForReview(${JSON.stringify(updates)},${snap})`,
    );
  };
  const reset = async () => {
    await js("window.__aerynth.home()");
    await pause(700);
    await preview(separated);
    await pause(100);
  };
  await js(
    'window.__aerynth.setEnvironmentPhase(0);window.__aerynth.setQuality("balanced");window.__aerynth.setReduced(false)',
  );
  await js(
    'window.__materialArticles=[...document.querySelectorAll(".folio")];window.__materialEditors=window.__materialArticles.map(e=>e.querySelector("textarea"))',
  );
  const diagnostic = () =>
    js(
      `({snapshot:window.__aerynth.snapshot(),cards:[...document.querySelectorAll('.folio')].map(e=>({id:e.dataset.block,resourceId:e.dataset.resource,rootBackground:getComputedStyle(e).backgroundColor,background:getComputedStyle(e,'::before').backgroundColor,clip:getComputedStyle(e.querySelector('.resource-presentation')).clipPath,z:Number(getComputedStyle(e).zIndex),transform:getComputedStyle(e).transform,opacity:Number(getComputedStyle(e).opacity),headerBackground:getComputedStyle(e.querySelector('.folio-top')).backgroundColor,controlsClipped:[...e.querySelectorAll('.block-tools,.resize-handle')].every(c=>!!c.closest('.resource-presentation')),readingBackground:e.querySelector('.working-content')?getComputedStyle(e.querySelector('.working-content')).backgroundColor:null})),materialMode:document.querySelector('#world').dataset.materials,identityRetained:window.__materialArticles.every((e,i)=>e===document.querySelector('[data-block="'+e.dataset.block+'"]')&&e.querySelector('textarea')===window.__materialEditors[i])})`,
    );
  const sample = async (name, settle = 130) => {
    await pause(settle);
    const d = await diagnostic();
    receipt.samples.push({ name, ...d });
    const bytes = (await win.webContents.capturePage()).toPNG();
    written += bytes.length;
    if (bytes.length > 8 * 1024 * 1024 || written > receipt.limits.pngBytes)
      throw Error("native PNG allocation cap");
    await fs.writeFile(path.join(out, name + ".png"), bytes, { flag: "wx" });
    receipt.captures.push({
      file: name + ".png",
      bytes: bytes.length,
      sha256: hash(bytes),
    });
    return d;
  };
  const optical = (d) =>
    d.materialMode === "physical" &&
    d.cards.every((c) => c.background === "rgba(8, 13, 21, 0.06)") &&
    d.snapshot.gpu.instruments.surfaces.every((s) => s.faceOpacity === 1);
  await reset();
  check(
    "three unselected resources retain optical coating",
    optical(await sample("01-unselected-three")),
  );
  for (let i = 0; i < ids.length; i++) {
    await js(`window.__aerynth.select(${JSON.stringify(ids[i])})`);
    await pause(400);
    await preview(separated);
    const d = await sample(
      "02-selected-" + ["conversation", "research", "note"][i],
    );
    check("selection preserves glass " + i, optical(d) && d.identityRetained);
  }
  const overlap = async (x, y = 420, w = 440, h = 230) => {
    await reset();
    await preview([
      { id: ids[1], pose: { x: 620, y: 420, w: 270, h: 270 } },
      { id: ids[2], pose: { x: 1080, y: 680, w: 330, h: 170 } },
      { id: ids[0], pose: { x, y, w, h } },
    ]);
  };
  for (const [name, x] of [
    ["minor-edge", 185],
    ["quarter", 250],
    ["major", 450],
    ["complete", 620],
  ]) {
    await overlap(
      x,
      420,
      name === "complete" ? 440 : 440,
      name === "complete" ? 300 : 230,
    );
    const d = await sample("03-" + name);
    check(
      "persistent optical surface during " + name,
      optical(d) && d.cards.some((c) => c.clip !== "none"),
    );
  }
  await reset();
  await preview([
    { id: ids[0], pose: { x: 530, y: 430, w: 440, h: 240 } },
    { id: ids[1], pose: { x: 600, y: 460, w: 270, h: 270 } },
    { id: ids[2], pose: { x: 650, y: 510, w: 330, h: 170 } },
  ]);
  const triple = await sample("04-three-overlap");
  check(
    "three overlapping resources preserve opaque substrates and clipping union",
    optical(triple) &&
      triple.cards.every((c) => c.controlsClipped) &&
      triple.cards.filter((c) => c.clip !== "none").length >= 2,
  );
  await js(`window.__aerynth.select(${JSON.stringify(ids[1])})`);
  await preview([
    { id: ids[0], pose: { x: 530, y: 430, w: 440, h: 240 } },
    { id: ids[1], pose: { x: 600, y: 460, w: 270, h: 270 } },
    { id: ids[2], pose: { x: 650, y: 510, w: 330, h: 170 } },
  ]);
  const selectedOverlap = await sample("05-selected-while-overlapping");
  check(
    "selection does not secretly raise a rear desktop resource",
    selectedOverlap.cards.find((c) => c.id === ids[0]).z >
      selectedOverlap.cards.find((c) => c.id === ids[1]).z,
  );
  await reset();
  await preview([
    { id: ids[0], pose: { x: 410, y: 360, w: 440, h: 230, yaw: 18 } },
    { id: ids[1], pose: { x: 650, y: 420, w: 270, h: 270, yaw: -13 } },
  ]);
  check(
    "yaw retains finite projected clipping",
    optical(await sample("06-yaw-overlap")),
  );
  await geometry(
    ids[0],
    { x: 320, y: 300, w: 440, h: 230, z: 30, rotation: 27 },
    "folio",
  );
  await reset();
  await preview([
    { id: ids[0], pose: { x: 440, y: 370 } },
    { id: ids[1], pose: { x: 650, y: 420 } },
  ]);
  check(
    "planar rotation retains material continuity",
    optical(await sample("07-planar-rotation-overlap")),
  );
  await geometry(
    ids[0],
    { x: 100, y: 310, w: 440, h: 230, z: 30, rotation: 0 },
    "folio",
  );
  await reset();
  await preview([
    { id: ids[0], pose: { x: 200, y: 380, w: 760, h: 340 } },
    { id: ids[1], pose: { x: 650, y: 420, w: 270, h: 270 } },
  ]);
  const resized = await sample("08-resized-overlap");
  check(
    "resizing cannot activate reading material or replace editor",
    Object.values(resized.snapshot.materialUnfold).every((u) => u === 0) &&
      optical(resized) &&
      resized.identityRetained,
  );
  for (const study of ["living", "architecture"]) {
    await js(`window.__aerynth.setStudy(${JSON.stringify(study)})`);
    await pause(800);
    check(
      "same overlap material in " + study,
      optical(await sample("09-" + study + "-overlap")),
    );
  }
  await reset();
  await js(`window.__aerynth.expand(${JSON.stringify(ids[0])})`);
  await sample("10-focus-transition", 120);
  await pause(650);
  const focused = await sample("11-focused-reading");
  check(
    "focused text has an opaque local reading region and persistent article",
    focused.cards.find((c) => c.id === ids[0]).readingBackground ===
      "rgb(11, 16, 25)" &&
      focused.identityRetained &&
      focused.snapshot.materialUnfold[ids[0]] > 0.99,
  );
  await js("window.__aerynth.home()");
  await sample("12-return-transition", 100);
  await pause(600);
  await js(`window.__aerynth.expand(${JSON.stringify(ids[0])})`);
  await pause(110);
  await js("window.__aerynth.home()");
  await pause(750);
  check(
    "focus reversal restores the same resources",
    (await diagnostic()).identityRetained,
  );
  await reset();
  await js('window.__aerynth.setQuality("efficient")');
  await pause(200);
  const efficient = await sample("13-efficient-fallback");
  check(
    "Efficient is an explicit readable fallback",
    efficient.materialMode === "opaque" &&
      efficient.cards.every((c) => !c.rootBackground.startsWith("rgba")),
  );
  await js(
    'window.__aerynth.setQuality("balanced");window.__aerynth.simulateContextLoss()',
  );
  await wait("window.__aerynth.snapshot().graphicsFailed");
  await sample("14-context-loss");
  await js("window.__aerynth.restoreContext()");
  await wait("!window.__aerynth.snapshot().graphicsFailed");
  await pause(500);
  check(
    "context recovery restores materials and persistent content",
    optical(await sample("15-context-restored")),
  );
  await js("window.__aerynth.setReduced(true)");
  await js(`window.__aerynth.expand(${JSON.stringify(ids[2])})`);
  const reduced = await sample("16-reduced-focused");
  check(
    "reduced focus reconciles optical unfolding immediately",
    reduced.snapshot.materialUnfold[ids[2]] === 1,
  );
  await js("window.__aerynth.home();window.__aerynth.setReduced(false)");
  check(
    "all canonical identities survived material and layering changes",
    JSON.stringify(
      (await state()).blocks.map((b) => [b.id, b.resource_id]).sort(),
    ) === JSON.stringify(baselineIds.sort()),
  );
  // Native pointer input, while renderer callbacks collect actual delivered states.
  await reset();
  await pause(600);
  let pointerIndex = 0;
  await js(
    `window.__materialTrace=[];window.__materialTraceRunning=true;(function sampleFrame(t){if(!window.__materialTraceRunning)return;if(window.__materialTrace.length<3600)window.__materialTrace.push({t,cards:[...document.querySelectorAll('.folio')].map(e=>({id:e.dataset.block,veil:getComputedStyle(e,'::before').backgroundColor,unfold:Number(e.style.getPropertyValue('--unfold')),clipLength:getComputedStyle(e.querySelector('.resource-presentation')).clipPath.length,valid:!e.style.cssText.includes('NaN')&&!e.style.cssText.includes('Infinity')}))});requestAnimationFrame(sampleFrame)})(performance.now())`,
  );
  const pointerDrag = async (selector, dx, dy, duration = 2200) => {
    const start = await js(
      `(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`,
    );
    receipt.pointerInputs.push({
      selector,
      dx,
      dy,
      durationMs: duration,
      method: "webContents native mouse input",
    });
    win.webContents.sendInputEvent({ type: "mouseMove", ...start });
    win.webContents.sendInputEvent({
      type: "mouseDown",
      button: "left",
      clickCount: 1,
      ...start,
    });
    for (let i = 1; i <= 60; i++) {
      win.webContents.sendInputEvent({
        type: "mouseMove",
        x: Math.round(start.x + (dx * i) / 60),
        y: Math.round(start.y + (dy * i) / 60),
        movementX: dx / 60,
        movementY: dy / 60,
      });
      if (i === 30)
        await sample(
          (selector.includes("resize")
            ? "18-native-resize-crossing-"
            : "17-native-drag-crossing-") + ++pointerIndex,
          0,
        );
      await pause(duration / 60);
    }
    win.webContents.sendInputEvent({
      type: "mouseUp",
      button: "left",
      clickCount: 1,
      x: Math.round(start.x + dx),
      y: Math.round(start.y + dy),
    });
    await pause(300);
  };
  if (process.argv.includes("--record")) {
    session.defaultSession.setPermissionCheckHandler(
      (wc, p) => wc === win.webContents && p === "display-capture",
    );
    session.defaultSession.setPermissionRequestHandler((wc, p, cb) =>
      cb(wc === win.webContents && p === "display-capture"),
    );
    const file = path.join(out, "continuous-overlap.webm");
    const recording = require("./recording.cjs").recordNative(
      win,
      session.defaultSession,
      win.webContents.getURL(),
      file,
    );
    let recordingFailure = null;
    recording.catch((error) => {
      recordingFailure = error;
    });
    const readyDeadline = Date.now() + 15000;
    while (!(await js("window.__aerynthMaterialRecordingReady===true"))) {
      if (recordingFailure) throw recordingFailure;
      if (Date.now() > readyDeadline)
        throw Error("Material recording did not become ready");
      await pause(80);
    }
    await pointerDrag(`[data-block="${ids[0]}"] .grip`, 850, 100, 4500);
    await reset();
    await pointerDrag(
      `[data-block="${ids[0]}"] .resize-handle`,
      650,
      140,
      4000,
    );
    await js('window.__aerynth.setStudy("living")');
    await pause(1000);
    await reset();
    await pointerDrag(`[data-block="${ids[0]}"] .grip`, 750, 140, 3500);
    await js('window.__aerynth.setStudy("architecture")');
    await pause(900);
    receipt.video = await recording;
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.setPermissionRequestHandler(
      (_wc, _permission, callback) => callback(false),
    );
    await fs.writeFile(
      path.join(out, "continuous-overlap.json"),
      JSON.stringify(receipt.video, null, 2),
    );
  } else {
    await pointerDrag(`[data-block="${ids[0]}"] .grip`, 850, 100);
    await reset();
    await pointerDrag(`[data-block="${ids[0]}"] .resize-handle`, 650, 140);
  }
  receipt.deliveredFrameTrace = await js(
    "window.__materialTraceRunning=false;window.__materialTrace",
  );
  check(
    "delivered pointer/resize frames keep optical veils and semantic material state",
    receipt.deliveredFrameTrace.length > 60 &&
      receipt.deliveredFrameTrace.every((frame) =>
        frame.cards.every(
          (card) =>
            card.veil === "rgba(8, 13, 21, 0.06)" &&
            card.unfold === 0 &&
            card.valid,
        ),
      ),
    { frames: receipt.deliveredFrameTrace.length },
  );
  await reset();
  await js(
    "window.__aerynth.setReduced(true);window.__aerynth.setPresenceScaleForReview(1)",
  );
  const natural = await sample("20-vela-natural-static");
  await js("window.__aerynth.setPresenceScaleForReview(.65)");
  const smaller = await sample("21-vela-65-percent-static");
  receipt.presenceSize = {
    natural: natural.snapshot.gpu.presenceBounds,
    smaller: smaller.snapshot.gpu.presenceBounds,
    meaning:
      "Same native viewport/camera/reduced static phase; conservative projected sculpture bounds, not a segmented optical pixel mask.",
  };
  const ratio = receipt.presenceSize.smaller.w / receipt.presenceSize.natural.w;
  check(
    "65-percent presence reduces actual projected bounds in the same static view",
    ratio > 0.6 && ratio < 0.7,
    { widthRatio: ratio },
  );
  await js(
    "window.__aerynth.setPresenceScaleForReview(null);window.__aerynth.setReduced(false)",
  );
  await reset();
  // A colored diagnostic behind the ORIGINAL logo verifies rendered transparency.
  const logo = await js(
    `(()=>{const img=document.querySelector('.brand img'),r=img.getBoundingClientRect();img.parentElement.style.background='#62418a';img.style.mixBlendMode='normal';return{x:r.x,y:r.y,w:r.width,h:r.height}})()`,
  );
  await pause(80);
  const logoImage = await win.webContents.capturePage({
    x: Math.floor(logo.x),
    y: Math.floor(logo.y),
    width: Math.ceil(logo.w + 8),
    height: Math.ceil(logo.h),
  });
  const size = logoImage.getSize(),
    bitmap = logoImage.toBitmap(),
    sx = size.width / (logo.w + 8),
    sy = size.height / logo.h;
  const pixel = (x, y) => [
    ...bitmap.subarray(
      (Math.round(y * sy) * size.width + Math.round(x * sx)) * 4,
      (Math.round(y * sy) * size.width + Math.round(x * sx)) * 4 + 3,
    ),
  ];
  const reference = pixel(logo.w + 4, 1),
    corner = pixel(1, 1);
  receipt.logoAlpha = {
    referenceNativeChannels: reference,
    cornerNativeChannels: corner,
    maxDifference: Math.max(
      ...reference.map((v, i) => Math.abs(v - corner[i])),
    ),
    meaning:
      "Rendered black-source corner matches the colored backing beside the image. The source PNG is unchanged.",
  };
  await sample("22-logo-alpha-diagnostic");
  check(
    "logo black raster backdrop is transparent in native rendering",
    receipt.logoAlpha.maxDifference <= 4,
    receipt.logoAlpha,
  );
  await js(
    `document.querySelector('.brand img').parentElement.style.background='';document.querySelector('.brand img').style.mixBlendMode=''`,
  );
  await sample("23-logo-direct-on-scene");
  await reset();
  await js("window.__aerynth.setEnvironmentPhase(null)");
  for (const count of [3, 10, 25, 50]) {
    while ((await state()).blocks.length < count)
      await execute({
        type: "createResource",
        kind: "note",
        title: "Synthetic optical block " + (await state()).blocks.length,
        workspaceId: workspace,
      });
    blocks = (await state()).blocks.slice(0, count);
    const updates = blocks.map((b, i) => ({
      id: b.id,
      pose: {
        x: 140 + (i % 5) * 170,
        y:
          270 +
          Math.floor(i / 5) *
            Math.min(85, 480 / Math.max(1, Math.ceil(count / 5) - 1)),
        w: 300,
        h: 210,
        lift: 0,
        yaw: 0,
        opacity: 1,
      },
    }));
    await preview(updates);
    await pause(200);
    await js(
      'window.__aerynth.setQuality("balanced");window.__aerynth.resetMetrics()',
    );
    const start = await snapshot(),
      startWall = Date.now();
    await pause(3000);
    const end = await snapshot();
    await sample("19-scale-" + count);
    receipt.scale.push({
      count,
      wallMs: Date.now() - startWall,
      callbacks: end.metrics.callbacks,
      submissions: end.metrics.draws,
      submissionIntervals: end.metrics.drawIntervals,
      gpu: end.gpu,
      compositing: end.compositing,
      meaning:
        "Actual native synthetic engine-backed blocks; callback/submission timing is not monitor presentation.",
    });
    check(
      "native " + count + "-block material pool is bound",
      end.gpu.surfacesRendered === count &&
        end.gpu.surfaceCapacity >= count &&
        end.gpu.instruments.surfaces.every((s) => s.faceOpacity === 1),
    );
  }
  receipt.masterLogoSHA256 = hash(
    await fs.readFile(path.join(root, "public/aerynth-mark-master.png")),
  );
  check(
    "approved master artwork remains byte-identical",
    receipt.masterLogoSHA256 ===
      "89bd614656667f1178603afa3a23debc5a4e96fe61ccfbb957d7ef27cbf76658",
  );
  check(
    "renderer reported no errors",
    receipt.errors.length === 0 && !(await snapshot()).metrics.errors.length,
    receipt.errors,
  );
  receipt.pngBytes = written;
  await fs.writeFile(
    path.join(out, "verification.json"),
    JSON.stringify(receipt, null, 2),
  );
  console.log(
    JSON.stringify({
      out,
      checks: receipt.checks.length,
      passed: receipt.checks.filter((c) => c.passed).length,
      captures: receipt.captures.length,
      errors: receipt.errors,
    }),
  );
}
require("./desktop-main.cjs");
