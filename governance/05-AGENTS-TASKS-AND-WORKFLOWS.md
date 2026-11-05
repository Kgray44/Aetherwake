# 05 — Agents, Tasks, and Workflows
## Persistent Objectives, Specialized Workers, Responsible Delegation, and Outcome-Oriented Orchestration for Aerynth

| Field | Value |
|---|---|
| Document ID | AW-GOV-005 |
| Version | 1.0.0-draft |
| Status | **Published proposed subsystem charter — awaiting repository-owner acceptance** |
| Prepared | 2026-11-01 |
| Authority | Subsystem charter, subordinate to [00 — The Aetherwake Constitution](00-AETHERWAKE-CONSTITUTION.md) |
| Primary domain | Agent identities and profiles; persistent tasks; executions; delegation; groups; dependencies; isolation; workflows; handoffs; results and completion semantics |
| Normative requirement namespace | **AW-ATW-###** |
| Constitutional anchors | AW-CON-001–003, 006, 011–015, 022–028, 031–046, 051–060, 062–064, 069–083 |
| Direct neighboring charters | [03 Projects and Resources](03-PROJECTS-WORKSPACES-AND-RESOURCES.md); [04 Conversations](04-CONVERSATIONS-AND-CONNECTED-BRANCHES.md); [06 Vela](06-VELA-INTELLIGENCE-AND-ADAPTATION.md); [08 CIE](08-CONTEXT-INTELLIGENCE-AND-MEMORY.md); [09 Observability](09-INTELLIGENCE-STREAMS-AND-OBSERVABILITY.md); [12 Codex](12-CODEX-EXECUTION-AND-INTEGRATIONS.md); [14 Trust](14-TRUST-PRIVACY-AND-AUTONOMY.md); [15 Quality](15-QUALITY-VERIFICATION-AND-ACCEPTANCE.md); [16 Engineering](16-ENGINEERING-AND-DELIVERY.md) |
| Implementation posture | Technology-neutral product obligations and interface boundaries; specific scheduler, provider, process and isolation implementations require verification |
| Public repository rule | Only synthetic examples; do not publish private conversations, personal notes, credentials, identifiable telemetry or real operational logs |

> **Governing promise.** Aerynth MUST let a user simply converse when conversation is all they need, or turn an expressed goal into coordinated, purposeful work involving one or many specialized agents. A task is a durable commitment to an outcome, not the life of a chat window. Delegation must preserve intent, authority, constraints, evidence, and accountability.
>
> **One task, many possible executions.** Investigation, implementation, testing, review, integration, deployment and verified outcomes are different claims. Work is never considered complete merely because an agent stopped talking, emitted a success message, ran a command, or produced a plausible plan.
>
> **Useful parallelism, not agent theater.** Aerynth SHOULD choose the smallest effective set of agents and workflows capable of delivering a reliable result. More agents, more tokens, more animated nodes, and more parallel commands are not measures of success.

---

## 1. Authority, scope, and interpretation

This charter is the canonical governing home for **agent/task/workflow product semantics**: persistent agent identity and configuration; task identity, decomposition, assignment, dependencies, execution attempts and outcome stages; orchestration decisions; multi-agent coordination; isolation; handoffs; workflows; failure recovery; and reporting.

It governs what Aerynth must guarantee to the user. It does **not** pick a final database, programming language, scheduler, desktop renderer, model, or executable runtime. It does not assert that any specific Codex version exposes a given feature; [Charter 12](12-CODEX-EXECUTION-AND-INTEGRATIONS.md) owns capability discovery and provider contracts.

The Constitution has higher authority. The repository owner retains approval authority under its amendment procedure. **MUST**, **MUST NOT**, **SHOULD**, and **MAY** use constitutional meanings. This charter's numbered requirements define narrower, testable behavior inside this domain. Other domains remain governed by their own charters.

**AW-ATW-001 — Single domain owner.** Agent, task, execution, delegation and workflow semantics MUST have one canonical definition under this charter. Other documents MAY reference these definitions but MUST NOT silently create incompatible lifecycle or completion rules.

**AW-ATW-002 — Ordinary chat is not a task prerequisite.** A user MUST be able to use Codex-style conversations without creating agents, tasks, workflows, projects, approval queues, or formal work packages.

**AW-ATW-003 — Outcome-first design.** Task orchestration MUST optimize for verified, user-valued outcomes rather than activity counts, plans produced, tool invocations, conversation length, or number of agents.

**AW-ATW-004 — Honest scope of implementation.** Simulated workers, mock schedules, unsupported backend features, proposed plans, queued jobs and completed executions MUST be distinguishable from genuinely running, supported and verified functionality.

**AW-ATW-005 — No implicit governance amendment.** Neither a task prompt nor an agent's planning or delegation decision may override the Constitution, accepted governance, or current authorization boundaries.

### 1.1 Normative vocabulary

| Concept | Meaning | Not equivalent to |
|---|---|---|
| **Agent** | Persistent or temporary worker identity with a configurable capability and policy profile | A chat, model, operating-system process, or task |
| **Agent profile** | Versioned instructions, model preferences, skills, tools, environment and execution defaults | Proof the provider supports all configured capabilities |
| **Chat / conversation** | Independently useful communication resource with its own history | A task, worker identity, or completed deliverable |
| **Backend thread** | Provider-specific conversation/session handle | Canonical Aerynth conversation ID |
| **Task** | Persistent desired outcome with requirements, constraints, dependencies and acceptance evidence | A message, chat, prompt or provider turn |
| **Subtask** | Task with an explicit relation to a parent task, retaining its own state and acceptance | A casual bullet in a plan |
| **Execution / attempt** | A recorded effort to advance a task, using an agent and one or more provider turns/tools | The task itself or proof of success |
| **Assignment** | Time-bounded, inspectable binding of a task to an authorized agent | Ownership of the user's resources or permanent permission |
| **Plan** | Proposed decomposition, order and strategy with estimates and assumptions | Guaranteed progress or verified completion |
| **Workflow** | Reusable graph of triggers, steps, conditions, approvals, outcomes and recovery behavior | A single shell command or conversation |
| **Agent group** | Logical team of workers executing related assignments with explicit coordination | Unlimited mutual authority or shared memory |
| **Orchestrator** | Policy-constrained coordinator selecting actions, assignments and dependencies | A permission authority or privileged user |
| **Handoff** | Structured transfer of task state/evidence/responsibility across agents or conversations | Copying an entire transcript into a new prompt |
| **Artifact** | Output produced by a run, with identity, provenance and access controls | Verified or accepted result by default |
| **Verification** | Evidence-based examination against defined criteria | An agent's self-assessment |
| **Integration** | Controlled incorporation of changes into a target environment | Automatic consequence of a passing test |
| **Approval** | Scoped, attributable authorization decision | Unlimited trust in an agent or workflow |
| **Capability snapshot** | Provider/environment feature availability under actual configuration | Requested features in a profile |

## 2. Foundational invariants

These invariants apply across restarts, provider disconnections, chat forks, agent changes, worktree creation, project moves and orchestration retries.

**AW-ATW-006 — Distinct identities.** Agents, chats, tasks, executions, workflow definitions, workflow runs and artifacts MUST receive separate stable application-level identities. Their relationships MUST be explicit rather than conflated through a provider thread ID, filename or UI position.

**AW-ATW-007 — Identity outside presentation.** A task or agent MUST survive the removal, relocation, collapse or duplication of its workspace block. Multiple views of one object MUST not manufacture duplicate agents or executions.

**AW-ATW-008 — Persistence.** Task objectives, lifecycle transitions, ownership history, constraints, decisions, dependencies, evidence, and recoverable state MUST survive application restart according to retention policy. Runtime liveness MUST be revalidated, not assumed from saved status.

**AW-ATW-009 — Provenance.** Changes to objectives, assignments, priorities, dependencies, acceptance criteria, work products and status MUST be attributable to a user, assistant, agent, workflow or imported system event, with timestamp and source where available.

