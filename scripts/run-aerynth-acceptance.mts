import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { release } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acceptanceSchema, backendTestGlob, hasPassingCase, planBackendShards, windowsAddonCase, workerLossCase } from './aerynth-backend-shards.mjs';

const root = new URL('../prototypes/', import.meta.url);
const repository = fileURLToPath(new URL('../', import.meta.url));
const reporter = new URL('./aerynth-test-reporter.mjs', import.meta.url);
const suites = [
  ['Can I use and arrange cards in my workspace?', 'block-library', 'tests/*.test.mts'],
  ['Can I create a workspace and keep its layout?', 'workspace-engine', 'tests/*.test.mts'],
  ['Can I save and find my projects and resources?', 'workspace-kernel', 'tests/*.test.mts'],
  ['Can I find my way around my projects?', 'constellation', 'tests/*.test.mjs', 'tests/*.test.cjs'],
  ['Can I start, manage, and move a chat?', 'conversation-product', 'test/*.test.mts'],
  ['Can I branch a chat and keep its connections?', 'connected-conversations', 'test/*.test.ts'],
  ['Can I make an agent and choose how it works?', 'agent-product', 'tests/*.test.mts'],
  ['Can I make a checklist and check things off?', 'checklist-product', 'tests/*.test.mts'],
  ['Can I manage persistent timers, stopwatches and world clocks?', 'timer-product', 'tests/*.test.mts'],
  ['Can I set an objective and see what proves it is done?', 'task-product', 'tests/*.test.mts'],
  ['Can I make a timeline and see where its events came from?', 'timeline-product', 'tests/*.test.mts'],
  ['Can I share only the context I choose?', 'personal-context', 'tests/*.test.mts'],
  ['Can I connect ChatGPT or the Vela API and verify voice and response boundaries?', 'openai-provider', 'test/*.test.mts', 'tests/*.test.mts'],
  ['Can I run and follow a Codex task?', 'codex-bridge', 'tests/*.test.ts'],
  ['Can Vela answer or act, and does it ask before doing sensitive work?', 'vela-core', 'tests/*.test.mts', 'tests/*.test.mjs', 'test/*.test.cjs'],
  ['Do the app tools work together and survive a restart?', 'integrated-backend', backendTestGlob],
  ['Do the desktop controls show the right state and reviews?', 'visual-experience/cinematic-v3', 'tests/*.test.mjs', 'tests/*.test.cjs', 'native/run-application-check.test.cjs'],
];

const requested = process.argv.slice(2);
const shardInput = process.env.AERYNTH_WINDOWS_SHARD || undefined;
if (shardInput !== undefined && (!['0', '1'].includes(shardInput) || process.platform !== 'win32' || requested.length)) {
  throw new Error('Windows sharding requires shard 0 or 1 and no acceptance group arguments');
}
const windowsShard = shardInput === undefined ? null : Number(shardInput);
const backendLanes = windowsShard === null ? null
  : planBackendShards(fileURLToPath(new URL('integrated-backend/', root)))[windowsShard];
const selected = suites.filter(([, directory]) => windowsShard === 1 ? directory === 'integrated-backend'
  : requested.length === 0 || requested.includes(directory));
if (requested.some(name => !suites.some(([, directory]) => directory === name))) {
  throw new Error('Unknown acceptance group. Use a prototype directory name.');
}
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim();
const clean = execFileSync('git', ['status', '--porcelain'], { cwd: repository, encoding: 'utf8' }).trim() === '';
const environment = { platform: process.platform, architecture: process.arch, osRelease: release(), node: process.version,
  runnerImage: process.env.ImageOS ?? null, runnerImageVersion: process.env.ImageVersion ?? null };
const output = resolve(process.env.AERYNTH_ACCEPTANCE_OUTPUT ?? '.runtime/acceptance');
mkdirSync(output, { recursive: true });
type Case = { file: string | null; line: number | null; name: string; status: string; durationMs: number | null };
type TestDetails = { counts: Record<string, number> | null; tests: Case[] };
type Group = { directory: string; classifications: string[]; status: string; exitCode: number | null;
  signal: string | null; durationMs: number; counts: Record<string, number> | null; tests: Case[]; backendLanes?: string[][];
  missingRequiredCases: { file: string; name: string }[] };
async function runTests(directory: string, files: string[], concurrency: number, lane: number) {
  const report = join(output, `${directory.replaceAll('/', '-')}-${lane}.json`);
  rmSync(report, { force: true });
  const child = spawn(process.execPath, ['--test', `--test-concurrency=${concurrency}`,
    '--test-reporter=spec', '--test-reporter-destination=stdout',
    '--test-reporter=' + reporter.href, '--test-reporter-destination=stdout', ...files], {
    cwd: fileURLToPath(new URL(`${directory}/`, root)),
    stdio: 'inherit',
    windowsHide: true,
    env: { ...process.env, AERYNTH_TEST_REPORT: report },
  });
  const result = await new Promise<{ status: number | null; signal: string | null }>(resolve => {
    child.once('error', error => console.error(error.message));
    child.once('close', (status, signal) => resolve({ status, signal }));
  });
  let details: TestDetails = { counts: null, tests: [] };
  try {
    details = JSON.parse(readFileSync(report, 'utf8'));
  } catch {
    console.error(`No readable test report for ${directory} lane ${lane}.`);
  } finally {
    rmSync(report, { force: true });
  }
  return { ...result, ...details };
}

