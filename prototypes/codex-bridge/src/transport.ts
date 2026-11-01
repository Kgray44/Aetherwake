import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";

export type Wire = Record<string, unknown>;
export type ApprovalDecision = "decline" | "cancel" | "accept" | "acceptForSession";
export type ServerRequestHandler = (request: Wire) => Promise<Wire> | Wire;

export class BridgeError extends Error {
  readonly kind: string;
  readonly code?: number;
  constructor(kind: string, message: string, code?: number) {
    super(message);
    this.kind = kind; this.code = code;
  }
}

export class JsonlTransport extends EventEmitter {
  private child?: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<number, { method: string; resolve: (value: Wire) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private closed = true;
  private queuedBytes = 0;
  private readonly maxPending = 32;
  private readonly maxQueuedBytes = 1024 * 1024;
  private readonly maxLineBytes = 4 * 1024 * 1024;
  private readonly executable: string;
  private readonly args: string[];
  constructor(executable = "codex", args = ["app-server", "--listen", "stdio://"] ) { super(); this.executable = executable; this.args = args; }

  async start(): Promise<Wire> {
    if (!this.closed) throw new BridgeError("state", "Transport already started");
    this.closed = false;
    const child = spawn(this.executable, this.args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    this.child = child;
    child.on("error", (error: NodeJS.ErrnoException) => this.fail(new BridgeError(error.code === "ENOENT" ? "missing-executable" : "transport", error.message)));
    child.on("exit", (code, signal) => this.fail(new BridgeError("process-exit", `App Server exited (code=${code}, signal=${signal})`)));
    child.stdin.on("error", error => this.fail(new BridgeError("transport", error.message)));
    // stderr can contain sensitive diagnostics. Keep it out of public logs.
    child.stderr.resume();
    let incoming = Buffer.alloc(0);
    child.stdout.on("data", (chunk: Buffer) => {
      incoming = Buffer.concat([incoming, chunk]);
      if (incoming.length > this.maxLineBytes && incoming.indexOf(10) < 0) return this.fail(new BridgeError("protocol", "JSONL line exceeds limit"));
      let newline: number;
      while ((newline = incoming.indexOf(10)) >= 0 && !this.closed) {
        const line = incoming.subarray(0, newline);
        incoming = incoming.subarray(newline + 1);
        if (line.length > this.maxLineBytes) return this.fail(new BridgeError("protocol", "JSONL line exceeds limit"));
        try { this.receive(JSON.parse(line.toString("utf8")) as Wire); }
        catch { this.fail(new BridgeError("protocol", "Invalid JSONL from App Server")); }
      }
      if (incoming.length > this.maxLineBytes) this.fail(new BridgeError("protocol", "JSONL line exceeds limit"));
    });
    try {
      const initialized = await this.request("initialize", { clientInfo: { name: "aetherwake_codex_bridge", title: "Aetherwake Codex Bridge Prototype", version: "0.1.0" } });
      this.notify("initialized", {});
      return initialized;
    } catch (error) { this.close(); throw error; }
  }

  request(method: string, params: Wire = {}, timeoutMs = 15000): Promise<Wire> {
    if (this.closed || !this.child) return Promise.reject(new BridgeError("transport", "App Server is not connected"));
    if (this.pending.size >= this.maxPending) return Promise.reject(new BridgeError("backpressure", "Too many pending requests"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new BridgeError("timeout", `${method} timed out`)); }, timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      try { this.send({ id, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  notify(method: string, params: Wire = {}): void { this.send({ method, params }); }

  private send(message: Wire): void {
    if (this.closed || !this.child) throw new BridgeError("transport", "App Server is not connected");
    const line = JSON.stringify(message) + "\n";
    const bytes = Buffer.byteLength(line);
    if (this.queuedBytes + bytes > this.maxQueuedBytes) throw new BridgeError("backpressure", "Write queue full");
    this.queuedBytes += bytes;
    this.child.stdin.write(line, () => { this.queuedBytes -= bytes; });
  }

  private receive(message: Wire): void {
    if (typeof message.id === "number" && ("result" in message || "error" in message)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id); clearTimeout(pending.timer);
      if (message.error && typeof message.error === "object") {
        const error = message.error as Wire;
        const code = typeof error.code === "number" ? error.code : undefined;
        const detail = String(error.message ?? "RPC error");
        const kind = pending.method.startsWith("thread/") && /(?:thread|session|rollout|history).*(?:not found|unavailable|missing)/i.test(detail) ? "unavailable-history" :
          code === 429 || code === -32001 || /rate limit|too many requests|overloaded/i.test(detail) ? "rate-limit" :
          /model.*(unavailable|not available|not found|unsupported)/i.test(detail) ? "unavailable-model" :
          /auth(entication|orization).*required|not logged in/i.test(detail) ? "auth-required" :
          code === -32601 ? "unsupported" : "rpc";
        pending.reject(new BridgeError(kind, detail, code));
      } else pending.resolve((message.result ?? {}) as Wire);
    } else if ("id" in message && typeof message.method === "string") {
      this.emit("serverRequest", message);
    } else if (typeof message.method === "string") {
      this.emit("notification", message);
    } else this.emit("protocolWarning", "Unknown wire message");
  }

  respond(id: unknown, result: Wire): void { this.send({ id, result }); }
  respondError(id: unknown, code: number, message: string): void { this.send({ id, error: { code, message } }); }
  close(): void { if (!this.closed) { this.child?.kill(); this.fail(new BridgeError("closed", "Transport closed")); } }
  private fail(error: BridgeError): void {
    if (this.closed) return;
    this.closed = true;
    this.child?.kill();
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    this.emit("failure", error);
  }
}
