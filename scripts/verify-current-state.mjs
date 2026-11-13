import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const inventory = 'docs/engineering/CURRENT-STATE-OF-AERYNTH.md';
const index = 'docs/README.md';
const tracked = execFileSync('git', ['ls-files', '-z'], {
  cwd: fileURLToPath(root),
  encoding: 'utf8',
}).split('\0').filter(Boolean);
const paths = new Set(tracked);
for (const file of tracked) {
  for (let directory = posix.dirname(file); directory !== '.'; directory = posix.dirname(directory)) {
    paths.add(directory);
  }
}

function localTargets(markdown) {
  // These documents use inline Markdown links with relative, URL-encoded destinations.
  return [...markdown.matchAll(/\]\(([^)]+)\)/g)]
    .map(([, destination]) => destination.trim().split(/[?#]/, 1)[0])
    .filter(destination => destination && !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(destination));
}

const errors = [];
const targets = localTargets(readFileSync(new URL(inventory, root), 'utf8'));
const resolveTarget = (from, target) =>
  posix.normalize(posix.join(posix.dirname(from), decodeURIComponent(target))).replace(/\/$/, '');

for (const target of targets) {
  const resolved = resolveTarget(inventory, target);
  if (target.startsWith('/') || !paths.has(resolved) || !existsSync(new URL(resolved, root))) {
    errors.push(`${inventory}: missing tracked target ${target}`);
  }
}

const indexed = localTargets(readFileSync(new URL(index, root), 'utf8'))
  .some(target => resolveTarget(index, target) === inventory);
if (!indexed) errors.push(`${index}: missing link to ${inventory}`);

if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Current State: ${targets.length} local references and the documentation index entry verified.`);
}
