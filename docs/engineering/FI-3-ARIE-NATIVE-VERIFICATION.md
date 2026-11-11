# FI-3 Adaptive Resource Intelligence verification

Program B, FI-3 foundation. The baseline is `main` at `7747e8c7`. Draft delivery is stacked as [native telemetry](https://github.com/Kgray44/Aetherwake/pull/37), [resource policy and leases](https://github.com/Kgray44/Aetherwake/pull/39), and [MissionService integration](https://github.com/Kgray44/Aetherwake/pull/42).

## Ownership and rollback

`createMissionAdmission` remains the Platform Performance Governor entry point. Its `telemetry` and `inspectPolicy` methods expose local evidence to trusted host callers. `configurePolicy` and `rollbackPolicy` use a configuration revision check. `canLease` and `tryLease` enforce the current budgets. A fresh process has a fresh epoch and cannot reuse a prior live lease. A trusted embedder can supply a host preset through `NativeHostServices.resourcePolicy` on startup. A saved owner preference takes precedence over that preset.

MissionService owns the queue, fairness, task attempts, timeout, cancellation, verification, and restart reconciliation. Its optional `resources.canAcquire/acquire` host seam uses the existing lane, executor ID, and canonical mission, task, and attempt IDs. It records `MissionAttempt.resourceLease` only for admitted attempts and releases reservations on actual settlement or failed journal admission. `MissionExecutionContext.resourceCheckpoint` is a cooperative request. Existing non-cooperative executors may finish and retain their reservation until settlement. The Core adapter classifies provider specialists as remote, restricted project checks as local build work, shipped-source inspection as CPU work, and bounded native observations as host I/O. Host I/O has its own budget and still observes the local memory floor. Existing authorization, provider lane and quota checks, storage reserve, and read-only runner isolation continue to apply.

The active policy exposes the prior effective budget, current reason, and revision. `previewAdjustment` accepts a revision-bound, expiring AEP proposal and returns a bounded budget prediction without applying it. AEP owns validation of the cited evidence and any measurement of the observed effect. If the Core integration needs to be rolled back, remove its resource hook and retain the existing admission callback. The additive optional attempt field requires no migration. Live reservations remain in memory. Live AEP experiments remain open.

## Owner overrides and restart

The normal Electron application's **Performance** menu provides the resource profile, CPU worker limit, supplemental Windows counters, undo, and restore defaults. Press Alt on Windows to reveal the hidden application menu. The menu reports the selected source and the currently effective budgets. Mutations require a native dialog selection, a matching configuration version, and storage admission. The command is private to the desktop host and the renderer IPC denies it.

The existing private SQLite profile holds one `platform_resource_preferences` row with the applied configuration, previous configuration, revision and applied UTC time. A failed compare-and-set leaves live policy unchanged. Undo restores one prior preference across restart. Restore defaults installs the default policy while preserving undo. Corrupt saved data starts Balanced with supplemental monitoring disabled, reports fallback, and can be repaired by an explicit owner write. New lease receipts include the applied configuration version. Runtime safety and available telemetry still determine effective admission.

Opting out of supplemental Windows counters stops their collection and discards in-flight results. Local CPU and physical RAM safety sampling continues. The opt-out does not enable any new foreground identification or external monitoring.

A Windows smoke run used Electron 45.2.1's actual menu, a scripted dialog response, and the normal desktop stdio host and worker with an isolated profile. Selecting Foreground / Gaming saved revision 2 and a new backend process returned the saved mode and revision with a fresh runtime epoch. Focused tests also cover storage-denied writes, stale writes, invalid caps, durable rollback, corrupt settings, public stdio refusal, and opt-out cancellation. This smoke run did not exercise a physical dialog click or the full packaged renderer.

## Native observations

On Windows with Node v24.18.0, the sampler observed 16 logical processors, 16 per-processor readings, and 33,413,779,456 bytes of physical RAM. A direct diagnostic measured 10.4 seconds for the bundled CIM query, exceeding the previous four-second timeout. The final run with a bounded 15-second window recorded 99.82% aggregate CPU, 5,160,497,152 available RAM bytes, 8 physical cores, 59% busiest GPU engine utilization, a busiest-device disk queue length of 0, 21,248,940 disk bytes/s, 62,612 bytes/s on the busiest network interface, and 1,329 pages/s. The CIM readings were 9.0 seconds old measured conservatively from the query start. The earlier comparison below captured CPU and RAM readings.

The sampler preserves explicit stale, failed, unsupported, and unsampled states. GPU admission requires an eligible execution process and its own live GPU budget. External foreground app identity and temperature remain unavailable. Native input activity supplies a separate short-lived signal.

## Dedicated GPU memory

The supplemental Windows probe matches DXGI dedicated capacity to WDDM dedicated usage by adapter LUID. It publishes the capacity, usage, and estimated headroom of a single matched adapter. Selection excludes linked, ambiguous, unmatched, and inconsistent readings. The user-visible result contains only memory quantities and age. The Performance menu shows the estimate and its age when fresh. Static capacity discovery is cached for five minutes and invalidated on suspend or monitoring opt-out.

On this Windows host the demand-gated governor reported 8,274,313,216 bytes of dedicated capacity, 6,057,734,144 bytes in use, and 2,216,579,072 bytes of estimated headroom on the same adapter. The readings were 14.5 seconds old, measured conservatively from query start. Busiest GPU engine utilization was 55%. The standalone DXGI capacity discovery took 5.36 seconds in one run. The end-to-end governor observation took 16.64 seconds including its warm-up. These timings describe collection under ambient host load.

A separate Windows Direct3D 11 diagnostic queried the OS budget from the process that owned the device. In one run the OS reported a 1,772,175,360-byte budget. In the readback run it reported 7,469,006,848 bytes. The diagnostic uploaded eight 16 MiB buffers in 171 ms, copied them to staging, and verified all eight SHA-256 digests in 457 ms including readback and hashing. Current local usage reported by DXGI was 7,417,856 bytes before the allocation and 7,430,144 bytes while the buffers were held after readback. These are process-scoped observations under the driver and OS residency policy.

Run `node prototypes/integrated-backend/src/mission-gpu-readback-verify.mts` for the opt-in Windows hardware fixture. It uses a private PowerShell-hosted Direct3D worker and the real MissionService queue. The worker opens a hardware device, reports its same-process budget, and waits for a matching ARIE lease before allocating. It rechecks the OS budget before allocating or copying, and the lease holds until the native process exits. The isolated fixture enables one GPU slot explicitly. Normal product configuration keeps GPU admission closed and the diagnostic stays outside the product executor catalog.

In one Windows fixture run, the mission was queued with zero attempts until the budget arrived. It recorded a 268,435,456-byte VRAM reservation and 67,108,864-byte RAM reservation against a 7,469,006,848-byte process budget. The reservations are ARIE admission limits. Queue time was 651 ms, execution time was 953 ms, and eight staged digests verified. The driver reported 141,647,872 bytes of local usage while resources were held, and the scheduler released the GPU reservation after process exit. Earlier runs queued for 891–7,696 ms and executed in 997–1,295 ms. The `--cancel-after-dispatch` run observed the reservation still active immediately after requesting cancellation, followed by a cancelled attempt and release after process exit.

The `--mixed` and `--serial-mixed` arms used the same GPU readback, CPU-thread source inspection, and loopback HTTP response with a 750 ms response delay. All six Windows runs verified all three tasks with distinct GPU, CPU and remote leases. Concurrent runs reached three in-flight attempts and serial runs reached one. Concurrent completion times were 1,753, 1,781 and 1,751 ms. Serial times were 2,524, 2,630 and 2,548 ms. Median completion fell from 2,548 to 1,753 ms, including worker preparation. Median remote queue time fell from 1,780 to 746 ms. The HTTP operation used a local fixture and no provider credentials. Product GPU dispatch, sustained compute, gameplay impact, and live-provider mixed-load acceptance remain unqualified.

## Renderer, foreground and power signals

The renderer summarizes consecutive active animation callbacks using the existing frame loop. Intentional idle and paced gaps clear the window. The reference cadence is the app's target bounded by the current display refresh period. Uncapped rendering uses the app's balanced 60 Hz reference as its minimum service target. Native Electron accepts bounded, rate-limited summaries only from the focused local main frame. The workroom shows the frame interval p95 and the effective CPU and remote admission limits separately. This interval measures renderer callback pacing. GPU presentation time remains unmeasured.

Electron supplies coarse Aerynth focus, system idle duration, battery status, suspend/resume, and the most recent OS CPU speed-limit event where available. Sustained renderer pressure and a reported speed limit reduce local admission. High Throughput requires a fresh idle observation of at least 15 seconds plus CPU and other policy headroom. Suspend closes local admission and invalidates native resource observations. Resume requires fresh RAM before another local lease. These paths preserve independent remote admission.

A Windows Electron 45.2.1 offscreen software-rendering fixture used the shipped collector with a 240 Hz display and the 60 Hz balanced reference. Two baseline windows reported 16.7 ms frame interval p95, and two windows under a scripted 36 ms per-callback load reported 50 ms. Electron reported that the system was awake, was off battery, and had advertised a 34% CPU speed limit during this observation. Replaying the four measured windows through the governor with controlled receipt timing held build admission at one during baseline and reduced it to zero after the second slow window. Remote admission stayed at three. Earlier harness attempts hit a startup deadline or lost the renderer frame before collection. The successful fixture used scripted focus, a software-rendered canvas, and policy replay. Gameplay, GPU presentation, physical suspend/resume, and responsiveness gains remain unqualified.

## Windows comparison

Run `node prototypes/integrated-backend/src/mission-admission-benchmark.mts --quick` from the worktree root. Each measured arm ran three times after one warm-up, with one mission per run, three real CPU samples, one RAM sample, and one report. All nine measured runs verified all five attempts. The host was under ambient contention and the three arms were rotated. Metrics below are medians across each arm's three runs. Queue time includes time waiting on mission dependencies, and Node event-loop delay measures backend responsiveness.

| Policy | Completion | Attempts/sec | Queue p95 | Node event-loop p95 | Node CPU | Peak workers |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Memory guard baseline | 2,480 ms | 2.02 | 2,447 ms | 772 ms | 31 ms | 2 |
| Existing measured admission | 4,892 ms | 1.02 | 4,792 ms | 1,632 ms | 47 ms | 2 |
| ARIE lease admission | 6,925 ms | 0.72 | 6,401 ms | 2,724 ms | 78 ms | 2 |

ARIE produced 15 lease receipts in 15 measured attempts. An earlier implementation placed these observations in the CPU-heavy class, reduced peak workers to one, and failed the native overlap assertion. The host-I/O class restored observed two-worker overlap in all three ARIE runs and passed the native overlap test. Median completion and event-loop delay were worse than the existing measured admission in this comparison. Ambient load and event-loop variance prevent isolating the cause or qualifying a performance gain. The default-size comparison hit its 20-second deadline during the memory-only baseline, with three of four missions verified at the cutoff. This run provides no frame-time, gaming, induced saturation, or live provider result.

## CPU worker isolation

The native shipped-source inspection uses a lazy, bounded Node worker pool under a CPU lease. It retains its native mission lane and verifier. The worker accepts one fixed job with no path, command, or provider input. MissionService owns waiting and retries. The pool backpressures excess calls and holds each cancelled slot until the thread exits. Crash tests exercise real thread exit and explicit submission to a replacement. The Core shuts the pool down after mission settlement.

Run `node prototypes/integrated-backend/src/mission-cpu-benchmark.mts` to compare inline inspection with one and two warm threads. On Windows with Node v24.18.0, each arm ran three measured batches of 24 inspections after one warm-up. Every digest matched. Medians reflect ambient host contention.

| Shipped-source inspection | Batch completion | Jobs/sec | Queue p95 | Backend event-loop p95 | Process CPU |
| --- | ---: | ---: | ---: | ---: | ---: |
| Inline | 888 ms | 27.03 | 802 ms | 27.95 ms | 109 ms |
| One warm worker | 1,558 ms | 15.41 | 1,446 ms | 41.84 ms | 219 ms |
| Two warm workers | 386 ms | 62.10 | 261 ms | 32.92 ms | 220 ms |

The two-thread arm demonstrated concurrent execution and higher median throughput for this batch. Inline elapsed times ranged from 163 to 1,408 ms. These results leave the responsiveness effect and the optimal admission budget unqualified.

## Acceptance status

- The focused Windows run passed 29 tests across admission, telemetry, resource policy, MissionService, and canonical backend integration. It covers telemetry freshness, timed and cancelled sampling, local versus remote admission, retained reservations, versioned rollback, fairness and claims, native overlap, dispatch and settlement, and restart uncertainty. A wider run on the pre-change worktree recorded timeouts and Windows fixture cleanup failures.
- CPU pool follow-up passed 24 focused Windows tests. The mission-conversation and workspace-recovery suites passed 12 tests with synthetic RAM availability feeding the real governor. This corrects earlier Ubuntu failures in fixtures that bypassed the old admission callback. The earlier [integration run](https://github.com/Kgray44/Aetherwake/actions/runs/42960582678) also logged graphics and profile-restore failures already present in the [telemetry-only run](https://github.com/Kgray44/Aetherwake/actions/runs/42957724317). The [CPU-pool Ubuntu run](https://github.com/Kgray44/Aetherwake/actions/runs/42962271625/job/130331343155) reported an OpenAI native-storage CAS assertion failure. Hosted qualification remains open.
- Existing real Windows OS observations and the reduced comparison are recorded above. Full-sized baseline, idle and interactive workloads, controlled CPU/GPU/memory contention, foreground transitions, process-level crash recovery, and a live mixed CPU/GPU/API run remain unqualified.
- The Windows build/test lane reuses the existing restricted runner. The CPU worker pool currently runs shipped-source inspection. Broader CPU workloads, GPU execution, packaged renderer responsiveness and adaptive GPU effects, and AEP recommendation promotion remain open. Draft PRs require review before integration.
