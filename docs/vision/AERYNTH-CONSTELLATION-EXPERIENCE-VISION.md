# Aerynth Constellation
## A Living, Navigable Universe of Projects, Conversations, Knowledge, and Intelligent Work

> **A project is a place you can enter. A conversation is a path you can follow. A relationship is something you can see, inspect, and trust.**
>
> **Constellation is not a space-themed file browser. It is a spatial representation of Aerynth's real, permissioned information graph: a world that can be explored in three dimensions without losing the clarity of ordinary work.**
>
> **Zoom out to understand the whole. Move closer to discover the structure. Select anything to work with it. Return without losing your place.**

| Attribute | Value |
|---|---|
| Development initiative | **Project Aetherwake** |
| Product | **Aerynth** |
| Persistent assistant | **Vela** |
| Subsystem working name | **Aerynth Constellation** |
| Experience | **Spatial Knowledge and Relationship Navigation** |
| Document classification | **Proposed product experience vision with exploratory architecture and acceptance scenarios** |
| Status | **Proposed for owner review; not approved governance, an implementation claim, or a committed architecture decision** |
| Edition | **0.1 — November 1, 2026** |
| Scope | Project universes, resource constellations, graph relationships, 3D exploration, connected branches, agent observability, Vela navigation, work-surface continuity |
| Primary architectural authorities | [Constitution](../../governance/00-AETHERWAKE-CONSTITUTION.md), [Projects/Workspaces/Resources](../../governance/03-PROJECTS-WORKSPACES-AND-RESOURCES.md), [Conversations/Connected Branches](../../governance/04-CONVERSATIONS-AND-CONNECTED-BRANCHES.md) |
| Additional affected domains | [Experience](../../governance/01-EXPERIENCE-AND-INTERACTION.md), [Liquid Intelligence](../../governance/02-LIQUID-INTELLIGENCE-AND-MOTION.md), [Agents](../../governance/05-AGENTS-TASKS-AND-WORKFLOWS.md), [Vela](../../governance/06-VELA-INTELLIGENCE-AND-ADAPTATION.md), [Knowledge](../../governance/07-NOTES-KNOWLEDGE-AND-THOUGHT-STREAM.md), [Context](../../governance/08-CONTEXT-INTELLIGENCE-AND-MEMORY.md), [Observability](../../governance/09-INTELLIGENCE-STREAMS-AND-OBSERVABILITY.md), [Timelines](../../governance/11-TIMELINES-AND-REPLAY.md), [Performance](../../governance/13-PLATFORM-PERFORMANCE-AND-DISPLAYS.md), [Trust](../../governance/14-TRUST-PRIVACY-AND-AUTONOMY.md), [Quality](../../governance/15-QUALITY-VERIFICATION-AND-ACCEPTANCE.md) |
| Visual relationship | Compatible with the emerging **Living Intelligence / Luminous Architecture** art language; no production host or renderer is selected by this document |
| Data policy for this public repository | Examples are fictional synthetic fixtures, not real personal conversations or credentials |

---

# Part I — The Discovery

## 1. The premise: knowledge has a landscape

Traditional software presents work as lists of tabs, trees of folders, search results, and isolated application windows. These are useful representations, but they obscure relationships. A project may contain many conversations, code changes, tasks, research notes, agents, decisions, and plans. The user is expected to remember where they are, what relates to what, and which activity actually changed something.

Aerynth already envisions persistent resources, Connected Branches, agent workflows, project contexts, Vela, timelines, and an honest Intelligence Stream. **Constellation is the optional spatial experience through which those systems become collectively navigable.**

The defining image is celestial: a luminous central structure representing a project, surrounded by interconnected resource clusters reminiscent of planets, moons, rings, satellites, and constellations. The user can orbit, pan, zoom, and move through this world. Branches extend from conversations; tasks connect to plans; agents are associated with the work they perform; findings can connect resources across projects. The objects exist at meaningful positions and persist as the user moves among views.

This is **not** a literal solar system. Information is not required to obey celestial mechanics. The astronomical language is an expressive way to communicate **scale, hierarchy, proximity, relationship, navigation, and discovery**.

## 2. The moment of wonder

Imagine beginning at the **Universe View**: several softly illuminated project systems float in a vast, calm, dimensional environment. Each has a distinct but restrained character. One system is active; the others remain accessible.

Select a project. The camera moves toward its central anchor. Related resources resolve from distant points into recognizable structures. The project is not reduced to a single folder. It is a living network with multiple paths through it.

Approach a workstream. Its conversations, task dependencies, notes, and execution records become clearer. Select a conversation. The same identifiable object unfolds into the familiar, readable Aerynth conversation surface. Work normally. Close the surface; the view returns to its preserved spatial location and orientation.

Fork the conversation into a Codex-backed branch. A new resource is created, its parent relationship is recorded, and the new node appears within the system. A small connection becomes visible. The two conversations can later share findings through the explicitly authorized Connected Branches mechanism without rewriting either history.

Zoom out. The project has evolved. The user can see the new branch as part of a comprehensible whole.

**This is the signature experience: the interface becomes a navigable expression of authentic relationships, not an animated diagram of imagined thinking.**

## 3. Emotional and practical goals

The experience should evoke:

- **Wonder:** a world whose scale suggests there is more to explore.
- **Orientation:** an immediate sense of what belongs together and where to return.
- **Continuity:** objects do not vanish or change identity when the view changes.
- **Agency:** the user can steer, inspect, pin, filter, and return.
- **Trust:** every meaningful link can be explained.
- **Calm:** the atmosphere remains spacious, with restrained motion.
- **Competence:** deep exploration never makes ordinary work slower than necessary.

