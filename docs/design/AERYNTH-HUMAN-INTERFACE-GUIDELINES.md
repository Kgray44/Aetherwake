# Aerynth Human Interface Guidelines
## A cohesive, adaptive, trustworthy desktop experience

| Field | Value |
| --- | --- |
| Document ID | AHI-001 |
| Version | 0.1.0, design specification for review, 2026-11-13 |
| Status | **Proposed implementation-level companion**, not a new governance charter, not a claim of implementation or owner acceptance |
| Scope | Universal shell, navigation, typography, hierarchy, input, accessibility, and interface behavior |
| Governing authority | [Constitution 00](../../governance/00-AETHERWAKE-CONSTITUTION.md); [01 Interaction](../../governance/01-EXPERIENCE-AND-INTERACTION.md); [02 Liquid Intelligence](../../governance/02-LIQUID-INTELLIGENCE-AND-MOTION.md); [13 Platform](../../governance/13-PLATFORM-PERFORMANCE-AND-DISPLAYS.md); [14 Trust](../../governance/14-TRUST-PRIVACY-AND-AUTONOMY.md); [15 Acceptance](../../governance/15-QUALITY-VERIFICATION-AND-ACCEPTANCE.md) |
| Companions | [Materials and Lighting](AERYNTH-MATERIALS-AND-LIGHTING-SPECIFICATION.md), [Motion and Interaction](AERYNTH-MOTION-AND-INTERACTION-SPECIFICATION.md), [Design Engineering](../specifications/AERYNTH-DESIGN-ENGINEERING-SPECIFICATION.md) |

> **One continuous spatial universe. No disconnected screen changes.** Familiarity without generic chrome; spectacle without friction; powerful intelligence without sacrificing direct control.

### Authority and Apple-reference boundary

These guidelines are Aerynth's *original* design interpretation, informed by **public** Apple Human Interface Guidelines, the Liquid Glass overview, and Apple's design-system presentations (reference list at end). They do not reproduce Apple's private specifications, claim access to proprietary Liquid Glass implementation, or authorize use of Apple trademarks, SF Symbols, platform asset kits, fonts, or art beyond applicable licenses. Apple's documented principle of a distinct *functional glass layer* informs our separation of navigation/controls from content. Aerynth's distinctive identity is its luminous astronomical universe, GPU-native Vela Presence, real instruments, semantic event truth, and non-Apple platform behavior.

**Precedence:** Constitution > ratified charters > accepted architecture/interfaces > this proposed specification. In a conflict, follow the higher authority and open a decision record; do not silently replace the real 3D Nebula, six-system Motion Coordinator, canonical event ledger, or acceptance gates. Numeric examples here are **provisional prototype tokens**, not Apple measurements or approved release thresholds.

## 1. Experience principles

| ID | Principle | Engineering consequence |
| --- | --- | --- |
| AHI-001 | **Content before chrome** | Navigation floats above, but does not obscure, meaningful content. Full-time translucent effects are not the default content background. |
| AHI-002 | **Spatial continuity** | Workspace, Constellation, Stream V2 and Presence remain perspectives of one world; navigation preserves resource identity and return path. |
| AHI-003 | **Intentional beauty** | Every prominent glow, lens, ripple, or animation serves focus, state, causality or orientation; ambient richness is independently adjustable. |
| AHI-004 | **Native-quality productivity** | Text editing, resizable windows, focus behavior, shortcuts, context menus, drag-and-drop and accessible controls remain first class on Windows. |
| AHI-005 | **Progressive mastery** | Primary actions are obvious; advanced inspection, AEP/ARIE reasoning, telemetry, provenance and override controls emerge without cluttering default use. |
| AHI-006 | **Truthful intelligence** | Vela's expressive state and project activity map to actual, authorized, observable events. No fabricated tool progress or implied inner thoughts. |
| AHI-007 | **Respect the machine and person** | ARIE may adapt optional graphics, not erase the user’s information, change permissions, downgrade remote cognition, or steal focus. |
| AHI-008 | **Graceful equivalence** | Reduced motion, solid surfaces, non-GPU and screen-reader modes provide the same core work actions and factual state. |

## 2. The three-layer model

Aerynth distinguishes *meaningful content*, *functional chrome*, and *ambient environment*, rather than rendering everything as identical blurry cards:

1. **Environment / spatial world:** GPU 3D nebula, project constellation, atmospheric depth, spatial transitions, approved illustrative scene elements. Rendered behind or beside task surfaces; not itself a source of authorization.
2. **Content / work instruments:** editor, chat, code, notes, execution plan, evidence, timeline, tables and diagnostics. Favor stable opaque or lightly frosted panels with strong text contrast. Use local grouping to distinguish regions.
3. **Functional glass:** global command, Active Projects Dock, navigation, contextual actions, toolbars, anchored menus, draggable handles and short-lived inspectors. It may refract or tint surrounding content, but must retain clear outlines, stable targets and readable controls.

