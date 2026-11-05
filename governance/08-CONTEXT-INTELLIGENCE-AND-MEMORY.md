# 08 — Context Intelligence and Memory
## Governing Charter for the Context Intelligence Engine (CIE) in Aerynth

> **Ratification record, 2026-11-05:** The repository owner approves Charter 08, the CF-2026-11-05 amendment, and the unified-memory extension below as binding product requirements. The referenced runtime design is accepted but requires independent implementation and quality evidence. 

| Field | Value |
|---|---|
| Document ID | AW-GOV-008 |
| Version | **1.1.0 — owner-ratified 2026-11-05** |
| Status | **Owner-accepted and ratified governing charter; implementation verification remains separate** |
| Prepared | 2026-11-01 |
| Authority | Subsystem charter subordinate to [The Aetherwake Constitution](00-AETHERWAKE-CONSTITUTION.md) |
| Primary domain | Relevance-driven context construction; adaptive temporal memory; source-preserving compaction; retrieval; task handoff; cross-branch information delivery; context efficiency and integrity |
| Normative namespace | **AW-CIE-###** |
| Constitutional anchors | AW-CON-004–006, 026–028, 031–035, 037–041, 051–056, 062–065, 069–073, 080–083 |
| Closest published charters | [03 Resources](03-PROJECTS-WORKSPACES-AND-RESOURCES.md), [04 Connected Branches](04-CONVERSATIONS-AND-CONNECTED-BRANCHES.md), [06 Vela](06-VELA-INTELLIGENCE-AND-ADAPTATION.md) |
| Companion charter domains | 05 Agents; 07 Notes/Knowledge; 09 Observability; 10 Profiler; 12 Codex; 14 Trust; 15 Quality (some may not yet be published) |
| Implementation posture | Provider-neutral, testable outcome requirements; algorithms, embeddings, storage, and execution adapters remain research decisions |
| Public-repository boundary | This charter contains product requirements and synthetic examples only, never private conversations, user notes, secrets, embeddings of private data, or operational history |

> **Governing promise.** Aerynth's Context Intelligence Engine (CIE) SHALL make substantial amounts of information **discoverable, attributable, selectively usable, and recoverable** without treating every accessible byte as active model context. It prioritizes the information needed for the present job, preserves the information needed for future jobs, and demonstrates rather than merely asserts the effectiveness of its optimizations.
>
> **Core distinction.** **Stored history is not searchable awareness; searchable awareness is not retrieved context; retrieved context is not attached context; attached context is not necessarily sent to a model.** The interface MUST distinguish those states.
>
> **Essential invariant.** **Compaction is not deletion. Age is not authority. Lower token usage is not success if the result becomes less reliable.**

---

## 1. Authority, intent, and boundaries

This charter is the authoritative home for **context selection, relevance policies, compaction strategy, persistent working-memory packaging, retrieval orchestration, prompt/tool-output economy, context inspection, and context-integrity evaluation**. The Aetherwake Constitution prevails in every conflict; the repository owner has final decision authority. MUST, MUST NOT, SHOULD, and MAY carry the meanings established by the Constitution.

This document governs behavioral outcomes and enforceable contracts rather than requiring a particular database, vector store, ranking model, SDK, tokenizer, backend provider, or retrieval framework. A capability named here is a product requirement, **not a claim that current Codex interfaces already expose it**.

CIE does not own the underlying conversation transcript (04), note authoring and knowledge authority (07), identity of a resource (03), Vela's attention/initiative decisions (06), underlying model execution (12), user permission policy (14), or canonical financial/time/token telemetry (10). It coordinates with those domains.

**AW-CIE-001 — Constitutional priority.** No retrieval, condensation, cache, efficiency optimization, or model routing strategy MAY weaken an applicable constitutional requirement.

**AW-CIE-002 — Context is an explicit product capability.** CIE MUST work for normal chats, Vela conversations, agent executions, formal tasks, workspaces, and projects without requiring users to adopt task-centric workflows.

**AW-CIE-003 — Honest boundary.** CIE MUST identify which context it assembles and controls and MUST NOT claim control of inaccessible provider-internal prompt state, hidden reasoning, proprietary compaction, undocumented token accounting, or private model memory.

**AW-CIE-004 — Source-owner integrity.** CIE MUST consume resource identities, permissions, authority labels, and retention state from their owning subsystems; it MUST NOT unilaterally redefine them.

**AW-CIE-005 — No token-efficiency theater.** A shorter prompt, a prettier memory graph, or a compaction event is not evidence of effective optimization without measured results and integrity checks.

### 1.1 Canonical vocabulary

| Concept | Meaning |
|---|---|
| **Canonical source** | Authoritative, retained original record or resource within its owning system, subject to policy |
| **Source reference** | Typed, stable reference and version/range information that identifies supporting evidence |
| **Awareness/index** | Searchable metadata or index pointing toward material; no assertion that a model has seen it |
| **Candidate** | Authorized potential context item discovered or proposed for retrieval |
| **Retrieved item** | Material actually fetched or read for assessment; not necessarily included in a model request |
| **Attached item** | Context designated for a chat/task/turn; inclusion may be conditional on scope and budget |
| **Effective context package** | CIE-controlled content, instructions, references, and bounded outputs prepared for one execution |
| **Inclusion manifest** | Inspectable record of sources selected, summarized, omitted, or excluded and the applicable rationale |
| **Memory unit** | Typed information extracted or recorded for future retrieval, with source, status, and scope |
| **Checkpoint** | A bounded, structured representation of progress, decisions, open questions, and evidence |
| **Compaction** | Lossy or selective reduction of active working context; original source retention is separate |
| **Rehydration** | Retrieval of historical source material or a higher-fidelity representation into a later context |
| **Handoff** | Structured transfer package allowing another execution/agent to continue a task |
| **Decay** | Reduction of automatic active-context priority, never automatic proof of irrelevance or authorization to delete |
| **Pinned constraint** | An authorized requirement or decision that optimization must not silently omit when applicable |
| **Provenance** | Origin, version/time, source type, evidence, transformation lineage, and authority information |
| **Retrieval scope** | Explicit authorized resources and boundaries eligible for a given query or execution |
| **Context budget** | Planning envelope for available model context, not necessarily a guaranteed token or billing cap |

---

## 2. Nonnegotiable context integrity

**AW-CIE-006 — Canonical preservation.** Summarization, deduplication, compaction, indexing, handoff, and rehydration MUST NOT mutate or replace retained canonical messages, notes, files, or event records.

**AW-CIE-007 — Retention authority.** Preservation applies within the user's effective retention/deletion policy; user-authorized deletion, revocation, legal requirements, and provider-side availability MUST be respected. Do not falsely promise recovery after irrecoverable deletion.

**AW-CIE-008 — No silent requirement loss.** Applicable explicit instructions, safety/security boundaries, owner decisions, unresolved blockers, acceptance criteria, and verified dependencies MUST NOT be dropped merely to satisfy a context target.

**AW-CIE-009 — No silent authority promotion.** A note, agent inference, retrieval result, generated summary, or repeated claim MUST NOT silently become a governing instruction or verified decision.

**AW-CIE-010 — No fabricated continuity.** Missing history, unavailable source ranges, disconnected providers, incomplete indexes, and unsynchronized changes MUST be surfaced honestly. A generated summary MUST NOT be described as a verbatim record.

