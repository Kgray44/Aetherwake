import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalMissionContextSource, compileMissionContext, MissionContextError, validateMissionContext } from '../src/mission-context.mts';
import type { MissionContextRequest, MissionContextSource, MissionSourceRef, MissionSourceSnapshot } from '../src/mission-context.mts';
import type { ResourceRef } from '../src/contracts.ts';

function request(): MissionContextRequest {
  return { missionId: 'mission', revision: 1, taskId: 'test', scope: { projectId: 'project', workspaceId: 'workspace' },
    missionObjective: 'Investigate image compression', taskObjective: 'Measure image codec fidelity',
    criteria: ['Confirm image fidelity', 'Report the evidence'], constraints: ['Work offline'],
    dependencyTaskIds: [], dependencies: [], maxTokens: 4096 };
}
const ref = (id: string): MissionSourceRef => ({ kind: 'resource', id });
const snapshot = (id: string, content: string): MissionSourceSnapshot => ({ ref: ref(id), version: 1,
  locator: 'aerynth://resource/' + id, scope: { kind: 'workspace', id: 'workspace' }, certainty: 'reviewed', content });
function fixture(values: MissionSourceSnapshot[]) {
  const items = new Map(values.map(item => [item.ref.id, item]));
  let stamp = 'policy-1', denied = false, reverse = false, offline = false;
  const source: MissionContextSource = {
    scopeVersion: () => stamp,
    retrieve: () => {
      if (offline) throw new Error('synthetic-unavailable');
      const refs = values.map(item => item.ref);
      return reverse ? refs.reverse() : refs;
    },
    read: ref => denied ? null : items.get(ref.id) ?? null,
  };
  return { source, items, revoke: () => { denied = true; }, changePolicy: () => { stamp = 'policy-2'; },
    reverse: () => { reverse = true; }, disconnect: () => { offline = true; } };
}
const errorCode = (code: string) => (error: unknown) => error instanceof MissionContextError && error.code === code;

test('pins mission and task authority and exact verified dependency evidence in immutable packages', () => {
  const evidence = { taskId: 'measure', evidenceId: 'proof', attemptId: 'attempt-1',
    source: 'fixture', observedAt: '2026-11-03T23:15:00Z', value: { result: { metric: 42 } } };
  const input = { ...request(), dependencyTaskIds: ['measure'], dependencies: [evidence] };
  const value = compileMissionContext(input);
  assert.equal(value.payload.missionObjective, input.missionObjective);
  assert.equal(value.payload.taskObjective, input.taskObjective);
  assert.deepEqual(value.payload.criteria, input.criteria);
  assert.deepEqual(value.payload.constraints, input.constraints);
  assert.deepEqual(value.payload.dependencies, [evidence]);
  assert.equal(value.manifest.retrieval, 'not-configured');
  assert.equal(value.manifest.dependencies[0].attemptId, evidence.attemptId);
  assert.ok(Object.isFrozen(value.payload.dependencies[0].value));
  assert.ok(Object.isFrozen(value.payload.binding.scope));
  assert.ok(Object.isFrozen(value.payload.criteria));
  validateMissionContext(value, input);
  evidence.value.result.metric = 24;
  assert.deepEqual(value.payload.dependencies[0].value, { result: { metric: 42 } });
  assert.throws(() => validateMissionContext(value, input), errorCode('mission_context_changed'));
  assert.throws(() => compileMissionContext({ ...input, dependencies: [] }), errorCode('mission_context_dependencies_unavailable'));
  assert.throws(() => compileMissionContext({ ...input, dependencies: [{ ...evidence, value: new Date() }] }), errorCode('mission_context_invalid_evidence'));
});

