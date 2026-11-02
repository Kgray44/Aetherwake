# Constellation navigation vertical slice

Implemented subsystem for navigating **out of work, between real persisted workspaces, and back into readable glass panels**. It is an optional presentation/navigation layer; it does not own project data, resource content, permissions, or the application shell.

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

The subsystem creates no animation loop or graphics context. The transparent overlay keeps the existing celestial environment and Vela intact. Working workspace and resource surfaces are host-owned. `onTransition` supplies the destination world anchor and camera; map them using `.aw-spatial-field`'s screen rectangle for the host's arrival motion. Keep input available immediately. Reduced motion, Quiet, and hidden policy should also settle the host's stage transition.

`update(snapshot)` reconciles canonical direct navigation, permission changes, and newly created objects. `setPolicy({tier,reduced,quiet,hidden,graphicsAvailable})` shares host policy. Call `dispose()` before tearing down the surface and explicitly flush persistence before closing the native host. Optional resource opening must be idempotent focus, not a toggle that can close the editor.

The controller exposes `go`, `zoomOut`, `approach`, `back`, `search`, `locate`, `pan`, `zoom`, `interrupt`, `fit`, `recenter`, `pin`, and `persist`. Its camera history includes bookmarks; bind a host Back action to `controller.back()` when restoring this camera history. A separate service Back stack has different presentation-history semantics.

External canonical switches retain the previous available location and camera in this history. A saved focused resource restores explicitly as its containing workspace, retaining its bookmark and selection; the host does not claim an editor reopened merely because its ID was saved. Resources are revalidated after awaited navigation before editor focus, and a completed canonical workspace switch remains active if its resource disappears.

## Behavior

- Universe shows project anchors and standalone workspaces. Project overview shows workspaces; close zoom reveals resource proxies. Working scale delegates to actual workspace panels and editor identities.
- Direct destinations, search/Open/Locate, keyboard Enter, Back, and conventional controls remain available. Empty-space drag/arrows pan; wheel/plus/minus zoom; Home recenters; Escape stops camera motion. No flight controls or rotation are required.
- Incremental positions retain existing anchors. Selected project/workspace anchors can be positioned numerically. Resources derive from canonical block geometry. Position never creates ownership or relationships.
- View state contains only IDs, anchor coordinates, camera bookmarks, and bounded history. Persist it privately through the application service, with a 2 MiB payload bound. It is not a second content database.
- Screen-space collision culling, distance culling, 40/80/120 proxy caps, two-line labels, and selected-only bounded edges limit visual density. All authorized destinations remain searchable when labels are culled. Shared resources retain distinct block IDs and the same canonical resource ID.
- Relationships are taken from typed canonical edges. Inferred links use dashed strokes and explicit suggestion text. There is no fabricated activity or resource-content interpretation.
- Camera retargeting preserves spring velocity. Async destination requests are serialized so the latest request becomes the final canonical destination. Navigation errors and failed view persistence remain visible.

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
