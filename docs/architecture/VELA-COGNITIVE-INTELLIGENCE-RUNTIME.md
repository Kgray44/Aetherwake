# Vela Cognitive Intelligence Runtime

**Architecture:** FI-COG-01 · **Status:** implementation design, not proof of shipped behavior · **Owner-directed target:** 2026-11-10  
**Companion:** [ADR-003 AI-Native Fluid Intelligence](../decisions/ADR-003-AI-NATIVE-FLUID-INTELLIGENCE.md)  
**Authoritative:** Constitution 00; Charters [05](../../governance/05-AGENTS-TASKS-AND-WORKFLOWS.md), [06](../../governance/06-VELA-INTELLIGENCE-AND-ADAPTATION.md), [08](../../governance/08-CONTEXT-INTELLIGENCE-AND-MEMORY.md), [09](../../governance/09-INTELLIGENCE-STREAMS-AND-OBSERVABILITY.md), [10](../../governance/10-AI-EXECUTION-PROFILER.md), [12](../../governance/12-CODEX-EXECUTION-AND-INTEGRATIONS.md), [14](../../governance/14-TRUST-PRIVACY-AND-AUTONOMY.md), [15](../../governance/15-QUALITY-VERIFICATION-AND-ACCEPTANCE.md). In conflict, higher-authority owner charters prevail.

## 1. Purpose and boundaries

Vela must be intelligent at intake, context investigation, planning, mission oversight, specialist work, semantic verification, result composition and controlled adaptation. The objective is **maximal verified outcome quality with the shortest reliable critical path**, not minimum model calls or maximum parallel agents.

This document refines the existing [Vela Capability Runtime and Execution Fabric](VELA-CAPABILITY-RUNTIME-AND-EXECUTION-FABRIC.md) and [CIE semantic interpretation](../specifications/CIE-SEMANTIC-INTERPRETATION-AND-EVIDENCE-RETRIEVAL.md). It does **not** create a new execution gateway, conversation store, source-of-truth planner, permission checker, scheduler or memory owner. Semantic planning and AI Mission Executive are logical roles attached to the canonical MissionService, not independent databases or microservices.

This is a target for **Program B Full Realization** under [ADR-002](../decisions/ADR-002-ARCHITECTURE-RECOVERY-AND-COHESIVE-RUNTIME.md). Program A Recovery may implement contract mapping, instrumentation and controlled shadow evaluation without claiming feature completeness.

### Design invariants

- Vela identity persists across ChatGPT-style reasoning, Codex execution, native operations, multimodal tools and provider changes.
- Cognitive inference is an **untrusted proposal** until validated against source evidence, permissions and qualified capabilities.
- Only the native policy gateway can authorize disclosure or tool effects; only MissionService can commit mission transitions.
- CIE owns authorized evidence assembly and projections of source-owned memory; an AI guess never becomes a source fact.
- A stage may share a model call with another when quality is preserved. Complex work can require multiple iterations. No fixed seven-call pipeline.
- Independent tasks overlap where real backend concurrency and safe isolation exist; never equate async API requests with CPU threads.
- A read-only speculative task is cancellable and scope-bound; consequential effects await validated authorization.
- Unknown external effect status is not failure and not permission to retry.
- A completed model turn is not a verified delivered outcome; final text must not invent artifacts.
- No exposure or reconstruction of private chain-of-thought. Show source-backed rationale and decision receipts only.

## 2. Canonical end-to-end path

~~~text
Human or authorized scheduled input
  -> Trusted Intent Gateway (native IDs, selections, permissions, multimodal refs)
  -> AI Perception (typed goals, evidence needs, uncertainty)
       <-> CIE evidence investigator (iterative, scoped, source-grounded)
       || capability registry + local resource observation + safe read-only prep
  -> AI Strategy/Planning (typed proposal; possible critic or alternate)
  -> Plan compiler (schema, graph, scope, capabilities, budgets, security)
  -> MissionService persisted mission revision + deterministic task DAG
  -> AI Executive (event-driven advice) <-> Mission kernel (state and locks)
  -> Concurrent agent/tool workers <-> incremental independent verification
  -> Artifact & result registry -> Vela output composer -> verified response
  -> AEP and observational evidence -> governed experiential learning
