import type { createMissionAdmission } from './mission-admission.mts';
import type { MissionExecutor, MissionPlan, MissionScope } from './mission-contracts.mts';
import type { GpuProcessBudget, ResourceLeaseRequest } from './resource-policy.mts';
import { gpuReadbackRamReservationBytes, gpuReadbackReservationBytes, openWindowsGpuReadback, verifiedGpuReadback } from './windows-gpu-readback.mts';

export const gpuReadbackExecutor = 'gpu.readback-diagnostic';
export const gpuReadbackSource = 'windows:d3d11-verified-readback';
export type GpuReadbackNativeRequest = { name: 'preview' } | { name: 'start'; reviewId: string };
export type GpuReadbackNativeResponse = { kind: 'preview'; reviewId: string; workspaceTitle: string;
  ramBytes: number; vramBytes: number } | { kind: 'started'; missionId: string };

export function gpuReadbackPlan(scope: MissionScope): MissionPlan {
  return { objective: 'Verify Windows GPU buffer readback', scope, criteria: ['gpu-buffer-digests'],
    tasks: [{ id: 'gpu-readback', objective: 'Copy fixed test buffers and verify their readback digests',
      criterion: 'gpu-buffer-digests', executor: gpuReadbackExecutor, dependencies: [],
      claims: [{ resource: 'host.gpu-readback', mode: 'exclusive' }], maxAttempts: 1, timeoutMs: 10_000 }] };
}

type Worker = ReturnType<typeof openWindowsGpuReadback>;
type Slot = { worker: Worker; budget?: GpuProcessBudget; attemptId?: string; stopping: boolean };

/** Owns one native preflight or execution process. MissionService owns the queue. */
export function createGpuReadbackAdapter(governor: ReturnType<typeof createMissionAdmission>, wake: () => void,
  platformAvailable: () => boolean, open = openWindowsGpuReadback) {
  let slot: Slot | undefined, failed = false, disposed = false, retryAt = 0;
  const enabled = () => !disposed && platformAvailable() && governor.inspectPolicy().limits.gpu === 1;
  const available = () => enabled() && !failed;
  const canAcquire = () => available() && !!slot?.budget && !slot.stopping && !slot.attemptId && governor.canLease('gpu');
  const executor: MissionExecutor = {
    lane: 'native', replaySafe: true, available,
    async run({ attemptId, signal, resourceCheckpoint }) {
      const target = slot;
      if (!target || target.attemptId !== attemptId || !claimedLease) throw Error('windows_gpu_lease_required');
      try { return { source: gpuReadbackSource, value: await target.worker.run(claimedLease, signal) }; }
      catch (error) {
        if (signal.aborted || !resourceCheckpoint?.aborted) throw error;
        return { source: gpuReadbackSource, outcome: 'blocked', value: { status: 'resource_checkpoint' } };
      }
    },
    verify(evidence) {
      return { passed: evidence.source === gpuReadbackSource && verifiedGpuReadback(evidence.value),
        detail: 'Verified the SHA-256 digest of each staged GPU buffer' };
    },
  };
  let claimedLease: ReturnType<typeof governor.tryLease>;

  function clear(target: Slot) {
    if (slot !== target) return;
    slot = undefined;
    governor.noteGpuBudget(null);
    retryAt = performance.now() + 2000;
    if (!disposed) wake();
  }
  function stopIdle() {
    if (slot && !slot.attemptId && !slot.stopping) {
      slot.stopping = true;
      void slot.worker.close();
    }
  }

  return {
    enabled, executor, canAcquire, stopIdle,
    reopen() { failed = false; retryAt = 0; },
    prepare() {
      if (!available() || slot || performance.now() < retryAt || !governor.mayPrepareGpu()) return;
      let worker: Worker;
      try { worker = open(); }
      catch { failed = true; wake(); return; }
      const target: Slot = { worker, stopping: false };
      slot = target;
      void worker.budget.then(budget => {
        if (slot !== target || target.stopping || disposed) return;
        if (budget.budgetBytes - budget.usedBytes < gpuReadbackReservationBytes || !governor.noteGpuBudget(budget)) {
          failed = true;
          stopIdle();
          return;
        }
        target.budget = budget;
        wake();
      }, () => {
        if (slot === target && !target.stopping) failed = true;
      });
      void worker.closed.then(() => { if (!target.attemptId) clear(target); });
    },
    acquire(identity: Omit<ResourceLeaseRequest, 'kind' | 'estimatedRamBytes'>) {
      const target = slot, budget = target?.budget;
      if (!canAcquire() || !target || !budget) return;
      const lease = governor.tryLease({ ...identity, kind: 'gpu', gpuContextId: budget.contextId,
        estimatedVramBytes: gpuReadbackReservationBytes, estimatedRamBytes: gpuReadbackRamReservationBytes });
      if (!lease) return;
      target.attemptId = identity.attemptId;
      claimedLease = lease;
      return {
        get active() { return lease.active; },
        receipt: lease.receipt,
        checkpointRequested: lease.checkpointRequested,
        release() {
          void target.worker.close().then(() => {
            lease.release();
            if (claimedLease === lease) claimedLease = undefined;
            clear(target);
          });
        },
      };
    },
    async close() {
      disposed = true;
      const target = slot;
      if (!target) return;
      await target.worker.close();
      claimedLease?.release();
      claimedLease = undefined;
      clear(target);
    },
  };
}
