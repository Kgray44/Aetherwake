import test from "node:test";
import assert from "node:assert/strict";
import {
  validateControlRequest,
  isRendererCommand,
} from "../src-electron/comparison-contract.ts";
import { percentiles } from "../src/benchmark.ts";

test("comparison contract accepts bounded equivalent actions", () => {
  const append = validateControlRequest({
    id: "s4-message-01",
    command: { op: "appendMessages", count: 1 },
  });
  const event = validateControlRequest({
    id: "s5-event-60",
    command: { op: "appendEvents", count: 1 },
  });
  assert.equal(isRendererCommand(append.command), true);
  assert.equal(isRendererCommand(event.command), true);
  assert.equal(
    validateControlRequest({
      id: "fixed-cadence",
      command: { op: "setAtmosphereCadence", cadence: "fixed60" },
    }).command.op,
    "setAtmosphereCadence",
  );
  assert.equal(
    validateControlRequest({
      id: "s8-open",
      command: { op: "openWindow", block: "activity" },
    }).command.op,
    "openWindow",
  );
  assert.equal(
    validateControlRequest({
      id: "s6-resize",
      command: {
        op: "setWindowBounds",
        target: "main",
        width: 1440,
        height: 920,
      },
    }).command.op,
    "setWindowBounds",
  );
});

test("comparison contract rejects unbounded and arbitrary operations", () => {
  for (const request of [
    { id: "../escape", command: { op: "status" } },
    { id: "event", command: { op: "appendEvents", count: 61 } },
    { id: "bad", command: { op: "openWindow", block: "../../outside" } },
    { id: "bad", command: { op: "executeJavaScript", code: "process.exit()" } },
    { id: "bad", command: { op: "frameStart", scenario: "s4", refreshHz: 0 } },
    { id: "bad", command: { op: "setAtmosphereCadence", cadence: "faster" } },
  ])
    assert.throws(() => validateControlRequest(request));
});

test("frame interval percentiles retain outliers", () => {
  assert.deepEqual(percentiles([4, 6, 8, 12, 40], 70), {
    count: 5,
    durationMs: 70,
    medianMs: 8,
    p95Ms: 40,
    p99Ms: 40,
    maxMs: 40,
  });
});
