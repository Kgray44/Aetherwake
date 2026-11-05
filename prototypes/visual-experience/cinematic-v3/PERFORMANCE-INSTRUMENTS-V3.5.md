# Foreground instrument V3.5 performance evidence

This report covers the foreground-instrument addendum and retains the qualified a01 celestial candidate as its immediate historical baseline. All values come from the explicit instrument receipt below; no earlier visual or functional result is relabeled as verification of these materials and structures.

Native receipt: [evidence-instruments/review-resize-final/verification.json](evidence-instruments/review-resize-final/verification.json), captured 2026-11-01T22:28:38.899Z, SHA-256 `05c21585808a040fe59b5bd029e24442fcffe78f09c26bce6e3f9d2d4dbb8792`. Launch HEAD: `831aadb6703a14ca9f910cc990d8d2e74ebf4ebe`; the receipt's source and built-asset hashes identify the actual local candidate, including working-tree changes. **57/57 native checks passed**, 0 failed; **44 scenarios** were measured. Expected counts are never substituted for these observed results. No owner artistic acceptance or production qualification is implied.

[Source-test receipt](evidence-instruments/source-tests.json): **54/54 passed**, 0 failed. Declared source revision: `831aadb6703a14ca9f910cc990d8d2e74ebf4ebe`. Its complete src/ hash envelope matches this native receipt.

Electron 45.2.1, Chromium 156.0.8078.75, Node 24.22.1. Display 2048×1280, scale 1.25, reported 165 Hz. Final native content bounds 1600×1001. Every measured scenario explicitly records a released environment phase override; held-phase exploration images are excluded from real-time performance claims.

## Method and interpretation

The visible native-window lab uses synthetic working content and ordinary desktop background load. It continues rendering while another app has focus, preventing an unannounced blur-pause sample. Normal operation pauses on blur; native minimize, Ambient Off, Quiet and reduced motion are separately exercised. Scenario receipts preserve actual durations, state, workload and 1,200 ms warm-up. Screenshots precede measurement and are excluded from sample windows; retained captures and compositor/browser allocations can still affect memory. Recordings are separate and add capture/encoding overhead.

Callback intervals are scheduler observations. Scene submissions count coordinated Environment.render calls, each of which may contain several renderer passes. **Neither is presented FPS.** CPU values sum Electron-reported process percentages. Working-set sums may count shared pages multiple times and are neither unique resident memory nor VRAM. The 60 Hz / 120 Hz reference intervals are 16.67 / 8.33 ms; a requested submission cadence is not a physical display-mode or presentation qualification.

## Resize correction and observed tradeoffs

The physical maximize review of preceding 7598227 exposed duplicate peripheral resource labels during ordinary workspace resize. The source correction limits docking opacity to actual focused-work transitions. The new native regression resized the owned BrowserWindow narrower and restored it, both unselected and selected without expansion: four transitions, 72 delivered animation-frame samples, maximum measured anchor opacity 0.00, and original article/editor identities retained. The [failed earlier resize image](evidence-instruments/failed-native-resize-759.jpg), [previous native receipt](evidence-instruments/review-thin-lens/verification.json) and [previous report](PERFORMANCE-INSTRUMENTS-V3.5-7598227.md) remain preserved. This functional check does not substitute for repeated physical input review.

Balanced submission p95 remains 18.30 / 18.30 ms, matching the same-named a01/V3 reference samples. Reported summed CPU is 5.67% / 5.31%; Cinematic transition CPU is 13.33% / 12.63%. Desktop load, capture retention and run order prevent a stable performance-improvement claim. Capture-heavy scenario working-set means start at 2367.44 MiB, peak at 3763.26 MiB and end at 830.36 MiB; shared pages may be counted repeatedly. The exact 831 video and the validated live-rendering probe below are separate from physical-input smoke. Previous 759 results remain historical; the initial unrendered 831 attempt is preserved as invalid.

## Native workload samples

