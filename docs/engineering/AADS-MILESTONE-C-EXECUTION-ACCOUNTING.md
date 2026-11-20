# Milestone C execution accounting

The engineering control plane owns Task and Attempt identity. The existing AADS journal
records execution observations. The private Engineering Observatory projects those
observations. Product-side AEP and Vela MissionService retain their own product
execution contracts.

## Measurement inventory

| Signal | Current source and limitations |
| --- | --- |
| Input, output, cache and reasoning tokens | Allowlisted usage on explicit Codex exec JSONL completed turns. Failed or interrupted turns, optional fields, uninstrumented executors and clipped streams can leave gaps. Cached input and reasoning output are subsets. Cache-write input is reported as a separate provider field. |
| Model, provider and effort | The Attempt can carry configured model/provider labels. They are not independently observed routing decisions. Actual model, thinking effort and fallback provenance are unavailable through this projection. |
| Cost and Codex usage | An explicitly observed USD measurement remains distinct from quota or billing. The Codex exec adapter has no cost or quota source. No usage is inferred from tool counts, model names, traffic or wall time. |
| Tools and failures | The Codex adapter counts observed completed command, MCP and file events and turn errors. This is an event count within that stream. AADS records Attempt outcome, numbering and a failure category where known. A replay or duplicate receipt does not constitute a retry. |
| Context and prompt | AADS snapshots pin Task digest, exact Git revision, and tracked source hashes. They do not measure provider prompt components, retrieval token counts or cache savings. |
| Timing and waiting | The command wrapper observes spawn-to-close wall time. Existing trace spans attribute observed phase durations with an overlap union. Queue, wait, test and end-to-end time require their own source boundaries. A span never measures time outside its boundaries. |
| PRs and CI | The Observatory reads bounded GitHub feeds with their own freshness. Repository and revision correlation does not by itself establish a Task-specific PR or CI link. |
| Verified completion and regressions | Use canonical Task acceptance and criterion evidence. Reported tool exits, PR merges and imported pass claims do not verify acceptance. Longitudinal regression rates require linked outcomes and a defined observation window. |

## Token accounting contract

The existing Analytics builder exposes an additive `tokenAccounting` projection with
`schemaVersion: 1`. The companion declaration describes the data for other consumers.
The projection contains observed totals, UTC daily buckets for the existing 14-day
view, and groups by canonical Attempt, Task, configured provider/model, and primary
Task class. It uses only the snapshot already loaded by the Observatory. There is no
new poller or telemetry store.

- Each durable turn is counted once by event identity. Conflicting identities are
  excluded. A turn must match a loaded Task and Attempt by repository, Task identity,
  Attempt identity and the Attempt's Git revision. Unmatched turns are reported.
- Input plus output is summed only for turns with both fields present. Cached input,
  uncached input and reasoning have field-level sample counts. Zero is an actual
  observation. Missing values and totals outside the safe integer range are null.
- A configured Codex stream is identified by the span start, a durable turn receipt,
  or a stream summary. Complete coverage requires a terminal Attempt, matched span
  boundaries, a positive core-coverage receipt and the expected number of recorded
  input/output pairs. A failed Attempt retains completed-turn consumption. Data from
  running, interrupted, old and capped streams can still contribute observed totals.
- Task-class efficiency uses usage from all loaded attempts in the cohort, including
  failures, divided by accepted Tasks with required owner acceptance. Ratios stay
  unavailable with incomplete or disputed cohort data. This is a loaded-cohort
  calculation. It does not certify full historical coverage or compare difficulty.
- The existing journal limits and sanitized export remain in force. The adapter
  persists up to 32 per-turn usage receipts per stream and signals partial coverage
  when it reaches that limit. Session identifiers, prompts and tool output are
  excluded from this accounting projection.

## Task Engine observer handoff

The Task Engine worker can supply claim start, normalized turn usage, and stream-end
callbacks through the existing Codex observer. The claim collector writes only trace
events to the dedicated checkout's private journal and uses the immutable execution
revision. The engine provides the canonical Task and Attempt records, including any
candidate revision and acceptance state. A worker killed before its terminal receipt
leaves already committed usage and an open span. The checkout's existing opt-in
Observatory connection provides incremental delivery using scope-bound visitor
identity. The collector neither needs nor forwards the engine worker credential.

## Verification scope

The first private AADS baseline ran 27 focused assertions with a source-verified
context on base revision `9bef824ec3f5a455c7b89ef982a4d5ac834116b1`. All passed. The
outer command measured 19,284 ms wall time. This workload did not invoke a provider,
so it produced no measured model tokens or cost. JSONL fixtures test exact
accounting and coverage behavior. They are not a provider benchmark.

The journal write-path optimization batches retention metadata reads at a concurrency
of at most 16. It preserves the existing lock, byte and event limits, hard-link
commit, deduplication, and fail-closed behavior. The benchmark compares the old and
new append paths with identical existing journal contents, varied run order and full
journal equality checks. With Node 24.18 on Windows under variable shared load, 30
measured pairs followed two warmup pairs per starting size.

| Seed events | Baseline p50 / p95 | Batched p50 / p95 | Identical retained events |
| ---: | ---: | ---: | ---: |
| 256 | 121.43 / 485.89 ms | 36.40 / 109.80 ms | 288 |
| 1,024 | 4,745.58 / 14,323.41 ms | 610.53 / 2,082.95 ms | 1,056 |

These are local journal append measurements with real filesystem writes and seeded
trace envelopes. They reflect a loaded workstation and do not establish a
production latency target, a model token reduction, or a cost reduction.

Representative charged or signed-in provider trials, verified model/effort outcomes,
Task difficulty matching, live engine dispatch, retry-policy ownership and
quality-preserving context or routing changes remain separate acceptance work.
