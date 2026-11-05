# 12 — Codex Execution and Integrations
## Governing Charter for Aerynth's Agent Execution Boundary, Codex App Server, and External Capabilities

| Field | Value |
|---|---|
| Document ID | AW-GOV-012 |
| Version | 1.0.0-draft |
| Status | **Published proposed subsystem charter — pending repository-owner acceptance** |
| Prepared | 2026-11-01 |
| Authority | Subsystem governance, subordinate to [00 — Aetherwake Constitution](00-AETHERWAKE-CONSTITUTION.md) |
| Primary domain | Execution backends; Codex integration; session and turn control; tools; skills; MCP; approval transport; host/remote execution; interoperability; provider capability truth |
| Normative requirement namespace | **AW-CEX-###** |
| Constitutional anchors | AW-CON-002–010, AW-CON-011–015, AW-CON-031–041, AW-CON-057–065, AW-CON-069–083 |
| Companion charters | [03 Resources](03-PROJECTS-WORKSPACES-AND-RESOURCES.md), [04 Conversations](04-CONVERSATIONS-AND-CONNECTED-BRANCHES.md), [06 Vela](06-VELA-INTELLIGENCE-AND-ADAPTATION.md), [07 Knowledge](07-NOTES-KNOWLEDGE-AND-THOUGHT-STREAM.md), [08 CIE](08-CONTEXT-INTELLIGENCE-AND-MEMORY.md); planned 05 Agents, 09 Observability, 10 Profiler, 13 Platform, 14 Trust, 15 Quality, 16 Delivery |
| Intended readers | Application/backend architects, provider-adapter engineers, security reviewers, agent/tool authors, QA authors, maintainers |
| Publication boundary | Public product requirements and synthetic examples only; never user credentials, personal data, private session contents, or real operational secrets |
| Source verification baseline | Official Codex App Server and Codex SDK documentation reviewed 2026-11-01; implementation MUST recheck support at integration time |

> **Governing promise.** Aerynth MUST offer direct, capable, honest access to supported Codex agent execution while keeping the user's work, application organization, Vela's intelligence, and interaction experience independent of any single transport or provider. The executable AI is a service of Aerynth, not a substitute for Aerynth.
>
> **Core architecture.** **Codex supplies an execution harness. Aerynth supplies durable resource identity, policy mediation, orchestration, context control, presentation, and recovery. Vela interprets intent and coordinates authorized operations.** None of those responsibilities may be quietly conflated.
>
> **Safety boundary.** A beautiful approval card does not create security. All executable operations MUST obey effective enforcement boundaries; preview, refusal, audit, and user consent MUST have real consequences.
>
> **Parity boundary.** Sharing Codex's underlying harness does **not** guarantee that a custom client automatically inherits every feature or entitlement of an official Codex desktop application.

---

## 1. Authority, purpose, and boundaries

This charter is the canonical project-level requirement home for **execution-provider integration and its interfaces to Aerynth**: transports, provider capabilities, sessions, turns, commands, model selection, authentication handoff, execution environments, terminal tools, skills, MCP, extension adapters, approval delivery, integration failure recovery, and validation of the provider boundary.

The Constitution governs cross-cutting requirements. The repository owner retains final decision authority. MUST, MUST NOT, SHOULD, and MAY have the meanings established there. Publication does not itself imply owner ratification.

**Owned elsewhere and referenced here, not redefined:**
- 03 owns canonical project/workspace/block/resource identity, organization, and setting inheritance.
- 04 owns user-facing conversation and connected-branch behavior.
- 05 owns the tasks, agents, orchestration, and delegation policies.
- 06 owns Vela's attention, initiative, adaptation, and assistant behavior.
- 07 owns notes and knowledge semantics.
- 08 owns context composition, retrieval, memory, and compaction strategy.
- 09 owns event-truth classification, Intelligence Streams, and replayable activity records.
- 10 owns canonical token, usage, timing, and profiler metrics.
- 13 owns desktop runtime, rendering, performance, and multi-display implementation.
- 14 owns trust, privacy, user authorization, and autonomy policy.
- 15 owns system-wide verification and release acceptance.
- 16 owns engineering changes, delivery sequencing, and architecture decisions.

**AW-CEX-001 — Conformance.** All execution adapters and integrations MUST comply with the Constitution and approved relevant charters. A prompt, plugin, runtime setting, or provider feature MUST NOT silently supersede governing requirements.

**AW-CEX-002 — Honest capability claims.** Aerynth MUST distinguish **documented provider support**, **capability discovered in the currently connected environment**, **implemented and tested Aerynth functionality**, **experimental functionality**, **planned functionality**, and **unavailable functionality**.

**AW-CEX-003 — No forced workflow.** Direct Codex-style chatting MUST work without first defining a formal task, custom agent, workspace, or project. Optional orchestration MUST add capability rather than gate the baseline.

**AW-CEX-004 — Failure isolation.** Provider or integration failure MUST NOT destroy Aerynth-owned projects, notes, blocks, layouts, relationships, task history, or already-persisted records.

**AW-CEX-005 — Single authority per contract.** Aerynth MUST use this charter as the canonical home for execution-adapter behavior; where companion charters govern information meaning or security decisions, the adapter MUST implement those decisions instead of defining competing policy.

## 2. Definitions and architectural roles

| Term | Meaning | Must not be mistaken for |
|---|---|---|
| Execution provider | An implementation capable of running AI agent turns | The assistant or the complete application |
| Codex harness | The Codex engine handling agent turns and its supported tools | Every capability of a particular desktop app |
| App Server | Codex's documented bidirectional client protocol service | A public unauthenticated HTTP API |
| Execution adapter | Aerynth-owned compatibility and safety layer translating provider semantics | The canonical repository/project data model |
| Provider instance | A running or reachable backend with identity, version, environment, and capabilities | A permanent cross-device thread identity |
| Provider thread | Codex-managed conversation/session handle | Aerynth's canonical chat resource ID |
| Turn | One request and associated provider work | A task, agent identity, or entire chat |
| Item | Provider-defined unit of message, tool use, change, or other activity | Proof of a verified outcome |
| Execution | Aerynth's record of one attempt, mapped to provider turns and events | The user's entire task |
| Environment | Local, isolated, remote, or hosted place where operations actually run | Merely the UI's current working directory |
| Tool | Operation available to an agent | Permission for unrestricted side effects |
| Skill | Packaged instruction/procedure and optional dependencies | A guaranteed available tool |
| MCP service | External tool/resource interface | A trustless equivalent of local native tools |
| Capability | A tested, scoped operation supported under effective settings and entitlements | A checkbox visible in a UI |
| Approval | A decision about a specific proposed operation and scope | A blanket trust relationship |
| Artifact | Output of an execution, with source, location, and access policy | Evidence of acceptance without verification |

An implementation MAY maintain additional concepts, but MUST preserve these distinctions.

