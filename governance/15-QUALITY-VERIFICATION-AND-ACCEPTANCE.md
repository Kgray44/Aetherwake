# 15 — Quality, Verification, and Acceptance
## Governing Charter for Evidence-Based Engineering Quality, Cinematic Experience Validation, and Release Acceptance

| Field | Value |
|---|---|
| Document ID | **AW-GOV-015** |
| Version | **1.0.0-draft** |
| Status | **Published governing charter — awaiting repository-owner acceptance** |
| Prepared | 2026-11-01 |
| Authority | Specialized subsystem charter, subordinate to [00 — Aetherwake Constitution](00-AETHERWAKE-CONSTITUTION.md) |
| Normative requirement namespace | **AW-QVA-###** |
| Primary domain | Quality strategy, verification, evidence, testability, human experience review, gates, defects, acceptance, release confidence |
| Constitutional anchors | AW-CON-001–003, 007–010, 014–025, 026–035, 042–065, 066–079, **084–091**; constitutional acceptance tests C-01–C-15 |
| Coordinates with | 01 Experience; 02 Liquid Intelligence; [03 Projects and Resources](03-PROJECTS-WORKSPACES-AND-RESOURCES.md); [04 Conversations](04-CONVERSATIONS-AND-CONNECTED-BRANCHES.md); 05 Agents; [06 Vela](06-VELA-INTELLIGENCE-AND-ADAPTATION.md); [07 Knowledge](07-NOTES-KNOWLEDGE-AND-THOUGHT-STREAM.md); [08 CIE](08-CONTEXT-INTELLIGENCE-AND-MEMORY.md); [09 Observability](09-INTELLIGENCE-STREAMS-AND-OBSERVABILITY.md); [10 Profiler](10-AI-EXECUTION-PROFILER.md); [11 Timelines](11-TIMELINES-AND-REPLAY.md); 12 Integrations; 13 Platform; 14 Trust; 16 Delivery |
| Readers | Repository owner, engineers, AI agents, reviewers, designers, accessibility specialists, security reviewers, performance analysts, release decision-makers |
| Publication boundary | Public normative guidance only. No real personal activity logs, credentials, private screenshots, or sensitive evaluation fixtures. |

> **Governing promise:** Aerynth is not finished when it merely functions. A feature is accepted only when **its intended behavior, cinematic experience, reliability, safety, accessibility, performance, observability, and integration are demonstrated at the appropriate level with trustworthy evidence**.
>
> **An agent saying "done" is a report, not verification. A passing test is evidence, not necessarily acceptance. A gorgeous demo is an illustration, not proof of product quality.**

---

## 1. Authority, purpose, and boundaries

This charter defines the **common method for demonstrating compliance** with Aetherwake's governing requirements. Other charters own the behavior of their respective subsystems; this charter owns the cross-cutting **quality gates, evidence discipline, verification methodology, release decisions, and acceptance semantics**. It MUST NOT silently replace their domain-specific requirements.

The [Constitution](00-AETHERWAKE-CONSTITUTION.md) is supreme. The repository owner retains final product-acceptance authority. Publication of this draft does not constitute owner ratification. Until accepted, it is a proposed governance baseline for review and implementation planning.

The words **MUST**, **MUST NOT**, **SHOULD**, and **MAY** have the meanings assigned by the Constitution. Requirements use stable identifiers in the **AW-QVA** namespace. When a related charter is not yet published or accepted, the applicable constitutional anchor remains authoritative and the open dependency MUST be documented.

**AW-QVA-001 — Universal quality applicability.** Every substantive change MUST identify the relevant functional, experiential, performance, security, accessibility, integration, data-integrity, observability, and maintainability risks before declaring completion.

**AW-QVA-002 — No ceremonial verification.** The existence of a test file, screenshot, demonstration video, green status badge, reviewer comment, or agent-generated report MUST NOT alone establish that the relevant requirement was satisfied.

**AW-QVA-003 — Proportional rigor.** Verification depth MUST scale with the impact, novelty, reversibility, exposure, and failure consequences of the change; a typographic adjustment and an autonomous destructive filesystem operation do not require identical test plans.

**AW-QVA-004 — No silent scope reduction.** An incremental milestone MAY deliver a deliberate subset of the vision, but unmet capabilities MUST remain visible, traceable, and explicitly outside that milestone's acceptance scope. A prototype MUST NOT be represented as the completed product.

**AW-QVA-005 — Dependency and conflict discipline.** Reviewers MUST use the current governance registry, identify relevant charters, and stop at an unresolved normative conflict rather than choosing the easiest requirement to satisfy. Constitutional conflicts follow its amendment procedure.

**AW-QVA-006 — Independence of claims.** The individuals or agents implementing a feature MAY propose verification evidence, but high-impact acceptance MUST include independent checks or review appropriate to the risk. Self-assessment alone cannot grant final acceptance.

**AW-QVA-007 — Quality as a continuing property.** Previously accepted features MUST remain subject to regression checks after changes to shared rendering, data models, permissions, memory, adapters, or orchestration.

## 2. Quality model: dimensions that cannot be averaged away

Aerynth quality is multidimensional. A successful build does not compensate for a destructive permission bug; elegant glass does not compensate for unreadable text; low token usage does not compensate for an incorrect result.

The quality dimensions are:

| Dimension | Core question | Representative evidence |
|---|---|---|
| Functional correctness | Does the requested behavior actually happen? | Scenario tests, state assertions, user demonstrations |
| Experience and clarity | Is the operation understandable and effortless? | Task-based usability review, error recovery, interaction recordings |
| Liquid Intelligence fidelity | Does the interaction meet the defined cinematic identity? | Design comparison, motion capture, material and continuity inspection |
| Accessibility | Can people use it without reliance on visual effects or pointer precision? | Keyboard, screen-reader, contrast, reduced-motion evaluations |
| Performance | Does it stay responsive and resource-aware in realistic conditions? | Frame-time distributions, input latency, memory, GPU/CPU traces |
| Reliability and recoverability | Does it survive faults, restarts, interruptions, and unusual states? | Crash/restart, migration, recovery and fault-injection tests |
| Security, privacy, and autonomy | Are actions bounded, transparent, and correctly authorized? | Abuse-case tests, approval traces, access reviews, audit records |
| Data and context integrity | Are identity, meaning, provenance, and history preserved? | Persistence/round-trip tests, context and branching evaluations |
| Observability and honesty | Can users tell what happened and what is not known? | Event reconciliation, missing-data scenarios, metric lineage |
| Integration and portability | Does it operate correctly across supported services and environments? | Adapter contract tests, capability matrices, deployment checks |
| Maintainability | Can the result be safely extended without widespread breakage? | Architecture review, contracts, focused tests, documentation |

