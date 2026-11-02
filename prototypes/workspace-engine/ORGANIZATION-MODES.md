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

Additional actions: `applyStructuredPreset {preset:'balanced'|'focus'|'development'|'research'}`, `reorderPlacements {order:string[]}` (full set including Vela), `resolveLayout` (explicit Arrange/Resolve), `bringAllIntoView`, and `layerBlock {blockId,direction:'front'|'back'|'raise'|'lower'}`. Existing block, presence, checkpoint, undoLayout and redoLayout actions remain. Mode/config changes are one transaction and history entry; selecting Structured preserves current geometry exactly. Explicit arrangement changes share one transaction and one history entry. Undo/redo/checkpoint snapshots include the organization policy and configuration as well as geometry/presence. Resource content and editor instances are outside layout storage.

`structured.columnCount:null` explicitly resets a prior fixed column count to automatic. Omitting columnCount preserves the current preference. The canonical projection remains `number | undefined`.

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

The trusted commit path invokes **the same** `applyOrganizationPolicy` function with the same tentative geometry, targets, bounds, prior committed state and resize/mode intent. Structured resizes distinguish changed dimensions from full geometry payloads whose dimensions were unchanged. Explicit span overrides update saved arrangement preferences without rearranging current cards.

Integration must retain the original committed state throughout a gesture, coalesce preview at most once per existing animation frame, and retarget affected neighbors through the shared Motion Coordinator. The actively dragged object's direct pointer pose can remain separate from its predicted valid landing area. No new animation scheduler or per-pointer database write. On Escape/cancel, discard all preview targets and reconcile all items to committed geometry. On release, send one versioned saveLayout/setPresence; reconcile **every** returned placement together. A stale command fails without silently adopting new revisions. If state/bounds change during a gesture, invalidate the old preview and explain/recompute before commit.

## Policy behavior

**Fluid:** extends the existing deterministic collision resolver, with configurable gap, rotated reading footprints, fixed locks, Vela reachability and pannable overflow. Explicit targets have priority; Vela can yield while retaining a safe in-bounds footprint where feasible. Candidate selection penalizes disturbing not-yet-moved neighbors before distance, so a local conflict can be solved without propagating into an unrelated card. The solver is deterministic, not a claim of a globally optimal packing proof. Neighbor dimensions are preserved. An unchanged resolution remains a no-op.

**Freeform:** preserves requested valid manual geometry and intentional overlap, including Vela. No collision-driven neighbor move on drop, resize, mode entry, or resolve. Geometry beyond the immediate viewport remains intact. Layer controls persist integer zIndex; ties retain canonical block-ID ordering. The application must expose ways to select obscured cards and locate/reposition Vela. Glass overlap/material compositing remains renderer-owned.

**Structured:** selecting the mode only enables a world-anchored 16-unit grid for later direct manipulation. It preserves exact current x/y/width/height, shapes, rotation, layer/order, camera, locks and Vela, including existing overlaps and off-grid placements. Configuration changes also preserve geometry. Later moves and resizes snap only changed active geometry; unchanged cards, including those repeated in a full-layout payload, remain fixed collision anchors. Collision resolution moves only the active target to a vacant grid location and never packs unrelated cards or Vela. Resize snapping preserves unchanged opposite edges and existing aspect constraints before collision resolution; when a ratio cannot align both moving edges, the horizontal edge owns snap. Appearance-only edits do not snap saved geometry. Library additions using `placement:'nearest-free'` choose an available grid location without moving current content.

**Explicit Structured arrangement:** `resolveLayout`, `reorderPlacements`, and `applyStructuredPreset` opt into responsive columns, stable reading order, configurable margins and row/column spacing, and variable spans. Blocks quantize to these larger cells where presentation permits; circles and rotated content retain valid shape geometry inside reserved cells. Vela retains its measured sculpture/handle footprint while occupying cells. Locked geometry is reserved exactly. Oversized spans use pannable overflow rather than dropping resources. Balanced preserves size distinctions; Focus, Development and Research supply editable span recipes. Direct resizes retain corresponding span preferences for a later explicit arrangement. There is no fixed number of slots or three-card limit.

Fluid→Freeform and Structured→Freeform preserve current geometry. Freeform→Fluid resolves overlaps as one explicit undoable action. Entering Structured is one reversible policy change with no arrangement transformation. Structured→Fluid preserves clean geometry where possible. Active mode persists independently per workspace and survives restart. Empty Structured saves, checkpoints and checkpoint restoration preserve manual geometry exactly.

