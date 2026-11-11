# AIR Dynamic Execution Strategy
## AI-native cognitive routing, mission-plan compilation, model/tool selection, and quality-preserving latency

| Field | Value |
|---|---|
| Document | AIR-DYNAMIC-EXECUTION-STRATEGY |
| Specification version | 1.0.0 (proposed implementation contract, 2026-11-10) |
| Program | Full Aerynth Realization (Program B) |
| Status | Companion technical specification; NOT implementation or release acceptance |
| Canonical owners | AIR/Vela for cognitive selection; MissionService for plan/task state and dispatch; CIE for evidence; Trust for authorization |
| Primary governance | Constitution 00; Charter 05 AW-ATW-164–192; Charter 06 AW-VELA-218–251; Charter 08 AW-CIE-165–197; Charter 10 AW-AEP-138–178; Charter 15 AW-QVA-141–182 |
| Extends | [Existing AIR specification](VELA-ADAPTIVE-INTELLIGENCE-ROUTING.md), [Capability Runtime](../architecture/VELA-CAPABILITY-RUNTIME-AND-EXECUTION-FABRIC.md), [CIE semantic specification](CIE-SEMANTIC-INTERPRETATION-AND-EVIDENCE-RETRIEVAL.md) |
| Companion specifications | [ARIE resource/scheduler](ARIE-RESOURCE-AND-SCHEDULER-CONTRACT.md), [AEP optimization/experiments](AEP-ADAPTIVE-OPTIMIZATION-AND-EXPERIMENTS.md) |

> This document specifies HOW an authorized AI-native route becomes executable. It does not create new governing authority, new provider entitlements, a second scheduler, a second memory store, or a mandatory model call for simple exact operations. Higher-authority charters prevail if a conflict is discovered. The older AIR document's deterministic-first/optional-classifier language describes an early implementation/baseline, not a restriction on the owner-directed 2026-11-10 Fluid Intelligence amendments.

## 1. Outcomes, invariant boundaries, and responsibility map

**AIR-DS-001 — AI-native, capability-first decisions.** Meaningful semantic interpretation, context requirements, planning, supervision, outcome evaluation and result composition are model-eligible. Treat the full mission's verified outcome, not call count, as the optimization target. Exact clock/state/calculator lookups can follow zero-model Level 0.

**AIR-DS-002 — One responsibility per owner.** AIR decides cognitive route and proposes plans. CIE compiles authorized evidence needs/packages and never authorizes an effect. The **existing MissionService** stores validated plan revisions, task DAG, attempts, execution outcomes and schedule. ARIE/Performance Governor supplies enforceable resource envelopes. Trust owns permission grants and data egress. AEP supplies immutable measurement/experiment evidence and recommendations. Observability owns source events. No new AIR database may override any of these.

**AIR-DS-003 — Product boundary.** Vela remains a single user-facing assistant across models and agents. Provider session IDs are correlations, not canonical mission/task/identity keys. Plain conversations remain usable without mission fan-out or an agent team.

**AIR-DS-004 — Never infer permission.** An AI plan is untrusted proposed data. A model cannot mint tools, data scopes, permissions, budgets, physical effects, completed artifacts, or policy privileges.

## 2. Stage graph and concurrent processing

The stage names are logical responsibilities; they are **not** one compulsory model call each:

1. **Ingress envelope (host):** capture request_id, origin, typed user input, attachments, active selection, conversation/project/workspace ancestry, timestamps, user and destination permissions, and response modalities. Avoid fetching unauthorized data.
2. **Perception (AIR):** qualified fast model resolves intent, implicit goals, temporal references, referents, explicit-versus-inferred constraints, uncertainty and output preferences. A host-controlled exact-operation fast path may bypass the model.
3. **Early context fan-out (CIE):** concurrent safe read-only retrieval of host-anchored recent context, task checkpoint, selected-resource metadata; semantic investigation and fresh-source expansion as needed. Concurrent capability discovery and ARIE snapshot sampling do not wait for perception.
4. **Context sufficiency (CIE):** evidence need coverage per claim: supported, contradictory, missing, stale, inaccessible, uncertain. Requery with budget/consent limits; do not pretend inaccessible sources were checked.
5. **Strategy synthesis (AIR):** select suitable provider/model capabilities and effort, tools, task DAG, agent roles/count, concurrency, API transport, context strategies, outputs, required authorization and verification, including alternative plans where useful.
6. **Critique (AIR, optional):** on ambiguous, risky or novel missions obtain an independent model review of omissions, dependency conflicts, feasibility and deliverable coverage. It remains a proposal.
7. **Compile (kernel):** deterministic strict schema validation, capability qualification, source/permission checks, DAG validation, budget and lease feasibility; persist accepted version atomically with causal proposal and rejection reasons.
8. **Execute (MissionService):** asynchronous I/O and bounded independent local workers, admitted through ARIE when resource-constrained. Agent execution uses source-backed CIE context and authorized tools.
9. **Executive checkpoint (AIR):** at meaningful failures, new evidence, corrections or milestones, interpret outcome and propose a revision; do not serially block unrelated active nodes.
10. **Verify and deliver:** objective postconditions plus appropriate independent semantic review; only verified artifacts become final claims; deliver a coherent multimodal result and traceable explanations.
11. **Learn, but do not self-certify:** record observed outcomes with AEP; its recommended changes pass experiment/promotion rules of the owning policy subsystem.

