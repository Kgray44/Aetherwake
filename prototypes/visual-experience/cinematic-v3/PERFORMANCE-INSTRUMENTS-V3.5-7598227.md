# Foreground instrument V3.5 performance evidence — preceding 7598227 checkpoint

This report covers the foreground-instrument addendum and retains the qualified a01 celestial candidate as its immediate historical baseline. All values come from the explicit instrument receipt below; no earlier visual or functional result is relabeled as verification of these materials and structures.

Native receipt: [evidence-instruments/review-thin-lens/verification.json](evidence-instruments/review-thin-lens/verification.json), captured 2026-11-01T22:10:36.111Z, SHA-256 `bd09ba1883cf61e0f673af6433eddcc922a57f0653caff4a81c85714f8ee9771`. Launch HEAD: `759822708d93595b2c7c0b3b2ee23e8be9507f69`; the receipt's source and built-asset hashes identify the actual local candidate, including working-tree changes. **56/56 native checks passed**, 0 failed; **44 scenarios** were measured. Expected counts are never substituted for these observed results. No owner artistic acceptance or production qualification is implied.

[Source-test receipt](evidence-instruments/source-tests-7598227.json): **54/54 passed**, 0 failed. Declared source revision: `759822708d93595b2c7c0b3b2ee23e8be9507f69`. Its complete src/ hash envelope matches this native receipt.

Electron 45.2.1, Chromium 156.0.8078.75, Node 24.22.1. Display 2048×1280, scale 1.25, reported 165 Hz. Final native content bounds 1600×1001. Every measured scenario explicitly records a released environment phase override; held-phase exploration images are excluded from real-time performance claims.

## Method and interpretation

The visible native-window lab uses synthetic working content and ordinary desktop background load. It continues rendering while another app has focus, preventing an unannounced blur-pause sample. Normal operation pauses on blur; native minimize, Ambient Off, Quiet and reduced motion are separately exercised. Scenario receipts preserve actual durations, state, workload and 1,200 ms warm-up. Screenshots precede measurement and are excluded from sample windows; retained captures and compositor/browser allocations can still affect memory. Recordings are separate and add capture/encoding overhead.

Callback intervals are scheduler observations. Scene submissions count coordinated Environment.render calls, each of which may contain several renderer passes. **Neither is presented FPS.** CPU values sum Electron-reported process percentages. Working-set sums may count shared pages multiple times and are neither unique resident memory nor VRAM. The 60 Hz / 120 Hz reference intervals are 16.67 / 8.33 ms; a requested submission cadence is not a physical display-mode or presentation qualification.

## Observed tradeoffs

Balanced submission p95 was 18.30 ms in both repetitions, matching the same-named a01 and original V3 samples. Its reported CPU sums were 5.86% and 5.70%, versus a01's 7.72% and 4.89%; this mixed change does not establish a stable CPU improvement. Cinematic transition CPU was 12.81% / 14.13%, versus a01's 12.13% / 12.68%. The Optical Balanced last-frame count retained 39 draw calls while submitted triangles increased from a01's 149,142 to 160,840 (+11,698, about 7.84%). These draw counters include three passes and shadows; callback/submission timing is not physical display presentation.

Working-set scenario means rose from 2,076.60 MiB to a peak of 3,293.01 MiB before falling to 781.81 MiB when minimized. These capture-heavy, shared-page-counting observations warrant a separate fresh-process probe; they do not support a leak-free claim. Quiet, Ambient Off, reduced motion and minimize each recorded zero steady-state scene submissions. Reduced motion still reported 2.65% summed CPU, illustrating that zero submissions do not establish zero background work or energy savings.

The real 5,002 ms no-input motion check advanced the optical clock 5.0002 seconds and the natural ring angle .01200048 radians with no presentation override. Quiet independently held that clock exactly unchanged. Warmed study switching retained 93 live WebGL geometries and reported instrument construction counts of 24 geometries and 24 materials; these are resident constructor-owned counts, not a universal allocation-free guarantee. All three studies retained canonical content, editable drafts and original articles/editors, including graphics restoration.

## Native workload samples

