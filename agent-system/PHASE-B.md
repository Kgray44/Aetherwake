# Phase B · Deterministic task-class router and agent skills

Status: **implemented workflow selection**, not task execution, telemetry, context snapshot generation, verification enforcement or owner acceptance.

## Contract and authority

The router consumes a v1 engineering `Task` record defined by `agent-system/contracts/v1.schema.json`. It does not interpret Vela MissionService product tasks and does not own task state. `agent-system/task-classes.json` is the versioned, reviewable class/check catalog. Its checks are required *workflow proposals* for Phase D verification profiles, not emitted Evidence or CI certification.

The primary class selects the lead skill, and every secondary class adds its skill and checks. Known sensitive code paths add risk requirements; this mapping is deliberately conservative and cannot prove absence of risk. The agent must examine actual affected interfaces and charters. No task label can waive Charter 14, ownership, owner approval, native verification policies, or ratified governance.

## Use

For a v1 Task record saved as `task.json`:

```bash
node scripts/agent/task-router.mjs --task-file task.json --path prototypes/visual-experience/cinematic-v3/src/main.ts --json
node --test tests/agent-task-router.test.mjs tests/agent-contracts.test.mjs
```

Output includes selected class skills, union of required check IDs, prerequisite IDs/capabilities, and safe **argument arrays** for the existing `scripts/governance-router.mjs` and `scripts/governance-context.mjs`. The router does *not* execute those tools automatically, fetch private data, write task state, or run commands contained in task input.

### Prepare and resume a Task

Run from the Task's revision with its source-backed ownership references.

```sh
node scripts/agent/task-router.mjs --task-file /private/task.json --path scripts/agent/context.mjs --prepare --owner harness=agent-system/README.md --context-file /private/context.json
```

The command returns the existing route, applicable skills, prerequisite declarations, checks and governance commands. It writes a verified snapshot that can be passed directly to `telemetry.mjs run --context`. Rerun with the same context path to reuse the snapshot after validating the Task, revision, ownership scope and source hashes. Use a new file when the snapshot becomes stale. Add `--with-governance --json` to include the V2 governance package in the same invocation. Keep Task and context files private. Preparing a Task does not authorize a command or satisfy its checks.

### Focused verification

The route includes `verification_plan.focused_commands` for an initial pass. Run each argv array from its indicated repository-relative working directory with the dependencies used by that package's normal tests. The initial map links the backend Task objective, Task reference, and resource admission owners to tests that import those commands or exercise them through their consumers. A changed backend test can also be selected directly. An unmapped path needs investigation of its tests and dependents.

The focused commands supply early feedback. The existing acceptance profile, security and native gates, integration coverage, and recorded owner decisions remain authoritative. The plan exposes reused evidence as empty until an independent verifier can establish the identity and validity of reusable evidence.

## Required execution behavior

1. Confirm a real Task with revision-qualified requirements, prerequisites and acceptance criteria.
2. Route by explicit Task classification, inspect affected path risks, and read every selected skill.
3. Run the governance routing/context commands; inspect warnings and add affected charter domains the route missed.
4. Check prerequisite readiness and canonical source ownership before substantive work.
5. Apply the appropriate skill to implement and collect genuine evidence. On repeated failure, diagnose rather than blindly retry.
6. Record coverage gaps honestly. CI success and PR merges cannot substitute for Task or owner acceptance.

## Integration boundaries

**Phase A** owns audits; **Phase C** owns context snapshots and telemetry; **Phase D** owns verification profiles and CI gates; **Phase E** owns the observer website. Phase B must not write those records or infer approval. Risk mapping is not a security classifier; unrecognized areas still require architectural inspection and governance. This is intentionally a small dependency-free Node ESM module. 


## Policy revision and source coverage

`policy_revision` identifies the additive risk catalog independently of contract version. The connected renderer, native Electron brokers, backend services and GPU/resource owners are mapped in `task-classes.json`. Backend source conservatively adds security review because authorization and service ownership are intertwined. GPU-specific checks supplement, never replace, visual evidence.

Every route requires governance coverage, source-owner review and affected-scope review. Empty, unknown or incomplete path sets are not safe classifications. Supply the complete changed-path inventory (including renamed/deleted paths), inspect the current-state and ownership indexes, and add any cross-domain obligations through existing governance. `scope_coverage` explicitly does not claim exhaustive coverage. Paths must be unambiguous repository-relative paths; unsafe aliases fail closed.

Root `AGENTS.md` is the repository instruction entry point, and `.agents/skills/*/SKILL.md` contains discoverable, narrowly scoped skill files. Selected risk classes add skills even when not explicitly named as secondary classes. This filesystem layout is verified, not a claim that a Codex session was launched.
