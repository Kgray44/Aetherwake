# FI-0 mission contract handoff

Program B contract slice based on `7747e8c723b5961d6edfd6fb75758a50e87e7ac6`. This change implements the versioned candidate boundary in the existing mission planner.

The [proposal module](../../prototypes/integrated-backend/src/mission-proposal.mts) exports `MISSION_PROPOSAL_CONTRACT`, `MissionProposal` and its provider schema. New planner requests ask for `aerynth.vela-mission-proposal@1`. The host rejects explicit unknown versions before compiling and still accepts the old unversioned shape through the closed field allowlist. The compiler resolves host catalog keys into the existing `MissionPlan`. MissionService validates the executable graph and binds accepted work to scope, request and plan revision in the existing `aerynth.vela-mission@1` record. A provider candidate cannot supply scope, an arbitrary executor, a native grant or a persisted mission record. The candidate marker stays outside the accepted plan and persisted schema.

The change affects the planner prompt and schema fingerprint. A previously issued planning offer must be refreshed at the current contract if its fingerprint changes. Existing mission IDs, source references, request digests, persisted data and native executor contracts require no migration. A rollback reads the same accepted mission records and resumes issuing the prior provider schema. Refresh an in-flight offer across the version change.

| Interface | Canonical source and handoff |
| --- | --- |
| AIR request, capability and route | [Vela contracts](../../prototypes/vela-core/src/contracts.ts), [routing](../../prototypes/vela-core/src/adaptive-routing.ts) and [capability catalog](../../prototypes/vela-core/src/capability-catalog.mts). Keep the existing request and catalog identities. Mission 04 owns the new semantic interpretation and execution strategy. |
| CIE evidence and correction | [Mission context](../../prototypes/vela-core/src/mission-context.mts) already defines `aerynth.vela-mission-context@1`, source proofs and pre-dispatch validation. Mission 04 extends source-bound evidence needs and current authorization. Personal Context, the graph and product adapters retain source and correction ownership. |
| Candidate, accepted plan and executive | Use the versioned proposal at the provider boundary, then `compileMissionProposal` and `validateMissionPlan`. [MissionService](../../prototypes/integrated-backend/src/mission-service.mts) owns durable dependencies, attempt identity, plan revision and verification. Executive proposals route through existing review and state validation. |
| AEP spans, publication and experiments | [Mission 02 review](https://github.com/Kgray44/Aetherwake/pull/41) extends the current attempt timing and lifecycle events via `projectMissionExecution` and `MissionExecutionProfile`. Correlate mission, task and attempt IDs with existing source-event coordinates. Core journals effects and publication. A future experiment lifecycle needs its own verified policy-review boundary. |
| ARIE telemetry, leases and overrides | Mission 03 extends [mission admission](../../prototypes/integrated-backend/src/mission-admission.mts) and [system utilization](../../prototypes/vela-core/src/system-utilization.mts) under the existing governor boundary. Its integration branch uses `MissionServiceHost.resources.canAcquire` and `.acquire`. MissionService supplies mission, task and attempt IDs. ARIE contributes the receipt on `MissionAttempt.resourceLease`. `MissionExecutionContext.resourceCheckpoint` carries the cooperative safe-point signal. MissionService retains dispatch and task state. |
| Source-backed projections | [Mission publication](../../prototypes/integrated-backend/src/mission-publication.mts) stages canonical events. Core's scoped renderer page and the [Stream view](../../prototypes/block-library/event-view.ts) expose authorized projections. Projection coordinates refer back to existing rows and receipts. |

## Provider capability inventory

| Transport | Source-backed capability | Qualification boundary |
| --- | --- | --- |
| [Codex App Server](../../prototypes/codex-bridge) | Signed-in conversation and task execution, native capability/catalog bindings and scoped project operations. | Actual provider and account expose supported models and native features. Local fixtures exercise protocol boundaries. |
| [ChatGPT plan Responses](../../prototypes/openai-provider/responses.mts) | Ordinary and mission specialist paths subject to the plan account catalog. Mission planning requests use the existing prompt and host parser. | Separate entitlement and billing boundary from API-key Responses. |
| [OpenAI API Responses](../../prototypes/integrated-backend/src/vela-api-runtime.mts) | Reviewed structured proposals, response streaming and bounded tools through explicit owner workflows. Model control selection comes from the runtime and [model controls](../../prototypes/openai-provider/model-controls.ts). | Synthetic tests exercise schema, usage attribution, scope fences and receipt recovery. The concurrent Mission 04 live probe returned an expired-credential error. Live entitlement, model/tool compatibility and provider latency remain unqualified here. |
| [Live voice](../../prototypes/openai-provider/live.mts) | Separate native media and authorization boundary for voice. | Requires qualified voice, account, input/output and disclosure checks. |

## Verification and readiness

Run `node --test prototypes/integrated-backend/tests/mission-proposal.test.mts prototypes/integrated-backend/tests/mission-api-planning.test.mts`. The candidate tests compare versioned and legacy inputs, reject unknown versions and host-field injection, and exercise cycles, unavailable capabilities and partial scope. The provider test drives reviewed planning and accepted mission creation through Core.

### Combined contract verification

A local Windows verification snapshot combined the following public heads in order. The FI-3 and FI-2 heads include their respective prerequisite branches.

| Input | Head |
| --- | --- |
| [A4 #38](https://github.com/Kgray44/Aetherwake/pull/38) | `9912be8c1533ad044f2f0566f970c5e1e1c09eee` |
| [ARIE #42](https://github.com/Kgray44/Aetherwake/pull/42) | `9103e4467984aaf1045391e29aacfaa14148406e` |
| [AEP #41](https://github.com/Kgray44/Aetherwake/pull/41) | `843b9ceb1c1893ee9262b9a84c161af61b8de144` |
| [CIE and Executive #45](https://github.com/Kgray44/Aetherwake/pull/45) | `7972c17467415c308b1b0bc1fdb04fd5ce98a360` |
| [FI-0 #40](https://github.com/Kgray44/Aetherwake/pull/40) | `0d7ac6c5d77cf8f9887c0e5e6305dda7b5a78f5d` |
| [A3 #36](https://github.com/Kgray44/Aetherwake/pull/36) | `a808d650aa5a19507b8ffc52603949f362e5028a` |

- The A4 and ARIE pair combined without conflicts. Windows passed all 30 tests in mission conversation, MissionService and the bounded CPU pool. The scope tests used synthetic samples after the real lease gate admitted the tasks.
- The combined snapshot retained both test insertions in `mission-service.test.mts`. In `core.mts` and `vela-api-runtime.mts`, it carried the reviewed configuration and context-digest binding and the profiler's `observeEventType` through the same `structuredProposal` call. CIE's one-use admission and strict terminal response validation remain in effect. The observer collects timing from the existing stream callbacks.
- At local snapshot `a1d94ad7397f7e4da8a650691af86c5fd130028b`, backend typecheck passed and 109 Windows tests passed across mission planning, proposals, Executive, MissionService, mission conversation, the CPU pool, Vela API runtime, semantic history, and Personal Context. The reviewed planner checked the versioned candidate and measured provider events through simulated transport. The runtime also verified native CPU and memory evidence before starting dependent work.
- A follow-up assertion in local verification revision `519f0798d3542306e454c132a00036d9e5bade05` checked distinct versioned lease receipts for every attempt and their exact readback alongside the profiler timing after SQLite restart. That focused test passed. At the same revision, another 52 Windows tests passed across transaction coordination, journal replay, backup, and Live voice runtime fixtures. The verification branch is local and the workstream PRs remain separate.

The [FI acceptance specification](../specifications/VELA-FLUID-INTELLIGENCE-ACCEPTANCE.md) remains authoritative for G0 and FI-ACC-01–46. Remaining G0 work includes reviewed cross-mission telemetry and lease versions, full executive and experiment conformance, an independent held-out fixture registry, retention and privacy review, and live provider qualification. This slice creates no new database or policy owner and stores no new provider content.
