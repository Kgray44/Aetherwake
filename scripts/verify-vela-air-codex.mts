import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { BackendCore } from '../prototypes/integrated-backend/src/core.mts';
import { admitVelaFileEdit, readVelaFileEditTarget } from '../prototypes/integrated-backend/src/vela-file-edit.mts';
import type { VelaFileEditView, VelaLocalHost, VelaRequest, VelaState } from '../prototypes/vela-core/src/contracts.ts';
import type { MissionPreview, MissionProjection } from '../prototypes/integrated-backend/src/mission-contracts.mts';

// Explicit opt-in. Both checks use only fixed synthetic data in a new Git checkout.
const option = process.argv.slice(2).join(' ');
const localOnly = option === '--run-local-build-and-benchmark';
const catalogOnly = option === '--run-one-catalog-request';
const missionOnly = option === '--run-one-mission-check';
assert(process.platform === 'win32' && (localOnly || catalogOnly || missionOnly || option === '--run-one-synthetic-turn'),
  'Choose --run-one-synthetic-turn, --run-one-catalog-request, --run-one-mission-check, or --run-local-build-and-benchmark on Windows.');
const runtime = fileURLToPath(new URL('../prototypes/integrated-backend/.runtime/', import.meta.url));
admitVelaFileEdit(runtime);
mkdirSync(runtime, { recursive: true });
const evidence = realpathSync.native(mkdtempSync(join(runtime, 'vela-air-live-codex-')));
const checkout = join(evidence, 'checkout');
mkdirSync(checkout);
const file = join(checkout, 'sample.json'), testFile = join(checkout, 'sample.test.mjs');
const buildFile = join(checkout, 'sample.build.mjs'), benchmarkFile = join(checkout, 'sample.bench.mjs');
const original = '{"count":1}\n';
writeFileSync(file, original, { flag: 'wx' });
writeFileSync(testFile, `import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('Did the count change to two?', () => {
  assert.deepEqual(JSON.parse(readFileSync(new URL('./sample.json', import.meta.url), 'utf8')), { count: ${missionOnly ? 1 : 2} });
});\n`, { flag: 'wx' });
if (localOnly) {
  writeFileSync(buildFile, `import { readFileSync } from 'node:fs';
const { count } = JSON.parse(readFileSync('sample.json', 'utf8'));
process.stdout.write(JSON.stringify({ count, double: 2 * count }) + '\\n');
`, { flag: 'wx' });
  writeFileSync(benchmarkFile, `import { readFileSync } from 'node:fs';
const times = Array.from({ length: 12 }, () => {
  const start = performance.now();
  if (JSON.parse(readFileSync('sample.json', 'utf8')).count !== 1) throw Error('Wrong count');
  return performance.now() - start;
}).sort((a, b) => a - b);
console.log(JSON.stringify({ samples: times.length, medianMs: times[5], p95Ms: times[11] }));
`, { flag: 'wx' });
}
const git = (...args: string[]) => execFileSync('git.exe', ['-C', checkout, '-c', 'core.hooksPath=NUL', ...args],
  { windowsHide: true, timeout: 6000, stdio: 'pipe', maxBuffer: 8192 });
git('init', '--quiet', '--template=');
git('add', '--', 'sample.json', 'sample.test.mjs', ...(localOnly ? ['sample.build.mjs', 'sample.bench.mjs'] : []));
git('-c', 'user.name=AIR synthetic acceptance', '-c', 'user.email=air-test@example.invalid', 'commit', '--quiet', '-m', 'Synthetic files for one Vela test');

const core = new BackendCore({ path: join(evidence, 'synthetic.sqlite'), contentPolicy: 'synthetic-only',
  provider: 'codex', cwd: checkout, retention: { maxEvents: 128 } });
const receipt: Record<string, unknown> = { passed: false, synthetic: true, evidence, account: 'installed Codex' };
async function verifyModelEdit() {
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
}

async function verifyLocalChecks() {
  receipt.stage = 'read RAM through the sandbox';
  const owner = core as unknown as { localVelaHost(): VelaLocalHost };
  const readHost = owner.localVelaHost.bind(core);
  owner.localVelaHost = () => ({ ...readHost(), system: { memory() { throw Error('Synthetic unavailable primary'); } } });
  try {
    const result = await core.command('velaRouteNative', { intent: 'How much RAM am I using?' });
    assert(result.matched && result.request.local?.facts.kind === 'system-memory');
    assert.equal(result.request.local.facts.measurement.source.executor, 'codex-local-command');
    receipt.memoryFallback = { measured: true, executor: 'codex-local-command' };
  } finally { owner.localVelaHost = readHost; }
  const destination = join(checkout, 'generated.json');
  receipt.stage = 'run build';
  const build = await core.command('velaStandaloneCheckReview', { intent: 'Build this project', paths: [buildFile], artifactPath: destination });
  const generated = await core.command('velaStandaloneCheckRun', build);
  assert.equal(generated.projectCheck?.state, 'passed');
  assert.equal(generated.projectCheck?.artifact?.relativePath, 'generated.json');
  const review = await core.command('velaFileEditReview', { requestId: generated.id });
  assert.equal(review.files[0].path, destination);
  assert.equal(review.files[0].before, null);
  assert.deepEqual(JSON.parse(review.files[0].after), { count: 1, double: 2 });
  const saved = await core.command('velaFileEditApply', { requestId: generated.id, reviewId: review.reviewId });
  assert.equal(saved.state, 'applied');
  assert.equal(readFileSync(destination, 'utf8'), review.files[0].after);
  receipt.build = generated.projectCheck;
  receipt.stage = 'run benchmark';
  const benchmark = await core.command('velaStandaloneCheckReview', { intent: 'Run the benchmark', paths: [benchmarkFile] });
  const measured = await core.command('velaStandaloneCheckRun', benchmark);
  assert.equal(measured.projectCheck?.state, 'passed');
  assert.equal(measured.projectCheck?.benchmark?.samples, 12);
  assert.equal((await core.command('providerActivity', {})).providerRequests, 0);
  receipt.benchmark = measured.projectCheck;
  receipt.nativeEvidence = { executedModelTurns: 0 };
}

