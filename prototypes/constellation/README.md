# Constellation spatial universe

An interactive three-dimensional projection of canonical projects, workspaces, resources and typed relationships, with orbit/pan/zoom, persistent spatial organization, resource neighborhoods and a return to the existing glass-panel workspace. It is an optional presentation/navigation layer; it does not own project data, resource content, permissions, or the application shell. Full combined-application native acceptance remains pending; see [VERIFICATION.md](VERIFICATION.md).

The Constitution is binding. The specialist charters in the registry remain advisory, and the [Constellation vision](../../docs/vision/AERYNTH-CONSTELLATION-EXPERIENCE-VISION.md) remains proposed. This implementation follows the owner's explicit navigation request without ratifying a renderer, host, or governance amendment.

## Integration

`types.ts` is a structural metadata-only subset of `aerynth.desktop@1`. Pass all authorized navigation block placements, rather than only the active workspace's blocks. Canonical resource contents stay with the host's editors. The service must filter permissions before supplying the snapshot; optional `visible:false` is additional defensive filtering, not an authorization engine. Omit unavailable object existence entirely where policy disallows disclosure.

```ts
import { mountConstellation } from "./prototypes/constellation/view.ts";
import "./prototypes/constellation/style.css";

const navigation = mountConstellation(container, {
  snapshot,
  motion, // existing V3.5 MotionCoordinator, owned and stepped by host
  navigate: async (target) => {
    const next = await desktop.navigate(target);
    navigation.update(next);
  },
  openResource: async ({ workspaceId, resourceId, blockId }) => {
    await editors.focus({ workspaceId, resourceId, blockId });
  },
  persistence: {
    load: () => desktop.loadConstellationView(),
    save: (state) => desktop.saveConstellationView(state),
  },
  onDirty: wakeHostScheduler,
  onTransition: (transition) => stage.approachFromAnchor(transition),
});
await navigation.ready;
// After each host-owned motion.step(dt), including the final settling frame:
navigation.frame(performance.now());
```

The subsystem creates no animation loop or graphics context. Render its `layer` through the host's existing Three.js renderer, between the environment background and foreground Vela. The transparent overlay and host-owned glass work surfaces stay in place. `onTransition.screenOrigin` supplies the real projected destination in client pixels for the host's arrival motion. Keep input available immediately. Reduced motion, Quiet, and hidden policy should also settle the host's stage transition.

For a full-window mount, use `ConstellationViewOptions` and keep container, field, draw/scissor, projection and picking bounds in the same stable CSS viewport. Supply `hostUiElements()` with up to 32 current foreground elements, including the host's chrome, footer and native window controls. The module combines their actual visible rectangles with its Vela/dialog/control exclusions on existing frames. This replaces the fixed top-right reservation; labels and new pointer/wheel gestures yield to those rectangles, while captured pointer cleanup continues. The capsule and popovers reserve at least 56 CSS pixels above the footer.

Expose `navigation.uiExclusions()` as `snapshot().spatial.uiExclusions` for native verification. These are scalar field-relative rectangles, not content or persistent data. Full-viewport label-clearance verification requires those observations and checks them in client coordinates; older inset captures remain explicitly legacy. Arrival motion uses the last successfully drawn body pixels across a canonical switch that hides the field, with identity/loss checks and a positive-container fallback, rather than projecting a zero-sized hidden field.

`update(snapshot)` reconciles canonical direct navigation, permission changes, and newly created objects. `setPolicy({tier,reduced,quiet,hidden,graphicsAvailable})` shares host policy. Call `dispose()` before tearing down the surface and explicitly flush persistence before closing the native host. Optional resource opening must be idempotent focus, not a toggle that can close the editor.

The controller exposes `go`, `zoomOut`, `approach`, `back`, `forward`, `search`, `locate`, `pan`, `zoom`, `interrupt`, `fit`, `recenter`, `pin`, `saveView`, `returnView`, `renameView`, `removeView`, and `persist`. Its camera history includes bookmarks; bind host Back/Forward actions to `controller.back()` / `controller.forward()`. The spatial field also offers Alt+Left/Right and command search. A separate service Back stack has different presentation-history semantics.

External canonical switches retain the previous available location and camera in this history. A saved focused resource restores explicitly as its containing workspace, retaining its bookmark and selection; the host does not claim an editor reopened merely because its ID was saved. Resources are revalidated after awaited navigation before editor focus, and a completed canonical workspace switch remains active if its resource disappears.

## Behavior

