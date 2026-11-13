# Next-cycle work packages: M0–M2

> **Historical record, navigation notice added 2026-11-12.** The proposed assignments, charter-acceptance language and V2 CLI observation below belong to the November 1 baseline. They are not current assignments or current tool results. See the [documentation index](../../docs/README.md) for later source checkpoints and the current governance registry. Original evidence below is unchanged.

Status: independently assignable **proposed tasks**, 2026-11-01. No task is started, verified or accepted by this document. The [roadmap](../milestones/M0-M8-IMPLEMENTATION-ROADMAP.md) supplies milestone outcomes; [contracts](../../docs/specifications/PROVISIONAL-INTERFACE-CONTRACTS-v0.1.md) are provisional; the [ADR queue](../../docs/decisions/ADR-QUEUE-FOUNDATIONS.md) keeps stack choices open. The Constitution is established; specialist charter IDs below refer to [published drafts pending owner acceptance](../../governance/README.md). Assign one accountable implementer and a separate integration reviewer for each task. Use separate branches/worktrees. Before implementation, inspect current repo state, confirm ownership/dependencies and run the host storage guard for each bounded writer. Public artifacts contain only synthetic data.

**Common done rule:** deliver a source revision, exact test commands/results, environment, failure/unsupported states, evidence IDs, and reviewer disposition. A test failing, a mock, a screenshot or an agent final message is not a verified product outcome. Every task must record changed files and integration instructions. If the stated file ranges collide with concurrent work, coordinate ownership before editing; do not overwrite another worker. Planned paths below are assignments, not a claim that those files currently exist. AW-CON-002–003, 069–073; proposed AW-ENG-027–039, 093–098.

## M0: foundation and repeatability

### T01 — Journey and requirement trace

- **Outcome / ownership:** A reviewer can follow four executable user journeys from intent to observable checks: ordinary chat without setup, visual block continuity, ordinary-to-Codex-to-ordinary branch, and truthful execution stream. Own `docs/architecture/journeys/` and `plans/tasks/traceability/` only; no `governance/` edits.
- **Dependencies / parallelism:** Read registry, Constitution, relevant sections of 01/02/03/04/08/09/12/14/15/16. Independent of T02/T03; integrate with their output before M0 gate. V2 CLI currently fails on this baseline; use its library API or canonical files and include failure receipt. **Requirements:** AW-CON-002, 004–006, 016–026, 031–035; proposed AW-ENG-021–026.
- **Acceptance / tests / evidence:** Four journey maps each include happy path, unsupported/failure path, permission point, persistence state, simulation label and verification artifact. Validate links and normative IDs with a script; reviewer samples every cited source/status. Evidence: map, command output, routing JSON/hash, unresolved contradiction log. A contradiction is cited to exact sources and sent to owner, not silently resolved.

### T02 — Contract fixture and compatibility harness

- **Outcome / ownership:** Implement test-only serializers/validators for the nine contract groups (including EventProvenance and ApprovalDecision) so future implementations can exchange synthetic objects. Own `tests/contracts/` and `docs/specifications/fixtures/`; do not alter governing charters or freeze v1 semantics.
- **Dependencies / parallelism:** [v0.1 contracts](../../docs/specifications/PROVISIONAL-INTERFACE-CONTRACTS-v0.1.md); independent of T03/T04. Coordinate any proposed schema correction with architecture owner before integrating. **Requirements:** AW-CON-004, 008–009, 026, 032–034; proposed AW-CEX-007–008.
- **Acceptance / tests / evidence:** Round-trip additive unknown fields, reject unknown major version, stale revision, duplicate command ID, lineage cycle, cross-account provider locator, expired approval, stream gap and placement-versus-resource deletion. Use only synthetic IDs/content. Evidence: fixture directory, test command/result and a short incompatibility report.

### T03 — Equivalent visual benchmark fixture

- **Outcome / ownership:** Define one scripted, data-safe scene and capture recipe that all shell/renderer candidates must implement: Vela, two blocks, a stream panel, approval panel, drag/expand/reparent, quality change, reduced motion and synthetic event indicator. Own `prototypes/visual-experience/benchmark-fixture/` and `docs/architecture/benchmarks/`; avoid T05/T07 candidate implementation paths.
- **Dependencies / parallelism:** T01 journey definitions may be drafted concurrently; lock fixture revision before comparing T05 results. **Requirements:** AW-CON-015–021; proposed AW-LIQ-015–022, AW-ENG-016, 021, 026.
- **Acceptance / tests / evidence:** Deterministic scenario script runs twice with same synthetic inputs; capture manifests include OS/GPU/display settings, frame/input/idle measurement method and reproducibility notes. Reviewer confirms no real agent state is implied. Evidence: script, fixture hashes and a dry-run trace. No benchmark conclusion yet.

