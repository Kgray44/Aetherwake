# Conversations and Connected Branches
## Governing Charter for Aerynth's Conversational System

> **Owner acceptance recorded 2026-11-05.** This charter and reconciled addenda now govern product design. Accepted design is not a claim of implemented or independently verified functionality.

| Field | Value |
|---|---|
| Document ID | AW-GOV-004 |
| Version | 1.1.0 — owner-ratified 2026-11-05 |
| Status | **Owner-accepted and ratified governing charter (binding requirements; implementation separate)** |
| Prepared | 2026-11-01 |
| Scope | Chat identity, conversation experience, organization, connected branches, conversational provenance, history, and continuity |
| Parent authority | [The Aetherwake Constitution](00-AETHERWAKE-CONSTITUTION.md), AW-GOV-000 |
| Primary constitutional anchors | AW-CON-006, 011–015, 022–028, 031–035, 042–046, 051–060, 062–064, 069–073, 080–083 |
| Related future domains | 01 Interaction; 02 Motion; 03 Resources; 05 Agents; 06 Vela; 07 Knowledge; 08 CIE; 09 Observability; 10 Profiler; 12 Codex; 14 Trust; 15 Quality |
| Implementation posture | Technology-neutral requirements; provider-specific mechanisms require verification |
| Public repository rule | No personal chat content, credentials, private operational data, or identifiable user history may be committed as examples or tests |

> **Core promise.** Aerynth must be an exceptionally capable, pleasant, fast, and recognizable chat application even when users never invoke projects, agents, tasks, or automation. Conversations must remain independently useful yet become discoverable, organizable, contextually connected, and safely collaborative when the user wants more.
>
> **Connected Branches promise.** Forks are independent conversations, **not isolated islands**. A user can retrieve or selectively adopt relevant findings created by another branch *after* the fork, with source attribution, privacy boundaries, and explicit control over what enters active model context.
>
> **Nonnegotiable distinction.** Shared knowledge does **not** mean silently merging transcripts, running sibling agents without authorization, or claiming that the underlying AI model constantly knows everything another branch has said.

---

## 1. Purpose, authority, and domain boundaries

This charter defines the observable behavior and durable constraints of the conversation system. It governs the conversational user experience; local metadata and organization; the distinction between conversations, threads, messages, tasks, and agent runs; branching; cross-branch discovery; selective knowledge exchange; history access; session recovery; and acceptance tests.

It does not choose the database, desktop shell, indexing implementation, specific model, or final backend APIs. The primary backend is expected to be Codex through a supported integration, but equivalent behavior on other backends must be capability-gated rather than assumed.

Normative words carry the Constitution's meanings: **MUST**, **MUST NOT**, **SHOULD**, and **MAY**. An explicit requirement here owns its narrower conversation-domain behavior; cross-domain requirements remain owned by their respective charters. If there is a conflict, the Constitution prevails and the conflict must be resolved openly.

**AW-CHAT-001 — Ordinary chat first.** A user MUST be able to create, use, resume, and close an ordinary conversation without creating a project, workspace, formal task, saved agent, or workflow.

**AW-CHAT-002 — No degraded baseline.** Adding connected branches, orchestration, or spatial workspaces MUST NOT regress basic chat functions, responsiveness, accessibility, history navigation, or model/tool control.

**AW-CHAT-003 — Honest capability boundaries.** An operation supported only by some backends MUST be surfaced with its actual availability and limitations. Emulated capabilities MUST NOT be mislabeled as native backend features.

**AW-CHAT-004 — Ownership of canonical behavior.** Other charters MAY reference this charter for conversations and branching, but MUST NOT silently redefine conversation identity, fork semantics, or cross-branch import behavior.

### 1.1 Terms of art

| Term | Required meaning |
|---|---|
| **Conversation / Chat** | Persistent user-facing communication resource and its ordered history or references thereto |
| **Backend thread** | Provider-specific handle and execution state for a conversation; it is **not** the application's stable conversation identity |
| **Message** | Attributable, addressable contribution to a conversation, with its own type, source, and lifecycle |
| **Turn** | Request/response or execution unit, potentially containing streamed output and tools |
| **Agent** | Configurable worker identity, independent of any single chat |
| **Task** | Persistent objective that may link one or more chats and executions |
| **Execution** | Individual agent run or attempt associated with a turn or task |
| **Branch** | Conversation fork with identifiable ancestry and independent post-fork history |
| **Branch family** | Set of conversations sharing ancestry through one or more forks |
| **Knowledge contribution** | Cited finding, decision, artifact, excerpt, or summary made discoverable across allowed conversations |
| **Adoption** | Explicit or policy-approved incorporation of sourced material into another branch's active context or knowledge references |
| **Collection** | User-managed or query-driven grouping of conversation resources; not necessarily a location or ownership boundary |
| **Canonical history** | Durable record or backend-accessible source history under the defined retention policy, as distinct from compacted active model context |

## 2. Product invariants

The following invariants MUST remain true through model changes, workspace moves, branch forks, compaction, backend disconnection, and software upgrades.

**AW-CHAT-005 — Stable identity.** Each conversation MUST have an application-generated stable identifier that survives title changes, collection membership, workspace placement, backend thread migration, and reversible archival.

**AW-CHAT-006 — Separate provider identity.** Provider thread identifiers MUST be stored as scoped backend mappings, never assumed to be universal conversation IDs or directly interchangeable across providers.

**AW-CHAT-007 — Separation of containment and presentation.** A conversation MAY appear in multiple blocks, tabs, workspaces, collections, project views, or windows while referring to the same underlying conversation and preserving coherent state.

**AW-CHAT-008 — Independent branch evolution.** After a fork, branches MUST retain independent authored messages, turns, model state, permissions, and work execution. Cross-branch discovery MUST NOT mutate either transcript without an attributable user or authorized system action.

**AW-CHAT-009 — Preservation of source.** Compaction, summarization, pinning, quotation, handoff, or selective adoption MUST NOT silently replace or delete available canonical history. Explicit retention and deletion rules govern permanence.

**AW-CHAT-010 — Truthful state.** Conversation and run states MUST reflect recorded backend and application events. A branch labeled synchronized MUST disclose *what* is synchronized; full hidden-context synchronization MUST NOT be implied.

