# Phase D: task evidence and CI verification

This engineering control plane is separate from product Vela MissionService. The six canonical records remain foundation v1. Existing Aerynth governance, security, native admission and owner acceptance remain mandatory.

## Obligation union

`verifyBundle` calls the same `routeTask` implementation used by Phase B with actual changed paths. Primary and secondary classes, affected-path risks, and universal governance/source-owner/scope review obligations must ALL be present as required VerificationProfile checks and Task criteria. Additional governance obligations supplied by a trusted caller are additive. Every Task-specific criterion also needs passing proof; a profile cannot mark it optional to bypass it. Router output is not itself evidence that governance or source scope is complete.

Pass actual changed paths from version control, not a bundle-authored assertion. CI derives paths from the event base and contributor head. Missing paths never remove universal scope review. Unknown classes fail closed.

## Trust boundary and detached proof

Agent-authored `result: passed` and `owner_acceptance: accepted` fields are claims, not proof. Each passing Evidence requires an independently signed execution receipt and matching artifact bytes. `evidence-trust.mjs` verifies Ed25519 signatures, repository/task/attempt/criterion linkage, canonical record SHA256, source head, tested revision, freshness, non-synthetic status and actual artifact SHA256. Artifact paths must resolve within the supplied root, including symlink resolution; files over 64 MiB are rejected rather than read unboundedly.

Receipts are a version-1 verification envelope, NOT a seventh foundation record. Each envelope has `key_id`, `payload`, and base64 `signature`. Sign the UTF-8 `canonical(payload)` exported by `evidence-trust.mjs`. Execution payload fields are:

- `version: 1`, `type: execution`, `repository`, `task_id`, `attempt_id`, `criterion_id`
- `source_head`, `tested_revision`, optional `integration_revision`
- `record_digest` (canonical Evidence digest), `observed_at`, `result: passed`, `synthetic: false`
- `artifact_uri`, `artifact_path` (relative to artifact root), `artifact_sha256`

The trust store is an OUT-OF-BAND map from key IDs to `{public_key, roles}`. Collector keys have role `collector`; review keys have role `reviewer`; owner keys have role `owner` and an `actor` identifier. An owner receipt binds the canonical Task digest, source/tested revisions, observation timestamp, `type: owner_acceptance`, `decision: accepted`, and matching `actor`. Collector keys cannot approve owner acceptance. Never load public keys from the submitted bundle, or give private signing keys to the agent/workload being evaluated. A signature proves the configured collector's attestation, not the collector's correctness. Provisioning and protecting a real independent collector remains an operational requirement; test-generated keys prove only the verifier mechanics.

A committed bundle cannot name the SHA of the commit containing itself. Prefer **detached**, sanitized `aads-evidence` artifacts containing `submission.json`, `receipts.json`, and `artifacts/`. Generate them after the source head is known. The workflow accepts a same-repository artifact run through workflow-dispatch `evidence_run_id` or maintainer repository variable `AADS_EVIDENCE_RUNS` (JSON map from exact source-head SHAs to artifact run IDs; not a global latest-run pointer). Downloaded content remains untrusted until signature/hash checks pass. Stale run configuration fails verification, not silently falls back to success. Do not publish private raw telemetry, transcripts, sensitive screenshots, or credentials as public artifacts.

```bash
node scripts/agent/verify.mjs --bundle /private/submission.json \
  --repository Kgray44/Aetherwake --revision "$SOURCE_HEAD" --tested-revision "$TESTED_REVISION" \
  --paths-file /private/actual-changed-paths.json \
  --receipts /private/receipts.json --trust-store /trusted/public-keys.json \
  --artifact-root /private/artifacts --enforce --report /private/result.json
```

Source head, tested merge revision and integration revision are distinct report fields. The target event's `$GITHUB_SHA` is the base, not tested code. The trusted gate takes tested revision from GitHub's `pull_request.merge_commit_sha` and fails if unavailable; contributor head comes from `pull_request.head.sha`. Detached receipts must match both exactly. No merge, human acceptance, or verification is inferred from merely successful workflow execution. Report-only profiles return issues; CI always uses `--enforce` for required/submitted evidence.

