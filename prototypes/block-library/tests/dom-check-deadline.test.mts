import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { beforeDeadline } = createRequire(import.meta.url)(
  "./dom-check-deadline.cjs",
);

test("hidden DOM stages share an absolute deadline, reject hung work and never start after expiry", async () => {
  let started = false;
  await assert.rejects(
    beforeDeadline(
      10,
      "already-expired",
      () => {
        started = true;
      },
      () => 10,
    ),
    { code: "DOM_CHECK_DEADLINE", stage: "already-expired" },
  );
  assert.equal(started, false);
  await assert.rejects(
    beforeDeadline(
      Date.now() + 15,
      "browser-hit-test",
      () => new Promise(() => {}),
    ),
    { code: "DOM_CHECK_DEADLINE", stage: "browser-hit-test" },
  );
  let now = 1;
  await assert.rejects(
    beforeDeadline(
      10,
      "late-reply",
      () => {
        now = 10;
        return true;
      },
      () => now,
    ),
    { code: "DOM_CHECK_DEADLINE", stage: "late-reply" },
  );
  assert.equal(
    await beforeDeadline(
      10,
      "bounded-result",
      () => 72,
      () => 1,
    ),
    72,
  );
});
