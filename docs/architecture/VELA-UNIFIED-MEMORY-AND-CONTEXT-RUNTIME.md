# Vela Unified Memory and Context Runtime
**Aetherwake architecture contract · UMCR-01 · Owner-accepted design direction · 2026-11-05**

> **Authority:** This document is an implementation architecture subordinate to Constitution 00 and Charters 03, 04, 05, 06, 07, 08, 09, 10, 12, 14, 15, and 16. It does not establish a second memory governance authority. Charter 08 owns retrieval and contextual memory behavior; Charter 07 owns knowledge authority; Charter 04 owns conversation ancestry; Charter 05 owns tasks and agents; Charter 09 owns observed event evidence; Charter 14 owns policy; source systems own canonical data.
>
> **Status:** Owner accepts the design objectives. Acceptance does not mean the runtime described here is implemented, qualified, or ready for production. Requirements are measured through real evidence rather than source-file existence.

## 1. Purpose and nonnegotiable outcomes

Vela must maintain usable, accurate, appropriately scoped continuity across conversations, connected branches, projects, workspaces, provider/model transitions, voice sessions, multi-agent execution, application restarts and long periods of inactivity. A model's immediate context window is never the canonical source of memory. Memory must enable **complete, verified outcomes** while reducing unnecessary context work; saving tokens is secondary to correctness, privacy and competence.

The system must:
1. Preserve identity and authorized history without requiring indefinitely expanding prompts or a permanently running model.
2. Automatically notice potentially useful information **subject to explicit configurable memory policy**, without silently converting speculative inference into accepted facts or collecting sensitive material without authorization.
3. Retrieve relevant evidence, constraints and task state just in time with provenance, freshness and omission disclosures.
4. Sustain durable, concurrent task checkpoints and safe provider-neutral handoffs.
5. Correct, revoke, supersede and delete derived memory according to source-owner and privacy policies; never imply physical erasure where unavailable.
6. Support direct explanation of what Vela currently used, why, where it came from and what she could not access.
7. Degrade honestly and continue safely when indexes, providers, encryption, storage, or sources fail.

## 2. Canonical ownership and integration boundaries

**There is one Context Intelligence Engine, not one competing fact store for each agent.** Ownership is distributed: the conversation product owns transcript identity/lineage; workspace kernel owns resources and projects; Notes/Knowledge owns authored content and acceptance status; Mission Service owns authoritative plans, execution attempts and task states; Intelligence Stream owns source-backed events and observations; Personal Context & Identity Engine owns specifically user-approved personalization records under its protected host; CIE owns **derived memory projections, candidate extraction workflows, retrieval/indexes, context manifests, compaction products, and provider-neutral context transfer**.

CIE may store references, normalized read models and versioned memory artifacts. It MUST NOT rewrite or duplicate authoritative source objects as though its own copy were the canonical truth. The Capability Runtime must request scoped context through CIE, never reverse ownership by inserting arbitrary model output directly into the user-memory store.

Existing reusable components:
- `prototypes/personal-context/src/service.mts`: owner-reviewed opt-in facts, encrypted revisions and source/correction fences; currently isolated from the native host.
- `prototypes/vela-core/src/mission-context.mts`, `bounded-history.mts`, `history-retrieval.mts`: bounded contextual assembly and lineage controls.
- `prototypes/integrated-backend/src/mission-service.mts`: durable task plans, attempts, scheduling and recovery.
- `prototypes/conversation-product/src/service.mts`: canonical conversation discovery and connection relationships.
- `scripts/governance-context.mjs`: domain-scoped normative context selection, **not** a full private-memory engine.
- `prototypes/openai-provider/responses.mts`: transport, provider turns, limited continuation and explicit retention options.

Integration requires adapters on their existing canonical host boundaries. Do not create a parallel SQLite file, second execution journal or alternate approval policy to implement memory.

## 3. Memory ontology and scopes

