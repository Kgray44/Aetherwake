# 03 — Projects, Workspaces, and Resources
## Organizational and Spatial Environment Charter for Aerynth

> **Owner acceptance recorded 2026-11-05.** The owner approves this charter and its reconciled amendments as governing design. Approval does not attest that code, agents, APIs, renderers or tests have achieved these requirements.

| Field | Value |
|---|---|
| Document ID | AW-GOV-003 |
| Version | 1.1.0 — owner-ratified 2026-11-05 |
| Status | **Owner-accepted and ratified governing charter (binding design requirements; implementation separately verified)** |
| Date | 2026-11-01 |
| Authority | Subsystem charter, subordinate to `00-AETHERWAKE-CONSTITUTION.md` |
| Primary domain | Projects, workspaces, blocks, resources, collections, relationships, organization, layouts, and settings inheritance |
| Normative requirement namespace | `AW-PWR-###` |
| Primary constitutional anchors | AW-CON-006, 011–015, 022–030, 031, 036, 041, 047–050, 069–083 |
| Related planned charters | 01 Experience; 02 Motion; 04 Conversations; 05 Agents; 06 Vela; 07 Knowledge; 08 CIE; 11 Timelines; 13 Platform; 14 Trust; 15 Quality |
| Intended readers | Designers, architects, implementing agents, test authors, maintainers, and the repository owner |
| Publication boundary | This public document contains product requirements, not private user data, credentials, or operational telemetry |

> **Governing intent.** Aerynth MUST give the user a coherent, adaptable environment in which projects, workspaces, chats, agents, files, notes, websites, timelines, and other resources can be created, discovered, combined, rearranged, and acted upon without duplication, lost context, rigid ceremony, or opaque organization. The user expresses intent; Aerynth handles the complexity.
>
> **Fundamental distinction.** A *Project* supplies enduring context and belonging. A *Workspace* supplies a way of working. A *Block* supplies a visual interaction surface. A *Resource* is the actual identifiable thing. A *Collection* supplies organization and discovery. A *Relationship* explains how things connect. These are related, but none is a synonym for another.

---

## 1. Authority, scope, and interpretation

This charter elaborates the organizational model required by the Aetherwake Constitution. It defines **observable product behavior, information contracts, invariants, and acceptance outcomes**. It deliberately does not mandate a final desktop shell, rendering library, database engine, search index, or agent-provider implementation.

The Constitution remains supreme. The repository owner retains final authority. The terms **MUST**, **MUST NOT**, **SHOULD**, and **MAY** carry the meanings established by the Constitution.

**In scope:** projects and their boundaries; workspaces and layout instances; workspace and dashboard blocks; canonical resource identity; folders, categories, tags, and smart collections; resource association and navigation; typed relationships and understandable relationship views; reusable templates; local and assistant-assisted organization; workspace-aware context; configuration and inheritance; display-aware persistence; integrity, recoverability, indexing boundaries, and integration contracts.

**Out of primary scope:** the internal Codex conversation protocol (04, 12); agent task execution and delegation (05); Vela's reasoning and initiative policies (06); note content and knowledge epistemics (07); model context and compaction internals (08); full event-observability protocols (09); timeline algorithms (11); graphics physics and shaders (02); platform technology and frame budgets (13); authorization and threat model details (14). This charter defines **organizational interfaces** to those domains without claiming their canonical requirements.

**AW-PWR-001 — Constitutional conformance.** Implementation and derivative specifications MUST preserve constitutional invariants; unresolved conflicts MUST be recorded and escalated rather than silently resolved for convenience.

**AW-PWR-002 — One authoritative home.** Normative organizational requirements MUST be owned here under stable `AW-PWR-###` identifiers. Other charters MAY reference these requirements but MUST NOT create competing definitions.

**AW-PWR-003 — Feature truthfulness.** Planned, simulated, unavailable, disconnected, partially indexed, and working organizational functionality MUST be labeled accurately. A rendered block is not evidence that its underlying resource is connected or current.

**AW-PWR-004 — Unforced workflow.** Ordinary chats, quick notes, individual resource viewers, and direct local navigation MUST remain usable without first creating a formal project, agent, task, or special workspace.

---

## 2. Core ontology and identity

### 2.1 Object families

| Concept | Canonical meaning | Examples | Explicitly not |
|---|---|---|---|
| **Project** | Durable context boundary coordinating resources, knowledge, settings, and work | A software project, design initiative, research topic | An automatically required chat folder |
| **Workspace** | Persistent working environment composing blocks and views | Development desk, monitoring console, planning canvas | A copy of the underlying resources |
| **Block** | An independently configurable presentation/interaction instance | Chat pane, notes tile, terminal, graph, website view | The chat, file, or agent itself |
| **Resource** | Stable identifiable object or reference to a subject | Conversation, note, file, repo, agent, task, URL, timeline | A UI tile or screen coordinate |
| **Collection** | Organizational membership or dynamically evaluated grouping | Manual folder, tag, category, smart collection | Necessarily a physical filesystem folder |
| **Relationship** | Attributable typed association between object identities | references, depends on, produced by, related to | Proof of causality without evidence |
| **Layout** | Versioned arrangement and presentation configuration | Docked development layout, focus layout, freeform canvas | Content ownership |
| **Template** | Reusable recipe for creating or configuring structures | New-project template, workspace layout template | An obligatory clone of source sessions |
| **Selection** | Structured current referents with surrounding context | File, image region, message span, chart interval | Automatic authorization to mutate |
| **View** | A filtered or spatial projection of stored objects | Graph, list, timeline, grid, search results | Independent canonical history |

A *project membership* attaches an object to a project. A *workspace placement* places one block within one workspace layout. A *collection membership* organizes an object. These MUST be modeled as distinct associations.