~~~

The arrows represent **causal dependencies**, not a mandatory synchronous waterfall. For example, approved source-anchored retrieval, capability discovery and resource sampling can overlap early semantic understanding. Work waiting on research cannot begin an effectful edit until the research dependency is satisfied.

### 2.1 Responsibility matrix

| Role | Model-assisted decisions | Host-owned truth |
|---|---|---|
| Intent gateway + AI perception | Interpret implicit aims, referents, ambiguity, deliverable requirements, need for clarification | Authenticated principal, explicit user text, actual selection and attachments, time and user authorization |
| CIE investigator | Form evidence questions, judge sufficiency, propose more retrieval | Effective scope, source identity/revision, source retrieval, ACL, freshness, provenance, egress manifest |
| Capability deliberator | Compare qualified models/tools/effort, risk and expected work | Live provider eligibility, tool schema, budget, account scopes and privacy |
| Mission planner | Decide strategy, tasks, output contracts, dependencies, review | Compiled valid plan, ID resolution, permissions, side-effect constraints |
| AI Mission Executive | Interpret meaningful events, propose replan, delegation, pause, escalation or completion review | Mission state transitions, dependencies, resource leases, replay and verification |
| Specialized agents | Research, code, native operations, documents, images, voice, review | Exact effect gateway, artifact store, source-owner readback |
| Result composer | Summarize, select suitable presentation, generate prose and safe block instructions | Verified artifact references, output state, actual provider receipts |

## 3. Model-role strategy

Model assignments are **capability roles**, not permanent provider IDs or cost constants:
- Fast competent inference for short intent analysis, evidence classification and executive checkpoints.
- Deeper reasoning for ambiguous planning, diagnosis, arbitration and substantive semantic verification.
- Codex-capable execution for repository changes and local software engineering when qualified, not a universal deep-reasoning substitute.
- Specialized audio, image, computer-use, search and document tools where eligibility, environment and user data policy allow.
- Native zero-model execution for authoritative exact facts, safe lookup and simple deterministic actions.

The runtime queries a versioned capability registry (see existing capability runtime and provider/tool contracts) for actual eligibility, modality, tool support, reasoning effort, context limits, streaming/async support, transport and current account state. A static model label from a model proposal is a **hint**. Resolve to an effective provider/model ID before dispatch, or produce a typed unsupported/blocked reason. Model choice incorporates task difficulty, outcome quality, p50/p95 completion, verification rework, risk, privacy and user pin; never treat provider API access as a subscription entitlement.

Every cognitive phase should have a traceable role ID and prompt/schema version. The same invocation may satisfy multiple roles, with explicit attribution. Perception and planning must not silently recompute source authority.

## 4. Typed intake and perception

The host first constructs an authorized IntentEnvelope from actual user input, conversation/project/workspace IDs, selections, attachment refs, source ACL and action policy. Only an approved minimal projection is sent externally; any provider disclosure is independently policy-checked.

### 4.1 AI perception result, proposed schema

~~~ts
type PerceptionProposalV1 = {
  schema_version: "aerynth.perception@1";
  intent_summary: string;
  goals: Array<{
    goal_key: string;
    description: string;
    origin: "explicit" | "inferred";
    desired_outputs: string[];
  }>;
  constraints: Array<{ key: string; description: string; origin: "explicit" | "inferred" }>;
  evidence_questions: Array<{ key: string; question: string; required: boolean }>;
  unresolved_references: Array<{ phrase: string; candidates: string[]; explanation: string }>;
  effects_requested: Array<"read" | "write" | "external" | "destructive">;
  ambiguity_notes: string[];
  next_step_hint: "direct" | "investigate" | "plan" | "clarify";
};
~~~

A real strict JSON Schema must use required fields and closed objects where supported, bounded strings/arrays, explicit enums and an implementation-generated schema version. No fields here carry authorization or real resolved source IDs. Model-reported confidence is not independently calibrated certainty.

The intent gateway validates syntax/size, rejects tool invocation embedded as untrusted text and attaches host-resolved scope. Text, voice transcript, selected image/file descriptions, scheduling origin and recent user corrections may enter the same model role if permitted. The system must preserve original modality/source pointers and avoid fabricated visual or audio observations.

