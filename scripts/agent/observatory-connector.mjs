/** Use the owner's installed Sites plugin through Codex. No model turn or browser session is needed. */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const server = 'codex_apps';
const tool = 'aetherwake_engineering_observatory.sync_task_telemetry';
const timeoutMs = 8000;

export function openObservatoryConnector({ signal, cwd = process.cwd() } = {}) {
  const child = spawn('codex', ['app-server', '--listen', 'stdio://'], {
    cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'],
  });
  const lines = createInterface({ input: child.stdout });
  const pending = new Map();
  let sequence = 0;
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    signal?.removeEventListener('abort', close);
    for (const finish of pending.values()) finish({ error: true });
    pending.clear();
    lines.close();
    child.stdin.destroy();
    child.kill();
  }
  child.on('error', close);
  child.on('exit', close);
  child.stdin.on('error', close);
  signal?.addEventListener('abort', close, { once: true });
  lines.on('line', line => {
    try {
      const message = JSON.parse(line);
      pending.get(message.id)?.(message);
    } catch { close(); }
  });
  const send = message => child.stdin.write(JSON.stringify(message) + '\n');
  function rpc(method, params) {
    return new Promise((resolve, reject) => {
      if (closed || signal?.aborted) { reject(Error('Codex connector is unavailable')); return; }
      const id = ++sequence;
      const deadline = setTimeout(close, timeoutMs);
      pending.set(id, response => {
        pending.delete(id);
        clearTimeout(deadline);
        if (response.error) reject(Error('Codex connector request failed: ' + method));
        else resolve(response.result);
      });
      send({ id, method, params });
    });
  }
  const opening = (async () => {
    await rpc('initialize', { clientInfo: { name: 'aads_telemetry', title: 'AADS Telemetry', version: '1.0.0' } });
    send({ method: 'initialized' });
    const started = await rpc('thread/start', { cwd, ephemeral: true });
    if (typeof started?.thread?.id !== 'string') throw Error('Codex connector session unavailable');
    return started.thread.id;
  })();
  // A short-lived process may exit before the first delivery call starts.
  opening.catch(() => {});
  return {
    close,
    async call(args) {
      const threadId = await opening;
      const result = await rpc('mcpServer/tool/call', { threadId, server, tool, arguments: args });
      let value;
      try { value = result.structuredContent ?? JSON.parse(result.content.find(item => item.type === 'text').text); }
      catch { throw Error('Observatory returned an unreadable response'); }
      if (result.isError || value.error || (value.status !== undefined && value.status !== 200)) {
        const error = Error('Observatory declined the telemetry request');
        error.status = value.status;
        throw error;
      }
      return value;
    },
  };
}
