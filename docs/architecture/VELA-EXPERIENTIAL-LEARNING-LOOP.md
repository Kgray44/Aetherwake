# Vela Experiential Learning Loop

**Architecture:** FI-LEARN-01 · **Status:** designed, implementation and empirical learning not yet verified  
**Authority:** [ADR-003 AI-Native Fluid Intelligence](../decisions/ADR-003-AI-NATIVE-FLUID-INTELLIGENCE.md); Constitution 00; [Vela 06](../../governance/06-VELA-INTELLIGENCE-AND-ADAPTATION.md), [CIE 08](../../governance/08-CONTEXT-INTELLIGENCE-AND-MEMORY.md), [Observability 09](../../governance/09-INTELLIGENCE-STREAMS-AND-OBSERVABILITY.md), [AEP 10](../../governance/10-AI-EXECUTION-PROFILER.md), [Platform/ARIE 13](../../governance/13-PLATFORM-PERFORMANCE-AND-DISPLAYS.md), [Trust 14](../../governance/14-TRUST-PRIVACY-AND-AUTONOMY.md), [Quality 15](../../governance/15-QUALITY-VERIFICATION-AND-ACCEPTANCE.md)  
**Program:** Full Aerynth Realization after appropriate Architecture Recovery boundaries; this document creates no new governed memory or profiler owner.

## 1. Why this exists

Fluid Intelligence means Vela can use **evidence from real experience** to improve how she understands, plans, chooses tools, organizes agents, spends resources, verifies work and communicates. It must not mean merely remembering user preferences, relabeling a prompt heuristic as learning, rewarding itself for faster but incomplete output, or claiming to train OpenAI models by using their API.

The objective is sustained gains in **verified usefulness and performance** with strong protection against capability loss, privacy regression, overfitting, model drift and unfair benchmark comparisons.

**Constitutional design doctrine:** Vela may become faster without becoming less capable, and more capable without becoming unnecessarily slower. She must also know when **not** to optimize. Preserving extra reasoning, retrieval, critical review, user agency, accessibility, and safety is a valid outcome.

## 2. One learning loop, existing canonical owners

~~~text
Canonical missions + provider/tool receipts + user corrections + native metrics
       |
       v
AEP observes source-backed traces, costs, timing, quality and rework
       |
       v
AI diagnostic role proposes a scoped explanation/hypothesis
       |
       v
AEP defines comparable baselines and controlled experiments
       |
       v
Independent evaluator checks quality, safety, variability and applicability
       |
       +--> REJECT or NEEDS_MORE_EVIDENCE --> preserve negative findings
       |
       v
Versioned policy proposal, owner/authorization gates, canary/shadow
       |
       +--> DRIFT or REGRESSION --> rollback and annotate outcome
       |
       v
Authoritative policy owner promotes a scoped strategy
       |
       +--> AIR applies cognitive choice
       +--> ARIE applies resource scheduling ceilings
       +--> MissionService applies mission execution policy
       |
       v
CIE indexes durable evidence with provenance, scope and correction handling
       |
       v
Future missions consume relevant evidence and current active policy
       |
       v
Fresh real outcomes return to AEP
~~~

There is **no separate autonomous learning database**. AEP owns profiling and experiment source records; ARIE owns actual resource policy and enforcement; AIR/Vela owns cognitive strategy policy within its existing qualified capability runtime; MissionService owns task and execution truth; source owners retain personal records and user corrections; CIE indexes authorized versioned projections. Charter 14 controls data and action permissions.

The Learning Coordinator is a **logical control protocol** and cross-owner workflow, not a new privileged component or unrestricted agent. Its model-based interpretations are hypotheses, not verified discoveries.

## 3. What Vela is allowed to learn

