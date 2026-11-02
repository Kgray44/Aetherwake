# Three organization policies on one workspace

Owner directive: three-mode spatial organization, attachment `2413b435-7d7b-4f7a-bd32-6b407143ee73`. Integration base `3cc259a`; isolated worker branch `codex/workspace-organization-modes`. This document describes the engine contract and tracks the full milestone separately from engine completion.

## API and source ownership

`contracts.mts` owns `OrganizationMode = 'fluid' | 'freeform' | 'structured'`, `WorkspaceOrganization`, and the additive command/preview types. `WorkspaceProjection.organization` contains `{schemaVersion:1,mode,gap,revision,structured}`. Structured settings contain optional `columnCount`, `rowHeight`, `rowGap`, `columnGap`, `margin`, preset, stable placement order, and per-placement `{columns,rows}` spans. `system:vela` participates in this order without becoming a canonical resource or user block.

New workspaces default to Fluid. `createWorkspace(title, projectId?, organizationOverride?)` and `EngineOptions.defaultOrganization` allow an explicit inherited preference. A workspace switch only loads its existing organization, geometry and presence. It does not normalize the arrangement.

```ts
engine.execute({ type: 'setOrganization', commandId, workspaceId,
  expectedRevision: state.revision,
  expectedOrganizationRevision: state.organization.revision,
  organization: { mode: 'structured', structured: { columnCount: 4 } }, bounds });

engine.execute({ type: 'setOrganization', commandId, workspaceId,
  expectedRevision: state.revision,
  organization: { structured: { spans: { [blockId]: { columns: 2, rows: 4 } } } }, bounds });
```

Additional actions: `applyStructuredPreset {preset:'balanced'|'focus'|'development'|'research'}`, `reorderPlacements {order:string[]}` (full set including Vela), `bringAllIntoView`, and `layerBlock {blockId,direction:'front'|'back'|'raise'|'lower'}`. Existing block, presence, checkpoint, undoLayout and redoLayout actions remain. Mode/config changes and all resulting geometry changes share one transaction and one history entry. Undo/redo/checkpoint snapshots include the organization policy and configuration as well as geometry/presence. Resource content and editor instances are outside layout storage.

## Predictive preview contract

Import `previewLayout` from browser-safe `organization.mts`. It does not import engine/SQLite/Node, read provider data, own animation, or persist anything.

```ts
type LayoutState = Pick<WorkspaceProjection,
  'revision'|'blocks'|'presence'|'organization'|'viewport'>;

const preview = previewLayout(committedState, {
  expectedRevision: committedState.revision, bounds,
  placements: [{ blockId, expectedVersion, presentation: tentativeGeometry }],
});
```

The request also accepts `presence:{expectedVersion,presentation}`, organization update, viewport, explicit order, structuredPreset, and optional intent (`move`, `resize`, `reorder`, `mode`, `resolve`, `recover`, `view`). The returned `LayoutPreview` contains `canonical:false`, `baseRevision`, blocks, presence, organization, viewport, affectedPlacementIds, grid guides, and predicted placementAreas. Versions remain committed-state tokens, not fabricated saved revisions.

The trusted commit path invokes **the same** `applyOrganizationPolicy` function with the same tentative geometry, targets, bounds and resize/mode intent. Structured resizes distinguish changed dimensions from full geometry payloads whose dimensions were unchanged. Explicit span overrides are retained even during a mode transformation.

Integration must retain the original committed state throughout a gesture, coalesce preview at most once per existing animation frame, and retarget affected neighbors through the shared Motion Coordinator. The actively dragged object's direct pointer pose can remain separate from its predicted valid landing area. No new animation scheduler or per-pointer database write. On Escape/cancel, discard all preview targets and reconcile all items to committed geometry. On release, send one versioned saveLayout/setPresence; reconcile **every** returned placement together. A stale command fails without silently adopting new revisions. If state/bounds change during a gesture, invalidate the old preview and explain/recompute before commit.

## Policy behavior

**Fluid:** extends the existing deterministic collision resolver, with configurable gap, rotated reading footprints, fixed locks, Vela reachability and pannable overflow. Explicit targets have priority; Vela can yield while retaining a safe in-bounds footprint where feasible. Candidate selection penalizes disturbing not-yet-moved neighbors before distance, so a local conflict can be solved without propagating into an unrelated card. The solver is deterministic, not a claim of a globally optimal packing proof. Neighbor dimensions are preserved. An unchanged resolution remains a no-op.

**Freeform:** preserves requested valid manual geometry and intentional overlap, including Vela. No collision-driven neighbor move on drop, resize, mode entry, or resolve. Geometry beyond the immediate viewport remains intact. Layer controls persist integer zIndex; ties retain canonical block-ID ordering. The application must expose ways to select obscured cards and locate/reposition Vela. Glass overlap/material compositing remains renderer-owned.

**Structured:** responsive columns and stable reading order, configurable margins and row/column spacing, variable grid spans, actual reorder operations, and span resizing. Blocks quantize to grid cells where presentation permits; circles and rotated content retain valid shape geometry inside reserved cells. Vela retains its measured sculpture/handle footprint while occupying grid cells. Locked geometry is reserved exactly and not quantized. Oversized spans use horizontal/vertical pannable overflow rather than dropping resources. Balanced preserves size distinctions; Focus, Development and Research supply editable span recipes. There is no fixed number of slots or three-card limit.

Fluid→Freeform and Structured→Freeform preserve current geometry. Freeform→Fluid resolves overlaps as one explicit undoable action. Entering Structured is a single reversible arrangement transformation. Structured→Fluid preserves clean geometry where possible. Active mode persists independently per workspace and survives restart.

