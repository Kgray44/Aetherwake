# Agent Development Harness: shared contracts v1

Status: **foundation contracts only**, not an operational router, telemetry collector, CI gate, or observatory. This is the engineering *control plane* for work on Aerynth. It is **not** Aerynth's product-side Vela MissionService, which remains authoritative for Vela tasks and mission scheduling (Charter 05).

## Authoritative sources and integration

- `AGENTS.md`, `governance/README.md`, the Constitution and applicable charters retain their existing precedence.
- Use `scripts/governance-router.mjs` and `scripts/governance-context.mjs`; do not build an alternative governance engine or store copied charter text.
- `docs/engineering/CURRENT-STATE-OF-AERYNTH.md` and actual code/CI are evidence, not timeless runtime snapshots.
- Existing source ownership and approved architectural decisions remain authoritative. Each implementation worker must audit its own actual file paths and confirm ownership.
- This public repository must never contain real private session transcripts, tokens, personal telemetry, private usage records, credentials or sensitive paths.

## Canonical entity boundaries

The machine-readable contract is `contracts/v1.schema.json` (JSON Schema 2020-12). The top-level discriminant is `record_type` and `schema_version: 1`. `task_id` references a durable engineering Task; an Attempt is one execution, Evidence evaluates a criterion, Telemetry describes observed/estimated/unavailable measurements, ContextSnapshot pins source provenance and freshness, and VerificationProfile specifies class-dependent checks. Stable IDs are opaque, NOT mission numbers. All records are revision-qualified by full Git commit SHA; times use UTC RFC3339/date-time. GitHub issues/PRs are attached to tasks, not substituted for their identity.

A task specifies the objective, prerequisites, acceptance criteria and task class. An accepted PR **does not imply** accepted Task. A Task can span providers, branches, attempts, PRs and artifacts. A task can have multiple classes; the primary class picks a workflow, all affected risks add their mandatory checks. Classifications must never weaken security, native-test admission, review/authorization or charter requirements.

## Status policy

Task states: `proposed → ready → running → verifying → accepted`; `blocked`, `failed`, `cancelled`, `superseded` are explicit alternatives. Never infer `accepted` from commit/merge/test success. Owner visual acceptance is separate; protect the existing desktop slot and approval gates. Record state changes with who/what, source revision, and timestamp. Later implement transitions as append-only idempotent events; v1 schemas describe records, not permission to mutate state.

Attempts contain a task reference, sequence and results. A repeat of the same failing approach requires an identified changed assumption or explicit diagnosis. Do not retry uncertain consequential effects automatically.

Evidence needs a criterion, test/scene/reviewer artifact, environment, result and exact revision. Synthetic screenshots cannot establish native GPU acceptance. A stale result does not certify changed code. Verification profiles must inherit risk-specific minimums regardless of primary class.

Telemetry measurements have `availability: observed | estimated | unavailable`, with optional value, unit, source and method. Never invent provider token counts, dollar costs or weekly Codex quota percentages from PR counts. Actual provider quota consumption is unknown unless measured by a supported interface.

Context snapshots are generated from current Git, registry and authoritative owner references. Their `freshness` flag is not enough by itself: consumer must compare pinned revision/requirement digests against the active checkout. No regenerated narrative may override governance.

## Parallel implementation partitions

All workstreams must use v1 records and fixtures and avoid independently modifying the common contract:

| Owner | Allowed implementation surface | Contract consumed |
|---|---|---|
| A. Governance audit | audit/report docs, existing governance links | all |
| B. Task router and agent skills | `.agents/skills/`, `scripts/agent/task*`, task class mapping | Task, VerificationProfile |
| C. Context and telemetry | `scripts/agent/context*`, `scripts/agent/telemetry*` | Attempt, Telemetry, ContextSnapshot |
| D. Evidence / CI | `scripts/agent/verify*`, `tests/agent/`, scoped GitHub workflow | Evidence, VerificationProfile |
| E. Observatory | task-centric website, read-only projections and fixture adapter | all |

These are ownership intentions pending live source audit, not a license to overwrite existing files. A single contract owner reviews schema changes; additive fields must be optional for v1 readers, breaking changes require v2 and migration. Each producer/consumer must validate fixture compatibility. The website must not become a competing coordinator, nor make approval/merge decisions.

## First end-to-end acceptance

An actual engineering Task must have a pinned context snapshot; at least one Attempt; observed timings (and explicitly unavailable AI usage if not exposed); criterion-specific Evidence; a verification result; and a task-centric observable status. A real owner decision is required where human acceptance applies. Compare representative bug, backend and visual tasks before claiming efficiency improvement.

## Foundation validation

Run `node --test tests/agent-contracts.test.mjs` (included in this PR) and the existing governance validation. This first PR intentionally does **not** add CI enforcement or runtime agent orchestration. Subsequent workstreams implement those, without treating a schema as operational functionality.