**AW-CIE-011 — Reversible context choices.** Where source data remains authorized and available, users MUST be able to revisit prior inclusion decisions, restore relevant material, and correct compacted summaries without editing history.

**AW-CIE-012 — User control over automatic strategies.** Users MUST be able to inspect, disable, override, or limit automated memory creation, automatic context attachment, compaction recommendations, and retrieval/sharing policies at the scopes supported by settings.

**AW-CIE-013 — Privacy is prior to relevance.** No relevance score, semantic match, task urgency, or cache hit may bypass an access-control or sharing decision.

---

## 3. CIE pipeline and separation of concerns

The conceptual process is:

~~~text
User intent / agent task / current selection
          |
          v
    Context request + policy + permission scope
          |
          v
  Discover candidates (catalog / FTS / semantic / links)
          |
          v
  Resolve sources + versions + authorization
          |
          v
  Rank relevance, importance, reliability, dependency
          |
          v
  Construct bounded context package + inclusion manifest
          |
          v
  Validate coverage / constraints / provenance / budget
          |
          v
  Send through supported execution adapter
          |
          v
  Observe results; preserve verified outcomes/checkpoints
          |
          +----> analytics, feedback, optional memory updates
~~~

**AW-CIE-014 — Explicit request envelope.** Each context request MUST carry, where applicable, stable conversation/task/agent IDs, intended action, current project/workspace, selected typed resource IDs, provider/model capability, effective permissions, user overrides, and freshness requirements.

**AW-CIE-015 — Distinct pipeline stages.** Discovery, retrieval, inspection, attachment, assembly, execution, and storage MUST remain individually identifiable in code and user-facing diagnostics. Success at one stage MUST NOT imply completion of later stages.

**AW-CIE-016 — Typed provenance.** Context items MUST retain source type and identity, revision or snapshot time, access scope, evidence locator, and transformation lineage where available.

**AW-CIE-017 — Scoped, minimal assembly.** The default MUST begin with task-relevant requirements, current selected objects, and needed context, then expand through justified retrieval rather than preloading every reachable resource.

**AW-CIE-018 — Dependency-aware expansion.** CIE SHOULD follow typed relationships to files, constraints, active tasks, branch findings, decisions, and test evidence when these are necessary to complete the request.

**AW-CIE-019 — Backend capability gate.** Provider-specific attachment, compaction, model context, caching, steering, and token features MUST be enabled only when supported and verified for that runtime. Unsupported operations require a safe alternate path or explicit limitation.

**AW-CIE-020 — Native-first factual access.** Deterministic navigation, identity lookup, metadata queries, and simple local filtering SHOULD use native services without invoking a reasoning model unless semantic interpretation is necessary.

---

## 4. Relevance, priority, and ranking policy

CIE ranks **eligible** context; eligibility is decided by permission and scope **before** ranking. No universal fixed weighting is mandated. Scoring and selection SHOULD be explainable by meaningful factors rather than an opaque number alone.

| Dimension | Questions that should influence inclusion |
|---|---|
| Task relevance | Does the content address the current objective or selected source? |
| Explicit importance | Is it a pinned constraint, owner decision, required artifact, or hard acceptance criterion? |
| Evidence quality | Is it verified, witnessed, reported, speculative, contradicted, or stale? |
| Dependency impact | Would omitting it invalidate the next step or introduce a known conflict? |
| Recency and change | Has the information been superseded or modified since use? |
| Uniqueness | Does this add new information, or merely repeat authoritative material? |
| Coverage | Is a key subproblem, boundary condition, or alternative absent from the package? |
| Cost | How much context and retrieval latency does it add, relative to expected benefit? |
| User intent | Did the user explicitly select, attach, pin, restore, exclude, or request it? |
| Provider constraints | Can the target model/tool receive this content in a supported form? |

**AW-CIE-021 — Multidimensional selection.** Ranking MUST account for more than age or lexical similarity; relevance, importance, evidence quality, dependencies, uniqueness, and cost are mandatory design dimensions.

**AW-CIE-022 — Explicit material wins.** User-selected or explicitly requested content MUST receive strong priority within permission and provider constraints; if impossible to fit, CIE MUST explain the conflict and present a bounded alternative rather than quietly discard it.

**AW-CIE-023 — Constraint pinning.** Applicable security, architecture, owner-approved, and task acceptance constraints MUST have protected inclusion treatment. "Pinned" does not mean permanently injected into unrelated tasks.

**AW-CIE-024 — Contradiction preservation.** Materially conflicting claims MUST NOT be silently merged into a single invented consensus. Prefer side-by-side cited alternatives and verification needs.

**AW-CIE-025 — Currentness and supersession.** The system MUST check source freshness where feasible, distinguish historical from current facts, and mark invalidated or superseded memories.

**AW-CIE-026 — Cost-aware completeness.** Selection SHOULD optimize necessary coverage and useful evidence per token/latency, not achieve a target token count in isolation.

**AW-CIE-027 — Exclusion rationale.** The inclusion manifest SHOULD identify why significant candidates were omitted: unauthorized, irrelevant, stale, duplicate, unavailable, user-excluded, or budget-constrained.

---

## 5. Awareness and memory tiers

CIE coordinates the awareness tiers defined for Vela without claiming perpetual model cognition.

| Tier | Example | Default model inclusion |
|---|---|---|
| Immediate | Current user command and selected typed references | Include when relevant |
| Working | Active task status, recent linked execution evidence | Include selectively |
| Persistent | Project facts, decisions, notes, preferences, task checkpoints | Retrieve by importance and relevance |
| Discoverable | Archived chats, older history, related branch findings, indexed documents | Search then retrieve as needed |
| Monitored | Authorized watcher events and connector updates | Include only when useful and policy permits |

**AW-CIE-028 — Tier truthfulness.** The interface MUST NOT label searchable/indexed data as continuously known to the active model, nor imply that a monitor is active when it is not.

**AW-CIE-029 — Persistent identity, bounded prompts.** A persistent Vela identity or persistent task MUST NOT require an indefinitely expanding provider context or constant background model calls.

**AW-CIE-030 — Searchable does not equal trusted.** Indexed content must retain epistemic type and source authority. Search relevance does not promote a retrieved claim into a verified fact.

**AW-CIE-031 — Graceful partial availability.** If a tier is offline or its index is incomplete, CIE MUST continue with available authorized context where reasonable and expose the coverage limitation.

---

## 6. Adaptive temporal decay and importance protection

The user should be able to continue a long conversation without indefinitely replaying its entire history. The system may progressively compress the **active representation** of older material while retaining important source references and protected facts.

Suggested conceptual representations (not fixed deadlines):

| Representation | Typical purpose | Fidelity |
|---|---|---|
| Recent detailed segment | Current turns, active discussion, live blockers | High |
| Working summary | Current goals, recent decisions, active references | Moderate-high |
| Milestone checkpoint | Completed phase and handoff state | Structured and bounded |
| Historical index entry | Long-past, low-relevance activity | Metadata with source locator |
| Protected durable memory | Key requirement, unresolved risk, verified decision | Specific, source-linked, authority-aware |
| Archived source | Complete eligible original history | Source fidelity, not active context |

**AW-CIE-032 — Time is a factor, not a verdict.** Age MAY lower inclusion priority but MUST NOT alone remove relevant decisions, constraints, requirements, unresolved problems, or durable user-specified facts.

