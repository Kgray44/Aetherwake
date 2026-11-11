# Fluid Intelligence Realization: Integration and Milestone Plan
## AI-native cognition · AIR · CIE · Mission Executive · ARIE · AEP · Adaptive Intelligence Workspace

> **Status:** Proposed implementation roadmap, 2026-11-10. No phase, benchmark, model compatibility, native GPU visual, adaptive learning result, or full Fluid Intelligence capability is represented as completed by this plan or its merge.
>
> **Authority and sequence:** The owner-ratified [Constitution](../../governance/00-AETHERWAKE-CONSTITUTION.md), [governance registry](../../governance/README.md), [Engineering & Delivery Charter 16](../../governance/16-ENGINEERING-AND-DELIVERY.md), and [Quality Charter 15](../../governance/15-QUALITY-VERIFICATION-AND-ACCEPTANCE.md) prevail. Preserve the explicit separation of [ADR-002 Architecture Recovery vs Full Realization](../../docs/decisions/ADR-002-ARCHITECTURE-RECOVERY-AND-COHESIVE-RUNTIME.md). This plan overlays and extends the historical [M0–M8 roadmap](M0-M8-IMPLEMENTATION-ROADMAP.md), not a claim that its old proposed-charter references are current or that those milestones have passed.
>
> **Acceptance contract:** [Fluid Intelligence Acceptance](../../docs/specifications/VELA-FLUID-INTELLIGENCE-ACCEPTANCE.md). **Experience contract:** [Adaptive Intelligence Workspace](../../docs/design/VELA-ADAPTIVE-INTELLIGENCE-WORKSPACE.md). Scope also follows FI-2026-11-10 amendments to Charters 05, 06, 08, 09, 10, 13 and 15.

## 1. Objective and governing product outcome

Deliver one coherent, persistent, AI-native Vela that intelligently interprets requests from input onward; retrieves authoritative contextual evidence; plans, delegates, executes, verifies and replans with suitable models and tools; parallelizes independent work; adapts local CPU/GPU/RAM/disk/network consumption according to foreground needs; learns from *validated outcomes* rather than optimizing for token count; and offers an immersive, source-backed workspace in which the owner can inspect and control decisions, resource policies, experiments, learning and reversions.

North-star principle: **Vela should become faster without becoming less capable and more capable without becoming unnecessarily slower.** Minimize the critical path to verified useful work, not the number of model calls. Intelligently chosen model calls belong in perception, CIE, planning, executive supervision, review and user-facing result composition, while deterministic code remains responsible for authorization, locks, state transition integrity, resource enforcement, exact native operations and known objective tests.

One Vela identity. One canonical MissionService. One CIE retrieval/derived-memory coordinator. One source-owned event/projection lineage. One AEP metric and experiment authority. One Platform Governor expanded into ARIE. No duplicate agent or profiler datastore, competing scheduler, synthetic thought stream, or detached learning subsystem.

## 2. Program split and verified baseline discipline

### Program A: Architecture Recovery (separate, bounded)

Architecture Recovery owns consolidation of existing runtime contracts, storage/persistence and routing authorization coordination, renderer/application ownership, integration CI and a clean handoff. It does not automatically receive authority to implement full semantic CIE, adaptive policy learning, ARIE, AIW or a giant new agent framework. Continue scoped recovery PRs and satisfy their stated gates. Changes essential to avoid later architectural conflict may document or expose interfaces, but not silently expand delivered features.

**Snapshot at drafting (2026-11-10):** PR #25 A0/A1, #26 A2.1, #27 A2.2 have been merged in the inspected repository; PR #28 A2.3 was open at review. The repository contains AIR routing, Responses/Codex integration, mission state, event and persistence foundations, but end-to-end Fluid Intelligence, adaptive optimization and AIW remain unverified. Requery GitHub and tests before treating these statuses as current. Do not infer A2.3, A3 or A4 completion merely because time has passed.

