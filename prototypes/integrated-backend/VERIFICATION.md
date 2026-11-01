# Mission 01 evidence — 2026-11-01

Status: **implemented, locally tested and demonstrated; draft review requested**. Not merged, deployed, independently reviewed, production-qualified or owner-accepted. Source/dependency graph is in [COMPATIBILITY.md](COMPATIBILITY.md). Main baseline was `3a9fa4883415f3a01cdb187a813b17a4142508a3`; the four pinned prototype heads were combined by integration-only merge `a19955d9b9787ebe503d0d313a5a7df56e15d203`. The following integration commit contains the implementation and this report. Runtime databases and native IDs are excluded from Git.

## Changes and ownership

`src/contracts.mts`: versioned typed commands, identities, errors, capabilities, execution, handoff, snapshot and stream envelopes. `providers.mts`: asynchronous native/fixture ports. `core.mts`: transactional graph/resource service, reviewed handoffs, execution/recovery and durable journal. `worker.mts`/`service.mts`: async worker boundary. `journey.mts`/`demo.mts`/`reopen.mts`: full demonstration and read-only reopen verification. `benchmark.mts`: bounded synthetic latency measurement. `tests/integration.test.mts`: integration, failure, privacy and recovery regressions. `fixtures/`: immediately usable synthetic visual-team data. README/compatibility/UI/security/evidence documents and package/lock/tsconfig support reproduction. `.github/workflows/integrated-backend.yml` adds synthetic CI.

Two explicitly necessary prototype edits: workspace kernel's composable synchronous transaction seam and the graph's missing `ContextItem.sensitivity` type field (runtime field/checks already existed). All original prototype test scenarios still pass. No visual prototype, shader, style, animation or motion file is changed. Original PRs #6–#9 remain separate and open; main is unchanged.

## Executed checks

Windows, Node `v24.18.0`, npm `11.9.0`, installed native Codex **`0.166.0-alpha.5.1`** used for the live turns. The bridge baseline generated its wire types under `0.153.3`; successful minimal execution/reconciliation proves only the exercised subset is compatible, not complete protocol-version parity. TypeScript `5.9.3`, Node types `24.10.1`; all development dependencies locked, no new runtime dependency.

