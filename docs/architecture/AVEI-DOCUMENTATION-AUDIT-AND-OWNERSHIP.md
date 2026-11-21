# AVEI documentation audit, ownership and integration review
**AVEI-DOC-AUDIT-01 · 2026-11-15 · source: main at time of AVEI branch creation · status: proposed documentation change**

## Purpose and audit scope

This is the AVEI-specific implementation of the five-step documentation workflow: (1) locate existing governing text, (2) update existing discovery/index references where appropriate, (3) create one needed subsystem specification, (4) check authority/contract consistency, and (5) submit a narrow PR for independent review. Another concurrent documentation workstream owns Glass, Motion, Scene and related visual systems; this branch intentionally does not edit those materials or approved governance charters.

### Step 1 — examined existing authoritative sources

| Existing document | Existing canonical responsibility | AVEI disposition |
|---|---|---|
| [Constitution](../../governance/00-AETHERWAKE-CONSTITUTION.md), [governance registry](../../governance/README.md) | Governing hierarchy and amendment mechanism | No charter amendment; comply |
| [05 Agents/Tasks](../../governance/05-AGENTS-TASKS-AND-WORKFLOWS.md) | Task lifecycle, delegation, scheduler | Do not duplicate MissionService |
| [06 Vela](../../governance/06-VELA-INTELLIGENCE-AND-ADAPTATION.md) | Reasoning, model selection, agent initiative | Capability declaration only |
| [09 Intelligence Streams](../../governance/09-INTELLIGENCE-STREAMS-AND-OBSERVABILITY.md) | Event semantics, evidence and provenance | Use existing events |
| [10 AEP](../../governance/10-AI-EXECUTION-PROFILER.md), [AEP experiments](../specifications/AEP-ADAPTIVE-OPTIMIZATION-AND-EXPERIMENTS.md) | Measurement, profiling and experiments | Supply metrics, don't create second profiler |
| [12 Execution and Integrations](../../governance/12-CODEX-EXECUTION-AND-INTEGRATIONS.md), [provider/tool contracts](../specifications/VELA-PROVIDER-TOOL-AND-AGENT-CONTRACTS.md), [capability fabric](VELA-CAPABILITY-RUNTIME-AND-EXECUTION-FABRIC.md) | General execution adapters, trusted tool mediation | AVEI specializes VM provider and computer-use methods |
| [13 Platform](../../governance/13-PLATFORM-PERFORMANCE-AND-DISPLAYS.md), [ARIE contract](../specifications/ARIE-RESOURCE-AND-SCHEDULER-CONTRACT.md) | Host performance, resource authority, leases | Environments consume existing resource budgets |
| [14 Trust](../../governance/14-TRUST-PRIVACY-AND-AUTONOMY.md) | Authorization, revocation, privacy, effects | Trust remains sole policy authority |
| [15 Quality](../../governance/15-QUALITY-VERIFICATION-AND-ACCEPTANCE.md) | Release/acceptance criteria and evidence | Acceptance cases are candidate tests, not certification |
| [16 Delivery](../../governance/16-ENGINEERING-AND-DELIVERY.md) | Change controls, review, integration | Focused PR, no merge or production changes |
| [Vela Mission Execution](VELA-MISSION-EXECUTION.md) | Canonical mission execution flows | Integrate by capability rather than a new mission type |

One audit correction: [capability fabric](VELA-CAPABILITY-RUNTIME-AND-EXECUTION-FABRIC.md) is an existing architecture document, not AVEI's new file. Existing system-level descriptions of remote computers, authorization, and native computer controls already establish constraints; they should **not** be copied verbatim into a new competing charter.

### Step 2 — update strategy

The existing [documentation landing page](../README.md) receives a short AVEI discovery entry. Approved governing charters stay unchanged because none need a new independent authority. Their requirements are referenced instead of repeated as alternate law. Any future charter amendment must follow the existing ratification procedure separately.

### Step 3 — new document, justified

[AVEI Virtual Environment Intelligence](AVEI-VIRTUAL-ENVIRONMENT-INTELLIGENCE.md) adds content missing from general execution-provider specifications: VM-provider qualification, environment templates and lifecycles, guest control coordinate semantics, guest/provider boundary threats, snapshot/retention semantics, cost and licensing gates, orphan recovery and native/remote qualification. A single cohesive subsystem architecture is preferable to many duplicated design specifications at this early stage.

### Step 4 — cross-document conflict review

| Check | Result | Constraint / remaining verification |
|---|---|---|
| Authorization owner | Aligned by design | AVEI cannot approve its own effects |
| Agent lifecycle owner | Aligned by design | MissionService remains authoritative |
| Hardware pressure/leases | Aligned by design | ARIE retains the only budget authority |
| Execution provider distinction | Aligned by design | AVEI adapter is not a model provider nor universal desktop agent |
| Event truth | Aligned by design | Receipts distinguish dispatch, observation, and verification |
| Implementation reality | Preserved | Design/approval does not imply VM implementation |
| Container / WSL2 / VM equivalence | Explicitly forbidden | Real isolation must be independently tested |
| macOS on Windows/Linux | Explicitly not promised | Supported Apple host/license requirements |
| Concurrency and cost | Explicitly scoped | Remote billing and ARIE quotas need provider checks |
| Glass/Motion/Scene docs | No edits | Other parallel workstream owns them |
| Cross-document links | Relative links and owner references added | Verify in PR review and regenerate if target paths change |
| Native security effectiveness | Not yet established | Requires actual supported-provider and hardware tests |

**Potential tension, not a resolved conflict:** platform charters may describe the general native broker, but the precise ownership of the eventual AVEI controller/guest-agent process is not yet fixed. Architecture MUST reuse a canonical host authorization/execution boundary; implementers should record an ADR if a new technical process is required, without creating a new authorization authority.

**Potential tension:** the existing execution fabric supports arbitrary capability classes; AVEI must not accidentally equate VM provisioning with a simple read-only capability. Provisioning, guest execution and destruction each need appropriate effect classification and approval.

### Step 5 — integration and review gates

- PR scope is only the new architecture, this audit and a documentation index entry.
- No governing charter rewrite, no code modifications, no workflow modifications, no merge.
- Reviewer should check scope against concurrent design-doc PRs and main-branch changes, particularly doc-index merge conflicts.
- Reviewer should independently evaluate provider API claims, OS licensing, authentication methods, data-egress controls, budget units, effect severity, and untrusted guest output.
- Accept only after reviewing and resolving any conflict with owner-ratified requirements.
- Record any introduced requirement IDs under the AVEI namespace; never reuse AW-TRUST/AW-CEX/AW-PLT IDs as if AVEI owned them.
- Maintain open decisions and negative/unsupported results instead of asserting universal VM support.
- Use synthetic tests to validate interfaces, then isolated real-host tests to establish actual correctness.
- Future substantive changes to permission semantics or mission state require updating their canonical owner documents through explicit review.

## Acceptance of this documentation PR versus acceptance of product

A successful documentation PR verifies only that the architecture and boundaries have been proposed and reviewed. It does **not** mean virtual machines can currently be provisioned or controlled by Vela, that a hypervisor is installed, that an environment is sandboxed, or that remote spending and OS licensing have been validated.
