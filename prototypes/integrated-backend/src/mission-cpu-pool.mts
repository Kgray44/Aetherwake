import { Worker } from 'node:worker_threads';
import { missionCpuWorkerProtocol, type inspectBackendSource } from './mission-cpu-worker.mts';

type Inspection = Awaited<ReturnType<typeof inspectBackendSource>>;
type Slot = { worker: Worker; busy: boolean; retiring: boolean };
const inspectionOldGenerationMiB = 32;
// Allow for the rest of V8 and native allocations in addition to the old-generation limit.
export const missionCpuInspectionRamBytes = (inspectionOldGenerationMiB + 32) * 2 ** 20;

const spawnInspectionWorker = () => new Worker(new URL('./mission-cpu-worker.mts', import.meta.url), {
  workerData: missionCpuWorkerProtocol, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: inspectionOldGenerationMiB },
});

/** No queue: MissionService holds work until a resource lease and lane slot are available. */
export function createMissionCpuPool(limit: number, spawn = spawnInspectionWorker) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 32) throw Error('invalid_mission_cpu_pool_limit');
  const slots = new Set<Slot>();
  let closed = false;
  let closing: Promise<void> | undefined;

  function newSlot() {
    const worker = spawn();
    const slot = { worker, busy: false, retiring: false };
    slots.add(slot);
    worker.on('error', () => { slot.retiring = true; });
    worker.once('exit', () => { slots.delete(slot); });
    return slot;
  }

  function retire(slot: Slot) {
    if (slot.retiring) return;
    slot.retiring = true;
    void slot.worker.terminate().catch(() => { /* The exit listener owns settlement. */ });
  }

  return {
    async inspect(signal: AbortSignal): Promise<{ evidence: Inspection; threadId: number }> {
      signal.throwIfAborted();
      if (closed) throw Error('mission_cpu_pool_closed');
      const slot = [...slots].find(candidate => !candidate.busy && !candidate.retiring) ??
        (slots.size < limit ? newSlot() : undefined);
      if (!slot) throw Error('mission_cpu_backpressure');
      slot.busy = true;
      const { worker } = slot, { threadId } = worker;
      worker.ref();
      return new Promise((resolve, reject) => {
        const cleanup = () => {
          signal.removeEventListener('abort', cancel);
          worker.off('message', result);
          worker.off('exit', exited);
          slot.busy = false;
          worker.unref();
        };
        const cancel = () => retire(slot);
        const exited = () => {
          cleanup();
          reject(signal.aborted ? signal.reason : Error('mission_cpu_worker_exited'));
        };
        const result = (evidence: Inspection | null) => {
          if (signal.aborted || slot.retiring) return;
          cleanup();
          if (evidence) resolve({ evidence, threadId });
          else reject(Error('backend_source_unavailable'));
        };
        worker.once('message', result);
        worker.once('exit', exited);
        signal.addEventListener('abort', cancel, { once: true });
        if (signal.aborted) { retire(slot); return; }
        try { worker.postMessage('inspect-backend-source'); }
        catch { retire(slot); }
      });
    },
    trimIdle() {
      for (const slot of slots) if (!slot.busy) retire(slot);
    },
    close(): Promise<void> {
      closed = true;
      return closing ??= Promise.allSettled([...slots].map(({ worker }) => worker.terminate())).then(results => {
        const failure = results.find(result => result.status === 'rejected');
        if (failure) throw failure.reason;
      });
    },
  };
}