**AW-QVA-008 — No masking critical failure.** A failing mandatory safety, data-integrity, accessibility-critical, truthful-reporting, or essential-function gate MUST NOT be offset by strength in another quality dimension or a high aggregate score.

**AW-QVA-009 — Feature-specific acceptance envelope.** Each feature MUST declare which quality dimensions apply, the associated tests or review method, any measured targets, unsupported environments, and the accepting authority.

**AW-QVA-010 — Production versus prototype.** Prototype evidence MUST be labeled, including mocked state, simulated events, placeholder interactions, and unavailable integrations. A prototype passes only the prototype's explicitly bounded acceptance criteria.

**AW-QVA-011 — Unknown is not pass.** Not run, unavailable, inconclusive, flaky, manually unreviewed, and unsupported MUST remain distinguishable from passing, failing, and intentionally not applicable.

**AW-QVA-012 — Deterministic plus human review.** Objective checks SHOULD be automated where possible. Visual elegance, comprehension, comfort, spatial continuity, and cinematic character ALSO require structured human review; neither form of evidence replaces the other.

## 3. Traceability, verification plans, and evidence

Every normative obligation should be traceable from charter to design, implementation, execution, evidence, and acceptance.

**AW-QVA-013 — Requirement traceability.** Each acceptance-relevant change MUST connect the applicable stable requirement IDs to a test, inspection, or reviewed rationale for non-applicability.

**AW-QVA-014 — Living verification matrix.** The project MUST maintain a machine-searchable mapping of requirement ID, owner/domain, implementation location, test/scenario, evidence reference, status, last execution, and known limitations as engineering infrastructure becomes available.

**AW-QVA-015 — Verifiable acceptance statement.** A major work item MUST define observable before/after behavior, relevant environment, test inputs, expected result, failure conditions, and acceptance decision before it can be accepted.

**AW-QVA-016 — Evidence provenance.** Verification records MUST distinguish direct observation, test output, reviewer judgment, model-generated explanation, derived metric, and estimate; MUST identify source and test environment where available.

**AW-QVA-017 — Durable proof.** Evidence SHOULD reference stable commit/build IDs, test artifacts, screen recordings, benchmark runs, trace IDs, affected resources, and applicable configuration. Sensitive evidence MUST be appropriately redacted or stored outside a public repository.

**AW-QVA-018 — Reproducibility.** Automated tests and performance benchmarks MUST document prerequisites, fixtures, versions, seeds where applicable, commands, expected outcomes, and environment differences that materially affect reproduction.

**AW-QVA-019 — Honest tool reporting.** A contributor or AI agent MUST NOT claim a test was run, screenshot reviewed, user experience validated, bug reproduced, dependency checked, or release approved unless that action occurred and evidence supports the claim.

**AW-QVA-020 — Adverse evidence preserved.** Failed checks, inconclusive runs, important warnings, and conflicting results MUST remain visible. Rerunning a job to obtain a passing result MUST NOT silently erase previous relevant failure evidence.

**AW-QVA-021 — Test fixture privacy.** Public fixtures MUST be synthetic or explicitly publishable. Real project notes, conversation transcripts, tokens, credentials, private screenshots, server logs, and personal behavioral profiles MUST NOT be copied into public test evidence by default.

### 3.1 Suggested evidence record contract

An implementation MAY store the record in JSON, a database, or CI metadata. At minimum, a **major verification record** SHOULD carry:

| Field | Meaning |
|---|---|
| Evidence ID | Durable unique identifier |
| Requirement IDs | Relevant AW-CON and subsystem requirement references |
| Work item / feature | Canonical resource or task identity |
| Build and commit | Source revision and built artifact where available |
| Environment | OS, display configuration, GPU/driver, backend versions, feature flags |
| Procedure | Reproducible test or reviewer protocol |
| Expected and actual | Explicit acceptance comparison |
| Measurement | Values, units, sampling window, methodology, uncertainty |
| Result | Pass, fail, inconclusive, blocked, or not applicable |
| Source class | Observed, reported, derived/inferred, manual judgment |
| Artifacts | Logs, traces, captures, screenshots, diffs, reports |
| Reviewer and decision | Who evaluated, time, comments, required follow-up |
| Known limits | Coverage gaps, waived risks, pending cross-platform checks |

**AW-QVA-022 — Evidence integrity.** Evidence MUST retain enough context to identify what actually ran and MUST NOT be altered to make failure look like success. Screenshots and videos MUST not imply a real agent state when the displayed data was simulated.

## 4. Verification levels and delivery states

Testing a helper function and accepting an end-to-end cinematic workflow are different kinds of proof.

| Level | Scope | Minimum purpose |
|---|---|---|
| L0 — Contract/static | Schemas, types, build, lint, policy, dependency rules | Reject obviously invalid interfaces and changes |
| L1 — Unit | Pure logic and isolated components | Prove local correctness and edge cases |
| L2 — Component | UI blocks, stores, adapters, motion primitives | Prove state transitions and interaction contracts |
| L3 — Integration | Codex, databases, filesystem, Git, events, rendering | Prove collaborating components work together |
| L4 — End-to-end | User-to-result workflows on realistic environments | Prove user-visible outcomes |
| L5 — Experience | Cinematic motion, visual clarity, comprehension, accessibility | Prove intended human experience |
| L6 — Resilience and adversarial | Faults, overload, malicious/untrusted inputs, interrupted processes | Prove containment and truthful recovery |
| L7 — Release/owner | Coherent milestone, blockers, risk, documented evidence | Decide whether the product may be accepted |

**AW-QVA-023 — Required layers by risk.** Relevant levels MUST be chosen from actual risk and interface exposure; substantial UI features cannot be accepted only at unit level, and high-impact agent actions require integration, adversarial, and recovery evaluation.

**AW-QVA-024 — State vocabulary.** Work tracking MUST distinguish at least: **planned, specified, implemented, demonstrated, tested, reviewed, integrated, deployed, owner-accepted**, plus **blocked/rejected** as applicable.

**AW-QVA-025 — No implicit promotion.** Completion of one state MUST NOT automatically imply any later state. In particular, agent-turn completion does not imply feature completion; merged code does not imply released behavior; release does not imply owner acceptance.