Maintain distinct semantic classes with stable `memory_id`, `source_ref`, and `revision`:
- **Episodic event:** something actually said/done/observed at a specific time; source and outcome class retained.
- **User-authored preference or instruction:** owner-provided enduring preference with validity/scope and user-editable status.
- **Extracted candidate:** potentially useful information proposed from conversation or task content; *not automatically a verified fact*.
- **Knowledge claim:** source-linked statement with epistemic class `observed | reported | inferred | disputed | verified | superseded | unavailable`.
- **Decision/constraint:** explicit project choice or hard instruction; has actor, scope, priority and source proof.
- **Task working memory:** current goal, plan version, active dependencies, blockers, approvals, evidence, unresolved questions and next safe actions.
- **Checkpoint:** an immutable, source-referenced snapshot of task state for resuming and coordinating.
- **Context package:** the exact authorized subset supplied to one specific provider/model/tool turn, with its purpose and omission record.
- **Index/cache:** disposable derived retrieval optimization, not authority or a retention guarantee.
- **Transient operational observation:** current RAM/CPU, active window, tool health, position or provider capability; expiry/freshness required, never elevated into long-lived personal memory without a legitimate purpose and policy.

Scopes are explicit and composable: `user`, `project`, `workspace`, `conversation`, `branch-family`, `task`, `agent`, `session`, `selected-resource` and `global-governance`. Cross-scope retrieval must pass an authorization check at query time *and again before provider dispatch*. A relationship, embedding similarity, branch membership or instruction in retrieved text never grants access.

## 4. Memory lifecycle

```text
Authorized source/change event
   -> bounded eligibility and classification
   -> optional extraction proposal / provenance links
   -> policy+consent gate
   -> candidate (reviewable)
   -> approved/restricted/temporary activation
   -> versioned index + relevant retrieval
   -> use manifest + post-use evidence feedback
   -> correction / supersession / dispute / expiry
   -> revoke / delete + derived-index invalidation
```

Always preserve the distinction between **noticing**, **retaining**, **indexing**, **retrieving**, **attaching**, **sending to a provider**, and **verifying a resulting action**. None implies a later stage occurred.

Automatic candidate extraction should be enabled only within a clearly explained opt-in policy, with separate controls for ordinary chat, Vela, workspace/project knowledge, sensitive categories and cross-provider disclosure. User confirmation is required to promote sensitive or consequential inferred claims into enduring personal facts; project execution may maintain ephemeral working memory under existing task authorization. Existing explicitly saved user facts remain under their original permissions. Prefer bounded event-triggered extraction at conversation/task milestones over continuously recording every utterance.

Candidate classification must consider salience, recurrence, owner emphasis, explicit commands, task dependency, confidence, privacy and recoverability; a high salience score cannot bypass permission. Repeated copies of one model guess are not independent evidence. Candidates have expiry/retention policy, dedupe lineage and review/correction surfaces.

## 5. Minimal typed persistence contracts

Implementation may adapt the names to existing SQL contracts, but these guarantees are mandatory:

```ts
type MemorySource = {
  ownerDomain: 'conversation'|'resource'|'knowledge'|'mission'|'event'|'personal-context'|'governance';
  ownerId: string; ownerRevision: string; locator?: string;
  observedAt: string; sourceHash?: string; evidenceClass: string;
};
type MemoryProjection = {
  memoryId: string; revision: number; semanticType: string; lifecycle: string;
  scope: {principalId:string; projectId?:string; workspaceId?:string; conversationId?:string; taskId?:string};
  sources: MemorySource[]; createdAt: string; validity?:{from?:string;until?:string};
  sensitivity: string; policyVersion:string; confidence?:number;
  supersedes?:string[]; conflictWith?:string[]; retentionRef:string;
};
type ContextManifest = {
  packageId:string; requestId:string; taskId?:string; purpose:string;
  principalId:string; providerId:string; model?:string; policyVersion:string;
  included: Array<{memoryId:string; revision:number; sourceDigest:string; evidenceClass:string; reason:string}>;
  omitted: Array<{category:string;count:number;reason:string}>;
  sourceSnapshotDigest:string; assembledAt:string; expiresAt:string;
  approvedDisclosureRef?:string; contentDigest:string;
};
type TaskCheckpoint = {
  checkpointId:string; taskId:string; taskRevision:number; createdAt:string;
  objective:string; constraints:string[]; dependencies:string[];
  completedEvidenceIds:string[]; blocked:string[]; uncertain:string[];
  pendingApprovals:string[]; outstandingEffects:string[];
  nextSafeActions:string[]; providerBindings:string[]; sourceRevisions:Record<string,string>;
  parentCheckpoints:string[]; authorAttemptId:string; integrityDigest:string;
};
```

