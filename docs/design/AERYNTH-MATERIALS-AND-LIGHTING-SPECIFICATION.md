# Aerynth Materials and Lighting Specification
## Luminous glass, optical depth, and readable content

| Field | Value |
| --- | --- |
| Document ID | AML-001 |
| Version | 0.1.0, proposed design/engineering specification, 2026-11-13 |
| Status | **Proposed companion for review**, not an Apple implementation, not a new governance charter, not production acceptance |
| Focus | Functional glass, content surfaces, light, translucency, adaptive readability, rendering fallbacks, performance |
| Governing authority | [Constitution](../../governance/00-AETHERWAKE-CONSTITUTION.md); [02 Motion §§2,5,11–13,17](../../governance/02-LIQUID-INTELLIGENCE-AND-MOTION.md); [13 Platform](../../governance/13-PLATFORM-PERFORMANCE-AND-DISPLAYS.md); [14 Trust](../../governance/14-TRUST-PRIVACY-AND-AUTONOMY.md); [15 Quality](../../governance/15-QUALITY-VERIFICATION-AND-ACCEPTANCE.md) |
| Companions | [Interface Guidelines](AERYNTH-HUMAN-INTERFACE-GUIDELINES.md), [Motion](AERYNTH-MOTION-AND-INTERACTION-SPECIFICATION.md), [Engineering](../specifications/AERYNTH-DESIGN-ENGINEERING-SPECIFICATION.md) |

> **Luminous, not luminous everywhere.** Glass creates a readable functional plane over an extraordinary living environment. Richness and restraint are complementary, not competitors.

## 0. Apple-derived principles versus Aerynth invention

