# Cinematic V3.5 performance evidence

Native run: 2026-11-01T20:45:50.316Z. Electron 45.2.1, Chromium 156.0.8078.75, Node 24.22.1. Display 2048×1280, scale 1.25, reported 165 Hz. Final content bounds 1600×1001. Source receipt: [verification.json](evidence-v3-5/review-material-final/verification.json). 47/47 native checks passed; 0 failed. No owner acceptance is implied.

## Method and interpretation

This is a visible native-window lab using synthetic working content and ordinary desktop background load. It keeps rendering when another desktop app has focus so measurement does not silently become a blur-pause sample. Normal npm start pauses on blur; minimize, Quiet, Ambient Off and reduced motion are separately exercised. Each scenario records its actual duration, state, 1,200 ms warm-up, workload, and counters in the JSON. Captures precede measurement and are excluded from the sample intervals, but retained capture/compositor allocations can affect memory.

Callback intervals describe scheduler callbacks. Submission intervals describe renderer draws. **Neither is presented FPS.** CPU is Electron's sum of reported process percentages. Working-set sums can count shared pages more than once; they are neither unique resident memory nor VRAM. Efficient intentionally submits less often. No screenshots or recording are taken during the measured scenarios. Repeated short windows and a separate 90-second fresh-process probe are exploratory; they do not establish leak freedom, sustained thermal comfort, energy, or full production performance.

The 60 Hz and 120 Hz reference budgets are 16.67 ms and 8.33 ms. Balanced requests a 60-submission cadence during active use, Efficient a lower cadence, and Cinematic follows the active callback opportunity. These policies are not physical display-mode or presentation qualifications. A proposed review threshold is a stable, responsive Balanced interaction with no unexplained regressions against the same named V3 workloads, zero unnecessary steady-state draws in Quiet/Ambient Off/reduced/minimized conditions, and no lost user state. Production presentation and memory thresholds remain open pending attributable measurements.

## Native workload samples

| Scenario | Callback samples | Callback p50 / p95 / p99 ms | Submissions | Submission p95 ms | CPU reported sum mean % | Working-set sum MiB |
|---|---:|---:|---:|---:|---:|---:|
| balanced-active-1 | 744 | 6.10 / 6.20 / 6.20 | 271 | 18.30 | 6.16 | 1739.90 |
| cinematic-transition-1 | 392 | 12.10 / 18.30 / 24.40 | 392 | 18.30 | 12.16 | 1808.87 |
| efficient-1 | 78 | 60.70 / 78.80 / 78.84 | 68 | 78.80 | 1.15 | 1837.00 |
| balanced-active-2 | 743 | 6.10 / 6.20 / 6.20 | 271 | 18.30 | 6.84 | 1832.71 |
| cinematic-transition-2 | 374 | 12.10 / 24.20 / 30.30 | 374 | 24.20 | 11.93 | 2013.99 |
| efficient-2 | 78 | 60.74 / 78.80 / 78.90 | 68 | 78.80 | 1.11 | 2080.28 |
| cinematic-active | 702 | 6.10 / 6.20 / 18.00 | 702 | 6.20 | 8.47 | 2098.07 |
| architecture-ring-ambient-1 | 496 | 6.10 / 6.20 / 6.20 | 181 | 18.30 | 4.78 | 2086.13 |
| architecture-aperture-ambient-1 | 495 | 6.10 / 6.20 / 6.20 | 180 | 18.30 | 5.49 | 2081.85 |
| architecture-observatory-ambient-1 | 496 | 6.10 / 6.20 / 6.20 | 181 | 18.30 | 5.62 | 2080.72 |
| living-ambient-1 | 495 | 6.10 / 6.20 / 6.20 | 180 | 18.30 | 6.01 | 2083.27 |
| architecture-ring-ambient-2 | 496 | 6.10 / 6.20 / 6.20 | 181 | 18.30 | 5.89 | 2099.08 |
| architecture-aperture-ambient-2 | 496 | 6.10 / 6.20 / 6.20 | 181 | 18.30 | 6.46 | 2118.99 |
| architecture-observatory-ambient-2 | 496 | 6.10 / 6.20 / 6.20 | 181 | 18.30 | 5.93 | 2187.57 |
| living-ambient-2 | 496 | 6.10 / 6.20 / 6.30 | 181 | 18.30 | 5.51 | 2301.32 |
| resource-selection | 495 | 6.10 / 6.20 / 6.30 | 180 | 18.30 | 11.89 | 2435.90 |
| resource-rearrangement | 746 | 6.10 / 6.20 / 6.20 | 270 | 18.30 | 10.23 | 2596.55 |
| focused-long-conversation | 743 | 6.10 / 6.20 / 6.20 | 270 | 18.30 | 4.79 | 2751.68 |
| focused-research-notebook | 744 | 6.10 / 6.20 / 6.30 | 271 | 18.30 | 2.78 | 2787.96 |
| scene-transitions | 708 | 6.10 / 6.20 / 6.40 | 261 | 18.30 | 8.03 | 2826.17 |
| vela-state-changes | 744 | 6.10 / 6.20 / 6.30 | 270 | 18.30 | 5.95 | 2782.23 |
| integrated-focus-stream | 466 | 6.20 / 18.20 / 24.30 | 269 | 24.40 | 16.45 | 2879.27 |
| focused-native-resize | 714 | 6.10 / 6.20 / 18.20 | 270 | 18.30 | 12.05 | 2927.22 |
| ambient-idle | 237 | 22.60 / 30.40 / 36.30 | 121 | 37.80 | 2.36 | 3009.03 |
| ambient-off | 0 | unavailable / unavailable / unavailable | 0 | unavailable | 0.30 | 2994.69 |
| quiet-static | 0 | unavailable / unavailable / unavailable | 0 | unavailable | 6.82 | 2960.19 |
| reduced-motion-static | 0 | unavailable / unavailable / unavailable | 0 | unavailable | 0.30 | 909.57 |
| native-minimized | 0 | unavailable / unavailable / unavailable | 0 | unavailable | 0.10 | 887.48 |

