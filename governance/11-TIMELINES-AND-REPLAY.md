# 11 — Timelines and Replay
## Governing Charter for Temporal Intelligence, Living Plans, and Historical Reconstruction in Aerynth

> **Owner acceptance recorded 2026-11-05:** This charter and reconciled amendments are binding product/design requirements. This does not imply implementation, verified model capabilities, security certification or release acceptance.

| Field | Value |
|---|---|
| Document ID | AW-GOV-011 |
| Version | 1.1.0 — owner-ratified 2026-11-05 |
| Status | **Owner-accepted and ratified governing charter (binding requirements; implementation separately verified)** |
| Prepared | 2026-11-01 |
| Authority | Specialized subsystem charter subordinate to [00 — The Aetherwake Constitution](00-AETHERWAKE-CONSTITUTION.md) |
| Primary domain | Historical timelines; planning and dependency timelines; conversation and project chronology; evidence-based replay; temporal interaction; forecast uncertainty |
| Normative requirement namespace | **AW-TIME-###** |
| Constitutional anchors | AW-CON-002, 004–006, 011–015, 022–030, 031–041, 042–046, 057–068, 069–073, 079–083 |
| Directly related published charters | [03 — Resources](03-PROJECTS-WORKSPACES-AND-RESOURCES.md), [04 — Conversations](04-CONVERSATIONS-AND-CONNECTED-BRANCHES.md), [06 — Vela](06-VELA-INTELLIGENCE-AND-ADAPTATION.md), [07 — Knowledge](07-NOTES-KNOWLEDGE-AND-THOUGHT-STREAM.md), [08 — CIE](08-CONTEXT-INTELLIGENCE-AND-MEMORY.md) |
| Other coordinating domains | 01 Experience; 02 Motion; 05 Agents/Tasks; 09 Observability; 10 Profiler; 12 Codex; 13 Platform; 14 Trust; 15 Quality; 16 Delivery (some may not yet be published) |
| Implementation posture | Outcome- and contract-oriented; rendering engine, event store, forecasting algorithms, clock synchronization, and adapters remain research/architecture decisions |
| Public-repository boundary | Normative requirements and fictional examples only; no private timelines, personal activity, secrets, or real operational traces |

> **Core promise.** Time is a first-class, understandable dimension of Aerynth. A person can ask Vela what happened, what is happening, what is blocked, what might happen next, and why a plan changed. Aerynth MUST be able to express the answer as an interactive timeline, grounded in attributable data, without requiring the user to become a scheduling expert.
>
> **Truthfulness promise.** **History is evidence. A plan is a hypothesis. A forecast is an estimate. A replay is a reconstruction from captured records, not an invented movie of an AI's internal thoughts.** Aerynth MUST keep these distinctions visible.
>
> **Experience promise.** Timelines are not static charts hidden in a reporting screen. They are first-class resources and workspace blocks that Vela can create, arrange, explain, compare, and update in response to ordinary language, with spatially continuous Liquid Intelligence motion.
>
> **Integrity promise.** Historical records, temporal dependencies, user review state, uncertainty, privacy boundaries, and provenance MUST survive presentation changes, compaction, filtering, navigation, and compatible data migrations.

---

## 1. Purpose, authority, and ownership boundaries

This charter governs **temporal meaning, presentation behavior, planning and forecast integrity, historical navigation, replay semantics, and timeline-specific user experience**. It translates the Constitution's AW-CON-066 through AW-CON-068 into testable requirements and supplies temporal contracts to the rest of Aerynth.

The Constitution has highest project-document authority. The repository owner retains final authority over acceptance and amendments. **MUST**, **MUST NOT**, **SHOULD**, and **MAY** have the normative meanings established by the Constitution. Publication is not ratification.

**Owned here:** temporal object families; point/interval/milestone semantics; historical versus predicted time; chronology and ordering disclosure; planning timelines; dependency/critical-path presentations; timeline resource behavior and interactions; replay controls and reconstruction claims; forecast updates and uncertainty; timeline-specific accessibility, performance, and acceptance scenarios.

**Owned elsewhere:** canonical cross-system resource identity, workspace blocks and placements (03); canonical chat/branch history (04); agents, task and execution lifecycles (05); Vela initiative and attention policy (06); user notes and knowledge authority (07); context packaging and compaction (08); canonical captured activity and event-bus fidelity (09); token/latency measurement and profiler methodology (10); backend capability semantics (12); platform rendering and display targets (13); broad permissions, deletion, and audit policies (14); global product acceptance (15).

**AW-TIME-001 — Constitutional conformance.** All timelines and replay behavior MUST comply with the Constitution and approved owning charters. Conflicts MUST be surfaced for governance resolution, never resolved through silent local overrides.

**AW-TIME-002 — One authoritative temporal domain.** This charter MUST own timeline-specific semantics and behavioral requirements; related charters MAY reference them but MUST NOT create contradictory chronological or forecast meanings.

**AW-TIME-003 — Ordinary operation survives.** Users MUST remain able to use chats, notes, workspaces, and tasks without adopting timelines or task planning. Timeline features MUST enhance, not replace, these interactions.

**AW-TIME-004 — Honest capabilities.** Simulated, provisional, forecast, reconstructed, partial, stale, disconnected, and unsupported timeline features MUST be distinguishable from complete live functionality.

**AW-TIME-005 — No mandated unverified stack.** This charter MUST NOT be interpreted as prescribing a final timeline library, event store, graph algorithm, scheduler, renderer, or model provider; implementations MUST meet the behavioral contracts regardless of mechanism.

---

## 2. Vocabulary and temporal ontology

| Concept | Governing meaning | Not equivalent to |
|---|---|---|
| **Timeline resource** | Persistently identified temporal view configuration and its associated references | A duplicate copy of every underlying event |
| **Timeline block** | Workspace presentation of a timeline resource | The authoritative event/task store |
| **Historical event** | Occurrence recorded or imported with provenance and applicable uncertainty | An AI-generated narrative of an occurrence |
| **Temporal interval** | Bounded or partially bounded period with specified start/end semantics | A guaranteed uninterrupted activity |
| **Milestone** | Meaningful point-in-time objective or recorded achievement | Proof of completion absent verification |
| **Planned item** | Intended or proposed task, event, milestone, or reservation | A historical event |
| **Forecast** | Estimated future schedule or completion distribution with assumptions | A promise or confirmed deadline |
| **Dependency** | Typed relationship constraining ordering, availability, or completion | Proof of causation solely from visual proximity |
| **Replay** | Deterministic/best-effort presentation of previously captured state changes and evidence | Re-execution, hidden-thought access, or exact visual video of uncaptured activity |
| **Snapshot** | Attributable, scoped representation of state at a captured instant | A substitute for events never recorded |
| **Coverage window** | Interval for which available sources provide some declared level of event observability | A guarantee that every event is captured |
| **Review cursor** | Per-user/per-scope indication of what activity has been meaningfully reviewed | A last-login timestamp |
| **Scenario** | Named, versioned set of scheduling/assumption choices | The single objective truth about the future |
| **Provenance** | Source, actor, capture time, transformation lineage, confidence, and evidence references | An unsupported AI explanation |

