# Aerynth: Living Instruments & Expressive Presence
## Unified visual language for intelligence, time, knowledge, interaction, and Vela

> **Aerynth must be extraordinary from the inside out.** It is not a conventional productivity application decorated with glass and glowing rectangles. Its objects should behave as meaningful, interactive, spatial instruments, and its assistant should visibly transform as her real operational state changes.
>
> **Every meaningful animation communicates something. Every beautiful component accomplishes something.**

> **2026-11-04 OWNER-DIRECTED SCOPE UPDATE:** This prior Living Instruments document remains a useful design reference for Timeline, Blocks and Stream *Glimpse* or *Forensic* projections. **Its old small block-based Stream and Vela expressive-shape proposals are superseded as the product's primary full-screen experiences** by [Spatial Intelligence systems index](SPATIAL-INTELLIGENCE-SYSTEMS-INDEX.md), the corresponding governing addenda in 01/02/06/09/15, and their detailed GPU/runtime/acceptance specifications. Do not report a compact branching block or decorative Vela shape as completion of the newly required per-project immersive Stream or global 3D Intelligence Nebula.

| Field | Value |
| --- | --- |
| Project | Aetherwake |
| Application | Aerynth |
| Assistant | Vela |
| Document type | Product experience and detailed interaction design reference |
| Status | **Proposed design, v1.0; not a governing charter and not proof of implementation** |
| Date | 2026-11-04 |
| Scope | Living Instruments, Intelligence Stream, Timeline, Block Library, Vela's manifestation, shared Motion Coordinator |
| Implementation baseline | Review against the latest applicable Aerynth integration; design branch initially based on draft PR #19 |
| Governing references | Constitution 00; Charters 01, 02, 03, 04, 05, 06, 07, 09, 10, 11, 13, 14, 15 and 16, according to registry authority |

### Related references

- [Experience vision](../vision/AERYNTH-EXPERIENCE-VISION.md)
- [Governance index](../../governance/README.md) and [agent guidance](../../AGENTS.md)
- [Liquid Intelligence & Motion](../../governance/02-LIQUID-INTELLIGENCE-AND-MOTION.md)
- [Projects, Workspaces & Resources](../../governance/03-PROJECTS-WORKSPACES-AND-RESOURCES.md)
- [Vela Intelligence & Adaptation](../../governance/06-VELA-INTELLIGENCE-AND-ADAPTATION.md)
- [Intelligence Streams & Observability](../../governance/09-INTELLIGENCE-STREAMS-AND-OBSERVABILITY.md)
- [Timelines & Replay](../../governance/11-TIMELINES-AND-REPLAY.md)
- [Platform, Performance & Displays](../../governance/13-PLATFORM-PERFORMANCE-AND-DISPLAYS.md)
- [Quality, Verification & Acceptance](../../governance/15-QUALITY-VERIFICATION-AND-ACCEPTANCE.md)

**Authority boundary.** This document defines a proposed detailed experience and engineering direction under existing governance. It does not establish a new binding charter, ratify pending charters, change trust policy, or assert that described features already work. Implementation plans and code must respect the current governance registry and demonstrate actual outcomes.

---

# 1. The experiential problem

The current Aerynth visual direction establishes an appealing stellar environment, spatial navigation, glass materials, and a distinct Vela mark. However, parts of the functional application still render information primarily as text-first panels, stacked rows, timestamps, or lightly styled rectangular lists. Some blocks differ more in headings than in behavior.

That is insufficient for the intended experience.

A Timeline cannot simply be a list of dated events. An Intelligence Stream cannot merely be a reverse-chronological audit feed. An Agent block cannot merely display a name and status. A Note should not be a plain rectangle containing text with a fancy border. A Clock should not be merely a numerical readout. And Vela's different states cannot be recognized only by tiny variations in the same silhouette. In particular, the current broad suspended, parachute-like thinking formation is not an acceptable final direction.

Aerynth should be recognizable by **how information behaves**. Its interface should give structure, depth, time, relationships, and state a legible animated form.

The desired blend:

- **Scientific visualization:** spatially honest representations of time, causality, state, dependencies, provenance, and metrics.
- **Cinematic interaction:** continuous transformation, luminous geometry, elegant camera motion, and a carefully coordinated material language.
- **Direct manipulation:** drag, select, zoom, pan, group, branch, edit, resize, inspect, and undo.
- **Ambient intelligence:** Vela makes relevant information discoverable and actionable without clutter.
- **Engineering reliability:** all content is bound to canonical records and actual permissions; demonstrations never masquerade as live evidence.

**North-star test:** A first-time user should perceive a sophisticated, useful instrument, not an ornate data table.

---

# 2. Living Instruments: the fundamental design unit

