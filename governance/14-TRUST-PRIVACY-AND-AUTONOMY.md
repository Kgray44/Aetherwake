# 14 — Trust, Privacy, and Autonomy
## Permission Boundaries, Informed Control, Secure Execution, Monitoring, and Recovery Charter for Aerynth

> **Owner acceptance (2026-11-05):** This charter and both relevant design amendments are approved as binding product standards; no implementation, security, benchmark or release certification is implied.

| Field | Value |
|---|---|
| Document ID | AW-GOV-014 |
| Version | 1.1.0 — owner-ratified 2026-11-05 |
| Status | **Owner-accepted and ratified governing charter; implementation verification separate** |
| Prepared | 2026-11-01 |
| Authority | Subsystem charter subordinate to [The Aetherwake Constitution](00-AETHERWAKE-CONSTITUTION.md) |
| Primary domain | Trust policy, permissions, data confidentiality, autonomy boundaries, monitoring consent, risk classification, approval execution, credential isolation, revocation, deletion, and recoverability |
| Normative requirement namespace | **AW-TRUST-###** |
| Constitutional anchors | AW-CON-002, 006–010, 014, 022–025, 034, 036–041, 044, 053, 057–061, 069–073, 079–089 |
| Related charters | 01 Experience; 03 Projects; 04 Conversations; 05 Agents; 06 Vela; 07 Notes; 08 CIE; 09 Observability; 10 Profiler; 11 Timelines; 12 Codex; 13 Platform; 15 Quality; 16 Engineering |
| Implementation posture | Normative behavior and verifiable contracts; specific storage, identity, cryptography, sandbox, and authentication choices require architecture and threat-model review |
| Publication boundary | This public specification MUST contain no credentials, personally identifying logs, real private conversations, connection tokens, or actual user telemetry |

> **Governing promise.** Aerynth should be powerful enough to organize and act across projects, chats, files, browsers, agents, workflows, and remote computers while remaining unmistakably **under the user's control**. Vela may be proactive, adaptive, and autonomous only within explicit and revocable authority.
>
> **Trust is contextual, never implied.** A selected file is a reference, not blanket filesystem permission. A linked website is not permission to publish content. A remembered preference is not approval for an elevated action. An agent's delegation is not a new source of authority.
>
> **Safety must not become friction theater.** Harmless, reversible interactions should remain fluid. Consequential actions require clear scope, proportionate authorization, truthful outcomes, and recoverability wherever technically possible. Secure behavior is part of the product experience, not a developer-only appendix.

---

## 1. Authority, purpose, scope, and non-goals

This charter is the **canonical owner** of Aerynth's permission semantics, autonomous-action boundaries, privacy controls, risk-based approvals, sensitive-data handling, security policy, revocation, and recovery obligations. It applies to the Aerynth desktop frontend and services, Vela, Codex and other agent backends, plugins/MCP tools, integrated terminals, browsers, remote computers, indexing, monitoring, scheduling, and future extensions.

The [Constitution](00-AETHERWAKE-CONSTITUTION.md) has higher document authority. The repository owner retains final governing authority under the Constitution's explicit amendment procedure. The terms **MUST**, **MUST NOT**, **SHOULD**, and **MAY** carry the Constitution's normative meanings. No lower-level implementation decision, assistant preference, model instruction, or retrieved document can override these boundaries.

This charter defines **what must be protected and how authorization must behave**. It does not specify the final database, desktop shell, identity provider, encryption library, cloud architecture, browser automation engine, or the model's inaccessible internal reasoning. Provider capabilities and operating-system restrictions MUST be validated before promising a feature.

**AW-TRUST-001 — Nonoptional trust control.** Authorization, privacy, and failure containment MUST apply to every execution path, including natural-language commands, direct UI actions, plugins, schedules, remote agents, automated handoffs, imported workflows, and debugging facilities.

**AW-TRUST-002 — No interface-based bypass.** An operation MUST have the same substantive authorization requirement whether invoked through a button, voice request, Contextual Command, terminal, workflow graph, agent delegation, REST interface, or a background rule.

**AW-TRUST-003 — One canonical policy authority.** Trust decisions MUST be evaluated by a defined policy enforcement layer, rather than relying on a model's promise to follow instructions or on UI-only hiding of dangerous controls.

**AW-TRUST-004 — Product versus backend capability.** Aerynth MUST distinguish capabilities it directly enforces from guarantees provided by Codex, operating systems, external connectors, hosted models, and remote services. Unsupported enforcement MUST NOT be presented as guaranteed.

**AW-TRUST-005 — Owner retains control.** Except for overriding legal or platform restrictions, Vela and subordinate agents MUST NOT grant themselves new permissions, change constitutional protections, erase required audit evidence, or suppress a user's access to policy settings.

**AW-TRUST-006 — Avoid unnecessary burden.** Safeguards MUST be risk-proportionate and designed around fast, intelligible, accessible interactions. Ordinary reading, note capture, workspace navigation, and other harmless actions SHOULD NOT require repeated consent dialogs.

### 1.1 Boundaries with other governing owners

- **03** owns resource identities, object associations, workspace organization, and the semantics of moving resources. **14** governs permission to access or mutate them.
- **04** owns conversation and branch structures. **14** governs access boundaries, publication, deletion authority, and cross-scope sharing.
- **05** owns task/agent lifecycle and handoffs. **14** governs delegated privileges and action authorization.
- **06** owns Vela's attention and adaptation decisions. **14** establishes limits those decisions cannot exceed.
- **07** owns note and knowledge behavior. **14** establishes storage, disclosure, and authorized capture boundaries.
- **08** owns context assembly and compaction. **14** establishes access-before-relevance, revocation, and confidential data handling.
- **09** owns event semantics and provenance. **14** establishes permitted collection, protection, retention, and review access.
- **10** owns token/profiler metrics. **14** governs any sensitive usage data and who may see or export it.
- **11** owns timeline/replay interaction. **14** governs access to and retention of replay evidence.
- **12** owns Codex/provider protocol integration. **14** establishes trust semantics across those boundaries.
- **13** owns platform implementation and resource budgets. **14** establishes desktop, OS, and background security requirements.
- **15** owns universal verification governance. **14** defines the mandatory security/privacy/autonomy scenarios.

---

## 2. Threat model and protected assets

The protection model MUST assume both accidental and deliberate misuse. Threat sources include ambiguous user instructions; mistaken model decisions; prompt injection in retrieved web pages, code, repository issues, chat logs, and tool outputs; compromised or overprivileged integrations; malicious extensions; stale authorization; shared-device exposure; endpoint compromise; accidental public commits; malicious or faulty background workflows; remote-host compromise; and interrupted or partially completed operations.

Aerynth does not promise perfect protection against a fully compromised operating system, administrator account, remote host, or external provider. Boundaries and residual risk MUST be stated honestly.

**AW-TRUST-007 — Asset inventory.** Security design MUST identify protected assets including conversations, notes, project knowledge, source repositories, local/remote files, credentials, connector data, private logs, usage analytics, approvals, event histories, automation policies, and profile/attention inferences.

**AW-TRUST-008 — Trust-boundary inventory.** Each integration MUST document where data or commands cross between: user/desktop UI; Aerynth controller; local services; Codex/model provider; tool/MCP/plugin; web or external content; remote operating system; external account; and public destinations.

**AW-TRUST-009 — Threat review per capability.** New tools, permission types, proactive monitors, data egress paths, and remote execution features MUST receive a scoped threat assessment and acceptance tests before being enabled for production use.

