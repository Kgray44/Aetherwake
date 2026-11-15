import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const schema = JSON.parse(readFileSync(fileURLToPath(new URL("../agent-system/contracts/v1.schema.json", import.meta.url)), "utf8"));
const kinds = ["task", "attempt", "evidence", "telemetry", "context_snapshot", "verification_profile"];
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
