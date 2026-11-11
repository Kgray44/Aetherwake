# ADR-003: AI-Native Fluid Intelligence with One Cohesive, Adaptive Runtime

**Status:** Accepted implementation direction, owner-directed 2026-11-10; engineering verification pending  
**Decision scope:** Vela cognition, AIR, mission orchestration, CIE, AEP, ARIE and adaptive learning  
**Authority:** Implementation ADR subordinate to the [Aetherwake Constitution](../../governance/00-AETHERWAKE-CONSTITUTION.md) and ratified specialist charters; this file does not amend governance or claim a shipped feature  
**Program boundary:** [ADR-002](ADR-002-ARCHITECTURE-RECOVERY-AND-COHESIVE-RUNTIME.md) separates Program A (Architecture Recovery) from Program B (Full Aerynth Realization)

## 1. Context

The owner has clarified that Vela is not traditional application logic with a single AI planner inserted in the middle. Vela must use qualified model intelligence wherever semantic understanding or adaptive judgment materially improves outcomes: at input interpretation, context investigation, planning, mission supervision, specialist execution, evaluation, learning and result composition. Static keyword picking, a single ceremonial model call, and a fixed agent count do not satisfy Fluid Intelligence.

Simultaneously, latency must be engineered from the outset. Multiple relevant model calls do not automatically constitute intelligence, and minimizing calls does not automatically constitute efficiency. The optimization objective is **the best authorized, verified task outcome along the shortest reliable critical path**, under user experience and resource-protection constraints.

The existing repository already owns canonical project and mission state, authorization, event evidence, context projections, model/provider integration, execution profiling, and platform performance governance. This decision integrates and extends those owners. It expressly does not create a second mission database, memory system, routing authority, telemetry ledger, rendering application, or performance governor.

## 2. Decision

Adopt an **AI-native, capability-first, continuously adaptive Vela execution architecture** implemented as one cohesive local-first runtime with well-bounded cognitive, mission, resource and learning responsibilities.

The runtime is a hybrid:
1. **Models propose and evaluate semantic decisions.** A qualified model may interpret an ambiguous input, derive evidence needs, choose strategy, allocate specialist work, interpret outcomes, request more evidence, critique quality, or propose an optimization.
2. **Canonical code controls effects and truth.** Host systems resolve real resource identities, verify provider/model/tool availability, enforce permission and data-elevation boundaries, validate schemas, own locks and concurrency, dispatch effects, persist task state, capture evidence and guard against duplicate side effects.
3. **Scheduling is concurrent by default where dependencies allow.** Async remote API calls are not equivalent to local CPU threads. A task DAG is executed under provider quotas, native resource policy and conflict/isolation constraints, rather than by sequentially awaiting independent work.
4. **Adaptive optimization is evidence-led.** AEP observes and evaluates quality-adjusted execution performance; ARIE governs local resource policy; AIR applies qualified cognitive strategies; CIE retrieves applicable experiential knowledge. Learned changes are versioned, scoped, tested, inspectable and reversible.
5. **Visibility is factual.** Intelligence Streams, the future Adaptive Intelligence Workspace and result composition project canonical decisions, observed events, actual tool effects and qualified analysis. They must not portray invented hidden thoughts or pretend simulated progress is live.

The architecture is expressed in three companion design documents:
- [Vela Cognitive Intelligence Runtime](../architecture/VELA-COGNITIVE-INTELLIGENCE-RUNTIME.md): semantic intake, AI-assisted CIE, mission planning/executive, runtime contracts and response composition.
- [Vela Adaptive Resource Intelligence](../architecture/VELA-ADAPTIVE-RESOURCE-INTELLIGENCE.md): the Charter 13 Performance Governor expanded as ARIE, with resource-aware scheduling, foreground protection and platform adapters.
- [Vela Experiential Learning Loop](../architecture/VELA-EXPERIENTIAL-LEARNING-LOOP.md): AEP-to-policy evidence, learning lifecycle, promotion, retention, regression and rollback.

## 3. Bounded cognitive pipeline

