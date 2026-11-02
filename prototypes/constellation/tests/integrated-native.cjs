const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const native = "../../visual-experience/cinematic-v3/native/";
const { createDriver } = require(native + "desktop-verify.cjs");
const { startWindowRecording } = require(native + "application-recording.cjs");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const geometry = (s) =>
  s.blocks
    .map(
      ({
        id,
        resource_id,
        workspace_id,
        x,
        y,
        width,
        height,
        z,
        shape,
        rotation,
      }) => ({
        id,
        resource_id,
        workspace_id,
        x,
        y,
        width,
        height,
        z,
        shape,
        rotation,
      }),
    )
    .sort((a, b) => a.id.localeCompare(b.id));

/** Called only by the integration lead's existing real desktop host; never launches a window. */
exports.verify = async ({
  win,
  app,
  privateRoot,
  source,
  session,
  localURL,
}) => {
  assert.ok(
    process.argv.includes("--integration-expanded"),
    "explicit expanded native mode required",
  );
  assert.ok(
    source?.hashes && source?.buildAssets,
    "source and built asset hashes required",
  );
  const out = path.resolve(
    __dirname,
    "../../visual-experience/cinematic-v3/.runtime/application-evidence",
    "expanded-" + Date.now(),
  );
  await fs.mkdir(out, { recursive: true });
  const receipt = {
    source,
    syntheticData: true,
    host: "Existing actual Aerynth desktop host, canonical SQLite and shared V3.5 WebGL context",
    checks: [],
    actions: [],
    screenshots: [],
    videos: [],
    passed: false,
    limitations: [
      "Window recordings and callback statistics do not measure monitor-presented frames.",
      "Ordinary conversation branching is an app-level continuation with reviewed source context; no provider fork, inference or model response is claimed.",
      "Tasks, notes, research and references use existing canonical resource types; a dedicated task-group resource type is unavailable.",
      "This journey does not replace rendered-scale performance measurements or owner artistic acceptance.",
    ],
  };
  let recorder;
  const { js, wait, click, fill, snapshot } = await createDriver(win);
  const mark = (label) =>
    receipt.actions.push({ label, at: new Date().toISOString() });
  const spatial = () => js("window.__aerynth.snapshot().spatial");
  const flush = () => js("window.__aerynth.flush()");
  const view = () => js("window.aerynthHost.command('viewState',{})");
  const shot = async (name) => {
    assert.ok(receipt.screenshots.length < 12, "screenshot count bound");
    await pause(350);
    const bytes = (await win.webContents.capturePage()).toPNG();
    assert.ok(bytes.length < 8 * 1024 * 1024, "screenshot byte bound");
    await fs.writeFile(path.join(out, name + ".png"), bytes, { flag: "wx" });
    receipt.screenshots.push({
      file: name + ".png",
      byteCount: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  };
  const textButton = async (text, scope = ".aw-constellation") => {
    const token = "expanded-" + Date.now();
    await js(
      `(()=>{const e=[...document.querySelectorAll(${JSON.stringify(scope + " button")})].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!e)throw Error('Missing button: '+${JSON.stringify(text)});e.dataset.expandedTarget=${JSON.stringify(token)}})()`,
    );
    await click(`[data-expanded-target="${token}"]`);
  };
  const closeGraph = () => textButton("Close", ".aw-graph-dialog");
  const selectWorkspace = async (id) => {
    await click("#workspace-manager");
    await click(`[data-workspace="${id}"]`);
    await wait(
      `window.__aerynth.application().navigation.kind==='workspace'&&window.__aerynth.application().activeWorkspaceId===${JSON.stringify(id)}`,
    );
    await pause(300);
  };
  const node = async (key) => {
    await wait(
      `!!document.querySelector(${JSON.stringify('[data-key="' + key + '"]')})`,
    );
    await click(`[data-key="${key}"]`);
    await textButton("Open destination", ".aw-spatial-detail");
    await pause(450);
  };
  const locate = async (title, id) => {
    await textButton("Destinations", ".aw-constellation-bar");
    await fill(".aw-destinations input", title);
    await click(
      `.aw-destination-results button[aria-label=${JSON.stringify("Locate " + title)}]`,
    );
    await textButton("Close destinations", ".aw-destinations");
    await wait(
      `window.__aerynth.snapshot().spatial.selected===${JSON.stringify(id)}`,
    );
    await pause(550);
  };
  const createProject = async (title) => {
    await click("#workspace-manager");
    await click("#new-project");
    await fill("#project-title", title);
    await click('#command-surface button[type="submit"]');
    await wait('!document.querySelector("#command-surface").open');
    return (await snapshot()).projects.find((p) => p.title === title).id;
  };
  const createWorkspace = async (title, projectId) => {
    await click("#workspace-manager");
    await click("#new-workspace");
    await fill("#workspace-title", title);
    await fill('#command-surface select[name="projectId"]', projectId);
    await click('#command-surface button[type="submit"]');
    await wait('!document.querySelector("#command-surface").open');
    await wait(
      `window.__aerynth.application().workspaces.some(w=>w.title===${JSON.stringify(title)})`,
    );
    return (await snapshot()).workspaces.find((w) => w.title === title).id;
  };
  const add = async (kind, title) => {
    await click("#add-block");
    await fill("#block-kind", kind);
    await fill("#block-title", title);
    await click('#command-surface button[type="submit"]');
    await wait('!document.querySelector("#command-surface").open');
    const s = await snapshot(),
      r = s.resources.find((r) => r.title === title),
      b = s.blocks.find((b) => b.resource_id === r?.id);
    assert.ok(r && b, "created canonical resource and block");
    return { resource: r, block: b };
  };
  const startSegment = async (label) => {
    assert.ok(
      receipt.videos.length < 2,
      "two bounded recording segments maximum",
    );
    recorder = await startWindowRecording(win, session, localURL);
    mark("Start recording: " + label);
  };
  const stopSegment = async (file) => {
    receipt.videos.push(await recorder.stop(path.join(out, file)));
    recorder = null;
  };
  const drag = async (selector, dx, dy, modifiers = [], bodyKey) => {
    const p = await js(
      `(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e?.getBoundingClientRect();if(!r)throw Error('Missing drag surface');let x=Math.round(r.x+r.width*.2),y=Math.round(r.y+r.height*.7);const key=${JSON.stringify(bodyKey ?? null)};if(key){const label=document.querySelector('[data-key="'+key+'"]'),lr=label?.getBoundingClientRect();if(!lr)throw Error('Body label missing');const lx=lr.x+lr.width/2-r.x,ly=lr.y+lr.height/2-r.y,lines=[...document.querySelectorAll('.aw-connections line')];const line=lines.find(l=>Math.abs(Number(l.getAttribute('x2'))-lx)<4&&Math.abs(Number(l.getAttribute('y2'))+15-ly)<4);if(!line)throw Error('Projected body leader missing');x=Math.round(r.x+Number(line.getAttribute('x1')));y=Math.round(r.y+Number(line.getAttribute('y1')));}const h=document.elementFromPoint(x,y);if(h!==e&&!h?.classList.contains('aw-spatial-world'))throw Error('Drag target occluded: '+h?.className);return {x,y}})()`,
    );
    win.webContents.sendInputEvent({ type: "mouseMove", ...p, modifiers });
    win.webContents.sendInputEvent({
      type: "mouseDown",
      ...p,
      button: "left",
      clickCount: 1,
      modifiers,
    });
    await pause(75);
    for (let i = 1; i <= 12; i++) {
      win.webContents.sendInputEvent({
        type: "mouseMove",
        x: Math.round(p.x + (dx * i) / 12),
        y: Math.round(p.y + (dy * i) / 12),
        button: "left",
        modifiers: [...modifiers, "leftbuttondown"],
      });
      await pause(20);
    }
    win.webContents.sendInputEvent({
      type: "mouseUp",
      x: Math.round(p.x + dx),
      y: Math.round(p.y + dy),
      button: "left",
      clickCount: 1,
      modifiers,
    });
    await pause(650);
    mark("Native pointer drag " + selector + " " + modifiers.join("+"));
  };
  try {
    if (process.argv.includes("--verify-restore")) {
      const expected = JSON.parse(
        await fs.readFile(
          path.join(privateRoot, "expanded-expected.json"),
          "utf8",
        ),
      );
      const actual = await snapshot();
      assert.equal(
        actual.activeWorkspaceId,
        expected.snapshot.activeWorkspaceId,
      );
      assert.deepEqual(geometry(actual), geometry(expected.snapshot));
      for (const key of [
        "projects",
        "workspaces",
        "resources",
        "relationships",
        "conversationBranches",
        "presence",
      ])
        assert.deepEqual(
          actual[key],
          expected.snapshot[key],
          "restart canonical " + key,
        );
      const restored = await view();
      for (const key of ["anchors", "bookmarks", "location", "history"])
        assert.deepEqual(
          restored[key],
          expected.view[key],
          "restart spatial " + key,
        );
      receipt.checks.push(
        "fresh-process-restart-keeps-canonical-identities-content-relationships-branch-ancestry-and-complete-spatial-view",
      );
      await shot("11-restored-workspace");
      await click("#zoom-out");
      await pause(600);
      await shot("12-restored-project");
    } else {
      const projects = [],
        workspaces = [],
        records = [];
      for (const [pi, [name, names]] of [
        ["A World for Two", ["Development", "Planning"]],
        ["Voyagewright", ["Engineering", "Review"]],
        ["Airbrush Disc System", ["Calibration", "Hardware"]],
      ].entries()) {
        const projectId = await createProject(name);
        projects.push(projectId);
        for (const [wi, title] of names.entries()) {
          const workspaceId = await createWorkspace(title, projectId);
          workspaces.push(workspaceId);
          const row = { projectId, workspaceId, title };
          for (const kind of [
            "conversation",
            "note",
            "task",
            "research",
            "reference",
          ]) {
            row[kind] = await add(kind, title + " " + kind);
          }
          const b = row.note.block;
          await click(`[data-block="${b.id}"] .block-properties`);
          for (const [field, value] of Object.entries({
            x: 100 + pi * 70,
            y: 190 + wi * 65,
            width: 330 + pi * 35,
            height: 230 + wi * 25,
          }))
            await fill(
              `#command-surface input[name="${field}"]`,
              String(value),
            );
          await click('#command-surface button[type="submit"]');
          await wait('!document.querySelector("#command-surface").open');
          await click(`[data-block="${b.id}"] .unfold`);
          await fill(
            `[data-block="${b.id}"] textarea`,
            "Synthetic durable " + title + " note. Stable resource identity.",
          );
          await flush();
          await click("#home");
          await click(`[data-block="${row.reference.block.id}"] .unfold`);
          await fill(
            `[data-block="${row.reference.block.id}"] textarea`,
            "Synthetic link: https://example.invalid/" + title.toLowerCase(),
          );
          await flush();
          await click("#home");
          records.push(row);
        }
      }
      assert.equal(projects.length, 3);
      assert.equal(workspaces.length, 6);
      const originalRow = records[0],
        other = records[2];
      await selectWorkspace(originalRow.workspaceId);
      const original = await snapshot();
      await shot("01-original-working-workspace");
      receipt.checks.push(
        "three-named-projects-six-distinct-workspaces-thirty-real-typed-resources-and-durable-note-content",
      );
      await startSegment("orbit, pan, inspect and reviewed branch");
      await click("#zoom-out");
      await pause(650);
      const before = (await spatial()).camera;
      await drag(".aw-spatial-field", 95, -25);
      const orbited = (await spatial()).camera;
      assert.notEqual(orbited.yaw, before.yaw);
      await drag(".aw-spatial-field", 60, 25, ["shift"]);
      const panned = (await spatial()).camera;
      assert.notDeepEqual(panned.target, orbited.target);
      await shot("02-orbit-and-pan");
      receipt.checks.push(
        "native-pointer-orbit-and-shift-pan-change-real-perspective-camera",
      );
      await textButton("Universe", ".aw-constellation-bar");
      await pause(650);
      await shot("03-three-planet-universe");
      assert.equal(
        (await snapshot()).projects.filter((p) => projects.includes(p.id))
          .length,
        3,
      );
      await node("project:" + other.projectId);
      await node("workspace:" + other.workspaceId);
      await click(`[data-block="${other.conversation.block.id}"] .unfold`);
      for (const content of [
        "Synthetic selected context for a reviewed continuation.",
        "Synthetic later message deliberately not selected for handoff.",
      ]) {
        await fill(
          `[data-block="${other.conversation.block.id}"] .conversation-compose textarea`,
          content,
        );
        await click(
          `[data-block="${other.conversation.block.id}"] .conversation-compose button[type="submit"]`,
        );
        await wait(
          `window.__aerynth.application().resources.find(r=>r.id===${JSON.stringify(other.conversation.resource.id)}).messages.some(m=>m.content===${JSON.stringify(content)})`,
        );
      }
      await click("#home");
      await click("#zoom-out");
      await pause(500);
      const source = (await snapshot()).resources.find(
        (r) => r.id === other.conversation.resource.id,
      );
      assert.equal(source.provider, "local");
      assert.equal(source.messages.length, 2);
      await locate(source.title, "resource:" + other.conversation.block.id);
      await textButton("Inspect relationships", ".aw-spatial-detail");
      await shot("04-inspected-resource-provenance");
      await closeGraph();
      await textButton("Branch conversation", ".aw-spatial-detail");
      assert.equal(
        await js(
          "document.querySelectorAll('.aw-graph-dialog input[type=checkbox]:checked').length",
        ),
        0,
      );
      await fill(
        '.aw-graph-dialog input[type="text"]',
        "Reviewed Engineering continuation",
      );
      await fill(".aw-graph-dialog select", source.messages.at(-1).id);
      await click('.aw-graph-dialog fieldset input[type="checkbox"]');
      receipt.reviewedBranch = {
        parentResourceId: source.id,
        forkMessageId: source.messages.at(-1).id,
        selectedMessageIds: [source.messages[0].id],
        omittedMessageIds: [source.messages[1].id],
      };
      await shot("05-explicit-context-review");
      await click('.aw-graph-dialog button[type="submit"]');
      await wait('!document.querySelector(".aw-graph-dialog").open');
      const afterBranch = await snapshot(),
        child = afterBranch.resources.find(
          (r) => r.title === "Reviewed Engineering continuation",
        ),
        lineage = afterBranch.conversationBranches.find(
          (b) => b.childResourceId === child?.id,
        );
      assert.ok(child && lineage);
      assert.equal(lineage.parentResourceId, source.id);
      assert.equal(lineage.sourceMessageId, source.messages.at(-1).id);
      assert.equal(lineage.mode, "application_continuation");
      assert.deepEqual(
        afterBranch.resources.find((r) => r.id === source.id).messages,
        source.messages,
      );
      assert.ok(
        (afterBranch.navigationBlocks ?? afterBranch.blocks).some(
          (b) => b.resource_id === child.id,
        ),
      );
      receipt.checks.push(
        "native-reviewed-app-level-branch-with-explicit-source-selection-real-ancestry-and-unchanged-parent",
      );
      await stopSegment("01-orbit-inspect-reviewed-branch.webm");

      await startSegment("pin, typed relationship and exact working return");
      await locate(source.title, "resource:" + other.conversation.block.id);
      const beforeDrag = (await spatial()).anchors[
        "resource:" + other.conversation.block.id
      ].spatial;
      await drag(
        ".aw-spatial-field",
        55,
        -30,
        ["alt"],
        "resource:" + other.conversation.block.id,
      );
      const afterDrag = (await spatial()).anchors[
        "resource:" + other.conversation.block.id
      ];
      assert.notDeepEqual(afterDrag.spatial, beforeDrag);
      assert.equal(afterDrag.pinned, true);
      receipt.checks.push(
        "native-alt-drag-moves-and-pins-the-ray-picked-3D-moon",
      );
      const old = (await spatial()).anchors[
          "resource:" + other.conversation.block.id
        ].spatial,
        desired = {
          x: Math.round(old.x + 85),
          y: Math.round(old.y + 45),
          z: Math.round(old.z - 35),
        };
      for (const axis of ["X", "Y", "Z"])
        await fill(
          `.aw-spatial-detail input[aria-label="Anchor ${axis} position"]`,
          String(desired[axis.toLowerCase()]),
        );
      if (
        !(await js(
          'document.querySelector(".aw-spatial-detail input[type=checkbox]").checked',
        ))
      )
        await click(
          '.aw-spatial-detail input[aria-label="Pin spatial position"]',
        );
      await textButton("Save position", ".aw-spatial-detail");
      await flush();
      const pinned = (await spatial()).anchors[
        "resource:" + other.conversation.block.id
      ];
      assert.deepEqual(pinned.spatial, desired);
      assert.equal(pinned.pinned, true);
      await shot("06-moved-and-pinned-moon");
      await textButton("Link resources", ".aw-constellation-bar");
      // Each select belongs to a label, so address the form's label order explicitly.
      await fill(".aw-graph-dialog label:nth-of-type(1) select", source.id);
      await fill(
        ".aw-graph-dialog label:nth-of-type(2) select",
        other.note.resource.id,
      );
      await fill(".aw-graph-dialog label:nth-of-type(3) select", "references");
      await click('.aw-graph-dialog button[type="submit"]');
      await wait('!document.querySelector(".aw-graph-dialog").open');
      const relationship = (await snapshot()).relationships.find(
        (e) =>
          e.source_id === source.id &&
          e.target_id === other.note.resource.id &&
          e.kind === "references",
      );
      assert.ok(relationship);
      await textButton("Inspect relationships", ".aw-spatial-detail");
      assert.ok(
        (
          await js('document.querySelector(".aw-graph-dialog").textContent')
        ).includes("references"),
      );
      await shot("07-typed-relationship-inspection");
      await closeGraph();
      receipt.checks.push(
        "native-position-pin-and-canonical-directed-relationship-creation-with-inspection",
      );
      await textButton("Universe", ".aw-constellation-bar");
      await pause(550);
      await node("project:" + originalRow.projectId);
      await node("workspace:" + originalRow.workspaceId);
      assert.deepEqual(geometry(await snapshot()), geometry(original));
      for (const r of original.resources.filter(
        (r) => r.project_id === originalRow.projectId,
      ))
        assert.deepEqual(
          (await snapshot()).resources.find((x) => x.id === r.id),
          r,
        );
      await shot("08-exact-original-workspace-return");
      await selectWorkspace(other.workspaceId);
      await click(`[data-block="${other.note.block.id}"] .unfold`);
      await fill(
        `[data-block="${other.note.block.id}"] textarea`,
        "Synthetic real editor change after spatial branch and relationship navigation.",
      );
      await flush();
      await click("#home");
      await selectWorkspace(originalRow.workspaceId);
      assert.deepEqual(geometry(await snapshot()), geometry(original));
      assert.equal(
        (await snapshot()).resources.find(
          (r) => r.id === other.note.resource.id,
        ).content,
        "Synthetic real editor change after spatial branch and relationship navigation.",
      );
      receipt.checks.push(
        "real-working-editor-save-and-exact-original-workspace-geometry-identities-return",
      );
      await stopSegment("02-pin-relationship-return.webm");
      await flush();
      const expected = {
        snapshot: await snapshot(),
        view: await view(),
        reviewedBranch: receipt.reviewedBranch,
      };
      assert.deepEqual(
        expected.view.anchors["resource:" + other.conversation.block.id]
          .spatial,
        desired,
      );
      assert.equal(
        expected.view.anchors["resource:" + other.conversation.block.id].pinned,
        true,
      );
      await fs.writeFile(
        path.join(privateRoot, "expanded-expected.json"),
        JSON.stringify(expected),
        { flag: "wx" },
      );
      receipt.finalSpatial = await spatial();
      receipt.checks.push(
        "saved-private-view-state-includes-pins-XYZ-camera-bookmarks-and-history-with-real-canonical-branch-and-relationship",
      );
    }
    receipt.passed = true;
  } catch (error) {
    receipt.error = error.stack;
    try {
      await shot("failure");
    } catch {}
  } finally {
    if (recorder)
      try {
        receipt.videos.push(
          await recorder.stop(path.join(out, "partial-failed-segment.webm")),
        );
      } catch (error) {
        receipt.recordingError = error.message;
      }
  }
  await fs.writeFile(
    path.join(out, "expanded.json"),
    JSON.stringify(receipt, null, 2),
  );
  console.log(
    JSON.stringify({
      passed: receipt.passed,
      checks: receipt.checks,
      error: receipt.error,
      evidence: out,
    }),
  );
  process.exitCode = receipt.passed ? 0 : 1;
  app.quit();
};
