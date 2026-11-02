const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const { createDriver } = require("./desktop-verify.cjs");
const { startWindowRecording } = require("./application-recording.cjs");
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const geometry = (s) =>
  s.blocks
    .map((b) => ({
      id: b.id,
      resource_id: b.resource_id,
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      z: b.z,
      shape: b.shape,
      rotation: b.rotation,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
const presence = (s) => {
  const { version, ...p } = s.presence;
  return p;
};
const saved = (s) => ({
  workspaceId: s.activeWorkspaceId,
  mode: s.organization.mode,
  geometry: geometry(s),
  presence: presence(s),
  viewport: s.viewport,
});
exports.verify = async ({
  win,
  app,
  source,
  privateRoot,
  session,
  localURL,
}) => {
  const out = path.resolve(
    __dirname,
    "../.runtime/application-evidence",
    "organization-" + Date.now(),
  );
  await fs.mkdir(out, { recursive: true });
  const receipt = {
    source,
    syntheticData: true,
    host: "Actual Aerynth desktop + canonical SQLite + V3.5 Environment",
    checks: [],
    screenshots: [],
    videos: [],
    passed: false,
    limitations: [
      "Native motion evidence is subject to visual review.",
      "Callback and capture cadence do not measure monitor presentation.",
    ],
  };
  let recording;
  try {
    const { js, wait, click, fill, snapshot } = await createDriver(win);
    const shot = async (name) => {
      await pause(160);
      await fs.writeFile(
        path.join(out, name + ".png"),
        (await win.webContents.capturePage()).toPNG(),
      );
      receipt.screenshots.push(name + ".png");
    };
    const start = async () => {
      recording = await startWindowRecording(win, session, localURL);
    };
    const stop = async (name) => {
      receipt.videos.push(await recording.stop(path.join(out, name + ".webm")));
      recording = null;
    };
    const choose = async (id) => {
      await click("#workspace-manager");
      await click(`[data-workspace="${id}"]`);
      await wait(
        `window.__aerynth.application().activeWorkspaceId===${JSON.stringify(id)}`,
      );
    };
    const newWorkspace = async (title) => {
      await click("#workspace-manager");
      await click("#new-workspace");
      await fill("#workspace-title", title);
      await click('dialog button[type="submit"]');
      await wait('!document.querySelector("#command-surface").open');
      return (await snapshot()).activeWorkspaceId;
    };
    const mode = async (value) => {
      await click("#layout-manager");
      await click("#organization-settings");
      await fill("#organization-mode", value);
      await click('#organization-form button[type="submit"]');
      await wait(
        `window.__aerynth.application().organization.mode===${JSON.stringify(value)}&&!document.querySelector('#command-surface').open`,
      );
      await pause(250);
    };
    const action = async (id) => {
      await click("#layout-manager");
      await click("#" + id);
      await wait('!document.querySelector("#command-surface").open');
      await pause(250);
    };
    const properties = async (id) => {
      await click("#layout-manager");
      await click(`[data-properties="${id}"]`);
    };
    const point = async (selector) =>
      js(
        `(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,h=document.elementFromPoint(x,y);if(!h||!(e===h||e.contains(h)))throw Error('Native target occluded: '+${JSON.stringify(selector)});return{x:Math.round(x),y:Math.round(y)}})()`,
      );
    const drag = async (selector, dx, dy, during) => {
      const p = await point(selector);
      win.webContents.sendInputEvent({ type: "mouseMove", ...p });
      win.webContents.sendInputEvent({
        type: "mouseDown",
        ...p,
        button: "left",
        clickCount: 1,
      });
      await pause(60);
      for (let i = 1; i <= 14; i++) {
        win.webContents.sendInputEvent({
          type: "mouseMove",
          x: Math.round(p.x + (dx * i) / 14),
          y: Math.round(p.y + (dy * i) / 14),
          button: "left",
          modifiers: ["leftbuttondown"],
        });
        await pause(18);
      }
      await pause(220);
      if (during) await during();
      win.webContents.sendInputEvent({
        type: "mouseUp",
        x: Math.round(p.x + dx),
        y: Math.round(p.y + dy),
        button: "left",
        clickCount: 1,
      });
      await pause(350);
    };
    const noOverlap = (s) => {
      const all = [...s.blocks, s.presence];
      for (let i = 0; i < all.length; i++)
        for (let j = i + 1; j < all.length; j++) {
          const a = all[i],
            b = all[j];
          assert(
            !(
              a.x < b.x + b.width &&
              a.x + a.width > b.x &&
              a.y < b.y + b.height &&
              a.y + a.height > b.y
            ),
            "Committed overlap",
          );
        }
    };
    const moveOnto = async (a, b, checkPreview) => {
      const before = await snapshot(),
        z = before.viewport.zoom;
      await drag(
        `[data-block="${a.id}"] .grip`,
        (b.x - a.x) * z,
        (b.y - a.y) * z,
        checkPreview
          ? async () => {
              assert.deepEqual(geometry(await snapshot()), geometry(before));
              assert.deepEqual(presence(await snapshot()), presence(before));
              assert.equal(
                await js("document.body.dataset.layoutPreview"),
                before.organization.mode,
              );
              await shot(before.organization.mode + "-predictive-yield");
            }
          : undefined,
      );
      await wait(
        `window.__aerynth.application().layoutVersion>${before.layoutVersion}`,
      );
      return before;
    };
    if (process.argv.includes("--verify-restore")) {
      const expected = JSON.parse(
        await fs.readFile(
          path.join(privateRoot, "organization-expected.json"),
          "utf8",
        ),
      );
      for (const e of expected.workspaces) {
        await choose(e.workspaceId);
        const s = await snapshot();
        assert.deepEqual(saved(s), e);
        assert.deepEqual(s.resources, expected.resources);
        await shot("restart-" + e.mode);
      }
      receipt.checks.push(
        "fresh-process-restart-restores-each-mode-exact-geometry-layers-Vela-camera-and-canonical-content",
      );
    } else {
      const a = await newWorkspace("Synthetic organization laboratory");
      let s = await snapshot();
      assert.equal(s.organization.mode, "fluid");
      const kinds = [
        "conversation",
        "conversation",
        "conversation",
        "note",
        "note",
        "task",
        "task",
        "research",
        "stream",
      ];
      for (let i = 0; i < kinds.length; i++) {
        await click("#add-block");
        await fill("#block-kind", kinds[i]);
        await fill("#block-title", `Synthetic ${kinds[i]} ${i + 1}`);
        await click('dialog button[type="submit"]');
        await wait('!document.querySelector("#command-surface").open');
      }
      s = await snapshot();
      assert.equal(s.blocks.length, 9);
      const resources = s.resources;
      await action("bring-all");
      await pause(600);
      await shot("01-fluid-mixed-workspace");
      await start();
      s = await snapshot();
      let before = await moveOnto(s.blocks[0], s.blocks[1], true);
      s = await snapshot();
      noOverlap(s);
      assert.notDeepEqual(geometry(s), geometry(before));
      receipt.checks.push(
        "Fluid-native-drag-predictive-preview-is-noncanonical-and-commit-rearranges",
      );
      await click("#undo");
      await pause(350);
      s = await snapshot();
      assert.deepEqual(geometry(s), geometry(before));
      assert.deepEqual(presence(s), presence(before));
      await action("bring-all");
      s = await snapshot();
      const target = s.blocks.find((b) => b.kind !== "stream") ?? s.blocks[0],
        p = s.presence,
        z = s.viewport.zoom;
      before = s;
      await drag(
        ".vela-grip",
        (target.x - p.x) * z,
        (target.y - p.y) * z,
        async () => {
          assert.deepEqual(geometry(await snapshot()), geometry(before));
          await shot("02-Vela-predictive-yield");
        },
      );
      s = await snapshot();
      noOverlap(s);
      assert.notDeepEqual(geometry(s), geometry(before));
      await click("#undo");
      await pause(300);
      s = await snapshot();
      assert.deepEqual(geometry(s), geometry(before));
      const resize = s.blocks[0];
      before = s;
      await drag(
        `[data-block="${resize.id}"] .resize-handle`,
        130 * z,
        30 * z,
        async () => {
          assert.deepEqual(geometry(await snapshot()), geometry(before));
          assert.equal(
            await js("document.body.dataset.layoutPreview"),
            "fluid",
          );
          await shot("03-fluid-live-resize");
        },
      );
      s = await snapshot();
      noOverlap(s);
      await click("#undo");
      await pause(300);
      assert.deepEqual(geometry(await snapshot()), geometry(before));
      receipt.checks.push(
        "Fluid-Vela-and-live-resize-yield-with-one-operation-undo",
      );
      await stop("fluid-interaction");

      s = await snapshot();
      const fluidGeometry = geometry(s);
      await mode("freeform");
      assert.deepEqual(geometry(await snapshot()), fluidGeometry);
      await start();
      s = await snapshot();
      before = await moveOnto(s.blocks[0], s.blocks[1], true);
      s = await snapshot();
      const stationary = before.blocks[1];
      assert.deepEqual(
        geometry(s).find((b) => b.id === stationary.id),
        geometry(before).find((b) => b.id === stationary.id),
      );
      const moving = before.blocks[0];
      for (const direction of ["front", "back", "raise", "lower"]) {
        await properties(moving.id);
        await click(`[data-layer="${direction}"]`);
        await pause(150);
      }
      await shot("04-freeform-overlap-and-layers");
      receipt.checks.push(
        "Freeform-preserves-neighbors-intentional-overlap-and-all-four-layer-controls",
      );
      await action("save-layout");
      s = await snapshot();
      const freeform = saved(s);
      await mode("structured");
      s = await snapshot();
      assert.equal(s.organization.mode, "structured");
      assert.deepEqual(s.resources, resources);
      noOverlap(s);
      await shot("05-structured-conversion");
      await click("#undo");
      await pause(300);
      assert.deepEqual(saved(await snapshot()), freeform);
      await action("redo-layout");
      s = await snapshot();
      assert.equal(s.organization.mode, "structured");
      await properties(moving.id);
      await fill('#grid-span-form [name="columns"]', "2");
      await fill('#grid-span-form [name="rows"]', "4");
      await click('#grid-span-form button[type="submit"]');
      await pause(350);
      s = await snapshot();
      assert.equal(s.organization.structured.spans[moving.id].columns, 2);
      assert.equal(s.organization.structured.spans[moving.id].rows, 4);
      await action("bring-all");
      s = await snapshot();
      await moveOnto(s.blocks[0], s.blocks[1], true);
      s = await snapshot();
      noOverlap(s);
      await shot("06-structured-spans-and-reorder");
      receipt.checks.push(
        "Structured-grid-variable-spans-reorder-and-mode-undo-redo-preserve-identities",
      );
      await stop("freeform-to-structured");
      await action("restore-layout");
      assert.deepEqual(saved(await snapshot()), freeform);
      await mode("fluid");
      s = await snapshot();
      noOverlap(s);
      const expected = [saved(s)];

      for (const organization of ["freeform", "structured"]) {
        const id = await newWorkspace("Synthetic persistent " + organization);
        await mode(organization);
        for (const resource of resources) {
          await click("#resource-picker");
          await click(`[data-attach="${resource.id}"]`);
          await pause(100);
        }
        await action("bring-all");
        s = await snapshot();
        if (organization === "freeform")
          await moveOnto(s.blocks[0], s.blocks[1]);
        await pause(250);
        s = await snapshot();
        assert.equal(s.resources.length, resources.length);
        expected.push(saved(s));
        await shot("07-independent-" + organization);
      }
      await choose(a);
      await click("#zoom-out");
      await pause(350);
      await click("#nav-back");
      await wait(
        `window.__aerynth.application().navigation.kind==='workspace'&&window.__aerynth.application().activeWorkspaceId===${JSON.stringify(a)}`,
      );
      assert.deepEqual(saved(await snapshot()), expected[0]);
      receipt.checks.push(
        "same-nine-canonical-resources-work-across-independent-modes-and-Constellation-round-trip",
      );
      await js("window.__aerynth.flush()");
      await fs.writeFile(
        path.join(privateRoot, "organization-expected.json"),
        JSON.stringify({
          workspaces: expected,
          resources: (await snapshot()).resources,
        }),
      );
    }
    receipt.passed = true;
  } catch (error) {
    receipt.error = error.stack;
    try {
      await fs.writeFile(
        path.join(out, "failure.png"),
        (await win.webContents.capturePage()).toPNG(),
      );
    } catch {}
  } finally {
    if (recording)
      try {
        receipt.videos.push(
          await recording.stop(path.join(out, "partial-failed.webm")),
        );
      } catch (e) {
        receipt.recordingError = e.message;
      }
  }
  await fs.writeFile(
    path.join(out, "organization.json"),
    JSON.stringify(receipt, null, 2),
  );
  console.log(
    JSON.stringify({
      passed: receipt.passed,
      error: receipt.error,
      evidence: out,
    }),
  );
  process.exitCode = receipt.passed ? 0 : 1;
  app.quit();
};
