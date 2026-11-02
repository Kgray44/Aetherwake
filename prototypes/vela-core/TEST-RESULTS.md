# Vela Core verification status

Initial core checkpoint `0ca7227` explicitly recorded tests/typecheck as not run under the shared host's native/CPU reservation. After the integration owner released a short CPU slot, the following checks completed successfully with Node 24.18 and the existing shared TypeScript installation; no dependencies were installed.

`node --test prototypes/vela-core/tests/*.test.mts` — **16/16 passed**, 353.5925 ms reported test duration in the final short validation slot. This includes 12 core scenarios and four Adaptive Experience scenarios. Core tests cover canonical same-connection persistence, native workspace references/placements, scoped discovery versus content inclusion, attributed proposals, stale/fingerprint/authorization denial, structural and semantic invalid provider plans, full-manifest metadata egress, cancellation, uncertain host outcomes, attention review/silence, delegated intent/scope and restart/concurrent-writer protection. Adaptation tests cover default/manual no-learning behavior, source-event evidence, suggestive/assisted/adaptive levels, explicit/global override precedence, reject/reset/suppression, host authorization and actual capability failure.

Typecheck — **passed with zero diagnostics** using the shared `cinematic-v3/node_modules/.bin/tsc.cmd --noEmit -p prototypes/vela-core/tsconfig.json --typeRoots <existing integrated-backend Node types>`. The final run included all service/adaptation contracts, tests, final panel rendering and manifest-authorization patch. Actual integrated renderer/runtime acceptance remains with the integration owner.

All SQLite tests use synthetic records, a real in-memory SQLite database and a canonical test host on the exact injected connection. Planner ports are explicitly synthetic test doubles; they are not real model intelligence evidence. No inference, provider turn, native application window, network call, install, build or cache fill was launched by this worker. The CPU slot was released immediately after the short batch.

Source review added full-manifest provider-egress authorization and preservation of semantically rejected proposals, plus one focused regression. Both the resulting 16-test suite and final panel typecheck passed in the final owner-released short CPU slot. The worker immediately returned the CPU reservation for integrated organization/native/ETW acceptance.

Actual integrated desktop, genuine provider planning, cinematic experience, accessibility, performance and owner acceptance remain unverified by this module checkpoint.
