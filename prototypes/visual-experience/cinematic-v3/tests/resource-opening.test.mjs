import test from "node:test";
import assert from "node:assert/strict";
import { createResourceOpener } from "../src/resource-opening.ts";
import { createVelaClient } from "../src/vela-client.ts";

const ready = (id) => ({
  contract: "aerynth.resource-opening@1",
  status: "ready",
  resourceId: id,
  resource: { id },
  presentation: { kind: "note", mode: "direct" },
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};

test("a newer open wins even when the earlier canonical lookup completes last", async () => {
  const first = deferred(),
    presented = [],
    reads = [];
  const opener = createResourceOpener({
    resolve: async (input) => {
      reads.push(input);
      return input.resourceId === "first"
        ? first.promise
        : ready(input.resourceId);
    },
    present: async (result) => {
      presented.push(result.resourceId);
    },
    unavailable: () => {
      throw Error("unexpected unavailable");
    },
  });
  const a = opener.open({ resourceId: "first" });
  await opener.open({ resourceId: "second", origin: { source: "search" } });
  first.resolve(ready("first"));
  assert.deepEqual(await a, { status: "superseded" });
  assert.deepEqual(presented, ["second"]);
  assert.deepEqual(reads, [
    { resourceId: "first" },
    { resourceId: "second", origin: { source: "search" } },
  ]);
});

test("closing while a lookup is pending never opens a late resource", async () => {
  const pending = deferred(),
    presented = [];
  const opener = createResourceOpener({
    resolve: () => pending.promise,
    present: async (value) => {
      presented.push(value);
    },
    unavailable: () => {},
  });
  const operation = opener.open({ resourceId: "unplaced" });
  opener.cancel();
  pending.resolve(ready("unplaced"));
  assert.deepEqual(await operation, { status: "superseded" });
  assert.deepEqual(presented, []);
});

test("a failed superseded lookup does not report an error over the current view", async () => {
  const pending = deferred();
  const opener = createResourceOpener({
    resolve: () => pending.promise,
    present: async () => assert.fail("A superseded resource cannot open"),
    unavailable: () => assert.fail("A superseded resource cannot report unavailability"),
  });
  const operation = opener.open({ resourceId: "earlier" });
  opener.cancel();
  pending.reject(Error("native_service_unavailable"));
  assert.deepEqual(await operation, { status: "superseded" });
});

test("unavailable resources stay unavailable and a failed lookup does not poison later opens", async () => {
  const unavailable = [],
    presented = [];
  const opener = createResourceOpener({
    resolve: async ({ resourceId }) => {
      if (resourceId === "offline") throw Error("native_service_unavailable");
      return resourceId === "revoked"
        ? {
            contract: "aerynth.resource-opening@1",
            status: "unavailable",
            resourceId,
            reason: "resource-unavailable",
          }
        : ready(resourceId);
    },
    present: async (value) => {
      presented.push(value.resourceId);
    },
    unavailable: (value) => {
      unavailable.push(value);
    },
  });
  await assert.rejects(
    opener.open({ resourceId: "offline" }),
    /native_service_unavailable/,
  );
  await opener.open({ resourceId: "revoked" });
  await opener.open({ resourceId: "available" });
  assert.deepEqual(presented, ["available"]);
  assert.equal(unavailable.length, 1);
  assert.equal(unavailable[0].resourceId, "revoked");
});

test("newer navigation suppresses a resource presentation while the Vela model is still running", async () => {
  let complete;
  const result = new Promise(resolve => { complete = resolve; });
  const opened = [];
  const opener = createResourceOpener({
    resolve: async ({ resourceId }) => ready(resourceId),
    present: async (resource) => { opened.push(resource.resourceId); },
    unavailable: () => assert.fail("unexpected unavailable"),
  });
  const client = createVelaClient({
    command: () => result,
    presentationFence: opener.capture,
    observed() {},
    changed: async (_name, value, mayPresent) => {
      if (mayPresent?.()) await opener.open({ resourceId: value.id });
    },
  });
  const pending = client.request({ intent: "Bring up my note", resourceIds: [], authorizeProvider: true });
  await opener.open({ resourceId: "later-user-choice" });
  complete({ id: "model-choice" });
  await pending;
  assert.deepEqual(opened, ["later-user-choice"]);
});
