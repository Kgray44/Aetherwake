# 07 — Notes, Knowledge, and Thought Stream
## Governing Charter for Aerynth's Capture, Knowledge, and Idea Continuity

| Field | Value |
|---|---|
| Document ID | AW-GOV-007 |
| Version | 1.0.0-draft |
| Status | **Published governing charter — awaiting repository-owner acceptance** |
| Prepared | 2026-11-01 |
| Authority | Specialized subsystem charter, subordinate to [00 — Aetherwake Constitution](00-AETHERWAKE-CONSTITUTION.md) |
| Primary domain | Notes; Quick Capture; personal Thought Stream; project knowledge; annotations; knowledge meaning, evidence, lifecycle, and assistant-aware retrieval |
| Normative requirement namespace | **AW-NKT-###** |
| Constitutional anchors | AW-CON-006, 008–015, 022–028, 034, 036–041, 047–056, 058–061, 069–073, 079–083 |
| Coordinating charters | 01 Experience; 02 Liquid Intelligence; [03 Resources](03-PROJECTS-WORKSPACES-AND-RESOURCES.md); [04 Conversations](04-CONVERSATIONS-AND-CONNECTED-BRANCHES.md); 05 Agents; 06 Vela; 08 Context Intelligence; 09 Intelligence Streams; 11 Timelines; 14 Trust; 15 Quality |
| Intended readers | Product designers, knowledge-system engineers, assistant/tool developers, test authors, governance reviewers, and the repository owner |
| Disclosure boundary | Public product requirements only; no private notes, personal memory contents, confidential source excerpts, or credentials |

> **Core promise:** A thought can be captured immediately, safely retained, found later, related to the right work, and made useful to Vela **without requiring a conversation, task, project, model call, or organizational ceremony**.
>
> **Knowledge promise:** Aerynth distinguishes a passing idea from a hypothesis, an observation from a verified fact, a personal preference from an instruction, and an approved decision from a draft. Vela can help discover and connect information; **she cannot silently turn tentative notes into binding truth**.
>
> **Awareness promise:** Vela's awareness of notes means *authorized, indexed, discoverable and selectively retrievable*, **not** that every note is perpetually inside a language model's context.
>
> **Boundary:** The **user's Thought Stream** is a durable stream of authored and captured ideas. **AI Intelligence Streams** are records of observable AI activity, governed by Charter 09. They must never be conflated.

---

## 1. Purpose, authority, and domain boundaries

This charter establishes enduring behavioral requirements for capturing thoughts, maintaining notes, representing project knowledge, preserving source evidence, making relevant information available to Vela, and using that knowledge in other Aerynth workflows. It governs *what must be true*, not an unresearched choice of editor, database, embedding service, storage engine, document renderer, or model.

The Constitution retains highest authority. The repository owner accepts or amends this charter explicitly; publication alone is not ratification. **MUST**, **MUST NOT**, **SHOULD**, and **MAY** use the normative meanings established in the Constitution.

**Owned here:** note content and its revisions, note-specific lifecycle and semantics, user Thought Stream behavior, Quick Capture guarantees, knowledge epistemics and promotion, note annotations, provenance requirements on knowledge units, knowledge retrieval eligibility and presentation, knowledge management user experience, and note-specific verification.

**Not owned here:** canonical cross-application resource IDs, workspace/block ownership, and organizational permissions (03); chat thread and branching mechanics (04); task execution (05); overall Vela initiative/adaptation policy (06); context assembly, memory compaction, and token controls (08); AI execution observability (09); overall historical timeline semantics (11); broad trust and autonomy policy (14); global acceptance standards (15). This charter defines the integration contracts and local invariants without duplicating those authorities.

**AW-NKT-001 — Constitutional conformity.** Notes and knowledge implementations MUST respect the Constitution and this document's explicit boundaries. Conflicts MUST be escalated through governance instead of silently resolved in implementation.

**AW-NKT-002 — First-class capability.** Capture, retrieval, editing, and browsing of user-owned notes MUST be core application capabilities, not optional AI chat emulations or features dependent on agent execution.

**AW-NKT-003 — Honest state.** Aerynth MUST distinguish a saved note, an indexed note, a linked note, an attached context item, and a fact actively supplied to an AI execution. A UI claim of "Vela knows" MUST NOT imply permanent model awareness.

**AW-NKT-004 — No imposed ceremony.** Creating a quick note MUST NOT require a project, workspace, task, chat, agent, model connection, or classification choice.

**AW-NKT-005 — Canonical ownership.** Other charters MAY link to knowledge objects, but they MUST NOT independently redefine the meanings and authority lifecycle of note content or knowledge claims established here.

## 2. Language and conceptual object model

| Concept | Required interpretation | Not equivalent to |
|---|---|---|
| **Note** | Persisted user-owned writing or captured idea with stable identity and optional metadata | A chat turn, task, or workspace block |
| **Quick Capture** | Low-friction entry point that durably creates or appends to a note | A model prompt |
| **Thought Stream** | Searchable chronological view of the user's captured thoughts and their later evolution | AI reasoning logs or a complete model memory |
| **Note Block** | Workspace presentation/editor of an identified note or note collection | A duplicate of note content |
| **Annotation** | A note or structured comment anchored to a specific source object or subrange | Modification of the source |
| **Knowledge Item** | Attributable, typed assertion, observation, excerpt, reference, or idea with epistemic status | Automatically verified truth |
| **Knowledge Collection** | Logical grouping or view of notes and knowledge items | Necessarily a filesystem folder |
| **Project Knowledge** | Project-scoped body of knowledge, references, decisions, and constraints with explicit authority | An indiscriminate prompt attachment |
| **Source Record** | Originating note, file, message, observation, or external evidence reference | Guaranteed-current evidence |
| **Claim/Fact** | A knowledge proposition with scope, provenance, confidence/verification, and possibly validity period | A raw unqualified sentence |
| **Decision** | Recorded selection of a course of action, with decision maker, scope, and status | Any assistant suggestion |
| **Requirement** | A duly authorized constraint subject to project governance | Any idea tagged "important" |
| **Knowledge Promotion** | Attributable transition of information to a more authoritative or actionable class | Silent relabeling by a model |
| **Context Attachment** | Selected, policy-authorized knowledge supplied or linked to a chat/task/turn | Global permanent memory |
| **Retrieval Index** | Searchable derivative representation of source content or metadata | The authoritative source |
| **Derived Summary** | Condensed content with source references and derivation metadata | Replacement for the original |
| **Personal preference** | User-approved or correctly identified behavior preference with defined scope | Unrestricted authorization |

The canonical resource model and presentation semantics belong to Charter 03. Note ID, content revision ID, source anchor, indexing record, knowledge claim ID, and block instance ID MUST remain separately identifiable.

**AW-NKT-006 — Stable content identity.** Every note MUST have a durable resource identity separate from its title, location, project membership, block placement, or index document ID.

