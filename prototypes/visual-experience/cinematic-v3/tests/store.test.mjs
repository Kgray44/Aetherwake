import test from "node:test";
import assert from "node:assert/strict";
import {
  seed,
  validateSaved,
  validateDemoPrefix,
  demoSteps,
} from "../src/store.ts";

function saved() {
  return {
    order: seed.map((r) => r.id),
    drafts: Object.fromEntries(seed.map((r) => [r.id, r.text])),
  };
}

test("fixture verification checks recorded provenance and order before showing a checked state", () => {
  const run = "fixture-run";
  const events = demoSteps.slice(0, 5).map((step, i) => ({
    id: `e${i}`,
    sequence: i + 1,
    run,
    source: step.source,
    resource: step.resource,
    kind: step.kind,
    evidence: "synthetic",
    time: new Date(1000 + i).toISOString(),
    detail: step.detail,
  }));
  assert.equal(validateDemoPrefix(events, run), true);
  assert.equal(validateDemoPrefix(events.slice(0, 4), run), false);
  assert.equal(validateDemoPrefix([...events].reverse(), run), false);
  assert.equal(
    validateDemoPrefix(
      events.map((e, i) => (i === 3 ? { ...e, id: events[0].id } : e)),
      run,
    ),
    false,
  );
  assert.equal(
    validateDemoPrefix(
      events.map((e, i) => (i === 2 ? { ...e, source: "unknown source" } : e)),
      run,
    ),
    false,
  );
  assert.equal(validateDemoPrefix(events, "other run"), false);
});

test("validated layout restores reordered references and distinct editable drafts", () => {
  const input = saved();
  input.order.reverse();
  input.drafts[seed[0].id] = "A local draft with Unicode: α 🌒\nSecond line";
  const result = validateSaved(JSON.parse(JSON.stringify(input)));
  assert.deepEqual(result, input);
  assert.equal(new Set(result.order).size, seed.length);
  assert.equal(seed[0].text.includes("A local draft"), false);
});

test("invalid root, layout or draft shapes are rejected rather than partially restored", () => {
  for (const input of [
    null,
    undefined,
    false,
    1,
    "json",
    [],
    {},
    { order: [] },
    { ...saved(), order: "layout" },
    { ...saved(), drafts: null },
    { ...saved(), drafts: "draft" },
  ]) {
    assert.equal(validateSaved(input), null);
  }
  for (const invalid of [undefined, null, 0, false, {}, []]) {
    const input = saved();
    input.drafts[seed[0].id] = invalid;
    assert.equal(validateSaved(input), null);
  }
});

test("persistence rejects duplicate, missing and unrecognized IDs without changing seeds", () => {
  const canonical = structuredClone(seed);
  const ids = seed.map((r) => r.id);
  for (const order of [
    [ids[0], ids[0], ids[2]],
    ids.slice(1),
    [...ids, "extra"],
    [ids[0], ids[1], "foreign"],
    [ids[0], ids[1], null],
    new Array(ids.length),
  ]) {
    assert.equal(validateSaved({ ...saved(), order }), null);
  }
  const missing = saved();
  delete missing.drafts[seed[0].id];
  assert.equal(validateSaved(missing), null);
  assert.deepEqual(seed, canonical);
});

test("draft size bound accepts its limit and rejects excess atomically", () => {
  const input = saved();
  input.drafts[seed[0].id] = "x".repeat(100000);
  assert.equal(validateSaved(input)?.drafts[seed[0].id].length, 100000);
  input.drafts[seed[1].id] = "x".repeat(100001);
  assert.equal(validateSaved(input), null);
});

test("validated draft payload excludes unrelated keys", () => {
  const input = saved();
  input.drafts.unrelated = "must not be restored";
  input.privateExtra = "must not be restored";
  const result = validateSaved(input);
  assert.deepEqual(Object.keys(result).sort(), ["drafts", "order"]);
  assert.deepEqual(
    Object.keys(result.drafts).sort(),
    seed.map((r) => r.id).sort(),
  );
});

test("synthetic fixtures reference canonical resources and keep reported success separate from validation", () => {
  const ids = new Set(seed.map((r) => r.id));
  assert.equal(ids.size, seed.length);
  assert.ok(demoSteps.every((step) => ids.has(step.resource)));
  const reported = demoSteps.findIndex((step) => step.state === "reported");
  const verified = demoSteps.findIndex((step) => step.state === "verified");
  assert.ok(reported >= 0 && verified > reported);
  assert.match(demoSteps[reported].detail, /not verification/i);
  assert.match(
    demoSteps[verified].detail,
    /synthetic.*no design or agent work was verified/i,
  );
});
