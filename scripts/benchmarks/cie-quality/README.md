# CIE quality and cognitive pipeline evaluation

This directory contains offline reporting over the canonical AEP cognitive receipts, not a second telemetry store. `reportCognitiveRepetitions` accepts a `MissionExecutionProfile` projection per repetition, a separately observed full-request duration, and an optional independent quality artifact reference. Start the full-request clock **before qualification, source preparation, and model submission**; stop after the verified outcome. Never substitute the sum of model durations for elapsed time.

The output retains every call's model, reasoning effort, usage, dispatch status, source class, latency, and outcome. It detects conflicting receipts and refuses the same execution across repetitions. Missing measurements and synthetic providers remain explicit. p50/p95 are nearest-rank sample statistics, not confidence intervals. Small samples do not establish a general speedup. Compare matched task/model/configuration/source conditions and include failures.

Cost is unavailable by default. A caller can supply one exact-model, currency- and source-versioned rate. The estimate then requires reported provider usage, valid input/output/total arithmetic, and an explicitly reported cache count. Reasoning tokens are a subset of output, not a second bill. Estimates concern cognitive token charges only, never an invoice or ChatGPT-plan quota.

A call's causal contribution to quality is **unknown** without independently judged matched ablation evidence. The report deliberately cannot promote an optimization. Retrieval, reasoning, context, security, and verification must remain intact, and source/permission fencing must pass.

## Sealed semantic result discipline

The historical strict eight-case result remains 7/8 unless its exact sealed source artifact and scorer establish otherwise. `conflicting` is not an accepted status in the current CIE schema. The canonical `contradicted` status describes unresolved incompatible claims about the same entity, fact, time, and scope, supported by both sources. That can express a fixture's intended “conflicting” evidence, but the words are **not universally interchangeable**. A single refuted proposition, different dates, different entities, or an explicit superseding correction needs separate analysis.

Any justified adjudication must be a new append-only artifact identifying original bytes/hash, case, original expected and actual labels, source/quote evidence, rubric, adjudicator and rationale. Never replace the original strict score or add a blanket alias to the production parser. Publish strict and separately adjudicated results side by side.

Fresh evaluation inputs must be independently authored and frozen before implementation, with labels held away from the implementer and excluded from provider payloads. Freeze predictions and implementation hashes before independent grading. Once inspected for fixes, failed cases become development cases; another untouched set is needed to validate later accuracy gains.

## Checks

    node --test scripts/benchmarks/cie-quality/report.test.mts
    prototypes/integrated-backend/node_modules/.bin/tsc -p scripts/benchmarks/cie-quality/tsconfig.json

No provider request, secret reader, native qualification, or performance/accuracy improvement is implied by these offline checks.

## Reviewed project retrieval baseline

Run `node scripts/benchmarks/cie-quality/lexical-latency.mts` with the PR #61 baseline commit available locally. The Windows Node 24.18 comparison used 300 alternating timed repetitions per arm after 30 warmups. Each repetition built the index and ranked 12 synthetic reviewed sources against six queries. Ordered IDs and ambiguity matched in the fixture. The baseline rebuilt the index for each query and took 2.03 ms p50 and 3.61 ms p95. The request-local index took 0.40 ms p50 and 0.80 ms p95. These measurements cover lexical retrieval only. This fixture made zero provider calls.

The index is built lazily from the authorized project snapshot during one request. Canonical scope and source-proof checks still run through Vela's native review and transport fences. Corrections, deletions and permission changes invalidate that review. The next request builds a fresh index. The project snapshot still has its original owner-level limits, so additional sources can remain undiscoverable until reviewed. One to three evidence needs retain the eight-candidate ceiling. Reviewed project discovery widens to ten to fourteen candidates for four to six needs. Initial project discovery reserves two slots and 5 KiB for gap recovery within the provider's 32 KiB payload limit, accounting for serialized host review metadata. Ordinary history retains its previous candidate limits. Explicitly selected sources have priority and can use the reserved capacity. Large serialized excerpts can exceed the reserved capacity. The maximum remains two assessment rounds. The interpreter instruction changed, so exact-instruction qualification must be obtained again through the existing provider runtime.

The request timer in `blind-runner.mts` includes qualification and evidence preparation when the host callback owns those operations. The native synthetic tests exercise review, source expansion, final composition and revocation fences. Provider variability, actual usage, final answer quality and full-request latency require matched authorized live repetitions. The lexical timings do not establish any of those outcomes.

For a native-path synthetic latency baseline, run the following from the repository root:

```powershell
$env:AERYNTH_BENCHMARK_SYNTHETIC_CIE = '1'
node --test --test-name-pattern 'benchmark native reviewed CIE' prototypes/integrated-backend/tests/mission-api-planning.test.mts
```