### 4.2 Timing and speculative work

As soon as the host knows safe anchors, begin independent, policy-permitted:
- exact active-project/task state retrieval;
- recent conversation ancestry and approved pending work;
- capability registry snapshot refresh (bounded cache TTL);
- resource-budget observation through ARIE;
- optional scope-bounded lexical/semantic candidate search.

Perception and retrieval can proceed concurrently. Do not dispatch effectful tasks, broaden provider disclosure or mutate memory before ambiguity and authorization are resolved. All speculative work must be cancellable, attributable and discardable without corrupting mission state.

## 5. CIE: active evidence investigation, not a competing planner

Use the existing CIE interpreter/authorized ContextRequestEnvelope and SemanticContextRequest proposal. The perception model may supply *evidence questions*; CIE converts them to authorized retrieval plans. Avoid implementing a second retrieval database or AI policy authority.

Loop:
1. Host anchors exact current source IDs and policy.
2. Model proposes evidence needs, query variants and time/authority distinctions.
3. Source adapters perform exact, relationship, FTS and qualified semantic retrieval concurrently when safe.
4. CIE verifies source revision, ACL, relevance, contradictory versions, corrections, freshness and evidence gaps.
5. A bounded AI sufficiency pass identifies missing evidence or proposes further authorized queries. Search effort scales to value, ambiguity and privacy/cost caps.
6. CIE builds a typed inclusion/omission manifest and source-grounded context package with a destination-specific egress digest.
7. Late revocation or source mutation invalidates affected context; no stale citation or revoked data may be reused.

Each required need resolves to **supported, contradicted, missing, stale, inaccessible or uncertain**. Keep those values separate. Context packages record prompt/index model versions, source/revision refs and policy epoch, but not any private provider internal reasoning.

A zero-memory request can intentionally terminate with no retrieved sources; a failed model call falls back to permitted exact retrieval and explicit uncertainty, not broad untethered recollection.

## 6. AI planning and plan compilation

Complex missions receive a versioned **MissionPlanProposal**. Its cognitive planner may use one model, multiple independent specialist suggestions, or a critic depending on task complexity and independent evidence that more deliberation is useful.

### 6.1 Proposed executable plan contract

~~~ts
type MissionPlanProposalV1 = {
  schema_version: "aerynth.mission-plan@1";
  mission_id: string;                 // host-injected; not trusted from model
  based_on_revision: number;
  objective: string;
  assumptions: Array<{ statement: string; evidence_refs: string[]; unresolved: boolean }>;
  deliverables: Array<{ artifact_key: string; kind: string; acceptance: string[] }>;
  nodes: Array<{
    local_key: string;
    objective: string;
    dependency_keys: string[];
    role: string;
    capability_requirements: string[];
    candidate_model_roles: string[];
    tool_categories: string[];
    input_evidence_keys: string[];
    output_artifact_keys: string[];
    risk_class: "read" | "reversible" | "material" | "irreversible";
    resource_hints: string[];
    verification: string[];
  }>;
  strategy_notes: string[];
  unresolved_decisions: string[];
  planned_user_response: string[];
};
~~~

The model is allowed to propose *how many* agents are warranted, but agents are mapped to actual nodes/roles and bounded concurrency, not one permanent process per suggestion. The compiler maps local keys to canonical task IDs, validates dependency DAG, modality/provider/tool compatibility, output type, evidence/authorization, budget and resource claims, and constructs a durable MissionPlan revision under MissionService.

Minimum compiler failure codes: SCHEMA_INVALID, DUPLICATE_KEY, CYCLE, MISSING_DEPENDENCY, UNSUPPORTED_CAPABILITY, UNAUTHORIZED_SCOPE, DISCLOSURE_DENIED, RESOURCE_CONFLICT, LIMIT_EXCEEDED, UNSATISFIABLE_OUTPUT and STALE_BASE_REVISION. A repair proposal may be requested; a hard permission denial is not repairable by model restatement.

Plan validity requires more than syntactic JSON. The compiler must check typed artifacts, isolation/transaction plan and side-effect risks. User constraints and capability state are host-owned authoritative inputs. The planner cannot set its own effective principal, override provider data policy or mark a test as passed.

