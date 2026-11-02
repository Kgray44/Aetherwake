import test from "node:test";
import assert from "node:assert/strict";
import { createConversationExecutionPort } from "../src/conversation-execution.ts";

const execution = (extra = {}) => ({
  id: "e",
  resourceId: "r",
  providerId: "codex-app-server",
  commandId: "c",
  state: "running",
  startedAt: "2026-11-02T00:00:00.000Z",
  endedAt: null,
  taskVerified: false,
  binding: { nativeThreadId: "private-native-id" },
  ...extra,
});
const delta = (extra = {}) => ({
  type: "item/agentMessage/delta",
  resourceId: "r",
  executionId: "e",
  providerId: "codex-app-server",
  eventId: "event-1",
  cursor: 1,
  classification: "reported",
  payload: { redacted: true, delta: "Actual observed assistant text" },
  ...extra,
});
const drain = () => new Promise((resolve) => setImmediate(resolve));
function setup(command) {
  let event,
    tick,
    visible = true,
    stopped = 0,
    unscheduled = 0;
  const calls = [],
    errors = [];
  const port = createConversationExecutionPort({
    command: async (name, input) => {
      calls.push({ name, input });
      return command ? command(name, input) : [execution()];
    },
    onEvent: (listener) => {
      event = listener;
      return () => {
        stopped++;
      };
    },
    visible: () => visible,
    onError: (error) => errors.push(error),
    schedule: (listener, ms) => {
      assert.equal(ms, 1000);
      tick = listener;
      return () => {
        unscheduled++;
      };
    },
  });
  return {
    port,
    calls,
    errors,
    emit: (value) => event(value),
    poll: () => tick(),
    setVisible: (value) => {
      visible = value;
    },
    counts: () => ({ stopped, unscheduled }),
  };
}

test("native chat observations strip private bindings and only forward exact reported assistant deltas, including metadata sharing the same event ID", async () => {
  const f = setup(),
    received = [];
  const off = f.port.observe("r", (value) => received.push(value));
  await drain();
  assert.ok(received.some((value) => value.execution?.state === "running"));
  assert.equal(JSON.stringify(received).includes("private-native-id"), false);
  f.emit({ ...delta(), payload: { redacted: true, textBytes: 30 } });
  f.emit(delta());
  f.emit(delta());
  for (const changed of [
    { type: "item/reasoning/delta" },
    { classification: "simulated" },
    { resourceId: "other" },
    { providerId: "other" },
    { executionId: "other" },
    { cursor: 0 },
  ])
    f.emit(delta(changed));
  await drain();
  assert.deepEqual(
    received.filter((value) => value.delta).map((value) => value.delta.text),
    ["Actual observed assistant text"],
  );
  assert.ok(f.calls.every((call) => call.name === "executionStatus"));
  off();
  off();
  assert.deepEqual(f.counts(), { stopped: 1, unscheduled: 1 });
  f.port.dispose();
});

test("a delta arriving before its native status is queued and matched by execution/provider identity", async () => {
  let resolveStatus;
  const status = new Promise((resolve) => {
    resolveStatus = resolve;
  });
  const f = setup(() => status),
    received = [];
  const off = f.port.observe("r", (value) => received.push(value));
  f.emit({ ...delta(), payload: { redacted: true, textBytes: 30 } });
  f.emit(delta());
  resolveStatus([execution()]);
  await drain();
  assert.equal(received.filter((value) => value.delta).length, 1);
  assert.equal(received.find((value) => value.delta).execution.id, "e");
  off();
  f.port.dispose();
});

test("one shared visible-view poll stops after the last subscriber and cancellation requires a current actual active execution", async () => {
  let state = execution();
  const f = setup(async (name) => {
    if (name === "interrupt") {
      state = execution({
        state: "interrupted",
        endedAt: "2026-11-02T00:00:01.000Z",
      });
      return { requested: true };
    }
    return [state];
  });
  const received = [],
    off = f.port.observe("r", (value) => received.push(value));
  await drain();
  const offSecond = f.port.observe("r", () => {});
  await drain();
  f.setVisible(false);
  const before = f.calls.length;
  f.poll();
  await drain();
  assert.equal(f.calls.length, before);
  f.setVisible(true);
  await assert.rejects(f.port.cancel("unobserved"), /No observed active/);
  assert.equal(f.calls.filter((call) => call.name === "interrupt").length, 0);
  await f.port.cancel("e");
  assert.deepEqual(f.calls.find((call) => call.name === "interrupt").input, {
    executionId: "e",
  });
  assert.ok(received.some((value) => value.execution?.state === "interrupted"));
  off();
  assert.equal(f.counts().stopped, 0);
  offSecond();
  assert.deepEqual(f.counts(), { stopped: 1, unscheduled: 1 });
  f.port.dispose();
});

test("known backend disconnection fences a pending old read without inventing an execution outcome", async () => {
  let resolveStatus;
  const status = new Promise((resolve) => {
    resolveStatus = resolve;
  });
  const f = setup(() => status),
    received = [];
  const off = f.port.observe("r", (value) => received.push(value));
  f.emit({ type: "backend/disconnected" });
  resolveStatus([execution()]);
  await drain();
  assert.deepEqual(received, [{ connection: "unavailable" }]);
  assert.equal(
    received.some((value) => value.execution?.state === "unknown"),
    false,
  );
  off();
  f.port.dispose();
});
