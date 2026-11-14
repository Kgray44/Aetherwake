# Tauri Liquid Intelligence pilot · evaluation

> This evaluation describes the initial `7bfaec1` pilot. Later comparison controls and the 60-item append fix are documented in [BENCHMARK-CONTROL.md](BENCHMARK-CONTROL.md); no controlled Tauri/Electron result is claimed here.

## Outcome

A Windows release executable launched and displayed the Aerynth scene. It opened two actual native windows with different dimensions. The home, Vela controls, workspace, conversation, stream, detachable card, and performance lab were exercised in the native app. This is a credible visual candidate for further testing, not a host selection or release recommendation.

All app content is local and synthetic. The seeded fixtures have exactly 12 workspace blocks, 2,000 messages, 1,000 events, 200 source particles, and 8 source filaments (`20261101`). Balanced and Efficient draw fewer particles from the same set. No model reasoning, real agent status, or live Codex connection is implied.

## Visual evidence

These are captures of the running Windows executable, not design mockups:

| Surface | Capture |
| --- | --- |
| Main home scene and approved Aerynth mark | [native-home.png](evidence/native-home.png) |
| Workspace, including a widened resource | [native-workspace.png](evidence/native-workspace.png) |
| Secondary Intelligence Stream window | [native-stream.png](evidence/native-stream.png) |
| Detached workspace block in its own native window | [native-detached.png](evidence/native-detached.png) |

The mark is loaded from the approved master asset through Vite's public directory. The repository master was not edited. The Windows `.ico` is a technical derivative for the app icon; its small-size visual treatment has not been separately approved.

## Native interaction observations

On Windows 11 Home, the executable opened a 1440×920 main window and a 460×720 activity window. A card detached into a third native window. Closing the activity window and invoking **Stream** recreated it. A widened block remained widened after process restart, showing local layout persistence. Focus and immediate Escape returned to the workspace without leaving a focus layer. Rapid Working → Attention required Vela input ended in the Attention required label and state signal, then Idle restored the calm state. These are direct observations, not an automated UI regression suite.

The native main and stream window handles both reported 120 DPI (125% scaling) during the test. The pilot was usable at that scaling on the available display. Moving between monitors with different scale factors, restoring exact window geometry, and unplug/replug behavior were not tested. Keyboard navigation was exercised through focus/Escape and code paths for Alt + arrow movement; a full accessibility audit remains open.

The reduced-motion control was exercised in the native app. The bounded runner's reduced-motion scenario observed zero ambient animation callback samples. CSS also removes transitions and animations under the explicit toggle or OS `prefers-reduced-motion`. A fast focus interruption was tested; sustained repeated interruptions and assistive-technology review remain open.

## Renderer measurements

The native executable ran the in-app four-scenario benchmark. Each scenario was bounded to about 2.2 seconds. [Raw measurements](evidence/native-benchmark.json):

| Scenario | Samples | Median | p95 | p99 | Estimated misses | Nominal target |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Animated · Cinematic | 363 | 6.1 ms | 6.2 ms | 6.2 ms | 0 | 16.67 ms |
| Animated · Efficient | 27 | 78.8 ms | 78.9 ms | 78.9 ms | 0 | 83.33 ms |
| Idle still · canvas paused | 0 | n/a | n/a | n/a | 0 | 16.67 ms |
| Reduced motion | 0 | n/a | n/a | n/a | 0 | 16.67 ms |

These are `requestAnimationFrame` callback intervals in one WebView2 renderer, not presented frames or GPU latency. A zero sample count means the atmosphere loop was stopped; the percentile is undefined. Misses are estimated by comparing intervals with a tier's nominal target. The 6.1 ms cinematic median likely reflects this display's high refresh cadence; display refresh was not independently measured. The idle-still case is a deliberate pause state within the benchmark. Normal visible idle Vela presence still animates the atmosphere. Hidden/minimized renderer timing could not be read reliably from the foreground UI after minimization; the scheduler does stop when `document.visibilityState` becomes hidden, but actual WebView2 hidden behavior needs external tracing.

## Process observations

The bounded PowerShell sampler measured only the Tauri host process, not WebView2 child CPU/GPU use. Values below summarize [foreground](evidence/process-foreground.json), [benchmark](evidence/process-benchmark.json), and [minimized](evidence/process-minimized.json) traces; CPU is one-core normalized, and working set is an average of host-process samples.

| Trace | Duration | Mean host CPU | Peak host CPU | Mean host working set |
| --- | ---: | ---: | ---: | ---: |
| Foreground | 5 s | 1.01% | 6.05% | 44.3 MiB |
| Benchmark | 8 s | 1.80% | 9.13% | 39.0 MiB |
| Both native windows minimized | 5 s | 4.94% | 11.83% | 39.5 MiB |

The minimized host sample is higher than the other two short samples, so these data **do not establish idle resource savings**. One read-only process-tree snapshot found the host plus seven WebView2 descendants with 640.4 MiB of summed working sets, but that sum can double-count shared pages and was not a time series. No GPU memory, GPU time, power draw, thermal response, or display-present data was captured. The benchmark and process sampler should be repeated with Windows Performance Recorder/PresentMon and child-process attribution before any performance claim.

## Environment and checks

- Windows 11 Home, version 10.0.26300; AMD Ryzen AI 7 350 with Radeon 860M; NVIDIA GeForce RTX 5070 Laptop GPU also present. The active GPU used by WebView2 was not determined.
- Rust stable MSVC (`cargo 1.99.1`), Visual Studio C++ Build Tools, Node/npm, Tauri 2, Vite 7, local WebView2 runtime.
- `npm test`: 2 deterministic fixture tests passed.
- `npm run build`: TypeScript validation and Vite production build passed.
- `npm run desktop:build`: native Windows release compile passed; `src-tauri/target/release/aerynth_visual_lab.exe` launched. Bundling is disabled, so no MSI/NSIS package was built or tested.
- Source-bound governance review used AGENTS.md, the Constitution, and applicable Charters 01, 02, 13, 14, 15, and 16. Governance Context Router V1 returned relevant routes. V2's context CLI failed with `Cannot read properties of undefined (reading 'some')`; the applicable source sections were read directly. This pilot does not claim governance or owner acceptance.

## Next decisions

1. Test on a second monitor and at 100%, 150%, and mixed DPI, including detach/reopen and saved-window placement.
2. Run a longer, repeatable performance protocol with all WebView2 children, present timing, GPU, power, and thermal traces. Establish an actual background-idle budget; add automatic idle suspension if the visible atmosphere remains too costly.
3. Review contrast, keyboard order, focus recovery, reduced-motion transitions, screen-reader output, and icon legibility with product and accessibility owners.
4. If the visual direction is accepted, isolate scene tokens and motion contracts for reuse. Keep the Tauri host decision open until comparison with other candidate hosts and owner review.
