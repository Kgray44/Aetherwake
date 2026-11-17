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

Observed wrapper measurements include command elapsed time, exit code, wrapper CPU time, and wrapper RSS. Linux samples the direct child through `/proc` every 250 ms by default. CPU and disk deltas require two valid readings of each counter. A single sample can still establish RSS and the OS-reported RSS high-water mark.

Windows starts one hidden Windows PowerShell helper when the command reaches 25 seconds. The helper samples `System.Diagnostics.Process` working-set bytes, peak working-set bytes, and CPU time with at least 2 seconds between samples. Short commands incur no helper startup. Direct API callers can opt in to a shorter startup delay with `observeResources(pid, {windowsStartDelayMs: 0})`; this can materially raise CPU overhead. Windows reports helper CPU observed through the last successful sample, including startup, and query elapsed separately. Linux sampling elapsed includes I/O wait. Both platforms report the successful sample count. Process-tree and full-lifetime totals, GPU and frame metrics, and Windows physical disk metrics remain unavailable.

`provider-events.mjs` consumes explicitly supplied Codex `turn.completed` JSON observations, extracting numeric usage fields only. Official source checked 2026-11-16: https://github.com/openai/codex/blob/main/sdk/typescript/src/events.ts . It does not start chats, inspect private sessions, retain prompts/output, infer hidden reasoning duration, or convert token count into subscription quota/money. Missing token fields remain unavailable. Live transport integration is not yet verified.

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
