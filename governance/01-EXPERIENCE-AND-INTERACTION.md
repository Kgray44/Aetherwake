# 01 — Experience and Interaction
## Governing Charter for Aerynth's Human Interface, Contextual Command, Navigation, and Adaptive Workflows

> **Owner acceptance recorded 2026-11-05.** The owner approves this charter and its reconciled amendments as governing design. Approval does not attest that code, agents, APIs, renderers or tests have achieved these requirements.

| Field | Value |
|---|---|
| Document ID | **AW-GOV-001** |
| Version | 1.1.0 — owner-ratified 2026-11-05 |
| Status | **Owner-accepted and ratified governing charter (binding design requirements; implementation separately verified)** |
| Prepared | 2026-11-01 |
| Authority | Specialized subsystem charter subordinate to [00 — Aetherwake Constitution](00-AETHERWAKE-CONSTITUTION.md) |
| Normative requirement namespace | **AW-EXP-###** |
| Primary domain | Human-computer interaction, contextual selection and commands, navigation, home and welcome-back, conversation presentation, workspace interactions, attention-safe UI, settings UX, input modes, error recovery, accessibility |
| Constitutional anchors | AW-CON-001–003, 006–015, 022–035, 036–050, 059–065, 069–083, 084–091; C-01, C-02, C-03, C-04, C-09, C-12, C-14, C-15 |
| Primary collaborators | [02 Motion](02-LIQUID-INTELLIGENCE-AND-MOTION.md), [03 Resources](03-PROJECTS-WORKSPACES-AND-RESOURCES.md), [04 Conversations](04-CONVERSATIONS-AND-CONNECTED-BRANCHES.md), 05 Agents, [06 Vela](06-VELA-INTELLIGENCE-AND-ADAPTATION.md), [07 Notes](07-NOTES-KNOWLEDGE-AND-THOUGHT-STREAM.md), [08 CIE](08-CONTEXT-INTELLIGENCE-AND-MEMORY.md), [09 Observability](09-INTELLIGENCE-STREAMS-AND-OBSERVABILITY.md), [11 Timelines](11-TIMELINES-AND-REPLAY.md), [13 Platform](13-PLATFORM-PERFORMANCE-AND-DISPLAYS.md), [14 Trust](14-TRUST-PRIVACY-AND-AUTONOMY.md), [15 Quality](15-QUALITY-VERIFICATION-AND-ACCEPTANCE.md) |
| Public document boundary | No personal conversations, secrets, user activity histories, private screenshots, or identifiable telemetry |

> **Governing promise.** Aerynth must feel like a coherent, intelligent environment that understands the user's immediate intent, makes complex work easy to navigate, and remains exceptionally usable as an ordinary Codex-style chat. Human control is paramount. The user expresses intent; Aerynth handles complexity. The interface must be effortless *and* extraordinary.
>
> **Central interaction law.** Selection identifies **context**, while the user's expressed **intent determines scope**; authorization still determines whether an action may execute.
>
> **Experience law.** Visual spectacle is not permission for clutter, false progress, hidden controls, slow interaction, inaccessible text, or surprising side effects. Liquid Intelligence enriches truthful, comprehensible interaction.

---

## 1. Charter boundaries, authority, and language

This charter is the canonical owner of Aerynth's **human-facing interaction behavior**: what users can select, invoke, see, understand, navigate, organize through the UI, inspect, dismiss, or recover. It specifies externally observable outcomes; it does not predetermine a renderer, framework, database, model, or application protocol.

The Constitution governs all interpretation. **MUST / MUST NOT** are binding, **SHOULD** establishes a strong default subject to recorded justification, and **MAY** allows optional behavior. This published draft requires explicit repository-owner acceptance before being considered ratified.

**Owned here:** interaction grammar; Contextual Command and selection UX; surfaces and navigation; accessible command composition; home and welcome-back behavior; progressive disclosure; UI affordances for workspace manipulation, notes and conversations; focus and attention-safe presentation; failure/recovery presentation; user-understandable feedback and UI acceptance.

**Owned elsewhere:** canonical resource identity and layout persistence (03), branch semantics and backend chat integrity (04), agent/task lifecycle (05), Vela's cognitive/initiative policies (06), notes and knowledge authority (07), retrieval and compaction (08), event truth and provenance (09), metrics (10), temporal data semantics (11), provider APIs (12), platform budgets/display restoration (13), authorization (14), and cross-system quality/release gates (15/16).

**AW-EXP-001 — Constitutional alignment.** All interaction flows MUST preserve constitutional guarantees, and MUST NOT silently narrow the product into a visual theme on top of a less capable chat.
**AW-EXP-002 — Stable requirement ownership.** The AW-EXP namespace exclusively governs interaction semantics. Integrations MUST reference the owning charter for data, permission, model, and rendering contracts.
**AW-EXP-003 — No mandatory ceremony.** Plain chats, quick notes, project browsing, resource viewing, and simple commands MUST work without prior project, workflow, agent-team, or dashboard setup.
**AW-EXP-004 — Truthful claims.** Loading, thinking, streaming, authorization, search completeness, inferred relationships, live synchronization, and execution state MUST be represented according to observed capability. Prototypes MUST label mocks.
**AW-EXP-005 — Command parity.** A relevant capability MUST be reachable through obvious direct controls as well as Vela-assisted language when feasible. AI availability MUST NOT be a prerequisite for essential local organization and navigation.
**AW-EXP-006 — Seamless locality.** Workspaces, full conversations, overlays, focus mode, and detached windows MUST preserve resource identity, selection where meaningful, and user intent when switching surfaces.

### 1.1 Interaction vocabulary