**AW-NKT-007 — Independent representation.** A note referenced in several blocks, projects, collections, searches, or attached views MUST resolve to the same underlying note unless the user expressly requests an independent copy.

**AW-NKT-008 — Addressable revisions.** Persisted edits MUST be representable through an identifiable content version or change history adequate for recovery, source anchoring, and conflict resolution.

**AW-NKT-009 — Clear actor attribution.** Authored text, assistant-suggested edits, machine-generated summaries, imported content, and external-source excerpts MUST remain distinguishable, including when presented in a visually seamless editor.

**AW-NKT-010 — Independent note lifecycle.** Removing a note block, collection membership, project link, or annotation anchor MUST NOT automatically delete the canonical note; deletion requires the note's own authorized lifecycle operation.

## 3. Product invariants

The following guarantees apply across normal editing, rapid capture, workspace rearrangement, offline use, search reindexing, agent delegation, model changes, migrations, and supported import/export:

1. **Capturing is not chatting.** A note may exist without any assistant response.
2. **Organizing is not rewriting.** Inferred grouping does not alter the captured wording.
3. **Discoverable is not loaded.** Index membership does not imply inclusion in a model context.
4. **Summarizing is not deleting.** A summary does not replace original content under ordinary retention.
5. **Suggesting is not deciding.** AI opinions never silently become policy or fact.
6. **Linking is not sharing.** A resource relationship does not grant wider access.
7. **Referencing is not duplicating.** Reusing a note in another block preserves source identity.
8. **Observing work is not thinking.** The personal Thought Stream is not the model's hidden chain of thought.
9. **Saving is not syncing.** Local persistence and remote synchronization have different reported states.
10. **Retrieval is not endorsement.** Relevant material may be speculative, stale, conflicting, or wrong.

**AW-NKT-011 — Original preservation.** Assistant organization, tagging, summarization, embedding, excerpting, and context assembly MUST NOT silently discard, rewrite, or replace original user-authored note content.

**AW-NKT-012 — Epistemic integrity.** Every process that promotes an idea to a decision, accepted fact, preference, or formal requirement MUST maintain attributable authority and an inspectable transition record.

**AW-NKT-013 — Privacy boundary.** Knowledge discovery and indexing MUST respect source access and project boundaries; indexing a source MUST NOT expand who or what may read it.

**AW-NKT-014 — Recoverable navigation.** From a summary, extracted claim, project knowledge entry, search result, or contextual-command result, the user SHOULD be able to navigate back to the actual source and relevant location.

**AW-NKT-015 — No silent AI dependence.** Failure or absence of the model backend MUST NOT make locally owned notes unreadable or prevent normal capture, editing, and local search.

## 4. Quick Capture: capture first, interpret second

Quick Capture is an omnipresent, minimal-interruption entry point. It SHOULD be callable from a configured shortcut, the universal command interface, a workspace, home, contextual selection, or other authorized input surfaces. The application SHOULD offer a fast inline field and a richer expanded editor without obligating the user to use the latter.

A typical user action is: invoke Quick Capture → write an idea → save → return to the previous activity. Title, category, project, tags, and assistant response are optional. Any later classification MUST NOT block durability.

**AW-NKT-016 — Immediate capture path.** From a normal active Aerynth session, Quick Capture MUST permit creating a note with the smallest practicable interaction sequence and MUST NOT require an AI request to commit the content.

**AW-NKT-017 — Durable acknowledgment.** The UI MUST indicate saved status only when persistence succeeds at the durability level it claims. "Saved locally", "sync pending", and "synced" MUST remain distinct if synchronization exists.

**AW-NKT-018 — Failure-safe drafts.** In-progress capture SHOULD be protected against navigation, window closure, accidental dismissal, connectivity failure, and application restart wherever technically feasible, using suitable local draft preservation.

**AW-NKT-019 — Default destination.** With no explicit project, a captured note MUST remain in a personal/unassigned area and the Thought Stream; failure to infer an association MUST NOT make it inaccessible.

**AW-NKT-020 — Nonblocking enrichment.** Auto-title, tagging, entity extraction, relationship suggestions, embeddings, and project suggestions MAY run asynchronously after saving and MUST NOT delay or overwrite the original capture.

**AW-NKT-021 — Fast input flexibility.** Quick Capture SHOULD support plain text and lightweight formatting, and MAY support pasted snippets, links, images, audio capture, or attachments where authorized. Unsupported modalities MUST be identified honestly.

**AW-NKT-022 — Capture without interruption.** Quick Capture MUST preserve the prior focus/navigation target where feasible; closing its surface SHOULD return the user to the prior workflow without changing their underlying task state.

**AW-NKT-023 — Explicit capture intent.** Capturing text from a selected chat passage, image, file, or document MUST retain source attribution and the user's actual command scope; a selection alone is not permission to ingest all surrounding private content.

**AW-NKT-024 — Duplicates without surprise.** Potential duplicate ideas MAY be suggested for linking or consolidation but MUST NOT be silently merged or discarded during capture.

### 4.1 Quick Capture interaction examples

- "Remember to give the multi-agent orchestration state a distinctive motion signature." → Immediate unassigned note, optionally suggested for Motion Coordinator.
- "Add this idea to the current project." → Note saved with an explicit current-project association, if the context is unambiguous.
- Highlight a paragraph and choose "Save as note" → New note with an exact source-span anchor if accessible.
- Select a chart interval and request "Note this anomaly" → Note with a reference to the selected data series, interval, and source.
- Offline quick capture → Local durable note with visible remote-sync uncertainty, not a failed AI chat.

## 5. Notes editing, composition, and blocks

Aerynth MUST permit ordinary direct editing and reading of notes. The editor must feel native to Liquid Intelligence while remaining efficient for long text, copying, selection, and accessible interaction. Rich appearance must not compromise the reliability of text entry.

**AW-NKT-025 — Core editing.** Users MUST be able to create, open, edit, rename, search within, and intentionally delete or archive notes through comprehensible controls. Undo or equivalent change recovery MUST be provided for ordinary editing where feasible.

**AW-NKT-026 — Useful formatting.** The note experience SHOULD support headings, paragraphs, checklists, links, code spans/blocks, quotations, and other practical technical formatting, while preserving a straightforward plain-text capture path.

**AW-NKT-027 — Clean source and rendered views.** If rich text or Markdown is supported, Aerynth MUST preserve content fidelity and avoid lossy silent conversions. Switching supported views MUST NOT silently corrupt pasted code or references.

**AW-NKT-028 — Embedded note blocks.** Notes MUST be renderable through workspace and home blocks, including compact previews and expanded editors, using the same canonical note identity.

**AW-NKT-029 — Configurable note block.** A note block SHOULD expose appropriate display density, editing permissions, size, pinning, scroll position, and relationship context without forcing extensive settings into normal writing.

