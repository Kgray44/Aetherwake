# Aetherwake agent guidance

This file is a routing and collaboration guide, not a substitute for project governance. **Aetherwake** is the development initiative; **Aerynth** is the planned desktop application; **Vela** is its intelligent assistant. These are working product names.

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

V2 emits the **full Constitution**, focused **complete specialist charter sections**, and an exhaustive **normative requirement envelope for every selected charter**, with exact citations, hashes, and registry authority. When it cannot reliably choose relevant sections, it falls back to the full routed charter. Its cross-domain expansion is based on documented subsystem relationships, not phrases tailored to test cases. **Coverage of all normative requirements within selected charters is not a guarantee that every applicable charter was selected**: inspect warnings, add scope/paths and use full charters as needed. Its budget is soft; its token figure is a character-derived estimate, **not measured model tokens**. Use `--full` whenever scope is broad, ambiguous, or demands comprehensive charter review. Re-run after task scope or charter source changes; read additional sections or full charters for implicit cross-domain dependencies. See [Governance Context Router V2](docs/engineering/GOVERNANCE-CONTEXT-ROUTER-V2.md). Its statuses come from `governance/README.md`: **binding** charters are authoritative, **advisory** published drafts are reference-only, and **planned/unavailable** charters must not be treated as existing or approved. Rerun when scope changes and include any cross-domain dependencies not detected automatically. Consult [the implementation guide](docs/engineering/GOVERNANCE-ROUTER.md). Validate with `node scripts/governance-router.mjs --validate`, `node --test tests/governance-router.test.mjs tests/governance-context.test.mjs`, and `node scripts/benchmark-governance-context.mjs`, and `node scripts/evaluate-governance-engineering.mjs --strict`.

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

Treat charter numbers as routing references, **not evidence that the charter exists**. If a charter is pending, rely on the Constitution and available accepted documents.

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
