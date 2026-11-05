# 13 — Platform, Performance, and Displays
## Desktop Platform, Cinematic Rendering, Adaptive Resource Governance, and Multi-Display Charter for Aerynth

| Field | Value |
|---|---|
| Document ID | AW-GOV-013 |
| Version | 1.0.0-draft |
| Status | **Published proposed governing charter — awaiting repository-owner acceptance** |
| Prepared | 2026-11-01 |
| Authority | Specialized subsystem charter subordinate to [00 — Aetherwake Constitution](00-AETHERWAKE-CONSTITUTION.md) |
| Primary domain | Desktop platform selection, graphics architecture viability, responsiveness, resource budgets, adaptive quality, display topology, detached windows, restoration, startup, performance evidence, and compatibility |
| Normative requirement namespace | **AW-PLT-###** |
| Constitutional anchors | AW-CON-002–005, 011–021, 027–030, 035, 036, 051–061, 069–078, 080–089 |
| Coordinating charters | 01 Experience; 02 Liquid Intelligence; [03 Projects and Workspaces](03-PROJECTS-WORKSPACES-AND-RESOURCES.md); [06 Vela](06-VELA-INTELLIGENCE-AND-ADAPTATION.md); [09 Observability](09-INTELLIGENCE-STREAMS-AND-OBSERVABILITY.md); [10 Execution Profiler](10-AI-EXECUTION-PROFILER.md); 11 Timelines; 12 Codex; 14 Trust; 15 Quality; 16 Engineering |
| Intended readers | Rendering and platform engineers, desktop architects, Motion Coordinator implementers, workspace designers, QA, accessibility engineers, release maintainers, and autonomous development agents |
| Disclosure boundary | Public technical governance only; no private hardware identifiers, personal layouts, application telemetry, credentials, or machine-specific operational information |

> **Core platform promise.** Aerynth MUST deliver a cinematic, clear, fluid, native-quality environment without becoming an unreasonable consumer of CPU, GPU, memory, energy, or user attention. Its spectacular visual identity and its resource discipline are **simultaneous acceptance requirements**. A high frame rate is not an acceptable excuse for heavy idle load; low resource usage is not an acceptable excuse for a static, generic-looking interface.
>
> **Constitutional principle.** The user expresses intent; Aerynth handles the complexity. The platform MUST support the full Liquid Intelligence vision, and the visual system MUST gracefully adapt to the user's real working and gaming conditions.
>
> **Technology-neutral governance.** Tauri/WebView2, Electron/Chromium, native shells, WebGL2, WebGPU, Canvas, and other candidates are **research subjects**, not preselected winners. Final architecture follows comparative, reproducible on-device evidence.

---

## 1. Authority, scope, and definitions

This charter owns Aerynth's **platform capability and performance contracts**, not the aesthetic vocabulary itself. Charter 02 owns the meanings, choreography, materials, and six-system Motion Coordinator semantics; this charter governs whether those experiences can execute correctly, responsively, and efficiently on supported devices and displays.

**In scope:** desktop shell evaluation and lifecycle; host-to-renderer architecture; graphics API capabilities and fallback; GPU/CPU/memory/energy management; scheduling and frame pacing; adaptive quality; background/minimized/gaming behavior; high-DPI and mixed-refresh display handling; multi-window and detachable blocks; display-role restoration; startup and sleep/resume; crash safety; long-conversation and event-stream presentation performance; performance telemetry; evaluation matrices; acceptance gates.

**Out of scope, except for integration contracts:** product aesthetics and motion authoring (02); canonical object identity, block ownership, snapshots, and layouts (03); Vela's initiative or notification meanings (06); event provenance and reasoning stream semantics (09); model token accounting and execution-time terminology (10); Codex backend execution details (12); privacy/authorization/retention policy (14); global verification and release authority (15/16).

Definitions:

| Term | Meaning |
|---|---|
| **Desktop shell** | Native application lifecycle, windows, OS integration, notifications, secure process boundaries, and embedded renderer hosting |
| **Rendering surface** | A composited window or region where UI, Canvas, WebGL, WebGPU, or other graphics are presented |
| **Motion Coordinator** | Cross-component system for Spatial, Material, Atmospheric, Semantic, Interaction, and Performance Motion |
| **Scene state** | Durable, semantic description of objects and activity, distinct from GPU frame data |
| **Display topology** | Current arrangement, geometry, usable areas, scale factors, orientation, refresh rate, and available stable display descriptors |
| **Display role** | User-controlled semantic purpose such as Primary Development, Monitoring, Communications, or Presentation |
| **Layout variant** | Saved representation of a workspace arrangement for a class of display topologies |
| **Quality tier** | Reversible set of rendering-cost adjustments, not an alternate product identity |
| **Performance governor** | Policy engine that evaluates observed resource pressure, user priorities, and safety constraints before changing quality or workload |
| **Degraded mode** | Explicit fallback retaining essential navigation, text, controls, and truthful state when preferred graphics/platform capabilities fail |
| **Reference workload** | Repeatable scenario with declared data volume, animation intensity, display topology, and hardware conditions |
| **Observed** | Directly measured and attributable; **derived** is calculated from observed inputs; **estimated** is modelled or sampled; **unknown** remains unknown |

Normative usage follows the Constitution: **MUST** and **MUST NOT** are binding, **SHOULD** is a strong default requiring an explicit exception, and **MAY** is optional. This draft establishes design obligations; numerical thresholds labelled *candidate* require benchmark review before becoming release gates.

**AW-PLT-001 — Constitutional conformance.** All platform decisions MUST preserve the Constitution and applicable subsystem charters; a platform convenience MUST NOT silently override Liquid Intelligence or user freedom.

**AW-PLT-002 — Canonical ownership.** This charter owns platform, display, frame pacing, and rendering resource guarantees; it MUST reference rather than redefine canonical resource identity (03), motion semantics (02), provider token metrics (10), or user authorization (14).

**AW-PLT-003 — Evidenced capability.** A capability MUST NOT be called supported solely because an underlying framework advertises an API. Aerynth MUST demonstrate its behavior in the actual packaged host and supported OS/runtime versions.

**AW-PLT-004 — No misleading simulation.** Production loading, GPU-status, rendering-health, monitor-detection, background-monitoring, and agent-progress indicators MUST reflect real state or be explicitly qualified.

**AW-PLT-005 — Progressive delivery.** Platform support MAY expand by release, but each release MUST state supported hosts, OS versions, hardware assumptions, graphics fallbacks, and known limitations truthfully.

---

## 2. Platform strategy and support tiers

The initial design and prototyping target is a modern **Windows desktop environment** with a capable GPU and multiple monitors. This is a development focus, **not** a permanent decision to prohibit macOS or Linux. Aerynth's core objects, orchestration, context layer, knowledge, and event model MUST remain portable behind explicit platform adapters.

**AW-PLT-006 — Support declaration.** Every distributed build MUST declare its tested OS/runtime support matrix, minimum supported capabilities, recommended configuration, and unsupported features. Development-machine success MUST NOT imply broad compatibility.

**AW-PLT-007 — Layered portability.** Durable project data, workspace documents, layouts, chat references, tasks, notes, and agent event records MUST NOT depend on one desktop shell's proprietary serialized objects.

**AW-PLT-008 — Explicit host interfaces.** Native window control, display enumeration, power signals, GPU capabilities, filesystem access, notifications, media integration, and process management MUST be exposed through versioned host adapters with clear error semantics.