**AW-CEX-006 — Modular separation.** The UI, Vela, orchestration, resource catalog, policy engine, event store, and provider adapter MUST interact through explicit contracts; no UI component may depend directly on undocumented Codex rollout-file structure.

**AW-CEX-007 — Backend-neutral contracts.** Aerynth MUST define stable application-level interfaces for capabilities, conversations, execution attempts, streaming items, approvals, artifacts, and failures. Codex-specific fields MAY be preserved in namespaced provider metadata rather than flattened away.

**AW-CEX-008 — Non-fabricated equivalence.** When adding other execution providers, Aerynth MUST represent absent features as unavailable or explicitly emulated with disclosed limitations; it MUST NOT promise feature parity without tests.

## 3. Reference architecture

~~~text
User / Contextual Command / Vela / Scheduled task
                        |
                        v
             Intent + policy resolution
                        |
         +--------------+----------------+
         |                               |
         v                               v
  CIE context package            Capability/approval gate
         |                               |
         +---------------+---------------+
                         |
                         v
                Execution Orchestrator
                         |
                         v
                 Provider Adapter API
                         |
           +-------------+---------------+
           |                             |
           v                             v
    Codex App Server              Future provider(s)
           |
           +--> Threads / turns / item events
           +--> Sandbox-aware commands / file changes
           +--> Skills / MCP / configured tools
           +--> Provider approval requests
           |
           v
 Event ingestion -> normalized event log -> live UI / history / profiler
           |
           v
 Aerynth canonical chats, tasks, resources, relationships, artifacts
~~~

The reference arrangement illustrates responsibilities, not a mandated process boundary or framework.

**AW-CEX-009 — Mediation.** Vela, task orchestration, and user-facing blocks MUST NOT bypass Aerynth's authorization and execution boundary simply because a provider exposes a callable method.

**AW-CEX-010 — Typed command bus.** Aerynth-native commands (create workspace, organize chat, attach note, open resource, start task, etc.) MUST be validated against typed schemas, permission scopes, target identities, and supported actions before execution. The assistant MUST NOT manipulate its own UI via blind pointer automation when a native semantic command exists.

**AW-CEX-011 — Deterministic operations.** Navigation, metadata organization, searches that need no semantic reasoning, layout restoration, and other ordinary application operations SHOULD execute locally without a model call.

**AW-CEX-012 — Source-of-truth boundaries.** Codex is authoritative only for its own reported provider events and retained session state; Aerynth's database owns Aerynth resource identity, organization, orchestration decisions, and UI lifecycle. Sync MUST reconcile the two rather than overwrite either without policy.

## 4. Provider and capability discovery

On connecting to any execution provider, the adapter MUST construct a versioned capability snapshot containing the provider identity/version, environment, methods supported or verified, model catalog, allowed tools, optional features, and effective policy constraints.

**AW-CEX-013 — Discover; do not assume.** Model selectors, reasoning-effort controls, tool lists, supported modalities, and configurable execution modes MUST be derived from the live connection when possible, not hard-coded from documentation examples.

**AW-CEX-014 — Availability states.** Every capability MUST have an explicit state at least distinguishing **available**, **disabled by policy**, **requires setup/authentication**, **unsupported**, **experimental**, and **unknown/unverified**.

**AW-CEX-015 — Runtime invalidation.** On reconnection, provider upgrade, auth change, environment change, feature-flag change, or capability error, Aerynth MUST revalidate impacted capability snapshots before reusing them for decisions.

**AW-CEX-016 — Fallback discipline.** If a preferred feature is unavailable, any fallback MUST preserve user intent and authorization boundaries; material loss of functionality MUST be visible before proceeding.

**AW-CEX-017 — Dynamic provider UI.** The interface SHOULD expose the effective model, reasoning effort, environment, permissions, account connection state, and availability of advanced tools per chat or execution, with inherited settings and overrides displayed according to Charter 03.

### 4.1 Codex capability examples, subject to runtime verification

As documented at preparation time, App Server exposes methods including `model/list`, `thread/start`, `thread/resume`, `thread/fork`, `thread/turns/list`, `thread/items/list`, `turn/start`, `turn/steer`, `turn/interrupt`, `review/start`, `thread/compact/start`, `command/exec`, `skills/list`, and lifecycle notifications. Some methods/fields require experimental opt-in; exact support MAY vary with release, account, host, and configuration.

These are **integration references**, not promises of universal availability. Aerynth MUST inspect the live server before enabling dependent controls.

## 5. Transport, initialization, and session establishment

Codex App Server is the preferred **initial rich-client integration**, not a commitment that every function requires it forever. `codex exec` and the SDK remain valid for bounded headless jobs; they do not replace the richer bidirectional interaction model.

**AW-CEX-018 — Preferred local transport.** The first supported local integration SHOULD launch a supervised `codex app-server` process over its default standard-input/standard-output transport, or use an equally secured documented local transport. Unauthenticated network listeners MUST NOT be created by default.

**AW-CEX-019 — Protocol handshake.** The adapter MUST complete the provider-required `initialize` request and `initialized` notification before invoking other methods; failures MUST be surfaced without silently retrying unsafe operations.

**AW-CEX-020 — Framed messages.** The adapter MUST correctly distinguish responses, notifications, and provider-initiated requests; correlate request IDs; support asynchronous responses and cancellation; and reject malformed, oversized, or unexpected messages safely.

**AW-CEX-021 — Version and feature negotiation.** The adapter MUST record its client version and discovered provider features. Experimental API opt-in MUST be explicit, independently configurable, and guarded by compatibility tests.

**AW-CEX-022 — Transport hardening.** Non-local connections MUST use authenticated, encrypted transport and a restrictive network boundary (for example authenticated WSS through an approved secure route). Plain unauthenticated WebSocket exposure outside loopback MUST NOT be permitted. SSH forwarding MAY be used when configured correctly.

**AW-CEX-023 — Lifecycle supervision.** Aerynth MUST manage process launch, health/readiness, graceful shutdown, abnormal termination, restart backoff, reconnection, and user-visible connection status without spawning uncontrolled duplicate servers.

**AW-CEX-024 — Protocol evolution.** The adapter MUST isolate experimental fields and methods behind feature gates; unknown additive fields MUST not break compatible parsing, and unknown operations MUST not be treated as approved actions.

### 5.1 Suggested adapter boundaries

~~~text
ExecutionProvider
  discoverCapabilities()
  connect() / disconnect() / health()
  authenticate() / authStatus()
  createThread() / resumeThread() / forkThread()
  listThreads() / readHistory()
  startTurn() / steerTurn() / interruptTurn()
  readModels() / readTools() / readSkills()
  subscribeEvents()
  respondToApproval()
  readEffectivePolicies()
  executeSandboxedCommand()    [when supported and authorized]
~~~

These are **proposed Aerynth interfaces**, not literal Codex method names. Adapter implementations MAY split them into smaller services.

