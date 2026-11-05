# Spatial Intelligence: Design-First Prototype, Integration and Acceptance Plan
## Work packages, owner reviews, evidence, dependencies and anti-shortcut delivery gates

> **Owner-accepted design/verification plan (2026-11-05).** This document defines requirements and acceptance journeys for implementation. No synthetic fixture, screenshot or publication is evidence of completed native acceptance.

| Item | Value |
|---|---|
| Status | Owner-approved 2026-11-05; implementation verification outstanding |
| Scope | Vela Intelligence Nebula / Presence; immersive per-project Intelligence Stream V2; spatial continuity; Active Projects Dock |
| Baseline | PR #20 Living Instruments is an **existing draft**, not evidence that the newly requested immersive experience is complete. PR #19 Vela runtime remains stacked upstream. |
| Authority | Constitution 00; Charters 01/02/03/05/06/09/11/12/13/14/15/16 and their current registry statuses |
| Art reference | Exact user-supplied 2026-11-04 blue/cyan/violet silk-nebula image, retained in approved owner review context |
| Rule | One continuous spatial universe. No disconnected screen changes. |

## 1. Intent and deliberately protected scope

The purpose is to prevent the familiar failure cycle of producing a rushed low-fidelity concept, integrating it into dozens of files and then spending several days rebuilding it because it never resembled the owner's artistic direction. This plan makes artistic quality, real 3D depth and source truth verifiable **before** the system is deeply integrated.

It does not authorize an entire Vela runtime rewrite, broad PR #19/20 refactor, host replacement, destructive file change, proprietary asset use, secret commit, unsupported provider introspection or unilateral acceptance. Use isolated branches/worktrees, narrow ownership, shared contracts and explicit integration boundaries.

**Current baseline facts must be re-verified during implementation.** In the initial preparation on 2026-11-04 PR #20 was a draft targeting PR #19 with a block-library Stream and an existing Living Instruments design. The new program must inspect HEADs again, not assume those branches will remain unchanged.

## 2. Milestones with explicit exit evidence

| Stage | Owner/workstream | Deliverable | Exit requires |
|---|---|---|---|
| S0 — authority and contract | Integration architect | Charter traceability, current branch/ownership map, canonical event/plan extension strategy | Existing owners understood; no contradicting definitions |
| S1 — two GPU art spikes | 3D renderer | Two materially distinct 3D candidates with camera orbit and internal light | Genuine GPU/3D proof, measured prototype performance, recorded art comparison |
| S2 — living nebula hero | 3D/art | Reference-grade asymmetrical veils, deep internal luminous detail, domain clouds | Owner visual review and reject/approve recorded; no false 'final' status |
| S3 — living tendrils and motes | Simulation/scene | Continuous core→domain extrusion, 3 independent extensions, activity satellites | Multi-axis moving-camera video, no snapping, source-driven signatures |
| S4 — spatial travel | Motion/navigation | Presence↔Stream and Stream A↔B cinematic path; identity continuity | Real app journey, state restoration, cancel/reduced-motion, no hard page swap |
| S5 — Stream graph | Plan/execution | Plan-first DAG, live branch fronts, source states, dynamic revisions | Real sequential and concurrent source-backed runs, no fabricated success |
| S6 — Theater and project dock | UI/telemetry | Real activity previews, compact dock, selector, per-project view persistence | Actual file/command/document/test evidence; 2+ real projects; keyboard and permission safety |
| S7 — integrated qualification | Quality/integration | Merged review candidate, replay, GPU/performance proof and accessibility | All independent acceptance gates met; explicit owner decision |

**Important:** S0/S1/S2 may be explored in parallel when file ownership permits, but the scene's aesthetic and 3D topology are **gating decisions**. Do not deeply couple unapproved pseudo-2D rendering to the final runtime.

## 3. Work packages and responsibilities

### WP-A — Canonical runtime and truth integration

Read current provider adapters, mission scheduler, plan representation, event recorder, task authority, tool permissions and persistence. Add the smallest compatible contract for project scope, plan revision, operation state, event/provenance identity and versioned subscriptions. Preserve historic trace ID, agent/task identity and unknown/approval semantics.

Fixture requirements: sequential work, two parallel branches, gated join, new plan operation, retry, unknown, approvals, multi-project, reconnect and redaction. Demonstrate one source event appearing with the same ID in both Vela Presence and project Stream.

### WP-B — Visual art and GPU engineering

Create two deliberately different full 3D approaches, e.g. (1) GPU density-field/raymarched volume plus translucent deformable surfaces, and (2) deep spline/filament deformable surfaces with volumetric instanced particles and emission. Both must have internal light and a candidate connected tendril. Use the same camera path and reference-side-by-side review so the comparison is fair.

