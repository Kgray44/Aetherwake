import test from "node:test";
import assert from "node:assert/strict";
import { MotionCoordinator } from "../src/motion.ts";
import {
  targetDirectCard,
  directCardLayer,
} from "../src/direct-card-motion.ts";
import {
  previewLayout,
  defaultOrganization,
} from "../../../workspace-engine/organization.mts";

const pose = (block) => ({
  x: block.x,
  y: block.y,
  w: block.width,
  h: block.height,
  lift: 0,
  yaw: 0,
  opacity: 1,
});
const state = (mode) => ({
  revision: 2,
  viewport: { x: 0, y: 0, zoom: 1 },
  organization: { ...defaultOrganization(), mode },
  presence: {
    id: "system:vela",
    x: 900,
    y: 500,
    width: 104,
    height: 130,
    locked: false,
  },
  blocks: [
    {
      blockId: "card",
      resourceId: "note",
      workspaceId: "workspace",
      version: 1,
      x: 77,
      y: 233,
      width: 320,
      height: 260,
      zIndex: 2,
      shape: "rounded",
      rotation: 0,
      locked: false,
      minimized: false,
      materialVariant: "default",
      contentMode: "reading",
      resourceState: "active",
    },
  ],
});

for (const mode of ["fluid", "freeform", "structured"])
  test(
    mode +
      " follows the actual engine outline with continuous spring position and velocity",
    () => {
      const canonical = state(mode),
        before = structuredClone(canonical),
        motion = new MotionCoordinator();
      motion.add("card", pose(canonical.blocks[0]));
      const preview = (x) =>
        previewLayout(canonical, {
          intent: "move",
          expectedRevision: 2,
          placements: [
            {
              blockId: "card",
              expectedVersion: 1,
              presentation: { x, y: 317 },
            },
          ],
        });
      const first = preview(263),
        gesture = { blockId: "card", intent: "move", phase: "active" };
      assert.equal(first.placementAreas.length, 1);
      const outline = first.placementAreas[0];
      targetDirectCard(
        motion,
        "card",
        pose(first.blocks[0]),
        "native pointer preview",
        gesture,
      );
      assert.equal(
        motion.pose("card").x,
        before.blocks[0].x,
        "retargeting must not teleport the card to the outline",
      );
      assert.equal(motion.bodies.get("card").channels.x.target, outline.x);
      motion.step(1 / 60);
      const following = motion.pose("card"),
        velocity = motion.bodies.get("card").channels.x.velocity;
      assert(following.x > before.blocks[0].x && following.x < outline.x);
      assert(velocity > 0);
      const next = preview(339);
      targetDirectCard(
        motion,
        "card",
        pose(next.blocks[0]),
        "retarget pointer",
        gesture,
      );
      assert.deepEqual(motion.pose("card"), following);
      assert.equal(motion.bodies.get("card").channels.x.velocity, velocity);
      targetDirectCard(
        motion,
        "card",
        pose(next.blocks[0]),
        "await canonical commit",
        { ...gesture, phase: "committing" },
      );
      for (let i = 0; i < 120; i++) motion.step(1 / 60);
      assert.equal(motion.pose("card").x, next.placementAreas[0].x);
      assert.equal(motion.pose("card").lift, 55);
      assert.deepEqual(
        canonical,
        before,
        "painting and spring motion never persist a layout",
      );
      if (mode === "structured") assert.equal(next.placementAreas[0].x % 16, 0);
      targetDirectCard(
        motion,
        "card",
        pose(next.blocks[0]),
        "release settles lift",
      );
      for (let i = 0; i < 120; i++) motion.step(1 / 60);
      assert.equal(motion.pose("card").lift, 0);
    },
  );

test("resize edge precision, reduced motion and one shared DOM/GPU drag layer remain intact", () => {
  const motion = new MotionCoordinator(),
    origin = pose(state("freeform").blocks[0]),
    target = { ...origin, w: 480, h: 400 };
  motion.add("card", origin);
  targetDirectCard(motion, "card", target, "edge resize", {
    blockId: "card",
    intent: "resize",
    phase: "active",
  });
  assert.deepEqual(motion.pose("card"), target);
  motion.reduced = true;
  targetDirectCard(motion, "card", { ...target, x: 500 }, "reduced move", {
    blockId: "card",
    intent: "move",
    phase: "active",
  });
  assert.equal(motion.pose("card").x, 500);
  assert.equal(motion.bodies.get("card").transitioning, false);
  assert.equal(directCardLayer(9, { intent: "move" }), 150000);
  assert.equal(directCardLayer(9, { intent: "resize" }), 9);
  assert.equal(directCardLayer(9), 9);
});
