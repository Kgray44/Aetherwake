# Unified Spatial Intelligence Runtime and Navigation Contract
## Canonical data, live subscriptions, spatial identity, and Vela/Stream projection boundaries

> **Owner-approved design baseline (2026-11-05).** This architecture/art direction is accepted as the target Aerynth experience. Provider capabilities, GPU behavior, performance and visual fidelity remain subject to actual implementation and witnessed acceptance. Ratification of parent charters does not imply a completed feature.

| Field | Value |
|---|---|
| Version / status | 2026-11-04 owner-directed detailed proposed architecture contract |
| Boundaries | Vela global Presence; per-project Intelligence Stream; active-project dock; cross-view transitions; shared source telemetry |
| Normative owners | 01 Interaction, 02 Motion, 03 Project identity, 05 Execution, 06 Vela, 09 Observability, 11 Replay, 12 Provider, 14 Trust |
| Companion | [Stream V2 specification](../specifications/INTELLIGENCE-STREAM-V2-EXPERIENCE-AND-ACCEPTANCE.md), [Presence art](../design/VELA-PRESENCE-INTELLIGENCE-NEBULA-ART-DIRECTION.md), [GPU contract](VELA-PRESENCE-GPU-RENDERING-CONTRACT.md) |

## 1. Single source of truth, multiple projections

**The Intelligence Stream is the per-project structured execution perspective. Vela Presence is the global, symbolic coordination perspective.** They must never become independently populated mock timelines and fake thinking visualizations. Both read the same canonical IDs, plans, traces, status transitions and authorization-filtered event history. The presence renderer does not need to render a project graph; the project graph does not need to model a private mind.

**RUN-01:** A project, workspace, task, execution run, turn, agent, tool operation and event are separate stable identity namespaces. Do not replace identity with a display name, visible pill, DOM component or graphical location.

**RUN-02:** One provider event ingested twice remains one canonical event under idempotent reconciliation; different projections refer to the same record, not clones.

**RUN-03:** Projection cannot grant authorization. Access checks and redaction happen at the canonical query/subscription boundary, with additional UI masking as appropriate.

**RUN-04:** Observed, reported, inferred and unknown are preserved. An agent saying "done" cannot create a verified completion state.

**RUN-05:** User-visible plans and reasoning summaries may be projected; hidden private chain-of-thought must not be fabricated or claimed accessible.

## 2. Data model sketch

The following is a *proposed wire-level illustration*, not code that claims current runtime compatibility. Concrete type names, storage format and provider adapters must be reconciled with the existing Aerynth backend before approval.

```ts
type EvidenceClass = "observed" | "reported" | "inferred" | "unknown";
type OperationState =
  | "proposed" | "not_started" | "queued" | "running"
  | "waiting_dependency" | "waiting_approval" | "paused"
  | "blocked" | "failed" | "cancelled" | "unknown"
  | "reported_complete" | "verified_complete" | "skipped";
type ActivityDomain =
  | "planning" | "execution" | "writing"
  | "communication" | "memory_context" | "analysis";
type Correlation = {
  project_id?: string; workspace_ids?: string[];
  task_id?: string; plan_id?: string; plan_revision?: number;
  operation_id?: string; run_id?: string; attempt_id?: string;
  agent_id?: string; thread_id?: string; parent_span_id?: string;
  trace_id: string; source_event_id?: string;
};
type CanonicalActivity = {
  event_id: string; schema_version: number; source_kind: string;
  event_kind: string; source_time?: string; captured_time: string;
  sequence?: number; correlation: Correlation;
  evidence_class: EvidenceClass; visibility: "allowed" | "redacted" | "partial";
  safe_summary?: string; source_ref?: string; payload_ref?: string;
  event_gap?: { reason: string; since?: string };
};
type PlannedOperation = {
  operation_id: string; plan_id: string; revision: number;
  title: string; type: string; dependencies: string[];
  project_id: string; state: OperationState; assigned_agent_ids?: string[];
  estimated_duration_ms?: number; estimate_confidence?: "low" | "medium" | "high";
};
type ProjectExecutionProjection = {
  project_id: string; project_display_name: string;
  plan_revisions: string[]; operations: PlannedOperation[];
  observed_extra_operations: string[]; event_cursor: string;
  coverage: "complete" | "partial" | "unknown";
};
type VelaPresenceProjection = {
  active_project_ids: string[]; active_trace_ids: string[];
  domain_activity: Record<ActivityDomain, {
    state: "idle" | "active" | "waiting" | "unknown";
    safe_event_ids: string[]; activity_count: number; last_source_time?: string;
  }>;
  action_motes: { id: string; event_id: string; domain: ActivityDomain;
    project_id?: string; title: string; status: OperationState }[];
  event_cursor: string;
};
```

Fields are not permission to collect unavailable or private information. A plan revision must be attributable to Vela, a user edit, or a supported provider output; the plan itself is not verified work.

## 3. Project assignment and multi-project ambiguity

