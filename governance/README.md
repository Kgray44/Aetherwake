# Aetherwake Governance

**This directory is the authoritative source for Aetherwake's governing requirements.**

Start with **[00 — The Aetherwake Constitution](00-AETHERWAKE-CONSTITUTION.md)**. It defines the governing intent, principles, invariants, authority hierarchy, and acceptance obligations for Project Aetherwake, Aerynth, Vela, and all related subsystems.

> **Current owner-ratified baseline (2026-11-05):** Constitution 00 and all specialized governing charters 01–16 are formally approved as binding product/design requirements. This governance acceptance does **not** certify that their implementation, providers, visual experiences or release gates are complete.

## Document authority

1. The **Constitution** has the highest project-document authority.
2. **Approved subsystem charters** provide additional binding requirements within their domains.
3. Approved interfaces and architecture decisions must comply with higher governance.
4. Specifications and design references provide details and evidence.
5. Plans, agent prompts, and work items direct implementation without changing governance.

The repository owner retains final decision authority. Amendments must be explicit, reviewed for impact, and recorded in Git history. Applicable security, privacy, and platform obligations remain in force.

## Governing registry

| ID | Document | Status |
|---|---|---|
| 00 | [Aetherwake Constitution](00-AETHERWAKE-CONSTITUTION.md) | **Owner-ratified — v1.1.0, 2026-11-05** |
| 01 | [Experience and Interaction](01-EXPERIENCE-AND-INTERACTION.md) | **Owner-ratified — v1.1.0, 2026-11-05** |
| 02 | [Liquid Intelligence and Motion](02-LIQUID-INTELLIGENCE-AND-MOTION.md) | **Owner-ratified — v1.1.0, 2026-11-05** |
| 03 | [Projects, Workspaces, and Resources](03-PROJECTS-WORKSPACES-AND-RESOURCES.md) | **Owner-ratified — v1.1.0, 2026-11-05** |
| 04 | [Conversations and Connected Branches](04-CONVERSATIONS-AND-CONNECTED-BRANCHES.md) | **Owner-ratified — v1.1.0, 2026-11-05** |
| 05 | [Agents, Tasks, and Workflows](05-AGENTS-TASKS-AND-WORKFLOWS.md) | **Owner-ratified baseline + owner-directed FI amendment — v1.2.0, 2026-11-10** |
| 06 | [Vela Intelligence and Adaptation](06-VELA-INTELLIGENCE-AND-ADAPTATION.md) | **Owner-ratified baseline + owner-directed FI amendment — v1.3.0, 2026-11-10** |
| 07 | [Notes, Knowledge, and Thought Stream](07-NOTES-KNOWLEDGE-AND-THOUGHT-STREAM.md) | **Owner-ratified — v1.1.0, 2026-11-05** |
| 08 | [Context Intelligence and Memory](08-CONTEXT-INTELLIGENCE-AND-MEMORY.md) | **Owner-ratified baseline + owner-directed FI amendment — v1.3.0, 2026-11-10** |
| 09 | [Intelligence Streams and Observability](09-INTELLIGENCE-STREAMS-AND-OBSERVABILITY.md) | **Owner-ratified — v1.1.0, 2026-11-05** |
| 10 | [AI Execution Profiler](10-AI-EXECUTION-PROFILER.md) | **Owner-ratified baseline + owner-directed FI amendment — v1.2.0, 2026-11-10** |
| 11 | [Timelines and Replay](11-TIMELINES-AND-REPLAY.md) | **Owner-ratified — v1.1.0, 2026-11-05** |
| 12 | [Codex Execution and Integrations](12-CODEX-EXECUTION-AND-INTEGRATIONS.md) | **Owner-ratified — v1.1.0, 2026-11-05** |
| 13 | [Platform, Performance, and Displays](13-PLATFORM-PERFORMANCE-AND-DISPLAYS.md) | **Owner-ratified — v1.1.0, 2026-11-05** |
| 14 | [Trust, Privacy, and Autonomy](14-TRUST-PRIVACY-AND-AUTONOMY.md) | **Owner-ratified — v1.1.0, 2026-11-05** |
| 15 | [Quality, Verification, and Acceptance](15-QUALITY-VERIFICATION-AND-ACCEPTANCE.md) | **Owner-ratified — v1.1.0, 2026-11-05** |
| 16 | [Engineering and Delivery](16-ENGINEERING-AND-DELIVERY.md) | **Owner-ratified — v1.2.0 clarification, 2026-11-05** |

