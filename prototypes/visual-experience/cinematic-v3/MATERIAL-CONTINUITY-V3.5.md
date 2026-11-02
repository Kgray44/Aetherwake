# Optical material continuity correction

Status: source correction implemented; comprehensive native continuity, scale and motion qualification is in progress. The first three post-correction native diagnostic captures report no renderer errors. This is not final owner artistic acceptance.

## Confirmed causes

The native baseline reproduces `physical` GPU material mode while an intersecting projected AABB changes both cards' DOM backgrounds from translucent RGBA to fully opaque RGB. This covers the rendered coating without disabling it. The existing overlap helper is conservative and also treats empty lens corners as occupied. Independent DOM selected/dragging z overrides and per-component GPU render orders do not describe one coherent whole-resource stack. The note additionally used a rough, flat substrate, and boolean selection changed perimeter reflection abruptly. Those mechanisms compound the perceived material change; it was not a graphics-loss fallback.

The source correction replaces overlap-to-opacity with projected front-silhouette subtraction from rear DOM paint and hit regions. The front optical coating remains exposed; its GPU substrate stays opaque. Disjoint convex differences form a union of visible regions, avoiding the XOR defect of overlapping holes. The derived compositor consumes current Motion Coordinator poses and engine presentation. It owns no canonical placement, content or resource state. Stable numeric layer/BINARY-ID ordering is shared by DOM and GPU; desktop selection/dragging does not silently raise a persistent block. Focus is a temporary representation overlay.

One contour contract covers rectangle, rounded, circle, pill, folio and lens presentations, including planar rotation separately from 3D yaw. GPU buffers remain pooled. Canonical type controls material variation; shape controls geometry. Per-resource painter ordering keeps every optical layer with its own substrate, without full-resolution resource render targets. Surface normals, camera, material roughness and the preserved shared stellar key still govern highlights.

The note retains restrained optical camber and a smoother coat at rest. Selection enhances the same material continuously through the existing interpolated lift. It does not replace the material or activate glass. Focused reading protects its central content region; a small header backing keeps controls readable over a bright specular patch. Efficient and graphics-loss modes retain deliberate opaque CSS fallbacks.

Optical unfolding now has a semantic channel on the existing Motion Coordinator. Card height no longer masquerades as reading progress during resizing. Interruption, reversal and reduced-motion reconciliation use the same coordinator. Global workspace-arrival scale/origin is projected consistently into DOM clipping and GPU geometry; focus has a temporary representation rank above arbitrary canonical layers. The obsolete overlap-to-opaque helper and its policy tests are replaced by silhouette, material continuity and semantic-motion regressions.

An optional application-owned `SpatialRenderLayer` shares the existing renderer/context and frame scheduler between the background and foreground. The hook restores host render target, viewport, scissor and clear state, contains layer failure and forwards context lifecycle notifications. Layer lifetime stays with the application across renderer recovery. This hook does not claim that the expanded 3D Constellation implementation is qualified.

The logo's original master PNG is unchanged. A small SVG alpha filter removes its black raster background at display time, allowing the existing artwork to sit directly over the scene. The preceding blend-only attempt was insufficient in the header stacking context and is not reported as the delivered fix.

The renderer also accepts an optional engine-owned Vela screen envelope and a separate scale. The application integration workstream owns persistent placement, collision resolution, drag/keyboard controls and undo. The rendering hook preserves sculptural geometry and ambient motion and supports the requested 65% resting application presence.

## Acceptance work still required

- Native separated/unselected, selected conversation/lens/note, minor/quarter/major/complete overlap, three-card overlap and exposure of rear regions.
- Continuous native pointer drag across another resource, selection during overlap, resize into overlap, focused-work interruption/reversal/return and both environments.
- Repeated material/geometry identity, deterministic stacking/hit testing, opaque focused reading, graphics-loss recovery, quality tiers and reduced-motion checks.
- Native 3/10/25-block rendering and separately labeled compositor CPU measurements; callback/submission timing must not be presented as monitor FPS.
- Exact-window continuous video, independent decode, native screenshot critique and source/build-bound receipts. Sparse stills and shader tests cannot establish visual success.
- Reconciliation with Application Integration's canonical dynamic placement/presence state and its functional regression journey.

Earlier V3/V3.5 evidence and failed diagnostic runs remain preserved. The first in-repository private-profile attempts failed the backend's protected-storage check; the valid review uses a fresh synthetic profile outside the source tree. A subsequent inherited native shutdown exception was fixed by Application Integration's guarded lifecycle helper before later native launches. No saved owner data was reset.

ReserveGuard admissions preserve separate 30 GiB reserves on C: and D:. This is a monitoring rule, not an OS quota; unrelated applications, cloud writers and already-running processes without the rule remain outside its coverage.
