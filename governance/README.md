# Aetherwake Governance

**This directory is the authoritative source for Aetherwake's governing requirements.**

Start with **[00 — The Aetherwake Constitution](00-AETHERWAKE-CONSTITUTION.md)**. It defines the governing intent, principles, invariants, authority hierarchy, and acceptance obligations for Project Aetherwake, Aerynth, Vela, and all related subsystems.

> **Current baseline:** Constitution v1.0.0, effective 2026-11-01. The specialized charters listed below are **planned**, not published or approved. Do not cite a planned charter as an established requirement.

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
| 01 | Experience and Interaction | Planned |
| 02 | Liquid Intelligence and Motion | Planned |
| 03 | Projects, Workspaces, and Resources | Planned |
| 04 | Conversations and Connected Branches | Planned |
| 05 | Agents, Tasks, and Workflows | Planned |
| 06 | Vela Intelligence and Adaptation | Planned |
| 07 | Notes, Knowledge, and Thought Stream | Planned |
| 08 | Context Intelligence and Memory | Planned |
| 09 | Intelligence Streams and Observability | Planned |
| 10 | AI Execution Profiler | Planned |
| 11 | Timelines and Replay | Planned |
| 12 | Codex Execution and Integrations | Planned |
| 13 | Platform, Performance, and Displays | Planned |
| 14 | Trust, Privacy, and Autonomy | Planned |
| 15 | Quality, Verification, and Acceptance | Planned |
| 16 | Engineering and Delivery | Planned |

See Section 20 of the Constitution for domain boundaries.

## Rules for contributors and agents

- Read the Constitution and the approved governance documents relevant to the work. Do not blindly load all future charters into each task.
- Preserve existing information, data, history, and unrelated changes.
- Use **MUST**, **MUST NOT**, **SHOULD**, and **MAY** according to the Constitution's normative definitions.
- Distinguish vision from working implementation, observed facts from agent inference, and verified behavior from prototypes.
- Give normative requirements unique stable IDs and maintain one authoritative home per rule.
- Avoid copying confidential notes, credentials, personal conversations, private telemetry, or other sensitive material into this public repository.
- For changes that conflict with governance, record a proposed amendment rather than treating a task prompt as an override.
- Update this registry only when a new governing document is actually created and accepted.

## Planned companion documentation

The `docs/` tree may include vision narratives, architecture, interface contracts, visual design specifications, research, and decision records. The `plans/` tree may contain milestones and implementation work. These are distinct from governance and do not override it.

**Governance establishes what must be true. Design and architecture determine how. Engineering demonstrates that it actually works.**
