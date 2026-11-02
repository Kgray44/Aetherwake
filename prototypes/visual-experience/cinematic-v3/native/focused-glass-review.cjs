// Bounded native regression of real canonical resources and their DOM/GPU
// presentation. Synthetic data; controller actions are scripted, not a claim
// of physical mouse input or owner artistic acceptance.
const { app } = require("electron");
const fs = require("node:fs/promises");
const sync = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const stamp = Date.now();
const root = path.resolve(__dirname, "..");
const out = path.join(root, ".runtime/focused-glass", String(stamp));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
process.argv.push(
  `--profile=${path.join(app.getPath("temp"), "aerynth-focused-glass-" + stamp)}`,
);
const receipt = {
  synthetic: true,
  sourceRevision: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  }).trim(),
  sources: Object.fromEntries(
    ["src/main.ts", "src/style.css", "src/resource-material-motion.ts"].map(
      (name) => [name, hash(sync.readFileSync(path.join(root, name)))],
    ),
  ),
  buildAssets: Object.fromEntries(
    sync
      .readdirSync(path.join(root, "dist/assets"))
      .map((name) => [
        name,
        hash(sync.readFileSync(path.join(root, "dist/assets", name))),
      ]),
  ),
  checks: [],
  captures: [],
  errors: [],
  limits: { pngBytes: 48 * 1024 * 1024, fixtureResources: 7 },
};
app.on("browser-window-created", (_event, win) => {
  win.webContents.once("did-finish-load", () =>
    run(win).catch(async (error) => {
      receipt.errors.push(String(error));
      await fs.mkdir(out, { recursive: true });
      await fs.writeFile(
        path.join(out, "failed.json"),
        JSON.stringify(receipt, null, 2),
      );
      console.error(error);
      app.exit(1);
    }),
  );
});
async function run(win) {
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const execute = (command) =>
    js(`window.__aerynth.execute(${JSON.stringify(command)})`);
  const state = () => js("window.__aerynth.application()");
  const check = (name, passed, detail) => {
    receipt.checks.push({ name, passed: !!passed, detail });
    if (!passed) throw Error(name);
  };
  const deadline = Date.now() + 15000;
  while (!(await js('document.body.classList.contains("application-ready")'))) {
    if (Date.now() > deadline) throw Error("Startup timeout");
    await pause(80);
  }
  await fs.mkdir(out, { recursive: true });
  win.setSize(1600, 1040);
  win.setTitle("Aerynth · Continuous inner glass · Synthetic review");
  win.focus();
  await execute({
    type: "createWorkspace",
    title: "Continuous glass review",
    projectId: null,
  });
  let s = await state();
  await execute({
    type: "setOrganization",
    workspaceId: s.activeWorkspaceId,
    expectedOrganizationRevision: s.organization.revision,
    organization: { mode: "freeform" },
  });
  for (const [kind, title] of [
    ["conversation", "A surface that keeps its light"],
    ["note", "Engineering note"],
    ["task", "Engineering task"],
    ["research", "Curved optical glass"],
    ["reference", "Engineering reference"],
    ["task", "Verification task"],
    ["task_group", "Engineering task group"],
  ])
    await execute({
      type: "createResource",
      workspaceId: s.activeWorkspaceId,
      kind,
      title,
    });
  s = await state();
  for (let i = 0; i < s.blocks.length; i++) {
    const b = s.blocks[i];
    await execute({
      type: "geometry",
      blockId: b.id,
      expectedVersion: b.version,
      placement: {
        x: 230 + i * 100,
        y: 310 + (i % 2) * 240,
        width: i === 1 ? 128 : 320,
        height: 180,
        z: i,
      },
      shape: "rounded",
      rotation: 0,
    });
  }
  s = await state();
  const identity = JSON.stringify(s.blocks);
  const group = s.blocks.find(
    (b) =>
      s.resources.find((r) => r.id === b.resource_id).kind === "task_group",
  );
  await js(
    'window.__glassEditors = [...document.querySelectorAll(".folio textarea")];window.__aerynth.setQuality("balanced");window.__aerynth.setReduced(false)',
  );
  let written = 0;
  const capture = async (name) => {
    const image = (await win.webContents.capturePage()).toPNG();
    written += image.length;
    if (written > receipt.limits.pngBytes) throw Error("Capture bound");
    await fs.writeFile(path.join(out, name + ".png"), image, { flag: "wx" });
    receipt.captures.push({
      file: name + ".png",
      bytes: image.length,
      sha256: hash(image),
    });
  };
  const inspect = () =>
    js(`(() => {
    const s = window.__aerynth.application();
    return [...document.querySelectorAll('.folio')].map(a => {
      const b = s.blocks.find(b => b.id === a.dataset.block), r = s.resources.find(r => r.id === b.resource_id), q = v => a.querySelector(v), cs = v => getComputedStyle(q(v));
      return { id:b.id, kind:r.kind.replaceAll('_',' '), title:r.title, receded:a.classList.contains('receded'), dock:Number(a.style.getPropertyValue('--dock')), inner:cs('.folio-inner').opacity, anchor:cs('.resource-anchor').opacity, tools:cs('.block-tools').display, label:q('.anchor-label small').textContent, anchorTitle:q('.anchor-label b').textContent, aria:q('.resource-anchor').getAttribute('aria-label'), workingBackground:cs('.working-content').backgroundColor, titleBackground:cs('.title-select').backgroundColor, headerBackground:cs('.folio-top').backgroundColor, film:cs('.resource-presentation').backgroundColor };
    });
  })()`);
  for (const zoom of [1, 0.125]) {
    await js("window.__aerynth.home()");
    s = await state();
    await execute({
      type: "setViewport",
      workspaceId: s.activeWorkspaceId,
      viewport: { x: 0, y: 0, zoom },
    });
    await js(`window.__aerynth.expand(${JSON.stringify(group.id)})`);
    await pause(100);
    // Exercise the normal lifecycle reconciliation while semantic springs move.
    await js("window.__aerynth.setActive(false)");
    const rows = await inspect();
    check(
      `six unambiguous settled anchors at zoom ${zoom} after blur reconciliation`,
      rows.filter((r) => r.receded).length === 6 &&
        rows
          .filter((r) => r.receded)
          .every(
            (r) =>
              r.dock === 1 &&
              r.inner === "0" &&
              r.anchor === "1" &&
              r.tools === "none" &&
              r.label === r.kind &&
              r.anchorTitle === r.title &&
              r.aria.includes(r.kind),
          ),
      rows,
    );
    await js("window.__aerynth.setActive(true)");
    await pause(250);
    await capture(`focused-seven-zoom-${zoom}`);
  }
  await js("window.__aerynth.home();window.__aerynth.setReduced(true)");
  s = await state();
  await execute({
    type: "setViewport",
    workspaceId: s.activeWorkspaceId,
    viewport: { x: 0, y: 0, zoom: 1 },
  });
  check(
    "return removes peripheral labels without changing canonical placement",
    (await inspect()).every(
      (r) => r.dock === 0 && r.inner === "1" && r.anchor === "0",
    ) && JSON.stringify((await state()).blocks) === identity,
  );
  check(
    "editor node identities survive focus and return",
    await js("window.__glassEditors.every(e => e.isConnected)"),
  );
  for (const kind of [
    "conversation",
    "note",
    "research",
    "task",
    "reference",
    "task_group",
  ]) {
    s = await state();
    const b = s.blocks.find(
      (b) => s.resources.find((r) => r.id === b.resource_id).kind === kind,
    );
    await js(`window.__aerynth.expand(${JSON.stringify(b.id)})`);
    await pause(150);
    const row = (await inspect()).find((r) => r.id === b.id);
    check(
      `${kind} shares a continuous glass face with no opaque inner slabs`,
      row.workingBackground === "rgba(0, 0, 0, 0)" &&
        row.titleBackground === "rgba(0, 0, 0, 0)" &&
        row.headerBackground === "rgba(0, 0, 0, 0)" &&
        row.film === "rgba(3, 7, 15, 0.46)",
      row,
    );
    await capture(`expanded-${kind}`);
    await js("window.__aerynth.home()");
  }
  s = await state();
  const conversation = s.blocks.find(
    (b) =>
      s.resources.find((r) => r.id === b.resource_id).kind === "conversation",
  );
  await js(
    `window.__aerynth.expand(${JSON.stringify(conversation.id)});window.__aerynth.setReduced(false)`,
  );
  await capture("interactive-conversation");
  await fs.writeFile(
    path.join(out, "verification.json"),
    JSON.stringify(receipt, null, 2),
  );
  console.log(
    JSON.stringify({
      ready: true,
      out,
      checks: receipt.checks.length,
      failed: receipt.checks.filter((c) => !c.passed).length,
      errors: receipt.errors,
    }),
  );
  if (!process.argv.includes("--hold")) app.quit();
}
require("./desktop-main.cjs");