## 6. Identities, relationships, and persistence mapping

**AW-CEX-025 — Canonical ID independence.** Each Aerynth chat, agent, task, execution attempt, resource, and artifact MUST have an Aerynth-owned immutable identity. A Codex thread ID MUST NOT double as the canonical ID of an unrelated resource.

**AW-CEX-026 — Mapping provenance.** Provider mappings MUST record provider/instance identity, thread/turn/item IDs as available, environment, created/updated timestamps, source versions, and relevant parent/fork/delegation relationships.

**AW-CEX-027 — Branch semantics.** A Codex fork MAY be used to create a conversation branch, but sibling-branch awareness, selective information sharing, provenance, and convergence MUST be implemented according to Charter 04 and CIE; provider forks alone do not provide connected intelligence.

**AW-CEX-028 — History efficiency.** Large histories SHOULD use provider-supported pagination (e.g. `thread/turns/list` and `thread/items/list`) and frontend virtualization, rather than loading entire transcripts on every navigation.

**AW-CEX-029 — Destructive separation.** Archive, unsubscribe, unload, revert, delete, and disconnect MUST be modeled as distinct operations. A user rearranging a block or closing a view MUST NOT inadvertently call destructive provider history APIs.

**AW-CEX-030 — Recovery references.** Persisted mappings MUST enable resumption where the provider still retains the underlying thread. If history is missing, deleted, unavailable, or incompatible, Aerynth MUST show a recoverability limit rather than manufacture continuity.

**AW-CEX-031 — Cross-installation ambiguity.** Aerynth MUST NOT assume a thread created under one provider installation, account, or filesystem environment can be resumed in another. Migration requires explicit import/replication support and verification.

## 7. Turns, steering, cancellation, and concurrency

The adapter MUST treat a turn as a stateful operation with real status, not a single synchronous text-generation call.

**AW-CEX-032 — Turn lifecycle.** Each execution attempt MUST track requested, accepted, running, awaiting approval, interrupted, completed, failed, and indeterminate/disconnected states where applicable. Aerynth MUST distinguish **provider completion** from **task verification**.

**AW-CEX-033 — Streaming correctness.** Partial text, tool updates, file-change events, and final results MUST be correlated to the correct thread/turn/item and rendered without converting partial updates into falsely finalized content.

**AW-CEX-034 — Steering semantics.** Where supported, mid-turn steering MUST target the active turn using the required identity guard (Codex `expectedTurnId`). If steering fails because the turn ended or changed, Aerynth MUST not silently redirect the instruction to an unrelated execution.

**AW-CEX-035 — Interrupt semantics.** An interrupt is a cancellation request, not proof that all child processes, external side effects, or queued tool calls were rolled back. Aerynth MUST reconcile actual completion and termination state.

**AW-CEX-036 — No unsanctioned concurrency.** Multiple agents or chats MAY run concurrently, but operations targeting shared files, databases, worlds, live services, or deployment environments MUST use isolation, leases, serialization, or explicit concurrency controls.

**AW-CEX-037 — Idempotency and retry.** Reconnect/retry logic MUST not blindly repeat non-idempotent commands, purchases, writes, uploads, deploys, or external actions. After ambiguous transport failure, the actual state MUST be reconciled before resubmission.

**AW-CEX-038 — Task ownership.** An agent's chat or turn ending MUST NOT automatically mark an Aerynth task as accepted or verified. Task lifecycle belongs to the orchestration charter.

### 7.1 Illustrative Aerynth execution state machine

~~~text
created -> queued -> accepted -> running -> completed
                     |            |          |
                     |            +-> awaiting_approval
                     |                       |
                     |                 approve / decline
                     |
                     +-> interrupted / failed / disconnected
                                      |
                              reconcile / resume / retry
~~~

Aerynth MAY offer more nuanced states, but MUST NOT use the single label "done" for provider completion, artifact creation, and verified acceptance interchangeably.

## 8. Model selection, reasoning effort, and per-scope configuration

**AW-CEX-039 — Available model catalog.** Codex model selection MUST use `model/list` or another supported capability source. Models absent from a user's accessible catalog MUST NOT be advertised as available solely because a documentation example mentions them.

**AW-CEX-040 — Supported settings.** Reasoning-effort choices MUST be limited to the selected model's supported values; omitted or unsupported settings MUST be handled predictably and reported honestly.

**AW-CEX-041 — Inheritance.** Global, project, workspace, chat, agent, and execution-level settings MUST resolve through the approved inheritance model; the effective runtime configuration MUST be inspectable and distinguish inherited values from overrides.

**AW-CEX-042 — Settings snapshot.** Each execution MUST record the effective model identifier, provider, environment, working directory, approval/sandbox policy, and applicable tool/capability profile to the extent safely observable. Sensitive values MUST be redacted.

**AW-CEX-043 — Model changes.** Changing models in an existing thread MUST handle provider warnings, changed context limits, different modalities, different tool permissions, and potential differences in supported reasoning efforts. No silent assumption of state equivalence.

**AW-CEX-044 — Personality and unsupported controls.** If a setting is no longer supported by the provider (for example a deprecated model personality selector), Aerynth MUST disable or redefine it through its own assistant-level policy rather than sending unsupported parameters.

**AW-CEX-045 — Usage truthfulness.** Aerynth MUST distinguish subscription usage, API-key billing, reported token counts, estimated cost, and budget policies; neither the interface nor an agent may imply an undocumented free-use entitlement.

## 9. Authentication, accounts, secrets, and entitlements

**AW-CEX-046 — Supported auth only.** Authentication MUST use provider-supported sign-in and credential flows. Aerynth MUST NOT scrape private app credentials, copy browser sessions, or assume that an official app's login creates an unrestricted third-party license.

**AW-CEX-047 — Credential custody.** Access tokens, refresh tokens, API keys, SSH credentials, and connector secrets MUST be stored through appropriate secure OS facilities or a dedicated protected secret store, never in plain application logs, telemetry, prompts, notes, version control, or exported diagnostics.

**AW-CEX-048 — Credential separation.** User-level authentication, execution-provider auth, per-remote-host credentials, and per-integration authorization MUST be separately represented; project membership alone does not confer a secret or credential.

**AW-CEX-049 — Account transitions.** Sign-out, token expiry, account switching, revoked access, provider errors, and paid-plan limitations MUST yield understandable state changes without deleting local Aerynth resources.

**AW-CEX-050 — Least privilege.** Connecting a tool or account MUST grant only documented, user-approved scopes; integrations SHOULD support read-only capabilities independently from write capabilities.

**AW-CEX-051 — Local-first transparency.** The interface MUST explain which data stays local, which data is sent to Codex or another model provider, and which data is forwarded to external tools before sensitive workflows are enabled.

## 10. Sandboxing and approval mediation

Sandboxing and approval prompts are independent safeguards. Aerynth MUST enforce the effective combination of user policy, administrator requirements, provider restrictions, operating-system access, and task-specific grants.