| Scenario                           | Callback samples |             Callback p50 / p95 / p99 ms | Scene submissions | Submission p95 ms | CPU reported sum mean % | Working-set sum MiB |
| ---------------------------------- | ---------------: | --------------------------------------: | ----------------: | ----------------: | ----------------------: | ------------------: |
| balanced-active-1                  |              743 |                      6.10 / 6.20 / 6.20 |               270 |             18.30 |                    5.86 |             2076.60 |
| cinematic-transition-1             |              721 |                     6.10 / 6.20 / 12.10 |               721 |              6.20 |                   12.81 |             2172.53 |
| efficient-1                        |               76 |                   60.70 / 78.90 / 78.90 |                68 |             78.90 |                    0.84 |             2292.17 |
| balanced-active-2                  |              743 |                      6.10 / 6.20 / 6.20 |               271 |             18.30 |                    5.70 |             2351.85 |
| cinematic-transition-2             |              501 |                    6.10 / 12.20 / 12.30 |               501 |             12.20 |                   14.13 |             2517.48 |
| efficient-2                        |               72 |                   64.94 / 78.80 / 78.90 |                67 |             78.80 |                    0.97 |             2534.69 |
| cinematic-active                   |              741 |                      6.10 / 6.20 / 6.20 |               741 |              6.20 |                    7.59 |             2507.72 |
| celestial-starlit-ambient-1        |              493 |                      6.10 / 6.20 / 6.20 |               180 |             18.30 |                    6.30 |             2498.78 |
| celestial-shadow-ambient-1         |              491 |                     6.10 / 6.20 / 12.10 |               181 |             18.30 |                    6.77 |             2490.74 |
| celestial-deep-ambient-1           |              494 |                      6.10 / 6.20 / 6.20 |               180 |             18.30 |                    6.36 |             2492.28 |
| celestial-study-switching-1        |              497 |                      6.10 / 6.20 / 6.20 |               180 |             18.30 |                    6.19 |             2501.16 |
| celestial-starlit-ambient-2        |              496 |                      6.10 / 6.20 / 6.20 |               181 |             18.30 |                    5.91 |             2508.66 |
| celestial-shadow-ambient-2         |              495 |                      6.10 / 6.20 / 6.20 |               181 |             18.30 |                    5.53 |             2524.27 |
| celestial-deep-ambient-2           |              496 |                      6.10 / 6.20 / 6.20 |               181 |             18.30 |                    5.39 |             2544.40 |
| celestial-study-switching-2        |              495 |                      6.10 / 6.20 / 6.20 |               180 |             18.30 |                    5.95 |             2573.74 |
| instrument-optical-ambient-1       |              495 |                      6.10 / 6.20 / 6.20 |               180 |             18.30 |                    5.63 |             2659.03 |
| instrument-engineered-ambient-1    |              496 |                      6.10 / 6.20 / 6.20 |               181 |             18.30 |                    5.84 |             2759.08 |
| instrument-composite-ambient-1     |              496 |                      6.10 / 6.20 / 6.40 |               181 |             18.30 |                    5.22 |             2858.19 |
| instrument-study-switching-1       |              497 |                      6.10 / 6.20 / 6.20 |               180 |             18.30 |                    4.97 |             2955.53 |
| instrument-optical-ambient-2       |              495 |                      6.10 / 6.20 / 6.20 |               180 |             18.30 |                    4.96 |             3053.57 |
| instrument-engineered-ambient-2    |              495 |                      6.10 / 6.20 / 6.20 |               180 |             18.30 |                    5.09 |             3156.07 |
| instrument-composite-ambient-2     |              496 |                      6.10 / 6.20 / 6.20 |               181 |             18.30 |                    4.48 |             3253.40 |
| instrument-study-switching-2       |              496 |                      6.10 / 6.20 / 6.20 |               180 |             18.30 |                    2.24 |             3279.77 |
| architecture-ring-ambient-1        |              495 |                      6.10 / 6.20 / 6.20 |               180 |             18.30 |                    2.27 |             3279.77 |
| architecture-aperture-ambient-1    |              495 |                      6.10 / 6.20 / 6.20 |               180 |             18.30 |                    2.45 |             3279.61 |
| architecture-observatory-ambient-1 |              495 |                      6.10 / 6.20 / 6.20 |               180 |             18.30 |                    2.23 |             3281.23 |
| living-ambient-1                   |              496 |                      6.10 / 6.20 / 6.20 |               181 |             18.30 |                    2.03 |             3282.50 |
| architecture-ring-ambient-2        |              432 |                     6.10 / 6.20 / 18.00 |               165 |             18.30 |                    9.14 |             3293.01 |
| architecture-aperture-ambient-2    |              496 |                      6.10 / 6.20 / 6.20 |               181 |             18.30 |                    2.37 |             3249.12 |
| architecture-observatory-ambient-2 |              496 |                      6.10 / 6.20 / 6.20 |               181 |             18.30 |                    2.24 |             3247.60 |
| living-ambient-2                   |              496 |                      6.10 / 6.20 / 6.20 |               181 |             18.30 |                    2.02 |             3248.32 |
| resource-selection                 |              496 |                      6.10 / 6.20 / 6.20 |               180 |             18.30 |                    4.99 |             3245.74 |
| resource-rearrangement             |              740 |                      6.10 / 6.20 / 6.20 |               270 |             18.30 |                    6.65 |             3190.19 |
| focused-long-conversation          |              743 |                      6.10 / 6.20 / 6.20 |               270 |             18.30 |                    3.53 |             3157.63 |
| focused-research-notebook          |              743 |                      6.10 / 6.20 / 6.20 |               270 |             18.30 |                    2.12 |             3162.47 |
| scene-transitions                  |              714 |                      6.10 / 6.20 / 6.20 |               261 |             18.30 |                    5.65 |             3158.93 |
| vela-state-changes                 |              744 |                      6.10 / 6.20 / 6.20 |               270 |             18.30 |                    4.72 |             3136.08 |
| integrated-focus-stream            |              752 |                      6.10 / 6.20 / 6.20 |               278 |             18.30 |                   10.36 |             3199.74 |
| focused-native-resize              |              713 |                     6.10 / 6.20 / 12.10 |               268 |             18.30 |                    8.97 |             3195.99 |
| ambient-idle                       |              240 |                   22.30 / 30.30 / 30.40 |               120 |             37.90 |                    2.05 |             3164.99 |
| ambient-off                        |                0 | unavailable / unavailable / unavailable |                 0 |       unavailable |                    0.05 |             3149.20 |
| quiet-static                       |                0 | unavailable / unavailable / unavailable |                 0 |       unavailable |                    0.02 |             3147.53 |
| reduced-motion-static              |                0 | unavailable / unavailable / unavailable |                 0 |       unavailable |                    2.65 |             2796.85 |
| native-minimized                   |                0 | unavailable / unavailable / unavailable |                 0 |       unavailable |                    0.02 |              781.81 |

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
| balanced-active-1      |                     6.20 / 6.20 |                     18.30 / 18.30 |                             5.61 / 5.86 |                    1161.62 / 2076.60 |
| cinematic-transition-1 |                    18.20 / 6.20 |                      18.20 / 6.20 |                           11.89 / 12.81 |                    1206.10 / 2172.53 |
| efficient-1            |                   78.80 / 78.90 |                     78.80 / 78.90 |                             1.54 / 0.84 |                    1251.84 / 2292.17 |
| balanced-active-2      |                     6.20 / 6.20 |                     18.30 / 18.30 |                             5.54 / 5.70 |                    1176.18 / 2351.85 |
| cinematic-transition-2 |                   18.30 / 12.20 |                     18.30 / 12.20 |                           11.75 / 14.13 |                    1243.01 / 2517.48 |
| efficient-2            |                   78.70 / 78.80 |                     78.70 / 78.80 |                             1.30 / 0.97 |                    1222.81 / 2534.69 |

