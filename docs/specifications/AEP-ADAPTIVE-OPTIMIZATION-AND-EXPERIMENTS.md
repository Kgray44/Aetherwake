# AEP Adaptive Optimization and Experiments
## AI Execution Profiler: verified critical paths, quality-gated experiments, explainable policy learning, and rollback

| Field | Value |
|---|---|
| Document | AEP-ADAPTIVE-OPTIMIZATION-AND-EXPERIMENTS |
| Specification version | 1.0.0 (proposed implementation contract, 2026-11-10) |
| Program | Full Aerynth Realization (Program B) |
| Status | Companion technical specification; NOT operating adaptive learning or accepted benchmarks |
| Canonical owner | The existing **AI Execution Profiler (AEP)**; Adaptive Execution Profiler describes its expanded behavior, not a second profiler |
| Primary governance | Constitution 00; Charter 10 AW-AEP-001–178; Charter 09 AW-OBS-148–178; Charter 05 AW-ATW-164–192; Charter 13 AW-PLT-140–168; Charter 15 AW-QVA-141–182; Charter 14 Trust |
| Companion specifications | [AIR dynamic execution](AIR-DYNAMIC-EXECUTION-STRATEGY.md), [ARIE scheduler contract](ARIE-RESOURCE-AND-SCHEDULER-CONTRACT.md) |
| Source boundary | Charter 09 owns canonical events; task/verification owners own actual outcomes; AEP owns metrics, cohorts, experiments, conclusions and recommendation evidence; policy owners alone commit active changes |

> The acceptance question is **not** “Did a model make fewer calls?” It is “Did the new strategy reliably improve the verified result and/or time to it, without losing semantic understanding, context, verification, accessibility, trust or user control?” The profiler is evidence infrastructure, not a model-training pipeline and not permission for silent code modification.

## 1. Core principles and ownership

**AEP-AO-001 — Preserve intelligence and quality.** An experiment must satisfy mandatory quality and authorization gates before latency, cost or throughput improvements may justify promotion. A strategy that removes necessary reasoning or verification is invalid, even if statistically faster.

**AEP-AO-002 — Canonical measurements.** AEP consumes source-attributed events, provider usage, OS/ARIE snapshots, artifact checks and independent reviews. It never invents model internals, hidden reasoning, measured costs or verified outcomes.

**AEP-AO-003 — Cross-engine adaptation without duplicate owners.** AIR owns cognitive/model policy; MissionService owns task planning/execution policy and status; ARIE owns hardware budget policy; CIE owns authorized evidence retrieval/projection; AEP owns experiment and recommendation records. Only each owner can adopt a candidate. No second active-policy store or centralized “agent IQ” score.

**AEP-AO-004 — Deliberate non-optimization.** AEP must be able to conclude “no safe improvement”, “insufficient evidence”, “slower but better”, or “retain baseline” and preserve the explanation. Lower model-call count and higher aggregate tokens/sec are not independent success criteria.

## 2. Observability and normalized evidence

Capture:
- **Cognitive:** intake interpretation, CIE evidence-needs and retrieval, plan proposals/compiler rejections, qualified model/effort/capability, executive interventions, verifier conclusions.
- **Execution:** canonical mission/task/attempt/call IDs, DAG and plan versions, queue/dependency waits, tool start/finish, streamed partial output, provider result, native effect readback, artifact receipt and user delivery.
- **Provider:** actual route/model/version, usage class (input/output/cache/reasoning when reported), tool fees, request transport, service tier, response status and rate-limit handling; estimates labeled.
- **Machine:** ARIE-authorized scoped snapshots/lease epochs, worker occupancy, CPU/GPU/RAM/disk/network contention, foreground responsiveness, renderer timing, sensor gaps and instrumentation burden.
- **Human feedback:** linked corrections, acceptance/rejection, explicitly changed requirements, preferred output details and discovered rework (subject to privacy/consent).

**AEP-AO-005 — Clock discipline.** Use process-local monotonic timestamps for durations; retain UTC wall clock and time-source uncertainty for interprocess/provider joins. Never subtract clocks of unknown shared origin as exact latency. Resume creates explicit segments and gap reasons.

**AEP-AO-006 — Provenance classes.** Each value is observed, provider-reported, derived, estimated, inferred, unavailable or disputed. Zero is a measured zero only. Missing telemetry is not zero latency, zero token use or successful verification.