### 6.2 Planning critic and alternatives

For high-impact or unfamiliar missions, use a separate reviewer or alternative strategy hypothesis when evaluated benefit exceeds coordination cost. The reviewer checks missing requirements, hidden dependencies, inadequate acceptance, unnecessary agents, unsafe speculation and poor quality tradeoffs. Plan selection records a short supported rationale, never private chain-of-thought. A critic is optional for simple work.

## 7. Continuing AI Mission Executive

The AI Mission Executive is a **reasoning role** invoked at meaningful checkpoints: verified evidence arrives, prerequisite completes, goal changes, failure/timeout occurs, provider is unavailable, contradictions emerge, resource pressure changes, or an acceptance decision is needed.

Proposed normalized message:

~~~ts
type ExecutiveProposalV1 = {
  schema_version: "aerynth.executive-proposal@1";
  mission_id: string;
  based_on_revision: number;
  trigger_event_refs: string[];
  action: "continue" | "request_evidence" | "delegate" | "replan" |
          "pause" | "escalate" | "propose_completion";
  explanation_summary: string;
  evidence_refs: string[];
  proposed_delta_ref: string | null;
  uncertainty: string[];
};
~~~

Only the host validates, authorizes and commits a proposed operation. MissionService checks the current revision/permission epoch and rejects stale changes. The scheduler **keeps other safe independent nodes moving** while the executive reasons. A failed executive call does not freeze completed operations or invent successful effects; a bounded retry/fallback path records the degraded state.

Plan changes are immutable deltas with previous/new revision, motivating evidence, new and retired nodes, changed critical path, permission implications and reuse of verified subresults. An unfinished non-idempotent operation cannot be re-dispatched until its result is reconciled. A completed verified node is not replayed merely because another node failed.

## 8. Concurrent specialist execution and result verification

### 8.1 Scheduling

Use one canonical dependency DAG and task/attempt system:
- async concurrent provider requests within account/tool rate budgets;
- bounded local CPU and I/O worker pools, with ARIE resource leases;
- per-resource locks or isolated Git worktrees for conflicting writes;
- incremental verification when input artifacts have been committed;
- event-driven worker lifecycle, retries and cancellation.
- priority and fairness that protect conversational interaction and active voice.

A cache hit, provider warm connection, API model call and local thread are different things and must not be aggregated as identical work. Instrument queue, network, inference, tool, executor and verification intervals independently with critical-path attribution.

### 8.2 Verification

A semantic review can judge requirement fit, coherence, evidence and output completeness. It **cannot** replace objective compile/test/readback/file existence checks, nor can a tool exit code alone prove the intended result. Claims are classified verified, partially verified, uncertain, blocked, failed or not attempted. Explicit verification recipes are part of each node's output contract.

### 8.3 Result and artifact composition

The final user response is assembled from typed, verified or explicitly qualified artifacts. One request can yield text + documents + images + source changes + widgets + external-action receipts. Each reference carries canonical artifact ID, location, producer attempt, verification state, permission class and render adapter. The composer must never invent download links, claim a local action without receipt or confuse a proposed deliverable with an existing file.

Deliver early *useful, supported* partial updates when appropriate; never mark partial artifacts as final. Model-selected UI views are projections of canonical source state, not another state owner.

## 9. Failure, privacy and recovery matrix

| Scenario | Required response |
|---|---|
| Intent model unavailable | Permit exact safe native path, bounded retry/qualified alternative, or truthful limitation |
| CIE finds contradictory or revoked sources | Preserve contradiction/missingness; reauthorize at egress; do not invent resolution |
| Structured plan invalid | Reject with typed error, request repair or report blocked; no effect dispatch |
| Tool capability absent or changed | Re-resolve qualified capability and replan, preserving task identity |
| Model/tool timeout during side effect | Persist unknown; reconcile provider/source receipt before retry |
| Worker crash / application restart | Reload canonical mission revision, checkpoints, permissions and pending effects; do not re-execute verified work |
| User revokes permission | Fence new and queued effects, invalidate affected context, honestly mark in-flight uncertainty |
| Two agents propose conflicting edit | Serialize, isolate, transact or reject; do not race on same canonical file |
| Long-running mission produces partial artifacts | Permit independently verified outputs while marking unfinished work appropriately |
| Prompt injection in retrieved content | Treat as untrusted evidence; cannot rewrite system instructions, tool scopes or authorization |

