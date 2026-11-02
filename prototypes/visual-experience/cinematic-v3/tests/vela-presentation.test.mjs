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