const groups: Group[] = [];
const failures: string[] = [];
for (const [question, directory, ...files] of selected) {
  console.log(`\n${question} (${directory})`);
  const start = performance.now();
  const lanes = directory === 'integrated-backend' ? backendLanes : null;
  const runs = await Promise.all((lanes ?? [files]).map((laneFiles, lane) =>
    runTests(directory, laneFiles, lanes ? 1 : 2, lane)));
  const result = runs.find(run => run.status !== 0) ?? runs[0];
  const tests = runs.flatMap(run => run.tests);
  const counts = runs.every(run => run.counts) ? Object.fromEntries(Object.keys(runs[0].counts!).map(key =>
    [key, runs.reduce((sum, run) => sum + run.counts![key], 0)])) : null;
  const requiredCases = [];
  if (directory === 'integrated-backend' && (!lanes || lanes.flat().includes(workerLossCase.file))) requiredCases.push(workerLossCase);
  if (directory === 'visual-experience/cinematic-v3' && process.platform === 'win32') requiredCases.push(windowsAddonCase);
  const missingRequiredCases = requiredCases.filter(required => !hasPassingCase(tests, required));
  const laneCoverage = !lanes || runs.every((run, lane) => {
    const observed = new Set(run.tests.map(test => test.file));
    return observed.size === lanes[lane].length && lanes[lane].every(file => observed.has(file));
  });
  const passed = result.status === 0 && missingRequiredCases.length === 0 && (counts?.tests ?? 0) > 0
    && counts?.failed === 0 && counts?.cancelled === 0 && (counts?.passed ?? 0) > 0 && laneCoverage
    && !tests.some(test => test.status === 'failed');
  groups.push({
    directory,
    classifications: [
      'synthetic',
      ...(directory === 'integrated-backend' || directory === 'block-library' || directory === 'visual-experience/cinematic-v3'
        ? ['component', 'cross-package'] : ['component']),
      ...(directory === 'visual-experience/cinematic-v3' && requiredCases.length && !missingRequiredCases.length ? ['native'] : []),
    ],
    status: passed ? 'passed' : 'failed',
    exitCode: result.status,
    signal: result.signal,
    durationMs: Math.round(performance.now() - start),
    missingRequiredCases,
    ...(lanes ? { backendLanes: lanes } : {}),
    counts,
    tests,
  });
  if (!passed) {
    if (result.status !== 0) console.error(result.signal ?? `Test process exited with ${result.status}.`);
    if (!laneCoverage) console.error('Observed backend files differ from their assigned lanes.');
    for (const item of missingRequiredCases) console.error(`Required case did not pass: ${item.file}: ${item.name}`);
    failures.push(directory);
  }
}

const schema = acceptanceSchema;
const comparison = process.env.AERYNTH_ACCEPTANCE_PREVIOUS;
const flakyTests: { group: string; file: string | null; line: number | null; name: string }[] = [];
let flakyComparison = 'no-baseline';
if (comparison) {
  const previous = JSON.parse(readFileSync(comparison, 'utf8'));
  if (previous.schema !== schema || previous.revision !== revision || (previous.windowsShard ?? null) !== windowsShard || !previous.clean || !clean ||
    previous.environment.platform !== environment.platform || previous.environment.architecture !== environment.architecture ||
    previous.environment.node !== environment.node || previous.environment.runnerImage !== environment.runnerImage ||
    previous.environment.runnerImageVersion !== environment.runnerImageVersion ||
    previous.environment.osRelease !== environment.osRelease) {
    flakyComparison = 'incomparable-baseline';
  } else {
    flakyComparison = 'compared';
    for (const group of groups) {
      const key = (test: Case) => JSON.stringify([test.file, test.line, test.name]);
      const prior = new Map((previous.groups.find((item: Group) => item.directory === group.directory)?.tests ?? [])
        .map((test: Case) => [key(test), test.status]));
      for (const test of group.tests) {
        const last = prior.get(key(test));
        if ((test.status === 'passed' && last === 'failed') || (test.status === 'failed' && last === 'passed')) {
          flakyTests.push({ group: group.directory, file: test.file, line: test.line, name: test.name });
        }
      }
    }
  }
}
const gates = [
  { classification: 'native', gate: 'interactive-desktop-and-physical-devices', status: 'unqualified' },
  { classification: 'live-provider', gate: 'authorized-account-and-real-provider-effects', status: 'unqualified' },
  { classification: 'independent-quality', gate: 'independent-review-and-task-quality', status: 'unqualified' },
  { classification: 'owner-acceptance', gate: 'owner-observed-product-acceptance', status: 'unqualified' },
];
const report = { schema, revision, clean, environment, event: process.env.GITHUB_EVENT_NAME ?? null,
  runId: process.env.GITHUB_RUN_ID ?? null, windowsShard,
  runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT ?? 1), groups, failures, flakyComparison, flakyTests, gates };
writeFileSync(join(output, 'acceptance.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`\n${selected.length - failures.length} of ${selected.length} test groups passed.`);
if (failures.length) {
  console.error(`Review these groups first. ${failures.join(', ')}`);
  process.exitCode = 1;
}