| Scenario                           | Callback samples |             Callback p50 / p95 / p99 ms | Scene submissions | Submission p95 ms | CPU reported sum mean % | Working-set sum MiB |
| ---------------------------------- | ---------------: | --------------------------------------: | ----------------: | ----------------: | ----------------------: | ------------------: |
| balanced-active-1                  |              744 |                      6.10 / 6.20 / 6.20 |               271 |             18.30 |                    5.67 |             2367.44 |
| cinematic-transition-1             |              684 |                    6.10 / 12.10 / 12.30 |               684 |             12.10 |                   13.33 |             2439.48 |
| efficient-1                        |               75 |                   60.70 / 78.80 / 78.87 |                67 |             78.80 |                    0.99 |             2439.26 |
| balanced-active-2                  |              743 |                      6.10 / 6.20 / 6.20 |               270 |             18.30 |                    5.31 |             2409.33 |
| cinematic-transition-2             |              729 |                     6.10 / 6.20 / 12.20 |               729 |              6.20 |                   12.63 |             2431.71 |
| efficient-2                        |               73 |                   66.64 / 78.70 / 78.90 |                68 |             78.70 |                    0.96 |             2453.39 |
| cinematic-active                   |              744 |                      6.10 / 6.20 / 6.20 |               744 |              6.20 |                    6.91 |             2437.93 |
| celestial-starlit-ambient-1        |              496 |                      6.10 / 6.20 / 6.20 |               181 |             18.30 |                    5.81 |             2452.29 |
| celestial-shadow-ambient-1         |              496 |                      6.10 / 6.20 / 6.20 |               181 |             18.30 |                    5.24 |             2477.61 |
| celestial-deep-ambient-1           |              496 |                      6.10 / 6.20 / 6.20 |               181 |             18.20 |                    5.10 |             2532.51 |
| celestial-study-switching-1        |              496 |                      6.10 / 6.20 / 6.20 |               180 |             18.30 |                    5.00 |             2632.78 |
| celestial-starlit-ambient-2        |              495 |                      6.10 / 6.20 / 6.20 |               180 |             18.30 |                    4.80 |             2741.82 |
| celestial-shadow-ambient-2         |              496 |                      6.10 / 6.20 / 6.20 |               181 |             18.30 |                    5.34 |             2848.24 |
| celestial-deep-ambient-2           |              496 |                      6.10 / 6.20 / 6.20 |               181 |             18.30 |                    5.48 |             2954.40 |
| celestial-study-switching-2        |              497 |                      6.10 / 6.20 / 6.20 |               180 |             18.20 |                    4.90 |             3059.41 |
| instrument-optical-ambient-1       |              496 |                      6.10 / 6.20 / 6.20 |               181 |             18.30 |                    5.22 |             3164.96 |
| instrument-engineered-ambient-1    |              496 |                      6.10 / 6.20 / 6.20 |               181 |             18.30 |                    5.39 |             3270.27 |
| instrument-composite-ambient-1     |              378 |                    6.10 / 18.10 / 30.40 |               159 |             18.50 |                   12.08 |             3340.43 |
| instrument-study-switching-1       |              497 |                      6.10 / 6.20 / 6.20 |               180 |             18.30 |                    4.90 |             3323.87 |
| instrument-optical-ambient-2       |              496 |                      6.10 / 6.20 / 6.20 |               181 |             18.20 |                    4.80 |             3313.68 |
| instrument-engineered-ambient-2    |              496 |                      6.10 / 6.20 / 6.20 |               181 |             18.30 |                    5.18 |             3309.18 |
| instrument-composite-ambient-2     |              495 |                      6.10 / 6.20 / 6.20 |               180 |             18.30 |                    4.86 |             3307.40 |
| instrument-study-switching-2       |              496 |                      6.10 / 6.20 / 6.20 |               180 |             18.30 |                    2.30 |             3304.34 |
| architecture-ring-ambient-1        |              496 |                      6.10 / 6.20 / 6.20 |               181 |             18.30 |                    2.64 |             3303.45 |
| architecture-aperture-ambient-1    |              495 |                      6.10 / 6.20 / 6.20 |               180 |             18.30 |                    2.64 |             3287.19 |
| architecture-observatory-ambient-1 |              496 |                      6.10 / 6.20 / 6.20 |               181 |             18.30 |                    2.63 |             3288.14 |
| living-ambient-1                   |              496 |                      6.10 / 6.20 / 6.30 |               181 |             18.30 |                    2.19 |             3292.68 |
| architecture-ring-ambient-2        |              496 |                      6.10 / 6.20 / 6.20 |               181 |             18.30 |                    2.46 |             3293.56 |
| architecture-aperture-ambient-2    |              495 |                      6.10 / 6.20 / 6.30 |               180 |             18.30 |                    2.51 |             3293.20 |
| architecture-observatory-ambient-2 |              495 |                      6.10 / 6.20 / 6.20 |               180 |             18.30 |                    2.32 |             3293.57 |
| living-ambient-2                   |              496 |                      6.10 / 6.20 / 6.20 |               181 |             18.30 |                    2.07 |             3293.16 |
| resource-selection                 |              497 |                      6.10 / 6.20 / 6.20 |               181 |             18.30 |                    5.06 |             3293.00 |
| resource-rearrangement             |              746 |                      6.10 / 6.20 / 6.20 |               270 |             18.30 |                    6.05 |             3300.16 |
| focused-long-conversation          |              744 |                      6.10 / 6.20 / 6.20 |               270 |             18.30 |                    4.33 |             3345.49 |
| focused-research-notebook          |              743 |                      6.10 / 6.20 / 6.20 |               270 |             18.30 |                    2.20 |             3383.67 |
| scene-transitions                  |              745 |                      6.10 / 6.20 / 6.20 |               270 |             18.30 |                    5.64 |             3401.95 |
| vela-state-changes                 |              745 |                      6.10 / 6.20 / 6.20 |               271 |             18.30 |                    5.47 |             3414.09 |
| integrated-focus-stream            |              731 |                     6.10 / 6.20 / 12.20 |               278 |             18.30 |                   12.10 |             3603.53 |
| focused-native-resize              |              622 |                     6.10 / 6.20 / 66.70 |               258 |             18.40 |                    8.43 |             3763.26 |
| ambient-idle                       |              238 |                   22.40 / 30.40 / 30.40 |               120 |             37.70 |                    2.35 |             3736.26 |
| ambient-off                        |                0 | unavailable / unavailable / unavailable |                 0 |       unavailable |                    0.03 |             3730.68 |
| quiet-static                       |                0 | unavailable / unavailable / unavailable |                 0 |       unavailable |                    0.02 |             3726.44 |
| reduced-motion-static              |                0 | unavailable / unavailable / unavailable |                 0 |       unavailable |                    4.84 |             3248.27 |
| native-minimized                   |                0 | unavailable / unavailable / unavailable |                 0 |       unavailable |                    0.02 |              830.36 |

