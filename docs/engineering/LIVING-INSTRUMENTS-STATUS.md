# Living Instruments implementation status

This is an incremental implementation receipt for PR #20, not product acceptance.
The [design reference](../design/AERYNTH-LIVING-INSTRUMENTS-AND-EXPRESSIVE-PRESENCE.md)
remains the experience specification. Constitution 00 is binding; published specialist
charters remain advisory according to the governance registry.

## Integration and ownership

The isolated visual branch includes PR #19's committed `cfc64a4` baseline. Vela Redo
retains backend/native runtime, capability contracts, timer services, Vela panel,
client, voice and operational-state mapping. Explicit handoffs cover Block Library
visuals, Timeline/Stream/Note views, renderer geometry and its CPU projection,
`application.ts` motion wiring, and the two `main.ts` coordinator constructor calls.
No changes to the active checkout or its uncommitted backend work are included.
Further explicit handoffs cover additive Timeline planning service/dispatch,
timer visuals, thirteen-state visual observation, product-client passthrough,
contextual Stream motion wiring, task/agent/subject presentations and the
mission workroom presentation wrapper. Later
PR #19 commits require fresh reconciliation; this receipt is not a protected merge.

## Registered inventory

The sole registration authority is `prototypes/block-library/registry.ts`, whose
18 entries are projected by `instrumentDescriptor()` without adding a second
registry, data store, resource or permission authority. Media picker variants
(PDF, DOCX, video, generic file and link) remain import intents, not extra kinds.

| Kind | Canonical content / actual controls | Presentation work and remaining gap |
| --- | --- | --- |
| conversation | Conversation service; messages, composer, provider controls | Existing chat view retained; richer branch/mission presentation still pending |
| note | Canonical note/session; read/write, rename, copy, sources | Collapsible hierarchical reading sections; editor/selection preserved |
| research | Canonical notebook and source references | Same safe section presentation; richer evidence comparison remains pending |
| task | Manual description, priority, open/done | Shared status dial, actual Open/Done stages and contextual priority in workspace/direct views; description editor retained. Unsupported ownership/deadline/dependency fields are not invented |
| task_group | Canonical task references and member states | Segmented actual manual progress; grouped controls retained |
| checklist | Checklist service; items, groups, order, source links | Existing functional presentation retained; complete visual review pending |
| agent | Saved profile, effective configuration, assignment references | Requested-capability constellation and saved assignment paths; no execution assumption |
| timeline | Timeline service; immutable retained headers, view settings and distinct editable plans | Scaled orientations, clusters, recorded-time review; canonical planning CRUD/undo/snap/drag |
| task_objective | Objective service; requirements, execution links, manual review | Current requirement-review coverage, actual assignee/dependency cues; no invented completion |
| clock_timer | Timer service; countdowns, stopwatch/laps, world clocks | Native-bound countdown, zoned analog dials, stopwatch minute-cycle orbit; Focus presets are ordinary countdowns |
| reference | Canonical reference note, explicit source links | Collapsible reading sections; no automatic external fetching |
| stream | Authorized retained intelligence event window and current authorized mission | Explicit event causation plus separately labeled current mission branches/joins; bounded graph and inspection |
| file | Original source and format-specific readers | Existing PDF/DOCX/video/image/text paths retained; visual acceptance pending |
| folder | Explicit selected native folder and browsing | Reference-only; existing native browsing retained; visual acceptance pending |
| link | Canonical URL, explicit external opening | Existing native media/link policy retained; visual acceptance pending |
| project_overview | Canonical project, workspace/resource/task summaries | Actual project containment and resource structure summaries |
| resource_browser | Authorized resource discovery, filters, attachment | Loaded authorized-result kind navigation/counts; no global-count claim |
| collection_browser | Existing collection membership, resource navigation/attachment | Distinct collection-scoped loaded navigation; membership semantics retained |

No standalone metrics/environment block is registered. The Environment showroom
category accurately remains empty; no measurements or unsupported kinds are invented.

## Implemented foundation and signature changes

- Registry-derived descriptors expose current availability, actual capabilities,
  canonical bindings, minimum geometry, intent and presentation-mode contracts.
  Presentation mode changes retain resource identity and source revision.
