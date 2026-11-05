# Aetherwake Governance

**This directory is the authoritative source for Aetherwake's governing requirements.**

Start with **[00 — The Aetherwake Constitution](00-AETHERWAKE-CONSTITUTION.md)**. It defines the governing intent, principles, invariants, authority hierarchy, and acceptance obligations for Project Aetherwake, Aerynth, Vela, and all related subsystems.

> **Current baseline:** The Constitution v1.0.0 is established (2026-11-01). Specialized charter publication and owner-acceptance statuses are tracked in the registry below; publication alone does not constitute ratification.

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
| 00 | [Aetherwake Constitution](00-AETHERWAKE-CONSTITUTION.md) | **Established — v1.0.0** |
| 01 | [Experience and Interaction](01-EXPERIENCE-AND-INTERACTION.md) | **Published — pending owner acceptance, v1.0.0-draft** |
| 02 | [Liquid Intelligence and Motion](02-LIQUID-INTELLIGENCE-AND-MOTION.md) | **Published — pending owner acceptance, v1.0.0-draft** |
| 03 | [Projects, Workspaces, and Resources](03-PROJECTS-WORKSPACES-AND-RESOURCES.md) | **Published — pending owner acceptance, v1.0.0** |
| 04 | [Conversations and Connected Branches](04-CONVERSATIONS-AND-CONNECTED-BRANCHES.md) | **Published — pending owner acceptance, v1.0.0-draft** |
| 05 | [Agents, Tasks, and Workflows](05-AGENTS-TASKS-AND-WORKFLOWS.md) | **Published — pending owner acceptance, v1.0.0-draft** |
| 06 | [Vela Intelligence and Adaptation](06-VELA-INTELLIGENCE-AND-ADAPTATION.md) | **Published — pending owner acceptance, v1.0.0-draft** |
| 07 | [Notes, Knowledge, and Thought Stream](07-NOTES-KNOWLEDGE-AND-THOUGHT-STREAM.md) | **Published — pending owner acceptance, v1.0.0-draft** |
| 08 | [Context Intelligence and Memory](08-CONTEXT-INTELLIGENCE-AND-MEMORY.md) | **Published — pending owner acceptance, v1.0.0-draft** |
| 09 | [Intelligence Streams and Observability](09-INTELLIGENCE-STREAMS-AND-OBSERVABILITY.md) | **Published — pending owner acceptance, v1.0.0-draft** |
| 10 | [AI Execution Profiler](10-AI-EXECUTION-PROFILER.md) | **Published — pending owner acceptance, v1.0.0-draft** |
| 11 | [Timelines and Replay](11-TIMELINES-AND-REPLAY.md) | **Published — pending owner acceptance, v1.0.0-draft** |
| 12 | [Codex Execution and Integrations](12-CODEX-EXECUTION-AND-INTEGRATIONS.md) | **Published — pending owner acceptance, v1.0.0-draft** |
| 13 | [Platform, Performance, and Displays](13-PLATFORM-PERFORMANCE-AND-DISPLAYS.md) | **Published — pending owner acceptance, v1.0.0-draft** |
| 14 | [Trust, Privacy, and Autonomy](14-TRUST-PRIVACY-AND-AUTONOMY.md) | **Published — pending owner acceptance, v1.0.0-draft** |
| 15 | [Quality, Verification, and Acceptance](15-QUALITY-VERIFICATION-AND-ACCEPTANCE.md) | **Published — pending owner acceptance, v1.0.0-draft** |
| 16 | [Engineering and Delivery](16-ENGINEERING-AND-DELIVERY.md) | **Published — pending owner acceptance, v1.0.0-draft** |

See Section 20 of the Constitution for domain boundaries.

## Owner-directed Spatial Intelligence addenda (2026-11-04)

The repository owner's detailed design directive for Vela Presence and project Intelligence Stream V2 is captured as **numbered normative amendments inside the existing governing charters**, not as mere short design notes. Their status follows each parent charter's **published / pending owner acceptance** status until that charter is explicitly ratified. Publication or an agent commit alone does not count as ratification.

| Charter | Normative addendum | Purpose |
|---|---|---|
| [01 — Experience and Interaction](01-EXPERIENCE-AND-INTERACTION.md) | §17, AW-EXP-200–217 | One continuous spatial universe, Active Projects Dock and multi-project navigation |
| [02 — Liquid Intelligence and Motion](02-LIQUID-INTELLIGENCE-AND-MOTION.md) | §17, AW-LIQ-200–225 | Reference-faithful true GPU 3D Intelligence Nebula, living continuous tendrils and spatial motion |
| [06 — Vela Intelligence and Adaptation](06-VELA-INTELLIGENCE-AND-ADAPTATION.md) | §22, AW-VELA-200–217 | Global multi-domain Vela Presence using source-backed observable activity |
| [09 — Intelligence Streams and Observability](09-INTELLIGENCE-STREAMS-AND-OBSERVABILITY.md) | §21, AW-OBS-200–230 | Per-project full-screen plan-first execution Stream, waves and Activity Theater |
| [15 — Quality, Verification, and Acceptance](15-QUALITY-VERIFICATION-AND-ACCEPTANCE.md) | §21, AW-QVA-200–216 | Art-first native GPU and source-truth acceptance gates |

**Required design/implementation entrypoint:** [Spatial Intelligence systems index](../docs/design/SPATIAL-INTELLIGENCE-SYSTEMS-INDEX.md). The older PR #20 Living Instruments visual reference remains useful for block-level instruments, but its prior mini-Stream and Vela shape direction are not accepted substitutes for the newly specified immersive Vela Presence and project Stream.

These additions do not modify the Constitution, grant new tool authorization, amend trust policy or assert that any required native GPU demonstration has passed. Applicable existing charter requirements remain in force.

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