**AW-PLT-009 — Offline usefulness.** Basic navigation, notes, cached project knowledge, saved layouts, and inspectable historical records SHOULD remain useful when model/network services are unavailable, subject to authorized local-data access.

**AW-PLT-010 — OS capability discovery.** GPU APIs, window effects, display descriptors, power information, and input capabilities MUST be runtime-discovered and never assumed from an OS name alone.

**AW-PLT-011 — No silent platform downgrade.** An unavailable feature MUST have an honest state and appropriate fallback; the UI MUST NOT visually imply successful GPU, desktop, or display operations that did not occur.

**AW-PLT-012 — Installer and runtime integrity.** Packaging MUST test runtime dependencies, update behavior, signed/distributed binaries where applicable, crash reporting policy, rollback, and data preservation. Runtime download requirements MUST be made known to the user.

### 2.1 Platform research candidates

| Candidate | Evaluation value | Risks to evaluate, not assumed outcomes |
|---|---|---|
| **Tauri 2 + platform webview** | Native host integration, potentially lighter process model, OS-specific webview capabilities | WebView2 availability/version on Windows, cross-platform engine differences, transparency and compositor behavior, native bindings, detached windows |
| **Electron + Chromium** | Controlled renderer ecosystem, extensive desktop APIs, mature browser tooling | Process/memory footprint, background throttling, update/packaging size, compositor edge cases |
| **Native or hybrid shell** | Potential direct OS display/window and graphics control | Development complexity, cross-platform maintenance, UI toolkit expressiveness, plugin integration |
| **WebGL2 / Canvas2D / SVG** | Widely usable rendering layers and graceful fallback paths | CPU/GPU tradeoffs, shader effects, composition and large-scene scalability |
| **WebGPU** | Advanced GPU compute/graphics potential for particles and effects | Runtime/driver availability, feature detection, adapter/device failure, fallback quality, packaging compatibility |

**AW-PLT-013 — Research gate.** No irreversible shell, renderer, compositing, graphics API, or multi-window architecture selection MAY be treated as final before representative prototypes are benchmarked and an Architecture Decision Record (ADR) is approved.

**AW-PLT-014 — Like-for-like comparison.** Candidates MUST be tested with comparable scenes, data volumes, window counts, quality tiers, display configurations, and diagnostic instrumentation. A minimalist candidate MUST NOT be compared against a fully animated candidate as if the result proves efficiency.

**AW-PLT-015 — Host diversity.** The comparison MUST cover runtime support, driver behavior, composition/blur/transparent-window reliability, UI text quality, accessibility, input, multi-display scaling, crash isolation, process/memory cost, install/update footprint, debugging, and maintainability.

**AW-PLT-016 — Fallback-proof architecture.** Graphics and shell abstractions MUST support alternate render backends or clearly scoped fallback paths without rewriting project, chat, agent, or workspace semantics.

### 2.2 Required comparative prototypes

Before approval, the prototype matrix MUST include:
1. Liquid Intelligence ambient scene with particles, filaments, glass, lighting, and Vela presence.
2. Drag/resize/reflow of at least twelve heterogeneous blocks with shared-element continuity.
3. Long streaming chat with selectable text and virtualization.
4. Dense Intelligence Stream and profiler chart with bursty updates.
5. Two independent native windows, detachable block, mixed scaling, and monitor hot-plug.
6. Foreground cinematic, idle, background, minimized, gaming-pressure, and battery-style power scenarios.
7. Graphics feature failure (missing WebGPU, GPU-device loss or disabled acceleration), recovery, and accessible reduced-motion view.

The prototype MUST expose instrumentation and use the same reference scenarios across contenders. A research result is not a production implementation.

---

## 3. Rendering and composition architecture

The rendering architecture SHOULD distinguish **application state**, **scene/motion state**, and **GPU frame state**. React or another UI framework MAY own components, but high-rate particle motion and graph animation MUST NOT require large application-tree rerenders on every frame.

**AW-PLT-017 — Separated render pipeline.** High-frequency visuals MUST be isolated from data persistence, agent execution, chat state, and native window management by well-defined interfaces.

**AW-PLT-018 — Motion integration.** The platform MUST expose time, visibility, reduced-motion, display refresh, resource-pressure, quality-tier, and synchronization inputs required by all six Motion Coordinator domains.

**AW-PLT-019 — Graphics lifecycle.** Rendering subsystems MUST handle initialization, resize, DPI changes, pause/resume, context/device loss, resource disposal, and recovery without destroying canonical resource state.

**AW-PLT-020 — Controlled particle complexity.** Animated particles, filaments, and graph visualizations SHOULD use GPU-efficient approaches such as instancing, batched geometry, or appropriate compute techniques where supported; unbounded DOM elements per particle are prohibited in production scenes.

**AW-PLT-021 — Compositor-aware materials.** Glass, blur, transparency, refraction approximations, shadows, HDR behavior, and cross-window layers MUST be tested in the packaged host, including overlays, text contrast, and native window shadows.

**AW-PLT-022 — Capability fallback.** WebGPU-specific effects, if adopted, MUST have a tested reduced or alternate implementation when the API/device is unavailable. UI and essential commands MUST remain functional without advanced graphics.

**AW-PLT-023 — Text clarity priority.** Translucency and blur MUST yield to legibility, selection accuracy, caret visibility, and adequate contrast. Expensive visual treatment MUST NOT obscure code, diagnostics, or approval wording.

**AW-PLT-024 — Quality equivalence.** Lower tiers MAY reduce particles, sample counts, blur resolution, postprocessing, motion density, or animation frequency; they MUST NOT remove the underlying ability to navigate, inspect, interact, approve, or understand agent state.

**AW-PLT-025 — Semantic truth.** Resource/status animations MUST consume true application/event state or labelled simulation; reducing visual fidelity MUST never change the actual status of agents, tasks, or data.

**AW-PLT-026 — Scalable collections.** Large block grids, relationship graphs, timeline markers, chat histories, file trees, and telemetry series MUST use virtualization, culling, aggregation, and progressive detail as appropriate to avoid cost proportional to all historical objects on every frame.

**AW-PLT-027 — Animation reconciliation.** Bursts of state changes MUST coalesce rendering work while preserving logical events, ordering, and accessible textual state; the renderer MUST NOT create one permanent visual object for every raw event.

**AW-PLT-028 — Consistent timing sources.** Motion across surfaces SHOULD use monotonic timestamps and explicit synchronization/reference clocks; local presentation clocks MUST NOT rewrite recorded event times.

**AW-PLT-029 — No hidden full-rate loops.** Hidden/minimized surfaces MUST NOT continue full-rate requestAnimationFrame/scene simulation without a justified, measured necessity. Background services MUST be decoupled from the graphical render loop.

**AW-PLT-030 — Visual fallback without identity loss.** Loss of GPU support, disabling transparency, or entering reduced-motion mode MUST NOT create duplicate chats, reset blocks, or alter saved layouts.

### 3.1 Rendering quality tiers

The initial tier model is **Cinematic**, **Balanced**, **Efficient**, **Gaming**, **Battery**, and **Automatic**. It is a product concept, not a claim about presently implemented modes. Quality profiles must be user-adjustable.

| Tier | Preferred behavior |
|---|---|
| Cinematic | Maximum approved effects and scene quality within configured resource ceiling |
| Balanced | High visual fidelity with adaptive sampling, particle density, and compositing |
| Efficient | Prioritize responsiveness; limit heavy atmospheric and postprocessing layers |
| Gaming | Minimize Aerynth's foreground-independent GPU work; keep controls and alert semantics |
| Battery | Strong frame scheduling, animation, polling, and energy discipline |
| Automatic | Choose and transition between applicable quality profiles based on measured conditions and user policy |