A successful Constellation is impressive in the first minute **and useful after an hour**. Users should be able to answer questions such as "What is this connected to?", "Where did this conclusion come from?", "Which branches are still active?", "What changed?", and "What needs me?" with fewer steps than traditional navigation.

## 4. What this subsystem is not

Constellation must not become:

1. A mandatory navigation mode.
2. A decorative 3D screensaver masquerading as information architecture.
3. A second, competing database of conversations or projects.
4. A gravity simulation in which important nodes drift unpredictably.
5. A collection of randomly connected glowing points.
6. A representation of inaccessible private model reasoning.
7. A way to conceal information inside difficult camera controls.
8. An excuse to duplicate resource content when a view moves.
9. A permission bypass through graph indexing, tooltips, thumbnails, or inferred relationships.
10. A GPU-intensive scene that overwhelms the machine while the user works elsewhere.
11. A literal imitation of a particular science-fiction game, film, station, or proprietary design.
12. A replacement for excellent chat, list, search, task, graph, or timeline interfaces.

---

# Part II — The Celestial Information Language

## 5. The universe, systems, orbits, and constellations

The proposed visual hierarchy has several **semantic zoom** levels:

| Zoom level | Human meaning | Candidate presentation | Primary user question |
|---|---|---|---|
| **Universe** | Multiple project contexts and selected cross-project relationships | A field of distinct luminous systems | "What am I involved in?" |
| **Project system** | One project's workstreams and major resources | Central project anchor with nearby clusters | "How is this project organized?" |
| **Regional constellation** | A workstream, topic, or selected relationship neighborhood | Meaningful nodes and inspectable edges | "What relates to this part of the work?" |
| **Resource neighborhood** | One conversation, file, task, decision, or agent and its direct relationships | Focused graph with rich metadata | "Why is this connected?" |
| **Working surface** | The actual canonical resource opened for use | Familiar readable chat/editor/timeline/etc. | "Let me work." |

The hierarchy is a **navigation scale**, not a rigid data hierarchy. A resource may belong to several collections, relate to several projects, or be relevant to multiple workstreams. It must retain a single canonical identity while appearing in authorized projections of more than one system.

### 5.1 Central stars: project anchors

A project can be represented by a distinctive luminous center or engineered celestial object. This is a **presentation anchor**, not the project's database parent for every resource. A project's appearance may summarize selected status, activity, or attention signals, but only when the signals are attributable.

Projects need not be portrayed as identical burning suns. The art direction should favor refined, computational forms compatible with Aerynth's violet, sculptural, astronomical identity.

### 5.2 Planets: major resource clusters

Large resource areas might appear as planets or sophisticated orbit-like objects: a research cluster, software subsystem, campaign, design program, or major workstream. Their position communicates selected structure and proximity, not universal scientific taxonomy.

The same workstream may have several relationships and belong to more than one project context. Cross-project references should be visible selectively, not forced into ownership duplication.

### 5.3 Moons and satellites: conversations, notes, tasks, artifacts

Smaller resource instances are represented with forms appropriate to type and density. A conversation might have a ribboned origin marker; a task might show its dependency condition; a note might be a compact folio; an artifact might have a material/preview-specific glyph.

**Not every conversation is a moon, and not every task is a star.** Shape should reinforce function, not become an arbitrary classification game. Dense relationships can be collapsed into meaningful summaries.

### 5.4 Constellation filaments: typed relationships

Delicate links connect genuinely associated entities. They may curve, fade, cluster, or reveal detail on selection, but their semantic meaning comes from canonical typed relationships, not from artistic proximity.

Links might express:

- branch ancestry;
- project or collection membership;
- reference or citation;
- task dependency;
- agent assignment;
- artifact production;
- knowledge contribution or adoption;
- execution correlation;
- explicit user-created association;
- **suggested** similarity, clearly labeled as inferred.

Selecting a link should reveal its type, source, target, evidence, visibility scope, and relevant history.

### 5.5 Shared orbits without false hierarchy

One resource can connect to several branches, tasks, or projects. A 3D view must support genuine graphs with multiple parents/cross-links. A branch tree alone is insufficient. Spatial closeness must never be treated as proof of ownership, causality, or context exchange.

---

# Part III — A Place You Can Actually Navigate

## 6. Camera: orbit, pan, zoom, approach, and return

Constellation should make free exploration feel cinematic **without sacrificing predictability**.

**Core navigation vocabulary:**

- **Orbit** around a selected anchor while preserving it as the focal target.
- **Pan** across a local constellation or project field.
- **Zoom / dolly** between scales while retaining orientation.
- **Approach** a selected object through a direct, cancellable camera transition.
- **Focus** one node and reveal its relevant neighborhood.
- **Follow connection** from one node to an attributable neighboring node.
- **Back / breadcrumb return** to a saved camera and selection state.
- **Recenter / reset view** to a stable known position.
- **Fit selection / fit cluster** in a comfortable framing.
- **Search-to-locate** using ordinary text search, not spatial memory alone.

A more free-form fly mode may be explored, but should be **optional**, discoverable, and bounded. Basic navigation must never require flight-simulator controls or high mouse precision.

### 6.1 Desktop input defaults to explore

Explore sensible mappings for mouse, keyboard, trackpad, touch, and controller where supported. A suggested desktop baseline: drag empty space to orbit or pan according to explicit mode; wheel/trackpad zoom; click select; double-click/Enter approach; Escape/back unwind; keyboard accessible object list for direct navigation.

Input bindings are research decisions, not settled requirements. They must not conflict with typing, dragging resources, or native window controls. Provide an accessible settings surface to change or disable unusual camera behavior.

### 6.2 Camera motion quality

