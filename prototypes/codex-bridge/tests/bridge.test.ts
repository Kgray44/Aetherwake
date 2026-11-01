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
    const threadId = await adapter.newThread({});
    assert.equal(await adapter.resumeThread({ threadId }), threadId);
    assert.equal(await adapter.forkThread({ threadId }), threadId);
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
  for (const mode of ["approval", "file-approval", "cancel"]) {
    const adapter = make(mode);
    if (mode === "cancel") adapter.setServerRequestHandler(() => ({ decision: "cancel" }));
    try {
      await adapter.connect();
      const turnId = await adapter.beginTurn({ threadId: "fixture-thread", input });
      const event = await adapter.waitForTerminal("fixture-thread", turnId);
      assert.equal(event.terminalStatus, "interrupted");
      assert.ok(adapter.recentEvents().some(e => e.method === "bridge/serverRequestDecision"));
    } finally { adapter.close(); }
  }
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
