import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeVelaFact } from '../src/adaptive-routing.ts';
import { calculate, calculatorExpression } from '../src/calculator.ts';
import { aggregateGpuEngines, readCpuUtilization } from '../src/system-utilization.mts';

test('the local calculator supports precedence, parentheses, signs, percentages and finite powers', () => {
  for (const [intent, expected] of [
    ['Vela, what’s 15% of 240?', 36],
    ['What is (8 − 2) × 7?', 42],
    ['-2^2 + 2^3^2', 508],
    ['2^-3', 0.125],
    ['Compute sqrt(144) plus 3e2.', 312],
    ['10 ÷ (2 + 3)', 2],
    ['Could you calculate 16 divided by 4?', 4],
  ] as const) {
    const expression = calculatorExpression(intent);
    assert(expression, intent);
    assert.equal(calculate(expression), expected);
  }
  assert.throws(() => calculate('1/0'), /division_by_zero/);
  assert.throws(() => calculate('10^1000'), /result_out_of_range/);
  assert.throws(() => calculate('sqrt(-4)'), /square_root_domain/);
  assert.throws(() => calculate('1 2'), /invalid_expression/);
});

test('Level 0 does not absorb mixed requests or run arbitrary expressions', () => {
  for (const text of ['Show CPU usage, then edit README.md', 'What is GPU utilization in a game?', 'calculate process.exit()', 'what’s your GPU usage?', 'How can I calculate my tax bill?'])
    assert.equal(nativeVelaFact(text), undefined, text);
  assert.equal(nativeVelaFact('Vela, check the current CPU load'), 'system.cpu');
  assert.equal(nativeVelaFact('What is my GPU utilization right now?'), 'system.gpu');
  assert.equal(nativeVelaFact('How many active Aerynth projects do I have?'), 'local.project-count');
  assert.equal(nativeVelaFact('Could you check my CPU usage, please?'), 'system.cpu');
});

test('GPU counters aggregate processes on the same engine, keeping distinct engines and adapters separate', () => {
  const row = (pid: number, adapter: string, engine: number, percent: number) => ({
    Name: `pid_${pid}_luid_0x00000000_0x${adapter}_phys_0_eng_${engine}_engtype_3D`, UtilizationPercentage: percent,
  });
  const rows = [row(1, '10', 0, 25), row(2, '10', 0, 22), row(3, '10', 1, 10), row(4, '20', 0, 12)];
  assert.deepEqual(aggregateGpuEngines(rows), { percent: 47, observedAdapters: 2, observedEngines: 3 });
  assert.throws(() => aggregateGpuEngines([]), /gpu_counters_unavailable/);
  assert.throws(() => aggregateGpuEngines([...rows, rows[0]]), /invalid_gpu_instance/);
  assert.throws(() => aggregateGpuEngines([row(1, '10', 0, 70), row(2, '10', 0, 70)]), /inconsistent_gpu_counters/);
});

test('the CPU sampler reads host counters with an actual elapsed sample interval', async () => {
  const sample = await readCpuUtilization();
  assert.equal(sample.metric, 'cpu');
  assert.equal(sample.source, 'node:os.cpus');
  assert(sample.percent >= 0 && sample.percent <= 100);
  assert(sample.metric === 'cpu' && sample.sampleMs >= 200 && sample.logicalCpus > 0);
});
