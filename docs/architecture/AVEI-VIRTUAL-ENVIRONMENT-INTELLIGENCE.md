# AVEI — Aerynth Virtual Environment Intelligence
**AVEI-ARCH-01 · proposed architecture specification · 2026-11-15 · design only, not implemented or verified**

> AVEI is an Aerynth-owned, provider-neutral capability for creating, controlling, observing, recovering, and retiring isolated virtual computer environments for authorized Vela and mission work. It is **not** a second agent runtime, task scheduler, permission authority, provider broker, resource governor, or event journal.

## 0. Authority and document boundaries

Authority order: [Constitution](../../governance/00-AETHERWAKE-CONSTITUTION.md), [governance registry](../../governance/README.md), then the relevant owner charters. In particular:

| Concern | Canonical authority | AVEI responsibility |
|---|---|---|
| Agent/mission scheduling and state | [05 Agents, Tasks, Workflows](../../governance/05-AGENTS-TASKS-AND-WORKFLOWS.md) | Submit execution capabilities, environment leases, and checkpoint results to existing MissionService |
| Vela interpretation/routing | [06 Vela](../../governance/06-VELA-INTELLIGENCE-AND-ADAPTATION.md) and [AIR strategy](../specifications/AIR-DYNAMIC-EXECUTION-STRATEGY.md) | Describe environment options; never create a parallel planner |
| Events, truth, provenance | [09 Observability](../../governance/09-INTELLIGENCE-STREAMS-AND-OBSERVABILITY.md) | Emit source-attributed observations to canonical event pipeline |
| Measurements and experiments | [10 AEP](../../governance/10-AI-EXECUTION-PROFILER.md) and [AEP contract](../specifications/AEP-ADAPTIVE-OPTIMIZATION-AND-EXPERIMENTS.md) | Expose real VM performance and acceptance measurements; no competing profiler |
| Provider tool boundary | [12 Execution](../../governance/12-CODEX-EXECUTION-AND-INTEGRATIONS.md), [capability fabric](VELA-CAPABILITY-RUNTIME-AND-EXECUTION-FABRIC.md) and [tool contracts](../specifications/VELA-PROVIDER-TOOL-AND-AGENT-CONTRACTS.md) | Offer typed environment and computer-use capabilities through the existing trusted gateway |
| Host performance/quotas | [13 Platform](../../governance/13-PLATFORM-PERFORMANCE-AND-DISPLAYS.md), [ARIE architecture](VELA-ADAPTIVE-RESOURCE-INTELLIGENCE.md) and [ARIE contract](../specifications/ARIE-RESOURCE-AND-SCHEDULER-CONTRACT.md) | Declare and honor VM CPU, RAM, VRAM, storage, I/O, network and guest resource leases |
| Permission, privacy, risk, revocation | [14 Trust](../../governance/14-TRUST-PRIVACY-AND-AUTONOMY.md) | Enforce each approved capability at host/provider boundary; cannot grant itself privileges |
| Acceptance/release | [15 Quality](../../governance/15-QUALITY-VERIFICATION-AND-ACCEPTANCE.md) | Provide falsifiable tests and evidence; no self-certification |
| Engineering change management | [16 Engineering](../../governance/16-ENGINEERING-AND-DELIVERY.md) | Introduce adapters incrementally, with documented impact and safe rollback |

**Scope:** local full VMs, appropriately supported microVMs, remote authorized VMs, and explicitly differentiated lighter environments (containers/WSL2) when capability and isolation semantics are truthful. **Non-goals:** provision arbitrary OS images by model request; unrestricted host control; bypass licensing; automatic access to host secrets; undifferentiated VM/container claims; covert screen capture; unrestricted persistent automation; unsafe action replay.

### 0.1 Architecture invariants

