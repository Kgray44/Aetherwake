import { parentPort, workerData } from 'node:worker_threads';
import { BackendCore } from './core.mts';
import { CONTRACT, type Options } from './contracts.mts';
const port = parentPort!;
try {
  const core = new BackendCore(workerData as Options, event => port.postMessage({ event }));
  port.on('message', async request => {
    const { id, contract, command, input } = request;
    try {
      if (contract !== CONTRACT) throw Object.assign(new Error(), { code: 'unsupported_contract' });
      const result = await core.command(command, input);
      port.postMessage({ id, result });
      if (command === 'close') port.close();
    } catch (e) {
      // Raw native diagnostics may contain personal paths/content. Send codes only.
      const candidate = (e as any).code ?? (e as any).kind;
      const code = typeof candidate === 'string' && /^[a-zA-Z_\-]{1,80}$/.test(candidate) ? candidate : 'operation_failed';
      port.postMessage({ id, error: code });
    }
  });
  port.postMessage({ ready: true });
} catch { port.postMessage({ startupError: 'storage_or_schema_failure' }); port.close(); }
