# Vela Adaptive Resource Intelligence (ARIE)

**Architecture:** FI-ARIE-01 · **Status:** design target; no claim of implemented ARIE  
**Decision:** [ADR-003](../decisions/ADR-003-AI-NATIVE-FLUID-INTELLIGENCE.md) · **Program:** Full Aerynth Realization under [ADR-002](../decisions/ADR-002-ARCHITECTURE-RECOVERY-AND-COHESIVE-RUNTIME.md)  
**Canonical owner:** Existing Charter 13 Performance Governor, extended as the **Adaptive Resource Intelligence Engine**. This is **not a second governor**. Requirements [AW-PLT-145–168](../../governance/13-PLATFORM-PERFORMANCE-AND-DISPLAYS.md) and Charters 05, 09, 10, 14 and 15 control implementation.

## 1. Mission and non-negotiable outcomes

ARIE lets Vela aggressively use *available* compute capacity and gracefully yield to the user's real-time foreground workload, without silently degrading cognitive quality or interrupting an authorized mission. It combines deterministic OS telemetry/enforcement with optional model-assisted workload reasoning and AEP-validated experience. Every decision must be reversible, measurable and explainable.

Outcomes:
1. Responsiveness of user input, active applications, gaming, voice and Aerynth's own UI is protected.
2. Local CPU-heavy tasks use true bounded parallelism when benchmarking shows useful speedup.
3. Local GPU compute, VRAM, disk-intensive activity and background rendering are separately controlled; remote inference remains remote.
4. Idle capacity can accelerate legitimate queued work without inventing new work or exceeding user policy.
5. Resource adjustments never masquerade as task completion, permission grants, intelligence downgrades or verified optimization.
6. ARIE remains safe and functional offline or when performance telemetry is unavailable.
7. The user can inspect current policy, reasons and results and can choose compatible overrides.
8. AEP and CIE can inform resource strategies with proven, context-specific experience, never by writing ARIE's state directly.

**Quality-preserving priority:** Reduce unnecessary rendering/background local work and local tool contention before reducing the intelligence needed to finish a mission. A task that requires a capable model or independent review retains those obligations. If resources force a pause, disclose it honestly.

## 2. Ownership and integration

| Component | Responsibility | Integration |
|---|---|---|
| Host platform adapters (Charter 13) | Discover CPU topology, RAM, GPU, power, foreground/OS signals and sensor availability; implement low-level enforcement | Emit timestamped, source-attributed samples and enforcement results |
| Performance Governor / ARIE (Charter 13) | Own resource modes, limits, policies, recommendation validation, leases and decisions | Publish versioned resource envelopes to MissionService and renderer |
| MissionService + scheduler (Charter 05) | Own canonical task lifecycle, dependency DAG, priority, safe pause/resume/cancel and effect state | Acquire/renew/release leases; comply with revisioned budgets |
| Motion Coordinator (Charters 02/13) | Own visual-motion/render quality implementation | Consume approved visual budget; never alter mission/model truth |
| AEP (Charter 10) | Observe performance and quality; propose/evaluate experiments | Subscribe to metrics and decisions, not raw private process content |
| AIR / AI Executive (Charter 06) | Choose cognition and mission-level strategy | Consult effective budgets and learning; no direct CPU-limit changes |
| CIE (Charter 08) | Retrieve approved, source-backed hardware/strategy experiences | Project ARIE decisions and AEP studies with provenance |
| Trust (Charter 14) | Consent, disclosure, monitoring and hard authorization | Filter host signals and validate scope before any model egress |
| Intelligence Stream (Charter 09) | Factual user-visible events and inspection | Display current decision/unknown state, never sample-derived fiction |

Do not create a second scheduler, event journal, process supervisor, GPU telemetry store or agent identity in ARIE. Leases reference canonical mission/task/attempt and are auditable with real resource effects.

## 3. Sensing and provenance

### 3.1 Required signal families