A **Living Instrument** is an interactive visualization of one or more canonical application objects. It is neither a new data store nor a detached visual toy. Its appearance, interactions, and motion must be grounded in the underlying object's semantics.

Every instrument has three progressive presentation layers:

## 2.1 Glance: understand in approximately two seconds

The smallest useful presentation communicates the object's identity, current state, and one or two important facts. Examples: a countdown arc and remaining time; an agent glyph and real execution state; a Timeline's current focus and nearby milestones; an Intelligence Stream's active branches and verified outcomes.

The user should not need to read a paragraph to understand what an instrument is doing.

## 2.2 Interaction: work directly with the information

The standard presentation supports meaningful, low-friction manipulation: reschedule an editable Timeline item, expand a note section, adjust a timer, inspect an evidence node, follow a conversation branch, change a checklist item, or open an agent's current task.

Controls must be accessible, discoverable, and bound to real native operations.

## 2.3 Immersion: reveal the deeper system

Expanded view reveals complex structure: a multi-lane Timeline editor, a navigable causal graph, a mission control view, a relationship-aware research canvas, or a rich note editor. Its transition should preserve the recognizable object being expanded.

**Identity invariant:** Glance, Interaction, and Immersion are projections of the same canonical object. Removing a block must not silently delete its resource. Showing a second view must not duplicate a timer, agent, task, or event.

---

# 3. Shared visual grammar

## 3.1 Materials and atmosphere

Aerynth's visual vocabulary is:

- Fine luminous filaments and expressive orbital arcs
- Floating surfaces with deliberate optical depth
- Restrained glass, atmosphere, and gentle internal reflections
- Soft highlights that respond to actual state and interaction
- Precise labels, hierarchy, and typography
- Subtle particle phenomena when they contribute to meaning
- Celestial and scientific motifs without literal space-themed ornament everywhere
- Continuous geometry between focus levels and workspace modes

Light should emphasize a relationship or an event. It should not be sprayed indiscriminately over every UI element.

## 3.2 Semantic encoding

Use a coordinated visual grammar:

| Channel | Primary meaning | Caution |
| --- | --- | --- |
| Shape / silhouette | Object family, Vela operational state, event kind | Keep distinguishable without color |
| Position / path | Sequence, time, dependency, or causality | Do not invent links |
| Motion | Transition, activity, change, attention | No fake activity |
| Brightness / emphasis | Selection, importance, current focus | Avoid permanent visual noise |
| Color | Secondary state classification | Never sole status indicator |
| Rhythm | Actual pulse or update rate, when observable | Do not imply fabricated telemetry |
| Text / accessible label | Exact meaning, provenance, value, control | Always available when needed |

The same semantic concepts should remain recognizable across compact, standard, and expanded views.

## 3.3 Restraint and calm

A living interface is not a permanently animated one. Idle instruments should settle. Background blocks should substantially reduce or suspend animation and polling. Significant changes should be noticeable, not every micro-event.

## 3.4 Spatial and navigational coherence

All instruments live in Aerynth's shared space. They must honor the canonical workspace layout, saved variants, resize constraints, locked placements, responsive compact modes, Vela's reserved presence geometry, and the existing Constellation navigation model.

---

# 4. Motion Coordinator: one system, not dozens of competing animators

The existing Motion Coordinator remains the owner of coordinated interaction and spatial motion. Extend it with reusable **semantic motion primitives** instead of creating separate animation engines in each block.

## 4.1 Motion primitive families

- **Morph:** a stable visual identity changes shape while retaining meaningful continuity.
- **Unfurl / collapse:** a compact surface opens or closes while preserving origin geometry.
- **Orbit / follow:** related data or UI elements maintain understandable spatial relationships.
- **Converge / diverge:** dependencies or execution branches merge or separate.
- **Reveal / settle:** new information enters, receives focus, then becomes calm.
- **Pulse:** an observed active event gets brief emphasis, without implying hidden work.
- **Snap:** precise direct manipulation settles to a valid position, interval, or layout anchor.
- **Branch / join:** actual relationships are expressed by diverging or merging paths.
- **Reposition:** saved workspace objects move without losing identity.
- **Replay:** recorded events are presented in a controllable temporal sequence.

## 4.2 Motion profiles

| Class | Intended experience |
| --- | --- |
| Immediate feedback | Responsive selection, hover, focus, handle feedback |
| Structural transformation | Open, expand, collapse, resize, reflow |
| Information change | Add event, connect relation, verify task, update timer |
| Vela presence | Morph between meaningful observed operational states |
| Ambient | Minimal quiet motion, always subordinate to readability |

Tune duration, spring constants, damping, easing, and event coalescing with native measurements. Do not distribute arbitrary timeout constants throughout individual components.

## 4.3 Interruption and continuity

