export type GraphicsTier = "cinematic" | "balanced" | "efficient";

/** A responsive transition may draw before its tier deadline. Start its next
 * interval from that actual draw instead of accumulating future time debt. */
export function nextDrawDeadline(
  now: number,
  previous: number,
  cadence: number,
  invalidated: boolean,
) {
  if (!Number.isFinite(cadence)) return Infinity;
  return invalidated ||
    !Number.isFinite(previous) ||
    now < previous ||
    now - previous > cadence * 4
    ? now + cadence
    : previous + cadence;
}

export function motionPolicy(input: {
  tier: GraphicsTier;
  idle: boolean;
  quiet: boolean;
  reduced: boolean;
  ambient: boolean;
  unavailable: boolean;
  transitioning: boolean;
}) {
  const activeCadence =
    input.tier === "cinematic"
      ? 0
      : input.tier === "balanced"
        ? 1000 / 60
        : 1000 / 15;
  if (input.reduced) return { continuous: false, cadenceMs: Infinity };
  if (input.transitioning)
    return { continuous: true, cadenceMs: activeCadence };
  if (input.quiet || !input.ambient || input.unavailable)
    return { continuous: false, cadenceMs: Infinity };
  return {
    continuous: true,
    cadenceMs: input.idle
      ? input.tier === "cinematic"
        ? 1000 / 60
        : input.tier === "balanced"
          ? 1000 / 30
          : 1000 / 12
      : activeCadence,
  };
}