Record:
- real GPU backend/device/context;
- moving camera showing depth;
- materials/lighting/detail with bloom toggled off and on;
- particle count, pass budget and frame times;
- memory growth after repeated mounts and long idle;
- blockers, quality tradeoffs and proposed ADR.

Do **not** accept one just because it is simpler; the original image is the aesthetic target. A third candidate may be necessary. Integration must not freeze the form prematurely.

### WP-C — Living motion and tendrils

Implement a coherent multi-scale field with persistent phases, damping and controllable branch anchors. Provide a visual evidence harness with reproducible seeds and timed domain activations. A reviewer must see the central mass materially stretch into Planning, Execution and Writing nebulas while smaller light filaments and micro-particles flow inside, rejoin or retract. Prove no disconnected line trick and no global geometry reset.

Use Motion Coordinator contracts for semantic activity mapping and focus/camera arbitration rather than ad hoc UI animation timeouts. Ensure real event activity drives salient effects, synthetic fixtures are labeled, and no hidden reasoning is invented.

### WP-D — Immersive Stream renderer

Preserve useful PR #20 Stream data semantics, source IDs, forensic inspection and test coverage. Do not delete an existing Glimpse/Flow card just to satisfy the primary immersion requirement. Develop a **separate app-level immersive view** that receives the plan, operation deltas and source-backed graph. Implement smooth parallel progress fronts, node states, direct gestures, level of detail and source inspection.

Validate estimated duration with uncertainty. Early/late completion changes animation pace but never changes backend result. Gate joins on actual dependencies, preserve historical failed attempts and source gaps.

### WP-E — Theater, project dock and UX

Design a small shell-level dock with one pill per active project, short name, genuine state and meaningful elapsed time; primary click opens workspace, secondary opens Stream. More than one eligible project requires a small selector at Stream entry. Inside a Stream, switching to another is direct.

The bottom-right Theater morphs between real activity adapters. Build at least one end-to-end source-backed adapter for each broad family and a truthful generic fallback for unimplemented types. Test source security, large output truncation, keyboard focus and simultaneous events without constant focus theft.

### WP-F — Spatial continuity

Model cross-mode travel using scene anchors and camera paths with explicit transitions. The hero journey is Vela Presence→click project mote→travel through active domain tendril→actual project graph→Theater→reverse back. Also implement direct Stream A→B movement while work continues.

Different rendering technologies are allowed if perceived continuity and anchors survive. The path must not be just a crossfade from one unrelated view to another. Define deterministic cancellation, back, focus restoration, gpu loss and reduced-motion paths.

### WP-G — Verification and owner artistic acceptance

A reviewer receives source-based evidence, moving-camera videos, actual app journey, performance metrics and an explicit unresolved defect ledger. Do not mark a visual category 'done' from unit tests. Record owner visual decisions separately from agent status and distinguish candidate, implemented, verified and accepted.

## 4. Required artifact bundle for each visual review

Every candidate review includes:

1. Exact commit SHA, app build artifact identity, OS, GPU/driver and renderer backend;
2. timecoded moving-camera video (≥ two rotation axes) covering idle, motion, connected extension, 3-domain activity, return path;
3. image reference side-by-side *review* using the original supplied source with its rights respected;
4. 3D construction diagram or capture confirming actual spatial volumes/surfaces, not pre-rendered planes;
5. state/event fixture or real event trace IDs, with data provenance and synthetic/live classification;
6. performance trace (CPU, GPU, memory, frame-time percentiles, render targets, background behavior);
7. explicit rubric assessment plus owner comments and required changes;
8. accessibility and reduced-motion capture for the same functional actions;
9. limitations, unverified claims, failed cases and rollback plan.

**No shortcut:** A GIF, still PNG, AI-generated concept image, test green check, or agent assertion that the design 'looks alive' cannot replace the moving native scene and owner review.

## 5. Prescribed native scenarios

### Journey J1: Reference-fidelity start

Open Presence in a clean native app on representative desktop hardware. Compare center nebula at rest to original provided reference. Orbit and zoom; see multiple spatial layers, wisps and inner light. Pause current-frame capture and inspect that a curved veil has depth. Repeat after a quality-tier change; lost detail is tracked honestly.

### Journey J2: Three-domain living extension

Trigger source-labeled Planning and Execution, then Writing. Three domain nebulas respond, central core deforms and stretches attached veils across actual 3D space, internal particles travel, new action motes appear and settle without overlap. Pause one domain, wait on another, terminate third with failure. Their outcomes differ visually; no completion fiction.

### Journey J3: Plan and fronts

