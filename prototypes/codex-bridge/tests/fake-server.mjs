import { createInterface } from "node:readline";
const mode = process.argv[2] ?? "normal";
const lines = createInterface({ input: process.stdin });
const send = message => process.stdout.write(JSON.stringify(message) + "\n");
let initialized = false;
lines.on("line", line => {
  const message = JSON.parse(line);
  if (message.method === "initialize") { send({ id: message.id, result: { platformFamily: "test" } }); return; }
  if (message.method === "initialized") { initialized = true; return; }
  if (!initialized || typeof message.id !== "number") return;
  if (message.method === "account/read") { send({ id: message.id, result: { account: mode === "no-auth" ? null : { type: "chatgpt" }, requiresOpenaiAuth: true } }); return; }
  if (message.method === "model/list") { send({ id: message.id, result: { data: [{ id: "fixture-model", displayName: "Fixture", hidden: false }], nextCursor: null } }); return; }
  if (message.method === "thread/start") { send({ id: message.id, result: { thread: { id: "fixture-thread" } } }); return; }
  if (message.method === "thread/resume" || message.method === "thread/fork" || message.method === "thread/read") { send({ id: message.id, result: { thread: { id: mode === "fork" ? "fixture-fork" : "fixture-thread" } } }); return; }
  if (message.method === "thread/items/list") { send({ id: message.id, result: { data: [{ item: { type: "agentMessage", text: "BRIDGE_OK" } }], nextCursor: null } }); return; }
  if (message.method === "turn/start") {
    if (mode === "invalid") { send({ id: message.id, error: { code: -32602, message: "Invalid params" } }); return; }
    if (mode === "rate-limit") { send({ id: message.id, error: { code: 429, message: "Rate limit exceeded" } }); return; }
    if (mode === "unavailable-model") { send({ id: message.id, error: { code: -32000, message: "Model unavailable" } }); return; }
    send({ id: message.id, result: { turn: { id: "fixture-turn" } } });
    send({ method: "turn/started", params: { threadId: "fixture-thread", turn: { id: "fixture-turn", status: "inProgress", startedAt: 123 } } });
    if (mode === "approval" || mode === "cancel") send({ id: 88, method: "item/commandExecution/requestApproval", params: { threadId: "fixture-thread", turnId: "fixture-turn", command: "echo harmless" } });
    else if (mode === "file-approval") send({ id: 88, method: "item/fileChange/requestApproval", params: { threadId: "fixture-thread", turnId: "fixture-turn", reason: "fixture" } });
    else if (mode === "crash") process.exit(19);
    else if (mode === "interrupted-stream") process.exit(0);
    else if (mode === "wait-interrupt") return;
    else send({ method: "turn/completed", params: { threadId: "fixture-thread", turn: { id: "fixture-turn", status: "completed", completedAt: 124 } } });
    return;
  }
  if (message.id === 88) {
    if (mode === "cancel" && message.result?.decision !== "cancel") process.exit(21);
    if ((mode === "approval" || mode === "file-approval") && message.result?.decision !== "decline") process.exit(22);
    send({ method: "serverRequest/resolved", params: { threadId: "fixture-thread", requestId: 88 } });
    send({ method: "turn/completed", params: { threadId: "fixture-thread", turn: { id: "fixture-turn", status: "interrupted", completedAt: 124 } } });
    return;
  }
  if (message.method === "turn/interrupt") { send({ id: message.id, result: {} }); send({ method: "turn/completed", params: { threadId: "fixture-thread", turn: { id: "fixture-turn", status: "interrupted" } } }); }
});