The following stages are **logical responsibilities, not required one-call-per-stage microservices**:

| Responsibility | AI participation | Canonical authority |
|---|---|---|
| Input perception | Interpret meaning, ambiguity, implied references, goal and requested deliverables | Trusted input envelope, active selection, user identity and actual attachment metadata |
| Context investigation | Generate evidence needs, assess sufficiency, request deeper retrieval | CIE and original source owners; scoped, authorized retrieval and freshness |
| Planning | Compose typed mission plan, strategies, agents, tools, dependencies, output and verification contracts | Mission plan validator, capability registry, authorization gateway |
| Mission executive | Interpret new results, propose branch changes, correction, escalation or completion | Canonical MissionService, task state machine, deterministic scheduler and durable effect journal |
| Specialist execution | Code, research, multimodal generation, documents and authorized tools | Provider adapters, source owners, artifact registry, tool execution policy |
| Verification | Model-based semantic review plus machine-observable tests | Tests, actual artifacts, source citations, explicit acceptance state |
| Result composition | Choose truthful text, UI blocks, files and multimodal presentation | Artifact references and canonical verification status |
| Experience capture | Interpret corrections and performance patterns; propose policy candidates | AEP evidence, CIE policy-approved projections, owner-authorized policy store |

A simple exact device query may use a native zero-model path. A complex or ambiguous mission may use repeated model calls and intelligent revisions. Cognitive completeness is evaluated on **task outcomes**, never model-call count.

## 4. Typed proposals and deterministic contracts

All model-produced plans and adaptive recommendations are **untrusted proposals**. Structured Outputs or equivalent validated envelopes are preferred when supported, but structured syntax alone does not establish semantic validity.

A plan proposal must encode at least:
- schema version, mission parent identity and version; explicit objective, assumptions and uncertainty;
- required input evidence and coverage gaps, with provenance;
- task/agent graph with stable IDs, typed dependencies, provider/model capability requirements, tool scopes, output artifacts and completion criteria;
- opportunities for parallel execution, ordering constraints, read/write resource claims and side-effect risks;
- verification and recovery strategy, revision bounds and escalation conditions;
- requested user-facing results and privacy/authorization requirements.

The host shall reject unknown task identifiers, cyclic dependencies, nonexistent capabilities, unapproved disclosures, invalid tool requests, conflicting write plans without isolation and plans that cannot meet declared constraints. A rejected proposal is not quietly executed; it may be repaired, re-planned or reported as blocked.

Capability selection is **registry-backed**, versioned and provisionally qualified by real provider availability, user entitlements, data policies, error rates and measured task-level quality. Model names, prices, API transport guarantees and latency estimates are not hardcoded architectural invariants.

No model output may create access rights or reclassify a historical source as authoritative. A model-generated file path or claimed repository commit does not establish file existence.

## 5. Canonical ownership and boundaries

| Concern | Existing owner to extend | Forbidden duplicate |
|---|---|---|
| Vela's identity, interaction and cognition | Charter 06 / AIR / Vela capability runtime | Provider-specific assistant identity or second global router |
| Mission/task state, attempts, delegation | Charter 05 / MissionService | Parallel task truth store or untracked scheduler |
| Context, memory projection, source evidence | Charter 08 / CIE / unified memory runtime | Independent memory island or learning-fact database |
| Authorization, disclosure, approval | Charter 14 policy gateway | LLM-granted privileges or implicit consent |
| Events, provenance and stream projection | Charter 09 canonical event source | Generated progress theater or private-reasoning reconstruction |
| Execution metrics, costs, optimization evidence | Charter 10 / AEP | Competing profiler or invented measurements |
| Resource governor and rendering cost | Charter 13 / performance governor as ARIE | Second resource authority or coupling graphic tier to model intelligence |
| Quality criteria, acceptance and rollout | Charters 15–16 | Self-certified AI output as release evidence |
| Codex/native/OpenAI execution | Charter 12 and capability adapters | Hardcoded API eligibility or bypass of host policy |

