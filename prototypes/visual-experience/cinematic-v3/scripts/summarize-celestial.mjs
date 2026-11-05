import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const relative = (process.argv[2] ?? "")
  .replaceAll("\\", "/")
  .replace(/\/+$/, "");
if (
  !/^evidence-celestial\/[a-zA-Z0-9][a-zA-Z0-9_./-]*$/.test(relative) ||
  relative.includes("..")
)
  throw new Error(
    "A celestial performance report requires an explicit evidence-celestial/<run> directory",
  );
const artifact = `${relative}/verification.json`;
const bytes = await fs.readFile(path.join(root, artifact));
const report = JSON.parse(bytes);
if (
  !Array.isArray(report.scenarios) ||
  !report.scenarios.length ||
  !Array.isArray(report.checks)
)
  throw new Error(
    "The selected artifact is not a completed native verification receipt",
  );
if (
  !report.sourceHashesAtLaunch?.["src/celestial-environment.ts"] ||
  !report.scenarios.some(
    (scenario) =>
      scenario.gpu?.cosmos &&
      ["starlit", "shadow", "deep"].includes(scenario.state?.celestialStudy),
  )
)
  throw new Error(
    "The selected receipt does not establish celestial source and workload coverage; a preceding V3.5 run cannot be relabeled",
  );
if (
  report.scenarios.some(
    (scenario) => scenario.state?.environmentPhaseOverrideSeconds !== null,
  )
)
  throw new Error(
    "Celestial performance samples must explicitly record a released environment phase override",
  );

const n = (value) =>
  Number.isFinite(value) ? value.toFixed(2) : "unavailable";
const cell = (value) =>
  String(value ?? "unavailable")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");
const revision = (value) =>
  /^[0-9a-f]{40}$/i.test(value ?? "") ? value : "unavailable";
