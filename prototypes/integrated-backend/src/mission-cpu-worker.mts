import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { parentPort, workerData } from 'node:worker_threads';

/** The mission can inspect only the application's own shipped module. */
export async function inspectBackendSource(signal?: AbortSignal) {
  signal?.throwIfAborted();
  const file = await open(new URL('./core.mts', import.meta.url), 'r');
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size < 1 || before.size > 768 * 1024) throw Error('backend_source_unavailable');
    const bytes = Buffer.alloc(before.size + 1);
    let read = 0;
    while (read < bytes.length) {
      signal?.throwIfAborted();
      const { bytesRead } = await file.read(bytes, read, bytes.length - read, read);
      if (!bytesRead) break;
      read += bytesRead;
    }
    const after = await file.stat();
    if (after.mtimeMs !== before.mtimeMs || after.size !== read || read !== before.size) throw Error('backend_source_changed');
    const content = bytes.subarray(0, read);
    const source = content.toString('utf8');
    return { source: 'aerynth.shipped-backend-source', value: {
      module: 'core.mts', sha256: createHash('sha256').update(content).digest('hex'), bytes: read,
      sqlitePrepareSites: [...source.matchAll(/\bthis\.db\.prepare\(/gu)].length,
      transactionSites: [...source.matchAll(/\bthis\.kernel\.withTransaction\(/gu)].length,
      note: 'Counts are static inspection clues. They do not measure runtime cost or establish a bottleneck.',
    } };
  } finally { await file.close(); }
}

export const missionCpuWorkerProtocol = 'aerynth.mission.cpu-worker@1';
if (parentPort && workerData === missionCpuWorkerProtocol) {
  const port = parentPort;
  port.on('message', async message => {
    if (message !== 'inspect-backend-source') return;
    try { port.postMessage(await inspectBackendSource()); }
    catch { port.postMessage(null); }
  });
}
