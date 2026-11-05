# Vela Capability Runtime and Execution Fabric
**Design specification CF-ARCH-01 · owner-approved 2026-11-05 · implementation not yet qualified**

> **Owner-approved architecture decision (2026-11-05).** Capability-first Vela is the accepted product direction. All implementation and external API capabilities still require independent verification.

## 0. Authority, objectives and compatibility

This specification operationalizes a **capability-first** Aerynth: deliver complete user-intended outcomes with the strongest appropriate available capability, then optimize latency, resource cost and complexity without silently subtracting functionality. It is subordinate to Constitution 00 and the existing 01–16 charters. Canonical owners remain: task/execution 05, Vela semantics 06, CIE 08, events 09, metering 10, provider transport 12, hardware/display 13, trust 14, acceptance 15, delivery 16. Where this document disagrees with an owner charter, stop and propose an explicit amendment.

Aerynth remains **one continuous spatial universe and one persistent Vela** across plain chat, focused workspace and constellation traversal. An execution-provider switch must never create an unrelated persona, duplicate project object, erase conversation ancestry or remount a foreign backend's state as if canonical. An ordinary direct Codex chat remains first-class. The user may intentionally pin a provider when it is available and authorized. An API key is an authentication credential, not an execution provider, model, entitlement or quota.

Status ledger for every requirement: `proposed` → `designed` → `implemented` → `integrated` → `verified` → `accepted`. These are separate; design publication is not implementation evidence.

## 1. Non-negotiable product outcomes

- Vela can answer questions, conduct research, act on the local machine, coordinate specialized agents, create and manage Aerynth workspaces, interact with canonical blocks, reason over project context, and verify work within an honest permission boundary.
- Any feature shipped as an **agent**, **timeline**, **memory**, **task**, **voice session**, or **spatial visualization** must have real end-to-end behavior. Decorative cards, generic canned replies, fake activity, and API calls unconnected to outcome do not count.
- The runtime scales effort to difficulty and consequences, not merely prompt length. It can escalate or delegate mid-flight; it can also use a zero-token local service when appropriate.
- No model can grant itself a tool, permission, new entitlement, credential, or unrestricted machine access. App code is the sole execution authority.
- Aerynth can stop, revoke, reconnect, replay *recorded* user-visible evidence and explain an unknown result without claiming success.
- An extraordinary visual experience and actual GPU implementation are independently verified. The model's private reasoning is not rendered as literal brain activity.

## 2. Component boundaries

```text
User multimodal intent / active spatial selection / live environment
                         |
                  Intent Gateway
                         |
              Vela Capability Runtime
       identity + task state + CIE + policy + planner
        /          |           |             \
   decision    reasoning    orchestrator    voice facade
        \          |           |             /
           Provider/Capability Registry
            available, authorized, priced
                         |
                 Trusted Tool Gateway
     validation -> preview/approval -> execution -> readback
       |              |                |             |
     native OS      Aerynth state    Codex       cloud/MCP
                         |
                  Evidence Event Bus
       canonical task ledger / lineage / cost / traces
                         |
           Motion Coordinator + GPU Mind renderer
```

Responsibilities:
1. **Intent Gateway** owns input normalization, typed selection, source IDs, provenance, user confirmations and voice/text continuity. It never fabricates successful tool outcomes.
2. **Vela Runtime** owns conversation identity, canonical request state, task planning, orchestration policy, context retrieval and provider-neutral outcomes. Vela identity is invariant across models.
3. **Provider Registry** reports discovered model/tool capabilities, constraints, supported reasoning efforts, regions, account scopes, limits, pricing metadata and freshness. A static hardcoded model list may bootstrap diagnosis but may not claim account capability.
4. **Execution Fabric** maps a plan node to Responses, Decisions, SDK-managed local agent, managed Agents API, signed-in Codex, or native services as distinct routes. Model inference is not synonymous with agent execution.
5. **Trusted Tool Gateway** owns schema checks, explicit scoped authorization, data classification, idempotency/once-only effect claims, concurrency locks and postcondition verification.
6. **Memory CIE** owns canonical facts, links, retention/deletion, semantic retrieval and context-capsule provenance. Provider conversation state is an optimization, not authority.
7. **Evidence/Event Bus** records user-visible true activity, ordered and correlated by stable IDs.
8. **Spatial Renderer** interprets events as motion, 3D GPU volume and interactive blocks without modifying task truth.

## 3. Canonical identities and typed contracts

All IDs are globally unique within the Aerynth installation, never provider-only handles. Provider IDs carry explicit `provider`, `account_scope`, `session_id`, `expiry` and capability metadata.

