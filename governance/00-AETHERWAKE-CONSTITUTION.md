# The Aetherwake Constitution
## Foundational Governance for Aerynth and Vela

> **Owner acceptance recorded 2026-11-05.** The owner approves this charter and its reconciled amendments as governing design. Approval does not attest that code, agents, APIs, renderers or tests have achieved these requirements.

| Field | Value |
|---|---|
| Document ID | AW-GOV-000 |
| Version | 1.1.0 — owner-ratified 2026-11-05 |
| Status | **Owner-accepted and ratified governing charter (binding design requirements; implementation separately verified)** |
| Effective date | 2026-11-01 |
| Scope | Project Aetherwake, the Aerynth application, Vela, associated agents, services, and delivery |
| Authority | Highest project-level normative authority, subject to the repository owner's explicit decisions |
| Change control | Governed by Section 22 |
| Repository visibility | Public: no secrets or private operational/user data belong in this document |

> **Constitutional purpose.** Project Aetherwake exists to create **Aerynth**, a beautiful, capable, efficient, intelligent computing environment, inhabited by **Vela**, a persistent, context-aware assistant. It must combine the full usefulness of ordinary AI coding conversations with spatial workspaces, purposeful autonomy, organized knowledge, orchestrated agents, truthful observability, and an exceptional visual and interactive experience.
>
> **The user expresses intent. Aerynth handles the complexity.**
>
> **Intelligence is visible when useful, invisible when unnecessary, and accessible everywhere.**
>
> **Aerynth must never make the user work harder to use its intelligence.**

---

## 1. Purpose and governing scope

This Constitution establishes the durable product identity, experience standards, system boundaries, nonnegotiable guarantees, and engineering obligations of Project Aetherwake. It is binding on all implementations, prototypes that claim product readiness, specifications, architecture decisions, agents, integrations, and project contributors.

Aetherwake is **not** merely a themed Codex client or chatbot, nor is it required to replace the ordinary Codex chat experience. It is a coherent, user-directed environment in which people can converse, organize, create, investigate, delegate, monitor, and act through intelligent tools.

This Constitution governs **outcomes and invariants**, rather than prematurely selecting all technologies. Later subsystem charters define detailed requirements; technical specifications describe mechanisms; plans determine sequence.

**AW-CON-001 — Integrity of intent.** Every design and implementation decision MUST serve the stated product purpose. Feature existence alone is not proof that the intended experience has been achieved.

**AW-CON-002 — No hollow simulation.** Production UI MUST NOT imply real agent execution, progress, reasoning, memory, synchronization, or monitoring where none exists. Mock data in prototypes MUST be clearly labeled.

**AW-CON-003 — Staged delivery.** Individual milestones MAY implement only part of the complete vision, but incomplete capabilities MUST be identified accurately, and the overall vision MUST NOT be silently narrowed to fit a convenient prototype.

## 2. Identities and conceptual boundaries

The project maintains three distinct identities:

- **Project Aetherwake:** the overall research, design, engineering, governance, and delivery initiative.
- **Aerynth:** the user-facing desktop environment and its supporting services, data model, and interfaces.
- **Vela:** the persistent assistant within Aerynth that helps understand, navigate, organize, reason about, and orchestrate work.

These are current working names; their branding may change through an explicit recorded decision without changing their underlying responsibilities.

Codex is the initial primary agent-execution backend, preferably via a supported App Server integration, but is **not** synonymous with Aerynth or Vela. The model supplies reasoning; agent execution supplies tools and work; Vela coordinates attention and intent; the Aerynth application supplies state, presentation, governance, and interaction.

**AW-CON-004 — Separation of responsibilities.** The system MUST keep the assistant, agent execution, task orchestration, user data, and visual rendering separable by well-defined interfaces.

**AW-CON-005 — Backend adaptability.** Codex integration MUST preserve supported capabilities and avoid unnecessary lock-in. Additional backends MAY be supported later, without falsely claiming feature equivalence.

**AW-CON-006 — Ordinary conversation remains valid.** A user MUST be able to open and use a straightforward Codex conversation without first creating a project, task, agent team, workflow, or workspace configuration.

## 3. Constitutional authority and interpretation

The documentation hierarchy is:

1. **This Constitution**: binding cross-system principles, invariants, and conflict-resolution rules.
2. **Approved subsystem charters** in `governance/`: binding requirements within explicitly owned domains.
3. **Approved interface contracts and architecture decisions**: implementation-level constraints consistent with higher authority.
4. **Specifications, design references, test plans, and research**: evidence and elaboration.
5. **Milestone plans, issues, agent prompts, and task instructions**: execution details.

