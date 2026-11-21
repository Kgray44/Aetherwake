# AADS token efficiency, Phase 2

## Baseline and Phase 1 evidence

Phase 2 starts at main revision `f20ba0f10b7ad7433bb8c56d2eac963191d1f337`. The owner accepted the Phase 1 dependency. The original Phase 2 remains archived. PR #340 is merged at this revision. PRs #322 and #326 are open drafts. The checkout already contains the paired-experiment implementation from #322. The context rollout evaluator adapts #326's scoped, independently reviewed holdout and regression rules to a change in context format. [PR #340](https://github.com/Kgray44/Aetherwake/pull/340) · [PR #322](https://github.com/Kgray44/Aetherwake/pull/322) · [PR #326](https://github.com/Kgray44/Aetherwake/pull/326)

The recovered Phase 1 benchmark used revision `c11b8141ee7ec916f342d63dac8179e492cddf53`, OpenAI `gpt-6.2-sol`, the same 51,589-byte prepared payload, and a fresh persistent conversation per arm. Separate Git readbacks verified one identical artifact with SHA-256 `8f29c2ce9240d3b63ad52a76052d8ae41363f4d8776fd8e2a1a5298ab9dee2ee`. Only the opt-in local Git readback and governance assembly settings differed. The standard arm ran first. Cache warmth and model sampling were uncontrolled.

| Measurement | Before | After | Change |
|---|---:|---:|---:|
| Cumulative provider input | 335,848 | 409,703 | +73,855 |
| Cached input | 312,320 | 386,304 | +73,984 |
| Uncached input | 23,528 | 23,399 | −129 |
| Output | 2,469 | 2,168 | −301 |
| Total tokens | 338,317 | 411,871 | +73,554 (+21.7%) |
| Codex turn elapsed | 95.567 s | 104.751 s | +9.184 s |
| Checkout readback | 483 ms | 351 ms | −132 ms |

The sandbox-blocked probe produced no artifact and spent 292,631 tokens, comprising 291,071 input, 251,776 cached input, 39,295 uncached input and 1,560 output. Its provider turn took 78.852 seconds. The three-run program recorded **1,042,819 tokens** including **950,400 cached input**, **86,222 uncached input** and **6,197 output**. Provider turn elapsed time summed to 279.170 seconds. Billing and full program cost are unknown. The faster checkout readback and artifact equality establish their respective local outcomes. The trials demonstrated no token or cost savings.

| Restricted receipt | SHA-256 of original file |
|---|---|
| Before provider | `31e93e9277e69fd0272b70f0b1f53d1c3316bc131ea44ad6fc9d6e775e4f179b` |
| After provider | `b9254b79838566b6cc0044d0169ac5254032ff1cf1b833b677687d6541dc2d44` |
| Sandbox-blocked provider | `88ee93ffaceddc59b8f651cf2023bb43fe764c71e8cff160df060ea9d41cb241` |
| Before verification | `95a8490ce56f85330379e30472477f3a0402a8caa7c6d18430fb2d3f5e338750` |
| After verification | `14049aea1116fbdd89674c94188db2507bc357565f6196d1480daa705011418d` |

The private receipt files remain in their original custody. These digests identify the inputs for owner readback.

## What the evidence measures

