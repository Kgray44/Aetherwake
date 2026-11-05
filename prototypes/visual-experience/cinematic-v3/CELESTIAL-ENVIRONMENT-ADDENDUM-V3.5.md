# Cinematic V3.5 — celestial environment refinement

Status: preserved celestial checkpoint `a01eb8a`, qualified locally with 43 source tests and 53 native checks. The owner positively reviewed this environment; subsequent [foreground integration work](FOREGROUND-INTEGRATION-V3.5.md) continues separately. No final whole-product artistic acceptance is claimed. Constitution 00 is binding; routed specialist charters remain advisory. No governance or production host decision is made here.

## Direction and retained checkpoints

The environment should communicate a vast celestial world containing the workspace. The enormous partial arc continues beyond the window, but the ring is darker metal, farther behind the resources and sufficiently constructed to imply monumental engineering. A spatially coherent deep-space backdrop replaces the empty black/purple canvas. Light reveals actual opaque surfaces as geometry slowly rotates; the former animated visibility veil is removed.

V3 remains on `codex/cinematic-experience-v3` at `9c8df82`. V3.5 checkpoint `877a6d2` preserves the larger arc and material work. `9388908` preserves the native-input overlap correction and passed 48 native checks. Their evidence under `evidence-v3-5/` is historical, not qualification of this later refinement.

## Three real depth regions

1. **Distant cosmos.** An origin-centered celestial camera copies the main camera's world orientation, FOV, aspect and zoom, while canceling translation. A deterministic 3D catalog has varied magnitudes, restrained stellar color temperatures and nonuniform galactic density. A procedural spherical dust field includes dark lanes and near-black tonal variation. Two GPU batches, no downloaded image, no DOM stars, no random twinkle and no independent scheduler.
2. **Monumental architecture.** Opaque curved shells, races and load-bearing members occupy actual middle distance. Architecture has its own scene, fixed lights, fog and PBR reflections so foreground studio lights do not flatten its shadows. Stars render first, then architectural coverage obscures them. No depth clear occurs between architecture and foreground.
3. **Interactive foreground.** Vela and physical resource backings retain their studio illumination; DOM text/editors remain canonical, readable and persistent. Existing overlap guarding makes intersecting text surfaces opaque. Focus reduces sky/architecture prominence, while Vela recedes into her working corridor.

Living Intelligence submits no celestial batches. Its violet liquid field and resource responses remain available. Architecture-specific flat purple atmosphere, floor, horizon and contour overlays were removed so they no longer conceal the astronomical backdrop. Architecture's CSS vignette is lighter; the other environments retain their prior treatment.

## Construction, lighting and motion

The primary radius is now 30 world units, about 40% larger than the preceding 21.5-radius candidate. Its center is outside the viewport at (-24, 1.4, -20), retaining the deeper placement and oblique angle. Dark graphite and titanium use differentiated metalness, satin roughness and restrained reflections. Static object-bound machining roughness is derivative-filtered against subpixel shimmer. No animated shader modifies ring opacity or outgoing light.

The model replaces the solid backing strip with four separated front/rear curved load spines and large curved shell modules. Enlarging the radius preserves module pitch through 52 structural bays, including 13 intentionally open service bays. Radial bulkheads and diagonal braces connect the roughly 3.36-unit radial section and 4.1-unit axial envelope. Recessed non-emissive conduits, a segmented inner flange and grouped attachments reveal purposeful construction. A raycast regression checks that service bays genuinely open through the shell while load spines remain continuous. Balanced's primary model remains 13 draw objects; that excludes shadows and foreground submissions.

The middle scene uses a fixed cool directional source, low hemisphere illumination and a fixed restrained graze. One directional shadow map is 1024² in Balanced and 2048² in Cinematic; Efficient disables it. Fixed lighting presets can be tuned independently of geometry. Actual orientation changes specular response and geometric shadowing. Natural time advances through the existing permitted visual clock; Quiet, Ambient Off and reduced motion freeze orientation without resetting it. Focus slows and dims environmental motion.

