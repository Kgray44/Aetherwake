import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../prototypes/', import.meta.url);
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
  ['Do the app tools work together and survive a restart?', 'integrated-backend', 'tests/*.test.mts'],
  ['Do the desktop controls show the right state and reviews?', 'visual-experience/cinematic-v3', 'tests/*.test.mjs', 'tests/*.test.cjs', 'native/run-application-check.test.cjs', 'native/personal-memory-capture.test.cjs'],
];

const failures: string[] = [];
for (const [question, directory, ...tests] of suites) {
  console.log(`\n${question} (${directory})`);
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=2', ...tests], {
    cwd: fileURLToPath(new URL(`${directory}/`, root)),
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.status !== 0) {
    console.error(result.error?.message ?? result.signal ?? `Test process exited with ${result.status}.`);
    failures.push(directory);
  }
}

console.log(`\n${suites.length - failures.length} of ${suites.length} test groups passed.`);
if (failures.length) {
  console.error(`Review these groups first. ${failures.join(', ')}`);
  process.exitCode = 1;
}
