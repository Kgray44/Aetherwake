# Aerynth Local-First Storage and Continuity Architecture
**Architecture STOR-CONT-01 · 2026-11-05 · Owner-directed design clarification · Not an implementation-complete claim**

> **Authority:** A supporting architecture beneath Constitution 00, Charters 03–09, 11–16, [UMCR-01](VELA-UNIFIED-MEMORY-AND-CONTEXT-RUNTIME.md), and the accepted capability runtime. It refines *storage and shared runtime continuity*, not the authority of Personal Context, conversations, workspace kernel, missions, governance or native trust. No new canonical database is authorized by this document.
>
> **Workstream split:** Current Architecture Recovery inventories, benchmarks, reconciles and safeguards existing storage; Full Realization later implements missing semantic memory, adaptive intelligence, unified projections and large-scale capabilities after tested architecture decisions.

## 1. Experience goal and engineering definition

The product must appear to the user as **one coherent, responsive spatial application with one enduring Vela**, even when many domain services, models, tools and agents participate. Internal sophistication should make ordinary operations seem simple, not impose visible workflows, duplicated state, inconsistent answers, lag or intrusive suggestions.

"Beautiful backend" means explicit ownership, small comprehensible contracts, traceable effects, measurable performance, predictable recovery, safe adaptation and a minimum of competing representations. It **does not** mean creating a large collection of ornamental abstractions or an unmeasured distributed microservice platform.

Canonical decisions:
1. Source truth has **one owner per record domain**. Derived context, embeddings, cached projections and UI animations cannot silently become authoritative.
2. CIE is the retrieval/context coordination plane; Vela is the identity/interaction plane; execution and permission remain the existing domain owners.
3. Store durable facts and indexed relationships; retrieve relevant context on demand; never use an indefinitely growing prompt or permanently active model as the primary memory.
4. Maintain one causally linked observable application state for frontend projections, without forcing all domains into one physical table or replacing domain event streams.
5. Use local-first persistence by default. Provider-side sessions, search indexes, caches and remote object stores are subordinate, qualified optimizations.

## 2. Logical information domains

| Domain | Authority and lifetime | Typical content |
|---|---|---|
| **Vela identity and stable behavior** | Owner-approved, versioned, protected configuration/governance | Name/role, interaction contract, approved voice/presence behavior, system-level boundaries |
| **Capabilities and provider catalog** | Runtime capability registry with observed version/expiry | Actually available models, tools, integrations, limits, consent, health, cost observations |
| **Explicit preferences** | Owner-approved Personal Context record, scoped and correctable | Display preference, coding habits, verbosity, project-specific conventions |
| **Inferred adaptation candidates** | Reviewable, non-authoritative derived state subject to opted-in AEE policy | Repeated layout patterns, preferred timing or workflow proposals |
| **Conversations and connected branches** | Conversation owner, exact ancestry/versions | Messages, citations, branch links, authorized history |
| **Projects/resources/knowledge** | Workspace and Notes/Knowledge owners | Files, blocks, accepted decisions, notes, resource edges |
| **Mission and task working state** | Mission Service owner, checkpoint/versioned causal graph | Plan versions, blockers, effect receipts, verified results, next safe steps |
| **Event history and observations** | Owning event/telemetry service with provenance and retention | State transitions, source change signals, user-visible activity |
| **CIE projections and indexes** | Rebuildable, source-linked context artifacts | Memory candidates, search postings, embeddings, request manifests, sourced summaries |
| **Transient operational state** | Native observation owner with strict freshness | CPU/RAM, window selection, provider availability; never permanent fact by default |

Separate **identity**, **approved user memory**, **inference**, **current UI state**, **task continuation** and **provider context**. Never collapse them into one mutable "persona blob"; never train a model on private user observations by default; never let retrieved untrusted text rewrite a privileged behavior contract.

## 3. Physical storage proposal and non-decisions

Retain the **existing canonical SQLite connection and source-owner schema** as the primary local metadata/transaction foundation. Domain tables, relational IDs, foreign keys, optimistic versions and bounded transactional updates provide the durable spine. Large source objects, documents, media, recordings and evidence should be represented through versioned, protected file/object references rather than copied wholesale into unrelated context tables.

This architecture does **not** mandate a new database server, vector database, event-sourcing rewrite or automatic WAL conversion. The prototype's hard size ceilings and JSON limits are implementation controls to inventory, not SQLite's intrinsic capacity. SQLite's [documented limits](https://www.sqlite.org/limits.html) are far above current prototype caps; real limits will be driven by host storage, schema, I/O and workload.

### Recommended physical responsibilities

