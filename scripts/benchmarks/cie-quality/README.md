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
