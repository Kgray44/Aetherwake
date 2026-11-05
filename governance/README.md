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

## Rules for contributors and agents

- Read the Constitution and the approved governance documents relevant to the work. Do not blindly load all future charters into each task.
- Preserve existing information, data, history, and unrelated changes.
- Use **MUST**, **MUST NOT**, **SHOULD**, and **MAY** according to the Constitution's normative definitions.
- Distinguish vision from working implementation, observed facts from agent inference, and verified behavior from prototypes.
- Give normative requirements unique stable IDs and maintain one authoritative home per rule.
- Avoid copying confidential notes, credentials, personal conversations, private telemetry, or other sensitive material into this public repository.
- For changes that conflict with governance, record a proposed amendment rather than treating a task prompt as an override.
- Update this registry when a governing document is published, accepted, amended, or withdrawn; distinguish published drafts from ratified charters.

## Proposed capability-first amendments (2026-11-05)

Every currently published 00–16 charter contains an explicitly labeled **proposed** capability-first addendum. The Constitution remains **Established — v1.0.0** and specialized charters retain their published/pending-owner-acceptance statuses; committing proposed text is not ratification. Owner review must explicitly decide whether each amendment is accepted and then record the version/status change. Their normative requirement IDs are append-only within the existing domain-owner namespaces, so the current Governance Router and Context Router can retrieve them without introducing an overlapping charter.

**Review package:** [architecture](../docs/architecture/VELA-CAPABILITY-RUNTIME-AND-EXECUTION-FABRIC.md), [API evidence register](../docs/research/OPENAI-PLATFORM-CAPABILITY-EVIDENCE-2026-11-05.md), [provider/tool contracts](../docs/specifications/VELA-PROVIDER-TOOL-AND-AGENT-CONTRACTS.md), [live voice](../docs/specifications/VELA-LIVE-VOICE-AND-MULTIMODAL-CONTRACT.md), [acceptance matrix](../docs/specifications/VELA-CAPABILITY-FIRST-ACCEPTANCE-MATRIX.md), and [ADR-001](../docs/decisions/ADR-001-CAPABILITY-FIRST-EXECUTION-FABRIC.md). The documents specify intended architecture and test obligations; they do NOT claim newly added runtime functionality.

Document ownership: 05 tasks, 06 Vela's intelligence behavior, 08 context/memory, 09 event truth, 10 profiling/cost, 12 provider integration, 14 permissions, 15 acceptance, 02/13 GPU visual, and other charters within their existing domains. Do not use a provider feature to bypass a domain owner.

## Planned companion documentation

The `docs/` tree may include vision narratives, architecture, interface contracts, visual design specifications, research, and decision records. The `plans/` tree may contain milestones and implementation work. These are distinct from governance and do not override it.

**Governance establishes what must be true. Design and architecture determine how. Engineering demonstrates that it actually works.**