**AW-ATW-010 — No false completion.** A stopped run, ended chat, created PR, committed file, passing command, or agent assertion MUST NOT alone set a task to verified complete.

**AW-ATW-011 — No silent scope expansion.** Delegation MUST NOT expand resource access, data-sharing privileges, write permissions, external authority, budget ceilings or workspace scope beyond effective policy.

**AW-ATW-012 — No blind history replication.** Agent/task handoffs and cross-agent sharing MUST use relevant, source-linked context; complete conversation histories and full project contents MUST NOT be redistributed by default.

**AW-ATW-013 — User control.** Users MUST be able to inspect, pause where supported, cancel, reprioritize, redirect and review tasks and authorized workflows; exact provider limitations and effects MUST be explained.

**AW-ATW-014 — Consistent source of truth.** The canonical task state MUST be reconciled from durable task records, validated execution events, approval decisions and verification evidence. UI animations MUST NOT establish task state independently.

**AW-ATW-015 — Partial and unknown are first-class.** Partial success, blocked work, stale status, uncertain execution, unavailable provider data and conflicting evidence MUST remain visible and distinguishable from success or failure.

## 3. Agents: identities, profiles, and capabilities

Aerynth supports both reusable specialists and temporary task-scoped agents. An agent's role is a configurable identity, not a promise that it is always executing.

**AW-ATW-016 — Durable agent identity.** A reusable agent MUST retain its application identity, profile versions, authorized resource associations, assignment history and relevant durable task knowledge independently of any single chat or provider connection.

**AW-ATW-017 — Ephemeral agents.** Temporary agents MAY be created for scoped missions. Their termination MUST NOT remove retained task evidence, artifacts, approvals or required audit records.

**AW-ATW-018 — Profile composition.** An agent profile SHOULD support a human-readable name, purpose, specialties, instructions, model preference, reasoning effort, skills, tools, environment, access policy, output contract, review policy, context strategy, budget and reporting preferences.

**AW-ATW-019 — Versioned effective configuration.** Assignments and executions MUST record the effective, resolved profile version and material overrides. Changing a saved agent profile MUST NOT silently rewrite the configuration of historical attempts.

**AW-ATW-020 — Inherited settings.** Agent settings MUST resolve coherently with global, project, workspace, chat and execution scopes under [Charter 03](03-PROJECTS-WORKSPACES-AND-RESOURCES.md) and provider constraints under [Charter 12](12-CODEX-EXECUTION-AND-INTEGRATIONS.md). The UI MUST show relevant inherited values and overrides without overwhelming routine chat use.

**AW-ATW-021 — Capability gate.** Before assigning work, the orchestrator MUST verify or explicitly flag the required effective model, tools, skill availability, environment, credentials and permissions. A configured capability MUST NOT be mistaken for an available capability.

**AW-ATW-022 — Separation of role and authority.** Labels such as "Senior Engineer", "Reviewer", "Administrator" or "Integration Agent" are descriptions, not permission grants. Authorization is evaluated separately.

**AW-ATW-023 — Custom specialists.** Users MUST be able to create, duplicate, edit, disable, export where safe, and assign reusable specialist profiles without changing the underlying Codex provider.

**AW-ATW-024 — Profile discoverability.** Assignment interfaces SHOULD recommend suitable agents using task requirements and proven capabilities while showing why they match, any missing skills, and relevant costs or constraints.

**AW-ATW-025 — Independent availability.** "Ready", "busy", "offline", "needs setup", "disabled", "not supported" and "unknown" MUST be distinguishable. Saved agent existence does not imply a running backend process.

**AW-ATW-026 — Agent reporting preferences.** Profiles SHOULD support reporting to the initiating chat, Vela, a specified task owner, a collection, or a combination, subject to access and attention policies. Reports MUST preserve authorship and source references.

## 4. Persistent tasks and task contracts

A task is the durable record of desired work. It may begin from an explicit form, a conversational request, a workflow, an imported issue, or an authorized autonomous suggestion.

**AW-ATW-027 — Task without ceremony.** Aerynth MUST support creating tasks conversationally and from Contextual Command, selected text, notes, files, images, documents, charts, or another typed resource without forcing a large manual task form.

**AW-ATW-028 — Minimum task contract.** A task MUST store a stable ID, concise goal, originating actor/source, effective project or unassigned scope, requested outcome, lifecycle state, creation time, and links to supporting context. Where applicable, it MUST store constraints, acceptance criteria, priority, dependencies, authority, resource scope, assigned agents, evidence and requested reporting destination.

**AW-ATW-029 — Task definition evolution.** Objective, scope and acceptance-criteria changes MUST be versioned and attributable. An agent MUST NOT silently redefine a task to match whatever work it happened to complete.

**AW-ATW-030 — No forced project.** Tasks MAY exist outside formal projects or workspaces. Later association with a project MUST preserve task identity and history.

**AW-ATW-031 — Resources and relationships.** Tasks MUST use the canonical resource relationships from [Charter 03](03-PROJECTS-WORKSPACES-AND-RESOURCES.md) to link conversations, notes, files, agents, workspaces, repository changes, artifacts, timeline nodes and evidence; visual blocks MUST only project those relationships.

**AW-ATW-032 — Ownership and delegation history.** Tasks MUST expose current assignee(s), initiating actor, active execution(s), delegation chain and previous assignment changes.

**AW-ATW-033 — Priority and urgency.** Priority, urgency, deadlines and criticality SHOULD be separate concepts. A user or policy change to priority MUST not automatically falsify dependency feasibility or grant increased authorization.

**AW-ATW-034 — Acceptance readiness.** A task SHOULD have verifiable completion criteria before consequential execution. For exploratory work, "produce a sourced diagnosis/recommendation" MAY itself be the defined outcome.

**AW-ATW-035 — Ambiguity handling.** The system SHOULD resolve minor ambiguity through available context and clearly visible assumptions. It MUST request necessary clarification or preview when unresolved ambiguity could cause material harm, irreversible changes or incorrect target selection.

**AW-ATW-036 — Candidate versus committed task.** Extracted conversational suggestions, detected to-dos, proposed subtasks and estimates MUST remain distinguishable from user-requested or autonomously authorized executable assignments.

## 5. Task lifecycle and independent outcome dimensions

A single scalar progress percentage cannot truthfully represent the work. Aerynth must track **operational state** separately from **delivery and verification state**.

### 5.1 Required operational state vocabulary

At minimum, the product must represent:

| State | Meaning |
|---|---|
| Draft / proposed | Identified but not yet committed for execution |
| Ready | Defined, eligible and appropriately authorized to start |
| Queued | Accepted for scheduling but not currently executing |
| Running | Observably executing under a known run or lease |
| Waiting | Awaiting a dependency, external condition, tool response, approval or capacity |
| Paused | Execution or scheduling suspended with known recovery semantics |
| Blocked | Cannot proceed under current constraints |
| Recovering | Reconciling after a failure, disconnect or uncertain attempt |
| Failed | Attempt or task reached a defined failure condition |
| Canceled | Canceled by user or authorized policy |
| Superseded | Replaced by another explicitly linked task |
| Closed | Administrative closure, with outcome explicitly recorded |

The exact internal implementation MAY use different codes but MUST preserve distinctions in user-facing views and exports.

### 5.2 Required delivery dimensions

Each applicable task MUST independently represent whether it has been:

1. **Investigated**: evidence gathered and findings recorded.
2. **Planned**: work strategy and acceptance criteria prepared.
3. **Implemented**: requested change or artifact actually produced.
4. **Validated**: appropriate automated/manual tests executed with outcomes.
5. **Reviewed**: necessary independent or human review completed.
6. **Integrated**: changes incorporated into the intended target.
7. **Deployed/applied**: changes reached the actual requested environment, when applicable.
8. **Outcome-verified**: expected result observed with supporting evidence.
9. **Accepted**: authorized owner accepted the outcome.

