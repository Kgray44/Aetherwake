# Verification — 2026-11-01

## Environment and source

- Windows host, PowerShell, Node `v24.18.0`, npm `11.9.0`, installed `codex-cli 0.153.3`.
- Worktree branch `codex/04-codex-bridge`, created from `main` at `3a9fa4883415f3a01cdb187a813b17a4142508a3`.
- Official protocol checked against [Codex App Server](https://learn.chatgpt.com/docs/app-server); installed CLI generated the committed TypeScript wire bindings.
- `governance/README.md` marked Constitution 00 established and the eight relevant charters published but pending owner acceptance. `governance-context.mjs` failed with `Cannot read properties of undefined (reading 'some')` on both full and narrower invocations. The Constitution and relevant charter source were read directly. This router failure is outside the exclusive writable scope of this prototype.

## Commands and actual results

| Command | Result |
|---|---|
| `codex --version` | `codex-cli 0.153.3` |
| `codex app-server generate-ts --out prototypes/codex-bridge/protocol-generated` | Generated 706 TypeScript files, 408,884 bytes. |
| `npm ci` | Dependency install is reproducible from the lockfile; initial `npm install --no-audit --no-fund` succeeded. |
| `npm run typecheck` | Passed after generated bindings were configured with TypeScript bundler resolution. |
| `npm test` | Seven fixture tests passed: handshake/catalog/lifecycle, auth absence/invalid RPC, rate limit/model unavailable, missing executable/crash, command and file approval refusal/cancellation, interrupt/reconnect, interrupted stream. |
| `npm run demo -- capabilities` | Connected to installed App Server on Windows. Existing ChatGPT authentication reported available. Eight model catalog entries returned, all marked entitlement unverified. |
| `npm run demo -- live` | One genuine read-only thread and turn ran. Observed `turn/started`, item start/completion, three `item/agentMessage/delta` notifications, and `turn/completed` with `status: completed`. No tool execution was observed in the printed stream. |
| `npm run demo -- inspect THREAD_ID TURN_ID` | Read two persisted items from the genuine turn without another model request; assistant text exactly matched `BRIDGE_OK`. |

The first live demo's intentional shutdown was initially labeled `bridge/transportFailed`; this was a reporting bug in the adapter, corrected to `bridge/closed` after the run. Typecheck and fixture tests passed after that correction. The live turn was not repeated solely to recheck the shutdown label. The genuine thread/turn IDs and raw response are intentionally omitted from this public artifact.

## Coverage boundaries

- **Implemented:** stdio process/JSONL transport, handshake, request correlation, notifications and server requests, bounded buffers, versioned event normalization, capability reporting, thread/turn operations, explicit reconnect, fail-closed approvals, CLI.
- **Compiled:** all adapter/demo/tests with TypeScript strict checking.
- **Fixture-tested:** all seven scenarios above. Approval and cancellation decisions are synthetic; no dangerous command was run.
- **Live-tested:** installed CLI connection, existing auth, model catalog discovery, one new thread/turn, streamed event delivery, provider terminal completion, persisted assistant response inspection.
- **Unverified live:** native fork/resume/interrupt, real approval round trip, actual crash recovery, unavailable-model/rate-limit handling, and model entitlement beyond the one default-model turn. Long histories, sustained throughput, Windows/macOS/Linux parity, full event schema compatibility, and production security/privacy are not established.

## Integration recommendations

Keep this as an adapter boundary, not Aerynth's canonical conversation model. Store application conversation IDs and provider thread IDs separately. Add durable, access-controlled event storage and reconcile gaps against paginated thread/items APIs. Implement an explicit user-facing approval review, then test permitted actions in a disposable environment. Probe each selected model with authorized usage before labeling it available. Record unsupported methods and authentication failures as capability state, and add compatibility checks when the Codex CLI version changes.

The AERO reserve guard allowed the bounded local work. Initial free bytes: C: 126,369,615,872; D: 501,038,153,728. Before the live turn: C: 124,241,272,832; D: 501,023,629,312, with a 10 MiB C: allocation estimate accepted. This rule monitors this Codex work only; it is not an OS quota and cannot stop external applications, cloud tasks, or already-running local processes that have not loaded the instruction.