The repository owner retains final decision authority. A user instruction can direct a change to governance, but a conflict MUST be resolved through an explicit documented amendment rather than an agent silently rewriting governing intent. Applicable safety, platform, legal, and security obligations remain in force.

**AW-CON-007 — Precedence.** Lower-level documents and agent instructions MUST NOT override higher-level requirements by implication.

**AW-CON-008 — One authoritative home.** Each normative requirement MUST have a canonical document and stable identifier; cross-document references MUST link to it rather than establishing contradictory duplicates.

**AW-CON-009 — Honest uncertainty.** Open questions MUST be recorded as open questions. An untested technology choice, product limitation, or speculative feature MUST NOT be represented as a settled decision or verified capability.

**AW-CON-010 — Relevant-context governance.** Agents SHOULD receive the Constitution and the subset of applicable charters, rather than indiscriminately loading the entire governance corpus. The governance index and root agent instructions MUST support this routing.

Normative language: **MUST** is required; **MUST NOT** is prohibited; **SHOULD** establishes a strong default requiring a reasoned exception; **MAY** is optional. A requirement is not satisfied merely because its UI control exists.

## 4. Foundational user experience

Aerynth's primary obligation is to decrease cognitive overhead while preserving user control. The interface must make complex work understandable without requiring the user to memorize hidden relationships, duplicate context, or navigate unnecessary hierarchies.

**AW-CON-011 — Intent over ceremony.** Natural-language and direct-manipulation interactions MUST minimize needless steps. Straightforward local operations SHOULD execute without unnecessary AI calls.

**AW-CON-012 — Predictable freedom.** The user MUST be able to use chats, projects, spaces, and tools independently or together; no single workflow paradigm may become mandatory.

**AW-CON-013 — Discoverable power.** Advanced configuration MUST be accessible, scoped, searchable, and unobtrusive during everyday work. Simplicity MUST NOT be achieved by hiding essential control permanently.

**AW-CON-014 — Visible interpretation.** Where an instruction materially changes resources, Aerynth MUST make its interpretation and intended scope comprehensible before consequential execution.

**AW-CON-015 — Accessibility.** Functional use MUST NOT depend solely on color, sound, animation, or 3D effects. Keyboard accessibility, readable contrast, reduced-motion behavior, adaptable scaling, and clear focus feedback are product requirements.

## 5. Liquid Intelligence: visual identity is functionality

The **Liquid Intelligence** design language is a first-class requirement. Aerynth should feel like a cohesive, modern, cinematic environment: clear layered materials, meaningful light and depth, atmospheric particles, fluid spatial transitions, quiet ambient intelligence, and responsive direct manipulation.

It MUST NOT be reduced to generic dark-mode panels decorated with cyan borders and a few arbitrary animations. The aim is cinematic quality **with practical legibility, control, and efficiency**, not spectacle at the expense of work.

**AW-CON-016 — Design-first implementation.** Major interaction and rendering architecture decisions MUST account for the target visual experience from the beginning. A generic UI that later acquires cosmetic effects is not an acceptable substitute for the design vision.

**AW-CON-017 — Motion Coordinator.** Aerynth MUST provide a coherent, centrally governed motion architecture covering six domains: **Spatial, Material, Atmospheric, Semantic, Interaction, and Performance Motion**.

**AW-CON-018 — Continuity of objects.** When resources move between blocks, panels, layouts, and supported displays, their identity and state MUST remain stable. Transitions SHOULD visually preserve continuity wherever technically feasible.

**AW-CON-019 — Meaningful animations.** Animations representing work, delegation, discovery, status, or completion MUST originate from actual application state or appropriately labeled simulation. The interface MUST NOT fabricate thought or progress for visual drama.

**AW-CON-020 — Composed material system.** Lighting, glass, blur, depth, typography, particles, contrast, and focus treatments MUST form a consistent visual language with explicit design tokens, quality tiers, and review criteria.

**AW-CON-021 — Motion as an acceptance dimension.** Functional correctness alone MUST NOT complete a visually critical feature. Fluidity, timing, legibility, continuity, responsiveness, and coherence require verification.

The specific rendering stack, particle implementation, desktop framework, and graphics APIs remain open until comparative research and on-device prototypes justify selection.

## 6. Contextual Command and semantic selection

Aerynth MUST support commands originating from the current selection: a file, folder, image, selected image region, message, text passage, chart interval, document excerpt, block, task, agent, or multiple heterogeneous resources.

**AW-CON-022 — Selection is context, not absolute scope.** The chosen items provide referents; the user's words determine intended scope. Selecting one file and requesting all files in its containing folder MUST NOT be reduced automatically to acting on the selected file alone.