| Signal | Safe interpretation | Important limitations |
|---|---|---|
| Logical processor count and topology | Worker capacity ceiling and scheduling candidates | Logical thread count is **not** ideal number of CPU-bound workers |
| Total CPU / per-process time / runnable queue | Occupancy and potential CPU contention | High CPU alone does not prove user-visible pressure |
| Foreground focus / user-selected gaming profile | Priority protection signal | Focus alone does not authorize inspection of app contents |
| Memory available, pressure, paging | Avoid swapping, OOM and high GC churn | Report unknown where OS cannot supply precise counters |
| Disk busy/queue/latency/free space | Throttle scans, indexing, build I/O | Distinguish measurement scope; avoid unbounded storage polling |
| GPU engine utilization / VRAM, when available | Protect graphics/render/compute resource headroom | Driver coverage varies; never invent GPU telemetry |
| UI frame intervals / responsiveness | Detect Aerynth renderer contention | rAF callback timing is not proof of physical presentation latency |
| Foreground app responsiveness, when lawfully measurable | Detect harm to user tasks | Do not capture window text, private file paths or gameplay contents |
| Battery/power/thermal headroom, when available | Avoid energy depletion and throttling | Unsupported thermal sensors must remain unavailable |
| Provider/API queues and network | Bound async remote requests by provider and connection | Remote model inference does not consume local inference CPU/GPU |

Metrics are records of **observed**, **derived**, **estimated**, or **unavailable** data, with unit, source, scope, freshness, uncertainty and sampling overhead. Do not infer an exact wattage or frame rate from partial counters.

### 3.2 Collection policy

The native sampler publishes coarse periodic snapshots (implementation-defined sampling rates, configured/tested for cost). In-memory high-frequency observations must be aggregated before storage. Use capped buffers and retention controls; prefer changes and summaries over indefinite raw samples. Make monitoring consent and local/external disclosure explicit.

Never scrape screen contents, unrelated app data, process command lines or protected context solely to optimize resources. AEP may need environment classes, not intrusive behavior surveillance. Model-guided resource interpretation receives only authorized, minimized, aggregated evidence.

## 4. Model for actual resource pressure

ARIE estimates **contention and impact**, not just utilization. Example conceptual signals:

~~~text
cpu_pressure = f(sustained_CPU_occupancy, runnable_delay, UI_response_tail,
                 foreground_impact, thermal_state, available_workers)
memory_pressure = f(headroom, reclaim, paging, per-worker footprint)
gpu_pressure = f(available_GPU_engines, VRAM_headroom, frame_pacing, device_state)
io_pressure = f(queue_depth, sustained_disk_latency, free_space)
effective_budget = min(user_hard_limits, platform_safe_limits,
                       current_resource_policy, verified_resource_capacity)
~~~

These are conceptual inputs, **not preapproved mathematical thresholds**. Every formula and threshold must be benchmarked on actual hardware. CPU usage may be 100% on a workload that tolerates it, and 40% can still cause responsiveness problems due to latency, scheduling, I/O or thermal throttling.

Distinguish acute pressure (immediate deterministic protection) from longer-horizon patterns suitable for AI diagnosis or learned policy suggestions. Models never sit on the hot path of resource admission or each metric sample.

## 5. Resource policy and state machine

Suggested modes (user-visible labels may differ):
- **Automatic:** choose within user-approved limits using observed pressure and validated strategies.
- **Gaming / Focus:** protect foreground responsiveness and GPU headroom; reduce noncritical background local work; keep qualified remote reasoning eligible.
- **Balanced:** share compute with normal desktop work and prioritize timely user interaction.
- **Max Throughput / Idle:** increase admitted local parallel jobs when stable headroom and measured benefit exist.
- **Battery / Efficiency:** respect user battery limits and host power signals.
- **Degraded:** conservative bounded local budgets during missing/stale/corrupt telemetry or policy store failure.

User-pinned modes must override automatic recommendations within safety and authorized limits. Rendering visual tier and mission-local compute budget are separate dimensions; setting a gaming visual tier alone may not silently pause a coding task.

### 5.1 State transitions

~~~text
STARTUP -> CONSERVATIVE_SAFE
  -> MONITORING -> STABLE
  -> PRESSURE_DETECTED -> YIELDING -> GUARDED
  -> RECOVERY_CANDIDATE -> RAMPING -> STABLE
  -> DEGRADED (sensor/policy failure; safe fallback)
~~~

Transitions use sustained samples, smoothing, minimum dwell, hysteresis and cooldown. Sudden safety constraints may trigger immediate protection, while returning to higher throughput should be gradual to prevent thrashing. Log the cause, changed budgets, source/quality of readings, and whether the change had the intended effect.