| Term | Meaning |
|---|---|
| **Surface** | Visible presentation area: home, workspace, chat, canvas, collection, search, settings, detached panel |
| **Selected referent** | Typed object or subrange the user explicitly selected |
| **Selection envelope** | Referents, their hierarchy, ranges, timestamps/versions, source context, permission scope, and confidence |
| **Contextual Command** | Scoped natural-language or structured instruction invoked relative to a selection or active context |
| **Command intent** | Parsed requested outcome and target scope, independent from selected referents |
| **Action plan** | Machine-readable proposed operations, target set, impact, preview, approval state, and recovery |
| **Interaction result** | Observed success, partial success, declined, cancelled, unavailable, or unresolved |
| **Attention state** | Current surface and review/focus cues, not unrestricted surveillance |
| **Progressive disclosure** | Compact daily experience with optional expert detail, never hidden essential control |
| **Focus state** | Persistent record of active resource, caret/selection/scroll anchors, keyboard focus, and open overlay context |

---

## 2. Product interaction principles

Aerynth is spatial and contextual but not compulsory to use spatially. An expert can operate via keyboard and straightforward lists; another can use a cinematic canvas; both interact with the same objects.

**AW-EXP-007 — Minimal friction.** Ordinary actions SHOULD complete with direct gestures or a short command, without recurring configuration or confirmations that are unrelated to risk.
**AW-EXP-008 — Complexity on demand.** Basic presentation MUST prioritize the next useful action; advanced settings, provenance, complete event streams, diagnostics, and permissions MUST remain discoverable without occupying daily surfaces.
**AW-EXP-009 — Stateful continuity.** Navigation MUST preserve draft text, unsent commands, scroll positions, selection, and relevant temporary state, unless the user explicitly discards them or a documented limitation applies.
**AW-EXP-010 — Direct manipulation.** Dragging, resizing, linking, and arranging SHOULD produce continuous legible feedback, not merely a final jump; motion semantics are delegated to charter 02.
**AW-EXP-011 — Consequence clarity.** Before consequential operations, the interface MUST identify actual resource scope, destination, overwrite/conflict risks, and required authorization according to charter 14.
**AW-EXP-012 — Reversibility.** User-driven organization changes SHOULD be undoable with understandable scope and duration. Irreversible external actions MUST be distinguished before execution.
**AW-EXP-013 — Discoverable escape.** Every modal, focus mode, full-screen/immersive state, selection command, and long-running interaction MUST offer an apparent cancel/close/back mechanism and keyboard equivalent where applicable.
**AW-EXP-014 — Consistent semantics.** The same resource action MUST mean the same thing when invoked from a list, block, graph, timeline, voice, contextual command, or search.
**AW-EXP-015 — Respectful silence.** Activity visuals, helper hints, notifications, and Vela's presence MUST be nonintrusive by default; attention and initiative decisions belong to 06.

---

## 3. Application shell and universal navigation

Aerynth consists of a global shell and interrelated surfaces: Home, Projects, Workspaces, Conversations, Agents, Knowledge/Notes, Search, Activity/Timelines, and Settings. These are **views**, not separate copies of data. Additional surfaces MAY exist.

**AW-EXP-016 — Universal reachability.** From any primary surface the user MUST be able to reach global search, command invocation, active project/workspace, current conversation, meaningful status, and Vela without a lengthy navigation chain.
**AW-EXP-017 — Predictable hierarchy.** Breadcrumbs, titles, location indicators, and back navigation MUST make clear where an object is presented, which project or collection it belongs to, and how to return.
**AW-EXP-018 — Fast switch.** Users MUST be able to move between recent chats, workspaces, projects, and agents through both keyboard and pointer-friendly pathways.
**AW-EXP-019 — User layouts respected.** Aerynth MUST NOT silently reshuffle deliberately pinned or locked placements to fit an assistant's aesthetic preference.
**AW-EXP-020 — Adaptive navigation.** Context-specific commands MAY offer recent/relevant destinations and suggested organization, but MUST preserve a stable, learnable base navigation scheme.
**AW-EXP-021 — Clear affordance states.** Interactive regions MUST expose hover/focus/selected/disabled/pending/error semantics independent of glow or motion.
**AW-EXP-022 — Offline navigation.** Locally available notes, saved arrangements, metadata, and historic records SHOULD be navigable without model connectivity, consistent with platform and trust constraints.

### 3.1 Global command interface

The universal command interface is available even when no object is selected. It can navigate, search, create resources, switch layouts, invoke local actions, and dispatch tasks where supported.

**AW-EXP-023 — Command routing.** Deterministic local operations (open, focus, filter, arrange, save note) SHOULD be executed without unnecessary model calls.
**AW-EXP-024 — Search versus action.** The palette MUST make it clear whether a proposed entry searches, navigates, changes UI state, or initiates an external operation.
**AW-EXP-025 — Composability.** A command MAY result in a new block, workspace, timeline, collection, or multi-agent assignment. Each created object's identity and outcome MUST be inspectable.
**AW-EXP-026 — Input persistence.** Opening another panel or receiving streaming updates MUST NOT erase a partially typed command. Accidental duplicate submission MUST be prevented.

---

## 4. Semantic Selection: the basis for Contextual Command

Selection is a first-class, typed, inspectable interface concept; it is not just highlighted text or a screenshot. Selection MAY include a chat message or text range, image/region, file, directory, chart time slice, timeline item, task, agent, note, page, group, multiple dissimilar objects, and context from the current surface.

