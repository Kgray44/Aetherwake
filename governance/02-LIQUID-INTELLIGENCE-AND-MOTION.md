# 02 — Liquid Intelligence and Motion
## Governing Charter for Aerynth's Cinematic Visual Language, Six-System Motion Coordinator, and Motion-Driven Interaction

| Field | Value |
|---|---|
| Document ID | **AW-GOV-002** |
| Version | **1.0.0-draft** |
| Status | **Published proposed governing charter — awaiting repository-owner acceptance** |
| Prepared | 2026-11-01 |
| Authority | Specialized subsystem charter subordinate to [00 — Aetherwake Constitution](00-AETHERWAKE-CONSTITUTION.md) |
| Normative requirement namespace | **AW-LIQ-###** |
| Primary domain | Liquid Intelligence visual identity, glass/material depth, particles and spatial fields, motion choreography and semantics, persistent visual objects, Vela presence, synchronized rendering, adaptive motion, visual acceptance |
| Constitutional anchors | AW-CON-001–003, 011–021, 025–035, 042–047, 051–065, 069–078, 084–091; C-04, C-05, C-13, C-14 |
| Primary collaborators | [01 Interaction](01-EXPERIENCE-AND-INTERACTION.md), [03 Resources](03-PROJECTS-WORKSPACES-AND-RESOURCES.md), [06 Vela](06-VELA-INTELLIGENCE-AND-ADAPTATION.md), [09 Observability](09-INTELLIGENCE-STREAMS-AND-OBSERVABILITY.md), [10 Profiler](10-AI-EXECUTION-PROFILER.md), [11 Timelines](11-TIMELINES-AND-REPLAY.md), [13 Platform](13-PLATFORM-PERFORMANCE-AND-DISPLAYS.md), [14 Trust](14-TRUST-PRIVACY-AND-AUTONOMY.md), [15 Quality](15-QUALITY-VERIFICATION-AND-ACCEPTANCE.md) |
| Technology posture | Renderer/framework/API and numeric motion constants remain research decisions validated through packaged prototypes |
| Public document boundary | Use synthetic showcase content only; no private conversations, proprietary captures, credentials, sensitive telemetry, or personal display inventory |

> **Visual promise.** Aerynth is not a generic application decorated with blur, cyan glow, a spinner, or a looping particle video. **Liquid Intelligence** is a spatial, luminous, physically coherent, context-sensitive design language through which users perceive and control a complex intelligent environment. Its visual character must be extraordinary **and** its information unambiguous.
>
> **Motion promise.** Motion is a first-class system alongside data and agent execution. The six coordinated disciplines—**Spatial, Material, Atmospheric, Semantic, Interaction, and Performance Motion**—MUST share timing, state, identity, performance constraints, and accessibility semantics. A 200 ms slide transition is not a substitute for cinematic environmental continuity.
>
> **Truth promise.** The system may express real observable AI activity through beautiful abstraction, but MUST NOT portray inaccessible private model reasoning as observed fact, simulate successful operations in production, or use beauty to conceal uncertainty.

---

## 1. Purpose, authority, boundaries, and definitions

This charter governs **visual meaning and motion behavior**: the desired aesthetic, principles, continuity, coordination, responsiveness, materiality, state choreography, cinematic quality, and verification criteria. The implementation is deliberately technology-neutral until benchmark-backed decisions are accepted.

The Constitution has precedence. The repository owner retains final authority through explicit amendment and acceptance. **MUST/MUST NOT** denote binding obligations, **SHOULD** a strong default requiring rationale to deviate, and **MAY** an optional capability. This is a published proposal awaiting owner acceptance.

**This charter owns:** visual grammar and motion semantics; physical and spatial choreography; coordinated visual states; surface materials; agent presence visual language; graphical expression of selection, task activity, approval and relationships; animation lifecycle; visual degradation principles; cinematic acceptance.

**Others own:** human intent and interaction flows (01); resource identities and layout persistence (03); Vela's actual initiative and assistant status (06); event provenance and stream correctness (09); runtime telemetry data (10); historical/forecast truth (11); graphics API/CPU/GPU/memory budgets, display topology and OS fallback (13); authorization (14); global test/release process (15).

### 1.1 Vocabulary

| Concept | Meaning |
|---|---|
| **Liquid Intelligence** | The product's integrated visual identity: coherent spatial transformation, luminous materials, event-aware detail, and calm persistent presence |
| **Motion Coordinator** | Architectural owner of animation intent, state mapping, scheduling, coordination, and quality adaptation across all six motion systems |
| **Semantic state** | Truthful state of objects and operations received from application/backend services |
| **Visual state** | Presentation representation, transition progress, material and spatial properties derived from semantic state |
| **Motion intent** | Requested transition containing source/target identity, event cause, priority, channels, continuity and accessibility policy |
| **Visual identity** | Persistent object key allowing the same resource/block to transform between layouts rather than disappearing and reappearing |
| **Material** | Layered presentation treatment (transmittance, highlights, edge light, occlusion, blur, shadow, texture, contrast) |
| **Atmosphere** | Environmental scene: spatial particles, filaments, volumetric suggestion, ambient light, depth |
| **Semantic animation** | A transformation keyed to real recorded state, not a fictitious claim about model internals |
| **Quality tier** | Configurable rendering-cost mode with preserved meaning and interaction |
| **Reduced motion** | Equivalent accessible experience with continuous/high-amplitude motion suppressed or replaced |
| **Scene graph** | Rendering arrangement of persistent spatial objects and effects; not itself the canonical object database |
| **Occlusion hierarchy** | Rules for which layers may cover or dim others; especially text, input, and approval controls |
| **Reconciliation** | Restoring visual state from authoritative state after interruption, dropped frames, or backend disconnect |

**AW-LIQ-001 — Constitution first.** The cinematic design MUST serve comprehensibility, honest system state, user control, and performant operation; spectacle is not a waiver of those guarantees.
**AW-LIQ-002 — First-class milestone.** The visual system, Motion Coordinator, and representative interactions MUST be researched, prototyped, and validated as an early primary milestone, not retrofitted after a generic dashboard is finished.
**AW-LIQ-003 — Single visual identity.** Main windows, workspaces, chats, drawers, charts, overlays, timeline surfaces, detached blocks, and Vela presence MUST share a consistent design vocabulary, even when using rendering fallbacks.
**AW-LIQ-004 — No false state.** Production visuals MUST be derived from trustworthy state or explicitly labeled prediction, inference, or simulation; unavailable backend activity is not permission to fabricate progress.
**AW-LIQ-005 — Separation of roles.** Domain data and event ownership remain with their specialized subsystems; the Motion Coordinator MUST project them visually rather than making the renderer a source of business truth.
**AW-LIQ-006 — No premature technology lock-in.** Technology selection MUST follow recorded research and realistic benchmarks on target hardware and packaged windows, coordinated with 13/15.