| Domain | Example learned strategy | Owner of effective behavior |
|---|---|---|
| Cognitive routing | For a class of high-ambiguity engineering missions, a stronger initial model may reduce later rework | AIR / qualified model policy |
| Intake and CIE | Source-anchored follow-up retrieval improves grounding on similar cross-project references | CIE evidence strategy, governed by retrieval policy |
| Planning | Parallel research before implementation reduces critical-path time for independent modules | AIR planner + MissionService scheduler |
| Agent allocation | A separate independent reviewer may increase actual correctness for certain work classes | AIR strategy; MissionService actual assignment |
| API operations | Streaming, cache/persistent connection or asynchronous tools help for a qualified compatible task | Provider/capability execution fabric |
| Local resource control | Lower build concurrency under a workload class protects foreground frame-time tails | Performance Governor / ARIE |
| Visual/resource interface | Lower idle rendering cost preserves user experience without impairing necessary interaction | Motion Coordinator + ARIE |
| User preference | User prefers deep verification and explicit coverage for repository edits | Vela preference policy + source-owning user settings/CIE |
| Failure recovery | After a specific provider fault, a verified fallback avoids repeated unknown effects | MissionService and adapter policy |

Not every experience deserves promotion. A temporary outage, an unusually short prompt, a cache-warm run or one unexpectedly fast build does not establish a permanent general rule. Negative results and situations where more reasoning was better are learning evidence too.

**Forbidden shortcuts:** optimize tokens by omitting required context; optimize speed by skipping tests; optimize CPU by silently disabling authorized backend work; optimize task completion by counting unverified model claims; optimize explanations by fabricating model thought traces; optimize privacy by retaining unauthorized user activity. Any of these fails acceptance.

## 4. Evidence ontology and lifecycle

The same record should not silently change from a suggestion to an active rule. Use explicit states:

| State | Meaning | May automatically influence live mission strategy? |
|---|---|---|
| observation | Source-backed execution data; may be incomplete | Only as raw qualified evidence |
| hypothesis | Interpreted candidate correlation or proposed improvement | No |
| experiment_planned | Experimental protocol locked against baseline | No |
| experiment_running | Controlled comparisons under way | No |
| validated_finding | Independent review found sufficient support for a stated scope | May inform proposal, not automatically grant policy |
| policy_proposed | Versioned candidate policy and proposed rollout | No |
| approved_policy | Authorized and effective only within named scope | Yes, within safety constraints |
| superseded | Newer approved policy replaced it | No |
| rejected | Hypothesis or candidate did not meet requirements | No; retrieve as caution |
| rolled_back | Previously effective version revoked after regression or user choice | No; retain evidence and prevent auto-reactivation |
| invalidated | Source/permission/measurement provenance no longer valid | No |

A historical record may coexist with supersession, rejection or invalidation metadata; treat lifecycle as versioned events rather than destructive overwrites. The effective policy index and provenance should always reconcile.

## 5. Proposed source-linked record contracts

The following are **conceptual typed contracts**. Exact schemas/migrations and provider-specific fields must be implemented and verified by source owners. Model-generated fields are never authenticated IDs, authorizations or metrics.

~~~ts
type ExperienceObservationV1 = {
  schema_version: "aerynth.experience.observation@1";
  observation_id: string;
  mission_id: string; task_id: string; attempt_id: string;
  event_ref_ids: string[]; profiler_trace_ref: string | null;
  resource_snapshot_refs: string[];
  provider_capability_version: string | null;
  strategy_version: string | null;
  task_family: string;
  outcome_status: "verified" | "partial" | "failed" | "unknown";
  quality_evidence_refs: string[];
  user_feedback_refs: string[];
  scope_ref: string; observed_at: string;
};

type StrategyHypothesisV1 = {
  schema_version: "aerynth.experience.hypothesis@1";
  hypothesis_id: string;
  proposed_by: "model" | "user" | "experiment" | "engineer";
  target_owner: "air" | "arie" | "mission" | "cie";
  problem_and_proposed_change: string;
  supporting_observation_refs: string[];
  counterexample_refs: string[];
  applicability: {
    task_families: string[];
    environments: string[];
    resource_conditions: string[];
    provider_capability_requirements: string[];
  };
  risks: string[];
  confidence_note: string;
  status: "hypothesis" | "rejected" | "experiment_planned";
};

type ExperimentRecordV1 = {
  schema_version: "aerynth.experience.experiment@1";
  experiment_id: string; hypothesis_id: string;
  baseline_policy_ref: string; candidate_policy_ref: string;
  cohort_definition: string; exclusion_criteria: string[];
  fixture_refs: string[]; preregistered_metrics: string[];
  quality_guardrails: string[]; privacy_guardrails: string[];
  methodology: "paired" | "randomized" | "shadow" | "canary" | "holdout";
  execution_trace_refs: string[];
  evaluator_evidence_refs: string[];
  confounder_notes: string[];
  status: "planned" | "running" | "evaluated" | "invalid";
};

