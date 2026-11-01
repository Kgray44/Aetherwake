import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
if (!process.argv[2])
  throw new Error(
    "Pass the evidence directory explicitly, e.g. evidence-v3-5/review-final",
  );
const relative = process.argv[2].replaceAll("\\", "/");
if (!relative.startsWith("evidence-v3-5/") || relative.includes(".."))
  throw new Error("Expected a V3.5 evidence directory inside this prototype");
const report = JSON.parse(
  await fs.readFile(path.join(root, relative, "verification.json"), "utf8"),
);
const baseline = JSON.parse(
  await fs.readFile(
    path.join(root, "evidence-v3-5/baseline/verification.json"),
    "utf8",
  ),
);
const n = (v) => (Number.isFinite(v) ? v.toFixed(2) : "unavailable");
const rows = report.scenarios
  .map(
    (s) =>
      `| ${s.name} | ${s.callbackSamples} | ${n(s.callbackMs.p50)} / ${n(s.callbackMs.p95)} / ${n(s.callbackMs.p99)} | ${s.drawSamples} | ${n(s.drawMs.p95)} | ${n(s.cpuReportedSumMean)} | ${n(s.workingSetKiBSumMean / 1024)} |`,
  )
  .join("\n");
const compare = baseline.scenarios
  .filter((s) => /balanced-active|cinematic-transition|efficient-/.test(s.name))
  .map((before) => {
    const after = report.scenarios.find((s) => s.name === before.name);
    return `| ${before.name} | ${n(before.callbackMs.p95)} / ${n(after?.callbackMs.p95)} | ${n(before.drawMs.p95)} / ${n(after?.drawMs.p95)} | ${n(before.cpuReportedSumMean)} / ${n(after?.cpuReportedSumMean)} |`;
  })
  .join("\n");
const failed = report.checks.filter((c) => !c.passed);
const content = `# Cinematic V3.5 performance evidence

Native run: ${report.capturedAt}. Electron ${report.versions.electron}, Chromium ${report.versions.chrome}, Node ${report.versions.node}. Display ${report.display.size.width}×${report.display.size.height}, scale ${report.display.scaleFactor}, reported ${report.display.refreshRate} Hz. Final content bounds ${report.window.width}×${report.window.height}. Source receipt: [verification.json](${relative}/verification.json). ${report.checks.length - failed.length}/${report.checks.length} native checks passed; ${failed.length} failed. No owner acceptance is implied.

## Method and interpretation

This is a visible native-window lab using synthetic working content and ordinary desktop background load. It keeps rendering when another desktop app has focus so measurement does not silently become a blur-pause sample. Normal npm start pauses on blur; minimize, Quiet, Ambient Off and reduced motion are separately exercised. Each scenario records its actual duration, state, 1,200 ms warm-up, workload, and counters in the JSON. Captures precede measurement and are excluded from the sample intervals, but retained capture/compositor allocations can affect memory.

Callback intervals describe scheduler callbacks. Submission intervals describe renderer draws. **Neither is presented FPS.** CPU is Electron's sum of reported process percentages. Working-set sums can count shared pages more than once; they are neither unique resident memory nor VRAM. Efficient intentionally submits less often. No screenshots or recording are taken during the measured scenarios. Repeated short windows and a separate 90-second fresh-process probe are exploratory; they do not establish leak freedom, sustained thermal comfort, energy, or full production performance.

The 60 Hz and 120 Hz reference budgets are 16.67 ms and 8.33 ms. Balanced requests a 60-submission cadence during active use, Efficient a lower cadence, and Cinematic follows the active callback opportunity. These policies are not physical display-mode or presentation qualifications. A proposed review threshold is a stable, responsive Balanced interaction with no unexplained regressions against the same named V3 workloads, zero unnecessary steady-state draws in Quiet/Ambient Off/reduced/minimized conditions, and no lost user state. Production presentation and memory thresholds remain open pending attributable measurements.

## Native workload samples

| Scenario | Callback samples | Callback p50 / p95 / p99 ms | Submissions | Submission p95 ms | CPU reported sum mean % | Working-set sum MiB |
|---|---:|---:|---:|---:|---:|---:|
${rows}

## Matched named V3 comparison

V3 was rebuilt from the clean local checkpoint and rerun before implementation: ${baseline.capturedAt}. The same window/camera and named tier/transition scripts provide a useful reference. V3.5 now explicitly seeds these named samples to the architectural ring workspace. Its geometry, ribbon and synthetic reading workload are richer; desktop background load and capture retention are uncontrolled. This comparison cannot isolate the cost of one shader or prove that a callback difference is a presentation improvement.

| Scenario | V3 / V3.5 callback p95 ms | V3 / V3.5 submission p95 ms | V3 / V3.5 CPU reported sum mean % |
|---|---:|---:|---:|
${compare}

## Input, startup, and evidence limits

${report.inputFeedback.samples} programmatic DOM click-dispatch→coordinator samples: p50 ${n(report.inputFeedback.p50)} ms, p95 ${n(report.inputFeedback.p95)} ms, max ${n(report.inputFeedback.max)} ms. This excludes OS input injection, presentation and optical latency. Separate native-input review establishes only the exercised input behavior.

Native module evaluation→renderer load: ${report.startup.moduleToRendererLoadMs} ms; not OS cold startup. Build hashes and capture dimensions/state are retained in the receipt. Recording encoder rate is never used as application FPS.

Tool discovery found WPR/WPA and NVIDIA tooling, but PresentMon was unavailable and matching NVIDIA memory entries returned nonnumeric values. No decoded application-attributed present, VRAM or energy trace was obtained. A global GPU total would not fill those gaps. [Tooling receipt](evidence-v3-5/performance-tools.json) records availability separately from measurements. Physical 60 Hz, attributable GPU utilization/memory, power, mixed-DPI/multi-display, prolonged load and sustained owner motion comfort remain unverified.

## Storage discipline

The local work uses ReserveGuard with separate 30 GiB floors for C: and D:. Verification admits up to 256 MiB including its capped 190 MiB PNG writer and profile/receipt headroom; the task also uses a broader bounded local allowance. The guard is an instruction/monitor, not an OS quota. It cannot stop unrelated applications, cloud jobs, or local processes that did not load the rule. No user files, games, unique history, unrelated work or retained evidence were deleted.
`;
await fs.writeFile(path.join(root, "PERFORMANCE-V3.5.md"), content);
console.log(
  JSON.stringify({
    report: "PERFORMANCE-V3.5.md",
    checks: report.checks.length,
    failed: failed.length,
  }),
);
