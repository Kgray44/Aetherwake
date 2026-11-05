import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { CodexAdapter } from "../src/adapter.ts";
import { BridgeError } from "../src/transport.ts";

const fake = fileURLToPath(new URL("./fake-server.mjs", import.meta.url));
const make = (mode = "normal") => new CodexAdapter(process.execPath, [fake, mode]);
const input = [{ type: "text" as const, text: "fixture", text_elements: [] }];

test("handshake, catalog labels, native lifecycle, and terminal provenance", async () => {
  const adapter = make();
  try {
    await adapter.connect();
    const report = await adapter.capabilities();
    assert.equal(report.authentication, "available");
    assert.equal(report.models[0]?.entitlement, "unverified");
    assert.deepEqual(report.methods, report.adapterMethods);
    const threadId = await adapter.newThread({});
    assert.equal(await adapter.resumeThread({ threadId }), threadId);
    assert.equal(await adapter.forkThread({ threadId }), "fixture-fork");
    assert.equal(((await adapter.readThread(threadId)).thread as { id: string }).id, threadId);
    assert.equal((await adapter.readItems(threadId)).data instanceof Array, true);
    const turnId = await adapter.beginTurn({ threadId, input });
    const event = await adapter.waitForTerminal(threadId, turnId);
    assert.equal(event.terminalStatus, "completed");
    assert.equal(event.evidence, "observed");
    assert.equal(event.providerTimeSource, "turn.timestamp.unix-seconds");
  } finally { adapter.close(); }
});

test("authentication absence and invalid request stay explicit", async () => {
  const noAuth = make("no-auth");
  try { await noAuth.connect(); assert.equal((await noAuth.capabilities()).authentication, "required"); }
  finally { noAuth.close(); }
  const invalid = make("invalid");
  try {
    await invalid.connect();
    await assert.rejects(invalid.beginTurn({ threadId: "fixture-thread", input }), (e: unknown) => e instanceof BridgeError && e.kind === "rpc" && e.code === -32602);
  } finally { invalid.close(); }
});

test("rate limit and unavailable model are classified from provider errors", async () => {
  for (const [mode, kind] of [["rate-limit", "rate-limit"], ["unavailable-model", "unavailable-model"]]) {
    const adapter = make(mode);
    try {
      await adapter.connect();
      await assert.rejects(adapter.beginTurn({ threadId: "fixture-thread", input }), (e: unknown) => e instanceof BridgeError && e.kind === kind);
    } finally { adapter.close(); }
  }
});

test("missing executable and crash reject without restart", async () => {
  const missing = new CodexAdapter("missing-codex-executable-for-fixture");
  await assert.rejects(missing.connect(), (e: unknown) => e instanceof BridgeError && e.kind === "missing-executable");
  const crash = make("crash");
  try { await crash.connect(); const turnId = await crash.beginTurn({ threadId: "fixture-thread", input }); await assert.rejects(crash.waitForTerminal("fixture-thread", turnId)); }
  finally { crash.close(); }
});

test("default refusal and explicit cancellation answer server requests", async () => {
  for (const mode of ["approval", "explicit-denial", "file-approval", "cancel"]) {
    const adapter = make(mode);
    if (mode === "cancel") adapter.setServerRequestHandler(() => ({ decision: "cancel" }));
    if (mode === "explicit-denial") adapter.setServerRequestHandler(() => ({ decision: "decline" }));
    try {
      await adapter.connect();
      const turnId = await adapter.beginTurn({ threadId: "fixture-thread", input });
      const event = await adapter.waitForTerminal("fixture-thread", turnId);
      assert.equal(event.terminalStatus, "interrupted");
      assert.ok(adapter.recentEvents().some(e => e.method === "bridge/serverRequestDecision"));
    } finally { adapter.close(); }
  }
});

test("an early interrupt waits for the matching native turn to start", async () => {
  const adapter = make("wait-interrupt-start");
  try {
    await adapter.connect();
    const threadId = "fixture-thread";
    const turnId = await adapter.beginTurn({ threadId, input });
    await adapter.interrupt({ threadId, turnId });
    assert.equal((await adapter.waitForTerminal(threadId, turnId)).terminalStatus, "interrupted");
  } finally { adapter.close(); }
});

test("interrupt and explicit reconnect resume", async () => {
  const interrupt = make("wait-interrupt");
  try {
    await interrupt.connect();
    const turnId = await interrupt.beginTurn({ threadId: "fixture-thread", input });
    await interrupt.interrupt({ threadId: "fixture-thread", turnId });
    assert.equal((await interrupt.waitForTerminal("fixture-thread", turnId)).terminalStatus, "interrupted");
  } finally { interrupt.close(); }
  const reconnect = make("crash");
  try {
    await reconnect.connect();
    const turnId = await reconnect.beginTurn({ threadId: "fixture-thread", input });
    await assert.rejects(reconnect.waitForTerminal("fixture-thread", turnId));
    assert.equal(await reconnect.reconnect("fixture-thread"), "fixture-thread");
    assert.ok(reconnect.recentEvents().some(e => e.method === "bridge/gap"));
  } finally { reconnect.close(); }
});

