import type { MotionCoordinator, Pose } from "./motion.ts";

/** Transient gesture observation only; canonical preview owns every destination. */
export type DirectCardGesture = Readonly<{
  blockId: string;
  intent: "move" | "resize";
  phase: "active" | "committing";
}>;

export function targetDirectCard(
  motion: MotionCoordinator,
  id: string,
  destination: Pose,
  cause: string,
  gesture?: DirectCardGesture | null,
) {
  const own = gesture?.blockId === id ? gesture : null;
  motion.target(
    id,
    own?.intent === "move" ? { ...destination, lift: 55, yaw: 0 } : destination,
    cause,
  );
  // An edge stays directly under its resize handle. Moving cards retain the
  // shared spring, its current position and velocity, in every layout mode.
  if (own?.intent === "resize" && own.phase === "active") motion.snap(id);
}

export function directCardLayer(
  savedLayer: number,
  gesture?: DirectCardGesture | null,
) {
  return gesture?.intent === "move" ? Math.max(150000, savedLayer) : savedLayer;
}
