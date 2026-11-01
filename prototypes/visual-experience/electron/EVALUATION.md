# Electron visual lab evaluation

**Candidate status:** Executable, locally demonstrated prototype. Electron has **not** been selected as Aerynth's desktop foundation. This report does not compare Electron with Tauri because no equivalent Tauri run was obtained here.

**Evidence date:** 2026-11-01. All displayed conversations, Vela states, agent nodes, timeline entries, and Intelligence Stream events are visibly labeled fixtures or local demonstrations. No Codex backend, live agent execution, or production telemetry is connected.

## Governance and scope

The governance registry declares Constitution 00 established and Charters 01, 02, 13, 14, 15, and 16 published pending owner acceptance. The deterministic router selected 00/01/02/13/14/15 for this task; 16 was added for delivery. Governance Context Router V2 was invoked with the Electron path and `--full`, but both invocations exited with `Cannot read properties of undefined (reading 'some')`. Relevant charter sections were read directly as a fallback. No governance source or other prototype was changed. Charter drafts informed the experiment; they are not claimed as accepted binding authority.

The lab keeps its package, source, generated fixture, runtime profile, evidence, and tests inside `prototypes/visual-experience/electron/`. The master mark was copied without editing; the lab copy has SHA-256 `89bd614656667f1178603afa3a23debc5a4e96fe61ccfbb957d7ef27cbf76658`.

## What runs

| Area | Demonstrated implementation | Limit |
|---|---|---|
| Home and materials | Distinct dark environment, official mark, layered glass surfaces, restrained light, selectable text | Visual taste and contrast require owner/accessibility review |
| Atmosphere | Seed 20261101, 200 canvas particles, eight filaments; one canvas loop outside React renders | Canvas 2D, not a shader/instanced GPU system |
| Workspace | 12 heterogeneous blocks, header drag/drop, keyboard move controls, type-specific controls, grid persistence in localStorage | Freeform layout, resize handles, shared cross-window live state are absent |
| Conversation | 2,000 deterministic messages with selectable DOM text and virtual windowing | Fixture only; no actual conversation backend |
| Activity | 1,000 timestamped fixture events and reproducible +60 bursts, explicitly labeled synthetic | No observed agent event source or replay |
| Vela | Idle, working, attention required, unavailable fixture states with visible text cues | No real assistant state or task execution |
| Motion | Spatial expansion/collapse, FLIP reorder, cancelable Web Animations, material states, semantic fixture cues, quality policy | Motion Coordinator is a prototype; no full production scheduler or cross-window morph |
| Native shell | Opaque main window, frameless transparent detached window, secure preload, bounded IPC, local-only navigation | One display tested; transparent composition over other apps and topology recovery unverified |

Six motion disciplines have concrete prototype paths: **Spatial** uses block geometry and FLIP; **Material** changes elevation, rim, shadow, and backing; **Atmospheric** uses the canvas field; **Semantic** maps fixture Vela/event state to labeled cues; **Interaction** responds to drag, keyboard move, selection, and focus; **Performance** changes atmosphere cadence and material cost by quality and visibility. `src/motion.ts` records transition IDs, resource IDs, intent, policy, and completion/interruption. React does not rerender 200 particles per frame.

## Native measurement

Final-run commands: `npm run build` followed by `.\node_modules\.bin\electron.cmd . --benchmark` after installing the locked dependencies. `npm run benchmark` performs those two steps together and was also exercised. The script warms the scene for 300 ms, then runs seven 2.4-second scenarios once each. `requestAnimationFrame` intervals are sorted without removing outliers. The values are renderer callback intervals, **not** GPU presentation times, input latency, or universal FPS. The report also records a main-process snapshot near the end. No pass threshold was preapproved, and this single final run is exploratory evidence rather than acceptance qualification.

Environment: Windows x64, OS build `10.0.26300`; Electron `38.4.0`, Chromium `140.0.7339.240`, Node within Electron `22.20.0`. One display was present at 2048 × 1280 with scale factor 1.25. Electron reported enabled Canvas 2D, GPU compositing, rasterization, and WebGL features. GPU information listed NVIDIA GeForce RTX 5070 Laptop GPU, AMD Radeon Graphics, and Microsoft Basic Render Driver, but did not identify an active device in the basic-info result. No GPU utilization or VRAM measurement was obtained.

| Scenario | Median | p95 | p99 | Maximum | Samples |
|---|---:|---:|---:|---:|---:|
| Idle scene, ambient field | 6.1 ms | 6.2 ms | 6.2 ms | 6.3 ms | 396 |
| Active Vela animation | 6.1 ms | 6.2 ms | 6.2 ms | 6.3 ms | 396 |
| Programmed block rearrangement | 6.1 ms | 6.2 ms | 6.4 ms | 30.4 ms | 390 |
| Visible large-chat scroll | 6.1 ms | 12.2 ms | 12.3 ms | 12.3 ms | 346 |
| Synthetic event bursts | 6.1 ms | 6.2 ms | 6.4 ms | 12.3 ms | 393 |
| Main renderer with second native window | 6.1 ms | 6.2 ms | 12.2 ms | 78.8 ms | 369 |
| Reduced motion and efficient quality | 6.1 ms | 6.2 ms | 6.2 ms | 6.3 ms | 396 |

