# Local comparison control

This interface supports the Aetherwake visual-host comparison protocol. It is
opt-in, uses synthetic fixtures, and writes raw receipts only to the supplied
local directory. Do not commit that directory. The normal app mode and the
existing `--benchmark` mode remain separate.

## Release build and launch

From this directory, run `npm ci`, then `npm run package:release`. The Windows
x64 executable is `.release/AerynthElectronLab-win32-x64/AerynthElectronLab.exe`.
The package uses Electron 38.4.0, production Vite assets, closed DevTools, an
asar archive, and a separate comparison profile. `.release/` and `.runtime/`
are ignored by Git. The packaged `resources/app.asar/dist-electron/build-manifest.json`
records file SHA-256 values, an aggregate build hash, the source commit, and
whether the source was dirty when built. Record the executable and asar hashes
separately for a trial. Build again after a source commit so `sourceDirty` is
false and `sourceCommit` identifies the tested candidate.

Launch with `--comparison-control --comparison-dir=<absolute-local-directory>`.
The caller supplies a fresh local directory for each process launch. A request
is a UTF-8 JSON file named `<id>.request.json`, written to a temporary file
and atomically renamed into place. Its body is `{ "id": "<id>", "command":
{ "op": "status" } }`. IDs are 1–64 ASCII letters, digits, hyphens, or
underscores and cannot be reused in a launch. The app writes
`<id>.response.json`. The included client handles atomic writes and response
waiting:

```powershell
node scripts/comparison-client.mjs $localDir status-01 '{"op":"status"}'
node scripts/comparison-client.mjs $localDir start-01 '{"op":"frameStart","scenario":"S4","refreshHz":165}'
node scripts/comparison-client.mjs $localDir stop-01 '{"op":"frameStop"}'
```

The app also writes `electron-<browser-pid>.events.jsonl` with process start,
first native show, first renderer callback, and command markers. `status`
returns actual outer and client bounds, display scale and reported refresh,
process roles/PIDs, DevTools state, build manifest, and renderer fixture state.
The renderer state confirms 12 blocks, 2,000 messages, 1,000 events, 200
particle sources, eight filaments, the current rendered source counts, quality,
motion policy, visibility, and canvas draw count. The packaged main window
requests 1440×920 logical outer pixels and a detached window requests
460×720; record actual content bounds because native frame thickness differs.

## Scenario schedule

The client reads the coordinator's `scenario-config.json` without copying its
machine-specific path into the repository. Inspect the plan before a timed run:

```powershell
node scripts/comparison-client.mjs $localDir plan-s4 plan:S4 $scenarioConfigPath
node scripts/comparison-client.mjs $localDir trial-s4 schedule:S4 $scenarioConfigPath
```

The scheduler waits 30 seconds per scenario and reports each planned and
actual dispatch time. `S4` schedules 20 chat scroll positions at 1,500 ms
spacing, plus 60 messages at 100 ms spacing. `S5` schedules 60 events at
100 ms spacing. These are independent monotonic schedules; the actual gaps
and every app response must be kept. `stream-messages` and `stream-events`
offer the 60-at-100-ms part alone for a bounded probe. `interrupt` expands and
collapses one block with a nominal 100 ms gap. Reset the renderer
before each trial, then set `cinematic`, reduced motion false, and
`fixed60`; start/stop frame capture outside the scenario schedule. The fixed
60 Hz cadence affects only the comparison atmosphere in cinematic mode. It
does not change geometry, the 200 particles, eight filaments, or the display's
native 165 Hz renderer callback cadence. `setAtmosphereCadence` can switch to
`native` for a separate nonpooled run. Adaptive quality is disabled in
comparison mode.

| Scenario | Scheduled actions and limits |
| --- | --- |
| S2 | Reset to baseline idle scene. |
| S3 | Vela working. |
| S4 | Scroll and append schedule above. |
| S5 | Event append schedule above. |
| S6 | Select message 1001; expand conversation; begin activity expansion at 10 s and collapse 300 ms later; nudge conversation; resize **main native window** to 1420×900; scripted block swap. Native resize is not a direct block resize, scripted swap is not pointer drag, and the control nudge is not a physical key press. Capture those physical actions separately or mark the matched latency gap. |
| S7 | Idle, working, attention required, unavailable, working, idle at 0, 5, 10, 15, 20, 25 s. |
| S8 | Open activity in a detached native window, focus it, close it, reopen it at 0, 8, 16, 24 s. Opening already detaches the block; there is no separate second detach command. |
| S9a | External operator must occlude/background the main window. Hiding it is not equivalent to occlusion. |
| S9b/S9c | Minimize/restore main window at scenario start. |
| S10a/S10b | Reduced motion; then normal motion with efficient quality, in separate trials. |

`S0`, `S1`, `S11`, and `S12` require the coordinator's external launch,
sampler, window, or synthetic-load orchestration. The client does not run
those trials. The controller supports `openWindow`, `closeWindow`,
`focusWindow`, `setWindowBounds`, `hideWindow`, `minimizeWindow`,
`restoreWindow`, `quit`, `scrollChat`, `selectMessage`, `appendMessages`,
`appendEvents`, `burstEvents`, `swapBlocks`, `nudgeBlock`, `expandBlock`,
`collapseBlock`, `setVela`, `setQuality`, `setReduced`, `frameStart`,
`frameStop`, `state`, and `reset`. Requests are schema checked and serialized.
There is no arbitrary renderer-to-Node command bridge.

## Timing and interpretation

Renderer action receipts use `performance.timeOrigin` plus `performance.now`
milliseconds for dispatch, React layout-effect commit, and the next renderer
`requestAnimationFrame` callback. This last interval is a **software proxy**;
it is not an OS present or physical input-to-photon latency. Native receipts
use `process.hrtime.bigint()` nanoseconds and have no next-frame marker. UTC
wall timestamps help align logs but are not a shared monotonic clock. A
`frameStop` response contains summary percentiles, stutter count using twice
the reported refresh interval, missed-refresh estimate, callback count, and
canvas draws during capture. Full callback intervals are saved in
`<id>.frames.json` and SHA-256 hashed. Split a 30-minute soak into five-minute
captures; a capture stops retaining intervals after 100,000 and reports the
dropped count.

Use the coordinator's OS process-tree sampler as the primary CPU/memory/GPU
measurement. Use PID-filtered PresentMon on the **GPU process PID discovered
for each launch** for displayed frames. Electron renderer callbacks, canvas
draws, and presented frames are different quantities. Capture only the target
PID. If PresentMon yields no target rows, report presented FPS and OS input
latency as unavailable. Do not infer input-to-photon latency from callback or
present intervals alone. Keep local traces outside the public PR.