Glass is **not** an automatic wrapper for every card. Larger sidebars can be more opaque; critical forms and destructive confirmations take an assertive solid backing. A glass control may briefly become more visually expressive on interaction. Scrolling under fixed chrome requires an adaptive readable edge/scrim, not gratuitous blur everywhere.

## 3. Information architecture: four real perspectives

| Perspective | Canonical job | Must expose | Not allowed to substitute |
| --- | --- | --- | --- |
| **Workspace** | Author, organize, converse, edit, approve and act on project resources | Working context, selected resource, command entry, drafts, undo and safe progress | A flat asset slideshow or nonfunctional demo |
| **Constellation** | Understand project/workspace relationships and navigate | Stable spatial anchors, selection, keyboard/list equivalent, source/destination | A standalone decorative star chart |
| **Intelligence Stream V2** | Observe one project's plan-first execution landscape and causal activity | Project identity, branch fronts, status truth, Activity Theater, source trace and direct project switching | Small generic feed, ungrounded fake progress |
| **Vela Presence** | Understand global assistant and domain-level coordination | Actual scope and explanatory abstraction, GPU-native 3D Nebula, six linked domains, accessible summary | A 2D orb, simple flat radial navigation, claimed private reasoning |

### Global navigation contract

- **AHI-009:** Preserve an always-available escape/back path; neither camera travel nor an animation completion is a prerequisite to keyboard action.
- **AHI-010:** Active Projects Dock uses one identity-stable entry per relevant project, with primary entry to Workspace and secondary entry to Stream, as governed in 01 §17.
- **AHI-011:** Global command can be entered without disturbing open edits; query results clearly distinguish navigation, reversible actions and consequential commands.
- **AHI-012:** Stream project selector must support direct switching; never interpret switching as canceling or retrying a running backend task.
- **AHI-013:** Navigation reuses resource identity and view-state snapshots; it does not clone projects or execution runs merely to animate continuity.
- **AHI-014:** Mode changes retain focus destination, a predictable back target, scroll/selection context and explicit source provenance when relevant.
- **AHI-015:** Vela's global mood and instruments may communicate *observable* executing/paused/waiting/error states, never unverifiable internal thoughts.

### Navigation path examples

| From → to | Transition intent | Semantic invariant |
| --- | --- | --- |
| Workspace → Stream | Selected project surface expands into causal plan perspective | Same project ID; actual run IDs retained |
| Stream A → Stream B | Camera/path reorients to sibling project anchor | A and B have independent view-state, no task mutations |
| Workspace → Presence | Project anchor recedes into a global, inspectable domain view | Global scope is explicitly labeled |
| Presence → Workspace | Domain anchor resolves to a specific project/resource | Permissions and selected resource are checked again |
| Any view → approval | Local anchored or centered confirmation with higher contrast | Clear scope/impact; no visual effect grants permission |

## 4. Windows-first desktop shell

The current connected application is an Electron/Vite/TypeScript/Three.js application (see its package manifest); this does **not** settle the final renderer architecture. These rules apply independently of host technology.

- Resizable, movable, minimizable windows; ordinary Windows title bar, taskbar, task switching and platform shortcuts remain predictable.
- Preserve native hit testing for resize edges and draggable regions. Decorative glass must not intercept text selection, drag, pointer capture or close/minimize controls.
- Allow narrow utility widths and large multi-monitor layouts. Never hardcode the window to a single monitor's pixel dimensions.
- Detached windows own their own accessible focus, update cadence and display scale; persistent resource state is shared, not duplicated.
- Respect display work area, zoom, DPI, refresh rate, color profile and text scaling. Display topology changes must not strand a panel off-screen.
- For any custom title region, test maximize/restore, Windows Snap, screen readers, mixed-DPI boundaries and high-contrast settings.
- Honor the established [desktop-test admission policy](../engineering/AERYNTH-DESKTOP-TEST-ADMISSION.md) before any tests that could launch visible windows. Documentation-only work must not reopen that slot.

## 5. Layout and density

### Responsive composition

Container-width thresholds below are **candidates to evaluate**, not platform or Apple requirements.

