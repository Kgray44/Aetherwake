# Vela mission execution

This records the integrated mission slice. The [traceability matrix](../engineering/VELA-MISSION-TRACEABILITY.md)
tracks work and acceptance beyond this slice. The [AIR specification](../specifications/VELA-ADAPTIVE-INTELLIGENCE-ROUTING.md)
continues to govern the ordinary routing design; this change does not ratify it.

```mermaid
flowchart LR
  Send["Vela Send"] --> Check{"Supported mission objective<br/>and no turn-level provider pin?"}
  Check -- No --> AIR["Existing AIR and ordinary/Codex paths"]
  Check -- Yes --> Preview["Canonical graph preview"]
  Check -- "Explicit mission beyond a native route" --> PlanningReview["Native review of one planning request"]
  PlanningReview --> Compiler["Validate proposal against host capability catalog"]
  Compiler --> Preview
  Preview --> Consent["Explicit Start<br/>native review for provider calls"]
  Consent --> Journal["Mission journal in canonical SQLite"]
  Journal --> Scheduler["Fair bounded admission"]
  Scheduler --> Context["Scoped context compiler"]
  Context --> Native["Native measurements and static inspection"]
  Context --> Codex["Reviewed tests in the<br/>read-only Codex sandbox"]
  Context --> Agents["Isolated stateless specialist requests"]
  Native --> Verify["Evidence checks and joins"]
  Codex --> Verify
  Agents --> Verify
  Verify --> Journal
  Journal --> Panel["Missions: graph, timeline, evidence and controls"]
  Journal --> Cards["Linked Checklist and Timeline"]
  Journal --> Stream["Redacted Intelligence Stream events"]
  Library["Block Library"] --> Architect["Purpose and scoped resource metadata"]
  Architect --> Layout["Deterministic arrangement"]
  Layout --> Apply["Preview, validate and apply via TemplateService"]
  Apply --> Workroom["Linked workroom and canonical mission journal"]
```

The deterministic planner recognizes explicit host sampling and Aerynth backend
performance objectives. Performance work
uses a real worker timer, host counters and a bounded scan of the shipped Core
module. An observed timer outlier adds one follow-up measurement before the
report without changing the original acceptance criteria. Counts of source
call sites do not establish a measured bottleneck.

An explicit mission request outside the deterministic routes can request a graph
proposal from the connected ChatGPT plan model. The native approval displays the
objective, selected model and available capability descriptions. The single
request sends the objective and public capability descriptions. Its response can
select catalog tasks and dependency edges. The host supplies executable task
definitions, resource claims, limits, verification criteria and the evidence join.
The compiler rejects malformed graphs and proposals that report unsupported
outcomes. The graph preview lets the user check whether the interpretation
covers the original objective. Start requires the reviewed fingerprint and
current workspace, plus any specialist or checkout approvals. Hosted specialists
can run as independent branches. Their approvals cover objective text and role
instructions, so the host rejects proposals with prerequisites on hosted
specialist tasks. The planner can configure up to two temporary specialists
with a single-line title and responsibility. The host controls provider,
model, tools and execution budget. The role exists only in its mission.
A confirmed planning receipt contributes to mission
duration and reported usage. Admitted planning requests are fenced against
replay after interruption or restart.

The selected-tests route asks for a native file selection and displays the
exact checkout, commit and argument vector. It uses the existing Codex App
Server local command runner with zero model inference. It requests restricted
network access. Effective isolation depends on the installed sandbox mode.
The worker rechecks the selected tracked files, checkout identity and sandbox
availability at dispatch and validates the TAP result after execution. The
profile records zero model calls for this lane.

Mission rows are independent of conversation history and remain in the same
database as projects, resources and layouts. Additive startup creates the
mission tables and preserves existing schema versions. Mission and attempt IDs
correlate the journal and events; a review fingerprint binds the proposed graph,
workspace, provider controls and applicable profile versions. Mission access
requires the current canonical workspace scope. The scheduler separately
checks whether a queued or in-flight task still has authority.

The Intelligence Stream carries typed lifecycle records with the originating
workspace, mission, task and attempt identities. Workspace visibility is
checked for live delivery and replay. Older detached entries recover scope
from matching journal records. Stream rows carry lifecycle metadata. Vela
formats numeric CPU, GPU and physical-memory results from verified native
evidence and shows them in the selected mission. A verified mission devoted
to host measurements also answers in its originating Vela chat. The scoped
answer links to the same evidence and is kept out of provider history.