**AW-PWR-005 — Stable object IDs.** Every persisted project, workspace, block instance, collection, relationship, layout, and Aerynth-owned resource MUST have an immutable internal identity independent of its title, visible path, ordering, coordinates, and external provider IDs.

**AW-PWR-006 — Canonical references.** Multiple views, blocks, links, and collections referring to the same canonical resource MUST NOT accidentally fork or duplicate the underlying content, live session, history, or ownership.

**AW-PWR-007 — Separation of identities.** Block IDs, resource IDs, external provider handles, directory paths, repository URLs, and display labels MUST remain distinguishable. Reparenting or renaming MUST NOT silently replace the canonical identity.

**AW-PWR-008 — Explicit duplication.** When duplication is requested, Aerynth MUST distinguish *another view/reference*, *a structural template copy*, and *a new independent content object*; the action MUST communicate which is being created.

**AW-PWR-009 — Typed lifecycle.** Persisted entities MUST have distinguishable lifecycle conditions as applicable: active, archived, trashed/pending deletion, deleted/tombstoned, unavailable/disconnected, or unresolved reference. These conditions MUST NOT be conflated with provider-side existence.

**AW-PWR-010 — Reference provenance.** References to external systems MUST preserve provider identity and stable locator information where available, the link's original source, last verification time, and a visible indicator of stale or unverified resolution.

### 2.2 Entity relationships and persistence

Conceptual contract (illustrative, not a mandated database schema):

```text
Project ──membership──> Resource
Project ──membership──> Workspace
Workspace ──has──> Layout(s)
Layout ──places──> Block instance
Block ──references──> Resource (or safe local tool/view)
Collection ──membership/query──> Resource / Workspace / Collection
Relationship ──typed edge──> Identified source and target
Template ──instantiates──> Project / Workspace / Layout / Block config
Selection ──references──> Resource + subrange/region + context
```

A workspace MAY be standalone. A resource MAY be unassigned to any project, referenced by several projects, and displayed through multiple blocks. A project MAY contain many workspaces, and the same workspace MAY be linked from more than one project. For deterministic defaults, every workspace MUST have **at most one primary ownership context** (a project or personal/global space); other project associations are references, not competing invisible owners.

**AW-PWR-011 — Cross-location continuity.** Opening a resource from different projects, workspaces, collections, or searches MUST resolve to its canonical identity and preserve the same authoritative state, subject to backend capabilities.

**AW-PWR-012 — Nonownership of external content.** Associating a directory, site, repository, cloud document, or external chat MUST NOT imply that Aerynth owns the referenced source, can edit it, or has copied it locally.

**AW-PWR-013 — No silent cascades.** Archiving, removing a project membership, deleting a block, deleting a workspace, or removing a collection membership MUST NOT silently delete a canonical resource, physical filesystem content, independent chat history, or resources shared elsewhere.

---

## 3. Projects: persistent context without forced ceremony

A project is an optional, durable context center rather than a mandatory prerequisite for work. Its user-facing overview SHOULD make purpose, status, knowledge, linked resources, workspaces, tasks, recent activity, and significant relationships immediately discoverable.

A project MAY include: description and goals; icons and visual identity; knowledge sources and instructions; linked files/directories; repositories; websites; chat references and chat collections; agent profiles; tasks and timelines; workspace memberships; permissions; context and token-efficiency profiles; default display layouts; custom metadata and tags.

**AW-PWR-014 — Project creation and portability.** A user MUST be able to create, rename, archive, restore, search, categorize, and inspect a project without requiring a repository, directory, AI call, or model connection.

**AW-PWR-015 — Project overview.** Project-level navigation MUST provide concise routes to active workspaces, conversations, tasks, knowledge, resources, current activity, and pending attention, with drill-down instead of compulsory visual clutter.

**AW-PWR-016 — Project categories.** Projects MUST support manual categorization, tags, favorites, archiving, and meaningful sorting/filtering. Project categories SHOULD support nesting where it provides value without hiding cross-category membership.

**AW-PWR-017 — Flexible associations.** A project MUST be able to reference existing resources and workspaces without creating unnecessary copies; the user MUST be able to distinguish original ownership, associated membership, and references shared with other projects.

**AW-PWR-018 — Knowledge linkage.** Projects MUST provide a discoverable relationship to structured project knowledge and notes, with clear distinction between authoritative requirements, accepted decisions, observations, hypotheses, and informal ideas. The content and authority model is governed by Charter 07.

**AW-PWR-019 — Context boundaries.** Adding resources to a project MUST NOT automatically inject their full content into every chat or agent context. Context inclusion is explicit, selective, and governed by CIE (Charter 08).

**AW-PWR-020 — Project change preview.** When an organizational command affects many project memberships, folders, or linked resources, the UI MUST show the interpreted affected set and whether it changes *references*, *metadata*, or *actual source content*.

**AW-PWR-021 — Safe project removal.** Removing a project MUST offer clear choices for detaching memberships, retaining independently owned resources/workspaces, and treating any truly project-owned Aerynth content according to a reversible retention policy. External resources MUST NOT be deleted by default.

### 3.1 Project contexts

Aerynth SHOULD distinguish:
- **Personal/global space:** quick notes, standalone chats, loose resources, and uncategorized work.
- **Project-owned space:** resources and defaults whose primary home is one project.
- **Project-linked space:** a project view of resources primarily owned elsewhere.
- **Shared organizational views:** cross-project searches, dashboards, smart collections, and workspaces.

The UI MUST NOT require a user to reason about storage implementation just to navigate these contexts.

---

## 4. Workspaces: an adaptable environment for real work

A workspace is a persistent assembly of blocks, arrangements, filters, selected objects, display roles, and views. A workspace is not just a dashboard, but it MUST remain usable for simple dashboards as well as advanced spatial working environments.

### 4.1 Workspace modes