Never treat a digest as proof of factual accuracy; it proves only byte-level binding. Store sensitive bodies using the existing native protected-storage arrangement; do not serialize them into telemetry, public CI logs or the renderer. Use transactional updates, idempotency keys and optimistic version checks, with an outbox for asynchronous index invalidation.

## 6. Context Intelligence Engine retrieval pipeline

1. **Resolve intent:** exact resource/user selection, current task objective, provider, action effect and requested answer depth.
2. **Resolve current authority:** principal, project/workspace, conversation branch, agent delegation, user memory policy, provider disclosure settings.
3. **Anchor:** retrieve pinned constraints, latest verified task checkpoint, current source versions and critical acceptance criteria.
4. **Discover:** exact IDs, relationship traversal, lexical/FTS results, relevant prior checkpoints, optional semantic candidates and recent applicable events. The semantic index is advisory and may be stale.
5. **Rank:** use intent relevance, source authority, importance, freshness, uncertainty, uniqueness, causal relationship and retrieval cost. Protect governing and user-accepted constraints from pruning.
6. **Expand:** fetch actual authorized canonical source passages when claims matter; compare conflicts and source revisions, do not rely solely on embedding or summary snippets.
7. **Compose:** produce a bounded, provider-neutral typed manifest that exposes included/omitted evidence, protected constraints, context coverage and approximate/observed token economics.
8. **Authorize disclosure:** recheck source access, data classification, policy version and destination-specific allowed content immediately before transport.
9. **Record:** bind manifest digest and provider request/response IDs to one canonical execution; record no secret contents in the stream.
10. **Update:** incorporate confirmed outcomes, corrections, new candidate discoveries and task checkpoints through owning services.

Use hybrid search only if source-controlled evaluation shows incremental recall benefit. Exact identifiers and version checks must always be available without a semantic model or embedding network. A failed vector backend must not prevent eligible exact-source retrieval.

## 7. Durable task working memory and concurrent agents

Every nontrivial agent run operates on a **task-owned** working-memory manifest, not a hidden chat-context copy. Create checkpoints at accepted plan revisions, external-effect boundaries, completed verification phases, controlled handoffs, material blockers and graceful interruption. Capture evidence IDs, never fabricated private thoughts or arbitrary narrative substitutes.

Concurrent subagents may read only the sources and capabilities delegated to them. Their findings are source-labeled proposals; they do not automatically update project requirements, global preferences or an unrelated sibling agent's context. Updates use versioned compare-and-swap on task state. Conflicts retain both candidate findings plus causal references; the task coordinator explicitly resolves or requests review. Shared context is **selected and purposeful**, not full transcript fan-out.

On restart: load durable task/effect journal, restore the last valid checkpoint, query the current permission and provider state, reconcile uncertain external operations using original IDs, refresh potentially stale sources, and propose the next safe action. Never replay an unknown non-idempotent effect on the assumption that its previous process died.

## 8. Provider and model independence

Vela remains one application identity across Responses, Codex, ordinary chat, voice and future approved agents. Provider sessions are replaceable execution contexts. Context capsules transfer the minimum relevant authorized objectives, constraints, task evidence, active source pointers and unresolved decisions; they do not impersonate provider-native history that cannot actually be accessed.

Where a provider supports prompt caching, compaction or server-side retention, CIE may use it as a *performance optimization* after capability and privacy qualification. Provider-side data controls and retrieval limitations must be reported. Provider changes may require reauthorization of sensitive data transfer; model routing cannot silently widen disclosure.