Camera moves should use coherent acceleration and damping, stable targets, and smooth interruption/retargeting. Prevent disorienting spins, sudden flips, near-plane clipping, teleporting focus, and unbounded acceleration. Preserve a recognizable horizon/reference when appropriate; do not require a literal up direction in the final world.

The user should always know how to return home. **An infinite universe with no obvious way back is a software defect, not a feature.**

### 6.3 Semantic zoom is more important than raw distance

Changing scale should change **information density**, not only object size:

- At distance, show recognizable clusters, major status signals, and limited labels.
- At middle scale, show cluster names, selective links, and meaningful relative placement.
- At close scale, show individual nodes, relationship types, provenance cues, and actions.
- At focus, reveal a normal working surface rather than microscopic 3D text.

Transitions should preserve the origin of an object so that the user recognizes it at every scale.

### 6.4 Stable spatial memory

The scene must not perpetually reorganize. User-defined positions, pins, saved cameras, named views, and chosen layouts should be durable. Automatic layout changes should be incremental, explained when substantial, undoable where practical, and constrained by pinned nodes.

Suggested behaviors:

- New resource appears near its strongest explicit contextual anchor.
- New branch grows near the parent without shifting the entire constellation.
- New cross-link changes connection visibility without pulling unrelated resources across the screen.
- A filter hides/reveals nodes without overwriting saved coordinates.
- A user can temporarily reorganize a cluster, preview the proposed change, and save/undo it.
- Returning to a project restores the last meaningful view or a chosen saved view.

---

# Part IV — The Real Information Graph Beneath the Stars

## 7. Canonical graph, not ornamental geometry

Constellation is a **projection** of existing Aerynth resources and relationships. The source of truth remains the domain systems specified by governance. The rendering scene must not mint canonical resource IDs by inventing visual objects.

The key distinction:

**Domain entity** = a canonical resource, project, conversation, task, agent, artifact, or relationship.

**Graph projection node** = an authorized view-model representation of that entity within one filtered context.

**Visual object** = a renderable representation of a projection node at a scene position.

The same canonical resource may appear in several project or workspace views without becoming multiple conversations, files, or task histories.

## 8. Proposed typed entity families

| Family | Real meaning | Example (synthetic) |
|---|---|---|
| Project | Durable project context | Project Meridian |
| Workspace | Saved working arrangement | Harbor Development Desk |
| Resource | Identity-addressable canonical object/reference | Project specification |
| Conversation / branch | Independent conversation history and its lineage | Harbor planning branch |
| Note / finding / decision | Attributed knowledge record | Navigation constraint |
| Task / milestone | Work with ownership and lifecycle | Validate transport route |
| Agent / execution | Assistant role and a concrete execution attempt | Planning Agent / run 08 |
| Artifact / file / commit | Deliverable or observed external object | Drawing revision |
| Timeline / event | Historical, planned, or observed temporal record | Verified review event |
| Collection / topic | Membership or dynamic grouping | Ship Systems |
| External reference | Provider-backed locator with availability and freshness | Repository file reference |

Do not conflate a persistent agent identity with one run, a conversation with a CodeX execution, a project membership with a workspace placement, or a visual star with any of these entities.

## 9. Proposed edge vocabulary

The typed relationship model should build on canonical relationship semantics from the applicable charters.

| Edge type (illustrative) | Intended question | Integrity concern |
|---|---|---|
| belongs_to_project | Which project includes this object? | Membership is not exclusive ownership |
| appears_in_workspace | Where is this resource presented? | Presentation is not canonical identity |
| branches_from | Where did this conversation diverge? | Distinguish chat branching from Git branching |
| references | What does this resource explicitly cite? | Citation is not endorsement |
| depends_on | Which task blocks this task? | Direction matters |
| assigned_to | Who/what is responsible? | Assignment is not execution |
| produced_by | Which execution produced this artifact? | Requires attributable evidence |
| related_to | What relationship was explicitly curated? | May be non-causal |
| knowledge_published_to | Where was a finding shared? | Publication is not context insertion |
| knowledge_adopted_by | Which branch accepted this finding? | Adoption is not historical rewriting |
| supplied_to_context | Which execution actually received context? | Must be supported by execution evidence |
| suggested_similarity | Which resources might be relevant? | Inference, not fact |
| correlated_with_event | Which observed events concern this resource? | Correlation is not causation |
| supersedes / disputes | How did knowledge or decisions change? | Preserve conflicting and historical states |

These identifiers are **conceptual examples**, not an approved wire schema. In particular, context transfer needs the finer distinctions in the Connected Branches and Context Intelligence documents.

## 10. Every connection must answer "why?"

Selecting an edge should expose:

1. Source and target resource identities.
2. Human-readable relationship type and direction.
3. Whether the edge is user-authored, provider-reported, observed, inferred, or unavailable.
4. Source message/event/artifact references where applicable.
5. Timestamp, version/freshness, and known capture gaps.
6. Visibility/access limitations.
7. A suitable action: inspect, follow, compare, hide, dismiss suggestion, or navigate to evidence.

Different edge classes should have accessible non-color cues (shape/dash/label/icon/weight) and clear detail views. Suggested connections must never be silently promoted to verified relationships merely because the model found them convincing.

## 11. Example: a conversation becomes a branch family

A synthetic Harbor Planning conversation contains a decision to explore three approaches. The user creates two normal chat branches and one Codex conversation.

The graph records distinct conversation identities with a shared origin. A branch view renders the three branches and fork point. The Codex branch has one or more separate execution attempts. If a finding is made in one branch, it remains in that branch until publication/adoption according to Connected Branches policy.

The graph may render:

- a line for **branches_from**;
- a line for an explicitly published finding;
- a different state for **retrieved for inspection**;
- an explicit, provenance-linked indication of knowledge actually **supplied to execution context**.

