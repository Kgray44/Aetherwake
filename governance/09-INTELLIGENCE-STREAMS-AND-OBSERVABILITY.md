# 09 — Intelligence Streams and Observability
## Live Intelligence, Evidence, Execution Visibility, and Event Integrity Charter for Aerynth

| Field | Value |
|---|---|
| Document ID | AW-GOV-009 |
| Version | 1.0.0-draft |
| Status | **Published proposed subsystem charter — awaiting repository-owner acceptance** |
| Prepared | 2026-11-01 |
| Authority | Subsystem charter subordinate to [The Aetherwake Constitution](00-AETHERWAKE-CONSTITUTION.md) |
| Primary domain | Live and historical intelligence streams; event capture and integrity; agent/chat/task/Vela/project observability; provenance; correlation; trustworthy activity visualizations; event-based diagnostics and replay evidence |
| Normative requirement namespace | **AW-OBS-###** |
| Constitutional anchors | AW-CON-002, 004, 015–019, 026–028, 031–035, 036–046, 047–056, **057–061**, 062–068, 069–073, 075–083, 086–089 |
| Adjacent governing documents | 01 Experience; 02 Liquid Intelligence and Motion; 03 Projects/Resources; 04 Conversations; 05 Agents/Tasks; 06 Vela; 07 Notes; 08 CIE; **10 Execution Profiler**; **11 Timelines/Replay**; 12 Codex; 13 Platform; 14 Trust; 15 Quality; 16 Delivery |
| Implementation posture | Technology-neutral behavioral requirements. Specific event APIs, storage, renderers, transports, collection facilities, and performance thresholds require capability validation and design decisions. |
| Publication boundary | This is a **public product specification**, not a record of private user conversations, sensitive trace data, internal reasoning, credentials, or production telemetry. |

> **Governing promise:** In Aerynth, work must be understandable *while it is happening* and investigable *after it happened*. Vela, an individual chat, an agent, a task, an agent constellation, a workspace, and a project can each expose a coherent Intelligence Stream. Activity must be observable, attributable, navigable, visually meaningful, and useful for acting on the result.
>
> **Truth before spectacle:** Aerynth may represent observable work with extraordinary cinematic motion, but it MUST NOT fabricate internal thoughts, exact progress, causality, commands, completed work, or historical coverage. An honest “no new observable event” is preferable to a gorgeous lie.
>
> **One history; many views:** The activity list, live thought-summary surface, diagnostic inspection, spatial constellation, timeline, notification, and historical replay are coordinated projections of identified evidence, not independently invented narratives.

---

## 1. Purpose, authority, scope, and boundaries

This charter establishes the canonical requirements for collecting, normalizing, persisting, correlating, presenting, and explaining the *observable activity* of intelligent and conventional execution across Aerynth. It owns the requirements for Intelligence Streams and the event-observability foundation that makes those streams credible.

The Aetherwake Constitution remains supreme; the repository owner retains final decision authority. **MUST**, **MUST NOT**, **SHOULD**, and **MAY** have the Constitution's normative meanings. This charter cannot grant access to information that models, backend providers, tools, or operating systems do not expose.

**In scope:** stream identity and scope; live event transport and processing; lifecycle capture; provenance; observed versus reported versus inferred versus unavailable information; correlation and delegation; command/tool/file/change/approval evidence; activity summaries; event chronology; event integrity; meaningful stream visualizations; information density; interactive drilldown; export and inspection; reliable persistence; gap and recovery handling; privacy-aware collection; testable acceptance.

**Owned elsewhere:** personal user notes and captured ideas (07); memory inclusion and compaction policies (08); deep token accounting, profiler math, and budgets (10); timeline planning and replay *interaction mechanics* (11); intrinsic task completion semantics (05); Vela's initiative and attention policy (06); motion physics and cinematic materials (02); provider-specific protocols (12); final security enforcement and retention policy authority (14); platform performance budgets (13). This charter defines observability contracts those systems consume, and must link to their governing owners rather than duplicate or override them.

**AW-OBS-001 — First-class observability.** Aerynth MUST treat accurate, inspectable execution activity as a foundational product capability, not an optional developer-console feature.

**AW-OBS-002 — Source-bound claims.** Every specific claim that an operation, result, thought summary, file mutation, or delegation occurred MUST be supported by a captured or retrieved source, or explicitly presented as a separate inference.

**AW-OBS-003 — Scope separation.** Intelligence Streams MUST remain distinct from the user's personal Thought Stream; storing or displaying a note does not imply model execution, and displaying agent activity does not turn it into the user's note.

**AW-OBS-004 — Backend capability honesty.** Aerynth MUST detect or document which event classes an integration actually supports. Missing capabilities MUST appear as unavailable or partially observable, not as zero activity or claimed feature parity.

**AW-OBS-005 — Normal conversation preservation.** Observability MUST enrich ordinary chats without requiring the user to open a profiler, assign a task, or supervise an agent constellation to converse normally.

## 2. Terminology and information model

An **event** is an attributable observation, provider-reported message, user action, or explicitly labeled interpretation represented in a structured record. A **source** is the origin that supplied the event. A **trace** follows one logical activity or request through participating services. A **span** is a bounded observed operation or phase within that trace; parent-child relationships can link spans, while causal links can connect independent operations. An **execution** is a specific run or attempt; an **agent** is the durable worker/profile; a **task** is the durable objective; a **conversation** is the communications resource. These identities are not interchangeable.

An **Intelligence Stream** is a query and live subscription over one or more attributable records, with a scope, access policy, presentation rules, and history cursor. A **Thought View** is a readable projection of available reasoning summaries and work events; it is not a view into private raw chain-of-thought. A **replay** is reconstruction from recorded evidence with known completeness limitations. A **constellation** is a spatial representation of observable entities and their evidenced relationships.

**AW-OBS-006 — Stable object references.** Stream records MUST retain available stable identifiers for the source, workspace, project, chat/thread, task, execution/turn, agent, tool operation, and resource when applicable. Display names alone are insufficient identities.

**AW-OBS-007 — Canonical event identity.** Every ingested record MUST receive a stable local event identifier and preserve any original provider event identifier and source coordinates where available.

**AW-OBS-008 — Lossless attribution boundary.** Normalization MUST preserve source distinctions and important original metadata. Translation into Aerynth vocabulary MUST NOT erase whether a fact came from Codex, Vela, a local tool, a person, a monitor, or a derived analyzer.

**AW-OBS-009 — Multiple projection consistency.** The same event MUST have consistent identity and semantics when displayed in a chat stream, agent stream, global stream, replay timeline, or diagnostic inspector.

**AW-OBS-010 — Correct lifecycle modeling.** Aerynth MUST distinguish an agent profile from an individual run, a task from a run, and a conversation from its execution events. A completed turn MUST NOT imply its associated objective is verified complete.

**AW-OBS-011 — Linkable sources.** Where an event refers to an accessible file, message range, command output, test report, commit, approval, or task result, the stream SHOULD provide a durable navigation or evidence reference rather than reducing it to unsupported prose.