## Final-frame submission and geometry diagnostics

These are the **last rendered frame's snapshots** for each scenario, not means over its entire window. Renderer totals aggregate the sky, separately lit architecture and foreground passes, including shadow rendering, with renderer.info automatic per-pass resets disabled. The sky uses two batches when active. Reported star instances are submitted catalog instances, not a count of stars visibly resolved on the monitor. Architectural estimates describe selected composition geometry, including when its environment is hidden; they must remain separate from actual renderer submission counters and from memory measurements. Shadow-map dimensions are configuration, not VRAM consumption.

| Scenario                           | Total renderer draw calls | Total submitted triangles | Reported sky instances / visible | Sky batches | Potential architecture triangles / visible | Shadow map |
| ---------------------------------- | ------------------------: | ------------------------: | -------------------------------: | ----------: | -----------------------------------------: | ---------- |
| balanced-active-1                  |                        39 |                    160840 |                     14000 / true |           2 |                               56640 / true | 1024px     |
| cinematic-transition-1             |                        43 |                    195908 |                     24000 / true |           2 |                               61870 / true | 2048px     |
| efficient-1                        |                        22 |                     73436 |                      6500 / true |           2 |                               44788 / true | off        |
| balanced-active-2                  |                        39 |                    160840 |                     14000 / true |           2 |                               56640 / true | 1024px     |
| cinematic-transition-2             |                        43 |                    195908 |                     24000 / true |           2 |                               61870 / true | 2048px     |
| efficient-2                        |                        22 |                     73436 |                      6500 / true |           2 |                               44788 / true | off        |
| cinematic-active                   |                        43 |                    195908 |                     24000 / true |           2 |                               61870 / true | 2048px     |
| celestial-starlit-ambient-1        |                        39 |                    160840 |                     14000 / true |           2 |                               56640 / true | 1024px     |
| celestial-shadow-ambient-1         |                        39 |                    160840 |                     14000 / true |           2 |                               56640 / true | 1024px     |
| celestial-deep-ambient-1           |                        63 |                    270232 |                     14000 / true |           2 |                              113280 / true | 1024px     |
| celestial-study-switching-1        |                        63 |                    270232 |                     14000 / true |           2 |                              113280 / true | 1024px     |
| celestial-starlit-ambient-2        |                        39 |                    160840 |                     14000 / true |           2 |                               56640 / true | 1024px     |
| celestial-shadow-ambient-2         |                        39 |                    160840 |                     14000 / true |           2 |                               56640 / true | 1024px     |
| celestial-deep-ambient-2           |                        63 |                    270232 |                     14000 / true |           2 |                              113280 / true | 1024px     |
| celestial-study-switching-2        |                        63 |                    270232 |                     14000 / true |           2 |                              113280 / true | 1024px     |
| instrument-optical-ambient-1       |                        39 |                    160840 |                     14000 / true |           2 |                               56640 / true | 1024px     |
| instrument-engineered-ambient-1    |                        44 |                    167704 |                     14000 / true |           2 |                               56640 / true | 1024px     |
| instrument-composite-ambient-1     |                        44 |                    168880 |                     14000 / true |           2 |                               56640 / true | 1024px     |
| instrument-study-switching-1       |                        44 |                    168880 |                     14000 / true |           2 |                               56640 / true | 1024px     |
| instrument-optical-ambient-2       |                        39 |                    160840 |                     14000 / true |           2 |                               56640 / true | 1024px     |
| instrument-engineered-ambient-2    |                        44 |                    167704 |                     14000 / true |           2 |                               56640 / true | 1024px     |
| instrument-composite-ambient-2     |                        44 |                    168880 |                     14000 / true |           2 |                               56640 / true | 1024px     |
| instrument-study-switching-2       |                        44 |                    168880 |                     14000 / true |           2 |                               56640 / true | 1024px     |
| architecture-ring-ambient-1        |                        39 |                    160840 |                     14000 / true |           2 |                               56640 / true | 1024px     |
| architecture-aperture-ambient-1    |                        47 |                    152404 |                     14000 / true |           2 |                               51414 / true | 1024px     |
| architecture-observatory-ambient-1 |                        49 |                    144296 |                     14000 / true |           2 |                               47360 / true | 1024px     |
| living-ambient-1                   |                        18 |                     57086 |                        0 / false |           0 |                              47360 / false | off        |
| architecture-ring-ambient-2        |                        39 |                    160840 |                     14000 / true |           2 |                               56640 / true | 1024px     |
| architecture-aperture-ambient-2    |                        47 |                    152404 |                     14000 / true |           2 |                               51414 / true | 1024px     |
| architecture-observatory-ambient-2 |                        49 |                    144296 |                     14000 / true |           2 |                               47360 / true | 1024px     |
| living-ambient-2                   |                        18 |                     57086 |                        0 / false |           0 |                              47360 / false | off        |
| resource-selection                 |                        18 |                     57086 |                        0 / false |           0 |                              47360 / false | off        |
| resource-rearrangement             |                        18 |                     57086 |                        0 / false |           0 |                              47360 / false | off        |
| focused-long-conversation          |                        39 |                    160840 |                     14000 / true |           2 |                               56640 / true | 1024px     |
| focused-research-notebook          |                        39 |                    160840 |                     14000 / true |           2 |                               56640 / true | 1024px     |
| scene-transitions                  |                        44 |                    196686 |                     14000 / true |           2 |                               56640 / true | 1024px     |
| vela-state-changes                 |                        39 |                    160840 |                     14000 / true |           2 |                               56640 / true | 1024px     |
| integrated-focus-stream            |                        39 |                    160840 |                     14000 / true |           2 |                               56640 / true | 1024px     |
| focused-native-resize              |                        39 |                    160840 |                     14000 / true |           2 |                               56640 / true | 1024px     |
| ambient-idle                       |                        39 |                    160840 |                     14000 / true |           2 |                               56640 / true | 1024px     |
| ambient-off                        |                        39 |                    160840 |                     14000 / true |           2 |                               56640 / true | 1024px     |
| quiet-static                       |                        22 |                     73436 |                      6500 / true |           2 |                               44788 / true | off        |
| reduced-motion-static              |                        39 |                    160840 |                     14000 / true |           2 |                               56640 / true | 1024px     |
| native-minimized                   |                        39 |                    160840 |                     14000 / true |           2 |                               56640 / true | 1024px     |