**AW-CON-023 — Structured selection.** Native selections SHOULD preserve source identity, type, location, ranges, provenance, and relevant surrounding context, rather than relying only on screenshots or unstructured copied text.

**AW-CON-024 — Safe ambiguity resolution.** For ambiguous, high-impact, destructive, or irreversible requests, the assistant MUST show the interpreted scope, offer a preview where practical, and require appropriate confirmation. Harmless navigation and organization SHOULD remain fast.

**AW-CON-025 — Recoverability.** Supported mutations SHOULD be undoable and MUST leave an inspectable action record. An inability to undo MUST be made explicit before a high-risk action.

Native application object APIs are the preferred path for manipulating Aerynth. Screen-driven computer use may serve external tools but MUST NOT be the default mechanism for managing Aerynth's own objects.

## 7. Projects, workspaces, blocks, and relationship intelligence

Aerynth's organizational model consists of **Projects**, **Workspaces**, **Blocks**, **Resources**, **Collections**, and explicit **Relationships**. These are distinct concepts and MUST NOT be conflated.

- **Projects** bind related work, settings, knowledge, resources, tasks, and layouts.
- **Workspaces** are customizable environments for doing work, including multiple saved layout modes.
- **Blocks** are interactive representations of resources, with configurable behavior and presentation.
- **Resources** are persistent identifiable entities such as chats, files, agents, websites, notes, and timelines.
- **Collections** group resources through folders, tags, categories, and saved dynamic queries.
- **Relationships** describe meaningful associations, dependencies, provenance, and shared context.

**AW-CON-026 — Resource identity.** A resource MUST retain identity when referenced from multiple workspaces or collections. Visual duplication MUST NOT automatically duplicate underlying data or sessions.

**AW-CON-027 — Organization by meaning.** Aerynth MUST support user-directed and assistant-assisted organization, including sensible project association, smart collections, relationship discovery, and natural-language restructuring.

**AW-CON-028 — Explainable relationships.** Automatically inferred associations MUST remain distinguishable from verified or user-authored links. The relationship interface MUST offer understandable, focused views; a dense graph is not a substitute for navigation.

**AW-CON-029 — Layout freedom.** Home and workspace blocks MUST support flexible arrangement, persistence, restoration, and suitable templates, with optional structured and freeform spatial modes.

**AW-CON-030 — Display awareness.** Supported multimonitor configurations SHOULD remember distinct per-display roles and layouts, gracefully reflow upon connection changes, and restore prior arrangements without losing resource state.

## 8. Chats, branches, and conversational continuity

Chats are first-class resources, not merely task output. Aerynth MUST support creating, resuming, finding, organizing, filtering, grouping, archiving, and inspecting ordinary conversations. Search and navigation MUST remain usable as histories become large.

**AW-CON-031 — Chat independence.** A conversation MAY exist without a formal project, orchestration plan, or assigned task.

**AW-CON-032 — Branch preservation.** Forked conversations MUST preserve identifiable ancestry and independent subsequent histories.

**AW-CON-033 — Connected Branches.** Aerynth MUST provide a supported mechanism to discover and transfer relevant post-fork knowledge between branches while maintaining source provenance, respecting sharing policies, and avoiding indiscriminate transcript merging.

**AW-CON-034 — Non-destructive history optimization.** Compacting active model context MUST NOT silently delete the canonical historical conversation. Export, retention, and deletion policies MUST be explicit.

**AW-CON-035 — Streamed, scalable UI.** Conversations SHOULD load progressively and virtualize lengthy histories; interface responsiveness MUST NOT depend on rendering every historical message simultaneously.

## 9. Vela: presence, context, initiative, and adaptation

Vela is the user's persistent assistant and an orchestration participant, not a substitute for all coding agents. Vela SHOULD help understand the current selection and workspace, answer questions, create layouts and resources, coordinate tasks, retrieve relevant knowledge, and direct attention when useful.

**AW-CON-036 — Persistent, scoped awareness.** Vela MUST rely on explicit application state, authorized monitoring, metadata, retrieval, and event history. Persistent awareness MUST NOT be described as all information being continuously present in a model's context.

**AW-CON-037 — Initiative Engine.** Vela MUST support configurable proactive discovery and notification policies, including severity, relevance, user activity, quiet times or modes, attention budgets, and user-controlled interruption thresholds.

**AW-CON-038 — Adaptive Experience Engine.** Aerynth SHOULD learn authorized workflow patterns and recommend or automatically apply permitted low-risk preferences. Learned behavior MUST be inspectable, correctable, suppressible, and reversible where feasible.