**AW-NKT-030 — Edit continuity.** Moving, resizing, docking, detaching, or hiding a note block MUST NOT discard an unsaved draft or create a second divergent note inadvertently.

**AW-NKT-031 — Controlled assistant edits.** Vela and agents MAY propose or perform authorized note edits through typed native operations. Assistant changes MUST be attributable, reviewable, and recoverable according to scope and risk; user-authored text MUST NOT be quietly replaced by model-produced wording.

**AW-NKT-032 — Large-content responsiveness.** Long notes and large note collections SHOULD remain responsive through suitable rendering and indexing strategies; content length MUST NOT be an excuse for silently omitting text.

## 6. The user's Thought Stream

The Thought Stream is a continuous, navigable, chronological view over user-authored captures and optionally explicitly included note activity. It is a view over persisted notes and revisions, **not** a separate duplicate copy of everything written, not a mandatory new conversation, and not a model's hidden mental activity.

**AW-NKT-033 — Chronological continuity.** Aerynth MUST offer a Thought Stream showing captured ideas with trustworthy timestamps, stable identities, and navigation to the underlying notes.

**AW-NKT-034 — Multiple useful views.** The Thought Stream SHOULD provide chronological, project/topic, unresolved, search-filtered, and relationship-focused views. Conventional list/search navigation MUST remain available even when spatial views exist.

**AW-NKT-035 — State and evolution.** A thought's later categorization, elaboration, attachment, task conversion, or knowledge promotion SHOULD be visible as attributable evolution without rewriting its original capture time or authorship.

**AW-NKT-036 — Contextual capture and retrieval.** The stream MUST support opening a thought, editing it, linking it to resources, using it in Contextual Command, or requesting Vela's help with selected thoughts, subject to permissions.

**AW-NKT-037 — Unresolved ideas.** Users SHOULD be able to distinguish open ideas, ideas deliberately set aside, promoted decisions, active follow-ups, and completed/acted-upon ideas without forcing every note into a task lifecycle.

**AW-NKT-038 — Selective inclusion.** A user MUST be able to control whether a note appears in the Thought Stream. Hiding it from the stream MUST NOT implicitly delete its content or all other references.

**AW-NKT-039 — Honest time ordering.** Capture time, event occurrence, edit time, import time, and discovery/indexing time MUST not be conflated when they differ. Imported older material MUST not be falsely presented as freshly authored.

**AW-NKT-040 — Lightweight default.** Ambient Thought Stream animations MAY communicate newly saved or related notes, but MUST remain calm, accessible, optional, and performant; an enormous spatial graph MUST NOT be compulsory for basic browsing.

### 6.1 Personal Thought Stream versus Intelligence Streams

| Property | Personal Thought Stream | AI Intelligence Streams (Charter 09) |
|---|---|---|
| Primary subject | User ideas, observations, notes, reflections | Observable assistant, agent, chat, and task activity |
| Source of truth | Captured note/revision or attributed user action | Recorded backend/app event and evidence |
| Inferred content | Suggestions shown as suggestions | Inference explicitly labeled, never raw internal thoughts |
| Typical actions | Edit, attach, organize, promote, turn into task | Inspect, replay, filter, investigate, correlate |
| Model context behavior | Selected retrieval through CIE | Selected authorized event references through CIE |
| Default presentation | Capture and thought exploration | Live execution/observability |
| Privacy boundary | Note and knowledge access settings | Event collection, log, and observability settings |

**AW-NKT-041 — Separate namespaces and UX.** The system MUST distinguish personal Thought Stream objects from AI Intelligence Stream events in storage, search, display, and natural-language commands even if a unified timeline or workspace displays both.

**AW-NKT-042 — No invented cognition.** An AI reasoning summary MAY be linked to a user note as source material, but it MUST NOT be presented as the full hidden reasoning stream or silently inserted as a user-authored thought.

## 7. Note families and anchored annotations

A common content model MAY serve multiple note experiences without forcing users to decide a type on every capture.

### 7.1 First-class note presentations

- **Quick note:** minimally structured capture, often initially unassigned.
- **Workspace note:** presented via a movable block in a working layout.
- **Project note:** associated with a project and optionally a knowledge category.
- **Attached annotation:** anchored to a selected portion of another resource.
- **Reference note:** captures a source, bibliographic detail, URL, excerpt, or commentary.
- **Working scratchpad:** informal, changeable note used during a session.
- **Review note:** records feedback on an agent artifact, diff, document, or decision.
- **Decision draft:** a proposed decision pending acceptance.
- **Knowledge page:** a deliberately curated longer-form project resource.

These MAY be different views or metadata configurations of the same underlying resource type, not eight mandatory storage silos.

**AW-NKT-043 — Flexible forms.** Users MUST be able to create and use project, workspace, and attached notes without making note type a permanent restriction on discoverability or relocation.

**AW-NKT-044 — Exact attachment anchors.** Where technically supported, an attached note MUST reference the underlying resource and precise text span, image region, file location, message, chart interval, or other typed selection used to create it.

**AW-NKT-045 — Anchor resilience.** When a source moves, edits, or changes identity mapping, the annotation SHOULD rebind using stable IDs and versioned anchors where possible; unresolved or ambiguous anchors MUST be visibly flagged rather than silently attached to incorrect content.

**AW-NKT-046 — Non-destructive attachment.** Creating, modifying, or removing an annotation MUST NOT modify the referenced source unless the user separately requests and authorizes that source mutation.

**AW-NKT-047 — Cross-resource attachment.** A note MAY have multiple relationships to chats, tasks, files, images, agents, timelines, or workspaces; each link MUST remain attributable and may have independent access restrictions.

**AW-NKT-048 — Source-selective commands.** Contextual Command MUST support note actions on selections such as "write this down", "compare these notes", and "turn these into a plan", with the scope interpreted from the actual user instruction and the structured selection.

**AW-NKT-049 — No assumed external mutability.** Attaching to an external website, repository file, or cloud document MUST NOT imply ability to edit or permanently anchor the remote source when provider capabilities are absent.

## 8. Project Knowledge: structure and authority

Project Knowledge is a durable body of curated and discoverable information useful to a project. It is not necessarily one monolithic document or a permanently included system prompt. Each project SHOULD expose an approachable overview and expandable categories while retaining direct links to source materials.

Recommended categories, customizable rather than mandatory:

| Category | Primary role |
|---|---|
| Purpose and goals | Why the project exists and what success means |
| Core facts and environment | Reliable, scoped information about relevant systems |
| Architecture and interfaces | Technical structure and integration assumptions |
| Decisions | Approved, superseded, or proposed choices with rationale |
| Requirements and constraints | Explicit, appropriately authorized obligations |
| Research and references | External documents, findings, observations, hypotheses |
| Active objectives | Work that matters now; links to tasks |
| Questions and uncertainties | Unresolved issues and counterevidence |
| Historical context | Earlier reasoning and relevant project evolution |
| Working ideas | Possible directions not yet adopted |
| People/roles and resources | Authorized contextual associations |
| Glossary | Consistent terms, names, acronyms, and meanings |

