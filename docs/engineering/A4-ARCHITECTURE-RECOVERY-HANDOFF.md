# A4 architecture recovery handoff

Program A baseline is `7747e8c723b5961d6edfd6fb75758a50e87e7ac6`. This change fixes the source proof at the Live voice context boundary and adds a regression using the real Core owner with synthetic inputs.

| Responsibility | Current owner and contract |
| --- | --- |
| SQLite writes and recovery | [Core](../../prototypes/integrated-backend/src/core.mts) coordinates the kernel savepoint, durable writer fence, owner mutations and post-commit publication. The [A2.1 transaction ledger](A2-1-TRANSACTION-COORDINATION.md) records the interruption boundary. |
| Routes and authorization | [VelaService](../../prototypes/vela-core/src/service.mts) and Core bind canonical request, effective route and review. [Capability discovery](../../prototypes/vela-core/src/capability-catalog.mts) supplies scoped schemas. Source/effect owners authorize actual operations. [A2.2](A2-2-ROUTING-AUTHORIZATION-COORDINATION.md) lists supported paths and verified denials. |
| Context | Conversation graph, selected-document and native product owners provide Core inputs. Core and Vela compile bounded history and enforce source fences. [Mission context](../../prototypes/vela-core/src/mission-context.mts) binds evidence to the mission, plan revision, principal, policy, scope and destination. [Personal Context](../../prototypes/personal-context/src/service.mts) owns its encrypted records and disclosure contracts in its standalone package. A production Core host binding remains open. |
| Execution and effect verification | [MissionService](../../prototypes/integrated-backend/src/mission-service.mts) controls task attempts and durable lifecycle. The [provider adapters](../../prototypes/openai-provider) and native owners supply transport and effect evidence. Unknown interrupted work remains subject to reconciliation. |
| Desktop and spatial projection | [Desktop host](../../prototypes/integrated-backend/src/desktop-host.mts) and Electron IPC relay canonical snapshots and scoped replay. WorkspaceEngine persists geometry, Constellation owns gesture identity and the Motion Coordinator owns in-memory transitions. [A2.3](A2-3-RENDERER-APPLICATION-COORDINATION.md) records generation, scope, scan coverage and recovery. |
| Resource control and profiling | [Mission admission](../../prototypes/integrated-backend/src/mission-admission.mts) supplies current host pressure to MissionService. Attempts hold timing and provider-reported usage when available. FI-1 and FI-3 extend these seams under their respective owners. |

## Provider disclosure repair

Live voice selected the last 32 visible conversation records, omitted system turns and trimmed the remaining payload to 8,192 UTF-8 JSON bytes. The previous source proof used a suffix of the original record list. A trailing system turn could therefore replace the identity of a transmitted assistant turn in the proof. The context now selects each message ID and payload together before trimming, then derives the provider history and proof from the same retained set. Before disclosure it rechecks each retained message through the canonical conversation access owner and verifies the body digest. The regression demonstrates that marking omitted rows unavailable leaves the proof valid, and that either source-owner denial or loss of the included row invalidates it. The existing scope stamp, context digest, expiry and operation proof still gate disclosure.

No persisted schema or provider wire format changes. The source list is process-local. Rollback uses the same profile and restores the previous proof construction.

## AIR and handoff

The repository implements the exact local path, effective route settings and account discovery, scoped context and review, bounded provider execution, and observed settlement. Those capabilities support staged recovery through the [A2.2 AIR audit](A2-2-ROUTING-AUTHORIZATION-COORDINATION.md). Broad model-assisted perception, iterative semantic CIE, evidence-led adaptive selection, and supervised executive replanning require Program B verification. Successful synthetic transport tests do not establish a live provider's entitlement, latency, tool support or cost.

The [route contract](../../prototypes/vela-core/src/adaptive-routing.ts) exposes named decisions. The inspected Core and Vela runtime sources have no numbered AIR L0–L5 route enum. The L0–L5 table in [Charter 15](../../governance/15-QUALITY-VERIFICATION-AND-ACCEPTANCE.md) names evidence levels, so this audit maps the implemented provider paths directly to their owners and gates.

