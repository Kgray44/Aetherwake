# Phase C hardening and coverage

Engineering control plane only. This does not alter Vela MissionService, authorize execution, or confer owner acceptance.

## Compatible contract evolution

The six v1 records remain unchanged except optional `ContextSnapshot.task_digest`. New context generators pin canonical full Task content; async `checkFreshness(snapshot, task, head, root)` independently rehashes clean tracked authority sources and rejects changed Task semantics, repository mismatches, stale HEAD and legacy snapshots without a digest. Regenerate old snapshots; never grandfather them as current.

Detailed trace events use separate `contracts/trace-v1.schema.json`, not misleading extra v1 record kinds. `traceEvent` and `appendEvent` record explicit lifecycle states, phases and correlated operations. These are observations, not scheduling/authorization or acceptance authorities. A claimed `accepted` trace requires independent owner evidence before any UI presents accepted status.

## Private persistence and recovery

Wrapper start events are persisted before child launch and end events after child completion. `.git/agent-harness/events.jsonl.journal` uses fsynced temporary files and atomic hard links; one immutable file per event ID. Idempotent identical ingestion succeeds; conflicting identity fails. Interrupted temporary files are ignored, never interpreted as completion. Unfinished starts remain incomplete after interruption. Directory must be private; individual records mode 0600. Platforms without hard-link support fail rather than silently degrade guarantees. Local administrator/tampering protection is not claimed.

Default bound: 10,000 events / 32 MiB. Bounds fail closed; archival/retention deletion requires explicit owner-approved policy, not silent evidence loss. A cross-process exclusive writer lock serializes admission and lifecycle transitions. Interrupted locks fail closed; `recoverInterruptedWriter` requires matching owner PID/time and proof the process is dead on the same host. Unknown liveness or corrupt metadata requires diagnosis. Pending files count against bounds; they are never silently purged. No daemon, no automatic deletion. Canonical execution Task input is local; hosted D1 is only a projection and independently proposed tasks stay proposed.

For several shell calls in one Attempt, supply the same `--attempt` ID. Only span/Telemetry records are appended for those calls; a shell success never closes the entire Attempt. Without an ID, the legacy bounded command attempt remains supported.

## Measurements and supported provider input

Observed: command monotonic elapsed time/exit code, wrapper CPU user time and wrapper RSS. These wrapper metrics are **not child resource utilization**. Linux direct-child CPU ticks, RSS/high-water RSS and disk byte deltas are sampled at a bounded 250 ms interval (configurable API minimum 100 ms). Sampling elapsed overhead and successful sample count are recorded. These partial samples can miss short processes and are not total process-tree measurements; unavailable metrics stay explicit. GPU/frame, child lifetime totals and non-Linux host metrics remain unavailable. No monitoring daemon.

For a Codex CLI command already authorized by its caller, add `--event-stream codex-exec-json` before the separator and use `codex exec --json` after it. For example:

```sh
node scripts/agent/telemetry.mjs run --task /private/task.json --context /private/context.json --repo Kgray44/Aetherwake --event-stream codex-exec-json -- codex exec --json -
```

Standard input and stderr stay inherited. Stdout is passed through byte-for-byte, so the caller must handle it as private. On Windows, supply a directly spawnable Codex executable if the local command is a PowerShell or batch shim. Ordinary command execution keeps inherited stdio and does not inspect provider traffic.

