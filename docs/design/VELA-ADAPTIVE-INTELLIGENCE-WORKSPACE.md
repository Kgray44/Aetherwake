# Vela Adaptive Intelligence Workspace
## Immersive design, canonical projections, and user interaction contract

> **Status:** Proposed companion implementation design, 2026-11-10. This document describes the owner-directed Fluid Intelligence target experience. Publication and merge do not prove native implementation, artistic acceptance, live telemetry, accessible operation, or learning performance.
>
> **Authority:** Subordinate to [Constitution 00](../../governance/00-AETHERWAKE-CONSTITUTION.md) and governing Charters [02](../../governance/02-LIQUID-INTELLIGENCE-AND-MOTION.md), [03](../../governance/03-PROJECTS-WORKSPACES-AND-RESOURCES.md), [05](../../governance/05-AGENTS-TASKS-AND-WORKFLOWS.md), [06](../../governance/06-VELA-INTELLIGENCE-AND-ADAPTATION.md), [08](../../governance/08-CONTEXT-INTELLIGENCE-AND-MEMORY.md), [09](../../governance/09-INTELLIGENCE-STREAMS-AND-OBSERVABILITY.md), [10](../../governance/10-AI-EXECUTION-PROFILER.md), [11](../../governance/11-TIMELINES-AND-REPLAY.md), [13](../../governance/13-PLATFORM-PERFORMANCE-AND-DISPLAYS.md), [14](../../governance/14-TRUST-PRIVACY-AND-AUTONOMY.md), and [15](../../governance/15-QUALITY-VERIFICATION-AND-ACCEPTANCE.md). In particular this realizes AW-OBS-148–178, AW-AEP-138–178 and the ARIE platform amendment without creating a new source of truth.

## 1. Product promise and non-goals

The Adaptive Intelligence Workspace (AIW) is the first-class, persistent Aerynth space in which a person can **inspect what Vela is doing, why an observable decision was made, what evidence it used, what she has learned from outcomes, what policies have changed, and how those changes affect future work**. It is the living, user-facing home for AEP, ARIE, and Fluid Intelligence adaptation, while respecting the existing distinct ownership of AIR, CIE, MissionService, event projections, and the Performance Governor.

The experience must embody the continuous Spatial Intelligence universe: enter from Vela Presence, a project Intelligence Stream, a mission, or a selected resource; move through meaningful connected structures, retain selection and camera anchors, and return without changing resource identity. It is **not** another isolated dashboard or a collection of modal settings panels. Equally it is not a literal representation of secret model thoughts. Its movements and explanations must arise from recorded or explicitly qualified evidence.

Non-goals: a second profiler database; another scheduler or policy enforcement engine; separate "learning memory" detached from CIE; a new mission lifecycle; fabricated AI monologue; speculative access to hidden chain-of-thought; default capture of personal desktop activity; training or fine-tuning OpenAI base models; fully automatic high-impact policy changes without authorization.

## 2. Identity, source authority, and integration invariants

Canonical owners remain unchanged:

| Domain | Canonical owner | AIW consumes / may request |
| --- | --- | --- |
| Project/workspace/block/layout identity | Charter 03 workspace/resource service | Persist AIW layout references, anchors and selection; never duplicate resources |
| Mission/task/attempt/agent and accepted plan versions | MissionService under Charter 05 | Read plan, dependencies, lifecycle; request authorized commands through owner |
| Model decisions and cognitive strategies | AIR/Vela under Charter 06 | Read recorded decision results, permitted rationale, alternatives and policy version |
| Evidence retrieval, corrections, experiential applicability | CIE under Charter 08 | Query scoped provenance, confidence, invalidation; no raw shadow store |
| Event lineage, replay, projection | Charter 09 canonical event store/reducer | Subscribe to canonical typed events and materialized read-only projections |
| Metrics, experiments, recommendations, strategy efficacy | AEP under Charter 10 | Query attributable measurements, comparisons and recommendations |
| System sensors, actual local budgets and enforcement | Existing Performance Governor evolved as ARIE under Charter 13 | Read sampled state and applied resource epochs; propose changes via authorized interface |
| Permission, retention, access, revocation, consent | Charter 14 | Apply access checks to every view, query, action, export and live subscription |
| Evidence/quality status | Charter 15 | Show acceptance qualification; do not self-certify release |

One event, experiment, decision, policy or artifact may appear in multiple perspectives, but all such projections MUST link to the same stable canonical ID. A workspace placement is not a duplicate execution or experiment. Timeline replay cannot repeat paid model calls or side effects. Each integration must report whether a field is observed, derived, reported by a model/provider, estimated, proposed, or unavailable.

## 3. The connected spatial experience