See Section 20 of the Constitution for domain boundaries.

## Owner ratification and amendment reconciliation (2026-11-05)

The repository owner explicitly accepted **all 17 governing documents, 00–16**, including their original product requirements and the integrated capability-first, 3D Spatial Intelligence, Stream V2 and unified memory amendments. These are no longer just proposed ideals. **Implementation and acceptance evidence remain separate:** a ratified rule establishes what must be built, not that it has already been delivered.

- **Original charter baseline:** 00 Constitution and 01–16 are binding as version 1.1.0, subject to future explicit owner amendments.
- **Capability-first CF-2026-11-05:** Previously proposed on PR #22, reconciled into the existing charters and now owner-accepted.
- **Spatial Intelligence SI-2026-11-04:** Previously proposed on PR #21, its Charter 01/02/06/09/15 addenda are reconciled and owner-accepted. "One continuous spatial universe. No disconnected screen changes" remains a nonnegotiable product direction.
- **Unified Memory UM-2026-11-05:** Charter 08's new AW-CIE-137–157 govern the memory lifecycle, task memory, agent coordination, context disclosure and privacy boundaries.
- **Architecture ownership:** Charter 08 owns derived context/memory orchestration, not every underlying record. Source owners maintain canonical conversations, projects, knowledge, task execution, and events. Charter 14 governs authorization.
- **No false completion:** The owner ratifies product/design requirements now. Native functionality, true volumetric GPU fidelity, provider capabilities, live model results, security and release readiness require separately witnessed acceptance.

### Accepted architecture and design references

- [Unified Memory and Context Runtime](../docs/architecture/VELA-UNIFIED-MEMORY-AND-CONTEXT-RUNTIME.md)
- [CIE Semantic Interpretation and Evidence Retrieval](../docs/specifications/CIE-SEMANTIC-INTERPRETATION-AND-EVIDENCE-RETRIEVAL.md)
- [Aerynth Local-First Storage and Continuity Architecture](../docs/architecture/AERYNTH-LOCAL-FIRST-STORAGE-AND-CONTINUITY.md)
- [ADR-002: Architecture Recovery and Cohesive Runtime](../docs/decisions/ADR-002-ARCHITECTURE-RECOVERY-AND-COHESIVE-RUNTIME.md)
- [Capability Runtime and Execution Fabric](../docs/architecture/VELA-CAPABILITY-RUNTIME-AND-EXECUTION-FABRIC.md)
- [Unified Spatial Intelligence and Navigation](../docs/architecture/UNIFIED-SPATIAL-INTELLIGENCE-RUNTIME-AND-NAVIGATION.md)
- [GPU Volumetric Presence Contract](../docs/architecture/VELA-PRESENCE-GPU-RENDERING-CONTRACT.md)
- [Spatial Systems Index](../docs/design/SPATIAL-INTELLIGENCE-SYSTEMS-INDEX.md)
- [Intelligence Stream V2](../docs/specifications/INTELLIGENCE-STREAM-V2-EXPERIENCE-AND-ACCEPTANCE.md)
- [Capability-first Acceptance Matrix](../docs/specifications/VELA-CAPABILITY-FIRST-ACCEPTANCE-MATRIX.md)