**AW-PLT-031 — Tier independence.** Rendering quality tiers MUST be independent of Codex model/reasoning settings and backend agent permissions. Graphics throttling MUST NOT silently interrupt a coding task.

**AW-PLT-032 — User override.** Users MUST be able to fix a tier, choose Automatic, adjust allowed effects, and disable optional ambient rendering without losing functional interfaces.

**AW-PLT-033 — Safe gradual transitions.** Automatic tier changes SHOULD avoid rapid oscillation, asset thrashing, flashing, or abrupt attention-stealing reconfiguration.

**AW-PLT-034 — Quality transparency.** The active tier, reason for automatic adjustment, optional per-display differences, and any important disabled capability MUST be inspectable without being intrusive.

---

## 4. Performance model, measurement, and candidate budgets

**Performance means sustained responsiveness under realistic concurrent loads**, not one screenshot or an instantaneous FPS value. Measurements MUST separate app UI rendering from Codex subprocesses, terminals, browsers, local models, indexing, and other services, so the user can distinguish sources of resource consumption.

**AW-PLT-035 — Metric schema.** Platform metrics MUST declare unit, attribution scope, source, sampling interval, timestamp, and observed/derived/estimated/unavailable provenance.

**AW-PLT-036 — Frame-time evidence.** Performance verification MUST report median, p95, and p99 frame intervals; dropped/missed presentation opportunities; frame pacing/jitter; and refresh target per rendering surface.

**AW-PLT-037 — Interaction responsiveness.** Important user paths MUST measure input-to-feedback and input-to-useful-completion, including drag start, selection, command opening, window docking, chat typing, and context menus.

**AW-PLT-038 — End-to-end versus per-layer latency.** UI latency, disk/index activity, network delay, model processing, tool execution, and stream rendering MUST remain analytically distinguishable; graphics delays MUST NOT be misrepresented as model thinking time.

**AW-PLT-039 — Resource attribution.** CPU, private/resident memory, GPU utilization or engine time where supported, GPU memory, GPU frame cost, I/O, wakeups, and power proxies SHOULD be reported by process/component where instrumentation permits, with known coverage gaps stated.

**AW-PLT-040 — Workload traceability.** All performance results used for acceptance MUST record build/revision, OS/runtime version, display arrangement, driver/API configuration, graphics tier, fixture data size, background load, power source, and test duration.

**AW-PLT-041 — Regression baselines.** Representative performance benchmarks MUST run on release candidates and compare to an approved baseline, including distributional frame pacing and idle/background cost rather than FPS alone.

**AW-PLT-042 — No fabricated precision.** Unsupported GPU counters, inferred power draw, screen-specific effective frame rates, and partially attributed metrics MUST remain qualified or unavailable.

**AW-PLT-043 — Independent backend continuity.** Rendering slowdown MUST NOT discard Codex events or data, and a rendering-speed recovery MUST NOT falsely imply that backend work resumed or completed.

### 4.1 Candidate engineering targets, not ratified release gates

These are **initial measurement hypotheses** to guide prototype design. They MUST be reviewed and either ratified, revised, or rejected after benchmarks across appropriate reference configurations. They MUST NOT be presented as achieved performance.

| Dimension | Candidate target / measurement intention | Notes |
|---|---|---|
| Baseline foreground interaction | Consistent 60 Hz target when display and workload allow | 16.67 ms nominal refresh interval; record p50/p95/p99 frame pacing |
| High-refresh interaction | Aspire to 120 Hz on capable primary displays | 8.33 ms nominal interval; not a universal requirement on slower devices |
| Typical ordinary interaction | Visible response within one display refresh where feasible; measurable p95 input latency | Native OS scheduling and complex work may exceed a single refresh |
| Foreground visual scene | Stable high quality without sustained saturation | Thresholds must be correlated with CPU/GPU and battery costs |
| Background and minimized | Prefer paused/noncontinuous visual simulation | Critical alerts/event ingestion continue through nonvisual services |
| Gaming quality | Incremental graphical workload becomes minimal under detected load | Measure incremental GPU/frame impact on the actual foreground game |
| Startup | Show functional navigation promptly, progressively hydrate large content | Define cold/warm/perception phases from measured data |
| Long conversation | Scrolling and typing remain responsive with large fixtures | Use windowed rendering and incremental indexing |
| Multi-display changes | Recover visible usable windows and saved state without data loss | Measured restoration latency and failure outcomes required |

Suggested early **illustrative** investigative budgets: p95 frame time close to 16.67 ms in a controlled 60 Hz reference scene and close to 8.33 ms in an optimized 120 Hz scene; no sustained animation loop in minimized windows; no unexplained idle CPU/GPU spikes; bounded memory across repeated workspace changes. Numerical service-level objectives for launch must be set by ADR and approved benchmarks, not guessed from this table.

**AW-PLT-044 — No target laundering.** Candidate numbers MUST NOT become release promises through repetition; the test plan MUST state which thresholds are ratified, for which hardware tiers, and under what loading conditions.

**AW-PLT-045 — Prefer worst-case visibility.** Major freezes, p99 regressions, shader compilation stalls, long main-thread tasks, and GPU-device resets MUST be reported rather than concealed behind median FPS averages.

---

## 5. Adaptive performance governor

The **Performance Governor** observes platform load and determines **visual-quality changes** separately from **agent workload scheduling**. It SHOULD use explicit policy priorities, hysteresis, minimum stable dwell times, and a manual override. Detection is bounded by OS permissions and available sensors.

**AW-PLT-046 — Policy inputs.** Automatic quality MAY consider visible/hidden/minimized state, focus, display refresh, GPU/CPU pressure, UI frame misses, power source, battery saver, thermal indications, foreground fullscreen applications, and explicit user-defined modes; missing signals MUST be treated as unavailable.

**AW-PLT-047 — Resource-first response.** When resource pressure rises, Aerynth SHOULD first reduce optional atmospheric/postprocessing costs, then lower nonessential animation/polling frequency, while preserving essential text, interaction, and safety-critical notifications.

**AW-PLT-048 — Gaming respect.** A user-defined or responsibly detected gaming context SHOULD activate low-interference behavior: less GPU work, reduced background rendering, discreet notifications, and no focus stealing. Detection MUST be optional/controllable and must not require invasive software inspection.

**AW-PLT-049 — No unrequested compute cancellation.** Entering Gaming/Battery/Efficient quality MUST NOT automatically cancel, pause, or change remote/local Codex tasks unless a distinct user-approved task-resource policy authorizes that behavior.

**AW-PLT-050 — Independent task policy.** Agent process CPU/memory/IO budgets MAY be managed separately from visual tiers, with explicit priorities, user controls, and refusal to misrepresent partial progress as completed work.

**AW-PLT-051 — Hysteresis and anti-thrash.** Automatic transitions MUST use measured stabilization/anti-oscillation behavior and avoid frequent quality switching, repeated shader compilation, or repeated resource allocation.

**AW-PLT-052 — Per-surface adaptation.** A high-refresh foreground workspace and a static secondary-monitor status panel MAY run at different presentation/update rates without inconsistent canonical state.

**AW-PLT-053 — Unavailable-monitor fallback.** If GPU utilization, process energy impact, or foreground app classification is unavailable, Automatic MUST use measurable local frame pressure and visibility signals rather than inventing sensor values.