type AdaptivePolicyRevisionV1 = {
  schema_version: "aerynth.experience.policy@1";
  policy_id: string; revision: number;
  owner: "air" | "arie" | "mission" | "cie";
  experiment_ref: string; validated_finding_ref: string;
  applicability_selector: string;
  effective_constraints: string[];
  authorization_ref: string | null;
  rollout: "shadow" | "canary" | "active" | "disabled";
  effective_from: string | null; expires_at: string | null;
  rollback_to_revision: number | null;
};
~~~

Every record includes actual source provenance, retention/classification and original authority as metadata. A real implementation requires explicit schema bounds, closed-object decoding, stable primary keys, transaction semantics, redaction and migratable event versions. The model may draft a hypothesis but cannot alter evaluator results, fabricate receipts, set the effective policy epoch, or promote its own recommendation.

### 5.1 Provenance and epistemic labels

Separate:
- **Observed:** direct source-owner receipts and device/provider counters with collection scope.
- **Derived:** reproducible calculations from observed inputs, with exact method/version.
- **Estimated:** approximate token/cost/power/speed with known uncertainties.
- **User-reported:** explicit feedback, not automatically objective performance.
- **Model-inferred:** interpretation, potential cause or proposed change, not proof of causation.
- **Unknown:** missing evidence, unsupported sensors, unreconciled tool effects.

A learned record must preserve that classification. AEP normalizes metrics; CIE cannot improve the evidence category by rephrasing it.

## 6. Detection and AI diagnosis

The profiler should detect candidate opportunities from repeated real traces: critical-path stalls, missing context, high retry rates, excess coordination, redundant reads, worker contention, poor model/tool compatibility, expensive verification rework, or significant differences by workload class.

An eligible diagnostic model receives privacy-approved summaries with anonymized or source-ref-driven evidence: distributional timing, task complexity classes, measured outcomes, failure labels, hardware conditions, relevant model capability versions, and recorded user corrections.

The model may propose:
1. plausible causes, with alternative explanations;
2. affected task cohorts and exclusion criteria;
3. a bounded optimization hypothesis;
4. required quality and privacy safeguards;
5. an actual experiment and expected tradeoffs;
6. conditions under which the proposed change must **not** apply.

It must not be asked to self-certify a speed gain from an attractive chart. Root-cause hypotheses are hypotheses until supported by controlled evidence.

### 6.1 Trigger policy

Use meaningful new evidence and scheduled/thresholded reviews, not an AI call for every telemetry sample. Deterministic AEP continuously aggregates cheap measurements, while model-based investigation triggers on sufficient sample volume, unexpected regression, explicit user request or validated opportunity. Uninteresting or low-evidence patterns are allowed to remain unoptimized.

## 7. Experimental design and quality-adjusted evaluation

### 7.1 Define the objective correctly

The optimization objective is constrained multi-dimensional improvement, not one weighted score that can conceal a critical failure.

First, **hard gates** must pass: requested outcome completeness, authorization/privacy, source-grounding, required review, actual artifact validity, user control, accessibility and correctness. A candidate failing a hard gate cannot be promoted regardless of speed or cost.

Then optimize eligible dimensions:
- latency to first useful verified output and final verified mission result;
- p50/p95/p99 completion and rework, including failed runs;
- actual critical-path time, queue/wait/active spans and agent overlap;
- model/tool spend where reliably attributable; capped estimates otherwise;
- system CPU/GPU/memory/disk impact, UI/foreground responsiveness;
- human interruption, approval friction and longer-run reliability;
- context coverage, factual grounding, output quality and verified acceptance.

**Do not average privacy failure away with speed improvement.** A model reporting confidence is not a quality metric. Fewer calls is not inherently better, and a slower high-quality strategy may be optimal.

### 7.2 Comparative fairness

Evaluation protocol should preregister:
1. task family, difficulty, representative unseen cases and expected outputs;
2. baseline and candidate version (models, prompt/schema, tools, permissions, agent count);
3. environment, provider tier/rate limit, system load, cache warmth, hardware and source revisions;
4. primary outcome, critical quality gates, measurement methods and sample sufficiency;
5. known confounders, allowed variance, abort conditions and rollback triggers;
6. independent evaluators and human review where subjective/artistic quality matters.

