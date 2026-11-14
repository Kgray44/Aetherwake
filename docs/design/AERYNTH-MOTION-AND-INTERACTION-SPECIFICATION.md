# Aerynth Motion and Interaction Specification
## Six synchronized motion disciplines, one continuous spatial universe

| Field | Value |
| --- | --- |
| Document ID | AMI-001 |
| Version | 0.1.0, proposed companion specification, 2026-11-13 |
| Status | **Proposed implementation detail for review**; not an accepted new charter, shipped feature or performance certification |
| Scope | Motion Coordinator, spatial transitions, material response, direct interaction, event truth, interruptions, accessibility, measurement |
| Binding anchors | [01 Interaction](../../governance/01-EXPERIENCE-AND-INTERACTION.md); [02 Motion](../../governance/02-LIQUID-INTELLIGENCE-AND-MOTION.md); [13 Platform](../../governance/13-PLATFORM-PERFORMANCE-AND-DISPLAYS.md); [14 Trust](../../governance/14-TRUST-PRIVACY-AND-AUTONOMY.md); [15 Quality](../../governance/15-QUALITY-VERIFICATION-AND-ACCEPTANCE.md) |
| Companions | [Interface Guidelines](AERYNTH-HUMAN-INTERFACE-GUIDELINES.md), [Materials](AERYNTH-MATERIALS-AND-LIGHTING-SPECIFICATION.md), [Design Engineering](../specifications/AERYNTH-DESIGN-ENGINEERING-SPECIFICATION.md) |

> **Motion is the visible grammar of intent, identity and truthful change.** It never delays authorization, fabricates work, traps focus or makes the user wait to type.

## 0. Public Apple sources and what is original here

Apple's publicly available [HIG Motion guidance](https://developer.apple.com/design/human-interface-guidelines/motion) calls for purposeful, interruptible, brief and accessible movement, including adaptation to input method. Its [Liquid Glass documentation](https://developer.apple.com/documentation/technologyoverviews/liquid-glass), [Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass), and [Meet Liquid Glass](https://developer.apple.com/videos/play/wwdc2025/219/) illustrate controls reacting, lifting, morphing and adjusting optical depth. We adopt these **principles**, not proprietary animations, specific Apple easing curves or their actual runtime implementation.

Aerynth adds a fundamentally different spatial world, six-domain Motion Coordinator, GPU nebular presence, plan-first project Stream, source-provenance semantics, resource-aware rendering and Windows-first interaction. Numeric parameters in this document are **proposed Aerynth calibration seeds**, not Apple metrics, final defaults or already-proven measurements.

### Motion laws

1. **Cause:** every salient motion has a clear user intent, layout change, observable state event or deliberately ambient role.
2. **Continuity:** source and destination share an identifiable object, anchor, project or spatial field.
3. **Truth:** a glow cannot claim reasoning, a pulse cannot claim completion, and an animation cannot authorize a tool call.
4. **Agency:** new user input may interrupt, reverse, redirect or settle any noncritical transition.
5. **Clarity:** movement is subordinate to text, caret, focus, errors and approvals.
6. **Equivalence:** nonvisual and reduced-motion paths communicate the same state and afford the same actions.
7. **Efficiency:** ARIE reduces discretionary work before essential feedback; AEP measures effects using actual evidence.
8. **Recovery:** renderer or motion failure never rolls back authoritative task data or user edits.

## 1. The canonical six-system Motion Coordinator

Existing [Charter 02 §3](../../governance/02-LIQUID-INTELLIGENCE-AND-MOTION.md) defines **six** disciplines. The specification does not create six independent animators.

