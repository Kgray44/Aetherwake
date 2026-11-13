import { globSync, readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

export const workerLossCase = {
  file: 'tests/mission-integration.test.mts',
  name: 'a lost worker never treats its in-flight native work as verified on reopen',
};
export const windowsAddonCase = {
  file: 'tests/windows-system-build.test.mjs',
  name: 'fixed Windows addon reads real memory/process facts, preserves consent diagnoses and rejects an unissued reclaim',
};
export const acceptanceSchema = 'aerynth.acceptance@1';
export const backendTestGlob = 'tests/*.test.mts';

// Summed case times in milliseconds from Windows artifact 14016804955.
const windowsWeights = JSON.parse(readFileSync(new URL('./aerynth-windows-backend-weights.json', import.meta.url), 'utf8'));
// These two fixture files exceeded their settle windows when they shared a runner.
const separateRunner = new Map([
  ['tests/mission-api-planning.test.mts', 'tests/ordinary-responses.test.mts'],
  ['tests/ordinary-responses.test.mts', 'tests/mission-api-planning.test.mts'],
]);

export function planBackendShards(backendRoot, weights = windowsWeights) {
  // Match the existing backend glob, including new files with no timing history.
  const files = globSync(backendTestGlob, { cwd: backendRoot, withFileTypes: true })
    .filter(entry => entry.isFile() || entry.isSymbolicLink())
    .map(entry => `tests/${entry.name}`).sort();
  const defaultWeight = 10_000;
  const weight = file => Math.max(1, weights[file] ?? defaultWeight);
  const lanes = Array.from({ length: 4 }, (_, index) => ({ shard: Math.floor(index / 2), files: [], duration: 0 }));
  const assignedShard = new Map();
  if (files.length < lanes.length) throw new Error('Expected at least four backend test files');
  for (const file of files.sort((a, b) => weight(b) - weight(a))) {
    const otherShard = assignedShard.get(separateRunner.get(file));
    const eligible = lanes.filter(lane => lane.shard !== otherShard);
    const lane = eligible.reduce((lightest, next) => next.duration < lightest.duration ? next : lightest);
    lane.files.push(file);
    lane.duration += weight(file);
    assignedShard.set(file, lane.shard);
  }
  return [[lanes[0].files, lanes[1].files], [lanes[2].files, lanes[3].files]];
}

export function hasPassingCase(tests, required) {
  return tests.some(test => test.file === required.file && test.name === required.name && test.status === 'passed');
}

function passingGroup(report, directory) {
  const groups = report.groups.filter(group => group.directory === directory);
  const [group] = groups;
  if (groups.length !== 1 || group.status !== 'passed' || group.exitCode !== 0 || group.signal !== null ||
      group.missingRequiredCases.length || !Number.isInteger(group.counts.tests) || group.counts.tests < 1 ||
      !Number.isInteger(group.counts.passed) || group.counts.passed < 1 ||
      group.counts.failed !== 0 || group.counts.cancelled !== 0 ||
      group.tests.some(test => test.status === 'failed')) {
    throw new Error(`Expected one passing ${directory} group`);
  }
  return group;
}

export function verifyWindowsReports(reports, plan, identity) {
  if (reports.length !== 2) throw new Error('Expected two Windows reports');
  for (const [shard, lanes] of plan.entries()) {
    const report = reports[shard];
    if (report.schema !== acceptanceSchema || report.windowsShard !== shard ||
        report.environment.platform !== 'win32' || report.failures.length ||
        Object.entries(identity).some(([key, value]) => report[key] !== value)) {
      throw new Error(`Invalid or stale Windows report for shard ${shard}`);
    }
    const group = passingGroup(report, 'integrated-backend');
    const expected = lanes.flat().sort();
    const observed = [...new Set(group.tests.map(test => test.file))].sort();
    if (!isDeepStrictEqual(group.backendLanes, lanes) || !isDeepStrictEqual(observed, expected)) {
      throw new Error(`Backend file coverage differs from the plan on shard ${shard}`);
    }
    if (expected.includes(workerLossCase.file) && !hasPassingCase(group.tests, workerLossCase)) {
      throw new Error('Windows worker-loss receipt is missing');
    }
    if (shard === 0 && !hasPassingCase(passingGroup(report, 'visual-experience/cinematic-v3').tests, windowsAddonCase)) {
      throw new Error('Windows native add-on receipt is missing');
    }
  }
  if (!plan.flat(2).includes(workerLossCase.file)) throw new Error('Windows worker-loss file is missing');
}