**AW-EXP-027 — Typed reference.** Each selection MUST retain stable resource references and sub-object anchors appropriate to its type, plus enough provenance to re-resolve or mark it stale.
**AW-EXP-028 — Multi-object selection.** Users MUST be able to compose selections of multiple objects, including mixed types when the operation reasonably supports them.
**AW-EXP-029 — Semantic selection boundaries.** Selecting part of a chat MUST preserve the exact selected span and enclosing message/thread identity; selecting a chart region MUST expose underlying series/time range rather than only pixels when available.
**AW-EXP-030 — Scope separation.** Selected referents MUST NOT be treated automatically as the only possible command targets. Natural-language intent controls target scope subject to authorization.
**AW-EXP-031 — Target expansion.** A command such as "move every file in this folder," issued while a child file is selected, MUST resolve the containing directory and show the expanded candidate set.
**AW-EXP-032 — Target narrowing.** "Only this highlighted file" MUST constrain target scope to the selected file even if neighboring items are related.
**AW-EXP-033 — Context broadening.** "Split all the tasks we discussed" MUST consider authorized relevant conversation history rather than interpreting a selected message as the full task list.
**AW-EXP-034 — Ambiguity handling.** If several plausible target sets have materially different consequences, the UI MUST ask one focused clarification or present a disambiguation preview rather than guessing destructively.
**AW-EXP-035 — Temporal validity.** Before applying a consequential command, the system MUST revalidate stale paths, selection anchors, content versions, permissions, and target membership.
**AW-EXP-036 — Selection portability.** Selections MAY be transferred between supported Aerynth surfaces while retaining source identity and rights; external applications require explicit access integration.
**AW-EXP-037 — Selection visibility.** The interface MUST let the user inspect or easily infer what material an instruction is referencing without requiring raw internal object IDs.

### 4.1 Selection-to-command semantics

| Starting selection | Command | Required interpretation |
|---|---|---|
| One file in directory | "Move only this" | Selected file only |
| One file in directory | "Move all files from here" | Contents of its parent directory, previewed |
| Three chat messages | "Make tasks from these" | Extract candidate tasks from selected messages |
| One chat excerpt | "Start everything we've agreed to" | Retrieve relevant authorized conversation history; present actionable task decomposition |
| Chart point | "Explain this spike" | Resolve selected series, interval, units and supporting observations |
| Image region + note | "Compare these" | Preserve both selected sources and the intended comparison |
| Agent node | "Show what it changed" | Open available attributable file/operation evidence; do not invent |
| File and folder | "Put these together" | Resolve proposed destination/operation and clarify if consequential ambiguity remains |

---

## 5. Contextual Command composition and execution

Contextual Command SHOULD appear as a lightweight, spatially anchored field near the selection without obscuring it. Its position and transition belong to 02; its invocation, semantics, scope, and accessibility belong here.

**AW-EXP-038 — Everywhere appropriate.** User-selectable objects across major surfaces MUST offer Contextual Command or a functionally equivalent accessible invocation.
**AW-EXP-039 — Selection-aware defaults.** Suggested actions SHOULD match resource type, context, current permissions, and likely task intent without restricting free-form instructions.
**AW-EXP-040 — No prompt trap.** The command field MUST support direct natural language and keyboard input; users MUST NOT be forced into rigid option menus for general commands.
**AW-EXP-041 — Structured plan.** For multi-step or consequential commands, Aerynth MUST construct an inspectable action plan with target set, origin, destination/output, intended effects, unresolved constraints, and approval needs.
**AW-EXP-042 — Preview and consent.** High-impact scope expansion, batch movement, deletion, publication, overwrite, privilege changes, and external sending MUST have risk-appropriate preview/approval from charter 14. Highlighting material is not authorization.
**AW-EXP-043 — Nonblocking simplicity.** Harmless navigation and local non-destructive presentation changes SHOULD execute directly without an unnecessary approval dialog.
**AW-EXP-044 — Visual scope feedback.** When command interpretation expands/narrows selected scope, affected objects MUST be clearly previewed through meaningful visual state, with non-motion alternative.
**AW-EXP-045 — Live execution status.** Pending/running/awaiting approval/completed/partially completed/cancelled/unknown statuses MUST be clearly distinguishable; animation MUST NOT substitute for recorded status.
**AW-EXP-046 — Result grounding.** Completion presentation MUST reflect observed results, including partial failures and inaccessible objects. No claim of success based only on an agent's intent.
**AW-EXP-047 — Undo and history.** Supported operations MUST expose recovery or undo near their outcome and link to auditable command history where meaningful.
**AW-EXP-048 — User intervention.** Long-running or incorrect commands MUST expose stop/cancel/adjust controls, constrained by backend capability and safe operation boundaries.
**AW-EXP-049 — Reentrancy safety.** Repeated submit, switching surfaces, losing network, or reloading the app MUST NOT quietly duplicate costly or consequential actions.

### 5.1 Command pipeline (conceptual)

1. Acquire typed selected referents and active surface context.
2. Interpret requested outcome and candidate target scope.
3. Resolve references and authorization boundaries; identify stale/ambiguous inputs.
4. Select a local deterministic action or model-assisted plan as warranted.
5. Show a preview if risk, ambiguity, or scope expansion requires one.
6. Request any necessary authorization independently from inference.
7. Dispatch structured actions through the relevant application/provider service.
8. Update canonical data and event records from observed outcomes.
9. Animate truthful changes, surface failures, and offer supported recovery.

The interface MUST NOT use simulated mouse clicks against its own controls as the primary internal command mechanism when typed native operations are available.

---

## 6. Home, launch, welcome-back, and attention review

Home is a fully configurable workspace-like dashboard, not a static marketing screen. A user may create, pin, resize, and remove blocks and change saved layouts. Start-up should restore context and make activity since the last meaningful review easy to understand.