This is an **original Aerynth specification** informed by publicly documented Apple Liquid Glass principles, not an attempt to disclose or copy Apple's shader formulas. The public [Materials HIG](https://developer.apple.com/design/human-interface-guidelines/materials) explicitly differentiates the functional glass layer from content-layer surfaces. Apple's [Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass) emphasizes legibility, contextual adaptation, subdued tinting, concentric shapes, scroll-edge treatment, and moderation. The [Meet Liquid Glass WWDC25 session](https://developer.apple.com/videos/play/wwdc2025/219/) describes responsive lensing, reflection, depth changes and optical transitions.

What we adopt is **design reasoning**: translucent surfaces should be optically credible, respond to surrounding content, behave as connected functional objects, prioritize legibility and degrade gracefully for accessibility. What we invent is Aerynth's **Astral Glass** material vocabulary, spectral light behavior, numerical design-token candidates, shader architecture and measurements. Do not use Apple's name as an in-app material name or present this as Apple-certified.

The canonical Aerynth product remains a GPU-rendered 3D Vela Nebula with internally luminous veils and connected central-to-domain tendrils. Glass overlays do not substitute for or fake its volume. The [Presence rendering contract](../architecture/VELA-PRESENCE-GPU-RENDERING-CONTRACT.md) governs that scene.

## 1. Spatial and compositional layer ownership

| Order (back → front) | Surface | Purpose | Material rule |
| --- | --- | --- | --- |
| L0 | Universe environment | Real volumetric Vela Presence; constellation/spatial atmosphere; project backdrop | Distinct GPU scene, scene-specific materials and camera |
| L1 | Content plane | Editors, chat, data, charts, notes, Stream branch evidence | Opaque or subtly frosted surfaces; stable readable typography |
| L2 | Floating functional plane | Navigation, command bar, project dock, toolbars, action handles | Adaptive Astral Glass, limited blur/refraction, responsive highlight |
| L3 | Transient controls | Anchored menu, tooltips, context inspectors, drag previews | Elevated material with stronger backing and local separation |
| L4 | Attention/authority plane | Approvals, critical errors, destructive confirmation | Solid/high-contrast modal backing; decorative atmosphere muted |

**AML-001 — Layer invariant:** a content card is not automatically glass. An interactive control embedded in content may temporarily adopt a locally elevated glass treatment while active, then settle back. Do not put glass behind every paragraph, source trace, table cell, telemetry line or code token.

**AML-002 — Truth of elevation:** surface depth conveys actual functional order, not an arbitrary decorative z-index. A high-glow element must never appear to override a real approval dialog, focus ring or access boundary.

**AML-003 — Separate worlds:** environment lighting is visual context, never a source of semantic data truth, permission or backend state. Use event-based signals when an atmospheric highlight represents work.

## 2. Material taxonomy

| Material role | Visual intent | Typical surfaces | Readability rule |
| --- | --- | --- | --- |
| **Void** | Deep astronomical negative space | App canvas, Vela backdrop | Never relied on as text backing |
| **Instrument** | Calm opaque work surface | Code, chat, note, evidence, tables | Fixed readable foreground contrast |
| **Veil** | Soft layer separation | Passive side panes, content grouping | Higher opacity than functional lens if text is present |
| **Astral Glass / Clear** | Lightweight, thin floating control | Toolbar, dock item, bounded action chrome | Dynamic monochrome label and contrast backing |
| **Astral Glass / Elevated** | Thicker optical impression | Context menu, popover, dragged item | Stronger shadow, refraction hint and backing than Clear |
| **Astral Glass / Prominent** | One emphasized action | Primary action, explicit selected control | Restricted accent tint; neighboring actions stay neutral |
| **Shield** | Deliberate stable authority | Confirmation, credential UI, data-loss warning | Non-translucent/high-contrast safe alternative by default |

**AML-004:** Use no more than one primary tinted *functional* action per local command cluster by default; secondary semantic status may use a separate textual indicator. The brand palette can illuminate the environment without coloring every control.

**AML-005:** Clear/Elevated/Prominent are roles, not synonyms for increasing blur. Large glass panels gain perceived thickness mainly by stronger backing, broad scattering and shadow; they should not become unreadable merely because they occupy more area.

**AML-006:** Material tokens select application-owned assets and shaders only. Never import an unreviewed remote shader bundle or dynamically execute theme content.

## 3. Surface anatomy

A proposed Astral Glass surface is composed from the following *controllable*, **independently disableable** contributions:

1. **Backdrop carrier:** bounded sample of content/environment behind the functional plane, or a solid fallback.
2. **Adaptive body:** translucent neutral film with dynamic light/dark foreground mode; avoid permanent high-chroma coloring.
3. **Edge lens:** very subtle normal-based displacement near the rounded silhouette, not a full-screen distortion filter.
4. **Soft scatter:** low-frequency diffusion of nearby hue, subordinate to foreground contrast and content legibility.
5. **Rim and reflection:** thin edge-facing highlight corresponding to focus, pointer or local illumination.
6. **Elevation shadow:** physically plausible contact separation and a broader ambient shadow proportional to state.
7. **Interaction deformation:** short-lived geometry/normal shift for hover, drag and morph; driven by the Motion Coordinator, not autonomous material timers.
8. **Protection scrim:** adaptive foreground-underlay or opaque/contrast mode that prevents text and icons blending into the backdrop.

Layer contributions remain separable so ARIE can shed expensive passes without destroying the visual grammar.

### Proposed optic order

For a pixel p within the glass mask, a physically *inspired* but not strictly physical prototype may compute:

~~~text
n(p)       = bounded approximate surface normal near the rounded rim
uv_sample  = clamp(uv(p) + distortionStrength * n.xy, safeBackdropBounds)
background = sampleAvailableBackdrop(uv_sample)  // or a safe solid fallback
body       = mix(background, neutralFilmColor, adaptiveBodyOpacity)
lit        = body + boundedRimLight + boundedNearbyHueContribution
result     = applyContrastGuard(lit, foregroundTextAndIcons)
~~~

Never present this as Apple's implementation. Edge distortion must be clamped to avoid sampling private pixels outside the intended compositor scope or adjacent native windows. The readable foreground is composited on top, never distorted.

## 4. Candidate design tokens: starting values, not standards

All numbers below are **Aerynth engineering hypotheses pending visual evaluation and packaged-Windows benchmarking**. The component system must use tokens rather than magical inline constants.

| Token | Candidate | Meaning / limitation |
| --- | --- | --- |
| glass.clear.blurRadius | 8 CSS px | Small bounded chrome region; skip if costly |
| glass.elevated.blurRadius | 14 CSS px | Popover, before adaptive override |
| glass.clear.bodyOpacity | 0.20–0.42 | Neutral film over light/dark backdrops |
| glass.elevated.bodyOpacity | 0.46–0.78 | Menus and information-heavy overlays |
| glass.refraction.displacement | 0–1.5 *physical px* | Very small bounded edge warp; disabled in low tier |
| glass.rim.thickness | 1 physical px nominal | DPR-aware stroke, not blurry text halo |
| glass.rim.intensity | 0–0.16 normalized | No auto-flashing or white clipping |
| glass.shadow.softness | 12–28 CSS px | Compositor-tested, state-based |
| glass.corner.control | 12 CSS px | Hierarchy-aware concentric shape |
| glass.corner.overlay | 20 CSS px | Adjust to overlay size and contents |
| glass.backing.maxChroma | Low by default | Maintain monochrome chrome over colorful scene |
| glass.scrim.threshold | Derived by contrast test, not single global alpha | Must vary by background and accessible mode |
| bloom.maxOnText | Zero | Never smear text, caret, code or focus ring |

Token value type records unit: CSS px vs device px vs normalized luminance. No undocumented unit mixing. Test physical-DPI rounding at mixed-scale monitors.

### Token schema sketch

~~~ts
type SurfaceRole = "void" | "instrument" | "veil" |
  "glass-clear" | "glass-elevated" | "glass-prominent" | "shield";

type Appearance = "dark" | "light" | "high-contrast";
type MaterialQuality = "cinematic" | "balanced" | "efficient" |
  "gaming" | "battery" | "accessible";

interface MaterialRequest {
  surfaceId: string;
  role: SurfaceRole;
  appearance: Appearance;
  quality: MaterialQuality;
  focused: boolean;
  interactive: boolean;
  reducedTransparency: boolean;
  backgroundSamplingPermitted: boolean;
  inputMode: "pointer" | "touch" | "keyboard" | "voice";
}
~~~

This is an **illustrative design contract**. Map onto existing repository conventions after examining the live renderer and its typed public interfaces; do not introduce a parallel material engine by copying this literal interface.

## 5. Light architecture and color

The approved Aerynth mark and Vela Presence art remain the brand authorities: deep indigo, luminous cyan/blue, soft violet, pearl, and restrained near-black negative space. See [Brand Identity](AERYNTH-BRAND-IDENTITY.md) and [Vela art direction](VELA-PRESENCE-INTELLIGENCE-NEBULA-ART-DIRECTION.md). Material tokens are **semantic**, with separate dark, light, reduced-transparency and high-contrast variants. Material tint comes from a controlled palette and nearby *approved* scene illumination, not arbitrary sampled secret content.

### Semantic light sources

- **Ambient field:** very low-level global illumination to define placement, not a flashing wallpaper.
- **Directional grazing light:** highlights curves and layer edges as the camera changes.
- **Nearby scene spill:** subtle, spatially localized spectral reflected color onto chrome, with maximum saturation and luminance clamps.
- **Interaction glint:** instant but bounded response to focus/hover/drag; must settle.
- **Event accent:** a source-attributed task event may influence nearby light within an authenticated/authorized view. This is not synthetic reasoning.
- **Legibility compensator:** neutralizes local scene interference underneath labels; may override aesthetics immediately.

**AML-007:** Establish material light in linear color space, then use defined display transfer/tone mapping. Avoid naive operations on gamma-encoded RGB for lighting. Do not assume all monitors are HDR; produce acceptable sRGB SDR by default and explicitly test wide-gamut/HDR if supported.

**AML-008:** No decorative specular highlight may change the semantic meaning of a button or resemble a progress completion unless driven by a real event.

**AML-009:** Content-owner boundaries apply to reflection/sampling. Cross-window or sensitive surface sampling requires deliberate compositor security review; if unsupported or risky, use a neutral synthetic backdrop instead.

## 6. Adaptive contrast and backdrop response

Apple's public design guidance shows transparent controls adapting to their surroundings; for Aerynth, the goal is not one-time alpha selection but **continuous verified readability**.

### Contrast guard proposal

1. Identify each text/icon region and its foreground semantic role.
2. Evaluate the effective backdrop **after** glass, scrim, overlay, bloom and tone mapping, across the entire region and representative scroll/camera states.
3. Compare calculated contrast against chosen accessibility targets: as an engineering starting point, use WCAG-style 4.5:1 for ordinary text, 3:1 for large text and essential non-text boundaries where applicable; accessibility/release owners must ratify the exact policy and exceptions.
4. Increase neutral film/opaque backing or adjust foreground palette before increasing glow; in high-contrast mode use direct solid surfaces and explicit borders.
5. Hysteresis and temporal smoothing avoid rapid light-dark flipping due to animated particles; however an actual readability failure overrides smoothing immediately.
6. Test p5/p95 luminance zones, high-frequency texture, bright star crossing behind controls, colorful content scrolling behind chrome and OLED-dark scenes. **Average luminance alone is insufficient.**

**AML-010:** Important text, cursor, focus ring, controls, and approvals always remain readable. If the renderer cannot measure or guarantee legibility, choose a stronger opaque backing rather than guessing.

**AML-011:** A resting control has stable contrast on a resting scene. Do not rely on hover to reveal that an action exists.

**AML-012:** Scroll-edge treatment is local: introduce gradient-backed separation only where content intersects fixed chrome, avoiding generic full-canvas haze.

**AML-013:** Refractive effects must never distort text or click targets. The graphical silhouette may flex, but interaction geometry and hit testing must remain accurate.

## 7. Interaction-state material behavior

| State | Optical behavior | Safety / semantic boundary |
| --- | --- | --- |
| Rest | Thin quiet surface, low tint | All labels visible; controls discoverable |
| Hover | Small rim/film change, gentle local light concentration | No focus theft, no semantic selection |
| Keyboard focus | Strong explicit ring + restrained local highlight | Ring survives high contrast and scene motion |
| Press | Fast inward light and surface compression | Action dispatched by typed command; release may cancel |
| Drag | Elevated shadow, stronger backing, clear drop target | Data/source identity stable; no premature mutation |
| Open menu | Morph/lift from anchor with heavier material | Menu focus managed; no unclickable transition |
| Disabled | Reduced chroma/contrast without hiding label | Reason available; disabled state semantic, not opacity-only |
| Busy | Quiet sourced feedback with text state | No fake percentage or hallucinated progress |
| Error | High-contrast semantic signal, readable text | Recovery action prioritized over animation |
| Approval | Shield surface and visible scope | No glass sparkle grants execution |

Material changes are driven by the six-system Motion Coordinator; they cannot launch their own conflicting render loops. Direct keyboard focus and approval readability take priority over all other effects.

## 8. Concentric curvature and shape identity

- Parent corner radius = outer visible radius.
- Child corner radius is geometrically adjusted for the inset rather than assigned a completely unrelated shape. Prototype model: childRadius = max(minRadius, parentRadius - inset), verified visually.
- Consistent optical padding ensures rounded corners do not crowd content or truncate labels.
- Morphing controls preserve silhouette continuity when possible. An expanded panel becomes optically thicker and gains backing; its event state remains untouched.
- Size changes adjust lens intensity, rim sampling radius and shadow spread; do not scale a shader artifact to infinity.

The concentric principle is informed by public Apple design guidance but these actual radii and geometric rules are **Aerynth's own proposals**.

## 9. Efficiency and renderer independence

The existing connected app includes Electron/TypeScript/Vite/Three.js; use the compositor that best serves measured outcomes. There is no blanket authorization to replace the desktop host or mandate WebGPU without the comparative architecture work required by Charter 13.

### Cost discipline

- Prefer one bounded backdrop source per shared glass plane, amortized across children, rather than each child re-rendering the entire scene.
- Where a blur is needed, cache stable layers and use reduced-resolution separable kernels when visual tests permit; avoid repeated CPU readbacks and forced synchronous layout.
- Use clips/scissors/dirty rectangles and preallocated GPU resources; respect DPR and window exposure changes.
- Prefer instancing/batching for environment effects; do not create hundreds of DOM blur elements or per-frame application-state rerenders.
- Compile shaders outside the critical interaction path where possible; test cold-start and first-interaction shader costs separately.
- Dispose textures/targets on detach, resize, context loss and view shutdown; avoid memory pressure from cached full-resolution backdrops.
- Do not assume CSS backdrop-filter or postprocessing is faster: compare in the packaged Windows runtime on actual supported graphics paths.
- Render control text at native resolution **after** effect passes. Preserve antialiasing, caret geometry and subpixel legibility where possible.

### Quality-tier material contract

| Tier | Keep | First effects to reduce |
| --- | --- | --- |
| Cinematic | Full approved Astral Glass, active accessible controls | None unless resources exceeded |
| Balanced | Layering, lens hint, clear hierarchy | Secondary blur resolution, gratuitous glow |
| Efficient | Distinct foreground controls, rim, shadow, backing | Refraction and broad diffusion |
| Gaming | Readable functional shells, event truth, inputs | Background glass motion, offscreen blur, expensive sampling |
| Battery | Stable hierarchy, crisp text, direct focus | Continuous optical updates, secondary effects |
| Reduced motion | Geometry and legibility | Elastic material motion and environment camera effects |
| Reduced transparency / high contrast | Strong border and stable backing | Translucency/refraction entirely |

ARIE owns resource and quality governance, coordinated with the existing Performance Governor. AEP owns measurement and validated experiments; neither may silently degrade remote reasoning capability to "pay" for rendering.

## 10. GPU/host safety and fallback

**AML-014:** Treat custom shaders and themes as code/data subject to trust policy, validation, controlled origins and strict resource limits.

**AML-015:** On GPU/context loss, rapidly reconstitute a solid-interface path; retain drafts and canonical backend event state. No user edit is dependent on a pixel shader completing.

**AML-016:** Minimized/background/occluded windows should suspend unnecessary lens/ambient rendering independently of source event collection.

**AML-017:** Prevent glow/flares and reflections from making credentials, tokens, private text or other windows newly visible in captures, logs or previews.

**AML-018:** For a blocked or untrusted compositor surface, prefer deterministic solid fallback with a recorded limitation. Never fake a real optical sample from pixels that cannot legitimately be accessed.

## 11. Required prototype and review matrix

| Case | Scene | Evidence expected |
| --- | --- | --- |
| AML-T01 | Clear dock over busy 3D blue/violet nebula | Foreground contrast, screenshot/video of motion, measured GPU cost |
| AML-T02 | Code/editor under floating toolbar | Caret, syntax, selection and text remain crisp at multiple zoom levels |
| AML-T03 | Scrolling colored content under fixed chrome | Stable readability, scroll-edge guard, no light/dark flicker |
| AML-T04 | Action button morphs into popover | Shape, blur, shadow, focus, hit target and source anchor remain correct |
| AML-T05 | OLED-dark and bright high-key backgrounds | No blown highlights, clipping or insufficient visibility |
| AML-T06 | Multi-window and mixed-DPI resize | Correct clipping, compositor lifecycle, no text ghosts |
| AML-T07 | Tier changes under GPU contention | Same controls, safe materials, no oscillation; frame distributions measured |
| AML-T08 | Reduced transparency and high contrast | Opaque equivalent, visible boundaries and focus |
| AML-T09 | GPU reset and restoration | Source data/drafts preserved; safe solid fallback appears |
| AML-T10 | Large active sheet / destructive approval | Shield-backed readability; permission semantics unchanged |
| AML-T11 | Split content and command plane | Content is not made uniformly glass; depth order demonstrable |
| AML-T12 | Screen reader + static mode | Actions and status usable without optical comprehension |

Record source SHA, renderer/driver, GPU, OS, display/DPR/HDR mode, appearance/accessibility, frame-time median/p95/p99, CPU/GPU/memory attribution where measurable, cold shader-compile cost, 1%-low animation smoothness, exact captured frames, known blind spots and owner visual-review decision. A *design* proposal is not a performance pass; a visual sample is not native verification.

## 12. Failure and anti-pattern catalog

Reject: glass behind every text block; translucent destructive approvals; opaque text inside a refracted layer; glowing separators everywhere; 3D Vela replaced with a blurred 2D image; nonfunctional bright status; constant hue pulsing; app-wide backdrop filtering; accessibility implemented by simply removing all meaning; arbitrary large shadow stacks; edge warping across unrelated native windows; per-element WebGL context creation; third-party asset copying without authorization.

## 13. Traceability and public references

| Requirement family | Existing authority |
| --- | --- |
| Materials, depth, optics, contrast | AW-LIQ-034–042; AW-LIQ-099–105 |
| Performance/visual tiers | AW-LIQ-089–094; AW-PLT-017–025, 035–053 |
| Real spatial environment | AW-LIQ-200–225; [GPU rendering contract](../architecture/VELA-PRESENCE-GPU-RENDERING-CONTRACT.md) |
| Truthful state and trust | AW-LIQ-106–114; [Charter 14](../../governance/14-TRUST-PRIVACY-AND-AUTONOMY.md) |
| Human visual acceptance | AW-QVA-028–035, 093, 102–108 |

Apple public research:
- [Human Interface Guidelines: Materials](https://developer.apple.com/design/human-interface-guidelines/materials)
- [Human Interface Guidelines: Color](https://developer.apple.com/design/human-interface-guidelines/color)
- [Liquid Glass technology overview](https://developer.apple.com/documentation/technologyoverviews/liquid-glass)
- [Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass)
- [Meet Liquid Glass, WWDC25](https://developer.apple.com/videos/play/wwdc2025/219/)
- [Get to know the new design system, WWDC25](https://developer.apple.com/videos/play/wwdc2025/356/)

**Design approval still required:** choose material reference captures and evaluate actual material constants on physical Windows hardware. Do not treat any Apple API names as implementation instructions for Electron/Windows.