**AW-CON-039 — Autonomy boundaries.** Habit learning MUST NOT silently increase permissions, expand sensitive data access, or authorize destructive actions.

**AW-CON-040 — Universal access.** Vela SHOULD remain contextually accessible throughout Aerynth without consuming excessive screen space, attention, or resources. Voice and multimodal interaction MAY extend the same underlying control system.

**AW-CON-041 — Efficient agency.** Navigation, database searches, layout changes, and other deterministic actions SHOULD use local software operations when AI reasoning is unnecessary.

## 10. Agents, tasks, executions, and orchestration

An **Agent** is a configurable worker identity and capability profile. A **Task** is a persistent objective with requirements, dependencies, and evidence. An **Execution** is an attempt or run. A **Chat** is a communication context. They are related, but not interchangeable.

**AW-CON-042 — Delegation with intent.** Vela and authorized users MUST be able to break down suitable objectives, prepare relevant context, assign agents, track dependencies, and consolidate results.

**AW-CON-043 — Parallelism with discipline.** Agent count MUST be justified by expected benefit, resource capacity, dependencies, potential conflicts, and token efficiency. More concurrent agents is not inherently better.

**AW-CON-044 — Work isolation.** Concurrent modifications to code or other shared state MUST use appropriate isolation, coordination, and integration. Git worktrees do not protect live databases, game worlds, or external mutable services.

**AW-CON-045 — Outcome-oriented status.** Investigation, implementation, testing, review, integration, deployment, and verified result MUST be distinguishable. A completed chat or stopped agent MUST NOT automatically mean a completed task.

**AW-CON-046 — Resumable ownership.** Tasks SHOULD survive individual chats and agent executions. Handoffs MUST preserve relevant objective, state, constraints, evidence, decisions, and remaining work.

## 11. Notes, project knowledge, and the user's Thought Stream

Aerynth MUST provide frictionless note capture independent of chat or agent execution. Quick notes, project notes, workspace notes, attached annotations, and a personal chronological Thought Stream MAY share a common underlying resource model.

**AW-CON-047 — Capture first.** Quick Capture MUST be fast, persistent, and usable without mandatory project selection or an AI response. Organizational inference MUST NOT delay saving.

**AW-CON-048 — Searchable awareness.** Vela SHOULD be able to retrieve relevant authorized notes and project knowledge as needed without injecting the complete note corpus into every model request.

**AW-CON-049 — Epistemic separation.** Ideas, hypotheses, preferences, decisions, verified facts, and formal requirements MUST be represented distinctly. Assistant-generated organization MUST NOT silently promote tentative ideas into authoritative project constraints.

**AW-CON-050 — Knowledge provenance.** Important retrieved facts SHOULD retain links to their original note, message, document, or source and an explicit confidence or verification state where applicable.

The **user's Thought Stream** records captured ideas. **Intelligence Streams** record observable AI work. They MUST remain conceptually and technically distinguishable.

## 12. Context Intelligence Engine and memory integrity

The **Context Intelligence Engine (CIE)** is a headline capability responsible for assembling useful context with minimal avoidable waste, while preserving information quality and historical recoverability.

**AW-CON-051 — Relevance before volume.** Context assembly MUST prioritize relevance, importance, recency, trustworthiness, dependency, uniqueness, and retrieval cost rather than indiscriminately attaching all available history.

**AW-CON-052 — Adaptive decay.** Older information MAY receive progressively less active-context weight, but essential facts, constraints, dependencies, and verified decisions MUST NOT be discarded merely for being old.

**AW-CON-053 — Canonical history.** Summarization, checkpointing, thread compaction, and task handoff MUST preserve access to underlying source records according to user-controlled retention policies. Compaction is not deletion.

**AW-CON-054 — Context inspection.** Users MUST be able to understand the application-managed resources being supplied or omitted, which compactions or checkpoints were used, and how to retrieve older material. Private model internals are not implied.

**AW-CON-055 — Quantified efficiency.** CIE changes claiming improvement MUST be evaluated for actual token use, wall-clock time, task quality, and failure/rework rates. Savings that materially damage reliability are not acceptable.

**AW-CON-056 — Tool output restraint.** Supported tool interfaces SHOULD preserve full relevant outputs in durable storage while enabling bounded, searchable views for model consumption. They MUST NOT silently truncate critical error evidence or claim to intercept inaccessible internal tool operations.

## 13. Intelligence Streams and truthful observability

Aerynth MUST support persistent, structured observability across chats, agents, tasks, projects, and Vela, with configurable live streams, detailed execution inspection, and historical replay.