## Matched named V3 comparison

V3 was rebuilt from the clean local checkpoint and rerun before implementation: 2026-11-01T20:15:14.807Z. The same window/camera and named tier/transition scripts provide a useful reference. V3.5 now explicitly seeds these named samples to the architectural ring workspace. Its geometry, ribbon and synthetic reading workload are richer; desktop background load and capture retention are uncontrolled. This comparison cannot isolate the cost of one shader or prove that a callback difference is a presentation improvement.

| Scenario | V3 / V3.5 callback p95 ms | V3 / V3.5 submission p95 ms | V3 / V3.5 CPU reported sum mean % |
|---|---:|---:|---:|
| balanced-active-1 | 6.20 / 6.20 | 18.30 / 18.30 | 5.61 / 6.16 |
| cinematic-transition-1 | 18.20 / 18.30 | 18.20 / 18.30 | 11.89 / 12.16 |
| efficient-1 | 78.80 / 78.80 | 78.80 / 78.80 | 1.54 / 1.15 |
| balanced-active-2 | 6.20 / 6.20 | 18.30 / 18.30 | 5.54 / 6.84 |
| cinematic-transition-2 | 18.30 / 24.20 | 18.30 / 24.20 | 11.75 / 11.93 |
| efficient-2 | 78.70 / 78.80 | 78.70 / 78.80 | 1.30 / 1.11 |

## Input, startup, and evidence limits

16 programmatic DOM click-dispatch→coordinator samples: p50 2.50 ms, p95 3.00 ms, max 3.00 ms. This excludes OS input injection, presentation and optical latency. Separate native-input review establishes only the exercised input behavior.

Native module evaluation→renderer load: 982 ms; not OS cold startup. Build hashes and capture dimensions/state are retained in the receipt. Recording encoder rate is never used as application FPS.

Tool discovery found WPR/WPA and NVIDIA tooling, but PresentMon was unavailable and matching NVIDIA memory entries returned nonnumeric values. No decoded application-attributed present, VRAM or energy trace was obtained. A global GPU total would not fill those gaps. [Tooling receipt](evidence-v3-5/performance-tools.json) records availability separately from measurements. Physical 60 Hz, attributable GPU utilization/memory, power, mixed-DPI/multi-display, prolonged load and sustained owner motion comfort remain unverified.

## Storage discipline

The local work uses ReserveGuard with separate 30 GiB floors for C: and D:. Verification admits up to 256 MiB including its capped 190 MiB PNG writer and profile/receipt headroom; the task also uses a broader bounded local allowance. The guard is an instruction/monitor, not an OS quota. It cannot stop unrelated applications, cloud jobs, or local processes that did not load the rule. No user files, games, unique history, unrelated work or retained evidence were deleted.

## Fresh-process memory probe

[The separate receipt](evidence-v3-5/fresh-process-memory.json) records 90.01 seconds with a fresh dedicated profile, no screenshots, no video and no forced collection. The sampled summed working set starts at 560.87 MiB, reaches 1148.66 MiB, and ends at 690.77 MiB. These sums can double-count shared pages.

| Phase | Seconds | Submissions including entry transitions | First MiB | Last MiB | Delta MiB | CPU reported sum mean % |
|---|---:|---:|---:|---:|---:|---:|
| architecture-visible-ambient | 12.43 | 733 | 560.87 | 562.05 | 1.18 | 2.21 |
| living-visible-ambient | 12.43 | 727 | 566.22 | 568.61 | 2.39 | 1.85 |
| resource-expand-return | 12.43 | 733 | 643.63 | 985.43 | 341.79 | 11.69 |
| focused-long-conversation | 12.43 | 733 | 1006.96 | 955.72 | -51.24 | 2.53 |
| environment-retarget | 12.47 | 748 | 1015.20 | 1146.28 | 131.07 | 6.51 |
| quiet-static | 12.43 | 7 | 1148.66 | 697.93 | -450.73 | 0.44 |
| native-minimized | 12.34 | 0 | 694.26 | 690.77 | -3.49 | 0.07 |

The full capture-heavy verification grows from about 1.7 GiB to about 3 GiB in summed working sets before falling below 1 GiB during static/reduced/minimized samples. The fresh process starts much lower, but repeated resource resizing and scene changes still produce growth before partial recovery. Browser/compositor caches, deferred collection and working-set double counting are possible contributors; attribution is unproven. The material benefit does not erase this cost. Longer matched V3/V3.5 memory investigations and application-attributed presentation measurements remain required before production acceptance.

Quiet's probe count includes a few entry/reconciliation draws. The separately warmed steady-state native Quiet sample has zero draws. Minimized has zero draws in both measurements. Neither observation establishes zero total CPU work, energy savings or long-term leak freedom.