**AW-CHAT-011 — User control.** Autonomous chat organization, sibling discovery, and context exchange MUST respect configured permissions, visibility scopes, and applicable approval requirements.

**AW-CHAT-012 — Source distinguishability.** Authored messages, model-generated summaries, tool outputs, cross-branch imports, user notes, and inferred relationships MUST be distinguishable in both stored data and inspectable UI.

## 3. Primary conversation experience

Aerynth should feel like a premium chat environment with powerful optional layers, not a project-management application requiring elaborate setup before asking a question.

**AW-CHAT-013 — Essential actions.** The user MUST be able to create, rename, duplicate as a deliberate independent copy where supported, favorite, search, resume, fork, move between collections, archive, unarchive, export where supported, and delete conversations using understandable controls.

**AW-CHAT-014 — Familiar chat ergonomics.** Conversations MUST support readable user and assistant messages, streaming output, code and structured content, file/resource references, copy actions, keyboard navigation, searchable history, and accessible message-level controls.

**AW-CHAT-015 — Unobtrusive sophistication.** Advanced settings, branch operations, profiler details, and tool outputs SHOULD be progressively discoverable rather than permanently occupying the default writing surface.

**AW-CHAT-016 — Directness.** Creating a simple conversation and sending its first message SHOULD require no more than the minimum necessary interaction. Existing chat content MUST remain accessible while secondary panels open.

**AW-CHAT-017 — Draft integrity.** Unsent text, attachments, selections, and in-progress composition SHOULD survive navigation, view changes, app restart where feasible, and concurrent presentation of a conversation in another window.

**AW-CHAT-018 — Stream readability.** Partial text, citations, tool operations, and completion state MUST remain legible while streamed. UI animation MUST NOT hinder selection, copying, scrolling, or reading.

**AW-CHAT-019 — Response control.** Where supported, users MUST be able to interrupt execution, continue a conversation, and change supported configuration for future turns. A setting not applicable until a new turn or thread MUST say so.

**AW-CHAT-020 — Mixed usage.** A chat MAY be associated with zero, one, or several tasks or projects, depending on ownership and sharing rules. Task orchestration MUST NOT be mandatory for ordinary discussion.

### 3.1 Message actions

A message or selected passage SHOULD support contextually relevant commands: quote, copy, reference, attach to task, summarize, investigate, branch from here where supported, turn into note, create task, and compare with another item.

**AW-CHAT-021 — Exact selection references.** Text selection MUST preserve the message's stable identity and selected ranges where available; an image or attachment selection MUST preserve a resource reference. A pasted approximation MUST NOT be mistaken for a linked original.

**AW-CHAT-022 — Selection is contextual, not absolute scope.** If a user selects one message but asks to act on tasks discussed throughout the conversation, Aerynth MUST interpret the larger requested scope rather than blindly limiting its operation to the selected text.

**AW-CHAT-023 — Preview consequential reinterpretations.** When the selected object and inferred instruction scope differ significantly and an action would move, share, delete, or modify resources, the interpretation MUST be previewed before applying according to the governing risk policy.

## 4. Conversation identity, lifecycle, and data model

The application must own a stable conversation catalog even if the execution backend supplies a mutable or provider-specific notion of history.

**AW-CHAT-024 — Durable conversation record.** Every conversation MUST retain at least: application ID, title, created/modified timestamps, creation source, lifecycle state, backend mapping if any, access scope, and references to its history and associations.

**AW-CHAT-025 — Addressable message record.** Messages MUST have stable locally addressable identifiers, role/type, sequence or ordering metadata, provenance, and content references sufficient for selection, quoting, search, and audit within supported backend limitations.

**AW-CHAT-026 — State model.** The lifecycle MUST distinguish at minimum draft, ready, active/streaming, waiting for input or approval, interrupted, completed/idle, disconnected, archived, and deleted or pending deletion where applicable. A single chat may have multiple turns and executions with different states.

**AW-CHAT-027 — Distinct user and backend statuses.** A backend turn finishing MUST NOT imply that a linked task is implemented, verified, merged, or deployed; task state belongs to the task system.

**AW-CHAT-028 — Transactional organization.** Collection membership and display-layout changes MUST NOT cause backend thread recreation, message duplication, or silent loss of unsent text.

**AW-CHAT-029 — Atomic user mutations.** Renames, pins, membership updates, archives, and branch metadata mutations SHOULD be persisted atomically and produce identifiable reversible action history where feasible.

**AW-CHAT-030 — Reconnect recovery.** Following process restart, backend disconnection, or interrupted streaming, the UI MUST reconstruct the last *known* state, reconcile with available backend state, and visibly mark uncertain or missing intervals.

**AW-CHAT-031 — Concurrent presentation.** Multiple windows or blocks viewing a conversation MUST reconcile state without duplicated sends, inconsistent drafts, or an inaccurate claim that concurrent incompatible backend turns are supported.

### 4.1 Suggested logical resource relationships

~~~text
Conversation [application ID]
  ├─ backend bindings [provider, thread ID, capabilities, version]
  ├─ messages, turns, attachments, events
  ├─ user-facing organization: labels, favorites, collections
  ├─ contextual associations: projects, tasks, workspaces, agents
  ├─ branches: parent, fork point, branch family, sibling links
  ├─ shared knowledge: contributions, imports, provenance
  ├─ settings: inherited profile + explicit overrides
  └─ retention, access controls, lifecycle
~~~

This is a **conceptual contract**, not a mandatory database schema.

## 5. Chat organization and discoverability

Chat management is a headline capability, because a useful long-running system must reduce rather than expand organizational burden.

**AW-CHAT-032 — Flexible organization.** Users MUST be able to organize conversations with manually managed folders/collections, tags or categories, favorites, and project/workspace associations without duplicating underlying thread identity.

**AW-CHAT-033 — Multiple views.** The same chat catalog MUST support useful at-least-equivalent list, grouped, search-results, and workspace-block views. A visual graph or constellation MAY supplement but MUST NOT replace straightforward navigation.

**AW-CHAT-034 — Smart Collections.** Users MUST be able to create saved dynamically evaluated collections using supported filters, including project, topic/tag, recency, activity, attention state, agent/task association, branch family, and available usage metrics.