`provider-events.mjs` reads the explicitly selected [Codex exec JSONL stream](https://learn.chatgpt.com/docs/non-interactive-mode#make-output-machine-readable) with a 256 KiB maximum record size. It durably records the allowlisted numeric usage from up to 32 completed turns per wrapped process, linked to the enclosing Task, Attempt and command span. Only numeric usage, counts and fixed labels go into the journal. Prompts, provider IDs, tool arguments, output, paths and error text are excluded. Subsequent commands can finish or fail independently of a recorded provider turn. Oversized or malformed lines, failed observations and missing turn boundaries are surfaced in coverage metrics. The counters report emitted events rather than deduplicated model invocations. A completed stream can contain a failed turn. Complete usage requires every supported token field on every observed turn and a successful journal write for each.

The [Codex CLI event contract](https://github.com/openai/codex/blob/rust-v0.153.3/sdk/typescript/src/events.ts) supplies input, cached input, cache-write input, output and reasoning-output tokens on a completed turn. Missing fields, exact provider request latency or invocation count, hidden reasoning time, per-Task quota or cost, and account billing cannot be obtained from this stream. Account-level quotas and usage, reroutes, compaction and retry classification would require a separately qualified App Server adapter. The wrapper does not inspect existing private Codex sessions or authenticate self-reported event streams supplied by an arbitrary command. Stream fixtures verify transport behavior; signed-in Codex acceptance and overhead measurement remain separate.

`sanitizeExport` produces explicit allowlisted private exports for the owner-authorized Observatory upload. No raw args, prompts, outputs or paths; evidence artifact URIs are opaque, private titles/criteria are withheld. The consumer must validate complete nested schemas, namespace/owner, deduplicate and check revision/CAS. Sanitized export remains private; not suitable for public Git by default. No unattended Site authentication is claimed.

## Verification and remaining work

`node --test tests/agent-phase-c.test.mjs tests/agent-contracts.test.mjs tests/agent-journal.test.mjs`

Focused tests cover source/task mutation, stale revisions, command observation, journal identity conflicts and interrupted temp files, bounds, privacy export and provider usage omission. This is not full lifecycle/hosted/native acceptance. Context spans, retries and quality labels must be emitted by their actual workflow boundaries; no timings or causes are inferred from file changes. Summary phase durations can overlap and are not critical-path time. No efficiency improvement claim without a controlled baseline.

`lifecycle.mjs` provides a single-writer observational lifecycle API with persisted transition validation, interrupted/resumed/restarted paths, correlated operation callbacks, and summary timings. It refuses self-asserted owner acceptance. Full Task/Attempt orchestration is not invented; callers own canonical authorization and use these observations at real boundaries.

Execution now requires `--context /private/context.json`; `runObserved` revalidates full Task digest, exact requirement coverage, repository HEAD and source hashes before launching. Legacy context snapshots require regeneration. This is freshness admission only, not a new permission authority.

## Producer integration follow-up

`record-journal.mjs` persists immutable transport envelopes around existing canonical v1 records, separately from trace events. `runObserved` writes its canonical running Attempt **before child launch** and terminal Attempt/Telemetry after observed completion. Reusing a supplied Attempt ID retains its original start; individual tool success does not close the enclosing Attempt.

`reconstructAttempts(directory)` rebuilds latest canonical Attempt snapshots and returns separate per-Attempt coverage. A running or unmatched start remains **partial, execution liveness unknown, reconcile with execution owner before retry**. It never invents a crash, failure, cancellation, owner acceptance or permission to repeat effects. Interrupted records survive observer SIGKILL; proof is an actual subprocess termination regression test. A corrupt/interrupted writer lock remains fail-closed until existing recovery checks succeed.

`observeAttempt({directory,task,context,attemptId,run})` observes an explicitly invoked, source-verified callback. Its supplied `observe(phase, callback)` captures real tool/operation phases within that Attempt. Callback success marks the bounded Attempt succeeded, not the Task accepted. The API is new-attempt only; it deliberately refuses to replay existing lifecycle observations. Canonical Task state is unchanged. There is no autonomous scheduler or hosted task execution.

The record journal has its own existing 10,000-event/32 MiB bound; together with the trace journal the default budget is up to twice either bound. `record-journal-v1.schema.json` versions transport, not a new canonical type. Export remains explicit through the same sanitized envelope, with reconstructed Attempts supplied in `records`; raw journal envelopes never go to public Git or the Site.