**AW-PLT-054 — Foreground-app safety.** Performance management MUST NOT interfere with other applications through unauthorized priority manipulation, process termination, driver settings, overlays, input interception, or hidden invasive monitoring.

**AW-PLT-055 — Measured savings.** An adaptive tier MUST be benchmarked for actual incremental CPU/GPU/frame-time savings and input responsiveness. A visual reduction without measurable benefit MUST be investigated.

**AW-PLT-056 — Recovery.** Returning to foreground or AC power SHOULD smoothly restore the chosen tier when stable; quality must not remain silently degraded after pressure disappears.

### 5.1 Suggested policy priority

1. Data integrity and safe approvals.
2. Legibility and keyboard/pointer accessibility.
3. Active human interaction and critical event visibility.
4. User-locked quality/performance limits.
5. Active monitoring and explicitly authorized background services.
6. Optional cinematic effects and noncritical animations.

If policies conflict, the system MUST preserve 1–3 and resolve lower-priority choices explicitly.

---

## 6. Multi-display topology, roles, and layout continuity

Charter 03 owns **workspace and resource identity**. This charter owns **physical display enumeration, capability discovery, window placement, render-scale behavior, and restoration mechanics**. Display identity is a matching hint, not a permanent requirement for accessing the workspace.

**AW-PLT-057 — Topology events.** Aerynth MUST detect supported display attach, detach, geometry, scale/DPI, orientation, usable work area, and primary-display changes through host adapters, and react without restarting where the platform permits.

**AW-PLT-058 — Role-aware layouts.** The system MUST support user-assigned display roles and saved variants for single-display, dual-display, and other supported topologies, including home, project, and workspace-specific arrangements.

**AW-PLT-059 — Stable matching with fallback.** When permitted stable monitor descriptors are available, Aerynth SHOULD use them for restoration; when absent, changed, duplicated, or inaccessible, it MUST fall back to geometry, capabilities, roles, and user selection without losing saved layouts.

**AW-PLT-060 — No sensitive identity dependence.** Full raw monitor serial numbers and equivalent identifying values MUST NOT be unnecessarily persisted, uploaded, logged, or embedded in shareable layout exports; privacy and retention follow Charter 14.

**AW-PLT-061 — Offscreen recovery.** Every accessible native window and detached block MUST be recoverable into an available display's usable area after unplug, undock, sleep/resume, remote desktop changes, or resolution changes; inaccessible windows MUST NOT trap navigation.

**AW-PLT-062 — Canonical resource continuity.** Moving or redocking a block MUST preserve the referenced chat, agent execution, terminal session, editor content, notes, and canonical resource identity; a presentation move MUST NOT duplicate an underlying task or model conversation.

**AW-PLT-063 — Restorable variants.** Aerynth MUST preserve the prior multi-display layout when temporarily collapsing to one display and SHOULD restore it on a matched topology return without discarding intervening user changes.

**AW-PLT-064 — Layout conflict control.** If a user deliberately changes a layout while one display is absent, reconnection MUST not silently overwrite newer changes; conflict policy SHOULD provide a predictable default and accessible recovery/snapshot options.

**AW-PLT-065 — Seamless but honest motion.** Where the host supports it, cross-window and cross-monitor transitions SHOULD preserve semantic visual continuity. When cross-surface compositing cannot produce genuine continuous motion, use a clear, polished fallback instead of fabricated impossible trajectories.

**AW-PLT-066 — Workspace role suggestions.** Vela MAY propose placing monitoring on a secondary display or a timeline near a relevant workspace, but MUST preserve explicit user pinning, policy, focus, and consent boundaries.

**AW-PLT-067 — No forced display role.** Users MUST be able to ignore semantic roles and position blocks manually. Automatic placement MUST be reversible and inspectable.

### 6.1 Required display lifecycle state machine

At minimum, the host MUST be capable of representing:

1. **Topology stable**: assigned display roles and available windows are reconciled.
2. **Change detected**: attach/detach/DPI/rotation/geometry change observed.
3. **Placement suspended**: avoid writing inconsistent snapshots during transient enumeration.
4. **Reflow planned**: eligible windows/blocks mapped to viable work areas.
5. **Reflow committed**: visible arrangement applied without changing canonical resources.
6. **Recovery or fallback**: deterministic safe arrangement and user-visible recovery if an OS operation fails.
7. **Variant restoration**: prior layout restored on a stable matching topology, subject to conflict policy.

Repeated hot-plug events MUST be idempotent and MUST NOT proliferate duplicate windows.

### 6.2 Display roles and example behavior

| Situation | Required outcome |
|---|---|
| Primary + secondary connected | Preferred main work and monitoring roles restored where saved |
| Secondary disconnects mid-task | Detached panels and approvals become accessible on remaining display |
| Secondary reconnects | Suitable previous arrangement offered/restored per preference, without overriding newer explicit edits |
| Primary designation changes | Semantic primary role and actual OS primary display are reconciled, not assumed identical |
| Different DPI or orientation | Layout maintains readable logical sizes and valid hit testing |
| User moves a chat window | Same conversation and running execution continue |
| A new timeline is requested | Placement respects active display roles and user attention |
| RDP/virtual display session | Capability and topology changes trigger safe fallback; no hidden-window trap |

---

## 7. DPI scaling, refresh rates, color, and accessibility

Displays are heterogeneous. Aerynth MUST NOT assume a universal 96-DPI coordinate system, one refresh rate, one color space, or matching taskbar/work areas.

**AW-PLT-068 — DPI-aware presentation.** Supported Windows builds SHOULD use an appropriate per-monitor DPI-aware strategy (including PMv2 where compatible) to keep text, window chrome, pointer hit targets, and rendered assets correctly scaled across monitors.

**AW-PLT-069 — Coordinate spaces.** Window bounds, CSS/logical pixels, device pixels, screenshot regions, pointer positions, and display work areas MUST have explicit conversions; a DPI/scale change MUST NOT cause selection or drag targets to drift.

**AW-PLT-070 — Mixed-DPI testing.** Supported multi-display builds MUST be tested while dragging windows between displays at several scales, not only after restart.

**AW-PLT-071 — Refresh independence.** Each rendering surface SHOULD respect its current display's actual refresh opportunity and power policy, rather than imposing a global 120 Hz or 60 Hz assumption on every monitor.

**AW-PLT-072 — Mixed-refresh stability.** Differing display refresh rates MUST NOT cause semantic event loss, accelerating/slowing motion timing, unbounded work queues, or visibly incorrect state on other displays.

**AW-PLT-073 — Dynamic color pipeline.** HDR/SDR, ICC/profile behavior, gamma, color gamut, transparency compositing, and OS high-contrast settings MUST be evaluated on supported configurations; visual effects MUST have legibility-safe fallbacks.

**AW-PLT-074 — Readable under adaptation.** Performance throttling MUST retain readable text, focus indicators, meaningful status labels, safe contrast, and understandable interactions. Accessibility MUST NOT be relegated to a visually broken mode.

**AW-PLT-075 — Reduced motion and effects.** System or user reduced-motion preferences MUST control parallax, particle intensity, zoom, flashing, and high-amplitude transitions; essential feedback MUST remain available in nonanimated form.

**AW-PLT-076 — Input compatibility.** Mouse, keyboard, touch or pen where supported, screen readers, high-contrast settings, and keyboard-only docking/restoration MUST be considered in rendering/window architecture and tested for supported platforms.

**AW-PLT-077 — No dependence on color alone.** Warning, approval, disconnected, in-progress, and completed states MUST be distinguishable through accessible text/icons/structure even when animation is off or color differentiation is limited.

