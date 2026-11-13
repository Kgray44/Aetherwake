import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MissionPlan } from '../src/mission-contracts.mts';
import { nativeMissionExecutors, nativeMissionPlan } from '../src/mission-native.mts';
import { composeReviewedArtifactMission, parseReviewedArtifactMission, resolveReviewedArtifactMission } from '../src/mission-reviewed-composition.mts';
import { validateMissionPlan } from '../src/mission-service.mts';
import { missionImageSettings, prepareImageGeneration } from '../../openai-provider/images.mts';

const scope = { workspaceId: 'workspace', projectId: null };
const objective = 'Measure CPU and RAM and generate a geometric illustration';
const native = () => nativeMissionPlan('Measure CPU and RAM', scope)!;
function illustration(): MissionPlan {
  const prompt = 'Make a geometric illustration';
  const settings = missionImageSettings();
  return { objective: prompt, scope, criteria: ['verified-illustration-files'], tasks: [{
    id: 'illustration', objective: prompt, executor: 'artifact.illustration', criterion: 'verified-illustration-files',
    dependencies: [], claims: [], maxAttempts: 1, timeoutMs: 120_000,
    artifactImage: { prompt, settings, digest: prepareImageGeneration(prompt, settings).digest, configurationVersion: 2 },
  }] };
}

test('reviewed artifact and native tasks keep independent roots and share one evidence join', () => {
  const first = native(), second = illustration();
  const plan = composeReviewedArtifactMission(objective, first, second);
  validateMissionPlan(plan, { ...nativeMissionExecutors, 'artifact.illustration': nativeMissionExecutors['sample.ram'] });
  assert.deepEqual(plan.tasks.map(task => [task.id, task.dependencies]), [
    ['cpu', []], ['ram', []], ['illustration', []], ['report', ['cpu', 'ram', 'illustration']],
  ]);
  assert.deepEqual(plan.tasks[2], second.tasks[0]);
  assert.notEqual(plan.tasks[2].artifactImage, second.tasks[0].artifactImage);
  assert.deepEqual(first.tasks.at(-1)?.dependencies, ['cpu', 'ram']);
});

test('composition preserves Codex review payload and partial-coverage limitations', () => {
  const measured = nativeMissionPlan('Run selected Node tests and measure CPU and RAM', scope)!;
  measured.coverage = { status: 'partial', limitations: ['A native test cannot establish deployed behavior.'] };
  const check = measured.tasks.find(task => task.executor === 'codex.project-check')!;
  const composed = composeReviewedArtifactMission(objective, measured, illustration());
  assert.deepEqual(composed.coverage, measured.coverage);
  assert.deepEqual(composed.tasks.find(task => task.id === check.id), check);
  assert.ok(composed.tasks.at(-1)?.dependencies.includes(check.id));
});

test('composition rejects foreign scope, duplicate effects and changes to reviewed image parameters', () => {
  const foreign = illustration();
  foreign.scope = { ...scope, workspaceId: 'foreign' };
  assert.throws(() => composeReviewedArtifactMission(objective, native(), foreign), /mission_composition_scope_changed/);
  const duplicate = native();
  duplicate.tasks.push(illustration().tasks[0]);
  assert.throws(() => composeReviewedArtifactMission(objective, duplicate, illustration()), /invalid_mission_composition/);
  const changed = illustration();
  changed.tasks[0].artifactImage!.prompt = 'Different illustration';
  assert.throws(() => composeReviewedArtifactMission(objective, native(), changed), /mission_composition_artifact_changed/);
});

test('a combined explicit request separates native work from the exact image prompt', () => {
  const prompt = 'Draw a blue square: keep “and generate an illustration” as text.\nUse a plain background.';
  assert.deepEqual(parseReviewedArtifactMission(
    'Vela, run a mission to Run selected Node tests and measure CPU and RAM; generate an illustration [draft, high]: ' + prompt,
  ), {
    workObjective: 'Run selected Node tests and measure CPU and RAM',
    imageOptions: 'draft, high',
    imagePrompt: prompt,
  });
});

test('plain chat, standalone image prompts, and ambiguous or empty work do not enter composition', () => {
  for (const objective of [
    'Measure CPU and RAM; generate an illustration: Draw a square',
    'Run a mission to generate an illustration: draw a sign; generate an illustration: draw a square',
    'Run a mission to ; generate an illustration: Draw a square',
    'Run a mission to measure CPU and RAM; generate an illustration:   ',
    'Run a mission to measure CPU and RAM; upload logs; generate an illustration: Draw a square',
    'Run a mission to measure CPU and RAM; generate an illustration: ' + 'a'.repeat(4096),
  ]) assert.equal(parseReviewedArtifactMission(objective), null, objective.slice(0, 100));
});

test('mixed request resolves native work before preparing the exact reviewed image', () => {
  const request = 'Run a mission to measure CPU and RAM; generate an illustration: Make a geometric illustration';
  const prepared: unknown[] = [];
  const plan = resolveReviewedArtifactMission(request, text => nativeMissionPlan(text, scope), (prompt, options) => {
    prepared.push({ prompt, options });
    return illustration();
  });
  assert.deepEqual(prepared, [{ prompt: 'Make a geometric illustration', options: undefined }]);
  assert.equal(plan?.objective, request);
  assert.deepEqual(plan?.tasks.map(task => task.id), ['cpu', 'ram', 'illustration', 'report']);
  assert.throws(() => resolveReviewedArtifactMission(request.replace('measure CPU and RAM', 'install a new system service'),
    text => nativeMissionPlan(text, scope), () => assert.fail('Unsupported work cannot prepare an image request')),
  /mission_composition_work_unsupported/);
});

test('an unconfigured image provider can be disclosed as unavailable in a mixed preview', () => {
  const image = illustration();
  image.tasks[0].artifactImage!.configurationVersion = 0;
  assert.equal(composeReviewedArtifactMission(objective, native(), image).tasks[2].artifactImage?.configurationVersion, 0);
});
