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

`update(snapshot)` reconciles canonical direct navigation, permission changes, and newly created objects. `setPolicy({tier,reduced,quiet,hidden,graphicsAvailable})` shares host policy. Call `dispose()` before tearing down the surface and explicitly flush persistence before closing the native host. Optional resource opening must be idempotent focus, not a toggle that can close the editor.

The controller exposes `go`, `zoomOut`, `approach`, `back`, `search`, `locate`, `pan`, `zoom`, `interrupt`, `fit`, `recenter`, `pin`, and `persist`. Its camera history includes bookmarks; bind a host Back action to `controller.back()` when restoring this camera history. A separate service Back stack has different presentation-history semantics.

External canonical switches retain the previous available location and camera in this history. A saved focused resource restores explicitly as its containing workspace, retaining its bookmark and selection; the host does not claim an editor reopened merely because its ID was saved. Resources are revalidated after awaited navigation before editor focus, and a completed canonical workspace switch remains active if its resource disappears.

## Behavior

- Universe shows project anchors and standalone workspaces. Project overview shows workspaces; close zoom reveals resource proxies. Working scale delegates to actual workspace panels and editor identities.
- A small glass location capsule holds only commands (⋯) and an information control (i). Ctrl K or right-click opens a compact searchable command/destination panel; selection information appears only on request. The i control, F1 or ? opens a small glass navigation guide. Escape or an outside click dismisses it.
- Working mode retains only the glass i control. Its guide identifies Workspace actions → Constellation as the entry path and scopes the spatial gestures to that view; closing help returns focus without changing the working card or canonical layout.
- Drag orbits; Shift-drag/middle-drag pans in the actual camera plane; wheel/plus/minus zoom; F fits selection; Home recenters; Enter/double-click enters; Backspace returns and Alt Up moves out. Shift-arrows orbit and arrows pan. Alt-drag preserves the initial grab point while moving and pinning a body. Exact coordinates, camera preferences, creation, typed relationships, history and list presentation remain available through command search. Editor shortcuts keep their own scope.
- Wheel zoom crosses project/Universe scope continuously. Camera retargeting shares the host spring, and manual input during awaited navigation remains authoritative on arrival. Panning uses the viewport's perspective pixel scale so it feels consistent as the window changes size.
- Camera and selection changes save automatically through the existing private view-state service after movement settles. Pointer release, hiding and host shutdown retain their flush paths; no Save view button or additional animation loop is required.
- Incremental 3D positions retain existing anchors. Alt-drag or numeric controls move and pin bodies; workspace movement carries unpinned descendants. Radial/hierarchical arrangements have preview, cancel, apply and undo. Position never creates ownership or relationships.
- View state contains only IDs, anchor coordinates, camera bookmarks, and bounded history. Persist it privately through the application service, with a 2 MiB payload bound. It is not a second content database.
- Screen-space label packing, frustum/distance culling, 70/160/280 body caps and 40 relationship curves limit visual density. All authorized destinations remain searchable when labels are culled. Shared resources retain distinct block IDs and the same canonical resource ID.
- Every planet and moon gets deterministic colors, terrain, craters, bands, ice, oceans or volcanic detail from its canonical ID. New objects automatically receive their own appearance; shared placements and restarts retain it. These are texture-free shaders over three shared sphere meshes. Screen-size geometry/detail reduction keeps distant bodies cheap and reduces fine-pattern shimmer. Optional thin atmosphere and rings add at most two meshes per body.
- Relationships are taken from typed canonical edges. Inferred links use dashed strokes and explicit suggestion text. There is no fabricated activity or resource-content interpretation.
- Explore frames related resource positions and full body envelopes for the actual field aspect, preserving all saved anchors and pins. Small wheel gestures retain wide neighborhoods. Newly created conversation branches use their parent's local branch count and prefer its placement in the child's workspace, so a dense workspace does not push the first branch far away.
- Camera and selection emphasis use the host's spring coordinator. Retargeting preserves velocity; reduced motion/Quiet settle immediately. Async destination requests are serialized so the latest request becomes the final canonical destination. Navigation errors and failed view persistence remain visible.
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

### Body clearance

Planet geometry and spatial layout share one conservative size contract, including rings, atmosphere and maximum selection enlargement. Automatic placement leaves 28 world units between those envelopes and varies siblings' distance and elevation. Clear saved positions and pins remain authoritative; conflicting legacy positions are repaired deterministically with a visible notice. Drag previews stop before fixed neighbors, and arrangements/undo are validated against the current graph.

Perspective can align separated 3D bodies. The renderer reserves an additional screen gap and suppresses an obscured body while retaining semantic destination labels, canonical search and selection. Selecting an obscured destination reveals its body. This presentation does not change its canonical position or ownership.

`node --experimental-strip-types prototypes/constellation/tests/profile-spacing.mjs` is a bounded CPU-only source diagnostic for 50/250/2,000/10,000 resources. It reports projection, packing, refresh and scene-update costs separately; it does not establish native motion, GPU performance or product acceptance. Native verification belongs to the integration host and must be repeated on the actual candidate.
