import { sanitizeExport } from '../../../scripts/agent/telemetry-export.mjs';
import { telemetryDelta, telemetryTaskId, withIndependentActivity } from '../telemetry-delta.mjs';

export const stagedFilename = 'observatory-projection.json';
export const maxSnapshotBytes = 1024 * 1024;

export async function readStagedSnapshot(file) {
  if (file.size > maxSnapshotBytes) throw Error('Staged export exceeds 1 MiB.');
  const raw = JSON.parse(await file.text());
  const tasks = raw.records?.filter(record => record.record_type === 'task');
  if (raw.export_version !== 1 || raw.repository !== 'Kgray44/Aetherwake' || raw.authority !== 'local-task-records' ||
      !Array.isArray(raw.events) || tasks?.length !== 1 || !telemetryTaskId.test(tasks[0].id) ||
      !Number.isFinite(Date.parse(raw.generated_at)) || new Date(raw.generated_at).toISOString() !== raw.generated_at) {
    throw Error('Select the private staging directory for one AADS Task.');
  }
  const snapshot = sanitizeExport(raw);
  snapshot.generated_at = raw.generated_at;
  return { taskId: tasks[0].id, snapshot };
}

class SyncError extends Error {
  constructor(message, { status, retryAt } = {}) {
    super(message);
    this.status = status;
    this.retryAt = retryAt;
  }
}

export function retryTelemetry(error, failedAttempts, now = Date.now()) {
  if (failedAttempts > 3 || ![0, 408, 425, 429, 500, 502, 503, 504].includes(error.status)) return null;
  return Math.max(now + 2000 * (2 ** (failedAttempts - 1)), error.retryAt ?? 0);
}

export function createTelemetryClient({ fetcher = fetch, headers, scope }) {
  const auth = { ...headers, 'x-observatory-sync-scope': scope };
  async function request(taskId, signal, body) {
    let response;
    try {
      response = await fetcher('/api/task-telemetry/' + encodeURIComponent(taskId), {
        method: body ? 'POST' : 'GET', headers: body ? { ...auth, 'content-type': 'application/json' } : auth,
        ...(body ? { body: JSON.stringify(body) } : {}), cache: 'no-store', redirect: 'error', signal,
      });
    } catch (cause) {
      if (signal?.aborted && signal.reason?.name !== 'TimeoutError') throw cause;
      throw new SyncError(signal?.aborted ? 'Site request timed out.' : 'Site connection unavailable.', { status: 0 });
    }
    const retry = response.headers.get('retry-after');
    const retryAt = retry && (/^\d+$/.test(retry) ? Date.now() + Number(retry) * 1000 : Date.parse(retry));
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new SyncError(result.error ?? 'Site rejected telemetry (HTTP ' + response.status + ').', { status: response.status, retryAt: retryAt || undefined });
    }
    try { return await response.json(); }
    catch { throw new SyncError('Site session returned an unexpected response. Reload and sign in.'); }
  }
  return {
    async synchronize(taskId, snapshot, signal) {
      let { baseline } = await request(taskId, signal);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const change = telemetryDelta(withIndependentActivity(snapshot, baseline), baseline);
        if (!change) return { changed: false, received_at: baseline?.received_at };
        let saved;
        try { saved = await request(taskId, signal, change); }
        catch (cause) {
          if (cause.status !== 409 || attempt > 0) throw cause;
          ({ baseline } = await request(taskId, signal));
          continue;
        }
        const { baseline: readback } = await request(taskId, signal);
        if (!readback || readback.digest !== saved.digest || telemetryDelta(withIndependentActivity(snapshot, readback), readback)) {
          throw new SyncError('Site readback changed. Resume to reconcile the current journal.', { status: 503 });
        }
        return { changed: true, received_at: readback.received_at };
      }
    },
  };
}