**AW-NKT-050 — Discoverable project knowledge.** A project MUST expose a recognizable place to view, search, edit, and link its authorized knowledge without requiring the user to reconstruct relevant context manually.

**AW-NKT-051 — User-defined structure.** Categories, sections, and knowledge pages SHOULD be customizable; the default structure MUST NOT force every project into an enterprise-style specification process.

**AW-NKT-052 — Knowledge versus linked source.** A project knowledge entry MUST make clear whether it stores authored content, a derivative summary, a local copy, or merely a reference to an external source.

**AW-NKT-053 — Knowledge participation.** A user MUST be able to configure at a suitable granularity whether knowledge is reference-only, eligible for relevance-based retrieval, eligible for automatic inclusion under an approved policy, or excluded from AI access. The actual model-context mechanism belongs to Charter 08.

**AW-NKT-054 — No indiscriminate inclusion.** Adding a source to Project Knowledge MUST NOT automatically include its complete body in every project conversation or agent task.

**AW-NKT-055 — No premature authority.** Items created through automated clustering, summarization, import, or inferred project association MUST begin with an appropriate tentative/source-derived status, not "approved requirement" or "verified fact" by default.

**AW-NKT-056 — Project boundary control.** Referencing knowledge across projects MUST use authorized sharing or linking; placing two projects in the same workspace or relationship view MUST NOT silently erase their privacy and authority boundaries.

## 9. Epistemic types, verification, and conflict handling

Aerynth needs a way to communicate **what kind of knowledge something is**, not merely whether a sentence sounds confident.

Suggested content kinds include: idea; question; opinion; preference; hypothesis; observation; reported claim; independently verified fact; proposal; accepted decision; governing requirement; superseded statement; rejected claim; and external excerpt. These are distinct from lifecycle states such as active, archived, and deleted.

Suggested status dimensions include:

- **Authorship:** user / agent / imported source / external provider.
- **Evidence:** no evidence / cited source / verified against source / independently corroborated.
- **Authority:** informal / proposed / user-approved / institutionally governed.
- **Validity:** current / time-scoped / uncertain / stale / contradicted / superseded.
- **Confidence:** calibrated or qualitative with a documented basis, not simply a model's confidence-sounding prose.
- **Scope:** personal, chat, workspace, project, organization, or authorized cross-project domain.

**AW-NKT-057 — Typed meaning.** Important knowledge items MUST support meaningful distinctions among ideas, hypotheses, observations, preferences, decisions, facts, and requirements; UI labels MUST not collapse them into an unqualified "knowledge" truth bucket.

**AW-NKT-058 — Verification evidence.** An item presented as verified MUST have an attributable verification action and supporting evidence; repeated model assertions or repeated copies of one source MUST NOT alone count as independent confirmation.

**AW-NKT-059 — Authority boundaries.** Formal project requirements and governing decisions MUST enter their authoritative state only through the applicable owner-approved process; a model MAY propose text but MUST NOT confer authority by writing or tagging it.

**AW-NKT-060 — Conflicting knowledge.** When two claims conflict, Aerynth MUST preserve source attribution and communicate the conflict rather than silently choose the newer or more confidently phrased statement.

**AW-NKT-061 — Time-sensitive validity.** Time-dependent statements SHOULD carry a source timestamp, observation time, validity window, or refresh status as appropriate. Old information MUST NOT be represented as current solely because it remains indexed.

**AW-NKT-062 — Explicit corrections.** Users MUST be able to correct, retract, reject, or supersede knowledge with a traceable record. A corrected fact SHOULD be preferred over an obsolete version in future eligible retrieval.

**AW-NKT-063 — Prevent authority laundering.** Repeating a speculative note across summaries, branches, or project pages MUST NOT upgrade it into verified fact or accepted requirement without actual evidence and authorization.

### 9.1 Example: idea versus accepted decision

A quick note says: "Maybe show a ripple whenever Vela delegates to multiple agents." It remains an *idea*. Vela may suggest a relation to the Motion Coordinator, summarize it, or propose a task. Only after a user-authorized adoption does it become an accepted design decision; only after the proper governance process can it become a binding governing requirement.

## 10. Knowledge promotion and decision records

Promotion is an intentional, visible action that changes how information may be treated or used. Common transitions include:

- Thought → related topic or project idea.
- Note → open question, research finding, or reference note.
- Idea → proposal.
- Proposal → accepted decision or rejected proposal.
- Accepted decision → scoped project requirement, if authorized.
- Note excerpt → task brief or execution context with citations.
- Hypothesis → verified finding, given actual evidence.
- Former decision → superseded decision, retaining history.

**AW-NKT-064 — Promotion as an event.** Material authority/status changes MUST record actor, original item, prior and new states, time, stated scope, and available approval/evidence references.

**AW-NKT-065 — Preview of consequential promotion.** Promoting information into system instructions, formal requirements, shared knowledge, or autonomous task inputs MUST clearly show the proposed meaning and affected scope before high-impact application under the applicable approval policy.

**AW-NKT-066 — Original retained.** Promotion MUST link back to the original note or source rather than silently replacing the user-authored wording; edits to the promoted artifact MUST be independently attributable.

**AW-NKT-067 — Demotion and supersession.** Users MUST be able to mark a promoted knowledge item as disputed, superseded, or no longer applicable without erasing the historical decision trail, subject to explicit retention/deletion policy.

**AW-NKT-068 — Change impact.** When a project requirement or accepted decision changes, related tasks, dependent knowledge, and relevant contextual indexes SHOULD be marked for review; the system MUST NOT imply dependent work automatically became compliant.

## 11. Vela awareness, knowledge assistance, and initiative

Vela may appear consistently aware of the user's work because the application maintains resource identities, permitted indexes, summaries, relationships, retrieval tools, and event state. This is **software-mediated, selective awareness**, not permanent unlimited model memory.

**AW-NKT-069 — Scoped knowledge access.** Vela MUST use explicitly authorized note and knowledge retrieval. A global assistant identity MUST NOT imply universal permission to all private, connected, or project-scoped content.

**AW-NKT-070 — Source-grounded responses.** When Vela relies materially on a note or project claim, she SHOULD provide a navigable source reference and indicate uncertainty or status when relevant.

**AW-NKT-071 — Efficient local lookup.** Deterministic note searching, filtering, navigation, tagging, and simple metadata modifications SHOULD run locally without unnecessary model inference.

**AW-NKT-072 — Suggestive organization.** Vela MAY suggest clustering, tagging, associating, or naming groups of notes, but the user MUST be able to inspect and reject proposals. Automatic low-risk organization requires authorized policy.