The workspace should feel like a coherent region of Vela's Mind rather than a flat analytics web page. Its main spatial composition has a **central mission/intelligence locus** with six optional navigable observation regions. Organic luminous conduits carry actual correlated event or policy relationships, not decorative false causality. Visual priority follows user activity and current mission relevance; inactive areas remain legible and discoverable.

### 3.1 Six connected regions

1. **Decision Observatory.** Trace the path from input perception and context investigation to a plan, model/tool selection, delegation, resource adaptation, verification, and final delivery. A selected decision shows observed trigger, objective, authority, accepted policy and plan version, known alternatives, model/provider capability, validator verdict, rationale class, result and evidence completeness. Distinguish contemporaneous structured decision data from after-the-fact hypothesis; expose neither hidden model reasoning nor an invented inner voice.
2. **Resource Intelligence.** Live ARIE machine-state view: CPU/logical-core topology when available, GPU/VRAM/thermal coverage, memory pressure, disk/network limits, foreground contention indicators, actual worker budgets, task leases, policy epoch, user preference, and why budgets increased/decreased. Show sampling age and inaccessible sensors. Allow authorized manual performance-mode overrides; a user control submits a command to the governor, not an ad hoc process-priority write.
3. **Execution Profiler.** AEP critical-path, p50/p95, time to first meaningful and first verified result, wall-time versus summed worker-time, queue/remote/model/tool/retry time, overlap, instrumentation overhead, token/cache/tool costs, verified outcomes and data missingness. Selecting a span resolves to the mission's real attempts. Do not render parent and child durations as additive wall time.
4. **Learning Observatory.** Present a versioned ledger of candidate optimization → evidence → experiment → independent review → authorized promotion/rejection → applied policy epoch → observed follow-up → rollback, with links to CIE applicability context and AEP evidence. Clearly distinguish a single anecdote from a validated pattern; show superseded findings and contradictory outcomes.
5. **Experiment Laboratory.** Inspect or prepare controlled comparisons of models, agent allocations, retrieval strategies, transport, caching, and ARIE budgets. Show predeclared task families, baseline/candidate, quality gates, holdout status, sample sizes, cold/warm conditions, environment, measurement provenance, uncertainty, stop conditions and privacy impact. Experimental runs never bypass authorization or secretly alter live missions. Side-effectful replay must use safe fixtures/sandbox or user-approved actions, not double-execute real-world effects.
6. **Adaptation Timeline.** Navigate how approved strategies evolved over time, why they were changed, when changes became effective and what happened afterward. Timeline links to actual plan/policy/version records. A simulated comparison, reconstructed trajectory, and recorded production event have visibly different visual and accessibility labels.

### 3.2 Relationships to other spatial perspectives

- **Vela Presence → AIW:** select an evidenced activity motif or dedicated portal; a continuous camera transition maintains the Vela identity and reveals the relevant observed region. A nonanimated shortcut must provide identical functionality.
- **Project Intelligence Stream → AIW:** enter from selected task/agent/span/decision; preserve project, run, attempt and selected node; return to the same source-backed stream and camera anchor. AIW must not replace Stream V2's full-viewport plan-first topology or Activity Theater.
- **AIW → Workspace/Constellation:** open the underlying note, project, artifact or investigation in its canonical home; returning restores AIW filters and state.
- **AIW ↔ Timeline/replay:** change replay time without changing executing mission state. Historical and live modes are always visibly different.
- **Multiple concurrent missions:** filter by project, mission, time, model, agent, policy, device, run and scope. Global aggregates require access to every included record; missing scope and partial coverage are disclosed.

## 4. Interaction model: inspection before controls

Default view: calm, navigable spatial overview with small number of meaningful interactive regions and a visible summary of coverage, active missions, recent validated learning and current ARIE mode. The user can click an observed activity to smoothly expand a **dedicated inspection surface** within the spatial universe. These are not giant generic popups. A deeper view progressively reveals decisions, charts, evidence, alternatives, and available controls.

Each inspectable record should offer (subject to capability and authority):
- **Inspect:** explicit metadata, provenance links, timestamps, evidence type, permission scope, source status, versions and related records.
- **Compare:** equivalent baseline and candidate runs, environmental conditions and quality outcomes, not merely token or latency totals.
- **Ask Vela:** "Why did you select this model?", "What changed while I was gaming?", "Why wasn't this faster?", "What have you learned about this task class?" Answers retrieve permitted records and cite record IDs; absent rationale is disclosed, not invented.
- **Adjust:** preview authorized ARIE mode, per-project policy preferences, scheduling priority and experiment approval, including affected work and reversible consequences.
- **Review / accept / reject / rollback:** present measured evidence and tradeoffs. Use the existing permission gateway and policy lifecycle; never treat a button animation as successful mutation before resulting state is confirmed.
- **Export:** privacy-scoped, reproducible evidence or redacted summaries with units, provenance, filters, timestamps and known gaps.