Aerynth MUST support the conceptual foundation for:
- **Structured:** responsive rows/grids, snapping, resize, predictable reading order.
- **Docked:** tabs, split panes, resizable panels, detachable surfaces.
- **Freeform canvas:** zoom/pan, spatial placement, connections, optional alignment.
- **Focused:** temporarily emphasize selected resources and hide/de-emphasize unrelated blocks.
- **Presentational/overview:** curated summaries, status, charts, and high-level control.

Modes MAY ship incrementally and require platform capability checks; missing modes MUST be honestly identified. A workspace MAY expose several saved layouts using different modes.

**AW-PWR-022 — Workspace freedom.** Users MUST be able to create, name, categorize, search, favorite, duplicate as a layout/template, archive, and restore workspaces, including standalone workspaces.

**AW-PWR-023 — Block composition.** Workspaces MUST support configurable block addition, movement, resizing, removal, focus, and rearrangement without destroying referenced resource identities.

**AW-PWR-024 — Layout modes and snapshots.** Workspaces MUST support multiple named layouts and restorable snapshots, preserving block identities, resource references, meaningful panel state, filters, and relevant display configuration. Snapshot restore MUST expose its scope and changes.

**AW-PWR-025 — Identity-preserving transitions.** Moving a resource from a dashboard tile to a full editor/chat, docked panel, freeform canvas, or another window SHOULD preserve its observable identity and maintain visually coherent transitions as required by Charters 01 and 02.

**AW-PWR-026 — Recoverable rearrangement.** Layout operations MUST support undo/redo or equivalent reliable recovery where practical. A failed drag, window transition, or layout restore MUST NOT corrupt the underlying resource.

**AW-PWR-027 — No compulsory visual complexity.** Users MUST be able to reduce clutter, collapse sections, temporarily hide nonessential panels, and return to a clear, navigable state without losing their layout or data.

**AW-PWR-028 — Adaptive layout assistance.** Vela MAY recommend or construct workspace layouts based on the user's stated purpose, available linked resources, established preferences, and authorized context. Automatically proposed objects MUST remain editable, removable, and attributable to that action.

**AW-PWR-029 — Focus as a view.** Focus Mode MUST NOT silently delete, archive, change permissions for, or sever relationships among temporarily hidden resources.

### 4.2 Workspace templates and states

Templates SHOULD support a scope such as **Development**, **Monitoring**, **Planning**, **Review**, **Research**, **Server Operations**, or **Blank**. A template's structure and presentation are reusable; its project-specific content bindings must be explicit.

Named layout states such as Overview, Development, Monitoring, Planning, Review, and Custom SHOULD remain user-defined and extensible, not hard-coded workflow silos.

**AW-PWR-030 — Reusable template semantics.** Template creation and instantiation MUST distinguish reusable block types, placeholder/resource binding rules, inherited settings, saved display arrangement, and optional content cloning. Template instantiation MUST NOT secretly copy active agent sessions or sensitive resource content.

**AW-PWR-031 — Template evolution.** Editing an originating template MUST NOT silently rewrite existing workspaces built from it. Optional updates SHOULD present a diff, compatibility information, and user control.

**AW-PWR-032 — Workspace state recovery.** Workspace restoration SHOULD preserve current selection, active tabs, panel scroll/zoom where appropriate, collapsed groups, relevant filters, and unsaved draft safety without assuming every external service is online.

---

## 5. Blocks: visual interfaces, not duplicate resources

A block is an instance of a typed, configurable interaction surface. It may display an Aerynth resource, connect to an external service, or expose a local capability. Different blocks may reference the same underlying resource but maintain independent presentation state, including width, filters, and view mode.

### 5.1 Extensible block families

The architecture MUST permit at least the following conceptual types over the product roadmap:

| Family | Candidate block types |
|---|---|
| AI and conversation | Chat, Agent, Agent Group, Vela Presence, Intelligence Stream |
| Organization | Project, Workspace Shortcut, Resource Collection, Folder, Search Results |
| Knowledge and creation | Quick Note, Document, Project Knowledge, Image, Media |
| Development | File Browser, File Viewer, Editor, Terminal, Git, Pull Request, Code Diff |
| Connected content | Website, Browser View, Repository, External Service |
| Planning and activity | Task Board, Workflow, Calendar, Historical/Planning Timeline, Notifications |
| Metrics and operations | Chart, Token Profiler, System Telemetry, Server Monitor, Console, Event Log |
| Spatial knowledge | Relationship Graph, Agent Constellation, Resource Map |

This is a **capability taxonomy**, not a claim that every block type already exists. Implementations MAY combine related block types where the user's interaction remains coherent.

**AW-PWR-033 — Block contract.** Every block type MUST declare its supported resource types, configuration schema, capability/permission requirements, lifecycle handling, loading/error states, supported presentations, and applicable accessibility representation.

**AW-PWR-034 — Instance versus subject.** A block instance's display settings MUST remain independent of the underlying resource's data and history unless an explicit documented mutation is performed.

**AW-PWR-035 — Adaptive presentation.** Supported blocks SHOULD adapt meaningfully to size, emphasis, and display role: e.g., a compact agent block shows status while an expanded block shows its stream and controls.

**AW-PWR-036 — Resource-aware actions.** Blocks SHOULD expose native, typed actions such as open, inspect, link, reference, move, assign, or request analysis, subject to resource type and user permissions.

**AW-PWR-037 — Resilient content.** Missing external content, expired authentication, unavailable agents, offline files, or failed previews MUST produce truthful, recoverable states rather than blank, misleading, or endlessly spinning content.

**AW-PWR-038 — Third-party block isolation.** Future custom block providers MUST use versioned capabilities, constrained APIs, declared permissions, and boundaries that prevent one block from silently reading unrelated project data.

### 5.2 Universal home canvas

The home screen MUST use the same fundamental block/resource model as project workspaces while allowing independently saved home layouts.