---

## 2. Aesthetic and experiential direction

Aerynth should suggest a premium, deeply considered, future-facing intelligent environment rather than a themed developer dashboard. Descriptive references include cinematic holographic information, the compositional restraint of spatial computing, high-end scientific instrumentation, and a quiet, capable personal assistant. These are **mood references, not instructions to copy proprietary character design or visual assets**.

### 2.1 Visual layers

| Layer | Design role | Constraints |
|---|---|---|
| **Atmosphere** | Slow dimensional background, particulate field, depth, horizon, ambience | Must never compete with important content |
| **Spatial structure** | Underlying organization and proximity cues, focus fields, anchors | Must map to understandable navigation |
| **Material surfaces** | Translucent glass, refractive suggestion, controlled edge and shadow hierarchy | Legibility and performance take precedence |
| **Content** | Text, data, inputs, diagrams, charts, documents | Crisp, selectable, accessible, high contrast |
| **Active intelligence** | Vela presence, agent nodes, real task/status signals | Semantic meaning, visible provenance |
| **Focus/attention** | Selection, contextual command, approvals, blocking errors, priority alerts | Most legible layer; no decorative obstruction |

**AW-LIQ-007 — Compositional restraint.** Depth, subtle luminous edge, controlled negative space, typography, spatial movement, and meaningful light SHOULD establish a refined aesthetic; generic neon outlines, arbitrary hex grids, constant bloom and fake hologram noise MUST NOT define the final product identity.
**AW-LIQ-008 — Hierarchy before decoration.** Users MUST be able to identify primary content, active selection, available actions, ongoing work, and urgent attention without decoding particle behavior.
**AW-LIQ-009 — Quiet and cinematic.** Idle scenes SHOULD remain calm, continuous and visually alive; significant transitions MAY be dramatic but MUST settle into an unobtrusive state.
**AW-LIQ-010 — Content inviolability.** Reading and editing text, code, tables, accessibility labels, and permission decisions MUST remain legible and stable regardless of glass or ambient lighting.
**AW-LIQ-011 — Authentic material differentiation.** Glass, luminous structures, depth layers, and information surfaces SHOULD have distinct meaningful materials, not uniform blurred rectangles.
**AW-LIQ-012 — Customizable expression.** User-configurable accent, intensity, atmosphere, opacity and theme MAY personalize the scene without changing domain semantics or accessibility guarantees.
**AW-LIQ-013 — Cross-surface cohesion.** A core object MUST remain recognizable when represented as a home tile, workspace block, full pane, focus view, relationship node, or detached window.
**AW-LIQ-014 — No mandatory theatrical delay.** Animation MAY express transformation but MUST NOT force the user to endure unnecessary waits before using important controls.

---

## 3. Motion Coordinator: six synchronized systems

The Motion Coordinator receives semantic state changes, user interaction intents, layout changes, and performance/accessibility signals; it emits coordinated visual transitions and exposes cancellation, settling, recovery and instrumentation. Its implementation may be composed from several libraries/engines, but the product MUST behave as one coherent motion environment.

### 3.1 Required disciplines

| System | Canonical responsibility | Illustrative behavior |
|---|---|---|
| **Spatial Motion** | Placement, transforms, scale, docking, detaching, expand/collapse, field continuity | Chat block morphs into full conversation |
| **Material Motion** | Glass thickness illusion, opacity, highlights, refraction suggestion, shadows, lighting response | Lifted tile changes edge, shadow, light |
| **Atmospheric Motion** | Particles, filaments, ambient forces, environmental field, Vela atmosphere | Controlled ripples on observed agent activity |
| **Semantic Motion** | Maps recorded state transitions to understandable visual states | Actual tool call enters running state |
| **Interaction Motion** | Input feedback, selection, drag, hover, gesture, command invocation, focus | Neighbors fluidly yield to dragged block |
| **Performance Motion** | Quality adaptation, cadence, effect throttling, scheduling, graceful fallback | Gaming mode reduces background particles |

**AW-LIQ-015 — Unified scheduler.** All motion disciplines MUST coordinate via consistent timebase, transition IDs, resource identity, priority, accessibility policy, and quality policy; unrelated animation subsystems MUST NOT fight for the same visual property.
**AW-LIQ-016 — Declarative motion contract.** A transition SHOULD be specified by source/target semantic state and animation intent rather than ad hoc timeouts scattered through feature code.
**AW-LIQ-017 — Interruption-safe choreography.** Users MUST be able to reverse, interrupt, redirect, reparent or resize active transitions without teleporting objects, losing state, or trapping input.
**AW-LIQ-018 — Event-driven meaning.** Semantic Motion MUST use real application/backend events for externally claimed activity, with missing/unknown states shown honestly.
**AW-LIQ-019 — Readability priority.** Interaction focus, typing caret, overlays, approvals and urgent error messages MUST take priority over decorative choreography.
**AW-LIQ-020 — Quality tier continuity.** Performance Motion MUST reduce render cost while preserving spatial identity, event meaning and accessible input.
**AW-LIQ-021 — Diagnosability.** Engineers MUST be able to inspect transition IDs, affected objects, start/end states, chosen motion profile, interruption reason, quality mode and dropped/late frame observations where available.
**AW-LIQ-022 — No animation dependency for correctness.** Object creation, state mutation, undo, file operations, and authoritative status MUST complete independently of rendering frames and animations.

### 3.2 Coordinator pipeline

1. **Observe:** Accept a typed domain event or user gesture and current semantic state.
2. **Resolve:** Determine affected persistent objects and their current presentation instances.
3. **Plan:** Construct spatial/material/semantic/interaction transitions with dependency order and accessibility alternatives.
4. **Budget:** Allocate effect priority using current frame and resource pressure.
5. **Render:** Drive GPU/CPU composition via suitable renderer adapters.
6. **Reconcile:** Compare presentation target with authoritative latest state; coalesce superseded transitions.
7. **Record:** Publish non-sensitive motion/performance evidence and meaningful state-change records to approved observability interfaces.

The coordinator MUST distinguish **business operation completion** from **visual transition completion**.

---

## 4. Spatial Motion: a continuous intelligent environment

Spatial Motion should convey that resources exist in one environment, not isolated screens. A block expanding, a dialog emerging from a selected note, or a chart becoming a full timeline should visually conserve the identity of its origin where practical.

