# ADR-002: Architecture Recovery before Full Aerynth Realization, with one cohesive runtime
**Status:** OWNER-DIRECTED ARCHITECTURAL DECISION · **Recorded:** 2026-11-05  
**Decision owner:** Aetherwake repository owner  
**Scope:** Engineering sequencing, architecture quality, backend/front-end coherence, memory and storage integration  
**Precedence:** Subordinate to the ratified Constitution and specialist charters; complements ADR-001, never replaces them

## Context

Aerynth has real connected execution, native desktop experience, GPU rendering, missions, provider integration and substantial domain models. Repeated design evolutions left very large coordinating files, overlapping route and context mechanisms, synthetic prototype entry points beside production code, and imperfect CI scope. The owner explicitly distinguishes **cleaning and organizing today's implementation** from **completing the entire ratified vision**.

Meanwhile, Vela must eventually exhibit excellent, persistent memory, efficient semantic understanding, continuity across providers/agents/projects and a frontend that feels fluid and anticipatory. Treating those as an excuse for indiscriminate immediate feature development would worsen the architectural debt.

## Decision

### Program A: Architecture Recovery (NOW)

Purpose: make the **existing implementation** coherent, maintainable, source-correct, well-integrated, performant and reliably testable.

In scope:
1. Map current code and canonical data ownership; establish authoritative entry points, runtime dependency boundaries and verifiable native behavior.
2. Reconcile existing governance, architecture, specifications, acceptance and historical status reports without rewriting prior evidence.
3. Identify and retire *proven* redundant routing, identity, context, persistence and UI state paths, through reversible tested changes.
4. Refactor oversized shared coordination modules incrementally behind existing service interfaces; do not replace a god object with hundreds of purposeless adapters.
5. Fix CI path gaps and run cross-package/native regression gates against the actual application.
6. Inventory and benchmark current storage/memory retrieval and design future-compatible contracts; allow isolated non-production research/shadow experiments.
7. Prove no loss of currently working features, approvals, source lineage, history, state recovery or project data.

Out of scope unless an explicit blocker: full automatic personal-memory extraction, complete CIE implementation, massive GPU Mind/Stream visual completion, generalized proactive intelligence, large new agent orchestration infrastructure, and unbounded provider feature additions.

**Done when:** documented ownership, stable real-app baseline, fewer competing paths, documented storage/continuity compatibility, reproducible verification and source-backed status. Code volume reduction is an indicator, **not** the acceptance criterion.

### Program B: Full Aerynth Realization (LATER)

Purpose: fulfill the owner-ratified Constitution, charters, and accepted product/design architecture, including advanced Vela intelligence, full CIE, semantic retrieval, adaptive proactive experience, immersive 3D GPU-native Mind and all other agreed capabilities.

Program B may proceed in carefully authorized independent slices, but cannot be silently bundled into Program A. Its acceptance is behavior and native evidence against the governing documents, not simply finishing a branch, writing a spec or executing tests for a toy adapter.

### Shared quality invariant: sophisticated inside, simple outside

Aerynth is one coherent spatial product. Vela is one enduring application identity. Canonical task/resource/data owners remain authoritative and their approved projections feed UI, Intelligence Streams, timeline, context and model/tool operations. A completed animation never means an unverified tool succeeded. A provider session never becomes canonical Vela identity. Semantic interpretation never grants access rights.

**Backend beauty:** bounded responsibilities, predictable state transitions, source-backed causality, low coupling, strong contracts, narrow privilege, testability and recoverability. **Frontend fluency:** one application state, meaningful transitions, preserved focus and context, relevant unobtrusive suggestions, no duplicated statuses or abrupt unrelated pages.

## The smallest useful architecture

Prefer a **modular local-first monolith** with canonical owner services, one policy gateway, one CIE retrieval coordinator, one application state projection layer and one shared motion coordinator, rather than spawning a collection of microservices, a second persistence graph, another task scheduler or a new renderer.

