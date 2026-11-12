# FI-0 technical review disposition

Reviewed source: merged `52b75ef0e1e6c1f1b2ea65c5dc7d85c22b933ec6` plus local evaluation-binding commit `533d3a2a3fc46d6a434e26b1d8ac21c650a89209`. This records an engineering review, not human approval, publication consent, release acceptance or completion of future FI phases.

## Required registry and relationship to existing records

Roadmap FI-0 deliverable at [line 70](../../plans/milestones/FLUID-INTELLIGENCE-REALIZATION.md#L70) requires FI-ACC registration; [acceptance §11](../specifications/VELA-FLUID-INTELLIGENCE-ACCEPTANCE.md#L180-L196) explicitly requires machine-readable mappings of FI-ACC and FI-QA/OBS-FI/PLT-ARIE/AEP-T scenarios, fixtures, layers, native devices, evidence, latest results and deferred scope.

The existing [mission traceability document](VELA-MISSION-TRACEABILITY.md) is a historical Markdown implementation map. The [capability-first matrix](../specifications/VELA-CAPABILITY-FIRST-ACCEPTANCE-MATRIX.md) is a distinct companion requirement matrix. `scripts/run-aerynth-acceptance.mts` runs 17 package groups, but has no scenario-ID/layer/evidence mapping. No equivalent machine-readable FI scenario registry was found in this source tree.

[FI-ACCEPTANCE-REGISTRY.json](FI-ACCEPTANCE-REGISTRY.json) is therefore a companion to the existing FI-0 handoff/matrices, not a new requirement authority. It registers the exact 108 table-defined rows: 46 FI-ACC, 18 FI-QA, 10 OBS-FI, 8 PLT-ARIE and 26 AEP-T. Definitions remain in their original specification/charters, linked by file and line. It reuses the handoff's grouped evidence families rather than pretending each passing suite proves every mapped scenario.

Each entry resolves through an evidence set to real fixture paths, evidence artifacts, evidence classes, applicable layer family, native qualification boundary, scoped latest-result status and deferred work. `related-witnesses-only` means exactly that. Unestablished AEP cases retain null layer/unknown fixture mappings rather than fabricated coverage. Broad D0–D3 family applicability is a navigation/checklist aid from the acceptance methodology, not a new requirement or adjudication of every feature. Native receipts remain in their source handoffs; the registry does not invent device identifiers, retained artifacts or current-head native runs. All acceptance states are `not-adjudicated`; that inventory status does not reopen a previously completed workstream, including FI-1.

Validate without running any application/provider/native suite:

```sh
node scripts/validate-fi-acceptance-registry.mjs
node --test tests/fi-acceptance-registry.test.mjs
```

The validator checks complete source-defined ID coverage, duplicates, exact definition coordinates, fixture/evidence paths, allowed layers/classes and prevention of unsupported acceptance claims. Focused validator tests exercise malformed/missing records and false pass claims. It does not verify the semantic adequacy of a fixture, native performance or human approval.

## Scoped threat model

Assets: mission/attempt/evidence identity, source scope, host verification provenance, private bodies, uncertain-effect claims and policy authority. Trust boundaries: untrusted reference input → Core's current scope → canonical MissionService read/projection → bodyless AEP evidence output.

| Threat | Existing/new mitigation | Remaining boundary |
|---|---|---|
| Forged namespace, evaluator authority or grant | Closed evaluation input and supported CPU/RAM verifier/source pairs; scope is supplied by Core | A host/database compromise is outside this reference decoder's security claim |
| Stale revision, wrong attempt or source withdrawal | Exact mission/plan/latest-attempt/evidence join and fresh canonical source validation on every read | A previously returned projection is not a durable authorization grant; consumers must re-resolve |
| Provider self-certifies a strategy | Provider/specialist authority is unsupported; result says native-task evidence only and experiment quality not evaluated | Independent experiment-wide semantic/artistic quality is FI-5 work, not inferred from host counters |
| Cross-workspace leak/export assumption | Canonical scope checks; bodyless source digest and IDs; no export or provider disclosure is added | Identifiers are still scoped data, not public anonymization |
| Task receipt used to release unknown-effect claims | Reference consumer has no mutation, reconciliation, lease or scheduler operation | A verified sibling does not prove another task's external effect is quiescent |
| Missing telemetry interpreted as success or zero | Existing availability/coverage indicators; unsupported reference domains fail closed | No universal device/provider qualification is claimed |
| Backup or retained metrics erase privacy obligations | No new storage, retention default, backup or purge behavior | Existing source-owner deletion/restore obligations remain; old copies are not claimed erased |

## Engineering disposition and genuine open decisions

The current local-contained ownership/version/identity and read-consumer boundary is specified, implemented and covered by the recorded focused schema, canonical-source, restart and scope tests. The new registry completes the missing machine-readable inventory form without certifying all 108 scenarios. The broader existing evidence map, provider qualifications and physical/native limitations remain in the FI-0 and integration handoffs.

No new retention choice blocks this read-only patch: it adds no telemetry capture, experiment store, recipient or automatic cleanup. Current raw-sample freshness, journal-count limits and mission-retained proof remain unchanged. A future automatic purge of durable mission measurement detail, destruction/expiry of backup copies, durable experiment aggregate store or external export would require a specific data-family retention/disclosure policy. Generic completion authority cannot supply an arbitrary lifetime, audience or audit exemption. Those hypothetical operations are not introduced to finish G0.

G0 requires defined contracts/provenance, fixtures, threat analysis and reviewed disposition. FI-5/G3 separately requires operational controlled comparisons, independently graded outcomes, promotion and rollback. The supported native reference domain is not deferred; it is implemented. Unsupported experimental-quality domains are explicitly bounded rather than falsely declared functional.

This technical review found no new conflict with canonical owner or privacy authority in the scoped change. Integration review/sign-off under Charter 16 remains a separate recorded action; this document does not impersonate it. Publication permissions also remain independent of technical readiness. No broad suite, provider call, new capture, policy change or FI-1 reevaluation is required by the registry addition itself.