**AW-LIQ-023 — Persistent object mapping.** Transitioning a resource across layouts MUST maintain a stable referent and coherent source-target association; duplication of visual views MUST NOT silently duplicate canonical data.
**AW-LIQ-024 — Shared-element continuity.** Representative interactions MUST use continuity of visual object, title, anchor, content and position rather than replacing content with unrelated entering/leaving panels.
**AW-LIQ-025 — Physically credible response.** Core drag, resize, dock, snap, expand and reflow transitions SHOULD use tunable spring/damping/velocity continuity, with no obvious abrupt speed discontinuities.
**AW-LIQ-026 — Neighbor response.** Rearrangement MUST provide understandable space-making cues; nearby blocks SHOULD react smoothly before settling.
**AW-LIQ-027 — Interaction ownership.** User-directed dragging MUST remain directly responsive and must not be delayed by lower-priority ambience or deferred artificial intelligence.
**AW-LIQ-028 — Predictable topology.** The transition MUST preserve the user's mental map of where objects came from, where they move, and which relationship changed.
**AW-LIQ-029 — Detached surface continuity.** When blocks detach or move between supported displays, identity and focus MUST persist. Where seamless cross-window visual interpolation is unavailable, use an honest, elegant handoff rather than a broken or deceptive morph.
**AW-LIQ-030 — Scroll and layout stability.** Streaming chat messages, log growth, status events, and background rearrangements MUST NOT yank focused content away from users.
**AW-LIQ-031 — Bidirectional motion.** Reversible navigation SHOULD reverse or retarget a transition in continuity rather than resetting to an unrelated canned animation.
**AW-LIQ-032 — Spatial scale.** Animation grammar MUST adapt from small microinteractions to project-scale graph/canvas transformations without making navigation disorienting.
**AW-LIQ-033 — Workspace mode parity.** Grid, dock, list, graph, and freeform modes MUST maintain identity and comprehensibility even if they use different scene representations.

### 4.1 Reference transitions

| Scenario | Expected spatial meaning |
|---|---|
| Home chat tile → full conversation | Same resource enlarges; title/control anchor remains recognizable |
| Drag workspace block | Elevates, local neighbors yield, intended placement previews, stable spring settle |
| Select text → Contextual Command | Command appears anchored near selection, repositions around viewport safely |
| Vela creates timeline | New timeline receives space, connected tasks become visible, neighboring layout responds |
| Focus Mode | Peripheral surfaces recede without erasing or duplicating state |
| Open relationship view | Selected resource remains the navigational anchor as related nodes organize around it |
| Move block to second monitor | Continuous logical identity and correct display-role placement; safe host fallback |

---

## 5. Material Motion: dimensional luminous glass

Aerynth glass must look premium, layered and intentional. It must not require expensive blur everywhere, nor sacrifice readable contrast.

**AW-LIQ-034 — Material system.** Production MUST define reusable material tokens for clear/translucent/opaque surfaces, panel hierarchy, focused surfaces, elevated drag surfaces, disabled elements, alerts, and background structures.
**AW-LIQ-035 — Depth hierarchy.** Shadow, rim light, surface translucency, subtle highlight motion, edge treatment, occlusion, and scale MUST communicate actual layer and focus priority.
**AW-LIQ-036 — Dynamic light response.** Hover, drag, elevation, focus and active-state materials SHOULD react consistently to scene orientation and interaction without expensive uncontrolled full-scene recomputation.
**AW-LIQ-037 — Legibility-preserving glass.** Text panels MUST include adaptive backing/opacity or contrast compensation when background luminance, particles, imagery or effect load would otherwise reduce legibility.
**AW-LIQ-038 — Restrained bloom.** Glow and bloom MAY emphasize Vela, selection or significant activity, but MUST NOT smear code, text, charts, focus outlines or alert boundaries.
**AW-LIQ-039 — Stable visual ownership.** Material transitions MUST not change hit targets, keyboard focus, or the underlying semantic state of a block.
**AW-LIQ-040 — Progressive materials.** Reduced quality tiers MUST preserve recognizable glass layering through cheaper compositing or opacity/shadow alternatives, rather than devolve into indistinguishable rectangles.
**AW-LIQ-041 — User-adjustable clarity.** The product MUST support a legibility-first mode and user controls for effect intensity/opacity sufficient for high-contrast and reduced-transparency needs.
**AW-LIQ-042 — Material benchmark.** Expensive blur, refraction, backdrop filters, stacked transparency, multi-window composition, and text antialiasing interactions MUST be profiled in representative actual surfaces before being standardized.

---

## 6. Atmospheric Motion: particles, filaments, fields, and depth

Atmosphere is integral to the Liquid Intelligence identity. It must feel responsive and dimensional, not merely a continuously running particle wallpaper.

**AW-LIQ-043 — Meaningful atmospheric grammar.** Define restrained idle motion, focus response, event pulse, spatial field and ambient transition behaviors; decorative randomness MUST not be misconstrued as agent state.
**AW-LIQ-044 — Separate rendering system.** High-volume particle and field rendering SHOULD use a dedicated GPU-friendly batch/instancing/shader architecture; thousands of independent framework component updates per frame MUST NOT be the primary design.
**AW-LIQ-045 — Adaptive density.** Particle count, simulation frequency, lighting, blur, postprocessing and update cadence MUST support automatic and manual quality adaptation.
**AW-LIQ-046 — Interaction-aware field.** Pointer movement, block lift, focus changes and Vela activation MAY distort or reorganize atmospheric field subtly, with bounded cost and no impairment of content.
**AW-LIQ-047 — Quiet idle.** Idle effects MUST remain subtle and low overhead; inactive/minimized views SHOULD suspend or greatly reduce simulation and visual presentation in coordination with 13.
**AW-LIQ-048 — Real-event signals.** Ripples linked to agent start, delegation, tool use, completion or failure MUST reflect actual applicable events and not fabricate unseen thinking or causal relationships.
**AW-LIQ-049 — Bounded visual salience.** Particle density/velocity, bloom and background contrast MUST automatically yield to reading, input, dense data, approval screens, and focus mode.
**AW-LIQ-050 — Fallback identity.** The application MUST remain recognizable and pleasing with particle simulation disabled; animation must enhance rather than supply fundamental affordances.
**AW-LIQ-051 — No leaking private state.** Ambient visual signals MUST not reveal sensitive project activity or permissions to unauthorized observers, locked screens or public presentation mode.

### 6.1 Recommended visual cues (illustrative, subject to prototype)

- **Idle:** Low-frequency filaments, calm floating nodes, slow field evolution; no simulated "thinking."
- **Assistant invited:** Cohesive local field response converging toward the invocation anchor.
- **Agent delegation:** A connection grows between attributable agent/task nodes, then transitions to active.
- **Tool running:** Local semantic pulse at the corresponding agent/block, not a fabricated percentage ring.
- **New verified result:** Stable information node appears with evidence link.
- **Failure or blocked:** Restraint, clear high-contrast status and path to resolution; not a screen-wide red alarm for routine errors.

