type FrameTiming = { frameP95Ms: number; budgetRatioP95: number; samples: number; windowMs: number };

/** Measures an existing animation loop. Zero cadence marks intentionally paced or idle frames. */
export function createResourceTiming(publish: (sample: FrameTiming) => void) {
  const intervals: number[] = [], ratios: number[] = [];
  let started = 0;
  function reset() { intervals.length = ratios.length = 0; started = 0; }
  const p95 = (values: number[]) => values.sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]!;
  return {
    reset,
    observe(now: number, interval: number, cadence: number) {
      if (!Number.isFinite(cadence) || cadence <= 0 || interval < 1 || interval > 1000) { reset(); return; }
      if (!started) started = now;
      if (intervals.length < 256) {
        intervals.push(interval);
        ratios.push(Math.min(60, Math.max(0.01, interval / cadence)));
      }
      const windowMs = now - started;
      if (windowMs < 2000) return;
      if (windowMs <= 5000 && intervals.length >= 12) {
        publish({ frameP95Ms: p95(intervals), budgetRatioP95: p95(ratios), samples: intervals.length, windowMs });
      }
      reset();
    },
  };
}