---

## 8. Native windows, detachment, focus, and desktop integration

Window management is part of the interaction model, not merely an implementation detail.

**AW-PLT-078 — Detachable-block contract.** Each detachable block MUST support a clear ownership transition between docked and native-window presentations, with stable identity, scoped state persistence, and safe close/re-dock behavior.

**AW-PLT-079 — Focus discipline.** Background updates, assistant suggestions, alerts, GPU fallback, and layout restoration MUST NOT unexpectedly steal keyboard focus from another application or from an ongoing user input.

**AW-PLT-080 — Predictable z-order.** Always-on-top, floating companions, game overlays, click-through windows, desktop pinning, and global shortcuts MUST require explicit configuration where relevant and MUST be recoverable/disableable.

**AW-PLT-081 — Selection continuity.** Contextual Command and multimodal selection MUST retain the correct object references during detach, resize, and display transitions; native coordinates MUST NOT substitute for canonical object identity.

**AW-PLT-082 — Window-close semantics.** Closing a presentation window MUST NOT implicitly destroy a resource, terminate an agent, discard a draft, or remove a project; destructive scope must be explicit.

**AW-PLT-083 — Window restoration fidelity.** Startup/restoration SHOULD recover useful positions, sizes, dock states, visibility, last workspace, scroll/focus state where safe, and user-pinned roles without propagating offscreen geometry.

**AW-PLT-084 — Independent window failures.** A crashed or unresponsive render surface SHOULD NOT corrupt application data or automatically terminate unrelated tasks; recovery MUST indicate affected windows and state.

**AW-PLT-085 — Native affordances.** Title bars, maximize/minimize, resizing, accessibility surfaces, drag areas, context menus, tray behavior, file dialogs, and notifications MUST be evaluated with the chosen shell, not left as speculative CSS mockups.

---

## 9. Startup, resume, lifecycle, and persistent services

Aerynth has a rich return experience, but **beautiful startup is not permission to delay essential navigation**.

**AW-PLT-086 — Progressive readiness.** The application MUST distinguish shell ready, UI interactive, local state loaded, backend connected, display layout restored, and monitoring synchronized. The user MUST NOT wait for optional cinematic animation before using basic controls.

**AW-PLT-087 — Nonblocking hydration.** Large conversations, search indexes, timelines, chart histories, and workspace scenes MUST load progressively without blocking interactive input or preventing Quick Capture.

**AW-PLT-088 — Safe crash recovery.** Data writes, layout snapshots, notes, active task references, and event cursors MUST recover consistently after abrupt renderer/host termination to the extent supported by their durability contracts.

**AW-PLT-089 — Sleep/resume reconciliation.** On wake, the host MUST reconcile time discontinuities, display changes, graphics-device state, network/backend connections, and missed event intervals; it MUST NOT pretend continuous monitoring occurred during unavailable periods.

**AW-PLT-090 — Background service separation.** Authorized background agent monitoring and scheduled work SHOULD run independently of cinematic frame loops. Shutting down the last UI window must not have an ambiguous effect on active work.

**AW-PLT-091 — Explicit exit semantics.** The user MUST be able to understand whether closing a window, minimizing, quitting the application, or stopping background services will leave scheduled tasks, local processes, or remote tasks running.

**AW-PLT-092 — Restoration without invented changes.** Welcome-back summaries MUST distinguish events observed during absence, reconciled from external sources, and periods for which monitoring coverage is incomplete.

**AW-PLT-093 — Update resilience.** Application updates and runtime/webview changes MUST preserve project data and provide migration, backup, rollback, or safe-mode procedures appropriate to migration risk.

**AW-PLT-094 — Offline or failed-backend fallback.** Disconnection from Codex or external services MUST NOT crash the graphics application or erase saved project/workspace state; connected features must indicate their availability honestly.

---

## 10. Long chats, real-time streams, graphs, and visualized telemetry

Conversations, live Intelligence Streams, timelines, and profiler graphs can all become large. Their rendering cost MUST be bounded.

**AW-PLT-095 — Long-history virtualization.** Conversations MUST support progressive retrieval and rendering of a visible range; app performance MUST NOT scale directly with every message in a multi-year history being mounted into the UI.

**AW-PLT-096 — Stream backpressure.** Event streams MUST use bounded UI queues, coalescing, sampling/aggregation for presentation, and resumable cursors as appropriate; the durable event store retains underlying facts under Charter 09.

**AW-PLT-097 — Separate presentation from evidence.** A reduced update rate in a graph or Intelligence Stream MUST NOT silently drop recorded events or imply that model execution stopped.

**AW-PLT-098 — Efficient charts.** Large time-series and dense graphs SHOULD use aggregation appropriate to zoom level and preserve access to exact underlying records and units when supported.

**AW-PLT-099 — Large-selection responsiveness.** Contextual selection of text, image regions, file collections, or timeline intervals MUST remain responsive and preserve semantic references even when resources are not fully rendered.

**AW-PLT-100 — Bounded visualization memory.** GPU buffers, texture caches, chart series, particle fields, and offscreen canvases MUST have lifecycle/eviction policies and SHOULD expose leak detection in development builds.

**AW-PLT-101 — Independent indexing.** Search indexing and context retrieval SHOULD run in cancellable or throttled work units so they do not freeze foreground interaction or introduce unbounded memory pressure.

**AW-PLT-102 — Explicit degraded signals.** Delayed chart updates, unrendered history, partial indexing, disconnected streams, or graphics fallbacks MUST have truthful status indicators rather than showing stale state as live.

---

## 11. Performance monitoring, diagnostics, and user controls

Aerynth requires its own performance instrumentation separate from the AI Execution Profiler. The user should be able to tell whether the **interface**, **local services**, or **agent workloads** are responsible for resource pressure.

**AW-PLT-103 — Diagnostics panel.** Development and supported user diagnostics SHOULD expose UI frame pacing, dropped frames, foreground/background state, active quality tier, compositor/API, memory, event/render backlog, and available process resource measures.

**AW-PLT-104 — Attribution boundaries.** Aerynth process, render process, Codex subprocess, terminal child process, remote agent, and external browser workloads MUST NOT be conflated when reporting resource use.

**AW-PLT-105 — Local-first telemetry.** Performance instrumentation MUST operate without compulsory cloud telemetry; any remote diagnostics/export follow Charter 14's privacy and approval boundaries.

**AW-PLT-106 — Nonintrusive diagnostics.** Measuring performance MUST have bounded cost and configurable sampling; collecting every frame into an unbounded persistent log is forbidden.

**AW-PLT-107 — Reproducible reports.** A benchmark export SHOULD contain anonymized environment metadata, workload identifier, build/commit reference, frame-time distributions, resource metrics, selected tier, and known measurement caveats.

**AW-PLT-108 — Performance UI honesty.** Charts, gauges, and quality indicators MUST disclose stale, unavailable, estimated, or aggregated signals and their time windows.

**AW-PLT-109 — Adaptive explainability.** Vela MAY explain why quality changed using measured policy inputs; it MUST NOT claim to know hardware or foreground-app activity that was never authorized or observed.

---

## 12. Reference scenarios and mandatory acceptance matrix

Tests MUST be run against the packaged candidate, not solely a browser developer server. The release matrix MUST include both representative modern hardware and intentionally constrained configurations, with exact hardware/environment recorded in private or appropriately sanitized test artifacts.

