import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { acceptanceSchema, planBackendShards, windowsAddonCase, workerLossCase } from './aerynth-backend-shards.mjs';

const gate = new URL('./aerynth-ci-gate.mjs', import.meta.url);
const reporter = new URL('./aerynth-test-reporter.mjs', import.meta.url);

test('acceptance producer and required aggregate pin the same Node runtime before running their scripts', () => {
  function runtimeBefore(file, job, script) {
    const workflow = readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
    const jobBody = workflow.split(/^  (?=[\w-]+:\s*$)/m).find(section => section.startsWith(`${job}:\n`));
    assert.ok(jobBody, `Missing ${job} job in ${file}`);
    const scriptIndex = jobBody.indexOf(`run: node scripts/${script}`);
    assert.ok(scriptIndex >= 0, `Missing ${script} in ${job}`);
    const setup = [...jobBody.slice(0, scriptIndex).matchAll(
      /^      - uses: actions\/setup-node@([a-f0-9]{40})[^\n]*\n        with:\n          node-version: '([\d.]+)'\s*$/gm,
    )];
    assert.equal(setup.length, 1, `${job} must pin one setup-node action and version before ${script}`);
    return setup[0].slice(1);
  }
  const producer = runtimeBefore('aerynth-integration.yml', 'verify', 'run-aerynth-acceptance.mts');
  const validator = runtimeBefore('integrated-backend.yml', 'required', 'aerynth-ci-gate.mjs');
  assert.deepEqual(validator, producer);
  assert.equal(validator[1], '24.18.0');
});

test('required gate rejects a failed, cancelled, skipped or missing job and accepts recovery', t => {
  const directory = mkdtempSync(join(tmpdir(), 'aerynth-ci-gate-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const report = join(directory, 'gate.json');
  const identity = {
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: new URL('../', import.meta.url), encoding: 'utf8' }).trim(),
    runId: '1234', event: 'pull_request', runAttempt: 2,
  };
  const plan = planBackendShards(fileURLToPath(new URL('../prototypes/integrated-backend/', import.meta.url)));
  const group = (directory, cases, backendLanes) => ({
    directory, status: 'passed', exitCode: 0, signal: null, missingRequiredCases: [],
    counts: { tests: cases.length, passed: cases.length, failed: 0, cancelled: 0 },
    tests: cases.map(entry => ({ ...entry, status: 'passed' })), backendLanes,
  });
  const run = (windows, linux = 'success', security = 'success', windowsBackend = 'success') => {
    const result = spawnSync(process.execPath, [fileURLToPath(gate), report, directory], {
      env: { ...process.env, AERYNTH_LINUX: linux, AERYNTH_WINDOWS: windows, AERYNTH_WINDOWS_BACKEND: windowsBackend,
        AERYNTH_SECURITY: security, GITHUB_SHA: identity.revision, GITHUB_RUN_ID: identity.runId,
        GITHUB_EVENT_NAME: identity.event, GITHUB_RUN_ATTEMPT: String(identity.runAttempt) },
      encoding: 'utf8',
      windowsHide: true,
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
  assert.equal(run('success', 'success', 'success', '').result.status, 1);
  assert.equal(run('success').report.windowsReports, 'failed');
  for (const [windowsShard, backendLanes] of plan.entries()) {
    mkdirSync(join(directory, String(windowsShard)));
    const groups = [group('integrated-backend', backendLanes.flat().map(file => file === workerLossCase.file ? workerLossCase : { file }),
      backendLanes)];
    if (windowsShard === 0) groups.push(group('visual-experience/cinematic-v3', [windowsAddonCase]));
    writeFileSync(join(directory, String(windowsShard), 'acceptance.json'), JSON.stringify({
      ...identity, windowsShard, schema: acceptanceSchema, environment: { platform: 'win32' }, failures: [], groups,
    }));
  }
  const repaired = run('success');
  assert.equal(repaired.result.status, 0);
  assert.equal(repaired.report.status, 'passed');
  assert.equal(repaired.report.windowsReports, 'passed');
});

test('Node reporter identifies failing and skipped tests without serializing error messages', t => {
  const directory = mkdtempSync(join(tmpdir(), 'aerynth-ci-reporter-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const report = join(directory, 'tests.json');
  const fixture = join(directory, 'fixture.test.mjs');
  writeFileSync(fixture, [
    "import { after, describe, test } from 'node:test';",
    "test('successful synthetic scenario', () => {});",
    "test('failed synthetic scenario', () => { throw new Error('private fixture detail'); });",
    "test('skipped synthetic scenario', { skip: 'private skip detail' }, () => {});",
    "describe('suite with failed teardown', () => { test('passing case', () => {}); after(() => { throw new Error('private fixture detail'); }); });",
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
  assert.ok(data.tests.some(entry => entry.name === 'suite with failed teardown' && entry.status === 'failed'));
});