**AW-PWR-039 — Customizable home.** Users MUST be able to add, remove, resize, rearrange, and restore home blocks representing chats, agents, projects, notes, system activity, and other permitted resources.

**AW-PWR-040 — No special-case duplication.** A home block that points to an existing agent/chat/project MUST be another view of that canonical object, not a new hidden copy.

---

## 6. Collections, folders, categories, and discovery

Aerynth's organization MUST support both straightforward folder-based navigation and flexible cross-cutting classification. A **folder in Aerynth** is a logical collection unless explicitly designated as a connected physical filesystem directory.

### 6.1 Collection models

- **Manual collection:** user-selected memberships and ordering.
- **Hierarchical folder:** nested logical grouping, with cycle prevention.
- **Tag/category:** flexible, potentially many-to-many classification.
- **Smart collection:** persisted predicate over indexed metadata, permissions, and available relationship data.
- **System collection:** recents, favorites, requiring attention, archived, unorganized, active agents, or other built-in views.

Smart collections may select chats, tasks, resources, projects, and other typed objects through the same query model where meaningful.

**AW-PWR-041 — Manual and smart organization.** Users MUST be able to create, rename, reorder, nest where appropriate, archive, and delete logical collections; they MUST also be able to create saved smart collections with understandable criteria.

**AW-PWR-042 — Membership without cloning.** One resource MUST be able to appear in several collections without cloning. Removing membership MUST NOT delete the canonical resource unless a separate explicit deletion action is requested and authorized.

**AW-PWR-043 — Query transparency.** Smart collections MUST expose their matching logic, scope, freshness, and known limitations, including disconnected providers and incomplete search indexes.

**AW-PWR-044 — Predictable hierarchy.** Folder nesting MUST prevent cycles. The system MUST make breadcrumbs, current location, parent relationships, and cross-collection appearances understandable.

**AW-PWR-045 — Natural-language organization.** A user MUST be able to request operations such as "put all conversations about this subsystem in one folder" or "find unfinished work from this week." Vela MUST identify candidate resources, explain ambiguous scope, and show an actionable result or preview.

**AW-PWR-046 — Non-destructive defaults.** Automatic categorization and organization SHOULD operate through labels, logical membership, saved views, and reversible changes rather than silently moving physical files or discarding original classifications.

**AW-PWR-047 — Search-to-organization.** Search results MUST support bulk selection, contextual command, previewed grouping, saved queries, and opening the original resource without losing context.

### 6.2 Navigation and findability

Users SHOULD be able to navigate from a search match to its canonical resource, containing project or folder, associated workspaces, and relevant task/agent relationships. Large histories and datasets MUST not make basic navigation unusable.

**AW-PWR-048 — Unified navigation.** Cross-project search, project navigation, workspace switching, and collection browsing MUST use consistent identity and selection behavior. Users MUST be able to locate orphan/unassigned resources.

**AW-PWR-049 — No search-result impersonation.** A search result MUST distinguish exact matches, partial matches, AI-inferred matches, unavailable content, and entries whose source has not yet been indexed.

---

## 7. Relationships: meaning without visual confusion

Relationships are persistent, typed, attributable associations that can be displayed as links, breadcrumbs, chips, lists, graph edges, filtered network views, or timeline correlations. The relationship graph MUST be useful even for users who never open its spatial visualization.

Examples of types: `belongs_to`, `linked_from`, `references`, `depends_on`, `produced_by`, `derived_from`, `assigned_to`, `uses_resource`, `related_topic`, `source_of_fact`, and `view_of`. These examples require formal type definitions before production use; relationship names alone confer no permissions or causality.

**AW-PWR-050 — Typed, directional associations.** Relationship contracts MUST define source and target types, direction, cardinality, provenance, lifecycle, permitted operations, and whether the edge is user-asserted, system-observed, externally reported, or AI-inferred.

**AW-PWR-051 — Evidence and confidence.** Automatically inferred associations MUST retain source evidence, evaluation time, and confidence/verification state where supported. They MUST NOT silently become authoritative facts or decisions.

**AW-PWR-052 — Focused relationship exploration.** Relationship UI MUST provide focused, legible views with filtering, clustering, progressive disclosure, and paths back to ordinary lists/details; a dense global graph MUST NOT be the only navigation method.

**AW-PWR-053 — Meaningful selection.** Selecting a node or edge MUST show its identity, relationship meaning, originating source, and available actions; multi-select and contextual commands SHOULD work across compatible relationship objects.

**AW-PWR-054 — Relationship lifecycle.** Breaking a relationship MUST NOT automatically delete its endpoints. Removing an inferred link SHOULD allow dismiss/suppress feedback without deleting original evidence.

**AW-PWR-055 — Data integrity.** Structural relationships requiring acyclicity (such as containment hierarchy and certain task dependency models) MUST enforce that invariant; ordinary associative graphs MAY contain cycles.

**AW-PWR-056 — Alternative representations.** Relationship insights MUST remain accessible through usable text, list, or tabular views for reduced-motion, assistive technology, and high-density tasks.

---

## 8. Intelligent organization and adaptive workspaces

Aerynth SHOULD recognize useful associations among active projects, existing chats, files, directories, repositories, notes, agents, timelines, and workspaces. Vela SHOULD be able to suggest and perform organization using the same native object APIs as direct UI actions.

### 8.1 Interpret intent before acting

Organizational requests may refer to explicitly selected items, containing folders, all matching resources, active workspace contents, linked projects, or semantically related sets. The selected object is a **referent**, not an unconditional scope boundary (AW-CON-022).

**AW-PWR-057 — Scope-aware commands.** Native command handling MUST distinguish selection, surroundings, language-derived target set, intended action, and authorization. Explicit phrases such as "only this selected file" MUST override broader default inferences.