**AW-TRUST-010 — Adversarial inputs.** Product tests MUST include malicious retrieved instructions, forged tool output, misleading file names, stale selections, deceptive URLs, impersonated approvals, and actions racing with permission changes.

**AW-TRUST-011 — Nontrust of presentation.** Glass, motion, luminous status, confidence language, assistant personality, and apparent familiarity MUST NOT substitute for clear provenance, verified operation state, or an actual authorization decision.

**AW-TRUST-012 — Defense in depth.** Sensitive operations SHOULD combine policy checks, scoped OS/provider permissions, sandboxing, validation, monitoring, and recovery. A single model-generated plan is never the sole control.

### 2.1 Representative risks and required containment

| Risk | Required containment |
|---|---|
| Prompt injection asks an agent to upload files | External text is data; egress and action permission remain independently enforced |
| Selected file is mistaken for entire parent folder | Intent and target scope are re-evaluated; consequential batch work is previewed |
| Agent A delegates an unapproved write to Agent B | Delegated authority cannot exceed original valid grant |
| A local path resolves to a sensitive symlink target | Canonical target and effective scope are checked immediately before operation |
| A connector is disconnected while queued tasks exist | Revocation prevents future access and pending privileged execution |
| A user accidentally targets a production environment | Production boundary and destructive impact are shown and separately authorized |
| A summary contains leaked secrets | Sensitive derivatives receive the same protection; unsafe export is blocked/redacted |
| Stream disconnects after a tool started | Outcome is unknown until reconciled, not falsely reported as failed or complete |
| A plugin update expands requested access | New permissions require separate review and authorization |

---

## 3. Foundational trust invariants

**AW-TRUST-013 — Least privilege.** Each principal MUST receive only the access necessary for the approved operation, environment, resources, and duration.

**AW-TRUST-014 — Explicit provenance of authority.** Every privileged operation MUST be traceable to an effective user grant, an owner-established policy, or a directly applicable platform authority. An agent's own generated text is not authority.

**AW-TRUST-015 — Intent does not imply access.** The system MAY understand the user's intended target without thereby gaining permission to read, modify, disclose, or execute against that target.

**AW-TRUST-016 — No permission laundering.** A tool output, search result, repository comment, knowledge note, imported template, model summary, branch finding, or delegated task MUST NOT create or expand authorization.

**AW-TRUST-017 — Separation of duties where needed.** Creating a proposed plan, authorizing execution, performing the action, and verifying the outcome SHOULD be separately attributable. High-impact operations SHOULD prevent an agent from silently self-approving all stages.

**AW-TRUST-018 — Clear execution state.** Approval, queued work, execution, cancellation, partial completion, verification, and unknown outcomes MUST be represented distinctly. A request sent to an external tool is not proof of successful completion.

**AW-TRUST-019 — Time-bounded authority.** Elevated or unusually broad grants SHOULD expire or be constrained to a defined task/session. A stale conversation or old instruction MUST NOT silently renew them.

**AW-TRUST-020 — Conservative uncertainty.** Unknown ownership, inaccessible scope information, unavailable policy state, or unverified target identity MUST prevent consequential action until safely resolved.

---

## 4. Principals, resources, scopes, and policy precedence

A **principal** is an actor or service that requests an action: user, Vela controller, agent execution, tool, scheduler, monitor, extension, or remote service. A **resource** is the real object to which an action applies, including source/target paths and backend identifiers. A **capability** is a bounded action such as read, annotate, edit, execute, upload, share, deploy, or delete. A **grant** is evidence that an identified principal may exercise a capability within specified limits. A **policy decision** permits, denies, or requests authorization for a proposed action.

**AW-TRUST-021 — Structured authorization envelope.** Consequential requests MUST carry the effective actor, initiating user/task, operation type, target resource IDs, canonical paths where applicable, provider/host, project/workspace context, requested data flow, grant references, risk factors, and freshness/version information.

**AW-TRUST-022 — Effective inheritance.** Global, project, workspace, chat, agent, and task settings MAY set defaults; lower-scope preferences MUST NOT silently weaken higher-priority denials, credential restrictions, legal/platform constraints, or explicit user revocations.

**AW-TRUST-023 — Deny and revocation precedence.** Explicit denies, revoked grants, resource restrictions, and mandatory platform protections MUST override permissive defaults or previously generated plans.

**AW-TRUST-024 — Read and write are distinct.** Permission to view, index, search, quote, or summarize a resource MUST NOT implicitly authorize modification, redistribution, upload, execution, or publication.

**AW-TRUST-025 — Destination-sensitive policy.** External sharing MUST be evaluated for both the source and the destination. Access to a document in Project A does not automatically permit sending it to Project B, a plugin, hosted model, public GitHub repository, or remote server.

**AW-TRUST-026 — No identity confusion.** Resource display labels and user-friendly names MUST NOT substitute for stable identities; paths, cloud IDs, remote hosts, branches, and selected ranges MUST be resolved against the correct scope.

**AW-TRUST-027 — Policy decision explanation.** Users MUST be able to inspect effective permissions and their sources. Denials and approval prompts SHOULD identify the controlling rule without leaking hidden credentials or sensitive unrelated data.

**AW-TRUST-028 — Capabilities over unrestricted roles.** Implementations SHOULD favor narrow capability grants scoped to verbs/resources over broad administrator-like privileges. An elevated role MUST NOT bypass action classification or mandatory confirmations.

### 4.1 Required policy evaluation order

1. Identify the authentic requesting principal and the proposed action.
2. Resolve the interpreted resource set and data destinations.
3. Validate object identities, current state, ownership, and applicable environment.
4. Apply immutable platform restrictions, explicit denies, revocations, and higher-priority project controls.
5. Evaluate grant scope, expiry, risk tier, and delegation constraints.
6. Decide allow, require informed approval, or deny.
7. Revalidate before execution if scope or state can change.
8. Execute through a controlled adapter, observe outcome, and record appropriate evidence.

**AW-TRUST-029 — Server-side enforcement.** The policy decision MUST be enforced at the authoritative action boundary, not solely by UI previews or client-provided assertions.

**AW-TRUST-030 — Race-safe evaluation.** If relevant target set, permissions, host, destination, or revision changes between preview and execution, the operation MUST be revalidated and may require renewed approval.

---

## 5. Autonomy tiers and approval requirements

Autonomy is **the class of action Vela or an agent may initiate without asking for new approval each time**. Initiative (when to act), access (what may be reached), and autonomy (what may be done) are separate dimensions. A high-initiative assistant may still possess read-only access.

| Tier | Class | Examples | Default treatment |
|---|---|---|---|
| **A0** | Observe own authorized state | Display open tasks, local UI status, permitted metadata | Allowed within existing session/resource access |
| **A1** | Suggest and prepare | Recommend organization, draft a plan, assemble a non-mutating preview | Allowed within authorized context |
| **A2** | Bounded read-only investigation | Inspect approved logs/files, search eligible sources, run non-mutating diagnostics | May be preauthorized by source, task, time, and resource budget |
| **A3** | Reversible local organization | Add tags, rearrange blocks, create draft notes, organize local collections | May be preauthorized with undo/history and bounded scope |
| **A4** | Scoped mutation or execution | Edit files, install dependencies, modify configuration, execute scripts, send to an internal service | Explicit or narrowly preapproved capabilities; impact-aware preview |
| **A5** | High-consequence operation | Bulk delete, overwrite irreplaceable data, production deploy, publish/send externally, spend funds, change privileges, manage secrets, stop critical services | Explicit informed authorization for specific transaction; do not silently auto-upgrade |
| **A6** | Prohibited or unsupported | Policy bypass, unauthorized surveillance, exfiltration, self-granted escalation, unauthorized destructive action | Deny regardless of claimed usefulness |