**AW-CEX-052 — Effective policy gate.** Aerynth MUST resolve the effective allowed operation before dispatch and honor provider enforcement. A visual "read-only" label is insufficient unless actual write operations are restricted or blocked.

**AW-CEX-053 — Approval request fidelity.** When Codex sends a provider-initiated approval request, Aerynth MUST preserve request identity, operation type, arguments and target, source thread/turn, requested privilege, and available decisions as supplied. Approval UI MUST NOT misrepresent its scope.

**AW-CEX-054 — Decision delivery.** Approvals MUST be answered through the documented response protocol, associated with the originating pending request, and marked resolved only on supported confirmation. Expired, cancelled, disconnected, or superseded requests MUST NOT be silently approved.

**AW-CEX-055 — Approval granularity.** Session-wide grants, one-turn grants, specific-command permissions, filesystem roots, network destinations, and tool approvals MUST remain distinct; granting one MUST NOT imply the others.

**AW-CEX-056 — Restricted by default.** Unrestricted local process execution, unrestricted network access, privileged filesystem writes, and destructive side-effect integrations MUST NOT become the implicit default merely because a connector exposes them.

**AW-CEX-057 — Out-of-sandbox hazard.** Codex documents that `thread/shellCommand` executes outside the thread sandbox and experimental `process/spawn` runs outside the Codex sandbox. These operations MUST use a separate explicit authorization path or be disabled; they MUST NOT inherit the UI's "sandboxed agent" assurance.

**AW-CEX-058 — Sandboxed command distinction.** `command/exec` is a distinct single-command API with a specified sandbox policy. Its configuration MUST be validated; `dangerFullAccess`, `externalSandbox`, or equivalent modes MUST NOT be presented as safe merely because the API is called from App Server.

**AW-CEX-059 — Human-review surfaces.** File changes, network elevation, shell execution, connector side effects, permission escalation, and remote deployment MUST display an appropriately scoped, comprehensible operation preview and effective consequences when policy requires review.

**AW-CEX-060 — Approval audit.** The execution boundary MUST persist the decision type, request and target identity, reviewer, scope, time, resulting state, and provider confirmation where available, with secrets redacted. Auditability must not leak privileged inputs.

### 10.1 Never conflate these APIs

| Surface | Character | Required Aerynth treatment |
|---|---|---|
| `turn/start` | Model/agent work under effective policy | Validate model, context, environment, permissions |
| `command/exec` | Single command with explicit sandbox policy | Restrict and report exact policy |
| `thread/shellCommand` | User shell command outside thread sandbox | Special high-trust gate or disabled |
| `process/spawn` | Experimental raw process execution outside Codex sandbox | Feature-gated; separate high-trust permission |
| MCP/app tool call | External tool with its own effects | Per-tool scopes, side-effect review, provenance |
| Native Aerynth command | Typed application operation | Policy-checked semantic API with undo where possible |

## 11. Filesystems, repositories, worktrees, and artifacts

**AW-CEX-061 — Working-directory clarity.** Every running Codex thread/turn MUST have a knowable effective working directory and environment. Native and remote paths MUST be represented in their own namespaces instead of guessed or rewritten from the user's UI machine.

**AW-CEX-062 — Resource references are not grants.** Displaying, indexing, linking, dragging, or attaching a file/directory in a workspace MUST NOT automatically authorize an agent to read or write that location.

**AW-CEX-063 — Git isolation.** Independent concurrent code-modifying agents SHOULD use isolated Git worktrees or equivalent environments. Aerynth MUST distinguish checkout/worktree identity from branch name and repository identity.

**AW-CEX-064 — Shared-state exclusion.** Git worktrees alone do not isolate external databases, running servers, mounted volumes, build artifacts, or live game-world files. The orchestrator MUST recognize shared non-Git state and avoid conflicting concurrent writes.

**AW-CEX-065 — Preservation before destructive operations.** Destructive operations involving user files, repositories, configuration, data, or production environments MUST satisfy applicable approval and preservation/backup requirements. A branch cleanup request does not imply permission to delete unrelated work.

**AW-CEX-066 — Verified artifact provenance.** Outputs MUST record actual path/URI, source execution, environment, version/hash when practical, and validation outcome. Aerynth MUST NOT fabricate a successful artifact or claim a file is downloadable before its existence is verified.

**AW-CEX-067 — Diff integrity.** Code/file-change views MUST be derived from actual provider/file/Git evidence and attribute edits to the relevant execution. A successful provider turn is not proof the intended files changed or tests passed.

**AW-CEX-068 — Integrations don't define truth.** GitHub, Git, filesystem, CI, and editor data MAY disagree because of caches or concurrent work; Aerynth MUST surface source and freshness and reconcile before consequential action.

## 12. Terminals, command streams, and shell sessions

**AW-CEX-069 — Terminal transparency.** Terminal blocks MUST distinguish terminals launched by the user, commands launched by agents, sandboxed provider commands, and elevated or remote shells. A console visual alone cannot make them equivalent.

**AW-CEX-070 — PTY and process lifecycle.** Where supported, terminal adapters SHOULD implement interactive stdin, resize, streaming stdout/stderr, process exit, timeout, and termination with explicit association to the correct environment/process handle.

**AW-CEX-071 — Output integrity.** Displayed command output MUST preserve actual content and exit status, allowing bounded previews and access to retained complete output where policy permits. Truncation MUST be labeled rather than silently misrepresented as complete.

**AW-CEX-072 — Resource budgets.** Executed commands SHOULD support practical time, concurrency, memory, CPU, and output limits. The host MUST remain responsive under noisy processes and long-running build/test operations.

**AW-CEX-073 — Tool results and turns.** If Aerynth supplies tool output to a turn, it MUST preserve that content's status as **tool output**, not impersonate a user message or assert a verified result without evidence.

## 13. Skills, MCP services, plugins, and tool catalogs

Skills, MCP servers, app connectors, Aerynth-native tools, and ordinary shell commands are separate integration classes with different authority, configuration, and access semantics.

**AW-CEX-074 — Discovery.** Enabled skills and tool catalogs MUST be discovered within the effective project/environment scope, refreshed after dependency or configuration changes, and shown with their actual availability.

**AW-CEX-075 — Skill fidelity.** Invoking Codex skills SHOULD use the documented structured skill input when supported; merely placing a skill name in prose MUST NOT be treated as proof its instructions were loaded.

**AW-CEX-076 — Tool metadata.** Tool registrations MUST include stable identity, owner/provider, purpose, schema, input/output constraints, trust class, side-effect classification, permissions, and availability where known.

**AW-CEX-077 — Dependency checks.** Missing executables, environment variables, MCP services, credentials, network access, or incompatible versions MUST be reported before executing workflows that depend on them, where discoverable.

**AW-CEX-078 — External-content hostility.** Retrieved documents, webpages, logs, repository text, and tool output MUST be treated as untrusted content rather than instructions granting new permissions.