At minimum, Aerynth MUST distinguish these timeline families:

1. **Historical timelines** — what observable sources say happened.
2. **Planning/forecast timelines** — what is intended, estimated, or conditionally expected.
3. **Dependency timelines** — what must or may precede, block, enable, or overlap other work.
4. **Replay timelines** — how captured activity and reconstructable state evolved.
5. **Conversation timelines** — chat messages, turns, decisions, forks, cross-branch exchanges, and relevant execution.
6. **Project timelines** — milestones, releases, task chains, decisions, activity, and temporal project context.

A timeline MAY combine families into one coordinated display, but it MUST preserve family-specific truth labels and semantics.

**AW-TIME-006 — Typed temporal entities.** Every persisted timeline item MUST have a documented temporal type and canonical resource/event/task reference where applicable.

**AW-TIME-007 — History and expectation separation.** Historical evidence, proposed schedules, forecast values, assumptions, milestones pending verification, and user-entered dates MUST NOT collapse into one undifferentiated state.

**AW-TIME-008 — Multiple presentations, one source.** A single event or task MAY appear on multiple timelines, scales, or workspaces; presentation duplication MUST NOT create duplicate canonical tasks, events, conversations, or approvals.

**AW-TIME-009 — Composable views.** Timeline views MUST be embeddable, filterable, and combinable by permitted project, workspace, agent, chat, task, and resource scope.

**AW-TIME-010 — Stable references.** Timeline annotations, selections, links, and saved filters MUST use stable internal IDs and source version/range anchors, not only coordinates, visible labels, or list positions.

---

## 3. Temporal correctness: time, ordering, and uncertainty

Temporal data can come from local computers, cloud services, remote servers, agents, delayed queues, imported logs, human estimates, and providers with inconsistent clocks. A beautiful graph MUST NOT hide this complexity by manufacturing precision.

At minimum, a temporal record may distinguish:

- **Event time:** when the source says the occurrence happened.
- **Observed/capture time:** when an instrument or collector saw it.
- **Ingestion time:** when Aerynth recorded it.
- **Processing time:** when a derived interpretation was calculated.
- **Effective/valid time:** when a decision, configuration, or fact applies.
- **Presentation time:** how a timestamp is displayed in the user's selected timezone.

Some sources will not provide every field. Absence is a supported state, not a reason to invent values.

**AW-TIME-011 — Timestamp provenance.** Any displayed timestamp that affects interpretation MUST preserve its source, precision, timezone/offset semantics when available, and whether it was measured, reported, inferred, or user-entered.

**AW-TIME-012 — Canonical time representation.** Storage and interchange MUST use an unambiguous time representation sufficient to preserve the original offset/zone and source precision. Display conversion MUST NOT silently rewrite canonical event time.

**AW-TIME-013 — Clock skew and drift.** Events from sources with unsynchronized clocks MUST expose known/estimated skew, uncertainty, or ordering limitations where material. The UI MUST NOT claim a globally exact order from incomparable timestamps.

**AW-TIME-014 — Causal order is distinct.** Verified happens-before relationships, sequence numbers, parent-child edges, and dependency edges MUST remain distinguishable from mere chronological adjacency.

**AW-TIME-015 — Arrival is not occurrence.** Late-arriving events MUST be placed according to their appropriate recorded event time when known while retaining ingestion order and any resulting correction history.

**AW-TIME-016 — Partial and ambiguous periods.** Unknown start/end times, open intervals, indeterminate duration, timezone ambiguity, daylight-saving transitions, and coarse timestamp precision MUST have explicit supported representations.

**AW-TIME-017 — Concurrency.** Parallel execution MUST be displayable as concurrent overlapping activity, without falsely forcing all agent/tool events into a single serial narrative.

**AW-TIME-018 — Duration rigor.** Durations MUST declare how they were measured or derived. Elapsed wall-clock time, actual active processing, tool time, streaming time, estimated effort, and scheduling wait MUST NOT be conflated.

**AW-TIME-019 — Correction lineage.** A corrected timestamp or reconstructed event MUST retain the earlier version or an auditable correction record, subject to privacy/deletion policy.

**AW-TIME-020 — Timezone and zoom integrity.** Users MUST be able to interpret events in their selected timezone and change zoom/range without changing event identities, ordering evidence, or source truth. Date-only events MUST NOT be falsely converted into precise clock times.

---

## 4. Historical timelines: evidence over narrative

Historical timelines answer **what happened**, **when**, **according to whom**, and **how complete the record is**.

They MUST support meaningful activity across chats, agents, workspaces, tasks, repositories, files, servers, notifications, and other authorized sources, while respecting each source's capabilities. Event ingestion details and authoritative event contracts belong to Charter 09; this charter governs their temporal representation and user interpretation.

**AW-TIME-021 — Evidence-backed history.** Historical items MUST reference captured or imported records with attributable origin. Generated summaries MAY describe those records but MUST NOT impersonate them.

**AW-TIME-022 — Truth classification.** Timeline items MUST distinguish directly observed events, externally/provider-reported events, user annotations, inferred correlations, and unknown/unobserved intervals.

**AW-TIME-023 — Coverage disclosure.** Each timeline SHOULD expose its source and time coverage, capture state, filters, and known gaps. Any replay or digest claiming completeness MUST disclose material omissions.

**AW-TIME-024 — Event-to-evidence navigation.** Users MUST be able to inspect underlying supported evidence: source operation, tool output, message, file diff, commit, task state, approval, or reference, as applicable and authorized.

**AW-TIME-025 — Filter honesty.** Filtering, collapsing repetitive events, grouping, sampling, and summarization MUST NOT present a partial selection as the complete record. The user MUST be able to see that details are hidden and recover them where retained and authorized.

