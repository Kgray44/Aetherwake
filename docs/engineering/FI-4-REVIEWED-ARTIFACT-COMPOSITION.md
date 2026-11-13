# FI-4 reviewed artifact composition

The host composes an existing mission plan with one existing, separately reviewed illustration task. The function preserves scope, Codex check bindings, any planning receipt and partial coverage. It rejects foreign scope, duplicate artifact work and an image request whose parameters no longer match its digest. The existing report join waits for all original prerequisites plus the verified artifact result.

The original source-mode comparison supplied the composed host proposal directly to Core, then exercised the existing mission preview, digest-checked Start, artifact producer, workspace registration, MissionService and AEP. The Core integration candidate now builds the composed proposal from the explicit request. Both harnesses use a fixed synthetic objective and a temporary workspace.

The staged explicit request format is `Run a mission to measure CPU and RAM; generate an illustration: Draw a blue square`. The existing image options, such as `[draft, high]`, go before the colon. The host resolves the work clause through its existing planners before it prepares the image preview. Unsupported work fails before preparing the image. The native broker tests exercise separate decisions for the image, specialist calls, and exact local Codex test, and prove that declining any decision prevents Start.

The Core integration candidate accepts the explicit request through normal Preview and reviewed Start. A Windows source-mode trial on the combined review base `29923a46` verified both files, recovered the failed native notes task, and restored the same report after restart. It made one image request, measured 2.02 seconds of image-executor/native execution overlap and settled in 25.31 seconds. The same preview contract discloses the separate work objective to specialists. The transport regression verifies that the image prompt goes only to the image endpoint. This witness did not open the packaged desktop.

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

An additional live Windows witness used the normal mixed preview and the existing native review broker with simulated dialogs. The installed read-only Codex sandbox ran one explicitly selected tracked test. Two live specialists and one image request completed in the same mission as the native measurements. The final report named the verified files and the passing test and attributed specialist recommendations to their sources. AEP recorded 6.52 seconds of attempt overlap, a 15.84-second occupied critical path and 1,259 provider-reported text tokens. No Codex model request ran. To reproduce, set `AERYNTH_VERIFY_LIVE_CODEX_ARTIFACT=1`, provide the authorized test credential and point `AERYNTH_MIXED_CODEX_TEST` to an absolute path to a reviewed tracked Node test in a disposable checkout. Run the same test file with `--test-name-pattern='reviewed mixed mission'`. This route makes three inferences and may perform catalog reads.