**AW-NKT-073 — Adaptive but bounded.** Learned organization preferences MAY guide suggestions and approved low-risk actions. Habit observation MUST NOT silently expand AI access, promote facts, delete notes, or increase permissions.

**AW-NKT-074 — Proactive relevance without chatter.** The Initiative Engine MAY surface a past idea when it is materially relevant to the current task, but MUST respect attention budgets, quiet modes, notification policies, and user suppressions governed by Charter 06.

**AW-NKT-075 — Contextually accurate "remember" actions.** If the user says "remember this" or "write this down" inside Aerynth, the application MUST identify the authorized content and destination, persist a real note or memory object, and honestly report success or failure. A reassuring assistant sentence alone is not persistence.

**AW-NKT-076 — Explainable association.** For machine-inferred note-to-project, note-to-topic, or note-to-resource relationships, Aerynth SHOULD show a concise basis and allow correction, suppression, or reversal where technically appropriate.

**AW-NKT-077 — No hallucinated memory.** Vela MUST distinguish source retrieval, user-provided context, uncertain inference, and unavailable information; she MUST NOT claim to recall or have monitored data that was not accessible.

### 11.1 Example: awareness without context flooding

User captures: "A multi-agent delegation should have its own visual motion signature." The note is durably stored and available to authorized search. Later, the user discusses the Motion Coordinator. Vela may retrieve this note because its topic is relevant, disclose that it came from an earlier idea, and offer to attach it to the design. The note should **not** have occupied every intervening Codex context window.

## 12. Retrieval, indexing, and Context Intelligence Engine interface

This charter governs *which knowledge exists, what it means, and whether it is eligible to be surfaced*. Charter 08 governs *how active context is selected, packed, compacted, budgeted, and supplied to model execution*.

Retrieval may use exact search, metadata filtering, semantic search, relationship traversal, time filters, or scoped summaries. The implementation MAY be local, hybrid, or integrated with a supported provider, following privacy and performance governance.

**AW-NKT-078 — Eligible-source boundaries.** A retrieval request MUST enforce user identity, source access, project scope, exclusion settings, and purpose-specific authorization before content is made available to a model or agent.

**AW-NKT-079 — Source first.** Search results and derived context items MUST retain source IDs, relevant version/location, source type, provenance, and current availability or staleness where known.

**AW-NKT-080 — Index as derivative.** Search indexes, embeddings, summaries, and caches MUST be rebuildable derivatives, not the only surviving copy of user-owned knowledge.

**AW-NKT-081 — Scoped index freshness.** Indexing state MUST distinguish pending, current, stale, partial, unavailable, and indexing-failed conditions as applicable; stale or incomplete indexes MUST NOT masquerade as comprehensive search coverage.

**AW-NKT-082 — Selective context policy.** Knowledge items SHOULD support explicit policy states such as manual-only, retrieve-when-relevant, or approved automatic inclusion, subject to Charter 08 and tool/backend limits.

**AW-NKT-083 — Context inclusion transparency.** When a knowledge item is attached or supplied to an execution, the user SHOULD be able to inspect the source and reason for inclusion, to the extent Aerynth controls and observes the context.

**AW-NKT-084 — Sensitive-content restraint.** Credentials, secrets, private attachments, or other sensitive data MUST NOT be automatically indexed into broader search surfaces, published into shared knowledge, or sent to external model services without suitable authorization and protections.

**AW-NKT-085 — Corrections propagate forward.** Corrected, revoked, superseded, or deleted knowledge MUST be reflected in future indexing and retrieval. Historical uses MAY remain auditable under retention policy, but MUST NOT silently continue to be promoted as current authorized context.

**AW-NKT-086 — Bounded retrieval.** Context-facing search and extraction SHOULD support relevance ranking, size limits, source diversity, and incremental expansion rather than sending entire note corpora by default.

**AW-NKT-087 — No fake memory economics.** Token-saving or retrieval-efficiency claims MUST be demonstrated by measurement where feasible. A note stored locally does not by itself save tokens; context selection and actual model input behavior determine model usage.

### 12.1 Proposed knowledge retrieval contract (illustrative, not mandated schema)

~~~text
KnowledgeSearchRequest
  actor, purpose, query, selected_resources?, active_project?,
  time_window?, include_types?, include_statuses?,
  maximum_results?, maximum_context_size?, permission_context

KnowledgeSearchResult
  knowledge_id, canonical_note_id?, source_id, source_version?,
  anchor?, source_kind, epistemic_type, verification_state,
  authority_scope, captured_at?, verified_at?, last_indexed_at?,
  snippet_or_summary, completeness, access_status, relevance_explanation?

ContextReference
  source_id, selected_revision, selected_range?, purpose,
  inclusion_policy, supplied_to_execution_id?, actual_inclusion_status
~~~

**AW-NKT-088 — Typed retrieval interface.** Knowledge integrations MUST use versioned typed contracts that preserve identity, provenance, privacy scope, epistemic state, and truthful inclusion status across subsystem boundaries.

## 13. Relationships, projects, collections, and universal search

Charter 03 owns resource membership, collection semantics, relationship identity, and broad search navigation. This charter defines the knowledge-specific interpretation.

**AW-NKT-089 — Knowledge-specific relationships.** Notes SHOULD support typed relationships such as *related to*, *quotes*, *supports*, *contradicts*, *questions*, *supersedes*, *implements*, *inspired by*, *applies to*, and *derived from*, with appropriate confidence and provenance.

**AW-NKT-090 — Explainable clusters.** Suggested topic clusters MUST be distinguishable from user-created folders or verified relationships. A suggestion MUST NOT silently reassign the note's ownership or exclude it from prior views.

**AW-NKT-091 — Shared-source continuity.** A note appearing in a smart collection, project knowledge page, global search, Thought Stream, and workspace block MUST remain one canonical resource with consistent edits and revision history.

**AW-NKT-092 — Conventional discoverability.** Users MUST be able to find knowledge through ordinary search, filters, titles, tags, projects, and chronology without relying on a complex relationship graph.

**AW-NKT-093 — Search result meaning.** Results SHOULD distinguish exact text matches, semantic similarities, machine-inferred associations, and links to stale or unavailable sources. Ranking alone MUST NOT falsely imply an authoritative relationship.

**AW-NKT-094 — Cross-project sharing clarity.** When a note is relevant to multiple projects, the UI MUST distinguish reference/link, membership, copied content, and shared authority. Adding a link MUST NOT independently authorize cross-project model retrieval.

## 14. Knowledge-to-action flows

Notes and knowledge should support an effortless progression from observation to action **when the user wants it**, not force every idea to become a formal task.

Supported pathways MAY include:

- Selected note → Contextual Command → research question.
- Group of notes → comparison or deduplicated summary.
- Note or excerpt → cited task brief for a new agent.
- Several thoughts → suggested project knowledge topic.
- Selected annotations → review checklist.
- Project decisions → requirement traceability candidates.
- Historical notes → planning timeline references.
- A quick note → reminder proposal (subject to actual scheduling support).
- Note + image + chart selection → sourced engineering investigation.

**AW-NKT-095 — Explicit task conversion.** Converting one or several notes into tasks MUST preserve originating note identities, the user's requested scope, and links to generated objectives. Conversion MUST NOT imply source notes are deleted or the new tasks are complete.

**AW-NKT-096 — Contextual intent interpretation.** For commands involving notes and surrounding resources, the system MUST prioritize the user's expressed target/scope over an overly literal reading of the current highlight, consistent with AW-CON-022 and Charter 03.

**AW-NKT-097 — Action preview.** Bulk edits, cross-project sharing, knowledge promotions, source overwrites, and other consequential operations MUST provide the relevant preview/authorization path. A read-only summary or harmless local navigation SHOULD not require repetitive confirmations.

**AW-NKT-098 — Traceable generated artifacts.** Summaries, task briefs, extracted decisions, knowledge pages, and other outputs derived from notes MUST record their source references and generation/approval status.

**AW-NKT-099 — No agent-task requirement.** A user MUST be able to take, browse, and edit notes without accepting suggestions to create tasks, agents, or structured workflows.

## 15. Motion, appearance, and the note experience

Notes participate fully in Liquid Intelligence. Quick Capture, attached annotation bubbles, note blocks, Thought Stream entries, relationship highlights, and knowledge promotions should feel like parts of one spatial environment. But motion is communication, not a precondition for using text.

**AW-NKT-100 — Capture surface quality.** Quick Capture SHOULD appear quickly and unobtrusively, with a clear focus target and no cinematic sequence that delays typing.

**AW-NKT-101 — Spatial continuity.** Opening a note from Thought Stream into a workspace block, moving a note between views, or presenting an annotation SHOULD preserve recognizable visual identity and relationship continuity wherever feasible.

**AW-NKT-102 — Semantic animation.** Motions representing note creation, save, linking, promotion, search discovery, conflict, or indexing MUST correspond to actual state changes; simulation MUST be labeled as simulation.

**AW-NKT-103 — Accessible authoring.** Text entry, focus, cursor, selection, undo, screen-reader semantics, contrast, and keyboard navigation MUST remain effective independently of glass effects, particles, 3D transforms, or animation.

**AW-NKT-104 — Performance adaptation.** Animated note surfaces MUST cooperate with adaptive rendering, reduced-motion modes, high-load or gaming conditions, and background idling without risking draft integrity.

**AW-NKT-105 — Source-anchor visibility.** Attached note indicators SHOULD communicate the anchor without obscuring text, code, image detail, or chart data; the user MUST be able to discover and dismiss/inspect annotations without losing their work.

## 16. Data integrity, sync, offline operation, and lifecycle

Aerynth must treat notes as valuable user data. The original note must not depend on a model-produced summary, temporary UI block, or third-party provider being available.

**AW-NKT-106 — Durable local access.** Aerynth-owned notes SHOULD be available and editable offline when appropriate to the selected storage configuration. Remote-only records MUST be labeled as such and must not falsely promise offline availability.

**AW-NKT-107 — Edit safety.** Concurrent editing through multiple blocks/windows or assistant services MUST prevent silent last-writer-wins data loss; the product MUST use suitable conflict detection or coordination and provide recovery where needed.

**AW-NKT-108 — Version and recovery.** Meaningful edits SHOULD have versioned recovery or equivalent safeguards; autosave failure, disk-full conditions, and corrupted storage MUST produce honest user-visible recovery signals.

**AW-NKT-109 — Retention choices.** Users MUST be able to distinguish archive, hide, unlink, trash, delete local data, delete synced copies (where supported), and remove derived indexes. These operations MUST not be presented as interchangeable.

**AW-NKT-110 — Derived data lifecycle.** Deleted, retracted, or access-revoked content MUST be handled in search indexes, summaries, embeddings, caches, and sync queues according to an explicit documented propagation strategy; where copies cannot be revoked, that limitation MUST be disclosed.

**AW-NKT-111 — Portability.** Notes and project knowledge SHOULD support documented export/import in usable text-based or structured formats, preserving links, statuses, and source references where feasible, with documented limits for external attachments.

**AW-NKT-112 — Migration protections.** Storage and indexing schema changes MUST have versioned migrations, integrity checks, and tested recovery or rollback procedures consistent with the Constitution.

**AW-NKT-113 — No accidental global publication.** Moving a note to a visible workspace, adding a project relationship, or exporting a project template MUST NOT silently publish private note content to a repository, shared service, public URL, or unauthorized agent.

## 17. Permissions, privacy, safety, and data minimization

Charter 14 owns general threat modeling, trust, and autonomy controls. This charter adds note-specific obligations.

**AW-NKT-114 — Explicit observation boundary.** Continuous monitoring of external applications, clipboards, microphones, screenshots, or filesystem activity MUST NOT be inferred merely from enabling Quick Capture or Vela knowledge retrieval; separate permissions and controls are required.

**AW-NKT-115 — Capture scope limitation.** Aerynth MUST capture the user-selected content or explicitly authorized wider material. It MUST NOT silently sweep surrounding private documents or unrelated files for the sake of "better awareness."

**AW-NKT-116 — Sharing awareness.** Before sensitive notes are sent to an external agent, model, integration, or another project, the system MUST honor the relevant access and approval policy and communicate the destination or exposure scope where required.

**AW-NKT-117 — Secret-handling defenses.** Note summarization, search snippets, exports, logging, and proactive notifications MUST apply appropriate secret and sensitive-information protections; innocuous UI previews must not become a side channel for unauthorized disclosure.

**AW-NKT-118 — Inspectable assistance.** Users MUST be able to review and correct material automatic organization, knowledge-status changes, and Vela-generated note edits; automatic learned behavior MUST stay within approved classes of action.

**AW-NKT-119 — Public-repository hygiene.** Product specifications, sample fixtures, screenshots, and tests committed to public Aetherwake source control MUST use synthetic, non-sensitive information unless the information is intentionally public and appropriately authorized.

## 18. Integration contracts and event boundaries

The following is a conceptual, implementation-neutral object model:

~~~text
Note
  id, owner_scope, title?, content_ref, current_revision,
  created_at, updated_at, authored_by, lifecycle, visibility,
  include_in_thought_stream, source_ref?, classification?,
  knowledge_policy?, tags?, collection_refs?, attachments?

NoteRevision
  note_id, revision_id, parent_revision_id?, editor_actor,
  timestamp, content_ref, change_origin, conflict_state?

KnowledgeItem
  id, source_refs[], type, summary_or_claim, epistemic_status,
  authority_scope, evidence_refs[], validity?, last_verified?,
  created_by, approved_by?, supersedes?, sharing_policy?