- **AVEI-001 Single canonical ownership.** MissionService owns task state and scheduling, Trust owns authorization, ARIE owns resource envelopes, canonical events own evidence, and Vela/AIR owns reasoning. AVEI owns only the environment adapter registry, provisioned environment records, scoped computer-use surface and environment-specific reconciliation.
- **AVEI-002 No implicit trust.** A VM is neither inherently safe nor a permission grant. Network, credentials, clipboard, shared files, device passthrough, host process control, remote access, and consequential guest actions require distinct scoped decisions.
- **AVEI-003 Real capability disclosure.** Every provider reports actual host OS, guest OS, virtualization mechanism, isolation class, lifecycle and UI support, licensing and terms, transport, availability, privilege, provenance, and qualification. Unknown is not supported.
- **AVEI-004 No unknown-effect replay.** Crash, timeout or lost connection after dispatch leads to reconcile/readback, not blind retry of a guest effect.
- **AVEI-005 Honest results.** A click acknowledgement is not evidence of intended UI outcome, a screenshot is not proof of persistence, and a VM boot signal is not application readiness.
- **AVEI-006 Portability without false parity.** Common verbs have provider-specific limits. Missing operations are unavailable, never silently emulated with wider permissions.
- **AVEI-007 Host control and cleanup.** User can inspect, stop and revoke managed environments; expired or orphaned leases trigger bounded recovery and cleanup without destroying unknown external work.
- **AVEI-008 No new hidden authority.** Model output, web content, guest screen text and tool responses are all untrusted and cannot authorize expanded access.

## 1. Product workflows and user experience

A user can request an authorized, appropriately supported environment by goal (for example, Linux app testing) and inspect the proposed provider, OS image origin, resources, storage persistence, network/host-share/credential policy, expected cost and capability limitations **before provisioning**. Approved tasks may start GUI or terminal interaction, while a user-visible environment inspector shows lifecycle, current controller, connected host/provider, permitted surfaces, resource reservations, last verified observation, cost state, and pending approvals. Controls support pause, disconnect, snapshot where supported, shutdown, destroy, and bounded retention.

Sample workflow: test an application on Ubuntu and Windows using two isolated provider environments in parallel when quotas allow; run specified tests; capture source-attributed logs/screenshots; report differences and evidence gaps; retire only disposable environments. These are **target behaviors, not existing features**.

Environment selection SHOULD be capability/quality-first under effective authorization, with ARIE budgets and fallback constraints. It MUST NOT infer approval from the user's broad intent when a specific sensitive operation requires a separate approval.

## 2. Model, lifecycle and state

### 2.1 Canonical environment record

One persistent `EnvironmentInstance` has a stable host-generated ID, exact provider ID and provider-native instance ID, template digest/image provenance, host and guest OS/arch, isolation class, locality, workspace and mission link, policy digest, lease IDs, scope of authorized assets, cost policy, lifecycle state, connection epoch, UTC timestamps, last observed health and separate evidence references. Credentials/tokens live only in approved protected secret storage and never in this record, prompt, or public traces.

The canonical states are `requested`, `awaiting_approval`, `admitted`, `provisioning`, `booting`, `ready`, `busy`, `pausing`, `paused`, `stopping`, `stopped`, `destroying`, `destroyed`, `failed`, `unknown`, and `quarantined`. Each transition requires an owner-issued reason, expected prior version, and provider observation or dispatch receipt. An external provider instance may outlive the host app; `unknown` and `quarantined` must not be misreported as stopped/destroyed.

Durable lifecycle records store intent, dispatch claim, provider acknowledgement, independently observed state, and reconciliation status separately. Idempotency keys/epochs prevent duplicate provisioning after restart where the provider supports idempotency; otherwise reconcile ambiguous requests before another create.

### 2.2 Templates and persistence

An `EnvironmentTemplate` identifies source, image/license provenance, immutable digest/version, expected OS/arch, supported operations, guest agent installation, default network policy, storage policy, baseline vulnerability posture, patch cadence, and allowed resource bounds. Only reviewed templates are eligible for unattended reuse. Distinguish ephemeral, workspace-persistent, and externally managed instances. Snapshots/checkpoints include provenance, resource cost, storage retention, and limitations. Snapshot ability is not universal or a substitute for rollback of external effects.