**AW-TIME-026 — Temporal correlation labels.** Visual relationships MUST distinguish direct causation established through IDs/links, plausible inferred association, common source, and mere temporal coincidence.

**AW-TIME-027 — External source reconciliation.** After reconnecting, imported activity MUST retain its original provenance and late-arrival status, with duplicate detection and explicit reconciliation coverage.

**AW-TIME-028 — Human assertions.** User-authored timeline entries MUST be visibly attributable and MUST NOT become provider-verified events without corroboration.

**AW-TIME-029 — Durable navigation.** A user SHOULD be able to search, bookmark, annotate, share permitted references, and jump to meaningful events without losing timeline context.

**AW-TIME-030 — Non-event visibility.** An empty period MUST NOT be presented as evidence that no activity occurred if capture was disabled, disconnected, or incomplete.

---

## 5. Planning and forecast timelines: living, not fictional

Planning timelines answer **what might happen next**, **what is scheduled**, **what depends on what**, and **which assumptions produced the estimate**. They MUST support rough natural-language planning as well as detailed engineering schedules.

Aerynth SHOULD support quick plans generated from a normal chat: a user discusses several potential tasks, then asks Vela to create a rough timeline. Vela identifies likely work, dependencies and uncertainty, and constructs an immediately editable timeline resource and workspace block. This is a forecast proposal, not automatic authorization to execute tasks.

**AW-TIME-031 — Natural-language creation.** Vela MUST be able, within supported capability and permission boundaries, to create or modify timeline resources from conversation and contextual-command requests without requiring manual scheduling setup.

**AW-TIME-032 — Explainable plan construction.** An AI-generated plan MUST expose relevant source references, identified tasks/milestones, dependencies, scope assumptions, resource/capacity assumptions, and unknowns.

**AW-TIME-033 — Explicit temporal status.** Each planned item MUST distinguish tentative, estimated, externally scheduled, user-committed, in progress, blocked, verified complete, canceled, or superseded states, as applicable.

**AW-TIME-034 — Uncertainty, not false precision.** Estimates MUST be labeled as estimates and SHOULD show ranges, confidence/calibration information, or scenarios where evidence is insufficient for a precise duration. An AI estimate MUST NOT be rendered as a guaranteed completion time.

**AW-TIME-035 — No fabricated capacity.** Scheduling MUST account for known concurrency, agent/tool availability, execution limits, resource contention, approvals, human input, and missing capacity data. Unknown capacity MUST remain unknown, not become unlimited.

**AW-TIME-036 — User-owned commitments.** Suggested dates, scope changes, and execution sequencing MUST NOT silently become binding user commitments, deadlines, scheduled automations, deployments, or agent authorizations.

**AW-TIME-037 — Versioned forecasts.** Material forecast updates MUST preserve previous baselines and identify the input, assumption, observation, or user action that caused the revision.

**AW-TIME-038 — Living updates.** Plans SHOULD respond to verified milestone completion, blockers, task changes, delay, cancellation, capacity changes, and approved reassignment; automatic updates MUST obey user settings and display what changed.

**AW-TIME-039 — Scenario comparison.** Users SHOULD be able to compare alternative sequences, resource allocations, and optimistic/baseline/conservative assumptions without overwriting the accepted baseline.

**AW-TIME-040 — Forecast provenance.** Estimates SHOULD identify whether they came from measured comparable work, user input, static rules, external schedules, AI heuristics, or a combination, and SHOULD disclose calibration limitations.

**AW-TIME-041 — Milestone integrity.** A completed-looking milestone MUST NOT imply verified acceptance unless the governing task or verification source reports the required evidence.

**AW-TIME-042 — Explicit manual overrides.** A user MUST be able to change target dates, assumptions, order, and estimates with a visible effective scope; future automatic recalculation MUST respect locked values and explain conflicts.

---

## 6. Dependency and scheduling intelligence

Dependency timelines express relationships among tasks, agents, approvals, resources, milestones, and external conditions. A graph or Gantt-like view is a representation of typed facts and assumptions, not a source of authority over task execution.

**AW-TIME-043 — Typed dependencies.** Dependencies MUST distinguish, where applicable, finish-to-start, start-to-start, finish-to-finish, hard blocker, soft preference, shared-resource conflict, review gate, external wait, and informational relationship.

**AW-TIME-044 — Direction and evidence.** Every consequential dependency MUST have a stable reference, direction, owning source, status, and whether it is declared, verified, or inferred.

**AW-TIME-045 — Cycles and impossibilities.** The scheduler MUST detect circular hard dependencies and contradictory constraints, explain them, and avoid displaying a falsely executable plan.

**AW-TIME-046 — Parallelism by feasibility.** Independent work SHOULD be displayed and scheduled in parallel where authorized and viable; overlapping tasks that share mutable files, working environments, databases, or live-world state MUST represent relevant contention and isolation constraints.

**AW-TIME-047 — Critical path honesty.** If a critical path or slack is computed, Aerynth MUST identify the underlying duration assumptions and graph completeness. It MUST NOT claim mathematically definitive criticality when required durations or dependencies are unavailable.

**AW-TIME-048 — Blocker propagation.** A newly blocked, delayed, or failed predecessor SHOULD update dependent forecast states and highlight impact, subject to policy and available data.

**AW-TIME-049 — Review and approval gates.** Human authorization or verification gates MUST remain explicit dependencies and MUST NOT be treated as automatically fulfilled by elapsed time or an agent claiming it finished.

**AW-TIME-050 — Bottleneck exploration.** Users SHOULD be able to ask Vela for a grounded explanation of bottlenecks, possible parallelization, and tradeoffs; recommended changes MUST remain distinguishable from executed reassignment.

**AW-TIME-051 — Alternate views.** The same dependency data MUST support at least a comprehensible compact summary and a deeper visual graph/timeline view, without forcing users to interpret an unreadable constellation.

---

## 7. Replay: a truthful flight recorder

Replay is the reconstruction of **captured observable history** and **reconstructable UI/system state**. It MUST NOT imply access to raw hidden model reasoning, unrecorded desktop actions, unsampled frames, missing external logs, or the complete state of a system outside the recorded observation scope.

Two concepts MUST remain distinct:

- **Observational replay:** scrub through captured messages, tool executions, state transitions, captured artifacts, and other recorded events.
- **State reconstruction:** derive a selected supported state from versioned events and snapshots.

Neither means re-running the original commands. Re-execution is a separately authorized operation with potentially different effects.