- The Phase 1 provider receipts store final App Server cumulative totals. The increase tracks cached input almost exactly. Repeated prefix/history across provider requests is consistent with those counters. They give neither a count of provider responses nor attribution to specific prompt segments, compaction, retrieval, repeated reads or tool output. The worker sends one Task prompt and leaves native thread history with Codex. The existing governance renderer loads full required text plus some repeated provenance metadata. It enters model context only if a caller supplies or reads the output. Phase 1 had identical prepared payloads and cannot attribute the increase to governance bytes. [Connector](../../scripts/agent/observatory-connector.mjs) · [Worker](../../scripts/agent/observatory-task-worker.mjs) · [Governance context](../../scripts/governance-context.mjs)
- The 238,826-token trivial run, 282,838-token latency case, 427,035-token hosted qualification and 2,297,366-token interrupted Phase 1 case are separate observations with different scopes or outcomes. The last is an interrupted lower bound. The Task-supplied totals contextualize scale. Only the two successful Phase 1 arms share artifact readback and an explicitly matched protocol. The latency case also has a separate regression fixture. [Workspace fixtures](../../agent-system/observatory/task-workspace.test.mjs) · [Phase 1 recovery](https://github.com/Kgray44/Aetherwake/pull/340)
- The canonical attempt view already selected one scoped App Server final receipt. The generic Analytics reducer independently summed cumulative progress with final input and output. Analytics now routes App Server usage exclusively through scoped attempt accounting, and the experiment query retains the latest failed-turn lower bound separately from complete totals. [Analytics](../../agent-system/observatory/src/engineering-analytics.mjs) · [Attempt accounting](../../agent-system/observatory/src/engineering-token-accounting.mjs)
- New turn profiles compare differences between adjacent cumulative notices against the protocol's `last` input, cached input, output and total. They retain the first, latest and peak reconciled response input, the declared context window when available, and count the observed versus reconciled intervals. The earliest four and latest four reconciled intervals retain their ordinal, token breakdown, and observed command completions between usage notices. A resumed thread's first notice supplies a baseline only. Command and MCP counts come from matching completed item notifications. Repeated commands use an in-memory fingerprint of the working directory and command. Reported command output bytes are UTF-8 bytes sampled from available command events. They are neither tokenizer readings nor a measure of what the model received. Prompt content, commands, outputs and fingerprints stay outside the journal. Abrupt worker exit can still leave only cumulative progress, and incomplete or unreconciled intervals remain visible. [Protocol](../../prototypes/codex-bridge/protocol-generated/v2/ThreadTokenUsage.ts) · [Upstream Codex semantics](https://github.com/openai/codex/blob/db72403243ee3ba63ab7d258e6b3c80545fc423d/codex-rs/tui/src/token_usage.rs) · [Profile](../../scripts/agent/provider-events.mjs)

## Local qualification and rollout

### Follow-up readback of the Phase 2 execution

The restricted Codex session receipt for Phase 2 candidate `b6221268806e00ec45902de1c66b414c7db5c847` has SHA-256 `bafaf9f10a005aa5a387ba461b1e5fb05cc79289830b9cb41f982596025ee844`. It contains 72 usage notices. Each of the 71 adjacent cumulative differences agrees with the recorded last input, cached input, output and total. The final cumulative receipt is **9,583,945 tokens**, comprising **9,545,533 input** and **38,412 output**. Of the input, **9,361,152 was cached** and **184,381 was uncached**. The preflight-failed Phase 2 attempt has no provider session or usage receipt. Its billing and the total program charge remain unknown.

| Recorded response | Input | Cached input | Output |
|---|---:|---:|---:|
| First | 38,659 | 15,232 | 221 |
| 36th | 138,186 | 137,088 | 355 |
| 72nd | 189,844 | 188,032 | 603 |

The receipt contains 71 tool calls and 71 tool outputs totaling 478,503 serialized UTF-8 bytes. A lexical classification of the calls attributes 311,814 output bytes to source retrieval across 22 calls and 112,098 bytes to governance across 18 calls. There is no recorded compaction event. The cumulative counter reflects increasingly large cached inputs across many responses, with source and governance outputs accumulating in the same thread. The timing and totals support repeated context consumption as an amplification mechanism. Exact tool-call text did not repeat. The receipt cannot assign provider tokens to individual prefix segments, prove which previously loaded material was replayed on a particular call, or determine whether a tool call could have been removed without changing the outcome. The [provider profiler](../../scripts/agent/provider-events.mjs) retains bounded response and tool observations for a matched follow-up. No real savings are established by this readback.

The three deterministic comparisons below exercise one source package per workload with identical router inputs. They compare the sizes of the JSON-serialized structured payload and the opt-in compact Markdown string. Both arms retain the exact selected excerpts, the remaining normative requirements, referenced dependencies, and warnings.

| Fixture | Structured bytes | Compact bytes | Exact retained text and warnings |
|---|---:|---:|---|
| Tiny artifact | 442,174 | 261,820 | Yes |
| Bounded code edit | 166,798 | 113,428 | Yes |
| Multi-file integration | 707,457 | 399,274 | Yes |

These are local serialization fixtures. Qualified provider replay, artifact verification, cost and reliability for the compact strategy remain open. The standard structured context is still configured. The opt-in `--compact-governance` uses the existing source-linked formatter. Router evaluation suggests a candidate only with two distinct independently reviewed held-out workloads, matched scope, equivalent verification, passing guardrails, and lower observed full cost for each. Scope binds Task digest, revision, policy, affected paths and checks. Stale or missing evidence retains the standard format. An applicable adverse review vetoes the suggestion. Existing Task permissions and the owner's separate approval still govern activation. [Task router](../../scripts/agent/task-router.mjs)

The first provider pilot should examine a single fresh tiny-artifact turn with the new profiler, followed by independently verified readback. Compare observed intervals, cached and uncached input and command results before choosing an intervention. If usable, pair standard and compact trials at the exact same integration revision, model, effort, authorization, workload digest, environment and verification scope. Counterbalance ordering and record all attempts, including failed probes. Use the existing paired experiment query for bounded-edit and multi-file holdouts. Consider larger work only if the pilot supports an actionable hypothesis. Stop when outcomes regress or repeated measurements cannot resolve uncertainty. Supported API reference rates may describe a proxy. Signed-in cost requires actual supported billing evidence.

Phase 2 provider execution, rollout, publication and deployment require separate authorization. The original Phase 1 worker exit trigger and scheduling investigation remain with the separate AADS Update Task.

## Candidate review

The focused local suite passed 178 tests with one platform skip. The test selection excluded cases whose child processes were denied by the sandbox. The governance router validated all 17 registry entries, and both changed JSX modules parsed. The full Sites build requires dependencies absent from the available offline cache. These checks provide fixture and source evidence for review while signed-in provider qualification and CI remain pending.

| Area | Changed files |
|---|---|
| Task routing and worker | `scripts/agent/task-router.mjs`, `scripts/agent/observatory-task-worker.mjs`, `scripts/agent/observatory-connector.mjs`, `scripts/agent/provider-events.mjs`, `scripts/agent/claim-telemetry.mjs` |
| Analytics and attempt binding | `agent-system/observatory/sites/worker.mjs`, `agent-system/observatory/src/engineering-analytics.mjs`, `agent-system/observatory/src/engineering-analytics-page.jsx`, `agent-system/observatory/src/engineering-token-accounting.mjs`, `agent-system/observatory/src/engineering-experiments.mjs`, `agent-system/observatory/src/engineering-experiments.types.d.ts`, `agent-system/observatory/src/task-engine-client.mjs` |
| Workspace and PDF | `agent-system/observatory/src/task-execution-diagnostics.mjs`, `agent-system/observatory/src/task-telemetry.jsx`, `agent-system/observatory/src/task-report.mjs` |
| Regression tests | `tests/agent-provider-telemetry.test.mjs`, `tests/agent-task-router.test.mjs`, `agent-system/observatory/engineering-analytics.test.mjs`, `agent-system/observatory/task-workspace.test.mjs` |
| Evidence | `docs/engineering/AADS-TOKEN-EFFICIENCY-PHASE-2.md` |