Animations should be interruptible and reversible. If an event arrives midway through a transition, the next target should flow from the **current displayed pose**, not reset abruptly to the initial pose. A block must remain usable during transformations where practicable.

## 4.4 Performance and accessibility

- Honor reduced-motion preferences and provide static but useful equivalents.
- Preserve full keyboard and assistive-technology operation.
- Limit permanent compositing, blurs, GPU layers, and expensive layout measurement.
- Virtualize or apply level-of-detail for large datasets.
- Coalesce updates rather than animating every low-value event individually.
- Dormant/offscreen/minimized blocks must stop unnecessary rendering.
- Test under sustained multi-agent and high-block-count load.

---

# 5. Signature instrument I: Timeline as manipulable time

**Concept:** A luminous temporal instrument where events have real positions, durations, relationships, and editable boundaries.

A Timeline's dominant axis is **when** something happens, not why a sequence of intelligence operations occurred.

## 5.1 Modes

1. **Horizontal:** panoramic chronological axis, ideal for wide blocks.
2. **Vertical:** chronological depth suited to narrow/tall blocks.
3. **Multi-lane:** parallel tasks, agents, projects, or event categories.
4. **Replay:** recorded history played at adjustable speed with a scrubbable position.
5. **Compact glance:** next milestone/current time window and a few nearby nodes.

Mode switches should preserve temporal focus and selected objects.

## 5.2 Visual elements

- Smooth continuous axis and time-grid markings
- Scaled ticks and clear timezone-aware labels
- Event nodes with distinct shape/classification
- Duration bands and draggable boundaries
- Event clusters when zoomed out
- Current-time indicator where relevant
- Range selection and focus highlighting
- Genuine dependency/reference connectors, visually distinct from the time axis
- Subtle creation/reposition transitions
- Optional background eras, phases, or milestone groupings

## 5.3 Native interactions

- One-step event creation at a chosen time
- Title, description, tags, and relevant associated-object editing
- Dragging editable events to new dates/times
- Resizing duration segments
- Interval snapping with explicit precision controls
- Zooming between minutes, hours, days, weeks, months and longer spans when supported
- Trackpad/wheel pan and zoom with anchored cursor position
- Jump-to-date, search, filter, select, inspect, and keyboard alternatives
- Undo/redo and persisted state
- Read-only handling of immutable system history: annotating or deriving planning items is permitted, falsifying recorded evidence is not

## 5.4 Time model

Store exact timestamps and timezone/offset semantics appropriately. Handle daylight-saving gaps/overlaps, multi-day events, and durations consistently. Do not use screen pixels or CSS animation progress as the source of temporal truth.

## 5.5 Timeline and Stream separation

A Timeline emphasizes chronology and temporal editing. The Intelligence Stream emphasizes actual flow of execution and causal relationships. They may share selected events and navigation, but their default representations must not collapse into one generic activity feed.

---

# 6. Signature instrument II: Intelligence Stream as a causal current

**Concept:** A visual structure showing how user intent, Vela actions, agents, tools, evidence, approvals, failures, and verified outcomes are related.

A Stream answers **what is happening, what caused it, which branches are active, and what resulted**.

A mere timestamped event list is not an acceptable final default.

## 6.1 Visual topology

- Stable central or dominant causal spine for an objective/mission
- Branching paths for independent work
- Real merge/join nodes for dependency reconciliation
- Agent-specific lanes when useful
- Specialized node glyphs for tools, evidence, decisions, and outcomes
- Selected path highlighting, upstream/downstream tracing, and confidence/provenance details
- Clustered summaries for dense activity
- Distinct blocked, uncertain, failed, and verified terminal structures
- Meaningful level-of-detail at different zoom and density scales

Paths must derive from canonical event IDs, correlation IDs, parent references, mission/task dependencies, and actual verified links. **Never draw guessed causality merely because it looks cinematic.**

## 6.2 Three modes

### Glimpse

Compact ambient current. Shows active branches, dominant state, and recent verified outcomes with almost no text.

### Flow

Primary representation. Users navigate a living graph: branches separate, parallel agents proceed, events merge into results, and nodes can be inspected.

### Forensic

Precise audit and engineering inspection, including timestamps, IDs, payload classifications, tool metadata, source references, approvals, failures, and replay. A structured list belongs here as an **optional inspection and accessibility projection**, not the primary aesthetic.

## 6.3 Event families

Provide clearly differentiated, accessible glyphs and structured appearances for:

- User request / intent
- Vela decision or explicit plan
- Provider/model dispatch
- Agent delegation
- Tool execution
- Evidence collection
- Source/resource mutation
- Approval or human decision
- Dependency wait
- Verification
- Result publication
- Failure / cancellation
- Uncertain outcome
- Recovery / retry