- Universe shows project stars and standalone workspaces. Project overview retains all of its authorized workspaces and resources unless outside the camera frustum. Working scale delegates to actual workspace panels and editor identities.
- Fresh project views and Home frame actual body envelopes using the tighter horizontal/vertical field of view. Saved/manual cameras, refresh and recovery are not automatically refitted. Universe approach and Fit keep their existing close distances; a separate project-exit band extends beyond the full overview, with an outward escape at the existing 100,000-unit camera limit.
- A small glass location capsule holds only commands (⋯) and an information control (i). Ctrl K or right-click opens a compact searchable command/destination panel; selection information appears only on request. The i control, F1 or ? opens a small glass navigation guide. Escape or an outside click dismisses it.
- Working mode retains only the glass i control. Its guide explains outward scrolling over empty workspace space and the Workspace actions → Constellation entry path; closing help returns focus without changing the working card or canonical layout. The host owns admission of workspace-background wheel events so editors retain scrolling.
- Drag orbits; Shift-drag/middle-drag pans in the actual camera plane; wheel/plus/minus zoom; F fits selection; Home recenters; Enter/double-click enters; Backspace returns and Alt Up moves out. Shift-arrows orbit and arrows pan. Alt-drag preserves the initial grab point while moving and pinning a body. Exact coordinates, camera preferences, creation, typed relationships, history and list presentation remain available through command search. Editor shortcuts keep their own scope.
- Wheel zoom leaves a workspace from its own stellar anchor, approaches the body or label under the cursor, enters a workspace/resource at close range, and crosses project/Universe scope continuously. Camera retargeting shares the host spring, and manual input during awaited navigation remains authoritative on arrival. Panning uses the viewport's perspective pixel scale so it feels consistent as the window changes size.
- Camera and selection changes save automatically through the existing private view-state service after movement settles. Pointer release, hiding and host shutdown retain their flush paths through the shared host scheduler.
- Save current view and Saved views in command search keep up to 32 explicit named viewpoints, including camera, selection, neighborhood, mode, sensitivity and list/spatial presentation. A small glass name/picker panel supports return, rename and removal. Returning records the previous view for Back/Forward; later automatic scope bookmarks preserve each explicit viewpoint. Optional `savedViews: {id,name,location,bookmark}[]` retains @1 profile compatibility, shares the 2 MiB ceiling and is permission-pruned on restore, refresh and awaited arrival.
- Incremental 3D positions retain existing anchors. Alt-drag or numeric controls move and pin bodies; workspace movement carries unpinned descendants. Radial/hierarchical arrangements have preview, cancel, apply and undo. Position never creates ownership or relationships.
- View state contains only IDs, anchor coordinates, camera bookmarks, and bounded history. Optional `future: { location, bookmark }[]` stores up to 32 Forward entries, with the last entry next; older profiles may omit it. Successful new travel clears Forward; failed or superseded travel preserves both stacks. Restore and graph refresh prune unavailable destinations and selection/neighborhood IDs. Persist it privately through the application service, with a 2 MiB payload bound. It is not a second content database.
- Label packing and up to 40 relationship curves keep the view readable. The 70/160/280 quality budgets limit detailed bodies; remaining on-screen bodies retain their identity in one low-detail instance batch. Distance and screen alignment never remove project bodies. Off-screen low-detail instances are GPU-clipped; camera movement does not rebuild position/color buffers. Shared resources retain distinct block IDs and the same canonical resource ID.
- Projects are self-lit procedural stellar photospheres with restrained coronas and stable warm-to-cool colors. Every workspace planet and resource moon gets deterministic terrain, craters, bands, ice, oceans or volcanic detail from its canonical ID. New objects receive their own appearance; shared placements and restarts retain it. Texture-free shaders and shared sphere meshes keep rendering bounded. Detailed planets add at most two atmosphere/ring meshes; distant instances use only a coarse sphere with the same palette and geology.
- Relationships are taken from typed canonical edges. Inferred links use dashed strokes and explicit suggestion text. There is no fabricated activity or resource-content interpretation.
- Explore frames related resource positions and full body envelopes for the actual field aspect, preserving saved anchors, pins and the surrounding project bodies. Small wheel gestures retain wide neighborhoods. Newly created conversation branches use their parent's local branch count and prefer its placement in the child's workspace, so a dense workspace does not push the first branch far away.
- Camera and selection emphasis use the host's spring coordinator. Retargeting preserves velocity; reduced motion/Quiet settle immediately. Async destination requests are serialized so the latest request becomes the final canonical destination. Navigation errors and failed view persistence remain visible.
- Newly available graph bodies receive a small, one-time arrival through the shared spring, with at most 8/12/24 concurrent cues by quality tier. Initial display, metadata edits, camera re-entry and detail changes stay steady. Hidden, Quiet, reduced, list and unavailable-graphics additions have no deferred cue. Existing XYZ/pins and dense instance transforms remain unchanged.
- Optional typed `graphAction`/capabilities connect Create, placement, archive, explicit relationships and app-level conversation continuation to the existing canonical service. The module never substitutes a content database or claims native provider branching. Ordinary branch context is explicitly previewed and selected by the user.

## Reproduce the synthetic demonstration