It must not portray three separate model sessions as one shared conscious mind.

## 12. Cross-project relationships and graph multiplicity

A resource may have authorized associations with several projects without duplicate canonical content. The Constellation must choose an understandable representation of cross-project resources:

- one node with cross-system links in a combined view;
- multiple **view instances** labeled as the same canonical object, with shared selection;
- a cross-project connection/portal that reveals the same resource after navigation.

The choice is a design research decision. All options must make canonical identity inspectable and must respect access boundaries.

## 13. Spatial layout is a derived, versioned model

Data and layout must be separate. A suggested pipeline:

~~~text
Authorized domain graph + query/filter + provenance
                       |
                 Graph projection
                       |
       Clustering + semantic zoom + stable anchors
                       |
           Layout solution / scene positions
                       |
       Motion Coordinator + scene representation
                       |
              GPU + readable DOM layers
~~~

Coordinates must never be used to decide whether two resources are semantically connected. A graph relationship must survive any rearrangement. Graph layout must tolerate missing resources, disconnected components, cycles, multiple project memberships, and provider failures.

---

# Part V — A Living Universe of Actual Work

## 14. Agents as recognizable, truthful presences

Agents may appear as distinct luminous entities associated with task/resource nodes. Their representation should be restrained and meaningful rather than a literal fleet of spaceships.

The graph should show an agent's **identity**, **assigned work**, **execution attempts**, and **observed/reported state** as separate concepts. An assigned agent is not automatically active. A stopped execution is not automatically completed work. A successful tool exit is not automatically a verified task outcome.

Possible semantic states include:

- available / idle;
- assigned;
- executing (observable heartbeat, or last event age);
- attention required;
- blocked / failed;
- stopped / interrupted;
- reported complete;
- independently verified where evidence exists;
- disconnected / unknown.

The visual language should distinguish meaningful transitions with labels, shapes, and accessible detail, not just color or generic pulsing.

### 14.1 See the work, not invented private thought

Selecting an agent reveals an Intelligence Stream with authorized, attributable events: tool invocations, available output, edits, handoffs, verification results, and known gaps. Private chain-of-thought or missing activity must not be fabricated. Any synthetic demonstration must remain visibly synthetic.

### 14.2 Delegation as a visible relationship

When Vela delegates a task, a relationship can appear between the initiating goal, the assigned task, the execution, and the resulting artifacts. A visual pulse may acknowledge the **observed start**, but progress and completion must be grounded in recorded lifecycle state.

## 15. Vela as navigator, interpreter, and companion

Vela's existing flowing-ribbon sculptural identity should carry into Constellation, compatible with Living Intelligence and Luminous Architecture. She should feel like a quiet orienting intelligence, not a cursor-shaped tour guide or a mandatory narrator.

Proposed voice/text commands:

- "Show me everything connected to the Harbor planning decision."
- "Take me to the active work in Project Meridian."
- "Which tasks are blocking the next milestone?"
- "Show the conversation branches that reference this file."
- "What changed in this part of the project since yesterday?"
- "Highlight findings published by one branch but not adopted by another."
- "Show only verified completions."
- "Return to my last view."

The command interpreter should resolve explicit selection and context, disclose scope, distinguish available data from assumed relevance, and preview consequential organizational changes. Vela's camera moves should not bypass permissions or cause unauthorized modifications.

### 15.1 Suggestions must remain suggestions

If Vela identifies two related documents, the connection may be offered as a suggestion with evidence and uncertainty. The user can inspect, accept, dismiss, or hide it. The system must not silently forge a permanent canonical relationship from a visual recommendation.

### 15.2 Search is a first-class way to navigate

A search result should be locatable in the Constellation **and** openable directly in an ordinary work view. The user must never be forced to pilot a camera to answer a simple query.

## 16. Timelines and historical replay: a flight recorder for the universe

A Constellation can project recorded history: the creation of a branch, task assignment, an execution event, a verified artifact, or a resource move. A user can scrub a timeline and view the spatial state *as reconstructed from recorded evidence*.

Critical distinctions:

- **Current state** is not the same as **historical state**.
- **Historical reconstruction** is not the same as perfect capture.
- **Planned work** is not the same as observed future outcome.
- **Graph layout changes** do not necessarily represent semantic changes.

Replay should show gaps, uncertainty, and source quality. When historical layout is unavailable, the UI should identify the reconstructed presentation as an approximation. Replay must not fabricate missing operations or pretend that a visual particle stream is a literal thought trace.

---

# Part VI — The Liquid Intelligence Experience

## 17. The signature transition

**Project system → resource node → full working surface → resource node** is the centerpiece.

The object selected in Constellation must retain a recognizable identity as it becomes a conversation, editor, research notebook, agent stream, or timeline surface.

Illustrative choreography:

1. User selects a node; surrounding links and neighbors respond subtly.
2. The selected node gains focus and its material becomes clearer.
3. The camera approaches while other elements recede without losing orientation.
4. A persistent resource visual transforms into an appropriate working surface.
5. The readable DOM/editor view takes over at the correct stage; text stays stable and selectable.
6. Peripheral graph context becomes compact and accessible, not lost.
7. Vela adapts her scale and role without obstructing work.
8. On return, the resource recovers its spatial referent; camera and selection state restore.

This must be designed in concert with the **six-system Motion Coordinator**: Spatial, Material, Atmospheric, Semantic, Interaction, and Performance Motion. A superficial 3D camera fly-through plus a modal dialog would not satisfy the intended continuity.

## 18. Graph edges as living, meaningful light

Connections might use thin filaments, graduated depth, controlled direction cues, or subtle animated flow. However, their motion should represent real updates or deliberately idle ambience, not invented work. A branching event can visibly form a new relationship. A verified handoff can establish a different link state. A merely suggested similarity should look and read differently.