These dimensions are **not** universal mandatory sequential stages. A research-only task may legitimately end after an accepted evidence-backed investigation; a documentation task need not deploy an application. The task's acceptance contract determines required stages.

**AW-ATW-037 — State orthogonality.** Operational liveness, delivery stage, verification result and acceptance MUST be represented independently. A failed test may coexist with a successful implementation attempt; a finished execution may belong to an uncompleted task.

**AW-ATW-038 — Evidence-gated transitions.** State transitions claiming achieved outcomes MUST reference the evidence, verification decision or accountable actor that justifies them. Unobserved stages remain not-run/unknown, not implicitly passed.

**AW-ATW-039 — No percentage fabrication.** Progress percentages MAY be shown only when supported by a declared and comprehensible model, such as weighted milestones; elapsed time, tool calls or streamed tokens alone MUST NOT be converted into arbitrary completion percentages.

**AW-ATW-040 — Completion truth.** "Execution completed", "task delivered", "task verified" and "user accepted" MUST be separately expressible in UI, reports, APIs and notifications.

**AW-ATW-041 — Reopening and revision.** A closed or accepted task MAY be reopened or superseded with explicit history. Its earlier accepted state and evidence MUST remain attributable rather than being retroactively rewritten.

**AW-ATW-042 — Terminal states and cleanup.** Failure, cancellation and closure MUST trigger controlled release of execution leases, worktree ownership and temporary resources without destroying source history or other workers' changes.

## 6. Executions, provider turns, and assignment ownership

**AW-ATW-043 — Attempt identity.** Each execution MUST have an immutable attempt ID, task association if any, agent and profile snapshot, selected provider/environment, start/end or unknown-state timestamps, effective permissions, model/settings snapshot where available, and captured status/evidence links.

**AW-ATW-044 — Attempt multiplicity.** A task MAY have multiple sequential or parallel attempts. Retrying, switching agents, forking conversations and resuming provider threads MUST create or clearly associate distinguishable attempts rather than overwriting an earlier attempt.

**AW-ATW-045 — One active mutation owner per conflict domain.** The orchestrator MUST define a concurrency protocol for shared writable resources and MUST NOT silently grant conflicting writers unrestricted authority to the same target.

**AW-ATW-046 — Bounded execution.** Where mechanisms exist, executions SHOULD have declared limits for time, tool use, retries, budget, CPU/memory impact, network scope and simultaneous operations; unsupported hard limits MUST be distinguished from advisory targets.

**AW-ATW-047 — Provider mapping.** Provider threads, turns and tool items MUST be mapped to canonical Aerynth attempt and chat identities without assuming one-to-one mapping or stable cross-provider IDs.

**AW-ATW-048 — Liveness verification.** Saved "running" state MUST be reconciled after app restart, provider reconnect, SSH loss, crash, orphaned process, or lease expiry; unknown outcome MUST not be displayed as completed or still running without evidence.

**AW-ATW-049 — Cancel semantics.** The UI MUST distinguish "cancel requested", "provider turn interrupted", "local process terminated", "remote job still possible", and "confirmed stopped" when meaningful. Cancellation MUST NOT imply a rollback of earlier side effects.

**AW-ATW-050 — Safe reruns.** Rerun and resume behavior MUST state whether steps may repeat, their side effects and idempotency guarantees. Tasks with unknown outcomes MUST reconcile external state before retrying risky mutations.

## 7. Chat-to-task promotion and contextual delegation

Aerynth's conversational experience remains a first-class way to discover work. Task creation may occur **after** a discussion, with the original chat preserved.

**AW-ATW-051 — Conversational extraction.** A user MUST be able to say the equivalent of "split these discussed tasks and get them started" in an ordinary chat. Aerynth MUST interpret the relevant conversation and selected resources, identify concrete objectives, constraints, priorities, dependencies, and acceptance expectations, then construct task proposals or authorized assignments.

**AW-ATW-052 — Original conversation preservation.** Promotion to tasks MUST NOT replace, truncate, silently fork away, archive or rewrite the initiating conversation. New tasks and associated chats MUST link back to source message ranges.

**AW-ATW-053 — Scope follows intent.** Selected text or resources provide context; the user's explicit instruction determines intended scope. "This excerpt", "all tasks we discussed", "all files in this folder", and "only the highlighted one" MUST be resolved distinctly under Charters 01 and 14.

**AW-ATW-054 — Efficient launch.** For actions clearly authorized and bounded, the user SHOULD be able to approve or invoke a multi-task launch without repetitive one-by-one setup. Permission barriers MUST remain proportionate to risk.

**AW-ATW-055 — Launch explanation.** Before a nontrivial multi-agent launch, the system SHOULD show tasks, agents, dependency order, context sources, affected resources, expected authority and budget; omissions, assumptions and unresolved conflicts MUST be surfaced.

**AW-ATW-056 — Chat continuity.** The initiating chat MUST remain usable while delegated tasks run in linked conversations, and task reports MUST be capable of returning to that chat or Vela without mutating earlier messages.

**AW-ATW-057 — Highlight-to-work.** Selecting a paragraph, code diff, image, document section, chat message, task or timeline interval SHOULD support relevant actions such as explain, investigate, delegate, compare, convert to task or attach as evidence, subject to capability and policy.

**AW-ATW-058 — No task-only coercion.** Aerynth MUST NOT turn every ordinary request into formal tasks, require a coordinator to answer trivial queries, or obstruct direct chatting with Codex.

## 8. Planning, decomposition, and orchestration decisions

Vela may coordinate, but the orchestration engine owns durable scheduling and enforcement. Model-generated plans are proposals until validated against requirements, capacity and policy.

**AW-ATW-059 — Task-aware decomposition.** Decomposition SHOULD yield independently testable units with explicit deliverables, assumptions, dependency edges, integration points, conflict domains and report-back contracts.

**AW-ATW-060 — Bounded task graphs.** The task graph MUST detect invalid cycles, missing dependencies, inaccessible resources and contradictory requirements before treating the graph as executable; unsatisfied constraints MUST be visible.

**AW-ATW-061 — Right-sized parallelism.** Agent count MUST be selected based on expected net benefit, critical path, resource constraints, tool availability, token usage, merge complexity, shared-state conflicts and risk; the maximum permitted count MUST NOT be the default.

**AW-ATW-062 — Work versus coordination overhead.** Aerynth SHOULD estimate when parallel delegation would be slower or costlier than one worker. It SHOULD select a single worker or direct deterministic operation when that better satisfies the request.

**AW-ATW-063 — Deterministic before model calls.** Pure resource navigation, state queries, known dependency checks, scheduled transitions and simple batch operations SHOULD use native application operations when possible rather than unnecessary model turns.

**AW-ATW-064 — Capacity-aware scheduling.** Scheduling SHOULD account for provider rate/usage limitations, worker concurrency, host CPU/RAM/GPU pressure, disk budgets, network limits, user activity and priority classes. Capacity exhaustion MUST cause an honest queue/wait state rather than silent loss of work.

**AW-ATW-065 — Priority fairness.** The scheduler SHOULD preserve user-prioritized objectives while preventing starvation where feasible. Preemption MUST respect side-effect safety and recovery semantics.

**AW-ATW-066 — Dependency-aware progression.** Dependent tasks MUST NOT execute prohibited downstream steps before required predecessor evidence or artifacts exist. Ready/blocked transitions SHOULD be updated when dependencies change.

**AW-ATW-067 — Read/write conflict analysis.** The planner MUST identify expected shared mutable resources and specify isolation, exclusive ownership, partitioning or serialized integration before simultaneous writes.

**AW-ATW-068 — Plan revisions.** Replanning MUST preserve the original requested outcome, disclose changed assumptions, and version material dependency, budget, or deliverable changes. A model MUST NOT silently lower acceptance criteria to make a plan appear successful.