Requirements: Node 22.18+ with `node:sqlite`, plus the pinned V3.5 development toolchain (TypeScript 5.9.3, Vite 7.1.12, Electron 45.2.1). Reuse an existing toolchain where available; this subsystem adds no runtime dependencies. Before builds/tests, apply the host's C:/D: reserve guard with a bounded allocation estimate. Do not install another Electron runtime merely to run this fixture.

From the repository, with `V3` set to the absolute V3.5 directory containing installed `node_modules`:

```powershell
node --experimental-strip-types --test prototypes/constellation/tests/*.test.mjs
node "$V3/node_modules/typescript/bin/tsc" -p prototypes/constellation/tsconfig.json
node "$V3/node_modules/vite/bin/vite.js" build prototypes/constellation/demo --outDir ../dist --emptyOutDir
node --experimental-strip-types prototypes/constellation/demo/server.mts
```

Open the printed loopback address. The fixture seeds `A World for Two` (Development/Planning), `Voyagewright` (Engineering/Review), and `Airbrush Disc System` (Calibration/Hardware) through the existing SQLite `WorkspaceKernel`. Each has different layouts and real editable notes. All data is synthetic. Local fixture data stays in ignored `.local-data/`; never point this fixture at a personal database.

Start in Development, zoom out to its project and Universe, approach Voyagewright, open Engineering, save a note, return to Development, and restart. The native harness automates this journey, including a full canonical-service restart:

```powershell
& "$V3/node_modules/electron/dist/electron.exe" prototypes/constellation/tests/native.cjs
node --experimental-strip-types prototypes/constellation/tests/benchmark.mjs
```

On Windows, launch the native harness with `Start-Process -WindowStyle Hidden -PassThru` and wait for its exit to collect its result. The harness uses a nonvisible offscreen compositor and a temporary synthetic SQLite database. It emits five screenshots and `evidence/native-verification.json`. The CPU benchmark emits `evidence/cpu-benchmark.json`; it measures projection/search/culling, **not presented frames or GPU performance**.

See [VERIFICATION.md](VERIFICATION.md) for evidence, requirements, and remaining acceptance boundaries.

For a short combined-desktop verification window, the integration owner can prepare the fixed 39-resource fixture offline through the actual application's BackendCore, DesktopState and Block Library:

```powershell
node --experimental-strip-types prototypes/constellation/tests/prepare-integrated.mts --profile=<fresh-absolute-review-expanded-profile> --app-root=<combined-checkout>
```

The CLI admits 1 GiB through the C:/D: reserve guard, requires a fresh private profile outside the checkout, checks finite command/data/time bounds, and writes that profile's actual `aerynth.sqlite` plus `expanded-setup.json`. It uses the native host's real Codex provider identity without connecting, probing capabilities or executing a provider turn; all nine demonstration conversations are local. The unchanged host also registers an unused `mock-ordinary` catalog entry, which the receipt identifies explicitly.

The owner's existing desktop host can then add `--prepared-workspaces` to its `--integration-expanded --profile=... --verification-deadline-ms=...` launch. The helper requires exactly one explicit deadline of 1,000–180,000 ms, measured from the host's original module start. It checks canonical source hashes and the exact loaded resource identities, contents, relationships and placements before skipping only repetitive fixture construction. Every ordered native step, additional block creation, branch, drag/resize, graph edit, exact return, recording and fresh-process restart check remains. Default UI fixture construction is preserved. Native input stops on focus loss or deadline expiry, without reclaiming focus. The window-local Escape guard aborts unmatched/repeating Escape; one explicitly injected dismissal Escape has a documented 250 ms allowance because Electron's input event has no physical/injected source identifier. Bounded progress and receipt checkpoints retain completed steps even if the host deadline terminates a run. Offline preparation and helper unit tests are not native acceptance evidence.

Before a native launch, run `node prototypes/constellation/tests/check-native-helpers.cjs`. It uses the existing TypeScript toolchain to check the actual owned helpers for unbound names, temporal dead zones, unassigned reads and non-callable expressions. This source preflight opens no window and complements the runtime checks.

### Body clearance

Planet geometry and spatial layout share one conservative size contract, including rings, atmosphere and maximum selection enlargement. Automatic placement leaves 28 world units between those envelopes and varies siblings' distance and elevation. Clear saved positions and pins remain authoritative; conflicting legacy positions are repaired deterministically with a visible notice. Drag previews stop before fixed neighbors, and arrangements/undo are validated against the current graph.

Perspective can align separated 3D bodies, causing ordinary depth occlusion. Camera alignment never removes an on-screen body: all authorized bodies in the project remain submitted through detailed geometry or shared low-detail instances. Physical clearance applies in world space; labels are packed separately for readability. This presentation does not change canonical position or ownership.

`node --experimental-strip-types prototypes/constellation/tests/profile-spacing.mjs` is a bounded CPU-only source diagnostic for 50/250/2,000/10,000 resources. It reports projection, packing, refresh and scene-update costs separately; it does not establish native motion, GPU performance or product acceptance. Native verification belongs to the integration host and must be repeated on the actual candidate.