The default scene should be calm. High-degree nodes should not create an unreadable ball of luminous spaghetti. Aggregation and filtering are features, not compromises.

## 19. Living Intelligence and Luminous Architecture

**Living Intelligence** suggests a responsive organic field shaped by resource interaction. **Luminous Architecture** suggests monumental celestial rings, observational structures, and engineered spatial grandeur. Constellation should be compatible with both:

- The same graph projection, resource ID, camera selection, and lifecycle semantics remain unchanged.
- Environmental rendering can vary by art direction.
- Vela remains recognizable.
- Spatial manipulation and focused resource work remain consistent.
- The environment shares a restrained violet, pearlescent, luminous identity without copying any third-party station design.

The architecture should **not** require a heavy physical 3D universe inside every ordinary document window. Render according to the scene's current purpose and device budget.

## 20. Working surfaces are sacred

Chats, code editors, notes, tables, and task details must remain genuinely useful. When a node opens, switch to a readable foreground plane with stable typography and correct input/focus. Ordinary windows, detached surfaces, multiple monitors, and keyboard navigation remain first-class Aerynth behaviors.

A user who prefers lists should be able to perform the same essential work without entering 3D. Constellation is an additional way to understand and navigate work, not an exclusive operating mode.

---

# Part VII — Interaction Architecture and Scale

## 21. The 3D view is a projection, not a database

A possible architecture boundary:

~~~text
Provider adapters / Aerynth resource stores
        |
Canonical identity + membership + typed relationship services
        |
Permissions / freshness / evidence filtering
        |
Graph query and incremental projection service
        |                     |
2D graph/list adapters    Constellation spatial layout
                              |
                        Scene graph + LOD
                              |
                     Motion Coordinator
                              |
               GPU scene + accessible DOM
                              |
                   Native desktop shell
~~~

This is a proposed separation of concerns, **not a selected renderer, library, storage engine, or service protocol**. Match actual implementation to the established architectural decisions when they exist.

## 22. Suggested data contracts (illustrative, nonbinding)

The following TypeScript-like model communicates intended boundaries only. It is *not* an accepted schema, executable API, or a claim about current backend support.

~~~ts
type CanonicalResourceId = string;
type VisualInstanceId = string;
type RelationshipId = string;
type ProjectId = string;

type EvidenceClass =
  | "observed"
  | "reported"
  | "inferred"
  | "unknown";

interface GraphProjectionNode {
  resourceId: CanonicalResourceId;
  visualInstanceId: VisualInstanceId;
  resourceType: string;
  displayName: string;
  projectContextId?: ProjectId;
  visibleState: "available" | "stale" | "unavailable" | "restricted";
  summary?: string; // permission-filtered; never required to draw
  relationshipCount?: number; // only authorized visible links
}

interface GraphProjectionEdge {
  id: RelationshipId;
  sourceResourceId: CanonicalResourceId;
  targetResourceId: CanonicalResourceId;
  type: string;
  direction: "directed" | "undirected";
  evidenceClass: EvidenceClass;
  provenanceRef?: string;
  freshness?: "current" | "stale" | "unknown";
  isSuggestion: boolean;
}

interface SpatialPresentation {
  visualInstanceId: VisualInstanceId;
  layoutId: string;
  position: [number, number, number];
  orientation?: [number, number, number, number];
  scale: number;
  userPinned: boolean;
  layoutVersion: number;
}

interface CameraBookmark {
  id: string;
  scopeId: string;
  focusResourceId?: CanonicalResourceId;
  position: [number, number, number];
  target: [number, number, number];
  zoomLevel: number;
  filtersVersion: number;
}

interface ConstellationQuery {
  projectIds?: ProjectId[];
  anchorResourceIds?: CanonicalResourceId[];
  relationshipTypes?: string[];
  depthLimit?: number;
  includeSuggestions?: boolean;
  timeScope?: { kind: "current" | "historical"; at?: string };
  // Access-control context is resolved by trusted services, not the client.
}
~~~

No spatial object should be authoritative for resource ownership, provider state, branch sharing, or task completion. Layout snapshots should be versioned separately from canonical content.

## 23. The layout engine

Research a multi-scale, constrained graph layout with these qualities:

1. **Deterministic initialization** for the same eligible graph and saved layout.
2. **Stable anchors** to preserve spatial memory.
3. **Incremental placement** for newly created nodes.
4. **Collision and overlap mitigation** at the scale being viewed.
5. **Cluster boundaries** that can express project/workstream context.
6. **Cross-links** without requiring every node to orbit one parent.
7. **User pinning** and saved manual arrangements.
8. **Layout previews** for substantial automatic changes.
9. **Disconnection handling** for orphaned or unavailable nodes.
10. **Accessibility parity** through list/2D representations.

Candidate approaches include constrained force-directed layout, hierarchical clustering, radial arrangement, graph partitioning, and hybrid solutions. **Do not lock one algorithm before prototype evidence.**

A visually satisfying equilibrium is not automatically a comprehensible map. Evaluate whether users can find the same resource again after updates.

## 24. Occlusion, labels, picking, and readability

A physically plausible 3D graph can still be unusable. Design for:

- front/back occlusion cues;
- adaptive labels that are legible at useful distances;
- object picking that works despite perspective;
- selected-node emphasis without obscuring neighbors;
- edge inspection independent of pixel-perfect clicking;
- bounded label collisions and line crossings;
- an always-accessible resource detail view;
- keyboard navigation by logical graph neighbors and search;
- reduced-motion and screen-reader-compatible equivalents.

No essential name, relationship, or decision may exist only as tiny text on a rotating object.

## 25. Progressive disclosure and level of detail