test("interrupted stream is a gap, not fabricated completion", async () => {
  const adapter = make("interrupted-stream");
  try {
    await adapter.connect();
    const turnId = await adapter.beginTurn({ threadId: "fixture-thread", input });
    await assert.rejects(adapter.waitForTerminal("fixture-thread", turnId));
    assert.ok(adapter.recentEvents().some(e => e.method === "bridge/transportFailed" && e.evidence === "inferred"));
    assert.ok(!adapter.recentEvents().some(e => e.terminalStatus === "completed"));
  } finally { adapter.close(); }
});

test("native instruction sources and effective settings survive alternate cwd and resume", async () => {
  const adapter = make();
  try {
    await adapter.connect();
    const started = await adapter.startThread({ cwd: "C:\\alternate", model: "selected-model" });
    assert.equal(started.cwd, "C:\\alternate");
    assert.equal(started.model, "selected-model");
    assert.deepEqual(started.instructionSources, ["C:\\fixture\\AGENTS.md"]);
    assert.equal(started.metadataComplete, true);
    const resumed = await adapter.resumeThreadSession({ threadId: started.threadId });
    assert.equal(resumed.threadId, started.threadId);
    assert.equal(resumed.model, "selected-model");
    assert.equal(resumed.modelProvider, "openai");
    assert.equal(resumed.reasoningEffort, "medium");
  } finally { adapter.close(); }
});

test("missing instruction source is distinct from a provider that omits the field", async () => {
  const missing = make("missing-instructions");
  try { await missing.connect(); assert.deepEqual((await missing.startThread()).instructionSources, []); }
  finally { missing.close(); }
  const old = make("unknown-source-field");
  try { await old.connect(); const session = await old.startThread(); assert.equal(session.instructionSources, null); assert.equal(session.metadataComplete, false); }
  finally { old.close(); }
});

test("existing history is read with cursors and native IDs without writing it", async () => {
  const adapter = make();
  try {
    await adapter.connect();
    const page1 = await adapter.listThreads({ limit: 1 });
    assert.equal(page1.data[0]?.id, "fixture-thread");
    assert.equal(page1.nextCursor, "page-2");
    assert.equal((await adapter.listThreads({ cursor: page1.nextCursor })).nextCursor, null);
    assert.equal(((await adapter.readThread("fixture-thread")).thread as { id: string }).id, "fixture-thread");
    assert.equal((await adapter.listTurns({ threadId: "fixture-thread", itemsView: "notLoaded" })).data[0]?.id, "fixture-turn");
    assert.equal((await adapter.listItems({ threadId: "fixture-thread", turnId: "fixture-turn" })).data.length, 1);
    assert.equal((await adapter.resumeThreadSession({ threadId: "fixture-thread" })).threadId, "fixture-thread");
  } finally { adapter.close(); }
});

test("native fork preserves ancestry and unsupported fork is explicit", async () => {
  const adapter = make();
  try {
    await adapter.connect();
    const fork = await adapter.forkThreadSession({ threadId: "fixture-thread", lastTurnId: "fixture-turn" });
    assert.equal(fork.threadId, "fixture-fork");
    assert.equal(fork.forkedFromId, "fixture-thread");
  } finally { adapter.close(); }
  const unsupported = make("unsupported-fork");
  try {
    await unsupported.connect();
    await assert.rejects(unsupported.forkThreadSession({ threadId: "fixture-thread" }), (error: unknown) => error instanceof BridgeError && error.kind === "unsupported");
  } finally { unsupported.close(); }
});

test("provider version mismatch fails closed and absent memory is not claimed", async () => {
  const adapter = make("version-mismatch");
  try {
    await adapter.connect();
    await assert.rejects(adapter.startThread(), (error: unknown) => error instanceof BridgeError && error.kind === "protocol");
    const capabilities = await adapter.capabilities();
    assert.equal(capabilities.catalogOnly, true);
    assert.equal(capabilities.adapterMethods.includes("memory/read"), false);
  } finally { adapter.close(); }
});

test("environment projection excludes private configuration contents", async () => {
  const adapter = make();
  try {
    await adapter.connect();
    const snapshot = await adapter.inspectEnvironment("C:\\fixture");
    assert.equal(snapshot.config.model, "fixture-model");
    assert.equal(snapshot.skills.count, 1);
    assert.equal(snapshot.mcp.count, 1);
    assert.equal(snapshot.config.memoriesFeature, true);
    assert.equal(JSON.stringify(snapshot).includes("PRIVATE_FIXTURE_INSTRUCTION"), false);
  } finally { adapter.close(); }
});

test("unavailable local memory and native history are explicit states", async () => {
  const noMemory = make("no-memory");
  try {
    await noMemory.connect();
    const snapshot = await noMemory.inspectEnvironment("C:\\fixture");
    assert.equal(snapshot.config.memoriesFeature, false);
    assert.equal(snapshot.config.useMemories, false);
  } finally { noMemory.close(); }
  const noHistory = make("missing-history");
  try {
    await noHistory.connect();
    await assert.rejects(noHistory.readThread("unavailable-thread"), (error: unknown) => error instanceof BridgeError && error.kind === "unavailable-history");
  } finally { noHistory.close(); }
});
