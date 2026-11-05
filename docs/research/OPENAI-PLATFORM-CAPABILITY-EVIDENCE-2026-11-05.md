# OpenAI Platform Capability Evidence Register
**Date checked:** 2026-11-05  
**Status:** research baseline; NOT implementation evidence, not an entitlement guarantee, not a governing charter  
**Maintainer:** Vela capability/runtime owner  
**Review triggers:** before a provider integration ships; when OpenAI changes endpoints/models/pricing; at least every release

## 1. Evidence discipline

This register identifies *documented provider possibilities*, not facilities that have been installed, granted to this account, tested on Windows, or accepted by Aetherwake. A capability's state MUST be separately represented as: documented / account-eligible / configured / reachable / authorized / tested / production-qualified. Never collapse these states into a boolean. Official documentation establishes an API surface; only an account-scoped probe establishes the real entitlement, and only a witnessed end-to-end test establishes actual Aerynth capability.

Every capability entry records documentation URL, expected ownership boundary, policy constraints, minimum test, and the distinction between provider guarantee versus Aerynth's responsibility. Source pages may change. Preserve a dated snapshot of claims and refresh the URLs in an evidence PR before pinning an implementation.

## 2. Verified API capability inventory

| Surface | Source | Known contract and limitation | Aerynth implication |
|---|---|---|---|
| Responses API | https://developers.openai.com/api/docs/guides/text | Model-driven text reasoning, structured outputs, custom functions, hosted tools and response state; tool execution and effects are still client-controlled where appropriate | Default model reasoning adapter, not the task database |
| GPT-6 model catalog | https://developers.openai.com/api/docs/models | Catalog includes GPT-6 Astra, GPT-6.1 Sol, GPT-6.1 Terra and GPT-6 Luna; support, reasoning-effort options, limits and pricing differ per model and may change | Query account/model capabilities and select by capability, not static benchmark lore |
| Decisions API | https://developers.openai.com/api/docs/guides/decisions | Typed predicate, choice, and score evaluation; documentation currently names `gpt-6-luna` as supported; it is not an action executor | Optional fast triage of bounded questions, with uncertainty and deterministic rules |
| Agents SDK | https://openai.github.io/openai-agents-python/ | Application-owned orchestration, tools, handoffs, guardrails and traces, using supported languages | Useful control framework; does not magically grant OS permissions or durable cloud sessions |
| Managed Agents API | https://developers.openai.com/api/docs/guides/agents-api/overview | Managed Codex harness with sessions, execution environment, orchestration, recovery, tools, subagents and events; model, tool and sandbox charges apply; current residency and retention restrictions | Optional managed durable work; not identical to local Codex sign-in |
| Responses Multi-agent | https://developers.openai.com/api/docs/guides/responses-multi-agent | Beta; documented support currently for GPT-6.1 Sol and GPT-5.6 models; server hosts collaboration calls; developer functions still require host execution; feature limitations apply | Independent research/verification; root/subagent identity is not Aerynth task identity |
| Tool search | https://developers.openai.com/api/docs/guides/tools-tool-search | Deferred function/MCP discovery; model compatibility and execution mode restrictions apply | Capability namespace discovery, with policy filtering before exposure |
| Programmatic Tool Calling | https://developers.openai.com/api/docs/guides/tools-programmatic-tool-calling | Model-authored bounded JavaScript can compose eligible tool calls; execution is not an unrestricted Windows runtime; tool approval still applies | Efficient fan-out reads and conditional tool orchestration |
| Function calling | https://developers.openai.com/api/docs/guides/function-calling | Typed tool requests/arguments, developer-managed execution/results | Primary boundary between AI decisions and authorized application actions |
| MCP | https://developers.openai.com/api/docs/guides/tools | Access to configured external service tools; remote/local transport and consent differ | Broker access to GitHub and other systems; classify trust and permissions per tool |
| File search | https://developers.openai.com/api/docs/guides/tools-file-search | Hosted document search/vector stores carry storage, privacy and lifecycle concerns | Optional retrieval tier; maintain canonical Aerynth references and deletion semantics |
| Shell/computer use | https://developers.openai.com/api/docs/guides/tools | Model-guided commands and graphical interaction require approved harness and environment | Fallback behind typed broker, consent, sandbox, observation and postcondition validation |
| Background Responses | https://developers.openai.com/api/docs/guides/background | Pollable asynchronous responses with retention and streaming rules; not all requests/retention choices behave identically | Durable asynchronous *provider* operation, bound to local task state |
| Webhooks | https://developers.openai.com/api/docs/guides/webhooks | Signed events delivered to app-owned HTTP endpoint; replay and duplicates must be expected | Reconcile durable jobs without trusting event arrival order |
| GPT-Live | https://developers.openai.com/api/docs/guides/live | Full-duplex conversation, interruptions, Responses/client delegation; voice duration priced separately from backend/tool work | Vela's voice facade delegates to canonical execution, never owns task outcome |
| Custom voice | https://developers.openai.com/api/docs/guides/custom-voices | Prompt-to-voice currently supported for GPT-Live; approved sample/consent-based voices have different compatibility | Voice identity asset with compatibility and audible acceptance testing |
| Images | https://developers.openai.com/api/docs/models | Current image generation/edit models separate from reasoning models | User-authorized visual creation, not a replacement for editable UI/3D rendering |
| Context/state | https://developers.openai.com/api/docs/guides/conversation-state | Responses conversation chaining, storage and compaction are provider-specific | Store canonical task/memory independently and preserve provenance |
| API data controls | https://developers.openai.com/api/docs/guides/your-data | Retention, training opt-in, region and ZDR depend on account/feature | Per-provider data-classification and transfer gate, including deletion flows |

