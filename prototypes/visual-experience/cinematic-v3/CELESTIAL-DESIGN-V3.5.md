# Cinematic V3.5 — celestial design specification

Status: implemented prototype direction for critical review, pending owner artistic acceptance. The original V3 is recoverable at `9c8df82` on `codex/cinematic-experience-v3`. V3.5 extends it on `codex/cinematic-experience-v3-5`; the directory name remains stable to preserve existing tooling and references. No desktop host or production art direction is selected.

## The intelligent observatory

Scale comes from a constructed object extending beyond the window. Its cross section, curvature, rear structure, grazing light, and occlusion should establish a larger world. The foreground remains a calm workspace. Vela's recognizable double-loop ribbon supplies an orienting presence; the astronomical language does not turn resources into planets or simulate a spacecraft.

Living Intelligence is the organic expression of the same world: a dimensional violet surface with continuous autonomous flow and local resource footprints. Luminous Architecture is its engineered expression. They share lights, materials, resource poses, semantic state, and a single motion clock. Aetheric Observatory remains the third V3 study and is distinct from the new _Suspended Observatory_ architectural experiment.

## Composition and material rules

| Role              | Intended treatment                                                                           | Restraint                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Orbital shell     | Broad chamfered section, layered rear race, recessed galleries and connected radial supports | Directional light reveals faces; emission never outlines the complete ring  |
| Distant structure | Lower contrast, real depth separation and scene fog                                          | A few forms; no wallpaper of planets or dense stars                         |
| Living surface    | Smooth curvature, local displacement, fine flow contours and shared violet illumination      | Bounded disturbance; focus reduces emphasis                                 |
| Vela              | Continuous thin ribbon skin, pearl-like directional highlights, restrained optical variation | Preserve silhouette, strong autonomous movement and additive mouse response |
| Compact resource  | Type-specific physical backing, thickness/contact cues and selected lift                     | No identical-card mandate; folio, lens and note remain recognizable         |
| Reading surface   | Nearly opaque dark face, quiet highlights and stable text                                    | Legibility precedes optical spectacle                                       |
| Navigation        | Small precise typography, direct environment controls and keyboard focus                     | No random instrument readouts or decorative status claims                   |

The scene is SDR. Deep blacks and fine highlights are intentional, but important shell faces must remain discernible. HDR, OLED calibration and absence of banding are not claimed. Procedural geometry and local materials require no downloaded imagery or proprietary station assets.

## Three architectural experiments

All use actual Three.js geometry within the existing native renderer, with the same resources and camera. These are composition changes, not color variants.

1. **Monumental arc.** A much larger-radius orbital shell has its center farther outside the viewport. Only a broad, gently curving arc remains visible, extending beyond both the top and bottom edges as requested in the owner's subsequent review. A rear race and structural webs reveal thickness while the central workspace and right-side presence remain clear. This is the primary direction because it retains V3's strongest scale cue. The stable internal concept ID and evidence filenames remain `ring`.
2. **Celestial aperture.** A deeper opening and layered collimator establish a view through a monumental structure. Its risk is becoming a decorative portal or crossing the presence silhouette.
3. **Suspended observatory.** A dominant curved structure has a small set of distant supporting forms. Its risk is competing silhouettes and reduced hierarchy.

Actual experiments and failures are retained in `evidence-v3-5/`. The first ring's visible lower-left gap and overly dark section were identified in native captures and corrected in a later pass. The first field/presence pass also exposed aliasing on the ribbon crossing and reduced liquid contour definition; those findings guided refinement. Capture filenames alone do not establish artistic success; see the critical evaluation for the reviewed result.

## Motion and semantic contracts

`scene-transition.ts` registers environment weights on the existing `MotionCoordinator`. Changing studies retargets those channels without replacing the resource article, editor, canonical data, local messages, selection or scroll state. Weights remain nonnegative and normalized. Reduced motion reconciles immediately. Quiet and Ambient Off still permit an actual requested transition, then stop autonomous rendering. There is no second animation scheduler.

Architecture uses the same timebase for slow rotation around its own offscreen center and small changes of inclination. Rough inset panels and selected polished inlays catch the fixed key light and environment reflections as their actual normals move. A spatially varying optical veil quietly hides and reveals different regions of the arc before fog and tone mapping; it is a restrained procedural atmosphere approximation, not volumetric transport or fictional agent activity. Quiet, Ambient Off and reduced motion freeze the accumulated optical phase without resetting orientation. Focus slows and recedes that motion. Vela retains expressive visible autonomous precession, breathing and deformation; the pointer adds to that motion. Focus reduces the environment and places Vela in a separate working corridor. Resource-field response uses the current resource pose and type-dependent footprint, not a whole-screen flash.

State expression and relationship lines originate from local observed application actions or explicitly synthetic events. Scripted conversation, coding discussion, execution report, research notebook, long document and project overview are labeled fixtures. No model request or real agent execution is implied. The fixture validator checks recorded fixture provenance/order only.

## Architecture and cost

`orbital-architecture.ts` owns procedural structural geometry, the three compositions, tier visibility and diagnostics. It allocates geometry once and reuses it across scene/quality changes. Efficient retains the primary shell and depth hierarchy. `renderer.ts` owns scene projection, materials, Vela and resource backings; `main.ts` owns semantic state and the shared scheduler. The DOM remains the readable/editable interface. The renderer never becomes the authority for drafts or layout order.

Scene fades affect environmental geometry/materials only. Full-weight architecture writes depth; partial fades stop depth writes to avoid an invisible outgoing structure occluding the arriving environment. Material opacity derives from the shared coordinator. The steady-state GPU renders only the visible study. No render target crossfade or framework replacement was introduced.

Compact DOM resource faces now act as a quiet veil over confirmed opaque GPU faces. The research lens has a shallow curved physical front that flattens continuously as it unfolds; the folio uses a satin response and the note a warm matte response. This exposes type-specific material shading and reduces redundant bright rims. Reading faces become fully opaque through the existing unfold coordinate. Efficient mode and graphics fallback retain the complete opaque CSS backing. These are approximated optical materials, not volumetric refraction.

## Governance and review boundary

The governing registry was inspected on 2026-11-01. Constitution 00 is binding. Specialist charters 01/02/03/06/09/13/14/15/16 are published references pending owner acceptance, not newly ratified requirements. The deterministic router works; the V2 context CLI still reports `Cannot read properties of undefined (reading 'some')`. Direct authoritative source retrieval supplied the fallback. No governance files were changed.

The implementation addresses constitutional resource identity (AW-CON-018/026), coordinated motion (017/020/021), accessibility (015), truthful simulation and evidence (002/019/057–063/088), private local state (071), resource discipline (075–077), and regression protection (086/087). Native checks, capture review and performance receipts must substantiate the scoped prototype claims. Real backend viability, production security, complete assistive-technology qualification, multi-display behavior and owner artistic approval remain separate gates.
