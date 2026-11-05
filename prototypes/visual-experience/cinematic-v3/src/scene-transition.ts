import { MotionCoordinator, type Pose } from "./motion.ts";

export type SceneName = "architecture" | "living" | "observatory";
export type SceneWeights = Record<SceneName, number>;
const identity = "environment:scene";

function target(scene: SceneName): Pose {
  return {
    x: scene === "architecture" ? 1 : 0,
    y: scene === "living" ? 1 : 0,
    w: scene === "observatory" ? 1 : 0,
    h: 0,
    lift: 0,
    yaw: 0,
    opacity: 1,
  };
}

/** Scene appearance uses the same clock, spring solver and interruption receipts as resources. */
export function registerScene(motion: MotionCoordinator, scene: SceneName) {
  motion.add(identity, target(scene));
}
export function retargetScene(motion: MotionCoordinator, scene: SceneName) {
  motion.target(identity, target(scene), `scene:${scene}`);
}
export function sceneWeights(motion: MotionCoordinator): SceneWeights {
  const pose = motion.pose(identity);
  // Reversing a critically damped channel retains velocity. Clamp the small
  // possible overshoot before normalization so radiance never goes negative.
  const a = Math.max(0, pose.x),
    b = Math.max(0, pose.y),
    c = Math.max(0, pose.w);
  const sum = a + b + c || 1;
  return { architecture: a / sum, living: b / sum, observatory: c / sum };
}
