const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const { createDriver } = require("./desktop-verify.cjs");
const { startWindowRecording } = require("./application-recording.cjs");

/** Real desktop host + real canonical SQLite + real V3.5 context. No fixture service. */
exports.verify = async ({
  win,
  app,
  privateRoot,
  source,
  moduleStarted,
  session,
  localURL,
}) => {
  const out = path.resolve(
    __dirname,
    "../.runtime/application-evidence",
    "constellation-" + Date.now(),
  );
  await fs.mkdir(out, { recursive: true });
  const receipt = {
    source,
    syntheticData: true,
    host: "Actual Aerynth desktop-main.cjs + private SQLite + V3.5 Environment",
    checks: [],
    actions: [],
    screenshots: [],
    passed: false,
    limitations: [
      "Native screenshots and recording require human artistic review.",
      "Capture and callback cadence are not monitor-presented frame measurements.",
      "This run does not establish a production performance threshold.",
    ],
  };
  let recorder = null;
  try {
    const d = await createDriver(win),
      { js, wait, click, fill, snapshot } = d;
    receipt.startupToInteractiveMs = Date.now() - moduleStarted;
    const shot = async (name) => {
      await pause(350);
      const file = name + ".png",
        bytes = (await win.webContents.capturePage()).toPNG();
      await fs.writeFile(path.join(out, file), bytes);
      receipt.screenshots.push({
        file,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    };
    const mark = (label) =>
      receipt.actions.push({ label, at: new Date().toISOString() });
    const clickText = async (text, scope = ".aw-constellation") => {
      const token = "qa-" + Date.now();
      const found = await js(
        `(()=>{const e=[...document.querySelectorAll(${JSON.stringify(scope + " button")})].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!e)return false;e.dataset.nativeTarget=${JSON.stringify(token)};return true})()`,
      );
      if (!found) throw Error("Visible UI button not found: " + text);
      await click(`[data-native-target="${token}"]`);
    };
    const node = async (key) => {
      await wait(
        `!!document.querySelector(${JSON.stringify('[data-key="' + key + '"]')})`,
        20000,
      );
      await click(`[data-key="${key}"]`);
      await clickText("Open destination", ".aw-spatial-detail");
      await pause(450);
    };
    const selectWorkspace = async (id) => {
      await click("#workspace-manager");
      await click(`[data-workspace="${id}"]`);
      await wait(
        `window.__aerynth.application().activeWorkspaceId===${JSON.stringify(id)}&&window.__aerynth.application().navigation.kind==='workspace'`,
      );
      await pause(300);
    };
    const createProject = async (title) => {
      await click("#workspace-manager");
      await click("#new-project");
      await fill("#project-title", title);
      await click('dialog button[type="submit"]');
      await wait('!document.querySelector("#command-surface").open');
      return (await snapshot()).projects.find((p) => p.title === title).id;
    };
    const createWorkspace = async (title, projectId) => {
      await click("#workspace-manager");
      await click("#new-workspace");
      await fill("#workspace-title", title);
      await fill('dialog select[name="projectId"]', projectId);
      await click('dialog button[type="submit"]');
      await wait('!document.querySelector("#command-surface").open');
      await pause(200);
      return (await snapshot()).activeWorkspaceId;
    };
    const addNote = async (title, content) => {
      await click("#add-block");
      await fill("#block-kind", "note");
      await fill("#block-title", title);
      await click('dialog button[type="submit"]');
      await wait('!document.querySelector("#command-surface").open');
      const s = await snapshot(),
        r = s.resources.find((r) => r.title === title),
        b = s.blocks.find((b) => b.resource_id === r.id);
      await click(`[data-block="${b.id}"] .unfold`);
      await fill(`[data-block="${b.id}"] textarea`, content);
      await js("window.__aerynth.flush()");
      await click("#home");
      return b.id;
    };
    const geometry = (s) =>
      s.blocks
        .map((b) => ({
          id: b.id,
          resource_id: b.resource_id,
          workspace_id: b.workspace_id,
          x: b.x,
          y: b.y,
          width: b.width,
          height: b.height,
          z: b.z,
          shape: b.shape,
          rotation: b.rotation,
        }))
        .sort((a, b) => (a.id < b.id ? -1 : 1));

    if (process.argv.includes("--verify-restore")) {
      const expected = JSON.parse(
        await fs.readFile(
          path.join(privateRoot, "constellation-expected.json"),
          "utf8",
        ),
      );
      const actual = await snapshot();
      assert.equal(actual.activeWorkspaceId, expected.activeWorkspaceId);
      assert.deepEqual(geometry(actual), geometry(expected));
      assert.deepEqual(actual.resources, expected.resources);
      assert.deepEqual(actual.projects, expected.projects);
      assert.deepEqual(actual.workspaces, expected.workspaces);
      assert.deepEqual(actual.presence, expected.presence);
      receipt.checks.push(
        "fresh-process-restart-keeps-projects-workspaces-resources-geometry-content-and-Vela",
      );
      await shot("09-restarted-original");
    } else {
      const projectA = await createProject("A World for Two"),
        workspaceA = await createWorkspace("Development", projectA);
      await addNote(
        "Development notes",
        "Synthetic original workspace content. Canonical identity survives spatial navigation.",
      );
      const projectB = await createProject("Engineering"),
        workspaceB = await createWorkspace("Control Room", projectB),
        otherBlock = await addNote(
          "Engineering notes",
          "Synthetic second workspace content.",
        );
      await selectWorkspace(workspaceA);
      const original = await snapshot();
      await shot("01-original-workspace");
      assert.equal(
        await js("window.__aerynth.snapshot().gpu.backend"),
        "Three.js WebGL2",
      );
      recorder = await startWindowRecording(win, session, localURL);
      mark("Start inside actual editable Development workspace");
      await click("#zoom-out");
      await wait(
        'window.__aerynth.application().navigation.kind==="constellation"',
      );
      await pause(600);
      await shot("02-project-overview");
      mark("Zoom out to canonical project overview");
      await clickText("Universe", ".aw-constellation-bar");
      await wait(
        'window.__aerynth.application().navigation.kind==="constellation"&&window.__aerynth.application().navigation.projectId===null',
      );
      await pause(700);
      await shot("03-universe");
      mark("Universe with canonical project systems");
      await node("project:" + projectB);
      await wait(
        `window.__aerynth.application().navigation.projectId===${JSON.stringify(projectB)}`,
      );
      await shot("04-other-project");
      await node("workspace:" + workspaceB);
      await wait(
        `window.__aerynth.application().activeWorkspaceId===${JSON.stringify(workspaceB)}&&window.__aerynth.application().navigation.kind==='workspace'`,
      );
      mark("Selected another project and zoomed into Control Room");
      const beforeMove = (await snapshot()).blocks.find(
        (b) => b.id === otherBlock,
      );
      const p = await js(
        `(()=>{const e=document.querySelector('[data-block="${otherBlock}"] .grip'),r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`,
      );
      win.webContents.sendInputEvent({ type: "mouseMove", ...p });
      win.webContents.sendInputEvent({
        type: "mouseDown",
        button: "left",
        clickCount: 1,
        ...p,
      });
      for (let i = 1; i <= 12; i++) {
        win.webContents.sendInputEvent({
          type: "mouseMove",
          x: p.x - (20 * i) / 12,
          y: p.y + (90 * i) / 12,
          button: "left",
        });
        await pause(25);
      }
      win.webContents.sendInputEvent({
        type: "mouseUp",
        button: "left",
        clickCount: 1,
        x: p.x - 20,
        y: p.y + 90,
      });
      await wait(
        `window.__aerynth.application().blocks.find(b=>b.id===${JSON.stringify(otherBlock)}).version>${beforeMove.version}`,
      );
      await click(`[data-block="${otherBlock}"] .unfold`);
      await fill(
        `[data-block="${otherBlock}"] textarea`,
        "Synthetic edit made through the real Control Room editor.",
      );
      await js("window.__aerynth.flush()");
      await shot("05-other-workspace-edited");
      await click("#home");
      mark("Native pointer move and real persisted editor input");
      await click("#zoom-out");
      await pause(450);
      await clickText("Universe", ".aw-constellation-bar");
      await pause(500);
      await node("project:" + projectA);
      await pause(400);
      await node("workspace:" + workspaceA);
      await wait(
        `window.__aerynth.application().activeWorkspaceId===${JSON.stringify(workspaceA)}`,
      );
      await pause(400);
      let s = await snapshot();
      assert.deepEqual(geometry(s), geometry(original));
      for (const r of original.resources) {
        const current = s.resources.find((x) => x.id === r.id);
        if (r.title !== "Engineering notes") assert.deepEqual(current, r);
      }
      await shot("06-original-restored");
      receipt.checks.push(
        "two-project-round-trip-restores-exact-original-layout-and-content",
      );
      mark(
        "Returned through spatial project systems to exact original workspace",
      );
      receipt.video = await recorder.stop(
        path.join(out, "combined-spatial-journey.webm"),
      );
      recorder = null;

      const fresh = await createWorkspace(
        "Discoverable new workspace",
        projectB,
      );
      await click("#zoom-out");
      await pause(400);
      await clickText("Destinations", ".aw-constellation-bar");
      await fill(".aw-destinations input", "Discoverable new workspace");
      await wait(
        'document.querySelector(".aw-destination-results").textContent.includes("Discoverable new workspace")',
      );
      await shot("07-new-destination");
      await clickText("Close destinations", ".aw-destinations");
      await click("#workspace-manager");
      await click(`[data-archive="${fresh}"]`);
      await wait(
        `window.__aerynth.application().archivedWorkspaces.some(w=>w.id===${JSON.stringify(fresh)})`,
      );
      await click("#command-surface [data-close]");
      await click("#zoom-out");
      await pause(350);
      await clickText("Destinations", ".aw-constellation-bar");
      await fill(".aw-destinations input", "Discoverable new workspace");
      await wait(
        'document.querySelector(".aw-destination-results").textContent.includes("No accessible destinations")',
      );
      await shot("08-archived-destination-absent");
      await clickText("Close destinations", ".aw-destinations");
      receipt.checks.push(
        "canonical-create-and-archive-refresh-navigation-without-an-independent-store",
      );
      await selectWorkspace(workspaceA);
      await click("#settings-button");
      await click("#reduced");
      await click("#settings-close");
      assert.equal(await js("window.__aerynth.snapshot().reduced"), true);
      await click("#zoom-out");
      await pause(250);
      await click("#nav-back");
      await wait(
        `window.__aerynth.application().navigation.kind==='workspace'&&window.__aerynth.application().activeWorkspaceId===${JSON.stringify(workspaceA)}`,
      );
      receipt.checks.push(
        "reduced-motion-navigation-and-interruption-retain-canonical-workspace",
      );
      await js("window.__aerynth.simulateContextLoss()");
      await wait("window.__aerynth.snapshot().graphicsFailed");
      assert.deepEqual(geometry(await snapshot()), geometry(original));
      await js("window.__aerynth.restoreContext()");
      await wait("!window.__aerynth.snapshot().graphicsFailed");
      receipt.checks.push(
        "real-WebGL-context-loss-recovery-retains-data-and-navigation",
      );
      await pause(500);
      await shot("10-graphics-restored");
      await js("window.__aerynth.flush()");
      s = await snapshot();
      await fs.writeFile(
        path.join(privateRoot, "constellation-expected.json"),
        JSON.stringify(s),
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
    if (recorder)
      try {
        receipt.partialVideo = await recorder.stop(
          path.join(out, "partial-failed-journey.webm"),
        );
      } catch (error) {
        receipt.recordingError = error.message;
      }
  }
  await fs.writeFile(
    path.join(out, "combined.json"),
    JSON.stringify(receipt, null, 2),
  );
  console.log(
    JSON.stringify({
      passed: receipt.passed,
      error: receipt.error,
      checks: receipt.checks,
      evidence: out,
    }),
  );
  process.exitCode = receipt.passed ? 0 : 1;
  app.quit();
};