**AW-PWR-058 — Preview material expansion.** If a command expands from one selected item to a larger set or crosses project, storage, provider, or permission boundaries, Aerynth MUST make the affected scope legible and require a suitable preview/approval for consequential mutations.

**AW-PWR-059 — Structured selection protocol.** Native selected items MUST be representable through typed references: object ID, provider, region/range when applicable, source location, selection provenance, and a recoverable surrounding context, subject to privacy limits.

**AW-PWR-060 — Explainable construction.** AI-created workspaces, smart collections, associations, and layouts MUST expose which resources they reference, why they were chosen where appropriate, and what data/permissions they require.

**AW-PWR-061 — Preference learning boundaries.** Habits MAY influence recommendations and reversible low-risk arrangement choices, but they MUST NOT silently broaden indexing, filesystem access, cross-project disclosure, automatic deletion, or execution permissions.

**AW-PWR-062 — Deterministic action path.** Once an authorized organizational command is interpreted into a validated operation, ordinary application code SHOULD perform the state mutation without unnecessarily re-invoking an AI model.

### 8.2 Suggested actions and proactive discovery

Candidate suggestions include: associate a conversation with a project; create a related-chat collection; surface a linked repository; create a server-monitoring workspace from known authorized resources; offer to group scattered notes; show relevant task/agent relationships; or restore a previously preferred layout.

Suggestions MUST be dismissible and must not be treated as permission for irreversible changes. Feedback SHOULD be available to the Adaptive Experience Engine only within the consent and data-scoping boundaries governed by Charters 06 and 14.

---

## 9. Settings, profiles, scope, and inheritance

Aerynth MUST offer extensive settings without turning everyday work into a configuration exercise. Settings may apply to UI behavior, layout defaults, resource discovery, model/task defaults, rendering, notifications, context strategy, and supported permissioned capabilities.

### 9.1 Configuration scope

The default configuration chain is:

```text
Global defaults
    ↓
Project defaults (when a project is the active governing context)
    ↓
Workspace overrides
    ↓
Chat / Agent profile overrides (as applicable)
    ↓
Task / Execution overrides (where supported)
```

This is a **scope model**, not authorization for lower-priority values to weaken mandatory policy. Some settings are only meaningful at certain levels. Settings applied to an external resource are distinct from viewer-specific preferences.

When a workspace is linked from multiple projects, **the primary project context or explicit active context must be chosen visibly**. The application MUST NOT silently combine conflicting project defaults. Cross-project workspaces SHOULD support a neutral/global context with explicitly chosen project-specific actions.

**AW-PWR-063 — Typed setting registry.** Every configurable value MUST declare its type, allowed range, default, supported scope(s), whether it is inheritable, sensitivity, backend capability requirements, and validation rules.

**AW-PWR-064 — Explainable effective values.** Settings UI MUST show the effective value and its origin (global, project, workspace, chat/agent, task, explicit override, or policy). Users MUST be able to inspect and reset overrides without losing unrelated configuration.

**AW-PWR-065 — Unambiguous context resolution.** A shared or cross-project workspace MUST expose which context supplies inherited project defaults, avoiding invisible collisions between linked projects.

**AW-PWR-066 — Security ceilings.** Permission and access settings MUST obey the appropriate effective authorization policy. A workspace, template, project association, or agent profile MUST NOT silently grant broader access than authorized.

**AW-PWR-067 — Profile convenience.** Reusable configuration profiles SHOULD allow one action to apply coherent settings groups; their effects MUST be previewable, and users MUST be able to override supported individual settings afterward.

**AW-PWR-068 — Capability-aware controls.** Unsupported model, backend, tool, or platform settings MUST be disabled or explained rather than shown as functional controls; availability SHOULD be discovered dynamically where supported.

**AW-PWR-069 — Unobtrusive depth.** Basic settings MUST remain easy to locate; advanced settings SHOULD be searchable, grouped, and progressively disclosed while staying within Aerynth's design language.

---

## 10. Multi-display, windows, and restoration

Display configuration is part of *workspace presentation state*, not canonical resource state. Aerynth must remember useful arrangements while accounting for changing monitor counts, geometry, DPI, rotations, docking, and window availability.

**AW-PWR-070 — Display-aware variants.** The workspace architecture MUST support saved layout variants for differing monitor arrangements and suitable display roles, such as primary development, monitoring, or communications.

**AW-PWR-071 — Safe display transitions.** Disconnecting or resizing a display MUST rehome inaccessible windows and blocks into a usable arrangement without deleting their resources, settings, or layout history.

**AW-PWR-072 — Prefer stable matching.** Display restoration SHOULD use stable monitor identity and capability data when available, with geometry-based or role-based fallback when identity changes.

**AW-PWR-073 — Detached block continuity.** Detaching a block into a separate native window MUST preserve its referenced resource and associated state; re-docking MUST not create duplicate conversations, tasks, or live execution sessions.

**AW-PWR-074 — Motion continuity where possible.** Display and layout transitions SHOULD remain fluid and understandable in accordance with the six-system Motion Coordinator, with appropriate practical fallback for inter-window animations and reduced-motion preferences.

**AW-PWR-075 — Resource-efficient dormancy.** Hidden, minimized, offscreen, or background workspace blocks MUST avoid unnecessary rendering or polling while preserving required critical event handling.

Exact display APIs, layout serialization and graphics thresholds belong to Charters 02 and 13 and approved specifications.

---

## 11. Resource linking, filesystem boundaries, and connected services

Aerynth MUST distinguish **a reference to a file or folder** from **a physical filesystem operation**. A linked external resource may be accessible for metadata only, for reading, or for editing depending on actual permissions and integration capabilities.

**AW-PWR-076 — Reference versus mutation.** Adding a folder/file/website/repository to a workspace or project MUST default to creating a logical reference. Moving a block or resource between logical collections MUST NOT physically move its source unless explicitly requested.