test('selects deterministically, preserving required material and explaining omissions without inaccessible IDs', () => {
  const pinned = snapshot('pin', 'Reference required by the owner.');
  const first = snapshot('a', 'Image codec fidelity evidence.');
  const same = snapshot('b', first.content);
  const weaker = snapshot('c', 'One image.');
  const irrelevant = snapshot('ignored', 'Garlic salt.');
  const elsewhere = { ...snapshot('private-elsewhere', 'Image compression codec fidelity evidence.'), scope: { kind: 'project' as const, id: 'elsewhere' } };
  const adapter = fixture([same, elsewhere, irrelevant, pinned, first, weaker]);
  const input = { ...request(), requiredSources: [{ ...pinned.ref, expectedVersion: 1 }] };
  const value = compileMissionContext(input, adapter.source);
  adapter.reverse();
  assert.deepEqual(compileMissionContext(input, adapter.source), value);
  assert.deepEqual(value.manifest.sources.map(source => [source.ref.id, source.inclusion]), [['pin', 'required'], ['a', 'relevant'], ['c', 'relevant']]);
  assert.deepEqual(value.manifest.omissions, [{ reason: 'duplicate', count: 2 }, { reason: 'irrelevant', count: 1 }, { reason: 'unavailable', count: 1 }]);
  assert.equal(value.payload.sources[1].trust, 'untrusted-source-data');
  assert.ok(!JSON.stringify(value).includes('private-elsewhere'));
  assert.ok(!JSON.stringify(value.manifest).includes(first.content));
  validateMissionContext(value, input, adapter.source);
});

test('refuses missing, stale, unauthorized, and over-budget mandatory material', () => {
  const pinned = snapshot('pin', 'Image codec fidelity. ' + '🎞️'.repeat(200));
  const adapter = fixture([pinned]);
  const input = { ...request(), requiredSources: [{ ...pinned.ref, expectedVersion: 1 }] };
  assert.throws(() => compileMissionContext(input), errorCode('mission_context_required_source_unavailable'));
  assert.throws(() => compileMissionContext({ ...input, requiredSources: [{ ...pinned.ref, expectedVersion: 2 }] }, adapter.source), errorCode('mission_context_required_source_unavailable'));
  let searched = false;
  const tracked = { ...adapter.source, retrieve: () => { searched = true; return []; } };
  assert.throws(() => compileMissionContext({ ...input, maxTokens: 600 }, tracked), errorCode('mission_context_required_budget_exceeded'));
  assert.equal(searched, false);
  assert.throws(() => compileMissionContext({ ...request(), maxTokens: 25 }), errorCode('mission_context_required_budget_exceeded'));
  adapter.revoke();
  assert.throws(() => compileMissionContext(input, adapter.source), errorCode('mission_context_required_source_unavailable'));
});

test('fences same-version edits, version changes, revocation and scope policy changes before dispatch', () => {
  const pinned = snapshot('pin', 'Image codec fidelity.');
  const adapter = fixture([pinned]);
  const input = request(), value = compileMissionContext(input, adapter.source);
  assert.throws(() => validateMissionContext(value, { ...input, revision: 2 }, adapter.source), errorCode('mission_context_changed'));
  adapter.items.set('pin', { ...pinned, content: 'Different image codec fidelity.' });
  assert.throws(() => validateMissionContext(value, input, adapter.source), errorCode('mission_context_source_changed'));
  adapter.items.set('pin', { ...pinned, version: 2 });
  assert.throws(() => validateMissionContext(value, input, adapter.source), errorCode('mission_context_source_changed'));
  adapter.items.set('pin', pinned);
  const tampered = { ...value, payload: { ...value.payload, criteria: ['Change the acceptance criteria'] } };
  assert.throws(() => validateMissionContext(tampered, input, adapter.source), errorCode('mission_context_changed'));
  adapter.revoke();
  assert.throws(() => validateMissionContext(value, input, adapter.source), errorCode('mission_context_source_changed'));
  adapter.changePolicy();
  assert.throws(() => validateMissionContext(value, input, adapter.source), errorCode('mission_context_scope_changed'));
});

