# Project Aetherwake

**Aerynth** is the planned intelligent, spatial desktop environment for working with AI; **Vela** is its persistent, context-aware assistant. Both are working names.

The goal is not to wrap Codex in a prettier chat window. Aerynth should combine first-class Codex conversations with spatial workspaces, project knowledge, notes, specialist agents, orchestration, universal contextual commands, observability, and adaptive context efficiency.

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

## Governance

The governing foundation lives in [`governance/`](governance/README.md), beginning with **[the Aetherwake Master Constitution](governance/00-AETHERWAKE-CONSTITUTION.md)**. It establishes the project's binding principles, the Liquid Intelligence experience, user-control requirements, agent and context integrity, observability, and the reserved specialized charters. The Constitution is established; the other charters remain planned.

## Development direction

- **AI execution:** Codex App Server through a well-defined backend adapter (validate protocol and authentication in a spike).
- **Desktop/rendering stack:** research and benchmark alternatives before choosing Tauri versus Electron or graphics backends.
- **First deliverable:** a striking, interactive *visual experience prototype* featuring Vela's presence, animated blocks, workspace transitions, contextual command, notes capture, and event-driven Intelligence Streams.
- **Do not mistake simulated agent events for real Codex activity**; prototypes must label simulations clearly.

See the project design and architecture documents in `docs/` as they are developed.

> This repository is currently **public**. Do not commit credentials, private conversation history, personal notes, private project files, API keys, or real agent telemetry containing sensitive data.