Do not portray hidden chain-of-thought as an observable stream. The visible stream is an evidence-grounded representation of real externally observable activity and recorded plans/results.

## 6.4 Event-driven motion

- New events attach to their actual correlation chain.
- Independent branches diverge on real start events.
- Merge nodes settle when prerequisites and evidence are satisfied.
- Waiting operations suspend visibly at their real gate.
- Completed outcomes calm and retain provenance.
- Replay reads recorded event timing and enables speed/scrub controls.
- Live-follow can be paused without losing new events.

## 6.5 Functional tools

Search, filter by agent or event family, inspect nodes, trace related evidence, navigate to workspace blocks, follow the chosen branch, compare outcomes, switch to Timeline, and export authorized information.

Use controlled layouts and virtualization for potentially large event graphs. Preserve accessible reading order and a non-graph fallback.

## 6.6 Example causal chain

User request → Vela objective → concurrent investigation branches (profiling, source inspection, delegated research) → evidence reconciliation → correction or implementation → verification → verified result. The visual merges are a presentation of actual dependency edges and verified outcomes, not fiction.

---

# 7. Signature instrument III: Vela as expressive transforming presence

Vela is not a status badge and not a decorative screensaver. Her visual manifestation should be a distinctive, readable representation of **actual operating state** and should preserve recognizable ties to Aerynth's luminous mark.

The current broad umbrella/parachute-like *thinking* silhouette should be replaced.

## 7.1 Design goals

- Recognizable identity at small sizes
- Distinct silhouette for each major state
- Transformative continuity rather than unrelated state swaps
- Elegant geometric logic: folding arcs, luminous lenses, filaments, apertures, directed forms
- Meaningful presence while keeping content usable
- Correct activity/provenance and no invented thinking telemetry
- Reduced-motion representation with equally clear states

## 7.2 State language and visual differentiation

| Operational state | Distinct visual signature | Transition character |
| --- | --- | --- |
| Idle | Compact stable luminous nucleus with restrained breathing | Settle, stillness |
| Aware / attention | Subtle directional tilt or orientation toward relevant context | Orient |
| Wake-word armed | Quiet ready state, clearly not cloud-listening | Subtle ring/indicator, low activity |
| Listening | Open receptive aperture, optional real input response | Unfurl/open |
| Interpreting | Converging filaments or lens-like geometry, **not parachute** | Converge/focus |
| Planning | Arcs reorganize into distinct aligned paths or a small constellation | Branch/organize |
| Acting | Directed coherent flow or forward-moving form | Propel/follow |
| Coordinating | Several distinct correlated paths revolving around a persistent center | Diverge/merge |
| Speaking | Output-responsive articulation of the existing identity | Responsive expansion |
| Waiting | Suspended balanced form with a clear cause cue | Decelerate/hold |
| Needs input | Attentive stable aperture with actionable cue | Invite |
| Verified | Brief elegant resolving bloom, then stable | Converge/settle |
| Blocked/error | Constrained or fractured-but-controlled geometry with clear label | Interrupt/recover |

Do not rely on nearly identical variants distinguished only by brightness or hue.

## 7.3 Transformation examples

- **Idle → Listening:** nucleus opens into a receptive aperture.
- **Listening → Interpreting:** open form folds into precise convergent lens geometry.
- **Interpreting → Planning:** converging filaments organize into intentional branches.
- **Planning → Acting:** branches align into a directed motion silhouette.
- **Acting → Coordinating:** directed work separates into correlated subsidiary pathways while Vela's nucleus stays recognizable.
- **Acting → Verified:** motion resolves into a stable cohesive form with a restrained bloom.
- **Acting → Waiting:** momentum decreases; external cause remains legible.
- **Blocked → Recovery:** constrained geometry reassembles into a valid state.

Each transition must preserve actual displayed geometry where possible, support interruption, and originate from observed canonical application state.

## 7.4 Presence is not sentience

These animations signify activity, interaction, and feedback. They do not imply Vela possesses consciousness, emotions, inner subjective thought, or visual access to unavailable information.

Do not fake audio waveforms, CPU activity, agent work, or model reasoning.

## 7.5 Visibility and composition

Vela may move between workspaces and focal contexts without becoming another user-owned block. Preserve her established reserved/persistent geometry semantics, avoid obscuring content, and let users find and focus her easily. On tiny layouts, prefer a distinctive concise manifestation instead of collapsing into illegible effects.

---

# 8. Signature instrument IV: Block Library as a living showroom

Aerynth's Block Library must explain **what an instrument is**, **what it does**, **what data it needs**, and **how to add it** before the user commits to it.

A static alphabetized list of similar rectangles is not an adequate final experience.

## 8.1 Discover by intent

