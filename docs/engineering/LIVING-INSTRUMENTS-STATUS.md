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
contextual Stream motion wiring and task/agent/subject presentations. Later
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
| task | Manual description, priority, open/done | Existing controls retained; milestone/dependency visualization pending |
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
| LI-03 | Existing canonical Add/drop paths retained and tested; new native drag/restart proof pending |
| LI-04 | Canonical planning CRUD/undo verified natively; explicit offsets, elapsed durations, drag/snap/CAS/cancel behavior tested at component/service level. Native drag/duration demonstration remains open |
| LI-05 | Native orientation, selected event and canonical zoom verified; presentation preference persistence and complete motion review remain open |
| LI-06 | Partial: exact recorded-header time review, not historical state reconstruction or reexecution |
| LI-07, LI-08 | Explicit causal event edges plus real current-plan task dependencies/joins implemented; current-plan edges are not historical event causation. Native mission-flow journey pending |
| LI-09 | Metadata allowlist and authorization filtering tested; native inspection pending |
| LI-10, LI-11 | Thirteen target crops and a six-frame native morph sequence captured with explicit simulation label and unchanged canonical resources. Live backend/voice coverage and artistic acceptance remain open |
| LI-12 | Trusted native countdown creation/start/pause/resume, world dials and restart verified. Stopwatch service/view tests pass; complete native family review remains open. Focus preset is not a separate session domain |
| LI-13 | Notes/task-group/objective/agent/subject presentations upgraded; comprehensive family and native two-size acceptance remains open |
| LI-14, LI-15 | Native restart preserves Timeline viewport/selection/plans, paused timer duration and world zone; canonical Add Note/Clock verified. Full layout/drag recovery review remains open |
| LI-16 | Keyboard/static fallbacks and reduced-motion lifecycle tested at component level; native accessibility review pending |
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

Reproduce from the repository root with
`node --experimental-strip-types scripts/verify-living-instruments-native.mjs`.
The optional `--timer-only` mode records skipped scenarios and validates just native
timer controls/restart/GPU diagnostics. Every run creates a fresh private synthetic
profile, binds source/build hashes, enforces byte/runtime limits and cleans up only
its owned processes. It never operates an existing review or sends provider work.

Checkpoint regression: **346/346** combined Block Library, Timeline service and
backend-domain tests; **683 passed, 1 skipped, 0 failed** desktop tests; final focused
direct-resource wrapper **10/10**; backend and renderer TypeScript checks and the
production build passed. Source changes after this checkpoint require targeted
revalidation rather than reusing these results unchanged.

Focused and broader verification receipts are recorded with each implementation
checkpoint. Private profiles, raw local evidence, logs and recordings stay outside
this public repository. Do not publish private conversation or machine data.