The physical rotation rate is 0.0024 radians per permitted second, 2.4 times the prior 0.001 rate. It remains a roughly 44-minute full rotation at full ambient strength, but individual structural bays visibly travel along the arc. Diagnostics distinguish natural accumulated rotation from held inspection phases. A new five-second no-input native check compares actual wall/visual/optical time and angular advance, rather than treating a still screenshot as motion evidence.

`setEnvironmentPhase(seconds|null)` is a native inspection hook, bounded to 0–3600 seconds. Held phase changes rendered orientation without overwriting natural time. Phase 0/30/60 screenshots are labeled orientation samples, not proof that real time elapsed. Ordinary use and recordings reset the override to null.

## Targeted studies

The celestial presets are independent from existing `ring`, `aperture` and `observatory` geometry concepts.

| Study | Treatment | Review purpose |
|---|---|---|
| A — Starlit Ring | Resolved stellar hierarchy, subtle galactic dust, moderate fixed illumination | Primary celestial composition and workspace hierarchy |
| B — Shadow Reveal | Fainter atmosphere and more oblique directional illumination | Structural details catching fixed light during rotation |
| C — Deep Observatory | Stronger atmosphere with a second real assembly | Additional spatial context against rendering cost |

Starlit is the default. Deep's extra structure has shown limited full-frame benefit so far; additional geometry cost is not itself evidence of improved depth.

## Capture-driven corrections

| Native pass | Finding | Action / status |
|---|---|---|
| [Iteration 1](evidence-celestial/iteration-1/exploration.json) | 4 functional checks passed, 18 captures, no renderer errors. Sky nearly invisible; ring evenly bright and rail-like. | Rejected artistically. Increased resolved stellar cores/dynamic range, removed purple overlays, darkened metal and moved the ring back. |
| [Iteration 2](evidence-celestial/iteration-2/exploration.json) | 4 functional checks passed, 18 captures, no renderer errors. Visible stars/galactic atmosphere; darker metal/depth better support foreground. | Owner explicitly liked the background improvement but identified the model as too simplistic. Sky retained; macro construction receives another pass. |
| [Iteration 3](evidence-celestial/iteration-3/exploration.json) | 4 functional checks passed, 18 captures, no renderer errors. Open bays, connected diagonals, paired spines and separate shell layers are visible in the native full view/crop. | Substantive construction improvement over the closed rail. Repeated trusses and smooth broad faces still reveal procedural origins; no photorealistic or emotional-impact pass is inferred. |
| [Detailed 21.5-radius checkpoint](evidence-celestial/review-final/verification.json) | `d3d1c8d`: 52/52 native checks and 36 measured scenarios, no renderer errors. | Preserved as a preceding checkpoint. The owner liked the new construction and requested still larger radius and faster, noticeable spin; this receipt does not qualify that later change. |
| [Larger-radius motion checkpoint](evidence-celestial/review-radius-motion/verification.json) | `a01eb8a`: 53/53 native checks and 36 measured scenarios, no renderer errors. | Five actual seconds without input advanced the geometry by 0.01204416 radians. Quiet produced zero draws and held optical time exactly. Radius 30 and the faster spin are qualified for this checkpoint. |

Full native images retain recorded dimensions and hashes. Detail images are labeled crops of those exact pixels, with source hash and crop rectangle; they are not enlarged offline renders. Held-phase screenshots and actual-clock recordings are distinct evidence. The [video manifest](evidence-celestial/native-video.json) binds two real native WebMs to source and independent decoding. Ambient recorded 30.0025 seconds of wall time and 0.07201704 radians (4.126°) of natural rotation. Its encoded packet timestamp span is 31.762 seconds; the difference is explicit and the video is not retimed. Reviewed [early](evidence-celestial/ambient-before.png) and [late](evidence-celestial/ambient-after.png) decoded frames show bay translation and Vela's independent pose change. The walkthrough adds scripted parallax, resource transformation, focus and return. Its pointer events are not physical-mouse latency evidence.