Use meaningful navigation categories, with sensible search and cross-category inclusion:

- Conversation
- Knowledge
- Time
- Execution
- Navigation
- Environment
- Specialists

Alternative task-based discovery such as Create / Think / Track / Explore / Control may be evaluated, but maintain a stable resource type taxonomy underneath.

## 8.2 Each library item

- Distinct recognizable visual glyph/miniature
- Short purpose statement
- Available capabilities and meaningful restrictions
- Bindable resource types and creation behavior
- Compact preview of the real presentation
- Replayable short *demonstration* of a few interactions
- Drag affordance and one-click/keyboard insertion
- Details about how it behaves at different sizes
- Proven availability states: available, needs setup, unsupported, etc.

Never represent a reference-only type as freely creatable, and never depict an unimplemented feature as working without labeling the demonstration.

## 8.3 Micro-demonstrations

Use small, controlled, replayable sequences:

| Instrument | Preview demonstration |
| --- | --- |
| Timeline | Nodes appear on an axis, zoom changes scale, editable milestone moves |
| Timer | Countdown arc advances, pauses, and resumes |
| Intelligence Stream | Realistic labeled fixture branches, agent paths merge into evidence |
| Notes | Section unfolds, linked resource highlights |
| Conversation | A message reveals a related branch or delegated result |
| Checklist | Grouped progress advances with a verified task change |
| Agent | Task starts, state shifts, evidence returns |
| Metrics | Trend updates, measured peak is emphasized |
| Resource browser | Search/filter locates a resource and shows where it belongs |

Synthetic preview data must be clearly marked as examples, isolated from user state and live execution.

## 8.4 Drag onto a workspace

A usable library-to-canvas journey:

1. User picks up an instrument thumbnail or presses an accessible Insert action.
2. A lightweight ghost preview follows the pointer/keyboard placement.
3. Layout engine identifies permitted placements and current constraints.
4. Relevant canvas zone, snap guides and collision boundaries appear.
5. On drop, the correct canonical resource is created or linked within policy.
6. Its actual block view animates from ghost to committed geometry.
7. Undo and restoration preserve identity and canonical state.

Support freeform and structured modes, input cancellation, invalid drops, edge auto-pan when appropriate, and accessibility equivalents.

**The ghost is not the block.** The final placement must be a real functional view backed by the canonical application system.

## 8.5 Presets and semantic assembly

Use the same registry and placement APIs for manual library insertion, templates, and Vela-generated workspaces. Do not create parallel placeholder code paths. A template-generated Timeline must be the same functioning Timeline view that a user can drag manually.

---

# 9. Comprehensive block-family redesign matrix

A full implementation audit must enumerate **all registered block types** at the latest source revision, including specialized subject views and provider-specific variants. The following are required families, not an assertion that each is already fully implemented.

## 9.1 Notes and knowledge: a thinking surface

- Deliberate typography, section hierarchy, and focused composition
- Elegant collapsible sections and embedded references
- Contextual links to projects, tasks, sources, and discussions
- Visual indicators for reference relationships and actionable excerpts
- Fluid expand/focus transitions
- Fast editing, reliable selection, copy/paste, and accessibility
- No loss of authoring practicality to ornamental animation

A note is a usable writing and reasoning surface, not merely styled text.

## 9.2 Conversations and Connected Branches: conversational portals

- Clean, readable messages and responsive streaming
- Clear distinction among Vela replies, direct provider chats, and attributable delegated results
- Contextual branch graph previews and conversation handoff indicators
- Mission/task links and provenance details on demand
- Smooth focus between chat and related workspace resources
- Stable canonical conversation identity and history
- No compulsory graph animation for ordinary conversation

## 9.3 Checklist, tasks and objectives: progress structures

- Compact progress indicators and meaningful grouped stages
- Task status, priority, ownership, dependency, and due-date cues
- Manual editing remains simple and independent of AI
- Vela/agent-updated status must be tied to actual evidence
- Attachable timer, chat, mission or project relationships where supported
- Expand into the full task structure without losing object identity

Do not confuse a manual Checklist with an executing Agent.

## 9.4 Agents, specialists and teams: active roles

- Profile identity distinct from execution instance
- Actual availability, assignment, phase and current work
- Observable tool/agent handoff relations
- Current task ownership and verified output
- Team relationship/role visualization, workload and coordination
- Accurate distinction among queued, working, blocked, available and unknown
- Never animate work without actual execution evidence

## 9.5 Clocks, timers, stopwatch and focus sessions: temporal presence

- Orbital/radial time visualization with precise numerical readout
- Start, pause, resume, reset, adjust, cancel and inspect controls
- Real persistent native timing and wake/restart reconciliation
- World-clock and clock-face variants as supported
- Compact timer glance, expanded controls, multiple timers
- Graceful approaching-expiry transitions and clear notification states
- Visual animation is a projection of the timer engine, never its source of truth

