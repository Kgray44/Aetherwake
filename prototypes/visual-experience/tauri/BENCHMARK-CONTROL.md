# Local comparison controls

These controls support a Tauri/Electron comparison without choosing a host in advance. They produce renderer and target-process evidence only. The first visual pilot is preserved at commit `7bfaec1`; later commits add instrumentation and a separately identified 60-item append fix. Historic screenshots and short pilot measurements in `EVALUATION.md` are **not** comparable trials.

## Build and preconditions

Use `npm ci --no-audit --no-fund`, `npm test`, and `npm run desktop:build` on Windows with Rust MSVC, C++ Build Tools, and WebView2. The Tauri build uses Cargo's release profile and Vite's production bundle. `bundle.active: false` builds an executable, not an installer. Keep DevTools closed. Record `git rev-parse HEAD` and the SHA-256 of `src-tauri/target/release/aerynth_visual_lab.exe` for every measured build. The fixture seed is `20261101` and initial source counts are 12 blocks, 2,000 messages, 1,000 events, 200 particles, and 8 filaments.

The main window's **Mode → Comparison control / local script** panel offers the same controls as `window.__AERYNTH_BENCH__`. The stream window has its own **Play reproducible burst** and **Export local trace** controls. The JavaScript API is for an approved renderer automation harness; the UI works without DevTools. Both renderers have separate clock origins and export separately.

```js
const bench = window.__AERYNTH_BENCH__;
bench.prepareFixedCinematic();
bench.startFrameCapture();
await bench.runScenario('S6');
const frames = bench.stopFrameCapture();
const evidence = bench.snapshot();
```

`prepareFixedCinematic()` restores the 12-block layout, the 2,000-message base, idle Vela, top-of-page position, 200-particle Cinematic tier, full motion, and a comparison-only 60 Hz **atmosphere canvas draw target**. The renderer still receives native `requestAnimationFrame` callbacks at display cadence and draws on scheduled 60 Hz deadlines; late draws are counted rather than silently replaced. The default native atmosphere cadence is restored by **Restore native atmosphere cadence** or `bench.setCadence('native')`. The stream-window version restores its 1,000-event base and clears its trace. No adaptive tier controller is active in this candidate; Efficient and reduced motion are explicit separate settings. CSS Vela animations remain browser-driven and are a separate cadence asymmetry to report. In a controlled comparison, perform the same setup on both hosts and keep the quality tier fixed for each trial.

## Scripted action schedule

All offsets below are milliseconds relative to that renderer's scenario start. Each action receives a stable ID; the trace records intended and actual offset and schedule slip. The in-app action runner is bounded to a few seconds. The coordinator owns the longer settle, 30-second steady windows, repeated trials, and soak.

| Scenario | Script |
| --- | --- |
| S2 | Vela idle at 0; leave the main home scene visible for external steady-state timing. |
| S3 | Vela working at 0; leave atmosphere and Vela active for external timing. |
| S4 | Scroll 20 evenly spaced indices from 0 through 1999 at 1,500 ms intervals (0 through 28,500 ms); concurrently append 60 deterministic synthetic messages at 100 ms intervals (0 through 5,900 ms). |
| S5 | In the separate stream renderer, append 60 deterministic synthetic events at 0 through 5900 in 100 ms steps. Each run restores the 1,000-event base first. |
| S6 | Select resource at 0; focus-expand at 5,000; close, reopen, and immediately close to interrupt at 10,000; synthetic Alt+Right keydown at 15,000; Widen/Compact at 20,000; synthetic DOM drag/drop at 25,000. The keyboard and drag actions are dispatched DOM events, not hardware inputs. |
| S7 | Idle 0; Working 5,000; Attention required 10,000; Unavailable 15,000; Working 20,000; Idle 25,000. |
| S8 | In native Tauri: open activity at 0; detach a block at 8,000; close activity at 16,000; reopen activity at 24,000. Async native operations can overrun intended offsets, which the trace exposes. Detached block remains open for external trial cleanup. |
| S10 | Efficient and reduced motion are separate explicit controls. |

S1 startup, S9 visibility/minimize/restore, S11 soak, and S12 Synthetic Gaming Load require external coordination. S2/S3/S5 finish scripted actions before the 30-second external window closes; the harness must hold the scene. Do not substitute in-app script durations for the protocol's measured durations. This candidate has **Widen/Compact**, not a freeform pixel resize handle; report that as a functional asymmetry. The 60 appended rows are deterministic local fixture extensions, not network streaming. The base fixture counts remain unchanged before each run.

## Renderer trace interpretation

Each action record includes UTC, `performance.timeOrigin`, monotonic `dispatchMs`, `handlerStartMs`, `stateCommitMs`, `nextFrameMs`, status, and any missing-frame reason. Dispatch means the in-app script invoked the action; it is **not physical input timing**. State commit is when the synchronous DOM change or awaited native call returns. The next `requestAnimationFrame` callback is a **software response proxy**, not a display present or photon timing. Cross-window values need external clock correlation before comparison. Hidden windows may have no callback; a missing callback is a gap, not zero latency.

`startFrameCapture()` and `stopFrameCapture()` record up to 12,000 `[callbackTimeMs, intervalMs]` pairs and 12,000 separate `[canvasDrawTimeMs, intervalMs]` pairs in the main renderer. Exports include callback and draw counts, median/p95/p99/max intervals, nominal-target missed-refresh estimate, and overflow flags. `targetCanvasDraws` and `canvasDrawShortfallEstimate` are estimates against elapsed time at 60 Hz while the scene is visible and active; neither is a display-present count. Captures across visibility, quality, or motion changes should be split into separate windows. Both interval sets are renderer observations, not presented frames. A capture spanning a cap is explicitly marked and must not be treated as a complete distribution. The stream renderer has no atmosphere loop, so its action trace is useful but its canvas frame capture is empty.

The UI export downloads JSON locally. Keep it, process traces, PresentMon CSV, WPR ETL, run commands, and hashes in the comparison's **local** evidence directory outside this public repository. Do not commit raw system traces, user activity, or process command lines.

## Target-process tree sampler

`scripts/observe-tree.ps1` samples a specified root and its descendants for 1–60 seconds at 250–1,000 ms intervals. It records per-process roles, CPU-time deltas, private bytes, working sets, tree sums, schedule offset, sampler work time, and gaps. The first CPU delta is null by design. Summed working sets can count shared pages more than once. WebView2 process roles are enriched after sampling so role lookup cannot distort the timed loop. The script rejects output paths inside the repository.

```powershell
$rawDir = Join-Path $env:LOCALAPPDATA 'Temp\AetherwakeVisualBenchmark_20261101'
./scripts/observe-tree.ps1 -RootProcessId 12345 -Seconds 30 -IntervalMs 1000 -OutFile (Join-Path $rawDir 'tauri-S2-tree.json')
```

GPU engine and GPU process memory CIM polling is **optional** via `-IncludeGpuCounters`; it increases sampler overhead on this machine. An empty or unavailable GPU result is labeled, not silently interpreted as zero. Prefer a separately validated, PID-filtered present trace for displayed frames. The coordinator must run storage reserve checks and exclusive measurement scheduling before any long capture.
