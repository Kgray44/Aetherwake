> **Hardening update:** Execution now requires `--context` with a freshly source-verified snapshot; `checkFreshness` is async and rehashes exact requirements plus the Task digest. See [hardening, trace journal, lifecycle and explicit coverage](../docs/engineering/AGENT-PHASE-C-HARDENING.md). Historical wrapper-only scope below describes the initial baseline, not current coverage.

# Phase C: context snapshots and execution telemetry

This is the Aetherwake **engineering control plane**, not Vela MissionService. It consumes the foundation's `agent-system/contracts/v1.schema.json` without modifying that schema or other phases' task routing, skills, evidence policies, or user interface.

## 1. Task and context

Pass an existing v1 Task JSON whose `repository` and full 40-character `revision` are correct. The task remains authoritative; this tool **does not** create or accept tasks.

```sh
node scripts/agent/context.mjs --task /private/task.json --repo Kgray44/Aetherwake --owner governance=governance/README.md
```

Use `--out /private/context.json` to write a new private snapshot (exclusive creation, mode 0600). With no `--out`, the JSON is printed to stdout. Use repeated `--owner component=tracked/path` arguments to cite verified component ownership sources. The generator will **not infer an owner** from a filename. All owner refs must be tracked repository files. Requirement document/git refs are hashed when they resolve to tracked checkout files. The requirements themselves come only from the Task and existing governance; this script does not reimplement governance selection. Use `scripts/governance-context.mjs` and the existing governance registry before building a Task.

Snapshots pin `HEAD`, content hashes, generation time, and task identity. `stale` means the Task's revision differs from HEAD. `unverified` means owner sources are missing or a requirement cannot be verified. `current` requires matching revisions and verified ownership; consumers must **also recheck** the active revision and authoritative source hashes at use time. Use `await checkFreshness(snapshot, task, currentRevision, root)` to rehash authority sources and bind the full Task digest. This verifies freshness, not authorization.

## 2. Observable task attempts

```sh
node scripts/agent/telemetry.mjs run --task /private/task.json --context /private/context.json --repo Kgray44/Aetherwake --phase verification -- node --test tests/agent-contracts.test.mjs
```

Optional flags before `--`: `--attempt id`, `--attempt-number 2`, `--provider name`, `--model name`, `--out /private/events.jsonl`. The wrapped child executes without a shell, inheriting stdout/stderr. Its actual exit code is propagated. The compatibility file contains v1 records; durable start/end events are also emitted into its private `.journal` directory. Supplying an existing Attempt ID records command spans/Telemetry without closing that Attempt. By default it resides under the local `.git/agent-harness/events.jsonl`, outside the checked-in tree. Keep event journals private and access-controlled. **Do not commit raw events.**

The wrapper measures monotonic elapsed wall time and exit code. To observe provider-reported token usage from an authorized `codex exec --json` command, add `--event-stream codex-exec-json` before the wrapper delimiter. See the [stream coverage and privacy contract](../docs/engineering/AGENT-PHASE-C-HARDENING.md#measurements-and-supported-provider-input). Commands outside this wrapper and streams without that opt-in do not supply provider usage. Provider/model labels describe configuration. Weekly quota and monetary spend remain unavailable from this stream.

Command arguments and environment are deliberately not logged, to reduce accidental leakage. A child process can still write sensitive output to its own stdout/stderr or artifacts; existing privacy safeguards remain mandatory. The tool is not an authorization boundary or a secure sandbox.

## 3. Verification

```sh
node --test tests/agent-phase-c.test.mjs
node --test tests/agent-contracts.test.mjs
```

Tests use a temporary Git repository and check source revisions/hashes, stale/unverified states, command exit preservation, and explicit provider-metric unavailability. This phase does not alter CI gates, acceptance state, root AGENTS.md or the Phase B task classifier.

## Known limitations

- Snapshot owner mapping must be supplied explicitly from actual governance/ownership sources; automated discovery is intentionally not fabricated.
- The wrapper covers commands launched through it, not every nested agent or provider-internal call.
- Task and Attempt lifecycle orchestration belong to the corresponding task workflow and are not duplicated here.
- A merged PR or successful command is not owner acceptance. Evidence and class-dependent CI gates belong to Phase D.

