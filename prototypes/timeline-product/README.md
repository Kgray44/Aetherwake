# Activity / Execution Timeline foundation

This source-only module persists an explicitly created Timeline view of the
existing retained `intelligence_events` store. It does not create an event store,
ingest events, run a provider, schedule work, create placements, or reconstruct
past application state. No application UI or native transport is wired here.

The Constitution is binding. Routed charters **03, 09, 11, 14 and 15** are published
advisory documents pending owner acceptance; this module does not claim their
ratification or complete product acceptance.

## Canonical host and commands

`new TimelineService(kernel, host)` requires the **same** `DatabaseSync` connection
owned by the injected `WorkspaceKernel`, with foreign keys enabled. Every method
uses `kernel.withTransaction`; trusted synchronous host mutations compose inside
that transaction. The host must provide:

- `identity()` returning the current principal ID and policy version.
- `projectAccess(id)`, `resourceAccess(id)` and **required** `eventAccess(header)`.
  A false/throwing event policy denies even a header with no associated resource.
- `readResource(id)` returning the actual canonical semantic Timeline reference,
  current authorization and writability.
- `createResource({kind:'timeline',title,projectId,commandId})` creating a new
  canonical `generic` resource plus `desktop_resources.kind='timeline'` mapping.
- `touchResource({resourceId,expectedVersion,commandId})` advancing the actual
  canonical generic resource version, without changing identity/ownership/title.
- `recordEvent(event)` recording only bounded IDs/counts/provenance metadata in
  the existing canonical event path. It runs **inside** the transaction; the host
  owns any external/post-commit publication buffer. This module never publishes
  events or maintains a second delivery mechanism.

Public service methods are synchronous. Browser-safe `TimelinePort` describes the
corresponding asynchronous transport contract; it grants no storage/policy access:

| Method   | Input                                                     | Result                                         |
| -------- | --------------------------------------------------------- | ---------------------------------------------- |
| `create` | command ID, title, nullable project ID, view              | canonical resource ID/version/view digest      |
| `read`   | resource ID                                               | authorized view/configuration and capabilities |
| `save`   | command ID, resource ID, expected canonical version, view | new version/view digest                        |
| `query`  | resource ID, expected version, optional limit/page        | bounded retained-header window                 |

The host must return a newly inserted resource on create; adopting an existing
resource is rejected. There is no Note, workspace, block, conversation, task or
execution substitute. The host can instantiate this service per dispatch; it has
no mutable cache that could survive an outer rollback incorrectly.

## Storage, versions and scope

Only an explicit `create` initializes additive schema **1**:
`timeline_schema`, `timeline_views`, `timeline_receipts`. Unknown reads do no DDL
or phantom-resource creation. Missing/partial/future/invalid schemas fail closed;
they are never reset. The existing kernel and desktop schemas are not migrated.
Views retain the creating principal, exact validated configuration, SHA-256
digest and wall-clock creation/update timestamps. Command receipts retain only
the request fingerprint and resource/version/view-digest result, not event bodies.
Command reuse with different input rejects; exact replays return the original
receipt after current canonical write authorization. Saves use the real canonical
resource version, including across restart and competing service instances.

Schema-1 views support `activity` or `execution`, current project/explicit resource
scope, source provider/type/classification filters, a capture-time viewport
(`from` inclusive / `to` exclusive), display timezone, and selected event ID/cursor.
Panning and zooming save those endpoints; they never rewrite source timestamps.
The query order is retained capture cursor, **not** global causal or provider-time
order. Source `receivedAt`, optional provider time/source and native references
remain exact. Capture timestamps do not establish a universal synchronized clock.

Every read revalidates actual resources/projects and current policy. A revoked
explicit scope makes the view unavailable instead of turning an empty scope into
application-wide access. A project-owned Timeline cannot silently broaden into a
global Timeline. Null-resource events never acquire a project association from
nearby events, timestamps, current workspace or title. Such headers can appear
only in an unscoped view with explicit `eventAccess` permission. A revoked selected
event projects as unavailable/null without erasing the stored selection; it may
become readable again if access legitimately returns.

## Evidence and bounded windows

Queries project bounded, typed header primitives in SQLite; they never select or
materialize source JSON/payloads, text deltas, account details or tool output into
the service. The production module performs no writes to `intelligence_events`
or `integration_meta`. The source table is the sole initial coverage source;
kernel `change_events`, all application activity, OS events and external history
are **not** implied coverage.

A window freezes `throughCursor`; continuation tokens bind the canonical view
version/digest and that high-water mark. Later appends are excluded and reported
as `hasNewEvents`; a fresh query explicitly starts a new window. Current policy
still applies to every page. View configuration changes invalidate old tokens.

Retained `observed`, `reported`, `inferred` and `simulated` classifications are
preserved. An execution header records evidence about that execution only;
`provider_completed` never becomes verified task success. Navigation references
are actual currently authorized resource IDs (including archived state only if
the host permits that source). There are no invented source associations.

Coverage gaps distinguish unavailable source, pre-retention cursor ranges,
cursor discontinuity, invalid/future rows, access filtering, bounded query and
unavailable selection. **A cursor gap has unknown cause.** It is not claimed data
loss: deduplication via `INSERT OR IGNORE` can also consume SQLite cursor values.
Policy gaps contain no hidden source IDs, times, bodies or event counts. Source
range fields are store cursor fences, not counts of private or matching events.
`complete-retained-window` means the matching retained window was scanned; gaps
and `allActivity:false` remain authoritative limitations.

Limits: 256 views, 4,096 command receipts, 16 KiB view config, 64 explicit resources,
32 filters per dimension, 200 returned items, 1,000 scanned rows/page, 16 KiB valid
header and 256 KiB response cap (including reserved envelope metadata). Hitting
the item/byte/scan limit returns bounded coverage and a continuation. No event or
body is truncated. Unsupported planning, forecasts, dependencies, state replay,
re-execution and export are explicit `false` capabilities.

## Verification

Run `node --test prototypes/timeline-product/tests/service.test.mts` from the
repository. Tests use actual `WorkspaceKernel`, `DesktopState` and SQLite, with
synthetic event fixtures in the same canonical schema and one retained synthetic
same-file restart database under ignored `.runtime/timeline-product-tests`.
They cover zero-DDL reads, same-connection enforcement, unknown schema refusal,
canonical creation/rollback, CAS/idempotence, restart, concurrent append fences,
revocation, project/global boundaries, metadata-only SQL, classifications,
viewport/filter changes, malformed/oversized headers and bounded scan gaps.
The isolated release passed all **16** SQLite tests and strict TypeScript with
zero diagnostics using the existing installed compiler and Node declarations;
no dependencies were installed.

Native UI, transport admission, Timeline viewers, host policy wiring, provider
behavior, live event completeness and production/performance acceptance remain
unverified here. No real user profile, provider, network or GUI is used.
