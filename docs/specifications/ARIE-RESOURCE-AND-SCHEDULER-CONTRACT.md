# ARIE Resource and Scheduler Contract
## Adaptive resource intelligence, foreground protection, bounded concurrency, and deterministic enforcement

| Field | Value |
|---|---|
| Document | ARIE-RESOURCE-AND-SCHEDULER-CONTRACT |
| Specification version | 1.0.0 (proposed implementation contract, 2026-11-10) |
| Program | Full Aerynth Realization (Program B) |
| Status | Companion technical specification; NOT native implementation or acceptance |
| Canonical owner | The existing Platform Performance Governor, extended as Adaptive Resource Intelligence Engine (ARIE) |
| Primary governance | Constitution 00; Charter 13 AW-PLT-140–168, 05 AW-ATW-171–177, 10 AW-AEP-160–164, 14 privacy/permissions, 15 AW-QVA-141–182 |
| Companion specifications | [AIR dynamic execution](AIR-DYNAMIC-EXECUTION-STRATEGY.md), [AEP experiments](AEP-ADAPTIVE-OPTIMIZATION-AND-EXPERIMENTS.md) |
| Source boundaries | MissionService owns task lifecycle/dispatch; ARIE owns policy/budgets/resource leases; AEP owns analysis and experiments; Charter 09 owns canonical event evidence |

> ARIE is not a new task engine, model router, or second governor. Extend the existing canonical platform Performance Governor. GPU/render quality policy and mission resource admission cooperate, but changing graphics tier is not permission to lower Vela model quality or suspend execution.

## 1. Required outcomes and invariants

**ARIE-RS-001 — Hardware-aware intelligence.** Maximize throughput and minimize mission critical-path latency when measured headroom exists; protect foreground input, gameplay frame pacing, audio/voice, renderer responsiveness, system reliability and user resource limits under pressure.

**ARIE-RS-002 — Cognition preservation.** Local CPU/GPU contention MUST NOT automatically downgrade remote inference capability, reasoning effort, CIE retrieval, independent verification or task outcomes. Adjust constrained **local execution** first; only a separately authorized AIR policy can change cognitive strategy.

**ARIE-RS-003 — Distinct budgets.** Maintain independent limits for local CPU-intensive workers, GPU compute, GPU-render effects, RAM/VRAM reservation, disk-intensive I/O, network/API request concurrency, provider rate limits and UI/voice priority. Concurrency of asynchronous API calls is not a count of CPU threads.

**ARIE-RS-004 — Source-based metering.** Never fabricate hardware readings, game detection, frame times, thermal data or provider-side inference compute. Preserve unavailable/unsupported/denied/stale as distinct values.

**ARIE-RS-005 — Deterministic fail-safe.** Sampling, admission, lease expiry, lock enforcement, emergency throttle and hysteresis operate without an LLM or network. A structured optional AI advisor interprets complex trends and proposes adjustments only at event/interval boundaries.

**ARIE-RS-006 — Minimum surveillance.** User-controlled foreground detection uses only permitted OS-level coarse process/focus and contention signals; no keylogging, screen/game-content capture, private process memory or file inspection. Collect identifiers only when necessary and redact scoped exports.

## 2. Canonical architecture

Dataflow:

1. **Platform capability probe:** Discover actual logical/physical CPU topology (if exposed), available RAM, available GPU/VRAM/engines, storage capacity, power/thermal support and OS process-management privileges. Results include source, accuracy and unsupported fields.
2. **Telemetry adapters:** Sample permitted system and Aerynth-process-tree signals, foreground responsiveness, renderer frame pacing and worker activity; aggregate to rolling windows off the UI thread.
3. **Pressure estimator:** Distinguish sustained contention from harmless high utilization. Evaluate combined CPU scheduling delay, foreground latency, memory commit/available RAM, swap/paging, GPU pressure, disk queue/write latency, thermal/power throttling and queued mission work. Treat absent signals as unknown.
4. **Policy resolver:** Combine hard safety bounds, Trust scope, user locks, foreground protection, task criticality, validated AEP policies, live pressure, battery/power and optional AI advice.
5. **Resource envelopes and lease broker:** Publish versioned effective budgets. Issue/reject/defer bounded local resource reservations with epoch, expiry and ownership.
6. **MissionService enforcement:** The existing scheduler consumes leases and queues/deprioritizes eligible tasks; ARIE cannot mutate mission states itself. Bounded workers and process-tree controls enforce accepted envelopes.
7. **Feedback:** Source-attributed action and observed effect go to canonical events/AEP; AEP evaluates whether a strategy helped and proposes scoped experiments.