## Direct critical review

| Owner review question | Evidence-based assessment |
|---|---|
| Does the backdrop feel like deep space? | Yes, visibly stronger in [Starlit](evidence-celestial/review-final/celestial-A-starlit-ring.png): resolved faint stars, rare brighter anchors and diffuse dust replace featureless black. The owner positively reviewed this background direction in iteration 2. |
| Do stars establish believable astronomical scale? | The distant camera cancels translation and follows world orientation, while the ring remains at finite depth. The catalog is an original visual study, not a measured astronomical sky. |
| Does the ring look like a three-dimensional engineered structure? | The [native detail crop](evidence-celestial/review-final/celestial-starlit-structure-native-crop.png) now exposes connected braces, bulkhead faces, front/rear spines and open space between them. This materially improves the closed rail; regular repetition remains visible. |
| Is curvature clearly visible? | Yes: the partial 21.5-radius arc crosses both vertical display edges and sweeps left through the lower composition. Its whole circle and center remain outside the view. |
| Does it emerge naturally from darkness? | Real opaque surfaces rotate under fixed lights and cast geometric shadows. [Held phases](evidence-celestial/review-final/celestial-shadow-held-phase-60s.png) expose different structure without an opacity pulse. Actual-clock video review remains a separate requirement; held samples alone do not prove the full temporal effect. |
| Do materials look realistic? | Dark titanium/graphite and selective satin highlights read more plausibly than the prior bright gray rail. Smooth broad panels and simple beam cross-sections still limit close-view realism; photorealistic acceptance is not claimed. |
| Is composition more cinematic? | Starlit offers the strongest depth hierarchy: cosmic distance, dark architecture, then Vela/resources. Shadow is more restrained; Deep adds cost without equally strong full-frame benefit. |
| Does Vela belong? | Her pearl-violet silhouette remains the foreground presence against a quieter neutral/cool cosmos. Her existing expressive autonomy and additive pointer response are retained, rather than replaced by background animation. |
| Are resources practical? | The [focused conversation](evidence-celestial/review-final/celestial-A-starlit-ring-focused-work.png) remains opaque and readable, with peripheral resources and a separate Vela corridor. Native continuity/input checks and sustained reading comfort are distinct evidence. |
| Does it feel extraordinary rather than decorative? | The spatial construction and sky are a substantial change from the owner-reviewed empty background. Emotional impact and the desired exceptional material/art standard remain owner judgments; no automated functional check or self-awarded passing artistic score establishes them. |

These assessments do not rebind the historical 0–5 rubric to this new candidate or imply final owner acceptance.

## Measurement and boundaries

Renderer counters reset once per logical frame and include sky, middle scene, foreground and shadow submissions. Geometry estimates are separately labeled. Quality changes reuse preallocated geometry and stable stellar prefixes (24,000 / 14,000 / 6,500 configured stars). Hidden cosmos submits zero batches. The catalog is 768,000 bytes of CPU arrays, not total GPU memory or VRAM.

Source tests exercise deterministic distributions, camera behavior, no twinkle, reuse, disposal, finite structural normals, curved shell alignment, natural-clock pause/resume and held-phase isolation. Native checks exercise the real renderer, resources, continuity, quality, focus, context recovery and policy. Functional checks do not award artistic passes. Callback/draw intervals do not establish presented FPS; process working-set sums do not establish unique RAM or VRAM.

The pipeline is SDR. Calibrated display/HDR behavior, sustained comfort, energy/thermals, attributable VRAM, physical presentation timing and production acceptance require separate validation. Bounded local writers use separate 30 GiB reserve checks on C: and D:. ReserveGuard is monitoring rather than an OS quota and cannot constrain unrelated applications, cloud tasks or processes that did not load the instruction.
