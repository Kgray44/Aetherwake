export type RendererTiming = { frameP95Ms: number; budgetRatioP95: number; samples: number; windowMs: number };
export type HostPower = {
  suspended: boolean;
  battery: boolean | null;
  idleSeconds: number | null;
  speedLimitPercent: number | null;
};
export type ResourceSignal = { rendererTiming: RendererTiming } | { hostPower: HostPower } | { aerynthFocused: boolean };

const record = (input: unknown): input is Record<string, unknown> => !!input && typeof input === 'object' && !Array.isArray(input);
const inRange = (value: unknown, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

export function isResourceSignal(input: unknown): input is ResourceSignal {
  if (!record(input) || Object.keys(input).length !== 1) return false;
  if (Object.hasOwn(input, 'aerynthFocused')) return typeof input.aerynthFocused === 'boolean';
  if (Object.hasOwn(input, 'rendererTiming')) {
    const sample = input.rendererTiming;
    return record(sample) && Object.keys(sample).length === 4 &&
      inRange(sample.frameP95Ms, 1, 1000) && inRange(sample.budgetRatioP95, 0.01, 60) &&
      Number.isSafeInteger(sample.samples) && inRange(sample.samples, 12, 256) &&
      inRange(sample.windowMs, 1000, 5000);
  }
  const power = input.hostPower;
  return Object.hasOwn(input, 'hostPower') && record(power) && Object.keys(power).length === 4 &&
    typeof power.suspended === 'boolean' && (power.battery === null || typeof power.battery === 'boolean') &&
    (power.idleSeconds === null || Number.isSafeInteger(power.idleSeconds) && inRange(power.idleSeconds, 0, 2 ** 31 - 1)) &&
    (power.speedLimitPercent === null || inRange(power.speedLimitPercent, 0, 100));
}