---

## 7. Semantic Motion: truthful intelligence and meaningful events

Semantic Motion maps externally observable operational events to visual transitions. It does not expose hidden model internals.

**AW-LIQ-052 — State-to-effect map.** Every production animation claiming operational meaning MUST have a defined originating event/state, valid transition, accessible textual equivalent, and treatment for missing updates.
**AW-LIQ-053 — No fake mental animation.** Vela's presence or a reasoning-themed animation MUST NOT imply live access to private chain-of-thought, exact reasoning steps, internal emotions, self-awareness, or model progress percentages unless directly supported.
**AW-LIQ-054 — Provenance distinction.** Observed tool executions, model-provided summaries, Vela inferences, forecasted operations, and unknown state MUST have distinguishable visual semantics when displayed together.
**AW-LIQ-055 — Completion rigor.** Agent final message, tool success, passing tests, reviewed change, merged integration and user-accepted outcome MUST NOT all collapse into the same "completed" visualization.
**AW-LIQ-056 — Status vocabulary.** Core views MUST have coherent visual equivalents of idle, queued, processing, streaming, executing tool, waiting for input, blocked, offline/degraded, failed, interrupted, partially complete, and verified complete when relevant.
**AW-LIQ-057 — Uncertain progress.** Indeterminate operations MUST use indeterminate state, elapsed-time/step info or factual operation names, not invented progress bars or countdowns.
**AW-LIQ-058 — Cross-agent attribution.** Delegation and result sharing animations MUST preserve source and target agent identity and distinguish information transfer from command/permission delegation.
**AW-LIQ-059 — Historic versus predicted.** Timeline motion MUST visually separate recorded events and forecast trajectories with explicit uncertainty; a simulated replay must not pretend to reconstruct unrecorded events.
**AW-LIQ-060 — Missing evidence.** Stream disconnection, dropped events, unavailable metrics and unverified outcomes MUST produce honest gap/degraded visuals, not frozen "success" or endless cheerful particles.
**AW-LIQ-061 — Event salience control.** Low-level tool events SHOULD aggregate into calm activity, while meaningful errors/approvals may rise in prominence according to attention policies.
**AW-LIQ-062 — Deterministic reconstruction.** Given stored events and versioned semantic visual mappings, significant historical state transitions SHOULD support reproducible replay subject to data coverage, with clear simulation labels where interpolation is reconstructed.

### 7.1 Semantic examples

| Incoming state/event | Visual response | Must NOT imply |
|---|---|---|
| Turn started | Agent begins observable activity state | Secret thoughts are being read |
| Tool command started | Tool/terminal node pulses, command identifiable | Command already succeeded |
| Reasoning summary reported | Summary text and reported-data cue | Verbatim private chain-of-thought |
| Agent spawned task | Traceable new connected node | Unrelated agents share private full context |
| File mutation observed | Resource boundary responds and evidence is linked | Change is verified correct |
| Tool error | Localized failure state with detail | Whole project irreversibly failed |
| Approval requested | Clearly elevated actionable approval surface | Approval already granted |
| Verified test result | Stable verified evidence node/status | Final human acceptance occurred |
| Connection lost | Activity state becomes unknown or disconnected | Task safely finished |

---

## 8. Interaction Motion: direct and intuitive physicality

Interaction Motion represents the immediate consequences of human input. It MUST feel low latency and trustworthy, with enough visual richness to enhance understanding.

**AW-LIQ-063 — Selection feedback.** Pointer/keyboard/voice selection MUST have stable, readable selected-state feedback that can be inspected without relying only on glow or animation.
**AW-LIQ-064 — Contextual Command emergence.** The command field SHOULD emerge visually from the selected object/region, remain attached as layout shifts, and avoid covering text, target controls or important content.
**AW-LIQ-065 — Dynamic scope preview.** When the interpreted command targets an expanded group rather than the initial selection, affected objects SHOULD illuminate/outline/organize meaningfully before risk-appropriate confirmation; the actual target count and scope MUST be readable.
**AW-LIQ-066 — Press/drag physics.** Press, lift, drag and release SHOULD share a physical motion vocabulary with restrained momentum and tunable springs, but MUST obey direct manipulation and accessibility settings.
**AW-LIQ-067 — Dismissal and cancellation.** Cancel, undo, reverse, and escape actions MUST have responsive feedback that clearly reflects whether the underlying operation was actually cancelled or reversed.
**AW-LIQ-068 — No blocking UI animation.** Essential typing, selection, keyboard navigation, copy, save and emergency cancel MUST work regardless of whether motion is still settling.
**AW-LIQ-069 — Foreground priority.** Background agent activity MUST NOT seize keyboard focus, move a selection anchor, or trigger disruptive layout transitions without user intent.
**AW-LIQ-070 — Edge and viewport safety.** Floating menus, command inputs, evidence overlays, and assistant presence MUST adapt to viewport edges, high-DPI scaling, zoom and multi-monitor boundaries.
**AW-LIQ-071 — Touch/keyboard equivalence.** The interface MUST have equivalent focus/selection cues and usable non-drag controls where a gesture or precision pointer is unavailable.
**AW-LIQ-072 — Motion consistency.** Common actions (open, focus, expand, attach, connect, detach, approve, fail, dismiss) MUST have a consistent recognizable motion signature across surfaces.

---

## 9. Vela's visual presence and agent constellation

Vela is a persistent assistant identity, not a decorative orb that always claims to be thinking. The user MAY customize or hide her visual embodiment without losing reachability.

**AW-LIQ-073 — Recognizable Vela presence.** Vela SHOULD have a coherent responsive form based on luminous/filament/particle or other researched material language, with expressive but restrained ambient motion.
**AW-LIQ-074 — Honest activity.** Vela's visual modes MUST correspond to application-observable availability, active response, delegation, waiting, monitoring, disconnected, or degraded state, not a fictional continuous cognitive process.
**AW-LIQ-075 — Nonintrusive placement.** Vela's presence MUST avoid covering writing, selection, terminal content, approvals or critical controls; users MUST be able to reposition, minimize or hide it.
**AW-LIQ-076 — Accessible presence.** Vela MUST remain invocable via accessible controls and keyboard when her visual form is removed or motion is disabled.
**AW-LIQ-077 — Constellation identity.** Agent visualization SHOULD show attributable nodes and typed links for delegation, task dependency, shared finding, ownership or evidence, with labels and non-graph alternatives.
**AW-LIQ-078 — Relationship caution.** Visual connections MUST NOT imply collaboration, causality, shared context or successful handoff when the corresponding relationship is uncertain/unrecorded.
**AW-LIQ-079 — Scalable density.** Constellations MUST support clustering, zoom, filters, focus, semantic grouping and manageable labels. Dense systems MUST not become an unreadable moving starfield.
**AW-LIQ-080 — User-tunable drama.** Vela and constellation effects SHOULD support intensity settings without changing how assistants or agents are actually authorized or executed.