The benchmark measures from native broker entry through canonical answer readback. It includes preview, source preparation, immediate synthetic review approval, qualification when cold, assessment and response publication. It excludes profile and fixture setup, human review time and renderer delivery. The current harness warms each isolated profile with an untimed request, then alternates whether cold or warm qualification is measured first. Before the cold sample it clears receipts through native usage consent revocation and reauthorization outside the timed interval. It asserts five synthetic Responses calls when cold and three when warm, with zero paid calls. The exact-answer assertion checks fixture integrity and does not grade provider reasoning.

On Windows with Node 24.18.0, 12 paired profiles measured 1,437 ms p50 and 2,233 ms p95 cold, and 1,163 ms p50 and 1,736 ms p95 warm. These are synthetic full-request observations. They do not estimate provider latency, cost, or the causal effect of qualification reuse.

Set `AERYNTH_BENCHMARK_SYNTHETIC_CIE_PROJECT=1` as well to exercise four excerpts, including three discovered project notes. With that fixture, the comparison below isolates the two runtime files changed by batched snapshot validation. Each revision passed all 24 canonical answer checks and used the same five cold and three warm simulated calls per request.

| Runtime revision | Cold p50 | Cold p95 | Warm p50 | Warm p95 |
| --- | ---: | ---: | ---: | ---: |
| Before batching, `c35cca5e` | 2,220 ms | 2,900 ms | 2,001 ms | 2,401 ms |
| With batching, `16bc7660` | 1,822 ms | 2,708 ms | 1,542 ms | 1,960 ms |

These observations come from 12 profiles per revision on Windows. The candidate ran first and the baseline second in separate runs, so background load and run order may affect the difference. Both used synthetic transport.

A later full-request run at runtime revision `77ffef48` passed all 24 canonical answer checks. The 12 cold samples measured 8,574 ms p50 and 16,151 ms p95 with five simulated calls each. The 12 warm samples measured 6,591 ms p50 and 8,823 ms p95 with three simulated calls each. Absolute timings were materially higher than the earlier run. These separate runs leave the cause of the difference unmeasured. In all runs reported above, the fixture ran cold before warm, so the difference within each pair includes profile warmup. Catalog integration tests separately verify that an unchanged refresh reuses both current stage qualifications and that consent revocation and expiry require fresh probes.

With alternating order and an untimed warmup on each profile, the same project fixture at runtime revision `47655d35` passed 36 canonical answer checks, including 12 warmups. Over 12 pairs, cold qualification measured 9,348 ms p50 and 14,276 ms p95. Reused qualification measured 6,855 ms p50 and 10,559 ms p95. The paired cold-minus-warm median was 1,270 ms. The two arms made five and three simulated calls respectively. The consent reset can affect state beyond the qualification receipts, and these local timings do not measure live provider variability.

A separate synthetic native test holds both independent qualification calls in flight through the existing runtime. Each passes its own stage review and produces a different contract receipt. Canonical usage counts both calls and the runtime rejects a third dispatch while both slots are occupied. The production path still runs the probes sequentially. Parallel scheduling would need to account for available slots, the remaining call budget, and the effect of a failure in either probe.

## Independent blind corpus

`cases.public.json` is the independently authored, frozen input-only 48-case corpus (six examples in each of eight categories). Its exact SHA-256 is pinned in `blind-runner.mts`. Labels and adjudication rationales are deliberately not checked in and have not been consulted by the implementer. The fixture file expands semantic evaluation inputs sixfold over the original eight-case set; **that is corpus expansion, not a claimed measured accuracy gain**.

`runBlindCie` accepts an injected, authorized canonical host executor. It submits no requests itself, cannot read credentials, never retries a case and returns a digest of predictions with the candidate commit/tree. A host failure retains completed predictions and an explicit incomplete stop marker. The native host must preserve its own canonical AEP evidence, exact source/permission checks, call limits, and credential protection. Full-request measurement begins before the host callback, so qualification and preparation belong inside it. Synthetic runner tests test mechanics only; their output is not model accuracy evidence.

For a controlled multi-day run, pass a host-approved `maxCases` and persist each successful batch's returned checkpoint in the evaluation evidence location. Resume only the exact input and candidate with `resume` set to that checkpoint. A stopped batch with a cancelled or unknown host outcome is ineligible for automatic resume. The checkpoint detects accidental drift or tampering against its retained digest. The host must retain the external digest and use its canonical call budget to choose batch size. These controls do not authorize a call, increase a quota, or recover an unpersisted in-flight batch.

For host-managed restart protection, supply `journal` in place of `resume`. Its compare-and-set must atomically compare the stored state and durably persist the replacement. The runner claims each case before calling the host and clears the claim after storing a completed prediction. A lost receipt leaves a claim that blocks replay until the host reconciles it with canonical execution evidence. A completed journal returns its existing predictions without dispatching. The journal interface tracks evaluation progress. Provider timing and usage stay in canonical AEP receipts.