## 9. Memory correction, aging, erasure and source authority

- An important explicit user correction supersedes eligible older projections and creates a traceable new version.
- Contradictions remain separately attributable until a verified resolution or user decision.
- Recency changes retrieval priority, never deletes canonical historical evidence by itself.
- Expired transient device state is excluded from current factual answers unless refreshed.
- Revoking a source invalidates derived indexes, cached context packages and future use where enforceable; remote deletion failures/limits must be disclosed.
- No claim of secure physical erasure from SQLite free pages, backups, provider copies or exports without actual mechanism/evidence.
- User-facing inspector shows what Vela knows as confirmed/reported/inferred and what is only potentially retrievable, not what the model currently has loaded.

## 10. Privacy and user-control design

Controls must distinguish: local storage, automatic candidate creation, project knowledge inclusion, personal preference learning, provider disclosure, branch-family sharing and background suggestion. Provide review, edit, reject, correct, revoke, export and eligible delete operations for derived memory. A low-friction project working memory mode must not quietly authorize generalized personal surveillance. Sensitive categories require appropriate extra approval. No retrieval bypass through embeddings, cached relevance scores, imported content, cross-agent notes or connected branches.

## 11. Observability and Context Inspector

For every provider-assisted turn, the Inspector may show context categories, scope, record count, included source links, snapshot age, omitted/blocked categories, estimated input budget, actual provider usage if reported, and uncertainty. It must not expose unauthorized note bodies, private model reasoning or sensitive material through GPU animations, logs or notifications. A source-backed memory contribution may be navigated from an Intelligence Stream event without granting broader source access.

## 12. Performance, cost and failure containment

Measure context preparation latency, exact/semantic recall, permission-filter rejection, source expansion bytes, provider-reported tokens/cached input where available, verified task success and rework. Favor demand-based retrieval and small task-specific memory capsules. Avoid unrestricted background embeddings on a laptop under load; use bounded queues, pause on gaming/foreground contention, expose indexing progress and preserve battery/thermal budgets. Never trade away hard constraints or reliable recall merely to meet a token ceiling.

Error cases include unavailable encryption, corrupt index, stale cache, missing provider history, conflicting checkpoint writers, ACL revocation during retrieval, interrupted compaction, device clock skew and failed provider disclosure. Continue with an honest partial answer when safe; otherwise stop the affected effect while preserving existing canonical history.

## 13. Mandatory acceptance matrix

| ID | Journey | Pass criteria |
|---|---|---|
| UM-01 | Save a user-approved preference | Remains correct and source-linked after restart; change/revoke works |
| UM-02 | Automatic candidate with opt-in enabled | Candidate review, source trace, suppression and separate approval evidenced; no implicit sensitive promotion |
| UM-03 | Opt-out / privacy revocation | No candidate generation or provider disclosure beyond authorized policy; derived indexes invalidated |
| UM-04 | Project decision across branch forks | Correct relevant discovery, source and revision; unrelated projects isolated |
| UM-05 | Vela API to Codex to API | Same task identity, bounded capsule, stable constraints and original verification links |
| UM-06 | Two concurrent specialists | No last-writer-wins evidence loss; conflicts visible; source permissions unchanged |
| UM-07 | Crash mid-external effect | Original attempt remains uncertain until reconciliation; no automatic duplicate write |
| UM-08 | Long mission and compaction | Acceptance criteria, blockers and next safe actions preserved, rehydration linked to sources |
| UM-09 | Contradictory user corrections | New current fact selected, old source retained under policy, prior claims not silently erased |
| UM-10 | Stale operational facts | Old CPU/RAM/window/tool status never presented as current after expiry |
| UM-11 | Semantic index unavailable | Exact/source-based retrieval still works with partial-coverage disclosure |
| UM-12 | Prompt injection in memory source | Imported instructions remain untrusted data, never privilege escalation |
| UM-13 | Unauthorized sibling branch | Zero private content included, attached or leaked through summaries and notifications |
| UM-14 | Deletion after provider use | Future local retrieval blocked, supported remote controls invoked, limitations honestly stated |
| UM-15 | Held-out memory benchmark | Report recall precision, retrieval latency, privacy false positives and verified outcome quality against no-memory baseline |

