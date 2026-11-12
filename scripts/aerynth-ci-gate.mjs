import { writeFileSync } from 'node:fs';

const jobs = {
  linux: process.env.AERYNTH_LINUX ?? 'missing',
  windows: process.env.AERYNTH_WINDOWS ?? 'missing',
  security: process.env.AERYNTH_SECURITY ?? 'missing',
};
const passed = Object.values(jobs).every(result => result === 'success');
const report = {
  schema: 'aerynth.ci-gate@1',
  revision: process.env.GITHUB_SHA ?? null,
  event: process.env.GITHUB_EVENT_NAME ?? null,
  runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT ?? 1),
  status: passed ? 'passed' : 'failed',
  jobs,
};
const json = JSON.stringify(report, null, 2);
writeFileSync(process.argv[2], json + '\n');
console.log(json);
if (!passed) process.exitCode = 1;