**Recovery-to-Realization gate:** written service/owner map, one event lineage, permission gateway, architectural migration plan, reproducible integrated CI, API adapter contract, current route/capability audit, test evidence and tracked missing behavior. No new feature phase may fork canonical ownership in order to bypass a recovery blocker.

### Program B: Full Aerynth Realization (this roadmap)

The phases below are independently verifiable vertical slices, not new operating programs that displace existing M0–M8. They may overlap where contracts isolate work, but cannot skip foundational governance, provenance or trust. Program B's work is capability delivery rather than an unbounded "cleanup" pretext.

## 3. Dependency graph

Primary dependency spine:

    Architecture Recovery A0–A4 / canonical ownership
          |
          v
    FI-0 requirements + contracts + capability inventory
          |
          +----> FI-1 observed baseline and real trace fabric ----------+
          |                                                             |
          +----> FI-2 AI-native perception/CIE/plan/executive slice -----+
          |                                                             |
          +----> FI-3 ARIE hardware/resource probe + safe policy -------+
                                                                        |
                                                                        v
                                         FI-4 real concurrent missions and safe scheduling
                                                                        |
                                                                        v
                                         FI-5 controlled AEP learning/policy lifecycle
                                                                        |
                                                                        v
                                         FI-6 spatial AIW, integration and user controls
                                                                        |
                                                                        v
                                         FI-7 resilient full-system qualification and owner review

FI-1 / FI-2 / FI-3 may begin scoped, nonconflicting preparatory work in parallel after FI-0 contracts. A data-backed AIW prototype may begin early behind read-only adapters, but FI-6 cannot be accepted without live source integration and passing experience tests. FI-4 should avoid irreversible scheduling choices until real AEP baselines and resource behavior are measured. Full multi-provider features are conditional on live API capability qualification.

## 4. FI-0 — Governance reconciliation and implementation contracts

**User-visible outcome:** No new UI promise; engineering has one unambiguous map of what Vela must do and which services own it.

**Deliverables**
- Review all FI-2026-11-10 charter amendments and active companion docs for consistent scope, owner status and historical references; preserve accepted constitutional requirements.
- Establish typed cross-domain contracts for request/intent evidence, CIE evidence package, capability registry/version, candidate and accepted plan, plan validator verdict, agent allocation/attempt, AI Executive decision, resource lease and policy epoch, profiler span, experiment, learning record, verification result, artifact and final user delivery.
- Map current actual repository owners and migration paths, including AIR L0–L5, MissionService, governor, renderer, event bus, CIE persistence and provider adapters. Reuse services; record duplications to eliminate.
- Identify model and tool compatibility based on provider documentation **and qualified live requests**: model/version/effort, structured outputs, tool calling, streaming, transport, async tool support, multimodal and other approved OpenAI capabilities.
- Register FI-ACC-01–46 and relevant governing tests in the existing requirements/test matrix; define fixture and evidence schemas and baseline workloads.
- Determine privacy/redaction and data-retention impact before capturing telemetry.

**Dependency / parallel:** Recovery canonical boundaries and governance routing. Contract work, capability inventory, privacy assessment and test-corpus curation can run concurrently under separate authors.

**Exit gate:** Approved interface ownership and migration map; schema conformance tests, threat model and explicit open architecture decisions; no forced implementation of unresolved provider features. Review under Charter 16, not self-ratified by agents.

## 5. FI-1 — Actual measurement and mission truth foundation

**User-visible outcome:** A basic, honest source-backed measurement and inspection surface; absent data clearly marked.

**Deliverables**
- Instrument end-to-end phase timestamps and correlated trace/span IDs across input, CIE, planning, API, mission execution, tools, verification and delivery.
- Capture parent/task/agent/attempt and plan-version lineage with deduplication, stable clocks or clock-domain metadata, restart-safe retention and privacy-based projection.
- Measure time to acknowledgement, first meaningful text, first verified useful result and completion; critical-path vs worker time; queue, retry and overlap; provider actual/estimated/missing token/tool costs and local CPU/GPU impact when sampled.
- Make instrumentation nonblocking and load-aware; distinguish recorded provider/tool facts from modeled extrapolations.
- Extend AEP existing metrics instead of introducing a second metering datastore; publish source-backed typed read APIs for AIW.

