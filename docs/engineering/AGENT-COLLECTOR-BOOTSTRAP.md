# Independently controlled CI collector: proposal, not provisioned authority

Scope: make one narrow, reproducible CI command observable without letting its untrusted workload sign its own success. Reuse Phase D Ed25519 verification and Phase C immutable private record journal. No new task authority, scheduler, UI or signing service.

## Threat boundary

Producer/test code is untrusted. It may fabricate files, log lines, job outputs, prompts or claimed test results. None of those can supply the collector's expected identity, signing key, workflow policy, Task acceptance, governance requirements, or owner approval. Signing a producer-provided manifest is prohibited.

Collector runs in a separate job on a fresh runner. It executes ONLY reviewed default-branch collector code and trusted pinned actions. It never checks out/imports/installs/executes the candidate. Its signing secret, read token and event file are never available to the probe job. No caches or workspace/artifact restore crosses this trust boundary. Downloaded artifacts are not executable inputs.

## Minimal proposed workflow

Not installed by this draft:

1. `workflow_dispatch` only. Top-level job admission requires workflow ref to equal the repository default branch; no caller-selected reusable-workflow or pull-request-target execution. Validate full source SHA and repository before checkout. Record immutable workflow revision separately from requested source SHA. Reject missing/ambiguous inputs.
2. **Probe job**, contents-read only, no secrets/OIDC/checks-write, credentials not persisted. A trusted inline step binds `git rev-parse HEAD` to the source SHA supplied by the GitHub dispatch event before any candidate code runs. A fixed allowlisted command then executes. The command/argv, test selection and deadline come from the reviewed workflow policy, never task JSON. Preserve command failure as job failure. No producer artifact or job output is accepted as verification proof.
3. **Collector job** needs successful probe but independently retrieves that exact run-attempt's job result through GitHub's authenticated API. It checks repository, event, default branch, immutable workflow revision+digest, run ID, attempt, unique job name and required completed step identities. Expected source SHA comes from this job's fresh GitHub-issued dispatch event, not a file/output from probe. Fail on any missing/rerun/identity inconsistency.
4. Collector creates its OWN bounded canonical artifact from provider-observed command/job metadata. It hashes these bytes itself. Producer logs, arbitrary artifact content, prompts, private paths, credentials and test-authored status fields are excluded. The artifact does not claim rendered/native proof, governance coverage, source-owner review or final owner acceptance.
5. Only after explicit trust provisioning: sign a narrow `command-exit:<reviewed-policy-id>` receipt for the collector-created artifact. It establishes **reviewed command exited zero**, not correctness of all tests or Task acceptance. It cannot fulfill unrelated class obligations automatically. Existing independent governance scope/reviewer and owner gates remain mandatory.
6. Persist canonical records using Phase C `persistRecord`; raw data stays private. Publish/export only deliberately sanitized summaries. Existing legacy Aerynth CI and native acceptance remain authoritative.

Workflow integrity must cover the exact trusted wrapper/policy, not only a workflow filename. The proposed admission helper checks an externally supplied reviewed digest but does NOT authenticate arbitrary caller JSON. Only a protected GitHub reader in the isolated collector may call it with authenticated facts. A bounded reader is now staged in `scripts/agent/collector-reader.mjs`: it requests the exact run-attempt and complete attempt-specific job coverage, enforces exactly one matching probe job, retrieves immutable workflow bytes, and passes these through admission. It requires a token, pins the API origin, refuses redirects, and bounds time/body size/pages. The documented jobs shape may omit `run_attempt`; the reader binds it from the exact attempt endpoint and verifies the fetched run attempt independently. A conflicting present job attempt is rejected. Its expected identity still MUST come from a protected collector event/policy, not arbitrary caller JSON. The pure helper alone does not authenticate JSON or establish job uniqueness. This reader has synthetic transport coverage only, not a production trust bootstrap. A serialized lookalike observation cannot be turned into a collector artifact.

## What this isolated candidate proves

Eighteen synthetic tests check source/workflow revision separation, default-branch admission, failed/skipped/mismatched/rerun rejection, required-step coverage, workflow digest binding, process-bound artifact construction, refusal to claim Task/owner acceptance, authenticated transport configuration, complete pagination, duplicate/ambiguous job rejection, HTTP and oversized/malformed response failure. No workflow is installed or dispatched; no key is generated/provisioned, no settings are altered, and no production claim is made.

## Exact setup still requiring explicit approval/review

- Security review of the executable workflow and job-isolation boundary, then merge its immutable trusted implementation on main.
- Provision a dedicated Ed25519 signing private key ONLY to the isolated collector job, preferably a protected environment whose rules prohibit access from other workflows. The workload must not have this secret. Add the matching public key with collector-only role to out-of-band verifier trust configuration. Do not reuse owner/reviewer keys.
- Approve the exact workflow/environment secret access and its reviewed fixed command policy. Default-branch condition alone is not protection against a maintainer changing trusted workflow code; branch reviews/protection must cover it.
- Demonstrate a real source/head binding and real provider-observed job, hash readback, failed/forged artifact rejection and absent-secret failure. Only then consider operational usage.
- Contributor-head check publication remains a separate checks-write/required-check-protection action, not granted by this proposal.

Because no isolated production signing authority is provisioned, this is a design/test artifact, not a completed collector or operational AADS acceptance.
