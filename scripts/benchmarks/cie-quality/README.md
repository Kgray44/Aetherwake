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

The benchmark measures from native broker entry through canonical answer readback. It includes preview, source preparation, immediate synthetic review approval, qualification when cold, assessment and response publication. It excludes profile and fixture setup, human review time and renderer delivery. Each isolated profile runs one cold request followed by one warm request, so profile warmup and qualification reuse are confounded. The fixture asserts five synthetic Responses calls when cold and three when warm, with zero paid calls. The exact-answer assertion checks fixture integrity and does not grade provider reasoning.

On Windows with Node 24.18.0, 12 paired profiles measured 1,437 ms p50 and 2,233 ms p95 cold, and 1,163 ms p50 and 1,736 ms p95 warm. These are synthetic full-request observations. They do not estimate provider latency, cost, or the causal effect of qualification reuse.

## Independent blind corpus

`cases.public.json` is the independently authored, frozen input-only 48-case corpus (six examples in each of eight categories). Its exact SHA-256 is pinned in `blind-runner.mts`. Labels and adjudication rationales are deliberately not checked in and have not been consulted by the implementer. The fixture file expands semantic evaluation inputs sixfold over the original eight-case set; **that is corpus expansion, not a claimed measured accuracy gain**.

`runBlindCie` accepts an injected, authorized canonical host executor. It submits no requests itself, cannot read credentials, never retries a case and returns a digest of predictions with the candidate commit/tree. A host failure retains completed predictions and an explicit incomplete stop marker. The native host must preserve its own canonical AEP evidence, exact source/permission checks, call limits, and credential protection. Full-request measurement begins before the host callback, so qualification and preparation belong inside it. Synthetic runner tests test mechanics only; their output is not model accuracy evidence.

For a controlled multi-day run, pass a host-approved `maxCases` and persist each successful batch's returned checkpoint in the evaluation evidence location. Resume only the exact input and candidate with `resume` set to that checkpoint. A stopped batch with a cancelled or unknown host outcome is ineligible for automatic resume. The checkpoint detects accidental drift or tampering against its retained digest. The host must retain the external digest and use its canonical call budget to choose batch size. These controls do not authorize a call, increase a quota, or recover an unpersisted in-flight batch.

The AEP report groups reported model executions by exact reported model. Dispatch totals and unknown states are distinct. Token sums cover only dispatched executions with consistent usage receipts, with sample coverage shown. These totals describe observed dispatch and usage and do not establish what was billed.

### Independent lexical holdout baseline

An independent author sealed a second 48-case synthetic suite before inspecting the candidate. Labels remained in separate custody and were applied only after predictions were frozen. Against PR #61 and candidate `a1ab9bb0`, request-only lexical top-three ranking tied on all 48 cases. Both arms found 44 of 52 required sources (84.6% micro recall) and 44 relevant sources among 105 returned (41.9% micro precision). Both retrieved all required evidence in 32 of 39 material cases and returned no candidates in one of six benign cases. The fixture removed disallowed candidates before ranking and neither arm returned a disallowed or unknown ID. This checks candidate parity under fixture filtering. Contradiction adjudication, answer correctness and native disclosure are separate measurements.

Input seal SHA-256 `9b79a3aa96aa1493fd2655f823654b42454419dfb4f92aeb1c4506eceef67832`. Frozen prediction SHA-256 `08aa4d95317f614e9b414cf76efef0a55963aaa1bfbb36398210856b83566544`. The first follow-up quality targets are at least 92% critical-source recall and 55% precision at the same cutoff with zero unauthorized disclosures on an independently graded untouched set. The current test does not meet those targets.
