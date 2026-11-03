import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { calculate, calculatorExpression } from '../prototypes/vela-core/src/calculator.ts';
import {
  classifyVelaRoutingIntent, nativeConversationalWorkflow, nativeInspectionStage, nativeVelaFact,
} from '../prototypes/vela-core/src/adaptive-routing.ts';
import { matchOrdinaryClockQuestion } from '../prototypes/integrated-backend/src/ordinary-clock-questions.mts';
import { BackendCore } from '../prototypes/integrated-backend/src/core.mts';

type Route = ReturnType<typeof classifyVelaRoutingIntent> | 'native' | 'composite';
type Scenario = { intent: string; route: Route; value?: number };
const scenarios = (route: Route, ...intents: string[]): Scenario[] => intents.map(intent => ({ intent, route }));
const suites: Record<string, Scenario[]> = {
  everyday: scenarios('quick',
    'Suggest three names for a small bakery', 'Help me thank a neighbor for watering my plants',
    'What should I pack for a picnic?', 'Write a short announcement about a delayed pickup',
    'Make this sentence friendlier: the room is booked', 'What is a polite way to end an email?',
    'Give me two ideas for a quiet afternoon', 'Put these in alphabetical order: Sasha, Toni, Avery'),
  technical: scenarios('quick',
    'Why does a heat pump work in winter?', 'Explain the difference between voltage and current',
    'What does an HTTP 304 response tell me?', 'What does the clutch do in a manual car?',
    'Explain the purpose of a flyback diode', 'How does a microphone turn sound into a signal?',
    'Explain why a warm monitor looks less blue', 'What makes wired Ethernet useful for video calls?'),
  reasoning: scenarios('deep',
    'Prove that the sum of two odd integers is even', 'Derive the period of a small-angle pendulum',
    'Analyze the trade-offs of two queue retry strategies', 'Explain how this architecture scales under bursts',
    'Derive the transfer function for an RC low-pass filter', 'Prove a bound on the number of binary search steps',
    'Identify the root cause using these hypothetical event timestamps', 'Give a rigorous argument for why this recurrence converges'),
  calculations: [
    { intent: 'Compute 3.3 * 0.02', route: 'native', value: 0.066 },
    { intent: 'Calculate 4700 * 0.000001', route: 'native', value: 0.0047 },
    { intent: 'What is 40% of 250?', route: 'native', value: 100 },
    { intent: 'Evaluate sqrt(144) + 4^2', route: 'native', value: 28 },
    { intent: 'Calculate (24 - 5) / 0.2', route: 'native', value: 95 },
    { intent: 'What is (60 + 20) divided by 4?', route: 'native', value: 20 },
    { intent: 'Compute 2 * pi * 0.25', route: 'native', value: Math.PI / 2 },
    { intent: 'Calculate (5^2 - 1) / 6', route: 'native', value: 4 },
  ],
  localSystem: scenarios('native',
    'Can you check the current CPU utilization?', 'What is my GPU load right now?',
    'How much physical memory is this computer using?', 'Show my GPU and CPU load',
    'What is the time right now?', 'What date is it?', 'What workspace am I in?', 'How many Aerynth executions are running?'),
  repository: scenarios('local-read',
    'Inspect my working tree for files changed since the last commit', 'Check build.log for warnings',
    'Find where the source code opens a socket', 'Review the repository for stale migration paths',
    'Scan the checkout for uses of the old protocol', 'Read the repository logs for restarts',
    'Look through settings.json for duplicate properties', 'Audit the git diff for accidental renames'),
  coding: scenarios('local-write',
    'Fix the boundary condition in ranges.ts', 'Add permissions.json with a read-only setting',
    'Update worker.mjs to report the timeout', 'Refactor the parser code to reduce duplicated checks',
    'Edit dashboard.css and run the tests', 'Replace the default port in config.toml',
    'Patch the repo bug that resets the draft', 'Modify capacity.json to set the limit to sixteen'),
  tools: [
    ...scenarios('project-check', 'Run these unit tests', 'Check the TypeScript types', 'Run a Node benchmark', 'Run this build script'),
    ...scenarios('app-planning', 'Rename the workspace to Night Shift', 'Make a checklist for the handoff',
      'Archive the Draft Ideas collection', 'Link the notes to my project'),
  ],
  orchestration: scenarios('composite',
    'Check my CPU load, summarize the reading, then inspect startup.log',
    'Read the selected log note, explain the pauses, then patch pacing.ts and run the benchmark',
    'Check GPU usage then review the repository logs',
    'Show the current RAM usage then inspect the source code',
    'Review my log excerpt, summarize the error, then edit settings.json and test the fix',
    'Check the CPU and GPU utilization, analyze the difference, then inspect my working tree',
    'Read the logs, explain why frames were delayed, then fix timing.mjs and benchmark',
    'Check GPU usage, summarize the reading, then inspect the checkout'),
  ambiguous: [
    ...scenarios('quick', 'How can I edit the config file?', 'What is a safe way to run deployment scripts?',
      'Explain the phrase delete the branch', 'What does GPU load mean?', 'Show me an example of a shell script',
      'Explain how to open a workspace in a typical editor'),
    ...scenarios('local-write', 'Delete the branch and deploy the build', 'Run the script and publish the package'),
  ],
  providerFailures: scenarios('quick',
    'What is the opposite of wide?', 'Which month follows February?', 'Explain the purpose of a circuit breaker',
    'Give one benefit of a standing desk', 'Can you summarize the purpose of an invoice?',
    'What is a calendar reminder?', 'Which compass point is opposite east?', 'How does a bike bell make sound?'),
};