**ARIE-RS-007 — Single authority.** Only the Performance Governor commits resource-policy revisions; only MissionService starts/stops tasks; only Trust authorizes monitoring and privileges. AEP can recommend policies, not enforce them.

**ARIE-RS-008 — Foreground isolation.** UI rendering, input, voice and high-priority notifications MUST NOT block on sampling, AI analysis, index scans, filesystem walks, artifact encoding or waiting for worker slots. Use bounded queues and suitable worker/process isolation.

## 3. Typed integration contracts

Implement real versioned closed schemas, explicit units/nullability, integer bounds, clock provenance, privacy class and migrations. Types below are normalized conceptual shapes, NOT literal OS/driver API definitions.

~~~typescript
type Availability = "observed" | "derived" | "estimated" | "unsupported" |
                    "permission_denied" | "stale" | "error";
type Metric = {
  name: string; value: number | null; unit: string;
  availability: Availability; source: string;
  observed_at_utc: string; monotonic_window_ms: number;
  sample_count: number; confidence?: string;
};
type ResourceSnapshot = {
  schema_version: "1.0"; snapshot_id: string; device_profile_id: string;
  session_epoch: string; sample_start_utc: string; sample_end_utc: string;
  source_scope: "system" | "process_tree" | "renderer" | "worker";
  metrics: Metric[]; privacy_scope: string; freshness_ms: number;
};
type ResourceBudget = {
  resource_class: "cpu_worker" | "local_gpu_compute" | "renderer_gpu" |
    "ram_bytes" | "vram_bytes" | "disk_io" | "network_api";
  limit: number; unit: string; reserved_headroom: number;
  max_queue: number; admission: "open" | "throttled" | "deferred";
};
type ResourcePolicy = {
  schema_version: "1.0"; policy_id: string; version: number;
  mode: "automatic" | "balanced" | "gaming_focus" | "max_throughput";
  origin: "user" | "validated_adaptation" | "safe_default";
  source_policy_version: number | null;
  user_locked: boolean; hard_limits: ResourceBudget[];
  effective_limits: ResourceBudget[]; priority_rules_ref: string;
  telemetry_consent_ref: string; effective_from_utc: string;
  hysteresis_profile_ref: string; previous_policy_ref: string | null;
};
type ResourceRecommendation = {
  schema_version: "1.0"; recommendation_id: string;
  origin: "heuristic" | "ai_advisor" | "aep_experiment" | "user";
  based_on_policy_version: number; snapshot_refs: string[];
  requested_budget_deltas: {resource_class: string; change: number; unit: string}[];
  reasoning_summary: string; uncertainty: string[];
  expected_benefit: string; projected_risks: string[];
  requested_effective_scope: string; expires_at_utc: string;
};
type ResourceLease = {
  schema_version: "1.0"; lease_id: string; policy_version: number;
  device_session_epoch: string; mission_id: string;
  task_id: string; attempt_id: string; worker_id: string;
  reserved: {resource_class: string; amount: number; unit: string}[];
  priority: "interactive" | "foreground" | "normal" | "background";
  state: "reserved" | "active" | "revoked" | "expired" | "released";
  issued_at_utc: string; expires_at_utc: string; renewed_at_utc: string | null;
  revocation_action: "complete_safe_point" | "checkpoint" | "no_preemption";
};
type PolicyDecisionReceipt = {
  policy_before: string; policy_after: string;
  cause: string; authorizer: string; measurement_refs: string[];
  recommendation_ref: string | null; validation: "accepted" | "rejected";
  affected_lease_refs: string[]; observed_effect_refs: string[];
  gaps: string[]; rollback_ref: string | null;
};
~~~

