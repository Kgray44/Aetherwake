/**
 * Distribution-free two-sided sign interval for the population median of
 * independent matched-pair effects. It does not assume normal latencies.
 * Return the narrowest order-statistic interval with at least 95% coverage.
 */
export function summarizePairedTrials(effects: readonly (number | null)[]) {
  const values = effects.filter((effect): effect is number => effect !== null && Number.isFinite(effect))
    .sort((a, b) => a - b);
  const n = values.length;
  const coverage = { enrolled: effects.length, measured: n };
  if (!n || n !== effects.length) return { ...coverage, median: null, interval: null };
  const median = (values[Math.floor((n - 1) / 2)] + values[Math.floor(n / 2)]) / 2;
  let interval: { lower: number; upper: number; coverage: number } | null = null;
  let mass = 2 ** -n;
  let tail = mass;
  for (let index = 0; index < Math.floor(n / 2) && tail <= 0.025; index++) {
    interval = { lower: values[index], upper: values[n - 1 - index], coverage: 1 - 2 * tail };
    mass *= (n - index) / (index + 1);
    tail += mass;
  }
  return { ...coverage, median, interval };
}
