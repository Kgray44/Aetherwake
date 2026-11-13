import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planBackendShards, verifyWindowsReports } from './aerynth-backend-shards.mjs';

const jobs = {
  linux: process.env.AERYNTH_LINUX ?? 'missing',
  windows: process.env.AERYNTH_WINDOWS ?? 'missing',
  windowsBackend: process.env.AERYNTH_WINDOWS_BACKEND ?? 'missing',
  security: process.env.AERYNTH_SECURITY ?? 'missing',
};
const identity = {
  revision: process.env.GITHUB_SHA ?? null,
  runId: process.env.GITHUB_RUN_ID ?? null,
  event: process.env.GITHUB_EVENT_NAME ?? null,
  runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT ?? 1),
};
let windowsReports = 'not-verified';
if (jobs.windows === 'success' && jobs.windowsBackend === 'success') {
  try {
    const repository = fileURLToPath(new URL('../', import.meta.url));
    const checkedOut = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim();
    if (identity.revision !== checkedOut || !identity.runId || !identity.event) throw new Error('Missing or mismatched run identity');
    const plan = planBackendShards(join(repository, 'prototypes', 'integrated-backend'));
    const reports = plan.map((_, shard) => JSON.parse(readFileSync(join(process.argv[3], String(shard), 'acceptance.json'), 'utf8')));
    verifyWindowsReports(reports, plan, identity);
    windowsReports = 'passed';
  } catch (error) {
    console.error(`Windows acceptance reports failed verification: ${error.message}`);
    windowsReports = 'failed';
  }
}
const passed = windowsReports === 'passed' && Object.values(jobs).every(result => result === 'success');
const report = {
  schema: 'aerynth.ci-gate@1',
  ...identity,
  status: passed ? 'passed' : 'failed',
  jobs,
  windowsReports,
};
const json = JSON.stringify(report, null, 2);
writeFileSync(process.argv[2], json + '\n');
console.log(json);
if (!passed) process.exitCode = 1;