**AEP-AO-007 — Replay-safe attribution.** Deduplicate canonical event IDs and provider attempt receipts; persist correction/reconciliation records rather than overwriting original events. Multi-workspace projections must not double-count shared tasks.

**AEP-AO-008 — Overlap integrity.** AEP computes wall time from the union of applicable intervals and independent task DAG, not the sum of agent spans. Separate cumulative worker-time, queue wait, provider latency and elapsed critical-path time.

**AEP-AO-009 — Instrumentation overhead.** Event ingestion, analysis and UI updates use bounded queues, batching, backpressure and off-renderer computation. Track dropped samples, collector lag, reconciliation backlog, sampling intensity and profiler-caused latency.

## 3. Typed contracts and evidence schema

These are illustrative normalized TypeScript types. Implementation MUST publish strict versioned schemas with bounds, checked IDs, provenance, units, nullable unavailable fields, privacy scope, migration rules and canonical event references. Nothing below is an OpenAI API schema.

~~~typescript
type Provenance = "observed"|"provider_reported"|"derived"|
  "estimated"|"inferred"|"unavailable"|"disputed";
type EvidenceRef = {
  event_id:string; source_owner:string; revision:string;
  privacy_scope:string; evidence_status:string;
};
type Span = {
  schema_version:"1.0"; span_id:string; trace_id:string;
  parent_span_id:string|null; mission_id:string|null;
  task_id:string|null; attempt_id:string|null;
  plan_version:number|null; policy_version:string|null;
  capability_qualification_ref:string|null;
  kind:"perception"|"context"|"planning"|"queue"|"model"|"tool"|
       "resource_wait"|"execution"|"verification"|"artifact"|"delivery";
  state:"queued"|"active"|"suspended"|"finished"|"unknown";
  started_monotonic_ns:string|null; ended_monotonic_ns:string|null;
  process_clock_epoch:string|null;
  started_utc:string; ended_utc:string|null;
  source_refs:EvidenceRef[]; coverage:"complete"|"partial"|"unknown";
};
type Measurement = {
  metric_id:string; trace_id:string; related_span_ids:string[];
  name:string; value:number|null; unit:string;
  provenance:Provenance; provider:string|null;
  observed_at_utc:string; sample_window_ms:number|null;
  source_refs:EvidenceRef[]; missing_reason:string|null;
};
type VerifiedOutcome = {
  mission_id:string; acceptance_revision:string;
  verification_authority:string;
  status:"verified"|"failed"|"partial"|"unknown";
  artifact_refs:string[]; quality_dimensions:Record<string,string>;
  objective_test_refs:EvidenceRef[]; independent_review_refs:EvidenceRef[];
};
type OptimizationCandidate = {
  candidate_id:string; schema_version:"1.0";
  target_owner:"AIR"|"MissionService"|"ARIE"|"CIE";
  proposed_policy_diff_ref:string;
  task_family:string; scope_predicate_ref:string;
  observed_problem:string; hypothesis:string;
  expected_benefits:string[]; risks:string[];
  baseline_policy_ref:string; proposed_policy_ref:string;
  evidence_refs:EvidenceRef[]; confounders:string[];
  experiment_design_ref:string; proposer:string;
  status:"hypothesis"|"eligible"|"rejected"|"in_experiment"|
         "validated"|"recommended"|"superseded";
};
type Experiment = {
  experiment_id:string; candidate_id:string; protocol_version:string;
  population:string; eligibility_predicate_ref:string;
  baseline_ref:string; treatment_ref:string;
  assignment_method:string; comparison_method:string;
  holdout_ref:string; randomization_seed_ref:string|null;
  start_utc:string; end_utc:string|null;
  enrollment_count:number; excluded_count:number;
  exclusion_reasons:string[]; safety_stops:string[];
  outcomes:VerifiedOutcome[]; metrics:Measurement[];
  confounders:string[]; coverage_notes:string[];
  conclusion:"pending"|"benefit"|"neutral"|"harm"|"inconclusive";
};
type PolicyPromotionRequest = {
  candidate_id:string; experiment_ids:string[];
  target_owner:string; current_policy_version:string;
  proposed_policy_version:string; applicability_scope_ref:string;
  evaluator_refs:string[]; guardrail_receipt_refs:string[];
  required_authorization_ref:string; rollback_to_version:string;
};
type PolicyDecisionReceipt = {
  decision_id:string; target_owner:string;
  candidate_id:string; based_on_version:string;
  decision:"approved"|"rejected"|"rolled_back"|"expired";
  effective_version:string|null; authorizer_ref:string;
  reasons:string[]; evidence_refs:EvidenceRef[];
  activated_utc:string|null; revert_trigger_refs:string[];
};
type LearningProjection = {
  finding_id:string; status:"observed"|"hypothesis"|"validated"|
    "active_policy"|"rejected"|"rolled_back"|"stale";
  task_and_hardware_cohort_ref:string; active_policy_ref:string|null;
  claims:string[]; counterexamples:string[]; evidence_refs:EvidenceRef[];
  verified_at_utc:string|null; revalidation_conditions:string[];
};
~~~