**ARIE-RS-009 — Host-only identities.** Mission/task/attempt/worker IDs, session epochs, actual hardware source, OS privileges, permission grants and effective resource limits are generated/verified by the host. A model cannot invent a lease, claim a metric, impersonate the foreground application or expand its own concurrency allocation.

**ARIE-RS-010 — Unit discipline.** Normalize CPU utilization against explicitly stated reference (logical capacity, per-core, process percent); memory and storage in bytes; bandwidth in bytes/sec; queue delays/frame time in ms; clocks in UTC plus monotonic duration when possible; power/thermal sensors only with genuine availability. Cross-process timestamps require uncertainty handling.

## 4. Pressure estimation and control loop

The control loop MUST incorporate at least:
- **CPU:** runnable queue and observed scheduling delay; sustained per-process/system busy periods; effective worker throughput versus additional worker contention.
- **Memory:** available/committed RAM, page faults/paging trend, active worker predicted peak, hard low-memory guard.
- **GPU:** Aerynth renderer versus local compute versus foreground workload where observed; available VRAM and frame-time tails, device loss.
- **Disk:** available bytes, working-space reservations, queue/latency, background indexing/write pressure and artifact safety.
- **Network/API:** connection pressure and rate-limit budgets independent of CPU; avoid congestion/flooding and provider quota spikes.
- **Foreground:** user-selected Gaming/Focus mode and privacy-respecting OS focus detection; measured responsiveness when available.
- **Power:** battery/AC and thermal state if observable; policy for unsupported devices must be explicit.
- **Mission deadlines:** interactive/voice urgency versus background mission fairness, without overriding user privacy or task authorization.

**ARIE-RS-011 — Baseline measurement.** Establish hardware-and-workload baseline and pressure thresholds experimentally on supported target machines. A solitary CPU > 85% threshold is not a sufficient control algorithm; illustrative numbers must never masquerade as approved defaults.

**ARIE-RS-012 — Hysteresis.** Use smoothed windows, a sustained-pressure entry condition, a separate recovery condition, minimum dwell time and cooldown. Escalate protection promptly for safety; restore throughput gradually, and avoid flapping under brief spikes.

**ARIE-RS-013 — AI advisor.** A low-frequency/event-triggered model MAY analyze aggregated bounded feature vectors (not raw personal processes), detect patterns, explain tradeoffs and propose per-class budget deltas. Every proposal is rejected or clamped on schema/permission/hardware mismatch; AI outage keeps deterministic control functioning.

**ARIE-RS-014 — User precedence.** Enforce order: safety/data integrity and authorization; explicit user hard limits; protected interactivity/accessibility; accepted mission policy; experimentally justified adaptive recommendations; throughput heuristics. Automatic policies never override user-locked caps.

**ARIE-RS-015 — Monitoring transparency.** UI clearly displays monitoring enabled/disabled, sensor coverage/age, effective mode, active policy source and reason for throttling. Detection of a foreground game is a permitted signal, not permission to inspect the game's content.

## 5. Admission, scheduling, fairness and preemption

Resource leases are **reservations/admission contracts**, not claims of OS hard guarantees unless an actual process/OS limit has been applied and verified.

Lease lifecycle:
**requested → accepted/reserved → active → released**. From reserved/active, **expired** or **revoked** are possible with observable reason and cleanup. A lease cannot be revived after an epoch or session change; a new lease requires fresh admission. Resource state does not itself complete/abort the task.

**ARIE-RS-016 — Bounded pools.** Heavy local jobs run in worker pools/processes distinct from the UI thread, with task-class concurrency, queue capacity, per-worker memory estimates and backpressure. Parallelize only when measured effective speedup exceeds contention/coordination penalties.

**ARIE-RS-017 — Fairness.** Use a documented bounded-wait policy (e.g. weighted fair scheduling with aging or equivalent). Interactive/foreground tasks preempt safely where possible; long background jobs retain resumable checkpoints and are not silently starved indefinitely.

**ARIE-RS-018 — Preemption safety.** Separate delaying a new admission, lowering scheduling priority, cooperative checkpoint/pause, cancelling a queued job and terminating a worker. Do not suspend arbitrary external effects, writes or uncheckpointable critical operations on model advice. MissionService emits true task state and reconciles UNKNOWN outcomes.