AnnotationAnchor
  note_id, source_resource_id, source_version?,
  selected_region_or_range?, locator?, integrity_status?

KnowledgeRelation
  source_id, target_id, relation_type, asserted_by,
  evidence_refs?, confidence?, status?, created_at

KnowledgePromotionEvent
  knowledge_id, from_state, to_state, actor,
  approval_ref?, rationale?, time, source_revision

KnowledgeContextUsage
  source_id, version_or_range, destination_turn_or_task,
  inclusion_policy, status, timestamp, provenance
~~~

These are illustrative shapes, **not a selected database schema**. Canonical object identity is controlled by Charter 03, source conversation identity by Charter 04, execution/event systems by Charter 09, and active context behavior by Charter 08.

**AW-NKT-120 — Observable knowledge changes.** Important note creation, revision, linking, promotion, deletion, retrieval for external execution, and assistant modification SHOULD produce attributable, privacy-filtered events or change records for history, undo, and observability.

**AW-NKT-121 — No event-content leakage.** Logging a knowledge event MUST NOT automatically expose the entire underlying note text. Event metadata and private content payloads MUST be separable.

**AW-NKT-122 — Cross-charter interoperability.** A note or knowledge item passed into a chat, task, timeline, relationship view, or Intelligence Stream MUST retain its stable source reference and epistemic type without requiring that subsystem to own or rewrite the canonical note.

## 19. Required acceptance scenarios

The following are mandatory scenario-level demonstrations **when the relevant feature is implemented**. They are not a claim that the existing product already passes them. Supporting automated tests, UX evidence, and failure-injection results belong in engineering plans and Charter 15.

| ID | Scenario | Evidence required |
|---|---|---|
| NKT-A01 | Capture an unassigned thought from anywhere | Note is durably saved without AI connection or project selection; appears in Thought Stream |
| NKT-A02 | Interrupt an in-progress Quick Capture | Draft recovery is clear; no false saved acknowledgment |
| NKT-A03 | Capture while offline | Local note remains readable and editable; sync status honest |
| NKT-A04 | Save highlighted chat text as note | Exact source message/selection reference preserved when supported |
| NKT-A05 | Select one file, request notes on entire folder | Command scope follows language; affected source range is previewed |
| NKT-A06 | Show same note in two workspaces | One canonical identity, coherent content, no inadvertent duplication |
| NKT-A07 | Edit note through two windows simultaneously | Changes coordinated or conflict resolved; no silent overwrite |
| NKT-A08 | Ask Vela about a previous unassigned thought | Authorized retrieval finds source, provides contextual citation, no always-on transcript injection |
| NKT-A09 | Assistant suggests project for a quick note | Original text retained, suggestion attributable and rejectable |
| NKT-A10 | Suggest merging duplicate notes | Original items survive until explicitly authorized consolidation |
| NKT-A11 | Idea promoted to accepted decision | Actor/authority/evidence recorded; original note remains |
| NKT-A12 | Unverified hypothesis retrieved alongside fact | Epistemic distinction visible, model response does not claim both verified |
| NKT-A13 | Conflicting project statements | Conflict and sources shown; no silent winner |
| NKT-A14 | Correct or revoke a knowledge item | Future retrieval reflects correction, retained audit clearly marked historical |
| NKT-A15 | Project includes confidential note | Unauthorized project/agent search cannot retrieve or snippet it |
| NKT-A16 | Generate task brief from three notes | Links to all source notes; correct scope; task is not automatically declared complete |
| NKT-A17 | Link note to moving/edited external source | Stable relink or clear broken/ambiguous anchor; no wrong attachment |
| NKT-A18 | AI backend unavailable | Notes, Thought Stream, basic local search, and edits remain usable where locally stored |
| NKT-A19 | Search index stale or incomplete | Coverage status disclosed; source not misrepresented as deleted |
| NKT-A20 | Motion and reduced motion | Capture, navigation, and linking work without obscured text or fabricated state effects |
| NKT-A21 | Delete note with derived search records | Authorized removal and derived-data handling confirmed, limitations explained |
| NKT-A22 | Distinguish personal Thought Stream from agent Intelligence Stream | Separate source semantics; no implication of hidden reasoning availability |
| NKT-A23 | Long note and large Thought Stream | Usable selection, stable scrolling, responsive local rendering under representative load |
| NKT-A24 | Export and re-import note corpus | Content versions and supported source relationships preserved or explicit loss report |
| NKT-A25 | Change memory/retrieval policy | Excluded note not supplied to future disallowed contexts; inclusion inspector is accurate |

### 19.1 Minimum verification disciplines

**AW-NKT-123 — Behavior-based acceptance.** A visible notes UI or successful database insert alone MUST NOT count as completion of this charter; implemented capabilities require evidence for persistence, source integrity, correct interpretation, privacy, recovery, and reasonable performance.

**AW-NKT-124 — Failure scenarios.** Tests MUST cover offline behavior, save failure, disk pressure, conflicting edits, stale source anchors, missing attachments, index lag, migration, unauthorized retrieval, and rejected automatic classification.

**AW-NKT-125 — UX and visual evidence.** Capture latency, input responsiveness, visual continuity, focused writing, long-form editing, accessible interaction, and reduced-motion behavior MUST be evaluated on representative workflows, not only static screenshots.

**AW-NKT-126 — Knowledge integrity evidence.** Tests MUST demonstrate that summarization and semantic retrieval cannot silently promote an idea into an authoritative rule or silently erase the source.

**AW-NKT-127 — Token efficiency validation.** CIE integration SHOULD be evaluated against real retrieved note corpora and task outcomes; fewer tokens alone are insufficient if required project constraints or source accuracy degrade.

## 20. Required cross-charter boundaries

| Other charter | Authority it owns | Charter 07 interface |
|---|---|---|
| 00 Constitution | Foundational intent, no fake awareness, preservation, trust | This document refines notes/knowledge requirements |
| 01 Experience | Contextual Command and interaction policy | Capture surfaces, source selection, knowledge operations |
| 02 Motion | Six-system Motion Coordinator | Visual continuity and semantics for note activity |
| 03 Projects/Resources | Canonical resource IDs, workspaces, blocks, collections, links | Note content and epistemic semantics attached to these objects |
| 04 Conversations | Chat messages, thread identity, connected branches | Note references, excerpts, knowledge contributions and source links |
| 05 Agents | Task lifecycle, assignment, execution | Converting note-derived ideas into traced task inputs |
| 06 Vela | Assistant behavior, Initiative Engine, Adaptive Experience Engine | Authorized awareness, resurfacing, correction, organization |
| 08 CIE | Context ranking, packing, compaction, budgets | Eligible knowledge, sourced retrieval, inclusion metadata |
| 09 Intelligence Streams | Recorded AI/tool events, replayability, observability | Clear separation from personal Thought Stream |
| 10 Profiler | Token/timing telemetry | Retrieval and context-efficiency evidence |
| 11 Timelines | Historical, planning, dependency and replay views | Capture history, note evolution and timestamp provenance |
| 12 Codex | Backend/tool capability and execution transport | Supported context passing and native notes operations |
| 13 Platform | Storage/runtime performance and offline environment | Reliable editing, persistence and note UI performance |
| 14 Trust | Permissions, privacy, autonomy and sensitive data | Note-specific disclosure/retention policies |
| 15 Quality | Cross-system acceptance and testing standards | Scenario evidence above |
| 16 Engineering | Delivery, change and research processes | Implementation phasing and migration rigor |