```ts
type IntentEnvelope = {
  request_id: string; conversation_id: string; message_id: string;
  workspace_id?: string; project_id?: string; selected_resource_ids: string[];
  user_text?: string; multimodal_refs?: string[];
  request_origin: "text"|"voice"|"context_command"|"schedule"|"agent";
  user_constraints: { provider_pin?: string; require_approval?: boolean;
    max_spend_usd?: number; time_budget_ms?: number; no_network?: boolean };
  source_provenance: string[]; created_at: string;
};
type CapabilityDescriptor = {
  id: string; version: string; provider: string; kind: "native"|"model"|"agent"|"tool"|"mcp"|"voice";
  scopes: string[]; effects: ("read"|"write"|"external"|"destructive")[];
  environments: string[]; inputs: string[]; outputs: string[];
  eligible: boolean|"unknown"; available: boolean|"unknown";
  authorized: boolean; health: "healthy"|"degraded"|"offline"|"unverified";
  data_regions: string[]; retention_class: string; cost_model_ref?: string;
  documentation_ref: string; verified_at?: string; expires_at?: string;
};
type PlanNode = {
  node_id: string; task_id: string; depends_on: string[];
  objective: string; required_capabilities: string[];
  candidate_provider_ids: string[]; effective_provider_id?: string;
  resource_claims: string[]; evidence_requirements: string[];
  max_parallelism?: number; risk_class: "read"|"reversible"|"material"|"irreversible";
};
type ToolInvocation = {
  call_id: string; task_id: string; attempt_id: string; capability_id: string;
  capability_version: string; principal_id: string; args_hash: string;
  approval_ref?: string; resource_claim_id?: string; idempotency_key?: string;
  effect_class: string; deadline_at?: string;
};
type ToolOutcome = {
  call_id: string; attempt_id: string;
  status: "verified"|"failed"|"denied"|"cancelled"|"unknown";
  provider_receipt?: string; readback_refs: string[]; durable_artifact_refs: string[];
  mutation_receipt?: string; error_code?: string; observed_at: string;
};
type UsageEvidence = {
  task_id: string; attempt_id: string; provider: string; operation: string;
  model?: string; input_tokens?: number; output_tokens?: number;
  cache_tokens?: number; tool_units?: number; duration_seconds?: number;
  currency?: string; reported_cost?: number; estimated_cost?: number;
  provenance: "provider_reported"|"derived_estimate"|"unavailable";
};
```

These are **design-level illustrative contracts**, not current SDK signatures. Version and independently test the actual implementation schema. No event or field may be conflated with hidden chain-of-thought.

## 4. Decision and route algorithm

The route is a **constraint-satisfaction problem**, not a binary "chat versus Codex" classifier.

1. Resolve request scope and canonical resources. Explicit user pins and permission overrides are stronger than model recommendations; a pin cannot override safety.
2. Determine **required outcome** (answer / inspect / modify / schedule / dialogue / visualize / agent task), relevant evidence and whether the environment can achieve it.
3. Consult a *fresh* capability catalog. Filter candidates by user approval, platform availability, account entitlement, model/tool support, data classification, required output, region, effect class and provider health.
4. If a simple native read gives complete verified outcome (time, CPU/RAM, file metadata), prefer it with no model inference.
5. If bounded classification is needed, deterministic rules or Decisions are candidates. Never treat probabilistic scores as authorization.
6. For general reasoning, use Responses plus tools and a qualified model. Select reasoning effort and tool budget based on uncertainty, risk and task difficulty; enable escalation without changing conversation identity.
7. For complex multi-step work, choose local SDK orchestration, a managed Agents API session or the signed-in Codex adapter based on actual task/environment constraints. Managed cloud execution and locally authenticated Codex are **different** providers.
8. When parallelizing, only schedule independent plan nodes with nonconflicting resource claims and verified authorization. Keep at least one independent reviewer where outcome quality warrants it.
9. If a candidate fails, report what was observed, then either retry safely under the SAME idempotency contract or replan with an authorized fallback. Unknown external effects are **not** auto-retried.
10. Reconcile the canonical task, external receipt, evidence, cost and user-facing outcome. Preserve incomplete work as incomplete.

Selection objective: maximize expected **verified task success and fidelity**, subject to trust and user constraints; then optimize latency, cost and resource use. An expensive model does not imply a better choice, nor does an inexpensive one excuse omitted functionality. The router MUST not secretly downgrade capabilities to meet an internal cost target.

## 5. Model and tool policy

The provider registry is versioned and account-scoped. Fields include model IDs, modality support, reasoning-effort allowed values, context/output limits, function/tool support, session limitations, streaming/background support, price/rate-limit freshness and documentation URL. The model list in `OPENAI-PLATFORM-CAPABILITY-EVIDENCE-2026-11-05.md` is a research snapshot, **not a hardcoded operational default**.

