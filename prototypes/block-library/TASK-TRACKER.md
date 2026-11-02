# Task Tracker experience

`mountTaskTrackerExperience` presents one canonical `task_objective` through the
Root-owned `TaskObjectivePort`. Its objective and stable requirement identities,
reference bindings, existing execution references, manual review records and
acceptance are separate. Existing Note-backed manual Tasks are unchanged.

The compact outcome rail distinguishes disposition, manual verification and
acceptance. Objective text has a document-like reading treatment; requirements
are explicit criteria rather than completion checkboxes. Editing, review,
acceptance, administrative close and history disclose their own forms. Source
bodies, private execution identifiers and provider transcripts are not rendered.

Pass a unique `viewId`, the shared `ExperienceMotionPort`, and optionally `active`,
`presentation`, `showTitle`, `onProjection`, `openResource` and `resourceTitle`.
Optional `chooseSource`, `chooseAssignee`, `chooseDependency` and
`chooseExistingExecution` callbacks must return actual current authorized typed
references from Root. Missing selectors are disabled; there is no raw-ID form or
revision construction. The component contains no execution runner or permission
grant. Administrative close does not stop an execution.

The owner drives `frame` and calls `reflow` after host layout changes. It must
refresh on Task changes **and on relevant source, execution, dependency, Agent
profile or policy changes**: freshness can change without a Task version change.
There is no component polling, animation clock or global observer. `setActive`
prevents hidden reads, `setPresentation` retains the same view, and `dispose`
removes only this view's motion keys. The host must check `hasUnsavedChanges`
before abandoning local drafts; `flush` waits for writes and rejects unresolved
acknowledgments or acknowledged writes that still require a fresh read.

Definition saves preserve newer input when the resource notification arrives
before the command acknowledgment. Competing saved definitions require an
explicit choice. Changed definitions also require explicit current-definition
review before a manual decision can be recorded. Unknown write outcomes retain
the exact command for a durable receipt retry. Inaccessible references remain
explicit unavailable slots until removed or replaced. Current access denial
clears rendered content and pending history responses while retaining local
drafts in this mounted view.

History loads eight whole versions per page and replaces the previous page.
History is metadata and objective version inspection, not application replay or
an execution-state restore. The service rechecks access, proof coverage,
dependencies, evidence freshness and authority for every applicable operation.

Source validation uses the actual Task service and Kernel SQLite schema with
explicit synthetic host policy and existing Core execution metadata fixtures,
plus the actual shared MotionCoordinator and finite CPU DOM events. It covers
separate review/acceptance, unchanged manual Task content, no hidden block or
workspace creation, receipt retry, freshness, access redaction, competing edits,
current-definition review, late history and inactive reads. This does not prove
native input, rendered appearance, Core authorization, provider behavior,
performance or whole-product acceptance. Root owns those integration receipts.

The reference-only `Task Tracker` manifest uses a 600 x 540 rounded default and
an objective-specific compact and overview composition. Generic creation rejects
with `task_objective_creation_required`; template roles must explicitly reuse
the saved objective (`task_objective_template_reference_required`). Direct
opening accepts `DirectResourcePorts.taskObjectives` with the same component
options and exposes `refresh`, `frame`, `reflow`, `flush` and `hasUnsavedChanges`.
Root must promote the `task_objective` presentation kind in its shared contract,
mount the workspace component and enable its capability only when actual host
resolution and service access are wired. A canonical kind alone does not enable
a workspace presentation. Native acceptance is still required.
