const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const native = "../../visual-experience/cinematic-v3/native/";
const { createDriver } = require(native + "desktop-verify.cjs");
const { startWindowRecording } = require(native + "application-recording.cjs");
const {
  checkLabelClearance,
  verifyWorkspaceGuide,
} = require("./native-labels.cjs");
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
    steps: [],
    screenshots: [],
    videos: [],
    passed: false,
    limitations: [
      "Window recordings and callback statistics do not measure monitor-presented frames.",
      "Ordinary conversation branching is an app-level continuation with reviewed source context; no provider fork, inference or model response is claimed.",
      "This journey does not replace rendered-scale performance measurements or owner artistic acceptance.",
    ],
  };
  let recorder;
  const { js, wait, click, fill, snapshot } = await createDriver(win);
  const mark = (label) =>
    receipt.actions.push({ label, at: new Date().toISOString() });
  const step = (number, label) =>
    receipt.steps.push({ number, label, at: new Date().toISOString() });
  const spatial = () => js("window.__aerynth.snapshot().spatial");
  const checkOverviewPresence = async (label) => {
    await wait(
      "(()=>{const b=window.__aerynth.snapshot().gpu.presenceBounds;return b&&b.w>0&&b.h>0&&b.x+b.w/2>=innerWidth*.75&&b.x+b.w/2<=innerWidth&&b.y+b.h/2>=0&&b.y+b.h/2<=innerHeight*.5})()",
    );
    receipt.actions.push({
      label: "Overview Vela placement: " + label,
      bounds: await js("window.__aerynth.snapshot().gpu.presenceBounds"),
      labelClearance: await checkLabelClearance(win),
    });
    const scene = await spatial(),
      discs = scene.renderer.projectedBodies;
    assert.ok(discs.length > 0, "actual scene has projected body bounds");
    for (let i = 0; i < discs.length; i++)
      for (let j = i + 1; j < discs.length; j++)
        assert.ok(
          Math.hypot(discs[i].x - discs[j].x, discs[i].y - discs[j].y) >=
            discs[i].radius + discs[j].radius + 7.99,
          "actual scene silhouettes retain a screen gap",
        );
    assert.equal(
      await js(
        'document.querySelectorAll(".aw-constellation-bar button").length',
      ),
      2,
      "only commands and info are persistent Constellation controls",
    );
  };
  const flush = () => js("window.__aerynth.flush()");
  const key = async (keyCode, modifiers = []) => {
    win.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
    await pause(100);
  };
  const view = () => js("window.aerynthHost.command('viewState',{})");
  const shot = async (name) => {
    assert.ok(receipt.screenshots.length < 14, "screenshot count bound");
    assert.ok(
      win.isFocused() && !win.isMinimized(),
      "native evidence requires the focused visible owner window",
    );
    const before = await js("window.__aerynth.snapshot().metrics.draws");
    for (const x of [3, 1])
      win.webContents.sendInputEvent({ type: "mouseMove", x, y: 1 });
    await wait(`window.__aerynth.snapshot().metrics.draws>${before}`, 8000);
    await pause(350);
    const bytes = (await win.webContents.capturePage()).toPNG();
    assert.ok(bytes.length < 8 * 1024 * 1024, "screenshot byte bound");
    await fs.writeFile(path.join(out, name + ".png"), bytes, { flag: "wx" });
    receipt.screenshots.push({
      file: name + ".png",
      byteCount: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      freshGpuDraws: {
        before,
        after: await js("window.__aerynth.snapshot().metrics.draws"),
      },
    });
  };
  const commandIds = {
    "Link resources": "link",
    "Explore neighborhood": "explore",
    "Inspect relationships": "relationships",
    "Branch conversation": "branch",
    Universe: "universe",
    "Inspect selection": "inspect",
    Arrange: "arrange",
  };
  const command = async (title) => {
    await click('.aw-quiet-control[aria-label="Commands and destinations"]');
    await fill(".aw-destinations input", title);
    await click(`.aw-command-row[data-command="${commandIds[title]}"]`);
  };
  const textButton = async (text, scope = ".aw-constellation") => {
    if (commandIds[text] && scope !== ".aw-graph-dialog") return command(text);
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
  const node = async (nodeKey) => {
    await wait(
      `!!document.querySelector(${JSON.stringify('[data-key="' + nodeKey + '"]')})`,
    );
    await click(`[data-key="${nodeKey}"]`);
    await key("Enter");
    await pause(450);
  };
  const locate = async (title, id) => {
    await click('.aw-quiet-control[aria-label="Commands and destinations"]');
    await fill(".aw-destinations input", title);
    await click(
      `.aw-destination-results button[data-command=${JSON.stringify(id)}]`,
    );
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
  const libraryField = async (label, tag = "input") => {
    const token = "library-field-" + label.toLowerCase().replaceAll(" ", "-");
    await js(
      `(()=>{const labels=[...document.querySelectorAll('.aw-library[aria-label="Block Library"] .aw-library__detail form label')],label=labels.find(e=>e.firstChild?.textContent.trim()===${JSON.stringify(label)}),control=label?.querySelector(${JSON.stringify(tag)});if(!control)throw Error('Missing Library field: '+${JSON.stringify(label)});control.dataset.expandedField=${JSON.stringify(token)}})()`,
    );
    return `[data-expanded-field="${token}"]`;
  };
  const add = async (kind, title, dimensions) => {
    await workingHome();
    const label = {
      conversation: "Conversation",
      note: "Note",
      task: "Task",
      research: "Research",
      reference: "Reference",
      task_group: "Task group",
    }[kind];
    assert.ok(label, "supported actual Library entry");
    await click('.aw-workspace-add[aria-label="Add block"]');
    await wait(
      `!!document.querySelector('.aw-library[aria-label="Block Library"] .aw-library__detail form')`,
    );
    await fill('.aw-library input[aria-label="Search blocks"]', label);
    await js(
      `(()=>{const entry=[...document.querySelectorAll('.aw-library__list button')].find(e=>e.firstChild?.textContent.replace(/^★ /,'').trim()===${JSON.stringify(label)});if(!entry)throw Error('Missing available Library entry: '+${JSON.stringify(label)});entry.dataset.expandedKind=${JSON.stringify(kind)}})()`,
    );
    await click(`.aw-library__list button[data-expanded-kind="${kind}"]`);
    await wait(
      `document.querySelector('.aw-library__detail h3')?.textContent===${JSON.stringify(label)}`,
    );
    await fill(await libraryField("Title"), title);
    if (kind === "conversation")
      await fill(await libraryField("Conversation backend", "select"), "local");
    if (dimensions) {
      await click(".aw-library__detail form > details > summary");
      for (const axis of ["Width", "Height"])
        if (dimensions[axis.toLowerCase()] !== undefined)
          await fill(
            await libraryField(axis),
            String(dimensions[axis.toLowerCase()]),
          );
    }
    await click('.aw-library__detail form > button[type="submit"]');
    await wait(
      `!document.querySelector('.aw-library[aria-label="Block Library"]')`,
    );
    await wait(
      `window.__aerynth.application().resources.some(r=>r.title===${JSON.stringify(title)})`,
    );
    const s = await snapshot(),
      r = s.resources.find((r) => r.title === title),
      b = s.blocks.find((b) => b.resource_id === r?.id);
    assert.ok(r && b, "created canonical resource and block");
    assert.equal(r.kind, kind);
    if (kind === "conversation") assert.equal(r.provider, "local");
    mark("Created through actual Block Library: " + title);
    return { resource: r, block: b };
  };
  const workingHome = async () => {
    await key("Escape");
    await wait('!document.querySelector(".folio.expanded")');
  };
  const workspaceActions = () =>
    click('.aw-workspace-layout [aria-label="Workspace actions"]');
  const workspaceOut = async () => {
    await workingHome();
    await workspaceActions();
    await click("#workspace-constellation");
    await pause(350);
  };
  const openBlock = async (id) => {
    await workingHome();
    await workspaceActions();
    await click(`[data-locate="${id}"]`);
  };
  const cardPoint = async (id, edge) => {
    const selector = `[data-block="${id}"] ${edge ? ".aw-card-edge--" + edge : ".folio-top"}`;
    let last, point;
    const deadline = Date.now() + 3000;
    do {
      await pause(80);
      point = await js(
        `(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e?.getBoundingClientRect();if(!r||!r.width||!r.height)return{error:'Missing direct card target'};for(const ratio of [.5,.3,.7,.15,.85]){const x=Math.round(r.x+r.width*ratio),y=Math.round(r.y+r.height*.5),hit=document.elementFromPoint(x,y);if(hit?.closest('[data-block]')?.dataset.block===${JSON.stringify(id)}&&!hit.closest('button,input,textarea,select,a,[contenteditable=true]')&&(!${JSON.stringify(edge ?? null)}||hit.closest('[data-resize-edge]')?.dataset.resizeEdge===${JSON.stringify(edge ?? null)}))return{x,y};}return{error:'Occluded direct card target'}})()`,
      );
      if (
        !point.error &&
        last &&
        !last.error &&
        Math.hypot(last.x - point.x, last.y - point.y) < 0.75
      )
        return point;
      last = point;
    } while (Date.now() < deadline);
    throw Error(point?.error ?? "Moving direct card target");
  };
  const cardGesture = async (id, edge, dx, dy) => {
    const before = await snapshot(),
      old = before.blocks.find((b) => b.id === id),
      p = await cardPoint(id, edge);
    for (const type of ["mouseMove", "mouseDown"])
      win.webContents.sendInputEvent({
        type,
        ...p,
        button: "left",
        clickCount: 1,
      });
    for (let i = 1; i <= 12; i++) {
      win.webContents.sendInputEvent({
        type: "mouseMove",
        x: Math.round(p.x + (dx * i) / 12),
        y: Math.round(p.y + (dy * i) / 12),
        button: "left",
        modifiers: ["leftbuttondown"],
      });
      await pause(20);
    }
    win.webContents.sendInputEvent({
      type: "mouseUp",
      x: p.x + dx,
      y: p.y + dy,
      button: "left",
      clickCount: 1,
    });
    await wait(
      `window.__aerynth.application().layoutVersion>${before.layoutVersion}`,
    );
    const after = await snapshot(),
      moved = after.blocks.find((b) => b.id === id);
    assert.ok(
      edge
        ? moved.width !== old.width || moved.height !== old.height
        : moved.x !== old.x || moved.y !== old.y,
      "native gesture changes actual canonical geometry",
    );
    assert.deepEqual(
      after.resources,
      before.resources,
      "layout gesture cannot edit canonical resource content",
    );
    receipt.actions.push({
      label: edge ? "Resize card" : "Move card",
      blockId: id,
      edge: edge ?? null,
      dx,
      dy,
      method: "native-mouse-input",
      before: old,
      after: moved,
    });
    await pause(150);
  };
  const cardPresentation = async (id, shape) => {
    const p = await cardPoint(id);
    for (const type of ["mouseMove", "mouseDown", "mouseUp"])
      win.webContents.sendInputEvent({
        type,
        ...p,
        button: "right",
        clickCount: 1,
      });
    await wait(
      'document.querySelector("#command-surface").open&&!!document.querySelector("#command-surface select[name=shape]")',
    );
    await fill('#command-surface select[name="shape"]', shape);
    await click('#command-surface button[type="submit"]');
    await wait('!document.querySelector("#command-surface").open');
    await wait(
      `window.__aerynth.application().blocks.find(b=>b.id===${JSON.stringify(id)}).shape===${JSON.stringify(shape)}`,
    );
    mark("Changed actual card presentation through native context menu");
  };
  const projectView = async () => {
    for (
      let i = 0;
      i < 2 && (await spatial()).location.kind !== "project";
      i++
    ) {
      await workspaceOut();
    }
    assert.equal((await spatial()).location.kind, "project");
  };
  const relate = async (sourceId, targetId) => {
    await textButton("Link resources", ".aw-constellation-bar");
    await fill(".aw-graph-dialog label:nth-of-type(1) select", sourceId);
    await fill(".aw-graph-dialog label:nth-of-type(2) select", targetId);
    await fill(".aw-graph-dialog label:nth-of-type(3) select", "references");
    await click('.aw-graph-dialog button[type="submit"]');
    await wait('!document.querySelector(".aw-graph-dialog").open');
    assert.ok(
      (await snapshot()).relationships.some(
        (e) =>
          e.source_id === sourceId &&
          e.target_id === targetId &&
          e.kind === "references",
      ),
    );
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
      assert.notEqual(
        source.startedAt,
        expected.sourceStartedAt,
        "new native process start",
      );
      assert.deepEqual(
        source.hashes,
        expected.sourceHashes,
        "same final source across restart",
      );
      assert.deepEqual(
        source.buildAssets,
        expected.buildAssets,
        "same compiled assets across restart",
      );
      step(
        24,
        "Restart the actual native host and service with the same source and profile",
      );
      const actual = await snapshot();
      assert.equal(
        actual.activeWorkspaceId,
        expected.snapshot.activeWorkspaceId,
      );
      assert.deepEqual(geometry(actual), geometry(expected.snapshot));
      assert.deepEqual(
        geometry({ blocks: actual.navigationBlocks ?? actual.blocks }),
        geometry({
          blocks:
            expected.snapshot.navigationBlocks ?? expected.snapshot.blocks,
        }),
        "all authorized workspace layouts survive restart",
      );
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
      const live = await spatial(),
        scope = "workspace:" + actual.activeWorkspaceId;
      assert.deepEqual(
        live.anchors,
        expected.view.anchors,
        "rendered controller anchors restored",
      );
      assert.deepEqual(
        live.location,
        expected.view.location,
        "rendered controller destination restored",
      );
      assert.deepEqual(
        live.camera,
        expected.view.bookmarks[scope].spatial,
        "actual camera restored, beyond the stored receipt",
      );
      assert.equal(live.selected, expected.view.bookmarks[scope].selected);
      step(
        25,
        "Verify all workspace geometry, canonical relationships, branch ancestry, XYZ, pins, bookmarks, history and live camera survived restart",
      );
      receipt.checks.push(
        "fresh-process-restart-keeps-canonical-identities-content-relationships-branch-ancestry-and-complete-spatial-view",
      );
      await shot("11-restored-workspace");
      await workspaceOut();
      const project = actual.workspaces.find(
          (w) => w.id === actual.activeWorkspaceId,
        ).project_id,
        projectCamera = expected.view.bookmarks["project:" + project].spatial;
      await wait(
        `JSON.stringify(window.__aerynth.snapshot().spatial.camera)===${JSON.stringify(JSON.stringify(projectCamera))}`,
      );
      assert.deepEqual(
        (await spatial()).camera,
        projectCamera,
        "saved project pose is visible after restart",
      );
      await shot("12-restored-project");
      assert.deepEqual(
        receipt.steps.map((s) => s.number),
        [24, 25],
      );
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
            row[kind] = await add(
              kind,
              title + " " + kind,
              kind === "note"
                ? { width: 330 + pi * 35, height: 230 + wi * 25 }
                : undefined,
            );
          }
          const b = row.note.block;
          await openBlock(b.id);
          await workingHome();
          await cardGesture(b.id, null, 35 + pi * 10, 15 + wi * 10);
          await openBlock(b.id);
          await fill(
            `[data-block="${b.id}"] textarea`,
            "Synthetic durable " + title + " note. Stable resource identity.",
          );
          await flush();
          await openBlock(row.reference.block.id);
          await fill(
            `[data-block="${row.reference.block.id}"] textarea`,
            "Synthetic link: https://example.invalid/" + title.toLowerCase(),
          );
          await flush();
          await workingHome();
          records.push(row);
        }
      }
      assert.equal(projects.length, 3);
      assert.equal(workspaces.length, 6);
      const originalRow = records[0],
        other = records[2],
        sourceRow = originalRow;
      receipt.taskGroups = [];
      for (const row of [records[0], records[2], records[4]]) {
        await selectWorkspace(row.workspaceId);
        await add("conversation", row.title + " follow-up conversation");
        const extraTask = await add("task", row.title + " verification task"),
          taskGroup = await add("task_group", row.title + " local task group");
        await openBlock(taskGroup.block.id);
        await click(
          `[data-block="${taskGroup.block.id}"] .manage-task-members`,
        );
        for (const taskId of [row.task.resource.id, extraTask.resource.id])
          await click(
            `#task-group-members input[name="taskId"][value="${taskId}"]`,
          );
        await click('#task-group-members button[type="submit"]');
        await wait('!document.querySelector("#command-surface").open');
        await wait(
          `window.__aerynth.application().resources.find(r=>r.id===${JSON.stringify(taskGroup.resource.id)}).taskMembers.length===2`,
        );
        await click(
          `[data-block="${taskGroup.block.id}"] .group-task[data-task-id="${extraTask.resource.id}"]`,
        );
        await wait(
          `window.__aerynth.application().resources.find(r=>r.id===${JSON.stringify(extraTask.resource.id)}).taskStatus==='done'`,
        );
        const grouped = (await snapshot()).resources.find(
          (r) => r.id === taskGroup.resource.id,
        );
        assert.equal(
          grouped.taskMembers.filter((t) => t.status === "done").length,
          1,
        );
        for (const taskId of [row.task.resource.id, extraTask.resource.id])
          assert.ok(
            (await snapshot()).relationships.some(
              (e) =>
                e.kind === "contains_task" &&
                e.source_id === taskGroup.resource.id &&
                e.target_id === taskId,
            ),
          );
        receipt.taskGroups.push({
          projectId: row.projectId,
          resourceId: taskGroup.resource.id,
          blockId: taskGroup.block.id,
          memberResourceIds: [row.task.resource.id, extraTask.resource.id],
        });
        await workingHome();
        await projectView();
        await relate(row.conversation.resource.id, row.note.resource.id);
      }
      assert.equal(receipt.taskGroups.length, 3);
      const fixtureState = await snapshot();
      for (const id of projects) {
        const projectWorkspaces = new Set(
            fixtureState.workspaces
              .filter((w) => w.project_id === id)
              .map((w) => w.id),
          ),
          projectResources = new Set(
            (fixtureState.navigationBlocks ?? fixtureState.blocks)
              .filter((b) => projectWorkspaces.has(b.workspace_id))
              .map((b) => b.resource_id),
          );
        assert.ok(
          fixtureState.resources.filter(
            (r) => projectResources.has(r.id) && r.kind === "conversation",
          ).length >= 3,
          "each project has several ordinary conversations",
        );
        assert.ok(
          fixtureState.resources.some(
            (r) =>
              projectResources.has(r.id) &&
              r.kind === "task_group" &&
              r.taskMembers?.length >= 2,
          ),
          "each project has a real task group",
        );
        assert.ok(
          fixtureState.relationships.some(
            (e) =>
              e.kind === "references" &&
              projectResources.has(e.source_id) &&
              projectResources.has(e.target_id) &&
              fixtureState.resources.find((r) => r.id === e.target_id)?.kind ===
                "note",
          ),
          "each project has a canonical related note",
        );
      }
      await selectWorkspace(records[4].workspaceId);
      await openBlock(receipt.taskGroups[2].blockId);
      receipt.focusedControls = await js(
        `([...document.querySelectorAll('.aw-workspace-layout,.aw-workspace-layout button,#workspace-manager')].map(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {tag:e.tagName,text:e.textContent,rect:{x:r.x,y:r.y,w:r.width,h:r.height},display:s.display,opacity:s.opacity}}))`,
      );
      assert.equal(
        await js('getComputedStyle(document.querySelector(".dock")).display'),
        "none",
        "legacy taskbar stays hidden",
      );
      await shot("00-real-local-task-group");
      receipt.checks.push(
        "each-of-three-projects-has-a-canonical-task-group-two-real-members-local-status-and-related-note",
      );
      await workingHome();
      await selectWorkspace(originalRow.workspaceId);
      receipt.workspaceGuide = await verifyWorkspaceGuide(win);
      receipt.checks.push(
        "working-workspace-keeps-one-visible-glass-help-control-and-unchanged-canonical-state",
      );
      await shot("01-original-working-workspace");
      step(
        1,
        "Start in the normal A World for Two Development glass workspace",
      );
      receipt.checks.push(
        "three-named-projects-six-workspaces-thirty-nine-typed-fixture-resources-with-three-ordinary-conversations-per-project",
      );
      await startSegment(
        "working block creation, orbit, pan, conversation approach and reviewed branch",
      );
      const journeyNote = await add("note", "Development journey note");
      await openBlock(journeyNote.block.id);
      await fill(
        `[data-block="${journeyNote.block.id}"] textarea`,
        "Synthetic note created and arranged at the start of the real journey.",
      );
      await flush();
      await workingHome();
      await cardGesture(journeyNote.block.id, null, 50, 25);
      await cardGesture(journeyNote.block.id, "se", 55, 30);
      await cardPresentation(journeyNote.block.id, "lens");
      assert.equal(
        (await snapshot()).blocks.find((b) => b.id === journeyNote.block.id)
          .shape,
        "lens",
      );
      await shot("01b-new-block-created-and-arranged");
      step(
        2,
        "Create, edit, resize, reshape and place another real working block",
      );
      await workspaceOut();
      await pause(650);
      await checkOverviewPresence("project");
      step(3, "Zoom out from the workspace");
      step(4, "Observe its real project system");
      const before = (await spatial()).camera;
      await drag(".aw-spatial-field", 95, -25);
      const orbited = (await spatial()).camera;
      assert.notEqual(orbited.yaw, before.yaw);
      step(5, "Orbit the project with native pointer input");
      await drag(".aw-spatial-field", 60, 25, ["shift"]);
      const panned = (await spatial()).camera;
      assert.notDeepEqual(panned.target, orbited.target);
      step(6, "Pan across its resource clusters");
      await click('.aw-quiet-control[aria-label="Navigation guide"]');
      await wait('!document.querySelector(".aw-navigation-guide").hidden');
      await pause(200);
      const guide = await js(
        '(()=>{const e=document.querySelector(".aw-navigation-guide"),r=e.getBoundingClientRect();return {width:r.width,height:r.height,viewportHeight:innerHeight,text:e.textContent,material:getComputedStyle(e).backdropFilter,buttons:e.querySelectorAll("button").length}})()',
      );
      assert.ok(guide.width <= 360 && guide.height < guide.viewportHeight);
      assert.equal(guide.buttons, 0);
      assert.ok(
        guide.text.includes("Alt + drag") && guide.text.includes("Ctrl + K"),
      );
      assert.notEqual(guide.material, "none");
      await checkLabelClearance(win);
      receipt.actions.push({ label: "Compact glass navigation guide", guide });
      await shot("02-orbit-pan-and-glass-guide");
      await key("Escape");
      await wait('document.querySelector(".aw-navigation-guide").hidden');
      await key("F1");
      await wait('!document.querySelector(".aw-navigation-guide").hidden');
      await key("Escape");
      receipt.checks.push(
        "compact-glass-info-guide-with-native-keyboard-opening-and-dismissal",
      );
      await key("k", ["control"]);
      await wait('!document.querySelector(".aw-destinations").hidden');
      assert.equal(
        await js('document.querySelector("#command-surface").open'),
        false,
        "overview Ctrl K opens only the spatial palette",
      );
      await key("Escape");
      await wait('document.querySelector(".aw-destinations").hidden');
      receipt.checks.push(
        "native-pointer-orbit-and-shift-pan-change-real-perspective-camera",
      );
      await locate(
        sourceRow.conversation.resource.title,
        "resource:" + sourceRow.conversation.block.id,
      );
      await node("resource:" + sourceRow.conversation.block.id);
      await wait(
        `!!document.querySelector('[data-block="${sourceRow.conversation.block.id}"] .conversation-compose')`,
      );
      step(
        7,
        "Approach the original project's actual conversation and unfold its working surface",
      );
      for (const content of [
        "Synthetic selected context for a reviewed continuation.",
        "Synthetic later message deliberately not selected for handoff.",
      ]) {
        await fill(
          `[data-block="${sourceRow.conversation.block.id}"] .conversation-compose textarea`,
          content,
        );
        await click(
          `[data-block="${sourceRow.conversation.block.id}"] .conversation-compose button[type="submit"]`,
        );
        await wait(
          `window.__aerynth.application().resources.find(r=>r.id===${JSON.stringify(sourceRow.conversation.resource.id)}).messages.some(m=>m.content===${JSON.stringify(content)})`,
        );
      }
      await workingHome();
      await projectView();
      const source = (await snapshot()).resources.find(
        (r) => r.id === sourceRow.conversation.resource.id,
      );
      assert.equal(source.provider, "local");
      assert.equal(source.messages.length, 2);
      await locate(source.title, "resource:" + sourceRow.conversation.block.id);
      await textButton("Explore neighborhood", ".aw-spatial-detail");
      await wait(
        `window.__aerynth.snapshot().spatial.camera.neighborhood===${JSON.stringify("resource:" + sourceRow.conversation.block.id)}`,
      );
      await textButton("Inspect relationships", ".aw-spatial-detail");
      await shot("04-inspected-resource-provenance");
      step(
        8,
        "Inspect the conversation's canonical note reference and placement",
      );
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
        "Reviewed Development continuation",
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
          (r) => r.title === "Reviewed Development continuation",
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
      step(
        9,
        "Create a canonical app-level continuation using explicitly reviewed source context",
      );
      const childBlock = (
        afterBranch.navigationBlocks ?? afterBranch.blocks
      ).find((b) => b.resource_id === child.id);
      await locate(child.title, "resource:" + childBlock.id);
      assert.equal((await spatial()).selected, "resource:" + childBlock.id);
      await checkOverviewPresence("new branch in original project");
      await shot("05b-new-branch-visible");
      step(
        10,
        "Observe the new branch in the real original project constellation",
      );
      await stopSegment("01-orbit-inspect-reviewed-branch.webm");

      await startSegment("pin, typed relationship and exact working return");
      await locate(source.title, "resource:" + sourceRow.conversation.block.id);
      const beforeDrag = (await spatial()).anchors[
        "resource:" + sourceRow.conversation.block.id
      ].spatial;
      await drag(
        ".aw-spatial-field",
        55,
        -30,
        ["alt"],
        "resource:" + sourceRow.conversation.block.id,
      );
      const afterDrag = (await spatial()).anchors[
        "resource:" + sourceRow.conversation.block.id
      ];
      assert.notDeepEqual(afterDrag.spatial, beforeDrag);
      assert.equal(afterDrag.pinned, true);
      step(11, "Move the ray-picked conversation moon using native Alt-drag");
      receipt.checks.push(
        "native-alt-drag-moves-and-pins-the-ray-picked-3D-moon",
      );
      const old = (await spatial()).anchors[
          "resource:" + sourceRow.conversation.block.id
        ].spatial,
        desired = {
          x: Math.round(old.x + 20000),
          y: Math.round(old.y + 1000),
          z: Math.round(old.z - 20000),
        };
      await textButton("Inspect selection");
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
        "resource:" + sourceRow.conversation.block.id
      ];
      assert.deepEqual(pinned.spatial, desired);
      assert.equal(pinned.pinned, true);
      await click('.aw-spatial-detail [aria-label="Close information"]');
      await key("f");
      step(
        12,
        "Set and persist the chosen XYZ and pin using non-drag controls",
      );
      await shot("06-moved-and-pinned-moon");
      await textButton("Link resources", ".aw-constellation-bar");
      // Each select belongs to a label, so address the form's label order explicitly.
      await fill(".aw-graph-dialog label:nth-of-type(1) select", source.id);
      await fill(
        ".aw-graph-dialog label:nth-of-type(2) select",
        sourceRow.research.resource.id,
      );
      await fill(".aw-graph-dialog label:nth-of-type(3) select", "references");
      await click('.aw-graph-dialog button[type="submit"]');
      await wait('!document.querySelector(".aw-graph-dialog").open');
      const relationship = (await snapshot()).relationships.find(
        (e) =>
          e.source_id === source.id &&
          e.target_id === sourceRow.research.resource.id &&
          e.kind === "references",
      );
      assert.ok(relationship);
      step(
        13,
        "Create a new explicit canonical resource-reference relationship",
      );
      await textButton("Inspect relationships", ".aw-spatial-detail");
      assert.ok(
        (
          await js('document.querySelector(".aw-graph-dialog").textContent')
        ).includes("references"),
      );
      await shot("07-typed-relationship-inspection");
      await closeGraph();
      step(14, "Inspect the new relationship's direction, type and provenance");
      receipt.checks.push(
        "native-position-pin-and-canonical-directed-relationship-creation-with-inspection",
      );
      // Explicit branch placement is an authorized layout mutation. Capture the
      // working reference AFTER those changes and BEFORE cross-project travel.
      await node("workspace:" + originalRow.workspaceId);
      const original = await snapshot();
      receipt.workingReference = {
        workspaceId: original.activeWorkspaceId,
        geometry: geometry(original),
        resourceIds: original.blocks.map((b) => b.resource_id),
        scope:
          "After explicit branch/relationship changes; before cross-project travel",
      };
      await shot("07b-working-reference-before-travel");
      await projectView();
      await textButton("Universe", ".aw-constellation-bar");
      await pause(650);
      await checkOverviewPresence("universe");
      step(15, "Zoom out to Universe");
      assert.equal(
        (await snapshot()).projects.filter((p) => projects.includes(p.id))
          .length,
        3,
      );
      for (const id of projects)
        assert.ok(
          await js(`!!document.querySelector('[data-key="project:${id}"]')`),
        );
      await shot("03-three-planet-universe");
      step(16, "Observe all three actual named project systems");
      await node("project:" + other.projectId);
      await checkOverviewPresence("other project");
      step(17, "Approach Voyagewright");
      await node("workspace:" + other.workspaceId);
      assert.equal((await snapshot()).activeWorkspaceId, other.workspaceId);
      step(18, "Enter its Engineering working workspace");
      // Fluid insertion may legitimately move a prior block beyond this camera.
      // Exercise the real offscreen-block access instead of assuming visibility.
      await openBlock(other.note.block.id);
      await fill(
        `[data-block="${other.note.block.id}"] textarea`,
        "Synthetic real editor change after spatial branch and relationship navigation.",
      );
      await flush();
      assert.equal(
        (await snapshot()).resources.find(
          (r) => r.id === other.note.resource.id,
        ).content,
        "Synthetic real editor change after spatial branch and relationship navigation.",
      );
      await shot("08a-other-workspace-real-edit");
      step(19, "Edit and save a real persistent glass-panel note");
      await workingHome();
      await projectView();
      await textButton("Universe", ".aw-constellation-bar");
      await pause(500);
      step(20, "Return to Universe");
      await node("project:" + originalRow.projectId);
      step(21, "Navigate back to A World for Two");
      await node("workspace:" + originalRow.workspaceId);
      step(22, "Restore its Development working workspace");
      assert.deepEqual(geometry(await snapshot()), geometry(original));
      assert.deepEqual(
        (await snapshot()).presence,
        original.presence,
        "overview placement never overwrites saved workspace Vela",
      );
      assert.deepEqual(
        (await snapshot()).viewport,
        original.viewport,
        "working viewport restored",
      );
      for (const id of original.blocks.map((b) => b.resource_id))
        assert.deepEqual(
          (await snapshot()).resources.find((r) => r.id === id),
          original.resources.find((r) => r.id === id),
        );
      await shot("08-exact-original-workspace-return");
      step(
        23,
        "Verify exact original resource identities, geometry, shapes, content, viewport and Vela footprint",
      );
      assert.equal(
        (await snapshot()).resources.find(
          (r) => r.id === other.note.resource.id,
        ).content,
        "Synthetic real editor change after spatial branch and relationship navigation.",
      );
      receipt.checks.push(
        "real-working-editor-save-and-exact-original-workspace-geometry-identities-return",
        "automatic-upper-right-overview-Vela-preserves-the-canonical-workspace-footprint",
      );
      await stopSegment("02-pin-relationship-return.webm");
      await flush();
      const expected = {
        sourceStartedAt: source.startedAt,
        sourceHashes: source.hashes,
        buildAssets: source.buildAssets,
        snapshot: await snapshot(),
        view: await view(),
        reviewedBranch: receipt.reviewedBranch,
      };
      assert.deepEqual(
        expected.view.anchors["resource:" + sourceRow.conversation.block.id]
          .spatial,
        desired,
      );
      assert.equal(
        expected.view.anchors["resource:" + sourceRow.conversation.block.id]
          .pinned,
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
      assert.deepEqual(
        receipt.steps.map((s) => s.number),
        Array.from({ length: 23 }, (_, i) => i + 1),
      );
    }
    receipt.passed = true;
  } catch (error) {
    receipt.error = error.stack;
    // Preserve the actual failed form before shutdown; do not retry or change it.
    try {
      receipt.failureDiagnostics = {
        window: {
          focused: win.isFocused(),
          visible: win.isVisible(),
          minimized: win.isMinimized(),
          bounds: win.getBounds(),
        },
        renderer: await js(`(()=>{
          const library=document.querySelector('.aw-library[aria-label="Block Library"]');
          const text=(value,max=512)=>String(value??'').slice(0,max);
          const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};
          const describe=e=>{
            const style=getComputedStyle(e);
            const result={tag:e.tagName,id:e.id,className:text(e.className,160),name:e.getAttribute('name'),type:e.getAttribute('type'),ariaLabel:e.getAttribute('aria-label'),text:text(e.textContent,160),labels:[...(e.labels??[])].map(l=>text(l.textContent,160)),disabled:e.disabled??null,readOnly:e.readOnly??null,hidden:e.hidden,required:e.required??null,bounds:rect(e),display:style.display,visibility:style.visibility};
            if('value' in e)result.value=e.type==='password'?'[redacted]':text(e.value,1024);
            if('checked' in e)result.checked=e.checked;
            if(e.validity)result.validation={valid:e.validity.valid,valueMissing:e.validity.valueMissing,typeMismatch:e.validity.typeMismatch,rangeUnderflow:e.validity.rangeUnderflow,rangeOverflow:e.validity.rangeOverflow,stepMismatch:e.validity.stepMismatch,patternMismatch:e.validity.patternMismatch,customError:e.validity.customError,message:text(e.validationMessage)};
            for(const key of ['min','max','step','minLength','maxLength'])if(key in e)result[key]=e[key];
            return result;
          };
          let appState,sceneState;
          try{const s=window.__aerynth.application();appState={navigation:s.navigation,activeWorkspaceId:s.activeWorkspaceId,projectCount:s.projects.length,workspaceCount:s.workspaces.length,resourceCount:s.resources.length,blockCount:s.blocks.length}}catch(e){appState={error:text(e.message)}}
          try{const s=window.__aerynth.snapshot();sceneState={location:s.spatial?.location,selected:s.spatial?.selected,camera:s.spatial?.camera,renderer:s.spatial?.renderer,metrics:s.metrics}}catch(e){sceneState={error:text(e.message)}}
          const active=document.activeElement,ancestors=[];
          for(let e=active;e&&ancestors.length<8;e=e.parentElement)ancestors.push({tag:e.tagName,id:e.id,className:text(e.className,160),role:e.getAttribute('role')});
          return {
            page:{visibility:document.visibilityState,focused:document.hasFocus(),width:innerWidth,height:innerHeight},
            library:library?{bounds:rect(library),heading:text(library.querySelector('.aw-library__detail h3')?.textContent),status:[...library.querySelectorAll('.status,.error,[role="status"],[role="alert"]')].slice(0,12).map(e=>text(e.textContent)),forms:[...library.querySelectorAll('form')].slice(0,4).map(form=>({id:form.id,noValidate:form.noValidate,controls:[...form.querySelectorAll('input,textarea,select,button')].slice(0,40).map(describe)})),submitTargets:[...library.querySelectorAll('button[type="submit"],input[type="submit"]')].slice(0,8).map(describe)}:null,
            active:{tag:active?.tagName,id:active?.id,className:text(active?.className,160),ariaLabel:active?.getAttribute('aria-label'),inLibrary:!!library?.contains(active),control:library?.contains(active)?describe(active):null,ancestors},
            hostStatus:{status:text(document.querySelector('#status')?.textContent),commandError:text(document.querySelector('#command-error')?.textContent)},
            application:appState,scene:sceneState
          };
        })()`),
      };
    } catch (diagnosticError) {
      receipt.failureDiagnosticError = String(diagnosticError.stack ?? diagnosticError).slice(0,2048);
    }
    try {
      await shot("failure");
    } catch (captureError) {
      receipt.failureCaptureError = String(captureError.stack ?? captureError).slice(0,2048);
    }
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
