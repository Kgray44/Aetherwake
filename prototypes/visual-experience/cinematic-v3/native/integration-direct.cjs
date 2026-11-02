const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const { createDriver } = require("./desktop-verify.cjs");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Actual desktop/native-input journey. No provider execution; all seeded content is synthetic. */
exports.verify = async ({ win, app, privateRoot, source }) => {
  if (process.argv.includes("--verify-inline-drafts"))
    return require("./integration-inline-drafts.cjs").verify({
      win,
      app,
      privateRoot,
      source,
    });
  const output = path.resolve(
    __dirname,
    "../.runtime/application-evidence",
    "direct-" + Date.now(),
  );
  await fs.mkdir(output, { recursive: true });
  const receipt = {
    source,
    syntheticData: true,
    passed: false,
    checks: [],
    actions: [],
    screenshots: [],
    errors: [],
    limits: [
      "Canonical fixture setup uses the trusted native command boundary. Gestures use native mouse/keyboard input.",
      "GPU draw counters are submission evidence, not monitor frame-rate measurements.",
    ],
  };
  win.webContents.on("console-message", (_event, details) => {
    if (details.level === "error") receipt.errors.push(details.message);
  });
  try {
    win.setSize(1440, 960);
    win.show();
    win.focus();
    const { js, wait, click, snapshot } = await createDriver(win);
    const execute = (command) =>
      js(`window.__aerynth.execute(${JSON.stringify(command)})`);
    const shot = async (name) => {
      assert.equal(
        win.isFocused(),
        true,
        "Native evidence requires foreground",
      );
      const before = await js("window.__aerynth.snapshot().metrics.draws");
      await js('window.dispatchEvent(new Event("resize"))');
      await wait(`window.__aerynth.snapshot().metrics.draws>${before}`, 8000);
      await pause(150);
      assert.equal(win.isFocused(), true);
      await fs.writeFile(
        path.join(output, name + ".png"),
        (await win.webContents.capturePage()).toPNG(),
      );
      receipt.screenshots.push(name + ".png");
    };
    if (process.argv.includes("--verify-restore")) {
      const expected = JSON.parse(
          await fs.readFile(
            path.join(privateRoot, "direct-expected.json"),
            "utf8",
          ),
        ),
        actual = await snapshot();
      assert.equal(actual.activeWorkspaceId, expected.activeWorkspaceId);
      assert.deepEqual(actual.blocks, expected.blocks);
      assert.deepEqual(actual.resources, expected.resources);
      assert.deepEqual(actual.viewport, expected.viewport);
      receipt.checks.push(
        "fresh-process exact placement, content and viewport restore",
      );
      await shot("restart");
    } else {
      await execute({
        type: "createWorkspace",
        title: "Synthetic direct manipulation review",
        projectId: null,
      });
      let state = await snapshot();
      await execute({
        type: "setOrganization",
        workspaceId: state.activeWorkspaceId,
        expectedOrganizationRevision: state.organization.revision,
        organization: { mode: "freeform" },
      });
      for (const [index, kind] of ["note", "conversation", "note"].entries()) {
        await execute({
          type: "createResource",
          kind,
          title: "Synthetic direct card " + index,
          workspaceId: state.activeWorkspaceId,
        });
        state = await snapshot();
        const resource = state.resources.find(
            (r) => r.title === "Synthetic direct card " + index,
          ),
          block = state.blocks.find((b) => b.resource_id === resource.id);
        await execute({
          type: "geometry",
          blockId: block.id,
          expectedVersion: block.version,
          placement: {
            x: 80 + index * 390,
            y: 240,
            width: 300,
            height: 240,
            z: index === 0 ? 10 : index,
          },
          shape: index === 0 ? "folio" : index === 1 ? "rectangle" : "rounded",
        });
        if (kind === "note")
          await execute({
            type: "content",
            resourceId: resource.id,
            expectedVersion: resource.version,
            content:
              "Synthetic persisted note content for direct manipulation.",
          });
      }
      state = await snapshot();
      await execute({
        type: "setPresence",
        workspaceId: state.activeWorkspaceId,
        expectedVersion: state.presence.version,
        placement: { x: 1180, y: 170 },
      });
      state = await snapshot();
      const block = state.blocks.find(
          (b) =>
            state.resources.find((r) => r.id === b.resource_id)?.title ===
            "Synthetic direct card 0",
        ),
        id = block.id,
        selector = `[data-block="${id}"]`;
      await wait(
        `document.querySelector(${JSON.stringify(selector)})?.dataset.directManipulation==='true'`,
      );
      assert.equal(
        await js(
          'document.querySelectorAll(".move-controls,.block-tools,button.grip,.canvas-tools,.vela-grip").length',
        ),
        0,
      );
      assert.equal(
        await js('getComputedStyle(document.querySelector(".dock")).display'),
        "none",
      );
      assert.equal(
        await js(
          'document.querySelectorAll(".aw-workspace-layout [data-organization-mode]").length',
        ),
        3,
      );
      receipt.checks.push(
        "no move widgets, numeric setup or taskbar; compact layout control",
      );
      await pause(300);
      const radii = await js(
        'Array.from(document.querySelectorAll("[data-block]")).map(e=>{const s=getComputedStyle(e);return[s.borderTopLeftRadius,s.borderTopRightRadius,s.borderBottomRightRadius,s.borderBottomLeftRadius]})',
      );
      assert.equal(
        radii.flat().every((value) => value === "18px"),
        true,
      );
      receipt.checks.push(
        "all three rectangular card families have identical18px corners",
      );
      await shot("consistent-cards");
      await js(
        `window.__directEditor=document.querySelector(${JSON.stringify(selector + " textarea")});window.__directEditor.setSelectionRange(3,12);window.__directEditor.scrollTop=4;`,
      );
      const point = async (target) => {
        await pause(100);
        return js(
          `(()=>{const e=document.querySelector(${JSON.stringify(target)}),r=e.getBoundingClientRect(),x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2),hit=document.elementFromPoint(x,y);if(hit?.closest('[data-block]')?.dataset.block!==${JSON.stringify(id)})throw Error('Occluded direct gesture');return{x,y}})()`,
        );
      };
      const drag = async (target, dx, dy, cancel = false) => {
        const p = await point(target);
        win.webContents.sendInputEvent({ type: "mouseMove", ...p });
        win.webContents.sendInputEvent({
          type: "mouseDown",
          ...p,
          button: "left",
          clickCount: 1,
        });
        for (let step = 1; step <= 10; step++) {
          win.webContents.sendInputEvent({
            type: "mouseMove",
            x: Math.round(p.x + (dx * step) / 10),
            y: Math.round(p.y + (dy * step) / 10),
            button: "left",
            modifiers: ["leftbuttondown"],
          });
          await pause(14);
        }
        if (cancel) {
          win.webContents.sendInputEvent({
            type: "keyDown",
            keyCode: "Escape",
          });
          win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
        }
        win.webContents.sendInputEvent({
          type: "mouseUp",
          x: p.x + dx,
          y: p.y + dy,
          button: "left",
          clickCount: 1,
        });
        receipt.actions.push({
          target,
          dx,
          dy,
          cancel,
          method: "native mouse input",
        });
      };
      const initial = await snapshot();
      await drag(selector + " .folio-top", 40, 20);
      await wait(
        `window.__aerynth.application().layoutVersion>${initial.layoutVersion}`,
      );
      state = await snapshot();
      let current = state.blocks.find((b) => b.id === id);
      assert.equal(current.x, block.x + 40);
      assert.equal(current.y, block.y + 20);
      assert.equal(current.width, block.width);
      receipt.checks.push(
        "surface drag commits once without a handle or setup",
      );
      for (const [edge, dx, dy] of [
        ["e", 32, 0],
        ["w", -20, 0],
        ["s", 0, 24],
        ["n", 0, -16],
        ["ne", 20, -16],
        ["nw", -16, -16],
        ["se", 24, 20],
        ["sw", -16, 16],
      ]) {
        const before = await snapshot();
        await drag(selector + " .aw-card-edge--" + edge, dx, dy);
        await wait(
          `window.__aerynth.application().layoutVersion>${before.layoutVersion}`,
        );
        const after = await snapshot(),
          resized = after.blocks.find((b) => b.id === id),
          old = before.blocks.find((b) => b.id === id);
        assert.ok(
          resized.width !== old.width || resized.height !== old.height,
          edge + " resizes",
        );
        assert.deepEqual(
          after.resources,
          before.resources,
          "Resizing cannot edit a subject",
        );
      }
      receipt.checks.push(
        "all eight edge/corner resize gestures persist while resources stay unchanged",
      );
      assert.equal(
        await js(
          `document.querySelector(${JSON.stringify(selector + " textarea")})===window.__directEditor&&window.__directEditor.selectionStart===3&&window.__directEditor.selectionEnd===12`,
        ),
        true,
      );
      receipt.checks.push(
        "editor DOM identity and selection survive drag and resize",
      );
      const beforeCancel = await snapshot();
      await drag(selector + " .aw-card-edge--se", 36, 28, true);
      await pause(250);
      assert.deepEqual((await snapshot()).blocks, beforeCancel.blocks);
      assert.equal(
        (await snapshot()).layoutVersion,
        beforeCancel.layoutVersion,
      );
      receipt.checks.push("Escape cancels resize without a canonical write");
      await shot("resized-card");
      await click('[data-organization-mode="fluid"]');
      await wait('window.__aerynth.application().organization.mode==="fluid"');
      await click('[data-organization-mode="structured"]');
      await wait(
        'window.__aerynth.application().organization.mode==="structured"',
      );
      receipt.checks.push(
        "compact layout controls apply real Fluid and Structured policy",
      );
      await shot("compact-layout");
      const expected = await snapshot();
      await fs.writeFile(
        path.join(privateRoot, "direct-expected.json"),
        JSON.stringify(expected),
      );
    }
    assert.deepEqual(receipt.errors, []);
    receipt.passed = true;
  } catch (error) {
    receipt.failure = { message: error.message, stack: error.stack };
    process.exitCode = 1;
  } finally {
    await fs.writeFile(
      path.join(output, "direct.json"),
      JSON.stringify(receipt, null, 2),
    );
    console.log(
      JSON.stringify({
        passed: receipt.passed,
        checks: receipt.checks.length,
        output,
        failure: receipt.failure?.message,
      }),
    );
    app.quit();
  }
};
