const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { createHash } = require("node:crypto");
const { createDriver } = require("./desktop-verify.cjs");
const {
  checkLabelClearance,
} = require("../../../constellation/tests/native-labels.cjs");
const {
  percentiles,
  summarizePresentMon,
} = require("./presentation-metrics.cjs");
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
exports.verify = async ({
  win,
  app,
  call,
  source,
  privateRoot,
  moduleStarted,
}) => {
  const out = path.resolve(
    __dirname,
    "../.runtime/application-evidence",
    "spatial-scale-" + Date.now(),
  );
  await fs.mkdir(out, { recursive: true });
  const receipt = {
    source,
    syntheticData: true,
    host: "Actual Aerynth desktop, canonical SQLite corpus and shared V3.5 GPU context",
    passed: false,
    limitations: [
      "CPU submission excludes spatial preparation and is not GPU elapsed time.",
      "Callback/draw intervals are distinct from PresentMon display events.",
      "Bounded samples do not establish long-term memory, power, thermal or full product qualification.",
      "Other applications and background hardware load were not controlled.",
    ],
  };
  let present;
  try {
    const seed = JSON.parse(
      await fs.readFile(path.join(privateRoot, "scale-seed.json"), "utf8"),
    );
    assert(seed.canonical && seed.syntheticData);
    receipt.seed = seed;
    const { js, wait, click, fill, snapshot } = await createDriver(win);
    receipt.startupToInteractiveMs = Date.now() - moduleStarted;
    let s = await snapshot();
    assert.equal(s.resources.length, seed.resourceCount);
    assert.equal(s.projects.length, seed.projectCount);
    assert.equal(s.relationships.length, seed.relationshipCount);
    assert.equal(s.navigation.kind, "constellation");
    assert(s.navigation.projectId);
    await wait(
      "window.__aerynth.snapshot().gpu?.spatialLayer.active&&!window.__aerynth.snapshot().gpu.spatialLayer.failed&&window.__aerynth.snapshot().spatial.renderer.nodes>0",
      20000,
    );
    win.show();
    win.focus();
    await click("#settings-button");
    await fill("#quality", "balanced");
    for (const selector of ["#quiet", "#reduced"])
      if (
        await js(`document.querySelector(${JSON.stringify(selector)}).checked`)
      )
        await click(selector);
    await click("#settings-close");
    await pause(1200);
    receipt.foreground = win.isFocused();
    receipt.labelClearance = await checkLabelClearance(win);
    await fs.writeFile(
      path.join(out, "project-before.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    const textButton = async (text) => {
      const token = "scale-" + Date.now();
      assert(
        await js(
          `(()=>{const e=[...document.querySelectorAll('.aw-camera-tools button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!e)return false;e.dataset.scaleTarget=${JSON.stringify(token)};return true})()`,
        ),
      );
      await click(`[data-scale-target="${token}"]`);
    };
    await click(".aw-camera-settings summary");
    const gpu = app.getAppMetrics().find((p) => p.type === "GPU"),
      tool = process.argv.find((a) => a.startsWith("--presentmon="))?.slice(13);
    let presentDone;
    if (tool && gpu) {
      assert(path.isAbsolute(tool));
      assert.equal(
        createHash("sha256")
          .update(await fs.readFile(tool))
          .digest("hex"),
        "b2a706bc6ad475749e3b7e3409263aa1e6906d45bdcf993f6dbc0f660188f1af",
      );
      present = spawn(
        tool,
        [
          "--process_id",
          String(gpu.pid),
          "--output_file",
          path.join(out, "presentation.csv"),
          "--timed",
          "12",
          "--terminate_after_timed",
          "--no_console_stats",
          "--v1_metrics",
          "--session_name",
          "Aerynth-" + process.pid + "-" + Date.now(),
        ],
        { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
      );
      const log = [];
      let logBytes = 0;
      for (const stream of [present.stdout, present.stderr])
        stream.on("data", (chunk) => {
          if (logBytes < 65536) {
            log.push(chunk.toString());
            logBytes += chunk.length;
          }
        });
      presentDone = new Promise((resolve) => {
        present.once("error", (e) => resolve({ error: e.message }));
        present.once("exit", (code) => resolve({ code, log: log.join("") }));
      });
    }
    await js("window.__aerynth.resetMetrics()");
    const samples = [];
    for (let i = 0; i < 40; i++) {
      await textButton(
        i % 4 === 0
          ? "Orbit up"
          : i % 4 === 1
            ? "Orbit right"
            : i % 4 === 2
              ? "Orbit down"
              : "Orbit left",
      );
      await pause(70);
      samples.push(
        await js(
          "(()=>{const s=window.__aerynth.snapshot();return{renderer:s.spatial.renderer,gpu:s.gpu,quality:s.quality,camera:s.spatial.camera}})()",
        ),
      );
    }
    receipt.callbackMetrics = await js("window.__aerynth.snapshot().metrics");
    receipt.callbackIntervalsMs = percentiles(
      receipt.callbackMetrics.intervals,
    );
    receipt.drawIntervalsMs = percentiles(
      receipt.callbackMetrics.drawIntervals,
    );
    receipt.spatialCpuSubmissionMs = percentiles(
      samples
        .filter(
          (s, i) =>
            i === 0 ||
            s.gpu.framesRendered !== samples[i - 1].gpu.framesRendered,
        )
        .map((s) => s.renderer.cpuSubmitMs),
    );
    receipt.spatialMax = {
      nodes: Math.max(...samples.map((s) => s.renderer.nodes)),
      drawCalls: Math.max(...samples.map((s) => s.renderer.drawCalls)),
      triangles: Math.max(...samples.map((s) => s.renderer.triangles)),
      culled: Math.max(...samples.map((s) => s.renderer.culled)),
    };
    receipt.samples = samples.map((s) => ({
      renderer: s.renderer,
      quality: s.quality,
      camera: s.camera,
      gpu: {
        geometries: s.gpu.geometries,
        textures: s.gpu.textures,
        drawCalls: s.gpu.drawCalls,
        triangles: s.gpu.triangles,
        spatialLayer: s.gpu.spatialLayer,
        framesRendered: s.gpu.framesRendered,
      },
    }));
    const ownMetrics = app.getAppMetrics();
    receipt.rendererMemoryKiB = ownMetrics.find(
      (p) => p.pid === win.webContents.getOSProcessId(),
    )?.memory;
    receipt.gpuMemoryKiB = ownMetrics.find((p) => p.type === "GPU")?.memory;
    receipt.backendProcessMemoryBytes = await call("metrics", {});
    if (presentDone) {
      const result = await Promise.race([
        presentDone,
        pause(16000).then(() => ({ error: "presentation_capture_timeout" })),
      ]);
      receipt.presentMon = result;
      if (result.error && present?.exitCode === null) present.kill();
      try {
        const file = path.join(out, "presentation.csv");
        assert((await fs.stat(file)).size <= 8 * 1024 * 1024);
        receipt.presentation = summarizePresentMon(
          await fs.readFile(file, "utf8"),
          gpu.pid,
        );
      } catch (error) {
        receipt.presentation = { qualified: false, reason: error.message };
      }
    } else
      receipt.presentation = {
        qualified: false,
        reason: "PresentMon_or_target_GPU_PID_unavailable",
      };
    assert(
      samples.every(
        (s) => s.gpu.spatialLayer.active && !s.gpu.spatialLayer.failed,
      ),
    );
    assert(samples.some((s) => s.renderer.nodes > 0));
    if (process.argv.includes("--spatial-regression")) {
      const checks = [];
      await pause(14500);
      receipt.idlePolicy = await js(
        "window.__aerynth.snapshot().metrics.policy",
      );
      assert(receipt.idlePolicy.includes("idle"));
      checks.push("real-visible-idle-policy");
      await click("#settings-button");
      for (const [quality, cap] of [
        ["efficient", 70],
        ["balanced", 160],
        ["cinematic", 280],
      ]) {
        await fill("#quality", quality);
        await pause(180);
        assert.equal(await js("window.__aerynth.snapshot().quality"), quality);
        assert(
          (await js("window.__aerynth.snapshot().spatial.renderer.nodes")) <=
            cap,
        );
      }
      checks.push("three-real-graphics-tiers-and-bounded-spatial-detail");
      await click("#quiet");
      await click("#settings-close");
      await pause(350);
      const quietDraws = await js("window.__aerynth.snapshot().metrics.draws");
      await pause(500);
      assert.equal(
        await js("window.__aerynth.snapshot().metrics.draws"),
        quietDraws,
      );
      checks.push("Quiet-suspends-settled-graphics");
      await click("#settings-button");
      await click("#quiet");
      await click("#reduced");
      await click("#settings-close");
      const camera = await js("window.__aerynth.snapshot().spatial.camera");
      await textButton("Orbit right");
      const after = await js("window.__aerynth.snapshot().spatial.camera");
      assert.notEqual(after.yaw, camera.yaw);
      assert.equal(await js("window.__aerynth.snapshot().reduced"), true);
      checks.push("reduced-motion-retains-native-spatial-navigation");
      const size = win.getSize();
      win.setContentSize(1050, 800);
      await pause(900);
      const labels = await js(
        '[...document.querySelectorAll(".aw-spatial-label[data-key]")].map(e=>e.dataset.key)',
      );
      assert.equal(new Set(labels).size, labels.length);
      receipt.smallWindowLabelClearance = await checkLabelClearance(win);
      win.setSize(...size);
      await pause(250);
      checks.push("native-window-resize-keeps-unique-labels");
      await js("window.__aerynth.simulateContextLoss()");
      await wait("window.__aerynth.snapshot().graphicsFailed");
      await js("window.__aerynth.restoreContext()");
      await wait(
        "!window.__aerynth.snapshot().graphicsFailed&&window.__aerynth.snapshot().gpu.spatialLayer.active&&!window.__aerynth.snapshot().gpu.spatialLayer.failed",
      );
      checks.push("real-WebGL-recovery-restores-combined-spatial-layer");
      await click('button[data-scene="living"]');
      await pause(200);
      assert.equal(await js("window.__aerynth.snapshot().study"), "living");
      await click('button[data-scene="architecture"]');
      checks.push("native-scene-change-retains-spatial-layer");
      win.minimize();
      await pause(500);
      assert(win.isMinimized());
      const stopped = await js("window.__aerynth.snapshot().metrics.draws");
      await pause(400);
      assert.equal(
        await js("window.__aerynth.snapshot().metrics.draws"),
        stopped,
      );
      win.restore();
      win.focus();
      await wait("window.__aerynth.snapshot().active");
      checks.push("actual-native-minimize-suspension-and-restore");
      receipt.regressions = checks;
    }
    s = await snapshot();
    assert.equal(s.resources.length, seed.resourceCount);
    assert.equal(s.relationships.length, seed.relationshipCount);
    await fs.writeFile(
      path.join(out, "project-after.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
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
    if (present?.exitCode === null) present.kill();
  }
  await fs.writeFile(
    path.join(out, "scale.json"),
    JSON.stringify(receipt, null, 2),
  );
  console.log(
    JSON.stringify({
      passed: receipt.passed,
      error: receipt.error,
      presentation: receipt.presentation,
      resources: receipt.seed?.resourceCount,
      evidence: out,
    }),
  );
  process.exitCode = receipt.passed ? 0 : 1;
  app.quit();
};