**AW-ATW-069 — Forecast honesty.** Task duration and completion forecasts MUST communicate uncertainty, prerequisites and source of estimate. They MUST NOT be presented as guaranteed deadlines. Timeline rendering and replay remain governed by Charter 11.

**AW-ATW-070 — Human override.** Users MUST be able to override suggested agent assignment, scheduling priority or acceptable parallelism within enforced permission and platform boundaries.

### 8.1 Representative decomposition

For "Finish the transport systems and review NPC changes", an acceptable task graph might comprise: (a) zipline controls and verification, (b) railway implementation and validation, (c) NPC change review, and (d) integration following required checks. If two tasks modify a shared configuration file, they must be isolated or sequenced. Aerynth must not claim the railway is complete because the "railway" conversation ended.

## 9. Delegation, group coordination, and reporting

**AW-ATW-071 — Attributed delegation.** Every delegation MUST carry initiator/parent task, delegated objective, assignee, effective resource authority, source evidence, expected deliverable, and report-back destination.

**AW-ATW-072 — No authority laundering.** An agent receiving a task MUST NOT use further delegation, another tool, another provider, or a workflow step to evade a denied permission or expand authority.

**AW-ATW-073 — Agent teams.** Aerynth SHOULD support logical groups with named roles, shared objectives, defined communication channels, ownership boundaries, and configurable coordination behavior.

**AW-ATW-074 — Independent attempts, correlated outcomes.** Child tasks and agents SHOULD retain their independent activity streams while remaining correlated to the parent. A parent may aggregate results but MUST NOT overwrite child histories.

**AW-ATW-075 — Report-back contract.** A delegated result MUST distinguish completed deliverables, source links, verified checks, failures, unresolved questions, side effects, open dependencies and recommended next steps. Report text MUST NOT impersonate an originating user or Vela.

**AW-ATW-076 — Selective collaboration.** Cross-agent discoveries MUST use source-attributed knowledge references and approved scope; connected-chat or branch access MUST be mediated under [Charter 04](04-CONVERSATIONS-AND-CONNECTED-BRANCHES.md) and CIE, not by unrestricted shared transcript injection.

**AW-ATW-077 — Consolidation with disagreement.** The orchestrator MUST preserve materially conflicting findings and their evidence instead of silently choosing the most confident-sounding agent. It SHOULD initiate targeted reconciliation when warranted.

**AW-ATW-078 — Assistant distinction.** Vela's persistent coordination identity MUST remain separate from replaceable specialist agents and ephemeral executions. Vela's initiative, personality and notification behavior remain governed by Charter 06.

**AW-ATW-079 — No recursive runaway.** Delegation chains MUST be bounded by policy for depth, breadth, tool access, budgets and time. Child agents MUST inherit restrictions at least as strong as their parent task's effective boundaries.

**AW-ATW-080 — User-facing responsibility.** Every active group MUST have an inspectable owner/coordinator and an intelligible explanation of which worker is responsible for which deliverable.

## 10. Isolation, Git worktrees, and non-Git shared state

Git worktrees are important for independent code changes, but do not isolate arbitrary game worlds, databases, cloud resources or hardware.

**AW-ATW-081 — Isolation choice.** Each execution that may mutate shared state MUST declare its isolation strategy: separate worktree, distinct branch/repository, container/VM, staging dataset, locked shared target, serialized change, or another tested mechanism.

**AW-ATW-082 — Git is not universal isolation.** Agents MUST NOT assume that worktrees protect untracked paths, common caches, package registries, live databases, game worlds, remote services, hardware, or identical external deployment targets.

**AW-ATW-083 — Resource leases.** For shared writable non-Git targets, the orchestrator SHOULD use identifiable ownership leases or equivalent coordination with expiration/reconciliation behavior, and MUST prevent known incompatible concurrent mutations.

**AW-ATW-084 — External side effects.** Remote commands, production changes, plugin operations, purchases, messages, deployment actions and filesystem mutations MUST respect the effective trust policy regardless of task origin or agent role.

**AW-ATW-085 — Integration ownership.** Aerynth MUST distinguish parallel development from final integration. Merging or deploying results MUST occur through an authorized, conflict-aware process with explicit outcome verification.

**AW-ATW-086 — Worktree lifecycle.** Worktrees and temporary environments MUST have attributable ownership, purpose, cleanup rules, and safeguards against destroying user modifications or another agent's unmerged work.

**AW-ATW-087 — Shared-state disclosure.** When an assignment would touch a resource already being modified elsewhere, Aerynth MUST expose the conflict and a safe resolution path rather than silently starting conflicting workers.

**AW-ATW-088 — Protected target changes.** Changes to protected branches, production environments, persistent game worlds, user data, and hardware control SHOULD require explicit risk-based checks, backup/staging where appropriate, and enforceable approvals under Charter 14.

## 11. Context packages, handoffs, and persistent task memory

The CIE is responsible for relevance, retrieval and compaction algorithms. This charter governs **what task continuity must preserve**.

**AW-ATW-089 — Task context manifest.** Before execution, the system SHOULD assemble a traceable context manifest with objective, constraints, current task state, required knowledge, selected source references, relevant artifacts, environment and permissions. It MUST identify important context that is unavailable or stale when material.

**AW-ATW-090 — Relevance, not volume.** Handoffs and delegations MUST favor scoped, attributable sources rather than unbounded history copying. Critical requirements MUST NOT be excluded merely to satisfy a token target.

**AW-ATW-091 — Durable handoff checkpoint.** A handoff MUST preserve at least task identity, goal, material constraints, known state, decisions, relevant evidence, modified resources, outstanding risks, validation status, remaining steps, and source references, subject to access policy.

**AW-ATW-092 — Original evidence retained.** Summaries and checkpoints MUST NOT replace retained original evidence unless the user explicitly invokes a supported deletion/retention policy. A checkpoint MUST NOT claim lossless completeness if it omits material.

**AW-ATW-093 — Versioned handoff.** Task handoffs SHOULD carry a version and originating execution, enabling the recipient to detect changes to task scope, source material or artifacts since checkpoint creation.

**AW-ATW-094 — Safe continuation.** A replacement agent MUST be able to assess whether previous work was implemented, verified, approved and integrated before continuing. It MUST NOT repeat unsafe side effects solely because a handoff omitted them.

**AW-ATW-095 — Knowledge state distinction.** User notes, speculative findings, verified project decisions, inferred facts and formal requirements MUST retain their classifications and provenance when included in a task context.

**AW-ATW-096 — Branch-aware collaboration.** Post-fork sibling discoveries MAY be selectively retrieved for a task, but MUST retain source identity and not collapse independent histories.

**AW-ATW-097 — Context inspection.** Users SHOULD be able to inspect the application-managed context sources used for assignment, identify inclusion/exclusion decisions, and request eligible additions, subject to provider transparency limits.

**AW-ATW-098 — Historical continuity, bounded prompt.** Tasks SHOULD support continuation across many agent runs and chats without requiring one indefinitely growing active model context.

## 12. Workflow definitions, triggers, and the visual composer

A workflow is a first-class reusable object, not an opaque macro of unrelated chats.

**AW-ATW-099 — Workflow identity and versions.** Each workflow MUST have stable identity, versioned definition, owner, trigger conditions, steps, dependencies, input/output contracts, declared side effects and policy references. Historical runs MUST reference the definition version actually executed.

**AW-ATW-100 — Executable graph.** Workflows SHOULD support typed nodes for triggers, deterministic actions, AI/agent tasks, parallel groups, decisions/conditions, approvals, timers or waits, verification, notifications and terminal outcomes.

**AW-ATW-101 — Dataflow validity.** Workflow graphs MUST validate required inputs, compatible outputs, invalid cycles, unavailable steps, missing permissions, environment requirements and unsafe transitions before activation.