**AW-PWR-077 — Explicit filesystem scope.** Real file operations MUST resolve the intended source and destination, validate authorization and relevant conflicts, and use preview/confirmation appropriate to the operation's impact.

**AW-PWR-078 — Provider-aware availability.** Aerynth MUST distinguish stale links, missing local paths, disconnected providers, authorization failures, and resources that genuinely no longer exist; it MUST NOT infer deletion solely from a temporary lookup failure.

**AW-PWR-079 — No automatic broad scanning.** Linking a directory, opening a project, or displaying a resource MUST NOT grant indefinite unrestricted scanning, content ingestion, or cross-project sharing. Indexing and content access MUST follow explicit settings and permission boundaries.

**AW-PWR-080 — Relocation and rebinding.** If linked resources move or provider handles change, Aerynth SHOULD offer safe, provenance-preserving relinking rather than silently creating new canonical resource identities or breaking every associated block.

**AW-PWR-081 — External-content honesty.** Website, browser, repository, and service blocks MUST accurately communicate whether they show live content, cached content, local previews, or metadata only.

**AW-PWR-082 — Safe imported structures.** Imported templates and project manifests MUST NOT silently execute scripts, request broad permissions, attach credentials, or import sensitive content without an appropriate user-visible boundary.

---

## 12. Persistence, collaboration, history, and recoverability

The organizational model MUST survive application restarts, transient disconnects, version changes, and interrupted layout operations. Not all state must be synchronized remotely; the architecture should support local-first organization with explicit external ownership and portable exports.

**AW-PWR-083 — Durable organization.** Persisted projects, workspaces, block references, collections, layout variants, settings overrides, and relationship metadata MUST survive normal restart and recovery procedures.

**AW-PWR-084 — Transactional integrity.** Organizational updates that touch several objects SHOULD be atomic or recoverable; partial failure MUST leave a clear result and MUST NOT pretend the complete requested operation succeeded.

**AW-PWR-085 — Audit and undo.** Meaningful organizational mutations MUST be attributable in action history. Reversible actions SHOULD offer undo/redo or recovery, while irreversible actions MUST be identified before approval.

**AW-PWR-086 — Concurrent change handling.** Multiple windows, background services, and concurrent agents MUST not silently overwrite each other's saved layout/resource changes. Conflict handling MUST preserve data and report unresolved conflicts where necessary.

**AW-PWR-087 — Backup and migration.** Storage schema evolution MUST provide versioned, testable migrations and recovery strategies. Export/import SHOULD preserve stable object relationships through explicit ID mapping and disclose unsupported external references.

**AW-PWR-088 — Offline continuity.** User-owned notes, workspace organization, layouts, metadata, and locally available resources SHOULD remain navigable when Codex, a cloud provider, or the network is unavailable. Disconnected status MUST be clear.

**AW-PWR-089 — Explicit data removal.** Deletion, retention, archive, detach, and export operations MUST identify whether they affect local organizational metadata, cached content, the canonical internal resource, or external provider content.

**AW-PWR-090 — State/event separation.** Current object state and the auditable historical record SHOULD be distinguishable, enabling reliable restoration and timelines without requiring the UI to reconstruct truth from decorative animation state.

---

## 13. User experience, discoverability, and accessible representation

The organization system is successful only if it reduces cognitive overhead. Complex features MUST remain learnable through direct manipulation, contextual language, sensible defaults, inspectable consequences, and alternative views.

**AW-PWR-091 — Consistent navigation semantics.** Projects, workspaces, collections, search, and context commands MUST use consistent object identity, back/forward behavior, breadcrumbs, and recoverable navigation paths.

**AW-PWR-092 — Semantic orientation.** Each view MUST make it reasonably clear what object is being inspected, where it belongs, which resources it references, and whether the user is acting on a visual block, logical association, or source content.

**AW-PWR-093 — Keyboard and assistive parity.** Essential organizational actions MUST be accessible without drag-and-drop, color interpretation, sound, or complex animation. Spatial/graph views MUST have accessible structured alternatives.

**AW-PWR-094 — Progressive loading.** Large projects, collections, search results, conversation lists, and canvases MUST support efficient incremental rendering and navigation, with explicit loading and data completeness states.

**AW-PWR-095 — Meaningful motion.** Organization changes SHOULD communicate origin, destination, scope, and completion through the Liquid Intelligence motion language. Animation MUST NOT block or disguise underlying state updates and must respect reduced-motion preferences.

**AW-PWR-096 — No configuration maze.** The common actions of creating a chat, writing a note, opening a resource, moving a block, locating a project, and switching workspaces MUST be possible without requiring advanced settings interaction.

---

## 14. Architectural interface contracts (implementation-neutral)

Formal technical schemas belong in `docs/architecture/` or `docs/specifications/` and remain subordinate to this charter. At minimum, contracts SHOULD define the following services:

| Interface | Minimum conceptual operations |
|---|---|
| Object Registry | create, resolve, alias, update, archive, tombstone, enumerate |
| Project Service | create, associate/detach, categorize, inspect, derive context |
| Workspace Service | create, link, open, snapshot, restore, focus, select layout |
| Block Registry | discover type/capabilities, instantiate, bind, configure, dispose |
| Collection Service | membership, folder hierarchy, tag, saved query, evaluate |
| Relationship Service | add, inspect, remove, query neighbors, evidence/provenance |
| Selection Service | capture typed referents and scoped surrounding context |
| Command Service | interpret intent, preview operations, authorize, execute, undo |
| Settings Service | resolve effective value, inspect origin, validate override |
| Resource Adapter | provider-specific resolution, read/write capability, freshness |
| Search/Index Service | scoped lookup, result provenance, completeness metadata |
| Activity/Audit | record changes, correlate authorized actions, inspect failures |

