# Dynamic workspace engine

Current policy contract: [Fluid, Freeform and Structured organization](ORGANIZATION-MODES.md). Fluid is the default; the three policies share the same resources, placements, presence, database, history and Motion Coordinator. Schema3 presence/collision notes below describe the preserved foundation; schema4 makes automatic collision handling specific to the selected organization policy.

Selecting Structured preserves the current workspace exactly and enables a 16-unit grid for later direct moves/resizes. Arrange/Resolve, reorder and presets are separate explicit actions. No layout migration or additional store is involved.

Reusable main-process engine over the existing `WorkspaceKernel`, with renderer-neutral typed commands, projections, and interaction bindings. Vela has a separate persistent system-presence placement; committed moves/resizes resolve collisions in one undoable transaction. This implementation does not select a desktop stack or replace the Cinematic renderer. See [presence and collision integration](PRESENCE-COLLISIONS.md) for schema 3 and the additive service API.

```ts
import { WorkspaceEngine } from './engine.mts';
const engine = new WorkspaceEngine(existingKernel); // same connection and transaction boundary
let state = engine.createWorkspace('Research');
state = engine.execute({
  type: 'createBlock', commandId: crypto.randomUUID(),
  workspaceId: state.workspaceId, expectedRevision: state.revision,
  resource: { kind: 'note', title: 'New note', content: '' }, templateId: 'note',
});
const block = state.blocks[0];
state = engine.execute({
  type: 'saveLayout', commandId: crypto.randomUUID(),
  workspaceId: state.workspaceId, expectedRevision: state.revision,
  placements: [{ blockId: block.blockId, expectedVersion: block.version,
    presentation: { x: 120, y: 80, width: 480, height: 320, shape: 'folio' } }],
}); // one atomic, undoable geometry + presentation update
```

See `contracts.mts` for the complete command union and `interaction.mts` for the Motion Coordinator bridge and DOM pointer/keyboard binding. Geometry and canonical content remain in the kernel. Only independent presentation, layout identity, navigation, bounded history, receipts and checkpoints use extension tables in that same SQLite database. No kernel signatures change.

Run `npm test` from this directory using Node 24+. No packages are required. `npm run demo` launches a loopback-only, token-gated synthetic interaction harness. Its database is capped at 32 MiB plus up to 32 MiB rollback journal. Run ReserveGuard with at least 128 MiB C: estimated allocation before demo/tests; the host's 30 GiB reserve applies. `npm run benchmark` runs three disk-backed 50-block trials.

Integration must execute all layout mutations through this engine. Existing conversations must use `attachResource` with their canonical resource ID; `createBlock` conversation creates an unavailable kernel reference and does not establish a provider session. Keep provider creation in its owning backend service and wrap attachment in the same `kernel.withTransaction` when atomic creation is required. Do not expose the kernel/SQLite handle to the renderer.

Layout commands require the latest `expectedRevision`; batch placement updates additionally require each block's `expectedVersion`. Conflicts preserve the entire operation and should show the unsaved attempt for user-directed retry after refreshing. Retry a lost response with the identical command ID and payload: the last 256 successful commands replay their original result. Reused IDs with different payloads fail. Older retries fail revision checks. A replay returns its historical receipt; refresh `project()` before further commands.

Remove/detach affects only a placement. Archive preserves canonical content and marks every projection archived; the host filters archived resources from normal active views. Undo restores detached block IDs. `deleteResource` requires an explicit host retention/approval policy, archived resource state, no kernel dependency, and no history/checkpoint reference; provider data is never deleted. Recovery history contains references and presentation only, never canonical note/chat text. The recovery window is 100 layout actions per workspace; 64 named checkpoints are allowed per workspace. SQLite handles interrupted transaction recovery. Back up through `kernel.backupTo()` before deployment migrations.

Shapes: rectangle, rounded, circle, pill, folio, lens. Circle enforces square geometry. Circle/pill/lens and minimized blocks project `contentMode: 'summary'`; render a compact summary and offer an independent rectangular reading surface rather than clipping dense text. `BlockMotionBridge` keys bodies by **block ID** and uses the existing Cinematic `MotionCoordinator`. Use a single coordinator owned by the host, dispose removed bindings, preserve editor nodes keyed by resource identity, and forward reduced-motion preference. `bindBlock` supports eight pointer handles, capture/cancel/Escape, Alt+arrows on the grip, arrows on resize handles, Shift acceleration, Shift aspect lock during drag, optional grid snapping and one commit per gesture. Only grips/handles suppress selection. The host supplies labels, focus styling, geometry rendering and error/retry UI.

Manual positions never reflow continuously. `reachable()` provides temporary reachable geometry after a window/display change without writing over canonical placement. The viewport has pan, zoom and an optional future `displayId`; actual OS monitor discovery and cross-window animation remain host responsibilities. Presets are explicit user actions and remain editable; locked blocks stay fixed. On a committed creation, drop, resize, presentation change, preset or checkpoint restore, affected collisions are resolved, including Vela's safe footprint. `freeform` preserves noncolliding positions. Bring forward/backward uses `setBlockLayer` with the chosen integer z index. Built-in template recipes never copy canonical content or rewrite existing placements.

Migrations: kernel schema remains v2. Engine schema 0→1 adds layout identity/presentation; 1→2 adds navigation/history/receipts/checkpoints; 2→3 adds system presence with retained original recovery JSON. All run inside a single kernel transaction. Existing geometry and resource content are preserved; older blocks receive default presentation. `resolveLayout` explicitly repairs legacy overlap after safe viewport bounds are known; repeating it without changes creates no undo entry or version bump. Future engine versions fail closed. Legacy direct kernel changes are preserved; undo detects divergent state and reports `HISTORY_DIVERGED` instead of overwriting it. Old commands that bypass this service cannot participate in its layout revision discipline.

Authority: Constitution established; Charter 03 published pending owner acceptance. Applicable anchors: AW-CON-018, 025–026, 029–030, 073, 078, 080–083, 086–089; advisory AW-PWR-005–008, 013, 023–026, 030–035, 070–075, 083–090, 093, 097–105. Service/fixture tests establish data behavior, not native usability or owner acceptance. Full native integration, visual/motion review, assistive technology and multi-monitor hardware validation remain with the integration lead and owner.

## Read-only initialized workspace inspection

`engine.inspectWorkspace(workspaceId)` returns the existing `WorkspaceProjection` in a deferred SQLite read transaction. It does not call `project`, initialize a layout, normalize history, backfill presentation/presence/organization, change the active workspace, or write any canonical/event/receipt/history row. It reports `UNAVAILABLE` for a missing, archived or uninitialized workspace, an archived/missing owning project, missing presence/organization/history, or a missing per-block presentation. It preserves stored legacy geometry and current archived/unavailable subject states. `canUndo/canRedo` inspect existing stack lengths; they do not repair or normalize snapshots.

This is a trusted Main-process engine method, following the existing engine authority boundary. **Root must recheck current canonical workspace/project authorization in its production Core/library command before returning this projection.** The engine does not own grants and must not be exposed directly to a renderer. Root can wrap authorization and inspection in the same kernel read transaction for one consistent grant/layout snapshot. `WorkspaceInspectionPort` describes an optional async production transport; this release adds no RPC whitelist, navigation fallback or test-only command.

The focused source test runs with SQLite `query_only=ON`, forbids the lazy APIs, compares all tables and `total_changes()`, retains exact session/history/memo state and compares the on-disk database SHA-256. Its retained fixture is synthetic. It does not establish native combined application acceptance or authorize any additional capability.