| Discipline | Owns | Examples | Must not own |
| --- | --- | --- | --- |
| **Spatial Motion** | Camera/object position, scale, docking, layout anchors, world continuity | Workspace → Stream, moving a panel, navigation through Constellation | Persisted project/run identity |
| **Material Motion** | Film, rim, shadow, refraction, backing, optical elevation | Menu growing from button, glass response on focus | User permissions, semantic task state |
| **Atmospheric Motion** | Genuinely spatial particles/veils/tendrils, ambient response | Vela's connected domain activity, depth currents | Fabricated events or secret inner reasoning |
| **Semantic Motion** | Visual interpretation of canonical source events | Preparing → executing → blocked → verified | The underlying event ledger |
| **Interaction Motion** | Hover, keyboard focus, press, drag and gesture feedback | Immediate button compression, drop targets | Authorization policy |
| **Performance Motion** | Coordinated tier changes, scheduling, culling and graceful visual fallback | Gaming mode quiets background atmosphere | Remote AI capability downgrades or task cancellation |

**AMI-001 — Single ownership:** a transition has one coordinator-issued ID and authoritative property ownership. Two disciplines may contribute to a composited appearance but cannot independently fight over the same transform, opacity, blur or focus state.

**AMI-002 — One clock:** the coordinator uses an elapsed-time monotonic clock; wall-clock event timestamps remain for evidence, not for frame integration. Variable refresh and dropped frames must not change logical completion.

**AMI-003 — Domain state remains authoritative:** UI animation may visualize a transition but never gates the state change, local draft persistence, permission enforcement or agent execution.

## 2. Event → intent → scene → frame pipeline

~~~text
User / authorized service / canonical event ledger
                    |
            typed domain or UI event
                    v
         Semantic & navigation reducer
       (IDs, permission, current state)
                    |
               MotionIntent
                    v
       Motion Coordinator / transition graph
  (resource, priority, accessibility, timebase)
                    |
       +------------+--------------------+
       |            |                    |
  UI geometry    material states     3D GPU world
       |            |                    |
       +------------+--------------------+
                    |
          composite presentation frame
                    |
       visual telemetry and user feedback
~~~

Backend events flow through the canonical evidence/subscription boundary, not through particle code. Reconnect/replay of an equivalent event must be idempotent: a completed operation does not become a new "live pulse". Renderer lag never backpressures task authorization.

### Proposed intent shape

~~~ts
type MotionDiscipline =
  | "spatial" | "material" | "atmospheric"
  | "semantic" | "interaction" | "performance";
type MotionPriority = "critical" | "input" | "primary" | "secondary" | "ambient";

interface MotionIntent {
  transitionId: string;
  viewInstanceId: string;
  resourceId?: string;            // canonical identifier, not label
  sourceEventId?: string;         // required for claimed backend activity
  discipline: MotionDiscipline;
  priority: MotionPriority;
  sourceState: string;
  targetState: string;
  anchorId?: string;
  interruptPolicy: "retarget" | "reverse" | "settle-now" | "replace";
  reducedMotionAlternative: "instant" | "crossfade" | "static-landmark";
  requestedAtMonotonicMs: number;
  provenance: "user" | "verified-event" | "demo";
}
~~~

The interface is a **shape proposal**, not a competing runtime type definition. Integrate with existing Motion Coordinator and event contracts after code review. Avoid serializing sensitive payloads in animation traces.

## 3. Transition lifecycle and precedence

State machine: **created → admitted → running → settling → settled**. Side exits: **retargeted, reversed, canceled, failed, force-settled**. Each state is observable and has a deterministic cleanup path.

- User input priorities: critical approval/focus > direct pointer/keyboard > primary navigation > secondary adornment > atmosphere.
- An interrupt is applied at the *next eligible frame* without waiting for a queued timeout to finish. It may interpolate from the current pose/velocity rather than snapping to a stale start pose.
- Target state (including newly authorized navigation) wins over previous visual path. Old animations cannot overwrite a newer state after finishing.
- A canceled drag reverts its preview without committing; the actual data move occurs only via separately validated domain command.
- A hidden/minimized window can force-settle a visual transition while backend tasks continue.
- Renderer reset leads to a stable accessible static projection; on recovery the coordinator reconstructs from current state rather than replaying old "work in progress".
- In a conflict between camera ease and keyboard focus, focus and meaningful destination take priority.