**AW-TIME-052 — Explicit replay scope.** Every replay MUST declare its subject, coverage interval, included sources, reconstruction mode, and meaningful omissions.

**AW-TIME-053 — No fabricated frames or thoughts.** Replay MUST NOT invent intermediate tool states, exact visual frames, exact model internal thoughts, or nonexistent causal links. Interpolation for visual smoothness MUST be distinguishable from event evidence.

**AW-TIME-054 — Event-based fidelity.** Captured event order, IDs, parent links, status transitions, and payload/evidence references MUST be preserved or be traceably transformed, with source fidelity and schema version available for inspection.

**AW-TIME-055 — Deterministic where possible.** Given the same retained event set, snapshots, policy, and replay version, event-driven reconstruction SHOULD yield equivalent supported state. Non-deterministic views MUST declare their limitations.

**AW-TIME-056 — No implicit side effects.** Moving a replay cursor, playing a replay, or inspecting a historic command MUST NOT execute commands, repeat API calls, mutate files, approve requests, or schedule work.

**AW-TIME-057 — Replay controls.** Users MUST be able to pause, play, step, seek, change speed, and inspect individual events. Jumping to an event SHOULD restore the supported surrounding task/chat/agent context.

**AW-TIME-058 — State-at-time qualification.** Aerynth MUST distinguish reconstructed state, source-supplied snapshot, inferred state, and unknown state at a selected instant. Missing initial snapshots or event gaps MUST limit claims accordingly.

**AW-TIME-059 — State/evidence synchrony.** During replay, associated panes such as chat, agent streams, terminal output, profiler, file changes, and task state SHOULD synchronize to the same logical cursor where captured data permits.

**AW-TIME-060 — Replay branching is not execution forking.** A replay inspection cursor, conversation fork, alternate forecast scenario, and new live agent execution MUST have separate identities and controls.

**AW-TIME-061 — Correction and redaction.** If historical records are corrected, redacted, expired, or deleted under applicable policy, replay MUST respect that state and disclose gaps or altered fidelity without revealing removed content.

**AW-TIME-062 — Deep-link replay.** Authorized users SHOULD be able to preserve a stable reference to a particular timeline, time range, event, and reconstruction version for later navigation and review.

**AW-TIME-063 — Coverage-aware export.** Replay and history exports MAY be supported, but exported material MUST preserve provenance, redaction policy, coverage notices, and a distinction between raw events and derived narrative.

---

## 8. Conversation, branch, and decision timelines

Conversations are not simply rows of messages. Their temporal structure includes turns, tool activity, edits, revisions, decisions, forks, sibling-branch findings, annotations, and interruptions.

**AW-TIME-064 — Conversation chronology.** A conversation timeline MUST be able to reference message and turn identities, execution periods, relevant tool activity, and indexed decisions without rewriting the canonical transcript.

**AW-TIME-065 — Branch topology.** Connected Branches MUST be representable as a shared ancestry followed by independently evolving histories, with cross-branch knowledge transfers shown as explicit links rather than merged transcripts.

**AW-TIME-066 — Provenance across branches.** A finding imported from a sibling branch MUST retain origin branch, source record, evidence status, transfer time, and receiving-context status as available through 04 and 08.

**AW-TIME-067 — Temporal context recovery.** Users SHOULD be able to select an earlier conversation region and ask Vela to recover relevant context, decisions, or evidence through CIE. This MUST NOT automatically replace the active chat history or pretend the model retained it continuously.

**AW-TIME-068 — Notes and decisions.** Linked notes, user Thought Stream entries, decision records, and knowledge promotions MAY be represented chronologically, but their epistemic status and authorship MUST remain governed by Charter 07.

**AW-TIME-069 — Branch comparison.** Users SHOULD be able to compare branch development over a selected interval and identify genuine divergence, shared findings, and unresolved conflicts without requiring all messages from all branches to enter a model context.

---

## 9. Project timelines, milestones, and return-to-work

Project timelines bring together selected work across tasks, agents, chats, resources, releases, notes, external references, and verified outcomes. The user should be able to obtain a meaningful overview without managing a formal project schedule.

**AW-TIME-070 — Scope-aware project view.** Project and workspace timelines MUST resolve canonical associations from Charter 03 and MUST respect the selected resource scope, permissions, filters, and relevant project boundaries.

**AW-TIME-071 — Milestone state.** Milestones MUST distinguish proposed, scheduled, observed/achieved, verified, and withdrawn states where meaningful; a visual marker alone MUST NOT assert completion.

**AW-TIME-072 — View across granularity.** Users SHOULD be able to move from a high-level milestone overview to the underlying tasks, agent executions, conversations, and evidence without losing navigational orientation.

**AW-TIME-073 — Historical versus forecast overlay.** Timelines MAY overlay actual history and projected work, but MUST visually and semantically distinguish them, including the point at which observed progress ends and forecast begins.

**AW-TIME-074 — Per-user review semantics.** "New since last visit," "unseen," "reviewed," "dismissed," "resolved," and "approved" MUST be distinct states. Opening the application or moving a replay cursor MUST NOT automatically mark unrelated events reviewed.

**AW-TIME-075 — Attention-aware digest integration.** Vela SHOULD be able to open the relevant timeline interval from a welcome-back summary or notification. Digest grouping and interrupt policy remain governed by Charter 06.

**AW-TIME-076 — Unavailable interval disclosure.** If the application was closed, offline, or monitoring disabled, project timelines MUST indicate gaps unless external events have actually been reconciled; absence of captured events MUST NOT be reported as inactivity.

**AW-TIME-077 — Relevant temporal search.** Users SHOULD be able to search time windows, task states, actors, topics, source types, and linked evidence, including natural-language requests such as "what changed before this regression?"

---

## 10. Vela, natural language, and Contextual Command

Vela should make temporal work feel like a native part of the environment rather than a separate planning application.

Illustrative requests:

- "Give me a rough timeline for the three tasks we just discussed and put it beside this chat."
- "Show what happened from the first failing build until the fix was verified."
- "Which dependencies are slowing down this project?"
- "What changed between these two agent runs?"
- "Move these milestones to next week, but keep the approved release date."
- "Show me all the things I haven't reviewed since yesterday."
- "Compare the original plan with what actually happened."

**AW-TIME-078 — Contextual scope interpretation.** A selection provides a referent, not necessarily the command's full scope. Vela MUST interpret selected events, messages, task nodes, graph regions, and surrounding context alongside the user's expressed intent.

