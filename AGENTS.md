# Aetherwake agent guidance

This file is a routing and collaboration guide, not a substitute for project governance. **Aetherwake** is the development initiative; **Aerynth** is the planned desktop application; **Vela** is its intelligent assistant. These are working product names.

## Owner-ratified baseline (2026-11-05)

Constitution 00 and Charters 01–16 are explicitly ratified by the repository owner as binding product and design requirements. The capability-first, Spatial Intelligence and Unified Memory amendments are included. Implementation status, API availability, security/performance qualification and release acceptance remain separately evidence-gated. See [the governance registry](governance/README.md), [Unified Memory Runtime](docs/architecture/VELA-UNIFIED-MEMORY-AND-CONTEXT-RUNTIME.md), [Capability Runtime](docs/architecture/VELA-CAPABILITY-RUNTIME-AND-EXECUTION-FABRIC.md) and [Spatial Runtime](docs/architecture/UNIFIED-SPATIAL-INTELLIGENCE-RUNTIME-AND-NAVIGATION.md). Do not discard requirements or substitute 2D Mind visuals or parallel memory stores.

## Deterministic governance routing

Before substantive work, use the repository's deterministic router instead of loading all 17 charter documents:

```bash
node scripts/governance-router.mjs --task "Implement contextual command selection" --path src/interaction/selection.ts
```

Add further `--path` arguments as scope becomes known; use `--json` for structured output. The router always selects Constitution 00 and routes relevant domains by task phrases and paths.

For ordinary coding/engineering work, **prefer V2's section-level retrieval** after confirming the applicable charter domains:

```bash
node scripts/governance-context.mjs --task "Optimize particle rendering" --path src/rendering/particles.ts
node scripts/governance-context.mjs --requirement AW-CIE-008 --json
```

V2 emits the **full Constitution**, focused **complete specialist charter sections**, and an exhaustive **normative requirement envelope for every selected charter**, with exact citations, hashes, and registry authority. When it cannot reliably choose relevant sections, it falls back to the full routed charter. Its cross-domain expansion is based on documented subsystem relationships, not phrases tailored to test cases. **Coverage of all normative requirements within selected charters is not a guarantee that every applicable charter was selected**: inspect warnings, add scope/paths and use full charters as needed. Its budget is soft; its token figure is a character-derived estimate, **not measured model tokens**. Use `--full` whenever scope is broad, ambiguous, or demands comprehensive charter review. Re-run after task scope or charter source changes; read additional sections or full charters for implicit cross-domain dependencies. See [Governance Context Router V2](docs/engineering/GOVERNANCE-CONTEXT-ROUTER-V2.md). Its statuses come from `governance/README.md`: owner-ratified charters are binding; only future unapproved proposals remain advisory. Rerun when scope changes and include any cross-domain dependencies not detected automatically. Consult [the implementation guide](docs/engineering/GOVERNANCE-ROUTER.md). Validate with `node scripts/governance-router.mjs --validate`, `node --test tests/governance-router.test.mjs tests/governance-context.test.mjs`, and `node scripts/benchmark-governance-context.mjs`, and `node scripts/evaluate-governance-engineering.mjs --strict`.

## Authority and reading discipline

1. Begin with [the governance index](governance/README.md) to determine the **current** charter registry and approval status. Read [the Constitution](governance/00-AETHERWAKE-CONSTITUTION.md) before substantive design or implementation.
2. Read **only the specialized charters relevant to the work**. Do not consume every governance document for every task; route by subsystem and specific cross-cutting obligations.
3. Governance defines *what must be true*. `docs/` records *why/how*; `plans/` records *when/what next*; code and tests implement and verify behavior. Lower-authority documents and prompts must not silently override higher authority.
4. A missing or draft charter is **not** an invitation to invent binding requirements, claim ratification, or create an empty imitation of it. Report the gap and proceed only within accepted authority. Create new numbered governance charters only when explicitly requested.
5. Preserve the source and status of every claimed requirement. Distinguish proposed, published, accepted, and implemented behavior.

## Subsystem routing

Use the governance registry for exact filenames and current availability. Typical scopes:

| Work | Primary charter IDs | Other charter IDs to consider |
|---|---|---|
| UI, contextual commands, quick actions | 01 | 02, 03, 14, 15 |
| Cinematic motion, particles, glass, rendering | 02 | 01, 13, 15 |
| Projects, workspaces, blocks, resources | 03 | 01, 07, 14 |
| Chats and connected branches | 04 | 08, 09, 14 |
| Agents, tasks, workflows | 05 | 06, 09, 12, 14 |
| Vela, initiative, adaptation | 06 | 07, 08, 14 |
| Notes and project knowledge | 07 | 03, 08, 14 |
| Context Intelligence Engine (CIE), compaction | 08 | 04, 07, 10, 14 |
| Intelligence Streams and event provenance | 09 | 10, 11, 14 |
| Token accounting and execution profiling | 10 | 08, 09, 15 |
| Timelines and replay | 11 | 09, 10, 15 |
| Codex and external integrations | 12 | 05, 09, 14 |
| Platform, performance, multi-display | 13 | 02, 15 |
| Security, privacy, autonomy | 14 | All affected domains |
| Acceptance, delivery | 15, 16 | All affected domains |

