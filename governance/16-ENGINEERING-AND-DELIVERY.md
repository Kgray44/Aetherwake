# 16 — Engineering and Delivery
## Engineering Lifecycle, Research, Integration, and Release Governance for Project Aetherwake

> **Owner acceptance (2026-11-05):** This charter and both relevant design amendments are approved as binding product standards; no implementation, security, benchmark or release certification is implied.

| Field | Value |
|---|---|
| Document ID | AW-GOV-016 |
| Version | 1.2.0 — owner-directed clarification 2026-11-05 |
| Status | **Owner-accepted and ratified governing charter; implementation verification separate** |
| Prepared | 2026-11-01 |
| Authority | Subsystem charter subordinate to [00 — The Aetherwake Constitution](00-AETHERWAKE-CONSTITUTION.md) |
| Primary domain | Engineering process, research and architecture decisions, implementation planning, agent contribution, integration, evidence, delivery, release, and change control |
| Normative requirement namespace | **AW-ENG-###** |
| Constitutional anchors | AW-CON-001–010, 016–021, 036–041, 057–061, 069–079, 080–091 |
| Adjacent charters | 01 Experience; 02 Liquid Intelligence and Motion; [03 Projects and Resources](03-PROJECTS-WORKSPACES-AND-RESOURCES.md); [04 Conversations](04-CONVERSATIONS-AND-CONNECTED-BRANCHES.md); 05 Agents and Workflows; [06 Vela](06-VELA-INTELLIGENCE-AND-ADAPTATION.md); [07 Notes](07-NOTES-KNOWLEDGE-AND-THOUGHT-STREAM.md); [08 CIE](08-CONTEXT-INTELLIGENCE-AND-MEMORY.md); [09 Observability](09-INTELLIGENCE-STREAMS-AND-OBSERVABILITY.md); [10 Profiler](10-AI-EXECUTION-PROFILER.md); [11 Timelines](11-TIMELINES-AND-REPLAY.md); [12 Codex](12-CODEX-EXECUTION-AND-INTEGRATIONS.md); 13 Platform; 14 Trust; 15 Quality |
| Intended readers | Repository owner, contributors, designers, maintainers, coding agents, reviewers, release engineers, and engineering-orchestration systems |
| Publication boundary | Product process only; no private chats, personally identifying operational records, access tokens, secrets, or customer/user data in this public repository |

> **Engineering promise.** Aetherwake MUST be built with the same care as the experience it promises: researched before irreversible commitments, prototyped before overengineering, implemented in vertical slices, independently verified, visually evaluated, responsibly integrated, and delivered with truthful evidence.
>
> **Design is not a garnish.** A working backend behind a generic dashboard is not completion of Aerynth. Liquid Intelligence, the six-domain Motion Coordinator, clarity, responsiveness, accessible controls, and system-resource discipline are product requirements from the beginning.
>
> **Work, not theater.** Plans, checklists, analysis, and documentation are valuable only insofar as they help deliver verified improvements. An agent that prepared a safe operation has not implemented it; an agent that wrote code has not necessarily tested it; a green test is not proof that the cinematic experience is correct.

---

## 1. Authority, purpose, scope, and interpretation

This charter is the **canonical governing home for how Project Aetherwake is researched, implemented, integrated, validated in the delivery workflow, documented, and released**. It governs engineering discipline, work readiness, ownership, integration evidence, release processes, technical decision records, and change management. It does **not** replace the actual product-behavior requirements in other charters.

The Constitution has priority over this charter. Accepted domain charters control requirements in their respective domains. The repository owner retains final acceptance authority. **MUST** is binding; **MUST NOT** is prohibited; **SHOULD** establishes a strong default requiring an explained exception; and **MAY** is optional, as defined by the Constitution. Publication is not owner ratification.

**In scope:** planning and execution cadence; research spikes; architectural decision records (ADRs); technology evaluation; definition of ready and done; work decomposition; human/AI collaboration; parallelism and worktree discipline; Git, pull requests, and integration; CI and tests as delivery gates; visual reviews; performance evidence; documentation, provenance, and traceability; migrations; releases; operational readiness; reversible rollout; deprecation and retirement; status reporting; engineering metrics; exception management; and acceptance scenarios.

**Owned by other charters:** 01 owns user interaction; 02 owns visual language and motion behavior; 03 owns project/workspace/resource identities; 04 owns chat and connected-branch behavior; 05 owns agent/task orchestration product semantics; 06 owns Vela and adaptation; 07 owns notes and knowledge semantics; 08 owns CIE and compaction; 09 owns Intelligence Streams and event truth; 10 owns token/profiler semantics; 11 owns timeline/replay behavior; 12 owns provider interfaces; 13 owns platform performance requirements; 14 owns security/privacy/autonomy policy; 15 owns testing taxonomy and the ultimate quality acceptance model. This charter owns **the delivery process that applies and proves those requirements**, not their independent redefinition.

**AW-ENG-001 — Respect authority.** Contributors and agents MUST review applicable constitutional and domain requirements before making decisions, and MUST NOT reinterpret an implementation plan, issue, chat message, or agent prompt as an implicit governance amendment.

**AW-ENG-002 — One canonical rule.** Process requirements introduced in this charter MUST use stable AW-ENG identifiers. Cross-charter rules MUST be linked by reference rather than rewritten as competing normative obligations.

**AW-ENG-003 — Honest publication state.** A draft, experimental prototype, design mock, unmerged implementation, and accepted product capability MUST be distinguishable in both documentation and reporting. Publishing this charter alone does not ratify it.

**AW-ENG-004 — Prefer demonstrated user value.** The engineering process MUST prioritize tested, observable user outcomes rather than quantity of generated code, volume of planning, number of agents, or elapsed activity.

## 2. Governance routing and the contributor entrypoint

The repository MUST maintain a concise path from a task to the documents that actually govern it. At minimum this includes the Constitution, the relevant accepted domain charters, specific approved interface contracts, and the work package's acceptance criteria. Future root AGENTS.md and governance indexes should implement this routing without dumping the entire corpus into every agent session.

An absent or unratified neighboring charter is **not** permission to invent rules in its domain. Work may continue with explicitly provisional assumptions only when it cannot violate established requirements and when the risk is documented.

**AW-ENG-005 — Scope-aware reading.** A work package MUST identify applicable governance and authoritative technical decisions. Routine agents SHOULD read only the relevant portions needed to complete the assignment, with ability to retrieve more when a boundary is encountered.

**AW-ENG-006 — Conflict escalation.** If an issue, prototype, implementation choice, or conflicting document violates higher authority, the contributor MUST record the conflict and stop at the affected decision boundary. Unrelated safe work MAY continue.

**AW-ENG-007 — Missing charter discipline.** For planned but unpublished or unaccepted charters, implementers MUST mark affected decisions provisional and MUST NOT claim full governance compliance merely because the charter has not yet been ratified.