**AW-CEX-079 — Side-effect containment.** MCP, plugins, and dynamic tools MUST be subject to Aerynth's side-effect and authorization policy even when the provider would otherwise offer a general accept option.

**AW-CEX-080 — Tool result provenance.** Outputs from external tools MUST retain source identity, invocation timing, effective access scope, status, and relevant freshness/partial-result indicators.

**AW-CEX-081 — Extension isolation.** Third-party integrations SHOULD have bounded execution and failure isolation; a misbehaving connector MUST NOT compromise unrelated provider sessions or the Aerynth resource database.

**AW-CEX-082 — Experimental dynamic tools.** Codex dynamic tools or other experimental App Server surfaces MUST be gated and compatibility-tested; they MAY be used for Aerynth-native commands only where the invocation/approval protocol is supported and secure.

### 13.1 Supported native-command architecture

Aerynth SHOULD provide structured, authorized operations such as `openResource`, `getSelection`, `createWorkspace`, `organizeConversations`, `createTimeline`, `attachNote`, and `startAgentTask`. These names are illustrative **Aerynth API contracts**, not claims about built-in Codex method names.

Native command execution MUST be driven by canonical resource IDs, validated input, effective policies, and clear audit events. Scope inference from user intent and selection belongs to the interaction/organization domains; the executor receives an already-resolved action with required confirmation state.

## 14. Remote environments, SSH, and execution location

**AW-CEX-083 — Environment identity.** Aerynth MUST identify where each tool actually executes: local host, sandbox, worktree, container, remote SSH machine, hosted cloud service, or delegated tool provider. A local path MUST NOT be passed to a remote host as though it were accessible there.

**AW-CEX-084 — Remote trust.** Remote hosts MUST require deliberate connection setup, authenticated access, approved host identity verification, explicit authorized roots/commands, and encrypted transport. No admin endpoint or raw execution listener may be exposed publicly by default.

**AW-CEX-085 — Remote policy preservation.** Delegating work to another machine MUST NOT silently expand filesystem, network, or credential permissions beyond the effective authorization.

**AW-CEX-086 — Liveness and reconciliation.** When a remote session disconnects, Aerynth MUST distinguish unknown execution state from completed or failed execution; reconnecting MUST reconcile remote process and artifact state before repeating side effects.

**AW-CEX-087 — Deployment boundary.** Uploading code, running tests, editing local sources, modifying a live service, and deploying to production are distinct operations with separately reviewable impact.

**AW-CEX-088 — Remote availability honesty.** Remote SSH or hosted execution interfaces in the official Codex client MUST NOT be assumed available to Aerynth without a documented and tested integration path.

## 15. Browser and desktop computer control

Browser and desktop computer-use features provide useful ways to operate software beyond APIs, but they are **separate integration surfaces** with environment-specific limitations and potentially sensitive observations.

**AW-CEX-089 — Native-first control.** Within Aerynth itself, commands MUST prefer semantic, typed application APIs over browser clicks or screenshot-based automation.

**AW-CEX-090 — Explicit external consent.** External browser tabs, desktop windows, screenshots, clipboard, input injection, microphone, or camera access MUST require appropriate capability-level consent and visible monitoring state according to Charter 14.

**AW-CEX-091 — Scoped computer interaction.** Desktop/browser automation MUST have explicit target selection, allowed actions, timeouts, cancellation, and revalidation when the target window or origin changes. Sensitive actions require appropriate review.

**AW-CEX-092 — No fictitious parity.** Computer Use features that exist in an official desktop application or separate API MUST NOT be represented as automatically provided by Codex App Server.

**AW-CEX-093 — Conflict avoidance.** The system SHOULD detect and reduce interference between active user input and automated desktop input; when a desktop controller requires the foreground session, Aerynth MUST display that operational constraint.

## 16. Vela, orchestration, and CIE execution handoff

**AW-CEX-094 — Assistant independence.** Vela MUST remain operable for local navigation, searching indexed metadata, working with locally stored notes, and project organization when the Codex backend is offline, to the extent those functions do not need remote reasoning.

**AW-CEX-095 — Context manifest.** Every model execution SHOULD receive an attributable context package assembled under CIE and a reference to its inclusion manifest. The executor MUST NOT silently attach an entire project or conversation history simply because a resource appears in the workspace.

**AW-CEX-096 — Data-access enforcement.** The executor MUST not send project context, files, private notes, or sibling-branch material to a provider or tool without the relevant authorization and source scope. Relevance does not grant access.

**AW-CEX-097 — Delegation traceability.** When Vela delegates work, the execution boundary MUST preserve the initiating intent, delegating actor, receiving agent, assigned objective, task/turn identity, resource scope, and applicable policy.

**AW-CEX-098 — Handoff integrity.** Agent-to-agent or chat-to-chat handoffs MUST preserve authoritative requirements, relevant evidence, open blockers, source attribution, and uncertainty as provided by CIE; they MUST NOT falsely claim wholesale transfer of private provider-internal state.

**AW-CEX-099 — Context control limits.** Aerynth MUST distinguish model-visible content it directly assembles from provider-managed instructions, compaction, hidden context, or private reasoning that it cannot inspect or replace.

**AW-CEX-100 — Provider compaction.** If `thread/compact/start` or similar methods are invoked, they MUST follow CIE's retention, safety, user control, and integrity policies. A provider-side compaction event MUST NOT be interpreted as permission to discard canonical user history.

## 17. Observability, event streaming, and usage integration

**AW-CEX-101 — Real event bridge.** Every provider notification or request relevant to an execution MUST be normalized with stable provenance and forwarded to the appropriate event, state, and audit consumers under Charters 09 and 10.

**AW-CEX-102 — Event correlation.** Aerynth MUST correlate provider instance, thread, turn, item, task, agent, request, environment, and timestamps where supplied; a missing source key MUST remain explicitly missing, not guessed.

**AW-CEX-103 — Ordering and gaps.** The event ingestion pipeline MUST detect disconnects, missing intervals, ambiguous event order, duplicates, late events, and unsupported event types. It MUST NOT silently present a partial trace as a complete thought or execution record.

**AW-CEX-104 — Raw versus derived.** Provider-origin events, agent-written status updates, Aerynth interpretations, and UI animations MUST be clearly distinguishable in stored provenance. Aerynth MUST NOT claim access to hidden chain-of-thought.

**AW-CEX-105 — Token usage.** Token and account usage updates (including `thread/tokenUsage/updated` when available) MUST flow to the profiler with the original unit, scope, precision, and source. Unknown or provider-omitted metrics MUST NOT be invented.

**AW-CEX-106 — Stream backpressure.** Large outputs and rapid event bursts MUST NOT block the app's main rendering thread. Batching, bounded buffers, persisted streams, selective subscriptions, and virtualization SHOULD be used with explicit dropped-data reporting.

