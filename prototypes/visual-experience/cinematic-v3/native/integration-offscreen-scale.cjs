const assert = require("node:assert/strict");
const { appendFileSync } = require("node:fs");
const { readFile, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { options, sameState } = require("./integration-block-scale.cjs");
const { percentiles } = require("./presentation-metrics.cjs");

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Uses the real application renderer, host and database with a hidden
 * BrowserWindow. Timings here cannot establish native input or presentation. */
exports.verify = async ({
  win, app, privateRoot, call, source, moduleStartedMonotonicMs, startupErrors, startup,
}) => {
  const selected = options(process.argv);
  const profile = process.argv.includes("--offscreen-profile");
  const memoryCycles = process.argv.includes("--offscreen-memory-cycles");
  const trace = process.argv.includes("--offscreen-checkpoints");
  const phase = selected.restore ? "restart" : "initial";
  const checkpointPath = path.join(privateRoot, "offscreen-checkpoints-" + phase + ".jsonl");
  function checkpoint(stage) {
    if (!trace) return;
    appendFileSync(checkpointPath, JSON.stringify({
      stage,
      elapsedMs: Math.round(performance.now() - moduleStartedMonotonicMs),
    }) + "\n");
  }
  checkpoint("verifier-started");
  const devtools = win.webContents.debugger;
  const receipt = {
    contract: "aerynth.offscreen-block-scale@1",
    source,
    phase,
    count: selected.count,
    scope: "Offscreen Electron callback and compositor paint observations. No visible window, native pointer input, OS presentation, or provider execution.",
    passed: false,
    samples: [],
    commandElapsedMs: {},
    ...(startup ? { startup } : {}),
  };
  const seed = JSON.parse(await readFile(path.join(privateRoot, "block-scale-seed.json"), "utf8"));
  const projection = (state) => Object.fromEntries(Object.keys(seed.expected).map((key) => [key, state[key]]));
  const expectedPath = path.join(privateRoot, "offscreen-scale-expected.json");
  const pinWitness = process.argv.includes("--offscreen-saved-pin");
  const pinPath = path.join(privateRoot, "offscreen-scale-pin.json");
  async function verifySavedPin() {
    const expected = JSON.parse(await readFile(pinPath, "utf8"));
    assert.equal(expected.key, "resource:" + seed.primaryBlockId);
    assert.equal(expected.anchor.pinned, true);
    const stored = await call("viewState", {});
    const rendered = await js("window.__aerynth.snapshot().spatial?.anchors");
    assert.deepEqual(stored?.anchors?.[expected.key], expected.anchor, "saved Constellation pin");
    assert.deepEqual(rendered?.[expected.key], expected.anchor, "rendered Constellation pin");
    receipt.savedPin = { key: expected.key, storageMatched: true, rendererMatched: true };
  }

  const paintIntervals = [];
  let lastPaint = 0, paintCount = 0;
  const onPaint = () => {
    const now = performance.now();
    if (lastPaint && paintIntervals.length < 2048) paintIntervals.push(now - lastPaint);
    lastPaint = now;
    paintCount++;
  };
  win.webContents.on("paint", onPaint);
  const assertHidden = () => {
    assert(!win.isDestroyed() && !win.isVisible() && !win.isFocused(), "offscreen_window_must_remain_hidden");
  };
  const js = async (code) => {
    assertHidden();
    const result = await win.webContents.executeJavaScript(code);
    assertHidden();
    return result;
  };
  const wait = async (predicate) => {
    const until = performance.now() + 5500;
    do {
      if (await js(predicate)) return;
      await pause(50);
    } while (performance.now() < until);
    throw Error("Offscreen renderer did not satisfy " + predicate);
  };
  const snapshot = () => js("window.__aerynth.application()");
  const execute = (action) => js("window.__aerynth.execute(" + JSON.stringify(action) + ")");
  const timed = async (name, action) => {
    checkpoint(name);
    const start = performance.now();
    const result = await action();
    receipt.commandElapsedMs[name] = performance.now() - start;
    return result;
  };
  const processMemory = () => {
    const rendererPid = win.webContents.getOSProcessId();
    return app.getAppMetrics().map(({ pid, type, memory }) => ({
      role: pid === rendererPid ? "workspace-renderer" : type,
      workingSetKiB: memory.workingSetSize,
      peakWorkingSetKiB: memory.peakWorkingSetSize,
      ...(Number.isFinite(memory.privateBytes) ? { privateKiB: memory.privateBytes } : {}),
    }));
  };
  const chromiumMetrics = async () => {
    const { metrics } = await devtools.sendCommand("Performance.getMetrics");
    return Object.fromEntries(metrics.map(({ name, value }) => [name, value]));
  };
  const delta = (before, after) => Object.fromEntries([
    "ScriptDuration", "LayoutDuration", "RecalcStyleDuration", "TaskDuration",
    "LayoutCount", "RecalcStyleCount",
  ].filter((key) => Number.isFinite(before[key]) && Number.isFinite(after[key]))
    .map((key) => [key, after[key] - before[key]]));
  const sample = async (label) => {
    checkpoint(label);
    const before = profile ? await chromiumMetrics() : null;
    await js("window.__aerynth.resetMetrics()");
    paintIntervals.length = 0;
    lastPaint = paintCount = 0;
    const start = performance.now();
    await pause(selected.sampleMs);
    const result = await js(`(() => {
      const s = window.__aerynth.snapshot();
      const cards = [...document.querySelectorAll('[data-block]')];
      return { metrics:s.metrics, active:s.active, graphicsFailed:s.graphicsFailed, contextLost:s.gpu?.contextLost,
        surfacesRendered:s.gpu?.surfacesRendered,detailedSurfacesRendered:s.gpu?.detailedSurfacesRendered,
        distinctSlabGeometries:s.gpu?.distinctSlabGeometries,
        gpuResources: s.gpu && { geometries: s.gpu.geometries, textures: s.gpu.textures },
        unhiddenCardNodes:cards.filter(card=>!card.hidden).length, mountedCards:cards.length,
        interactiveCardNodes:cards.filter(card=>!card.closest('[inert],[hidden]')).length,
        usableCardNodes:cards.filter(card=>card.dataset.workspacePresentation==='usable').length,
        editorNodes:document.querySelectorAll('[data-block] textarea').length };
    })()`);
    assert.equal(result.active, true);
    assert.equal(result.graphicsFailed, false);
    assert.equal(result.contextLost, false);
    assertGpuResources(result.gpuResources);
    assert.deepEqual(result.metrics.errors, []);
    assert(result.metrics.draws > 0 && paintCount > 0, "no_offscreen_frames_observed");
    const { metrics, ...observations } = result;
    const elapsedMs = performance.now() - start;
    const after = before ? await chromiumMetrics() : null;
    receipt.samples.push({
      label, ...observations, elapsedMs,
      callbacks: metrics.callbacks, draws: metrics.draws, paints: paintCount,
      callbackIntervalsMs: percentiles(metrics.intervals),
      offscreenPaintIntervalsMs: percentiles(paintIntervals),
      processMemory: processMemory(),
      ...(after ? {
        chromiumPerformanceDelta: delta(before, after),
        ...(Number.isFinite(after.JSHeapUsedSize) ? { rendererHeapUsedBytes: after.JSHeapUsedSize } : {}),
      } : {}),
    });
  };
  const navigate = (target) => execute({ type: "navigate", target });
  const visibleWorkspace = () => wait(`(() => {
    const stage = document.querySelector('#stage');
    return !stage.inert && Number(getComputedStyle(stage).opacity) >= 0.98 &&
      (${selected.count} === 0 || [...stage.querySelectorAll('[data-block]')].some(
        card => card.checkVisibility({ opacityProperty: true, visibilityProperty: true }) && card.getBoundingClientRect().width > 0
      ));
  })()`);
  const settledWorkspace = async () => {
    const until = performance.now() + 5500;
    let previous, unchanged = 0;
    while (performance.now() < until) {
      const current = await js(`(() => {
        const { poses } = window.__aerynth.snapshot();
        const stage = document.querySelector('#stage');
        return JSON.stringify([stage.style.transform, stage.style.opacity,
          ...Object.values(poses).map(pose =>
            Object.values(pose).map(value => Number(value).toFixed(3)))]);
      })()`);
      unchanged = current === previous ? unchanged + 1 : 0;
      if (unchanged >= 3) return;
      previous = current;
      await pause(50);
    }
    throw Error("Offscreen workspace motion did not settle");
  };
  const capture = async (name) => {
    assertHidden();
    const image = await win.webContents.capturePage(undefined, { stayHidden: true });
    assertHidden();
    assert(!image.isEmpty(), "offscreen_capture_empty");
    const png = image.toPNG();
    assert(png.length <= 4 * 1024 * 1024, "offscreen_capture_capacity");
    await writeFile(path.join(privateRoot, name), png, { flag: "wx" });
    return name;
  };
  try {
    if (profile) {
      devtools.attach("1.3");
      await devtools.sendCommand("Performance.enable");
    }
    checkpoint("wait-for-hydration");
    await wait('document.body.dataset.applicationHydrated === "true"');
    receipt.startupToHydratedMs = performance.now() - moduleStartedMonotonicMs;
    checkpoint("wait-for-first-draw");
    await js("window.__aerynth.setActive(true)");
    await wait("window.__aerynth.snapshot().metrics.draws > 0");
    const initial = await snapshot();
    checkpoint("initial-state");
    if (pinWitness) await verifySavedPin();
    if (selected.restore) {
      sameState(JSON.parse(await readFile(expectedPath, "utf8")), initial);
      await visibleWorkspace();
      await sample("restored-working-workspace");
    } else {
      sameState(seed.expected, initial);
      await timed("fit", () => execute({ type: "bringAllIntoView", workspaceId: seed.workspaceId }));
      await sample("fitted-workspace");
      if (process.argv.includes("--offscreen-capture-fit")) {
        await settledWorkspace();
        await sample("settled-fitted-workspace");
        receipt.fittedBounds = await js(`(() => {
          const cards = [...document.querySelectorAll('#stage [data-block]'), document.querySelector('#vela')];
          const rects = cards.filter(node => node && !node.hidden).map(node => node.getBoundingClientRect());
          return {
            width: innerWidth, height: innerHeight, count: rects.length,
            left: Math.min(...rects.map(rect => rect.left)),
            right: Math.max(...rects.map(rect => rect.right)),
            top: Math.min(...rects.map(rect => rect.top)),
            bottom: Math.max(...rects.map(rect => rect.bottom))
          };
        })()`);
        receipt.fitCapture = await capture("offscreen-scale-fitted.png");
      }
      await timed("navigateUniverse", () => navigate({ kind: "constellation", projectId: null }));
      assert.equal((await snapshot()).navigation.kind, "constellation");
      await wait("document.querySelector('#stage').inert === true");
      await sample("universe");
      await timed("openEmptyWorkspace", () => navigate({ kind: "workspace", workspaceId: seed.alternateWorkspaceId }));
      await wait("document.querySelectorAll('[data-block]').length === 0");
      await timed("returnToWorkspace", () => navigate({ kind: "workspace", workspaceId: seed.workspaceId }));
      await execute({ type: "setViewport", workspaceId: seed.workspaceId, viewport: { x: 0, y: 0, zoom: 1 } });
      const before = await snapshot();
      assert.deepEqual(before.resources, seed.expected.resources);
      assert.deepEqual(before.blocks, seed.expected.blocks);
      if (selected.count) {
        const block = before.blocks.find((item) => item.id === seed.primaryBlockId);
        assert(block);
        await timed("resize", () => execute({
          type: "geometry", blockId: block.id, expectedVersion: block.version,
          placement: { x: block.x, y: block.y, width: block.width + 32, height: block.height + 24, z: block.z },
          shape: block.shape,
        }));
        const resized = (await snapshot()).blocks.find((item) => item.id === block.id);
        assert.equal(resized.width, block.width + 32);
        assert.equal(resized.height, block.height + 24);
      }
      await visibleWorkspace();
      await sample("working-workspace");
      await settledWorkspace();
      await sample("settled-return-workspace");
      const canonical = await snapshot();
      assert.deepEqual(canonical.resources, initial.resources);
      if (memoryCycles) {
        // Repeat the same scene lifecycle without capturing images between
        // samples. Each return must retain the same committed workspace.
        for (let cycle = 1; cycle <= 3; cycle++) {
          checkpoint("navigate-revisit-" + cycle);
          await navigate({ kind: "constellation", projectId: null });
          await wait("document.querySelector('#stage').inert === true");
          await navigate({ kind: "workspace", workspaceId: seed.alternateWorkspaceId });
          await wait("document.querySelectorAll('[data-block]').length === 0");
          await navigate({ kind: "workspace", workspaceId: seed.workspaceId });
          await visibleWorkspace();
          await settledWorkspace();
          sameState(projection(canonical), await snapshot());
          await sample("memory-revisit-" + cycle);
        }
        checkpoint("inactive-draws");
        await js("window.__aerynth.setActive(false)");
        await wait("window.__aerynth.snapshot().active === false");
        await pause(200);
        const before = await js("window.__aerynth.snapshot().metrics.draws");
        await pause(selected.sampleMs);
        const after = await js("window.__aerynth.snapshot().metrics.draws");
        assert.equal(after, before, "inactive_workspace_draws_continued");
        receipt.inactiveDraws = after - before;
        await js("window.__aerynth.setActive(true)");
        await wait("window.__aerynth.snapshot().metrics.draws > " + after);
      }
      checkpoint("reduced-motion");
      await js("window.__aerynth.setReduced(true)");
      await wait("window.__aerynth.snapshot().reduced === true");
      checkpoint("lose-context");
      await js("window.__aerynth.simulateContextLoss()");
      await wait("window.__aerynth.snapshot().gpu?.contextLost === true");
      const drawsBeforeRestore = await js("window.__aerynth.snapshot().metrics.draws");
      checkpoint("restore-context");
      await js("window.__aerynth.restoreContext()");
      await wait("window.__aerynth.snapshot().gpu?.contextLost === false && !window.__aerynth.snapshot().graphicsFailed");
      await wait("window.__aerynth.snapshot().metrics.draws > " + drawsBeforeRestore);
      await visibleWorkspace();
      sameState(projection(canonical), await snapshot());
      if (memoryCycles) {
        const recovered = await js(`(() => {
          const { geometries, textures } = window.__aerynth.snapshot().gpu;
          return { geometries, textures };
        })()`);
        assertGpuResources(recovered);
        receipt.recoveredGpuResources = recovered;
      }
      checkpoint("flush");
      await js("window.__aerynth.flush()");
      await writeFile(expectedPath, JSON.stringify(projection(canonical)), { flag: "wx" });
      receipt.reducedMotion = true;
      receipt.graphicsRecovered = true;
    }
    checkpoint("final-state-and-capture");
    if (pinWitness) await verifySavedPin();
    receipt.capture = await capture("offscreen-scale-" + receipt.phase + ".png");
    assert.deepEqual(startupErrors, []);
    assert.deepEqual(Object.keys((await call("snapshot", {})).executions), []);
    receipt.backendMemoryBytes = await call("metrics", {});
    receipt.passed = true;
  } catch (error) {
    receipt.error = String(error.stack || error);
  }
  if (profile && devtools.isAttached()) devtools.detach();
  win.webContents.removeListener("paint", onPaint);
  const evidence = path.join(privateRoot, "offscreen-scale-" + receipt.phase + ".json");
  checkpoint("close-backend");
  try { await call("close", {}); }
  catch (error) { receipt.passed = false; receipt.error ??= String(error.stack || error); }
  await writeFile(evidence, JSON.stringify(receipt, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ passed: receipt.passed, count: receipt.count, evidence, error: receipt.error }));
  app.exit(receipt.passed ? 0 : 1);
};

function assertGpuResources(resources) {
  for (const name of ["geometries", "textures"]) {
    assert(Number.isSafeInteger(resources?.[name]) && resources[name] >= 0,
      "missing_or_invalid_gpu_resource_count:" + name);
  }
}
