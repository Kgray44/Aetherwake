import { Worker } from 'node:worker_threads';
import { CONTRACT, ServiceError, type Options, type StreamEvent, type CommandMap } from './contracts.mts';
import {createNativeHostServer,type NativeHostServices} from './native-host.mts';

/** Async, local trusted-host boundary. No synchronous DB calls on the caller's
 * event/render thread. This is not a remote or untrusted-renderer RPC endpoint. */
export class Backend {
  private worker: Worker;
  private next = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private listeners = new Set<(e: StreamEvent) => void>();
  private ready: Promise<void>;
  private dead = false;
  private closed = false;
  private closing:Promise<void>|null = null;
  private nativeServer:ReturnType<typeof createNativeHostServer>;
  constructor(options: Options, nativeHost?:NativeHostServices) {
    this.worker = new Worker(new URL('./worker.mts', import.meta.url), { workerData: nativeHost?{nativeHostProtocol:1,options}:options });
    this.nativeServer=createNativeHostServer(nativeHost,message=>this.worker.postMessage(message));
    this.ready = new Promise((resolve, reject) => {
      this.worker.on('message', message => {
        if(this.nativeServer.handle(message))return;
        if (message.ready) resolve();
        else if (message.startupError) { this.dead = true; this.nativeServer.close(); reject(new ServiceError(message.startupError)); }
        else if (message.event) for (const listener of this.listeners) { try { listener(message.event); } catch { /* subscriber isolation */ } }
        else {
          const pending = this.pending.get(message.id); if (!pending) return;
          this.pending.delete(message.id);
          if (message.error) pending.reject(new ServiceError(message.error)); else pending.resolve(message.result);
        }
      });
      const fail = () => { this.dead = true; this.nativeServer.close(); reject(new ServiceError('backend_disconnected')); for (const p of this.pending.values()) p.reject(new ServiceError('backend_disconnected')); this.pending.clear(); };
      this.worker.on('error', fail); this.worker.on('exit', fail);
    });
  }
  async call<K extends keyof CommandMap>(command: K, input: CommandMap[K]['input']): Promise<CommandMap[K]['output']> {
    await this.ready;
    if (this.dead||this.closed) throw new ServiceError('backend_disconnected');
    if (this.pending.size >= 64) throw new ServiceError('backpressure');
    if (Buffer.byteLength(JSON.stringify(input)) > (command === 'viewState' ? 2 * 1024 * 1024 + 1024 : 256 * 1024)) throw new ServiceError('command_too_large');
    const id = ++this.next;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.worker.postMessage({ id, contract: CONTRACT, command, input }); });
  }
  subscribe(listener: (event: StreamEvent) => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  async close() {
    if(this.dead||this.closed)return;
    if(this.closing)return this.closing;
    const task=(async()=>{await this.call('close',{});this.closed=true;this.nativeServer.close();})();
    this.closing=task;
    try{await task;}finally{if(this.closing===task)this.closing=null;}
  }
  /** Explicit process-loss exercise, not a cancellation confirmation. */
  async terminate() { this.closed=true;this.nativeServer.close(); await this.worker.terminate(); }
}
