import test from "node:test";
import assert from "node:assert/strict";
import { createFixture } from "../scripts/generate-fixtures.mjs";

test("fixture counts, identities and timestamps are deterministic", () => {
  const a = createFixture(),
    b = createFixture();
  assert.equal(a.seed, 20261101);
  assert.equal(a.messages.length, 2000);
  assert.equal(a.events.length, 1000);
  assert.deepEqual(a, b);
  assert.equal(new Set(a.messages.map((x) => x.id)).size, 2000);
  assert.equal(new Set(a.events.map((x) => x.id)).size, 1000);
  assert.ok(a.events.every((x) => Number.isFinite(Date.parse(x.time))));
});