The *AI Mission Executive* is a cognitive role operating **through** MissionService, not a new scheduler. The *Adaptive Policy Learning* capability is a coordination layer over existing evidence and policy stores, not a new fact source. ARIE augments the existing performance governor instead of competing with it.

## 6. Performance and resource doctrine

- Parallelize safely separable work across intake, authorized retrieval, capability discovery, planning, agent operations, testing and result assembly.
- Model calls can run concurrently via asynchronous I/O without dedicating one CPU thread per request. Use bounded CPU worker pools or subprocesses for local parsing, indexing, builds and media processing; isolate the UI/render path.
- Optimize the measured **critical path to verified completion**, including p50/p95, initial meaningful feedback, failure/rework, user interruption and final deliverable quality.
- Use prompt caching, streaming, qualified low-latency transports, asynchronous tools and provider tools **when measured and eligible**, not as blanket assumptions.
- Treat foreground gaming/work and battery/thermal conditions as resource-protection inputs. ARIE may defer local heavy work without silently downgrading semantic reasoning or authorized mission goals.
- High-frequency OS metrics and lock enforcement belong in native code. The AI may interpret longer-horizon patterns, propose strategies and explain decisions. No token-expensive AI polling of each performance sample.
- Do not blindly spawn agents. Right-size agent count to genuine parallel work and evaluate coordination overhead, conflict and quality.
- Reject policies that are faster only because they skip required retrieval, testing, review or permissions.

## 7. Experiential learning decision

AEP shall support a closed loop: observe, diagnose, propose, experiment, verify, promote, monitor and, when warranted, roll back. The learned unit is a **scoped, evidence-backed strategy**, not a permanent universal instruction generated from one successful outcome.

CIE retrieves candidate experiences with source lineage, timestamps, confidence and applicability limits; AIR and ARIE consume only validated, permitted policy projections. Historical records can be corrected, superseded or deleted under memory/privacy policy. An experiment cannot silently expand tool authority or teach Vela to hide a failure.

Learning from user corrections is permitted only through source-verifiable, consent-compatible provenance. Learning does not mean provider model-weight fine-tuning unless that is separately designed, approved and implemented.

## 8. User-visible adaptive intelligence

Vela shall offer explanations grounded in actual plan versions, decisions, tool receipts, telemetry and experimental evidence. The Adaptive Intelligence Workspace is a **projection** of existing AEP/ARIE/AIR/CIE records and does not become their owner.

Surface observed values and inference distinctly. Display sample size, baseline, task class, conditions, uncertainty, quality gates, policy version and rollback state for any claimed improvement. Private model chain-of-thought is not an inspectable API artifact and must not be fabricated.

## 9. Alternatives considered

| Alternative | Rejected because |
|---|---|
| Deterministic keyword router plus one central planner | Misinterprets ambiguous real requests and leaves context/oversight unintelligent |
| Model call after every trivial operation | Adds latency, cost and disclosure while exact native operations already have authoritative answers |
| One heavyweight agent for every task | Serial bottleneck and poor specialization on independently executable work |
| Fixed large swarm for every mission | Coordination overhead, inconsistent shared state, unnecessary conflicting effects |
| Autonomous LLM controls all execution | Unsafe effects, privilege confusion, non-deterministic recovery and untestable truth |
| Separate resource controller, profiler and learning database | Violates canonical ownership and produces contradictory signals |
| Optimize only tokens or model call count | Can systematically remove useful intelligence and increase total rework |
| Big-bang rewrite during Architecture Recovery | Breaks existing flows, violates ADR-002 and obscures acceptance evidence |

## 10. Consequences, risks and mitigations

**Benefits:** stronger semantic fidelity, composable specialist capabilities, faster independent execution, hardware-aware scheduling, traceable adaptation, stable Vela identity and meaningful user inspection.

**Costs:** more interfaces and state-transition complexity; provider/provider-tool compatibility; tracing overhead; privacy-aware evaluation data; concurrency conflict hazards; risk of policy overfitting and reward hacking.