A project with 20 resources and one with 20,000 must remain navigable. At larger scales:

- render clusters rather than every internal resource;
- restrict visible edges by selection, relevance, and filter;
- draw one representative per collapsed group;
- batch/instance geometry where justified;
- show counts with clear scope and provenance;
- load node details when requested;
- retain canonical selection even when a resource is temporarily clustered.

A node hidden by clustering has **not** been deleted. A resource filtered for permissions must not leak through count, cluster shape, hover, search result, or tooltip.

## 26. Resilience and offline behavior

The view should survive partial provider outages, stale indexes, missing evidence, disconnections, graphics loss, display changes, and resume from sleep. Where cached authorized information is available, show it with freshness limitations. Unknown agent state must not appear as active progress.

If 3D rendering fails, users should still be able to access resources through 2D/list/search views. A camera crash must never corrupt canonical data.

---

# Part VIII — Privacy, Security, and Epistemic Honesty

## 27. Permission boundaries precede projection

Permission checks happen **before** nodes, edges, counts, labels, metadata, clusters, or layout are exposed to the renderer. A hidden project's existence cannot be disclosed through an unexplained link or geometric gap.

Cross-project and cross-provider views must resolve permissions separately for each target. If a source edge points to an unavailable target, use an appropriately generic/restricted representation only where policy permits the existence of that link to be disclosed.

Constellation must not turn "searchable" into "shareable," "related" into "context supplied," or "present in graph" into "authorized for agent access."

## 28. Evidence classes and truthfulness

Honor the Observability distinctions between **observed, reported, inferred, and unknown/unavailable**. Distinguish model proposals, agent status reports, independently verified outcomes, and missing coverage. The scene must not contain fake execution pulses that imply real work.

An ambient star shimmer is allowed as decorative art. A bright progress ring labeled "80% complete" is not allowed without defensible progress evidence.

## 29. Privacy and deletion

Conversations and notes can contain sensitive information. Public prototypes must use synthetic data only. Production graph caches, thumbnails, metadata, snapshots, searchable indexes, and historical frames must obey source permissions, retention, revocation, and deletion policies.

When a source is deleted, access revoked, or a provider disconnects, derived graph projections and cached views must reconcile. A saved camera bookmark is not permission to resurrect hidden content.

## 30. User autonomy

Vela may suggest organization, routes through information, or inferred links. Consequential edits, data sharing, task delegation, and canonical relationship changes remain subject to approval/policy and recoverability requirements. A camera transition alone is presentation; a cross-branch knowledge transfer is a real action and requires its own proper authorization.

---

# Part IX — Performance and Engineering Research

## 31. Beautiful on capable hardware; respectful everywhere

Constellation should aim for excellent presentation on the project's target Windows laptop and OLED display while adapting to integrated graphics, lower-end devices, battery mode, and simultaneous gaming/development workloads.

Rendering must be GPU-friendly where appropriate, with bounded simulation and UI update costs. Candidate techniques include instanced meshes, batched line rendering, shader-based atmosphere, LOD, visibility culling, density limits, and rate-limited label/detail updates.

These are research candidates, not requirements to adopt one library.

## 32. Proposed nonbinding test scales

To prevent an attractive three-node demo from masquerading as a scalable product, qualify progressively with synthetic datasets:

| Scale | Synthetic content | Core question |
|---|---|---|
| Tiny | 1 project, 12–30 resources, ~20 edges | Is the experience magical and usable? |
| Small | 5 projects, 200 resources, ~350 edges | Can the user preserve spatial memory? |
| Medium | 20 projects, 2,000 resources, ~5,000 edges | Does grouping and discovery remain legible? |
| Large research case | 50+ projects, 10,000+ resources, 30,000+ edges | Can rendering/querying remain bounded? |

These counts are **experimental fixtures**, not promised supported limits. They should include disconnected components, highly connected hubs, many-to-many project associations, multiple branch types, stale references, and permission-filtered nodes.

## 33. Benchmark what is actually presented

Test active navigation, orbit/pan/zoom, LOD changes, resource transforms, graph update bursts, selection/edge picking, Vela interaction, window resize, and idle/minimized behavior.

Record, where available:

- actual presented frames and frame-time percentiles;
- input-to-response latency;
- CPU and GPU utilization;
- resident memory and attributable VRAM;
- startup/query time and cluster layout time;
- energy/thermal behavior where supported;
- lost/late frame events;
- long-session memory trends;
- render-resource recovery after device loss.

Do not label frequent animation callbacks as proven displayed FPS. Define final numerical budgets through accepted performance decisions and repeatable hardware evidence.

## 34. Three renderer states, one meaning

The Constellation should retain coherent identity across Cinematic, Balanced, Efficient, and reduced-motion/legibility-first configurations. Lower tiers can simplify atmosphere, material richness, particles, LOD, or animation cadence. They must preserve graph truth, selection, edge inspection, search, and navigation.

When minimized or not relevant to the user, rendering should pause or greatly reduce its cost according to platform policy. A high-refresh OLED is not a reason to consume GPU continuously in the background.

---

# Part X — Prototype Strategy

## 35. Build as a parallel, isolated workstream

Constellation is substantial enough to warrant its own experimental workstream instead of being crammed into the ongoing Cinematic V3.5 visual pass.

Suggested isolated prototype location:

~~~text
prototypes/constellation/
~~~

An equivalent path may be used after checking repository conventions. Integrate through domain resource IDs, graph projection contracts, motion intents, scene token/material interfaces, and stable native window behavior. Avoid editing V3.5's in-progress scene files from a parallel branch without coordination.

**First prove the interaction grammar with synthetic graph data.** Only after the spatial and permission semantics are understood should integrations be attached.

## 36. Research milestones

### M0 — Conceptual contract and synthetic graph

