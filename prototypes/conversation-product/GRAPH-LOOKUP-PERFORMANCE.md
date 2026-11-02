# Canonical graph lookup: source and synthetic evidence

Source release `f553758` adds shallow ID-reference maps to the existing
`ConversationGraph`. It does not add another graph, transcript, search index,
policy cache, persisted schema, or public API. This document records bounded
in-process evidence; it is not native or large-library acceptance.

## Internal lifetime and compatibility

- Canonical arrays remain the sole ordered, persisted records. Map values are
  references to those **same objects**, not copies of bodies or metadata.
- Constructor/import and explicit successful `validate()` rebuild references
  after the existing validation. Append updates occur at the existing canonical
  pushes. Rollback/recovery construct a fresh graph and fresh references.
- First-match behavior is preserved, including a low imported counter that can
  generate a colliding ID before explicit validation. Existing duplicate-import
  rejection is unchanged. Non-reflexive untyped IDs are not indexed: `NaN`
  remains unresolved just as with the previous strict-equality `.find()`.
- The mock-only adapter API receives a mutable canonical `Conversation`.
  References rebuild in `finally` after that callback, including its error path.
- Public outputs/imports retain their existing copies. Existing body/getter
  traps remain on the indexed canonical object. Private structural replacement
  is reconciled by successful `validate()`; arbitrary private-array corruption
  is not a new supported mutation API.
- The same lineage traversal, cutoff, scan budget, policy callback order and
  denial-before-body behavior remain. Revocation is read currently, never cached
  in an ID map. Incomplete/denied metadata still withholds counts and bytes.

## Source-bound medium clone comparison

The retained **synthetic** medium fixture has 572 conversations, 8,072 own
messages and 72 lineage edges. Its canonical DB was copied into fresh owned
profiles. The original temporary ordinal-3 resource denial was reapplied through
the benchmark's product host boundary; persisted canonical revocation remained.
Original DB SHA-256 checks matched before and after both diagnostic runs.

The baseline is source `2a476fb`, on integration base `0b68459` with only the
profiler/docs added. The changed source is `f553758`. Each process retained
128 MiB old heap, 8 MiB semi-space, 256 MiB sampled-RSS admission and a
10-second parent deadline. Four separate clones kept the 64 MiB C: / zero D:
allocation estimate. The storage guard is a checkpoint rule, not an OS quota or
control over external writers. No limits were raised and no original artifact
was opened writable.

The structural process temporarily counts ID property reads on the same graph
records and the separate canonical Core state representation, after Core
construction. Getters and method wrappers are restored before close. These are
measured property reads, not total instructions or elapsed CPU work. Constructor
index-building work is excluded from those counters. Separate timing processes
install **none** of that instrumentation.

| Measured work per read | Activity list before → after | Smart collections before → after |
| --- | --- | --- |
| Graph message lookup calls | 73,829 → 73,829 | 73,829 → 73,829 |
| Canonical graph message-ID reads | 80,337,802 → 1,100,230 | 80,365,121 → 1,127,549 |
| Graph conversation-ID reads | 1,326,759 → 2,633 | 1,326,759 → 2,633 |
| Graph edge-child reads | 101,676 → 0 | 101,676 → 0 |
| Core state message-ID reads | 31,947,672 → 31,947,672 | 30,893,233 → 30,893,233 |
| SQL prepares | 27,590 → 27,590 | 31,869 → 31,869 |

Both response digests matched exactly between baseline, changed source and
their separate timing copies. Every measured read had zero graph snapshots,
provider calls and SQL changes. All four workers completed within their limits
on both sources. Canonical graph work was reduced; the unchanged Core ownership
checks and SQL are explicitly still material.

| Uninstrumented raw samples (ms) | Before | After |
| --- | --- | --- |
| Activity list | 745.9, 676.8, 673.6 | 437.3, 383.8, 382.5 |
| Smart collections | 851.7, 794.6, 795.9 | 520.4, 472.5, 472.9 |

Each set has one warmup and **three** samples. These are bounded clone
observations, not percentile qualification, a full fresh-medium pass, or native
input/paint latency. No startup-speed claim is made.

## Verification and remaining limits

The release passed 27 graph/clock/metadata/index tests, 14 product SQLite tests,
seven Core conversation integration tests, and nine Vela history/security tests
(57 total). Coverage includes exact references, copy isolation, generated ID
collisions, duplicate import, successful validate/import, throwing mutable
adapter, fork cutoff, selective/native handoffs, current revocation, inherited
denial before a throwing body getter, canonical rollback and restart. Strict
Graph/CP source/test and Core conversation-test type checking passed.

The integration owner's earlier full small benchmark passed all 13 reads with
20 timed samples on its source. Its medium run constructed the complete fixture
but exceeded the dataset deadline; the large dataset was not attempted. Those
outcomes remain retained and are **not** converted into a pass by this clone
diagnosis. A fresh combined-source full benchmark remains required.

Core's own-message ownership `.find()`/`.includes()` work, unique source SQL,
fork-boundary scans, transcript copying for explicit body queries, broad smart
rules, library-header enumeration, constructor/setup allocation, and native
render/scroll/concurrency are outside this change's performance qualification.
No UI, live provider, account, production dataset or user-profile activity was
performed in this lane.
