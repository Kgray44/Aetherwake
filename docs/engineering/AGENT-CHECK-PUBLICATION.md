# Exact-head check preparation: not a provisioned publisher

`prepareExactHeadCheck` is a data-only adapter around the existing Phase D verifier. It does not call GitHub, write checks, install workflows, authenticate JSON, provision secrets, change branch protection, or establish owner acceptance. A candidate-supplied `ok` field is never verification evidence. The module calls `verifyBundle` itself, retains all signed-receipt/artifact checks, and requires an enforced profile with no pending manual gate before preparing success.

## Trusted caller contract

A future isolated, reviewed default-branch verifier must supply the GitHub-issued `pull_request_target` event, independently fetched current PR metadata, exact immutable verifier revision, complete independently retrieved changed-path list, and independently established tested revision. The verifier's code, policy, schema, dependencies, trust store and artifact-reader boundary must all come from reviewed trusted code/configuration, never candidate imports or installations. Event-name strings or API-shaped objects alone are not authentication. The preparation helper cannot prove completeness of a caller-provided path array or provenance of its facts. Source head and repository override any conflicting options, and the current source/base identities must still match the event.

The check payload has one fixed name and exact contributor `head_sha`, never the merge ref or base SHA. Summary text contains only validated revision identities and a fixed result; candidate titles, IDs, failure messages, artifact paths and content are not copied into GitHub output. Success describes evidence-policy checks, not Task acceptance or owner approval. Report-only profiles and unresolved manual gates prepare failure. Invalid/stale context throws and must not be converted to success by a future caller.

## Deliberately unimplemented operational gates

1. Review and install an isolated trusted workflow, including its exact checkout and evidence-ingestion strategy. It must not execute candidate code with privileged credentials.
2. Explicitly authorize narrowly scoped check-write access. No permission grant is included in this change.
3. Re-read PR identity immediately before publication, publish only the prepared exact head, verify the returned check's repository/head/name/conclusion and record its immutable ID. Design idempotency and supersession explicitly; do not mutate an unrelated check. Never infer success from an exit code under report-only mode.
4. Require the check from its intended GitHub App identity under reviewed protection settings. Name-only checks can be spoofed by a different publisher. No branch/ruleset setting changes are included.
5. Run hosted negative cases for moved heads, wrong repository/base, unsigned/forged/stale evidence, missing trust configuration and manual review, and retain the failures. Demonstrate an actual exact-head check before claiming operational enforcement.

The tests use ephemeral synthetic signing keys and local fixture artifact bytes. They prove adapter behavior, not a production signing or check-publication boundary. Existing Aerynth CI/native/security gates remain unchanged.