Define canonical IDs, typed edges, provenance classifications, filtered projection shape, and sample data. Verify that one canonical resource can appear in multiple views without duplication.

### M1 — A beautiful navigable project system

Render a single luminous central project anchor, several workstreams, and related conversation/task nodes. Support orbit, zoom, pan, focus, reset, selection, and accessible list parity. Establish a clearly original celestial aesthetic.

### M2 — Persistent spatial memory

Save camera bookmarks and node pins. Add branch/node creation and incremental layout without whole-scene rearrangement. Prove restoration after restart and graphical recovery.

### M3 — Working-surface transformation

Open a node as an actual readable conversation or document surface; preserve resource identity and camera return. Integrate with the Motion Coordinator rather than merely overlaying a modal.

### M4 — Connected Branches as a graph, not a tree

Create a synthetic branch family, explicit cross-branch finding, selective adoption, task dependencies, and mixed normal-chat/Codex branch representations. Inspect a selected edge's evidentiary meaning. Confirm that visual connections do not silently transfer context.

### M5 — Truthful agent constellation

Project synthetic, clearly labeled task/execution states and observed/reported evidence. Show an execution start, attention request, report, and separate verified outcome. Include a stream details surface.

### M6 — Vela navigation and scene integration

Accept typed demo queries, resolve selected resources, show why nodes were highlighted, and animate reasonable camera navigation. Bring Vela's established sculptural identity into the space without pretending a live model is connected.

### M7 — Scale, resilience, and human review

Run synthetic medium/large graph cases, access-filtering tests, failure injection, reduced-motion/accessibility alternatives, GPU recovery, idle/minimized tests, and owner walkthroughs. Record what remains unproven.

## 37. The flagship synthetic demonstration

A single demonstration should tell the story without relying on fictional private data:

1. Start at Universe View with three synthetic project systems.
2. Enter **Project Meridian**.
3. Orbit around the central anchor; identify three workstream clusters.
4. Approach **Harbor Systems**.
5. Select a **Harbor Planning** conversation and unfold it into a readable working surface.
6. Create a normal chat branch and a Codex-type branch, explicitly marked as synthetic.
7. Return to the Constellation; see both branches appear beside their origin.
8. Attach an explicitly recorded finding to one branch and **publish** it to a synthetic family index.
9. Select the cross-branch link and inspect why it exists; do not imply publication equals context adoption.
10. Show a task and an assigned agent. Trigger a simulated execution with a visible, attributed stream.
11. Distinguish "reported complete" from "verified result."
12. Ask Vela, through a synthetic command UI, to show all dependencies of the planning decision.
13. Highlight authorized nodes and display the reasons for selection.
14. Zoom back to Universe View; restore the original bookmark.
15. Switch to the 2D/list view and locate the exact same objects using their canonical IDs.

**The user should feel the universe has grown because real state changed, not because arbitrary stars were spawned.**

---

# Part XI — Acceptance, Critique, and Quality

## 38. Required acceptance journeys

| ID | Scenario | What is demonstrated |
|---|---|---|
| CONST-A01 | 3D orbit, pan, zoom, approach, reset | User remains oriented; camera can be interrupted and restored |
| CONST-A02 | Resource node → focused chat → return | Canonical identity, content, selection and camera continuity |
| CONST-A03 | Create branch | Stable new ID, explicit ancestry, incremental placement |
| CONST-A04 | Connect siblings by knowledge adoption | Typed provenance; publication/retrieval/context use remain distinct |
| CONST-A05 | Cross-project resource | No duplicated canonical content or accidental ownership transfer |
| CONST-A06 | Agent reports completion without verification | Visual state remains reported, not verified |
| CONST-A07 | Hidden/restricted resource | No disallowed node, edge, count, tooltip, layout, or search leakage |
| CONST-A08 | Dense hub with hundreds of links | Clustering, selection and edge inspection remain usable |
| CONST-A09 | Pinned layout + new resources | Existing spatial memory preserved; undo/restore works |
| CONST-A10 | Reduced motion / keyboard-only / 2D-list | Equivalent essential operations without 3D navigation |
| CONST-A11 | Event replay with capture gap | Gap disclosed; historical reconstruction not presented as perfect fact |
| CONST-A12 | Device/context loss, resize, minimize | State and access retained; idle costs controlled |
| CONST-A13 | Mixed normal chat/Codex branches | Distinct backend capabilities and independent histories preserved |
| CONST-A14 | Vela search-to-navigate | Grounded scope, explainable highlight, safe direct-open fallback |
| CONST-A15 | User returns next day | Same project system and bookmarks, with fresh/stale status disclosed |
| CONST-A16 | 2k/10k synthetic stress | Recorded scalability and rendering evidence, not a screenshot claim |

## 39. Separate technical acceptance from artistic acceptance

A working graph renderer is not proof that the experience is extraordinary. Artistic review should ask:

- Does this resemble an intentional, original spatial information environment rather than a particle-laden network chart?
- Does a project truly feel like a system with coherent scale?
- Can the user find a node after the graph changes?
- Does the camera make space comprehensible rather than disorienting?
- Are resource surfaces practical once opened?
- Does Vela feel present and useful without dominating navigation?
- Are connections beautiful **and** interpretable?
- Does the application remain quiet when the user needs to read?
- Would an experienced user choose this view to understand complex work, rather than solely for a demo?

Evidence should include actual native video of interactions, source-attributed graph fixtures, deterministic repeatability checks, accessibility/fallback observations, and performance measurements. A public visual prototype may use synthetic content only.

## 40. Review criteria for this proposed vision

This document can be considered complete as a vision artifact when its fundamental promises are clear and consistent with the governing subsystem boundaries. It does **not** itself ratify new requirements or authorize merging a production implementation.

