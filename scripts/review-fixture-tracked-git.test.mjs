import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeTrackedFixture } from '../prototypes/integrated-backend/tests/fixture-tracked-git.mts';

test('real Git setup tracks both fixture files with a committed baseline', t => {
  const dir = mkdtempSync(join(tmpdir(), 'aerynth-fixture-git-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'source.mjs'), 'export const value = 1;\n');
  writeFileSync(join(dir, 'source.test.mjs'), '// fixture\n');
  initializeTrackedFixture(dir);
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', timeout: 5000 });
  assert.deepEqual(git('ls-tree', '--name-only', 'HEAD').trim().split('\n'), ['source.mjs', 'source.test.mjs']);
  assert.equal(git('status', '--porcelain'), '');
});

for (const failedPhase of ['init', 'add', 'commit']) {
  test(`${failedPhase} failure cleans only owned fixture and never retries or leaks raw errors`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'aerynth-fixture-failure-'));
    const calls = [];
    assert.throws(() => initializeTrackedFixture(dir, (binary, args, options) => {
      assert.equal(options.timeout, 5000);
      assert.equal(options.maxBuffer, 32768);
      assert.equal(options.stdio, 'pipe');
      assert.deepEqual(args.slice(0, 2), ['-C', dir]);
      const phase = args.includes('commit') ? 'commit' : args[2]; calls.push(phase);
      if (phase === failedPhase) throw Object.assign(Error('PRIVATE_RAW ' + dir), { code: 'ETIMEDOUT' });
    }), error => {
      assert.ok(!error.message.includes(dir)); assert.ok(!error.message.includes('PRIVATE_RAW'));
      assert.equal(error.cause, undefined);
      const details = JSON.parse(error.message.slice(error.message.indexOf('{')));
      assert.equal(details.phase, failedPhase); assert.equal(details.deadlineMs, 5000);
      assert.equal(details.timedOut, true); assert.equal(details.cleanup, 'removed'); return true;
    });
    assert.deepEqual(calls, ['init', 'add', 'commit'].slice(0, ['init', 'add', 'commit'].indexOf(failedPhase) + 1));
    assert.equal(existsSync(dir), false);
  });
}

test('cleanup failure remains visible without leaking its raw path', () => {
  assert.throws(() => initializeTrackedFixture('PRIVATE_PATH', () => { throw Error('PRIVATE_ERROR'); }, () => { throw Error('PRIVATE_CLEANUP'); }), error => {
    assert.match(error.message, /"cleanup":"failed"/); assert.ok(!error.message.includes('PRIVATE')); return true;
  });
});
