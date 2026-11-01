import { CodexAdapter, type EventEnvelope } from "./adapter.ts";
import { BridgeError } from "./transport.ts";
import { mkdtempSync, mkdirSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

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
  } else if (mode === "parity") {
    if (capabilities.authentication !== "available") throw new BridgeError("auth-required", "Existing Codex authentication unavailable");
    const cwd = process.cwd();
    const environment = await adapter.inspectEnvironment(cwd);
    const model = environment.config.model;
    if (!model) throw new BridgeError("capability", "Configured model unavailable");
    const prompt = "Reply with exactly FIDELITY_OK. Do not use tools or inspect files.";
    const args = ["exec", "--ephemeral", "--json", "--model", model, "--sandbox", "read-only", "--cd", cwd, "-c", 'approval_policy="never"', prompt];
    const cli = await new Promise<{ exitCode: number | null; types: string[]; exactReply: boolean }>((done, fail) => {
      const child = spawn("codex", args, { cwd, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
      let stdout = "";
      child.on("error", fail);
      child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); if (stdout.length > 2_000_000) child.kill(); });
      child.on("exit", code => {
        const events = stdout.split(/\r?\n/).filter(Boolean).flatMap(line => { try { return [JSON.parse(line) as { type?: string; item?: { type?: string; text?: string } }]; } catch { return []; } });
        done({ exitCode: code, types: [...new Set(events.map(event => event.type).filter((value): value is string => typeof value === "string"))], exactReply: events.some(event => event.type === "item.completed" && event.item?.type === "agent_message" && event.item.text?.trim() === "FIDELITY_OK") });
      });
    });
    const started = await adapter.startThread({ cwd, model, approvalPolicy: "never", sandbox: "read-only", ephemeral: true });
    let answer = "";
    adapter.on("event", (event: EventEnvelope) => { if (event.method === "item/agentMessage/delta" && typeof event.payload.delta === "string") answer += event.payload.delta; });
    const turnId = await adapter.beginTurn({ threadId: started.threadId, input: [{ type: "text", text: prompt, text_elements: [] }] });
    const terminal = await adapter.waitForTerminal(started.threadId, turnId, 90000);
    console.log(JSON.stringify({ parity: true, model, cwdMatches: started.cwd === cwd, approvalPolicy: started.approvalPolicy, cli: { exitCode: cli.exitCode, lifecycleTypes: cli.types, exactReply: cli.exactReply }, bridge: { outcome: terminal.terminalStatus, exactReply: answer.trim() === "FIDELITY_OK", instructionSourceCount: started.instructionSources?.length ?? null }, sameTaskAndPolicy: true, cliInstructionSourcesExposedInJson: false }));
    if (cli.exitCode !== 0 || !cli.exactReply || terminal.terminalStatus !== "completed" || answer.trim() !== "FIDELITY_OK") process.exitCode = 2;
  } else if (mode === "instructions") {
    const scratch = mkdtempSync(join(tmpdir(), "aetherwake-instructions-"));
    const nested = join(scratch, "nested");
    mkdirSync(nested);
    mkdirSync(join(scratch, ".git"));
    const parentFile = join(scratch, "AGENTS.md");
    const nestedFile = join(nested, "AGENTS.md");
    writeFileSync(parentFile, "# Synthetic parent instruction fixture\n", "utf8");
    writeFileSync(nestedFile, "# Synthetic nested instruction fixture\n", "utf8");
    try {
      const repo = await adapter.startThread({ cwd: process.cwd(), ephemeral: true, approvalPolicy: "never", sandbox: "read-only" });
      const parent = await adapter.startThread({ cwd: scratch, ephemeral: true, approvalPolicy: "never", sandbox: "read-only" });
      const child = await adapter.startThread({ cwd: nested, ephemeral: true, approvalPolicy: "never", sandbox: "read-only" });
      const includes = (sources: string[] | null, path: string) => sources?.some(source => source.toLowerCase() === resolve(path).toLowerCase()) ?? false;
      const globalOverlap = (repo.instructionSources ?? []).filter(source => (parent.instructionSources ?? []).some(other => other.toLowerCase() === source.toLowerCase()));
      console.log(JSON.stringify({ instructionAudit: true, repoSourceCount: repo.instructionSources?.length ?? null, parentSourceCount: parent.instructionSources?.length ?? null, nestedSourceCount: child.instructionSources?.length ?? null, globalSharedCount: globalOverlap.length, repoAgentsObserved: includes(repo.instructionSources, join(process.cwd(), "..", "..", "AGENTS.md")), parentAgentsObserved: includes(parent.instructionSources, parentFile), nestedAgentsObserved: includes(child.instructionSources, nestedFile), parentInheritedByNested: includes(child.instructionSources, parentFile), cwdMatches: repo.cwd === process.cwd() && parent.cwd === scratch && child.cwd === nested, allEphemeral: repo.ephemeral === true && parent.ephemeral === true && child.ephemeral === true }));
    } finally {
      adapter.close();
      await new Promise(resolve => setTimeout(resolve, 200));
      if (!resolve(scratch).toLowerCase().startsWith((resolve(tmpdir()) + "\\").toLowerCase())) throw new Error("Scratch cleanup path failed validation");
      unlinkSync(nestedFile); unlinkSync(parentFile); rmdirSync(nested); rmdirSync(join(scratch, ".git")); rmdirSync(scratch);
    }
  } else if (mode === "audit") {
    if (capabilities.authentication !== "available") throw new BridgeError("auth-required", "Existing Codex authentication unavailable");
    const cwd = process.cwd();
    const environment = await adapter.inspectEnvironment(cwd);
    const existing = await adapter.listThreads({ limit: 3 });
    const started = await adapter.startThread({ cwd, approvalPolicy: "never", sandbox: "read-only", serviceName: "aetherwake_native_fidelity_audit" });
    let assistantText = "";
    adapter.on("event", (event: EventEnvelope) => {
      if (event.method === "item/agentMessage/delta" && typeof event.payload.delta === "string") assistantText += event.payload.delta;
    });
    const turnId = await adapter.beginTurn({ threadId: started.threadId, input: [{ type: "text", text: "Reply with exactly FIDELITY_OK. Do not use tools or inspect files.", text_elements: [] }] });
    const outcome = await adapter.waitForTerminal(started.threadId, turnId, 90000);
    const turns = await adapter.listTurns({ threadId: started.threadId, limit: 5, itemsView: "notLoaded" });
    const items = await adapter.listItems({ threadId: started.threadId, turnId, limit: 10 });
    const resumed = await adapter.resumeThreadSession({ threadId: started.threadId });
    const forked = await adapter.forkThreadSession({ threadId: started.threadId, lastTurnId: turnId });
    const forkRead = await adapter.readThread(forked.threadId);
    console.log(JSON.stringify({ audit: true, existingPageCount: existing.data.length, existingHasCursor: existing.nextCursor !== null, environment, started: { metadataComplete: started.metadataComplete, instructionSourceCount: started.instructionSources?.length ?? null, model: started.model, modelProvider: started.modelProvider, reasoningEffort: started.reasoningEffort, cwdMatches: started.cwd === cwd, approvalPolicy: started.approvalPolicy }, turn: { outcome: outcome.terminalStatus, exactReply: assistantText.trim() === "FIDELITY_OK", inHistory: turns.data.some(turn => turn.id === turnId), itemCount: items.data.length }, resumed: { sameId: resumed.threadId === started.threadId, cwdMatches: resumed.cwd === started.cwd, modelMatches: resumed.model === started.model, instructionSourcesMatch: JSON.stringify(resumed.instructionSources) === JSON.stringify(started.instructionSources) }, forked: { distinctId: forked.threadId !== started.threadId, ancestryMatches: forked.forkedFromId === started.threadId, readable: (forkRead.thread as { id?: string } | undefined)?.id === forked.threadId } }));
    if (outcome.terminalStatus !== "completed" || assistantText.trim() !== "FIDELITY_OK") process.exitCode = 2;
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
  } else if (mode !== "capabilities") throw new Error("Usage: npm run demo -- [capabilities|instructions|audit|parity|live|inspect]");
} catch (error) {
  const safe = error instanceof BridgeError ? { kind: error.kind, code: error.code ?? null } : { kind: "unexpected" };
  console.error(JSON.stringify({ error: safe }));
  process.exitCode = 1;
} finally { adapter.close(); }