| Command / check | Actual result |
|---|---|
| `npm install --ignore-scripts --no-audit --no-fund`, then `npm ci --ignore-scripts --no-audit --no-fund` | 3 development packages installed; clean lockfile-based reinstall passed |
| `npm run typecheck` | Passed with strict checking; bundler resolution accommodates the inherited generated protocol type imports |
| `npm test` | **21/21 passed**, no skips |
| `node --test ../workspace-kernel/tests/*.test.mts ../connected-conversations/test/*.test.ts ../codex-bridge/tests/*.test.ts` | **31/31 passed**, no skips |
| `node --test tests/governance-router.test.mjs tests/governance-context.test.mjs` (repository root) | **33/33 passed** |
| `node scripts/governance-router.mjs --validate` | Valid, 17 registry entries, no warnings |
| `node scripts/benchmark-governance-context.mjs` | Passed, 7 fixtures; mean source-character reduction 35.63%; not a measured-token/agent-quality claim |
| `node scripts/evaluate-governance-engineering.mjs --strict` | Exit 0, 8 fixtures, 100% required-rule recall, zero critical misses; offline retrieval evidence only |
| V2 CLI | **Fails on baseline** with undefined `.some`; V2 **library API succeeds**, no route warnings; fingerprint and domains in compatibility report |
| `npm run demo` | Passed full synthetic-provider journey; 3 conversations, 2 lineage edges, 5 messages, 4 journal events captured before close, stable reopen, exact marker; 273 ms observed sample |
| `npm run smoke` | Genuine Codex journey passed twice during implementation; **no simulated substitution**. First elapsed 9,817 ms, second 8,492 ms; 30 captured journal events before close per run |
| `node src/reopen.mts EXISTING_SYNTHETIC_DATABASE --live` after final persistence guard | Passed with **no new inference**; 3 conversations, 2 edges, 5 messages, one completed execution in that database, 38 retained events including reopens/discovery, native thread available, exact persisted marker |
| `git diff --check` | Passed |
| Hosted synthetic CI | [Run 41348167953](https://github.com/Kgray44/Aetherwake/actions/runs/41348167953) passed on Ubuntu/Node 24.18.0 at implementation commit `3c8fe3c8301259af7cd8a098054ab3600cbd0d10`: clean install, strict types, 21 integration tests, 31 inherited tests and registry validation |

Early verification exposed a generated-protocol module-resolution mismatch, the inherited missing sensitivity type, JSON omission of optional undefined fields across restart, and transaction errors losing their service code. A clean reinstall run also exposed a test setup race: two workers were simultaneously initializing an empty database, which is outside the documented single-owner boundary and can fail closed. The stale-writer regression now initializes the database first before testing stale-state rejection. These were corrected; no failed check is counted as passing before correction. Integration fixture comparisons use JSON's specified omission semantics for absent optional fields. The V2 CLI remains a reported baseline limitation, not a repaired or passing CLI.

## Genuine execution receipt (safe aggregate)

The test submitted only synthetic context and the request to return `INTEGRATION_OK` with no tools/file inspection. It used existing native authentication, a new thread, read-only sandbox and never approval policy, and did not override Codex base/developer instructions or identity. Real notification families included native thread/turn lifecycle, item start/completion, assistant deltas, hook/MCP startup, usage and terminal completion. No raw payloads, account details, paths, native IDs or credentials are published here.

The second smoke observed `provider_completed` and exact assistant text, then followed the result into a labeled deterministic ordinary conversation. After backend close/reopen, native thread/items inspection returned exactly **`userMessage`, `agentMessage`**, complete page, exact marker. No command/file/tool item occurred in that turn's persisted item page. Startup hook/MCP status events are distinguished from tool execution. `taskVerified` remained **false** throughout. Model catalog discovery does not prove entitlement to every model; only the installed default model's minimal inference was exercised.

The final stale-writer guard was added after those live inference runs, tested through deterministic provider/transaction regressions, then exercised against the existing genuine database with read-only native reconciliation. This avoided another inference solely to repeat storage checks.

## Mandatory journey coverage

| Mission steps | Evidence |
|---|---|
| 1–4 start, ordinary chat/messages, persistent workspace/project | `journey` creates A without project/task, commits its message, then creates project/workspace independently |
| 5–6 branch and reviewed context | explicit selection/digest/citations, precise fork point, kernel relationship and separate fingerprint/revision/budget/expiry approval |
| 7–9 execute, stream, persist status/result | same async port for CI fixture and native bridge; commit-before-publish journal; genuine live marker and terminal receipt |
| 10–11 follow-up and source lineage | result message selected into C with reviewed result package, source histories preserved, both edges application continuations |
| 12–17 close/reopen, IDs/relationships/messages/handoffs/history | exact comparisons of JSON-visible graph, resources, bindings, reviews, relationships, message evidence and retained journal records |
| 18 placement distinct from resource | two blocks point at A; IDs differ; workspace layout survives restart; separate test moves a block without replacing resource or block identity |
| 19 unsupported capabilities | ordinary ChatGPT history and native fork explicitly false, no automatic fallback |
| 20 provider completion ≠ task verification | invariant `taskVerified:false`, including genuine result |

## Failure/security coverage

All required categories have executable coverage: provider unavailable; authentication absent; unsupported model before dispatch; invalid provider response; duplicate event suppression; missing sequence marker; interrupted turn; backend restart/process termination; missing provider thread; stale resource/source revision; duplicate handoff/create/execute keys and conflicting payloads; wrong target/account scope; rejected/forged/expired approval; unknown remote outcome with no retry; corrupt JSON/mapping/future schema. Existing kernel tests cover corrupt SQLite, migration rollback and interrupted uncommitted writes. Bridge tests cover malformed/native failures and default denial. New native-bridge-seam tests observe actual synthetic server command/file approval refusal through the application service. Injection-text fixtures cannot approve themselves or execute unreviewed context. A stale second backend is rejected without overwriting canonical graph/resource state.

## Performance and limits

`npm run benchmark` (single Windows run): 100 synthetic messages of 928 UTF-8 bytes each; initial worker/database startup **122.17 ms**, reopen with all 100 messages **84.44 ms**, append latency **p50 6.65 ms / p95 8.46 ms**, database **389,120 bytes**, process RSS **96,960,512 bytes** (includes host plus worker, not isolated worker memory). These are measured samples, not acceptance thresholds, rendering performance, sustained throughput or long-history scalability proof. The whole-graph snapshot is intentionally a prototype scaling limitation; admission fails before exceeding its 8 MiB cap.

## Remaining decisions and acceptance gaps

See [SECURITY.md](SECURITY.md) for residual risk. Secure private storage, real identity/approval authentication, automatically detected account scope, single-owner process lock, unknown-turn reconciliation, crash-time partial-message recovery, native fork semantics, multi-account/cross-device operation, accepted retention/migration/export design and sustained-load measurements remain open. The journal intentionally keeps safe metadata rather than full private content or hidden reasoning. Native fidelity audit findings remain independent and can replace this port. UI, motion, accessibility, device/rendering performance and owner acceptance are not established by backend tests. No permanent stack/contract selection is implied.

ReserveGuard accepted bounded allocation before work and before real-provider runs, rechecked within five-minute writer intervals. Latest recorded check before evidence closeout: **C: 134,542,491,648 free bytes; D: 502,019,588,096**, with an additional 134,217,728 C: bytes/0 D: bytes admitted. Both independently exceed 32,212,254,720 bytes. This is instruction-based monitoring, not an OS quota; external apps, cloud tasks and existing processes without this rule are outside its enforcement coverage.