### Resource identity continuity

Represent an object using a canonical resource ID, semantic view ID, current world anchor, screen projection, focus owner and history stack. A resource can have multiple **presentations** without becoming multiple underlying resources. A projector can animate an object between representations; if projection or accessibility continuity fails, the system should immediately switch to a deterministic stable view rather than faking a transform.

## 4. Candidate motion tokens and response profiles

**These are prototype seeds only.** Tune on actual Windows hardware, at different refresh rates and with disabled/slow animation settings. Input-to-visible response is a separate measurement from total animation duration.

| Motion class | Initial candidate | Treatment |
| --- | --- | --- |
| Press/hover response | 60–120 ms apparent response | Subtle surface compression/edge light; do not delay input dispatch |
| Toggle/segmented selection | 120–220 ms | Short bounded transform and backing shift |
| Tooltip/menu | 140–240 ms | Anchored appearance and optional morph, focus as soon as usable |
| Dock/inspector expansion | 180–320 ms | Position/size continuity; retargetable |
| Cross-workspace reorientation | 260–500 ms *if useful* | Spatial trajectory with stationary landmarks and early input acceptance |
| Status/event accent | 160–360 ms | Source-driven, bounded non-flashing pulse |
| Ambient Vela/field motion | slow, state-relative, not global looping | Quiescent at rest; adapt cadence to visibility and resources |
| Reduced motion | 0–120 ms or static | No spatial camera flights, elastic bounce or sustained parallax |

**AMI-004:** These are *durations to evaluate*, not exact standard timing, and do not authorize slowing first feedback for cinematic effect.

**AMI-005:** Use a critically or moderately damped spring for interruptible geometry where appropriate. Natural motion is about *continuity of displacement and velocity*, not gratuitous overshoot. The differential equation can be modeled as mass × acceleration + damping × velocity + stiffness × displacement = 0; parameters must be explicit and stable across frame rates.

**AMI-006:** A fixed easing curve is acceptable for simple one-way opacity changes. For reversible drag/resize/morph, preserve velocity when retargeting to avoid stuttering.

**AMI-007:** Do not combine many independently animated transforms on one element; compose matrix/state once per frame through a single owner.

## 5. Spatial perspective transitions

### Four views, one world

**Workspace** is the active work surface. **Constellation** shows project relations. **Intelligence Stream V2** is an explicitly scoped *per-project* plan-first execution perspective. **Vela Presence** is the global GPU 3D Nebula with six connected domains. The [Spatial Intelligence index](SPATIAL-INTELLIGENCE-SYSTEMS-INDEX.md), [Spatial runtime](../architecture/UNIFIED-SPATIAL-INTELLIGENCE-RUNTIME-AND-NAVIGATION.md), and [Presence GPU contract](../architecture/VELA-PRESENCE-GPU-RENDERING-CONTRACT.md) govern their identity and art fidelity.

#### Workspace → Stream

1. User selects or opens the project's Stream; record project ID, focus, scroll and source anchor.
2. Show initial input feedback instantly; validate view access and source run IDs through canonical APIs.
3. Spatial projector travels from the source anchor to the **existing** project's Stream scene; the screen never changes to a disconnected fake app.
4. Stream renders real plan/branch fronts, source-linked status and accurate execution scope, possibly while awaiting data.
5. Interaction remains available throughout. On failure, display a specific recovery state preserving source context.

#### Stream A → Stream B

Use a continuous reorientation (short when sibling anchors are close), but keep independently stored selected branch, zoom and scroll for A and B. The switch **must not alter, cancel, retry, or duplicate backend work**. Use one authoritative route change; reject any old completion callback that attempts to reopen A.

#### Workspace/Constellation → Presence

Project anchor pulls into global context with visible source/destination continuity. The larger 3D Nebula and connected domain tendrils must be genuine GPU-generated structure, not a sprite with a zoom effect. Presence is *interpretive* and openly labels symbolic activity; users can inspect source evidence without revealing hidden chain-of-thought.