**AW-CIE-033 — Adaptive decay.** Active-context fidelity SHOULD change with age, task relevance, importance, access frequency, source reliability, dependency relationships, and expected recovery cost.

**AW-CIE-034 — Protected semantic anchors.** Long-running tasks MUST retain or retrieve high-value anchors such as objective, acceptance tests, hard constraints, current state, unresolved issues, and authorized commitments.

**AW-CIE-035 — Decay without destruction.** Moving material from detailed to summarized or index-only representation MUST NOT silently delete its canonical source.

**AW-CIE-036 — Context restoration.** Users MUST be able to select a historical range, source, checkpoint, or memory and request higher-fidelity retrieval into an eligible later turn.

**AW-CIE-037 — Inspectable aging policy.** Settings MUST reveal what content can decay, when reassessment occurs, what is protected, and what stays available through search.

**AW-CIE-038 — Proportional memory refresh.** Repeated access, changed task intent, new evidence, or source revisions SHOULD trigger relevance reassessment without forcing a full history reload.

**AW-CIE-039 — Distinguish retention from inclusion.** Time-to-live or expiry for cached/indexed summaries MUST be independent of canonical record retention. A cache eviction MUST NOT masquerade as user-requested deletion.

---

## 7. Compaction and continuation

Compaction is a controlled reduction of working context. Its strategy MAY involve provider-supported thread compaction, CIE-created summaries, selective checkpointing, or a new continuation thread supplied with a handoff package. These are not identical mechanisms.

**AW-CIE-040 — Deliberate triggers.** CIE SHOULD recommend or schedule compaction based on context pressure, milestone boundaries, accumulated irrelevance, latency, estimated future cost, and information risk rather than a rigid message count alone.

**AW-CIE-041 — Safe trigger constraints.** Automatic compaction MUST respect user settings and MUST NOT disrupt an in-flight destructive action, approval decision, or critical operation without a supported safe boundary.

**AW-CIE-042 — Pre-compaction extraction.** Before significant compaction, CIE MUST identify applicable requirements, decisions, assumptions, blockers, current objective, source links, verification evidence, and pending approvals.

**AW-CIE-043 — Source-preserving summary.** Every generated compacted representation MUST record source scope, generation time, representation type, fidelity caveat, and links to recoverable evidence.

**AW-CIE-044 — Loss visibility.** Compaction is generally lossy; the system MUST describe it honestly and SHOULD enable inspection of important omitted categories or explicit protected details.

**AW-CIE-045 — Post-compaction coverage audit.** The output MUST be checked against protected constraints and current task needs before use in place of a more detailed representation. A failed audit MUST block substitution or require repair.

**AW-CIE-046 — Provider distinction.** Provider-native compaction MUST NOT be portrayed as a fully inspectable internal transform when the provider does not expose its contents, and MUST NOT be assumed reversible within the provider session.

**AW-CIE-047 — Explicit handoff option.** When source continuity, token pressure, or provider limitations make ordinary compaction inadequate, CIE SHOULD offer a new thread/execution with an inspectable handoff and continued access to original sources.

**AW-CIE-048 — Failure-safe compaction.** Failed, interrupted, or incomplete compaction MUST NOT overwrite a last-known-good checkpoint or delete a previous valid context representation.

**AW-CIE-049 — No repeated-compression drift.** CIE SHOULD preferentially rebuild important summaries from canonical sources and verified checkpoints rather than recursively summarizing already lossy summaries without provenance checks.

**AW-CIE-050 — User command and override.** Users MUST be able to request, defer, or inspect a compaction where supported and choose an appropriate recovery path when the provider cannot perform it directly.

---

## 8. Persistent Task Memory and handoffs

A task survives the chat, execution, model, agent, or workspace that happens to work on it. Task memory is not a replacement for original sources or task governance; it is a structured context aid.

A recommended checkpoint structure contains:

| Field | Purpose |
|---|---|
| Task and project identifiers | Stable linkage |
| Objective and success conditions | What must be accomplished |
| Current phase and actual status | Reported vs verified completion |
| Relevant constraints | Requirements and permissions |
| Decisions and reasons | Source-linked, authority-aware |
| Completed work | Artifacts, commits, tests, measurements |
| Open problems and risks | Unresolved findings |
| Next recommended steps | Explicit actionable continuation |
| Context references | Files, messages, sources, sibling findings |
| Agent/execution attribution | Who produced the checkpoint |
| Version and timestamp | Freshness and auditability |
| Limitations and omissions | Known coverage gaps |

**AW-CIE-051 — Independent task continuity.** Task Memory MUST persist independently of a particular chat, agent process, or UI block, subject to the task's authoritative lifecycle and user policy.

**AW-CIE-052 — Evidence-first checkpoints.** Checkpoint claims of completion MUST link to observable artifacts or tests where available and identify self-reported versus independently verified claims.

**AW-CIE-053 — Handoff sufficiency.** Handoffs SHOULD include objectives, constraints, state, dependencies, evidence, known caveats, and the next safe action; a vague "continue work" note is insufficient for consequential engineering tasks.

**AW-CIE-054 — Cross-model neutrality.** Persistent task representations SHOULD be portable between supported model/providers without requiring access to private provider reasoning or vendor-specific hidden state.

**AW-CIE-055 — Version and conflict safety.** Concurrent agents updating the same task checkpoint MUST use versioning, conflict detection, or explicit merge semantics; last-writer-wins MUST NOT silently erase material findings.

**AW-CIE-056 — Resume freshness.** A resumed task MUST revalidate relevant files, branch state, credentials/permissions, task assignment, dependencies, and external data before performing consequential actions.

**AW-CIE-057 — No fictitious work.** Checkpoints and assistant recaps MUST distinguish planned, attempted, implemented, tested, reviewed, merged, deployed, and actually verified states.

**AW-CIE-058 — Source-linked corrections.** User corrections and invalidations MUST update future task representations, while preserving a traceable history according to retention policy.

---

## 9. Connected Branches and shared knowledge

Charter 04 owns branch identity, ancestry, sharing modes, and user-visible adoption. CIE owns **how authorized material is discovered, ranked, retrieved, assembled, and delivered** to a model.

**AW-CIE-059 — Branch independence.** Independent forks MUST keep separate post-fork transcripts and working contexts. Sharing knowledge MUST NOT silently rewrite a branch's historical messages.

**AW-CIE-060 — Mode-aware access.** Independent, Connected, and Collaborative sharing modes MUST be enforced at retrieval and inclusion time, including more restrictive user/project overrides.

**AW-CIE-061 — Post-fork discovery.** Authorized branch-family material created after the fork MUST be eligible for later discovery without preemptive full-history injection.

**AW-CIE-062 — Attributed adoption.** A cross-branch item MUST preserve source branch, message/artifact locator, source time/version, evidence and trust state, and adoption/inclusion record.

**AW-CIE-063 — No implicit broad fan-out.** A finding relevant to one agent MUST NOT automatically cause entire sibling transcripts to be sent to every branch or agent.

**AW-CIE-064 — Contradictions remain visible.** Contradictory branch findings MUST remain separately attributable and SHOULD trigger an evidence comparison rather than silent replacement.

**AW-CIE-065 — Revocation and freshness.** Future retrieval MUST honor revised sharing, source deletion, invalidation, and access revocation; stale derived material MUST be invalidated or marked accordingly.