**AW-EXP-050 — Personal home.** Home MUST support rearrangeable user-chosen blocks and quick access to active projects, chats, agents, tasks, notes, search, and Vela.
**AW-EXP-051 — Session continuity.** On launch or resume, Aerynth SHOULD restore the user's last meaningful focus, saved layout, open conversation drafts, and inspectable pending activity.
**AW-EXP-052 — Welcome-back digest.** When relevant new activity exists, the welcome-back experience MUST distinguish completed, active, failed, waiting-for-approval, and unverified events; it SHOULD prioritize outcomes over command volume.
**AW-EXP-053 — Attention tracking.** "Seen" MUST NOT be inferred solely because a window opened. The application SHOULD track explicit inspection/review of each relevant item, with user-controlled mark-read, snooze, or dismiss semantics.
**AW-EXP-054 — Incomplete coverage.** When Aerynth was offline or monitoring was disconnected, the welcome digest MUST indicate gaps or reconciliation limitations rather than implying continuous awareness.
**AW-EXP-055 — No launch hostage.** Users MUST be able to bypass welcome-back material and enter the application promptly without losing the option to inspect it later.
**AW-EXP-056 — Alert triage.** Action-required items MUST expose a direct path to approval, source evidence, or remediation; routine background activity SHOULD be grouped.

---

## 7. Workspaces, blocks, and object interaction

Resource ontology and layout persistence belong to 03. This section governs how those objects are encountered and manipulated.

**AW-EXP-057 — Spatial flexibility.** Workspaces MUST allow meaningful configurable arrangements of supported blocks including chats, agents, folders, websites, notes, terminals, diagrams, charts, timelines, and monitoring surfaces.
**AW-EXP-058 — Layout modes.** Users SHOULD have structured docking/grid and optional freeform canvas approaches with understandable transitions or switching, not a mandatory infinite graph.
**AW-EXP-059 — Direct block actions.** Blocks MUST support discoverable move, resize, focus, expand, collapse, close/reference removal, and type-appropriate operations where supported.
**AW-EXP-060 — Resource versus placement.** Removing a block MUST be presented as removing its view/placement unless the user explicitly requests canonical resource deletion under 03/14.
**AW-EXP-061 — Shared identity.** Opening the same chat or resource in multiple workspaces MUST preserve its canonical identity and disclose simultaneous edits/locks/conflicts where meaningful.
**AW-EXP-062 — Layout presets.** Saved layout states SHOULD include Overview, Development, Monitoring, Planning, and Review patterns as configurable templates, never rigid mandatory categories.
**AW-EXP-063 — AI layout creation.** A request such as "make a server administration workspace" SHOULD produce an editable proposal containing relevant authorized resource references and sensible default placements.
**AW-EXP-064 — Spatial comprehension.** Auto-arrangement, graph views, and agent constellations MUST retain labels, grouping, filters, zoom controls, and alternative list/table views to avoid turning relationships into incomprehensible decoration.
**AW-EXP-065 — Task-generated objects.** When Vela creates a timeline, collection, note, chart, or chat, the resulting object MUST be independently addressable, persist according to its domain contract, and be manipulable like manually created resources.
**AW-EXP-066 — Multi-display continuity.** Interaction across detached windows and changed display topology MUST preserve meaningful focus and recover off-screen content; exact display persistence belongs to 13.

---

## 8. Conversations, branching, and in-flow task delegation

Aerynth MUST preserve rich everyday chat: new chats, typing, streaming, attachments/references, history, search, folders, smart collections, branching, and advanced per-chat settings. Functional requirements and provider constraints belong to 04 and 12.

**AW-EXP-067 — First-class chat.** Users MUST be able to begin a simple conversation from Home, search, workspace, or global command without launching an agent-workflow setup wizard.
**AW-EXP-068 — Streaming integrity.** Inbound messages MUST be progressively readable, keyboard navigable, and stable under streaming without unwanted scroll jumps or lost text selection.
**AW-EXP-069 — Text actions.** Selected message text SHOULD expose quote, copy, cite/refer, annotate, create note/task, and Contextual Command affordances where supported.
**AW-EXP-070 — Branch intelligibility.** Conversation branches MUST be navigable through a comprehensible list/tree/timeline, and shared findings MUST visually distinguish reference/linkage from transcript merger.
**AW-EXP-071 — Chat organization.** Manual folders, favorites, smart collections, related chats, and AI-assisted organization MUST remain understandable, inspectable, reversible where possible, and not silently duplicate histories.
**AW-EXP-072 — Delegation from conversation.** When the user says "split these tasks and start them," the application SHOULD extract candidates from the authorized conversation, show a coherent orchestration plan as needed, spawn linked tasks/chats through 05, and keep the original chat available.
**AW-EXP-073 — Task-free compatibility.** Formal task tracking MAY augment a chat, but MUST NOT be mandatory to send messages, attach files, fork conversations, or continue ordinary discussion.

---

## 9. Notes, capture, knowledge, and search interaction

Canonical note authority and retrieval belong to 07/08. This charter ensures note-taking remains lightweight and available everywhere.

**AW-EXP-074 — Immediate capture.** Quick Capture MUST permit immediate entry and save without first choosing a project, assigning a category, or waiting for model inference.
**AW-EXP-075 — No involuntary conversation.** Saving a note MUST NOT trigger an unsolicited chat response or agent execution simply because a note was created.
**AW-EXP-076 — Contextual attachment.** Users SHOULD be able to attach notes to selected messages, images, documents, task records, files, agents, or project resources with visible provenance.
**AW-EXP-077 — Note authority cues.** The UI MUST distinguish raw idea, proposed link, verified fact, project decision, and formal requirement where such classifications are exposed.
**AW-EXP-078 — Unified discovery.** Search MUST provide a coherent path across authorized chats, notes, resources, agents, and projects, with filters, sources, and indexed/partial/unavailable coverage clearly shown.
**AW-EXP-079 — Search results as actions.** A search result SHOULD allow navigation, adding a block, contextual commands, and direct source inspection without losing the search state.