## Instrument state and reported construction counts

These are actual final-frame diagnostics, separate from timing and resident-memory measurements. The module's reported geometry/material/mesh construction counts describe retained instrument resources. Stable reported counts and live WebGL geometry residency after warmed study switching do not prove that every JavaScript update is allocation-free, nor do they measure GPU bytes. Contact-cue visibility is a rendered-state diagnostic, not proof of convincing surface contact or lighting quality.

| Scenario                           | Instrument study | Resources / bound | Reported geometry / material / mesh construction counts | Resident WebGL geometries | Visible contact cues |
| ---------------------------------- | ---------------- | ----------------: | ------------------------------------------------------: | ------------------------: | -------------------: |
| balanced-active-1                  | optical          |             3 / 3 |                                            24 / 24 / 24 |                        94 |                    0 |
| cinematic-transition-1             | optical          |             3 / 3 |                                            24 / 24 / 24 |                        97 |                    0 |
| efficient-1                        | optical          |             3 / 3 |                                            24 / 24 / 24 |                        97 |                    0 |
| balanced-active-2                  | optical          |             3 / 3 |                                            24 / 24 / 24 |                        97 |                    0 |
| cinematic-transition-2             | optical          |             3 / 3 |                                            24 / 24 / 24 |                        97 |                    0 |
| efficient-2                        | optical          |             3 / 3 |                                            24 / 24 / 24 |                        97 |                    0 |
| cinematic-active                   | optical          |             3 / 3 |                                            24 / 24 / 24 |                        97 |                    0 |
| celestial-starlit-ambient-1        | optical          |             3 / 3 |                                            24 / 24 / 24 |                        97 |                    0 |
| celestial-shadow-ambient-1         | optical          |             3 / 3 |                                            24 / 24 / 24 |                        97 |                    0 |
| celestial-deep-ambient-1           | optical          |             3 / 3 |                                            24 / 24 / 24 |                        97 |                    0 |
| celestial-study-switching-1        | optical          |             3 / 3 |                                            24 / 24 / 24 |                        97 |                    0 |
| celestial-starlit-ambient-2        | optical          |             3 / 3 |                                            24 / 24 / 24 |                        97 |                    0 |
| celestial-shadow-ambient-2         | optical          |             3 / 3 |                                            24 / 24 / 24 |                        97 |                    0 |
| celestial-deep-ambient-2           | optical          |             3 / 3 |                                            24 / 24 / 24 |                        97 |                    0 |
| celestial-study-switching-2        | optical          |             3 / 3 |                                            24 / 24 / 24 |                        97 |                    0 |
| instrument-optical-ambient-1       | optical          |             3 / 3 |                                            24 / 24 / 24 |                        97 |                    0 |
| instrument-engineered-ambient-1    | engineered       |             3 / 3 |                                            24 / 24 / 24 |                        97 |                    0 |
| instrument-composite-ambient-1     | composite        |             3 / 3 |                                            24 / 24 / 24 |                        97 |                    0 |
| instrument-study-switching-1       | composite        |             3 / 3 |                                            24 / 24 / 24 |                        97 |                    0 |
| instrument-optical-ambient-2       | optical          |             3 / 3 |                                            24 / 24 / 24 |                        97 |                    0 |
| instrument-engineered-ambient-2    | engineered       |             3 / 3 |                                            24 / 24 / 24 |                        97 |                    0 |
| instrument-composite-ambient-2     | composite        |             3 / 3 |                                            24 / 24 / 24 |                        97 |                    0 |
| instrument-study-switching-2       | composite        |             3 / 3 |                                            24 / 24 / 24 |                        97 |                    0 |
| architecture-ring-ambient-1        | optical          |             3 / 3 |                                            24 / 24 / 24 |                        97 |                    0 |
| architecture-aperture-ambient-1    | optical          |             3 / 3 |                                            24 / 24 / 24 |                        97 |                    0 |
| architecture-observatory-ambient-1 | optical          |             3 / 3 |                                            24 / 24 / 24 |                        97 |                    0 |
| living-ambient-1                   | optical          |             3 / 3 |                                            24 / 24 / 24 |                        97 |                    3 |
| architecture-ring-ambient-2        | optical          |             3 / 3 |                                            24 / 24 / 24 |                        97 |                    0 |
| architecture-aperture-ambient-2    | optical          |             3 / 3 |                                            24 / 24 / 24 |                        97 |                    0 |
| architecture-observatory-ambient-2 | optical          |             3 / 3 |                                            24 / 24 / 24 |                        97 |                    0 |
| living-ambient-2                   | optical          |             3 / 3 |                                            24 / 24 / 24 |                        97 |                    3 |
| resource-selection                 | optical          |             3 / 3 |                                            24 / 24 / 24 |                        97 |                    3 |
| resource-rearrangement             | optical          |             3 / 3 |                                            24 / 24 / 24 |                        97 |                    3 |
| focused-long-conversation          | optical          |             3 / 3 |                                            24 / 24 / 24 |                        97 |                    0 |
| focused-research-notebook          | optical          |             3 / 3 |                                            24 / 24 / 24 |                        97 |                    0 |
| scene-transitions                  | optical          |             3 / 3 |                                            24 / 24 / 24 |                        97 |                    3 |
| vela-state-changes                 | optical          |             3 / 3 |                                            24 / 24 / 24 |                        97 |                    0 |
| integrated-focus-stream            | optical          |             3 / 3 |                                            24 / 24 / 24 |                        97 |                    0 |
| focused-native-resize              | optical          |             3 / 3 |                                            24 / 24 / 24 |                        97 |                    0 |
| ambient-idle                       | optical          |             3 / 3 |                                            24 / 24 / 24 |                        97 |                    0 |
| ambient-off                        | optical          |             3 / 3 |                                            24 / 24 / 24 |                        97 |                    0 |
| quiet-static                       | optical          |             3 / 3 |                                            24 / 24 / 24 |                        97 |                    0 |
| reduced-motion-static              | optical          |             3 / 3 |                                            24 / 24 / 24 |                        97 |                    0 |
| native-minimized                   | optical          |             3 / 3 |                                            24 / 24 / 24 |                        97 |                    0 |