A project-scoped stream includes only records with authorized, attributable project membership. When a shared tool operation contributes to multiple projects, show one canonical event with multiple authorized references, never duplicate the execution or charge its time twice.

For events with no reliable project mapping, the system must place them in a labeled unassigned/global activity area; it must not guess a project based solely on which window was open. Provide an explicit re-association workflow when permitted, preserving original provenance. Parent-child attribution is a separate claim from mere temporal adjacency.

One project can have multiple runs/plans active simultaneously. The UI groups by project in the Active Projects Dock, but the stream must retain run identities and allow filtering and inspecting overlapping executions. Time-running fields distinguish wall time, active execution time and approval wait; never derive unqualified "work time" from the display tick alone.

## 4. Plan-first execution model

For known plans, emit a revisioned planned DAG with explicit dependencies. The renderer lays out future operations before they start and can navigate the whole reachable structure. Inactive/not-started operations appear subdued; a blocked node looks different from a simply unreached node.

As runtime events arrive, statuses reconcile through an authoritative state reducer:

- proposed → queued → running → reported_complete → verified_complete only if evidence supports it;
- running → waiting_approval / waiting_dependency / paused / blocked / failed / cancelled / unknown;
- failure may create a new attempt with identity, not erase the failed one;
- a skipped node retains explicit reason, not silently lit as completed;
- a plan revision may add/remove/replace nodes without rewriting completed history.

Version conflicting events and guard against out-of-order updates; do not silently let stale callbacks regress a confirmed terminal state. Record reported success distinct from verification. Unknown outcome must remain unknown pending reconciliation, not silently retried or decorated as finished.

**Dynamic structure:** if execution discovers additional work, create an observable plan revision and animate new branches from their evidenced parents. Missing causality must remain unconnected or explicitly annotated as unverified. Stable existing nodes preserve world coordinates where possible, avoiding disruptive full re-layout.

## 5. Visual fronts separate truth from animation

Visual progression is a projection over a confirmed per-operation state and a bounded estimated intra-operation animation parameter. The scene must not infer verified completion from animation reaching an endpoint.

A recommended smoothing strategy uses per-front target position `p_target`, visual position `p_render`, velocity `v` and acceleration `a`, with limits on acceleration and jerk. Re-estimation updates `p_target` and desired pace continuously, never teleports the front. Convergence should be monotonic unless a real rollback is visible; animation may gather at a waiting node rather than incorrectly pass a gate.

For concurrent independent branches, use independent fronts. Each causal join remains blocked until recorded prerequisites are satisfied. Stream edge particles may represent actual events/transfers; purely ambient decorative flow needs different semantic treatment.

**No false progress:** a "75% complete" display requires a credible supported measured quantity. When duration is estimated, label estimated timing and let the wave approach but not cross completion until source evidence exists. When early completion arrives, gracefully compress visual closure without delaying actual confirmation or user controls.

## 6. Vela domain projection

Presence domains express observable **categories of work**, not Vela's hidden mental state or percentage of consciousness allocated. A single event may be mapped to multiple domains, but mapping policy must be versioned and auditable. Domain intensity may use bounded event recency, active operation count, queue status and user selection. Its values are visualization parameters, not hidden model telemetry.

A presence action mote references an event, operation or group with a stable ID. Clicking it may open a detail view, related project stream, agent run, tool result or permission surface according to authorized actions. Completed motes leave the active field but remain available through the Wake/recent trace. Aggregation does not delete evidence.

When Vela is executing a tool but the source does not emit intermediate progress, a low-intensity active state may remain with last-observed timestamp; do not invent new micro-events to keep the nebula entertaining. When Vela is idle but other project agents continue to run, represent their continued execution accurately without claiming Vela herself is privately reasoning.

## 7. Spatial environment identity and transition protocol

**One continuous spatial universe. No disconnected screen changes.** Four major perspectives share project/resource identities: Workspace, Constellation, per-project Stream and global Vela Presence.

A transition is an authored, abortable scene journey with:
- `transition_id`, source and destination view kinds, and source/destination object anchors;
- selected project/operation identity and intended focus;
- source camera and destination camera/view transforms;
- ephemeral visual mapping from one representation to the other;
- motion timeline phases, cancel/interrupt behavior and reduced-motion alternative;
- a focus-transfer checkpoint, input freeze window if required, and completion/rollback state.

The transition is **not an execution task** and cannot start/stop/retry backend work. It only switches projections.

**Presence → Stream:** select project-linked action; spotlight corresponding domain and extension; focus on activity; travel through its filament via continuous spatial camera/scene bridge; resolve branching plan from actual project projection; reveal Activity Theater. Restore project-specific viewport and focus.

**Stream → Presence:** contract graph paths to spatially meaningful luminous current; reverse travel; reveal the same central and domain nebulae; preserve recent selection. User may interrupt without losing active work.