**AW-PWR-097 — Contract validation.** Native operations MUST use typed, validated requests and responses and stable resource IDs. Arbitrary natural-language strings MUST NOT be treated as authorization to execute unvalidated filesystem or service mutations.

**AW-PWR-098 — Decoupled rendering.** Canonical organizational state and operations MUST NOT depend on a particular block renderer, animated scene, window instance, or single active model session.

**AW-PWR-099 — Idempotent/retry-safe behavior.** Operations exposed to agents or background orchestration SHOULD support operation IDs and idempotent replay or safe conflict detection to avoid duplicated projects, blocks, or physical mutations.

**AW-PWR-100 — Provenance-preserving events.** Important object and relationship changes SHOULD produce structured events containing actor, target identities, timestamp, operation, result, and applicable approval/evidence references for downstream observability.

---

## 15. Cross-charter integration boundaries

This charter owns organization; the following documents own adjacent behavior:

| Charter | This charter supplies | That charter owns |
|---|---|---|
| 01 Experience and Interaction | Object identities, selection references, workspace APIs | Command interaction design, input/selection experience |
| 02 Liquid Intelligence and Motion | Semantic layout and state transitions | Physics, materials, particles, motion coordination |
| 04 Conversations and Connected Branches | Chat resource membership, collection navigation, block binding | Conversation history, branching, chat execution semantics |
| 05 Agents, Tasks, and Workflows | Agent/task identity, placements, association | Agent execution, delegation, verification, task lifecycle |
| 06 Vela Intelligence and Adaptation | Native organizational operations, suggestions, context scopes | Initiative, preference learning, assistant behavior |
| 07 Notes, Knowledge, and Thought Stream | Note object identity, placement, project association | Capture behavior, note semantics, knowledge authority |
| 08 Context Intelligence and Memory | Scoped project/resource references, knowledge metadata | Retrieval policy, compaction, memory integrity, token optimization |
| 09 Intelligence Streams and Observability | Event subjects and resource relationships | Event stream semantics, telemetry provenance, replay fidelity |
| 10 AI Execution Profiler | Organization by project/chat/agent | Usage metrics, timing, budget accuracy |
| 11 Timelines and Replay | Timeline resources and workspace embedding | Temporal models, forecasts, historical replay |
| 12 Codex Execution and Integrations | Canonical resource adapters and references | Backend protocol, authentication, tool capabilities |
| 13 Platform, Performance, and Displays | Display-role and layout requirements | Platform APIs, benchmarks, graphics/performance policy |
| 14 Trust, Privacy, and Autonomy | Operation-scope and authorization touchpoints | Security rules, privacy, approval and audit policy |
| 15 Quality, Verification, and Acceptance | Testable organizational requirements | Cross-system quality gates and acceptance evidence |

**AW-PWR-101 — Interface ownership.** Contracts crossing subsystem boundaries MUST identify their canonical owner and maintain compatibility or a documented migration path.

**AW-PWR-102 — No speculative parity.** The project MUST NOT assume a backend, plugin, provider, browser, or operating system offers a capability merely because Aerynth's generic resource model can represent it.

---

## 16. Mandatory acceptance scenarios

The following demonstrations are required **when the corresponding feature is claimed complete**. Milestones MAY deliver smaller explicitly labeled slices without claiming the full charter is implemented. Tests MUST examine both data integrity and observable UI outcomes.

| ID | Scenario | Pass condition |
|---|---|---|
| **PWR-A01** | Standalone chat or note | Created and recoverable without project/workspace setup; normal chat remains usable |
| **PWR-A02** | Canonical resource in two workspaces | Same underlying resource/session appears twice; edits persist consistently; no duplicate history |
| **PWR-A03** | Remove one block | Block disappears; source resource and other references remain intact |
| **PWR-A04** | Project association across contexts | Linked resource appears from two projects; primary ownership and active defaults are unambiguous |
| **PWR-A05** | Create and restore workspace snapshot | Positions, block bindings, tabs and relevant view state restore without source duplication |
| **PWR-A06** | Template instantiation | New workspace layout is created; existing live agents/chats are not secretly cloned |
| **PWR-A07** | Smart collection | A saved query updates with matching resources; matching logic, indexing limits and result origins are inspectable |
| **PWR-A08** | Natural-language grouping | Assistant groups chats by topic through logical membership, preserving original chat histories |
| **PWR-A09** | Contextual scope expansion | Select one file, ask to move all files in its containing folder; proposed full set and destination are previewed |
| **PWR-A10** | Scope restriction | Select one file, say "only this file"; resulting operation never expands silently to siblings |
| **PWR-A11** | Logical versus physical move | Moving a link between projects changes membership only; no filesystem mutation |
| **PWR-A12** | Relationships and provenance | Inferred edge is visually and semantically distinct from a user-created/verified edge; source and confidence inspectable |
| **PWR-A13** | Graph alternative | Same relationships can be explored via focused list/details and keyboard navigation |
| **PWR-A14** | Setting inheritance | Effective value and source are visible; override/reset works; permission ceilings cannot be bypassed |
| **PWR-A15** | Two-monitor to one-monitor | All windows/blocks remain reachable and their referenced resources intact after disconnection |
| **PWR-A16** | Unavailable external resource | Connected source fails; existing logical representation remains, reports uncertainty, and offers recovery |
| **PWR-A17** | Interrupted organization transaction | Partial failure is identified, completed steps/audit are visible, and recovery is possible |
| **PWR-A18** | Adaptive construction | Vela proposes a workspace using existing project resources; bindings, rationale, and edits are inspectable |
| **PWR-A19** | Offline organization | Local project metadata, notes navigation, and workspace layout remain usable without the AI backend |
| **PWR-A20** | Home and workspace same object | Shared resource can be opened from home and project workspace with identical canonical identity |
| **PWR-A21** | Reduced motion and keyboard use | Resource operations can be performed without complex animation, drag, or pointer-only interactions |
| **PWR-A22** | Large collection/search | Incremental rendering remains navigable; index completeness and stale results are not hidden |
| **PWR-A23** | Concurrent window editing | Concurrent block changes do not silently erase one another; conflicts are resolved or displayed |
| **PWR-A24** | Export and migration | Project/workspace structures and relationship mapping survive supported export/import, with unsupported external refs disclosed |