| Test ID | Scenario | Required observable result | Evidence |
|---|---|---|---|
| PLT-AT-01 | Cinematic ambient and glass scene | Fluid, coherent visuals; no major text occlusion; bounded cost | Video capture, frame-time histogram, accessibility screenshots |
| PLT-AT-02 | Twelve heterogeneous blocks; drag, resize, maximize | Continuous identity and correct hit targets; no layout corruption | Interaction trace, frame pacing, state assertions |
| PLT-AT-03 | GPU pressure while a different foreground app is active | Automatically reduces optional visuals under selected policy; no focus theft | GPU/frame measurements and governor log |
| PLT-AT-04 | Minimize/hide for sustained interval | Continuous visual work stopped or demonstrably justified; event collection remains correct | CPU/GPU sample traces and event cursor |
| PLT-AT-05 | Battery/power-saver entry and exit | Resource behavior adapts and recovers without losing work | State transition log, power proxies |
| PLT-AT-06 | One to two monitors, then disconnect/reconnect | All windows recover, prior variant remains available, resources persist | Before/after layout hashes and screenshots |
| PLT-AT-07 | Mixed 100%/150%/200% scaling | Correct text sizes, drag positions, hit targets, crisp rendering | Window moves, screenshots, accessibility checks |
| PLT-AT-08 | Mixed 60 Hz / 120 Hz (where present) | Stable semantic timing; no global refresh assumption | Per-surface frame pacing |
| PLT-AT-09 | Detached live chat while agent runs | Same thread/turn and correct stream after move/redock | Stable resource IDs, execution state checks |
| PLT-AT-10 | Abrupt display change during drag | Safe usable recovery; no invisible modal/window | Window geometry and action audit |
| PLT-AT-11 | WebGPU missing or GPU device lost | Functional fallback, clear degraded status, no lost canonical state | Forced failure trace, recovery test |
| PLT-AT-12 | Long chat / huge event history | Responsive scrolling/typing with bounded render memory | Synthetic fixtures, long-task traces |
| PLT-AT-13 | High-rate event burst during cinematic scene | No render queue runaway; event log complete | Ingest vs render counters, dropped presentation indicators |
| PLT-AT-14 | Sleep/wake or remote-session reconnect | Display/layout/backend reconciled; coverage gaps shown | Resume logs, event-reconciliation checks |
| PLT-AT-15 | Screen reader and reduced motion | Functional equivalent navigation and status feedback | Manual assistive-tech test and automated checks |
| PLT-AT-16 | 30-minute interactive soak | No unbounded buffer/texture/window/process growth | Memory/handles/GPU resource trend |
| PLT-AT-17 | Full exit, relaunch, and interrupted update | Safe persisted state; clear task/background semantics | Recovery report and migration evidence |
| PLT-AT-18 | Unavailable/partial platform telemetry | Honest unknown values; governor retains viable fallback | Sensor fault-injection results |
| PLT-AT-19 | User manually locks Cinematic or Gaming tier | Override honored unless safety/accessibility constraint requires a clear exception | Config and transition event records |
| PLT-AT-20 | Secondary monitor appears during new timeline request | Placement respects role, focus, and user pinning | Layout + accessibility trace |

**AW-PLT-110 — Evidence-backed acceptance.** A platform feature MUST NOT be marked done only because a screenshot is attractive, a unit test passes, or a demo happens to work once; both functionality and representative frame/resource evidence are required.

**AW-PLT-111 — High-risk coverage.** Test fixtures MUST include minimized rendering, sleep/resume, GPU loss, display hot-plug, mixed DPI, high-frequency stream bursts, and multi-window restoration before those features can be declared production-ready.

**AW-PLT-112 — Accessibility as gate.** A visually stunning result that is unusable under reduced motion, keyboard-only use, or required readable contrast MUST fail acceptance.

**AW-PLT-113 — Repeatable regression review.** A significant regression or threshold exception MUST be documented with root cause, intended mitigation, owner review, and an explicit decision; performance failures MUST NOT be hidden by lowering fixture complexity.

**AW-PLT-114 — Separate target classifications.** Test results MUST identify whether a target is aspirational, candidate, approved release gate, or measured observation.

### 12.1 Hardware and configuration coverage

The minimum research matrix SHOULD sample:
- An integrated-GPU Windows laptop and a discrete-GPU Windows desktop/laptop.
- Single-display and mixed-DPI/mixed-refresh dual-display arrangements.
- AC power and battery/power-saver states where available.
- Compositor transparency on/off, hardware acceleration available/unavailable, and graphics-backend fallback.
- Foreground Aerynth, visible-but-unfocused Aerynth, minimized, background-monitoring, and foreground-game load.
- Reduced-motion, large text, high contrast, OS zoom/scaling, and keyboard-only navigation.
- Actual packaged binaries, not just browser tabs or hot-reload development builds.

Use representative, nonpersonal test fixtures. Record gaps when certain platforms/hardware are unavailable. Absence of test hardware is not evidence of support.

---

## 13. Architectural service contracts

These are **conceptual boundaries**, not a final code or IPC schema.

| Service | Inputs | Outputs / guarantees |
|---|---|---|
| **Host Capability Adapter** | OS/runtime, display capabilities, native permissions | Versioned capability matrix with unavailable/error states |
| **Display Topology Manager** | Monitor attach/detach, geometry, DPI, work areas, role preferences | Stable topology events and safe placement plan |
| **Window Lifecycle Manager** | Dock/undock, focus, visibility, restore, exit | Native windows and persistent presentation identity |
| **Rendering Capability Adapter** | Browser/graphics features, device lifecycle, quality tier | Scene backend selection, fallback, context/device recovery |
| **Motion Performance Bridge** | Frame pressure, visibility, user preference, semantic events | Frame scheduling and tier-specific motion budgets |
| **Performance Governor** | Measurements, user policies, foreground/power state | Explainable tier decisions with hysteresis and safe limits |
| **Platform Telemetry Collector** | Process/window/render measurements | Source-attributed metrics with units, cadence, provenance |
| **Snapshot & Recovery Service** | Layout variants, window state, stable resources | Transactional restore with conflict rules and safe fallback |
| **Event Presentation Gateway** | App/event-bus streams and subscriptions | Bounded UI updates, accurate cursors, no evidence loss |
| **Diagnostics & Benchmark Runner** | Versioned scenarios and environmental metadata | Reproducible observations, anomalies, and acceptance reports |

**AW-PLT-115 — Interface versioning.** Host, display, renderer, and governor contracts MUST expose version/capability information to prevent silent mismatches during upgrades.

**AW-PLT-116 — Thread/process isolation.** CPU-intensive analysis, indexing, or agent subprocess work SHOULD be scheduled off the critical UI/render thread and MUST have bounded queues, cancellation, and failure handling.

**AW-PLT-117 — Authoritative state.** Durable application state and task/agent execution truth MUST NOT be stored exclusively in GPU buffers, local animation state, or volatile window objects.

**AW-PLT-118 — Deterministic restoration.** Given the same snapshot, stable topology, and user configuration, layout restoration SHOULD produce a predictable arrangement; mismatches MUST leave inspectable evidence rather than silent resource loss.

**AW-PLT-119 — Permission isolation.** Host adapters MUST expose only necessary capabilities to renderer and plugin blocks, respecting Charter 14; native APIs MUST NOT become unrestricted paths around user approvals.

---

## 14. Failure states, threats to performance, and mitigations