**AW-CON-057 — Evidence classes.** Every observability presentation MUST distinguish **observed events**, **agent-reported summaries**, **inferred interpretations**, and **unknown/unavailable internal activity**.

**AW-CON-058 — No fabricated thoughts.** Reasoning summaries MAY be displayed when supported, but the system MUST NOT represent them as the model's complete private chain of thought. No synthetic "thinking stream" may masquerade as directly observed cognition.

**AW-CON-059 — Event provenance.** Captured events MUST record available source, timestamps, identity, lifecycle, correlation, and ordering metadata. Missing intervals, stream disconnects, and partial histories MUST be signaled.

**AW-CON-060 — Replay with integrity.** Historical replay MUST reconstruct only recorded evidence, never invent missing operations. The user SHOULD be able to traverse tasks, agents, tool calls, outputs, changes, approvals, and associated outcomes.

**AW-CON-061 — Semantic visualization.** Agent constellations, activity pulses, links, and stream animations MUST correspond to recorded or clearly labeled inferred state, rather than arbitrary pseudo-progress.

## 14. AI Execution Profiler, budgets, and telemetry

The profiler measures execution time, tool time, streaming duration, latency, model and token usage, context metrics, and result quality at the granularity supported by available interfaces.

**AW-CON-062 — Detailed telemetry.** Every chat and task SHOULD expose available elapsed time, response streaming time, tool activity, and token usage, with expandable per-run diagnostics and trends.

**AW-CON-063 — Measured versus estimated.** Direct measurements, derived measurements, model-reported values, inferred approximations, and missing fields MUST be clearly distinguished. Pre-output time MUST NOT be universally labeled as exact internal thinking time.

**AW-CON-064 — Honest budgets.** Soft token budgets, usage alerts, task admission controls, and hard-enforcement claims MUST be distinguished. The interface MUST NOT promise a strict cap without an enforcement mechanism that actually guarantees it.

**AW-CON-065 — Quality-adjusted metrics.** Efficiency assessment SHOULD consider verified useful outcomes, not merely fewer tokens or shorter execution.

## 15. Timelines, planning, and attention to time

Aerynth MUST support distinct **historical**, **forecast/planning**, **dependency**, and **replay** timelines that can appear as workspace blocks and be created or modified through contextual commands.

**AW-CON-066 — Grounded timelines.** Recorded historical events MUST remain distinguishable from estimates. Forecasts MUST communicate uncertainty and dependencies without false precision.

**AW-CON-067 — Living plans.** Task timelines SHOULD respond to real progress, blockers, changed scope, and verified milestones, subject to user control.

**AW-CON-068 — Attention-aware return.** Welcome-back and digest experiences MUST distinguish events since last presence from events actually reviewed, and MUST not equate launching the app with acknowledging all notifications.

## 16. Trust, autonomy, security, and privacy

Powerful agents and proactive monitoring require explicit boundaries. User authorization, least privilege, sandboxing, auditability, and safe recovery are foundational, not later enhancements.

**AW-CON-069 — Least privilege.** Agents, plugins, remote tools, and background services MUST operate with bounded access appropriate to their tasks. Sensitive connections and elevated permissions require explicit authorization.

**AW-CON-070 — Consequential action control.** Destructive, externally visible, high-impact, financial, deployment, credential, or privilege-changing operations MUST follow explicit applicable approval policy, with sufficient preview and audit evidence.

**AW-CON-071 — Local privacy by default.** Personal data, notes, telemetry, and credentials MUST be protected through appropriate storage, access control, retention, and export policies. A public repository MUST NOT contain private operational records or secrets.

**AW-CON-072 — Controllable initiative.** Users MUST be able to inspect, limit, disable, and revoke monitoring, learned preferences, remote connections, and autonomous task schedules.

**AW-CON-073 — Failure containment.** Agent failures, disconnected backends, partial executions, and interrupted streams MUST degrade safely without corrupting user state or falsely indicating success.

## 17. Platform independence, performance, and resource sensitivity

Aerynth targets a native-quality desktop experience with robust multiple-display support and graceful operation under load. High visual fidelity and low resource interference are simultaneous requirements.

**AW-CON-074 — Benchmark before commitment.** Desktop shell, webview/graphics engine, GPU rendering APIs, and related foundational technologies MUST be evaluated against representative cinematic prototypes and real hardware before final selection.

**AW-CON-075 — Adaptive quality.** Graphics MUST support intelligently adjusted quality for foreground/background use, battery state, gaming, GPU/CPU pressure, and user-selected limits without sacrificing basic clarity or interaction.