## 3. Four evidence classes and epistemic guarantees

**Observed:** An action or state directly captured through an authorized source or verified external observation, with its capture boundary identified. For example, a terminal process exit code captured by Aerynth is an observation that the process exited with that code; it is not automatically proof that the requested work succeeded.

**Reported:** A statement emitted by a model, agent, provider, or external service about its own state, progress, reasoning summary, or results. It may be useful but is not necessarily independently verified.

**Inferred:** Aerynth or Vela's analysis of observed/reported information: proposed explanations, suspected causes, relevance, confidence, or probabilistic associations. It must be distinguishable from source data.

**Unknown / unavailable:** Behavior or information that cannot be seen, was never emitted, was lost across a gap, was intentionally withheld, or is outside an integration's authority.

**AW-OBS-012 — Four-class representation.** Every reasoning/progress/causality presentation MUST distinguish observed, reported, inferred, and unknown/unavailable information in detail views and through comprehensible compact cues.

**AW-OBS-013 — No private-thought fiction.** Aerynth MUST NOT claim to disclose exact hidden reasoning, private chain-of-thought, undisclosed model steps, or full mental state. When available, reasoning summaries MUST be labeled as summaries or model-reported descriptions, not literal complete transcripts.

**AW-OBS-014 — No synthetic thinking filler.** The live UI MUST NOT emit plausible-sounding fabricated “thoughts” merely to make an inactive stream seem alive. It SHOULD show processing state and the age of the last observable update.

**AW-OBS-015 — No false precision.** Aerynth MUST NOT represent interval-based observations as exact per-token cognitive steps, identify all time before first output as “thinking,” or infer percent completion solely from elapsed time or token consumption.

**AW-OBS-016 — Provenance on interpretation.** Inferred statements MUST preserve links to the evidence used and identify whether they are an algorithmic heuristic, model-generated interpretation, or manually supplied assessment.

**AW-OBS-017 — Conflict visibility.** Contradictory agent reports, inconsistent state updates, and contradictory external evidence MUST be representable without silently promoting one to verified truth.

**AW-OBS-018 — Confidence is not verification.** High confidence, repeated assertions, or an impressive-looking graph MUST NOT convert an inference or agent report into an independently verified fact.

**AW-OBS-019 — Coverage disclosure.** Users MUST be able to tell whether a stream has complete known capture coverage, partial coverage, sampling, delayed collection, intentionally excluded sources, or disconnected periods.

**AW-OBS-020 — Human-readable uncertainty.** Normal views SHOULD communicate uncertainty plainly without cluttering every line with engineering metadata; detailed evidence and provenance MUST remain accessible on demand.

### 3.1 Model reasoning visibility

Model processing may generate visible messages, available reasoning summaries, plans, tool calls, or usage events. Provider capabilities vary by model and version. Internal hidden deliberation is not a user-readable event stream merely because an agent appears to be “thinking.”

Permitted presentation examples:

- “Agent is processing; last observable update 18 seconds ago” when the agent is active but no new event has arrived.
- “Model-reported summary: investigating possible dependency conflict” when supplied by the backend.
- “Observed: command started in a permitted working directory.”
- “Inferred: repeated file reads may be contributing to high token consumption,” with linked evidence.

Prohibited presentation examples:

- “Here is every thought the model had” absent actual supported disclosure.
- A fabricated sentence-by-sentence “inner monologue” while the model is silent.
- A definitive causal diagnosis inferred from correlation alone.
- Animations labeled “67% of reasoning complete” based on an arbitrary progress timer.

## 4. Stream scopes and composability

Aerynth MUST support stream surfaces that reuse the same canonical events.

| Stream | Primary question | Identity / inclusion rule |
|---|---|---|
| **Vela Intelligence Stream** | What has the persistent assistant observed, requested, delegated, or changed? | Vela-authored/actions, approved tool activity, assistant decisions and connected child work |
| **Chat Intelligence Stream** | What happened while this conversation was working? | Conversation-linked turns, summaries, tools, approvals, and associated execution records |
| **Agent Intelligence Stream** | What is this agent doing across its executions? | Stable agent identity plus selectable runs, tasks, projects, time span |
| **Task Intelligence Stream** | What work has been attempted toward this objective? | Task identity, including handoffs and multiple executions |
| **Agent Group / Constellation Stream** | How are cooperating workers progressing? | Group identity, scoped members and their actual delegation relationships |
| **Workspace Intelligence Stream** | What work is related to this working environment? | Workspace-linked resources/events according to permissions and association rules |
| **Project Intelligence Stream** | What has happened within this project? | Project membership, links, and event source permissions |
| **Global Intelligence Stream** | What permitted observable work is happening across Aerynth? | Explicitly authorized and visible sources; not “everything on the computer” |

**AW-OBS-021 — Required scopes.** The core model MUST support Vela, chat, agent, task, group, workspace, project, and global scopes, even if particular front-end block types are delivered incrementally.

**AW-OBS-022 — One activity, multiple memberships.** Events MAY appear in multiple streams without cloning their canonical record; a projection MUST preserve origin, identity, and access boundaries.

**AW-OBS-023 — Shared resource accuracy.** The same chat displayed in multiple workspaces MUST NOT become multiple distinct histories merely because it has multiple visual blocks.

**AW-OBS-024 — Membership changes.** Moving a chat/resource between workspaces MUST NOT rewrite prior capture history. Current membership and membership-at-event-time SHOULD be separately queryable where relevant.

**AW-OBS-025 — Filtering and subscriptions.** Streams MUST allow filters for time, event class, state, source, project, workspace, chat, agent, task, tool type, severity, evidence class, and reviewed/attention status as applicable. Filtered views MUST NOT pretend excluded events never existed.

**AW-OBS-026 — Nested drilldown.** From a project or group event, users SHOULD be able to open the specific task, agent execution, turn, command, and supporting evidence without manually searching unrelated histories.

**AW-OBS-027 — Scope visibility.** Every stream MUST make its inclusion criteria and active filters discoverable so the user knows exactly which activity is represented.

**AW-OBS-028 — User-defined streams.** Aerynth SHOULD support saved stream queries, custom block instances, pinned filters, and relevant combinations of streams, constrained by authorization.

## 5. Capture sources and event taxonomy

The Intelligence Event Bus should ingest through adapters, not by binding every visualization directly to a provider's transport. Expected source families include Codex/provider execution, Vela's native application actions, tool bridges, local terminals and file operations, Git/repository integrations, permission services, schedulers, background monitors, and user-originated activity that the user has authorized Aerynth to record.

The event taxonomy MUST be extensible, with known categories covering:

