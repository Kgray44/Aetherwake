# Missions 01–04 integration

This draft assembles Architecture Recovery A3 and A4 and Fluid Intelligence FI-0 through FI-3 for integrated review. The source owners continue to develop and qualify their individual PRs. The assembly starts from main at `7747e8c723b5961d6edfd6fb75758a50e87e7ac6` and retains the existing SQLite owners, provider ledger, MissionService, Performance Governor, and renderer authority.

## Pinned source heads

| Mission | Published stack | Included source head |
| --- | --- | --- |
| 01, storage and retrieval | [#36](https://github.com/Kgray44/Aetherwake/pull/36) | `c5ac3c3399b44f957e47f679cb2bb8b7f0736494` |
| 01, runtime recovery | [#38](https://github.com/Kgray44/Aetherwake/pull/38) | `d422229aa3753099b43ba3c87adc8c2489bfae41` |
| 01, common contracts | [#40](https://github.com/Kgray44/Aetherwake/pull/40) | `5a72594b2259d850da70810183234797d2e34ab1` |
| 02, profiling | [#41](https://github.com/Kgray44/Aetherwake/pull/41) | `f32a45ed238653755258baf609abfd6be3f6d18c` |
| 03, resources | [#37](https://github.com/Kgray44/Aetherwake/pull/37), [#39](https://github.com/Kgray44/Aetherwake/pull/39), [#42](https://github.com/Kgray44/Aetherwake/pull/42) | `dba23af15968ddf937e1cfc334d62f361de55ffe` |
| 04, cognition | [#43–52 stack tip](https://github.com/Kgray44/Aetherwake/pull/52) | `54235d1e35cdbb0f3a759803cbd5286ff58d31ec` |

The integration branch replays and reconciles the source changes. Its commit IDs differ from the individual branch IDs. The combined planner retains exact reviewed note and configuration binding, one-use provider admission, and the AEP transport observations on the same request. Timing starts at the planner stage after CIE retrieval. MissionService preserves separate AEP ready-queue timing, ARIE preparation and release, evidence verification, and blocked versus uncertain settlement. The focused integration test joins the planning execution ID, bodyless cognition receipt, transport timing, and versioned resource leases for one reviewed-note mission.

## Validation

| Check | Evidence from the initial combined snapshot `fd35d035ae82c5c38952fb2c7b214a39f33bf9f6` |
| --- | --- |
| Focused reviewed-note integration | Passed in the full local Windows suite. |
| Backend, Vela Core, desktop, governance, and all 17 cross-package groups | Backend and Vela Core typechecks, Windows production desktop build, governance, and 17 of 17 local Windows groups passed. Hosted Ubuntu passed. |
| Upgrade/rollback, writer fencing, failed storage, and restart | A3 same-profile round trip and A4 native application restore passed on their pinned source lines. Combined restart checks passed in the Windows suite and the live source-mode journey. |
| Connected GPT-Live | One standalone A4 Windows run negotiated, reached running, and confirmed close. It used synthetic silence, muted output, and 15 provider-reported seconds. A prior focus-loss attempt had an unused grant and no session. Exact combined connected and physical-device checks remain open. |
| Cognition receipt aggregation | Mission reads expose bodyless ledger receipts. AEP aggregation of all cognition-stage attribution through the authorized profile read still needs verification. |

The live source-mode journey on the initial combined snapshot verified real Codex and native RAM effects, reviewed an Executive replacement after a controlled verification failure, and joined the planning receipt to AEP transport timing and versioned ARIE leases. Restart preserved the failed and verified evidence. The runtime kept the mission blocked because the plan had partial coverage and no whole-objective verifier. The harness simulated native approval. Current-head results are tracked in [the combined draft](https://github.com/Kgray44/Aetherwake/pull/53).

The `8e05617cf7e4807ad76a3734a7ae7088e5478991` checkpoint passed the 12-check Windows desktop journey and restart. Its connected GPT-Live session reached confirmed closure with synthetic silence, muted output and 15 provider-reported seconds. The `f93859e44a27528f115f47825e8f0fb4319993cf` checkpoint passed all 17 local Windows groups, with 3,057 tests passed and seven skipped. It also passed the live source-mode journey and an actual Electron report check that matched the renderer-visible delivery to the scoped AEP profile.

## Performance investigations

The historical ARIE series measured 6,925 ms median against 4,892 ms for measured admission. The first instrumented follow-up was initially labeled quick. Its receipts establish four missions and 40 attempts per trial. The launcher split its quick flag into characters, and the benchmark now rejects unsupported arguments. The three full-size series measured +0.62%, −0.01%, and −0.71% against measured admission. The last used early publication of Windows GPU and disk readings. The two valid quick series measured −0.20% and −0.18%. The updated ARIE pin retains the early counters and uses fresh native NVIDIA driver slowdown flags for GPU admission. The profiler pin exposes pending dependency and worker-budget blockers plus observed report handoff, composition, and staging timing.

The standalone ARIE mixed run verified CPU-thread work, GPU readback and actual provider calls. The single overlap arm took 17.38 seconds, with 82 ms of triple lease overlap after authorization. The GPU-first arm took 16.28 seconds. Loopback comparisons measured a 1.75-second concurrent median against 2.55 seconds serial across three trials per arm. Sustained mixed work, gameplay and GPU presentation remain open. [ARIE verification](FI-3-ARIE-NATIVE-VERIFICATION.md)

The Windows sandbox now awaits the existing storage reserve probe asynchronously. The combined project-check path revalidates CIE planning context and checks for a resource checkpoint immediately before dispatch. In the combined App Server fixture, pressure before dispatch issued zero commands. Once dispatched, the build kept its lease through verified exit and remote admission stayed available. A single combined run measured 259 ms maximum backend event-loop delay and 2.76 seconds in the bounded sandbox command. The standalone comparison measured 1,228 ms maximum event-loop delay before the change and 274–306 ms after.

The next resource pin moves pre- and post-dispatch Git and file checks into bounded workers under that same build lease. The combined App Server fixture rejected an input change after dispatch, returned verified exit for unchanged inputs, and released the lease in both cases. One combined observation measured 20 ms maximum backend event-loop delay, 2.76 seconds in the unchanged sandbox command and 4.00 seconds for its executor. The review UI still uses the synchronous planner. Foreground and sustained workloads remain unqualified.

Three standalone Windows CPU saturation trials reduced local admission from two slots to one and preserved remote eligibility. After load ended, admission recovered in 2.12–3.20 seconds. The final trial verified the new source-backed CPU contention reason. The workload was bounded hashing.

The historical CIE time of 55.54 seconds summed nine sequential development phases. On FI-2 at `7b8b83ab85e6574ad3ebdd96c22262e3408d065a`, a fresh independently authored blind corpus of eight cases and ten phases took 66.16 seconds with default effort and 50.20 seconds with experimental low effort. Default recovered 8 of 10 expected citations with one irrelevant authorized citation, one invalid proposal, and one unknown provider outcome. Low recovered 9 of 10 with two irrelevant citations and two invalid proposals. Both returned zero invalid source bindings. Authorized fixture lookup totaled under 2 ms in each arm. The single-run comparison leaves quality and tail latency open. A separate four-case selected-note smoke reduced eight provider calls to four and 22.66 seconds to 15.16 seconds. That experiment has no production routing change. [FI-2 producer snapshot](https://github.com/Kgray44/Aetherwake/pull/52)

An independent six-case selected-note comparison measured 38.20 seconds and 12 Responses calls for the two-stage strategy and 24.92 seconds and six calls for the one-call candidate, including one unknown one-call transport outcome. The five cases assessed by both took 32.01 and 22.98 seconds, respectively. Each arm passed one of six cases under strict grading. The two-stage arm matched four expected statuses and the one-call arm matched two. The one-call strategy remains experimental.

The updated FI-2 pin repairs a separate source of latency. A live probe made four Responses calls on a cold reviewed-note investigation and two after the 60-second catalog expired. Both verified the same citation. The repeat refreshed model membership and reused current model/schema qualification. The cold and refreshed observations took 9.57 and 5.74 seconds.

On a fresh eight-case blind corpus, FI-2 candidate `31af3b12993bb48277192cd7149f757cdac2d493` improved strict passes from 2/8 to 3/8 and literal passage matches from 3/8 to 6/8. Status matches held at 5/8, with one unknown provider outcome per arm. Warm aggregate elapsed time fell from 61.68 to 49.33 seconds, but median phase latency increased from 5.76 to 6.85 seconds. The five cases assessed by both took 36.84 and 34.31 seconds. These sequential observations establish no reliable latency gain. The combined draft retains `54235d1e` while the producer continues qualification.

The sealed fixture and case-level receipts remain in local evidence custody. The draft reports aggregate observations.
