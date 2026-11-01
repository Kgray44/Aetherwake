import { Worker } from 'node:worker_threads';
import { CONTRACT, ServiceError, type Options, type StreamEvent, type CommandMap } from './contracts.mts';

/** Async, local trusted-host boundary. No synchronous DB calls on the caller's
 * event/render thread. This is not a remote or untrusted-renderer RPC endpoint. */
export class Backend {
  private worker: Worker;
  private next = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private listeners = new Set<(e: StreamEvent) => void>();
  private ready: Promise<void>;
  private dead = false;
  constructor(options: Options) {
    this.worker = new Worker(new URL('./worker.mts', import.meta.url), { workerData: options });
    this.ready = new Promise((resolve, reject) => {
      this.worker.on('message', message => {
        if (message.ready) resolve();
        else if (message.startupError) { this.dead = true; reject(new ServiceError(message.startupError)); }
        else if (message.event) for (const listener of this.listeners) { try { listener(message.event); } catch { /* subscriber isolation */ } }
        else {
          const pending = this.pending.get(message.id); if (!pending) return;
          this.pending.delete(message.id);
          if (message.error) pending.reject(new ServiceError(message.error)); else pending.resolve(message.result);
        }
      });
      const fail = () => { this.dead = true; reject(new ServiceError('backend_disconnected')); for (const p of this.pending.values()) p.reject(new ServiceError('backend_disconnected')); this.pending.clear(); };
      this.worker.on('error', fail); this.worker.on('exit', fail);
    });
  }
  async call<K extends keyof CommandMap>(command: K, input: CommandMap[K]['input']): Promise<CommandMap[K]['output']> {
    await this.ready;
    if (this.dead) throw new ServiceError('backend_disconnected');
    if (this.pending.size >= 64) throw new ServiceError('backpressure');
    if (Buffer.byteLength(JSON.stringify(input)) > (command === 'viewState' ? 2 * 1024 * 1024 + 1024 : 256 * 1024)) throw new ServiceError('command_too_large');
    const id = ++this.next;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.worker.postMessage({ id, contract: CONTRACT, command, input }); });
  }
  subscribe(listener: (event: StreamEvent) => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  async close() { if (!this.dead) await this.call('close', {}); }
  /** Explicit process-loss exercise, not a cancellation confirmation. */
  async terminate() { await this.worker.terminate(); }
}