Before architecture lock, the team should record evidence-backed decisions about the canonical graph API, visibility filtering, layout strategy, camera grammar, renderer/host integration, caching policy, accessible alternative, and performance budgets. Owner review of the actual experience remains mandatory.

---

# Part XII — Dependencies, Open Questions, and Non-Goals

## 41. Governance boundary map

This document proposes an integrated presentation, not duplicate authority:

| Domain | Existing owner and boundary |
|---|---|
| Projects, workspace, resource identity and relationships | Charter 03; Constellation consumes canonical IDs/typed relationships |
| Conversations, branch lineage and cross-branch knowledge | Charter 04; Constellation does not edit historical chat transcripts |
| Agents, tasks, delegation and workflow lifecycle | Charter 05; visuals project task/run state |
| Vela context, commands and initiative | Charter 06; navigation commands respect intent/approval |
| Notes and knowledge provenance | Charter 07; spatial location is not knowledge authority |
| CIE retrieval and what context reaches a model | Charter 08; highlighting a node is not context injection |
| Observed/reported/inferred/unknown event classes | Charter 09; graph motion cannot invent execution |
| Time, plans, history and replay | Charter 11; future plans are distinct from observed outcomes |
| Visual/motion continuity | Charter 02; Constellation uses the Motion Coordinator |
| Platform, budgets, desktop windows, displays | Charter 13; rendering is measured and adaptive |
| Privacy, permissioning, autonomy and deletion | Charter 14; filtering precedes visualization |
| Testing, review, human acceptance | Charters 15/16; prototypes do not auto-ratify experience |

The registry currently identifies specialized charters as published **pending owner acceptance**. Their exact status must be rechecked when work begins. The established Constitution retains priority. No statement in this document silently elevates draft charter text or this proposed design to binding authority.

## 42. Open design and engineering decisions

1. **Visual taxonomy:** Should stars/planets/moons correspond to specific resource kinds, cluster scale, or contextual role?
2. **Cross-project representation:** One shared visible node, linked instances, or navigable portals?
3. **Graph persistence:** Which canonical relationship service and event log own durable edges?
4. **Cluster hierarchy:** Which combinations of manual grouping, hierarchical graph partitioning, and layout inference preserve comprehension?
5. **Camera grammar:** Orbit-centric, free-fly optional, trackpad gestures, controller support, and comfort constraints?
6. **Graph movement:** How much automatic rearrangement is permissible before users lose spatial memory?
7. **Spatial bookmarks:** How are camera poses, filters, selected objects, and saved layout versions restored?
8. **Visual encoding:** Which combinations of geometry, shape, stroke, motion, and text distinguish relationship provenance?
9. **Scale strategy:** Which render/LOD architecture meets measured targets with high-degree graphs?
10. **Accessible projection:** What are the precise keyboard, screen-reader, and 2D/list equivalents?
11. **Historical topology:** What does "the graph at this time" mean when evidence/relationships arrive late?
12. **Live adapter capabilities:** Which normal ChatGPT and Codex data/action APIs are actually available and permissioned?
13. **Privacy model:** How are cross-project counts, link targets, caching, inferred similarities, and revocations protected?
14. **Scene transitions:** How does the Constellation share V3.5's GPU environment without tight coupling?
15. **Evaluation:** How will we measure navigation usefulness, not merely aesthetics and FPS?

Do not quietly answer these through convenient code defaults. Prototype, measure, document decisions, and submit substantive choices for review.

## 43. Explicit first-phase non-goals

The first Constellation prototype is **not** required to:

- replicate a complete astronomy simulator or orbital physics engine;
- render realistic astrophysical objects;
- connect to unverified AI provider APIs;
- expose hidden model reasoning;
- implement production multi-user collaboration;
- build the entire Aerynth knowledge graph database;
- process real private conversations in this public repository;
- replace the normal chat, file, notes, or tasks UI;
- build every proposed scene, resource type, or cross-project integration simultaneously.

The first task is to **prove that navigating meaningful relationships as a persistent, beautiful, 3D world is both extraordinary and genuinely useful**.

---

# Part XIII — The Picture to Remember

## 44. A universe that grows with its owner

Aerynth opens into a tranquil, expansive field. Its violet atmosphere is deep and almost celestial. Immense luminous architecture suggests a world extending beyond the screen. A recognizable project system glows in the distance. Vela, a flowing sculptural intelligence presence, remains quietly available.

The user enters the project system and sees its workstreams arranged in a beautiful, comprehensible spatial composition. Their conversations are not buried in a sidebar; their connections are visible. A branch has been created, a task depends on another, and an agent has produced an artifact. Each link has a reason. Each status can be inspected.

The user approaches a conversation. It unfolds as a clear working surface. They read, type, and delegate work. They can follow the evidence, compare branches, return to the graph, and see how the project has changed.

The field is alive, but it never lies. The system is extraordinary, but it never traps the user in spectacle. The graphics serve understanding. The intelligence helps the human remain oriented and in control.

## 45. The governing creative sentence

> **Your work is not a pile of windows. It is a universe of connected ideas, decisions, resources, and actions. Aerynth Constellation makes that universe visible, navigable, and useful without confusing beauty for truth.**

---

## Publication and next action

**Current document state:** Proposed product vision for review, not an adopted charter or implementation status report.

**Suggested next deliverable:** A separate experimental architecture and prototype plan under the appropriate docs/plans paths, validating graph integrity, camera and layout behavior, accessible equivalents, renderer performance, and honest observability before production decisions.

**Approval boundary:** The repository owner decides whether to adopt this direction. A successful Constellation demo does not automatically approve a desktop host, database schema, graphics engine, information-sharing policy, or final visual design.