1. Session, thread, turn, and execution lifecycle.
2. Assistant/agent messages, available summaries, plans, status, and steps.
3. Tool invocation, queued/running/completed/failed/cancelled states, parameters, and outputs subject to redaction.
4. Terminal processes, working directory, process identity, output streams, exit status, and duration.
5. File read/write/patch operations, diffs, resource identifiers, and available revision evidence.
6. Git worktree, branch, commit, review, merge, and integration events from authorized sources.
7. Agent creation, assignment, delegation, handoff, suspension, retirement, and group membership.
8. Task objective, attempt, blocker, verification, review, integration, and delivery status events.
9. Approval request, authorization decision, policy change, and denied/expired requests.
10. Knowledge/context retrieval, context checkpoints, and compaction *events* (their content and policies belong to 07/08).
11. Token, latency, and capacity updates passed through to the separate profiler (10).
12. Scheduler triggers, monitor observations, notifications, and attention/acknowledgment changes.
13. Resource and relationship changes that are authorized for activity observation.
14. Stream connection, errors, gaps, replay availability, and capture-health state.
15. Explicit human annotations or corrections with attribution.

**AW-OBS-029 — Typed taxonomy.** Source adapters MUST emit documented event families and lifecycle transitions rather than collapsing all activity into free-text “agent is working” messages.

**AW-OBS-030 — Provider fidelity.** An adapter MUST preserve meaningful provider states and original references even when translating them to Aerynth's canonical taxonomy.

**AW-OBS-031 — Command evidence.** Where available and permitted, terminal/tool events MUST expose the command or tool identifier, arguments in safe form, environment reference, start/end times, lifecycle, exit/error, and bounded access to captured outputs.

**AW-OBS-032 — File-change fidelity.** A file-modification event MUST distinguish intent to edit, patch proposal, attempted write, successful write, diff review, committed change, and verified behavior. Observed mutation does not prove tests passed.

**AW-OBS-033 — Approval transparency.** Requests requiring human action MUST capture the requested operation, interpreted scope, applicable permission boundary, request time, decision, decision actor, and observed execution outcome without exposing secrets unnecessarily.

**AW-OBS-034 — Delegation trace.** Parent-to-child delegation MUST establish durable references among requesting agent/assistant, task, child agent, child execution, and resulting handoff or completion evidence.

**AW-OBS-035 — User action attribution.** The event model MUST distinguish user requests and manual edits from autonomous work, provider actions, local application automation, and externally observed events.

**AW-OBS-036 — Capabilities registry.** Each adapter SHOULD publish available event families, sampling/coverage conditions, permission needs, version compatibility, and unsupported fields.

**AW-OBS-037 — Graceful omissions.** The UI MUST handle absent optional events, missing commands, hidden arguments, unreported usage, and unsupported provider features without generating invented substitutes.

## 6. Canonical event envelope and schema evolution

The event envelope is an implementation-neutral *logical contract*, not a commitment to JSON, Protobuf, SQLite, or a specific broker. Individual event payload schemas require separate interface specifications.

Minimum conceptual fields:

| Group | Expected fields / semantics |
|---|---|
| **Identity** | Local event ID, source system, optional provider ID, event type, schema version |
| **Placement** | Project/workspace/resource/chat/agent/task/execution/turn identifiers when applicable |
| **Causality** | Trace ID, span ID, parent span/event ID, explicit relationship links, delegation origin |
| **Time** | Source event timestamp, observation/ingestion timestamp, monotonic elapsed time when locally measured, time-source quality |
| **Ordering** | Source sequence/cursor, capture order, correlation confidence, known gaps |
| **Lifecycle** | Started/updated/completed/failed/cancelled/interrupted/unknown or relevant typed states |
| **Evidence** | Observed/reported/inferred/unavailable class, adapter/source, confidence only when meaningful, evidence pointers |
| **Content** | Typed payload, safe summary, redacted fields, storage pointer for large outputs, optional raw-source envelope |
| **Security** | Sensitivity classification, access scope, collection policy, redaction status, retention class |
| **Integrity** | Deduplication key, revision/supersession links, capture health, schema migration markers |

**AW-OBS-038 — Versioned envelope.** Canonical events MUST have a documented versioned schema with explicit optional fields and forward/backward compatibility handling.

**AW-OBS-039 — Multiple clock semantics.** Capture MUST distinguish source-supplied wall-clock time from local observation time and monotonic durations where measured. Clock skew and precision limits MUST NOT be silently erased.

**AW-OBS-040 — Explicit partial ordering.** Source ordering MUST be preserved when available. Events from independent agents/systems MUST NOT be given a falsely certain universal chronological or causal order merely because their timestamps are close.

**AW-OBS-041 — Trace and span lineage.** Correlated work SHOULD carry trace/span or equivalent stable correlation keys, including parent-child/delegation links when known; inferred links MUST be labeled differently from explicit ones.

**AW-OBS-042 — Lifecycle reconciliation.** A started operation without a corresponding completion event MUST remain in an unknown/interrupted/reconciling state until trustworthy evidence resolves it. It MUST NOT be assumed successful.

**AW-OBS-043 — Additive corrections.** Corrections, retractions, and supersession SHOULD be represented with attributable events or versioned relationships, rather than silently rewriting historical evidence.

**AW-OBS-044 — Extensible event families.** Third-party integrations MAY contribute typed events through a documented registration and validation interface without gaining unrestricted access to the full event store.

**AW-OBS-045 — Bounded payloads.** Large logs, images, diffs, binary artifacts, and verbose outputs MUST be stored or referenced safely without requiring every subscriber to load full payloads. The underlying record MUST preserve required evidence subject to policy.

**AW-OBS-046 — Data-minimizing identifiers.** Correlation IDs SHOULD avoid leaking credentials, file contents, private personal information, or sensitive external identifiers into ordinary UI labels and logs.

### 6.1 Example logical event (illustrative, not a mandated wire format)

    event_id: local-event-123
    source: codex-adapter
    event_type: tool.execution.started
    evidence_class: observed
    project_ref: project-abc
    conversation_ref: chat-def
    agent_ref: agent-ghi
    task_ref: task-jkl
    execution_ref: execution-mno
    trace_id: trace-pqr
    span_id: span-stu
    parent_span_id: span-parent
    occurred_at: source-reported-time
    observed_at: local-ingestion-time
    source_sequence: 42
    lifecycle_state: running
    summary: "Test command started"
    payload_ref: evidence://tool-operation-123
    coverage_status: current

This example contains no actual private data and does not assert that a specific provider emits these exact fields.

## 7. Ingestion architecture, state, durability, and recovery

The recommended conceptual path is **source adapters → validation and normalization → Intelligence Event Bus → durable event store → materialized projections → stream subscriptions → UI and analytics**. Implementations MAY vary, but they MUST preserve the behavior guarantees in this charter.

**AW-OBS-047 — Single canonical event pipeline.** Source adapters MUST enter a consistent validation and persistence process before events are treated as durable history. UI projections MUST NOT be the sole copy of captured events.

**AW-OBS-048 — Persist-before-ack discipline.** When a source supports acknowledgments or resumable cursors, the implementation SHOULD acknowledge progress only after corresponding records are durably captured.

