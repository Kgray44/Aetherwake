# A2.3 native verification ledger

See [renderer and application coordination](A2-3-RENDERER-APPLICATION-COORDINATION.md) for ownership and remaining acceptance. The baseline is the source tree merged as `0287db1c56a87230f7592a730e6cdb42a88c123c`. Its independent [post-merge governance](https://github.com/Kgray44/Aetherwake/actions/runs/42880292301) and [post-merge integration](https://github.com/Kgray44/Aetherwake/actions/runs/42880301280) passed. Windows integration covered desktop build, the native addon boundary, worker-loss recovery and 17 cross-package groups. A second local Windows run from the exact merge also passed 17 groups.

## Windows environment and baseline

Windows 11 x64 build 26300, Node 24.18.0 and Electron 45.2.1. The checkout, dependencies, temp, Chromium state and evidence used disposable D: locations. Each native launch started with a fresh synthetic profile. Restore reused that exact profile. The installed guard admitted work before writing stages. The reserve is a host instruction and admission check. External applications, preexisting writers and hosted runners operate outside that check.

The A2.2 qualification attempt on `cb5225a` used dependency junctions and Vite rejected a file whose real path was outside the reviewed checkout. Its failure receipt remains. A checkout-owned dependency copy corrected the setup. On `9bb10da`, the first expanded journey reached six checks before the native window lost foreground ownership. A subsequent run passed 12 initial checks and its fresh process verified the canonical restore before a later focus loss. The retained A2.2 drag and stale-view failures remain referenced in the [A2.2 ledger](A2-2-NATIVE-VERIFICATION.md).

## Commands and frozen runtime

The first A2.3 runtime freeze was `1e3f03518e385e75f2f2455d3171ea6cde974be2`. It passed backend and desktop typechecks, the production desktop build, the expanded application with 12 initial checks and one exact same-profile restore check, Living Instruments 9 of 9, mission 6 of 6 and family 5 of 5. Those results used the normal connected Electron app and offline fixtures. The second freeze `427fd7a99b6e759465f64d22705cbd1f8825f0ad` retained the scoped compatibility alias for older review clients. Local Windows cross-package acceptance passed 17 of 17 groups on that freeze. The final source `ae69b0134cb68ad89fb17c2f70e866f00a6c2c09` distinguishes provider-only invalidations from workspace access changes.

| Command | Evidence |
|---|---|
| `npm --prefix prototypes/integrated-backend run typecheck` | Passed before runtime freeze. |
| `npm --prefix prototypes/visual-experience/cinematic-v3 run typecheck` | Passed on the frozen renderer source. |
| `npm --prefix prototypes/visual-experience/cinematic-v3 run build` | Passed at the first runtime freeze. Vite emitted a chunk-size advisory. |
| `npm --prefix prototypes/visual-experience/cinematic-v3 run verify:application` | The first freeze passed typecheck, build, preparation, the expanded journey and same-profile restore. Private receipt `review-expanded-application-1794340152383.runner-logs/runner.json`. |
| `node --experimental-strip-types scripts/verify-living-instruments-native.mjs` | First freeze passed 9 of 9. Private receipt `review-living-instruments-1794340241814/living-instruments-evidence/journey.json`. |
| Same command with `--mission-only` | First freeze passed 6 of 6, including same-profile mission evidence and graph binding. Private receipt `review-living-instruments-1794340277443/living-instruments-evidence/journey.json`. |
| Same command with `--family-only` | First freeze passed 5 of 5, including same-profile Note and Manual Task recovery. Private receipt `review-living-instruments-1794340289394/living-instruments-evidence/journey.json`. |

The second freeze repeated the connected journeys after the IPC compatibility change.

| Second-freeze journey | Result | Private receipt |
|---|---|---|
| Expanded application | 12 initial checks and one exact same-profile restore check. All five launcher stages passed. | `review-expanded-application-1794340343576.runner-logs/runner.json` |
| Living Instruments | 9 of 9, including exact Timeline restore. Zero renderer errors. | `review-living-instruments-1794340430327/living-instruments-evidence/journey.json` |
| Mission | 6 of 6, including retained evidence after restart. Zero renderer errors. | `review-living-instruments-1794340465610/living-instruments-evidence/journey.json` |
| Family | 5 of 5, including restored Note and Manual Task edits. Zero renderer errors. | `review-living-instruments-1794340477274/living-instruments-evidence/journey.json` |


| Final-runtime journey | Result | Private receipt |
|---|---|---|
| Expanded application | 12 initial checks and one exact same-profile restore check. All five launcher stages passed. | `review-expanded-application-1794340936122.runner-logs/runner.json` |
| Living Instruments | 9 of 9, including exact Timeline restore. Zero renderer errors. | `review-living-instruments-1794341025835/living-instruments-evidence/journey.json` |
| Mission | 6 of 6, including retained evidence after restart. Zero renderer errors. | `review-living-instruments-1794341061423/living-instruments-evidence/journey.json` |
| Family | 5 of 5, including restored Note and Manual Task edits. Zero renderer errors. | `review-living-instruments-1794341073509/living-instruments-evidence/journey.json` |

The owned-process check found no Electron or backend process remaining under the A2.3 checkout. The final focused replay and conversation-adapter run passed 16 of 16. The final default Living Instruments run measured 240 callback intervals, p50 6.1 ms, p95 6.2 ms and p99 6.2 ms. It took 34.3 seconds end to end.


Private receipts remain under the task evidence root and the checkout’s private application evidence folder. The app was tested with ordinary Electron pointer commands and canonical SQLite fixtures. The runner exercised the normal layout, conversation, permission and navigation paths. A full forced dropped-event and reconnect matrix in Electron, live Codex interruption, physical input, mixed displays, artistic acceptance and production performance remain separate.

## Connected interruption probe

The Windows probe used the built Electron app and a dedicated synthetic SQLite profile. Test instrumentation withheld one live `application/createResource` notice and one successful Vela IPC response. The renderer recovered the note event from the retained page after cursor 2 and rendered the same event at cursor 3. In the first run, the Vela composer stayed busy while Core already recorded the provider-free request as `responded`.

After the correction, the composer displayed `responded` and cleared `aria-busy` with the original IPC response still withheld. The renderer read the canonical request correlated by the native host, without sending again. The probe then terminated its owned backend, observed the disconnect in Electron, and started a new process on the same profile. The exact request ID and one copy of the note remained. The replacement app exited normally.

Private receipts are `Aetherwake-A2-3-interruption/1794355841845/receipt.json` and `Aetherwake-A2-3-interruption/1794356116658/receipt.json`. The interruption occurred after the request was terminal. An in-flight signed-in Codex turn, pending native authorization during interruption, and the full forced replay and reconnect matrix remain open.

## Bounded performance observations

A paired descriptive read of the default Living Instruments receipts used 240 renderer callback intervals per run. Baseline and first A2.3 freeze both reported p50 6.1 ms, p95 6.2 ms and p99 6.3 ms, with zero intervals over 16.67 ms. End-to-end runner elapsed time was 36.7 seconds on the baseline and 34.3 seconds on the first freeze. The second freeze measured p50 6.1 ms, p95 6.2 ms, p99 6.2 ms, and 34.0 seconds elapsed. These single observations include fixture and renderer work. They do not establish a speedup, monitor presentation timing, input latency or a memory-leak result. Initial hydration, replay IPC and backlog performance need independently repeated measurement.