**Stream A → Stream B:** recede A into a constellation-like distant form; traverse within same visual world; reveal B with stored view state; keep both backend subscriptions/replay data consistent. Preserve an always-available minimal direct switch for accessibility or reduced motion.

**Workspace ↔ Stream:** start at current project resource and fold workspace detail into execution scene, and reverse through remembered anchor.

**Constellation ↔ Workspace / Presence:** use project positions and persisted relationships where appropriate. Do not invent causal relationships simply because a spatial bridge looks attractive.

Rendering engines may be different. Perceptual continuity is achieved through synchronized camera paths, common world anchors, handoff of visual tokens/particles, shared motion phase and preserved source identity; one monolithic scene is not mandated. A hard page swap hidden by an opacity fade alone is not accepted as spatial continuity.

## 8. View state and concurrency

Persist view-only state by `user + project + view_kind` within existing storage policy: camera center, orbit, zoom, selected run/node, filter, Activity Theater pinned target, follow-live state and last replay cursor. Store these separately from canonical task/run state. Cross-view restoration must not resurrect an unauthorized object after permission revocation.

Active Projects Dock data uses a canonical project activity summary, not scraped UI state. If project status changes while the user is in another view, pills update without stealing focus. Selector shows active, waiting and recoverable runs according to explicit filtering, with finished/recent content separately identified.

Navigation queueing handles rapid multiple clicks, Esc, back, cancel, full-screen changes, window minimization and GPU context loss. User input wins over automated camera motion. No pointer traps, broken keyboard focus or lost editor selection.

## 9. Activity Theater and event inspection

The Theater consumes a **semantic operation projection**, never raw arbitrary HTML or untrusted file text. It may render:
- real file read and highlighted range when content access permits;
- file create/write with verified file identity and diff where supported;
- terminal process output and exit status;
- test results and source references;
- document reading/extraction with honest coverage;
- agent delegation and safe visible plan summaries;
- waiting-approval with accessible controls;
- errors, conflicts, uncertain outcomes and recovery instructions.

If an operation has no visual adapter, render a polished generic **source-attributed activity inspector**. The contract does not require fabricating a pretend document or file animation. Selecting a satellite or Stream node may pin Theater content; on focus change, morph between modes through coordinated motion. Simultaneously active operations appear as compact contextual previews, not repeated rapidly flashing panels.

Content previews are subject to authorization, redaction, sandboxing, bounded truncation, safe linking and retention policy. Untrusted output cannot execute scripts or exfiltrate data through rendering.

## 10. Data transport, reconciliation and recovery

Adapters ingest provider-native events into the existing canonical event bus. Normalize once and fan out via versioned subscriptions/snapshots. A renderer first acquires a snapshot with its cursor, then applies ordered deltas. Reconnect uses replay-from-cursor or an explicitly gapped snapshot when history is unavailable. Deduplicate by canonical event and source IDs, preserve original arrival order/provenance and flag clock uncertainty.

On component unmount, release visual subscriptions/GPUs while execution continues under its canonical owners. Backend process restarts must not create new operation identity or pretend an unknown attempt succeeded. UI reload restores independent scene state and reconciliation cursor.

Security tests should include permission revocation mid-flight, redacted tool output, malicious provider payloads, orphan events, stale snapshots, duplicate/out-of-order events, reconnect gaps, conflicting reported/observed status and compromised display focus.

## 11. Interfaces and test matrix

Define a provider adapter contract and a canonical event reducer first, then validate both projections against the same fixture IDs. The fixture must cover:

1. One sequential plan, full verified ending.
2. Two and three concurrent branches with uneven progress and a gated join.
3. Runtime-added branch, revised estimate and a node moved without global camera jump.
4. Failure → authorized retry → verified completion with both attempts visible.
5. Waiting for approval, user denial, interruption and unknown source outcome.
6. Multi-project shared event, unassigned event and safe project filtering.
7. Replay/restart/disconnect with gaps and out-of-order delivery.
8. Presence motes using the same event IDs as project graph nodes and evidence details.
9. Workspace/Constellation/Presence/Stream round-trip with camera state and continuous animation.
10. Reduced-motion, permission revocation and GPU fallback without task interference.

Synthetic tests prove logic only and remain labeled synthetic. Final acceptance requires real provider/local source activity captured in the actual desktop app plus comparable visual and performance evidence.

## 12. Decisions and compatibility gates

Before coding, inspect current Vela Mission orchestration, Event Bus, Motion Coordinator, active workspace view state and the PR #20 Stream/Timeline implementation. Create a written migration map: reusable canonical data structures, deprecated view-only projections, affected callers and test fixtures. This document **does not authorize deleting historical trace capture or reinterpreting PR #20's block preview as the required full-screen experience**. A block-level Glimpse may remain, but it cannot substitute for the immersive per-project Stream.

Choose transport type names and renderer APIs from existing code after inspection. Introduce the smallest compatible extension; preserve already captured evidence, permissions and legacy-reader behavior. Document and seek owner review for any new irreversible data or host coupling.