**AW-QVA-026 — Acceptance ownership.** The repository owner, or an explicitly delegated authorized approver, MUST decide final product acceptance. Agents may recommend acceptance but MUST NOT silently ratify governance or approve their own high-impact changes.

**AW-QVA-027 — Milestone boundaries.** Each milestone MUST publish its intended capabilities, deferred requirements, tested environments, quality targets, open defects, and exit criteria before being called complete.

## 5. Liquid Intelligence: cinematic visual quality is mandatory

The user experience is not an optional polish layer. It is core product functionality defined by AW-CON-016–021 and the future Charter 02. Generic dark panels, cosmetic neon, default transitions, disconnected particle wallpapers, or simple fade/slide effects alone do **not** satisfy the Liquid Intelligence vision.

**AW-QVA-028 — Design intent review.** Every major visual feature MUST be evaluated against a current approved design reference describing glass material, translucency, lighting, depth, typography, spatial hierarchy, attention behavior, and cinematic character.

**AW-QVA-029 — Six-motion coverage.** Acceptance-relevant design reviews MUST explicitly evaluate **Spatial, Material, Atmospheric, Semantic, Interaction, and Performance Motion**, including how they interact, rather than sampling isolated button transitions.

**AW-QVA-030 — Shared identity continuity.** Opening, docking, expanding, collapsing, detaching, reparenting, and restoring a resource SHOULD maintain recognizable object continuity; content identity, interaction state, and accessibility state MUST remain correct even when seamless cross-window animation is technically constrained.

**AW-QVA-031 — Material cohesion.** Glass and transparent surfaces MUST preserve legibility, contrast, layering, focus distinction, and consistent illumination. Visual-effects richness MUST NOT obscure important controls or critical status information.

**AW-QVA-032 — Semantic truth.** Activity glows, progress effects, agent constellations, delegation pulses, and completion animations MUST map to actual state or be conspicuously marked as simulation. A spinner is not verified proof of reasoning or progress.

**AW-QVA-033 — Motion physics quality.** Animations MUST be reviewed for continuity of position and velocity, believable response, stable settling, no unintended jumps, no contradictory simultaneous transitions, and correct behavior when interrupted mid-animation.

**AW-QVA-034 — Reduced motion.** Aerynth MUST provide a coherent reduced-motion experience that retains task understanding, state visibility, accessibility, and functional parity without requiring particle motion, zoom, parallax, or dramatic spatial travel.

**AW-QVA-035 — Quality tiers.** Cinematic and reduced-quality rendering modes MUST retain essential hierarchy, legibility, state feedback, and interaction semantics. Adaptive visual downgrade MUST NOT silently remove required controls, warnings, or approval affordances.

**AW-QVA-036 — Motion coordination under stress.** Visual review MUST include rapid repeated interactions, interrupted drag/drop, simultaneous event updates, navigation during animation, resizing during transition, and reduced GPU capacity.

### 5.1 Mandatory visual evaluation protocol

For any visual milestone, a reviewer SHOULD inspect:
1. **At rest:** hierarchy, glass, depth, particles, typography, density, and calm ambient character.
2. **On interaction:** hover/focus, pointer and keyboard input, selection, contextual command, drag, dock, resize, focus, modal/overlay, and undo.
3. **Across objects:** shared-element expansion, workspace transformations, resource identity preservation, tab changes, and secondary windows.
4. **During real AI work:** streamed message, tool activity, delegation, error, completion, approval, missing telemetry, and long silence.
5. **Under load:** constrained GPU/CPU, gaming/background mode, high-DPI displays, many blocks, long chats, and event bursts.
6. **Accessible fallback:** reduced motion, keyboard-only operation, alternate text/status cues, zoom, and contrast.
7. **Recovery:** app restart, interrupted transition, disconnected backend, renderer reset, and layout restoration.

Review SHOULD include side-by-side annotated captures, representative screen recordings at native frame rate, and high-frame-time traces. Static screenshots alone are insufficient for motion acceptance.

### 5.2 Visual acceptance rubric

Each applicable category is assessed **0 = absent/broken; 1 = materially deficient; 2 = usable prototype; 3 = meets approved design; 4 = exceptional and coherent**. Categories: visual material fidelity, spatial continuity, motion physics, semantic truth, interaction clarity, attention restraint, accessibility, performance consistency, and recovery coherence.

**AW-QVA-037 — No score laundering.** Passing by average rubric score alone is prohibited. An approved release criterion MUST specify minimum category scores; failures in accessibility, semantic truth, safety, identity continuity, or essential interaction block acceptance regardless of overall average.

**AW-QVA-038 — Human experiential gate.** For production-facing Liquid Intelligence milestones, owner/delegated design acceptance MUST be recorded in addition to automated tests. This charter does not predeclare subjective taste as machine-verifiable.

**AW-QVA-039 — Design debt honesty.** If a prototype intentionally uses placeholder components, the debt MUST be explicitly tracked with a path to the approved experiential target and cannot silently become a permanent acceptance baseline.

## 6. Interaction, contextual selection, and user agency

**AW-QVA-040 — Selection versus intent.** Evaluation MUST include selected-object, parent-folder, multi-object, collection-wide, explicit-only, exception/exclusion, and ambiguous-scope commands. Tests MUST ensure user language, not simply highlighted object count, determines scope.

**AW-QVA-041 — Interpretation preview.** For consequential operations, end-to-end tests MUST verify a comprehensible preview of affected objects, source/destination, operation category (reference change versus physical mutation), consequences, and applicable approval.

**AW-QVA-042 — Native operation and undo.** Representative assistant-driven navigation, resource organization, and layout changes MUST use validated native object actions and be inspectable; reversible operations MUST restore the correct resources and relationships.

**AW-QVA-043 — No unnecessary ceremony.** Usability testing MUST include uncomplicated local navigation, quick capture, opening a chat, and moving a block without forced AI calls, projects, or task definitions.

**AW-QVA-044 — Input breadth.** Once supported, Contextual Command MUST be evaluated on text selections, message excerpts, files/folders, images or regions, charts/time ranges, notes, tasks, and heterogeneous groups with stable source references.

**AW-QVA-045 — Uncertain scope.** Ambiguity tests MUST demonstrate either safe context-grounded interpretation or a concise clarification/preview. Wrong-scope high-impact execution is a blocking defect.

