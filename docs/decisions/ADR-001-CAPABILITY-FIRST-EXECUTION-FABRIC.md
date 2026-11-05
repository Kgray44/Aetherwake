# ADR-001: Capability-first Vela execution fabric
**Status:** PROPOSED for owner review · **Date:** 2026-11-05  
**Decision owners:** Aetherwake repository owner; Vela runtime and trust maintainers  
**Scope:** Vela Intelligence, AI routing, agent integration, API capabilities and the Aerynth experience  
**Supersedes:** no existing governing charter; updates require explicit review

> **Owner-approved architecture decision (2026-11-05).** Capability-first Vela is the accepted product direction. All implementation and external API capabilities still require independent verification.

## Context

Aetherwake's objective is a coherent cinematic AI desktop in which Vela can answer, reason, coordinate, act, verify, remember and present real work. Current Vela Rebirth PR #19 and Living Instruments PR #20 are open draft stacked branches with partial verified acceptance, not fully completed releases. A simple ChatGPT-versus-Codex router, narrow budget-optimized prompt loop or unverified block appearance cannot fulfill the intent. OpenAI currently documents multiple distinct execution surfaces, including Responses, Decisions, Agents SDK, managed Agents API, Multi-agent beta, tool search, programmatic tool calling and GPT-Live. These are *candidate mechanisms*, not evidence they're configured in the app or permitted for the account.

## Decision proposed

1. **Capability-first** is the target product principle: preserve every essential user outcome; choose capability, then optimize latency, cost and resource use without silent reduction. Application correctness, trust and user choice are hard constraints.
2. Adopt one canonical **Vela Capability Runtime**, preserving enduring assistant identity, task graph, memory, policy and event state across provider switches.
3. Implement adapters for local native services, Responses/Decisions, controlled agent orchestration, managed Agents API when qualified, and separately authenticated Codex. Models and tools are discovered from real provider/account capabilities.
4. Establish one **Trusted Tool Gateway** for schema/permission checks, effect idempotency, resource contention, data transfer policy and verification.
5. Use GPT-Live with **client delegation** as the preferred voice candidate. A voice session must not become a second task database or override approval rules.
6. Render Intelligence Streams, timelines and the actual 3D GPU Mind from **observable canonical events**. Never pretend to expose private model reasoning.
7. Maintain signed-in ChatGPT/Codex entitlements, API organization credits, purchased credits and machine-resource costs as distinct quantities.
8. Preserve the governance precedence and charters' owner-approved state; this ADR is proposed until accepted explicitly.

## Alternatives considered

| Alternative | Advantage | Why insufficient alone |
|---|---|---|
| All work through one Responses loop | Simple initial implementation | Poor durable task boundaries and local effects if unsupported; cannot replace full orchestration |
| Always use Codex | Existing reliable programming harness | Less suitable for voice, ambient UI operations, fast typed decisions and general assistant workloads; quota/auth differences |
| All work through managed Agents API | Durable sessions and hosted execution | Privacy/residency constraints, costs and offline local-machine limitations; not the same as signed-in Codex |
| Only local SDK | Full application control | Requires us to build recovery, scheduling and hosted environments ourselves |
| Constant expensive flagship model | Highest theoretical reasoning ceiling | Poor latency/cost, unnecessary for native reads and bounded actions; capability still constrained by tools |
| Minimize tokens at all cost | Low spend | Silently sacrifices quality and outcomes; violates capability-first intent |
| Independent UI/voice/agent state | Modular appearance | Splinters Vela's identity and causes duplicate tasks, permissions and inconsistent user state |

## Consequences and safeguards

**Positive:** focused higher-quality reasoning, full feature pathways, reduced duplication of custom infrastructure, clearer provider boundaries, traceable task continuity, voice+backend concurrency, real event-driven spatial representation.

**Costs:** more complex provider matrix, permission handling, durable task store, account-scoped qualification, integration testing, data-residency review, observable cost controls and ongoing API compatibility verification.

**Hard constraints:** no automatic authorization from model confidence, no unreconciled retry of side effects, no destructive wildcard machine tool, no fabricated GPU cognition, no unverified billing/credits promise, no silent fallback to an incapable model, no claim that a draft charter or API reference is working code.

## Implementation and acceptance trigger

First audit PR #19/#20 and existing services. Introduce contracts in a compatible way, qualify one complete local-native + Responses + canonical task journey, and expand to agents and voice only after appropriate negative tests. Land working code as separate scoped PRs with specific receipt IDs from the [capability acceptance matrix](../specifications/VELA-CAPABILITY-FIRST-ACCEPTANCE-MATRIX.md). Owner acceptance requires a reviewed reference architecture, agreement on privacy/permission trade-offs, and proof of at least one representative end-to-end journey. Formal provider-specific decisions may supersede *mechanism choices* later, but not capability-first product intent without an explicit governance amendment.

## References

- [Reference architecture](../architecture/VELA-CAPABILITY-RUNTIME-AND-EXECUTION-FABRIC.md)
- [API evidence](../research/OPENAI-PLATFORM-CAPABILITY-EVIDENCE-2026-11-05.md)
- [Tool and agent contracts](../specifications/VELA-PROVIDER-TOOL-AND-AGENT-CONTRACTS.md)
- [Voice contract](../specifications/VELA-LIVE-VOICE-AND-MULTIMODAL-CONTRACT.md)
- Governance 00, 05, 06, 08, 09, 10, 12, 13, 14, 15 and 16.