**AW-ATW-102 — Trigger scope.** Manual, scheduled, event-based, conditional and external triggers MAY be supported; their actual connectivity and active status MUST be truthful. A saved schedule is not evidence that an always-on runner exists.

**AW-ATW-103 — Reusable templates.** Users SHOULD be able to save, duplicate, import/export safely, categorize and share approved workflow templates with clear ownership of credentials and external dependencies.

**AW-ATW-104 — Visual composer parity.** The Workflow Composer MUST represent the same underlying workflow definition used by execution; a beautiful graph MUST NOT be a disconnected visual mock of a different execution program.

**AW-ATW-105 — Native command creation.** Vela SHOULD be able to construct and modify workflow definitions through validated native actions, allowing requests like "check this repository, investigate failures, test a fix, then bring it to me for review."

**AW-ATW-106 — Pre-execution explanation.** For consequential workflows, Aerynth MUST present affected resources, triggered actions, access scopes, approval points, recurrence, possible side effects and recovery limits in understandable terms.

**AW-ATW-107 — Workflow run identity.** Every workflow run MUST have its own ID, trigger source, definition version, step attempts, state transitions, approvals, outputs, failures and evidence references.

**AW-ATW-108 — Retry and duplicate protection.** Trigger re-delivery and retries MUST be handled with explicit idempotency or reconciliation rules. An uncertain result MUST NOT be silently retried if duplication could cause consequential side effects.

**AW-ATW-109 — Wait and resume.** Long-running workflows SHOULD survive app restarts, network failures and approval waits through durable checkpoints, while honestly reporting when a required worker/service is offline.

**AW-ATW-110 — Human checkpoints.** Approval and review nodes MUST be enforceable gates, not optional UI labels. Downstream side effects MUST NOT run before their effective policy requirements are satisfied.

**AW-ATW-111 — Dry run where feasible.** Workflow definitions SHOULD support preview, validation and simulated planning without executing side effects. Simulation outputs MUST remain visibly synthetic.

**AW-ATW-112 — Workflow deactivation.** Users MUST be able to disable future triggers and inspect in-progress runs separately. Disabling future launches MUST NOT be falsely described as canceling already-started external operations.

## 13. Verification, evidence, deliverables, and acceptance

[Charter 15](15-QUALITY-VERIFICATION-AND-ACCEPTANCE.md) owns overall testing standards. This section makes those standards part of agent/task lifecycle behavior.

**AW-ATW-113 — Artifact traceability.** A task's work products MUST carry attributable producing attempt, applicable file or external resource reference, revision/version when available, access scope and relevant acceptance criteria.

**AW-ATW-114 — Report actual work.** Agent reports MUST distinguish proposed action, attempted action, observed side effect, test result, reviewed evidence, integrated change and accepted outcome. "Safe to apply" MUST NOT be conflated with "applied".

**AW-ATW-115 — Independent verification where appropriate.** High-risk or materially consequential work SHOULD receive independent checks by separate tools, reviewers or controlled test environments. Another model agreeing with the author is not by itself verification.

**AW-ATW-116 — Test evidence.** Claimed test success MUST reference the actual test command or procedure, environment, result, time and relevant artifact when available. Skipped, incomplete, flaky and unavailable tests MUST be called out.

**AW-ATW-117 — User acceptance remains distinct.** The task owner may accept, reject, request revisions or close with known limitations. The assistant MUST NOT impersonate user acceptance or silently weaken acceptance requirements.

**AW-ATW-118 — Partial delivery.** A task MAY close as partial, blocked, canceled or superseded with an evidence-backed explanation; unresolved work MUST remain discoverable and transferable.

**AW-ATW-119 — Visible requirements.** A task detail view SHOULD expose outcome criteria, required quality dimensions, evidence status, responsible reviewer and remaining blockers without requiring inspection of raw agent transcripts.

**AW-ATW-120 — Verification failure propagation.** Failed checks or contradictory evidence MUST be reflected in dependent tasks and completion claims until resolved or explicitly waived by authorized policy. An agent success message MUST NOT override failed evidence.

## 14. Failure, recovery, interruption, and idempotency

**AW-ATW-121 — Failure taxonomy.** Aerynth MUST distinguish model/provider error, tool failure, infrastructure disconnect, timeout, cancellation, authorization denial, dependency block, resource conflict, validation failure and uncertain external outcome.

**AW-ATW-122 — Recovery without concealment.** Automatic recovery MUST preserve recorded failures and uncertainty; it MUST NOT rewrite history into an uninterrupted successful narrative.

**AW-ATW-123 — Bounded retries.** Retry policies MUST include limits, backoff and a distinction between safe idempotent work and operations whose effects need reconciliation.

**AW-ATW-124 — Stop propagation.** Canceling a parent task MUST define what happens to children and external operations; it MUST NOT presume all descendants can or should be terminated automatically.

**AW-ATW-125 — State reconciliation.** After process restarts or disconnections, Aerynth MUST reconcile durable tasks against provider, process, filesystem and external-service evidence where accessible. Missing evidence MUST lead to an explicit unknown/recovering state.

**AW-ATW-126 — Checkpoint and resume.** Recoverable tasks SHOULD maintain checkpoints at meaningful boundaries and resume without unnecessary context duplication or side-effect repetition.

**AW-ATW-127 — Escalation.** A blocked or uncertain task SHOULD yield an actionable explanation of what is needed: approval, missing dependency, alternative agent, resource release, user decision, or manual recovery.

**AW-ATW-128 — Cleanup safety.** Failure cleanup MUST respect retained user changes, artifacts, audit trails and related tasks. Cleanup of ephemeral environments MUST be reviewable when it risks data loss.

## 15. Workspace experience, spatial coordination, and contextual actions

This charter owns which task and agent interactions must exist; [Charter 01](01-EXPERIENCE-AND-INTERACTION.md) owns selection/navigation semantics and [Charter 02](02-LIQUID-INTELLIGENCE-AND-MOTION.md) owns the cinematic motion language.

**AW-ATW-129 — Multiple task surfaces.** Agents, tasks, queues, workflow runs and groups SHOULD be available as independently placeable blocks and coherent views across home, projects, workspaces, chats, timelines and dashboards.

**AW-ATW-130 — Live but grounded states.** Agent and task blocks MUST display observable states, relevant uncertainty and needed intervention without implying hidden thinking or fabricated progress. Motion may express real events, not manufacture execution facts.

**AW-ATW-131 — Efficient supervision.** A user SHOULD be able to inspect and operate several agents from one coordination surface, including task focus, current work, dependencies, recent changes, reviews, approvals and reports.

**AW-ATW-132 — Group and agent constellations.** Spatial relationship views MAY represent coordination/dependency edges, but MUST provide comprehensible labels, filters, inspection and accessible non-spatial alternatives. Decorative particle connections MUST NOT be mistaken for authoritative dependency relationships.

**AW-ATW-133 — Progressive disclosure.** Routine use SHOULD remain uncluttered; detailed model, sandbox, tool, budget and run settings SHOULD be available contextually without forcing constant exposure to advanced controls.

**AW-ATW-134 — Native contextual commands.** Vela SHOULD be able to invoke typed actions for create, delegate, reprioritize, pause, resume, cancel, inspect, compare, split, merge knowledge, create workflow and open reports, after authorization and scope validation.

**AW-ATW-135 — Animated creation with durable reality.** Creating tasks from a chat MAY animate nodes emerging and new chats appearing, but the object state MUST be persisted and confirmed before the UI claims the assignment is running.

**AW-ATW-136 — Attention-aware report delivery.** Report destinations and notification urgency SHOULD follow configured attention policies. A completed low-priority agent MUST NOT needlessly interrupt the user, while critical approval failures and high-severity alerts remain discoverable.

**AW-ATW-137 — Keyboard and accessible operation.** Core task and workflow actions MUST be usable without requiring drag-and-drop, spatial navigation, animation or pointer precision, including appropriate reduced-motion and screen-reader behavior.

