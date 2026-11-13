import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { planBackendShards, verifyWindowsReports, workerLossCase, windowsAddonCase } from './aerynth-backend-shards.mjs';

test('discovers new backend files and assigns each top-level test to exactly one lane', t => {
  const root = mkdtempSync(join(tmpdir(), 'aerynth-shards-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'tests', 'fixtures'), { recursive: true });
  const files = ['a', 'b', 'c', 'd', 'e'].map(name => `tests/${name}.test.mts`);
  for (const file of [...files, 'tests/fixtures/nested.test.mts', 'tests/not-a-test.mts']) writeFileSync(join(root, file), '');
  const weights = Object.fromEntries(files.slice(0, 4).map((file, index) => [file, 80_000 - index * 20_000]));
  const before = planBackendShards(root, weights);
  writeFileSync(join(root, 'tests', 'new.test.mts'), '');
  const after = planBackendShards(root, weights);
  assert.deepEqual(before, [[[files[0]], [files[1]]], [[files[2]], [files[3], files[4]]]]);
  assert.deepEqual(after.flat(2).sort(), [...files, 'tests/new.test.mts'].sort());
  assert.deepEqual(planBackendShards(root, weights), after);
});

test('schedules planning and ordinary Responses on opposite Windows runners', t => {
  const root = mkdtempSync(join(tmpdir(), 'aerynth-shard-placement-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'tests'));
  const planning = 'tests/mission-api-planning.test.mts';
  const responses = 'tests/ordinary-responses.test.mts';
  const files = ['tests/heavy-a.test.mts', 'tests/heavy-b.test.mts', planning, responses, 'tests/new.test.mts'];
  for (const file of files) writeFileSync(join(root, file), '');
  for (const order of [files, [files[0], files[1], responses, planning, files[4]]]) {
    const weights = Object.fromEntries(order.map((file, index) => [file, 50_000 - index * 10_000]));
    const plan = planBackendShards(root, weights);
    assert.deepEqual(plan.flat(2).sort(), [...files].sort());
    assert.deepEqual(plan[1][2], [planning]);
    const shardFor = file => plan.findIndex(lanes => lanes.flat().includes(file));
    assert.notEqual(shardFor(planning), shardFor(responses));
    assert.deepEqual(planBackendShards(root, weights), plan);
  }
});

test('acceptance runner executes the serial phase without a peer and retains all case reports', { skip: process.platform !== 'win32' }, t => {
  const root = mkdtempSync(join(tmpdir(), 'aerynth-shard-runner-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const backend = join(root, 'prototypes', 'integrated-backend');
  mkdirSync(join(backend, 'tests'), { recursive: true });
  const serial = ['tests/mission-api-planning.test.mts', 'tests/mission-stream.test.mts', 'tests/native-worker-services.test.mts'];
  for (const [index, file] of serial.entries()) writeFileSync(join(backend, file), `
    import test from 'node:test';
    import assert from 'node:assert/strict';
    import { existsSync, writeFileSync } from 'node:fs';
    import { basename } from 'node:path';
    import { setTimeout } from 'node:timers/promises';
    test('serial phase finishes before the parallel lanes start', async () => {
      await setTimeout(150);
      assert(!existsSync('parallel-started'));
      ${index ? `assert(existsSync(${JSON.stringify(serial[index - 1].split('/').at(-1) + '.done')}));` : ''}
      writeFileSync(basename(import.meta.filename) + '.done', '', { flag: 'wx' });
    });
  `);
  for (const file of ['a', 'b', 'c', 'd', 'e', 'new']) {
    writeFileSync(join(backend, 'tests', `${file}.test.mts`), `
      import test from 'node:test';
      import assert from 'node:assert/strict';
      import { existsSync, writeFileSync } from 'node:fs';
      test('${file}', () => {
        writeFileSync('parallel-started', '');
        for (const file of ${JSON.stringify(serial)}) assert(existsSync(file.split('/').at(-1) + '.done'));
      });
    `);
  }
  // Preserve the runner's relative repository and prototypes paths.
  mkdirSync(join(root, 'scripts'));
  for (const file of ['run-aerynth-acceptance.mts', 'aerynth-backend-shards.mjs',
    'aerynth-windows-backend-weights.json', 'aerynth-test-reporter.mjs']) {
    copyFileSync(new URL(file, import.meta.url), join(root, 'scripts', file));
  }
  const options = { cwd: root, windowsHide: true };
  execFileSync('git', ['init', '-q'], options);
  execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=.git/no-hooks', 'commit', '--allow-empty', '-qm', 'fixture'], options);
  const output = join(root, 'report');
  const env = { ...process.env, AERYNTH_WINDOWS_SHARD: '1', AERYNTH_ACCEPTANCE_OUTPUT: output };
  delete env.NODE_TEST_CONTEXT;
  delete env.AERYNTH_ACCEPTANCE_PREVIOUS;
  execFileSync(process.execPath, [join(root, 'scripts', 'run-aerynth-acceptance.mts')], { ...options, env });
  const report = JSON.parse(readFileSync(join(output, 'acceptance.json'), 'utf8'));
  const expected = planBackendShards(backend)[1];
  assert.equal(report.windowsShard, 1);
  assert.deepEqual(expected[2], serial);
  assert.deepEqual(planBackendShards(backend).flat(2).filter(file => serial.includes(file)).sort(), serial);
  assert.deepEqual(report.groups[0].backendLanes, expected);
  assert.deepEqual(report.groups[0].tests.map(test => test.file).sort(), expected.flat().sort());
  assert.equal(report.groups[0].counts.passed, expected.flat().length);
});

test('Windows reports bind every lane and native receipt to the current run, attempt and revision', () => {
  const identity = { revision: 'tested-revision', runId: '1234', runAttempt: 2, event: 'pull_request' };
  const lanes = [[[workerLossCase.file], ['tests/a.test.mts']], [
    ['tests/b.test.mts'], ['tests/c.test.mts'], ['tests/mission-stream.test.mts', 'tests/native-worker-services.test.mts'],
  ]];
  const passing = ({ file, name = 'fixture' }) => ({ file, name, status: 'passed' });
  const group = (directory, tests, backendLanes) => ({
    directory, status: 'passed', exitCode: 0, signal: null, missingRequiredCases: [],
    counts: { tests: tests.length, passed: tests.length, failed: 0, cancelled: 0 }, tests, backendLanes,
  });
  const reports = lanes.map((backendLanes, windowsShard) => ({
    ...identity, schema: 'aerynth.acceptance@1', windowsShard, environment: { platform: 'win32' }, failures: [],
    groups: [group('integrated-backend', backendLanes.flat().map(file =>
      passing(file === workerLossCase.file ? workerLossCase : { file })), backendLanes)],
  }));
  reports[0].groups.push(group('visual-experience/cinematic-v3', [passing(windowsAddonCase)]));
  const verify = reports => verifyWindowsReports(reports, lanes, identity);
  assert.doesNotThrow(() => verify(reports));
  assert.throws(() => verify([reports[0]]), /two Windows reports/);
  assert.throws(() => verify([reports[0], reports[0]]), /shard 1/);
  for (const change of [
    r => { r[1].revision = 'other'; },
    r => { r[1].runAttempt = 1; },
    r => { r[1].runId = 'older-run'; },
    r => { r[1].groups.push(r[1].groups[0]); },
    r => { r[1].groups[0].backendLanes[0].push('tests/a.test.mts'); },
    r => { r[1].groups[0].backendLanes.pop(); },
    r => { r[1].groups[0].backendLanes[0].push('tests/mission-stream.test.mts'); },
    r => { r[1].groups[0].tests.pop(); },
    r => { r[1].groups[0].tests[0].file = 'tests/a.test.mts'; },
    r => { r[0].groups[0].tests[0].name = 'missing worker loss'; },
    r => { r[0].groups[1].tests[0].status = 'skipped'; },
  ]) {
    const copy = structuredClone(reports);
    change(copy);
    assert.throws(() => verify(copy));
  }
});