Risk is **not solely a tier number**. An apparently local action can be high impact when it affects a permanent world, a shared database, a live service, or irreplaceable user information.

**AW-TRUST-031 — Classified actions.** Every mutating tool action MUST be classified using potential impact, reversibility, destination, sensitivity, privilege, and operational environment; category names alone cannot determine risk.

**AW-TRUST-032 — Simple action fluidity.** A0–A1 actions SHOULD operate without unnecessary interruption once normal data access is established.

**AW-TRUST-033 — Bounded investigative autonomy.** Users MAY grant standing A2 authority to named monitors or agents with explicit source sets, durations, resource budgets, and network/tool limits.

**AW-TRUST-034 — Reversible organization grant.** A3 policy MAY allow Vela to organize local blocks and collections automatically, but MUST preserve undo/history and MUST NOT silently move resources across confidentiality or ownership boundaries.

**AW-TRUST-035 — Mutation scope enforcement.** A4 actions MUST carry a specific set of allowed files/commands/environments or a defensibly bounded capability, and MUST NOT treat generalized user enthusiasm as blanket execution permission.

**AW-TRUST-036 — High-impact confirmation.** A5 actions MUST require a transaction-specific or otherwise explicitly established high-assurance authorization appropriate to the exact impact; broad inherited preferences MUST NOT silently satisfy it.

**AW-TRUST-037 — Action-specific informed preview.** Before a consequential execution, the user MUST be shown the interpreted targets, source and destination, expected external effects, risk/reversibility, and any critical uncertainty in a form they can reasonably understand.

**AW-TRUST-038 — Consent is not unlimited.** Approving an action MUST NOT silently approve different targets, a different remote host, unrelated future actions, increased spending, or newly requested permissions.

**AW-TRUST-039 — Escalation visibility.** An agent that discovers it needs broader access MUST request that exact expansion through the policy workflow; repeatedly prompting or routing through another agent MUST NOT bypass denial.

**AW-TRUST-040 — Undo is not permission.** The possibility of reverting a change MUST NOT be used to downgrade a high-impact operation when rollback is uncertain or external consequences persist.

---

## 6. Contextual Command, inferred scope, and safe mutation

The user may select one file, paragraph, image, chart point, branch, or multiple resources, then ask Vela to act on a broader or narrower context. The semantic selection is **evidence of referents**, not an authorization grant or immutable scope. Natural-language understanding is valuable; preview and execution must remain precise.

**AW-TRUST-041 — Scope and selection separation.** Intent interpretation MUST distinguish user-selected objects, mentioned objects, inferred containing scopes, excluded objects, and actual requested targets.

**AW-TRUST-042 — Explicit user correction.** A correction such as “only the highlighted file” MUST replace a prior broad scope estimate; any prepared approvals or manifests inconsistent with the correction MUST be invalidated.

**AW-TRUST-043 — Bulk change preview.** When the requested action is consequential and affects more resources than directly selected, the system MUST make the expansion visible, including count, representative targets, source/destination, exclusions, and unresolved ambiguity.

**AW-TRUST-044 — Preview versus execution.** A preview or dry-run result MUST be distinguishable from a completed operation. An agent MUST NOT mark tasks complete simply because a plan or preview succeeded.

**AW-TRUST-045 — Stable target manifest.** Consequential batch operations SHOULD use a versioned target manifest with resolved identities and a clear decision about how to handle targets that change before execution.

**AW-TRUST-046 — No surprise data movement.** Selecting or previewing a private resource MUST NOT cause its full content to be uploaded, indexed externally, or sent to a model/provider without an applicable data-transfer authorization.

**AW-TRUST-047 — Safe interpretation on ambiguity.** When two interpretations materially differ in damage, destination, disclosure, or privilege, Aerynth MUST clarify or present a scoped preview; it MUST NOT silently choose the broader high-impact interpretation.

**AW-TRUST-048 — Undo and compensation.** Supported local mutations SHOULD provide an undo plan or transactional rollback. For external actions that cannot be truly undone, the interface MUST state this and distinguish compensation from reversal.

### 6.1 Example: a file selected inside a directory

The user highlights one file but says “move all files from this folder to backups.” Vela may infer the parent folder as the source; the target set is not limited to the highlighted file. Before moving, the system resolves the current folder, shows the batch count and destination, evaluates overwrite and sensitive-file risks, and confirms according to the effective policy. “Move only the highlighted one” narrows the manifest and invalidates the previous broader plan.

### 6.2 Filesystem-specific safeguards

**AW-TRUST-049 — Canonical path validation.** Filesystem actions MUST defend against path traversal, symbolic-link/junction redirection, cross-volume surprises, race conditions, protected paths, and substitutions between preview and execution.

**AW-TRUST-050 — Source/destination verification.** File moves, exports, copies, restores, and deletions MUST validate both ends, conflicts, permissions, and applicable overwrite behavior.

**AW-TRUST-051 — Irreplaceable-state protection.** Live databases, Minecraft worlds, production configurations, private archives, and user documents MUST NOT be treated as safely isolated merely because source-code Git worktrees exist. Appropriate backups, snapshots, locks, staging, or maintenance gates are required.

**AW-TRUST-052 — No hidden recursion.** A tool call requested against a single file MUST NOT silently expand to recursive directory modification unless explicitly authorized and represented in the approved scope.

---

## 7. Delegation, agents, workflows, and remote execution

Vela may coordinate many agents and optimize latency or cost by parallelizing independent work. Every delegated execution remains subject to the original user/policy authority and the applicable environment's capabilities.

**AW-TRUST-053 — Delegation is attenuation.** A child agent, temporary specialist, subtask, tool, or workflow step MUST receive no more authority than the intersection of the delegator's valid capability and that step's specific need.

**AW-TRUST-054 — Privilege does not follow relationship.** Membership in the same project, task group, connected branch family, workspace, or agent constellation MUST NOT automatically grant file, network, credential, or external-service access.

**AW-TRUST-055 — Independent approval for expanded risk.** Changing a read-only investigation into a mutating fix, or local analysis into remote production deployment, MUST trigger fresh policy evaluation and authorization as required.

**AW-TRUST-056 — Task isolation.** Concurrent agents MUST use appropriate isolation, integration controls, and shared-state coordination. Contention for live mutable resources MUST be serialized or otherwise explicitly controlled.

**AW-TRUST-057 — Remote identity and host clarity.** Remote operations MUST bind to a specific authenticated host/environment and show material distinctions between local, staging, and production targets.

**AW-TRUST-058 — Bounded remote grants.** SSH, remote tool execution, and hosted agents MUST use scoped credentials, network boundaries, environment limits, and revocable access appropriate to the task.

**AW-TRUST-059 — Offline and disconnection policy.** Loss of the controller, model provider, remote channel, or approval service MUST NOT silently convert an operation to unrestricted background execution.

**AW-TRUST-060 — Unattended workflow policy.** Recurring and event-triggered workflows MUST have an inspectable owner, trigger, scope, schedule/condition, privileges, notification behavior, resource budget, and stop mechanism.

**AW-TRUST-061 — Bounded chaining.** Autonomous handoffs MUST enforce limits on recursion, time, tool calls, or resource consumption as configured. A feedback loop MUST NOT create indefinite tasks or unbounded spending.