**Dependencies:** FI-0 ownership/event contracts; existing Codex/Responses integration and Charter 09 real event bus. The read-only projector and metric aggregation can be built in parallel after event definitions stabilize.

**Native demonstration:** A supported real mission with one model, one tool, one failure/retry and concurrent branches; all states attributable and no doubled time/cost. A synthetic fixture for missing data is clearly labeled.

**Exit gate:** FI-ACC-11, 14–15, 26–27 integration results; profiler disabled/minimal/full overhead measured. A chart with fixture values alone is not acceptance.

## 6. FI-2 — AI-native cognitive vertical slice

**User-visible outcome:** Vela understands an unfamiliar ambiguous request, finds context with provenance, constructs a valid executable plan, supervises work and reports verified results.

**Deliverables**
- Implement model-assisted input perception with support for bounded clarification when information is irreducibly missing; preserve exact L0 operations when no semantic model is beneficial.
- Implement iterative CIE semantic evidence retrieval under source permissions and correction/deletion propagation, without granting the context interpreter autonomous action authority.
- Implement planning and strategy contracts for reasoning model selection, specialist count and roles, dependencies, allowed tools, execution transport/tier, expected outputs and verification plans.
- Compile/validate model-generated structured plans against actual capability registry, governance, permissions, resource policy and executable tool contracts; log rejected candidates without executing them.
- Implement an AI Mission Executive that can review meaningful execution events, request more evidence or specialist help and propose versioned replans, subject to deterministic validation.
- Preserve Vela identity across models, task checkpoints and authorized provider handoffs; ensure final multimodal result composition reports real outcomes and unfinished work.
- Benchmark real OpenAI features against alternatives (streaming, caching, parallel calls, supported persistent transports, async/programmatic tools, retrieval tools, agents SDK) only when qualified; avoid mandated hypothetical endpoints.

**Dependencies:** FI-0; FI-1 event/tracing hooks for honest acceptance; existing AIR/MissionService/CIE contracts. Planning, CIE retrieval and API capability work can overlap behind stable interfaces.

**Native demonstration:** User refers to a previous ambiguous issue and requests research, implementation, document and summary in one mission; CIE retrieves correct authorized evidence, plan passes validator, Codex/tool path does verified work, model changes do not drop conversational identity.

**Exit gate:** FI-ACC-01–10 plus 16–17 and relevant CIE permission/held-out tests. Unfamiliar prompts must work; keyword-matching to a test corpus is disqualifying.

## 7. FI-3 — ARIE resource intelligence and protective governor

**User-visible outcome:** Vela remains intelligent and useful while the user's desktop is loaded, and uses spare local resources more aggressively when idle.

**Deliverables**
- Expand the **existing Performance Governor** into ARIE, preserving its UI visual tier responsibilities and resource-policy authority without spawning a duplicate scheduler.
- Monitor OS-native CPU topology/load, process and foreground responsiveness, GPU/VRAM/thermal sensors where available, memory pressure, disk/network contention, sleep/power state, with explicit units/cadence/stale/missing status.
- Distinguish async remote API request concurrency from CPU-bound local worker pool and GPU-bound rendering/processing. Configure bounded pools, leases, scheduler priorities and preemption cooperation at the execution kernel.
- Introduce smoothed, hysteretic policy adjustments and user modes for gaming/foreground, balanced and idle; protect voice/render input responsiveness; measure actual performance rather than relying solely on CPU percent.
- Add AI-assisted, evidence-grounded resource recommendations from AEP/CIE, while keeping machine safety/authority deterministic. Show policy proposal, validation, applied epoch, observed effect and reversibility.
- Test consent and data minimization for foreground process/sensor observations; provide a user override/disable mechanism for monitoring where governed.

