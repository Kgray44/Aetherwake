import { classifyVelaRoutingIntent, nativeConversationalWorkflow, nativeInspectionStage, nativeVelaFact } from '../prototypes/vela-core/src/adaptive-routing.ts';
import { matchOrdinaryClockQuestion } from '../prototypes/integrated-backend/src/ordinary-clock-questions.mts';

// Fixed synthetic examples. No profile, network, private prompts or provider calls.
const cases = [
  ['Good morning, Vela', 'quick'],
  ['Explain what a passive crossover does', 'quick'],
  ['Write a brief message about the launch delay', 'quick'],
  ['Show me an example of a Python script that counts words', 'quick'],
  ['Prove the convergence bound for this iterative scheme', 'deep'],
  ['Explain the trade-offs between these two replication schemes', 'deep'],
  ['How would this queueing architecture scale?', 'deep'],
  ['Inspect server.log for timeout errors', 'local-read'],
  ['Audit the working tree for accidental config changes', 'local-read'],
  ['Patch README.md to correct the typo', 'local-write'],
  ['Create a JSON file in the workspace', 'local-write'],
  ['Edit sample.json and create created.json', 'local-write'],
  ['Explain how to create helper.mjs', 'quick'],
  ['Apply the fix and run the tests', 'local-write'],
  ['Run the Node tests in this repository', 'project-check'],
  ['Type-check this project', 'project-check'],
  ['How do I run the Node tests?', 'quick'],
  ['Run the tests and deploy the build', 'local-write'],
  ['Check the logs and refactor the source code', 'local-write'],
  ['Rename the workspace', 'app-planning'],
  ['Create a checklist block here', 'app-planning'],
  ['Create a timeline of recent activity', 'app-planning'],
  ['How much RAM is this PC using right now?', 'native'],
  ['Show the current GPU load', 'native'],
  ['Show me the CPU and GPU usage', 'native'],
  ['What time is it on my computer?', 'native'],
  ['What day is it today?', 'native'],
  ['Compute 9^2 + 1', 'native'],
  ['How many active projects are there?', 'native'],
  ['Check the CPU load and then inspect the working tree', 'composite'],
  ['Check CPU usage, explain what it means, then look through the logs', 'composite'],
  ['Can you check the GPU usage, please?', 'native'],
  ['Could you calculate 25% of 48?', 'native'],
  ['Is this workspace saved?', 'native'],
  ['Are any executions running?', 'native'],
  ['Build this project', 'project-check'],
  ['Run the benchmark', 'project-check'],
  ['Find the stutter in the logs', 'local-read'],
  ['Inspect the logs, find the stutter, fix the code, and run the benchmark', 'local-write'],
  ['Could you rename my Ideas folder to Things to Try?', 'app-planning'],
  ['Will it rain here tomorrow?', 'app-planning'],
] as const;

function evaluate(intent: string) {
  if (nativeVelaFact(intent) || matchOrdinaryClockQuestion(intent)) return 'native';
  if (nativeConversationalWorkflow(intent) || nativeInspectionStage(intent)) return 'composite';
  return classifyVelaRoutingIntent(intent);
}

const mismatches = cases.flatMap(([intent, expected], index) => {
  const actual = evaluate(intent);
  return actual === expected ? [] : [{ case: index + 1, expected, actual }];
});
const batches: number[] = [];
for (let batch = 0; batch < 50; batch++) {
  const start = performance.now();
  for (const [intent] of cases) evaluate(intent);
  batches.push((performance.now() - start) / cases.length);
}
batches.sort((a, b) => a - b);
console.log(JSON.stringify({
  suite: 'vela-air-offline-intents@1', cases: cases.length,
  matched: cases.length - mismatches.length, mismatches,
  routingOnlyMsPerIntent: { p50: batches[24], p95: batches[47] },
  coverage: 'synthetic intent rules only',
}, null, 2));
if (mismatches.length) process.exitCode = 1;