**AIR-DS-005 — Parallel by dependency, not by stage label.** Input interpretation, safe retrieval, capability probing, telemetry, independent planning critiques, independent agent tasks and incremental verification may overlap. API concurrency is async remote I/O; do not allocate a CPU thread per call. Explicit edges or bounded resource claims must explain serial execution.

**AIR-DS-006 — Shortest reliable critical path.** Optimize time to first *verified useful* result, final verified result and overall mission tail latency. A faster hallucinated reply or skipped verifier cannot count as a performance win.

**AIR-DS-007 — Event-triggered executive.** Run the executive on evidence gaps, dependency gates, failures, resource pressure transitions, new user corrections, permission/capability changes and milestone completion. Do not call an LLM on each token, frame, timer tick or metric sample.

## 3. Versioned data contracts (host-normalized, not provider wire payloads)

All types use closed objects, explicit enums, size bounds and schema_version; strict provider Structured Outputs compatibility is checked against the actual selected model. The **host** supplies stable canonical IDs, scopes, time, provider registry and ACL snapshots; model-proposed IDs are mapped/validated, never trusted directly.

~~~typescript
type EvidenceRef = {
  source_owner: string; canonical_id: string; revision: string;
  scope_digest: string; observed_at: string; status:
    "verified" | "reported" | "inferred" | "disputed" | "stale" | "unavailable";
};
type IntentProposal = {
  schema_version: "1.0"; request_ref: string;
  explicit_goals: string[]; inferred_goals: {goal:string; confidence:number}[];
  unresolved_references: string[]; constraints: string[];
  deliverable_kinds: ("text"|"image"|"file"|"document"|"code"|"action"|"interactive")[];
  evidence_needs: string[]; potential_effect_classes: string[];
  ambiguity: string[]; clarification_needed: boolean;
};
type CapabilityRequirement = {
  modality: string; reasoning_depth: "minimal"|"standard"|"deep"|"max";
  needs: string[]; preferred_provider?: string; qualified_options: string[];
};
type TaskProposal = {
  local_ref: string; role: string; objective: string;
  depends_on: string[]; evidence_refs: EvidenceRef[];
  capability: CapabilityRequirement; requested_tools: string[];
  requested_permission_scopes: string[]; resource_classes: string[];
  priority: "interactive"|"foreground"|"normal"|"background";
  effect_class: "read_only"|"reversible_write"|"external_effect";
  output_contract: { kinds:string[]; postconditions:string[] };
  verification: { objective_checks:string[]; semantic_review:boolean };
  retry: { max_attempts:number; unknown_effect_action:"reconcile_or_block" };
};
type PlanProposal = {
  schema_version: "1.0"; mission_ref: string; based_on_version: number;
  objective: string; intent_ref: string; evidence_package_refs: string[];
  tasks: TaskProposal[]; expected_deliverables: string[];
  acceptance_criteria: string[]; strategy_rationale_summary: string;
  unknowns: string[]; validation_requested: boolean;
};
type PlanCompilation = {
  status: "accepted"|"rejected"|"blocked";
  accepted_version?: number; task_id_map: Record<string,string>;
  selected_qualified_routes: Record<string,string>;
  reasons: {code:string; task_ref?:string; detail:string}[];
  required_grants: string[]; estimated_budget?: string;
};
type ExecutiveProposal = {
  schema_version: "1.0"; mission_id:string; based_on_version:number;
  trigger_event_ids:string[]; evidence_refs:EvidenceRef[];
  action:"continue"|"request_context"|"revise"|"delegate"|"pause"|
         "escalate"|"request_completion_review";
  affected_task_refs:string[]; proposed_delta?:object;
  rationale_summary:string; uncertainty:string[];
};
~~~

