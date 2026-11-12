import { writeFileSync } from 'node:fs';
import { relative } from 'node:path';

export default async function* reporter(source) {
  const tests = [];
  let counts;
  for await (const { type, data } of source) {
    if (type === 'test:summary' && !data.file) counts = data.counts;
    if (type !== 'test:pass' && type !== 'test:fail') continue;
    // A file wrapper with passing children is not a test. A failing wrapper
    // without test children is retained so load errors have an identity.
    if (data.details.type === 'suite' || (data.name === data.file && type === 'test:pass')) continue;
    const status = data.skip ? 'skipped' : data.todo ? 'todo' : type === 'test:fail' ? 'failed' : 'passed';
    tests.push({
      file: data.file ? relative(process.cwd(), data.file).replaceAll('\\', '/') : null,
      line: data.line ?? null,
      name: data.name,
      status,
      durationMs: data.details.duration_ms ?? null,
    });
  }
  if (!counts) throw new Error('Node test runner did not emit a final summary');
  writeFileSync(process.env.AERYNTH_TEST_REPORT, JSON.stringify({ counts, tests }) + '\n');
}
