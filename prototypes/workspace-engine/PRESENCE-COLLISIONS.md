# Persistent Vela placement and committed collision handling

Follow-up from integration base `88f15d1`, isolated branch `codex/workspace-presence-collisions`. This implements the owner's request to drag Vela like a card and rearrange committed drops that would obscure her or another card. Renderer scale and native interactions remain owned by Application Integration and Cinematic V3.5.

## Additive API

`WorkspaceEngine.project(workspaceId)` now includes:

```ts
type PresencePlacement = Geometry & {
  id: 'system:vela'; kind: 'vela'; workspaceId: string;
  version: number; scale: 0.65; locked: boolean;
};
```

Vela's system identity is stable. Geometry is independent in each workspace. This presence is neither a canonical resource nor a user block; an empty workspace still has zero blocks/resources. The default safe rectangle is `{x:480,y:64,width:208,height:260}`: a 208-square visual envelope plus 52 units reserved for the handle/label. The visual worker owns rendering the sculpture at about 65% of its former scale. The host can set measured safe geometry; no assistant content or operational state is fabricated.

New commands keep the existing `commandId`, `workspaceId`, and `expectedRevision` envelope:

```ts
const state = engine.project(workspaceId);
const safeBounds = { x: 20 - offset.x, y: 170 - offset.y,
  width: innerWidth - 40, height: innerHeight - 320 };

engine.execute({ type: 'setPresence', commandId: crypto.randomUUID(),
  workspaceId, expectedRevision: state.revision,
  expectedVersion: state.presence.version,
  presentation: { x: targetX, y: targetY }, bounds: safeBounds });

// Explicit upgrade/recovery action after viewport bounds are known.
engine.execute({ type: 'resolveLayout', commandId: crypto.randomUUID(),
  workspaceId, expectedRevision: engine.project(workspaceId).revision,
  bounds: safeBounds });
```

`presentation` on `setPresence` accepts only x/y/width/height/locked. Identity, kind and the `.65` scale marker are immutable. Both presence and layout versions are validated; failed attempts roll back everything. `bounds` is optional on **every** engine command and uses workspace units. The host must supply positive finite dimensions and use the same pan/zoom transformation for pointer input, DOM, GPU and collision geometry. Very small windows need a valid positive safe area rather than passing negative header-subtracted dimensions.

`PresenceGesture(state, 'move' | resizeHandle, bounds?)` supplies `.update(screenDx, screenDy, grid?, keepAspect?)` and `.command(commandId)`. Like `LayoutGesture`, it divides screen deltas by viewport zoom, previews without writes, and produces one atomic commit. The host owns pointer capture/Escape/keyboard affordances and rendering of Vela's preview. Use the existing Motion Coordinator; focus/reading corridors may temporarily show a different pose without changing the resting presence or sending a save command.

## Collision policy

Creation/attach/duplicate, move, resize, shape/presentation changes, `saveLayout`, presets, presence updates, explicit resolution and checkpoint restoration resolve collisions before commit. Pointer previews may intersect freely. Layout undo/redo restores exact recorded snapshots.

- Reading footprints use conservative axis-aligned bounds of the actual planar rotation. This protects all supported presentation shapes and readable content; it does not attempt per-pixel optical collision.
- A 12-unit gap separates footprints. The resolver first reserves locked placements; unresolved locked/locked collisions fail with `LOCKED_COLLISION` rather than moving locked data.
- With supplied bounds, unlocked Vela reserves the nearest free in-bounds footprint before ordinary movable blocks. The committed card target then takes the nearest available position. If Vela herself is dragged, her requested position is honored as closely as the bounds and fixed anchors allow.
- Without bounds, explicit drop targets take priority over other unlocked placements. Remaining placements use stable binary ID order. Noncolliding ordinary neighbors retain exact manual positions, even if they are in pannable space.
- Candidate positions lie on blocker edges plus the requested coordinate and viewport edges. Sort by fitting inside bounds, squared distance from requested position, Y, then X. If inside space is exhausted, search deterministic pannable overflow, preserving all dimensions and identities. If locked content fills the entire safe area, Vela can also require overflow; locked constraints are never silently violated.
- No random placement, mandatory grid, canonical resource mutation, renderer mesh geometry store, or per-frame SQLite write is introduced.

All primary changes and incidental neighbor movements share the kernel transaction, one layout revision and one undo entry. Moved neighbors receive fresh block versions; presence changes receive fresh presence versions. A presence may increment more than once inside a transaction when explicit geometry also needs correction; versions are concurrency tokens, not a count of user gestures. Audit events retain the command correlation and the IDs rearranged. `resolveLayout` with no geometry changes returns the current projection without a revision/version bump, undo entry or action event. It may retain a bounded idempotency receipt.

