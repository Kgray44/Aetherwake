const assert = require("node:assert/strict");
const { readFile, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { options, sameState } = require("./integration-block-scale.cjs");
const { percentiles } = require("./presentation-metrics.cjs");

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Uses the real application renderer, host and database with a hidden
 * BrowserWindow. Timings here cannot establish native input or presentation. */
exports.verify = async ({
  win, app, privateRoot, call, source, moduleStartedMonotonicMs, startupErrors,
}) => {
  const selected = options(process.argv);
  const receipt = {
    contract: "aerynth.offscreen-block-scale@1",
    source,
    phase: selected.restore ? "restart" : "initial",
    count: selected.count,
    scope: "Offscreen Electron callback and compositor paint observations. No visible window, native pointer input, OS presentation, or provider execution.",
    passed: false,
    samples: [],
  };
  const seed = JSON.parse(await readFile(path.join(privateRoot, "block-scale-seed.json"), "utf8"));
  const projection = (state) => Object.fromEntries(Object.keys(seed.expected).map((key) => [key, state[key]]));
  const expectedPath = path.join(privateRoot, "offscreen-scale-expected.json");
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
  const sample = async (label) => {
    await js("window.__aerynth.resetMetrics()");
    paintIntervals.length = 0;
    lastPaint = paintCount = 0;
    const start = performance.now();
    await pause(selected.sampleMs);
    const result = await js(`(() => {
      const s = window.__aerynth.snapshot();
      const cards = [...document.querySelectorAll('[data-block]')];
      return { metrics:s.metrics, active:s.active, graphicsFailed:s.graphicsFailed, contextLost:s.gpu?.contextLost,
        unhiddenCardNodes:cards.filter(card=>!card.hidden).length, mountedCards:cards.length,
        interactiveCardNodes:cards.filter(card=>!card.closest('[inert],[hidden]')).length,
        editorNodes:document.querySelectorAll('[data-block] textarea').length };
    })()`);
    assert.equal(result.active, true);
    assert.equal(result.graphicsFailed, false);
    assert.equal(result.contextLost, false);
    assert.deepEqual(result.metrics.errors, []);
    assert(result.metrics.draws > 0 && paintCount > 0, "no_offscreen_frames_observed");
    const { metrics, ...observations } = result;
    receipt.samples.push({
      label, ...observations, elapsedMs: performance.now() - start,
      callbacks: metrics.callbacks, draws: metrics.draws, paints: paintCount,
      callbackIntervalsMs: percentiles(metrics.intervals),
      offscreenPaintIntervalsMs: percentiles(paintIntervals),
    });
  };
  const navigate = (target) => execute({ type: "navigate", target });
  try {
    await wait('document.body.dataset.applicationHydrated === "true"');
    receipt.startupToHydratedMs = performance.now() - moduleStartedMonotonicMs;
    await js("window.__aerynth.setActive(true)");
    await wait("window.__aerynth.snapshot().metrics.draws > 0");
    const initial = await snapshot();
    if (selected.restore) {
      sameState(JSON.parse(await readFile(expectedPath, "utf8")), initial);
      await sample("restored-working-workspace");
    } else {
      sameState(seed.expected, initial);
      await execute({ type: "bringAllIntoView", workspaceId: seed.workspaceId });
      await sample("fitted-workspace");
      await navigate({ kind: "constellation", projectId: null });
      assert.equal((await snapshot()).navigation.kind, "constellation");
      await wait("document.querySelector('#stage').inert === true");
      await sample("universe");
      await navigate({ kind: "workspace", workspaceId: seed.alternateWorkspaceId });
      await wait("document.querySelectorAll('[data-block]').length === 0");
      await navigate({ kind: "workspace", workspaceId: seed.workspaceId });
      await execute({ type: "setViewport", workspaceId: seed.workspaceId, viewport: { x: 0, y: 0, zoom: 1 } });
      const before = await snapshot();
      assert.deepEqual(before.resources, seed.expected.resources);
      assert.deepEqual(before.blocks, seed.expected.blocks);
      if (selected.count) {
        const block = before.blocks.find((item) => item.id === seed.primaryBlockId);
        assert(block);
        await execute({
          type: "geometry", blockId: block.id, expectedVersion: block.version,
          placement: { x: block.x, y: block.y, width: block.width + 32, height: block.height + 24, z: block.z },
          shape: block.shape,
        });
        const resized = (await snapshot()).blocks.find((item) => item.id === block.id);
        assert.equal(resized.width, block.width + 32);
        assert.equal(resized.height, block.height + 24);
      }
      await sample("working-workspace");
      const canonical = await snapshot();
      assert.deepEqual(canonical.resources, initial.resources);
      await js("window.__aerynth.setReduced(true)");
      await wait("window.__aerynth.snapshot().reduced === true");
      await js("window.__aerynth.simulateContextLoss()");
      await wait("window.__aerynth.snapshot().gpu?.contextLost === true");
      const drawsBeforeRestore = await js("window.__aerynth.snapshot().metrics.draws");
      await js("window.__aerynth.restoreContext()");
      await wait("window.__aerynth.snapshot().gpu?.contextLost === false && !window.__aerynth.snapshot().graphicsFailed");
      await wait("window.__aerynth.snapshot().metrics.draws > " + drawsBeforeRestore);
      sameState(projection(canonical), await snapshot());
      await js("window.__aerynth.flush()");
      await writeFile(expectedPath, JSON.stringify(projection(canonical)), { flag: "wx" });
      receipt.reducedMotion = true;
      receipt.graphicsRecovered = true;
    }
    assertHidden();
    const image = await win.webContents.capturePage(undefined, { stayHidden: true });
    assertHidden();
    assert(!image.isEmpty(), "offscreen_capture_empty");
    const png = image.toPNG();
    assert(png.length <= 4 * 1024 * 1024, "offscreen_capture_capacity");
    const capture = "offscreen-scale-" + receipt.phase + ".png";
    await writeFile(path.join(privateRoot, capture), png, { flag: "wx" });
    receipt.capture = capture;
    assert.deepEqual(startupErrors, []);
    assert.deepEqual(Object.keys((await call("snapshot", {})).executions), []);
    receipt.backendMemoryBytes = await call("metrics", {});
    receipt.passed = true;
  } catch (error) {
    receipt.error = String(error.stack || error);
  }
  win.webContents.removeListener("paint", onPaint);
  const evidence = path.join(privateRoot, "offscreen-scale-" + receipt.phase + ".json");
  try { await call("close", {}); }
  catch (error) { receipt.passed = false; receipt.error ??= String(error.stack || error); }
  await writeFile(evidence, JSON.stringify(receipt, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ passed: receipt.passed, count: receipt.count, evidence, error: receipt.error }));
  app.exit(receipt.passed ? 0 : 1);
};
