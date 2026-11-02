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
  organization: (({ revision, ...organization }) => organization)(
    s.organization,
  ),
  geometry: geometry(s),
  presence: presence(s),
  viewport: s.viewport,
});
const blockOf = (s, kind) => {
  const block = s.blocks.find(
    (b) => s.resources.find((r) => r.id === b.resource_id)?.kind === kind,
  );
  assert(block, "Missing " + kind + " placement");
  return block;
};
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
    const press = (keyCode, modifiers = []) => {
      for (const type of ["keyDown", "keyUp"])
        win.webContents.sendInputEvent({ type, keyCode, modifiers });
    };
    const typeNumber = async (selector, value) => {
      await click(selector);
      press("A", ["control"]);
      for (const keyCode of String(value)) {
        win.webContents.sendInputEvent({ type: "keyDown", keyCode });
        win.webContents.sendInputEvent({ type: "char", keyCode });
        win.webContents.sendInputEvent({ type: "keyUp", keyCode });
      }
      await pause(60);
    };
    const project = async (title) => {
      await click("#workspace-manager");
      await click("#new-project");
      await fill("#project-title", title);
      await click('dialog button[type="submit"]');
      await wait('!document.querySelector("#command-surface").open');
      return (await snapshot()).projects.find((p) => p.title === title).id;
    };
    const newWorkspace = async (title, projectId) => {
      await click("#workspace-manager");
      await click("#new-workspace");
      await fill("#workspace-title", title);
      if (projectId) await fill('dialog select[name="projectId"]', projectId);
      await click('dialog button[type="submit"]');
      await wait('!document.querySelector("#command-surface").open');
      return (await snapshot()).activeWorkspaceId;
    };
    const mode = async (value) => {
      await click("#layout-manager");
      await click("#organization-settings");
      await click("#organization-mode");
      press("Home");
      for (
        let i = 0;
        i < ["fluid", "freeform", "structured"].indexOf(value);
        i++
      )
        press("Down");
      press("Return");
      await wait(
        `document.querySelector('#organization-mode')?.value===${JSON.stringify(value)}`,
        5000,
      );
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
    const drag = async (selector, dx, dy, during, pickup) => {
      const p = await point(selector);
      win.webContents.sendInputEvent({ type: "mouseMove", ...p });
      win.webContents.sendInputEvent({
        type: "mouseDown",
        ...p,
        button: "left",
        clickCount: 1,
      });
      await pause(350);
      if (pickup) await pickup();
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
      let renderedBefore;
      await drag(
        `[data-block="${a.id}"] .grip`,
        (b.x -
          a.x +
          (before.organization.mode === "structured"
            ? b.width * 0.55
            : before.organization.mode === "freeform"
              ? b.width * 0.35
              : 0)) *
          z,
        (b.y - a.y) * z,
        checkPreview
          ? async () => {
              assert.deepEqual(geometry(await snapshot()), geometry(before));
              assert.deepEqual(presence(await snapshot()), presence(before));
              assert.equal(
                await js("document.body.dataset.layoutPreview"),
                before.organization.mode,
              );
              const rendered = await js("window.__aerynth.snapshot().poses");
              const yielded = Object.keys(rendered).filter(
                (id) =>
                  id !== a.id &&
                  renderedBefore[id] &&
                  Math.hypot(
                    rendered[id].x - renderedBefore[id].x,
                    rendered[id].y - renderedBefore[id].y,
                  ) > 3,
              );
              if (before.organization.mode === "fluid")
                assert(
                  yielded.length > 0,
                  "A non-target resource must visibly yield before release",
                );
              if (before.organization.mode === "freeform")
                assert.equal(
                  yielded.length,
                  0,
                  "Freeform neighbors must remain visually stationary",
                );
              receipt.checks.push(
                before.organization.mode +
                  "-rendered-neighbor-motion-" +
                  yielded.length,
              );
              await shot(before.organization.mode + "-predictive-yield");
            }
          : undefined,
        async () => {
          renderedBefore = await js("window.__aerynth.snapshot().poses");
        },
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
      const projectA = await project("A World for Two"),
        projectB = await project("Voyagewright"),
        projectC = await project("Airbrush Disc System");
      const a = await newWorkspace(
        "Synthetic organization laboratory",
        projectA,
      );
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
      for (const [kind, count] of Object.entries({
        conversation: 3,
        note: 2,
        task: 2,
        research: 1,
        stream: 1,
      }))
        assert.equal(resources.filter((r) => r.kind === kind).length, count);
      await action("bring-all");
      await pause(600);
      await shot("01-fluid-mixed-workspace");
      await start();
      s = await snapshot();
      let before = await moveOnto(
        blockOf(s, "conversation"),
        blockOf(s, "note"),
        true,
      );
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
      const target = blockOf(s, "conversation"),
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
      const resize = blockOf(s, "conversation");
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
      before = s;
      await click(`[data-block="${blockOf(s, "conversation").id}"] .grip`);
      press("Right", ["alt"]);
      await wait(
        `window.__aerynth.application().layoutVersion>${s.layoutVersion}`,
        8000,
      );
      await click("#undo");
      await pause(200);
      assert.deepEqual(geometry(await snapshot()), geometry(before));
      await properties(blockOf(s, "conversation").id);
      await typeNumber(
        'dialog input[name="width"]',
        Math.round(blockOf(s, "conversation").width + 80),
      );
      await click('dialog button[type="submit"]');
      await pause(250);
      await click("#undo");
      await pause(250);
      assert.deepEqual(geometry(await snapshot()), geometry(before));
      await drag(
        `[data-block="${blockOf(s, "conversation").id}"] .grip`,
        90,
        60,
        async () => {
          press("Escape");
          await pause(200);
          assert.equal(
            await js("document.body.dataset.layoutPreview"),
            undefined,
          );
        },
      );
      assert.deepEqual(geometry(await snapshot()), geometry(before));
      receipt.checks.push(
        "native-keyboard-move-resize-undo-and-Escape-preview-cancellation",
      );

      s = await snapshot();
      const fluidGeometry = geometry(s);
      await mode("freeform");
      assert.deepEqual(geometry(await snapshot()), fluidGeometry);
      await start();
      s = await snapshot();
      before = await moveOnto(
        blockOf(s, "conversation"),
        blockOf(s, "note"),
        true,
      );
      s = await snapshot();
      const stationary = blockOf(before, "note");
      assert.deepEqual(
        geometry(s).find((b) => b.id === stationary.id),
        geometry(before).find((b) => b.id === stationary.id),
      );
      const moving = blockOf(before, "conversation");
      for (const direction of ["front", "back", "raise", "lower"]) {
        await properties(moving.id);
        await click(`[data-layer="${direction}"]`);
        await pause(150);
      }
      s = await snapshot();
      const freeVela = { ...s.presence };
      await drag(".vela-grip", 24 * s.viewport.zoom, 18 * s.viewport.zoom);
      s = await snapshot();
      assert.notDeepEqual(presence(s), presence({ ...s, presence: freeVela }));
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
      await moveOnto(blockOf(s, "conversation"), blockOf(s, "note"), true);
      s = await snapshot();
      noOverlap(s);
      await shot("06-structured-spans-and-reorder");
      s = await snapshot();
      const gridVela = { ...s.presence },
        last = s.blocks.at(-1);
      await drag(
        ".vela-grip",
        (last.x + last.width * 0.55 - gridVela.x) * s.viewport.zoom,
        (last.y - gridVela.y) * s.viewport.zoom,
      );
      s = await snapshot();
      noOverlap(s);
      assert.notDeepEqual(presence(s), presence({ ...s, presence: gridVela }));
      receipt.checks.push(
        "Vela-native-movement-participates-in-Freeform-and-Structured",
      );
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

      let otherWorkspace;
      for (const organization of ["freeform", "structured"]) {
        const id = await newWorkspace(
          "Synthetic persistent " + organization,
          organization === "freeform" ? projectB : projectC,
        );
        if (organization === "freeform") otherWorkspace = id;
        await mode(organization);
        for (const resource of resources) {
          await click("#resource-picker");
          await click(`[data-attach="${resource.id}"]`);
          await pause(100);
        }
        await action("bring-all");
        s = await snapshot();
        if (organization === "freeform")
          await moveOnto(blockOf(s, "conversation"), blockOf(s, "note"));
        await pause(250);
        s = await snapshot();
        assert.equal(s.resources.length, resources.length);
        expected.push(saved(s));
        await shot("07-independent-" + organization);
      }
      await choose(a);
      await click("#zoom-out");
      await pause(350);
      const clickText = async (text, scope) => {
        const token = "native-" + Date.now();
        assert(
          await js(
            `(()=>{const e=[...document.querySelectorAll(${JSON.stringify(scope + " button")})].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!e)return false;e.dataset.qaTarget=${JSON.stringify(token)};return true})()`,
          ),
        );
        await click(`[data-qa-target="${token}"]`);
      };
      const openNode = async (key) => {
        await wait(
          `!!document.querySelector(${JSON.stringify('[data-key="' + key + '"]')})`,
          15000,
        );
        await click(`[data-key="${key}"]`);
        await clickText("Open destination", ".aw-spatial-detail");
        await pause(300);
      };
      await clickText("Universe", ".aw-constellation-bar");
      await pause(350);
      await openNode("project:" + projectB);
      await openNode("workspace:" + otherWorkspace);
      assert.deepEqual(saved(await snapshot()), expected[1]);
      await click("#zoom-out");
      await pause(250);
      await clickText("Universe", ".aw-constellation-bar");
      await pause(300);
      await openNode("project:" + projectA);
      await openNode("workspace:" + a);
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