**Do not** arbitrarily kill a process mid-write for gaming responsiveness. A worker may have a safe checkpoint or cancellation protocol; an active non-idempotent operation must retain actual state until reconciled.

## 6. Versioned interface contracts

These are logical contracts with **example field shapes**, not assertions of production TypeScript/API signatures. The implementation must retain the native owner's canonical IDs and enforce bounds.

~~~ts
type ResourceSnapshotV1 = {
  schema_version: "aerynth.arie.snapshot@1";
  sample_id: string; machine_scope: string; observed_at: string;
  interval_ms: number; policy_epoch: number;
  signals: Array<{
    metric: string; value: number | null; unit: string;
    scope: string; source: string;
    provenance: "observed" | "derived" | "estimated" | "unavailable";
    freshness_ms: number | null;
  }>;
};

type ResourcePolicyV1 = {
  schema_version: "aerynth.arie.policy@1";
  policy_id: string; revision: number; mode: string;
  user_locked: boolean; auto_adapt: boolean;
  hard_limits: Record<string, number>;
  headroom_reservations: Record<string, number>;
  priority_order: string[];
  cooldown_ms: number;
  authorization_epoch: number;
};

type ResourceRecommendationV1 = {
  schema_version: "aerynth.arie.recommendation@1";
  recommendation_id: string; based_on_policy_revision: number;
  evidence_snapshot_ids: string[];
  origin: "deterministic" | "model_assisted" | "promoted_experiment" | "user";
  proposed_budgets: Record<string, number>;
  reason_summary: string; uncertainty: string[];
  expected_impact: string[];
};

type ResourceLeaseV1 = {
  schema_version: "aerynth.arie.lease@1";
  lease_id: string; task_id: string; attempt_id: string;
  worker_id: string; policy_revision: number;
  resource_class: "cpu" | "gpu" | "disk" | "memory" | "api_io";
  amount: number; units: string;
  granted_at: string; expires_at: string; released_at: string | null;
  state: "active" | "expired" | "revoked" | "released";
};
~~~

A real strict schema must specify closed objects, bounded values, required fields, type validation and migrations. The model can recommend a budget, but may **not** write effective policy revisions or active leases.

### 6.1 Scheduler protocol

1. Mission scheduler requests resource-class capacity with task/attempt ID, priority, expected demand and cancellation/checkpoint affordances.
2. ARIE evaluates current valid policy revision and available capacity; grants a scoped lease or returns QUEUED, THROTTLED, DENIED or DEGRADED with cause.
3. Scheduler dispatches only after satisfying dependencies, effect permissions and resource lease (as applicable).
4. Active worker reports actual utilization and checkpoints. ARIE may lower future admissions; preemption requests require task-safe checkpoint semantics.
5. Worker completion, cancellation, crash or lease timeout releases reservation; the task outcome is updated **only** from MissionService/tool evidence, not ARIE's resource event.
6. Policy epoch changes fence stale leases and re-evaluate queued work without retrying non-idempotent effects.

The scheduler owns priority fairness and execution state. ARIE owns resource ceilings and policies. Neither component silently invents the other's state.

## 7. CPU threading and async API concurrency

### 7.1 Separate resources; separate budgets

- Async API/model operations: event-driven I/O, independent provider/account concurrent-call quotas and backpressure; not one CPU worker per call.
- CPU-heavy local work: sized worker thread pools or isolated subprocesses for parsing, indexing, compilation and media; use repeatable scaling measurements.
- Memory-heavy work: cap queued and active memory footprints; enforce release and backpressure.
- Disk-heavy work: limit heavy concurrent scans/builds and maintain application integrity, free-space thresholds and IO latency protection.
- GPU work: isolate optional compute from renderer and external foreground application; use VRAM headroom and device-loss recovery.
- UI and voice: preserve realtime input and rendering responsiveness, even during busy backend execution.

Measure worker throughput at 1, 2, 4, 8, etc. suitable counts as actually supported, not blindly up to detected logical CPUs. Profile cache/memory contention and overhead. Some tasks are inherently sequential or become slower when split; no claim of multicore gains without evidence.

### 7.2 Parallel mission behavior

Concurrent agents may queue remote reasoning while local CPU builds are throttled. Approved read-only retrieval may overlap with provider calls. ARIE should preserve critical-path priority where possible but not at the cost of game responsiveness or another user-selected limit.

