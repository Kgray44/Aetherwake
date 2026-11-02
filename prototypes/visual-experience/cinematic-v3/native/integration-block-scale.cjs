const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const { percentiles } = require("./presentation-metrics.cjs");
const {
  assertNativeOwner,
  nativeInput,
} = require("../../../constellation/tests/native-input.cjs");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function options(argv) {
  const count = argv
    .find((argument) => argument.startsWith("--block-count="))
    ?.slice(14);
  assert.ok(
    /^(0|1|3|10|25|50)$/.test(count ?? ""),
    "Pass --block-count=<0|1|3|10|25|50>; one bounded count per native process",
  );
  const sampleMs = Number(
    argv.find((argument) => argument.startsWith("--sample-ms="))?.slice(12) ??
      750,
  );
  assert.ok(
    Number.isInteger(sampleMs) && sampleMs >= 250 && sampleMs <= 10000,
    "Sample duration must be 250–10000 ms",
  );
  const deadline = Number(
    argv
      .find((argument) => argument.startsWith("--verification-deadline-ms="))
      ?.split("=")[1],
  );
  assert.ok(
    Number.isInteger(deadline) && deadline >= 1000 && deadline <= 30000,
    "An explicit native verification deadline of at most30 seconds is required",
  );
  return {
    count: Number(count),
    sampleMs,
    restore: argv.includes("--verify-restore"),
  };
}
function sameState(expected, actual) {
  assert.deepEqual(
    Object.keys(expected).sort(),
    [
      "activeWorkspaceId",
      "blocks",
      "organization",
      "presence",
      "resources",
      "viewport",
    ].sort(),
  );
  for (const [name, value] of Object.entries(expected))
    assert.deepEqual(actual[name], value, "exact canonical " + name);
}
exports.options = options;
exports.sameState = sameState;

/** Run only in an explicitly allocated native slot against a profile prepared
 * offline by prepare-native-scale.mts. Never claims that setup used Library UI. */