## Staged CI rollout

Candidate regression tests run on every PR/main push. The separate **Agent Evidence Trusted Gate** uses `pull_request_target` restricted to main and checks out base verifier/router/policy code. Candidate files are checked out solely as untrusted data; no candidate script, hook, dependency installation or test is executed in that trusted job. Only read permissions are granted; no signing secret is provided. The verifier must first exist on main (bootstrap). Contributor-head check publication must then be implemented and hosted-tested before required-check activation; see the explicit limitation below. A PR cannot change the running base gate or loosen its trusted obligation policy. The trusted gate runs on every PR to main: evidence-only, routing-only and product-source changes cannot evade it through path filters. Maintainers set repository variable `AADS_EVIDENCE_STAGE`:

1. `submitted`: every present/changed submission is enforced.
2. `tasks` (default): additionally enforce changed `agent-system/tasks/` records and PRs labeled `aads-task`. Unmigrated scopes are explicitly **not verified**.
3. `all-applicable`: additionally enforce product, native, AADS and workflow paths. This is the final migration target; do not claim universal operational coverage before it is enabled and the independent collectors cover their obligations.

`AADS_EVIDENCE_TRUST` contains the trusted public-key map. Missing trust configuration or required evidence fails closed. Trust configuration must be controlled independently from contributor payloads. Existing required Aerynth workflows remain unchanged. Branch protection/review must protect the verifier, workflow and policy themselves against a contributor replacing the gate. This change does not claim those repository settings have been configured.

## Coverage and limits

Focused tests cover class/secondary/actual-path obligation omission, optional-profile bypass, fabricated or tampered proof, artifact hashes, path escape, stale Task/evidence/tested revisions, unauthenticated owner acceptance and staged enforcement. Signed fixtures are not hosted/native acceptance. Every submitted record is validated against the current canonical v1 schema using its complete employed vocabulary; unknown schema keywords fail closed. The bounded validator is not advertised as a general-purpose JSON Schema engine. Governance review and rendered evidence still require qualified independent collectors/reviewers. Missing independent receipts remain a genuine blocker, never an inferred pass.

## Independent governance scope and typed review

Every bundle requires exactly one reviewer-signed `governance_scope` receipt binding the canonical Task digest, repository, source/tested revisions, `observed_at`, `paths_digest` (canonical actual path-array digest), and `required_check_ids`. The independent reviewer obtains applicable requirements from the existing governance/context router and source owners, not from a second governance engine. All signed requirement IDs are added to mandatory checks. Missing, stale or path-mismatched scope fails closed.

Trusted `agent-system/evidence-policy.json` requires reviewer-role proof for governance, affected scope, source-owner, security, visual review and native admission. Required rendered-frame and motion checks require corresponding Evidence kinds; native evidence requires `windows-native`. A generic collector's test receipt cannot satisfy these obligations. A submitted profile may add manual review, but cannot remove trusted review requirements. Reviewer attestation is not final owner acceptance.

## Read-only GitHub observation adapter

`observeGitHubRun` in `scripts/agent/github-ci-evidence.mjs` observes an independently requested exact repository/source-head/run/workflow. It uses GET only, rejects redirects, bounds response sizes, times out requests, limits pagination and returns explicit job coverage. Rate limits are surfaced without automatic retry loops. Optional read token is sent only to the fixed GitHub API host and never returned. It records genuine run/job state and timestamps; it does not infer the tested checkout commit, workflow integrity, artifact content or owner approval from a green run. Those fields remain unavailable. This adapter output is an observation, not a signed verifier receipt or automatic acceptance.

The trusted target workflow's own check may attach to the base SHA. Contributor-head required-check publication and repository protection are **not implemented/configured by this patch**, and must be independently hosted-tested before claiming enforceable final coverage.