**AEP-AO-010 — Durable lineage.** Every finding links to actual spans/events, current policy/plan version, CIE evidence-package IDs, model qualifications, ARIE device/resource epochs and verification authority where applicable. Exported redacted projections carry stable references without disclosing forbidden source content.

**AEP-AO-011 — Missingness disclosure.** Observations, estimates, rejected samples, source-clock gaps, overwritten telemetry, incomplete provider billing and unknown effects remain visible in the dataset and UI.

## 4. Metric definitions: outcome-first and interval-correct

Use explicitly defined boundaries and scopes:

| Metric | Definition |
|---|---|
| Input-to-acknowledgment | Request admission until a meaningful admitted/queued/user-visible acknowledgment, separately labeled |
| First meaningful response | First semantically useful user-facing text or state summary; NOT merely first streamed token |
| First verified useful result | Earliest independently verified deliverable useful to the user |
| Last verified artifact | Latest verified required artifact available for delivery |
| Final user delivery | User-visible complete or truthfully partial/blocked result |
| Mission wall time | Observed elapsed start→terminal/delivery with pause/unknown segments annotated |
| Critical path | Longest causal path through dependency and wait graph, not sum of overlapping worker durations |
| Total worker effort | Sum of worker intervals; can exceed wall time |
| Realized concurrency | Observed simultaneous eligible active intervals vs plan, excluding falsified/suspended work |
| Dependency/queue/resource waits | Separately attributable waits with event/lease evidence |
| First-pass acceptance | Verified success on initial eligible attempt / all eligible outcomes with coverage |
| Rework ratio | Corrective work effort / attributable task effort, defined units and coverage |
| Provider economics | Actual reported token/tool cost, cache classes, tier, fees and estimated parts distinguished |
| Foreground interference | Delta in foreground frame-time/input/audio tails against matched baseline, with ARIE source |
| Quality and correctness | Independent artifact/semantic acceptance by dimension and explicit unknowns |

**AEP-AO-012 — No misleading aggregates.** p50/p95/p99 only when cohort size/sampling permits meaningful reporting, accompanied by N, dispersion/uncertainty, exclusions, task family and quality filter. Small samples get individual results and a clear “insufficient evidence” conclusion.

**AEP-AO-013 — Separate task outcomes.** Provider “completed”, command exit 0, model confidence, file existence and user-accepted deliverable are distinct events. Import final verification from canonical artifact/task owners.

**AEP-AO-014 — No scalar escape hatch.** Do not average a privacy violation, missing context, failed build, inaccessible UI or duplicate external action into a supposedly excellent overall “efficiency score”.

## 5. Adaptive optimization lifecycle and controlled experiments

Lifecycle:
**observed pattern → evidence-backed hypothesis → candidate eligibility review → experiment design locked → bounded trial → independent verification → measured conclusion → owner recommendation → owner-approved limited activation → monitor → retain/requalify/rollback**.

Candidate and experiment status are durable and separate. Failed/rejected/rolled-back strategies remain retrievable as negative learning, never silently restored.

**AEP-AO-015 — Candidate completeness.** A candidate must state current problem, exact target policy owner, intended task/device/provider cohort, hypothesis, proposed strategy change, predicted benefits, tradeoffs, confounders, data sources, evaluation approach, user/Trust constraints and immediate stop condition. Model-generated hypotheses are not measurements.

**AEP-AO-016 — Experimental equivalence.** Define baseline and treatment that attempt the same authorized goals, deliverables, evidence coverage and verification. Compare paired or stratified tasks, using randomized/counterbalanced assignment where feasible; freeze known configuration or record model-version, cache, network/provider, hardware/load, difficulty and tool differences.