Use paired/repeated trials or justified randomized cohorts where feasible. Account for changed toolchain, model availability, resource contention, caching and the fact that improved input context may independently explain a speed gain. Do not present unadjusted correlation as causation.

### 7.3 Holdouts and longitudinal robustness

Keep held-out tasks and future workloads isolated from tuning decisions; do not iteratively rewrite test-specific rules to improve one benchmark. Revalidate after task distribution, hardware, provider models, data policy or user preferences change. Prefer a modest robust gain over a dramatic one-off result.

For a claimed 20% latency reduction, disclose sample count, intervals, confidence/noise, cohort, quality pass rate, baseline and confounders. If only a limited estimate is available, label it honestly. Do not extrapolate benchmarks to all users or machines.

## 8. Promotion and rollback state machine

~~~text
observations -> hypothesis -> planned experiment -> running
       -> evaluated
           -> REJECTED / INCONCLUSIVE / VALIDATED_FINDING
VALIDATED_FINDING -> POLICY_PROPOSED -> SHADOW
       -> authorization + compatibility + guardrails
       -> CANARY -> ACTIVE
           -> monitor quality/resource drift
           -> SUPERSEDED / ROLLED_BACK / EXPIRED
~~~

The policy owner, not AEP's model, commits activation:
- **AIR strategy:** validated cognitive routing/model-choice rule under qualified capabilities.
- **ARIE resource strategy:** validated budgets and hysteresis within existing Performance Governor limits.
- **Mission strategy:** validated agent allocation, execution grouping or verification order under MissionService.
- **CIE strategy:** permitted retrieval selection/compaction behavior, never source authority or consent.

Promotion is a compare-and-swap against the current policy revision, permission epoch and capability version. Shadow tests must not affect live effects. Canary size and stop thresholds are explicit. Immediate disable and rollback to last qualified version must be supported, including after restart.

A failed learned strategy remains searchable as a counterexample and cannot silently reactivate because it is old, was once successful or resurfaced in a model's suggestion.

### 8.1 Non-optimization is a first-class outcome

AEP may conclude:
- additional reasoning reduces failures enough to justify its cost;
- a code review or source expansion should never be skipped for this risk class;
- concurrency is harmful because resources conflict;
- a human approval step is essential;
- a certain benchmark lacks sufficient quality coverage;
- task variation makes an optimization too fragile to promote.

Store these **preservation decisions** with evidence and explicit applicability. There is no mandate to turn every observation into a speedup.

## 9. CIE retrieval and applicability

The unified memory runtime indexes source-owned learning evidence, not separate free-floating "learned truths." Retrieval for a future task should return:
- currently effective policy ID and owner, version and authorization scope;
- relevant verified experiments and negative counterexamples;
- task/environment applicability, hardware/topology and provider capability constraints;
- evidence freshness, source revisions, sample sufficiency and confidence limitations;
- user preference overrides, correction/deletion state and pending revalidation.

The recipient AIR/ARIE/MissionService validates current active policy and matches live context before use. **CIE's relevance score does not activate a rule.** A strategy for one device, project or model must not silently become universal.

Source deletions, memory opt-outs, permission revocation, invalidated evaluation or changed hardware/tool capability must propagate to context and effective applicability. Retain only authorized minimal audit metadata where retention policy permits.

Provider-side conversation history is not Aerynth canonical experiential memory. A model switch must not erase policy and source lineage or misrepresent an inference as actual past observation.

## 10. Continuous user-directed adaptation

User correction is often more valuable than automatic optimization. Explicit instructions about communication depth, preferred verification, control surfaces, and when to refrain from optimization outrank inferred habits.

When Vela notices a recurring preference, she may propose a transparent preference update with supporting examples, confidence limitations and editable scope. Do not quietly convert a guess into a global preference or a reason to skip work. A request to stop monitoring/learning must be honored across the relevant owners and any dependent projections.

Vela should explain what it learned using real records. Example structure:

> Observation: A particular task cohort experienced repeated review-related rework.
> Hypothesis: An early independent review may reduce total completion time.
> Experiment: Matched tasks, fixed quality criteria, measured resource conditions.
> Finding: [result and uncertainty].
> Decision: [not adopted / pending / canary / effective / rolled back], with authority and date.