| Observed route | Source owner and gate |
| --- | --- |
| Native exact fact or approved local action | Core routes the canonical request to the native owner. Model dispatch is unnecessary for eligible exact facts. Effectful native actions retain their own review and verification. |
| Conversational quick or deep | Core selects account-qualified model and reasoning controls. API Responses requires the current API usage grant. ChatGPT plan Responses uses its own account session and catalog. Calibration and escalation have explicit limits. |
| Application planning | The capability catalog supplies scoped action schemas. Vela and the host validate the resulting proposal against native review and source fences before applying actions. |
| Codex agentic, composite, file edit, or project check | Explicit Codex or reviewed local operations use the existing App Server and native owner boundaries. Local reads, selected targets, write reviews, and follow-up verification retain their own admission contracts. |

Run `node --test prototypes/integrated-backend/tests/vela-voice-runtime.test.mts` and `npm --prefix prototypes/integrated-backend run typecheck`. Cross-package CI and the Windows desktop build gate run on the PR. The previous [A2.3 Windows journey](A2-3-NATIVE-VERIFICATION.md) is historical evidence for its recorded source. Qualification on this source still needs a connected voice journey and owner review.

The [Windows integration run](https://github.com/Kgray44/Aetherwake/actions/runs/42957829406/job/130317047439) passed 16 of 17 groups. In the workroom-scope regression, both native counter tasks were still running when the test's observation deadline elapsed. The five scope-revocation cases now seed labeled synthetic samples while retaining the real scheduler, verified dependency join, canonical receipt publication, search and branch review. Other mission conversation cases continue to exercise the native measurements. Run `node --test prototypes/integrated-backend/tests/mission-conversation.test.mts` to check both paths. The fixture adjustment requires no runtime or schema migration.

The sample helper runs before scope setup. A three-way comparison with Mission 03's lease-gate fixture change preserved both the sample helper and the governor memory input. A Windows snapshot combining A4 `9912be8c` with [ARIE #42](https://github.com/Kgray44/Aetherwake/pull/42) at `9103e446` passed all 30 focused tests. The deterministic samples reached the existing mission pipeline after the real lease gate admitted the tasks. The [FI-0 handoff](https://github.com/Kgray44/Aetherwake/pull/40) records the pinned inputs and scope.

### Native voice transport probe

The [loopback probe](../../prototypes/visual-experience/cinematic-v3/native/voice-loopback-verify.cjs) ran on Windows with Electron 45.2.1. It uses the production media broker, sandboxed preload and native host client. A separate owned Electron renderer supplies a synthetic local WebRTC answer and acknowledges the data-channel commands. Both renderers are muted, and the peer uses a silent generated track. The probe uses no physical microphone, provider credential or provider network request.

The broker denied prepare before authorization and after the single-use attempt was consumed. The authorized output-only offer reported no microphone request and no enabled local track. Input device selection was denied in output-only mode. The connected session received the start, commentary and close acknowledgments with the expected identities. Dispose destroyed the private media window while leaving the owned peer available for the verifier to close.

The first loopback completed with default graphics initialization. Subsequent attempts on the same host timed out during output-only startup. The instrumented failure had zero page-load completions, preload errors, ready signals, and replies at the deadline. With `--software-rendering`, the transport-only probe disables hardware acceleration in its own Electron process. Three software runs passed, with offers prepared in 2.5, 3.2, and 7.7 seconds. These observations establish a native transport path and a startup variability risk. Production startup reliability, live provider negotiation, physical playback and human audibility remain open. All 13 broker unit tests also passed.

With desktop dependencies installed, run from the repository root.

```powershell
$app = 'prototypes/visual-experience/cinematic-v3'
$scratch = (New-Item -ItemType Directory (Join-Path ([IO.Path]::GetTempPath()) ("aerynth-voice-loopback-" + [guid]::NewGuid()))).FullName
$preload = Join-Path $scratch 'vela-live-media-preload.cjs'
& "./$app/node_modules/.bin/esbuild.cmd" "$app/src/gpt-live-native-media.ts" --bundle --format=cjs --platform=browser --target=chrome144 --external:electron --legal-comments=none "--outfile=$preload"
if ($LASTEXITCODE -ne 0) { throw 'Live media preload build failed' }
& "./$app/node_modules/electron/dist/electron.exe" "$app/native/voice-loopback-verify.cjs" $scratch $preload --software-rendering | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'Voice loopback verification failed' }
```