**AW-TIME-079 — Action preview and authority.** Material changes to schedules, task assignments, external calendars, notifications, or automations MUST respect governing approval policy and reveal affected scope before consequential actions.

**AW-TIME-080 — Native object operations.** Timeline creation, editing, filtering, navigation, and placement SHOULD use validated application operations and stable IDs rather than simulated clicks or unverified natural-language actions.

**AW-TIME-081 — Immediate usable result.** A successful "create a timeline" request MUST yield an identifiable, inspectable timeline resource and an accessible presentation, normally in the current workspace unless requested otherwise.

**AW-TIME-082 — Explainable answers.** When Vela gives a temporal explanation or recommendation, it SHOULD link the relevant items, evidence, assumptions, missing information, and uncertainty, subject to authorized scope.

**AW-TIME-083 — Conversational convenience.** Users MUST be able to discuss a timeline within an ordinary chat without being forced to create tasks, enable orchestration, or invoke formal planning mode.

**AW-TIME-084 — Progressive complexity.** Simple requests SHOULD result in understandable, lightweight timelines; advanced scheduling controls and diagnostics MUST remain accessible without overwhelming everyday use.

---

## 11. Workspace blocks, Liquid Intelligence, and multiple displays

A timeline is a canonical **resource**; the visual timeline is one or more **block instances** bound to it. Blocks may show different ranges, filters, scales, and presentation modes while preserving the underlying timeline identity.

A request for a new timeline SHOULD produce spatial continuity: the current workspace makes room, a timeline block emerges, items arrive meaningfully, dependencies animate into place, and linked activity becomes visible. Motion is coordinated through Charter 02, not reimplemented independently in each timeline component.

**AW-TIME-085 — First-class blocks.** Timeline resources MUST be supportable through movable, resizable, dockable, focusable, and restorable workspace blocks under Charter 03.

**AW-TIME-086 — Multiple views of one timeline.** Separate blocks and display windows MAY show different views of the same timeline, but their modifications MUST resolve against one canonical resource with controlled concurrency.

**AW-TIME-087 — Meaningful motion.** Animations MUST communicate creation, relationships, state changes, temporal movement, focus, or other meaningful transitions; decorative effects MUST NOT obscure truth labels or disguise missing data.

**AW-TIME-088 — Temporal orientation during transitions.** Zooming, panning, filtering, changing granularity, switching layout, and moving between monitors SHOULD preserve recognizable anchors and visual continuity when feasible.

**AW-TIME-089 — Linked interactions.** Selecting an event SHOULD reveal related resources and compatible views, and selecting a linked chat, task, agent, or file SHOULD offer a jump to its relevant timeline interval.

**AW-TIME-090 — Accessible non-motion equivalents.** Essential timeline information and controls MUST remain operable with keyboard and assistive technology, have distinguishable textual/state alternatives, and honor reduced-motion settings without removing needed information.

**AW-TIME-091 — Clarity before spectacle.** Labels, uncertainty, dependencies, density, overlap, and gaps MUST remain decipherable under the cinematic visual design. The system SHOULD provide uncluttered summaries, focus/highlight modes, and list/table alternatives to dense graphs.

**AW-TIME-092 — Display-aware continuity.** Timeline placement and viewing state SHOULD cooperate with Aerynth's multi-display layout restoration without causing loss or duplication of canonical timeline data.

---

## 12. Event ingestion, synchronization, and reliability

This charter does not specify the Event Bus protocol; it requires temporal consumers to handle real-world delivery behavior correctly. Source events may arrive late, duplicate, out of order, be amended, or disappear under authorized retention policy.

**AW-TIME-093 — Idempotent projection.** Timeline projections SHOULD use stable event IDs and versions to prevent duplicate rendering or duplicate state transitions on retry or reconnect.

**AW-TIME-094 — Correctable ordering.** Late, corrected, or out-of-order events MUST be incorporable without losing user annotations or silently reauthoring history.

**AW-TIME-095 — Source-state reporting.** Real-time timelines MUST indicate current, stale, reconnecting, paused, simulated, or unavailable source states when material.

**AW-TIME-096 — Safe incremental updates.** Live updates SHOULD preserve user selections, scroll position, zoom, review cursor, and open inspector state rather than unexpectedly shifting the entire view.

**AW-TIME-097 — Crash and restart recovery.** Persisted timeline configuration, approved edits, baseline/scenario versions, references, annotations, and available review state MUST survive ordinary application restart and recoverable interruption.

**AW-TIME-098 — Error containment.** An invalid event, disconnected source, failed forecast calculation, or partial index MUST NOT corrupt other timelines or silently overwrite authoritative project/task state.

**AW-TIME-099 — Partial-coverage honesty.** A timeline projection MUST distinguish no matching events from incomplete ingestion, denied access, unindexed material, and absent source data.

**AW-TIME-100 — Source-independent rendering.** The temporal interface MUST remain browsable for available local history and planning data when the AI backend is offline, with unavailable live operations properly disabled or labeled.

---

## 13. Privacy, security, consent, and recoverability

Timelines can unintentionally reveal sensitive work rhythms, personal notes, files, conversations, system monitoring, and cross-project associations. Chronological correlation does not override access permissions.

**AW-TIME-101 — Permission-aware queries.** Timeline aggregation, search, replay, and export MUST honor the source-level and user-level access policies owned by Charter 14 and the underlying resource.

**AW-TIME-102 — No privilege escalation through aggregation.** A cross-project or global timeline MUST NOT reveal otherwise inaccessible content merely by connecting events, titles, timestamps, metadata, or redacted evidence.

**AW-TIME-103 — Retention and deletion.** Timeline caches, derived views, exports, snapshots, and replay indexes MUST participate in applicable retention, deletion, and redaction workflows; deleted content MUST NOT be recoverable through a stale timeline projection.

**AW-TIME-104 — Consequential edits.** User- and agent-initiated changes to actual tasks, commitments, assignments, schedules, or external resources MUST use validated, attributable operations and appropriate preview/approval behavior.

**AW-TIME-105 — Audit trail.** Consequential timeline operations MUST record who/what initiated them, target, effective scope, prior/new version, result, and relevant authorization or failure references where permitted.

**AW-TIME-106 — Undo semantics.** Reversible presentation and planning edits SHOULD support undo; actions that cannot be undone MUST be labeled clearly. Undo MUST NOT pretend to reverse already executed external actions.