**Dependencies:** FI-0 governor/mission interface; FI-1 metrics and separate sensor provenance. Can develop alongside FI-2 until shared scheduler/decision contracts converge.

**Native demonstration:** Same verified workload across idle, balanced and foreground gaming conditions on supported hardware; concurrent remote inference continues when possible, local builds throttle, foreground input/frame-time behavior is measured, ARIE policy and actual effects are visible.

**Exit gate:** FI-ACC-18–25, safety/authorization and instrument overhead tests; unsupported sensors show missing data. Performance thresholds predeclared from evidence. No universal hardcoded CPU utilization threshold claimed as learning.

## 8. FI-4 — Real parallel execution and adaptive mission scheduling

**User-visible outcome:** Multi-agent missions execute independent work concurrently, respect dependencies and local hardware, remain responsive and recover safely.

**Deliverables**
- Add dependency-aware concurrent dispatch, asynchronous API operations and bounded process/thread workers to the **existing MissionService scheduler**.
- Separate plan acceptance from actual execution, resource reservation, permission checks, provider receipts, postcondition verification and user delivery. Typed state changes with idempotency keys.
- Support conflict-aware files/worktrees/side effects, safe isolation, cancellation, retry, unknown external completion and eventual reconciliation.
- Couple ARIE resource leases and AEP critical-path measurements to scheduling, with fairness and low-latency foreground paths.
- Permit AI Executive replan/agent proposals; validate changed plan version and do not rerun unaffected verified tasks.
- Handle provider capability/retry/rate-limit/latency changes, preserving task ownership across model/transport switches.
- Independently verify full artifact results and ensure output composer does not claim missing deliverables.

**Dependencies:** FI-1 metrics, FI-2 cognitive/executive/plan contracts, FI-3 resource policy. Subprocess worker isolation and API async routing can be developed in parallel against stable task IDs and locks.

**Native demonstration:** Parallel mixed research, Codex edits in isolated workspaces, generated visual/file deliverables, real verification, failure and replan, while gaming protection remains active. Recorded critical path proves actual overlap and exposes when parallelism worsened results.

**Exit gate:** FI-ACC-06–18, 20–25 and 26 with multi-run baseline comparisons, reconciliation and privacy checks.

## 9. FI-5 — AEP experiments, experiential learning and safe promotion

**User-visible outcome:** Vela identifies a plausible strategy improvement from her work, runs controlled comparisons, validates or rejects it, applies only authorized improvements and learns scope-limited lessons that survive restarts.

**Deliverables**
- AEP optimization candidate schema: target objective, original/candidate strategy and version, task applicability, evidence, costs, quality risks, model/tool compatibility, predicted effect (explicitly prediction), stop and rollback criteria.
- Independent controlled comparison framework with baseline, task-family match, holdout, repeated runs, model/version context, cold/warm handling, hardware/user activity context, statistical uncertainty and real quality criteria.
- Policy lifecycle: hypothesis → candidate → experiment → independently reviewed → approved/promoted or rejected → monitored → superseded/rolled back, plus explicit nonapplicable/unknown states.
- Scope-aware experiential records and CIE retrieval with correction/revocation propagation, without merging provider-specific metrics into an unrelated global memory store.
- Integration paths: AIR applies qualified model/routing choices; MissionService applies authorized execution strategy; ARIE applies resource policy; AEP owns experimental evidence; CIE provides scoped memory.
- Implement regression sentinels preventing quality, correctness, safety, privacy, accessibility, authorization or user preference reduction for attractive token/latency improvements.
- Prevent self-grading feedback loops and contamination of independent evaluation sets. No self-modifying source code or automatic privilege widening from performance results.

**Dependencies:** FI-1 actual observations, FI-2 semantics, FI-3 ARIE, FI-4 missions; can prototype experiment record formats earlier with synthetic clearly marked tests.