**AW-CHAT-035 — Manual versus inferred membership.** User-pinned collection membership MUST be distinguishable from AI-suggested or query-derived inclusion. Smart rules MUST NOT silently override deliberate manual organization.

**AW-CHAT-036 — Natural-language organization.** Vela MUST be able, with proper authorization, to find chats about a stated topic and propose or perform actions such as “put the chats about server performance into a folder,” with clear candidate preview and ambiguous-result handling.

**AW-CHAT-037 — Reversible bulk changes.** Multi-chat classification, moving, tagging, or archiving SHOULD be undoable. Bulk deletion and other destructive actions MUST follow the trust/approval policy.

**AW-CHAT-038 — Uncertain classification.** Automatically classified topics and relationships MUST retain provenance and confidence; ambiguous matches SHOULD be flagged instead of silently asserted as definite.

**AW-CHAT-039 — Findability.** Search MUST support title and content where the source and permissions allow, plus filters for dates, projects, collections, branch family, participants/agents, and status. Results MUST link to a relevant conversation location or message, not only a chat's top.

**AW-CHAT-040 — Navigable long histories.** Users SHOULD be able to jump to search matches, bookmarks, forks, decisions, attachments, and important activity without rendering the entire transcript.

### 5.1 Suggested collections

Examples include **Recent**, **Favorites**, **Needs My Attention**, **Active Work**, **All Conversations**, **Archived**, **Related to This Project**, **Connected Branch Family**, and user-authored topic collections. These are design examples, not mandatory fixed categories.

### 5.2 Assisted organization workflow

The user may request “collect everything about subsystem X.” Aerynth should:

1. Resolve the user's intended topic and current project/workspace context.
2. Search authorized chat metadata and content; disclose which sources were unavailable.
3. Show a compact candidate preview, especially for ambiguous or cross-project results.
4. Choose the requested action: manual folder, smart collection, tag, or project association.
5. Apply changes without cloning the underlying chats.
6. Animate the change through the shared Motion Coordinator without obscuring the result.
7. Record changes and provide undo where supported.

## 6. Conversation settings and inheritance

Chat settings are powerful but must not dominate daily UI.

**AW-CHAT-041 — Effective configuration.** Each conversation MUST expose its effective supported model, reasoning configuration, tools, skills, relevant working directory or environment, approval/sandbox policy, context strategy, backend, and applicable accessibility/presentation settings.

**AW-CHAT-042 — Inheritance clarity.** Defaults MAY come from global, project, workspace, agent profile, or chat-specific scopes as defined by the shared settings system; the effective value and source MUST be inspectable.

**AW-CHAT-043 — Scoped overrides.** A chat-specific override MUST NOT silently mutate higher-level settings. Model/tool capability limits MUST be displayed rather than allowing invalid selections.

**AW-CHAT-044 — Historical reproducibility.** A conversation SHOULD retain execution configuration snapshots or references for completed turns so that later global settings changes do not rewrite what actually ran.

**AW-CHAT-045 — Safe permission boundaries.** Moving a conversation to a project or workspace MUST NOT silently grant additional filesystem, network, account, or agent autonomy permissions.

**AW-CHAT-046 — Unobtrusive settings.** Advanced controls SHOULD remain in a discoverable integrated inspector, with quick controls for common operations, searchable settings, and clear reset-to-inherited behavior.

**AW-CHAT-047 — Per-conversation context policy.** A chat MUST be able to select a supported context strategy or profile, including explicit user control over optional attached project knowledge, sibling knowledge, and aggressive/automatic compaction behavior.

## 7. Branching model and ancestry

Forking must preserve independence without forfeiting access to relevant discoveries in the branch family.

**AW-CHAT-048 — Fork at an identifiable point.** A branch MUST record its parent conversation and the exact or best-supported fork boundary: message, turn, checkpoint, or backend cursor, clearly identifying any provider limitation.

**AW-CHAT-049 — Shared past, separate future.** Both branches MUST have access, as permitted, to their common pre-fork ancestry. Post-fork messages MUST remain attributed to their individual branches.

**AW-CHAT-050 — Branch family graph.** The application MUST retain a directed branch ancestry graph that can show parents, children, sibling relationships, fork timestamps, and divergent post-fork segments.

**AW-CHAT-051 — Branch naming.** Users MUST be able to rename branches, give them purposes, tag them, favorite them, and organize them independently; reasonable automatic names MAY be proposed.

**AW-CHAT-052 — Fork independence.** A fork MUST NOT by itself authorize shared write access to the same worktree, live service, database, or files. Agent execution and work isolation remain subject to the task and trust systems.

**AW-CHAT-053 — Explicit branch lineage.** If a backend can resume but cannot faithfully fork history, Aerynth MAY create a new thread with an explicit, sourced handoff. It MUST label that result as an emulated or summary-based continuation rather than claiming a lossless fork.

**AW-CHAT-054 — No implicit merge.** Simply opening, navigating between, viewing, or favoriting sibling branches MUST NOT import their post-fork content into the current model context.

### 7.1 Supported user scenarios

- **Explore two approaches:** Fork an investigation, work independently, compare findings, keep only one active.
- **Return to mainline:** Stop working in an experimental branch while retaining its post-fork discoveries as retrievable evidence.
- **Continue with selected sibling facts:** Adopt a cited performance finding from Branch B into Branch A, not all of Branch B.
- **Rescue a useful result:** Preserve an artifact or decision discovered in a discarded branch.
- **Review divergence:** Understand what each branch learned, decided, changed, or failed to prove after the fork.
- **Inspect lineage:** Identify which message and context snapshot were shared at the branch point.

## 8. Connected Branches: independent history, connected knowledge

**Connected Branches** is the defining enhancement beyond conventional independent conversation forks. The objective is relevant, inspectable, selective knowledge exchange, *not* magical shared internal model state.

**AW-CHAT-055 — Discover sibling knowledge.** A branch MUST be able to search authorized, indexed post-fork findings, messages, decisions, artifacts, and summaries from members of its branch family even if those findings did not exist when the branch was created.

**AW-CHAT-056 — Selective adoption.** Users MUST be able to import or reference one or more chosen sibling findings, quoted passages, decisions, artifacts, or bounded summaries without importing entire sibling transcripts.

**AW-CHAT-057 — Provenance on transfer.** Every cross-branch knowledge contribution MUST retain source branch, source message/event/artifact references where available, source time or version, acquisition time, author/source type, and an explicit evidentiary status.

