import { performance } from 'node:perf_hooks';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir, platform, release, cpus } from 'node:os';
import { join } from 'node:path';
import { WorkspaceKernel } from '../workspace-kernel/kernel.mts';
import { WorkspaceEngine } from './engine.mts';
import type { Command } from './contracts.mts';
// Predeclared exploratory plan: disk-backed 50 blocks, 10 warmups, 100 writes,
// 100 projections, 3 independent databases. No rendering or acceptance threshold.
const percentile = (xs: number[], p: number) => xs.toSorted((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))];
const results: object[] = [];
for (let trial = 0; trial < 3; trial++) {
  const dir = mkdtempSync(join(tmpdir(), 'aetherwake-engine-benchmark-')), path = join(dir, 'synthetic.sqlite');
  const kernel = WorkspaceKernel.open(path), engine = new WorkspaceEngine(kernel);
  try {
    let state = engine.createWorkspace('Synthetic benchmark');
    const call = (action: object) => { state = engine.execute({ commandId: `fixture-${trial}-${state.revision}`, workspaceId: state.workspaceId, expectedRevision: state.revision, ...action } as Command); };
    for (let i = 0; i < 50; i++) call({ type: 'createBlock', resource: { kind: 'note', title: `Synthetic ${i}`, content: 'Fixture' } });
    const times: number[] = [], reads: number[] = [];
    for (let i = 0; i < 110; i++) {
      const b = state.blocks[i % state.blocks.length], start = performance.now();
      call({ type: 'moveBlock', blockId: b.blockId, x: i * 4, y: i * 3 });
      if (i >= 10) times.push(performance.now() - start);
    }
    for (let i = 0; i < 100; i++) { const start = performance.now(); engine.project(state.workspaceId); reads.push(performance.now() - start); }
    results.push({ trial: trial + 1, writeMs: { p50: percentile(times, .5), p95: percentile(times, .95), p99: percentile(times, .99) }, projectMs: { p50: percentile(reads, .5), p95: percentile(reads, .95), p99: percentile(reads, .99) }, databaseBytes: statSync(path).size });
  } finally { kernel.close(); rmSync(dir, { recursive: true, force: true }); }
}
console.log(JSON.stringify({ measured: 'local synchronous engine wall time, not native usability or frame time', environment: { node: process.version, platform: platform(), release: release(), cpu: cpus()[0].model }, plan: { blocks: 50, warmups: 10, writes: 100, projections: 100, trials: 3 }, results }, null, 2));
