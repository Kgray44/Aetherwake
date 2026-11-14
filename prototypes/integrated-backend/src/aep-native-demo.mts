import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Backend } from './service.mts';
import { nativeTrialProtocol } from './aep-native-trial.mts';

const path = process.argv[2];
if (!path) throw Error('Supply the path of a new FI-5 evidence database');
const target = resolve(path);
if (!target.endsWith('.fi5.sqlite') || existsSync(target)) throw Error('Use a new path ending in .fi5.sqlite');
const options = { path: target, privateRoot: dirname(target), contentPolicy: 'local-private' as const };
const host = { secrets: { available: async () => false, seal: async () => { throw Error('offline'); },
  open: async () => { throw Error('offline'); } } };
let backend = new Backend(options, host);
try {
  const desktop = await backend.call('desktop', { type: 'createWorkspace', title: 'FI-5 native demonstration', projectId: null });
  const workspaceId = desktop.workspaces[0].id;
  await backend.call('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId } });
  let accepted: { id: string; revision: number } | undefined;
  for (const candidate of ['parallel', 'omit-backend'] as const) {
    const proposed = await backend.call('aepExperimentNative', { name: 'propose', candidate });
    if (!proposed || !('experiment' in proposed)) throw Error('aep_proposal_missing');
    const id = proposed.experiment.id;
    const record = await backend.call('aepExperimentNative', { name: 'test', id });
    if (!record || !('experiment' in record)) throw Error('aep_result_missing');
    const evidence = await backend.call('aepExperimentNative', { name: 'evidence', id });
    if (!evidence || !('trials' in evidence) || !('record' in evidence)) throw Error('aep_evidence_missing');
    console.log(JSON.stringify({ candidate, id, result: record.result,
      qualityFailures: evidence.trials.filter(row => Object.values(row.assessment.gates).includes(false)).length,
      providerCalls: [...new Set(evidence.trials.map(row => row.assessment.metrics.providerCalls))],
      observedCriticalPath: evidence.trials.filter(row => row.assessment.metrics.criticalPath).length,
      maxProjectionMs: Math.max(...record.trials.map(row => row.overhead?.projectionMs ?? 0)) }));
    if (candidate === 'omit-backend') assert.equal(record.state, 'rejected');
    if (record.state === 'accepted') accepted = { id, revision: record.experiment.revision };
  }
  if (accepted) {
    const base = await backend.call('aepExperimentNative', { name: 'inspect-policy' });
    if (!base || !('version' in base)) throw Error('aep_baseline_missing');
    const promoted = await backend.call('aepExperimentNative', { name: 'promote', ...accepted, policyVersion: base.version });
    if (!promoted || !('version' in promoted)) throw Error('aep_promotion_missing');
    await backend.close();
    backend = new Backend(options, host);
    await backend.call('desktop', { type: 'navigate', target: { kind: 'workspace', workspaceId } });
    const learning = await backend.call('missions', { name: 'experience-finding', input: { id: accepted.id, cohort: nativeTrialProtocol } });
    const applied = await backend.call('aepExperimentNative', { name: 'start-probe' });
    const rollback = await backend.call('aepExperimentNative', {
      name: 'rollback-reviewed', ...promoted.scope, experimentId: accepted.id, policyVersion: promoted.version,
    });
    const after = await backend.call('aepExperimentNative', { name: 'start-probe' });
    assert.ok(learning && 'policy' in learning && learning.policy?.version === promoted.version);
    assert.ok(applied && 'concurrency' in applied && applied.concurrency === 2);
    assert.ok(rollback && 'version' in rollback && rollback.version === promoted.version + 1);
    assert.ok(after && 'concurrency' in after && after.concurrency === 1);
    assert.equal(await backend.call('missions', { name: 'experience-finding',
      input: { id: accepted.id, cohort: 'unrelated-workload' } }), null);
    const historical = await backend.call('missions', { name: 'experience-evidence', input: { id: accepted.id } });
    assert.ok(historical && 'record' in historical && historical.record.state === 'rolled-back');
    console.log(JSON.stringify({ promoted, learning, applied, rollback, after }));
  }
} finally { await backend.close(); }