**AW-CEX-107 — No synthetic activity in production.** The motion and activity surfaces MUST visualize actual normalized state; mock or demonstration events MUST be visibly labeled and segregated.

## 18. Reliability, error handling, and recovery

**AW-CEX-108 — Fault taxonomy.** The execution layer MUST distinguish user cancellation, authentication failure, permission refusal, capability mismatch, provider crash, connection loss, rate limits, model unavailability, tool failure, remote-host failure, and malformed protocol output.

**AW-CEX-109 — Recovery behavior.** Every recoverable error class MUST have an explicit retry/reconnect/reconciliation policy. Non-recoverable operations MUST provide a useful explanation and preserve user state.

**AW-CEX-110 — No success by silence.** A transport close, empty response, unacknowledged approval, or missing completion event MUST NOT be reported as task success.

**AW-CEX-111 — Partial preservation.** Completed outputs, logs, diffs, artifacts, and event records SHOULD be persisted before risky transitions or reconnection, subject to data policy. A failed execution MUST retain enough diagnostics for honest inspection.

**AW-CEX-112 — Safe migrations.** Provider/adaptor upgrades MUST preserve Aerynth-owned mappings and supported session recoverability. Incompatible state MUST trigger an inspectable migration path or a clearly disclosed limitation.

**AW-CEX-113 — Health controls.** The integration subsystem SHOULD expose connection health, provider version, active thread counts, process health, pending approvals, error rates, and queue status for monitoring without exposing secrets.

**AW-CEX-114 — Degraded mode.** If execution is unavailable, Aerynth MUST continue to offer supported local viewing, organization, notes, history, and configuration. Buttons requiring the unavailable provider MUST be honestly disabled or provide recovery instructions.

## 19. Resource efficiency and scheduling interfaces

This charter owns how execution **exposes and obeys resource constraints**, not the rendering budget (13), token optimization algorithms (08), or profiling computation (10).

**AW-CEX-115 — Resource-aware dispatch.** The execution boundary MUST expose meaningful concurrency/resource controls so orchestration can avoid overcommitting CPU, memory, disk, GPU, network, or remote hosts.

**AW-CEX-116 — Low-impact behavior.** Scheduled and background executions SHOULD respect configured quiet hours, gaming/performance modes, power/battery policies, foreground user work, and reserved storage policies when supplied by the platform layer.

**AW-CEX-117 — Separate load categories.** GPU animation load, local terminal process load, remote computation, and model-provider latency MUST be measured or described separately instead of attributed to a single undifferentiated "AI workload."

**AW-CEX-118 — Budget response.** If the scheduler or profiler signals a time/token/resource budget limit, the executor MUST honor the configured action: notify, pause dispatch, request approval, gracefully interrupt, or stop according to policy. Budget settings MUST not be represented as hard caps unless the enforcement mechanism proves one.

**AW-CEX-119 — Completion over theater.** Fast-looking activity or large agent counts are not success metrics. The execution layer MUST expose verifiable status and artifacts for task acceptance.

## 20. Integration settings and developer diagnostics

**AW-CEX-120 — Comprehensive but unobtrusive settings.** Supported provider, model, reasoning, tools, skills, authentication, approval, sandbox, environment, transport, and debugging settings MUST be discoverable in the advanced settings experience without dominating ordinary chat.

**AW-CEX-121 — Effective configuration inspection.** Users and authorized developers SHOULD be able to inspect effective settings and their origins (global/project/workspace/chat/agent/turn), along with capability and policy restrictions.

**AW-CEX-122 — Portable configurations.** Import/export of non-secret configuration SHOULD be supported with schema versioning, validation, merge previews, and secret exclusion.

**AW-CEX-123 — Diagnostic redaction.** Support bundles and debugging exports MUST redact secrets and sensitive payloads by default, indicate intentionally omitted fields, and honor source data policy.

**AW-CEX-124 — Feature flags.** Experimental or incomplete integration features MUST be individually gated with explicit status, fallback behavior, and rollback or disable paths.

## 21. Suggested canonical data contracts

The following are **design-level illustrative contracts** to refine in `docs/architecture/`. They are not claims that Codex natively sends these objects.

~~~text
ProviderDescriptor:
  providerId, adapterVersion, providerVersion, connectionId
  endpointKind, environmentId, authStatus, capabilitySnapshot
  discoveredAt, validUntil, restrictions

ExecutionRequest:
  executionId, chatId?, taskId?, agentId?
  providerId, environmentId, threadBinding?
  userIntentRef, contextManifestRef, effectiveSettingsRef
  permissionScopeRef, expectedArtifacts?, priority?

ExecutionEvent:
  eventId, executionId, sourceProvider, sourceMethod
  providerThreadId?, providerTurnId?, providerItemId?
  kind, sourceTimestamp?, ingestedTimestamp, sequence?
  correlationId?, status?, payloadRef, trustClass, gapMarker?

ApprovalEnvelope:
  approvalId, executionId, providerRequestId
  actionType, targetRef, requestedScope, proposedEffects
  availableDecisions, policyRef, expiresAt?, state
  reviewer?, decision?, resolvedAt?, providerAck?

ArtifactReference:
  artifactId, executionId, environmentId, locator
  contentHash?, observedAt, validationStatus
  authorizedReaders, originatingItemIds[]
~~~

**AW-CEX-125 — Contract versioning.** Published adapter/data contracts MUST be versioned, validated, and forward-compatible where feasible; silent schema reinterpretation MUST NOT occur.

**AW-CEX-126 — Provenance preservation.** Aerynth MAY store normalized and provider-native representations, but MUST preserve enough original source information to diagnose mis-mapping without leaking sensitive data.

**AW-CEX-127 — Typed failure paths.** API clients MUST receive structured, diagnosable errors rather than generic success/failure booleans when a meaningful failure category is known.

## 22. Acceptance criteria and required verification

A charter requirement is not satisfied by a mock visual or a code path that has not been exercised. At minimum, the implementation MUST demonstrate the following tests with evidence, versions, environment, and actual outcomes.

