# Vela Provider, Tool, and Agent Contracts
**CF-SPEC-01 · Proposed, 2026-11-05 · source of implementation shapes, subordinate to the Constitution and charters 05, 06, 09, 10, 12 and 14**

## 1. Contract philosophy

All OpenAI and Codex adapters expose a common application-facing surface while retaining their distinct provider behaviors. Do **not** erase differences in cancellation, storage, model support, entitlement, pricing, credentials, execution environment or conversation persistence by pretending every provider is the same. Stable Aerynth IDs own user identity, tasks, message ancestry, resources, approved effects and evidence. Provider IDs are opaque namespaced attachments.

Contract versions use semantic versions for breaking schema changes, immutable event schemas, and a migration policy. Every test fixture is explicitly labeled simulated. The request, plan, authorization, tool, execution, verification, billing and presentation paths must be separable in traces.

## 2. Capability registry

A provider adapter must publish a descriptor for each usable capability and refresh on startup, reconnection, entitlement change, credential rotation, version bump and TTL expiry. Fields include provider ID, account/org/project scope (never keys), API/SDK version, model IDs, supported modalities, reasoning-effort values, context/response bounds, tools, streaming/steering/background/compaction abilities, concurrency characteristics, data residency/retention class, effect class, environment reachability, health, test qualification state and source URL. Unknown is a first-class value.

Capability resolution states:
`documented`, `eligible`, `configured`, `reachable`, `authorized`, `tested`, `production_qualified`.
A lower state cannot be represented as a higher one by UI, model answer or fallback. Entitlements and rate limits are account scoped and dynamic.

Suggested interface (adapt exact SDK signatures during implementation):
```ts
interface CapabilityProvider {
  providerId: string;
  discover(ctx: DiscoveryContext): Promise<CapabilityDescriptor[]>;
  probe(request: CapabilityProbe): Promise<ProbeReceipt>;
  start(request: ProviderRequest): Promise<ProviderBinding>;
  observe(binding: ProviderBinding, cursor?: string): AsyncIterable<ProviderEvent>;
  steer?(binding: ProviderBinding, instruction: SteeringEnvelope): Promise<SteerReceipt>;
  cancel(binding: ProviderBinding, reason: string): Promise<CancelReceipt>;
  reconcile(binding: ProviderBinding): Promise<ReconcileReceipt>;
  accountUsage?(range: UsageWindow): Promise<ProviderUsageEvidence>;
}
```
Provider-specific optional methods are reported as unavailable; no mock methods that silently return success.

## 3. Provider adapters and exact boundaries

### Responses

Create a response with constrained input context, stable request metadata, supported model and reasoning effort, tool declarations, source links and explicit storage/retention intent. Handle stream item identity, partial output, completed messages, function call arguments, final response status, token usage and errors separately. Never act on partial tool arguments. A response completion means the **model turn** completed, not external effects verified.

Client-controlled function calls must pass through the Trust Gateway before running. The tool result must associate with the original call ID and canonical attempt. Unknown tool completion triggers readback/reconciliation, not automatic reexecution.

### Decisions

Use only for bounded predicate/choice/score questions that can be evaluated from selected evidence. Record alternatives, confidence/probabilities if provided, decision input hash and output. An AI decision can recommend an execution route but cannot authorize a tool or override an explicit provider pin. Do not use Decisions as a general chat model or arbitrary tool executor. Current documented model support must be capability-probed.

### Agents SDK

Use when Aerynth needs direct control over agent code, handoffs, cancellation, local secrets, local file access, or private state. Register each SDK agent with a canonical task parent, scoped tools and worktree/resource claims. Agent handoffs are not automatic user approval. An SDK trace does not replace an application-owned execution log.

### Managed Agents API

Use when an account-authorized, privacy-compatible durable session and/or hosted sandbox materially helps a task. Persist external session ID, actual environment type, code/skill version, storage and deletion policy, model/provider identity, callbacks, tool approvals, current state and continuation checkpoint. Emit canonical events from provider streams; treat webhooks as at-least-once. Managed Agent costs may include model, tool and hosted sandbox charges. Its Codex-based harness does not inherit signed-in desktop Codex allowances.

### Responses Multi-agent beta

Treat hosted `multi_agent_call` and corresponding output as provider-managed orchestration events, NOT normal function calls to be reexecuted by Aerynth. Developer-defined tool calls still travel through the Trust Gateway with the originating agent path. Each subagent can read only the authorized tool set and scope of its parent request. A 3-agent beta tree is a research capability until compatibility, context limits, completion handling and recovery are proven.

### Codex signed-in bridge

Retain ordinary Codex conversations and actual Codex harness capabilities without transforming them into generic Responses requests. Preserve native thread IDs, model context, session status, prompt/instruction layering and read/write sandbox boundaries. Authentication via ChatGPT sign-in, Codex API key, and managed Agents API are separate billing and entitlement domains. No assumption that the subscription credit benefit pays for API-key-authenticated Codex.

### Native Windows/Aerynth services

Read-only direct methods should be zero-model default for exact measurements when intent is clear and a trusted local API is available. Machine maintenance must avoid blanket process termination or memory "optimizers". System writes need scoped target IDs, expected-current-state checks, user preview when needed, and postcondition readback. Aerynth resource mutation uses canonical APIs with undo/history rather than direct renderer state mutation.

## 4. Tool gateway