- Semantic motion targets borrow the existing coordinator and host frame. Stream
  graph nodes and Vela harmonic coefficients retarget from their displayed pose.
- Stream defaults to Flow. Correlation alone never creates a causal edge; explicit
  causation/native identifiers are resolved within retained authorized evidence.
  Bounded graph windows disclose omitted/unresolved events and retain Forensic access.
- Timeline represents exact authorized source time, with timezone/offset labels,
  selected-anchor zoom, horizontal/vertical/source lanes, clustering, chronological
  keyboard navigation and scrubbable recorded-header review. Source history is immutable.
- Vela has thirteen distinct operational target geometries and matching CPU/GPU
  centerline evaluation. A pure visual projection consumes existing authorized
  phase, request, voice, wake and currently observed mission state. It does not
  initiate work or promote provider completion to verified mission success.
  An explicit geometry-review fixture has an unavoidable synthetic banner and
  never changes canonical activity. Live backend/voice coverage still needs acceptance.
- Library discovery uses seven intent categories and live manifest availability.
  Purpose-specific synthetic miniatures support finite coordinator-driven replay
  and manual stepping. Canonical insertion and reference-only restrictions remain.

## Acceptance reconciliation

| Scenarios | Current status / proof still required |
| --- | --- |
| LI-01, LI-02 | Source/component verified; native finite synthetic replay and real Add Note/Clock paths verified. Complete showroom visual review remains open |
| LI-03 | Real native Library drag/drop, canonical placement geometry, undo preserving resource, redo and restart verified |
| LI-04 | Canonical planning CRUD/undo, real pointer move/resize/snap, Escape cancellation and reduced-motion keyboard edits verified natively; full visual review remains open |
| LI-05 | Native orientation, selected event and canonical zoom verified; optional saved orientation/detail preferences tested at renderer/service level. Complete persistence/motion native review remains open |
| LI-06 | Partial: exact recorded-header time review, not historical state reconstruction or reexecution |
| LI-07, LI-08 | Real native CPU/RAM branches and their canonical multi-parent join, Flow/Glimpse/Forensic and restart verified. Current-plan dependencies remain distinct from historical event causation; busy/live provider missions remain open |
| LI-09 | Actual native source/task/attempt/evidence inspection and retained Forensic IDs verified; metadata allowlist and authorization filtering tested |
| LI-10, LI-11 | Thirteen target crops and a six-frame native morph sequence captured with explicit simulation label and unchanged canonical resources. Live backend/voice coverage and artistic acceptance remain open |
| LI-12 | Trusted native countdown creation/start/pause/resume, world dials and restart verified. Stopwatch service/view tests pass; complete native family review remains open. Focus preset is not a separate session domain |
| LI-13 | Notes/task-group/objective/agent/subject presentations upgraded; comprehensive family and native two-size acceptance remains open |
| LI-14, LI-15 | Native restart preserves Timeline viewport/selection/plans, paused timer duration, world zone and Library-dropped Note binding/geometry. Full layout recovery review remains open |
| LI-16 | Native planning keyboard edits under reduced motion verified; keyboard/static fallbacks and lifecycle tested at component level. Comprehensive accessibility review pending |
| LI-17 | Not accepted: realistic sustained load, CPU/GPU/RAM/frame-time and latency measurements required |
| LI-18 | Authorization/revocation/fallback regressions covered; native degradation review pending |
| LI-19 | Time-first Timeline and causality-first Stream implemented; native comparative review pending |
| LI-20 | Not accepted: complete Windows motion/recovery/performance journey remains required |

The initial existing `--integration-timeline` native journey failed before opening
the Timeline, waiting for startup control `#standalone-checklist`. It produced no
Timeline acceptance. Its failure receipt is preserved outside the public repository.
No passing unit test or static screenshot supersedes native acceptance.

A separate fresh-profile native runner then passed six structural checks in
12.039 seconds: Timeline orientation/selection/zoom and canonical restart,
Stream modes, finite Library replay, canonical Add Note, labeled synthetic
geometry and GPU diagnostics. It observed zero canonical executions and no
renderer errors/context loss. Native image review caught Timeline punctuation
encoding defects, which were fixed. Those captures bind the earlier built
candidate and do not verify later planning, clock or thirteen-state additions.