**AEP-AO-017 — Holdout and anti-overfitting.** Reserve previously unseen tasks/future tasks for validation. Do not optimize repeatedly against the same fixture-only benchmarks and call it generalization. Track false positives, failed branches, user corrections and long-term rework, not only successful trials.

**AEP-AO-018 — Statistical honesty.** Predefine primary quality and latency endpoints, exclusion rules, minimum practical effect, confidence method and stopping criteria. Use paired/stratified distributions and uncertainty intervals rather than declaring victory from one fast run. If samples lack power, mark inconclusive. Do not invent p-values or “significance”.

**AEP-AO-019 — Independent verification gate.** Test actual outputs, context sufficiency, consent, security, accessibility and domain quality independently of the strategy planner; if either mandatory gate fails, reject promotion regardless of median speed. Human review remains available for ambiguous qualitative outcomes.

**AEP-AO-020 — Stop optimizing.** Explicitly record a guarded decision to retain slower/deeper models, more context, independent critique, additional API calls, or lower local concurrency when those improve robustness, fidelity, foreground responsiveness or trust.

**AEP-AO-021 — Experiment containment.** Background experiments require authorized scope, explicit provider spend envelope, local resource leases, cancellation, retention rules and tool permissions. Use safe simulations or read-only work by default. Never duplicate consequential external actions merely for A/B testing or silently edit application code.

**AEP-AO-022 — Segment by applicability.** Conclusions must retain task class/difficulty, user/project constraints, model/provider/effort, tool availability, CIE coverage, hardware profile/power/foreground class, policy versions, privacy context, date and environment. Transfer across domains needs new evidence.

## 6. Promotion, rollout, monitoring, and reversal

- AEP emits recommendation with evidence and a proposed **narrow** applicability predicate; it cannot mutate effective AIR, MissionService, ARIE or CIE policy.
- The target owner validates current baseline version, compatibility, live permissions, scope, guardrails, effect risk, rollout size, authorization and rollback readiness.
- A successful decision creates an atomic authoritative policy revision receipt with old/new IDs and effect timestamp. Rejected recommendations remain inspectable with reason.
- Start with shadow/canary or a bounded eligible cohort when authorized. Compare ongoing quality, latency, rework, negative feedback, actual resource impact and drift.
- On regression, changed model/hardware/toolchain, evidence invalidation, privacy revoke, unexpected negative impact or explicit user override, owner suspends/reverts to known-good policy with truthful event and previous state available.
- AEP links new run evidence and publishes longitudinal findings; CIE indexes only authorized source-grounded projections.

**AEP-AO-023 — No silent promotion.** Automatic promotion is eligible only within an already approved scope/policy and demonstrated safety limits. Otherwise require explicit authorized owner/user review. Promotion cannot enlarge tool access, provider egress, rate/budget limits or autonomy.

**AEP-AO-024 — Version fencing.** Promotion/reversal applies against current effective policy version, not one observed before concurrent edits. Reject stale compare-and-swap, invalid cohort, unsupported model/feature and absent independent quality checks.

**AEP-AO-025 — Rollback is first-class.** Every activated policy has a known-safe previous version, reason and activation cohort; rollback stops new admissions promptly, handles in-flight work through MissionService safe-point rules, and does not rewrite history to conceal failure.

**AEP-AO-026 — Expiration/revalidation.** TTLs or drift triggers apply to learned strategy scope. Significant model/provider, retrieval corpus, device topology, driver, task distribution or user-preference changes require requalification. A stale finding cannot silently remain universal default.

## 7. Practical optimization classes

| Candidate | Positive evidence | Guard against |
|---|---|---|
| Lightweight intake model | Equal semantic intent/referent recall on unseen requests, lower critical path | Mistaken confidence / missed constraints |
| Stronger planner early | Less verification failure/rework and better total time | Overuse on trivial operations |
| Parallel retrieval | Real source coverage maintained; reduced waiting | Unauthorized speculative egress / duplicate source cost |
| Additional reviewer | Higher objective/semantic correctness on hard tasks | Ceremonial critic added to every request |
| Fewer agent branches | Equal verified work, lower coordination overhead | Lost independent evidence or parallel capacity |
| Persistent transport / async tools | Measured lower provider/tool wall time | Unsupported model/tool, reconnect duplicate effects |
| Prompt caching | Lower actual charged/elapsed context processing | Stale context, privacy leakage across scopes |
| ARIE worker tuning | Faster accepted missions and protected foreground tails | Overheating, GPU contention, mode flapping |
| Improved task checkpointing | Fewer repeated effects and quicker recoveries | Corrupted state or duplicated external writes |