**Native demonstration:** One candidate passes and is promoted after quality-preserving evidence; a second tempting but lower-quality optimization fails; subsequent applicable task retrieves promoted learning; different task/device does not overgeneralize; later evidence supports safe rollback with preserved history.

**Exit gate:** FI-ACC-28–36 and 40–41, plus governing AEP experiments/holdout gate. Unconvincing data remains inconclusive, not "learned".

## 10. FI-6 — Adaptive Intelligence Workspace and cinematic integration

**User-visible outcome:** An immersive spatial environment where Vela's observable engine choices, resource adjustments, measured performance and learning history can be inspected, explained and responsibly controlled.

**Deliverables**
- Build one persistent AIW with six connected zones: Decision Observatory, Resource Intelligence, Execution Profiler, Learning Observatory, Experiment Laboratory, and Adaptation Timeline.
- Reuse existing GPU-native spatial runtime, Motion Coordinator, Stream V2 and Charter 03 workspace identity. Do not replace Stream V2 with a flat dashboard or introduce a second canonical execution topology.
- Query source-backed read projections for all metrics; capture provenance class, scope, uncertainty, actual/estimate distinction, missing states and plan/policy versions.
- Implement meaningful interaction surfaces for selecting decisions, comparing experiments, asking Vela for evidence-grounded explanations, managing authorized ARIE overrides and reviewing/reverting policy promotions.
- Preserve spatial camera, selection, focus, accessible reader/keyboard fallback, reduced-motion parity, and cross-project navigability after restart or window moves.
- Handle high-density traces, disconnected providers, late events, retention gaps and resource pressure without blocking the renderer.
- Obtain real moving-camera and interaction-video evidence, frame-time/resource benchmarks, art direction review and owner visual acceptance separately from integration CI.

**Dependencies:** FI-1 real trace projections, FI-3 applied policy evidence, FI-5 learning records; renderer coordination from Program A and Spatial Runtime acceptance. Visual prototype and UI contract work may occur earlier in an isolated lab, but product claims require full integration.

**Native demonstration:** Open AIW from Vela Presence, inspect real mission's model choice and context evidence, show gaming-triggered ARIE adjustment, compare AEP experiment results, rollback a learning policy and return to Stream with same selected task. Repeat with partial data, permissions denied and reduced motion.

**Exit gate:** FI-ACC-37–46, AIW-01–10, OBS-FI and original Spatial Intelligence owner review. No simulated event or static screenshot substitutes for real integrated proof.

## 11. FI-7 — Cohesive hardening, deployment and long-term learning review

**User-visible outcome:** A dependable Aerynth experience, not merely five impressive subsystems working in isolation.

**Deliverables**
- Extended real sessions and multi-mission tests, provider outages/rate-limit/feature changes, local sleep/resume, crash/replay, repair and data migration.
- Cross-device supported matrix including busy gaming, low-resource and multi-display states, measured UI/voice responsiveness, ARIE safety and thermal behavior.
- Privacy and retention review for machine telemetry, model decisions, experiments, contextual learning and exports; deletion and revoked scope cannot leak via AIW or learned strategy caches.
- Independent held-out and adversarial benchmark suites with regression thresholds set before execution, plus rollback rehearsal.
- Longitudinal evidence review: what was learned across distinct task families, what strategies were rejected, how policy applicability and user correction worked, and what data remains insufficient.
- Verified documentation, upgrade/recovery path, reproducible CI, owner experience and release decisions, honest unsatisfied requirements and platform limitations.

**Dependencies:** FI-0–6 integrated and their quality gates; existing M8 platform delivery requirements.

**Exit gate:** FI acceptance G5, Charter 15 quality and independent owner sign-off. A public design doc, CI pass, test count or simulated fluid motion cannot establish release acceptance.

## 12. Work-package breakdown and recommended ownership