| ID | Acceptance scenario | Required proof |
|---|---|---|
| CEX-AT-01 | Clean local startup | App launches supported Codex App Server, handshakes, discovers models, and reports connection state |
| CEX-AT-02 | Ordinary chat | Create chat, start turn, render streamed output, complete, close UI, reopen/resume same thread |
| CEX-AT-03 | History scale | Paginated long chat loads incrementally; front-end remains responsive; no false missing messages |
| CEX-AT-04 | Branch mapping | Fork maps two provider threads to stable canonical branch identities without automatic sibling-history leakage |
| CEX-AT-05 | Steering | Steering targets correct in-flight turn; stale expectedTurnId rejects safely |
| CEX-AT-06 | Cancellation | Interrupt reports correct state; external processes/side effects reconciled |
| CEX-AT-07 | Model catalog | Changes in model/effort availability update controls without hard-coded assumptions |
| CEX-AT-08 | Approvals | Approve, decline, cancel, time out, disconnect, duplicate, and stale request behaviors tested |
| CEX-AT-09 | Sandbox distinction | Sandboxed command allowed; out-of-sandbox shell/process methods blocked or separately approved |
| CEX-AT-10 | Filesystem scope | Linked file visibility does not grant write; denied root stays denied |
| CEX-AT-11 | Multi-agent isolation | Two concurrent worktrees are isolated; shared external path conflict is detected |
| CEX-AT-12 | Tool integrations | Skill dependency failure, MCP denial, connector timeout, and provenance all represented correctly |
| CEX-AT-13 | Environment mapping | Local vs SSH/remote paths, status, credentials, and failures remain correctly attributed |
| CEX-AT-14 | Event integrity | Streaming, ordering, duplicates, disconnect gaps, reconciliation, and unsupported event types verified |
| CEX-AT-15 | Usage telemetry | Reported token usage matches source; omitted metrics stay unknown; no invented cost or thought durations |
| CEX-AT-16 | Native commands | Semantic UI operation validates identity/scope/permission and works without screenshot clicking |
| CEX-AT-17 | Degraded operation | Provider stopped: saved notes, layouts, projects, and history remain usable |
| CEX-AT-18 | Privacy | Credentials never appear in logs, exports, project files, event previews, or model context without explicit authorization |
| CEX-AT-19 | Upgrade/recovery | Known-good version upgrade and version mismatch produce safe compatibility behavior |
| CEX-AT-20 | Background load | Resource-limited and gaming-mode behavior prevents uncontrolled execution and reports actual state |

**AW-CEX-128 — Test provenance.** Acceptance evidence MUST identify actual provider/build versions and execution environments, not just assertions that a test passed.

**AW-CEX-129 — Threat-focused verification.** Tests MUST include prompt injection from external content, scope escalation, duplicate approval, raw shell abuse, remote host impersonation, and ambiguous retry after network failure.

**AW-CEX-130 — No false readiness.** Missing supported permission checks, missing state reconciliation, fabricated session continuity, or uncontained out-of-sandbox operations MUST block release of the affected capability as production-ready.

## 23. Development milestones and research gates

These are **recommended verification milestones**, not an override of Charter 16's scheduling and delivery authority.

| Gate | Scope | Evidence before proceeding |
|---|---|---|
| G0 — Protocol research | Confirm current Codex version, App Server capabilities, auth, and security boundaries | Reproducible integration matrix and source links |
| G1 — Minimal connection | Launch/connect, handshake, model discovery, single chat/turn | Working authenticated local smoke test |
| G2 — Persistent sessions | Resume, history pages, titles, archive, fork mapping | Restart and history integrity tests |
| G3 — Live agent UI | Event normalization, streamed output, commands, approvals, interrupts | End-to-end event and consent tests |
| G4 — Engineering integration | Files, Git, worktrees, skills, MCP, terminal | Isolation and side-effect controls |
| G5 — Vela/CIE bridge | Typed native actions, context manifest, task delegation | Provenance, permission, quality/efficiency tests |
| G6 — Remote and advanced | SSH, remote host, browser/desktop control, experimental features | Separate threat review and compatibility evidence |
| G7 — Production hardening | Recovery, migrations, telemetry, long sessions, low-load operation | Reliability, security, and release evaluation |

A flagship cinematic interface MAY be prototyped at every gate, but simulated execution MUST remain labeled until a real backend and telemetry evidence replace it.

## 24. Open decisions and explicitly non-assumed capabilities

The following are **not settled architectural choices**. They require research, testing, and recorded decisions.

1. Which adapter process model best isolates the local App Server and renderer (native sidecar, supervised service, separate helper process)?
2. Which exact released Codex versions and operating systems constitute the first support matrix?
3. Which experimental App Server methods are safe enough to enable, and what are their fallback paths?
4. What session mapping guarantees exist when users simultaneously work in CLI, an official desktop app, and Aerynth?
5. Which external/browser/computer-use capabilities require separate user authorization, licensing, or APIs?
6. What protected credential-store implementation and remote authentication strategy will be used?
7. Which deployment environments can provide real filesystem isolation and rollback?
8. Which background-agent and remote-execution modes should operate when Aerynth's renderer is not running?
9. How will provider upgrades be compatibility-tested before releasing to users?
10. Which future agent backends should be supported after Codex, and which capabilities cannot be mapped faithfully?
11. How will Aerynth distinguish source-limited retrieval from genuinely synchronized external accounts?
12. What exactly constitutes user-approved automatic versus approval-required remote execution?

**AW-CEX-131 — Decision discipline.** Open choices MUST remain visibly open. Implementers MUST NOT silently promote examples, prototypes, research candidates, or the official client's unrelated features into accepted Aerynth guarantees.

## 25. Cross-charter contracts and requirement routing

| Related charter | Its authority | Contract supplied by this charter |
|---|---|---|
| 00 Constitution | Product invariants and precedence | Provider execution does not weaken intent, truthfulness, privacy, or ordinary chats |
| 03 Projects/Resources | Canonical IDs, blocks, settings inheritance | Provider binding references resource IDs without owning them |
| 04 Conversations | Chat UX, forks, connected branches | Thread lifecycle, history, turns, fork mapping, stream delivery |
| 05 Agents/Tasks | Delegation, acceptance, task dependency policies | Execution attempts, environment binding, outcomes, cancellation |
| 06 Vela | Assistant behavior and initiative | Validated native commands and authorized delegation |
| 07 Knowledge | Notes and claim authority | Scoped access to knowledge resources |
| 08 CIE | Context optimization and history integrity | Context manifests, provider execution boundary, compaction access |
| 09 Intelligence Streams | Observability and event trust | Provenance-rich provider events, gap markers, approval events |
| 10 Execution Profiler | Token/timing/accounting truth | Raw usage and timing signals, execution identity |
| 11 Timelines | Historical/planning/replay semantics | Event and execution chronology |
| 13 Platform | Runtime, resource, display behavior | Process health, resource budgets, lifecycle integration |
| 14 Trust | Authorization, privacy, autonomy | Enforced approvals, credential boundary, access decisions |
| 15 Quality | Acceptance policy | Testable execution scenarios and evidence |
| 16 Engineering | Delivery/change control | Versioned adapter contracts, migration/research gates |

### 25.1 Instructions for future contributors and Codex agents

When implementing execution-provider work:
1. Read the Constitution and this charter first.
2. Add only the companion charters that own the behavior being changed.
3. Check the currently installed Codex App Server reference and capture a capability snapshot before implementing methods.
4. Distinguish supported production features from beta/experimental and Aerynth-proposed APIs.
5. Implement typed contracts, tests, provenance, and error paths alongside new functionality.
6. Avoid modifying higher governance implicitly; propose an explicit amendment for conflicts.

## 26. Provider references and change watch