**AW-QVA-046 — Visual action feedback.** The motion associated with selection expansion, command interpretation, execution, and undo MUST reflect actual object state and allow users to understand which resources changed.

## 7. Projects, workspaces, blocks, chats, and connected branches

**AW-QVA-047 — Canonical resource identity.** Tests MUST establish that a resource displayed in multiple workspaces or collections retains one canonical identity, state, and history; moving a block MUST NOT duplicate or destroy its resource.

**AW-QVA-048 — Persistence and layout round trips.** Tests MUST cover workspace and home layout creation, resizing, docking, freeform/structured modes when supported, saving, snapshots, restart, restoration, undo/redo, and failure during persistence.

**AW-QVA-049 — Settings resolution.** Global/project/workspace/chat/task overrides MUST be tested for correct precedence, explicit origin display, reset-to-inherited behavior, invalid combinations, and migrations.

**AW-QVA-050 — Smart organization.** AI-produced collections, relationships, tags, and project associations MUST be validated against explicit examples, misleading similarities, false positives, manual corrections, and user reversals.

**AW-QVA-051 — Chat-first acceptance.** A user MUST be able to begin, use, resume, find, and inspect an ordinary conversation without creating a task or project; streaming, interruption, attachments where supported, and long-history scrolling require end-to-end evaluation.

**AW-QVA-052 — Connected branch integrity.** Tests MUST fork a conversation, create new post-fork evidence in two branches, retrieve a cited sibling finding, continue one branch, and verify independent histories and source provenance. Full automatic transcript merging MUST NOT be assumed.

**AW-QVA-053 — Searchability at scale.** Conversations, collections, project resources, and relationship views MUST be evaluated for accuracy, discoverability, filtering, stable navigation, and performance with representative large data volumes.

**AW-QVA-054 — Non-destructive organization.** Deleting a block, detaching a link, changing collection membership, or archiving a workspace MUST NOT silently delete canonical data, unrelated memberships, or external source content.

## 8. Vela, agents, tasks, and autonomous work

**AW-QVA-055 — Separate lifecycles.** Tests MUST distinguish agent identity/profile, chat, task, execution attempt, completed turn, implementation result, review, and independently verified objective.

**AW-QVA-056 — Delegation completeness.** Multi-agent test cases MUST inspect task decomposition, dependencies, context packages, permissions, work isolation, handoffs, results, and reconciliation with the initiating request.

**AW-QVA-057 — Parallel conflict safety.** Concurrent agents editing shared source, state, databases, or remote services MUST undergo conflict and isolation tests; Git worktrees alone do not satisfy non-Git shared-state isolation.

**AW-QVA-058 — Efficiency-aware orchestration.** Evaluations MUST compare delegated and non-delegated approaches for correctness, elapsed time, token usage, overhead, coordination failures, and rework; unnecessary agent spawning MUST count as a cost, not an achievement.

**AW-QVA-059 — Acceptance independent of agent confidence.** The assistant's declaration of task completion MUST be checked against the task's actual acceptance criteria and objective evidence.

**AW-QVA-060 — Initiative restraint.** Proactive monitoring and notifications MUST be evaluated for high-urgency delivery, routine event suppression, gaming/focus quiet behavior, attention tracking, return digests, user corrections, and unauthorized interruption.

**AW-QVA-061 — Adaptation reversibility.** Learned habits and suggested preference changes MUST be testable for explanation, approval/decline, correction, resetting, scope restriction, and non-escalation of privileges.

**AW-QVA-062 — Direct conversation preservation.** Vela and multi-agent orchestration features MUST NOT block or degrade the ability to simply converse with Codex.

## 9. Notes, knowledge, CIE, and memory fidelity

**AW-QVA-063 — Immediate capture.** Quick Capture MUST pass a save-and-retrieve test without requiring a model response, a project selection, or cloud connectivity when local operation is supported.

**AW-QVA-064 — Note provenance and authority.** Tests MUST distinguish ideas, observations, tentative hypotheses, verified facts, decisions, and formal requirements; automatic note organization MUST NOT silently promote casual ideas into binding rules.

**AW-QVA-065 — Canonical memory preservation.** Context compaction, memory decay, summarization, and task handoff MUST be tested to confirm source history remains retrievable under declared retention policy.

**AW-QVA-066 — Relevant retrieval.** CIE acceptance MUST evaluate retrieval precision and recall for important constraints, decisions, sibling-branch findings, attached notes, stale knowledge, and explicitly excluded material.

**AW-QVA-067 — Long-history regression set.** Testing MUST include short and very long conversations, old but critical facts, changing decisions, contradictory evidence, and information that becomes relevant again after significant time.

**AW-QVA-068 — Quality-adjusted token savings.** Any claimed token-efficiency improvement MUST report comparable tasks, token deltas, completion/correctness, elapsed time, failure/rework, and uncertainty. Token savings with material quality loss MUST fail acceptance.

**AW-QVA-069 — No fake memory.** The assistant MUST NOT present indexed information as continuously loaded into the model, or claim to recall unavailable evidence. Retrieval gaps and compaction uncertainty MUST be surfaced.

**AW-QVA-070 — Context inspection test.** Users MUST be able to inspect relevant included/omitted application-managed context and checkpoint provenance, respecting backend and privacy limitations.

## 10. Observability, profiler, and timelines

**AW-QVA-071 — Observability truth classes.** Tests MUST verify clear distinction among observed, reported, inferred, and unknown/unavailable activity, including unsupported private reasoning and mock data.

**AW-QVA-072 — Event lifecycle fidelity.** Capture and presentation MUST be reconciled with authoritative source events for starts, deltas, tool executions, file changes, approvals, interruption, reconnect, terminal states, and correlation where available.

**AW-QVA-073 — Loss and disconnect tests.** Event-bus verification MUST cover duplicate, delayed, reordered, dropped, malformed, and disconnected streams; gaps and uncertainty MUST be displayed, not erased.

**AW-QVA-074 — Replay fidelity.** Historical replay MUST reconstruct only captured events, preserve identity/provenance, and mark unobserved periods. Playback animation MUST NOT fabricate actions, timestamps, or missing cognitive steps.

**AW-QVA-075 — Token counter accuracy.** Reported token values MUST be compared with available source telemetry, including caching and model-specific fields where provided. Missing usage MUST remain unknown, not zero.

