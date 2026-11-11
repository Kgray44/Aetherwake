import assert from "node:assert/strict";
import { test } from "node:test";
import { createVelaOutputObservation } from "../src/vela-output-observation.ts";

test("only a new current output that survives a visible frame opportunity is reported", () => {
  const frames = [], sent = [];
  let visible = true;
  const observe = createVelaOutputObservation(async output => { sent.push(output); },
    callback => frames.push(callback), () => visible);
  const value = id => ({ view: "current", baseline: false,
    output: { messageId: id, requestId: "request-" + id, executionId: "execution-" + id },
    elements: { manifestation: {} },
  });
  const flush = () => { while (frames.length) frames.shift()(); };
  observe({ ...value("baseline"), baseline: true });
  observe({ ...value("history"), view: "history" });
  assert.equal(frames.length, 0);
  observe(value("closed"));
  frames.shift()();
  observe(null);
  flush();
  assert.deepEqual(sent, []);
  visible = false;
  observe(value("hidden"));
  flush();
  assert.deepEqual(sent, []);
  visible = true;
  const current = value("current");
  observe(current);
  frames.shift()();
  assert.deepEqual(sent, []);
  flush();
  observe(current);
  flush();
  assert.deepEqual(sent, [current.output]);
  const report = { ...value("report"), output: { missionId: "mission-1", messageId: "report" } };
  observe(report);
  flush();
  assert.deepEqual(sent, [current.output, report.output]);
});