**AW-CIE-066 — Inclusion states.** The user MUST be able to distinguish branch material that is merely discoverable, inspected, attached, included in a turn, or acted upon.

---

## 10. Project knowledge, notes, and authority

Charter 07 owns capture, authoring, personal Thought Stream, note semantics, and promotion into authoritative knowledge. CIE consumes that structured information.

**AW-CIE-067 — Knowledge-aware retrieval.** CIE MUST support explicit sources and eligible discovered knowledge across Quick Capture, workspace/project notes, annotations, project facts, decisions, documents, and historical chat excerpts as those resources become available.

**AW-CIE-068 — Authority labels persist.** An idea, question, proposal, verified fact, user-approved decision, and binding requirement MUST remain distinguishable throughout extraction, summary, search, and execution inclusion.

**AW-CIE-069 — Knowledge inclusion policies.** Where configured, resources SHOULD support modes equivalent to Always Include (subject to task relevance/constraints), Retrieve When Relevant, and Manual Only, with effective scope clearly explained.

**AW-CIE-070 — Citation-bearing synthesis.** Summaries created from multiple notes or sources MUST preserve source references and avoid presenting speculative synthesis as a user-authored decision.

**AW-CIE-071 — Corrections propagate.** Corrections, disputed content, and supersession MUST update eligible retrieval views and future packages without silently rewriting the historical source record.

**AW-CIE-072 — No involuntary promotion.** A retrieved note MUST NOT become permanent project instruction or model-wide memory simply because CIE found it relevant.

---

## 11. Indexing, retrieval, and freshness

Search modalities MAY include metadata filters, exact/full-text search, relationship expansion, embeddings, and optional reranking. Each is a means, not an architectural mandate.

**AW-CIE-073 — Scoped indexing.** Indexes MUST enforce resource access, project/user separation, configured exclusions, and deletion semantics at both indexing and query execution.

**AW-CIE-074 — Typed retrieval.** A retrieval result SHOULD include stable identity, locator, excerpt boundaries, origin, revision, indexed time, retrieved time, relevance explanation, and coverage/completeness flags.

**AW-CIE-075 — Hybrid discovery where justified.** Search SHOULD combine precise identifiers/full-text matching with semantic similarity and relationship signals when tests demonstrate benefit; approximate retrieval alone is not always sufficient.

**AW-CIE-076 — Embedding protections.** Embeddings, derived summaries, and search caches MUST be treated as potentially sensitive derivatives. They MUST follow applicable retention, access, export, and deletion policy.

**AW-CIE-077 — Reindex and invalidation.** Source revision/deletion, permission changes, repository switches, and provider disconnects MUST invalidate or refresh stale index entries and any unsafe derived caches.

**AW-CIE-078 — Offline and incomplete coverage.** Search results MUST represent whether they cover a complete source set, a partial local snapshot, or unavailable external resources.

**AW-CIE-079 — Retrieval-budget limits.** Queries SHOULD support bounded breadth, depth, and latency; the system MUST avoid runaway recursive retrieval or unbounded background semantic processing.

**AW-CIE-080 — Fidelity on demand.** Users and agents with permission SHOULD be able to navigate from excerpts and summaries back to higher-fidelity eligible sources rather than accepting summaries as uncheckable authority.

---

## 12. Deduplication, instruction composition, and tool-output economy

Avoiding needless repeated information is important, but duplication sometimes reflects a deliberate emphasis or distinct source authority.

**AW-CIE-081 — Source-aware deduplication.** CIE SHOULD identify duplicate and near-duplicate instructions, artifacts, logs, and retrieved excerpts, while retaining distinct origins and significant differences.

**AW-CIE-082 — Precedence preservation.** Deduplication MUST preserve effective authority, instruction precedence, source identity, and unique exceptions; it MUST NOT turn lower-trust content into higher-trust directives.

**AW-CIE-083 — Injection resistance.** Retrieved pages, files, tool output, chat excerpts, and agent reports MUST be treated as potentially untrusted content. Instructions embedded in those sources MUST NOT override authorized higher-priority instructions or tool permissions.

**AW-CIE-084 — Full-output retention where supported.** For tool interfaces Aerynth controls, full outputs SHOULD be retained under appropriate storage/retention limits while model-facing views MAY be bounded, indexed, filtered, and expandable.

**AW-CIE-085 — Critical output protection.** Errors, failed assertions, command exit status, trace identifiers, and diagnostically significant context MUST NOT be silently removed from a supposedly complete tool summary.

**AW-CIE-086 — Honest interception boundary.** CIE MUST NOT claim to filter all native Codex tools or hidden provider operations unless supported adapter instrumentation actually provides that control.

**AW-CIE-087 — Bounded pagination.** Large documents and command outputs SHOULD use excerpts, ranges, aggregates, and follow-up retrieval rather than unnecessary monolithic injection.

**AW-CIE-088 — Deduplication audit.** Context Inspector SHOULD show when material was suppressed as duplicate and allow inspection of the retained original references.

---

## 13. Context profiles, settings, and inheritance

Profiles define **application-side context behavior**; they do not automatically change provider-internal reasoning, hidden prompt instructions, or model context size.

| Profile | Intended policy |
|---|---|
| Minimal | Narrow source set, explicit attachments, strong truncation safeguards |
| Lean | Targeted retrieval, compact responses, minimal background expansion |
| Balanced | Broad enough task coverage with bounded retrieval |
| Comprehensive | More historical/source coverage with preservation of relevance |
| Maximum | Favor contextual completeness within actual model limits and permission scope |
| Adaptive | Choose a suitable strategy based on task risk, complexity, available sources, quality feedback, and user settings |

**AW-CIE-089 — Profiles available.** CIE SHOULD provide named profiles and allow advanced per-setting control without forcing the user into an intimidating configuration workflow.

**AW-CIE-090 — Inherited configuration.** Context settings MUST participate in the established Global → Project → Workspace → Chat → Task inheritance model where relevant, with resolved origins and overrides visible.

**AW-CIE-091 — User intent precedence.** An explicit valid per-turn inclusion/exclusion or restoration request SHOULD override less-specific defaults, except where higher-priority trust/security or provider constraints prohibit it.

**AW-CIE-092 — Profile transparency.** Profiles MUST disclose their effects on retrieval breadth, compaction cadence, summary fidelity, protected memory, cache behavior, and resource/latency tradeoffs.

**AW-CIE-093 — Adaptive explanation.** Automatic profile changes SHOULD be attributable to meaningful observable signals and be reversible or disableable.

**AW-CIE-094 — No false model parameter control.** The interface MUST distinguish CIE controls from actual backend-supported model settings (reasoning effort, context size, cache behavior, etc.), and display unsupported controls accurately.

---

## 14. Token budgets, latency, and quality-based optimization

The AI Execution Profiler (10) owns authoritative token/timing displays. CIE owns how those observations influence context decisions.

**AW-CIE-095 — Measured efficiency.** CIE MUST use actual reported usage and measured timings when available; estimates and provider-unreported fields MUST be labeled and not silently treated as facts.

**AW-CIE-096 — Quality-adjusted objective.** Optimization SHOULD weigh token use, wall-clock time, retries/rework, human intervention, task outcome, evidence completeness, and correctness, not raw token savings alone.