**AW-QVA-076 — Temporal telemetry integrity.** End-to-end profiling MUST distinguish wall-clock, queuing, time-to-first-output, response streaming, tool time, and other observed intervals. Pre-output latency MUST NOT be called exact internal reasoning time.

**AW-QVA-077 — Budget enforcement truth.** Tests MUST distinguish warnings, soft goals, admission refusal, interruption behavior, and genuinely enforceable limits; the product MUST NOT claim an absolute token cap without proof.

**AW-QVA-078 — Historical versus forecast.** Timeline tests MUST distinguish verified past events from planning estimates and uncertainty bands; live updates MUST not rewrite the historical record.

**AW-QVA-079 — Cross-view consistency.** A canonical event appearing in chat, agent stream, profiler, global timeline, and replay MUST retain compatible identity, outcome, source references, and timing.

## 11. Platform, performance, resource discipline, and displays

Measured targets MUST be selected from research and approved benchmark plans; this charter intentionally does not assume one desktop framework, GPU backend, monitor refresh rate, or universally valid hard-coded FPS number.

**AW-QVA-080 — Benchmark baseline.** Before committing to major platform/rendering technology, representative visual prototypes MUST be compared using equivalent workloads, hardware, driver, display settings, and capture methodology. Tradeoffs MUST be documented.

**AW-QVA-081 — Frame-time distributions.** GPU/UI evaluation MUST capture frame-time percentiles (at least median, p95, and p99 where practical), input latency, dropped frames, responsiveness, and motion stability; an average FPS result is insufficient.

**AW-QVA-082 — Realistic operating modes.** Evaluation MUST cover foreground cinematic, balanced, constrained, minimized/hidden, gaming/background, battery where applicable, and recovery after load subsides.

**AW-QVA-083 — Idle-resource proof.** Minimized or inactive panels MUST demonstrate materially reduced rendering activity and resource use against foreground behavior, without interrupting authorized background tasks.

**AW-QVA-084 — Long-running stability.** Performance qualification MUST include sustained sessions, large conversations, many workspace blocks, multiple streaming agents, retained event history, and suspected memory-leak conditions.

**AW-QVA-085 — Display topology.** Tests MUST cover single/multiple displays, monitor unplug/replug, differing DPI/scaling and refresh rates, window detach/redock, offscreen recovery, and restoration of appropriate layouts.

**AW-QVA-086 — Graceful quality scaling.** Under high load, the app MUST prioritize input responsiveness, essential information, and readability before decorative rendering; quality transitions MUST be coherent and configurable.

**AW-QVA-087 — Target specificity.** Project benchmarks MUST specify hardware tiers and success thresholds before execution. Proposed 60/120-FPS aspirations are not universal acceptance promises until hardware-specific targets are ratified.

**AW-QVA-088 — Resource impact attribution.** CPU, GPU, memory, disk, and energy measurements MUST identify sampling tools, context, workload, and significant other processes where possible. Benchmarks MUST NOT misattribute whole-system resource usage to Aerynth without evidence.

## 12. Security, privacy, accessibility, and resilience

**AW-QVA-089 — High-impact action scenarios.** Mandatory tests MUST include safe handling of destructive file operations, privilege escalation, remote services, deployments, credential exposure, sensitive data access, and approval cancellation.

**AW-QVA-090 — Least privilege verification.** Agent/adapter permission boundaries MUST be tested against attempts to operate beyond assigned directories, workspaces, services, accounts, or command permissions.

**AW-QVA-091 — Prompt and content adversaries.** Untrusted repositories, web content, file contents, chat text, and tool output MUST be tested for instruction injection and boundary crossing; source text is not automatically authority.

**AW-QVA-092 — Audit and rollback.** Consequential mutations MUST produce inspectable evidence, with rollback/undo or explicit safe recovery limits where supported. Test plans MUST cover partial failure during the mutation.

**AW-QVA-093 — Accessibility acceptance.** Representative workflows MUST be tested with keyboard-only interaction, visible focus, legible text scaling, appropriate contrast, meaningful labels, reduced motion, and alternatives to sound/color-only signaling; automated accessibility scans alone are insufficient.

**AW-QVA-094 — Persistence integrity.** Crash, restart, interrupted write, failed migration, stale external reference, and storage limits MUST be evaluated for loss, corruption, silent duplication, and truthful recovery states.

**AW-QVA-095 — Offline and reconnect.** Locally supported notes, layouts, history, and organization MUST remain usable without an available model connection; reconnection MUST recover or clearly explain unresolved remote activity.

**AW-QVA-096 — Data minimization in testing.** Security tests, metrics, captures, and debugging logs MUST not unnecessarily collect or publicly expose private user content; redaction SHOULD preserve diagnostic value without leaking secrets.

## 13. Defects, severity, waivers, and release blockers

The following severity rubric is a common default, not a substitute for the specific subsystem threat model:

| Severity | Meaning | Default disposition |
|---|---|---|
| **S0 — Critical** | Credible security/privacy catastrophe, irreversible broad data loss, uncontrolled high-impact autonomous action | Release blocked; immediate containment |
| **S1 — High** | Essential workflow broken, serious corruption or permission failure, severe accessibility barrier, materially dishonest status | Release blocked pending fix or explicit narrowly justified governance process |
| **S2 — Moderate** | Material feature failure, unreliable operation, major visual/interaction deviation, repeated performance regression | Fix before scoped acceptance or document approved milestone exception |
| **S3 — Minor** | Cosmetic imperfection, low-impact edge case, bounded nuisance with workaround | May be scheduled with tracked owner and rationale |

A visual failure can be S1 or S2 when it defeats a first-class Liquid Intelligence requirement. Severity is based on **user impact**, not whether code compiles.

**AW-QVA-097 — Issue classification.** Defects MUST record severity, scope, reproduction/evidence, impacted requirements, affected builds, owner, state, and disposition.

**AW-QVA-098 — Blocking integrity.** Unresolved S0 conditions and applicable S1 release blockers MUST prevent release acceptance. An agent or reviewer MUST NOT quietly reclassify them to obtain a green status.

**AW-QVA-099 — Waiver governance.** A waiver MUST state exact failing requirement, justification, affected scope, compensating controls, residual risk, approver, expiration/review trigger, and remediation owner. A waiver cannot nullify a higher-priority constitutional or applicable safety obligation.

**AW-QVA-100 — Flaky-test handling.** Flaky, nondeterministic, and intermittently failing checks MUST be tracked with reproduction and remediation. Quarantine MAY be used when appropriately approved but MUST NOT make the failure vanish from acceptance reporting.

