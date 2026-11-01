# Celestial Cinematic V3.5 performance evidence

This report qualifies the celestial scope before the later foreground-instrument addendum. Its captures, materials and measurements remain a historical baseline for that new scope; they must not be relabeled as verification of the later instrument implementation.

Native receipt: [evidence-celestial/review-radius-motion/verification.json](evidence-celestial/review-radius-motion/verification.json), captured 2026-11-01T21:28:57.590Z, SHA-256 `913f78c62d9be6cf64afb5c8601215912f9d5e7cc9ff6ad6020e628bd07a0ff4`. Launch HEAD: `a01eb8a35858cda4764e0e637e63b2af1555d0a3`; the receipt's source and built-asset hashes identify the actual local candidate, including working-tree changes. **53/53 native checks passed**, 0 failed; **36 scenarios** were measured. Expected counts are never substituted for these observed results. No owner artistic acceptance or production qualification is implied.

[Source-test receipt](evidence-celestial/source-tests.json): **43/43 passed**, 0 failed. Declared source revision: `a01eb8a35858cda4764e0e637e63b2af1555d0a3`. Its complete src/ hash envelope matches this native receipt.

Electron 45.2.1, Chromium 156.0.8078.75, Node 24.22.1. Display 2048×1280, scale 1.25, reported 165 Hz. Final native content bounds 1600×1001. Every measured scenario explicitly records a released environment phase override; held-phase exploration images are excluded from real-time performance claims.

## Method and interpretation

The visible native-window lab uses synthetic working content and ordinary desktop background load. It continues rendering while another app has focus, preventing an unannounced blur-pause sample. Normal operation pauses on blur; native minimize, Ambient Off, Quiet and reduced motion are separately exercised. Scenario receipts preserve actual durations, state, workload and 1,200 ms warm-up. Screenshots precede measurement and are excluded from sample windows; retained captures and compositor/browser allocations can still affect memory. Recordings are separate and add capture/encoding overhead.

Callback intervals are scheduler observations. Scene submissions count coordinated Environment.render calls, each of which may contain several renderer passes. **Neither is presented FPS.** CPU values sum Electron-reported process percentages. Working-set sums may count shared pages multiple times and are neither unique resident memory nor VRAM. The 60 Hz / 120 Hz reference intervals are 16.67 / 8.33 ms; a requested submission cadence is not a physical display-mode or presentation qualification.

## Native workload samples