**AW-CIE-097 — Honest budget classes.** The application MUST distinguish planning envelopes, soft alerts, admission limits, interruption-based controls, and actually guaranteed hard caps. It MUST NOT assert guaranteed stopping where in-flight calls can overshoot.

**AW-CIE-098 — Task-aware budgets.** Project/chat/task contexts SHOULD support configurable context and usage policies that can influence retrieval breadth, checkpoint cadence, and model/agent recommendations within supported capabilities.

**AW-CIE-099 — Cache recognition.** CIE SHOULD avoid needless recomputation/retrieval where cache reuse is permitted, while treating cached inputs, freshness, and actual token billing as provider-specific measurements.

**AW-CIE-100 — Graceful constrained mode.** When the configured budget or provider window is insufficient, CIE MUST offer a smaller verified scope, staged retrieval, checkpoint/handoff, or explicit limitation rather than silently discard essential requirements.

**AW-CIE-101 — Avoid wasteful orchestration.** Repeated retrieval and redundant context fan-out across agents SHOULD be minimized by shared indexes and reference-based handoffs; agent count alone is never an efficiency target.

---

## 15. Context Inspector and memory-decay visualization

CIE's decisions must be usable, not merely exposed as raw diagnostics.

**AW-CIE-102 — Turn-level context manifest.** For each supported turn, users MUST be able to inspect Aerynth-managed included resources, transformations, protected facts, exclusions, source permissions, and any known provider-observability limitations.

**AW-CIE-103 — Distinct visibility states.** The inspector MUST distinguish archived source, indexed metadata, retrieved source, attached item, submitted context, and uncertain/unobservable provider state.

**AW-CIE-104 — Memory timeline.** A visual history SHOULD represent recent detailed material, compacted segments, milestone checkpoints, durable pinned knowledge, and archival source ranges, with semantic meaning independent of decorative animation.

**AW-CIE-105 — Rehydrate from selection.** Where permitted and available, users SHOULD be able to select historical regions, notes, branch evidence, or checkpoints and request focused inclusion in a subsequent execution.

**AW-CIE-106 — Accessible diagnostics.** Context graphs, decay visualizations, and status indicators MUST have usable textual, keyboard, and reduced-motion alternatives in accordance with the interaction and quality charters.

**AW-CIE-107 — Explain meaningful savings.** The UI SHOULD show token/latency impact and the risks or uncertainty of proposed compaction, deduplication, retrieval, or model-routing choices.

**AW-CIE-108 — No imaginary model view.** Visualizations MUST NOT imply they expose raw hidden model reasoning or a complete undisclosed provider prompt; they represent known CIE state and supported provider events only.

---

## 16. Reliability, security, deletion, and failure containment

**AW-CIE-109 — Least privilege end-to-end.** Retrieval, memory extraction, indexing, contextual sharing, and handoff MUST enforce the effective authorization of the actual requesting user/agent/connector.

**AW-CIE-110 — Privacy-safe persistence.** Sensitive source text, embeddings, access tokens, generated summaries, and telemetry MUST be protected according to classification, encryption/storage, retention, and export policy. A public repo is never a private memory store.

**AW-CIE-111 — Revocation propagation.** A permission revocation or authorized deletion MUST stop future access and trigger appropriate index/cache invalidation and derived-data handling; retained audit references must not leak forbidden content.

**AW-CIE-112 — Transactional checkpoints.** Important context snapshots and checkpoint updates SHOULD be atomic, versioned, and recoverable after crashes or interrupted writes.

**AW-CIE-113 — Failure transparency.** Source errors, provider disconnections, expired credentials, retrieval timeouts, and missing history MUST appear as meaningful limitations in affected context packages and interfaces.

**AW-CIE-114 — Avoid unbounded background use.** Background indexing, summarization, memory refresh, and proactive preparation MUST respect opt-ins, resource budgets, foreground workload, and configured service states.

**AW-CIE-115 — External-content safety.** Web pages, repository comments, transcripts, external notes, and tool outputs MUST remain lower-trust sources; no embedded "instructions" may initiate external actions or expand permissions without the proper authorization path.

**AW-CIE-116 — Export and portability.** Where data rights and platform limits permit, users SHOULD be able to export their canonical/derived memory data, provenance references, checkpoints, and relevant configuration in a documented format.

---

## 17. Conceptual interface contracts (non-prescriptive)

The following represent responsibilities, not invented Codex protocol endpoints. Formal schemas belong in technical specifications.

| Service | Minimum conceptual operations / outputs |
|---|---|
| Context Request Builder | derive intent, scope, selected objects, task identity, model capabilities, policy |
| Source Resolver | authorize, resolve stable IDs, fetch bounded ranges, versions, freshness |
| Candidate Discovery | metadata/full-text/semantic/relationship search, filters, coverage |
| Relevance Evaluator | rank, protect constraints, assess evidence/duplicates/contradictions |
| Package Assembler | allocate context budget, include/exclude, format supported inputs |
| Inclusion Manifest | explain sources, transformations, exclusions, effective scopes, timestamps |
| Memory Registry | create/find/revise/deprecate typed sourced units, inspect permissions |
| Compaction Coordinator | recommend, prepare, validate, execute through supported mechanism, recover |
| Checkpoint/Handoff Service | versioned task state, artifacts, dependencies, known limitations |
| Branch Knowledge Gateway | scoped discovery, cited adoption, sharing policy enforcement |
| Tool-Output Gateway | capture, filter, page, search, retrieve full output where available |
| Cache/Index Manager | refresh, invalidate, retention, permission changes, coverage |
| Evaluation/Telemetry Bridge | measured usage, quality, timing, experiments, attribution |
| Context Inspector API | timeline, manifest, reasons, source links, restore commands |

### 17.1 Example context package (illustrative, not a finalized schema)

~~~yaml
context_request:
  execution_ref: exec:synthetic-104
  project_ref: project:sample
  conversation_ref: chat:sample
  objective: "Diagnose a test regression"
  scope: ["repo:sample", "task:regression"]
  profile: adaptive
  provider_capabilities: verified-at-runtime
  permission_scope: read-only

inclusion_manifest:
  protected:
    - ref: requirement:acceptance-12
      reason: "Applicable acceptance criterion"
  included:
    - ref: file:tests/regression.spec
      version: commit-sha
      fidelity: "selected ranges"
      reason: "Directly relevant failure evidence"
    - ref: checkpoint:previous-investigation
      version: 3
      fidelity: "structured summary"
      reason: "Prior verified observations"
  omitted:
    - ref: note:unrelated-topic
      reason: "No demonstrated task relevance"
  limitations:
    - "Provider internal context state not observable"
~~~

**AW-CIE-117 — Stable references and versioned contracts.** Public integration interfaces MUST use typed identities, explicit result/status distinctions, and versioned contracts rather than relying on unstructured text and UI component positions.

**AW-CIE-118 — Request/response traceability.** CIE SHOULD correlate its context request and resulting manifest with the corresponding execution, reported usage, and outcome verification where data is available.

**AW-CIE-119 — Capability discovery.** Implementations MUST validate supported provider interfaces before displaying capabilities as operational; invented or undocumented API calls are not a permitted implementation substitute.

**AW-CIE-120 — Idempotent recovery.** Retries of context assembly, checkpoint updates, and handoff operations SHOULD preserve identity and prevent duplicate or inconsistent state.