Acceptance evidence must name exact candidate commit, runtime version, source revisions, provider/account scope when relevant, policies and environment; use synthetic safe fixtures in the public repository, keeping private human/provider receipts in protected storage.

## 14. Delivery architecture and migration

**M0: Contract/owner reconciliation.** Ratify Charter 08 addenda; verify explicit owner acceptance of the wider charter set; settle authority diagrams, policies, aliases and requirement IDs. Keep migration reversible.
**M1: Host integration.** Wire Personal Context service to existing protected native host, governed memory settings, source-owner identities and scoped provider requests.
**M2: Task memory.** Durable checkpoint store/readback, context manifests, policy revalidation, crash recovery and two-worker consistency.
**M3: Hybrid retrieval.** Exact source, FTS and relationship first; optional embeddings behind measured relevance/privacy gate.
**M4: User experience.** Context Inspector, candidate review and correction, scope visibility, and cross-branch source navigation.
**M5: Optimization.** Compaction audits, caching, budget controls and load-sensitive indexing validated by held-out task outcomes.
**M6: Full acceptance.** Windows native, real provider, multi-agent, restart/interrupt, UI, security and performance journeys. No completion claim before evidence.

**Invariants:** Source truth stays with source owners. Vela's enduring identity is app-owned. Context sent to a model is purpose-bound and inspectable. Memory is never an excuse to overcollect. Recoverability is not permission to replay. **Capability first; verified accuracy and privacy before token economy.**

## 15. Owner-directed extension: semantic retrieval, storage, and coherent experience (2026-11-05)

The existing retrieval pipeline in Section 6 remains normative. The new [CIE Semantic Interpretation and Evidence Retrieval specification](../specifications/CIE-SEMANTIC-INTERPRETATION-AND-EVIDENCE-RETRIEVAL.md) describes an **optional, qualified model-assisted interpreter** that compiles ambiguous user intent into typed evidence requirements. Its output is a *proposal*, never an authority-bearing source selector, provider permission, task planner, memory write or execution command. Use the host's selected resources and exact identifiers first. Use semantic interpretation/evaluation where it improves verified retrieval on held-out evidence.

The CIE host must distinguish query interpretation from candidate discovery, source expansion, evidence sufficiency, context manifest assembly, provider disclosure, and actual task completion. A source passage that contains related words is not necessarily a sufficient answer; the evaluator may request bounded additional evidence and must expose unresolved contradictions or missing current authority. The interpreter API call itself requires an approved provider-disclosure path.

[Local-first Storage and Continuity](AERYNTH-LOCAL-FIRST-STORAGE-AND-CONTINUITY.md) defines the proposal for one canonical storage foundation, protected large objects, optional rebuildable FTS/semantic indexes, source-version invalidation and a shared source-backed application-state projection. It does not replace canonical owner services or require a new database server. Vela, workspaces, missions, agent cards, timelines, Streams and GPU presentations should reflect the **same** identities, revisions and verified causal events, never competing UI facts or model-invented completion state.

[ADR-002](../decisions/ADR-002-ARCHITECTURE-RECOVERY-AND-COHESIVE-RUNTIME.md) establishes two delivery programs. Architecture Recovery now maps sources, consolidates existing code, fixes gates, benchmarks lexical retrieval and defines compatible context/storage contracts; future Full Realization implements and qualifies model-assisted retrieval, persistent learning, holistic visual adaptation and the broader accepted experience. Design acceptance, shadow proof and native production verification remain different statuses.

**Evidence extensions:** compare lexical/FTS/relationship/hybrid/model-assisted variants on unseen paraphrases, historical/current decision contrast, contradictory claims, expired observations, missing information and permission denial. Report critical-evidence recall, missing evidence, unsupported answers, privacy false positives, p95 latency, model cost and verified user-task outcome. The existing UM-01–UM-15 acceptance matrix remains active.