| Failure mode | Expected mitigation |
|---|---|
| Browser engine lacks desired graphics API | Feature detection, tested alternate scene, plain functional controls |
| GPU reset/device loss | Recreate graphics resources; preserve canonical state and event cursors |
| Expensive glass/blur on certain drivers | Lower composition cost via tier-specific material alternative |
| Excessive rerenders from live streams | Event coalescing, bounded queues, virtualization, separate graphics layer |
| Offscreen detached window after monitor removal | Validate window against active work areas; safe rehome |
| Mixed-DPI coordinate mismatch | Explicit logical/device conversion and hit-test tests |
| Gaming resource contention | Optional gaming policy, measured GPU reduction, no focus stealing |
| Quality governor oscillation | Hysteresis, dwell thresholds, tier state audit |
| Rendering thread stall | UI monitoring, worker isolation, actionable performance diagnostics |
| Corrupted layout snapshot | Versioned schema, last-known-good snapshot, deterministic fallback |
| Resume with missing monitor or dead backend | Independent display and backend reconciliation, truthful coverage status |
| Process idle but expensive background polling | Poll throttling; service-only monitoring; long-duration idle benchmark |
| Network/backend disconnect | Local-first UI availability; status correction when reconnected |
| External monitor stable IDs unavailable | Role/geometry fallback with user-friendly layout recovery |
| Untrusted embedded content overuses CPU or memory | Process/isolation budgets, suspension, user control, safe teardown |

**AW-PLT-120 — Safe degradation.** Under platform, GPU, or memory failure, the application MUST prioritize state integrity, user input, readable controls, and recoverability before cinematic quality.

**AW-PLT-121 — Diagnosable failures.** A fallback or major automatic suspension SHOULD carry an inspectable reason, time, affected surfaces, and recovery attempt without leaking sensitive personal data into public logs.

**AW-PLT-122 — No forced hardware assumptions.** The absence of advanced GPU features MUST not cause unrecoverable startup failure when a functional supported fallback exists.

---

## 15. Cross-charter interfaces, traceability, and precedence

This charter MUST NOT redefine neighboring authoritative requirements.

| Charter | Owns | Platform obligation |
|---|---|---|
| **00 — Constitution** | Nonnegotiable user experience, truthful state, research, performance and display invariants | Comply with AW-CON-015–021 and AW-CON-074–078 |
| **01 — Experience and Interaction** | User flows, accessibility behavior, contextual command semantics | Provide responsive native input and platform affordances |
| **02 — Liquid Intelligence and Motion** | Six motion systems; materials; choreography; visual identity | Supply capable rendering, clocks, tier budgets, and fallback |
| **03 — Projects, Workspaces, Resources** | Block/resource identity, layout semantics and snapshots | Implement physical placement and restoration against those stable identities, especially AW-PWR-070–075 |
| **04 — Conversations and Connected Branches** | Conversation history, streaming semantics, branches | Present virtualized long histories and stable detached-chat views |
| **05 — Agents, Tasks, Workflows** | Task ownership, scheduling and completion | Never conflate GPU tier changes with task cancellation |
| **06 — Vela** | User attention, proactive behavior and preferences | Provide authorized platform signals and nonintrusive display behavior |
| **07 — Notes and Knowledge** | Notes and knowledge persistence | Quick Capture must remain responsive and recoverable |
| **08 — Context Intelligence** | Context retrieval, compaction, memory | Avoid blocking UI while indexing or constructing context |
| **09 — Intelligence Streams** | Event provenance, durable evidence, replay | Render event bursts efficiently without losing recorded facts |
| **10 — AI Execution Profiler** | Token, model, and agent-execution metrics | Supply *separate* UI/process/resource measurements and truthful attribution |
| **11 — Timelines** | Historical/planning timeline semantics | High-density timelines need bounded presentation work |
| **12 — Codex Execution and Integrations** | Agent/provider protocols and execution | Keep desktop/renderer failures separate from backend task state |
| **14 — Trust and Privacy** | Monitoring consent, OS permissions, retention, security | No invasive game detection or secret device fingerprinting |
| **15 — Quality** | Verification authority and release gates | Publish evidence and meet approved platform thresholds |
| **16 — Engineering** | ADRs, phased delivery, controlled changes | Preserve reproducible research and benchmark data |

**AW-PLT-123 — Cross-charter issue routing.** Conflicting requirements or unclear ownership MUST be recorded and brought for owner review rather than resolved by silently weakening this or another charter.

**AW-PLT-124 — Traceability.** Every approved performance target, display guarantee, graphics fallback, and platform feature MUST map to at least one requirement ID, implementation item, and verification scenario.

**AW-PLT-125 — Unapproved references.** Planned peer charters are directional cross-references until published and accepted; this charter MUST not claim they are already ratified merely because they appear in the roadmap.

### 15.1 Constitutional traceability summary

| Constitutional requirement | Platform elaboration |
|---|---|
| AW-CON-015–021: accessibility, Liquid Intelligence and motion | Sections 3, 7, 8, 12 |
| AW-CON-027–030: organization/display awareness | Section 6 |
| AW-CON-035: long chat scalability | Sections 4, 10 |
| AW-CON-058: truthful reasoning and observability | Sections 3, 10 |
| AW-CON-074: benchmark before stack commitment | Sections 2, 4, 12 |
| AW-CON-075: adaptive quality | Section 5 |
| AW-CON-076: idle discipline | Sections 3, 5, 9 |
| AW-CON-077: performance evidence | Sections 4, 11, 12 |
| AW-CON-078: display continuity | Sections 6–9 |

---

## 16. Research agenda and open decisions

The following choices are **explicitly unratified**. Future architecture notes SHOULD link measured evidence and the decision authority rather than silently treating design suggestions as settled.

1. **Desktop host**: Tauri 2/WebView2 vs Electron/Chromium vs appropriate hybrid/native alternative. Compare packaging, accessibility, memory/process cost, multi-window behavior, transparency, and debugging.
2. **Graphics backend**: WebGL2, WebGPU, hybrid Canvas/SVG, or native GPU. Prove features and fallbacks on packaged target runtimes.
3. **Scene composition**: DOM+GPU layer separation, native transparency strategy, shaders, shared-element transitions across webviews/windows, layered blur and render cost.
4. **Motion scheduling**: Refresh-aware loop, hidden-surface pausing, frame budgeting, multi-window synchronization, semantic event interpolation.
5. **GPU/OS telemetry**: Which counters are reliable per platform and where permissions/attribution make data unavailable?
6. **Gaming detection**: User switch, foreground fullscreen heuristic, OS APIs, process telemetry, or combinations; prioritize permission and low false positives.
7. **Display fingerprinting**: Stable-but-private identity matching without raw serial persistence or overfitting to one docking configuration.
8. **Snapshot conflict handling**: How to merge one-display edits with returning two-display layouts while keeping reversible history.
9. **HDR and color management**: Correct glass/lighting representation across SDR/HDR and mixed-profile displays.
10. **Window detachment model**: Separate webviews versus embedded native windows, state ownership, crash isolation, and focus transfer.
11. **Performance service-level objectives**: Thresholds per reference hardware tier, scenario, refresh rate, energy mode, and development milestone.
12. **Offline/host lifecycle**: Which optional background services remain active on window close, OS sleep, restart, and logout?
13. **Accessibility platform stack**: Screen-reader mappings, keyboard docking, reduced-motion semantic equivalents, assistive technology test matrix.
14. **GPU failure and safe mode**: Recovery policy when drivers or compositors misbehave.
15. **Privacy-preserving telemetry export**: What is safe to include in benchmark reports from a public repository?

### 16.1 Required ADR for shell/render selection