Treat charter numbers as routing references, **not evidence that the charter exists**. Every existing charter 00–16 is currently ratified; check the registry for any future proposals.

## Mandatory Spatial Intelligence / Vela Presence routing (owner directive 2026-11-04)

For tasks involving **Vela's visual mind/Presence, GPU nebula, living tendrils, global activity motes, project Intelligence Stream, Activity Theater, Active Projects Dock, multi-project switching, immersive navigation or spatial view transitions**, read [Spatial Intelligence systems index](docs/design/SPATIAL-INTELLIGENCE-SYSTEMS-INDEX.md) and the relevant amendments in Charters **01 §17, 02 §17, 06 §22, 09 §21, and 15 §21** in addition to the Constitution and other routed charters. The deterministic router currently handles the existing 00–16 charter IDs; these are new *sections of existing charter IDs* and should be retrieved as applicable. Do not replace governance routing with only this shortcut.

**Write this on the implementation plan:** **One continuous spatial universe. No disconnected screen changes.** Vela's global mind is a **genuinely GPU-rendered three-dimensional Intelligence Nebula**, visually faithful to the owner's 2026-11-04 reference image, with luminous flowing light *inside* its veils and **connected, organically deforming central-to-domain tendrils**. A flat image, 2D cloud trick, simple sphere, detached glowing lines, radial card menu, or looping screensaver DOES NOT meet the target. The main project Intelligence Stream is a separate **full-screen plan-first execution landscape** with real branch-local fronts and actual operation evidence; PR #20's small Stream block may remain a preview, but it is not V2.

**Delivery gate:** Prove artistic fidelity and true moving-camera GPU 3D before deep integration; collect owner-visible visual evidence and acceptance. Do not claim completion from mock screenshots, unit tests, aesthetic self-assessments, or synthetic activity. Keep trace truth, authorization, and working Codex/PR #19/#20 integrations intact. Use scoped branches/worktrees to avoid collisions.

## Repository responsibilities

- `governance/`: constitution, subsystem charters, status registry. Do not alter without a specifically scoped governance request.
- `docs/vision/`: creative product experience and intent.
- `docs/architecture/`: system boundaries, interfaces, data flow, implementation structure.
- `docs/design/`: visual/motion/interaction explorations and design assets.
- `docs/research/`: investigations, experiments, performance comparisons, external evidence.
- `docs/specifications/`: detailed technical contracts and functional specifications.
- `docs/decisions/`: architecture and design decision records, including alternatives and reasons.
- `plans/milestones/`: delivery phases and milestone outcomes.
- `plans/tasks/`: actionable, testable engineering work.
- `prototypes/visual-experience/`: experiments establishing Liquid Intelligence interaction and performance before production commitments.
- `src/`: application source once implementation is authorized.

## Engineering conduct

- Treat the visual experience and Motion Coordinator as first-class work; benchmark framework/rendering alternatives before cementing a stack.
- Keep plain chats usable without requiring task orchestration. Keep persistent objects and relationships separate from their visual block representations.
- Present real observable agent activity and supported summaries. Never fabricate live reasoning, private chain-of-thought access, task results, timing, or token metrics.
- Use scoped context and evidence-driven retrieval instead of blindly loading histories and repositories. Retain historical evidence subject to explicit retention policies.
- Make consequential changes permissioned, previewable where appropriate, and reversible when technically possible.
- When working concurrently, inspect current branch/file state, make scoped changes, and do not overwrite unrelated edits, force-push, or misstate verification.
- This repository is **public**: never commit credentials, private conversation logs, sensitive user notes, identifiable telemetry, local machine secrets, or production datasets.
- A feature is not finished solely because it compiles: collect applicable functional, visual, motion, security, and performance evidence.

When details remain undecided, document the decision and the validation needed. Don't quietly convert guesses into requirements.

## Capability-first 2026-11-05 design packet (owner-ratified 2026-11-05)

The repository owner separately ratified all capability-first amendments on 2026-11-05. They are binding requirements, not a claim of completed implementation. For affected work, use the router and read the new sections under the applicable charter IDs. An agent assigned a limited coding task must not treat the design packet as permission to rewrite or override an owner-approved architecture.

