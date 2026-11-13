# FI-6 read-only workspace foundation

Program B / STANDARD_AUTONOMOUS / product-phase. Bounded implemented increment,
not FI-6 acceptance. Base: verified origin/main
`c470a5d23786ea2d5022553a1472e3643a619bb1`, descendant of `52b75ef0`.

**One continuous spatial universe. No disconnected screen changes.**

## Audit and ownership

Existing `mission-workroom-view.ts` resolves canonical workroom resources and
mounts `block-library/mission-flow.ts` through `ExperienceMotionPort`. Existing
`scene-state.ts`, `motion.ts` and renderer retain camera, focus and selection
responsibility. No existing six-zone AIW adapter was found in cinematic-v3/src.
`execution-profiler.mts` already owns richer execution projections; this increment
consumes the existing MissionProjection summary instead of computing another
critical path. No renderer, source owner, canonical schema or scheduler changed.

Governance registry and Constitution were reviewed; deterministic routing used
`FI-6 read-only Adaptive Intelligence Workspace projections accessible spatial interaction`
and the new source path. Section retrieval additionally requested AW-OBS-160,
AW-AEP-168, AW-EXP-200, AW-LIQ-200, AW-VELA-200 and AW-QVA-200, including dependent
trust, platform and quality domains. Authority remains the current registry, not
router default wording. Roadmap FI-6 permits early read-only adapters;
FI-ACC-37–46 remain open. Spatial index and ADR-003 retain canonical ownership.

## Exact source mapping

`src/adaptive-workspace.ts` exports `projectIntelligence` and
`createIntelligenceInspection` (relative to cinematic-v3).

| Zone | Current source | Deliberate limitation |
| --- | --- | --- |
| Decision | MissionProjection.planning responseId/model and planRevision | Recorded selection, not rationale or validator verdict; simulated receipts labeled |
| Resource | MissionProjection.admission readings/workerLimit | Timestamped admission snapshot, not live load or inferred policy epoch |
| Profiler | MissionProjection.profile | Existing summary, no invented critical path, percentiles, price or quality |
| Learning | None bound | Explicitly unavailable; verified tasks do not imply learned policies |
| Experiment | None bound | Explicitly unavailable; no FI-5 schema or lifecycle duplicated |
| Timeline | MissionProjection.events, keyed by mission ID and sequence | Retained mission journal, not adaptation history or a reconstructed event stream |

All references retain source IDs and field paths. Numeric missingness stays null;
zero remains zero. No prediction/estimate is generated. Scope includes exact
project (including null), workspace and mission. No raw prompts, evidence values
or cognitive rationale are copied into these projections.

## Integration seam and safety

This is an **unmounted prototype interaction contract**, not a shipped six-region
visual workspace. The source is TypeScript-consumable without backend runtime
imports. Bind an expected `IntelligenceBinding` from authorized canonical
workspace/mission state, and supply an existing authorization-aware mission read.
The adapter's scope check is defense in depth, not an authorization service.

The existing spatial inspection host may render `snapshot().regions` using
semantic headings, labeled values and provenance text. Pointer navigation uses
`navigate`, keyboard navigation uses `key` (Left/Right/Home/End), and both reach
the same regions without requiring animation. Host retains existing GPU world,
camera/focus anchors and reduced-motion policy; this controller neither owns nor
resets them. Bind canonical task selection via `selectTask`; refresh retains its
ID, marking unavailable tasks explicitly instead of selecting a different task.

On access change call `bind`, even for the same binding; on scope exit call
`bind(null)`. Both synchronously erase data and invalidate outstanding reads.
Refresh clears old content while checking access; disconnect, mismatched scope,
null read and revision regression fail closed. Snapshot copies cannot mutate
controller state. Mount/dispose, screen-reader semantics, focus return, live
subscriptions and host camera round trips still require integration tests.
There are no mutation, replay execution, experiment, promotion or rollback ports.

## Reproducible evidence

From repository root (Node 24.22.1):

```sh
node --experimental-strip-types --test prototypes/visual-experience/cinematic-v3/tests/adaptive-workspace.test.mjs
```

Passed: 4 tests, 0 failures. Fixtures are explicitly synthetic. Tests exercise
source references, zero/missing/simulated classification, three scope mismatches,
retained-away events/tasks, selection retention, stale revision, late reply after
revocation, disconnected read, snapshot isolation and keyboard/read-only ports.

From cinematic-v3 after `npm ci --ignore-scripts --no-audit --no-fund`:

```sh
./node_modules/.bin/tsc --noEmit --strict --skipLibCheck --allowImportingTsExtensions --target ES2023 --module ESNext --moduleResolution Bundler src/adaptive-workspace.ts
```

Passed, including canonical imported type contracts. Full `npm run typecheck`
failed on missing sibling dependencies `mammoth`, `fflate`, `pdfjs-dist` and
`three/addons/lines` with consequent errors in block-library/constellation.
No error identified the new file; full-project typecheck is **not passed**.
No broad suite, provider call, native or visual test was run.

## Remaining gates and handoff

- Cloud: mount through existing authorized spatial inspection surface, test host
  selection/camera/focus return and DOM accessibility, bind real AEP/ARIE and
  future FI-5 learning/experiment read contracts without redefining them. Restore
  sibling dependencies before full app checks. No execution topology replacement.
- Native Windows/GPU: packaged application with actual permitted mission data;
  moving-camera depth/occlusion and continuity, keyboard/screen-reader and reduced
  motion, GPU context loss, multi-display/window movement, foreground interference
  and frame-time/resource overhead measurements. These require the local app and
  hardware; this cloud module cannot establish them.
- Owner: artistic comparison and acceptance against the approved reference.
- Native Goal creation unavailable: no exposed native Goal endpoint/session was
  available in this environment. No substitute goal store was created.
- No merge, release, deployment or publication performed. Local commit is the
  integration deliverable; cherry-pick onto a verified current main and resolve
  future host wiring with the Program A renderer owner.