### 16.1 Quality evidence

For each completed scenario, evidence SHOULD include:
1. The governing requirement IDs tested.
2. The actual persisted object/reference state before and after.
3. An interaction recording or UI state capture when experiential behavior matters.
4. Failure/recovery and relevant security-boundary results.
5. Performance observations for long collections, many blocks, and multiple windows.
6. Any external-provider limitation, mock data, temporary exception, or open issue.
7. A statement distinguishing **implemented**, **tested**, **accepted**, and **planned** status.

**AW-PWR-103 — Evidence-based completion.** A feature MUST NOT be marked complete solely because the UI control appears or a mock interaction looks correct; it must pass relevant functional, integrity, accessibility, performance, and experiential checks.

**AW-PWR-104 — Reference safety regression.** Tests MUST cover accidental cloning, orphaning, wrong-context inheritance, wrong-scope mutation, resource deletion cascade, stale external link confusion, and concurrent overwrite.

**AW-PWR-105 — Visual fidelity is acceptance.** Where this charter calls for fluid and coherent block/workspace transitions, functional tests alone do not establish completion; applicable Charter 02 visual and performance standards must also be met.

---

## 17. Open design questions and implementation research

The following are intentionally **not settled choices**:

1. Final persistence engine, schema layout, ID generation scheme, and optional distributed synchronization model.
2. Search/index implementation, semantic retrieval, incremental indexing policy, and cache invalidation.
3. Final structured/docked/freeform layout library or custom spatial engine.
4. Maximum practical block density, virtualization limits, and specific target latency/frame budgets.
5. Multiple-window ownership and transactional coordination mechanism.
6. Detailed import/export formats and handling of unsupported third-party resource types.
7. Template binding expression language and the boundary for third-party block extensions.
8. UX details of cross-project default-context choice when a workspace is shared.
9. Permissioned handling for mixed internal/external multi-resource selections.
10. Details of relationships between observed activity and user-corrected/inferred knowledge.

These questions MUST be addressed through research, prototypes, architecture decisions, and tests consistent with this charter. Their open status MUST NOT be used to silently remove user-facing capabilities.

---

## 18. Traceability map

| Constitutional requirement | Specialized governing coverage |
|---|---|
| AW-CON-006, 011–015 | AW-PWR-004, 014, 022, 027, 048, 091–096 |
| AW-CON-022–025 | AW-PWR-020, 057–060, 076–077, 085, 097 |
| AW-CON-026 | AW-PWR-005–013, 017, 023, 033–034, 040, 042 |
| AW-CON-027 | AW-PWR-016, 041–049, 057–062 |
| AW-CON-028 | AW-PWR-050–056 |
| AW-CON-029 | AW-PWR-022–032, 039–040 |
| AW-CON-030, 078 | AW-PWR-070–075 |
| AW-CON-031, 035 | AW-PWR-004, 011, 047–049, 094 |
| AW-CON-036, 041 | AW-PWR-019, 028, 060–062 |
| AW-CON-047–050 | AW-PWR-018–019, 049, 051 |
| AW-CON-069–073 | AW-PWR-058–061, 066, 076–082, 085–089 |
| AW-CON-080–083 | AW-PWR-005–013, 030–038, 083–090, 097–102 |

### Document acceptance and amendment

This published document records the proposed governing requirements for Subsystem 03. It becomes an owner-accepted charter when the repository owner records approval or ratification. Until then, status MUST remain distinguishable from the foundational Constitution's established baseline.

Changes MUST preserve requirement IDs where meaning is unchanged; changed semantics require explicit impact review. Dependent architecture, implementations, tests, and relevant governance references MUST be reviewed for consistency. The governance index MUST reflect the document's actual publication and acceptance state.

**Final governing standard:** Aerynth's organizational model succeeds only when a user can effortlessly find, understand, combine, organize, and act upon work across multiple places **without losing identity, history, ownership clarity, trust, or control**. The spatial interface exists to reduce mental overhead, not to create another maze.

---

## Ratified amendment CF-2026-11-05: capability-first workspace agency
> **OWNER-RATIFIED 2026-11-05.** Canonical identity and geometry rules remain.

**AW-PWR-106 — Real Workspace Architect.** Vela's workspace creation, organization, resizing and placement MUST invoke canonical APIs, persist actual block/resource state and verify resulting geometry, not merely provide suggested text.
**AW-PWR-107 — Content-aware layout.** Generated layouts MUST account for semantic content, minimum usable area, workflow adjacency, display dimensions, collisions, accessibility, and user preferences; aesthetically aligned placeholders are insufficient.
**AW-PWR-108 — True block types.** Agent, execution task, manual checklist, timeline, resource browser and research blocks MUST expose distinct operational semantics. A user-checked item cannot masquerade as verified provider execution.
**AW-PWR-109 — Identity independence.** OpenAI model, Codex thread and managed-agent IDs MAY bind to a resource but MUST NOT supplant stable Aerynth project/workspace/block identity.
**AW-PWR-110 — Spatial persistence.** Zooming between workspace and constellation MUST preserve selected resources, semantic links, geometry, focus and active task projections.
**AW-PWR-111 — Permissioned mutation.** Vela MAY reorganize resources only with authorized scope, versioned changes, history/undo and truthful partial-result reporting.

**Acceptance:** Build a functional engineering workspace with agent, checklist, timeline and resources; confirm actual interactivity, persistence/undo, collision-free layout and seamless return from constellation.