Read the [reference architecture](docs/architecture/VELA-CAPABILITY-RUNTIME-AND-EXECUTION-FABRIC.md), [provider/tool contracts](docs/specifications/VELA-PROVIDER-TOOL-AND-AGENT-CONTRACTS.md), [voice contract](docs/specifications/VELA-LIVE-VOICE-AND-MULTIMODAL-CONTRACT.md), [API evidence register](docs/research/OPENAI-PLATFORM-CAPABILITY-EVIDENCE-2026-11-05.md) and [acceptance matrix](docs/specifications/VELA-CAPABILITY-FIRST-ACCEPTANCE-MATRIX.md) only when relevant to actual task scope. Avoid loading the entire packet for a trivial unrelated edit.

**Execution doctrine:** First achieve the real, safe, complete user outcome. Select a capable model/tool/environment from qualified actual provider and native capabilities; optimize cost, latency and tokens only after correctness, authorization and user-experience requirements. A successful model response, mocked UI, audio demo, or provider "completed" marker does not independently establish a verified task. Every agent action must pass canonical authorization and effect verification. Preserve unknown outcomes and don't blindly retry writes. Real RAM measurements come from the OS, not a hallucinated answer. Do not expose API keys or sensitive machine paths in this public repo.

**Interface and visual doctrine:** Vela's Mind must be genuinely 3D/GPU-rendered when claimed, driven by real event projections, and navigated inside one persistent spatial universe. Do not approximate hidden chain-of-thought with simulated neural visualization. Living Instruments must represent and edit actual canonical state. Label synthetic fixtures.

**Integration scope:** PR #19 and PR #20 were merged on 2026-11-05; merge is not proof of full functional or native acceptance. Audit their latest actual state before changes. A new provider family requires official dated source verification, scoped account entitlement probe, privacy/retention analysis, full negative tests and a traceable rollout. Never conflate signed-in Codex quotas, Codex through API keys, managed Agents API bills or subscription API promotional credits.

## Unified Memory / CIE implementation priority (owner-ratified 2026-11-05)

For any task that changes memory, context construction, task checkpoints, agent knowledge handoff, provenance, correction/deletion or model-provider continuity, read the [Unified Memory Runtime](docs/architecture/VELA-UNIFIED-MEMORY-AND-CONTEXT-RUNTIME.md) and Charter 08 AW-CIE-137–157. Preserve source ownership and native consent, use tested task checkpoints, and prevent memory islands or unauthorized cross-branch/provider data transfer. Memory retrieval quality and continuity are first-class engineering acceptance gates, not future optional polish.

## Architecture Recovery, semantic CIE and seamless-runtime rule (owner directive 2026-11-05)

**Two separate engineering programs.** The owner's *current* priority is Architecture Recovery: identify real source ownership, clean and simplify existing architecture, eliminate duplications, repair CI/documentation and prove existing native workflows still work. Full Aerynth Realization is a longer program to complete every ratified design capability. Do **not** silently grow a recovery task into full CIE, autonomous agent expansion, a new graphics engine, or wholesale app rewrite. Read [ADR-002](docs/decisions/ADR-002-ARCHITECTURE-RECOVERY-AND-COHESIVE-RUNTIME.md) before scoped recovery work.

**CIE is not keyword theater.** The current lexical Personal Context/history/mission/governance retrieval code is a bounded baseline, **not** the complete semantic CIE. Read [CIE-SER-01](docs/specifications/CIE-SEMANTIC-INTERPRETATION-AND-EVIDENCE-RETRIEVAL.md), [UMCR-01](docs/architecture/VELA-UNIFIED-MEMORY-AND-CONTEXT-RUNTIME.md), and Charter 08 AW-CIE-137–164. Future model-assisted interpretation MAY compile ambiguous user intent into structured *evidence needs* (initial research candidate Luna via qualified API). Model output is not scope, permission, source truth, a privileged planner, or completed action. No regex/keyword-only proxy may be declared a full semantic solution; direct exact/native retrieval must remain fast and model-free. Benchmark on independent unseen paraphrase, correction, contradictions, privacy and answer outcomes.

**Storage and unity.** Read [Local-First Storage and Continuity](docs/architecture/AERYNTH-LOCAL-FIRST-STORAGE-AND-CONTINUITY.md). Reuse canonical SQLite/source-owner contracts and event/task identity; do not invent a second fact store, memory island, authorization policy, task scheduler, renderer state or Vela persona. Domain owners remain authoritative; CIE holds versioned projections; the frontend renders those same source-backed entities and transitions. "Beautiful backend" means understandable and testable contracts, low coupling, predictable recovery and measured responsiveness, *not* more complexity.

**Pull request evidence:** explicitly name current program, changed source-owner interfaces, preserved invariants, new-vs-retired abstractions, real tests, scope/permission negatives, and remaining work. A documentation merge never certifies implementation. Retrieve only relevant binding governance plus the linked specifications.
