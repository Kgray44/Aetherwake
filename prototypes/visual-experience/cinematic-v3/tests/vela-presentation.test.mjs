import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createVelaClient } from "../src/vela-client.ts";
const { velaCommand } = createRequire(import.meta.url)(
  "../native/vela-broker.cjs",
);
const context = () => ({
  workspaceId: "workspace",
  bounds: { x: -20, y: 10, width: 1200, height: 700 },
});

test("a completed Vela submission survives a lost reply without sending again", async () => {
  const recorded = { id: "canonical-request", state: "responded" };
  const changed = [];
  let submissions = 0;
  let token;
  let reads = 0;
  let deliverOriginal;
  const original = new Promise(resolve => { deliverOriginal = resolve; });
  const client = createVelaClient({
    command: async (command, input) => {
      assert.equal(command, "vela");
      if (input.name === "request") {
        submissions++;
        token = input.submissionId;
        assert.equal(typeof token, "string");
        assert.equal(input.input.submissionId, undefined);
        return original;
      }
      assert.equal(input.name, "submissionStatus");
      assert.deepEqual(input.input, { submissionId: token });
      return ++reads === 1 ? null : recorded;
    },
    changed: async (name, result) => { changed.push({ name, result }); },
    observed() {},
  });
  const timeout = AbortSignal.timeout(2500);
  const pending = client.request({ intent: "Check status", resourceIds: [], authorizeProvider: false });
  assert.deepEqual(await Promise.race([
    pending,
    new Promise((_, reject) => timeout.addEventListener("abort", () => reject(timeout.reason), { once: true })),
  ]), recorded);
  deliverOriginal(recorded);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(submissions, 1);
  assert.equal(reads, 2);
  assert.deepEqual(changed, [{ name: "request", result: recorded }]);
});

for (const reason of ["backend_disconnected", "missing receipt", "authorization_cancelled"]) test("Vela handles a rejected submission with " + reason, async () => {
  const recorded = { id: "canonical-request", state: "responded" };
  const calls = [];
  const client = createVelaClient({
    command: async (_name, input) => {
      calls.push(input);
      if (input.name === "request") throw Error(reason === "missing receipt" ? "backend_disconnected" : reason);
      assert.equal(input.name, "submissionStatus");
      assert.equal(input.input.submissionId, calls[0].submissionId);
      return reason === "missing receipt" ? null : recorded;
    },
    changed: async () => {},
    observed() {},
  });
  const pending = client.request({ intent: "Check status", resourceIds: [], authorizeProvider: false });
  if (reason === "backend_disconnected") {
    assert.deepEqual(await pending, recorded);
    assert.deepEqual(calls.map(call => call.name), ["request", "submissionStatus"]);
  } else if (reason === "missing receipt") {
    await assert.rejects(pending, /backend_disconnected/);
    assert.deepEqual(calls.map(call => call.name), ["request", "submissionStatus"]);
  } else {
    await assert.rejects(pending, /authorization_cancelled/);
    assert.deepEqual(calls.map(call => call.name), ["request"]);
  }
});

test("a confirmed Vela response survives a failed workspace refresh", async () => {
  const recorded = { id: "canonical-request", state: "responded" };
  const operations = [];
  let refreshFailures = 0;
  const client = createVelaClient({
    command: async (name, input) => {
      operations.push(input.name);
      assert.equal(name, "vela");
      assert.equal(input.name, "request");
      return recorded;
    },
    changed: async () => { throw Error("workspace snapshot unavailable"); },
    requestRefreshFailed: () => { refreshFailures++; },
    observed() {},
  });
  assert.deepEqual(await client.request({ intent: "Check status", resourceIds: [], authorizeProvider: false }), recorded);
  assert.deepEqual(operations, ["request"]);
  assert.equal(refreshFailures, 1);
});

test("durable response presentation uses its exact service CAS payload and is never a storage-exempt read", async () => {
  const { isVelaRead } = createRequire(import.meta.url)(
    "../native/vela-broker.cjs",
  );
  const calls = [];
  const client = createVelaClient({
    command: async (command, input) => {
      calls.push({ command, input });
      return { version: 2 };
    },
    changed: async () => {
      throw Error("presentation must not hydrate desktop bodies");
    },
    observed() {},
  });
  const input = { expectedVersion: 1, patch: { view: "history" } };
  await client.presentation(input);
  assert.deepEqual(calls, [
    { command: "vela", input: { name: "presentation", input } },
  ]);
  assert.equal(isVelaRead({ name: "presentation", input }), false);
  const result = await velaCommand({
    win: {},
    dialog: {
      showMessageBox: async () => {
        throw Error("presentation is not provider approval");
      },
    },
    call: async (command, value) => ({ command, value }),
    input: { name: "presentation", input },
  });
  assert.deepEqual(result, {
    command: "vela",
    value: { name: "presentation", input },
  });
});

test("client supplies fresh presentation only at apply, separately from exact plan identity and model request", async () => {
  const calls = [],
    current = context();
  const client = createVelaClient({
    command: async (name, input) => {
      calls.push({ name, input });
      return {};
    },
    changed: async () => {},
    observed() {},
    presentation: () => current,
  });
  await client.review({ planId: "plan", approve: true });
  assert.equal("presentation" in calls[0].input, false);
  current.bounds.width = 800;
  await client.apply("plan");
  assert.equal(calls[1].input.input, "plan");
  assert.deepEqual(calls[1].input.presentation, current);
  current.bounds.width = 500;
  assert.equal(
    calls[1].input.presentation.bounds.width,
    800,
    "in-flight context is an owned snapshot",
  );
});

test("native apply forwards valid canvas context but rejects malformed or misplaced fields before any backend or approval call", async () => {
  const calls = [],
    dialogs = [];
  const args = {
    win: {},
    dialog: { showMessageBox: async () => dialogs.push("approval") },
    call: async (name, input) => {
      calls.push({ name, input });
      return input.name === "state"
        ? { plans: [{ id: "plan", state: "approved", steps: [] }] }
        : {};
    },
  };
  await velaCommand({
    ...args,
    input: { name: "apply", input: "plan", presentation: context() },
  });
  assert.deepEqual(calls.at(-1).input, {
    name: "apply",
    input: "plan",
    presentation: context(),
  });
  for (const presentation of [
    null,
    [],
    { ...context(), grantId: "forged" },
    { ...context(), bounds: { ...context().bounds, width: 0 } },
    { ...context(), bounds: { ...context().bounds, x: Infinity } },
    { ...context(), bounds: { ...context().bounds, providerId: "forged" } },
    { ...context(), workspaceId: "" },
  ]) {
    calls.length = 0;
    await assert.rejects(
      velaCommand({
        ...args,
        input: { name: "apply", input: "plan", presentation },
      }),
      /invalid_vela_presentation/,
    );
    assert.equal(calls.length, 0);
    assert.equal(dialogs.length, 0);
  }
  await assert.rejects(
    velaCommand({
      ...args,
      input: { name: "request", input: {}, presentation: context() },
    }),
    /invalid_vela_presentation/,
  );
});
