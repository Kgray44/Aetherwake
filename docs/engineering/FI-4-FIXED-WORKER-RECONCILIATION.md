# FI-4 original fixed-worker result reconciliation

Program B, bounded implementation increment on `eb8c6b3b3009072fcb9ed34d6391ff4a8f60bb4e`. The underlying verified main is `c470a5d23786ea2d5022553a1472e3643a619bb1`. No existing fence was rebuilt. This extends the producer and consumer rather than treating their previously incomplete interface as a permanent blocker.

## Supported class and proof ownership

The sole supported entered operation is `inspect.backend-source`: the application's existing fixed worker reads the shipped `core.mts` module and computes its digest/static counts. It is a read-only computation, not an arbitrary command, process-tree mutation, provider action or generic CPU/RAM measurement. No new executor, scheduler, permission or datastore is added.

The existing pool has an opt-in terminal mode, used by the pooled native source executor. It creates an effect ID and binds mission/task/attempt, normalized scope and resource claims before posting the job. Only the shipped worker factory can use terminal mode; injected/custom workers fail closed before spawning. After the original result arrives, the producer retires that worker and waits for actual `Worker.terminate()` completion. It then mints an immutable original-job/worker-instance exit receipt. Nonterminal pool callers retain their existing idle-worker reuse behavior. Terminal source inspections deliberately retire their worker instead of claiming quiescence from a result message alone; additional startup/verification overhead is not presented as a speedup.

Live producer custody is held in a module-private WeakSet. The host cannot record a copied/structurally forged exit assertion. The source executor passes the original object through the trusted execution context; MissionService binds and persists it on the canonical original attempt only after validating live custody, original binding, dispatch entry, current scope/context and independent current-source readback. No renderer/model/RPC accepts a caller-supplied terminal receipt. The canonical journal, not a second result store, owns the durable receipt after capture. Host/binary/canonical-database compromise is outside this contract's trust boundary.

`backendInspectionCurrent` independently opens only the fixed shipped module, reads at most 768 KiB plus an overflow byte, verifies descriptor and current-path identity/size/timestamps, SHA-256 and static counts, and rejects changed sources. The receipt retains the actual capture timestamp, source digest, worker instance, original effect ID, original binding, evidence ID and terminal-body digest. A valid checksum alone is insufficient: stale source, missing/unquiesced exit, foreign measurements and mismatched identity remain denied.

## Atomic consumer and existing workflow

The additive optional field is `MissionAttempt.backendInspection` (`aerynth.backend-inspection-terminal@1`); the trusted context hook is `recordBackendInspection`. The host-only operation is `MissionService.reconcileBackendInspection(id, scope, expectedRevision, taskId, attemptId)`. It applies only to this fixed class and a failed/uncertain original attempt. It verifies the exact original admission/dispatch, effect, scope, claims, context, source revision and result, then atomically records original evidence/verification, terminal task state and a canonical recovered event. Publication failure rolls all of those changes back. It never calls `run`, increments the attempt count or authorizes a retry. Identical already-applied reconciliation is idempotent only when its recorded evidence and event agree.

Existing Retry automatically takes this readback path when an eligible source receipt exists. This works even when the original attempt budget is exhausted, because no new attempt occurs. Stale or malformed receipt-bearing attempts fail closed instead of falling through to dispatch. Cancellation is never undone; still-running attempts cannot be reconciled. Other effect classes retain their previous conservative behavior and uncertain claim fences.

Verification after recovery is separate from execution settlement. The recovered event references the original attempt without creating a second execution span. `lastMissionVerificationEvent` recognizes the specific evidence-backed recovered milestone for canonical report/workroom conversation delivery. It does not accept a bare recovered label or verified boolean. Core changes are limited to that helper import and mission-report predicate; no inference/CIE/AEP comparison or renderer behavior is edited. Source snapshot facts remain explicitly static clues, not a bottleneck/performance finding.

## Verification and fault model

Tests use the actual fixed worker thread and canonical SQLite MissionService. Lost delivery, takeover and publication faults are explicitly synthetic; the worker/source read/exit and independent readback are real local operations. Coverage includes original result recovery after restart without re-execution, takeover between durable capture and settlement, stale-owner settlement fencing, idempotence, original observation time, current source/digest verification, wrong task/attempt/scope/resource/context/revision/effect, missing/malformed/unquiesced receipts, valid-checksum foreign CPU measurements, revoked access, cancelled/still-running attempts, unsupported worker factories, immutable/copy-resistant producer proof, atomic rollback, and existing Retry/report/conversation delivery exactly once. No live provider operation or credential access occurred.

Commands for the focused producer/kernel/delivery set:

```sh
node --test prototypes/integrated-backend/tests/mission-source-reconciliation.test.mts prototypes/integrated-backend/tests/arie-cpu-pool.test.mts prototypes/integrated-backend/tests/mission-dispatch-recovery.test.mts prototypes/integrated-backend/tests/mission-service.test.mts prototypes/integrated-backend/tests/mission-publication.test.mts prototypes/integrated-backend/tests/mission-conversation.test.mts
node --test --test-name-pattern='canonical backend runs a native mission' prototypes/integrated-backend/tests/mission-integration.test.mts
npm --prefix prototypes/integrated-backend run typecheck
git diff --check
```

Development checks exposed two issues that were corrected: a test compared live elapsed projection time instead of durable journal state, and TypeScript found a missing-attempt guard in recovered-event reporting. The final packet records final check results separately. Broad suites, live APIs and native Windows/GPU/gaming qualification were not run; no performance improvement is claimed.

## Integration and remaining scope

The recovery archive supplies a full patch series from main and an increment-only patch from `eb8c6b3`. Choose one path; do not duplicate earlier dispatch gates/fences. New optional receipt metadata is additive; old records lacking it cannot acquire terminal proof retroactively. Existing ordinary pool reuse is preserved, while this terminal class intentionally waits for exit. Full native/provider process effects remain unsupported, rather than being routed through this narrow proof.

Cloud completion delivered here: one real producer-owned entered-operation proof, durable original-result capture, independent source verification, atomic/idempotent reconciliation, conservative negatives and the existing Retry/delivery integration. A successful source inspection does not prove an enclosing multi-deliverable objective or independent experiment quality. FI-0 CPU/RAM evaluation references are unchanged and cannot release uncertain effects; FI-6 may project the canonical result but cannot verify it itself.

Further classes require their own original execution identity, authoritative terminal readback and quiescence mechanism. Codex arbitrary commands require supported process/descendant liveness semantics; provider/delegated tools require qualified original-operation terminal guarantees. These are not replaced with model text, file existence or this worker receipt. Packaged Windows host/IPC/process-loss, process-tree behavior, GPU/gaming responsiveness and owner visual acceptance remain separate native gates. No desktop load/UI competition, merge, push, release or deployment was performed.

### Final check disposition

Final affected set: **58 passed, 0 failed, 0 skipped**. Targeted actual Core native-mission integration: **1 passed, 0 failed, 0 skipped**. Backend typecheck and whitespace check passed. Focused governance retrieval found all requested requirements with no warnings; index fingerprint `c68f3d46560c39ded1ea40aac6c55008803f498861c4c5005b621baddadd8237`. Intermediate development failures were corrected as described above; none remains in these final checks. No whole-suite, live-provider, Windows process-tree, packaged-native, GPU/gaming or owner-acceptance result is implied.