### Qualified celestial / a01 reference

The preceding [a01 celestial receipt](evidence-celestial/review-radius-motion/verification.json) was captured 2026-11-01T21:28:57.590Z, source `a01eb8a35858cda4764e0e637e63b2af1555d0a3`, with 53/53 native checks and 36 scenarios. It includes the radius-30 rotating ring and sky before foreground instrument integration. Same-named scripts provide the immediate reference, but foreground geometry/materials, capture retention and uncontrolled desktop load differ. These differences do not isolate one shader's cost or prove a presentation improvement.

| Scenario               | a01 / instrument callback p95 ms | a01 / instrument submission p95 ms | a01 / instrument CPU reported sum mean % | a01 / instrument working-set mean MiB |
| ---------------------- | -------------------------------: | ---------------------------------: | ---------------------------------------: | ------------------------------------: |
| balanced-active-1      |                      6.20 / 6.20 |                      18.30 / 18.30 |                              7.72 / 5.86 |                     2105.85 / 2076.60 |
| cinematic-transition-1 |                     18.20 / 6.20 |                       18.20 / 6.20 |                            12.13 / 12.81 |                     2154.05 / 2172.53 |
| efficient-1            |                    78.80 / 78.90 |                      78.80 / 78.90 |                              0.85 / 0.84 |                     2134.38 / 2292.17 |
| balanced-active-2      |                      6.20 / 6.20 |                      18.30 / 18.30 |                              4.89 / 5.70 |                     2068.15 / 2351.85 |
| cinematic-transition-2 |                    12.30 / 12.20 |                      12.30 / 12.20 |                            12.68 / 14.13 |                     2174.26 / 2517.48 |
| efficient-2            |                    78.80 / 78.80 |                      78.80 / 78.80 |                              0.75 / 0.97 |                     2217.86 / 2534.69 |