**AW-CON-076 — Idle discipline.** Minimized, hidden, or inactive surfaces MUST avoid unnecessary continuous rendering and heavy background resource consumption.

**AW-CON-077 — Performance evidence.** Engineering teams MUST measure latency, frame-time distributions, memory usage, startup/restoration performance, and long-history scalability. Single headline FPS numbers are insufficient.

**AW-CON-078 — Multi-display continuity.** Display addition/removal, DPI changes, detaching blocks, and window restoration MUST preserve data and recover a usable layout.

**AW-CON-079 — Graceful offline behavior.** Local notes, organization, navigation, and accessible histories SHOULD remain usable when an AI backend or network connection is unavailable.

## 18. Extensibility, interoperability, and maintainability

Aerynth MUST be designed to evolve without requiring destructive migration of its core user model.

**AW-CON-080 — Typed interfaces.** Major application services and native assistant actions MUST use explicit, validated data contracts, stable identifiers, and attributable state changes.

**AW-CON-081 — Extensible blocks and integrations.** New block types, tools, services, and backend adapters SHOULD integrate through documented interfaces and scoped permissions rather than invasive modifications to unrelated subsystems.

**AW-CON-082 — Portable user data.** Projects, notes, chats where supported, relationships, layouts, and relevant configuration SHOULD offer documented import/export or migration paths, with clear limits imposed by external backends.

**AW-CON-083 — Reliable upgrades.** Schema changes and compatibility transitions MUST preserve existing user information or require explicit, safely reversible migration procedures.

## 19. Engineering, research, and validation obligations

Aetherwake's engineering process MUST treat creative intent and functional rigor as equally serious constraints.

**AW-CON-084 — Research-led irreversible choices.** Foundational stack selections MUST be supported by documented prototypes, tradeoffs, benchmarks, and architecture decision records.

**AW-CON-085 — Real integration early.** Visual prototyping MUST begin early, but an end-to-end real Codex integration MUST be validated before declaring core architecture viable.

**AW-CON-086 — No unchecked completion.** Features MUST be evaluated against functional, experiential, performance, security, accessibility, and observability criteria appropriate to their scope.

**AW-CON-087 — Regression protection.** Changes affecting persistent resources, context, permissions, agent orchestration, or rendering continuity MUST include meaningful regression verification.

**AW-CON-088 — Evidence-based status.** Progress reporting MUST separate planned, implemented, demonstrated, tested, reviewed, integrated, deployed, and user-accepted states.

**AW-CON-089 — Agent discipline.** AI contributors MUST inspect applicable governance before implementing changes, preserve unrelated work, report uncertainty, and avoid claiming tests or reviews they did not perform.

## 20. Governance routing and future charters

The Constitution delegates detailed domain governance to the following proposed charters. **Their titles and numbering are reserved planning targets; a document is not approved or binding until actually authored and accepted.**

| ID | Proposed charter | Primary domain |
|---|---|---|
| 01 | Experience and Interaction | UX, contextual commands, navigation, home, focus |
| 02 | Liquid Intelligence and Motion | Six motion systems, materials, visual acceptance |
| 03 | Projects, Workspaces, and Resources | Object model, organization, relationships, displays |
| 04 | Conversations and Connected Branches | Chat parity, history, search, branches |
| 05 | Agents, Tasks, and Workflows | Delegation, tasks, isolation, evidence |
| 06 | Vela Intelligence and Adaptation | Presence, initiative, attention, learned behavior |
| 07 | Notes, Knowledge, and Thought Stream | Capture, knowledge authority, personal notes |
| 08 | Context Intelligence and Memory | CIE, retrieval, compaction, provenance |
| 09 | Intelligence Streams and Observability | Event bus, observable agent activity, replay |
| 10 | AI Execution Profiler | Tokens, timings, budgets, quality-adjusted efficiency |
| 11 | Timelines and Replay | Forecasts, histories, temporal interaction |
| 12 | Codex Execution and Integrations | App Server, tools, models, authentication |
| 13 | Platform, Performance, and Displays | Stack evaluation, GPU budgets, multimonitor |
| 14 | Trust, Privacy, and Autonomy | Permissions, monitoring, security, reversibility |
| 15 | Quality, Verification, and Acceptance | Testing and experiential acceptance |
| 16 | Engineering and Delivery | Contribution, decisions, milestones, integration |

The governance index MUST maintain the real status and path of each document. Future charters MAY be reorganized by an approved governance change, provided no constitutional requirement is orphaned.

## 21. Constitutional acceptance tests