---

## 10. Timelines, monitoring, and Intelligence Stream UX

Historical, planning, and replay data semantics belong to 09/10/11. This charter governs their human usability.

**AW-EXP-080 — Timeline on request.** Users MUST be able to request a timeline through conversation or command, receive a visible editable block or view, and inspect its basis rather than a fabricated schedule.
**AW-EXP-081 — Historical versus forecast.** Recorded events and predicted future durations MUST be clearly visually distinct, with uncertainty presented for estimates.
**AW-EXP-082 — Stream disclosure.** Available reasoning summaries, real tool events, model-reported findings, inferred explanations, and unknown reasoning MUST NOT be presented as an exact internal thought transcript.
**AW-EXP-083 — Detail on demand.** Intelligence Streams and the AI Profiler SHOULD offer compact, detailed, and diagnostic presentation levels without inundating an ordinary chat.
**AW-EXP-084 — Event-linked navigation.** Recorded event cards SHOULD link to their source task, agent, tool output, file changes, and verification evidence where available.
**AW-EXP-085 — No false causality.** Relationship animations and connected event views MUST distinguish proven dependency from correlation or suggestion.

---

## 11. Vela's presence, attention, and adaptive experience

The behavioral decisions are owned by 06, while this charter specifies how those decisions appear to the user.

**AW-EXP-086 — Persistent availability.** Vela SHOULD be available from primary surfaces through an unobtrusive, customizable visual presence and nonvisual alternatives.
**AW-EXP-087 — Mode transitions.** Ambient, Conversation, and Command modes MUST preserve user focus, selection, and drafts across transitions.
**AW-EXP-088 — Interruption restraint.** Notifications MUST respect configured quiet/focus/priority policies and provide readable severity, source, reason, and next action.
**AW-EXP-089 — Explain adaptation.** When the system suggests or applies a learned preference, users MUST be able to inspect what changed and the basis of the suggestion, and revert or disable where relevant.
**AW-EXP-090 — No attention hijacking.** Cinematic animations, agent activity, prompts, and automatic layout proposals MUST NOT repeatedly seize keyboard focus or reposition critical user content without explicit user intent.
**AW-EXP-091 — Human override.** Users MUST be able to pin layouts, suppress optional animation/notifications, reject proposed groupings, and use manual organization without fighting the adaptive system.

---

## 12. Settings architecture and progressive expertise

Configuration inheritance is owned by 03; model/settings capability discovery by 12. This charter owns settings presentation.

**AW-EXP-092 — Hierarchical visibility.** Where configuration inherits Global → Project → Workspace → Chat → Task, the UI MUST show effective values, inheritance source, override status, and applicable limits.
**AW-EXP-093 — No fictional knobs.** Aerynth MUST NOT display unsupported models, reasoning efforts, context ceilings, token controls, permissions, or automation guarantees as functional settings.
**AW-EXP-094 — Unobtrusive expertise.** Expert controls SHOULD reside in dedicated inspectable settings surfaces, contextual drawers, or command search without polluting the primary workspace.
**AW-EXP-095 — Revertibility and preview.** Display, motion, graphics, notification, and organization preference changes SHOULD be previewable or revertible, with a reset to a known-good configuration.
**AW-EXP-096 — Scope clarity.** Changing a per-chat setting MUST NOT inadvertently rewrite a project or global policy; inherited changes and their affected descendants SHOULD be understandable.

---

## 13. Input, accessibility, usability, and respectful feedback

Accessibility is part of the first-class interface, not an optional alternate product. Style and animation requirements are coordinated with 02/13/15.

**AW-EXP-097 — Keyboard equivalence.** Core navigation, selection, contextual commands, editing, dismissal, saving, moving/arranging where practicable, and approvals MUST have keyboard-operable paths.
**AW-EXP-098 — Text and assistive semantics.** Important controls, notifications, activity states, resource relationships, and selection consequences MUST have readable labels, logical focus order, and accessible descriptions; they MUST NOT rely solely on particles, color, sound, or motion.
**AW-EXP-099 — Reduced motion.** A reduced-motion mode MUST preserve usability, selection scope, feedback, causal meaning, and layout predictability; motion implementation details belong to 02.
**AW-EXP-100 — Accessible contrast and scale.** Glass/material treatments MUST NOT compromise important text contrast, legibility under variable backgrounds, zoom/text scaling, or visible focus.
**AW-EXP-101 — Multi-input semantics.** Pointer, keyboard, touch where supported, and voice MUST resolve through the same action and permission model. Voice transcription uncertainty MUST not imply permission for destructive actions.
**AW-EXP-102 — Feedback without guesswork.** Saving, loading, disconnected, syncing, empty, stale, denied, failed, retryable, and complete states MUST be distinguishable in ordinary language with an appropriate next action.
**AW-EXP-103 — Error recovery.** Failures MUST preserve user drafts and data where feasible, indicate what did and did not happen, and avoid fabricating rollback success.
**AW-EXP-104 — Focus and scroll safety.** Streaming events, toast messages, expanding panels, accessibility updates, and viewport changes MUST NOT unnecessarily steal focus, reset selections, or jump the reader away from their current work.

---

## 14. Interaction events and integration boundaries

The implementation SHOULD provide typed commands and state changes rather than treating presentation components as the system of record. Example operations below are conceptual, not currently guaranteed API endpoints:

- NavigateToResource / OpenConversation / ActivateWorkspace / SwitchLayout
- CaptureNote / AttachNoteToSelection / AddBlockReference / RemoveBlockPlacement
- CreateCollection / PreviewOrganization / ExecuteApprovedOrganization
- ResolveSelection / ProposeActionPlan / AuthorizeAction / CancelExecution
- CreateTimelineView / OpenRelatedEvents / InspectTokenTelemetry
- ShowVela / SubmitContextualCommand / RequestTaskDecomposition

**AW-EXP-105 — Typed action contracts.** An interaction MUST resolve to stable resource references and an explicit domain operation, not an untracked visual macro against Aerynth's own UI.
**AW-EXP-106 — Authorization decoupling.** Understanding intent, previewing an action, granting access, and executing it MUST be separable states.
**AW-EXP-107 — Rendering independence.** Visual movement, detaching a block, switching to a list, or enabling reduced motion MUST NOT change underlying command semantics.
**AW-EXP-108 — State evidence.** Resulting interface state MUST be reconciled against the authoritative store/provider and expose failure/partial state instead of assuming UI animation equals success.
**AW-EXP-109 — Explicit unavailable behavior.** If a required provider operation or selection type is unsupported, the user MUST receive a truthful limitation, a safe fallback when available, and no deceptive completed effect.

### 14.1 Minimum selection/command data contract

A concrete implementation SHOULD represent: selection ID; selected resource IDs; source anchors/ranges/regions; object type; revision or validity token; active surface and project/workspace context; the user's raw command; interpreted action type; proposed target set; assumptions and confidence; estimated side effects; permission requirement; execution ID; observed result and recovery reference. Sensitive data access must obey 14.

---

## 15. Acceptance scenarios and evidence

The following scenarios are mandatory when their capabilities are in the claimed milestone. Numeric latency/frame criteria are defined through benchmark specifications and charter 13 rather than invented here.

| ID | Scenario | Pass condition |
|---|---|---|
| **EXP-A01** | Start an ordinary chat from Home | Conversation opens and works without project/task wizard |
| **EXP-A02** | Select one file, request all parent-folder contents moved | Preview identifies parent contents, destination and impact; authorized execution uses correct scope |
| **EXP-A03** | Select one file, say "only this" | Exactly selected file targeted; no sibling files |
| **EXP-A04** | Mixed image and message selection | Command retains both source references and interprets task or clarifies ambiguity |
| **EXP-A05** | "Split everything we discussed into tasks" | Relevant authorized conversation context used; visible task plan and linked created tasks, no hallucinated executions |
| **EXP-A06** | Open a chat in two workspaces | Same canonical conversation; no silent history duplication |
| **EXP-A07** | Capture thought from active coding chat | Note saved without changing chat, task, model, or project requirements |
| **EXP-A08** | Relaunch after monitored activity | Digest distinguishes unread, completed, active, blocked, missing-data intervals |
| **EXP-A09** | Reorganize chats by topic with Vela | Previewed collection changes, clear provenance, no deletion/duplication |
| **EXP-A10** | Ask for projected task timeline | New timeline view with explicit forecast uncertainty and source tasks |
| **EXP-A11** | Enter/exit focus and detach window | Draft, focus and selected resource survive within platform support |
| **EXP-A12** | Search offline/degraded | Search coverage and unavailable results are honest; local data remains accessible |
| **EXP-A13** | Disable motion and use keyboard | Critical interactions remain operable with visible non-motion feedback |
| **EXP-A14** | Invalidate selected file before execute | Stale reference detected; affected scope replanned or action blocked |
| **EXP-A15** | Backend declines or partially executes | UI presents actual partial state and recovery, not fictional completion |
| **EXP-A16** | Switch from simple to expert settings | Effective values/inheritance clear; chat drafts/workspace state preserved |
| **EXP-A17** | Simulated agent event in prototype | Clearly marked simulation; production stream uses only grounded events |
| **EXP-A18** | Vela automatically suggests a layout | User can inspect, refuse, revert, lock layout and continue manual use |

Verification MUST include keyboard and screen-reader flows, screen recordings of semantic transitions, real-provider tests for claimed integrations, negative/error paths, and user evaluation of comprehensibility. Cross-system release gate and evidence ownership are defined by 15.

---

## 16. Antipatterns, open decisions, and amendment expectations

The following are **noncompliant product patterns**: mandatory workflow setup before chatting; hover-only critical controls; selection treated as permanent action authorization; automatically using one selected file as the target of an explicit "all files" request; opaque agent-made file moves; hidden loss of drafts or scroll state; false "thinking" transcript; visually beautiful but unusable low-contrast glass; unrequested reshuffling of pinned workspaces; repeated prompts for low-risk navigation; settings that claim unsupported backend capabilities.

**Deferred research questions:** exact shortcut defaults and conflicts; gesture vocabulary; accessibility-friendly spatial selection behavior; specific desktop menu conventions; touch/pen support; optimum contextual command placement; multi-window focus handoff mechanics; voice engine; precise visual layouts and microcopy. These MUST be answered through prototypes, actual platform tests, and documented decisions rather than premature universal claims.

Changes to these requirements MUST be traceable by identifier, evaluated against 00/03/06/14/15, and recorded via the constitutional amendment process where necessary.

---

## 17. Owner-directed 2026-11-04 addendum: unified intelligence navigation and active-project awareness

> **Status:** Proposed governing extension for owner review. The current parent charter remains a owner-ratified governing charter. This is a behavioral contract, not a statement that any interface has been implemented.
>
> **Primary interaction invariant:** **One continuous spatial universe. No disconnected screen changes.** Workspace, Constellation, project Intelligence Stream and global Vela Presence are distinguishable perspectives, not unrelated applets.

### 17.1 Four perspective entry points and their purposes

