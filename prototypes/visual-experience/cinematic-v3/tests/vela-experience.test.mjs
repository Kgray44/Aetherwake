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
function fixture(phaseOnly = false, anchor) {
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
    anchor,
    wake() {},
    resize: (size) => sizes.push(size),
    phaseOnly,
  });
  return { motion, root, properties, sizes, experience };
}

test("a submitted request keeps the ribbon morphing after closing and settles when the request ends", () => {
  const { motion, experience } = fixture(true, {});
  experience.setActive(true);
  experience.observe(observation({ phase: "thinking" }));
  experience.setActive(false);
  const frame = (overrides = {}) => {
    motion.step(0.12);
    experience.frame({ ...policy, ...overrides });
    return experience.ribbonThinking();
  };
  const first = frame();
  const samples = Array.from({ length: 16 }, () => frame());
  assert(first > 0 && first < 1);
  assert.equal(samples.at(-1), 1);
  const reduced = frame({ reduced: true });
  assert.equal(frame({ reduced: true }), reduced);
  experience.observe(observation());
  for (let i = 0; i < 12; i++) frame();
  assert.equal(experience.ribbonThinking(), 0);
  assert.equal(motion.bodies.size, 0);
});

test("manifestation ownership keeps the old experience phase-only, without ready-content arrivals or competing sizing", () => {
  const f = fixture(true);
  f.experience.setActive(true);
  f.experience.observe(observation());
  f.experience.observe(
    observation({
      phase: "planning",
      messageIds: ["saved", "new-canonical-response"],
      planIds: ["new-plan"],
    }),
  );
  f.motion.step(1 / 60);
  f.experience.frame(policy);
  assert.equal(f.motion.bodies.size, 1);
  assert.deepEqual(f.experience.diagnostics().entries, []);
  assert.deepEqual(f.sizes, []);
  assert.equal(f.properties.get("--vela-reveal"), "1");
  f.experience.setActive(false);
  assert.equal(f.motion.bodies.size, 0);
});

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
  motion.step(1 / 60);
  experience.frame(policy);
  assert.deepEqual(sizes.at(-1), { width: 520, height: 580 });
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

test("content resize never measures or writes during observer delivery and drains only while active", () => {
  const previous = globalThis.ResizeObserver;
  let delivery,
    inDelivery = false,
    measurements = 0,
    disconnected = 0;
  globalThis.ResizeObserver = class {
    constructor(callback) {
      delivery = callback;
    }
    observe() {}
    disconnect() {
      disconnected++;
    }
  };
  const motion = new MotionCoordinator(),
    sizes = [];
  let height = 100;
  const composer = {
    getBoundingClientRect() {
      assert.equal(inDelivery, false, "no synchronous observer layout read");
      measurements++;
      return { height };
    },
  };
  const root = {
    style: { setProperty() {} },
    dataset: {},
    querySelectorAll: () => [],
    querySelector: (selector) =>
      selector === ".vela-core-compose" ? composer : null,
  };
  const experience = createVelaExperience({
    motion,
    root,
    wake() {},
    resize(size) {
      assert.equal(inDelivery, false, "no synchronous observer resize write");
      sizes.push(size);
    },
  });
  const notify = () => {
    inDelivery = true;
    try {
      delivery([]);
    } finally {
      inDelivery = false;
    }
  };
  try {
    experience.observe(observation({ messageIds: [] }));
    experience.setActive(true);
    experience.frame(policy);
    const initial = measurements;
    height = 210;
    notify();
    notify();
    notify();
    assert.equal(measurements, initial);
    assert.equal(sizes.length, 1);
    experience.frame(policy);
    assert.equal(measurements, initial + 1);
    assert.deepEqual(sizes.at(-1), { width: 440, height: 238 });
    experience.frame(policy);
    assert.equal(sizes.length, 2, "unchanged frames do not resize again");
    notify();
    experience.setActive(false);
    experience.frame(policy);
    notify();
    assert.equal(sizes.length, 2, "closing drops pending sizing work");
    assert(disconnected > 0);
  } finally {
    experience.dispose();
    if (previous === undefined) delete globalThis.ResizeObserver;
    else globalThis.ResizeObserver = previous;
  }
});

test("an empty source search uses its measured content rather than a standing large panel", () => {
  const motion = new MotionCoordinator(),
    context = { scrollHeight: 100 };
  const root = {
    style: { setProperty() {} },
    dataset: {},
    querySelectorAll: () => [],
    querySelector: (selector) =>
      selector === ".vela-core-compose"
        ? { getBoundingClientRect: () => ({ height: 100 }) }
        : context,
  };
  const experience = createVelaExperience({
    motion,
    root,
    wake() {},
    resize() {},
  });
  experience.setActive(true);
  experience.observe(observation({ context: "sources", messageIds: [] }));
  assert.deepEqual(experience.size(), { width: 520, height: 286 });
  context.scrollHeight = 1000;
  assert.equal(
    experience.size().height,
    640,
    "actual results remain locally bounded",
  );
  experience.dispose();
});
