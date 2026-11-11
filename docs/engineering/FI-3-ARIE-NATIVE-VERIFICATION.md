# FI-3 Adaptive Resource Intelligence verification

Program B, FI-3 foundation. The baseline is `main` at `7747e8c7`. Draft delivery is stacked as [native telemetry](https://github.com/Kgray44/Aetherwake/pull/37) and [resource policy and leases](https://github.com/Kgray44/Aetherwake/pull/39), followed by the MissionService integration.

## Ownership and rollback

`createMissionAdmission` remains the Platform Performance Governor entry point. Its `telemetry` and `inspectPolicy` methods expose local, in-memory evidence to trusted host callers. `configurePolicy` and `rollbackPolicy` use a configuration revision check. `canLease` and `tryLease` enforce the current budgets. A fresh process has a fresh epoch and cannot reuse a prior live lease. A trusted embedder can supply its saved profile through `NativeHostServices.resourcePolicy` on startup.

MissionService still owns the queue, fairness, task attempts, timeout, cancellation, verification, and restart reconciliation. Its optional `resources.canAcquire/acquire` host seam uses the existing lane and canonical mission, task, and attempt IDs. It records `MissionAttempt.resourceLease` only for admitted attempts and releases reservations on actual settlement or failed journal admission. `MissionExecutionContext.resourceCheckpoint` is a cooperative request. Existing non-cooperative executors may finish and retain their reservation until settlement. The resource hook is additive for existing hosts. The Core adapter classifies provider specialists as remote and restricted project checks as local build work. Existing authorization, provider lane and quota checks, storage reserve, and read-only runner isolation continue to apply.

The active policy exposes the prior effective budget, current reason, and revision. Policy rollback restores the prior session configuration. If the Core integration needs to be rolled back, remove its resource hook and retain the existing admission callback. The additive optional attempt field requires no migration. Live policy overrides and reservations are in memory. Durable owner settings, renderer controls, and AEP-driven policy experiments remain open.

## Native observations

On Windows with Node v24.18.0, the sampler observed 16 logical processors, 16 per-processor readings, and 33,413,779,456 bytes of physical RAM. A heavily loaded sample showed 100% aggregate CPU and 1,089,687,552 available RAM bytes. All CIM fields returned errors in that run. The benchmark recorded no GPU or disk samples. The sampler preserves explicit stale, failed, unsupported, and unsampled states. GPU admission stays closed pending qualified VRAM headroom. Foreground app identity, power and sleep, thermals, and renderer frame pacing still require adapters. Native input activity already supplies a separate short-lived foreground signal.

## Windows comparison

Run `node prototypes/integrated-backend/src/mission-admission-benchmark.mts --quick` from the worktree root. Each measured arm ran three times after one warm-up, with one mission per run, three real CPU samples, one RAM sample, and one report. All nine measured runs verified all five attempts. The host was under ambient contention and the three arms were rotated. Metrics below are medians across each arm's three runs. Queue time includes time waiting on mission dependencies, and Node event-loop delay measures backend responsiveness.

| Policy | Completion | Attempts/sec | Queue p95 | Node event-loop p95 | Node CPU | Peak workers |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Memory guard baseline | 2,462 ms | 2.03 | 2,380 ms | 853 ms | 63 ms | 2 |
| Existing measured admission | 1,931 ms | 2.59 | 1,902 ms | 1,109 ms | 62 ms | 2 |
| ARIE lease admission | 3,161 ms | 1.58 | 3,148 ms | 862 ms | 62 ms | 1 |

ARIE produced 15 lease receipts in 15 measured attempts. The reduced run shows more conservative dispatch and slower completion. Ambient load and large event-loop variance prevent attributing a responsiveness improvement. The default-size comparison hit its 20-second deadline during the memory-only baseline, with three of four missions verified at the cutoff. This run provides no frame-time, gaming, induced saturation, or live provider result.

## Acceptance status

- Focused tests cover telemetry freshness, timed and cancelled sampling, local versus remote admission, retained reservations, versioned rollback, scheduling fairness and claims, dispatch and settlement, and restart uncertainty. Provider tests use protocol fixtures.
- Existing real Windows OS observations and the reduced comparison are recorded above. Full-sized baseline, idle and interactive workloads, controlled CPU/GPU/memory contention, foreground transitions, process-level crash recovery, and a live mixed CPU/GPU/API run remain unqualified.
- The Windows build/test lane reuses the existing restricted runner. A general CPU worker pool, GPU execution, renderer telemetry and adaptive GPU effects, user-visible durable overrides, and AEP recommendation promotion remain open. Draft PRs require review before integration.