**AW-ENG-008 — Public-information hygiene.** Before GitHub publication, contributors MUST screen commits, examples, outputs, screenshots, and generated artifacts for credentials, private conversations, private notes, precise personal data, nonpublic operations, and sensitive telemetry. Synthetic examples SHOULD be used in governance and public documentation.

**AW-ENG-009 — Requirement provenance.** Every material implementation decision SHOULD be traceable to a governing requirement, accepted ADR, user-approved change, or clearly marked hypothesis. Agents MUST NOT fabricate citations, approvals, or test evidence.

## 3. Engineering principles and nonnegotiable invariants

Engineering is iterative, research-led where uncertainty matters, and demonstrative in its acceptance. Product behaviors are not validated solely by code existing or a scripted path passing.

- **Experience-first:** Visual and interaction architecture shape foundational technical choices.
- **Real integration early:** No purely cinematic mockup may substitute for validating an actual Codex execution path.
- **Vertical slices:** Deliver usable paths through UI, data model, backend, permissions, persistence, observability, and testing before broadening horizontally.
- **Local-first where viable:** Organization, saved layouts, notes, and historical inspection should degrade gracefully when AI services are unavailable, subject to the owning charters.
- **Truthful observability:** Simulated data remains labeled simulation; actual agent or model thought visibility must respect provider boundaries.
- **Incremental reversibility:** Every high-risk change should have a credible restoration or rollback strategy.
- **Safe concurrency:** Parallel work must be isolated from shared mutable resources.
- **Measurable progress:** Status and claims depend on evidence of functioning outcomes.

**AW-ENG-010 — No facade substitution.** A polished interface that merely imitates chat, agents, token telemetry, or task completion MUST NOT be declared functional without a verified backend and actual source events; equally, a working backend MUST NOT be declared visually accepted without experience verification.

**AW-ENG-011 — Persistent data protection.** Engineering tasks MUST preserve unrelated user resources, conversation history, notes, local settings, and other persistent data. Destructive migrations or bulk edits require authorization, backups or reversible staging as appropriate, and restoration evidence.

**AW-ENG-012 — End-to-end ownership.** A feature owner MUST account for its visible behavior, underlying service behavior, error states, permission boundaries, observability, persistence, and verification. Handoffs MUST name the remaining owner of unfinished obligations.

**AW-ENG-013 — Independence of capability and presentation.** Application domain state and authorized actions MUST NOT exist only as animations or transient frontend state; the presentation SHOULD remain replaceable without loss of canonical resource identity.

**AW-ENG-014 — Preserve optional simplicity.** Engineering work MUST NOT make a simple chat, note, file view, or direct navigation depend on formal task creation, an agent hierarchy, or a lengthy setup ceremony.

## 4. Research-first decision making

Some choices are expensive to reverse: desktop shell, compositing architecture, GPU rendering APIs, multi-window transport, primary persistence model, agent protocol coupling, and security boundaries. These require comparative research. Small reversible choices may use a lightweight documented rationale.

Research MUST answer a question and converge toward a decision, not expand indefinitely. Benchmarking without criteria, dates, and an outcome is not delivery.

### 4.1 Decision classification

| Class | Examples | Required handling |
|---|---|---|
| **Foundational** | Tauri vs Electron, rendering pipeline, native service model, database ownership, provider abstraction | Comparative spike, representative prototype, written ADR, owner acceptance |
| **Cross-cutting** | Event envelope, block lifecycle, permissions boundary, context-handoff format | Interface contract, compatibility review, tests, documented approval |
| **Local reversible** | Nonessential component choice, local refactor, naming in isolated module | Task rationale, tests appropriate to scope, review |
| **Experimental** | Novel shader, model-assisted indexing strategy, preview capability | Labeled hypothesis, bounded spike, exit criteria, no parity claims |

**AW-ENG-015 — Research gate.** Foundational technical choices MUST NOT be finalized before an evidence-based comparative evaluation identifies requirements, alternatives, representative workloads, risks, tradeoffs, and a rollback or migration path.

**AW-ENG-016 — Fair comparison.** Framework and renderer comparisons MUST use equivalent functional demos, target hardware/OS conditions, measurement methodology, and representative Liquid Intelligence interactions; cherry-picked screenshots or synthetic peak FPS alone are insufficient.

**AW-ENG-017 — Decision record.** Every accepted foundational choice MUST have an ADR with status, owners, date, decision drivers, alternatives, evidence, risks, consequences, rejected options, and review triggers.

**AW-ENG-018 — Research timebox.** Research spikes MUST state the decision they unlock, planned experiments, expected deliverable, and stopping rule. An inconclusive spike MUST record what remains unknown rather than claiming proof.

**AW-ENG-019 — Avoid premature lock-in.** Until accepted by evidence and owner approval, references to Tauri, Electron, React, WebGL, WebGPU, Three.js, SQLite, or any other technology MUST be treated as candidates or prototypes, not constitutional mandates.

**AW-ENG-020 — Revalidation trigger.** Accepted ADRs MUST be revisited when platform support changes, benchmarks contradict assumptions, user needs materially shift, security posture changes, or architectural debt becomes disproportionate.

### 4.2 Minimum ADR template

~~~markdown
# ADR-NNN: Concise decision title
Status: Proposed | Accepted | Superseded | Rejected
Owner and reviewers:
Date and related work:
Decision question:
Applicable governance:
User experience and functional constraints:
Alternatives considered:
Evidence and representative benchmarks:
Security, privacy, accessibility, and resource effects:
Decision and rationale:
Known limitations and risks:
Consequences and migration/rollback:
Validation plan and review trigger:
~~~

The ADR is an implementation decision record, subordinate to governance. An accepted ADR MUST NOT quietly amend a charter.

## 5. Development sequence and vertical-slice milestones

The release plan should remain adaptable, but the initial program MUST protect the visual-first direction. The following is a **recommended sequencing framework**, not a promise of dates or an assertion that milestones are already complete.

| Milestone | Core outcome | Minimum demonstration |
|---|---|---|
| **M0 — Foundations** | Governance map, repo conventions, objective inventory, design references | Requirements identified; open technical decisions visible |
| **M1 — Visual Experience Lab** | Real-time Liquid Intelligence prototype and six-motion architecture | Interactive Vela presence, layered material system, meaningful particles, blocks, transitions, measured frame times |
| **M2 — Real Codex Bridge** | Thin, real App Server adapter | Authenticated supported flow, real thread, streamed event, approval/cancel path, failure recovery; mocks clearly separated |
| **M3 — Workspace Kernel** | Persistent projects, resources, notes, layouts, conversations | Real create, move, reopen, recover, context-select flows without duplication |
| **M4 — Vela Interaction** | Contextual Command and native action interface | Selecting content, correct scope resolution, preview/undo where applicable, chat and quick capture |
| **M5 — Agent Operations** | Tasks, execution state, worktrees, delegation, streams | Real agent lifecycle, completion evidence, coherent multi-agent supervision |
| **M6 — Context and Memory** | CIE, knowledge retrieval, connected-branch handoffs, profiler | Integrity and retrieval regression tests, meaningful token and latency measurements |
| **M7 — Proactive Intelligence** | Initiative, adaptation, scheduling, monitoring | Bounded policies, attention control, auditability, user override |
| **M8 — Hardening and Release** | Multi-display, accessibility, security, release management | Complete applicable gates with reproducible signed or integrity-checked deliverables |