| Scenario                           | Callback samples |             Callback p50 / p95 / p99 ms | Scene submissions | Submission p95 ms | CPU reported sum mean % | Working-set sum MiB |
| ---------------------------------- | ---------------: | --------------------------------------: | ----------------: | ----------------: | ----------------------: | ------------------: |
| balanced-active-1                  |              715 |                     6.10 / 6.20 / 18.00 |               268 |             18.30 |                    7.72 |             2105.85 |
| cinematic-transition-1             |              462 |                    6.20 / 18.20 / 30.20 |               462 |             18.20 |                   12.13 |             2154.05 |
| efficient-1                        |               74 |                   60.70 / 78.80 / 78.90 |                69 |             78.80 |                    0.85 |             2134.38 |
| balanced-active-2                  |              760 |                      6.10 / 6.20 / 6.20 |               276 |             18.30 |                    4.89 |             2068.15 |
| cinematic-transition-2             |              528 |                    6.10 / 12.30 / 18.20 |               528 |             12.30 |                   12.68 |             2174.26 |
| efficient-2                        |               78 |                   60.70 / 78.80 / 78.90 |                69 |             78.80 |                    0.75 |             2217.86 |
| cinematic-active                   |              759 |                      6.10 / 6.20 / 6.20 |               759 |              6.20 |                    5.80 |             2186.06 |
| celestial-starlit-ambient-1        |              503 |                      6.10 / 6.20 / 6.20 |               182 |             18.30 |                    5.11 |             2216.57 |
| celestial-shadow-ambient-1         |              506 |                      6.10 / 6.20 / 6.20 |               184 |             18.30 |                    4.69 |             2299.01 |
| celestial-deep-ambient-1           |              507 |                      6.10 / 6.20 / 6.20 |               185 |             18.30 |                    4.77 |             2415.45 |
| celestial-study-switching-1        |              507 |                      6.10 / 6.20 / 6.20 |               185 |             18.30 |                    5.60 |             2528.91 |
| celestial-starlit-ambient-2        |              507 |                      6.10 / 6.20 / 6.20 |               185 |             18.30 |                    5.15 |             2649.15 |
| celestial-shadow-ambient-2         |              507 |                      6.10 / 6.20 / 6.20 |               184 |             18.30 |                    5.07 |             2765.03 |
| celestial-deep-ambient-2           |              421 |                    6.10 / 12.00 / 30.20 |               167 |             24.30 |                    8.43 |             2883.35 |
| celestial-study-switching-2        |              507 |                      6.10 / 6.20 / 6.20 |               186 |             18.30 |                    5.60 |             2894.24 |
| architecture-ring-ambient-1        |              502 |                      6.10 / 6.20 / 6.20 |               182 |             18.30 |                    5.05 |             2893.52 |
| architecture-aperture-ambient-1    |              504 |                      6.10 / 6.10 / 6.20 |               183 |             18.30 |                    5.09 |             2885.91 |
| architecture-observatory-ambient-1 |              505 |                      6.10 / 6.20 / 6.20 |               183 |             18.30 |                    4.57 |             2885.80 |
| living-ambient-1                   |              505 |                      6.10 / 6.20 / 6.20 |               183 |             18.30 |                    4.34 |             2887.56 |
| architecture-ring-ambient-2        |              505 |                      6.10 / 6.20 / 6.20 |               184 |             18.30 |                    5.10 |             2893.57 |
| architecture-aperture-ambient-2    |              505 |                      6.10 / 6.20 / 6.20 |               184 |             18.30 |                    4.85 |             2905.53 |
| architecture-observatory-ambient-2 |              505 |                      6.10 / 6.20 / 6.20 |               184 |             18.30 |                    3.52 |             2916.57 |
| living-ambient-2                   |              506 |                      6.10 / 6.20 / 6.20 |               184 |             18.30 |                    1.93 |             2916.99 |
| resource-selection                 |              507 |                      6.10 / 6.20 / 6.20 |               186 |             18.30 |                    9.19 |             2952.41 |
| resource-rearrangement             |              759 |                      6.10 / 6.20 / 6.20 |               278 |             18.30 |                    7.12 |             3030.65 |
| focused-long-conversation          |              756 |                      6.10 / 6.20 / 6.20 |               274 |             18.30 |                    3.69 |             3122.14 |
| focused-research-notebook          |              763 |                      6.10 / 6.20 / 6.20 |               277 |             18.30 |                    2.30 |             3161.20 |
| scene-transitions                  |              759 |                      6.10 / 6.20 / 6.20 |               277 |             18.30 |                    4.84 |             3231.54 |
| vela-state-changes                 |              759 |                      6.10 / 6.20 / 6.20 |               278 |             18.30 |                    4.82 |             3355.38 |
| integrated-focus-stream            |              489 |                    6.20 / 18.20 / 18.30 |               275 |             24.30 |                   12.47 |             3640.37 |
| focused-native-resize              |              636 |                     6.10 / 6.20 / 78.80 |               257 |             18.30 |                   11.33 |             3787.26 |
| ambient-idle                       |              200 |                   22.80 / 30.40 / 50.00 |               109 |             38.30 |                    6.54 |             4144.26 |
| ambient-off                        |                0 | unavailable / unavailable / unavailable |                 0 |       unavailable |                    0.09 |             3939.17 |
| quiet-static                       |                0 | unavailable / unavailable / unavailable |                 0 |       unavailable |                    0.04 |             3933.25 |
| reduced-motion-static              |                0 | unavailable / unavailable / unavailable |                 0 |       unavailable |                    4.09 |             1538.20 |
| native-minimized                   |                0 | unavailable / unavailable / unavailable |                 0 |       unavailable |                    0.03 |              932.94 |

## Final-frame submission and geometry diagnostics

These are the **last rendered frame's snapshots** for each scenario, not means over its entire window. Renderer totals aggregate the sky, separately lit architecture and foreground passes, including shadow rendering, with renderer.info automatic per-pass resets disabled. The sky uses two batches when active. Reported star instances are submitted catalog instances, not a count of stars visibly resolved on the monitor. Architectural estimates describe selected composition geometry, including when its environment is hidden; they must remain separate from actual renderer submission counters and from memory measurements. Shadow-map dimensions are configuration, not VRAM consumption.

