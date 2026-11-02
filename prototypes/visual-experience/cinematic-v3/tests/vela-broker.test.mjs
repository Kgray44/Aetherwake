import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
const { velaCommand, isVelaRead } = createRequire(import.meta.url)(
  "../native/vela-broker.cjs",
);
function fixture(choice = 1) {
  const calls = [],
    classifications = [],
    dialogs = [],
    reviews = [];
  let closed = false;
  const win = {
    isDestroyed: () => closed,
    webContents: { isDestroyed: () => closed },
  };
  const context = {
    included: [
      {
        id: "note",
        kind: "resource",
        title: "Reviewed Note",
        content: "Reviewed source excerpt",
      },
    ],
  };
  const prompt =
    "Exact semantic prompt with Reviewed source excerpt and selected prior answer";
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
    classifications,
    dialogs,
    reviews,
    win,
    close: () => {
      closed = true;
    },
    reviewProvider: async (value) => {
      reviews.push(value);
      return choice === 1;
    },
    plan,
    dialog: {
      async showMessageBox(_win, value) {
        dialogs.push(value);
        return { response: choice };
      },
    },
    async call(name, input) {
      // Keep the existing consent/action trace separate from the read-only
      // unmatched classifier; record both lanes rather than hiding dispatches.
      if (name === "vela" && input.name === "local") {
        classifications.push({ name, input });
        return { matched: false };
      }
      calls.push({ name, input });
      if (name === "velaRequestPreview")
        return {
          id: "preview",
          signature: "backend-signature",
          providerId: "codex-app-server",
          intent: "Exact intent",
          context,
          expiresAt: new Date(Date.now() + 30000).toISOString(),
        };
      if (name === "velaNativeReview")
        return {
          previewId: "preview",
          signature: "backend-signature",
          providerId: "codex-app-server",
          context,
          prompt,
          promptDigest: createHash("sha256")
            .update(JSON.stringify(prompt))
            .digest("hex"),
          reviewDigest: "a".repeat(64),
          history: {
            messages: [
              {
                role: "assistant",
                providerId: "codex-app-server",
                content: "Selected prior answer",
              },
            ],
          },
          historyOmissions: [],
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
  assert.equal(f.classifications.length, 1);
  assert.deepEqual(Object.keys(f.classifications[0].input.input).sort(), ["commandId", "intent"]);
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
  assert.equal(isVelaRead({ name: "local" }), false, "Canonical local replies still require storage admission");
});

test("a clock answer routes before provider checkbox, context review or grants and carries no selected resources", async () => {
  for (const authorizeProvider of [false, true]) {
    const calls = [];
    const answer = { id: "canonical-clock", state: "responded", providerId: null };
    const result = await velaCommand({
      win: null,
      dialog: { showMessageBox: () => { throw Error("Clock must not request approval"); } },
      reviewProvider: () => { throw Error("Clock must not construct a provider review"); },
      input: { name: "request", input: { intent: "What time is it?", resourceIds: ["private-selected-note"], authorizeProvider, commandId: "one-clock" } },
      call: async (name, input) => {
        calls.push({ name, input });
        assert.equal(name, "vela"); assert.equal(input.name, "local");
        assert.deepEqual(input.input, { intent: "What time is it?", commandId: "one-clock" });
        return { matched: true, request: answer };
      },
    });
    assert.deepEqual(result, answer); assert.equal(calls.length, 1);
  }
});
test("Vela planning reviews backend context then uses only a newly issued native grant", async () => {
  const f = fixture();
  await velaCommand({ ...f, input: request(true) });
  assert.deepEqual(
    f.calls.map((c) => c.name),
    ["velaRequestPreview", "velaNativeReview", "authorizeVelaRequest", "vela"],
  );
  assert.equal(f.dialogs.length, 0, "no oversized OS text dialog");
  assert.equal(
    f.reviews[0].review.context.included[0].content,
    "Reviewed source excerpt",
  );
  assert.equal(
    f.reviews[0].review.history.messages[0].content,
    "Selected prior answer",
  );
  assert.deepEqual(f.calls[2].input, {
    previewId: "preview",
    signature: "backend-signature",
    reviewDigest: "a".repeat(64),
  });
  assert.equal(f.calls[3].input.input.grantId, "private-native-grant");
});
test("cancelled planning consent never grants or dispatches", async () => {
  const f = fixture(0);
  await assert.rejects(
    velaCommand({ ...f, input: request(true) }),
    /authorization_cancelled/,
  );
  assert.deepEqual(
    f.calls.map((c) => c.name),
    ["velaRequestPreview", "velaNativeReview"],
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
    "velaNativeReview",
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

test("native review failures or substituted prompts cannot fall back to legacy consent or dispatch", async () => {
  for (const mismatch of [false, true]) {
    const f = fixture(),
      original = f.call;
    f.call = async (name, input) => {
      if (name !== "velaNativeReview") return original(name, input);
      if (!mismatch) throw Error("native_review_unavailable");
      return {
        ...(await original(name, input)),
        prompt: "Unreviewed replacement",
      };
    };
    await assert.rejects(
      velaCommand({ ...f, input: request(true) }),
      /native_review_unavailable|invalid_native_vela_review/,
    );
    assert.equal(f.dialogs.length, 0);
    assert.equal(f.reviews.length, 0);
    assert(
      !f.calls.some(
        (c) => c.name === "authorizeVelaRequest" || c.name === "vela",
      ),
    );
  }
});

test("closing the owner during review or grant creation cannot dispatch a provider request", async () => {
  for (const closeAt of ["review", "grant"]) {
    const f = fixture(),
      original = f.call;
    if (closeAt === "review")
      f.reviewProvider = async () => {
        f.close();
        return true;
      };
    else
      f.call = async (name, input) => {
        const value = await original(name, input);
        if (name === "authorizeVelaRequest") f.close();
        return value;
      };
    await assert.rejects(
      velaCommand({ ...f, input: request(true) }),
      /native_review_owner_unavailable/,
    );
    assert(!f.calls.some((c) => c.name === "vela"));
  }
});

test("native request failure diagnostics disclose only the failed stage and a safe code before consent", async () => {
  for (const message of [
    "vela_prompt_too_large",
    "Private source body: do not disclose",
  ]) {
    const f = fixture(),
      observations = [], original = f.call;
    f.call = async (name, input) => {
      if (name === "vela" && input.name === "local") return original(name, input);
      throw Error(message);
    };
    await assert.rejects(
      velaCommand({
        ...f,
        input: request(true),
        observeNativeRequest: (event) => observations.push(event),
      }),
      (error) => error.message === message,
    );
    assert.deepEqual(observations, [
      { stage: "preview", state: "started" },
      {
        stage: "preview",
        state: "failed",
        code:
          message === "vela_prompt_too_large" ? message : "operation_failed",
      },
    ]);
    assert.equal(f.reviews.length, 0);
    assert(observations.every(Object.isFrozen));
    assert(!JSON.stringify(observations).includes("Private source body"));
  }
});

test("diagnostic callbacks cannot approve, alter or fail the native request", async () => {
  const baseline = fixture(),
    observed = fixture(),
    failingObserver = fixture(),
    events = [];
  await velaCommand({ ...baseline, input: request(true) });
  await velaCommand({
    ...observed,
    input: request(true),
    observeNativeRequest: (event) => {
      events.push(event);
      return false;
    },
  });
  await velaCommand({
    ...failingObserver,
    input: request(true),
    observeNativeRequest: () => {
      throw Error("observer failed");
    },
  });
  assert.deepEqual(
    observed.calls.map((c) => c.name),
    baseline.calls.map((c) => c.name),
  );
  assert.deepEqual(
    failingObserver.calls.map((c) => c.name),
    baseline.calls.map((c) => c.name),
  );
  assert.equal(observed.reviews.length, 1);
  assert.equal(failingObserver.reviews.length, 1);
  assert.deepEqual(
    events.map((e) => [e.stage, e.state]),
    ["preview", "review", "grant", "request"].flatMap((stage) => [
      [stage, "started"],
      [stage, "completed"],
    ]),
  );
  assert(
    events.every((e) =>
      Object.keys(e).every((key) => ["stage", "state", "code"].includes(key)),
    ),
  );
  const local = fixture();
  await velaCommand({
    ...local,
    input: request(false),
    observeNativeRequest: () =>
      assert.fail("Local-only input has no provider stages"),
  });
  assert.equal(local.calls.length, 1);
});