Milestones MAY overlap. A limited visual prototype MAY use simulated agent events, but MUST label them. A thin real Codex integration should be validated early enough to expose platform integration constraints before large-scale UI architecture hardens.

**AW-ENG-021 — Visual-first gate.** The first major experience milestone MUST demonstrate a credible, interactive Liquid Intelligence environment rather than an unrelated generic component library. Later function delivery MUST preserve that design foundation.

**AW-ENG-022 — Real backend proof.** A real provider integration spike MUST verify supported Codex threading, streaming, cancellation, permissions, and error behavior before core execution architecture is declared viable.

**AW-ENG-023 — Slice completeness.** A vertical slice is complete only when its intended happy path, important failure paths, permissions, resource behavior, user feedback, and appropriate verification evidence can be demonstrated end-to-end.

**AW-ENG-024 — No schedule theater.** Planning MUST distinguish estimated completion windows from commitments and actual measured progress. Forecasts MUST express material uncertainty and dependencies.

**AW-ENG-025 — Keep ordinary chat first-class.** Each relevant release milestone MUST preserve simple, direct chat usage; more elaborate agent or workflow abstractions MUST remain optional.

**AW-ENG-026 — Prevent mock leakage.** Prototype-only data, fake agents, simulated token counts, and cinematic placeholder activity MUST NOT be represented as production live state or silently carried into product builds.

## 6. Work packages, definition of ready, and assignment

A work package is an independently understandable unit of deliverable work. It should be narrow enough for an accountable agent or contributor to implement and verify, but large enough to yield user-visible or architecturally demonstrable progress.

### 6.1 Required work-package contract

A substantive work item SHOULD identify:

1. **Objective:** The user outcome and affected subsystem.
2. **Applicable governance:** Constitutional anchors and charter requirement IDs.
3. **Scope and exclusions:** Files, features, resources, and operations in/out.
4. **Dependencies:** Interfaces, prerequisite tasks, pending ADRs, environment setup.
5. **Execution environment:** Repo/branch/worktree, runtime, external services, simulated or real data.
6. **Permissions:** Allowed tools and mutations, explicit approval boundaries.
7. **Deliverables:** Code, tests, demo, documentation, migration, and review.
8. **Acceptance:** Observable scenarios and evidence, including motion where applicable.
9. **Risks and rollback:** Shared state, destructive operations, and fallback.
10. **Completion report:** Changed artifacts, results, open concerns, exact status.

**AW-ENG-027 — Definition of ready.** Work involving consequential changes MUST NOT begin implementation until its intended outcome, scope, applicable authority, dependencies, and verification route are understood. Uncertainty SHOULD be reduced with a bounded spike rather than unstructured speculation.

**AW-ENG-028 — Clear assignments.** AI agent tasks MUST have a specific responsibility and measurable deliverable. Instructions such as “make it better” require decomposition or an explicit exploratory scope before claiming implementation progress.

**AW-ENG-029 — Evidence included.** A work package MUST identify what evidence demonstrates completion before a contributor reports it done; tests added after an unsupported completion claim do not retroactively validate that claim.

**AW-ENG-030 — Useful granularity.** A task SHOULD produce a testable slice or authoritative decision. Avoid both giant cross-system instructions without clear boundaries and tiny chores that create integration overhead greater than their value.

**AW-ENG-031 — Dependency truth.** Blocked work MUST identify the actual blocker, its owner, and a next action. “Waiting for integration” without evidence of an implemented deliverable is not a completed state.

## 7. Human–agent cooperation and orchestration discipline

AI contributions are welcome throughout design, coding, testing, documentation, and analysis. They require the same traceability and critical review as human contributions. Aerynth's product orchestration is governed by Charter 05; this section governs **how agents are used to build Aetherwake itself**.

**AW-ENG-032 — Agent accountability.** Every agent-assigned work package MUST have an accountable owner or supervising process responsible for reviewing output, integration readiness, and outstanding risk.

**AW-ENG-033 — Preserve neighboring work.** Agents MUST inspect their target checkout and existing uncommitted work before editing, MUST avoid overwriting unrelated changes, and MUST NOT reset, clean, delete, or force-push another worker's state without authorization.

**AW-ENG-034 — Parallelism by isolation.** Concurrent implementation tasks SHOULD use independent Git branches/worktrees and clear interface contracts. Shared configuration, generated data, databases, deployment infrastructure, and live services require an explicit coordination protocol.

**AW-ENG-035 — Parallelism by value.** Orchestration SHOULD select parallelism based on independent work, integration cost, throughput, resource limits, and review capacity, not maximum agent count.

**AW-ENG-036 — No unearned claims.** Agents MUST distinguish code written, tests actually run, test results, review completed, integration completed, runtime behavior observed, and owner acceptance. They MUST NOT claim unavailable command output, tool execution, real model reasoning, or approval.

**AW-ENG-037 — Escalate rather than conceal.** When blocked by a dependency, missing permission, tool limitation, governance conflict, unexpected risk, or insufficient evidence, an agent MUST report the condition and stop at that boundary while allowing unrelated safe progress.

**AW-ENG-038 — Handoff package.** A handoff MUST provide objective, current state, relevant source refs, changed files, environment, tested commands/results, remaining work, risks, and precise next step. It SHOULD be concise and retrieve detailed sources on demand.

**AW-ENG-039 — Work conservation.** A replacement agent SHOULD resume from durable evidence and prior deliverables instead of redoing all research; handoff summaries MUST NOT become a substitute for evidence when accuracy matters.

**AW-ENG-040 — Human authority.** Agents MUST NOT self-grant repository, production, financial, data-export, or other high-impact permissions; approvals and governance ratification remain governed by the authorized user and policy system.

## 8. Repository, branch, worktree, and source-control practice

Source control should support fast safe iteration without harming work in progress. Project policy MAY evolve, but it must be explicit, documented, and reviewable.

**AW-ENG-041 — Stable primary branch.** The primary integration branch MUST be treated as a stable record of reviewed work. Work requiring substantial review SHOULD be performed on feature branches or worktrees with a defined integration path.

**AW-ENG-042 — Conflict-aware integration.** A change MUST be integrated against a known current base, with conflict resolution inspected rather than accepted blindly. Tests MUST be rerun when the integrated result materially differs from what was verified.

