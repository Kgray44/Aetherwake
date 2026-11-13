# FI-4 reviewed artifact composition

The host composes an existing mission plan with one existing, separately reviewed illustration task. The function preserves scope, Codex check bindings, any planning receipt and partial coverage. It rejects foreign scope, duplicate artifact work and an image request whose parameters no longer match its digest. The existing report join waits for all original prerequisites plus the verified artifact result.

The source-mode test supplies the composed host proposal directly to Core. It then exercises the existing mission preview, digest-checked Start, artifact producer, workspace registration, MissionService and AEP. The user-facing planner still needs the Core composition wiring and review UI integration. The test uses a fixed synthetic objective and temporary workspace.

The first live Windows run used one actual image request. The mission verified host measurements, the shipped source observation, a 1024 × 1024 PNG and companion notes. The workspace notes branch failed independently. After adding the missing note, Retry reused the verified image attempt and produced a combined report that survived restart. AEP recorded 891 ms of overlapping attempt occupancy and 23.66 seconds on the occupied critical path.

Four alternating pairs repeated the same live workload and recovery. All eight trials verified the same deliverable requirements, used one image request each and retained artifact manifests. A separate read verified all eight bundles.

| Metric | Concurrent | Sequential |
| --- | ---: | ---: |
| Median time to verified settlement | 24.14 s | 23.19 s |
| Elapsed range | 20.39–27.28 s | 20.35–25.61 s |
| Median process CPU | 2.27 s | 2.37 s |
| AEP attempt overlap | 0.95–1.40 s | 0 s |

Concurrent was faster in one of the four pairs. Image-provider duration varied, and the small native overlap did not establish an end-to-end speedup. Both arms retained image provenance and never regenerated the image during recovery.

One follow-up live run measured 625 ms of overlap between the image executor and a native execution phase on the same monotonic clock. AEP recorded 787 ms of total attempt occupancy overlap and a 22.43-second occupied critical path. This additional run is separate from the four matched pairs.

Run the synthetic test with `node --test --test-name-pattern='composed artifact mission' prototypes/integrated-backend/tests/mission-api-planning.test.mts`. For one live Windows inference, set `AERYNTH_VERIFY_LIVE_MIXED_ARTIFACT=1` and supply the existing authorized test credential. Set `AERYNTH_MIXED_ARTIFACT_SEQUENTIAL=1` to run the same graph with one worker. Each trial sets the worker limit before dispatch and asserts it from AEP. An optional fresh external directory in `AERYNTH_MIXED_ARTIFACT_EVIDENCE_DIR` retains only the verified files, report and digest manifest. The test reopens the same profile, verifies a repeated Start does not dispatch, and checks that changing the companion file withdraws verification.

Image request counts are observed. The current image path retains the provider request ID but does not capture image-token quantities or billing receipts. CPU time is the test process and its threads. The live experiment covers the existing artifact and native paths in one graph. The separate mixed Codex/API fixture qualifies read-only Codex execution.