**AW-OBS-049 — Delivery reconciliation.** Because upstream sources may retransmit events, ingestion MUST deduplicate safely using stable source identities and sequence data when available. An at-least-once transport MUST NOT produce duplicate displayed commands or double-counted usage.

**AW-OBS-050 — Backpressure handling.** Burst traffic MUST NOT freeze ordinary chat interaction. The system MUST support bounded queues, incremental rendering, aggregation or sampling of explicitly designated noncritical events, and preservation of critical lifecycle/approval/error evidence.

**AW-OBS-051 — Loss disclosure.** Dropped, sampled, redacted, delayed, and unrecoverable events MUST be represented as coverage changes or gap markers rather than silently disappearing from an allegedly complete stream.

**AW-OBS-052 — Source disconnect state.** Each connection MUST have an observable health state (connected, catching up, delayed, disconnected, failed, or equivalent) and a last-received-event indicator.

**AW-OBS-053 — Crash-safe restoration.** After application or service restart, persisted events and projections MUST be reconstructable. Operations that were in progress must be reconciled, not assumed completed.

**AW-OBS-054 — Reconnect and catch-up.** Where source APIs support cursors, polling, history reads, or replay, adapters SHOULD recover missed events and identify recovered versus continuously observed data.

**AW-OBS-055 — No fabricated gap fill.** If lost events cannot be retrieved, Aerynth MUST preserve the explicit gap, with bounded start/end estimates as available and a description of affected sources.

**AW-OBS-056 — Idempotent projections.** Updating a stream UI, event count, notification, or aggregate MUST tolerate repeated event deliveries without multiplying the same logical record.

**AW-OBS-057 — Independent capture boundary.** Event capture MAY continue while Aerynth's main window is closed only when an authorized background service is actually running. The UI MUST NOT imply continuous observation during an unmonitored shutdown.

**AW-OBS-058 — Secure retention through failures.** Partial writes, storage-full conditions, schema migrations, or sudden termination MUST NOT silently corrupt the canonical event store or the user's unrelated workspace data.

**AW-OBS-059 — Storage health visibility.** Aerynth SHOULD expose event-store health, indexing lag, capture failures, retention status, and queue backlog in diagnostic views.

**AW-OBS-060 — Priority under pressure.** Collection policy SHOULD prioritize approvals, failures, lifecycle transitions, security-relevant actions, and task outcomes over decorative high-frequency telemetry.

## 8. Real-time stream experience and progressive disclosure

An Intelligence Stream must answer the user's natural questions rapidly: “What is happening?”, “What is it doing right now?”, “Why did it pause?”, “What changed?”, “Who did it?”, “Did it actually finish?”, and “Where is the evidence?”

**AW-OBS-061 — Three core presentations.** Aerynth MUST provide conceptual support for a readable **Live Thought View**, a detailed **Execution View**, and a **Spatial Intelligence View** driven by the same events. Presentation availability may be phased but must remain a governed objective.

**AW-OBS-062 — Ordinary/readable default.** The default stream SHOULD emphasize meaningful recent activity and outcome, with chronology, current state, source, and an obvious route to further detail.

**AW-OBS-063 — Diagnostic fidelity.** Expanded events MUST reveal all permitted available operational detail, including command, tool lifecycle, output excerpts, links to full retained evidence, approvals, and error state when supported.

**AW-OBS-064 — Visibility modes.** Streams MUST provide progressive levels equivalent to ambient, standard, detailed, and diagnostic, without changing the underlying facts or implying more capture than exists.

**AW-OBS-065 — Live status accuracy.** Indicators MUST distinguish truly running work, waiting for permission, idle, queued, blocked, disconnected, and unknown state when evidence supports that distinction.

**AW-OBS-066 — Silent intervals.** During model or tool processing without new events, the UI SHOULD communicate elapsed time and last observable activity instead of inventing intermediate work statements.

**AW-OBS-067 — Stable scroll behavior.** During streaming, users MUST be able to inspect earlier entries without the viewport being repeatedly pulled to the bottom. New activity SHOULD remain discoverable through a lightweight affordance.

**AW-OBS-068 — Time and chronology tools.** Streams SHOULD support live-follow, pause-follow, filtering, jump-to-current, range selection, event search, chronological grouping, and bookmark/shareable references subject to permissions.

**AW-OBS-069 — Source-aware summaries.** Condensed streams or digest messages MUST disclose whether text is a captured agent summary, deterministic synthesis, or model-generated interpretation. Important disagreements and failures MUST NOT be omitted merely to produce a tidy narrative.

**AW-OBS-070 — Accessible alternatives.** All essential stream status and actions MUST remain available in accessible text/control surfaces; animation, color, sound, spatial positioning, and particle effects MUST NOT be the sole information channel.

### 8.1 Representative agent stream

    PERFORMANCE ENGINEER · ACTIVE
      00:35:12  observed  Execution started
      00:35:14  observed  Profiling data opened
      00:35:18  reported  "Investigating relationship between entities and tick latency"
      00:35:29  observed  Test command running
      00:35:37  observed  Process exited; code 0
      00:35:38  inferred  Repeated entity spikes may warrant further testing
      00:35:40  unknown   Model processing; no newer observable event

“Exit code 0” is a process fact, not necessarily proof that the performance issue is solved. This is representative interface copy, not evidence of a real event.

## 9. Spatial Intelligence, constellations, and semantic motion

The constellation is a meaningful alternative view, not a compulsory replacement for an ordinary list. Its nodes can represent agents, tasks, files, executions, conversations, or findings. Connections represent grounded relationships, delegation, selected dependencies, or explicitly identified hypotheses.

**AW-OBS-071 — Data-driven motion.** Status pulses, delegation lines, file-access highlights, completion transitions, and related visual signals MUST derive from live or replayed canonical state, or be unmistakably labeled demo/simulation.

**AW-OBS-072 — No pseudo-progress.** Atmospheric particle motion MAY be ambient, but a progress display MUST NOT imply percentage complete, reasoning stage, or success when such data is unavailable.

**AW-OBS-073 — Spatial identity continuity.** Moving from an agent block to a chat, task timeline, or expanded constellation SHOULD preserve underlying resource identity and navigation context.

**AW-OBS-074 — Visual evidence semantics.** The presentation SHOULD differentiate observed links, agent-reported relations, inferred links, and unknowns using an accessible multimodal visual language. Distinctions MUST survive reduced motion and simplified graphics.

**AW-OBS-075 — Focused relationships.** Dense graphs MUST support filtering, clustering, progressive disclosure, and transition to a readable list or detail view. A visually impressive graph that obscures what is happening does not meet acceptance.

**AW-OBS-076 — Motion Coordinator integration.** Stream visualizations MUST integrate with Aerynth's six-system Motion Coordinator: Spatial, Material, Atmospheric, Semantic, Interaction, and Performance Motion. The exact physics and rendering implementation remain owned by charter 02.

**AW-OBS-077 — Activity-responsive restraint.** Visualizations MUST throttle, pause, simplify, or reduce atmospheric effects under foreground gaming, high resource pressure, background/minimized state, battery constraints, or user preference without discarding critical state changes.

