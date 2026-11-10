# Project Aetherwake

<p align="center"><a href="assets/brand/aerynth-mark-master.png"><img src="assets/brand/aerynth-mark-master.png" alt="Official Aerynth mark: a fluid glass-like sculptural A in indigo and violet" width="240" /></a></p>

**Aerynth** is an actively developed intelligent spatial desktop environment for working with AI; **Vela** is its persistent, context-aware assistant. The accepted product vision is larger than what the current implementation has verified.

The goal is not to wrap Codex in a prettier chat window. Aerynth should combine first-class Codex conversations with spatial workspaces, project knowledge, notes, specialist agents, orchestration, universal contextual commands, observability, and adaptive context efficiency.

The [official Aerynth mark](assets/brand/aerynth-mark-master.png) is committed and verified, with its design identity and usage guidance documented in [Aerynth Brand Identity](docs/design/AERYNTH-BRAND-IDENTITY.md). Future application integration and alternate icon/animation variants are still pending.

**Visual experience is a product requirement:** the *Liquid Intelligence* design language calls for cinematic fluid motion, layered glass materials, meaningful particles, precise micro-interactions, and adaptive graphics that remain responsive under system load.

## Foundational principles

1. **The user expresses intent; Aerynth handles the complexity.**
2. **Intelligence is visible when useful, invisible when unnecessary, and accessible everywhere.**
3. **Aerynth never makes the user work harder to use its intelligence.**
4. **Chats remain first-class.** Casual conversation should never require formal tasks or orchestration.
5. **Show real activity, not fabricated thoughts or progress.** Distinguish observed events, agent-reported summaries, inferences, and unavailable internal reasoning.
6. **Retain full history while optimizing active context.** Memory trimming must not silently destroy original evidence.
7. **Prioritize beautiful, meaningful motion without wasting CPU, GPU, memory, or tokens.**
8. **Separate AI reasoning, the application data model, orchestration, and rendering.**
9. **Make consequential actions inspectable, permissioned, and reversible where possible.**
10. **Design the UI and motion architecture first, with an early real Codex connection.**

## Owner-accepted product baseline (2026-11-05)

The repository owner explicitly accepted Constitution 00 and governing Charters 01–16, together with the capability-first API architecture, Spatial Intelligence/Stream V2 requirements and unified memory architecture. This is binding design direction rather than a collection of suggestions. Implementation and independent test qualification remain separate.

Key accepted architecture: [Unified Memory Runtime](docs/architecture/VELA-UNIFIED-MEMORY-AND-CONTEXT-RUNTIME.md), [Vela Capability Execution Fabric](docs/architecture/VELA-CAPABILITY-RUNTIME-AND-EXECUTION-FABRIC.md), [Unified Spatial Runtime](docs/architecture/UNIFIED-SPATIAL-INTELLIGENCE-RUNTIME-AND-NAVIGATION.md), [Volumetric GPU Rendering Contract](docs/architecture/VELA-PRESENCE-GPU-RENDERING-CONTRACT.md), and [Stream V2 Experience](docs/specifications/INTELLIGENCE-STREAM-V2-EXPERIENCE-AND-ACCEPTANCE.md). The [governance registry](governance/README.md) is authoritative for status and ownership.

## Governance

The governing foundation lives in [`governance/`](governance/README.md), beginning with **[the Aetherwake Master Constitution](governance/00-AETHERWAKE-CONSTITUTION.md)**. It establishes the project's binding principles, the Liquid Intelligence experience, user-control requirements, agent and context integrity, observability, and the reserved specialized charters. **Publication and acceptance are separate statuses.** Consult the [live governance registry](governance/README.md) for which numbered charters exist, which are pending, and which have been accepted. Missing charters are authored separately; do not create placeholders for them.

## Current engineering workstreams (2026-11-05)

**Architecture Recovery, current priority:** inventory, consolidate, simplify and independently verify the existing integrated Aerynth desktop/backend; correct source-ownership, CIE, storage, CI and stale-document boundaries **without** treating cleanup as permission to implement the entire future product.

**Full Aerynth Realization, separate longer program:** complete the owner-ratified intelligence, CIE, adaptive learning, 3D Vela Mind, Stream V2 and seamless spatial experience against native acceptance criteria. Missing future functionality is not evidence that present-day code cleanup failed.

**Existing implementation:** the connected Electron desktop and cinematic application live primarily under `prototypes/visual-experience/cinematic-v3/`, with `prototypes/integrated-backend/`, `prototypes/vela-core/` and other source-owned domain modules. The `prototypes/` naming is historical; neither source location nor merged PR proves complete product acceptance. Keep synthetic experience previews separate from real native provider/tool execution and evidence.

See the [Architecture Recovery A0/A1 report](docs/engineering/A0-A1-RECOVERY.md) for the connected runtime, current verification status, and CI coverage. The [application guide](prototypes/visual-experience/cinematic-v3/APPLICATION.md) covers Windows setup and the offline native verification runner.

**Architecture references:** [ADR-002](docs/decisions/ADR-002-ARCHITECTURE-RECOVERY-AND-COHESIVE-RUNTIME.md), [Local-First Storage and Continuity](docs/architecture/AERYNTH-LOCAL-FIRST-STORAGE-AND-CONTINUITY.md), [CIE Semantic Interpretation and Evidence Retrieval](docs/specifications/CIE-SEMANTIC-INTERPRETATION-AND-EVIDENCE-RETRIEVAL.md), and [UMCR-01](docs/architecture/VELA-UNIFIED-MEMORY-AND-CONTEXT-RUNTIME.md).

**Rule:** real source evidence, owner permissions and task outcomes outrank visual simulation, model confidence and code volume.

## Repository map

| Location | Role |
|---|---|
| [`AGENTS.md`](AGENTS.md) | Agent instructions, charter routing, and collaboration safeguards |
| [`governance/`](governance/README.md) | Binding constitution, domain charters, and publication/acceptance registry |
| `docs/vision/` | Intended experience and product narrative |
| [`assets/brand/`](assets/brand/README.md) | Approved product visual assets and derivative inventory |
| `docs/architecture/` | System design and technical architecture |
| `docs/design/` | Interaction, materials, motion, and visual explorations |
| `docs/research/` | Benchmarks, research, and alternatives |
| `docs/specifications/` | Implementation-level contracts and details |
| `docs/decisions/` | Architecture and design decisions |
| `plans/milestones/` | Milestones, delivery phases, and goals |
| `plans/tasks/` | Actionable scoped work |
| `prototypes/visual-experience/cinematic-v3/` | Current connected Electron desktop and cinematic application, including synthetic previews |
| `prototypes/integrated-backend/` | Current backend integration and native/runtime orchestration |
| `prototypes/vela-core/` | Vela context, history and core assistant contracts |
| `prototypes/personal-context/` | Currently isolated, protected personal context service; full native CIE integration remains incomplete |

Git cannot track empty directories, so currently empty locations are reserved using `.gitkeep` placeholders. They are not substantive specifications or completed implementations.

See the project design and architecture documents in `docs/` as they are developed.

> This repository is currently **public**. Do not commit credentials, private conversation history, personal notes, private project files, API keys, or real agent telemetry containing sensitive data.