The later combined native candidate passed **9/9 checks in 34.268 seconds**:
Timeline orientation/selection/zoom; canonical planning create/edit/delete/undo;
Stream modes; finite Library replay and canonical Add; trusted-pointer countdown
and world-clock controls; bounded renderer observations; explicit thirteen-state
geometry and morph fixture; canonical Timeline/planning/timer restart; GPU diagnostics.
It recorded zero canonical executions, zero renderer errors/context loss and an
18,661,334-byte owned profile. The private evidence includes target crops, a labeled
empty-workspace study and six actual morph frames. It does not prove live voice
mapping, current mission joins, artistic approval, sustained load or multimonitor use.

The bounded callback sample observed p50 6.1 ms, p95/p99 6.2 ms and no intervals
above 16.67 ms within its 240-callback cap. These are renderer callback observations,
**not monitor presentation, input latency, whole-host CPU/GPU/RAM or acceptance targets**.
Earlier timer attempts correctly failed the gesture gate or rejected a hidden legacy
pointer target; their receipts remain preserved. The final verifier uses real
software pointer events on visible controls and leaves the gate intact.

A later interaction run verified real planning movement (+11 seconds), resizing
(30 to 36 seconds), unchanged canonical version/data after Escape, and exact
one-second keyboard move/resize under reduced motion. That combined run failed its
Library drop because the chosen pointer destination remained over the Library;
the dependent placement restart check consequently failed. A focused diagnostic
run then passed **3/3 checks in 7.890 seconds**: it probed actual hit-tested targets,
released over the confirmed workspace, and verified canonical Note placement,
undo preserving its resource, redo and exact placement recovery after restart.
Both owned Electron processes exited successfully, with zero renderer errors or
canonical executions. These complementary receipts are not a single all-pass run.

Optional Timeline orientation/detail persistence passed **42/42** focused tests
with renderer and backend typechecking. Omitted legacy preferences stay omitted;
this does not normalize old receipts or change their digests.

Hosted backend CI at `c7ab83f` and `10eeacb` passes dependency installation and typechecking,
then fails Ubuntu tests with `spawnSync git.exe ENOENT` in Vela-owned fixture paths.
The failure was sent to their owner; no tests or safety assertions were disabled.

The first mission-only native journey failed five UI readiness checks; only GPU
diagnostics passed. Its public-command fixture genuinely verified local CPU/RAM
sampling and the dependency join, but that service proof does not establish the
native card presentation. Both owned processes exited successfully; zero renderer
errors or canonical provider executions were recorded. No failure-time DOM capture
was available in that run; the receipt is preserved. Subsequent source inspection
found that direct-resource Stream/graph routes bypass the mission card wrapper,
while workspace placements use it. The Timeline harness also incorrectly expected
the primary instrument inside its now-separate forensic journal wrapper. Direct
mission routing was subsequently repaired and verified by the later journey below.

The corrected direct-resource adapter mounts known authorized mission Stream and
dashboard cards through the same wrapper used by workspace placements. It retains
canonical identity, delegates lifecycle/refresh, stops and redacts on access loss,
and prevents a previously bound card from falling through to a generic Note editor.
Ordinary Note/Stream paths and existing checklist/Timeline routing remain available.

The later **6/6 native mission journey passed in 12.011 seconds**, against asset
`index-CVsG98tw.js`. Two real local sampling tasks appeared side by side, with their
join below and exactly the canonical dependency edges. Task/source/attempt/evidence
metadata matched the actual public-command fixture; ten displayed Forensic event
IDs matched retained source rows. Glimpse, navigation cleanup (six task nodes to
zero), primary Timeline, idle Escape dismissal, visible Save without opening Filters,
and restart persistence passed. This is navigation cleanup, not a host-policy
revocation experiment. Both owned Electron processes exited successfully; zero
renderer errors or provider executions occurred during the native journey.

The focused capture also shows a remaining compact-workspace gap: wrapper controls
can consume most of a small mission card before the graph. Focused graph evidence
does not establish compact-card visual acceptance or complete Glimpse geometry review.