A generic confident claim "I improved myself" with no referenced outcome or policy change is unacceptable.

## 11. Adaptive Intelligence Workspace integration

AEP's workspace is a spatial projection over true source-owned records, with six coordinated views from Charter 10:
- Decision Observatory (model/tool/agent choices and evidence).
- Execution Profiler (timelines, critical path, cost, verification and retries).
- Resource Intelligence (ARIE pressure, budgets, leases and reasons).
- Learning Observatory (observations, hypotheses, promoted/rejected strategies).
- Experiment Laboratory (baselines, cohorts, controls, quality/cost/latency comparisons).
- Adaptation Timeline (version history, rollbacks, replay and measured impact).

Selecting any point shows actual linked mission/task/attempt, evidence class, experiment or policy revision, applicability, uncertainty, privacy scope and action control. User controls must call the authoritative owner and show verified state after the action, not merely toggle a local widget.

Provide useful low-motion, offline and accessible views. Render synthetic demonstrations as labeled fixtures, not live Vela cognition. Never expose private chain-of-thought or sensitive personal traces. This document specifies source contracts for that workspace; detailed cinematic interaction design belongs to its own design document and Charters 02, 03, 09 and 10.

## 12. Failure modes and safeguards

| Failure / threat | Defense |
|---|---|
| Faster model omits context or testing | Mandatory quality gate rejects candidate despite lower latency |
| AI self-scoring or metric gaming | Independent source-backed evaluation and objective checks |
| Tiny or nonrepresentative sample | Mark inconclusive and request more evidence |
| Hardware or provider model changes | Applicability version gate and revalidation |
| Cache and concurrency confound measurement | Record conditions, paired cohorts, adjusted/qualified conclusion |
| Foreground gaming signal unavailable | Conservative ARIE defaults, no fabricated measurements |
| Sensitive telemetry or source leak | Consent, local aggregation, minimal provider disclosure, scoped retention |
| Lost source/correction/permission | Invalidate derived projections, policy applicability and cached evaluations |
| Rejected policy reappears as a suggestion | Counterexample and rollback ledger block unreviewed reactivation |
| Policy race or app restart | Versioned compare-and-swap, durable event/owner replay, no duplicate effects |
| Slow AEP instrumentation | Bounded sampling, throttling, asynchronous aggregation, measured overhead |
| Optimization changes task privilege | Reject, because learned policy never expands authorization |
| Optimizer tries to optimize itself recursively | Bounded change scope, evaluation separation, protected baselines and human rollback |

Privacy applies to both source events and derived features. An anonymized feature vector can still disclose behavioral patterns; provider disclosure is an independent permission decision.

## 13. Acceptance protocol

The following scenarios extend Charters 08, 10, 13 and 15. Use real source-backed runs and repeatable synthetic negatives; clearly separate fixture acceptance from native, integrated acceptance.

| ID | Scenario | Evidence required |
|---|---|---|
| LEARN-01 | Observe parallel mission and infer critical-path inefficiency | Reconstructible spans, correct correlation and no double-counted overlaps |
| LEARN-02 | Model proposes optimization and counterexample | Linked observations, scoped hypothesis, no policy activation |
| LEARN-03 | Fair paired/held-out comparison | Declared baseline, sample, environment, quality and latency distributions |
| LEARN-04 | Faster candidate omits necessary semantic step | Promotion blocked; negative result persisted |
| LEARN-05 | Beneficial strategy promoted by authorized owner | Revisioned canary/active policy, reason, user visibility and effective behavioral change |
| LEARN-06 | New project or hardware outside applicability | Strategy not applied; original policy/quality preserved |
| LEARN-07 | Later regression | Drift detected, rollback executed, future routing no longer selects bad policy |
| LEARN-08 | User corrects personal preference | Source-linked update; explicit preference wins over inferred habit |
| LEARN-09 | User deletes source or revokes monitoring | CIE/AEP projections invalidated as appropriate; no further unauthorized collection |
| LEARN-10 | Restart and provider switch | Original evidence, policy lineage and mission state preserved |
| LEARN-11 | AEP workspace displays discovery and rollback | Visual/source reconciliation with real canonical records |
| LEARN-12 | Non-optimization decision | Vela preserves extra review/reasoning because quality data justifies it |
| LEARN-13 | Missing cost usage or telemetry | Estimates/unknowns correctly qualified; no false precision |
| LEARN-14 | Simulated attack on policy promotion | Injected model output cannot override review, permission or version controls |

