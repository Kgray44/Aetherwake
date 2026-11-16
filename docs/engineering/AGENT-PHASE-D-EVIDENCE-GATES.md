# Phase D — Task evidence and CI verification

This is the Aetherwake **engineering control plane**, not the product-side Vela MissionService. The foundation contract remains `agent-system/contracts/v1.schema.json`. The verification tool consumes those records without altering the shared schema or weakening existing governance, desktop test admission, security, or approval gates.

## Task-specific validation

Provide a JSON object with `task`, `attempts`, `evidence`, and `profiles` arrays, plus optional `context_snapshots`. The selected verification profile must match `task.acceptance.profile_id`, include the primary task class, and map required check IDs to acceptance criterion IDs. Every Evidence must belong to a known Attempt and acceptance criterion and include artifact provenance and a full revision.

```bash
node scripts/agent/verify.mjs --bundle /private/submission.json \
  --revision "$(git rev-parse HEAD)" --enforce \
  --report /private/verification-result.json
```

The verifier detects missing required evidence, invalid linkage, stale revisions/observations, stale context, duplicate IDs, unexplained retries, unmapped profile checks, and synthetic visual/motion/review artifacts. It never infers owner acceptance from passed tests or merged PRs. `manual_approval` remains pending without an explicit owner decision. An accepted task without an explicit owner acceptance status fails.

`blocking_policy: report_only` reports issues without failing unless `--enforce` is provided. `blocking_policy: enforce` fails on evidence issues. Invalid bundle JSON and CLI errors always fail. The JSON output separates factual evidence checks from `manual_pending`. This checker performs semantic validation; it is not a replacement for complete JSON Schema draft 2020-12 validation. Foundation contract tests must continue to run.

## Gradual CI adoption

The scoped GitHub workflow always tests the foundation and Phase D verifier. In the absence of a submitted public bundle it reports **not verified**, rather than claiming acceptance or blocking unrelated branches while Phase C is being integrated. If a deliberately public, sanitized `.agent-evidence/submission.json` exists, the workflow enforces verification against the checkout SHA.

Do not commit real personal telemetry, provider usage or quota records, private transcripts, access tokens, or sensitive screenshots to this public repository. Private integrations should generate temporary input outside the repository and call the same CLI.

A successful workflow is **not** evidence of artistic quality, authorized native testing, explicit owner acceptance, or Task completion. Profiles cannot waive cross-cutting governance requirements. More complete native, security, visual, and performance evidence collectors can feed this verifier once implemented by their respective owners.