These are **hypotheses for qualification**, not predefined wins. AI may help identify promising experiments, but decisions require real observations.

## 8. AI reasoning and CIE learning interfaces

**AEP-AO-027 — AI diagnosis.** At meaningful intervals or explicit user request, use a qualified model on a bounded authorized metrics/evidence summary to identify likely critical-path bottlenecks, competing explanations and possible optimizations. Preserve each candidate as hypothesis, never an already measured cause.

**AEP-AO-028 — Experiential retrieval.** Publish sanitized, source-attributed findings and counterexamples through CIE projections. AIR can request relevant past strategies with applicability and confidence; CIE retrieval alone cannot activate a new policy.

**AEP-AO-029 — No recursive profiler tax.** Do not call an AI model per token, timer sample or model event. Batch investigation by anomaly, experiment boundary, policy change or user query, measuring AEP's own overhead.

**AEP-AO-030 — Model/evaluator independence.** The planning model's own positive judgment is not independent verification. Separate objective tests and disjoint or blinded semantic review where available; disclose unavoidable evaluator overlap and its limitations.

## 9. Adaptive Intelligence Workspace contract

AEP provides source-backed metrics and learning projections to the *existing* spatial Intelligence Stream, Vela Presence/Mind and Timeline experience; it does not create a new display database or detached generic dashboard.

Required linked perspectives:
1. **Decision Observatory:** model/agent/tool/effort/plan decisions, alternatives, causal evidence, uncertainty, accepted/rejected outcomes.
2. **Execution Profiler:** true spans, DAG overlap, critical-path/wait views, tokens/cost provenance and verified useful-result timing.
3. **Resource Intelligence:** ARIE's live effective mode/budgets, worker/lease decisions, sensor coverage, foreground impact and reversibility.
4. **Learning Observatory:** observations, hypotheses, supported and refuted findings, effective scoped policies and counterexamples.
5. **Experiment Laboratory:** baseline vs treatment, cohort controls, primary metrics, confidence/gaps, approvals and stop conditions.
6. **Adaptation Timeline:** durable promotions, expiry, revocations, rollbacks, provider/hardware changes and longitudinal outcomes.

**AEP-AO-031 — Truthful inspectability.** Every animation, gauge, model selection, recommendation, experiment status and claimed gain traces to canonical IDs. Synthetic fixtures are clearly labeled; hidden model chain-of-thought is never fabricated or described as exposed.

**AEP-AO-032 — Readback controls.** User interaction to pause experiments, change mode, pin/revert a policy or adjust learning scope must invoke the actual authorized subsystem and confirm authoritative state. Optimistic visuals alone are not success.

**AEP-AO-033 — Accessible and low-load.** Provide readable text/tables, keyboard/screen-reader and reduced motion, plus GPU quality scaling under ARIE without destroying inspectability or underlying model cognition.

**AEP-AO-034 — Queryable explanations.** Vela can answer “Why this model?”, “Why fewer CPU workers while gaming?”, “What improved this week?” by retrieving linked decision/experiment evidence and clearly stating missing or merely inferred explanations.

## 10. Failure, privacy and data-lifecycle controls

| Fault or adversary | Required result |
|---|---|
| Missing provider token usage or clock source | Explicit unknown/estimated fields; no false cost totals |
| Replay/reconnect duplicates | Stable event ID dedupe; no inflated spans |
| Long mission interrupted/restarted | Segmented trace with gap and true unknown state |
| Deleted original context or revoked permission | Derived CIE projections and workspace access invalidated appropriately |
| Prompt injection inside tool response | Content remains untrusted evidence; no new permission or policy |
| Model suggests reducing tests/reasoning for speed | Quality gates reject if capability/verification is lost |
| Concurrent policy update | CAS/version fence rejects stale promotion |
| AEP service missing/overloaded | Mission execution continues, quality unchanged; profiling indicates gaps |
| Hardware/driver/provider drift | Scoped findings expire or need revalidation |
| Private process/repository data in comparison | Redacted scoped views; no accidental public export |

**AEP-AO-035 — Bound monitoring.** Use configurable retention, authorized export scopes, sampling and aggregation; minimize personally identifying telemetry. Public repository holds only synthetic fixtures and non-sensitive redacted evidence. No hidden personal behavior monitoring.