Every substantive milestone MUST consider applicable constitutional tests. At minimum, the program SHALL provide demonstrable evidence for the following when the relevant capability is implemented:

| Test | Required demonstration |
|---|---|
| **C-01 Ordinary chat** | A conversation works without forced task or project setup |
| **C-02 Contextual scope** | Selecting one item and commanding action on its parent collection respects the language and previews consequences |
| **C-03 Organization** | One resource appears in multiple workspaces without identity/history duplication |
| **C-04 Motion** | A shared object transforms through layouts with coherent animation and understandable reduced-motion fallback |
| **C-05 Meaningful activity** | Agent state animations are driven by real events, with mocked events visibly identified |
| **C-06 Agent completion** | Task status distinguishes command execution, tests, review, and actual verified outcome |
| **C-07 Branch intelligence** | A branch can obtain a cited finding made by a sibling after their fork, without blindly merging transcripts |
| **C-08 Memory integrity** | Compacting or handing off context preserves retrievable source history |
| **C-09 Quick Capture** | A note can be saved immediately and subsequently found through authorized retrieval |
| **C-10 Observability honesty** | Recorded operations, model summaries, inference, and unavailable reasoning are visually distinct |
| **C-11 Usage telemetry** | Reported token values and timing measurements are clearly sourced and missing data is explicit |
| **C-12 Adaptive preferences** | Suggested behavior can be inspected, rejected, corrected, and disabled |
| **C-13 Resource discipline** | Idle, background, and gaming quality modes measurably reduce graphics overhead |
| **C-14 Multi-display** | Disconnecting a display restores a usable layout without losing resource state |
| **C-15 Autonomy** | High-impact action requires applicable authorization and yields audit evidence |

These tests are constitutional anchors, **not** a complete specification. Detailed test suites and thresholds belong in approved subsystem charters and technical acceptance plans.

## 22. Amendment, exception, and conflict procedure

A constitutional amendment MUST include:

1. A clearly described problem or opportunity and why the existing rule is insufficient.
2. The exact requirements or sections affected.
3. A proposed replacement or addition, including stable identifier changes.
4. An impact assessment covering dependent charters, code, tests, data, user experience, and compatibility.
5. Explicit owner acceptance recorded in repository history.
6. Updates to the governance index and dependent documents, with checks for contradiction.

Temporary implementation exceptions MUST have an owner, reason, scope, expiry or review trigger, risk assessment, and recorded authorization. Exceptions MUST NOT silently abolish constitutional invariants.

When documents conflict, work MUST stop at the conflicting decision boundary until authority is resolved. An agent MUST NOT choose the easier interpretation merely to continue coding.

**AW-CON-090 — Traceable changes.** Constitutional amendments MUST be explicit and versioned; unapproved task instructions or comments MUST NOT amend governance.

**AW-CON-091 — Intent preservation.** When technical constraints require an alternative implementation, the team MUST preserve the user-facing intent or document and obtain approval for the deviation.

## 23. What this Constitution does not decide

The following remain open pending focused research and charters:

- The final desktop container and rendering engine (including Tauri versus Electron).
- The definitive particle, 3D, and animation implementation libraries.
- Exact animation timing curves, visual tokens, assets, and frame-time budgets.
- Final assistant voice services, wake-word design, and commercialization terms.
- The precise implementation of semantic retrieval, memory ranking, and optional embeddings.
- Per-provider model availability, API permissions, and unsupported private internals.
- Whether additional cloud services are necessary beyond an optional local-first configuration.
- Specific release dates, delivery estimates, or an assumed fixed number of concurrently useful agents.

These are choices to **investigate**, not shortcuts to an easier product. Architectural research must remain accountable to the constitutional vision.

---

## Ratification statement

This document establishes the governing baseline for Project Aetherwake. Its first implementation priority is to realize and validate the **Liquid Intelligence visual experience**, **six-system Motion Coordinator**, **fluid workspace engine**, and **real Codex event integration**, while preserving the architectural foundations for Vela, contextual commands, notes, intelligent orchestration, CIE, observability, and user-directed autonomy.

The governing standard is not whether Aerynth resembles science fiction in screenshots. It is whether Aerynth delivers a **beautiful, understandable, reliable, adaptive, and genuinely useful environment for intelligent work**.

**Aerynth shall make powerful intelligence feel effortless, while remaining honest, inspectable, and under the user's control.**

---

## Ratified constitutional amendment CF-2026-11-05: capability-first completeness

