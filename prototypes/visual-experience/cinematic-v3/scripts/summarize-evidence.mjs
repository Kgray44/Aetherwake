import fs from "node:fs/promises";
const root = new URL("../", import.meta.url);
const report = JSON.parse(
  await fs.readFile(new URL("evidence/verification.json", root), "utf8"),
);
const n = (v, d = 2) => (v == null ? "unavailable" : v.toFixed(d));
const rows = report.scenarios
  .map(
    (s) =>
      `| ${s.name} | ${s.callbackSamples} | ${n(s.callbackMs.p50)} / ${n(s.callbackMs.p95)} / ${n(s.callbackMs.p99)} | ${s.drawSamples} | ${n(s.drawMs.p95)} | ${n(s.cpuReportedSumMean)} | ${n(s.workingSetKiBSumMean / 1024, 1)} |`,
  )
  .join("\n");
const content = `# Native performance evidence\n\nCaptured ${report.capturedAt}. Electron ${report.versions.electron}, Chromium ${report.versions.chrome}, Node ${report.versions.node}. Display ${report.display.size.width}×${report.display.size.height}, scale ${report.display.scaleFactor}, reported ${report.display.refreshRate}Hz; final content bounds ${report.window.width}×${report.window.height}. Normal desktop background applications remained present.\n\n## Method\n\nReproduce with npm run verify after a locked install/build. Each active sample has a1200ms warm-up and approximately4.5s measurement. Balanced/Efficient repeat twice with the same workspace and synthetic Working presence. Cinematic-active uses that same scene once. Cinematic-transition repeats twice with scripted expansion/reversal approximately every500ms throughout measurement. Idle first waits13.5s beyond the last interaction. Native-minimized measures the actual minimized window. No screenshots are captured during these measured intervals. Measurement follows the capture-heavy functional journey in the same process; retained browser/compositor allocations can influence the working sets. This is not a fresh normal-profile memory baseline.\n\nCPU uses Electron app-metrics across its processes, primed before sampling and read every500ms; values are sums of reported CPU percentages. Working sets are reported KiB summed across those processes, converted toMiB below; shared pages can be counted more than once. This is not unique resident memory, VRAM, or an isolated system benchmark.\n\nCallback intervals, actual renderer submission counts, and draw intervals are distinct. **None is presented FPS.** A zero callback count has no defined percentile; unavailable is intentional. Efficient intentionally renders less often. The higher callback intervals in Efficient do not mean a slow input path; active interaction/transition remains immediately scheduled.\n\n| Scenario | Callback samples | Callback p50 / p95 / p99 ms | Renderer submissions | Submission interval p95 ms | CPU reported sum mean % | Working-set sum MiB |\n|---|---:|---:|---:|---:|---:|---:|\n${rows}\n\n## Input and startup\n\n${report.inputFeedback.samples} programmatic DOM click-dispatch→next-coordinator-callback samples: p50 ${n(report.inputFeedback.p50)}ms, p95 ${n(report.inputFeedback.p95)}ms, maximum ${n(report.inputFeedback.max)}ms. This excludes OS pointer injection, display presentation and optical response. Separate native mouse/keyboard smoke tests establish the input path's functionality, not its latency.\n\nNative module evaluation→local renderer load: ${report.startup.moduleToRendererLoadMs}ms. This is not OS cold startup.\n\n## Qualification limits\n\nNo physical60Hz display-mode comparison, attributable physical VRAM, present timing, power/thermal trace, long-history scalability, mixed-DPI/display-disconnect test, automatic game detection, or prolonged soak was established. Higher-refresh observations come from this165Hz display; Balanced's60 submission target does not establish a60Hz monitor run. The short verification journey and repeated windows do not establish universal smoothness, leak freedom, or energy savings.\n\nGPU engine/process-memory diagnostics, when obtained, are in evidence/gpu-probe.json and were collected separately. Engine sums are not whole-GPU utilization; process memory counters have documented limitations ([Microsoft](https://learn.microsoft.com/en-us/troubleshoot/windows-client/performance/gpu-process-memory-counters-report-wrong-value)). A separate global NVIDIA snapshot showed9% utilization and1515MiB in use; it was not attributable to this application and is not an app performance result.\n\n## Integrity\n\nThe JSON receipt preserves all checks, distributions, conditions, quality-policy state, scene submission/geometry counts, motion frame timestamps and unavailable fields. Build assets: ${report.buildAssets.join(", ")}. Captures/metrics are local prototype evidence; neither a host-selection verdict nor owner acceptance.\n`;
const cleaned = content
  .replaceAll("a1200ms", "a 1200 ms")
  .replaceAll("approximately4.5s", "approximately 4.5 s")
  .replaceAll("every500ms", "every 500 ms")
  .replaceAll("13.5s", "13.5 s")
  .replaceAll("toMiB", "to MiB")
  .replaceAll("physical60Hz", "physical 60 Hz")
  .replaceAll("this165Hz", "this 165 Hz")
  .replaceAll("Balanced's60", "Balanced's 60")
  .replaceAll("a60Hz", "a 60 Hz")
  .replaceAll("showed9%", "showed 9%")
  .replaceAll("and1515MiB", "and 1515 MiB")
  .replace(
    "Idle first waits13.5 s beyond the last interaction.",
    "Idle first waits 13.5 s beyond the last interaction, then keeps expressive ambient motion at a lower cadence. Ambient-off and Quiet are separate stillness probes.",
  )
  .replace(
    "Native-minimized measures the actual minimized window.",
    "Native-minimized measures the actual minimized window. The isolated native verification profile keeps a visible renderer alive despite desktop focus changes, with Chromium background throttling disabled; normal mode still pauses on blur. This prevents activity in the coordinating app from turning a measurement into an unrelated background-pause sample.",
  );
const baseline = JSON.parse(
  await fs.readFile(
    new URL("evidence/pre-addendum/verification.json", root),
    "utf8",
  ),
);
const comparison = baseline.scenarios
  .filter((s) => /balanced-active|cinematic-transition|efficient-/.test(s.name))
  .map((before) => {
    const after = report.scenarios.find((s) => s.name === before.name);
    return `| ${before.name} | ${n(before.callbackMs.p95)} | ${n(after?.callbackMs.p95)} | ${before.drawSamples} / ${after?.drawSamples ?? "unavailable"} |`;
  })
  .join("\n");
const addendum = `\n\n## Addendum workload and comparison\n\nIntegrated-focus-stream runs the visible synthetic event stream, Vela expression, atmospheric response and repeated conversation focus/reversal together. Focused-native-resize alternates the real native content bounds between 1280×800 and 1600×1000 during focused work. These are additional stress samples, not frame-presentation traces.\n\nPre-addendum receipt: ${baseline.capturedAt}; current receipt: ${report.capturedAt}. The same named tier/workspace and scripted transition samples are compared below. The conversation now contains a real DOM message stream/composer, so the expanded workload is richer; background desktop load was not isolated. Differences cannot be attributed solely to one visual refinement.\n\n| Scenario | Before callback p95 ms | After callback p95 ms | Before / after submissions |\n|---|---:|---:|---:|\n${comparison}\n\nThe source preserves the graphics chunk warning (~521 kB minified), the diagnostic GPU-counter limitations and every unavailable measurement. Physical 60 Hz, presented timing, attributable VRAM and sustained thermal/energy acceptance remain open.\n`;
await fs.writeFile(new URL("PERFORMANCE.md", root), cleaned + addendum);
console.log(
  JSON.stringify({
    checks: report.checks.length,
    failed: report.checks.filter((c) => !c.passed).length,
    report: "PERFORMANCE.md",
  }),
);