Assign work by **canonical code owner**, not by creating an arbitrary microservice per title:

| Work package | Lead code/domain owner | Primary phase(s) | Core output |
| --- | --- | --- | --- |
| FI-WP-01 Governance/context routing | Charter 16 / governance-router maintainers | FI-0 | Consistent requirement lookup and interface map |
| FI-WP-02 Typed cognitive/execution contracts | AIR + MissionService | FI-0–2 | Plan/decision/schema validators and capability registry |
| FI-WP-03 Trace and provenance fabric | Event service + AEP | FI-1 | Durable correlated native measurements |
| FI-WP-04 Perception and CIE semantics | Vela + CIE | FI-2 | Context-aware input and iterative evidence retrieval |
| FI-WP-05 Planning/AI Executive | AIR + MissionService | FI-2,4 | Versioned mission planning and adaptive supervision |
| FI-WP-06 Provider and tool execution qualification | Codex/Responses adapters | FI-0,2,4 | Real compatible model/tool transports |
| FI-WP-07 Resource telemetry and policy | Performance Governor/ARIE | FI-3 | Machine-aware bounded scheduling interface |
| FI-WP-08 Concurrent mission execution | MissionService + scheduler | FI-4 | Dependency DAG, safe workers, isolation/recovery |
| FI-WP-09 AEP experiments | AEP + Charter 15 independent reviewer | FI-5 | Experiments, quality comparison and policy evidence |
| FI-WP-10 Experiential retrieval and correction | CIE + Trust | FI-5 | Scoped durable learning and invalidation |
| FI-WP-11 AIW data and inspection | Charter 09 + 03 | FI-6 | Read-only projections and authorized controls |
| FI-WP-12 AIW spatial art and motion | Spatial Runtime + Motion Coordinator | FI-6 | Immersive real GPU UX and accessibility |
| FI-WP-13 System acceptance | Charter 15/16 integration owner | FI-0–7 | Automated+native evidence, independent sign-off |

Each package must define exact files/owned contracts, assumptions, dependency handshake, test evidence, migration/rollback, affected governance, and incomplete scope. Separate technical implementer and independent verification responsibility where practical.

## 13. Safe parallel development protocol

Multiple Codex branches may operate simultaneously, but:
- Branches/worktrees are isolated; avoid simultaneous uncoordinated edits to the same governing charter, shared schema or core service.
- Schema/interface changes are reviewed and published before consumers are integrated; contracts version and declare migrations.
- Merge narrow vertical slices after CI and ownership review, then rebase/revalidate downstream packages against actual merged head.
- Shared acceptance fixtures and provenance IDs are owned centrally. Agents cannot individually redefine correctness criteria to mark their own branch passed.
- A temporary compatibility adapter is allowed when migration is explicit; parallel long-lived schedulers/routers/datastores are not.
- Do not auto-merge high-impact code without applicable authorization; PR merge does not imply product acceptance.
- Source-sensitive artifacts stay in access-controlled storage; public repo receives only safely synthetic and redacted examples.

**Recommended early concurrency:** FI-WP-01/02 contracts, FI-WP-03 instrumentation spike, FI-WP-06 provider capability tests, FI-WP-07 OS sensor probe, FI-WP-13 corpus/quality harness. FI-WP-11/12 may explore an isolated art prototype after read-only schema definition. Integrate only after contracts, event provenance and permission gates are stable.

## 14. API and hardware strategy research checkpoints

Before irreversible API architecture decisions, benchmark the *actual qualified* OpenAI capabilities relevant to Vela: Responses reasoning/structured outputs, model/version routing, tools and tool search, retrieval, streaming/persistent transport when available, async/programmatic tool execution, Agents SDK coordination, image/audio/realtime paths, prompt caching, long-running/background jobs, and pricing/processing tiers. Use a versioned capability registry and real compatibility tests, not hardcoded promises of specific future model identifiers or promotional credit.

