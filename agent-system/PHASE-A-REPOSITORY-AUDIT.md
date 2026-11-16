# Phase A — repository audit and consolidation handoff

**Scope:** Agent Development Harness (engineering control plane), **not** the product-side Vela MissionService.  
**Inspected baseline:** `0b43cf0ecd6f0a0f50662a473a2ca414474731b6` (`main`, 2026-11-15).  
**Foundation:** [PR #280](https://github.com/Kgray44/Aetherwake/pull/280), merged at `5564875600a826b760492d33af73bf969e8e3839`.  
**Method:** GitHub tracked-tree inventory, selected source and instructions inspection, foundation contract review. This was a **static repository audit**; no local desktop, native GPU, live-provider, or private environment tests were executed. Revalidate against the active revision before acting on any path or conclusion.

## Decision and authority

1. **Reuse instead of duplicating.** `AGENTS.md` is the existing global agent entrypoint. `governance/README.md` is the authoritative charter registry; Constitution 00 and Charters 01–16 are owner-ratified. `scripts/governance-router.mjs` routes charter domains and `scripts/governance-context.mjs` retrieves versioned normative sections and requirement IDs. Do not implement another governance selector, duplicate charter contents, or infer task acceptance from CI.
2. **Engineering task != Vela runtime mission/task.** `agent-system/contracts/v1.schema.json` defines the six engineering record types (Task, Attempt, Evidence, Telemetry, ContextSnapshot, VerificationProfile), with explicit revision provenance and uncertainty. `agent-system/README.md` defines the contract's ownership and status boundaries. Product execution and approval remain in the existing application, under Charter 05 and the established runtime owners.
3. **Real implementation lives in the historically named prototype tree.** The connected Windows Electron desktop is rooted at `prototypes/visual-experience/cinematic-v3/` (native main/preload and renderer). Its canonical backend includes `prototypes/integrated-backend/src/{desktop-host,service,worker,core}.mts`. See `docs/engineering/A0-A1-RUNTIME-OWNERSHIP.md`, `docs/engineering/CURRENT-STATE-OF-AERYNTH.md`, and the actual present source before modifying product code. There are additional `src/` paths; no inference about product completeness follows from directory names.
4. **Approved architecture governs; audit snapshots are dated evidence.** See `docs/decisions/ADR-002-ARCHITECTURE-RECOVERY-AND-COHESIVE-RUNTIME.md`, ADR-003, `docs/README.md`, and the current-state inventory. Do not make the agent registry a competing source of architectural decisions.
5. **Approval is independent of merge.** Owner visual acceptance, native desktop test admission, security and user-effect authorization are not delegated to an agent-generated task classification or an observatory UI.

## Source inventory / reuse map

| Concern | Reuse existing authoritative source | Phase owner / permissible delta | Verification / caution |
| --- | --- | --- | --- |
| Global agent entry / reading sequence | `AGENTS.md` | B: concise task-class bootstrap and pointers; preserve charter priority | Re-run governance router when scope changes |
| Charter authority / binding status | `governance/README.md`, Constitution and 01–16 | A: audit pointers only; no charter re-ratification | `node scripts/governance-router.mjs --validate`; registry is authoritative |
| Deterministic domain routing | `scripts/governance-router.mjs`, `config/governance-routes.json` | B: call existing CLI; no parallel router | `tests/governance-router.test.mjs` |
| Scoped requirement retrieval | `scripts/governance-context.mjs`, `config/governance-context-policies.json` | C: invoke existing CLI with actual task and paths; source digests remain authoritative | `tests/governance-context.test.mjs`; `scripts/benchmark-governance-context.mjs` |
| Engineering records/contracts | `agent-system/contracts/v1.schema.json`, `agent-system/README.md` | Foundation owns schema. B/C/D/E consume; propose reviewed versioned changes only | `node --test tests/agent-contracts.test.mjs`; structural checks are not complete schema validation |
| Runtime ownership | `docs/engineering/A0-A1-RUNTIME-OWNERSHIP.md`, product sources and ADR-002 | C: derive pinned refs; B: scope affected paths | Inventory is dated; verify real file/entrypoint at task revision |
| Application integration | `prototypes/integrated-backend/`, `prototypes/visual-experience/cinematic-v3/` | No new engineering control-plane ownership of product effects | Respect `docs/engineering/CI-VERIFICATION.md` and native approval |
| Platform acceptance and fixtures | `scripts/run-aerynth-acceptance.mts`, `scripts/aerynth-ci-gate.mjs`, acceptance fixtures | D: add evidence adapter only; don't weaken aggregate | Existing Linux/Windows/security jobs and aggregate are distinct |
| CI | `.github/workflows/{governance-router,integrated-backend,aerynth-integration}.yml` | D: scoped evidence checking, initially report-only where appropriate | Do not rename/bypass current required `Aerynth governance` and `Aerynth required checks` |
| Existing engineering status | `docs/engineering/CURRENT-STATE-OF-AERYNTH.md`, `AERYNTH-CROSS-WORKSTREAM-INTEGRATION.md` | C/E: link or ingest with explicit provenance, not duplicate mutable prose | Each receipt has a producer revision and evidence class |
| Human-facing engineering UI | Existing product UI and existing integration/status documentation are distinct from control-plane dashboard | E: read-only task/attempt/evidence projections; no new coordinator, no auto approval/merge | Fixture adapter before live collector, clear stale/unavailable labels |
| Sensitive data | Existing Charter 14 trust/privacy and `agent-system/README.md` public repo boundary | C/E: private telemetry storage/redacted summaries, fail closed on secrets | Never commit private usage, tokens, conversations, local personal paths |

## Concrete stale-context / conflict findings

- **A-01 — stale governance guide (confirmed):** `docs/engineering/GOVERNANCE-ROUTER.md` still gives November 1-era examples calling the charters *advisory* and Charter 05 *pending*, although `governance/README.md` and `AGENTS.md` now establish owner ratification. It also says no production application exists under `src/`, which is misleading against the current connected implementation. **Disposition:** do not use those historical examples as live policy; B/C should use the registry and current `GOVERNANCE-CONTEXT-ROUTER-V2.md`. Correct the historical document's stale advisory prose in a separate targeted consistency change, or explicitly mark its dated examples as historical. Never change the registry to match the stale guide.
- **A-02 — dated status reports (confirmed):** `docs/README.md` declares a November 12 checkpoint while the current-state inventory has a November 14 audit baseline; these are snapshots, not continuously refreshed agent context. **Disposition:** C must derive current source SHA and document digests and mark outdated/unknown data explicitly.
- **A-03 — no operational harness yet (confirmed in foundation):** PR #280 ships contracts and structural tests, **not** a router, collector, evaluator, or observatory. **Disposition:** B–E must implement and demonstrate actual functionality, not count the schema as an end-to-end result.
- **A-04 — test provenance limits (confirmed):** the `governance-router.yml` job exercises governance and engineering checks; `aerynth-integration.yml` runs platform-specific acceptance in Linux/Windows with artifact upload. No single green unit test validates native display fidelity, provider behavior, or owner acceptance. **Disposition:** D preserves evidence environments and exact SHAs, plus manual-owner outcomes as distinct states.
- **A-05 — context estimate ambiguity (confirmed):** the V2 governance context CLI labels its token estimate as character-derived, not observed provider usage. **Disposition:** C must not report these estimates as token/weekly-quota measurements.
- **A-06 — partition collision risk (design constraint):** B/C/D/E may all want to own common records, task status, or code generation. **Disposition:** only the foundation contract owner changes schema; implementation ownership below is disjoint. Each worker reports proposed contract changes rather than editing the shared schema unilaterally.
- **A-07 — hidden status inference risk (design constraint):** GitHub PR merge, hosted CI pass, synthetic renderer screenshots, and native owner-reviewed success are different events. **Disposition:** E must project explicit evidence and acceptance fields without inferring acceptance.

## Parallel workstream handoff and ownership

The partition below is **control-plane engineering ownership**, not a claim that existing product owners have changed. All consumers pin the foundation v1 contract and use stable opaque task IDs, not historical mission counts.

| Workstream | Owned additions | Forbidden substitutions | Acceptance handoff |
| --- | --- | --- | --- |
| **B — classification and skills** | `.agents/skills/`, `scripts/agent/task*`, targeted `AGENTS.md` additions, class/profile mapping | Do not replace `scripts/governance-router.mjs`, charter registry, or product MissionService | A bug, visual, performance, security, and composite-risk task resolve to documented workflows without weakening obligations |
| **C — context and telemetry** | `scripts/agent/context*`, `scripts/agent/telemetry*`, secure adapters/storage | Do not copy charter text into another canonical registry; do not fabricate token spend or quotas | Generate revision-qualified ContextSnapshot and Attempt/Telemetry with observed/estimated/unavailable provenance and stale detection |
| **D — evidence and CI** | `scripts/agent/verify*`, `tests/agent/`, scoped workflow | Do not override existing required checks, merge rules, or mark owners as accepting | Validate schema and pinned acceptance criteria; reject stale evidence and label missing native/owner evidence; report-only rollout precedes enforcement |
| **E — engineering observatory** | Task-centric website and read-only projections/fixture adapter | Do not build a second agent scheduler or make privileged merge/approval decisions | Render any number of tasks, linked attempts/evidence/dependencies, and honest missing-data statuses; no eleven-mission assumptions |
| **A — audit / compatibility** | This report, source-of-truth cross-links and identified follow-up repairs | No new charter or alternate schema | Baseline audit and reusable handoff; downstream workers must recheck head on integration |

**Contract extension rules:** communicate via immutable versioned JSON-compatible records, full Git revision, UTC timestamps, opaque IDs and explicit record `record_type`. A single schema owner reviews backward-compatible optional fields. Breaking semantics require new schema version plus migration and cross-consumer fixture tests. Keep task snapshots/records separate from the product-side MissionService state.

## Integration sequence without serializing B–E

1. All workers branch from an agreed foundation baseline and retain contract-fixture tests. They may develop independently against fixture producers/consumers.
2. B and C can provide task classification/context independently. D can validate fixture evidence independently. E can build a read-only UI from canonical fixture records, not hand-crafted alternative shapes.
3. Each PR supplies file ownership statement, current base SHA, actual test command/output, limits, and schema compatibility evidence. Merge compatible increments continuously when required checks allow; never assert successful CI without the matching hosted result.
4. Integrate one real engineering Task through a pinned snapshot, an Attempt, observed timing plus explicitly unavailable provider usage when necessary, criterion-specific evidence, verification, and a visible task projection. Owner visual acceptance stays separate.
5. Compare representative bug, backend and visual tasks to establish a baseline of retries, elapsed time, verification overhead and accepted outcome. No efficiency claims before measured comparisons.

## Phase A exit criteria and evidence boundaries

- [x] Identify the merged contract foundation and its six record types.
- [x] Audit the root agent instructions, governance registry/router/context and their documented precedence.
- [x] Identify canonical connected desktop/backend paths and existing engineering/native verification ownership.
- [x] Identify existing CI workflow boundaries, acceptance classifications and the public-repository privacy limit.
- [x] Define non-overlapping B–E work ownership and integration/contract handoff.
- [x] Record confirmed stale guidance and follow-up remediations rather than silently rewriting charter authority.
- [ ] Run local Node tests against checkout (not available in this static GitHub audit; rely on actual matching CI results before integration).
- [ ] Verify native Windows desktop or GPU experiences (not part of this Phase A static audit).

**Non-claims:** This report is not implementation of phases B–E, not a complete semantic audit of every charter, not proof of a passing CI run, and not permission to bypass branch protection or human owner acceptance.
