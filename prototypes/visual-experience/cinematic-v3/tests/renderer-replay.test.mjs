import test from "node:test";
import assert from "node:assert/strict";
import { reconcileRendererReplay } from "../src/renderer-replay.ts";

const event = cursor => ({ cursor, eventId: "event-" + cursor });
const page = (options = {}) => ({
  events: [], earliest: 1, latest: 10, scannedThrough: 10,
  truncated: false, scope: "workspace-a", ...options,
});

test("the recent history window cannot advance the snapshot cursor", async () => {
  const calls = [], accepted = [];
  const outcome = await reconcileRendererReplay({
    scope: "workspace-a", after: 7, seed: true, current: () => true,
    read: async request => {
      calls.push(request);
      if (request.recent) return page({ events: [event(5), event(7), event(10)] });
      return page({ events: [event(8), event(10)] });
    },
    accept: (result, history) => accepted.push([history, result.events.map(item => item.cursor)]),
  });
  assert.deepEqual(calls.map(request => request.after), [undefined, 7]);
  assert.deepEqual(accepted, [[true, [5, 7]], [false, [8, 10]]]);
  assert.deepEqual(outcome, { status: "current", cursor: 10 });
});

test("replay advances by the scanned cursor across empty and filtered pages", async () => {
  const calls = [], accepted = [];
  const outcome = await reconcileRendererReplay({
    scope: "workspace-a", after: 3, seed: false, current: () => true,
    read: async request => {
      calls.push(request.after);
      if (request.after === 3) return page({ latest: 12, scannedThrough: 7 });
      return page({ latest: 12, scannedThrough: 12, events: [event(9), event(12)] });
    },
    accept: result => accepted.push(...result.events.map(item => item.cursor)),
  });
  assert.deepEqual(calls, [3, 7]);
  assert.deepEqual(accepted, [9, 12]);
  assert.deepEqual(outcome, { status: "current", cursor: 12 });
});

test("truncation and scope mismatch request a new snapshot before publishing", async () => {
  for (const result of [
    page({ truncated: true, earliest: 9, events: [event(10)] }),
    page({ scope: "workspace-b", events: [event(10)] }),
  ]) {
    assert.deepEqual(await reconcileRendererReplay({
      scope: "workspace-a", after: 3, seed: false, current: () => true,
      read: async () => result,
      accept: () => assert.fail("an invalid page must not publish"),
    }), { status: "rebase", gap: result.truncated });
  }
});

test("a page resolved after invalidation cannot publish", async () => {
  let valid = true;
  const outcome = await reconcileRendererReplay({
    scope: "workspace-a", after: 7, seed: false, current: () => valid,
    read: async () => { valid = false; return page({ events: [event(8)] }); },
    accept: () => assert.fail("an old generation must not publish"),
  });
  assert.deepEqual(outcome, { status: "obsolete" });
});
