# Vela Presence: GPU-Native Volumetric Rendering and Living Tendril Contract
## Technical implementation specification and anti-shortcut quality gate

| Item | Value |
|---|---|
| Status | Detailed proposed engineering contract; no renderer, benchmark or final visual result is yet accepted |
| Scope | Three-dimensional nebula representation, animation fields, tendril continuity, shader/material/light architecture, GPU telemetry, resource governance |
| Governing owners | [02 Motion](../../governance/02-LIQUID-INTELLIGENCE-AND-MOTION.md), [06 Vela](../../governance/06-VELA-INTELLIGENCE-AND-ADAPTATION.md), [13 Platform](../../governance/13-PLATFORM-PERFORMANCE-AND-DISPLAYS.md), [15 Acceptance](../../governance/15-QUALITY-VERIFICATION-AND-ACCEPTANCE.md) |
| Artistic authority | [Vela Intelligence Nebula Art Direction](../design/VELA-PRESENCE-INTELLIGENCE-NEBULA-ART-DIRECTION.md) |
| Contract ID family | VE-RENDER-*; governing obligations originate in the corresponding charters |

## 1. Renderer definition: real 3D, real GPU, real volume

The Vela Presence hero scene is **not** satisfied by CSS filters, a WebGL canvas showing a static texture, 2D noise, procedural SVG paths, flat PNG layers, screen-space lines, or a perspective camera facing only one billboard. The core and its surrounding domains require an actual three-dimensional, camera-traversable representation whose internal depth, opacity, geometry, scattering/emission, particles, and spatial occlusion change consistently with camera motion.

The primary rendering must execute on the GPU using a supported graphics backend. WebGL2/WebGPU/engine choice is a benchmark-backed architecture decision; do not change the application host, dependency policy or rendering stack merely to satisfy a preference without comparative evidence. 3D content can be represented by hybrid GPU techniques such as raymarched volumetric density, bounded 3D simulation fields, layered deformable translucent surfaces, procedural meshes, ribbon geometry, advected filaments, particles, or a physically motivated mix. The defining appearance may not be a flattened 2D impostor.

**VE-RENDER-01 — Physical depth:** The main cloud contains independently depth-resolved structures, not only a composited image. Rotate the camera at least around two independent axes and observe changing occlusion, parallax, internal folds, connected extensions and luminous pockets.

**VE-RENDER-02 — GPU proof:** The renderer exposes diagnostic backend selection, GPU device/context status, relevant draw/dispatch workload and fallback state. A canvas existing in the DOM is not proof that the required work is GPU-rendered.

**VE-RENDER-03 — No texture substitution:** An uploaded or generated 2D picture may guide composition but must never itself become the volumetric hero asset disguised by camera perspective.

**VE-RENDER-04 — Honest degradation:** If accelerated 3D fails, keep controls and source-backed activity available in an intentionally simplified accessible projection, and label the fidelity reduction. Never present a fallback as having passed 3D artistic acceptance.

## 2. Candidate scene architecture

A recommended *research architecture*, not a mandated library, uses these independently controlled layers:

1. **Domain field volumes:** sparse bounded signed-distance or density fields for the central core and external domain clouds. Parameterized transforms and topology changes determine macro shape. Volumetric passes must use adaptive sampling and early termination.
2. **Deformable veils:** multiple 3D translucent surfaces/ribbons with curvature, folds and fine edge breakup. Their mesh/spline controls live in 3D and evolve continuously; shader-based vertex deformation may supplement simulation.
3. **Anisotropic luminous filaments:** curved 3D spline/tube/ribbon bundles with finite thickness, hierarchical subdivision and coherent field motion; they pass in front of and behind major sheets.
4. **Advection particles:** GPU-efficient batched/instanced motes with positions, lifetimes and velocity influenced by a coherent field; drawn in depth-aware passes, not each as its own React element.
5. **Internal emission:** 3D light knots and varying emission/absorption intensities; physically-inspired but stylized radiance accumulation through the body.
6. **Sparse star glints:** small embedded points at multiple depths; saturation constrained to avoid whitening the scene.
7. **Postprocessing:** gentle bloom, tone mapping, dither/temporal stability and restrained aberration only if benchmarks allow; eye-candy never fixes a weak 3D volume.
8. **Semantic overlay:** accessible labels, selection affordances, project summaries and approvals in separately composited UI. Real data and accessibility are not shader textures.

Architecture alternatives should be prototyped in isolation with identical scenario inputs and camera paths, with recorded tradeoffs.

## 3. Flow field and life-like motion

A desirable behavior has **three nested temporal scales**:

- **Macro, tens of seconds to minutes:** asymmetrical restructuring, unfurling and closing veils, drift of mass centers and continuous silhouette evolution.
- **Meso, seconds to tens of seconds:** coherent folding vortices, braided filament transport, local twisting, magnetic-looking attraction/repulsion and domain-oriented stretching.
- **Micro, fractions of seconds to seconds:** sparkling and advected grains, short light pulses, high-frequency surface detail, fine tendril fraying.