`openBlindJournal(path)` provides a SQLite implementation for a dedicated file in the host's evaluation evidence directory. It uses synchronous commits and conditional updates, and limits each JSON checkpoint to 2 MiB. The host retains the file across batches and closes the connection when finished. Use a separate file per evaluation arm. Live dispatch still depends on a host that can reconcile in-flight cases against canonical execution receipts and enforce the daily call budget.

`runNativeCieBatch` binds a new batch journal to the native ledger identity and claims each case before preflight. The claim binds the frozen input, candidate, route, profile and configuration version. A completed callback stages its full prediction and original end-to-end timing before promoting it into the checkpoint. On restart the runner checks the staged digest and asks the native host to verify the original answer and exact execution set. Missing staged evidence or timing, mismatched bindings, and unresolved native outcomes leave the claim in place. Recovery performs no dispatch and cannot reconstruct a prediction from provider timings. The synthetic fixture calls `BackendCore.previewVelaEvaluation` and `BackendCore.readVelaEvaluationResult`, interrupts promotion, reopens the backend, and seals the identical staged prediction. The live smoke remains separate. Live batch activation requires an owner-approved native adapter for the authorized profile and fresh scoped native consent.

Before dispatching each case, the runner can call the host's `canStartCase` gate. The provided `canStartReviewedCieCase` helper reads the native `velaApiUsageStatus` projection and requires room for all six calls disclosed by native review. A budget stop or preflight failure releases any claim before dispatch so a later batch can resume. This is a preflight check. The canonical runtime still enforces its daily limit at dispatch.

The AEP report groups reported model executions by exact reported model. Dispatch totals and unknown states are distinct. Token sums cover only dispatched executions with consistent usage receipts, with sample coverage shown. These totals describe observed dispatch and usage and do not establish what was billed.

The independent blind quality report includes end-to-end p50, p95 and sample count from all completed predictions. Unscored predictions still contribute timing. Recall, precision, disclosure, contradiction and answer metrics each retain their independently graded denominator. When native settlements are present, the report groups settled calls, call latency and valid usage by requested model and transport. It reports timing and usage sample counts separately and rejects duplicate executions and receipt groups that disagree with the sealed route. These are observations for completed predictions and omit calls from cases that stopped before a prediction was sealed.

The blind report accepts explicit model rates with currency, source and effective date. It estimates token cost only for live settlements with an exact confirmed model and sufficient cache accounting. The estimate includes its rate and priced sample count. The native fixture seals the exact model after all reviewed stages pass their provider-model checks. Older checkpoints without per-call confirmation retain their timing and token observations, with no automated cost estimate.

The Windows native harness has an opt-in, single-case live smoke for the frozen public synthetic inputs. Set `AERYNTH_VERIFY_LIVE_CIE=1`, supply an authorized `OPENAI_API_KEY` and `AERYNTH_CIE_LIVE_MODEL`, and point `AERYNTH_CIE_LIVE_JOURNAL` to a new absolute path in the evaluation evidence directory. Run `node --test --test-name-pattern 'authorized live CIE smoke' prototypes/integrated-backend/tests/mission-api-planning.test.mts` from a clean checkout. It submits one reviewed request with at most six Responses calls. The temporary profile uses the existing credential and dispatch paths. The external journal retains the claim and sealed prediction. This smoke uses an isolated profile and is unsuitable for coordinating daily limits across evaluation batches. The returned prediction requires independent scoring.

### Independent lexical holdout baseline

An independent author sealed a second 48-case synthetic suite before inspecting the candidate. Labels remained in separate custody and were applied only after predictions were frozen. Against PR #61 and candidate `a1ab9bb0`, request-only lexical top-three ranking tied on all 48 cases. Both arms found 44 of 52 required sources (84.6% micro recall) and 44 relevant sources among 105 returned (41.9% micro precision). Both retrieved all required evidence in 32 of 39 material cases and returned no candidates in one of six benign cases. The fixture removed disallowed candidates before ranking and neither arm returned a disallowed or unknown ID. This checks candidate parity under fixture filtering. Contradiction adjudication, answer correctness and native disclosure are separate measurements.

Input seal SHA-256 `9b79a3aa96aa1493fd2655f823654b42454419dfb4f92aeb1c4506eceef67832`. Frozen prediction SHA-256 `08aa4d95317f614e9b414cf76efef0a55963aaa1bfbb36398210856b83566544`. The first follow-up quality targets are at least 92% critical-source recall and 55% precision at the same cutoff with zero unauthorized disclosures on an independently graded untouched set. The current test does not meet those targets.

