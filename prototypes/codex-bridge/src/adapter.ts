import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { BridgeError, JsonlTransport, type Wire, type ServerRequestHandler } from "./transport.ts";
import type { ThreadStartParams } from "../protocol-generated/v2/ThreadStartParams.ts";
import type { ThreadResumeParams } from "../protocol-generated/v2/ThreadResumeParams.ts";
import type { ThreadForkParams } from "../protocol-generated/v2/ThreadForkParams.ts";
import type { TurnStartParams } from "../protocol-generated/v2/TurnStartParams.ts";
import type { TurnInterruptParams } from "../protocol-generated/v2/TurnInterruptParams.ts";
import type { ThreadListParams } from "../protocol-generated/v2/ThreadListParams.ts";
import type { ThreadTurnsListParams } from "../protocol-generated/v2/ThreadTurnsListParams.ts";
import type { ThreadItemsListParams } from "../protocol-generated/v2/ThreadItemsListParams.ts";
import type { DynamicToolSpec } from "../protocol-generated/v2/DynamicToolSpec.ts";
import type { DynamicToolCallParams } from "../protocol-generated/v2/DynamicToolCallParams.ts";
import type { DynamicToolCallResponse } from "../protocol-generated/v2/DynamicToolCallResponse.ts";

export interface ProviderAdapter {
  readonly provider: string;
  connect(): Promise<Wire>;
  capabilities(): Promise<CapabilityReport>;
  newThread(params: ThreadStartParams): Promise<string>;
  resumeThread(params: ThreadResumeParams): Promise<string>;
  forkThread(params: ThreadForkParams): Promise<string>;
  readThread(threadId: string): Promise<Wire>;
  readItems(threadId: string, turnId?: string): Promise<NativePage>;
  beginTurn(params: TurnStartParams): Promise<string>;
  interrupt(params: TurnInterruptParams): Promise<void>;
  close(): void;
}

export interface NativeThreadSession {
  threadId: string;
  forkedFromId: string | null;
  ephemeral: boolean | null;
  cwd: string | null;
  model: string | null;
  modelProvider: string | null;
  serviceTier: string | null;
  reasoningEffort: string | null;
  approvalPolicy: string | Wire | null;
  instructionSources: string[] | null;
  /** Null means this installed server did not report the field. */
  metadataComplete: boolean;
}

export interface NativePage<T extends Wire = Wire> {
  data: T[];
  nextCursor: string | null;
  backwardsCursor: string | null;
}

export interface NativeEnvironmentSnapshot {
  config: { status: "discovered" | "unavailable"; model: string | null; modelProvider: string | null; reasoningEffort: string | null; sandboxMode: string | null; approvalPolicy: string | Wire | null; profile: string | null; memoriesFeature: boolean | null; useMemories: boolean | null };
  skills: { status: "discovered" | "unavailable"; count: number | null; errorCount: number | null };
  mcp: { status: "discovered" | "unavailable"; count: number | null; nextCursor: string | null };
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
  /** Implemented RPC wrappers; individual method support is verified per call. */
  adapterMethods: string[];
  /** @deprecated Compatibility alias for adapterMethods; not a server capability probe. */
  methods: string[];
  catalogOnly: true;
}

const methods = ["account/read", "model/list", "thread/start", "thread/resume", "thread/fork", "thread/read", "thread/list", "thread/turns/list", "thread/items/list", "turn/start", "turn/interrupt"];
const allThreadSources = ["cli", "vscode", "exec", "appServer", "subAgent", "subAgentReview", "subAgentCompact", "subAgentThreadSpawn", "subAgentOther", "unknown"] as const;
const approvals = new Set(["item/commandExecution/requestApproval", "item/fileChange/requestApproval"]);
const terminal = new Set(["turn/completed", "turn/failed"]);