---

## 10. Timeline, Intelligence Stream and chart choreography

Aerynth renders complex temporal relationships without making them visually misleading.

**AW-LIQ-081 — Temporal legibility.** Historical events, replay cursor, forecast bands, blocked dependencies and live execution MUST remain visually separable.
**AW-LIQ-082 — Timeline construction.** On user command, a timeline block SHOULD emerge and settle as part of the current workspace, with task bars/nodes coherently tied to referenced objects.
**AW-LIQ-083 — Stable time axis.** Zooming or moving the timeline MUST preserve recognizable temporal anchors, labels, selected events and the user's place in history.
**AW-LIQ-084 — Uncertainty representation.** Forecast animation MUST preserve confidence/range semantics; it MUST NOT turn rough duration estimates into precise-looking completion predictions.
**AW-LIQ-085 — Streaming continuity.** Incoming agent events MUST append or update smoothly without unpredictable scrolling, DOM/reflow storms, loss of selection, or focus hijacking.
**AW-LIQ-086 — Chart truthfulness.** Chart highlights, pulsing points, moving bands and heatmaps MUST be bound to actual available metrics and never produce invented values or fabricated relationships.
**AW-LIQ-087 — Replay truth.** Scrubbing recorded events MAY animate between observed states, but missing intervals and synthetic interpolation MUST be distinguishable from observed evidence.
**AW-LIQ-088 — Detail ladder.** Ambient summaries, readable live stream, execution diagnostics, and profiler views SHOULD derive from the same verified event objects with different presentation density.

---

## 11. Performance Motion and adaptive rendering

Resource efficiency is a coequal design constraint. Charter 13 owns numerical platform budgets, benchmark thresholds, monitor support, power-policy sources and host scheduling. This section owns what adaptation is allowed to change visually.

### 11.1 Visual tiers (conceptual)

| Tier | Experience | Permissible reductions |
|---|---|---|
| **Cinematic** | Full intended Liquid Intelligence quality | No discretionary reductions |
| **Balanced** | Strong cinematic character, efficient effects | Reduced secondary postprocessing and ambient density |
| **Efficient** | Clear dimensional design, limited continuous atmosphere | Lower particle count/cadence, simplified materials |
| **Gaming** | Immediate access with minimal background cost | Strong suppression of background animation, low cadence |
| **Battery** | Durable usability, minimal energy use | Passive atmosphere and simplified compositing |
| **Reduced-motion/accessibility** | Full information and controls without dynamic motion burden | Static state cues, crossfade or instant transforms |

**AW-LIQ-089 — Preserved identity.** Quality changes MUST preserve the same visual language, information hierarchy, interaction semantics, resource identities and accessible content.
**AW-LIQ-090 — Adaptive budget participation.** The Motion Coordinator MUST accept quality/performance policy from charter 13 and proactively scale discretionary effects rather than allow unrestricted GPU or CPU load.
**AW-LIQ-091 — Frame priority.** Pointer, keyboard, editor caret, text, selection, focus, approval and primary active transition MUST be prioritized over particles, background shaders, glow and decorative simulations.
**AW-LIQ-092 — Background restraint.** Background, hidden, occluded, minimized and gaming contexts MUST reduce or suspend unnecessary continuous effects according to runtime capability and user preferences.
**AW-LIQ-093 — Smooth quality transitions.** Moving between quality tiers SHOULD avoid sudden visual pops, shader stalls, major identity changes or input lag; necessary hard fallback is permitted when stability requires it.
**AW-LIQ-094 — Hysteresis.** Automatically changing quality MUST avoid rapid oscillation between tiers under fluctuating system load; threshold selection belongs to 13's measured governor.
**AW-LIQ-095 — User control.** Users MUST be able to select supported quality/intensity profiles, understand automatic adjustments and override them within safety/resource limits.
**AW-LIQ-096 — Heavy data resilience.** Large conversation history, many stream events, rich charts and dozens of workspace blocks MUST NOT cause continuously mounted invisible effects or render all offscreen content unnecessarily.
**AW-LIQ-097 — Renderer fallback.** Unavailable shaders, GPU device loss, graphics restarts and low-capability devices MUST fall back to usable noncinematic but coherent visuals; important tasks/notes/chats remain accessible.
**AW-LIQ-098 — Real measurements.** Motion acceptance MUST use measured frame pacing, input responsiveness, resource costs, and qualitative experience. A nominal high FPS without consistent frame time is insufficient.

### 11.2 Design budget policy

Engineering MUST create realistic reference scenes (idle dashboard; dense workspace; multiple agents; chart/timeline; long streaming chat; dual-display; gaming background; battery mode), record CPU/GPU/memory/frame-time/input measurements, and compare candidate rendering stacks. Charter 13 owns the definitive targets and acceptable environments. Candidate targets such as 60 Hz stability or high-refresh interaction are exploratory until approved as explicit release gates.

---

## 12. Accessibility and perceptual safety

Reduced motion, legibility and user control must be designed into the cinematic system, not bolted on as a visually unrelated product.

**AW-LIQ-099 — Reduced-motion completeness.** All motion-sensitive interactions MUST have reduced-motion equivalents preserving state changes, scope, causal relationships and direct control.
**AW-LIQ-100 — No flash hazards.** Effects MUST avoid excessive flashing, repetitive high-contrast pulses, disorienting strobing and camera motion; accessibility evaluation MUST cover actual recorded sequences.
**AW-LIQ-101 — Contrast discipline.** Surface transparency, particle interference, bloom, blur and changing background luminance MUST never make critical text or controls unreadable at supported text scales.
**AW-LIQ-102 — Nonvisual information.** Every critical animated status and relation MUST be available in accessible text, focusable structure, or another supported nonvisual channel.
**AW-LIQ-103 — Spatial orientation.** Focus, selected resource and source/destination MUST remain discoverable through keyboard and assistive semantics across complex transitions.
**AW-LIQ-104 — Static equivalence.** Disabling graphics acceleration, particle effects, atmospheric scene or user-defined motion MUST NOT disable ordinary chat, file navigation, note capture, approval or command interaction.
**AW-LIQ-105 — Comfort customization.** Users SHOULD be able to configure effect intensity, transparency, scene motion, background activity, material clarity and ambient audio independently where supported.

---

## 13. Motion event contracts, lifecycle, and failure containment

A robust design system must remain stable under real asynchronous events, not just rehearsed demos. Source services own their events; the coordinator owns how supported state changes are visually expressed.