### SQLite FTS shadow comparison

Run `node scripts/benchmarks/cie-quality/fts-candidates.mts <sealed-input> <new-prediction-file> <candidate-commit>` from a clean checkout of the candidate. This uses the same frozen input set with private independent scoring. Each arm gets the same eligible fixture records and request query. The FTS arm builds an in-memory Porter-tokenized SQLite FTS5 index and ranks with title-weighted BM25. The cutoff is three. The run uses no provider or persistent index.

| Candidate metric | Lexical | SQLite FTS |
| --- | ---: | ---: |
| Relevant-source recall | 44/52 (84.62%) | 46/52 (88.46%) |
| Precision | 44/105 (41.90%) | 46/110 (41.82%) |
| Material cases with complete recall | 32/39 | 33/39 |
| Benign cases with zero candidates | 1/6 | 0/6 |
| Candidate-stage p50 / p95, including index build | 0.026 / 0.342 ms | 0.401 / 0.832 ms |

Both arms returned zero denied and unknown fixture IDs after eligibility filtering. FTS improved one material case by relevant-source count and tied the other 38. The candidate commit was `e888f963fdfafcd5776e32f54b541d402cc162ee` and frozen prediction SHA-256 was `4c3c2f316b5e2ab188569eaef4150857e7978bceb9cb11f1c976d9f1676f4f6d`. The one pass over the corpus includes setup and timing noise. FTS remains in shadow pending useful gains on untouched cases and native permission, evidence, and answer verification.

### Lexical and FTS rank fusion

The same command now emits a third arm. It combines the two top-three lists with reciprocal rank fusion, puts exact eligible source IDs first, and returns at most three sources. Direct exact-ID admission applies only to fusion, so this comparison measures both changes together. The fused timing includes both candidate channels run serially and the merge. Eligibility and query normalization are shared setup outside the candidate-stage timers.

| Candidate metric | Lexical | SQLite FTS | Fusion |
| --- | ---: | ---: | ---: |
| Relevant-source recall | 44/52 (84.62%) | 46/52 (88.46%) | 46/52 (88.46%) |
| Precision | 44/105 (41.90%) | 46/110 (41.82%) | 46/110 (41.82%) |
| Material cases with complete recall | 32/39 | 33/39 | 33/39 |
| Benign cases with zero candidates | 1/6 | 0/6 | 0/6 |
| Denied / unknown fixture IDs | 0 / 0 | 0 / 0 | 0 / 0 |
| Candidate-stage p50 / p95 (48 cases) | 0.021 / 0.444 ms | 0.347 / 0.761 ms | 0.385 / 1.309 ms |

Independent scoring used the original labels after predictions were frozen at `f2c1d9b7a28b4ac92cc590af36692008188d9f0e`. Prediction SHA-256 was `25d09bcaed9a46069d45c46e7b4b4363995a54ed60a74545c8fc266dcccecf84`. Fusion tied FTS on the graded candidate measures and took longer in this run. It remains offline. This experiment used zero provider calls and leaves end-to-end latency, authorization under native dispatch, and answer quality unmeasured.

### Authorized native Luna smoke

One public synthetic case ran through the native review broker and canonical answer readback at `95e529f86f60a53d5f49cee44f449a42899db82c`. The frozen prediction SHA-256 was `50db173924456d88f7565733c43d1530f8165a1f44a82c04612a85627895f7d9`. An independent reviewer verified the sealed digest and graded the answer correct. The journal did not capture evidence passages or a disclosure audit sufficient to grade citation accuracy, candidate recall, or live disclosure.

The request took 18,393.5 ms, from before host fixture setup and native review through canonical answer readback and receipt collection. Five Responses calls settled, with individual reported durations of 2,141–5,277 ms. All five supplied usage. They reported 4,500 input tokens (2,178 cache writes, zero cache reads) and 685 output tokens. At published standard rates the token estimate is USD 0.00084695, assuming standard tier and no regional premium. The run contains one case, so it cannot estimate live request p50, p95, or between-request/provider variability. [GPT-6 Luna pricing](https://developers.openai.com/api/docs/models/gpt-6-luna)

New smoke predictions include a test-only observation of the outbound Responses input. The journal binds fixture IDs to canonical resource IDs and preserves assessment excerpts, composition citations, and per-call input digests. The audit records matches for fixture bodies, canonical IDs, titles, and designated markers within fixture text. The synthetic cross-project test checks that the foreign note's ID, title, and marker are absent across the request. The test also verifies that observed call count matches canonical settlements for the blind fixtures. These signals can miss transformed text or fragments outside the designated marker. The public live smoke used eligible sources only. The audit runs in the synthetic fixture harness and opt-in smoke without retaining credential headers or changing production transport or AEP ownership.