**AW-ENG-043 — Clean provenance.** Commits SHOULD be focused, comprehensible, and attributable to a work package or rationale. Generated changes MUST be reviewable and must not hide unrelated formatting churn.

**AW-ENG-044 — Protect history.** Force-pushes, destructive resets, branch cleanup, repository rewrites, and worktree removal MUST respect ownership, authorized scope, and preservation policies. Existence of an “unused” branch is not proof it is disposable.

**AW-ENG-045 — Generated and external artifacts.** Large binaries, caches, machine-specific secrets, live conversation exports, credentials, and generated build artifacts SHOULD NOT be committed to source history unless a documented need and approved storage strategy exists.

**AW-ENG-046 — Pull-request evidence.** Material pull requests SHOULD explain intent, governance references, implemented behavior, tests, visual evidence where relevant, known limitations, migration impacts, and rollback. Reviewers MUST be able to distinguish working changes from unverified claims.

**AW-ENG-047 — Integration authority.** Merge, deployment, release, and deletion authority MUST be explicitly assigned. An agent completing a task does not automatically earn permission to merge, release, or alter a protected environment.

### 8.1 Example branch and artifact naming

Conventions SHOULD favor discoverability over rigid ceremony, for example:

~~~text
feature/motion-coordinator-spatial
spike/renderer-comparison
fix/chat-resume-event-gap
docs/adr-window-compositor
docs/acceptance-intelligence-stream
~~~

These are suggestions, not a mandated tooling choice. Worktrees must not silently share mutable build or runtime state that defeats their Git isolation.

## 9. Interface contracts, architecture boundaries, and change compatibility

Aetherwake has several interacting subsystems. Interface boundaries must be designed so a change to Codex protocol handling, UI rendering, memory management, or windowing does not require rewrites of unrelated systems.

**AW-ENG-048 — Contract-first integration.** Cross-subsystem features MUST establish typed interfaces for identity, events, state ownership, errors, permissions, and version compatibility before multiple contributors implement dependent sides independently.

**AW-ENG-049 — One owner of canonical state.** Each persistent object and execution state MUST have a documented authoritative owner; derived UI caches and visual projections must not become competing sources of truth.

**AW-ENG-050 — Backend adapter seam.** Provider-specific Codex protocol details MUST remain behind a maintained adapter boundary. Capability discovery, compatibility checks, failures, and unavailable operations MUST propagate honestly to callers.

**AW-ENG-051 — Schema evolution.** Persistent formats and event contracts MUST declare versioning and a compatibility/migration strategy. Unknown fields or older records SHOULD be handled gracefully when feasible.

**AW-ENG-052 — Recovery-aware design.** Important mutations SHOULD be transactional, idempotent, or compensatable as appropriate. Partial failure MUST not quietly leave resources, task status, or approvals falsely marked complete.

**AW-ENG-053 — Observable contracts.** Execution and orchestration events MUST carry enough source identity and correlation information for applicable observability, profiling, and timeline consumers to connect actual operations without fabricating causality.

**AW-ENG-054 — Test fakes against contracts.** Simulated execution providers and fixture event streams SHOULD conform to the same typed contracts as real adapters while remaining visibly labeled in user-facing builds.

## 10. Verification in the delivery workflow

Charter 15 owns the quality model and complete acceptance taxonomy. This charter requires that those quality obligations be integrated into actual engineering gates. Different changes need different tests; not every patch requires every test suite.

### 10.1 Verification layers

| Layer | Evidence examples | Typical changes |
|---|---|---|
| Static checks | Formatting, lint, types, dependency policy | All appropriate code changes |
| Unit tests | Deterministic state transitions, selectors, scope inference | Models, parsing, utilities |
| Contract tests | Provider protocol, event envelopes, schema compatibility | Adapters and shared interfaces |
| Integration tests | Real persistence, backend services, tools, permissions | Cross-system changes |
| End-to-end tests | Chat, workspace, quick capture, contextual command | User-facing vertical slices |
| Visual/motion review | Captured transitions, material behavior, interaction feel | Cinematic surfaces and rendering |
| Accessibility review | Keyboard, focus, reduced motion, contrast, screen-reader semantics | Interaction changes |
| Performance benchmarks | Frame-time distribution, latency, idle usage, large histories | UI, data, rendering, agents |
| Reliability and recovery | Crash, interrupted stream, corrupted cache, partial write, restart | State and provider changes |
| Security tests | Sandbox/approval boundary, injection, path scope, secrets | Tools, autonomy, external integration |
| Operational trials | Install, update, rollback, migration, offline behavior | Release-impacting changes |

**AW-ENG-055 — Risk-proportionate verification.** Each substantive change MUST specify the relevant verification layers and execute applicable checks. Skipped checks MUST be explained, not silently treated as passing.

**AW-ENG-056 — Evidence preservation.** Acceptance reports MUST name the environment, revision, steps/commands, observations, and outcomes. Failed, flaky, blocked, and not-run checks MUST be clearly distinguished.

**AW-ENG-057 — Visual acceptance.** Visually critical work MUST be evaluated through representative interactive demonstrations and captured motion behavior, not screenshots alone or solely static unit tests.

**AW-ENG-058 — Performance acceptance.** Rendering and responsiveness claims MUST be supported by representative device tests, including frame-time percentiles or distributions, memory/CPU/GPU impact, idle/background behavior, and relevant input latency; single FPS maxima are not sufficient.

**AW-ENG-059 — User-journey acceptance.** Critical workflows MUST be validated from the perspective of actual user intent, including normal chats without tasks, selections with broader/narrower implied scope, workspace persistence, long histories, approvals, and recoverable failure.

**AW-ENG-060 — Regression suites.** Changes affecting durable data, context compaction, connected branches, event truth, approvals, integrations, or motion continuity MUST be backed by meaningful regression scenarios.

**AW-ENG-061 — Honest visual instrumentation.** Simulated particles, activity pulses, model statuses, token charts, or progress displays MUST NOT masquerade as actual execution evidence. Real capture gaps and unsupported metrics MUST remain visible.

**AW-ENG-062 — Accessibility parity.** The experience SHOULD provide keyboard-operable alternatives to gesture-only actions, visible focus, reduced-motion strategies, and accessible status information; cinematic rendering MUST NOT be the only way to learn a critical state.

## 11. Continuous integration, supply chain, and build reproducibility

Automated checks should provide trustworthy feedback without imposing unnecessary delay on exploratory development.

**AW-ENG-063 — Reproducible paths.** Supported builds SHOULD have documented prerequisites, pinned or controlled dependencies, repeatable commands, and artifact version information sufficient to reproduce a reported result.

**AW-ENG-064 — Baseline CI.** Before a component is treated as production-quality, its applicable type/lint/test/build checks MUST be runnable in an automated pipeline or have a documented equivalent verification path.

**AW-ENG-065 — Dependency scrutiny.** New dependencies MUST be evaluated for license, security posture, maintenance, compatibility, bundle size, runtime cost, and actual need. A graphics dependency's visual value must be weighed against performance and delivery costs.