### Provider-specific cautions and explicit exclusions

- The **managed Agents API** uses a Codex-based harness; it is billed and authorized as an Agents API integration, NOT a claim that the ChatGPT-signed-in Codex desktop or Codex CLI uses identical billing/quotas.
- The **Responses Multi-agent beta** uses its own hosted collaboration events and can be constrained by model support; it is NOT a generic license to invent tool events or claim access to private reasoning.
- **Tool search** loads definitions, not permissions. A newly discovered tool remains subject to Aerynth's authorization.
- **Programmatic tool calls** use a constrained execution environment, not a privileged system shell.
- **GPT-Live**'s conversational path is separate from backend reasoning. Backend client delegation must be implemented and witnessed before saying that tasks run while the user talks.
- **Cloud agents** cannot reach an offline local Windows machine unless a separately designed and authorized connection exists.
- A provider's stored conversation or agent session is NOT the sole durable copy of Aerynth's state, memory, approval, or audit evidence.

## 3. Subscription credits and billing separation

Primary source: https://developers.openai.com/api/docs/guides/chatgpt-api-credits

At the research date, the subscription-linked API credits may apply to eligible API Platform charges billed to the linked organization, including **Responses, Agents API, Decisions, GPT-Live, Realtime, Images, and built-in tools/sandbox/storage charges**. These are not universal free tokens, do not roll over, do not change API rate limits, and are applied before purchased credits. **Codex usage authenticated through API keys is explicitly excluded** from this subscription credit benefit; ChatGPT/Codex signed-in plan usage is a separate system. Project API keys must belong to the linked API organization. A real account check is REQUIRED before displaying a balance, entitlement or forecast.

For Aerynth: distinguish (1) subscription grant, (2) purchased credit, (3) paid on-demand billing, (4) signed-in ChatGPT/Codex plan quotas, and (5) local compute cost. Store cost evidence by actual provider endpoint, organization/project, model, account scope, task and session. Unknown provider charge is `unavailable`, never zero. Enforce spend controls without reducing the requested capability silently. Promotional credit does not authorize autonomous spending.

## 4. Candidate mapping, NOT default pinning

| Need | First capability to evaluate | Alternatives and guardrails |
|---|---|---|
| Native CPU/RAM/clock | Local read-only typed service; zero model inference | Diagnose permission/unavailability if service missing |
| Bounded choice or priority | Deterministic logic, Decisions API if ambiguity warrants it | Responses structured output; record confidence and reasons |
| General Vela conversation | Responses with capable current reasoning model | Optional qualified plan-auth route; preserve conversation identity |
| Long engineering work | Agents SDK or managed Agents API, separately scoped to environment | Codex signed-in bridge; verify file system rights, retries and outcome |
| Parallel research | Responses Multi-agent or managed-agent subagents | Independent app-managed branches; avoid shared write contention |
| Tool selection | Native registry + model tool search | Namespace policy and schema validation required |
| Voice with interruptions | GPT-Live client delegation to canonical runtime | Realtime or chained voice; human-audible actual-device qualification |
| Source-grounded history | Aerynth CIE + local canonical evidence | Hosted file search only with explicit data transfer/retention policy |
| Visual activity | Aerynth event stream into GPU scene renderer | No private chain-of-thought reconstruction, no fake GPU work |

## 5. Mandatory capability qualification protocol

For each integration, publish a receipt containing: `surface`, `documentation_checked_at`, `endpoint_or_sdk_version`, `provider`, `model`, `organization/project_scope` (non-secret), `entitlement_probe`, `input_fixture`, `actual_output_or_event_refs`, `permissions`, `actual_effect`, `verification_readback`, `usage_evidence`, `retention_policy`, `known_failure_cases`, `owner`, and `status`. Never commit keys, personal data, private transcripts or machine identifiers to this **public repository**.

Minimum probes:
1. Ordinary reasoning with structured output, stream termination, and reconciliation of unknown outcomes.
2. Tool search discovers a permitted tool and does not expose a revoked tool.
3. A denied write remains denied through nested agents and programmatic tool calls.
4. Two independent reads genuinely overlap; conflicting writes do not.
5. A managed session survives interruption and resumes without duplicating effects.
6. Voice interruption/delegation does not reorder or repeat task effects.
7. All claims of cost/credit consumption come from real usage records or are explicitly estimates.
8. Provider feature disabled/revoked/region-unavailable produces truthful fallback rather than fabricated completion.

## 6. Open decisions requiring prototypes

- Account-scoped feature availability for new beta and preview API surfaces.
- Live network latency, frame rendering impact, and voice hardware acceptance on the AERO Windows machine.
- Provider-specific behavior of retained state, steering, compaction, and continuation after cancellation.
- Appropriate split of sensitive user memory between local and remotely stored systems.
- Whether account/org credit reporting can be attributed reliably to each concurrent Aerynth workflow.
- Whether tool search meaningfully reduces latency/cost on the *actual* registered capability catalog.
- How to reconcile native Codex bridge state with managed Agents API state without conflating plan billing.

**Research outcome:** Candidate architecture is credible. No API integration, token savings, autonomous task capability, custom voice playback, security guarantee or GPU visualization is declared implemented by this document.