#### Camera safety

- User orbit/pan/zoom overrides any tour. Never lock the user into an automatic flythrough.
- Avoid large involuntary rotations, flashing warp jumps or long field-of-view accelerations.
- Maintain stable orientation markers; if a source anchor is absent, choose a clearly labeled neutral camera path or immediate static destination.
- In reduced-motion mode, switch visual perspectives with fade/static landmarks and consistent breadcrumb/state labels; task functionality remains complete.

## 6. Liquid material behavior as motion

Apple's public Liquid Glass demonstrations emphasize optical fluidity and transitions originating near their controls. Aerynth's **Astral Glass** uses comparable intent but its own implementation.

| Material event | Animated channels | Guardrail |
| --- | --- | --- |
| Hover | Rim highlight, subtle body change | Subdued for mouse; no shake, no focus capture |
| Keyboard focus | High-contrast ring plus slight elevation | Ring appears independent of spring completion |
| Press | Bounded deformation and luminance | Action semantics are independent |
| Button → menu | Shared rounded silhouette, shadow depth, backing | Menu immediately operable; focus managed |
| Drag elevation | Local lens, shadow, scale | Drop permissions verified before commit |
| Overlay close | Reverse/settle toward anchor if still present | If anchor gone, safe fade; never jump focus |
| Reduced transparency | Use an opaque backing with translucency and refraction disabled | Hierarchy maintained by border and solid shadow |

**AMI-008:** Material does not disappear in a way that hides an available command. Resting controls are discoverable.

**AMI-009:** If rendering pressure arises mid-morph, the coordinator reduces blur/refraction first, preserving the target shape, hit testing and semantic resolution.

## 7. The living environment and semantic restraint

Real GPU 3D veils, filaments, particle volumes and deforming core-to-domain tendrils have their own scientific/visual behaviors. The scene may show **ambient life**, but claimed tool activity must always map to actual events:

| Backend semantic state | Possible visual behavior | Required plain-language equivalent |
| --- | --- | --- |
| Preparing | Quiet localized anticipation | "Preparing", source/scope if known |
| Running | Source-linked domain current / activity mote | "Executing", operation and timestamp |
| Awaiting approval | Stable paused signal and clear attention location | "Needs your approval", exact scope |
| Rate-limited/disconnected | Attenuated current, explicit unavailable indicator | Exact blocker and retry policy |
| Completed/verified | Bounded settling event | "Completed" only with verifiable outcome |
| Failed | Quiet but unambiguous error pattern | Failure explanation + recovery |
| Unknown/stale | Neutral nonassertive state | "Status unavailable/stale" |

**AMI-010:** No effect may purport to expose Vela's private thought contents, suggest a guaranteed plan, or invent percentage completion.

**AMI-011:** Atmosphere should not pulse continuously just to simulate busyness. Idle visual identity is still alive through low-level spatial richness, but ambient intensity is user-adjustable and resource-aware.

**AMI-012:** Multiple simultaneous projects must not produce conflicting semantic colors or vibrating screen-wide signals. Group source-linked effects into inspectable localized zones; preserve distinct canonical IDs.

## 8. Keyboard, pointer, touch and voice input

- **Keyboard:** arrow/tab and direct commands prioritize focus clarity over visual lifting; animation never blocks the next keystroke.
- **Mouse/trackpad:** subtle local response; scroll/drag inertia never changes document data until an authorized command.
- **Touch (where supported):** larger interaction envelope and stronger immediate response; retain the same permission policy.
- **Voice:** show transcription uncertainty where material, require explicit authorization for consequential actions; never equate spoken confidence to permission.
- **Assistive technology:** expose semantic status, selection and route changes via accessible descriptions and conservative live regions.
- **System focus/notifications:** background agent events do not steal OS foreground or read cursor position merely to animate.

Input-method differences may affect **amplitude**, not available actions or trust boundaries.

## 9. Reduced motion and inclusive behavior

