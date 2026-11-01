import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { BridgeError, JsonlTransport, type Wire, type ServerRequestHandler } from "./transport.ts";
import type { ThreadStartParams } from "../protocol-generated/v2/ThreadStartParams.ts";
import type { ThreadResumeParams } from "../protocol-generated/v2/ThreadResumeParams.ts";
import type { ThreadForkParams } from "../protocol-generated/v2/ThreadForkParams.ts";
import type { TurnStartParams } from "../protocol-generated/v2/TurnStartParams.ts";
import type { TurnInterruptParams } from "../protocol-generated/v2/TurnInterruptParams.ts";

export interface ProviderAdapter {
  readonly provider: string;
  connect(): Promise<Wire>;
  capabilities(): Promise<CapabilityReport>;
  newThread(params: ThreadStartParams): Promise<string>;
  resumeThread(params: ThreadResumeParams): Promise<string>;
  forkThread(params: ThreadForkParams): Promise<string>;
  readThread(threadId: string): Promise<Wire>;
  readItems(threadId: string, turnId?: string): Promise<Wire>;
  beginTurn(params: TurnStartParams): Promise<string>;
  interrupt(params: TurnInterruptParams): Promise<void>;
  close(): void;
}

export type EvidenceClass = "observed" | "inferred";
export interface EventEnvelope {
  schemaVersion: 1;
  eventId: string;
  sequence: number;
  provider: "codex-app-server";
  providerThreadId: string | null;
  providerTurnId: string | null;
  method: string;
  observedAt: string;
  observedAtSource: "bridge-clock";
  providerTime: number | null;
  providerTimeSource: string | null;
  evidence: EvidenceClass;
  terminalStatus: string | null;
  payload: Wire;
}

export interface CapabilityReport {
  provider: "codex-app-server";
  authentication: "available" | "required" | "unavailable";
  accountType: string | null;
  models: Array<{ id: string; displayName: string; hidden: boolean; entitlement: "unverified" }>;
  methods: string[];
  catalogOnly: true;
}

const methods = ["account/read", "model/list", "thread/start", "thread/resume", "thread/fork", "thread/read", "turn/start", "turn/interrupt"];
const approvals = new Set(["item/commandExecution/requestApproval", "item/fileChange/requestApproval"]);
const terminal = new Set(["turn/completed", "turn/failed"]);

export class CodexAdapter extends EventEmitter implements ProviderAdapter {
  readonly provider = "codex-app-server";
  private transport?: JsonlTransport;
  private sequence = 0;
  private droppedEvents = 0;
  private activeTurnId: string | null = null;
  private activeThreadId: string | null = null;
  private approvalHandler?: ServerRequestHandler;
  private readonly events: EventEnvelope[] = [];
  private readonly maxEvents = 512;
  private readonly executable: string;
  private readonly args: string[];
  constructor(executable = "codex", args = ["app-server", "--listen", "stdio://"]) { super(); this.executable = executable; this.args = args; }

  setServerRequestHandler(handler: ServerRequestHandler): void { this.approvalHandler = handler; }
  recentEvents(): readonly EventEnvelope[] { return this.events; }
  droppedEventCount(): number { return this.droppedEvents; }

  async connect(): Promise<Wire> {
    if (this.transport) throw new BridgeError("state", "Adapter already connected");
    const transport = new JsonlTransport(this.executable, this.args);
    this.transport = transport;
    transport.on("notification", (message: Wire) => this.record(message));
    transport.on("serverRequest", (message: Wire) => { void this.handleRequest(message); });
    transport.on("failure", (error: BridgeError) => {
      const expectedClose = error.kind === "closed";
      this.record({ method: expectedClose ? "bridge/closed" : "bridge/transportFailed", params: { kind: error.kind, message: error.message, threadId: this.activeThreadId, turnId: this.activeTurnId } }, expectedClose ? "observed" : "inferred");
      this.emit("failure", error);
      this.transport = undefined;
    });
    try { return await transport.start(); }
    catch (error) { this.transport = undefined; throw error; }
  }

  async reconnect(threadId: string): Promise<string> {
    if (this.transport) throw new BridgeError("state", "Disconnect before reconnecting");
    await this.connect();
    this.record({ method: "bridge/gap", params: { threadId, reason: "Transport reconnect; events during gap are unknown" } }, "inferred");
    return this.resumeThread({ threadId, excludeTurns: true });
  }