Every tool definition includes name, namespace, summary, purpose, effects (read/write/external/destructive), scopes, typed argument schema, typed output schema, security class, required principal, idempotency semantics, lock domain, timeout, expected verification, privacy class and rate limit. Callers may be direct model function requests, SDK agents, managed-agent callbacks, programmatic JS tool programs or local human gestures. **All callers use the same checks.**

Decision sequence:
1. Validate caller and canonical task/attempt.
2. Resolve typed tool ID/version; reject stale or revoked capability.
3. Validate arguments against schema, canonical resource IDs and policy.
4. Classify data to cross the boundary and reject prohibited transfers.
5. Evaluate policy and capture required human approval at the specific effect/resource/version.
6. Claim resource and idempotency key before side effects; persist approval/effect claim.
7. Execute in the least-privileged environment.
8. Record provider/OS receipt, actual effect, readback evidence, and uncertainty.
9. Release locks; publish canonical event; update task and profiler.

**No arbitrary shell escape hatch.** A local shell tool may be explicitly provisioned to a sandbox with narrowly scoped commands and worktree, but the generic Vela tool catalog must not expose privileged Windows command execution on inference authority alone.

## 5. Dynamic discovery and programmatic tools

Tool search is an optimization to load deferred schemas, not an authorization grant. The searchable catalog must be prefiltered for the current principal, workspace, data class and environment, then rechecked after discovery. Discovered tool definitions are versioned and expire on permission revocation or backend state change. A model cannot request to widen its visible tool namespace to bypass the gate.

Programmatic Tool Calling may batch dependent reads or safe parallel work but receives only the same allowed tools. Program results include each individual tool call ID and result; a successful JavaScript program cannot turn a failed child tool operation into verified success. Tool search must run at a supported stage; an already running program cannot spontaneously discover additional deferred tools without the model-level discovery step. Guard against expensive loops with per-task quotas, program deadline and explicit telemetry.

## 6. Canonical task graph and lock contract

One canonical `request_id` can produce multiple `task_id`/subtasks, each with `attempt_id`. A task has an immutable user goal and optional revisions; evidence and provider receipts belong to attempts. Task success is conjunctive: required action performed, expected evidence observed, data integrity maintained, permission honored, and human acceptance where required.

A scheduler can dispatch independent read branches concurrently. It must detect overlapping write claims by canonical resource, worktree/path, namespace and effect type. Shared writers use ordered leases, CAS revisions or transaction boundaries. A lock expiration does not establish that an external write failed. After crash, reconcile receipts and resource state before reissue.

Interrupt, cancel, pause and approval:
- `interrupt_speech` stops generation/output only;
- `cancel_task` requests termination of not-yet-committed and safely cancellable work;
- `revoke_scope` prevents further authorized effects and records unrecoverable in-flight effects separately;
- `approval_needed` pauses the specific effect without manufacturing a generic refusal;
- `unknown` means outcome cannot be determined; preserve it, display it, and never auto-replay potentially non-idempotent effects.

## 7. Event and billing contracts

Event fields: `event_id`, `schema_version`, `source`, `event_type`, `task_id`, `attempt_id`, `agent_id`, `parent_agent_id`, `provider_session_id`, `correlation_id`, `causality_refs`, `sequence`, `provider_event_id`, `emitted_at`, `observed_at`, `payload_ref`, `data_class`, `synthetic`, `verification_level`.
Events must be deduplicatable and reconcilable after reconnect. Do not rely on wall-clock timestamps as the sole causal ordering. Model output, tool request, tool execution, external effect, verification and acceptance are different event types.

Token and cost receipts must distinguish:
- provider-reported input/output/reasoning/cache tokens and usage;
- locally estimated tokens and projected cost;
- tool call, image, audio duration, managed sandbox, storage, and network charges;
- promotional credit, purchased credit and plan entitlements (if available to the connected account);
- missing usage versus actual zero usage.

When accounting evidence is missing, present `unknown` or `not reported`. Cost budgets protect the user but must not silently reduce task quality; they produce explicit blocked/scope-change choices.

## 8. Capability lifecycle and compatibility tests

For each adapter version run:
- Available/expired/revoked credential; mislinked organization; exhausted allowance and API 429;
- model/effort/tool mismatch, wrong-region, unsupported privacy policy;
- partial stream and duplicate/reordered final events;
- tool discovery then permission revoked before invocation;
- programmatic execution of a disallowed tool;
- two read branches genuine overlap and conflicting write lock denial;
- cancelled/unknown external effect and restart reconciliation;
- provider session reused without resubmitting already committed mutation;
- human review approval expiry/scope change;
- usage reported vs estimated vs missing;
- user-visible status matches actual task evidence and canonical resource state.

A qualified provider must pass both negative/security and positive/outcome tests. Capture per-platform fixtures and save redacted receipts with version, environment and date. Test failure or missing permission means "not qualified," not "implemented enough."

## 9. Change governance

Update this contract, the API evidence register and the relevant authoritative charter in the same architectural change when adding a new provider family or privileged tool class. Do not infer that successful API feature documentation equals Aerynth implementation. Use [architecture](../architecture/VELA-CAPABILITY-RUNTIME-AND-EXECUTION-FABRIC.md) and [acceptance matrix](VELA-CAPABILITY-FIRST-ACCEPTANCE-MATRIX.md) together.