### 4.1 Learning record detail contract

A learning finding must contain, where available: finding_id, status (hypothesis/proposed/experimenting/validated/rejected/promoted/superseded/rolled_back), owner, source event/experiment IDs, task family/scope, baseline and candidate policy/version, model/provider configurations, hardware/resource epochs, evidence coverage, comparison metrics, sample size and uncertainty, quality/safety/privacy gates, reviewer verdict, promotion authorization, effective policy epoch, observed post-promotion effect, contraindications, and rollback reason. Missing fields are explicitly marked unknown. Raw private user context remains behind CIE permissions, not copied into AIW projections.

### 4.2 Decision detail contract

Decision records distinguish: request and selected objective; decision type (input interpretation, context search, model/agent/tool selection, plan accept/reject, resource adjustment, recovery, verification); captured structured proposal; validator result; accepted action; actual execution status; alternatives if actually evaluated; observed outcome; source; user-facing explanation category; and related policy evidence. Never infer that a proposed action happened because a plan mentioned it.

## 5. Spatial design system and information density

Art direction: continuous volumetric, glasslike, celestial environment consistent with [Spatial Intelligence systems](SPATIAL-INTELLIGENCE-SYSTEMS-INDEX.md), [Vela Presence design](VELA-PRESENCE-INTELLIGENCE-NEBULA-ART-DIRECTION.md), and [Stream V2](../specifications/INTELLIGENCE-STREAM-V2-EXPERIENCE-AND-ACCEPTANCE.md). Use nebular depth and responsive lighting for relationships, distinct but harmonious material semantics for recorded/estimated/unavailable information, and visual motion for *observed* state changes rather than unexplained "thinking" animation.

Avoid one enormous sidebar, a stack of generic modal forms, rows of floating performance counters as the entire experience, and opaque navigation that obscures useful text. Specialized surfaces are required for experiment setup, timeline scrubbing, resource policy editing and evidence exploration; editable items must be directly manipulable with keyboard equivalents and clear undo/recovery where appropriate.

Motion must preserve selected identities and camera continuity, remain responsive under monitoring load, and degrade gracefully using ARIE/Performance Governor quality tiers. Motion is never the sole source of status. Provide actual labels, statuses, timestamps and audit references. In reduced-motion mode, preserve hierarchy, selection, relationships, focus, history and access to all actions through legible static transitions.

## 6. Data flow and state model

Recommended read path:

1. Canonical owners write authoritative mission, telemetry, experiment and policy events.
2. Charter 09 event ingress normalizes, correlates, deduplicates, redacts and retains permitted events.
3. Domain services publish typed read-only query projections keyed by canonical IDs, time range, origin, source coverage and revision.
4. AIW subscribes to a bounded snapshot plus incremental events and performs view-only interpolation and aggregation.
5. User interactions issue typed commands to the relevant canonical owner via Trust authorization; owner responses and events settle the visible state.

The actual application event bus/protocol is selected after code inspection. Avoid inventing a new global event bus, schema repository or execution database. The workspace state includes stable workspace_id, view layout version, selected record identity, navigation anchor, filters, live/replay mode, time window, evidence visibility, and user preference overrides. UI state is local where transient; durable user layout and filter preferences are persisted through Charter 03. The state of an agent, mission, experiment or policy is never owned by UI memory.

Required state handling: disconnected, unknown, provider unsupported, permissions restricted, stale sensor, partial history, missing context, expired evidence, replay gaps, duplicate/out-of-order events, restored layout after restart, changed schema, and cancelled or reverted experiment. Disclose each; never silently map to success or zero.

## 7. ARIE and AEP visibility rules

Resource changes: show previous/next budgets, user-selected protection mode, observed/smoothed resource pressures, policy version, valid lease/affected worker count, adjustment direction, confidence and time. The AI advisor may recommend a policy, but the deterministic governor enforces approved limits and records what actually applied. Display the difference between policy *intent* and applied OS state. Do not imply that remote OpenAI inference consumes local GPU compute; distinguish network/API concurrency from local CPU worker concurrency.

Profiler: separate provider-reported actuals from derived estimates and missing values. For time, distinguish end-to-end wall time, child worker time, queue, overlap, resource stalls, provider wait, verification and renderer impact. For outcomes, show correctness, safety and user-impact evidence before cost. If comparable missions are insufficient to estimate a reliable improvement, label the finding inconclusive.

Learning: no spontaneous ratification or silent policy promotion. Accepted improvements maintain the recorded scope and can be suspended or rolled back when regression alarms, new evidence or user direction require it. Changes to permissions and access are never learned from patterns.

