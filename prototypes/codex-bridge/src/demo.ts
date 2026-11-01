import { CodexAdapter, type EventEnvelope } from "./adapter.ts";
import { BridgeError } from "./transport.ts";

const mode = process.argv[2] ?? "capabilities";
const adapter = new CodexAdapter();
const summary = (event: EventEnvelope) => ({ method: event.method, threadId: event.providerThreadId, turnId: event.providerTurnId, status: event.terminalStatus, evidence: event.evidence, timeSource: event.providerTimeSource ?? event.observedAtSource });
try {
  const initialized = await adapter.connect();
  console.log(JSON.stringify({ connected: true, platformFamily: initialized.platformFamily ?? null, platformOs: initialized.platformOs ?? null }));
  const capabilities = await adapter.capabilities();
  console.log(JSON.stringify(capabilities));
  if (mode === "inspect") {
    const threadId = process.argv[3];
    const turnId = process.argv[4];
    if (!threadId || !turnId) throw new Error("Usage: npm run demo -- inspect THREAD_ID TURN_ID");
    const result = await adapter.readItems(threadId, turnId);
    const items = Array.isArray(result.data) ? result.data : [];
    const text = items.flatMap(entry => {
      if (!entry || typeof entry !== "object") return [];
      const item = (entry as { item?: { type?: string; text?: string } }).item;
      return item?.type === "agentMessage" && typeof item.text === "string" ? [item.text] : [];
    }).join("\n");
    console.log(JSON.stringify({ inspected: true, itemCount: items.length, exactReply: text.trim() === "BRIDGE_OK" }));
  } else if (mode === "live") {
    if (capabilities.authentication !== "available") throw new BridgeError("auth-required", "Existing Codex authentication unavailable");
    let assistantText = "";
    adapter.on("event", (event: EventEnvelope) => {
      if (event.method === "item/agentMessage/delta" && typeof event.payload.delta === "string") assistantText += event.payload.delta;
      if (event.method.startsWith("turn/") || event.method.startsWith("item/") || event.method.startsWith("bridge/")) console.log(JSON.stringify(summary(event)));
    });
    // Scope the real turn to a harmless, read-only answer. Model selection is left
    // to the installed CLI; model/list is discovery, not entitlement proof.
    const threadId = await adapter.newThread({ cwd: process.cwd(), approvalPolicy: "never", sandbox: "read-only", serviceName: "aetherwake_codex_bridge_prototype" });
    const turnId = await adapter.beginTurn({ threadId, input: [{ type: "text", text: "Reply with exactly BRIDGE_OK. Do not use tools or inspect files.", text_elements: [] }] });
    const terminal = await adapter.waitForTerminal(threadId, turnId, 90000);
    const exactReply = assistantText.trim() === "BRIDGE_OK";
    console.log(JSON.stringify({ outcome: terminal.terminalStatus, threadId, turnId, observed: true, exactReply, droppedEvents: adapter.droppedEventCount() }));
    if (terminal.terminalStatus !== "completed" || !exactReply) process.exitCode = 2;
  } else if (mode !== "capabilities") throw new Error("Usage: npm run demo -- [capabilities|live|inspect]");
} catch (error) {
  const safe = error instanceof BridgeError ? { kind: error.kind, code: error.code ?? null } : { kind: "unexpected" };
  console.error(JSON.stringify({ error: safe }));
  process.exitCode = 1;
} finally { adapter.close(); }
