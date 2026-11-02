import test from "node:test";
import assert from "node:assert/strict";
import { motionPolicy, nextDrawDeadline } from "../src/policy.ts";
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

test("165Hz transition draws cannot postpone 60Hz drawing after motion settles", () => {
  const frame = 1000 / 165,
    cadence = 1000 / 60;
  let now = 0,
    next = 0;
  for (let i = 0; i < 72; i++) {
    now += frame;
    next = nextDrawDeadline(now, next, cadence, i === 0);
    assert(next <= now + cadence + 1e-8);
  }
  const settledAt = now,
    draws = [];
  for (let i = 0; i < 50; i++) {
    now += frame;
    if (now + 0.25 >= next) {
      draws.push(now);
      next = nextDrawDeadline(now, next, cadence, false);
    }
  }
  assert(draws[0] - settledAt <= cadence + frame);
  for (let i = 1; i < draws.length; i++)
    assert(draws[i] - draws[i - 1] <= cadence + frame + 1e-8);
});

test("ordinary cadence retains phase while invalidation and long pauses reset from the actual draw", () => {
  assert.equal(nextDrawDeadline(101, 100, 20, false), 120);
  assert.equal(
    nextDrawDeadline(99.9, 100, 20, false),
    120,
    "ordinary fractional early tolerance retains its phase",
  );
  assert.equal(nextDrawDeadline(101, 100, 20, true), 121);
  assert.equal(nextDrawDeadline(1000, 100, 20, false), 1020);
  assert.equal(nextDrawDeadline(99, 100, 20, false), 119);
});

test("suppressed and zero-cadence policies keep their existing draw semantics", () => {
  assert.equal(nextDrawDeadline(100, 90, Infinity, true), Infinity);
  assert.equal(nextDrawDeadline(100, Infinity, 20, false), 120);
  assert.equal(nextDrawDeadline(100, 90, 0, false), 100);
});