**AW-TRUST-062 — No concealed persistence.** Tasks and agents that continue after a window closes or the user leaves MUST be identified as background activity, with accessible pause/stop and a clear indication of which service remains alive.

**AW-TRUST-063 — Safe stop.** Stop and revocation controls MUST prevent new steps promptly, request cancellation of cancellable operations, and disclose already-committed actions or tasks that cannot be interrupted.

**AW-TRUST-064 — Production safeguards.** Deployments, externally visible releases, public commits, irreversible migrations, and critical service mutations MUST use explicit environment-specific authorizations plus applicable tests, backups, and review gates.

---

## 8. Monitoring, ambient awareness, initiative, and attention

Vela's awareness MUST be grounded in authorized application state, opt-in monitoring, indexed references, and real event history. “Always aware” means durable and retrievable context, not covert continuous observation or an eternally running model.

**AW-TRUST-065 — Source-specific opt-in.** Monitoring of external applications, active-window titles, screenshots, microphone, camera, clipboard, global input, browser activity, file-watch paths, or remote devices MUST require distinct discoverable permission according to the sensitivity of each source.

**AW-TRUST-066 — No implicit surveillance.** Using Quick Capture, opening a workspace, enabling notifications, or linking a project MUST NOT silently enable broader desktop, audio, clipboard, or filesystem monitoring.

**AW-TRUST-067 — Capture indicators.** Sensitive live capture (especially microphone, camera, screen, and remote sessions) MUST have meaningful operating-system and/or in-app indicators and direct stop access when supported.

**AW-TRUST-068 — Attention signals minimized.** Gaming/focus adaptation SHOULD rely on coarse permissioned signals such as foreground full-screen state, process category, resource pressure, and focus mode rather than collecting unnecessary detailed application contents.

**AW-TRUST-069 — Separable controls.** The user MUST be able to enable/disable initiative, notification categories, monitoring sources, adaptive behavior, and autonomous action separately. One toggle MUST NOT masquerade as consent for all of them.

**AW-TRUST-070 — No learned privilege escalation.** Dismissal patterns, preferred layouts, frequently approved commands, response style, and other learned habits MUST NOT silently weaken approval requirements or enlarge data/monitoring scope.

**AW-TRUST-071 — Permission-aware notification content.** Ambient notifications and welcome-back digests MUST avoid exposing sensitive titles, excerpts, credentials, screenshots, or cross-project data on locked, shared, or unexpected displays.

**AW-TRUST-072 — Quiet operation with limits.** Aerynth SHOULD defer nonurgent interruptions during focus, full-screen activity, or user-defined quiet periods. It MUST preserve appropriate visibility for critical incidents without falsely claiming to know what the user is doing.

**AW-TRUST-073 — Monitor shutdown and review.** Each enabled monitor MUST show its source, purpose, collection scope, recent access where available, retention, last-seen status, and a working disable/revoke control.

**AW-TRUST-074 — No autonomous consent evolution.** Vela MAY suggest revised initiative or privacy settings but MUST NOT treat passive behavior as informed permission for materially different surveillance, external sharing, or high-risk action.

---

## 9. Data classification, confidentiality, and context transfer

Aerynth handles multiple content types across local files, chat histories, project knowledge, linked services, telemetry, and remote tools. Their sensitivity must follow the underlying data, not the superficial block, visual view, or model-friendly summary.

| Class | Examples | Required treatment |
|---|---|---|
| Public | Intentionally public specifications, already public repository metadata | May be processed within valid tool policy |
| Internal | Ordinary project plans, nonpublic code, private chats, local settings | Scoped access; no implicit public/external disclosure |
| Sensitive | Personal notes, private documents, proprietary code, account metadata, detailed activity history | Strong access controls and minimized sharing |
| Restricted | Credentials, tokens, recovery keys, highly sensitive personal data, privileged production access | Secret-specific handling, sharply limited access and retention |

Classes are conceptual; exact labels may be refined during implementation without weakening obligations.

**AW-TRUST-075 — Classification before transit.** Data SHOULD be classified at source or on discovery, and its sensitivity MUST be considered before model submission, plugin use, search indexing, log emission, export, or sharing.

**AW-TRUST-076 — Derivatives inherit restrictions.** Summaries, embeddings, snippets, thumbnails, translated text, copied chat excerpts, profiler traces, and transformed artifacts MUST inherit relevant source confidentiality and revocation obligations.

**AW-TRUST-077 — Least-data model requests.** CIE and integration adapters MUST only send authorized task-relevant information to the chosen provider; a higher relevance score MUST NOT override privacy boundaries.

**AW-TRUST-078 — Scope-limited cross-project transfer.** Cross-project or cross-branch retrieval MUST preserve original access control; a linked resource, graph edge, smart collection, or shared tag is not an access grant.

**AW-TRUST-079 — External egress declaration.** Before first use of a sensitive connector or model endpoint, users MUST be able to understand the destination class and categories of information the operation may transmit; high-impact disclosures require transaction-specific approval.

**AW-TRUST-080 — No secret exfiltration by explanation.** Vela's answers, previews, error messages, search snippets, hover text, and activity summaries MUST NOT disclose restricted source data to an unauthorized recipient or display.

**AW-TRUST-081 — Purpose limitation.** Data collected for usage optimization, focus detection, crash reporting, or proactive alerts MUST NOT be repurposed for unrelated profiling or external transmission without appropriate authorization.

**AW-TRUST-082 — Configurable telemetry.** Optional usage/diagnostic collection and remote reporting MUST be explicitly disclosed, limited, and controllable; necessary local security evidence may have separate minimum retention justified by the trust model.

**AW-TRUST-083 — Offline-first confidentiality.** Functions requiring only local state SHOULD work without network access. Local-only content MUST NOT be silently synchronized or forwarded when online connectivity returns.

---

## 10. Credentials, authentication, connections, and sandboxing

**AW-TRUST-084 — Protected secret storage.** Long-lived secrets MUST use a dedicated credential facility appropriate to the platform (such as an OS-backed secret store), not plaintext project files, unprotected logs, frontend state snapshots, or general-purpose knowledge indexes.

**AW-TRUST-085 — Secret isolation.** Raw secret values MUST NOT be injected into ordinary agent prompts, notes, analytics, event streams, crash reports, UI screenshots, or public repositories. Tools SHOULD use handles, narrowly scoped brokers, or short-lived credentials when possible.

**AW-TRUST-086 — No secret reflection.** Tools and terminal adapters MUST redact or suppress known secret-bearing fields and apply safe treatment to error output. Sensitive payloads that cannot be sanitized MUST be kept in appropriately restricted storage/viewers.

**AW-TRUST-087 — Credential lifecycle.** Connections MUST support status inspection, expiry handling, revocation/disconnection, and reauthorization, without implying revocation at the upstream provider unless confirmed.

**AW-TRUST-088 — Provider policy visibility.** The product MUST distinguish local encryption/access control from external provider retention, logging, and data-processing rules. The interface MUST NOT promise that submitting data to a hosted model is equivalent to keeping it local.

**AW-TRUST-089 — Sandbox truthfulness.** If a backend cannot enforce requested filesystem, network, process, or tool restrictions, Aerynth MUST surface the limitation and block operations that require that protection.

**AW-TRUST-090 — Tool-specific boundaries.** Terminal, MCP/plugin, browser, computer-use, repository, and SSH tools MUST have independently declared scopes, effective privileges, and audit/approval paths.