## Input, startup and memory limits

16 programmatic DOM click-dispatch→coordinator samples: p50 1.80 ms, p95 5.40 ms, maximum 5.40 ms. This excludes OS input injection, monitor presentation and optical latency. Native module evaluation→local renderer load is 1077 ms, not OS cold startup. Video encoder rate and encoded packet PTS are not presented application FPS.

Across the capture-heavy benchmark's scenario-level working-set means, the first is 2076.60 MiB, the maximum is 3293.01 MiB, and the last is 781.81 MiB. These are means of separate workloads, not a continuous unique-resident-memory trace. Retained capture/browser allocations, changing bounds and shared-page accounting complicate attribution.

## Separate fresh-process probe

[Separate memory receipt](evidence-instruments/fresh-process-memory-7598227.json): 90.01 seconds, declared source revision `759822708d93595b2c7c0b3b2ee23e8be9507f69`. Its src/ hashes match the native performance run. The recorded screenshot count is 0 and recording flag is false. Sampled working-set sums start at 511.86 MiB, peak at 977.82 MiB and end at 566.82 MiB. Shared pages may be counted repeatedly.

| Phase                        | Seconds | Scene submissions including entry | First MiB | Last MiB | Delta MiB | CPU reported sum mean % |
| ---------------------------- | ------: | --------------------------------: | --------: | -------: | --------: | ----------------------: |
| architecture-visible-ambient |   12.43 |                               733 |    511.86 |   509.94 |     -1.92 |                    1.99 |
| living-visible-ambient       |   12.43 |                               733 |    514.52 |   518.89 |      4.37 |                    1.80 |
| resource-expand-return       |   12.44 |                               745 |    563.43 |   813.47 |    250.04 |                    8.63 |
| focused-long-conversation    |   12.43 |                               732 |    839.71 |   864.25 |     24.54 |                    2.27 |
| environment-retarget         |   12.43 |                               748 |    898.73 |   961.91 |     63.19 |                    3.34 |
| quiet-static                 |   12.43 |                                 9 |    977.82 |   928.55 |    -49.27 |                    0.61 |
| native-minimized             |   12.34 |                                 1 |    574.73 |   566.82 |     -7.91 |                    0.09 |

Short growth and partial recovery do not establish leak freedom or long-term stability. Entry/reconciliation draws in a memory-probe phase are distinct from the separately warmed steady-state Quiet/minimized verification samples. Neither zero scene submissions nor a lower working set proves zero CPU work or energy savings.

The probe records 95 samples across seven phases with no screenshots, recording or forced GC. The final 0x0 content bounds were sampled after minimize; this field cannot establish visible viewport size. Quiet includes 9 entry/reconciliation submissions and minimize includes 1, distinct from the zero-submission warmed full-verifier windows. Working-set growth during resource expansion (+250.04 MiB within that phase) and later partial recovery remain unresolved observations, not proof of retained leaks or leak freedom.

## Outstanding qualification and storage

[Tool discovery](evidence-v3-5/performance-tools.json) found WPR/WPA and NVIDIA tooling, but PresentMon was absent from PATH and matching NVIDIA memory entries returned nonnumeric values. Tool availability is separate from a decoded, application-attributed timing, VRAM or energy trace. Physical 60 Hz, attributable GPU utilization/memory, power/thermals, long-run memory stability, mixed-DPI/multi-display, assistive-technology and sustained owner motion comfort remain unqualified unless later evidence explicitly supplies them. Functional checks do not award an artistic pass to the starfield, ring or lighting.

ReserveGuard enforces the task's instruction/monitoring policy with separate 30 GiB floors for C: and D:. Each native pass admits up to 256 MiB, including a capped 190 MiB PNG writer and profile/report headroom; raw motion frames are downscaled and labeled separately from full native stills. Broader local writer allowances and rechecks remain necessary. This is not an OS quota and cannot stop unrelated apps, cloud jobs or processes that did not load the rule. Retained evidence and unrelated user data were not deleted to create space.