---

## 18. Mandatory acceptance scenarios

Acceptance requires reproducible fixtures, instrumentation, and review evidence. Synthetic data is preferred; no private user's chat history is permitted in the public repository.

| Test | Scenario and required outcome | Requirements |
|---|---|---|
| CIE-AT-01 | Long conversation: earlier unimportant messages move out of active context, while original permitted history remains searchable and readable | 006–008, 032–039 |
| CIE-AT-02 | Six-month-old approved constraint remains accessible and included when applicable despite recency decay | 008, 021–023, 032–034 |
| CIE-AT-03 | User selects an older message range and rehydrates it into a new execution with visible provenance | 011, 036, 102–105 |
| CIE-AT-04 | Provider compaction drops detail: UI identifies unknown provider internals, retained sources and alternative handoff | 043–050, 108 |
| CIE-AT-05 | Failed compaction or crash retains valid checkpoint and canonical history | 006, 048, 112–113 |
| CIE-AT-06 | Sibling branch posts a finding after fork: another eligible branch discovers and selectively imports it without transcript merge | 059–066 |
| CIE-AT-07 | Independent branch mode blocks unsolicited publication/injection; Collaborative mode honors access restrictions | 060, 063, 065, 109 |
| CIE-AT-08 | Two branches disagree materially: contradiction and evidence remain visible rather than overwritten | 024, 064 |
| CIE-AT-09 | Quick Note idea is retrieved as an idea but not elevated to approved project decision | 009, 067–072 |
| CIE-AT-10 | Tool command emits massive logs: bounded excerpt contains critical failure, while full eligible output remains available through gateway | 084–087 |
| CIE-AT-11 | Duplicate instructions with distinct authority: redundant wording may compress, but exceptions and precedence survive | 081–083, 088 |
| CIE-AT-12 | Web page includes malicious instructions to change permissions: retrieval is allowed as data, embedded commands are not executed | 083, 109, 115 |
| CIE-AT-13 | Chat context exceeds target budget: protected constraints remain, bounded strategy or transparent continuation is offered | 022–023, 095–101 |
| CIE-AT-14 | Agent handoff after long task: successor obtains verified state, blockers, acceptance tests, source links, and actual latest repo state | 051–058 |
| CIE-AT-15 | Two agents update one checkpoint concurrently: conflict is detectable and no valid state silently disappears | 055, 112, 120 |
| CIE-AT-16 | Source deleted or access revoked: future retrieval and index/search candidates no longer expose it; prior inaccessible derivatives handled by policy | 007, 065, 077, 109–111 |
| CIE-AT-17 | Source offline: search reports partial coverage and package does not imply complete information | 010, 031, 078, 113 |
| CIE-AT-18 | Indexed item not fetched: UI says discoverable, not inspected, attached, or known by the model | 015, 028–030, 102–103 |
| CIE-AT-19 | Compaction savings evaluation: compare tokens, wall time, completion quality, rework, and constraint omissions against baseline | 005, 095–101 |
| CIE-AT-20 | User disables adaptive memory: new automatic extraction/injection obeys policy; explicit retrieval remains available where permitted | 012, 089–094 |
| CIE-AT-21 | Model backend lacks native compaction or usage metadata: capability is unavailable/partial, safe handoff remains possible, no fake metrics shown | 003, 019, 046–047, 094–097, 119 |
| CIE-AT-22 | Performance under large historical archive: history renders virtually/quickly, retrieval remains scoped, and background indexing yields to active workload | 079, 102–106, 114 |
| CIE-AT-23 | Notes, documents, chat branches, and task evidence are relevant: selected, permissioned subset forms a compact multi-source package with citations | 014–027, 067–075 |
| CIE-AT-24 | Repeated summary-of-summary chain drifts: coverage audit detects missing requirement, reconstructs from canonical source, or blocks unsafe continuation | 042–049 |
| CIE-AT-25 | Task completion report says "implemented" but tests not run: checkpoint and handoff preserve verification status instead of claiming success | 052–058 |
| CIE-AT-26 | Context Inspector is navigable without animations and can explain omissions with keyboard and text-only access | 102–108 |

### 18.1 Quality gates and measurements

**AW-CIE-121 — Evidence-based readiness.** Every acceptance claim MUST cite implemented behavior and reproducible test or review evidence, not a plan, screenshot, or model self-report alone.

**AW-CIE-122 — Baseline comparison.** Context optimization experiments MUST compare against a meaningful baseline under identical task conditions where practicable; report dataset characteristics, model settings, source availability, and variance.

**AW-CIE-123 — Correctness gate.** A strategy MUST fail acceptance if it materially increases missing hard constraints, wrong-source assertions, privacy leakage, unjustified conclusions, or unrecoverable context loss, even if token use decreases.

**AW-CIE-124 — Robustness gate.** Tests MUST include incomplete data, contradictions, permission revocation, provider outages, large archives, concurrent updates, long chats, malformed summaries, and adversarial retrieved instructions.

**AW-CIE-125 — User-experience gate.** Users MUST be able to understand and control context behavior without repeatedly navigating advanced settings or reading internal execution logs.

---

## 19. Cross-charter ownership and dependencies

| Adjacent charter | Owns | CIE integration responsibility |
|---|---|---|
| 00 Constitution | Highest-level invariants | Implement AW-CON-051–056 without weakening other rules |
| 01 Experience | Visual interactions, selection and command surfaces | Supply context/manifest operations for selected resources |
| 02 Liquid Intelligence | Render, motion, materials, meaningful state animation | Supply truthful semantic memory/compaction states |
| 03 Projects/Resources | Canonical resource IDs, relationships, settings and association | Resolve authorized resource references and inheritance |
| 04 Conversations/Branches | Messages, chat history, ancestry, sharing modes, adoption semantics | Discover, retrieve, include, and explain relevant branch material |
| 05 Agents/Tasks | Task/execution lifecycle, assignments, completion criteria | Package persistent task handoffs and scoped agent context |
| 06 Vela | Presence, awareness tiers, initiative, attention, personalization | Give Vela bounded, authorized, inspectable context |
| 07 Notes/Knowledge | Note authoring, knowledge authority, human Thought Stream | Retrieve and transform typed knowledge without promotion |
| 09 Intelligence Streams | Event types, causal links, audit history, observability | Publish attributable CIE events and gap indicators |
| 10 Execution Profiler | Accurate token/time metrics, budget display, quality analytics | Consume verified telemetry for efficiency policy |
| 11 Timelines/Replay | Historical/planning timelines, replay | Provide source/compaction milestones, not fabricated model thoughts |
| 12 Codex Integration | Supported provider APIs, model/thread capabilities | Capability-gate execution-context and provider compaction behavior |
| 13 Platform | Resource, display, offline, performance limits | Yield indexing/analysis workload and minimize overhead |
| 14 Trust | Authorization, retention, confidentiality, deletion | Enforce every boundary prior to retrieval/caching/sharing |
| 15 Quality | Acceptance policy and test processes | Provide repeatable context integrity and efficiency evidence |
| 16 Delivery | Architecture decisions, migrations, engineering changes | Track provenance of changes to CIE policies/interfaces |

**AW-CIE-126 — Single authoritative home.** This charter is authoritative for CIE context policy, but MUST reference rather than copy or reinterpret another domain's governing ownership.

