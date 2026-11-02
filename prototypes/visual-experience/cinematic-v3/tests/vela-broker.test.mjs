import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { velaCommand, isVelaRead } = createRequire(import.meta.url)(
  "../native/vela-broker.cjs",
);
function fixture(choice = 1) {
  const calls = [],
    dialogs = [];
  const plan = {
    id: "plan",
    requestId: "request",
    state: "approved",
    fingerprint: "exact-plan",
    summary: "Reviewed task",
    steps: [
      {
        id: "step",
        action: {
          type: "delegateTask",
          providerId: "codex-app-server",
          objective: "Reviewed objective",
        },
      },
    ],
  };
  return {
    calls,
    dialogs,
    plan,
    dialog: {
      async showMessageBox(_win, value) {
        dialogs.push(value);
        return { response: choice };
      },
    },
    async call(name, input) {
      calls.push({ name, input });
      if (name === "velaRequestPreview")
        return {
          id: "preview",
          signature: "backend-signature",
          providerId: "codex-app-server",
          intent: "Exact intent",
          context: { included: [{ content: "Reviewed source excerpt" }] },
        };
      if (name === "authorizeVelaRequest")
        return { grantId: "private-native-grant" };
      if (name === "vela" && input.name === "state")
        return {
          plans: [plan],
          requests: [
            {
              id: "request",
              context: { included: ["Reviewed source excerpt"] },
            },
          ],
        };
      return { id: "result" };
    },
  };
}
const request = (authorizeProvider) => ({
  name: "request",
  input: {
    intent: "Exact intent",
    resourceIds: ["note"],
    authorizeProvider,
    previewId: "forged",
    grantId: "forged",
  },
});
test("unapproved Vela requests cannot smuggle renderer grants or contact a provider", async () => {
  const f = fixture();
  await velaCommand({ ...f, input: request(false) });
  assert.equal(f.dialogs.length, 0);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0], {
    name: "vela",
    input: {
      name: "request",
      input: {
        intent: "Exact intent",
        resourceIds: ["note"],
        authorizeProvider: false,
      },
    },
  });
  assert.equal(isVelaRead({ name: "state" }), true);
  assert.equal(isVelaRead({ name: "open" }), false);
});
test("Vela planning reviews backend context then uses only a newly issued native grant", async () => {
  const f = fixture();
  await velaCommand({ ...f, input: request(true) });
  assert.deepEqual(
    f.calls.map((c) => c.name),
    ["velaRequestPreview", "authorizeVelaRequest", "vela"],
  );
  assert.match(f.dialogs[0].detail, /Reviewed source excerpt/);
  assert.deepEqual(f.calls[1].input, {
    previewId: "preview",
    signature: "backend-signature",
  });
  assert.equal(f.calls[2].input.input.grantId, "private-native-grant");
});
test("cancelled planning consent never grants or dispatches", async () => {
  const f = fixture(0);
  await assert.rejects(
    velaCommand({ ...f, input: request(true) }),
    /authorization_cancelled/,
  );
  assert.deepEqual(
    f.calls.map((c) => c.name),
    ["velaRequestPreview"],
  );
});
test("revoked or stale planning context fails at native grant creation without dispatch", async () => {
  const f = fixture(),
    original = f.call;
  f.call = async (name, input) => {
    if (name === "authorizeVelaRequest") throw Error("stale_context");
    return original(name, input);
  };
  await assert.rejects(
    velaCommand({ ...f, input: request(true) }),
    /stale_context/,
  );
  assert.equal(
    f.calls.some((c) => c.name === "vela"),
    false,
  );
});
test("delegation receives its own native review bound to canonical plan and step", async () => {
  const f = fixture();
  await velaCommand({ ...f, input: { name: "apply", input: "plan" } });
  assert.equal(f.dialogs.length, 1);
  assert.match(f.dialogs[0].detail, /Reviewed objective/);
  assert.deepEqual(f.calls[1], {
    name: "authorizeVelaDelegation",
    input: { planId: "plan", stepId: "step", fingerprint: "exact-plan" },
  });
  assert.deepEqual(f.calls[2], {
    name: "vela",
    input: { name: "apply", input: "plan" },
  });
});
test("cancelled delegation cannot authorize a task or apply the plan", async () => {
  const f = fixture(0);
  await assert.rejects(
    velaCommand({ ...f, input: { name: "apply", input: "plan" } }),
    /authorization_cancelled/,
  );
  assert.equal(f.calls.length, 1);
});
test("private grants and reflective method names are not renderer commands", async () => {
  for (const name of [
    "authorizeVelaRequest",
    "authorizeVelaDelegation",
    "constructor",
    "__proto__",
  ]) {
    const f = fixture();
    await assert.rejects(
      velaCommand({ ...f, input: { name, input: {} } }),
      /invalid_vela_command/,
    );
    assert.equal(f.calls.length, 0);
  }
});
