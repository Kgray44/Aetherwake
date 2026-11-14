# Aerynth Design Engineering Specification
## From design intent to maintainable, measured, accessible desktop implementation

| Field | Value |
| --- | --- |
| Document ID | ADE-001 |
| Version | 0.1.0, proposed technical implementation contract, 2026-11-13 |
| Status | **Proposed specification**; documentation only, not evidence that systems are implemented or owner-approved |
| Scope | Tokens, architecture boundaries, shared components, GPU/compositor, motion/event integration, accessibility, security, ARIE/AEP, verification, migration |
| Authority | [Constitution](../../governance/00-AETHERWAKE-CONSTITUTION.md); [01 Interaction](../../governance/01-EXPERIENCE-AND-INTERACTION.md); [02 Motion](../../governance/02-LIQUID-INTELLIGENCE-AND-MOTION.md); [13 Platform](../../governance/13-PLATFORM-PERFORMANCE-AND-DISPLAYS.md); [14 Trust](../../governance/14-TRUST-PRIVACY-AND-AUTONOMY.md); [15 Quality](../../governance/15-QUALITY-VERIFICATION-AND-ACCEPTANCE.md); [16 Delivery](../../governance/16-ENGINEERING-AND-DELIVERY.md) |
| Design inputs | [Human Interface Guidelines](../design/AERYNTH-HUMAN-INTERFACE-GUIDELINES.md); [Materials](../design/AERYNTH-MATERIALS-AND-LIGHTING-SPECIFICATION.md); [Motion](../design/AERYNTH-MOTION-AND-INTERACTION-SPECIFICATION.md) |

> **A design system is an executable interface contract, not a collection of screenshots.** Aerynth must become more visually extraordinary *and* easier to use, measure, ship, and maintain.

## 0. Authority, status, copyright and scope boundaries

This document translates original Aerynth design rules, informed by Apple's **public** Human Interface Guidelines and Liquid Glass documentation, into candidate engineering contracts. Apple framework calls and proprietary shader internals are **not** prescribed for the Windows product. The source mapping is provided in §16. Aerynth's trademarks, brand assets, and 3D identity remain independent. Do not import Apple SF Symbols, San Francisco fonts, Liquid Glass assets or app UI kits into the Windows binary without verifying licensing.

The current connected app lives in [prototypes/visual-experience/cinematic-v3](../../prototypes/visual-experience/cinematic-v3). At the consulted 2026-11-13 main-branch manifest, it uses **Electron 45.2.1, TypeScript 5.9.3, Vite 7.3.8 and Three.js 0.180.0**. This is an observed package-manifest snapshot, *not* a ratified permanent stack choice. The existing source includes motion, material composition, instrument geometry, scene transitions, Vela projection, native desktop admission and tests. Engineering work MUST extend/reconcile these canonical paths and ownership boundaries, not introduce parallel competing UI worlds.

**Precedence:** the ratified Constitution and charters remain binding; this implementation specification cannot amend them. Existing source behavior is evidence of implementation, **not** automatic acceptance. Final host/graphics choices remain benchmark-backed architecture decisions under Charter 13.

## 1. System topology and dependency direction

~~~text
                     Canonical product state
     project IDs, conversations, event ledger, source provenance
                              |
                  policy-filtered view models
                              |
              +---------------+---------------+
              |                               |
      accessible DOM / controls        spatial scene projector
              |                               |
      tokenized UI components           Three/GPU render surface
              |                               |
          semantic UI intents + scene/layout targets
                              |
                    Motion Coordinator
              (six disciplines; one timebase)
                              |
                   presentation compositor
                              |
                   packaged Electron host
                              |
         OS input, focus, window, DPI, accessibility
                     ARIE resource policy
                              |
       AEP evidence (observed/derived/unavailable, no secrets)
~~~

**ADE-001 — Canonical state ownership:** domain services own resources, execution, event truth, authorization and persistence. UI components and GPU nodes are projections. Rendering code may request actions via typed, policy-enforced commands; it may never create an independent copy of project truth.

**ADE-002 — Typed boundaries:** effects consume *read-only semantic snapshots + intent messages* rather than direct access to credentials, local filesystem or raw provider API keys.

**ADE-003 — Single motion owner:** use the current canonical six-system Motion Coordinator; do not introduce ad hoc per-component animation loops fighting over state.

