# Aerynth continuous verification

Architecture Recovery. The integrated workflow checks the PR merge revision, each push to `main`, a merge-group revision when GitHub requests one, and manual runs. Each platform runs the 17 existing groups once. Windows builds the shipping desktop and native helpers and executes the addon contract. Linux typechecks the backend, Vela Core and desktop. Both execute the worker-loss fixture as part of the existing full suite.

| Classification | Evidence |
| --- | --- |
| Synthetic | Controlled input, fake provider transport or injected fault. Record the fixture and actual code under test. |
| Component | One package or service contract exercised through its test runner. |
| Cross-package | Canonical owner interactions, such as Electron host boundaries, Core/SQLite, provider adapters and journal/replay. |
| Native | Actual executable or OS contract. Hosted Windows addon checks qualify only that boundary. Physical desktop, input, audio, device and display journeys have their own receipts. |
| Live-provider | Authorized, bounded execution against the actual provider account and native or API transport. Record provider, entitlement type, attempts, cost or usage availability, observed result and effect verification. |
| Independent-quality | A reviewer verifies evidence against task criteria using observable artifacts or held-out scenarios. |
| Owner-acceptance | The owner observes and accepts the specified product experience. Record the scope and revision accepted. |

Classifications can overlap. The group arrays describe the kinds of evidence a group contains. A pass for a group does not certify every test in that group ran or qualify an unobserved release gate.

## Runner and evidence

Use Node 24.18.0 and run from the repository root. Install the same locked dependencies as the platform workflow. The provider install keeps its checkout-local npm cache because the offline review packager validates the original locked `jose` tarball. Package scripts for block library, Codex bridge, connected conversations, constellation, conversation product, integrated backend, OpenAI provider, personal context, timer, Vela Core, desktop, workspace engine and workspace kernel have corresponding entries in the shared runner. The runner additionally covers the manifest-free agent, checklist, task and timeline products. It retains extra CJS/MJS and provider suites where the package's shorthand runs a subset. `application-contract` has no independent runner and is exercised by integration and typechecking.

```powershell
node scripts/run-aerynth-acceptance.mts
node scripts/run-aerynth-acceptance.mts integrated-backend connected-conversations
```

Set `AERYNTH_ACCEPTANCE_OUTPUT` to a fresh private directory to override `.runtime/acceptance`. The JSON contains checked-out SHA, clean-tree flag, platform, runner image, cases, durations, skipped and failed counts, group exit status and unqualified gates. A missing report, empty group or group with no passing tests fails the runner. Test source and case names identify the failure. Error bodies and skip strings stay out of the JSON. Publish only the safe test and gate summaries. Keep native profiles, screenshots, raw provider traffic and databases private.

For a suspected flake, keep the first report and set `AERYNTH_ACCEPTANCE_PREVIOUS` to that JSON before a second run of the same group on the same clean revision and environment. The runner records tests that switched between pass and fail. Preserve both reports and the first failure. CI performs no automatic retry. On a hosted rerun download the comparable earlier artifact locally for this comparison. A changed environment or revision cannot establish a flake. A cancelled job or failed setup can prevent suite reporting. The aggregate records job outcomes separately.

The timing artifact measures verification wall time from the first job start to the last job completion and includes queue time when provided and job/step durations. Compare the same runner images, cache state and event class. Avoid adding durations of jobs that ran in parallel. The workflow reuses npm's download cache, skips desktop install scripts on Linux and removes the separately repeated addon and worker-loss tests because both still run inside the full suites. The full desktop build and addon diagnostic compile remain distinct checks. Run expensive profiler experiments and physical-desktop journeys separately.

## Recovery evidence

| Fault | Verification path |
| --- | --- |
| Worker loss and restart | `mission-integration.test.mts` interrupts the real worker on its durable started event and reopens the exact SQLite profile. |
| Stale response and permission revocation | `mission-api-specialists.test.mts` holds the provider response while the real Core revokes usage, then checks that late responses cannot verify work. |
| Cancellation, duplicate dispatch and unknown external effect | The API specialist tests exercise the canonical one-use attempt, cancellation with an uncertain outcome, restart and replay prevention. The file-edit Core suite tests durable quarantine on unknown runner effects. |
| SQLite write failure | `canonical-event-commit.test.mts` uses a temporary SQLite trigger to reject the state write after domain and journal work. It checks rollback and suppressed delivery, removes the fault, then verifies one committed event and resource through reopen. |
| Instrumentation parity | `mission-service.test.mts` compares the real mission service in off, minimal and full modes with verified output and a cancelled non-replay-safe effect. |

Run the existing provider-free overhead workload with `node prototypes/integrated-backend/src/profiler-benchmark.mts`. A Windows/Node 24.18.0 sample of nine measured batches per mode, 24 fixture missions per batch, recorded execution medians of 50.0 ms off, 52.3 ms minimal and 69.9 ms full. Journal JSON medians were 156,728, 171,094 and 196,699 bytes respectively. The benchmark used in-memory SQLite under ambient load. Treat it as a sample without a performance threshold.

