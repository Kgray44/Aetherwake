# Constellation verification and integration handoff

## Current 3D follow-up

The current source adds a real perspective scene in the host's existing graphics context, persistent XYZ positions/pins/orbit cameras, typed graph operations, neighborhood traversal, reversible arrangements, app-level branch previews and deterministic procedural planets/moons. Strict TypeScript and all **46** navigation/spatial tests pass. Regressions include manual camera interruption during awaited navigation, continuous wheel scope transitions, spring-driven body emphasis, geometry/detail LOD, bounded 10,000-object allocations, graph mutation routing, label discoverability, and host renderer-state restoration. Graph metadata is cached between canonical refreshes; regressions verify that provenance edits and revocations invalidate it, and distance-culled resources remain searchable and become visible when fitted.

The additive task-group projection follows authorized explicit `contains_task` links between `task_group` and `task` resources with available placements in the same workspace. A unique group placement becomes the visual parent; ambiguous memberships retain the workspace parent and all real typed edges. Real `workspace_placement` edges still refer to the canonical workspace, independently of that presentation hierarchy. Existing IDs, XYZ and pins survive membership changes; unpinned members follow a moved group. Focused tests cover shared placements, ambiguity, hidden/unavailable/inferred links, coherent movement and the accessible non-3D view. The integration lead owns canonical group creation/membership commands and their native acceptance; these source tests do not establish that backend/UI integration.

The integration lead's native candidate `1843b6c` includes planet appearance `cced68a` and label/renderer fixes `74b1256`. Its real-window baseline and restart passed project round trips, exact original geometry/content, new-workspace discovery/archive, reduced-motion interruption and actual WebGL loss/recovery. I inspected its `03-universe.png` and `04-other-project.png`; real planet surfaces, rings and moons are present. The receipt is local at `cinematic-v3/.runtime/application-evidence/constellation-1793580264450` in the integration checkout. It predates the motion/LOD/ice-palette follow-up, so it does not verify those later changes.

The expanded three-project native journey, pin/branch/typed relationship persistence and actual rendered scale measurements remain with the integration lead. No current unit test or baseline screenshot establishes presented-frame smoothness, sustained GPU cost or final artistic acceptance. The older committed fixture evidence below remains bound to its original, earlier navigation source.

`tests/integrated-native.cjs` supplies the expanded journey to the existing desktop host under an explicit `--integration-expanded` mode. It creates three named projects, six workspaces and 32 real typed resources through actual UI controls, including a canonical local task group with two member tasks and a real member-status edit. It exercises native orbit/pan/Alt-drag, reviewed local continuation, position/pin, typed relationship inspection, overview Vela placement, saved workspace presence, real editor changes and exact workspace return; and saves expected canonical/private view state for a separate `--verify-restore` process. It requires the integrated host's task-group contract, source/build hashes, at most two existing 60-second recording segments and 12 bounded screenshots, and never launches a window itself. A syntax check is not an executed native acceptance result. The integration lead owns the entry point, profile, recording permission and run coordination.

## Earlier fixture evidence

Status: implemented and locally demonstrated as a navigation subsystem. The integration lead owns the combined application's V3.5 scene, stage transition, Vela, canonical service, native host, and final application acceptance. Local evidence is not owner artistic acceptance or a release qualification.

## Executed checks

| Check                                                         | Result / evidence                                                                                                    |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Canonical navigation, persistence, camera, filtering, density | 19 passing tests in `tests/navigation.test.mjs`                                                                      |
| Strict TypeScript                                             | `tsc -p prototypes/constellation/tsconfig.json` passed                                                               |
| Synthetic fixture production build                            | Vite production build passed, no added runtime dependency                                                            |
| Native fixture journey                                        | `evidence/native-verification.json`, five synthetic screenshots, source and capture hashes                           |
| Larger dataset CPU measurement                                | `evidence/cpu-benchmark.json`: 50 projects, 500 workspaces, 10,000 resources, 30,000 edges; 30 iterations            |
| Governance routing baseline                                   | registry valid; 38 router/context tests pass; source-context benchmark passed; strict retrieval coverage gate passed |

The native journey begins in Development in A World for Two, zooms out to project and Universe, approaches Voyagewright, opens Engineering using keyboard Enter, edits a real note through the resource kernel, returns to the unchanged Development layout, uses search Enter for direct navigation, exercises reduced motion and graphics fallback policy, and restarts **both renderer and canonical service process**. Camera, block geometry/identities, and the saved edit survive. `Airbrush Disc System` is also seeded with two workspaces and different layouts.