Before hardware scheduling policy is finalized, compare CPU worker pool/process isolation, async API I/O, task resource leases, process priority/affinity effects, GPU sampling compatibility, native window focus/foreground heuristics, power/sleep handling and renderer isolation. Use representative busy/idle workloads on named hardware and guardrails from the Platform Governor. Avoid hardcoding one device's worker count, thermal behavior or gaming mode into universal policy.

Promote only measured, quality-preserving changes and record reasons for not optimizing when extra reasoning, verification, context or reduced concurrency is actually beneficial.

## 15. Risk register and mitigations

| Risk | Mitigation / required evidence |
| --- | --- |
| AI interpretation drifts into unjustified action authority | Separate cognitive proposals from structured validator, permission gateway and accepted state |
| Too many agents / calls increase tail latency | AEP critical-path profiling and outcome-based agent sizing; benchmark sequential and parallel variants |
| Synthetic AI "thinking" presented as live | Event provenance classes, no hidden-chain-of-thought claims, explicit fixture labels |
| GPU effects, telemetry and local builds harm foreground gaming | ARIE hard limits, hysteresis, frame-time/input tests, reduced rendering tiers, preemption |
| Learning self-rewards shallow answers | Independent held-out quality suite, no self-graded promotion, rollback and protected invariants |
| CIE memory islands or cross-scope leakage | One retrieval owner, source-specific authority/retention, correction and deletion propagation |
| Provider feature incompatibility or account restrictions | Capability registry with live qualification, safe fallbacks and explicit unsupported states |
| Parallel worktree/file collisions | Resource locks, per-agent isolation, conflict resolution and idempotent side-effect policies |
| Missing provider usage and unsynchronized timestamps | Origin/clock-domain metadata, missing coverage, estimates separated from actuals |
| Adaptive policy harms privacy/authorization | Charter 14 enforcement, human authority for new privileges, audit and stop/rollback |
| Visual-first facade displaces functioning engine | Native real-data vertical slices and user-observed art acceptance, not screenshot-based claims |
| Scope creep during recovery | Program A vs B boundary review; independent PRs and explicit blocker classification |

## 16. Evidence and decision cadence

At each FI phase: produce a requirement-to-test matrix, actual source map, scoped PR(s), code/fixture version, reproducible commands, real provider qualifications where applicable, measured latency/critical-path/resource and quality metrics, privacy/accessibility findings, screen recording for spatial work, test failures and known gaps. Decision owner signs a gate explicitly; the next phase may begin exploratory work but cannot claim acceptance of unmet dependencies.

Use three recurring review loops: **technical integration** (canonical ownership and CI), **performance & safety** (AEP/ARIE measured evidence and reversibility), **product/visual** (owner experience, cinematic quality and truthful interfaces). These review loops can overlap; they cannot substitute for each other. Dates and staffing estimates should be set only after available resources and comparative prototypes are known.

## 17. Definition of complete

Fluid Intelligence is not complete merely because Vela uses lots of API calls, has multiple workers, shows six pretty regions, or declares a model learned something. It is complete only when:
1. Genuine AI cognition contributes throughout ambiguous understanding, contextual retrieval, planning, supervision and validation when advantageous.
2. All actual tools and actions remain authorized, recoverable, evidenced and correctly attributable.
3. Independent work safely overlaps, latency is measured end to end, and quality does not regress.
4. ARIE protects foreground resources while exploiting idle resources and preserves reasoning capability.
5. AEP demonstrates measured policy experimentation, appropriate learning and rejection/rollback of poor optimizations.
6. CIE supplies durable, corrected, privacy-scoped experiential knowledge applicable to future missions.
7. The immersive workspace can truthfully show and explain these processes from source-backed state, with accessibility and performance.
8. The published independent FI acceptance gates, native platform tests, security review and separate owner product/visual/release approvals pass.

**This plan is a roadmap, not a completion certificate. Protect intelligence, respect the machine, learn from real outcomes, and demonstrate every claim.**