**AW-TRUST-091 — Authentication integrity.** Login, connection, and approval flows MUST bind decisions to the correct account/session/host; untrusted web content, agent output, or rendered UI text MUST NOT be able to impersonate the trusted approval surface.

**AW-TRUST-092 — Elevation containment.** OS/admin rights, provider-wide tokens, network access, and remote root privileges MUST not be the default for routine agent work. Temporary elevation requires explicit bounded authorization.

### 10.1 Prompt-injection and content provenance

**AW-TRUST-093 — External content is untrusted instruction-wise.** Pages, code comments, commit messages, issue bodies, emails, logs, downloaded documents, test fixtures, agent-generated summaries, and tool outputs MAY be evidence, but MUST NOT independently grant authority or override system/user policy.

**AW-TRUST-094 — Untrusted-to-privileged separation.** Retrieved instructions that ask to ignore safeguards, reveal secrets, invoke tools, modify scope, or redirect output MUST be treated as untrusted content and evaluated against the user's actual request and independent policy.

**AW-TRUST-095 — Source-aware context.** Prompt/context assembly SHOULD preserve source identity and trust level so quoted external text is not misrepresented as the user's direct instruction.

**AW-TRUST-096 — Browser safety.** Embedded browsing and computer use MUST respect origin boundaries, prevent untrusted pages from spoofing trusted permission UI, and require effective authorization for file downloads, uploads, external form submission, and account-affecting actions.

**AW-TRUST-097 — Extension supply chain.** Plugins and extensions SHOULD declare capabilities, publisher/signature or source provenance where supported, version, requested scope, and update behavior. Material permission expansion MUST trigger new review.

---

## 11. Storage, retention, deletion, export, and backups

“History is preserved” means preserved **under the effective retention policy**, not forever in defiance of an explicit deletion request. CIE compaction, UI archiving, and cache eviction have different meanings from deletion of canonical records.

**AW-TRUST-098 — Data inventory and lifecycle.** Each data family MUST have documented owner, storage locations, sensitivity, retention rule, backup behavior, exportability, and deletion/revocation semantics.

**AW-TRUST-099 — Independent data controls.** Users MUST be able to distinguish: hide/archive; remove a local copy; remove from indexes; delete canonical local content; request upstream provider deletion where supported; revoke future access; and stop future capture.

**AW-TRUST-100 — Honest deletion claims.** Aerynth MUST NOT claim “deleted everywhere” unless confirmed across applicable local, synced, remote, backup, and provider scopes; unavailable upstream deletion or delayed backup expiry MUST be disclosed.

**AW-TRUST-101 — Derived-data invalidation.** Authorized deletion or permission revocation MUST stop future retrieval and invalidate applicable embeddings, summaries, search results, cached previews, branch knowledge, and other derived access paths.

**AW-TRUST-102 — Audit/data separation.** Security audit records MAY retain minimal noncontent evidence where justified by disclosed retention policy, but MUST NOT be used to retain private source content after that source should be inaccessible.

**AW-TRUST-103 — Backup confidentiality.** Backups MUST respect sensitivity classification, access protection, key handling, and disclosed retention; restores MUST not unintentionally resurrect revoked access or obsolete unsafe configuration.

**AW-TRUST-104 — Export clarity.** Exports MUST state included data categories, formats, encrypted/sensitive material treatment, known omissions, and external-provider limitations. Exporting private project data to a public path requires appropriate approval.

**AW-TRUST-105 — Retention configuration.** Default retention values MUST be documented and reviewed before implementation; automatic expiration, archival, and erasure controls SHOULD be configurable within justified product/platform constraints.

**AW-TRUST-106 — Portable and recoverable ownership.** Where backend APIs permit, users SHOULD be able to export conversations, notes, resource relationships, layouts, preferences, evidence indexes, and relevant policy history in documented interoperable formats.

**AW-TRUST-107 — Secure disposal qualification.** The system MUST NOT promise cryptographically certain deletion from SSDs, backups, logs, or third-party providers when it cannot establish that outcome; it SHOULD use appropriate key destruction, cache invalidation, and supported deletion mechanisms.

---

## 12. Observability, approvals, and audit evidence

The Intelligence Event Bus and profiler can help explain agent behavior, but they also create sensitive records. The monitoring and replay experiences must not become privacy bypasses.

**AW-TRUST-108 — Privileged action evidence.** High-impact operations and permission changes MUST produce a durable, attributable minimum audit record that captures request, interpreted targets, decision, grant basis, execution attempt, observed result, and unresolved uncertainty, without unnecessarily retaining private contents.

**AW-TRUST-109 — Evidence provenance.** Audit records MUST distinguish actual user approval, preexisting policy authorization, Vela suggestion, delegated request, model-reported outcome, and tool-confirmed result.

**AW-TRUST-110 — No fabricated thought disclosure.** Intelligence Streams and Vela explanations MUST NOT claim to reveal inaccessible internal chain-of-thought, hidden tool activity, or events that were never captured. Available reasoning summaries must remain labeled as summaries.

**AW-TRUST-111 — Private diagnostics.** Agent traces, terminal logs, tokens, timing, context manifests, filenames, selected text, and replay history MUST be subject to the same effective user/project/privacy scope as the underlying sources.

**AW-TRUST-112 — Approval surface integrity.** Approval prompts MUST be distinguishable from content supplied by external websites, agents, or plugins, and MUST resist clickjacking or deceptive placement as far as the chosen platform allows.

**AW-TRUST-113 — Action history visibility.** Users MUST be able to inspect recent autonomous actions and approval decisions, filter by task/agent/project, and identify which operation was actually verified versus merely proposed.

**AW-TRUST-114 — No silent evidence gaps.** Interrupted streams, failed audit writes, unavailable histories, and out-of-order events MUST be surfaced when relevant. Critical operations MUST NOT continue under a policy that requires audit evidence when the required recorder is unavailable.

**AW-TRUST-115 — Protected audit access.** Audit read, export, modification, and retention controls MUST be permissioned; ordinary agents MUST NOT be able to erase or rewrite their own privileged-action evidence.

**AW-TRUST-116 — Privacy-preserving visual behavior.** Spatial agent views, notifications, replay animations, and timelines MUST not disclose details beyond the viewer's effective permissions; visual relationships themselves can be sensitive.

---

## 13. Revocation, stopping, partial failure, and incident response

Aerynth will coordinate long-running operations, which means revocation and recovery are first-class product features. A permission change during a job is not merely a settings update; it affects active capabilities.

**AW-TRUST-117 — Revocation propagation.** Removing a grant MUST block new actions depending on it and trigger invalidation of affected sessions, queued work, cached authorization, context shares, and connector references.

**AW-TRUST-118 — In-flight reality.** The system MUST disclose that already completed external side effects, dispatched emails, published commits, consumed tokens, or running remote operations might not be fully reversible by revoking future permission.

**AW-TRUST-119 — Safe reauthorization.** Resuming a paused or revoked task MUST revalidate current resource/host identity, tool capability, source freshness, remaining scope, and the relevant approvals.

**AW-TRUST-120 — Partial-commit visibility.** Interrupted bulk operations MUST preserve a recoverable manifest of completed, failed, pending, and uncertain steps where supported, rather than presenting a binary false success/failure.

**AW-TRUST-121 — Emergency pause.** The user MUST have a prominent way to halt new autonomous actions globally and by project/task, including an explanation of which already-running operations cannot be interrupted immediately.

