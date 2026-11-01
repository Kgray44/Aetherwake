export type GraphicsTier = "cinematic" | "balanced" | "efficient";
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
