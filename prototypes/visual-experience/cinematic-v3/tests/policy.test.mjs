import test from "node:test";
import assert from "node:assert/strict";
import { motionPolicy } from "../src/policy.ts";
const base = {
  tier: "balanced",
  idle: true,
  quiet: false,
  reduced: false,
  ambient: true,
  unavailable: false,
  transitioning: false,
};
test("visible idle keeps independent ambient motion at a lower cadence in every tier", () => {
  for (const tier of ["cinematic", "balanced", "efficient"]) {
    const idle = motionPolicy({ ...base, tier }),
      active = motionPolicy({ ...base, tier, idle: false });
    assert.equal(idle.continuous, true);
    assert.ok(idle.cadenceMs > active.cadenceMs);
  }
  assert.equal(motionPolicy(base).cadenceMs, 1000 / 30);
});
test("reduced, quiet, unavailable and explicit ambient-off suppress autonomous loops", () => {
  for (const policy of [
    { reduced: true },
    { quiet: true },
    { unavailable: true },
    { ambient: false },
  ])
    assert.deepEqual(motionPolicy({ ...base, ...policy }), {
      continuous: false,
      cadenceMs: Infinity,
    });
});
test("quiet and ambient-off preserve real transition scheduling while reduced stays immediate", () => {
  assert.equal(
    motionPolicy({ ...base, quiet: true, ambient: false, transitioning: true })
      .continuous,
    true,
  );
  assert.equal(
    motionPolicy({ ...base, reduced: true, transitioning: true }).continuous,
    false,
  );
});
