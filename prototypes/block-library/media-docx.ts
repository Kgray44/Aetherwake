import { MEDIA_LIMITS } from '../application-contract/media.ts';
import { MediaError } from './media-policy.ts';
import type { parseDocx } from './media-docx-parser.ts';

export async function parseDocxIsolated(bytes: Uint8Array, signal?: AbortSignal): Promise<Awaited<ReturnType<typeof parseDocx>>> {
  const worker = new Worker(new URL('./media-docx-worker.ts', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (error?: unknown, value?: Awaited<ReturnType<typeof parseDocx>>) => {
      if (finished) return; finished = true; clearTimeout(timer); worker.terminate(); signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(value!);
    };
    const abort = () => finish(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(() => finish(new MediaError('timeout', 'Document conversion exceeded its time limit.')), MEDIA_LIMITS.parserTimeoutMs);
    worker.onmessage = event => event.data?.ok ? finish(undefined, event.data.value) : finish(new MediaError(event.data?.code ?? 'invalid_data', event.data?.message ?? 'Document conversion failed.'));
    worker.onerror = () => finish(new MediaError('invalid_data', 'The document conversion worker failed.'));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    const data = bytes.slice(); worker.postMessage(data, [data.buffer]);
  });
}