**AEP-AO-036 — Self-observation integrity.** Monitor profiler resource cost itself, including CPU, memory, disk, render overhead, API diagnosis calls and missing events. The profiler must not significantly worsen its own target performance.

## 11. Test protocol and release evidence

| ID | Test | Acceptable evidence |
|---|---|---|
| AEP-AO-T01 | Parallel graph with overlapping spans | Monotonic intervals, correctly computed union and critical path |
| AEP-AO-T02 | Replay, late event, clock skew | Dedupe, uncertain intervals and no double-count |
| AEP-AO-T03 | Provider usage missing/estimated | Truthful provenance and visible missingness |
| AEP-AO-T04 | Hard task with extra reasoning | Quality-preserving “do not optimize” conclusion where warranted |
| AEP-AO-T05 | Faster but less accurate candidate | Automatic rejection despite elapsed-time win |
| AEP-AO-T06 | Paired heterogeneous mission cohort | Stratification/holdout, declared confounders and defensible uncertainty |
| AEP-AO-T07 | Promotion race | Authoritative owner rejects stale baseline version |
| AEP-AO-T08 | Scope transfer to new hardware/provider | Reject or requalify; no universal generalization |
| AEP-AO-T09 | Approved canary later regresses | Rollback and preserved historical evidence |
| AEP-AO-T10 | ARIE gaming/idle tuning | Native foreground/UI latency, true worker caps, unchanged AI task quality |
| AEP-AO-T11 | Learning retrieval | CIE returns active policy, rejected candidate, supporting evidence and counterexamples |
| AEP-AO-T12 | Workspace live vs replay | Displayed statuses/causal decisions match canonical logs |
| AEP-AO-T13 | Unauthorized experimental tool/spend | Denied, no side effect, provenance retained |
| AEP-AO-T14 | Monitoring failure/overhead | Bounded queues, preserved missions, honest dropped samples |
| AEP-AO-T15 | Historical user preference corrected | Old learned policy not reactivated; newer authoritative preference wins |
| AEP-AO-T16 | No experimental benefit | Explicit inconclusive/no-change with evidence instead of invented success |

Report, for every material comparison: task population and cohort eligibility, sample sizes/exclusions, protocol version, control/treatment policy and model versions, source-verified accepted outputs, per-dimension quality, p50/p95 or honest insufficiency, true first-useful-result and final completion time, worker-time/overlap, API cost provenance, resource/foreground effects, provider/hardware confounders, uncertainty, negative results and rollback readiness.

Required evidence tiers: schema/unit/fuzz tests → synthetic event-source tests → real API/tool integration → packaged-native independent measurements → held-out longitudinal trials → user-visible spatial and accessibility acceptance. One passing mock, attractive chart, model self-report or documentation PR **does not** certify adaptive learning.

## 12. Build sequence and open decisions

1. Audit and extend **existing** profiler spans/usage/event ingestion, preserving raw canonical event ownership and schema migrations.
2. Implement reliable interval joining, critical path, useful-result markers, queue/resource waits, missingness and overhead accounting.
3. Establish independent outcome quality and experiment harness, including holdouts, pairing, privacy and artifact verification.
4. Create durable candidate/experiment/decision records and scoped reversible recommendations to AIR, MissionService and ARIE.
5. Integrate authorized CIE projections and policy applicability revalidation; demonstrate future-mission behavior change and rollback.
6. Render one truthful data path into the existing Adaptive Intelligence Workspace and Vela's conversational explanations.

Unsettled until evaluated: cohort sizes, effect/confidence thresholds, statistical method by workload, which provider features support online experiments, sampling cadence/retention, how to quantify subjective cinematic quality, level of automated policy promotion, and hardware-specific profiling overhead. Document decisions through evidence, not speculation.

## 13. Traceability

- AEP canonical metrics, quality and experiments: AW-AEP-077–112 and AW-AEP-138–178.
- Task/plan and executive provenance: AW-ATW-164–192; AIR cognitive quality: AW-VELA-218–251.
- ARIE policy/hardware boundaries: AW-PLT-140–168; truthful UI/event owners: AW-OBS-148–178.
- CIE evidence/learning: AW-CIE-165–197; independent acceptance: AW-QVA-141–182.
- Security/retention/permission: Charter 14 and Constitution 00.

**This document specifies an adaptive profiler; it does not claim current Aerynth already conducts experiments, learns policies, or has an accepted native workspace.**
