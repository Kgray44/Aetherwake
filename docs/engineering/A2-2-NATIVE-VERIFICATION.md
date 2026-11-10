# A2.2 native and integration verification

Program A, Architecture Recovery. The [routing and execution report](A2-2-ROUTING-AUTHORIZATION-COORDINATION.md) records the owner matrix, fault cases and A2.3 handoff.

## Integrated A2.1 base

[PR #26](https://github.com/Kgray44/Aetherwake/pull/26) merged by GitHub merge commit into `main`. Its final head was `26862c876f75144cdcf4820926aadf8e7294e3d4`. The merge commit and A2.2 starting revision are `3fbb421a743d989993fae8c5d16f8e87e045383c`. The merge's first parent was `58c17f0b0db023fb1f0ecfa7b51d50cc0c9d14f2`, its second parent was the reviewed head, and its tree matched that head.

The independent source review found no merge blocker. Ten focused A2.1 tests and eleven provider-storage tests passed locally. Exact-head [governance](https://github.com/Kgray44/Aetherwake/actions/runs/42753540314) and [Linux and Windows integration](https://github.com/Kgray44/Aetherwake/actions/runs/42753540340) passed. An earlier Windows job timed out on a native mission fixture. Attempt 1 on the final head passed Windows but failed Linux in the provider-storage lease-renewal fixture. Those attempts remain part of the record. The merge revision separately passed [governance](https://github.com/Kgray44/Aetherwake/actions/runs/42760930032) and the manually dispatched [integrated application workflow](https://github.com/Kgray44/Aetherwake/actions/runs/42760954643). Its Linux and Windows jobs each passed all 17 cross-package groups. The Windows job also passed the desktop build and addon contract.

## A2.2 candidate and Windows native checks

The runtime and regression tests are in `f8cc8bbb1d6fe5fcf32f530da1932d5c16a634e8`. Tests used Windows x64, Node 24.18.0, the locked Electron runtime, bounded offline fixtures and private disposable profiles. The profiles, temporary files and dependency caches used the work drive. The first local packaging-contract attempt used the generic npm cache and reported five missing owned tarball proof failures. It also used the default temporary directory on C:. The rerun used the workflow's provider-local cache and the D: temporary directory. All 21 review contract tests passed. The production build passed with Vite's chunk-size advisory. The Windows system addon contract passed against the unchanged native sources and inspected real memory and process facts.

| Command or journey | Result and private receipt ID |
|---|---|
| `npm --prefix prototypes/integrated-backend run typecheck` and Vela Core `tsc --project` | Passed. |
| `node scripts/governance-router.mjs --validate`, router V2 tests, link and strict context validation | Passed, including 38 router tests and 82 of 82 essential rules in the strict fixtures. |
| `node scripts/run-aerynth-acceptance.mts` | Passed all 17 groups on `f8cc8bb`. Integrated backend had 809 pass, 2 opt-in skips, 0 failures, including all 11 new regressions. Desktop contract group had 696 pass, 1 opt-in skip, 0 failures. Private receipt `acceptance-f8cc8bb.log`. |
| `npm --prefix prototypes/visual-experience/cinematic-v3 run build` and `node --test prototypes/visual-experience/cinematic-v3/tests/windows-system-build.test.mjs` | Passed desktop build and Windows addon contract. |
| `npm --prefix prototypes/visual-experience/cinematic-v3 run verify:application`, first run | Initial journey passed. The launcher blocked restore because Core changed between launch and the restore source check. Receipt `review-expanded-application-1794288423281.runner-logs/runner.json`. |
| Same expanded application command, frozen runtime | Initial branch and camera checks passed. Journey failed at the spatial drag gate with `No exposed isolated projected body drag path`. Restore did not run. Receipt `review-expanded-application-1794288665530.runner-logs/runner.json`. |
| `node --experimental-strip-types scripts/verify-living-instruments-native.mjs` | Passed 9 of 9. Canonical plan edit and undo, Stream, timer, and exact Timeline restart. Zero renderer errors. Receipt `review-living-instruments-1794288769348/living-instruments-evidence/journey.json`. |
| Same Living Instruments command with `--mission-only` | Passed 6 of 6. Native dependency and source evidence, Timeline and same-profile mission restart. Zero renderer errors. Receipt `review-living-instruments-1794288813381/living-instruments-evidence/journey.json`. |
| Same expanded application command, fresh-profile retry on `f8cc8bb` | Initial camera checks passed. Journey timed out waiting for the selected resource neighborhood. Restore did not run. Receipt `review-expanded-application-1794288886700.runner-logs/runner.json`. |
| Same Living Instruments command with `--family-only` | Passed 5 of 5. Note and Manual Task edits and canonical restart. Zero renderer errors. Receipt `review-living-instruments-1794288828879/living-instruments-evidence/journey.json`. |

Runtime source hashes were identical before and after the frozen native batch and match the runtime in `f8cc8bb`. Electron native journeys exercised real connected application code and synthetic resources. Provider POSTs in backend tests used offline doubles. Live provider, physical input, monitor presentation and artistic qualification are outside these receipts.

The independent reviewer identified a deferred-admission grant/counter mutation, a foreground ownership race and a path that could downgrade an unknown settlement. Those were corrected. Deferred release and synchronous observer regressions protect the updated boundaries. Independent source re-review found no remaining high or critical issue within the reviewed scope. Codex pre-binding event attribution, graceful shutdown drain and the bounded renderer replay contract remain follow-ups.

The installed reserve guard was checked before storage-consuming stages. A system-managed pagefile growth reduced the C: margin during the task. The guard applies to admitted task-owned work on this host. It does not enforce an operating-system quota or govern unrelated applications, already-running processes or cloud jobs.

## Final routing addendum and expanded Windows diagnosis

The audit reran the expanded Electron journey on the frozen routing and execution candidate `a957ae0f7980fffa14febed6d319061fa75c4471`. The launcher passed typecheck, build and preparation. The actual journey passed the reviewed conversation-branch and camera checks, then rejected all 73 proposed drag points before issuing native drag input. Restore did not start. Receipt `review-expanded-application-1794291968422.runner-logs/runner.json`. No renderer or harness assertion was bypassed.

- **Concurrent source change.** The first expanded attempt passed 12 of 12 initial checks. Core’s hash differed between launch and the post-journey check, so the launcher correctly stopped before restore. The later frozen runs isolated this separately.
- **Drag harness.** The focused failure receipt shows the target visible and a conservative workspace envelope covering every candidate point. Replaying the existing solver on that captured geometry reproduces the 73-point rejection. The renderer’s closest mesh-ray picker and the harness’s projected-circle exclusion have different acceptance criteria. A failed input-admission check leaves the physical drag itself untested.
- **Neighborhood navigation.** The resource was selected correctly. The renderer’s pre-navigation flush propagated `stale_view_conversation_revision` from a queued position save and stopped the Explore command before setting the neighborhood. Source inspection confirms the conversation owner correctly rejected the old revision. The exact capture timing needs a separate renderer trace. The two frozen original candidate runs had matching 581 source hashes and seven asset hashes, foreground focus and zero renderer errors.
- **Baseline comparison.** The same launcher on the merged A2.1 tree aborted earlier at `native_owner_window_inactive`. Receipt `review-expanded-application-1794289714910.runner-logs/runner.json`. That comparison cannot qualify either spatial path.

Expanded Windows renderer qualification stays open. The drag harness and navigation flush have separate A2.3 owners. The receipts establish neither a routing regression nor an exact expanded same-profile restore. The passing Living Instruments, mission and family journeys cover their named restart scenarios. Existing retry and failure receipts remain in private custody.

The final audit runtime is 91da23357dd9dff1a63ddb6ae6757e579293aee5. A broad working-candidate run passed 216 focused tests. The final delta reran the exact timer denial, compound/selected-context routing, retired Codex sequence and catalog-release regressions. Backend and Vela Core typechecks passed. The PR records final-head hosted checks separately from these local runs.
