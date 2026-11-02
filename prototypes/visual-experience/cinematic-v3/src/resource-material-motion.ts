import { clamp, type MotionCoordinator } from "./motion.ts";
const neutral = { x: 0, y: 0, w: 0, h: 0, lift: 0, yaw: 0, opacity: 1 };
export const materialMotionKey = (id: string) => `material:${id}`;
/** Semantic optical unfolding shares the existing coordinator, independently
 * of placement/resize geometry. No additional scheduler or canonical store. */
export function registerResourceMaterial(
  motion: MotionCoordinator,
  id: string,
) {
  motion.add(materialMotionKey(id), neutral);
}
export function targetResourceMaterial(
  motion: MotionCoordinator,
  id: string,
  expanded: boolean,
  cause: string,
  receded = false,
) {
  motion.target(
    materialMotionKey(id),
    { ...neutral, x: expanded ? 1 : 0, y: receded ? 1 : 0 },
    `optical unfolding: ${cause}`,
  );
}
export function resourceUnfold(motion: MotionCoordinator, id: string) {
  return clamp(motion.pose(materialMotionKey(id)).x, 0, 1);
}
/** Peripheral content follows semantic focus, including blur/reduced snaps;
 * arbitrary canonical dimensions and zoom never determine label visibility. */
export function resourceDock(motion: MotionCoordinator, id: string) {
  return clamp(motion.pose(materialMotionKey(id)).y, 0, 1);
}