| App viewport | Proposed behavior |
| --- | --- |
| Under 720 CSS px | Single primary instrument; dock collapses to labeled compact access; inspector becomes an explicit panel |
| 720–1199 CSS px | Primary work area + optional collapsible navigator, no mandatory permanent multi-column chrome |
| 1200–1599 CSS px | Work area plus optional navigation/inspector where useful |
| 1600+ CSS px | Progressive multi-column workspace with user-configurable regions; avoid gratuitous wide text lines |

Breakpoints respond to **available viewport width**, zoom and content constraints, not nominal screen size. At 200% text scaling, recompute from measured content, allow wrapping, preserve important controls and prevent clipped approvals. User-selectable density: Comfortable and Compact; Compact never removes accessible hit areas for touch configurations.

### Proposed token families

Define tokens in the canonical design-token schema rather than inline one-off CSS:

| Family | Initial candidates | Purpose |
| --- | --- | --- |
| Spacing | 4, 8, 12, 16, 24, 32 CSS px | Coherent rhythm; optically adjust complex controls |
| Corners | 8, 12, 18, 24 CSS px | Control / instrument / overlay; parent-child concentric appearance by construction |
| Text | 12 metadata, 14 secondary, 16 body, 20 section, 28 display CSS px | Minimums are design candidates, *not* exemptions from text scaling or accessibility |
| Line heights | 1.35–1.55 body; slightly tighter headings | Long coding/chat sessions require scanning comfort |
| Reading width | 62–80 characters for prose (measure, don't truncate code) | Reduce tiring line lengths |
| Density | Comfortable / Compact | Same features, different spatial rhythm |
| Focus outline | ≥2 CSS px visible outline, high contrast against both backdrops | Cannot rely on glow or color alone |

Prefer a licensed system-friendly sans for UI; use a distinct monospaced family for code, data and telemetry. Provide reliable fallbacks. Do not bundle Apple fonts or SF Symbols on Windows without appropriate permission. Icons should be original or properly licensed with stable metaphors; label ambiguous pictograms.

### Color semantics

Token roles, not fixed brand swatches, drive behavior: text.primary, text.secondary, text.muted, action.primary, state.success, state.warning, state.danger, state.unknown, focus.ring, layer.content, layer.chrome, layer.modal. Aerynth's blue/indigo/violet/pearl palette is reserved for brand, scene light, orientation and measured emphasis. Never encode success, running, denial or authorization solely as a colored nebula.

## 6. Component behavioral contracts

| Component | Resting | Active / focus | Failure / accessibility |
| --- | --- | --- | --- |
| Command entry | Clear instruction and scope | Visible keyboard focus, exact selection | Unknown/unavailable reason; no silent action |
| Navigation glass | Quiet, peripheral | Lifts only when engaged; anchored result | Solid/high-contrast equivalent |
| Project dock | Identity-stable project marker | Keyboard/pointer selection and context | Accurate stale/disconnected marker, no fabricated activity |
| Chat/composer | Opaque readable message region | Caret and draft have priority over effects | Draft preserved on crash/disconnect; explicit retry |
| Approval sheet | Impact, target, permission scope | Confirm/cancel unambiguous and distinct | Never dismiss as approved due to animation |
| Status instrument | Label + source state | Visual emphasis proportional to importance | Unknown ≠ idle, failed ≠ complete |
| Vela Presence | Calm reflective ambience | True source-linked activity | Screen-reader summary/list; scene can be disabled |
| Stream V2 | Plan and branch truth | Expand causal details; keyboard timeline | Missing event coverage displayed as limitation |

An overlay is anchored to the action source when that improves causality, but must reposition within the viewport and avoid clipping. Modal interruption uses a clear dimming/solid separation where focus and authorization require it. Do not hide destructive actions behind a hover-only flourish.

## 7. Input, navigation and focus

- **AHI-016:** Every core action is keyboard-operable. Tab order follows functional reading order, not particle or DOM stacking order.
- **AHI-017:** Focus is a semantic resource/window identity, not an incidental CSS element; repair focus after view changes and element recycling.
- **AHI-018:** Esc dismisses a transient overlay before navigating back; avoid swallowing Escape inside an unfinished user edit without clear behavior.
- **AHI-019:** Keyboard shortcuts are discoverable, remappable where reasonable, and do not conflict silently with text input or OS shortcuts.
- **AHI-020:** Right-click/context menus operate on explicitly selected scope and use the same policy engine as toolbar/voice actions.
- **AHI-021:** Drag is reversible, has visual affordance and keyboard alternative, preserves identity, and must not commit a destructive effect before confirmed target.
- **AHI-022:** Pointer and touch activation use equivalent command authorization; target size reflects actual input mode rather than copied mobile metrics.
- **AHI-023:** No streaming event, automation or background task may steal input focus, jump the reading position or overwrite a draft.

## 8. Trust and explanation are interface features

The UI must show the difference between **suggestion, preparation, permission request, execution and verified outcome**. A strong visual effect is not evidence that an operation happened. For consequential actions, show target, likely effects, scope, account/project, risk, cancellation and available recovery before execution. Aerynth may make low-risk reversible actions fluid, but visual continuity never bypasses [Charter 14](../../governance/14-TRUST-PRIVACY-AND-AUTONOMY.md).

- No credentials, tokens or sensitive snippets in glass reflections, telemetry overlays, exported design fixtures or screen-capture demos.
- A camera transition, hover gesture or selected file cannot expand tool permissions.
- Live indicators require source-linked events; synthetic showcases must be explicitly labeled.
- User-visible errors state what happened, what did not happen and the smallest safe recovery action.

## 9. Accessibility modes

| Mode | Required equivalent |
| --- | --- |
| Reduced motion | Static landmarks, short fades or immediate transitions; no camera flight, elastic wobble or mandatory parallax |
| Reduced transparency | Solid/frosted backing with consistent hierarchical border and readable text |
| Increased contrast | Strong component boundaries, monochrome-first labels, visible focus |
| Screen reader | Named views, headings, logical focus order, alternative lists for graphs/nebula, meaningful status changes |
| Keyboard only | Full task workflows, resource switching, approval, search, escape and recovery |
| Graphics unavailable | Ordinary chat, notes, navigation, task actions, approvals and source truth remain usable |
| High zoom / large text | Adaptive reflow, no lost action, no cropped target or overlapped text |
| Color/flash sensitivity | No color-only meaning; no flashing status or strobing; user-controlled atmosphere |

Accessibility is not a low-fidelity alternative product. Its semantics and capability surface are equal.

## 10. Verification scenarios and acceptance

These **proposed AHI test cases** are companions to binding Charter 15 requirements, not independently ratified release gates.

| Case | Exercise | Pass evidence |
| --- | --- | --- |
| AHI-T01 | Navigate Workspace → Stream → Presence → original Workspace | Canonical IDs unchanged, source/return context correct, no task mutation |
| AHI-T02 | Operate all primary commands without pointer | Focus trace, full action coverage, Escape and undo work |
| AHI-T03 | Resize from narrow utility to ultrawide and across mixed DPI | Recorded layouts, no unreachable controls, editor intact |
| AHI-T04 | High-contrast and transparency-reduced modes on complex nebula background | Readability images and measured text/control contrast |
| AHI-T05 | Repeated asynchronous events during navigation and editing | No focus theft, lost drafts, fake completed events |
| AHI-T06 | Stream directly switches projects under ongoing background operations | No cancel/restart; correct independent view state |
| AHI-T07 | Approvals during interrupted motion | Correct permission state independent from animation |
| AHI-T08 | Force graphics failure and restart | Core content/actions usable; state restored, limitation truthfully shown |
| AHI-T09 | Accessibility tree for Presence and Stream | Full state summary and relationships without visual interpretation |

Each review supplies build SHA, environment, test inputs, captures, observed vs expected, source event IDs where applicable, and precise failures. Do not mark a design verified from document completeness, screenshot mockups or a CI badge alone.

## 11. Apple-public-reference mapping

| Public source | Informed Aerynth choice | Deliberate difference |
| --- | --- | --- |
| [Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/) | Clarity, hierarchy, platform-aware controls | Original Windows-first product architecture |
| [Materials](https://developer.apple.com/design/human-interface-guidelines/materials) | Glass mainly for floating functional elements, not the entire content layer | Astronomical depth and independent material pipeline |
| [Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass) | Adaptive contrast, disciplined color, responsive navigation and overlays | No Apple SDK dependency or proprietary look-copy |
| [Designing for macOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-macos) | Dense desktop productivity, keyboard use, resizable windows | Windows native integration takes precedence |
| [Layout](https://developer.apple.com/design/human-interface-guidelines/layout) | Continuous reflow with available space, zoom and text growth | Breakpoints above are *Aerynth proposals* |
| [Color](https://developer.apple.com/design/human-interface-guidelines/color) | Semantic appearance variants, sparse tinted controls | Aerynth's brand colors and functional event palette |
| [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) | Multimodal input and equivalent nonvisual feedback | Our GPU spatial scene always has an ordinary accessible alternative |

**Next implementation step:** capture visual reference states for the four perspectives, confirm proposed tokens with the owner, then implement the shared token/component contracts in the [Design Engineering Specification](../specifications/AERYNTH-DESIGN-ENGINEERING-SPECIFICATION.md). This document by itself changes no application behavior.