**AW-ENG-066 — Sensitive build configuration.** Secrets, credentials, signing keys, and private endpoints MUST be managed outside public source and test fixtures. Logs and error artifacts SHOULD be redacted or access controlled.

**AW-ENG-067 — Artifact provenance.** Distributable builds MUST be attributable to a source revision, build configuration, and dependency set; official releases SHOULD provide appropriate integrity/signing mechanisms supported by the selected platform.

**AW-ENG-068 — Flake discipline.** Repeatedly failing, flaky, or disabled checks MUST be tracked with owner and follow-up. A blanket “green” claim MUST NOT obscure skipped, quarantined, or unreliable checks.

**AW-ENG-069 — Avoid ceremonial pipelines.** CI stages SHOULD be chosen for risk reduction and timely feedback. Teams MAY use staged or nightly suites where full visual/performance testing on every commit is impractical.

## 12. Design-system and Motion Coordinator delivery

The visual prototype is not merely a marketing demo. It is a technical proving ground for rendering choices, state/motion architecture, component APIs, accessibility, and resource use.

**AW-ENG-070 — Design tokens and reusable primitives.** The visual system MUST have coherent materials, geometry, typography, light, color, layer, focus, and motion tokens rather than unrelated one-off visual effects.

**AW-ENG-071 — Six motion domains.** Implementation plans for the Motion Coordinator MUST cover Spatial, Material, Atmospheric, Semantic, Interaction, and Performance Motion and document the synchronization and ownership boundaries among them.

**AW-ENG-072 — Motion backed by state.** Meaningful activity animations MUST be derived from real domain state or explicitly labeled simulations; rendering must not infer task success from elapsed animation time.

**AW-ENG-073 — Object continuity.** Shared-resource transitions across panel expansion, docking, workspace movement, and supported display changes SHOULD preserve object identity and state, and MUST avoid losing user data when animations are interrupted.

**AW-ENG-074 — Adaptive quality demonstration.** Renderer prototypes MUST measure at least an active cinematic condition and a reduced-load condition, including no unnecessary heavy rendering while hidden or minimized.

**AW-ENG-075 — Prototype-to-product gate.** Before replacing a validated visual prototype with product components, engineers MUST demonstrate that the replacement preserves the documented experience, not just functional parity.

**AW-ENG-076 — Avoid UI main-thread hostage situations.** Heavy rendering, indexing, telemetry aggregation, long-chat processing, or agent message ingestion SHOULD NOT monopolize the input/rendering thread; virtualization, worker/native processing, batching, or backpressure SHOULD be evaluated as appropriate.

## 13. Failure handling, observability, and incident learning

Engineering should assume that provider connections fail, events arrive late or out of order, file operations partially complete, devices disconnect, windows crash, and migrations encounter old state.

**AW-ENG-077 — Failure state is product state.** Error, partial, disconnected, canceled, interrupted, denied, retried, and unknown states MUST be represented accurately and designed into workflows rather than appended as generic error banners.

**AW-ENG-078 — Causal evidence.** Delivery and incident investigations MUST link claims to actual logs, recorded events, commits, reproductions, or other evidence and MUST identify gaps.

**AW-ENG-079 — Recovery exercises.** Durable-data and execution components MUST have tested recovery paths appropriate to risk, including simulated crashes and replay/reconciliation when supported.

**AW-ENG-080 — Incident learning.** Significant regressions SHOULD produce concise records of impact, root cause or uncertainty, detection gap, mitigation, permanent fix, tests added, and follow-up owner. Avoid blame-oriented postmortems.

**AW-ENG-081 — No false progress.** An agent running commands or an automated workflow passing internal steps MUST NOT imply feature completion without applicable integration and user-outcome evidence.

## 14. Engineering performance, capacity, and efficiency

Aetherwake must remain visually ambitious while behaving politely on the user's computer. Efficiency applies to GPU/CPU/memory, startup, storage, network usage, agent resource consumption, and reasoning/token expenditure.

**AW-ENG-082 — Establish baselines.** Major feature work SHOULD preserve or update measured baselines for responsiveness, startup/restoration, long-chat rendering, background usage, and relevant token/agent workloads.

**AW-ENG-083 — Meaningful metrics.** Engineering dashboards SHOULD prefer percentile frame times, latency breakdowns, durable task completions, defects, recovery success, and usage-per-verified-outcome over raw activity counts.

**AW-ENG-084 — Budget review.** A change that causes material performance, storage, battery, or token regression MUST document the cause, benefit, mitigation, and acceptance authority before release.

**AW-ENG-085 — Distinguish estimates.** Inferred model “thinking time,” approximated tokens, forecast task durations, or unavailable metrics MUST NOT be displayed as exact measured telemetry.

**AW-ENG-086 — Resource-aware testing.** Representative tests SHOULD include foreground, background, idle, high-load/gaming, reduced graphics, and changing display conditions as applicable to the feature.

**AW-ENG-087 — Optimization proof.** Context or orchestration optimizations SHOULD compare total work, outcome quality, cache effects, retries, and tokens consumed against a reproducible baseline, not claim success solely because a prompt became shorter.

## 15. Documentation, requirement traceability, and change records

Documentation should make engineering easier. It must not become a substitute for shipping. Aetherwake uses a layered documentation system:

| Source | Role |
|---|---|
| Constitution and accepted charters | Binding product and process outcomes |
| Governance registry | Publication and ratification status |
| ADRs | Accepted technical decisions and rationale |
| Interface specifications | Contracts, schemas, ownership |
| Research | Experiments, measurements, alternatives |
| Experience references | Intended feel and interaction examples |
| Plans and issues | Scheduled tasks and dependencies |
| Tests and evidence | Proof of verified behavior |
| Release notes | What changed for users and integrators |

**AW-ENG-088 — Traceability.** Significant features MUST link relevant requirement IDs to implementation artifacts and acceptance evidence. When requirements change, affected tests and documentation MUST be evaluated.

**AW-ENG-089 — Useful documentation.** Documentation MUST distinguish implemented behavior from future intent. Technical references SHOULD include examples, failure behavior, constraints, and pointers to authoritative sources.

**AW-ENG-090 — Documentation with change.** Changes to user-facing behavior, interfaces, permissions, persistence, release procedures, or acceptance evidence MUST update the relevant documentation in the same work package or carry an explicitly owned follow-up.

**AW-ENG-091 — Status vocabulary.** Reports MUST distinguish at minimum: proposed, researched, designed, prototyped, implemented, demonstrated, verified, reviewed, integrated, released, and owner-accepted. These are not synonyms.

**AW-ENG-092 — Durable decision history.** Material decisions and supersessions MUST be recorded with rationale, timestamp, and scope. Contributors MUST NOT erase rejected approaches in a way that hides why a decision changed.