test('uses an explicit UTF-8 estimate and restarts packing if the tokenizer fails partway', () => {
  const big = snapshot('big', 'Image codec fidelity evidence. ' + '🎞️'.repeat(400));
  const small = snapshot('small', 'Image fidelity note.');
  const adapter = fixture([big, small]);
  let calls = 0;
  const tokenizer = { id: 'fixture-tokenizer', count: (_: string) => {
    if (++calls === 3) throw new Error('synthetic-tokenizer-disconnect');
    return 10;
  } };
  const input = { ...request(), maxTokens: 850, tokenCounter: tokenizer };
  const value = compileMissionContext(input, adapter.source);
  assert.equal(value.manifest.accounting.method, 'utf8-byte-estimate');
  assert.equal(value.manifest.accounting.tokens, Buffer.byteLength(JSON.stringify(value.payload)));
  assert.equal(value.manifest.accounting.payloadBytes, value.manifest.accounting.tokens);
  assert.deepEqual(value.manifest.sources.map(item => item.ref.id), ['small']);
  assert.deepEqual(value.manifest.omissions, [{ reason: 'budget', count: 1 }]);
  validateMissionContext(value, input, adapter.source);
  const measured = compileMissionContext(input, adapter.source);
  assert.equal(measured.manifest.accounting.method, 'tokenizer');
  assert.equal(measured.manifest.accounting.tokenizerId, tokenizer.id);
  assert.deepEqual(measured.manifest.sources.map(item => item.ref.id), ['big', 'small']);
  const changed = { ...input, tokenCounter: { ...tokenizer, count: () => 11 } };
  assert.throws(() => validateMissionContext(measured, changed, adapter.source), errorCode('mission_context_accounting_changed'));
});

test('reports unavailable optional retrieval while preserving independently authorized pinned material', () => {
  const pinned = snapshot('pin', 'Image codec fidelity.');
  const adapter = fixture([pinned]);
  adapter.disconnect();
  const input = { ...request(), requiredSources: [pinned.ref] };
  const value = compileMissionContext(input, adapter.source);
  assert.equal(value.manifest.retrieval, 'unavailable');
  assert.deepEqual(value.manifest.sources.map(item => item.ref.id), ['pin']);
  validateMissionContext(value, input, adapter.source);
});

test('canonical resource adapter reads only currently authorized, eligible notes in the mission workspace', () => {
  const note: ResourceRef = { kind: 'resource', id: 'note', version: 1, title: 'Image fidelity', resourceKind: 'note', projectId: 'project' };
  const noteElsewhere = { ...note, id: 'other-workspace' };
  const foreignProject = { ...note, id: 'other-project', projectId: 'other' };
  const transcript = { ...note, id: 'transcript', resourceKind: 'conversation' };
  const refs = [note, noteElsewhere, foreignProject, transcript];
  let canRead = true;
  const reads: string[] = [];
  const source = canonicalMissionContextSource({
    scope: () => ({ principalId: 'owner', policyVersion: 'policy-1', workspaceIds: ['workspace'], projectIds: ['project', 'other'], resourceIds: refs.map(item => item.id) }),
    search: () => refs,
    resolve: target => refs.find(item => item.id === target.id) ?? null,
    canReadContent: () => canRead,
    readContent: id => { reads.push(id); return { ref: note, content: 'Image fidelity', source: 'aerynth://resource/note?version=1' }; },
  }, (_binding, id) => id !== 'other-workspace');
  const input = request(), value = compileMissionContext(input, source);
  assert.deepEqual(reads, ['note']);
  assert.deepEqual(value.manifest.sources.map(item => item.ref.id), ['note']);
  validateMissionContext(value, input, source);
  assert.deepEqual(reads, ['note', 'note']);
  canRead = false;
  assert.throws(() => validateMissionContext(value, input, source), errorCode('mission_context_source_changed'));
  assert.deepEqual(reads, ['note', 'note']);
});
