import test from "node:test";
import assert from "node:assert/strict";
import { blockDocument } from "../../../block-library/tests/component-dom.mts";
import { until } from "../../../conversation-product/test/component-dom.mts";
import { mountProviderConnections } from "../src/provider-connections.ts";
const status = {
  contract: "aerynth.provider-connection@1",
  providerId: "chatgpt-plan-responses",
  billingRoute: "chatgpt-plan",
  state: "disconnected",
  storageAvailable: true,
  pending: false,
  registrationVersion: null,
  planUsageEnabled: false,
  inferenceVerified: false,
  nativeAccountHistory: false,
  nativeAccountMemory: false,
  nativeAccountSync: false,
};
const base = {
  newConversation: async () => {
    throw Error("must be user invoked");
  },
  codex: async () => {
    throw Error("must be user invoked");
  },
};

test("opening connection controls only reads local safe status; no OAuth, catalog or provider request starts", async () => {
  const dom = blockDocument(),
    restore = dom.install(),
    calls = [];
  const view = mountProviderConnections(dom.root, {
    ...base,
    command: async (input) => {
      calls.push(input);
      return status;
    },
  });
  try {
    await view.ready;
    assert.deepEqual(calls, [
      { type: "status", providerId: status.providerId },
    ]);
    assert.equal(
      dom.root.querySelector('[data-connection-action="connect"]').disabled,
      false,
    );
    assert.equal(
      dom.root.querySelector('[data-connection-action="chat"]').hidden,
      true,
    );
  } finally {
    view.dispose();
    restore();
  }
});

test("model discovery follows an explicit successful sign-in, while pending consent stays distinct from ready", async () => {
  const dom = blockDocument(),
    restore = dom.install(),
    calls = [];
  let signedIn = false,
    changed = 0;
  const view = mountProviderConnections(dom.root, {
    ...base,
    command: async (input) => {
      calls.push(input.type);
      return input.type === "connect"
        ? { ...status, pending: true }
        : signedIn
          ? {
              ...status,
              state: "ready",
              registrationVersion: 2,
              planUsageEnabled: true,
            }
          : status;
    },
    changed: async () => {
      changed++;
    },
  });
  try {
    await view.ready;
    dom.root.querySelector('[data-connection-action="connect"]').onclick();
    await until(
      () =>
        dom.root.querySelector('[data-connection-action="cancel"]').hidden ===
        false,
    );
    assert.equal(
      dom.root.querySelector('[data-connection-action="chat"]').hidden,
      true,
    );
    signedIn = true;
    await view.refresh();
    assert.deepEqual(calls, ["status", "connect", "status", "refreshModels"]);
    assert.equal(changed, 1);
    assert.equal(
      dom.root.querySelector('[data-connection-action="chat"]').hidden,
      false,
    );
  } finally {
    view.dispose();
    restore();
  }
});

test("a failed sign-in remains visibly failed after controls unlock and can recover through a later status read", async () => {
  const dom = blockDocument(),
    restore = dom.install();
  const view = mountProviderConnections(dom.root, {
    ...base,
    command: async (input) => {
      if (input.type === "connect") throw Error("synthetic callback error");
      return status;
    },
  });
  try {
    await view.ready;
    dom.root.querySelector('[data-connection-action="connect"]').onclick();
    await until(() =>
      dom.root
        .querySelector('[role="status"]')
        .textContent.includes("could not be completed"),
    );
    await view.refresh();
    assert.equal(
      dom.root.querySelector('[role="status"]').textContent,
      "Not connected",
    );
  } finally {
    view.dispose();
    restore();
  }
});

test("closing a pending surface prevents late status completion from starting model discovery", async () => {
  const dom = blockDocument(),
    restore = dom.install(),
    calls = [];
  let complete;
  const pending = new Promise((resolve) => {
    complete = resolve;
  });
  const view = mountProviderConnections(dom.root, {
    ...base,
    command: async (input) => {
      calls.push(input.type);
      return pending;
    },
  });
  view.dispose();
  try {
    complete({
      ...status,
      state: "ready",
      planUsageEnabled: true,
      registrationVersion: 1,
    });
    await view.ready;
    assert.deepEqual(calls, ["status"]);
  } finally {
    restore();
  }
});