Public repo fixtures must be synthetic; actual context, model traces, personal data, secrets and device telemetry require approved local storage and retention.

## 10. Performance: quality-adjusted critical path

Measure request-to-feedback, request-to-first-useful-verified-output, request-to-final-verified-result, p50/p95/p99, context search and sufficiency, model time, queue wait, tool latency, first token, token use, cache hits, transfer and validation overhead, agent overlap, extra rework and quality failures.

AEP attributes evidence; ARIE controls resource ceilings; cognitive runtime chooses eligible strategy and may consume promoted experiential policy. Do not declare a speed win by disabling semantic retrieval, decreasing verification, discarding agent work or shifting latency to the UI.

For batch evaluation, compare equivalent mission classes, user approval and data policy, model/provider capability, comparable source context, warm/cold cache, system load and output quality. Optimize the **critical path**, not simply aggregate model duration or call count.

## 11. Native implementation slices and tests

| Slice | Deliverable | Required evidence |
|---|---|---|
| COG-01 | Trusted intake + AI perception shadow adapter | Novel paraphrases, reference grounding, privacy failures, exact fast path |
| COG-02 | CIE evidence-needs and bounded sufficiency loop | Gold-source recall, contradiction, provenance, revocation, missing-evidence test |
| COG-03 | Plan proposal + native compiler | Strict schema, DAG cycle, permission, modality and capability negatives |
| COG-04 | Mission Executive event checkpoint | Replan diff, dependency change, non-duplicate effects, cancellation race |
| COG-05 | Concurrent tasks and ARIE lease integration | Actual overlapping time intervals, write isolation, gaming protection |
| COG-06 | Independent verification + multimodal composer | Real source artifact, verified output, unsupported format and partial status |
| COG-07 | Learning strategy integration | Held-out quality, policy versioning, regression and rollback |

### Mandatory test corpus

1. "Fix that UI bug from yesterday" across two similarly named projects, one inaccessible; no broad-context leak.
2. Request for a document and image and verified source edit; all three typed deliverables and response must exist.
3. Request with no relevant memory; avoid invented recall and unnecessary CIE expansion.
4. Failed build requiring replan while independent research continues; preserve already verified work.
5. Agent creates a forbidden descendant tool request; gateway denies even if JSON validates.
6. Two independent read agents overlap; two same-file writers never race; measured overlap shown.
7. Cancellation after non-idempotent external dispatch; show unknown until source reconciliation.
8. Start under foreground gaming contention, then become idle; local worker budgets adapt while remote reasoning remains eligible.
9. Invalid model/tool combination is rejected and a qualified fallback is offered.
10. Same mission interrupted by app restart and provider switch; same canonical identity and verified artifacts survive.

Baseline outcomes must be independently evaluated on unseen tasks. Test fixtures alone do not prove a live native feature. Record real OS/build, provider/model compatibility, source revision, tool receipts and metrics. This design's existence does not imply implementation acceptance.

## 12. Related designs

- [ADR-003](../decisions/ADR-003-AI-NATIVE-FLUID-INTELLIGENCE.md)
- [ARIE resource intelligence](VELA-ADAPTIVE-RESOURCE-INTELLIGENCE.md)
- [Experiential learning loop](VELA-EXPERIENTIAL-LEARNING-LOOP.md)
- [Vela capability runtime](VELA-CAPABILITY-RUNTIME-AND-EXECUTION-FABRIC.md)
- [Unified memory runtime](VELA-UNIFIED-MEMORY-AND-CONTEXT-RUNTIME.md)
- [CIE-SER-01](../specifications/CIE-SEMANTIC-INTERPRETATION-AND-EVIDENCE-RETRIEVAL.md)
- [Governance registry](../../governance/README.md)

**Engineering status:** Architecture authored; model qualification, actual adapters, native integration, held-out evaluation and end-to-end acceptance remain separate deliverables.