  async capabilities(): Promise<CapabilityReport> {
    const account = await this.rpc("account/read", { refreshToken: false });
    const accountValue = account.account && typeof account.account === "object" ? account.account as Wire : null;
    const models: CapabilityReport["models"] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const result = await this.rpc("model/list", cursor ? { cursor } : {});
      for (const raw of Array.isArray(result.data) ? result.data : []) {
        if (!raw || typeof raw !== "object") continue;
        const model = raw as Wire;
        if (typeof model.id === "string") models.push({ id: model.id, displayName: String(model.displayName ?? model.id), hidden: model.hidden === true, entitlement: "unverified" });
      }
      cursor = typeof result.nextCursor === "string" ? result.nextCursor : null;
      if (!cursor) break;
    }
    return { provider: "codex-app-server", authentication: accountValue ? "available" : account.requiresOpenaiAuth === true ? "required" : "unavailable", accountType: accountValue && typeof accountValue.type === "string" ? accountValue.type : null, models, methods, catalogOnly: true };
  }

  async newThread(params: ThreadStartParams): Promise<string> {
    const result = await this.rpc("thread/start", params as Wire);
    return this.threadId(result);
  }
  async resumeThread(params: ThreadResumeParams): Promise<string> {
    const result = await this.rpc("thread/resume", { ...params, excludeTurns: true });
    return this.threadId(result);
  }
  async forkThread(params: ThreadForkParams): Promise<string> {
    const result = await this.rpc("thread/fork", { ...params, excludeTurns: true });
    return this.threadId(result);
  }
  readThread(threadId: string): Promise<Wire> { return this.rpc("thread/read", { threadId, includeTurns: false }); }
  readItems(threadId: string, turnId?: string): Promise<Wire> { return this.rpc("thread/items/list", turnId ? { threadId, turnId, limit: 100 } : { threadId, limit: 100 }); }
  async beginTurn(params: TurnStartParams): Promise<string> {
    this.activeThreadId = params.threadId;
    let result: Wire;
    try { result = await this.rpc("turn/start", params as Wire, 30000); }
    catch (error) { this.activeThreadId = null; throw error; }
    const turn = result.turn as Wire | undefined;
    if (!turn || typeof turn.id !== "string") throw new BridgeError("protocol", "Missing turn id");
    this.activeTurnId = turn.id;
    return turn.id;
  }
  async interrupt(params: TurnInterruptParams): Promise<void> { await this.rpc("turn/interrupt", params as Wire); }
  close(): void { this.transport?.close(); this.transport = undefined; }

  waitForTerminal(threadId: string, turnId: string, timeoutMs = 90000): Promise<EventEnvelope> {
    const already = this.events.findLast(event => event.providerThreadId === threadId && event.providerTurnId === turnId && event.terminalStatus !== null);
    if (already) return Promise.resolve(already);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new BridgeError("timeout", "Turn terminal event not observed")); }, timeoutMs);
      const onEvent = (event: EventEnvelope) => { if (event.providerThreadId === threadId && event.providerTurnId === turnId && event.terminalStatus !== null) { cleanup(); resolve(event); } };
      const onFailure = (error: Error) => { cleanup(); reject(error); };
      const cleanup = () => { clearTimeout(timer); this.off("event", onEvent); this.off("failure", onFailure); };
      this.on("event", onEvent); this.on("failure", onFailure);
    });
  }

  private rpc(method: string, params: Wire, timeoutMs?: number): Promise<Wire> {
    if (!this.transport) return Promise.reject(new BridgeError("transport", "Not connected"));
    return this.transport.request(method, params, timeoutMs);
  }
  private threadId(result: Wire): string {
    const thread = result.thread as Wire | undefined;
    if (!thread || typeof thread.id !== "string") throw new BridgeError("protocol", "Missing thread id");
    return thread.id;
  }
  private async handleRequest(message: Wire): Promise<void> {
    const transport = this.transport;
    if (!transport) return;
    const method = String(message.method);
    try {
      // No approval is granted without an explicit caller-supplied handler.
      const response = this.approvalHandler ? await this.approvalHandler(message) : approvals.has(method) ? { decision: "decline" } : null;
      if (response === null) transport.respondError(message.id, -32601, "Unsupported server request");
      else transport.respond(message.id, response);
      this.record({ method: "bridge/serverRequestDecision", params: { requestId: message.id, requestMethod: method, decision: response && "decision" in response ? response.decision : "unsupported", threadId: (message.params as Wire | undefined)?.threadId ?? null, turnId: (message.params as Wire | undefined)?.turnId ?? null } });
    } catch { transport.respondError(message.id, -32603, "Handler failed"); }
  }
  private record(message: Wire, evidence: EvidenceClass = "observed"): void {
    const params = message.params && typeof message.params === "object" ? message.params as Wire : {};
    const turn = params.turn && typeof params.turn === "object" ? params.turn as Wire : null;
    const thread = params.thread && typeof params.thread === "object" ? params.thread as Wire : null;
    const method = String(message.method ?? "bridge/unknown");
    const providerThreadId = typeof params.threadId === "string" ? params.threadId : typeof thread?.id === "string" ? thread.id : null;
    const providerTurnId = typeof params.turnId === "string" ? params.turnId : typeof turn?.id === "string" ? turn.id : null;
    const providerTime = typeof turn?.completedAt === "number" ? turn.completedAt : typeof turn?.startedAt === "number" ? turn.startedAt : null;
    const status = terminal.has(method) && typeof turn?.status === "string" ? turn.status : null;
    const event: EventEnvelope = { schemaVersion: 1, eventId: randomUUID(), sequence: ++this.sequence, provider: "codex-app-server", providerThreadId, providerTurnId, method, observedAt: new Date().toISOString(), observedAtSource: "bridge-clock", providerTime, providerTimeSource: providerTime === null ? null : "turn.timestamp.unix-seconds", evidence, terminalStatus: status, payload: params };
    this.events.push(event);
    if (this.events.length > this.maxEvents) { this.events.shift(); this.droppedEvents++; }
    if (status && providerTurnId === this.activeTurnId) { this.activeTurnId = null; this.activeThreadId = null; }
    this.emit("event", event);
  }
}