The selected receipt records these relevant checks; their state/continuity results do not award artistic acceptance:

- three instrument studies retain canonical resources, editable drafts and original DOM: **passed**.
- warmed instrument switching does not grow live geometry or reported allocation counters: **passed**.
- five seconds without input advances the real orbital clock and geometry angle: **passed**.
- instrument study and original editors survive actual graphics restoration: **passed**.

## Historical named-workload comparison

### Original V3 baseline

The preserved V3 checkpoint was rebuilt and rerun before V3.5 work: [original baseline receipt](evidence-v3-5/baseline/verification.json), captured 2026-11-01T20:15:14.807Z, 37/37 native checks. Its final content bounds were 1600×1001, display scale 1.25, reported 165 Hz. The nominal window/camera and same-named tier/transition scripts provide a direct historical reference. The instrument candidate adds a starfield, deeper ring, shadows, physical foreground structures, revised materials and richer synthetic reading content; desktop load and capture retention are uncontrolled. This is not a pixel-identical scene, an isolated effect benchmark or proof of better monitor presentation.

| Scenario               | V3 / instrument callback p95 ms | V3 / instrument submission p95 ms | V3 / instrument CPU reported sum mean % | V3 / instrument working-set mean MiB |
| ---------------------- | ------------------------------: | --------------------------------: | --------------------------------------: | -----------------------------------: |
| balanced-active-1      |                     6.20 / 6.20 |                     18.30 / 18.30 |                             5.61 / 5.67 |                    1161.62 / 2367.44 |
| cinematic-transition-1 |                   18.20 / 12.10 |                     18.20 / 12.10 |                           11.89 / 13.33 |                    1206.10 / 2439.48 |
| efficient-1            |                   78.80 / 78.80 |                     78.80 / 78.80 |                             1.54 / 0.99 |                    1251.84 / 2439.26 |
| balanced-active-2      |                     6.20 / 6.20 |                     18.30 / 18.30 |                             5.54 / 5.31 |                    1176.18 / 2409.33 |
| cinematic-transition-2 |                    18.30 / 6.20 |                      18.30 / 6.20 |                           11.75 / 12.63 |                    1243.01 / 2431.71 |
| efficient-2            |                   78.70 / 78.70 |                     78.70 / 78.70 |                             1.30 / 0.96 |                    1222.81 / 2453.39 |