- **SQLite metadata:** source owner IDs, revisions, relations, permissions/policy references, checkpoints, outbox/invalidation, summaries and search metadata.
- **Protected local object store:** large immutable or versioned payloads, content digests, compression where justified, hash-aligned references and garbage collection policy.
- **FTS5 index:** bounded, permission-aware lexical discovery against eligible canonical content; prefer external-content or other nonduplicating index layouts when they preserve content policy and index correctness.
- **Optional semantic index:** embeddings or vector search held as disposable *sensitive derivatives* with source version, scope, model version and revocation policy. Evaluate native extension/tool choice empirically rather than mandating `sqlite-vec` or a remote vector database.
- **Provider-session cache:** useful for continuation/cost only while allowed; never the sole copy of durable memory or task state.

Data may be partitioned physically only when benchmarks, security boundary or recovery behavior justify the complexity; logical separation of domains does not imply separate databases.

## 4. Retrieval and memory contract

CIE receives a typed context request from the current task/selection and host policy. For ambiguous meaning, a qualified semantic-interpreter role (initial candidate GPT-6 Luna via Structured Outputs) proposes evidence requirements. The host resolves actual allowed sources, combines exact, relational, full-text and optional semantic search, expands canonical passages, validates evidence coverage and composes a bounded context manifest. See [CIE-SER-01](../specifications/CIE-SEMANTIC-INTERPRETATION-AND-EVIDENCE-RETRIEVAL.md) for concrete contracts.

The memory system must support:
- **Find:** historical and current claims with exact source identity/ancestry.
- **Know:** distinguish user statements, observed events, summaries, inferences, corrections, unverified claims and actual accepted decisions.
- **Remember:** retain source-backed relevant durable facts within authorized scope.
- **Resume:** recover current task dependencies, effect receipts, known unknowns and verified outputs without replaying uncertain actions.
- **Forget/correct:** invalidate derived indexes and future disclosures according to source policy, while reporting backup/provider deletion limitations.
- **Adapt:** maintain reversible, scoped hypotheses with separate user controls and evidence; explicit choices outrank learned habits.

Semantic similarity is never proof, permission, acceptance, or a replacement for the source text.

## 5. One application state and frontend continuity

The frontend must be driven by **source-backed projections of canonical domain state**:

```text
User intent / verified system observation / authorized tool effect
                  |
          Typed command or event
                  |
          Canonical domain owner
       (transaction + revision + receipt)
                  |
        Projection / event adapter
                  |
     Shared application-state snapshot
           /       |        \
     Workspace   Vela     Stream/Timeline
           \       |        /
         One motion + visual state coordinator
```

The shared state snapshot is a projection, **not** a new database of competing truth. It carries stable resource/task IDs, per-domain revisions, causation/correlation IDs, event ordering, hydration status and explicit `loading | current | stale | unavailable | conflicted` states. Late events must not overwrite newer source versions.

A mission viewed from a conversation, agent card, timeline, intelligence stream, workspace or Vela presence must refer to **the same task identity and evidence**. A completed animation may not imply a completed external effect. The GPU/DOM presentation layer may interpolate appearance and motion but may not independently invent task transitions.

Navigation and state restoration must preserve user focus, selection, card geometry, spatial relationships, pending activity, and meaningful progress through startup, restart, provider handoff and scene transitions. UI intelligence should feel fluent through preassembled **authorized** context and context-aware affordances, not by speculative unrequested tool actions.

## 6. Persistence, transactions and concurrency