**AW-LIQ-106 — Typed motion intent.** Animation events SHOULD specify event/transition ID, affected view instances, canonical resource references, semantic source/target, priority, location, quality constraints, and accessibility alternative.
**AW-LIQ-107 — State is authoritative.** Domain changes MUST never depend on completion of a GPU animation or on a callback that may be skipped when the window is hidden.
**AW-LIQ-108 — Coalescing and ordering.** Bursts of events MUST be handled without duplicate resource births, runaway transition queues, permanently pending animations or contradictory final states.
**AW-LIQ-109 — Idempotent recovery.** Replaying or reconnecting equivalent events MUST settle the interface into correct latest semantic state without showing previously completed work as new live activity.
**AW-LIQ-110 — Input survives faults.** GPU reset, renderer restart, long operation, network disconnect, and motion cancellation MUST NOT silently delete note drafts, selected text, chat input, or uncommitted local edits.
**AW-LIQ-111 — Event-driven abstraction.** A displayed activity effect MUST be traceable back to an event or clearly labeled synthetic demo input in test/prototype environments.
**AW-LIQ-112 — Instrumentation.** Motion components SHOULD expose timing, dropped-frame markers, animation queue depth, transition causes, policy tier, interruptions, and source linkage suitable for diagnostic analysis without leaking secrets.
**AW-LIQ-113 — Security boundary.** Graphics assets, user themes, plugins, event payloads, and shaders MUST NOT bypass authorization or execute untrusted code beyond the approved trust model.
**AW-LIQ-114 — Layered scheduling.** Inactive effects and visual-only simulations SHOULD be suspendable independently from data/event capture, so reducing graphics load never stops approved monitoring or corrupts task records.

### 13.1 Minimum conceptual motion contract

Each transition SHOULD be representable as: transition ID; semantic event reference and provenance class; resource and visual-instance IDs; source/target geometry or visual phase; motion family; physical profile; priority; allowed effects; performance tier; reduced-motion replacement; completion/cancellation state; observed settle timing. This is an interface contract sketch, **not** a mandated JSON schema.

---

## 14. Research program and visual system specification

Before committing foundational rendering stack decisions, engineering MUST produce prototype comparisons coordinated with charters 13/15. Evaluated candidates MAY include Tauri/WebView2, Electron/Chromium, native shells, dedicated WebGL/WebGPU/Canvas layers, motion libraries, and GPU particle implementations. No option is presumed superior.

**AW-LIQ-115 — Representative prototype.** Early validation MUST include Vela presence, animated atmosphere, glass panels, a real draggable/resizable block, selection-to-command transition, home-to-chat shared-element flow, and at least one event-driven agent animation.
**AW-LIQ-116 — Actual host evaluation.** Prototype benchmarks MUST run in the packaged desktop environment (not only a browser development tab), including relevant monitor arrangements and expected background/gaming conditions.
**AW-LIQ-117 — Compare quality and cost.** Design reviews MUST consider cinematic fidelity, material clarity, motion continuity, text quality, developer complexity, GPU/CPU/energy cost, stability, accessibility and maintainability.
**AW-LIQ-118 — Design token governance.** Implementation MUST maintain versioned visual/motion tokens or equivalent reusable contracts for material, color hierarchy, depth, physics profiles, event effects, accessibility replacements, and quality tiers.
**AW-LIQ-119 — Consistent reference scenes.** Validation MUST use repeatable visual reference scenes and input scripts so revisions can be objectively and subjectively compared.
**AW-LIQ-120 — No placeholder ratification.** A static frosted-card screenshot, one canned 200 ms transition, or attractive particle video MUST NOT satisfy Liquid Intelligence acceptance.
**AW-LIQ-121 — Quality review.** Major visual milestones MUST include structured human assessment of delight, restraint, comprehensibility, coherence, motion comfort, and brand differentiation alongside technical evidence.
**AW-LIQ-122 — Baseline protection.** Accepted reference interactions SHOULD be captured in test assets and regression suites; deviations MUST be reviewed as intentional design changes rather than accidental stylistic drift.

### 14.1 Reference scenes for prototype evaluation

1. **Awakening:** cold start to authentic available/offline Vela state, graceful entrance, no blocking unnecessary ceremony.
2. **Home composition:** multiple live/mocked-labeled blocks, glass on varied backgrounds, high-contrast readable labels.
3. **Chat transformation:** tile becomes full conversation and returns, preserving content and selection.
4. **Spatial drag:** lift, neighbor reflow, snap, interrupted/reversed movement, persistent underlying object.
5. **Contextual command:** selected text/image/file anchors a responsive command field; target scope expansion visualized.
6. **Orchestration:** Vela delegates to agents, nodes connect, live events arrive and status changes remain truthful.
7. **Timeline:** requested timeline appears, task links and uncertainty render coherently, zoom/pan works.
8. **Dense data:** lengthy chat, rapid log streaming, interactive chart, critical approval with ambience suppressed.
9. **Multi-display:** detach and return block, cross-window focus, offscreen recovery, mixed scaling.
10. **Performance adaptation:** gaming/background/battery/reduced-motion and graphics-failure fallbacks without loss of essential capability.

---

## 15. Acceptance tests and evidence

These scenarios MUST be included when their feature is in a milestone's claimed scope. Criteria require functional, perceptual, accessibility and performance evidence, not merely compilable demo code.

| ID | Scenario | Required evidence and result |
|---|---|---|
| **LIQ-A01** | Awakening and idle Vela | Strong distinctive identity; calm but not dead, readable state, no fictitious thinking |
| **LIQ-A02** | Chat tile → full chat → back | Shared identity, coherent transformation, preserved resource/scroll/selection |
| **LIQ-A03** | Block drag/reflow | Direct pointer response, nearby yielding, stable settle, no data mutation |
| **LIQ-A04** | Interrupt and reverse animation mid-flight | No snapping to arbitrary start, lost focus, duplicate resources or stuck overlays |
| **LIQ-A05** | Contextual Command on text | Correct anchor, safe positioning, input focus and readable selection |
| **LIQ-A06** | "All files in this folder" scope expansion | Visual set matches actual preview; no fabricated selection success |
| **LIQ-A07** | Agent starts and delegates | Activity animations attributable to actual event IDs and correct agent nodes |
| **LIQ-A08** | Tool fails or awaits approval | Truthful status, accessible explanation, no false completed pulse |
| **LIQ-A09** | Agent stream disconnects | Clearly disconnected/unknown state and gap indicator |
| **LIQ-A10** | Glass with complex background | Text and focus remain readable at supported scale and contrast |
| **LIQ-A11** | Dense particles and multiple panels | No input starvation; benchmarked frame pacing and GPU/CPU impact |
| **LIQ-A12** | Reduced motion | Every essential action/state still understandable and operable |
| **LIQ-A13** | Gaming/background auto tier | Measurable effect throttling and controlled return without layout changes |
| **LIQ-A14** | Second monitor disconnect/reconnect | Canonical identity persists, safe transition/fallback and correct focus |
| **LIQ-A15** | Timeline forecasts versus records | Visual difference is unambiguous; no invented certainty |
| **LIQ-A16** | Event replay | Recorded source status and interpolated/simulated intervals clearly identified |
| **LIQ-A17** | Graphics reset or renderer restart | Relevant content preserved; coherent fallback rather than broken blank screen |
| **LIQ-A18** | Screen reader and keyboard | Critical controls, statuses, events, selection and command remain accessible |
| **LIQ-A19** | Long chat with rapid streaming | Smooth viewport, no forced scroll jump, stable selection and responsive input |
| **LIQ-A20** | Whole-system design review | Film-cinematic polish AND restraint proven with recordings, inspection, user review and real measurements |