**AW-TRUST-122 — Graceful security failure.** Missing credentials, inconsistent policy state, disconnected remote hosts, backend errors, or unavailable consent records MUST fail closed for affected privileged operations while preserving safe local navigation and access to retained data.

**AW-TRUST-123 — Incident handling.** The engineering process MUST define how to report, diagnose, contain, and remediate suspected unauthorized access or data disclosure, including preserving relevant redacted evidence and protecting user data during investigation.

**AW-TRUST-124 — Recovery exercises.** Backup/restore, denied approvals, crash recovery, revoked source handling, disconnected agent recovery, and policy database migration MUST be tested against representative failure cases before related features reach acceptance.

---

## 14. Settings, explainability, and accessible design

Trust controls must feel native to Liquid Intelligence. The settings environment may be deeper and more technical than the day-to-day workspace, but the controls must be understandable, discoverable, and consistent.

**AW-TRUST-125 — Inherited settings transparency.** Effective security/initiative settings MUST reveal their source (global/project/workspace/chat/agent/task), overrides, and any higher-priority restriction preventing further relaxation.

**AW-TRUST-126 — Separate permission from preference.** Appearance, animation, notification style, and learned organizational habits MAY adapt automatically within approved bounds; permission scope, data sharing, monitoring enablement, and high-impact authorization MUST remain distinct explicit controls.

**AW-TRUST-127 — Action-oriented previews.** Consent/approval UI SHOULD describe practical effects using targets, counts, environment, destination, and reversibility rather than only technical permission jargon.

**AW-TRUST-128 — Accessible authorization.** Approvals, denials, stop controls, scope explanations, redaction notices, and risk indicators MUST remain usable by keyboard and with reduced motion and other applicable accessibility settings; color or animation alone is insufficient.

**AW-TRUST-129 — No dark patterns.** The product MUST NOT disguise denial, use misleading default selections for sensitive permissions, make cancellation materially harder than approval, or pressure users to expand access for cosmetic convenience.

**AW-TRUST-130 — Transparent adaptation.** Users MUST be able to inspect, correct, disable, and where appropriate remove learned preferences and their source observations. An adaptation explanation MUST NOT invent evidence or imply higher data access than actually occurred.

---

## 15. Conceptual policy and audit contracts

The following are **logical contracts**, not mandated JSON wire formats or claims about current Codex APIs. The exact implementation may use Rust types, database tables, a capability broker, local service IPC, or another validated architecture.

### 15.1 ActionRequest

Required conceptual fields:
- Unique request and correlation IDs; initiator and actual execution principal.
- Task, chat, agent, project, workspace, and source-selection references where applicable.
- Requested verb and specific capability; explicit/inferred scope and exclusions.
- Stable resource identities, canonical local/remote targets, host/environment, expected version.
- Data sources and intended destinations; network/egress classification.
- Impact, reversibility, sensitivity, risk tier, and estimated blast radius.
- Proposed execution plan, preview manifest, and required grant references.
- Current trust-policy version, time of evaluation, and freshness constraints.

### 15.2 PolicyDecision

Required conceptual fields:
- Decision: allow, deny, or approval required.
- Evaluated principal, operation, resolved targets, and policy version.
- Effective grant/scope, rationale and controlling requirement category.
- Expiry, conditional constraints, and whether user confirmation is needed.
- Safe remediation for denial without leaking sensitive information.

### 15.3 ApprovalRecord

Required conceptual fields:
- Immutable approval request reference and human-authoritative decision.
- Exact approved operation, destinations, target manifest/version, risk information shown.
- Identity/session assurance appropriate to the operation.
- Decision time, expiry, one-use or scoped-reuse rules, and revocation pointer.
- Cross-reference to eventual observed tool outcome, including partial/unknown state.

### 15.4 DataPolicyDescriptor

Required conceptual fields:
- Data type, owning subsystem, sensitivity, allowed uses and viewers.
- Local and external storage locations or provider categories.
- Index/embedding/summary derivative rules; sharing/egress limits.
- Retention, backup, export, deletion, revocation, and audit minimums.
- User-visible consent state and any platform-enforced limitations.

**AW-TRUST-131 — Stable policy contracts.** Security-sensitive adapters MUST exchange structured authorization outcomes or capability-bound tokens rather than relying solely on informal prompts or human-readable permission descriptions.

**AW-TRUST-132 — Audit contract integrity.** Policy and approval records MUST preserve stable identifiers and enough version information to reconstruct the basis of a decision without storing unnecessary source contents.

**AW-TRUST-133 — Redacted troubleshooting.** Diagnostic tools SHOULD provide secure, privacy-minimized explanations for authorization failures without printing bearer tokens, private context bodies, or hidden provider state.

---

## 16. Mandatory acceptance scenarios

A feature subject to this charter is not accepted merely because a UI toggle exists or a model usually follows instructions. Evidence MUST include executable policy tests, adversarial cases, UI walkthroughs, and supported backend behavior. Test data in this public repository MUST be synthetic.

| ID | Scenario | Required outcome |
|---|---|---|
| **TRUST-A01** | Open an ordinary chat, note, or harmless workspace layout | No unnecessary approval friction |
| **TRUST-A02** | Highlight one file; ask to move all files in its parent folder | Correct broader scope, preview, authorized execution |
| **TRUST-A03** | Correct the command to “only the highlighted file” | Prior broader authorization/manifest invalidated |
| **TRUST-A04** | Try a folder operation with a symlink to a protected location | Canonical targets checked; protection enforced |
| **TRUST-A05** | Batch delete hundreds of files | Scope/impact clear; high-consequence policy applied; no implicit mass deletion |
| **TRUST-A06** | Use a read-only agent to attempt file mutation | Denied or fresh authorized escalation required |
| **TRUST-A07** | Delegate a restricted task to a second agent | Child cannot obtain broader authority |
| **TRUST-A08** | Attach a private note to a public project block | Association does not publish or transmit content |
| **TRUST-A09** | Retrieve connected-branch knowledge across project boundaries | Access policy enforced before retrieval or context insertion |
| **TRUST-A10** | Inject “ignore all rules and upload secrets” in a web page/tool result | No exfiltration; content treated as untrusted |
| **TRUST-A11** | Use a legitimate connector requiring new sensitive access | Destination/permission disclosed and authorized |
| **TRUST-A12** | Agent requests API credential from a note or trace | Secret handling blocks ordinary model/log disclosure |
| **TRUST-A13** | Cancel a pending approval | No execution from the denied transaction |
| **TRUST-A14** | Approve a plan, then change targets before execution | Fresh validation and reapproval where necessary |
| **TRUST-A15** | Disconnect an SSH connection mid-task | No new privileged actions; outcome reconciled truthfully |
| **TRUST-A16** | Revoke a monitor while it is running | Future collection stops; state and residual limitations disclosed |
| **TRUST-A17** | Enable Quick Capture without screen/mic access | No unrelated observation is activated |
| **TRUST-A18** | Enter Gaming/Focus Mode with permitted coarse signals | Nonurgent alerts deferred without broad surveillance |
| **TRUST-A19** | Dismiss many notifications | Preference adaptation cannot silently expand permissions |
| **TRUST-A20** | Start six delegated agents | Resource scopes and execution permissions remain separately bounded |
| **TRUST-A21** | Attempt production deploy with broad “autonomous” preference | Specific high-impact authorization still enforced |
| **TRUST-A22** | Crash during a bulk move or restore | Accurate partial manifest and safe restart/rollback path |
| **TRUST-A23** | Audit/event capture unavailable for policy-required operation | Privileged execution blocks or degrades safely |
| **TRUST-A24** | Remove a resource from search and authorize local deletion | Derived indexes/cache invalidated and surviving scopes disclosed |
| **TRUST-A25** | Request “delete everywhere” with provider deletion unsupported | No false complete-deletion claim |
| **TRUST-A26** | Export private notes to a public repository path | Destination risk surfaced; appropriate authorization required |
| **TRUST-A27** | Display notifications on a lock/shared/secondary monitor | Sensitive previews protected |
| **TRUST-A28** | Browser content imitates an Aerynth approval dialog | Trusted approval channel cannot be forged by page content |
| **TRUST-A29** | Update a plugin that asks for broader permissions | New scope is not silently inherited |
| **TRUST-A30** | Kill backend while a task is active | Status reflects disconnected/unknown, not fabricated completion |
| **TRUST-A31** | Use an unsupported sandbox capability | Honest limitation and safe block for tasks requiring enforcement |
| **TRUST-A32** | Reduce-motion, keyboard-only consent flow | Approval, denial, scope and stop remain accessible |
| **TRUST-A33** | Restore backup after permission revocation | Revoked scope is not silently resurrected |
| **TRUST-A34** | Replay an agent's execution | Only authorized evidence shown; event gaps/estimates identified |
| **TRUST-A35** | User triggers global emergency pause | New autonomous actions stop; in-flight limitations shown |
| **TRUST-A36** | Inspect what Vela learned from usage | Specific inference, source type, correction/disable controls available |