async function verifyCatalogRequest() {
  receipt.stage = 'set up a synthetic note';
  const title = 'Spring Measurements';
  const workspace = await core.command('desktop', { type: 'createWorkspace', title: 'Synthetic workbench', projectId: null });
  const notes = await core.command('desktop', { type: 'createResource', kind: 'note', title, workspaceId: workspace.activeWorkspaceId! });
  const note = notes.resources.find(item => item.title === title);
  assert(note);
  const intent = 'Can you find my Spring Measurements note?';
  const preview = await core.command('velaRequestPreview', { intent, resourceIds: [], adaptive: true });
  assert.equal(preview.providerId, 'codex-app-server');
  assert.equal(preview.route?.kind, 'app-planning');
  const approval = { previewId: preview.id, signature: preview.signature };
  const review = await core.command('velaNativeReview', approval);
  assert.equal(review.context.included.length, 0);
  assert.match(review.prompt, /Spring Measurements/u);
  await assert.rejects(core.command('authorizeVelaRequest', { ...approval, directSend: true }), /vela_attached_context_review_required/);
  const { grantId } = await core.command('authorizeVelaRequest', { ...approval, reviewDigest: review.reviewDigest });
  receipt.stage = 'find the note through the catalog';
  const result = await core.command('vela', { name: 'request', input: { intent, resourceIds: [], authorizeProvider: true, ...approval, grantId } }) as VelaRequest;
  receipt.catalogResult = { state: result.state, errorCode: result.errorCode };
  assert.equal(result.state, 'completed', result.errorCode);
  const state = await core.command('vela', { name: 'state', input: {} }) as VelaState;
  const plan = state.plans.find(item => item.id === result.planId);
  assert.equal(plan?.steps.length, 1);
  assert(plan?.steps[0].action.type === 'search' || plan?.steps[0].action.type === 'openResource');
  const action = state.receipts.find(item => item.planId === plan.id && item.state === 'applied');
  assert(state.searchResults?.[action!.id]?.some(item => item.id === note.id));
  assert.equal((await core.command('providerActivity', {})).providerRequests, 1);
  receipt.nativeEvidence = { executedModelTurns: 1, foundSyntheticNote: true, action: plan.steps[0].action.type };
}

async function verifyMissionCheck() {
  receipt.stage = 'review tracked mission test';
  const state = await core.command('desktop', { type: 'createWorkspace', title: 'Synthetic Codex mission review', projectId: null });
  await core.command('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId: state.workspaces[0].id } });
  const objective = 'Run selected Node tests and measure CPU and RAM';
  const preview = await core.command('missions', { name: 'preview', input: { objective } }) as MissionPreview;
  assert.equal(preview.localReview?.kind, 'node-test');
  const request = { objective, fingerprint: preview.fingerprint, requestId: randomUUID() };
  await assert.rejects(core.command('missions', { name: 'start', input: request }), /mission_project_check_review_required/);
  const selected = await core.command('missionCheckReview', { paths: [testFile] });
  await assert.rejects(core.command('missionStartReviewed', { ...request,
    approvedProjectCheck: { paths: [testFile], digest: 'stale' } }), /mission_project_check_scope_changed/);
  receipt.stage = 'run selected tests in actual sandbox';
  const started = await core.command('missionStartReviewed', { ...request,
    approvedProjectCheck: { paths: [testFile], digest: selected.digest } }) as MissionProjection;
  let mission: MissionProjection;
  const deadline = performance.now() + 35_000;
  do {
    mission = await core.command('missions', { name: 'read', input: { id: started.id } }) as MissionProjection;
    if (!['queued', 'running'].includes(mission.outcome)) break;
    await wait(50);
  } while (performance.now() < deadline);
  const check = mission.tasks.find(task => task.id === 'project-tests')!.attempts.at(-1);
  receipt.mission = { outcome: mission.outcome, evidence: check?.evidence, profile: mission.profile };
  assert.equal(mission.outcome, 'verified');
  assert.equal(check?.evidence?.source, 'codex-app-server:read-only-command');
  assert.equal((check?.evidence?.value as { testCount: number }).testCount, 1);
  assert.equal((await core.command('providerActivity', {})).providerRequests, 0);
  assert.equal(readFileSync(file, 'utf8'), original);
  receipt.nativeEvidence = { executedModelTurns: 0, sandboxPassed: true };
}

try {
  if (localOnly) await verifyLocalChecks();
  else if (missionOnly) await verifyMissionCheck();
  else if (catalogOnly) await verifyCatalogRequest();
  else await verifyModelEdit();
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