**ADE-004 — GPU isolation:** scene simulation and shader state must update independently of text/component layout. High-frequency animation must not trigger broad application rerenders or network fetches.

**ADE-005 — Trust and data protection:** rendering events do not authorize actions, storage, external calls, personal-context access or telemetry collection.

## 2. Integration map for the actual repository

This map identifies **existing paths observed in main's directory**, not a guarantee that every exported API is stable or a claim of visual acceptance. Engineers must read implementation and tests before editing, and use the governance router described in [AGENTS.md](../../AGENTS.md).

| Capability to extend | Existing source area | Integration intent |
| --- | --- | --- |
| Application shell/layout | cinematic-v3/src/application.ts, application.css, style.css | Centralize design tokens; preserve existing view transitions |
| Instrument materials | src/instrument-materials.ts, material-compositing.ts, optical-controls.css | Adopt material role/state API, not per-screen effect invention |
| Surface contour and geometry | src/surface-contour.ts, instrument-geometry.ts, resource-surface.ts | Concentric corners, shape ownership, content/chrome distinction |
| Motion and continuity | src/motion.ts, control-motion.ts, resource-material-motion.ts, scene-transition.ts | Reconcile six disciplines; cancellation, retarget, reduced-motion |
| 3D and environment | src/celestial-environment.ts, celestial-depth-field.ts, renderer.ts | Genuine 3D and GPU lifecycle; separate atmosphere from text |
| Vela experience | src/vela-experience.ts, presence-projection.ts, vela-manifestation.ts | Source-linked global state; do not misrepresent cognition |
| Navigation and workspace | src/environment-navigator.ts, workspace-stage.ts, workspace-grid.ts | Stable identity, layout, focus, direct context switching |
| Native lifecycle | native/desktop-main.cjs, host-lifecycle.cjs, native-test-admission.cjs | Safe window/test behavior and OS integration |
| Performance/cost evidence | native/presentation-metrics.cjs, native/resource-power.cjs | Profile genuine packaged host and real resource constraints |
| Existing tests | tests/*motion*, *material*, *presence*, *renderer*, *focus*, native admission | Add tests near owner code, preserve current fixtures and safety |

Paths are relative to the existing cinematic-v3 application directory. Do not replace working modules merely to conform to a speculative folder name.

### Suggested module boundaries (conceptual, not a filesystem migration mandate)

1. **design-tokens:** schema and theme evaluation; no scene or backend imports.
2. **material-resolver:** semantic surface role + environment/accessibility/quality → per-surface shader/compositor parameters.
3. **component-primitives:** accessible buttons, controls, menu anchors, focus rules and layout shells; explicit labels.
4. **motion-adapter:** integrates typed motion intents into the *existing* Motion Coordinator with cancellation and state sync.
5. **spatial-projection-adapter:** maps canonical IDs/events to the genuine GPU scene without storing task truth.
6. **quality-adapter:** consumes ARIE resource policy and generates independent visual quality envelopes.
7. **visual-evidence:** deterministic test harness, captures, frame-time/resource logs and provenance tagging.

Make additions by composition and small PRs. Duplicate implementations, parallel authority stores and sweeping rewrites require an ADR and explicit acceptance.

## 3. Design tokens are data with owners

Every value must declare **semantic role, unit, variants, owner, fallback and version**. Separate stable semantic names from aesthetic constants. Use a checked schema and generated CSS variables/typed TS mappings where useful.

### Proposed token envelope

~~~ts
interface DesignToken<T> {
  id: string;                         // e.g. "surface.chrome.bodyOpacity"
  value: T;                           // resolved for current user / display
  unit?: "css-px" | "device-px" | "ms" | "ratio" | "linear-rgb";
  source: "default" | "theme" | "accessibility" | "resource-policy";
  version: string;
}

interface ThemeContext {
  appearance: "dark" | "light" | "high-contrast";
  transparency: "normal" | "reduced";
  motion: "normal" | "reduced";
  density: "comfortable" | "compact";
  quality: "cinematic" | "balanced" | "efficient" |
           "gaming" | "battery" | "accessible";
  displayScale: number;
}
~~~

This is design pseudocode. Resolve through existing settings and platform state rather than creating a competing preference store.

### Token families and invariants

| Namespace | Examples | Constraint |
| --- | --- | --- |
| typography.* | body.size, code.family, metadata.weight, lineHeight | Scale, reflow and font fallbacks; no protected fonts |
| spacing.* | grid.1–8, control.inset, pane.gutter | Consistent rhythm but content-driven layout |
| radii.* | control, content, popover, modal | Child/parent concentric relationships |
| color.semantic.* | foreground, danger, unknown, focus, selected | Meaning independent of raw blue/violet palette |
| color.brand.* | void, indigo, cyan, violet, pearl | Brand reference; never the sole state channel |
| surface.* | instrument, veil, chrome, elevated, shield | Content vs functional glass separation |
| material.* | blur, rim, scatter, refraction, shadow, backing | Each effect individually removable by tier |
| motion.* | response, morph, spatial, event, reduced | Controlled by one transition graph |
| elevation.* | content, chrome, transient, modal | DOM/GPU z-order policy, not arbitrary escalation |
| accessibility.* | focusRing, minContrast, textScale | Safety/accessibility wins over visual flair |

**ADE-006:** Every new control consumes semantic tokens; inline ad hoc blur/color/spring constants require documented exception.

**ADE-007:** A token update affecting a shared role requires visual snapshot and accessibility regression evidence for all representative variants.

**ADE-008:** Numeric constants in the three design companions are provisional. No tool should auto-apply them repo-wide without profiling and owner visual acceptance.

## 4. Component model and contract

A shared control includes **semantic state, accessible name, command, visual role, layout constraints, theme state, motion intent, quality envelope, error state and cleanup policy**. Effects should be replaceable without changing the command.

### Example candidate component interface

~~~ts
type VisualRole = "content" | "chrome" | "transient" | "shield";

interface AerynthControlSpec {
  id: string;                     // stable UI identity
  accessibleName: string;
  role: VisualRole;
  disabledReason?: string;
  busyState?: "preparing" | "executing" | "blocked" | "unknown";
  commandId?: string;              // routed through approved policy boundary
  sourceResourceId?: string;
  focusPolicy: "normal" | "modal" | "return-to-source";
  reducedMotionFallback: "instant" | "short-fade";
}
~~~

Render visual states from the component/semantic state machine; never drive the domain reducer from a CSS animation event.

| Primitive | Required semantics | Testable states |
| --- | --- | --- |
| Primary / secondary button | Name, role, action scope, visible focus | idle, hover, focus, pressed, disabled, loading, failure |
| Contextual command surface | Current selection scope and permissions | empty, selection, menu, blocked, dismissed |
| Active Projects Dock | Real project identity and accurate activity | idle, multi-project, background run, disconnect |
| Resizable instrument | Persistent ID, correct content/focus | attach, drag, resize, detach, restore, failure |
| Anchored menu / popover | Source anchor, focus trap where modal, Escape | open, reposition, keyboard, close |
| Approval shield | Consequences, principal, resource scope, cancel/confirm | pending, granted, denied, unavailable |
| Vela Presence projector | Genuine 3D + accessible summary | idle, source activity, reduced motion, GPU failure |
| Stream V2 scene | Actual plan/run/event provenance and project scope | live, stale, no source, replay, project switching |

All critical controls must have accessible ordinary DOM representation even when overlaid on a Three.js scene. Do not assign keyboard interaction solely to arbitrary clickable canvas coordinates.

## 5. Astral Glass renderer/compositor plan

The [Materials and Lighting Specification](../design/AERYNTH-MATERIALS-AND-LIGHTING-SPECIFICATION.md) is the visual authority for proposed **original Astral Glass**. Apple's public Liquid Glass guidance recommends using material mainly for floating functional controls and navigation, not across content.

### Rendering passes

1. **Environment pass:** true camera-traversable 3D world. Vela veils/tendrils and scene atmosphere are actual spatial objects/volume, as independently required by the [GPU contract](../architecture/VELA-PRESENCE-GPU-RENDERING-CONTRACT.md).
2. **Content pass:** text, editors, source records and instrument data at native resolution and strong foreground contrast.
3. **Functional chrome pass:** bounded glass background sampling, film, rim and shadows; preserve stable input geometry.
4. **Transient/modal pass:** menus, popovers, and solid approval shields. This wins over scene bloom/lighting.
5. **Accessible overlays:** focus ring, status labels, hit-target structure and screen-reader semantics.

These are conceptual composition roles, **not** a demand for five extra GPU framebuffers. Prototype the least-expensive implementation that maintains the roles on the current host.

### Compositing options to benchmark

| Candidate | Advantages | Main failure modes to measure |
| --- | --- | --- |
| Existing CSS layers / backdrop-filter | Fast iteration, DOM controls remain accessible | Cost of stacked filters, inconsistent compositor paths, readback and text blur |
| Three.js bounded render targets + DOM text | Shared optical scene, controllable shader effects | GPU memory, synchronization, DPR, clipping, context loss |
| Hybrid: cached/backdrop texture + compositor chrome | Amortized blur/sampling over many controls | Stale sampling during movement, complex per-window lifecycle |
| WebGPU experiment if supported | Potential compute/material flexibility | Availability, cold shader compilation, fallback complexity |
| Solid + edge/shadow fallback | Stable across graphics modes, accessible | Less optical expressiveness; preserve identity through hierarchy |

Evaluate representative **packaged Windows** routes, not browser screenshots alone. Record cold start, warm interaction, resize/monitor transitions and inactive-window resource cost; compare the same scene/content. Benchmark before broad stack change or shader rewrite.

### Perceptual and security requirements

- Do lighting in a defined color space, apply tone mapping, then prove text contrast in output appearance. Handle sRGB; verify HDR and wide-gamut separately when offered.
- Clip refraction/sampling to a permitted backdrop. Never sample other windows or private buffers without explicit trusted architecture; never put secrets into effect caches.
- Keep code/editor text in an undistorted resolution-independent pass. Bloom and refraction must not touch focus rings or approval text.
- Cap filter radius, offscreen allocations, shader dispatches and per-frame updates. Hidden/minimized windows can throttle or suspend graphics while data subscriptions persist.
- The material resolver provides an opaque fallback when GPU/capture/contrast data is unavailable. Rendering quality may be reduced without losing core actions.

## 6. Motion Coordinator implementation contract

Adopt the [Motion and Interaction Specification](../design/AERYNTH-MOTION-AND-INTERACTION-SPECIFICATION.md) as the detailed proposal under existing Charter 02. Extend the current source-owned motion system, with:

- A typed intent carrying transition ID, view instance, resource ID, source event, source/target semantics, priority, reduced-motion alternative and interruption policy.
- Monotonic elapsed-time integration and one frame-time coordinator. Keep wall-time only for event provenance.
- Composition of spatial/material/atmospheric/semantic/interaction/performance channels; one property owner per rendered target.
- Interruptible and reversible motion; no stale completion callback overwrites a newer state.
- Proper teardown on view detach, GPU reset, native window loss, camera override and accessibility change.
- Input-to-visible acknowledgement separate from animation-settled time.
- Reduced-motion choices decided before first frame, not as a later optional setting.

**ADE-009:** Never hold a task state transition, permission decision, local draft save or tool invocation behind a visual animation.

**ADE-010:** In a tie, input focus/caret, approval visibility and accessible status outrank environmental simulation and lens fidelity.

## 7. Spatial, truth and privacy boundaries

Vela Presence is a global **symbolic presentation** and Intelligence Stream V2 is a **per-project causal execution landscape**. Both consume the same authorized event/resource data. Do not invent a private chain-of-thought feed or synthesize "tool progress" to justify pretty lighting.

- Subscription scope and redaction occur upstream of view models; a scene node cannot expand visibility.
- Event IDs survive rerender/reconnect, are idempotent and carry observed/derived provenance.
- Replaying recorded event history must be labeled replay; it is never presented as fresh live agent work.
- Switching between Stream projects never cancels, duplicates or resumes provider operations unless a separately authorized command does so.
- A resource may have many scene projections but one canonical identity and one authorization scope.
- Persist camera/layout preferences without retaining unnecessary sensitive content. Do not put prompt bodies or secrets in visual diagnostics.

### Trust-preserving approval path

~~~text
User intent → canonical selection/scope → policy decision
          → (if needed) explicit owner-visible approval
          → permitted command execution → authoritative outcome
          → visual state/event projection
~~~

Never invert this: "glass animation appeared → command must have succeeded" is invalid.

## 8. Platform and accessibility engineering

Desktop parity is not achieved by imitating macOS widgets. Implement and verify:

- Windows native window controls, resize/Snap, taskbar/foreground behavior, high DPI, touch where supported and keyboard shortcuts.
- Real screen-reader names/roles/relationships with predictable focus order, aria-live for important state without noisy narration, and ordinary list/text alternatives to the Vela Nebula and Stream graph.
- User-adjustable reduced motion, transparency, scene activity and effect intensity. Honor platform accessibility signals when available.
- High contrast, text zoom, large-font reflow, focus outlines and cursor/caret clarity across variable bright/dark backdrops.
- Guard against accidental focus theft by streaming, autocompletes, background tasks, notifications or scene transitions.
- Safe recovery from graphics failures and OS/window topology changes while preserving notes, drafts, and authorization state.

### Semantic equivalence tests

For each major perspective, record the same task performed via (a) pointer with cinematic mode, (b) keyboard only, (c) high contrast/reduced transparency, (d) reduced motion, and (e) graphics disabled/failure fallback. Compare **outcome and data**, not only screenshots. Color alone is never status. Relevant text should be readable at intended scales across animated backgrounds.

## 9. ARIE and AEP adapters

The existing [ARIE resource/scheduler contract](ARIE-RESOURCE-AND-SCHEDULER-CONTRACT.md) extends the canonical Performance Governor. ARIE owns budgets and visual quality policy; the Motion Coordinator implements visual responses; AEP measures qualified outcomes. This specification does not add a competing Performance Governor or AI model router.

### Resource policy input

~~~ts
interface VisualQualityEnvelope {
  tier: "cinematic" | "balanced" | "efficient" |
        "gaming" | "battery" | "accessible";
  source: "user" | "arie" | "accessibility" | "fallback";
  visibility: "foreground" | "background" | "minimized" | "occluded";
  frameBudgetMs?: number;         // derived from refresh target if known
  gpuPressure?: "low" | "moderate" | "high" | "unavailable";
  reduceAtmosphere: boolean;
  reduceRefraction: boolean;
  freezeBackgroundScene: boolean;
}
~~~

Conceptual: use existing actual policy contracts and sources after inspection. Don't invent hardware metrics or falsely claim 120 Hz is achievable because the monitor reports that refresh. Tier changes must have hysteresis and manual override, with explainable reason and evidence.

**Capability preservation:** resource pressure may reduce optional local rendering and polling; it is not permission to lower model reasoning quality, skip CIE retrieval, bypass verification, cancel an authorized agent or compromise event trace truth. Any task scheduling changes remain separately governed.

### Minimum performance evidence schema

| Field | Definition |
| --- | --- |
| build / experiment ID | Immutable revision and fixture identity |
| observed timestamp + duration | Monotonic elapsed measurement and wall-time provenance |
| OS / host / renderer | Exact tested versions where available |
| display context | Width, height, scale, refresh, HDR/wide gamut if relevant |
| resource scope | UI render process vs agent/process vs API I/O |
| frame pacing | Median, p95, p99 frame interval, missed/presented frames |
| interaction | Input-to-first-visible feedback; input-to-useful completion |
| transition lifecycle | Started, interrupted, canceled, settled, failed counts |
| GPU/CPU/memory | Actual source/counter, attribution and missing-sensor status |
| qualitative review | Source video/capture, accessibility, legibility, artistic fidelity |
| sample limits | Synthetic/native/provider/owner-reviewed classification |
| regression decision | Baseline, outcome, confidence, reviewer, rollback plan |

Proposed frame-time *reference arithmetic*, not performance acceptance: 60 Hz has ~16.67 ms per presentation opportunity and 120 Hz ~8.33 ms. These are **display intervals**, not empirically achieved app frame times or release standards. Charter 13/15 determine appropriate measurable targets and allowed exceptions per environment.

## 10. Cross-functional gates and CI

A change is not qualified because a screenshot looks polished or CI shows green. The following **proposed** incremental checks supplement existing protected CI. No test job or workflow is introduced by this documentation PR.

| Gate | Where | Expected signal | Important limitation |
| --- | --- | --- | --- |
| ADE-G01 | Token schema/unit tests | Valid token roles, variants, fallback and serialization | Does not prove visual appearance |
| ADE-G02 | Component behavior tests | Correct commands, focus, disabled and approval states | Fake DOM input may miss native issues |
| ADE-G03 | Motion state tests | Stable interruption, retarget, replay/idempotence | Synthetic timing not GPU frame quality |
| ADE-G04 | Shader/material snapshots | Correct masks, bounds, contrast safeguards, tier fallback | Different GPU drivers may differ |
| ADE-G05 | Accessibility audits | Keyboard paths, labels, visible focus, text reflow | Automated scans cannot replace assistive-device review |
| ADE-G06 | Deterministic image comparisons | Representative appearance states, controlled seeds/fonts/scales | False deltas from GPU/OS differences; use reviewable thresholds |
| ADE-G07 | Performance qualification | Real packaged idle/active/background and gaming frame distributions | Windows lab/evidence required; cloud Linux is not physical Windows |
| ADE-G08 | Resource tier interoperability | ARIE input changes only permitted visual work | Does not imply accepted AI scheduler behavior |
| ADE-G09 | Native desktop-test safety | Apply the linked admission policy to all covered entry points, including listed offscreen paths. Check admission before launch and enforce it inside the process. | Require explicit authorization for the named native slot |
| ADE-G10 | Human art/UX review | Owner compares Vela GPU scene to approved source, records findings | Automated image score cannot ratify artistic fidelity |

### Visual regression fixture matrix

At least: Workspace, Constellation, Stream V2, Vela Presence; dark/light/high contrast; standard and reduced transparency; standard and reduced motion; narrow/large/ultrawide; 100%/150%/200% text scale; 60/120+ Hz displays where actually present; one background with high-contrast star field, one with active nearby neon, one subdued idle, one busy long code/chat task; menu/approval/error/reconnect; GPU fallback. Partition expensive scenarios to appropriate safe test hosts; note omissions.

Deterministic snapshots require seeded scene conditions, frozen visible wall-clock content, stable fonts and display scale, explicit camera pose, a sanitized synthetic event log, known driver/runtime and recorded masks for intentionally nondeterministic shader noise. Never create a passing screenshot by globally ignoring large changed regions.

### Documentation-only PR qualification

For a pure Markdown PR, validate existence/links, traceability, contradictions, public-source URLs and the fact that **no source, workflow, CI setting, native launcher or approval system changed**. Do not launch visible desktop tests or claim runtime acceptance from documentation. CI status on docs does not demonstrate graphics quality.

## 11. Safe rollout and ownership roadmap

This is a **proposed set of follow-on implementation PRs**, not delegated tasks, preapproved merges or an assertion that current work is absent.

| Phase | Scope | Owner(s) and qualification |
| --- | --- | --- |
| D0 Baseline | Inventory current shell/material/motion modules, screenshots, frame and a11y evidence; route governance | Mission 1 integration coordination; relevant domain owners |
| D1 Token foundation | Shared semantic token schema, theme/accessibility variants, no broad visual rewrite | UI owner; token/unit tests |
| D2 Chrome material pilot | One toolbar/menu/dock path with original Astral Glass, solid equivalent and profiling | Material/render owner; owner visual comparison |
| D3 Motion integration | Upgrade shared transitions, focus/retarget, reduced-motion and event-provenance adapters | Motion + domain-event owners; interruption tests |
| D4 Scene integration | Integrate continuous perspective navigation after the standalone GPU 3D Presence prototype clears the AMI-T12 owner art gate | GPU/spatial owner; bind the witness to the November 4, 2026 reference in approved evidence storage and record two independent camera rotations, light inside the veils, and connected emergence and retraction with at least three concurrently active tendrils |
| D5 Native and performance | Windows packaged mixed-DPI/HDR/refresh, quality tiers, ARIE/AEP tracing | Platform and verification owners; measured gates |
| D6 Product-wide adoption | Migrate existing controls incrementally; remove duplicated token/animation patterns | Mission 1 integration path, approved release gates |

Each phase requires a narrow branch, corresponding tests, source-revision evidence, owner-visible artifact where relevant, and protected integration. One phase may be researched while another is reviewed; **do not** let concurrent branches rewrite the same global stylesheet or motion owner without coordination.

### Definition of done for an implementation PR

1. Governing requirement IDs and modified interfaces are declared.
2. Behavior is demonstrated for original interaction *and* reduced-motion/accessibility equivalents.
3. Approval and event truth have not been bypassed or conflated with visual state.
4. Visual reference comparison includes source image/clip, environment, uncertainties and owner decision.
5. Frame/resource data are attributed and measured on the claimed host; missing native proof is called missing.
6. A rollback path, error/graphics fallback and compatibility test are documented.
7. CI and code review gates are actually completed; no fake green status.
8. A merge does not imply release acceptance, which remains independently evidence gated.

## 12. Risk register and stop conditions

| Risk | Trigger | Response |
| --- | --- | --- |
| Unreadable UI through glass | Low contrast over moving star/scene | Enable solid/contrast guard immediately; block affected visual rollout |
| Performance regression | p95/p99 frame or input latency worsens materially | Disable discretionary passes, profile before optimizing, avoid cognition cuts |
| Renderer-induced data corruption | Draft or state tied to animation callback | Block merge, separate canonical persistence from frame lifecycle |
| Windows desktop safety breach | Test may show/activate window outside admission | Do not run; require explicitly authorized native slot |
| False semantic activity | Visual pulse without verified source event | Remove effect or conspicuously label synthetic mode |
| 3D identity compromised | 2D sprite/flat orb replaces required volumetric Presence | Block artistic acceptance; restore GPU contract |
| Secret spill through visual logging | Private text captured in shader/trace/debug artifact | Stop capture, purge sensitive artifacts, apply Charter 14 containment |
| Duplicated system authority | New rendering/UI layer owns event ledger, governor or permissions | Reject architecture; integrate with canonical owner |
| Licensable Apple assets shipped | Copied glyphs/fonts/shaders/brand material without permission | Remove assets; use original/licensed alternatives |
| Unsupported platform feature | GPU/HDR/WebGPU/blur unavailable | Solid/alternate path, explicit capability evidence |

## 13. Concrete review packet template

Every visual-affecting implementation PR should include:

~~~yaml
design_evidence:
  revision: "<commit sha>"
  affected_capabilities:
    - "<source path or subsystem>"
  charter_requirements:
    - "AW-LIQ-..."
    - "AW-EXP-..."
  design_documents:
    - "AHI-001"
    - "AML-001"
    - "AMI-001"
    - "ADE-001"
  source_reference:
    identity: "<approved Aerynth target and revision>"
    capture: "<sanitized screenshot/video URL>"
  test_environment:
    host: "<OS and packaged runtime>"
    graphics: "<GPU driver / API or unavailable>"
    display: "<resolution, DPI, refresh, HDR if applicable>"
    accessibility: "<mode>"
    quality_tier: "<observed>"
  measurements:
    frame_median_ms: null
    frame_p95_ms: null
    frame_p99_ms: null
    input_to_visible_p95_ms: null
    cpu_gpu_attribution: "unavailable"
  verification_tier: "design-only | synthetic | native | owner-reviewed"
  known_gaps: []
  regression_risk: "<reasoned assessment>"
  next_safe_test: "<precise bounded test>"
  approval_state: "not-requested"
~~~

Null is **not zero**. The packet must never fabricate measurement results, reviewer approval or protection coverage.

## 14. Required end-to-end journeys

| Journey | Why it matters | Gate |
| --- | --- | --- |
| J01 Open → type immediately → navigate Workspace → Stream | First-input, focus, spatial continuity, sourced plan | Interaction + motion + frame |
| J02 Stream switch under running tasks → inspect Activity Theater | Canonical identity, no task disruption, truthful live/replay | Event/permission/native |
| J03 Enter Presence → observe source-attributed domain effect | Real volumetric world and provenance | GPU + artistic owner review |
| J04 Access approval while lens morphs; deny | Authority independent from animation | Trust |
| J05 Disable transparency/motion, zoom to 200%, use keyboard | Functional equivalent interface | Accessibility |
| J06 Game foreground, background Aerynth active | ARIE quiet visuals, task policy untouched | Resource + focus |
| J07 GPU reset followed by restore of draft and view | Resilient app state and graphics fallback | Native/lifecycle |
| J08 Long chat + simultaneous runs + multiple displays | Input responsiveness without hidden data loss | Performance + continuity |

Record capabilities actually tested. No "looks Apple-like" acceptance criterion exists; **Aerynth's own identity and experience** are mandatory.

## 15. Prohibited shortcuts

- No wholesale copying of Apple appearance/assets or claims to Apple implementation access.
- No blanket glass on all content, semitransparent warning/approval dialogs, or glow that obscures text.
- No flat image, simple orb, 2D trick or prerendered video replacing the actual 3D Vela Mind.
- No second Motion Coordinator, event ledger, Performance Governor, ARIE or authorization policy hidden in UI code.
- No animation callback controlling backend task truth or data persistence.
- No synthetic activity portrayed as live provider work.
- No new resource-consuming canvas per small control when a shared plane suffices.
- No arbitrary UI framework replacement without comparative evidence/ADR.
- No treating CI green, docs approval or a pretty mock as native/owner-qualified release acceptance.

## 16. Source provenance and traceability

### Public Apple sources consulted (design inspiration, not code dependencies)

| Apple public source | Design insight applied |
| --- | --- |
| [Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/) | Consistency, hierarchy and clear controls |
| [Materials](https://developer.apple.com/design/human-interface-guidelines/materials) | Functional glass distinct from content surfaces |
| [Liquid Glass overview](https://developer.apple.com/documentation/technologyoverviews/liquid-glass) | Optically adaptive functional material |
| [Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass) | Controlled tint/contrast, fluid resizing, sparse effects, performance |
| [Meet Liquid Glass, WWDC25](https://developer.apple.com/videos/play/wwdc2025/219/) | Bounded lensing, dynamic response and connected optical transitions |
| [Get to know the new design system, WWDC25](https://developer.apple.com/videos/play/wwdc2025/356/) | Systematic craft, layout and concentric relationships |
| [HIG: Motion](https://developer.apple.com/design/human-interface-guidelines/motion) | Meaningful, cancellable and inclusive motion |
| [HIG: Color](https://developer.apple.com/design/human-interface-guidelines/color) | Semantic color, adaptive contrast, restrained stained glass |
| [HIG: Layout](https://developer.apple.com/design/human-interface-guidelines/layout) | Resizable layouts, text scaling and spatial adaptation |
| [HIG: Designing for macOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-macos) | Desktop information density, keyboard productivity |
| [HIG: Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) | Equivalent paths and readable controls |

### Canonical Aerynth authority and integration references

- [Constitution / governance registry](../../governance/README.md): authority and status.
- [Charter 01](../../governance/01-EXPERIENCE-AND-INTERACTION.md): AW-EXP-097–104, 200–217.
- [Charter 02](../../governance/02-LIQUID-INTELLIGENCE-AND-MOTION.md): AW-LIQ-015–019, 034–042, 089–114, 200–225.
- [Charter 13](../../governance/13-PLATFORM-PERFORMANCE-AND-DISPLAYS.md): AW-PLT-017–025, 035–053; FI resource governance.
- [Charter 14](../../governance/14-TRUST-PRIVACY-AND-AUTONOMY.md): permissions and source boundaries.
- [Charter 15](../../governance/15-QUALITY-VERIFICATION-AND-ACCEPTANCE.md): AW-QVA-028–035, 093, 102–108, owner art gate.
- [Spatial Intelligence systems index](../design/SPATIAL-INTELLIGENCE-SYSTEMS-INDEX.md) and [Spatial runtime](../architecture/UNIFIED-SPATIAL-INTELLIGENCE-RUNTIME-AND-NAVIGATION.md).
- [Presence GPU rendering contract](../architecture/VELA-PRESENCE-GPU-RENDERING-CONTRACT.md).
- [ARIE resource and scheduler](ARIE-RESOURCE-AND-SCHEDULER-CONTRACT.md), [AEP optimization](AEP-ADAPTIVE-OPTIMIZATION-AND-EXPERIMENTS.md).
- [Current implementation inventory](../engineering/CURRENT-STATE-OF-AERYNTH.md) and [desktop-test admission](../engineering/AERYNTH-DESKTOP-TEST-ADMISSION.md).

**Next step:** reconcile proposed contracts with current exported APIs, document any conflicts in an ADR, prepare visual prototypes on a scoped branch, benchmark, and seek explicit owner evaluation before freezing visual tokens or calling the design implemented. This docs PR makes no runtime, CI, repository-policy or desktop-test changes.