No periodic state-reset should be noticeable. Use smoothly varying seeded noise and continuous phase space, not direct random re-positioning each frame. A nonlinear coupled flow field is preferable to stacking the same sine wave on several primitives. Different activity states modulate field parameters without changing Vela into unrelated geometry.

A mathematical candidate is:
`v(x,t) = v_base(x,t) + v_curl(x,t) + Σ_i a_i(t) v_domain_i(x,t) + v_recovery(x,t)`.
Here `a_i(t)` is a damped, hysteretic domain activation signal from real observable events. Spatial vector fields and field sampling must be bounded and stable. The exact solver and density representation are research choices, not prescribed physics.

**VE-RENDER-05 — Coherent phase:** Continuous motion state persists across updates, pauses, navigation and quality tiers; no reset-to-first-frame on every status event.

**VE-RENDER-06 — Recognizable identity:** Silhouette motifs persist across deformation, avoiding both rigid repetition and total stochastic shape replacement.

**VE-RENDER-07 — State truth:** Ambient field motion is explicitly decorative. Dispatch, approval, failure and completion effects bind to canonical events; absence of new events cannot be depicted as documented activity.

## 4. Organic bridge and tendril formation

The center-to-domain extension is a **material-continuity event**, not an edge appearing between two nodes. A tendril forms by gradually transporting part of the central nebula's field toward the target:

1. **Anchor selection:** choose stable but flexible source patches on the real core envelope, and an arrival region within the target domain. Anchors exist in world space.
2. **Buildup:** local curvature and density gradients respond, creating visible pre-stretch deformation. Energy/current shifts within the original mass.
3. **Extrusion/stretch:** translucent sheets and filament bundles extend along a smooth 3D path; cloud density transitions smoothly from source volume into the bridge.
4. **Connection:** the destination forms reciprocal internal motion. A bridge remains spatially continuous and moves with both endpoints.
5. **Transport:** particles and internal brightness modulations traverse the actual curved field; direction and provenance depend on observed event types.
6. **Branching:** multiple bridgelets can split and braid while sharing material origins. Joining two domain streams requires semantic support, not arbitrary prettiness.
7. **Retraction:** on inactivity, motion decelerates with damping, filaments fold back, field density dissipates without popping. On failure, state changes remain distinguishable and should not look like success.
8. **Interruption/recovery:** stalled, unknown or disconnected operations retain an honest diminished/uncertain visual, not a claimed completion burst.

Use an SDF union/warped volume, continuous tube-density interpolation, connected ribbon manifold, or another technically justified 3D method. A hairline renderer can enhance it, but **a glowing Bézier curve alone fails the contract**.

**VE-RENDER-08 — Material continuity:** At least one major visible veil and its internal filaments must deform from the actual central cloud into an outer domain. Reviewers can pause animation and inspect continuity from multiple camera angles.

**VE-RENDER-09 — Independent concurrent bridges:** Three domains may be active concurrently; bridges have independent timing and semantic signals, bounded overlap, and stable origin/target relationships.

**VE-RENDER-10 — Stable dynamics:** No position jumps, instantaneous reparenting, visibly discontinuous velocity, topology pops or sudden all-particle reseeds during ordinary operations.

**VE-RENDER-11 — Light inside:** Brightness/pulse transport must be volumetric or embedded within actual geometric layers, not simply drawn as a high-intensity outline pasted on top.

## 5. Six external domain nebulae

Each domain is a **substantial GPU-rendered three-dimensional volume**; a small colored circle on a radial UI fails. They must preserve approximate spatial neighborhoods for learned orientation, while permitting volumetric drift and object-scale deformations.

Each has a distinct parameterization (flow regime, internal density, emissive knots, sheet roughness, filament family and turbulence). They share a material lineage, so the scene reads as one natural system rather than six random 3D assets. Domain prominence uses observed event activity, not an unbounded speculation about model attention. Zero activity need not mean no ambient light.

Build a simple visibility budget: distant inactive domains reduce update frequency or level of detail without losing selection identity. Limit scene clutter through occlusion-aware labels, grouping, and camera focus.

## 6. Material and light pipeline

The reference's characteristic visual grammar calls for:

- Thin silver-blue translucent fabric-like sheets, semi-refractive-looking seams, loose edges and spatial translucency.
- Icy cyan/blue emission and lavender-violet/pink spectral overlays; deep ultramarine valleys and near-black negative space.
- Irregular interior luminous knots, fine starfields and granular suspended particulate matter at real 3D depths.
- Edge and grazing-angle glow that preserves folds rather than outlines every polygon.
- Camera-aware opacity and absorption; depth sorting or order-independent transparency strategy validated for crossings.
- No harsh radial gradients, opaque smoke blobs, excessive additive washing-out, glassy plastic spheres or over-bloomed white centers.