The rearrangement scenario swaps two blocks on a timer; it does not measure pointer-to-feedback latency. The secondary-window scenario samples the main renderer while the second window is open. The chat scroll has higher p95/p99 than the quiet scenes. The second window produced a 78.8 ms maximum callback interval. These one-run observations need repetition on equivalent hardware before any platform decision.

The canvas drew 132 times during the 2.4-second cinematic idle sample and 2 times during the 2.4-second reduced/efficient sample. A 1.2-second main-window hide/show probe returned visible afterward and saw one canvas draw across the whole hide-and-show interval; it does not isolate CPU use while hidden. The app pauses the canvas loop on `document.visibilitychange`, but minimized resource savings were not quantified.

The five Electron processes at the end-of-run snapshot were Browser 141,872 KiB, GPU 239,024 KiB, Utility 53,688 KiB, and two Tab processes 162,176 and 130,284 KiB of reported working set. Their arithmetic sum is 727,044 KiB (about 710 MiB), **not** unique resident memory because processes can share pages. Electron reports these values in KiB. No valid sustained CPU average, GPU usage, energy figure, cold-start timing, or memory-leak trend was measured. [Electron's MemoryInfo documentation](https://www.electronjs.org/docs/latest/api/structures/memory-info/) defines the units; [Electron's app metrics documentation](https://www.electronjs.org/docs/latest/api/app) describes the sampling behavior.

## Verification and captured evidence

| Check | Result |
|---|---|
| `npm run typecheck` | Passed for renderer and main/preload |
| `npm test` | Passed deterministic count, identity, timestamp, and repeatability assertions |
| `npm run benchmark` | Launched native Electron, opened a second window, wrote local JSON, captured actual windows, exited 0 |
| Native UI smoke | Found 12 blocks; expansion filled the intended main area; interrupted expansion settled; move-later button reordered; Vela attention/unavailable buttons changed text; invalid detach ID was rejected |
| Renderer isolation probe | `typeof window.require` was `undefined`; the preload exposes named methods only |
| Window/background probe | Hid and showed the main window for 1.2 seconds; two canvas draws occurred across hide and show |

Actual Electron captures: [initial environment](evidence/prototype-initial.png), [expanded block](evidence/prototype-expanded.png), [detached window](evidence/prototype-detached.png), and [post-benchmark state](evidence/prototype-local.png). These are screenshots, not motion recordings. The detailed local benchmark JSON is excluded from Git because it includes device details and process IDs.

## Desktop engineering assessment

- **Isolation/security:** Main and renderer are separate. `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true`, and `webSecurity:true` are explicit. The preload offers only named calls; main validates local frame origin and block IDs, denies permission requests and new windows, and prevents navigation away from the app file. This follows [Electron's security guidance](https://www.electronjs.org/docs/latest/tutorial/security) and [context-isolation guidance](https://www.electronjs.org/docs/latest/tutorial/context-isolation). A full adversarial audit remains open.
- **Composition:** The second window actually launched with transparent, frameless, resizable native settings and a draggable title strip. Its screenshot shows the window surface, but it does not prove alpha composition quality over another application, per-monitor color behavior, or detached focus recovery.
- **Lifecycle:** Main-window bounds are saved under the lab's local runtime folder and checked against a visible display area before reuse. Restart restoration and display unplug/replug were not exercised. Detached windows are not restored after restart.
- **Scaling and resize:** The native main window has minimum bounds, a responsive grid, and was measured on one 1.25-scale display. Native resizing, mixed DPI, and multi-display movement need hands-on qualification.
- **Degraded graphics:** Efficient mode removes backdrop blur and throttles the canvas; reduced motion avoids animated transitions. If Canvas 2D creation fails, the atmosphere is hidden while the DOM interface remains. No forced GPU device failure or low-end hardware run was performed.
- **Background behavior:** Visibility pauses the atmosphere loop. A hide/show probe ran; CPU/GPU savings and long minimized behavior are unmeasured.
- **Maintainability:** Main/preload, typed fixtures, React UI, motion policy, atmosphere, and benchmark code are separate. The 722 kB minified renderer chunk triggers Vite's size warning because the full fixture is bundled; lazy fixture loading is a sensible next experiment.

## Open work before a foundation decision

Run equivalent Tauri and Electron workloads on the same display, driver, power mode, and capture tools with repeated samples and declared thresholds. Add native pointer latency, CPU/GPU utilization and VRAM capture, cold/warm startup, sustained memory trends, 2-window focus and alpha composition review, mixed-DPI/display disconnect recovery, restart restoration, actual drag/resize usability, screen-reader and contrast review, and a real Codex event path. Human visual and motion acceptance is still required. None of those gaps should be inferred from this prototype's successful launch.