> **Amendment status: PROPOSED, awaiting explicit repository-owner acceptance.** This section is an amendment proposal, not a claim that the established Constitution was automatically ratified anew. Existing authority hierarchy and accepted constitutional protections remain in force. If approved, register the change and update implementation/evidence; until then implementers MUST treat these proposed norms as design intent under review. This section does not grant Vela new permissions.

**AW-CON-092 — Capability-first product standard.** Aerynth and Vela MUST be designed for the complete user-intended capability, including reasoning, authentic tool execution, coordination, verification, memory, and meaningful interaction. Engineering effort, latency, token economy, and operational cost MUST be optimized *around* those required outcomes rather than used as unannounced reasons to delete or fake them.

**AW-CON-093 — Capability is not appearance.** A screen, block, voice, or agent feature MUST NOT be represented as functional or complete merely because it renders, responds, produces a generic answer, initiates an API request, or passes a synthetic demonstration. Its documented user-visible outcome, real integration, permissions and postconditions determine acceptance.

**AW-CON-094 — One Vela across execution domains.** Vela MUST maintain enduring identity and conversation/task continuity across direct model inference, native operations, delegated agents, signed-in Codex, API-key-authenticated services, voice and workspace navigation. Provider state is a scoped binding, not the application's authoritative task or memory identity.

**AW-CON-095 — Execution authority.** No model, agent, subagent, tool search, hosted program, MCP connection or remote executor MAY confer its own authorization, widen sensitive-data scope or claim a side effect that was not observed and verified. Trusted application components enforce rights and preserve uncertain outcomes.

**AW-CON-096 — Capability-aware adaptation.** The system SHOULD select models, reasoning effort, tools and execution environments using real, current availability, eligibility, capability, evidence needs, permissions, user pins, privacy and task requirements. If no capable route exists, it MUST state the limitation rather than silently selecting an incapable one.

**AW-CON-097 — Genuine autonomy with restraint.** Vela MAY decompose and coordinate independent work concurrently, plan follow-ups and proactively assist when authorization permits, but MUST preserve explicit task lineage, controllable scope, resource isolation, stop/revoke behavior, truthful status and human agency. Provider completion alone is not verified task success.

**AW-CON-098 — Provenance-preserving contextual memory.** Aerynth MUST own a persistent source-linked account of facts, decisions, artifacts, tasks, current state and deletion rules. Model contexts, provider conversation IDs, embeddings and generated summaries MAY accelerate recall but MUST NOT replace canonical knowledge provenance or override confidentiality boundaries.

**AW-CON-099 — One continuous spatial universe.** Workspace, constellation and other primary spatial destinations MUST be integrated views of the same ongoing environment, using stable identities and meaningful motion rather than isolated screen swaps. Vela's Mind MUST be a genuinely GPU-rendered volumetric 3D presence when that feature is claimed; no 2D approximation may be marketed as its substitute.

**AW-CON-100 — Observable truth in visual intelligence.** Intelligence Stream, timelines, agent/task blocks and Vela's visual Mind MUST reflect actual authorized events and reconciled state. Neither animation nor UI may claim to expose private model reasoning, fabricate agent activity, or promote ambiguous provider status to verified completion.

**AW-CON-101 — Transparent resource economics.** Aerynth MUST distinguish API credits and paid charges from signed-in ChatGPT/Codex plan entitlements, and report measured usage separately from estimates or unavailable provider data. User-set spend and resource limits MUST be respected with honest pause/fallback choices, without silent degradation of core capability.

**AW-CON-102 — Proof before acceptance.** Capability-first acceptance MUST include meaningful end-to-end, failure, security, performance, accessibility and real hardware/visual evidence appropriate to the claim. Passing unit tests, mocked provider calls, artistic prototypes, and API documentation are not by themselves proof of a completed system.

### Constitutional design acceptance (proposed)

A reviewer MUST be able to point to evidence for: (1) a real local information request without unnecessary model use; (2) a complex request carried through authorized agents/tools to verified outcomes; (3) preserved identity and privacy across provider transitions; (4) interrupted and resumed work without duplicated effects; (5) truthful provider/credit data; (6) an actually GPU-rendered 3D Mind connected to real events; and (7) coherent spatial navigation without losing state. A failed or unqualified scenario remains explicitly open.

**Implementation companions:** [capability runtime](../docs/architecture/VELA-CAPABILITY-RUNTIME-AND-EXECUTION-FABRIC.md), [provider/tool contracts](../docs/specifications/VELA-PROVIDER-TOOL-AND-AGENT-CONTRACTS.md), [acceptance matrix](../docs/specifications/VELA-CAPABILITY-FIRST-ACCEPTANCE-MATRIX.md). These subordinate documents describe mechanisms, not overrides of constitutional rights.