### 2.3 Local versus remote execution

Providers may include Windows Hyper-V, QEMU/KVM, supported Linux VM providers, Apple Virtualization on eligible Apple hardware, and authorized remote VM/cloud systems. Container and WSL2 providers may be valuable for narrower tasks but MUST advertise their weaker/different isolation and GUI coverage, not masquerade as general-purpose full VMs. macOS virtualization MUST be gated by supported hardware, OS facilities, Apple licensing and validated implementation. Do not promise macOS guests on arbitrary Windows/Intel/Linux hosts. A cloud account connection is not approval to incur spending or expose work outside the configured boundary.

## 3. Versioned provider-neutral contracts

The shapes below are **conceptual v0.1 types**. Final implementation must define closed schemas with units, required fields, bounded strings, schema migrations and strict host validation.

```typescript
type EvidenceStatus = "observed" | "reported" | "estimated" | "unknown" |
                      "unsupported" | "denied" | "stale" | "error";
type IsolationClass = "full_vm" | "microvm" | "container" | "wsl2" | "remote_managed";
type EnvironmentState = "requested" | "awaiting_approval" | "admitted" |
 "provisioning" | "booting" | "ready" | "busy" | "pausing" | "paused" |
 "stopping" | "stopped" | "destroying" | "destroyed" | "failed" |
 "unknown" | "quarantined";
interface EnvironmentCapability {
  schema_version: "0.1"; provider_id: string;
  provider_version: string; host_platform: string; guest_platforms: string[];
  isolation_class: IsolationClass; locality: "local" | "remote";
  operations: string[]; unsupported_operations: string[];
  permissions_required: string[]; credential_scopes: string[];
  network_modes: string[]; storage_modes: string[];
  snapshot_support: EvidenceStatus; gui_support: EvidenceStatus;
  headless_support: EvidenceStatus; resource_limits: Record<string, unknown>;
  billing_model: "none" | "metered" | "subscription" | "unknown";
  license_restrictions: string[]; discovery_source: string;
  observed_at_utc: string; qualification: "documented" | "probed" | "tested" | "production_qualified";
}
interface EnvironmentRequest {
  schema_version: "0.1"; request_id: string;
  mission_id: string; task_id: string; workspace_id: string;
  template_digest: string; preferred_provider_ids: string[];
  required_guest_os: string; required_capabilities: string[];
  persistence: "ephemeral" | "workspace" | "external";
  requested_resources: {cpu_vcpus: number; ram_bytes: number; disk_bytes: number; gpu_required: boolean};
  network_policy_ref: string; share_policy_ref: string;
  credential_policy_ref: string; cost_limit_ref: string;
  trust_approval_ref: string; resource_lease_ref: string;
}
interface EnvironmentOperation {
  schema_version: "0.1"; operation_id: string;
  instance_id: string; connection_epoch: string;
  action: "provision" | "start" | "pause" | "resume" | "stop" |
          "destroy" | "snapshot" | "screenshot" | "click" | "type" |
          "keypress" | "scroll" | "terminal" | "upload" | "download";
  arguments_ref: string; authorized_scope_ref: string;
  idempotency_key: string; expected_instance_version: number;
  deadline_utc: string; effect_class: string;
}
interface EnvironmentReceipt {
  operation_id: string; instance_id: string;
  dispatch_state: "not_dispatched" | "sent" | "acknowledged" | "uncertain";
  observed_effect: "verified" | "unverified" | "contradicted" | "unknown";
  state_after: EnvironmentState; observation_refs: string[];
  provider_receipt_ref: string | null; uncertainty: string[];
  reconciliation_required: boolean;
}
interface EnvironmentProvider {
  discover(): Promise<EnvironmentCapability[]>;
  inspect(instanceId: string): Promise<EnvironmentReceipt>;
  provision(request: EnvironmentRequest): Promise<EnvironmentReceipt>;
  operate(operation: EnvironmentOperation): Promise<EnvironmentReceipt>;
  reconcile(operationId: string): Promise<EnvironmentReceipt>;
}
```

