import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validateRecord } from "../scripts/agent/validate-record.mjs";
const schema = JSON.parse(readFileSync(fileURLToPath(new URL("../agent-system/contracts/v1.schema.json", import.meta.url)), "utf8"));
const kinds = ["task", "attempt", "evidence", "telemetry", "context_snapshot", "verification_profile"];
// Synthetic contract fixture; vary one timestamp at a time.
function datedRecord(created_at) {
  return { schema_version: 1, record_type: "telemetry", id: "telemetry_fixture",
    created_at, repository: "example/fixture", revision: "a".repeat(40),
    task_id: "task_fixture", attempt_id: "attempt_fixture", phase: "verification",
    observed_at: "2026-11-16T00:00:00Z", measurements: [] };
}

test("record dates preserve UTC, offsets, fractions and Gregorian leap days", () => {
  for (const timestamp of [
    "2026-01-01T00:00:00Z", "2026-04-30T23:59:59.123Z",
    "2024-02-29T00:00:00Z", "2000-02-29T00:00:00Z",
    "2024-02-29T00:15:00+05:30", "2024-02-29T23:45:00.123-04:00",
    "2026-01-01T00:00:00+00:00"
  ]) assert.deepEqual(validateRecord(datedRecord(timestamp)), [], timestamp);
});

test("record dates reject impossible Gregorian days even when parsing normalizes them", () => {
  for (const timestamp of [
    "2026-02-30T00:00:00Z", "2026-02-29T00:00:00Z",
    "1900-02-29T00:00:00Z", "2100-02-29T00:00:00Z",
    "2024-02-30T00:00:00+05:30", "2026-04-31T23:45:00.123-04:00",
    "2026-06-31T00:00:00Z", "2026-09-31T00:00:00Z", "2026-11-31T00:00:00Z"
  ]) {
    assert.ok(Number.isFinite(Date.parse(timestamp)), "normalization fixture: " + timestamp);
    assert.notDeepEqual(validateRecord(datedRecord(timestamp)), [], timestamp);
  }
});
test("v1 contract is a closed set of task-centric record types", () => {
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.oneOf.length, kinds.length);
  for (const kind of kinds) {
    const name = kind.split("_").map(s => s[0].toUpperCase() + s.slice(1)).join("");
    const def = schema.$defs[name];
    assert.ok(def, name);
    assert.equal(def.additionalProperties, false);
    assert.equal(def.properties.record_type.const, kind);
    assert.equal(def.properties.schema_version.const, 1);
    for (const key of ["id", "repository", "revision", "created_at"]) {
      assert.ok(def.required.includes(key), kind + " missing " + key);
    }
  }
});
test("engineering task identity is durable and not numbered by historical missions", () => {
  const task = schema.$defs.Task;
  assert.ok(task.required.includes("objective"));
  assert.ok(task.required.includes("prerequisites"));
  assert.ok(task.required.includes("acceptance"));
  assert.ok(task.required.includes("state"));
  assert.ok(task.properties.prerequisites.properties.task_ids);
  assert.ok(!task.properties.mission_number);
  assert.ok(!JSON.stringify(schema).includes("eleven_missions"));
  assert.ok(task.properties.state.enum.includes("accepted"));
  assert.ok(task.properties.state.enum.includes("blocked"));
});
test("telemetry and evidence preserve measurement uncertainty and provenance", () => {
  const measurements = schema.$defs.Telemetry.properties.measurements.items;
  assert.deepEqual(measurements.properties.availability.enum, ["observed", "estimated", "unavailable"]);
  assert.ok(measurements.required.includes("availability"));
  for (const name of ["task_id", "attempt_id", "criterion_id", "observed_at", "artifact"]) {
    assert.ok(schema.$defs.Evidence.required.includes(name));
  }
});
test("critical acceptance remains distinct from PR merges and is explicitly reviewed", () => {
  assert.deepEqual(schema.$defs.Task.properties.owner_acceptance.enum, ["not_reviewed", "accepted", "rejected", "not_required"]);
  assert.ok(schema.$defs.VerificationProfile.properties.blocking_policy.enum.includes("enforce"));
  assert.ok(schema.$defs.VerificationProfile.properties.blocking_policy.enum.includes("report_only"));
});