During explicit arrangement, unlocked placements follow a monotonic row-major cursor, so their visible reading order matches the persisted placement order. A later small placement cannot backfill a gap above an earlier wide resource. Locked placements remain exact reservations and may depart from reading order. A later direct drag does not reorder or repack this arrangement; explicit `reorderPlacements` is separate. Existing stored geometry is unchanged on load.

## Camera and recovery

Viewport uses the application's full-window convention: `screen = (world - viewportOrigin) * zoom`; safe editable `bounds` are supplied in workspace units. Camera-only `saveLayout {placements:[],viewport}` and matching preview intent `view` skip organization resolution, including unresolved legacy Fluid geometry. Panning is not an implicit Make Room operation.

Bring All Into View fits the union of blocks and Vela by changing the camera, preserving all canonical geometry, overlap, locks and dimensions. It accounts for the safe-area screen offset before calculating the next viewport origin. It is previewable and undoable. Positive finite zoom up to 4 is supported; large pannable layouts may require zoom below the previous .1 minimum. View origins allow ±1e12 to accommodate safe-header offsets at small zoom; block/presence coordinates retain ±1e6 practical limits. The host must render and persist this camera projection for the recovery control to work.

## Schema 4 and history compatibility

`004-organization.sql` adds `organization_json` and `legacy_organization_json` to the existing engine layout extension table and archives exact prior history/checkpoint JSON in `workspace_engine_v3_recovery_archive`. Kernel schema and signatures are unchanged. Schema3's presence identity, geometry, retry semantics, history and raw-v2 archive are preserved.

Legacy workspaces without an explicit organization policy receive Fluid metadata **without geometry changes**. A known explicit viewport organizationMode/organization.mode preference is retained, as is a legacy structured layout flag. The old kernel `freeform` flag alone is a geometry-storage label: the schema3 collision service wrote it even while enforcing Fluid behavior, so it does not prove an explicit manual-overlap preference. Migration does not normalize overlaps or quantize a structured layout. The user must choose the explicit undoable resolution/transformation.

Legacy snapshots missing organization are normalized against each workspace's migration baseline, including snapshots written later by DesktopState's earlier importer. Snapshot concurrency revisions are excluded from geometry fingerprints; live organization revisions remain monotonic tokens. Exact raw archives participate in resource-deletion dependency checks. A failed migration rolls back rather than resetting user data. Backup before applying deployment migrations.

## Verification and full-goal acceptance ledger

Current grid correction: six additional source tests cover exact mode/config entry with existing overlaps and locks; disk restart and undo/redo; later snapped drag and collision placement; fixed resize edges and circles; appearance-only edits; unchanged cards in full-layout payloads; raw Structured checkpoint restoration; explicit arrangement; and the existing Desktop adapter. The engine has 82 passing tests, with full strict engine/library TypeScript passing. The expanded engine/library and selected backend run passes 270 of 271 tests: the remaining backend-owned legacy assertion expects mode entry to rearrange geometry, which conflicts with the current preservation contract. Native confirmation at the integrated candidate remains required.

Historical engine checkpoint: 38 retained regressions plus 23 mode-policy tests passed (61 total); strict TypeScript and whitespace checks passed. The integration base's 31 backend and 12 kernel regressions also passed. Coverage includes new/inherited defaults; independent modes/restart; exact Freeform overlap/layers/presence persistence; predictive read-only preview/commit equality; local yielding; Structured 0/3/10/25/50 blocks, sizes/spans/reorder/presets; explicit span overrides and reset-to-automatic; all six transitions; durable undo and checkpoint restore of mode/config/geometry; view-only saves and safe recovery; locks, invalid policies and two-window stale revisions; raw legacy geometry/history and explicit preference migration; Vela preview/commit equality across all modes; circular shape validity; failed schema4 migration rollback; and interrupted process mode-change recovery.

### Pure preview performance

Run `npm run benchmark:modes` (or `node benchmark-modes.mts --output` to save a fresh receipt). [The historical measurement](evidence/mode-preview-benchmark.json) binds its older policy/contracts/resolver/benchmark source; its Structured timings describe the earlier implicit packer, not the current target-only grid. New runs also hash `structured-grid.mts`. The plan covers 3, 10, 25 and 50 blocks, all three modes, both drag and resize preview; 3 warm-ups then 20 samples for each combination, no removed outliers, no acceptance threshold. Twenty samples mean floor(n*p) p95 and p99 both select the maximum. Fixture construction/persistence is outside the measured interval.