Candidate GPU approaches for depth/lighting include front-to-back ray integration with absorption and emission, multi-pass depth peeling or weighted blended transparency for folded surfaces, view-dependent Fresnel highlights, approximate anisotropic scattering and local emissive particles. Select based on measured quality and cost, not technique fashion.

Test against black and dark-stellar backgrounds. Capture both high-contrast and dark-corner portions; ensure the volume does not vanish when bloom is disabled.

## 7. Shader, update and memory discipline

GPU work must be batched and bounded. The application must not create one DOM/canvas draw entity per micro-particle or perform large GPU-to-CPU readbacks each frame. Track allocations for geometry, render targets, textures, buffers, pipelines and postprocess surfaces. Dispose of resources when views unmount and recover from context/device loss. Pause/slow background rendering when hidden or idle without pausing real backend tasks.

Adopt measured adaptive quality tiers including:
- raymarch sample count / resolution;
- vein/surface geometric detail;
- particle count and update rate;
- shadow/scattering approximation and bloom;
- antialiasing/temporal accumulation;
- target render frequency for background/inactive view;
- multimonitor and DPI-aware viewport and context handling.

A quality governor uses hysteresis to avoid flapping. It protects input and text, the Activity Theater, foreground applications, memory reserve and device thermals. Hardware-specific frame-time and VRAM budgets are selected by Charter 13's measurement process, not invented here. **60 FPS on capable hardware is a target to validate, not a universal performance claim.** Performance evidence must include long sustained runs, gaming GPU contention, minimized background, resize, DPI switching and GPU-context loss.

## 8. Instrumentation and inspectability

Required debug overlays or exported telemetry for prototypes:

- chosen backend, adapter and graphics API;
- frame duration distribution (CPU and GPU where available), dropped frames and stalls;
- GPU frame/pass times, resolution and major draw/dispatch counts where supported;
- counts for particle instances, strips/veils, volumes, active bridges and domain layers;
- estimated GPU memory/resident resources and allocation growth over time;
- current semantic activation vector and source IDs, with privacy-safe redaction;
- quality tier, reason for downgrade, context loss/recreation;
- stream-to-render event age and particle/animation scheduler state.

Do not present synthetic GPU figures as measured data. If a platform cannot expose an exact counter, mark it unavailable.

## 9. Hard acceptance protocol

**Gate R0 — Design selection:** At least two genuinely different 3D rendering approaches shown with moving-camera recordings and identical art target. Artistic owner reviews form, material, inner light and veil topology before integration. A technical lead records the chosen approach and alternatives.

**Gate R1 — 3D reality:** GPU proof and two-axis camera test; disable any 2D background/sprite impostors and verify actual dynamic volumetric objects still exist.

**Gate R2 — Material reference:** Side-by-side review against the exact user-supplied image. Review silhouette, translucent folds, spectral layering, internal points of light, negative space and organic motion. A pretty generic sphere fails.

**Gate R3 — Tendril proof:** One slow connected deformation, then three concurrent independent bridges, then interruption/retraction. Record frame-by-frame closeups and camera orbit. Curves/lines alone fail.

**Gate R4 — Runtime response:** Use real source-attributed events to engage domains and satellites; explicitly label synthetic fixtures in development-only tests. No hidden reasoning claims or fake completions.

**Gate R5 — Spatial continuity:** Full travel Presence ↔ project Stream and project A ↔ project B with persistent task state and correct focus. A hard view replacement with a crossfade alone fails.

**Gate R6 — Safety and resilience:** Approval legibility, accessible alternate projection, reduced motion, low GPU, context-loss recovery and no loss of backend execution.

**Gate R7 — Sustained performance:** Multiple display sizes, load tiers, desktop idle/gaming scenarios, no memory creep, source-backed measurements and owner artistic sign-off.

No one gate can be substituted for another. Clean compilation, a static screenshot, a shader demo, or a successful fake event stream does not constitute completion.

## 10. Architecture questions to resolve in research

1. WebGPU readiness versus WebGL2 portability in actual chosen desktop host.
2. Raymarched volume plus surface layers versus fully procedural deforming meshes plus volumetric particle fields.
3. Depth-sorted translucent ribbons versus order-independent transparency approximations.
4. Simulation on GPU compute versus CPU parameter updates and GPU rendering, including platform fallback.
5. Reusable world-space motion field and bridge topology without costly per-frame mesh reconstruction.
6. Testable deterministic seeds, record/replay behavior and camera transitions without camera-induced false depth.
7. GPU profiler availability and artifact-based performance verification.

Unresolved choices require measured prototype evidence, a written ADR, owner review and clean fallback behavior. An implementation agent is not authorized to weaken this specification merely because the first pass looks difficult.