**AW-QVA-101 — Risk-based retest.** Fixes for S0/S1 and changes to shared platform, data, security, motion, or context infrastructure MUST trigger targeted regression and relevant wider checks before clearance.

## 14. Continuous integration and review gates

**AW-QVA-102 — Required change checks.** Once CI is established, every substantive pull request MUST run applicable build, type/schema, lint, unit, integration, security, accessibility, or other documented automated checks appropriate to changed areas.

**AW-QVA-103 — Gate selection transparency.** The test selection mechanism MUST declare why checks ran or did not run; missing environment/capability coverage MUST appear as a limitation, not a pass.

**AW-QVA-104 — Review evidence.** Reviewers MUST inspect changed behavior and risk, not merely approve based on AI-generated summaries or green CI. Visual-facing changes require appropriate interactive or captured experience review.

**AW-QVA-105 — Change isolation.** Tests SHOULD run in reproducible isolated environments with safe synthetic fixtures. They MUST NOT corrupt real projects, user files, external accounts, or production services to demonstrate compliance.

**AW-QVA-106 — Protected integration.** Changes MUST preserve unrelated work and follow the branch, review, and integration rules defined under Charter 16. This charter controls quality evidence, not repository permission administration.

**AW-QVA-107 — Version drift detection.** Provider, OS, graphics driver, rendering library, model-capability, and schema changes that affect accepted behavior MUST trigger compatibility checks or an explicitly documented evidence gap.

**AW-QVA-108 — No fake automation.** A planned CI job, disabled test, empty test suite, manually altered status, or unexecuted script MUST NOT be counted as a passing verification gate.

### 14.1 Pull request acceptance checklist

A substantive PR SHOULD record:

- Impacted requirement IDs and why the scope is correct.
- User-visible before/after behavior and representative scenarios.
- Tests actually executed, exact result, and missing coverage.
- Visual interaction review for changes affecting motion, materials, spatial behavior, or accessibility.
- Baseline and comparative performance where relevant.
- Security, permission, data-migration, and rollback impact.
- Backend compatibility assumptions and unknowns.
- Open defects or approved scoped exceptions.
- Evidence links and any needed owner-design review.

This is a **single reusable checklist**; it does not require the reviewer to load every unrelated charter.

## 15. Milestone and release acceptance

**AW-QVA-109 — Explicit milestone contract.** Every milestone MUST state included capabilities, intentionally deferred features, acceptance tests, visual-quality expectations, target environments, evidence artifacts, risk limits, and named accepting authority.

**AW-QVA-110 — Release candidate verification.** A release candidate MUST undergo relevant installation/startup, core-workflow, persistence, upgrade/rollback, security, performance, graphics, accessibility, and integration testing on declared supported configurations.

**AW-QVA-111 — Evidence-backed release notes.** Release notes MUST distinguish working, experimental, limited, partially tested, unavailable, and deferred capabilities. Known critical gaps cannot be concealed behind broad marketing claims.

**AW-QVA-112 — Owner acceptance record.** Milestone/product acceptance MUST record the approving authority, build identifier, acceptance scope, evidence references, outstanding approved limitations, and date. Publication or merge does not substitute for approval.

**AW-QVA-113 — Failed acceptance path.** When a milestone fails, its report MUST identify the unmet criteria, their impact, remediation owner, and next verification action. It MUST NOT relabel the failure as successful simply to keep a schedule.

**AW-QVA-114 — No premature finality.** Research prototypes, simulation environments, mocked agent behavior, and partial platform support MAY be demonstrated, but MUST NOT be presented as the fully realized Aerynth experience.

### 15.1 Definition of Done

A feature is **Accepted** only when all applicable conditions are satisfied:

1. Its objective and affected requirements are identified and traced.
2. The correct implementation exists in the intended integrated build.
3. Applicable behavioral and integration tests pass, with environment evidence.
4. Visual/motion and accessibility review meet the approved target where applicable.
5. Relevant performance and resilience goals are met on declared configurations.
6. Security, permissions, context provenance, and data-integrity concerns are resolved or validly dispositioned.
7. Observability and user-facing statuses truthfully reflect real behavior and gaps.
8. Review findings, blockers, and waivers are resolved or explicitly accepted within authorized bounds.
9. Documentation, migration notes, and relevant acceptance artifacts are up to date.
10. An authorized approver explicitly accepts the feature or milestone scope.

**The feature is not Done merely because an agent reports completion, code was merged, tests passed, or a demonstration looked impressive.**

## 16. Constitutional acceptance suite: C-01 through C-15

These scenario IDs are defined in Section 21 of the Constitution. This charter specifies how they should be verified without rewriting their governing intent.

| Constitutional test | Minimum end-to-end acceptance demonstration | Core quality risks |
|---|---|---|
| **C-01 Ordinary chat** | Create, stream, resume, and find a chat without project or task setup; review long-history behavior | Chat freedom, latency, persistence |
| **C-02 Contextual scope** | Select one file, request all files from its folder, preview the expanded target, then separately request only the selected file | Intent, ambiguity, authorization |
| **C-03 Organization** | Display one resource in two workspaces, mutate it once, restore layouts, and confirm canonical identity | Duplication, data loss |
| **C-04 Motion** | Transform the same block between dashboard, full view, and supported layout; interrupt animation; inspect reduced-motion path | Continuity, physics, accessibility |
| **C-05 Meaningful activity** | Start a real Codex operation; verify visual status from source events; switch to labeled simulator and ensure no confusion | Fake progress, event accuracy |
| **C-06 Agent completion** | Execute an assignment with partial/failed tests and prove its status remains distinct from verified outcome | False completion |
| **C-07 Branch intelligence** | Fork, add evidence only in sibling B, bring a cited finding into A, continue A without rewriting either history | Provenance, memory boundaries |
| **C-08 Memory integrity** | Compact long context, restore old critical decision via source reference, detect missing evidence | Silent history loss |
| **C-09 Quick Capture** | Capture a note offline without waiting for AI; restart; search and recover it | Durability, input speed |
| **C-10 Observability honesty** | Compare actual command, model summary, inferred assessment, and unavailable reasoning in every stream view | Misrepresentation |
| **C-11 Usage telemetry** | Match available backend usage to displayed counters; remove a field and verify it shows unknown, not zero | Measurement integrity |
| **C-12 Adaptive preferences** | Offer learned layout suggestion, reject it, inspect the reason, revert later change, and disable adaptation | Hidden behavior |
| **C-13 Resource discipline** | Measure cinematic, gaming, idle, and minimized modes on same workload; prove scaling and legibility | GPU contention |
| **C-14 Multi-display** | Move a block to second monitor, disconnect, recover on first, reconnect, restore layout without lost state | Offscreen content, persistence |
| **C-15 Autonomy** | Request high-impact change, inspect scope and required approval, deny, verify no mutation; authorize and audit a safe fixture | Uncontrolled actions |