Prefer checkpointable, cancel-safe work for background preemption. Fairness should protect multiple missions and interactive work. Deadline policy is explicit: defer, escalate the constraint or notify; do not silently miss deadlines.

### 7.3 Foreground/gaming posture

A Gaming/Focus signal may come from explicit user choice or privacy-preserving, permitted local foreground classification. Initial response to sustained contention:
1. Reduce optional hidden/ambient rendering and low-priority animation work.
2. Backpressure background indexing, scans, expensive previews and local builds where safe.
3. Limit GPU compute and RAM/disk-demanding workers, honoring checkpoints.
4. Continue authorized remote intelligence and low-cost event-driven operations when safe.
5. Persist truthful paused/deferred states and restore local admission gradually after stable headroom.

Gaming protection cannot disable required independent verification or switch to a less capable reasoning model merely because the GPU is busy. A resource pause is **not** a cognitive downgrade.

## 8. AI guidance and adaptive feedback

AI advisory requests may be triggered by observed workload patterns, long-lasting pressure, conflicting goals, a major hardware configuration change, or AEP's validated optimization recommendation. The prompt receives privacy-scoped aggregate measurements, current permissible budget envelope and versioned performance evidence.

The model returns a **ResourceRecommendationV1**, not executable OS instructions. Native validator checks:
- valid current policy epoch, active user override and authorization;
- safe ceilings/headroom and actual discoverable hardware support;
- data scope, source freshness and expected effect;
- whether the suggested policy has been rejected or rolled back for this cohort.

Unqualified model advice may be logged as a hypothesis, but cannot bypass limits or disable tasks. AEP experiments evaluate proposals using comparable workload conditions and verified task/foreground quality. CIE indexes approved conclusions with hardware/task applicability, not a universal “more threads = faster” habit.

No self-modifying resource code, automatic provider-weight training, or irreversible host configuration change is implied by adaptation.

## 9. Observability and Adaptive Intelligence Workspace projection

Material policy events contain snapshot references, old/new policy revision and budgets, reason, proposer, enforcement receipt, affected tasks, user override state, and observed aftermath. Charter 09 owns event transport/provenance. Charter 10 owns measurements and comparisons.

The Resource Intelligence view can show:
- current mode, user hard limits, effective admitted workers and unavailable sensors;
- CPU/GPU/memory/disk pressure and distinguished local/API workloads;
- per-mission resource leases and queued work;
- why a job paused, which signal triggered a shift and when it will be reconsidered;
- proposed versus tested versus active versus rejected learned strategies;
- accessible low-motion, low-resource equivalent views.

Do not pretend detailed raw OS metrics or private thought traces exist where only approximate/advisory data is available.

## 10. Failure containment and privacy

| Failure | Behavior |
|---|---|
| Sensor missing, driver unavailable | Mark unsupported and fall back to safe bounded default; no fabricated measurement |
| Sampling overload | Reduce sampling/resolution, coalesce updates, retain responsiveness |
| Model advice invalid or late | Reject; keep deterministic current policy |
| Rapid pressure oscillation | Hysteresis/cooldown; record transition frequency |
| GPU device lost | Renderer fallback, safe worker suspension where necessary, preserved task state |
| CPU worker crash | Release lease, preserve attempt status and reconcile actual effect |
| Lease expires while external effect in flight | Do not blindly terminate/retry; reconcile provider and effect state |
| App restart | Restore policy/user limits, recover leases and mission state through canonical owner; no duplicate work |
| Foreground application changes | Re-evaluate policy with privacy/consent and dwell safeguards |
| User revokes monitoring permission | Stop unapproved collection, invalidate derived projections as needed, use conservative safe mode |
| Local network/provider outage | ARIE still enforces local resource budgets; do not equate local telemetry with provider health |
| Disk nearing quota / memory pressure | Bound queue, suspend safe background jobs, preserve canonical durable data |

## 11. Benchmark protocol and acceptance

Use Charter 13 PLT-ARIE-01–08 as mandatory scenarios, plus Charter 15 quality/privacy gates.

For each candidate release, record build/commit, OS version, CPU topology, GPU and driver, RAM, storage, power state, display refresh, foreground reference workload, renderer mode, approved task class, provider conditions, sensor coverage and sampling cost. Evaluate multiple repetitions and natural variance.

