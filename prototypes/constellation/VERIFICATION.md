# Constellation verification and integration handoff

Status: implemented and locally demonstrated as a navigation subsystem. The integration lead owns the combined application's V3.5 scene, stage transition, Vela, canonical service, native host, and final application acceptance. Local evidence is not owner artistic acceptance or a release qualification.

## Executed checks

| Check                                                         | Result / evidence                                                                                                    |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Canonical navigation, persistence, camera, filtering, density | 15 passing tests in `tests/navigation.test.mjs`                                                                      |
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