**AW-TIME-107 — Sensitive examples.** Public source, screenshots, fixtures, and demonstrations MUST use synthetic or explicitly cleared data, not copied user conversations, personal activity traces, private deployment logs, or secrets.

---

## 14. Performance, efficiency, and scalability

Historical activity may span years, millions of events, multiple displays, and dense agent execution. The interface must remain responsive without forcing those records into a model context.

**AW-TIME-108 — Bounded visible rendering.** Long timelines SHOULD use virtualization, aggregation, progressive detail, and indexed range queries rather than rendering all historical items at once.

**AW-TIME-109 — Adaptive fidelity.** Continuous rendering, motion detail, line density, and background animation SHOULD adapt to device load and focus state under the platform/motion charters, without hiding critical content.

**AW-TIME-110 — Visible data completeness.** Aggregation and level-of-detail reduction MUST preserve access to retained source items and disclose that data is summarized or sampled.

**AW-TIME-111 — Context-efficient explanations.** Vela and CIE MUST retrieve scoped event ranges, source links, summaries, and evidence according to need rather than automatically placing an entire timeline or event history into model context.

**AW-TIME-112 — Measured latency.** Timeline opening, seeking, zooming, update propagation, large-history queries, and replay reconstruction SHOULD have defined measurable performance budgets in the relevant technical specification and acceptance suite.

**AW-TIME-113 — No false progress.** Loading animations, forecast indicators, replay playback, or agent-activity effects MUST NOT pretend that unknown task progress or hidden model reasoning has been measured.

---

## 15. Conceptual data and service contracts (implementation-neutral)

The concrete wire schema and storage layout belong in subordinate technical specifications. At minimum, the following conceptual information must be supportable.

### 15.1 Timeline resource record

| Field family | Representative content |
|---|---|
| Identity | timeline ID, version, creator, ownership scope |
| Family | historical, forecast, dependency, replay, conversation, project, or composite |
| Query scope | projects, agents, tasks, chats, resource IDs, time boundaries |
| Presentation | scale, timezone, lane/grouping, filters, selected event, layout preferences |
| Source state | adapters, coverage windows, ingestion cursor, gaps, freshness |
| Forecast state | baseline, assumptions, scenario versions, revision provenance |
| Policy | authorized visibility, export restrictions, retention behavior |
| Links | canonical resource bindings and stable annotations |

### 15.2 Historical temporal item

| Field family | Representative content |
|---|---|
| Source | event ID, source system, resource IDs, actor, parent/correlation IDs |
| Time | event/observed/ingest timestamps, precision, offset, clock uncertainty |
| Nature | point or interval, event type, observed/reported/inferred classification |
| Outcome | state transition, result, status, error, verification |
| Evidence | references to retained payloads, outputs, files, messages, approvals |
| Completeness | gap marker, source health, redactions, correction/version lineage |

### 15.3 Planned/forecast item

| Field family | Representative content |
|---|---|
| Identity | plan item ID, linked task/milestone IDs, scenario/baseline |
| Intent | description, requested objective, estimated scope, responsible actors |
| Temporal model | user dates, expected durations/ranges, earliest/latest bounds |
| Constraints | typed dependencies, approval gates, capacity assumptions |
| Status | proposed, in progress, blocked, complete, canceled, superseded |
| Uncertainty | confidence/calibration, origin of estimate, unverified inputs |
| Revision | previous estimate, change reason, author/agent, timestamp |

### 15.4 Service interfaces

| Service boundary | Conceptual operations |
|---|---|
| Timeline Registry | create, resolve, archive, duplicate view configuration, list scoped timelines |
| Historical Projection | query bounded interval, group, classify, correlate, annotate, inspect coverage |
| Forecast Service | estimate, revise, compare scenario, explain uncertainty, retain baseline |
| Dependency Service | link/unlink, validate graph, detect cycle, derive constraints and blocker impacts |
| Replay Service | open, seek, step, play, pause, reconstruct, inspect fidelity/gaps |
| Timeline Interaction | select typed region, zoom, pan, focus, attach to workspace, invoke command |
| Vela Temporal Tools | interpret scoped request, draft proposal, present timeline, explain evidence |
| Review/Attention | inspect review cursor, mark explicit review, filter unseen, link digest |
| Authorization/Audit | validate scope, preview changes, approve, execute, log, undo when supported |

**AW-TIME-114 — Typed temporal contracts.** Interfaces MUST validate identifiers, time semantics, version state, source ownership, and permission scope. Unstructured text alone MUST NOT be treated as authorization to change real schedules or resources.

**AW-TIME-115 — Provenance-preserving projections.** Timeline computations and exports MUST retain source references and transformation/version information sufficient to explain displayed outcomes.

**AW-TIME-116 — Evolvable schemas.** Persisted timeline and replay formats MUST be versioned with defined compatible migration or honest read-only fallback behavior.

**AW-TIME-117 — Source-of-truth boundaries.** Temporal services MUST NOT independently redefine canonical task status, chat content, note authority, token measurements, or event provenance owned by other subsystems.

---

## 16. Cross-charter integration contracts and boundaries

| Charter | Contract supplied to timelines | What remains authoritative there |
|---|---|---|
| 00 Constitution | Global principles; AW-CON-066–068; trust and performance invariants | Highest project governance |
| 01 Experience | Contextual selection, universal command, navigation/focus | Interaction semantics beyond temporal objects |
| 02 Liquid Intelligence | Motion Coordinator, material/particle/semantic transitions | Rendering physics and accessibility motion policy |
| 03 Resources | Canonical timeline resource ID, block placement, project/collection links | Object identity, membership, layout, settings inheritance |
| 04 Conversations | Message/turn/branch identity, provenance, branch transfer links | Canonical transcript and fork/connected-branch semantics |
| 05 Agents/Tasks | Task states, dependencies, milestones, verification and delegation | Canonical task/execution lifecycle and authorization |
| 06 Vela | Attention profiles, initiative, preferences, context envelope and return digest | Assistant behavior and review-notification policy |
| 07 Notes | User Thought Stream entries, decisions, annotations, knowledge authority | Note authorship, epistemic classification, promotion |
| 08 CIE | Retrieval, context package, checkpoint and historical rehydration | Context ranking, compaction and memory integrity |
| 09 Observability | Event bus, event IDs, capture truth classes, coverage, correlation | Canonical observed events and replay evidence fidelity |
| 10 Profiler | Timing, token data, efficiency and measurement provenance | Measurement methodology, usage totals and budgets |
| 12 Codex | Supported thread/turn/tool event capability adapters | Backend protocol and feature parity |
| 13 Platform | Multi-monitor, frame/resource budgets, renderer capability | Platform mechanics and performance compliance |
| 14 Trust | Permissions, retention, deletion, approvals and audit policy | Security and autonomy policy |
| 15 Quality | Systemwide quality gates and verification evidence | Global acceptance procedure |
| 16 Delivery | Approved milestones, planning and engineering change history | Development process |