**AW-CIE-127 — Cross-domain compatibility.** A new context adapter, checkpoint format, memory policy, or sharing mechanism MUST identify affected charters and maintain compatible interfaces or document a migration.

---

## 20. Constitutional traceability

| Constitutional anchor | Specialized coverage |
|---|---|
| AW-CON-004–006 | 002–004, 014–020, 117–120 |
| AW-CON-026–028, 031–035 | 014–031, 059–072, 089–094 |
| AW-CON-037–041 | 028–031, 067–072, 089–094 |
| **AW-CON-051 Relevance before volume** | 014–027, 073–080, 089–094 |
| **AW-CON-052 Adaptive decay** | 032–039, 040–050, 102–105 |
| **AW-CON-053 Canonical history** | 006–011, 035–050, 051–058, 109–113 |
| **AW-CON-054 Context inspection** | 015–016, 027, 036–037, 102–108 |
| **AW-CON-055 Quantified efficiency** | 005, 095–101, 121–125 |
| **AW-CON-056 Tool output restraint** | 081–088, 115 |
| AW-CON-062–065 | 095–101, 107, 121–123 |
| AW-CON-069–073 | 007–013, 060–066, 073–078, 109–116 |
| AW-CON-080–083 | 001–013, 117–127 |

---

## 21. Open research decisions (not pre-decided requirements)

Implementation teams MUST research and record architecture decisions for:

1. Native provider compaction coverage, inspection limits, and portable continuation behavior.
2. Context package formatting across Codex and possible additional provider backends.
3. Ranking algorithms, calibration, supervised vs deterministic policy, explainability, and evaluation corpora.
4. Local-first full-text, semantic, and relationship search; optional embeddings and rerankers.
5. Fidelity/latency/cost tradeoffs of age-based decay and milestone checkpoint strategies.
6. Summary provenance and protected-constraint extraction reliability.
7. Token estimation across models, cached input accounting, provider-reported context occupancy.
8. Enforcement possibilities for token budgets and admission control versus unavoidable overshoot.
9. Privacy-preserving derived indexes, secure deletion, encryption, and cross-device sync if supported.
10. Consistency control for task checkpoints and multi-agent cross-branch updates.
11. Efficient large-log capture, paging, and retrieval without claiming access to provider-internal tools.
12. User-centered visuals for decay and source manifests with reduced-motion alternatives.
13. Coverage metrics for partial archives, disconnected providers, stale information, and source revisions.
14. Measurable, reproducible comparison of task success and total rework under CIE interventions.
15. Appropriate caching windows, indexing schedules, and background resource ceilings.

These decisions SHOULD be maintained as approved architecture decision records and implementation specifications, not silently embedded as irreversible charter assumptions.

---

## 22. Change control, publication, and ratification

This is an **owner-ratified governing charter (2026-11-05)**. These are accepted product obligations, not claims that CIE is fully implemented, that any API is enabled, or that testing/release acceptance has passed.

- The Constitution remains supreme; the repository owner decides ratification and amendments.
- Stable AW-CIE identifiers MUST retain their meaning; substantive changes require impact analysis and documented amendment.
- Changes affecting chat continuity, note authority, cross-branch consent, telemetry, privacy, security, or provider assumptions MUST be reviewed with the owning charter.
- Implementations MUST NOT quietly narrow the behavior specified here for schedule, framework convenience, or model limits; stage support transparently and preserve the full target.
- The governance registry MUST reflect actual publication, version, and acceptance status; publication alone is not ratification.
- Public repository changes MUST remain free of private conversation content, credentials, confidential notes, or sensitive derived indexes.

### Owner acceptance checklist

- [ ] Historic context can become smaller without erasing preserved authorized sources.
- [ ] Critical old decisions and task constraints survive relevance-based decay.
- [ ] Scope and permission checks precede ranking, caching, and model insertion.
- [ ] Compaction carries provenance, explicit uncertainty, and safe fallback.
- [ ] Branches remain independently conversational yet selectively knowledge-connected.
- [ ] Notes retain epistemic type rather than automatically becoming instructions.
- [ ] Handoffs preserve verifiable work state, conflicts, dependencies, and next steps.
- [ ] Tool-output optimization protects critical evidence and respects observability limits.
- [ ] Context Inspector makes inclusion, omission, memory decay, and rehydration intelligible.
- [ ] Token savings are measured against quality, latency, and rework.
- [ ] Automatic behavior is configurable, auditable, and reversible where possible.
- [ ] Staged implementation does not pretend to provide unsupported provider features.

---

## Charter completion statement

**CIE succeeds when the user can continue a conversation or project for years without carrying all of its history in every request, while retaining trustworthy access to what matters, accurate knowledge of what was actually supplied, and the ability to recover authorized source context when needed.**

**Remember where to find the truth. Retrieve the truth when relevant. Preserve its provenance. Spend context only when it earns its place.**

---

## Ratified amendment CF-2026-11-05: persistent context across adaptive models and agents
> **OWNER-RATIFIED 2026-11-05.** CIE remains the owner of contextual memory; provider sessions are subordinate.

**AW-CIE-128 — Independent memory authority.** Durable user preferences, episodic facts, project knowledge, task checkpoints and provenance MUST survive model, Responses, Codex, voice and managed-agent session changes.
**AW-CIE-129 — Typed provenance.** Every consequential remembered fact MUST distinguish direct source, observation, summary, inference, user preference, time validity and confidentiality scope.
**AW-CIE-130 — Retrieval relevance.** CIE MUST prefer current relevant project/workspace requirements and conversation ancestry over indiscriminate loading; one-million-token context does not justify private-data spill.
**AW-CIE-131 — Handoff capsules.** Agent/provider transfers MUST use bounded purpose-specific capsules containing authorized objective, factual evidence, verified prior actions, constraints, unresolved questions and source references.
**AW-CIE-132 — Compaction safeguards.** Provider compaction or cache summaries MUST NOT erase canonical effect receipts, uncertain outcomes, outstanding approvals, relevant conflicts or data-deletion obligations.
**AW-CIE-133 — Revocation propagation.** Deleted/revoked sources MUST be invalidated in local semantic indexes and eligible provider stores, or their deletion limitations truthfully disclosed; stale embeddings cannot be presented as current.
**AW-CIE-134 — Temporal state hygiene.** CPU/RAM readings, tool health and selected windows MUST carry refresh/expiry limits and MUST NOT become permanent user memories without purpose.
**AW-CIE-135 — Fidelity over token economy.** Retrieval/compaction SHOULD be optimized for cost and relevance only after demonstrating task quality, factual integrity, privacy and correct attribution.
**AW-CIE-136 — Conflict presentation.** Disagreeing sources MUST retain provenance rather than being flattened into a single authoritative-seeming statement; consequential work SHOULD reverify.

**Acceptance:** Cross-provider recall after restart, evidence-preserving compaction, deleted source invalidation and isolation between unrelated workspaces.

---

## Owner-ratified amendment UM-2026-11-05: unified memory lifecycle, durable task cognition and real recall

> **Ratified requirement baseline (2026-11-05).** The companion [Unified Memory and Context Runtime](../docs/architecture/VELA-UNIFIED-MEMORY-AND-CONTEXT-RUNTIME.md) supplies implementation-neutral contracts and verification journeys. This amendment is normative. It clarifies, rather than overrides, AW-CIE-001–136.

