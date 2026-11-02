# Canonical metadata browsing: bounded diagnosis

This is source/SQLite evidence, not native performance acceptance. The original
small benchmark did not pass: one attempt exceeded its sampled RSS admission
during seeding; the next reached its parent deadline during smart-collection
setup. Neither produced a timed navigation qualification. Their private
artifacts remain intact.

## Implemented boundary

`CanonicalConversationHost` has the additive optional interface:

```ts
canonicalReadBatch?<T>(read: (view: ConversationReadView) => T): T;
```

The owning host must build the bodyless view inside a synchronous transaction
on the **same** canonical connection and graph. Its authorization memo lasts
only for that callback. Both product access checks and lazy graph/source reads
must use that same current authority. Nested batches and thenable returns are
rejected; lazy callbacks are fenced after success, exception or rollback. No
await, provider request, retained-view permission, or graph-epoch authorization
is allowed. This is a trusted in-process interface, never renderer RPC.

The product uses the optional boundary for list, search and collection
projections. It constructs command-local metadata maps for canonical headers,
resources, placements, latest executions, favorites and manual memberships.
Repeated summaries are reusable only inside the synchronous batch. These are
derived reads, not a new graph, database, transcript, search index or permission
store. Hosts without the boundary retain compatibility; that path has no scale
qualification.

Smart membership now matches authorized canonical IDs without calculating
message count/activity for every candidate. Rule validation and parent-cycle
validation read canonical collection headers instead of repeatedly evaluating
all smart queries. The UI's explicit `searchMode: 'conversations'` rule is
accepted; `messages`, `resources` and `all` remain unsupported for saved rules.
Manual pins remain distinct and are preserved.

## Measured baseline before host batching

The opt-in [clone profiler](test/metadata-profile.mts) at source `7e0744f`
reopened byte-exact **copies** of a retained synthetic fixture: 172 canonical
conversations, 2,072 own messages and 72 branch edges. It reapplied the original
temporary denial of synthetic base conversation ordinal 3; persisted canonical
message revocations remained in the DB. The original file hash was unchanged.
Earlier diagnostic receipts without that temporary denial are retained and
must not be used as a policy-equivalent comparison.

Each process retained the existing 128 MiB old heap, 8 MiB semi-space and
256 MiB sampled-RSS admission. Each read received a **lower** 10-second parent
deadline. Work counters and uninstrumented timings used separate fresh copies.
The storage guard admitted a bounded 64 MiB C: / zero D: estimate. This is an
instruction/checkpoint rule, not an OS quota or control over external writers.

| Read | Instrumented result |
| --- | --- |
| Activity list | 166 metadata calls, 1,547 contributing-message allow visits (1,412 unique), 13,328 SQL prepares; zero graph snapshots, transcript projections, provider calls or SQL changes |
| Smart collections | Timed out at 10 seconds. Last partial checkpoint at 9.45 seconds: 156 transcript projections, 16,928 product access calls (2,121 unique), 17,120 canonical access calls (2,128 unique), 135,387 SQL prepares; zero activity/count metadata calls, snapshots, provider calls or SQL changes |

The uninstrumented list had one warmup and only three measured samples:
745.4, 768.9 and 1,005.3 ms. These are raw in-process observations, **not** p95,
an improvement claim, native input-to-paint latency, or a performance pass.
The smart-collection timing process also timed out. SQL counts localize repeated
source authorization as material work; they do not establish a hard latency
guarantee for the subsequent host implementation.

## Verification and remaining work

Product source `51f9071` passed 102 focused component/service/adapter tests,
including real SQLite smart-rule compatibility, exact manual/derived IDs,
next-call inherited-source denial, withheld count/activity, detached result
mutation, fresh metadata after favorite changes, and failed/closed read scope.
Strict CP source/test type checking passed after the installed-Node-type-only
benchmark options correction. The test host demonstrates the required batch
lifetime contract; the actual Core host lifetime/revocation/rollback tests and
paired post-integration measurements belong to the integration owner.

The following remain uncapped or separately limited scenarios:

- A read still obtains canonical library headers and execution metadata before
  pagination; there is no claim of constant work as library size grows.
- Visibility metadata preserves the existing graph scan budget (4,096). A
  denied or incomplete contributing history withholds count/activity rather
  than presenting a guessed total or hidden-source timestamp.
- Explicit full-body searches and smart content rules still traverse canonical
  histories. Detail/export still hydrate transcripts. They have no full-text
  index or large-library performance qualification.
- Large membership tables, broad smart rules, deeper ancestry beyond the bounded
  metadata window, concurrent policy changes, fresh setup allocation, native
  rendering/scrolling and restart journeys require their own measured evidence.

No existing graph visibility/lineage semantics were changed. No native UI,
account, live provider, model output or user-profile activity was performed by
this diagnosis.