### 15.1 Suggested traceability record

~~~text
Requirement: AW-CON-018; AW-ENG-073
Work package: Motion transition continuity
Implementation: source paths and revision
Validation: captured interactive scenario and automated state test
Result: verified / failed / blocked / not run
Evidence: artifact identifiers and environment
Approver: identified authority, if required
~~~

## 16. Review, integration, and acceptance boundaries

Review is not merely a check for syntactically correct code. It evaluates design compatibility, safety, test adequacy, architecture, and user outcome.

**AW-ENG-093 — Structured review.** Material changes MUST receive a review appropriate to risk, covering scope, applicable governance, correctness, security/privacy implications, tests, UX/motion effects, and rollback.

**AW-ENG-094 — Independent evidence.** High-impact or cross-cutting changes SHOULD be verified by a reviewer or check independent of the implementing agent, especially when the agent also generated its own tests.

**AW-ENG-095 — Integration boundary.** Passing local tests is not proof that changes integrate. Before integration, conflicts, shared schemas, dependency versions, compatibility, and regression risks MUST be examined on the intended target state.

**AW-ENG-096 — Acceptance boundary.** Merged code is not automatically a user-accepted feature. A milestone MUST identify who accepts its result and what evidence is required; omitted sign-off is not implied approval.

**AW-ENG-097 — No silent scope shrinkage.** If implementation constraints prevent the originally intended behavior, the work package MUST report the gap and propose alternatives. The task MUST NOT be relabeled complete by silently removing difficult requirements.

**AW-ENG-098 — Honest deferrals.** Known bugs, unsupported environments, missing integrations, and incomplete visual fidelity MUST be recorded with severity and follow-up disposition rather than concealed behind a passing build.

## 17. Releases, migrations, and rollback

Release engineering begins before the first public installer. Persistent user data, notes, projects, workspace layouts, conversations, and event history require careful migration semantics.

### 17.1 Release readiness domains

| Domain | Release evidence |
|---|---|
| Product | Scope documented, accepted user journeys demonstrated |
| Visual | Signature interactions reviewed, reduced motion and quality tiers tested |
| Execution | Supported provider versions and capabilities tested |
| Data | Migration and rollback or recovery exercises performed |
| Security | Authorization boundaries reviewed, dependency and secret checks completed |
| Performance | Representative device benchmarks and baseline comparisons |
| Operations | Installation/update/uninstall, backup, recovery, and diagnostics |
| Documentation | Release notes, limitations, support matrix, changes in behavior |

**AW-ENG-099 — Release identity.** Every distributable build MUST have a version and source revision that can be associated with its dependencies, configuration, and test evidence.

**AW-ENG-100 — Migration safety.** Persistent schema changes MUST define compatibility, migration preconditions, partial-failure behavior, preservation of original state where appropriate, and tested recovery.

**AW-ENG-101 — Safe rollout.** High-impact or irreversible changes SHOULD have a staged rollout, feature gate, backup, or other safe deployment mechanism appropriate to the actual user population and architecture.

**AW-ENG-102 — Rollback clarity.** Release notes MUST state when rollback is supported, limited, or impossible because of data-format changes; a UI “undo” control MUST NOT be treated as proof of system-level rollback.

**AW-ENG-103 — Support matrix.** Releases MUST describe supported platforms, major dependencies, required privileges, and known provider limitations. Compatibility MUST be verified rather than inferred from shared harness code.

**AW-ENG-104 — Release approval.** A release MUST NOT be represented as generally ready or owner-accepted without completion of its declared gates and the appropriate approval.

**AW-ENG-105 — Post-release validation.** Significant releases SHOULD include a monitored smoke-test and a process for detecting, triaging, and communicating regressions.

## 18. Engineering status and progress reporting

Aetherwake must make it easy for the repository owner to distinguish real delivery from preparatory activity. Status reports can be concise; they must be factual.

### 18.1 Required status dimensions

A work report SHOULD communicate:

- **What changed:** Files, interfaces, commits/PRs, behavior.
- **What was proven:** Tests, demos, benchmarks, observable outcomes.
- **What remains:** Known limitations, incomplete requirements, risks.
- **What is blocked:** Exact boundary and required next action.
- **What was not done:** Unrun tests, unmerged code, unapproved deployment.
- **Who owns the next step:** Named actor or process when known.

**AW-ENG-106 — Evidence first.** Progress claims MUST identify actual artifacts or observations; “prepared,” “safe to run,” and “ready to implement” MUST NOT be counted as executed implementation.

**AW-ENG-107 — Separate work states.** Status dashboards MUST avoid collapsing drafted, coding, tested, reviewed, merged, deployed, and accepted into a single green “done” state.

**AW-ENG-108 — No vanity metrics.** Commit count, agent count, files changed, and tokens spent MAY be shown as operational facts but MUST NOT be used alone as proof of project value or completion.

**AW-ENG-109 — Forecast integrity.** Estimates MUST identify assumptions, dependencies, and confidence or uncertainty where material. A forecast is not a completion guarantee.

**AW-ENG-110 — Reviewable evidence packets.** When reporting substantive milestones to the owner, contributors SHOULD provide a concise summary plus links to test artifacts, diffs, videos or motion captures, benchmark conditions, and unresolved issues.

## 19. Security, privacy, permissions, and autonomy in development

Charter 14 remains authoritative for product policy; this section defines obligations for engineering activity.

**AW-ENG-111 — Least necessary authority.** Development agents and automation MUST request only the permissions needed for their tasks, and MUST NOT bypass sandboxing, branch protections, approval flows, or repository controls to gain speed.

**AW-ENG-112 — Safe data use.** Real private user data SHOULD NOT be necessary for baseline UI, telemetry, or agent-integration tests. Synthetic, anonymized, or permissioned fixtures MUST be used as appropriate; public test assets MUST be safe to publish.

**AW-ENG-113 — Threat-aware interfaces.** Features that execute commands, read external content, use MCP integrations, or mutate files MUST include testing for prompt injection, untrusted inputs, accidental scope expansion, unsafe paths, and privilege boundaries.

**AW-ENG-114 — Safe automation.** Automated jobs SHOULD use scoped service identities, bounded workspaces, logging, resource limits, and termination paths. Recurring jobs MUST NOT silently escalate authority.

**AW-ENG-115 — Audit integrity.** High-impact changes MUST have traceable authorization and execution evidence where the underlying system supports it; missing proof MUST NOT be fabricated in dashboards or release claims.

## 20. Exceptions, change control, and governance amendments

Engineering inevitably encounters surprises. Exceptions should be explicit and bounded rather than quietly normalized.

**AW-ENG-116 — Temporary exception record.** A temporary process exception MUST state the affected requirement, rationale, owner, risk, compensating control, review date/trigger, and authorized decision. It MUST NOT silently nullify the Constitution.