**AW-OBS-078 — Replay rendering consistency.** Historical spatial replay MUST be driven by recorded event states and preserve the same epistemic classes as live views, while clearly indicating that the viewer is examining the past.

**AW-OBS-079 — Efficient high-rate rendering.** Event bursts MUST NOT instantiate unbounded visual objects or force a full UI rerender per raw event. Aggregation, virtualization, and graphics-layer separation SHOULD be used where relevant.

**AW-OBS-080 — Motion communicates meaning.** Cinematic flourishes MUST assist comprehension, focus, and navigation. User preference and accessibility MUST allow reduced/disabled visual effects without removing functionality.

## 10. Delegation, multi-agent correlation, and outcome evidence

**AW-OBS-081 — Cross-agent traceability.** When Vela or an agent delegates work, Aerynth MUST capture available parent-child relationships and display descendant executions under the initiating request/task when authorized.

**AW-OBS-082 — Independent clocks and attempts.** Parallel agents MUST retain independent run identities, clocks, and retry histories. Aggregated timelines MUST NOT fabricate a single sequential reasoning chain.

**AW-OBS-083 — Evidence-linked findings.** A finding shared between branches or agents SHOULD contain source IDs, applicable evidence references, reporting identity, time, and verification state, with sharing/access rules controlled by the relevant charters.

**AW-OBS-084 — Handoff fidelity.** Agent handoffs SHOULD link the original objective, prior attempts, relevant evidence, remaining work, and new execution; they MUST NOT silently equate the new execution with a continuation of identical backend context if that is unsupported.

**AW-OBS-085 — Distinct task outcomes.** Observability MUST distinguish agent-stopped, attempted, investigated, implemented, tested, reviewed, integrated, deployed, accepted, and otherwise verified states according to task-domain contracts.

**AW-OBS-086 — Causal evidence boundaries.** “Agent B finished after Agent A” MUST NOT be presented as “Agent A caused Agent B to finish” unless an explicit dependency or supported causal relation exists.

**AW-OBS-087 — Cross-scope navigation.** Selecting a delegation in Vela's stream SHOULD navigate to the child agent's relevant execution and offer the return path to the parent task.

**AW-OBS-088 — Group summary transparency.** Group status MUST distinguish directly measured per-agent states from Vela's summarized view. A single “group complete” badge MUST NOT hide failed or unverified child assignments.

**AW-OBS-089 — Shared activity without transcript leakage.** Related agents and branches MAY discover appropriately shared findings, but a global stream's existence MUST NOT automatically grant model access to private conversations or unrelated sensitive content.

## 11. Vela explanations, initiative, and user commands

Vela may answer questions about a stream through structured retrieval, filters, and source-linked summarization. Native queries should be preferred for deterministic questions; deeper diagnostic interpretation may call an appropriate model.

**AW-OBS-090 — Explain from evidence.** When asked “What is it doing?”, “Why did it stop?”, or “What changed?”, Vela MUST ground answers in accessible recent events and distinguish observation from hypothesis.

**AW-OBS-091 — Missing-evidence answer.** If the recorded stream cannot explain a delay or failure, Vela MUST say what is unknown and may propose the next useful diagnostic action.

**AW-OBS-092 — Structured selection support.** Events, command outputs, diffs, timeline ranges, and multiple selected entries MUST support identifiable selection references for Contextual Command, without requiring the user to paste full logs manually.

**AW-OBS-093 — Safe follow-on operations.** Commands such as “investigate these events,” “compare these runs,” or “prepare a report” SHOULD route selected evidence into the proper agent or context flow; consequential mutations still follow authorization policy.

**AW-OBS-094 — Digest evidence.** Notifications, welcome-back recaps, and proactive insights MUST link to source events and distinguish unseen, reviewed, acknowledged, and resolved information using the owning attention system.

**AW-OBS-095 — Reporting only when useful.** Proactive stream interpretation SHOULD respect the Initiative Engine's attention policies; observability MUST NOT become a source of constant unsolicited interruptions.

**AW-OBS-096 — Assistant action auditability.** When Vela reorganizes streams, assigns agents, changes capture settings, or initiates a monitoring operation, the action and authorization path MUST themselves be attributable and inspectable.

## 12. Profiler and context-intelligence integration

The execution profiler owns the definitions and computation of token and timing measurements. This charter defines the **event evidence contract** for those measurements, not the accounting algorithm.

**AW-OBS-097 — Telemetry forwarding.** When a provider exposes token usage, cache metrics, timestamps, execution duration, tool timing, or account-capacity updates, the event pipeline MUST preserve available raw values, their source, units, scope, and precision for profiler consumption.

**AW-OBS-098 — Measurement differentiation.** Directly recorded, provider-reported, derived, and estimated timings/usage MUST retain their measurement class through all downstream views.

**AW-OBS-099 — No invented token counters.** Missing token-usage fields MUST NOT be displayed as measured zero or precise per-token counts. Local estimation MAY be used only with unmistakable labeling and a documented method.

**AW-OBS-100 — Time-span correlation.** Tool, agent, and turn timing events SHOULD carry consistent trace references to support critical-path analysis, parallel execution visualization, and user-facing elapsed/streaming measurements.

**AW-OBS-101 — Context-operation evidence.** CIE actions such as retrieval, checkpointing, handoff package creation, compaction, and context policy decisions SHOULD emit attributable metadata events, with privacy-sensitive payloads stored only under their proper access policy.

**AW-OBS-102 — Efficiency hypotheses.** Aerynth MAY flag redundant tool work, repeated file reads, large output churn, or similar inefficiency candidates, but MUST distinguish algorithmic detection from measured cost and verified causation.

**AW-OBS-103 — Goal versus completion.** Token reductions, long-running execution, or high tool-call counts MUST NOT be treated as direct proof of task success or failure. Verified outcomes remain governed by the task/quality subsystems.

## 13. Historical reconstruction, replay evidence, and timeline interfaces

This charter owns the integrity of the event record that historical replay consumes. Charter 11 owns replay controls, forecast behavior, timeline layout, scrubbing, and broader temporal UX.

**AW-OBS-104 — Recorded-only reconstruction.** A historical stream or replay MUST reconstruct solely from retained evidence, recorded state transitions, and clearly labeled derived projections; it MUST NOT invent missing events.

**AW-OBS-105 — Coverage-aware time travel.** Gaps, uncertainty, clock skew, recovered events, and policy-based exclusions MUST remain visible in historical inspection.

**AW-OBS-106 — Stable evidence references.** Where retained and permitted, an event reference SHOULD continue resolving after chat reorganization, workspace moves, application restart, or display-layout changes.

**AW-OBS-107 — Event-state consistency.** Replay and present-day views of the same recorded action MUST agree on the factual record, even if a more recent correction or verification adds new context.

**AW-OBS-108 — Snapshot provenance.** If materialized snapshots accelerate replay, the system MUST preserve their source range, generation version, completeness status, and relationship to canonical events.