**AW-CHAT-058 — No invisible transcript modification.** When information is adopted, Aerynth MUST represent adoption as a link, attached context item, explicit synthetic handoff, or attributed new message/record, never as an undetectable edit to a historical message.

**AW-CHAT-059 — Distinct awareness levels.** The UI MUST distinguish **discoverable in the branch family**, **retrieved for inspection**, **attached to this chat**, and **actually supplied to an execution's context**. These are not synonyms.

**AW-CHAT-060 — Share policy.** Branch families MUST offer configurable sharing policies, including **Independent**, **Connected**, and **Collaborative**, with explicit effects, user overrides, and permissions.

**AW-CHAT-061 — Independent mode.** Siblings remain searchable through authorized explicit user-directed requests only; unsolicited cross-branch publication or injection MUST NOT occur.

**AW-CHAT-062 — Connected mode.** Authorized sibling knowledge MAY be retrieved on user request or task relevance, subject to CIE policy and source inspection, but full transcripts MUST NOT be silently merged.

**AW-CHAT-063 — Collaborative mode.** Approved categories of important findings MAY be proactively published to a shared branch-family knowledge index, but model-context insertion, permissions, and high-impact actions remain independently governed.

**AW-CHAT-064 — Configurable scope.** Share policies MUST support restrictions by branch, project, topic, resource sensitivity, source type, and data classification where available. Visibility MUST NOT exceed the least permissive applicable boundary.

**AW-CHAT-065 — Source freshness.** A retrieved finding SHOULD indicate whether its source has been revised, invalidated, superseded, deleted, or is no longer accessible. Stale snapshots MUST NOT be presented as definitively current.

**AW-CHAT-066 — Conflicting findings.** Contradictions between branches MUST remain visible. Aerynth MUST NOT silently overwrite a verified claim with a newer but weaker claim, or treat an agent's preference as settled fact.

**AW-CHAT-067 — Evidence before consensus.** A branch MAY summarize sibling findings, but MUST preserve accessible references and distinguish hypothesis, agent report, measured observation, and user-approved decision.

**AW-CHAT-068 — User-direction controls.** The user MUST be able to choose which branch to continue, pause/retire other branches without deleting their history, and request selective rehydration of relevant sibling material.

### 8.1 Connected Branches exchange pipeline

~~~text
Branch A             Branch Family Knowledge Index             Branch B
  │                              │                                 │
  │                             (1) B publishes a sourced finding │
  │                              ◀─────────────────────────────────┤
  │                              │                                 │
  │ (2) A requests or policy allows retrieval                       │
  ├─────────────────────────────▶│                                 │
  │                              │ (3) access + relevance checks   │
  │◀──── cited candidate(s) ─────┤                                 │
  │                              │                                 │
  │ (4) inspect / adopt selected finding                             │
  ├── explicit adoption record ─▶│                                 │
  │                              │                                 │
  │ (5) CIE decides what goes into A's next supported turn          │
  ▼                              ▼                                 ▼
Branch A history stays independent; B's post-fork transcript is unchanged.
~~~

The shared index contains references, authorized copies, summaries, and metadata depending on retention and permissions. It is not inherently a second giant context window.

### 8.2 Sharing must be transparent

The conversation inspector SHOULD answer:

- **What does this branch know locally?**
- **Which sibling results are discoverable but not loaded?**
- **Which findings have been imported or referenced?**
- **Which of those will be supplied to the next model request?**
- **Who or what authorized each exchange?**
- **What original evidence supports the shared finding?**
- **Is the finding recent, disputed, revoked, or superseded?**

## 9. Knowledge contributions, adoption, and conflict resolution

**AW-CHAT-069 — Typed knowledge units.** Cross-branch exchange SHOULD use typed units such as observation, hypothesis, decision, requirement, question, artifact, excerpt, test result, or structured checkpoint, rather than unqualified paragraphs.

**AW-CHAT-070 — Source-preserving excerpts.** Quoted excerpts and selections MUST retain source linkage and original context boundaries, with clear marking when they are shortened or synthesized.

**AW-CHAT-071 — User-authored authority.** A user-approved decision MAY carry greater governance weight than unverified agent speculation, but importing it into another branch MUST NOT silently elevate its authority beyond the original decision scope.

**AW-CHAT-072 — Contradiction review.** When two branches disagree about a material fact or approach, the UI SHOULD show side-by-side evidence, source dates, and options to retain both, designate a preferred conclusion, or request additional verification.

**AW-CHAT-073 — Adoption choice.** Supported adoption choices SHOULD include **reference only**, **attach to current context**, **create a visible cross-branch summary/handoff**, and **promote to project knowledge** under the separate knowledge-approval rules.

**AW-CHAT-074 — Bounded import.** If a user requests “bring the important findings from B into A,” the system MUST build an auditable bounded selection based on relevance and importance, rather than blindly sending B's whole transcript.

**AW-CHAT-075 — Revocation and correction.** Corrections or access revocations MUST propagate to indexes and future retrieval. Previously used or quoted material MUST remain auditable according to retention rules, while no longer being offered as current authorized context.

### 9.1 Example: post-fork discovery

1. A parent chat forks into **A: garbage collection** and **B: chunk generation**.
2. B later discovers a potential expensive world-generation operation and produces a profiler artifact.
3. B's finding becomes discoverable in its branch family with a link to the profiler, confidence status, and time.
4. A asks for relevant sibling discoveries. It sees a compact sourced candidate, not B's full transcript.
5. The user adopts that candidate into A; the resulting context inspector shows its source and inclusion state.
6. A can continue investigating without modifying B's history.
7. If B later invalidates the finding, A receives a discoverable supersession notice, subject to its notification and attention policy.

This is a **normative acceptance scenario**, not a statement about current built functionality.

## 10. Branch visualization and comparison

The branch interface should make ancestry and relationships intuitive rather than creating an unreadable graph.

**AW-CHAT-076 — Readable default.** The normal chat interface MUST remain familiar and usable without displaying a large branch graph. Branch navigation SHOULD be optional and available from context.

**AW-CHAT-077 — Branch timeline.** Aerynth MUST offer an understandable visual representation of a shared origin and subsequent branches, showing fork points, independent activity, and selected knowledge-transfer links.

