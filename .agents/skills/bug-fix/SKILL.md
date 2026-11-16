---
name: bug-fix
description: Aetherwake Phase B task-class workflow for bug fixes.
---

# Bug fixes · Engineering Task Workflow

This skill is selected by `scripts/agent/task-router.mjs` for an engineering **Task**, not a historical mission or a Vela product runtime MissionService object. The root `AGENTS.md`, Constitution, applicable ratified charters, repository security controls, and actual source owners always take precedence.

## Procedure

Capture a reproducible failure on the active revision. Write a failing regression before modifying behavior where feasible. Find root cause and change only necessary code. Run targeted and affected integration tests. Supply failing-before / passing-after evidence; distinguish environmental and transient failures.

## Universal completion contract

1. Use `node scripts/agent/task-router.mjs --task-file <task.json> --path <affected-path> --json` and load **all** selected skills, not just the primary class. Class and path risks only add obligations.
2. Run the existing governance router and context commands returned as argument arrays by the task router. Re-run if scope changes, and inspect warnings / cross-domain coverage; do not interpret routing as final authority.
3. Pin the actual Git revision. Preserve prerequisites, task-level acceptance criteria, and provenance across attempts. Repeated failed approaches require a documented diagnosis or changed assumption.
4. Record genuine technical evidence against the Task's criteria; do not invent tokens, timings, costs, acceptance or native coverage. Leave unavailable measurements explicitly unavailable.
5. Distinguish implementation, verification, PR merge, and **Task acceptance**. Owner visual/security approvals cannot be fabricated or waived.

See `agent-system/README.md` for the v1 control-plane contract. The Phase B router proposes checks; Phase D owns enforcement and CI gating.