Launch source-backed multi-step project operation. See future known plan before work. Observe independent branch progress and honest statuses. Delay a branch, inject source-backed estimate revision, test graceful pace adaptation. A join cannot complete until real required branches do. Inspect evidence.

### Journey J4: Theater truth

Read a real permitted file, run a real permitted command and generate a diff/test result. Theater shows the actual permitted content; user selects between simultaneous operations. Ingest redacted/unsupported event and verify no fake document projection appears.

### Journey J5: Two projects and three journeys

Run two real source-backed project jobs. See dock with distinct proper elapsed-time semantics. Enter project A Stream; switch directly to B; visit Presence and select A's mote back to A. Check saved camera/Theater in each, stable identity, and background work unaffected. Use cancellation midway through a scene transition.

### Journey J6: Failure and recovery

Make a real tool return unknown or disconnected, then reconnect the event source. Verify no invented success, preserved earlier attempt, accurate source gap and consistent replay. Reopen app and inspect the same canonical identities.

### Journey J7: Performance and fallback

Repeat active scene with many events, multi-display/mixed DPI, foreground GPU load and minimized/restored state. Record measured resource cost and responsive input. Force GPU loss or a disabled graphics setting; show functional accessible projection, approvals and navigation. No changes to backend execution state.

## 6. Proposed milestone stop-work conditions

Engineering must stop *claiming completion* and reopen design review if any of these appears:
- reference looks like a sphere, jellyfish, radial menu, diffuse smoke ball or static image rather than the supplied wispy asymmetrical silk nebula;
- deformation does not visibly pull material from the core into an outer domain;
- renderer only offers a flat sprite or 2D compositing plane;
- isolated shader art cannot be inspected through a moving native camera;
- a Stream shows a column/list of blocks with decorative branching rather than plan-first full-screen execution;
- a visual front passes an uncompleted operation or invents causality;
- transitions replace two unrelated scenes with only a fade and no spatial relationship;
- synthetic demonstrations are represented as live provider activity;
- significant CPU/GPU regression is waved away as the cost of being cinematic;
- approvals, keyboard controls or user input become inaccessible.

A failed candidate is research evidence; it should be reported clearly and may inform a better implementation. It is not a silent redefinition of the requirement.

## 7. Concurrency and repository delivery discipline

Do not edit files currently owned by another active Codex worker. Start with current PR #20 HEAD, detect subsequent changes, and create a scoped branch/worktree. Agree on typed shared contracts before separate UI and backend agents independently invent incompatible identifiers. Isolate GPU prototype and performance test code until the art gate passes. Keep native tests and actual product references separate from mock fixtures.

For integration into PR #20, do not force push, overwrite a worker's checkout or merge unrelated unreviewed changes. Use a new stacked PR or explicitly coordinated integration path; verify latest head before rebasing/retargeting. Preserve GitHub and review links in delivery notes.

## 8. Acceptance scorecard

A reviewer should be able to fill these fields with evidence and an explicit verdict:

| Dimension | Evidence | Verdict |
|---|---|---|
| Exact reference material & silhouette | Side-by-side original, moving native capture | Not reviewed / Reject / Accept |
| Real 3D GPU depth | Backend proof, two-axis orbit, depth inspection | Not reviewed / Reject / Accept |
| Living tendril deformation | Connected multi-domain film, temporal analysis | Not reviewed / Reject / Accept |
| Motion coherence | Velocity/transition evidence, no snapping | Not reviewed / Reject / Accept |
| Truth & permission | Real event trace and redaction checks | Not reviewed / Reject / Accept |
| Stream and Theater | Live graph, real operation adapters | Not reviewed / Reject / Accept |
| Spatial continuity | Recorded mode journeys | Not reviewed / Reject / Accept |
| Multi-project behavior | Two source-backed projects and navigation | Not reviewed / Reject / Accept |
| Accessibility | Keyboard, focus, reduced motion and non-GPU | Not reviewed / Reject / Accept |
| Performance | Measured hardware-specific gate | Not reviewed / Reject / Accept |
| Owner artistic acceptance | Explicit documented decision | Pending / Reject / Accept |

No averaged aesthetic score, agent enthusiasm or synthetic green test may automatically turn **Not reviewed** into **Accept**.

## 9. Explicit exclusions

This plan does not promise impossible access to private model thoughts; does not guarantee 60 FPS on every GPU; does not authorize public redistribution of the user-provided image without rights confirmation; does not specify a final GPU engine without evidence; and does not assert acceptance of any existing PR #20 blocks as the finished immersive Stream.

The intended outcome is a genuinely extraordinary interactive computational world, with verifiable source truth, responsible runtime cost and unmistakable visual authorship.