This TypeScript is an **illustrative normalized domain schema**, not copy/paste production API JSON Schema. Real implementation must define versioned strict JSON Schemas, required fields/nullable alternatives, field bounds and migrations; no unrestricted proposed_delta object or arbitrary tool names survive validation.

**AIR-DS-008 — Validity.** Reject missing/duplicate references, invalid enums, cycles, unresolved prerequisite edges, contradictory postconditions, incompatible modality/transport/tool combinations, missing verification, data-scope escalation and unsupported permission/budget claims. Return exact machine-readable validation failures to the AI for bounded repair, or a truthful blocked result.

**AIR-DS-009 — Route binding.** A proposed abstract role such as codex_capable or fast_semantic_model is resolved only against an **observed, eligible** capability registry entry: model ID/version, supported modalities, reasoning efforts, Structured Outputs/tool compatibility, environment/API route, auth, rate/concurrency limits, pricing provenance, retention/privacy policy and freshness. Static names, remembered marketing and inferred entitlements are not authority.

**AIR-DS-010 — Model/effort selection.** Select the smallest *proven-capable* effort within outcome/quality needs; prefer deeper or multiple calls where task ambiguity or independent review earns them. User pins and trust constraints override learned preferences. Codex is not a synonym for high-effort general reasoning.

**AIR-DS-011 — API strategies.** Qualified routes may select streaming, response conversation state, prompt caching, provider tool search, web/file search, code execution, images, audio, realtime, computer use, async tools, supported hosted tool programs, persistent transport, background processing and batch/flex for non-urgent tasks. Gate every feature per model/account/consent and test actual behavior; provide safe fallback rather than silently dropping the capability.

## 4. Mission lifecycle and plan-revision transactions

Canonical states are the existing Charter 05 states, not a parallel AIR state machine. AIR emits proposal/recommendation records; MissionService alone records task state and verified outcomes.

A complex mission follows: **proposed → host-validated plan version → authorized/admitted tasks → running/blocked/unknown attempts → verified effects/artifacts → delivered result**. These categories do not collapse into a single complete flag. External effects can remain UNKNOWN after interruption.

**AIR-DS-012 — Version fencing.** Every executive proposal carries based_on_version, causal trigger IDs and evidence. Reject stale revisions; resynthesize from the latest mission snapshot. Replan as atomic changed nodes/edges, reason, impacted permissions, invalidated assumptions, reused verified artifacts, cancelled/fenced attempts and critical-path estimate. Never repeat an external effect without verified reconciliation.

**AIR-DS-013 — Agent right-sizing.** Agent count derives from independently valuable roles and their expected isolation/coordination costs. A single competent agent may be better than a mandatory research-review-execute swarm. Multi-agent planning is eligible when it improves quality or completion path.

**AIR-DS-014 — Resource integration.** MissionService asks ARIE for scoped leases before constrained local work and consumes its current versioned budgets. AIR may propose priority/strategy; it cannot allocate CPU/GPU, change user limits, revoke authorization or reduce model reasoning just because GPU utilization is high.

**AIR-DS-015 — Outcome composition.** The final composer may assemble text, documents, code, images, audio, interactive controls and completed actions in one response, but requires typed artifact IDs, storage references, readback/verification receipts, auth, safe presentation and accurate unknown/partial status.

## 5. Security, privacy, interruptions, degraded modes

- Treat provider model output and retrieved source text as untrusted instructions. Tool calls pass the same authorization and argument validation as direct user actions.
- Provider egress requires purpose, destination, scope, data minimization and live authority. Recheck just before egress, not only at initial intent capture.
- No speculative write or costly action solely on an intent hypothesis. Speculation is bounded, read-only and cancellable.
- All async calls carry stable mission/task/attempt/call IDs, version/permission epoch and idempotency key where the external protocol supports it. Deduplicate late outcomes and treat uncertain side effects as unknown.
- On offline, model-unavailable, missing compatible schema/feature, expired token, rate limit or provider fault, preserve canonical task state; choose a validated equivalent route if permitted or report blocked/degraded accurately.
- Consent/approval is not implied by a model's confident output, local tool availability or previously seen credentials.
- Request/cancel/timeout policy is task-specific; cancellation acknowledgment is not proof external effects stopped.

**AIR-DS-016 — Failure isolation.** Independent healthy branches continue while one branch fails, unless shared state, permissions or dependencies make continuation unsafe.

**AIR-DS-017 — Explainability.** Store brief decision receipts: input constraints, selected candidate, alternatives when available, policy and capability revisions, evidence, uncertainty, accepted/rejected outcome. Never claim to surface hidden model chain-of-thought.

