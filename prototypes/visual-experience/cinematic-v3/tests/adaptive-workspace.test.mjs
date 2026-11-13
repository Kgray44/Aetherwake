import test from 'node:test';
import assert from 'node:assert/strict';
import { projectIntelligence } from '../src/adaptive-workspace.ts';
const binding = { missionId: 'synthetic:mission', workspaceId: 'synthetic:workspace', projectId: null };
const fixture = () => ({ contract: 'aerynth.vela-mission@1', id: binding.missionId,
  scope: { workspaceId: binding.workspaceId, projectId: null }, revision: 3, planRevision: 2,
  tasks: [{ id: 'synthetic:task' }], events: [{ seq: 9, kind: 'revised', time: '2026-11-12T00:00:00Z' }],
  planning: { responseId: 'synthetic:response', model: 'fixture-model', startedAt: '2026-11-12T00:00:00Z', providerEvidence: 'simulated' },
  profile: { elapsedMs: 0, peakWorkers: 1, attempts: 1, retries: 0, reportedTotalTokens: null },
  admission: { workerLimit: 1, reasons: [], readings: { cpuPercent: { value: 0, observedAt: '2026-11-12T00:00:00Z' } } } });

test('six regions preserve genuine source references and distinguish zero, absent and simulated values', () => {
  const regions = projectIntelligence(fixture(), binding);
  assert.equal(regions.length, 6);
  assert.equal(regions[0].readings[0].sourceId, 'synthetic:response');
  assert.equal(regions[0].readings[0].classification, 'simulated');
  assert.equal(regions[1].readings.find(x => x.field.endsWith('cpuPercent')).value, 0);
  assert.equal(regions[1].readings.find(x => x.field.endsWith('gpuEnginePercent')).classification, 'missing');
  assert.equal(regions[2].readings.find(x => x.field.endsWith('reportedTotalTokens')).value, null);
  assert.equal(regions[5].readings[0].field, 'events.9.kind');
  for (const r of regions.slice(3, 5)) { assert.equal(r.readings.length, 0); assert.match(r.limitation, /Unavailable/); }
  for (const change of [{ missionId: 'other' }, { workspaceId: 'other' }, { projectId: 'other' }])
    assert.equal(projectIntelligence(fixture(), { ...binding, ...change }), null);
});

test('canonical AEP profile distinguishes wall time, overlap, missing cost and historical lease identity', () => {
  const mission = fixture();
  const aep = { contract: 'aerynth.mission-execution-profile@1', missionId: mission.id, revision: mission.revision,
    wallTime: { elapsedMs: 410, from: 'mission-start-command', through: 'last-settlement' },
    work: { workerMs: 530, overlapMs: 120, activeMs: 410, peakWorkers: 2,
      intervalCoverage: { measured: 2, attempts: 2 }, criticalPath: { durationMs: 400, attemptIds: ['attempt-a'] } },
    economics: { reportedTotalTokens: null, simulatedTotalTokens: null, usageCoverage: 'missing', cost: null, costCoverage: 'provider-call-count-unavailable',
      usageGaps: ['unattributed-usage'], unattributedTotalTokens: 20 },
    quality: { objectiveVerified: false }, resourcePolicy: { leaseCoverage: { withReceipt: 1, withoutReceipt: 1 } },
    attempts: [{ id: 'attempt-a', taskId: 'task-a', executor: 'local.cpu', state: 'verified',
      start: { utc: '2026-11-12T00:00:00Z' }, end: null, providerSelection: null,
      resourceLease: { leaseId: 'lease-a', kind: 'cpu', epoch: 2, policyRevision: 1, configVersion: 4,
        reservedRamBytes: 1024, reservedVramBytes: null, expiresAt: '2026-11-12T00:10:00Z' } }] };
  const regions = projectIntelligence(mission, binding, aep);
  const profiler = regions[2].readings;
  assert.equal(profiler.find(row => row.field === 'Execution wall time').value, 410);
  assert.equal(profiler.find(row => row.field === 'Measured overlap').value, 120);
  assert.equal(profiler.find(row => row.field === 'Provider cost').value, null);
  assert.equal(profiler.find(row => row.field === 'Usage evidence gap').value, 'unattributed-usage');
  assert.equal(profiler.find(row => row.field === 'Critical path attempts').value, 'attempt-a');
  assert(regions[1].readings.some(row => row.sourceId === 'lease-a' && row.field === 'Reserved RAM'));
  assert.match(regions[1].limitation, /historical/i);
  for (const mismatch of [{ revision: 2 }, { revision: 4 }, { missionId: 'other' }]) {
    assert(!projectIntelligence(mission, binding, { ...aep, ...mismatch })[2].readings.some(row => row.field === 'Measured overlap'));
  }
});