exports.verify = async ({
  win,
  app,
  privateRoot,
  call,
  source,
  moduleStarted,
}) => {
  const output = path.resolve(
    __dirname,
    "../.runtime/application-evidence",
    "block-scale-" + Date.now(),
  );
  const receipt = {
    source,
    syntheticData: true,
    passed: false,
    samples: [],
    actions: [],
    screenshots: [],
    limitations: [
      "CPU-only fixture preparation used actual canonical Core/library/engine APIs, not Library form input or model execution.",
      "Callback and draw-submission intervals are scheduler observations, not displayed FPS, GPU elapsed time, VRAM or utilization.",
      "Short foreground windows, runtime memory snapshots and one restart do not qualify long-term memory, power, thermals or framework selection.",
      "Backend memory and runtime process CPU counters have separate observation times; their intervals are not assumed aligned with renderer sampling.",
      "Hidden-workspace coverage checks unmounted editor DOM and retained canonical state; it does not establish that every invisible component has no timer.",
      "This helper performs no physical OS restart or actual native minimize/restore test. External applications and background hardware load remain uncontrolled.",
    ],
  };
  try {
    const selected = options(process.argv);
    await fs.mkdir(output, { recursive: true });
    const seed = JSON.parse(
      await fs.readFile(
        path.join(privateRoot, "block-scale-seed.json"),
        "utf8",
      ),
    );
    assert.equal(seed.contract, "aerynth.native-block-scale@1");
    assert.equal(seed.syntheticData, true);
    assert.equal(seed.count, selected.count);
    assert.equal(seed.expected.blocks.length, selected.count);
    receipt.count = selected.count;
    receipt.preparation = seed.preparation;
    const { js, wait, click, snapshot } =
      await require("./desktop-verify.cjs").createDriver(win);
    const execute = (command) =>
      js(`window.__aerynth.execute(${JSON.stringify(command)})`);
    const settled = async () => {
      const end = Date.now() + 5000;
      let previous,
        stable = 0;
      while (Date.now() < end) {
        assertNativeOwner(win);
        const current = await js(
          "Object.entries(window.__aerynth.snapshot().poses).map(([id,p])=>[id,p.x,p.y,p.w,p.h,p.lift,p.yaw,p.opacity])",
        );
        const unchanged =
          previous &&
          previous.length === current.length &&
          current.every(
            (row, index) =>
              row[0] === previous[index][0] &&
              row
                .slice(1)
                .every(
                  (value, channel) =>
                    Math.abs(value - previous[index][channel + 1]) < 0.01,
                ),
          );
        stable = unchanged ? stable + 1 : 0;
        if (stable >= 2) return;
        previous = current;
        await pause(80);
      }
      throw Error("Resource poses did not settle before the idle sample");
    };
    receipt.startupToInteractiveMs = Date.now() - moduleStarted;
    const expectedPath = path.join(privateRoot, "block-scale-expected.json");
    const state = (value) =>
      Object.fromEntries(
        Object.keys(seed.expected).map((name) => [name, value[name]]),
      );
    const capture = async (name) => {
      assertNativeOwner(win);
      const before = await js("window.__aerynth.snapshot().metrics.draws");
      await js('window.dispatchEvent(new Event("resize"))');
      await wait(`window.__aerynth.snapshot().metrics.draws>${before}`, 5000);
      assertNativeOwner(win);
      await fs.writeFile(
        path.join(output, name + ".png"),
        (await win.webContents.capturePage()).toPNG(),
      );
      receipt.screenshots.push(name + ".png");
    };
    const sample = async (label) => {
      assertNativeOwner(win);
      await settled();
      await js("window.__aerynth.resetMetrics()");
      const startedAt = new Date().toISOString(),
        start = performance.now();
      await pause(selected.sampleMs);
      assertNativeOwner(win);
      const renderer = await js(
        `(()=>{const s=window.__aerynth.snapshot(),blocks=[...document.querySelectorAll('[data-block]')];return {metrics:s.metrics,gpu:s.gpu,active:s.active,graphicsFailed:s.graphicsFailed,viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},quality:s.quality,reduced:s.reduced,quiet:document.querySelector('#quiet')?.checked??null,mountedBlocks:blocks.length,visibleBlocks:blocks.filter(e=>!e.hidden).length,noteExperiences:document.querySelectorAll('[data-note-state]').length,editorNodes:document.querySelectorAll('[data-block] textarea').length,canvasCount:document.querySelectorAll('canvas').length,heap:performance.memory?{usedBytes:performance.memory.usedJSHeapSize,totalBytes:performance.memory.totalJSHeapSize}:null}})()`,
      );
      const endedAt = new Date().toISOString(),
        elapsedMs = performance.now() - start;
      assert.equal(renderer.graphicsFailed, false);
      assert.equal(renderer.active, true);
      assert.equal(renderer.gpu.contextLost, false);
      assert.equal(renderer.metrics.errors.length, 0);
      const processes = app.getAppMetrics().map((process) => ({
        type: process.type,
        cpuPercentAsReported: process.cpu.percentCPUUsage,
        memoryKiB: process.memory,
      }));
      const backendObservedAt = new Date().toISOString(),
        backendMemoryBytes = await call("metrics", {});
      const { metrics, ...diagnostics } = renderer;
      const result = {
        label,
        startedAt,
        endedAt,
        elapsedMs,
        callbacksMs: percentiles(metrics.intervals),
        drawIntervalsMs: percentiles(metrics.drawIntervals),
        counters: { callbacks: metrics.callbacks, draws: metrics.draws },
        ...diagnostics,
        processes,
        backendObservedAt,
        backendMemoryBytes,
      };
      receipt.samples.push(result);
      return result;
    };
    const switchWorkspace = async (workspaceId) => {
      const before = performance.now();
      await click("#workspace-manager");
      const inputAt = await click(`[data-workspace="${workspaceId}"]`);
      await wait(
        `window.__aerynth.application().activeWorkspaceId===${JSON.stringify(workspaceId)}&&document.querySelector('#command-surface')?.open===false`,
      );
      receipt.actions.push({
        type: "workspace-switch",
        method: "native buttons",
        elapsedIncludingMenuMs: performance.now() - before,
        inputToCanonicalProjectionMs: Date.now() - inputAt,
        workspaceId,
      });
    };
    if (selected.restore) {
      const expected = JSON.parse(await fs.readFile(expectedPath, "utf8"));
      assert.equal(expected.count, selected.count);
      sameState(expected.state, await snapshot());
      receipt.freshProcessRestore = true;
      await sample("fresh-process-restored-idle");
      await capture("restart");
    } else {
      sameState(seed.expected, await snapshot());
      for (const [blockId, expected] of Object.entries(seed.configurations)) {
        assert.deepEqual(
          (await call("library", { name: "getBlockSettings", input: blockId }))
            .result,
          expected,
        );
      }
      await execute({
        type: "bringAllIntoView",
        workspaceId: seed.workspaceId,
      });
      await sample("fitted-overview-idle");
      await capture("overview");
      await switchWorkspace(seed.alternateWorkspaceId);
      await wait('document.querySelectorAll("[data-block]").length===0');
      const hidden = await sample("empty-workspace-original-blocks-unmounted");
      assert.equal(hidden.mountedBlocks, 0);
      assert.equal(hidden.editorNodes, 0);
      assert.deepEqual((await snapshot()).resources, seed.expected.resources);
      await switchWorkspace(seed.workspaceId);
      await wait(
        `document.querySelectorAll('[data-block]').length===${selected.count}`,
      );
      if (selected.count) {
        const first = seed.expected.blocks.find(
          (block) => block.id === seed.primaryBlockId,
        );
        assert.ok(first);
        assert.equal(
          seed.expected.resources.find(
            (resource) => resource.id === first.resource_id,
          )?.kind,
          "note",
        );
        const id = first.id,
          selector = `[data-block="${id}"]`;
        // A usable working-scale pose for native focus and resizing, distinct
        // from the fitted-overview rendering sample above.
        await execute({
          type: "setViewport",
          workspaceId: seed.workspaceId,
          viewport: { x: 0, y: 0, zoom: 1 },
        });
        const focusAt = await click(selector + " .unfold");
        await wait(
          `window.__aerynth.snapshot().expanded===${JSON.stringify(id)}&&['ready','saved','recovered'].includes(document.querySelector(${JSON.stringify(selector + " [data-note-state]")})?.dataset.noteState)`,
        );
        const editorSize = await js(
          `getComputedStyle(document.querySelector(${JSON.stringify(selector + " textarea")})).fontSize`,
        );
        assert.equal(
          editorSize,
          "24px",
          "actual note editor uses configured150% of16px",
        );
        receipt.actions.push({
          type: "focus",
          method: "native unfold button",
          inputToExpandedProjectionMs: Date.now() - focusAt,
          editorFontSize: editorSize,
        });
        await sample("focused-note-idle");
        await capture("focused");
        const collapseAt = await click(selector + " .unfold");
        await wait("window.__aerynth.snapshot().expanded===null");
        receipt.actions.push({
          type: "collapse",
          method: "native unfold button",
          inputToCollapsedProjectionMs: Date.now() - collapseAt,
        });
        // The shared driver waits for settled input targets, and every event
        // goes through the same no-refocus owner guard as other native tests.
        await settled();
        const point = await js(
          `(()=>{const e=document.querySelector(${JSON.stringify(selector + " .aw-card-edge--se")}),r=e.getBoundingClientRect(),x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2),hit=document.elementFromPoint(x,y);if(!e.contains(hit))throw Error('Occluded scale resize edge');return {x,y}})()`,
        );
        const before = await snapshot(),
          block = before.blocks.find((candidate) => candidate.id === id),
          resizeAt = Date.now();
        nativeInput(win, { type: "mouseMove", ...point });
        nativeInput(win, {
          type: "mouseDown",
          ...point,
          button: "left",
          clickCount: 1,
        });
        for (let step = 1; step <= 8; step++) {
          nativeInput(win, {
            type: "mouseMove",
            x: point.x + step * 4,
            y: point.y + step * 3,
            button: "left",
            modifiers: ["leftbuttondown"],
          });
          await pause(16);
        }
        nativeInput(win, {
          type: "mouseUp",
          x: point.x + 32,
          y: point.y + 24,
          button: "left",
          clickCount: 1,
        });
        await wait(
          `window.__aerynth.application().blocks.some(b=>b.id===${JSON.stringify(id)}&&b.version>${block.version}&&b.width===${block.width + 32}&&b.height===${block.height + 24})`,
        );
        assert.deepEqual((await snapshot()).resources, before.resources);
        assert.equal(
          await js(
            `getComputedStyle(document.querySelector(${JSON.stringify(selector + " textarea")})).fontSize`,
          ),
          "24px",
        );
        receipt.actions.push({
          type: "resize",
          method: "native southeast corner",
          inputToCanonicalGeometryMs: Date.now() - resizeAt,
          dx: 32,
          dy: 24,
        });
        await sample("resized-working-scale-idle");
      }
      await js("window.__aerynth.flush()");
      const actual = await snapshot();
      assert.equal(actual.blocks.length, selected.count);
      assert.deepEqual(actual.resources, seed.expected.resources);
      await fs.writeFile(
        expectedPath,
        JSON.stringify(
          { count: selected.count, source, state: state(actual) },
          null,
          2,
        ) + "\n",
      );
      receipt.freshProcessRestore = "pending separate --verify-restore process";
    }
    assert.equal(
      Object.keys((await call("snapshot", {})).executions).length,
      0,
    );
    receipt.passed = true;
  } catch (error) {
    receipt.error = error.stack;
  }
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(
    path.join(output, "scale.json"),
    JSON.stringify(receipt, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      passed: receipt.passed,
      count: receipt.count,
      error: receipt.error,
      evidence: output,
    }),
  );
  // Bounded synthetic profile only; end its real Core before exiting Electron.
  await Promise.race([call("close", {}).catch(() => {}), pause(1500)]);
  app.exit(receipt.passed ? 0 : 1);
};