**AW-CHAT-078 — Inspectable connections.** Every rendered cross-branch connection MUST be selectable to reveal what was shared, its source, target, and evidentiary status; decorative lines MUST NOT masquerade as verified transfers.

**AW-CHAT-079 — Focus and filtering.** Users SHOULD be able to focus one branch, compare two branches, hide irrelevant siblings, collapse shared ancestry, and show only verified or unresolved findings.

**AW-CHAT-080 — Motion with meaning.** A branch split, adoption, connection, or focus switch SHOULD use the six-system Motion Coordinator to preserve visual continuity, but MUST remain comprehensible with reduced motion and keyboard controls.

**AW-CHAT-081 — No forced graph literacy.** All essential Connected Branches actions MUST have understandable list, menu, command, or direct-chat alternatives.

### 10.1 Branch comparison

A side-by-side view SHOULD compare goals, significant conclusions, supporting evidence, unresolved questions, task associations, changed files/artifacts (where available), and imported findings. It MUST distinguish **chat-history divergence** from **Git or filesystem divergence**; these are separate concepts.

## 11. Vela's conversational awareness and commands

Vela may help users create, organize, find, branch, connect, and summarize chats through typed native application operations.

**AW-CHAT-082 — Native actions.** Aerynth SHOULD expose validated operations to Vela for chat creation, lookup, grouping, tagging, branching, comparison, reference attachment, and navigation; Vela SHOULD NOT need screenshot-click automation to manipulate its own chat catalog.

**AW-CHAT-083 — Grounded referents.** Vela MUST use active selection, open chat, workspace, and explicit user wording as contextual signals. It MUST NOT silently conflate “this passage,” “this chat,” “all chats on the topic,” and “this branch family.”

**AW-CHAT-084 — Scope preview.** Bulk classification, organization, cross-project sharing, and deletion MUST show the affected scope or follow an explicitly approved low-risk automation policy.

**AW-CHAT-085 — No hidden omniscience.** Vela MUST NOT claim it has read all sibling conversations or project history merely because they are indexed or discoverable. Retrieval attempts and coverage gaps SHOULD be visible when material.

**AW-CHAT-086 — Chat-to-task delegation.** Users MUST be able to discuss work in an ordinary chat and later direct Vela to split the discussed objectives into tasks and new chats, with appropriate context handoffs, without destroying or replacing the original chat.

**AW-CHAT-087 — Agent report-back.** Delegated conversations MAY report their findings to Vela or a parent chat through attributed structured summaries or links. They MUST NOT rewrite parent history or claim the user reviewed the results until review actually occurs.

**AW-CHAT-088 — Contextual commands.** When a user highlights a passage, message, attachment, or several resources and issues a command, Vela MUST interpret the instruction against the selection and available surrounding context, with explicit scope review for consequential changes.

## 12. Context Intelligence Engine integration

The CIE charter owns the retrieval algorithms and compaction policies. This charter owns conversation-level guarantees at their integration boundary.

**AW-CHAT-089 — Active context is not archival history.** Conversation displays MUST distinguish retained complete history, search indexes, compacted active model context, selected attachments, and other-branch knowledge discoverable but not loaded.

**AW-CHAT-090 — Context inclusion audit.** Users MUST be able to inspect the application-managed context sources selected for a conversation/turn, including imported branch knowledge, with source and inclusion explanations to the degree technically available.

**AW-CHAT-091 — Age is not authority.** Older user requirements, verified decisions, or important unresolved facts MUST NOT be automatically excluded solely because they are old; CIE governs relevance and decay.

**AW-CHAT-092 — Non-destructive compaction.** Summaries, checkpoints, or provider compaction MUST preserve access to source history under applicable retention policy and must not be represented as lossless if detail has been omitted.

**AW-CHAT-093 — Restore relevant history.** Users SHOULD be able to select an older message range, decision, or branch finding and request rehydration or attachment of relevant context to an eligible future turn.

**AW-CHAT-094 — Efficiency without silent weakening.** Context optimization MUST preserve applicable permissions, source provenance, hard requirements, and requested scope. It MUST NOT silently omit a crucial constraint merely to reduce tokens.

**AW-CHAT-095 — Bounded automated sharing.** Proactive branch sharing MUST operate on scoped, relevant, attributable units. Full transcript fan-out to every sibling is prohibited as an unqualified default.

## 13. Intelligence Streams, execution history, and profiling integration

The observability and profiling charters own the global event architecture and metrics. Each conversation must provide usable access to its relevant live and historical activity.

**AW-CHAT-096 — Chat-level stream.** Each conversation SHOULD expose an Intelligence Stream of actual available turn, tool, message, approval, and agent activity, clearly differentiating observed events from reported summaries and inference.

**AW-CHAT-097 — Tool and activity links.** Where supported, messages and turns SHOULD link to the corresponding captured tool output, file changes, task results, and execution traces, without embedding all raw logs into the default chat view.

**AW-CHAT-098 — Honest progress.** The chat UI MUST NOT fabricate internal reasoning text, exact thinking progress, or unobservable operations. It MAY show available reasoning summaries with proper labeling and gaps.

**AW-CHAT-099 — Per-chat telemetry.** Each chat SHOULD show available elapsed time, streaming duration, token usage, tool activity, and model settings, with expandable profiler detail and explicit unknown or estimated metrics.

**AW-CHAT-100 — Chronological coherence.** Timestamps, fork points, imports, edits, and completion records MUST remain attributable and ordered where evidence allows, with missing or out-of-order data marked.

## 14. Performance, rendering, and long-history scalability

Lengthy conversations should not become painful to open. Rendering performance and model context size are different concerns and must be addressed separately.

**AW-CHAT-101 — Incremental history loading.** Aerynth MUST support incremental history loading or equivalent paging so that opening a long chat does not require rendering every message immediately.

**AW-CHAT-102 — Virtualized presentation.** Long message lists SHOULD virtualize off-screen content while preserving selection, search, screen-reader access, and stable scroll position.

**AW-CHAT-103 — Stable streaming scroll.** New incoming content MUST NOT unexpectedly displace a user reading earlier messages. Following the stream should be a deliberate or clearly indicated mode.