The implementation SHOULD separate lifecycle adapters from computer-interaction adapters and transport adapters, while presenting one authorized capability registry. `terminal` uses bounded command vectors and working directories rather than automatic arbitrary shell access. `screenshot` requires scope/retention controls and records whether data comes from a guest agent, remote provider or local compositor. The typed `action` field alone never implies authorization.

## 4. Guest control, interaction and verification

Computer input is mediated through the existing Trusted Tool Gateway. Coordinate systems must declare frame width/height, device-pixel ratio, origin, scale, window identity, frame ID, timestamp, and transformation epoch. Input actions reference a recent observed frame and target to limit stale clicks; a changed screen, window, authorization or epoch forces revalidation. Text entry is classified separately from credential entry. Clipboard use, file transfers, OS dialogs, privileged commands, package installation, network publishing and external-account operations require explicit effects and policy checks.

A sequence of tool calls must preserve causality: observation → grounded candidate action → scoped approval where needed → durable dispatch → provider acknowledgement → independent post-action observation. Do not claim human-readable visual truth from coordinate-only command success. Vela can inspect uncertainty and request more evidence; it cannot forge acceptance.

Terminal and GUI control share an environment identity but not automatic privilege equivalence. Elevated guest commands must be separately mediated. Guest-generated output, websites, logs and documents are untrusted input subject to prompt-injection defenses.

## 5. Trust, boundaries and threat model

Enumerate explicit boundaries: user/Vela intent; model/tool gateway; AVEI controller; local host hypervisor; guest agent/VM; remote provider/control plane; guest network; host file shares; clipboard; secrets; snapshots/artifacts; and external destinations. For each, document principal, permitted capabilities, audit, revocation and containment.

**Default deny:** no host directory mounting, host clipboard bridging, host credentials, USB/device pass-through, inbound host services, privileged guest account, arbitrary public egress, or paid remote provisioning without explicit policy. Approved network access SHOULD be narrowly scoped and inspectable; disabling network is not a reliable security boundary unless enforced at host/provider layer.

Threat scenarios must include guest escape/provider compromise; malicious guest page prompt injection; image/template supply-chain compromise; forged screenshot/control output; stale approvals; command replay; lost connection during destructive action; shared-folder path traversal/symlinks; secret disclosure; unauthorized network egress; snapshot leakage; remote-cost runaway; orphaned instances; cross-workspace access; resource exhaustion; and host/guest clipboard contamination.

Revocation immediately prevents new tool dispatch and invalidates active capability sessions; provider cancellation and environment shutdown are attempted where supported, with exact uncertain outcomes retained. Sensitive artifacts use canonical storage permissions, encryption and retention obligations. Debug logs contain no raw secrets, private screenshots, or user data by default. Any live capture requires explicit consent and retention display.

## 6. ARIE and AEP contracts

AVEI requests ARIE leases for vCPU load, RAM commitment/reserve, disk bytes and I/O, GPU/VRAM when applicable, local network load, and remote provider request/concurrency/cost caps where owned. A lease is a bounded admission decision, **not** a task state transition or action approval. The existing MissionService controls concurrency and priority; environment pressure changes must remain independent from AIR reasoning quality.

AEP records source-attributed cold boot, warm start, guest readiness, first screenshot, first verified interaction, terminal responsiveness, p50/p95 action latency, CPU overhead, RSS/commit, VM storage, network bytes, provider billing, failure/recovery time, and verified task outcomes. Each metric has measured versus estimated status, host/guest clocks, source and uncertainty. No vendor marketing number may be presented as locally measured performance. ARIE may throttle/pause/defer based on real policy; AEP only recommends future strategies.

## 7. Availability, recovery, and operational failure

