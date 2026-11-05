# Motion and Vela implementation

## Identity and state ownership

`store.ts` owns three canonical resources and the typed synthetic lifecycle. Layout stores only IDs, not duplicate resources. The same article, title, textarea, local draft and ID remain throughout expansion/collapse. LocalStorage validation rejects unknown/duplicate IDs, malformed drafts and drafts above 100,000 characters. Rendering cannot authorize actions or complete tasks.

`MotionCoordinator` owns visual bodies, scalar target/value/velocity channels, transition identities and bounded receipts. It advances the exact critically damped spring solution using elapsed seconds, with a bounded long-frame step. Retargeting preserves position and velocity; cancellation creates a separate recovery identity; reduced motion reconciles directly. Semantic targets are updated synchronously before any animation. No interaction waits for animation completion.

## Six disciplines

| Domain | Concrete implementation |
|---|---|
| Spatial | Shared persistent body geometry drives position, size, depth and yaw; neighbors yield during drag; viewport changes retarget; interrupted expansion reverses from its current pose |
| Material | The same elevation drives edge/shadow thickness, selected backing and orientation; pointer position drives a restrained directional highlight; expanded reading material becomes clear and opaque |
| Atmospheric | The same selected-resource location, focus and semantic attention feed field shaders, camera restraint, Vela retreat and environmental illumination |
| Semantic | One typed synthetic sequence drives text labels, Vela expression, recorded stream events and the relationship path. Started, reported result, fixture check, cancelled and unavailable are distinct |
| Interaction | Immediate title selection, grip capture, destination disclosure, cancellation, keyboard reordering, local draft input, undo and focus return |
| Performance | Shared tier/ambient/reduced/quiet/visibility policy controls cadence, DPR, LOD, optional architecture and lines. After twelve seconds, visible idle continues at a lower cadence; Quiet/reduced/unavailable or explicit ambient-off stills it. Minimize stops rendering; ordinary mode also pauses on blur. |

The coordinator's monotonic clock is passed into the GPU renderer. There are no independent CSS animation loops. Small focus/semantic scalars reconcile centrally. The event sequence uses a separate semantic timer, so minimizing does not falsely complete or cancel work; browser timer throttling may delay fixture events, and the UI records their actual emission timestamps.

## Vela's identity and states

Vela is a procedural folded double-loop ribbon, distinct from the Aerynth mark. Its shader computes surface normals, selective pearl reflection, rim light and state-dependent energy while preserving its silhouette. Two negative spaces and a real depth-separated crossing establish continuity. A single broad surface avoids the earlier companion's slivers. Closed endpoints match position/twist to avoid loose shards.

Expressive ambience is independent of semantic execution energy: yaw ±0.18rad, pitch ±0.08rad, roll ±0.05rad, roughly3% breathing/10% width flow, and a restrained hover. Periods span approximately9–13 seconds. Pointer parallax is additive. The user can choose Subtle, turn ambience off, or use Quiet/reduced motion. Focus softens the amplitude. A monotonic visual clock advances only while scheduled, so hidden pauses do not jump the phase on return. Default visible-idle targets are60/30/12 submissions per second for Cinematic/Balanced/Efficient; they are scheduler targets, not presented FPS.

Renderer expression channels preserve that same ribbon: receiving opens the loops; working adds structural tension and directed fold flow; coordinating opens both lobes with restrained flow; attention holds a more upright fold; reported completion remains gently gathered; a verified fixture check produces one brief release and then settles. These are presentation states, not cognitive or progress measurements. The optional `inputPointer` frame field keeps actual mouse parallax separate from the shared semantic/resource `pointer`; optional `interaction` supplies local drag/selection salience. The selected resource's current pose projects into the same scene to orient Vela, bias shared illumination, and create a localized field response. Its unfolding also reduces reading-surface reflectivity. Vela's pearl response now shares the scene-light direction with the physical folio materials; optical depth remains an efficient shading approximation rather than volumetric glass. These refinements require refreshed native motion review before an experiential verdict.

| State | Visual/text behavior and truth boundary |
|---|---|
| Idle | Quiet violet with a clearly visible independent precession, breathing and ribbon flow; lower cadence after idle settlement |
| Receiving | Gentle directed energy; the label says typed input, with no microphone implication |
| Working | More organized deformation/light; always labeled synthetic |
| Coordinating | Same underlying shape; fixture event produces a source-to-resource link |
| Attention required | Restrained warm material accent plus explicit text |
| Reported | Text explicitly says unverified; no verified-completion claim |
| Verified | Pale restrained response says fixture sequence check passed; the event explains that no agent work or design was validated |
| Unavailable | Desaturated static presence and explicit label; no endless thinking animation |

Vela is addressable in the scene or via Alt+V. The input surface emerges near her location rather than occupying a permanent sidebar. On document focus she recedes. Closing her surface preserves reachability. All expressions are studies; no AI is running.

## Lifecycle and failure

Minimized/hidden surfaces cancel scheduling and reconcile visual targets. Ordinary mode also pauses on blur. The isolated preview/verification/recording profiles intentionally keep visible rendering independent of desktop focus. Native minimize/hide notifications explicitly suspend the renderer; lab DOM focus events cannot override that state. Stationary-pointer synthetic layout events do not count as user activity. On return, authoritative local resources remain. Real forced WebGL loss leaves the DOM working; restoration disposes the old scene/listeners and constructs a new GPU renderer without reloading the page or losing typed inputs. Context-loss test hooks expose no native privileges.

The preload exposes host activity notifications and one read-only visible-review policy flag. The renderer has no Node/FS/process API. The shell denies ordinary permission requests, remote network requests, navigation, popups and webviews. Only explicit `--record` permits one video-only display-capture request from the exact local main frame, mapped to its exact BrowserWindow source; there is no screen/other-window fallback. That permission and handler are revoked after the bounded recording. CSP disallows remote scripts/connections. Text and events use textContent/value rather than inserting user strings as markup.

## Deliberate limits

There is one native main window. Cross-window identity, detach, mixed DPI topology recovery and freeform arbitrary layouts are not implemented. Three representative resources are sufficient for this visual experiment, not a scalability test. No inaccessible private reasoning, actual agents, model response, live token metrics or background desktop monitoring are displayed. Quiet mode is manual for GPU-intensive work; no game detection or attributable GPU pressure sensor is connected.


## Focused work and native frame

`scene-state.ts` derives the observable scene mode, active resource/relationship anchor, interaction salience and permitted ambient gain from the workspace, visibility and motion settings. DOM focus/labels and GPU surfaces consume the same current resource poses. The real pointer is separate from the semantic anchor, preserving parallax during selection and drag. Focus dims atmospheric activity while a persistent resource becomes an opaque working plane; horizontal peripheral anchors preserve their role and keyboard access. No duplicate resource replaces the original article.

`conversation.ts` keeps a labeled scripted opening exchange separate from real locally authored messages and the unsent composer. User text is inserted as text, never HTML. Saved history is bounded to 50 messages / 200,000 characters with validated IDs/timestamps; local writes precede clearing the draft. The scene has no message-generation backend. Resource switching retains the same scroll container and editor.

The Windows frame uses native caption controls via the supported overlay. A 42 px dark drag region is separate from application buttons. No new privileged window-control IPC or custom maximize implementation was added. Logical content zoom and native maximize/restore are exercised; physical multi-monitor/DPI and Windows Snap acceptance are not established by those tests.