| Scenario                           | Total renderer draw calls | Total submitted triangles | Reported sky instances / visible | Sky batches | Potential architecture triangles / visible | Shadow map |
| ---------------------------------- | ------------------------: | ------------------------: | -------------------------------: | ----------: | -----------------------------------------: | ---------- |
| balanced-active-1                  |                        39 |                    149142 |                     14000 / true |           2 |                               56640 / true | 1024px     |
| cinematic-transition-1             |                        43 |                    184210 |                     24000 / true |           2 |                               61870 / true | 2048px     |
| efficient-1                        |                        21 |                     64226 |                      6500 / true |           2 |                               44788 / true | off        |
| balanced-active-2                  |                        39 |                    149142 |                     14000 / true |           2 |                               56640 / true | 1024px     |
| cinematic-transition-2             |                        43 |                    184210 |                     24000 / true |           2 |                               61870 / true | 2048px     |
| efficient-2                        |                        21 |                     64226 |                      6500 / true |           2 |                               44788 / true | off        |
| cinematic-active                   |                        43 |                    184210 |                     24000 / true |           2 |                               61870 / true | 2048px     |
| celestial-starlit-ambient-1        |                        39 |                    149142 |                     14000 / true |           2 |                               56640 / true | 1024px     |
| celestial-shadow-ambient-1         |                        39 |                    149142 |                     14000 / true |           2 |                               56640 / true | 1024px     |
| celestial-deep-ambient-1           |                        63 |                    258534 |                     14000 / true |           2 |                              113280 / true | 1024px     |
| celestial-study-switching-1        |                        63 |                    258534 |                     14000 / true |           2 |                              113280 / true | 1024px     |
| celestial-starlit-ambient-2        |                        39 |                    149142 |                     14000 / true |           2 |                               56640 / true | 1024px     |
| celestial-shadow-ambient-2         |                        39 |                    149142 |                     14000 / true |           2 |                               56640 / true | 1024px     |
| celestial-deep-ambient-2           |                        63 |                    258534 |                     14000 / true |           2 |                              113280 / true | 1024px     |
| celestial-study-switching-2        |                        63 |                    258534 |                     14000 / true |           2 |                              113280 / true | 1024px     |
| architecture-ring-ambient-1        |                        39 |                    149142 |                     14000 / true |           2 |                               56640 / true | 1024px     |
| architecture-aperture-ambient-1    |                        47 |                    140706 |                     14000 / true |           2 |                               51414 / true | 1024px     |
| architecture-observatory-ambient-1 |                        49 |                    132598 |                     14000 / true |           2 |                               47360 / true | 1024px     |
| living-ambient-1                   |                        15 |                     45382 |                        0 / false |           0 |                              47360 / false | off        |
| architecture-ring-ambient-2        |                        39 |                    149142 |                     14000 / true |           2 |                               56640 / true | 1024px     |
| architecture-aperture-ambient-2    |                        47 |                    140706 |                     14000 / true |           2 |                               51414 / true | 1024px     |
| architecture-observatory-ambient-2 |                        49 |                    132598 |                     14000 / true |           2 |                               47360 / true | 1024px     |
| living-ambient-2                   |                        15 |                     45382 |                        0 / false |           0 |                              47360 / false | off        |
| resource-selection                 |                        15 |                     45382 |                        0 / false |           0 |                              47360 / false | off        |
| resource-rearrangement             |                        15 |                     45382 |                        0 / false |           0 |                              47360 / false | off        |
| focused-long-conversation          |                        39 |                    149142 |                     14000 / true |           2 |                               56640 / true | 1024px     |
| focused-research-notebook          |                        39 |                    149142 |                     14000 / true |           2 |                               56640 / true | 1024px     |
| scene-transitions                  |                        41 |                    184982 |                     14000 / true |           2 |                               56640 / true | 1024px     |
| vela-state-changes                 |                        39 |                    149142 |                     14000 / true |           2 |                               56640 / true | 1024px     |
| integrated-focus-stream            |                        39 |                    149142 |                     14000 / true |           2 |                               56640 / true | 1024px     |
| focused-native-resize              |                        39 |                    149142 |                     14000 / true |           2 |                               56640 / true | 1024px     |
| ambient-idle                       |                        39 |                    149142 |                     14000 / true |           2 |                               56640 / true | 1024px     |
| ambient-off                        |                        39 |                    149142 |                     14000 / true |           2 |                               56640 / true | 1024px     |
| quiet-static                       |                        21 |                     64226 |                      6500 / true |           2 |                               44788 / true | off        |
| reduced-motion-static              |                        39 |                    149142 |                     14000 / true |           2 |                               56640 / true | 1024px     |
| native-minimized                   |                        39 |                    149142 |                     14000 / true |           2 |                               56640 / true | 1024px     |

## Historical named-workload comparison

### Original V3 baseline

The preserved V3 checkpoint was rebuilt and rerun before V3.5 work: [original baseline receipt](evidence-v3-5/baseline/verification.json), captured 2026-11-01T20:15:14.807Z, 37/37 native checks. Its final content bounds were 1600×1001, display scale 1.25, reported 165 Hz. The nominal window/camera and same-named tier/transition scripts provide a direct historical reference. The celestial candidate adds a starfield, deeper ring, shadows, revised materials and richer synthetic reading content; desktop load and capture retention are uncontrolled. This is not a pixel-identical scene, an isolated effect benchmark or proof of better monitor presentation.