const mib = (value) => (Number.isFinite(value) ? value / 1024 : NaN);
const readOptional = async (file) => {
  try {
    return JSON.parse(await fs.readFile(path.join(root, file), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};
const sourceMatches = (candidate) => {
  const expected = Object.entries(report.sourceHashesAtLaunch).filter(
    ([name]) => name.startsWith("src/"),
  );
  const actual = candidate?.sourceHashesAtLaunch ?? candidate?.sourceHashes;
  return (
    expected.length > 0 &&
    expected.every(([name, hash]) => actual?.[name] === hash)
  );
};
const baselineFile = "evidence-v3-5/review-occlusion-final/verification.json";
const baseline = await readOptional(baselineFile);
const originalBaselineFile = "evidence-v3-5/baseline/verification.json";
const originalBaseline = await readOptional(originalBaselineFile);
const sourceTestFile = "evidence-celestial/source-tests.json";
const sourceTests = await readOptional(sourceTestFile);
const memoryFile = "evidence-celestial/fresh-process-memory.json";
const memory = await readOptional(memoryFile);
const failed = report.checks.filter((check) => check.passed !== true);
const scenarios = report.scenarios;
const rows = scenarios
  .map(
    (sample) =>
      `| ${cell(sample.name)} | ${sample.callbackSamples} | ${n(sample.callbackMs?.p50)} / ${n(sample.callbackMs?.p95)} / ${n(sample.callbackMs?.p99)} | ${sample.drawSamples} | ${n(sample.drawMs?.p95)} | ${n(sample.cpuReportedSumMean)} | ${n(mib(sample.workingSetKiBSumMean))} |`,
  )
  .join("\n");
const geometryRows = scenarios
  .map((sample) => {
    const gpu = sample.gpu ?? {},
      sky = gpu.cosmos ?? {},
      architecture = gpu.architecture ?? {};
    const shadows = gpu.shadows?.enabled
      ? `${gpu.shadows.mapSize}px`
      : gpu.shadows?.enabled === false
        ? "off"
        : "unavailable";
    return `| ${cell(sample.name)} | ${cell(gpu.drawCalls)} | ${cell(gpu.triangles)} | ${cell(sky.renderedStars)} / ${cell(sky.visible)} | ${cell(sky.batches)} | ${cell(architecture.triangles)} / ${cell(architecture.environmentVisible)} | ${shadows} |`;
  })
  .join("\n");
const comparisonRows =
  baseline?.scenarios
    ?.filter((sample) =>
      /balanced-active|cinematic-transition|efficient-/.test(sample.name),
    )
    .map((before) => {
      const after = scenarios.find((sample) => sample.name === before.name);
      return `| ${cell(before.name)} | ${n(before.callbackMs?.p95)} / ${n(after?.callbackMs?.p95)} | ${n(before.drawMs?.p95)} / ${n(after?.drawMs?.p95)} | ${n(before.cpuReportedSumMean)} / ${n(after?.cpuReportedSumMean)} | ${n(mib(before.workingSetKiBSumMean))} / ${n(mib(after?.workingSetKiBSumMean))} |`;
    })
    .join("\n") ?? "";
const originalComparisonRows =
  originalBaseline?.scenarios
    ?.filter((sample) =>
      /balanced-active|cinematic-transition|efficient-/.test(sample.name),
    )
    .map((before) => {
      const after = scenarios.find((sample) => sample.name === before.name);
      return `| ${cell(before.name)} | ${n(before.callbackMs?.p95)} / ${n(after?.callbackMs?.p95)} | ${n(before.drawMs?.p95)} / ${n(after?.drawMs?.p95)} | ${n(before.cpuReportedSumMean)} / ${n(after?.cpuReportedSumMean)} | ${n(mib(before.workingSetKiBSumMean))} / ${n(mib(after?.workingSetKiBSumMean))} |`;
    })
    .join("\n") ?? "";
let sourceTestSection = `No final source-test receipt has been supplied at \`${sourceTestFile}\`. The native check count below does not stand in for source tests. The earlier integration checkpoint reported 42 source tests; that developmental count is not automatically rebound to this candidate.\n`;
if (sourceTests) {
  const { total, passed, failed: sourceFailed } = sourceTests;
  if (
    ![total, passed, sourceFailed].every(
      (value) => Number.isInteger(value) && value >= 0,
    ) ||
    passed + sourceFailed !== total
  )
    throw new Error(
      "Source-test receipt must contain consistent nonnegative integer total/passed/failed counts",
    );
  sourceTestSection = `[Source-test receipt](${sourceTestFile}): **${passed}/${total} passed**, ${sourceFailed} failed. Declared source revision: \`${revision(sourceTests.sourceRevisionAtLaunch ?? sourceTests.sourceRevision)}\`. ${sourceMatches(sourceTests) ? "Its complete src/ hash envelope matches this native receipt." : "A complete matching src/ hash envelope is not established; keep its source coverage separate from this native run."}\n`;
}
const validMeans = scenarios
  .map((sample) => mib(sample.workingSetKiBSumMean))
  .filter(Number.isFinite);
let memorySection = `No celestial fresh-process memory receipt has been supplied at \`${memoryFile}\`. Earlier V3/V3.5 memory records remain historical and are not substituted for this environment.\n`;
if (memory) {
  const samples = memory.samples ?? [];
  const workingSets = samples
    .map((sample) => mib(sample.workingSetKiBSum))
    .filter(Number.isFinite);
  const phaseRows = (memory.phases ?? [])
    .map((phase) => {
      const cpus = samples
        .filter((sample) => sample.phase === phase.name)
        .map((sample) => sample.cpuReportedSum)
        .filter(Number.isFinite);
      const meanCPU = cpus.length
        ? cpus.reduce((sum, value) => sum + value, 0) / cpus.length
        : NaN;
      return `| ${cell(phase.name)} | ${n(phase.durationMs / 1000)} | ${cell(phase.drawSamples)} | ${n(mib(phase.firstWorkingSetKiBSum))} | ${n(mib(phase.lastWorkingSetKiBSum))} | ${n(mib(phase.deltaWorkingSetKiBSum))} | ${n(meanCPU)} |`;
    })
    .join("\n");
  memorySection = `[Separate memory receipt](${memoryFile}): ${n(memory.durationMs / 1000)} seconds, declared source revision \`${revision(memory.sourceRevisionAtLaunch)}\`. ${sourceMatches(memory) ? "Its src/ hashes match the native performance run." : "Its src/ hashes do not establish the same source; these are separate checkpoint observations, not current-candidate qualification."} The recorded screenshot count is ${cell(memory.conditions?.screenshotCount)} and recording flag is ${cell(memory.conditions?.recording)}. Sampled working-set sums start at ${n(workingSets[0])} MiB, peak at ${n(workingSets.length ? Math.max(...workingSets) : NaN)} MiB and end at ${n(workingSets.at(-1))} MiB. Shared pages may be counted repeatedly.\n\n| Phase | Seconds | Scene submissions including entry | First MiB | Last MiB | Delta MiB | CPU reported sum mean % |\n|---|---:|---:|---:|---:|---:|---:|\n${phaseRows}\n\nShort growth and partial recovery do not establish leak freedom or long-term stability. Entry/reconciliation draws in a memory-probe phase are distinct from the separately warmed steady-state Quiet/minimized verification samples. Neither zero scene submissions nor a lower working set proves zero CPU work or energy savings.\n`;
}
const content = `# Celestial Cinematic V3.5 performance evidence

This report qualifies the celestial scope before the later foreground-instrument addendum. Its captures, materials and measurements remain a historical baseline for that new scope; they must not be relabeled as verification of the later instrument implementation.

Native receipt: [${artifact}](${artifact}), captured ${report.capturedAt}, SHA-256 \`${createHash("sha256").update(bytes).digest("hex")}\`. Launch HEAD: \`${revision(report.sourceRevisionAtLaunch)}\`; the receipt's source and built-asset hashes identify the actual local candidate, including working-tree changes. **${report.checks.length - failed.length}/${report.checks.length} native checks passed**, ${failed.length} failed; **${scenarios.length} scenarios** were measured. Expected counts are never substituted for these observed results. No owner artistic acceptance or production qualification is implied.

${sourceTestSection}
Electron ${report.versions.electron}, Chromium ${report.versions.chrome}, Node ${report.versions.node}. Display ${report.display.size.width}×${report.display.size.height}, scale ${report.display.scaleFactor}, reported ${report.display.refreshRate} Hz. Final native content bounds ${report.window.width}×${report.window.height}. Every measured scenario explicitly records a released environment phase override; held-phase exploration images are excluded from real-time performance claims.

## Method and interpretation

The visible native-window lab uses synthetic working content and ordinary desktop background load. It continues rendering while another app has focus, preventing an unannounced blur-pause sample. Normal operation pauses on blur; native minimize, Ambient Off, Quiet and reduced motion are separately exercised. Scenario receipts preserve actual durations, state, workload and 1,200 ms warm-up. Screenshots precede measurement and are excluded from sample windows; retained captures and compositor/browser allocations can still affect memory. Recordings are separate and add capture/encoding overhead.

Callback intervals are scheduler observations. Scene submissions count coordinated Environment.render calls, each of which may contain several renderer passes. **Neither is presented FPS.** CPU values sum Electron-reported process percentages. Working-set sums may count shared pages multiple times and are neither unique resident memory nor VRAM. The 60 Hz / 120 Hz reference intervals are 16.67 / 8.33 ms; a requested submission cadence is not a physical display-mode or presentation qualification.

## Native workload samples

| Scenario | Callback samples | Callback p50 / p95 / p99 ms | Scene submissions | Submission p95 ms | CPU reported sum mean % | Working-set sum MiB |
|---|---:|---:|---:|---:|---:|---:|
${rows}

## Final-frame submission and geometry diagnostics

These are the **last rendered frame's snapshots** for each scenario, not means over its entire window. Renderer totals aggregate the sky, separately lit architecture and foreground passes, including shadow rendering, with renderer.info automatic per-pass resets disabled. The sky uses two batches when active. Reported star instances are submitted catalog instances, not a count of stars visibly resolved on the monitor. Architectural estimates describe selected composition geometry, including when its environment is hidden; they must remain separate from actual renderer submission counters and from memory measurements. Shadow-map dimensions are configuration, not VRAM consumption.

| Scenario | Total renderer draw calls | Total submitted triangles | Reported sky instances / visible | Sky batches | Potential architecture triangles / visible | Shadow map |
|---|---:|---:|---:|---:|---:|---|
${geometryRows}

## Historical named-workload comparison

### Original V3 baseline

${originalBaseline ? `The preserved V3 checkpoint was rebuilt and rerun before V3.5 work: [original baseline receipt](${originalBaselineFile}), captured ${originalBaseline.capturedAt}, ${originalBaseline.checks.filter((check) => check.passed === true).length}/${originalBaseline.checks.length} native checks. Its final content bounds were ${originalBaseline.window.width}×${originalBaseline.window.height}, display scale ${originalBaseline.display.scaleFactor}, reported ${originalBaseline.display.refreshRate} Hz. The nominal window/camera and same-named tier/transition scripts provide a direct historical reference. The celestial candidate adds a starfield, deeper ring, shadows, revised materials and richer synthetic reading content; desktop load and capture retention are uncontrolled. This is not a pixel-identical scene, an isolated effect benchmark or proof of better monitor presentation.` : "The original V3 baseline receipt is unavailable; no numerical V3 comparison is invented."}

| Scenario | V3 / celestial callback p95 ms | V3 / celestial submission p95 ms | V3 / celestial CPU reported sum mean % | V3 / celestial working-set mean MiB |
|---|---:|---:|---:|---:|
${originalComparisonRows}

### Pre-celestial V3.5 / 938 reference

${baseline ? `The preceding [938 candidate receipt](${baselineFile}) was captured ${baseline.capturedAt}, source \`${revision(baseline.sourceRevisionAtLaunch)}\`, with ${baseline.checks.filter((check) => check.passed === true).length}/${baseline.checks.length} native checks and ${baseline.scenarios.length} scenarios. Its scene predates the expanded sky, revised physical ring and shadow pass. Same-named scripts are useful references, but scene contents, capture retention and uncontrolled desktop load differ. These differences do not isolate one shader's cost or prove a presentation improvement.` : "The preceding 938 receipt is unavailable; no numerical comparison is invented."}

| Scenario | Before / celestial callback p95 ms | Before / celestial submission p95 ms | Before / celestial CPU reported sum mean % | Before / celestial working-set mean MiB |
|---|---:|---:|---:|---:|
${comparisonRows}

## Input, startup and memory limits

${report.inputFeedback.samples} programmatic DOM click-dispatch→coordinator samples: p50 ${n(report.inputFeedback.p50)} ms, p95 ${n(report.inputFeedback.p95)} ms, maximum ${n(report.inputFeedback.max)} ms. This excludes OS input injection, monitor presentation and optical latency. Native module evaluation→local renderer load is ${report.startup.moduleToRendererLoadMs} ms, not OS cold startup. Video encoder rate and encoded packet PTS are not presented application FPS.

Across the capture-heavy benchmark's scenario-level working-set means, the first is ${n(validMeans[0])} MiB, the maximum is ${n(validMeans.length ? Math.max(...validMeans) : NaN)} MiB, and the last is ${n(validMeans.at(-1))} MiB. These are means of separate workloads, not a continuous unique-resident-memory trace. Retained capture/browser allocations, changing bounds and shared-page accounting complicate attribution.

## Separate fresh-process probe

${memorySection}
## Outstanding qualification and storage

[Tool discovery](evidence-v3-5/performance-tools.json) found WPR/WPA and NVIDIA tooling, but PresentMon was absent from PATH and matching NVIDIA memory entries returned nonnumeric values. Tool availability is separate from a decoded, application-attributed timing, VRAM or energy trace. Physical 60 Hz, attributable GPU utilization/memory, power/thermals, long-run memory stability, mixed-DPI/multi-display, assistive-technology and sustained owner motion comfort remain unqualified unless later evidence explicitly supplies them. Functional checks do not award an artistic pass to the starfield, ring or lighting.

ReserveGuard enforces the task's instruction/monitoring policy with separate 30 GiB floors for C: and D:. Each native pass admits up to 256 MiB, including a capped 190 MiB PNG writer and profile/report headroom; raw motion frames are downscaled and labeled separately from full native stills. Broader local writer allowances and rechecks remain necessary. This is not an OS quota and cannot stop unrelated apps, cloud jobs or processes that did not load the rule. Retained evidence and unrelated user data were not deleted to create space.
`;
const output = "PERFORMANCE-CELESTIAL-V3.5.md";
await fs.writeFile(path.join(root, output), content);
console.log(
  JSON.stringify({
    report: output,
    evidence: artifact,
    checks: report.checks.length,
    failed: failed.length,
    scenarios: scenarios.length,
  }),
);