**AW-CHAT-104 — Low-overhead secondary views.** Multiple appearances of one conversation SHOULD share cached data/state without triggering duplicate backend subscriptions, unbounded component trees, or continuous atmospheric rendering in hidden panels.

**AW-CHAT-105 — Background restraint.** Unfocused, minimized, or hidden chat views MUST reduce unnecessary visual updates while preserving important recorded activity and user-configured notifications.

**AW-CHAT-106 — Measurable usability.** Long-chat startup, search responsiveness, scroll stability, stream latency, memory growth, and UI frame times MUST be benchmarked on representative histories, not inferred from a small demo.

## 15. Privacy, access boundaries, retention, and deletion

Conversation contents may be sensitive; linking branches and automating organization must not collapse access boundaries.

**AW-CHAT-107 — Scope-preserving links.** A resource relationship, shared collection, or branch-family membership MUST NOT by itself grant access to otherwise unauthorized chat content.

**AW-CHAT-108 — Controlled publication.** Proactive knowledge exchange MUST honor project boundaries, user privacy scopes, redaction rules, and applicable backend/tool authorization. Cross-scope publication MUST require authorization.

**AW-CHAT-109 — Sensitive extraction.** Credential-like strings, private files, and other sensitive content MUST NOT be automatically published into shared branch knowledge solely because they occur in a conversation.

**AW-CHAT-110 — Export and portability.** Users SHOULD be able to export conversation metadata, available content, branch ancestry, and sourced adoption records in documented formats, subject to backend access and retention constraints.

**AW-CHAT-111 — Deletion semantics.** Deleting a conversation MUST clearly distinguish local catalog removal, local cached data removal, backend thread deletion when supported, and removal of indexes or imported derived knowledge. A UI promise of “deleted everywhere” requires evidence.

**AW-CHAT-112 — Referential cleanup.** On authorized deletion or revocation, derived indexes and future retrieval MUST respect the new visibility, while previously produced outputs or audit records are handled under disclosed retention and security rules.

**AW-CHAT-113 — Minimal public examples.** Tests and documentation in this public repository MUST use synthetic conversation content only; no real user chat histories, private sources, secrets, or production telemetry.

**AW-CHAT-114 — Revocable permissions.** Users MUST be able to disable Connected Branches publication and revoke optional sharing access without deleting unrelated original conversation histories.

## 16. Error handling, backend limitations, and migrations

**AW-CHAT-115 — Graceful limited mode.** When a backend lacks native forking, full history access, token detail, or independent tool control, Aerynth MUST offer available functions honestly and label degraded operations.

**AW-CHAT-116 — Disconnect transparency.** Interrupted or missed events MUST be reported as incomplete, not inferred to have succeeded or failed without evidence.

**AW-CHAT-117 — Migration integrity.** Importing or migrating chats MUST preserve local identity, source provider reference, available chronology, original attribution, and explicit loss/compatibility markers.

**AW-CHAT-118 — No synthetic history fabrication.** When restoring a provider thread from summaries, Aerynth MUST NOT invent nonexistent messages or present reconstructed text as the original transcript.

**AW-CHAT-119 — Schema evolution.** Changes to conversation and branch records MUST include versioned migration plans, regression checks, and data preservation/rollback strategies as required by the Constitution.

**AW-CHAT-120 — Idempotency and retry.** Where operations are retried after failure, the application SHOULD use stable action IDs or equivalent safeguards to prevent duplicate chat creation, branch forks, imports, or sends.

## 17. Acceptance criteria and traceable test scenarios

**This charter is a requirements baseline proposal.** Passing UI mockups or producing a static animation does not satisfy these tests. Each scenario requires executable or manually reviewable evidence against the actual implementation, and statuses must distinguish planned, implemented, tested, and owner-accepted.

| ID | Scenario | Required evidence |
|---|---|---|
| CHAT-T01 | **Ordinary chat without setup** | New chat, send, stream, resume, no project/task required |
| CHAT-T02 | **Same chat in two workspaces** | Identical app ID, synchronized history, no second backend thread created by presentation |
| CHAT-T03 | **Rename and recategorize** | Identity and message history unchanged after organization |
| CHAT-T04 | **Smart collection** | Rule-based membership changes when source metadata changes; user pin retained |
| CHAT-T05 | **Natural-language organizing** | Vela groups authorized topic chats; candidate scope, evidence, and undo available |
| CHAT-T06 | **Content search** | Finds a phrase in an older message, navigates directly to hit, reports unavailable sources |
| CHAT-T07 | **Long history** | Large fixture loads progressively, scroll remains stable, bounded memory/frame-time performance |
| CHAT-T08 | **Independent fork** | Common pre-fork history, separate post-fork messages, preserved parent/fork point |
| CHAT-T09 | **Sibling discovery after fork** | A retrieves a finding generated by B after fork; A's transcript not silently rewritten |
| CHAT-T10 | **Selective adoption** | Only selected B finding enters A's attached/retrieved context; B remains unchanged |
| CHAT-T11 | **Branch awareness states** | UI distinguishes discoverable, retrieved, attached, and supplied-to-execution |
| CHAT-T12 | **Branch policy modes** | Independent, Connected, Collaborative behaviors adhere to configured scopes |
| CHAT-T13 | **Provenance and correction** | Imported finding cites origin; subsequent correction/invalidation is visible |
| CHAT-T14 | **Conflicting conclusions** | Two contradictory sibling findings coexist with clear evidence and no silent overwrite |
| CHAT-T15 | **Retire unused branch** | Other branch remains usable; retired branch's authorized findings remain retrievable |
| CHAT-T16 | **Selection versus instruction scope** | Selecting a message and requesting all discussed tasks captures conversation-wide scope |
| CHAT-T17 | **Chat-to-agents delegation** | Existing chat remains; tasks/new chats receive bounded attributable context and report back |
| CHAT-T18 | **Compaction integrity** | Old source messages remain retrievable; summary identified as condensed, not original |
| CHAT-T19 | **Settings inheritance** | Effective chat model/tool/context settings show source; override does not mutate global/project |
| CHAT-T20 | **Permission boundary** | Fork/share/move cannot elevate filesystem or cross-project data access without authorization |
| CHAT-T21 | **Execution stream honesty** | Real tool events and summaries distinguishable from inferred or unavailable internals |
| CHAT-T22 | **Resume after disconnect** | Recoverable state reconciled, missing interval visible, no duplicated send |
| CHAT-T23 | **Multiple chat views** | One conversation in multiple windows stays consistent and avoids duplicate streams |
| CHAT-T24 | **Deletion and revocation** | Scope, backend limits, and derived-index cleanup visible and verifiable |
| CHAT-T25 | **Reduced motion and keyboard** | Branch navigation, selection, and import remain usable without animations |
| CHAT-T26 | **Cross-provider degradation** | Unsupported native fork is disabled or labeled emulated; no false parity claim |

