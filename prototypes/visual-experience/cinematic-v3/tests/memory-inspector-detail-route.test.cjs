const assert = require("node:assert/strict");
const test = require("node:test");
const { createFixtureDetailRoute } = require("../native/memory-inspector-fixture-startup.cjs");

test("fixture detail admits only the exact current opened pair and frame", async () => {
  let frame = {}, admitted = true, revoked = false, pending;
  const calls = [];
  const route = createFixtureDetailRoute({
    detailToken: "native-only",
    check() { if (!admitted) throw Error("native_test_desktop_slot_closed"); },
    trustedFrame: event => event.senderFrame === frame,
    async call({ command, input, fixtureDetailToken }) {
      assert.equal(fixtureDetailToken, "native-only");
      calls.push({ command, input });
      if (command === "openResource") return { status: "ready", resourceId: input.resourceId,
        resource: { kind: "conversation" }, selection: input.selection };
      if (revoked) throw Error("source_unavailable");
      return pending ? pending.promise : { messages: { items: [{ id: input.input.aroundMessageId }] } };
    },
  });
  const open = (messageId = "message") => route.dispatch({ senderFrame: frame }, "openResource", {
    resourceId: "chat", selection: { messageId }, fixtureDetailToken: "forged",
  });
  const detail = (aroundMessageId = "message") => route.dispatch({ senderFrame: frame }, "conversation", {
    name: "detail", input: { resourceId: "chat", aroundMessageId, limit: 200 }, fixtureDetailToken: "forged",
  });
  await assert.rejects(detail(), /command_denied/u);
  await open();
  await assert.rejects(detail("other"), /command_denied/u);
  assert.equal((await detail()).messages.items[0].id, "message");
  assert.deepEqual(calls, [
    { command: "openResource", input: { resourceId: "chat", selection: { messageId: "message" } } },
    { command: "conversation", input: { name: "detail", input: { resourceId: "chat", aroundMessageId: "message" } } },
  ]);
  pending = Promise.withResolvers();
  const replaced = detail();
  await open("new");
  pending.resolve({});
  await assert.rejects(replaced, /source_unavailable/u);
  pending = undefined;
  frame = {};
  await assert.rejects(detail("new"), /command_denied/u);
  await open();
  pending = Promise.withResolvers();
  const retired = detail();
  route.clear();
  pending.resolve({});
  await assert.rejects(retired, /source_unavailable/u);
  pending = undefined;
  await open();
  revoked = true;
  await assert.rejects(detail(), /source_unavailable/u);
  await assert.rejects(detail(), /command_denied/u);
  await open();
  revoked = false;
  pending = Promise.withResolvers();
  const cancelled = detail();
  admitted = false;
  pending.resolve({});
  await assert.rejects(cancelled, /slot_closed/u);
});