The host should compare before/after projections and reconcile **all** moved placements through Motion Coordinator together, rather than only updating the dragged item. Preserve editor nodes and resource identities. Respect locks in UI and show resolution/storage/conflict errors without discarding the user's draft or attempted geometry.

## Engine schema 2 → 3 and recovery compatibility

`003-presence.sql` adds `presence_json` and `legacy_presence_json` to the existing workspace layout extension table. No kernel signatures or kernel schema changes. Both live placement and history still use the same SQLite file/connection/transaction boundary.

Before enriching active history/checkpoints, the migration saves their exact original JSON into `workspace_engine_v2_recovery_archive(kind,id,workspace_id,json)`. The archive is immutable by this service, is not pruned on normal history writes, and participates in canonical-resource deletion dependency checks. Existing block geometry, identities, canonical content, layouts, checkpoints, undo and redo are retained. Migration itself does not resolve old overlap or invent a user action. Back up with `kernel.backupTo()` before a deployment upgrade.

Active legacy snapshots gain the initial default presence. Presence **versions** are omitted from geometry snapshots, so legitimate undo/redo does not fail fingerprint comparison. Old imported snapshots missing presence are also normalized lazily against that workspace's stored initial baseline; this supports DesktopState's existing v1 importer, which writes old engine history/checkpoints **after** constructing WorkspaceEngine. Existing legacy importer code does not need to be rewritten merely to add presence fields. It must still preserve its original recovery records.

Old retry receipt JSON is retained; replay adds default presence to a pre-schema3 projection without overwriting the historical receipt. A replay remains an old result: fetch `project()` before issuing a new mutation. Repeated ordinary reopening of schema3 does not reinitialize presence, re-enrich history, or move anything.

Parent integration should issue one explicit undoable `resolveLayout` when adopting a legacy workspace after safe bounds are known. Repeated starts with the same noncolliding geometry are no-ops. Undo can intentionally return to the exact pre-upgrade overlap; that is historical recovery, not the result of a new colliding drop. A restore-checkpoint command, unlike undo, normalizes its restored arrangement before committing.

## Verification and limits

38 engine tests pass: the original 21 regressions plus 17 presence/collision scenarios. New coverage includes 0/1/10/25/50 blocks; restart; independent workspace presence; Vela-to-card and card-to-Vela drops; resize; bounded presence and pannable block overflow; one-step undo/redo; canonical draft preservation; no-op resolution retaining redo; zoom/snapping previews; stale presence versions and idempotent replay across SQLite connections; invalid geometry/bounds; deterministic rotated footprints; fixed/locked failure rollback; v2 raw archive and late imported recovery; failed schema3 migration rollback; and interrupted child-process transaction recovery.

Strict TypeScript checking passes using the existing integration toolchain. The integration base's 26 backend and 12 kernel regressions pass. These are service/fixture checks. Native dragging, keyboard discoverability, glass compositing, reduced-motion experience, physical displays and the visual 65% result require integration-owner evidence. No native acceptance is claimed by this worker.

### Resolver timing observation

Run `npm run benchmark:collisions` to reproduce. The predeclared synthetic workload starts all blocks at one point, rotates every fifth card by 12 degrees, includes the separate presence and safe bounds, runs three warm-ups and 20 samples, removes no outliers and asserts disjoint results. Percentiles use sorted samples at `floor(n*p)`; with 20 samples p95/p99 are both the maximum. No performance acceptance threshold is claimed.

The [recorded result](evidence/presence-collision-benchmark.json) at implementation `ba22a44`, Windows 10.0.26300 / Node v24.18.0 / Ryzen AI 7 350, measured these pure resolver wall times:

| User blocks plus Vela | p50 ms | p95 ms |
|---|---|---|
| 0 + 1 | 0.010 | 0.039 |
| 1 + 1 | 0.044 | 0.607 |
| 10 + 1 | 0.297 | 0.599 |
| 25 + 1 | 1.691 | 2.220 |
| 50 + 1 | 9.600 | 12.362 |

This isolates the geometric resolver; it excludes SQLite/history serialization, IPC, native input latency, GPU work and frame times. Other local workloads were concurrent and not sampled or attributed. Keep previews local and commit only at gesture end. The earlier full-service history benchmark in EVALUATION.md remains a separate older-revision observation.

Storage preflight for branch reuse: C:109,802,164,224 bytes and D:501,728,264,192 bytes free; bounded additional allocation C:1.5 GiB, D:0. Follow-up tests checked a 256 MiB C: allocation with C:109,725,265,920 and D:501,728,088,064 bytes free. Both independent 30 GiB reserves passed. These instruction-based checks cannot constrain unrelated applications, cloud jobs or processes that have not loaded the rule.