These sources are **technical references** reviewed on the date above. They do not supersede this charter and may change independently.

- [Codex App Server — official protocol and method reference](https://learn.chatgpt.com/docs/app-server): transport, initialization, session/thread/turn/item methods, approval requests, runtime notifications, model discovery, tools, and experimental boundaries.
- [Codex SDK — official integration overview](https://learn.chatgpt.com/docs/codex-sdk): programmatic/headless orchestration alternative for scripts and CI.
- [Codex developer commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli): CLI and non-interactive operational surfaces.
- [Codex source repository](https://github.com/openai/codex): implementation and version-specific protocol schemas where publicly exposed.
- [Codex as a platform](https://developers.openai.com/blog/codex-as-a-platform): high-level rationale for custom Codex clients.

**Notable documented boundaries at the review date:**
- App Server uses a JSON-RPC-like bidirectional protocol and requires `initialize` then `initialized`.
- Default `codex app-server` transport is local stdio; network use requires deliberate security.
- `model/list` reports available models and supported reasoning efforts.
- `turn/steer` requires the active turn identity.
- `thread/compact/start` triggers provider-side compaction but does not define Aerynth's source-retention policy.
- Some APIs require `capabilities.experimentalApi` and may be incompatible across versions.
- `thread/shellCommand` and experimental `process/spawn` operate outside normal Codex thread sandbox assumptions.
- The presence of a provider event or tool does not, by itself, confer permission to use it.
- Complete private model chain-of-thought is not a generally available observability product feature.

When implementation begins, the engineering team MUST compare these references with the actual installed version, record changes, and update derivative specifications and tests as needed.

---

## 27. Final governing invariants

The following summarize requirements already defined above; they do not create competing authority:

1. **Codex is the execution engine, not the identity or entire intelligence of Aerynth.**
2. **The user can always use ordinary chats without orchestrated tasks.**
3. **App Server is the initial preferred integration, never an excuse for hard lock-in.**
4. **Provider capabilities are discovered and verified, not guessed from UI or marketing.**
5. **No linked resource becomes an access grant merely by being visible.**
6. **Every consequential action has a truthful target, policy, outcome, and provenance.**
7. **Out-of-sandbox execution is explicitly treated as higher trust and risk.**
8. **A provider turn completing is not the same as a task being verified.**
9. **Disconnected, missing, or uncertain state is not silently called complete.**
10. **Aerynth's project state, note history, resource identity, and interface survive provider failure.**
11. **The visual system depicts real execution state, not imaginary reasoning.**
12. **The execution boundary supports intelligent orchestration without surrendering human control.**

> **Governing conclusion:** Aerynth MUST expose the strength of Codex through a reliable, inspectable, version-aware, policy-enforced execution boundary. Vela and specialized agents should be able to coordinate sophisticated work across chats, projects, devices, and tools; however, the user remains in control, the implementation remains truthful, and no integration becomes an unbounded authority simply because it is powerful.

---

## Proposed amendment CF-2026-11-05: OpenAI API and heterogeneous execution adapters

> **Status: proposed, pending owner acceptance.** Charter 12 remains authoritative for transport, provider capability discovery and actual integration boundaries. It does not supersede agent task ownership (05), Vela behavior (06), or trust policy (14).

**AW-CEX-132 — Provider identity separation.** The integration layer MUST model Responses API, Decisions API, Agents SDK-controlled execution, managed Agents API, GPT-Live, Realtime, native services and existing Codex sign-in/API-key modes as potentially distinct providers and billing/credential scopes.

**AW-CEX-133 — Live capability catalog.** Each adapter MUST expose account- and environment-scoped eligibility, supported models/efforts/modalities/tools, region, retention, rate-limits where known, version, operational health and qualified test state with explicit `unknown` values and refresh triggers.

**AW-CEX-134 — Provider-neutral request contract.** Canonical requests MUST retain task ID, source selection, data class, user pins, permissions, context provenance, tool/effect requirements, current attempt and output evidence requirements across adapter boundaries. Provider IDs MUST be namespaced attachments.

**AW-CEX-135 — Function/tool boundary.** Requested tool calls MUST be parsed as complete typed operations and routed through the same trusted gateway whether issued by Responses, managed agent, SDK, programmatic JavaScript, MCP or direct user command.

**AW-CEX-136 — Tool discovery safety.** Deferred tool search and automatic MCP discovery MUST reveal only appropriately scoped candidate tools and MUST revalidate authorization, schema and capability freshness at execution time.

**AW-CEX-137 — Hosted action semantics.** Native hosted Multi-agent collaboration events MUST NOT be re-executed as application tool calls. Developer-supplied function calls from any participating agent MUST be authorized and replied to using their correct provider call identities.

**AW-CEX-138 — Environment integrity.** Shell, apply-patch and computer-use adapters MUST document whether execution occurs in a provider sandbox, local machine or remote host, and MUST enforce actual boundaries. The presence of an API feature MUST NOT be represented as permission to control an arbitrary Windows process.

**AW-CEX-139 — Managed agent policy.** Managed Agents API integrations MUST explicitly declare sandbox ownership, session recovery, rate/cost model, provider data residency/retention and lack of implicit signed-in Codex quota parity. Ineligible tasks MUST use another authorized path or be blocked truthfully.

**AW-CEX-140 — Voice delegation contracts.** GPT-Live and other voice routes MUST expose session controls, interruption handling and a tested delegation path to canonical Vela tasks; they MUST NOT create an alternative ungoverned action executor.

**AW-CEX-141 — Streaming/recovery fidelity.** The adapter MUST preserve provider item identity, complete tool arguments, event ordering constraints, partial-versus-final status, resumption cursor and conflict detection as supported; ambiguous tool outputs MUST not be inferred as success.

**AW-CEX-142 — Authentication and credits.** Provider adapters MUST distinguish API project/org keys, ChatGPT/Codex signed-in credentials and managed Agents API charging; subscription API credit eligibility MUST be checked against the linked API organization, not assumed from possession of an API key.

**AW-CEX-143 — Capability withdrawal.** When a model, voice, endpoint, beta feature, permission or provider connection changes, the registry MUST invalidate dependent routes and safely pause, requalify or reroute future work without duplicating prior effects.

**AW-CEX-144 — No provider fiction.** Integration status MUST distinguish documented capability, configured connector, reachable service, live response, real authorized effect and fully verified acceptance. APIs may be deprecated or changed; documentation must have a dated evidence owner and drift review.

**Qualification suites:** unsupported model/effort and tool invocation; beta multi-agent event parsing; stale tool-search capability; permission revocation after discovery; voice session reconnect; API credits versus Codex quota; managed session crash and webhook replay. See [provider contracts](../docs/specifications/VELA-PROVIDER-TOOL-AND-AGENT-CONTRACTS.md) and [dated evidence](../docs/research/OPENAI-PLATFORM-CAPABILITY-EVIDENCE-2026-11-05.md).