**AW-OBS-109 — Historical export.** Aerynth SHOULD support scoped export of events and useful metadata, with redaction controls, authorization, completeness information, and schema version identification.

**AW-OBS-110 — Forensic caution.** Exports and replay MUST NOT be described as tamper-proof or exhaustive audit trails without supporting integrity controls, source coverage, and documented threat-model limitations.

## 14. Security, permissions, privacy, and retention

Intelligence Streams may contain sensitive repository paths, personal notes, command arguments, environment names, tokens, URLs, stdout/stderr, file diffs, prompts, or third-party data. Observability is valuable only when it does not quietly compromise the user's data.

**AW-OBS-111 — Authorized collection only.** Sources MUST be explicitly in scope under applicable permissions. A global stream MUST NOT mean covert collection of microphone, display, operating-system, or third-party activity.

**AW-OBS-112 — Least-privilege viewing.** A stream subscription, shared workspace, external integration, or agent MUST NOT grant access to events whose underlying source/data is outside the viewer's authority.

**AW-OBS-113 — Sensitive-field handling.** Capture and presentation MUST apply configurable redaction/minimization to credentials, access tokens, secrets, sensitive environment variables, private identifiers, and protected content, including command output and imported telemetry.

**AW-OBS-114 — Raw versus sanitized evidence.** When permitted raw evidence is retained, its access MUST be independently controlled; a sanitized summary or ordinary UI view MUST NOT expose raw secrets through drilldown, search, export, or copied metadata.

**AW-OBS-115 — Collection control.** Users MUST be able to inspect and configure event sources, retention classes, sampling, logging detail, background capture, and relevant analytics access within policy bounds.

**AW-OBS-116 — Retention with integrity.** Retention and deletion policy MUST define what is kept, summarized, expired, securely removed where feasible, and referenced by surviving aggregates. Expiration MUST NOT leave surviving views falsely asserting complete evidence.

**AW-OBS-117 — Deletion propagation.** When source data is deleted, revoked, or becomes inaccessible, projections, derived indexes, search results, exported caches within Aerynth's control, and model-access paths MUST honor the applicable deletion/access policy and explicitly mark invalidated evidence.

**AW-OBS-118 — Boundaries for public materials.** Real production traces, private messages, tokens, confidential code/output, and personal usage data MUST NOT be included in this public repository's examples or tests.

**AW-OBS-119 — Audit of privileged operations.** Approval, permission changes, source enablement, retention changes, export, and access-denied operations SHOULD produce protected audit evidence distinct from ordinary ephemeral visual effects.

**AW-OBS-120 — Non-sensitive defaults.** Collection policies SHOULD prefer metadata and bounded excerpts where full payload capture adds little diagnostic value; richer logging MAY be enabled explicitly when appropriate.

## 15. Reliability, offline behavior, performance, and scale

The visual experience is first-class, but it must not degrade the actual work. The event system should be able to handle bursts, long histories, and partially available sources while remaining useful.

**AW-OBS-121 — Isolation from agent execution.** Observability failures MUST NOT silently alter a task's approval policy, falsely stop/start work, or corrupt agent state. Critical audit capture failures that make an operation unsafe MUST be surfaced to the relevant control plane.

**AW-OBS-122 — Responsive streaming.** Live event ingestion and presentation SHOULD feel immediate on representative hardware; measurable latency and frame-time budgets MUST be set through charter 13 benchmarks rather than invented in this charter.

**AW-OBS-123 — Long-history scalability.** Large histories MUST support indexed/filterable retrieval, progressive loading, and virtualization so a chat with extensive activity remains navigable without loading everything at once.

**AW-OBS-124 — GPU/CPU discipline.** Renderers MUST adapt to low-power, gaming, minimized/background, and constrained-resource conditions without corrupting event history or removing access to essential control information.

**AW-OBS-125 — Partial offline utility.** Retained local histories SHOULD remain searchable, viewable, and replayable as supported while the remote AI/backend is disconnected.

**AW-OBS-126 — Burst resilience.** Stress tests MUST cover concurrent agents, high-rate tool logs, rapid lifecycle events, long-running sessions, reordering, duplicate delivery, and memory/storage pressure.

**AW-OBS-127 — Monitoring the monitor.** Observability services SHOULD expose their own health and resource consumption independently of the AI-driven descriptions they generate.

**AW-OBS-128 — Safe schema evolution.** Event and projection migrations MUST preserve retained evidence or make a failed migration recoverable, with explicit version and compatibility records.

## 16. Suggested implementation contracts (non-prescriptive)

These are interface boundaries to investigate, not a mandated implementation stack:

| Contract | Responsibility |
|---|---|
| Source Adapter | Subscribe/poll provider events; translate into canonical types; disclose capabilities |
| Capture Policy Service | Authorize sources; apply sensitivity, sampling, and retention decisions |
| Normalizer & Validator | Validate versions, evidence class, identity, lifecycle, time, and deduplication |
| Intelligence Event Bus | Distribute accepted events and report capture/connection health |
| Event Store | Durable append-oriented evidence and correction/supersession linkage |
| Projection Builder | Build stream indices, task/agent states, counts, search views, and snapshots |
| Stream Query/Subscription API | Offer paginated history and bounded live event delivery |
| Correlation Service | Link trace/span/delegation/resource relations with confidence and provenance |
| Profiler Adapter | Hand usage/timing events to charter 10 calculations |
| Vela Explainability Tool | Retrieve event evidence and produce attributed explanations |
| Motion/Scene Adapter | Convert semantic state to accessible and cinematic views |
| Historical Evidence API | Provide event ranges, gap annotations, and snapshots for charter 11 replay |

Illustrative data flow:

    Provider adapters / Vela native actions / Tool bridges / Monitors
                            |
                 Authorized capture policies
                            |
                   Validation / normalize
                            |
                    Intelligence Event Bus
                            |
                 Durable canonical event store
                            |
             +--------------+---------------+
             |              |               |
      Stream projections  Correlation   Analytics feed
             |              |               |
      Live/diagnostic UI  Graph links    Execution profiler
             |
      Semantic Motion + Spatial Constellation + Replay Evidence

**AW-OBS-129 — Interface isolation.** The front end MUST NOT depend on undocumented provider event shapes as its only source of truth; backend-specific transformations SHOULD be isolated behind documented adapters.

**AW-OBS-130 — Capability-driven UI.** Individual features MUST be gated by actual backend/source capabilities, and unsupported detail MUST be disclosed without making the entire stream unusable.

**AW-OBS-131 — Independent service identity.** Observability events generated by Aerynth itself MUST be distinguishable from external model/provider events; the UI MUST NOT blur local assistant/UI decisions into Codex actions.

**AW-OBS-132 — Testable contracts.** Each event family and state transition MUST have contract tests for identity, ordering, provenance, lifecycle, redaction, resilience, and projection semantics.

## 17. Mandatory acceptance scenarios