**AW-TIME-118 — Explicit ownership.** Changes to any integrated interface MUST identify its owning charter; this document MAY impose timeline-specific consumption requirements but MUST NOT silently change adjacent subsystem meanings.

**AW-TIME-119 — Pending-charter safety.** Where a coordinating charter is not yet published or accepted, timeline work MAY use a clearly marked provisional contract consistent with the Constitution, but MUST NOT treat a speculative integration as approved policy.

---

## 17. Mandatory acceptance scenarios

The following scenarios are required acceptance targets for a feature-complete temporal subsystem. Partial milestones MAY implement subsets with truthful labels, but release claims MUST identify their coverage. Verification evidence SHOULD combine automated checks, instrumented runs, visual review, accessibility review, and adversarial/failure cases.

| ID | Scenario | Required observable result |
|---|---|---|
| AW-TIME-AT-01 | User asks in a normal chat for a rough timeline of three discussed tasks | Vela identifies tasks and uncertainty, creates an inspectable timeline resource and a workspace block, and does not silently start agents |
| AW-TIME-AT-02 | User asks "show what happened from the first test failure until the fix" | Historical interval links actual failing and passing evidence, clearly exposing any missing source data |
| AW-TIME-AT-03 | Remote agent timestamps are skewed by several minutes | UI distinguishes source time from ingest time and warns that cross-source ordering is uncertain |
| AW-TIME-AT-04 | Multiple agents execute concurrently | Overlapping lanes preserve true concurrency, parent/child relationships, and event IDs |
| AW-TIME-AT-05 | A task-duration estimate lacks historical basis | Forecast is presented as uncertain/ranged or explicitly unknown, never a false exact completion time |
| AW-TIME-AT-06 | A blocking task overruns and a dependent task must wait | Forecast displays the blocker, changed dependencies, baseline-versus-current delta, and updated uncertainty |
| AW-TIME-AT-07 | A hard dependency cycle is introduced | System identifies the cycle and avoids presenting the schedule as feasible |
| AW-TIME-AT-08 | User changes a plan but not the task execution | Plan revision is recorded; no external work or calendar modification occurs without appropriate authorization |
| AW-TIME-AT-09 | User scrubs replay through a captured agent run | Captured events, supported state, tool output, and chat views synchronize; no command re-executes |
| AW-TIME-AT-10 | Replay crosses an offline capture gap | UI displays a coverage break, does not fill with fabricated intermediate events, and qualifies state-at-time fidelity |
| AW-TIME-AT-11 | A late event is received after a reconnect | Event appears at its source time with ingestion/correction lineage; duplicates are suppressed |
| AW-TIME-AT-12 | A source event is redacted or deleted under policy | Timeline and replay stop exposing protected content, while accurately communicating changed coverage |
| AW-TIME-AT-13 | User forks a conversation and both branches continue | Conversation timeline depicts shared ancestry, independent histories, and explicit cross-branch knowledge links |
| AW-TIME-AT-14 | User highlights one milestone and says "move all dependent tasks to next week" | Preview identifies the dependency-based scope, respects locked commitments and approvals, and does not limit scope to the one selected item |
| AW-TIME-AT-15 | User opens the app after being away | Timeline differentiates activity since visit from activity actually reviewed and discloses unavailable monitoring intervals |
| AW-TIME-AT-16 | User moves a timeline block to a second monitor and reconnects later | Same timeline identity and content remain intact; display layout restores within supported platform constraints |
| AW-TIME-AT-17 | Large history is zoomed and filtered repeatedly | User retains a stable selection, sees aggregate/sample indications, can drill into original retained items, and meets measured responsiveness budgets |
| AW-TIME-AT-18 | Reduced-motion and keyboard-only mode are enabled | Timeline remains fully understandable and navigable without cinematic animations or pointer gestures |
| AW-TIME-AT-19 | Vela answers "why is the project late?" | Response identifies evidence, blockers, forecast assumptions, unknowns, and links; conjecture is not presented as verified cause |
| AW-TIME-AT-20 | Model backend is unavailable | Existing local timeline resources, history, and manual plans remain usable; unavailable AI/realtime actions are honestly indicated |
| AW-TIME-AT-21 | Two timeline blocks edit the same forecast simultaneously | Revision/concurrency policy prevents silent lost updates, retains version lineage, and resolves or exposes conflicts |
| AW-TIME-AT-22 | One project links to a restricted resource | Aggregated timeline and search do not leak inaccessible titles, timestamps, details, or content through correlation |
| AW-TIME-AT-23 | A planned milestone is marked "finished" by an agent without tests | Visual status distinguishes claimed completion from verified acceptance and offers the underlying evidence |
| AW-TIME-AT-24 | Replay and a forecast scenario are displayed together | Distinct controls, labels, and visual encoding prevent users from mistaking reconstructed history for projected work |

### 17.1 Acceptance evidence requirements

**AW-TIME-120 — Traceable verification.** Acceptance evidence MUST identify requirements and scenario IDs, observed result, test environment and capability boundary, defects/gaps, and source artifacts appropriate to the test.

**AW-TIME-121 — Visual review requirement.** Feature-complete acceptance MUST evaluate temporal readability, clarity of uncertainty, interaction continuity, motion/zoom behavior, relationship comprehension, and the experience of Vela constructing a workspace timeline.

**AW-TIME-122 — Adversarial temporal test cases.** Tests MUST include missing timestamps, out-of-order events, clock drift, DST transitions, duplicate events, redaction, incomplete snapshots, simultaneous edits, and unsupported backend capabilities.

**AW-TIME-123 — Outcome verification.** A technically functioning timeline is not sufficient if users cannot reliably tell what actually happened, what is estimated, where evidence is missing, and what action they are authorizing.

---

## 18. Constitutional and subsystem traceability

