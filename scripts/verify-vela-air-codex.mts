import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BackendCore } from '../prototypes/integrated-backend/src/core.mts';
import { admitVelaFileEdit, readVelaFileEditTarget } from '../prototypes/integrated-backend/src/vela-file-edit.mts';
import type { VelaFileEditView, VelaRequest } from '../prototypes/vela-core/src/contracts.ts';

// Explicit opt-in. One real model turn with fixed synthetic data in a new Git checkout.
assert(process.platform === 'win32' && process.argv.slice(2).join(' ') === '--run-one-synthetic-turn',
  'Use --run-one-synthetic-turn on the Windows host to exercise the installed Codex account.');
const runtime = fileURLToPath(new URL('../prototypes/integrated-backend/.runtime/', import.meta.url));
admitVelaFileEdit(runtime);
mkdirSync(runtime, { recursive: true });
const evidence = realpathSync.native(mkdtempSync(join(runtime, 'vela-air-live-codex-')));
const checkout = join(evidence, 'checkout');
mkdirSync(checkout);
const file = join(checkout, 'sample.json'), testFile = join(checkout, 'sample.test.mjs');
const original = '{"count":1}\n';
writeFileSync(file, original, { flag: 'wx' });
writeFileSync(testFile, `import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('Did the count change to two?', () => {
  assert.deepEqual(JSON.parse(readFileSync(new URL('./sample.json', import.meta.url), 'utf8')), { count: 2 });
});\n`, { flag: 'wx' });
const git = (...args: string[]) => execFileSync('git.exe', ['-C', checkout, '-c', 'core.hooksPath=NUL', ...args],
  { windowsHide: true, timeout: 6000, stdio: 'pipe', maxBuffer: 8192 });
git('init', '--quiet', '--template=');
git('add', '--', 'sample.json', 'sample.test.mjs');
git('-c', 'user.name=AIR synthetic acceptance', '-c', 'user.email=air-test@example.invalid', 'commit', '--quiet', '-m', 'Synthetic files for one Vela test');

const core = new BackendCore({ path: join(evidence, 'synthetic.sqlite'), contentPolicy: 'synthetic-only',
  provider: 'codex', cwd: checkout, retention: { maxEvents: 128 } });
const receipt: Record<string, unknown> = { passed: false, synthetic: true, evidence, account: 'installed Codex' };
try {
  receipt.stage = 'preflight';
  assert.equal(readVelaFileEditTarget(file).target.root, checkout);
  const intent = 'Edit sample.json so the count is two, and run the tests';
  receipt.stage = 'provider preview';
  const preview = await core.command('velaRequestPreview', { intent, resourceIds: [], adaptive: true, editTargetPaths: [file] });
  const approval = { previewId: preview.id, signature: preview.signature };
  const review = await core.command('velaNativeReview', approval);
  const prompt = JSON.parse(review.prompt.split('\n').at(-1)!);
  assert.equal(review.providerId, 'codex-app-server');
  assert.equal(review.route?.kind, 'file-edit');
  assert.equal(review.workingDirectory, checkout);
  assert.deepEqual(prompt, { intent, sources: [], files: [{ path: 'sample.json', operation: 'replace', content: original }] });
  assert.equal((await core.command('providerActivity', {})).providerRequests, 0);
  await assert.rejects(core.command('authorizeVelaRequest', { ...approval, reviewDigest: review.reviewDigest, directSend: true }),
    /vela_attached_context_review_required/);
  const { grantId } = await core.command('authorizeVelaRequest', { ...approval, reviewDigest: review.reviewDigest });
  receipt.stage = 'provider execution';
  const response = await core.command('vela', { name: 'request', input: { intent, resourceIds: [], authorizeProvider: true, ...approval, grantId } }) as VelaRequest;
  receipt.modelTurn = { state: response.state, route: response.route, errorCode: response.errorCode };
  assert.equal(response.state, 'responded', response.errorCode);
  assert.equal(readFileSync(file, 'utf8'), original);
  receipt.stage = 'edit review and apply';
  const edit = await core.command('velaFileEditReview', { requestId: response.id });
  assert.equal(edit.files.length, 1);
  assert.equal(edit.files[0].path, file);
  assert.equal(edit.files[0].before, original);
  assert.deepEqual(JSON.parse(edit.files[0].after), { count: 2 });
  const edited = await core.command('velaFileEditApply', { requestId: response.id, reviewId: edit.reviewId });
  assert.equal(edited.state, 'applied');
  assert.equal(edited.followUpCheck, 'node-test');
  receipt.stage = 'run tests';
  const check = await core.command('velaProjectCheckReview', { requestId: response.id, kind: 'node-test', paths: [testFile] });
  assert.deepEqual(check.argv.slice(-2), ['--', './sample.test.mjs']);
  const checked = await core.command('velaProjectCheckRun', { requestId: response.id, reviewId: check.reviewId }) as VelaFileEditView;
  receipt.check = checked.projectChecks?.[0];
  assert.equal(checked.projectChecks?.[0].state, 'passed');
  assert.equal(checked.projectChecks?.[0].testCount, 1);
  assert.equal((await core.command('providerActivity', {})).providerRequests, 1);
  const snapshot = await core.command('snapshot', {});
  const execution = Object.values(snapshot.executions).find(item => item.commandId === `vela-inspection:${response.id}`);
  assert.equal(execution?.state, 'provider_completed');
  assert(execution?.binding?.nativeThreadId && execution.turnId);
  receipt.nativeEvidence = { threadBound: true, turnBound: true, executedModelTurns: 1 };
  receipt.stage = 'complete';
  receipt.passed = true;
} catch (error) {
  receipt.failure = error instanceof Error ? error.name : 'UnknownError';
  if (error instanceof Error && /^[a-z_]+$/u.test(error.message)) receipt.code = error.message;
  process.exitCode = 1;
} finally {
  await core.command('close', {});
  writeFileSync(join(evidence, 'receipt.json'), JSON.stringify(receipt, null, 2), { flag: 'wx' });
  console.log(JSON.stringify(receipt));
}