**AW-QVA-115 — Constitutional suite ownership.** Applicable C-01–C-15 scenarios MUST remain included in acceptance planning, and their execution evidence MUST be linked to the accepted build/milestone. Deferred tests MUST identify the missing capability rather than showing false passing status.

**AW-QVA-116 — Negative and adversarial variants.** Each applicable constitutional scenario SHOULD include at least one plausible misuse, interruption, or failure condition relevant to its risk, rather than only a polished happy-path demonstration.

## 17. Benchmark governance and provisional target design

The exact numerical targets belong in approved test plans after measurements and hardware research. The following are **required measurement categories**, not invented current performance claims:

| Area | Measurement or acceptance method |
|---|---|
| Interaction | Pointer-to-feedback latency, keyboard-to-result latency, command palette activation, tap/drag responsiveness |
| Motion | Frame-time distribution, dropped-frame bursts, interrupted transitions, continuity inspection |
| Graphics | CPU/GPU utilization, GPU memory, effects cost, quality-tier comparison, thermals where available |
| Startup | Cold start, warm start, restored workspace, usable interaction time |
| Conversation | Time to visible chat, virtualization under long histories, stream-render cadence, memory footprint |
| Agent execution | Source timestamps, queue/tool/stream durations, cross-agent overhead and result evidence |
| CIE | Retrieval precision/recall, source recovery, context savings, correctness/rework tradeoffs |
| Notes | Capture durability, reopen success, authorized retrieval fidelity |
| Displays | Topology switches, DPI transitions, detached window recoverability |
| Reliability | Crash/restart survival, persistent store correctness, recovery duration |
| Accessibility | Keyboard completion, contrast checks, focus visibility, reduced-motion task parity |

**AW-QVA-117 — Predeclared measurement plan.** Acceptance benchmarks MUST be specified before judging a candidate result, including warm-up, repeats, capture tool, environment, outlier treatment, baseline, and thresholds.

**AW-QVA-118 — Anti-cherry-picking.** Performance claims MUST not rely solely on best-case screenshots, one lucky run, a single average, an idle-only measurement for a high-load claim, or simulated agent work to characterize production throughput.

**AW-QVA-119 — Hardware-aware targets.** Targets MAY vary by supported hardware tier or mode but MUST be declared, repeatable, and reported with their environment. Failure against a supported tier cannot be hidden by a better result on faster hardware.

**AW-QVA-120 — Balanced optimization.** Optimization MUST consider correctness, fidelity, legibility, resource use, and responsiveness together; a rendering reduction that makes the app unreadable is not a successful optimization.

## 18. Review cadence, ownership, and change control

**AW-QVA-121 — Quality owner map.** Each significant feature/milestone SHOULD name functional, experience, performance, security/data, and release reviewers as appropriate; one person MAY hold multiple roles where risk permits.

**AW-QVA-122 — Evidence freshness.** Acceptance evidence MUST apply to the actual candidate build. Significant changes after a passing check require targeted revalidation rather than citing stale results.

**AW-QVA-123 — Requirement changes.** Changes to this charter MUST use explicit versioning, documented rationale, dependency impact review, and governance-registry updates. Existing requirement IDs MUST NOT be silently repurposed.

**AW-QVA-124 — Open decisions remain open.** This charter does not choose a desktop shell, graphics API, animation library, testing runner, exact resource budgets, commercial distribution model, or fixed release date. Those require documented technical evaluation and owner-authorized decisions.

**AW-QVA-125 — Continuous improvement evidence.** Repeated failures, usability feedback, profile regressions, and missed incidents SHOULD produce root-cause investigation, updated acceptance scenarios, or documented decisions, not merely one-off patches.

### 18.1 Minimum role responsibilities

- **Implementer:** Build, self-test, expose limitations, provide evidence, preserve unrelated work.
- **Independent reviewer:** Challenge assumptions, test negative cases, inspect correctness and evidence completeness.
- **Experience reviewer:** Evaluate motion, material quality, accessibility, interaction clarity, and cinematic coherence on real UI.
- **Security/data reviewer:** Inspect privileges, privacy, context integrity, recovery, and attack surfaces according to risk.
- **Release/owner approver:** Resolve remaining acceptance decisions and explicitly record the accepted scope.

Automated agents MAY perform supported roles, but an agent's own successful execution report is not an independent acceptance authority.

## 19. Required design-first pilot and first integration proof

The earliest engineering milestones SHOULD prioritize a functioning Liquid Intelligence experience while validating real Codex event plumbing before large-scale backend expansion.

The initial visual pilot MUST demonstrate, within its explicitly declared scope:

1. A distinctive coherent home environment with real layered materials and atmospheric effects.
2. A central Vela presence with distinguishable idle, working, attention-needed, and unavailable states.
3. An interactive workspace with resource blocks, meaningful drag/rearrangement, focus, and state restoration.
4. At least one continuous resource transformation, evaluated for motion physics and interrupted transitions.
5. Contextual selection/command interaction with a safe, inspectable example.
6. A genuine Codex App Server conversation or equivalent supported real execution integration with verifiable streamed events, distinctly separated from simulations.
7. An observability view that does not fake private reasoning or completion progress.
8. Frame-time and resource-impact capture on the declared target hardware.
9. Reduced-motion and keyboard paths for the demonstrated interaction.
10. A concise list of what remains prototype-only, mocked, unsupported, or unverified.

**AW-QVA-126 — Experience first, reality early.** Early prototypes MUST validate cinematic experience **and** a minimal end-to-end genuine agent integration, rather than using an indefinitely simulated AI backend or shipping a generic interface with late decorative polish.

**AW-QVA-127 — Pilot is not product acceptance.** A passing pilot proves feasibility of its scoped assertions only. It does not establish completeness of the project, all integrations, full autonomy, long-history reliability, or production readiness.

## 20. Governance ownership, cross-references, and publication