**ARIE-RS-019 — Lease validation.** Admission checks live policy version, current resource estimates, required class limits, remaining hard budget and task priority. A policy revision can disallow new admissions while existing leases finish a safe point. Reject stale epochs, duplicate acquire/release, negative reservations, invented resources and requests exceeding user caps.

**ARIE-RS-020 — OS enforceability.** When available and authorized, use supported process-tree priorities, concurrency bounds, affinity or job-object limits; record whether the limit is advisory, admission-enforced or OS-enforced. Never claim strict disk/GPU isolation without actually supporting it.

**ARIE-RS-021 — Reconciliation.** On process crash, device sleep/wake, profile change or restart, recover persisted lease intent and worker identity but remeasure live worker processes. Expire orphan leases; preserve canonical task attempts and unknown external effects for MissionService reconciliation.

## 6. Resource modes and practical behavior

| Mode | Intended behavior | Must not happen |
|---|---|---|
| Automatic | Pressure-driven resource policy with hysteresis and optional validated AI guidance | Oscillating limits on noisy samples |
| Balanced | Reserve ordinary foreground headroom while running permitted background work | Permanent artificial idle throttling |
| Gaming / Focus | Protect interactive frame time, audio/voice, GPU/VRAM, disk and local CPU; retain eligible remote reasoning | Lower AI quality merely because a game is open |
| Max Throughput | Increase bounded local workers when tested headroom exists, with explicit safety and foreground reserves | Launching uncontrolled workers or exceeding user caps |

**ARIE-RS-022 — Gaming path.** First reduce optional background visuals, indexing, local large builds, expensive file scans and local GPU compute. Continue qualified asynchronous remote model calls and light read-only retrieval when network and permissions allow. Deferral and changed expected time are visible as task states; not fabricated progress.

**ARIE-RS-023 — Idle path.** Raise concurrency cautiously after sustained headroom and observed improvement. Reserve memory and CPU/GPU resources for sudden user interaction. Respect storage free-space reservations where configured; never infer permission for unrequested work from an idle machine.

**ARIE-RS-024 — Adaptive policy cohorts.** A learned worker-count or GPU policy applies only to evaluated device topology, foreground workload class, power profile, driver/toolchain and task family. Significant OS/driver/hardware changes invalidate or require policy requalification.

## 7. AEP, AIR, CIE and workspace integration

- **AEP → ARIE:** evidence-grounded candidate with baseline, quality, hardware cohort, measured benefit, confidence/limitations, approval state, stop and rollback thresholds.
- **ARIE → AEP:** snapshots, policy revision receipts, worker occupancy, lease latency, actual process/foreground impact, sensor gaps, control oscillation and instrumentation burden.
- **AIR → ARIE:** declarative task resource hints and priorities; cannot request hidden GPU/CPU inference downgrade or exceed user locks.
- **ARIE → MissionService:** admission/denial/deferral/lease transitions, current epoch, safe checkpoint hint. MissionService owns queued/running/interrupted/unknown execution.
- **CIE:** authorized projections of effective policies and valid experiments to support contextual future decisions; it is not policy storage.
- **Charter 09/workspace:** source events show current status, why it changed, old/new budgets and confidence, what actually ran and whether measurements are stale. No fabricated CPU numbers or retroactively invented decisions.

**ARIE-RS-025 — Safe policy promotion.** ARIE may apply AEP-promoted policy only when it validates evidence scope, approval, current hardware and hard limits. Keep the previous version for atomic revert and instant safe default. AEP is not permitted to directly mutate ARIE runtime state.

**ARIE-RS-026 — Privacy.** Never commit actual machine-specific private process lists, telemetry streams, credentials or named user application histories to this public repository. Use synthetic fixtures, redacted receipts and controlled native evidence.

## 8. Fault behavior

