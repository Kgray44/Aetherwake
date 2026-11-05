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
const activity = (
  ids,
  rows = [execution()],
  preview = null,
  unavailable = [],
) => ({
  contract: "aerynth.conversation-activity@1",
  resources: ids.map((resourceId) => ({
    resourceId,
    available: !unavailable.includes(resourceId),
  })),
  executions: rows.filter(
    (row) =>
      ids.includes(row.resourceId) && !unavailable.includes(row.resourceId),
  ),
  preview:
    preview &&
    ids.includes(preview.resourceId) &&
    !unavailable.includes(preview.resourceId)
      ? preview
      : null,
});
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
      const result = command ? await command(name, input) : [execution()];
      return name === "conversationActivity" && Array.isArray(result)
        ? activity(input.resourceIds, result)
        : result;
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
  assert.ok(f.calls.every((call) => call.name === "conversationActivity"));
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

test("reopening and returning from a hidden view read the full existing backend preview without replaying a provider request", async () => {
  let preview = {
    resourceId: "r",
    executionId: "e",
    providerId: "codex-app-server",
    cursor: 1,
    text: "Observed prefix",
    classification: "reported",
  };
  const f = setup((_name, input) =>
      activity(input.resourceIds, [execution()], preview),
    ),
    first = [];
  const off = f.port.observe("r", (value) => first.push(value));
  await drain();
  assert.equal(
    first.find((value) => value.preview).preview.text,
    "Observed prefix",
  );
  off();
  preview = {
    ...preview,
    cursor: 3,
    text: "Observed prefix while view was closed",
  };
  const reopened = [],
    offAgain = f.port.observe("r", (value) => reopened.push(value));
  await drain();
  assert.equal(
    reopened.find((value) => value.preview).preview.text,
    preview.text,
  );
  f.setVisible(false);
  const count = reopened.length,
    reads = f.calls.length;
  preview = { ...preview, cursor: 5, text: preview.text + " and hidden" };
  f.emit(
    delta({
      eventId: "hidden",
      cursor: 5,
      payload: { redacted: true, delta: " and hidden" },
    }),
  );
  f.poll();
  await drain();
  assert.equal(reopened.length, count);
  assert.equal(f.calls.length, reads);
  f.setVisible(true);
  f.poll();
  await drain();
  assert.equal(
    reopened.filter((value) => value.preview).at(-1).preview.text,
    preview.text,
  );
  f.emit(
    delta({
      eventId: "later",
      cursor: 6,
      payload: { redacted: true, delta: " then continued" },
    }),
  );
  assert.equal(
    reopened.filter((value) => value.delta).at(-1).delta.text,
    " then continued",
  );
  assert.ok(f.calls.every((call) => call.name === "conversationActivity"));
  offAgain();
  f.port.dispose();
});

test("canonical access loss clears activity and rejects later stale live output", async () => {
  let denied = false;
  const preview = {
    resourceId: "r",
    executionId: "e",
    providerId: "codex-app-server",
    cursor: 1,
    text: "Authorized preview",
    classification: "reported",
  };
  const f = setup((_name, input) =>
      activity(input.resourceIds, [execution()], preview, denied ? ["r"] : []),
    ),
    received = [];
  const off = f.port.observe("r", (value) => received.push(value));
  await drain();
  denied = true;
  f.poll();
  await drain();
  assert.equal(received.at(-1).resourceAvailable, false);
  const count = received.filter((value) => value.delta).length;
  f.emit(delta({ eventId: "after-denial", cursor: 2 }));
  await drain();
  assert.equal(received.filter((value) => value.delta).length, count);
  await assert.rejects(f.port.cancel("e"), /No observed active/);
  assert.equal(
    f.calls.some((call) => call.name === "interrupt"),
    false,
  );
  off();
  f.port.dispose();
});

test("more than one activity batch stays scoped and bounded instead of polling all application executions", async () => {
  const f = setup(),
    off = [];
  for (let index = 0; index < 65; index++)
    off.push(f.port.observe("r" + index, () => {}));
  await drain();
  assert.ok(f.calls.length >= 3);
  assert.ok(
    f.calls.every(
      (call) =>
        call.name === "conversationActivity" &&
        call.input.resourceIds.length <= 64,
    ),
  );
  assert.ok(f.calls.some((call) => call.input.resourceIds.includes("r64")));
  for (const stop of off) stop();
  assert.deepEqual(f.counts(), { stopped: 1, unscheduled: 1 });
  f.port.dispose();
});