The ADR MUST include:
- Tested versions and reproducible source/test fixtures.
- Hardware, OS, driver, display topology, and runtime versions.
- Comparable measured p50/p95/p99 frame times, input latency, CPU/GPU/energy proxies, memory and startup observations.
- Visual evaluation of the actual cinematic prototypes, not just generic UI.
- Failure and fallback results, accessibility results, and multi-display behavior.
- Engineering/maintenance tradeoffs and upgrade compatibility strategy.
- Alternatives rejected with specific measured reasons.
- Owner review and decision date.
- Explicit revisit triggers if framework capabilities or performance change.

---

## 17. Delivery order and gates

Aerynth's **UI remains first-class and first priority**, but proving the interaction stack does not require implementing all backends first.

| Gate | Milestone | Exit evidence |
|---|---|---|
| **G0 — Evaluation harness** | Repeatable benchmark scenes, telemetry, hardware/OS matrix | Fixture and metrics reproducibility |
| **G1 — Liquid Intelligence prototype** | Cinematic scene, glass, particles, Vela presence, six-system motion bridge | Video + measured smoothness and fallback |
| **G2 — Workspace and multi-window prototype** | Drag/resize, snapshots, detachment, display roles, hot-plug | State/identity tests + mixed-display capture |
| **G3 — Adaptive resource system** | Automatic/Cinematic/Gaming/Battery modes | Measured tier savings, no focus stealing |
| **G4 — Real streaming and long history** | Live Codex/agent event rendering, profiler, virtualized chat | No dropped evidence; bounded memory/frame cost |
| **G5 — Recovery and accessibility** | Sleep/wake, crash/fallback, high DPI, keyboard/reduced motion | Fault-injection, assistive tests, recovery traces |
| **G6 — Architecture selection** | Approved shell/renderer and defined SLOs | Reviewed ADR grounded in G0–G5 |
| **G7 — Release qualification** | Packaged multi-day usage under representative work and gaming | Signed-off scenario matrix and documented limitations |

Work MAY progress in parallel where evidence permits, but a release MUST NOT claim a gate passed without its stated verification. A spectacular concept render is not a proof of packaged desktop performance.

**AW-PLT-126 — Gate transparency.** Teams and agents MUST label prototypes, measured candidates, and supported production behaviors distinctly.

**AW-PLT-127 — Preservation of vision.** If a chosen implementation cannot meet cinematic visual requirements efficiently, the team MUST revisit techniques or platform selection before weakening the visual charter by default.

**AW-PLT-128 — Preservation of usability.** If cinematic effects degrade input, legibility, accessibility, or stability, the team MUST optimize/adapt/fallback rather than claim aesthetic ambition exempts usability.

---

## 18. Document change control and acceptance

This charter is published for repository-owner review, **not automatically ratified by publication**.

Amendments MUST:
1. Identify requirement IDs and scope of change.
2. State motivation and affected user-visible behavior.
3. Evaluate impacts on Constitution, 02 Motion, 03 Workspaces, 06 Vela, 09 Observability, 10 Profiler, 14 Trust, and 15 Quality as applicable.
4. Provide benchmark evidence for changes to hardware assumptions or performance thresholds.
5. Update associated tests, architecture decisions, and traceability.
6. Record repository-owner approval for normative changes.

**AW-PLT-129 — Stable IDs.** Published requirement identifiers MUST remain stable; removed requirements SHOULD be deprecated rather than silently reused for unrelated meanings.

**AW-PLT-130 — No silent relaxation.** Failing tests, incompatible drivers, or difficult implementation details MUST NOT be used to quietly weaken the Liquid Intelligence or user-control guarantees.

**AW-PLT-131 — Ongoing compatibility review.** Platform/runtime updates that affect graphics, permissions, displays, packaging, or background behavior SHOULD trigger a targeted compatibility and regression review before release.

### Acceptance criteria for this document

Publication is complete when its file exists at the canonical path and the governance index is updated. **Governance acceptance** occurs only through the repository owner's explicit approval, with any required amendments recorded. **Product compliance** occurs only after implementations satisfy the approved, testable requirements and applicable release gates.

---

## 19. External reference starting points

These are engineering research references, **not normative substitutions** for project requirements or evidence that a framework choice is settled.

- [Microsoft: High-DPI desktop application development](https://learn.microsoft.com/en-us/windows/win32/hidpi/high-dpi-desktop-application-development-on-windows) — mixed-DPI behavior and per-monitor awareness.
- [MDN: WebGPU navigator.gpu feature detection](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/gpu) — runtime capability discovery and support limitations.
- [Tauri 2 documentation](https://v2.tauri.app/) — desktop host, WebView, windows and platform integration research.
- [Electron documentation](https://www.electronjs.org/docs/latest/) — Chromium/Electron host and desktop API research.
- [Motion documentation](https://motion.dev/docs/react-layout-animations) — web UI layout animation techniques, not proof of cross-window continuity.
- [00 — Aetherwake Constitution](00-AETHERWAKE-CONSTITUTION.md) and [governance registry](README.md) — internal normative hierarchy and status.

---

## Final governing statement

**Aerynth MUST feel extraordinary without behaving wastefully.** The ideal experience is cinematic when the user is engaged, quiet when the user is focused elsewhere, responsive under realistic load, resilient across monitor changes, accessible without special effects, and honest about every limitation. The platform must serve Vela, Codex, projects, chats, and workspaces rather than demand the user's resources or attention as a price of using them.

**Performance is not a concession against Liquid Intelligence. It is part of Liquid Intelligence.**

---

## Proposed amendment CF-2026-11-05: genuine GPU Mind and capability-preserving performance
> **PROPOSED, pending owner acceptance.** Existing performance and multi-display governance remains.

**AW-PLT-132 — GPU volumetric requirement.** The claimed 3D nebula Mind MUST use real GPU-supported 3D geometry/volume, camera depth/parallax and light flow, with demonstrable graphics execution. Static video, CSS or a flat shader cannot qualify.
**AW-PLT-133 — Quality tier independence.** Lower graphics tiers, battery modes, disabled particles and reduced motion MUST NOT silently degrade actual agent reasoning, tool verification, persistent state or task access.
**AW-PLT-134 — Overlapping load validation.** Testing MUST measure concurrent agents, GPT-Live voice, spatial navigation and 3D rendering with CPU/GPU/frame-time/RAM metrics, device thermals if available, p50/p95 latency and physical display behavior.
**AW-PLT-135 — Native hardware truth.** Machine state values SHOULD originate from trustworthy OS-backed services where appropriate; unreachable hardware metrics MUST not be made up by a language model.
**AW-PLT-136 — Meaningful fallback.** Absent GPUs, audio devices or network must preserve conversation, task inspection, privacy controls and accessible nonvisual alternatives wherever supported.
**AW-PLT-137 — Renderer trust boundary.** Shaders, particles, visual plugins and renderer event subscribers MUST NOT possess privileged API keys, independently execute system tools or falsify canonical job state.
**AW-PLT-138 — Spatial geometry persistence.** Mixed-DPI/display switches and constellation/workspace traversal MUST preserve canonical world-space and selection relationships rather than reset them without explanation.
**AW-PLT-139 — Native proof.** A GPU Mind acceptance receipt MUST show device/backend, real camera parallax and volumetric activity driven by real task events, performance/resource metrics and human review.

**Acceptance:** Vela talks while two agents run under a moving real GPU Mind on external OLED; reduce render tier and traverse all spatial destinations while monitoring responsiveness and unchanged task outcomes.