export class CodexAdapter extends EventEmitter implements ProviderAdapter {
  readonly provider = "codex-app-server";
  private transport?: JsonlTransport;
  private sequence = 0;
  private droppedEvents = 0;
  private readonly activeTurns = new Map<string, string>();
  private approvalHandler?: ServerRequestHandler;
  private readonly events: EventEnvelope[] = [];
  private readonly maxEvents = 512;
  private readonly executable: string;
  private readonly args: string[];
  private readonly experimentalApi:boolean;
  private dynamicToolHandler?: (call:DynamicToolCallParams)=>Promise<DynamicToolCallResponse>;
  constructor(executable = "codex", args = ["app-server", "--listen", "stdio://"],options:{experimentalApi?:boolean}={}) { super(); this.executable = executable; this.args = args; this.experimentalApi=options.experimentalApi===true; }

  setServerRequestHandler(handler: ServerRequestHandler): void { this.approvalHandler = handler; }
  setDynamicToolHandler(handler:(call:DynamicToolCallParams)=>Promise<DynamicToolCallResponse>):void { this.dynamicToolHandler=handler; }
  recentEvents(): readonly EventEnvelope[] { return this.events; }
  droppedEventCount(): number { return this.droppedEvents; }

  async connect(): Promise<Wire> {
    if (this.transport) throw new BridgeError("state", "Adapter already connected");
    const transport = new JsonlTransport(this.executable, this.args,{experimentalApi:this.experimentalApi});
    this.transport = transport;
    transport.on("notification", (message: Wire) => this.record(message));
    transport.on("serverRequest", (message: Wire) => { void this.handleRequest(message); });
    transport.on("failure", (error: BridgeError) => {
      const expectedClose = error.kind === "closed";
      this.record({ method: expectedClose ? "bridge/closed" : "bridge/transportFailed", params: { kind: error.kind, message: error.message } }, expectedClose ? "observed" : "inferred");
      if (!expectedClose) for (const [turnId, threadId] of this.activeTurns) {
        this.record({ method: "bridge/gap", params: { threadId, turnId, reason: "Transport failed; turn outcome is unknown" } }, "inferred");
      }
      this.activeTurns.clear();
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
    return { provider: "codex-app-server", authentication: accountValue ? "available" : account.requiresOpenaiAuth === true ? "required" : "unavailable", accountType: accountValue && typeof accountValue.type === "string" ? accountValue.type : null, models, adapterMethods: methods, methods, catalogOnly: true };
  }

  async newThread(params: ThreadStartParams): Promise<string> {
    return (await this.startThread(params)).threadId;
  }
  async resumeThread(params: ThreadResumeParams): Promise<string> {
    return (await this.resumeThreadSession(params)).threadId;
  }
  async forkThread(params: ThreadForkParams): Promise<string> {
    return (await this.forkThreadSession(params)).threadId;
  }
  async startThread(params: ThreadStartParams = {}): Promise<NativeThreadSession> {
    return this.session(await this.rpc("thread/start", params as Wire));
  }
  /** Installed 0.153.3 experimental ThreadStartParams.dynamicTools; stable callers remain unchanged. */
  async startDynamicToolThread(params:ThreadStartParams,tool:DynamicToolSpec):Promise<string> {
    if(!this.experimentalApi||!this.dynamicToolHandler)throw new BridgeError('unsupported','Dynamic tool discovery is not enabled');
    return this.session(await this.rpc('thread/start',{...params,dynamicTools:[tool]})).threadId;
  }
  async resumeThreadSession(params: ThreadResumeParams): Promise<NativeThreadSession> {
    return this.session(await this.rpc("thread/resume", { ...params, excludeTurns: true }));
  }
  async forkThreadSession(params: ThreadForkParams): Promise<NativeThreadSession> {
    return this.session(await this.rpc("thread/fork", { ...params, excludeTurns: true }));
  }
  async listThreads(params: ThreadListParams = {}): Promise<NativePage> {
    // App Server defaults to CLI/VS Code only when sourceKinds is omitted.
    const request = { ...params, sourceKinds: params.sourceKinds?.length ? params.sourceKinds : [...allThreadSources] };
    const page = this.page(await this.rpc("thread/list", request));
    if (!page.data.every(thread => typeof thread.id === "string" && thread.id.length > 0)) throw new BridgeError("protocol", "Invalid thread listing identity");
    return page;
  }
  async listTurns(params: ThreadTurnsListParams): Promise<NativePage> {
    const page = this.page(await this.rpc("thread/turns/list", params as Wire));
    if (!page.data.every(turn => typeof turn.id === "string" && turn.id.length > 0)) throw new BridgeError("protocol", "Invalid turn listing identity");
    return page;
  }
  async listItems(params: ThreadItemsListParams): Promise<NativePage> {
    const page = this.page(await this.rpc("thread/items/list", params as Wire));
    if (!page.data.every(entry => typeof entry.turnId === "string" && entry.item && typeof entry.item === "object" && !Array.isArray(entry.item))) throw new BridgeError("protocol", "Invalid item listing identity");
    return page;
  }
  async inspectEnvironment(cwd: string): Promise<NativeEnvironmentSnapshot> {
    // Do not return config/read wholesale: it can contain private instructions and MCP settings.
    const config: NativeEnvironmentSnapshot["config"] = { status: "unavailable", model: null, modelProvider: null, reasoningEffort: null, sandboxMode: null, approvalPolicy: null, profile: null, memoriesFeature: null, useMemories: null };
    const skills: NativeEnvironmentSnapshot["skills"] = { status: "unavailable", count: null, errorCount: null };
    const mcp: NativeEnvironmentSnapshot["mcp"] = { status: "unavailable", count: null, nextCursor: null };
    try {
      const result = await this.rpc("config/read", { includeLayers: false });
      const value = result.config as Wire | undefined;
      if (value && typeof value === "object" && !Array.isArray(value)) {
        config.status = "discovered";
        config.model = typeof value.model === "string" ? value.model : null;
        config.modelProvider = typeof value.model_provider === "string" ? value.model_provider : null;
        config.reasoningEffort = typeof value.model_reasoning_effort === "string" ? value.model_reasoning_effort : null;
        config.sandboxMode = typeof value.sandbox_mode === "string" ? value.sandbox_mode : null;
        config.approvalPolicy = typeof value.approval_policy === "string" || (value.approval_policy && typeof value.approval_policy === "object" && !Array.isArray(value.approval_policy)) ? value.approval_policy as string | Wire : null;
        config.profile = typeof value.profile === "string" ? value.profile : null;
        const features = value.features as Wire | undefined;
        const memories = value.memories as Wire | undefined;
        config.memoriesFeature = typeof features?.memories === "boolean" ? features.memories : null;
        config.useMemories = typeof memories?.use_memories === "boolean" ? memories.use_memories : null;
      }
    } catch { /* Unknown or unsupported is not an enabled capability. */ }
    try {
      const result = await this.rpc("skills/list", { cwds: [cwd], forceReload: false });
      const entry = Array.isArray(result.data) ? result.data.find(item => item && typeof item === "object" && (item as Wire).cwd === cwd) as Wire | undefined : undefined;
      if (entry && Array.isArray(entry.skills) && Array.isArray(entry.errors)) {
        skills.status = "discovered";
        skills.count = entry.skills.length;
        skills.errorCount = entry.errors.length;
      }
    } catch { /* Keep unavailable. */ }
    try {
      const result = await this.rpc("mcpServerStatus/list", { limit: 100, detail: "toolsAndAuthOnly" });
      if (Array.isArray(result.data)) {
        mcp.status = "discovered";
        mcp.count = result.data.length;
        mcp.nextCursor = typeof result.nextCursor === "string" ? result.nextCursor : null;
      }
    } catch { /* Keep unavailable. */ }
    return { config, skills, mcp };
  }
  async readThread(threadId: string): Promise<Wire> {
    const result = await this.rpc("thread/read", { threadId, includeTurns: false });
    const thread = result.thread as Wire | undefined;
    if (!thread || typeof thread !== "object" || thread.id !== threadId) throw new BridgeError("protocol", "Thread read identity mismatch");
    return result;
  }
  readItems(threadId: string, turnId?: string): Promise<NativePage> { return this.listItems(turnId ? { threadId, turnId, limit: 100 } : { threadId, limit: 100 }); }
  async beginTurn(params: TurnStartParams): Promise<string> {
    let result: Wire;
    try { result = await this.rpc("turn/start", params as Wire, 30000); }
    catch (error) {
      if (error instanceof BridgeError && ["timeout", "transport", "process-exit"].includes(error.kind)) {
        this.record({ method: "bridge/gap", params: { threadId: params.threadId, reason: "Turn start outcome is unknown" } }, "inferred");
      }
      throw error;
    }
    const turn = result.turn as Wire | undefined;
    if (!turn || typeof turn.id !== "string") throw new BridgeError("protocol", "Missing turn id");
    if (!this.events.some(event => event.providerThreadId === params.threadId && event.providerTurnId === turn.id && event.terminalStatus !== null)) {
      this.activeTurns.set(turn.id, params.threadId);
    }
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
  private session(result: Wire): NativeThreadSession {
    const thread = result.thread;
    if (!thread || typeof thread !== "object" || Array.isArray(thread) || typeof (thread as Wire).id !== "string" || !(thread as Wire).id) {
      throw new BridgeError("protocol", "Missing thread id");
    }
    const value = thread as Wire;
    const sources = result.instructionSources;
    if (sources !== undefined && (!Array.isArray(sources) || !sources.every(item => typeof item === "string"))) {
      throw new BridgeError("protocol", "Invalid instructionSources");
    }
    const optionalString = (field: unknown): string | null => typeof field === "string" ? field : null;
    return {
      threadId: value.id as string,
      forkedFromId: optionalString(value.forkedFromId),
      ephemeral: typeof value.ephemeral === "boolean" ? value.ephemeral : null,
      cwd: optionalString(result.cwd),
      model: optionalString(result.model),
      modelProvider: optionalString(result.modelProvider),
      serviceTier: optionalString(result.serviceTier),
      reasoningEffort: optionalString(result.reasoningEffort),
      approvalPolicy: typeof result.approvalPolicy === "string" || (result.approvalPolicy && typeof result.approvalPolicy === "object" && !Array.isArray(result.approvalPolicy)) ? result.approvalPolicy as string | Wire : null,
      instructionSources: Array.isArray(sources) ? [...sources] : null,
      metadataComplete: typeof result.cwd === "string" && typeof result.model === "string" && typeof result.modelProvider === "string" && Array.isArray(sources)
    };
  }
  private page(result: Wire): NativePage {
    if (!Array.isArray(result.data) || !result.data.every(item => item && typeof item === "object" && !Array.isArray(item))) {
      throw new BridgeError("protocol", "Invalid paginated history data");
    }
    if (result.nextCursor !== null && result.nextCursor !== undefined && typeof result.nextCursor !== "string") {
      throw new BridgeError("protocol", "Invalid pagination cursor");
    }
    if (result.backwardsCursor !== null && result.backwardsCursor !== undefined && typeof result.backwardsCursor !== "string") {
      throw new BridgeError("protocol", "Invalid backwards cursor");
    }
    return { data: result.data as Wire[], nextCursor: result.nextCursor as string | null ?? null, backwardsCursor: result.backwardsCursor as string | null ?? null };
  }
  private async handleRequest(message: Wire): Promise<void> {
    const transport = this.transport;
    if (!transport) return;
    const method = String(message.method);
    try {
      if(method==='item/tool/call'&&this.experimentalApi&&this.dynamicToolHandler) {
        const params=message.params as DynamicToolCallParams;
        if(!params||typeof params.threadId!=='string'||typeof params.turnId!=='string'||typeof params.callId!=='string'||typeof params.tool!=='string'||!(params.namespace===null||typeof params.namespace==='string')||!Object.hasOwn(params,'arguments')){transport.respondError(message.id,-32602,'Invalid dynamic tool request');return;}
        const response=await this.dynamicToolHandler(params);
        transport.respond(message.id,response as unknown as Wire);
        this.record({method:'bridge/dynamicToolResponse',params:{threadId:params.threadId,turnId:params.turnId,callId:params.callId,success:response.success}});return;
      }
      // No approval is granted without an explicit caller-supplied handler.
      let response = this.approvalHandler ? await this.approvalHandler(message) : approvals.has(method) ? { decision: "decline" } : null;
      if (approvals.has(method) && (!response || !["decline", "cancel", "accept", "acceptForSession"].includes(String(response.decision)))) {
        response = { decision: "decline" };
      }
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
    if (status && providerTurnId) this.activeTurns.delete(providerTurnId);
    this.emit("event", event);
  }
}
