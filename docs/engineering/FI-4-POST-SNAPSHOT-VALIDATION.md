# FI-4 post-snapshot cloud validation

The independently reviewed runtime snapshot remains `f6d9591bf994bbee006f3ea8b554dac8bac73235`; its parent is `eb8c6b3b3009072fcb9ed34d6391ff4a8f60bb4e`. No amend/rebase changes that snapshot. Follow-up validation and any runtime correction are separate commits on `fi4-post-review-validation`.

## Additional integrated evidence

Two new real subprocess tests use the fixed shipped source worker and canonical on-disk MissionService journal. The original host sends a test handshake only after the actual worker exits and the original producer receipt commits. The parent then kills that owned test process and waits for its OS exit. A fresh process opens the same database and uses existing Retry/readback without dispatching another worker. It preserves original attempt/effect/evidence identity. The cancellation variant records user cancellation before process death; the fresh host must preserve cancellation and deny reconciliation. Delivery interruption is synthetic; worker execution/exit, SQLite durability and host-process death/reopen are real Linux operations. No subprocess accepts caller-selected commands, credentials, source paths or external effects.

Passed additional checks:

- Real host subprocess loss/recovery and cancelled recovery: 2 tests.
- Previously unrun actual Backend worker-loss/reopen fixture: 1 test.
- Canonical transaction coordination plus mission stream/replay/admission: 18 tests.
- Required governance router/context tests: 41 tests; registry and reference verification, context benchmark and strict engineering-context evaluation passed.
- CI review runtime/source-build contracts: 22 tests; native journey script syntax passed.
- Shared Vela Core typecheck and Linux desktop typecheck passed. These start no desktop window, rendering or native hardware load.

The build-contract run initially failed seven cases because this checkout lacked CI's exact owned `jose` tarball cache, and the concurrently installing desktop tree had not yet supplied `esbuild`. Installing the pinned dependencies with scripts disabled and the documented `.runtime/npm-cache` location resolved those environmental prerequisites; no provider/source/lockfile edits were made. The rerun passed all 22. Typecheck also caught unsupported test-only ForkOptions and a process-send overload; the fixture now uses supported Node APIs.

The full 17-group `scripts/run-aerynth-acceptance.mts` runner remains unrun here: it includes the explicitly independent FI-2/CIE/provider suites and repeats whole packages. Its eventual combined integration run is still a gate; these scoped checks are not a green whole-application CI claim. No live API, paid work, public publication, merge, deployment or private credential access occurred.

## Separate discovered correction

A focused counterexample on `f6d9591b` showed an authorized linked-workroom Retry being rejected: receipt scope checks used the caller's workroom instead of the canonical originating mission scope. The correction is isolated after this test-only commit. It must continue to authorize both caller and original scope; it must not retarget a receipt or admit unlinked/different-project workspaces. The original reviewed snapshot and its Library artifact remain immutable evidence of the pre-correction implementation.

## Native boundaries and concrete next source-owner seam

This evidence covers the existing fixed read-only worker, not arbitrary command/process-tree or provider effects. Further release requires an effect-class-specific producer, never a generic successful-response assertion.

For the existing Codex project-check class, the exact seam is `ProviderPort.projectChecks` in `prototypes/integrated-backend/src/contracts.mts`, `createMissionProjectCheck` in `mission-project-check.mts`, `providers.mts`, and `AppServerBridge.execReadOnly` in `prototypes/codex-bridge/src/adapter.ts`. The current return is exitCode/stdout/stderr. A producer needs original execution identity, connection/process instance, command/cwd/source-digest binding and authoritative terminal readback. Generated `CommandExecParams.processId`/terminate shapes alone do not qualify the installed native App Server or prove descendants stopped. Do not change the read-only/no-network sandbox, rerun a command to discover its outcome, or promote a parent exit response to process-tree quiescence. Required Windows cases include surviving descendants, late output/effects, host/connection loss, cancellation, PID/session reuse and exact original source/receipt recovery.

A narrower possible next class is the fixed GPU readback diagnostic: `createGpuReadbackAdapter` in `mission-gpu-readback.mts` owns attempt/lease/context binding; `openWindowsGpuReadback` in `windows-gpu-readback.mts` owns the actual native child lifetime. A terminal producer would need to retain the original verified buffer result and exact context/attempt identity and attest the actual child's exit before canonical capture. Budget/lease release is not that proof. FI-3 owns this producer/native-resource work and currently holds the desktop slot; coordinate that exact interface before edits or native load. Linux fixtures cannot supply real D3D11/device/Windows-job qualification.

Cloud work completed here does not need owner input. The remaining Windows producer/platform qualification needs the coordinated native owner/environment; broad UI/gaming acceptance remains with FI-3/FI-6 and the owner. No new monitoring, privilege or retention policy is proposed.