| Standard animation | Reduced-motion equivalent |
| --- | --- |
| Camera travel through Constellation | Instant/stable view change with route label and return path |
| Vela domain tendril/current | Static illuminated connection and accessible relation list |
| Lensing button morph | Popover appears anchored with brief fade or instant |
| Expanding card/Stream landscape | Direct settled layout with named heading/selection |
| Task pulse | Label/icon/state update, screen-reader announcement when appropriate |
| Drag ghost | Clear focus/selection + keyboard move operation |
| Scene parallax | Fixed, nondisorienting composition |
| Flashy success/error | Stable semantic banner and action result |

Reduced-motion requests must apply *before* the first frame of a motion-intense screen, not after the user is exposed. Do not force the user to disable GPU rendering or lose the nebula's static depth to attain comfort. Reduced motion and reduced transparency are independent settings. Accessibility preferences also govern animation from attached monitors and detached windows.

## 10. ARIE resource tiers and AEP evidence

The [ARIE contract](../specifications/ARIE-RESOURCE-AND-SCHEDULER-CONTRACT.md) owns resource policy, task-admission budgets and protection of foreground input; the Motion Coordinator consumes a typed tier + capability envelope. It cannot decide to downgrade remote Vela cognition merely because GPU pressure is high.

| Pressure/visibility | Coordinator action | Preserve |
| --- | --- | --- |
| Foreground, headroom | Full approved cinematic tier | Crisp text, immediate input |
| Moderate pressure | Fewer secondary post passes, lower background animation density | Main scene identity, sourced status |
| Gaming/foreground competitor | Heavily suppress background effects, low-frequency hidden views | Data collection/authorized task work |
| Battery/minimized | Suspend discretionary render loops and expensive blur | Persistent state, return readiness |
| GPU/context loss | Stable accessible projection, retry/rebuild resources | User drafts, approvals, truth ledger |
| Measurement unavailable | Conservative quality selection, record unknown | Do not invent sensor values |

AEP may compare visual variants only with quality/legibility regressions checked and explicit evidence. Suggested metrics: input-to-first-visible feedback median/p95, transition settle latency, interrupted-transition correctness, sampled frame delta median/p95/p99, long-task input latency while rendering, missed presentation opportunities, GPU time/cost where instrumented, memory/VRAM allocations, tier dwell time, and safe fallback success rate. Distinguish **observed/derived/estimated/unavailable**.

## 11. Safety, concurrency and failure cases

**AMI-013 — Reconciliation:** reordered, repeated, delayed and canceled events settle to the same current authoritative state; replay is not new progress.

**AMI-014 — Source of truth:** approval success, task completion, file edits, project changes and persistent note contents must never be coupled to animation finished callbacks.

**AMI-015 — Concurrency:** two user interactions on the same object are serialized/merged by resource scope; unrelated views may animate concurrently without sharing mutable visual state.

**AMI-016 — Abort:** cancellation releases GPU targets, event subscriptions, pointer capture and animation queue entries; no ghost overlays.

**AMI-017 — Data protection:** visual telemetry stores only event IDs and permitted metadata; do not capture private conversation text merely to profile transition costs.

**AMI-018 — Security:** a dragged selected file or material ripple cannot broaden authorization to sibling files or external services.

**AMI-019 — Window change:** minimize, DPI change, unplug monitor and native focus loss always reach a stable presentable state, not an orphaned camera path.

**AMI-020 — Restart:** on renderer restart reconstruct from latest domain snapshot rather than "replaying thought" and misrepresenting old work.

## 12. Deterministic test and human-review matrix