Required reporting: verified task success and completeness, user acceptance where appropriate, privacy failures (zero), critical-source recall where relevant, p50/p95 first useful/final completion, retry count, artifact validity, API cost, local CPU/GPU interference, policy churn, confidence limitations and longitudinal results.

Experiment results must not be accepted solely because AEP's own model says they succeeded. An independent reviewer or authoritative test oracle determines acceptance within its domain.

## 14. Delivery sequence and vertical slices

1. **LEARN-P0:** Inventory current source owners, AEP trace types and policy stores; agree common evidence IDs and data-classification rules; preserve Program A boundary.
2. **LEARN-P1:** Implement sourced observation and quality outcomes with trace reconstruction, missingness and deletion handling; benchmark profiler overhead.
3. **LEARN-P2:** Add model-assisted hypothesis generation in shadow mode and a typed experiment registration/evaluation pipeline.
4. **LEARN-P3:** Implement scoped, versioned policy proposals, independent quality gates, owner-controlled promotion, effective policy readback, rollback and revalidation.
5. **LEARN-P4:** Connect CIE experiential retrieval to AIR and ARIE with live applicability checks; test actual future-mission behavioral difference.
6. **LEARN-P5:** Render genuine learning, decisions and experiments in the Adaptive Intelligence Workspace; integrate accessible controls and source-driven replay.
7. **LEARN-P6:** Run longitudinal holdouts, provider/hardware drift, consent, resource and regression tests; preserve and publish failures with honest status.

A requirement is not completed by introducing a schema alone. The first convincing end-to-end proof is **one observed performance or quality issue → one model-supported hypothesis → a valid comparison → policy promotion → changed future execution → independently verified improvement → reversible rollback**.

## 15. References and ownership checkpoints

- [ADR-003 AI-Native Fluid Intelligence](../decisions/ADR-003-AI-NATIVE-FLUID-INTELLIGENCE.md)
- [Cognitive Intelligence Runtime](VELA-COGNITIVE-INTELLIGENCE-RUNTIME.md)
- [Adaptive Resource Intelligence](VELA-ADAPTIVE-RESOURCE-INTELLIGENCE.md)
- [Vela Capability Runtime](VELA-CAPABILITY-RUNTIME-AND-EXECUTION-FABRIC.md)
- [Unified Memory Runtime](VELA-UNIFIED-MEMORY-AND-CONTEXT-RUNTIME.md)
- [CIE Semantic Interpretation](../specifications/CIE-SEMANTIC-INTERPRETATION-AND-EVIDENCE-RETRIEVAL.md)
- [Charter 05: Agents and Tasks](../../governance/05-AGENTS-TASKS-AND-WORKFLOWS.md)
- [Charter 06: Vela](../../governance/06-VELA-INTELLIGENCE-AND-ADAPTATION.md)
- [Charter 08: Context and Memory](../../governance/08-CONTEXT-INTELLIGENCE-AND-MEMORY.md)
- [Charter 09: Observability](../../governance/09-INTELLIGENCE-STREAMS-AND-OBSERVABILITY.md)
- [Charter 10: AEP](../../governance/10-AI-EXECUTION-PROFILER.md)
- [Charter 13: Platform/ARIE](../../governance/13-PLATFORM-PERFORMANCE-AND-DISPLAYS.md)
- [Charter 14: Trust and Privacy](../../governance/14-TRUST-PRIVACY-AND-AUTONOMY.md)
- [Charter 15: Verification](../../governance/15-QUALITY-VERIFICATION-AND-ACCEPTANCE.md)
- [ADR-002: Recovery and Realization](../decisions/ADR-002-ARCHITECTURE-RECOVERY-AND-COHESIVE-RUNTIME.md)

**Status declaration:** This file is an implementation architecture, not a self-optimization release announcement. The underlying controlled experiments, learning policies, current API capabilities and native results must be demonstrated before advertising an adaptive Vela.