**AW-ENG-117 — Governance amendment path.** A proposed change to governing intent MUST follow the Constitution's amendment procedure: identify exact requirements, impact, replacements, dependent documents, testing effects, owner approval, and registry updates.

**AW-ENG-118 — ADR is not governance.** A technical ADR MUST NOT be used as a substitute for amending higher-authority requirements. Contradictory lower-level documents remain subordinate.

**AW-ENG-119 — Supersession trace.** Revised requirements, ADRs, and acceptance decisions MUST retain enough history for reviewers and future agents to understand what changed and why.

**AW-ENG-120 — Change impact.** Significant process or architectural changes MUST assess implications for work in progress, interfaces, migrations, performance, visual fidelity, safety, releases, and current acceptance evidence.

## 21. Mandatory charter acceptance scenarios

The following scenarios are the minimum evidence needed to assess engineering-process compliance. They do not replace Charter 15's eventual complete quality suite or the Constitution's C-01 through C-15 acceptance anchors.

| ID | Scenario | Required evidence |
|---|---|---|
| **D-01** | New contributor receives a motion task | Correct governance routing; bounded work package; actual completion criteria |
| **D-02** | Desktop/rendering stack must be selected | Comparative prototype, measurements, alternatives, ADR, explicit approval |
| **D-03** | Visually attractive mock is ready | Explicit simulated labeling; not claimed as a functioning real agent |
| **D-04** | Visual component becomes production UI | Motion/material review, functional test, reduced-motion path, real data wiring |
| **D-05** | Codex protocol changes | Capability negotiation, contract test, unsupported-state behavior, graceful recovery |
| **D-06** | Two agents change related code | Isolated worktrees, conflict detection, integration test and audit trail |
| **D-07** | Two agents affect shared live state | Shared-state ownership/coordination instead of assuming Git isolation is enough |
| **D-08** | Agent “finishes” but tests fail | Status remains incomplete/failed; exact evidence and next action reported |
| **D-09** | Tests pass but experience looks generic | Functional success retained, experience acceptance not granted |
| **D-10** | Conversation data schema changes | Migration test, interruption recovery, original-history preservation |
| **D-11** | Timeline or agent visual uses mock events | Visible simulation status and no fake proof of actual activity |
| **D-12** | Chat view grows to a large history | Rendering and interaction profiling, usable virtualization/scaling evidence |
| **D-13** | App moves from dual display to single | Recoverable layout and no resource identity loss |
| **D-14** | Release introduces new permission | Threat review, consent behavior, audit checks, release notes |
| **D-15** | Agent encounters conflicting governance | Escalates boundary and stops affected action without quietly improvising |
| **D-16** | Change cannot meet original requirement | Gap reported, alternative proposed, explicit acceptance or deferral |
| **D-17** | Owner asks “what actually shipped?” | Distinct deployed versus merged versus verified states, inspectable artifacts |
| **D-18** | Public documentation is published | Secret/privacy screening and verification of linked sources |
| **D-19** | Framework benchmark later changes | ADR revalidation triggered; comparison to accepted constraints |
| **D-20** | Failed release update | Identified version, recovery or rollback mechanism, failure documentation |

A charter implementation review SHOULD include reproducible test instructions, the revision tested, device/environment information where relevant, and links or artifact identifiers. Screenshots alone cannot satisfy temporal motion scenarios. A mock stream cannot satisfy a real-provider scenario.

**AW-ENG-121 — Scenario trace.** Applicable D-series scenarios MUST be mapped into the implementation's test and review evidence before a substantive milestone is accepted.

**AW-ENG-122 — Owner-facing clarity.** Final acceptance packages MUST distinguish already-satisfied criteria, failures, deferred criteria, exceptions, and criteria not yet applicable.

## 22. Cross-charter delivery matrix

This is a **routing matrix**; it is not an attempt to establish competing product requirements.

| Charter | Canonical responsibility | Engineering delivery obligation here |
|---|---|---|
| 00 Constitution | Intent, priority, invariants | Route work and prove compliance with constitutional anchors |
| 01 Experience | UI intent, selection, command, navigation | Demonstrate complete user journeys and interaction fidelity |
| 02 Liquid Intelligence | Materials, physics, semantic motion | Build visual prototypes, test motion quality and adaptive rendering |
| 03 Projects/Resources | Resource identity, workspaces, layout semantics | Verify migration, organization, and cross-view identity |
| 04 Conversations | Chats, histories, connected branches | Test direct chat, resume, forks, provenance, retrieval |
| 05 Agents/Tasks | Tasks, roles, orchestration semantics | Isolate parallel development and verify task completion |
| 06 Vela | Assistant presence, initiative, adaptation | Exercise bounded autonomy and user controls |
| 07 Notes/Knowledge | Notes, Thought Stream, knowledge authority | Verify capture, recoverability, and safe public fixtures |
| 08 CIE | Context retrieval, compaction, memory | Benchmark relevance, preservation, handoffs, cost/quality |
| 09 Observability | Event integrity, Intelligence Streams | Validate captured versus inferred evidence and gaps |
| 10 Profiler | Timings, usage, budgets, metrics truth | Benchmark and test source attribution and unavailable metrics |
| 11 Timelines | Planning, replay, temporal experience | Validate historical reconstruction and uncertainty |
| 12 Codex | Provider adapters, threads, tools, models | Real integration and contract/capability tests |
| 13 Platform | Render/performance/display standards | Compare shells; device, idle, power, display benchmarks |
| 14 Trust | Authorization, privacy, safety policies | Security gates, permission tests, secrets screening |
| 15 Quality | Complete quality and acceptance definitions | Execute tests and collect release evidence |
| 16 Engineering | Delivery and change management | Own plans, review workflow, ADRs, release process |

Where a neighboring charter is still planned or awaiting acceptance, the matrix does not create that charter's normative requirements; it records the intended boundary and constitutional obligation to avoid premature claims.

## 23. Open decisions and research backlog

The following are intentionally **not settled by this charter**:

1. Final desktop shell (Tauri, Electron, or other).
2. GPU compositor and particle renderer (WebGL, WebGPU, hybrid, native layers).
3. Graphical multi-window transition technique and fallback behavior.
4. Final native-service/runtime language mix and IPC transport.
5. Canonical persistence technology, indexing/search engine, sync and backup format.
6. Release cadence, versioning conventions, code-signing identity, and distribution channels.
7. Exact numerical performance budgets, target devices, benchmark fixtures, and alert thresholds.
8. Formal CI provider, test runner, build system, packaging system, and visual regression tooling.
9. Account/login and remote deployment model, subject to security and provider capability validation.
10. Additional execution providers beyond Codex and their compatibility promises.
11. Agent delegation quotas, scheduling algorithms, and workload-capacity policies.
12. Exact user-visible project milestone dates and staffing assumptions.

These require relevant research and ADRs or later domain charter decisions; omission is not a license to claim they are supported today.

## 24. Non-goals and prohibited shortcuts

This charter does **not**:

