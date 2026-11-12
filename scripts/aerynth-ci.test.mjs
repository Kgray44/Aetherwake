import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const gate = new URL('./aerynth-ci-gate.mjs', import.meta.url);
const reporter = new URL('./aerynth-test-reporter.mjs', import.meta.url);

test('required gate rejects a failed, cancelled, skipped or missing job and accepts recovery', t => {
  const directory = mkdtempSync(join(tmpdir(), 'aerynth-ci-gate-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const report = join(directory, 'gate.json');
  const run = (windows, linux = 'success', security = 'success') => {
    const result = spawnSync(process.execPath, [fileURLToPath(gate), report], {
      env: { ...process.env, AERYNTH_LINUX: linux, AERYNTH_WINDOWS: windows, AERYNTH_SECURITY: security },
      encoding: 'utf8',
    });
    return { result, report: JSON.parse(readFileSync(report, 'utf8')) };
  };
  for (const value of ['failure', 'cancelled', 'skipped', '']) {
    const observed = run(value);
    assert.equal(observed.result.status, 1);
    assert.equal(observed.report.status, 'failed');
  }
  assert.equal(run('success', 'failure').result.status, 1);
  assert.equal(run('success', 'success', 'failure').result.status, 1);
  const repaired = run('success');
  assert.equal(repaired.result.status, 0);
  assert.equal(repaired.report.status, 'passed');
});

test('Node reporter identifies failing and skipped tests without serializing error messages', t => {
  const directory = mkdtempSync(join(tmpdir(), 'aerynth-ci-reporter-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const report = join(directory, 'tests.json');
  const fixture = join(directory, 'fixture.test.mjs');
  writeFileSync(fixture, [
    "import { test } from 'node:test';",
    "test('successful synthetic scenario', () => {});",
    "test('failed synthetic scenario', () => { throw new Error('private fixture detail'); });",
    "test('skipped synthetic scenario', { skip: 'private skip detail' }, () => {});",
  ].join('\n'));
  const env = { ...process.env, AERYNTH_TEST_REPORT: report };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--test', '--test-reporter', reporter.href, fixture], {
    cwd: directory, env, encoding: 'utf8',
  });
  assert.equal(result.status, 1, result.stderr);
  const raw = readFileSync(report, 'utf8');
  assert.doesNotMatch(raw, /private (fixture|skip) detail/);
  const data = JSON.parse(raw);
  assert.equal(data.counts.failed, 1);
  assert.equal(data.counts.skipped, 1);
  assert.ok(data.tests.some(entry => entry.name === 'failed synthetic scenario' && entry.status === 'failed'));
  assert.ok(data.tests.some(entry => entry.name === 'skipped synthetic scenario' && entry.status === 'skipped'));
});