const variants = [
  (intent: string) => intent,
  (intent: string) => `Vela, ${intent}`,
  (intent: string) => `${intent.replace(/[?.!]$/u, '')}.`,
  (intent: string) => ` ${intent.toUpperCase()} `,
];
const cases = Object.entries(suites).flatMap(([suite, examples]) => examples.flatMap((example, index) =>
  variants.map((paraphrase, variant) => ({
    ...example, suite, id: `${suite}-${index + 1}-${variant + 1}`, intent: paraphrase(example.intent),
  }))));

function route(intent: string): Route {
  if (nativeVelaFact(intent) || matchOrdinaryClockQuestion(intent)) return 'native';
  if (nativeConversationalWorkflow(intent) || nativeInspectionStage(intent)) return 'composite';
  return classifyVelaRoutingIntent(intent);
}

const fixture = mkdtempSync(join(tmpdir(), 'aerynth-air-held-out-'));
const core = new BackendCore({ path: join(fixture, 'canonical.sqlite'), provider: 'fixture', contentPolicy: 'synthetic-only' });
const rows = [];
try {
  for (const entry of cases) {
    const started = performance.now();
    const observed = route(entry.intent);
    const routeMs = performance.now() - started;
    const expression = entry.value === undefined ? undefined : calculatorExpression(entry.intent);
    const verifiedAnswer = entry.value === undefined ? null : !!expression && Math.abs(calculate(expression) - entry.value) < 1e-10;
    let blocked: boolean | null = null;
    if (entry.suite === 'providerFailures') {
      try {
        await core.command('velaRequestPreview', { intent: entry.intent, adaptive: true, resourceIds: [] });
        blocked = false;
      } catch (error) {
        blocked = (error as { code?: string }).code === 'vela_chatgpt_sign_in_required';
      }
    }
    rows.push({ id: entry.id, suite: entry.suite, expected: entry.route, observed, routeMs, verifiedAnswer, blocked });
  }
  const activity = await core.command('providerActivity', {});
  if (activity.providerRequests !== 0) throw Error('Offline evaluation started a provider request');
} finally {
  await core.command('close', {});
}

const percentile = (values: number[], fraction: number) => values.sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];
const bySuite = Object.fromEntries(Object.keys(suites).map(suite => {
  const selected = rows.filter(row => row.suite === suite);
  return [suite, {
    cases: selected.length, routeMatches: selected.filter(row => row.expected === row.observed).length,
    verifiedAnswers: selected.filter(row => row.verifiedAnswer === true).length,
    unavailableBlocked: selected.filter(row => row.blocked === true).length,
    routeP50Ms: percentile(selected.map(row => row.routeMs), 0.5),
    routeP95Ms: percentile(selected.map(row => row.routeMs), 0.95),
  }];
}));
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim();
const clean = !execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8', windowsHide: true }).trim();
console.log(JSON.stringify({
  contract: 'aerynth.air-held-out-offline@1', revision, clean, platform: process.platform, cases: rows.length,
  independentScenarios: cases.length / variants.length, bySuite, rows,
  boundary: 'Production intent and arithmetic rules plus disconnected Core admission. No inference or model latency.',
}, null, 2));
if (rows.some(row => row.expected !== row.observed || row.verifiedAnswer === false || row.blocked === false)) process.exitCode = 1;
