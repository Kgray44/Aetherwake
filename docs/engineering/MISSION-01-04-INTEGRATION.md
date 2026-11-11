# Missions 01–04 integration

This draft assembles Architecture Recovery A3 and A4 and Fluid Intelligence FI-0 through FI-3 for integrated review. The source owners continue to develop and qualify their individual PRs. The assembly starts from main at `7747e8c723b5961d6edfd6fb75758a50e87e7ac6` and retains the existing SQLite owners, provider ledger, MissionService, Performance Governor, and renderer authority.

## Pinned source heads

| Mission | Published stack | Included source head |
| --- | --- | --- |
| 01, storage and retrieval | [#36](https://github.com/Kgray44/Aetherwake/pull/36) | `c5ac3c3399b44f957e47f679cb2bb8b7f0736494` |
| 01, runtime recovery | [#38](https://github.com/Kgray44/Aetherwake/pull/38) | `d422229aa3753099b43ba3c87adc8c2489bfae41` |
| 01, common contracts | [#40](https://github.com/Kgray44/Aetherwake/pull/40) | `5a72594b2259d850da70810183234797d2e34ab1` |
| 02, profiling | [#41](https://github.com/Kgray44/Aetherwake/pull/41) | `209f22bce837c80972bc75fad7d1949ca602d8a2` |
| 03, resources | [#37](https://github.com/Kgray44/Aetherwake/pull/37), [#39](https://github.com/Kgray44/Aetherwake/pull/39), [#42](https://github.com/Kgray44/Aetherwake/pull/42) | `8040c55409248e19fcda5170b29976fb8a0d9358` |
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

## Performance investigations

The original ARIE quick series measured 6,925 ms median against 4,892 ms for measured admission. The instrumented follow-up on the same shared Windows host verified 36 missions and observed ARIE differences of +0.62%, −0.20%, and −0.18% across three series. The first series had roughly 4.2 seconds of ready-queue p95 delay across all arms. Lease acquisition took 0.13–0.29 ms total for five attempts in the supplemental-enabled repeat. The quick workload exercises native observation. Mixed worker, renderer, and foreground-load qualification remains open. [ARIE verification](FI-3-ARIE-NATIVE-VERIFICATION.md)

The historical CIE time of 55.54 seconds summed nine sequential development phases. On FI-2 at `7b8b83ab85e6574ad3ebdd96c22262e3408d065a`, a fresh independently authored blind corpus of eight cases and ten phases took 66.16 seconds with default effort and 50.20 seconds with experimental low effort. Default recovered 8 of 10 expected citations with one irrelevant authorized citation, one invalid proposal, and one unknown provider outcome. Low recovered 9 of 10 with two irrelevant citations and two invalid proposals. Both returned zero invalid source bindings. Authorized fixture lookup totaled under 2 ms in each arm. The single-run comparison leaves quality and tail latency open. A separate four-case selected-note smoke reduced eight provider calls to four and 22.66 seconds to 15.16 seconds. That experiment has no production routing change. [FI-2 producer snapshot](https://github.com/Kgray44/Aetherwake/pull/52)

An independent six-case selected-note comparison measured 38.20 seconds and 12 Responses calls for the two-stage strategy and 24.92 seconds and six calls for the one-call candidate, including one unknown one-call transport outcome. The five cases assessed by both took 32.01 and 22.98 seconds, respectively. Each arm passed one of six cases under strict grading. The two-stage arm matched four expected statuses and the one-call arm matched two. The one-call strategy remains experimental.

The updated FI-2 pin repairs a separate source of latency. A live probe made four Responses calls on a cold reviewed-note investigation and two after the 60-second catalog expired. Both verified the same citation. The repeat refreshed model membership and reused current model/schema qualification. The cold and refreshed observations took 9.57 and 5.74 seconds.

The sealed fixture and case-level receipts remain in local evidence custody. The draft reports aggregate observations.
