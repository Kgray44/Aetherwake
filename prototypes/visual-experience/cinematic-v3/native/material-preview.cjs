// Explicit own-window review with a fresh synthetic private profile. The normal
// desktop host owns security, persistence, input and the single renderer loop.
const { app } = require("electron");
const path = require("node:path");
const stamp = Date.now();
process.argv.push(
  `--profile=${path.join(app.getPath("temp"), "aerynth-glass-preview-" + stamp)}`,
);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
app.on("browser-window-created", (_event, win) => {
  win.webContents.once("did-finish-load", () =>
    setup(win).catch((error) => {
      console.error(error);
      app.exit(1);
    }),
  );
});
async function setup(win) {
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const deadline = Date.now() + 15000;
  while (!(await js('document.body.classList.contains("application-ready")'))) {
    if (Date.now() > deadline)
      throw Error("Synthetic review startup timed out");
    await pause(80);
  }
  const execute = (command) =>
    js(`window.__aerynth.execute(${JSON.stringify(command)})`);
  const state = () => js("window.__aerynth.application()");
  await execute({
    type: "createWorkspace",
    title: "Optical glass review",
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
    ["research", "Curved optical glass"],
    ["note", "A quiet glass note"],
  ]) {
    await execute({
      type: "createResource",
      workspaceId: s.activeWorkspaceId,
      kind,
      title,
    });
  }
  const placements = [
    ["conversation", 120, 330, 440, 240, "folio"],
    ["research", 950, 420, 280, 280, "lens"],
    ["note", 590, 660, 330, 170, "rounded"],
  ];
  for (const [kind, x, y, width, height, shape] of placements) {
    s = await state();
    const r = s.resources.find((r) => r.kind === kind);
    const b = s.blocks.find((b) => b.resource_id === r.id);
    await execute({
      type: "geometry",
      blockId: b.id,
      expectedVersion: b.version,
      placement: {
        x,
        y,
        width,
        height,
        z: kind === "conversation" ? 30 : kind === "research" ? 20 : 10,
      },
      shape,
      rotation: 0,
    });
  }
  s = await state();
  await execute({
    type: "setPresence",
    workspaceId: s.activeWorkspaceId,
    expectedVersion: s.presence.version,
    placement: { x: 710, y: 180, width: 208, height: 260 },
  });
  await js(
    'window.__aerynth.home();window.__aerynth.setEnvironmentPhase(null);window.__aerynth.setQuality("balanced")',
  );
  win.setTitle("Aerynth · Glass continuity · Synthetic review");
  win.focus();
  console.log(
    "Synthetic optical review ready; normal native interaction is available.",
  );
}
require("./desktop-main.cjs");
