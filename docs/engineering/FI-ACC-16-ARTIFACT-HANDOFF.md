# FI-ACC-16 artifact handoff

From an open workspace, submit `Run a mission to generate an illustration: <prompt>` to Vela. Review the mission and select Start. The native confirmation shows the exact prompt sent to OpenAI, the configured API usage, and both output filenames. Approving the review authorizes one image request and workspace placement of one PNG and a companion text file. The text records the requested prompt and the independently checked image dimensions. The Vela report links to the mission and identifies the two files available in the workspace.

The dedicated API runtime uses its existing credential, catalog, usage limits, and SQLite request ledger. The Start fingerprint binds the workspace and configuration version. No workspace source bodies or filesystem paths accompany the prompt. Native storage admission runs before provider dispatch and before writing. The managed output directory is exclusive to the mission. Workspace resources use the existing media import path. The MissionService verifier checks the PNG dimensions, chunk integrity and bounded decompression, the text encoding, and both byte digests against the registered resources. Changes to the file identity or workspace placement invalidate the report. Unknown outcomes retain the mission attempt and never replay the provider request.

One live source-mode acceptance run at `fbe9de2c9034db0ed4ad7f7f54b4bf61cc369295` used the existing ephemeral API test credential in a disposable profile. The native Start broker ran with simulated dialog ports. The dedicated API produced a real 1024 × 1024 PNG. The text file and PNG were registered and independently read back, the Vela report survived restart, and changing the text invalidated verification. A duplicate Start returned the same mission. The test cleaned up its disposable profile. The later failure-path test verifies that an unconfirmed request produces no output and is not replayed after restart. This receipt covers the explicit illustration workflow. A packaged desktop run, independently graded narrative/image quality, and general adaptive selection of artifact producers remain separate acceptance work.

## Opt-in retained source-mode evidence

The `mission-api-planning.test.mts` illustration harness now supports an **external, new, absolute directory** in `AERYNTH_ARTIFACT_EVIDENCE_DIR`. It retains only `illustration.png`, `illustration-notes.txt`, `report.txt`, and `manifest.json` after every lifecycle assertion passes. It never copies the disposable profile, SQLite ledger, credential envelope, environment, transport headers, or private conversation history. The objective is the harness's fixed synthetic illustration request; this is not an arbitrary user-profile export tool. Default runs still clean up all outputs.

With an already authorized ephemeral `OPENAI_API_KEY` supplied through the existing secure test environment, run from the repository root:

```sh
AERYNTH_VERIFY_LIVE_MISSION_ARTIFACTS=1 AERYNTH_ARTIFACT_EVIDENCE_DIR=/absolute/owned/new-bundle node --test --test-name-pattern='one qualified live illustration mission' prototypes/integrated-backend/tests/mission-api-planning.test.mts
```

Do not paste a credential into the command, logs, or evidence. This run makes one image-generation inference through the actual product adapter and may make catalog/qualification reads. It does not use `image_gen`, signed-in Codex credentials, or a fake provider as a fallback. Keep normal product consent and test authorization in force. If the credential is unavailable, do not run or replay the live case. An unconfirmed remote outcome is still unknown and must not be retried merely to obtain a bundle. Failure produces no completed manifest; it must be reported as failure, not quality evidence.

A zero-provider development check can retain a **synthetic black-square** bundle separately:

```sh
AERYNTH_SYNTHETIC_ARTIFACT_EVIDENCE_DIR=/absolute/owned/new-synthetic-bundle node --test --test-name-pattern='a native-reviewed illustration mission publishes' prototypes/integrated-backend/tests/mission-api-planning.test.mts
```

The manifest records source commit/tree, dirty status and tracked-diff/helper hashes, platform/runtime, synthetic versus real provider, and SHA-256/size of each retained file. A dirty tree is explicitly not an exact committed build. Re-run the bounded synthetic case on the integrated clean commit for final provenance. Simulated dialog ports, source-mode execution, untested packaged UI/original-chat UI/revocation, and pending independent quality/owner acceptance remain explicit. Checks cover workspace registration/readback, persisted report identity/content after reopen, idempotent Start, one inference usage debit, and stale report after changing the companion text. The original outputs are captured before destructive stale testing.

An independent reader can run `verifyArtifactEvidence(directory)` from `prototypes/integrated-backend/tests/helpers/artifact-evidence.mts` to reject changed bytes, unexpected files and symlinked bundle files. This verifies integrity, not semantic quality or provenance authenticity. The manifest is a test receipt, not a signature. Retained outputs are local only; publishing or sharing them is a separate decision. After review, remove the explicitly selected bundle according to the evidence custodian's retention policy.

### Independent whole-outcome review (still required)

Before grading, verify the manifest and inspect the actual retained image, notes and report. Record the reviewed bundle digest, independent reviewer role, date and each result outside the producer's manifest:

- Does the image actually satisfy the stated prompt, rather than merely decode with expected dimensions?
- Are companion text and report accurate about what was created, with no unsupported quality/completion claim?
- Do both named outputs open and match the retained digests? Does the report correspond to the same mission?
- What remains unproven by source-mode evidence: real original-chat presentation and accessible resource opening, packaged native approval, restart/revocation behavior on that exact package, and owner experience acceptance?

The earlier cleaned live run cannot be retroactively independently graded. The source harness does not close D2/D3 or general adaptive artifact-producer selection. The portable review package targets Windows x64 and requires the actual host's ReserveGuard and native credential/consent boundaries; cloud Linux source results cannot certify that journey.