Per-provider capability states distinguish documented, probe-reachable, permitted, configured, tested, and production-qualified. Recoverable failures: missing virtualization support/disabled BIOS or OS feature, guest image unavailable, no valid template, inadequate CPU/RAM/disk, hypervisor conflict, guest agent disconnected, stale screenshot, network policy denial, credential expiry, provider outage, unsupported feature, cost limit, guest crash, VM stuck stopping, or app restart.

Recovery sequence: quarantine uncertain operations, identify canonical instance plus provider-native identity, reconcile provider state without replaying effect, inspect snapshots or preserved logs under permission, offer safe alternatives, and publish truthful user-facing status. Destroy/cleanup may require separate approval if data persistence or external work is at risk.

A read-only diagnostics view can show capability probes and resources without provisioning. Do not present mock/demo adapters as real availability.

## 8. Incremental implementation and acceptance

**Milestone 0 — architecture and threat review:** owner boundaries; exact host/provider matrix; permission classes; transport and licensing review; schema and safety contract tests. **Milestone 1 — synthetic adapter:** lifecycle state machine, idempotency, resource-lease integration, failure injection and event receipts without real guest effects. **Milestone 2 — one validated local VM:** permissioned Linux guest on a supported host, limited terminal and GUI, readback, checkpoint and cancellation. **Milestone 3 — additional providers:** Windows and remote VM adapters after capability/license/security tests. **Milestone 4 — macOS where eligible:** Apple hardware and license gating, platform-specific acceptance. **Milestone 5 — parallel missions and performance:** ARIE concurrency, AEP comparative benchmarks, persistence and orphan-recovery. No milestone implies another passed.

Required acceptance cases:
1. Deny a VM create when virtualization, permission, license, quota or cost approval is unavailable, with no partial created instance.
2. Reject model-supplied or guest-supplied approval and invalid resource lease; preserve Trust/ARIE as sole owner.
3. Prove window/frame epoch mismatch cannot cause a stale click or stale terminal command replay.
4. Prove guest network, file sharing, clipboard and credentials cannot cross scopes by default.
5. Simulate failure after provider create dispatch and prove reconciliation prevents duplicate create.
6. Simulate restart between guest effect and receipt; report `unknown` until independently observed, never `success`.
7. Verify user revoke while jobs are queued and active; prevent new dispatch, report unsupported cancellation truthfully.
8. Show OS/provider unsupported versus unconfigured versus denied as distinct results.
9. Verify a disposable guest is retired and workspace-persistent guest is preserved per policy.
10. Verify concurrent VM workloads honor ARIE leases and foreground responsiveness under representative load.
11. Benchmark startup, first-readiness, interaction latency, cleanup and resource pressure on actual target hardware, with p95 and provenance.
12. Validate no cross-workspace image/artifact/secret access; threat-test prompt injection and provider compromise assumptions.
13. Demonstrate actual GUI/terminal task outcome with independent evidence, not provider click acknowledgements.
14. Verify macOS guest is never advertised on unsupported hosts or incompatible licensing configurations.
15. Independently inspect snapshot/data-retention and remote billing/cost-limit behavior, including provider-side uncertainty.

Release decisions belong to Charter 15; synthetic passes do not certify native security or host compatibility.

## 9. Open decisions and explicit unresolved risks

- Select an initial validated local Linux VM provider after host capability and threat testing.
- Define concrete cryptographic identity/channel protection for guest agents and remote providers.
- Determine exactly which network policies are enforceable per provider, including NAT and DNS leaks.
- Define provider-specific snapshot encryption, consistency, cost/retention and restore verification.
- Determine desktop pixel/cursor transform contract and accessibility automation capability per OS.
- Define remote account authorization, billing caps and hardware tenancy guarantees.
- Decide whether persistence is per-workspace, per-mission or both under Charter 03.
- Confirm which existing native broker/service exposes controller operations; do not add a second controller authority.

**Status:** This document specifies desired interfaces and tests. It does **not** establish provider availability, VM security certification, or implementation completion.