- Specify a finished release schedule or promise an automatic implementation timeline.
- Select a final rendering stack or desktop framework without research.
- Impose an enterprise-scale process on a tiny local prototype.
- Require all future charters to be loaded into every model context.
- Replace Vela's product behavior, CIE's memory contracts, or the Quality charter's acceptance taxonomy.
- Treat documented architecture as evidence that running code exists.
- Authorize an agent to merge, deploy, delete, or modify protected resources merely because it completed its assigned code.
- Grant access to hidden model reasoning or provider features not exposed through supported integrations.
- Allow attractive simulations to substitute for actual telemetry, task execution, or verified behavior.
- Reduce the product vision to fit the easiest available implementation.

## 25. Document lifecycle, ratification, and final invariants

This is an **owner-ratified governing charter (2026-11-05)**. Publication alone had not provided approval; that separate owner decision is now recorded. Implementation and release evidence remain outstanding.

### Conditions for charter acceptance

The repository owner should be able to verify that:

1. This document is subordinate to the Constitution and has no competing domain ownership.
2. The work-package, ADR, review, integration, and release pathways are executable rather than ceremonial.
3. The visual-first research strategy and early real-Codex gate are both preserved.
4. AI-agent contributions cannot claim unverified completion.
5. Sensitive data is excluded from public artifacts and meaningful authorization boundaries are preserved.
6. Milestone quality includes function, Liquid Intelligence experience, reliability, accessibility, resource use, and truthful observability.
7. Delivery states and owner acceptance are demonstrably distinct.
8. Open technology and scheduling decisions remain open until evidence supports resolution.

### Governing closing rules

**AW-ENG-123 — Demonstration over assertion.** Aetherwake's delivery system MUST reward inspectable, verified outcomes over reports of preparation, confident prose, or task activity alone.

**AW-ENG-124 — Product experience survives implementation.** Technical convenience MUST NOT silently erode the intended Aerynth experience. Unavoidable tradeoffs require documented evidence and the appropriate approval.

**AW-ENG-125 — Honest readiness.** A feature, milestone, release, or governance charter MUST NOT be labeled accepted, complete, production-ready, or delivered unless the corresponding authoritative acceptance boundary has actually been met.

**AW-ENG-126 — Adaptable engineering.** The engineering system SHOULD be lightweight enough for rapid prototypes and rigorous enough for high-risk changes, scaling its controls with impact rather than accumulating process for its own sake.

---

**Final governing intent:** **Build the experience that was envisioned, integrate what actually works, prove the results, preserve the user's control and data, and tell the truth about everything that remains unfinished.**

---

## Ratified amendment CF-2026-11-05: implementing complete capability rather than placeholders
> **Owner-ratified 2026-11-05.** Existing workflow, branch and proof obligations remain.

**AW-ENG-127 — Complete-outcome scope.** Every substantial feature plan MUST define user-intended result, actual tools/effects, authoritative state, failures, consent, integration evidence and omitted functionality before implementation.
**AW-ENG-128 — Placeholder honesty.** Stubs, screenshots, simulated telemetry, diagrams, prose-only agents and API calls with no verified effects MAY be prototypes but MUST NOT be reported as completed capability.
**AW-ENG-129 — Dated platform research.** Provider-dependent changes MUST cite current official API documentation, scoped entitlement checks, region/retention limits, cost and planned fallback prior to production reliance.
**AW-ENG-130 — Preserve active work.** Cross-cutting refactors MUST inventory and protect working PR #19/#20 services, events, UI, spatial state, native brokers and voice; unreviewed simplification cannot erase accepted functionality.
**AW-ENG-131 — Contract-first boundaries.** Model routing, agent orchestration, tool gateway, memory, voice, event and rendering integration MUST use versioned contracts with migration and failure tests.
**AW-ENG-132 — Receipt-driven PRs.** A delivery PR MUST identify changed requirement IDs, real code paths, actual qualified provider/device, tests run, passing/failed evidence, regressions and remaining unverified cases.
**AW-ENG-133 — Branch and owner boundaries.** Work MUST respect stacked PR relationships, current branch head and review rights; adding proposed constitutional/charter language does not silently ratify it.
**AW-ENG-134 — Capability-preserving optimization.** Token, time, cost and hardware improvements MUST show outcome parity under representative work; within user constraints, more costly execution MAY be justified when essential to completion.
**AW-ENG-135 — Independent verification.** An agent's report of its own success cannot independently satisfy acceptance; require observable source/artifact, postcondition and appropriate owner/reviewer evidence.

**Release packet:** implementation inventory, decision record, API evidence, trust/cost matrix, native/voice/GPU journeys, known incomplete capabilities and rollback. See [CF-001 through CF-030](../docs/specifications/VELA-CAPABILITY-FIRST-ACCEPTANCE-MATRIX.md).

## Owner-directed clarification AR-2026-11-05: architectural recovery and engineering elegance

> **Decision reference:** [ADR-002](../docs/decisions/ADR-002-ARCHITECTURE-RECOVERY-AND-COHESIVE-RUNTIME.md). Architecture Recovery and Full Realization are explicitly separate engineering programs. This clarification does not de-scope any owner-ratified final capability.

**AW-ENG-136 — Explicit dual-program delivery.** **Architecture Recovery** MUST organize, reconcile, simplify, test and stabilize *existing* Aerynth behavior and storage authority, without silently claiming to complete unimplemented charter requirements. **Full Aerynth Realization** separately delivers missing accepted capabilities with dedicated implementation and native acceptance evidence.

**AW-ENG-137 — Complexity must earn its existence.** New services, schedulers, databases, indexes, agents, coordination layers, state machines and render paths SHOULD be introduced only when a documented existing owner/contract cannot meet a measured requirement. Avoid duplicating canonical sources, task IDs, model routing, approvals or presentation state merely for implementation convenience.

**AW-ENG-138 — Source-preserving consolidation.** Refactoring shared coordination code MUST preserve source identity, approved history, permission boundaries, effect receipts, data migrations, real features and rollback paths. Structural changes require before/after ownership maps and integrated regression evidence, not merely passing isolated unit tests.

**AW-ENG-139 — Workstream-aware agent delegation.** Planner, implementation, independent reviewer and integration owner roles SHOULD receive bounded tasks and distinct code ownership. Worker self-reported success, high agent counts or test counts do not replace actual integrated verified outcomes. An agent MUST NOT expand a cleanup assignment into full product realization without explicit authorization.

**AW-ENG-140 — Observable backend elegance.** Maintainability SHOULD be evaluated by comprehensible responsibilities, narrow typed contracts, predictable lifecycle and recovery, performance, proven feature continuity and absence of duplicate authority, not lines generated, number of abstractions or visual ornament. A fluent frontend requires reliable canonical backend projections, not fabricated animation states.

**Status:** Accepted engineering sequencing and design clarification; implementation remains independently qualified.
