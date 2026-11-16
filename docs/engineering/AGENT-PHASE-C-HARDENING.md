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

`provider-events.mjs` consumes explicitly supplied Codex `turn.completed` JSON observations, extracting numeric usage fields only. Official source checked 2026-11-16: https://github.com/openai/codex/blob/main/sdk/typescript/src/events.ts . It does not start chats, inspect private sessions, retain prompts/output, infer hidden reasoning duration, or convert token count into subscription quota/money. Missing token fields remain unavailable. Live transport integration is not yet verified.

`sanitizeExport` produces explicit allowlisted private exports for the owner-authorized Observatory upload. No raw args, prompts, outputs or paths; evidence artifact URIs are opaque, private titles/criteria are withheld. The consumer must validate complete nested schemas, namespace/owner, deduplicate and check revision/CAS. Sanitized export remains private; not suitable for public Git by default. No unattended Site authentication is claimed.

## Verification and remaining work

`node --test tests/agent-phase-c.test.mjs tests/agent-contracts.test.mjs tests/agent-journal.test.mjs`

Focused tests cover source/task mutation, stale revisions, command observation, journal identity conflicts and interrupted temp files, bounds, privacy export and provider usage omission. This is not full lifecycle/hosted/native acceptance. Context spans, retries and quality labels must be emitted by their actual workflow boundaries; no timings or causes are inferred from file changes. Summary phase durations can overlap and are not critical-path time. No efficiency improvement claim without a controlled baseline.

`lifecycle.mjs` provides a single-writer observational lifecycle API with persisted transition validation, interrupted/resumed/restarted paths, correlated operation callbacks, and summary timings. It refuses self-asserted owner acceptance. Full Task/Attempt orchestration is not invented; callers own canonical authorization and use these observations at real boundaries.

Execution now requires `--context /private/context.json`; `runObserved` revalidates full Task digest, exact requirement coverage, repository HEAD and source hashes before launching. Legacy context snapshots require regeneration. This is freshness admission only, not a new permission authority.