### Qualified celestial / a01 reference

The preceding [a01 celestial receipt](evidence-celestial/review-radius-motion/verification.json) was captured 2026-11-01T21:28:57.590Z, source `a01eb8a35858cda4764e0e637e63b2af1555d0a3`, with 53/53 native checks and 36 scenarios. It includes the radius-30 rotating ring and sky before foreground instrument integration. Same-named scripts provide the immediate reference, but foreground geometry/materials, capture retention and uncontrolled desktop load differ. These differences do not isolate one shader's cost or prove a presentation improvement.

| Scenario               | a01 / instrument callback p95 ms | a01 / instrument submission p95 ms | a01 / instrument CPU reported sum mean % | a01 / instrument working-set mean MiB |
| ---------------------- | -------------------------------: | ---------------------------------: | ---------------------------------------: | ------------------------------------: |
| balanced-active-1      |                      6.20 / 6.20 |                      18.30 / 18.30 |                              7.72 / 5.67 |                     2105.85 / 2367.44 |
| cinematic-transition-1 |                    18.20 / 12.10 |                      18.20 / 12.10 |                            12.13 / 13.33 |                     2154.05 / 2439.48 |
| efficient-1            |                    78.80 / 78.80 |                      78.80 / 78.80 |                              0.85 / 0.99 |                     2134.38 / 2439.26 |
| balanced-active-2      |                      6.20 / 6.20 |                      18.30 / 18.30 |                              4.89 / 5.31 |                     2068.15 / 2409.33 |
| cinematic-transition-2 |                     12.30 / 6.20 |                       12.30 / 6.20 |                            12.68 / 12.63 |                     2174.26 / 2431.71 |
| efficient-2            |                    78.80 / 78.70 |                      78.80 / 78.70 |                              0.75 / 0.96 |                     2217.86 / 2453.39 |