## 8. Privacy, safety, and trustworthy explanations

AIW telemetry is potentially sensitive. Respect Charter 14 for collection opt-ins, access grants, retention, project boundaries, export, source revocation and deletion. The repository is public: never place raw user transcripts, personal machine identifiers, private paths, private traces or credentials in committed examples or screenshots. Use obviously synthetic fixture data for public design artifacts. Sensitive raw model input/output must not be mirrored into unrestricted logs for convenience.

Never display purported hidden chain-of-thought. Permit authored decision records, structured model outputs, actual tool requests, recorded choices, source-linked summaries, and clearly labeled inference. A privacy-filtered explanation must not reveal restricted details through aggregates or comparisons. All mutating controls must be permission checked; an experiment cannot execute paid/external actions by simply selecting an old run.

## 9. Accessibility, responsiveness and failure tolerance

Keyboard reachable structure, visible focus, screen-reader names/status, full text alternative for spatial links, scalable charts, contrast-safe surfaces, no information conveyed solely by hue, reduced-motion parity, and suitable alternatives for unavailable GPU features are required. A read-only non-3D inspection fallback remains functional under GPU/driver failure.

High-frequency sensors are sampled/coalesced at the service boundary; rendered motion interpolation is decoupled from event capture. Avoid expensive redraw or provider calls per animation frame. Backpressure preserves event truth while reducing visual fidelity, and provenance gaps are displayed if events cannot be reconstructed. AIW must not block the renderer, voice path, or mission scheduler.

## 10. Acceptance journeys and required evidence

The independent [Fluid Intelligence acceptance specification](../specifications/VELA-FLUID-INTELLIGENCE-ACCEPTANCE.md) governs proof and gates; the [realization plan](../../plans/milestones/FLUID-INTELLIGENCE-REALIZATION.md) governs sequence. At minimum:

- **AIW-01 (real navigation):** Enter from Presence, mission Stream and direct navigation; return preserving selection, anchor and canonical IDs.
- **AIW-02 (real source):** Inspect actual model/plan/tool/validator events from a supported provider without fabricating private reasoning; separately inspect simulated fixtures.
- **AIW-03 (real ARIE):** Under observable foreground contention, show valid sampled telemetry, applied governor policy and source-backed changes; unavailable sensors remain unknown.
- **AIW-04 (measured AEP):** A concurrent mission shows correct wall time, overlap, task/attempt ancestry, p50/p95 when sample size allows, and honest missing provider usage.
- **AIW-05 (learning):** One candidate is proposed, tested, gated, accepted or rejected, and its versioned history remains inspectable; a rollback is recorded and visible.
- **AIW-06 (authority):** Permission denial, revocation, scope filtering and cross-project exports are enforced without leakage or synthetic success.
- **AIW-07 (faults):** Reload, offline source, replay, duplicate events, unknown completion and schema migration preserve true identity and data-state distinctions.
- **AIW-08 (experience):** GPU-native moving-camera demo with actual interactions, animation recordings, frame-time and power/resource traces, keyboard/reduced-motion tests, and owner visual review. Static screenshots or unit tests alone are not artistic acceptance.
- **AIW-09 (noninterference):** Instrumentation on/off and workspace open/closed comparison reports measurement overhead and foreground impact with hardware, sampling and workload context.
- **AIW-10 (answers):** Ask Vela to justify a decision and explain a past optimization; answer references accessible actual records or states uncertainty rather than inventing rationale.

Every test must record code SHA, OS/hardware, source coverage, fixture/live classification, test command/journey, outcome and limitations. Documentation or an animated prototype is not proof of a working AEP, ARIE, or experiential-learning loop.

## 11. Dependencies, scope and change control

Foundational dependencies: canonical owner mapping and Architecture Recovery handoff; event/trace and permission schemas; AEP metrics and experiment records; ARIE telemetry/governor interfaces; CIE experiential context; verified plan/executive decisions; Spatial Runtime/Motion Coordinator and actual GPU proof. Define typed contracts before broad renderer integration; incrementally deliver working vertical slices with honest incomplete states.

Open decisions requiring research: final GPU renderer/scene graph integration, event subscription/batching, large-history visual density, platform-specific sensor coverage, experiment setup affordances, cross-device retention/export, and accessibility alternatives. Benchmark alternatives rather than declaring unverified API or GPU support. Record expensive choices in ADRs before locking them in.

**Acceptance boundary:** This subordinate design is proposed for implementation and cannot by itself modify ratified charter semantics. Any conflict is resolved through governing owners; owner artistic and release acceptance remain separate from PR merge and engineering test success.