| Failure | Required behavior |
|---|---|
| Sensor absent or permission denied | Mark missing; use safe bounded defaults; no invented observation |
| Sensor stale, clocks unreliable | Degrade pressure confidence, no aggressive scale-up on stale data |
| API advisor unavailable/invalid | Continue deterministic policy; record rejected/missing advisor |
| Driver GPU reset/VRAM pressure | Protect renderer and process safety; defer optional GPU compute |
| System memory pressure | Stop admitting heavy workers; checkpoint eligible tasks; preserve artifacts |
| Disk full/slow | Bound indexing/build temp usage and protect persistence transactions |
| Network/provider rate limit | Apply separate API budget/backoff, no CPU-based false attribution |
| Foreground priority changes suddenly | Reduce eligible background work at safe points; respect user locks |
| Crash with active leases | Expire/reconcile leases and preserve true task/effect state |
| Malicious AI recommendation | Reject by schema, permission, and absolute upper bounds |

**ARIE-RS-027 — Degraded mode is operational.** Resource governor must remain available offline, with a visible conservative mode that preserves UI functionality and verified task state.

## 9. Native test matrix and benchmark obligations

| ID | Scenario | Required observed evidence |
|---|---|---|
| ARIE-RS-T01 | CPU-saturated multi-process build | Measured worker cap, bounded queue and no UI-thread blocking |
| ARIE-RS-T02 | Gaming workload + remote AI + local compiler | Foreground frame/input tails, local backoff, unchanged approved reasoning effort |
| ARIE-RS-T03 | Sustained idle workload | Throughput benefit across repeats, actual worker concurrency and reserved headroom |
| ARIE-RS-T04 | Alternating CPU/GPU spikes | Enter/recovery hysteresis, policy transition count, no flapping |
| ARIE-RS-T05 | GPU unavailable or unsupported | Missingness and safe local/remote scheduling |
| ARIE-RS-T06 | Low RAM and disk pressure | Admission rejection/deferral, artifact integrity and recovery |
| ARIE-RS-T07 | Competing foreground/background missions | Fairness, bounded queue waits, no starvation |
| ARIE-RS-T08 | Unauthorized AI asks to increase resources | Rejected recommendation, unchanged policy/version and source event |
| ARIE-RS-T09 | Pause/restart during non-idempotent effect | Accurate UNKNOWN state and no repeated effect |
| ARIE-RS-T10 | User-locked Gaming mode vs advisor | Explicit user precedence, no silent overrides |
| ARIE-RS-T11 | Learned policy on different hardware | Denied until qualified; no uncontrolled transfer |
| ARIE-RS-T12 | Telemetry collector load | Measured sampler overhead, no profiler-induced stutter |

Measure paired/repeated baseline vs policy on actual Windows desktop hardware, with OS build, drivers, CPU topology, GPU, power plan, sample sources/windows, foreground workload, local/remote work mix, task quality, network/provider conditions and known gaps declared. Report p50/p95/p99 foreground/UI responsiveness where available, mission p50/p95, critical path, worker occupancy, queue delays, contention, memory/disk pressure and instrument overhead. Synthetic fixtures are unit evidence only.

## 10. Phased implementation and open decisions

1. Integrate with the existing Performance Governor; inventory current native telemetry/supported process controls, consent, event and renderer budget seams.
2. Define versioned snapshots, policy resolver, admission and lease API; prove safe default/offline behavior and schema negatives.
3. Introduce bounded CPU worker/process pools and true source-backed local resource measurements. Preserve existing renderer controls.
4. Apply pressure/hysteresis, protected foreground mode, fair queues and restart-safe leases; test native Windows contention.
5. Integrate event-driven advisory AI and validated AEP strategy proposals only after objective baselines and permission hardening.
6. Connect one real evidence stream to the Adaptive Intelligence Workspace; independently qualify user controls and accessibility.

Open, not assumed: exact pressure thresholds/dwell periods, platform-specific WMI/ETW/PDH/GPU counters and availability, portability to macOS/Linux, GPU isolation viability, native thread/affinity effects, battery/thermal permissions, initial worker defaults and benchmark noise margins. Resolve through measured ADRs.

## 11. Traceability

- Canonical authority/hardware policy: AW-PLT-140–168.
- Concurrency/isolation/mission state: AW-ATW-171–180.
- Profiling and evidence-grounded experimentation: AW-AEP-138–178.
- Privacy and data retention: Charter 14; data/event provenance: Charter 09.
- Independent acceptance: PLT-ARIE-01–08 and Charter 15 FI-QA gates.

**Publishing this document does not demonstrate functioning ARIE, native resource protection or verified improvement.**