The native fixture initially used ordinary hidden-window capture, which produced stale compositor images despite passing state assertions. That capture method was replaced with Electron offscreen composition; the committed captures reflect fresh compositor output. No presented-frame, foreground latency, power, or GPU conclusion is drawn from this harness.

The CPU benchmark reports median/p95/p99 sample distributions. Its camera/culling figure is the distribution of per-iteration averages across 120 CPU steps, not individual presented frame percentiles. It does not measure the V3.5 environment, full application performance, OS utilization, GPU memory, or host comparisons.

## Scenario coverage

| Requested behavior                                                     | Evidence                                                                                                                       |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Zero/one/multiple projects, standalone workspaces, multiple workspaces | fixture + first controller test                                                                                                |
| Direct and spatial navigation, four levels, real block interaction     | canonical journey + native workflow + `surface` target test                                                                    |
| Zoom reversal, interrupted motion, stable orientation                  | velocity-preserving retarget/interrupt test; no rotation                                                                       |
| History and return                                                     | canonical journey + saved view history, up to 32 entries                                                                       |
| Durable camera, project/workspace positions, layouts                   | process restart, pin/bookmark test, canonical block comparison                                                                 |
| Resource identity preservation                                         | same canonical resource IDs, stable block IDs, real kernel note edit                                                           |
| Keyboard and reduced motion                                            | native Enter spatial/search paths + all-tier reduced/Quiet/hidden tests                                                        |
| Quality modes and dense scenes                                         | proxy caps, large-data test, label rectangle separation at five zoom scales                                                    |
| Unknown/unavailable resources and provider failure                     | rejected-target/editor preflight, failed navigation leaves history/location intact                                             |
| Visibility and permission projection                                   | hidden projects/workspaces/resources pruned from search/history/bookmarks; revoked anchors excluded **before** cell allocation |
| Out-of-order requests                                                  | serialized async navigation, latest canonical destination wins                                                                 |
| Graphics fallback/recovery                                             | policy injection preserves selection, camera and navigation; native fallback test                                              |
| Failed/corrupt persistence                                             | malformed-camera rejection, corrupt restore recovery, visible save failure                                                     |

## Governing trace

The established Constitution controls these implementation boundaries: AW-CON-004 (service/render separation), 015 (accessible alternatives), 017–021 (shared motion, visual continuity), 026/029 (identity and layouts), 044 (isolated ownership), 069/071/073 (permission/privacy/failure containment), 075–080 (quality, idle, performance and typed interfaces), and 086–089 (verification and honest status).

Advisory context was routed from charters 01/02/03/13/14/15. These documents have **not** been silently elevated to ratified requirements. The proposed Constellation vision guided presentation; the current owner request supplies implementation scope.

## Remaining combined-application acceptance

- Review the integrated workspace arrival motion and reversal with the real V3.5 environment and sculptural Vela. The isolated fixture provides a navigation harness, not a replacement art direction or final shell.
- Run the complete three-project owner walkthrough in the combined application, including real shape/size/position edits, actual editor focus, and native restart. Integration-lead evidence must bind to its final source state.
- Actual WebGL context loss/restoration, minimization, prolonged idle/soak, mixed DPI, resize/monitor topology, and high-load gaming effects belong to combined-host qualification. This module's graphics policy injection is not proof of driver recovery.
- Measure presented transition frame distributions, input latency, native process memory, GPU/VRAM and sustained representative loads. Current CPU-only and nonvisible compositor evidence does not establish these results.
- Production permission policy is enforced by the service. The fixture is single-owner synthetic data, not a multi-user authorization implementation. Future permissioned adapters must provide filtered snapshots and exercise revocation at their authoritative boundary.
- Owner artistic acceptance and production/release approval remain explicit future decisions. No host, graphics stack, or governance status is finalized here.

Rollback: remove the subsystem mount and use the host's conventional workspace selector. Canonical data, resource contents, ownership and permissions are never migrated by Constellation. Its separately versioned view state may remain private or be removed through the host's explicit retention policy.

Follow-up source checks add regressions for mixed direct/spatial Back with camera restoration, revoked history destinations, a block disappearing during awaited navigation, and explicit workspace fallback for saved focused surfaces. The earlier native receipt remains bound to its recorded source hashes; the combined application must rerun its native acceptance against these follow-up changes.