Previous hosted Windows failures included native fixture startup/restore assertions and recovery deadlines. Run [43155673384](https://github.com/Kgray44/Aetherwake/actions/runs/43155673384) was followed by [43159788011](https://github.com/Kgray44/Aetherwake/actions/runs/43159788011) after the source-withdrawal fixture stopped depending on CPU sample timing. [43104541070](https://github.com/Kgray44/Aetherwake/actions/runs/43104541070) also reported direct Codex turn recovery and specialist settlement timeouts. Distinguish expected negative-fixture diagnostics from the Node runner's actual failure records.

The [exact-main baseline run](https://github.com/Kgray44/Aetherwake/actions/runs/43329909127) timed out in the native transport fixture. The original five-second deadline covered process startup and all commands, and the first metrics response only established that the parent process had started. The test now uses a canonical snapshot as the worker readiness barrier, keeps five-second deadlines after readiness, and reports the mode and RPC on timeout. To reproduce cold startup without changing production code, run the following from the repository root. Under the same 5.5-second injection the original fixture failed at `desktop_fixture_timeout`, and the corrected fixture passed both host modes.

```powershell
$preload = (Resolve-Path 'prototypes/integrated-backend/tests/fixtures/slow-desktop-start.mjs').Path
$env:NODE_OPTIONS = '--import=' + ([uri]$preload).AbsoluteUri
try {
  node --test --test-name-pattern 'three-argument and opt-in' prototypes/integrated-backend/tests/native-host-transport.test.mts
} finally {
  Remove-Item Env:NODE_OPTIONS
}
```

## Physical Windows qualification

1. Check out the exact clean SHA and provision the locked Windows dependencies, Node 24.18.0, MSVC and Electron. Use a disposable synthetic profile and a foreground desktop session. Check both drive reserves before setup, build and execution and at least every five minutes during long writes. Record Node/Electron/Windows versions and device class.
2. Run `npm --prefix prototypes/visual-experience/cinematic-v3 run verify:application`. Run `node scripts/verify-living-instruments-native.mjs` and its `--mission-only` and `--family-only` variants for those release claims. Reopen the exact fixture profile for restore and retain the runner receipts. Follow the [A2.3 native ledger](A2-3-NATIVE-VERIFICATION.md) for physical input, permissions, restart and evidence limits.
3. For real input and hardware qualification, have an operator repeat the scoped journey using the actual keyboard, pointer and devices under test. Record observed outcomes and setup limitations. Keep independently reviewed quality and owner acceptance as separately signed records.

## Live provider qualification

Use a disposable synthetic profile and an existing explicitly authorized account. Scope the provider, model or entitlement, one logical attempt, and the account's already approved budget before starting. Keep the account session and credentials in their existing local broker. Never use CI secrets to run these jobs or substitute another credential or paid API on failure.

For a previously authorized signed-in Codex account, from `prototypes/integrated-backend` run `npm run smoke` once. The source-owned journey requests one marker turn with synthetic input, reopens the same profile, and checks the persisted thread/item receipt. Require `simulatedProvider: false`, exact marker, expected item types, restart identity and `taskVerified: false`. Retain its safe aggregate. A timeout or uncertain dispatch needs read-only reconciliation on the original profile before any separately approved retry. See the [backend verification ledger](../../prototypes/integrated-backend/VERIFICATION.md) for the reconciliation command and boundary.

For paid API qualification, use the normal Vela API connection and reviewed mission controls with the authorized key in the native broker. First confirm the allowed model, approved ceiling and the account's enforceable request, token and spend limits. Use a synthetic bounded request, one authorized attempt, and an independently observed postcondition. If enforceable limits or authorization are unavailable, record the gate as unqualified and stop before inference. Retain only the redacted admission, request count, usage, verification and uncertainty states. Each separately authorized provider/device scenario needs its own receipt.

Hosted CI covers fixture-backed behavior and native build/addon evidence. Physical desktop, live providers, independent quality and owner acceptance remain unqualified in its report. ReserveGuard is a local instruction and monitoring mechanism. External applications, hosted tasks and local processes that never loaded it can operate outside its coverage.

## Observed verification on 2026-11-12

- [First aggregate run](https://github.com/Kgray44/Aetherwake/actions/runs/43331669464) rejected two platform failures after a cache change removed offline tarball proof and a security failure because GitHub Dependency Review was unavailable. The provider cache was restored. The replacement lockfile audit rejected Vite 7.1.12 for high-severity advisories and passed after the 7.3.8 update. The [next complete security check](https://github.com/Kgray44/Aetherwake/actions/runs/43332377549) audited all six locks with zero high or critical findings and passed Gitleaks and actionlint.
- At `fe37430c`, Windows Node 24.18.0 ran one signed-in Codex marker turn through the real App Server. It observed the exact marker and a same-profile reopen with the expected two turn item types. The receipt kept `taskVerified: false` and recorded 16.8 seconds. The first local launcher stopped before SQLite creation. The file-backed launcher then completed the one authorized provider turn. Paid API qualification remains open.
- The same revision passed typecheck, desktop/native build, fixture preparation and all 12 initial Electron checks on Windows. Fresh-process restore rejected differing spatial anchors and a missing pin. The renderer/Constellation owner should investigate with the retained exact profile and source-bound receipt. The restore assertion remains enabled. Physical input and owner acceptance remain open.
