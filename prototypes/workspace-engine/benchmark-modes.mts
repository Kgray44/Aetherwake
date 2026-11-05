import { performance } from 'node:perf_hooks';
import { cpus, platform, release } from 'node:os';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { WorkspaceKernel } from '../workspace-kernel/kernel.mts';
import { WorkspaceEngine } from './engine.mts';
import { previewLayout } from './organization.mts';
import type { Command, OrganizationMode } from './contracts.mts';
const bounds = { x: 20, y: 170, width: 1240, height: 650 }, results: object[] = [];
// Predeclared: 3 warm-ups and 20 measured browser-safe policy calls for each
// mode/count/drag-or-resize; construction and SQLite writes are excluded.
for (const count of [3, 10, 25, 50]) {
  const kernel = WorkspaceKernel.open(':memory:'), engine = new WorkspaceEngine(kernel);
  try {
    let state = engine.createWorkspace('Synthetic mode benchmark', null, { mode: 'freeform' });
    let serial = 0;
    const execute = (action: object) => { state = engine.execute({ commandId: `bench-${count}-${++serial}`, workspaceId: state.workspaceId, expectedRevision: state.revision, bounds, ...action } as Command); };
    for (let i = 0; i < count; i++) execute({ type: 'createBlock', resource: { kind: 'note', title: `Synthetic ${i}`, content: 'Fixture' }, presentation: { x: 30 + i % 3 * 300, y: 200 + Math.floor(i / 3) * 230, width: 260, height: 180 } });
    for (const mode of ['fluid', 'freeform', 'structured'] as OrganizationMode[]) {
      execute({ type: 'setOrganization', organization: { mode } });
      const b = state.blocks[0], neighbor = state.blocks[1];
      for (const operation of ['drag', 'resize']) {
        const request = { bounds, placements: [{ blockId: b.blockId, expectedVersion: b.version, presentation: operation === 'drag' ? { x: neighbor.x + 8, y: neighbor.y + 8 } : { width: b.width + 200, height: b.height + 120 } }] };
        const values: number[] = [];
        for (let i = 0; i < 23; i++) {
          const start = performance.now(); previewLayout(state, request);
          if (i >= 3) values.push(performance.now() - start);
        }
        values.sort((a, b) => a - b);
        const p = (n: number) => values[Math.min(values.length - 1, Math.floor(values.length * n))];
        results.push({ blocks: count, mode, operation, p50Ms: p(.5), p95Ms: p(.95), p99Ms: p(.99), maxMs: values.at(-1) });
      }
    }
  } finally { kernel.close(); }
}
const report = JSON.stringify({ schemaVersion: 1, measuredAt: new Date().toISOString(),
  sourceBinding: Object.fromEntries(['organization.mts', 'structured-grid.mts', 'collisions.mts', 'contracts.mts', 'benchmark-modes.mts'].map(file => [file, createHash('sha256').update(readFileSync(new URL(file, import.meta.url))).digest('hex')])),
  measurement: 'pure previewLayout wall time, not displayed rendering, SQLite, native input or frame timing',
  plan: { blocks: [3, 10, 25, 50], warmups: 3, samples: 20, outliersRemoved: false, threshold: null, concurrentWorkloads: 'not sampled or attributed', bounds },
  environment: { node: process.version, platform: platform(), release: release(), cpu: cpus()[0].model }, results,
}, null, 2);
if (process.argv.includes('--output')) writeFileSync(new URL('evidence/mode-preview-benchmark.json', import.meta.url), report + '\n', 'utf8');
console.log(report);