The following scenarios define *demonstrable outcomes*, not just mock-up expectations. Where a backend lacks a particular event class, a faithful adapter fixture may verify the interface and a separate live capability test must identify the actual unsupported portion. Simulated events are explicitly labeled in demonstrations.

| ID | Scenario | Required evidence / expected result |
|---|---|---|
| **OBS-A01** | Start an ordinary Codex chat | Chat Intelligence Stream receives live source-attributed turns without requiring a project or formal task |
| **OBS-A02** | Agent starts a terminal command | Command event shows permissible command, working environment, time, running state, then captured exit/result |
| **OBS-A03** | Tool never emits completion | UI shows unknown/interrupted/reconciling, not completed or successful |
| **OBS-A04** | Backend supplies a reasoning summary | Display identifies it as model-reported summary, never full private chain-of-thought |
| **OBS-A05** | Model active without updates | UI displays actual last-observed time and active/unknown processing state; no invented thought text |
| **OBS-A06** | Provider omits reasoning and token fields | Both appear unavailable rather than measured zero or synthetic values |
| **OBS-A07** | One event appears in two workspaces | Same event ID, source, status, and evidence; no duplicated canonical history |
| **OBS-A08** | Vela delegates three child agents | Parent/child execution and task relationships appear in Vela, group, task, and agent streams |
| **OBS-A09** | Two agents emit close timestamps | Independent ordering preserved; no false causal connection |
| **OBS-A10** | Agent reports tests pass but logs show failure | Report and observed failure remain visible and cannot automatically become verified success |
| **OBS-A11** | File patch proposed but rejected | Proposed change appears; no false assertion that file was written |
| **OBS-A12** | File write succeeds but tests never run | Modification status shown; validation remains unverified |
| **OBS-A13** | Approval required | Clear pending operation/scope and subsequent human decision displayed with attributable record |
| **OBS-A14** | Approval denied | No success animation or implied execution; denial and actual subsequent state remain clear |
| **OBS-A15** | Network stream disconnects mid-run | Disconnect/gap warning and last event shown; running state not falsely marked complete |
| **OBS-A16** | Reconnect with replayable cursor | Missing events recovered without duplicate displays or counts |
| **OBS-A17** | Reconnect with no available history | Irrecoverable gap remains clearly marked; replay never invents missing steps |
| **OBS-A18** | Source clocks differ | Time semantics/possible skew visible; tool does not fabricate deterministic global ordering |
| **OBS-A19** | 20 agents stream concurrent events | Streaming UI remains operable; per-agent and task identities, filters, and critical events are preserved |
| **OBS-A20** | Very large command output | UI loads bounded excerpt; authorized full evidence is retrievable without freezing or leaking hidden fields |
| **OBS-A21** | User pauses auto-scroll | Historical inspection stays stable; new event indicator remains discoverable |
| **OBS-A22** | User selects several events | Contextual Command passes structured references and evidence class, not just a screenshot |
| **OBS-A23** | “Why did it stop?” asked with no causal evidence | Vela states the unknown and points to available observed events |
| **OBS-A24** | An inferred relationship drawn | Graph differentiates it from a proven link and exposes supporting evidence |
| **OBS-A25** | User switches spatial/list views | Same event data, underlying resource identity, and epistemic semantics preserved |
| **OBS-A26** | User enables reduced motion | All important states and controls remain readable and usable without cinematic effects |
| **OBS-A27** | GPU load rises while gaming | Rendering complexity reduces while event capture and task state remain correct |
| **OBS-A28** | App closes while worker remains authorized/running | On reopening, capture coverage reflects actual background activity only |
| **OBS-A29** | App and capture service both stop | Reopening discloses unobserved period; no fabricated background monitoring |
| **OBS-A30** | Old workspace reorganized | Historical event links remain attributable and navigable across resource moves |
| **OBS-A31** | Sensitive value appears in command output | Standard view, search, drilldown, copy, and export respect redaction/access policy |
| **OBS-A32** | User revokes a source permission | New capture stops; restricted historical projections/indexes obey policy |
| **OBS-A33** | Retention expires a source payload | Event summary and remaining coverage accurately disclose missing evidence |
| **OBS-A34** | User requests historical replay | Only recorded/derivable states render; gaps and revisions are visible |
| **OBS-A35** | Same event arrives twice | Deduplicated canonical record, UI event, notification, and aggregate |
| **OBS-A36** | Schema migration interrupted | Durable history recoverable and version/health issue surfaced |
| **OBS-A37** | Agent claims finished but task remains unverified | Distinct stopped, implemented, tested, integrated, verified task states remain clear |
| **OBS-A38** | User asks Vela to inspect a suspicious period | Answer cites actual accessible events and marks hypotheses as hypotheses |
| **OBS-A39** | Project stream filters to just failures | Filter is visible, and user can inspect full underlying event context |
| **OBS-A40** | Diagnostic view on a long session | Virtualized history, bounded payload access, and responsive controls demonstrated on target hardware |
| **OBS-A41** | User exports selected trace | Export includes schema/provenance/coverage/redaction notes and excludes unauthorized source content |
| **OBS-A42** | Demo plays simulated agent stream | Simulation labeling persists in ambient, detailed, spatial, and replay views |

### 17.1 Evidence standards for acceptance

**AW-OBS-133 — Live integration evidence.** Acceptance of a production capability MUST include at least one applicable integration demonstration using real provider/application events; a scripted animation or fabricated fixture is insufficient alone.

**AW-OBS-134 — Fault injection.** Tests MUST deliberately cover disconnections, partial messages, duplicates, out-of-order delivery, missing finish events, malformed payloads, redaction failures, large outputs, and application restarts.

**AW-OBS-135 — Visual verification.** Cinematic stream features MUST be assessed in motion using recordings/performance evidence as well as static views, with readability and accessibility tested at reduced effects.

**AW-OBS-136 — Coverage traceability.** Every requirement in this charter MUST map to at least one verification case, contract test, or explicit documented deferral. A completed checkbox without evidence is not acceptance.

**AW-OBS-137 — Production claims.** Release notes MUST distinguish implemented, integrated, verified, limited, prototype-only, and not-yet-supported observability capabilities.

### 17.2 Recommended evaluation corpus

Use synthetic, non-sensitive fixtures that exercise:

- A long quiet model interval with no readable reasoning summary.
- A real event sequence with tool launch, streaming output, exit, and explicit verification.
- One tool output containing a simulated secret and a redaction policy.
- Three agents operating in parallel, with one delegation and one failed child run.
- A task with two executions and a final handoff.
- A forked conversation with related but access-restricted sibling events.
- Two source clocks drifting in opposite directions.
- A stream interrupted during event 100 of 200, both with and without catch-up support.
- Thousands of high-frequency low-value events alongside critical approvals.
- Long historical storage with schema migration, compaction snapshots, and deleted payload references.

These fixture scenarios are testing requirements, not assertions that a selected backend exposes every class of event.

## 18. Cross-charter ownership and traceability