Live review rejected the Timeline's permanent button rows and the Stream's long
column. The revised Timeline exposes a quiet temporal canvas and one options
disclosure: drag pans, wheel zooms at the pointer, Shift+wheel pans, and Escape
cancels the preview. A gesture saves one canonical viewport after completion;
read-only navigation stays local, competing revisions are not overwritten and
pending gestures stop on suspension. Selection reveals source details. Precision,
planning, playback and Forensic controls remain inside options. **19/19** focused
Timeline tests pass, including gesture cancellation/coalescing and stale revisions.

Stream correction fixes graph-positioning CSS that was scoped to EventView and
therefore omitted standalone mission cards. Shared geometry now places parallel
roots side by side and real joins below their parents. Unlinked records are packed
as explicitly noncausal tiles, without invented edges. The showroom uses a clearly
synthetic branch/join example. **29/29** focused Stream/mission/showroom/workroom
tests, renderer typechecking and the revised production build pass.

The final focused native visual journey passed **5/5 checks in 8.917 seconds**
against asset `index-yBL9JjMj.js`: quiet default Timeline, real wheel zoom anchored
to delivered pointer coordinates, real drag-to-pan with exact saved timestamps,
Escape cancellation without a write or parent dismissal, and the synthetic Stream
branch/join preview. Cropped widget captures are retained privately. The owned
Electron process exited successfully; zero renderer errors or canonical executions
were observed. This verifies the revised preview and Timeline gestures, not the
direct mission routing, which was verified separately by the later journey above.

The first visual attempt exposed missing graph focus during pointer capture:
Escape dismissed the enclosing surface and the pending drag committed. Explicit
graph focus now preserves cancellation, covered by a focused regression and the
final native run. Earlier wheel assertions also incorrectly used requested fractional
coordinates and omitted per-event ISO millisecond truncation. The final verifier
replays delivered native coordinates and exact millisecond instants; no generic
tolerance was added. Earlier failed receipts remain preserved.

Reusable private-profile family setup uses public commands for a hierarchical
Note, manual task progress, an unreviewed objective, a saved agent, a local chat
and host-advertised subject browsers. Its single fresh-profile service smoke
passed with unchanged provider counters; native two-size family acceptance remains open.

Both retained-event and mission Flow navigation now use shared local pointer-pan
and pointer-anchored wheel gestures. Keyboard navigation remains available; precision
navigation is inside one Flow options disclosure. Gesture cancellation on Escape,
access suspension, deactivation and disposal is component-tested. Native mission
rendering above passed, but it did not independently exercise the new Flow gestures.

The shared manual Task instrument uses current canonical status and priority,
preserves pending saved state, and separates manual completion from execution
verification. Its five focused tests pass; a real Core/editor integration test also
verifies description flush before status CAS, fresh versions, priority updates and
retained editor identity. Task mutations remain in the existing command queue;
inner draft flushing does not wait on its own queued task operation. Native manual
Task and complete family review remain open. The combined focused regression is
**52/52 passed**; renderer typecheck and production build passed.
The desktop regression passed **687 tests, 1 skipped, 0 failed**. Its initial
attempt found a missing manual-task map in the isolated clock-activity VM fixture;
adding that fixture dependency preserved the clock assertions, and the full suite
then passed. No product assertions were disabled.

Reproduce from the repository root with
`node --experimental-strip-types scripts/verify-living-instruments-native.mjs`.
The optional `--timer-only` mode records skipped scenarios and validates just native
timer controls/restart/GPU diagnostics. Every run creates a fresh private synthetic
profile, binds source/build hashes, enforces byte/runtime limits and cleans up only
its owned processes. It never operates an existing review or sends provider work.
`--visual-only` checks the quiet Timeline and direct gestures plus the explicitly
synthetic Stream preview. `--interaction-only` and `--drop-only` retain the separate
planning and Library placement checks. `--mission-only` verifies the scoped
local-sampling mission journey described above; its first failed receipt remains
preserved separately.

Checkpoint regression: **346/346** combined Block Library, Timeline service and
backend-domain tests; **683 passed, 1 skipped, 0 failed** desktop tests; final focused
direct-resource wrapper **10/10**; backend and renderer TypeScript checks and the
production build passed. Source changes after this checkpoint require targeted
revalidation rather than reusing these results unchanged.

Focused and broader verification receipts are recorded with each implementation
checkpoint. Private profiles, raw local evidence, logs and recordings stay outside
this public repository. Do not publish private conversation or machine data.