These are *logical ownership boundaries*, not directives to create new physical packages. Reuse and consolidate before creating an abstraction. Interfaces should name actual data ownership and observable responsibilities. Optimize correct outcomes and measured performance, not number of autonomous agents, tokens or commits.

The CIE model-assisted semantic interpreter (initial research candidate: GPT-6 Luna, subject to availability and benchmark) translates ambiguous natural language to typed **information requirements**, not a privileged execution plan; source retrieval and disclosure stay host-controlled. See [CIE-SER-01](../specifications/CIE-SEMANTIC-INTERPRETATION-AND-EVIDENCE-RETRIEVAL.md).

## Multi-agent development protocol

Use a small task-appropriate planner/worker/reviewer integration organization rather than copying large swarm counts. Assign stable file/domain ownership and isolated branches/worktrees. Planner owns decomposition and interfaces; domain workers own narrow implementation; an independent reviewer tests actual outputs; an integration owner resolves shared contracts and merges.

Every PR must answer: what capability or maintainability outcome changed, which canonical owners it touched, what duplicate pathway was removed, what new abstraction was necessary, what data/memory/permission invariants were preserved, what native tests were run, and what remains incomplete. Require bounded tasks and real end-to-end checks, not self-scored completion or test count alone.

A worker may not reinterpret accepted design to make the ticket smaller, and may not expand a cleanup into product realization without explicit authorization. A model's recommendation is not governance approval, a permission grant, factual verification or a green CI status.

## Sequencing / implementation gates

| Gate | Recovery deliverable | Acceptance evidence |
|---|---|---|
| A0 | Baseline & inventory | Current merge SHA, service/data maps, native smoke scenarios, known gaps |
| A1 | CI and governance correctness | Changed-package CI coverage, no stale authoritative status, explicit legacy classification |
| A2 | Core coordination consolidation | Per-domain interfaces, no duplicate writes, stable source IDs and unchanged verified workflows |
| A3 | Storage and CIE readiness | Indexed source-ownership map, current lexical benchmark, semantic schema/eval design, measured database behavior |
| A4 | Handoff to Full Realization | Reconciled API contracts, regression gates, prioritized backlog with explicit separation of missing features |

Run A1–A3 incrementally and independently where safe. Avoid large simultaneous mechanical moves and feature rewrites. Protect user data and original evidence; preserve Git history and actual source links.

## Alternatives rejected

- **Big-bang rewrite:** breaks working integration and risks loss of task/data/permission fidelity.
- **Build the complete vision under "cleanup":** hides scope and makes delivery unmeasurable.
- **Keep every prototype permanently:** increases ambiguity, imports and regression surface.
- **Multiple memory databases / agent identities:** creates contradictory sources and incoherent assistant behavior.
- **Keyword-only CIE or a chain of heavyweight planners:** systematically misses semantic evidence and adds unnecessary token expense.
- **Use an API model for every lookup:** adds latency and privacy exposure to operations native services can answer exactly.
- **Beautiful frontend with fake backend events:** contradicts source evidence and makes UX state untrustworthy.

## Impact, status and review

This ADR records the owner's accepted *sequencing and cohesion goals*, not completion of Programs A or B. Any new normative behavioral rule belongs in the relevant ratified charter by explicit amendment; this ADR explains engineering application within that framework. Provider capabilities, benchmarks, costs and performance targets remain evidence-based and revisable without making a new charter.

Related: [ADR-001](ADR-001-CAPABILITY-FIRST-EXECUTION-FABRIC.md), [UMCR-01](../architecture/VELA-UNIFIED-MEMORY-AND-CONTEXT-RUNTIME.md), [STOR-CONT-01](../architecture/AERYNTH-LOCAL-FIRST-STORAGE-AND-CONTINUITY.md), [CIE-SER-01](../specifications/CIE-SEMANTIC-INTERPRETATION-AND-EVIDENCE-RETRIEVAL.md), [governance registry](../../governance/README.md).