| Governing concern | Primary requirements here | Constitution |
|---|---|---|
| Truthful, usable temporal identity | AW-TIME-001–010 | AW-CON-002, 004–006, 066 |
| Time correctness and source integrity | AW-TIME-011–020 | AW-CON-058–060, 063, 066 |
| Historical evidence and coverage | AW-TIME-021–030 | AW-CON-057–061, 066, 068 |
| Living planning and forecasts | AW-TIME-031–042 | AW-CON-041, 047, 066–067 |
| Dependencies and orchestration | AW-TIME-043–051 | AW-CON-041, 047–050, 067 |
| Replay and reconstruction | AW-TIME-052–063 | AW-CON-002, 058–061, 066 |
| Chat and Connected Branch time | AW-TIME-064–069 | AW-CON-031–035, 042–046 |
| Project, digest, attention time | AW-TIME-070–077 | AW-CON-022–030, 036–041, 068 |
| Vela Contextual Command | AW-TIME-078–084 | AW-CON-011–015, 036–041 |
| Motion, blocks, displays | AW-TIME-085–092 | AW-CON-016–030, 074–078 |
| Reliability and data lifecycle | AW-TIME-093–107 | AW-CON-058–061, 069–073 |
| Performance and CIE | AW-TIME-108–113 | AW-CON-051–056, 062–065, 074–078 |
| Contracts, governance, testing | AW-TIME-114–123 | AW-CON-004–005, 079–083 |

Where this map names an unpublished coordinating charter, the cross-reference is an intended integration boundary, not evidence that the charter is already ratified. Subsequent charters MUST preserve the canonical temporal ownership established here once accepted.

---

## 19. Open technical and product research decisions

The following are explicitly **not settled by this charter**:

1. Whether the canonical event history is event-sourced, log-structured, or another versioned storage model; and how snapshot acceleration is implemented.
2. The indexed temporal query strategy and durability/retention tradeoffs for very large local histories.
3. Which chart/timeline rendering technologies deliver the required Liquid Intelligence look while sustaining low CPU/GPU usage.
4. How animations synchronize across separate native windows and multiple monitors.
5. Exact temporal query and replay APIs, serialization, schema evolution, and export formats.
6. Clock synchronization and confidence estimation across remote sources with varying trust/precision.
7. Forecast calibration datasets, scheduling algorithms, critical-path uncertainty, and human/agent capacity modeling.
8. Which source-level evidence can be captured for each Codex backend version or external integration.
9. Which derived summaries and replay snapshots can be safely cached given privacy and deletion requirements.
10. Precise reduced-motion behaviors, keyboard interaction models, and large-screen/compact-screen design patterns.
11. Performance budgets, stress-test data sizes, and production telemetry collection methods.
12. How user review state synchronizes across devices/accounts if collaboration or sync is implemented.

These questions SHOULD be resolved through documented research, representative prototypes, measured acceptance tests, and architecture decision records. A technical choice MUST NOT lower the behavioral baseline without an explicit governance change.

---

## 20. Publication, change control, and owner acceptance

This document is a **published proposed charter**, not an assertion that all capabilities already exist. It becomes binding as an approved specialized charter only through repository-owner acceptance under the Constitution's governance process.

**AW-TIME-124 — Explicit acceptance.** Publication or an agent's successful commit MUST NOT be represented as owner ratification.

**AW-TIME-125 — Changes require impact review.** Amendments MUST identify affected requirement IDs, impacted contracts/charters, migration or compatibility implications, updated test evidence, and a recorded owner decision where required.

**AW-TIME-126 — No silent narrowing.** A partial implementation, temporary prototype, provider limitation, or missed milestone MUST NOT silently remove a normative capability from the long-term specification.

**AW-TIME-127 — Complete registry.** The governance index MUST identify this file's actual path, version, and publication/acceptance state accurately.

### Owner acceptance checklist

- [ ] Historical, forecast, dependency, replay, conversation, and project timelines are all represented.
- [ ] Actual, estimated, inferred, and unavailable temporal data remain distinct.
- [ ] Live timeline creation from an ordinary Vela/chat instruction is explicitly required.
- [ ] Dependencies, uncertainty, scenarios, living updates, and review/approval gates are protected.
- [ ] Replay is event/evidence-based, non-executing, privacy-aware, and honest about gaps.
- [ ] Connected Branches, CIE, user notes, Vela initiative, Intelligence Streams, and Profiler have clear non-overlapping ownership.
- [ ] Timeline blocks preserve resource identity and meet Liquid Intelligence interaction expectations.
- [ ] Accessible equivalents, multi-display behavior, context efficiency, and performance tests are covered.
- [ ] Acceptance cases include real-world timing failures, source gaps, and authorization ambiguities.
- [ ] No private history, personal notes, credentials, or actual captured operational records were placed in this public charter.

---

## Charter conclusion

**Aerynth treats time as navigable context.** The user can move between evidence-backed history, active work, possible futures, and faithful replay without losing the distinction between them. Vela can summon and explain a living timeline inside the workspace, while the system preserves source truth, uncertainty, authorization, clarity, and the visual continuity of Liquid Intelligence.

**A timeline is not merely an attractive chart. It is a trustworthy instrument for understanding and directing work through time.**

---

## Ratified amendment CF-2026-11-05: timelines as actual living instruments
> **OWNER-RATIFIED 2026-11-05.** Existing timeline editing, historical-versus-forecast and interaction requirements remain.

**AW-TIME-128 — Canonical event time.** Agent, tool, voice, approval and scheduled activity MUST attach to authoritative timestamped events, distinguishing observed time, source time, timezone and causality as appropriate.
**AW-TIME-129 — Actual direct editing.** A timeline presented as functional MUST support accessible navigation, pan/zoom, user-authorized point addition/editing/removal, revisions and persistent state, not only a static graphic.
**AW-TIME-130 — Historical truth.** Completed external events MUST be distinguishable from estimates, manually entered milestones, simulations and unverified claims.
**AW-TIME-131 — Non-false parallel graph.** Concurrent branches and causal joins MUST be understandable without presenting invented temporal dependencies between unrelated tasks.
**AW-TIME-132 — Replay isolation.** Historical replay MUST NEVER resubmit an agent task, external call, command or charge-bearing operation.
**AW-TIME-133 — Motion consistency.** Timeline, Intelligence Stream and Vela Mind MUST share canonical event state, motion semantics and reduced-motion accessibility without mutating task truth.

**Acceptance:** Add and edit a time point, display a live branched task, restart, scrub history, and demonstrate no external replay side effect.
