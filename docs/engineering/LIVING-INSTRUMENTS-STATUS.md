# Living Instruments implementation status

This is an incremental implementation receipt for PR #20, not product acceptance.
The [design reference](../design/AERYNTH-LIVING-INSTRUMENTS-AND-EXPRESSIVE-PRESENCE.md)
remains the experience specification. Constitution 00 is binding; published specialist
charters remain advisory according to the governance registry.

## Integration and ownership

The isolated visual branch includes PR #19's committed `2f8d39c` baseline. Vela Redo
retains backend/native runtime, capability contracts, timer services, Vela panel,
client, voice and operational-state mapping. Explicit handoffs cover Block Library
visuals, Timeline/Stream/Note views, renderer geometry and its CPU projection,
`application.ts` motion wiring, and the two `main.ts` coordinator constructor calls.
No changes to the active checkout or its uncommitted backend work are included.
Later PR #19 commits require fresh reconciliation; this receipt is not a merge.

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
| task_group | Canonical task references and member states | Existing grouping retained; richer progress/dependency geometry pending |
| checklist | Checklist service; items, groups, order, source links | Existing functional presentation retained; complete visual review pending |
| agent | Saved profile, effective configuration, assignment references | Reference-only; never presented as an executing agent; team visualization pending |
| timeline | Timeline service; retained authorized event headers and saved viewport | Scaled axis, orientations, lanes, clusters, inspection, recorded-time review; planning CRUD unavailable |
| task_objective | Objective service; requirements, execution links, manual review | Existing tracker retained; further visual integration pending |
| clock_timer | Timer service; countdowns, stopwatch/laps, world clocks | Existing native-bound radial countdown retained; focus-session and full native acceptance pending |
| reference | Canonical reference note, explicit source links | Collapsible reading sections; no automatic external fetching |
| stream | Authorized retained intelligence event window | Flow/Glimpse/Forensic, explicit causal edges, node/branch inspection, bounded graph; canonical joins/playback pending |
| file | Original source and format-specific readers | Existing PDF/DOCX/video/image/text paths retained; visual acceptance pending |
| folder | Explicit selected native folder and browsing | Reference-only; existing native browsing retained; visual acceptance pending |
| link | Canonical URL, explicit external opening | Existing native media/link policy retained; visual acceptance pending |
| project_overview | Canonical project, workspace/resource/task summaries | Existing subject view retained; further visualization pending |
| resource_browser | Authorized resource discovery, filters, attachment | Existing navigation retained; distinct showroom discovery added separately |
| collection_browser | Existing collection membership, resource navigation/attachment | Existing membership semantics retained; richer collection presentation pending |

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
- Vela's eight existing exposed states have distinct harmonic target geometry and
  matching CPU/GPU centerline evaluation. Working contracts to a lens. This does
  **not** establish all thirteen requested operational states or native visual quality.
- Library discovery uses seven intent categories and live manifest availability.
  Purpose-specific synthetic miniatures support finite coordinator-driven replay
  and manual stepping. Canonical insertion and reference-only restrictions remain.

## Acceptance reconciliation

| Scenarios | Current status / proof still required |
| --- | --- |
| LI-01, LI-02 | Source/component verified; native showroom and replay review pending |
| LI-03 | Existing canonical Add/drop paths retained and tested; new native drag/restart proof pending |
| LI-04 | Blocked at service boundary: TimelinePort exposes retained headers and view saves, not editable schedule events or durations |
| LI-05 | Source/component verified for orientation, selected-anchor zoom and pan; presentation preference persistence/native motion pending |
| LI-06 | Partial: exact recorded-header time review, not historical state reconstruction or reexecution |
| LI-07, LI-08 | Partial: explicit causal edges supported; mission lifecycle projection does not expose prerequisite/join edges or agent dependency graph |
| LI-09 | Metadata allowlist and authorization filtering tested; native inspection pending |
| LI-10, LI-11 | Partial: eight existing states, continuous geometric targets and CPU bounds tests; thirteen-state backend/voice mapping and native shape review pending |
| LI-12 | Existing native timer service retained; complete new timer/focus-session acceptance pending |
| LI-13 | Partial: Notes reading upgrade; remaining family transformations and native two-size review pending |
| LI-14, LI-15 | Existing workspace/canonical persistence paths retained; candidate-specific native recovery review pending |
| LI-16 | Keyboard/static fallbacks and reduced-motion lifecycle tested at component level; native accessibility review pending |
| LI-17 | Not accepted: realistic sustained load, CPU/GPU/RAM/frame-time and latency measurements required |
| LI-18 | Authorization/revocation/fallback regressions covered; native degradation review pending |
| LI-19 | Time-first Timeline and causality-first Stream implemented; native comparative review pending |
| LI-20 | Not accepted: complete Windows motion/recovery/performance journey remains required |

The initial existing `--integration-timeline` native journey failed before opening
the Timeline, waiting for startup control `#standalone-checklist`. It produced no
Timeline acceptance. Its failure receipt is preserved outside the public repository.
No passing unit test or static screenshot supersedes native acceptance.

Focused and broader verification receipts are recorded with each implementation
checkpoint. Private profiles, raw local evidence, logs and recordings stay outside
this public repository. Do not publish private conversation or machine data.