### T04 — Provider access and entitlement decision spike

- **Outcome / ownership:** Produce a source-checked M2 access matrix for supported local Codex App Server versions and candidate sign-in paths, including eligible ChatGPT-plan OAuth versus separately billed API access, account scope, secure storage, token refresh and limits. Own `docs/decisions/research/provider-access/`; do not place credentials or real transcripts in Git.
- **Dependencies / parallelism:** Can run with T01–T03; must finish before T10 live auth work. Read current [official App Server guidance](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server), [sign-in scope guidance](https://developers.openai.com/siwc/quickstart) and [preview limits](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations), then test only through authorized account flow. **Requirements:** AW-CON-005, 009, 062–065; proposed AW-CEX-002–008, AW-ENG-018–019.
- **Acceptance / tests / evidence:** Matrix distinguishes documented, discovered, verified and unavailable operations; confirms identity sign-in does not grant ChatGPT history or plan use by itself; records whether a real authorized account is available and the exact blocked boundary if not. Evidence: dated source links, installed binary version, sanitized probe output, security review notes. No entitlement claim from model list alone.

## M1: interactive visual slice

### T05 — Comparable desktop shell candidates

- **Outcome / ownership:** Build two packaged candidate shells for the T03 scene, initially Tauri and Electron unless an ADR preflight rules one out with evidence. Own `prototypes/visual-experience/candidates/` and candidate-specific build files inside those folders; root configuration changes require a separate integration owner.
- **Dependencies / parallelism:** T03 fixed fixture; T06/T07 may develop interface/scene assets in parallel but candidate comparisons must use equivalent behavior. Coordinate App Server child-process constraint with T04/T09 before final ADR. **Requirements:** AW-CON-016–021; proposed AW-ENG-015–020.
- **Acceptance / tests / evidence:** Same interactions and synthetic event labels in both packaged candidates; launch/window/IPC/focus/secure-store capability checked; no feature omitted without an explicit comparison gap. Tests: automated scene smoke, two-window focus, crash/restart. Evidence: versioned builds, command outputs, hardware and measurement manifest, comparison table. A proposal to ADR-001 is not an accepted choice.

### T06 — Motion Coordinator contract and transition engine

- **Outcome / ownership:** Build a prototype coordinator that takes semantic source/target states and produces six-domain transitions with stable resource/transition IDs, interruption/retargeting, priorities, reduced-motion and quality-tier policies. Own `prototypes/visual-experience/motion/` only.
- **Dependencies / parallelism:** T02 contract envelope and T03 scenario. Independent of T05 candidate shell if renderer adapter is explicit; T07 integrates it. **Requirements:** AW-CON-017–019; proposed AW-LIQ-015–022, 023–033.
- **Acceptance / tests / evidence:** Starting drag then reversing/redirecting preserves identity, focus and end state; no domain mutation waits for animation completion; unknown provider state maps to honest semantic output. Tests: deterministic transition trace and interruption/property tests. Evidence: captured state/transition IDs, reduced-motion trace and reviewer-observed demo.

### T07 — Vela/block/material experience slice

- **Outcome / ownership:** Implement an interactive Vela presence, layered materials, meaningful low-cost particles, selectable block, contextual command entry and expand/back transition using T06 and T03. Own `prototypes/visual-experience/scenes/` and local scene assets only; reuse the approved mark in `assets/brand/` without editing it.
- **Dependencies / parallelism:** T03, T06; can work against one candidate shell while T05 compares shells, then port to comparison fixture without altering shared candidate files. **Requirements:** AW-CON-015–021, 026; proposed AW-LIQ-007–014, 034–050, AW-EXP-067.
- **Acceptance / tests / evidence:** User completes pointer and keyboard journeys; content remains legible on varying backgrounds; simulation label persists in stream/particle cues; disable particles/reduce motion and retain affordances. Tests: interaction smoke, focus/selection/contrast checks. Evidence: real-time capture, short reviewer notes and exact build/device info. Static mock does not pass.

### T08 — Visual performance and accessibility benchmark

- **Outcome / ownership:** Measure T05/T07 equivalent packaged scenes and propose quality budgets/ADR-002. Own `docs/decisions/research/visual-performance/` and benchmark scripts under `prototypes/visual-experience/measure/`; do not alter candidate implementations while measuring.
- **Dependencies / parallelism:** T03/T05/T07 integrated revisions; independent observer/reviewer preferred. **Requirements:** AW-CON-015–021; proposed AW-LIQ-020–022, 040–050, AW-ENG-016–020.
- **Acceptance / tests / evidence:** Named target devices, repeats, frame-time percentiles, input latency, CPU/GPU/memory, idle/minimized cost and reduced-motion/low-tier behavior; capture stutter and contrast/focus issues. Evidence: raw trace IDs, videos, measurement code, comparison and inconclusive items. Owner experience review and ADR approval are separate follow-ups.

## M2: real Codex bridge

### T09 — App Server protocol adapter

- **Outcome / ownership:** Build a thin, version-pinned adapter for initialize, create/resume thread, start turn, stream message/events and terminal result; normalize into provisional contracts with explicit errors. Own `src/providers/codex/protocol/` and `tests/providers/codex/protocol/`; keep provider-specific fields namespaced.
- **Dependencies / parallelism:** T02, T04 source matrix; T10 auth and T11 approval can proceed against synthetic protocol fixtures; T12 integrates. **Requirements:** AW-CON-004–006, 031–034; proposed AW-CEX-002–008, AW-ENG-022.
- **Acceptance / tests / evidence:** Synthetic transcript fixtures test successful turn, interrupted/failed terminal state, malformed frame, duplicate/out-of-order delta and reconnect mapping. A private real-provider turn is required at T12, not claimed by fixture tests. Evidence: pinned binary/protocol version, test output, normalized event trace without private content.

### T10 — Auth and capability snapshot

- **Outcome / ownership:** Implement a protected account/auth boundary and `ProviderCapabilitySnapshot` generator that distinguishes catalog, discovered support and verified completed inference. Own `src/providers/codex/auth/`, `src/providers/capabilities/` and corresponding tests; coordinate credential-storage dependency with platform owner.
- **Dependencies / parallelism:** T04 and T02; T09 protocol interface; can develop fake auth first, then private authorized smoke. **Requirements:** AW-CON-005, 009, 062–065; proposed AW-CEX-002–008, Charter 14.
- **Acceptance / tests / evidence:** Expired/denied/changed account cannot use prior scope; refresh/reconnect produces a new snapshot; unsupported operation is disabled with reason; no credential reaches renderer/log/public fixture. Tests: fake token expiry/revocation and account-crossing, secure-store integration test in private environment. Evidence: sanitized traces and security review.

### T11 — Approval, cancellation and failure recovery

- **Outcome / ownership:** Implement scoped approval broker and attempt state machine with provider request correlation, deny/expiry, cancellation request versus confirmation and unknown-outcome recovery. Own `src/execution/approvals/`, `src/execution/attempts/` and focused tests; do not modify T09 protocol parsing.
- **Dependencies / parallelism:** T02 contracts and T09 adapter callbacks; can test against fixture events while T10 is built. **Requirements:** AW-CON-024–025, 062–065; proposed AW-ENG-022–023, Charter 14.
- **Acceptance / tests / evidence:** A changed target fingerprint invalidates approval; denial prevents effect; duplicate provider request is idempotent; disconnect leaves accurate state; an agent final message cannot yield `verified`. Tests: transition matrix, expiry, denial, cancel and crash/reconcile. Evidence: state trace and security review with no real private content.

### T12 — Real bridge integration and acceptance evidence

- **Outcome / ownership:** Integrate T09–T11 into a thin real UI and run a private authorized App Server smoke. Own `src/integration/codex-bridge/`, `tests/integration/codex-bridge/` and a sanitized report in `docs/architecture/evidence/`. Any shared root config change goes through integration owner, not parallel tasks.
- **Dependencies / parallelism:** T09–T11, T04 access path, T02 contracts; M1 UI may be adapted later but is not a prerequisite to prove protocol truth. **Requirements:** AW-CON-002, 004–006, 031–034, 062–065; proposed AW-ENG-022–026, Charter 12.
- **Acceptance / tests / evidence:** With authorized account, create/resume thread, stream one real turn, observe terminal status, exercise actual approval deny/allow where safely available, cancel/interruption and process restart; ordinary direct chat requires no task. If any provider capability cannot be safely exercised, mark that criterion unverified rather than infer success. Tests: protocol/integration suite plus private live smoke with exact binary version and sanitized receipts. Reviewer confirms limitations, privacy and failure truth; owner decides M2 acceptance separately.

## Integration order and next handoffs

T01–T04 can start independently. T03 fixes the shared visual scenario; T05–T07 implement against it and T08 reviews measured results. T02 fixes schema fixtures; T04 informs T09/T10, while T11 runs against fixtures; T12 performs the single real bridge integration. The first immediately useful launches are T01/T02/T03/T04, followed by T05/T06 and T09/T10 as their dependencies land. Before any implementation begins, rerun governance routing for its exact paths and review the current registry. Charter publication/acceptance changes or a discovered conflict require source-linked re-review, not an implicit plan rewrite.