**AW-CIE-137 — Unified CIE, distributed source ownership.** CIE MUST serve as one retrieval, memory-policy and context-assembly coordinator, using versioned references to the canonical conversation, project, note, task, event and personal-context owners. A derived memory copy MUST NOT silently displace an authoritative record.

**AW-CIE-138 — Automatic memory candidate formation.** When a user-authorized memory-extraction policy enables it, Vela MUST be able to identify potentially valuable preferences, decisions, constraints, discoveries, corrections, recurring patterns and open task dependencies from eligible activity. A candidate MUST retain source and confidence and MUST NOT be automatically represented as a verified or permanently approved fact.

**AW-CIE-139 — Policy and sensitivity before formation.** Automatic learning MUST respect distinct policies for personal facts, project/task context, ordinary conversation, Vela conversation, sensitive categories, cross-provider disclosure, and background observation. Sensitive or consequential inferred personal facts MUST NOT be promoted to durable personal memory without appropriate user approval.

**AW-CIE-140 — Distinct memory lifecycle stages.** Observation, eligibility, candidate creation, review, approval, retention, indexing, retrieval, attachment, provider disclosure, use, correction, supersession and deletion MUST be distinct states with auditable provenance where applicable. Completing an earlier stage MUST NOT imply a later one occurred.

**AW-CIE-141 — Source and uncertainty semantics.** Memory entries MUST retain canonical source owner/ID, source version or snapshot, observed time, validity interval where relevant, evidence class, scope, transformation lineage, confidentiality and effective policy version. Repetition of a model-generated assertion MUST NOT upgrade it into independently verified truth.

**AW-CIE-142 — Tiered operational versus enduring memory.** Transient measurements, current UI state, location, device diagnostics, provider health and other time-sensitive operational facts MUST have explicit expiry/freshness semantics, and MUST NOT be treated as enduring user preferences by default.

**AW-CIE-143 — Mandatory task working memory.** Nontrivial durable tasks MUST have a provider-neutral checkpoint structure containing objective, constraints, acceptance criteria, plan/dependency revisions, pending approvals, known uncertain effects, verified outputs, blockers, source revisions and next safe actions. A conversation recap alone is insufficient.

**AW-CIE-144 — Multi-agent checkpoint isolation.** Parallel agents MUST use scoped task-memory reads and versioned writes. Concurrent conflicting findings MUST be preserved and reconciled explicitly rather than overwritten last-writer-wins. Sharing task memory MUST NOT share permissions or unrelated private context.

**AW-CIE-145 — Cross-provider context capsules.** Vela MUST preserve approved identity and meaningful task continuity across ordinary chats, Responses, Codex, voice and supported agent providers through purpose-specific scoped capsules. Backend session identifiers, hidden reasoning and provider retention MUST NOT become canonical memory authority.

**AW-CIE-146 — Safe resume semantics.** On restart, reconnect or provider handoff, CIE MUST revalidate source freshness, current scope, permissions, project/repository versions, pending effects and relevant checkpoints. An uncertain non-idempotent effect MUST NOT be replayed simply because a previous session was interrupted.

**AW-CIE-147 — Hybrid retrieval and authoritative expansion.** CIE MUST support exact ID/source retrieval and suitable full-text/relationship discovery, while permitting optional semantic indexing where measured helpful. Material claims SHOULD be verified against current authorized canonical sources before consequential actions. Embedding similarity alone MUST NOT confer authority or access.

**AW-CIE-148 — Just-in-time memory with protected anchors.** The request composer MUST prioritize user-selected context, task goals, binding constraints, verified checkpoints, relevant current knowledge and explicit conversational ancestry. It MUST disclose significant omissions or stale coverage instead of silently dropping requirements to fit a token budget.

**AW-CIE-149 — Inspectable memory use.** A Context Inspector MUST permit authorized users to inspect whether a fact is saved, indexed, discovered, included or actually disclosed to a provider; it SHOULD explain relevance and omissions, distinguish confidence/authority, and support navigation to permitted original sources.

**AW-CIE-150 — Correction propagation and disputed claims.** Corrections, explicit invalidations, competing sources and supersession MUST update future eligible retrieval without rewriting original history. Unresolved contradictions MUST remain separately attributable until a supported resolution exists.

**AW-CIE-151 — Revocation fan-out and limitations.** Removal or revocation of a canonical source MUST invalidate eligible local indexes, derived summaries, cached context and future attachment. Supported provider-side retention/deletion controls MUST be applied where authorized, with truthful disclosure of unrecoverable copies, backups, prior exports and unavailable remote deletion.

**AW-CIE-152 — Reasonable memory resource use.** Memory extraction and indexing MUST have workload-aware admission, latency/resource budgets and suspendable background operation. Reduced GPU/CPU quality levels and disconnected semantic services MUST NOT erase canonical memory or block basic eligible source retrieval.

**AW-CIE-153 — No private-reasoning fiction.** Vela MUST NOT claim memory of hidden chain-of-thought, unobserved cognitive steps or inaccessible provider history. Model summaries MUST be marked as transformations, not eyewitness records or verbatim source copies.

**AW-CIE-154 — Provenance-bound prompt delivery.** Context manifests MUST be bound to request, policy version, principal, scope, destination provider, selected sources and content digest; authorization is rechecked immediately before disclosure. Model-produced text and imported documents remain untrusted data and MUST NOT impersonate higher-priority instructions.

**AW-CIE-155 — Measured capability-first optimization.** Context and memory efficiency claims MUST compare equivalent held-out objectives using verified outcome quality, retrieval accuracy, privacy isolation, rework, latency and provider-reported cost where available. Shorter prompts and greener dashboards are not sufficient evidence.

**AW-CIE-156 — Native integration instead of isolated islands.** The existing Personal Context & Identity Engine, Vela bounded history, mission journal, connected conversations and governance retrieval MUST integrate through existing source-owner interfaces. No parallel hidden memory database, second authorization policy, or alternate Vela identity may be introduced merely to simplify implementation.

**AW-CIE-157 — User control without excessive ceremony.** Users MUST be able to review, edit, correct, reject, revoke and appropriately export/delete memory through coherent controls. Configurable automatic learning can reduce repeated manual instructions, but MUST remain transparent and never silently broaden collection or disclosure.

### Mandatory memory acceptance (owner-approved requirements, not claimed test results)

- **UM-01–UM-03:** approved memory survives restart; enabled extraction creates reviewable sourced candidates; opt-out prevents disallowed collection/disclosure.
- **UM-04–UM-06:** correct recall across branches/providers with source links, project isolation, and CAS-safe concurrent agent findings.
- **UM-07–UM-10:** interruption/recovery never replays unknown effects; compaction retains constraints; corrections and transient-fact expiry are respected.
- **UM-11–UM-15:** semantic outage fallback, injection isolation, branch permission denial, deletion propagation and held-out recall/quality/performance comparison.

**Cross-charter ownership:** 04 keeps branch identity and source history; 05 owns authoritative task state; 06 owns Vela behavior and initiative; 07 owns authored knowledge and approval; 09 owns observations and event records; 10 owns real usage accounting; 12 owns provider capabilities; 14 owns permission and data policy; 15 owns independent acceptance. See the [runtime architecture](../docs/architecture/VELA-UNIFIED-MEMORY-AND-CONTEXT-RUNTIME.md).