### Test matrix

| Case | Test | Required observation |
|---|---|---|
| ARIE-N01 | Sustained foreground game + remote AI + local build | Reduced competing local load, preserved qualified remote reasoning and measured foreground/UI tails |
| ARIE-N02 | Idle headroom plus multiple CPU-bound workers | Throughput improves versus safe baseline while UI and thermal/memory limits remain acceptable |
| ARIE-N03 | Transient spikes versus sustained pressure | No overreactive mode oscillation; correct recovery |
| ARIE-N04 | GPU/thermal/sensor signal unavailable | Explicit unknown readings, conservative operational fallback |
| ARIE-N05 | Concurrent RAM/disk-heavy missions | Backpressure, fairness and zero corrupted artifacts |
| ARIE-N06 | Unauthorized/model-proposed override | No effective policy change; traceable rejection |
| ARIE-N07 | Restart with paused and active effects | Accurate recovered task and lease states, no replayed side effects |
| ARIE-N08 | Promoted strategy on held-out hardware/workloads | Measured impact, no lost intelligence, rollback when quality fails |
| ARIE-N09 | Rendering-only tier change | No backend task cancellation or altered model reasoning policy |
| ARIE-N10 | Monitoring/telemetry opt-out | No unauthorized collection/egress and usable safe fallback |

Metrics include p50/p95/p99 UI intervals (with sampling limitations), first useful result, end-to-end verified task time, worker queue wait, CPU throughput, pressure, GPU/VRAM, RAM/disk contention, active worker count, policy transitions per hour, task quality, missed deadlines, errors and instrumentation overhead.

Targets are hypotheses pending hardware-qualified measurements, never invented universal CPU thresholds. A passing mock is an adapter test, not native ARIE acceptance.

## 12. Delivery slices

- **ARIE-0:** Inventory existing Performance Governor and OS adapters; map current metrics and source owners, establish baseline and authorized telemetry.
- **ARIE-1:** Versioned ResourceSnapshot, ResourcePolicy and decision events; offline safe defaults and user controls.
- **ARIE-2:** Lease admission, separate CPU/GPU/disk/API budgets and bounded worker pools through canonical MissionService.
- **ARIE-3:** Foreground protection, recovery hysteresis, fair scheduling and native Windows packaged-app tests.
- **ARIE-4:** AEP-controlled adaptive strategy experiments and CIE-contextual applicability, initial shadow mode.
- **ARIE-5:** Gradual promotion/rollback, Resource Intelligence workspace projection and repeatable longitudinal evaluation.

Program A may implement contract and baseline work only if scoped. Full realization remains independently gated. No single PR is permitted to claim all ARIE behavior from a designed schema or synthetic performance chart.

## 13. Related documents

- [ADR-003](../decisions/ADR-003-AI-NATIVE-FLUID-INTELLIGENCE.md)
- [Vela Cognitive Intelligence Runtime](VELA-COGNITIVE-INTELLIGENCE-RUNTIME.md)
- [Experiential Learning Loop](VELA-EXPERIENTIAL-LEARNING-LOOP.md)
- [Capability Runtime](VELA-CAPABILITY-RUNTIME-AND-EXECUTION-FABRIC.md)
- [Charter 02 Liquid Intelligence and Motion](../../governance/02-LIQUID-INTELLIGENCE-AND-MOTION.md)
- [Charter 05 Agents, Tasks and Workflows](../../governance/05-AGENTS-TASKS-AND-WORKFLOWS.md)
- [Charter 09 Intelligence Streams](../../governance/09-INTELLIGENCE-STREAMS-AND-OBSERVABILITY.md)
- [Charter 10 AI Execution Profiler](../../governance/10-AI-EXECUTION-PROFILER.md)
- [Charter 13 Platform and Performance](../../governance/13-PLATFORM-PERFORMANCE-AND-DISPLAYS.md)
- [Charter 14 Trust](../../governance/14-TRUST-PRIVACY-AND-AUTONOMY.md)
- [Charter 15 Verification](../../governance/15-QUALITY-VERIFICATION-AND-ACCEPTANCE.md)

**Evidence status:** resource contracts, experiments, quality targets and workspace interactions here describe required future implementation; no native performance result is claimed.