This charter owns **how verification and acceptance work**; it does not redefine the requirements belonging to subsystem charters. Domain-specific tests may be stricter and should be linked through stable requirement IDs.

| Source | Primary ownership | Quality charter coordination |
|---|---|---|
| 00 Constitution | Product identity and universal invariants | C-01–C-15 suite and cross-cutting gates |
| 01 Experience | Contextual Command, navigation, attention, UX | Behavior scenarios, comprehension and interaction review |
| 02 Liquid Intelligence | Motion, material language, cinematic visual specifications | Motion rubric, benchmark and visual acceptance |
| 03 Resources | Identities, project/workspace/block model | Persistence, reference, layout, undo tests |
| 04 Conversations | Chats, forked branches, history | Chat/branch integrity, retrieval, scaling tests |
| 05 Agents | Task/agent identity, delegation and execution | Outcomes, handoffs, isolation, status tests |
| 06 Vela | Initiative, adaptation, contextual presence | Notification and autonomy behavior evaluations |
| 07 Knowledge | Notes, Thought Stream, knowledge provenance | Capture, authority, retrieval and preservation |
| 08 CIE | Context relevance, memory, compaction | Quality-adjusted retrieval and context savings |
| 09 Observability | Event schema, capture, truth classes | Event reconciliation, partial capture, replay fidelity |
| 10 Profiler | Timings, tokens, budget semantics | Source counter reconciliation and timing accuracy |
| 11 Timelines | Historical/forecast distinctions, replay views | Temporal confidence and cross-view consistency |
| 12 Integrations | Codex, models, tools and adapters | Provider contracts and capability coverage |
| 13 Platform | Runtime, graphics, resource use, displays | Hardware benchmarks and state restoration |
| 14 Trust | Permissions, privacy, autonomy, audit | Security/adversarial and safe recovery gates |
| 16 Delivery | Workflow, release engineering and process | Required evidence and acceptance decisions |

### 20.1 Publication and ratification

This document is **published for repository-owner review**, not automatically accepted as governing law. When accepted, the governance index MUST be updated with its approved version, and dependent specifications and tests SHOULD reference its stable AW-QVA IDs. Until related charters are published, Constitution requirements govern their domains.

Changes to thresholds, visual acceptance standards, model/provider support expectations, or release gates MUST be justified against actual evidence and the Constitution. Lowering a target to match an underperforming implementation is not by itself a valid reason to redefine the intended product.

---

## Closing acceptance doctrine

Aerynth's defining promise is not that it can display code, launch agents, produce particles, collect tokens, or render gorgeous dashboards. It is that these capabilities work **together** to reduce cognitive load and make intelligent work **fluid, trustworthy, comprehensible, fast, recoverable, and genuinely enjoyable**.

**Quality is not a final test pass after functionality is built. It is the standard applied continuously to the experience being created.**

**The feature exists.** That is implementation.

**The feature demonstrably works.** That is verification.

**The feature meets the intended cinematic, functional, safety, accessibility, performance, and product standard.** That is acceptance.

---

## Proposed amendment CF-2026-11-05: acceptance of complete capabilities

> **Status: proposed, pending owner acceptance.** This supplements existing visual, functional, performance and security acceptance; none are waived.

**AW-QVA-128 — Capability-first definition of done.** Every claimed capability MUST be tested for complete intended user outcome, truthful status, permissions, integration, error recovery and evidence, rather than judged only by output text, UI appearance or successful API invocation.

**AW-QVA-129 — Separate evidence tiers.** Documentation, static code inspection, mock/unit test, integration test, native live test, visual/human acceptance and production verification MUST be labeled separately. A lower tier MUST NOT imply a higher acceptance state.

**AW-QVA-130 — Real composite journeys.** The program MUST maintain end-to-end scenarios combining Vela intent, route selection, native/provider tools, task state, memory, permissions, rendering and actual postcondition readback.

**AW-QVA-131 — Model/provider matrix.** Each planned provider route MUST be qualified under real connection, correct entitlements, supported model/effort, tool availability, user pins, region/data-class restriction, error/timeout, rate/credit exhaustion and live-versus-estimated usage.

**AW-QVA-132 — Agent outcome and contention.** Parallel, delegated and persistent agent scenarios MUST verify real overlapping progress where claimed, correct resource isolation, trustworthy completion receipts, cancellation/restart reconciliation and absence of duplicate side effects.

**AW-QVA-133 — Voice is an audible product.** Voice acceptance MUST include real microphone and speaker behavior, consent, interruptions, delegation, backlog/replay fences, accent/pacing consistency and a human-observed output path on supported hardware.

**AW-QVA-134 — GPU Mind is an actual GPU scene.** A claimed 3D Vela Mind MUST have real GPU rendering evidence, volumetric/depth geometry, camera parallax, light/flow animation, response to real events, accessibility/performance behavior and no fake reasoning representation. A shader on a flat card is insufficient.

**AW-QVA-135 — Spatial continuity.** The primary workspace/constellation/destination transitions MUST preserve canonical objects, ongoing work, focus/context, geometry and navigation without disconnected screen resets.

**AW-QVA-136 — Negative and adversarial evidence.** Tests MUST include stale tools, prompt injection, provider loss, invalid credentials, model/tool mismatch, unsafe permissions, partial response/tool arguments, network drop, resource conflicts, quota exhaustion and corrupt/incomplete events.

**AW-QVA-137 — Model quality over benchmark vanity.** Optimization claims MUST include representative task success, quality regressions, p50/p95 latency, cost provenance, actual CPU/GPU/RAM burden, human interaction friction and accessibility. Reduced token cost alone cannot justify reduced capability.

**AW-QVA-138 — Provenance of cost and time.** Usage, credits, execution latency and workload metrics MUST identify provider-reported versus estimated versus missing evidence, with signed-in Codex and API charges treated separately.

**AW-QVA-139 — Public repository redaction.** Verification artifacts MUST avoid sensitive conversations, credentials, private file paths, identifiable local telemetry and secret provider/account data.

**AW-QVA-140 — Honest milestone reporting.** A published charter, API feature, test stub, or experimental demo MUST remain unqualified for release until the required task and product acceptance evidence exists.

**Canonical acceptance catalog:** [CF-001 through CF-030](../docs/specifications/VELA-CAPABILITY-FIRST-ACCEPTANCE-MATRIX.md). Reviewers MUST reconcile each claimed release capability with this catalog and the existing charter gates rather than treating the catalog as a replacement for them.

