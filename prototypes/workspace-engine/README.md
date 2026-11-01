# Dynamic workspace engine

Reusable main-process engine over the existing `WorkspaceKernel`, with renderer-neutral typed commands, projections, and interaction bindings. This implementation does not select a desktop stack or replace the Cinematic renderer.

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

Manual positions never reflow automatically. `reachable()` provides temporary reachable geometry after a window/display change without writing over canonical placement. The viewport has pan, zoom and an optional future `displayId`; actual OS monitor discovery and cross-window animation remain host responsibilities. Presets are explicit user actions and remain editable; locked blocks stay fixed. `freeform` preserves all positions. Bring forward/backward uses `setBlockLayer` with the chosen integer z index. Built-in template recipes never copy canonical content or rewrite existing placements.

Migrations: kernel schema remains v2. Engine schema 0→1 adds layout identity/presentation; 1→2 adds navigation/history/receipts/checkpoints, all inside a single kernel transaction. Existing geometry and resource content are preserved; older blocks receive default presentation. Future engine versions fail closed. Legacy direct kernel changes are preserved; undo detects divergent state and reports `HISTORY_DIVERGED` instead of overwriting it. Old commands that bypass this service cannot participate in its layout revision discipline.

Authority: Constitution established; Charter 03 published pending owner acceptance. Applicable anchors: AW-CON-018, 025–026, 029–030, 073, 078, 080–083, 086–089; advisory AW-PWR-005–008, 013, 023–026, 030–035, 070–075, 083–090, 093, 097–105. Service/fixture tests establish data behavior, not native usability or owner acceptance. Full native integration, visual/motion review, assistive technology and multi-monitor hardware validation remain with the integration lead and owner.