## Input, startup and memory limits

16 programmatic DOM click-dispatch→coordinator samples: p50 0.90 ms, p95 2.50 ms, maximum 2.50 ms. This excludes OS input injection, monitor presentation and optical latency. Native module evaluation→local renderer load is 918 ms, not OS cold startup. Video encoder rate and encoded packet PTS are not presented application FPS.

Across the capture-heavy benchmark's scenario-level working-set means, the first is 2367.44 MiB, the maximum is 3763.26 MiB, and the last is 830.36 MiB. These are means of separate workloads, not a continuous unique-resident-memory trace. Retained capture/browser allocations, changing bounds and shared-page accounting complicate attribution.

## Separate fresh-process probe

[Separate memory receipt](evidence-instruments/fresh-process-memory.json): 90.01 seconds, declared source revision `1f46e11a22e3f124222b457dbfbde45811d3524f`. Its src/ hashes match the native performance run. The recorded screenshot count is 0 and recording flag is false. Sampled working-set sums start at 519.06 MiB, peak at 988.46 MiB and end at 578.55 MiB. Shared pages may be counted repeatedly.

| Phase                        | Seconds | Scene submissions including entry | First MiB | Last MiB | Delta MiB | CPU reported sum mean % |
| ---------------------------- | ------: | --------------------------------: | --------: | -------: | --------: | ----------------------: |
| architecture-visible-ambient |   12.43 |                               733 |    519.06 |   518.04 |     -1.02 |                    2.20 |
| living-visible-ambient       |   12.44 |                               733 |    519.99 |   523.01 |      3.02 |                    1.93 |
| resource-expand-return       |   12.43 |                               737 |    569.83 |   824.82 |    254.98 |                    9.52 |
| focused-long-conversation    |   12.44 |                               734 |    848.85 |   872.23 |     23.38 |                    2.70 |
| environment-retarget         |   12.45 |                               750 |    907.94 |   979.05 |     71.11 |                    4.31 |
| quiet-static                 |   12.45 |                                 5 |    988.46 |   591.30 |   -397.16 |                    0.48 |
| native-minimized             |   12.32 |                                 0 |    588.25 |   578.55 |     -9.70 |                    0.08 |

