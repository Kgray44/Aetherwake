# Phase B · Deterministic task-class router and agent skills

Status: **implemented workflow selection**, not task execution, telemetry, context snapshot generation, verification enforcement or owner acceptance.

## Contract and authority

The router consumes a v1 engineering `Task` record defined by `agent-system/contracts/v1.schema.json`. It does not interpret Vela MissionService product tasks and does not own task state. `agent-system/task-classes.json` is the versioned, reviewable class/check catalog. Its checks are required *workflow proposals* for Phase D verification profiles, not emitted Evidence or CI certification.

The primary class selects the lead skill, and every secondary class adds its skill and checks. Known sensitive code paths add risk requirements; this mapping is deliberately conservative and cannot prove absence of risk. The agent must examine actual affected interfaces and charters. No task label can waive Charter 14, ownership, owner approval, native verification policies, or ratified governance.

## Use

For a v1 Task record saved as `task.json`:

```bash
node scripts/agent/task-router.mjs --task-file task.json --path src/rendering/particles.ts --json
node --test tests/agent-task-router.test.mjs tests/agent-contracts.test.mjs
```

Output includes selected class skills, union of required check IDs, prerequisite IDs/capabilities, and safe **argument arrays** for the existing `scripts/governance-router.mjs` and `scripts/governance-context.mjs`. The router does *not* execute those tools automatically, fetch private data, write task state, or run commands contained in task input.

## Required execution behavior

1. Confirm a real Task with revision-qualified requirements, prerequisites and acceptance criteria.
2. Route by explicit Task classification, inspect affected path risks, and read every selected skill.
3. Run the governance routing/context commands; inspect warnings and add affected charter domains the route missed.
4. Check prerequisite readiness and canonical source ownership before substantive work.
5. Apply the appropriate skill to implement and collect genuine evidence. On repeated failure, diagnose rather than blindly retry.
6. Record coverage gaps honestly. CI success and PR merges cannot substitute for Task or owner acceptance.

## Integration boundaries

**Phase A** owns audits; **Phase C** owns context snapshots and telemetry; **Phase D** owns verification profiles and CI gates; **Phase E** owns the observer website. Phase B must not write those records or infer approval. Risk mapping is not a security classifier; unrecognized areas still require architectural inspection and governance. This is intentionally a small dependency-free Node ESM module. 