### 17.1 Required stress and failure fixtures

Acceptance testing SHOULD include synthetic fixtures covering thousands of messages, many nested branches, conflicting reports, missing evidence, disconnected streams, backdated edits, project permission changes, concurrent windows, stale search results, and incomplete imported provider histories. Token savings MUST be compared with task-result correctness and provenance preservation, not only raw size reduction.

### 17.2 Quality gates

Before this subsystem can be marked production-accepted, a release evaluation MUST address:

1. **Functionality:** Ordinary chat and every implemented branch feature work end to end.
2. **Correctness:** IDs, ordering, fork points, knowledge lineage, and permissions remain intact.
3. **UX:** Organization, branching, and selecting prior material reduce cognitive work.
4. **Visual quality:** Liquid Intelligence motion conveys state without obscuring reading.
5. **Efficiency:** Search, long history, multiple views, and streaming meet measured performance targets set by the quality/performance workstreams.
6. **Safety:** Ambiguous high-impact actions require appropriate scope display/approval.
7. **Recovery:** Disconnects, retries, and migrations do not silently corrupt user data.
8. **Evidence:** Required tests, traces, screenshots/recordings where relevant, and known limitations are recorded.

## 18. Suggested implementation contracts (non-prescriptive)

The implementation team SHOULD define typed interfaces for the following resource operations. These are suggested logical contracts, **not claims that Codex exposes identical RPC methods**.

~~~text
conversation.create / conversation.open / conversation.rename
conversation.archive / conversation.restore / conversation.delete
conversation.search / conversation.findMessages
conversation.attachCollection / conversation.setSettings
conversation.fork / conversation.listFamily / conversation.compareBranches
branchKnowledge.publish / branchKnowledge.search / branchKnowledge.inspect
branchKnowledge.adopt / branchKnowledge.revoke / branchKnowledge.resolveConflict
conversation.context.inspect / conversation.context.attach / conversation.context.compact
conversation.execution.start / conversation.execution.interrupt / conversation.execution.reconcile
conversation.export / conversation.import / conversation.migrate
~~~

These interfaces should distinguish **requested action**, **authorization**, **executed operation**, **result**, and **reconciliation**. Backend adapters must map to verified provider APIs and emit structured unavailability where support is absent.

### 18.1 Minimum metadata concept for a cross-branch contribution

~~~yaml
contribution_id: stable-id
source:
  conversation_id: source-chat-id
  branch_id: source-branch-id
  message_or_event_ids: [source-id]
  source_version: provider-or-local-version
kind: finding | decision | artifact | excerpt | summary | hypothesis
summary: attributed-content-or-reference
evidence_refs: [source-resource-ref]
confidence: unverified | reported | observed | verified | disputed | superseded
visibility_scope: explicit-access-scope
created_at: timestamp
published_at: timestamp
supersedes: optional-prior-contribution-id
~~~

This schema illustrates required concepts. Final schemas, encryption, indexing, reconciliation, and exact backend capabilities belong in approved technical specifications.

## 19. Cross-charter ownership and dependencies

This charter is the normative owner for **chat UX, conversation organization, branch ancestry, and selective cross-branch exchange**. It depends on other domains without duplicating their rules:

| Domain | Owner / dependency | Boundary |
|---|---|---|
| Native selection and Contextual Command | Charter 01 | Supplies typed selections and scope interpretation |
| Motion and transition system | Charter 02 | Animates chat, branches, transfers without inventing states |
| Resources, collections, relationships | Charter 03 | Stable cross-workspace object catalog and grouping |
| Agents, tasks, executions | Charter 05 | Delegation, outcome tracking, work isolation |
| Vela and adaptive behavior | Charter 06 | Assistance, proactive suggestions, attention policies |
| Notes and authority of knowledge | Charter 07 | User notes, promotion to decisions, knowledge types |
| CIE and compaction | Charter 08 | Context ranking, retrieval, decay, compaction algorithms |
| Intelligence Streams | Charter 09 | Actual event collection, provenance, gap visibility |
| AI Execution Profiler | Charter 10 | Metrics, token reporting, performance comparisons |
| Timelines and replay | Charter 11 | Timeline visualizations and temporal reconstruction |
| Codex and provider adapters | Charter 12 | Supported backend methods, authentication, tools, limitations |
| Trust, privacy, autonomy | Charter 14 | Permission policy, deletion, sensitive data, audit |
| Quality and acceptance | Charter 15 | Test infrastructure, quality thresholds, review evidence |

Names and numbering identify planned charter boundaries. Until another charter is published and accepted, its specific technical requirements remain pending; the Constitution and this document's accepted domain requirements continue to apply.

## 20. Open decisions requiring research

The following choices MUST NOT be silently treated as already resolved:

1. **Backend fidelity:** Which exact Codex App Server versions and endpoints support native fork, history retrieval, resume, compaction, and event recovery?
2. **Canonical retention:** Which history is stored locally versus retained only by a provider, and what legal/privacy constraints apply?
3. **Knowledge extraction:** What models, heuristics, confidence signals, and user review processes qualify a finding for shared publication?
4. **Policy defaults:** What Connected Branches sharing mode is enabled for new branches, and how are sensitive/project-specific exceptions applied?
5. **Cross-provider continuity:** How much reconstruction is acceptable when a backend cannot import structured history?
6. **Branch UX:** Which visual form is most understandable in user studies: chronological lanes, condensed tree, compare panels, or combined layouts?
7. **Search indexing:** How to provide fast semantic retrieval while honoring local privacy, deletion, and authorization changes?
8. **Consistency:** How to reconcile multiple windows, remote streams, and concurrent chat writes without accidental duplicate turns?
9. **Performance targets:** What on-device benchmarks establish acceptable long-history navigation, full-text search, and branch-view responsiveness?
10. **Version and adoption:** Whether automatic adoption should ever modify next-turn context without a visible acknowledgment for a specific risk class.