**AW-EXP-200 — Distinct perspectives.** The application shell MUST preserve four coherent modes: Workspace (creation and action); Constellation (projects and their spatial relationships); project Intelligence Stream (execution-plan progress and activity); and Vela Presence (global symbolic orchestration). The primary Intelligence Stream MUST NOT be presented as a normal workspace block, nor Presence as a causal project graph.

**AW-EXP-201 — Clear scope at entry.** Entering a project Intelligence Stream MUST reveal which real project and active runs the view represents. Entering Vela Presence MUST show that its scope is global and illustrative of observable activity, not an exposure of private model thought.

**AW-EXP-202 — Context-preserving transitions.** Travel between major modes MUST retain identifiable source and destination anchors, project/resource identity, focus, and undo/back navigation where meaningful. Motion MUST make transitions intelligible; users MUST NOT be forced through unrelated screen closures and menu cycles.

**AW-EXP-203 — Interruptible navigation.** Spatial navigation MUST permit cancel, back, keyboard navigation, reduced motion and direct access to urgent controls. Automatic camera tours MUST yield to explicit user pan/orbit/zoom or selection and must not block typing, approvals or error recovery.

**AW-EXP-204 — Project switching.** The user MUST be able to switch directly from one project Stream to another while inside a Stream. That switch MUST preserve independent view state and MUST NOT cancel, retry or alter backend operations.

### 17.2 Floating Active Projects Dock

**AW-EXP-205 — App-level floating dock.** A discreet Active Projects Dock MUST appear in appropriate app shell perspectives, defaulting to the upper right subject to responsive collision avoidance. It is a first-class navigation instrument, visually distinct from workspace blocks, not a resizable workspace resource.

**AW-EXP-206 — Per-project pill.** For each active eligible project, the dock MUST provide a compact medium-length translucent pill with a short recognizable name, explicit source-backed activity state and labeled elapsed time. One project with five concurrent runs remains one project pill unless the user expands details.

**AW-EXP-207 — Time semantics.** Elapsed time MUST identify whether it is wall-clock time since activation, cumulative confirmed running time or time spent waiting. A live counter MUST NOT imply ongoing CPU or agent activity while the project is paused or blocked.

**AW-EXP-208 — Primary and secondary actions.** Activating a project pill MUST open its workspace as the primary action. A separate, keyboard-accessible secondary action MUST open its Intelligence Stream. Hover-only critical navigation is prohibited.

**AW-EXP-209 — Status lifecycle.** Running, waiting for approval, paused, unknown, failed and recently completed states SHOULD have clear distinguishable compact indications. The dock MUST NOT hide actionable pending-approval projects solely because execution is no longer running.

**AW-EXP-210 — Scalable density.** When many projects are active, the dock MUST group or collapse rather than cover the scene, approvals, reading surfaces or Vela. Expand/collapse SHOULD preserve scroll, order and selection context; notification noise is not an acceptable substitute for awareness.

**AW-EXP-211 — Coordinated dock motion.** Pill arrival/removal and reordering MUST use consistent Motion Coordinator transitions and stable anchors, without popping or jarring layout changes. Source state changes MUST remain correct even when animations are disabled.

### 17.3 Stream selector and in-place navigation

**AW-EXP-212 — Zero/one/many selection semantics.** Selecting Intelligence Stream from the main app shell MUST:
- show honest empty/recent navigation if there is no eligible active project;
- open the only eligible project's Stream directly;
- show a compact, carefully animated project selector if multiple projects are eligible.
A user MUST still be able to choose completed/history streams through a separate discoverable route.

**AW-EXP-213 — Selector content.** Each selector item MUST identify the real project, activity/wait status and time-counter meaning, and SHOULD show a concise current operation summary if supported. Selection MUST be keyboard-operable, easy to cancel, and not require a huge full-screen list.

**AW-EXP-214 — In-stream selector access.** While viewing a project's Intelligence Stream, users MUST have discoverable access to other project Streams without exiting to a workspace. Preserve the target project's camera/zoom, pinned Activity Theater and replay cursor independently.

**AW-EXP-215 — Transition scene semantics.** Presence→Stream SHOULD travel through selected activity/tendril into the real execution graph; Stream→Presence SHOULD reverse meaningfully; Stream A→B SHOULD recede and re-emerge through a shared spatial environment; Workspace↔Stream SHOULD retain project anchors. Crossfades alone are insufficient as the defining transitions when spatial relationship is available.

**AW-EXP-216 — Safe focus.** Transition focus changes MUST remain accessible, recover safely from failed navigation or GPU loss, restore keyboard/pointer target and avoid hidden stale overlays. Running tasks MUST remain under their independent execution owners.

**AW-EXP-217 — Lower-distraction counterpart.** Reduced motion and no-GPU navigation MUST preserve all four mode entry points, current project selection, the dock, and actionable Stream/Presence details without requiring visual travel animation.

### 17.4 Acceptance journey

A reviewer MUST be able to start two live projects, observe two separate dock pills, open either workspace, open the project picker, travel to a chosen project Stream, select another project without leaving the intelligence layer, travel to Vela Presence and select a project-linked mote back into its Stream. At each step verify correct IDs, independent camera/focus restoration, unaltered background executions, readable status, reachable approvals, and cancel/reduced-motion behavior. Synthetic fixtures may demonstrate design, but live end-to-end acceptance must use actual source-backed activity.

The detailed UX and state restoration contract is in [Active Projects and multi-stream experience](../docs/specifications/ACTIVE-PROJECTS-AND-MULTI-STREAM-UX.md). Owner-visible imagery and camera motion follow Charter 02. The application SHALL NOT declare compliance based only on a static mock selector or a single active-project test.