## Camera and recovery

Viewport uses the application's full-window convention: `screen = (world - viewportOrigin) * zoom`; safe editable `bounds` are supplied in workspace units. Camera-only `saveLayout {placements:[],viewport}` and matching preview intent `view` skip organization resolution, including unresolved legacy Fluid geometry. Panning is not an implicit Make Room operation.

Bring All Into View fits the union of blocks and Vela by changing the camera, preserving all canonical geometry, overlap, locks and dimensions. It accounts for the safe-area screen offset before calculating the next viewport origin. It is previewable and undoable. Positive finite zoom up to 4 is supported; large pannable layouts may require zoom below the previous .1 minimum. View origins allow ±1e12 to accommodate safe-header offsets at small zoom; block/presence coordinates retain ±1e6 practical limits. The host must render and persist this camera projection for the recovery control to work.

## Schema 4 and history compatibility

`004-organization.sql` adds `organization_json` and `legacy_organization_json` to the existing engine layout extension table and archives exact prior history/checkpoint JSON in `workspace_engine_v3_recovery_archive`. Kernel schema and signatures are unchanged. Schema3's presence identity, geometry, retry semantics, history and raw-v2 archive are preserved.

Legacy workspaces without an explicit organization policy receive Fluid metadata **without geometry changes**. A known explicit viewport organizationMode/organization.mode preference is retained, as is a legacy structured layout flag. The old kernel `freeform` flag alone is a geometry-storage label: the schema3 collision service wrote it even while enforcing Fluid behavior, so it does not prove an explicit manual-overlap preference. Migration does not normalize overlaps or quantize a structured layout. The user must choose the explicit undoable resolution/transformation.

Legacy snapshots missing organization are normalized against each workspace's migration baseline, including snapshots written later by DesktopState's earlier importer. Snapshot concurrency revisions are excluded from geometry fingerprints; live organization revisions remain monotonic tokens. Exact raw archives participate in resource-deletion dependency checks. A failed migration rolls back rather than resetting user data. Backup before applying deployment migrations.

## Verification and full-goal acceptance ledger

Initial engine checkpoint: 38 retained regressions plus 16 mode-policy tests pass; strict TypeScript and whitespace checks pass. Coverage includes new/inherited defaults; independent modes/restart; exact Freeform overlap/layers/presence persistence; predictive read-only preview/commit equality; local yielding; Structured 0/3/10/25/50 blocks, sizes/spans/reorder/presets; explicit span overrides; all six transitions; durable undo of mode/config/geometry; view-only saves and safe recovery; locks, invalid policies and stale revisions; raw legacy geometry/history and explicit preference migration. New performance/adversarial checks are recorded as they are collected.

| Directive scope | Authoritative completion evidence | Current engine checkpoint / remaining owner evidence |
|---|---|---|
| 0–1 architecture and same canonical workspace | Engine contracts, SQLite schema4, identity/persistence tests | Implemented/tested; no second database |
| 2 Fluid prediction, yielding, resize, Vela and motion | Pure policy tests plus native predictive mouse/keyboard recordings | Engine implemented/tested; shared native motion/preview evidence pending lead/renderer |
| 3 Freeform overlap, layers, recovery and glass | Persist/restart tests plus native overlap/material/selection evidence | Engine implemented/tested; native glass and obscured-item access pending |
| 4 Structured cells/spans/reorder/presets/presence | Variable-size tests and actual native grid resize/reorder/restart | Engine implemented/tested; native controls/experience pending |
| 5 default, per-workspace control, accessibility | Default/migration tests plus real selectable labeled keyboard control | Metadata tested; native control/accessibility pending |
| 6 safe mode switching/layout memory | Durable undo/redo/checkpoint tests plus native coordinated transitions | Engine tested; native transition evidence pending |
| 7 geometry/organization contracts | Typed organization projection and exact preview/commit comparison | Implemented/tested; trusted desktop adapter owned by lead |
| 8 shared motion domains/reduced motion/quality/scenes | Current Motion Coordinator + native cancellation/retarget/scene/recovery tests | No new scheduler; native combined evidence pending |
| 9 glass continuity | New native captures/video at exact integrated mode candidate | Renderer-owned; older material matrix cannot prove this candidate |
| 10 solver invariants/performance | Deterministic/minimal-neighbor/lock/no-op/invalid/identity tests and mode preview benchmarks | Functional checks passing; current-mode timing/evidence pending |
| 11 concurrency | Scoped engine-only branch and exact API handoff | Active coordinated work with integration lead and visual worker |
| 12 required mixed native demonstrations | 3 conversations, 2 notes, 2 tasks, research, Intelligence Stream, Vela; Fluid/Freeform/Structured/transitions/cross-workspace + Constellation journeys | Pending integration/native owner; isolated geometry cannot substitute |
| 13 regressions | Engine/backend/kernel tests plus native graphics recovery, reduced motion, duplicate-label and glass checks at 3/10/25/50 | Engine checkpoint only; full native matrix pending |
| 14 performance | Separate layout timings and actual displayed rendering measurements with quality/idle/minimized recovery | Engine timing separate; renderer/native evidence pending |
| 15 artistic behavior | Native visual/motion review of all three modes and expressive Vela | Pending combined candidate review |
| 16 all 14 milestone acceptance items | Real app controls/default/distinct behavior, blocks/Vela, persistence, undo/redo, recoverability, shared motion/glass, input, Constellation, regressions, visual proof | **Full milestone unproven; keep goal active** |

This worker checkpoint is not final product completion. The active goal remains open until the actual integrated native candidate and required visual evidence satisfy the full directive.