Aerynth must support an explicit model/effort pin for advanced users, with transparent conflict/degradation handling. Assistant persona, canonical knowledge, conversation history and permissions must survive provider changes. An API key alone must never cause routing to an unsupported tool or count as a proof of quota availability.

Tool search may reveal **only authorized candidate namespaces**, with lazy schema loading after discoverability checks. Tool definitions must be short, accurate, namespaced and versioned. Tools must have required input/output schemas and an effect declaration. Programmatic Tool Calling may orchestrate typed reads and authorized writes, but its JavaScript is untrusted orchestration code and every invoked operation is checked by the same gateway. Native endpoints must never expose arbitrary shell access merely because a model asks for it.

## 6. Agent lifecycle and parallelism

The canonical task graph has named states:
`proposed`, `awaiting_review`, `queued`, `running`, `waiting_external`, `paused`, `blocked`, `cancel_requested`, `cancelled`, `failed`, `unknown`, `verified_complete`.
Execution status, delivery status, and human acceptance are **separate dimensions**. Provider "completed" is not automatically application-verified completion.

The scheduler owns a dependency DAG and resource-claim system. Read-only jobs can overlap when actual backend concurrency exists; writes acquire explicit resource locks or use transactional compare-and-swap; same-file edit agents cannot both write without coordination. An agent may propose subtasks; the runtime validates their scopes and locks before dispatch. No agent, including a subagent, can widen its parent's approved data scope or action privileges.

The app must persist task intent, plan, active provider bindings, pending approvals, observed events, last durable checkpoint and readback requirements before external effects when possible. On process restart, reconcile provider receipts, do not blindly repeat an operation. Recoverability of a cloud session is not proof of idempotent local side effects.

## 7. Data and context

The Context Intelligence Engine must assemble scoped context from canonical conversation ancestry, project requirements, knowledge, memories, workspace selection and live state. Every nontrivial fact should retain source, timestamp, scope and confidence. Evidence-backed knowledge is distinct from a model-generated summary or speculative conclusion. Sensitive data is not transferred to a cloud provider without a data policy gate.

Use provider compaction, caching and retrieval as performance helpers, but keep durable checkpoints, a task-level structured memory, and stable object IDs independent of the model context window. A one-million-token model must still retrieve relevant context instead of ingesting private, irrelevant documents indiscriminately. Unverified remembered facts must not overwrite newer canonical source evidence.

## 8. Voice and delegation

GPT-Live is a **candidate** for full-duplex conversational presence with client delegation into the same canonical Runtime. Voice session IDs are distinct from task IDs. The voice facade must describe tool outcomes only after the backend has given a verified or explicitly qualified result. Interruptions can update or cancel the *conversation response*; they must not automatically abort or duplicate external effects. "Stop talking" and "stop that action" are different operations.

Aerynth owns microphone consent, recording indicators, output-device selection, speaker audibility tests, utterance/message identity, replay fences, privacy and transcript policy. Custom prompt-generated voice compatibility is specific to GPT-Live as documented; there is no assumption that all speech APIs accept a common voice ID.

## 9. Event fabric and 3D spatial world

Event payloads must carry `task_id`, `attempt_id`, `agent_id`, `parent_id`, `provider`, `event_type`, `sequence_or_revision`, `timestamp`, `causality_refs`, `provenance`, `visibility_policy`. Mark synthetic fixtures as synthetic. Exactly-once visual display is achieved by idempotent event reduction; external delivery itself may be at-least-once.

The Intelligence Stream, timelines, task blocks and Vela Mind share an authoritative event projection. Aerynth MUST render Vela's Mind as a genuine 3D GPU scene with depth-dependent parallax, meaningful volume, lighting transport appearance and responsive motion; a 2D sprite approximation masquerading as 3D is not sufficient. Flowing filaments/particles may represent *observable* task activity and relationships but must not claim to visualize private internal model cognition. The 6-system Motion Coordinator governs continuity and reduced-motion modes. The three navigation destinations remain connected parts of one persistent spatial universe.

Rendering performance adapts without changing underlying task capabilities, history, or authority. The renderer consumes the event stream read-only; it cannot generate fake completions for beauty.

## 10. Failure containment, security and cost

- **Credentials:** scoped OS-backed secret storage or backend-only key management; no secrets in renderer logs, client bundles, repository or task capsules.
- **Authority:** deny by default for effects; consent is purpose-, principal-, resource- and time-scoped; revocation fences active/in-flight calls as far as feasible and records residual uncertainty.
- **Prompt injection:** retrieved web pages, repo files, MCP responses, or screenshots are untrusted inputs. They cannot redefine policies or authorize actions.
- **Privacy:** version and display provider-specific retention/data residency/transfer policies. Managed Agents may not be ZDR-eligible; eligibility must be confirmed before transmission.
- **Billing:** API org grants, purchased credits, signed-in plan limits and local compute are separate. Record actual usage evidence and estimated costs distinctly; stop new work at explicit user-defined limits, but preserve work and report the block rather than silently degrading.
- **Resilience:** network loss, rate limits, expired entitlement, late tool output and webhook replay must yield stable resumable state and truthful unknowns.