---

## Publication and acceptance

This document is **owner-ratified (2026-11-05)** as governing design. Its feature implementations and visual/functional acceptance evidence remain separate and subject to testing.

**The ultimate interaction standard:** the user communicates naturally, Aerynth interprets accurately, Vela helps appropriately, consequences are visible, and the interface never makes the user fight the machine to accomplish ordinary work.

---

## Ratified amendment CF-2026-11-05: capable interaction across every surface
> **OWNER-RATIFIED 2026-11-05.** Existing continuous spatial experience and accessibility rules remain.

**AW-EXP-110 — Single Vela across surfaces.** Typed messages, voice, selected text, workspace and constellation MUST preserve assistant identity, task state, active scope and resource selection; a visual transition MUST NOT restart work.
**AW-EXP-111 — Action versus advice.** A request to act MUST distinguish action proposal, approval, execution, partial result, failure and verified outcome. Generic advice MUST NOT replace an available authorized action without an explicit reason.
**AW-EXP-112 — Fast, not shallow.** Aerynth SHOULD acknowledge lengthy work and stream meaningful progress without truncating backend investigation, verification or user-required capabilities.
**AW-EXP-113 — Functional instrument identity.** Agent, task, research, checklist, timeline, clock and resource blocks MUST match their actual types and expose real behaviors; a visual imitation cannot count as functional completion.
**AW-EXP-114 — Legible control.** Voice stop, task cancel, approval, provider pin, tool result, source and cost state MUST be discoverable and distinguishable. Stopping speech does not implicitly stop an external task.
**AW-EXP-115 — Honest failure.** Missing privileges, unavailable models, unsupported hardware and exhausted credits MUST have actionable, non-fictitious states, not a silent generic reply.
**AW-EXP-116 — Continuous navigation.** Primary destinations MUST share spatial identity, resource objects, history and state through transitions, rather than resetting as unrelated pages.

**Acceptance:** Continue a live agent task while moving from chat to workspace to constellation, interrupt speech, approve one scoped action, create and restore a functional block; verify no task duplication. See [capability architecture](../docs/architecture/VELA-CAPABILITY-RUNTIME-AND-EXECUTION-FABRIC.md).

---

## Owner-directed supporting amendment FI-2026-11-10: visible adaptive intelligence without interaction friction

> **Design obligations, not implementation certification.** Existing charter authority, accessibility, contextual-command consent and continuous navigation remain binding. The primary cognitive/learning/telemetry owners are Charters 06, 08, 09, 10 and 13.

**AW-EXP-218 — Intelligent input from first contact.** Text, voice, selection, multimodal and workspace commands MUST support model-assisted intent interpretation and context recovery when genuinely semantic understanding is needed, before and during planning. The interface MUST NOT disguise keyword matching as understanding; precise local commands MAY use direct no-model paths.

**AW-EXP-219 — One continuous Vela.** Switching models, specialists, execution modes, workspaces or providers MUST retain canonical conversation/mission identity, user intent, authorized context and progress. The user interacts with Vela, not a lineup of disjointed agent chats.

**AW-EXP-220 — Useful early feedback.** Slow, complex missions SHOULD stream verified partial findings and actual stage transitions as soon as available while background work continues. Provisional hypotheses MUST be labeled, and no progress indicator may imply a tool call or completion that did not occur.

**AW-EXP-221 — Explain adaptive decisions.** Users MUST be able to inspect why a model, tool, parallel execution strategy, local-resource limit, learning policy or verification path was selected, using recorded inputs, policy versions, capability evidence and actual outcomes. Unknown reasons MUST be reported as unknown, not generated retrospectively.

**AW-EXP-222 — Adaptive Intelligence Workspace entry points.** Provide discoverable entry from conversation, task, project, resource controls and Vela Presence into the AEP/ARIE learning experience. Navigation MUST preserve live task state and lead into the same persistent spatial environment instead of opening unrelated monitoring popups.

**AW-EXP-223 — User agency over adaptation.** Users MUST be able to inspect applicable adaptive preferences and policy changes, pause optional experiments, control resource profiles, request correction, and see rollback or disablement status. Controls MUST map to real governed state and communicate permission consequences.

**AW-EXP-224 — No intelligence sacrificed for perceived speed.** Fast acknowledgment, streaming, provisional presentation, and reduced render load MUST NOT conceal disabled retrieval, shortened verification, weaker reasoning than required, or dropped outputs. Explain real capability or availability limitations.

**AW-EXP-225 — Accessible and calm observability.** Adaptive intelligence and resource status MUST be available in readable textual and reduced-motion forms, with low-noise notification controls. Gaming/foreground protection SHOULD require minimal intervention and should not clutter the primary conversational flow.

**AW-EXP-226 — Complete result composition.** A single request MAY produce text, images, documents, files, task receipts, structured controls and live views. Each result MUST distinguish proposed, running, partial, failed, verified and unavailable outcomes and retain retrievable artifact identity.

**Acceptance journeys:** (1) ambiguous conversational request triggers source-linked AI context recovery; (2) a mission runs while switching chat → AEP Workspace → project stream without restarting; (3) inspect and revert a learning-policy proposal; (4) gaming protection adjusts local execution while remote AI work continues; (5) accessible reduced-motion mode retains identical action/state semantics. Review against Charters [03](03-PROJECTS-WORKSPACES-AND-RESOURCES.md), [09](09-INTELLIGENCE-STREAMS-AND-OBSERVABILITY.md), [10](10-AI-EXECUTION-PROFILER.md), [13](13-PLATFORM-PERFORMANCE-AND-DISPLAYS.md) and [14](14-TRUST-PRIVACY-AND-AUTONOMY.md).
