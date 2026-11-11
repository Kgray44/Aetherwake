# FI-3 Adaptive Resource Intelligence verification

Program B, FI-3 foundation. The baseline is `main` at `7747e8c7`. Draft delivery is stacked as [native telemetry](https://github.com/Kgray44/Aetherwake/pull/37), [resource policy and leases](https://github.com/Kgray44/Aetherwake/pull/39), and [MissionService integration](https://github.com/Kgray44/Aetherwake/pull/42).

## Ownership and rollback

`createMissionAdmission` remains the Platform Performance Governor entry point. Its `telemetry` and `inspectPolicy` methods expose local, in-memory evidence to trusted host callers. `configurePolicy` and `rollbackPolicy` use a configuration revision check. `canLease` and `tryLease` enforce the current budgets. A fresh process has a fresh epoch and cannot reuse a prior live lease. A trusted embedder can supply its saved profile through `NativeHostServices.resourcePolicy` on startup.

MissionService owns the queue, fairness, task attempts, timeout, cancellation, verification, and restart reconciliation. Its optional `resources.canAcquire/acquire` host seam uses the existing lane and canonical mission, task, and attempt IDs. It records `MissionAttempt.resourceLease` only for admitted attempts and releases reservations on actual settlement or failed journal admission. `MissionExecutionContext.resourceCheckpoint` is a cooperative request. Existing non-cooperative executors may finish and retain their reservation until settlement. The resource hook is additive for existing hosts. The Core adapter classifies provider specialists as remote, restricted project checks as local build work, and the existing bounded native observation lane as host I/O. Host I/O has its own budget and still observes the local memory floor. Existing authorization, provider lane and quota checks, storage reserve, and read-only runner isolation continue to apply.

The active policy exposes the prior effective budget, current reason, and revision. `previewAdjustment` accepts a revision-bound, expiring AEP proposal and returns a bounded budget prediction without applying it. AEP owns validation of the cited evidence and any measurement of the observed effect. Policy rollback restores the prior session configuration. If the Core integration needs to be rolled back, remove its resource hook and retain the existing admission callback. The additive optional attempt field requires no migration. Live policy overrides and reservations are in memory. Durable owner settings, renderer controls, and live AEP experiments remain open.

## Native observations

On Windows with Node v24.18.0, the sampler observed 16 logical processors, 16 per-processor readings, and 33,413,779,456 bytes of physical RAM. Under ambient load, a sample showed 100% aggregate CPU and 5,219,454,976 available RAM bytes. A direct diagnostic measured 10.4 seconds for the bundled CIM query, exceeding the previous four-second timeout. With a bounded 15-second window, the governor returned 8 physical cores, 62% busiest GPU engine utilization, 108,568 bytes/s on the busiest network interface, and 2,206 pages/s. These readings were 20.8 seconds old measured conservatively from the query start. Physical disk queue and throughput were unavailable. The benchmark below recorded no GPU or disk samples.

The sampler preserves explicit stale, failed, unsupported, and unsampled states. GPU admission stays closed pending qualified VRAM headroom. Foreground app identity, power and sleep, thermals, and renderer frame pacing still require adapters. Native input activity already supplies a separate short-lived foreground signal.

## Windows comparison

Run `node prototypes/integrated-backend/src/mission-admission-benchmark.mts --quick` from the worktree root. Each measured arm ran three times after one warm-up, with one mission per run, three real CPU samples, one RAM sample, and one report. All nine measured runs verified all five attempts. The host was under ambient contention and the three arms were rotated. Metrics below are medians across each arm's three runs. Queue time includes time waiting on mission dependencies, and Node event-loop delay measures backend responsiveness.

| Policy | Completion | Attempts/sec | Queue p95 | Node event-loop p95 | Node CPU | Peak workers |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Memory guard baseline | 2,480 ms | 2.02 | 2,447 ms | 772 ms | 31 ms | 2 |
| Existing measured admission | 4,892 ms | 1.02 | 4,792 ms | 1,632 ms | 47 ms | 2 |
| ARIE lease admission | 6,925 ms | 0.72 | 6,401 ms | 2,724 ms | 78 ms | 2 |

ARIE produced 15 lease receipts in 15 measured attempts. An earlier implementation placed these observations in the CPU-heavy class, reduced peak workers to one, and failed the native overlap assertion. The host-I/O class restored observed two-worker overlap in all three ARIE runs and passed the native overlap test. Median completion and event-loop delay were worse than the existing measured admission in this comparison. Ambient load and event-loop variance prevent isolating the cause or qualifying a performance gain. The default-size comparison hit its 20-second deadline during the memory-only baseline, with three of four missions verified at the cutoff. This run provides no frame-time, gaming, induced saturation, or live provider result.

## Acceptance status

- The focused Windows run passed 29 tests across admission, telemetry, resource policy, MissionService, and canonical backend integration. It covers telemetry freshness, timed and cancelled sampling, local versus remote admission, retained reservations, versioned rollback, fairness and claims, native overlap, dispatch and settlement, and restart uncertainty. A wider run on the pre-change worktree recorded timeouts and Windows fixture cleanup failures.
- Existing real Windows OS observations and the reduced comparison are recorded above. Full-sized baseline, idle and interactive workloads, controlled CPU/GPU/memory contention, foreground transitions, process-level crash recovery, and a live mixed CPU/GPU/API run remain unqualified.
- The Windows build/test lane reuses the existing restricted runner. A general CPU worker pool, GPU execution, renderer telemetry and adaptive GPU effects, user-visible durable overrides, and AEP recommendation promotion remain open. Draft PRs require review before integration.