**Mitigations:** versioned contracts, minimal logical abstractions, one mission owner, deterministic authorization, bounded budgets, dry-run/shadow strategy experiments, isolated workspaces, held-out quality evaluations, reproducible telemetry, rollback, explicit unknown-effect outcomes, and capability-based degradation.

## 11. Program sequencing

**Program A (Recovery):** inventory and reconcile canonical owners; preserve existing behavior; establish event, context, plan and resource contracts; instrument a trustworthy baseline; permit bounded shadow probes. A documentation change does not authorize wholesale implementation.

**Program B (Realization):**
1. AI-native intent and CIE evidence handoff through existing provider/policy boundaries.
2. Mission plan contract, validation, dynamic delegation and AI Executive oversight.
3. Concurrent scheduler and ARIE integration behind existing resource governor.
4. AEP quality-adjusted evidence and policy experiments with CIE-backed experiential retrieval.
5. Adaptive Intelligence Workspace, historical inspection and user controls.
6. Real packaged Windows acceptance, provider compatibility and long-duration regression tests.

Each slice must ship with owner-specific tests, negative authorization tests, measured latency and honestly labeled implementation status. Program A and B scopes must be named in PRs.

## 12. Acceptance evidence and status boundary

This ADR is satisfied as a **design decision** when its ownership map, subordinate contracts and governance relationships are consistent. **Runtime acceptance** is separate and requires:

1. Ambiguous unseen requests understood with source-grounded evidence, no keyword-specific shortcuts and no privacy widening.
2. Valid schema-based plan proposals with required task contracts, appropriate agent count, recoverable versioning, and rejected cyclic/unauthorized examples.
3. Measured task overlap, critical-path savings and quality parity versus an honest sequential baseline.
4. ARIE foreground gaming and idle scenarios showing resource backoff and resumption without silent cognitive downgrade.
5. AEP learning experiments with holdout evaluation, rejection on quality regression and durable rollback.
6. Correct completion, uncertain-effect handling, retries, restart continuity, factual result composition and real workspace evidence.

No passing documentation check, synthetic fixture or PR merge alone proves the complete runtime.

## 13. Authority and related reading

- [Constitution 00](../../governance/00-AETHERWAKE-CONSTITUTION.md)
- [05 Agents, Tasks and Workflows](../../governance/05-AGENTS-TASKS-AND-WORKFLOWS.md)
- [06 Vela Intelligence and Adaptation](../../governance/06-VELA-INTELLIGENCE-AND-ADAPTATION.md)
- [08 Context Intelligence and Memory](../../governance/08-CONTEXT-INTELLIGENCE-AND-MEMORY.md)
- [09 Intelligence Streams and Observability](../../governance/09-INTELLIGENCE-STREAMS-AND-OBSERVABILITY.md)
- [10 AI Execution Profiler](../../governance/10-AI-EXECUTION-PROFILER.md)
- [13 Platform, Performance and Displays](../../governance/13-PLATFORM-PERFORMANCE-AND-DISPLAYS.md)
- [14 Trust, Privacy and Autonomy](../../governance/14-TRUST-PRIVACY-AND-AUTONOMY.md)
- [15 Quality, Verification and Acceptance](../../governance/15-QUALITY-VERIFICATION-AND-ACCEPTANCE.md)
- [16 Engineering and Delivery](../../governance/16-ENGINEERING-AND-DELIVERY.md)
- [ADR-001 capability first](ADR-001-CAPABILITY-FIRST-EXECUTION-FABRIC.md), [ADR-002 recovery](ADR-002-ARCHITECTURE-RECOVERY-AND-COHESIVE-RUNTIME.md), [Vela capability runtime](../architecture/VELA-CAPABILITY-RUNTIME-AND-EXECUTION-FABRIC.md), [unified memory](../architecture/VELA-UNIFIED-MEMORY-AND-CONTEXT-RUNTIME.md), and [CIE semantic retrieval](../specifications/CIE-SEMANTIC-INTERPRETATION-AND-EVIDENCE-RETRIEVAL.md).

**Status reminder:** This ADR records the user-directed target architecture. It does not assert that ARIE, adaptive AEP, the AI Mission Executive, or experiential learning are already implemented.