## 9.6 Research and evidence: source relationships

- Provenance-centered source cards with readable summaries
- Relationship mapping, claims and evidence links
- Clear uncertainty and trust classifications
- Citation/source inspection and trace-back
- Useful comparison and grouped discovery views
- No invented provenance or links

## 9.7 Resource, Collection and Library browsers: distinct purposes

- **Resource Browser:** existing objects, file types, metadata, where used, navigation.
- **Collection Browser:** curated/smart groups, inclusion rules, relationships, membership.
- **Block Library:** capabilities, previews, insertion, and explanation of block types.
- **Evidence Browser (if provided):** provenance, attribution, source chains, verification.

Do not implement four nearly identical lists with renamed headings.

## 9.8 Files, links and media: source-aware viewers

- Real type-appropriate previews where supported
- File provenance, location, selection, and links
- Direct opening and contextual actions
- Smooth focus and responsive presentation
- Accurate fallbacks for unavailable formats
- Avoid abstract visualizations that compromise document/image/code usability

## 9.9 Performance, telemetry and environment: measured instruments

- Sparklines, trends, thresholds, and contextual gauges
- CPU/RAM/GPU/latency metrics when truly available
- Event-linked peaks, measurement timestamps, and sampling coverage
- Low-noise mini-presentations and richer expanded inspection
- Clear labels for measured, estimated, unavailable and simulated data
- No fabricated continuous curves between nonexistent samples

## 9.10 Timelines, Streams and activity

- Canonical Timeline as editable/inspectable time visualization
- Causal Intelligence Stream as the relationship-driven operational visualization
- Activity logs remain a valid forensic/fallback mode, never the sole primary experience

## 9.11 Workspace and mission controls

- Mission graph overview with meaningful branch and dependency states
- Interaction panels that preserve link to actual canonical tasks
- Explicit permission/approval barriers where truly necessary
- User control for pause, cancel, inspect and focus
- No false completion from a pretty progress visualization

---

# 10. Instrument architecture and proposed interfaces

Avoid a new independent app or duplicate data stores. Introduce extension-friendly typed interfaces over existing canonical services.

Illustrative contracts, **not claims about current source interfaces**:

\`\`\`typescript
type InstrumentMode = 'glance' | 'interaction' | 'immersion';
type DataClass = 'observed' | 'reported' | 'inferred' | 'simulated' | 'unknown';

interface InstrumentDescriptor {
  kind: string;
  label: string;
  purpose: string;
  categories: readonly string[];
  supportedModes: readonly InstrumentMode[];
  bindableResourceKinds: readonly string[];
  minSize: { width: number; height: number };
  preferredAspect?: number;
  capabilities: readonly string[];
  demonstrationId?: string;
  motionProfileId: string;
}

interface InstrumentState {
  instrumentId: string;
  resourceId?: string;
  sourceRevision?: number;
  mode: InstrumentMode;
  semanticState: string;
  dataClass: DataClass;
  focusRef?: string;
  motionTarget?: string;
}

interface InstrumentAction {
  id: string;
  kind: string;
  resourceId?: string;
  expectedVersion?: number;
  payload: unknown;
}
\`\`\`

The existing motion, policy, resource, workspace and block systems may already provide equivalent contracts. Audit them and **extend/reuse rather than duplicate**.

### 10.1 Identity and persistence

Canonical domain objects remain authoritative. A block is a presentation of them. Instrument geometry and temporary focus state must be separately persisted or restored according to current workspace contracts.

### 10.2 State-driven motion

Presentation components consume semantic state and produce Motion Coordinator targets. The Motion Coordinator determines actual transitions. No uncontrolled component-specific render loops.

### 10.3 Event correlation

For Stream and Timeline projections, preserve event IDs, task/mission IDs, correlation IDs, source references, timestamps, data classification and verification. Do not alter immutable history to enable editing; create separate schedule/annotation records.

### 10.4 Composability

Support multiple instrument views of a canonical object, contextual expansion, links, selected range and focus transfer, and safely synchronized updates across simultaneous windows or displays.

---

# 11. Interactions, editing and information density

The following usability principles apply across every instrument:

- Default interactions should be easy to discover without advanced setup.
- A user should be able to understand what each control changes and which object it targets.
- Drag gestures need obvious grab affordances; distinguish drag-to-move from text selection or dragging graph nodes.
- Provide undo/redo where appropriate, and never claim rollback of irreversible external actions.
- Hover previews should not require hover to access critical information.
- Keyboard/focus/assistive-technology alternatives are mandatory.
- Zooming and panning should preserve a stable reference point.
- Responsive size changes should improve the presentation, not simply crop it.
- Dense data should cluster or disclose detail progressively, not render unreadable microtext.
- Accessible and forensic text representations remain available even when default presentation is cinematic.

---

# 12. Performance, display and accessibility acceptance

Native verification must include representative:

- Compact and expanded blocks
- Multiple simultaneous active instruments
- High-resolution and mixed-DPI displays
- Workspace pan/zoom/rearrangement
- Constellation transitions and focus changes
- Busy missions and active streaming agents
- Extended sessions with many events
- Renderer suspend/resume, app restart, backend reconnect
- Reduced motion, high contrast, keyboard navigation, and screen-reader semantics

Measure frame-time distribution, input-to-visible feedback, missed frames, CPU, GPU, memory, and offscreen rendering overhead. Establish baselines and report regression as well as improvement.

**No invented performance thresholds.** Use the current approved performance charter and real device evidence to determine acceptance thresholds. Visual acceptance includes recordings or traceable frame sequences, not only still screenshots.

---

# 13. Implementation phases and dependencies

Keep Living Instruments as an isolated visual engineering workstream coordinated with Vela Rebirth. Do not modify active PR #19 or conflict with ongoing backend work without agreed ownership.

## L0: Inventory and evidence

- Inspect the latest code and relevant approved governance.
- Enumerate every registered block and its true functionality.
- Record current design, missing interactions, motion, and canonical bindings.
- Capture baseline native clips and performance measurements.
- Produce requirement-to-source and requirement-to-test traceability.

## L1: Shared semantic motion and instrument foundation

- Typed instrument descriptors and mode contracts.
- Motion Coordinator semantic primitive extension.
- Common focus, selection, accessible fallback, and resizing behavior.
- Stable layout and resource identity.
- A minimal demonstration through a real working instrument.

## L2: Signature instruments, parallel where safely isolated

- Intelligence Stream causal graph/flow modes and forensic drilldown.
- Timeline horizontal/vertical/multi-lane temporal editor and replay.
- Vela full major-state manifestation transformation.
- Clock/Timer family rendering integrated with real native domain when ready.

Coordinate interfaces first, then execute independent component work in isolated modules.

## L3: Discoverability and creation

- Animated Block Library previews with clearly marked sample data.
- Category/search experience.
- Drag-to-workspace and keyboard insertion.
- Real canonical resource creation/binding.
- Shared template/Vela workspace creation path.

## L4: Remaining block families

- Notes, conversations, Connected Branches, tasks, agents/teams, metrics, browsers, research, files/media and any others found in the live registry.
- Purpose-specific visualization, useful direct manipulation, compact/expanded continuity.

## L5: Integration and acceptance

- Native Windows Electron journey.
- Real mission-event correlation, time edits, block placement, Vela state changes.
- Accessibility and reduced-motion review.
- Performance and resource-load benchmarks.
- Complete regression suite and evidence-rich report.

These are staged execution gates, **not permission to replace the remainder of the project with a roadmap**.

---

# 14. Explicit acceptance scenarios

| ID | Scenario | Required observable outcome |
| --- | --- | --- |
| LI-01 | Open Block Library and browse categories | Accurate capabilities, distinct previews and clear availability |
| LI-02 | Replay a Timeline preview | Understandable demonstration isolated from user data |
| LI-03 | Drag a Timeline into a workspace | Real canonical block created/bound, valid placement and undo |
| LI-04 | Create and edit a temporal event | Correct persisted timestamp, duration and timezone behavior |
| LI-05 | Zoom/pan and switch Timeline orientation | Focus preserved, legible axis and smooth transformations |
| LI-06 | Replay a real execution Timeline | Source-linked chronology and accurate recorded timing |
| LI-07 | Stream shows two independent tasks | Actual causal branches visually diverge |
| LI-08 | Agent results join and verification completes | Actual join edge, source attribution and truthful outcome |
| LI-09 | Open Stream Forensic mode | Inspect exact IDs, time, provenance and verification |
| LI-10 | Change Vela Idle→Listening→Interpreting→Acting | Distinct silhouettes and uninterrupted morphs |
| LI-11 | Vela blocked, waiting and verified | Easily distinguishable without relying on color |
| LI-12 | Timer starts/pauses/resumes in a block | Real native timer continues independently of rendering |
| LI-13 | Open notes/chat/tasks/agents in two sizes | Intentional representations, working controls, same canonical identity |
| LI-14 | Reorder/move/resize blocks | Deterministic valid geometry, preserved layout and undo |
| LI-15 | Restart Aerynth | Restored resources, views, layout and correct recorded state |
| LI-16 | Reduced motion and keyboard-only use | Functional controls and comprehensible static representations |
| LI-17 | Busy multi-agent mission | Responsive UI and measured frame/resource performance |
| LI-18 | Unavailable or revoked capability | Honest degraded state without fabricated activity |
| LI-19 | Compare Timeline vs. Stream | Time-first and causality-first designs clearly differentiated |
| LI-20 | Native desktop review | Actual working Windows build and motion evidence, not mocks alone |

Each scenario needs a source-bound test or repeatable manual procedure and a truthful result classification: verified, partial, blocked, or failed.

---

# 15. Quality bar and anti-patterns

Unacceptable substitutions:

- Generic list entries restyled with neon borders and called a Stream.
- Static timeline labels without meaningful time-scale navigation or editing.
- A decorative timer animation not connected to a real timer.
- A motion loop that implies an agent is working while disconnected.
- Different Vela states represented only by minor changes in the same shape.
- A "parachute" thinking pose moved slightly faster.
- Block Library demonstrations that cannot insert a functioning block.
- Duplicate resource stores introduced for visual convenience.
- Hard-coded fabricated event graphs shown as live operations.
- Large unbounded SVG/DOM graphs that collapse under real workloads.
- Disabling accessibility or interaction to achieve an attractive screenshot.
- Declaring completion after a prototype clip without real integrated desktop behavior.

Positive evidence should show why each instrument makes information **more legible, more useful and more delightful**.

---

# 16. Codex implementation brief (companion directive)

The following implementation instructions are intentionally included so this design reference can be handed directly to a dedicated Codex visual-engineering workstream.

**Mission:** Implement the complete Living Instruments and Expressive Presence program in the existing Aerynth application. This is not a request for a new app, a second Motion Coordinator, a mock data universe, or superficial CSS polish.

1. Read \`AGENTS.md\`, the governance registry, Constitution, and focused sections using Governance Context Router V2. Follow current authority status; do not invent acceptance or amend governance silently.
2. Inspect current PR #19 and related integration heads. Establish an isolated visual branch/worktree and coordinate shared file ownership with active Vela Rebirth work.
3. Enumerate every registered block and create concise source-to-design-to-test traceability. Distinguish real implementation from placeholders and fixtures.
4. Extend shared instrument contracts and the existing Motion Coordinator; use semantic state mapping and interruptible motion. Preserve canonical resource identity, security, and accessible alternatives.
5. Build the **Intelligence Stream** as a genuine interactive causal current with Glimpse, Flow and Forensic modes, real event links, branch/merge behavior and navigation.
6. Build the **Timeline** as a functioning, editable, zoomable, horizontal/vertical temporal instrument with real date/time behavior, multi-lane and replay support.
7. Redesign **Vela's presence** with unmistakable operational silhouettes and continuous transformations. Replace the disliked parachute thinking state. Drive states from actual backend/voice activity.
8. Integrate the **Clock/Timer family** with the real native timer engine as it becomes available; do not simulate a live timer as a completed feature.
9. Rebuild the **Block Library** as a discoverable showroom with accurate short descriptions, replayable demonstration previews, and direct drag/keyboard insertion into canonical workspaces.
10. Upgrade Notes, Chats, Checklist/Tasks, Agents/Teams, Metrics, Resource/Collection Browsers, Research/Evidence, Files/Media and all other registered block types to intentional, purpose-specific Living Instruments.
11. Keep this separate from authorization and billing scope expansions. Preserve the direct Codex and ordinary conversation experience; no unrelated provider/API reconfiguration.
12. Implement focused tests, integration tests, fault/restart checks, reduced-motion/accessibility checks, and real native motion/performance capture.
13. Maintain maximum verified progress per paid credit: targeted source reads, compact governance retrieval, deterministic tooling, independent safe parallelism, no redundant context copying, bounded retries, and no unnecessary live provider calls.
14. Provide concise progress reports with exact files, tests, benchmark evidence, demos, commit links and genuine blockers. Never claim completion from screenshots or fixture-only runs.
15. Deliver a full end-to-end Windows desktop demonstration and reconcile all acceptance scenarios LI-01 through LI-20 before calling the implementation complete.

**Final experience:** Aerynth's Timeline makes time tangible. Its Intelligence Stream makes real causal work visible. Every block feels like a purpose-built living instrument. Vela's actual operational states transform into clearly legible, beautiful geometry. The whole app feels like one coherent luminous information environment, not a collection of unrelated rectangles.

---

# 17. Final product principle

**The starfield creates the atmosphere. The Living Instruments create the interaction language. Vela's transformation creates the presence.**

Aerynth should not be extraordinary because everything glows. It should be extraordinary because the intelligence, information, time, tools and space behave together naturally.

**Build the complete experience. Verify the real interaction. Keep it beautiful because it is useful.**
