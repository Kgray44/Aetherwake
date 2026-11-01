# Native performance evidence

Captured 2026-11-01T18:46:18.940Z. Electron 45.2.1, Chromium 156.0.8078.75, Node 24.22.1. Display 2048×1280, scale 1.25, reported 165Hz; final content bounds 1600×1001. Normal desktop background applications remained present.

## Method

Reproduce with npm run verify after a locked install/build. Each active sample has a 1200 ms warm-up and approximately 4.5 s measurement. Balanced/Efficient repeat twice with the same workspace and synthetic Working presence. Cinematic-active uses that same scene once. Cinematic-transition repeats twice with scripted expansion/reversal approximately every 500 ms throughout measurement. Idle first waits 13.5 s beyond the last interaction, then keeps expressive ambient motion at a lower cadence. Ambient-off and Quiet are separate stillness probes. Native-minimized measures the actual minimized window. The isolated native verification profile keeps a visible renderer alive despite desktop focus changes, with Chromium background throttling disabled; normal mode still pauses on blur. This prevents activity in the coordinating app from turning a measurement into an unrelated background-pause sample. No screenshots are captured during these measured intervals. Measurement follows the capture-heavy functional journey in the same process; retained browser/compositor allocations can influence the working sets. This is not a fresh normal-profile memory baseline.

CPU uses Electron app-metrics across its processes, primed before sampling and read every 500 ms; values are sums of reported CPU percentages. Working sets are reported KiB summed across those processes, converted to MiB below; shared pages can be counted more than once. This is not unique resident memory, VRAM, or an isolated system benchmark.

Callback intervals, actual renderer submission counts, and draw intervals are distinct. **None is presented FPS.** A zero callback count has no defined percentile; unavailable is intentional. Efficient intentionally renders less often. The higher callback intervals in Efficient do not mean a slow input path; active interaction/transition remains immediately scheduled.

| Scenario | Callback samples | Callback p50 / p95 / p99 ms | Renderer submissions | Submission interval p95 ms | CPU reported sum mean % | Working-set sum MiB |
|---|---:|---:|---:|---:|---:|---:|
| balanced-active-1 | 744 | 6.10 / 6.20 / 6.20 | 271 | 18.30 | 4.96 | 1163.0 |
| cinematic-transition-1 | 426 | 12.00 / 18.20 / 18.30 | 426 | 18.20 | 11.80 | 1332.3 |
| efficient-1 | 78 | 60.64 / 78.80 / 78.90 | 68 | 78.80 | 0.92 | 1358.4 |
| balanced-active-2 | 743 | 6.10 / 6.20 / 6.20 | 270 | 18.30 | 4.67 | 1279.3 |
| cinematic-transition-2 | 403 | 12.10 / 18.20 / 24.30 | 403 | 18.20 | 11.68 | 1357.8 |
| efficient-2 | 80 | 60.60 / 78.80 / 78.90 | 68 | 78.80 | 1.17 | 1335.8 |
| cinematic-active | 743 | 6.10 / 6.20 / 6.20 | 743 | 6.20 | 5.39 | 1270.5 |
| integrated-focus-stream | 417 | 12.10 / 18.30 / 24.20 | 270 | 24.40 | 12.26 | 1368.3 |
| focused-native-resize | 704 | 6.10 / 6.30 / 18.10 | 272 | 18.30 | 11.49 | 1353.6 |
| ambient-idle | 238 | 22.20 / 30.30 / 30.40 | 120 | 38.00 | 1.94 | 1293.2 |
| ambient-off | 0 | unavailable / unavailable / unavailable | 0 | unavailable | 0.05 | 1277.6 |
| quiet-static | 0 | unavailable / unavailable / unavailable | 0 | unavailable | 0.02 | 1103.3 |
| native-minimized | 0 | unavailable / unavailable / unavailable | 0 | unavailable | 0.02 | 1089.6 |

## Input and startup

16 programmatic DOM click-dispatch→next-coordinator-callback samples: p50 3.20ms, p95 3.80ms, maximum 3.80ms. This excludes OS pointer injection, display presentation and optical response. Separate native mouse/keyboard smoke tests establish the input path's functionality, not its latency.

Native module evaluation→local renderer load: 625ms. This is not OS cold startup.

## Qualification limits

No physical 60 Hz display-mode comparison, attributable physical VRAM, present timing, power/thermal trace, long-history scalability, mixed-DPI/display-disconnect test, automatic game detection, or prolonged soak was established. Higher-refresh observations come from this 165 Hz display; Balanced's 60 submission target does not establish a 60 Hz monitor run. The short verification journey and repeated windows do not establish universal smoothness, leak freedom, or energy savings.

GPU engine/process-memory diagnostics, when obtained, are in evidence/gpu-probe.json and were collected separately. Engine sums are not whole-GPU utilization; process memory counters have documented limitations ([Microsoft](https://learn.microsoft.com/en-us/troubleshoot/windows-client/performance/gpu-process-memory-counters-report-wrong-value)). A separate global NVIDIA snapshot showed 9% utilization and 1515 MiB in use; it was not attributable to this application and is not an app performance result.

## Integrity

The JSON receipt preserves all checks, distributions, conditions, quality-policy state, scene submission/geometry counts, motion frame timestamps and unavailable fields. Build assets: graphics-BmPJwi0n.js, index-C7YuXJuC.js, index-CJsB2Ye5.css. Captures/metrics are local prototype evidence; neither a host-selection verdict nor owner acceptance.


## Addendum workload and comparison

Integrated-focus-stream runs the visible synthetic event stream, Vela expression, atmospheric response and repeated conversation focus/reversal together. Focused-native-resize alternates the real native content bounds between 1280×800 and 1600×1000 during focused work. These are additional stress samples, not frame-presentation traces.

Pre-addendum receipt: 2026-11-01T18:18:26.282Z; current receipt: 2026-11-01T18:46:18.940Z. The same named tier/workspace and scripted transition samples are compared below. The conversation now contains a real DOM message stream/composer, so the expanded workload is richer; background desktop load was not isolated. Differences cannot be attributed solely to one visual refinement.

| Scenario | Before callback p95 ms | After callback p95 ms | Before / after submissions |
|---|---:|---:|---:|
| balanced-active-1 | 6.20 | 6.20 | 275 / 271 |
| cinematic-transition-1 | 12.20 | 18.20 | 651 / 426 |
| efficient-1 | 78.80 | 78.80 | 69 / 68 |
| balanced-active-2 | 6.20 | 6.20 | 275 / 270 |
| cinematic-transition-2 | 12.20 | 18.20 | 653 / 403 |
| efficient-2 | 78.80 | 78.80 | 69 / 68 |

The source preserves the graphics chunk warning (~521 kB minified), the diagnostic GPU-counter limitations and every unavailable measurement. Physical 60 Hz, presented timing, attributable VRAM and sustained thermal/energy acceptance remain open.
