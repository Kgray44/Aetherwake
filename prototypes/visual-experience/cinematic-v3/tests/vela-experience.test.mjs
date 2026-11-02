import test from "node:test";
import assert from "node:assert/strict";
import { MotionCoordinator } from "../src/motion.ts";
import { createVelaExperience } from "../src/vela-experience.ts";

const policy = {
  tier: "balanced",
  reduced: false,
  quiet: false,
  hidden: false,
  graphicsAvailable: true,
};
const observation = (extra) => ({
  phase: "idle",
  context: null,
  messageIds: ["saved"],
  planIds: [],
  ...extra,
});
function fixture() {
  const motion = new MotionCoordinator(),
    properties = new Map(),
    sizes = [];
  const root = {
    style: { setProperty: (k, v) => properties.set(k, v) },
    dataset: {},
    querySelectorAll: () => [],
    querySelector: () => null,
  };
  const experience = createVelaExperience({
    motion,
    root,
    wake() {},
    resize: (size) => sizes.push(size),
  });
  return { motion, root, properties, sizes, experience };
}

test("saved history is baseline; only new canonical IDs arrive, with a bounded shared coordinator lifetime", () => {
  const { motion, experience } = fixture();
  experience.setActive(true);
  experience.observe(observation());
  assert.equal(experience.diagnostics().entries[0].pose.opacity, 1);
  experience.observe(observation({ messageIds: ["saved", "actual-new"] }));
  assert.equal(
    experience.diagnostics().entries.find((e) => e.id === "actual-new").pose
      .opacity,
    0,
  );
  motion.step(1 / 60);
  const before = experience
    .diagnostics()
    .entries.find((e) => e.id === "actual-new").pose;
  experience.observe(
    observation({ phase: "planning", messageIds: ["saved", "actual-new"] }),
  );
  assert.deepEqual(
    experience.diagnostics().entries.find((e) => e.id === "actual-new").pose,
    before,
  );
  experience.observe(
    observation({
      messageIds: Array.from({ length: 100 }, (_, i) => "m" + i),
      planIds: Array.from({ length: 30 }, (_, i) => "p" + i),
    }),
  );
  assert.equal(experience.diagnostics().entries.length, 24);
  assert.equal(motion.bodies.size, 25);
  experience.setActive(false);
  assert.equal(motion.bodies.size, 0);
  experience.setActive(true);
  assert(
    experience.diagnostics().entries.every((e) => e.pose.opacity === 1),
    "reopening must not replay saved history",
  );
  experience.dispose();
  assert.equal(motion.bodies.size, 0);
});

test("actual context and phase retarget in place, while quiet/reduced/graphics loss reconcile without loops", () => {
  const { motion, experience, properties, sizes } = fixture();
  experience.setActive(true);
  experience.observe(observation({ messageIds: [] }));
  assert.deepEqual(experience.size(), { width: 440, height: 150 });
  experience.observe(observation({ phase: "review", context: "sources" }));
  assert.deepEqual(sizes.at(-1), { width: 520, height: 580 });
  motion.step(1 / 60);
  experience.frame(policy);
  assert(
    Number(properties.get("--vela-context-reveal")) > 0 &&
      Number(properties.get("--vela-context-reveal")) < 1,
  );
  const during = experience.diagnostics().energy;
  experience.observe(observation({ phase: "idle" }));
  assert.equal(experience.diagnostics().energy, during);
  experience.frame({ ...policy, quiet: true });
  assert.equal(experience.diagnostics().energy, 0);
  assert.equal(
    properties.get("--vela-reveal"),
    "1",
    "idle composer remains visible",
  );
  experience.observe(
    observation({ phase: "applying", messageIds: ["saved", "new"] }),
  );
  experience.frame({ ...policy, graphicsAvailable: false });
  assert(experience.diagnostics().entries.every((e) => e.pose.opacity === 1));
  experience.observe(observation({ phase: "review" }));
  experience.frame({ ...policy, reduced: true });
  assert.equal(experience.diagnostics().energy, 0.35);
  experience.dispose();
});