Before dispatch, the journal records an attempt and a context manifest with
scope, dependency evidence digests and estimated context size. The compiler
keeps required inputs, rereads selected sources on validation and does not
store note bodies in the mission. The local Notes adapter is used only on the
explicit workspace-notes route and reads the mission's originating workspace
even if the user navigates elsewhere. A bounded cache reuses ranking scores
after fresh authorized reads. Budget compaction defers whole optional sources
and retains a limited set of versioned pointers for revalidation. Mandatory
constraints and verified dependency outputs remain intact. Dispatch, result
acceptance and downstream evidence reuse check current source proofs. Stale
proofs hide the affected evidence and mark current verification as blocked.
An explicit retry may re-run an affected replay-safe task within its attempt
budget. Existing conversation and Codex sessions continue to own their
respective histories.

Admission rotates between missions; within a mission it favors older work and
uses priority to order tasks within an age band. It enforces worker and provider
limits, the mission's parallelism setting, exclusive resource claims and a
physical-memory floor. A dependency join waits for verified prerequisites
and retains each contributing identity. Pause stops new admissions. A timeout
or cancellation does not release a claim until the worker settles. On restart,
in-flight external attempts become uncertain and are not replayed; interrupted
read-only work requires a deliberate retry, and queued missions reopen paused.
Evidence-triggered amendments record the triggering task and attempt and can
only repeat a replay-safe executor within the already reviewed claims. The
report waits for the added sample and the original criteria stay intact.

Specialists use the existing stateless Responses transport and credential
broker. The native review lists exactly which objective and instructions each
request sends. Live catalog identity, current connection and shared daily
limits are rechecked at dispatch. A selected Agent Library profile can supply
the first role's settings and instructions; edits invalidate the preview.
Specialists have separate attempt and response identities. They return
attributed recommendations; verification of the report contract is distinct
from verifying the recommendations. The reviewed specialist route does not
transfer files, note content, measurement values or conversation history.
An explicit research mission permits only the source specialist to use the
existing hosted web search. That role must return provider-attributed HTTPS
citations; its partner receives no tools. Citation presence is distinct from
independent factual confirmation.

Saved teams combine two to four existing Agent Library profiles with reviewed
responsibilities. The roster is reusable across authorized workspaces in a
project, or inside its originating standalone workspace. Versioned saves and
archives fence stale writes. Starting a team mission binds the roster version
and each profile version to separate hosted tasks. A local join waits for all
verified report contracts, retains the member task, attempt and evidence IDs,
and indexes repeated observations by normalized text. Claims and contradictions
remain attributable to the individual reports. The user can post one durable
evidence link for a verified mission to the originating Vela chat. The link
is visible only from the originating workspace and stays outside model history.
Evidence remains in the mission journal.

The journal distinguishes native measurements, provider-reported usage and
unknown usage. Mission metrics use recorded transitions and do not convert
tokens into money. Attempt details separate queue time, context preparation,
executor duration and verification time. Interrupted attempts can lack final
spans. The native benchmark measures the same workload with one
and two workers. An opt-in concurrent run samples backend process CPU, RSS
and event-loop delay, and compares admission with and without injected
pressure. Neither run measures cloud model or renderer performance.

The Workspace Architect builds a purpose-specific draft from allowed block
kinds and scoped resource metadata. It reuses canonical IDs, chooses dimensions
from block constraints, and applies through the existing versioned template
transaction. Placement changes retain existing layout history. Desktop
template operations and mission execution both use the canonical services;
the template planner does not create a second workspace store.
From an active or settled mission, the user can review a workroom's proposed
cards and create the workspace and its reusable template. Timeline creation,
template apply and the mission-to-workroom link share one transaction. The
graph, checklist, timeline, verification and performance cards project the
mission journal. A mission with specialists also receives a team card with
the assigned roles and recorded task states. The Intelligence Stream card
reads up to 128 recent retained events by mission identity from the existing
Intelligence Stream store. Its cursor and event IDs are the same as those in
the originating workspace's stream. An authorized linked workroom receives
the redacted lifecycle notification so its cards refresh while the mission
runs. General stream replay uses its own workspace scope. The workroom also
has a canonical local conversation and supporting resources selected by the
architect. The initial camera leaves the graph and conversation below the
workspace toolbar.

The backend verifies access to both workspaces and to the exact card
placement before returning a projection. Card bindings are optional in older
workrooms. Manual checklist entries and ordinary timeline settings retain
their own canonical storage and controls. Specialist evidence identifies
provider-reported findings and separates evidence checks from the claims in
those findings. Usage stays unavailable when the provider supplied no report.

The New Workspace dialog opens this same architect through Ask Vela. It
retains the selected project and allows editing the purpose before requesting
a proposal. Saving a Vela proposal uses the host-issued layout and provenance,
revalidates selected resource bindings, and accepts the reviewed subset.

Workspace Actions can preview an optimization for explicitly selected movable
cards against the current viewport. The solver preserves camera, dimensions,
rotations and all unselected geometry. It reports cards that cannot fit and
keeps their current positions. The review is invalidated by navigation, layout
changes, panning, zoom or resize. Apply uses the reviewed revision and bounds
and records one undoable layout operation.