## 16. Intelligence Streams, timelines, and execution profiling

**AW-ATW-138 — Correlation identifiers.** Task, execution, assignment, agent, delegation, workflow run and relevant provider IDs MUST be linkable to the shared observability model under [Charter 09](09-INTELLIGENCE-STREAMS-AND-OBSERVABILITY.md).

**AW-ATW-139 — Verifiable stream events.** Lifecycle and significant orchestration transitions MUST emit or preserve source-linked events with provenance, ordering and honest availability/gap status. The system MUST NOT fabricate private chain-of-thought or invisible tool activity.

**AW-ATW-140 — Scope-specific views.** Users SHOULD be able to inspect Intelligence Streams at task, agent, chat, group and workflow levels, with consistent underlying event identities and drilldowns.

**AW-ATW-141 — Outcome versus activity visualization.** Timelines, charts and constellations MUST distinguish actual observed execution, planned dependency timelines, estimated completion forecasts and recorded acceptance decisions.

**AW-ATW-142 — Profiler integration.** Runs SHOULD expose reported token usage, durations, tool timings, context sources and budget state where supported, under [Charter 10](10-AI-EXECUTION-PROFILER.md). Missing measurements MUST NOT be displayed as measured zero.

**AW-ATW-143 — Efficiency as outcome-aware measurement.** Agent effectiveness evaluations SHOULD consider verified deliverables, rework, failure rates, review costs, time, token use and operational resource load. Raw activity volume or token count alone MUST NOT be considered success.

**AW-ATW-144 — Temporal linkage.** Historical and planning timelines MUST be grounded in task and event identities, with forecast uncertainty and replay fidelity managed under [Charter 11](11-TIMELINES-AND-REPLAY.md).

## 17. Security, autonomy, data exposure, and budget constraints

[Charter 14](14-TRUST-PRIVACY-AND-AUTONOMY.md) is the canonical authority for permissions, data handling, approvals and autonomy tiers.

**AW-ATW-145 — Enforcement outside prompts.** The execution layer MUST check permissions and side-effect policy through enforceable interfaces; agent instructions to "be careful" MUST NOT substitute for policy.

**AW-ATW-146 — Delegation preserves least privilege.** Child agents and workflow steps MUST receive the minimum necessary capabilities and information, never broader privilege than the initiating effective grant.

**AW-ATW-147 — Explicit risky boundaries.** Consequential actions including destructive file operations, protected Git changes, remote deployment, communication to third parties, user-data export and production mutations MUST follow risk-based approval and audit policies.

**AW-ATW-148 — Prompt-injection resistance.** Retrieved code, webpages, notes, tool outputs, logs and external instructions MUST NOT themselves grant permissions, change agent authority, trigger high-impact work or bypass policy.

**AW-ATW-149 — Data transfer controls.** Sharing artifacts, notes, conversation excerpts, profiles and context with agents or remote providers MUST respect source authorization, confidentiality, consent, retention and connector boundaries.

**AW-ATW-150 — Revocation.** Permission revocation MUST prevent new unauthorized operations and trigger appropriate containment or reconciliation for in-flight work; limits on already-executed side effects MUST be disclosed.

**AW-ATW-151 — Budget accountability.** Per-task/agent/workflow budgets SHOULD be supported for available token, time, invocation and infrastructure measures. Advisory budgets MUST be clearly identified; strict enforcement may only be claimed when technically demonstrated.

**AW-ATW-152 — Public fixture discipline.** Public specification examples and test fixtures MUST be synthetic or confirmed publishable; no user-specific repository credentials, private chat excerpts, sensitive telemetry or local identifiers should be committed.

## 18. Suggested conceptual data contracts (non-prescriptive)

These are logical **examples**, not mandatory JSON wire formats or current Codex App Server schemas. Concrete interfaces belong in architecture specifications and MUST be versioned and validated.

### 18.1 AgentProfile

```json
{
  "agent_id": "agent.synthetic.performance",
  "profile_version": 3,
  "display_name": "Performance Engineer",
  "specialties": ["profiling", "benchmarking"],
  "model_preference": "provider-default",
  "skills": ["synthetic-performance-skill"],
  "tool_policy_ref": "policy.synthetic.readonly",
  "context_strategy_ref": "cie.synthetic.balanced",
  "default_report_to": ["assistant", "originating_chat"],
  "capability_status": "unverified"
}
```

### 18.2 Task

```json
{
  "task_id": "task.synthetic.001",
  "version": 4,
  "goal": "Investigate elevated server tick latency",
  "project_ref": "project.synthetic",
  "origin": {"actor": "user", "conversation_ref": "chat.synthetic", "message_ref": "msg.synthetic"},
  "constraints": ["Read-only investigation", "Do not restart production"],
  "acceptance": ["Source-backed diagnosis", "Evidence references", "Recommended next steps"],
  "dependencies": [],
  "operational_state": "running",
  "delivery_state": {"investigation": "in_progress", "validation": "not_applicable", "acceptance": "pending"},
  "assignments": ["assignment.synthetic.001"],
  "evidence_refs": [],
  "approval_scope_ref": "policy.synthetic.readonly"
}
```

### 18.3 Assignment, Attempt, and Handoff

```json
{
  "assignment_id": "assignment.synthetic.001",
  "task_id": "task.synthetic.001",
  "agent_id": "agent.synthetic.performance",
  "profile_version": 3,
  "execution_id": "execution.synthetic.002",
  "provider_ref": {"provider": "codex", "thread_id": "provider-owned-handle"},
  "context_manifest_ref": "context.synthetic.004",
  "permission_snapshot_ref": "policy.synthetic.readonly",
  "handoff": {
    "source_execution": "execution.synthetic.001",
    "checkpoint_ref": "checkpoint.synthetic.001",
    "evidence_refs": ["evidence.synthetic.profiler"],
    "known_uncertainty": ["Comparison test not yet run"],
    "remaining_work": ["Compare baseline against current tick data"]
  }
}
```

### 18.4 Workflow

```json
{
  "workflow_id": "workflow.synthetic.001",
  "definition_version": 2,
  "trigger": {"kind": "manual"},
  "nodes": [
    {"id": "inspect", "type": "agent_task", "capability": "read_repository"},
    {"id": "verify", "type": "test", "depends_on": ["inspect"]},
    {"id": "approval", "type": "human_approval", "depends_on": ["verify"]},
    {"id": "integrate", "type": "controlled_action", "depends_on": ["approval"]}
  ],
  "policy_ref": "policy.synthetic",
  "actual_runtime_support": "not_verified"
}
```

### 18.5 Minimum contract envelopes

| Contract | Key fields |
|---|---|
| TaskCreated/Updated | task ID/version, actor, change source, objective/criteria diff, timestamp |
| TaskStateChanged | task ID, old/new operational and delivery states, reason, evidence, source |
| ExecutionStarted/Updated | attempt ID, agent/profile, task, provider/environment, status, timestamps, capability snapshot |
| AssignmentChanged | task, agent, assigning actor, permission scope, expected outcome, predecessor |
| DelegationCreated | parent task/attempt, child task/attempt, relationship, scoped context, limits |
| HandoffPrepared | task/version, source attempt, checkpoint, artifacts, open questions, verification status |
| ApprovalRequested/Resolved | action proposal, principal, resource scope, effective policy, decision and time |
| ArtifactProduced | artifact ID, producing attempt, source ref/version, trust label, verification linkage |
| WorkflowStepTransition | workflow run/definition version, step ID, event state, retry/idempotency key |
| TaskAcceptanceRecorded | task/version, acceptance authority, criteria, evidence set, limitations |

Conformance tests MUST ensure identity stability, authorization boundaries, schema validation, recovery behavior and provenance preservation independent of specific backend implementation.

## 19. Mandatory acceptance scenarios

Each scenario MUST be tested when its dependent capability is claimed as implemented, with evidence appropriate to the risk and quality dimension. Prototype-only or mocked portions MUST be marked.

