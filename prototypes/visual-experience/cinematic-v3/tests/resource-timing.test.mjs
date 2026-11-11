import assert from "node:assert/strict";
import test from "node:test";
import { createResourceTiming } from "../src/resource-timing.ts";

test("timing summarizes the active animation cadence and discards a paced gap", () => {
  const reports = [];
  const timing = createResourceTiming(sample => reports.push(sample));
  for (let now = 100; now < 2500; now += 40) timing.observe(now, 40, 0);
  assert.equal(reports.length, 0);
  for (let now = 2500; now <= 4500; now += 40) timing.observe(now, 40, 20);
  assert.deepEqual(reports, [{ frameP95Ms: 40, budgetRatioP95: 2, samples: 51, windowMs: 2000 }]);
  timing.observe(6000, 1500, 20);
  assert.equal(reports.length, 1);
});