Short growth and partial recovery do not establish leak freedom or long-term stability. Entry/reconciliation draws in a memory-probe phase are distinct from the separately warmed steady-state Quiet/minimized verification samples. Neither zero scene submissions nor a lower working set proves zero CPU work or energy savings.

The probe's native-harness revision is `1f46e11a22e3f124222b457dbfbde45811d3524f`; only `memoryProbe()` in `native/main.cjs` changed from the **831 frontend** verified by 57 native checks. Every `src/` hash and built-asset hash matches that frontend's receipt. This distinction does not silently rebind the graphics matrix to a different application implementation.

Preflight lasted 2.363 seconds and recorded one activation of the owned window after initial visible/unhidden/controller-active observations still showed no frames or callbacks. Actual rendering and clock advancement were then observed before warm-up. The 90.006-second probe window includes three seconds of warm-up and approximately 86.95 seconds across the seven sampled phases; the 2.363-second preflight is separate. All five intended-active phases retained positive 1601×1002 native bounds, unhidden/active state and actual frame/callback/clock advancement. Initial bounds are preserved separately from the final minimized 0×0 bounds. Quiet recorded 5 entry/reconciliation submissions; minimize recorded 0. These are separate from warmed zero-submission verifier samples.

The 91 shared-page-counting samples grow during resource expansion by 254.98 MiB within that phase and later partially recover. This is neither proof of a retained leak nor evidence of leak freedom. The [failed first 831 repeat](evidence-instruments/failed-memory-probe-831aadb.json) had zero runtime activity and is invalid for active-memory claims; its raw samples remain preserved. The [earlier valid 759 probe](evidence-instruments/fresh-process-memory-7598227.json) and [759 report](PERFORMANCE-INSTRUMENTS-V3.5-7598227.md) remain historical.

## Outstanding qualification and storage

[Tool discovery](evidence-v3-5/performance-tools.json) found WPR/WPA and NVIDIA tooling, but PresentMon was absent from PATH and matching NVIDIA memory entries returned nonnumeric values. Tool availability is separate from a decoded, application-attributed timing, VRAM or energy trace. Physical 60 Hz, attributable GPU utilization/memory, power/thermals, long-run memory stability, mixed-DPI/multi-display, assistive-technology and sustained owner motion comfort remain unqualified unless later evidence explicitly supplies them. Functional checks do not award an artistic pass to the starfield, ring or lighting.

ReserveGuard enforces the task's instruction/monitoring policy with separate 30 GiB floors for C: and D:. Each native pass admits up to 256 MiB, including a capped 190 MiB PNG writer and profile/report headroom; raw motion frames are downscaled and labeled separately from full native stills. Broader local writer allowances and rechecks remain necessary. This is not an OS quota and cannot stop unrelated apps, cloud jobs or processes that did not load the rule. Retained evidence and unrelated user data were not deleted to create space.
