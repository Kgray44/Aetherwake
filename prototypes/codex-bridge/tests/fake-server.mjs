import { createInterface } from "node:readline";
const mode = process.argv[2] ?? "normal";
const lines = createInterface({ input: process.stdin });
const send = message => process.stdout.write(JSON.stringify(message) + "\n");
let initialized = false;
let currentModel = "fixture-model";
const session = (id = "fixture-thread", overrides = {}) => ({ thread: { id, forkedFromId: id === "fixture-fork" ? "fixture-thread" : null, ephemeral: false }, cwd: "C:\\fixture", model: currentModel, modelProvider: "openai", serviceTier: null, reasoningEffort: "medium", approvalPolicy: "never", instructionSources: mode === "missing-instructions" ? [] : ["C:\\fixture\\AGENTS.md"], ...overrides });
lines.on("line", line => {
  const message = JSON.parse(line);
  if (message.method === "initialize") { send({ id: message.id, result: { platformFamily: "test" } }); return; }
  if (message.method === "initialized") { initialized = true; return; }
  if (!initialized || typeof message.id !== "number") return;
  if (message.method === "account/read") { send({ id: message.id, result: { account: mode === "no-auth" ? null : { type: "chatgpt" }, requiresOpenaiAuth: true } }); return; }
  if (message.method === "model/list") { send({ id: message.id, result: { data: [{ id: "fixture-model", displayName: "Fixture", hidden: false }], nextCursor: null } }); return; }
  if (message.method === "config/read") { send({ id: message.id, result: { config: { model: "fixture-model", model_provider: "openai", model_reasoning_effort: "medium", sandbox_mode: "read-only", approval_policy: "never", features: { memories: mode !== "no-memory" }, memories: { use_memories: mode !== "no-memory" }, instructions: "PRIVATE_FIXTURE_INSTRUCTION" } } }); return; }
  if (message.method === "skills/list") { send({ id: message.id, result: { data: [{ cwd: message.params.cwds[0], skills: [{ name: "fixture-skill" }], errors: [] }] } }); return; }
  if (message.method === "mcpServerStatus/list") { send({ id: message.id, result: { data: [{ name: "fixture-mcp" }], nextCursor: null } }); return; }
  if (message.method === "thread/start") { currentModel = message.params.model ?? currentModel; send({ id: message.id, result: session("fixture-thread", { cwd: message.params.cwd ?? "C:\\fixture", instructionSources: mode === "version-mismatch" ? { invalid: true } : mode === "unknown-source-field" ? undefined : mode === "missing-instructions" ? [] : ["C:\\fixture\\AGENTS.md"] }) }); return; }
  if (message.method === "thread/resume") { send({ id: message.id, result: session("fixture-thread") }); return; }
  if (message.method === "thread/fork") { if (mode === "unsupported-fork") send({ id: message.id, error: { code: -32601, message: "Method not found" } }); else send({ id: message.id, result: session("fixture-fork") }); return; }
  if (message.method === "thread/read") { if (mode === "missing-history") send({ id: message.id, error: { code: -32000, message: "Thread not found" } }); else send({ id: message.id, result: { thread: { id: message.params.threadId, cwd: "C:\\fixture", turns: [] } } }); return; }
  if (message.method === "thread/list") { send({ id: message.id, result: { data: [{ id: "fixture-thread", cwd: "C:\\fixture", ephemeral: false, status: { type: "notLoaded" } }], nextCursor: message.params.cursor ? null : "page-2", backwardsCursor: null, receivedSourceKinds: message.params.sourceKinds } }); return; }
  if (message.method === "thread/turns/list") { send({ id: message.id, result: { data: [{ id: "fixture-turn", status: "completed" }], nextCursor: null, backwardsCursor: null } }); return; }
  if (message.method === "thread/items/list") { send({ id: message.id, result: { data: [{ turnId: "fixture-turn", item: { type: "agentMessage", text: "BRIDGE_OK" } }], nextCursor: null, backwardsCursor: null } }); return; }
  if (message.method === "turn/start") {
    if (mode === "invalid") { send({ id: message.id, error: { code: -32602, message: "Invalid params" } }); return; }
    if (mode === "rate-limit") { send({ id: message.id, error: { code: 429, message: "Rate limit exceeded" } }); return; }
    if (mode === "unavailable-model") { send({ id: message.id, error: { code: -32000, message: "Model unavailable" } }); return; }
    send({ id: message.id, result: { turn: { id: "fixture-turn" } } });
    send({ method: "turn/started", params: { threadId: "fixture-thread", turn: { id: "fixture-turn", status: "inProgress", startedAt: 123 } } });
    if (mode === "approval" || mode === "explicit-denial" || mode === "cancel") send({ id: 88, method: "item/commandExecution/requestApproval", params: { threadId: "fixture-thread", turnId: "fixture-turn", command: "echo harmless" } });
    else if (mode === "file-approval") send({ id: 88, method: "item/fileChange/requestApproval", params: { threadId: "fixture-thread", turnId: "fixture-turn", reason: "fixture" } });
    else if (mode === "crash") process.exit(19);
    else if (mode === "interrupted-stream") process.exit(0);
    else if (mode === "wait-interrupt") return;
    else send({ method: "turn/completed", params: { threadId: "fixture-thread", turn: { id: "fixture-turn", status: "completed", completedAt: 124 } } });
    return;
  }
  if (message.id === 88) {
    if (mode === "cancel" && message.result?.decision !== "cancel") process.exit(21);
    if ((mode === "approval" || mode === "explicit-denial" || mode === "file-approval") && message.result?.decision !== "decline") process.exit(22);
    send({ method: "serverRequest/resolved", params: { threadId: "fixture-thread", requestId: 88 } });
    send({ method: "turn/completed", params: { threadId: "fixture-thread", turn: { id: "fixture-turn", status: "interrupted", completedAt: 124 } } });
    return;
  }
  if (message.method === "turn/interrupt") { send({ id: message.id, result: {} }); send({ method: "turn/completed", params: { threadId: "fixture-thread", turn: { id: "fixture-turn", status: "interrupted" } } }); }
});