| ID | Scenario | Expected result |
|---|---|---|
| ATW-A01 | Start an ordinary chat without agents or tasks | Full chat workflow works, with no forced orchestration |
| ATW-A02 | Discuss six objectives; command "split these and start them" | Relevant tasks and linked chats created; original chat preserved; assumptions and permission scope visible |
| ATW-A03 | Select one file; command refers to its entire folder | Intended scope interpreted and previewed, not silently reduced to selection |
| ATW-A04 | Create reusable specialist profile and assign two different tasks | Stable agent ID; separate assignments/attempts; no context leakage between unauthorized projects |
| ATW-A05 | Attempt to use unavailable skill/model/remote tool | Capability-gated; visible setup/alternative, no fake execution |
| ATW-A06 | Run tasks with independent source files | Legitimate parallel execution permitted under capacity/budget limits |
| ATW-A07 | Run two writers targeting one shared config or live world | Conflict detected; isolation/serialized integration required |
| ATW-A08 | Fork chat and publish a finding from sibling branch | Relevant attributed finding available without merging histories |
| ATW-A09 | Execution stops after producing plan only | Task remains not-implemented/not-verified unless its accepted objective was only planning |
| ATW-A10 | Code changes compile but tests fail | Implementation and failed verification recorded separately; task not misreported as complete |
| ATW-A11 | Agent terminates during command or remote disconnect | Unknown/recovering state, evidence preserved, safe reconciliation before retry |
| ATW-A12 | Reassign a long-running task to new agent | Structured checkpoint and source evidence transferred; identity/history preserved |
| ATW-A13 | Parent delegates to children | Effective permission and budget ceilings are not increased through delegation |
| ATW-A14 | Cancel parent while child has performed external side effect | Cancellation and residual side effects disclosed; no false rollback |
| ATW-A15 | Trigger duplicated workflow notification | Idempotent step not duplicated; risky uncertain outcome reconciled |
| ATW-A16 | Workflow waits for explicit approval | Downstream protected action blocked until valid approval |
| ATW-A17 | Resume after app restart with provider offline | Persisted tasks remain; runtime state labeled disconnected/unknown, not fabricated live |
| ATW-A18 | User asks Vela to summarize agent outcomes | Accurate separation of findings, changes, tests, integration, blockers and acceptance |
| ATW-A19 | Display constellation of several agents | Real relationships and statuses; accessible list alternative; no false private reasoning |
| ATW-A20 | Profiler lacks a reported token category | Metric shown unavailable, not zero or invented estimate |
| ATW-A21 | Agent proposes unsafe external mutation via retrieved text | Untrusted instructions do not grant execution authority |
| ATW-A22 | User disables a recurring workflow | New triggers stop; active runs distinctly managed and disclosed |
| ATW-A23 | Task moves between workspaces and collections | Same canonical ID, artifacts, conversations, history and state |
| ATW-A24 | Agent reports "complete" without required deployment evidence | Delivery outcome remains unverified, with explicit next step |
| ATW-A25 | Plan estimates task completion time | Forecast identified as estimate with uncertainty, not a promised time |
| ATW-A26 | Retry after an uncertain command that may have modified files | State reconciliation prevents an unsafe duplicate action |
| ATW-A27 | Agent profile changed during active run | Historical attempt preserves original snapshot; new work uses effective updated profile |
| ATW-A28 | User asks Vela for a quick factual answer | Single direct response or deterministic query instead of needless multi-agent fan-out |

### 19.1 Verification evidence expected

For applicable test cases, acceptance evidence SHOULD include: scenario inputs; task and agent identity snapshots; event IDs; effective permissions; observed transitions; provider capability snapshot; output artifacts; command/test results; failure/repair traces; relevant UI capture; accessibility review; performance measurements; and explicit reviewer decision. Mocked events and synthetic fixtures must be labeled. [Charter 15](15-QUALITY-VERIFICATION-AND-ACCEPTANCE.md) owns final quality acceptance requirements.

### 19.2 Stress and fault-injection corpus

The test plan SHOULD include many simultaneous tasks; large dependency graphs; cyclic dependency proposals; concurrent writes to one resource; multi-monitor moves; very long chat histories; deep but bounded delegation; rapidly changing provider availability; task cancellation during file writes; disconnected remote hosts; missing approval callbacks; duplicated scheduler events; delayed tool-output streams; conflicting agent results; stale memory checkpoints; and scenarios where the app is closed while external work continues.

## 20. Cross-charter ownership and traceability

This document does not duplicate governing requirements owned elsewhere.

| Charter | Owns | AW-GOV-005 integration point |
|---|---|---|
| [00 Constitution](00-AETHERWAKE-CONSTITUTION.md) | Foundational authority and invariants | AW-CON-042–046 and nonnegotiable experience/trust rules |
| [01 Experience](01-EXPERIENCE-AND-INTERACTION.md) | Contextual Command, UI interaction and selection | Chat-to-task commands and task controls |
| [02 Motion](02-LIQUID-INTELLIGENCE-AND-MOTION.md) | Six Motion Coordinator systems and semantic animation | Real status-driven task and delegation transitions |
| [03 Projects](03-PROJECTS-WORKSPACES-AND-RESOURCES.md) | Project/workspace/resource identities, blocks, collections, settings inheritance | Tasks and agents as canonical resources; multiple views |
| [04 Conversations](04-CONVERSATIONS-AND-CONNECTED-BRANCHES.md) | Chat, forks, Connected Branches, conversation history | Task promotion, chat linkages, selective branch findings |
| [06 Vela](06-VELA-INTELLIGENCE-AND-ADAPTATION.md) | Assistant identity, initiative, attention, adaptation | Vela's orchestration requests and user communication |
| [07 Knowledge](07-NOTES-KNOWLEDGE-AND-THOUGHT-STREAM.md) | Notes, personal Thought Stream, knowledge authority | Notes-to-tasks, relevant cited source material |
| [08 CIE](08-CONTEXT-INTELLIGENCE-AND-MEMORY.md) | Retrieval, context ranking, checkpoints, compaction algorithms | Assignment context and handoff completeness |
| [09 Observability](09-INTELLIGENCE-STREAMS-AND-OBSERVABILITY.md) | Evidence/event envelope, stream integrity and replay foundations | Correlated task and execution events |
| [10 Profiler](10-AI-EXECUTION-PROFILER.md) | Tokens, timing measurements, budgets and analytics | Per-execution usage and task efficiency |
| [11 Timelines](11-TIMELINES-AND-REPLAY.md) | Temporal views, forecasts and replay mechanics | Dependency and lifecycle timeline source data |
| [12 Codex](12-CODEX-EXECUTION-AND-INTEGRATIONS.md) | Provider adapters, protocols, capability discovery, auth and tool execution | Runtime attempts and supported operations |
| [13 Platform](13-PLATFORM-PERFORMANCE-AND-DISPLAYS.md) | Host budgets, display management and background behavior | Capacity-aware scheduling and task block responsiveness |
| [14 Trust](14-TRUST-PRIVACY-AND-AUTONOMY.md) | Authorization, privacy, autonomy, revocation and audit policy | Enforcement on tasks, delegations and workflows |
| [15 Quality](15-QUALITY-VERIFICATION-AND-ACCEPTANCE.md) | Cross-domain verification standards and acceptance | Evidence-gated task completion |
| [16 Engineering](16-ENGINEERING-AND-DELIVERY.md) | How Aetherwake itself is built, reviewed and released | Product task semantics versus repository development policy |

### 20.1 Requirement traceability anchors