| Test | Scenario | Expected evidence |
| --- | --- | --- |
| AMI-T01 | Mid-transition reverse 5 times | No teleport, transform fight, stale focus or leaked animation entries |
| AMI-T02 | Start text selection during camera travel | Immediate caret/selection and interruption |
| AMI-T03 | Live events arrive out of order and duplicate | One canonical status update, no fabricated live replay |
| AMI-T04 | Stream A ↔ B repeatedly during concurrent tasks | Same run IDs, no extra tool calls or task cancellation |
| AMI-T05 | Open popover mid-hover/press and dismiss via Escape | Correct source anchor, hit testing and returned focus |
| AMI-T06 | Toggle reduced motion during scene travel | Immediate accessible settled state, correct breadcrumb |
| AMI-T07 | Trigger GPU loss/resize/monitor detach mid-morph | No lost draft or permission state; stable fallback |
| AMI-T08 | Gaming/low-resource tier while typing/dragging | Essential input protected, atmospheric work reduced |
| AMI-T09 | Pause awaiting approval and then deny | Source-truth state, no accidental execute animation |
| AMI-T10 | 30+ minutes of active work/stream updates | No queue/memory growth or animation drift |
| AMI-T11 | Keyboard-only cross-perspective navigation | Landmark orientation, focus and resource identity preserved |
| AMI-T12 | Owner review of the standalone GPU 3D Nebula against the November 4, 2026 reference image in approved evidence storage | Two independent camera rotations demonstrate traversable depth and light inside the veils. Observe attached tendrils emerge and retract, with at least three concurrently active. Complete this gate before broad Presence integration. |

**Test provenance:** build SHA, OS, Windows graphics/driver version, actual renderer, per-display DPI/refresh, tier, accessibility preferences, event fixture and canonical IDs, measured response/frame distributions, capture/video, whether the test was synthetic or native, risk and next action.

Do not declare a synthetic demonstration to be live provider evidence. Respect the [desktop-test admission controls](../engineering/AERYNTH-DESKTOP-TEST-ADMISSION.md) before launching any covered native verifier, including offscreen entry points listed there. Verify admission before launch and enforce it inside the process. Owner-observed visual fidelity remains a separate gate even after automated tests pass.

### Example acceptance questions for a design review

- Did the user always know what they were looking at and how to return?
- Did any motion misleadingly suggest an operation completed?
- Could a new intent interrupt a previous intent without waiting?
- Did the scene maintain one spatial identity instead of a slideshow of tabs?
- Did increased contrast/reduced motion preserve all functions?
- Were input latency and resource cost measured, not guessed?
- Were Apple-inspired qualities interpreted through **Aerynth's original visual vocabulary**?

## 13. Existing authority and source map

| Topic | Existing Aerynth authority |
| --- | --- |
| Six synchronized disciplines and transitions | AW-LIQ-015–019; AW-LIQ-106–114 |
| Spatial engine / Vela Presence | AW-LIQ-200–225; [Spatial runtime](../architecture/UNIFIED-SPATIAL-INTELLIGENCE-RUNTIME-AND-NAVIGATION.md) |
| Material appearance and tiers | AW-LIQ-034–042; AW-LIQ-089–105 |
| UI navigation and keyboard | AW-EXP-097–104, 200–217 |
| Rendering lifecycle, real metrics | AW-PLT-017–025, 035–053 |
| Verification and live artistic gate | AW-QVA-028–035, 093, 102–108, §21 |
| Security/revocation | [Charter 14](../../governance/14-TRUST-PRIVACY-AND-AUTONOMY.md) |

Public Apple references:
- [HIG: Motion](https://developer.apple.com/design/human-interface-guidelines/motion)
- [HIG: Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)
- [Liquid Glass overview](https://developer.apple.com/documentation/technologyoverviews/liquid-glass)
- [Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass)
- [Meet Liquid Glass, WWDC25](https://developer.apple.com/videos/play/wwdc2025/219/)
- [Get to know the new design system, WWDC25](https://developer.apple.com/videos/play/wwdc2025/356/)

**Next design decision:** visually evaluate the candidate response profiles, user-reference Nebula fidelity and reduced-motion equivalents before freezing production tokens. Engineering architecture and implementation verification belong to the companion [Design Engineering Specification](../specifications/AERYNTH-DESIGN-ENGINEERING-SPECIFICATION.md).