**Authority hierarchy:** the ratified Constitution controls overarching invariants; ratified domain charters control their domains; owner-accepted design/architecture/ADRs explain the intended implementation within those boundaries; tests and evidence verify what actually runs. Future design modifications require explicit owner approval rather than an implementing agent silently narrowing capability.

## Architecture Recovery and CIE clarification (2026-11-05)

Charters 06, 08 and 16 carry owner-directed v1.2.0 clarifications for one source-backed Aerynth experience, semantic evidence-aware context retrieval, and separate **Architecture Recovery** versus **Full Aerynth Realization** programs. The companion specification, architecture and ADR linked above are accepted design direction **only**: they do not certify Luna/API access, completed semantic memory retrieval, automatic learning or full native UI integration. The existing domain authority and Charter 08 memory lifecycle remain in force. Implementing agents must not turn present-day cleanup into unrequested full-feature development.

## Fluid Intelligence amendments (owner directive 2026-11-10)

The owner directed a coordinated major overhaul of **Charters 05, 06, 08 and 10**. The appended **FI-2026-11-10** sections are binding *design requirements*, not evidence that the runtime, provider features, ARIE, adaptive experiments or spatial workspace have been implemented or release-qualified. Prior ratifications and constitutional authority remain intact.

- **05 — AW-ATW-164–192:** AI Mission Executive versus deterministic task kernel, validated structured execution plans, concurrency and resource-aware scheduling, artifact verification, supervised replanning and quality-preserving optimization.
- **06 — AW-VELA-218–251:** AI-native cognition from input through response, Fluid Intelligence experiential learning, capability-first model/tool decisions, resource-sensitive intelligence and explainable adaptation. Existing AW-VELA-200–217 remain authoritative.
- **08 — AW-CIE-165–197:** iterative AI-supported evidence retrieval, provenance and permission boundaries, experiential memory, scoped strategy applicability, correction/rollback propagation and held-out semantic evaluation.
- **10 — AW-AEP-138–178:** evidence-led optimization, critical-path and quality-adjusted performance measurement, controlled experiments/policy promotion, ARIE integration and the Adaptive Intelligence Workspace.

**Canonical ownership remains unchanged:** MissionService owns task state; AIR/Vela owns cognition; CIE owns context projections and retrieval; AEP owns measurements and experimental evidence; the existing Platform Governor/ARIE owns local resource-policy enforcement; Trust owns permission; observability owns event projections. The expanded work belongs to **Full Aerynth Realization**, not an unapproved enlargement of Architecture Recovery. Companion architecture, supporting-charter revisions, system tests and integration remain separate follow-on deliverables.

The deterministic section-level Governance Context Router indexes normative requirement lines from the charter source files. Future agents must explicitly retrieve applicable FI requirements by task/path or stable requirement ID and validate substantive section sufficiency; a documentation merge is not an implementation test.

## Rules for contributors and agents

- Read the Constitution and the approved governance documents relevant to the work. Do not blindly load all future charters into each task.
- Preserve existing information, data, history, and unrelated changes.
- Use **MUST**, **MUST NOT**, **SHOULD**, and **MAY** according to the Constitution's normative definitions.
- Distinguish vision from working implementation, observed facts from agent inference, and verified behavior from prototypes.
- Give normative requirements unique stable IDs and maintain one authoritative home per rule.
- Avoid copying confidential notes, credentials, personal conversations, private telemetry, or other sensitive material into this public repository.
- For changes that conflict with governance, record a proposed amendment rather than treating a task prompt as an override.
- Update this registry when a governing document is published, accepted, amended, or withdrawn; distinguish published drafts from ratified charters.

## Planned companion documentation

The `docs/` tree may include vision narratives, architecture, interface contracts, visual design specifications, research, and decision records. The `plans/` tree may contain milestones and implementation work. These are distinct from governance and do not override it.

**Governance establishes what must be true. Design and architecture determine how. Engineering demonstrates that it actually works.**
