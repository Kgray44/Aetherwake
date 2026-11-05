import { performance } from 'node:perf_hooks';
import { cpus, platform, release } from 'node:os';
import { resolveCollisions, footprint, intersects, type CollisionPlacement } from './collisions.mts';
const bounds = { x: 20, y: 170, width: 1240, height: 600 }, results: object[] = [];
// Predeclared stress fixture: same point, every fifth card rotated, 3 warm-ups,
// 20 samples at each count, no outlier removal, no native acceptance threshold.
for (const count of [0, 1, 10, 25, 50]) {
  const items: CollisionPlacement[] = Array.from({ length: count }, (_, i) => ({
    id: `fixture-${String(i).padStart(3, '0')}`, x: 480, y: 170, width: 240, height: 180,
    rotation: i % 5 === 0 ? 12 : 0, locked: false,
  }));
  items.push({ id: 'system:vela', x: 480, y: 64, width: 208, height: 260, locked: false, keepVisible: true });
  const values: number[] = []; let result: CollisionPlacement[] = [];
  for (let i = 0; i < 23; i++) {
    const start = performance.now(); result = resolveCollisions(items, ['fixture-000'], bounds);
    if (i >= 3) values.push(performance.now() - start);
  }
  for (let i = 0; i < result.length; i++) for (let j = i + 1; j < result.length; j++)
    if (intersects(footprint(result[i]), footprint(result[j]))) throw new Error('Fixture collision');
  values.sort((a, b) => a - b);
  const percentile = (p: number) => values[Math.min(values.length - 1, Math.floor(values.length * p))];
  results.push({ blocks: count, presence: 1, p50Ms: percentile(.5), p95Ms: percentile(.95), p99Ms: percentile(.99), maxMs: values.at(-1) });
}
console.log(JSON.stringify({ schemaVersion: 1, measuredAt: new Date().toISOString(),
  measurement: 'pure resolver wall time; not SQLite, native input or frame time',
  plan: { warmups: 3, samples: 20, rotatedEveryFifth: true, initialOverlap: 'all blocks at one point', bounds, gap: 12, concurrentWorkloads: 'not sampled or attributed' },
  environment: { node: process.version, platform: platform(), release: release(), cpu: cpus()[0].model }, results,
}, null, 2));