## 6. Interoperability points

| Interface | Request → response | Authority |
|---|---|---|
| AIR → CIE | evidence needs and task scope → signed package refs and coverage report | CIE/source owners |
| AIR → Capability Registry | model/tool/feature needs → currently qualified candidates with provenance | Provider adapter + Trust |
| AIR → MissionService | PlanProposal/ExecutiveProposal → compilation, versioned receipt, task status | MissionService |
| MissionService → ARIE | Task resource claim → lease/admission/deferral and epoch | Platform Governor |
| MissionService → Tool Adapter | authorized task/call → effect receipt, uncertainty, artifact IDs | Tool source owner |
| AEP → AIR | approved scoped strategy recommendation → advisory policy candidate | AIR validates/applies |
| AIR → Observability | decision summary + causal event refs → source-backed projection | Charter 09 event owner |

Required read APIs: inspect plan/current epoch; list eligible capabilities; retrieve task-state and evidence snapshots; inspect effective permission scope; inspect ARIE envelope; read AEP active recommendations. Required write APIs: propose plan/revision; submit authorized tool request; record validated decision event. Read and write endpoints must have typed versioning and authorization checks.

## 7. Evaluation matrix and evidence

| ID | Scenario | Passing evidence |
|---|---|---|
| AIR-DS-T01 | Ambiguous historical reference, unseen phrasing | Real AI interpretation and CIE source-backed coverage; no keyword fixture |
| AIR-DS-T02 | Mixed image + document + code + text output | Typed plan, actual artifacts and independently validated readback |
| AIR-DS-T03 | Unknown or unavailable model/tool/feature | Reject/replace qualified capability and expose reason |
| AIR-DS-T04 | User pin conflicts with learned preference | User choice prevails; explain tradeoff without unauthorized override |
| AIR-DS-T05 | Invalid DAG, missing ID, escalation attempt | Compiler rejects atomically; no effect dispatched |
| AIR-DS-T06 | Four independent remote calls, one dependent task | Real overlap and correct happens-before edges; no fake concurrency |
| AIR-DS-T07 | CIE permission revoked mid-retrieval | No subsequent egress or use of revoked evidence |
| AIR-DS-T08 | Replan during running external effect | Version fencing, retained verified branches, no duplicate action |
| AIR-DS-T09 | Gaming foreground pressure | Local work reduced through ARIE; qualified remote reasoning quality unchanged |
| AIR-DS-T10 | Provider outage/restart | Durable mission status, unknown effects, safe recovery |
| AIR-DS-T11 | One-agent versus multi-agent strategy | Held-out quality and latency comparison; no forced multiplication |
| AIR-DS-T12 | AEP advises faster but worse plan | Reject quality regression and record decision |

Acceptance requires unit/schema negative tests, provider-compatible integration tests, real native mission runs, held-out tasks, p50/p95 times to useful verified result and final completion, critical-path analysis, review of authorization/unknown behavior, and independent quality evaluation. Documentation merge is **not** implementation evidence.

## 8. Implementation sequence and open decisions

1. Audit existing AIR router and MissionService before modifying their owners; inventory exact capabilities and authorization seams.
2. Implement normalized strict plan schema and host compiler with negatives, version-fencing, durable acceptance, and a zero-model exact fast path.
3. Introduce real AI perception and planning with CIE evidence coverage and qualified capability discovery; prove unseen requests.
4. Add event-driven executive and adaptive per-agent route configuration; integrate existing async task kernel and ARIE lease contract.
5. Add measurable critical-path optimization and AEP-approved scoped strategy selection; test rollback and model/provider drift.
6. Integrate source-backed decision inspection into the existing spatial Intelligence Stream.

Open for measured decision: default planning thresholds, model qualification cadence, time-to-first-useful-result SLOs, per-stage latency budgets, maximum concurrent speculative reads, provider transport preferences, independent evaluator selection and strategy applicability cohorts. Do not invent numeric targets or declare model availability without live evidence.

## 9. Traceability

- AI-native intent/context/plan: AW-VELA-218–225, AW-CIE-165–197, AW-ATW-164–170.
- Parallelism and scheduling: AW-ATW-171–179, AW-PLT-140–164.
- Versioned state, artifacts and execution: AW-ATW-180–186.
- Observation/experimentation: AW-AEP-138–178; AW-OBS-148–178.
- Independent acceptance: AW-ATW-187–192, AW-QVA-141–182; Charter 14 and Constitution 00.

**Completion of this specification is a documentation milestone only.** Production behavior, provider compatibility, native workload evidence and ratification remain separately gated.