**AW-NKT-128 — Respect source-of-truth ownership.** Implementations MUST retain these domain boundaries. In particular, user Thought Stream presentation MUST NOT be used as a substitute for AI Intelligence Streams, and Project Knowledge MUST NOT become an unbounded implicit prompt.

## 21. Open technical and experience decisions

The following are **not** settled by this charter and require documented research, prototyping, or explicit decisions:

1. Final note editor format and storage representation: Markdown, rich-text document model, or hybrid.
2. Document revision strategy, conflict resolution, and multi-window write coordination.
3. Local database and index design; transactional durability and crash recovery.
4. Exact shortcut scheme and whether Quick Capture operates outside the Aerynth window.
5. The boundary between manual tags, auto-tags, graph relations, and inferred clusters.
6. Whether semantic search uses local embeddings, remote embeddings, hybrid retrieval, or no embeddings in early milestones.
7. Effective authority and confidence visualizations that do not overwhelm casual note-taking.
8. Default content-retention and draft-recovery intervals.
9. Optional voice/audio note capture and transcription behavior, including consent and cost.
10. External document annotation robustness, anchor rebinding, and provider-specific capabilities.
11. Knowledge evaluation benchmarks for relevance, privacy leakage, stale facts, and citation accuracy.
12. Exact capture latency and search responsiveness thresholds, measured against representative hardware.
13. Sync/collaboration roadmap, optional encryption design, and user-facing sharing controls.
14. Layout, shader, and animation design for Thought Stream and spatial note relationship views.
15. Export formats and handling of broken or unavailable external references.

**AW-NKT-129 — No invented decisions.** Open research choices MUST NOT be treated as settled or as proof of feasibility. An agent MAY propose a solution but MUST record the design tradeoff and obtain appropriate approval before creating irreversible coupling.

## 22. Governance change control, traceability, and owner acceptance

Changes to note identity, epistemic states, knowledge promotion, note deletion, privacy, source provenance, or cross-project retrieval have potentially wide consequences. They require review against the Constitution and the respective owning charters.

A proposed amendment SHOULD include: affected requirement IDs, problem statement, exact text change, backward-compatibility and data-migration impacts, test updates, privacy risks, and owner disposition.

**AW-NKT-130 — Traceable charter changes.** Normative changes MUST retain stable requirement IDs where meaning remains stable; semantic changes MUST be documented and versioned with cross-charter impact review.

**AW-NKT-131 — Owner ratification.** This document remains a **published draft pending owner acceptance** until that acceptance is explicitly recorded. Creating the file or linking it in the registry MUST NOT be represented as owner ratification.

### Traceability map

| Requirement group | Main topic | Constitutional anchors |
|---|---|---|
| AW-NKT-001–015 | Scope, ontology, and invariants | AW-CON-008, 026, 047–050, 071 |
| AW-NKT-016–024 | Quick Capture | AW-CON-011, 047, 079 |
| AW-NKT-025–032 | Editing and blocks | AW-CON-015, 026, 029, 079 |
| AW-NKT-033–042 | Thought Stream boundaries | AW-CON-047–050, 057–061 |
| AW-NKT-043–049 | Note types and annotation anchors | AW-CON-022–028, 050 |
| AW-NKT-050–056 | Project Knowledge | AW-CON-027, 048–051 |
| AW-NKT-057–063 | Epistemic integrity | AW-CON-049–050, 071 |
| AW-NKT-064–068 | Promotion and decisions | AW-CON-008, 049–050, 070 |
| AW-NKT-069–077 | Vela awareness | AW-CON-036–041, 048 |
| AW-NKT-078–088 | Search and CIE integration | AW-CON-048, 051–056, 071 |
| AW-NKT-089–099 | Relationships and action flows | AW-CON-022–028, 042–046 |
| AW-NKT-100–105 | Liquid Intelligence experience | AW-CON-015–021, 075–077 |
| AW-NKT-106–119 | Persistence, portability, privacy | AW-CON-034, 069–073, 079–083 |
| AW-NKT-120–128 | Contracts and acceptance | AW-CON-080, 085–089 |
| AW-NKT-129–131 | Research, change control, ratification | AW-CON-007–010, 084, 090–091 |

---

## Charter conclusion

Aerynth is not meant to force human thought into a chat log, an agent assignment, or a rigid filing cabinet. It must be possible to **think first, capture instantly, organize later, and retrieve intelligently**.

Vela should be able to recognize relevant ideas and connect them to current work while preserving uncertainty, provenance, user authorship, access boundaries, and control. Project Knowledge should become a reliable resource for conversations and agents without being mistaken for permanent model context. The Thought Stream should preserve the personal evolution of ideas without impersonating the separate observable activity of AI systems.

**Capture without friction. Organize without loss. Retrieve with provenance. Act only with appropriate authority.**

---

## Proposed amendment CF-2026-11-05: knowledge as reliable intelligence input
> **PROPOSED, pending owner acceptance.** Charter 07 retains original user-note ownership and Thought Stream distinctions.

**AW-NKT-132 — Source identity.** Notes, documents, thoughts and generated artifacts MUST retain canonical IDs, scope, authorship, version and data classification when accessed by Vela.
**AW-NKT-133 — Summaries are derivatives.** Model-created notes and summaries MUST preserve links to their source and distinguish interpretation, uncertainty and original human-authored evidence.
**AW-NKT-134 — Actionable knowledge.** Vela MAY transform authorized notes into plans, checklists, timelines and delegated tasks, but MUST preserve originals and require appropriate action consent.
**AW-NKT-135 — Branch knowledge fidelity.** Shared knowledge MUST record origin branch, selected facts, conflicts and privacy boundary; link formation does not confer universal access.
**AW-NKT-136 — Memory deletion.** Source revocation/deletion MUST invalidate eligible derived indexes and caches or report remaining limitations, and MUST NOT silently restore stale facts.
**AW-NKT-137 — Thought truth.** The user's Thought Stream and agent-visible summaries MUST never be confused with private model chain-of-thought or artificially simulated reasoning.

**Acceptance:** Turn a source note into a verified plan while keeping the source untouched, trace facts to source, then revoke source and prove stale retrieval is not trusted.
