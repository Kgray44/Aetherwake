export interface FrameStats {
  count: number;
  durationMs: number;
  medianMs: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
}
export function percentiles(samples: number[], durationMs: number): FrameStats {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p: number) =>
    sorted.length
      ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)]
      : 0;
  return {
    count: sorted.length,
    durationMs,
    medianMs: at(0.5),
    p95Ms: at(0.95),
    p99Ms: at(0.99),
    maxMs: sorted.at(-1) || 0,
  };
}
export async function sampleFrames(
  durationMs: number,
  work?: () => void,
): Promise<FrameStats> {
  return new Promise((resolve) => {
    const samples: number[] = [];
    const start = performance.now();
    let previous = 0;
    const frame = (now: number) => {
      if (previous) samples.push(now - previous);
      previous = now;
      work?.();
      if (now - start < durationMs) requestAnimationFrame(frame);
      else resolve(percentiles(samples, now - start));
    };
    requestAnimationFrame(frame);
  });
}