### 15.1 Verification artifacts

Applicable milestone evidence SHOULD include: deterministic state/transition tests; rendering captures and side-by-side reference recordings; real input recordings; GPU/CPU/memory/frame-pacing traces; accessibility audits; representative mixed-DPI/multiwindow tests; event-to-animation attribution logs; failure simulations; measured background/gaming adaptations; known limitations; reviewer findings; and versioned decisions for shader/material/physics choices. Evidence must follow 14's sensitive-data boundaries and 15's verification taxonomy.

**Explicit nonacceptance examples:** pretty static screenshot with no working behavior; unmeasured high-overhead shaders; spinner claiming hidden thoughts; two separately mounted copies of a chat masquerading as one continuous block; a frame-rate counter without frame-time data; reduced-motion toggle that removes essential status cues; an unresponsive app with beautiful idle particles.

---

## 16. Dependencies, unresolved questions, and governance change

**Dependencies:** 01 owns commands and clarity; 03 owns objects/layouts; 06 owns Vela's true assistant state; 09 owns the recorded event model; 10 owns token/profiler data; 11 owns historical and planned time semantics; 13 owns platform and resource budgets; 14 owns what may be surfaced/acted upon; 15 owns verification and release acceptance. This charter MUST NOT duplicate or overturn those canonical requirements.

**Open design decisions:** final shell/framework; GPU stack and renderer; shader pipeline, atmospheric materials, particle physics and density; glass optical model; precise motion constants and spring profiles; exact color, typography and material tokens; cross-window interpolation implementation; ambient audio policy; baseline and acceptable performance targets; the shape of Vela's final visual embodiment. These require prototype evidence, deliberate review, and recorded architectural/design decisions.

**Amendments:** Changes to the six motion disciplines, semantic honesty, priority rules, or the requirement for first-class cinematic visual acceptance MUST be evaluated for constitutional impact and approved through explicit governance change. Fine-grained visual parameters MAY evolve in subordinate design specifications, provided charter obligations remain intact.

---

## 17. Owner-directed 2026-11-04 addendum: Vela's living Intelligence Nebula and continuous spatial travel

> **Status and authority:** Detailed normative proposal in this *existing governing charter*, submitted following the repository owner's explicit design direction on 2026-11-04. The charter's published-draft/acceptance status does not silently change. This section is not a standalone speculative mockup and is not proof that the visual work has been implemented. It is to be reviewed under the same charter-acceptance process as the rest of 02.
>
> **Non-negotiable product direction:** **One continuous spatial universe. No disconnected screen changes.** The global Vela Presence must be a real, internally luminous, evolving GPU-rendered 3D nebular environment, not a flat image, spinning orb, radial menu, simple flowchart, or cloud of cards.

This section provides specialized visual/motion requirements for the cross-view intelligence experience. Charter 01 owns navigation interaction semantics, 06 owns Vela's role and observable state, 09 owns source truth and project execution topology, 13 owns measured budgets, and 15 owns final quality gates. This charter alone owns how the above must look, move and remain spatially coherent.

### 17.1 Visual identity and reference fidelity

**AW-LIQ-200 — True volumetric identity.** Vela's full-screen Presence MUST be rendered through a real three-dimensional GPU-accelerated scene with depth-resolved, view-consistent volume, deformable surfaces, internal layers and/or spatial filaments. Flat textures, planar shaders, sprites with parallax, a 2D video, CSS filters, a billboard and particles, or a basic sphere with a noisy displacement texture MUST NOT be accepted as the defining implementation. A non-GPU accessible fallback is necessary but MUST be explicitly identified as a fallback.

**AW-LIQ-201 — Reference fidelity.** The approved visual baseline MUST be compared side-by-side with the exact user-provided nebula image from the 2026-11-04 review. The scene MUST evoke its irregular asymmetrical gossamer-silk body, translucent overlapping veil folds, blue/cyan/violet/pearl layers, delicate hairlike currents, spatial sparkling interior and contrasting black negative space. Merely borrowing its colors or using it as a flat texture is insufficient.

**AW-LIQ-202 — Real spatial parallax.** Moving the camera across at least two axes MUST reveal distinct occlusion, internal structure, surface relationships and depth, including at tendril junctions. Static camera-limited tricks MUST NOT count as 3D validation.

**AW-LIQ-203 — Light flows within form.** The nebula MUST exhibit animated luminosity and particles *inside* layered three-dimensional structures, including depth-aware emission, scattering/absorption approximations or comparable physically coherent rendering. A single glow rim or edge-only beam cannot substitute for internal light.

**AW-LIQ-204 — Evolving, nonmechanical motion.** The core MUST maintain recognizable identity while continuously evolving through large-scale veils, intermediate swirling/turning folds and microscopic light advection. A short repetitive 'breathing orb' cycle, random uncorrelated jitter or hard silhouette replacement is prohibited as the dominant motion.

**AW-LIQ-205 — Specialized external nebulas.** The global Presence MUST include substantial neighboring 3D domain nebulas for Planning, Execution, Writing/Creation, Communication/Streaming, Memory/Context and Analysis/Observation (or an explicitly owner-approved equivalent taxonomy). Each MUST be recognizable, coherent with the central material language, and more substantial than a label or tiny orb. Exact arrangement may evolve through reviewed design.

**AW-LIQ-206 — Spatial landmark stability.** Outer domain nebulas MUST retain approximate, learnable spatial positions. Their local turbulence and drifting motion MAY change continuously, but significant repositioning MUST communicate intentional spatial change and avoid user disorientation.

### 17.2 The defining connected-tendril behavior

