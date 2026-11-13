# FI-4 dispatch-boundary follow-up

Program B, local implementation only. Base `c470a5d23786ea2d5022553a1472e3643a619bb1` was fetched from origin/main and verified as a descendant of `52b75ef0`. It already contains merged PR #59 (`be41c1c`) and PR #60; this worker did not merge or cherry-pick acceptance work or edit its sources.

## Workspace recovery and provenance

The former `fi4-foundations` checkout and the other Aerynth checkouts are absent from the current filesystem, including the unsandboxed view. GitHub reports no commit for `794bd66935ee7f06a9c6eeaf8a3795e794f35ac2` and no FI-4 branch. Thus this new isolated `fi4-terminal-reconciliation` branch is not a continuation preserving the old local Git objects. Original commits `348d0da96f3da25ea138cafbf77fb406ced3858e` and `794bd66935ee7f06a9c6eeaf8a3795e794f35ac2` remain their previously reported identities; recovery requires the original workspace or another copy. No source-sensitive publication was attempted to recover them.

The original journal-derived uncertain-claim fence is restored here from the prior implementation record because current main still checks only live workers. It retains original read/exclusive rules for uncertain tasks, including cancelled/inactive/retained missions, without another lock store. Do not apply that restoration twice when integrating onto the original FI-4 branch.

## Smallest new proven outcome

A committed running attempt can be cancelled before its queued executor continuation begins. Previously every such cancellation of a non-replayable executor became uncertain, even though `run` was never invoked. MissionService now tracks executor entry within its host-owned continuation:

- Cancellation before entry records cancelled (or failed for close/timeout); current authorization loss before entry records blocked. The existing atomic settlement preserves the original attempt ID and terminal outcome. No executor/provider operation occurs.
- After entry, non-replayable cancellation/revocation stays uncertain even if a late result looks successful. The restored conflict fence remains in force across restart.
- Crash before settlement remains conservative startup uncertainty. A volatile entry flag is not durable proof that some prior host did not dispatch.

This implements only a host-proven no-dispatch terminal boundary. It adds no general reconciliation API, new contract/event schema, permission, FI-0 namespace, effect replay, experiment owner or workspace consumer. It cannot release a previously uncertain effect merely because the current worker lacks a live handle.

## Terminal readback blocker and interface disposition

Inspection of current supported mission adapters found no complete compound terminal proof. Non-replayable specialists return provider reports; illustration combines remote generation, local files and resource imports. `MissionExecutor.run/verify` does not expose an original-effect-bound quiescence/readback contract. Project checks retain bounded command work but do not supply a general remote/descendant quiescence proof. A file, digest, cancellation, timeout, released lease or completed provider marker is insufficient.

Before any general release consumer is added, the additive host-only interface must bind canonical mission/task/attempt, exact original effect/receipt/idempotency identity and expected revision. A qualified source adapter must return still-running, unknown, quiescent-with-proven-no-effect, or quiescent-with-observed-effect. Trust/Core/source owner supplies current authorization; provider/process supervisor supplies original-operation and continuation/descendant quiescence; file/artifact owner supplies versioned effect readback; independent verifier supplies actual postconditions; MissionService atomically preserves history and commits evidence plus only the proven claim disposition through the canonical event owner. Exact serialized receipt/event remains a coordinated contract dependency, not an improvised schema here.

Still-running/unknown retain fences. Missing/wrong identity, source version, stale revision, revocation during observation, PID reuse, late/conflicting receipts, a racing writer and surviving delegated effects must reject release. Identical committed receipt application must be idempotent; conflicting duplicates cannot overwrite it. Crash before commit retains the old fence; crash after commit preserves one durable decision. Proven-no-effect does not authorize automatic retry. Partial/failed effects do not become success; resolving one attempt cannot release a sibling. FI-0 `aerynth.experience.evaluation-reference@1` proves only its supported CPU/RAM host evidence and cannot release any uncertain claim or certify independent experiment quality/promotion.

## Changed-scope verification

`node --test prototypes/integrated-backend/tests/mission-dispatch-boundary.test.mts prototypes/integrated-backend/tests/mission-service.test.mts`: 27 passed, zero failed/skipped. Three new tests use the actual MissionService and SQLite transaction owner with labeled synthetic local executors: pre-entry cancel and durable reopen; post-entry late success retaining uncertainty/fence on reopen; and revocation before entry with inaccessible projection. Existing scheduler tests cover overlap, joins, leases, retries and revision preservation. No paid/live provider operation ran.

Pinned dependencies installed with scripts disabled in integrated-backend, block-library and openai-provider for backend typecheck; `npm --prefix prototypes/integrated-backend run typecheck` passed. Changed-scope governance retrieval covered AW-ATW-160/175 and AW-TRUST-164, with no missing IDs or warnings. Whitespace check passed. Broad suites and native acceptance were not rerun under the quota constraint.

## Remaining work by execution location

Cloud-capable engineering: coordinate and implement the durable terminal receipt/event contract; extend actual adapters with original execution binding, bounded read-only observation and enforceable quiescence; add atomic reconciliation/race/revocation/restart negatives and then scoped consumers. This is real implementation work, not blocked solely by an offline desktop. It cannot be safely reduced to a generic callback accepting renderer/model assertions. This follow-up stops at the proven predispatch boundary under the explicit quota constraint.

Native/provider qualification after implementation: original Codex/native process-instance and process-tree liveness/exit proofs, packaged host restart/IPC races, Windows/GPU/gaming/foreground responsiveness and actual provider terminal semantics. Live paid probes need their own explicit authorization; none was requested or used here. Owner-only work is final experience/release acceptance or any genuinely new privilege/monitoring/paid-operation authorization, not designing the missing API for engineers.

Handoff: review this branch's scoped diff. If restoring the original FI-4 checkout, preserve its commits and apply only the new executor-entry guard/test plus any missing documentation; retain its existing uncertain-claim fence. If using this fresh verified-main base, include the restored fence. No merge, push, publication or deployment performed.