| Constitutional requirement | Charter 05 governing sections |
|---|---|
| AW-CON-042 Delegation with intent | 7–9 |
| AW-CON-043 Parallelism with discipline | 8–10, 17 |
| AW-CON-044 Work isolation | 6, 8, 10 |
| AW-CON-045 Outcome-oriented status | 4–6, 13, 19 |
| AW-CON-046 Resumable ownership | 4, 6, 9, 11, 14 |
| AW-CON-006 and core user-experience commitments | 2, 7, 15 |
| AW-CON-057–060 truth and telemetry | 13, 16 |
| Constitutional acceptance C-01/C-06/C-07/C-08/C-10/C-15 | 19 |

This table is routing guidance, not a substitute for the Constitution or the accepted neighboring charters.

## 21. Open research and architecture decisions

The following questions remain **open** until supported by research, prototypes, decision records and appropriate owner approval. This charter intentionally does not turn guesses into binding implementation choices.

1. Which Codex App Server versions support the exact required thread/turn/delegation hooks, and where must Aerynth emulate behavior through multiple independent threads?
2. What is the task-to-provider-turn mapping and recovery strategy when an execution spans several backend conversations?
3. Which scheduling architecture best supports app-closed service operation, headless remote workers, durable waits and safe permissions?
4. Which concurrency/isolation policy works across Git files, databases, game worlds, web services and physical devices?
5. How should task leases and idempotency keys be designed for long-lived or remote jobs?
6. Which agent profile fields can be translated into real provider settings, which are Aerynth-side policies, and which require custom tools?
7. How should verified findings be extracted for sharing between agents while preventing over-sharing, stale citations and context waste?
8. How should objective complexity, verification cost and expected parallelism gains be estimated without overstating accuracy?
9. How can task outcome state be represented consistently for code, research, notes, hardware workflows, creative assets and general-purpose questions?
10. What are the appropriate token, time and concurrent-run budgets for desktop use, background work and remote hosts, with measurable resource protection?
11. Which workflow visual libraries provide fluid interactions while retaining reliable semantic schemas, accessibility and large-graph performance?
12. Which artifact and audit retention policies balance replay/continuity with privacy, deletion and storage limits?
13. What thresholds trigger automatic escalation, handoff, review, prioritization and attention-aware notifications?
14. How will task scheduling gracefully adapt to provider changes, unavailable models, usage limits, missing tools and reduced network access?
15. How will task and workflow structures migrate safely as schemas evolve or other execution providers are added?

Each decision SHOULD have an owner, experimental evidence, alternatives, known tradeoffs and explicit status in `docs/decisions/` or `docs/research/`. No task or agent may claim a decision was accepted merely because this list proposes it.

## 22. Governance change control, acceptance, and final rules

Publication of this document records a **draft proposal**. It is not proof of owner ratification, implementation, or verified product behavior. Its status MUST remain consistent with the [governance registry](README.md).

Changes to normative requirements MUST preserve stable requirement IDs wherever the meaning remains intact. Substantive changes MUST identify affected charters, existing interfaces, acceptance scenarios and migration implications. Conflicts with the Constitution require formal amendment or correction; a task prompt cannot waive them.

### Owner review checklist

- [ ] Agent, chat, task, attempt, assignment, workflow and artifact identities are unambiguous.
- [ ] Ordinary chatting remains completely usable without orchestration.
- [ ] Conversational task extraction and multiple-agent launches preserve the original chat and evidence.
- [ ] Every delegated task has scoped permission, context, report-back and traceability.
- [ ] Parallelism, capacity and shared-state isolation are explicit and cost-aware.
- [ ] Task lifecycle distinguishes work performed from quality verified and user accepted.
- [ ] Task persistence, handoff and recovery are defined independently of provider thread lifetimes.
- [ ] Workflow trigger, idempotency, checkpoint and approval semantics are enforceable.
- [ ] Connected Branches, CIE, Vela and Intelligence Streams are integrated without duplicated domain authority.
- [ ] Cinematic visuals reflect actual task state and offer accessible alternatives.
- [ ] Provider-specific capabilities are subject to runtime verification.
- [ ] Mandatory acceptance scenarios can be demonstrated with synthetic or privacy-safe fixtures.
- [ ] No public content exposes private conversations, secrets, credentials or personal operational data.

### Governing closing rules

**The chat is the conversation. The agent is the worker. The task is the commitment. The execution is an attempt. The workflow is the coordinated procedure. Evidence determines what actually happened. Authorization determines what may happen next.**

Aerynth succeeds when an ordinary question remains effortless, a complicated objective becomes an intelligible set of bounded assignments, autonomous work remains under user control, and reported completion means something provable. It must not replace user mental overhead with an elaborate bureaucracy of agents who are very busy explaining why the actual work has not begun.

---

## Proposed amendment CF-2026-11-05: complete agentic execution and durable orchestration

> **Status: proposed, pending owner acceptance.** The existing task lifecycle and authoritative identities remain canonical; this supplement tightens provider-independent execution contracts.

**AW-ATW-153 — Outcome-owned task graph.** Every delegated operation MUST attach to a canonical Aerynth task and attempt, preserving user intent, required outcomes, input scope, dependencies, assigned agent/provider, current state, approval and evidence obligations.

**AW-ATW-154 — Capability-appropriate delegation.** Planning MUST consider all qualified execution mechanisms, including native services, model tools, local Agents SDK orchestration, managed Agents API, Responses Multi-agent and existing Codex, without treating their auth, memory, quotas or environments as interchangeable.

**AW-ATW-155 — Concurrency with actual isolation.** Parallel branches MAY be dispatched only when dependencies and authoritative resource/write claims permit it. Evidence of genuine overlapping execution MUST exist before marketing a workflow as parallel. Conflicting edits to the same canonical resource MUST serialize, transact or explicitly coordinate.

**AW-ATW-156 — Bounded descendant authority.** An agent-created subtask, hosted subagent or SDK handoff MUST inherit a subset of the parent's approved resources, tools, data-transfer class, effect permissions, budget and lifetime. The executor cannot enlarge authority by spawning a new agent.

**AW-ATW-157 — Cross-provider continuity.** Transfers between local and hosted agent runtimes MUST retain task/attempt identity, resolved objective, context provenance, privacy policy, outstanding approval, verified prior effects and uncertainty. Provider session IDs are auxiliary, not authoritative task IDs.

**AW-ATW-158 — State dimensions.** Model turn completion, provider session completion, external effect receipt, postcondition verification, user delivery and owner acceptance MUST remain separately observable. A completed provider turn MUST NOT automatically mark a task verified.

**AW-ATW-159 — Durable checkpoints.** Before effectful work, the runtime SHOULD persist intent, selected resources, authorization, idempotency key and resource claim. On reconnect, restart, timeout or webhook replay, it MUST reconcile actual side effects before retry.

**AW-ATW-160 — Safe unknowns and cancellations.** Unknown outcomes MUST remain distinct from failure. Cancellation and permission revocation MUST fence future actions and account for in-flight irreversible work, never simply erase an unresolved attempt.

**AW-ATW-161 — Managed session qualification.** Managed Agents API sessions MAY be used only after proving account access, model/tool support, data residency/retention suitability, sandbox/workspace scope, billing identity and service-level recoverability for the task.

**AW-ATW-162 — Work product completeness.** Delegated workers MUST produce inspectable artifacts and acceptance evidence appropriate to the objective; synthetic or text-only completion reports MUST NOT stand in for a requested file edit, software execution, physical measurement or UI mutation.

**AW-ATW-163 — Initiative remains task-bound.** Scheduled/proactive work MUST retain a user-authorized purpose, trigger, budget, stop/revoke mechanism, notification policy, evidence and accountable owner. Ambient speculation does not authorize persistent monitoring.

**Required additional acceptance:** two independent read agents with measured overlap; two conflicting write agents with safe contention; real delegated tool action and verified readback; crashed session reconciliation; approval revoked mid-run; hosted subagent denied a forbidden tool; canceled non-idempotent action remaining unknown until proof. See [execution fabric](../docs/architecture/VELA-CAPABILITY-RUNTIME-AND-EXECUTION-FABRIC.md).