On Windows 10.0.26300 / Node v24.18.0 / Ryzen AI 7 350, the saved 50-block results were:

| Mode | Drag p50 / p95 ms | Resize p50 / p95 ms |
|---|---|---|
| Fluid | 0.405 / 3.214 | 0.399 / 0.944 |
| Freeform | 0.033 / 0.072 | 0.032 / 0.058 |
| Structured | 0.144 / 0.187 | 0.136 / 0.154 |

These are synchronous pure layout calculations. They exclude rendering, displayed frame timing, IPC, SQLite/history serialization, native input latency and GPU work. Concurrent local workloads were not sampled or attributed. Actual rendering measurements and native visual experience remain separate milestone requirements, not implied by this table.

[The current grid receipt](evidence/structured-grid-preview-benchmark.json) uses the same predeclared plan and binds the target-only grid source. At 50 blocks, Structured drag p50/p95 was 0.179/0.393 ms and resize was 0.126/0.174 ms. It has the same pure-calculation limitations above and establishes no native interaction, rendering or sustained-load acceptance.

The complete regression run caught a reset-to-automatic serialization mismatch: a fresh projection included `columnCount:undefined`, while its persisted retry receipt omitted the property. Canonical projections now omit unset columnCount, preserving exact idempotent replay. The retry tests remain unchanged and are rerun for the corrected candidate.

| Directive scope | Authoritative completion evidence | Current engine checkpoint / remaining owner evidence |
|---|---|---|
| 0–1 architecture and same canonical workspace | Engine contracts, SQLite schema4, identity/persistence tests | Implemented/tested; no second database |
| 2 Fluid prediction, yielding, resize, Vela and motion | Pure policy tests plus native predictive mouse/keyboard recordings | Engine implemented/tested; shared native motion/preview evidence pending lead/renderer |
| 3 Freeform overlap, layers, recovery and glass | Persist/restart tests plus native overlap/material/selection evidence | Engine implemented/tested; native glass and obscured-item access pending |
| 4 Structured grid and explicit arrangement | Exact mode-entry preservation, later snapped drag/resize, explicit cells/spans/reorder/presets/presence, native restart | Engine implemented/tested; corrected integrated native experience pending |
| 5 default, per-workspace control, accessibility | Default/migration tests plus real selectable labeled keyboard control | Metadata tested; native control/accessibility pending |
| 6 safe mode switching/layout memory | Durable undo/redo/checkpoint tests plus native coordinated transitions | Engine tested; native transition evidence pending |
| 7 geometry/organization contracts | Typed organization projection and exact preview/commit comparison | Implemented/tested; trusted desktop adapter owned by lead |
| 8 shared motion domains/reduced motion/quality/scenes | Current Motion Coordinator + native cancellation/retarget/scene/recovery tests | No new scheduler; native combined evidence pending |
| 9 glass continuity | New native captures/video at exact integrated mode candidate | Renderer-owned; older material matrix cannot prove this candidate |
| 10 solver invariants/performance | Deterministic/minimal-neighbor/lock/no-op/invalid/identity tests and mode preview benchmarks | Functional checks and source-bound pure timing recorded; native rendering still pending |
| 11 concurrency | Scoped engine-only branch and exact API handoff | Active coordinated work with integration lead and visual worker |
| 12 required mixed native demonstrations | 3 conversations, 2 notes, 2 tasks, research, Intelligence Stream, Vela; Fluid/Freeform/Structured/transitions/cross-workspace + Constellation journeys | Pending integration/native owner; isolated geometry cannot substitute |
| 13 regressions | Engine/backend/kernel tests plus native graphics recovery, reduced motion, duplicate-label and glass checks at 3/10/25/50 | Engine checkpoint only; full native matrix pending |
| 14 performance | Separate layout timings and actual displayed rendering measurements with quality/idle/minimized recovery | Engine timing separate; renderer/native evidence pending |
| 15 artistic behavior | Native visual/motion review of all three modes and expressive Vela | Pending combined candidate review |
| 16 all 14 milestone acceptance items | Real app controls/default/distinct behavior, blocks/Vela, persistence, undo/redo, recoverability, shared motion/glass, input, Constellation, regressions, visual proof | **Full milestone unproven; keep goal active** |

This worker checkpoint is not final product completion. The active goal remains open until the actual integrated native candidate and required visual evidence satisfy the full directive.
