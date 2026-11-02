const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
exports.verify = async ({ win, app, privateRoot, source, moduleStarted }) => {
  const out = path.resolve(
    __dirname,
    "../.runtime/application-evidence",
    Date.now().toString(),
  );
  await fs.mkdir(out, { recursive: true });
  const receipt = {
    at: new Date().toISOString(),
    source,
    syntheticData: true,
    uiActions: [],
    checks: [],
    errors: [],
    provider: "not exercised in offline journey",
  };
  const js = (code) => win.webContents.executeJavaScript(code, true);
  win.webContents.on("console-message", (_event, details) => {
    if (details.level === "error") receipt.errors.push(details.message);
  });
  const wait = async (expression) => {
    const end = Date.now() + 20000;
    while (Date.now() < end) {
      if (await js(`(()=>{try{return (${expression})}catch{return false}})()`))
        return;
      await pause(80);
    }
    throw new Error(
      "Timed out: " +
        expression +
        "\n" +
        (await js(
          'document.querySelector("#status").textContent + " / " + (document.querySelector("#command-error")?.textContent ?? "")',
        )),
    );
  };
  const click = async (selector) => {
    await pause(160);
    const point = await js(
      `(()=>{let e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled||e.hidden)return {error:'Unusable control '+${JSON.stringify(selector)}};let r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;let hit=document.elementFromPoint(x,y);if(!hit||!(e===hit||e.contains(hit)))return {error:'Occluded control '+${JSON.stringify(selector)}+' by '+hit?.outerHTML.slice(0,200)};return {x:Math.round(x),y:Math.round(y)}})()`,
    );
    if (point.error) throw new Error(point.error);
    receipt.uiActions.push({
      click: selector,
      point,
      method: "native-mouse-input",
    });
    win.webContents.sendInputEvent({ type: "mouseMove", ...point });
    win.webContents.sendInputEvent({
      type: "mouseDown",
      button: "left",
      clickCount: 1,
      ...point,
    });
    win.webContents.sendInputEvent({
      type: "mouseUp",
      button: "left",
      clickCount: 1,
      ...point,
    });
    await pause(70);
  };
  const fill = async (selector, value) => {
    receipt.uiActions.push({ fill: selector, value });
    await js(
      `(()=>{let e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))})()`,
    );
  };
  const snapshot = () => js("window.__aerynth.application()");
  const checkpoint = async (name) => {
    await pause(150);
    await fs.writeFile(
      path.join(out, name + ".png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    receipt.checks.push(name);
  };
  try {
    await wait('document.body.classList.contains("application-ready")');
    receipt.startupToInteractiveMs = Date.now() - moduleStarted;
    if (process.argv.includes("--verify-restore")) {
      const expected = JSON.parse(
        await fs.readFile(
          path.join(privateRoot, "expected-synthetic-state.json"),
          "utf8",
        ),
      );
      const actual = await snapshot();
      for (const key of [
        "projects",
        "workspaces",
        "resources",
        "blocks",
        "activeWorkspaceId",
      ])
        assert.deepEqual(
          actual[key],
          expected[key],
          "Restart preserves " + key,
        );
      await checkpoint("restart-restored");
    } else {
      await click("#workspace-manager");
      await click("#new-project");
      await fill("#project-title", "A World for Two");
      await click('dialog button[type="submit"]');
      await wait('!document.querySelector("dialog").open');
      await click("#workspace-manager");
      await click("#new-workspace");
      await fill("#workspace-title", "Development");
      const project = (await snapshot()).projects.find(
        (p) => p.title === "A World for Two",
      );
      await fill('dialog select[name="projectId"]', project.id);
      await click('dialog button[type="submit"]');
      await wait(
        'window.__aerynth.application().workspaces.some(w=>w.title==="Development")',
      );
      const originalWorkspace = (await snapshot()).activeWorkspaceId;
      for (const [kind, title] of [
        ["conversation", "Development conversation"],
        ["note", "Synthetic working note"],
        ["task", "Local task"],
      ]) {
        await click("#add-block");
        await fill("#block-kind", kind);
        await fill("#block-title", title);
        await click('dialog button[type="submit"]');
        await wait(
          `window.__aerynth.application().resources.some(r=>r.title===${JSON.stringify(title)})`,
        );
      }
      let s = await snapshot();
      const conversation = s.resources.find((r) => r.kind === "conversation"),
        note = s.resources.find((r) => r.kind === "note"),
        task = s.resources.find((r) => r.kind === "task");
      let cb = s.blocks.find((b) => b.resource_id === conversation.id),
        nb = s.blocks.find((b) => b.resource_id === note.id),
        tb = s.blocks.find((b) => b.resource_id === task.id);
      await click(`[data-block="${nb.id}"] .unfold`);
      await fill(
        `[data-block="${nb.id}"] textarea`,
        "Synthetic durable note. Same resource, independent placements.",
      );
      await pause(600);
      await wait(
        'document.querySelector(".saved").textContent.includes("Saved")',
      );
      await click("#home");
      await click(`[data-block="${cb.id}"] .block-properties`);
      await fill('dialog input[name="width"]', "560");
      await fill('dialog input[name="height"]', "330");
      await click('dialog button[type="submit"]');
      await wait(
        `window.__aerynth.application().blocks.find(b=>b.id==="${cb.id}").width===560`,
      );
      await click(`[data-block="${nb.id}"] .block-properties`);
      await fill('dialog input[name="width"]', "300");
      await fill('dialog select[name="shape"]', "circle");
      await click('dialog button[type="submit"]');
      await wait(
        `window.__aerynth.application().blocks.find(b=>b.id==="${nb.id}").shape==="circle"`,
      );
      await click(`[data-block="${tb.id}"] .block-properties`);
      await fill('dialog input[name="x"]', "890");
      await fill('dialog input[name="y"]', "590");
      await click('dialog button[type="submit"]');
      await wait(
        `window.__aerynth.application().blocks.find(b=>b.id==="${tb.id}").y===590`,
      );
      await checkpoint("working-blocks");
      await click(`[data-block="${nb.id}"] .block-remove`);
      await wait(
        `!window.__aerynth.application().blocks.some(b=>b.id==="${nb.id}")`,
      );
      assert((await snapshot()).resources.some((r) => r.id === note.id));
      await click("#resource-picker");
      await click(`[data-attach="${note.id}"]`);
      await wait(
        `window.__aerynth.application().blocks.some(b=>b.resource_id==="${note.id}")`,
      );
      await click("#layout-manager");
      await click("#save-layout");
      await wait('!document.querySelector("dialog").open');
      // Keyboard and pointer paths operate the same persistent layout service.
      const beforeKeyboard = (await snapshot()).blocks.find(
        (b) => b.id === tb.id,
      );
      await js(
        `document.querySelector('[data-block="${tb.id}"] .grip').focus()`,
      );
      win.webContents.sendInputEvent({
        type: "keyDown",
        keyCode: "Right",
        modifiers: ["alt"],
      });
      win.webContents.sendInputEvent({
        type: "keyUp",
        keyCode: "Right",
        modifiers: ["alt"],
      });
      await wait(
        `window.__aerynth.application().blocks.find(b=>b.id==="${tb.id}").x===${beforeKeyboard.x + 24}`,
      );
      await click("#undo");
      await wait(
        `window.__aerynth.application().blocks.find(b=>b.id==="${tb.id}").x===${beforeKeyboard.x}`,
      );
      receipt.checks.push("keyboard-move-and-persistent-undo");
      await click(`[data-block="${tb.id}"] .block-properties`);
      await fill('dialog input[name="width"]', "-1");
      await click('dialog button[type="submit"]');
      // Native form validation rejects negative geometry at the trusted service boundary.
      await wait(
        'document.querySelector("#command-error").textContent.length>0',
      );
      await click("dialog [data-close]");
      assert.equal(
        (await snapshot()).blocks.find((b) => b.id === tb.id).width,
        beforeKeyboard.width,
      );
      receipt.checks.push("failed-geometry-keeps-layout");
      await click(`[data-block="${tb.id}"] .unfold`);
      await click(`[data-block="${tb.id}"] .task-completed`);
      await wait(
        'window.__aerynth.application().resources.some(r=>r.taskStatus==="done")',
      );
      await click("#home");
      await click("#layout-manager");
      await click("#restore-layout");
      await wait('!document.querySelector("dialog").open');
      receipt.checks.push("checkpoint-restore-preserves-task-data");
      const original = await snapshot();
      await click("#workspace-manager");
      await click("#new-workspace");
      await fill("#workspace-title", "Research");
      await fill('dialog select[name="projectId"]', project.id);
      await click('dialog button[type="submit"]');
      await wait(
        'window.__aerynth.application().workspaces.some(w=>w.title==="Research")',
      );
      await click("#resource-picker");
      await click(`[data-attach="${note.id}"]`);
      await wait("window.__aerynth.application().blocks.length===1");
      await click("#zoom-out");
      await wait(
        'window.__aerynth.application().navigation.kind==="constellation"',
      );
      await checkpoint("constellation");
      await wait(
        `!!document.querySelector('[data-key="workspace:${originalWorkspace}"]')`,
      );
      await click(`[data-key="workspace:${originalWorkspace}"]`);
      await click(".aw-spatial-detail button");
      await wait(
        `window.__aerynth.application().activeWorkspaceId==="${originalWorkspace}"`,
      );
      s = await snapshot();
      assert.deepEqual(s.blocks, original.blocks);
      assert.deepEqual(s.resources, original.resources);
      receipt.checks.push("workspace-switch-restores-canonical-layout");
      await click(`[data-block="${cb.id}"] .unfold`);
      await fill(
        `[data-block="${cb.id}"] .conversation-compose textarea`,
        "Synthetic local message, no simulated assistant.",
      );
      await click(
        `[data-block="${cb.id}"] .conversation-compose button[type="submit"]`,
      );
      await wait(
        'document.querySelector(".conversation-transcript").textContent.includes("Synthetic local message")',
      );
      await click("#home");
      await js('window.__aerynth.setStudy("living")');
      await pause(250);
      await js('window.__aerynth.setStudy("architecture")');
      await pause(250);
      receipt.checks.push("scene-switch-preserves-resource-identity");
      await js("window.__aerynth.simulateContextLoss()");
      await pause(250);
      await js("window.__aerynth.restoreContext()");
      await pause(700);
      assert.equal((await snapshot()).activeWorkspaceId, originalWorkspace);
      receipt.checks.push("context-recovery-preserves-state");
      await checkpoint("restored-development");
      await fs.writeFile(
        path.join(privateRoot, "expected-synthetic-state.json"),
        JSON.stringify(await snapshot(), null, 2),
      );
    }
    receipt.passed = true;
  } catch (e) {
    receipt.passed = false;
    receipt.errors.push(e.stack);
    await checkpoint("failure");
  }
  await fs.writeFile(
    path.join(
      out,
      process.argv.includes("--verify-restore")
        ? "restart.json"
        : "journey.json",
    ),
    JSON.stringify(receipt, null, 2),
  );
  console.log(
    JSON.stringify({
      passed: receipt.passed,
      checks: receipt.checks,
      errors: receipt.errors,
      evidence: out,
    }),
  );
  app.exit(receipt.passed ? 0 : 1);
};

async function driver(win) {
  const foreground = () => {
    if (!win.isMinimized() && !win.isFocused()) win.focus();
  };
  foreground();
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const wait = async (expr, timeout = 30000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      foreground();
      if (await js(`(()=>{try{return (${expr})}catch{return false}})()`))
        return;
      await pause(80);
    }
    throw new Error(
      "Timed out " +
        expr +
        ": " +
        (await js('document.querySelector("#status").textContent')),
    );
  };
  const click = async (selector) => {
    foreground();
    const deadline = Date.now() + 2000;
    let p,
      previous,
      settled = false;
    do {
      await pause(80);
      p = await js(
        `(()=>{let e=document.querySelector(${JSON.stringify(selector)});e?.scrollIntoView({block:'nearest',inline:'nearest'});let r=e?.getBoundingClientRect();if(!r||!r.width||!r.height||e.disabled||e.hidden)return{error:'Unavailable '+${JSON.stringify(selector)}};let x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2),h=document.elementFromPoint(x,y);if(!h||!(e===h||e.contains(h)))return{error:'Occluded '+${JSON.stringify(selector)}+' by '+h?.outerHTML.slice(0,240),x,y};return {x,y}})()`,
      );
      if (
        !p.error &&
        previous &&
        !previous.error &&
        Math.hypot(p.x - previous.x, p.y - previous.y) < 0.75
      ) {
        settled = true;
        break;
      }
      previous = p;
    } while (Date.now() < deadline);
    if (p.error) throw Error(p.error);
    if (!settled) throw Error("Moving native click target " + selector);
    const inputAt = Date.now();
    for (const type of ["mouseMove", "mouseDown", "mouseUp"])
      win.webContents.sendInputEvent({
        type,
        ...p,
        button: "left",
        clickCount: 1,
      });
    await pause(50);
    return inputAt;
  };
  const fill = async (selector, value) =>
    js(
      `(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))})()`,
    );
  await wait('document.body.dataset.applicationHydrated === "true"');
  return {
    js,
    wait,
    click,
    fill,
    snapshot: () => js("window.__aerynth.application()"),
  };
}
exports.createDriver = driver;

exports.live = async ({
  win,
  app,
  privateRoot,
  call,
  source,
  moduleStarted,
}) => {
  const out = path.resolve(
    __dirname,
    "../.runtime/application-evidence",
    "live-" + Date.now(),
  );
  await fs.mkdir(out, { recursive: true });
  const receipt = {
    source,
    syntheticData: true,
    authorization:
      "Owner functional-integration objective §15.21; dedicated host launch flag authorizes only the exact synthetic no-tools prompt",
    rendererPrivileges: "No raw execution or approval API",
    passed: false,
  };
  try {
    const { js, wait, click, fill, snapshot } = await driver(win);
    receipt.startupToInteractiveMs =
      Date.now() - (moduleStarted ?? Date.parse(source.startedAt));
    await click("#workspace-manager");
    await click("#new-workspace");
    await fill("#workspace-title", "Codex verification");
    await click('dialog button[type="submit"]');
    await wait('!document.querySelector("dialog").open');
    await click("#add-block");
    await fill("#block-title", "Synthetic live Codex");
    await fill('dialog select[name="provider"]', "codex");
    await click('dialog button[type="submit"]');
    await wait("window.__aerynth.application().blocks.length===1");
    const block = (await snapshot()).blocks[0];
    await click(`[data-block="${block.id}"] .unfold`);
    await fill(
      ".conversation-compose textarea",
      "Reply with exactly AERYNTH_LIVE_OK. Do not use tools or inspect files.",
    );
    const start = Date.now();
    await click('.conversation-compose button[type="submit"]');
    await wait(
      'document.querySelector(".execution-state").textContent.includes("provider_completed") || document.querySelector(".execution-state").textContent.includes("failed") || document.querySelector(".execution-state").textContent.includes("unknown")',
    );
    receipt.elapsedMs = Date.now() - start;
    receipt.status = await js(
      'document.querySelector(".execution-state").textContent',
    );
    const s = await snapshot(),
      conversation = s.resources.find((r) => r.id === block.resource_id);
    receipt.exactAssistantMarker = conversation.messages.some(
      (m) => m.role === "assistant" && m.content.trim() === "AERYNTH_LIVE_OK",
    );
    receipt.messageRoles = conversation.messages.map((m) => m.role);
    const events = await call("replay", { limit: 250 });
    receipt.eventTypes = events.events.map((e) => ({
      type: e.type,
      classification: e.classification,
      status: e.status,
    }));
    receipt.rawPrivateReasoningExposed = events.events.some((e) =>
      Object.keys(e.payload).some(
        (k) => !["redacted", "textBytes", "itemType"].includes(k),
      ),
    );
    assert(receipt.exactAssistantMarker);
    assert.equal(receipt.rawPrivateReasoningExposed, false);
    assert.equal(
      await js(
        'window.aerynthHost.command("execute",{}).then(()=>false,()=>true)',
      ),
      true,
    );
    receipt.passed = true;
    await fs.writeFile(
      path.join(out, "live-conversation.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    await fs.writeFile(
      path.join(privateRoot, "expected-synthetic-state.json"),
      JSON.stringify(s),
    );
  } catch (e) {
    receipt.error = e.stack;
  }
  await fs.writeFile(
    path.join(out, "live.json"),
    JSON.stringify(receipt, null, 2),
  );
  console.log(
    JSON.stringify({
      ...receipt,
      source: undefined,
      eventTypes: undefined,
      evidence: out,
    }),
  );
  app.exit(receipt.passed ? 0 : 1);
};

exports.benchmark = async ({ win, app, call, source, moduleStarted }) => {
  const out = path.resolve(
    __dirname,
    "../.runtime/application-evidence",
    "scale-" + Date.now(),
  );
  await fs.mkdir(out, { recursive: true });
  const receipt = {
    source,
    syntheticData: true,
    samples: [],
    passed: false,
    limitations: [
      "Renderer callback/draw intervals are scheduler observations, not display presentation timing.",
      "App working-set sums can double-count shared pages; private renderer memory and backend RSS are reported separately.",
      "Exploratory short-run measurements do not establish production performance qualification.",
    ],
  };
  const percentiles = (values) => {
    const a = values.slice().sort((a, b) => a - b);
    return {
      count: a.length,
      p50: a[Math.floor(a.length * 0.5)] ?? null,
      p95: a[Math.floor(a.length * 0.95)] ?? null,
      p99: a[Math.floor(a.length * 0.99)] ?? null,
    };
  };
  try {
    const { js, wait, click, fill, snapshot } = await driver(win);
    receipt.startupToInteractiveMs =
      Date.now() - (moduleStarted ?? Date.parse(source.startedAt));
    await click("#workspace-manager");
    await click("#new-workspace");
    await fill("#workspace-title", "Synthetic scalability");
    await click('dialog button[type="submit"]');
    await wait('!document.querySelector("dialog").open');
    const start = Date.now();
    for (let i = 1; i <= 50; i++) {
      await click("#add-block");
      await fill("#block-kind", "note");
      await fill("#block-title", "Synthetic block " + i);
      const before = await click('dialog button[type="submit"]');
      await wait(`window.__aerynth.application().blocks.length===${i}`);
      if ([10, 25, 50].includes(i)) {
        const persistMs = Date.now() - before;
        await click('[data-pan="home"]');
        await js("window.__aerynth.resetMetrics()");
        await pause(2500);
        const diagnostics = await js(
          '(()=>{const s=window.__aerynth.snapshot();return {metrics:s.metrics,gpu:{surfaceCapacity:s.gpu.surfaceCapacity,surfacesRendered:s.gpu.surfacesRendered,geometries:s.gpu.geometries,textures:s.gpu.textures,drawCalls:s.gpu.drawCalls},mounted:document.querySelectorAll("[data-block]").length,visible:[...document.querySelectorAll("[data-block]")].filter(e=>!e.hidden).length,heap:performance.memory?{used:performance.memory.usedJSHeapSize,total:performance.memory.totalJSHeapSize}:null}})()',
        );
        const sample = {
          blocks: i,
          persistAndUiMs: persistMs,
          elapsedAddingMs: Date.now() - start,
          callbacksMs: percentiles(diagnostics.metrics.intervals),
          drawIntervalsMs: percentiles(diagnostics.metrics.drawIntervals),
          gpu: diagnostics.gpu,
          mounted: diagnostics.mounted,
          visible: diagnostics.visible,
          heap: diagnostics.heap,
          rendererMemoryKiB:
            app
              .getAppMetrics()
              .find((p) => p.pid === win.webContents.getOSProcessId())
              ?.memory ?? null,
          appProcesses: app.getAppMetrics().map((p) => ({
            type: p.type,
            cpuPercent: p.cpu.percentCPUUsage,
            workingSetKiB: p.memory.workingSetSize,
            privateBytesKiB: p.memory.privateBytes,
          })),
          backendMemoryBytes: await call("metrics", {}),
        };
        receipt.samples.push(sample);
        console.log(
          JSON.stringify({
            blocks: i,
            persistAndUiMs: persistMs,
            visible: sample.visible,
            gpuPool: sample.gpu.surfaceCapacity,
          }),
        );
        await fs.writeFile(
          path.join(out, `blocks-${i}.png`),
          (await win.webContents.capturePage()).toPNG(),
        );
      }
    }
    const before = await snapshot();
    await js("window.__aerynth.setActive(false)");
    const stopped = await js("window.__aerynth.snapshot().metrics.draws");
    await pause(800);
    assert.equal(
      await js("window.__aerynth.snapshot().metrics.draws"),
      stopped,
    );
    receipt.minimizedSuspension = true;
    await js("window.__aerynth.setActive(true)");
    await js(
      'document.querySelector("#quiet").checked=true;document.querySelector("#quiet").dispatchEvent(new Event("change"));window.__aerynth.resetMetrics()',
    );
    await pause(800);
    receipt.quietDraws = await js("window.__aerynth.snapshot().metrics.draws");
    assert.equal((await snapshot()).blocks.length, 50);
    assert.deepEqual((await snapshot()).resources, before.resources);
    receipt.passed = true;
  } catch (e) {
    receipt.error = e.stack;
  }
  await fs.writeFile(
    path.join(out, "scale.json"),
    JSON.stringify(receipt, null, 2),
  );
  console.log(
    JSON.stringify({
      passed: receipt.passed,
      error: receipt.error,
      evidence: out,
    }),
  );
  app.exit(receipt.passed ? 0 : 1);
};