- Maintain one accountable write authority per canonical record. Across domains use typed adapters and explicit transaction ownership; no second write path through renderer or model output.
- Use expected version/CAS for conflicting durable writes; source deltas and asynchronous indexes use a transactional outbox or equivalent *measured* invalidation bridge.
- Background indexing must be bounded, priority-aware and cancelable; power, battery, gaming and foreground responsiveness take priority over idle semantic work.
- Consider [SQLite WAL](https://www.sqlite.org/wal.html) only after measuring readers, writers, checkpoint behavior, process model, crash scenarios and backup compatibility. SQLite still permits one WAL writer at a time; WAL is not a magical concurrency switch.
- Validate foreign keys/integrity, schema migrations, source/version reconciliation and storage quotas with repeatable tests. A failed migration must preserve retrievable prior data and report honest recovery state.

## 7. Recovery and retention

Every durable mission writes effect identity and checkpoints at meaningful boundaries. On restart, compare authoritative source revision and current permissions, reconcile side effects with original execution IDs, restore pending approvals, and do not retry unknown non-idempotent effects without evidence.

Backups must be transactionally consistent, protected and periodically **restored** in tests. The [SQLite Online Backup API](https://sqlite.org/backup.html) is a candidate mechanism, not a substitute for testing crypto keys, object-store references or recovery. Support staged/verified migration and rollback. Define explicit retention for raw source, derived projection, logs, embeddings, caches, deleted records and external-provider copies.

High-value project constraints and approved preferences are not forgotten simply because their use declines. Operational readings expire. Deleting a vector or clearing SQLite free pages does not prove a prior provider export or backup was erased.

## 8. Security and data flows

Treat all of the following as distinct permissions: observe, index, retain, infer, retrieve, attach to a context, disclose to a specific provider, adapt presentation, execute an effect and erase. A previous allowance for one stage does not imply permission for another.

Host ACL/source-owner verification occurs before indexing/retrieval and again before model disclosure. Source-derived caches inherit the source classification. Sensitive memory extraction must follow explicit per-category policies and review. Store cryptographic keys outside data files using qualified native protection and test loss, rotation, startup failures and backups.

Never log plaintext private prompts, source excerpts, credentials, embeddings, key material or provider content to public CI. A display/stream projection must not expose restricted bodies merely because the frontend renderer requested a resource ID.

## 9. Performance engineering: measurable rather than ornamental

Measure production-like synthetic and authorized native workloads at small, medium and large corpus sizes (for example 10k, 100k and 1m eligible source entries, if storage budget permits). Record:
- cold/warm startup and hydration, including foreground GPU/frame responsiveness;
- p50/p95 exact-source, relationship, FTS and semantic search;
- context assembly and model interpretation latency, retrieval failure/false-negative rate;
- contention and transaction time under concurrent worker/checkpoint updates;
- index growth and rebuild time, SQLite file/WAL growth, object-store retention;
- cache invalidation after revision, permission revocation and deletion;
- crash recovery, consistency, backup restore and provider outage;
- input/output/cached tokens and *cost per correctly completed task*, not simply tokens saved.

These workload scales are **design experiments**, not pre-approved production SLAs. Establish targets from real hardware baselines. No model, search index or elaborate projection framework is acceptable merely because a synthetic microbenchmark runs quickly.

## 10. Program split and accountable delivery

### Architecture Recovery: in scope now
1. Inventory every canonical store, JSON state file, index, encrypted field, artifact directory, reader/writer, size limit, migration and source owner.
2. Draw the actual present-day information/dataflow map; identify conflicting authority, redundant caches, and unnecessary handoff/serialization boundaries.
3. Benchmark the existing backend, native storage, concurrent tasks, restart behavior and known lexical retrieval without editing personal data.
4. Define typed owner adapters and shared projection contract *compatible with current code*; repair existing bugs and inaccurate docs.
5. Preserve capability and data with regression tests; write a staged, reversible consolidation plan.

### Full Realization: future work
1. Integrate CIE with host policy, semantic evidence retrieval and all source owners.
2. Implement approved candidate memory formation, semantic indexes, correction and Context Inspector UI.
3. Implement complete adaptive context preparation, holistic responsive frontend projections and event-driven Vela presence.
4. Qualify large-scale data lifecycle, cross-provider/voice/agent continuation, model-disclosure controls and performance.
5. Complete remaining ratified visual/intelligence capabilities with native Windows evidence.

The architecture must inform recovery now **without using cleanup as authorization to build every future feature**.

## 11. Acceptance and invariants

A reviewer should be able to trace the same canonical task/source record through the database owner, context manifest, Vela response, timeline, workspace and stream without finding a competing status. Reopening the application must not change identity, invent memory or repeat uncertain effects. Corrected decisions must be current while old evidence remains accurately attributed. A revoked memory must be excluded from future eligible retrieval and disclosure. A semantic/model outage must not break exact retrieval. Context-aware presentation must not be mistaken for continuous mind-reading.

**Beauty is demonstrated by lower coupling, fewer duplicate authorities, correct outcomes, low interaction friction, bounded resource use, and source-backed continuity.** More services, more generated code and more animations do not qualify as evidence.

## References

- [UMCR-01](VELA-UNIFIED-MEMORY-AND-CONTEXT-RUNTIME.md)
- [CIE-SER-01](../specifications/CIE-SEMANTIC-INTERPRETATION-AND-EVIDENCE-RETRIEVAL.md)
- [ADR-002](../decisions/ADR-002-ARCHITECTURE-RECOVERY-AND-COHESIVE-RUNTIME.md)
- [Charter 08](../../governance/08-CONTEXT-INTELLIGENCE-AND-MEMORY.md)
- [Charter 06](../../governance/06-VELA-INTELLIGENCE-AND-ADAPTATION.md)
- [SQLite limits](https://www.sqlite.org/limits.html), [FTS5](https://www.sqlite.org/fts5.html), [WAL](https://www.sqlite.org/wal.html), [Backup API](https://sqlite.org/backup.html)
