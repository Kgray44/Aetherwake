# Canonical Task Objective foundation

`TaskObjectiveService` persists desired outcomes and accountable manual decisions
on the injected **same** `WorkspaceKernel` SQLite connection. New resources use
canonical `generic` plus `desktop_resources.kind='task_objective'`; a future UI
may call this Task Tracker. Existing Note-backed semantic `task` records remain
manual compatibility Tasks with their original IDs, content, statuses and history.
This module never converts them or changes AgentService's current manual-only
Task adapter.

The Constitution is binding. Routed **03, 05, 09, 14 and 15** are published
advisory charters pending owner acceptance. This is a source-tested foundation,
not complete task orchestration or a Task Tracker interface.

## Typed service and host

`new TaskObjectiveService(kernel, host)` requires `host.db` to be that Kernel's
actual `DatabaseSync` connection with foreign keys enabled. All methods compose
synchronously through `kernel.withTransaction`. The host owns outer Core.atomic
and any post-commit event delivery. No renderer receives this service or DB.

The required trusted host provides current identity (`user` / `manual` only),
clock, operation authorization, project/resource/message access, canonical Task
resource read/create/touch, source reference and assignee metadata resolution,
an **existing** execution metadata reader, and an inside-transaction metadata
event callback. There is no allow-all or synthetic-metadata fallback. `now()`
must provide truthful production time; tests may supply an explicitly synthetic
clock. Authorization responses must match the current actor's policy version.
Actor, authority and authorization references never come from command arguments.

Source resolution must verify actual current IDs, optional visible message IDs,
project association and content freshness. Its opaque revision must cover actual
content changes (including conversation message revisions), not just a resource
title/version. Assignee resolution must read a real canonical Agent profile and
versions, or a host-known assignable principal. Sources are references, not
automatic sharing, retrieval, content reads or execution permission.

The existing-execution reader projects exactly `TaskExecutionMetadata`: canonical
ID/revision/resource/provider/command/state and nullable native thread/turn/response
IDs. It must apply current read policy before returning metadata. It must not
probe a provider or cast an entire private execution object into this interface.
The revision is host-derived from the actual existing record; missing or changed
revisions are not silently rebound.

| Method    | Behavior                                                                   |
| --------- | -------------------------------------------------------------------------- |
| `create`  | Explicitly create an independent canonical objective and definition        |
| `read`    | Current authorized definition, references, manual decisions and proofs     |
| `mutate`  | One typed, canonical-version-fenced operation with a command receipt       |
| `history` | Bounded whole domain-version snapshots, current reference permissions      |
| `list`    | Authorized canonical resource metadata without source-body/execution reads |

`mutate` accepts only `replaceDefinition`, `linkAttempt`, `review`, `accept`,
`reopen` or `administrativeCancel`. There is no reflective command invocation,
Start, run, permission grant, provider cancellation or execution adapter.
The browser-safe `TaskObjectivePort` mirrors these calls asynchronously for a
future transport. This module does not wire one.

## Definitions, execution and outcome truth

A definition contains the objective, stable criterion IDs/text, typed assignee
references, dependencies and source references. Every explicit replacement
increments `definitionVersion`, even if text happens to match an older version.
Previous definitions and decisions remain immutable in domain history. Canonical
resource versions fence all mutations. External canonical title-only changes can
advance the resource fence without inventing a domain mutation; history reports
the actual versions at which domain changes occurred.

Attempts contain immutable **references** to existing execution ID/revision plus
the applicable definition version/digest and manual linking provenance. They are
labelled `user-linked-existing-execution`, not claimed newly executed work. The
service does not store an execution state, provider transcript, native binding,
runner, liveness lease or task result. Each read resolves current host metadata;
running, provider-completed, failed, interrupted and unknown remain distinct.
An execution changing after link is shown changed, with the real current state.

`provider_completed` never produces verification or acceptance. A manual review
must state its decision, the criteria it covers and source-linked evidence.
Verified decisions require actual current evidence. A review optionally linked
to an attempt binds the execution's current revision, not a stale checkpoint.
A general negative review blocks the objective until explicitly superseded by
later evidence-backed criterion reviews. Acceptance is a separate authorized
operation covering every current criterion with the latest applicable verified
reviews and current, accepted dependencies.

An authorized person may independently verify/accept an outcome using actual
evidence while a separate execution remains unknown. That decision never rewrites
execution truth or claims the provider succeeded. An acceptance with changed policy
or changed/revoked upstream sources/evidence/dependencies projects stale/unavailable; its
recorded disposition and attributable decision are not erased or rewritten.
Reopening preserves prior acceptance as historical. Dependency cycles and bounded
unprovable graphs reject; no resource grants are broadened during traversal.

`administrativeCancel` changes only the Task disposition. Every mutation receipt
explicitly says `executionEffects:'none'`; it never confirms a provider stop or
rolls back earlier work. Capabilities advertise reference-only execution, no
Start/interruption and no automatic verification/acceptance.

## Persistence, privacy and bounds

Additive schema **1** consists of `task_objective_schema`, current documents,
immutable domain versions and idempotent receipts. Only explicit creation does
DDL. Empty list/unknown reads do not initialize it. Future, partial and corrupt
schemas/data fail closed without reset. Kernel resources and desktop semantics
remain canonical; there is no second resource, chat, execution or event database.
Receipts contain only result IDs/versions/digests and the request fingerprint.
Events contain operation, actor, policy/authorization provenance, Task versions,
digests, disposition, counts and a created internal record ID, not objective,
criterion, source body, review text or private reasoning.

Read/history revalidate current references and redact unavailable linked IDs and
metadata. Source bodies, chats, drafts, tools and external content are never
loaded or copied. Definition/review text is separately authorized Task-owned
content authored by its caller, not an automatically imported source summary.
`canEdit` is a current host read hint; every mutation independently checks
current write and operation policy.

Bounds include 256 objectives, 4,096 immutable domain versions, 8,192 receipts,
128 KiB stored state, 32 MiB aggregate domain JSON payload (plus SQLite/canonical
table overhead), 64 attempts, 128 reviews, 64 acceptances, 32 criteria/dependencies/
source references and 16 assignees/evidence references per applicable collection.
Read proof resolution is bounded to 256 distinct metadata resolutions and reports
`proofCoverage:'bounded'`; incomplete proofs never authorize acceptance. Read and
history responses are capped at 512 KiB. History packs whole versions with a
continuation and never truncates a body. A single oversized projection rejects.
Capacity exhaustion preserves existing history; there is no silent eviction.

## Source checks and remaining work

Run `node --test prototypes/task-product/tests/service.test.mts` at repository
root. Fixtures use the actual Kernel/Desktop SQLite implementation, synthetic
existing Core execution/message metadata in its `integration_state` schema,
real canonical Notes/Agent profiles, and a retained same-file synthetic restart
database under ignored `.runtime/task-product-tests`. They do not run Core/provider
execution, a native app, credentials, network calls or private user profiles.

This isolated release passed all **16** SQLite tests and strict TypeScript with
zero diagnostics using the already installed compiler and Node declarations.
No dependencies were installed.

Core/RPC/native policy wiring, the real Task adapter for Agent assignments,
Task Tracker/blocks, actual Task Start/agent execution/cancel/reconciliation,
task promotion, scheduling, subtasks/workflows, priorities/deadlines, native
appearance/performance, archive/delete/export/retention management and live
provider acceptance are separate unimplemented work. No execution control or
product-completion claim should be inferred from this foundation.
