# Mission 01 compatibility decisions (engineering experiment, v0.1)

Constitution 00 is binding; specialist charters are published advisory inputs pending owner acceptance. No governance or visual implementation is changed.

| Component | Exact source commit |
|---|---|
| main baseline | `3a9fa4883415f3a01cdb187a813b17a4142508a3` |
| #6 native bridge | `37004979657c8e74ffc7b2de0a461981c1870794` |
| #7 architecture/contracts | `a778ecaab2d3b4d3f39e77a5245b182b5037d500` |
| #8 resource kernel | `017b16073d34a8ca8d0cfaff8eb3ba0a8c56a48f` |
| #9 connected conversations | `937b2e071cc1cf725b22902d59d5326022b0fc53` |

All four histories are brought into this integration branch by a merge; original PRs remain open. Dependencies: worker service → resource kernel + connected graph; provider port → native bridge (or explicitly simulated fixture). UI → asynchronous service + journal replay. SQLite remains a candidate.

| Seam | Original implementation | Integration choice |
|---|---|---|
| Adapters | graph sync open/respond; bridge async RPC | async provider port; graph adapters stage local identity only, never perform native RPC |
| IDs | graph counter IDs, kernel UUIDs, native thread IDs | kernel UUID is public resource/conversation ID; explicit graph-ID mapping; separate account/instance/thread binding; session ID stays null when not supplied by provider |
| History | graph owns messages; kernel has conversation refs | graph owns local synthetic messages in transactional versioned state; native output copied only for synthetic smoke content |
| Resources | kernel projects/workspaces/blocks | use kernel unchanged except a composable transaction callback; graph IDs never become block IDs |
| Branching | graph may auto-select native fork | staging disables native fork; application continuation with precise fork message and canonical kernel relationship |
| Handoff | graph package has hashes, citations, exclusions | prepared local package plus scope/revision/budget/fingerprint approval; graph suppliedAt denotes local staging only, integration state is authoritative for provider delivery |
| Events | bridge UUID + connection-local sequence, 512 buffer | ingest each notification immediately into indexed SQLite journal; session-scoped dedupe; classifications observed/reported/inferred/simulated; metadata allowlist, no raw payload storage |
| Transactions | independent graph/SQLite mutations | single SQLite savepoint boundary covers kernel and integration state; restore graph snapshot on rollback; external sends use durable dispatch record before RPC |
| Capabilities | graph static mock; bridge catalogOnly | live auth/model discovery; entitlement remains unverified until inference; ordinary ChatGPT history unavailable; native fork not exposed |
| Errors/recovery | bridge failures; graph failed/interrupted | persist dispatch/running/unknown/interrupted/provider_completed; never retry unknown remote operation automatically; read-only reconciliation on reopen |
| Approval | native defaults decline | service fingerprint approval for context transfer; native tool approvals always decline; no persona/instruction replacement |
| Versions | graph v1/kernel v2/bridge event v1; proposed contracts v0.1 | integration contract 0.1, state schema 1, journal schema 1; reject unsupported versions and corruption; no automatic destructive downgrade |

The graph's clock is a deterministic fixture clock; integration records real receipt/approval times separately and does not present graph timestamps as provider measurements. Its inherited visible history is a local ancestry view, not proof that a provider received it. Only reviewed package items enter a provider turn.

Version drift observed: the installed native executable is `0.166.0-alpha.5.1`, while #6's generated wire types came from `0.153.3`. The live handshake/catalog/thread/start/turn/start/events/thread-read/items subset works in this environment. This does not establish compatibility of every generated type or method; keep the port replaceable for the independent fidelity audit.

The V2 CLI fails on the baseline (`Cannot read properties of undefined (reading 'some')`). The library API works: `parseRegistry` → `buildGovernanceIndex` → `buildContext`, passing the constructed index without CLI option spread. Used source fingerprint `4f0b5be27761ba4d4274fd09c9993111e786728206766f81ec83d7c59e9d0160`, domains 00/03/04/08/09/12/14/15/16; no warnings. Scoped sections and authoritative source were inspected, including identity, trust, provenance and delivery dependencies. The library returns 1,003 supplemental advisory requirement records; that envelope is not a claim that this slice implements every proposed product feature. No incidental router repair is included. Contracts here remain provisional and are not a permanent v1 freeze.