## 11. Mandatory vertical slices and acceptance

| ID | Scenario | Proof required |
|---|---|---|
| CF-A01 | Vela reads current RAM | Real Windows read; timestamp; zero paid inference on native path; no hallucinated value |
| CF-A02 | Vela trims RAM safely | Specific candidate processes/caches, scoped permission, measured before/after; no unsafe blanket kill |
| CF-A03 | Vela organizes new workspace | Canonical block IDs, real layout persistence and undo; not just an attractive screenshot |
| CF-A04 | Vela does complex repo task | Real plan, authorized Codex/agent execution, verified files/tests, artifacts and error recovery |
| CF-A05 | Two independent investigative branches | Actual overlapping work and separate evidence; shared file writes locked |
| CF-A06 | Provider/entitlement unavailable | Safe fallback or explicit unavailable, never fabricated model response or success |
| CF-A07 | User interrupts a voice session | Live audible test; task continues/cancels as requested; no duplicate effect |
| CF-A08 | Memory across branch and provider | Canonical source-linked recall and delete/revoke behavior across a restart |
| CF-A09 | Tool-search and programmatic execution | Permission filtering before and after discovery; negative unauthorized case |
| CF-A10 | Agent crash after external write | Reconciliation using receipt/readback, not duplicate write |
| CF-A11 | 3D Mind / spatial navigation | GPU capture, true depth and camera parallax, stable geometry across all destinations, reduced-motion test |
| CF-A12 | Credits and budget | Linked-org eligibility check, displayed estimate vs bill, limit exhaustion, no silent fallback |

Evidence must identify environment, commit, model/provider entitlement probe, actual tool transcript redacted appropriately, screenshot/video if visual, verification result, latency and cost measurements. A visual mock or unit test cannot independently pass an end-to-end effect test. No optimization may regress accepted functionality.

## 12. Implementation order and migration plan

**Phase A — Audit:** inventory current Vela Core, Backend, Windows broker, Codex bridge, voice, Motion Coordinator, local data and existing real acceptance receipts. Preserve PR #19 and #20 functionality. Create a dependency and requirement map with gaps marked.
**Phase B — Contracts:** introduce canonical capability descriptors, request IDs, parent-child task lineage, provider bindings, authorization gateway, typed event envelopes and metrics.
**Phase C — Native and Responses:** prove RAM read/trim request, workspace edits, model+tool loop, credential containment and selected resource fidelity.
**Phase D — SDK/managed agents:** test concurrency, resume, permission inheritance, remote environment residency, stale tools and outcome verification.
**Phase E — GPT-Live:** connect client delegation to same runtime; qualify voice safety and human audibility on real devices.
**Phase F — Event visualization:** drive Living Instruments and GPU Mind from canonical events, reconcile timeline/history and real 3D quality acceptance.
**Phase G — Reliability:** long tasks, restarts, mixed-display GPU load, credit exhaustion, privacy tests and capability regression.

Each phase must produce evidence before a feature is called complete. The owner decides ratification and release; publication of this specification alone makes no claim of shipping code.

## 13. Companion specifications and official evidence

- [API platform evidence register](../research/OPENAI-PLATFORM-CAPABILITY-EVIDENCE-2026-11-05.md)
- [Provider and tool contracts](../specifications/VELA-PROVIDER-TOOL-AND-AGENT-CONTRACTS.md)
- [Voice and multimodal contract](../specifications/VELA-LIVE-VOICE-AND-MULTIMODAL-CONTRACT.md)
- [Capability acceptance matrix](../specifications/VELA-CAPABILITY-FIRST-ACCEPTANCE-MATRIX.md)
- [Decision record](../decisions/ADR-001-CAPABILITY-FIRST-EXECUTION-FABRIC.md)
- Existing authoritative charters: [05](../../governance/05-AGENTS-TASKS-AND-WORKFLOWS.md), [06](../../governance/06-VELA-INTELLIGENCE-AND-ADAPTATION.md), [08](../../governance/08-CONTEXT-INTELLIGENCE-AND-MEMORY.md), [12](../../governance/12-CODEX-EXECUTION-AND-INTEGRATIONS.md), [14](../../governance/14-TRUST-PRIVACY-AND-AUTONOMY.md), [15](../../governance/15-QUALITY-VERIFICATION-AND-ACCEPTANCE.md).

**Final standard:** Aerynth is accepted when its claimed capabilities actually perform complete, authorized, evidence-backed work inside one continuous experience. Vela is the enduring identity and orchestrator, not merely the currently selected model.