Decisions must be recorded through the applicable architecture or governance change process. Open decisions do not authorize dropping the feature.

## 21. Governance change control and review checklist

**AW-CHAT-121 — Recorded changes.** Any change to branch independence, provenance, deletion, permission, or conversation identity guarantees MUST be reviewed for constitutional impact and recorded as a versioned governance amendment.

**AW-CHAT-122 — Compatibility review.** Modifying branch schema, import semantics, source linkage, or context-sharing policy MUST include migration, data-loss, permission, and acceptance-test impact analysis.

**AW-CHAT-123 — No silent weakening.** Engineering convenience, backend limitation, or schedule pressure MUST NOT silently redefine Connected Branches as ordinary isolated forks or convert imported summaries into untraceable transcript edits.

For owner acceptance, review whether:

- Ordinary Codex-style chat remains fully viable and easy.
- Project/workspace association never forces unnecessary setup.
- Search and smart organization solve discoverability without data duplication.
- Branches share ancestry but maintain independent futures.
- Post-fork sibling discoveries are retrievable and attributable.
- Sharing mode, scope, and model-context insertion are distinct and controllable.
- Compaction preserves retained source records and honest provenance.
- Vela can operate the chat catalog with structured, permissioned commands.
- Streaming UI, long histories, metrics, and branch views remain responsive.
- Privacy boundaries, deletion semantics, and provider limitations remain explicit.
- All normative requirements have traceable acceptance coverage.

---

## Charter completion statement

This charter specifies **owner-ratified (2026-11-05)** conversation and Connected Branch behavior, without asserting the features are already implemented or verified.

**Aerynth must preserve the freedom of a simple conversation while making long-running, branching, multi-agent knowledge understandable, connected, efficient, and reliably under the user's control.**

---

## Ratified amendment CF-2026-11-05: conversation continuity across API and agent boundaries
> **OWNER-RATIFIED 2026-11-05.** Original branch ancestry and sharing rules remain.

**AW-CHAT-124 — Canonical conversation ancestry.** Aerynth MUST own stable conversation and branch IDs independent of Responses IDs, managed agent sessions, GPT-Live session IDs and signed-in Codex threads.
**AW-CHAT-125 — Binding provenance.** Provider changes MUST retain source and destination scope, model/effort, context transfer, permissions and native continuation limitations without asserting universal provider memory.
**AW-CHAT-126 — Delegation is not permission sharing.** A fork, handoff or connected branch MUST NOT implicitly grant cross-project access, shared writable worktree ownership or private-history transfer.
**AW-CHAT-127 — Spoken message identity.** Voice and text projections of one answer MUST deduplicate by canonical ID and avoid unsolicited replay following restart, reconnect or audio-device changes.
**AW-CHAT-128 — Scoped context.** Long-context models MUST NOT justify importing unrelated or stale conversations. CIE provides relevant, source-linked, authorized ancestry and facts.
**AW-CHAT-129 — Observable tool results.** Conversations MUST distinguish planned, requested, awaiting approval, externally completed, independently verified, unknown and rejected outcomes with trace links.

**Acceptance:** Fork a conversation, switch model, start an agent, speak an update, restart and verify identities, branch boundaries, task evidence and memory privacy.

---

## Owner-directed supporting amendment FI-2026-11-10: conversational continuity through adaptive missions

> **Design obligations.** The conversation/ancestry owner remains authoritative. CIE retrieves evidence, AIR reasons, MissionService executes and AEP observes; none may silently rewrite the original conversation record.

**AW-CHAT-130 — AI-assisted referent resolution.** Conversation intake MUST support semantic understanding of implicit references, previous corrections, temporal descriptions and user goals through authorized CIE evidence retrieval. If records remain ambiguous, Vela MUST express uncertainty instead of inventing conversation history.

**AW-CHAT-131 — Identity across adaptive strategies.** Selection of new models, agent teams, reasoning efforts, API transports or replanned work MUST NOT fragment the canonical conversation, branch, turn or mission ancestry. Provider-specific IDs remain bindings only.

**AW-CHAT-132 — Plan and execution visibility.** Conversation presentation SHOULD link to active plan versions, delegated subagents, verified artifacts, partial status, blocked work and final results, with recorded source evidence rather than AI-invented progress narration.

**AW-CHAT-133 — Streaming and speculative work fidelity.** Parallel interpretation, retrieval or read-only speculative operations MUST not duplicate user-visible turns, speech, tool side effects or finalized answers. Provisional content must remain distinguishable from verified decisions.

**AW-CHAT-134 — Continuing Mission Executive.** A conversation MAY contain multiple AI supervision decisions and revised mission plans; each revision MUST record lineage, affected tasks and retained completions, without rewriting the original user intent or permission scope.

**AW-CHAT-135 — Experiential learning provenance.** A model-generated hypothesis about user preferences, task performance or prior success MUST NOT become a human-authored statement. Learning from user feedback requires source attribution, correction paths and scope-limited persistence.

**AW-CHAT-136 — Private branch boundaries.** Adaptive retrieval, agent handoff and strategy reuse MUST respect branch ancestry, connected-branch grants, provider context-transfer rules and revocation. Learning shared from one branch MUST not imply access to underlying confidential material in another.

**AW-CHAT-137 — Reversible presentation policy.** Users SHOULD be able to inspect the response strategy used, request a different authorized reasoning strategy, view why Vela took an action, and correct retained assumptions without erasing the historically accurate execution receipt.

**AW-CHAT-138 — Resumable result composition.** Long-running missions MUST reconnect to the same authoritative state after navigation, interruption or restart; the assistant may stream later verified outputs without presenting incomplete execution as a completed task.

**Acceptance:** Resolve a novel reference to an earlier task using cited context, spawn parallel delegated work and switch providers, correct an inferred preference, revoke a connected branch, restart mid-mission, and prove no duplicate side effects, invented ancestry or unauthorized context transfer. See [08 CIE](08-CONTEXT-INTELLIGENCE-AND-MEMORY.md), [09 Observability](09-INTELLIGENCE-STREAMS-AND-OBSERVABILITY.md) and [14 Trust](14-TRUST-PRIVACY-AND-AUTONOMY.md).