**AW-LIQ-207 — Extension begins in the core.** Domain activation MUST make a portion of the central nebula visibly deform, stretch and generate a three-dimensional continuous material extension toward the target domain. A detached line or Bézier connector suddenly appearing between two preexisting clouds is not compliant.

**AW-LIQ-208 — Connected luminous substance.** A tendril MUST visibly contain nested scales of cloud density, translucent silk-like veils, fine filaments and light currents. Its origin, body and destination MUST remain visually connected throughout extension, flow and retraction, including under camera movement.

**AW-LIQ-209 — Multi-domain concurrency.** Simultaneously active domains MUST create multiple independently timed extensions with a coherent shared source, stable destinations, and bounded overlap. At least three concurrent tendrils MUST be shown and evaluated in the feature's reference implementation.

**AW-LIQ-210 — Smooth dynamic response.** Emergence, growth, deformation, flow-speed change, branching and retraction MUST preserve perceptual continuity. Use coordinated acceleration/jerk limits, damping and phase coherence rather than teleportation, sudden rescaling or immediate velocity jumps. Exact motion constants remain research decisions.

**AW-LIQ-211 — Source-driven intensity.** Changes in luminosity, domain activation, action-mote appearances and salient particle transport MUST respond to observed or clearly labeled reported runtime activity. Ambient motion MAY persist during idle but MUST NOT impersonate execution or secretly imply model cognition.

**AW-LIQ-212 — Failure/wait semantics.** Unknown, failed, blocked, waiting and cancelled states MUST have distinct calm but understandable motion signatures. A waiting action MUST NOT visually complete; a failed action MUST NOT receive a success-like convergence burst.

**AW-LIQ-213 — Domain distinction without false psychology.** Differentiated domain motion SHOULD communicate categories of *observable work*, never certainty about hidden thoughts, feelings, attention percentages or inaccessible internal model dynamics.

### 17.3 Living satellites, camera, and layered presentation

**AW-LIQ-214 — Action motes are spatial manifestations.** Small active actions MUST emerge and dissipate in a coordinated three-dimensional field near the relevant domain or tendril. Ordinary card rings, evenly spaced icons and decorative unbound particles MUST NOT be substituted for the intended live satellite experience.

**AW-LIQ-215 — Collision-aware reflow.** Appearance, completion and grouping of action motes MUST cause gentle rearrangement with stable anchors, bounded displacement and overlap avoidance. Meaningful historical activity MUST remain inspectable through retained trace/Wake even after its mote has dissolved.

**AW-LIQ-216 — User camera authority.** User-initiated pan, orbit, zoom, node selection, focused reading, approval, reduced-motion and emergency escape MUST override automatic cinematography without oscillation or forced recentering.

**AW-LIQ-217 — Semantic scene continuity.** Vela Presence, project Intelligence Streams, Constellation and Workspaces MUST be coordinated projections of one spatial identity system. Major transitions SHOULD express an intelligible path and preserve the identity of selected project and operation. A mere opacity crossfade or hard screen replacement MUST NOT be accepted as the defining transition where the intended spatial relationship is available.

**AW-LIQ-218 — Presence-to-Stream journey.** Selecting a project-linked mote MUST support a cinematic trajectory through its luminous domain/tendril into the project's actual branched execution scene, with recognizable source-to-destination mapping. The reverse journey MUST preserve camera and resource identity.

**AW-LIQ-219 — Stream-to-Stream journey.** Switching directly between two project Streams MUST preserve the impression of traveling through one spatial environment; the first graph recedes and the second emerges, with the underlying task execution uninterrupted.

**AW-LIQ-220 — Renderer boundary independence.** Distinct view renderers MAY exchange synchronized scene anchors, camera poses, motion tokens and partial visual geometry rather than share a monolithic GPU context. The chosen architecture MUST still realize perceptual continuity, correct focus and interruption-safe transitions.

**AW-LIQ-221 — No cinematic tax on work.** Visual transitions MUST be interruptible or skippable and MUST NOT delay approval, essential input, urgent results or continuing background execution. Reduced motion must provide equivalent navigation and state information.

### 17.4 Artistic gate and implementation ordering

**AW-LIQ-222 — Art-first proof.** Before the feature can be reported as an integrated implementation candidate, engineering MUST produce a genuine GPU-native 3D prototype demonstrating core material fidelity, internal light flow and a connected tendril under moving-camera inspection. A 2D placeholder is permitted only as clearly labeled disposable exploration, never as completed Presence.

**AW-LIQ-223 — Comparative artistic review.** The owner MUST be offered the reference image and moving-camera captures side-by-side, covering silhouette, multiple transparent spatial layers, edge behavior, spectral detail, depth, internal sparks, organic extension and overall extraordinary aesthetic. Automated screenshot similarity or a shader demo alone is insufficient.

**AW-LIQ-224 — One Motion Coordinator.** Spatial travel, material deformation, atmospheric flow, semantic event activation, input focus and adaptive rendering MUST use or explicitly integrate with Aerynth's shared six-system Motion Coordinator. Independent unrelated animation loops for each domain are prohibited where they would cause conflicting transition states.

**AW-LIQ-225 — Honest resource reduction.** Reduced quality and minimized/background conditions MAY lower sample counts, particle density, resolution and simulation frequency but MUST preserve semantic cues, user controls, and source-backed activity. See Charter 13 for benchmarks and Charter 15 for acceptance.

### 17.5 Required scenarios and traceability

The companion [Presence art direction](../docs/design/VELA-PRESENCE-INTELLIGENCE-NEBULA-ART-DIRECTION.md) and [GPU technical contract](../docs/architecture/VELA-PRESENCE-GPU-RENDERING-CONTRACT.md) describe candidate techniques and exact review scenes. They are subordinate to this charter and must not turn an owner artistic rejection into an automatic pass. Test at minimum: idle multi-axis camera orbit; connected extension and reabsorption; three simultaneous domains; one real observed file/tool action; failed/unknown event; a full Presence → project Stream → Presence journey; and reduced-motion/graphics loss. Record what was genuinely rendered and measured, including identified missing evidence.

**Explicit nonacceptance:** a static beautiful image, shader-only color demo, attractive still, flat projected cloud, disconnected graph, floating card cluster, unverified particle stream, or unsourced 'thinking' animation cannot satisfy AW-LIQ-200–225.

---

## Publication and intended outcome

This charter is a comprehensive **published proposal**, not a claim of implementation, successful benchmark results, selected final stack, or owner ratification. Its purpose is to protect the visual vision while making it testable.

**The acceptance question is not "Did we animate the interface?" It is "Does Aerynth feel like one coherent, cinematic, intelligent environment, remain understandable and responsive, and accurately express the state of real work?"**

**Liquid Intelligence is not a decoration. It is how Aerynth makes intelligence perceptible.**