### 16.1 Acceptance evidence expectations

For each applicable scenario, capture:
1. Initial principal, permissions, resource/sensitivity state, and test fixture.
2. User command or triggering event and structured interpreted target manifest.
3. Policy decision including effective grant, required confirmation, and policy version.
4. Actual tool/provider execution evidence or proof of denial.
5. Observed local/external effects, including uncertain or partial outcomes.
6. Audit and UI evidence, plus accessibility and recovery verification where applicable.

**AW-TRUST-134 — Gate on actual enforcement.** No high-risk feature MAY be declared complete on simulated approvals, client-only restrictions, model self-restraint, or screenshots without corresponding action-boundary tests.

**AW-TRUST-135 — Regression protection.** Changes to trust policies, context sharing, agent delegation, storage, plugin access, or approvals MUST include negative-path and concurrency regression tests.

---

## 17. Traceability and cross-charter responsibilities

| Requirement group | Canonical subject | Constitutional anchors | Key interfaces |
|---|---|---|---|
| AW-TRUST-001–012 | Scope and threat modeling | AW-CON-002, 069–073, 085–089 | 06, 12, 15 |
| AW-TRUST-013–030 | Trust invariants and policy model | AW-CON-022–025, 069–073 | 03, 04, 05, 12 |
| AW-TRUST-031–040 | Autonomy tiers and approvals | AW-CON-039, 069–073 | 05, 06, 12 |
| AW-TRUST-041–052 | Contextual Command and filesystem safety | AW-CON-022–025, 044 | 01, 03, 06 |
| AW-TRUST-053–064 | Agents and remote autonomy | AW-CON-042–046, 069–073 | 05, 06, 12, 13 |
| AW-TRUST-065–074 | Monitoring and attention | AW-CON-036–041, 069–073 | 06, 09, 13 |
| AW-TRUST-075–083 | Data classification and egress | AW-CON-034, 053, 071 | 04, 07, 08, 10 |
| AW-TRUST-084–097 | Credentials, sandboxes, injection | AW-CON-069–073, 081 | 08, 12, 13 |
| AW-TRUST-098–107 | Retention, deletion, export | AW-CON-034, 053, 071, 082 | 03, 04, 07, 08, 09 |
| AW-TRUST-108–116 | Protected observability and audit | AW-CON-057–061, 070–073 | 09, 10, 11 |
| AW-TRUST-117–124 | Revocation and recovery | AW-CON-069–073, 087 | 05, 06, 12, 13 |
| AW-TRUST-125–135 | UX, contracts, acceptance | AW-CON-014, 079–089 | 01, 02, 15, 16 |

### 17.1 Constitutional accountability checklist

- **AW-CON-069:** All agents, plugins, remote tools, and monitors have bounded authority with enforceable scopes.
- **AW-CON-070:** Consequential actions receive proportionate informed approvals, preview, and inspectable results.
- **AW-CON-071:** Private notes, credentials, histories, telemetry, and derivatives remain protected; public repository content is synthetic or authorized public.
- **AW-CON-072:** Monitoring, learned preferences, remote connections, and schedules have transparent inspect/limit/disable/revoke controls.
- **AW-CON-073:** Outages, interrupted streams, failed commands, and partial mutations degrade safely without fabricated outcomes.
- **AW-CON-022–025:** Semantic selection, scope, confirmation, and undo semantics preserve user intent.
- **AW-CON-034 / 053:** Compaction and archival preserve canonical history under explicit retention while authorized deletion and revocation remain meaningful.
- **AW-CON-039:** Adaptive learning never becomes permission escalation.
- **AW-CON-060:** Replay claims only captured, properly authorized evidence.
- **AW-CON-086–087:** Completion requires tested security, privacy, and recovery outcomes, not UI appearance.

---

## 18. Implementation phases and required decision records

This charter does not mandate a single security technology. It mandates that engineering decisions evaluate actual backend/platform guarantees and record tradeoffs before declaring enforcement.

### Gate T0 — Threat and permission model
- Asset inventory, attacker assumptions, principal/resource model, trust boundaries, action taxonomy, and risk tiers approved.
- Decision records for local identity model, settings inheritance, trusted approval UI, and policy enforcement boundary.

### Gate T1 — Secure local foundation
- Safe storage for secrets and sensitive notes; permissioned local actions; minimal logs; tested denial paths.
- File scope validation, undo/partial operation manifest, recoverability checks, and synthetic privacy fixtures.

### Gate T2 — Codex and tool integration
- Provider capability matrix and limitations; secret injection controls; tool sandbox verification; prompt-injection handling.
- Structured approval/denial plumbing and durable event correlation demonstrated end-to-end.

### Gate T3 — Vela, agents, monitors, and autonomy
- Delegation attenuation, scoped background permissions, emergency pause, monitoring consent, attention-safe notifications.
- Tests for concurrent changes, revoked grants, stale contexts, remote disconnects, and long-running tasks.

### Gate T4 — Production and extensibility readiness
- Retention and deletion policies, backups, portability, extension supply-chain review, incident plan, and recurring security evaluation.
- No production-ready claim without applicable acceptance evidence and outstanding risk decisions recorded.

**AW-TRUST-136 — Capability gating.** Features needing unavailable OS/provider security guarantees MUST remain disabled, clearly experimental, or reduced to a verifiably safe subset until the required controls exist.

**AW-TRUST-137 — Formal risk acceptance.** Any intentional deviation from SHOULD-level safeguards, or temporary acceptance of material residual risk, MUST be documented with rationale, affected scope, mitigations, verification, and explicit owner decision; no MUST-level constitutional safeguard may be silently waived.

---

## 19. Research questions and deferred implementation choices

The following remain decisions to research and validate, **not settled facts**:

1. Which application shell and local-service architecture provide the strongest reliable approval-UI isolation and secure IPC with the required Liquid Intelligence rendering performance?
2. How will principal identity work for a single-user desktop prototype versus shared accounts, remote sessions, and future multi-device synchronization?
3. Which Codex App Server versions expose the necessary tool, approval, sandbox, and streaming controls, and which protections belong to Aerynth's independent adapters?
4. How should capability tokens or scoped grants be represented and revoked across process boundaries?
5. Which local encryption, OS credential-store, and secure backup mechanisms are appropriate on each supported platform?
6. What exact default retention periods, log detail levels, event sampling thresholds, and audit minimums should ship? These require a documented privacy/product decision, not guesses here.
7. Which trust-impacting operations can be transactionally rolled back, and which require compensating actions or staging environments?
8. What computer-use and browser integrations can be safely bounded by origin, application, selected object, and active display?
9. How should user-approved remote execution handle offline hosts, revoked keys, host replacement, and long-running unattended work?
10. How can synthetic threat fixtures and automated penetration/security tests cover malicious prompts, plugin updates, approval spoofing, and cross-project leakage?
11. Which third-party dependencies or connectors create unavoidable external data transfers, and what disclosures are required?
12. How should the application reconcile imported settings, stale backups, provider deletion limits, and cross-device policy conflicts?

None of these open questions permits bypassing this charter's invariants in the meantime.

---

## 20. Change control, publication, and owner acceptance

This is an **owner-ratified governing charter (2026-11-05)**. Publication alone had not provided approval; that separate owner decision is now recorded. Implementation and release evidence remain outstanding.

Changes to normative IDs, privacy guarantees, model/provider access assumptions, permissions, audit semantics, or deletion behavior MUST receive an impact review covering affected charters, data migrations, regression tests, user-visible policy changes, and rollback or remediation.

**AW-TRUST-138 — Stable requirement IDs.** Existing requirement identifiers MUST remain stable for unchanged meanings; substantive changes MUST be versioned and reviewed for traceability.

**AW-TRUST-139 — No silent narrowing.** A convenient prototype, unsupported provider action, or shortened implementation schedule MUST NOT quietly redefine trust and autonomy expectations. A missing capability must be declared, deferred, or substituted by an approved safe alternative.

**AW-TRUST-140 — Owner acceptance.** The repository owner explicitly accepted this charter on 2026-11-05 and the governance registry records its binding status. Publication alone does not ratify future amendments and owner design approval does not replace security, privacy or release verification.

### Owner-review checklist

- [ ] The charter enables easy everyday chat, navigation, notes, and organization without intrusive approvals.
- [ ] All native and external action paths share the same real authorization boundary.
- [ ] Selection is correctly treated as context, while the user controls action scope.
- [ ] Mutations and external disclosures show understandable preview and permission.
- [ ] High-impact actions cannot inherit blanket permission from habit learning or delegation.
- [ ] Remote hosts, staging, live services, and irreplaceable mutable state have explicit safeguards.
- [ ] Source-specific monitoring permission and notification privacy are clearly specified.
- [ ] Notes, chats, model context, embeddings, and observability derivatives preserve access boundaries.
- [ ] Credentials, prompts, tool outputs, and plugins have independently defensible trust controls.
- [ ] Revocation, deletion, disconnection, and partial outcomes have honest and testable behavior.
- [ ] Audit records are useful without becoming a private-data leak.
- [ ] Trust controls remain understandable, accessible, visually coherent, and reversible when possible.
- [ ] No unsupported provider guarantee is asserted as already implemented.
- [ ] Synthetic acceptance evidence covers privileged success and failure paths.

---

**Final governing standard:** Aerynth must be extraordinary in capability, fluid in interaction, proactive in service, and unmistakably accountable to the user. **Vela may anticipate needs, organize complexity, and delegate work, but every authority she exercises must remain bounded, understandable, revocable where possible, and verifiable.** Trust is what allows intelligent autonomy to feel effortless rather than dangerous.

---

## Ratified amendment CF-2026-11-05: API agents and capability-first trust

> **Status: Owner-ratified 2026-11-05; implementation acceptance is a separate gate.** More capable tools increase the importance of existing least-privilege boundaries; they do not create exceptions.

**AW-TRUST-141 — Permission independence.** AI inference, route classification, tool discovery and agent delegation MUST NOT grant authority. The application enforces effect-specific authorization at execution time for every direct, nested, programmatic, MCP or managed tool call.

**AW-TRUST-142 — Principal inheritance.** All delegated workers MUST inherit a no-broader authority set than the initiating task, with bound scopes, resources, environment, budget, lifetime and consent provenance. A hosted subagent may not self-enroll a privileged MCP endpoint.

**AW-TRUST-143 — Data transfer classification.** Before external inference or file/screenshot/audio transfer, the runtime MUST evaluate source data class, selected scope, provider region, retention terms, user intent and redaction. Tool discovery and stored retrieval do not authorize uploading an entire local repository or private history.

**AW-TRUST-144 — Backend credential integrity.** OpenAI API credentials and third-party secrets MUST remain in OS-protected or backend-only storage, never model prompts, frontend bundles, source control, screenshots, public telemetry or rich client error output. Temporary session credentials MUST be bounded.

**AW-TRUST-145 — Managed-environment distinction.** A cloud or self-hosted sandbox MUST have documented trust boundaries; a managed Agents API session MAY persist data and may not qualify for Zero Data Retention. A self-hosted executor does not by itself change provider-side retention guarantees.

**AW-TRUST-146 — Effect claim before action.** Potentially irreversible or externally visible actions MUST use reviewed scope and a durable idempotency/effect claim where feasible. Unknown execution results MUST be reconciled using real evidence, not automatic retries.

**AW-TRUST-147 — Safe computer use.** Screen interaction MUST be authorized by selected device/window and action class. Screen observation, screenshot processing and computer-control capability are distinct; a visual button match does not authorize clicking it.

**AW-TRUST-148 — Guard against source instructions.** Retrieved web pages, repository files, MCP descriptions, tool outputs, voice transcripts and visual content MUST be treated as untrusted task data unless explicitly designated governing user/system instruction by a trusted path.

**AW-TRUST-149 — Spend consent.** Subscription grants and purchased credits are separate resources. Vela MUST respect account/org spending ceilings and user-defined task limits, with explicit paused/blocked states rather than unannounced purchases or hidden capability reduction.

**AW-TRUST-150 — Voice microphone and replay.** Microphone access and transcript persistence MUST require visible controls and appropriate consent. Restart/reconnection MUST not play previously delivered speech or reactivate recording without qualifying current permission.

**AW-TRUST-151 — Revocation while active.** Removing an agent, tool, connector, screen or workspace permission MUST invalidate cached capability exposure and block future effects; in-flight and already completed external work requires separately communicated uncertainty and containment.

**AW-TRUST-152 — User-readable action receipts.** Consequential actions MUST be attributable to the canonical request, actual principal and approved scope, with safe redacted records of result and readback. Reasoning confidence cannot replace this evidence.

**AW-TRUST-153 — Safe fallback.** An unavailable or privacy-ineligible high-capability provider MUST produce an explicit denied/unavailable state or an independently authorized fallback, never a covert provider transfer or false completed result.

**Mandatory negative tests:** injected MCP instruction tries to widen privileges; subagent attempts forbidden tool; tool allowed at discovery is revoked before call; ambiguous external write is re-requested; private screenshot tries to upload without scope consent; subscription credits exhausted and auto-recharge off; voice wake without consent. See [contract](../docs/specifications/VELA-PROVIDER-TOOL-AND-AGENT-CONTRACTS.md).