| Domain / governing owner | This charter's contract and boundary |
|---|---|
| **00 Constitution** | Enforces AW-CON-057–061 and respects platform, truthfulness, autonomy, quality invariants |
| **01 Experience** | Supplies event selections and contextual navigation; 09 owns observable content/provenance |
| **02 Motion** | Owns physics, layers, materials, transitions, adaptive graphics; 09 supplies semantic event state |
| **03 Projects/Resources** | Owns identity, membership, workspaces, blocks, relationships; 09 references them without cloning resources |
| **04 Conversations** | Owns threads, branches, histories, user-facing chat; 09 records associated activity and evidence |
| **05 Agents/Tasks** | Owns task/execution state machine, delegation policy, outcome definition; 09 captures and projects related events |
| **06 Vela** | Owns initiative, attention, assistant autonomy; 09 supplies evidence and audit trail for explanations |
| **07 Notes/Knowledge** | Owns personal Thought Stream and knowledge epistemics; 09 owns Intelligence Streams, not private idea content |
| **08 CIE/Memory** | Owns context selection/decay/compaction and access to history; 09 records context-operation metadata |
| **10 Profiler** | Owns token and timing definitions, metrics, budgets, efficiency calculations; 09 owns raw event transport/provenance |
| **11 Timelines/Replay** | Owns interactive timeline/replay UX and planning uncertainty; 09 owns recorded-event integrity and replay feed |
| **12 Codex/Integrations** | Owns concrete provider APIs, auth, tool capabilities; 09 defines normalized capture requirements |
| **13 Platform** | Owns precise budgets, resource thresholds, operating-system integration; 09 requires adaptive reliable delivery |
| **14 Trust** | Owns authoritative permission/retention rules; 09 enforces capture/view/export boundaries |
| **15 Quality** | Owns testing and release standards; 09 contributes acceptance and fault-injection scenarios |
| **16 Delivery** | Owns sequencing, implementation milestones, changes, research, and integration gates |

### Constitutional traceability

| Constitutional anchors | Specialized requirements |
|---|---|
| AW-CON-002, 019, 057–058 | AW-OBS-002, 012–020, 066, 069, 071–072 |
| AW-CON-004, 026–028, 031–035 | AW-OBS-006–011, 021–028, 081–089 |
| AW-CON-036–046 | AW-OBS-029–037, 081–096 |
| AW-CON-051–056 | AW-OBS-045, 097–103 |
| AW-CON-059 | AW-OBS-038–060 |
| AW-CON-060 | AW-OBS-104–110 |
| AW-CON-061, 016–018, 075–078 | AW-OBS-061–080, 121–125 |
| AW-CON-062–065 | AW-OBS-097–103 |
| AW-CON-066–068 | AW-OBS-094–095, 104–110 |
| AW-CON-069–073 | AW-OBS-111–120, 121 |
| AW-CON-080–083, 086–089 | AW-OBS-128–137 and OBS-A01–A42 |

## 19. Open decisions requiring research

These are **open decisions**, not implied concessions or implementation approvals:

1. Durable event store and index architecture: local append log, relational DB, embedded search, or combinations.
2. Source-specific event capability matrices for current Codex App Server versions and future adapters.
3. Transport strategy for local desktop, background helper, remote workers, and multiple windows.
4. Exact trace/span ID generation and reconciliation with provider IDs.
5. A rigorous cross-source causal-link model and how inferred links will be represented.
6. Snapshot frequency, materialization strategy, and recovery/checkpoint format.
7. Safe output retention defaults and large-payload capture thresholds.
8. Data sensitivity detection, credential redaction, authorization inheritance, and retention UX.
9. Source timestamp trust calibration and source sequence/cursor recovery guarantees.
10. Deduplication rules when upstream providers omit stable event IDs.
11. Local-first indexing and search performance for very long streams and encrypted data.
12. Correlation and export formats; whether OpenTelemetry interoperability is desirable.
13. Spatial constellation scale limits, graph clustering, visual metaphors, and reduced-motion equivalents.
14. Human readability testing for four evidence classes across compact stream, chart, and constellation surfaces.
15. The appropriate division between deterministic stream summarization and Vela's optional model-generated interpretation.
16. What event classes require lossless capture versus permitted sampling under pressure.
17. Cross-device event synchronization, if enabled later, and conflict/version ordering behavior.
18. Exact live-stream latency, event-store throughput, retention/storage, and frame-time budgets on representative hardware.
19. How approved background capture persists while UI windows close or systems sleep.
20. Which external tool actions can be independently verified rather than merely provider-reported.

Research, prototypes, and architecture decisions MUST resolve these within the Constitution's constraints. An unavailable vendor feature MUST be represented transparently, not silently removed from the vision.

## 20. Change control, readiness gates, and acceptance

This document is a **published proposed governing charter**, not a claim of implementation, completion, or owner ratification.

- The [Aetherwake Constitution](00-AETHERWAKE-CONSTITUTION.md) remains the higher authority.
- Requirement identifiers SHOULD stay stable where their meaning is unchanged. Material changes require impact assessment, updated tests, and repository history.
- Changes to privacy, reasoning-truthfulness, event coverage, delegation, irreversible action audit, or retention MUST receive explicit constitutional/trust impact review.
- New integrations MUST prove capability-mapped event behavior rather than assume Codex/other provider parity.
- Replacing one event technology with another MUST preserve identity, source attribution, recovery, permission boundaries, and recorded history or use a reviewed migration.
- The [governance registry](README.md) MUST reflect publication versus formal acceptance accurately.
- The repository owner MAY accept, amend, or reject this proposed charter under the Constitution's procedure.

### Readiness gates

**Gate A — Contract credibility:** Typed event schema, four evidence classes, stable IDs, lifecycle transitions, privacy model, and representative adapter tests exist.

**Gate B — Real observation:** One real Codex-backed chat and one real tool/agent operation appear live, with source-attributed states and no fabricated reasoning.

**Gate C — Multiscope coordination:** One set of canonical events appears consistently in chat, agent, task, Vela, and project views with correct permissions and delegation links.

**Gate D — Resilience:** Disconnect, restart, duplicate, missing-completion, redaction, and large-output tests pass; any gaps are disclosed.

**Gate E — Cinematic integrity:** Live and spatial presentation are meaningfully animated through Motion Coordinator integration, meet measured performance criteria, and remain fully usable in reduced-motion mode.

**Gate F — Historical accountability:** A captured execution can be inspected and reconstructed from actual evidence, with reliable source references, coverage indicators, and safe export.

**Gate G — User usefulness:** A person can quickly answer what an agent is doing, why it paused if known, which changes it made, what remains unverified, what a team accomplished, and what attention is required, without being overwhelmed by raw logs.

**Final governing standard:** Aerynth must make intelligent work **visible, understandable, useful, and beautiful**, without sacrificing epistemic honesty, performance, user agency, security, or historical integrity. The Intelligence Stream is a window into **observable work**, never a fabricated window into private thought.
