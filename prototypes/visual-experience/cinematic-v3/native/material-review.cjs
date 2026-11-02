// Dedicated own-window review. Uses the normal desktop host and canonical SQLite
// commands in a fresh synthetic profile; never opens the owner's saved database.
const { app } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { createHash } = require("node:crypto");
const root = path.resolve(__dirname, "..");
const stamp = Date.now();
const out = path.join(root, ".runtime/material-continuity", String(stamp));
process.argv.push(
  `--profile=${path.join(app.getPath("temp"), "aerynth-material-continuity-" + stamp)}`,
);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
app.on("browser-window-created", (_event, win) => {
  win.webContents.once("did-finish-load", () => {
    run(win)
      .then(() => app.quit())
      .catch(async (error) => {
        await fs.mkdir(out, { recursive: true });
        await fs.writeFile(
          path.join(out, "failure.json"),
          JSON.stringify({ error: String(error), stack: error.stack }, null, 2),
        );
        console.error(error);
        app.exit(1);
      });
  });
});
async function run(win) {
  await fs.mkdir(out, { recursive: true });
  const js = (code) => win.webContents.executeJavaScript(code, true);
  let ready = false;
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await js('document.body.classList.contains("application-ready")')) {
      ready = true;
      break;
    }
    await pause(50);
  }
  if (!ready) {
    await fs.writeFile(
      path.join(out, "startup-failure.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    throw new Error(
      "Application startup failed: " +
        JSON.stringify(
          await js(
            "({host:!!window.aerynthHost?.command,status:document.querySelector('#status')?.textContent,body:document.body.className})",
          ),
        ),
    );
  }
  win.focus();
  const execute = (command) =>
    js(`window.__aerynth.execute(${JSON.stringify(command)})`);
  await execute({
    type: "createWorkspace",
    title: "Synthetic optical continuity review",
    projectId: null,
  });
  let state = await js("window.__aerynth.application()");
  for (const [kind, title] of [
    ["conversation", "A surface that keeps its light"],
    ["research", "Curved optical lens"],
    ["note", "A quiet optical note"],
  ])
    await execute({
      type: "createResource",
      kind,
      title,
      workspaceId: state.activeWorkspaceId,
    });
  state = await js("window.__aerynth.application()");
  const ids = state.blocks.map((block) => block.id);
  const placement = async (
    id,
    x,
    y,
    width,
    height,
    z,
    shape = "rounded",
    rotation = 0,
  ) => {
    const block = (await js("window.__aerynth.application()")).blocks.find(
      (b) => b.id === id,
    );
    await execute({
      type: "geometry",
      blockId: id,
      expectedVersion: block.version,
      placement: { x, y, width, height, z },
      shape,
      rotation,
    });
  };
  await placement(ids[0], 160, 360, 440, 240, 1, "folio");
  await placement(ids[1], 960, 420, 280, 280, 2, "lens");
  await placement(ids[2], 640, 660, 330, 170, 3, "rounded");
  await js("window.__aerynth.setEnvironmentPhase(0)");
  const receipt = {
    kind: "Actual native material continuity diagnosis",
    at: new Date().toISOString(),
    synthetic: true,
    samples: [],
    captures: [],
    errors: [],
  };
  win.webContents.on("console-message", (_event, details) => {
    if (details.level === "error") receipt.errors.push(details.message);
  });
  const sample = async (name) => {
    await pause(800);
    const diagnostic = await js(
      `({snapshot: window.__aerynth.snapshot(), cards: [...document.querySelectorAll('.folio')].map(e=>({id:e.dataset.block,overlap:e.dataset.materialOverlap,background:getComputedStyle(e).backgroundColor,clipPath:getComputedStyle(e).clipPath,z:getComputedStyle(e).zIndex,transform:getComputedStyle(e).transform,opacity:getComputedStyle(e).opacity})), materialMode:document.querySelector('#world').dataset.materials})`,
    );
    receipt.samples.push({ name, ...diagnostic });
    const bytes = (await win.webContents.capturePage()).toPNG();
    if (bytes.length > 8 * 1024 * 1024)
      throw new Error("Single capture exceeds8MiB bound");
    await fs.writeFile(path.join(out, name + ".png"), bytes, { flag: "wx" });
    receipt.captures.push({
      file: name + ".png",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
    });
  };
  await sample("separated-unselected");
  await placement(ids[0], 540, 650, 440, 240, 4, "folio");
  await sample("overlap-unselected");
  await js(`window.__aerynth.select(${JSON.stringify(ids[0])})`);
  await sample("overlap-selected");
  await fs.writeFile(
    path.join(out, "diagnosis.json"),
    JSON.stringify(receipt, null, 2),
  );
  console.log(
    JSON.stringify({
      out,
      samples: receipt.samples.length,
      errors: receipt.errors,
    }),
  );
}
require("./desktop-main.cjs");