| Scenario               | V3 / celestial callback p95 ms | V3 / celestial submission p95 ms | V3 / celestial CPU reported sum mean % | V3 / celestial working-set mean MiB |
| ---------------------- | -----------------------------: | -------------------------------: | -------------------------------------: | ----------------------------------: |
| balanced-active-1      |                    6.20 / 6.20 |                    18.30 / 18.30 |                            5.61 / 7.72 |                   1161.62 / 2105.85 |
| cinematic-transition-1 |                  18.20 / 18.20 |                    18.20 / 18.20 |                          11.89 / 12.13 |                   1206.10 / 2154.05 |
| efficient-1            |                  78.80 / 78.80 |                    78.80 / 78.80 |                            1.54 / 0.85 |                   1251.84 / 2134.38 |
| balanced-active-2      |                    6.20 / 6.20 |                    18.30 / 18.30 |                            5.54 / 4.89 |                   1176.18 / 2068.15 |
| cinematic-transition-2 |                  18.30 / 12.30 |                    18.30 / 12.30 |                          11.75 / 12.68 |                   1243.01 / 2174.26 |
| efficient-2            |                  78.70 / 78.80 |                    78.70 / 78.80 |                            1.30 / 0.75 |                   1222.81 / 2217.86 |

### Pre-celestial V3.5 / 938 reference

The preceding [938 candidate receipt](evidence-v3-5/review-occlusion-final/verification.json) was captured 2026-11-01T20:59:15.685Z, source `93889084565dcb26b26220ad9a1a1153bacdc4d0`, with 48/48 native checks and 28 scenarios. Its scene predates the expanded sky, revised physical ring and shadow pass. Same-named scripts are useful references, but scene contents, capture retention and uncontrolled desktop load differ. These differences do not isolate one shader's cost or prove a presentation improvement.

| Scenario               | Before / celestial callback p95 ms | Before / celestial submission p95 ms | Before / celestial CPU reported sum mean % | Before / celestial working-set mean MiB |
| ---------------------- | ---------------------------------: | -----------------------------------: | -----------------------------------------: | --------------------------------------: |
| balanced-active-1      |                       12.20 / 6.20 |                        24.20 / 18.30 |                                5.67 / 7.72 |                       1736.68 / 2105.85 |
| cinematic-transition-1 |                      18.30 / 18.20 |                        18.30 / 18.20 |                              11.87 / 12.13 |                       1824.24 / 2154.05 |
| efficient-1            |                      78.80 / 78.80 |                        78.80 / 78.80 |                                1.05 / 0.85 |                       1828.94 / 2134.38 |
| balanced-active-2      |                        6.20 / 6.20 |                        18.30 / 18.30 |                                5.16 / 4.89 |                       1799.43 / 2068.15 |
| cinematic-transition-2 |                      18.20 / 12.30 |                        18.20 / 12.30 |                              12.47 / 12.68 |                       1973.13 / 2174.26 |
| efficient-2            |                      78.84 / 78.80 |                        78.84 / 78.80 |                                1.01 / 0.75 |                       2046.87 / 2217.86 |

## Input, startup and memory limits

16 programmatic DOM click-dispatch→coordinator samples: p50 2.20 ms, p95 3.20 ms, maximum 3.20 ms. This excludes OS input injection, monitor presentation and optical latency. Native module evaluation→local renderer load is 566 ms, not OS cold startup. Video encoder rate and encoded packet PTS are not presented application FPS.

Across the capture-heavy benchmark's scenario-level working-set means, the first is 2105.85 MiB, the maximum is 4144.26 MiB, and the last is 932.94 MiB. These are means of separate workloads, not a continuous unique-resident-memory trace. Retained capture/browser allocations, changing bounds and shared-page accounting complicate attribution.

## Separate fresh-process probe

No celestial fresh-process memory receipt has been supplied at `evidence-celestial/fresh-process-memory.json`. Earlier V3/V3.5 memory records remain historical and are not substituted for this environment.

## Outstanding qualification and storage

[Tool discovery](evidence-v3-5/performance-tools.json) found WPR/WPA and NVIDIA tooling, but PresentMon was absent from PATH and matching NVIDIA memory entries returned nonnumeric values. Tool availability is separate from a decoded, application-attributed timing, VRAM or energy trace. Physical 60 Hz, attributable GPU utilization/memory, power/thermals, long-run memory stability, mixed-DPI/multi-display, assistive-technology and sustained owner motion comfort remain unqualified unless later evidence explicitly supplies them. Functional checks do not award an artistic pass to the starfield, ring or lighting.

ReserveGuard enforces the task's instruction/monitoring policy with separate 30 GiB floors for C: and D:. Each native pass admits up to 256 MiB, including a capped 190 MiB PNG writer and profile/report headroom; raw motion frames are downscaled and labeled separately from full native stills. Broader local writer allowances and rechecks remain necessary. This is not an OS quota and cannot stop unrelated apps, cloud jobs or processes that did not load the rule. Retained evidence and unrelated user data were not deleted to create space.
